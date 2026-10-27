/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — the client side of the timeline store.

   The state lives on the server (routes/mergev3.js). This module holds one in-memory
   copy plus the version it was read at, and every write quotes that version. There is
   deliberately NO localStorage anywhere in here: a browser copy of this data is what
   made edits undo each other, and a cache that can be stale is worse than a round
   trip that cannot.

   How to change anything:

       mutate(t => { t.tracks.find(x => x.id === 'v2').clips.push(clip); })

   mutate() takes a history snapshot BEFORE handing you the draft, applies your change
   to the in-memory copy, redraws, and schedules the save. That ordering is the reason
   undo works at all - a snapshot taken afterwards would record the result.

   On a 409 the save does NOT retry with the same body. The server sends its current
   state back with the refusal, so this adopts it and says so out loud. Overwriting is
   what the old store did; being told you lost a write is the price of never silently
   destroying someone else's.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as History from './history.js';
import { isHeard } from '../captions/heard.js';
import { recutClips, recutWithLooks, lookOf, CUT_KEYS, timedWords } from '../captions/pages.js';
import { isCorrected } from '../captions/words.js';

const SAVE_DEBOUNCE = 500;

// The drag payload a library tile puts on the clipboard and a lane reads back. A custom
// type on purpose: it is how an internal drag is told apart from an OS file drop, so the
// upload path and the timeline path can never claim each other's drops.
export const DRAG_TYPE = 'application/x-mv3-clip';
// (phase V28.4) WHAT a dragged tile is - 'video', 'image' or 'audio' - in a type of its own: a lane reads the types while
// the tile hangs over it (the data only at the drop) and takes only its own (timeline-b.js laneTakes).
export const DRAG_MEDIA = 'application/x-mv3-media-';

// A clip whose source is a PICTURE rather than a film. Three modules have to agree about
// this - the timeline sizes and paints it, the preview loads an <img> instead of a <video>,
// and the export tells ffmpeg to loop a frame instead of reading a stream - so the answer
// lives here once. The last time three places each decided something for themselves, they
// disagreed about clip stacking order and the render did not match the preview.
//
// Read off the source rather than stored on the clip: a path ending in .png is a picture
// whatever wrote it, so this needs no field, no default and no migration.
//
// NOT the same as a Main clip's `poster`. That is a still standing in for a fragment whose
// source is an mp3 - the clip still has a length of its own, from the voice. A still clip
// has no length at all until the timeline gives it one.
const STILL_RE = /\.(jpe?g|png|webp|avif|bmp)$/i;
export const isStill = (c) => !!c && !c.poster && STILL_RE.test(String(c.src || '').split('?')[0]);

// How long a picture is when it lands. A film brings its own length; a still has none, so
// this is a decision rather than a measurement - long enough to read, short enough to trim
// down more often than up.
export const STILL_DUR = 10;

let _timeline = null;      // the in-memory copy; null until load() lands
let _version = -1;
// HOW MANY EDITS HAVE HAPPENED, only ever compared with itself. A save reads it before the
// request goes out and again when the answer comes back: different means somebody edited while
// the write was in the air, and that edit is newer than anything the answer can say.
//
// The dirty flag cannot answer this, which is what went wrong: save() cleared it the moment the
// response arrived and then asked whether it was set, so the guard was true every time and an
// edit made during the save was overwritten by the server's copy of the state before it - and
// silently, because the same clearing meant nothing was scheduled to send it up again.
let _edits = 0;
let _key = null;           // which project is open
let _title = '';
let _draft = false;        // (phase V20) it is THE draft - not saved yet
let _misses = 0;           // projects asked for that were not there, one after another (load)
let _adv = null;          // the project's export settings, as the server holds them

// WHETHER IT MAY BE CHANGED. Read with the project and never changed here: the server decides (in the desktop
// app every project is the one person's, lib/ownership.js), and a refused project would have every edit
// refused at mutate() with a message rather than accepted here and thrown back one save later.
let _canEdit = true;
export function canEdit() { return _canEdit; }

/** (phase V28.4) This clip's file is not on the disk - it is red, to be replaced or removed. */
export const isGone = (c) => !!(c && c.src && _gone.has(_srcKey(c.src)));
/** How many pieces of media of the open project have no file - a clip and its sound below it are one. */
export function goneCount() {
  if (!_gone.size || !_timeline) return 0;
  const seen = new Set();
  for (const t of (_timeline.tracks || [])) for (const c of (t.clips || [])) if (isGone(c)) seen.add(String(c.pairId || c.id));
  return seen.size;
}
/** A file just deleted from the library: the open project's clips on it turn red now. */
export function markGone(src) {
  const k = _srcKey(src);
  if (!k || _gone.has(k)) return;
  _gone.add(k);
  _emit();
}
function _roMessage() { return 'Read only - this project cannot be changed here.'; }

// (phase V20, the owner 2026-10-08) NOTHING OPEN IS THE DRAFT: Merge with no project to open opens THE draft - one
// at a time, made when there is none - so the timeline and the chats work from the first press, and naming it waits
// for "save". ?p=<key> and the project this session was on still come first.
export function hasProject() { return !!_key; }
export function isDraft() { return _draft; }
/** The draft was saved under a name: no longer the draft. */
export function markSaved(t) { _draft = false; if (t != null) _title = String(t); _emit(); }
/**
 * (phase V49, the owner's (пр12)) THE DRAFT CLEARED: its lanes become a new timeline's - main video, main audio and
 * Subtitles, empty (the server's shape, GET /api/mv3/blank: lib/timeline-shape.js emptyBlank) - as ONE step to undo, so
 * Ctrl+Z brings the clips back; its frame stays. The draft itself stays as it is: its key, folder, title, category and
 * the drafts' conversation. Done here, through mutate(), and not by the server: the edit goes up the way every edit does,
 * quoting its version, with nothing for a save in the air to fight. -> 'cleared' | 'empty' (nothing on it to clear).
 */
