'use strict';

// ════════════════════════════════════════════════════════════════════════════
// CAPTIONS FROM THE SOUND - the doors to lib/captions-job.js (phase K1) and to the recognition on this
// computer (lib/whisper-local.js, phase K1b).
//
//   POST /api/mv3/captions/transcribe { key, download? } -> { success, job }   the job starts and is
//                                                 answered at once; 409 with the running job, 400 with a
//                                                 `code` (no-key, no-build, no-sound, too-long) before
//                                                 anything is spent. `download: true` is the person saying
//                                                 yes to the speech model when the run falls over here
//   GET  /api/mv3/captions/state?key=           -> { success, job, last, lines }  the job of that project, or
//                                                 null and what was last laid (from its subs/ file); for a talking
//                                                 head `lines` - its lines with no caption and why (phase V30)
//
//   GET  /api/speech/local                      -> { success, state }  this computer's ear: the program,
//                                                 the model, the NVIDIA build - present, coming, failed.
//                                                 Starts nothing (the smoke check asks every GET)
//   POST /api/speech/local/download { what }    -> { success, state }  'model' | 'cuda', in the background
//   POST /api/speech/local/remove   { what }    -> { success, state }
//
//   GET  /api/mv3/captions/presets               -> { success, presets }   the person's own caption presets (phase V30,
//                                                 block 5; lib/caption-presets-store.js), newest first
//   POST /api/mv3/captions/presets { name, style } -> { success, preset, presets }   a new one; a taken name 409 (с45)
//   POST /api/mv3/captions/presets/rename { id, name } -> { success, preset, presets }
//   POST /api/mv3/captions/presets/delete { id } -> { success, presets }   at once (с47); projects keep their copy
//
// The sound is taken from the SAVED timeline - the page saves what it has before it presses - and the
// lines are laid on the timeline as it stands when they are ready, not as it stood at the press.
// ════════════════════════════════════════════════════════════════════════════

const express = require('express');
const router = express.Router();
const OWN = require('../lib/ownership');
const MSTORE = require('../lib/merge-store');
const JOB = require('../lib/captions-job');
const AUTO = require('../lib/captions-auto');
const GROQ = require('../lib/groq-stt');
const LOCAL = require('../lib/whisper-local');
const { KEY_RE } = require('../lib/subs-store');
const { HEARD } = require('../lib/mv3b-subs');
const TILES = require('../lib/caption-tiles');
const MINE = require('../lib/caption-presets-store');
const { CATEGORIES } = require('../public/js/captions/presets.js');
const { TEXT_CATEGORIES } = require('../public/js/captions/presets-text.js');

