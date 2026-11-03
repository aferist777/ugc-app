/* ═══════════════════════════════════════════════════════════════════════════
   FRAMING — where a filled clip's window is, at every moment of its FILE (phase V33.2, the owner 2026-10-20/21;
   docs/local-app/PLAN.md "Фаза V33", V33.2 - the measurement and the answers (х7)-(х9)).

   A 16:9 film in a 9:16 frame shows a slice of itself, the full height and a third of the width. Which slice is
   no longer one fixed answer (`cropAlign`) but a PATH over time, worked out from the film's faces (lib/faces.js)
   and kept on the clip (`frame`). This file is the ONE answer the preview (public/js/merge-v3/preview-b.js) and
   the render (lib/mv3b-render.js) both read - the page imports it, the server require()s it - so the screen and
   the file cannot frame a moment differently.

   THE PATH, from the faces ((х7), (х8)):
   - The film is cut into SHOTS where scdet saw the picture change (a camera switch); changes closer than 0.6 s
     are one (a flash, a wipe) and the shot starts after the last of them. At a cut the window JUMPS.
   - In each shot ONE face is followed: the largest, counted over the whole shot (its size times how long it is
     there), and held to the end of the shot ((х8) А).
   - The camera does not chase every move of a head: it stands while the face is in the middle of the window
     (the dead zone, DEAD either side) and, once the face leaves it, eases after it - never faster than SPEED -
     until the face is near the middle again.
   - A face lost for a moment (turned away, a hand over it) keeps its place. A shot with NO face at all - a
     title, a screen, a drawing - shows the whole frame by its width over a blurred copy of itself ((х7) Б).
   - 'bands' (by hand, (х9)): a shot with two faces shows them as two bands one over the other, each following
     its face; any other shot is framed as 'face'.
   - (phase V33.6, the owner 2026-10-21, (х54), (х60), (х60а)) WHOLE PEOPLE, where a film's record has them (lib/faces.js
     `people`, counted in its frames with no face) and the plan is asked to use them (`people`): a shot with NO face, but a
     person in most of its frames (PERSON_SHARE), follows the largest person as it would a face - the window's middle on the
     person's - and is marked `by: 'person'`; with no person it is the whole frame over its blur, as before.
     TWO, STANDING APART - two faces, or two people in a shot with no face, both there for half the shot or more, too far
     apart for one window - are two bands BY THEMSELVES in 'face' too (`autoBands`, on unless said off), one over the other;
     close enough for one window, the largest is followed, as before. A person's band shows the person from the top down.
   - (phase V33.8, the owner 2026-10-23, (ф1): "давай не весь кадр, а как бы увелично немного, типа до 3:2"; since phase V69 P12,
     (хп36), (хп70): a SQUARE, SQUARE below, for every kind and the inspector) A shot with no face is not the whole frame but a
     WINDOW from its middle over the same blur:
     `wide` on the record, the window's shape (w/h); none - the whole frame, as before. wholeW() says how much of the
     width it shows; the preview and the render both draw by it.

   THE RECORD on a clip - `frame`, times in the FILE's seconds (a trim, a split, a copy of the clip keep it right):
     { v, mode: 'face' | 'center' | 'whole' | 'bands', shift (-1..1: the window moved by up to half the room
       left over, either way), src: { w, h }, shots: [{ t0, t1, kind: 'face' | 'whole' | 'bands', by: 'person' (V33.6,
       when it follows people, not faces), keys: [[t, x]], b1: [[t, x, y]], b2: [[t, x, y]] }], band (the bands' height, a
       share of the film's), found (a share of frames with a face), wide (V33.8: a 'whole' shot shows this shape, w/h,
       from the middle - absent: the whole frame) }
     x and y are the window's MIDDLE as fractions of the film's width and height.
   'center' and 'whole' need no faces: the middle (moved by `shift`), or the whole frame over its blur.
   - (phase V43, the owner 2026-10-25, (ё2), (ё13)-(ё16)) THE MOST ACTIVE, fragmentation's only: plan(..., { active }) hands a
     film counted with `active` (lib/faces.js) to active.js - the window goes to the action, the one who reacts, the one who
     speaks, the largest face, a person; never a whole frame over a blur. Its record is a 'face' one, marked `active: 1`, and
     may carry PUNCH-INS: `zooms` [{ t0, t1, z, ax, ay }] - the window scaled by z about the point (ax, ay) of it, in ZOOM_IN s
     from t0, held to t1, back in ZOOM_OUT s; `noZoom` - the clip's switch says none ((ё7а)). zoomAt() is the preview's answer,
     exprZoom() the render's; the bands are never zoomed.
   - (phase V69 P12b, the owner's (хп63), (хп97), (хп98)) THE SPEAKER, podcast's and true crime's: the same planner with
     `active.speaker` - no action, the one who listens while a voice off the screen speaks, a shot with no face the square over
     its blur (a 'whole' shot, `wide` on the record) with no punch-in on it; the record says `speaker: 1`.
   ═══════════════════════════════════════════════════════════════════════════ */

