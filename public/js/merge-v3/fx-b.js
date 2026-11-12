/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — a soft edge, as the preview draws it.

   softened() is the preview's half of a placed insert's `feather` (preview-b.js _draw); the
   render's half is lib/mv3b-render.js featherChain. Both ramp the picture's alpha in from its
   nearest edge by the same rule, so the screen and the file show the same edge.
   ═══════════════════════════════════════════════════════════════════════════ */

// The render ramps the alpha in from whichever edge is nearest:
//
//     a = min(1, distance-to-nearest-edge / (fraction * shorter side))
//
// and this computes the SAME expression, once, into a mask that is kept until its size or its
// fraction changes. Then every frame is one composite.
//
// Four gradients was the first attempt and it was wrong twice over: `destination-in` clears
// everything the source rectangle does not cover, so each side erased the last, and even with
// `destination-out` the corners would be eaten from both sides at once - where the formula
// above says a corner is governed by ONE edge, the nearer one.
let _scratch = null;
let _mask = null, _maskKey = '';

function _maskFor(w, h, fr) {
  const key = w + 'x' + h + '|' + fr.toFixed(4);
  if (_mask && _maskKey === key) return _mask;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  const img = g.createImageData(w, h);
  const d = img.data;
  const band = Math.max(1, fr * Math.min(w, h));
  for (let y = 0; y < h; y++) {
    const dy = Math.min(y, h - 1 - y);
    for (let x = 0; x < w; x++) {
      const near = Math.min(Math.min(x, w - 1 - x), dy);
      const i = (y * w + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = 0;
      d[i + 3] = Math.round(255 * Math.min(1, near / band));
    }
  }
  g.putImageData(img, 0, 0);
  _mask = cv; _maskKey = key;
  return cv;
}

/** The picture with its edges dissolved, or null if it could not be drawn. */
export function softened(el, sx, sy, sw, sh, dw, dh, fr) {
  const w = Math.max(2, Math.round(dw)), h = Math.max(2, Math.round(dh));
  if (!_scratch) _scratch = document.createElement('canvas');
  if (_scratch.width !== w || _scratch.height !== h) { _scratch.width = w; _scratch.height = h; }
  const g = _scratch.getContext('2d');
  g.globalCompositeOperation = 'source-over';
  g.clearRect(0, 0, w, h);
  try { g.drawImage(el, sx, sy, sw, sh, 0, 0, w, h); } catch (e) { return null; }
  // The mask covers the whole scratch, which is what makes destination-in safe here: there is
  // no outside for it to clear.
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(_maskFor(w, h, fr), 0, 0);
  g.globalCompositeOperation = 'source-over';
  return _scratch;
}
