'use strict';

// ════════════════════════════════════════════════════════════════════════════
// HIGHLIGHTS - a long video into vertical shorts (lib/highlights-store.js, lib/highlights-job.js).
//
//   POST   /api/highlights                  { name? } -> { project, key }       a new project and its own timeline
//   GET    /api/highlights/offer            -> { lengths, counts, kinds }   what the popup offers, with no project
//   POST   /api/highlights/start            { name?, …as /:id/start } -> { alertId, key, id }   made AND started by the press
//   GET    /api/highlights/price            ?seconds=&source=&kind=&length=&audio=&count= -> { price }   what "find moments" is expected to cost
//   GET    /api/highlights/tracks           ?path= | ?source= -> { tracks, first }   the video's sound tracks
//   GET    /api/highlights/:id              -> { project, progress, stages, retry }   what the field draws (polled while at work)
//   POST   /api/highlights/:id/start        { from, url | path | sourceId, audio, kind, length, count, style, moods, title } -> { alertId }
//   POST   /api/highlights/:id/stop         the work let go of
//   POST   /api/highlights/:id/retry        the same as the row's retry in Alerts -> { alertId }
//   POST   /api/highlights/:id/fragments/:n/delete   hidden until the next start (Ctrl+Z brings it back)
//   POST   /api/highlights/:id/fragments/restore     { n? } -> { n } the last deleted (or n) back, 0 when none
//   POST   /api/highlights/:id/fragments/:n/title    { title } -> { title, timeline }
//   POST   /api/highlights/:id/style             { ns, preset } -> { n, name } one caption style on several made fragments
//                                                 or { ns, place: { pos, ty }, size: n | 'auto', wordsPerLine, lines } -> { n }
//   POST   /api/highlights/:id/title-on-top      { ns, on } -> { n }   the title on top on / off for several
//   POST   /api/highlights/:id/volume            { ns, lane: speech | music, volume } -> { n }   a lane's volume on several
//   POST   /api/highlights/:id/patterns          { ns, patterns } -> { n }   main video's patterns on several
//   POST   /api/highlights/:id/fx                { add: { <n>: { <clip id>: [effects] } } } | { ns, remove: <kind> } -> { n }
//                                                 clip effects on several fragments' main video
//   POST   /api/highlights/:id/music             { ns, moods | none, open } -> { n, open, missed }   their music dealt again / off
//   POST   /api/highlights/:id/fragments/:n/music  { how: another | <mood> | none, taken, open } -> { music, clips? }   one's music
//   POST   /api/highlights/:id/fragments/:n/title-on-top   the title on top added to a made fragment
//   POST   /api/highlights/:id/fragments/:n/title-on-top/remove   and taken off it
//   POST   /api/highlights/:id/render       { ns, adv } -> { queued, skipped }  the ticked rendered together
//   POST   /api/highlights/:id/render/stop  all of the project's renders stopped
// ════════════════════════════════════════════════════════════════════════════

const express = require('express');
const HL = require('../lib/highlights-store');
const JOB = require('../lib/highlights-job');
const YTDLP = require('../lib/ytdlp');
const ALERTS = require('../lib/alerts');
const MSTORE = require('../lib/merge-store');
const CUT = require('../lib/highlights-cut');
const RENDER = require('../lib/highlights-render');
const I18N = require('../lib/i18n');

const router = express.Router();

// When the server starts nothing is at work: a project left running was cut off by the app closing (lib/highlights-job.js).
JOB.boot();

