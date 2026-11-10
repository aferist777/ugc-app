'use strict';

// ════════════════════════════════════════════════════════════════════════════
// A CLIP'S EFFECTS IN THE RENDER (phase V84, the owner 2026-11-09/10; docs/local-app/plan/, "Подфаза 3 — V84"). The numbers are
// public/js/fx/params.js paramsAt - the very ones the preview draws by (js/merge-v3/fx-draw.js) - read at EVERY FRAME of the
// stretches where the clip's effects run, and handed to ffmpeg's filters frame by frame through `sendcmd` (a file beside the graph,
// written and removed by lib/mv3b-job.js; this module writes nothing).
//
// THE CHAIN, on the clip's layer - the frame-sized picture of the clip as it lies in the frame (lib/mv3b-render.js lays an insert on
// a transparent frame first), its timestamps the timeline's:
//   fps -> RGB with alpha -> the colour matrix (colorchannelmixer: rr..bb and ra/ga/ba - with the alpha at 255 the offset) ->
//   the move (pad once if the picture ever gets smaller, scale by command, the frame cut back out by command - measured 2026-11-10:
//   the cut's own w/h commands do not reach the scaler after it, and a pixel format changed right after a scaler that changes size
//   hangs ffmpeg 6.1, so the whole chain stays in gbrap until its end) -> the channels (rgbashift) -> the blocks (pixelize) ->
//   (block 1c) the face's mosaic (its oval's box of blocks laid by command through an oval mask) and Snap zoom's blur -> the
//   vignette and the speed lines, laid over the picture only where the clip has picture (its alpha taken off and put back) ->
//   yuva420p, the clip's opacity last.
// ════════════════════════════════════════════════════════════════════════════

const P = require('../public/js/fx/params.js');
const FX = require('../public/js/fx/effects.js');

const f5 = (v) => String(Math.round((+v || 0) * 1e5) / 1e5);
const r6 = (v) => (+v || 0).toFixed(6);
const NEUTRAL_COL = FX.COL_ID;
const COL_KEYS = ['rr', 'rg', 'rb', 'ra', 'gr', 'gg', 'gb', 'ga', 'br', 'bg', 'bb', 'ba'];

/**
 * The timeline's stretches [[a, b], ...] where any effect of clip `c` runs, merged - (block 3) less `skip`, the stretches the app's
 * window baked (lib/fx-bake.js: every effect there is in the copy).
 */
function spansOf(c, skip) {
  const out = [];
  for (const e of (c.fx || [])) {
    const s = P.spanOf(c, e);
    if (s.b > s.a + 1e-4) out.push([Math.max(+c.start || 0, s.a), s.b]);
  }
  out.sort((x, y) => x[0] - y[0]);
  let m = [];
  for (const sp of out) {
    const l = m[m.length - 1];
    if (l && sp[0] <= l[1] + 1e-4) l[1] = Math.max(l[1], sp[1]);
    else m.push(sp.slice());
  }
  for (const [ka, kb] of (skip || [])) {
    const next = [];
    for (const [a, b] of m) {
      if (kb <= a || ka >= b) { next.push([a, b]); continue; }
      if (ka > a + 1e-4) next.push([a, ka]);
      if (kb < b - 1e-4) next.push([kb, b]);
    }
    m = next;
  }
  return m;
}

