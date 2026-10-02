'use strict';

/* fetch-jassub.js - puts JASSUB (libass compiled to WebAssembly) into vendor/jassub/, the captions'
   preview from phase K4: the page draws the SAME .ass the render burns, with the same libass, so the
   screen and the file are one drawing.

   npm install runs it (postinstall, with --optional: no network is a warning, not a failed install).
   By hand, after moving a pin:
       node tools/fetch-jassub.js

   Three packages from the npm registry, each pinned by version AND by its published SHA-512 (the
   `dist.integrity` of that version), so a tarball changed after the fact is refused. The page has no
   bundler, and JASSUB is ES modules importing other packages by bare name - so the files are laid out
   under vendor/jassub/ and those imports rewritten to relative paths:
     - abslink (MIT) and lfa-ponyfill (MIT) go into deps/;
     - rvfc-polyfill (GPL-3.0) is NOT shipped: it only patches <video>, and the preview hands JASSUB a
       canvas (Electron has requestVideoFrameCallback natively anyway);
     - throughput (CommonJS, debug counters only) is replaced by a stub.
   One wasm: Electron's Chromium passes JASSUB's relaxed-SIMD test, so only the "modern" build ships.
   Licences: JASSUB's own LICENSE beside it; the wasm contains libass (ISC), FreeType (FTL), FriBidi
   (LGPL-2.1+), HarfBuzz (MIT) and others, per its package licence expression - kept in LICENSES.txt. */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const PINS = {
  jassub: { version: '2.5.16', integrity: 'sha512-n4vjXfraf3o8k3/5TK6DhCYVcbQ/VqhVOgwqLd3l0xfMtsN4fpE/hPq2hPaGagBTOtJS9yHwRoRp3mmchQ9XVg==' },
  abslink: { version: '1.3.0', integrity: 'sha512-P7hWPeaCJknGcyL022ardcsK8P9Wrwzwhhffs78jjXyc0D+shbnWIKKnpBl+uj1YZhaEODpp+8CRqyAO6LWHSg==' },
  'lfa-ponyfill': { version: '1.1.1', integrity: 'sha512-Had4tsGEHtIj58MRtf6SlubNDltxinxMSdxIn1GdwrWbye8TD+pZ+D6qKETnJ9+vQOfG9q/Ds4WUPskhyAMp5Q==' },
};
const DIR = path.join(__dirname, '..', 'vendor', 'jassub');
const MARK = path.join(DIR, 'PINNED.json');
const optional = process.argv.includes('--optional');

// A .tgz's files, by path inside the package ("package/..."). ustar: 512-byte headers, octal sizes.
function untar(buf) {
  const files = new Map();
  for (let off = 0; off + 512 <= buf.length;) {
    const head = buf.subarray(off, off + 512);
    if (head.every(b => b === 0)) break;
    const str = (a, b) => head.subarray(a, b).toString('utf8').replace(/\0.*$/s, '');
    const name = (str(345, 500) ? str(345, 500) + '/' : '') + str(0, 100);
    const size = parseInt(str(124, 136).trim() || '0', 8);
    const type = String.fromCharCode(head[156] || 48);
    off += 512;
    if (type === '0' || type === '\0') files.set(name, Buffer.from(buf.subarray(off, off + size)));
    off += Math.ceil(size / 512) * 512;
  }
  return files;
}

async function tarball(name, pin) {
  const url = 'https://registry.npmjs.org/' + name + '/-/' + name.split('/').pop() + '-' + pin.version + '.tgz';
  const res = await fetch(url);
  if (!res.ok) throw new Error(name + ': ' + res.status + ' ' + url);
  const buf = Buffer.from(await res.arrayBuffer());
  const got = 'sha512-' + crypto.createHash('sha512').update(buf).digest('base64');
  if (got !== pin.integrity) throw new Error(name + '@' + pin.version + ': the tarball is not the pinned one');
  return untar(zlib.gunzipSync(buf));
}