// What the page is shown of a project: everything but the agent's whole answer, which is the server's business. `caps`
// each made fragment's caption style, read from its timeline - for the one project the field shows.
function view(rec, o) {
  if (!rec) return null;
  const { agent, ...rest } = rec;
  const a = agent ? { ...agent } : null;
  if (a) delete a.raw;
  // The video's poster - what a tile shows until its own first frame is made.
  const src = rec.video && rec.video.sourceId ? require('../lib/sources-store').get(rec.video.sourceId) : null;
  const out = { ...rest, agent: a, key: HL.homeKey(rec.id), ...offer(), poster: (src && src.thumbPath) || '' };
  // The kind as it is read: none is auto.
  if (rec.ask) out.ask = { ...rec.ask, kind: HL.kindOf(rec) };
  if (o && o.caps) {
    // And each one's render: its place in the queue (`rq`) and its file, when it has one (`rendered`).
    const rv = RENDER.viewOf(rec);
    // Every made fragment's timeline read at once (lib/merge-store.js many), not the store's index once each.
    const tls = MSTORE.many((rec.fragments || []).filter((f) => f.state === 'ready' && f.key).map((f) => f.key));
    out.fragments = (rec.fragments || []).map((f) => {
      const tl = f.state === 'ready' && f.key ? (tls.get(String(f.key)) || null) : null;
      const r = rv.byN[f.n] || {};
      // `lanes`: what the common settings of several show of each - its subtitles' place and shape, its sound lanes.
      return { ...f, ...(tl ? { cap: CUT.capOf(tl), lanes: CUT.lanesOf(tl) } : {}), rq: r.line || null, rendered: r.render || null };
    });
    out.rendering = rv.rendering;
    out.renderTrouble = { interrupted: rv.interrupted, failed: rv.failed };
  }
  return out;
}

// What the popup offers: the lengths, the counts and the kinds (fragmentation with its own lengths, no count).
function offer() {
  return { lengths: HL.LENGTHS, counts: HL.COUNTS,
    // each kind its count buttons, and whether it is in development (its button grey).
    kinds: Object.fromEntries(Object.entries(HL.KINDS).map(([k, v]) => [k, { label: v.label, counts: HL.countsOf(k),
      ...(v.inDev ? { inDev: true } : {}), ...(v.whole ? { whole: true, lengths: HL.lengthsOf(k) } : {}) }])) };
}

router.post('/highlights', (req, res) => {
  try {
    const rec = HL.create(String((req.body || {}).name || ''));
    res.json({ success: true, project: view(rec), key: HL.homeKey(rec.id) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// HOME'S QUICK START: the popup opens with no project (`offer`), and its
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
    audio: req.query.audio != null && req.query.audio !== '' ? Number(req.query.audio) : null, count: Number(req.query.count) || 0 }) }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// The sound tracks of a video - a file of this computer the app's window handed over (`path`), or
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
  if (!rec) return res.status(404).json({ success: false, error: I18N.t('no such highlights project') });
  // Whether "retry" has something to go on with, and whether it costs (the row's own answer - lib/alerts.js view).
  const row = rec.work && rec.work.alertId ? ALERTS.get(rec.work.alertId) : null;
  const rv = row && row.state === 'failed' && !JOB.live(rec.id) ? ALERTS.view(row) : null;
  // `stages`: the steps of its way as the record left them - the preparation panel of a run that stopped before
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
  if (!JOB.stop(req.params.id)) return res.status(409).json({ success: false, error: I18N.t('it is not at work') });
  res.json({ success: true });
});

// A fragment: deleted - hidden until the app starts again -, brought back (Ctrl+Z in the field: the last
// deleted, or one named), renamed (its card's name and its timeline's).
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

