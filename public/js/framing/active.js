/* ═══════════════════════════════════════════════════════════════════════════
   THE MOST ACTIVE IN THE FRAME - fragmentation's 9:16 window (phase V43, the owner 2026-10-24/25, answers (ё2), (ё5), (ё11),
   (ё13)-(ё16); docs/local-app/PLAN.md "Фазы V39–V44", V43 - block 0's measurement on the owner's episode, variant В chosen by
   eye). Called by path.js plan() with `active`; pure - the same counted film, words and key moments always give the same path.

   WHAT IT READS (lib/faces.js, a record counted with `active`, ten frames a second): every face's box and, per face, its
   MOUTH's and EYES' change since the frame before (the camera's own move taken off) and the Face Landmarker's LIP gap and
   look (jaw, smile, brows, eyes wide); every second frame the THINGS of any kind with how much of each moved; the camera's
   pan. And from the caller: the SPEECH (when words sound, the file's seconds) and the KEY MOMENTS (the agent's key phrases).

   THE TARGET, moment by moment, by priority ((ё14) as the owner saw it in the clips of block 0):
     1. noticeable ACTION - a person or a thing moving fast against the camera for a while (a fight, a fall, someone coming in);
     2. for 0.2-1.8 s after a key phrase, the one who REACTS - the face, not the speaker's, whose look changes most;
     3. the one who SPEAKS - the face whose mouth moves while words sound: on a drawn or printed face the mouth's pixels
        change against the eyes' (LEGO figures), on a live face the lips' gap swings (the landmarker) - the stronger of the two;
        a voice from off the screen moves no mouth and picks nobody;
     4. the largest face; 5. a whole person; 6. the last target held; 7. the middle of the frame.
   A target held for less than MIN_RUN is not worth a move. The camera stands while the target is in the middle of the window
   (the dead zone), eases after it - a speaker's turn answered within about half a second - and JUMPS at a cut. There is no
   whole frame over a blur: the window is always filled with the film ((ё2)).
   TWO who both speak in a shot and stand too far apart for one window: two bands, one over the other ((ё11)); no punch-in then.

   THE PUNCH-INS ((ё5)-(ё7а), (ё16)): at each key phrase, onto its speaker (no speaker on the screen: the window's middle, a
   little above it), the window scaled by `zoom` about that point in IN s, held to the phrase's end and never past HOLD_MAX,
   back in OUT s; at most PER_MIN a minute and GAP s apart; none in a shot of bands. Kept on the record as `zooms`:
   [{ t0, t1 (the hold's end), z, ax, ay (the anchor, fractions of the window) }] - path.js zoomAt() / exprZoom() read them.

   THE SPEAKER (phase V69 P12b, the owner's (хп63), (хп97), (хп98); docs/local-app/plan/ "Фаза V69", П12б) - podcast · interview
   and true crime · bodycam: `speaker` set. The same planner with the kind's rules: NO ACTION (a hand at a bodycam's lens, a door,
   a car going by never take the window); while words sound and no mouth on the screen moves - the officer behind the camera, the
   host off the screen - the window goes to the face that changes most in that stretch (it listens and reacts), the largest face
   when none does; a shot with a face in fewer than NO_FACE of its frames is a 'whole' shot - the square from the middle over its
   blur (`wide`, path.js SQUARE) - and no punch-in lands on it. The record says `speaker: 1` (the inspector's "the speaker").
   (phase V69 P12b, (хп82)) THE STREAM: `cam` too - a shot with the streamer's webcam (a small face standing still - cam.js camOf) is
   a 'cam' shot, camera on top and game below, standing still, never punched in; a full-screen camera follows the speaker as above.
   ═══════════════════════════════════════════════════════════════════════════ */

import { camOf } from './cam.js';

