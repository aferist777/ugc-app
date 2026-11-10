/* ═══════════════════════════════════════════════════════════════════════════
   THE CARDS (phase V84 block 4c, the owner 2026-11-11, (б4-1)-(б4-13)) - Checklist pop, Checklist, Growth chart and Chat:
   video-effects-pack's scenes (MIT; their numbers, timings and look written again for the canvas), with the PERSON'S words
   (js/fx/effects.js textsOf - '' not drawn), font (one of the captions' 101, its twin for a Russian line - js/fx/kit.js
   textFont), colours (card, text, accent; Chat's background), corners, place up or down and size (the owner's (б4-13)). Drawn by the
   page only - live by the preview, baked for the render by the app's window with this code (js/merge-v3/fx-draw.js applyFx). Each is
   draw(g, S) on the clip's window (js/fx/overlays.js says what g and S are); `tau` stands still at the effect's `hold` while the card
   is set longer than its own length (js/fx/params.js ownTime), `live` goes on - a dot's pulse, a spinner.
   ═══════════════════════════════════════════════════════════════════════════ */

import { css, mixRgb, clamp01, ease, smooth, backOut, rrect, textFont, text, textW, fitText, wrapText, onColor, shadow, sparkGlyph } from './kit.js';
import { textsOf } from './effects.js';

const _items = (tx, keys) => keys.map((k) => String(tx[k] || '').trim()).filter(Boolean);
/** The card's colours: its own three (four), the lines and the faint text mixed from the card and the text (the pack's minimal). */
function _pal(col) {
  const card = col.card || [252, 252, 252], ink = col.text || [26, 26, 28];
  return { card, ink, acc: col.accent || ink, bg: col.bg || [238, 238, 236],
    line: mixRgb(card, ink, 0.13), dim: mixRgb(card, ink, 0.35), surface: mixRgb(card, ink, 0.055) };
}
/** The fonts of effect `e`: f(px, weight, the text it draws). */
const _fonts = (e) => (px, wt, txt) => textFont(e && e.font, px, wt, txt);
/** A card group laid where the person put it: scaled by Size about its middle, moved by Place, kept inside the window. */
function _place(g, S, b) {
  const sz = S.opt.size != null ? S.opt.size : 1;
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
  let dy = (S.opt.place || 0) * S.h;
  const top = cy + (b.y0 - cy) * sz + dy, bot = cy + (b.y1 - cy) * sz + dy;
  if (top < 0) dy -= top;
  else if (bot > S.h) dy -= bot - S.h;
  g.translate(cx, cy + dy);
  g.scale(sz, sz);
  g.translate(-cx, -cy);
}
/** A filled rounded box with a thin border inside it (the pack's rrect_layer with `border`). */
function _box(g, x, y, w, h, r, fill, border, bw) {
  rrect(g, x, y, w, h, r);
  g.fillStyle = css(fill);
  g.fill();
  if (border && bw > 0) {
    rrect(g, x + bw / 2, y + bw / 2, w - bw, h - bw, Math.max(0, r - bw / 2));
    g.strokeStyle = css(border);
    g.lineWidth = bw;
    g.stroke();
  }
}
const _disk = (g, x, y, r, col) => { g.beginPath(); g.arc(x, y, Math.max(0.5, r), 0, 2 * Math.PI); g.fillStyle = css(col); g.fill(); };
/** The pack's tick, drawn to `prog` (0..1) of its length. */
function _tick(g, cx, cy, r, prog, col, th) {
  const p0 = [cx - 0.42 * r, cy + 0.02 * r], p1 = [cx - 0.10 * r, cy + 0.36 * r], p2 = [cx + 0.48 * r, cy - 0.34 * r];
  const d1 = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), d2 = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
  const L = clamp01(prog) * (d1 + d2);
  g.beginPath();
  g.moveTo(p0[0], p0[1]);
  if (L <= d1) { const f = L / d1; g.lineTo(p0[0] + (p1[0] - p0[0]) * f, p0[1] + (p1[1] - p0[1]) * f); }
  else { const f = (L - d1) / d2; g.lineTo(p1[0], p1[1]); g.lineTo(p1[0] + (p2[0] - p1[0]) * f, p1[1] + (p2[1] - p1[1]) * f); }
  g.strokeStyle = css(col);
  g.lineWidth = th;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.stroke();
}
/** A short tick of three points (the pack's chat and pills). */
function _tick3(g, pts, col, th) {
  g.beginPath();
  pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
  g.strokeStyle = css(col);
  g.lineWidth = th;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.stroke();
}