// One caption style on several made fragments at once - their timelines' subtitle lanes (lib/highlights-cut.js
// restyle); no undo for several.
router.post('/highlights/:id/style', (req, res) => {
  try {
    const rec = HL.get(req.params.id);
    if (!rec) return res.status(404).json({ success: false, error: I18N.t('no such highlights project') });
    const b = req.body || {};
    const ns = new Set((Array.isArray(b.ns) ? b.ns : []).map(Number).filter((n) => n > 0));
    const keys = (rec.fragments || []).filter((f) => ns.has(f.n) && !f.deletedAt && f.state === 'ready' && f.key).map((f) => f.key);
    if (!keys.length) return res.status(400).json({ success: false, error: I18N.t('none of these fragments is made') });
    // Animations alone (no preset): put on the lanes as they are, not cut again (CUT.reanimate).
    if (!b.preset && Array.isArray(b.anims)) {
      const a = CUT.reanimate(keys, b.anims);
      return res.json({ success: true, n: a.keys.length, name: a.name });
    }
    // Fonts alone: put on the lanes as they are, not cut again (CUT.refont; [] - the presets' own fonts again).
    if (!b.preset && Array.isArray(b.fonts)) {
      const a = CUT.refont(keys, b.fonts);
      return res.json({ success: true, n: a.keys.length });
    }
    // The place (held over presets), the size, the words in a line, the lines - on the lanes as they are. Two rows or one.
    if (!b.preset && (b.place || b.size != null || b.wordsPerLine != null || b.lines != null || b.rows != null)) {
      const a = CUT.relayout(keys, { place: b.place || null, size: b.size, wordsPerLine: b.wordsPerLine, lines: b.lines, rows: b.rows });
      return res.json({ success: true, n: a.keys.length });
    }
    // Several presets (`mix`, ids) and animations (`anims`, 'in|out' pairs) - each fragment its own deal of them.
    const out = CUT.restyle(keys, String(b.preset || ''), { mix: Array.isArray(b.mix) ? b.mix : undefined, anims: Array.isArray(b.anims) ? b.anims : undefined });
    res.json({ success: true, n: out.keys.length, name: out.name, preset: out.preset });
  } catch (e) { res.status(e.status || 500).json({ success: false, error: e.message }); }
});

// The made fragments of `ns` (numbers) - deleted ones and ones not made left out.
function _made(rec, ns) {
  const want = new Set((Array.isArray(ns) ? ns : []).map(Number).filter((n) => n > 0));
  return (rec.fragments || []).filter((f) => want.has(f.n) && !f.deletedAt && f.state === 'ready' && f.key);
}

// The title on top put on, or taken off, several made fragments at once - "title on top: on / off" of
// their common subtitle settings. The OPEN one is the page's (its own undo step), as with one fragment.
router.post('/highlights/:id/title-on-top', (req, res) => {
  try {
    const rec = HL.get(req.params.id);
    if (!rec) return res.status(404).json({ success: false, error: I18N.t('no such highlights project') });
    const b = req.body || {};
    const frags = _made(rec, b.ns);
    if (!frags.length) return res.status(400).json({ success: false, error: I18N.t('none of these fragments is made') });
    const TT = require('../public/js/captions/title.js');
    // All of them in one pass of the store.
    const texts = b.on ? new Map(frags.map((f) => [String(f.key), TT.topTitleOf(f, { whole: HL.isWhole(HL.kindOf(rec)), language: (rec.agent && rec.agent.language) || '' })])) : null;
    const n = CUT.titles(frags.map((f) => f.key), texts).length;
    res.json({ success: true, n });
  } catch (e) { res.status(e.status || 500).json({ success: false, error: e.message }); }
});

// A lane's volume on several made fragments - `lane` 'speech' (main audio) or 'music'; the
// OPEN one is the page's.
router.post('/highlights/:id/volume', (req, res) => {
  try {
    const rec = HL.get(req.params.id);
    if (!rec) return res.status(404).json({ success: false, error: I18N.t('no such highlights project') });
    const b = req.body || {};
    const frags = _made(rec, b.ns);
    if (!frags.length) return res.status(400).json({ success: false, error: I18N.t('none of these fragments is made') });
    const out = CUT.laneVolume(frags.map((f) => f.key), b.lane === 'music' ? 'music' : 'speech', b.volume);
    res.json({ success: true, n: out.keys.length });
  } catch (e) { res.status(e.status || 500).json({ success: false, error: e.message }); }
});

// Main video's patterns - the whole list, top layer first - on several made fragments; the OPEN
// one is the page's (its own undo step), as with the other common settings.
router.post('/highlights/:id/patterns', (req, res) => {
  try {
    const rec = HL.get(req.params.id);
    if (!rec) return res.status(404).json({ success: false, error: I18N.t('no such highlights project') });
    const b = req.body || {};
    const frags = _made(rec, b.ns);
    if (!frags.length) return res.status(400).json({ success: false, error: I18N.t('none of these fragments is made') });
    if (!Array.isArray(b.patterns)) return res.status(400).json({ success: false, error: I18N.t('which patterns?') });
    const out = CUT.setPatterns(frags.map((f) => f.key), b.patterns);
    res.json({ success: true, n: out.keys.length });
  } catch (e) { res.status(e.status || 500).json({ success: false, error: e.message }); }
});