const CUT_MERGE = 0.6;      // scdet's changes closer than this are one
const MIN_FACE = 0.015;     // a box narrower than this share of the width is noise
const SAME = 0.09;          // a face within this distance in the next frame is the same face
const HOLD = 2;             // a face lost for less than this keeps its track
const TALK_PIX = 3;         // the mouth's change over the eyes' half that makes 1 (block 0: speakers 8-20, the rest 0-3)
const TALK_LIP = 1.5;       // the lips' swing (x100) that makes 1 (a live actor's lines 2-5, a voice off the screen 0.3)
const TALK_MIN = 1;         // a face speaks at 1 and more ...
const TALK_RATIO = 1.35;    // ... and at least this much more than the next face
const REACT_FROM = 0.2, REACT_TO = 1.8;   // the stretch after a key phrase that a reaction holds
const REACT_PIX = 3;        // a face's change that makes 1 for a reaction
const REACT_MIN = 1;
const ACT_SPEED = 0.35;     // widths a second against the camera that make an action ...
const ACT_CHANGED = 0.15;   // ... with this share of the thing's pixels moving
const ACT_MIN_AREA = 0.01;
const PERSON_SCORE = 0.4;
const MIN_RUN = 0.6;        // a target held for less than this (seconds) keeps the one before
const DEAD = 0.15;          // the dead zone, a share of the window's width either side of its middle
const SETTLE = 0.04;
const SPEED = 1.6;          // the camera's top speed, window widths a second
const EASE10 = 0.25;        // the share of the way left it covers each frame at ten a second
const TOL = 0.004;
const BAND_FACE = 3.2;
const BOTH = 0.5;
const APART = 0.95;
const TALK_SHARE = 0.2;     // two speak in a shot when the second has this share of its speech
export const ZOOM_IN = 0.25, ZOOM_OUT = 0.3;  // (ё6) seconds in and out
const HOLD_MAX = 3;         // (ё6) a punch-in held no longer than this
const HOLD_MIN = 0.8;       // (P12b, `speaker`) ... and no shorter than this: a short reply ("Yes.", "A few of them") is the key line
const GAP = 3;              // two punch-ins at least this far apart
const PER_MIN = 4;          // (ё6) and at most this many a minute
const NO_FACE = 0.1;        // (P12b, `speaker`) a shot with a face in fewer of its frames than this has none - the square
const HEAR_MIN = 1;         // (P12b, (хп98)) a listener's change that makes 1 while a voice off the screen speaks

const r3 = (x) => Math.round(x * 1000) / 1000;
const r2 = (x) => Math.round(x * 100) / 100;
const cl = (x, a, b) => (x < a ? a : x > b ? b : x);
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const sd = (a) => { if (a.length < 3) return 0; const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };

const windowW = (srcW, srcH, aspect) => (!(srcW > 0) || !(srcH > 0) ? 1 : Math.min(1, (srcH * (aspect > 0 ? aspect : 9 / 16)) / srcW));

function shotsOf(cuts, seconds) {
  const merged = [];
  for (const c of (cuts || []).map(Number).filter((c) => c > 0.3 && c < seconds - 0.3).sort((a, b) => a - b)) {
    if (merged.length && c - merged[merged.length - 1] < CUT_MERGE) merged[merged.length - 1] = c;
    else merged.push(c);
  }
  const e = [0, ...merged, seconds];
  const out = [];
  for (let i = 0; i + 1 < e.length; i++) if (e[i + 1] - e[i] > 0.05) out.push({ t0: e[i], t1: e[i + 1] });
  return out.length ? out : [{ t0: 0, t1: seconds }];
}

// The speech as stretches [[a, b]] of the file's seconds - words a breath apart are one.
function stretchesOf(speech) {
  const xs = (Array.isArray(speech) ? speech : []).map((x) => (Array.isArray(x) ? [+x[0], +x[1]] : [+(x && (x.start ?? x.a)), +(x && (x.end ?? x.b))]))
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > a).sort((p, q) => p[0] - q[0]);
  const out = [];
  for (const [a, b] of xs) {
    const last = out[out.length - 1];
    if (last && a - last[1] < 0.3) last[1] = Math.max(last[1], b); else out.push([a, b]);
  }
  return out;
}

