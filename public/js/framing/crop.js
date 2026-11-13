/* ═══════════════════════════════════════════════════════════════════════════
   A CLIP'S CROP - ONE module for the page and the server
   (lib/timeline-shape.js and lib/mv3b-render.js require() it, as they do framing/path.js).

   `crop: { x, y, w, h }` - a piece of the clip's FILE in shares of its width and height, cut FIRST:
   past it the clip behaves as if the file were that piece - no Fit / Fill, Framing, Keep or punch-ins.
   `off: true` - the frame is remembered and not applied (Crop switched off, or "Full frame" on a cropped
   clip above main; Crop switched on brings it back). `shape` - the form the frame keeps while it is moved
   (9:16, 1:1, 16:9, 4:5 of the piece's own pixels; none - free).

   A crop is shown where the piece already was, with nothing adjusted: the
   piece keeps its place and its scale on the screen, as scissors cut a still picture. placeFor() is
   that rule - from what the clip shows now (a rectangle of its file, `view`, drawn in a box of the
   frame, `box`) to the placement (tx, ty, tw, angle) that draws another rectangle of the file with
   the same pixels in the same places.
   ═══════════════════════════════════════════════════════════════════════════ */

// The smallest piece, in shares of the file: a frame narrower than this is a slip of the mouse.
export const MIN = 0.02;

// THE BLUR BEHIND A CROPPED PiP ON MAIN is made of the piece itself; on the lanes above main there is no background and what is
// cut off is gone (false would make it of the whole frame, as a PiP with no crop has it). Both the
// preview (merge-v3/preview-b.js _drawPip) and the render (lib/mv3b-render.js) read this.
export const BLUR_FROM_PIECE = true;

// The forms a frame may keep - the piece's width over its height in its own pixels.
export const SHAPES = { '9:16': 9 / 16, '1:1': 1, '16:9': 16 / 9, '4:5': 4 / 5 };

const r4 = (v) => Math.round(v * 10000) / 10000;

/** The crop as it may be stored, or null for none. Every side inside the file, never smaller than MIN. */
export function normalize(c) {
  if (!c || typeof c !== 'object') return null;
  let x = +c.x, y = +c.y, w = +c.w, h = +c.h;
  if (![x, y, w, h].every(Number.isFinite)) return null;
  w = r4(Math.max(MIN, Math.min(1, w)));
  h = r4(Math.max(MIN, Math.min(1, h)));
  x = r4(Math.max(0, Math.min(1 - w, x)));
  y = r4(Math.max(0, Math.min(1 - h, y)));
  const out = { x, y, w, h };
  if (c.off) out.off = true;
  if (Object.prototype.hasOwnProperty.call(SHAPES, c.shape)) out.shape = c.shape;
  return out;
}

/** The crop a clip is cut by now - null when it has none or it is switched off. */
export function active(clip) {
  const k = clip && clip.crop;
  return (k && !k.off && +k.w > 0 && +k.h > 0) ? k : null;
}

/**
 * THE LARGEST FRAME OF A FORM: `ar` of the piece's pixels, as big as the file allows, its middle where the frame's
 * middle (`cx`, `cy`, shares) is - moved back inside the file where it would hang over an edge.
 */
export function largest(ar, fileAr, cx = 0.5, cy = 0.5) {
  const q = ar / fileAr;                       // the piece's width over its height in shares
  const w = q <= 1 ? q : 1, h = q <= 1 ? 1 : 1 / q;
  const x = Math.max(0, Math.min(1 - w, cx - w / 2)), y = Math.max(0, Math.min(1 - h, cy - h / 2));
  return { x, y, w, h };
}

/**
 * Which of a clip's pictures a rectangle of the file belongs to: most clips show one (`maps` of one), a framed clip's whole
 * frame over its blur or two bands show two - the one whose part of the file holds the rectangle's middle, else the first.
 * A map: { view: { x, y, w, h } - shares of the file, box: { cx, cy, dw, dh, angle } - frame pixels }.
 */
export function pickMap(maps, k) {
  if (!maps || !maps.length) return null;
  if (!k) return maps[0];
  const mx = +k.x + (+k.w) / 2, my = +k.y + (+k.h) / 2;
  return maps.find((m) => mx >= m.view.x && mx <= m.view.x + m.view.w && my >= m.view.y && my <= m.view.y + m.view.h) || maps[0];
}

