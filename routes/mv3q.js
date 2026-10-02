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

// Marked running (and _active) before this is called, so nothing starts it twice while the files
// are being asked about.
async function runBlank(item) {
  // The same preparation Export -> Render uses (lib/mv3b-job.js): captions included.
  const built = await JOB.prepare(item.timeline, item.id, item.adv);
  if (built.error) {
    const t = read();
    const it = t.items.find(x => x.id === item.id);
    if (it) { it.status = 'failed'; it.error = built.error; }
    write(t);
    _active = null;
    return next();
  }

  // Into the folder of the project the entry's timeline belongs to (lib/shelf-files.js).
  const name = 'mv3q_' + Date.now() + '.mp4';
  const out = path.join(require('../lib/shelf-files').rendersDir(item.key).dir, name);
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
        const r = await JOB.finish(out, built.settings, ({ phase }) => mark(phase === 'speed' ? 'speeding' : phase));
        const said = [...(built.warnings || []), ...((r && r.warnings) || []), ...fonts.warnings()];
        if (said.length) warning = said.join('; ');
      } catch (e) {
        try { fs.rmSync(out, { force: true }); } catch (e2) { /* held open */ }
        ok = false; error = e.message;
      }
    }
    done();
    _active = null;
    const t = read();
    const it = t.items.find(x => x.id === item.id);
    if (it) {
      it.phase = null;
      if (ok) { it.status = 'done'; it.url = toUrl(out); it.warning = warning; }
      else { it.status = 'failed'; it.error = error; it.log = log.slice(-800); }
      it.tookMs = Date.now() - _startedAt;
    }
    write(t);
    next();
  });
  _proc.on('error', (e) => {
    _proc = null; _active = null;
    done();
    built.dispose();
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
    for (const it of s.items) if (it.status === 'running') it.status = it.url ? 'done' : 'queued';
    write(s);
  }
  // How many are in line before each armed entry - across everyone, because the encoder is
  // shared and that is what the wait actually depends on.
  const ahead = new Map();
  let line = 0;
  for (const it of s.items) {
    if (it.status === 'running' || (it.status === 'queued' && it.armed)) ahead.set(it.id, line++);
  }
  const items = s.items.filter(it => _canSee(it, req))
    .map(it => ({ ...it, ahead: ahead.has(it.id) ? ahead.get(it.id) : null }));
  // Waiting counts what the badge shows: things still to be done, not the whole history.
  const waiting = items.filter(x => x.status === 'queued' || x.status === 'running').length;
  // `running` is the machine's, not the person's: the encoder is busy for everyone.
  res.json({ success: true, waiting, running: !!_active, admin: OWN.isAdmin(req.user), items });
});

router.post('/mv3q/add', (req, res) => {
  try {
    const b = req.body || {};
    // One kind of entry now: a project's timeline and its export settings.
    const kind = 'blank';
    if (!(b.timeline && Array.isArray(b.timeline.tracks))) {
      return res.status(400).json({ success: false, error: 'an entry needs its timeline' });
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
// it while the encoder is busy with somebody else's render is fine - the entries are armed
// and take their turn. Pressing it twice does not start a second runner.
router.post('/mv3q/run', (req, res) => {
  const s = read();
  let freed = 0, armed = 0;
  for (const it of s.items) {
    // NOTHING IS ACTUALLY RUNNING - there is no process. Any row still marked running is a
    // leftover: the server was restarted mid-encode, or a scenario job's poll died with it.
    // Left alone it sits at the head of the list for ever and everything behind it waits on
    // a render that finished, failed or was never going to happen.
    if (it.status === 'running' && !_active) { it.status = it.url ? 'done' : 'queued'; freed++; }
    if (it.status === 'queued' && !it.armed && _canSee(it, req)) { it.armed = true; armed++; }
  }
  write(s);
  if (!_active) next();
  res.json({ success: true, already: !!_active, freed, armed });
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

// ── Renders made outside the queue ──────────────────────────────────────────
// Export -> Render on either editor makes a file without ever queuing. It is filed in here as
// ready the moment it exists, so the person can come back to it: play it, name it, send it.
// No payload - there is nothing to retry; the file is the whole of it. Owned like any entry.
function fileFinished({ url, title, key, kind, dur, owner, ownerNick }) {
  const s = read();
  const item = {
    id: 'q' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
    key: String(key || ''), title: String(title || 'Untitled').slice(0, 120),
    kind: kind === 'blank' ? 'blank' : 'talking', status: 'done', addedAt: new Date().toISOString(),
    timeline: null, payload: null, url: String(url || ''), error: null,
    owner: owner || null, ownerNick: ownerNick || null, armed: true,
    dur: Number(dur) > 0 ? Number(dur) : null, summary: 'rendered from Export', sent: null,
  };
  s.items.push(item);
  write(s);
  return item;
}
// A named, sent or moved render: the entry follows the file.
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

module.exports = router;
module.exports.fileFinished = fileFinished;
module.exports.updateEntry = updateEntry;
module.exports.findByUrl = findByUrl;
module.exports.removeByUrl = removeByUrl;
