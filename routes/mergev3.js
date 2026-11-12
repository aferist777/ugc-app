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
       applied. A stale copy is refused instead of writing over newer work;
     • every file is written atomically, so a crash mid-write cannot truncate one.

   MANY TIMELINES, one per project, and one kind of project: an ordered list of lanes - video,
   audio, subtitles, text - made in Merge (`mv3_<stamp>`), a talking head's or a voiceover's
   (`sv3_<scenariosProjectId>[_n]`) or a highlights project's (`hl_<id>[_n]`). The talking-head
   editor's six fixed lanes are gone (docs/local-app/PLAN.md, phase 3); lib/timeline-convert.js rewrote its projects at startup.

   THE VERSION IS THE PROJECT'S. It was the file's - one counter, written whole - so a
   write to one project refused every save to another, and each refusal was a merge
   against a timeline nobody had touched. Each timeline now carries its own `rev`, bumped by the save
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
                                           404 { gone: true } when it is not there any more -
                                           a save never makes a project (phase V49).
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


// The picker's list. Newest first, so a project just made is at the top - under THE draft, which is always first and always
// there (phase V49: made here when the list is read without one).
router.get('/mv3/timelines', (req, res) => {
  try {
    _ensureDraft(req);
    const s = _read();
    const own = _folderFiles(Object.keys(s.timelines));
    // (phase V33.1) A highlights project is ONE line - its own timeline; its fragments' timelines open from its tiles.
    const HLS = require('../lib/highlights-store');
    const PROJ = require('../lib/projects-store');
    const list = Object.keys(s.timelines).filter(key => !((HLS.ofKey(key) || {}).n > 0)).map(key => {
      const t = s.timelines[key];
      let clips = 0;
      for (const tr of (Array.isArray(t.tracks) ? t.tracks : [])) clips += ((tr && tr.clips) || []).length;
      // (phase V62) A scenarios project's timeline says which of the two it is: a talking head or a voiceover.
      const pm = /^sv3_(\d+)$/.exec(key);
      const pr = pm ? (PROJ.get(pm[1]) || {}) : {};
      const vo = pr.type === 'voiceover';
      // (phase V62, (во35)) THE voiceover draft: "draft · voiceover", under Merge's draft.
      const vod = vo && !!pr.draft;
      return { key, title: t.title || 'Untitled', createdAt: t.createdAt || null, updatedAt: t.updatedAt || null,
               kind: t.kind || null, clips, rev: _revOf(t), ownFiles: own.has(key), draft: !!t.draft, ...OWN.ownerView(t),
               ...(HLS.ofKey(key) ? { highlights: true } : {}), ...(vo ? { voiceover: true } : {}), ...(vod ? { vodraft: true } : {}) };
    // (phase V20) The draft first, then (phase V62) the voiceover draft, then newest first.
    }).sort((a, b) => (b.draft - a.draft) || ((b.vodraft ? 1 : 0) - (a.vodraft ? 1 : 0))
      || String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    // Everyone sees every owner. The picker groups by them; which entries the caller may
    // change is answered per project, from its `owner` against `me`.
    res.json({ success: true, version: s.version, list, open: _newestKey(s.timelines),
               owners: OWN.ownersOf(Object.values(s.timelines), req.user), me: OWN.meView(req.user) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/mv3/timeline', (req, res) => {
  try {
    // (phase V76.3) The timeline asked for, alone - every timeline was read to hand back one (~0.06 s in the owner's library).
    let key = String(req.query.key || '');
    let t = key ? MSTORE.one(key) : null;
    // No key, or one that is not there: hand back the most recently touched project. A 404
    // would make the page's first load depend on it already knowing what exists.
    if (!t) {
      const s = _read();
      key = _newestKey(s.timelines) || LOCAL_KEY;
      t = s.timelines[key];
    }
    // One still in the talking-head shape (nothing should be: the upgrade rewrites them at start)
    // is shown rewritten rather than handed to an editor that cannot read it; its next save stores it.
    if (t && !Array.isArray(t.tracks)) t = require('../lib/timeline-convert').convert({ key, ...t }, { root: require('../lib/config').ROOT_DIR }) || t;
    // The proxies this project's preview will ask for, started now - before the page has even
    // drawn its lanes - one ffmpeg at a time, so the first play is not the first transcode.
    // (phase V84, (эф11)) `peek` - read for another fragment's effects, not opened: nothing warmed.
    if (t && !req.query.peek) _warmProxies(t);
    res.json({
      // `found`: false when there is no timeline at all - the empty shape under LOCAL_KEY; the page opens the draft instead.
      success: true, version: _revOf(t), key, found: !!t,
      title: t ? t.title : 'Untitled', draft: !!(t && t.draft),
      ...OWN.ownerView(t), canEdit: OWN.canEdit(t, req.user),
      adv: t ? (t.adv || null) : null,
      timeline: t ? { kind: BLANK_KIND, format: t.format || '9:16', tracks: t.tracks } : _emptyBlank(),
      // (phase V28.4) The clips whose file is not on the disk - deleted from the library, most often: red on the
      // timeline, to be replaced or removed, and said once as the project opens (lib/timeline-media.js).
      missing: t ? require('../lib/timeline-media').missingOf(t) : [],
    });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── THE DRAFT (phase V20, the owner 2026-10-08; phase V49, the owner's (пр12), (пр13)) ──────────────────────────
// Merge with no project open opens THE draft - a Merge project marked `draft`, named "draft <date time>" - so the
// timeline and the chats work from the first press, with nothing to name first. There is ONE, and always one: made when
// Merge opens with nothing to open (POST /mv3/timeline/new {draft}), when the list is read without one (GET
// /mv3/timelines) and the moment the draft is saved under a name (PATCH .../title) - first in the list every time. What
// its chats MAKE goes into "Generated" (phase V28.4) and stays there whatever becomes of it; what is BROUGHT INTO them is
// filed in the category of its name, as any project's. Saved, it is renamed (the categories and the folder follow), the
// mark goes and a new empty draft takes its place. Nothing is asked about it and nothing deletes it (V49): it stays as it
// is - its lanes, its category, the drafts' conversation; "clear" on the picker empties its lanes on the page (one step to
// undo, public/js/merge-v3/store.js clearDraft), and DELETE refuses it.
const _draftOf = (timelines) => Object.keys(timelines || {}).find(k => timelines[k] && timelines[k].draft) || '';

// The draft there is, or a new empty one written at once -> { key, title, version, made }. `avoid`: a name it must not
// take - the draft just saved under a name had it, and its folder and category have just moved away from it (an old
// address of that folder is redirected to the new one, lib/moves.js, so a new folder must not take it back).
function _ensureDraft(req, avoid) {
  // (phase V76.3) The draft there is found in the store's index (MSTORE.draftKey) - every timeline is read only to make one.
  const there = MSTORE.draftKey();
  const had = there ? MSTORE.one(there) : null;
  if (had) return { key: there, title: had.title, version: MSTORE.stateVersion(), made: false };
  const cur = _read();
  const was = _draftOf(cur.timelines);
  if (was) return { key: was, title: cur.timelines[was].title, version: cur.version, made: false };
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const base = 'draft ' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  const off = String(avoid || '').trim().toLowerCase();
  const bad = (t) => _titleTaken(cur.timelines, t, null) || (!!off && t.toLowerCase() === off);
  let title = base;
  for (let n = 2; bad(title); n++) title = base + ' (' + n + ')';
  let key = 'mv3_' + Date.now();
  for (let n = 1; cur.timelines[key]; n++) key = 'mv3_' + Date.now() + '_' + n;
  const now = d.toISOString();
  cur.timelines[key] = { title, createdAt: now, updatedAt: now, adv: null, owner: OWN.uidOf(req), rev: 1, kind: BLANK_KIND,
    format: '9:16', tracks: _emptyBlank().tracks, draft: true };
  const version = cur.version + 1;
  _write({ version, updatedAt: now, timelines: cur.timelines, hidden: cur.hidden, snapshots: cur.snapshots });
  return { key, title, version, made: true };
}

// The shape of nothing. Entering Merge without a project shows an empty timeline and waits
// for one to be chosen, and the page needs the same track shape the real ones have - built
// here rather than client-side so there is one definition of it.
router.get('/mv3/blank', (req, res) => {
  try { res.json({ success: true, timeline: _emptyBlank() }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Cheap enough to poll. Kept separate so watching for the server's change does not
// pull the whole timeline every few seconds. With a key it answers for that one project;
// without one, the file's counter, which moves on every write to anything.
router.get('/mv3/timeline/version', (req, res) => {
  try {
    const key = String(req.query.key || '');
    if (!key) return res.json({ success: true, version: MSTORE.stateVersion() });
    // (phase V76.3) Its own timeline, not all of them - the page asks this every 20 s.
    const t = MSTORE.one(key);
    if (!t) return res.status(404).json({ success: false, error: `no project "${key}"` });
    res.json({ success: true, version: _revOf(t), key });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.put('/mv3/timeline', (req, res) => {
  try {
    const claimed = Number((req.body || {}).version);
    if (!Number.isFinite(claimed)) {
      return res.status(400).json({ success: false, error: 'version is required - a write that does not say what it replaces cannot be checked' });
    }
    // (phase V49) A save names its project, and the project must be there: a project is made by POST .../new (or by the
    // server laying one), never by a save. A save that arrives after its project was deleted - an edit still waiting when a
    // project, a highlights fragment or (before V49) the draft went - made it again as "Untitled", with no draft mark;
    // with no key it wrote into the newest project. Both are refused now: 400 and 404 `gone`, the edit not saved.
    const key = String((req.body || {}).key || '').trim();
    if (!key) return res.status(400).json({ success: false, error: 'which project? - the edit was not saved' });
    // (phase V76.3, the owner 2026-11-07: "загрузку самих проектов ускорить") ITS OWN TIMELINE read and written - every save read
    // and wrote the whole store (299 timelines in the owner's library, ~0.2 s, the server answering nothing else meanwhile).
    const prev = MSTORE.one(key);
    if (!prev) return res.status(404).json({ success: false, gone: true, key, error: 'this project is not there any more - the edit was not saved' });
    // Somebody else's project: refused before the version is even looked at. The page shows
    // it read-only and should never send this; this is for the page that did not know.
    if (!OWN.canEdit(prev, req.user)) return OWN.refuse(res, prev);
    // The refusal that makes this store different, checked against THIS project's rev - see
    // the top of the file. The current state goes back with it, so the caller can reconcile
    // in one round trip instead of two.
    if (claimed !== _revOf(prev)) {
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
    const rec = {
      title: prev.title,
      createdAt: prev.createdAt || now,
      updatedAt: now,
      adv: prev.adv || null,
      from: prev.from || null,
      // Whose it is, set once at creation and carried across every save after; and how many
      // saves there have been, which is the number the next one must quote.
      owner: prev.owner || null,
      rev: _revOf(prev) + 1,
      kind: BLANK_KIND,
      format: clean.format,
      tracks: clean.tracks,
      // (phase V20) The draft stays the draft across its saves - only "save" takes the mark off.
      ...(prev.draft ? { draft: true } : {}),
    };
    // The record replaced whole, as before; its rev and time are the ones above; the store's counter moves once.
    MSTORE.updateMany([key], (t) => { for (const k of Object.keys(t)) delete t[k]; Object.assign(t, rec); }, { own: true });
    // (phase V44) A TALKING HEAD'S LINES CUT ON ITS TIMELINE - cut silence, a stretch cut by hand, an undo of either: what
    // their pieces say is written into the lines in the same tick, so the mirror lays them so again (lib/line-cuts.js).
    const th = /^sv3_(.+)$/.exec(key);
    if (th) require('../lib/line-cuts').fromTimeline(th[1], clean.tracks);
    // (phase V84 block 3, (б3-2)) An effect the page alone draws, on main video: baked in the background (lib/fx-bake.js).
    require('../lib/fx-bake').want(rec, key);
    // The STORED tracks go back, not just the version. _sanitizeBlank normalises as it writes -
    // a missing field becomes an explicit null, a band number its default - so what the caller
    // sent and what is now here are not byte-identical. The caller needs the stored shape to
    // compare against later: a merge that measures "what did I change" against the version it
    // sent would count the normalising itself as a change.
    res.json({ success: true, version: rec.rev, updatedAt: now, key,
               kind: rec.kind || null, format: rec.format || null,
               tracks: rec.tracks });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// (phase V45) CLIPS IN A ROW MERGED INTO ONE FILE of the project (lib/merge-clips.js): the page sends the clips as it has
// them, follows the job, and lays the file in their place itself - one step to undo.
//   POST /api/mv3/merge { key, format, video: [clips], audio: [clips] } -> { job }
//   GET  /api/mv3/merge/:id -> { job: { state, pct, src, dur, error } };  POST /api/mv3/merge/:id/cancel
router.post('/mv3/merge', (req, res) => {
  try {
    const b = req.body || {};
    const t = _read().timelines[String(b.key || '')];
    if (t && !OWN.canEdit(t, req.user)) return OWN.refuse(res, t);
    const r = require('../lib/merge-clips').start(b);
    if (r.error) return res.status(r.code || 400).json({ success: false, error: r.error });
    res.json({ success: true, job: r.job });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
router.get('/mv3/merge/:id', (req, res) => {
  const job = require('../lib/merge-clips').get(req.params.id);
  if (!job) return res.status(404).json({ success: false, error: 'no such merge' });
  res.json({ success: true, job });
});
router.post('/mv3/merge/:id/cancel', (req, res) => {
  res.json({ success: true, job: require('../lib/merge-clips').cancel(req.params.id) });
});

// Export settings for one project. Their own endpoint on purpose: saving the export window's
// settings must not rewrite the timeline, and a timeline save must not rewrite them.
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

router.post('/mv3/render/finish', (req, res) => {
  try {
    const b = req.body || {};
    const abs = _finalPath(b.url);
    if (!abs || !fs.existsSync(abs)) return res.status(404).json({ success: false, error: 'no such render' });
    const item = MVQ.fileFinished({ url: b.url, title: b.title, key: b.key, kind: b.kind, dur: b.dur,
                                    owner: OWN.uidOf(req), ownerNick: req.user ? req.user.nickname : null });
    res.json({ success: true, queueId: item.id, srt: _srtUrl(abs) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Renames the file (and its poster) to `name` in its own project folder, uniquified. Returns the
// new url.
// (phase V33.4) THROUGH lib/relocate.js: the file moves with its poster and its subtitles file (phase V30, block 4), and
// every store that names them follows - the queue's entry, and a highlights fragment's record of its render among them.
// (phase V73, (rn-2) а) The rule lives in lib/render-files.js now - the viewer's Rename of a render takes it too.
const _renameFinal = (abs, url, name) => require('../lib/render-files').rename(abs, name);

const JOB = require('../lib/mv3b-job');
// A render's subtitles file, as an address - or null when it has none.
const _srtUrl = (abs) => { const s = JOB.srtOf(abs); return fs.existsSync(s) ? toUrl(s) : null; };

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
    // Its entry - by its id, or by the address it had (or has: the move rewrote the queue's store too).
    const byUrl = MVQ.findByUrl(b.url) || MVQ.findByUrl(moved.url);
    const entry = (b.queueId && MVQ.updateEntry(String(b.queueId), patch)) || (byUrl && MVQ.updateEntry(byUrl.id, patch)) || null;
    res.json({ success: true, url: moved.url, name, thumb: thumb || null, queueId: entry ? entry.id : null, srt: _srtUrl(moved.abs) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/mv3/render/discard', (req, res) => {
  try {
    const abs = _finalPath((req.body || {}).url);
    if (!abs) return res.status(400).json({ success: false, error: 'not a render path' });
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
    // Its subtitles file with it (phase V30, block 4).
    try { fs.rmSync(JOB.srtOf(abs), { force: true }); } catch (e) { /* held open: it stays beside nothing */ }
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

/* ── A new, empty project ────────────────────────────────────────────────────
   POST /api/mv3/timeline/new { title, format? } | { projectId } -> { success, key, version }

   This makes an empty one, and there are two ways to be empty:

     { title }      a project of Merge's own, keyed mv3_<stamp> so the origin is readable from
                    the key alone. The caller opens it and builds the timeline by hand.
     { projectId }  a TALKING HEAD or a VOICEOVER, keyed sv3_<projectId>. The scenario project
                    already exists; this gives it the timeline it will be assembled into, empty,
                    so it is in the picker from the moment it exists.

   THE TITLE IS TAKEN, NOT DEFAULTED: an "Untitled" made here would stay Untitled until someone
   renamed it, so a blank title is refused rather than quietly accepted. A talking head has a
   name already - the project's - so it passes none.

   `format` (phase V63, P14, the owner's (хп31)): '9:16' or '16:9' - Home's quick start of a blank project asks it; anything
   else is 9:16, as before. */
router.post('/mv3/timeline/new', (req, res) => {
  try {
    const b = req.body || {};
    const projectId = String(b.projectId == null ? '' : b.projectId).trim();
    const cur = _read();
    let key = '';
    let title = '';

    // (phase V20) THE draft: the one there is, or a new one named for the moment.
    if (b.draft) {
      const dr = _ensureDraft(req);
      return res.json({ success: true, key: dr.key, version: dr.version, title: dr.title, draft: true });
    }
    if (projectId) {
      const p = require('../lib/projects-store').get(projectId);
      if (!p) return res.status(404).json({ success: false, error: 'no such project' });
      // The FIRST free one: sv3_<id>, then _2, _3 - in practice sv3_<id> itself.
      const base = 'sv3_' + projectId;
      key = base;
      for (let n = 2; cur.timelines[key]; n++) key = base + '_' + n;
      // Named after the project and the day. Uniqueness is not
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
      format: b.format === '16:9' ? '16:9' : '9:16',
      tracks: _emptyBlank().tracks,
    };
    const version = cur.version + 1;
    _write({ version, updatedAt: now, timelines: cur.timelines, hidden: cur.hidden, snapshots: cur.snapshots });
    res.json({ success: true, key, version, title, draft: false });
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
    // (phase V20) A draft named is a draft saved - even under the name it had.
    if (String(rec.title || '') === title && !rec.draft) return res.json({ success: true, title, version: _revOf(rec) });
    if (_titleTaken(cur.timelines, title, key)) {
      return res.status(409).json({ success: false, error: 'a project called "' + title + '" already exists' });
    }

    const was = String(rec.title || '');
    const wasDraft = !!rec.draft;
    rec.title = title;
    delete rec.draft;
    const now = new Date().toISOString();
    _write({ version: cur.version + 1, updatedAt: now, timelines: cur.timelines, hidden: cur.hidden, snapshots: cur.snapshots });

    // Found by the name the filing used, and shortened by the same rule - see catLabelFor.
    // A failure here is not a failure to rename: the project has the name asked for, and a
    // category left behind is a tidying problem rather than lost work.
    // The project's category on every shelf its chats file into - Images (pictures), B-roll (clips) and Uploads
    // (clips brought in) - each on its own, merged into a category of the new name where the shelf has one
    // (lib/project-cats.js, review V2r).
    let moved = false;
    try {
      const GENS = require('../lib/mv3-gens');
      const oldLabel = GENS.catLabelFor(was);
      if (oldLabel !== GENS.LOOSE_CAT) {
        const out = require('../lib/project-cats').follow(oldLabel, GENS.catLabelFor(title));
        moved = Object.values(out).some(v => v === 'renamed' || v === 'merged');
      }
    } catch (e) { console.warn('[mv3] could not move the library category:', e.message); }

    // (phase V21, the owner: answer A) A draft saved takes a copy of the drafts' conversation as its own, and talks in its
    // own from then on.
    let copied = 0;
    if (wasDraft) { try { copied = require('../lib/mv3-chat').copyDraftTo(key); } catch (e) { console.warn('[mv3] draft: its conversation was not copied -', e.message); } }
    // (phase V49, the owner's (пр12)) A draft saved leaves a new empty draft in its place, first in the list - written after
    // the rename and its category's move, and under another name than the one the saved draft had.
    let draft = '';
    if (wasDraft) { try { draft = _ensureDraft(req, was).key; } catch (e) { console.warn('[mv3] draft: a new one was not made -', e.message); } }
    res.json({ success: true, key, title, was, version: _revOf(rec), categoryMoved: moved, copied, ...(draft ? { draft } : {}) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// WHICH TIMELINES HOLD A PROJECT'S OWN FILES (phase C3): the last timeline left in a talking head's folder -
// projects/<name>/ with its project.json, reads, frames and clips. Deleting that timeline can take the folder too;
// one with another timeline beside it (a copy) cannot - the other still uses the files.
function _folderFiles(keys) {
  const PROJECTS = require('../lib/projects-store');
  const talking = new Set(PROJECTS.entries().filter(e => e.kind === 'scenarios').map(e => e.folder));
  const byFolder = new Map();
  // (phase V76.2) Every key's folder with the store's index looked at once - locate() each looked at every file on the disk.
  const where = MSTORE.locateMany(keys);
  for (const k of keys) {
    const at = where.get(String(k));
    if (at && talking.has(at.folder)) byFolder.set(at.folder, (byFolder.get(at.folder) || []).concat(k));
  }
  const out = new Set();
  for (const ks of byFolder.values()) if (ks.length === 1) out.add(ks[0]);
  return out;
}

// (phase V49, point 2) EVERY KEY A HIGHLIGHTS PROJECT'S CHATS MAY HAVE TALKED UNDER: its own (hl_<id>) and each fragment's
// (hl_<id>_<n>) - the timelines there are and any key a message or a record of the chats still names (a fragment deleted
// before, a conversation shared by the project).
function _hlChatKeys(id, timelines) {
  const re = new RegExp('^hl_' + String(id).replace(/[^a-z0-9]/g, '') + '(?:_\\d+)?$');
  const keys = new Set(['hl_' + id]);
  const take = (k) => { if (k && re.test(String(k))) keys.add(String(k)); };
  for (const k of Object.keys(timelines || {})) take(k);
  try {
    const raw = JSON.parse(fs.readFileSync(require('../lib/mv3-chat').FILE, 'utf8'));
    for (const m of (Array.isArray(raw) ? raw : ((raw && raw.messages) || []))) take(m && m.project);
  } catch (e) { /* no conversation yet */ }
  for (const store of ['../lib/mv3-gens', '../lib/mv3-video-gens']) {
    try { for (const r of require(store).listAll()) take(r && r.project); } catch (e) { /* none */ }
  }
  return [...keys];
}
// Twice over: a record one key's message pointed at is spared while that message is there (mv3-chat forget `spoken`), and
// is let go on the second round, once the messages of every key are gone.
function _forgetChats(keys) {
  const CHAT = require('../lib/mv3-chat');
  for (let round = 0; round < 2; round++) {
    for (const k of keys) {
      try { CHAT.forget(k); } catch (e) { console.warn('[mv3] the chats of', k, 'were not cleared -', e.message); }
    }
  }
}

// Delete one project's timeline. The confirmation is the page's job (the button turns into
// "really?"), so this just does it - a second confirmation here would be theatre.
router.delete('/mv3/timeline/:key', (req, res) => {
  try {
    const key = String(req.params.key || '');
    const cur = _read();
    if (!cur.timelines[key]) return res.status(404).json({ success: false, error: `no project "${key}"` });
    // Deleting is the one write nobody but the owner should be able to undo their way out of,
    // so it is held to the same line as the rest - and the admin's on anything.
    if (!OWN.canEdit(cur.timelines[key], req.user)) return OWN.refuse(res, cur.timelines[key]);
    // (phase V49) THE DRAFT is not deleted: "clear" empties its lanes, "save" names it - there is always one.
    if (cur.timelines[key].draft) return res.status(409).json({ success: false, error: 'the draft is not deleted - "clear" empties its lanes, "save" gives it a name' });
    // (phase V33.1) A HIGHLIGHTS PROJECT is deleted whole by its own timeline: its work stopped, its folder - the fragments'
    // timelines and pieces - gone; its video stays, a source of the Library. A fragment goes from its tile, not from here.
    const HLS = require('../lib/highlights-store');
    const hk = HLS.ofKey(key);
    if (hk && hk.n > 0) return res.status(409).json({ success: false, error: 'a fragment is deleted on its tile in the highlights field' });
    if (hk && HLS.entry(hk.id)) {
      try { require('../lib/highlights-job').stop(hk.id); } catch (e) { /* not at work */ }
      const rec = HLS.get(hk.id);
      const row = rec && rec.work && rec.work.alertId;
      if (row) require('../lib/alerts').cancel(row, 'stopped - the project was deleted');
      const talks = _hlChatKeys(hk.id, cur.timelines);
      // (phase V49, point 2) What was BROUGHT INTO its chats is filed under the project's name - its own timeline's title
      // (lib/mv3-gens.js catLabelFor): read before the timelines go, and let go of after, as any project's (below) - not
      // when a timeline of another project keeps the same name, never a required category (lib/project-cats.js).
      const GENS = require('../lib/mv3-gens');
      const label = GENS.catLabelFor(cur.timelines[key].title);
      const shared = Object.keys(cur.timelines).some(k => cur.timelines[k] && (HLS.ofKey(k) || {}).id !== hk.id
        && GENS.catLabelFor(cur.timelines[k].title).toLowerCase() === label.toLowerCase());
      const { moved } = HLS.remove(hk.id);
      // (phase V49, point 2) Its chats' conversations and the finished records of what they made go too, as any project's
      // (below) - under every key they may have talked: its own and each fragment's.
      _forgetChats(talks);
      let released = {};
      if (!shared) {
        try { released = require('../lib/project-cats').release(label); }
        catch (e) { console.warn('[mv3] delete: the highlights project\'s category was not let go of -', e.message); }
      }
      return res.json({ success: true, version: cur.version + 1, open: null, files: { removed: true, kept: moved, heads: 0 }, released });
    }
    // AND ITS FILES (?files=1, phase C3, the owner 2026-10-05): a talking head's folder - its reads, frames and
    // clips - goes with its last timeline (PROJECTS.remove: what another project, timeline or shelf still points
    // at is moved to media/work first). The Library's categories named after the project are not in that folder: what
    // is in them goes to Uncategorized (phase V28.4, below). Refused while something is still being made for the project: a
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
    // (phase V23) Its two conversations and the finished records of what was made for it go too, whichever way it is
    // deleted; what was made stays on the shelves. Asked before the timeline goes: a draft's is the drafts' conversation.
    const CHAT = require('../lib/mv3-chat');
    const talk = CHAT.threadOf(key) === CHAT.DRAFT ? null : key;
    // (phase V28.4, the owner 2026-10-12: "раскидывать медиа удаленного проекта по типу медиа в категории uncategorized")
    // What was brought into its chats and filed under its name on the shelves goes to Uncategorized of its kind, the
    // category with it (what its chats MADE is in "Generated" and stays). Not when another
    // project keeps the same name (the category is that one's too), and never a required category (lib/project-cats.js).
    const GENS = require('../lib/mv3-gens');
    const label = GENS.catLabelFor(cur.timelines[key].title);
    const shared = Object.keys(cur.timelines).some(k => k !== key && cur.timelines[k]
      && GENS.catLabelFor(cur.timelines[k].title).toLowerCase() === label.toLowerCase());
    delete cur.timelines[key];
    const now = new Date().toISOString();
    _write({ version: cur.version + 1, updatedAt: now, timelines: cur.timelines, hidden: cur.hidden, snapshots: cur.snapshots });
    if (talk) { try { CHAT.forget(talk); } catch (e) { console.warn('[mv3] the chats of a deleted project were not cleared -', e.message); } }
    let files = null;
    if (proj) {
      // (phase V28.4, second round) Its talking heads kept in the library first, when the person said so (?heads=keep).
      let heads = 0;
      if (String(req.query.heads || '') === 'keep') {
        try { heads = require('../lib/heads').keep(proj.id); }
        catch (e) { console.warn('[mv3] delete: the talking heads were not kept -', e.message); }
      }
      const { moved } = require('../lib/projects-store').remove(proj.id);
      files = { removed: true, kept: moved, heads };
    }
    let released = {};
    if (!shared) {
      try { released = require('../lib/project-cats').release(label); }
      catch (e) { console.warn('[mv3] delete: its category was not let go of -', e.message); }
    }
    res.json({ success: true, version: cur.version + 1, open: _newestKey(cur.timelines), files, released });
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

router.get('/mv3/timeline/:key/source', (req, res) => {
  try {
    const cur = _read();
    const key = String(req.params.key || '');
    const rec = cur.timelines[key];
    if (!rec) return res.status(404).json({ success: false, error: `no project "${key}"` });
    const hit = _scenBehind(cur.timelines, key);
    if (!hit) return res.json({ success: true, project: null, via: null });
    const p = hit.p;
    const cast = (p.casting && typeof p.casting === 'object') ? p.casting : {};
    res.json({ success: true, via: hit.via, project: {
      id: String(p.id), name: String(p.name || ''), title: String(p.title || ''),
      vertical: String(p.vertical || ''), product: String(p.product || ''),
      gender: String(p.gender || ''), characterName: String(cast.characterName || ''),
    } });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── A FILE FROM EXPLORER, LET GO ON THE TIMELINE (phase V41, the owner's (о13), (о13а)) ──────────────────────────────
// Copied into the library first - a video onto VIDEO -> Uploads with no category, a picture into IMAGES' root, a sound into
// AUDIO -> Music's root - and never twice (lib/drop-file.js); the page lays what it answers as a tile from the Library.
//   POST /api/mv3/drop-file/known  { name, size, lastModified } -> { item | null }   asked before sending
//   POST /api/mv3/drop-file        multipart `file` (+ size, lastModified) -> { item, copied }
const DROP = require('../lib/drop-file');
const _dropUpload = require('multer')({
  storage: require('multer').diskStorage({
    destination: (_q, _f, cb) => {
      const { MEDIA } = require('../lib/config');
      try { fs.mkdirSync(MEDIA.work, { recursive: true }); } catch (e) { /* there */ }
      cb(null, MEDIA.work);
    },
    // The name as the page sends it (a field BEFORE the file, in UTF-8): the part's own file name comes in latin1, and a
    // Russian name was a row of mojibake on the disk.
    filename: (q, file, cb) => {
      const orig = _dropName(q, file);
      const ext = path.extname(orig).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 8);
      const stem = require('../lib/names').folderName(path.basename(orig, path.extname(orig)), 'file').slice(0, 80);
      cb(null, stem + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5) + ext);
    },
  }),
  limits: { fileSize: 4 * 1024 * 1024 * 1024 },
  fileFilter: (q, file, cb) => cb(null, !!DROP.kindOf(_dropName(q, file), file.mimetype)),
});
const _dropName = (q, file) => String((q.body && q.body.name) || (file && file.originalname) || '').slice(0, 240);

router.post('/mv3/drop-file/known', (req, res) => {
  try { res.json({ success: true, item: DROP.known(req.body || {}) }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/mv3/drop-file', _dropUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(415).json({ success: false, error: 'not a video, a picture or a sound' });
  try {
    const b = req.body || {};
    const r = await DROP.take(req.file.path, { name: _dropName(req, req.file), mime: req.file.mimetype,
      size: +b.size || req.file.size, lastModified: +b.lastModified || 0 });
    res.json({ success: true, item: r.item, copied: r.copied });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, error: e.message });
  }
});
router.use('/mv3/drop-file', (err, _req, res, _next) => {
  res.status(400).json({ success: false, error: (err && err.message) || 'the file did not arrive' });
});

module.exports = router;
