'use strict';

/* fake-releases.js - GitHub Releases on THIS computer, for stands: the addresses an installed copy asks, over a folder
   `node tools/release.js upload --dir <folder>` filled (<folder>/<tag>/<files>, <folder>/latest.txt).

       node tools/fake-releases.js --dir <folder> [--port 3199] [--no-range] [--cut <n>]

     GET /<owner>/<repo>/releases/latest/download/<file>   -> 302 to the latest tag's file, as GitHub answers
     GET /<owner>/<repo>/releases/download/<tag>/<file>    -> 302 to /assets/<tag>/<file> - another address, as GitHub
                                                              hands its files out from another host
     GET /assets/<tag>/<file>                              the file; a Range asks for a part of it (206)
   --no-range: a Range is answered with the whole file (200) - a server that gives no parts.
   --cut <n>: the first n parts are broken off halfway - a connection lost in the middle of an update.
   Loopback only; every request is logged. */

const fs = require('fs');
const path = require('path');
const http = require('http');

const argv = process.argv.slice(2);
const arg = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt; };
const DIR = path.resolve(arg('--dir', ''));
const PORT = Number(arg('--port', '3199'));
const NO_RANGE = argv.includes('--no-range');
let cuts = Number(arg('--cut', '0')) || 0;
if (!arg('--dir', '') || !fs.existsSync(DIR)) { console.error('[fake-releases] --dir <folder> that exists'); process.exit(1); }

const SAFE = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,100}$/;
const say = (s) => console.log(`[fake-releases] ${s}`);

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const range = req.headers.range || '';
  say(`${req.method} ${url.pathname}${range ? ' ' + range : ''}`);
  const no = (code = 404) => { res.writeHead(code, { 'content-type': 'text/plain' }); res.end('Not Found'); };
  if (req.method !== 'GET') return no(405);

  // /<owner>/<repo>/releases/latest/download/<file>
  if (parts.length === 6 && parts[2] === 'releases' && parts[3] === 'latest' && parts[4] === 'download') {
    let tag = '';
    try { tag = fs.readFileSync(path.join(DIR, 'latest.txt'), 'utf8').trim(); } catch (e) { tag = ''; }
    if (!SAFE.test(tag) || !SAFE.test(parts[5]) || !fs.existsSync(path.join(DIR, tag, parts[5]))) return no();
    res.writeHead(302, { location: `/${parts[0]}/${parts[1]}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(parts[5])}` });
    return res.end();
  }
  // /<owner>/<repo>/releases/download/<tag>/<file>
  if (parts.length === 6 && parts[2] === 'releases' && parts[3] === 'download') {
    if (!SAFE.test(parts[4]) || !SAFE.test(parts[5]) || !fs.existsSync(path.join(DIR, parts[4], parts[5]))) return no();
    res.writeHead(302, { location: `/assets/${encodeURIComponent(parts[4])}/${encodeURIComponent(parts[5])}` });
    return res.end();
  }
  // /assets/<tag>/<file>
  if (parts.length === 3 && parts[0] === 'assets' && SAFE.test(parts[1]) && SAFE.test(parts[2])) {
    const f = path.join(DIR, parts[1], parts[2]);
    let size;
    try { size = fs.statSync(f).size; } catch (e) { return no(); }
    const m = /^bytes=(\d+)-(\d*)$/.exec(range);
    if (!m || NO_RANGE) {
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': size, 'accept-ranges': NO_RANGE ? 'none' : 'bytes' });
      return fs.createReadStream(f).pipe(res);
    }
    const start = Number(m[1]);
    const end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (start > end || start >= size) { res.writeHead(416, { 'content-range': `bytes */${size}` }); return res.end(); }
    res.writeHead(206, { 'content-type': 'application/octet-stream', 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${size}`, 'accept-ranges': 'bytes' });
    if (cuts > 0) {
      cuts--;
      const half = start + Math.floor((end - start + 1) / 2);
      say(`  cut off at byte ${half}`);
      return fs.createReadStream(f, { start, end: Math.max(start, half - 1) }).on('end', () => res.destroy()).pipe(res, { end: false });
    }
    return fs.createReadStream(f, { start, end }).pipe(res);
  }
  return no();
}).listen(PORT, '127.0.0.1', () => say(`serving ${DIR} at http://127.0.0.1:${PORT} (ranges ${NO_RANGE ? 'off' : 'on'}${cuts ? `, ${cuts} cut` : ''})`));
