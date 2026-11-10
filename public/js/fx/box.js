/* ═══════════════════════════════════════════════════════════════════════════
   A CLIP'S WINDOW - where an effect's GRAPHICS are drawn (phase V84 block 4b, the owner's (б4-11): "вариант Б" - inside the clip's
   window). Main video and a clip that covers the frame: the whole frame. A clip of a lane above main that is PLACED (`tw`) or CUT
   (its crop on): its rectangle with its turn - a frame of light round it, sparkles in it, a card inside it. ONE rule for the
   preview (js/merge-v3/preview-b.js _showAs) and the app's bake window (js/bake-worker.js), written after the preview's own
   _place / _pipRect: the file's size `sw` x `sh` (its shape is what counts), `tw` of the frame's width, its middle at `tx` / `ty`,
   `angle` degrees; a cut clip's shape is its piece's.
     windowOf(c, main, sw, sh, W, H) -> { cx, cy, w, h, angle }   (the frame's pixels, its middle; angle in degrees)
   ═══════════════════════════════════════════════════════════════════════════ */

const _crop = (c) => {
  const k = c && c.crop;
  return (k && !k.off && +k.w > 0 && +k.h > 0) ? k : null;
};

export function windowOf(c, main, sw, sh, W, H) {
  const whole = { cx: W / 2, cy: H / 2, w: W, h: H, angle: 0 };
  if (main || !c) return whole;
  const placed = c.tw != null && +c.tw > 0;
  const K = _crop(c);
  if (!placed && !K) return whole;
  if (!(sw > 0 && sh > 0)) return whole;
  let dw, dh;
  if (K) {
    // preview-b.js _pipRect: the piece's shape; its own width when nobody sized it - as wide as the frame lets it be.
    const ar = (K.w * sw) / (K.h * sh);
    dw = Math.max(2, placed ? +c.tw * W : Math.min(W, H * ar));
    dh = dw / ar;
  } else {
    // preview-b.js _place: a placed insert keeps the file's shape.
    dw = Math.max(2, +c.tw * W);
    dh = Math.max(2, dw * (sh / sw));
  }
  const cx = (placed && c.tx != null ? +c.tx : 0.5) * W;
  const cy = (placed && c.ty != null ? +c.ty : 0.5) * H;
  return { cx, cy, w: dw, h: dh, angle: +c.angle || 0 };
}
