/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — a stretch of time cut out of every lane, the rest moved left (phase V36, T5).

   The owner, 2026-10-23, (у8): "чтобы можно было подрезать пользователю вручную тишину со смещением" - a stretch drawn
   over a waveform and Delete: the stretch goes from EVERY lane, and everything after it moves left by its length, so a
   picture and its sound stay together. Inside one mutation (js/merge-v3/timeline-b.js cutRange) - one step to undo.

     a clip wholly before the cut       stays
     a clip wholly after it             moves left
     a clip wholly inside               goes
     a clip the cut's start crosses     loses its tail (a reversed clip: the part of its file at the window's start)
     a clip the cut's end crosses       loses its head and starts where the cut was
     a clip across the whole cut        a film or a sound becomes two pieces playing on from where each was (a pair's two
                                        halves cut alike, the right pieces a pair of their own, as split makes them); a
                                        still is only shortened
     a caption line, a title            js/captions/cut.js: words inside go, the rest move, nothing heard again

   A TALKING HEAD's lines are laid by its script (lib/frag-mirror.js: cells with `frag`, and the caption pages bound to a
   line by `voice`). Since phase V44 ((ы5), (ы15)) they are cut here like any clip: a line becomes pieces of its file, and
   the save of the timeline writes what its pieces say into the line (lib/line-cuts.js), so the mirror lays it so again;
   Ctrl+Z, saved, gives it back whole. Refused only when a cut would take a WHOLE line away - that is taking it off the
   script.

   CUT SILENCE (phase V44, the owner 2026-10-24): many such cuts at once, the pauses of main audio shortened
   (js/merge-v3/tl-silence.js finds them, lib/track-pauses.js listens). Every pause longer than `keep` keeps `keep` - half
   after the sound before it, half before the sound after (ы2) - and the rest goes from every lane as above, from the last
   cut to the first, in ONE mutation. Two things are not moved with the picture (ы4): MUSIC laid under it (a `bed` on
   audio 2 and below) is neither cut nor moved - it plays on evenly, and what of it is left past the shortened film's end
   goes; a SOUND EFFECT (`sfx`) is moved whole with the picture under its start, never cut. Each seam a sound is cut at
   gets SEAM_FADE in and out (js/sound/fades.js reads them - the preview and the render alike), so no seam clicks.
   ═══════════════════════════════════════════════════════════════════════════ */

import { cutLine } from '../captions/cut.js';
import { isBed } from '../captions/heard.js';
// (phase V69 P12b) The pauses' cuts are one rule for the page and the server - js/sound/pause-cuts.js; said here as before.
import { SEAM_FADE, MIN_SILENCE_CUT, MIN_KEEP, cutsOfPauses, mapThrough } from '../sound/pause-cuts.js';
export { SEAM_FADE, MIN_SILENCE_CUT, MIN_KEEP, cutsOfPauses, mapThrough };

const r2 = (v) => Math.round(v * 100) / 100;
const EPS = 1e-6;
/** The shortest stretch worth cutting. */
export const MIN_CUT = 0.05;
/** The shortest clip a timeline keeps (lib/timeline-shape.js): a save brings a shorter one back this long. */
const MIN_DUR = 0.02;

const _end = (c) => (+c.start || 0) + (+c.dur || 0);
const _words = (t) => t && (t.kind === 'subs' || t.kind === 'text');

const LINE_GONE = 'A whole line of the talking head is inside the stretch - take it off the script in Setup instead, '
  + 'or cut a shorter stretch.';

// (phase V44) Would `cuts` ({ a, b }) take a WHOLE line of a talking head away - every piece of it on main audio?
function _lineGone(tl, cuts) {
  const lines = new Map();
  for (const t of tl.tracks) {
    if (t.kind !== 'audio') continue;
    for (const c of (t.clips || [])) if (Number(c.frag) > 0) (lines.get(+c.frag) || lines.set(+c.frag, []).get(+c.frag)).push(c);
  }
  const inside = (c) => cuts.some((k) => +c.start >= k.a - EPS && _end(c) <= k.b + EPS);
  for (const ps of lines.values()) if (ps.every(inside)) return true;
  return false;
}

const MERGED_LINES = 'Merged lines of the talking head are one file - cut inside them before merging, or take the merge back (Ctrl+Z).';

// (phase V45) Would `cuts` reach into a talking head's lines merged into one file (a cell with `merge`)?
function _mergedHit(tl, cuts) {
  for (const t of tl.tracks) {
    for (const c of (t.clips || [])) {
      if (!Array.isArray(c.merge) || !c.merge.length) continue;
      if (cuts.some((k) => k.a < _end(c) - EPS && k.b > +c.start + EPS)) return true;
    }
  }
  return false;
}

