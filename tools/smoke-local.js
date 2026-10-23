'use strict';

/* smoke-local.js - does the local app still boot and answer, after a change.

   Run from the checkout, against a server that is already up:
       node tools/smoke-local.js [port]
   The port defaults to PORT in the library's .env, else 3100. Everything goes to 127.0.0.1.

   What it asks:
     - every page, a few shipped assets, and every GET route that takes no parameters;
     - a thumbnail of a shipped preset, and a 1K preview of a shipped mannequin - filed in the
       library's cache/poses/, and removed again at the end if this run made it;
     - the settings view: no secret and no retired key reaches the page;
     - the routes that were removed still answer 404;
     - every package.json dependency is thanked on Admin -> Thanks (public/js/admin-thanks.js);
     - (said, not failed) whether whisper.cpp for recognition on this computer is in vendor/whisper.
   It spends nothing: no request here starts a generation or a render.

   Exit code 1 on a 5xx, a network error, a leaked key, or a removed route that answers. A 4xx on
   a GET route is printed but expected - those routes want parameters or keys this run does not
   have. Not a test suite: a quick answer to "did I break the app". */

const fs = require('fs');
const path = require('path');

const { APP_DIR, ROOT_DIR } = require('../lib/config');
require('dotenv').config({ path: path.join(ROOT_DIR, '.env') });

const port = Number(process.argv[2]) || Number(process.env.PORT) || 3100;
const base = `http://127.0.0.1:${port}`;

// '/' opens Merge and '/character' lands on the Library's Characters shelf - both answered by redirects.
const PAGES = ['/', '/character', '/home', '/merge', '/library', '/admin', '/3d'];
const MANNEQUIN = '/poses/scen3/full-mirror-selfie_c09381f804061d64ec73ad171b61a845_1786275443473.jpg';
const STATICS = ['/js/app-nav.js', '/presets/anatolian-stone.jpg', MANNEQUIN,
                 // New Character's modules, moved out of the Character page's folder in phase H8
                 '/js/library/chmake.js', '/js/library/character/create-panel.js', '/js/library/character/edit-panel.js',
                 '/js/library/character/save-panel.js', '/js/library/character/presets.js', '/js/library/character/schema.js',
                 '/css/char-make.css',
                 // the making chats of Environments and Lookbooks (phase I): the page's module, its styles, both chats
                 '/js/library/makechat.js', '/js/library/links.js', '/css/makechat.css', '/api/makechat/environments', '/api/makechat/lookbooks',
                 // the pictures chat in Merge's Library panel (phase J), on the shell both chats share (phase V1)
                 '/js/merge-v3/picchat.js', '/js/merge-v3/chat-shell.js', '/js/merge-v3/vidchat.js', '/js/merge-v3/vcatalog.js', '/css/mv3-catalog.css', '/api/mv3/video/matrix', '/css/mv3-imagen.css', '/api/mv3/img/matrix',
                 // the captions' one style module, the page's and the server's (phase K0)
                 '/js/captions/style.js', '/js/captions/ass.js',
                 // the fonts captions are drawn in (phase K5)
                 '/js/captions/fonts.js', '/css/caption-fonts.css', '/fonts/captions/Montserrat-Black.ttf',
                 '/js/captions/presets.js', '/js/captions/measure.js', '/js/captions/advances.js',
                 // libass in the page for the captions' preview (phase K4; laid out by tools/fetch-jassub.js)
                 '/js/captions/layer.js', '/vendor/jassub/jassub.js', '/vendor/jassub/wasm/jassub-worker-modern.wasm',
                 // captions from the sound, laid by the server (phase K1)
                 '/js/captions/heard.js', '/js/merge-v3/listen.js',
                 // caption presets in the Library panel (phase K6)
                 '/js/captions/pages.js', '/js/captions/preset-use.js', '/js/merge-v3/lib-views.js',
                 '/js/merge-v3/captions-view.js', '/css/mv3-captions.css',
                 // a highlights project: its view, its popup and the caption style picked in it (phase V33.1)
                 '/js/merge-v3/highlights.js', '/js/merge-v3/hl-popup.js', '/js/merge-v3/hl-style.js', '/css/mv3-highlights.css',
                 // the hidden faces window and MediaPipe's face detector (phase V33.2; laid out by tools/fetch-mediapipe.js)
                 '/faces-worker.html', '/js/faces-worker.js', '/vendor/mediapipe/vision_bundle.mjs',
                 '/vendor/mediapipe/wasm/vision_wasm_internal.wasm', '/vendor/mediapipe/blaze_face_full_range.tflite',
                 // speech recognition on this computer, Admin -> This computer (phase K1b)
                 '/js/admin-local.js',
                 // Admin -> Thanks: the repositories the app is built on
                 '/js/admin-thanks.js',
                 // the 3D Studio (PLAN "3D Studio"): its modules, three.js, a mannequin, a motion library, a piece of furniture
                 '/js/studio3d/main.js', '/js/studio3d/viewport.js', '/js/studio3d/evaluate.js', '/js/studio3d/timeline.js', '/js/studio3d/assets.js', '/js/studio3d/catalog.js', '/css/studio3d.css',
                 '/vendor/three/build/three.module.js', '/vendor/three/addons/controls/TransformControls.js',
                 '/vendor/3d/people/female.glb', '/vendor/3d/people/motions-base.glb', '/vendor/3d/furniture/loungeSofa.glb', '/api/3d/scenes',
                 // Merge's timeline: a sound's waveform, the transport, the stretch cut out of every lane (phase V36)
                 '/js/merge-v3/tl-wave.js', '/css/mv3-timeline.css',
                 // generate audio and sound on the shelves (phases V34.C-F)
                 '/js/merge-v3/audchat.js', '/css/mv3-audio.css', '/js/sound/menu.js', '/js/sound/shelf.js', '/css/sound.css',
                 '/api/audio/catalog', '/api/audio/gens', '/api/audio/music/highlights'];