export async function clearDraft() {
  const k = _key;
  if (!k || !_draft) throw new Error('only the draft is cleared');
  const d = await fetch('/api/mv3/blank').then(r => r.json());
  const tracks = d && d.success && d.timeline && d.timeline.tracks;
  if (!Array.isArray(tracks)) throw new Error((d && d.error) || 'could not read a new timeline');
  // Another project opened while the shape was on its way: nothing of it is cleared.
  if (_key !== k || !_draft) throw new Error('the draft is not open any more');
  // Nothing on it and the lanes of a new timeline already: no step to undo.
  const have = (_timeline && _timeline.tracks) || [];
  const ids = (l) => l.map(x => (x && x.kind) + ':' + (x && x.id)).join(',');
  if (have.every(x => !((x && x.clips) || []).length) && ids(have) === ids(tracks)) return 'empty';
  if (!mutate((t) => { t.tracks = clone(tracks); })) throw new Error(_status || 'not cleared');
  return 'cleared';
}
let _timer = null;
let _saving = false;
let _dirty = false;
let _subs = [];
let _status = null;        // last message worth showing the user
// (phase V28.4) THE FILES OF THIS PROJECT'S CLIPS THAT ARE NOT ON THE DISK - deleted from the library, most often: the
// server says which as the project opens (`missing`, lib/timeline-media.js), and a file deleted from the Library panel
// while it is open is added (markGone). A clip on one of them is red (timeline-b.js) until it is replaced or removed.
let _gone = new Set();
const _srcKey = (s) => String(s || '').split(/[?#]/)[0];

const clone = (v) => JSON.parse(JSON.stringify(v));

export function timeline() { return _timeline; }

// The kind every project has now - an ordered list of lanes. The talking-head editor's projects
// were rewritten into it at startup (lib/timeline-convert.js).
export const BLANK_KIND = 'blank';
export function kind() { return BLANK_KIND; }
export function version() { return _version; }
export function status() { return _status; }
// WHAT KIND OF NEWS the status is. Red is for "an edit of yours is not on the server"; the server laying
// its own cells - the fragments, the lines heard from the sound - is news, not a fault, and is said in a
// quiet colour (bar.js). Kept as the texts themselves, so a new message is a warning unless listed here.
const _INFO = new Set([
  'Fragments re-laid - the reads and the clips of this script are on the timeline.',
  'Captions laid from the sound.',
  'The fragments were laid again - it will merge in when your edit saves.',
  'The captions were laid from the sound - they merge in when your edit saves.',
  'The fragments were laid again while you edited - your edit was kept and merged in.',
  'The captions were laid from the sound while you edited - your edit was kept and merged in.',
  // (phase V54) Video to Music's track laid under its clip by the server.
  'Music laid under its clip.',
  'The music was laid under its clip - it merges in when your edit saves.',
  'The music was laid under its clip while you edited - your edit was kept and merged in.',
]);
export function statusIsInfo() { return _INFO.has(_status); }
// (phase V49.1, the owner's (пр29)) A REFUSAL OR A FAILURE - an edit refused (no project, read only, a rule of the lanes) or
// not saved: popped up once (bar.js, js/notice.js), and red in the timeline's header while it lasts. "Changed on another
// device" with the edit kept or the current version shown is news, as the server's own lays are - not an error.
export function statusIsError() {
  const s = String(_status || '');
  if (!s || statusIsInfo()) return false;
  return !/^Changed on another device/.test(s) || /not saved/i.test(s);
}
export function isReady() { return !!_timeline; }

export function onChange(cb) {
  if (typeof cb !== 'function') return;
  _subs.push(cb);
  try { cb(); } catch (e) {}
}
function _emit() { for (const cb of _subs) { try { cb(); } catch (e) {} } }

// Total length: the furthest clip end on any track. The ruler and FIT both need it,
// and deriving it beats storing it - a stored duration is one more thing that can
// disagree with the clips it is supposed to describe.
export function duration() {
  if (!_timeline) return 0;
  let end = 0;
  for (const k of Object.keys(_timeline.tracks || {})) {
    for (const c of (_timeline.tracks[k].clips || [])) {
      const e = (+c.start || 0) + (+c.dur || 0);
      if (e > end) end = e;
    }
  }
  return end;
}

export function key() { return _key; }
export function title() { return _title; }

// A project CAN be renamed now, and the new name has to reach everything that shows it -
// the picker, the generator's header, the strip - without reloading the timeline. Reloading
// would be the lazy way to refresh a string and would throw away any edit not yet saved.
export function setTitle(t) {
  _title = String(t || '');
  _emit();
}
export function adv() { return _adv; }
// The export window saves the settings itself (POST /api/mv3/adv) and says so here, so opening it
// again shows what was just used rather than what the project was loaded with.
export function setAdv(a) { _adv = (a && typeof a === 'object') ? a : null; }

// The picker's list, newest first. Not cached: it changes when a project is imported from
// Scenarios by something that is not this page.
export async function listFull() {
  const d = await fetch('/api/mv3/timelines').then(r => r.json());
  if (!d || !d.success) throw new Error((d && d.error) || 'could not list projects');
  return { list: d.list || [] };
}
export async function list() { return (await listFull()).list; }

// Switching project flushes first. Leaving unsaved work behind to load something else is
// how an edit disappears with no error anywhere.
export async function open(k) {
  if (_dirty) { try { await save(); } catch (e) {} }
  return load(k);
}

// ── WHICH PROJECT MERGE COMES BACK TO (phase R, the owner 2026-09-22) ──────
// The open project lives in the address (?p=<key>), which a reload keeps and a walk through the
// top strip loses - the link there goes to a bare /merge. So the key is also remembered, and
// Merge with no ?p= opens what was remembered. In SESSION storage, by the owner's decision: it is
// where you were this time the app was open, not a setting, and closing the app forgets it.
// (It also means nothing of this reaches the server - storage-sync.js mirrors localStorage only.)
//
// This replaces the older rule that a fresh /merge starts empty "because the empty page should be
// a preview of where + new project goes". Coming back to what you were doing beat it.
const SS_OPEN = 'mv3_open_key';
const _remember = (k) => { try { if (k) sessionStorage.setItem(SS_OPEN, k); else sessionStorage.removeItem(SS_OPEN); } catch (e) { /* a private window */ } };
const _remembered = () => { try { return sessionStorage.getItem(SS_OPEN) || ''; } catch (e) { return ''; } };

// Back to no project of its own - the draft (phase V20). The URL has to be cleared too, or load() would read the
// project that was just closed straight back out of ?p= - and so does the memory, for the same reason.
export async function openBlank() {
  if (_dirty) { try { await save(); } catch (e) {} }
  try {
    const u = new URL(location.href);
    u.searchParams.delete('p');
    history.replaceState({}, '', u);
  } catch (e) {}
  _remember('');
  return load();
}

export async function load(k) {
  let want = k;
  // ?p=<key> is Scenarios handing over a project it has just written. It is also what a
  // reload reads, because opening one from the picker puts it in the URL.
  if (!want) {
    try {
      const p = new URLSearchParams(location.search).get('p');
      if (p) want = p;
    } catch (e) {}
  }
  // ...and failing that, the one this session was last on (R6).
  let fromMemory = false;
  if (!want) { want = _remembered(); fromMemory = !!want; }

  // Nothing asked for: THE DRAFT (phase V20) - the one there is, or a new one. Not the newest project - see
  // hasProject() above.
  if (!want) {
    const dr = await fetch('/api/mv3/timeline/new', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draft: true }),
    }).then(r => r.json()).catch(() => null);
    if (dr && dr.success && dr.key) return load(dr.key);
    // The draft could not be had: the empty timeline, nothing open - edits wait for a project.
    const d = await fetch('/api/mv3/blank?kind=blank').then(r => r.json());
    if (!d || !d.success) throw new Error((d && d.error) || 'could not read the blank timeline');
    _timeline = d.timeline;
    _gone = new Set();
    _version = -1;
    _key = null;
    _title = '';
    _draft = false;
    _adv = null;
    _canEdit = true;
    _base = null;
    _dirty = false;
    _status = null;
    _bindHistory();
    _emit();
    return _timeline;
  }

  const r = await fetch('/api/mv3/timeline?key=' + encodeURIComponent(want));
  const d = await r.json();
  // A REMEMBERED project that is no longer there must not stop the page: it was deleted in
  // another tab, or the app was pointed at another library. Forget it and open empty (R6).
  if ((!d || !d.success) && fromMemory) { _remember(''); return load(''); }
  if (!d || !d.success) throw new Error((d && d.error) || 'could not read the timeline');
  // (phase V20) A project that is not there any more - one deleted, an old Alerts link - opens the draft, not whichever
  // project the server would pick in its place. Its ?p= goes from the address first, or the draft's load would read it
  // straight back. (phase V49) So does the empty shape the server answers with when there is no timeline at all (`found`).
  if (d.key !== want || d.found === false) {
    // Never round and round: a draft that cannot be had a few times over is an error, not another try.
    if (_misses++ > 2) { _misses = 0; throw new Error('the project could not be opened'); }
    try {
      const u = new URL(location.href);
      u.searchParams.delete('p');
      history.replaceState({}, '', u);
    } catch (e) {}
    _remember('');
    return load('');
  }
  _timeline = d.timeline;
  _gone = new Set((d.missing || []).map(m => _srcKey(m && m.src)).filter(Boolean));
  _version = d.version;
  _misses = 0;
  // (phase V49) What was said about one project is not said about the next one opened.
  if (d.key !== _key) _status = null;
  _key = d.key;
  _title = d.title || '';
  _draft = !!d.draft;
  _adv = d.adv || null;
  _canEdit = d.canEdit !== false;
  _base = clone(d.timeline);        // the floor a later merge measures "what did I change" against
  // The URL follows what is actually open, so a reload comes back to the same project while a
  // fresh /merge-v3 still starts empty. The server picks for an unknown key, so this stores
  // what it opened rather than what was asked for.
  try {
    const u = new URL(location.href);
    if (u.searchParams.get('p') !== _key) {
      u.searchParams.set('p', _key);
      history.replaceState({}, '', u);
    }
  } catch (e) {}
  _remember(_key);                  // and the walk to another page comes back here (R6)
  _dirty = false;
  _bindHistory();
  _emit();
  return _timeline;
}