// The window cut out of the scaled, padded picture for a move { a, b, e, f } (see the header of params.js): the padded frame
// PW x PH (the frame in its middle) scaled to SW x SH, the frame's W x H taken at (x, y).
function _cut(m, W, H, px, py) {
  const PW = W + 2 * px, PH = H + 2 * py;
  const s = Math.hypot(m.a, m.b);
  // Even sizes: a scale that wavers by a ten-thousandth (a measured camera) keeps one size, and the scaler is not built again.
  const SW = Math.max(2, Math.round(PW * s / 2) * 2), SH = Math.max(2, Math.round(PH * s / 2) * 2);
  const sx = SW / PW, sy = SH / PH;
  const cosr = m.a / (s || 1), sinr = m.b / (s || 1);
  const rcx = cosr * W / 2 - sinr * H / 2, rcy = sinr * W / 2 + cosr * H / 2;
  const x = sx * (PW / 2 - rcx) - m.e, y = sy * (PH / 2 - rcy) - m.f;
  return { SW, SH, x, y, rot: Math.atan2(m.b, m.a) };
}
// How much the frame must be padded for the window to stay inside it at this move (0 when the picture covers the frame).
function _padNeed(m, W, H) {
  const s = Math.hypot(m.a, m.b) || 1;
  const cosr = m.a / s, sinr = m.b / s;
  const rcx = cosr * W / 2 - sinr * H / 2, rcy = sinr * W / 2 + cosr * H / 2;
  const nx = Math.max(rcx - W / 2 + m.e / s, (W - m.e) / s - W / 2 - rcx, 0);
  const ny = Math.max(rcy - H / 2 + m.f / s, (H - m.f) / s - H / 2 - rcy, 0);
  return { x: nx, y: ny };
}

/**
 * The effects of clip `c` as a piece of the graph, or null when it has none. `input` - its layer's label; `n` - the clip's number;
 * opts { w, h, fps, main, cmdPathEsc (the sendcmd file's path, escaped), see (the opacity's chain, ',…' or ''), assets:
 * { vig, lines }, nextInput (the index the masks' inputs will have) }. Returns { parts, out, inputs: [{ abs, t }], cmd: the text of
 * the sendcmd file }.
 */
