'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — the render of a project.

   A project has a variable number of lanes, made and destroyed by hand, and their order is a
   property of the project. The talking-head editor's renderer, which read six named lanes, went
   with that editor (docs/local-app/PLAN.md, phase 3); its effects and its halfer band were
   ported here first, value for value.

   THE ONE THING THIS MUST AGREE WITH is public/js/merge-v3/preview-b.js. Layer order and
   frame shape are read from the project here exactly as they are read there - lanes listed
   top layer first, painted bottom first, format off the project. If the two ever read them
   differently the screen and the file show different videos, and that is the most expensive
   kind of bug in an editor: it is invisible until the export is watched.

   PURE. It builds a graph and returns it; it runs nothing and writes nothing. Executing it
   is the next step, and keeping the two apart is what lets the graph be checked without a
   render.
   ═══════════════════════════════════════════════════════════════════════════ */

const { escapeFilterPath } = require('./mv3b-subs');
const { CAPTION_FONTS_DIR } = require('./config');
const FRAMING = require('../public/js/framing/path.js');
// (phase V51, point 1) A clip's crop - a piece of its file cut first; one module with the preview.
const CROP = require('../public/js/framing/crop.js');
// (phase V65) How much of a clip is seen - one rule with the preview (public/js/overlay/look.js).
const LOOK = require('../public/js/overlay/look.js');
// (phase V75) A clip's colour correction - one rule with the preview (public/js/overlay/color.js).
const COLOR = require('../public/js/overlay/color.js');
// (phase V65, block 5) A pattern's tiles - one rule with the preview (public/js/overlay/pattern.js).
const PAT = require('../public/js/overlay/pattern.js');
// (phase V84) A clip's effects - one rule with the preview (public/js/fx/params.js), told to ffmpeg frame by frame (lib/fx-render.js).
const FXP = require('../public/js/fx/params.js');
const FXR = require('./fx-render');
const path = require('path');

const FORMATS = { '9:16': { w: 1080, h: 1920 }, '16:9': { w: 1920, h: 1080 } };

const r2 = (v) => Math.round((+v || 0) * 100) / 100;
const r6 = (v) => (+v || 0).toFixed(6);

function frame(timeline) {
  const f = timeline && timeline.format;
  return FORMATS[f] || FORMATS['9:16'];
}

// Bottom layer first - the video lanes read backwards, because the list is held top layer
// first the way a timeline reads. Identical to _layers() in preview-b.js, deliberately.
function videoLanes(timeline) {
  const t = (timeline && timeline.tracks) || [];
  return t.filter(x => x.kind === 'video').slice().reverse();
}

function audioLanes(timeline) {
  const t = (timeline && timeline.tracks) || [];
  return t.filter(x => x.kind === 'audio');
}

function duration(timeline) {
  let end = 0;
  for (const tr of ((timeline && timeline.tracks) || [])) {
    for (const c of (tr.clips || [])) end = Math.max(end, (+c.start) + (+c.dur));
  }
  return r2(end);
}

const isStill = (src) => /\.(jpe?g|png|webp|avif|bmp)$/i.test(String(src || '').split('?')[0]);

// (phase V23) How long a sound fades in and out - its own fades and (phase V28.4) the crossing of two tracks of music
// that overlap on a lane: ONE rule, the preview's too (public/js/sound/fades.js, an ES module required here).
const { fadesOf } = require('../public/js/sound/fades.js');

// Every sound that will actually be heard. A clip at volume 0 is left out of the graph
// entirely rather than mixed at silence: a muted birol is the common case here, and feeding
// ffmpeg a stream that contributes nothing costs a decode per clip for no sound.
function audibleClips(timeline) {
  const out = [];
  for (const tr of audioLanes(timeline)) {
    const master = (tr.volume == null) ? 1 : +tr.volume;
    if (!(master > 0)) continue;
    for (const c of (tr.clips || [])) {
      const v = ((c.volume == null) ? 1 : +c.volume) * master;
      if (!(v > 0)) continue;
      out.push({ clip: c, gain: v });
    }
  }
  return out;
}

// HOW A CLIP MEETS A FRAME THAT IS NOT ITS SHAPE, and the second thing this file must agree
// with preview-b.js about. Fit keeps the whole picture and pads what is left over; fill covers
// the frame and loses the edges. Which edge survives is the clip's own choice, because when a
// 16:9 shot is forced into a 9:16 film the subject is rarely in the middle.
//
// THE BARS OF A FITTED CLIP ARE SEE-THROUGH when something is under it (`clear`), as on the
// preview, which draws the picture alone and lets the layer beneath show around it. They were
// black here, which covered the film under a wide picture in the file and nowhere else.
function fitChain(c, w, h, clear) {
  if (String(c.fit || 'fit') !== 'fill') {
    return `scale=${w}:${h}:force_original_aspect_ratio=decrease,` +
           `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black${clear ? '@0' : ''}`;
  }
  // Both axes are given and only one of them can do anything: after scaling to cover, the
  // frame matches the source on one side exactly, so that side's offset works out to zero
  // whatever was chosen. One list of five answers, no way to pick a contradiction.
  const a = String(c.cropAlign || 'center');
  const x = a === 'left' ? '0' : a === 'right' ? '(iw-ow)' : '(iw-ow)/2';
  const y = a === 'top' ? '0' : a === 'bottom' ? '(ih-oh)' : '(ih-oh)/2';
  return `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}:${x}:${y}`;
}

// ── A filled clip that FOLLOWS (phase V33.2) ─────────────────────────────────
// The clip's `frame` - its window over the FILE's time, worked out from its faces - read the way the preview reads it:
// public/js/framing/path.js is the one answer, its windowAt() for the screen and its expressions here. The window is
// cut out of the film FIRST, in the film's own pixels (crop with an expression of the time - `t` counts from the clip's
// trimIn, so the file's second is t+trimIn), and only then scaled to the frame: cheaper than scaling the whole film up
// to cover the frame and cutting it after, and the same picture.
// A clip with more than one kind of shot - a face here, no face there ((х7) Б: the whole frame by its width over a
// blurred copy of itself), two bands (х9) - has a branch for each, and the shots switch between them by time.
// Returns { parts, out } - the graph's lines and the label the rest of the clip's chain starts from - or null when the
// clip is framed the plain way (no record, or a film no wider than the frame).
// (phase V51) A cropped clip is never framed: the piece is the picture.
const isFramedClip = (c, w, h) => !!(c && String(c.fit || 'fit') === 'fill' && !isPlaced(c) && !CROP.active(c)
  && FRAMING.isFramed(c.frame) && c.frame.src && FRAMING.windowW(+c.frame.src.w, +c.frame.src.h, w / h) < 0.999);

// ── (phase V49.2) The punch-ins scaled ON THEIR SECONDS only ────────────────
// The owner's (пр36) а. A punch-in scales the window frame by frame (`scale ... eval=frame`), and that filter, told an
// expression of the time, builds its scaler again on every frame - with slice threads, 5 ms a frame (measured on E01's
// fragment 2: 4.9 s against 1.2 s for 30 s of picture) - although a punch-in lasts 2-3 s of a two-minute clip, and outside
// it the expression comes to exactly the plain scale (Z = 1: the same frames, bit for bit - checked by framemd5). So the
// window is split: every frame scaled the plain way, and only each punch-in's stretch (ZOOM_IN + its hold + ZOOM_OUT, with
// ZOOM_PAD either side, where Z is 1 again and the two ways give the same frame) scaled the punch-in's way and laid over
// it - the frames of one decode, their own times kept (no re-timing: V44's runs and the PiP read them after). The punch-in
// way's scaler is single-threaded: built again each frame it is cheaper so, and its frames are the same bit for bit.
// THE ZOOMED BRANCH HAS A FRAME AT LEAST EVERY ZOOM_KEEP s: overlay waits for its second input's next frame before it lets
// the first one go, and a branch silent for a minute would hold a minute of frames in memory. The frames that only keep
// it going are made see-through (alpha 0) and laid on nothing; overlay works only over the stretches (`enable`), and a
// frame inside one is the zoomed twin of the frame under it - so whichever moment overlay's switch is read at, the
// picture is the punch-in's where Z is not 1 and the plain one everywhere else.
const { ZOOM_OUT } = require('../public/js/framing/active.js');
const ZOOM_PAD = 0.1;       // s either side of a punch-in where its frames are still laid (Z is 1 there)
const ZOOM_DENSE = 0.25;    // s beyond that where the zoomed branch keeps every frame, see-through
const ZOOM_KEEP = 1;        // s at most between two frames of the zoomed branch

/** The FILE's stretches [[a, b], ...] where the clip's punch-ins scale (Z is not 1), padded, merged, and only those that
 *  reach into the file's span [s0, s1] the input reads. */
