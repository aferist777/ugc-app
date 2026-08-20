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
   ═══════════════════════════════════════════════════════════════════════════ */

const express = require('express');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const { buildGraph } = require('../lib/mv3b-render');

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
  const item = s.items.find(x => x.status === 'queued');
  if (!item) { s.running = false; write(s); return; }

  item.status = 'running';
  item.startedAt = new Date().toISOString();
  s.running = true;
  write(s);

  // A scenario entry is handed to the renderer that knows how to read it, over HTTP to this
  // same server. Calling into routes/ffmpeg.js directly would mean importing it, and the whole
  // point of the split is that neither render path can reach the other.
  if (item.kind !== 'blank') return runTalking(item);

  const built = argsForBlank(item.timeline);
  if (built.error) {
    const t = read();
    const it = t.items.find(x => x.id === item.id);
    if (it) { it.status = 'failed'; it.error = built.error; }
    write(t);
    return next();
  }

  fs.mkdirSync(FINALS, { recursive: true });
  const name = 'mv3q_' + Date.now() + '.mp4';
  const out = path.join(FINALS, name);
  _startedAt = Date.now();
  _proc = spawn(ffmpegPath, built.args.concat([out]), { stdio: ['ignore', 'ignore', 'pipe'] });
  let log = '';
  _proc.stderr.on('data', d => { log = (log + d.toString()).slice(-3000); });
  _proc.on('close', (code) => {
    _proc = null;
    const t = read();
    const it = t.items.find(x => x.id === item.id);
    if (it) {
      if (code === 0 && fs.existsSync(out)) { it.status = 'done'; it.url = '/finals/' + name; }
      else { it.status = 'failed'; it.error = 'ffmpeg exited ' + code; it.log = log.slice(-800); }
      it.tookMs = Date.now() - _startedAt;
    }
    write(t);
    next();
  });
  _proc.on('error', (e) => {
    _proc = null;
    const t = read();
    const it = t.items.find(x => x.id === item.id);
    if (it) { it.status = 'failed'; it.error = e.message; }
    write(t);
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
    next();
  };
  if (!item.payload) return fail('this entry carries no render payload');

  const PORT = process.env.PORT || 3000;
  const base = 'http://127.0.0.1:' + PORT;
  fetch(base + '/api/ffmpeg/render', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(item.payload),
  }).then(r => r.json()).then(d => {
    if (!d || !d.success || !d.jobId) throw new Error((d && d.error) || 'the scenario renderer refused it');
    const started = Date.now();
    const poll = () => {
      fetch(base + '/api/ffmpeg/status/' + encodeURIComponent(d.jobId)).then(r => r.json()).then(st => {
        if (!st || !st.success) throw new Error((st && st.error) || 'lost the job');
        // TERMINAL is the short list, and everything else is still working. The scenario
        // renderer passes through 'normalizing' and 'speeding' on its way to a file, and
        // treating an unrecognised word as the end marked a perfectly good render as failed -
        // "ended as speeding". Naming the two states it finishes in, rather than the two it
        // works in, is the version that survives the next state being added.
        if (st.status !== 'done' && st.status !== 'cancelled' && !st.error) {
          const t = read();
          const it = t.items.find(x => x.id === item.id);
          if (it) { it.percent = st.percent || 0; write(t); }
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
        next();
      }).catch(e => fail(e.message));
    };
    setTimeout(poll, 1200);
  }).catch(e => fail(e.message));
}

// ── Endpoints ───────────────────────────────────────────────────────────────
router.get('/mv3q', (_req, res) => {
  const s = read();
  // Waiting counts what the badge shows: things still to be done, not the whole history.
  const waiting = s.items.filter(x => x.status === 'queued' || x.status === 'running').length;
  res.json({ success: true, waiting, running: !!_proc, items: s.items });
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
    };
    s.items.push(item);
    write(s);
    res.json({ success: true, id: item.id, waiting: s.items.filter(x => x.status === 'queued').length });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.delete('/mv3q/:id', (req, res) => {
  const s = read();
  const id = String(req.params.id || '');
  const it = s.items.find(x => x.id === id);
  if (it && it.status === 'running') return res.status(409).json({ success: false, error: 'that one is rendering' });
  s.items = s.items.filter(x => x.id !== id);
  write(s);
  res.json({ success: true });
});

// Start working through whatever is queued. Idempotent: pressing it twice does not start a
// second runner, it just returns that one is already going.
router.post('/mv3q/run', (_req, res) => {
  if (_proc) return res.json({ success: true, already: true });
  next();
  res.json({ success: true, already: false });
});

// Clearing has two meanings and the caller has to say which. A finished entry stays in the
// list on purpose - it is the record of what was rendered and where the file went - so the
// list only ever shrinks because somebody asked it to.
//
// `mode=done` takes out what is finished with. `mode=all` takes out everything not currently
// under the encoder, including things still waiting, which is why the interface asks first.
router.post('/mv3q/clear', (req, res) => {
  const mode = String((req.body || {}).mode || 'done');
  const s = read();
  const before = s.items.length;
  s.items = s.items.filter(x => {
    if (x.status === 'running') return true;          // never pull the rug out from the encoder
    if (mode === 'all') return false;
    return x.status !== 'done' && x.status !== 'failed';
  });
  write(s);
  res.json({ success: true, removed: before - s.items.length,
             waiting: s.items.filter(x => x.status === 'queued').length });
});

module.exports = router;