// ── Checklist pop ───────────────────────────────────────────────────────────
// White pills with a thin border pop in from the right one after another (0.22 / 0.58 / 0.95 / 1.2 s), a spark where each will be;
// a circle turns into a tick 0.28 s after its pill.
function checklistpop(g, S) {
  const { w, h, u, e } = S;
  const t = S.tau;
  const P = _pal(S.col);
  const rad = S.opt.corners != null ? S.opt.corners : 1;
  const F = _fonts(e);
  const items = _items(textsOf(e), ['i1', 'i2', 'i3', 'i4']);
  if (!items.length) return;
  const ph = 76 * u, pitch = 98 * u, R = 0.94 * w, y0 = 0.37 * h;
  const tOn = [0.22, 0.58, 0.95, 1.2];
  const fade = 1 - smooth(1.62, 1.78, t);
  const pills = items.map((nm) => { const fnt = F(29 * u, 500, nm); return { nm, fnt, pw: 78 * u + textW(g, nm, fnt) + 32 * u }; });
  g.save();
  _place(g, S, { x0: R - Math.max(...pills.map((p) => p.pw)), y0, x1: R, y1: y0 + (items.length - 1) * pitch + ph });
  pills.forEach((p, i) => {
    const yc = y0 + i * pitch + ph / 2, xc = R - p.pw / 2;
    const k = backOut(clamp01((t - tOn[i]) / 0.22));
    if (k <= 0.01) { sparkGlyph(g, R - p.pw + 41 * u, yc, 0.010 * w, P.dim, 0.9 * fade * smooth(0, 0.1, t)); return; }
    g.save();
    g.translate(xc, yc);
    g.scale(k, k);
    g.translate(-p.pw / 2, -ph / 2);
    shadow(g, () => rrect(g, 0, 0, p.pw, ph, (ph / 2) * rad), 0, 7 * u, 10 * u, 0.20 * fade);
    g.globalAlpha = Math.max(0, fade * clamp01(k * 1.6));
    _box(g, 0, 0, p.pw, ph, (ph / 2) * rad, P.card, P.line, Math.max(1, 1.6 * u));
    const cx = 41 * u, cy = ph / 2;
    if (t > tOn[i] + 0.28) {
      _disk(g, cx, cy, 17 * u, P.acc);
      _tick3(g, [[cx - 7 * u, cy + 0.5 * u], [cx - 2 * u, cy + 5.5 * u], [cx + 7.5 * u, cy - 5.5 * u]], onColor(P.acc), Math.max(2, 2.6 * u));
    } else {
      g.beginPath();
      g.arc(cx, cy, 16 * u, 0, 2 * Math.PI);
      g.strokeStyle = css(P.dim);
      g.lineWidth = Math.max(1, 2.2 * u);
      g.stroke();
    }
    text(g, p.nm, 78 * u, ph / 2, { font: p.fnt, color: P.ink });
    g.restore();
  });
  g.restore();
}