// Clip effects on several made fragments' main video: `add` - the page's own effects
// for each fragment's clips (js/merge-v3/fx-ui.js laneEffects, the faces found there), or `remove` - a kind taken off all of `ns`. The
// OPEN one is the page's. Their copies baked in the background as after a save (lib/fx-bake.js want).
router.post('/highlights/:id/fx', (req, res) => {
  try {
    const rec = HL.get(req.params.id);
    if (!rec) return res.status(404).json({ success: false, error: I18N.t('no such highlights project') });
    const b = req.body || {};
    let out;
    if (b.remove) {
      const frags = _made(rec, b.ns);
      if (!frags.length) return res.status(400).json({ success: false, error: I18N.t('none of these fragments is made') });
      out = CUT.fxRemove(frags.map((f) => f.key), String(b.remove));
    } else {
      const add = b.add && typeof b.add === 'object' ? b.add : {};
      const frags = _made(rec, Object.keys(add));
      if (!frags.length) return res.status(400).json({ success: false, error: I18N.t('none of these fragments is made') });
      out = CUT.fxAdd(Object.fromEntries(frags.map((f) => [f.key, add[f.n] || add[String(f.n)] || {}])));
    }
    const FXB = require('../lib/fx-bake');
    for (const key of out.keys) { try { FXB.want(MSTORE.one(key), key); } catch (e) { /* baked when Export asks */ } }
    res.json({ success: true, n: out.keys.length });
  } catch (e) { res.status(e.status || 500).json({ success: false, error: e.message }); }
});

// MAIN VIDEO of several made fragments: `color` { key, value } and `zoom` true / false into every
// clip of it - the OPEN one is the page's, as above; or `framing` (lib/highlights-cut.js REFRAMES) - planned for all of them, the
// open one's frames handed back (`open` - its number) for the page to lay. -> { n, open?, missed, why }
router.post('/highlights/:id/video', async (req, res) => {
  try {
    const rec = HL.get(req.params.id);
    if (!rec) return res.status(404).json({ success: false, error: I18N.t('no such highlights project') });
    const b = req.body || {};
    const frags = _made(rec, b.ns);
    if (!frags.length) return res.status(400).json({ success: false, error: I18N.t('none of these fragments is made') });
    if (b.framing) {
      const openF = frags.find((f) => f.n === Number(b.open)) || null;
      const out = await CUT.reframe(frags.map((f) => f.key), String(b.framing), { openKey: openF ? openF.key : '' });
      return res.json({ success: true, n: out.keys.length + (out.open ? 1 : 0), open: out.open, missed: out.missed, why: out.why });
    }
    const out = CUT.videoLook(frags.map((f) => f.key), { color: b.color, zoom: b.zoom });
    res.json({ success: true, n: out.keys.length });
  } catch (e) { res.status(e.status || 500).json({ success: false, error: e.message }); }
});

// Main audio's pitch on several made fragments - `pitch` { st?, shift? }, the part given; the OPEN
// one is the page's.
router.post('/highlights/:id/pitch', (req, res) => {
  try {
    const rec = HL.get(req.params.id);
    if (!rec) return res.status(404).json({ success: false, error: I18N.t('no such highlights project') });
    const b = req.body || {};
    const frags = _made(rec, b.ns);
    if (!frags.length) return res.status(400).json({ success: false, error: I18N.t('none of these fragments is made') });
    const out = CUT.lanePitch(frags.map((f) => f.key), b.pitch);
    res.json({ success: true, n: out.keys.length });
  } catch (e) { res.status(e.status || 500).json({ success: false, error: e.message }); }
});

