/* ═══════════════════════════════════════════════════════════════════════════
   CAPTIONS — A SUBTITLE PAGE COMES IN AND GOES OUT (phase V49, point 8a; the owner's (пр16)-(пр18), (пр20), 2026-10-25).

   A page of the subtitle lane may wear an In and an Out (style.js `enter` / `leave`): motions of the WHOLE page - it fades,
   pops, zooms, grows, comes from the top, from below, from a side, drops with a bounce, blurs in, swings; it fades, pops,
   shrinks, zooms, goes up, down, to a side, falls, blurs out. No motion of single words or letters: the spoken word is lit
   word by word (ass.js), and that stays exactly as it is while the page moves ((пр16)).

   HOW, IN LIBASS (ass.js writes it; the render and the preview's JASSUB draw it alike). The page keeps its own anchor and
   place - at rest it is the very drawing of a page without motion (a box drawn from the page's middle lands on a half pixel
   and shows its seams). Its In lives in the page's own events, whose words keep their moments: the alpha by \fad, the size,
   blur and turn by a chain of \t sampled from the motion's curve (so an overshoot or a bounce is drawn by libass alone),
   repeated in every block a \r starts. A TRAVEL is a turn about a point a million pixels away (\org): the page moves along
   an arc so wide it is a straight line, eased like any \t - \move is linear, and only one to an event. A page grows from its
   anchor (its bottom, for a page at the bottom), so while it grows it also travels by half of what it grew: it grows about
   its middle. A swing turns about the page's middle (\org there). Its Out is a second set of events over the page's last moments, its words
   carried on from where they were (ass.js shifts them), so an Out can travel another way than the In. The spoken word of a
   pop or a bounce grows with the page: its growth and the page's scale are ONE chain (popScale) - two chains of \fscx fight.

   LENGTHS ARE THE APP'S ((пр18)): about 0.25 s in and 0.2 s out (a drop's bounce 0.32 s, a swing 0.3 s), never more than a
   third of the page; a travel is about two line heights, with a fade - never from beyond the frame's edge.

   NOTHING CHOSEN, NOTHING NEW ((пр20) and the byte check): a page with no Out and no In of its own is drawn exactly as before -
   the preset's `appear` (pop, fade, slide) the old way. `at-once` is an In chosen to be none: the preset's `appear` goes too.
   With an Out and no In, the preset's `appear` is the page's In, drawn here (pop -> pop, fade -> fade, slide -> from below).

   Motions are our own, after ideas from pycaps and Video-Stuff (MIT; fade / pop / zoom / slide in and out, 0.2-0.4 s) - no
   code taken. PURE: numbers and tag strings.
   ═══════════════════════════════════════════════════════════════════════════ */

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const outC = (t) => 1 - Math.pow(1 - t, 3);
const inC = (t) => t * t * t;
const outBack = (t, k) => 1 + (k + 1) * Math.pow(t - 1, 3) + k * Math.pow(t - 1, 2);
function outBounce(t) {
  const n = 7.5625, d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) { t -= 1.5 / d; return n * t * t + 0.75; }
  if (t < 2.5 / d) { t -= 2.25 / d; return n * t * t + 0.9375; }
  t -= 2.625 / d;
  return n * t * t + 0.984375;
}
const R = Math.round;
const f1 = (v) => String(Math.round(v * 10) / 10);
const f6 = (v) => String(Math.round(v * 1e6) / 1e6);
// A pop's size: from `from` up to `over` at `at`, then down to 100.
const popS = (p, from, over, at) => (p < at ? lerp(from, over, outC(p / at)) : lerp(over, 100, (p - at) / (1 - at)));

