'use strict';

/* fetch-camera.js - the camera movements of the video chat's prompt reference (phase V14, docs/local-app/PLAN.md
   "Фаза V14"): the 46 moves of https://aicameramovements.com in its 7 categories - each move's name and prompt as the
   site writes them, and its preview made small - laid out in public/presets/helper/ (shipped with the program, like
   the character presets in public/presets/; the owner, 2026-10-07: "встраиваем").

   Run by hand, once - and again when the site changes:
       node tools/fetch-camera.js            read the site, fetch every preview, make the small ones, write camera.json;
                                             a run that broke off goes on where it stopped (made previews are kept)
       node tools/fetch-camera.js --again    every preview made anew
       node tools/fetch-camera.js --check    what the site holds now against camera.json (added, gone, reworded);
                                             nothing is fetched but the page, nothing is written

   Each preview - an mp4 of 1920x1080 and 15 s, 3-13 MB - becomes two files beside camera.json:
     camera/<name>.webp        a still, 320 px wide, from half a second in
     camera/<name>.loop.webp   the whole move at twice its speed, 12 frames a second, 320 px wide, looping - an
                               animated WebP: a moving picture like a GIF, at about a seventh of a GIF's weight
                               (measured on "dolly in": GIF 3.9 MB, this 0.58 MB)
   The mp4s are fetched into the system's temp folder and deleted as soon as each is made small.

   The site states no licence - it calls itself "a free reference for AI filmmakers". What ships is credited to it on
   Admin -> Thanks and in camera.json's `source`, and goes at its author's request. */

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

const SITE = 'https://aicameramovements.com/';
const OUT = path.join(__dirname, '..', 'public', 'presets', 'helper');
const MEDIA = path.join(OUT, 'camera');
const FILE = path.join(OUT, 'camera.json');
const CHECK = process.argv.includes('--check');
const UA = 'Mozilla/5.0 (UGC Studio camera reference)';
// What the site's page must hold for its cards to be read as cards - a page of another shape stops the tool.
const WANT = { items: 46, cats: 7 };

// ── Reading ─────────────────────────────────────────────────────────────────
function _get(url, toFile) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': UA }, timeout: 60000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(_get(new URL(res.headers.location, url).toString(), toFile));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(url + ' answered ' + res.statusCode)); }
      if (toFile) {
        const ws = fs.createWriteStream(toFile);
        res.pipe(ws);
        ws.on('finish', () => ws.close(() => resolve(toFile)));
        ws.on('error', reject);
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('timeout', () => req.destroy(new Error(url + ': no answer in a minute')));
    req.on('error', reject);
  });
}

// A name that did not resolve, a reset, no answer in a minute: asked again, a little later each time.
async function _getAgain(url, toFile) {
  const waits = [2000, 5000, 12000, 30000];
  for (let i = 0; ; i++) {
    try { return await _get(url, toFile); } catch (e) {
      if (i >= waits.length || / answered (4\d\d)/.test(e.message)) throw e;
      console.warn('[fetch-camera] ' + e.message + ' - again in ' + waits[i] / 1000 + ' s');
      await new Promise(r => setTimeout(r, waits[i]));
    }
  }
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const _text = (s) => String(s || '')
  .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => (e[0] === '#'
    ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
    : (ENT[e.toLowerCase()] != null ? ENT[e.toLowerCase()] : m)))
  .replace(/\s+/g, ' ').trim();
const _slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** The page's categories (its filter buttons, in their order) and its cards. */
function parse(html) {
  const cats = [];
  const fre = /<button[^>]*\bdata-filter="([^"]+)"[^>]*>\s*<span>([^<]*)<\/span>\s*<small>(\d+)<\/small>/g;
  let m;
  while ((m = fre.exec(html))) {
    const label = _text(m[2]);
    if (_text(m[1]) === 'All') continue;
    cats.push({ id: _slug(label), label, count: +m[3] });
  }
  const items = [];
  const are = /<article\b[^>]*\bclass="card\b[^"]*"[^>]*>([\s\S]*?)<\/article>/g;
  while ((m = are.exec(html))) {
    const open = m[0].slice(0, m[0].indexOf('>') + 1);
    const body = m[1];
    const id = (/\bid="shot-([^"]+)"/.exec(open) || [])[1] || '';
    const group = _text((/\bdata-group="([^"]+)"/.exec(open) || [])[1]);
    const video = (/<video\b[^>]*\bsrc="([^"]+)"/.exec(body) || [])[1] || '';
    const shot = _text((/<span class="shot-id">([^<]*)<\/span>/.exec(body) || [])[1]);
    const name = _text((/<h2>([\s\S]*?)<\/h2>/.exec(body) || [])[1]);
    // What the site's own "Copy prompt" copies - the move, labelled "Camera:" - else its prompt as shown.
    const copy = _text((/\bdata-copy="([^"]*)"/.exec(body) || [])[1]);
    const shown = _text((/<pre>([\s\S]*?)<\/pre>/.exec(body) || [])[1]);
    const prompt = copy || (shown ? 'Camera: ' + shown : '');
    if (!id || !group || !video || !name || !prompt) throw new Error('a card the tool cannot read: ' + open.slice(0, 120));
    const base = path.basename(video).replace(/\.mp4$/i, '').replace(/-hq$/i, '');
    items.push({ id: id.toLowerCase(), shot, cat: _slug(group), name, prompt, src: new URL(video, SITE).toString(), base });
  }
  return { cats, items };
}

