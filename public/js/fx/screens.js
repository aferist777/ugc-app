/* ═══════════════════════════════════════════════════════════════════════════
   THE SCREENS (phase V84 block 4d, the owner 2026-11-11, (б4-1)-(б4-13)) - Phone app, Phone, Screen in screen and Magazine cover:
   video-effects-pack's scenes (MIT; their numbers, timings and layout written again for the canvas) that turn the clip's window
   into a scene with the clip's own picture inside it (S.picture() - the window as it is, upright). The person's words (textsOf),
   font (textFont - one of the captions'), colours and settings (js/fx/effects.js). Drawn by the page only - live by the preview,
   baked for the render by the app's window with this code. Each is draw(g, S) on the window (js/fx/overlays.js says what g and S
   are); `tau` stands at the effect's `hold` while it is set longer than its own length (js/fx/params.js ownTime).
   ═══════════════════════════════════════════════════════════════════════════ */

import { css, mixRgb, clamp01, ease, smooth, backOut, kf, rrect, textFont, text, textW, fitText, onColor, shadow, rngOf } from './kit.js';
import { textsOf, faceAt } from './effects.js';

const WHITE = [255, 255, 255];
const lerp = (a, b, k) => a + (b - a) * k;
const _fonts = (e) => (px, wt, txt) => textFont(e && e.font, px, wt, txt);
const _disk = (g, x, y, r, col, a = 1) => { g.beginPath(); g.arc(x, y, Math.max(0.5, r), 0, 2 * Math.PI); g.fillStyle = css(col, a); g.fill(); };
/** The part of picture `pic` (pw x ph) that covers a box of shape `ar` from its middle (the pack's _cover / phonemock's crop). */
function _coverSrc(pw, ph, ar) {
  if (pw / ph > ar) { const w = ph * ar; return [(pw - w) / 2, 0, w, ph]; }
  const h = pw / ar;
  return [0, (ph - h) / 2, pw, h];
}
/** The scene drawn on a canvas of the window's size, then laid over the clip's picture at `k` (the pack's F.mix(img, scene, k)). */
function _lay(g, S, k, draw) {
  const C = S.canvas('scene', S.w, S.h);
  draw(C.getContext('2d'));
  g.save();
  g.globalAlpha = clamp01(k);
  g.drawImage(C, 0, 0);
  g.restore();
}
/** The face where the effect starts, in the window: { x, y, w, h } (its top-left and size, pixels) - the pack's face(). */
function _faceBox(S) {
  const f = faceAt(S.e && S.e.path, +((S.e && S.e.t0) || 0));
  const [cx, cy] = S.toBox(f[0] * S.W, f[1] * S.H);
  const fw = f[2] * S.W, fh = f[3] * S.H;
  return { x: cx - fw / 2, y: cy - fh / 2, w: fw, h: fh };
}

