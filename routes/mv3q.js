'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — the render queue.

   Shared by both workflows, and the one place they meet. It has to be: a queue that lives
   in the browser dies with the tab, and "time remaining" after a reload would be invented
   rather than measured.

   AN ENTRY CARRIES ITS OWN JOB, not a reference to one. A blank project keeps its timeline;
   a scenario project keeps the payload its editor would have sent. Two reasons, and both
   are about being honest to the person who queued it:

     - the render is what they saw when they queued it, not what the project drifted into
       while five other things rendered ahead of it;
     - the two workflows build their jobs differently, and a queue that had to rebuild them
       would have to know how both work - which is the coupling this whole split exists to
       avoid.

   The queue runs ONE AT A TIME. Rendering is the heaviest thing this machine does, and four
   at once is four renders that all finish late rather than one that finishes soon.

   WHOSE ENTRY. Each one names who queued it, and the list a person sees is their own; the
   admin sees everyone's, with names, and may clear any of them. Entries from before there
   were owners have none and are the admin's.

   WHOSE "RENDER ALL". Queuing something does not start it. Render all ARMS the caller's
   waiting entries - theirs and nobody else's - and the runner takes armed entries in the
   order they were queued. It used to take everything waiting, so one person's Render all
   rendered another person's projects. The encoder itself is still one per machine: armed
   entries from two people go one after another, and each row says how many are ahead.
   ═══════════════════════════════════════════════════════════════════════════ */

const express = require('express');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const { buildGraph } = require('../lib/mv3b-render');
const GATE = require('../lib/access-gate');
const OWN = require('../lib/ownership');
// The queue renders on nobody's request, so its rows are written here, in the owner's name.
const AUDIT = require('../lib/audit');
const _who = (item) => (item && item.owner ? { id: item.owner, nickname: item.ownerNick, role: 'user' } : null);
const _qid = (item) => 'queue:' + item.id;

const router = express.Router();
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'data', 'mv3-queue.json');
const FINALS = path.join(ROOT, 'finals');

const ROOTS = ['uploads', 'obrazy', 'characters', 'environments', 'lookbooks',
               'details', 'refs', 'archive', 'scenes', 'temp_public', 'finals', 'images', 'public'];

function resolveSrc(rel) {
  const clean = String(rel || '').split('?')[0].replace(/^\/+/, '');
  if (!clean || clean.includes('..')) return null;
  if (!ROOTS.includes(clean.split('/')[0])) return null;
  const abs = path.join(ROOT, clean);
  if (!abs.startsWith(ROOT)) return null;
  return fs.existsSync(abs) ? abs : null;
}

function read() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch (e) { return { items: [], running: false }; }
}
function write(s) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(s, null, 2));
}

// ── Running one entry ───────────────────────────────────────────────────────
let _proc = null;
let _startedAt = 0;
// The entry under the encoder, whichever path is encoding it. A blank entry has a local ffmpeg
// process; a scenario entry is rendered inside routes/ffmpeg.js and only polled from here, so
// `_proc` alone said "idle" all through a scenario render - every list read then took the
// running row for a leftover and put it back to queued, and Render all could start it twice.
let _active = null;

