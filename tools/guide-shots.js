'use strict';

/* guide-shots.js - THE GUIDE'S PICTURES, made again by one command.

       node tools/guide-shots.js --library <a library with no keys> [--only a,b] [--base http://127.0.0.1:<port>]
       node tools/guide-shots.js --check
   --list <file> another list than tools/guide-shots.json, --out <folder> another folder than public/guide/shots (a preview).
   The README's pictures are such a list: --list tools/readme-shots.json --out docs/readme. A list with no `masks` of its
   own takes the guide's, so the private words are kept in one place.

   Every picture of the guide (public/guide/<nn>-<name>.md, `![…](shots/<name>.webp)`) is a row of tools/guide-shots.json:
   the page it is taken on, the steps that bring the app to the moment (eval, click - the page's own events; press, hover
   - the mouse's real ones, `button` "right" or a `double` press; drag - the real mouse from one point of an element to
   another; key; wait; waitFor), what is put in
   place of private words in the frame (the file's `masks`, by name), and what is cut out of the window (`crop`: a
   selector - "sel@2" its third match -, several - the box round them all -, a box [x, y, w, h], or the whole window). The app is the one in this folder: its server is started on the library given (or `--base` names one
   already running), a HIDDEN Electron window - the size and scale of the file - goes through the rows in order, and each
   picture becomes public/guide/shots/<name>.webp.

   The library must hold NO KEYS (a test copy): a library whose settings carry a key is refused, so neither a key nor a
   balance can reach a picture and no step can spend anything. The server is started with UGC_KEYS_OPEN=1, so the places
   that need a key are drawn open as a person with keys sees them (`--base` names a server that must be started so too).
   What a library with no keys cannot have at all - an assistant's conversation - a row takes from RECORDED ANSWERS:
   `answers` { "<address>": "<file>" } - a GET of exactly that address is answered with the JSON of tools/guide-answers/<file>,
   recorded once on a library with keys.
   Nothing is written into the library by this tool; the app's own start may write what it always writes.

   --check  says, without starting anything, which pictures a chapter names that the file has no row for, which rows have
            no picture yet, and which pictures no chapter names.
   Every child process is stopped by its own id when the run ends. */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');

const APP = path.join(__dirname, '..');
const LIST = arg('--list') ? path.resolve(arg('--list')) : path.join(__dirname, 'guide-shots.json');
const GUIDE = path.join(APP, 'public', 'guide');
const SHOTS = arg('--out') ? path.resolve(arg('--out')) : path.join(GUIDE, 'shots');

function arg(k) { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : ''; }
const say = (s) => console.log('[shots] ' + s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function guideMasks() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'guide-shots.json'), 'utf8')).masks || {};
}

function readList() {
  const j = JSON.parse(fs.readFileSync(LIST, 'utf8'));
  if (!Array.isArray(j.shots)) throw new Error('tools/guide-shots.json has no shots');
  return j;
}

// The pictures the chapters name: name -> [chapter files].
function named() {
  const out = new Map();
  for (const f of fs.readdirSync(GUIDE).filter((n) => /\.md$/.test(n))) {
    const text = fs.readFileSync(path.join(GUIDE, f), 'utf8');
    for (const m of text.matchAll(/!\[[^\]]*\]\(shots\/([a-z0-9-]+)\.webp\)/g)) out.set(m[1], (out.get(m[1]) || []).concat(f));
  }
  return out;
}

function check() {
  const list = readList();
  const rows = new Set(list.shots.map((s) => s.name));
  const files = new Set(fs.existsSync(SHOTS) ? fs.readdirSync(SHOTS).filter((n) => /\.webp$/.test(n)).map((n) => n.replace(/\.webp$/, '')) : []);
  const want = named();
  const noRow = [...want.keys()].filter((n) => !rows.has(n));
  const noFile = [...rows].filter((n) => !files.has(n));
  const unused = [...files].filter((n) => !want.has(n));
  say(rows.size + ' rows, ' + files.size + ' pictures, ' + want.size + ' named in chapters');
  if (noRow.length) say('named in a chapter, no row: ' + noRow.join(', '));
  if (noFile.length) say('a row, no picture yet: ' + noFile.join(', '));
  if (unused.length) say('a picture no chapter names: ' + unused.join(', '));
  return noRow.length || noFile.length ? 1 : 0;
}

