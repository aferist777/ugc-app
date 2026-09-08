'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — rendering a BLANK project.

   The second render path, and separate from routes/ffmpeg.js on purpose - see the note at
   the top of lib/mv3b-render.js. Nothing here is imported by the scenario renderer and
   nothing there is imported here, so a scenario export keeps working by construction.

   Two endpoints and no more:
     POST /api/mv3b/plan    -> the graph, built and returned, nothing run
     POST /api/mv3b/render  -> the same graph, run to a file in finals/

   And one more, the same render run small: POST /api/mv3b/preview-cut with the timeline and
   `preview: { key, rev }` writes the preview cut where routes/ffmpeg.js keeps them (see "The
   preview cut" there). Its own path so the audit log can leave it alone.

   `plan` exists because a filter graph is the kind of thing that is far cheaper to read
   than to debug from a broken video, and because it lets the layer order be checked against
   the preview without waiting for an encode.
   ═══════════════════════════════════════════════════════════════════════════ */

const express = require('express');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const { buildGraph, frame } = require('../lib/mv3b-render');
const { buildAss, captionLanes } = require('../lib/mv3b-subs');

const router = express.Router();
const ROOT = path.join(__dirname, '..');
const FINALS = path.join(ROOT, 'finals');

// The same mapping express.static does, and only where media legitimately lives. A src is a
// web path as the pages already use it, not an invitation to name any file on the disk.
const ROOTS = ['uploads', 'obrazy', 'characters', 'environments', 'lookbooks',
               'details', 'refs', 'archive', 'scenes', 'temp_public', 'finals', 'images', 'public'];

function resolveSrc(rel) {
  const clean = String(rel || '').split('?')[0].replace(/^\/+/, '');
  if (!clean || clean.includes('..')) return null;
  const top = clean.split('/')[0];
  if (!ROOTS.includes(top)) return null;
  const abs = path.join(ROOT, clean);
  if (!abs.startsWith(ROOT)) return null;
  return fs.existsSync(abs) ? abs : null;
}

// Every input resolved before a single one is decoded. A graph half-built around a file that
// turns out to be missing fails deep inside ffmpeg with a message about a stream index, which
// is a long way from "that clip is gone".
function argsFor(graph, preview) {
  const args = ['-hide_banner', '-y'];
  const missing = [];
  for (const i of graph.inputs) {
    const abs = resolveSrc(i.file);
    if (!abs) { missing.push(i.file); continue; }
    if (i.loop) args.push('-loop', '1');
    if (i.ss) args.push('-ss', String(i.ss));
    args.push('-t', String(i.t), '-i', abs);
  }
  if (missing.length) return { missing };
  args.push('-filter_complex', graph.filter, '-map', `[${graph.map.v}]`);
  if (graph.map.a) args.push('-map', `[${graph.map.a}]`);
  else args.push('-an');
  if (preview) {
    // The cut: the graph as it is, scaled on the way out to 480 on the short side, at the
    // fastest settings. The captions were built for the full frame and scale with it.
    const small = graph.w > graph.h ? '854x480' : '480x854';
    args.push('-s', small, '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30', '-pix_fmt', 'yuv420p',
              '-r', '30', '-t', String(graph.dur));
    if (graph.map.a) args.push('-c:a', 'aac', '-b:a', '96k');
    args.push('-movflags', '+faststart');
    return { args };
  }
  args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
            '-r', '30', '-t', String(graph.dur));
  if (graph.map.a) args.push('-c:a', 'aac', '-b:a', '192k');
  return { args };
}