function zoomSpans(fr, s0, s1) {
  if (!FRAMING.hasZooms(fr)) return [];
  const out = [];
  for (const k of fr.zooms.slice().sort((a, b) => a.t0 - b.t0)) {
    const a = (+k.t0) - ZOOM_PAD, b = (+k.t1) + ZOOM_OUT + ZOOM_PAD;
    if (b < s0 - 0.5 || a > s1 + 0.5) continue;
    const l = out[out.length - 1];
    if (l && a <= l[1] + 2 * ZOOM_DENSE) l[1] = Math.max(l[1], b);
    else out.push([a, b]);
  }
  return out;
}

function framedChain(c, input, n, w, h, span) {
  if (!isFramedClip(c, w, h)) return null;
  const fr = c.frame;
  const sw = +fr.src.w, sh = +fr.src.h;
  const T = `(t+${r6(+c.trimIn || 0)})`;
  // The file's seconds the input reads: a clip's own, or (V44) a run's from its first piece to its last (`span`).
  const s0 = span ? +span[0] : (+c.trimIn || 0);
  const s1 = span ? +span[1] : s0 + (+c.dur || 0) * (+c.speed || 1);
  const kinds = FRAMING.kindsOf(fr);
  const parts = [];
  const tag = (k) => `fm${n}${k}`;
  const outs = [];
  parts.push(`[${input}]` + (kinds.length > 1 ? `split=${kinds.length}` + kinds.map((k) => `[${tag(k)}i]`).join('') : `null[${tag(kinds[0])}i]`));
  for (const k of kinds) {
    const i = `${tag(k)}i`, o = `${tag(k)}o`;
    if (k === 'face') {
      const x = FRAMING.exprFace(fr, T, sw, sh, w / h);
      // (phase V43) fragmentation's window is cut at its exact place, not rounded to an even pixel (block 0: a slow pan's jitter
      // 1.7 px of the frame -> 0.3), and PUNCHES IN where its record says: the window scaled by Z frame by frame and the frame
      // cut back out about (AX, AY) - under a pixel from the formula the preview draws by, and the frames keep their own times
      // (zoompan would re-time them - V44's runs of pieces would break).
      const exact = fr.active ? ':exact=1' : '';
      const win = `crop=w='trunc(ih*${w}/${h}/2)*2':h=ih:x='clip((${x})*iw-ow/2,0,iw-ow)':y=0${exact}`;
      const zm = FRAMING.exprZoom(fr, T);
      const zs = zm ? zoomSpans(fr, s0, s1) : [];
      if (!zs.length) {
        parts.push(`[${i}]${win},scale=${w}:${h},setsar=1[${o}]`);
      } else {
        // (V49.2) The punch-ins on their seconds: the plain window under, the zoomed one over it where it scales.
        const on = (pad) => zs.map(([a, b]) => `between(${T},${r6(a - pad)},${r6(b + pad)})`).join('+');
        const zoom = `scale=w='2*trunc(${w / 2}*${zm.Z})':h='2*trunc(${h / 2}*${zm.Z})':eval=frame:threads=1,` +
          `crop=w=${w}:h=${h}:x='${zm.AX}*(2*trunc(${w / 2}*${zm.Z})-${w})':y='${zm.AY}*(2*trunc(${h / 2}*${zm.Z})-${h})':exact=1`;
        parts.push(`[${i}]${win},split[${o}p][${o}z]`);
        parts.push(`[${o}p]scale=${w}:${h}[${o}pw]`);
        parts.push(`[${o}z]select='${on(ZOOM_DENSE)}+isnan(prev_selected_t)+gte(t-prev_selected_t,${ZOOM_KEEP})',${zoom},` +
          `format=yuva420p,lutyuv=y=val:u=val:v=val:a=0:enable='not(${on(0)})'[${o}zw]`);
        parts.push(`[${o}pw][${o}zw]overlay=0:0:enable='${on(ZOOM_DENSE)}':eof_action=pass,setsar=1[${o}]`);
      }
    } else if (k.startsWith('whole')) {
      const qw = Math.max(2, Math.round(w / 8) * 2), qh = Math.max(2, Math.round(h / 8) * 2);
      parts.push(`[${i}]split[${o}a][${o}b]`);
      parts.push(`[${o}a]scale=${qw}:${qh}:force_original_aspect_ratio=increase,crop=${qw}:${qh},boxblur=10:2,scale=${w}:${h},setsar=1[${o}bg]`);
      // (phase V33.8, (ф1)) A documentary shows the middle of the film's width - 3:2 of a 16:9 film -, not all of it:
      // FRAMING.wholeW, as the preview cuts it. 1 - the whole frame, as before. (phase V69 P12b) Each width of a 'whole' shot is a
      // branch of its own ('whole', 'whole1'... - a lecture's square and full width): FRAMING.wholeWOf.
      const ww = FRAMING.wholeWOf(fr, k, sw, sh);
      const cut = ww < 0.999 ? `crop=w='trunc(iw*${r6(ww)}/2)*2':h=ih:x='(iw-ow)/2':y=0,` : '';
      parts.push(`[${o}b]${cut}scale=${w}:-2,setsar=1[${o}fg]`);
      parts.push(`[${o}bg][${o}fg]overlay=0:(H-h)/2[${o}]`);
    } else if (k === 'bands') {
      const b1 = FRAMING.exprBand(fr, 1, T, sw, sh, w / h), b2 = FRAMING.exprBand(fr, 2, T, sw, sh, w / h);
      const half = Math.max(2, Math.round(h / 4) * 2);
      const crop = (b) => `crop=w='trunc(ih*${r6(b.bh)}*${2 * w}/${h}/2)*2':h='trunc(ih*${r6(b.bh)}/2)*2'` +
        `:x='clip((${b.x})*iw-ow/2,0,iw-ow)':y='clip((${b.y})*ih-oh/2,0,ih-oh)'`;
      parts.push(`[${i}]split[${o}1][${o}2]`);
      parts.push(`[${o}1]${crop(b1)},scale=${w}:${half},setsar=1[${o}t]`);
      parts.push(`[${o}2]${crop(b2)},scale=${w}:${h - half},setsar=1[${o}d]`);
      parts.push(`[${o}t][${o}d]vstack=2[${o}]`);
    } else if (k === 'cam') {
      // (phase V69 P12b, (хп82)) camera + game: the streamer's camera on top, a third of the frame (its window about the camera,
      // standing still in each shot), the game below, two thirds, from the film's middle at its full height - FRAMING.exprCam, as
      // the preview draws it (preview-b.js _place).
      const cm = FRAMING.exprCam(fr, T, sw, sh, w / h);
      const top = Math.max(2, Math.round(h / 3 / 2) * 2);
      parts.push(`[${i}]split[${o}1][${o}2]`);
      parts.push(`[${o}1]crop=w='trunc(iw*${r6(cm.cw)}/2)*2':h='trunc(ih*${r6(cm.ch)}/2)*2'` +
        `:x='clip((${cm.x})*iw-ow/2,0,iw-ow)':y='clip((${cm.y})*ih-oh/2,0,ih-oh)',scale=${w}:${top},setsar=1[${o}t]`);
      parts.push(`[${o}2]crop=w='trunc(iw*${r6(cm.gw)}/2)*2':h=ih:x='(iw-ow)/2':y=0,scale=${w}:${h - top},setsar=1[${o}d]`);
      parts.push(`[${o}t][${o}d]vstack=2[${o}]`);
    }
    outs.push([k, o]);
  }
  // The first kind is the base; each other one is laid over it while its shots run.
  let last = outs[0][1];
  for (const [k, o] of outs.slice(1)) {
    const on = FRAMING.spansOfKind(fr, k).map(([a, b]) => `between(${T},${r6(a)},${r6(b)})`).join('+') || '0';
    parts.push(`[${last}][${o}]overlay=0:0:enable='${on}'[${tag(k)}m]`);
    last = `${tag(k)}m`;
  }
  return { parts, out: last };
}

// ── An insert placed on the frame ───────────────────────────────────────────
// TX AND TY ARE THE CENTRE HERE, as fractions of the frame, and not the top-left corner the
// other editor stores. That is a deliberate divergence and it buys rotation: a turned
// rectangle is bigger than the one it came from, by an amount that depends on the source's
// aspect - which is not known when the graph is written. Anchored by the middle, the position
// is the same number before and after the turn, and overlay can be told it in terms of its own
// runtime width and height.
// PLACED IS `tw` HAVING A VALUE AT ALL, and not "smaller than the frame". Anchored by its
// middle, an insert as wide as the film - or wider - is still a placement: it can be moved off
// centre, turned, and hung over the edge, and the preview has a margin around the frame so that
// what hangs over can be seen. `tw: null` is the unplaced state, and the only one.
const isPlaced = (c) => !!(c && c.tw != null && +c.tw > 0);