function argsForBlank(timeline) {
  const g = buildGraph(timeline || {});
  if (!(g.dur > 0)) return { error: 'nothing on the timeline to render' };
  const args = ['-hide_banner', '-y'];
  const missing = [];
  for (const i of g.inputs) {
    const abs = resolveSrc(i.file);
    if (!abs) { missing.push(i.file); continue; }
    if (i.loop) args.push('-loop', '1');
    if (i.ss) args.push('-ss', String(i.ss));
    args.push('-t', String(i.t), '-i', abs);
  }
  if (missing.length) return { error: 'missing files: ' + missing.join(', ') };
  args.push('-filter_complex', g.filter, '-map', `[${g.map.v}]`);
  if (g.map.a) args.push('-map', `[${g.map.a}]`); else args.push('-an');
  args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
            '-r', '30', '-t', String(g.dur));
  if (g.map.a) args.push('-c:a', 'aac', '-b:a', '192k');
  return { args, dur: g.dur };
}

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
  AUDIT.processStart(null, _qid(item), {
    user: _who(item), page: 'Merge', kind: 'queue.render',
    label: `started queue render of “${item.title}” (${item.kind === 'blank' ? 'blank' : 'scenario'}${item.summary ? ' · ' + item.summary : ''})`,
    ids: { queueId: item.id, key: item.key }, params: { kind: item.kind, dur: item.dur || null },
  });

  // A scenario entry is handed to the renderer that knows how to read it, over HTTP to this
  // same server. Calling into routes/ffmpeg.js directly would mean importing it, and the whole
  // point of the split is that neither render path can reach the other. The call carries the
  // internal token (lib/access-gate.js): it has no cookie, and without the token the sign-in
  // gate turned it away - every scenario entry failed as "auth required".
  if (item.kind !== 'blank') return runTalking(item);

  const built = argsForBlank(item.timeline);
  if (built.error) {
    const t = read();
    const it = t.items.find(x => x.id === item.id);
    if (it) { it.status = 'failed'; it.error = built.error; }
    write(t);
    AUDIT.processEnd(null, _qid(item), { ok: false, error: built.error });
    _active = null;
    return next();
  }

  fs.mkdirSync(FINALS, { recursive: true });
  const name = 'mv3q_' + Date.now() + '.mp4';
  const out = path.join(FINALS, name);
  _startedAt = Date.now();
  _proc = spawn(ffmpegPath, built.args.concat([out]), { stdio: ['ignore', 'ignore', 'pipe'] });
  let log = '';
  _proc.stderr.on('data', d => {
    const chunk = d.toString();
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
  _proc.on('close', (code) => {
    _proc = null; _active = null;
    const t = read();
    const it = t.items.find(x => x.id === item.id);
    if (it) {
      if (code === 0 && fs.existsSync(out)) { it.status = 'done'; it.url = '/finals/' + name; }
      else { it.status = 'failed'; it.error = 'ffmpeg exited ' + code; it.log = log.slice(-800); }
      it.tookMs = Date.now() - _startedAt;
    }
    write(t);
    const good = code === 0 && fs.existsSync(out);
    AUDIT.processEnd(null, _qid(item), good ? { ok: true, result: '/finals/' + name } : { ok: false, error: 'ffmpeg exited ' + code });
    next();
  });
  _proc.on('error', (e) => {
    _proc = null; _active = null;
    const t = read();
    const it = t.items.find(x => x.id === item.id);
    if (it) { it.status = 'failed'; it.error = e.message; }
    write(t);
    AUDIT.processEnd(null, _qid(item), { ok: false, error: e.message });
    next();
  });
}

// The scenario renderer answers with a job id and is polled, so this follows it to the end
// and records where the file landed - the queue's promise is a finished file, not a started
// encode.
function runTalking(item) {
  const fail = (msg) => {
    const t = read();
    const it = t.items.find(x => x.id === item.id);
    if (it) { it.status = 'failed'; it.error = msg; }
    write(t);
    AUDIT.processEnd(null, _qid(item), { ok: false, error: msg });
    _active = null;
    next();
  };
  if (!item.payload) return fail('this entry carries no render payload');

  const PORT = process.env.PORT || 3000;
  const base = 'http://127.0.0.1:' + PORT;
  const auth = { 'X-Internal-Token': GATE.internalToken() };
  fetch(base + '/api/ffmpeg/render', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify(item.payload),
  }).then(r => r.json()).then(d => {
    if (!d || !d.success || !d.jobId) throw new Error((d && d.error) || 'the scenario renderer refused it');
    const started = Date.now();
    const poll = () => {
      fetch(base + '/api/ffmpeg/status/' + encodeURIComponent(d.jobId), { headers: auth }).then(r => r.json()).then(st => {
        if (!st || !st.success) throw new Error((st && st.error) || 'lost the job');
        // TERMINAL is the short list, and everything else is still working. The scenario
        // renderer passes through 'normalizing' and 'speeding' on its way to a file, and
        // treating an unrecognised word as the end marked a perfectly good render as failed -
        // "ended as speeding". Naming the two states it finishes in, rather than the two it
        // works in, is the version that survives the next state being added.
        if (st.status !== 'done' && st.status !== 'cancelled' && !st.error) {
          const t = read();
          const it = t.items.find(x => x.id === item.id);
          if (it) {
            // progressSecs is how much OUTPUT ffmpeg has written; against the cut's length,
            // sent along when the entry was queued, that is a real fraction. The phases before
            // and after the encode report no seconds, so they are named instead of shown as 0%.
            it.phase = st.status;
            const dur = +item.dur || 0;
            if (st.status === 'running' && dur > 0) {
              const pc = Math.max(0, Math.min(99, Math.round((+st.progressSecs || 0) / dur * 100)));
              const el = (Date.now() - started) / 1000;
              it.percent = pc;
              it.remain = (pc > 3 && el > 1.5) ? Math.round(el / (pc / 100) - el) : null;
            }
            write(t);
          }
          return setTimeout(poll, 1500);
        }
        const t = read();
        const it = t.items.find(x => x.id === item.id);
        if (it) {
          it.tookMs = Date.now() - started;
          if (st.status === 'done' && st.url) { it.status = 'done'; it.url = st.url; }
          else if (st.status === 'cancelled') { it.status = 'failed'; it.error = 'cancelled'; }
          else { it.status = 'failed'; it.error = st.error || ('ended as ' + st.status); }
        }
        write(t);
        AUDIT.processEnd(null, _qid(item), st.status === 'done' && st.url ? { ok: true, result: st.url }
          : st.status === 'cancelled' ? { ok: false, cancelled: true }
          : { ok: false, error: st.error || ('ended as ' + st.status) });
        _active = null;
        next();
      }).catch(e => fail(e.message));
    };
    setTimeout(poll, 1200);
  }).catch(e => fail(e.message));
}