// ── The motions ─────────────────────────────────────────────────────────────
// `a`: the share of its length over which the page becomes seen (In) or unseen (Out); `f(p)`: how far it is off its rest at
// progress p (0..1) - { s percent, blur px, rz degrees counter-clockwise, dx / dy line heights (right / down) }; `len`: its
// length when not the usual. Keyed by style.js ENTERS / LEAVES (the subtitle lane's part of them).
const IN = {
  fade: { a: [0, 1], f: () => ({}) },
  pop: { a: [0, 0.3], f: (p) => ({ s: popS(p, 50, 110, 0.6) }) },
  zoom: { a: [0, 0.7], f: (p) => ({ s: lerp(150, 100, outC(p)), blur: lerp(6, 0, outC(p)) }) },
  grow: { a: [0, 0.5], f: (p) => ({ s: lerp(40, 100, outBack(p, 1.2)) }) },
  'from-top': { a: [0, 0.8], f: (p) => ({ dy: lerp(-2, 0, outC(p)) }) },
  rise: { a: [0, 0.8], f: (p) => ({ dy: lerp(2, 0, outC(p)) }) },
  'from-left': { a: [0, 0.7], f: (p) => ({ dx: lerp(-2, 0, outC(p)) }) },
  'from-right': { a: [0, 0.7], f: (p) => ({ dx: lerp(2, 0, outC(p)) }) },
  drop: { a: [0, 0.2], len: 0.32, f: (p) => ({ dy: lerp(-2.5, 0, outBounce(p)) }) },
  blur: { a: [0, 1], f: (p) => ({ blur: lerp(12, 0, outC(p)), s: lerp(106, 100, outC(p)) }) },
  swing: { a: [0, 0.3], len: 0.3, f: (p) => ({ rz: lerp(-14, 0, outBack(p, 2.6)), s: lerp(60, 100, outBack(p, 1.6)) }) },
};
const OUT = {
  fade: { a: [0, 1], f: () => ({}) },
  pop: { a: [0.55, 1], f: (p) => ({ s: p < 0.3 ? lerp(100, 110, outC(p / 0.3)) : lerp(110, 40, inC((p - 0.3) / 0.7)) }) },
  shrink: { a: [0.4, 1], f: (p) => ({ s: lerp(100, 30, inC(p)) }) },
  zoom: { a: [0, 1], f: (p) => ({ s: lerp(100, 150, inC(p)), blur: lerp(0, 6, p) }) },
  rise: { a: [0.2, 1], f: (p) => ({ dy: lerp(0, -2, inC(p)) }) },
  sink: { a: [0.2, 1], f: (p) => ({ dy: lerp(0, 2, inC(p)) }) },
  'to-left': { a: [0.3, 1], f: (p) => ({ dx: lerp(0, -2, inC(p)) }) },
  'to-right': { a: [0.3, 1], f: (p) => ({ dx: lerp(0, 2, inC(p)) }) },
  fall: { a: [0.45, 1], f: (p) => ({ dy: lerp(0, 3, inC(p)) }) },
  blur: { a: [0, 1], f: (p) => ({ blur: lerp(0, 12, p), s: lerp(100, 106, p) }) },
};
/** The In and Out a subtitle page can wear, in the order the strip and the tiles offer them. */
export const PAGE_ENTERS = ['fade', 'pop', 'zoom', 'grow', 'from-top', 'rise', 'from-left', 'from-right', 'drop', 'blur', 'swing'];
export const PAGE_LEAVES = ['fade', 'pop', 'shrink', 'zoom', 'rise', 'sink', 'to-left', 'to-right', 'fall', 'blur'];
const IN_LEN = 0.25, OUT_LEN = 0.2;
// The preset's own way of arriving (`appear`, K3), as an In.
export const APPEAR_AS = { pop: 'pop', fade: 'fade', slide: 'rise' };
// How far away the point a travel turns about is, px: a page 2 line heights off turns by under a hundredth of a degree.
const FAR = 1e6;

/** The In a page shows: its own; while none is chosen, its preset's `appear` read as one; '' for none ('at-once'). */
export function shownEnter(st) {
  const s = st || {};
  if (s.enter === 'at-once') return '';
  if (IN[s.enter]) return s.enter;
  return APPEAR_AS[s.appear] || '';
}