// Soft edges, as an alpha ramp in from whichever edge is nearest. A hard edge is what makes an
// insert read as pasted on rather than as part of the shot.
//
// The width is a FRACTION of the insert's shorter side and is resolved inside the expression
// from geq's own W and H. A pixel count would mean one thing on a 1080-wide render and another
// on a 540-wide preview, and the two would disagree about the same number.
//
// geq evaluates per pixel and is not cheap, so it is absent from the chain entirely at zero.
function featherChain(v) {
  const fr = Math.max(0, Math.min(0.45, +v || 0));
  if (fr <= 0.001) return '';
  return `geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':`
       + `a='min(255,255*min(min(X,W-1-X),min(Y,H-1-Y))/max(1,${fr.toFixed(4)}*min(W,H)))'`;
}

// ── A main clip as a picture in the picture (phase V49, point 3) ─────────────
// The owner's (пр8)-(пр11): a clip of the MAIN lane (the bottom video lane) with `pip` on is the picture its frame shows - a
// filled clip's frame (its crop with its Keep side, or its window following the faces - still moving, still punching in), a
// fitted clip's whole picture - in a box of that shape: where and as big as it was (the whole frame, the fitted picture) until
// it is sized (`tw`, its width) or moved (`tx`/`ty`, its middle); its corners rounded (`radius`, a share of its shorter side),
// an outline inside its edge (`outline`, a share of the frame's width, in `outlineColor`) and its edge softened (`feather`),
// then turned (`angle`). THE ONE RULE public/js/merge-v3/preview-b.js draws by (_pipRect, _pipMasks, _drawPip).
const even = (v) => Math.max(2, Math.round(v / 2) * 2);
const pipNum = (v, hi) => { const x = +v; return Number.isFinite(x) && x > 0 ? Math.min(hi, x) : 0; };

// The box's edges as one expression of geq's X, Y, W and H (pixel centres): the distance to the nearest edge - round at a
// rounded corner - and from it the alpha (the soft edge, a hair of smoothing when hard) and the outline's share.
function pipEdges(c, w) {
  const fr = pipNum(c.feather, 0.45), rr = pipNum(c.radius, 0.5), ot = pipNum(c.outline, 0.05);
  const T = ot * w;
  if (fr <= 0.001 && rr <= 0.001 && T <= 0.05) return null;
  const R = `${r6(rr)}*min(W,H)`;
  const DX = `max(max(${R}-(X+0.5),(X+0.5)-(W-${R})),0)`, DY = `max(max(${R}-(Y+0.5),(Y+0.5)-(H-${R})),0)`;
  const E = `if(gt(${DX},0)*gt(${DY},0),${R}-hypot(${DX},${DY}),min(min(X+0.5,W-X-0.5),min(Y+0.5,H-Y-0.5)))`;
  const A = `clip((${E})/max(1,${r6(fr)}*min(W,H)),0,1)`;
  const col = /^#[0-9a-f]{6}$/i.test(String(c.outlineColor || '')) ? String(c.outlineColor) : '#ffffff';
  const rgb = [1, 3, 5].map((i) => parseInt(col.slice(i, i + 2), 16));
  return { A, ring: T > 0.05 ? `clip(${r6(T)}-(${E})+0.5,0,1)` : '', rgb };
}

// The box's edges laid on it: its alpha (and the outline over it) worked out ONCE, from its first frame - geq per pixel per
// frame would be slow - and laid on every frame (alphamerge and overlay keep the last frame of the short input).
function pipEdgeParts(box, n, c, w) {
  const ed = pipEdges(c, w);
  if (!ed) return { parts: [], out: box };
  const parts = [], t = `pe${n}`;
  // The format pinned BEFORE the split: left to negotiate, the branches settled on the mask's gray and the picture came out
  // without its colours.
  parts.push(`[${box}]format=yuva420p,split=${ed.ring ? 3 : 2}[${t}a][${t}b]` + (ed.ring ? `[${t}c]` : ''));
  parts.push(`[${t}b]trim=end_frame=1,format=gray,geq=lum='255*${ed.A}'[${t}m]`);
  parts.push(`[${t}a][${t}m]alphamerge[${t}q]`);
  if (!ed.ring) return { parts, out: `${t}q` };
  const [cr, cg, cb] = ed.rgb;
  parts.push(`[${t}c]trim=end_frame=1,format=rgba,geq=r='${cr}':g='${cg}':b='${cb}':a='255*${ed.A}*${ed.ring}'[${t}r]`);
  parts.push(`[${t}q][${t}r]overlay=0:0:format=auto[${t}o]`);
  return { parts, out: `${t}o` };
}

// ── A clip's crop (phase V51, point 1, the owner's (пр38)-(пр44)) ───────────
// `crop` - a piece of the FILE in shares of its width and height (public/js/framing/crop.js), cut FIRST, in the file's own
// pixels: past it the clip is drawn as if the file were the piece - in its box, at `tw` of the frame's width (its natural size,
// the piece fitted to the frame, until it is sized), its middle at `tx`/`ty`, turned by `angle`. The sides even, as yuv wants
// them; cut at the exact pixel (`exact`), as the preview draws a share of the frame.
function cropFilter(k) {
  return `crop=w='max(2,trunc(iw*${r6(k.w)}/2)*2)':h='max(2,trunc(ih*${r6(k.h)}/2)*2)':x='trunc(iw*${r6(k.x)})':y='trunc(ih*${r6(k.y)})':exact=1`;
}
// The piece scaled to its box: `tw` of the frame's width keeping its shape, or - not sized - fitted to the frame.
const cropGeom = (c, k, w, h) => cropFilter(k) + ',' + (isPlaced(c)
  ? `scale=${even(w * Math.max(0.02, Math.min(4, +c.tw)))}:-2:force_divisible_by=2`
  : `scale=${w}:${h}:force_original_aspect_ratio=decrease:force_divisible_by=2`);

// The PiP's own picture, before its edges: { parts, from, geom } - the graph's lines (a framed clip's own little graph), the
// label it starts from and the scaling that makes it the box.
function pipPicture(c, input, n, w, h, span) {
  // (phase V51) A cropped PiP is its piece - no fill, no framing.
  const k = CROP.active(c);
  if (k) return { parts: [], from: input, geom: cropGeom(c, k, w, h) };
  const fill = String(c.fit || 'fit') === 'fill';
  const plain = { ...c, tw: null, tx: null, ty: null, angle: null, pip: null };
  const framed = fill ? framedChain(plain, input, `${n}p`, w, h, span) : null;
  const sized = isPlaced(c);
  const tw = Math.max(0.02, Math.min(4, +c.tw || 1));
  let geom;
  if (fill) {
    const pw = sized ? even(w * tw) : w;
    geom = (framed ? '' : fitChain(plain, w, h, false) + ',') + `scale=${pw}:${even(pw * h / w)}`;
  } else {
    geom = sized ? `scale=${even(w * tw)}:-2:force_divisible_by=2`
      : `scale=${w}:${h}:force_original_aspect_ratio=decrease:force_divisible_by=2`;
  }
  return { parts: framed ? framed.parts : [], from: framed ? framed.out : input, geom };
}

// ── A halfer band ───────────────────────────────────────────────────────────
// A strip across the whole width of the frame instead of a picture on it: the source turned a
// quarter at a time, scaled to cover the strip, and the slice `halferKeep` names kept. The numbers
// and their defaults are the talking-head editor's Halfers lane, so a band
// brought over from there renders as it did:
//   halferThick  how tall, as a share of the frame (5-100, 40)
//   halferPos    where: 100 against the top edge, 0 against the bottom (100)
//   halferKeep   which slice survives the crop: 100 is the top at 0 and 180, the right at 90
//                and 270 (100)
//   rotation     0 / 90 / 180 / 270, clockwise (90 - a portrait source lies across the strip)
//   feather      the fade on the edges facing INTO the frame, as a share of the band (0.03)
// A band has no placement, framing or effects: it is always the full width, and the other
// editor's renderer never applied effects to one. THE THIRD THING THIS MUST AGREE WITH
// preview-b.js ABOUT - its _drawBand() reads every one of these the same way.
const isBand = (c) => !!(c && c.halfer);

const _pct = (v, dflt, lo = 0) => {
  const n = Number(v);
  return (v != null && Number.isFinite(n)) ? Math.max(lo, Math.min(100, n)) : dflt;
};

function bandGeom(c, w, h) {
  // Even: yuv420 and overlay both dislike an odd height.
  let band = Math.round(h * _pct(c.halferThick, 40, 5) / 100);
  if (band % 2) band++;
  band = Math.max(2, Math.min(h, band));
  const y = Math.round((h - band) * (1 - _pct(c.halferPos, 100) / 100));
  const keep = _pct(c.halferKeep, 100) / 100;
  const rot = [0, 90, 180, 270].includes(+c.rotation) && c.rotation != null ? +c.rotation : 90;
  // Null is the default softness and 0 is hard - the panel writes a number even at zero.
  const soft = (c.feather == null || !Number.isFinite(+c.feather)) ? 0.03 : Math.max(0, Math.min(0.4, +c.feather));
  const fade = soft > 0 ? Math.max(1, Math.round(band * soft)) : 0;
  // Only the edges that face into the picture: one while the band is parked against an edge,
  // both while it floats.
  return { band, y, keep, rot, fade, softTop: fade > 0 && y > 0, softBot: fade > 0 && y + band < h };
}

