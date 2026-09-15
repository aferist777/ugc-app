'use strict';

/* smoke-local.js - does the local app still boot and answer, after a change.

   Run from the checkout, against a server that is already up:
       node tools/smoke-local.js [port]
   The port defaults to PORT in the library's .env, else 3100. Everything goes to 127.0.0.1.

   What it asks:
     - every page, a few shipped assets, and every GET route that takes no parameters;
     - a thumbnail of a shipped preset, and a 1K preview of a shipped mannequin - filed in the
       library under uploads/_poses/, and removed again at the end if this run made it;
     - the settings view: no secret and no retired key reaches the page;
     - the routes that were removed still answer 404.
   It spends nothing: no request here starts a generation or a render.

   Exit code 1 on a 5xx, a network error, a leaked key, or a removed route that answers. A 4xx on
   a GET route is printed but expected - those routes want parameters or keys this run does not
   have. Not a test suite: a quick answer to "did I break the app". */

const fs = require('fs');
const path = require('path');

const { APP_DIR, ROOT_DIR, POSES_CACHE_DIR } = require('../lib/config');
require('dotenv').config({ path: path.join(ROOT_DIR, '.env') });

const port = Number(process.argv[2]) || Number(process.env.PORT) || 3100;
const base = `http://127.0.0.1:${port}`;

const PAGES = ['/', '/character', '/merge', '/scenarios', '/library', '/library2', '/birols', '/studio', '/admin'];
const STATICS = ['/js/app-nav.js', '/presets/anatolian-stone.jpg', '/poses/mirror_full.jpg'];
// Every key routes/settings.js keeps out of the page, secret or retired.
const HIDDEN_KEYS = ['kieApiKey', 'replicateApiKey', 'elevenLabsApiKey', 'groqApiKey', 'openRouterApiKey',
                     'r2SecretAccessKey', 'imgbbApiKey', 'partnerApiKey', 'partnerUrl'];
const REMOVED = [['GET', '/api/me'], ['GET', '/login'], ['GET', '/api/admin/users'], ['GET', '/api/audit/meta'],
                 ['POST', '/api/mv3/render/send'], ['GET', '/api/biroly/hands-status'],
                 ['POST', '/api/biroly/hands-generate'], ['POST', '/api/upload-public-base64'],
                 ['POST', '/api/restart']];

async function call(method, url, body) {
  const t0 = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 25000);
  try {
    const r = await fetch(base + url, {
      method, signal: ctl.signal, redirect: 'manual',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const type = r.headers.get('content-type') || '';
    const text = /json|text/.test(type) ? await r.text() : `<${type} ${(await r.arrayBuffer()).byteLength}B>`;
    return { status: r.status, ms: Date.now() - t0, text };
  } catch (e) {
    return { status: 'ERR', ms: Date.now() - t0, text: e.name === 'AbortError' ? 'timeout' : e.message };
  } finally {
    clearTimeout(timer);
  }
}

function getRoutes() {
  const out = new Set();
  const dir = path.join(APP_DIR, 'routes');
  for (const f of fs.readdirSync(dir)) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of src.matchAll(/router\.get\(\s*['"]([^'"]+)['"]/g)) if (!m[1].includes(':')) out.add('/api' + m[1]);
  }
  return [...out].sort();
}

(async () => {
  const rows = [];
  for (const u of [...PAGES, ...STATICS, ...getRoutes()]) rows.push(['GET', u, await call('GET', u)]);

  rows.push(['GET', 'thumb of a shipped preset', await call('GET', '/api/thumb?src=/presets/anatolian-stone.jpg&v=card')]);
  const previewFile = path.join(POSES_CACHE_DIR, 'preview', 'mirror_full.jpg');
  const hadPreview = fs.existsSync(previewFile);
  const pv = await call('POST', '/api/scen3/preview1k', { path: '/poses/mirror_full.jpg' });
  rows.push(['POST', 'preview1k of a shipped pose', pv]);
  let pvPath = null;
  try { pvPath = JSON.parse(pv.text).path; } catch (e) { /* reported below as a failed row */ }
  if (pvPath) {
    rows.push(['GET', 'the preview it returned: ' + pvPath, await call('GET', pvPath)]);
    rows.push(['GET', 'thumb of that preview', await call('GET', '/api/thumb?src=' + encodeURIComponent(pvPath) + '&v=strip')]);
  }
  if (!hadPreview) { try { fs.unlinkSync(previewFile); } catch (e) { /* not made - nothing to remove */ } }

  let failed = 0;
  const lines = [];
  for (const [m, u, r] of rows) {
    if (r.status === 'ERR' || r.status >= 500) { failed++; lines.push(`!! ${r.status} ${m} ${u} (${r.ms}ms) ${String(r.text).replace(/\s+/g, ' ').slice(0, 160)}`); }
    else if (r.status >= 400) lines.push(`4x ${r.status} ${m} ${u} ${String(r.text).replace(/\s+/g, ' ').slice(0, 120)}`);
  }
  console.log(`${rows.length} requests: ${rows.length - lines.length} ok, ${lines.length - failed} 4xx, ${failed} 5xx/errors`);
  if (lines.length) console.log(lines.join('\n'));

  const st = await call('GET', '/api/settings');
  let shown = [];
  try { shown = Object.keys(JSON.parse(st.text).settings || {}); } catch (e) { shown = null; }
  const leaked = shown ? HIDDEN_KEYS.filter(k => shown.includes(k)) : null;
  if (!leaked || leaked.length) failed++;
  console.log('settings view:', st.status, !leaked ? 'unreadable' : leaked.length ? 'LEAKS ' + leaked.join(', ') : 'no secret or retired key in it');

  for (const [m, u] of REMOVED) {
    const r = await call(m, u, m === 'POST' ? {} : undefined);
    if (r.status !== 404) { failed++; console.log(`!! removed route answers: ${m} ${u} -> ${r.status}`); }
  }
  console.log(`removed routes: ${REMOVED.length} checked`);

  process.exitCode = failed ? 1 : 0;
})();