// ── Merging someone else's changes ──────────────────────────────────────────
// A SECOND DEVICE IS NOT A CONFLICT TO LOSE. The old behaviour on a refused write was to
// adopt the server's state and drop the edit that had just been made - honest, but it threw
// away work. Nothing is thrown away now: the local change is replayed on top of whatever
// arrived, and the timeline says what came in from elsewhere.
//
// Three states are needed for that, not two. `_base` is the timeline as it was last agreed
// with the server, so "what did I change" is answerable at all - without it, local and remote
// merely differ and there is no way to tell an addition here from a deletion there.
//
// Deletions ARE honoured, from both sides. A delete is a click, not a disagreement, and a
// merge that resurrected it would mean never being able to remove a clip while another tab is
// open. What never happens is dropping a clip because the two states simply disagree.
let _base = null;

const _byId = (clips) => {
  const m = new Map();
  for (const c of (clips || [])) m.set(c.id, c);
  return m;
};
const _same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
let _idSeq = 0;
const _newId = () => 'm' + Date.now().toString(36) + '-' + (_idSeq++).toString(36) + '-' + Math.floor(Math.random() * 1e4).toString(36);

function _mergeTrack(base, mine, theirs, sortByStart) {
  const b = _byId(base.clips), m = _byId(mine.clips), t = _byId(theirs.clips);
  // ON THE SUBTITLE LANE the server lays the heard lines anew, under new ids (lib/captions-job.js, phase
  // K1). A heard line I RETYPED meanwhile is mine now - a typed line - though their lay replaced it: it
  // stays. And the heard lines their lay put over a typed line of mine it never saw go, the way the
  // server leaves out the words under a typed line it knows (review K1).
  const subs = theirs.kind === 'subs';
  const mineTyped = subs ? (mine.clips || []).filter(c => c && !isHeard(c) && !t.has(c.id)
    && (!b.has(c.id) || isHeard(b.get(c.id)))) : [];
  const over = (c) => mineTyped.some(k => (+c.start || 0) < (+k.start || 0) + (+k.dur || 0)
    && (+k.start || 0) < (+c.start || 0) + (+c.dur || 0));
  // A heard line I CORRECTED (K10) keeps its timed words, and it is mine as a typed line is: one their lay
  // never saw stays, the very object, and their words under it go one by one (_mergeBlank cuts around it).
  const fixed = subs ? new Set(_mineFixed(base, mine, theirs).map(c => c.id)) : new Set();
  const unlaid = subs ? new Set(_unlaid(base, mine, theirs).map(c => c.id)) : new Set();
  // THEIR LAY REPLACED THE HEARD LINES while mine were cut again (review K2): both sides put a new heard set
  // in place of the base's, and keeping both drew every word twice. Their lay wins for the heard lines; a
  // style of mine that changes the cut is applied to their words afterwards (_mergeBlank).
  const relaid = subs && (theirs.clips || []).some(c => isHeard(c) && !b.has(c.id));
  const out = [];
  // Their order first, so a clip added elsewhere keeps its place in their lane.
  for (const c of (theirs.clips || [])) {
    const inBase = b.has(c.id), inMine = m.has(c.id);
    if (inBase && !inMine) continue;                       // I deleted it - my click stands
    if (!inMine && !inBase && subs && isHeard(c) && over(c)) continue;   // laid over a line I typed
    if (!inMine) { out.push(c); continue; }                // added elsewhere - keep theirs
    const mc = m.get(c.id);
    // Mine only wins where I actually changed it; otherwise theirs may be the newer edit.
    out.push((inBase && _same(mc, b.get(c.id))) ? c : mc);
  }
  // Anything of mine they have never seen.
  for (const c of (mine.clips || [])) {
    if (!t.has(c.id) && !b.has(c.id) && (!(relaid && isHeard(c)) || fixed.has(c.id) || unlaid.has(c.id))) out.push(c);
  }
  // ...and a heard line I retyped, or corrected, that their lay replaced.
  for (const c of mineTyped) if (b.has(c.id)) out.push(c);
  for (const c of (mine.clips || [])) if (fixed.has(c.id) && b.has(c.id)) out.push(c);
  // Start order only where the order means nothing. On a lane whose clips may cover one another
  // the order is the stacking order, and a merge that tidied it would restack the picture as a
  // side effect of another device having saved. Captions are put in time order the moment one of mine
  // was put back among a lay's.
  if (sortByStart || mineTyped.length || fixed.size || unlaid.size) out.sort((x, y) => (+x.start || 0) - (+y.start || 0));

  // Track-level settings and the subtitle style: same rule, field by field.
  const merged = { ...theirs, clips: out };
  for (const k of Object.keys(mine)) {
    if (k === 'clips') continue;
    if (!_same(mine[k], base[k])) merged[k] = mine[k];
  }
  return merged;
}