// The turn first, so a portrait source lies across the strip; then cover, keeping its shape;
// then the slice. Which way the slice slides depends on the turn - at 0 and 180 the spare is
// above and below, at 90 and 270 it is to the sides. rgba from end to end: the fade IS alpha.
function bandChain(b, w) {
  const turn = b.rot === 90 ? 'transpose=1,' : b.rot === 270 ? 'transpose=2,'
             : b.rot === 180 ? 'transpose=2,transpose=2,' : '';
  const off = (b.rot === 0 || b.rot === 180)
    ? `0:(ih-${b.band})*${(1 - b.keep).toFixed(4)}`
    : `(iw-${w})*${b.keep.toFixed(4)}:0`;
  const dTop = 'Y', dBot = `(${b.band - 1}-Y)`;
  const dist = b.softTop && b.softBot ? `min(${dTop},${dBot})` : b.softTop ? dTop : b.softBot ? dBot : '';
  return 'format=rgba,' + turn +
    `scale=${w}:${b.band}:force_original_aspect_ratio=increase,crop=${w}:${b.band}:${off},setsar=1` +
    (dist ? `,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='min(255,255*${dist}/${b.fade})'` : '');
}

// atempo changes speed without changing pitch, and refuses anything outside 0.5-2 in one go.
// So it is chained: 0.25x is two halvings, and the panel's whole range is covered by at most
// two stages. Resampling instead would drop the voice an octave.
function atempoChain(speed) {
  const out = [];
  let s = Math.max(0.25, Math.min(4, +speed || 1));
  while (s > 2.0001) { out.push('atempo=2'); s /= 2; }
  while (s < 0.4999) { out.push('atempo=0.5'); s *= 2; }
  if (Math.abs(s - 1) > 0.001) out.push('atempo=' + r6(s));
  return out;
}

// ═══ THE THREE EFFECTS ═══════════════════════════════════════════════════════
// Ported from the talking-head editor's renderer, value for value - `fade`, `zoom_in`, `vhs`
// and the rest are the names the inspector offers (js/merge-v3/controls.js).
//
// What is NOT carried over is the per-effect parameters. That editor lets a transition name
// its own duration and a vignette its own angle; this panel offers the name alone, so the
// defaults are baked in. When the parameters get a UI here they go in one place - these three
// functions - rather than into the clip chain.
const FD = 0.35;      // how long a paired transition takes at each end, seconds
const FPS = 30;

// Five stacked steps that approximate a ramp, in at the head and out at the tail. ffmpeg has
// no way to vary a filter's strength continuously over time, so the strength is stepped and
// each step is switched on for its slice of the clip.
function stackedRamp(D, st, maxValue, make) {
  const N = 5;
  const step = D / N;
  let out = '';
  for (let i = 0; i < N; i++) {
    out += make(maxValue * (1 - i / N), (i * step).toFixed(3), ((i + 1) * step).toFixed(3));
  }
  for (let i = 0; i < N; i++) {
    out += make(maxValue * ((i + 1) / N), (st + i * step).toFixed(3), (st + (i + 1) * step).toFixed(3));
  }
  return out;
}

// A slow push in or out over the whole clip. Rendered at twice the frame size and scaled back
// down: zoompan lands on sub-pixel offsets, and at full size that reads as a shake rather than
// a move.
//
// `alpha`: the clip carries transparency (a soft edge, a turn, the see-through bars of a fitted
// clip), and the chain has to stay in a format that has it - written into yuv420p it is thrown
// away silently and the edge comes back hard. Every effect filter here keeps an alpha plane
// through yuva420p except vignette, which is given it back (gradeChain).
const _fmtOf = (alpha) => (alpha ? 'yuva420p' : 'yuv420p');

function animChain(anim, dur, w, h, alpha) {
  if (anim !== 'zoom_in' && anim !== 'zoom_out') return '';
  const frames = Math.max(1, Math.ceil(dur * FPS));
  const max = 1.15;
  const P = `(on/${frames})`;
  const z = anim === 'zoom_in' ? `1+(${max.toFixed(4)}-1)*${P}` : `${max.toFixed(4)}-(${max.toFixed(4)}-1)*${P}`;
  return `zoompan=z='${z}':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':d=1:s=${2 * w}x${2 * h}:fps=${FPS},` +
         `scale=${w}:${h}:flags=lanczos,format=${_fmtOf(alpha)},setsar=1`;
}

// Colour and texture, no motion. Every one of these is a look applied to the whole clip.
// `tag` names the side branch vignette needs on a clip with transparency: vignette drops the alpha
// plane, so the plane is split off first and merged back after it. Both branches are pinned to
// yuva420p at the split and converted after it - left to negotiate, the split settled on the
// format vignette wanted and the alpha branch was handed a picture with no alpha in it.
function gradeChain(filt, alpha, tag) {
  const POST = `,format=${_fmtOf(alpha)},setsar=1`;
  switch (filt) {
    case 'vignette':
      if (alpha && tag) {
        return `split=2[${tag}c][${tag}a];[${tag}a]format=yuva420p,alphaextract[${tag}l];` +
               `[${tag}c]format=yuva420p,scale=iw:ih,format=yuv420p,vignette=angle=0.780:aspect=1.000,format=yuv420p[${tag}g];` +
               `[${tag}g][${tag}l]alphamerge${POST}`;
      }
      return `vignette=angle=0.780:aspect=1.000${POST}`;
    case 'sharpen':   return `unsharp=luma_msize_x=5:luma_msize_y=5:luma_amount=1.00${POST}`;
    // gamma_r down and gamma_b up is a warmer picture; the other way round is a colder one.
    case 'warm':      return `eq=gamma_r=0.850:gamma_b=1.150${POST}`;
    case 'cool':      return `eq=gamma_r=1.150:gamma_b=0.850${POST}`;
    case 'glitch':    return `noise=alls=30:allf=t+u,rgbashift=rh=3:bh=-3:edge=smear${POST}`;
    case 'bw':        return `hue=s=0.000,eq=contrast=1.000${POST}`;
    case 'vhs':       return `noise=alls=9:allf=t+u,rgbashift=rh=2:bh=-2:edge=smear,` +
                             `eq=saturation=0.875:gamma_r=1.050${POST}`;
    // Teal in the shadows, orange in the highlights - the grade every trailer is cut with.
    case 'cinematic': return `colorbalance=rs=-0.150:bs=0.150:rh=0.150:bh=-0.150${POST}`;
    case 'sepia':     return `colorchannelmixer=0.3930:0.7690:0.1890:0:0.3490:0.6860:0.1680:0:` +
                             `0.2720:0.5340:0.1310:0${POST}`;
    default:          return '';
  }
}

// PAIRED, not crossfaded: the effect happens at both ends of the same clip rather than
// between two of them. On a timeline where clips may sit anywhere - with gaps, overlapping,
// on four layers at once - there is no reliable "next clip" to cross into, and a transition
// that guessed at one would fire against whatever happened to follow.
//
// Returns a chain WITH a leading comma, or '' for none.
//
// `alpha`: a placed insert with transparency - a fade dissolves it rather than painting black over
// it. `clear`: the see-through bars of a fitted clip - a fade darkens the picture and leaves the
// bars alone (the preview's veil covers the picture's rectangle), but the format has to keep them.
function transChain(trans, dur, w, h, placed, alpha, clear) {
  if (!trans || trans === 'none') return '';
  // The two punches are zoompan, which re-bakes to the frame size - on a placed insert that is
  // not a punch, it is the insert jumping to full screen and back.
  if (placed && (trans === 'zoom-punch-in' || trans === 'zoom-punch-out')) return '';
  const d = Math.min(FD, dur / 3);
  const st = Math.max(0, dur - d);
  const ds = d.toFixed(3), sts = st.toFixed(3);

  switch (trans) {
    case 'fade':
    case 'fadewhite': {
      const c = trans === 'fadewhite' ? ':color=white' : '';
      // On something carrying its own transparency the fade works on the ALPHA: fading to black
      // would paint a black rectangle over the shot rather than letting the insert dissolve.
      const al = alpha ? ':alpha=1' : '';
      return `,fade=in:st=0:d=${ds}${c}${al},fade=out:st=${sts}:d=${ds}${c}${al}`;
    }
    case 'flash-white': {
      const al = alpha ? ':alpha=1' : '';
      return `,fade=in:st=0:d=${ds}:color=white${al},fade=out:st=${sts}:d=${ds}:color=white${al}`;
    }
    case 'blur':
      return stackedRamp(d, st, 20, (v, t0, t1) =>
        `,gblur=sigma=${v.toFixed(2)}:enable='between(t\\,${t0}\\,${t1})'`);
    // A whip is motion blur along one axis: heavy one way, barely anything the other.
    case 'whip-pan-h':
      return stackedRamp(d, st, 30, (v, t0, t1) =>
        `,gblur=sigma=${v.toFixed(2)}:sigmaV=5:enable='between(t\\,${t0}\\,${t1})'`);
    case 'whip-pan-v':
      return stackedRamp(d, st, 30, (v, t0, t1) =>
        `,gblur=sigma=5:sigmaV=${v.toFixed(2)}:enable='between(t\\,${t0}\\,${t1})'`);
    case 'zoom-punch-in':
    case 'zoom-punch-out': {
      // zoompan counts FRAMES - it has `on` and no `t` - so the seconds are converted.
      const zf = 1.2, dF = Math.max(1, Math.round(d * FPS)), stF = Math.max(0, Math.round(st * FPS));
      const z = trans === 'zoom-punch-in'
        ? `if(lt(on\\,${dF})\\,${zf.toFixed(3)}-(${zf.toFixed(3)}-1)*on/${dF}\\,1)`
        : `if(gt(on\\,${stF})\\,1+(${zf.toFixed(3)}-1)*(on-${stF})/${dF}\\,1)`;
      return `,zoompan=z='${z}':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':d=1:s=${2 * w}x${2 * h}:fps=${FPS},` +
             `scale=${w}:${h}:flags=lanczos,format=${_fmtOf(alpha || clear)},setsar=1`;
    }
    case 'glitch':
      return stackedRamp(d, st, 38, (v, t0, t1) =>
        `,noise=alls=${Math.round(v)}:allf=t+u:enable='between(t\\,${t0}\\,${t1})'`);
    default:
      return '';
  }
}