router.post('/mv3b/plan', (req, res) => {
  let assPath = null;
  try {
    const tl = (req.body || {}).timeline || {};
    // Written even for a plan, and thrown away straight after: the point of a plan is to show
    // the command that WOULD run, and one with the caption filter missing would be a different
    // command from the one it is standing in for.
    assPath = writeAss(tl, 'plan');
    const g = buildGraph(tl, { assPath });
    const built = argsFor(g);
    res.json({
      success: true, w: g.w, h: g.h, dur: g.dur,
      inputs: g.inputs, filter: g.filter, map: g.map,
      missing: built.missing || [],
      // The command as it would be run, so what is about to happen can be read rather than
      // guessed at from a filename.
      args: built.args || null,
      captions: assPath
        ? captionLanes((req.body || {}).timeline || {}).reduce((n, t) => n + ((t.clips || []).length), 0)
        : 0,
    });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  finally { dropAss(assPath); }
});

// The captions, written where ffmpeg can be pointed at them. A file rather than something
// passed inline because that is the only thing libass reads - and one per job rather than one
// shared, so two renders of two projects cannot burn each other's words.
const ASS_DIR = path.join(ROOT, 'temp_public', 'mv3b_ass');

function writeAss(timeline, id) {
  const lanes = captionLanes(timeline);
  if (!lanes.length) return null;
  const { w, h } = frame(timeline);
  const text = buildAss(lanes, w, h);
  if (!text) return null;
  fs.mkdirSync(ASS_DIR, { recursive: true });
  const p = path.join(ASS_DIR, 'ass_' + id + '.ass');
  fs.writeFileSync(p, text, 'utf8');
  return p;
}

const dropAss = (p) => { try { if (p && fs.existsSync(p)) fs.unlinkSync(p); } catch (e) {} };

const _jobs = new Map();
// The preview cut in flight per project: a newer version of the project supersedes it.
const _cutJobs = new Map();

// One render, two doors: /mv3b/render to finals/, /mv3b/preview-cut small and to the cut's
// place. `pvIn` is the second door's { key, rev }.
function _render(req, res, pvIn) {
  try {
    const tl = (req.body || {}).timeline || {};
    const preview = (pvIn && typeof pvIn === 'object' && pvIn.key && pvIn.rev) ? { key: String(pvIn.key), rev: String(pvIn.rev) } : null;
    const FF = preview ? require('./ffmpeg') : null;
    const cut = preview ? FF.cutPath(preview.key, preview.rev) : null;
    if (cut && fs.existsSync(cut.abs)) return res.json({ success: true, ready: true, url: cut.url });
    if (preview) {
      const prev = _cutJobs.get(preview.key);
      if (prev && prev.status === 'running') {
        if (prev.rev === preview.rev) return res.json({ success: true, jobId: prev.id, w: prev.w, h: prev.h, dur: prev.dur });
        prev.status = 'cancelled';                                  // superseded by a newer version
        try { prev.proc.kill('SIGTERM'); } catch (e) {}
      }
    }
    const id = 'j' + Date.now().toString(36);
    var assPath = writeAss(tl, id);
    const g = buildGraph(tl, { assPath });
    if (!(g.dur > 0)) { dropAss(assPath); return res.status(400).json({ success: false, error: 'nothing on the timeline to render' }); }
    const built = argsFor(g, !!preview);
    if (built.missing) {
      dropAss(assPath);
      return res.status(400).json({ success: false, error: 'these files are not on the disk: ' + built.missing.join(', ') });
    }

    fs.mkdirSync(FINALS, { recursive: true });
    const name = 'mv3b_' + Date.now() + '.mp4';
    // The cut is written beside its final name and renamed when whole, so "ready" is atomic.
    const out = cut ? cut.abs + '.part.mp4' : path.join(FINALS, name);
    const args = built.args.concat([out]);
    const job = { id, status: 'running', url: null, error: null, log: '',
                  dur: g.dur, at: 0, startedAt: Date.now(), w: g.w, h: g.h,
                  preview: !!preview, key: preview ? preview.key : null, rev: preview ? preview.rev : null };
    _jobs.set(id, job);
    if (preview) _cutJobs.set(preview.key, job);

    const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    // HOW FAR IT HAS GOT, read off ffmpeg rather than guessed from a stopwatch. It prints the
    // position it has encoded to; against the known length that is real progress, and real
    // progress is what makes "time remaining" a measurement instead of a wish.
    proc.stderr.on('data', d => {
      const s = d.toString();
      job.log = (job.log + s).slice(-4000);
      const m = /time=(\d+):(\d\d):(\d\d(?:\.\d+)?)/.exec(s);
      if (m) job.at = (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
    });
    job.proc = proc;
    proc.on('close', (code) => {
      // The caption file outlives the graph and not the encode: ffmpeg reads it while it runs,
      // so it can only go once the process has closed - either way, finished or failed.
      dropAss(assPath);
      if (job.status === 'cancelled') { try { if (fs.existsSync(out)) fs.unlinkSync(out); } catch (e) {} return; }
      if (code === 0 && fs.existsSync(out)) {
        if (cut) {
          try { fs.renameSync(out, cut.abs); job.status = 'done'; job.url = cut.url; FF.sweepCuts(preview.key, cut.name); }
          catch (e) { job.status = 'failed'; job.error = e.message; }
        } else { job.status = 'done'; job.url = '/finals/' + name; }
      } else {
        job.status = 'failed'; job.error = 'ffmpeg exited ' + code;
        try { if (cut && fs.existsSync(out)) fs.unlinkSync(out); } catch (e) {}
      }
    });
    proc.on('error', (e) => { dropAss(assPath); job.status = 'failed'; job.error = e.message; });

    res.json({ success: true, jobId: id, w: g.w, h: g.h, dur: g.dur });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
}
router.post('/mv3b/render', (req, res) => _render(req, res, null));
router.post('/mv3b/preview-cut', (req, res) => _render(req, res, (req.body || {}).preview));

router.get('/mv3b/render/:id', (req, res) => {
  const j = _jobs.get(String(req.params.id || ''));
  if (!j) return res.status(404).json({ success: false, error: 'no such job' });
  const elapsed = (Date.now() - j.startedAt) / 1000;
  const frac = j.dur > 0 ? Math.max(0, Math.min(1, j.at / j.dur)) : 0;
  // Remaining is only offered once there is something to base it on. An estimate made from
  // the first half-second says a number that will be wrong by a factor of ten, and a wrong
  // number is worse than none - people plan around it.
  const remain = (frac > 0.03 && elapsed > 1.5) ? Math.max(0, elapsed / frac - elapsed) : null;
  res.json({ success: true, status: j.status, url: j.url, error: j.error, rev: j.rev || null,
             at: Math.round(j.at * 10) / 10, dur: j.dur,
             percent: Math.round(frac * 100), remain: remain == null ? null : Math.round(remain),
             log: j.log.slice(-1200) });
});

module.exports = router;
