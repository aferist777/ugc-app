'use strict';

// ════════════════════════════════════════════════════════════════════════════
// HIGHLIGHTS - a long video into vertical shorts (phase V33.1; lib/highlights-store.js, lib/highlights-job.js).
//
//   GET    /api/highlights                  -> { projects: [view] }
//   POST   /api/highlights                  { name? } -> { project, key }       a new project and its own timeline
//   GET    /api/highlights/offer            -> { lengths, counts, kinds }   (V63) what the popup offers, with no project
//   POST   /api/highlights/start            { name?, …as /:id/start } -> { alertId, key, id }   (V63) made AND started by the press
//   GET    /api/highlights/price            ?seconds=&source=&kind=&length=&audio= -> { price }   what "find moments" is expected to cost
//   GET    /api/highlights/tracks           ?path= | ?source= -> { tracks, first }   (V43) the video's sound tracks
//   GET    /api/highlights/:id              -> { project, progress, stages, retry }   what the field draws (polled while at work)
//   POST   /api/highlights/:id/start        { from, url | path | sourceId, length, count, style } -> { alertId }
//   POST   /api/highlights/:id/stop         the work let go of
//   POST   /api/highlights/:id/retry        the same as the row's retry in Alerts -> { alertId }
//   POST   /api/highlights/:id/fragments/:n/delete   hidden until the next start (Ctrl+Z brings it back)
//   POST   /api/highlights/:id/fragments/restore     { n? } -> { n } the last deleted (or n) back, 0 when none
//   POST   /api/highlights/:id/fragments/:n/title    { title } -> { title, timeline }
//   POST   /api/highlights/:id/style             { ns, preset } -> { n, name } one caption style on several made fragments
//   POST   /api/highlights/:id/fragments/:n/title-on-top   the title on top added to a made fragment
//   POST   /api/highlights/:id/render       { ns, adv } -> { queued, skipped }  the ticked rendered together (V33.4)
//   POST   /api/highlights/:id/render/stop  all of the project's renders stopped (V33.4, the owner's (х43))
// ════════════════════════════════════════════════════════════════════════════

const express = require('express');
const HL = require('../lib/highlights-store');
const JOB = require('../lib/highlights-job');
const YTDLP = require('../lib/ytdlp');
const ALERTS = require('../lib/alerts');
const MSTORE = require('../lib/merge-store');
const CUT = require('../lib/highlights-cut');
const RENDER = require('../lib/highlights-render');

const router = express.Router();

// When the server starts nothing is at work: a project left running was cut off by the app closing (lib/highlights-job.js).
JOB.boot();

// What the page is shown of a project: everything but the agent's whole answer, which is the server's business. `caps`
// (phase V33.3): each made fragment's caption style, read from its timeline - for the one project the field shows.
function view(rec, o) {
  if (!rec) return null;
  const { agent, ...rest } = rec;
  const a = agent ? { ...agent } : null;
  if (a) delete a.raw;
  // The video's poster - what a tile shows until its own first frame is made.
  const src = rec.video && rec.video.sourceId ? require('../lib/sources-store').get(rec.video.sourceId) : null;
  const out = { ...rest, agent: a, key: HL.homeKey(rec.id), ...offer(), poster: (src && src.thumbPath) || '' };
  // (phase V33.8, (ф2)) The kind as it is read now: an old `facts` is documentary.
  if (rec.ask) out.ask = { ...rec.ask, kind: HL.kindOf(rec) };
  if (o && o.caps) {
    // (phase V33.4) And each one's render: its place in the queue (`rq`) and its file, when it has one (`rendered`).
    const rv = RENDER.viewOf(rec);
    out.fragments = (rec.fragments || []).map((f) => {
      const tl = f.state === 'ready' && f.key ? MSTORE.one(f.key) : null;
      const r = rv.byN[f.n] || {};
      return { ...f, ...(tl ? { cap: CUT.capOf(tl) } : {}), rq: r.line || null, rendered: r.render || null };
    });
    out.rendering = rv.rendering;
    out.renderTrouble = { interrupted: rv.interrupted, failed: rv.failed };
  }
  return out;
}

// What the popup offers: the lengths, the counts and the kinds (fragmentation with its own lengths, no count).
function offer() {
  return { lengths: HL.LENGTHS, counts: HL.COUNTS,
    kinds: Object.fromEntries(Object.entries(HL.KINDS).map(([k, v]) => [k, { label: v.label, ...(v.whole ? { whole: true, lengths: HL.lengthsOf(k) } : {}) }])) };
}

