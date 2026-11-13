/* ═══════════════════════════════════════════════════════════════════════════
   THE PAUSES SHORTENED - the cuts of "cut silence" (every pause longer than X shortened to X - half kept after the sound
   before it, half before the sound after), as ONE rule for the page and the server (a lecture's pieces are cut by it as
   highlights lays them - lib/highlights-pauses.js).
   Merge's button S plans by it (js/merge-v3/tl-silence.js, js/merge-v3/tl-cut.js silenceCut, which re-exports these); where
   the sound is silent is lib/track-pauses.js's. Pure.
   ═══════════════════════════════════════════════════════════════════════════ */

const r2 = (v) => Math.round(v * 100) / 100;
const EPS = 1e-6;

/** How long a sound fades into and out of a seam cut silence leaves - measured: no click, nothing heard. */
export const SEAM_FADE = 0.015;
/** A cut shorter than this is not made - a hundredth on the timeline's own grid. */
export const MIN_SILENCE_CUT = 0.02;
/** A piece of main audio's clip left between two cuts, or between a cut and the clip's own edge, is at least this long - a
 *  shorter one is a picture flashing for a frame or two: the cuts beside it give it back the room. */
export const MIN_KEEP = 0.1;

/**
 * The cuts that shorten every pause longer than `keep` to `keep`: [[a, b], ...] timeline seconds in -> [{ a, b }] out,
 * in order, on the timeline's hundredths, each at least MIN_SILENCE_CUT. `walls` - the moments main audio's clips start and
 * end: no piece left between a cut and a wall, or between two cuts, is shorter than MIN_KEEP.
 */
export function cutsOfPauses(pauses, keep, walls) {
  const k = Math.max(0, +keep || 0);
  // Onto the timeline's hundredths INWARDS - what is kept is never less than asked (0.01 kept as 0.005 a side would round
  // to nothing).
  const up = (v) => Math.ceil(v * 100 - 1e-6) / 100, down = (v) => Math.floor(v * 100 + 1e-6) / 100;
  const out = [];
  for (const p of (pauses || [])) {
    const a = up(+p[0] + k / 2), b = down(+p[1] - k / 2);
    if (b - a >= MIN_SILENCE_CUT - EPS) out.push({ a, b });
  }
  out.sort((x, y) => x.a - y.a);
  const cuts = out.filter((c, i) => !i || c.a >= out[i - 1].b - EPS);
  // No flash of a frame or two: the piece before each cut - back to the cut before it or to a wall - at least MIN_KEEP,
  // the room taken from the cuts beside it; and so the piece after a cut up to the next wall.
  const W = (walls || []).map(Number).filter(Number.isFinite).sort((x, y) => x - y);
  for (let i = 0; i < cuts.length; i++) {
    const c = cuts[i], prev = i ? cuts[i - 1] : null, next = cuts[i + 1] || null;
    const wl = W.filter((w) => w <= c.a + EPS && (!prev || w >= prev.b - EPS)).pop();
    if (wl != null && c.a - wl < MIN_KEEP - EPS) c.a = up(wl + MIN_KEEP);
    else if (wl == null && prev && c.a - prev.b < MIN_KEEP - EPS) {
      const need = MIN_KEEP - (c.a - prev.b);
      prev.b = down(prev.b - need / 2);
      c.a = up(c.a + need / 2);
    }
    const wr = W.find((w) => w >= c.b - EPS && (!next || w <= next.a + EPS));
    if (wr != null && wr - c.b < MIN_KEEP - EPS) c.b = down(wr - MIN_KEEP);
  }
  return cuts.filter((c) => c.b - c.a >= MIN_SILENCE_CUT - EPS);
}

/** Where moment `t` of the timeline is after `cuts` ({ a, b }, in order, apart) are made - inside a cut, at its start. */
export function mapThrough(cuts, t) {
  let gone = 0;
  for (const c of (cuts || [])) {
    if (t >= c.b) gone += c.b - c.a;
    else if (t > c.a) return r2(c.a - gone);
    else break;
  }
  return r2(t - gone);
}
