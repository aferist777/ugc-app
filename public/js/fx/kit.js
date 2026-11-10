/* ═══════════════════════════════════════════════════════════════════════════
   THE GRAPHICS' KIT (phase V84 block 4b) - what every effect that draws on the frame shares: the preview and the app's bake window
   draw with this one code (js/merge-v3/fx-draw.js applyFx -> js/fx/overlays.js and the blocks to come). Page only (canvas).
     fontsReady()          Inter in four weights for the canvas ('UGC FX Inter': 400, 500 - the interface's files; 700, 900 - the
                           captions') - the bake window waits for it before its first frame, the preview draws once it is there
     font(px, weight)      the canvas's font string
     rngOf(...keys)        a random of its own for those keys (an effect's id and numbers) - the same at every frame and every bake
     hexRgb, mixRgb, css   colours as [r, g, b]
     rrect(g, x, y, w, h, r)   a rounded rectangle's path
     ease, smooth, backOut, clamp01, kf   the timing curves video-effects-pack's scenes use
   ═══════════════════════════════════════════════════════════════════════════ */

export { ease, smooth, kf } from './effects.js';

export const clamp01 = (x) => Math.max(0, Math.min(1, x));
/** video-effects-pack's back_out: past 1 and back - the pop of a thing that appears. */
export function backOut(x, k = 1.7) {
  const v = clamp01(x) - 1;
  return 1 + (k + 1) * v * v * v + k * v * v;
}

// ── Fonts ──────────────────────────────────────────────────────────────────
export const FAMILY = 'UGC FX Inter';
const FACES = [
  ['400', '/fonts/ui/Inter-Regular.woff2'],
  ['500', '/fonts/ui/Inter-Medium.woff2'],
  ['700', '/fonts/captions/Inter-Bold.ttf'],
  ['900', '/fonts/captions/Inter-Black.ttf'],
];
let _fonts = null;
/** Inter loaded for the canvas (once). Resolves even when a file is missing - the canvas then draws in its own sans. */
export function fontsReady() {
  if (_fonts) return _fonts;
  if (typeof FontFace === 'undefined' || typeof document === 'undefined') { _fonts = Promise.resolve(false); return _fonts; }
  _fonts = Promise.all(FACES.map(([weight, url]) => {
    const f = new FontFace(FAMILY, `url(${url})`, { weight, style: 'normal' });
    return f.load().then((ff) => { document.fonts.add(ff); return true; }).catch(() => false);
  })).then((all) => all.every(Boolean));
  return _fonts;
}
export const font = (px, weight = 700) => `${weight} ${Math.max(1, Math.round(px * 100) / 100)}px "${FAMILY}", sans-serif`;