// The heard lines I corrected that the server's copy does not have (K10): changed by me since the base, or
// new (a half of a cut, a page of a re-cut holding a corrected word). One the server has, it has kept - its
// lay keeps corrected lines - and one I left as it was and the server no longer has, "back to what was
// heard" took away: that one goes.
function _mineFixed(base, mine, theirs) {
  const b = _byId(base.clips), t = _byId(theirs.clips);
  return (mine.clips || []).filter(c => isHeard(c) && isCorrected(c) && !t.has(c.id)
    && (!b.has(c.id) || !_same(c, b.get(c.id))));
}

// New heard lines of mine (a half of a split, a page of a re-cut) WHERE THEIR LAY LAID NO WORD (review K10): it
// kept a corrected line there and left the words under it out - so it cannot stand in for mine, and dropping
// mine lost those words while the status said the edit was kept. [] when theirs laid nothing new.
function _unlaid(base, mine, theirs) {
  const b = _byId(base.clips), t = _byId(theirs.clips);
  const mids = [];
  for (const c of (theirs.clips || [])) {
    if (!isHeard(c) || b.has(c.id)) continue;
    const s0 = +c.start || 0;
    for (const w of c.words) mids.push(s0 + ((+w.s || 0) + (+w.e || 0)) / 2);
  }
  if (!mids.length) return [];
  return (mine.clips || []).filter(c => isHeard(c) && !t.has(c.id) && !b.has(c.id) && !isCorrected(c)
    && !mids.some(x => x >= (+c.start || 0) && x < (+c.start || 0) + (+c.dur || 0)));
}

// The words marked to stand out on a lane's heard lines, by their moment: "start:end" in hundredths -> [from, to].
function _markSpans(clips, skip) {
  const out = new Map();
  for (const c of (clips || [])) {
    if (!isHeard(c) || (skip && skip.has(c.id))) continue;
    const s0 = +c.start || 0;
    for (const w of timedWords(c)) {
      if (!w || !w.k) continue;
      const a = Math.round((s0 + (+w.s || 0)) * 100), z = Math.round((s0 + (+w.e || 0)) * 100);
      out.set(a + ':' + z, [a / 100, z / 100]);
    }
  }
  return out;
}