// The faces of frames i0..i1 strung into tracks; each point carries its face's signals.
function faceTracks(f, i0, i1) {
  const fps = f.fps;
  const tracks = [];
  const sig = (f.active && f.active.faces) || [];
  for (let i = i0; i < i1; i++) {
    const boxes = (f.frames[i] || []).map((b, k) => ({ b, k })).filter(({ b }) => b[2] >= MIN_FACE).sort((p, q) => q.b[2] * q.b[3] - p.b[2] * p.b[3]);
    const taken = new Set();
    for (const { b, k } of boxes) {
      const cx = b[0] + b[2] / 2, cy = b[1] + b[3] / 2;
      let best = null, bd = Infinity;
      for (const t of tracks) {
        if (taken.has(t) || i - t.last > HOLD * fps) continue;
        const d = Math.hypot(cx - t.lx, (cy - t.ly) * 0.5);
        if (d < SAME + (i - t.last) * (0.05 / fps) && d < bd) { bd = d; best = t; }
      }
      if (!best) { best = { pts: [], last: i, lx: cx, ly: cy, weight: 0 }; tracks.push(best); }
      taken.add(best);
      const s = (sig[i] && sig[i][k]) || null;
      best.pts.push({ i, cx, cy, w: b[2], h: b[3], m: s ? s[0] : null, e: s ? s[1] : null, lip: s && s.length > 2 ? s[2] : null,
        look: s && s.length > 6 ? [s[3], s[4], s[5], s[6]] : null });
      best.last = i; best.lx = cx; best.ly = cy; best.weight += b[2] * b[3];
    }
  }
  for (const t of tracks) t.at = new Map(t.pts.map((p) => [p.i, p]));
  return tracks;
}

// How much a face speaks at frame i: the mouth's pixels against the eyes', or the lips' swing - the stronger, 1 = speaking.
function talkAt(t, i, fps) {
  const W = Math.max(2, Math.round(0.4 * fps)), WL = Math.max(3, Math.round(0.5 * fps));
  const pix = [], lip = [];
  for (let k = i - WL; k <= i + WL; k++) {
    const p = t.at.get(k);
    if (!p) continue;
    if (Math.abs(k - i) <= W && p.m != null && p.e != null) pix.push(Math.max(0, p.m - 0.5 * p.e));
    if (p.lip != null) lip.push(p.lip);
  }
  const a = pix.length >= 3 ? mean(pix) / TALK_PIX : 0;
  const b = lip.length >= 4 ? (sd(lip) * 100) / TALK_LIP : 0;
  return Math.max(a, b);
}

// Who speaks during each stretch of speech within [i0, i1): the clearly most speaking face, or nobody (a voice off the screen).
function speakers(f, tracks, stretches, i0, i1) {
  const fps = f.fps;
  const out = [];
  for (const [sa, sb] of stretches) {
    const a = Math.max(i0, Math.round(sa * fps)), b = Math.min(i1, Math.round(sb * fps));
    if (b - a < 2) continue;
    const sc = tracks.map((t) => {
      let sum = 0, n = 0;
      for (let i = a; i < b; i++) if (t.at.has(i)) { sum += talkAt(t, i, fps); n++; }
      return { t, score: n >= Math.max(2, 0.4 * (b - a)) ? sum / n : 0 };
    }).sort((x, y) => y.score - x.score);
    const top = sc[0], next = sc[1];
    const ok = top && top.score >= TALK_MIN && (!next || top.score >= TALK_RATIO * next.score);
    out.push({ a, b, track: ok ? top.t : null });
  }
  return out;
}

// The things of frames i0..i1 (every kind), strung into tracks, each point with its own move against the camera.
function movers(f, i0, i1) {
  const fps = f.fps;
  const objs = (f.active && f.active.objects) || [];
  const pan = (f.active && f.active.pan) || [];
  const half = (f.fw || 960) / 2;
  const tracks = [];
  let carried = 0;
  for (let i = i0; i < i1; i++) {
    carried += (pan[i] || 0) / half;
    const os = objs[i] || [];
    if (!os.length) continue;
    for (const o of os) {
      const [cat, x, y, w, h, , ch] = o;
      if (w * h < ACT_MIN_AREA) continue;
      const cx = x + w / 2, cy = y + h / 2;
      let best = null, bd = Infinity;
      for (const t of tracks) {
        if (t.cat !== cat || i - t.last > fps || t.lastI === i) continue;
        const d = Math.hypot(cx - t.lx - (carried - t.carried), cy - t.ly);
        if (d < 0.15 && d < bd) { bd = d; best = t; }
      }
      if (!best) { best = { cat, pts: [], last: i, lx: cx, ly: cy, carried }; tracks.push(best); }
      const own = best.pts.length ? Math.hypot(cx - best.lx - (carried - best.carried), cy - best.ly) * fps / Math.max(1, i - best.last) : 0;
      best.pts.push({ i, cx, cy, w, h, own, ch: +ch || 0 });
      best.last = i; best.lastI = i; best.lx = cx; best.ly = cy; best.carried = carried;
    }
  }
  return tracks;
}