const named = (v) => (v && v !== 'none' ? String(v) : '');

// THE EFFECTS ARE OFF (phase V49, point 5, the owner's (пр14) а: "убираем эти параметры (transition, animation и filter). эти
// штуки я добавлю в другой фазе"). After cut silence a lane is 20-30 pieces a minute: a transition played at both ends of every
// piece, a zoom started again on each, and a piece with an effect stopped being part of its run (pieceRun) - decoded alone.
// No longer offered (js/merge-v3/inspector.js); what a project already has of them stays in its file and is rendered as none,
// as the preview draws it (js/merge-v3/fx-b.js EFFECTS_ON). The three chains below are kept for the phase that brings them back.
const EFFECTS_ON = false;
const effectOf = (v) => (EFFECTS_ON ? named(v) : '');

// ── Pieces of one file as one input (phase V44) ─────────────────────────────
// Cut silence leaves a clip in pieces laid end to end - 20-30 a minute. Each clip its own input decoded ffmpeg's whole way
// (measured on 29 pieces of a 66 s 1080p film: 28.8 s and 6.2 GB of memory, against 13.9 s and 1.05 GB uncut), so a RUN of
// pieces - one after another on a lane, one file going forwards with at most RUN_GAP of it left out between two, the same
// look - is ONE input: its frames of the pieces' windows picked out (select) and each moved to its place (setpts) - 13.4 s
// and 0.96 GB, the same picture. Only a clip as plain as a cut piece is: not a still, a band, reversed or sped, and with
// no animation, transition or grade (their fps and their clocks count from a clip's own start). The SOUND stays one input
// per clip - small to decode, and each piece fades at its own seams (js/sound/fades.js).
const RUN_GAP = 10;               // s of the file at most between two pieces of a run
// (phase V49) A PiP's switch and look too: a run of pieces all PiP'd alike stays one input.
// (phase V51) And its crop: pieces cropped by one frame stay one input.
// (phase V65) Their opacity and blend mode too - a run is laid with its first piece's. (phase V75) And their colour.
const RUN_LOOK = ['src', 'fit', 'cropAlign', 'tx', 'ty', 'tw', 'angle', 'feather', 'rotation', 'frame',
  'pip', 'radius', 'outline', 'outlineColor', 'crop', 'opacity', 'blend', 'color'];
// (phase V84) A clip with effects of its own is decoded alone: its effects are laid on its own layer.
const _plainPiece = (c) => !!c && !!c.src && !isStill(c.src) && !c.reversed && (+c.speed || 1) === 1 && !isBand(c)
  && !effectOf(c.animation) && !effectOf(c.transition) && !effectOf(c.filter) && !FXP.hasFx(c);
const _sameLook = (a, b) => RUN_LOOK.every((k) => JSON.stringify(a[k] == null ? null : a[k]) === JSON.stringify(b[k] == null ? null : b[k]));

/** The run of pieces of one file that starts at clips[i] (two at least), or null. */
function pieceRun(clips, i) {
  const a = clips[i];
  if (!_plainPiece(a)) return null;
  const run = [a];
  for (let j = i + 1; j < clips.length; j++) {
    const p = run[run.length - 1], b = clips[j];
    if (!_plainPiece(b) || !_sameLook(a, b)) break;
    if (Math.abs((+p.start) + (+p.dur) - (+b.start)) > 0.011) break;
    const left = (+b.trimIn || 0) - ((+p.trimIn || 0) + (+p.dur));
    if (left < -0.001 || left > RUN_GAP) break;
    run.push(b);
  }
  return run.length > 1 ? run : null;
}
// How much of the file a run reads, from its first piece's start.
const runSpan = (run) => { const l = run[run.length - 1]; return (+l.trimIn || 0) + (+l.dur) - (+run[0].trimIn || 0); };
// The frames of the pieces' windows - in the input's own seconds, which start at the first piece.
const runSelect = (run) => run.map((c) => {
  const a = (+c.trimIn || 0) - (+run[0].trimIn || 0);
  return `gte(t,${r6(a)})*lt(t,${r6(a + (+c.dur))})`;
}).join('+');
// How far each frame moves: a frame of piece k, at T of the input, lands at the piece's start + (T - its window's start).
function runOffset(run) {
  const ss = +run[0].trimIn || 0;
  let off = '';
  for (let k = run.length - 1; k >= 0; k--) {
    const c = run[k];
    const a = (+c.trimIn || 0) - ss;
    const o = r6((+c.start) - a);
    off = k === run.length - 1 ? String(o) : `if(lt(T,${r6(a + (+c.dur))}),${o},${off})`;
  }
  return off;
}

// The bed's frame rate: the export's (24, 25, 30, 50, 60), or (phase V49.2) a merge's at its source's rate - a whole number
// or a fraction such as 24000/1001 (lib/merge-clips.js). Anything else is 30.
function bedRate(v) {
  if ([24, 25, 30, 50, 60].includes(+v)) return +v;
  const m = /^(\d{1,6})(?:\/(\d{1,6}))?$/.exec(String(v == null ? '' : v));
  const fps = m ? (+m[1]) / (m[2] ? +m[2] : 1) : 0;
  return fps >= 10 && fps <= 120 ? (m[2] ? `${m[1]}/${m[2]}` : +m[1]) : 30;
}

/**
 * Turn a blank project's timeline into an ffmpeg graph.
 * @param opts.assPath  a written .ass file to burn over the picture, or nothing
 * @param opts.out     { w, h } - the size the file is written at, when it is smaller than the frame
 * @param opts.fps      the frame rate of the black bed the layers are laid onto (bedRate)
 * @param opts.silent   sources known to have no sound (lib/mv3b-job.js asks the files): a clip
 *                      of one is left out of the mix, because ffmpeg refuses a graph that
 *                      names an audio stream a file does not have
 * Returns { w, h, dur, inputs, filter, map } - inputs in the order ffmpeg must be given them; an
 * input is a file ({ file, ss, t, loop }) or something ffmpeg makes ({ lavfi, t }). There is always
 * a sound: silence when nothing is heard, so every render joins a black tail the same way.
 */