function _check(page) {
  if (page.items.length !== WANT.items || page.cats.length !== WANT.cats) {
    throw new Error('the page holds ' + page.items.length + ' moves in ' + page.cats.length + ' categories, not '
      + WANT.items + ' in ' + WANT.cats + ' - read it by hand before trusting it (and change WANT)');
  }
  for (const c of page.cats) {
    const n = page.items.filter(i => i.cat === c.id).length;
    if (n !== c.count) throw new Error(c.label + ' says ' + c.count + ' moves, its cards are ' + n);
  }
  const ids = new Set(page.items.map(i => i.id));
  if (ids.size !== page.items.length) throw new Error('two cards share an id');
}

// ── Making it small ─────────────────────────────────────────────────────────
function _ff(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, ['-hide_banner', '-v', 'error', '-y'].concat(args), { windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error('ffmpeg ' + code + ': ' + err.slice(-300)))));
  });
}

async function _small(mp4, base) {
  const still = path.join(MEDIA, base + '.webp');
  const loop = path.join(MEDIA, base + '.loop.webp');
  await _ff(['-ss', '0.5', '-i', mp4, '-vf', 'scale=320:-2:flags=lanczos', '-frames:v', '1', '-c:v', 'libwebp', '-quality', '75', still]);
  await _ff(['-i', mp4, '-vf', 'setpts=0.5*PTS,fps=12,scale=320:-2:flags=lanczos', '-an', '-c:v', 'libwebp_anim',
    '-lossless', '0', '-quality', '60', '-compression_level', '6', '-loop', '0', loop]);
  return { still: fs.statSync(still).size, loop: fs.statSync(loop).size };
}

// ── The run ─────────────────────────────────────────────────────────────────
// Only when run: a stand requires it for `parse`.
if (require.main === module) (async () => {
  console.log('[fetch-camera] reading', SITE);
  const page = parse(await _getAgain(SITE));
  _check(page);

  if (CHECK) {
    let had = null;
    try { had = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { /* none yet */ }
    if (!had) { console.log('[fetch-camera] no camera.json yet - run it without --check'); return; }
    const old = new Map((had.items || []).map(i => [i.id, i]));
    const now = new Map(page.items.map(i => [i.id, i]));
    const added = page.items.filter(i => !old.has(i.id)).map(i => i.id + ' ' + i.name);
    const gone = (had.items || []).filter(i => !now.has(i.id)).map(i => i.id + ' ' + i.name);
    const changed = page.items.filter(i => old.has(i.id) && (old.get(i.id).prompt !== i.prompt || old.get(i.id).name !== i.name || old.get(i.id).cat !== i.cat)).map(i => i.id + ' ' + i.name);
    console.log('[fetch-camera] added:', added.length ? added.join(', ') : 'none');
    console.log('[fetch-camera] gone:', gone.length ? gone.join(', ') : 'none');
    console.log('[fetch-camera] reworded or moved:', changed.length ? changed.join(', ') : 'none');
    return;
  }

  fs.mkdirSync(MEDIA, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ugc-camera-'));
  let total = 0;
  // A run that broke off goes on where it stopped: a move whose two previews are made is not fetched again
  // (--again makes every one anew - after the site changed its videos).
  const again = process.argv.includes('--again');
  const made = (b) => ['.webp', '.loop.webp'].every(x => { try { return fs.statSync(path.join(MEDIA, b + x)).size > 0; } catch (e) { return false; } });
  try {
    for (const [n, it] of page.items.entries()) {
      const tag = '[fetch-camera] ' + String(n + 1).padStart(2) + '/' + page.items.length + ' ' + it.name.padEnd(36);
      if (!again && made(it.base)) {
        const s = ['.webp', '.loop.webp'].reduce((a, x) => a + fs.statSync(path.join(MEDIA, it.base + x)).size, 0);
        total += s;
        console.log(tag + 'made before');
        continue;
      }
      const mp4 = path.join(tmp, it.base + '.mp4');
      await _getAgain(it.src, mp4);
      const got = fs.statSync(mp4).size;
      const s = await _small(mp4, it.base);
      fs.unlinkSync(mp4);
      total += s.still + s.loop;
      console.log(tag + (got / 1048576).toFixed(1) + ' MB -> ' + (s.loop / 1024).toFixed(0) + ' KB + ' + (s.still / 1024).toFixed(0) + ' KB');
    }
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* the system cleans its temp */ }
  }

  const doc = {
    v: 1,
    source: {
      name: 'AI Camera Movements', url: SITE, fetched: new Date().toISOString().slice(0, 10),
      note: 'A free reference for AI filmmakers: each move\'s name and prompt as the site writes them, its preview made small here.',
    },
    cats: page.cats,
    items: page.items.map(i => ({ id: i.id, shot: i.shot, cat: i.cat, name: i.name, prompt: i.prompt,
      still: 'camera/' + i.base + '.webp', loop: 'camera/' + i.base + '.loop.webp' })),
  };
  fs.writeFileSync(FILE, JSON.stringify(doc, null, 2) + '\n');
  // Previews of moves the site no longer has go with them.
  const keep = new Set(doc.items.flatMap(i => [path.basename(i.still), path.basename(i.loop)]));
  for (const f of fs.readdirSync(MEDIA)) if (!keep.has(f)) fs.unlinkSync(path.join(MEDIA, f));
  console.log('[fetch-camera] ' + doc.items.length + ' moves in ' + doc.cats.length + ' categories, previews '
    + (total / 1048576).toFixed(1) + ' MB -> ' + path.relative(path.join(__dirname, '..'), FILE));
})().catch((e) => { console.error('[fetch-camera] ' + e.message); process.exit(1); });

module.exports = { parse };
