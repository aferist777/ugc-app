'use strict';

// access-gate.js — a login in front of the whole app, one person per session.
//
// This used to be a single shared password. It is now a login and a password per person, checked
// against lib/users.js, and the session cookie names WHO is signed in rather than merely that
// somebody is. Every request re-reads that person's record, so a user the admin disables is out
// on their next click, not at the end of their session.
//
// Model: no server-side session store (one PM2 process, keep it stateless). The cookie is
// `<payload>.<hmac>`, payload = {uid, exp}. The HMAC secret is APP_SECRET from .env, or - when
// that is not set - a random one written once to data/.session-secret and reused from then on,
// so a restart does not sign everyone out and nobody has to invent a secret by hand.
//
// Config (.env):
//   APP_SECRET     optional explicit HMAC secret; generated and persisted if absent.
//   SESSION_HOURS  session lifetime in hours (default 6).
//   COOKIE_SECURE  set to "1" only when the app is served over HTTPS (adds the Secure flag).
//
// THE SERVER TALKING TO ITSELF. The render queue (routes/mv3q.js) hands scenario entries to
// the ffmpeg route over HTTP on the same port, on purpose, and has no browser and no cookie.
// It carries an internal token instead - derived from the session secret, never sent to a
// browser - and the gate takes it only from the loopback address, so nothing outside this
// machine can present it. Requests in that shape run as a fixed system identity.
//
// NOTE: served over plain HTTP the password and cookie travel in cleartext. Put the app behind
// HTTPS (a reverse proxy) for real protection; this gate stops the open-internet scraping that
// leaked the keys once, it is not a substitute for TLS.

const crypto  = require('crypto');
const fs      = require('fs');
const path    = require('path');
const express = require('express');
const users   = require('./users');
// Sign-in and sign-out are the one kind of event the request middleware cannot see: there is
// no session yet, or none any more. They are written from here.
const audit = require('./audit');
// Signing in with a Partner account, when a secret for it is configured. Everything the
// signature and the replay guard do is in there; this file only wires it to the door.
const MP = require('./mp-sso');
const { DATA_DIR } = require('./config');

const COOKIE = 'ugc_sess';
const SECRET_FILE = path.join(DATA_DIR, '.session-secret');

function ttlMs() {
  const h = Number(process.env.SESSION_HOURS);
  return (Number.isFinite(h) && h > 0 ? h : 6) * 60 * 60 * 1000;
}

let _secret = null;
function secret() {
  if (_secret) return _secret;
  if (process.env.APP_SECRET) return (_secret = String(process.env.APP_SECRET));
  try { _secret = fs.readFileSync(SECRET_FILE, 'utf8').trim(); } catch { _secret = ''; }
  if (!_secret) {
    _secret = crypto.randomBytes(32).toString('hex');
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SECRET_FILE, _secret, { encoding: 'utf8', mode: 0o600 });
  }
  return _secret;
}

// Constant-time compare that never throws on a length mismatch (timingSafeEqual does).
function safeEqual(a, b) {
  const ba = Buffer.from(String(a), 'utf8');
  const bb = Buffer.from(String(b), 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// ── The internal token (see the header) ─────────────────────────────────────
const INTERNAL_USER = Object.freeze({
  id: 'system', login: 'system', nickname: 'render queue', role: 'system',
  mustChange: false, disabled: false, createdAt: null, lastSeenAt: null,
});
function internalToken() {
  return crypto.createHmac('sha256', secret()).update('internal:render-queue').digest('hex');
}
function isInternal(req) {
  const t = req.headers['x-internal-token'];
  if (!t) return false;
  const ip = String((req.socket && req.socket.remoteAddress) || '');
  const loopback = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  return loopback && safeEqual(String(t), internalToken());
}

function sign(payloadB64) {
  return crypto.createHmac('sha256', secret()).update(payloadB64).digest('base64url');
}

function makeToken(uid) {
  const payload = Buffer.from(JSON.stringify({ uid, exp: Date.now() + ttlMs() })).toString('base64url');
  return payload + '.' + sign(payload);
}

/** The uid inside a valid, unexpired token; null otherwise. */
function verifyToken(tok) {
  if (!tok || typeof tok !== 'string') return null;
  const dot = tok.indexOf('.');
  if (dot < 0) return null;
  const payload = tok.slice(0, dot);
  const sig     = tok.slice(dot + 1);
  if (!payload || !sig) return null;
  if (!safeEqual(sig, sign(payload))) return null;
  let obj;
  try { obj = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { return null; }
  if (!obj || typeof obj.exp !== 'number' || Date.now() >= obj.exp) return null;
  return typeof obj.uid === 'string' ? obj.uid : null;
}

function getCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return part.slice(i + 1).trim(); }
    }
  }
  return '';
}

