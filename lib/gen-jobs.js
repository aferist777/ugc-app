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
 *              }
 */
function register(type, def) {
  TYPES.set(String(type), def || {});
}

const knows = (type) => TYPES.has(String(type || ''));

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

  const state = out && out.state;
  if (state === 'success') {
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
    ALERTS.fail(rec.id, (out && out.error) || 'the generation failed');
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

/** Put the loop down. What is running stays running in the journal - `resume()` picks it up. */
function stop() {
  if (!_timer) return;
  clearInterval(_timer);
  _timer = null;
}

/** Whatever was running when the app was closed. Called once, after the routes have registered. */
function resume() {
  const running = ALERTS.list().filter(r => r.state === 'running' && r.job && r.job.type);
  if (!running.length) return 0;
  console.log(`[gen-jobs] ${running.length} generation(s) still running - waiting for them again`);
  wake();
  return running.length;
}

/** Try again, with the same request. The record keeps its place in the list and its way back. */
async function retry(id) {
  const rec = ALERTS.get(id);
  if (!rec) throw new Error('no such alert');
  if (rec.state === 'running') throw new Error('it is still running');
  const def = TYPES.get(rec.job && rec.job.type);
  if (!def || typeof def.submit !== 'function') throw new Error('this one cannot be started again');
  const sub = await def.submit((rec.job.params || {}).request || {}, rec);
  if (!sub || !sub.taskId) throw new Error('the engine did not accept the task');
  const next = ALERTS.restart(rec.id, {
    taskIds: [sub.taskId],
    job: { type: rec.job.type, params: { ...(rec.job.params || {}), file: sub.file || (rec.job.params || {}).file || {} } },
  });
  wake();
  return next;
}

module.exports = { register, knows, submitted, wake, stop, resume, retry, TICK_MS };
