'use strict';

/* clean-library.js - a COPY of a library to hand to another person, with none of the giver's accounts in it - no API
   keys or buckets - and, by default, without the projects and their renders.

       node tools/clean-library.js --to <folder> [--from library] [--with-projects] [--allow-open]

   The source library is only READ (copied with robocopy); everything else happens in the copy:
     - not copied: logs\, backups\, cache\ (but its thumbnails - the recipient's processor need not make them again for
       twenty minutes - and its small records, cache\*.json), .env, data\telegram.json and data\tg-inbox.json (the source's bot);
     - data\settings.json: every key, token and secret gone, the Cloudflare / R2 / Telegram fields too - the recipient enters
       their own on Admin -> API keys;
     - the journal of generations and what the chats said: data\alerts.json, mv3-chat.json, mv3-gens.json,
       mv3-video-gens.json, audio-gens.json, mv3-queue.json - gone (their records name the source's kie.ai tasks and
       bucket links; what the chats made stays on the shelves);
     - without --with-projects: every project deleted BY THE APP ITSELF - the server is started on the copy (keys gone,
       nothing paid can start), each timeline deleted with its files as Merge deletes it (DELETE /api/mv3/timeline/:key
       ?files=1 - what a shelf still uses is moved to media\work first), each 3D Studio scene; then media\renders\;
       the two drafts (Merge's, the voiceover's) stay, as they always do.
   Refused while the app is open on the source library (port 38417 answers) - the copy would be torn. */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const say = (s) => console.log('[clean] ' + s);
const GONE_DATA = ['telegram.json', 'tg-inbox.json', 'alerts.json', 'mv3-chat.json', 'mv3-gens.json', 'mv3-video-gens.json',
  'audio-gens.json', 'mv3-queue.json'];
const SECRET_FIELD = /(key|token|secret|password|passwd)(id)?$/i;
const ACCOUNT_FIELD = /^(r2|cloudflare|telegram)/i;

async function answers(port) {
  try { return (await fetch(`http://127.0.0.1:${port}/api/ui-state`, { signal: AbortSignal.timeout(1500) })).ok; } catch (e) { return false; }
}

