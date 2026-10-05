'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — the timeline store. The server owns it.

   This exists instead of reusing timeline_data_v2, and the difference is the whole
   point. That key was ONE localStorage blob holding every session's layout, mirrored
   last-write-wins: any tab could push a snapshot built on a stale copy and revert
   every project at once. It did, repeatedly.

   So:
     • the data lives in the library, not in a browser - each timeline a file in its project's
       folder, projects/<folder>/merge/<title>.json (lib/merge-store.js);
     • every read carries a `version`, every write must quote the version it is
       replacing, and a write quoting an old one is REFUSED with 409 rather than
       applied. A stale tab loses its write instead of everyone losing their work;
     • every file is written atomically, so a crash mid-write cannot truncate one.

   MANY TIMELINES, one per project, and one kind of project: an ordered list of lanes - video,
   audio, subtitles, text - made in Merge (`mv3_<stamp>`) or sent from Scenarios
   (`sv3_<scenariosProjectId>[_n]`). The talking-head editor's six fixed lanes are gone
   (docs/local-app/PLAN.md, phase 3); lib/timeline-convert.js rewrote its projects at startup.

   THE VERSION IS THE PROJECT'S. It was the file's - one counter, written whole - which
   was enough for one editor and wrong for a team: two people on two different projects
   refused each other's every save, and each refusal was a merge against a timeline the
   other had never touched. Each timeline now carries its own `rev`, bumped by the save
   that changes its tracks, and that is the number a save has to quote. The file-level
   `version` still ticks on every write, as a cheap "did anything change" for whoever
   asks without naming a project.

   WHO MAY WRITE. Each timeline names its `owner` - the person who created it. Anyone can
   open anything; only the owner or the admin can change it, and everybody else copies
   it (POST .../copy) and works on the copy. Timelines that predate ownership carry
   `owner: null`: shared, and the admin's to edit. The rule lives in lib/ownership.js.

   Endpoints:
     GET    /api/mv3/timelines             -> { success, version, list, owners, me } newest first
     GET    /api/mv3/timeline?key=…        -> { success, version, key, timeline, owner, canEdit }
     GET    /api/mv3/timeline/version?key= -> { success, version }  this project's rev
     PUT    /api/mv3/timeline              { version, key, timeline } -> { success, version }
                                           409 { success:false, version, timeline } on a
                                           stale version, so the caller can reconcile
                                           rather than guess.
                                           403 when the project is somebody else's.
   ═══════════════════════════════════════════════════════════════════════════ */

const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const OWN = require('../lib/ownership');

const MSTORE = require('../lib/merge-store');

// The shape of a timeline and the empty project (lib/timeline-shape.js, moved out in phase K1).
const SHAPE = require('../lib/timeline-shape');
const { BLANK_KIND, emptyBlank: _emptyBlank, sanitizeBlank: _sanitizeBlank } = SHAPE;


// The key a page asks for when it has nothing to ask for and the store is empty.
const LOCAL_KEY = 'local';

// The whole store as one state - { version, updatedAt, timelines, hidden, snapshots, volRule }:
// frozen overlay arrangements (written only when a render is kept), and which timelines have had
// their track volumes reset for the master rule. lib/merge-store.js assembles it from the files.
function _read() {
  return MSTORE.read();
}

// Every film a timeline plays, for the proxy warm-up. Both shapes of `tracks`: the
// talking-head object of lanes and the blank project's array of them.
function _clipSrcs(t) {
  const out = [];
  const tracks = (t && t.tracks) || {};
  const lanes = Array.isArray(tracks) ? tracks : Object.values(tracks);
  for (const lane of lanes) for (const c of ((lane && lane.clips) || [])) if (c && c.src) out.push(String(c.src));
  return out;
}
// Lazily, and never fatal: the proxy maker lives in routes/proxies.js, and an open or an
// import must not fail because a warm-up could not start.
function _warmProxies(t) {
  try { require('./proxies').warmProxies(_clipSrcs(t), 480); } catch (e) {}
}

// The project the page should open when it has no preference: the most recently touched.
function _newestKey(timelines) {
  const keys = Object.keys(timelines || {});
  if (!keys.length) return null;
  return keys.sort((a, b) => String(timelines[b].updatedAt || '').localeCompare(String(timelines[a].updatedAt || '')))[0];
}

