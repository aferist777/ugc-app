/* ════════════════════════════════════════════════════════════════════════════
   MERGE — is it worth trying again?

   Not the same question as "did it fail". A failure that would fail identically for as long as
   nothing is changed deserves no button: pressing it spends another minute to hear the same
   sentence twice, and a button that does that teaches people to distrust every other one.

   WORTH IT: the aggregator had no capacity, a gateway timed out, a connection broke, our own
   host could not be read. Those are about the weather, and the weather changes.

   NOT WORTH IT: the model refused the prompt or the picture, a field was wrong, a key is not
   valid, a required thing was missing. Those are about the request, and the request is what
   would have to change.

   The order matters: a refusal that mentions a timeout is still a refusal, so the never-list
   is consulted first.

   Used by Animate (animate.js). The pictures chat has no Retry of its own any more: a picture is
   sent by the server and Alerts tries it again (phase J).
   ════════════════════════════════════════════════════════════════════════════ */

const RETRYABLE = [
  /no available user account/i, /timeout/i, /timed out/i, /\b5\d\d\b/, /temporar/i,
  /capacity/i, /overload/i, /rate limit/i, /too many requests/i, /try again/i,
  /connection/i, /socket/i, /network/i, /download/i, /unreachable/i, /gateway/i,
  /internal error/i, /server error/i, /queue/i, /busy/i,
];

const NEVER = [
  /refus/i, /policy/i, /moderat/i, /safety/i, /invalid/i, /not supported/i,
  /unauthor/i, /forbidden/i, /api key/i, /required/i, /no such/i, /unknown engine/i,
];

/** @param reason the aggregator's own words, as they reached us. */
export function canRetry(reason) {
  const s = String(reason || '');
  if (NEVER.some(re => re.test(s))) return false;
  return RETRYABLE.some(re => re.test(s));
}
