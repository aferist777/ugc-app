'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — the render queue.

   On the server, because a queue that lives in the browser dies with the tab, and "time
   remaining" after a reload would be invented rather than measured.

   AN ENTRY CARRIES ITS OWN JOB, not a reference to one: the timeline and the export settings as
   they were when it was queued. The render is what the person saw when they queued it, not what
   the project drifted into while five other things rendered ahead of it.

   Entries of the talking-head editor, which is gone (docs/local-app/PLAN.md, phase 3), carry that
   editor's payload and nothing can render it any more: one still waiting fails with the reason,
   and the project - converted - can be queued again.

   The queue runs ONE AT A TIME. Rendering is the heaviest thing this machine does, and four
   at once is four renders that all finish late rather than one that finishes soon.

   WHOSE ENTRY. Each one still names who queued it, from the server version, where the list a
   person saw was their own. The desktop app has one person (lib/ownership.js), so every entry
   is theirs, whoever's name an old one carries.

   RENDER ALL. Queuing something does not start it. Render all ARMS the waiting entries, and
   the runner takes armed entries in the order they were queued; each row says how many are
   ahead.

   A HIGHLIGHTS FRAGMENT (phase V33.4, the owner's (х38)-(х44); lib/highlights-render.js). Its entry carries
   `hl: { id, n }` and comes in ARMED - the project bar's Render is asking for it - without arming anybody else's
   (addArmed). Its file is named after the fragment's timeline, not mv3q_<number>, and takes the place of the fragment's
   own earlier render (another file of that name is not touched: "(2)"); done, the fragment's record learns it. The
   project's renders are stopped together (stopWhere: the waiting ones taken out, the one under the encoder killed and
   its draft deleted) and gone on with together (armWhere - the Queue's "go on" on the project's row).

   EXPORT'S RENDER (phase V73 block 4, the owner's (б4-2) а) is one such entry too: POST /mv3q/render puts the timeline in
   line ARMED (addArmed) and starts it when the encoder is free; POST /mv3q/stop/:id stops one entry (stopWhere) - Export's
   Stop and Queue's. The page follows the entry through GET /mv3q (merge-v3/export-b.js).
   ═══════════════════════════════════════════════════════════════════════════ */

const express = require('express');
const path = require('path');
const fs = require('fs');
const { writeFileAtomic } = require('../lib/atomic-write');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const JOB = require('../lib/mv3b-job');
const BUSY = require('../lib/render-busy');
const OWN = require('../lib/ownership');

const router = express.Router();
const { DATA_DIR } = require('../lib/config');
const { toUrl } = require('../lib/media');
const FILE = path.join(DATA_DIR, 'mv3-queue.json');

function read() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch (e) { return { items: [], running: false }; }
}
function write(s) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  writeFileAtomic(FILE, JSON.stringify(s, null, 2));
}

// ── Running one entry ───────────────────────────────────────────────────────
let _proc = null;
let _startedAt = 0;
// The entry under the encoder. Set before its files are asked about (lib/mv3b-job.js prepare),
// when there is no process yet - `_proc` alone would say "idle" then, a list read would take the
// running row for a leftover, and Render all could start it twice.
let _active = null;

function next() {
  const s = read();
  // Armed, and oldest first. An entry nobody has pressed Render all for waits.
  const item = s.items.find(x => x.status === 'queued' && x.armed);
  if (!item) { s.running = false; write(s); _active = null; return; }

  item.status = 'running';
  item.startedAt = new Date().toISOString();
  s.running = true;
  write(s);
  _active = item.id;

  if (item.kind !== 'blank') {
    const s2 = read();
    const it = s2.items.find(x => x.id === item.id);
    if (it) {
      it.status = 'failed';
      it.error = 'queued in the editor that has been removed - open the project and add it to the queue again';
    }
    write(s2);
    _active = null;
    return next();
  }
  return runBlank(item);
}

// (phase V33.4) Entries asked to stop while they were being prepared or rendered (stopWhere).
const _stopping = new Set();