// ── A random of its own ────────────────────────────────────────────────────
function _hash(keys) {
  let h = 2166136261;
  const s = keys.map(String).join('|');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
/** A random 0..1 of its own for `keys` (mulberry32) - its sequence the same at every frame and every bake. */
export function rngOf(...keys) {
  let a = _hash(keys);
  const next = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.range = (lo, hi) => lo + (hi - lo) * next();
  next.normal = () => Math.sqrt(-2 * Math.log(Math.max(1e-9, next()))) * Math.cos(2 * Math.PI * next());
  return next;
}

// ── Colours ────────────────────────────────────────────────────────────────
export const HEX_RE = /^#[0-9a-f]{6}$/i;
export function hexRgb(h) {
  const s = HEX_RE.test(String(h || '')) ? String(h).slice(1) : 'ffffff';
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}
export const mixRgb = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
export const css = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${Math.max(0, Math.min(1, a))})`;

// ── Shapes ─────────────────────────────────────────────────────────────────
/** A rounded rectangle's path on `g` (begun here). */
export function rrect(g, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  g.moveTo(x + rr, y);
  g.lineTo(x + w - rr, y);
  g.arcTo(x + w, y, x + w, y + rr, rr);
  g.lineTo(x + w, y + h - rr);
  g.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  g.lineTo(x + rr, y + h);
  g.arcTo(x, y + h, x, y + h - rr, rr);
  g.lineTo(x, y + rr);
  g.arcTo(x, y, x + rr, y, rr);
  g.closePath();
}

/**
 * A closed rounded rectangle's outline as points every `step` px, clockwise from the top-left corner's end - video-effects-pack's
 * _rr_path; with each point's share of the way round (`s`) and the way out of it (`nx`, `ny`).
 */
export function rrPath(x0, y0, x1, y1, r, step) {
  const pts = [];
  const seg = (xa, ya, xb, yb) => {
    const n = Math.max(2, Math.floor(Math.hypot(xb - xa, yb - ya) / step));
    for (let k = 0; k < n; k++) pts.push([xa + (xb - xa) * k / n, ya + (yb - ya) * k / n]);
  };
  const arc = (cx, cy, a0, a1) => {
    const n = Math.max(4, Math.floor(r * Math.abs((a1 - a0) * Math.PI / 180) / step));
    for (let k = 0; k < n; k++) { const a = (a0 + (a1 - a0) * k / n) * Math.PI / 180; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  };
  seg(x0 + r, y0, x1 - r, y0); arc(x1 - r, y0 + r, -90, 0);
  seg(x1, y0 + r, x1, y1 - r); arc(x1 - r, y1 - r, 0, 90);
  seg(x1 - r, y1, x0 + r, y1); arc(x0 + r, y1 - r, 90, 180);
  seg(x0, y1 - r, x0, y0 + r); arc(x0 + r, y0 + r, 180, 270);
  // The way round and the way out of each point.
  const n = pts.length;
  const len = new Array(n);
  let tot = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    len[i] = Math.hypot(b[0] - a[0], b[1] - a[1]);
    tot += len[i];
  }
  let acc = 0;
  return pts.map((p, i) => {
    const b = pts[(i + 1) % n];
    const d = len[i] || 1;
    const tx = (b[0] - p[0]) / d, ty = (b[1] - p[1]) / d;
    const out = { x: p[0], y: p[1], s: acc / tot, nx: ty, ny: -tx };
    acc += len[i];
    return out;
  });
}

// ── Block 4c: the cards' text ──────────────────────────────────────────────
// (the owner's (б4-13) а) A card's font may be any of the captions' 101 (js/captions/fonts.js) - a font with no Russian letters draws
// a Russian line in its twin, as the captions do (drawnFamily). Loaded for the canvas under a name of its own, once; Inter stays
// behind it for a letter it lacks.
import { fontOf as capFont, drawnFamily, FONT_DIR } from '../captions/fonts.js';
const _fams = new Map();
const _onFont = [];
/** Told when a card's font has loaded (the preview paints again - js/merge-v3/preview-b.js). */
export function onFontLoaded(cb) { if (typeof cb === 'function') _onFont.push(cb); }
const _alias = (family) => 'UGC FX F ' + family;
/** A caption family loaded for the canvas (once) - resolves true when it is there. */
export function loadFamily(name) {
  if (!name || typeof FontFace === 'undefined' || typeof document === 'undefined') return Promise.resolve(false);
  const f = capFont(name);
  if (_fams.has(f.family)) return _fams.get(f.family);
  const file = Object.values(f.files || {})[0];
  const p = !file ? Promise.resolve(false) : new FontFace(_alias(f.family), `url(${FONT_DIR}${file})`).load()
    .then((ff) => { document.fonts.add(ff); for (const cb of _onFont) { try { cb(); } catch (e) { /* its own */ } } return true; })
    .catch(() => false);
  _fams.set(f.family, p);
  return p;
}
/** Every font the effects `list` draw in, loaded (with their twins) - the bake window waits for it before its first frame. */
export function fontsFor(list) {
  const all = [fontsReady()];
  for (const e of (Array.isArray(list) ? list : [])) {
    if (!e || !e.font) continue;
    const f = capFont(e.font);
    all.push(loadFamily(f.family));
    if (f.twin) all.push(loadFamily(f.twin));
  }
  return Promise.all(all);
}
/** The canvas font for `txt` in effect font `name` (none - the sample's Inter at `weight`). */
export function textFont(name, px, weight, txt) {
  if (!name) return font(px, weight);
  const fam = capFont(drawnFamily(name, txt)).family;
  loadFamily(fam);
  return `${Math.max(1, Math.round(px * 100) / 100)}px "${_alias(fam)}", "${FAMILY}", sans-serif`;
}

/** A line of text, its middle at y (PIL's centred text of the pack): { font, color, align, alpha, spacing (px between letters) }. */
export function text(g, txt, x, y, o) {
  if (!txt) return;
  g.save();
  g.font = o.font;
  g.letterSpacing = (o.spacing || 0).toFixed(2) + 'px';
  g.textAlign = o.align || 'left';
  g.textBaseline = 'middle';
  g.fillStyle = css(o.color, o.alpha == null ? 1 : o.alpha);
  g.fillText(txt, x, y);
  g.restore();
}
/** How wide `txt` is in `fnt` with `spacing` px between letters. */
export function textW(g, txt, fnt, spacing) {
  g.save();
  g.font = fnt;
  g.letterSpacing = (spacing || 0).toFixed(2) + 'px';
  const w = g.measureText(String(txt || '')).width;
  g.restore();
  return w;
}
/**
 * The pack's _fit: the largest size up to `size` at which `txt` fits `maxW`; under `minFrac` of it the text is cut with an ellipsis.
 * `mk(size)` is the font at a size, `sp(size)` its spacing. -> { txt, size }
 */
export function fitText(g, txt, maxW, size, mk, sp, minFrac = 0.55) {
  if (!txt) return { txt: '', size };
  const spc = (s) => (sp ? sp(s) : 0);
  const w = textW(g, txt, mk(size), spc(size));
  let s = size * Math.min(1, maxW / Math.max(1, w));
  let t = String(txt);
  if (s < size * minFrac) {
    s = size * minFrac;
    while (t.length > 1 && textW(g, t + '…', mk(s), spc(s)) > maxW) t = t.slice(0, -1);
    t = t.trimEnd() + '…';
  }
  return { txt: t, size: s };
}
/** Lines of `txt` wrapped at `maxW` (by words). */
export function wrapText(g, txt, fnt, maxW) {
  const rows = [];
  let cur = '';
  for (const wd of String(txt || '').split(/\s+/).filter(Boolean)) {
    if (cur && textW(g, cur + ' ' + wd, fnt) > maxW) { rows.push(cur); cur = wd; } else cur = (cur + ' ' + wd).trim();
  }
  if (cur) rows.push(cur);
  return rows.length ? rows : [''];
}
/** A readable colour on a fill (the pack's _on). */
export const onColor = (c) => (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2] > 140 ? [20, 20, 22] : [250, 250, 250]);
/** A soft shadow of the path `pathFn` makes (begun inside), moved by dx, dy, blurred, at `alpha`. */
export function shadow(g, pathFn, dx, dy, blur, alpha) {
  if (!(alpha > 0.003)) return;
  g.save();
  g.filter = `blur(${Math.max(0.5, blur).toFixed(2)}px)`;
  g.translate(dx, dy);
  pathFn();
  g.fillStyle = `rgba(0,0,0,${Math.min(1, alpha).toFixed(3)})`;
  g.fill();
  g.restore();
}
/** The pack's spark glyph: ten rays round a point, r its radius. */
export function sparkGlyph(g, x, y, r, color, alpha = 1) {
  g.save();
  g.strokeStyle = css(color, alpha);
  g.lineWidth = Math.max(1, r * 0.14);
  g.lineCap = 'round';
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = i * 36 * Math.PI / 180;
    g.moveTo(x + 0.30 * r * Math.cos(a), y + 0.30 * r * Math.sin(a));
    g.lineTo(x + 0.95 * r * Math.cos(a), y + 0.95 * r * Math.sin(a));
  }
  g.stroke();
  g.restore();
}

// ── Block 2: other moments of a clip ───────────────────────────────────────
// Frames of the clip's file from other moments (Grid dive's tiles, PiP delay's late copy, Color swing's echo), made once by the
// server (lib/fx-moments.js, cache/fx-moments/) - the preview and the bake window draw the same pictures. `spec` - { ranges:
// [[from, to], ...] (the file's seconds), w }. Until they are there, an effect draws the picture it has.
const STILL_RE = /\.(jpe?g|png|webp|gif|bmp|avif)$/i;
const _moments = new Map();     // key -> { ready, failed, promise, ranges: [{ from, n, imgs }] }
const _mKey = (src, spec) => String(src).split('?')[0] + '|' + JSON.stringify(spec.ranges) + '|' + spec.w;
/** The pictures of `spec` for file `src` - asked for once; resolves when every one has loaded (or could not be). */
export function loadMoments(src, spec) {
  if (!src || !spec || !Array.isArray(spec.ranges) || !spec.ranges.length || STILL_RE.test(String(src).split('?')[0])
    || typeof fetch === 'undefined' || typeof Image === 'undefined') return Promise.resolve(null);
  const key = _mKey(src, spec);
  let m = _moments.get(key);
  if (m) return m.promise;
  if (_moments.size > 24) _moments.delete(_moments.keys().next().value);
  m = { ready: false, ranges: [] };
  m.promise = fetch('/api/fx-moments', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ src: String(src).split('?')[0], ranges: spec.ranges, w: spec.w }) })
    .then((r) => r.json())
    .then((d) => {
      if (!d || !d.success) throw new Error((d && d.error) || 'no moments');
      const all = [];
      m.ranges = d.ranges.map((r, i) => {
        const imgs = [];
        for (let k = 0; k < r.n; k++) {
          const im = new Image();
          all.push(new Promise((ok) => { im.onload = ok; im.onerror = ok; }));
          im.src = d.url + i + '_' + k + '.jpg';
          imgs.push(im);
        }
        return { from: r.from, n: r.n, imgs };
      });
      return Promise.all(all);
    })
    .then(() => { m.ready = true; for (const cb of _onFont) { try { cb(); } catch (e) { /* its own */ } } return m; })
    .catch(() => { m.failed = true; return null; });
  _moments.set(key, m);
  return m.promise;
}
/** The picture of file second `t` (the nearest frame of its stretch), or null - asked for when it is not there yet. */
export function momentAt(src, spec, t) {
  if (!src || !spec) return null;
  const m = _moments.get(_mKey(src, spec));
  if (!m) { loadMoments(src, spec); return null; }
  if (!m.ready) return null;
  let best = null, bd = Infinity;
  for (const r of m.ranges) {
    const k = Math.max(0, Math.min(r.n - 1, Math.round((t - r.from) * 30)));
    const d = Math.abs(r.from + k / 30 - t);
    if (d < bd && r.imgs[k] && r.imgs[k].naturalWidth) { bd = d; best = r.imgs[k]; }
  }
  return best;
}
/** Told when a card's font or a clip's moments have loaded (the preview paints again). */
export const onLoaded = onFontLoaded;

// ── SVG filters the canvas draws through (blocks 2, 5) ─────────────────────
// One hidden <svg> of filters; a filter's numbers are set just before the draw that uses it (the canvas reads them then - measured
// for fx-draw.js's colour matrix, 2026-11-10).
const SVG_NS = 'http://www.w3.org/2000/svg';
let _svg = null;
const _filters = new Map();
function _filter(id, make) {
  if (typeof document === 'undefined') return null;
  if (!_svg) {
    _svg = document.createElementNS(SVG_NS, 'svg');
    _svg.setAttribute('width', '0');
    _svg.setAttribute('height', '0');
    _svg.setAttribute('aria-hidden', 'true');
    _svg.style.position = 'absolute';
    document.body.appendChild(_svg);
  }
  let f = _filters.get(id);
  if (!f) {
    const el = document.createElementNS(SVG_NS, 'filter');
    el.id = 'ugc-fx-' + id;
    el.setAttribute('color-interpolation-filters', 'sRGB');
    el.setAttribute('x', '-0.1'); el.setAttribute('y', '-0.1'); el.setAttribute('width', '1.2'); el.setAttribute('height', '1.2');
    f = { el, parts: make(el) };
    _svg.appendChild(el);
    _filters.set(id, f);
  }
  return f;
}
const _n = (v) => String(Math.round(v * 1e5) / 1e5);
/** A blur along x only, σ px - the canvas filter string. */
export function hblur(sigma) {
  const f = _filter('hb', (el) => {
    const b = document.createElementNS(SVG_NS, 'feGaussianBlur');
    b.setAttribute('edgeMode', 'duplicate');
    el.appendChild(b);
    return { b };
  });
  if (!f) return 'none';
  f.parts.b.setAttribute('stdDeviation', _n(Math.max(0, sigma)) + ' 0');
  return 'url(#ugc-fx-hb)';
}
/** A colour matrix 3 x 4 (rows out R, G, B; columns in R, G, B and an offset 0..255) - the canvas filter string. */
export function matrix(id, M) {
  const f = _filter('m-' + id, (el) => {
    const m = document.createElementNS(SVG_NS, 'feColorMatrix');
    m.setAttribute('type', 'matrix');
    el.appendChild(m);
    return { m };
  });
  if (!f) return 'none';
  f.parts.m.setAttribute('values', [0, 1, 2].map((r) => [M[r][0], M[r][1], M[r][2], 0, M[r][3] / 255].map(_n).join(' ')).join(' ') + ' 0 0 0 1 0');
  return 'url(#ugc-fx-m-' + id + ')';
}
/** Luma -> R, G, B by three tables (Cursed's tone): `tables` [[r...], [g...], [b...]] of 0..1 over the luma 0..1. */
export function lumaTables(id, tables) {
  const f = _filter('lt-' + id, (el) => {
    const m = document.createElementNS(SVG_NS, 'feColorMatrix');
    m.setAttribute('type', 'matrix');
    m.setAttribute('values', '0.299 0.587 0.114 0 0  0.299 0.587 0.114 0 0  0.299 0.587 0.114 0 0  0 0 0 1 0');
    const ct = document.createElementNS(SVG_NS, 'feComponentTransfer');
    const fs = ['feFuncR', 'feFuncG', 'feFuncB'].map((n) => { const x = document.createElementNS(SVG_NS, n); x.setAttribute('type', 'table'); ct.appendChild(x); return x; });
    el.append(m, ct);
    return { fs };
  });
  if (!f) return 'none';
  f.parts.fs.forEach((x, i) => x.setAttribute('tableValues', tables[i].map(_n).join(' ')));
  return 'url(#ugc-fx-lt-' + id + ')';
}
/** The pack's flash: the picture mixed towards a colour by `a` over x, y, w, h. */
export function flash(g, a, col, x, y, w, h) {
  if (!(a > 0.003)) return;
  g.save();
  g.globalAlpha = Math.min(1, a);
  g.fillStyle = css(col);
  g.fillRect(x, y, w, h);
  g.restore();
}
/** Picture `img` (iw x ih) laid over x, y, w, h as `cover` (its middle) - the source rectangle [sx, sy, sw, sh]. */
export function coverOf(iw, ih, w, h) {
  const s = Math.max(w / iw, h / ih);
  const sw = w / s, sh = h / s;
  return [(iw - sw) / 2, (ih - sh) / 2, sw, sh];
}