function fxChain(c, n, input, o) {
  if (!P.hasFx(c) || !o || !o.cmdPathEsc) return null;
  const W = o.w, H = o.h, fps = o.fps || 30;
  const u = W / 1080;
  const spans = spansOf(c, o.skip);
  if (!spans.length) return null;

  // Every frame of every stretch, and one after each - where everything goes back to nothing.
  const frames = [];
  for (const [a, b] of spans) {
    let k = Math.ceil(a * fps - 1e-6);
    for (; k / fps < b - 1e-9; k++) frames.push({ t: k / fps, p: P.paramsAt(c, k / fps + 1e-6, W, H, o.main) });
    frames.push({ t: k / fps, p: null });
  }
  const need = { col: false, move: false, ch: false, px: false, glow: false, blurV: false, vig: false, lines: false, stripes: false, grain: false,
    blur: false, mos: false };
  // (block 1c) The face's mosaic: one oval a clip (params.js mosaicSizeOf), its mask made by lib/fx-assets.js.
  const mosSize = P.mosaicSizeOf(c, W, H);
  const oval = mosSize && o.assets && o.assets.ovals ? o.assets.ovals[mosSize.w + 'x' + mosSize.h] : null;
  let padX = 0, padY = 0;
  for (const fr of frames) {
    const p = fr.p;
    if (!p) continue;
    if (p.col) need.col = true;
    if (p.move) {
      need.move = true;
      if (Math.abs(Math.atan2(p.move.b, p.move.a)) > 1e-5) need.rot = true;
      const pn = _padNeed(p.move, W, H);
      padX = Math.max(padX, pn.x); padY = Math.max(padY, pn.y);
    }
    if (p.ch) need.ch = true;
    if (p.px > 1.5) need.px = true;
    if (p.vig > 0.002 && o.assets && o.assets.vig) need.vig = true;
    if (p.lines > 0.002 && o.assets && o.assets.lines) need.lines = true;
    if (p.glow > 0.002) need.glow = true;
    if (p.blurV > 0.05) need.blurV = true;
    if (p.stripes > 0.002 && o.assets && o.assets.stripes) need.stripes = true;
    if (p.grain > 0.002) need.grain = true;
    if (p.blur > 0.05) need.blur = true;
    if (p.mosaic && oval) need.mos = true;
  }
  if (!Object.values(need).some(Boolean)) return null;
  padX = padX > 0.01 ? Math.ceil(padX + 2) : 0;
  padY = padY > 0.01 ? Math.ceil(padY + 2) : 0;
  const PW = W + 2 * padX, PH = H + 2 * padY;

  // The commands, a value written only when it changes.
  const tag = `fx${n}`;
  const last = {};
  let sizes = 0;                 // how many times the scaler is handed a new size
  const lines = [];
  for (const fr of frames) {
    const p = fr.p;
    const cmds = [];
    const put = (target, key, v) => {
      const id = target + ' ' + key;
      const s = String(v);
      if (last[id] === s) return;
      last[id] = s;
      cmds.push(`[enter] ${target} ${key} ${s}`);
    };
    if (need.col) {
      const col = (p && p.col) || NEUTRAL_COL;
      COL_KEYS.forEach((k, i) => put(`colorchannelmixer@${tag}c`, k, f5(col[i])));
    }
    if (need.move) {
      const m = (p && p.move) || { a: 1, b: 0, e: 0, f: 0 };
      const cut = _cut(m, W, H, padX, padY);
      if (need.rot) put(`rotate@${tag}t`, 'a', f5(cut.rot));
      if (last[`scale@${tag}z w`] !== String(cut.SW) || last[`scale@${tag}z h`] !== String(cut.SH)) sizes++;
      put(`scale@${tag}z`, 'w', cut.SW);
      put(`scale@${tag}z`, 'h', cut.SH);
      put(`crop@${tag}k`, 'x', Math.round(Math.max(0, Math.min(cut.SW - W, cut.x))));
      put(`crop@${tag}k`, 'y', Math.round(Math.max(0, Math.min(cut.SH - H, cut.y))));
    }
    if (need.ch) {
      const ch = (p && p.ch) || {};
      for (const [k, key] of [['rx', 'rh'], ['ry', 'rv'], ['gx', 'gh'], ['gy', 'gv'], ['bx', 'bh'], ['by', 'bv']]) put(`rgbashift@${tag}s`, key, Math.round((+ch[k] || 0) * u));
    }
    if (need.px) {
      const b = Math.max(1, Math.round(((p && p.px) || 1) * u));
      put(`pixelize@${tag}p`, 'w', b);
      put(`pixelize@${tag}p`, 'h', b);
    }
    if (need.glow) {
      const g = (p && p.glow) || 0;
      put(`gblur@${tag}g1`, 'sigma', f5(g > 0 ? 1.3 * u : 0));
      put(`gblur@${tag}g2`, 'sigma', f5(g > 0 ? 14 * u / 4 : 0));
      put(`blend@${tag}gm`, 'all_opacity', f5(0.12 * g));
    }
    if (need.blurV) put(`gblur@${tag}bv`, 'sigmaV', f5(((p && p.blurV) || 0) * u));
    if (need.blur) put(`gblur@${tag}bl`, 'sigma', f5(((p && p.blur) || 0) * u));
    if (need.mos) {
      // The oval's box cut out of the blocks (padded by its own size on every side, so a box past the edge is still inside) and
      // laid at the box's corner; with no mosaic at this frame - laid off the frame.
      const m = p && p.mosaic;
      const x = m ? m.x : -(mosSize.w + 4), y = m ? m.y : 0;
      put(`crop@${tag}mc`, 'x', Math.max(0, Math.min(W + mosSize.w, x + mosSize.w)));
      put(`crop@${tag}mc`, 'y', Math.max(0, Math.min(H + mosSize.h, y + mosSize.h)));
      put(`overlay@${tag}mv`, 'x', x);
      put(`overlay@${tag}mv`, 'y', y);
    }
    if (need.vig) put(`colorchannelmixer@${tag}v`, 'aa', f5((p && p.vig) || 0));
    if (need.stripes) put(`colorchannelmixer@${tag}r`, 'aa', f5((p && p.stripes) || 0));
    if (need.lines) put(`colorchannelmixer@${tag}l`, 'aa', f5(((p && p.lines) || 0) * FX.LINES_ALPHA));
    if (cmds.length) lines.push(`${r6(Math.max(0, fr.t - 0.5 / fps))}-${r6(fr.t + 0.5 / fps)} ${cmds.join(', ')};`);
  }

  const parts = [];
  const inputs = [];
  // The path as an unquoted option value, escaped for both readings (lib/mv3b-subs.js escapeFilterPath).
  // Handed only the frames of its stretches (`select` - lib/mv3b-render.js lay), already at the frame rate; else every frame.
  let ch = `[${input}]` + (o.select ? '' : `fps=${fps},`) + `format=gbrap,sendcmd=f=${o.cmdPathEsc}`;
  if (need.col) ch += `,colorchannelmixer@${tag}c`;
  if (need.move) {
    if (padX || padY) ch += `,pad=w=${PW}:h=${PH}:x=${padX}:y=${padY}:color=black@0`;
    // (block 1b) Turned about the padded frame's middle - the frame's - clockwise as the canvas turns, the corners empty.
    if (need.rot) ch += `,rotate@${tag}t=a=0:ow=${PW}:oh=${PH}:c=black@0,format=gbrap`;
    // Bilinear, as the canvas draws. Built again at each new size - single-threaded that is cheaper (the punch-ins' measurement,
    // V49.2) - unless the size hardly ever changes (a measured camera, Soft sway's one zoom): then its threads do the work.
    const steady = sizes <= Math.max(2, frames.length * 0.05);
    ch += `,scale@${tag}z=w=${PW}:h=${PH}:flags=bilinear${steady ? '' : ':threads=1'},crop@${tag}k=w=${W}:h=${H}:x=${padX}:y=${padY},format=gbrap`;
  }
  if (need.ch) ch += `,rgbashift@${tag}s=edge=smear`;
  if (need.px) ch += `,pixelize@${tag}p=w=1:h=1`;
  const start = +c.start || 0, end = start + (+c.dur || 0);
  let k = o.nextInput;
  // A still picture repeated in memory at the frame rate over the clip's own seconds - the frames the chain is handed.
  const still = (idx, fmt) => `[${idx}:v]format=${fmt},loop=loop=-1:size=1,setpts=N/(${fps}*TB)+${r6(start)}/TB,fps=${fps},` +
    `trim=start=${r6(start)}:end=${r6(end + 1 / fps)}` + (o.select ? `,select='${o.select}'` : '');
  // (block 1c) The face's mosaic: the frame in blocks of its own grid (pixelize, as the page's), the oval's box cut out of it by
  // command, the oval's mask its alpha, laid back by command - and the clip's own alpha put back over it (an insert's edge).
  if (need.mos) {
    const B = Math.max(1, Math.round(FX.MOSAIC_BLOCK * u));
    const MW = mosSize.w, MH = mosSize.h;
    const idx = k++;
    inputs.push({ abs: oval, t: 1 });
    parts.push(ch + `[${tag}m]`);
    parts.push(still(idx, 'gray') + `[${tag}mm]`);
    parts.push(`[${tag}m]split=3[${tag}m0][${tag}m1][${tag}m2]`);
    parts.push(`[${tag}m2]alphaextract[${tag}mk]`);
    parts.push(`[${tag}m1]pixelize=w=${B}:h=${B},pad=w=${W + 2 * MW}:h=${H + 2 * MH}:x=${MW}:y=${MH}:color=black@0,` +
      `crop@${tag}mc=w=${MW}:h=${MH}:x=0:y=0,format=gbrap[${tag}mp]`);
    parts.push(`[${tag}mp][${tag}mm]alphamerge[${tag}mo]`);
    parts.push(`[${tag}m0][${tag}mo]overlay@${tag}mv=x=0:y=0:eof_action=pass:format=auto,format=gbrap[${tag}mq]`);
    parts.push(`[${tag}mq][${tag}mk]alphamerge[${tag}mx]`);
    ch = `[${tag}mx]format=gbrap`;
  }
  // (block 1c) Snap zoom's blur both ways - its σ by command, 0 leaves the frame as it is.
  if (need.blur) ch += `,gblur@${tag}bl=sigma=0:steps=3`;
  // (block 1b) A vertical blur (the glitch's smear) - its σ by command, 0 leaves the frame as it is (measured 2026-11-10).
  if (need.blurV) ch += `,gblur@${tag}bv=sigma=0:sigmaV=0:steps=3`;
  let cur = `${tag}b`;
  parts.push(ch + `[${cur}]`);
  // (block 1b) Soft sway's soft focus: 0.88 of the picture blurred a little and 0.12 of it blurred a lot - blend's normal at
  // 0.12 (A the strong blur); both σ and the share by command, 0 outside it.
  if (need.glow) {
    parts.push(`[${cur}]split[${tag}ga][${tag}gb]`);
    parts.push(`[${tag}ga]gblur@${tag}g1=sigma=0:steps=3[${tag}gs]`);
    // The strong blur on a quarter of the frame and back - the same soft light, a sixteenth of the work (measured: Soft sway over
    // a 30 s clip took 62 s to render with it at full size).
    const qw = Math.max(2, Math.round(W / 8) * 2), qh = Math.max(2, Math.round(H / 8) * 2);
    parts.push(`[${tag}gb]scale=${qw}:${qh}:flags=bilinear,gblur@${tag}g2=sigma=0:steps=3,scale=${W}:${H}:flags=bilinear,format=gbrap[${tag}gg]`);
    parts.push(`[${tag}gg][${tag}gs]blend@${tag}gm=all_mode=normal:all_opacity=0[${tag}gx]`);
    cur = `${tag}gx`;
  }
  // A picture laid over the clip only where the clip has picture: its alpha taken off, the picture laid on, the alpha put back.
  // The mask decoded once and repeated in memory at the frame rate, over the clip's own seconds.
  const over = (abs, name) => {
    const idx = k++;
    inputs.push({ abs, t: 1 });
    parts.push(still(idx, 'gbrap') + `,colorchannelmixer@${tag}${name}=aa=0[${tag}${name}m]`);
    parts.push(`[${cur}]split[${tag}${name}a][${tag}${name}b]`);
    parts.push(`[${tag}${name}b]alphaextract[${tag}${name}k]`);
    parts.push(`[${tag}${name}a][${tag}${name}m]overlay=0:0:eof_action=pass:format=auto[${tag}${name}o]`);
    parts.push(`[${tag}${name}o][${tag}${name}k]alphamerge[${tag}${name}x]`);
    cur = `${tag}${name}x`;
  };
  if (need.vig) over(o.assets.vig, 'v');
  if (need.lines) over(o.assets.lines, 'l');
  if (need.stripes) over(o.assets.stripes, 'r');
  // (block 1b) The glitch's grain - ffmpeg's own noise while it runs (random in the page as here; not the same grain dot for dot).
  let grain = '';
  if (need.grain) {
    const on = [];
    for (let i = 0; i < frames.length; i++) {
      const g = frames[i].p && frames[i].p.grain > 0.002;
      if (!g) continue;
      const a = frames[i].t - 0.5 / fps;
      let j = i;
      while (j + 1 < frames.length && frames[j + 1].p && frames[j + 1].p.grain > 0.002) j++;
      on.push(`between(t,${r6(a)},${r6(frames[j].t + 0.5 / fps)})`);
      i = j;
    }
    if (on.length) grain = `,noise=c0s=14:c1s=14:c2s=14:c0f=t:c1f=t:c2f=t:enable='${on.join('+')}'`;
  }
  parts.push(`[${cur}]format=gbrap${grain},format=yuva420p${o.see || ''}[${tag}o]`);
  return { parts, out: `${tag}o`, inputs, cmd: lines.join('\n') + '\n' };
}

module.exports = { fxChain, spansOf };