function actionAt(mtracks, i, fps) {
  const W = Math.round(0.6 * fps);
  let best = null, bs = 0;
  for (const t of mtracks) {
    const w = t.pts.filter((p) => p.i >= i - W && p.i <= i + W);
    if (w.length < 4) continue;
    const sp = median(w.map((p) => p.own));
    if (sp < ACT_SPEED || mean(w.map((p) => p.ch)) < ACT_CHANGED) continue;
    const s = sp * Math.sqrt(mean(w.map((p) => p.w * p.h)));
    if (s > bs) { bs = s; best = w[Math.floor(w.length / 2)]; }
  }
  return best ? best.cx : null;
}

function personAt(f, i) {
  const objs = (f.active && f.active.objects) || [];
  for (let k = i; k >= Math.max(0, i - 2); k--) {
    const ps = (objs[k] || []).filter((o) => o[0] === 'person' && o[5] >= PERSON_SCORE && o[3] * o[4] >= ACT_MIN_AREA);
    if (ps.length) { const p = ps.sort((a, b) => b[3] * b[4] - a[3] * a[4])[0]; return p[1] + p[3] / 2; }
  }
  const pp = f.people && f.people[i];
  if (pp && pp.length) { const p = pp.slice().sort((a, b) => b[2] * b[3] - a[2] * a[3])[0]; return p[0] + p[2] / 2; }
  return null;
}

// The camera after a target series, at the film's own frame rate.
function camera(target, width, fps) {
  const lo = width / 2, hi = 1 - width / 2;
  const ease = 1 - Math.pow(1 - EASE10, 10 / fps);
  let c = cl(target[0], lo, hi), moving = false;
  const vmax = SPEED * width / fps;
  return target.map((x) => {
    const want = cl(x, lo, hi);
    const off = want - c;
    if (!moving && Math.abs(off) > DEAD * width) moving = true;
    if (moving) { c += cl(off * ease, -vmax, vmax); if (Math.abs(want - c) < SETTLE * width) moving = false; }
    return c;
  });
}

