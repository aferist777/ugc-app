'use strict';

// ════════════════════════════════════════════════════════════════════════════
// GEN-JOBS — the server finishing what it started.
//
// A generation is asked for by a page, but it is NOT the page's job to see it through: pages are
// separate addresses, and a result the page was going to file is lost the moment somebody leaves
// it (docs/local-app/PLAN.md, "Alerts"). So the record in the journal (lib/alerts.js) carries a
// `job` - a type and the parameters that finishing needs - and this runner works through every
// running record with one:
//
//   poll   ask the provider whether it is done. A provider that does not answer is NOT a failure:
//          the next tick asks again, and only the type's own time limit ends it.
//   file   put the result where it belongs - on a shelf, under a character, into a project - and
//          answer with what the journal should show. A result that cannot be filed is a failure
//          with that said in it: the picture exists, but nothing points at it.
//
// Everything a job needs is in the record, on disk, so closing the app mid-generation loses
// nothing: `resume()` at boot hands the records their loops back. The types themselves are
// registered by the routes that submit the work (routes/scen3.js and the rest), because filing is
// their knowledge, not this file's.
//
// THE TIMER RUNS ONLY WHILE THERE IS WORK. It stops itself when the last running record is done,
// and any submit starts it again.
// ════════════════════════════════════════════════════════════════════════════

const ALERTS = require('./alerts');

const TICK_MS = 4000;
const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;

const TYPES = new Map();
const _busy = new Set();
let _timer = null;
let _quiet = new Set();                     // types complained about once, so a log is not a flood

/**
 * @param type  what the record's job.type says
 * @param def   { timeoutMs, poll(rec) -> {state:'pending'|'success'|'failed', error?, ...},
 *                file(rec, landed) -> { path, media, ... },
 *                submit(request, rec) -> { taskId, engine?, file? }   // for "try again"
 *                cancel(rec)                                         // let go of - optional
 *              }
 */
function register(type, def) {
  TYPES.set(String(type), def || {});
}

const knows = (type) => TYPES.has(String(type || ''));

// TYPES THE APP NO LONGER HAS (phase C4). A running row of one fails at the first tick with these words: left alone,
// as an unknown type is, it would stay running for ever - the bell's count, its "any moment now", a tick every 4 s.
// A failed one is not offered "try again" (lib/alerts.js view) - there is nothing left to run it.
const RETIRED = {
  animate: 'Animate was removed from the app - this clip was not fetched.',
};
const retired = (type) => Object.prototype.hasOwnProperty.call(RETIRED, String(type || ''));

async function _step(rec) {
  const def = TYPES.get(rec.job.type);
  const started = Date.parse(rec.startedAt) || Date.now();
  const limit = def.timeoutMs || DEFAULT_TIMEOUT_MS;
  const late = () => Date.now() - started > limit;

  let out = null;
  try {
    out = await def.poll(rec);
  } catch (e) {
    // The provider is unreachable or answered nonsense. Try again next tick; give up only when
    // the job has run out of time.
    if (late()) ALERTS.fail(rec.id, 'it did not come: ' + e.message);
    return;
  }

  // A job that MOVED. The sheet ladder hands a task that failed to the next aggregator and answers
  // with the new one; the row follows it, or it would go on waiting for a task nobody is running.
  if (out && out.taskId && out.taskId !== rec.taskIds[0]) {
    ALERTS.update(rec.id, { taskIds: [out.taskId] });
  }

  const state = out && out.state;
  if (state === 'success') {
    // LET GO OF WHILE THIS STEP WAS IN FLIGHT (N1): the picture is not downloaded and not filed.
    // `_tick` only ever picks up rows that are running, so this is the one place a cancelled row
    // can still be reached - between the ask and the answer.
    const now = ALERTS.get(rec.id);
    if (!now || now.state !== 'running') return;
    try {
      const result = await def.file(rec, out);
      ALERTS.finish(rec.id, result);
      console.log(`[gen-jobs] ${rec.job.type} done -> ${(result && result.path) || '(no path)'}`);
    } catch (e) {
      console.warn(`[gen-jobs] ${rec.job.type} could not be filed:`, e.message);
      ALERTS.fail(rec.id, 'it was made, but could not be filed: ' + e.message);
    }
    return;
  }
  if (state === 'failed') {
    // A type may say a failure is a refusal a retry would only repeat (lib/gen-refusal.js): no paid "try again".
    ALERTS.fail(rec.id, (out && out.error) || 'the generation failed', out && out.refused ? { refused: true } : undefined);
    return;
  }
  if (late()) ALERTS.fail(rec.id, `it did not come in ${Math.round(limit / 60000)} minutes`);
}

