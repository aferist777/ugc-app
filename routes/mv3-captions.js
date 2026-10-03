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
//   GET  /api/mv3/captions/state?key=           -> { success, job, last }  the job of that project, or
//                                                 null and what was last laid (from its subs/ file)
//
//   GET  /api/speech/local                      -> { success, state }  this computer's ear: the program,
//                                                 the model, the NVIDIA build - present, coming, failed.
//                                                 Starts nothing (the smoke check asks every GET)
//   POST /api/speech/local/download { what }    -> { success, state }  'model' | 'cuda', in the background
//   POST /api/speech/local/remove   { what }    -> { success, state }
//
// The sound is taken from the SAVED timeline - the page saves what it has before it presses - and the
// lines are laid on the timeline as it stands when they are ready, not as it stood at the press.
// ════════════════════════════════════════════════════════════════════════════

const express = require('express');
const router = express.Router();
const OWN = require('../lib/ownership');
const MSTORE = require('../lib/merge-store');
const JOB = require('../lib/captions-job');
const GROQ = require('../lib/groq-stt');
const LOCAL = require('../lib/whisper-local');
const { KEY_RE } = require('../lib/subs-store');
const { HEARD } = require('../lib/mv3b-subs');

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
    if (here && !LOCAL.hasProgram()) {
      return res.status(400).json({ success: false, code: 'no-build', error: 'Speech recognition on this computer is not installed - the lane can listen through Groq.' });
    }
    // No key is no refusal while this computer can hear (phase K1b).
    if (!here && !GROQ.keyOf() && !LOCAL.hasProgram()) {
      return res.status(400).json({ success: false, code: 'no-key', error: 'No Groq API key - add it on Admin -> API keys.' });
    }
    if (JOB.busy(key)) return res.status(409).json({ success: false, code: 'busy', error: 'Already listening to this project.', job: JOB.get(key) });
    const ok = JOB.precheck(t);
    if (ok.code) return res.status(400).json({ success: false, code: ok.code, error: ok.error });
    res.json({ success: true, job: JOB.start(key, t, ok.pieces, { download: !!(req.body && req.body.download) }) });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/mv3/captions/state', (req, res) => {
  try {
    const key = String(req.query.key || '');
    // Asked with no project (the smoke check asks every route that way): nothing to say.
    if (!KEY_RE.test(key)) return res.json({ success: true, job: null, last: null });
    const job = JOB.get(key);
    res.json({ success: true, job, last: job ? null : JOB.last(key) });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
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