// What the entry is MADE OF, worked out when it is queued rather than when it is shown. The
// job is frozen at that moment anyway, so counting it later would describe the project as it
// is now and label a render that was of something else.
function summarise(item) {
  if (item.kind === 'blank') {
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
  const p = item.payload || {};
  const n = (a) => (Array.isArray(a) ? a.length : 0);
  const bits = [];
  if (n(p.segmentClips)) bits.push(n(p.segmentClips) + ' fragments');
  if (n(p.clips)) bits.push(n(p.clips) + ' birols');
  if (n(p.hookClips)) bits.push(n(p.hookClips) + ' hooks');
  if (n(p.halferClips)) bits.push(n(p.halferClips) + ' halfers');
  if (n(p.musicClips)) bits.push('music');
  if (p.segSfx && p.segSfx !== 'Нет') bits.push('sfx');
  return bits.join(' · ') || 'nothing counted';
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
    const kind = b.kind === 'blank' ? 'blank' : 'talking';
    if (kind === 'blank' && !(b.timeline && Array.isArray(b.timeline.tracks))) {
      return res.status(400).json({ success: false, error: 'a blank entry needs its timeline' });
    }
    const s = read();
    const item = {
      id: 'q' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
      key: String(b.key || ''), title: String(b.title || 'Untitled').slice(0, 120),
      kind, status: 'queued', addedAt: new Date().toISOString(),
      timeline: kind === 'blank' ? b.timeline : null,
      payload: kind === 'talking' ? (b.payload || null) : null,
      url: null, error: null,
      owner: OWN.uidOf(req), ownerNick: req.user ? (req.user.nickname || null) : null,
      // Starts only when its owner presses Render all - see the header.
      armed: false,
      // The cut's length in seconds, for the progress bar of a scenario render: the renderer
      // reports seconds written, and only against a total is that a percentage.
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