function _tick() {
  const running = ALERTS.list().filter(r => r.state === 'running' && r.job && r.job.type);
  if (!running.length) {
    clearInterval(_timer);
    _timer = null;
    return;
  }
  for (const rec of running) {
    if (_busy.has(rec.id)) continue;
    if (retired(rec.job.type)) { ALERTS.fail(rec.id, RETIRED[rec.job.type]); continue; }
    if (!knows(rec.job.type)) {
      // A record from a version that knew a type this one does not. Left alone rather than failed:
      // the module that owns it may simply not be loaded yet.
      if (!_quiet.has(rec.job.type)) {
        _quiet.add(rec.job.type);
        console.warn('[gen-jobs] nothing knows how to finish "' + rec.job.type + '" - leaving it be');
      }
      continue;
    }
    _busy.add(rec.id);
    _step(rec)
      .catch(e => console.warn('[gen-jobs]', rec.id, e.message))
      .then(() => _busy.delete(rec.id));
  }
}

/** Start the loop if it is not already going. Called by every submit, and at boot. */
function wake() {
  if (_timer) return;
  _timer = setInterval(_tick, TICK_MS);
  if (_timer.unref) _timer.unref();
  _tick();
}

/**
 * A generation has been submitted: write it into the journal and start waiting for it.
 * @param spec the alert (see lib/alerts.js start) - `job` is what this runner will use
 */
function submitted(spec) {
  const rec = ALERTS.start(spec);
  wake();
  return rec;
}

/** Whatever was running when the app was closed. Called once, after the routes have registered. */
function resume() {
  const running = ALERTS.list().filter(r => r.state === 'running' && r.job && r.job.type);
  if (!running.length) return 0;
  console.log(`[gen-jobs] ${running.length} generation(s) still running - waiting for them again`);
  wake();
  return running.length;
}

/** A row was let go of (the cross in Alerts, lib/alerts.js cancel). A type that holds state of its own
 *  - a character waiting for its sheet - is told, so it can stop waiting too. Never throws. */
function cancelled(rec) {
  const def = rec && rec.job && TYPES.get(rec.job.type);
  if (!def || typeof def.cancel !== 'function') return;
  try { def.cancel(rec); } catch (e) { console.warn('[gen-jobs] ' + rec.job.type + ' could not be let go of:', e.message); }
}

/** Try again, with the same request. The record keeps its place in the list and its way back. */
// ONE AT A TIME PER ROW: a submit can take a minute (a sheet uploads its face and has the body read
// before the ladder is asked), and the row reads 'failed' until it answers - a second press meanwhile
// would pay for a second generation and lose the first one's task.
const _retrying = new Set();
async function retry(id) {
  const rec = ALERTS.get(id);
  if (!rec) throw new Error('no such alert');
  if (rec.state === 'running') throw new Error('it is still running');
  // The agent turned it down (phase I): the same request would be turned down again, at a price.
  if (rec.refused) throw new Error('the agent turned this one down - ask for something else');
  if (_retrying.has(rec.id)) throw new Error('it is already being asked for again');
  const def = TYPES.get(rec.job && rec.job.type);
  if (!def || typeof def.submit !== 'function') throw new Error('this one cannot be started again');
  // The first asking is still going on (a chat's row let go of while its agent was still reading,
  // phase I): asked again now, the two would race for the row and one paid task would be lost.
  if (typeof def.busy === 'function' && def.busy(rec)) throw new Error('it is still being asked for - try again in a moment');
  _retrying.add(rec.id);
  let sub;
  try { sub = await def.submit((rec.job.params || {}).request || {}, rec); }
  finally { _retrying.delete(rec.id); }
  if (!sub || !sub.taskId) throw new Error('the engine did not accept the task');
  const next = ALERTS.restart(rec.id, {
    taskIds: [sub.taskId],
    // A type may hand back more than a task: asking for a picture again makes a new record of its
    // own, and the row has to point at that one from now on.
    job: {
      type: rec.job.type,
      params: {
        ...(rec.job.params || {}), ...(sub.params || {}),
        file: sub.file || (rec.job.params || {}).file || {},
      },
    },
  });
  wake();
  return next;
}

module.exports = { register, knows, retired, submitted, wake, resume, retry, cancelled, TICK_MS };