// ── Phone app ───────────────────────────────────────────────────────────────
// The clip shrinks (0.3 s) into a phone's screen on a light background: a short-video app round it - its name top-left, a heart
// and comments with their counts on the right, the person's avatar, name, Follow and a caption at the foot; the phone's island.
function phonemock(g, S) {
  const { w, h, u, e, opt } = S;
  const t = S.tau;
  const k = ease(clamp01(t / 0.3)) * (1 - smooth(1.06, 1.16, t));
  if (k <= 0.002) return;
  const F = _fonts(e);
  const tx = textsOf(e);
  const bg = S.col.bg, body = S.col.body;
  const pic = S.picture();
  const sz = opt.size != null ? opt.size : 1;
  const pw = 0.47 * w * sz, ph = 0.49 * h * sz, pcx = 0.5 * w, pcy = 0.505 * h;
  const sw = pw - 0.052 * pw, sh = ph - 0.036 * pw;
  const scene = (x) => {
    x.fillStyle = css(bg);
    x.fillRect(0, 0, w, h);
    shadow(x, () => rrect(x, pcx - pw / 2, pcy - ph / 2, pw, ph, 0.09 * pw), 0, 0.014 * h, 0.03 * w, 0.32);
    rrect(x, pcx - pw / 2, pcy - ph / 2, pw, ph, 0.09 * pw);
    x.fillStyle = css(body);
    x.fill();
    x.strokeStyle = css(mixRgb(body, WHITE, 0.28));
    x.lineWidth = Math.max(2, 0.009 * pw);
    x.stroke();
    // The screen: the clip cut to its shape from its middle, the app over it.
    const sx0 = pcx - sw / 2, sy0 = pcy - sh / 2;
    x.save();
    rrect(x, sx0, sy0, sw, sh, 0.075 * pw);
    x.clip();
    const [cx0, cy0, cw0, ch0] = _coverSrc(pic.width, pic.height, sw / sh);
    x.drawImage(pic, cx0, cy0, cw0, ch0, sx0, sy0, sw, sh);
    text(x, 'Reels', sx0 + 0.085 * sw, sy0 + 0.062 * sh, { font: F(0.026 * w, 700, 'Reels'), color: WHITE });
    x.strokeStyle = css(WHITE);
    x.lineWidth = Math.max(1.5, 2 * u);
    for (const [j, cyf, lab] of [[0, 0.615, '12.4K'], [1, 0.700, '3,108']]) {
      const cx = sx0 + 0.915 * sw, cy = sy0 + cyf * sh, r = 0.0105 * w;
      x.beginPath();
      if (j === 0) {
        for (let q = 0; q <= 60; q++) {
          const th = (q / 60) * 2 * Math.PI;
          const hx = 16 * Math.pow(Math.sin(th), 3), hy = -(13 * Math.cos(th) - 5 * Math.cos(2 * th) - 2 * Math.cos(3 * th) - Math.cos(4 * th));
          const X = cx + hx * r / 17, Y = cy + hy * r / 17;
          if (q) x.lineTo(X, Y); else x.moveTo(X, Y);
        }
      } else x.ellipse(cx, cy, r, r * 0.85, 0, 0, 2 * Math.PI);
      x.stroke();
      text(x, lab, cx, cy + 0.036 * sh, { font: F(0.0105 * w, 700, lab), color: WHITE, align: 'center' });
    }
    _disk(x, sx0 + 0.075 * sw, sy0 + 0.915 * sh, 0.0105 * w, [210, 210, 210]);
    const name = String(tx.name || '').trim();
    if (name) text(x, name, sx0 + 0.135 * sw, sy0 + 0.915 * sh, { font: F(0.0125 * w, 700, name), color: WHITE });
    text(x, 'Follow', sx0 + 0.57 * sw, sy0 + 0.915 * sh, { font: F(0.0095 * w, 700, 'Follow'), color: WHITE, align: 'center' });
    x.lineWidth = 1;
    x.strokeRect(sx0 + 0.47 * sw, sy0 + 0.90 * sh, 0.20 * sw, 0.03 * sh);
    const cap = String(tx.caption || '').trim();
    if (cap) {
      const fit = fitText(x, cap, 0.86 * sw, 0.0105 * w, (s) => F(s, 500, cap));
      text(x, fit.txt, sx0 + 0.065 * sw, sy0 + 0.955 * sh, { font: F(fit.size, 500, cap), color: [235, 235, 235] });
    }
    x.restore();
    rrect(x, pcx - 0.11 * pw, pcy - ph / 2 + 0.058 * pw - 0.02 * pw, 0.22 * pw, 0.040 * pw, 0.02 * pw);
    x.fillStyle = css([8, 8, 8]);
    x.fill();
  };
  if (t < 0.3) {
    // The first moment: the clip, rounded, shrinking from the whole window into the screen over the scene.
    const ee = ease(t / 0.3);
    _lay(g, S, ease(clamp01(t / 0.12)), (x) => {
      scene(x);
      const bw = lerp(w, sw, ee), bh = lerp(h, sh, ee), bx = lerp(w / 2, pcx, ee), by = lerp(h / 2, pcy, ee);
      x.save();
      rrect(x, bx - bw / 2, by - bh / 2, bw, bh, lerp(0.06 * w, 0.075 * pw, ee));
      x.clip();
      x.drawImage(pic, bx - bw / 2, by - bh / 2, bw, bh);
      x.restore();
    });
    return;
  }
  _lay(g, S, k, scene);
}

