/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — the three effects, as a canvas can show them.

   The other half of animChain / gradeChain / transChain in lib/mv3b-render.js. That file
   decides what the FILE looks like; this one decides what the SCREEN looks like, and the two
   are written from the same numbers - a zoom of 1.15 over the clip, a paired fade of 0.35s at
   each end, the same teal-and-orange grade - so that watching the preview is a way of
   deciding rather than a thing to be checked against the export afterwards.

   THE CANVAS CANNOT DO EVERYTHING FFMPEG CAN, and where it cannot, this says so instead of
   drawing something close. Two of the twenty are honestly out of reach:

     • noise      - glitch and the grain in vhs. Drawing per-pixel noise every frame at
                    540x960 costs more than the whole rest of the paint loop, for a texture
                    nobody composes against;
     • sharpen    - a convolution, which canvas has no filter for at all.

   Both are named on screen while they are selected, the way the other timeline names the
   reverse it cannot show. The rest - fades, blurs, zooms, punches, vignette, and every colour
   grade - are drawn, approximately in the two tinted cases and exactly in the rest.

   A blur is round here and directional in the render: whip-pan smears along one axis, and
   canvas has one blur that goes every way at once. The timing and the strength are right and
   the direction is not, which for a 0.35s smear is the difference nobody sees.
   ═══════════════════════════════════════════════════════════════════════════ */

const FD = 0.35;
const ZOOM = 1.15;        // the animation's push, same as animChain
const PUNCH = 0.20;       // the transition's punch, same as transChain's zf - 1

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const named = (v) => (v && v !== 'none' ? String(v) : '');

// Colour grades that are a tint over the picture rather than a change to it. Drawn in
// `overlay`, which darkens what is dark and lightens what is light - much closer to what a
// gamma shift does than painting a flat colour on top.
const TINT = {
  warm:      'rgba(255, 168, 88, 0.18)',
  cool:      'rgba(88, 152, 255, 0.18)',
  cinematic: 'rgba(0, 148, 160, 0.16)',
};

// Grades the browser has a filter for. Exact where the name matches (grayscale, sepia),
// approximate where it stands in for something else.
const CSS = {
  bw:        'grayscale(1)',
  sepia:     'sepia(1)',
  cinematic: 'saturate(1.12) contrast(1.06)',
  vhs:       'saturate(0.87) contrast(1.03)',
};

// What cannot be drawn, in the words the panel uses.
const GAP = { glitch: 'glitch', sharpen: 'sharpen', vhs: 'vhs grain' };

/**
 * Everything the paint loop needs for one clip at one moment.
 * @returns {{zoom:number, css:string, tint:string, vignette:number, veil:{color:string,alpha:number}|null, gap:string}}
 */
export function fxAt(c, at) {
  const dur = +c.dur || 0;
  const into = at - (+c.start || 0);
  const p = dur > 0 ? clamp01(into / dur) : 0;

  const anim = named(c.animation);
  const grade = named(c.filter);
  const trans = named(c.transition);

  let zoom = 1, blur = 0, veil = null, gap = '';

  if (anim === 'zoom_in') zoom *= 1 + (ZOOM - 1) * p;
  else if (anim === 'zoom_out') zoom *= ZOOM - (ZOOM - 1) * p;

  if (trans) {
    // The two ends of the same clip, each a ramp from full at the edge to nothing inward.
    const d = Math.min(FD, dur / 3) || 0.0001;
    const head = clamp01((d - into) / d);
    const tail = clamp01((into - (dur - d)) / d);
    const edge = Math.max(head, tail);
    switch (trans) {
      case 'fade': if (edge > 0) veil = { color: '0,0,0', alpha: edge }; break;
      case 'fadewhite':
      case 'flash-white': if (edge > 0) veil = { color: '255,255,255', alpha: edge }; break;
      case 'blur': blur = 20 * edge; break;
      case 'whip-pan-h':
      case 'whip-pan-v': blur = 30 * edge; break;
      case 'zoom-punch-in': zoom *= 1 + PUNCH * head; break;
      case 'zoom-punch-out': zoom *= 1 + PUNCH * tail; break;
      case 'glitch': if (edge > 0) gap = 'glitch'; break;
      default: break;
    }
  }

  const css = [CSS[grade] || '', blur > 0.4 ? 'blur(' + blur.toFixed(1) + 'px)' : ''].filter(Boolean).join(' ');
  if (GAP[grade]) gap = GAP[grade];

  return {
    zoom,
    css,
    tint: TINT[grade] || '',
    vignette: grade === 'vignette' ? 0.78 : 0,
    veil,
    gap,
  };
}

/** Whether anything at all has to be done for this clip - the common answer is no. */
export const hasFx = (c) => !!(named(c.animation) || named(c.filter) || named(c.transition));

// ── Painting the parts a drawImage cannot carry ─────────────────────────────
// All three are painted into the clip's own rectangle rather than the whole frame: a clip may
// be an inset one day, and a vignette over the stage instead of over the picture would be a
// different effect wearing the same name.

export function paintTint(ctx, fx, r) {
  if (!fx.tint) return;
  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.fillStyle = fx.tint;
  ctx.fillRect(r.dx, r.dy, r.dw, r.dh);
  ctx.restore();
}

export function paintVignette(ctx, fx, r) {
  if (!fx.vignette) return;
  const cx = r.dx + r.dw / 2, cy = r.dy + r.dh / 2;
  const outer = Math.max(r.dw, r.dh) * 0.72;
  const g = ctx.createRadialGradient(cx, cy, outer * 0.42, cx, cy, outer);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,' + fx.vignette.toFixed(2) + ')');
  ctx.save();
  ctx.fillStyle = g;
  ctx.fillRect(r.dx, r.dy, r.dw, r.dh);
  ctx.restore();
}

export function paintVeil(ctx, fx, r) {
  if (!fx.veil) return;
  ctx.save();
  ctx.fillStyle = 'rgba(' + fx.veil.color + ',' + fx.veil.alpha.toFixed(3) + ')';
  ctx.fillRect(r.dx, r.dy, r.dw, r.dh);
  ctx.restore();
}

// A zoom is a smaller piece of the SOURCE stretched over the same rectangle, which is what
// zoompan does too - so the picture grows and the frame does not move.
export function zoomRect(r, zoom) {
  if (!(zoom > 1.0001)) return r;
  const w = r.sw / zoom, h = r.sh / zoom;
  return { ...r, sx: r.sx + (r.sw - w) / 2, sy: r.sy + (r.sh - h) / 2, sw: w, sh: h };
}

/** One line naming what is on the timeline but not on the screen, or ''. */
export function gapNote(gaps) {
  const list = [...new Set(gaps.filter(Boolean))];
  if (!list.length) return '';
  return list.join(' · ') + (list.length > 1 ? ' are not previewed' : ' is not previewed');
}
