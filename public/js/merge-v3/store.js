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

const SAVE_DEBOUNCE = 500;

// The drag payload a library tile puts on the clipboard and a lane reads back. A custom
// type on purpose: it is how an internal drag is told apart from an OS file drop, so the
// upload path and the timeline path can never claim each other's drops.
export const DRAG_TYPE = 'application/x-mv3-clip';

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
let _adv = null;          // the project's export settings, as the server holds them

// WHOSE IT IS, and whether that is you. Read with the project and never changed here: the
// server decides, and the answer only moves when a different project is opened. A project
// that is not yours opens all the same - to look at - and every edit is refused at mutate()
// with a message, rather than accepted here and thrown back by the server one save later.
let _owner = null;
let _ownerNick = null;
let _canEdit = true;
let _me = null;            // the signed-in person, as the list reports them
export function canEdit() { return _canEdit; }
export function owner() { return { owner: _owner, ownerNick: _ownerNick }; }
export function me() { return _me; }
function _roMessage() {
  return 'Read only - this project belongs to ' + (_ownerNick || (_owner ? 'another user' : 'everyone (shared)'))
       + '. Copy it to your profile to edit it.';
}

// NOTHING IS OPEN BY DEFAULT. Walking into Merge shows an empty timeline and the project
// picker, and the project is chosen deliberately - opening whatever happened to be open last
// is how you start editing the wrong video without noticing. The one exception is ?p=<key>,
// which is Scenarios handing over a project it has just written.
//
// The remembered-project localStorage key is gone with it: a preference that decides which
// project you edit is not a preference.
export function hasProject() { return !!_key; }
let _timer = null;
let _saving = false;
let _dirty = false;
let _subs = [];
let _status = null;        // last message worth showing the user

const clone = (v) => JSON.parse(JSON.stringify(v));

export function timeline() { return _timeline; }

// The kind every project has now - an ordered list of lanes. The talking-head editor's projects
// were rewritten into it at startup (lib/timeline-convert.js).
export const BLANK_KIND = 'blank';
export function kind() { return BLANK_KIND; }
export function isBlank() { return true; }
export function version() { return _version; }
export function status() { return _status; }
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
  _me = d.me || null;
  return { list: d.list || [], owners: d.owners || [], me: _me };
}
export async function list() { return (await listFull()).list; }

// Switching project flushes first. Leaving unsaved work behind to load something else is
// how an edit disappears with no error anywhere.
export async function open(k) {
  if (_dirty) { try { await save(); } catch (e) {} }
  return load(k);
}

// Back to nothing open. The URL has to be cleared too, or load() would read the project that
// was just closed straight back out of ?p=.
export async function openBlank() {
  if (_dirty) { try { await save(); } catch (e) {} }
  try {
    const u = new URL(location.href);
    u.searchParams.delete('p');
    history.replaceState({}, '', u);
  } catch (e) {}
  return load();
}