// MY MARKS ONTO THEIR LAY (review K10): a word marked or unmarked here while the server laid the lane again is a
// look of that word - it goes onto the word laid at its moment, as the server carries its own (captions-job.js).
// `marks`: [[from, to, on]]; only the lay's own lines are touched, never a line of mine kept as it is.
function _applyMarks(lane, marks, mineIds) {
  for (const c of (lane.clips || [])) {
    if (!isHeard(c) || mineIds.has(c.id)) continue;
    const s0 = +c.start || 0;
    for (const w of c.words) {
      const a = s0 + (+w.s || 0), z = s0 + (+w.e || 0), mid = (a + z) / 2;
      const hit = marks.find(([x, y]) => (mid >= x - 0.005 && mid <= y + 0.005) || ((x + y) / 2 >= a - 0.005 && (x + y) / 2 <= z + 0.005));
      if (!hit) continue;
      if (hit[2]) w.k = true; else delete w.k;
    }
  }
}

// Returns the merged timeline plus what arrived from the other device, for the notice.
function _merge(base, mine, theirs) {
  if (!base || !theirs || !Array.isArray(theirs.tracks)) return { timeline: mine, added: 0, removed: 0 };
  return _mergeBlank(base, mine, theirs);
}

// A project's lanes are a LIST, matched by id and never by position, and their order is the
// layer order. Treating the list as an object of named lanes is what once wiped projects: the
// lanes came back keyed "0", "1"... with no kind, and the retried save stored no lanes at all.
//
// Same rules as a lane's clips: a lane I deleted stays deleted, a lane added elsewhere is kept,
// a lane of mine they never saw goes back in beside the lane it followed here. Only audio lanes
// are put in start order - on a video lane the order of the clips is which one shows.
function _mergeBlank(base, mine, theirs) {
  const byId = (list) => new Map((Array.isArray(list) ? list : []).map((t) => [t.id, t]));
  const bL = byId(base.tracks), mL = byId(mine.tracks), tL = byId(theirs.tracks);
  const out = [];
  const recut = [];
  let added = 0, removed = 0;
  for (const t of theirs.tracks) {
    if (!t || !t.id) continue;
    const b = bL.get(t.id), m = mL.get(t.id);
    if (b && !m) continue;                                  // I removed the lane
    if (!m) { out.push(t); added += (t.clips || []).length; continue; }
    const bb = b || { clips: [] };
    const bIds = _byId(bb.clips), mIds = _byId(m.clips), tIds = _byId(t.clips);
    for (const c of (t.clips || [])) if (!bIds.has(c.id)) added++;
    for (const c of (bb.clips || [])) if (!tIds.has(c.id) && mIds.has(c.id)) removed++;
    const merged = _mergeTrack(bb, m, t, t.kind === 'audio');
    // Their lay came in while I changed how the lane is cut (a style field of the cut), or gave a heard
    // caption a look of its own (K6): cut their words my way, with my looks laid over them by time, once the
    // whole timeline is put together (the seams need its sound) - review K6: the look was dropped while the
    // status said the edit was kept.
    if (t.kind === 'subs' && (t.clips || []).some(c => isHeard(c) && !bIds.has(c.id))) {
      const looks = [];
      for (const c of (m.clips || [])) {
        if (!isHeard(c)) continue;
        const was = bIds.get(c.id);
        if (was && _same(lookOf(was), lookOf(c))) continue;
        if (!was && !lookOf(c)) continue;
        looks.push([+c.start || 0, (+c.start || 0) + (+c.dur || 0), lookOf(c)]);
      }
      const cutChanged = CUT_KEYS.some(k => !_same((m.style || {})[k], (bb.style || {})[k]));
      // ...or a line I corrected stands among their pages (K10): their words under it go, one by one.
      const mineFixed = _mineFixed(bb, m, t);
      const keep = new Set(mineFixed.map(c => c.id));
      // ...or lines of mine their lay laid nothing over (_unlaid): held as they are, like the corrected ones.
      const unlaid = _unlaid(bb, m, t);
      // No corrected line is cut again by the merge - theirs (their lay kept them) neither - unless I changed
      // how the lane is cut: then theirs are cut my way, as my page cut mine.
      if (!cutChanged) {
        for (const c of merged.clips) if (isHeard(c) && isCorrected(c)) keep.add(c.id);
        for (const c of unlaid) keep.add(c.id);
      }
      // ...and the words I marked or unmarked meanwhile go onto their words at the same moment.
      const mineB = _markSpans(bb.clips, keep), mineM = _markSpans(m.clips, keep);
      const marks = [];
      for (const [k, v] of mineM) if (!mineB.has(k)) marks.push([v[0], v[1], true]);
      for (const [k, v] of mineB) if (!mineM.has(k)) marks.push([v[0], v[1], false]);
      const cut = !!(looks.length || cutChanged || mineFixed.length || unlaid.length);
      if (cut || marks.length) recut.push({ lane: merged, looks, keep, marks, cut, mine: new Set((m.clips || []).map(c => c.id)) });
    }
    out.push(merged);
  }
  const mineList = Array.isArray(mine.tracks) ? mine.tracks : [];
  mineList.forEach((m, i) => {
    if (!m || !m.id || tL.has(m.id) || bL.has(m.id)) return;
    // Beside the lane it followed in my copy, so it lands in the layer I put it in.
    const prev = i > 0 ? mineList[i - 1] : null;
    const at = prev ? out.findIndex((x) => x.id === prev.id) : -1;
    out.splice(at + 1, 0, m);
  });
  // The format is one field: mine if I changed it, otherwise whatever is stored.
  const format = (mine.format !== base.format) ? mine.format : theirs.format;
  const timeline = { kind: theirs.kind || mine.kind || BLANK_KIND, format, tracks: out };
  const fmtChanged = mine.format !== base.format && theirs.format === base.format;
  for (const lane of out) {
    const r = recut.find(x => x.lane === lane);
    if (lane.kind !== 'subs' || (!r && !(fmtChanged && (lane.clips || []).some(isHeard)))) continue;
    if (!r || r.cut || fmtChanged) {
      const clips = r && (r.looks.length || r.keep.size) ? recutWithLooks(lane, timeline, r.looks, _newId, r.keep)
        : recutClips(lane, timeline, _newId);
      if (clips) lane.clips = clips;
    }
    if (r && r.marks.length) _applyMarks(lane, r.marks, r.mine);
  }
  return { timeline, added, removed };
}