/**
 * THE SCISSORS: the placement that draws the file's rectangle `to` (shares) with the pixels where `map` draws them -
 * the same scale, the same turn, the same place on the frame. W, H - the frame in the pixels of `map.box`. The numbers are kept
 * within what a placement may hold (timeline-b.js _write): the middle on the frame, the width 0.04-4 of it.
 * `whole` - when `to` is only a PART of the box the placement sizes (a band of a PiP framed into two): where the part lies in
 * it - its middle off the box's middle (`ox`, `oy`) and its width (`f`), in widths of the box (preview-b.js mapsOf).
 */
export function placeFor(map, to, W, H, whole) {
  const v = map.view, b = map.box;
  const Sx = b.dw / Math.max(1e-6, v.w), Sy = b.dh / Math.max(1e-6, v.h);
  let lx = ((+to.x + (+to.w) / 2) - (v.x + v.w / 2)) * Sx;
  let ly = ((+to.y + (+to.h) / 2) - (v.y + v.h / 2)) * Sy;
  let pw = (+to.w) * Sx;
  if (whole && +whole.f > 0) {
    const bw = pw / whole.f;
    lx -= (+whole.ox || 0) * bw;
    ly -= (+whole.oy || 0) * bw;
    pw = bw;
  }
  const a = (+b.angle || 0) * Math.PI / 180;
  const cx = b.cx + lx * Math.cos(a) - ly * Math.sin(a);
  const cy = b.cy + lx * Math.sin(a) + ly * Math.cos(a);
  const out = {
    tw: Math.max(0.04, Math.min(4, pw / W)),
    tx: Math.max(0, Math.min(1, cx / W)),
    ty: Math.max(0, Math.min(1, cy / H)),
  };
  if (+b.angle) out.angle = Math.round(+b.angle);
  return out;
}

/**
 * The frame after a side or a corner of it is dragged on the preview (merge-v3/place-b.js): every side inside the file. `part` 'n' 's' 'e'
 * 'w' or a corner ('nw' ...), `k0` the frame at the press, `p0` / `p` the pointer at the press and now, in shares of the file;
 * `q` the shape to keep, width over height in shares, or 0 for free. A kept shape grows the other way about its middle.
 */
export function dragFrame(part, k0, p0, p, q) {
  const cl = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const minW = q ? Math.max(MIN, MIN * q) : MIN, minH = q ? minW / q : MIN;
  if (part.length === 2) {
    const east = part[1] === 'e', south = part[0] === 's';
    const ax = east ? k0.x : k0.x + k0.w, ay = south ? k0.y : k0.y + k0.h;
    const maxW = east ? 1 - ax : ax, maxH = south ? 1 - ay : ay;
    let w = cl(Math.abs(cl(p.x, 0, 1) - ax), minW, maxW), h = cl(Math.abs(cl(p.y, 0, 1) - ay), minH, maxH);
    if ((east ? p.x < ax : p.x > ax)) w = minW;
    if ((south ? p.y < ay : p.y > ay)) h = minH;
    if (q) {
      w = Math.max(w, h * q);
      w = Math.min(w, maxW, maxH * q);
      w = Math.max(w, minW);
      h = w / q;
    }
    return { x: east ? ax : ax - w, y: south ? ay : ay - h, w, h };
  }
  if (part === 'e' || part === 'w') {
    const east = part === 'e';
    const ax = east ? k0.x : k0.x + k0.w;
    let w = cl(east ? p.x - ax : ax - p.x, minW, east ? 1 - ax : ax);
    let y = k0.y, h = k0.h;
    if (q) {
      const my = k0.y + k0.h / 2;
      w = Math.min(w, 2 * Math.min(my, 1 - my) * q);
      w = Math.max(w, minW);
      h = w / q; y = my - h / 2;
    }
    return { x: east ? ax : ax - w, y, w, h };
  }
  const south = part === 's';
  const ay = south ? k0.y : k0.y + k0.h;
  let h = cl(south ? p.y - ay : ay - p.y, minH, south ? 1 - ay : ay);
  let x = k0.x, w = k0.w;
  if (q) {
    const mx = k0.x + k0.w / 2;
    h = Math.min(h, 2 * Math.min(mx, 1 - mx) / q);
    h = Math.max(h, minH);
    w = h * q; x = mx - w / 2;
  }
  return { x, y: south ? ay : ay - h, w, h };
}

/** The frame slid inside the file by `dx`, `dy` (shares of it) - the picture moved inside a frame that stays. */
export function panFrame(k0, dx, dy) {
  return { x: Math.max(0, Math.min(1 - k0.w, k0.x + dx)), y: Math.max(0, Math.min(1 - k0.h, k0.y + dy)), w: k0.w, h: k0.h };
}