/**
 * HOW A SUBTITLE PAGE MOVES, for a style `st` (resolved) and a page `life` seconds long: null when it is drawn as before (no
 * Out and no In of its own - the preset's `appear` included), else { enter, leave } - each { key, ms, pts, a, axis, keys } or
 * null: its length (ms), the curve sampled (pts [{ t ms, s, blur, rz, dx, dy }]), when it becomes seen or unseen (a [ms, ms]),
 * which way it travels ('v', 'h' or ''), and which of s, blur, rz, travel change at all.
 */
export function pageMotion(st, life) {
  const s = st || {};
  const own = s.enter !== 'none' && s.enter !== 'at-once' && IN[s.enter] ? s.enter : '';
  const leave = OUT[s.leave] ? s.leave : '';
  if (!own && !leave) return null;
  const enter = shownEnter(s);
  const third = Math.max(0.02, (+life || 0) / 3);
  const part = (key, spec, entering) => {
    const sec = Math.min(spec.len || (entering ? IN_LEN : OUT_LEN), third);
    const ms = Math.max(20, R(sec * 100) * 10);
    const n = clamp(Math.ceil(ms / 40), 2, 10);
    const pts = [];
    for (let k = 0; k <= n; k++) {
      const v = spec.f(k / n);
      pts.push({ t: R(ms * k / n), s: v.s == null ? 100 : v.s, blur: v.blur || 0, rz: v.rz || 0, dx: v.dx || 0, dy: v.dy || 0 });
    }
    const varies = (k) => pts.some((q) => Math.abs(q[k] - pts[0][k]) > 1e-6);
    const axis = varies('dy') ? 'v' : varies('dx') ? 'h' : '';
    const keys = { s: varies('s'), blur: varies('blur'), rz: varies('rz'), travel: !!axis };
    return { key, ms, pts, a: [R(spec.a[0] * ms), R(spec.a[1] * ms)], axis, keys, entering };
  };
  return { enter: enter ? part(enter, IN[enter], true) : null, leave: leave ? part(leave, OUT[leave], false) : null };
}

// The turn that travels a page `d` pixels along its axis (the point turned about FAR away: 'v' to its right, 'h' below it).
const _turn = (axis, d) => (axis === 'v' ? 1 : -1) * Math.asin(clamp(d / FAR, -1, 1)) * 180 / Math.PI;

/**
 * Which way a part travels on a page anchored `an` (libass's numpad): its own way - or 'v' for a page that grows from its top
 * or its bottom and must travel by half of it to grow about its middle (not while it turns: that needs \org at its middle).
 */
export function axisOf(part, an) {
  if (!part) return '';
  if (part.axis) return part.axis;
  return part.keys.s && !part.keys.rz && an !== 5 ? 'v' : '';
}

/**
 * The event's own tags for a moving page: its anchor `an` at (x, y) as it is drawn at rest, the point it turns about - far
 * away for a travel (`axis`, axisOf), its middle (cx, cy) for a swing - no wrapping by libass (the lines are broken by the
 * rule; a page grown by a zoom must not wrap), and its alpha over the motion. `evMs` - the event's length.
 */
export function placeTags(part, an, x0, y0, cx, cy, axis, evMs) {
  const x = R(x0), y = R(y0);
  let t = '\\an' + an + '\\pos(' + x + ',' + y + ')';
  if (axis === 'v') t += '\\org(' + (x + FAR) + ',' + y + ')';
  else if (axis === 'h') t += '\\org(' + x + ',' + (y + FAR) + ')';
  else if (part && part.keys.rz) t += '\\org(' + R(cx) + ',' + R(cy) + ')';
  t += '\\q2';
  if (part) {
    const [a0, a1] = part.a;
    if (part.entering) t += a0 <= 0 ? '\\fad(' + a1 + ',0)' : '\\fade(255,0,0,' + a0 + ',' + a1 + ',' + evMs + ',' + evMs + ')';
    else t += '\\fade(0,0,255,0,0,' + a0 + ',' + a1 + ')';
  }
  return '{' + t + '}';
}