/** Why [a, b) cannot be cut out of `tl`, in words - or '' when it can. */
export function cutRefused(tl, a, b) {
  if (!tl || !Array.isArray(tl.tracks)) return 'Nothing is open to cut';
  if (!(b - a >= MIN_CUT)) return 'Draw a longer stretch over the wave to cut it out';
  if (_mergedHit(tl, [{ a, b }])) return MERGED_LINES;
  return _lineGone(tl, [{ a, b }]) ? LINE_GONE : '';
}

/**
 * Cut [a, b) out of every lane of `tl` (a timeline being mutated) and close the gap.
 * `opts.newId()` - an id for a clip's right piece; `opts.isStill(c)` - a picture, which is shortened rather than split.
 */
export function rippleCut(tl, a, b, opts) {
  a = r2(+a || 0); b = r2(+b || 0);
  const D = r2(b - a);
  if (!(D > 0)) return;
  const newId = (opts && opts.newId) || (() => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7));
  const isStill = (opts && opts.isStill) || (() => false);
  // (phase V44) A sound cut here fades out into the seam and in out of it - cut silence's seams; a stretch cut by hand has none.
  const seam = Math.max(0, +(opts && opts.seamFade) || 0);
  const fadeAt = (t, c, side) => { if (seam && t.kind === 'audio') c[side] = Math.max(+c[side] || 0, seam); };
  // The right pieces of a pair cut through become a pair of their own - one new pair id for both halves.
  const pairs = new Map();
  const pairOf = (p) => { if (!pairs.has(p)) pairs.set(p, 'p' + newId().replace(/^c/, '')); return pairs.get(p); };

  // (phase V44) Cut silence keeps every word - shortened, never dropped (js/captions/cut.js).
  const lineOpts = opts && opts.keepWords ? { keepWords: true } : undefined;
  for (const t of (tl.tracks || [])) {
    if (!Array.isArray(t.clips)) continue;
    const out = [];
    for (const c of t.clips) {
      if (_words(t)) {
        const n = cutLine(c, a, b, lineOpts);
        if (n) out.push(n);
        continue;
      }
      const s = +c.start || 0, e = _end(c);
      const sp = +c.speed || 1;
      const tin = +c.trimIn || 0;
      const still = isStill(c);
      if (e <= a + EPS) { out.push(c); continue; }
      if (s >= b - EPS) { c.start = r2(s - D); out.push(c); continue; }
      if (s >= a - EPS && e <= b + EPS) continue;
      if (s < a && e > b) {
        if (still) { c.dur = r2(c.dur - D); out.push(c); continue; }
        // Two pieces: [s, a) and [b, e) of the clip, the second now starting at a.
        const left = r2(a - s), right = r2(e - b);
        const piece = JSON.parse(JSON.stringify(c));
        piece.id = newId();
        piece.start = a;
        piece.dur = right;
        // A sound's fade belongs to its own end (as a split leaves it): the left keeps the fade in, the right the fade out.
        delete piece.fadeIn;
        delete c.fadeOut;
        fadeAt(t, c, 'fadeOut');
        fadeAt(t, piece, 'fadeIn');
        if (c.reversed) {
          // Played backwards, the timeline's first part is the END of the file's window: the right piece keeps its start.
          piece.trimIn = r2(tin);
          c.trimIn = r2(tin + (c.dur - left) * sp);
        } else {
          piece.trimIn = r2(tin + (b - s) * sp);
        }
        c.dur = left;
        if (c.pairId) piece.pairId = pairOf(c.pairId);
        // On a video lane the order is which one shows: the second piece belongs where the whole clip was.
        out.push(c, piece);
        continue;
      }
      if (s < a) {
        // The tail goes. Backwards, the tail of the timeline is the start of the file's window.
        const cut = r2(e - a);
        if (c.reversed && !still) c.trimIn = r2(tin + cut * sp);
        c.dur = r2(a - s);
        fadeAt(t, c, 'fadeOut');
        out.push(c);
        continue;
      }
      // The head goes (s in the cut, e after it): the rest starts where the cut was.
      const cut = r2(b - s);
      if (!c.reversed && !still) c.trimIn = r2(tin + cut * sp);
      c.start = a;
      c.dur = r2(e - b);
      fadeAt(t, c, 'fadeIn');
      out.push(c);
    }
    // (phase V49) A piece of a film, a sound or a picture the cut left shorter than the shortest a timeline keeps (0.02 s,
    // lib/timeline-shape.js) goes: the save would bring it back that long, over the piece after it. Not a talking head's
    // line (`frag`): its pieces are read into the line on the save (lib/line-cuts.js), and a line is never taken off here.
    t.clips = _words(t) ? out : out.filter((c) => +c.dur >= MIN_DUR - EPS || Number(c.frag) > 0);
    if (t.kind === 'audio') t.clips.sort((x, y) => x.start - y.start);
  }
}