// Bound on load rather than at boot: History reads and writes through us, and until there is
// a timeline to read there is nothing for it to snapshot.
function _bindHistory() {
  History.bind({
    read: () => _timeline,
    write: (state) => {
      if (!_canEdit) { _status = _roMessage(); _emit(); return; }
      // An edit like any other (K10b): without the count, a save already on its way when Ctrl+Z was pressed
      // took itself for the latest and put the undone state back on screen - and the undo was never saved.
      _timeline = state; _dirty = true; _edits++; _emit(); _schedule();
    },
  });
}

// The one way to change the timeline: one call, one undo step.
//
// A drag or a trim must therefore be committed ONCE, at the end of the gesture, and not
// per mousemove - a hundred snapshots of a clip sliding would bury the state you actually
// want back. The gesture keeps itself visible by moving the DOM directly and calls this
// only on release, which is also why no separate "live" variant is needed: the state at
// that moment is still the pre-gesture one, so the snapshot taken here is the right one.
export function mutate(fn, opts) {
  if (!_timeline || typeof fn !== 'function') return false;
  // With no project open the blank timeline is a prompt, not a workspace: there is nowhere to
  // save an edit to, so it is refused out loud instead of being accepted and then lost.
  if (!_key) { _status = 'Choose a project first - there is nothing open to edit.'; _emit(); return false; }
  // Somebody else's, open to look at. Refused here, at the one door every edit comes
  // through, so the lanes and the inspector need no rule of their own.
  if (!_canEdit) { _status = _roMessage(); _emit(); return false; }
  const draft = clone(_timeline);
  try { fn(draft); } catch (e) { _status = e.message; _emit(); return false; }
  // A change that changes nothing (a re-cut that comes out the same, a value set to itself) is no step to
  // undo and nothing to save (review K2).
  if (_same(draft, _timeline)) return true;
  // BEFORE the change is adopted - see the header. `opts.merge`: a series tag - the same gesture repeated
  // within a moment is one step to undo (history.js).
  History.push(opts && opts.merge);
  _timeline = draft;
  _dirty = true;
  _edits++;
  _emit();
  _schedule();
  return true;
}

function _schedule() {
  if (_timer) clearTimeout(_timer);
  _timer = setTimeout(() => { save().catch(() => {}); }, SAVE_DEBOUNCE);
}

export async function save(_merges = 0) {
  if (_timer) { clearTimeout(_timer); _timer = null; }
  if (!_timeline || !_dirty || _saving || !_key || !_canEdit) return;
  // A bound on the merge-and-retry loop. Three rounds means three writes from elsewhere landed
  // during one save; a fourth is a server that refuses everything, and hammering it is worse
  // than stopping and saying so.
  if (_merges > 3) {
    _status = 'Changed on another device repeatedly - your edit is still here but not saved yet.';
    _emit();
    return;
  }
  _saving = true;
  const sending = _version;
  const sentAt = _edits;
  try {
    const r = await fetch('/api/mv3/timeline', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: sending, key: _key, timeline: _timeline }),
    });
    const d = await r.json();
    if (r.status === 409) {
      // Somebody else changed it while this copy was being edited. Replay this change on top
      // of theirs and save that, rather than dropping either side. The retry quotes THEIR
      // version, so if a third write landed in between it 409s again and merges again.
      // The version is this project's own. It was one number for the whole file once, so
      // editing a DIFFERENT project refused this write too; the byte-identical case is kept
      // for the one save after that change, when a number from the old scheme meets a rev
      // that starts from 0 - nothing to report there, and saying "changed on another device"
      // about a project nobody touched would be as misleading as saying nothing when they did.
      const untouched = _same(d.timeline, _base);
      const who = untouched ? null : _serverOnly(_base, d.timeline);
      const { timeline, added, removed } = _merge(_base, _timeline, d.timeline);
      _timeline = timeline;
      _version = d.version;
      _base = clone(d.timeline);
      _bindHistory();
      if (!untouched) {
        const parts = [];
        if (added) parts.push(added + (added === 1 ? ' clip' : ' clips') + ' added');
        if (removed) parts.push(removed + (removed === 1 ? ' clip' : ' clips') + ' removed');
        // The server laying its own cells is not another device (_serverOnly).
        _status = (who && who.frag) ? 'The fragments were laid again while you edited - your edit was kept and merged in.'
          : who && who.laid && !who.heard ? 'The music was laid under its clip while you edited - your edit was kept and merged in.'
          : who ? 'The captions were laid from the sound while you edited - your edit was kept and merged in.'
          : 'Changed on another device' + (parts.length ? ' (' + parts.join(', ') + ')' : '')
            + ' - your edit was kept and merged in.';
      }
      _emit();
      _saving = false;
      return save(_merges + 1);     // still dirty on purpose: the merged state has to go up
    } else if (r.status === 404 && d && d.gone) {
      // (phase V49) The project is not there any more - deleted while this edit waited (the server never makes one
      // from a save): nothing to save it into, and trying again would only be refused again.
      if (d.key === _key) _dirty = false;
      _status = 'Not saved: this project is not there any more.';
    } else if (d && d.success) {
      // An edit that landed while this was in the air is newer than this answer. It stays
      // dirty so the next save carries it up, and the answer is NOT adopted into the live copy
      // below - adopting would be putting the older state back on top of it.
      const raced = _edits !== sentAt;
      _version = d.version;
      _dirty = raced;
      // The base is what the server STORED, normalising included - not what was sent. Adopting
      // it into the live copy too keeps the two exactly equal, which is what makes the merge's
      // "did I change this clip" comparison mean anything. Skipped if an edit arrived while the
      // save was in flight: that edit is newer than this answer, and the next save adopts.
      const stored = d.tracks
        ? { kind: (d.kind !== undefined ? d.kind : (_timeline && _timeline.kind)) || undefined,
            format: (d.format !== undefined ? d.format : (_timeline && _timeline.format)) || undefined,
            tracks: d.tracks }
        : clone(_timeline);
      _base = clone(stored);
      // NOT re-bound. History reads the live timeline through a closure, so there is nothing
      // to re-bind - and bind() starts the stacks over. Every edit schedules a save a moment
      // later, so re-binding here was emptying the undo stack after every single action: the
      // buttons lit up on the edit and went grey again before anyone could press them.
      if (!raced) _timeline = stored;
      else _schedule();
      // A message about another device stays; so does the news of a server lay this very save merged in
      // (_merges > 0) - the resave after a merge is what would otherwise wipe it at once.
      if (!/another device/.test(_status || '') && !(_merges > 0 && statusIsInfo())) _status = null;
    } else {
      throw new Error((d && d.error) || 'save refused');
    }
  } catch (e) {
    // Still dirty on purpose: the next mutate reschedules, so a blip does not lose work.
    _status = 'Not saved: ' + e.message;
  } finally {
    _saving = false;
    _emit();
  }
}

