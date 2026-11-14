'use strict';

/* smoke-local.js - does the local app still boot and answer, after a change.

   Run from the checkout, against a server that is already up:
       node tools/smoke-local.js [port]
   The port defaults to PORT in the library's .env, else 3100. Everything goes to 127.0.0.1.

   What it asks:
     - every page, a few shipped assets, and every GET route that takes no parameters;
     - a thumbnail of a shipped preset;
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

// '/' opens Home - answered by a redirect.
const PAGES = ['/', '/home', '/merge', '/library', '/admin', '/3d'];
const STATICS = ['/js/app-nav.js', '/presets/anatolian-stone.jpg',
                 // New Character's modules
                 '/js/library/chmake.js', '/js/library/character/create-panel.js', '/js/library/character/edit-panel.js',
                 '/js/library/character/save-panel.js', '/js/library/character/presets.js', '/js/library/character/schema.js',
                 '/css/char-make.css',
                 // what is known about a made environment or lookbook, and the links module
                 '/js/library/made-rows.js', '/js/library/links.js', '/css/made-rows.css',
                 // the pictures chat, on the shell both chats share
                 '/js/merge-v3/picchat.js', '/js/merge-v3/chat-shell.js', '/js/merge-v3/vidchat.js', '/api/mv3/video/matrix', '/css/mv3-imagen.css', '/api/mv3/img/matrix',
                 // the captions' one style module, the page's and the server's
                 '/js/captions/style.js', '/js/captions/ass.js',
                 // the fonts captions are drawn in
                 '/js/captions/fonts.js', '/css/caption-fonts.css', '/fonts/captions/Montserrat-Black.ttf',
                 '/js/captions/presets.js', '/js/captions/measure.js', '/js/captions/advances.js',
                 // libass in the page for the captions' preview (laid out by tools/fetch-jassub.js)
                 '/js/captions/layer.js', '/vendor/jassub/jassub.js', '/vendor/jassub/wasm/jassub-worker-modern.wasm',
                 // captions from the sound, laid by the server
                 '/js/captions/heard.js', '/js/merge-v3/listen.js',
                 // caption presets in the Library panel
                 '/js/captions/pages.js', '/js/captions/preset-use.js', '/js/merge-v3/lib-views.js',
                 '/js/merge-v3/captions-view.js', '/css/mv3-captions.css',
                 // a highlights project: its view, its popup and the caption style picked in it
                 '/js/merge-v3/highlights.js', '/js/merge-v3/hl-popup.js', '/js/merge-v3/hl-style.js', '/css/mv3-highlights.css',
                 // the hidden faces window and MediaPipe's face detector (laid out by tools/fetch-mediapipe.js)
                 '/faces-worker.html', '/js/faces-worker.js', '/vendor/mediapipe/vision_bundle.mjs',
                 '/vendor/mediapipe/wasm/vision_wasm_internal.wasm', '/vendor/mediapipe/blaze_face_full_range.tflite',
                 // speech recognition on this computer, Admin -> This computer
                 '/js/admin-local.js',
                 // Admin -> Thanks: the repositories the app is built on
                 '/js/admin-thanks.js',
                 // the shared parts: the icons, the slider, "really?", the question at a button, and the fonts
                 '/js/icons.js', '/js/ui-range.js', '/js/really.js', '/js/references/news.js', '/js/ask.js', '/js/ui-state.js', '/icons/LICENSE-lucide.txt',
                 '/fonts/ui/Inter-Regular.woff2', '/fonts/ui/JetBrainsMono-Regular.woff2',
                 // the 3D Studio: its modules, three.js, a mannequin, a motion library, a piece of furniture
                 '/js/studio3d/main.js', '/js/studio3d/viewport.js', '/js/studio3d/evaluate.js', '/js/studio3d/timeline.js', '/js/studio3d/assets.js', '/js/studio3d/catalog.js', '/css/studio3d.css',
                 '/vendor/three/build/three.module.js', '/vendor/three/addons/controls/TransformControls.js',
                 '/vendor/3d/people/female.glb', '/vendor/3d/people/motions-base.glb', '/vendor/3d/furniture/loungeSofa.glb', '/api/3d/scenes',
                 // Merge's timeline: a sound's waveform, the transport, the stretch cut out of every lane
                 '/js/merge-v3/tl-wave.js', '/css/mv3-timeline.css', '/js/merge-v3/tl-cut.js', '/js/captions/cut.js',
                 // ...and cut silence, and clips in a row merged
                 '/js/merge-v3/tl-silence.js', '/js/merge-v3/tl-merge.js',
                 // generate audio and sound on the shelves
                 '/js/merge-v3/sound-host.js', '/css/sound-window.css', '/js/sound/menu.js', '/js/sound/shelf.js', '/css/sound.css',
                 '/api/audio/catalog', '/api/audio/gens', '/api/audio/music/highlights',
                 // the assistant in the top strip: its window, its reader of answers, its look, the guide Help answers by
                 '/js/assistant/assistant.js', '/js/assistant/md.js', '/css/assistant.css', '/guide/guide.md'];
// Where an address must land: the app opens on Home.
const REDIRECTS = [['/', '/home']];
// Every key routes/settings.js keeps out of the page.
const HIDDEN_KEYS = ['anthropicApiKey', 'kieApiKey', 'replicateApiKey', 'elevenLabsApiKey', 'groqApiKey', 'openRouterApiKey',
                     'r2SecretAccessKey', 'telegramBotToken', 'cloudflareApiToken', 'freesoundApiKey', 'pixabayApiKey'];
// Routes and files that were removed must answer 404.
const REMOVED = [
                 // dead routes
                 ['POST', '/api/library/cut'], ['DELETE', '/api/audio/lyrics/x'], ['GET', '/api/highlights'], ['GET', '/api/references'],
                 // the Render finished window, makechat, the agent's set of first frames, Media's
                 // duplicates, the /lab/ui showcase, the video chat's recipe catalog
                 ['POST', '/api/mv3/render/finish'], ['POST', '/api/mv3/render/save'], ['POST', '/api/mv3/render/discard'], ['GET', '/api/mv3/timeline/x/source'],
                 ['GET', '/api/makechat/environments'], ['POST', '/api/makechat/environments/send'], ['POST', '/api/makechat/lookbooks/photo'],
                 ['GET', '/api/scen3/frame-sets'], ['GET', '/api/scen3/poses'], ['POST', '/api/scen3/frames/plan'], ['GET', '/api/obrazy/main-images'],
                 ['GET', '/api/library/dupes'], ['POST', '/api/library/dupes/clean'],
                 ['GET', '/lab/ui'], ['GET', '/js/lab-ui.js'], ['GET', '/css/ui-v73.css'],
                 ['GET', '/js/merge-v3/vcatalog.js'], ['GET', '/css/mv3-catalog.css'], ['GET', '/api/mv3/video/catalog'], ['GET', '/api/mv3/video/presets'],
                 ['POST', '/api/mv3/video/write'], ['POST', '/api/mv3/video/card/x/again'],
                 // the person's own caption presets
                 ['GET', '/api/mv3/captions/presets'], ['POST', '/api/mv3/captions/presets'], ['POST', '/api/mv3/captions/presets/rename'],
                 ['POST', '/api/mv3/captions/presets/delete'], ['GET', '/js/merge-v3/my-presets.js'],
                 // Seedance in talking head
                 ['POST', '/api/scen3/sd/prompts'], ['POST', '/api/scen3/sd/prompt'], ['POST', '/api/scen3/sd/pick'], ['POST', '/api/scen3/voice/demo'],
                 // the old Character page's address
                 ['GET', '/character']];

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
  // The thumbnail above checks one shipped asset, resized on demand.

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
  console.log('settings view:', st.status, !leaked ? 'unreadable' : leaked.length ? 'LEAKS ' + leaked.join(', ') : 'no secret key in it');

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

  // Recognition on this computer needs whisper.cpp in vendor/ - laid out by npm install, and optional
  // there, so its absence is SAID, not failed: captions are still heard by Groq.
  if (process.platform === 'win32') {
    const exe = path.join(APP_DIR, 'vendor', 'whisper', 'whisper-cli.exe');
    console.log(fs.existsSync(exe) ? 'whisper: vendor/whisper/whisper-cli.exe is there'
      : '!! whisper: vendor/whisper/whisper-cli.exe is missing - recognition on this computer will not work (npm install, or node tools/fetch-whisper.js)');
  }

  process.exitCode = failed ? 1 : 0;
})();