// A timeline's own version. Absent on anything written before there was one, and 0 is the
// right reading: the first save after that bumps it to 1, and any number quoted from the
// file-counter days is stale against it - one 409, one merge, and the tab is on the new rule.
const _revOf = (t) => Number(t && t.rev) || 0;

// Only what changed is written; side data (hidden, snapshots, volRule) a caller leaves out is
// kept as it was.
function _write(state) {
  MSTORE.write(state);
}


// The picker's list. Newest first, so an imported project is at the top.
router.get('/mv3/timelines', (req, res) => {
  try {
    const s = _read();
    const own = _folderFiles(Object.keys(s.timelines));
    const list = Object.keys(s.timelines).map(key => {
      const t = s.timelines[key];
      let clips = 0;
      for (const tr of (Array.isArray(t.tracks) ? t.tracks : [])) clips += ((tr && tr.clips) || []).length;
      return { key, title: t.title || 'Untitled', createdAt: t.createdAt || null, updatedAt: t.updatedAt || null,
               kind: t.kind || null, clips, rev: _revOf(t), ownFiles: own.has(key), ...OWN.ownerView(t) };
    }).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    // Everyone sees every owner. The picker groups by them; which entries the caller may
    // change is answered per project, from its `owner` against `me`.
    res.json({ success: true, version: s.version, list, open: _newestKey(s.timelines),
               owners: OWN.ownersOf(Object.values(s.timelines), req.user), me: OWN.meView(req.user) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/mv3/timeline', (req, res) => {
  try {
    const s = _read();
    // No key, or one that is not there: hand back the most recently touched project. A 404
    // would make the page's first load depend on it already knowing what exists.
    let key = String(req.query.key || '');
    if (!key || !s.timelines[key]) key = _newestKey(s.timelines) || LOCAL_KEY;
    let t = s.timelines[key];
    // One still in the talking-head shape (nothing should be: the upgrade rewrites them at start)
    // is shown rewritten rather than handed to an editor that cannot read it; its next save stores it.
    if (t && !Array.isArray(t.tracks)) t = require('../lib/timeline-convert').convert({ key, ...t }, { root: require('../lib/config').ROOT_DIR }) || t;
    // The proxies this project's preview will ask for, started now - before the page has even
    // drawn its lanes - one ffmpeg at a time, so the first play is not the first transcode.
    if (t) _warmProxies(t);
    res.json({
      success: true, version: _revOf(t), key,
      title: t ? t.title : 'Untitled',
      ...OWN.ownerView(t), canEdit: OWN.canEdit(t, req.user),
      adv: t ? (t.adv || null) : null,
      timeline: t ? { kind: BLANK_KIND, format: t.format || '9:16', tracks: t.tracks } : _emptyBlank(),
    });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// The shape of nothing. Entering Merge without a project shows an empty timeline and waits
// for one to be chosen, and the page needs the same track shape the real ones have - built
// here rather than client-side so there is one definition of it.
router.get('/mv3/blank', (req, res) => {
  try { res.json({ success: true, timeline: _emptyBlank() }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Cheap enough to poll. Kept separate so watching for someone else's change does not
// pull the whole timeline every few seconds. With a key it answers for that one project;
// without one, the file's counter, which moves on every write to anything.
router.get('/mv3/timeline/version', (req, res) => {
  try {
    const s = _read();
    const key = String(req.query.key || '');
    if (!key) return res.json({ success: true, version: s.version });
    const t = s.timelines[key];
    if (!t) return res.status(404).json({ success: false, error: `no project "${key}"` });
    res.json({ success: true, version: _revOf(t), key });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.put('/mv3/timeline', (req, res) => {
  try {
    const cur = _read();
    const claimed = Number((req.body || {}).version);
    if (!Number.isFinite(claimed)) {
      return res.status(400).json({ success: false, error: 'version is required - a write that does not say what it replaces cannot be checked' });
    }
    const key = String((req.body || {}).key || '').trim() || _newestKey(cur.timelines) || LOCAL_KEY;
    const prev = cur.timelines[key];
    // Somebody else's project: refused before the version is even looked at. The page shows
    // it read-only and should never send this; this is for the page that did not know.
    if (prev && !OWN.canEdit(prev, req.user)) return OWN.refuse(res, prev);
    // The refusal that makes this store different, checked against THIS project's rev - see
    // the top of the file. The current state goes back with it, so the caller can reconcile
    // in one round trip instead of two. Nothing stored means nothing to protect, so a number
    // is not held against a project that no longer exists.
    if (prev && claimed !== _revOf(prev)) {
      return res.status(409).json({
        success: false, error: 'stale version', expected: _revOf(prev), got: claimed,
        version: _revOf(prev), key,
        timeline: { kind: BLANK_KIND, format: prev.format || '9:16', tracks: prev.tracks },
      });
    }
    // A project's lanes are a list. Anything else is a page that has lost track of what it holds,
    // and storing it would store no lanes at all - refused, not saved.
    const incoming = (req.body || {}).timeline;
    if (!Array.isArray(incoming && incoming.tracks)) {
      return res.status(400).json({ success: false, error: 'this project keeps its lanes as a list - the edit was not saved, reload the project' });
    }
    const now = new Date().toISOString();
    const clean = _sanitizeBlank(incoming);
    cur.timelines[key] = {
      title: prev ? prev.title : 'Untitled',
      createdAt: prev ? (prev.createdAt || now) : now,
      updatedAt: now,
      adv: prev ? (prev.adv || null) : null,
      from: prev ? (prev.from || null) : null,
      // Whose it is, set once at creation and carried across every save after; and how many
      // saves there have been, which is the number the next one must quote.
      owner: prev ? (prev.owner || null) : OWN.uidOf(req),
      rev: _revOf(prev) + 1,
      kind: BLANK_KIND,
      format: clean.format,
      tracks: clean.tracks,
    };
    const next = { version: cur.version + 1, updatedAt: now, timelines: cur.timelines, hidden: cur.hidden, snapshots: cur.snapshots };
    _write(next);
    // The STORED tracks go back, not just the version. _sanitize normalises as it writes -
    // a missing field becomes an explicit null, a band number its default - so what the caller
    // sent and what is now here are not byte-identical. The caller needs the stored shape to
    // compare against later: a merge that measures "what did I change" against the version it
    // sent would count the normalising itself as a change.
    res.json({ success: true, version: cur.timelines[key].rev, updatedAt: now, key,
               kind: cur.timelines[key].kind || null, format: cur.timelines[key].format || null,
               tracks: cur.timelines[key].tracks });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Export settings for one project. Their own endpoint on purpose: pressing Apply in the
// export dialog must not rewrite the timeline, and a timeline save must not rewrite them.
router.post('/mv3/adv', (req, res) => {
  try {
    const b = req.body || {};
    const key = String(b.key || '');
    const cur = _read();
    const t = cur.timelines[key];
    if (!t) return res.status(404).json({ success: false, error: `no project "${key}"` });
    if (!OWN.canEdit(t, req.user)) return OWN.refuse(res, t);
    t.adv = (b.adv && typeof b.adv === 'object') ? b.adv : null;
    t.updatedAt = new Date().toISOString();
    _write({ version: cur.version + 1, updatedAt: t.updatedAt, timelines: cur.timelines, hidden: cur.hidden, snapshots: cur.snapshots });
    res.json({ success: true, version: _revOf(t) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

/* ── Keeping or discarding a render ──────────────────────────────────────────
   The render lands in finals/ the moment ffmpeg finishes, which is BEFORE you have
   looked at it. So:

     keep     makes its thumbnail;
     discard  deletes the file.

   The renders shelf in the Library is the finals/ directory itself, so discarding really
   does have to remove the file - there is no record to leave out.
   ──────────────────────────────────────────────────────────────────────────── */
const { FINALS_DIR } = require('../lib/config');
// The video poster maker, not lib/helpers' createThumbnail - that one is sharp, which
// reads images and cannot open an mp4. This is the same one-frame-at-0.5s grab the media
// library already uses, so a render's card looks like every other clip's.
const { makeThumb, thumbUrlFor } = require('../lib/video-thumb');

// A url like /media/renders/<project>/<name>.mp4 -> the absolute path, with nothing able to walk
// out of the renders folder.
function _finalPath(url) {
  const clean = String(url || '').split('?')[0];
  if (!/\.(mp4|mov|webm|mkv)$/i.test(clean)) return null;
  return require('../lib/media').toDiskWithin(clean, [FINALS_DIR]);
}

// ── A finished render: filed, named, kept ────────────────────────────────────
// Two doors in the order the result window uses them.
//
//   finish   the moment a render exists: filed into the queue as ready, so it can be found
//            again after the window closes;
//   save     Save & download: the file takes the name typed (renamed in finals/, with its
//            poster), and gets a poster if it has none.
const MVQ = require('./mv3q');
const _ROOT_DIR = require('../lib/config').ROOT_DIR;
const { toUrl } = require('../lib/media');
const _safeName = (s) => String(s || '').replace(/[\\\/:*?"<>|]/g, '-').replace(/[#?&%]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 100);
const _thumbAbs = (url) => { try { return path.join(_ROOT_DIR, String(thumbUrlFor(url)).replace(/^\/+/, '')); } catch (e) { return null; } };

router.post('/mv3/render/finish', (req, res) => {
  try {
    const b = req.body || {};
    const abs = _finalPath(b.url);
    if (!abs || !fs.existsSync(abs)) return res.status(404).json({ success: false, error: 'no such render' });
    const item = MVQ.fileFinished({ url: b.url, title: b.title, key: b.key, kind: b.kind, dur: b.dur,
                                    owner: OWN.uidOf(req), ownerNick: req.user ? req.user.nickname : null });
    res.json({ success: true, queueId: item.id });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Renames the file (and its poster) to `name` in its own project folder, uniquified. Returns the
// new url.
function _renameFinal(abs, url, name) {
  const want = _safeName(name);
  if (!want || want + '.mp4' === path.basename(abs)) return { abs, url };
  const dir = path.dirname(abs);
  let target = path.join(dir, want + '.mp4');
  for (let n = 2; fs.existsSync(target); n++) target = path.join(dir, `${want} (${n}).mp4`);
  fs.renameSync(abs, target);
  const nextUrl = toUrl(target);
  try {
    const oldT = _thumbAbs(url), newT = _thumbAbs(nextUrl);
    if (oldT && newT && fs.existsSync(oldT)) fs.renameSync(oldT, newT);
  } catch (e) { /* a poster is remade on demand */ }
  return { abs: target, url: nextUrl };
}

router.post('/mv3/render/save', async (req, res) => {
  try {
    const b = req.body || {};
    const abs = _finalPath(b.url);
    if (!abs || !fs.existsSync(abs)) return res.status(404).json({ success: false, error: 'no such render' });
    const name = String(b.name || '').trim().slice(0, 160) || path.basename(abs, '.mp4');
    const moved = _renameFinal(abs, b.url, name);
    let thumb = null;
    try { thumb = await makeThumb(moved.url); } catch (e) { /* a missing poster is not a reason to lose the render */ }
    const patch = { url: moved.url, title: name };
    const entry = (b.queueId && MVQ.updateEntry(String(b.queueId), patch)) || (MVQ.findByUrl(b.url) && MVQ.updateEntry(MVQ.findByUrl(b.url).id, patch)) || null;
    res.json({ success: true, url: moved.url, name, thumb: thumb || null, queueId: entry ? entry.id : null });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/mv3/render/discard', (req, res) => {
  try {
    const abs = _finalPath((req.body || {}).url);
    if (!abs) return res.status(400).json({ success: false, error: 'not a render path' });
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
    // The queue entry filed at finish goes with the file.
    try { MVQ.removeByUrl(String((req.body || {}).url || '')); } catch (e) {}
    // Its poster too, if one was made.
    try {
      const turl = thumbUrlFor(toUrl(abs));
      const tabs = path.join(_ROOT_DIR, String(turl).replace(/^\/+/, ''));
      if (fs.existsSync(tabs)) fs.unlinkSync(tabs);
    } catch (e) {}
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Delete one project's timeline. The confirmation is the page's job (the button turns into
// "really?"), so this just does it - a second confirmation here would be theatre.
/* ── A project that did not come from Scenarios ──────────────────────────────
   POST /api/mv3/timeline/new { title } | { projectId } -> { success, key, version }

   Every project until now arrived with a cut behind it: Scenarios writes sv3_<projectId> and
   fills the Main track. This makes an empty one, and there are two ways to be empty:

     { title }      a project of Merge's own, keyed mv3_<stamp> so the origin is readable from
                    the key alone. The caller opens it and builds the timeline by hand.
     { projectId }  a TALKING HEAD, keyed sv3_<projectId>. The scenario project already exists
                    (it was made from a scenario); this gives it the timeline it will be
                    assembled into, empty, so it is in the picker from the moment it exists
                    rather than appearing only after the first send.

   THE TITLE IS TAKEN, NOT DEFAULTED, and the reason is that nothing in this app can rename a
   project. An "Untitled" made here would stay Untitled forever, so a blank title is refused
   rather than quietly accepted. A talking head has a name already - the project's - so it
   passes none. */
router.post('/mv3/timeline/new', (req, res) => {
  try {
    const b = req.body || {};
    const projectId = String(b.projectId == null ? '' : b.projectId).trim();
    const cur = _read();
    let key = '';
    let title = '';

    if (projectId) {
      const p = require('../lib/projects-store').get(projectId);
      if (!p) return res.status(404).json({ success: false, error: 'no such project' });
      // The FIRST free one, the same way a send numbers them: sv3_<id>, then _2, _3. An empty
      // timeline made here is the one the first assembly fills, so in practice this is _1.
      const base = 'sv3_' + projectId;
      key = base;
      for (let n = 2; cur.timelines[key]; n++) key = base + '_' + n;
      // Named after the project and the day, like a send names its cut. Uniqueness is not
      // checked: for an sv3_ key the folder is the PROJECT's folder (lib/merge-store.js), so
      // two same-named timelines cannot collide over a folder the way Merge's own do.
      title = `${new Date().toISOString().slice(0, 10)} - ${String(p.title || p.name || '').trim() || 'talking head'}`;
    } else {
      title = String(b.title || '').trim();
      if (!title) return res.status(400).json({ success: false, error: 'a title is required' });
      if (title.length > 120) return res.status(400).json({ success: false, error: 'title is too long (120 max)' });
      // Two projects with one name are two shelves with one label in the library. The rename
      // route refuses it; creation has to as well, or the rule only holds half the time.
      if (_titleTaken(cur.timelines, title, null)) {
        return res.status(409).json({ success: false, error: 'a project called "' + title + '" already exists' });
      }
      // The stamp is unique in practice; the loop is for the case it is not (two clicks inside one
      // millisecond, or a clock that went backwards) so a new project can never land on top of an
      // existing timeline.
      key = 'mv3_' + Date.now();
      for (let n = 1; cur.timelines[key]; n++) key = 'mv3_' + Date.now() + '_' + n;
    }

    const now = new Date().toISOString();
    cur.timelines[key] = {
      title,
      createdAt: now,
      updatedAt: now,
      adv: null,
      owner: OWN.uidOf(req),
      rev: 1,
      kind: BLANK_KIND,
      format: '9:16',
      tracks: _emptyBlank().tracks,
    };
    const version = cur.version + 1;
    _write({ version, updatedAt: now, timelines: cur.timelines, hidden: cur.hidden, snapshots: cur.snapshots });
    res.json({ success: true, key, version, title });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Case-insensitive, because two projects called "Rome" and "rome" are two projects nobody can
// tell apart in a picker - and they would share a library category exactly.
function _titleTaken(timelines, title, exceptKey) {
  const want = String(title || '').trim().toLowerCase();
  return Object.keys(timelines || {}).some(k =>
    k !== exceptKey && String((timelines[k] || {}).title || '').trim().toLowerCase() === want);
}

/**
 * PATCH /api/mv3/timeline/:key/title   { title } -> { success, title }
 *
 * Projects could not be renamed, and the picker said so in its own error message. They can now,
 * and the reason it is worth the route is the library: a project's generations are filed under a
 * category named after it, so a project stuck with a bad name is a shelf stuck with one too.
 *
 * THE CATEGORY MOVES WITH IT. Renaming only the project would leave the pictures filed under a
 * name that no longer exists anywhere - which is worse than not renaming at all, because the
 * shelf would still look right until somebody went looking for the project it names.
 */
router.patch('/mv3/timeline/:key/title', (req, res) => {
  try {
    const key = String(req.params.key || '');
    const title = String((req.body || {}).title || '').trim();
    if (!title) return res.status(400).json({ success: false, error: 'a name is needed' });
    if (title.length > 120) return res.status(400).json({ success: false, error: 'title is too long (120 max)' });

    const cur = _read();
    const rec = cur.timelines[key];
    if (!rec) return res.status(404).json({ success: false, error: `no project "${key}"` });
    if (!OWN.canEdit(rec, req.user)) return OWN.refuse(res, rec);
    if (String(rec.title || '') === title) return res.json({ success: true, title, version: _revOf(rec) });
    if (_titleTaken(cur.timelines, title, key)) {
      return res.status(409).json({ success: false, error: 'a project called "' + title + '" already exists' });
    }

    const was = String(rec.title || '');
    rec.title = title;
    const now = new Date().toISOString();
    _write({ version: cur.version + 1, updatedAt: now, timelines: cur.timelines, hidden: cur.hidden, snapshots: cur.snapshots });

    // Found by the name the filing used, and shortened by the same rule - see catLabelFor.
    // A failure here is not a failure to rename: the project has the name asked for, and a
    // category left behind is a tidying problem rather than lost work.
    let moved = false;
    try {
      const GENS = require('../lib/mv3-gens');
      const LC = require('../lib/library-cats');
      const oldLabel = GENS.catLabelFor(was);
      const newLabel = GENS.catLabelFor(title);
      if (oldLabel !== newLabel && oldLabel !== GENS.LOOSE_CAT) {
        const own = ((LC.read().images || {}).own) || [];
        const cat = own.find(c => c.label === oldLabel);
        if (cat) { require('../lib/shelf-files').renameCategory('images', cat.id, newLabel); moved = true; }
      }
    } catch (e) { console.warn('[mv3] could not move the library category:', e.message); }

    res.json({ success: true, key, title, was, version: _revOf(rec), categoryMoved: moved });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// WHICH TIMELINES HOLD A PROJECT'S OWN FILES (phase C3): the last timeline left in a talking head's folder -
// projects/<name>/ with its project.json, reads, frames and clips. Deleting that timeline can take the folder too;
// one with another timeline beside it (a copy) cannot - the other still uses the files.
function _folderFiles(keys) {
  const PROJECTS = require('../lib/projects-store');
  const talking = new Set(PROJECTS.entries().filter(e => e.kind === 'scenarios').map(e => e.folder));
  const byFolder = new Map();
  for (const k of keys) {
    const at = MSTORE.locate(k);
    if (at && talking.has(at.folder)) byFolder.set(at.folder, (byFolder.get(at.folder) || []).concat(k));
  }
  const out = new Set();
  for (const ks of byFolder.values()) if (ks.length === 1) out.add(ks[0]);
  return out;
}

router.delete('/mv3/timeline/:key', (req, res) => {
  try {
    const key = String(req.params.key || '');
    const cur = _read();
    if (!cur.timelines[key]) return res.status(404).json({ success: false, error: `no project "${key}"` });
    // Deleting is the one write nobody but the owner should be able to undo their way out of,
    // so it is held to the same line as the rest - and the admin's on anything.
    if (!OWN.canEdit(cur.timelines[key], req.user)) return OWN.refuse(res, cur.timelines[key]);
    // AND ITS FILES (?files=1, phase C3, the owner 2026-10-05): a talking head's folder - its reads, frames and
    // clips - goes with its last timeline (PROJECTS.remove: what another project, timeline or shelf still points
    // at is moved to media/work first). The Library's categories named after the project are not in that folder
    // and stay, with what was made into them. Refused while something is still being made for the project: a
    // clip landing in a folder that is gone would be lost, and it was paid for.
    let proj = null;
    if (String(req.query.files || '') === '1') {
      const at = MSTORE.locate(key);
      const PROJECTS = require('../lib/projects-store');
      const e = at ? PROJECTS.entries().find(x => x.kind === 'scenarios' && x.folder === at.folder) : null;
      if (e) {
        if (!_folderFiles(Object.keys(cur.timelines)).has(key)) {
          return res.status(409).json({ success: false, error: 'Another timeline of this project still uses its files - delete the timeline only.' });
        }
        const running = require('../lib/alerts').list().filter(r => r && r.state === 'running' && r.where && r.where.spot
          && String(r.where.spot.key || '') === key).length;
        if (running) {
          return res.status(409).json({ success: false, running,
            error: running + (running === 1 ? ' thing is' : ' things are') + ' still being made for this project - wait for '
              + (running === 1 ? 'it' : 'them') + ' or let ' + (running === 1 ? 'it' : 'them') + ' go in Alerts first.' });
        }
        proj = e;
      }
    }
    delete cur.timelines[key];
    const now = new Date().toISOString();
    _write({ version: cur.version + 1, updatedAt: now, timelines: cur.timelines, hidden: cur.hidden, snapshots: cur.snapshots });
    let files = null;
    if (proj) {
      const { moved } = require('../lib/projects-store').remove(proj.id);
      files = { removed: true, kept: moved };
    }
    res.json({ success: true, version: cur.version + 1, open: _newestKey(cur.timelines), files });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

/* ── The Scenarios project behind a Merge key ────────────────────────────────
   GET /api/mv3/timeline/:key/source -> { success, project | null, via }

   The result window fills the parts of a creative's name from the Scenarios record - the
   vertical, the product, the cast character, the gender. A project imported from Scenarios
   carries that record's id in its key (sv3_<id>); a COPY does not - it gets a key of its own,
   and until now it kept nothing about where it came from, so a render out of a copy was named
   from its title alone. A copy now remembers its source (`from`), and this walks that chain
   back to the import. Copies made before the field existed are matched by TITLE instead: the
   import names a project after the record, date first, and a copy adds "(copy)"; both are
   taken off before comparing, and so is the "(2)" a second import gets.
   ──────────────────────────────────────────────────────────────────────────── */
const _titleBase = (s) => String(s || '')
  .replace(/^local_\d+_/, '')
  .replace(/^(\d{4}-\d{2}-\d{2}\s*[-—–]\s*)+/, '')
  .replace(/\s*\(copy(?: \d+)?\)$/i, '')
  .replace(/\s*\(\d+\)$/, '')
  .replace(/\s*·\s*stills$/i, '')
  .trim().toLowerCase();

// The Scenarios projects, for the one thing Merge still asks them about: which project a timeline
// was made from, for its name. (The require used to sit with the import route that phase G took.)
const SCEN3 = require('./scen3');

// `loaded` is the scenarios, for a caller resolving a whole list at once: without it every
// call reads them off disk again.
function _scenBehind(timelines, key, loaded) {
  const all = loaded || SCEN3.loadProjects() || [];
  const byId = (id) => all.find(x => String(x.id) === String(id)) || null;
  const seen = new Set();
  let k = String(key || '');
  while (k && !seen.has(k)) {
    seen.add(k);
    const m = /^sv3_(\d+)/.exec(k);
    if (m) { const p = byId(m[1]); if (p) return { p, via: 'key' }; break; }
    const t = timelines[k];
    if (!t || !t.from) break;
    k = String(t.from);
  }
  const t = timelines[String(key || '')];
  const base = t ? _titleBase(t.title) : '';
  const p = base ? all.find(x => _titleBase(x.name) === base) : null;
  return p ? { p, via: 'title' } : null;
}

// THE HOOK THAT NAMES THE RENDER. The Meta pattern carries a hook id (…_AUTH_H03_…) and
// it is the hook the video OPENS with: a clip on a video lane starting at the very start of the
// timeline whose file has a hook number (lib/hook-ids.js). One that begins a moment later is an
// insert, not the hook the creative is built on, so only the first frames count - anything within
// a frame of zero at 30 fps. The top layer wins when two qualify. None, and the field keeps its
// Hxx placeholder.
const HOOK_AT_START = 0.04;
function _openingHookId(t) {
  const lanes = (Array.isArray(t && t.tracks) ? t.tracks : []).filter(x => x && x.kind === 'video');
  let ids;
  try { ids = require('../lib/hook-ids'); } catch (e) { return null; }
  for (const lane of lanes) {
    for (const c of ((lane && lane.clips) || [])) {
      if (!c || !c.src || (+c.start || 0) > HOOK_AT_START) continue;
      const id = ids.idFor(c.src);
      if (id) return id;
    }
  }
  return null;
}

router.get('/mv3/timeline/:key/source', (req, res) => {
  try {
    const cur = _read();
    const key = String(req.params.key || '');
    const rec = cur.timelines[key];
    if (!rec) return res.status(404).json({ success: false, error: `no project "${key}"` });
    const hookId = _openingHookId(rec);
    const hit = _scenBehind(cur.timelines, key);
    if (!hit) return res.json({ success: true, project: null, via: null, hookId });
    const p = hit.p;
    const cast = (p.casting && typeof p.casting === 'object') ? p.casting : {};
    res.json({ success: true, via: hit.via, hookId, project: {
      id: String(p.id), name: String(p.name || ''), title: String(p.title || ''),
      vertical: String(p.vertical || ''), product: String(p.product || ''),
      gender: String(p.gender || ''), characterName: String(cast.characterName || ''),
    } });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

module.exports = router;
