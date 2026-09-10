'use strict';

// ════════════════════════════════════════════════════════════════════════════
// SIGNING IN WITH A PARTNER ACCOUNT — the crypto half.
//
// A person signed in to Partner opens this app and is simply inside it, as the same
// person, with no account of ours to make and no second password to remember. The shape of
// it is in docs/partner-sso.md; this file is the part that can be got wrong quietly, so
// it is on its own where it can be read in one sitting.
//
// WHY A REDIRECT AND NOT THEIR COOKIE. A cookie set for signin.example.com is
// never sent to app.example.com - browsers scope cookies to the host that set them.
// So the browser is sent to THEIR authorize endpoint, where their cookie is readable, and
// comes back to us carrying a token they signed. Signed in over there means straight in over
// here; not signed in means their sign-in page, and afterwards they land where they were
// going.
//
// WHAT THIS REFUSES, and each of these is a real attack rather than a formality:
//   - a bad signature, or one made with a different secret
//   - a token minted for another client (`aud`)
//   - one that has expired, or one whose life is longer than the ninety seconds agreed - a
//     token good for a week is a password in the browser history
//   - one already used (`jti`), so a token copied out of a history is worthless
//   - a return that does not match the `state` this browser was sent out with, which is what
//     stops a stranger dropping THEIR token into YOUR browser and quietly owning the session
//
// The secret lives in .env on the server (PARTNER_SSO_SECRET) and nowhere else. Never in the
// repository, never in the settings file the admin page can read back.
// ════════════════════════════════════════════════════════════════════════════

const crypto = require('crypto');

const AUD = 'ugc-app';
// The spec says at most 120 seconds and their side mints 90. Anything longer is refused
// whatever the token says about itself.
const MAX_LIFE_S = 150;
// Two clocks are never exactly together; a minute either way is generous and still useless
// to anybody holding an old token.
const SKEW_S = 60;

const secret = () => String(process.env.PARTNER_SSO_SECRET || '').trim();
const authorizeBase = () => String(process.env.PARTNER_SSO_AUTHORIZE_URL || 'https://signin.example.com/sso/authorize').trim();
const homeUrl = () => String(process.env.PARTNER_HOME_URL || 'https://signin.example.com/').trim();
// The address their side sends the browser back to. Deliberately WITHOUT a query of its own:
// they append `?sso=…&state=…`, and a return address that already had a question mark would
// leave them guessing whether to join with ? or &. Where the person was going is remembered
// in our own cookie instead.
const returnUrl = () => String(process.env.PARTNER_SSO_RETURN_URL || 'https://app.example.com/sso/partner/return').trim();

/** Is the integration switched on? No secret, no sign-in through them - the app falls back
 *  to its own password form, which is also what a fresh checkout does. */
const enabled = () => !!secret();

// ── base64url ───────────────────────────────────────────────────────────────
const b64uDecode = (s) => Buffer.from(String(s || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const b64uEncode = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function equal(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// ── used tokens ─────────────────────────────────────────────────────────────
// One process, one map: a jti is remembered until it would have expired anyway, so the store
// can never grow beyond a couple of minutes of sign-ins. A restart forgets them, and that is
// harmless - every token it could forget has expired by the time the process is up.
const _spent = new Map();     // jti -> when it stops mattering (ms)
function _spend(jti, expMs) {
  const now = Date.now();
  for (const [k, at] of _spent) if (at <= now) _spent.delete(k);
  if (_spent.has(jti)) return false;
  _spent.set(jti, expMs);
  return true;
}

/**
 * Reads one token and says who it is for, or throws with a reason worth logging.
 * Returns { sub, email, name, disabled, exp }.
 */
function verifyToken(token) {
  if (!enabled()) throw new Error('Partner sign-in is not configured');
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('malformed token');
  const [h64, p64, s64] = parts;

  let head;
  try { head = JSON.parse(b64uDecode(h64).toString('utf8')); } catch (e) { throw new Error('malformed header'); }
  if (!head || head.alg !== 'HS256') throw new Error('unexpected algorithm');

  const want = b64uEncode(crypto.createHmac('sha256', secret()).update(h64 + '.' + p64).digest());
  if (!equal(want, s64)) throw new Error('signature does not match');

  let p;
  try { p = JSON.parse(b64uDecode(p64).toString('utf8')); } catch (e) { throw new Error('malformed payload'); }
  if (!p || typeof p !== 'object') throw new Error('malformed payload');

  const aud = Array.isArray(p.aud) ? p.aud : [p.aud];
  if (!aud.includes(AUD)) throw new Error('token is for another client');

  const now = Math.floor(Date.now() / 1000);
  const iat = Number(p.iat), exp = Number(p.exp);
  if (!Number.isFinite(exp)) throw new Error('no expiry');
  if (exp < now - SKEW_S) throw new Error('token has expired');
  if (Number.isFinite(iat)) {
    if (iat > now + SKEW_S) throw new Error('token is from the future');
    if (exp - iat > MAX_LIFE_S) throw new Error('token lives too long');
  }

  const sub = String(p.sub || '').trim();
  if (!sub) throw new Error('no sub');
  const jti = String(p.jti || '').trim();
  if (!jti) throw new Error('no jti');
  if (!_spend(jti, exp * 1000 + SKEW_S * 1000)) throw new Error('token has already been used');

  return {
    sub,
    email: String(p.email || '').trim(),
    name: String(p.name || '').trim(),
    disabled: p.disabled === true,
    exp,
  };
}

/** A fresh `state`: 32 hex characters, as the spec asks for. */
const newState = () => crypto.randomBytes(16).toString('hex');

/** Where to send a browser that has no session of ours. */
function authorizeUrl(state) {
  const u = new URL(authorizeBase());
  u.searchParams.set('client', AUD);
  u.searchParams.set('redirect', returnUrl());
  u.searchParams.set('state', state);
  return u.toString();
}

/** Their call telling us an account was blocked or renamed, checked against the raw bytes -
 *  a signature over a re-serialised object is a signature over something else. */
function verifyWebhook(rawBody, signature) {
  if (!enabled()) throw new Error('Partner sign-in is not configured');
  const want = crypto.createHmac('sha256', secret()).update(rawBody).digest('hex');
  if (!equal(want, String(signature || '').trim().toLowerCase())) throw new Error('bad signature');
  let body;
  try { body = JSON.parse(rawBody.toString('utf8')); } catch (e) { throw new Error('body is not JSON'); }
  if (!body || !String(body.sub || '').trim()) throw new Error('no sub');
  return body;
}

module.exports = { enabled, verifyToken, verifyWebhook, authorizeUrl, newState, homeUrl, returnUrl, AUD };