// The track a fragment's record keeps (as lib/highlights-job.js deals it), and its music written: on its timeline - or, for the OPEN
// one (`open`), handed back for the page to lay (one undo step; a server's write under an open timeline reads as another's edit).
const _trackOf = (t) => (t ? { id: t.id, title: t.title, path: t.path, dur: t.dur, mood: t.mood || '' } : null);
async function _music(rec, f, track, open, later) {
  const HLM = require('../lib/highlights-music');
  const tl = MSTORE.one(f.key);
  if (!tl) throw Object.assign(new Error(I18N.t('its timeline is not there')), { status: 409 });
  let clips = [];
  if (track) {
    clips = await HLM.clipsForMade(track, tl);
    if (!clips.length) throw Object.assign(new Error(I18N.t('"{title}" is not in Music any more', { title: track.title })), { status: 409 });
  }
  const laid = open ? CUT.bedClips(clips, CUT.filmEnd(tl)) : null;
  // `later` - a Map the clips wait in, written with the others' in one pass (POST /music).
  if (!open) { if (later) later.set(String(f.key), clips); else CUT.setMusic(f.key, clips); }
  return { track: _trackOf(track), laid };
}
function _keepMusic(id, results) {
  HL.apply(id, (r) => {
    for (const x of (r.fragments || [])) {
      const m = results.get(x.n);
      if (!m) continue;
      x.music = m.track;
      x.musicNote = '';
    }
  });
}

// ONE made fragment's music: `how` 'another' (of its mood), a mood id ('yours' - Music ->
// highlights' root) or 'none'; `taken` - the tracks the other ticked ones wear, not given while the mood has others; `open` - it is the
// open one: its clips come back for the page to lay. -> { music, clips? }
router.post('/highlights/:id/fragments/:n/music', async (req, res) => {
  try {
    const rec = HL.get(req.params.id);
    const f = rec && _made(rec, [Number(req.params.n)])[0];
    if (!f) return res.status(404).json({ success: false, error: I18N.t('no such made fragment') });
    const b = req.body || {};
    const how = String(b.how || 'another');
    let track = null;
    if (how !== 'none') {
      const HLM = require('../lib/highlights-music');
      track = HLM.pickOne(how, f.music || null, Array.isArray(b.taken) ? b.taken : [], (rec.ask && rec.ask.music) || []);
      if (!track) return res.status(409).json({ success: false, error: how === 'another' ? I18N.t('no other track in this mood') : I18N.t('no tracks in this mood') });
    }
    const m = await _music(rec, f, track, !!b.open);
    _keepMusic(rec.id, new Map([[f.n, m]]));
    res.json({ success: true, music: m.track, ...(m.laid ? { clips: m.laid } : {}) });
  } catch (e) { res.status(e.status || 500).json({ success: false, error: e.message }); }
});

// The music of several made fragments dealt again from `moods` (each its own track, none twice while there are
// tracks left - lib/highlights-music.js deal), or taken off (`none`). `open` - the number of the open one: its clips come back.
// -> { n, open: { n, clips } | null, missed }
router.post('/highlights/:id/music', async (req, res) => {
  try {
    const rec = HL.get(req.params.id);
    if (!rec) return res.status(404).json({ success: false, error: I18N.t('no such highlights project') });
    const b = req.body || {};
    const frags = _made(rec, b.ns);
    if (!frags.length) return res.status(400).json({ success: false, error: I18N.t('none of these fragments is made') });
    const HLM = require('../lib/highlights-music');
    let dealt = frags.map(() => null);
    if (!b.none) {
      const tracks = HLM.ofMoods(Array.isArray(b.moods) ? b.moods : []).tracks;
      if (!tracks.length) return res.status(400).json({ success: false, error: I18N.t('no tracks in these moods') });
      dealt = HLM.deal(tracks, frags.length);
      // "Dealt AGAIN": a fragment does not get back the track it wears while a swap with another gives both something new.
      const was = (k) => (frags[k].music && frags[k].music.id) || '';
      for (let k = 0; k < dealt.length; k++) {
        if (!dealt[k] || dealt[k].id !== was(k)) continue;
        const j = dealt.findIndex((d, i) => i !== k && d && d.id !== was(k) && dealt[k].id !== was(i));
        if (j >= 0) [dealt[k], dealt[j]] = [dealt[j], dealt[k]];
        else {
          const other = tracks.find((t) => t.id !== was(k) && !dealt.some((d) => d && d.id === t.id));
          if (other) dealt[k] = { ...other };
        }
      }
    }
    const results = new Map();
    const later = new Map();
    let open = null;
    let missed = 0;
    for (let k = 0; k < frags.length; k++) {
      const f = frags[k];
      const isOpen = Number(b.open) === f.n;
      try {
        const m = await _music(rec, f, dealt[k], isOpen, later);
        results.set(f.n, m);
        if (isOpen) open = { n: f.n, clips: m.laid || [] };
      } catch (e) { missed++; }
    }
    if (later.size) CUT.setMusics(later);
    _keepMusic(rec.id, results);
    res.json({ success: true, n: results.size, open, missed });
  } catch (e) { res.status(e.status || 500).json({ success: false, error: e.message }); }
});