// ── Phone ───────────────────────────────────────────────────────────────────
// The clip shrinks in 0.4 s into a phone's screen on a plain background - a body growing round it, side buttons, the island, a
// soft gloss and a shadow on the floor -, holds and opens back in 0.45 s; a caption plate over the phone only when written.
function phonemock2(g, S) {
  const { w, h, u, e, opt } = S;
  const t = S.tau;
  const p = ease(clamp01(t / 0.40)) * (1 - ease(clamp01((t - 1.55) / 0.45)));
  if (p <= 0.002) return;
  const F = _fonts(e);
  const tx = textsOf(e);
  const bg = S.col.bg, ink = S.col.body;
  const pic = S.picture();
  const ba = clamp01((p - 0.10) / 0.55);
  const sz = opt.size != null ? opt.size : 1;
  const pw = 0.555 * w * sz, ph = 0.64 * h * sz, bz = 0.014 * w;
  const pcx = 0.5 * w, pcy = 0.505 * h;
  const sw = pw - 2 * bz, sh = ph - 2 * bz;
  _lay(g, S, ba >= 0.999 ? 1 : Math.max(ba, clamp01(p * 4)), (x) => {
    x.fillStyle = css(bg);
    x.fillRect(0, 0, w, h);
    // A shadow on the floor.
    x.save();
    x.filter = `blur(${(0.012 * w).toFixed(2)}px)`;
    x.beginPath();
    x.ellipse(pcx, pcy + ph / 2 + 0.012 * h, Math.max(1, 0.23 * w * p), 0.011 * h, 0, 0, 2 * Math.PI);
    x.fillStyle = `rgba(0,0,0,${(0.34 * ba).toFixed(3)})`;
    x.fill();
    x.restore();
    const cap = String(tx.caption || '').trim();
    if (cap) {
      const csz = 0.0285 * w;
      const cF = F(csz, 900, cap);
      const cw = textW(x, cap, cF) + 0.07 * w, chh = 0.034 * h;
      const cin = backOut(clamp01((t - 0.22) / 0.26)) * clamp01(p * 1.6);
      if (cin > 0.02) {
        x.save();
        x.translate(0.5 * w, pcy - ph / 2 - 0.036 * h);
        x.scale(cin, cin);
        rrect(x, -cw / 2, -chh / 2, cw, chh, 0.004 * w);
        x.fillStyle = css(ink);
        x.fill();
        text(x, cap, 0, 0, { font: cF, color: onColor(ink), align: 'center' });
        x.restore();
      }
    }
    const scw = lerp(w, sw, p), sch = lerp(h, sh, p), scx = lerp(w / 2, pcx, p), scy = lerp(h / 2, pcy, p);
    const bzp = bz * p;
    if (p > 0.05) {
      const bwid = scw + 2 * bzp, bhei = sch + 2 * bzp, br = 0.115 * pw * (0.4 + 0.6 * p);
      shadow(x, () => rrect(x, scx - bwid / 2, scy - bhei / 2, bwid, bhei, br), 0, 0.010 * h, 0.020 * w, 0.28 * p);
      rrect(x, scx - bwid / 2, scy - bhei / 2, bwid, bhei, br);
      x.fillStyle = css(ink);
      x.fill();
      x.strokeStyle = css(mixRgb(ink, WHITE, 0.30));
      x.lineWidth = Math.max(1, 2.2 * u);
      x.stroke();
      for (const [sgn, yy, hh] of [[-1, -0.20, 0.05], [1, -0.12, 0.09]]) {
        const bw = Math.max(3, 0.004 * w), bh = hh * ph * p;
        rrect(x, scx + sgn * (bwid / 2 + u) - bw / 2, scy + yy * ph * p - bh / 2, bw, bh, 1.5);
        x.fillStyle = css(mixRgb(ink, WHITE, 0.18));
        x.fill();
      }
    }
    x.save();
    rrect(x, scx - scw / 2, scy - sch / 2, scw, sch, lerp(0, 0.092 * pw, p) + 0.001);
    x.clip();
    const [cx0, cy0, cw0, ch0] = _coverSrc(pic.width, pic.height, scw / sch);
    x.drawImage(pic, cx0, cy0, cw0, ch0, scx - scw / 2, scy - sch / 2, scw, sch);
    x.restore();
    if (p > 0.6) {
      x.save();
      x.globalAlpha = clamp01((p - 0.6) / 0.4);
      rrect(x, scx - 0.10 * pw, scy - sch / 2 + 0.050 * pw - 0.017 * pw, 0.20 * pw, 0.034 * pw, 0.017 * pw);
      x.fillStyle = css([8, 8, 10]);
      x.fill();
      x.restore();
    }
    if (p > 0.7) {
      // A soft gloss across the screen, turned 18 degrees.
      x.save();
      x.filter = `blur(${(0.01 * w).toFixed(2)}px)`;
      x.globalCompositeOperation = 'lighter';
      x.translate(scx - 0.02 * w, scy);
      x.rotate(18 * Math.PI / 180);
      x.fillStyle = `rgba(255,255,255,${(0.05 * clamp01((p - 0.7) / 0.3)).toFixed(3)})`;
      x.fillRect(-0.06 * w, -sch * 0.6, 0.12 * w, sch * 1.2);
      x.restore();
    }
  });
}