/**
 * Save what is not saved yet, and WAIT for it (phase K1) - for a press that hands the SAVED timeline to
 * the server, which listens to the sound it holds. save() itself returns at once while another save is
 * in the air. True when nothing is left unsaved.
 */
export async function flush() {
  for (let round = 0; round < 3; round++) {
    const t0 = Date.now();
    while (_saving && Date.now() - t0 < 10000) await new Promise(r => setTimeout(r, 50));
    if (_saving) return false;
    if (!_dirty) return true;
    await save();
  }
  return !_dirty;
}

// A reload or a navigation must not outrun the debounce.
try {
  const flush = () => { if (_dirty) { try { save(); } catch (e) {} } };
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
} catch (e) {}

// ── Watching for the other device ───────────────────────────────────────────
// Finding out at SAVE time that a project moved is finding out late: you have already spent
// ten minutes editing a timeline that is not the current one. So the version number - which is
// one small number, not the timeline - is checked periodically and when the tab is looked at
// again after being away.
//
// Clean copy: adopt the newer state outright. There is no local edit to weigh against it, so
// this is just being up to date, and it is said out loud because clips appearing on their own
// otherwise reads as a bug.
// Dirty copy: say what happened and leave it. The merge on save is where the two are
// reconciled, and pulling the rug mid-drag would be worse than telling you.
const WATCH_MS = 20000;

// TYPING IS AN EDIT TOO (review K10): a caption's text or a word being typed in and not written yet holds what
// the person means to save. Adopting a newer copy meanwhile - a lay from the sound - replaced the line under the
// field, and what was typed went nowhere. So while the page says a field holds unwritten typing (`setTyping`,
// the inspector), the copy counts as dirty: the field writes first, and the newer one merges in at the save, as
// for any edit. `typingDone` - the field was left - looks again at once when a copy was held back for it.
let _typingFn = null;
let _heldForTyping = false;
export function setTyping(fn) { _typingFn = typeof fn === 'function' ? fn : null; }
export function typingDone() {
  if (!_heldForTyping) return;
  _heldForTyping = false;
  refresh();
}
const _typingNow = () => { try { return !!(_typingFn && _typingFn()); } catch (e) { return false; } };

async function _checkRemote() {
  if (!_key || _saving || document.visibilityState === 'hidden') return;
  let v = null;
  try {
    const d = await fetch('/api/mv3/timeline/version?key=' + encodeURIComponent(_key)).then(r => r.json());
    v = d && d.success ? +d.version : null;
  } catch (e) { return; }
  if (v == null || !(v > _version)) return;
  // The number is this project's own, so a bump means this project moved. Its state is
  // fetched all the same - the merge needs the tracks, not the number - and the same-as-base
  // check stays for the save that only touched export settings or the title.
  let d = null;
  try { d = await fetch('/api/mv3/timeline?key=' + encodeURIComponent(_key)).then(r => r.json()); }
  catch (e) { return; }
  if (!d || !d.success || d.key !== _key) return;
  if (_same(d.timeline, _base)) { _version = d.version; return; }   // someone else's project

  // WHO CHANGED IT. The server lays two kinds of cell itself: a talking head's fragments
  // (lib/frag-mirror.js, phase T' - a read spoken or a clip filed re-lays the cells that carry `frag`)
  // and the lines heard from the sound (lib/captions-job.js, phase K1). Neither is "another device" -
  // it is this project's own work arriving. Told apart by looking at what actually differs: if every
  // cell and every lane setting the person owns is untouched, it was the server.
  const who = _serverOnly(_base, d.timeline);
  const typing = !_dirty && _typingNow();
  if (typing) _heldForTyping = true;
  if (_dirty || typing) {
    _status = !who ? 'Changed on another device - your edit will be merged in when it saves.'
      : who.frag ? 'The fragments were laid again - it will merge in when your edit saves.'
      : who.laid && !who.heard ? 'The music was laid under its clip - it merges in when your edit saves.'
      : 'The captions were laid from the sound - they merge in when your edit saves.';
    _emit();
    return;
  }
  // The lines laid from the sound are ONE step to undo, as they were when the page laid them itself:
  // the step is taken before the new state comes in. A mirror lay is not - undoing it would only fight
  // the mirror, which lays it again - and neither is somebody else's edit. (V54) Nor is the music laid under a clip: one step.
  const undoable = !!who && (who.heard || who.laid) && !who.frag;
  if (undoable) History.push();
  _timeline = d.timeline;
  _version = d.version;
  _base = clone(d.timeline);
  _title = d.title || _title;
  _adv = d.adv || _adv;
  if (!undoable) _bindHistory();
  _status = !who ? 'Changed on another device - this is the current version.'
    : who.frag ? 'Fragments re-laid - the reads and the clips of this script are on the timeline.'
    : who.laid && !who.heard ? 'Music laid under its clip.'
    : 'Captions laid from the sound.';
  _emit();
}