// Take an entry out of the list - one that was stopped.
function _drop(id) {
  const t = read();
  const before = t.items.length;
  t.items = t.items.filter(x => x.id !== id);
  if (t.items.length !== before) write(t);
}

// Where an entry's file goes. A highlights fragment's is named after its timeline (lib/names.js, as the timeline's own
// file) and takes the place of its own earlier render; (phase V73, the owner's (rn-1) а) anything else's is
// "<project title> <YYYY-MM-DD HH-MM>" - the title and the time of the press (lib/render-files.js nameFor: at most 60
// characters, the title cut, the time whole, " (2)" when taken); renamed later by the viewer's Rename.
function _finalFor(item) {
  const dir = require('../lib/shelf-files').rendersDir(item.key).dir;
  if (!item.hl) {
    let stems = [];
    try { stems = fs.readdirSync(dir).filter(f => /\.mp4$/i.test(f) && !JOB.isDraft(f)).map(f => f.replace(/\.mp4$/i, '')); }
    catch (e) { /* a new folder */ }
    return path.join(dir, require('../lib/render-files').nameFor(item.title, item.addedAt, stems) + '.mp4');
  }
  const { folderName, uniqueName } = require('../lib/names');
  const t = require('../lib/highlights-render').target(item);
  const own = t.replace ? path.basename(String(require('../lib/media').toDisk(t.replace) || '')).toLowerCase() : '';
  let taken = [];
  try {
    taken = fs.readdirSync(dir).filter(f => /\.mp4$/i.test(f) && !JOB.isDraft(f) && f.toLowerCase() !== own)
      .map(f => f.replace(/\.mp4$/i, ''));
  } catch (e) { /* a new folder */ }
  return path.join(dir, uniqueName(folderName(t.name, 'render'), taken) + '.mp4');
}

