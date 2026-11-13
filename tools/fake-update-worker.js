'use strict';

/* fake-update-worker.js - the Worker `ugc-updates` on THIS computer, for stands.

       node tools/fake-update-worker.js --store <folder> [--port 3199] [--cut <n>]

   Runs the very program `tools/release.js worker` uploads (tools/release-worker.js) with a stand-in for its R2
   binding over the folder tools/release.js --store wrote: the same routes, tokens and answers, nothing sent anywhere.
   Tokens are read again on every request (TOKEN_CACHE_MS 0), so a friend removed is refused at once. Loopback only.
   --cut <n>: the first n files (blobs) are broken off halfway - a connection lost in the middle of an update. */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { Readable } = require('stream');
const { WORKER } = require('./release-worker');

const argv = process.argv.slice(2);
const arg = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt; };

function binding(dir) {
  const abs = (key) => path.join(dir, ...key.split('/'));
  return {
    async get(key) {
      const f = abs(key);
      let st;
      try { st = fs.statSync(f); } catch (e) { return null; }
      return {
        size: st.size,
        get body() { return Readable.toWeb(fs.createReadStream(f)); },
        async text() { return fs.readFileSync(f, 'utf8'); },
        async arrayBuffer() { const b = fs.readFileSync(f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); },
      };
    },
    async put(key, value) {
      const f = abs(key);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, typeof value === 'string' ? value : Buffer.from(value));
    },
  };
}

async function start({ store, port = 3199, cut = 0 }) {
  let cutLeft = Number(cut) || 0;
  // The Worker's module, as Cloudflare would load it.
  const tmp = path.join(os.tmpdir(), `ugc-fake-worker-${process.pid}.mjs`);
  fs.writeFileSync(tmp, WORKER);
  const worker = (await import('file:///' + tmp.replace(/\\/g, '/'))).default;
  const env = { UPD: binding(path.resolve(store)), TOKEN_CACHE_MS: 0 };
  const server = http.createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const request = new Request(`http://127.0.0.1:${port}${req.url}`, { method: req.method, headers: req.headers, body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body });
      const r = await worker.fetch(request, env);
      res.writeHead(r.status, Object.fromEntries(r.headers));
      if (r.body && r.status === 200 && req.url.startsWith('/v1/blob/') && cutLeft > 0) {
        cutLeft--;
        const half = Math.floor((Number(r.headers.get('content-length')) || 2) / 2);
        let sent = 0;
        for await (const c of r.body) { const part = Buffer.from(c).subarray(0, Math.max(0, half - sent)); if (part.length) res.write(part); sent += part.length; if (sent >= half) break; }
        res.destroy();
        return;
      }
      if (r.body) { for await (const c of r.body) { if (!res.write(c)) await new Promise((ok) => res.once('drain', ok)); } }
      res.end();
    } catch (e) {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' });
      res.end(String(e && e.message));
    }
  });
  await new Promise((ok, no) => { server.once('error', no); server.listen(port, '127.0.0.1', ok); });
  console.log(`[fake-worker] http://127.0.0.1:${port} over ${path.resolve(store)}`);
  return server;
}

if (require.main === module) {
  start({ store: arg('--store', ''), port: Number(arg('--port', '3199')), cut: Number(arg('--cut', '0')) }).catch((e) => { console.error('[fake-worker] ' + e.message); process.exit(1); });
}

module.exports = { start };