import { planActive, ZOOM_IN, ZOOM_OUT } from './active.js';

export const VERSION = 1;
// (phase V69 P12, the owner's (хп36), (хп70)) "The whole frame over its blur" is a SQUARE from the film's middle: a wide film scaled up
// until the square from its middle fills the frame's width, over its blur - `wide` 1 (w/h). The highlights kinds that show the whole
// frame (lib/highlights-store.js FRAMES) and the inspector's "whole + blur" (merge-v3/framing-ui.js) put it on the record.
export const SQUARE = 1;
export const MODES = ['face', 'center', 'whole', 'bands'];

const CUT_MERGE = 0.6;      // scdet's changes closer than this are one
const HOLD = 2;             // a face lost for less than this keeps its place ((х7))
const NO_FACE = 0.1;        // a shot with a face in fewer of its frames than this has none
const MIN_FACE = 0.015;     // a box narrower than this share of the width is noise
const SAME = 0.09;          // a face in the next frame within this distance (a share of the width) is the same face
const DEAD = 0.2;           // the dead zone: the face may wander this share of the window's width either side of its middle
const SETTLE = 0.05;        // a camera that moves goes on until the face is this near the middle
const SPEED = 0.8;          // its top speed, window widths a second
const EASE = 0.22;          // the share of the way left it covers each frame - a soft start and stop
const TOL = 0.004;          // how far the kept keys may stray from the camera's own path (a share of the width)
const BAND_FACE = 3.2;      // a band shows this many face heights of the film
const PERSON_SHARE = 0.6;   // (V33.6) a shot with no face follows a person who is in at least this share of its frames
const BOTH = 0.5;           // two are "both there" when each is in at least this share of the shot's frames
const APART = 0.95;         // (V33.6) two whose span is wider than this many windows do not fit in one: bands

const r3 = (x) => Math.round(x * 1000) / 1000;
const r2 = (x) => Math.round(x * 100) / 100;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

/** The window's width as a share of the film's width - the full height kept, the frame's shape `aspect` (w/h). */
export function windowW(srcW, srcH, aspect) {
  if (!(srcW > 0) || !(srcH > 0)) return 1;
  return Math.min(1, (srcH * (aspect > 0 ? aspect : 9 / 16)) / srcW);
}

/**
 * (phase V33.8, (ф1)) What a 'whole' shot shows of the film's width, from its middle, the full height kept: 1 - the whole
 * frame; less when the record has `wide` (a documentary's 3:2 of a 16:9 film is 0.84). The preview and the render both cut
 * by it, so the two cannot differ.
 */
export function wholeW(frame, srcW, srcH) {
  const a = +(frame && frame.wide) || 0;
  if (!(a > 0) || !(srcW > 0) || !(srcH > 0)) return 1;
  return Math.min(1, (srcH * a) / srcW);
}

// ── From the faces to a path ────────────────────────────────────────────────
function _shots(cuts, seconds) {
  const merged = [];
  for (const c of (cuts || []).map(Number).filter((c) => c > 0.3 && c < seconds - 0.3).sort((a, b) => a - b)) {
    if (merged.length && c - merged[merged.length - 1] < CUT_MERGE) merged[merged.length - 1] = c;
    else merged.push(c);
  }
  const edges = [0, ...merged, seconds];
  const out = [];
  for (let i = 0; i + 1 < edges.length; i++) if (edges[i + 1] - edges[i] > 0.05) out.push({ t0: edges[i], t1: edges[i + 1] });
  return out.length ? out : [{ t0: 0, t1: seconds }];
}