const noMap = (s) => s.replace(/\n\/\/# sourceMappingURL=.*$/m, '');

async function main() {
  try {
    const have = JSON.parse(fs.readFileSync(MARK, 'utf8'));
    if (JSON.stringify(have) === JSON.stringify(PINS)) { console.log('[jassub] ' + PINS.jassub.version + ' already in place'); return; }
  } catch (e) { /* not there yet */ }

  const pk = {};
  for (const [name, pin] of Object.entries(PINS)) pk[name] = await tarball(name, pin);
  fs.rmSync(DIR, { recursive: true, force: true });
  const put = (rel, data) => {
    const f = path.join(DIR, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, data);
  };

  // JASSUB: the page module, the worker and its renderers, the emscripten glue, one wasm, the fallback font.
  for (const [p, data] of pk.jassub) {
    const rel = p.replace(/^package\//, '');
    if (!/^dist\//.test(rel) || /\.(map|d\.ts)$/.test(rel)) continue;
    if (/jassub-worker\.wasm$/.test(rel)) continue;                  // the non-SIMD build is not needed
    const out = rel.replace(/^dist\//, '');
    if (!/\.js$/.test(out)) { put(out, data); continue; }
    let s = noMap(data.toString('utf8'));
    if (out === 'jassub.js') {
      s = s.replace(/^import 'rvfc-polyfill';\s*$/m, '')
           .replace(/from 'abslink\/w3c'/g, "from './deps/abslink/adapters/w3c.js'")
           .replace(/from 'abslink'/g, "from './deps/abslink/src/abslink.js'");
    } else if (out === 'debug.js') {
      s = s.replace(/^import throughput from 'throughput';\s*$/m, '// debug counters only - the upstream module is CommonJS\nconst throughput = () => () => 0;');
    } else if (out === 'worker/worker.js') {
      s = s.replace(/from 'abslink\/w3c'/g, "from '../deps/abslink/adapters/w3c.js'")
           .replace(/from 'abslink'/g, "from '../deps/abslink/src/abslink.js'")
           .replace(/from 'lfa-ponyfill'/g, "from '../deps/lfa-ponyfill/index.js'");
    }
    if (/from '(?![./])/.test(s) || /import '(?![./])/.test(s)) throw new Error('a bare import is left in ' + out);
    put(out, s);
  }
  put('LICENSE', pk.jassub.get('package/LICENSE') || '');
  for (const f of ['src/abslink.js', 'src/types.js', 'adapters/w3c.js']) put('deps/abslink/' + f, noMap(pk.abslink.get('package/' + f).toString('utf8')));
  put('deps/abslink/LICENSE', pk.abslink.get('package/LICENSE') || 'MIT');
  put('deps/lfa-ponyfill/index.js', noMap(pk['lfa-ponyfill'].get('package/index.js').toString('utf8')));
  const lfaLic = pk['lfa-ponyfill'].get('package/LICENSE');
  if (lfaLic) put('deps/lfa-ponyfill/LICENSE', lfaLic);
  put('LICENSES.txt', 'jassub ' + PINS.jassub.version + ': LGPL-2.1-or-later AND (FTL OR GPL-2.0-or-later) AND MIT AND MIT-Modern-Variant AND ISC AND NTP AND Zlib AND BSL-1.0\n'
    + '(the wasm contains libass, FreeType, FriBidi, HarfBuzz and their dependencies; sources: https://github.com/ThaUnknown/jassub)\n'
    + 'abslink ' + PINS.abslink.version + ': MIT; lfa-ponyfill ' + PINS['lfa-ponyfill'].version + ': MIT\n');
  fs.writeFileSync(MARK, JSON.stringify(PINS, null, 2));
  console.log('[jassub] ' + PINS.jassub.version + ' laid out in ' + DIR);
}

main().catch((e) => {
  console[optional ? 'warn' : 'error']('[jassub] ' + e.message);
  if (!optional) process.exit(1);
});