// A library is refused when its settings carry anything like a key.
function keysIn(lib) {
  let s = {};
  try { s = JSON.parse(fs.readFileSync(path.join(lib, 'data', 'settings.json'), 'utf8').replace(/^﻿/, '')); } catch (e) { return []; }
  return Object.keys(s).filter((k) => /(key|token|secret|password)$/i.test(k) && String(s[k] || '').trim());
}

async function freePort() {
  const net = require('net');
  return new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
}

async function answers(base) {
  try { return (await fetch(base + '/api/ui-state', { signal: AbortSignal.timeout(1500) })).ok; } catch (e) { return false; }
}

const stop = (pid) => new Promise((res) => execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => res()));

async function main() {
  if (process.argv.includes('--check')) { process.exitCode = check(); return; }
  const list = readList();
  const only = new Set(String(arg('--only') || '').split(',').map((s) => s.trim()).filter(Boolean));
  const shots = list.shots.filter((s) => !only.size || only.has(s.name));
  if (!shots.length) throw new Error('no row by those names');
  // A row's recorded answers: { "<address>": "<file of tools/guide-answers/>" } - read here, handed to the page as they are.
  for (const s of shots) {
    if (!s.answers) continue;
    s.answerData = {};
    for (const [url, file] of Object.entries(s.answers)) {
      s.answerData[url] = JSON.parse(fs.readFileSync(path.join(__dirname, 'guide-answers', path.basename(file)), 'utf8'));
    }
  }
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'guide-shots-'));
  const kids = [];
  try {
    let base = String(arg('--base') || '').replace(/\/+$/, '');
    if (!base) {
      const lib = path.resolve(arg('--library') || '');
      if (!arg('--library') || !fs.existsSync(path.join(lib, 'data'))) throw new Error('--library <a library with no keys> is needed');
      if (path.resolve(lib).toLowerCase() === path.join(APP, 'library').toLowerCase()) throw new Error('never the working library - a test copy');
      const keys = keysIn(lib);
      if (keys.length) throw new Error('this library has keys (' + keys.join(', ') + ') - a copy without keys is needed');
      const port = await freePort();
      const log = fs.openSync(path.join(work, 'server.log'), 'w');
      const srv = spawn(process.execPath, [path.join(APP, 'server.js')], {
        cwd: APP, env: Object.assign({}, process.env, { UGC_DATA_DIR: lib, PORT: String(port), UGC_VIDEO_FAKE: '', UGC_KEYS_OPEN: '1' }),
        stdio: ['ignore', log, log], windowsHide: true });
      kids.push(srv.pid);
      base = 'http://127.0.0.1:' + port;
      for (let i = 0; i < 120 && !(await answers(base)); i++) await sleep(500);
      if (!(await answers(base))) throw new Error('the app did not start - ' + path.join(work, 'server.log'));
      say('the app on ' + base + ' over ' + lib);
    } else if (!(await answers(base))) throw new Error('nothing answers at ' + base);

    const job = { base, size: list.size || [1536, 864], scale: list.scale || 2, masks: list.masks || guideMasks(), shots, out: work,
                  profile: path.join(work, 'profile') };
    fs.writeFileSync(path.join(work, 'job.json'), JSON.stringify(job));
    const electron = require('electron');
    const cam = spawn(electron, [__filename, '--job', path.join(work, 'job.json')], { cwd: APP, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    kids.push(cam.pid);
    cam.stdout.on('data', (d) => process.stdout.write(String(d)));
    cam.stderr.on('data', (d) => { const t = String(d); if (/error/i.test(t) && !/GPU|gpu_|Autofill/.test(t)) process.stderr.write(t); });
    const code = await new Promise((r) => cam.on('exit', r));
    if (code) throw new Error('the camera stopped with ' + code);

    const sharp = require('sharp');
    sharp.cache(false);
    fs.mkdirSync(SHOTS, { recursive: true });
    let bytes = 0;
    for (const s of shots) {
      const png = path.join(work, s.name + '.png');
      if (!fs.existsSync(png)) { say(s.name + ': no picture'); process.exitCode = 1; continue; }
      const out = path.join(SHOTS, s.name + '.webp');
      let img = sharp(png);
      if (s.width) img = img.resize({ width: s.width, withoutEnlargement: true });
      await img.webp({ quality: s.quality || 82 }).toFile(out + '.tmp');
      fs.renameSync(out + '.tmp', out);
      const n = fs.statSync(out).size;
      bytes += n;
      say(s.name + '.webp ' + Math.round(n / 1024) + ' KB');
    }
    say(shots.length + ' pictures, ' + (bytes / 1048576).toFixed(1) + ' MB');
  } finally {
    for (const pid of kids.reverse()) await stop(pid);
    fs.rmSync(work, { recursive: true, force: true });
  }
}

// ── The camera's side (Electron) ─────────────────────────────────────────────
// What a page gets before its steps: __mask(rules) - every text node, field, placeholder and title the rules match
// rewritten, now and on every change; __click(selector or element); the app's popups in the corner hidden; no caret; no
// animation or transition - a window that only appears would stay at its first frame in a hidden window.
const HELPERS = `(() => {
  if (window.__mask) return true;
  const st = document.createElement('style');
  st.textContent = '.sv3-toasts{display:none!important} *{caret-color:transparent!important}'
    + ' *,*::before,*::after{animation:none!important;transition:none!important}';
  document.head.appendChild(st);
  let rules = [];
  const esc = (s) => s.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&');
  const apply = (s) => { let o = s; for (const [re, rep] of rules) o = o.replace(re, rep); return o; };
  const walk = (root) => {
    if (!rules.length || !root) return;
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n; while ((n = tw.nextNode())) { const v = n.nodeValue; if (v && v.trim()) { const w = apply(v); if (w !== v) n.nodeValue = w; } }
    for (const e of root.querySelectorAll('input,textarea')) {
      const w = apply(e.value || ''); if (w !== e.value) e.value = w;
      const p = e.getAttribute('placeholder'); if (p) { const q = apply(p); if (q !== p) e.setAttribute('placeholder', q); }
    }
    for (const e of root.querySelectorAll('[title]')) { const t = e.getAttribute('title'); const w = apply(t); if (w !== t) e.setAttribute('title', w); }
    for (const e of root.querySelectorAll('option')) { const t = e.textContent; const w = apply(t); if (w !== t) e.textContent = w; }
  };
  let mo = null;
  window.__mask = (r) => {
    rules = rules.concat((r || []).map(([f, rep, kind]) => [new RegExp(kind === 're' ? f : esc(f), 'g' + (kind === 're' ? 'i' : '')), rep]));
    walk(document.body);
    if (!mo) { mo = new MutationObserver(() => walk(document.body)); mo.observe(document.body, { subtree: true, childList: true, characterData: true }); }
    return true;
  };
  window.__click = (sel, o = {}) => {
    const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
    if (!el) throw new Error('nothing to press: ' + sel);
    const b = el.getBoundingClientRect();
    const x = b.x + (o.fx != null ? o.fx : 0.5) * b.width, y = b.y + (o.fy != null ? o.fy : 0.5) * b.height;
    const base = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: o.button || 0, buttons: o.button === 2 ? 2 : 1, view: window,
      shiftKey: !!o.shift, ctrlKey: !!o.ctrl, pointerId: 1, pointerType: 'mouse', isPrimary: true };
    el.dispatchEvent(new PointerEvent('pointerover', base));
    el.dispatchEvent(new PointerEvent('pointerdown', base));
    el.dispatchEvent(new MouseEvent('mousedown', base));
    el.dispatchEvent(new PointerEvent('pointerup', { ...base, buttons: 0 }));
    el.dispatchEvent(new MouseEvent('mouseup', { ...base, buttons: 0 }));
    if (o.button === 2) el.dispatchEvent(new MouseEvent('contextmenu', { ...base, buttons: 0 }));
    else el.dispatchEvent(new MouseEvent('click', { ...base, buttons: 0 }));
    return true;
  };
  window.__settled = async () => {
    await document.fonts.ready;
    const imgs = [...document.images].filter((i) => i.offsetParent && i.getAttribute('src'));
    await Promise.all(imgs.map((i) => (i.complete && i.naturalWidth) ? 1 : new Promise((r) => { i.addEventListener('load', r, { once: true }); i.addEventListener('error', r, { once: true }); setTimeout(r, 8000); })));
    // Decoded before the frame - only what has loaded (a lazy picture out of view never loads), and never longer than 5 s.
    await Promise.all(imgs.filter((i) => i.complete && i.naturalWidth && i.decode).map((i) => Promise.race([i.decode().catch(() => {}), new Promise((r) => setTimeout(r, 5000))])));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return true;
  };
  window.__el = (sel) => {
    const m = /^(.*)@([0-9]+)$/.exec(sel);
    return m ? document.querySelectorAll(m[1])[+m[2]] || null : document.querySelector(sel);
  };
  window.__rect = (sel, pad) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    if (Array.isArray(sel) && typeof sel[0] === 'number') { [x0, y0] = sel; x1 = sel[0] + sel[2]; y1 = sel[1] + sel[3]; }
    else for (const one of [].concat(sel)) {
      const el = __el(one);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.right); y1 = Math.max(y1, b.bottom);
    }
    const p = pad || 0;
    const x = Math.max(0, Math.floor(x0 - p)), y = Math.max(0, Math.floor(y0 - p));
    return { x, y, width: Math.min(innerWidth - x, Math.ceil(x1 - x0 + 2 * p)), height: Math.min(innerHeight - y, Math.ceil(y1 - y0 + 2 * p)) };
  };
  window.__at = (sel, fx, fy) => {
    const el = __el(sel);
    if (!el) return null;
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const b = el.getBoundingClientRect();
    return { x: Math.round(b.x + (fx == null ? 0.5 : fx) * b.width), y: Math.round(b.y + (fy == null ? 0.5 : fy) * b.height) };
  };
  window.__byText = (sel, text) => [...document.querySelectorAll(sel)].find((e) => e.textContent.trim() === text) || null;
  // Recorded answers: a GET of exactly one of these addresses (path and query) is answered with its JSON instead of the
  // server's - what a library with no keys cannot show, recorded once on a library with them.
  window.__answer = (map) => {
    if (!window.__fetch0) window.__fetch0 = window.fetch;
    const f0 = window.__fetch0;
    window.fetch = (u, o) => {
      const url = String((u && u.url) || u).replace(location.origin, '');
      const get = !o || !o.method || String(o.method).toUpperCase() === 'GET';
      return get && Object.prototype.hasOwnProperty.call(map, url)
        ? Promise.resolve(new Response(JSON.stringify(map[url]), { headers: { 'Content-Type': 'application/json' } }))
        : f0(u, o);
    };
    return true;
  };
  return true;
})()`;

function camera() {
  const { app, BrowserWindow } = require('electron');
  const job = JSON.parse(fs.readFileSync(arg('--job'), 'utf8'));
  app.commandLine.appendSwitch('force-device-scale-factor', String(job.scale));
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
  app.setPath('userData', job.profile);
  app.whenReady().then(async () => {
    const win = new BrowserWindow({ width: job.size[0], height: job.size[1], useContentSize: true, show: false, paintWhenInitiallyHidden: true,
      frame: false, webPreferences: { backgroundThrottling: false } });
    win.webContents.setAudioMuted(true);
    const wc = win.webContents;
    const js = (code) => wc.executeJavaScript(code, true);
    let at = '';
    let failed = 0;
    for (const s of job.shots) {
      try {
        const size = s.size || job.size;
        const [cw, ch] = win.getContentSize();
        if (cw !== size[0] || ch !== size[1]) win.setContentSize(size[0], size[1]);
        if (s.page && (s.page !== at || s.reload)) {
          // A shelf of many large pictures may keep the page loading for minutes: past 20 s the steps go on,
          // and only the pictures in view are waited for (__settled).
          await Promise.race([wc.loadURL(job.base + s.page).catch(() => {}), sleep(s.loadMs || 20000)]);
          at = s.page;
          await sleep(s.settle || 1500);
        }
        await js(HELPERS);
        const rules = [].concat(...(s.mask || []).map((m) => job.masks[m] || []), s.rules || []);
        if (rules.length) await js('__mask(' + JSON.stringify(rules) + ')');
        if (s.answerData) await js('__answer(' + JSON.stringify(s.answerData) + ')');
        for (const st of s.steps || []) {
          if (st.eval) await js('(async () => { ' + st.eval + ' })()');
          else if (st.click) await js('__click(' + JSON.stringify(st.click) + ', ' + JSON.stringify(st.opts || {}) + ')');
          else if (st.waitFor) {
            const until = Date.now() + (st.ms || 15000);
            while (!(await js('!!document.querySelector(' + JSON.stringify(st.waitFor) + ')')) && Date.now() < until) await sleep(150);
          } else if (st.press || st.hover) {
            const sel = st.press || st.hover;
            const p = await js('__at(' + JSON.stringify(sel) + ', ' + (st.fx == null ? 'null' : st.fx) + ', ' + (st.fy == null ? 'null' : st.fy) + ')');
            if (!p) throw new Error('nothing to press: ' + sel);
            wc.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y });
            if (st.press) {
              const button = st.button || 'left';
              const clickCount = st.double ? 2 : 1;
              wc.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button, clickCount, modifiers: st.mods || [] });
              wc.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button, clickCount, modifiers: st.mods || [] });
            }
          } else if (st.drag) {
            // A drag with the real mouse inside one element, from one point to another (fractions of its box) - a band, a
            // fragment drawn over a wave.
            const at = (p) => js('__at(' + JSON.stringify(st.drag) + ', ' + p[0] + ', ' + p[1] + ')');
            const a0 = await at(st.from || [0.2, 0.5]);
            const b0 = await at(st.to || [0.8, 0.5]);
            if (!a0 || !b0) throw new Error('nothing to drag on: ' + st.drag);
            wc.sendInputEvent({ type: 'mouseMove', x: a0.x, y: a0.y });
            wc.sendInputEvent({ type: 'mouseDown', x: a0.x, y: a0.y, button: 'left', clickCount: 1 });
            for (let k = 1; k <= 10; k++) {
              wc.sendInputEvent({ type: 'mouseMove', x: Math.round(a0.x + (b0.x - a0.x) * k / 10), y: Math.round(a0.y + (b0.y - a0.y) * k / 10), modifiers: ['leftButtonDown'] });
              await sleep(25);
            }
            wc.sendInputEvent({ type: 'mouseUp', x: b0.x, y: b0.y, button: 'left', clickCount: 1 });
          } else if (st.key) {
            for (const type of ['keyDown', 'char', 'keyUp']) if (type !== 'char' || st.key.length === 1) wc.sendInputEvent({ type, keyCode: st.key, modifiers: st.mods || [] });
          }
          if (st.wait) await sleep(st.wait);
        }
        await js('__settled()');
        await sleep(s.wait || 400);
        const rect = s.crop ? await js('__rect(' + JSON.stringify(s.crop) + ', ' + (s.pad || 0) + ')') : null;
        if (s.crop && !rect) throw new Error('nothing to cut out: ' + JSON.stringify(s.crop));
        const img = rect ? await wc.capturePage(rect) : await wc.capturePage();
        fs.writeFileSync(path.join(job.out, s.name + '.png'), img.toPNG());
        console.log('[shots] ' + s.name + ' taken (' + img.getSize().width + '×' + img.getSize().height + ')');
        if (s.after) await js('(async () => { ' + s.after + ' })()');
        if (s.escape) for (let k = 0; k < s.escape; k++) { wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' }); await sleep(250); }
      } catch (e) {
        failed++;
        console.log('[shots] ' + s.name + ' FAILED: ' + String((e && e.message) || e).slice(0, 300));
      }
    }
    if (failed) console.log("[shots] " + failed + " not taken");
    app.exit(0);
  });
}

// Run by Node: the whole job; run by Electron (this same file, started by the job): the camera.
if (process.versions.electron) camera();
else main().catch((e) => { console.error('[shots] ' + (e && e.message ? e.message : e)); process.exitCode = 1; });
