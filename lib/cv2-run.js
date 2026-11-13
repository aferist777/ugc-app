'use strict';

// ════════════════════════════════════════════════════════════════════════════
// WALKING A LADDER — Character v2's runner.
//
// A ladder is an ordered list of pairings; this walks it and stops at the first one
// that answers. That is the whole idea, and it is small on purpose:
// img-providers.submitImage() is ALREADY one attempt at one pairing with no opinions
// of its own; this is a loop around it.
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
//   Says what happened. Every step leaves a line - taken, skipped, or refused and why -
//   and when a ladder is exhausted its error names what each aggregator answered instead
//   of whichever error happened to be last, which is the one least likely to explain
//   anything.
//
// It does NOT retry a step, and it STOPS on no answer, as in the chats. A step that answered no started nothing, and the next one is asked. A step that
// gave no answer - a timeout, a reset, a 5xx, a 200 without a task number (`unsure`,
// lib/task-started.js) - may have started a task nobody will hear of, already paid for: asking
// the next aggregator would pay for the same picture twice. The walk ends there, and says so.
// `onAsk` hears of each create just before it costs money, so the caller can write that down
// first; `onStep` hears of each answered no, when the mark can be taken back.
// ════════════════════════════════════════════════════════════════════════════

const { submitImage, reasonOf, PROVIDER_LABELS } = require('./img-providers');
const L = require('./cv2-ladders');
const HEALTH = require('./keys-health');

/**
 * Walk an image ladder until something answers.
 *
 * @param {string} op                 create | reference | sheet
 * @param {object} o
 * @param {string} o.prompt
 * @param {string[]} [o.imageUrls]    empty for text-to-image
 * @param {string} [o.aspect]
 * @param {function} [o.onAsk]        called with the step's aggregator just before its create
 * @param {function} [o.onStep]       called after each failure that was an answer, with { label, error, next }
 * @param {string[]} [o.skip]         steps already tried ('kie.ai / nano-banana-2 4K', a step's
 *                                    label) - for the poll-time half of the sheet's cascade,
 *                                    where a task was accepted and only then failed, and the
 *                                    walk resumes at the step below the last of them. A bare
 *                                    aggregator ('kie.ai') skips every step of it.
 * @returns {Promise<object>} { taskId, provider, engine, quality, steps, tried }
 */
async function runImageLadder(op, o = {}) {
  const all = L.getLadder(op);
  // By STEP, not by aggregator: a sheet ladder can be two steps on kie.ai (nano-banana-2 4K, then gpt-image-2),
  // and skipping every step of an aggregator that had been asked would leave the second one never tried.
  const skipped = (o.skip || []).map(String);
  const stepsDone = new Set(skipped.filter(x => x.includes(' / ')));
  const aggsDone = new Set(skipped.filter(x => !x.includes(' / ')));
  let from = 0;
  all.forEach((s, i) => { if (stepsDone.has(stepLabel(s))) from = i + 1; });
  const ladder = all.filter((s, i) => i >= from && !stepsDone.has(stepLabel(s)) && !aggsDone.has(s.provider));
  if (!ladder.length) {
    throw new Error(skipped.length
      ? ('every step of the ' + op + ' ladder has already been tried')
      : ('no ladder for ' + op));
  }

  const urls = (Array.isArray(o.imageUrls) ? o.imageUrls : (o.imageUrls ? [o.imageUrls] : [])).filter(Boolean);
  const steps = [];
  let last = null;

  for (let i = 0; i < ladder.length; i++) {
    const s = ladder[i];
    const label = stepLabel(s);
    const t0 = Date.now();

    if (HEALTH.isDown(s.provider)) {
      const why = HEALTH.reasonFor(s.provider);
      steps.push({ n: i + 1, label, state: 'skipped', detail: why, ms: 0 });
      continue;
    }

    // The matrix speaks 'kie'; everything a human reads says 'kie.ai'. Translated at
    // the boundary rather than in the stored ladder, so what is saved reads the same
    // as what is shown.
    const agg = L.AGG_TO_MATRIX[s.provider] || s.provider;
    if (o.onAsk) { try { o.onAsk(s.provider); } catch (x) {} }
    try {
      const sub = await submitImage({
        engine: s.engine,
        provider: agg,
        prompt: o.prompt,
        imageUrls: urls,
        aspect: o.aspect,
        quality: s.quality,
      });
      steps.push({ n: i + 1, label, state: 'ok', detail: String(sub.taskId), ms: Date.now() - t0 });
      if (i > 0) console.log('[cv2-run]', op, 'landed on step', i + 1, '-', label);
      return { ...sub, provider: s.provider, steps, tried: steps.filter(x => x.state !== 'skipped').length };
    } catch (e) {
      last = e;
      const why = reasonOf(e);
      if (e && e.unsure) {
        steps.push({ n: i + 1, label, state: 'unsure', detail: String(why).slice(0, 200), ms: Date.now() - t0 });
        console.warn('[cv2-run]', op, label, 'gave no answer - the ladder stops:', String(why).slice(0, 160));
        const err = new Error(String(why) + ' - it may have been paid for and not followed; look at '
          + (PROVIDER_LABELS[agg] || s.provider) + '\'s own history before asking again');
        err.unsure = true;
        err.steps = steps;
        err.cause = e;
        throw err;
      }
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

  // Everything, not just the last one. "kie.ai refused, Replicate was skipped because
  // its key is dead" is two different next actions; the last line alone is neither.
  const said = steps.map(s => s.label + ': ' + (s.state === 'skipped' ? 'skipped, ' + s.detail : s.detail)).join(' | ');
  const err = new Error('every step of the ' + op + ' ladder failed - ' + said);
  err.steps = steps;
  err.cause = last;
  throw err;
}

/** A step as it is said and remembered: 'kie.ai / nano-banana-2 4K'. */
function stepLabel(s) {
  return s.provider + ' / ' + s.engine + (s.quality ? ' ' + s.quality : '');
}

module.exports = { runImageLadder, stepLabel };