// A copy of a project under your own name, opened in its place. The one way to work on a
// project that is somebody else's or shared. Nothing is flushed first: a project you could
// not edit has no unsaved edit in it.
export async function copy(k) {
  const key = k || _key;
  if (!key) throw new Error('nothing open to copy');
  const d = await fetch('/api/mv3/timeline/' + encodeURIComponent(key) + '/copy', { method: 'POST' }).then(r => r.json());
  if (!d || !d.success) throw new Error((d && d.error) || 'could not copy');
  await open(d.key);
  return d.key;
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

  // Nothing asked for: the empty timeline, and no project open. Not the newest project -
  // see hasProject() above.
  if (!want) {
    // NOTHING OPEN LOOKS LIKE THE NEW KIND. Walking into Merge with no project shows the
    // blank-project timeline, because that is what pressing "+ new project" will make - the
    // empty page should be a preview of where you are going, not of where the editor came
    // from. Opening a project from the picker still brings its own kind with it.
    const d = await fetch('/api/mv3/blank?kind=blank').then(r => r.json());
    if (!d || !d.success) throw new Error((d && d.error) || 'could not read the blank timeline');
    _timeline = d.timeline;
    _version = -1;
    _key = null;
    _title = '';
    _adv = null;
    _owner = null; _ownerNick = null; _canEdit = true;
    _base = null;
    _dirty = false;
    _status = null;
    _bindHistory();
    _emit();
    return _timeline;
  }

  const r = await fetch('/api/mv3/timeline?key=' + encodeURIComponent(want));
  const d = await r.json();
  if (!d || !d.success) throw new Error((d && d.error) || 'could not read the timeline');
  _timeline = d.timeline;
  _version = d.version;
  _key = d.key;
  _title = d.title || '';
  _adv = d.adv || null;
  _owner = d.owner || null;
  _ownerNick = d.ownerNick || null;
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

function _mergeTrack(base, mine, theirs, sortByStart) {
  const b = _byId(base.clips), m = _byId(mine.clips), t = _byId(theirs.clips);
  const out = [];
  // Their order first, so a clip added elsewhere keeps its place in their lane.
  for (const c of (theirs.clips || [])) {
    const inBase = b.has(c.id), inMine = m.has(c.id);
    if (inBase && !inMine) continue;                       // I deleted it - my click stands
    if (!inMine) { out.push(c); continue; }                // added elsewhere - keep theirs
    const mc = m.get(c.id);
    // Mine only wins where I actually changed it; otherwise theirs may be the newer edit.
    out.push((inBase && _same(mc, b.get(c.id))) ? c : mc);
  }
  // Anything of mine they have never seen.
  for (const c of (mine.clips || [])) if (!t.has(c.id) && !b.has(c.id)) out.push(c);
  // Start order only where the order means nothing. On a lane whose clips may cover one another
  // the order is the stacking order, and a merge that tidied it would restack the picture as a
  // side effect of another device having saved.
  if (sortByStart) out.sort((x, y) => (+x.start || 0) - (+y.start || 0));

  // Track-level settings and the subtitle style: same rule, field by field.
  const merged = { ...theirs, clips: out };
  for (const k of Object.keys(mine)) {
    if (k === 'clips') continue;
    if (!_same(mine[k], base[k])) merged[k] = mine[k];
  }
  return merged;
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
    out.push(_mergeTrack(bb, m, t, t.kind === 'audio'));
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
  return { timeline: { kind: theirs.kind || mine.kind || BLANK_KIND, format, tracks: out }, added, removed };
}

// Bound on load rather than at boot: History reads and writes through us, and until there is
// a timeline to read there is nothing for it to snapshot.
function _bindHistory() {
  History.bind({
    read: () => _timeline,
    write: (state) => {
      if (!_canEdit) { _status = _roMessage(); _emit(); return; }
      _timeline = state; _dirty = true; _emit(); _schedule();
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
export function mutate(fn) {
  if (!_timeline || typeof fn !== 'function') return false;
  // With no project open the blank timeline is a prompt, not a workspace: there is nowhere to
  // save an edit to, so it is refused out loud instead of being accepted and then lost.
  if (!_key) { _status = 'Choose a project first - there is nothing open to edit.'; _emit(); return false; }
  // Somebody else's, open to look at. Refused here, at the one door every edit comes
  // through, so the lanes and the inspector need no rule of their own.
  if (!_canEdit) { _status = _roMessage(); _emit(); return false; }
  History.push();                 // BEFORE the change - see the header
  const draft = clone(_timeline);
  try { fn(draft); } catch (e) { _status = e.message; _emit(); return false; }
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
      const { timeline, added, removed } = _merge(_base, _timeline, d.timeline);
      _timeline = timeline;
      _version = d.version;
      _base = clone(d.timeline);
      _bindHistory();
      if (!untouched) {
        const parts = [];
        if (added) parts.push(added + (added === 1 ? ' clip' : ' clips') + ' added');
        if (removed) parts.push(removed + (removed === 1 ? ' clip' : ' clips') + ' removed');
        _status = 'Changed on another device' + (parts.length ? ' (' + parts.join(', ') + ')' : '')
                + ' - your edit was kept and merged in.';
      }
      _emit();
      _saving = false;
      return save(_merges + 1);     // still dirty on purpose: the merged state has to go up
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
      if (!/another device/.test(_status || '')) _status = null;
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

  // WHO CHANGED IT. A talking head lays its own fragments on the timeline (lib/frag-mirror.js,
  // phase T'): a read spoken or a clip filed re-lays the cells that carry `frag`, and that is not
  // "another device" - it is this project's own script arriving. Told apart by looking at what
  // actually differs: if every cell the person owns is untouched, it was the workshop.
  const mirrored = _fragOnly(_base, d.timeline);
  if (_dirty) {
    _status = mirrored
      ? 'The fragments were laid again - it will merge in when your edit saves.'
      : 'Changed on another device - your edit will be merged in when it saves.';
    _emit();
    return;
  }
  _timeline = d.timeline;
  _version = d.version;
  _base = clone(d.timeline);
  _title = d.title || _title;
  _adv = d.adv || _adv;
  _bindHistory();
  _status = mirrored
    ? 'Fragments re-laid - the reads and the clips of this script are on the timeline.'
    : 'Changed on another device - this is the current version.';
  _emit();
}

// Is the difference between two versions of a project ONLY in the cells the workshop owns? The
// person's cells - everything without `frag` - are compared lane by lane; a change anywhere in
// them means somebody edited the project, whatever else moved with it.
function _fragOnly(base, theirs) {
  const lanes = (t) => (Array.isArray(t && t.tracks) ? t.tracks : []);
  const a = lanes(base), b = lanes(theirs);
  if (!a.length || a.length !== b.length) return false;
  let mirrorMoved = false;
  for (let i = 0; i < a.length; i++) {
    const mine = (a[i].clips || []).filter(c => !(Number(c && c.frag) > 0));
    const yours = (b[i].clips || []).filter(c => !(Number(c && c.frag) > 0));
    if (!_same(mine, yours)) return false;
    if (!_same((a[i].clips || []).filter(c => Number(c && c.frag) > 0),
      (b[i].clips || []).filter(c => Number(c && c.frag) > 0))) mirrorMoved = true;
  }
  return mirrorMoved;
}

try {
  setInterval(() => { _checkRemote().catch(() => {}); }, WATCH_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') _checkRemote().catch(() => {});
  });
} catch (e) {}