// Marked running (and _active) before this is called, so nothing starts it twice while the files
// are being asked about.
async function runBlank(item) {
  // The same preparation Export -> Render uses (lib/mv3b-job.js): captions included.
  const built = await JOB.prepare(item.timeline, item.id, item.adv);
  // Stopped while it was being prepared (phase V33.4): it goes without a frame encoded.
  if (_stopping.has(item.id)) {
    _stopping.delete(item.id);
    if (built.dispose) built.dispose();
    _drop(item.id);
    _active = null;
    return next();
  }
  if (built.error) {
    const t = read();
    const it = t.items.find(x => x.id === item.id);
    if (it) { it.status = 'failed'; it.error = built.error; }
    write(t);
    _active = null;
    return next();
  }

  // Into the folder of the project the entry's timeline belongs to (lib/shelf-files.js).
  // Written under a draft name the shelf does not show, and given its own at the end (lib/mv3b-job.js, drafts).
  let final;
  try { final = _finalFor(item); }
  catch (e) {
    built.dispose();
    const t = read();
    const it = t.items.find(x => x.id === item.id);
    if (it) { it.status = 'failed'; it.error = 'no place for its file (' + e.message + ')'; }
    write(t);
    _active = null;
    return next();
  }
  const out = JOB.draftOf(final);
  _startedAt = Date.now();
  const done = BUSY.start();
  _proc = spawn(ffmpegPath, built.args.concat([out]), { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  let log = '';
  // A caption drawn in a font it was not given is said with the warnings (lib/font-check.js).
  const fonts = require('../lib/font-check').watcher();
  _proc.stderr.on('data', d => {
    const chunk = d.toString();
    fonts.feed(chunk);
    log = (log + chunk).slice(-3000);
    // Read off ffmpeg's own position, as the single render does. Written into the list so a
    // second tab watching the queue sees the same number.
    const m = /time=(\d+):(\d\d):(\d\d(?:\.\d+)?)/.exec(chunk);
    if (m && built.dur > 0) {
      const at = (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
      const pc = Math.max(0, Math.min(100, Math.round(at / built.dur * 100)));
      const el = (Date.now() - _startedAt) / 1000;
      const t = read();
      const it = t.items.find(x => x.id === item.id);
      if (it) {
        it.percent = pc;
        it.remain = (pc > 3 && el > 1.5) ? Math.round(el / (pc / 100) - el) : null;
        write(t);
      }
    }
  });
  _proc.on('close', async (code) => {
    _proc = null;
    built.dispose();
    // Stopped under the encoder (phase V33.4): the entry goes, and its draft with it - nothing of it is left.
    if (_stopping.has(item.id)) {
      _stopping.delete(item.id);
      JOB.dropDraft(out);
      done();
      _active = null;
      _drop(item.id);
      return next();
    }
    let ok = code === 0 && fs.existsSync(out);
    let error = ok ? null : 'ffmpeg exited ' + code;
    let warning = null;
    if (ok) {
      // The settings that work on the finished file (lib/render-finish.js), said in the list as
      // they happen - a ten-minute tail is a wait worth naming.
      const mark = (phase) => {
        const t = read();
        const it = t.items.find(x => x.id === item.id);
        if (it && it.phase !== phase) { it.phase = phase; it.percent = 0; it.remain = null; write(t); }
      };
      try {
        const r = await JOB.finish(out, built.settings, ({ phase }) => mark(phase === 'speed' ? 'speeding' : phase), final, built.srt);
        const said = [...(built.warnings || []), ...((r && r.warnings) || []), ...fonts.warnings()];
        if (said.length) warning = said.join('; ');
      } catch (e) {
        ok = false; error = e.message;
      }
    }
    // A failed render leaves nothing behind - its draft and whatever the passes wrote beside it.
    if (!ok) JOB.dropDraft(out);
    done();
    _active = null;
    // Stopped while its finished file was being worked on: it is made, and kept (only an encode can be cut off).
    _stopping.delete(item.id);
    const t = read();
    const it = t.items.find(x => x.id === item.id);
    if (it) {
      it.phase = null;
      if (ok) { it.status = 'done'; it.url = toUrl(final); it.warning = warning; }
      else { it.status = 'failed'; it.error = error; it.log = log.slice(-800); }
      it.tookMs = Date.now() - _startedAt;
    }
    write(t);
    // (phase V33.4) A highlights fragment's render: its record learns it (lib/highlights-render.js).
    if (ok && it && it.hl) {
      try { require('../lib/highlights-render').rendered(it, final); }
      catch (e) { console.warn('[mv3q] a fragment did not learn of its render:', e.message); }
    }
    next();
  });
  _proc.on('error', (e) => {
    _proc = null; _active = null;
    _stopping.delete(item.id);
    done();
    built.dispose();
    JOB.dropDraft(out);
    const t = read();
    const it = t.items.find(x => x.id === item.id);
    if (it) { it.status = 'failed'; it.error = e.message; }
    write(t);
    next();
  });
}

// What the entry is MADE OF, worked out when it is queued rather than when it is shown. The
// job is frozen at that moment anyway, so counting it later would describe the project as it
// is now and label a render that was of something else.
function summarise(item) {
  const t = (item.timeline && item.timeline.tracks) || [];
  let pieces = 0, sounds = 0, beds = 0;
  for (const tr of t) {
    for (const c of (tr.clips || [])) {
      if (tr.kind === 'video') pieces++;
      else if (tr.kind === 'audio') { if (c.pairId) sounds++; else beds++; }
    }
  }
  const bits = [];
  if (pieces) bits.push(pieces + (pieces === 1 ? ' clip' : ' clips'));
  if (sounds) bits.push(sounds + (sounds === 1 ? ' sound' : ' sounds'));
  if (beds) bits.push(beds + (beds === 1 ? ' bed' : ' beds'));
  return bits.join(' · ') || 'empty';
}

// ── Endpoints ───────────────────────────────────────────────────────────────
// Yours, or the admin's - see the header. An entry with no owner is the admin's.
function _canSee(it, req) {
  if (OWN.isAdmin(req.user)) return true;
  const me = OWN.uidOf(req);
  return !!it.owner && !!me && it.owner === me;
}

router.get('/mv3q', (req, res) => {
  const s = read();
  // Same leftover, shown honestly: a row cannot be rendering when nothing is.
  if (!_active && s.items.some(x => x.status === 'running')) {
    for (const it of s.items) if (it.status === 'running') _interrupted(it);
    write(s);
  }
  // How many are in line before each armed entry - across everyone, because the encoder is
  // shared and that is what the wait actually depends on.
  const ahead = new Map();
  let line = 0;
  for (const it of s.items) {
    if (it.status === 'running' || (it.status === 'queued' && it.armed)) ahead.set(it.id, line++);
  }
  // (phase V33.4) A highlights fragment's entry says its project's name as it is now - the Queue shows them as one row.
  const names = new Map();
  const nameOf = (id) => {
    if (!names.has(id)) { let e = null; try { e = require('../lib/highlights-store').entry(id); } catch (err) { /* no store */ } names.set(id, e ? e.name : ''); }
    return names.get(id);
  };
  const items = s.items.filter(it => _canSee(it, req))
    .map(it => ({ ...it, ahead: ahead.has(it.id) ? ahead.get(it.id) : null, ...(it.hl ? { hlName: nameOf(it.hl.id) } : {}) }));
  // Waiting counts what the badge shows: things still to be done, not the whole history.
  const waiting = items.filter(x => x.status === 'queued' || x.status === 'running').length;
  // `running` is the machine's, not the person's: the encoder is busy for everyone.
  // `busy`: any render at all - routes/mv3b.js renders outside the queue (lib/render-busy.js); the shell asks about it before
  // the app stops (desktop/main.js, phase V23).
  res.json({ success: true, waiting, running: !!_active, busy: BUSY.busy(), admin: OWN.isAdmin(req.user), items });
});

router.post('/mv3q/add', (req, res) => {
  try {
    const b = req.body || {};
    // One kind of entry now: a project's timeline and its export settings.
    const kind = 'blank';
    if (!(b.timeline && Array.isArray(b.timeline.tracks))) {
      return res.status(400).json({ success: false, error: 'an entry needs its timeline' });
    }
    // (phase V28.4) Not with a clip whose file is gone - the render would refuse it anyway (lib/mv3b-job.js prepare).
    const gone = require('../lib/mv3b-job').missingCount(b.timeline);
    if (gone) {
      return res.status(409).json({ success: false, missing: gone,
        error: gone + (gone === 1 ? ' clip has' : ' clips have') + ' no file - replace or remove ' + (gone === 1 ? 'it' : 'them') + ' (red on the timeline)' });
    }
    const s = read();
    const item = {
      id: 'q' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
      key: String(b.key || ''), title: String(b.title || 'Untitled').slice(0, 120),
      kind, status: 'queued', addedAt: new Date().toISOString(),
      timeline: b.timeline,
      // The export settings, frozen with the timeline: the render is of what was queued.
      adv: b.adv && typeof b.adv === 'object' ? b.adv : null,
      url: null, error: null,
      owner: OWN.uidOf(req), ownerNick: req.user ? (req.user.nickname || null) : null,
      // Starts only when its owner presses Render all - see the header.
      armed: false,
      dur: Number(b.dur) > 0 ? Number(b.dur) : null,
    };
    item.summary = summarise(item);
    s.items.push(item);
    write(s);
    res.json({ success: true, id: item.id,
               waiting: s.items.filter(x => x.status === 'queued' && _canSee(x, req)).length });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.delete('/mv3q/:id', (req, res) => {
  const s = read();
  const id = String(req.params.id || '');
  const it = s.items.find(x => x.id === id);
  if (it && !_canSee(it, req)) return res.status(403).json({ success: false, error: 'not your entry' });
  if (it && it.status === 'running') return res.status(409).json({ success: false, error: 'that one is rendering' });
  s.items = s.items.filter(x => x.id !== id);
  write(s);
  res.json({ success: true });
});

// Render all: arm the caller's waiting entries and start the runner if it is idle. Pressing
// it while the encoder is busy with another render is fine - the entries are armed
// and take their turn. Pressing it twice does not start a second runner.
router.post('/mv3q/run', (req, res) => {
  // (phase V33.4, the owner's (х44а)) `hl`: only that highlights project's entries - interrupted or failed - go on; nobody
  // else's waiting ones are started (the Queue's "go on" on the project's row).
  const hl = String((req.body || {}).hl || '');
  if (hl) {
    const n = armWhere(x => !!x.hl && x.hl.id === hl);
    return res.json({ success: true, armed: n, already: !!_active && n === 0 });
  }
  const s = read();
  let freed = 0, armed = 0;
  for (const it of s.items) {
    // NOTHING IS ACTUALLY RUNNING - there is no process. Any row still marked running is a
    // leftover: the server was restarted mid-encode, or a scenario job's poll died with it.
    // Left alone it sits at the head of the list for ever and everything behind it waits on
    // a render that finished, failed or was never going to happen.
    if (it.status === 'running' && !_active) { _interrupted(it); freed++; }
    if (it.status === 'queued' && !it.armed && _canSee(it, req)) { it.armed = true; it.interrupted = false; armed++; }
  }
  write(s);
  // (phase V23) Whether one was ALREADY rendering - read before this call starts one, or a render it just started
  // answered `already` too.
  const was = !!_active;
  if (!was) next();
  res.json({ success: true, already: was, started: !was && !!_active, freed, armed });
});

// (phase V73 block 4, the owner's (б4-2) а) EXPORT'S RENDER is ONE entry of this queue: in line at once and ARMED - the
// press asks for it - without arming anybody else's waiting entries (addArmed), started now when the encoder is free. So
// the window may be closed while it goes, Queue shows it, and it is stopped by its own Stop (POST /mv3q/stop/:id) in the
// window or in Queue. The checks of `add` first: a timeline, and no clip whose file is gone.
router.post('/mv3q/render', (req, res) => {
  try {
    const b = req.body || {};
    if (!(b.timeline && Array.isArray(b.timeline.tracks))) {
      return res.status(400).json({ success: false, error: 'a render needs its timeline' });
    }
    const gone = JOB.missingCount(b.timeline);
    if (gone) {
      return res.status(409).json({ success: false, missing: gone,
        error: gone + (gone === 1 ? ' clip has' : ' clips have') + ' no file - replace or remove ' + (gone === 1 ? 'it' : 'them') + ' (red on the timeline)' });
    }
    const was = !!_active;
    const ids = addArmed([{ key: b.key, title: b.title, timeline: b.timeline, adv: b.adv, dur: b.dur }]);
    if (!ids.length) return res.status(400).json({ success: false, error: 'a render needs its timeline' });
    res.json({ success: true, id: ids[0], started: !was && _active === ids[0] });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// (phase V73 block 4) ONE entry stopped - Export's Stop and Queue's: waiting, it is taken out; under the encoder, ffmpeg is
// killed and its entry and draft go once it has exited (runBlank); in its finishing passes it is not stopped - only an
// encode can be cut off - and is kept (`finishing`). A finished or failed one is left as it is (`finished`).
router.post('/mv3q/stop/:id', (req, res) => {
  const id = String(req.params.id || '');
  const it = read().items.find(x => x.id === id);
  if (!it) return res.status(404).json({ success: false, error: 'no such entry' });
  if (!_canSee(it, req)) return res.status(403).json({ success: false, error: 'not your entry' });
  if (it.status === 'done' || it.status === 'failed') return res.json({ success: true, removed: 0, stopping: false, finished: true });
  const r = stopWhere(x => x.id === id);
  res.json({ success: true, removed: r.removed, stopping: r.stopping, finishing: !r.removed && !r.stopping });
});

// Clearing has two meanings and the caller has to say which. A finished entry stays in the
// list on purpose - it is the record of what was rendered and where the file went - so the
// list only ever shrinks because somebody asked it to.
//
// `mode=done` takes out what is finished with. `mode=all` takes out everything not currently
// under the encoder, including things still waiting, which is why the interface asks first.
// Trying again is putting the same job back in the line - the same payload, the same
// timeline. Rebuilding it from the project would render something else and call it a retry.
router.post('/mv3q/retry/:id', (req, res) => {
  const s = read();
  const it = s.items.find(x => x.id === String(req.params.id || ''));
  if (!it) return res.status(404).json({ success: false, error: 'no such entry' });
  if (!_canSee(it, req)) return res.status(403).json({ success: false, error: 'not your entry' });
  if (it.status === 'running') return res.status(409).json({ success: false, error: 'that one is rendering' });
  // Trying again is asking for it: armed, and started at once if the encoder is idle.
  it.status = 'queued'; it.armed = true;
  it.error = null; it.url = null; it.percent = 0; it.remain = null; it.phase = null;
  write(s);
  if (!_active) next();
  res.json({ success: true });
});

router.post('/mv3q/clear', (req, res) => {
  const mode = String((req.body || {}).mode || 'done');
  const s = read();
  const before = s.items.length;
  s.items = s.items.filter(x => {
    if (x.status === 'running') return true;          // never pull the rug out from the encoder
    if (!_canSee(x, req)) return true;                 // somebody else's: not this person's to clear
    if (mode === 'all') return false;
    return x.status !== 'done' && x.status !== 'failed';
  });
  write(s);
  res.json({ success: true, removed: before - s.items.length,
             waiting: s.items.filter(x => x.status === 'queued' && _canSee(x, req)).length });
});

// A render renamed: its entry follows the file (routes/library.js, lib/highlights-render.js).
function updateEntry(id, patch) {
  if (!id) return null;
  const s = read();
  const it = s.items.find(x => x.id === id);
  if (!it) return null;
  Object.assign(it, patch);
  write(s);
  return it;
}
function findByUrl(url) {
  const s = read();
  return s.items.find(x => x.url && x.url === url) || null;
}
function removeByUrl(url) {
  const s = read();
  const before = s.items.length;
  s.items = s.items.filter(x => !(x.url && x.url === url && x.status !== 'running'));
  if (s.items.length !== before) write(s);
  return before - s.items.length;
}

// ── Entries put in by the server (phase V33.4: a highlights project's Render) ─
// In line at once, ARMED - the press was asking for them - and the runner woken; nobody else's waiting entries are armed.
// `list`: [{ key, title, timeline, adv, dur, hl, rev }]. Returns the new ids, in order.
function addArmed(list) {
  const s = read();
  const ids = [];
  for (const b of (list || [])) {
    if (!(b && b.timeline && Array.isArray(b.timeline.tracks))) continue;
    const item = {
      id: 'q' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36),
      key: String(b.key || ''), title: String(b.title || 'Untitled').slice(0, 120),
      kind: 'blank', status: 'queued', addedAt: new Date().toISOString(),
      timeline: b.timeline, adv: b.adv && typeof b.adv === 'object' ? b.adv : null,
      url: null, error: null, owner: OWN.uidOf(), ownerNick: null,
      armed: true, dur: Number(b.dur) > 0 ? Number(b.dur) : null,
      ...(b.hl ? { hl: { id: String(b.hl.id), n: Number(b.hl.n) } } : {}),
      ...(b.rev != null ? { rev: Number(b.rev) || 0 } : {}),
      // One press's entries share it: "rendering 2 of 5" counts them.
      ...(b.batch ? { batch: String(b.batch) } : {}),
    };
    item.summary = summarise(item);
    s.items.push(item);
    ids.push(item.id);
  }
  write(s);
  if (ids.length && !_active) next();
  return ids;
}

// Entries matching `pred` that are not under the encoder and not done, taken out. Returns how many.
function removeWhere(pred) {
  const s = read();
  const before = s.items.length;
  s.items = s.items.filter(x => !(pred(x) && x.status !== 'done' && x.id !== _active));
  if (s.items.length !== before) write(s);
  return before - s.items.length;
}

// Entries matching `pred` taken out whatever their state - except the one under the encoder. Returns how many. (A fragment
// rendered again: its older finished entries, which named the file the new render has taken over.)
function forgetWhere(pred) {
  const s = read();
  const before = s.items.length;
  s.items = s.items.filter(x => !(pred(x) && x.id !== _active));
  if (s.items.length !== before) write(s);
  return before - s.items.length;
}

// Stopped (the owner's (х43)): the waiting ones taken out, the one under the encoder killed - its entry and its draft go
// when ffmpeg has exited (runBlank). Returns { removed, stopping } - stopping: one was under the encoder.
function stopWhere(pred) {
  const removed = removeWhere(pred);
  let stopping = false;
  if (_active) {
    const it = read().items.find(x => x.id === _active);
    if (it && pred(it) && it.status === 'running' && !it.phase) {
      _stopping.add(it.id);
      stopping = true;
      if (_proc) { try { _proc.kill(); } catch (e) { /* gone already */ } }
    }
  }
  return { removed, stopping };
}

// Interrupted or failed entries matching `pred` back in line, armed; the runner woken. Returns how many.
function armWhere(pred) {
  const s = read();
  let n = 0;
  for (const it of s.items) {
    if (!pred(it)) continue;
    if (it.status === 'failed' || (it.status === 'queued' && !it.armed)) {
      it.status = 'queued'; it.armed = true; it.interrupted = false;
      it.error = null; it.url = null; it.percent = 0; it.remain = null; it.phase = null;
      n++;
    }
  }
  if (n) write(s);
  if (n && !_active) next();
  return n;
}

// The entries matching `pred`, each with how many are in line before it (null when it is not in line).
function entriesOf(pred) {
  const s = read();
  const ahead = new Map();
  let line = 0;
  for (const it of s.items) if (it.status === 'running' || (it.status === 'queued' && it.armed)) ahead.set(it.id, line++);
  return s.items.filter(pred).map(it => ({ ...it, ahead: ahead.has(it.id) ? ahead.get(it.id) : null }));
}

// A ROW INTERRUPTED (phase V23): an entry the app was closed or restarted in the middle of goes back to waiting for
// Render all - it stayed armed and "next" for ever, and Render all only counts what is not armed.
function _interrupted(it) {
  if (it.url) { it.status = 'done'; return; }
  it.status = 'queued'; it.armed = false; it.interrupted = true;
  it.percent = 0; it.remain = null; it.phase = null;
}
// (phase V33.4, the owner's (х44)) So do the ones that were IN LINE - armed, not reached yet: nothing starts the runner
// when the server starts, and left armed they said "in line · next" for ever. Nothing goes on by itself after a start.
try {
  const s0 = read();
  if (s0.items.some(x => x.status === 'running' || (x.status === 'queued' && x.armed)) || s0.running) {
    for (const it of s0.items) if (it.status === 'running' || (it.status === 'queued' && it.armed)) _interrupted(it);
    s0.running = false;
    write(s0);
  }
} catch (e) { console.warn('[mv3q] could not put interrupted renders back in line:', e.message); }
// What a render interrupted by a closed app or a crash left: nothing renders while the server starts (phase V23).
try { JOB.sweepDrafts(); } catch (e) { console.warn('[mv3q] could not clear unfinished renders:', e.message); }

module.exports = router;
module.exports.updateEntry = updateEntry;
module.exports.findByUrl = findByUrl;
module.exports.removeByUrl = removeByUrl;
module.exports.addArmed = addArmed;
module.exports.removeWhere = removeWhere;
module.exports.forgetWhere = forgetWhere;
module.exports.stopWhere = stopWhere;
module.exports.armWhere = armWhere;
module.exports.entriesOf = entriesOf;