// ── Screen in screen ────────────────────────────────────────────────────────
// The vertical clip turns (0.2-0.4 s) into a wide screen near the top of a white window: its window from the hair to the chin across
// its whole width (by the face where the effect starts), a thin frame and a soft shadow under it; back at 1.27-1.47 s.
function screeninscreen(g, S) {
  const { w, h, u, opt } = S;
  const t = S.tau;
  const k = kf(t, [[0, 0], [0.2, 0], [0.4, 1], [1.27, 1], [1.47, 0]]);
  if (k <= 0) return;
  const e = ease(k);
  const pic = S.picture();
  const fb = _faceBox(S);
  const cy = fb.y + fb.h * 0.40;
  const hh = Math.min(Math.max(fb.h * 1.80, w / 3.2), h * 0.5);
  const y0 = Math.max(0, Math.min(h - hh, cy - hh / 2));
  const s1 = [0, y0 / h, 1, (y0 + hh) / h];
  const dw = 0.988, dh = dw * hh / h, dtop = 0.127;
  const d1 = [(1 - dw) / 2, dtop, (1 + dw) / 2, dtop + dh];
  const sr = [0, 1, 2, 3].map((i) => lerp([0, 0, 1, 1][i], s1[i], e));
  const dr = [0, 1, 2, 3].map((i) => lerp([0, 0, 1, 1][i], d1[i], e));
  _lay(g, S, 1, (x) => {
    const top = S.col.bg;
    const grad = x.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, css(top));
    grad.addColorStop(1, css(top.map((v) => v * 236 / 255)));
    x.fillStyle = grad;
    x.fillRect(0, 0, w, h);
    const dx0 = dr[0] * w, dy0 = dr[1] * h, dx1 = dr[2] * w, dy1 = dr[3] * h;
    x.save();
    x.filter = `blur(${(0.01 * h).toFixed(2)}px)`;
    x.fillStyle = 'rgba(0,0,0,0.19)';
    x.fillRect(dx0 + 8, dy1, Math.max(0, dx1 - dx0 - 16), 0.012 * h);
    x.restore();
    const sx0 = sr[0] * pic.width, sy0 = sr[1] * pic.height, sx1 = sr[2] * pic.width, sy1 = sr[3] * pic.height;
    x.drawImage(pic, sx0, sy0, Math.max(1, sx1 - sx0), Math.max(1, sy1 - sy0), dx0, dy0, Math.max(1, dx1 - dx0), Math.max(1, dy1 - dy0));
    const bw = Math.max(1, Math.round(3 * u * e * (opt.border != null ? opt.border : 1)));
    if (opt.border !== 0) {
      x.strokeStyle = css(S.col.frame);
      x.lineWidth = bw;
      x.strokeRect(dx0 + bw / 2, dy0 + bw / 2, dx1 - dx0 - bw, dy1 - dy0 - bw);
    }
  });
}