router.post('/mv3/captions/transcribe', (req, res) => {
  try {
    const key = String((req.body && req.body.key) || '');
    if (!KEY_RE.test(key)) return res.status(400).json({ success: false, error: 'A project key is needed.' });
    // The project asked for, never the newest one the way an open falls back to.
    const t = MSTORE.read().timelines[key];
    if (!t) return res.status(404).json({ success: false, error: 'No project "' + key + '".' });
    if (!OWN.canEdit(t, req.user)) return OWN.refuse(res, t);
    const lane = (Array.isArray(t.tracks) ? t.tracks : []).find((x) => x && x.kind === 'subs');
    const here = (HEARD.listenOf(lane) || {}).engine === 'local';
    // "Back to what was heard" (K2) asks nobody: neither the key nor the program is needed.
    const stored = !!(req.body && req.body.stored);
    if (!stored && here && !LOCAL.hasProgram()) {
      return res.status(400).json({ success: false, code: 'no-build', error: 'Speech recognition on this computer is not installed - the lane can listen through Groq.' });
    }
    // No key is no refusal while this computer can hear (phase K1b).
    if (!stored && !here && !GROQ.keyOf() && !LOCAL.hasProgram()) {
      return res.status(400).json({ success: false, code: 'no-key', error: 'No Groq API key - add it on Admin -> API keys.' });
    }
    if (JOB.busy(key)) return res.status(409).json({ success: false, code: 'busy', error: 'Already listening to this project.', job: JOB.get(key) });
    const ok = JOB.precheck(t);
    if (ok.code) return res.status(400).json({ success: false, code: ok.code, error: ok.error });
    res.json({ success: true, job: JOB.start(key, t, ok.pieces, { download: !stored && !!(req.body && req.body.download), stored }) });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/mv3/captions/state', (req, res) => {
  try {
    const key = String(req.query.key || '');
    // Asked with no project (the smoke check asks every route that way): nothing to say.
    if (!KEY_RE.test(key)) return res.json({ success: true, job: null, last: null, lines: null });
    const job = JOB.get(key);
    // (phase V30, block 1) A talking head's lines: how many lie with no caption, why nobody could hear them by itself, and
    // whether a hearing by itself is about to start (the page keeps asking while it is).
    let lines = JOB.linesState(key, MSTORE.one(key));
    if (lines) lines = { ...lines, pending: AUTO.pending(key.slice(4)) };
    // Always: "back to what was heard" shows by what the file says was laid, whatever the job in memory
    // did - a failed one used to hide it for fifteen minutes (review K2).
    res.json({ success: true, job, last: JOB.last(key), lines });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── The caption presets' tiles (phase K6a; lib/caption-tiles.js) ───────────
// The state only - no side effects, so the smoke check may ask it.
router.get('/mv3/captions/tiles', (req, res) => {
  try { res.json({ success: true, ...TILES.state() }); } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Make what is missing; `first` - a category to make first. Pressed again while making, it only reorders.
router.post('/mv3/captions/tiles/make', (req, res) => {
  try {
    const first = String((req.body && req.body.first) || '');
    res.json({ success: true, ...TILES.make(first === TILES.MINE_CAT || CATEGORIES.concat(TEXT_CATEGORIES).some((c) => c.id === first) ? first : null) });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── The person's own presets (phase V30, block 5; lib/caption-presets-store.js) ──
// A change is answered with the whole list, and the tiles hear of it: a new one's is made first, a deleted one's goes.
const _presetErr = (res, e) => res.status(e.status || 500).json({ success: false, error: e.message });

router.get('/mv3/captions/presets', (req, res) => {
  try { res.json({ success: true, presets: MINE.list() }); } catch (e) { _presetErr(res, e); }
});

router.post('/mv3/captions/presets', (req, res) => {
  try {
    const b = req.body || {};
    const preset = MINE.add(b.name, b.style, b.kind === 'text' ? 'text' : '');
    TILES.mineChanged();
    res.json({ success: true, preset, presets: MINE.list() });
  } catch (e) { _presetErr(res, e); }
});

router.post('/mv3/captions/presets/rename', (req, res) => {
  try {
    const b = req.body || {};
    const preset = MINE.rename(b.id, b.name);
    res.json({ success: true, preset, presets: MINE.list() });
  } catch (e) { _presetErr(res, e); }
});

router.post('/mv3/captions/presets/delete', (req, res) => {
  try {
    MINE.remove((req.body || {}).id);
    TILES.mineChanged();
    res.json({ success: true, presets: MINE.list() });
  } catch (e) { _presetErr(res, e); }
});

// ── This computer's ear (Admin -> This computer, and the subtitle lane) ─────
router.get('/speech/local', (req, res) => {
  try { res.json({ success: true, state: LOCAL.state() }); } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/speech/local/download', (req, res) => {
  const what = String((req.body && req.body.what) || '');
  if (!['model', 'cuda'].includes(what)) return res.status(400).json({ success: false, error: 'Download what? model or cuda.' });
  if (what === 'cuda' && !LOCAL.gpu()) return res.status(400).json({ success: false, error: 'This computer has no NVIDIA graphics card.' });
  // In the background: the state says how far it got, and why it stopped if it did.
  LOCAL.download(what).catch(() => { /* kept in the state's error */ });
  res.json({ success: true, state: LOCAL.state() });
});

router.post('/speech/local/remove', (req, res) => {
  try {
    LOCAL.remove(String((req.body && req.body.what) || ''));
    res.json({ success: true, state: LOCAL.state() });
  } catch (e) {
    res.status(e.code === 'busy' ? 409 : 400).json({ success: false, error: e.message, state: LOCAL.state() });
  }
});

module.exports = router;
