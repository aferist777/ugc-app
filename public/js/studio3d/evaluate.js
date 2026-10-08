/* ════════════════════════════════════════════════════════════════════════════
   3D STUDIO — where everything is at a moment of a fragment (PLAN "3D Studio", 3D2).

   ONE pure function of time: evaluate(scene, fragment, t) gives every object's position, turn, size and
   visibility at t, from the scene's one arrangement and the fragment's keys. Nothing is accumulated from frame to
   frame, so scrubbing, playing and recording all see the same thing - and every camera of a recording can be drawn
   from the same moment (Unreal, Cinemachine, CozyClay all work this way; PLAN "Что взято из чужих проектов").
   No three.js in here: the server reads it too (the agent's checks, 3D5).

   A fragment: { id, name, length (s, at most 30), tracks: { <object id>: { p: [key], r: [key], s: [key], v: [key] } } }
   A key:      { t (s), v: value, ease } - the ease shapes the stretch from this key to the NEXT one:
               'linear' | 'smooth' (slow in and out) | 'abrupt' (fast start - "встаёт резко") | 'gentle' (slow start)
               | 'hold' (stays until the next key) | [x1, y1, x2, y2] (a CSS cubic-bezier).
   p and s are [x, y, z]; r is degrees [x, y, z] in three.js XYZ order, interpolated as a quaternion along the
   shorter way - or, when the turn round Y between two keys is 180° or more, round Y degree by degree, so a full
   turn keyed 0 -> 360 turns; v is 1 or 0. An object with no track in the fragment stands where the arrangement has it.
   ════════════════════════════════════════════════════════════════════════════ */

export const FPS = 24;
export const MAX_LENGTH = 30;
export const CHANNELS = ['p', 'r', 's', 'v'];
export const EASES = ['linear', 'smooth', 'abrupt', 'gentle', 'hold'];
const PRESET = { linear: [0, 0, 1, 1], smooth: [0.42, 0, 0.58, 1], abrupt: [0.05, 0.7, 0.2, 1], gentle: [0.6, 0, 0.9, 0.4] };

/** Times are kept to a tenth of a millisecond; two keys closer than half a frame are one moment. */
export const roundT = (t) => Math.round(t * 10000) / 10000;
export const sameMoment = (a, b) => Math.abs(a - b) < 0.5 / FPS;
export const snapToFrame = (t) => Math.round(t * FPS) / FPS;

// ── Easing: a CSS cubic-bezier, x(u) solved for the time share ───────────────
function _bezier(x1, y1, x2, y2, x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const X = (u) => ((ax * u + bx) * u + cx) * u;
  const dX = (u) => (3 * ax * u + 2 * bx) * u + cx;
  let u = x;
  for (let i = 0; i < 8; i++) {
    const d = dX(u);
    if (Math.abs(d) < 1e-6) break;
    const nu = u - (X(u) - x) / d;
    if (nu < 0 || nu > 1) break;
    u = nu;
  }
  let lo = 0, hi = 1;                     // bisection, should Newton have wandered
  if (Math.abs(X(u) - x) > 1e-4) {
    u = x;
    for (let i = 0; i < 30; i++) { if (X(u) < x) lo = u; else hi = u; u = (lo + hi) / 2; }
  }
  return ((ay * u + by) * u + cy) * u;
}
export function ease(kind, x) {
  if (kind === 'hold') return 0;
  const b = Array.isArray(kind) && kind.length === 4 ? kind : PRESET[kind] || PRESET.smooth;
  return _bezier(b[0], b[1], b[2], b[3], x);
}

