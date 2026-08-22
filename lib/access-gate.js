'use strict';

// access-gate.js — a shared-password login in front of the whole app, held per browser
// by a signed session cookie that expires after a fixed window (default 4h), then forces
// a fresh login.
//
// Why this exists: the panel holds live API keys (data/settings.json) and spends real
// credits on every generation route. A leaked/open deploy is how the keys walked out once —
// GET /api/settings answered the open internet and returned every key in plaintext. This
// gate closes the door for keys, generation endpoints and static assets alike;
// routes/settings.js is the companion change that keeps the key VALUES out of the browser
// even for a logged-in user.
//
// Model: no server-side session store (one PM2 process, keep it stateless). The cookie is
// `<payload>.<hmac>`, payload = {exp}. Every request re-verifies the HMAC and the expiry, so
// a cookie that outlives its window (or is tampered with) is rejected. Changing APP_PASSWORD
// invalidates all existing sessions, because the signing secret is derived from it.
//
// Config (.env):
//   APP_PASSWORD   the shared login password. Empty ⇒ gate DISABLED (+ loud warning).
//   SESSION_HOURS  session lifetime in hours (default 4).
//   APP_SECRET     optional explicit HMAC secret; if unset it is derived from APP_PASSWORD.
//   COOKIE_SECURE  set to "1" only when the app is served over HTTPS (adds the Secure flag).
//
// NOTE: served over plain HTTP the password and cookie travel in cleartext. Put the app
// behind HTTPS (a reverse proxy) for real protection; this gate stops the open-internet
// scraping that leaked the keys, it is not a substitute for TLS.

const crypto  = require('crypto');
const express = require('express');

const COOKIE = 'ugc_sess';

function ttlMs() {
  const h = Number(process.env.SESSION_HOURS);
  return (Number.isFinite(h) && h > 0 ? h : 6) * 60 * 60 * 1000;
}

function secret() {
  if (process.env.APP_SECRET) return process.env.APP_SECRET;
  return crypto.createHash('sha256').update('ugc-app::' + (process.env.APP_PASSWORD || '')).digest('hex');
}

// Constant-time compare that never throws on a length mismatch (timingSafeEqual does).
function safeEqual(a, b) {
  const ba = Buffer.from(String(a), 'utf8');
  const bb = Buffer.from(String(b), 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function sign(payloadB64) {
  return crypto.createHmac('sha256', secret()).update(payloadB64).digest('base64url');
}

function makeToken() {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + ttlMs() })).toString('base64url');
  return payload + '.' + sign(payload);
}

function verifyToken(tok) {
  if (!tok || typeof tok !== 'string') return false;
  const dot = tok.indexOf('.');
  if (dot < 0) return false;
  const payload = tok.slice(0, dot);
  const sig     = tok.slice(dot + 1);
  if (!payload || !sig) return false;
  if (!safeEqual(sig, sign(payload))) return false;
  let obj;
  try { obj = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { return false; }
  return obj && typeof obj.exp === 'number' && Date.now() < obj.exp;
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

function setSessionCookie(res) {
  const attrs = [
    `${COOKIE}=${makeToken()}`,
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

function loginPageHtml(next, error) {
  const nx = String(next || '/').replace(/"/g, '&quot;');
  const err = error ? '<p class="err">Wrong password.</p>' : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in · UGC Studio</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:grid; place-items:center;
         background:#0b0d12; color:#e7e9ee;
         font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif; }
  .card { width:min(92vw,340px); background:#151922; border:1px solid #232937;
          border-radius:14px; padding:26px 24px; box-shadow:0 12px 40px rgba(0,0,0,.45); }
  h1 { margin:0 0 4px; font-size:17px; font-weight:600; }
  p.sub { margin:0 0 18px; color:#8b93a7; font-size:13px; }
  label { display:block; font-size:12px; color:#8b93a7; margin:0 0 6px; }
  input { width:100%; padding:11px 12px; border-radius:9px; border:1px solid #2b3242;
          background:#0e1119; color:#e7e9ee; font-size:15px; outline:none; }
  input:focus { border-color:#3b82f6; }
  button { width:100%; margin-top:14px; padding:11px; border:0; border-radius:9px;
           background:#3b82f6; color:#fff; font-size:15px; font-weight:600; cursor:pointer; }
  button:hover { background:#2f6fe0; }
  .err { color:#f87171; font-size:13px; margin:0 0 12px; }
  .foot { margin-top:14px; color:#5c6478; font-size:11px; text-align:center; }
</style></head>
<body>
  <form class="card" method="POST" action="/login">
    <h1>UGC Studio</h1>
    <p class="sub">Enter the password to continue.</p>
    ${err}
    <input type="hidden" name="next" value="${nx}">
    <label for="pw">Password</label>
    <input id="pw" name="password" type="password" autocomplete="current-password" autofocus>
    <button type="submit">Sign in</button>
    <div class="foot">Session lasts ${Math.round(ttlMs() / 3600000)}h, then asks again.</div>
  </form>
</body></html>`;
}

// Wire the gate + its login/logout endpoints onto the app. MUST be called before the app's
// own body parser, static serving and routes so nothing is reachable without a session. The
// login endpoints are registered before the gate middleware, so they stay open; every other
// path falls through to the gate.
function install(app) {
  const APP_PASSWORD = process.env.APP_PASSWORD || '';
  if (!APP_PASSWORD) {
    console.warn('[SECURITY] APP_PASSWORD is not set — the app is OPEN to anyone who can reach this port. Set APP_PASSWORD in .env and restart.');
  }

  const bodyParsers = [
    express.urlencoded({ extended: false, limit: '8kb' }),
    express.json({ limit: '8kb' }),
  ];

  app.get('/login', (req, res) => {
    if (APP_PASSWORD && verifyToken(getCookie(req, COOKIE))) {
      return res.redirect(safeNext(req.query.next));
    }
    res.type('html').send(loginPageHtml(req.query.next, false));
  });

  app.post('/login', ...bodyParsers, (req, res) => {
    const next = safeNext((req.body && req.body.next) || '/');
    const pass = (req.body && req.body.password) || '';
    if (APP_PASSWORD && safeEqual(pass, APP_PASSWORD)) {
      setSessionCookie(res);
      return res.redirect(next);
    }
    res.status(401).type('html').send(loginPageHtml(next, true));
  });

  const logout = (req, res) => { clearSessionCookie(res); res.redirect('/login'); };
  app.get('/logout', logout);
  app.post('/logout', logout);

  app.use((req, res, next) => {
    if (!APP_PASSWORD) return next();                       // gate disabled until configured
    if (verifyToken(getCookie(req, COOKIE))) return next(); // valid, unexpired session

    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ success: false, error: 'auth required — session expired, reload to sign in' });
    }
    if ((req.headers.accept || '').includes('text/html')) {
      return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl || '/'));
    }
    return res.status(401).send('Authentication required.');
  });
}

module.exports = { install, verifyToken, makeToken, safeEqual };
