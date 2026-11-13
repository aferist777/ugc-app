'use strict';

// ════════════════════════════════════════════════════════════════════════════
// WAS THE TASK STARTED? - an aggregator's create that failed (the video chat, its storyboards and the pictures
// chat).
//
// An ANSWER that says no - a 4xx, kie's refusal inside a 200 - started nothing, and the next aggregator may be
// asked. NO ANSWER - a timeout, a reset connection, a 5xx from the aggregator's edge, a 200 without a task number -
// may have started a task nobody will hear of: neither kie.ai nor Replicate takes a key that makes asking twice
// safe, and the task's number was only in the answer that was lost. Such a failure is `unsure`, and a ladder stops
// on it rather than pay a second aggregator for the same thing. A request that provably never left this computer
// (no such host, refused, cancelled before it went) is not unsure, and neither is a failure before any request (a
// missing key).
// ════════════════════════════════════════════════════════════════════════════

const NEVER_LEFT = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ERR_INVALID_URL', 'ERR_BAD_OPTION_VALUE', 'ERR_BAD_OPTION', 'ERR_CANCELED']);

// What the aggregator said, out of whichever envelope it used - axios's own "Request failed with status code 422"
// names the status and nothing else (Replicate puts the field that was wrong in `detail`).
function said(d) {
  if (!d) return '';
  if (typeof d === 'string') return d.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
  const e = d.error;
  return String(d.detail || d.title || d.msg || d.message || (e && (e.message || (typeof e === 'string' ? e : ''))) || '').trim().slice(0, 300);
}

/**
 * The error of a create that failed, with `unsure` set: true when it may have started the task all the same.
 * One that already says (`unsure` true or false) passes through as it is.
 */
function notStarted(label, e) {
  if (e && typeof e.unsure === 'boolean') return e;
  // Not a request's: nothing went anywhere (a missing key, a bad argument).
  if (!(e && (e.isAxiosError || e.response || e.request))) {
    const err = (e instanceof Error) ? e : new Error(String(e || 'it failed'));
    err.unsure = false;
    return err;
  }
  const st = e.response && e.response.status;
  if (!st) {
    const left = !NEVER_LEFT.has(e.code);
    const err = new Error(label + (left ? ' did not answer whether it started it: ' : ' could not be reached: ') + (e.message || 'no answer'));
    err.unsure = left;
    return err;
  }
  const words = said(e.response && e.response.data);
  const err = new Error(label + (st >= 500 ? ' answered ' + st + ' - it may have started it all the same' : ' did not start it') + ': ' + (words || e.message || ('status ' + st)));
  err.unsure = st >= 500;
  err.status = st;
  return err;
}

module.exports = { NEVER_LEFT, said, notStarted };