// Where an address must land (phase H8): the app opens on Merge, the old Character page on the shelf.
const REDIRECTS = [['/', '/home'], ['/character', '/library?shelf=characters']];
// Every key routes/settings.js keeps out of the page, secret or retired.
const HIDDEN_KEYS = ['kieApiKey', 'replicateApiKey', 'elevenLabsApiKey', 'groqApiKey', 'openRouterApiKey',
                     'r2SecretAccessKey', 'imgbbApiKey', 'partnerApiKey', 'partnerUrl',
                     'telegramBotToken', 'telegramChatId', 'cloudflareApiToken'];
const REMOVED = [['GET', '/api/me'], ['GET', '/login'], ['GET', '/api/admin/users'], ['GET', '/api/audit/meta'],
                 ['POST', '/api/mv3/render/send'], ['GET', '/api/biroly/hands-status'],
                 ['POST', '/api/biroly/hands-generate'], ['POST', '/api/upload-public-base64'],
                 ['POST', '/api/restart'], ['GET', '/birols'],
                 // Library 2, whose generator moved into the Library's Scenarios shelf in phase E
                 ['GET', '/library2'], ['GET', '/api/library2/counts'], ['GET', '/api/library2/drafts'],
                 // the Scenarios page and what only it called, removed in phase G
                 ['POST', '/api/scen3/options/delete'], ['POST', '/api/scen3/preview1k'], ['GET', '/api/scen3/frame-options'],
                 ['POST', '/api/scen3/frame-options'], ['POST', '/api/scen3/media-size'], ['POST', '/api/scen3/frame/crop'],
                 ['POST', '/api/scen3/gen/frame/analyze'], ['POST', '/api/scen3/gen/frame'], ['POST', '/api/scen3/gen/mix'],
                 ['POST', '/api/scen3/obraz-save'], ['POST', '/api/scen3/obraz-delete'], ['POST', '/api/scen3/finalize'],
                 ['GET', '/api/scen3/moods'], ['GET', '/api/scen3/voice-tags'], ['POST', '/api/scen3/video/render'],
                 ['POST', '/api/scen3/video/cancel'], ['GET', '/api/scen3/video/state/x'], ['GET', '/api/scen3/cast-face/x'],
                 ['POST', '/api/scen3/reel/save'], ['POST', '/api/scen3/scenarios/x/duplicate'], ['POST', '/api/scen3/projects/x/copy'],
                 ['POST', '/api/mv3/import/scen3'], ['GET', '/scenarios'],
                 // old versions, removed in the cleanup of 2026-09-15 - one route per removed file
                 ['GET', '/api/balance'], ['POST', '/api/public-host'], ['GET', '/api/recover-tasks'],
                 ['GET', '/api/edit-state'], ['GET', '/api/gen-timings'], ['GET', '/api/hooks/state'],
                 ['GET', '/api/custom-options'], ['POST', '/api/finals/save'], ['GET', '/api/lookbooks'],
                 ['POST', '/api/asset-interact/generate'], ['POST', '/api/mv3/voice/speak'],
                 ['GET', '/api/mv3/vid/feed'], ['POST', '/api/biroly/gen-broll-prompt'], ['GET', '/merge-v2'],
                 ['GET', '/studio'], ['POST', '/api/studio/gen-object'], ['POST', '/api/generate'],
                 ['GET', '/api/audio/voices'], ['POST', '/api/biroly/generate'], ['GET', '/api/biroly/state'],
                 ['GET', '/api/userdata/geni'], ['POST', '/api/ffmpeg/build-ass'], ['GET', '/api/mv3/img/rules'],
                 // phase J: the pictures window's own steps - the server sends a message now
                 ['POST', '/api/mv3/img/think'], ['POST', '/api/mv3/img/gen'], ['POST', '/api/mv3/chat'],
                 ['GET', '/js/merge-v3/chatwin.js'], ['GET', '/js/merge-v3/imagen.js'],
                 // phase K1: the page's own listening job - the server listens to the project now
                 ['POST', '/api/stt/timeline'], ['GET', '/api/stt/timeline/x'],
                 // phase C: routes nothing called - a write that replaced every look, a delete
                 // that wiped a look's folder past lib/relocate.js
                 ['POST', '/api/userdata/obrazy'], ['DELETE', '/api/obrazy/x'],
                 // ...and the probably dead: a list for a gone dropdown, a rename with no page, two reads the
                 // page makes elsewhere, and scratch served over HTTP
                 ['GET', '/api/scen3/projects'], ['PATCH', '/api/narrators/x'], ['GET', '/api/sources/cookies'],
                 ['GET', '/api/sources/x/transcript'], ['GET', '/temp_files/x'], ['GET', '/temp_public/x'],
                 // phase C3: the server version's 'copy to my profile' - one person owns every project here
                 ['POST', '/api/mv3/timeline/x/copy'], ['DELETE', '/api/scen3/projects/x'],
                 // phase C4: Animate, its window and its routes
                 ['GET', '/api/video/engines'], ['POST', '/api/video/animate'], ['GET', '/api/video/animate/status/x'],
                 ['POST', '/api/video/think'], ['POST', '/api/video/reference'],
                 // phase V28.1: a source comes in through /api/sources/add/* - the upload and the page-followed link went
                 ['POST', '/api/sources/upload'], ['POST', '/api/sources/link'],
                 // phase V28.4: the Music shelf is Media -> Audio -> Music; its list and delete went with it and the chips
                 ['GET', '/api/library/shelf/music'], ['GET', '/api/audio/suno/library'], ['DELETE', '/api/audio/suno/library/x'],
                 ['GET', '/js/library/music.js'], ['GET', '/js/library/cats-bar.js'],
                 // ...and, in its second round, the hand order of the categories (alphabetical now)
                 ['POST', '/api/library/cats/order'],
                 // phase V25: the pictures chat's gear, its window and its settings; no chat clears its conversation
                 ['GET', '/js/merge-v3/gear.js'], ['GET', '/css/mv3-gear.css'], ['GET', '/api/mv3/img/settings'],
                 ['PUT', '/api/mv3/img/settings'], ['DELETE', '/api/mv3/chat'],
                 ['GET', '/js/merge-v3/animate.js'], ['GET', '/js/merge-v3/retry.js'],
                 // phase V34.E: the audio lane's own Suno generator - music is made in "generate audio" now
                 ['POST', '/api/audio/suno/generate'],
                 // phase V34.F: the audio lab - its page, its modules and the routes only it read
                 ['GET', '/lab/audio'], ['GET', '/js/lab/audio.js'], ['GET', '/css/lab-audio.css'], ['GET', '/api/audio/lanes'],
                 ['GET', '/api/audio/projects'], ['GET', '/api/audio/lib/tree'], ['GET', '/api/audio/lib/items'], ['POST', '/api/audio/lib/fav'],
                 // phase 2: the per-clip audio extraction nothing read
                 ['POST', '/api/scen3/reel/audio'],
                 // phase V17: the picture-then-video recipe's start - Kling motion control's own way since
                 ['POST', '/api/mv3/video/frameswap'],
                 // phase V26.8, sixth round: a Seedance line is a fragment of its own - the merge tick went
                 ['POST', '/api/scen3/fragments/merge'],
                 // phase 3: the talking-head editor - its render, its progress, and the overlay
                 // arrangement it handed back to a scenario
                 ['POST', '/api/ffmpeg/render'], ['GET', '/api/ffmpeg/status/x'],
                 ['POST', '/api/ffmpeg/cancel/x'], ['GET', '/api/ffmpeg/proxy-status'],
                 ['GET', '/api/mv3/overlays'], ['GET', '/api/mv3/overlays/x'],
                 ['POST', '/api/mv3/overlays/hide'], ['POST', '/api/mv3/overlays/save'],
                 // phase H8: the Character page, its settings popup, the attempt log, the rescued list,
                 // the prompt editor, its own poll, and what only it showed
                 ['GET', '/character-v2.html'], ['GET', '/js/character-v2/main.js'], ['GET', '/css/character-v2.css'],
                 ['GET', '/js/character-v2/create-panel.js'],
                 ['GET', '/css/cv2-settings.css'], ['GET', '/api/character-v2/ladders'], ['POST', '/api/character-v2/ladders'],
                 ['POST', '/api/character-v2/recover'], ['GET', '/api/character-v2/recovered'], ['GET', '/api/character-v2/trace'],
                 ['GET', '/api/prompts'], ['GET', '/api/status/x'], ['GET', '/api/char-store/ref-status/x'],
                 ['GET', '/api/library/looks/x'], ['GET', '/api/scen3/look-frames/x'],
                 // phase V27: the YouTube cookie jar and the lock it kept on links - links go without a login
                 ['POST', '/api/sources/cookies'], ['POST', '/api/sources/cookies/verify'], ['DELETE', '/api/sources/cookies'],
                 ['GET', '/api/sources/ytdlp']];

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
  // The 1K preview of a mannequin went with the Scenarios page (phase G); the thumbnail above is
  // what is left of this check - one shipped asset, resized on demand.

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

  for (const [from, to] of REDIRECTS) {
    let where = '';
    try { where = (await fetch(base + from, { redirect: 'manual' })).headers.get('location') || ''; } catch (e) { where = 'ERR ' + e.message; }
    if (where !== to) { failed++; console.log(`!! ${from} leads to "${where}", not ${to}`); }
  }
  console.log(`redirects: ${REDIRECTS.length} checked`);

  // A library added to package.json gets its line on Admin -> Thanks in the same change.
  const pkg = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'package.json'), 'utf8'));
  const thanked = fs.readFileSync(path.join(APP_DIR, 'public', 'js', 'admin-thanks.js'), 'utf8');
  const deps = Object.keys(Object.assign({}, pkg.dependencies, pkg.devDependencies));
  const unthanked = deps.filter(d => !thanked.includes('npm: ' + JSON.stringify(d)));
  if (unthanked.length) { failed++; console.log('!! not on Admin -> Thanks: ' + unthanked.join(', ')); }
  console.log(`thanks: ${deps.length - unthanked.length}/${deps.length} dependencies thanked`);

  // (phase V23) Recognition on this computer needs whisper.cpp in vendor/ - laid out by npm install, and optional
  // there, so its absence is SAID, not failed: captions are still heard by Groq.
  if (process.platform === 'win32') {
    const exe = path.join(APP_DIR, 'vendor', 'whisper', 'whisper-cli.exe');
    console.log(fs.existsSync(exe) ? 'whisper: vendor/whisper/whisper-cli.exe is there'
      : '!! whisper: vendor/whisper/whisper-cli.exe is missing - recognition on this computer will not work (npm install, or node tools/fetch-whisper.js)');
  }

  process.exitCode = failed ? 1 : 0;
})();