// ── Checklist ───────────────────────────────────────────────────────────────
// A card with a title plate over it at the bottom of the window: its circles turn into ticks one after another (0.5 s, then every
// 0.4 s - closer for more than three), sparks round each, a bar of progress along its foot; it pops in and sinks out.
function checklist2(g, S) {
  const { w, h, u, e } = S;
  const t = S.tau;
  const P = _pal(S.col);
  const rad = S.opt.corners != null ? S.opt.corners : 1;
  const F = _fonts(e);
  const tx = textsOf(e);
  const items = _items(tx, ['i1', 'i2', 'i3', 'i4', 'i5']);
  const n = items.length;
  if (!n) return;
  const title = String(tx.title || '').trim();
  const cw = 0.66 * w, rowh = 0.047 * h, ch = rowh * n + 0.018 * h;
  const gap = n > 3 ? 0.8 / (n - 1) : 0.40;
  const tOn = items.map((_, i) => 0.50 + gap * i);
  const topY = 0.857 * h - ch, x0 = (w - cw) / 2;
  const pin = backOut(clamp01(t / 0.26)), pout = 1 - smooth(1.72, 1.98, t);
  const sc = pout < 1 ? pin * (0.9 + 0.1 * pout) : pin;
  const op = clamp01(pin * 1.4) * pout;
  const tsz = 0.040 * w;
  const tF = F(tsz, 900, title);
  const tpw = Math.max((title ? textW(g, title, tF) : 0) + 0.07 * w, 0.45 * w), tph = 0.046 * h;
  const ty = topY - 0.014 * h - tph / 2;
  g.save();
  _place(g, S, { x0, y0: title ? ty - tph / 2 : topY, x1: x0 + cw, y1: topY + ch });
  if (sc > 0.02 && op > 0.01) {
    g.save();
    g.translate(w / 2, topY + ch / 2);
    g.scale(sc, sc);
    g.translate(-cw / 2, -ch / 2);
    const path = () => rrect(g, 0, 0, cw, ch, 0.012 * w * rad);
    shadow(g, path, 0, 0.007 * h, 0.012 * w, 0.20 * op);
    g.globalAlpha = op;
    _box(g, 0, 0, cw, ch, 0.012 * w * rad, P.card, P.line, Math.max(1, 1.6 * u));
    g.save();
    path();
    g.clip();
    const rowsVis = clamp01((t - 0.12) / 0.2);
    let doneF = 0;
    items.forEach((nm, i) => {
      const yc = 0.009 * h + rowh * (i + 0.5), xr = 0.058 * cw, rr = 0.0195 * w;
      const tt = t - tOn[i];
      if (i > 0) {
        g.beginPath();
        g.moveTo(0.04 * cw, 0.009 * h + rowh * i);
        g.lineTo(0.96 * cw, 0.009 * h + rowh * i);
        g.strokeStyle = css(P.line);
        g.lineWidth = Math.max(1, 1.5 * u);
        g.stroke();
      }
      if (rowsVis <= 0.01) return;
      const done = clamp01(tt / 0.2);
      if (done <= 0) {
        g.beginPath();
        g.arc(xr, yc, rr, 0, 2 * Math.PI);
        g.strokeStyle = css(mixRgb(P.card, P.ink, 0.35));
        g.lineWidth = Math.max(2, 2.6 * u);
        g.stroke();
      } else {
        _disk(g, xr, yc, rr * (0.55 + 0.45 * backOut(clamp01(tt / 0.16))), P.ink);
        _tick(g, xr, yc, rr, ease(clamp01((tt - 0.05) / 0.16)), onColor(P.ink), Math.max(2, 3.2 * u));
        doneF += ease(clamp01(tt / 0.3));
      }
      text(g, nm, 0.14 * cw, yc, { font: F(0.041 * w, 700, nm), color: mixRgb(mixRgb(P.ink, P.card, 0.55), P.ink, done), alpha: rowsVis });
      const num = String(i + 1).padStart(2, '0');
      text(g, num, cw - 0.045 * cw, yc, { font: F(0.016 * w, 500, num), color: mixRgb(P.card, P.ink, 0.45), align: 'right',
        alpha: rowsVis, spacing: 0.06 * 0.016 * w });
    });
    const pw = cw * doneF / n;
    if (pw > 1) {
      g.fillStyle = css(P.acc);
      g.fillRect(0, ch - Math.max(3, 5 * u), pw, Math.max(3, 5 * u));
    }
    g.restore();
    // Sparks round each tick the moment it lands.
    g.strokeStyle = css(P.acc, 0.9);
    g.lineWidth = Math.max(2, 3 * u);
    g.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      const tt = t - tOn[i] - 0.10;
      if (!(tt > 0 && tt < 0.34)) continue;
      const f = ease(tt / 0.34), xr = 0.058 * cw, yc = 0.009 * h + rowh * (i + 0.5);
      g.beginPath();
      for (let k = 0; k < 7; k++) {
        const a = (-70 + k * 40 + 12) * Math.PI / 180;
        const r0 = 0.024 * w * (1 + 0.5 * f), r1 = r0 + 0.012 * w * (1 - f * 0.4);
        g.moveTo(xr + r0 * Math.cos(a), yc + r0 * Math.sin(a));
        g.lineTo(xr + r1 * Math.cos(a), yc + r1 * Math.sin(a));
      }
      g.stroke();
    }
    g.restore();
  }
  const tin = backOut(clamp01((t - 0.08) / 0.26));
  if (title && tin > 0.02 && op > 0.01) {
    g.save();
    g.translate(w / 2, ty);
    g.scale(tin, tin);
    g.translate(-tpw / 2, -tph / 2);
    shadow(g, () => rrect(g, 0, 0, tpw, tph, 0.010 * w * rad), 0, 0.005 * h, 0.008 * w, 0.18 * op);
    g.globalAlpha = op;
    _box(g, 0, 0, tpw, tph, 0.010 * w * rad, P.card, P.line, Math.max(1, 1.6 * u));
    text(g, title, tpw / 2, tph / 2, { font: tF, color: P.ink, align: 'center' });
    g.restore();
  }
  g.restore();
}

