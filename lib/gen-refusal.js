'use strict';

// ════════════════════════════════════════════════════════════════════════════
// WHAT KIND OF FAILURE IS IT? (phase V2; Animate's lists, public/js/merge-v3/retry.js at git b2a0962^, reworked)
//
//   fetch        the aggregator could not read OUR link to a reference - the one failure worth an automatic
//                second try, with the files uploaded again (the watcher does it, once)
//   moderation   the model or the platform said no to the CONTENT - a face, a word, the picture. The most common
//                failure of the video models (Seedance checks the video and the sound AFTER making them). A
//                retry would pay for the same "no", so the row is failed `refused`: Alerts offers no retry.
//   request      the request itself is wrong - a field, a missing key, credits. A plain failure: once the key is
//                added or the credits topped up, trying again is exactly right.
//   other        anything else - a plain failure.
//
// Checked in that order. Only patterns with evidence behind them are in `moderation` - a word like "refused"
// is NOT: our own messages use it ("kie.ai refused (code)", the fake model's "?fail").
// ════════════════════════════════════════════════════════════════════════════

const FETCH = /timeout while downloading|read timed out|connectionpool|failed to fetch|fetch failed|upload failed|download failed|could not (download|fetch)|unable to (download|fetch)|cannot (fetch|download|access)|image fetch failed|error downloading|connection aborted|remotedisconnected|remote end closed|invalid url|url is not accessible/i;

const MODERATION = [
  /sensitive/i,                                   // Seedance: "output video/audio sensitive", "InputImageSensitiveContentDetected"
  /flagged/i, /\bE005\b/,                          // Replicate's "flagged as sensitive (E005)"
  /SENSITIVE_WORD/,                                // Suno through kie
  /moderat/i, /\bnsfw\b/i, /respect_moderation/i,  // xAI's own moderation answer
  /content (security |risk )?(policy|control|filter)/i, /platform policy/i, /safety (check|filter|system)/i,
  /\b130[01]\b/,                                   // Kling: 1300 blocked by platform policy, 1301 content security policy
  // Google's image models through kie (V10.1, a workshop frame): "The image was filtered out because it violated
  // Google's Generative AI Prohibited Use policy. (400)"
  /prohibited use/i, /filtered out because it violated/i,
];

const REQUEST = /invalid|not supported|unsupported|unauthor|forbidden|api key|no key|required|no such|unknown (model|engine)|insufficient|credits|must be|exceed/i;

/** 'fetch' | 'moderation' | 'request' | 'other' for the aggregator's own words, as they reached us. */
function classify(reason) {
  const s = String(reason || '');
  if (!s) return 'other';
  if (FETCH.test(s)) return 'fetch';
  if (MODERATION.some(re => re.test(s))) return 'moderation';
  if (REQUEST.test(s)) return 'request';
  return 'other';
}

/** A refusal of the content: a retry would only pay for the same answer. */
const isRefusal = (reason) => classify(reason) === 'moderation';
const isFetch = (reason) => classify(reason) === 'fetch';

module.exports = { classify, isRefusal, isFetch, kindOf: classify };
