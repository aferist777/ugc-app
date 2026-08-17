'use strict';

// ════════════════════════════════════════════════════════════════════════════
// WALKING A LADDER — Character v2's runner.
//
// A ladder is an ordered list of pairings; this walks it and stops at the first one
// that answers. That is the whole idea, and it is small on purpose:
// img-providers.submitImage() is ALREADY one attempt at one pairing with no opinions
// of its own, so nothing there had to change. This is a loop around a function that
// existed before it did.
//
// Two things it does that a plain loop would not:
//
//   Steps over a dead key. If the health check has already proven an aggregator's key
//   is refused, its steps are skipped rather than tried. Not because trying would fail
//   - it would - but because failing takes a round trip each time, and a ladder of
//   three dead steps is three round trips before the first live one is reached. The
//   verdict is read from cache and never waited on: a runner that blocks on a health
//   probe has just added the latency it exists to avoid.
//
//   Writes down what happened. Every step leaves a line - taken, skipped, or refused
//   and why - and the whole run is kept. When a ladder is exhausted the page can say
//   what each aggregator answered instead of showing whichever error happened to be
//   last, which is the one least likely to explain anything.
//
// It does NOT retry a step. That belongs to the caller: the sheet already retries a
// 429 with a backoff, because "not now" and "no" are different answers, and putting
// that here would have every operation inherit a policy only one of them wants.
// ════════════════════════════════════════════════════════════════════════════

const { submitImage, reasonOf } = require('./img-providers');
const L = require('./cv2-ladders');
const HEALTH = require('./keys-health');
const TRACE = require('./cv2-trace');

// The last few runs, newest first. In memory on purpose: it is a debugging aid for the
// run you just did, not a record anyone should build on. A restart clears it, and that
// is the correct amount of permanence for "what did the engine say two minutes ago".
const LOG_MAX = 20;
const _log = [];

function _remember(entry) {
  _log.unshift(entry);
  if (_log.length > LOG_MAX) _log.length = LOG_MAX;
}

function recentRuns(op) {
  return op ? _log.filter(r => r.op === op) : _log.slice();
}

/**
 * Walk an image ladder until something answers.
 *
 * @param {string} op                 create | reference | sheet
 * @param {object} o
 * @param {string} o.prompt
 * @param {string[]} [o.imageUrls]    empty for text-to-image
 * @param {string} [o.aspect]
 * @param {function} [o.onStep]       called after each failure with { label, error, next }
 * @param {string[]} [o.skip]         aggregators already tried - for the poll-time half of
 *                                    the sheet's cascade, where a task was accepted and
 *                                    only then failed, and the walk resumes below it
 * @returns {Promise<object>} { taskId, provider, engine, quality, steps, tried }
 */
async function runImageLadder(op, o = {}) {
  const all = L.getLadder(op);
  const skip = new Set((o.skip || []).map(String));
  const ladder = all.filter(s => !skip.has(s.provider));
  if (!ladder.length) {
    throw new Error(skip.size
      ? ('every step of the ' + op + ' ladder has already been tried')
      : ('no ladder for ' + op));
  }

  const urls = (Array.isArray(o.imageUrls) ? o.imageUrls : (o.imageUrls ? [o.imageUrls] : [])).filter(Boolean);
  const started = Date.now();
  const steps = [];
  let last = null;

  for (let i = 0; i < ladder.length; i++) {
    const s = ladder[i];
    const label = s.provider + ' / ' + s.engine + (s.quality ? ' ' + s.quality : '');
    const t0 = Date.now();

    if (HEALTH.isDown(s.provider)) {
      const why = HEALTH.reasonFor(s.provider);
      steps.push({ n: i + 1, label, state: 'skipped', detail: why, ms: 0 });
      // Written into the trace by hand, because nothing else will: a step that is stepped
      // over makes no request, so the interceptor sees nothing and the log would show a
      // ladder that mysteriously started at step two.
      TRACE.note({ label: 'step ' + (i + 1) + ' - ' + label, state: 'skipped',
        detail: why, vendor: s.provider });
      continue;
    }

    try {
      // The matrix speaks 'kie'; everything a human reads says 'kie.ai'. Translated at
      // the boundary rather than in the stored ladder, so what is saved reads the same
      // as what is shown.
      const sub = await submitImage({
        engine: s.engine,
        provider: L.AGG_TO_MATRIX[s.provider] || s.provider,
        prompt: o.prompt,
        imageUrls: urls,
        aspect: o.aspect,
        quality: s.quality,
      });
      steps.push({ n: i + 1, label, state: 'ok', detail: String(sub.taskId), ms: Date.now() - t0 });
      _remember({ op, at: new Date(started).toISOString(), ms: Date.now() - started, ok: true, steps });
      if (i > 0) console.log('[cv2-run]', op, 'landed on step', i + 1, '-', label);
      return { ...sub, provider: s.provider, steps, tried: steps.filter(x => x.state !== 'skipped').length };
    } catch (e) {
      last = e;
      const why = reasonOf(e);
      steps.push({ n: i + 1, label, state: 'failed', detail: String(why).slice(0, 200), ms: Date.now() - t0 });
      console.warn('[cv2-run]', op, label, 'refused:', String(why).slice(0, 160));
      const next = ladder[i + 1];
      if (o.onStep) {
        try {
          await o.onStep({ label, error: why, next: next ? (next.provider + ' / ' + next.engine) : '' });
        } catch (x) {}
      }
    }
  }

  _remember({ op, at: new Date(started).toISOString(), ms: Date.now() - started, ok: false, steps });

  // Everything, not just the last one. "kie.ai refused, OpenRouter was skipped because
  // its key is dead, Replicate timed out" is three different next actions; the last
  // line alone is none of them.
  const said = steps.map(s => s.label + ': ' + (s.state === 'skipped' ? 'skipped, ' + s.detail : s.detail)).join(' | ');
  const err = new Error('every step of the ' + op + ' ladder failed - ' + said);
  err.steps = steps;
  err.cause = last;
  throw err;
}

module.exports = { runImageLadder, recentRuns, LOG_MAX };
