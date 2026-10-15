'use strict';

// ════════════════════════════════════════════════════════════════════════════
// A TALKING HEAD'S CAPTIONS, HEARD BY THEMSELVES (phase V30, block 1; the owner 2026-10-15, answer (с3): "Как только
// озвучка или клип легли, сервер сразу их слушает, и субтитры всегда полные без нажатий").
//
// The mirror (lib/frag-mirror.js) calls `kick` when a line got a sound it did not have - a read, a Seedance clip, a read at
// a new speed, a line put back. A Kling clip filed on the same read is that read's sound and calls nothing.
//
//   the wait   QUIET_MS of no new kick, and never while the project's script is being read (generate all): takes landing
//              one after another are heard in ONE job after the last of them
//   the job    lib/captions-job.js `auto`: the lines of the project no caption speaks for yet - all of them, not only the
//              new one, or a project without captions would get them for one line - heard in one request, laid in one
//              tick. Nothing without a subtitle lane (the person took it away: nothing is heard by itself)
//   who        the key decides (the owner's (с22)): Groq when there is one, this computer when not; the speech model is
//              never downloaded by itself - a run that needs it ends in words, with the lane's button to download it
//   busy       a job of the project already running (a press): asked again after it
//
// It spends without a press - cents: Groq bills at least ten seconds a request, a line is ≈ $0.0003, thirty ≈ a cent;
// on this computer nothing. Not an Alerts row: seconds, like a voice.
// ════════════════════════════════════════════════════════════════════════════

const MSTORE = require('./merge-store');

const QUIET_MS = 4000;                 // takes landing closer together than this are heard together
const AGAIN_MS = 3000;                 // a script being read, a job running: looked at again this much later

const _timers = new Map();             // project id -> timer

/** A line of this project has a new sound: hear what is not heard yet, a moment from now. */
function kick(projectId) {
  const id = String(projectId || '').trim();
  if (!id) return;
  _later(id, QUIET_MS);
}

/** Is something about to be heard for this project (a kick waiting)? */
function pending(projectId) {
  return _timers.has(String(projectId || ''));
}

function _later(id, ms) {
  clearTimeout(_timers.get(id));
  const t = setTimeout(() => _fire(id), ms);
  if (t.unref) t.unref();
  _timers.set(id, t);
}

function _fire(id) {
  _timers.delete(id);
  try {
    const SCEN = require('../routes/scen3');
    if (SCEN.readsRunning && SCEN.readsRunning(id)) return _later(id, AGAIN_MS);
    const JOB = require('./captions-job');
    const key = 'sv3_' + id;
    if (JOB.busy(key)) return _later(id, AGAIN_MS);
    const t = MSTORE.one(key);
    if (!t) return;
    const what = JOB.auto(key, t);
    if (what === 'busy') _later(id, AGAIN_MS);
  } catch (e) {
    console.warn('[captions-auto] ' + id + ':', e.message);
  }
}

module.exports = { kick, pending, QUIET_MS };
