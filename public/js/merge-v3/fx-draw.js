/* ═══════════════════════════════════════════════════════════════════════════
   A CLIP'S EFFECTS ON THE PREVIEW (phase V84; docs/local-app/plan/, "Подфаза 3 — V84"). preview-b.js _showAs draws a clip whose
   effects run at this moment ALONE on a layer of the canvas's size (as it does for its opacity) and hands the layer here; what comes
   back is laid at the clip's opacity and blend mode. The numbers are public/js/fx/params.js paramsAt's - the render's
   (lib/fx-render.js) - and the steps are the render's, in its order:
     the colour matrix (an SVG feColorMatrix, its values set for the frame) and the move (the layer drawn transformed) ->
     the channels (the picture drawn three times, each through a filter keeping one channel, moved, added up) ->
     the blocks (down to a small canvas and back without smoothing, the grid from the frame's corner) ->
     (block 1c) the face's mosaic (the same blocks inside its oval) and Snap zoom's blur (a canvas blur) ->
     (block 3) the glitch's column jitter (main video, baked for the render by the app's window with this code) ->
     (block 1b) the vertical smear and the soft focus (canvas blurs) -> the vignette, the speed lines and the glitch's dark lines
     (masks drawn by effects.js's rule, laid only where the clip has picture - source-atop) -> the grain.
   ═══════════════════════════════════════════════════════════════════════════ */

import { vigAt, linesOf, LINES_ALPHA, stripesAt, jitterOf } from '../fx/effects.js';

const NS = 'http://www.w3.org/2000/svg';
let _defs = null;
let _colM = null;
let _bv = null;
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
  // (block 1b) The vertical smear: a Gaussian blur down only, its σ set for the frame.
  const fv = document.createElementNS(NS, 'filter');
  fv.id = 'mv3-fx-bv';
  fv.setAttribute('color-interpolation-filters', 'sRGB');
  _bv = document.createElementNS(NS, 'feGaussianBlur');
  _bv.setAttribute('stdDeviation', '0 0');
  _bv.setAttribute('edgeMode', 'duplicate');
  fv.appendChild(_bv);
  svg.appendChild(fv);
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

