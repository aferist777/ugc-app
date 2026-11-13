'use strict';

// FINISHING WHAT THE PAGE STARTED, WHETHER OR NOT IT IS STILL THERE.
//
// A generation collected only by the BROWSER - the page polling the task until the picture lands -
// stops when the tab closes: the aggregator finishes, and the file is never fetched.
//
// A watcher is the same loop, on the side that does not close. It starts when the task
// is created and runs to a result: on success resolveTask downloads the file.
//
// The page keeps polling, and that is deliberate. Its poll costs little: the
// status route reads this watcher's answer instead of asking the aggregator again. So an open
// page makes one set of aggregator calls rather than two, and a closed one still finishes.
//
// In memory, not on disk. A watcher is a live loop and cannot survive a restart anyway - the
// Alerts row of the portrait (lib/gen-jobs.js) is what does.

const { resolveTask } = require('./helpers');

const EVERY_MS = 2500;
// Longer than the page's own four minutes on purpose: the page gives up early because a person
// is staring at it. Nobody is staring at this one, and a sheet at 4K can genuinely take ten.
const LIMIT_MS = 12 * 60 * 1000;
// Results outlive the watcher so a page that reloads mid-generation still finds the answer
// waiting rather than starting the aggregator conversation over.
const KEEP_MS = 30 * 60 * 1000;

const _w = new Map();       // taskId -> { state, imagePath, error, at, started, dir, prefix }

function _now() { return Date.now(); }

function _sweep() {
  const cut = _now() - KEEP_MS;
  for (const [id, r] of _w) {
    if (r.state !== 'pending' && r.at < cut) _w.delete(id);
  }
}

/**
 * Start watching a task. Safe to call twice for the same id - the second call is a no-op,
 * which matters because a retry can hand back an id already being watched.
 */
function watch(taskId, destDir, prefix) {
  if (!taskId || _w.has(taskId)) return;
  const rec = { state: 'pending', imagePath: '', error: '', at: _now(), started: _now() };
  _w.set(taskId, rec);
  _sweep();

  (async () => {
    while (_now() - rec.started < LIMIT_MS) {
      await new Promise(r => setTimeout(r, EVERY_MS));
      let out;
      try {
        out = await resolveTask(taskId, destDir, prefix);
      } catch (e) {
        // A refused poll is not a refused generation - the network hiccups, kie rate-limits.
        // Keep going until the deadline rather than declaring a live task dead.
        rec.at = _now();
        continue;
      }
      if (out && out.state === 'success') {
        rec.state = 'success'; rec.imagePath = out.imagePath || ''; rec.at = _now();
        console.log('[cv2-watch] finished', String(taskId).slice(0, 40), '->', rec.imagePath);
        return;
      }
      if (out && out.state === 'failed') {
        rec.state = 'failed'; rec.error = out.error || 'the generation failed'; rec.at = _now();
        console.log('[cv2-watch] failed', String(taskId).slice(0, 40), '-', rec.error);
        return;
      }
      rec.at = _now();
    }
    // Given up here, but NOT marked failed: the task may still be alive at the aggregator, and
    // its Alerts row goes on waiting for it. Saying "failed" would drop a picture that was on its way.
    rec.state = 'gaveup';
    rec.error = 'still unfinished after ' + Math.round(LIMIT_MS / 60000) + ' minutes';
    rec.at = _now();
    console.log('[cv2-watch] gave up on', String(taskId).slice(0, 40), '- its Alerts row waits on');
  })().catch(e => {
    rec.state = 'pending';
    console.warn('[cv2-watch] watcher crashed for', String(taskId).slice(0, 40), '-', e.message);
  });
}

// What the watcher knows, without asking anyone. null means "not watched here" - the caller
// should fall back to polling the aggregator itself.
function peek(taskId) {
  const r = _w.get(taskId);
  if (!r) return null;
  if (r.state === 'success') return { state: 'success', imagePath: r.imagePath };
  if (r.state === 'failed') return { state: 'failed', error: r.error };
  // 'gaveup' is reported as pending: the page should keep waiting or come back to it, and
  // recovery will collect the file if it ever arrives.
  return { state: 'pending' };
}

module.exports = { watch, peek, EVERY_MS, LIMIT_MS };