function robocopy(from, to, extra = []) {
  const r = spawnSync('robocopy', [from, to, '/E', '/MT:16', '/R:1', '/W:1', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', ...extra], { windowsHide: true, encoding: 'utf8' });
  if (r.error) throw r.error;
  if (r.status >= 8) throw new Error(`robocopy failed (${r.status}): ${(r.stdout || '').trim().split('\n').slice(-3).join(' ')}`);
}

function cleanSettings(file) {
  let s = {};
  try { s = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch (e) { return []; }
  const gone = [];
  for (const k of Object.keys(s)) {
    if (SECRET_FIELD.test(k) || ACCOUNT_FIELD.test(k)) { delete s[k]; gone.push(k); }
  }
  fs.writeFileSync(file, JSON.stringify(s, null, 2));
  return gone;
}

async function freePort() {
  const net = require('net');
  return new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
}

/** The app's own deletion of every project in the copy. Answers { timelines, scenes, left }. */
async function deleteProjects(lib) {
  const port = await freePort();
  const env = { ...process.env, UGC_DATA_DIR: lib, PORT: String(port) };
  delete env.UGC_HOME; delete env.UGC_VIDEO_FAKE; delete env.ELECTRON_RUN_AS_NODE;
  const out = fs.openSync(path.join(os.tmpdir(), `ugc-clean-${process.pid}.log`), 'w');
  const srv = spawn(process.execPath, ['server.js'], { cwd: REPO, env, stdio: ['ignore', out, out], windowsHide: true });
  const base = `http://127.0.0.1:${port}/api`;
  try {
    let up = false;
    for (let i = 0; i < 240 && !up; i++) { await new Promise((r) => setTimeout(r, 500)); up = await answers(port); }
    if (!up) throw new Error('the server did not come up on the copy');
    const j = async (method, url) => { const r = await fetch(base + url, { method }); let d = {}; try { d = await r.json(); } catch (e) { d = {}; } return { status: r.status, d }; };
    let timelines = 0;
    for (let pass = 0; pass < 6; pass++) {
      const { d } = await j('GET', '/mv3/timelines');
      const left = (d.list || []).filter((t) => !t.draft && !t.vodraft);
      if (!left.length) break;
      for (const t of left) {
        let r = await j('DELETE', `/mv3/timeline/${encodeURIComponent(t.key)}?files=1`);
        // Another timeline of the same project still uses its files: this one goes alone, the last takes the files.
        if (r.status === 409 && /Another timeline/i.test(r.d.error || '')) r = await j('DELETE', `/mv3/timeline/${encodeURIComponent(t.key)}`);
        if (r.status === 200) timelines++;
        else say(`timeline "${t.title}" not deleted: ${r.status} ${r.d.error || ''}`);
      }
    }
    let scenes = 0;
    const sc = await j('GET', '/3d/scenes');
    for (const s of (sc.d.scenes || sc.d.list || [])) {
      const r = await j('DELETE', `/3d/scenes/${encodeURIComponent(s.id)}`);
      if (r.status === 200) scenes++; else say(`3D scene "${s.name || s.id}" not deleted: ${r.status} ${r.d.error || ''}`);
    }
    const after = await j('GET', '/mv3/timelines');
    return { timelines, scenes, left: (after.d.list || []).map((t) => t.title) };
  } finally {
    spawnSync('taskkill', ['/pid', String(srv.pid), '/T', '/F'], { windowsHide: true });
    await new Promise((r) => setTimeout(r, 1500));
  }
}

// Paths of the source computer: a source the library only REMEMBERS (a highlights video read from a file outside it,
// `diskPath`) means nothing on the recipient's computer - removed by the store's own remove (it deletes only inside
// its library, here the copy; the original video is never touched); where a copied file came from (`intake.fromPath`)
// is forgotten.
function forgetOwnerPaths(lib) {
  const code = `
    const path = require('path'); const fs = require('fs');
    const S = require('./lib/sources-store');
    const { ROOT_DIR, DATA_DIR } = require('./lib/config');
    const root = path.resolve(ROOT_DIR).toLowerCase() + path.sep;
    let gone = 0, blank = 0;
    for (const s of [].concat(S.list() || [])) {
      if (s && s.diskPath && !path.resolve(String(s.diskPath)).toLowerCase().startsWith(root)) { S.remove(s.id, { keepWords: false }); gone++; }
    }
    const f = path.join(DATA_DIR, 'sources.json');
    if (fs.existsSync(f)) {
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      for (const s of (j.sources || [])) if (s && s.intake && s.intake.fromPath) { delete s.intake.fromPath; blank++; }
      require('./lib/atomic-write').writeFileAtomic(f, JSON.stringify(j, null, 2));
    }
    console.log(JSON.stringify({ gone, blank }));`;
  const env = { ...process.env, UGC_DATA_DIR: lib };
  delete env.UGC_HOME; delete env.ELECTRON_RUN_AS_NODE;
  const r = spawnSync(process.execPath, ['-e', code], { cwd: REPO, env, encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error('the paths of this computer were not forgotten: ' + (r.stderr || '').trim().split('\n').pop());
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

// A project with no timeline of its own (an old talking head, a migrated one) has no route that deletes it: the very
// function the routes call, lib/projects-store.js `remove` (what a shelf uses moved to media\work first), in a node
// of its own on the copy - the server stopped. The drafts stay: Merge's (its timeline's folder) and the voiceover's.
function deleteLeftProjects(lib) {
  const code = `
    const P = require('./lib/projects-store');
    const M = require('./lib/merge-store');
    const keep = new Set();
    const s = M.read();
    for (const [k, t] of Object.entries(s.timelines || {})) {
      if (!t || !t.draft) continue;
      const at = M.locate(k);
      if (at && at.folder) keep.add(String(at.folder).toLowerCase());
    }
    let removed = 0, moved = 0;
    for (const e of P.entries()) {
      const rec = P.get(e.id) || {};
      if (rec.draft || keep.has(String(e.folder).toLowerCase())) continue;
      try { const r = P.remove(e.id); removed++; moved += r.moved || 0; } catch (err) { console.log('not removed: ' + e.folder + ' - ' + err.message); }
    }
    console.log(JSON.stringify({ removed, moved, left: P.entries().map((e) => e.folder) }));`;
  const env = { ...process.env, UGC_DATA_DIR: lib };
  delete env.UGC_HOME; delete env.ELECTRON_RUN_AS_NODE;
  const r = spawnSync(process.execPath, ['-e', code], { cwd: REPO, env, encoding: 'utf8', windowsHide: true, maxBuffer: 1 << 24 });
  if (r.status !== 0) throw new Error('the projects left were not deleted: ' + (r.stderr || '').trim().split('\n').pop());
  const lines = r.stdout.trim().split('\n');
  for (const l of lines.slice(0, -1)) say(l);
  return JSON.parse(lines[lines.length - 1]);
}

async function cleanCopy({ from, to, withProjects = false, allowOpen = false }) {
  const src = path.resolve(from);
  const dest = path.resolve(to);
  if (!fs.existsSync(path.join(src, 'data'))) throw new Error('not a library: ' + src);
  if (fs.existsSync(dest) && fs.readdirSync(dest).length) throw new Error('the folder is not empty: ' + dest);
  if (!allowOpen && await answers(38417)) throw new Error('UGC Studio is open - close it first, or the copy would be torn');
  const t0 = Date.now();

  robocopy(src, dest, ['/XD', path.join(src, 'cache'), path.join(src, 'logs'), path.join(src, 'backups'), '/XF', '.env', '*.tmp',
    ...GONE_DATA.map((n) => path.join(src, 'data', n))]);
  if (fs.existsSync(path.join(src, 'cache', 'thumbs'))) robocopy(path.join(src, 'cache', 'thumbs'), path.join(dest, 'cache', 'thumbs'));
  // The small records the app keeps in cache\ (render-posters.json - the renders' posters already made): without them
  // the recipient's first start would do that work again.
  const marks = [];
  for (const e of fs.existsSync(path.join(src, 'cache')) ? fs.readdirSync(path.join(src, 'cache'), { withFileTypes: true }) : []) {
    if (!e.isFile() || !/\.json$/i.test(e.name)) continue;
    fs.mkdirSync(path.join(dest, 'cache'), { recursive: true });
    fs.copyFileSync(path.join(src, 'cache', e.name), path.join(dest, 'cache', e.name));
    marks.push(e.name);
  }
  say(`copied in ${((Date.now() - t0) / 1000).toFixed(0)} s`);

  const gone = cleanSettings(path.join(dest, 'data', 'settings.json'));
  say(`settings: ${gone.length} fields taken out (${gone.join(', ')})`);
  for (const n of GONE_DATA) fs.rmSync(path.join(dest, 'data', n), { force: true });

  let projects = null;
  if (!withProjects) {
    projects = await deleteProjects(dest);
    say(`projects: ${projects.timelines} timelines and ${projects.scenes} 3D scenes deleted by the app; left: ${projects.left.join(', ') || 'none'}`);
    const rest = deleteLeftProjects(dest);
    projects.withoutTimeline = rest.removed;
    say(`projects with no timeline of their own: ${rest.removed} deleted (${rest.moved} files a shelf uses moved to media\\work); left: ${rest.left.join(', ') || 'none'}`);
    fs.rmSync(path.join(dest, 'media', 'renders'), { recursive: true, force: true });
    // What the server's start made, and what it went on to write.
    for (const n of GONE_DATA) fs.rmSync(path.join(dest, 'data', n), { force: true });
  }
  const paths = forgetOwnerPaths(dest);
  say(`paths of this computer: ${paths.gone} source(s) read from a file outside the library removed, ${paths.blank} "copied from" forgotten`);
  for (const d of ['logs', 'backups']) fs.rmSync(path.join(dest, d), { recursive: true, force: true });
  for (const d of fs.existsSync(path.join(dest, 'cache')) ? fs.readdirSync(path.join(dest, 'cache')) : []) {
    if (d !== 'thumbs' && !marks.includes(d)) fs.rmSync(path.join(dest, 'cache', d), { recursive: true, force: true });
  }
  say(`a clean copy in ${dest} - ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  return { dest, settingsGone: gone, projects };
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
  cleanCopy({ from: arg('--from', path.join(REPO, 'library')), to: arg('--to', ''), withProjects: argv.includes('--with-projects'), allowOpen: argv.includes('--allow-open') })
    .catch((e) => { console.error('[clean] ' + e.message); process.exit(1); });
}

module.exports = { cleanCopy, cleanSettings };