router.get('/highlights', (_req, res) => {
  try { res.json({ success: true, projects: HL.list().map(view) }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/highlights', (req, res) => {
  try {
    const rec = HL.create(String((req.body || {}).name || ''));
    res.json({ success: true, project: view(rec), key: HL.homeKey(rec.id) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// (phase V63, P14, the owner 2026-10-30, (бс3), (бс8)) HOME'S QUICK START: the popup opens with no project (`offer`), and its
// "find moments" MAKES the project and starts it in one press - closed with ✕, nothing was made. A press refused before any
// money (no style, a bad link, a file gone) leaves no project behind.
router.get('/highlights/offer', (_req, res) => {
  try { res.json({ success: true, ...offer() }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/highlights/start', async (req, res) => {
  let rec = null;
  try {
    const b = req.body || {};
    if (b.from === 'link' && !(await YTDLP.find())) return res.status(501).json({ success: false, error: YTDLP.MISSING });
    rec = HL.create(String(b.name || ''));
    const out = JOB.start(rec.id, b);
    res.json({ success: true, ...out, key: HL.homeKey(rec.id), id: rec.id });
  } catch (e) {
    if (rec) { try { HL.remove(rec.id); } catch (err) { console.warn('[highlights/start] the project made for a refused press stays:', err.message); } }
    res.status(e.status || 500).json({ success: false, error: e.message, code: e.code || null });
  }
});

router.get('/highlights/price', (req, res) => {
  try { res.json({ success: true, price: JOB.price({ seconds: +req.query.seconds || 0, sourceId: String(req.query.source || ''),
    kind: String(req.query.kind || ''), length: String(req.query.length || ''),
    audio: req.query.audio != null && req.query.audio !== '' ? Number(req.query.audio) : null }) }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// (phase V43, the owner's (ё18)) The sound tracks of a video - a file of this computer the app's window handed over (`path`), or
// a source of the Library (`source`) - so the popup offers the choice when there is one. Only read.
//   GET /api/highlights/tracks ?path= | ?source= -> { tracks: [{ k, label, def }], first }
router.get('/highlights/tracks', async (req, res) => {
  try {
    const TR = require('../lib/audio-tracks');
    let abs = '';
    if (req.query.source) abs = require('../lib/sources-store').fileOf(require('../lib/sources-store').get(String(req.query.source))) || '';
    else {
      const p = String(req.query.path || '');
      if (p && require('path').isAbsolute(p) && require('fs').existsSync(p) && require('fs').statSync(p).isFile()) abs = p;
    }
    if (!abs) return res.json({ success: true, tracks: [], first: 0 });
    const tracks = await TR.tracksOf(abs);
    res.json({ success: true, tracks: tracks.map((t) => ({ k: t.k, label: TR.label(t), def: t.def })), first: TR.firstOf(tracks) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/highlights/:id', (req, res) => {
  const rec = HL.get(req.params.id);
  if (!rec) return res.status(404).json({ success: false, error: 'no such highlights project' });
  // Whether "retry" has something to go on with, and whether it costs (the row's own answer - lib/alerts.js view).
  const row = rec.work && rec.work.alertId ? ALERTS.get(rec.work.alertId) : null;
  const rv = row && row.state === 'failed' && !JOB.live(rec.id) ? ALERTS.view(row) : null;
  // (phase V40) `stages`: the steps of its way as the record left them - the preparation panel of a run that stopped before
  // its moments were found; while it is at work `progress.stages` says them.
  const live = JOB.live(rec.id);
  res.json({ success: true, project: view(rec, { caps: true }), progress: JOB.progress(rec.id), live,
    stages: live ? null : JOB.stagesOf(rec, null),
    retry: rv && rv.retryable ? JOB.plan(rec) : '', retryFree: !!(rv && rv.retryFree), refused: !!(row && row.refused) });
});

router.post('/highlights/:id/start', async (req, res) => {
  try {
    const b = req.body || {};
    if (b.from === 'link' && !(await YTDLP.find())) return res.status(501).json({ success: false, error: YTDLP.MISSING });
    res.json({ success: true, ...JOB.start(req.params.id, b) });
  } catch (e) { res.status(e.status || 500).json({ success: false, error: e.message, code: e.code || null }); }
});

router.post('/highlights/:id/stop', (req, res) => {
  if (!JOB.stop(req.params.id)) return res.status(409).json({ success: false, error: 'it is not at work' });
  res.json({ success: true });
});

// A fragment (block 3): deleted - hidden until the app starts again (х19а) -, brought back (Ctrl+Z in the field: the last
// deleted, or one named), renamed (х20: its card's name and its timeline's).
router.post('/highlights/:id/fragments/:n/delete', (req, res) => {
  try { res.json({ success: true, ...JOB.deleteFragment(req.params.id, req.params.n) }); }
  catch (e) { res.status(e.status || 500).json({ success: false, error: e.message }); }
});
router.post('/highlights/:id/fragments/restore', (req, res) => {
  try { res.json({ success: true, n: JOB.restoreFragment(req.params.id, Number((req.body || {}).n) || 0) }); }
  catch (e) { res.status(e.status || 500).json({ success: false, error: e.message }); }
});
router.post('/highlights/:id/fragments/:n/title', (req, res) => {
  try { res.json({ success: true, ...JOB.renameFragment(req.params.id, req.params.n, (req.body || {}).title) }); }
  catch (e) { res.status(e.status || 500).json({ success: false, error: e.message }); }
});

// (phase V33.3) One caption style on several made fragments at once - their timelines' subtitle lanes (lib/highlights-cut.js
// restyle); no undo for several (the owner's (х34)).
router.post('/highlights/:id/style', (req, res) => {
  try {
    const rec = HL.get(req.params.id);
    if (!rec) return res.status(404).json({ success: false, error: 'no such highlights project' });
    const b = req.body || {};
    const ns = new Set((Array.isArray(b.ns) ? b.ns : []).map(Number).filter((n) => n > 0));
    const keys = (rec.fragments || []).filter((f) => ns.has(f.n) && !f.deletedAt && f.state === 'ready' && f.key).map((f) => f.key);
    if (!keys.length) return res.status(400).json({ success: false, error: 'none of these fragments is made' });
    // (phase V49) Animations alone (no preset): put on the lanes as they are, not cut again (CUT.reanimate).
    if (!b.preset && Array.isArray(b.anims)) {
      const a = CUT.reanimate(keys, b.anims);
      return res.json({ success: true, n: a.keys.length, name: a.name });
    }
    // (phase V68 P4) Fonts alone: put on the lanes as they are, not cut again (CUT.refont; [] - the presets' own fonts again).
    if (!b.preset && Array.isArray(b.fonts)) {
      const a = CUT.refont(keys, b.fonts);
      return res.json({ success: true, n: a.keys.length });
    }
    // (phase V49) Several presets (`mix`, ids) and animations (`anims`, 'in|out' pairs) - each fragment its own deal of them.
    const out = CUT.restyle(keys, String(b.preset || ''), { mix: Array.isArray(b.mix) ? b.mix : undefined, anims: Array.isArray(b.anims) ? b.anims : undefined });
    res.json({ success: true, n: out.keys.length, name: out.name, preset: out.preset });
  } catch (e) { res.status(e.status || 500).json({ success: false, error: e.message }); }
});

// (phase V33.3) The title on top added to a made fragment (its card's "add title", the owner's (х35)): its headline in the video's
// language, or its English title when the agent gave none ((х36)). The one that is OPEN gets it from the page instead.
router.post('/highlights/:id/fragments/:n/title-on-top', (req, res) => {
  try {
    const rec = HL.get(req.params.id);
    const f = rec && (rec.fragments || []).find((x) => x.n === Number(req.params.n) && !x.deletedAt);
    if (!f) return res.status(404).json({ success: false, error: 'no such fragment' });
    if (f.state !== 'ready' || !f.key) return res.status(409).json({ success: false, error: 'the fragment is not made yet' });
    if (!CUT.addTitle(f.key, f.headline || f.title)) return res.status(409).json({ success: false, error: 'it has a title already, or two text lanes' });
    res.json({ success: true });
  } catch (e) { res.status(e.status || 500).json({ success: false, error: e.message }); }
});

// (phase V33.4) The ticked fragments rendered together with one set of export settings - into the render queue, armed
// (lib/highlights-render.js); and all of the project's renders stopped.
router.post('/highlights/:id/render', (req, res) => {
  try {
    const b = req.body || {};
    res.json({ success: true, ...RENDER.render(req.params.id, b.ns, b.adv) });
  } catch (e) { res.status(e.status || 500).json({ success: false, error: e.message }); }
});
router.post('/highlights/:id/render/stop', (req, res) => {
  try {
    if (!HL.get(req.params.id)) return res.status(404).json({ success: false, error: 'no such highlights project' });
    res.json({ success: true, ...RENDER.stop(req.params.id) });
  } catch (e) { res.status(e.status || 500).json({ success: false, error: e.message }); }
});

router.post('/highlights/:id/retry', async (req, res) => {
  try { res.json({ success: true, alertId: await JOB.retry(req.params.id) }); }
  catch (e) { res.status(e.status || 500).json({ success: false, error: e.message }); }
});

module.exports = router;