let _stripes = null;
function _stripesMask(W, H) {
  if (_stripes && _stripes.width === W && _stripes.height === H) return _stripes;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = 1;
  const g = cv.getContext('2d');
  const img = g.createImageData(W, 1);
  for (let x = 0; x < W; x++) img.data[x * 4 + 3] = Math.round(255 * stripesAt(x + 0.5, W));
  g.putImageData(img, 0, 0);
  const full = document.createElement('canvas');
  full.width = W; full.height = H;
  full.getContext('2d').drawImage(cv, 0, 0, W, H);
  _stripes = full;
  return full;
}
// The grain: a few tiles of random grey, one picked a frame (random here as ffmpeg's is in the file).
let _grain = null;
function _grainTiles() {
  if (_grain) return _grain;
  _grain = [0, 1, 2, 3].map(() => {
    const cv = document.createElement('canvas');
    cv.width = 160; cv.height = 160;
    const g = cv.getContext('2d');
    const img = g.createImageData(160, 160);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() < 0.5 ? 0 : 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = Math.round(Math.random() * 40);
    }
    g.putImageData(img, 0, 0);
    return cv;
  });
  return _grain;
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
  // (block 1c) The face's mosaic: the blocks of the frame's own grid (from its corner, as the render's pixelize) that cover the
  // oval's box, made small and drawn back without smoothing - inside the oval only, and only where the clip has picture.
  if (p.mosaic) {
    const m = p.mosaic;
    const b = Math.max(1, Math.round(m.b * u));
    const gx0 = Math.floor(m.x / b) * b, gy0 = Math.floor(m.y / b) * b;
    const gx1 = Math.ceil((m.x + m.w) / b) * b, gy1 = Math.ceil((m.y + m.h) / b) * b;
    const nw = Math.max(1, (gx1 - gx0) / b), nh = Math.max(1, (gy1 - gy0) / b);
    const sm = _canvas('m', nw, nh);
    const s = sm.getContext('2d');
    s.imageSmoothingQuality = 'high';
    s.drawImage(cur, PAD + gx0, PAD + gy0, gx1 - gx0, gy1 - gy0, 0, 0, nw, nh);
    g.save();
    g.beginPath();
    g.ellipse(PAD + m.x + m.w / 2, PAD + m.y + m.h / 2, m.w / 2, m.h / 2, 0, 0, 2 * Math.PI);
    g.clip();
    g.globalCompositeOperation = 'source-atop';
    g.imageSmoothingEnabled = false;
    g.drawImage(sm, 0, 0, nw, nh, PAD + gx0, PAD + gy0, gx1 - gx0, gy1 - gy0);
    g.restore();
  }
  // (block 1c) Snap zoom's blur, both ways.
  if (p.blur > 0.05) {
    const nx = _canvas('e', CW, CH);
    const h = nx.getContext('2d');
    h.filter = `blur(${_f(p.blur * u)}px)`;
    h.drawImage(cur, 0, 0);
    h.filter = 'none';
    cur = nx;
    g = h;
  }
  // (block 1b) The vertical smear.
  if (p.blurV > 0.05 && _bv) {
    _bv.setAttribute('stdDeviation', '0 ' + _f(p.blurV * u));
    const nx = _canvas('d', CW, CH);
    const h = nx.getContext('2d');
    h.filter = 'url(#mv3-fx-bv)';
    h.drawImage(cur, 0, 0);
    h.filter = 'none';
    cur = nx;
    g = h;
  }
  // (block 3) The glitch's column jitter (main video only - params.js): each band of the frame moved down by its own amount, its
  // edge row repeated into the gap (video-effects-pack's remap with BORDER_REPLICATE). Drawn by the page only - the app's window
  // bakes it for the render with this very code (js/bake-worker.js).
  if (p.jitter) {
    const jt = jitterOf(W, p.jitter.seed);
    const nx = _canvas('j', CW, CH);
    const h = nx.getContext('2d');
    h.save();
    h.beginPath();
    h.rect(PAD, PAD, W, H);
    h.clip();
    for (let i = 0, x = 0; x < W; i++, x += jt.bw) {
      const w = Math.min(jt.bw, W - x), dy = jt.dy[i];
      h.drawImage(cur, PAD + x, PAD, w, H, PAD + x, PAD + dy, w, H);
      if (dy > 0) h.drawImage(cur, PAD + x, PAD, w, 1, PAD + x, PAD, w, dy);
      else if (dy < 0) h.drawImage(cur, PAD + x, PAD + H - 1, w, 1, PAD + x, PAD + H + dy, w, -dy);
    }
    h.restore();
    cur = nx;
    g = h;
  }
  // (block 1b) Soft sway's soft focus: 0.88 of it blurred by 1.3 u, 0.12 of it by 14 u over that.
  if (p.glow > 0.002) {
    const nx = _canvas('c', CW, CH);
    const h = nx.getContext('2d');
    h.filter = `blur(${_f(1.3 * u)}px)`;
    h.drawImage(cur, 0, 0);
    h.filter = `blur(${_f(14 * u)}px)`;
    h.globalAlpha = 0.12 * Math.min(1, p.glow);
    h.drawImage(cur, 0, 0);
    h.filter = 'none';
    h.globalAlpha = 1;
    cur = nx;
    g = h;
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
  if (p.stripes > 0.002) lay(_stripesMask(W, H), p.stripes);
  if (p.grain > 0.002) {
    const tiles = _grainTiles();
    g.save();
    g.globalCompositeOperation = 'source-atop';
    g.globalAlpha = Math.min(1, p.grain);
    g.fillStyle = g.createPattern(tiles[(Math.random() * tiles.length) | 0], 'repeat');
    g.fillRect(PAD, PAD, W, H);
    g.restore();
  }
  return cur;
}