// The title on top added to a made fragment (its card's "add title"): its headline in the video's
// language, or its English title when the agent gave none. The one that is OPEN gets it from the page instead.
router.post('/highlights/:id/fragments/:n/title-on-top', (req, res) => {
  try {
    const rec = HL.get(req.params.id);
    const f = rec && (rec.fragments || []).find((x) => x.n === Number(req.params.n) && !x.deletedAt);
    if (!f) return res.status(404).json({ success: false, error: I18N.t('no such fragment') });
    if (f.state !== 'ready' || !f.key) return res.status(409).json({ success: false, error: I18N.t('the fragment is not made yet') });
    // A part of fragmentation with its number, in the video's language ("Part 3 · ..." in its words).
    const text = require('../public/js/captions/title.js').topTitleOf(f, { whole: HL.isWhole(HL.kindOf(rec)), language: (rec.agent && rec.agent.language) || '' });
    if (!CUT.addTitle(f.key, text)) return res.status(409).json({ success: false, error: I18N.t('it has a title already, or two text lanes') });
    res.json({ success: true });
  } catch (e) { res.status(e.status || 500).json({ success: false, error: e.message }); }
});

// The title on top taken off a made fragment (the ✕ by "title on top" on its card). The one that
// is OPEN loses it on the page instead (its own undo step).
router.post('/highlights/:id/fragments/:n/title-on-top/remove', (req, res) => {
  try {
    const rec = HL.get(req.params.id);
    const f = rec && (rec.fragments || []).find((x) => x.n === Number(req.params.n) && !x.deletedAt);
    if (!f) return res.status(404).json({ success: false, error: I18N.t('no such fragment') });
    if (f.state !== 'ready' || !f.key) return res.status(409).json({ success: false, error: I18N.t('the fragment is not made yet') });
    if (!CUT.dropTitle(f.key)) return res.status(409).json({ success: false, error: I18N.t('it has no title on top') });
    res.json({ success: true });
  } catch (e) { res.status(e.status || 500).json({ success: false, error: e.message }); }
});

// The ticked fragments rendered together with one set of export settings - into the render queue, armed
// (lib/highlights-render.js); and all of the project's renders stopped.
router.post('/highlights/:id/render', (req, res) => {
  try {
    const b = req.body || {};
    res.json({ success: true, ...RENDER.render(req.params.id, b.ns, b.adv) });
  } catch (e) { res.status(e.status || 500).json({ success: false, error: e.message }); }
});
router.post('/highlights/:id/render/stop', (req, res) => {
  try {
    if (!HL.get(req.params.id)) return res.status(404).json({ success: false, error: I18N.t('no such highlights project') });
    res.json({ success: true, ...RENDER.stop(req.params.id) });
  } catch (e) { res.status(e.status || 500).json({ success: false, error: e.message }); }
});

router.post('/highlights/:id/retry', async (req, res) => {
  try { res.json({ success: true, alertId: await JOB.retry(req.params.id) }); }
  catch (e) { res.status(e.status || 500).json({ success: false, error: e.message }); }
});

module.exports = router;