// ── Turns ────────────────────────────────────────────────────────────────────
const D2R = Math.PI / 180;
function quatFromEuler(e) {                // three.js Euler 'XYZ', degrees -> [x, y, z, w]
  const c1 = Math.cos(e[0] * D2R / 2), c2 = Math.cos(e[1] * D2R / 2), c3 = Math.cos(e[2] * D2R / 2);
  const s1 = Math.sin(e[0] * D2R / 2), s2 = Math.sin(e[1] * D2R / 2), s3 = Math.sin(e[2] * D2R / 2);
  return [s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 + s1 * s2 * c3, c1 * c2 * c3 - s1 * s2 * s3];
}
function eulerFromQuat(q) {                // -> 'XYZ' degrees, as three.js Euler.setFromQuaternion
  const [x, y, z, w] = q;
  const m11 = 1 - 2 * (y * y + z * z), m12 = 2 * (x * y - z * w), m13 = 2 * (x * z + y * w);
  const m22 = 1 - 2 * (x * x + z * z), m23 = 2 * (y * z - x * w);
  const m32 = 2 * (y * z + x * w), m33 = 1 - 2 * (x * x + y * y);
  const ey = Math.asin(Math.max(-1, Math.min(1, m13)));
  let ex, ez;
  if (Math.abs(m13) < 0.9999999) { ex = Math.atan2(-m23, m33); ez = Math.atan2(-m12, m11); }
  else { ex = Math.atan2(m32, m22); ez = 0; }
  return [ex / D2R, ey / D2R, ez / D2R];
}
function slerp(a, b, k) {
  let [bx, by, bz, bw] = b;
  let cos = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (cos < 0) { cos = -cos; bx = -bx; by = -by; bz = -bz; bw = -bw; }   // the shorter way
  if (cos > 0.9995) {
    const r = [a[0] + (bx - a[0]) * k, a[1] + (by - a[1]) * k, a[2] + (bz - a[2]) * k, a[3] + (bw - a[3]) * k];
    const n = Math.hypot(...r) || 1;
    return r.map(v => v / n);
  }
  const th = Math.acos(cos), s = Math.sin(th);
  const wa = Math.sin((1 - k) * th) / s, wb = Math.sin(k * th) / s;
  return [a[0] * wa + bx * wb, a[1] * wa + by * wb, a[2] * wa + bz * wb, a[3] * wa + bw * wb];
}
function turnBetween(a, b, k) {
  const dy = b[1] - a[1];
  // A turn of half a circle or more round Y is a SPIN: degree by degree, the way it was keyed.
  if (Math.abs(dy) >= 180 && Math.abs(b[0] - a[0]) < 1e-6 && Math.abs(b[2] - a[2]) < 1e-6) return [a[0], a[1] + dy * k, a[2]];
  return eulerFromQuat(slerp(quatFromEuler(a), quatFromEuler(b), k));
}

// ── One channel at t ─────────────────────────────────────────────────────────
/** The value of a channel's keys at t (keys sorted by time): before the first and after the last, they hold. */
export function channelAt(keys, ch, t) {
  if (!keys || !keys.length) return null;
  if (t <= keys[0].t) return keys[0].v;
  const last = keys[keys.length - 1];
  if (t >= last.t) return last.v;
  let i = 0;
  while (i < keys.length - 1 && keys[i + 1].t <= t) i++;
  const a = keys[i], b = keys[i + 1];
  const span = b.t - a.t;
  const k = span > 0 ? ease(a.ease || 'smooth', (t - a.t) / span) : 1;
  if (ch === 'v') return k < 1 ? a.v : b.v;
  if (ch === 'r') return turnBetween(a.v, b.v, k);
  return [0, 1, 2].map(j => a.v[j] + (b.v[j] - a.v[j]) * k);
}

/**
 * Every object of the scene at t of the fragment: Map id -> { p, r, s, v, moves }.
 * `moves` - it has a track in this fragment (the "moves" box, the timeline's lanes).
 */
export function evaluate(scene, fragment, t) {
  const out = new Map();
  const tracks = (fragment && fragment.tracks) || {};
  for (const o of (scene && scene.objects) || []) {
    const tr = tracks[o.id];
    const pose = { p: o.p, r: o.r, s: o.s || [1, 1, 1], v: 1, moves: !!tr };
    if (tr) for (const ch of CHANNELS) { const v = channelAt(tr[ch], ch, t); if (v != null) pose[ch] = v; }
    out.set(o.id, pose);
  }
  for (const c of (scene && scene.cameras) || []) {
    const tr = tracks[c.id];
    const pose = { p: c.p, r: c.r, s: [1, 1, 1], v: 1, moves: !!tr };
    if (tr) for (const ch of ['p', 'r']) { const v = channelAt(tr[ch], ch, t); if (v != null) pose[ch] = v; }
    out.set(c.id, pose);
  }
  return out;
}

/** Two turns (degrees, XYZ) that are the same turn - -180 and 180 round Y are one. */
export function sameTurn(a, b) {
  const qa = quatFromEuler(a), qb = quatFromEuler(b);
  return Math.abs(qa[0] * qb[0] + qa[1] * qb[1] + qa[2] * qb[2] + qa[3] * qb[3]) > 1 - 1e-7;
}

/** Put a key at t into a channel: the key already at that moment is replaced, never doubled. Returns the keys. */
export function putKey(keys, t, v, ease) {
  const list = (keys || []).filter(k => !sameMoment(k.t, t));
  const before = (keys || []).find(k => sameMoment(k.t, t));
  list.push({ t: roundT(t), v, ease: ease || (before && before.ease) || 'smooth' });
  return list.sort((a, b) => a.t - b.t);
}
