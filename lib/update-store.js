'use strict';

// ════════════════════════════════════════════════════════════════════════════
// WHERE UPDATES ARE KEPT (phase V83, block B3) - for tools/release.js (and the stands' fake Worker): the same few
// operations over the owner's R2 bucket `ugc-updates` or over a folder on this computer.
//   has(key) -> size or -1, get(key) -> Buffer or null, put(key, buf, type), list(prefix) -> [{ key, size }], del(key)
//
// R2 is spoken to over its S3 API with the pair the ONE Cloudflare key makes (lib/r2.js `pairOf`: the token's id, the
// SHA-256 of its value). Signed here, by itself, not through lib/r2.js: that module is the app's - tied to the
// library's settings, and the path the pictures for kie.ai take every day; the release tool must not need a library,
// and the app's path is not changed for it. No lib/config.js here.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ── A folder ───────────────────────────────────────────────────────────────
function createDirStore(dir) {
  const abs = (key) => {
    if (!/^[A-Za-z0-9._/-]+$/.test(key) || key.split('/').some((s) => !s || s === '.' || s === '..')) throw new Error('bad key: ' + key);
    return path.join(dir, ...key.split('/'));
  };
  return {
    where: dir,
    async has(key) { try { return fs.statSync(abs(key)).size; } catch (e) { return -1; } },
    async get(key) { try { return fs.readFileSync(abs(key)); } catch (e) { return null; } },
    async put(key, buf) {
      const f = abs(key);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      const tmp = `${f}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, buf);
      fs.renameSync(tmp, f);
    },
    async list(prefix) {
      const out = [];
      const walk = (d, rel) => {
        let ents = [];
        try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
        for (const e of ents) {
          const r = rel ? `${rel}/${e.name}` : e.name;
          if (e.isDirectory()) walk(path.join(d, e.name), r);
          else if (r.startsWith(prefix) && !r.endsWith('.tmp')) out.push({ key: r, size: fs.statSync(path.join(d, e.name)).size });
        }
      };
      walk(dir, '');
      return out.sort((a, b) => (a.key < b.key ? -1 : 1));
    },
    async del(key) { try { fs.rmSync(abs(key), { force: true }); } catch (e) { /* gone */ } },
  };
}

// ── R2 over S3 ─────────────────────────────────────────────────────────────
const ALGO = 'AWS4-HMAC-SHA256';
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const hmac = (k, s) => crypto.createHmac('sha256', k).update(s, 'utf8').digest();
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const encPath = (p) => String(p).split('/').map(enc).join('/');

function createS3Store({ account, key, secret, bucket, origin }) {
  if (!account || !key || !secret || !bucket) throw new Error('R2 needs the account, the key pair and the bucket');
  const base = origin || `https://${account}.r2.cloudflarestorage.com`;
  const host = new URL(base).host;

  async function callOnce(method, objectKey, { query = [], body = null, type = '' } = {}) {
    const uri = objectKey == null ? `/${enc(bucket)}` : `/${enc(bucket)}/${encPath(objectKey)}`;
    const q = query.slice().sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, v]) => `${enc(k)}=${enc(v)}`).join('&');
    const payload = body ? sha256(body) : sha256('');
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
    const day = amzDate.slice(0, 8);
    const scope = `${day}/auto/s3/aws4_request`;
    const headers = { host, 'x-amz-content-sha256': payload, 'x-amz-date': amzDate };
    if (type) headers['content-type'] = type;
    const names = Object.keys(headers).sort();
    const canonical = [method, uri, q, names.map((n) => `${n}:${String(headers[n]).trim()}\n`).join(''), names.join(';'), payload].join('\n');
    const toSign = [ALGO, amzDate, scope, sha256(canonical)].join('\n');
    const kSign = hmac(hmac(hmac(hmac('AWS4' + secret, day), 'auto'), 's3'), 'aws4_request');
    const signature = crypto.createHmac('sha256', kSign).update(toSign, 'utf8').digest('hex');
    const h = { ...headers, Authorization: `${ALGO} Credential=${key}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}` };
    delete h.host;
    const r = await fetch(`${base}${uri}${q ? '?' + q : ''}`, { method, headers: h, body: body || undefined, signal: AbortSignal.timeout(body ? 600000 : 60000) });
    return r;
  }
  // R2 answers a busy moment with a 500 "InternalError - Please try again" (the first live release met one among eight
  // thousand puts): a 5xx, a 429 or a broken connection is asked again, signed anew, up to four times - every operation
  // here is the same whether it is done once or twice.
  const call = async (method, objectKey, opts) => {
    for (let attempt = 1; ; attempt++) {
      try {
        const r = await callOnce(method, objectKey, opts);
        if ((r.status >= 500 || r.status === 429) && attempt < 4) { await r.arrayBuffer().catch(() => null); }
        else return r;
      } catch (e) {
        if (attempt >= 4) throw e;
      }
      await new Promise((ok) => setTimeout(ok, 1000 * 2 ** (attempt - 1)));
    }
  };
  const fail = async (r, what) => { const t = await r.text().catch(() => ''); throw new Error(`R2 ${what}: ${r.status} ${t.slice(0, 200)}`); };

  return {
    where: `r2://${bucket}`,
    async has(k) { const r = await call('HEAD', k); if (r.status === 404) return -1; if (!r.ok) await fail(r, 'head ' + k); return Number(r.headers.get('content-length')) || 0; },
    async get(k) { const r = await call('GET', k); if (r.status === 404) return null; if (!r.ok) await fail(r, 'get ' + k); return Buffer.from(await r.arrayBuffer()); },
    async put(k, buf, type = 'application/octet-stream') { const r = await call('PUT', k, { body: buf, type }); if (!r.ok) await fail(r, 'put ' + k); },
    async del(k) { const r = await call('DELETE', k); if (!r.ok && r.status !== 404) await fail(r, 'delete ' + k); },
    async list(prefix) {
      const out = [];
      let token = '';
      for (;;) {
        const query = [['list-type', '2'], ['max-keys', '1000'], ['prefix', prefix]];
        if (token) query.push(['continuation-token', token]);
        const r = await call('GET', null, { query });
        if (!r.ok) await fail(r, 'list ' + prefix);
        const xml = await r.text();
        const un = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
        for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
          const k = /<Key>([^<]*)<\/Key>/.exec(m[1]);
          const s = /<Size>(\d+)<\/Size>/.exec(m[1]);
          if (k) out.push({ key: un(k[1]), size: s ? Number(s[1]) : 0 });
        }
        const next = /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml);
        if (!/<IsTruncated>true<\/IsTruncated>/.test(xml) || !next) break;
        token = un(next[1]);
      }
      return out;
    },
  };
}

module.exports = { createDirStore, createS3Store };