// One face seen twice (two boxes over each other) is one: the surer box stays.
function _dedupe(boxes) {
  const bs = (boxes || []).filter((b) => b && b[2] >= MIN_FACE).sort((a, b) => (b[4] || 0) - (a[4] || 0));
  const out = [];
  for (const b of bs) {
    const over = out.some((o) => {
      const ix = Math.max(0, Math.min(o[0] + o[2], b[0] + b[2]) - Math.max(o[0], b[0]));
      const iy = Math.max(0, Math.min(o[1] + o[3], b[1] + b[3]) - Math.max(o[1], b[1]));
      return ix * iy > 0.4 * Math.min(o[2] * o[3], b[2] * b[3]);
    });
    if (!over) out.push(b);
  }
  return out;
}

// The faces of frames i0..i1 strung into tracks: a box joins the track whose face was nearest in the frames just before.
function _tracks(frames, i0, i1, fps) {
  const tracks = [];
  for (let i = i0; i < i1; i++) {
    const boxes = _dedupe(frames[i]);
    const taken = new Set();
    for (const b of boxes.sort((a, c) => c[2] * c[3] - a[2] * a[3])) {
      const cx = b[0] + b[2] / 2, cy = b[1] + b[3] / 2;
      let best = null, bd = Infinity;
      for (const t of tracks) {
        if (taken.has(t) || i - t.last > HOLD * fps) continue;
        const d = Math.hypot(cx - t.lx, (cy - t.ly) * 0.5);
        if (d < SAME + (i - t.last) * 0.01 && d < bd) { bd = d; best = t; }
      }
      if (!best) { best = { pts: [], last: i, lx: cx, ly: cy, weight: 0 }; tracks.push(best); }
      taken.add(best);
      best.pts.push([i, cx, cy, b[2], b[3]]);
      best.last = i; best.lx = cx; best.ly = cy;
      best.weight += b[2] * b[3];
    }
  }
  return tracks;
}

// A track's centre at every frame of the shot: held across a gap, the first sighting before it was seen, the last after.
function _series(track, i0, i1, k) {
  const out = new Array(i1 - i0);
  let j = 0;
  for (let i = i0; i < i1; i++) {
    while (j + 1 < track.pts.length && track.pts[j + 1][0] <= i) j++;
    const p = track.pts[j][0] <= i ? track.pts[j] : track.pts[0];
    out[i - i0] = p[k];
  }
  // A second of median: a box's own flutter is not a move.
  return out.map((_, n) => {
    const w = out.slice(Math.max(0, n - 2), n + 3).slice().sort((a, b) => a - b);
    return w[Math.floor(w.length / 2)];
  });
}

// The camera after a target, frame by frame: it stands in the dead zone, eases out after the face, settles near it.
function _camera(target, width, lo, hi, fps) {
  const first = target.slice(0, Math.max(1, Math.round(fps))).slice().sort((a, b) => a - b);
  let c = clamp(first[Math.floor(first.length / 2)], lo, hi);
  let moving = false;
  const vmax = SPEED * width / fps;
  return target.map((x) => {
    const want = clamp(x, lo, hi);
    const off = want - c;
    if (!moving && Math.abs(off) > DEAD * width) moving = true;
    if (moving) {
      const step = clamp(off * EASE, -vmax, vmax);
      c += step;
      if (Math.abs(want - c) < SETTLE * width) moving = false;
    }
    return c;
  });
}

