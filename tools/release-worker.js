'use strict';

/* release-worker.js - the program of the Worker `ugc-updates` on the owner's Cloudflare (phase V83, block B4; the
   owner 2026-11-09: (о1) a bucket of its own behind a Worker, (о2) a token per friend, (о3) who has which version).

   Uploaded by `node tools/release.js worker`, bound to the bucket `ugc-updates` as UPD. Every request carries a
   friend's token (`Authorization: Bearer <token>`); the bucket keeps only their SHA-256s, in access/tokens.json
   ({ "<sha256>": { name, channel, added, revoked? } }, read again at most every minute). No token, an unknown or a
   revoked one: 403 "This copy has no access to updates."
     GET  /v1/channel/<channel>/<platform>   the signed envelope friends read (lib/update-manifest.js)
     GET  /v1/blob/<sha256>                  a file's content, gzipped
     POST /v1/seen  { version, seq, platform, state }   seen/<name>.json - what that copy has, and when it asked
   The stands run THIS code on this computer (tools/fake-update-worker.js), over a folder instead of R2. */

const VERSION = 1;

const WORKER = `// UGC Studio - updates v${VERSION}. Put here by tools/release.js worker; it hands friends the owner's releases.
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
let cache = { at: 0, tokens: null };

async function tokens(env) {
  const ttl = env.TOKEN_CACHE_MS != null ? Number(env.TOKEN_CACHE_MS) : 60000;
  if (cache.tokens && Date.now() - cache.at < ttl) return cache.tokens;
  const o = await env.UPD.get('access/tokens.json');
  let t = {};
  if (o) { try { t = JSON.parse(await o.text()) || {}; } catch (e) { t = {}; } }
  cache = { at: Date.now(), tokens: t };
  return t;
}

async function sha256(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] !== 'v1') return json({ error: 'UGC Studio updates' }, 404);
    const auth = req.headers.get('authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    const who = token && token.length >= 16 ? (await tokens(env))[await sha256(token)] : null;
    if (!who || who.revoked) return json({ error: 'This copy has no access to updates.' }, 403);

    if (req.method === 'GET' && parts[1] === 'channel' && parts.length === 4) {
      const [, , channel, platform] = parts;
      if (!/^[a-z]{1,20}$/.test(channel) || !/^[a-z0-9-]{1,40}$/.test(platform)) return json({ error: 'bad request' }, 400);
      if (who.channel && who.channel !== channel) return json({ error: 'This copy reads another channel.' }, 403);
      const o = await env.UPD.get('channels/' + channel + '/' + platform + '.json');
      if (!o) return json({ error: 'Nothing is published yet.' }, 404);
      return new Response(o.body, { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
    }
    if (req.method === 'GET' && parts[1] === 'blob' && parts.length === 3 && /^[0-9a-f]{64}$/.test(parts[2])) {
      const o = await env.UPD.get('blobs/' + parts[2]);
      if (!o) return json({ error: 'No such file.' }, 404);
      return new Response(o.body, { headers: { 'content-type': 'application/gzip', 'content-length': String(o.size), 'cache-control': 'private, max-age=86400' } });
    }
    if (req.method === 'POST' && parts[1] === 'seen' && parts.length === 2) {
      let b = {};
      try { b = await req.json(); } catch (e) { b = {}; }
      const cut = (v) => String(v == null ? '' : v).slice(0, 60);
      const rec = { name: who.name, version: cut(b.version), seq: Number(b.seq) || 0, platform: cut(b.platform), state: cut(b.state), at: new Date().toISOString() };
      await env.UPD.put('seen/' + who.name + '.json', JSON.stringify(rec), { httpMetadata: { contentType: 'application/json' } });
      return json({ ok: true });
    }
    return json({ error: 'not found' }, 404);
  },
};
`;

module.exports = { VERSION, WORKER, NAME: 'ugc-updates' };
