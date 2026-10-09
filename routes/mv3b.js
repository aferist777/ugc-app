'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — rendering a project, from Export -> Render.

   The graph is lib/mv3b-render.js; getting a render ready (captions, inputs, arguments) and its
   poster afterwards are lib/mv3b-job.js, shared with the render queue (routes/mv3q.js) so the two
   cannot drift apart again.

     POST /api/mv3b/render      { timeline, key, adv } -> { jobId, w, h, dur }, a file in the renders
                                folder of the project the timeline belongs to; adv is the export
                                settings as the window shows them (lib/render-finish.js)
     GET  /api/mv3b/render/:id  -> status, phase (render | speeding | tail | poster), url, percent,
                                remaining seconds, and a warning when an extra could not be added
   ═══════════════════════════════════════════════════════════════════════════ */

const express = require('express');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const JOB = require('../lib/mv3b-job');
const BUSY = require('../lib/render-busy');

const router = express.Router();
const { toUrl } = require('../lib/media');

const _jobs = new Map();

router.post('/mv3b/render', async (req, res) => {
  try {
    const tl = (req.body || {}).timeline || {};
    const id = 'j' + Date.now().toString(36);
    // The settings come with the timeline, as the window showed them - not off the stored project,
    // which may be a save behind.
    const ready = await JOB.prepare(tl, id, (req.body || {}).adv);
    if (ready.error) return res.status(400).json({ success: false, error: ready.error });

    // Into the folder of the project the timeline belongs to (lib/shelf-files.js).
    // Written under a draft name the shelf does not show, and given its own at the end (lib/mv3b-job.js, drafts).
    const name = 'mv3b_' + Date.now() + '.mp4';
    const final = path.join(require('../lib/shelf-files').rendersDir(String((req.body || {}).key || '')).dir, name);
    const out = JOB.draftOf(final);
    // `span` is the length the current phase's ffmpeg position counts up to: the film, then the
    // film at its new speed, then that and the tail.
    const job = { id, status: 'running', phase: 'render', url: null, error: null, warning: null, log: '',
                  dur: ready.dur, span: ready.dur, at: 0, startedAt: Date.now(), phaseAt: Date.now() };
    _jobs.set(id, job);

    // Busy until the finishing passes are over too: a speed pass and a tail are encodes as well.
    const done = BUSY.start();
    const proc = spawn(ffmpegPath, ready.args.concat([out]), { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    // HOW FAR IT HAS GOT, read off ffmpeg rather than guessed from a stopwatch. It prints the
    // position it has encoded to; against the known length that is real progress, and real
    // progress is what makes "time remaining" a measurement instead of a wish.
    // A caption drawn in a font it was not given is said with the warnings (lib/font-check.js).
    const fonts = require('../lib/font-check').watcher();
    proc.stderr.on('data', d => {
      const s = d.toString();
      fonts.feed(s);
      job.log = (job.log + s).slice(-4000);
      const m = /time=(\d+):(\d\d):(\d\d(?:\.\d+)?)/.exec(s);
      if (m) job.at = (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
    });
    proc.on('close', async (code) => {
      ready.dispose();
      if (code !== 0 || !fs.existsSync(out)) { JOB.dropDraft(out); done(); job.status = 'failed'; job.error = 'ffmpeg exited ' + code; return; }
      const s = ready.settings;
      const spans = { speeding: ready.dur / s.speed, tail: ready.dur / s.speed + s.tailMinutes * 60 };
      try {
        const r = await JOB.finish(out, s, ({ phase, at }) => {
          const ph = phase === 'speed' ? 'speeding' : phase;
          if (job.phase !== ph) { job.phase = ph; job.span = spans[ph] || 0; job.phaseAt = Date.now(); }
          job.at = at;
        }, final);
        const said = [...(ready.warnings || []), ...((r && r.warnings) || []), ...fonts.warnings()];
        if (said.length) job.warning = said.join('; ');
        job.status = 'done'; job.url = toUrl(final);
      } catch (e) {
        // Not a render with a setting quietly missing: the file goes, and the reason is said.
        JOB.dropDraft(out);
        job.status = 'failed'; job.error = e.message;
      } finally {
        done();
      }
    });
    proc.on('error', (e) => { ready.dispose(); JOB.dropDraft(out); done(); job.status = 'failed'; job.error = e.message; });

    res.json({ success: true, jobId: id, w: ready.w, h: ready.h, dur: ready.dur });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/mv3b/render/:id', (req, res) => {
  const j = _jobs.get(String(req.params.id || ''));
  if (!j) return res.status(404).json({ success: false, error: 'no such job' });
  const elapsed = (Date.now() - j.phaseAt) / 1000;
  const frac = j.span > 0 ? Math.max(0, Math.min(1, j.at / j.span)) : 0;
  // Remaining is only offered once there is something to base it on. An estimate made from
  // the first half-second says a number that will be wrong by a factor of ten, and a wrong
  // number is worse than none - people plan around it.
  const remain = (frac > 0.03 && elapsed > 1.5) ? Math.max(0, elapsed / frac - elapsed) : null;
  res.json({ success: true, status: j.status, phase: j.phase, url: j.url, error: j.error, warning: j.warning,
             at: Math.round(j.at * 10) / 10, dur: j.dur,
             percent: Math.round(frac * 100), remain: remain == null ? null : Math.round(remain),
             log: j.log.slice(-1200) });
});

module.exports = router;
