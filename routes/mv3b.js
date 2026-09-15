'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — rendering a project, from Export -> Render.

   The graph is lib/mv3b-render.js; getting a render ready (captions, inputs, arguments) and its
   poster afterwards are lib/mv3b-job.js, shared with the render queue (routes/mv3q.js) so the two
   cannot drift apart again.

     POST /api/mv3b/render      { timeline, key } -> { jobId, w, h, dur }, a file in the renders
                                folder of the project the timeline belongs to
     GET  /api/mv3b/render/:id  -> status, url, percent, remaining seconds
   ═══════════════════════════════════════════════════════════════════════════ */

const express = require('express');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const JOB = require('../lib/mv3b-job');

const router = express.Router();
const { toUrl } = require('../lib/media');

const _jobs = new Map();

router.post('/mv3b/render', async (req, res) => {
  try {
    const tl = (req.body || {}).timeline || {};
    const id = 'j' + Date.now().toString(36);
    const ready = await JOB.prepare(tl, id);
    if (ready.error) return res.status(400).json({ success: false, error: ready.error });

    // Into the folder of the project the timeline belongs to (lib/shelf-files.js).
    const name = 'mv3b_' + Date.now() + '.mp4';
    const out = path.join(require('../lib/shelf-files').rendersDir(String((req.body || {}).key || '')).dir, name);
    const job = { id, status: 'running', url: null, error: null, log: '',
                  dur: ready.dur, at: 0, startedAt: Date.now() };
    _jobs.set(id, job);

    const proc = spawn(ffmpegPath, ready.args.concat([out]), { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    // HOW FAR IT HAS GOT, read off ffmpeg rather than guessed from a stopwatch. It prints the
    // position it has encoded to; against the known length that is real progress, and real
    // progress is what makes "time remaining" a measurement instead of a wish.
    proc.stderr.on('data', d => {
      const s = d.toString();
      job.log = (job.log + s).slice(-4000);
      const m = /time=(\d+):(\d\d):(\d\d(?:\.\d+)?)/.exec(s);
      if (m) job.at = (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
    });
    proc.on('close', async (code) => {
      ready.dispose();
      if (code === 0 && fs.existsSync(out)) {
        await JOB.finish(out);
        job.status = 'done'; job.url = toUrl(out);
      } else { job.status = 'failed'; job.error = 'ffmpeg exited ' + code; }
    });
    proc.on('error', (e) => { ready.dispose(); job.status = 'failed'; job.error = e.message; });

    res.json({ success: true, jobId: id, w: ready.w, h: ready.h, dur: ready.dur });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/mv3b/render/:id', (req, res) => {
  const j = _jobs.get(String(req.params.id || ''));
  if (!j) return res.status(404).json({ success: false, error: 'no such job' });
  const elapsed = (Date.now() - j.startedAt) / 1000;
  const frac = j.dur > 0 ? Math.max(0, Math.min(1, j.at / j.dur)) : 0;
  // Remaining is only offered once there is something to base it on. An estimate made from
  // the first half-second says a number that will be wrong by a factor of ten, and a wrong
  // number is worse than none - people plan around it.
  const remain = (frac > 0.03 && elapsed > 1.5) ? Math.max(0, elapsed / frac - elapsed) : null;
  res.json({ success: true, status: j.status, url: j.url, error: j.error,
             at: Math.round(j.at * 10) / 10, dur: j.dur,
             percent: Math.round(frac * 100), remain: remain == null ? null : Math.round(remain),
             log: j.log.slice(-1200) });
});

module.exports = router;