// Ramer-Douglas-Peucker over [t, v...]: the fewest keys whose straight lines stay within `tol` of the camera.
function _simplify(pts, tol) {
  if (pts.length <= 2) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = 1; keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let worst = -1, wd = tol;
    for (let i = a + 1; i < b; i++) {
      const f = (pts[i][0] - pts[a][0]) / ((pts[b][0] - pts[a][0]) || 1);
      let d = 0;
      for (let k = 1; k < pts[i].length; k++) d = Math.max(d, Math.abs(pts[i][k] - (pts[a][k] + (pts[b][k] - pts[a][k]) * f)));
      if (d > wd) { wd = d; worst = i; }
    }
    if (worst > 0) { keep[worst] = 1; stack.push([a, worst], [worst, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

// (phase V33.6) Two tracks too far apart for one window of width `width`: the span of their middles and half of each wide.
function _apart(a, b, width) {
  const med = (t, k) => { const v = t.pts.map((p) => p[k]).sort((x, y) => x - y); return v[Math.floor(v.length / 2)]; };
  return Math.abs(med(a, 1) - med(b, 1)) + (med(a, 3) + med(b, 3)) / 2 > width * APART;
}

/**
 * The record a clip keeps, worked out from a film's faces (lib/faces.js's record). `aspect` is the frame's shape (w/h,
 * 9/16), `mode` one of MODES, `shift` -1..1. `people` (V33.6): a shot with no face follows a whole person, where the record
 * counted them; `autoBands` (V33.6, on unless false): two standing apart are bands by themselves in 'face'; `wide` (V33.8,
 * w/h): a shot with no face shows a window of this shape from the middle over the blur, not the whole frame. Pure: the same
 * faces always give the same path.
 */
export function plan(faces, { aspect = 9 / 16, mode = 'face', shift = 0, people = false, autoBands = true, wide = 0, active = null } = {}) {
  // (V43) The most active: its own planner, on a film counted ten a second with its mouths, lips and things.
  if (active && faces && faces.active) return planActive(faces, { aspect, shift, ...active });
  const md = MODES.includes(mode) ? mode : 'face';
  // (V43) A film counted ten a second for the most active is read here as five a second - the path it gives stays the one
  // a five-a-second count gives.
  let f = faces || {};
  if (+f.fps >= 9.5 && Array.isArray(f.frames)) {
    const half = (xs) => (Array.isArray(xs) ? xs.filter((_, i) => i % 2 === 0) : xs);
    f = { ...f, fps: f.fps / 2, frames: half(f.frames), people: half(f.people) };
  }
  const src = { w: +f.w || 0, h: +f.h || 0 };
  const rec = { v: VERSION, mode: md, shift: r3(clamp(+shift || 0, -1, 1)), src, shots: [] };
  // (V33.8) Kept only where it shows less than the whole frame - a film no wider than the window shows itself whole.
  if (+wide > 0 && md !== 'center' && wholeW({ wide }, src.w, src.h) < 0.999) rec.wide = r3(clamp(+wide, 0.5, 4));
  const fps = +f.fps || 5;
  const frames = Array.isArray(f.frames) ? f.frames : [];
  const persons = people && Array.isArray(f.people) ? f.people : null;
  const seconds = +f.seconds || frames.length / fps;
  const width = windowW(src.w, src.h, aspect);
  rec.found = frames.length ? r2(frames.filter((x) => _dedupe(x).length).length / frames.length) : 0;
  if (md === 'center' || md === 'whole' || !frames.length || width >= 0.999) return rec;
  const lo = width / 2, hi = 1 - width / 2;
  const bandW = (bh) => Math.min(1, (bh * src.h * 2 * aspect) / src.w);
  const bandHs = [];
  for (const s of _shots(f.cuts, seconds)) {
    const i0 = Math.max(0, Math.floor(s.t0 * fps)), i1 = Math.min(frames.length, Math.max(i0 + 1, Math.ceil(s.t1 * fps)));
    const shot = { t0: r3(s.t0), t1: r3(s.t1), kind: 'face' };
    const n = i1 - i0;
    let tracks = _tracks(frames, i0, i1, fps).sort((a, b) => b.weight - a.weight);
    const seen = new Set();
    for (const t of tracks) for (const p of t.pts) seen.add(p[0]);
    let byPerson = false;
    if (!tracks.length || seen.size < Math.max(2, NO_FACE * n)) {
      // (V33.6) No face: a whole person in most of the shot is followed instead; with none, the whole frame over its blur.
      const pt = persons ? _tracks(persons, i0, i1, fps).sort((a, b) => b.weight - a.weight) : [];
      if (!pt.length || pt[0].pts.length < Math.max(2, PERSON_SHARE * n)) { shot.kind = 'whole'; rec.shots.push(shot); continue; }
      tracks = pt;
      byPerson = true;
      shot.by = 'person';
    }
    const tAt = (k) => r3((i0 + k) / fps);
    // Two, each there for half the shot or more: the bands - asked for, or by themselves when they stand too far apart for
    // one window (V33.6, (х60а)).
    const both = tracks.length >= 2 && tracks[1].pts.length >= BOTH * n && tracks[0].pts.length >= BOTH * n;
    const two = both && (md === 'bands' || (md === 'face' && autoBands !== false && _apart(tracks[0], tracks[1], width)));
    if (two) {
      const pair = [tracks[0], tracks[1]].sort((a, b) => a.pts.reduce((s2, p) => s2 + p[1], 0) / a.pts.length - b.pts.reduce((s2, p) => s2 + p[1], 0) / b.pts.length);
      const tallH = Math.max(...pair.map((t) => { const hs = t.pts.map((p) => p[4]).sort((a, b) => a - b); return hs[Math.floor(hs.length / 2)]; }));
      // A face's band shows BAND_FACE face heights; a person's, the person (from the top down - room for the head).
      bandHs.push(clamp(byPerson ? tallH : tallH * BAND_FACE, 0.45, 1));
      shot.kind = 'bands';
      shot.pair = pair.map((t) => ({ xs: _series(t, i0, i1, 1), ys: _series(t, i0, i1, 2), ...(byPerson ? { hs: _series(t, i0, i1, 4), person: true } : {}) }));
      rec.shots.push(shot);
      continue;
    }
    const cam = _camera(_series(tracks[0], i0, i1, 1), width, lo, hi, fps);
    shot.keys = _simplify(cam.map((x, k) => [tAt(k), x]), TOL).map(([t, x]) => [t, r3(x)]);
    rec.shots.push(shot);
  }
  // The bands share one height (the render's crop is one size for the clip): the middle of what the shots wanted.
  if (bandHs.length) {
    const bh = bandHs.slice().sort((a, b) => a - b)[Math.floor(bandHs.length / 2)];
    rec.band = r3(bh);
    const bw = bandW(bh);
    for (const s of rec.shots) {
      if (s.kind !== 'bands') continue;
      const i0 = Math.max(0, Math.floor(s.t0 * fps));
      const keysOf = (p) => {
        const cx = _camera(p.xs, bw, bw / 2, 1 - bw / 2, fps);
        // A face sits a little above the band's middle: room for the chin and the shoulders. A person (V33.6) is shown
        // from the top of the box down: the band's middle half a band below the person's top.
        const cy = _camera(p.person ? p.ys.map((y, k) => y - p.hs[k] / 2 + bh / 2) : p.ys.map((y) => y + bh * 0.12), bh, bh / 2, 1 - bh / 2, fps);
        return _simplify(cx.map((x, k) => [r3((i0 + k) / fps), x, cy[k]]), TOL).map(([t, x, y]) => [t, r3(x), r3(y)]);
      };
      s.b1 = keysOf(s.pair[0]);
      s.b2 = keysOf(s.pair[1]);
      delete s.pair;
    }
  }
  return rec;
}

// ── Reading a path ──────────────────────────────────────────────────────────
function _lerp(keys, t, k) {
  if (!keys || !keys.length) return 0.5;
  if (t <= keys[0][0]) return keys[0][k];
  const last = keys[keys.length - 1];
  if (t >= last[0]) return last[k];
  let a = 0, b = keys.length - 1;
  while (b - a > 1) { const m = (a + b) >> 1; if (keys[m][0] <= t) a = m; else b = m; }
  const p = keys[a], q = keys[b];
  return p[k] + (q[k] - p[k]) * ((t - p[0]) / ((q[0] - p[0]) || 1));
}

function _shotAt(frame, t) {
  const shots = (frame && frame.shots) || [];
  if (!shots.length) return null;
  for (const s of shots) if (t >= s.t0 && t < s.t1) return s;
  return t < shots[0].t0 ? shots[0] : shots[shots.length - 1];
}

/** Is this a record that frames a clip (anything else - no record, a broken one - leaves the clip to `cropAlign`). */
export const isFramed = (frame) => !!(frame && MODES.includes(frame.mode));

/**
 * Where the window is at the FILE's second `t`, for a frame of shape `aspect` - film size `sw` x `sh` as drawn (the
 * preview's copy is smaller than the film; the record's fractions are the same). Returns
 *   { kind: 'face', x }                                  the window's middle, a share of the width (full height)
 *   { kind: 'whole', w }                                 the middle `w` of the width (1 - the whole frame) over its blur
 *   { kind: 'bands', bw, bh, x1, y1, x2, y2 }            two bands, each window's size and middle
 */
export function windowAt(frame, t, sw, sh, aspect) {
  const width = windowW(sw, sh, aspect);
  const room = (1 - width) / 2;
  const shift = clamp(+(frame && frame.shift) || 0, -1, 1) * room;
  const mid = (x) => clamp(x + shift, width / 2, 1 - width / 2);
  const mode = frame && frame.mode;
  const whole = () => ({ kind: 'whole', w: wholeW(frame, sw, sh) });
  if (mode === 'whole') return whole();
  if (mode !== 'face' && mode !== 'bands') return { kind: 'face', x: mid(0.5) };
  const s = _shotAt(frame, t);
  if (!s) return { kind: 'face', x: mid(0.5) };
  if (s.kind === 'whole') return whole();
  if (s.kind === 'bands' && frame.band > 0) {
    const bh = clamp(+frame.band, 0.2, 1);
    const bw = Math.min(1, (bh * sh * 2 * (aspect > 0 ? aspect : 9 / 16)) / sw);
    const cx = (v) => clamp(v, bw / 2, 1 - bw / 2);
    const cy = (v) => clamp(v, bh / 2, 1 - bh / 2);
    return { kind: 'bands', bw, bh, x1: cx(_lerp(s.b1, t, 1)), y1: cy(_lerp(s.b1, t, 2)), x2: cx(_lerp(s.b2, t, 1)), y2: cy(_lerp(s.b2, t, 2)) };
  }
  return { kind: 'face', x: mid(_lerp(s.keys, t, 1)) };
}

// ── (phase V43) The punch-ins ───────────────────────────────────────────────
const _ss = (u) => u * u * (3 - 2 * u);
const _zooms = (frame) => (frame && !frame.noZoom && Array.isArray(frame.zooms) ? frame.zooms : []);
/** Does the clip punch in at all (fragmentation's record with zooms, its switch on). */
export const hasZooms = (frame) => _zooms(frame).length > 0;
/**
 * The punch-in at the FILE's second `t`: { z, ax, ay } - the window scaled by z about its point (ax, ay), fractions of the
 * window; z 1 between them. Smooth in and out (smoothstep), the anchor held across one.
 */
export function zoomAt(frame, t) {
  let z = 1, ax = 0.5, ay = 0.5;
  for (const k of _zooms(frame)) {
    const u = _ss(clamp((t - k.t0) / ZOOM_IN, 0, 1)) - _ss(clamp((t - k.t1) / ZOOM_OUT, 0, 1));
    if (u > 0) { z += (k.z - 1) * u; ax = k.ax; ay = k.ay; }
  }
  return { z, ax, ay };
}

// ── The same, said to ffmpeg ────────────────────────────────────────────────
// An expression in the FILE's time `T` (the render passes `(t+trimIn)`): a sum of pieces, each on for its own stretch -
// flat, not nested, so a long path does not deepen ffmpeg's parser. `pick` takes a key's value.
const n4 = (x) => String(Math.round(x * 10000) / 10000);
function _sumOf(spans, T) {
  const terms = [];
  for (const sp of spans) {
    const on = sp.open ? `gte(${T},${n4(sp.a)})` : sp.end ? `lt(${T},${n4(sp.b)})` : `gte(${T},${n4(sp.a)})*lt(${T},${n4(sp.b)})`;
    const v = Math.abs(sp.v1 - sp.v0) < 1e-4 ? n4(sp.v0)
      : `(${n4(sp.v0)}+${n4((sp.v1 - sp.v0) / ((sp.b - sp.a) || 1))}*(${T}-${n4(sp.a)}))`;
    terms.push(`${on}*${v}`);
  }
  return terms.length ? terms.join('+') : '0.5';
}

// The stretches of every shot of one kind, with the value each key gives at both its ends.
function _spansOf(frame, kind, keysOf, k) {
  const shots = (frame.shots || []).filter((s) => s.kind === kind);
  const spans = [];
  shots.forEach((s, si) => {
    const keys = keysOf(s);
    if (!keys || !keys.length) return;
    const pts = [[s.t0, keys[0][k]], ...keys.filter((p) => p[0] > s.t0 && p[0] < s.t1).map((p) => [p[0], p[k]]), [s.t1, keys[keys.length - 1][k]]];
    for (let i = 0; i + 1 < pts.length; i++) {
      if (pts[i + 1][0] - pts[i][0] < 1e-4) continue;
      spans.push({ a: pts[i][0], b: pts[i + 1][0], v0: pts[i][1], v1: pts[i + 1][1] });
    }
    // Before the first shot and after the last, the nearest value holds.
    if (si === 0 && spans.length) spans.unshift({ a: 0, b: s.t0, v0: pts[0][1], v1: pts[0][1], end: true });
  });
  if (spans.length) { const z = spans[spans.length - 1]; spans.push({ a: z.b, b: z.b, v0: z.v1, v1: z.v1, open: true }); }
  return spans.filter((sp) => sp.open || sp.end || sp.b > sp.a);
}

/** Which kinds of shot the clip shows ('face', 'whole', 'bands') - the render builds a branch for each. */
export function kindsOf(frame) {
  if (!isFramed(frame)) return [];
  if (frame.mode === 'whole') return ['whole'];
  if (frame.mode === 'center' || !(frame.shots || []).length) return ['face'];
  const ks = new Set(frame.shots.map((s) => s.kind));
  if (ks.has('bands') && !(frame.band > 0)) ks.delete('bands');
  return ['face', 'whole', 'bands'].filter((k) => ks.has(k) || (k === 'face' && !ks.size));
}

/** The FILE's stretches a kind of shot covers, [[a, b], ...] - the render's switch between its branches. */
export function spansOfKind(frame, kind) {
  return ((frame && frame.shots) || []).filter((s) => s.kind === kind).map((s) => [s.t0, s.t1]);
}

/** An ffmpeg expression in `T` (the file's time) for the face window's middle, a share of the width - shift and edges included. */
export function exprFace(frame, T, sw, sh, aspect) {
  const width = windowW(sw, sh, aspect);
  const room = (1 - width) / 2;
  const shift = clamp(+(frame && frame.shift) || 0, -1, 1) * room;
  const lo = n4(width / 2), hi = n4(1 - width / 2);
  if (!frame || frame.mode === 'center' || !(frame.shots || []).some((s) => s.kind === 'face')) return n4(clamp(0.5 + shift, width / 2, 1 - width / 2));
  return `clip(${_sumOf(_spansOf(frame, 'face', (s) => s.keys, 1), T)}+${n4(shift)},${lo},${hi})`;
}

/**
 * (phase V43) The punch-ins as ffmpeg expressions in `T` (the file's time): { Z, AX, AY } - flat sums, as zoomAt reads them - or
 * null when the clip has none. lib/mv3b-render.js framedChain scales the window by Z frame by frame and cuts the frame back out
 * about (AX, AY) - measured in block 0 against zoompan and perspective: under a pixel off, and the frames' own times kept.
 */
export function exprZoom(frame, T) {
  const zs = _zooms(frame);
  if (!zs.length) return null;
  const ssE = (u) => `(${u})*(${u})*(3-2*(${u}))`;
  const Z = '(1' + zs.map((k) => `+${n4(k.z - 1)}*(${ssE(`clip((${T}-${n4(k.t0)})/${ZOOM_IN},0,1)`)}-${ssE(`clip((${T}-${n4(k.t1)})/${ZOOM_OUT},0,1)`)})`).join('') + ')';
  const A = (key) => '(0.5' + zs.map((k) => `+between(${T},${n4(k.t0)},${n4(k.t1 + ZOOM_OUT)})*${n4(k[key] - 0.5)}`).join('') + ')';
  return { Z, AX: A('ax'), AY: A('ay') };
}

/** The same for band 1 or 2: { x, y } expressions in `T`, edges included. */
export function exprBand(frame, which, T, sw, sh, aspect) {
  const bh = clamp(+(frame && frame.band) || 0.6, 0.2, 1);
  const bw = Math.min(1, (bh * sh * 2 * (aspect > 0 ? aspect : 9 / 16)) / sw);
  const keysOf = (s) => (which === 2 ? s.b2 : s.b1);
  return {
    x: `clip(${_sumOf(_spansOf(frame, 'bands', keysOf, 1), T)},${n4(bw / 2)},${n4(1 - bw / 2)})`,
    y: `clip(${_sumOf(_spansOf(frame, 'bands', keysOf, 2), T)},${n4(bh / 2)},${n4(1 - bh / 2)})`,
    bw, bh,
  };
}

// ── Kept as it is given ─────────────────────────────────────────────────────
const _keys = (ks, n) => (Array.isArray(ks) ? ks : []).filter((p) => Array.isArray(p) && p.length >= n && p.every(Number.isFinite))
  .slice(0, 4000).map((p) => p.slice(0, n).map(r3)).sort((a, b) => a[0] - b[0]);

/** A record as a timeline stores it: every field valid, nothing unknown, or null. */
export function normalize(frame) {
  if (!frame || typeof frame !== 'object' || !MODES.includes(frame.mode)) return null;
  const out = { v: VERSION, mode: frame.mode, shift: r3(clamp(+frame.shift || 0, -1, 1)),
    src: { w: Math.max(0, Math.round(+(frame.src && frame.src.w) || 0)), h: Math.max(0, Math.round(+(frame.src && frame.src.h) || 0)) }, shots: [] };
  if (+frame.band > 0) out.band = r3(clamp(+frame.band, 0.2, 1));
  if (Number.isFinite(+frame.found)) out.found = r2(clamp(+frame.found, 0, 1));
  if (+frame.wide > 0) out.wide = r3(clamp(+frame.wide, 0.5, 4));
  // (V43) The most active, its punch-ins and the clip's switch for them; (V69 P12b) planned by the speaker's rules.
  if (frame.active) out.active = 1;
  if (frame.active && frame.speaker) out.speaker = 1;
  if (Array.isArray(frame.zooms)) {
    const zs = frame.zooms.filter((k) => k && [k.t0, k.t1, k.z, k.ax, k.ay].every((v) => Number.isFinite(+v)) && +k.t1 > +k.t0)
      .slice(0, 1000).map((k) => ({ t0: r3(+k.t0), t1: r3(+k.t1), z: r3(clamp(+k.z, 1, 2)), ax: r3(clamp(+k.ax, 0, 1)), ay: r3(clamp(+k.ay, 0, 1)) }))
      .sort((a, b) => a.t0 - b.t0);
    if (zs.length) out.zooms = zs;
  }
  if (frame.noZoom) out.noZoom = true;
  for (const s of (Array.isArray(frame.shots) ? frame.shots : []).slice(0, 2000)) {
    if (!s || !Number.isFinite(+s.t0) || !Number.isFinite(+s.t1) || !(+s.t1 > +s.t0)) continue;
    const kind = ['face', 'whole', 'bands'].includes(s.kind) ? s.kind : 'face';
    const shot = { t0: r3(+s.t0), t1: r3(+s.t1), kind };
    if (s.by === 'person' && kind !== 'whole') shot.by = 'person';
    if (kind === 'face') shot.keys = _keys(s.keys, 2);
    if (kind === 'bands') { shot.b1 = _keys(s.b1, 3); shot.b2 = _keys(s.b2, 3); }
    out.shots.push(shot);
  }
  out.shots.sort((a, b) => a.t0 - b.t0);
  return out;
}