// ── the round trip through Partner ─────────────────────────────────────
// A browser with no session of ours is sent to their authorize endpoint and comes back with
// a token. Two things have to survive that trip: a random `state`, so we can tell our own
// round trip from a stranger's, and where the person was actually going. Both ride in one
// short-lived cookie of ours rather than in the return address, which is kept bare on
// purpose - their side appends `?sso=…&state=…` to it, and a return address with a query
// already on it is the classic place these integrations break.
//
// SameSite=Lax and not Strict: the return IS a top-level navigation from their host, and
// Strict would withhold the cookie exactly then, which would refuse every sign-in.
const SSO_COOKIE = 'mp_sso';
function setSsoCookie(res, state, next) {
  const v = state + '.' + Buffer.from(String(next || '/'), 'utf8').toString('base64url');
  const attrs = [`${SSO_COOKIE}=${v}`, 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=600'];
  if (process.env.COOKIE_SECURE === '1') attrs.push('Secure');
  res.append('Set-Cookie', attrs.join('; '));
}
function readSsoCookie(req) {
  const raw = getCookie(req, SSO_COOKIE);
  const i = String(raw || '').indexOf('.');
  if (i < 0) return { state: '', next: '/' };
  let next = '/';
  try { next = Buffer.from(raw.slice(i + 1), 'base64url').toString('utf8'); } catch (e) {}
  return { state: raw.slice(0, i), next };
}
function clearSsoCookie(res) {
  res.append('Set-Cookie', `${SSO_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

function setSessionCookie(res, uid) {
  const attrs = [
    `${COOKIE}=${makeToken(uid)}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${Math.floor(ttlMs() / 1000)}`,
  ];
  if (process.env.COOKIE_SECURE === '1') attrs.push('Secure');
  res.append('Set-Cookie', attrs.join('; '));
}

function clearSessionCookie(res) {
  res.append('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

// Only same-origin absolute paths are honoured as a post-login destination — never a
// scheme/host (that would be an open redirect) and never a protocol-relative //host.
function safeNext(n) {
  return (typeof n === 'string' && n.startsWith('/') && !n.startsWith('//')) ? n : '/';
}

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ── the two pages ───────────────────────────────────────────────────────────
// Rendered here rather than served from public/, because they must work before anything in
// public/ is reachable. Same dark shell as the app so the door looks like the house.
const STYLE = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:grid; place-items:center;
         background:#0b0d12; color:#e7e9ee;
         font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif; }
  .card { width:min(92vw,360px); background:#151922; border:1px solid #232937;
          border-radius:14px; padding:26px 24px; box-shadow:0 12px 40px rgba(0,0,0,.45); }
  h1 { margin:0 0 4px; font-size:17px; font-weight:600; }
  p.sub { margin:0 0 18px; color:#8b93a7; font-size:13px; }
  label { display:block; font-size:12px; color:#8b93a7; margin:12px 0 6px; }
  label:first-of-type { margin-top:0; }
  input { width:100%; padding:11px 12px; border-radius:9px; border:1px solid #2b3242;
          background:#0e1119; color:#e7e9ee; font-size:15px; outline:none; }
  input:focus { border-color:#3b82f6; }
  button { width:100%; margin-top:16px; padding:11px; border:0; border-radius:9px;
           background:#3b82f6; color:#fff; font-size:15px; font-weight:600; cursor:pointer; }
  button:hover { background:#2f6fe0; }
  .err { color:#f87171; font-size:13px; margin:0 0 12px; }
  .foot { margin-top:14px; color:#5c6478; font-size:11px; text-align:center; }
  .foot a { color:#8b93a7; }
`;

function loginPageHtml(next, error) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in · UGC Studio</title><style>${STYLE}</style></head>
<body>
  <form class="card" method="POST" action="/login">
    <h1>UGC Studio</h1>
    <p class="sub">Sign in to continue.</p>
    ${error ? `<p class="err">${esc(error)}</p>` : ''}
    <input type="hidden" name="next" value="${esc(next || '/')}">
    <label for="lg">Login</label>
    <input id="lg" name="login" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" autofocus>
    <label for="pw">Password</label>
    <input id="pw" name="password" type="password" autocomplete="current-password">
    <button type="submit">Sign in</button>
    <div class="foot">Session lasts ${Math.round(ttlMs() / 3600000)}h, then asks again.</div>
  </form>
</body></html>`;
}

// The same page serves two moments: the first sign-in, where the person is invited to replace
// the login and password the admin handed them; and any later visit to /account, where they
// may change either at will. Both fields are optional - a blank one means "keep it".
function accountPageHtml(user, next, first, error) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Your account · UGC Studio</title><style>${STYLE}</style></head>
<body>
  <form class="card" method="POST" action="/account" autocomplete="off">
    <h1>${first ? 'Welcome, ' + esc(user.nickname) : 'Your account'}</h1>
    <p class="sub">${first
      ? 'You were let in with a login and password somebody else chose. Make them your own - or keep them for now.'
      : 'Change your login or password. Leave a field blank to keep it.'}</p>
    ${error ? `<p class="err">${esc(error)}</p>` : ''}
    <input type="hidden" name="next" value="${esc(next || '/')}">
    <input type="hidden" name="first" value="${first ? '1' : ''}">
    <label for="lg">Login</label>
    <input id="lg" name="login" type="text" value="${esc(user.login)}" autocomplete="username" autocapitalize="none" spellcheck="false" autofocus onfocus="this.select()">
    <label for="pw">New password</label>
    <input id="pw" name="password" type="password" autocomplete="new-password" placeholder="at least 8 characters">
    <label for="pw2">Repeat it</label>
    <input id="pw2" name="password2" type="password" autocomplete="new-password">
    <button type="submit">Save</button>
    <div class="foot">${first
      ? `<a href="${esc(safeNext(next))}">Keep them for now</a> · you can change them later at /account`
      : `<a href="${esc(safeNext(next))}">Back</a> · <a href="/logout">Sign out</a>`}</div>
  </form>
  <script>
    // The current login arrives selected, so typing replaces it. autofocus alone does not select,
    // and does not fire at all in a tab that is not in front.
    (function () { var i = document.getElementById('lg'); i.focus(); i.select(); })();
  </script>
</body></html>`;
}

// ── wiring ──────────────────────────────────────────────────────────────────
// MUST be called before the app's own body parser, static serving and routes so nothing is
// reachable without a session. The login endpoints are registered before the gate middleware,
// so they stay open; every other path falls through to it.
function install(app) {
  const bodyParsers = [
    express.urlencoded({ extended: false, limit: '8kb' }),
    express.json({ limit: '8kb' }),
  ];

  // Who this request belongs to, or null. Reads the user record every time so a disabled
  // account stops at once.
  const whoIs = (req) => {
    const uid = verifyToken(getCookie(req, COOKIE));
    if (!uid) return null;
    const u = users.findById(uid);
    return (u && !u.disabled) ? u : null;
  };

  app.get('/login', (req, res) => {
    if (whoIs(req)) return res.redirect(safeNext(req.query.next));
    res.type('html').send(loginPageHtml(req.query.next, ''));
  });

  app.post('/login', ...bodyParsers, (req, res) => {
    const next  = safeNext((req.body && req.body.next) || '/');
    const login = (req.body && req.body.login) || '';
    const pass  = (req.body && req.body.password) || '';
    const u = users.findByLogin(login);
    // One message for every failure. Saying which half was wrong tells a stranger which logins
    // exist.
    if (!u || u.disabled || !users.verifyPassword(u, pass)) {
      audit.record(req, { layer: 'signin', marker: 'error', kind: 'auth.refused', page: 'Sign-in',
                          label: `sign-in refused (login "${String(login).slice(0, 40)}" - wrong login or password)`,
                          status: 401, error: 'wrong login or password' });
      return res.status(401).type('html').send(loginPageHtml(next, 'Wrong login or password.'));
    }
    users.touch(u.id);
    setSessionCookie(res, u.id);
    audit.record(req, { user: u, layer: 'signin', marker: 'sign-in', kind: 'auth.login', page: 'Sign-in',
                        label: `signed in (login ${u.login})` });
    if (u.mustChange) return res.redirect('/account?first=1&next=' + encodeURIComponent(next));
    res.redirect(next);
  });

  // ── through Partner ──────────────────────────────────────────────────
  // Registered here, above the gate, for the same reason /login is: the way in cannot itself
  // require a way in.

  /** Start the round trip: remember where they were going, send them to their authorize. */
  const startSso = (req, res) => {
    const state = MP.newState();
    setSsoCookie(res, state, safeNext(req.originalUrl || '/'));
    res.redirect(MP.authorizeUrl(state));
  };

  app.get('/sso/partner/return', (req, res) => {
    if (!MP.enabled()) return res.redirect('/login');
    const { state, next } = readSsoCookie(req);
    clearSsoCookie(res);
    const refuse = (why, code) => {
      audit.record(req, { layer: 'signin', marker: 'error', kind: 'auth.refused', page: 'Sign-in',
                          label: 'Partner sign-in refused - ' + why, status: code || 400, error: why });
      return res.status(code || 400).type('html')
                .send(loginPageHtml('/', 'Partner sign-in could not be completed: ' + why));
    };
    // The state proves this round trip is the one THIS browser started. Without it a stranger
    // could hand somebody a return link carrying their own token, and the person would end up
    // quietly signed in as them.
    if (!state || String(req.query.state || '') !== state) return refuse('this sign-in did not start here - open the app again');

    let claims;
    try { claims = MP.verifyToken(req.query.sso); } catch (e) { return refuse(e.message); }
    if (claims.disabled) return refuse('the account is blocked on the Partner side', 403);

    let u;
    try { u = users.upsertFromSso(claims); } catch (e) { return refuse(e.message, 500); }
    if (u.disabled) return refuse('this account is blocked here', 403);

    setSessionCookie(res, u.id);
    audit.record(req, { user: u, layer: 'signin', marker: 'sign-in', kind: 'auth.login', page: 'Sign-in',
                        label: `signed in through Partner (${u.email || u.login})` });
    res.redirect(safeNext(next));
  });

  // Their side telling us an account was blocked, unblocked or renamed. Signed over the RAW
  // bytes, so the body is taken as a buffer - a signature checked against a re-serialised
  // object is a signature over something else. No session: the signature is the authority.
  app.post('/api/sso/partner/user', express.raw({ type: '*/*', limit: '32kb' }), (req, res) => {
    if (!MP.enabled()) return res.status(404).json({ success: false, error: 'Partner sign-in is not configured' });
    let body;
    try { body = MP.verifyWebhook(req.body, req.get('X-MP-Signature')); }
    catch (e) {
      audit.record(req, { layer: 'signin', marker: 'error', kind: 'auth.refused', page: 'Sign-in',
                          label: 'Partner account update refused - ' + e.message, status: 401, error: e.message });
      return res.status(401).json({ success: false, error: e.message });
    }
    let u, made = false;
    try {
      // MAKING THE ACCOUNT, not only changing it. Their side calls this when somebody is
      // added over there, so the whole team is on the Users tab before any of them has
      // opened this app - which is the thing that was missing: a person with a Partner
      // account simply did not exist here until the day they first followed a link.
      // `seen: false` because they have not been here; the Last seen column stays honest.
      if (!users.findByMpId(body.sub)) {
        u = users.upsertFromSso(body, { seen: false });
        made = true;
      }
      u = users.applySsoChange(body) || u;
    } catch (e) { return res.status(400).json({ success: false, error: e.message }); }
    if (!u) return res.json({ success: true, known: false });
    audit.record(req, { user: u, layer: 'signin', marker: 'admin', kind: 'auth.account', page: 'Sign-in',
                        label: `Partner ${made ? 'added' : 'updated'} ${u.nickname}`
                             + ` (${u.email || u.login}): ` + (u.disabled ? 'blocked' : 'active') });
    res.json({ success: true, known: true, created: made, disabled: !!u.disabled });
  });

  const logout = (req, res) => {
    const u = whoIs(req);
    if (u) audit.record(req, { user: u, layer: 'signin', marker: 'sign-in', kind: 'auth.logout', page: 'Sign-in', label: 'signed out' });
    clearSessionCookie(res);
    // Back to Partner when that is where people come from: our own form would ask a
    // password of somebody who has never had one here.
    if (MP.enabled() && (!u || u.source === 'partner')) return res.redirect(MP.homeUrl());
    res.redirect('/login');
  };
  app.get('/logout', logout);
  app.post('/logout', logout);

  app.get('/account', (req, res) => {
    const u = whoIs(req);
    if (!u) return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl || '/account'));
    res.type('html').send(accountPageHtml(users.publicView(u), req.query.next, req.query.first === '1', ''));
  });

  app.post('/account', ...bodyParsers, (req, res) => {
    const u = whoIs(req);
    if (!u) return res.redirect('/login');
    const b = req.body || {};
    const next  = safeNext(b.next || '/');
    const first = b.first === '1';
    const pass  = String(b.password || '');
    const pass2 = String(b.password2 || '');
    const page  = (err) => res.status(400).type('html').send(accountPageHtml(users.publicView(u), next, first, err));
    if (pass && pass !== pass2) return page('The two passwords do not match.');
    try {
      users.updateCredentials(u.id, {
        login: b.login,
        password: pass || null,
      });
    } catch (e) {
      audit.record(req, { user: u, layer: 'signin', marker: 'error', kind: 'auth.account', page: 'Sign-in',
                          label: 'own credentials refused - ' + e.message, status: 400, error: e.message });
      return page(e.message);
    }
    {
      const after = users.findById(u.id) || u;
      const parts = [];
      if (after.login !== u.login) parts.push(`changed own login ${u.login} -> ${after.login}`);
      if (pass) parts.push('changed own password');
      if (parts.length) audit.record(req, { user: after, layer: 'signin', marker: 'sign-in', kind: 'auth.account', page: 'Sign-in', label: parts.join(' · ') });
    }
    res.redirect(next);
  });

  app.use((req, res, next) => {
    const u = whoIs(req);
    if (u) { req.user = users.publicView(u); return next(); }
    // The queue calling the ffmpeg route: no cookie, the token instead. Before this the gate
    // turned it away as a stranger, and every scenario entry failed with "auth required".
    if (isInternal(req)) { req.user = INTERNAL_USER; return next(); }

    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ success: false, error: 'auth required — session expired, reload to sign in' });
    }
    if ((req.headers.accept || '').includes('text/html')) {
      // WHERE A STRANGER IS SENT. With Partner wired up, to Partner: signed in
      // there, they come straight back and are inside; not signed in, they get their
      // sign-in page and land here afterwards. Nobody registers twice and nobody is asked
      // for a password this app does not have for them. /login still answers for the admin,
      // which is the way in when their side is unreachable.
      if (MP.enabled()) return startSso(req, res);
      return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl || '/'));
    }
    return res.status(401).send('Authentication required.');
  });
}

module.exports = { install, verifyToken, makeToken, safeEqual, internalToken };