// ── Growth chart ────────────────────────────────────────────────────────────
// A card with axes and a grid: the line of growth draws itself left to right with a fill under it (0.35-1.6 s), two values
// labelled on it, a counter "+N%" running up to the person's number, a dot pulsing at the line's end.
const GC_VALS = [0, 10, 18, 30, 52, 62, 88, 120];
function growthchart(g, S) {
  const { w, h, u, e } = S;
  const t = S.tau;
  const P = _pal(S.col);
  const rad = S.opt.corners != null ? S.opt.corners : 1;
  const F = _fonts(e);
  const tx = textsOf(e);
  const N = Math.max(0, Math.round(Number(String(tx.number || '').replace(/[^0-9.]/g, '')) || 120));
  const title = String(tx.title || '').trim().toUpperCase(), note = String(tx.note || '').trim().toUpperCase();
  const cw = 0.88 * w, chh = 0.20 * h;
  const inn = backOut(clamp01(t / 0.3));
  const op = clamp01(t / 0.16) * (1 - smooth(2.0, 2.3, t));
  if (op <= 0.003) return;
  const cx = 0.5 * w, cy = 0.715 * h + (1 - inn) * 0.05 * h;
  g.save();
  _place(g, S, { x0: cx - cw / 2, y0: 0.715 * h - chh / 2, x1: cx + cw / 2, y1: 0.715 * h + chh / 2 });
  g.translate(cx - cw / 2, cy - chh / 2);
  const path = () => rrect(g, 0, 0, cw, chh, 16 * u * rad);
  shadow(g, path, 0, 0.008 * h, 0.012 * w, 0.22 * op);
  g.globalAlpha = op;
  path();
  g.fillStyle = css(P.card);
  g.fill();
  g.save();
  path();
  g.clip();
  const px0 = 0.105 * cw, px1 = 0.955 * cw, py0 = 0.30 * chh, py1 = 0.82 * chh;
  g.strokeStyle = css(P.line);
  g.lineWidth = Math.max(1, 1.5 * u);
  for (let k = 0; k < 4; k++) {
    const y = py1 - (py1 - py0) * k / 3;
    g.beginPath(); g.moveTo(px0, y); g.lineTo(px1, y); g.stroke();
    const lab = String(Math.round(N * k / 3));
    text(g, lab, px0 - 12 * u, y, { font: F(15 * u, 500, lab), color: P.dim, align: 'right' });
  }
  if (title) text(g, title, 26 * u, 0.15 * chh, { font: F(21 * u, 700, title), color: P.ink, spacing: 0.08 * 21 * u });
  if (note) text(g, note, cw - 22 * u, chh - 0.075 * chh, { font: F(13 * u, 500, note), color: P.dim, align: 'right', spacing: 0.06 * 13 * u });
  const p = ease(clamp01((t - 0.35) / 1.25));
  const xs = GC_VALS.map((_, i) => px0 + (px1 - px0) * i / (GC_VALS.length - 1));
  const ys = GC_VALS.map((v) => py1 - (py1 - py0) * v / 120);
  const seg = xs.slice(1).map((x, i) => Math.hypot(x - xs[i], ys[i + 1] - ys[i]));
  const goal = p * seg.reduce((a, b) => a + b, 0);
  const pts = [[xs[0], ys[0]]];
  let acc = 0;
  for (let i = 0; i < seg.length; i++) {
    if (acc + seg[i] <= goal) { pts.push([xs[i + 1], ys[i + 1]]); acc += seg[i]; } else {
      const f = (goal - acc) / Math.max(1e-6, seg[i]);
      pts.push([xs[i] + (xs[i + 1] - xs[i]) * f, ys[i] + (ys[i + 1] - ys[i]) * f]);
      break;
    }
  }
  const lineCol = P.acc.join() === P.card.join() ? P.ink : P.acc;
  if (pts.length >= 2 && goal > 0) {
    g.beginPath();
    pts.forEach((q, i) => (i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1])));
    g.lineTo(pts[pts.length - 1][0], py1);
    g.lineTo(pts[0][0], py1);
    g.closePath();
    g.fillStyle = css(P.acc, 0.16);
    g.fill();
    g.beginPath();
    pts.forEach((q, i) => (i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1])));
    g.strokeStyle = css(lineCol);
    g.lineWidth = Math.max(2, 4 * u);
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.stroke();
    for (const li of [4, 6]) {
      if (goal < seg.slice(0, li).reduce((a, b) => a + b, 0)) continue;
      _disk(g, xs[li], ys[li], 5 * u, P.ink);
      const lab = String(Math.round(GC_VALS[li] * N / 120));
      text(g, lab, xs[li], ys[li] - 18 * u, { font: F(16 * u, 700, lab), color: P.ink, align: 'center' });
    }
    const end = pts[pts.length - 1];
    _disk(g, end[0], end[1], 6 * u * (1 + 0.35 * Math.sin(S.live * 11)), lineCol);
  }
  g.restore();
  const pw = 150 * u, plh = 44 * u;
  const val = '+' + Math.round(N * p) + '%';
  const vF = fitText(g, val, pw - 16 * u, 24 * u, (s) => F(s, 700, val));
  const bx = cw - 22 * u - pw, by = 0.15 * chh - plh / 2;
  rrect(g, bx, by, pw, plh, 8 * u * rad);
  g.fillStyle = css(P.acc);
  g.fill();
  text(g, vF.txt, bx + pw / 2, by + plh / 2, { font: F(vF.size, 700, val), color: onColor(P.acc), align: 'center' });
  g.restore();
}

