/* ═══════════════════════════════════════════════════════════════════════════
   A CLIP'S EFFECTS ON THE PREVIEW (phase V84; docs/local-app/plan/, "Подфаза 3 — V84"). preview-b.js _showAs draws a clip whose
   effects run at this moment ALONE on a layer of the canvas's size (as it does for its opacity) and hands the layer here; what comes
   back is laid at the clip's opacity and blend mode. The numbers are public/js/fx/params.js paramsAt's - the render's
   (lib/fx-render.js) - and the steps are the render's, in its order:
     the colour matrix (an SVG feColorMatrix, its values set for the frame) and the move (the layer drawn transformed) ->
     the channels (the picture drawn three times, each through a filter keeping one channel, moved, added up) ->
     the blocks (down to a small canvas and back without smoothing, the grid from the frame's corner) ->
     the vignette and the speed lines (masks drawn by effects.js's rule, laid only where the clip has picture - source-atop).
   ═══════════════════════════════════════════════════════════════════════════ */

import { vigAt, linesOf, LINES_ALPHA } from '../fx/effects.js';

const NS = 'http://www.w3.org/2000/svg';
let _defs = null;
let _colM = null;
function _ensureDefs() {
  if (_defs || typeof document === 'undefined') return;
  const svg = document.createElementNS(NS, 'svg');
  svg.id = 'mv3-fx-defs';
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.position = 'absolute';
  const filter = (id, values) => {
    const f = document.createElementNS(NS, 'filter');
    f.id = id;
    f.setAttribute('color-interpolation-filters', 'sRGB');
    f.setAttribute('x', '0'); f.setAttribute('y', '0'); f.setAttribute('width', '1'); f.setAttribute('height', '1');
    const m = document.createElementNS(NS, 'feColorMatrix');
    m.setAttribute('type', 'matrix');
    m.setAttribute('values', values);
    f.appendChild(m);
    svg.appendChild(f);
    return m;
  };
  // Measured 2026-11-10: the canvas reads a changed feColorMatrix under the same url() when its filter is set again.
  _colM = filter('mv3-fx-col', '1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0');
  filter('mv3-fx-r', '1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0');
  filter('mv3-fx-g', '0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0');
  filter('mv3-fx-b', '0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0');
  document.body.appendChild(svg);
  _defs = svg;
}

const _cvs = {};
function _canvas(name, w, h) {
  let cv = _cvs[name];
  if (!cv) cv = _cvs[name] = document.createElement('canvas');
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  const g = cv.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  g.filter = 'none';
  g.imageSmoothingEnabled = true;
  g.clearRect(0, 0, w, h);
  return cv;
}

// The masks, drawn once per frame size by effects.js's rule.
let _vig = null;
function _vigMask(W, H) {
  if (_vig && _vig.width === W && _vig.height === H) return _vig;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const img = g.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) img.data[(y * W + x) * 4 + 3] = Math.round(255 * vigAt(x + 0.5, y + 0.5, W, H));
  }
  g.putImageData(img, 0, 0);
  _vig = cv;
  return cv;
}
let _lines = null;
function _linesMask(W, H) {
  if (_lines && _lines.width === W && _lines.height === H) return _lines;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.strokeStyle = '#ffffff';
  g.lineCap = 'round';
  for (const l of linesOf(W, H)) {
    g.lineWidth = l.w;
    g.beginPath();
    g.moveTo(l.x0, l.y0);
    g.lineTo(l.x1, l.y1);
    g.stroke();
  }
  _lines = cv;
  return cv;
}

const _f = (v) => String(Math.round(v * 1e5) / 1e5);

/**
 * The clip's layer `layer` (a canvas, the frame at PAD) with the effects' numbers `p` (params.js paramsAt for this W x H frame)
 * applied - a canvas of the same size, the layer itself left as it is.
 */
export function applyFx(layer, p, { W, H, PAD, inFrame }) {
  _ensureDefs();
  const CW = layer.width, CH = layer.height;
  const u = W / 1080;
  // The colour and the move, in one draw. A clip covering the frame stays in it - the render cuts the frame out after the move;
  // an insert hanging over the edge is drawn as it hangs.
  let cur = _canvas('a', CW, CH);
  let g = cur.getContext('2d');
  if (inFrame) { g.save(); g.beginPath(); g.rect(PAD, PAD, W, H); g.clip(); }
  if (p.col && _colM) {
    const c = p.col;
    _colM.setAttribute('values', [c[0], c[1], c[2], 0, c[3], c[4], c[5], c[6], 0, c[7], c[8], c[9], c[10], 0, c[11], 0, 0, 0, 1, 0].map(_f).join(' '));
    g.filter = 'url(#mv3-fx-col)';
  }
  g.setTransform(1, 0, 0, 1, PAD, PAD);
  if (p.move) { const m = p.move; g.transform(m.a, m.b, -m.b, m.a, m.e, m.f); }
  g.drawImage(layer, -PAD, -PAD);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.filter = 'none';
  if (inFrame) g.restore();
  // The channels moved apart: each drawn through its own filter, added up.
  if (p.ch) {
    const ch = p.ch;
    const nx = _canvas('b', CW, CH);
    const h = nx.getContext('2d');
    h.globalCompositeOperation = 'lighter';
    for (const [id, dx, dy] of [['r', ch.rx, ch.ry], ['g', ch.gx, ch.gy], ['b', ch.bx, ch.by]]) {
      h.filter = `url(#mv3-fx-${id})`;
      h.drawImage(cur, Math.round((+dx || 0) * u), Math.round((+dy || 0) * u));
    }
    h.filter = 'none';
    h.globalCompositeOperation = 'source-over';
    cur = nx;
    g = h;
  }
  // The blocks: the frame down to one pixel a block, and back without smoothing.
  if (p.px > 1.5) {
    const b = Math.max(1, p.px * u);
    const sw = Math.max(1, Math.ceil(W / b)), sh = Math.max(1, Math.ceil(H / b));
    const sm = _canvas('s', sw, sh);
    const s = sm.getContext('2d');
    s.imageSmoothingQuality = 'high';
    s.drawImage(cur, PAD, PAD, sw * b, sh * b, 0, 0, sw, sh);
    g.save();
    g.beginPath();
    g.rect(PAD, PAD, W, H);
    g.clip();
    g.clearRect(PAD, PAD, W, H);
    g.imageSmoothingEnabled = false;
    g.drawImage(sm, 0, 0, sw, sh, PAD, PAD, sw * b, sh * b);
    g.restore();
  }
  // Laid only where the clip has picture.
  const lay = (mask, alpha) => {
    if (!(alpha > 0.002)) return;
    g.save();
    g.globalCompositeOperation = 'source-atop';
    g.globalAlpha = Math.min(1, alpha);
    g.drawImage(mask, PAD, PAD, W, H);
    g.restore();
  };
  if (p.vig > 0.002) lay(_vigMask(W, H), p.vig);
  if (p.lines > 0.002) lay(_linesMask(W, H), p.lines * LINES_ALPHA);
  return cur;
}