function buildGraph(timeline, opts) {
  const { w, h } = frame(timeline);
  const dur = duration(timeline);
  const inputs = [];
  const parts = [];
  // (phase V84) The effects' sendcmd files - written by lib/mv3b-job.js before ffmpeg runs, removed after it.
  const fxFiles = [];

  // The bed everything is laid onto: one black frame of the project's shape, held for the
  // whole length. Built rather than taken from a clip, so a timeline with a gap at the start
  // - or no picture at all - still renders something of the right size instead of failing.
  const bedFps = bedRate(opts && opts.fps);
  parts.push(`color=c=black:s=${w}x${h}:d=${r6(dur)}:r=${bedFps}[bg]`);
  let last = 'bg';

  let n = 0;
  // Every clip painted so far, as a stretch of time - what a fitted clip's bars would cover.
  const painted = [];
  const under = (c) => painted.some(p => p.s < (+c.start) + (+c.dur) - 1e-6 && p.e > (+c.start) + 1e-6);
  // (phase V49) The bottom video lane is main: a clip of it may be a PiP.
  const mainLane = videoLanes(timeline)[0] || null;
  // (phase V74, the owner's (пт1)-(пт3)) THE PATTERNS OF MAIN VIDEO - over every video lane, under the words: laid after the
  // lanes as one more layer of clips, the bottom pattern first, each over the whole of main video (overlay/pattern.js layersOf),
  // by the pattern's way below - its tiles baked by lib/pattern-bake.js -, its opacity and blend mode as a clip's above main.
  const layers = PAT.layersOf(timeline);
  const laneList = videoLanes(timeline).concat(layers.length ? [{ id: 'patterns', kind: 'video', clips: layers }] : []);
  for (const lane of laneList) {
    const clips = lane.clips || [];
    const onMain = lane === mainLane;
    for (let i = 0; i < clips.length; i++) {
      // (phase V44) PIECES OF ONE FILE AS ONE INPUT (pieceRun): the run is laid as one clip over its whole time, its picture
      // the pieces' windows of the file picked out of one decode and moved each to its place.
      const run = pieceRun(clips, i);
      let c = clips[i];
      if (run) {
        const last = run[run.length - 1];
        c = { ...c, dur: Math.round(((+last.start) + (+last.dur) - (+c.start)) * 1e6) / 1e6 };
        i += run.length - 1;
      }
      const still = isStill(c.src);
      const idx = inputs.length;
      // (phase V65, block 5; phase V74 - a pattern of main video, on the layer laid after the lanes) A pattern: the tiles
      // lib/pattern-bake.js laid out for it (prepare() bakes them, by its layer id) stand for its file.
      const pb = !run && opts && opts.patterns ? opts.patterns.get(c.id) || null : null;
      inputs.push(pb ? { file: pb.src, loop: true, t: r2(c.dur) }
        : still
        ? { file: c.src, loop: true, t: r2(c.dur) }
        : run ? { file: c.src, ss: r2(run[0].trimIn || 0), t: r2(runSpan(run)) }
          : { file: c.src, ss: r2(c.trimIn || 0), t: r2((c.dur || 0) * (c.speed || 1)) });
      let input = `${idx}:v`;
      // (V49.2) The file's seconds this input reads - where a punch-in may scale (framedChain).
      const span = run ? [+run[0].trimIn || 0, (+run[0].trimIn || 0) + runSpan(run)] : null;
      if (run) {
        parts.push(`[${idx}:v]select='${runSelect(run)}'[rs${n}]`);
        input = `rs${n}`;
      }
      // (phase V75, the owner's (кп5)) ITS COLOUR CORRECTION FIRST, on the file's picture - before it is framed, cropped,
      // blurred behind a PiP or placed - by the preview's own rule (public/js/overlay/color.js). Nothing on a neutral clip.
      const cc = pb ? '' : COLOR.ffOf(c);
      if (cc) {
        parts.push(`[${input}]${cc}[cc${n}]`);
        input = `cc${n}`;
      }

      const speed = +c.speed || 1;
      const tag = `v${n++}`;
      // (phase V65, (пз5), (пз6)) A clip seen in part: its whole picture made first, its alpha scaled LAST, just before it is
      // laid over what is under it (on main: the black bed) - the preview lays the clip's own layer at that opacity
      // (preview-b.js _showAs). Nothing is added to a clip fully seen.
      const op = LOOK.opacityOf(c);
      const seeAll = op < 1 ? `,format=yuva420p,lutyuv=a=val*${r6(op)}` : '';
      // (phase V84) A clip with EFFECTS: they work on its layer - the picture as it lies in the frame - after its colour
      // correction and before its opacity and blend mode (lib/fx-render.js; the preview's preview-b.js _showAs), so its opacity
      // comes after them. Never on a pattern or a band (the inspector offers none there).
      const fxOn = !pb && !isBand(c) && FXP.hasFx(c) && !!(opts && opts.fxDir) && FXR.spansOf(c).length > 0;
      const see = fxOn ? '' : seeAll;
      // (phase V65, (пз7), (пз10)) THE LAST STEP OF A CLIP: laid over what is under it (`at`) while it lasts - straight, as
      // ever, or - a clip of a lane above main with a blend mode - BLENDED: put on a transparent frame where it would be
      // laid, that frame blended with what is under it by ffmpeg's `blend` in RGB (what is under it FIRST: the W3C formulas
      // the canvas follows read the backdrop - public/js/overlay/look.js), the result laid over it by the clip's alpha (its
      // opacity in it); `add` adds the clip's colour times its alpha straight. The preview lays the clip's layer with the
      // canvas's own mode (preview-b.js _showAs). `auto` - the clip carries an alpha of its own.
      const mode = onMain ? null : LOOK.blendOf(c);
      // One overlay of the clip's picture onto what is under it, while `enable` (an ffmpeg expression in t) is true.
      const layOne = (src, at, auto, enable, tail, sfx) => {
        const k = n + (sfx || '');
        const en1 = `enable='${enable}'`;
        if (!(mode && mode.ff)) {
          parts.push(`[${last}][${src}]overlay=${at}:${en1}` + (auto || see || seeAll ? ':format=auto' : '') + (tail || '') + `[o${k}]`);
        } else if (mode.premultiplied) {
          parts.push(`color=c=black@0:s=${w}x${h}:r=${bedFps}:d=${r6(dur)},format=yuva420p[bz${k}]`);
          parts.push(`[bz${k}][${src}]overlay=${at}:${en1}:format=auto${tail || ''},format=gbrap,premultiply=inplace=1,format=gbrp[bp${k}]`);
          parts.push(`[${last}]format=gbrp[ba${k}]`);
          parts.push(`[ba${k}][bp${k}]blend=all_mode=${mode.ff}:${en1},format=yuv420p[o${k}]`);
        } else {
          parts.push(`color=c=black@0:s=${w}x${h}:r=${bedFps}:d=${r6(dur)},format=yuva420p[bz${k}]`);
          parts.push(`[bz${k}][${src}]overlay=${at}:${en1}:format=auto${tail || ''},format=gbrap,split[bc${k}][bm${k}]`);
          parts.push(`[bc${k}]format=gbrp[bp${k}]`);
          parts.push(`[bm${k}]alphaextract[bk${k}]`);
          parts.push(`[${last}]split[ba${k}][bu${k}]`);
          parts.push(`[ba${k}]format=gbrp[bb${k}]`);
          parts.push(`[bb${k}][bp${k}]blend=all_mode=${mode.ff}:${en1}[bl${k}]`);
          parts.push(`[bl${k}][bk${k}]alphamerge[bx${k}]`);
          parts.push(`[bu${k}][bx${k}]overlay=x=0:y=0:format=auto[o${k}]`);
        }
        last = `o${k}`;
      };
      // `framed` - the picture handed in is the frame's size (laid at 0, 0); else it is the clip's box, laid at `at`.
      const lay = (src0, at0, auto0, framed) => {
        const clipOn = `between(t,${r6(c.start)},${r6((+c.start) + (+c.dur))})`;
        if (!fxOn) { layOne(src0, at0, auto0, clipOn); return; }
        // (phase V84) THE EFFECTS, on the clip's LAYER - and, as the punch-ins (V49.2), ONLY ON THEIR SECONDS: the picture is
        // split; the plain one is laid as ever outside the effects' stretches, and the effects' chain (lib/fx-render.js) gets
        // only the frames of the stretches - and one a second, see-through, which keeps the overlay from holding the frames
        // back while it waits (ZOOM_KEEP) - a box first laid on a transparent frame; zoomed about the clip's middle, coloured,
        // cut into blocks, its opacity last; laid as a frame-sized picture with an alpha over the stretches. Measured
        // 2026-11-10: every frame through the chain made a 60 s clip with Heartbeat 5x slower to render than without it.
        const on = FXR.spansOf(c).map(([a, b]) => `between(t,${r6(a)},${r6(b)})`).join('+') || '0';
        const keep = `${on}+isnan(prev_selected_t)+gte(t-prev_selected_t,${ZOOM_KEEP})`;
        parts.push(`[${src0}]split[fp${n}][fq${n}]`);
        parts.push(`[fq${n}]fps=${bedFps},select='${keep}'[fs${n}]`);
        let layer = `fs${n}`;
        if (!framed) {
          parts.push(`color=c=black@0:s=${w}x${h}:r=${bedFps}:d=${r6(c.dur)},format=yuva420p,setpts=PTS-STARTPTS+${r6(c.start)}/TB,` +
            `fps=${bedFps},select='${keep}'[fz${n}]`);
          parts.push(`[fz${n}][${layer}]overlay=${at0}:format=auto:eof_action=pass[fl${n}]`);
          layer = `fl${n}`;
        }
        const cmdPath = path.join(opts.fxDir, `fx_${opts.fxTag || 'r'}_${n}.cmd`);
        const fx = FXR.fxChain(c, n, layer, { w, h, fps: bedFps, main: onMain, cmdPathEsc: escapeFilterPath(cmdPath),
          see: `,lutyuv=a=0:enable='not(${on})'` + seeAll, assets: opts.fxAssets || {}, nextInput: inputs.length, select: keep });
        let fxOut;
        if (fx) {
          parts.push(...fx.parts);
          inputs.push(...fx.inputs);
          fxFiles.push({ path: cmdPath, text: fx.cmd });
          fxOut = fx.out;
        } else {
          parts.push(`[${layer}]format=yuva420p,lutyuv=a=0:enable='not(${on})'${seeAll}[fn${n}]`);
          fxOut = `fn${n}`;
        }
        let plain = `fp${n}`;
        if (seeAll) { parts.push(`[fp${n}]null${seeAll}[fpo${n}]`); plain = `fpo${n}`; }
        layOne(plain, at0, auto0 || !!seeAll, `${clipOn}*not(${on})`);
        layOne(fxOut, 'x=0:y=0', true, on, ':eof_action=pass', 'f');
      };
      const covers = under(c);
      painted.push({ s: +c.start, e: (+c.start) + (+c.dur) });
      // (phase V65, block 5, (пз8), (пз16), (пз17)) A PATTERN: its tiles over the whole frame (lib/pattern-bake.js laid them out,
      // public/js/overlay/pattern.js the rule the preview draws by). Still - the baked frame as it is; rotate - the baked
      // square turned about its middle by the layer's own seconds (the timeline's) and the frame cut from its middle; drift - a
      // window slid over the square by those seconds, wrapping by a tile (the tiles repeat), turned by the angle, the frame cut.
      // The drift's way on the screen is turned back into the tiles' own (the turn comes after it). Then opacity and blend
      // as any clip's.
      if (pb) {
        const f = pb.f;
        let ch = `[${input}]fps=${bedFps},format=rgba`;
        if (pb.mode === 'rotate') {
          const spd = (f.dir === 'ccw' ? -1 : 1) * f.speed;
          ch += `,rotate=a='(${r6(f.angle)}+${r6(spd)}*t)*PI/180':ow=${pb.side}:oh=${pb.side}:c=none` +
            `,crop=${w}:${h}:${(pb.side - w) / 2}:${(pb.side - h) / 2}`;
        } else if (pb.mode === 'drift') {
          const v = PAT.driftVelocity(f, w, h);
          const th = f.angle * Math.PI / 180;
          const ux = v.vx * Math.cos(th) + v.vy * Math.sin(th), uy = -v.vx * Math.sin(th) + v.vy * Math.cos(th);
          const D = pb.side - 2 * pb.tile, T = pb.tile;
          ch += `,crop=${D}:${D}:x='${T}-mod(${r6(ux)}*t\\,${T})':y='${T}-mod(${r6(uy)}*t\\,${T})'` +
            (f.angle ? `,rotate=${r6(th)}:ow=${D}:oh=${D}:c=none` : '') +
            `,crop=${w}:${h}:${(D - w) / 2}:${(D - h) / 2}`;
        }
        parts.push(ch + `,setsar=1,format=yuva420p,setpts=PTS-STARTPTS+${r6(c.start)}/TB${see}[${tag}]`);
        lay(tag, 'x=0:y=0', true, true);
        continue;
      }
      if (isBand(c)) {
        const b = bandGeom(c, w, h);
        parts.push(
          `[${input}]` +
          (!still && c.reversed ? 'reverse,' : '') +
          (speed !== 1 ? `setpts=${r6(1 / speed)}*PTS,` : '') +
          bandChain(b, w) + ',' +
          `setpts=PTS-STARTPTS+${r6(c.start)}/TB${see}[${tag}]`
        );
        lay(tag, `x=0:y=${b.y}`, true, false);
        continue;
      }
      // (phase V49, point 3) A MAIN clip as a picture in the picture: its frame's picture in its box, its edges, its turn -
      // laid over the same clip covering the frame and blurred (as framing's "whole" makes its background), the two one
      // picture of the frame's size, put at the clip's moment as any clip is.
      if (onMain && c.pip) {
        const timing = (!still && c.reversed ? ',reverse' : '') + (speed !== 1 ? `,setpts=${r6(1 / speed)}*PTS` : '');
        parts.push(`[${input}]format=yuv420p,split[pg${n}a][pg${n}b]`);
        const qw = Math.max(2, Math.round(w / 8) * 2), qh = Math.max(2, Math.round(h / 8) * 2);
        // (phase V51, (пр41а)) A cropped one's blur is made of its piece (framing/crop.js BLUR_FROM_PIECE).
        const bgCut = CROP.BLUR_FROM_PIECE && CROP.active(c) ? cropFilter(CROP.active(c)) + ',' : '';
        parts.push(`[pg${n}a]${bgCut}scale=${qw}:${qh}:force_original_aspect_ratio=increase,crop=${qw}:${qh},boxblur=10:2,` +
          `scale=${w}:${h},setsar=1${timing}[pgk${n}]`);
        const pic = pipPicture(c, `pg${n}b`, n, w, h, span);
        parts.push(...pic.parts);
        parts.push(`[${pic.from}]${pic.geom},setsar=1${timing}[pb${n}]`);
        const ed = pipEdgeParts(`pb${n}`, n, c, w);
        parts.push(...ed.parts);
        const pa = +c.angle || 0;
        parts.push(`[${ed.out}]format=yuva420p` +
          (pa ? `,rotate=${r6(pa * Math.PI / 180)}:c=none:ow='hypot(iw\,ih)':oh='hypot(iw\,ih)'` : '') + `[pf${n}]`);
        const sized = isPlaced(c);
        const px = Math.round(w * Math.max(0, Math.min(1, sized && c.tx != null ? +c.tx : 0.5)));
        const py = Math.round(h * Math.max(0, Math.min(1, sized && c.ty != null ? +c.ty : 0.5)));
        parts.push(`[pgk${n}][pf${n}]overlay=x='${px}-w/2':y='${py}-h/2':format=auto,format=yuv420p,` +
          (run ? `setpts='PTS+(${runOffset(run)})/TB'${see}[${tag}]` : `setpts=PTS-STARTPTS+${r6(c.start)}/TB${see}[${tag}]`));
        lay(tag, 'x=0:y=0', false, true);
        continue;
      }
      // (phase V51, point 1, (пр42)) A CROPPED clip off main's PiP - a lane above main: its piece in its box over the lanes
      // under it, NO blur behind it, its edges by the PiP's own rule (soft edge, corners, outline), turned, put by its middle.
      const ck = CROP.active(c);
      if (ck) {
        const timing = (!still && c.reversed ? ',reverse' : '') + (speed !== 1 ? `,setpts=${r6(1 / speed)}*PTS` : '');
        parts.push(`[${input}]${cropGeom(c, ck, w, h)},setsar=1${timing}[cb${n}]`);
        const ed = pipEdgeParts(`cb${n}`, n, c, w);
        parts.push(...ed.parts);
        const ca = +c.angle || 0;
        parts.push(`[${ed.out}]format=yuva420p` +
          (ca ? `,rotate=${r6(ca * Math.PI / 180)}:c=none:ow='hypot(iw,ih)':oh='hypot(iw,ih)'` : '') + ',' +
          (run ? `setpts='PTS+(${runOffset(run)})/TB'${see}[${tag}]` : `setpts=PTS-STARTPTS+${r6(c.start)}/TB${see}[${tag}]`));
        const sized = isPlaced(c);
        const cx = Math.round(w * Math.max(0, Math.min(1, sized && c.tx != null ? +c.tx : 0.5)));
        const cy = Math.round(h * Math.max(0, Math.min(1, sized && c.ty != null ? +c.ty : 0.5)));
        lay(tag, `x='${cx}-w/2':y='${cy}-h/2'`, true, false);
        continue;
      }
      const placed = isPlaced(c);
      const angle = placed ? (+c.angle || 0) : 0;
      const soft = placed ? featherChain(c.feather) : '';
      // See-through bars on a fitted clip, but only over something: over the black bed they would
      // be black anyway, and the plain path is the faster one.
      const clear = !placed && String(c.fit || 'fit') !== 'fill' && covers;
      // Anything with a transparent edge has to be carried in a format that HAS one, and
      // blended by an overlay told to pick one. Written into yuv420p the ramp is thrown away
      // silently, and the insert comes back with the hard edge it was given a feather to lose.
      const alpha = !!(soft || angle || clear);
      // THE EFFECTS GO BEFORE THE CLIP IS PLACED. Every one of them is written against the
      // clip's own clock - a fade at 0, a zoom counted in frames from the start - and the
      // shift at the end of this chain moves that clock to where the clip sits on the
      // timeline. Applied after it, a fade-in would happen at the start of the FILM instead
      // of the start of the clip.
      // zoompan re-bakes its output to the frame size, which would throw a placed insert back
      // to full screen - so the two zooms are not offered to one. The grade and the fades are
      // fine at any size, and a fade over something with an edge fades the EDGE too.
      // (phase V49) While the effects are off (EFFECTS_ON) the three are none, whatever the clip says.
      const anim  = placed ? '' : animChain(effectOf(c.animation), +c.dur || 0, w, h, alpha);
      const grade = gradeChain(effectOf(c.filter), alpha, `g${n}`);
      const trans = transChain(effectOf(c.transition), +c.dur || 0, w, h, placed, !!(soft || angle), clear);
      // Only when something needs it: fps normalises the frame timing the effects count in,
      // and a clip with no effects is left exactly as it rendered before they existed.
      const fx = (anim || grade || trans) ? `fps=${FPS},` : '';
      // Reverse before the timing, so what follows places an already-reversed clip at its
      // moment. Never on a still: there is one frame, and reversing it would buffer thirty
      // copies of it a second to arrive back where it started.
      // A PLACED insert is scaled to its own width and keeps its shape; only a full-frame clip
      // is fitted or filled against the frame.
      const pw = placed ? Math.max(2, Math.round(w * Math.max(0.02, Math.min(4, +c.tw)) / 2) * 2) : 0;
      // (phase V33.2) A filled clip that follows its faces is framed by its own little graph first.
      const framed = placed ? null : framedChain(c, input, n, w, h, span);
      if (framed) parts.push(...framed.parts);
      const geom = placed
        ? `scale=${pw}:-2:force_divisible_by=2,setsar=1`
        : framed ? 'setsar=1' : fitChain(c, w, h, clear);

      parts.push(
        `[${framed ? framed.out : input}]` +
        (alpha ? 'format=yuva420p,' : '') +
        `${geom},` +
        (!still && c.reversed ? 'reverse,' : '') +
        (speed !== 1 ? `setpts=${r6(1 / speed)}*PTS,` : '') +
        (soft ? soft + ',' : '') +
        // The turn comes after the feather, which is measured against the insert's own edges,
        // and it grows the box to a square big enough for any angle - c=none fills the corners
        // with nothing rather than with black.
        (angle ? `rotate=${r6(angle * Math.PI / 180)}:c=none:ow='hypot(iw\,ih)':oh='hypot(iw\,ih)',` : '') +
        fx + (anim ? anim + ',' : '') + (grade ? grade + ',' : '') +
        // trans already carries its leading comma, and lands last: a fade has to be the final
        // word on a frame or the grade after it would lift the black back out again.
        (trans ? trans.slice(1) + ',' : '') +
        (run ? `setpts='PTS+(${runOffset(run)})/TB'${see}[${tag}]` : `setpts=PTS-STARTPTS+${r6(c.start)}/TB${see}[${tag}]`)
      );
      // Positioned by its MIDDLE, in overlay's own w and h - which is what makes the turn above
      // free: whatever size the rotation made the box, its centre lands where it was put.
      // Zero is a place - the middle on the frame's edge - and not "no place": `|| 0.5` sent an insert
      // dragged hard against the left or top edge back to the centre of the file.
      const at = placed
        ? `x='${Math.round(w * Math.max(0, Math.min(1, c.tx == null ? 0.5 : +c.tx)))}-w/2':` +
          `y='${Math.round(h * Math.max(0, Math.min(1, c.ty == null ? 0.5 : +c.ty)))}-h/2'`
        : 'x=0:y=0';
      lay(tag, at, alpha, !placed);
    }
  }

  // (phase V75) The colour correction over the whole picture went with the render window's sliders: it is each clip's now,
  // made on its input above (the owner's (кп6): a project's old values are not read).

  // CAPTIONS LAST, over every layer. They are not a layer themselves - nothing is ever laid
  // on top of the words - so they are burnt onto the finished picture rather than overlaid at
  // a moment, which is also why the file needs no `enable`: each line carries its own times.
  const assPath = opts && opts.assPath;
  if (assPath) {
    // The shipped fonts (phase K5): libass draws in them rather than in whatever Windows has.
    parts.push(`[${last}]ass=filename=${escapeFilterPath(assPath)}:fontsdir=${escapeFilterPath(CAPTION_FONTS_DIR)}[vsub]`);
    last = 'vsub';
  }

  // A SMALLER FILE, scaled last - after the captions, which are laid out for the frame.
  const out = opts && opts.out;
  if (out && (out.w !== w || out.h !== h)) {
    parts.push(`[${last}]scale=${out.w}:${out.h}:flags=lanczos,setsar=1[vout]`);
    last = 'vout';
  }

  // Sound. Each audible clip is delayed to its place and mixed; the mix is normalised off,
  // because amix would otherwise quieten every clip as more are added and a level set by hand
  // would stop meaning what it says.
  // (phase V49.1) EVERY CLIP IS STEREO FIRST, before anything else is done to it: `aformat` has ffmpeg fold a file of more
  // channels into two by its standard rule (5.1: the centre and the rears at -3 dB into each side, the LFE left out - what
  // `-ac 2` at the end did to the whole mix) and spread a mono one over both. The delay names two channels (`<ms>|<ms>`),
  // and a 5.1 piece kept its other four at 0 s of the film - a highlights fragment cut from a 5.1 track had every piece's
  // speech (the centre) piled at the start of a render or a merge. Mono and stereo sound as they did; amix gets the same
  // kind of input every time.
  const aTags = [];
  const silent = (opts && opts.silent) || null;
  const FADES = fadesOf(timeline);
  for (const { clip, gain } of audibleClips(timeline)) {
    if (silent && silent.has(clip.src)) continue;
    // HOW MUCH OF THE SOURCE A SPED-UP CLIP EATS. The input used to be cut to the clip's
    // length on the timeline, which is its length AFTER the speed - so a 2x clip ran out of
    // sound half way along while its picture played on. The picture had this arithmetic from
    // the start; the sound did not, and a pair that drifts apart is the whole cost of it.
    const sp = Math.max(0.25, Math.min(4, +clip.speed || 1));
    const srcLen = r2((+clip.dur || 0) * sp);
    const idx = inputs.length;
    // (phase V76) A clip at another pitch is heard from its file's copy at that pitch (lib/pitch-copy.js, made by prepare() in
    // lib/mv3b-job.js) - as long as the file, so the trim and everything after it are the same.
    const pitched = (opts && opts.pitched && opts.pitched.get(String(clip.id))) || null;
    inputs.push({ file: clip.src, ...(pitched ? { abs: pitched } : {}), ss: r2(clip.trimIn || 0), t: srcLen });
    const tag = `a${aTags.length}`;
    const ms = Math.round((+clip.start) * 1000);
    // (phase V23) A sound's own fades, in seconds of the timeline - the two variants of one Suno generation cross into
    // each other this way. After the tempo, so they are counted on the clip as it plays; the preview ramps the same.
    const fd = FADES.get(String(clip.id)) || { in: 0, out: 0 };
    // The delay comes after the tempo, because it is a position on the finished timeline and
    // the tempo is what decides how long the clip is by then.
    parts.push(
      `[${idx}:a]aformat=channel_layouts=stereo,atrim=0:${r6(srcLen)},asetpts=PTS-STARTPTS,` +
      (clip.reversed ? 'areverse,' : '') +
      atempoChain(sp).map(x => x + ',').join('') +
      (fd.in > 0 ? `afade=t=in:st=0:d=${r6(fd.in)},` : '') +
      (fd.out > 0 ? `afade=t=out:st=${r6(Math.max(0, (+clip.dur || 0) - fd.out))}:d=${r6(fd.out)},` : '') +
      `adelay=${ms}|${ms},` +
      `volume=${r6(Math.min(4, gain))}[${tag}]`
    );
    aTags.push(tag);
  }

  let amap = null;
  if (aTags.length === 1) amap = aTags[0];
  else if (aTags.length > 1) {
    parts.push(`${aTags.map(t => `[${t}]`).join('')}amix=inputs=${aTags.length}:normalize=0:dropout_transition=0[amix]`);
    amap = 'amix';
  }
  // Nothing to hear is still a sound: silence, as long as the film.
  if (!amap) {
    const idx = inputs.length;
    inputs.push({ lavfi: 'anullsrc=channel_layout=stereo:sample_rate=44100', t: dur });
    parts.push(`[${idx}:a]anull[asil]`);
    amap = 'asil';
  }
  // (phase V75, the owner's (кп7)) The noise under the sound went with the render window's Extras.

  return { w, h, dur, inputs, filter: parts.join(';'), map: { v: last, a: amap }, files: fxFiles };
}

module.exports = { buildGraph, frame, videoLanes, audioLanes, audibleClips, duration, pieceRun,
                   fitChain, atempoChain, animChain, gradeChain, transChain,
                   featherChain, isPlaced, isBand, bandGeom, bandChain, framedChain, isFramedClip };