// ── Chat ────────────────────────────────────────────────────────────────────
// The window turns into a light chat: the request in a grey bubble, the clip shrinking into a card under it, "On it.", three items
// ticked one after another (the third keeps turning), a field to answer; then the card opens back over everything.
function chat(g, S) {
  const { w, h, u, e } = S;
  const t = S.tau;
  const P = _pal(S.col);
  const rad = S.opt.corners != null ? S.opt.corners : 1;
  const F = _fonts(e);
  const tx = textsOf(e);
  const pic = S.picture();
  const wx0 = 0.036 * w, wy0 = 0.17 * h, ww = 0.928 * w, wh = 0.66 * h;
  const user = String(tx.request || '').trim();
  const lines = _items(tx, ['i1', 'i2', 'i3']);
  const who = String(tx.name || '').trim() || 'Assistant';
  // The thread's layout in the window (the pack's _chat_geom): the request on top, the clip's card UNDER it, the reply under both.
  const fsz = 26 * u;
  const rows = user ? wrapText(g, user, F(fsz, 500, user), 0.60 * ww - 48 * u) : [];
  const tw = rows.length ? Math.max(...rows.map((r) => textW(g, r, F(fsz, 500, r)))) : 0;
  const bw = tw + 48 * u, bh = rows.length * 38 * u + 30 * u, bubTop = 164 * u;
  const cardW = 0.27 * w, cardH = cardW * h / w;
  const cardTop = (rows.length ? bubTop + bh + 14 * u : bubTop);
  const cardX = ww - 36 * u - cardW / 2;
  const capY = cardTop + cardH + 26 * u;
  const ay = capY + 76 * u;
  // The window's background over the whole window.
  g.fillStyle = css(P.bg);
  g.fillRect(0, 0, w, h);
  const winA = smooth(0.20, 0.31, t) * (1 - smooth(1.62, 1.70, t));
  if (winA > 0.01) {
    const tt = Math.max(0, t - 0.3);
    g.save();
    g.translate(wx0, wy0);
    shadow(g, () => rrect(g, 0, 0, ww, wh, 28 * u * rad), 0, 8 * u, 18 * u, 0.16 * winA);
    g.globalAlpha = winA;
    rrect(g, 0, 0, ww, wh, 28 * u * rad);
    g.fillStyle = css(P.card);
    g.fill();
    g.save();
    rrect(g, 0, 0, ww, wh, 28 * u * rad);
    g.clip();
    // The head: the assistant's mark and name, a line, "Today".
    _disk(g, 40 * u, 48 * u, 15 * u, P.acc);
    sparkGlyph(g, 40 * u, 48 * u, 8 * u, onColor(P.acc));
    text(g, who, 68 * u, 48 * u, { font: F(28 * u, 700, who), color: P.ink });
    g.fillStyle = css(P.line);
    g.fillRect(0, 96 * u, ww, Math.max(1, 1.5 * u));
    text(g, 'Today', ww / 2, 130 * u, { font: F(19 * u, 500, 'Today'), color: P.dim, align: 'center' });
    // The request.
    if (rows.length) {
      rrect(g, ww - 36 * u - bw, bubTop, bw, bh, 24 * u * rad);
      g.fillStyle = css(P.surface);
      g.fill();
      const k = clamp01(tt / 0.06);
      rows.forEach((r, i) => text(g, r, ww - 36 * u - bw + 24 * u, bubTop + 15 * u + 19 * u + i * 38 * u,
        { font: F(fsz, 500, r), color: mixRgb(P.dim, P.ink, k) }));
    }
    text(g, 'raw.mov · 1:09', ww - 36 * u, capY, { font: F(19 * u, 500, 'raw.mov'), color: P.dim, align: 'right' });
    // The reply: its mark, the dots of typing, "On it." and the items ticked one after another (the pack's timings).
    const ia = clamp01((tt - 0.17) / 0.06);
    if (ia > 0) {
      g.save();
      g.globalAlpha *= ia;
      _disk(g, 58 * u, ay, 20 * u, P.acc);
      sparkGlyph(g, 58 * u, ay, 9 * u, onColor(P.acc));
      g.restore();
    }
    if (tt > 0.27 && tt < 0.65) {
      for (let i = 0; i < 3; i++) {
        const ph = ((tt * 7.0 - i * 0.33) % 1 + 1) % 1, sn = Math.sin(ph * Math.PI);
        _disk(g, 100 * u + i * 24 * u, ay - 5 * u * sn, Math.max(2, 5 * u), mixRgb(P.line, P.dim, sn));
      }
    }
    if (tt >= 0.62) {
      text(g, 'On it.', 100 * u, ay, { font: F(27 * u, 700, 'On it.'), color: P.ink, alpha: clamp01((tt - 0.62) / 0.07) });
      const starts = [0.77, 0.93, 1.10], checks = [0.83, 1.03, 9.0];
      lines.forEach((nm, i) => {
        const st = starts[Math.min(i, 2)];
        const uu = clamp01((tt - st) / 0.06);
        if (uu <= 0.01) return;
        const y = ay + (68 + 60 * i) * u, x = 58 * u;
        const done = tt >= checks[Math.min(i, 2)];
        if (done) {
          _disk(g, x, y, 14 * u, P.acc);
          _tick3(g, [[x - 6 * u, y + 0.5 * u], [x - 1.5 * u, y + 5 * u], [x + 6.5 * u, y - 4.5 * u]], onColor(P.acc), Math.max(2, 2.4 * u));
        } else if (tt < st + 0.07) {
          _disk(g, x, y, Math.max(2, 4 * u), P.line);
        } else {
          const a0 = ((S.live * 400) % 360) * Math.PI / 180;
          g.beginPath();
          g.arc(x, y, 12 * u, a0, a0 + 1.5 * Math.PI);
          g.strokeStyle = css(P.dim);
          g.lineWidth = Math.max(1, 2.2 * u);
          g.stroke();
        }
        text(g, nm, 100 * u, y, { font: F(25 * u, 500, nm), color: P.ink, alpha: uu * (done || tt > st + 0.07 ? 1 : 0.55) });
      });
    }
    // The field to answer.
    const ibw = ww - 72 * u, ibh = 76 * u, iy = wh - 78 * u;
    _box(g, 36 * u, iy - ibh / 2, ibw, ibh, 38 * u * rad, P.surface, P.line, Math.max(1, 1.5 * u));
    const ph = 'Reply to ' + who + '...';
    text(g, ph, 72 * u, iy, { font: F(22 * u, 400, ph), color: P.dim });
    const bx = ww - 70 * u;
    _disk(g, bx, iy, 22 * u, P.acc);
    _tick3(g, [[bx - 7 * u, iy - 1 * u], [bx, iy - 8.5 * u], [bx + 7 * u, iy - 1 * u]], onColor(P.acc), Math.max(2, 2.4 * u));
    _tick3(g, [[bx, iy + 8 * u], [bx, iy - 8 * u]], onColor(P.acc), Math.max(2, 2.4 * u));
    g.restore();
    g.restore();
  }
  // The clip's card: the whole window -> the card under the request and back (0.05-0.25 s, 1.70-1.87 s).
  const full = [w / 2, h / 2, w, h];
  const card = [wx0 + cardX, wy0 + cardTop + cardH / 2, cardW, cardH];
  const mix = (a, b, v) => a.map((x, i) => x + (b[i] - x) * v);
  let box = full;
  if (t < 0.05) box = full;
  else if (t < 0.25) box = mix(full, card, ease((t - 0.05) / 0.20));
  else if (t < 1.70) box = card;
  else if (t < 1.87) box = mix(card, full, ease((t - 1.70) / 0.17));
  const [bx, by, bw2, bh2] = box;
  const f = clamp01((w - bw2) / Math.max(1, w - cardW));
  g.save();
  rrect(g, bx - bw2 / 2, by - bh2 / 2, bw2, bh2, 18 * u * f * rad);
  g.clip();
  g.drawImage(pic, bx - bw2 / 2, by - bh2 / 2, bw2, bh2);
  g.restore();
}

/** Every card by its effect's `draw` key. */
export const CARDS = { checklistpop, checklist2, growthchart, chat };