// ── Magazine cover ──────────────────────────────────────────────────────────
// The clip becomes a cover tilting in from below: the issue and date on top, the masthead over the hair, a big number with its label
// and a line over a coloured plate under the chin, two small lines and a barcode at the foot - nothing over the face; every text
// the person's; the whole cover tilts out again. The hair's top is the face's (the pack takes it from the person's mask on its first
// frame); with no room the masthead lies over the hair and the head stands in front of it (block 6 - the person's mask, js/fx/person.js).
const _capH = (g, size, fnt) => {
  g.save();
  g.font = fnt;
  const m = g.measureText('H');
  g.restore();
  return (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) || size * 0.72;
};
function _magLayout(g, S, cw, chh) {
  const { w, h, u, e } = S;
  const F = _fonts(e);
  const tx = textsOf(e);
  const up = (v) => String(v || '').trim().toUpperCase();
  const T = { name: up(tx.name), head1: up(tx.head1), head2: up(tx.head2), big: up(tx.big), biglabel: up(tx.biglabel),
    sub1: up(tx.sub1), sub2: up(tx.sub2), issue: up(tx.issue), date: up(tx.date) };
  const s = Math.max(cw / w, chh / h), bw = w * s, bh = h * s;
  const fb = _faceBox(S);
  const ht = (fb.y - 0.6 * fb.h) * s;
  const y0 = Math.min(Math.max(0, ht - 0.19 * chh), bh - chh);
  const x0 = Math.min(Math.max(0, (fb.x + fb.w * 0.5) * s - cw / 2), bw - cw);
  const hair = ht - y0, chin = (fb.y + fb.h) * s - y0;
  const mx = 0.055 * cw;
  const acc = S.col.accent, white = S.col.text;
  const lum = 0.299 * acc[0] + 0.587 * acc[1] + 0.114 * acc[2];
  const bigcol = lum > 150 ? acc : white;
  const items = [];
  const put = (blk, txt, x, y, size, wt, align, col, spacing = 0, op = 1) => {
    if (txt) items.push({ blk, txt, x, y, size, wt, align, col, spacing, op });
  };
  const fit = (txt, maxW, size, wt, sp = 0, min = 0.55) => fitText(g, txt, maxW, size, (z) => F(z, wt, txt), (z) => sp * z, min);
  const cap = (size, wt, txt) => _capH(g, size, F(size, wt, txt || 'H'));
  // The top strip: the issue and the date.
  const szS = 22 * u, yS = 0.034 * chh;
  const iss = fit(T.issue, 0.46 * cw, szS, 500, 0.08), dat = fit(T.date, 0.46 * cw, szS, 500, 0.08);
  put(0, iss.txt, mx, yS, iss.size, 500, 'left', white, 0.08);
  put(0, dat.txt, cw - mx, yS, dat.size, 500, 'right', white, 0.08);
  // The masthead in the band between the strip and the hair (no room - over the hair).
  const bandTop = yS + 0.030 * chh;
  let bandBot = hair - 0.018 * chh;
  const overlap = bandBot - bandTop < 0.055 * chh;
  if (overlap) bandBot = bandTop + 0.085 * chh;
  if (T.name) {
    const szw = 400 * 0.90 * cw / Math.max(1, textW(g, T.name, F(400, 900, T.name)));
    const szh = (bandBot - bandTop) / (cap(100, 900, T.name) / 100);
    const nm = fit(T.name, 0.90 * cw, Math.min(szw, szh), 900);
    put(0, nm.txt, cw / 2, (bandTop + bandBot) / 2, nm.size, 900, 'center', white);
  }
  // The foot: two small lines on the left, the barcode on the right.
  const footBot = chh - 0.045 * chh;
  const bar = S.opt.barcode >= 0.5;
  const bcW = bar ? 0.19 * cw : 0, bcH = bar ? 0.062 * chh : 0;
  const subW = cw - 2 * mx - (bcW ? bcW + 0.05 * cw : 0);
  const s1 = fit(T.sub1, subW, 30 * u, 700, 0.08), s2 = fit(T.sub2, subW, 23 * u, 500, 0.06);
  const y2 = s2.txt ? footBot - cap(s2.size, 500, s2.txt) / 2 : footBot;
  const y1 = s1.txt ? y2 - (s2.txt ? cap(s2.size, 500, s2.txt) / 2 + 14 * u : 0) - cap(s1.size, 700, s1.txt) / 2 : y2;
  put(3, s1.txt, mx, y1, s1.size, 700, 'left', white, 0.08);
  put(3, s2.txt, mx, y2, s2.size, 500, 'left', white, 0.06, 0.85);
  const footTop = Math.min(bcW ? footBot - bcH : footBot, ...(s1.txt ? [y1 - cap(s1.size, 700, s1.txt) / 2] : []));
  const barBox = bcW ? { x: cw - mx - bcW, y: footBot - bcH, w: bcW, h: bcH } : null;
  // The middle: the big number with its label on the left, the line and the plate on the right, under the chin.
  const midBot = footTop - 0.040 * chh;
  const availTop = Math.max(0.60 * chh, chin + 0.05 * chh);
  const lab = T.big ? T.biglabel : '';
  let best = null;
  for (let f = 1.0; f > 0.49; f -= 0.05) {
    const bt = T.big ? fit(T.big, 0.5 * cw, 0.21 * cw * f, 900, 0, 0.35) : { txt: '', size: 0.21 * cw * f };
    const lt = lab ? fit(lab, 0.5 * cw, 30 * u * f, 700, 0.12) : { txt: '', size: 30 * u * f };
    const leftW = Math.max(bt.txt ? textW(g, bt.txt, F(bt.size, 900, bt.txt)) : 0, lt.txt ? textW(g, lt.txt, F(lt.size, 700, lt.txt), 0.12 * lt.size) : 0);
    const gap = leftW ? 0.05 * cw : 0;
    const rightW = cw - 2 * mx - leftW - gap;
    const hs = 0.068 * cw * f, pad = 0.42 * hs;
    let t1 = T.head1 ? fit(T.head1, rightW, hs, 900) : { txt: '', size: hs };
    let t2 = T.head2 ? fit(T.head2, rightW - 2 * pad, hs, 900) : { txt: '', size: hs };
    if (t1.txt && t2.txt) { const m = Math.min(t1.size, t2.size); t1 = { ...t1, size: m }; t2 = { ...t2, size: m }; }
    const chL = (bt.txt ? cap(bt.size, 900, bt.txt) : 0) + (lt.txt && bt.txt ? 14 * u * f + cap(lt.size, 700, lt.txt) : lt.txt ? cap(lt.size, 700, lt.txt) : 0);
    const plateH = t2.txt ? 1.55 * t2.size : 0;
    const chR = (t1.txt ? cap(t1.size, 900, t1.txt) : 0) + (t1.txt && t2.txt ? 16 * u * f : 0) + plateH;
    best = { f, bt, lt, t1, t2, pad, plateH };
    if (midBot - Math.max(chL, chR) >= availTop) break;
  }
  const { f, bt, lt, t1, t2, pad, plateH } = best;
  let yl = midBot;
  if (lt.txt) { put(2, lt.txt, mx, yl - cap(lt.size, 700, lt.txt) / 2, lt.size, 700, 'left', bigcol, 0.12); yl -= cap(lt.size, 700, lt.txt) + 14 * u * f; }
  if (bt.txt) put(2, bt.txt, mx - 0.01 * bt.size, yl - cap(bt.size, 900, bt.txt) / 2, bt.size, 900, 'left', white);
  const xr = cw - mx;
  const plate = t2.txt ? { w: textW(g, t2.txt, F(t2.size, 900, t2.txt)) + 2 * pad, h: plateH, txt: t2.txt, size: t2.size } : null;
  if (plate) { plate.x = xr - plate.w; plate.y = midBot - plateH; }
  if (t1.txt) put(1, t1.txt, xr, midBot - plateH - (t2.txt ? 16 * u * f : 0) - cap(t1.size, 900, t1.txt) / 2, t1.size, 900, 'right', white);
  return { s, bw, bh, x0, y0, items, plate, bar: barBox, F, overlap };
}
function magazine(g, S) {
  const { w, h, u, opt } = S;
  const t = S.tau;
  const k = smooth(0.0, 0.18, t) * (1 - smooth(1.85, 2.1, t));
  if (k <= 0.003) return;
  const eIn = backOut(clamp01((t - 0.02) / 0.45)), eOut = ease(clamp01((t - 1.72) / 0.38));
  const rad = opt.corners != null ? opt.corners : 1;
  const pic = S.picture();
  const cw = 0.89 * w, chh = 0.73 * h;
  const L = _magLayout(g, S, cw, chh);
  const P = L.overlap ? S.person() : null;
  const ink = [26, 26, 28];
  const C = S.canvas('mag', cw, chh);
  const x = C.getContext('2d');
  // The picture as the cover's, the face where the pack puts it.
  x.drawImage(pic, -L.x0, -L.y0, L.bw, L.bh);
  const darken = (y0, y1, a0, a1) => {
    const gr = x.createLinearGradient(0, y0, 0, y1);
    gr.addColorStop(0, css(ink, a0));
    gr.addColorStop(1, css(ink, a1));
    x.fillStyle = gr;
    x.fillRect(0, y0, cw, y1 - y0);
  };
  const rv = (t0) => { const a = smooth(t0, t0 + 0.30, t); return [a, (1 - a) * 18 * u]; };
  const draw = (blk) => {
    const [a, dy] = rv([0.16, 0.46, 0.58, 0.70][blk]);
    if (a > 0.01) for (const it of L.items) {
      if (it.blk !== blk) continue;
      text(x, it.txt, it.x, it.y + dy, { font: L.F(it.size, it.wt, it.txt), color: it.col, align: it.align, alpha: a * it.op, spacing: it.spacing * it.size });
    }
    return [a, dy];
  };
  darken(0, 0.34 * chh, 0.58, 0);
  draw(0);
  // (block 6) No room over the hair: the head in front of the masthead, as the picture is (not darkened).
  if (P) x.drawImage(P.cut, -L.x0, -L.y0, L.bw, L.bh);
  // Under the cover lines - so white words read on a light sweater (a smooth step to 0.66 at the foot).
  const g0 = 0.50 * chh;
  const gr = x.createLinearGradient(0, g0, 0, chh);
  for (let q = 0; q <= 8; q++) { const v = q / 8; gr.addColorStop(v, css(ink, v * v * (3 - 2 * v) * 0.66)); }
  x.fillStyle = gr;
  x.fillRect(0, g0, cw, chh - g0);
  const [a1, dy1] = draw(1);
  if (L.plate && a1 > 0.01) {
    const p = L.plate;
    x.save();
    x.globalAlpha = a1;
    rrect(x, p.x, p.y + dy1, p.w, p.h, 5 * u * rad);
    x.fillStyle = css(S.col.accent);
    x.fill();
    text(x, p.txt, p.x + p.w / 2, p.y + p.h / 2 + dy1, { font: L.F(p.size, 900, p.txt), color: onColor(S.col.accent), align: 'center' });
    x.restore();
  }
  draw(2);
  const [a3, dy3] = draw(3);
  if (L.bar && a3 > 0.01) {
    const b = L.bar;
    x.save();
    x.globalAlpha = a3;
    x.fillStyle = '#ffffff';
    x.fillRect(b.x, b.y + dy3, b.w, b.h);
    x.fillStyle = css([20, 20, 22]);
    const rnd = rngOf('barcode', 3);
    let xx = 5 * u;
    while (xx < b.w - 6 * u) {
      const ww = (1 + Math.floor(rnd() * 3)) * Math.max(1, 1.4 * u);
      x.fillRect(b.x + xx, b.y + dy3 + 4 * u, ww, b.h - 8 * u);
      xx += ww + (1 + Math.floor(rnd() * 2)) * 1.4 * u;
    }
    x.restore();
  }
  // The backdrop and the cover tilting in from below and out again.
  _lay(g, S, k, (y) => {
    y.fillStyle = css(S.col.bg);
    y.fillRect(0, 0, w, h);
    const off = (1 - eIn) * 0.95 * h + eOut * 0.95 * h;
    const rot = (lerp(7.0, -2.4, eIn) + eOut * 5.0) * Math.PI / 180;
    y.save();
    y.translate(0.5 * w, 0.5 * h + off);
    y.rotate(-rot);
    shadow(y, () => rrect(y, -cw / 2, -chh / 2, cw, chh, 6 * u * rad), 0.006 * w, 0.012 * h, 0.014 * w, 0.30);
    rrect(y, -cw / 2, -chh / 2, cw, chh, 6 * u * rad);
    y.clip();
    y.drawImage(C, -cw / 2, -chh / 2);
    y.restore();
  });
}

/** Every screen by its effect's `draw` key. */
export const SCREENS = { phonemock, phonemock2, screeninscreen, magazine };