// ── Cut silence (phase V44) ─────────────────────────────────────────────────

/** Music laid under the film (ы4): a bed on any audio lane but main audio - not cut, not moved. A sound effect is not music. */
export const isMusicBed = (t, c) => !!t && t.kind === 'audio' && !t.main && !!c && !c.sfx && isBed(c);

/** Why `cuts` cannot be made in `tl`, in words - or '' when they can. */
export function silenceRefused(tl, cuts) {
  if (!tl || !Array.isArray(tl.tracks)) return 'Nothing is open to cut';
  if (!cuts || !cuts.length) return 'No pause here is longer than that';
  if (_mergedHit(tl, cuts)) return MERGED_LINES;
  return _lineGone(tl, cuts) ? LINE_GONE : '';
}

/**
 * Make `cuts` ({ a, b }, in order, apart - cutsOfPauses) in `tl` (a timeline being mutated): every lane as rippleCut makes
 * one, the seams faded; music under the film left where it is, its tail past the new end taken off; sound effects moved
 * with the picture under their start. `opts`: rippleCut's (`newId`, `isStill`) and `seamFade` (SEAM_FADE by default).
 */
export function silenceCut(tl, cuts, opts) {
  const list = (cuts || []).filter((c) => c && c.b - c.a >= MIN_SILENCE_CUT - EPS);
  if (!list.length || !tl || !Array.isArray(tl.tracks)) return;
  const o = { ...(opts || {}), seamFade: opts && opts.seamFade != null ? opts.seamFade : SEAM_FADE, keepWords: true };
  // Music and sound effects are taken off their lanes while the rest is cut, and put back after.
  const held = [];
  for (const t of tl.tracks) {
    if (t.kind !== 'audio' || !Array.isArray(t.clips)) continue;
    const keep = [];
    for (const c of t.clips) {
      if (isMusicBed(t, c)) held.push({ t, c, music: true });
      else if (c.sfx) held.push({ t, c, music: false });
      else keep.push(c);
    }
    t.clips = keep;
  }
  // How long every clip of another lane was: a piece of one the cuts leave shorter than MIN_KEEP is a flash of a frame or two.
  const was = new Map();
  for (const t of tl.tracks) if (!t.main && Array.isArray(t.clips)) for (const c of t.clips) was.set(c.id, +c.dur || 0);
  for (let i = list.length - 1; i >= 0; i--) rippleCut(tl, list[i].a, list[i].b, o);
  // A piece left shorter than the shortest a timeline keeps (0.02 s, lib/timeline-shape.js) goes: it would come back from the
  // save that long, over the piece after it. On the other lanes (a b-roll over a pause) a piece the cuts left shorter than
  // MIN_KEEP goes too - a clip that was that short to begin with stays.
  const cutShort = (c) => +c.dur < MIN_KEEP - EPS && (!was.has(c.id) || +c.dur < was.get(c.id) - EPS);
  for (const t of tl.tracks) {
    if ((t.kind !== 'video' && t.kind !== 'audio') || !Array.isArray(t.clips)) continue;
    t.clips = t.clips.filter((c) => +c.dur >= 0.02 - EPS && (t.main || !cutShort(c)));
  }
  // A sound effect starts where the picture it was laid on now is.
  for (const h of held) if (!h.music) h.c.start = mapThrough(list, +h.c.start || 0);
  // The film's end now: the picture and every sound but the music.
  let end = 0;
  for (const t of tl.tracks) {
    if (t.kind !== 'video' && t.kind !== 'audio') continue;
    for (const c of (t.clips || [])) end = Math.max(end, _end(c));
  }
  for (const h of held) if (!h.music) end = Math.max(end, _end(h.c));
  for (const h of held) {
    if (h.music) {
      const s = +h.c.start || 0;
      if (_end(h.c) > end + EPS) {
        if (s >= end - EPS) continue;               // wholly past the end: it goes
        h.c.dur = r2(end - s);
      }
    }
    h.t.clips.push(h.c);
  }
  for (const t of tl.tracks) if (t.kind === 'audio' && Array.isArray(t.clips)) t.clips.sort((x, y) => x.start - y.start);
}
