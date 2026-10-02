'use strict';

// ════════════════════════════════════════════════════════════════════════════
// CAPTIONS FROM THE SOUND - the two doors to lib/captions-job.js (phase K1, 2026-10-03).
//
//   POST /api/mv3/captions/transcribe { key }  -> { success, job }      the job starts and is answered
//                                                 at once; 409 with the running job, 400 with a `code`
//                                                 (no-key, no-sound, too-long) before anything is spent
//   GET  /api/mv3/captions/state?key=           -> { success, job, last }  the job of that project, or
//                                                 null and what was last laid (from its subs/ file)
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
const { KEY_RE } = require('../lib/subs-store');

router.post('/mv3/captions/transcribe', (req, res) => {
  try {
    const key = String((req.body && req.body.key) || '');
    if (!KEY_RE.test(key)) return res.status(400).json({ success: false, error: 'A project key is needed.' });
    // The project asked for, never the newest one the way an open falls back to.
    const t = MSTORE.read().timelines[key];
    if (!t) return res.status(404).json({ success: false, error: 'No project "' + key + '".' });
    if (!OWN.canEdit(t, req.user)) return OWN.refuse(res, t);
    if (!GROQ.keyOf()) return res.status(400).json({ success: false, code: 'no-key', error: 'No Groq API key - add it on Admin -> API keys.' });
    if (JOB.busy(key)) return res.status(409).json({ success: false, code: 'busy', error: 'Already listening to this project.', job: JOB.get(key) });
    const ok = JOB.precheck(t);
    if (ok.code) return res.status(400).json({ success: false, code: ok.code, error: ok.error });
    res.json({ success: true, job: JOB.start(key, t, ok.pieces) });
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

module.exports = router;