// Is the difference between two versions of a project ONLY in what the server lays itself - the
// workshop's cells (`frag`) and, on the subtitle lane, the lines heard from the sound (`words`)?
// Everything else is the person's: the other cells, every lane's own settings, which lanes there are
// and in what order. A change anywhere in that means somebody edited the project, whatever else moved
// with it. Null for that; otherwise { frag, heard } - which of the two moved.
const _isFrag = (c) => Number(c && c.frag) > 0;
// (phase V54, block 2) A clip the server laid itself - Video to Music's track under its clip (lib/audio-gens.js _layUnder): the
// mark rides only until this page saves (lib/timeline-shape.js keeps no such field).
const _isLaid = (c) => !!(c && c.laidBy);
function _serverOnly(base, theirs) {
  const lanes = (t) => (Array.isArray(t && t.tracks) ? t.tracks : []);
  const a = lanes(base);
  if (!a.length) return null;
  // A subtitle lane the server had to add - an old project without one - holds only heard lines. (V54) A sound lane it made for
  // a track it laid holds only that - and, on a timeline that had no sound lane, the empty main audio made before it (then
  // main video's link to it is the server's too). Those count only beside a track laid: an empty lane alone is somebody's.
  const newLane = (l) => !!l && !a.some(x => x.id === l.id);
  const laidLane = (l) => newLane(l) && l.kind === 'audio' && (l.clips || []).length && l.clips.every(_isLaid);
  let laid = lanes(theirs).some(laidLane);
  const made = new Set(lanes(theirs).filter(l => laidLane(l) || (laid && newLane(l) && l.kind === 'audio' && !(l.clips || []).length))
    .map(l => l.id));
  const b = lanes(theirs).filter(l => !(newLane(l) && l.kind === 'subs' && (l.clips || []).every(isHeard)) && !made.has(l.id));
  let heard = lanes(theirs).some(l => newLane(l) && l.kind === 'subs' && (l.clips || []).every(isHeard));
  let frag = false;
  if (a.length !== b.length) return null;
  const byId = (list) => list.slice().sort((x, y) => String(x.id).localeCompare(String(y.id)));
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    if (!x || !y || x.id !== y.id) return null;
    const { clips: xc, ...xf } = x;
    const { clips: yc, ...yf0 } = y;
    const yf = made.has(yf0.linkId) ? { ...yf0, linkId: xf.linkId } : yf0;
    if (!_same(xf, yf)) return null;
    const subs = x.kind === 'subs';
    // A heard line a person CORRECTED (K10) is the person's while the newer copy still has it - a lay keeps
    // corrected lines, so only a hand changes one; gone from the newer copy, "back to what was heard" took
    // it, and that is the server's own doing.
    const kept = new Set((yc || []).filter(isCorrected).map(c => c.id));
    const said1 = (c) => subs && isHeard(c) && !kept.has(c.id);
    // The person's cells: on the subtitle lane in any order (a lay puts the lines back in time
    // order), elsewhere as they are - on a video lane the order is which one shows. A talking head's caption
    // (`voice`, phase V30, block 1) is MOVED by the mirror with its line, a corrected one too: where it stands is
    // the server's, what it says is the person's.
    const placeFree = (c) => (subs && c && c.voice ? { ...c, start: 0, dur: 0 } : c);
    const own = (list) => (list || []).filter(c => !_isFrag(c) && !said1(c) && !_isLaid(c)).map(placeFree);
    if (subs ? !_same(byId(own(xc)), byId(own(yc))) : !_same(own(xc), own(yc))) return null;
    if (!_same((xc || []).filter(_isFrag), (yc || []).filter(_isFrag))) frag = true;
    const said = (list) => (list || []).filter(c => !_isFrag(c) && said1(c));
    if (subs && !_same(said(xc), said(yc))) heard = true;
    if (!_same((xc || []).filter(_isLaid), (yc || []).filter(_isLaid))) laid = true;
  }
  return (frag || heard || laid) ? { frag, heard, laid } : null;
}

/**
 * Look for a newer timeline NOW, instead of waiting for the next poll (phase Z', the owner
 * 2026-09-22). For the places that KNOW the server has just re-laid the cut - taking a line off the
 * script, putting it back - because twenty seconds of an unchanged timeline under the blur reads as
 * nothing having happened. It is the same check the watcher makes, not a second way of doing it.
 */
export async function refresh() {
  try { await _checkRemote(); } catch (e) { /* the watcher will try again */ }
}

try {
  setInterval(() => { _checkRemote().catch(() => {}); }, WATCH_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') _checkRemote().catch(() => {});
  });
} catch (e) {}