function simplify(pts, tol) {
  if (pts.length <= 2) return pts.slice();
  const keep = new Uint8Array(pts.length); keep[0] = 1; keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop();
    let worst = -1, wd = tol;
    for (let i = a + 1; i < b; i++) {
      const f = (pts[i][0] - pts[a][0]) / ((pts[b][0] - pts[a][0]) || 1);
      let d = 0;
      for (let k = 1; k < pts[i].length; k++) d = Math.max(d, Math.abs(pts[i][k] - (pts[a][k] + (pts[b][k] - pts[a][k]) * f)));
      if (d > wd) { wd = d; worst = i; }
    }
    if (worst > 0) { keep[worst] = 1; st.push([a, worst], [worst, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

function lerpKeys(keys, t) {
  if (!keys || !keys.length) return 0.5;
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) if (t <= keys[i][0]) {
    const p = keys[i - 1], q = keys[i];
    return p[1] + (q[1] - p[1]) * ((t - p[0]) / ((q[0] - p[0]) || 1));
  }
  return keys[keys.length - 1][1];
}

// (P12b, (хп98)) While a voice off the screen speaks (a stretch of speech no face on the screen speaks): the face that changes
// most over it - its mouth and eyes, its look - the one who listens and reacts; null when none changes enough.
function listenerOf(tracks, a, b) {
  let best = null, bs = 0;
  for (const t of tracks) {
    const at0 = t.pts.find((p) => p.i >= a) || null;
    const vals = [];
    for (let i = a; i < b; i++) {
      const p = t.at.get(i);
      if (!p || p.m == null) continue;
      const pix = (p.m + p.e) / 2 / REACT_PIX;
      const look = p.look && at0 && at0.look ? p.look.reduce((z, v, j) => z + Math.abs(v - at0.look[j]), 0) * 4 : 0;
      vals.push(Math.max(pix, look));
    }
    if (vals.length >= Math.max(3, 0.4 * (b - a)) && mean(vals) > bs) { bs = mean(vals); best = t; }
  }
  return best && bs >= HEAR_MIN ? best : null;
}

/**
 * The record of the most active (mode 'face', `active: 1` - the preview and the render read its shots as any face path), from
 * a film counted with `active` (lib/faces.js). `speech` [[a, b]] or [{ start, end }] - when words sound; `keys` [{ t0, t1 }] -
 * the key phrases; `zoom` (> 1) the punch-ins' strength, 0 or 1 for none. Times are the FILE's seconds.
 * (phase V69 P12b) `speaker` - podcast's and true crime's rules (above): no action, the listener while a voice off the screen
 * speaks, a shot with no face the square (`wide`, w/h - path.js SQUARE) with no punch-in on it.
 */
export function planActive(f, { aspect = 9 / 16, shift = 0, speech = [], keys = [], zoom = 0, speaker = false, wide = 0, cam: withCam = false } = {}) {
  const src = { w: +f.w || 0, h: +f.h || 0 };
  const rec = { v: 1, mode: 'face', active: 1, shift: r3(cl(+shift || 0, -1, 1)), src, shots: [] };
  if (speaker) rec.speaker = 1;
  // (P12b) The square a shot with no face shows - kept only where it is less than the whole frame (path.js wholeW).
  if (speaker && +wide > 0 && src.w > 0 && src.h > 0 && (src.h * +wide) / src.w < 0.999) rec.wide = r3(cl(+wide, 0.5, 4));
  const fps = +f.fps || 10;
  const frames = Array.isArray(f.frames) ? f.frames : [];
  const seconds = +f.seconds || frames.length / fps;
  const width = windowW(src.w, src.h, aspect);
  rec.found = frames.length ? r2(frames.filter((x) => (x || []).some((b) => b[2] >= MIN_FACE)).length / frames.length) : 0;
  if (!frames.length || width >= 0.999) return rec;
  const fd = { ...f, fps, frames };
  const stretches = stretchesOf(speech);
  const phrases = (Array.isArray(keys) ? keys : []).map((k) => ({ t0: +k.t0, t1: +k.t1 })).filter((k) => k.t1 > k.t0).sort((a, b) => a.t0 - b.t0);
  const bandHs = [];
  const camHs = [];
  const shotTracks = new Map();
  for (const s of shotsOf(f.cuts, seconds)) {
    const i0 = Math.max(0, Math.floor(s.t0 * fps)), i1 = Math.min(frames.length, Math.max(i0 + 1, Math.ceil(s.t1 * fps)));
    const n = i1 - i0;
    // (P12b, (хп82)) The stream: the streamer's webcam in the shot - camera on top, the game below.
    const cm = withCam ? camOf(frames, i0, i1) : null;
    if (cm) { rec.shots.push({ t0: r3(s.t0), t1: r3(s.t1), kind: 'cam', c: [r3(cm.x), r3(cm.y)] }); camHs.push(cm.band); continue; }
    // (P12b) The speaker's kinds: a shot with no face is the square over its blur.
    if (speaker) {
      let seen = 0;
      for (let i = i0; i < i1; i++) if ((frames[i] || []).some((b) => b[2] >= MIN_FACE)) seen++;
      if (seen < Math.max(2, NO_FACE * n)) { rec.shots.push({ t0: r3(s.t0), t1: r3(s.t1), kind: 'whole' }); continue; }
    }
    const tracks = faceTracks(fd, i0, i1);
    const spk = speakers(fd, tracks, stretches.filter(([a, b]) => b > s.t0 && a < s.t1), i0, i1);
    shotTracks.set(s.t0, { tracks, i0, i1 });
    // Two who both speak, both there for half the shot, too far apart for one window: two bands ((ё11)).
    const talk = new Map();
    for (const x of spk) if (x.track) talk.set(x.track, (talk.get(x.track) || 0) + (x.b - x.a));
    const tl = [...talk.entries()].sort((a, b) => b[1] - a[1]);
    const sum = tl.reduce((z, x) => z + x[1], 0);
    if (tl.length >= 2 && tl[1][1] >= TALK_SHARE * sum && tl[0][0].pts.length >= BOTH * n && tl[1][0].pts.length >= BOTH * n) {
      const [a, b] = [tl[0][0], tl[1][0]];
      const span = Math.abs(median(a.pts.map((p) => p.cx)) - median(b.pts.map((p) => p.cx))) + (median(a.pts.map((p) => p.w)) + median(b.pts.map((p) => p.w))) / 2;
      if (span > width * APART) {
        const pair = [a, b].sort((p, q) => median(p.pts.map((z) => z.cx)) - median(q.pts.map((z) => z.cx)));
        bandHs.push(cl(Math.max(...pair.map((t) => median(t.pts.map((p) => p.h)))) * BAND_FACE, 0.45, 1));
        const series = (t, k) => { const out = []; let last = t.pts[0][k]; for (let i = i0; i < i1; i++) { const p = t.at.get(i); if (p) last = p[k]; out.push(last); } return out; };
        rec.shots.push({ t0: r3(s.t0), t1: r3(s.t1), kind: 'bands', _pair: pair.map((t) => ({ xs: series(t, 'cx'), ys: series(t, 'cy') })), _i0: i0 });
        continue;
      }
    }
    const speakerAt = new Array(n).fill(null);
    for (const x of spk) for (let i = x.a; i < x.b; i++) if (x.track) speakerAt[i - i0] = x.track;
    // The one who reacts, for a moment after each key phrase: not its speaker, the face whose look changes most.
    const reactAt = new Array(n).fill(null);
    for (const k of phrases) {
      const te = Math.round(k.t1 * fps);
      if (te < i0 || te >= i1) continue;
      const sp = speakerAt[cl(te - 1 - i0, 0, n - 1)];
      let best = null, bs = 0;
      for (const t of tracks) {
        if (t === sp) continue;
        const at0 = t.at.get(te) || t.pts.filter((p) => p.i <= te).pop() || null;
        const vals = [];
        for (let i = te + Math.round(REACT_FROM * fps); i < Math.min(i1, te + Math.round(2 * fps)); i++) {
          const p = t.at.get(i);
          if (!p || p.m == null) continue;
          const pix = (p.m + p.e) / 2 / REACT_PIX;
          const look = p.look && at0 && at0.look ? p.look.reduce((z, v, j) => z + Math.abs(v - at0.look[j]), 0) * 4 : 0;
          vals.push(Math.max(pix, look));
        }
        if (vals.length >= 0.5 * fps && mean(vals) > bs) { bs = mean(vals); best = t; }
      }
      if (best && bs >= REACT_MIN) for (let i = te + Math.round(REACT_FROM * fps); i < Math.min(i1, te + Math.round(REACT_TO * fps)); i++) reactAt[i - i0] = best;
    }
    // (P12b, (хп98)) The speaker's kinds: while a voice off the screen speaks, the one who listens and reacts.
    const hearAt = new Array(n).fill(null);
    if (speaker) {
      for (const x of spk) {
        if (x.track) continue;
        const who = listenerOf(tracks, x.a, x.b);
        if (who) for (let i = x.a; i < x.b; i++) hearAt[i - i0] = who;
      }
    }
    // (P12b, (хп97)) No action for the speaker's kinds: what moves near a bodycam's lens is not what the short is about.
    const mtr = speaker ? [] : movers(fd, i0, i1);
    const tx = new Array(n).fill(0.5), why = new Array(n).fill('');
    let last = null;
    for (let i = i0; i < i1; i++) {
      const k = i - i0;
      let x = speaker ? null : actionAt(mtr, i, fps), w = x != null ? 'action' : '';
      if (x == null && reactAt[k]) { const p = reactAt[k].at.get(i); if (p) { x = p.cx; w = 'reacts'; } }
      if (x == null && speakerAt[k]) { const p = speakerAt[k].at.get(i) || speakerAt[k].pts[0]; x = p.cx; w = 'speaks'; }
      if (x == null && hearAt[k]) { const p = hearAt[k].at.get(i); if (p) { x = p.cx; w = 'listens'; } }
      if (x == null) {
        const big = tracks.filter((t) => t.at.has(i)).sort((a, b) => b.at.get(i).w - a.at.get(i).w)[0];
        if (big) { x = big.at.get(i).cx; w = 'face'; }
      }
      if (x == null && !speaker) { const p = personAt(fd, i); if (p != null) { x = p; w = 'person'; } }
      if (x == null && last != null) { x = last; w = 'hold'; }
      if (x == null) { x = 0.5; w = 'middle'; }
      tx[k] = x; why[k] = w; last = x;
    }
    // A target held for less than MIN_RUN keeps the one before it.
    const minRun = Math.round(MIN_RUN * fps);
    for (let k = 0; k < n;) {
      let e = k + 1;
      while (e < n && why[e] === why[k] && Math.abs(tx[e] - tx[k]) < 0.05) e++;
      if (e - k < minRun && k > 0) for (let q = k; q < e; q++) tx[q] = tx[k - 1];
      k = e;
    }
    const cam = camera(tx, width, fps);
    const shot = { t0: r3(s.t0), t1: r3(s.t1), kind: 'face', keys: simplify(cam.map((x, k) => [r3((i0 + k) / fps), x]), TOL).map(([t, x]) => [t, r3(x)]) };
    rec.shots.push(shot);
  }
  if (camHs.length) rec.cam = r3(median(camHs));
  if (bandHs.length) {
    const bh = median(bandHs);
    rec.band = r3(bh);
    const bw = Math.min(1, (bh * src.h * 2 * aspect) / src.w);
    for (const s of rec.shots) {
      if (s.kind !== 'bands') continue;
      const keysOf = (p) => {
        const cx = camera(p.xs, bw, fps), cy = camera(p.ys.map((y) => y + bh * 0.12), bh, fps);
        return simplify(cx.map((x, k) => [r3((s._i0 + k) / fps), x, cl(cy[k], bh / 2, 1 - bh / 2)]), TOL).map(([t, x, y]) => [t, r3(x), r3(y)]);
      };
      s.b1 = keysOf(s._pair[0]); s.b2 = keysOf(s._pair[1]);
      delete s._pair; delete s._i0;
    }
  } else {
    for (const s of rec.shots) if (s.kind === 'bands') { s.kind = 'face'; s.keys = [[s.t0, 0.5]]; delete s._pair; delete s._i0; }
  }
  // The punch-ins.
  const z = +zoom || 0;
  if (z > 1.001) {
    const zooms = [];
    for (const k of phrases) {
      const shot = rec.shots.find((x) => k.t0 >= x.t0 && k.t0 < x.t1);
      // None on two bands, and (P12b) none on the square of a shot with no face.
      if (!shot || shot.kind === 'bands' || shot.kind === 'whole' || shot.kind === 'cam') continue;
      if (zooms.length && k.t0 - zooms[zooms.length - 1].t1 - ZOOM_OUT < GAP) continue;
      if (zooms.filter((o) => o.t0 > k.t0 - 60).length >= PER_MIN) continue;
      // (P12b) The speaker's kinds hold a punch-in at least HOLD_MIN - an interrogation's key line is often one short word.
      const t1 = Math.min(speaker ? Math.max(k.t1, k.t0 + ZOOM_IN + HOLD_MIN) : k.t1, k.t0 + ZOOM_IN + HOLD_MAX, shot.t1 - ZOOM_OUT);
      if (t1 - k.t0 < 0.6) continue;
      const st = [...shotTracks.values()].find((v) => v.i0 <= Math.round(k.t0 * fps) && Math.round(k.t0 * fps) < v.i1);
      let ax = 0.5, ay = 0.4;
      if (st) {
        const sp = speakers(fd, st.tracks, [[k.t0, k.t1]], st.i0, st.i1)[0];
        if (sp && sp.track) {
          const pts = sp.track.pts.filter((p) => p.i >= sp.a && p.i < sp.b);
          const x0 = lerpKeys(shot.keys, k.t0 + 0.3) - width / 2;
          ax = cl((median(pts.map((p) => p.cx)) - x0) / width, 0.15, 0.85);
          ay = cl(median(pts.map((p) => p.cy)), 0.2, 0.75);
        }
      }
      zooms.push({ t0: r3(k.t0), t1: r3(t1), z: r3(z), ax: r3(ax), ay: r3(ay) });
    }
    if (zooms.length) rec.zooms = zooms;
  }
  return rec;
}