/**
 * The tags of one block for a motion: where it starts, and a chain of \t to where it ends. `base`: { sx, sy, blur, lh, axis,
 * grows } - the style's scale, the blur the layer has at rest, the line height (px), axisOf, and how far the page's middle
 * moves per unit it grows (half its height: + for a page anchored at its bottom, - at its top). `noScale`: the spoken word's
 * layer of a pop or a bounce, whose scale is popScale's. Nothing for no motion.
 */
export function motionTags(part, base, noScale) {
  if (!part) return '';
  const k = part.keys;
  const axis = base.axis || '';
  const val = (q) => {
    let t = '';
    if (k.s && !noScale) t += '\\fscx' + f1(base.sx * q.s / 100) + '\\fscy' + f1(base.sy * q.s / 100);
    if (k.blur) t += '\\blur' + f1((base.blur || 0) + q.blur);
    if (k.rz || axis) {
      let d = axis === 'v' ? q.dy * base.lh : axis === 'h' ? q.dx * base.lh : 0;
      if (axis === 'v' && k.s && !k.rz) d += (base.grows || 0) * (q.s / 100 - 1);
      t += '\\frz' + f6(q.rz + (axis ? _turn(axis, d) : 0));
    }
    return t;
  };
  const first = val(part.pts[0]);
  if (!first) return '';
  let out = first;
  for (let i = 1; i < part.pts.length; i++) out += '\\t(' + part.pts[i - 1].t + ',' + part.pts[i].t + ',' + val(part.pts[i]) + ')';
  return out;
}

// A piecewise-linear value of [{ t, v }] at t, held before the first point and after the last.
function _at(pts, t) {
  if (t <= pts[0].t) return pts[0].v;
  for (let i = 1; i < pts.length; i++) {
    if (t <= pts[i].t) { const a = pts[i - 1], b = pts[i]; return b.t === a.t ? b.v : lerp(a.v, b.v, (t - a.t) / (b.t - a.t)); }
  }
  return pts[pts.length - 1].v;
}

/**
 * The spoken word of a pop or a bounce (ass.js's layer +3) on a moving page: its size is the page's (the motion, `part` -
 * null for none) times its own growth - `s` its moment in the event (ms; before 0 when it began before the event), `grow` {
 * x, y, up, down } (percent at the top, ms to the top and back) - as ONE chain of \t. `sx`, `sy` the style's scale.
 */
export function popScale(part, base, s, grow) {
  const page = part ? part.pts.map((q) => ({ t: q.t, v: part.keys.s ? q.s : 100 })) : [{ t: 0, v: 100 }];
  const gx = [{ t: s, v: 100 }, { t: s + grow.up, v: grow.x }, { t: s + grow.down, v: 100 }];
  const gy = [{ t: s, v: 100 }, { t: s + grow.up, v: grow.y }, { t: s + grow.down, v: 100 }];
  const times = [...new Set([0].concat(page.map((q) => q.t), gx.map((q) => q.t)).filter((t) => t >= 0))].sort((a, b) => a - b);
  const X = (t) => f1(base.sx * _at(page, t) / 100 * _at(gx, t) / 100);
  const Y = (t) => f1(base.sy * _at(page, t) / 100 * _at(gy, t) / 100);
  let out = '\\fscx' + X(times[0]) + '\\fscy' + Y(times[0]);
  for (let i = 1; i < times.length; i++) {
    const a = times[i - 1], b = times[i];
    if (X(a) === X(b) && Y(a) === Y(b)) continue;
    out += '\\t(' + R(a) + ',' + R(b) + ',\\fscx' + X(b) + '\\fscy' + Y(b) + ')';
  }
  return out;
}
