'use strict';

const fs       = require('fs');
const { writeFileAtomic } = require('./atomic-write');
const path     = require('path');
const crypto   = require('crypto');
const axios    = require('axios');
const sharp    = require('sharp');

const { KIE_BASE, DATA_DIR } = require('./config');

// ── API keys: settings.json is the single source of truth at runtime ──────────
// At startup, env-only keys are migrated into settings.json so existing setups
// continue to work seamlessly. After migration env is no longer consulted.
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

function _loadSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch { return {}; }
}
function _saveSettings(obj) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  writeFileAtomic(SETTINGS_FILE, JSON.stringify(obj, null, 2));
}

// One-time startup migration: any env key not yet in settings.json gets imported.
// Runs only at module load (server start). Edited on Admin -> API keys from then on.
(function _migrateEnvKeysToSettings() {
  const s = _loadSettings();
  let changed = false;
  if (!s.kieApiKey && process.env.KIE_AI_API_KEY) {
    s.kieApiKey = process.env.KIE_AI_API_KEY;
    changed = true;
    console.log('[api-keys] migrated KIE_AI_API_KEY from env → settings.json');
  }
  if (!s.elevenLabsApiKey && process.env.ELEVENLABS_API_KEY) {
    s.elevenLabsApiKey = process.env.ELEVENLABS_API_KEY;
    changed = true;
    console.log('[api-keys] migrated ELEVENLABS_API_KEY from env → settings.json');
  }
  if (!s.groqApiKey && process.env.GROQ_API_KEY) {
    s.groqApiKey = process.env.GROQ_API_KEY;
    changed = true;
    console.log('[api-keys] migrated GROQ_API_KEY from env → settings.json');
  }
  if (!s.openRouterApiKey && process.env.OPENROUTER_API_KEY) {
    s.openRouterApiKey = process.env.OPENROUTER_API_KEY;
    changed = true;
    console.log('[api-keys] migrated OPENROUTER_API_KEY from env → settings.json');
  }
  if (!s.openRouterTextModel && process.env.OPENROUTER_TEXT_MODEL) {
    s.openRouterTextModel = process.env.OPENROUTER_TEXT_MODEL;
    changed = true;
    console.log('[api-keys] migrated OPENROUTER_TEXT_MODEL from env → settings.json');
  }
  if (!s.replicateApiKey && process.env.REPLICATE_API_TOKEN) {
    s.replicateApiKey = process.env.REPLICATE_API_TOKEN;
    changed = true;
    console.log('[api-keys] migrated REPLICATE_API_TOKEN from env → settings.json');
  }
  if (changed) _saveSettings(s);
})();

function _getReplicateApiKey() {
  const s = _loadSettings();
  return (s.replicateApiKey && s.replicateApiKey.trim()) ? s.replicateApiKey.trim() : '';
}

// Per-engine defaults, from data/settings.json `engineDefaults: { 'nano-banana-2': {...}, 'gptimage2': {...} }`,
// keyed by the engine's name. Nothing in the app writes them any more (the Character page's engine form went
// in phase H8); a library that has them - the owner's does - is still read. Hard-coded fallbacks live in the
// createX functions themselves.
function _getEngineDefaults(engineName) {
  const s = _loadSettings();
  return (s.engineDefaults && s.engineDefaults[engineName]) || {};
}

function _getKieApiKey() {
  const s = _loadSettings();
  return (s.kieApiKey && s.kieApiKey.trim()) ? s.kieApiKey.trim() : '';
}

// ── OpenRouter (the first try of callAIVisionWithFallback without a ladder) ──
// A single attempt at OpenRouter before the kie.ai cascade; a failure or an empty answer falls
// through. A call with a ladder (the character ladders, lib/cv2-ladders.js) never comes here.
// Callers can opt OUT by passing { useOpenRouter: false }.
function _getOpenRouterApiKey() {
  const s = _loadSettings();
  return (s.openRouterApiKey && s.openRouterApiKey.trim()) ? s.openRouterApiKey.trim() : '';
}
// Returns an array of models to try in order. Settings string can be either a
// single model id ("anthropic/claude-sonnet-4.5") or a comma-separated chain
// ("anthropic/claude-sonnet-4.5,openai/gpt-4o,google/gemini-2.5-pro").
// Default chain when nothing is configured.
function _getOpenRouterModelChain() {
  const s = _loadSettings();
  const raw = (s.openRouterTextModel && s.openRouterTextModel.trim())
    ? s.openRouterTextModel
    : 'anthropic/claude-sonnet-4.6,openai/gpt-5.5,google/gemini-3.1-pro-preview';
  return raw.split(',').map(x => x.trim()).filter(Boolean);
}

// Issue a single chat-completions call to OpenRouter against ONE model. Returns
// trimmed text string or '' on empty/error. Never throws — caller decides next step.
async function _callOpenRouterOne(messages, model, timeout, apiKey) {
  try {
    const res = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      { model, messages, stream: false },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://localhost:3000',
          'X-Title': 'UGC Character Generator',
        },
        timeout,
      }
    );
    const raw = (res.data?.choices?.[0]?.message?.content || '').trim();
    if (raw) { console.log(`[OpenRouter] ${model} ok (${raw.length} chars)`); return raw; }
    console.warn(`[OpenRouter] ${model} empty response`);
    return '';
  } catch (e) {
    const status = e.response?.status;
    const errMsg = e.response?.data?.error?.message || e.message;
    console.warn(`[OpenRouter] ${model} error${status ? ' ' + status : ''}: ${errMsg}`);
    return '';
  }
}

// Call OpenRouter, trying each model in the configured chain until one returns
// a non-empty response. Returns '' if every model fails — caller falls back to
// the kie.ai cascade.
async function _callOpenRouter(messages, opts = {}) {
  const apiKey = _getOpenRouterApiKey();
  if (!apiKey) return '';
  const chain = opts.openRouterModel
    ? [opts.openRouterModel]
    : _getOpenRouterModelChain();
  const timeout = opts.timeout || 45000;
  for (const model of chain) {
    const raw = await _callOpenRouterOne(messages, model, timeout, apiKey);
    if (raw) return raw;
  }
  console.warn(`[OpenRouter] all ${chain.length} models in chain failed/empty`);
  return '';
}

// ── Auth header ───────────────────────────────────────────────────────────────
function kieHeaders() {
  return {
    Authorization: `Bearer ${_getKieApiKey()}`,
    'Content-Type': 'application/json',
  };
}

// ── A browser path is not a repo path ────────────────────────────────────────
// What the page hands back is a URL: /media/... in the library, /presets/<id>.jpg in the
// program's public/. lib/media.js knows which is where; '' when it names no file that exists.
function resolveLocalMedia(urlPath) {
  const clean = String(urlPath || '');
  if (!clean) return '';
  const abs = require('./media').toDisk(clean.startsWith('/') ? clean : '/' + clean);
  return abs && fs.existsSync(abs) ? abs : '';
}

// The address prefix of a folder a finished task lands in: media/work -> 'media/work',
// projects/X/frames -> 'projects/X/frames'. Every such folder is in the library's media or a
// project; one that is not is a bug to hear about, not a file to hand out under an address that
// serves nothing. The folder is made if it is not there yet.
function _urlPrefixOf(destDir) {
  const { ROOT_DIR: R } = require('./config');
  const rel = path.relative(R, destDir).split(path.sep).join('/');
  if (!/^(media|projects)\//.test(rel)) throw new Error('a task can only land in the library media or a project, not ' + destDir);
  fs.mkdirSync(destDir, { recursive: true });
  return rel;
}

// ── Upload cache: buffer hash → { url, ts } — avoids re-uploading the same file ─
const _uploadCache = new Map();
const _UPLOAD_CACHE_TTL = 10 * 60 * 1000; // 10 minutes
// AND THE ONES STILL IN THE AIR. The cache above only holds uploads that have FINISHED, so two
// callers asking for the same bytes at the same moment both uploaded - which is exactly what
// asking for two pictures from one reference does: each generation hosts the same file, and
// neither has landed when the other starts. They share one upload now.
const _uploadFlight = new Map();
function _bufHash(buf) {
  let h = 0;
  const step = Math.max(1, Math.floor(buf.length / 512));
  for (let i = 0; i < buf.length; i += step) h = (Math.imul(31, h) + buf[i]) | 0;
  return `${buf.length}_${h >>> 0}`;
}

// ── Upload: one host, see the note further down ─────────────────────────────
// Every host below used to declare contentType 'image/jpeg' for whatever it was handed. That
// is a plain untruth for the mp3 a clip render depends on, and a host that believes it can
// serve the file back under the wrong type - which the renderer's audio decoder then refuses.
// The name always carries the real extension (upload_<ts>.<ext>), so the type comes from there.
const _MIME_BY_EXT = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg',
  mp4: 'video/mp4', webm: 'video/webm',
};
const _mimeOf = (fileName) => {
  const ext = String(fileName || '').split('.').pop().toLowerCase();
  return _MIME_BY_EXT[ext] || 'application/octet-stream';
};

// An upload is not finished when a host answers 200 with a URL - it is finished when that URL
// serves back the file we sent. tmpfiles.org answers with a perfectly good-looking link that
// then serves a 3KB HTML landing page (measured), and a renderer handed that link reports
// "audio upload failed" ten seconds after the money is committed. Cheaper to look first.
//
// Two thousand bytes is enough: the Content-Type and the file's own magic number both live at
// the front, and a landing page is nothing BUT front.
async function _verifyHosted(url, fileName) {
  const want = _mimeOf(fileName).split('/')[0];        // audio | image | video
  const r = await axios.get(url, {
    responseType: 'arraybuffer', timeout: 20000,
    headers: { Range: 'bytes=0-2047' },
    validateStatus: (s) => s >= 200 && s < 400,
  });
  const ct = String(r.headers['content-type'] || '').toLowerCase();
  if (ct.startsWith('text/') && want !== 'text') {
    throw new Error(`serves ${ct} instead of ${want} - that is a web page, not the file`);
  }
  if (want && ct && !ct.includes(want) && !ct.includes('octet-stream') && !ct.includes('binary')) {
    throw new Error(`serves ${ct}, expected ${want}/*`);
  }
  const head = Buffer.from(r.data).slice(0, 4).toString('latin1');
  if (want === 'audio' && !/^(ID3|\xff)/.test(head) && !/ftyp|OggS|RIFF/.test(Buffer.from(r.data).slice(0, 12).toString('latin1'))) {
    throw new Error('the bytes it serves are not audio');
  }
  return true;
}

// The address the renderers would fetch from, or '' when there is not one. They reach this box
// across the open internet, so a loopback address is not merely useless to them - it is a URL
// that resolves, on THEIR machine, to THEIR machine. Catching that here costs nothing;
// discovering it costs a task that has already been paid for.
// ── The one upload host ─────────────────────────────────────────────────────
// There used to be eight of these, tried in order, and most of a day went into learning that
// the ORDER was never the real problem. A free host answers 200 to US and the renderer then
// cannot read the link, which is indistinguishable from success right up until a paid task
// fails on it. Measured, all in one afternoon: imgbb went down mid-afternoon, catbox answered
// 412 for hours, tmpfiles served links kie called corrupt, and our own box turned out to be
// readable by kie's image endpoint and not by its vision endpoint.
//
// R2 is our own bucket and the only address all three accepted - OpenRouter, kie.ai and
// Replicate each read the same link and described the same picture - with video and audio
// going through as readily as images, which imgbb never allowed at all.
//
// One host is a single point of failure on purpose. One we pay for and control fails loudly;
// eight we do not fail quietly, an hour later, as a wrong answer from a model that was handed
// a link to nothing.
async function uploadToPublicHost(imageBuffer, extOrOpts) {
  const opts = (typeof extOrOpts === 'string') ? { ext: extOrOpts } : (extOrOpts || {});
  // verify reads the link back before it is handed to an engine - a 2KB round trip against a
  // render that fails ten seconds after being charged for.
  const { ext, forceFresh = false, verify = false } = opts;

  const key = _bufHash(imageBuffer);
  if (!forceFresh) {
    const cached = _uploadCache.get(key);
    if (cached && Date.now() - cached.ts < _UPLOAD_CACHE_TTL) {
      console.log('[uploadToPublicHost] cache hit');
      return cached.url;
    }
    const flying = _uploadFlight.get(key);
    if (flying) {
      console.log('[uploadToPublicHost] joining an upload already in the air');
      return flying;
    }
  } else {
    console.log('[uploadToPublicHost] forceFresh - bypass cache');
  }

  const R2 = require('./r2');
  if (!R2.isConfigured()) {
    throw new Error('[uploadToPublicHost] R2 is not configured - set R2_ACCOUNT_ID, '
      + 'R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET');
  }
  // A random tail: two uploads started in the same millisecond - the references of one send are hosted in one
  // pass - shared a key, and the second PUT overwrote the first, so both callers got the second picture's link.
  const fileName = `upload_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${ext || 'jpg'}`;
  // Filed under refs/<date>/ so the bucket stays readable in the dashboard and a lifecycle
  // rule can expire a whole day at a time.
  const day = new Date().toISOString().slice(0, 10);
  // Published as a promise BEFORE it is awaited, so anybody arriving mid-flight waits on this
  // one instead of starting a second. Cleared either way - a failed upload must not be handed
  // to the next caller as if it were a link.
  const flight = (async () => {
    const url = await R2.putObject(imageBuffer, `refs/${day}/${fileName}`, _mimeOf(fileName));
    if (verify) await _verifyHosted(url, fileName);
    _uploadCache.set(key, { url, ts: Date.now() });
    console.log('[uploadToPublicHost] r2 ok:', url.slice(0, 80));
    return url;
  })();
  if (!forceFresh) _uploadFlight.set(key, flight);
  try { return await flight; }
  finally { if (_uploadFlight.get(key) === flight) _uploadFlight.delete(key); }
}

// Is this a link WE handed out? A renderer that cannot read a reference is worth a second try
// only when the file is ours to upload again - a link the user pasted from somewhere else is not
// going to be fixed by us re-uploading anything.
//
// This is all that is left of the host rotation. There were eight hosts, each with a failure of
// its own, and the bookkeeping to set a bad one aside for ten minutes; doing that to the only
// host would take the app down with it, so the answer to "they could not read it" is now a fresh
// upload under a new key (see _rehost in lib/img-providers.js), which is what actually fixes the
// two things that go wrong: a signature near the end of its life, and a link cached cold.
function isOurUpload(url) {
  const u = String(url || '').toLowerCase();
  return !!u && (u.includes('.r2.cloudflarestorage.com') || u.includes('.r2.dev'));
}

// ── Download image from URL to local path ─────────────────────────────────────
async function downloadImage(url, destPath) {
  const response = await axios({ method: 'GET', url, responseType: 'stream', timeout: 60000 });
  return new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(destPath);
    response.data.pipe(writer);
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

// ── Compress JPEG in-place until < 9 MB ──────────────────────────────────────
async function compressBelow9MB(filePath) {
  const MAX = 9 * 1024 * 1024;
  if (fs.statSync(filePath).size <= MAX) return;
  let quality = 85;
  while (quality >= 40) {
    const tmp = filePath + '.tmp';
    await sharp(filePath).jpeg({ quality }).toFile(tmp);
    fs.renameSync(tmp, filePath);
    if (fs.statSync(filePath).size <= MAX) break;
    quality -= 10;
  }
}

// ── A result named .jpg is a JPEG ─────────────────────────────────────────────
// Every engine's picture lands under a .jpg name, and not every engine sends a JPEG: the
// gpt-image models answer with PNG. A 4K PNG is 15-25 MB of what a JPEG at quality 95 holds in
// a fraction of that, and over 9 MB compressBelow9MB would take it straight to quality 85 with
// the colour at half resolution - so an OPAQUE PNG becomes a JPEG here first, at 95 with full
// colour, and usually never meets the compressor. A PNG with real transparency is left as it
// came: flattening it would paint a background into the part that is meant to be empty.
// Never fatal - a picture that cannot be converted is still the picture.
const PNG_SIG = '89504e470d0a1a0a';
async function trueJpeg(filePath) {
  try {
    const head = Buffer.alloc(8);
    const fd = fs.openSync(filePath, 'r');
    try { fs.readSync(fd, head, 0, 8, 0); } finally { fs.closeSync(fd); }
    if (head.toString('hex') !== PNG_SIG) return;
    const meta = await sharp(filePath).metadata();
    if (meta.hasAlpha && !(await sharp(filePath).stats()).isOpaque) return;
    const tmp = filePath + '.tmp';
    await sharp(filePath).flatten({ background: '#ffffff' })
      .jpeg({ quality: 95, chromaSubsampling: '4:4:4' }).toFile(tmp);
    fs.renameSync(tmp, filePath);
  } catch (e) {
    console.warn('[trueJpeg]', path.basename(filePath), e.message);
  }
}

// ── Create thumbnail (600px on the long edge, quality 85) ─────────────────────
// The thumbs/<name>.jpg beside an image, the file the stores point at. Twice the size the server
// cut it at (300px under 35 KB): here the bytes cost nothing, and a card is sharp on a dense screen.
const THUMB_PX = 600;
const THUMB_Q  = 85;
async function createThumbnail(srcPath, thumbPath) {
  fs.mkdirSync(path.dirname(thumbPath), { recursive: true });
  const buf = await sharp(srcPath)
    .resize(THUMB_PX, THUMB_PX, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: THUMB_Q })
    .toBuffer();
  fs.writeFileSync(thumbPath, buf);
}

// ── Generate missing thumbnails for a list of image directories ───────────────
async function generateMissingThumbs(dirs) {
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    const thumbsDir = path.join(dir, 'thumbs');
    let images;
    try { images = fs.readdirSync(dir).filter(f => /\.(jpg|jpeg|png)$/i.test(f)); }
    catch { continue; }
    for (const img of images) {
      const thumbName = img.replace(/\.[^.]+$/, '') + '.jpg';
      const thumbPath = path.join(thumbsDir, thumbName);
      if (!fs.existsSync(thumbPath)) {
        try { await createThumbnail(path.join(dir, img), thumbPath); }
        catch (e) { console.warn('[thumb] failed for', img, ':', e.message); }
      }
    }
  }
}

// ── Replicate image generation (replaces kie.ai for all 4 image engines) ─────
// Image gen now uses Replicate's predictions API. kie.ai stays in play for
// video/avatar/chat. Each Replicate prediction's id is prefixed with 'repl:'
// so resolveTask can detect it and route polling to Replicate instead of kie.
// Model paths (latest version auto-selected by Replicate):
//   nano-banana-2          → google/nano-banana-2
//   qwen-image-edit-plus   → qwen/qwen-image-edit-plus      (image-to-image only)
//   gpt-image-2            → openai/gpt-image-2
//   seedream-5-lite        → bytedance/seedream-5-lite
const _replVersionCache = {};
// Resolve (and cache) a model's latest version id — used for the versioned
// predictions endpoint fallback below.
async function _resolveReplicateVersion(modelPath, apiKey) {
  if (_replVersionCache[modelPath]) return _replVersionCache[modelPath];
  const r = await axios.get(`https://api.replicate.com/v1/models/${modelPath}`, {
    headers: { Authorization: `Bearer ${apiKey}` }, timeout: 15000,
  });
  const v = r.data?.latest_version?.id;
  if (!v) throw new Error('Replicate: no latest_version for ' + modelPath);
  _replVersionCache[modelPath] = v;
  return v;
}

async function _createReplicatePrediction(modelPath, input) {
  const apiKey = _getReplicateApiKey();
  if (!apiKey) throw new Error('No Replicate API token - add it on Admin -> API keys');
  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
  console.log('[replicate] POST', modelPath, '| input:', JSON.stringify(input));
  let id;
  try {
    // Official models (google/*, bytedance/*, black-forest-labs/*, openai/*) expose
    // the model-level predictions endpoint (auto-uses the latest version).
    const res = await axios.post(`https://api.replicate.com/v1/models/${modelPath}/predictions`, { input }, { headers, timeout: 30000 });
    id = res.data?.id;
  } catch (e) {
    // Community models (e.g. prunaai/*) 404 on the model-level endpoint — fall back
    // to the versioned endpoint with the latest version id.
    if (e.response?.status === 404) {
      const version = await _resolveReplicateVersion(modelPath, apiKey);
      const res2 = await axios.post('https://api.replicate.com/v1/predictions', { version, input }, { headers, timeout: 30000 });
      id = res2.data?.id;
    } else {
      throw e;
    }
  }
  // An answer without a number may have started a prediction all the same (lib/task-started.js): `unsure`.
  if (!id) throw Object.assign(new Error('Replicate answered without a prediction id - it may have started it all the same'), { unsure: true });
  // Tag with 'repl:' so resolveTask routes polling to Replicate.
  return `repl:${id}`;
}

// ── Create nano-banana-2 task (image-to-image, scene generation) ─────────────
// Settings precedence: explicit param > user defaults > hard-coded fallback.
async function createNanoBananaProTask(prompt, imageUrl, aspectRatio, params = {}) {
  const d = _getEngineDefaults('nano-banana-2');
  const input = {
    prompt,
    aspect_ratio: aspectRatio || d.aspect_ratio || (imageUrl ? 'match_input_image' : '9:16'),
    output_format: params.output_format || 'jpg',
    resolution: params.resolution || d.resolution || '2K',
    image_search: params.image_search ?? d.image_search ?? false,
    google_search: params.google_search ?? d.google_search ?? false,
  };
  if (imageUrl) input.image_input = [imageUrl];
  return await _createReplicatePrediction('google/nano-banana-2', input);
}

// ── Create nano-banana-2 task with multiple reference images ──────────────────
async function createNanoBananaProTaskMulti(prompt, imageUrls, aspectRatio, _seed, params = {}) {
  const urls = Array.isArray(imageUrls) ? imageUrls : (imageUrls ? [imageUrls] : []);
  const d = _getEngineDefaults('nano-banana-2');
  const input = {
    prompt,
    aspect_ratio: aspectRatio || d.aspect_ratio || (urls.length ? 'match_input_image' : '9:16'),
    output_format: params.output_format || 'jpg',
    resolution: params.resolution || d.resolution || '2K',
    image_search: params.image_search ?? d.image_search ?? false,
    google_search: params.google_search ?? d.google_search ?? false,
  };
  if (urls.length) input.image_input = urls;
  return await _createReplicatePrediction('google/nano-banana-2', input);
}

// ── Create qwen/qwen-image-edit-plus task (image input REQUIRED) ─────────────
async function createQwen2Task(prompt, imageUrl, aspectRatio, seed, params = {}) {
  const urls = Array.isArray(imageUrl) ? imageUrl : (imageUrl ? [imageUrl] : []);
  if (!urls.length) throw new Error('qwen-image-edit-plus требует хотя бы одно изображение');
  const d = _getEngineDefaults('qwen2');
  const input = {
    prompt,
    image: urls,
    aspect_ratio: aspectRatio || d.aspect_ratio || 'match_input_image',
    output_format: 'jpg',
    output_quality: params.output_quality ?? d.output_quality ?? 95,
    go_fast: params.go_fast ?? d.go_fast ?? true,
    // (phase V16, the owner) The safety check off - set here, over any engineDefaults in settings.json.
    disable_safety_checker: true,
  };
  if (seed) input.seed = seed;
  return await _createReplicatePrediction('qwen/qwen-image-edit-plus', input);
}

// ── Create openai/gpt-image-2 task ────────────────────────────────────────────
// Note: gpt-image-2's output_format enum is {"png", "jpeg", "webp"} — uses
// 'jpeg' (not 'jpg'). Default is webp; we override to jpeg for consistency
// with the rest of the pipeline that expects .jpg files on disk.
// OpenAI's gpt-image-2 only natively supports {1:1, 2:3, 3:2, auto}. Replicate
// 422-rejects anything else. Map common vertical/horizontal ratios to the
// closest supported value before submitting.
function _normalizeGptImage2AspectRatio(ar) {
  const map = {
    '9:16': '2:3',
    '4:5':  '2:3',
    '3:4':  '2:3',
    '2:3':  '2:3',
    '16:9': '3:2',
    '5:4':  '3:2',
    '4:3':  '3:2',
    '3:2':  '3:2',
    '1:1':  '1:1',
    '21:9': '3:2',
    'auto': 'auto',
    'match_input_image': 'auto',
  };
  return map[ar] || '2:3';
}

async function createGptImage2Task(prompt, imageUrls, aspectRatio, params = {}) {
  const urls = Array.isArray(imageUrls) ? imageUrls : (imageUrls ? [imageUrls] : []);
  const d = _getEngineDefaults('gptimage2');
  const rawAr = aspectRatio || d.aspect_ratio || '9:16';
  const normalizedAr = _normalizeGptImage2AspectRatio(rawAr);
  if (normalizedAr !== rawAr) {
    console.log('[gpt-image-2] aspect_ratio', rawAr, '→', normalizedAr, '(model-supported)');
  }
  const input = {
    prompt,
    aspect_ratio: normalizedAr,
    output_format: 'jpeg',
    quality: params.quality || d.quality || 'auto',
    background: params.background || d.background || 'auto',
    // (phase V16, the owner) The least strict OpenAI allows - set here, over any engineDefaults in settings.json.
    moderation: 'low',
  };
  // Omit input_images entirely for text-to-image — Replicate's gpt-image-2
  // rejects an empty array on the t2i path.
  if (urls.length) input.input_images = urls;
  return await _createReplicatePrediction('openai/gpt-image-2', input);
}

// ── Create bytedance/seedream-5-lite task ────────────────────────────────────
// Supports up to 14 reference images. `quality`: 'basic' → 2K, 'high' → 3K.
// output_format enum is {"png", "jpeg"} — note 'jpeg' not 'jpg'.
async function createSeedream5LiteTask(prompt, imageUrls, aspectRatio, quality, params = {}) {
  const urls = Array.isArray(imageUrls) ? imageUrls : (imageUrls ? [imageUrls] : []);
  const d = _getEngineDefaults('seedream');
  // size resolution — caller's `quality` arg uses 'basic'|'high', user defaults
  // store '2K'|'3K' directly. Normalize: explicit > defaults > '2K'.
  const explicitSize = (params.size) || (quality === 'high' ? '3K' : quality === 'basic' ? '2K' : null);
  const input = {
    prompt,
    aspect_ratio: aspectRatio || d.aspect_ratio || (urls.length ? 'match_input_image' : '9:16'),
    size: explicitSize || d.size || '2K',
    output_format: 'jpeg',
    max_images: params.max_images ?? d.max_images ?? 1,
    sequential_image_generation: params.sequential_image_generation || d.sequential_image_generation || 'disabled',
  };
  if (urls.length) input.image_input = urls;
  return await _createReplicatePrediction('bytedance/seedream-5-lite', input);
}

// ── Create bytedance/seedream-4.5 task ───────────────────────────────────────
// Faster than 5-lite. Same seedream input shape, but the size enum is 1K/2K/4K
// (no output_format field). Supports text-to-image and image editing (image_input).
async function createSeedream45Task(prompt, imageUrls, aspectRatio, quality, params = {}) {
  const urls = Array.isArray(imageUrls) ? imageUrls : (imageUrls ? [imageUrls] : []);
  const d = _getEngineDefaults('seedream4.5');
  // seedream-4.5 size enum is "2K" | "4K" | "custom" (NOT 1K/3K). Map quality
  // onto valid values: basic -> 2K (fast), high -> 4K.
  const explicitSize = (params.size) || (quality === 'high' ? '4K' : quality === 'basic' ? '2K' : null);
  const input = {
    prompt,
    aspect_ratio: aspectRatio || d.aspect_ratio || (urls.length ? 'match_input_image' : '9:16'),
    size: explicitSize || d.size || '2K',
    max_images: params.max_images ?? d.max_images ?? 1,
    sequential_image_generation: params.sequential_image_generation || d.sequential_image_generation || 'disabled',
    // (phase V16, the owner) The safety check off - left out, the model's default keeps it on.
    disable_safety_checker: true,
  };
  if (urls.length) input.image_input = urls;
  return await _createReplicatePrediction('bytedance/seedream-4.5', input);
}

// ── Create prunaai/z-image-turbo task (TEXT-TO-IMAGE, fast distilled 6B) ──────
// Pure t2i — NO image input. Size is in PIXELS (width/height, 64-2048), not an
// aspect enum. Turbo model: guidance_scale must stay 0, ~8 inference steps.
// Used by the Character Creator's "Generate base".
async function createZImageTurboTask(prompt, params = {}) {
  const d = _getEngineDefaults('z-turbo');
  const clamp = (n, def) => { n = parseInt(n, 10); return Number.isFinite(n) ? Math.max(64, Math.min(2048, n)) : def; };
  const input = {
    prompt,
    width:  clamp(params.width  != null ? params.width  : d.width,  768),
    height: clamp(params.height != null ? params.height : d.height, 1344),
    num_inference_steps: params.num_inference_steps != null ? params.num_inference_steps : (d.num_inference_steps != null ? d.num_inference_steps : 8),
    guidance_scale: params.guidance_scale != null ? params.guidance_scale : (d.guidance_scale != null ? d.guidance_scale : 0),
    go_fast: params.go_fast != null ? params.go_fast : (d.go_fast != null ? d.go_fast : true),
    output_format: params.output_format || d.output_format || 'jpg',
    output_quality: params.output_quality != null ? params.output_quality : (d.output_quality != null ? d.output_quality : 90),
  };
  if (params.seed) input.seed = params.seed;
  return await _createReplicatePrediction('prunaai/z-image-turbo', input);
}

// ── Create black-forest-labs/flux-2-max task (TEXT-TO-IMAGE + IMAGE EDIT) ─────
// Pass imageUrls for editing (input_images); omit for pure t2i. safety_tolerance
// 1-5; size via aspect_ratio (+ optional resolution "0.5 MP".."4 MP").
async function createFlux2MaxTask(prompt, imageUrls, aspectRatio, params = {}) {
  const urls = Array.isArray(imageUrls) ? imageUrls : (imageUrls ? [imageUrls] : []);
  const d = _getEngineDefaults('flux-2-max');
  const input = {
    prompt,
    aspect_ratio: aspectRatio || d.aspect_ratio || (urls.length ? 'match_input_image' : '9:16'),
    output_format: params.output_format || d.output_format || 'jpg',
    output_quality: params.output_quality != null ? params.output_quality : (d.output_quality != null ? d.output_quality : 90),
    // (phase V16, the owner) The most permissive the model takes (1-5) - set here, over any engineDefaults.
    safety_tolerance: 5,
  };
  if (params.resolution || d.resolution) input.resolution = params.resolution || d.resolution;
  if (params.seed) input.seed = params.seed;
  if (urls.length) input.input_images = urls;
  return await _createReplicatePrediction('black-forest-labs/flux-2-max', input);
}

// ── Image EDIT with several references (Replicate) ─────────────────────────────
// What routes/scen3.js asks of Replicate for a first frame: nano-banana-2 with every reference. It used to
// dispatch on an engine id across seven engines; its one caller only ever passed nano-banana-2, and the
// firered / p-image edit creators it alone reached went in phase C. The engine argument is kept for the call.
async function createMultiRefEditTask(engine, prompt, imageUrls, aspectRatio, seed, params) {
  const urls = Array.isArray(imageUrls) ? imageUrls.filter(Boolean) : (imageUrls ? [imageUrls] : []);
  return createNanoBananaProTaskMulti(prompt, urls, aspectRatio || '9:16', seed, params || {});
}

// ── Poll task and download result ─────────────────────────────────────────────
// Dispatches by taskId prefix: 'repl:<id>' → Replicate polling, otherwise the
// legacy kie.ai recordInfo endpoint. Same response shape on both paths so
// callers don't need to know which provider produced the task.
async function _resolveReplicateTask(predictionId, destDir, prefix) {
  const apiKey = _getReplicateApiKey();
  if (!apiKey) return { state: 'failed', error: 'Replicate API token not configured' };
  let pred;
  try {
    const res = await axios.get(`https://api.replicate.com/v1/predictions/${predictionId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: 15000,
    });
    pred = res.data;
  } catch (err) {
    // A REFUSED POLL IS NOT A FAILED TASK (phase V22): the network, a key changed on Admin, a prediction this
    // key cannot see - the task runs on, paid for. Thrown, so every caller asks again next time (lib/gen-jobs.js,
    // cv2-watch, mv3-gens and pending-tasks all do) and its own clock ends the rest. Answered 'failed' here, it
    // sent New Character's sheet to the next aggregator to be paid for again, and failed a portrait or a
    // picture that was still being drawn.
    console.error('[replicate-poll] axios error:', err.message, '| predId:', predictionId);
    throw new Error('Replicate poll error: ' + err.message);
  }
  const status = pred?.status;
  console.log('[replicate-poll]', predictionId, '→ status:', status);
  if (status === 'failed' || status === 'canceled') {
    console.warn('[replicate-poll]', predictionId, 'failed:', pred?.error);
    return { state: 'failed', error: pred?.error || status };
  }
  if (status !== 'succeeded') {
    return { state: 'pending' };
  }
  // Output shape varies per model:
  //   string URL                (nano-banana-2 single)
  //   ["url1", "url2", …]       (gpt-image-2, seedream, qwen array of URLs)
  //   [{url:"…"}, …]            (some models — file objects)
  //   {url:"…"} | {image:"…"}   (some models)
  const _extractUrl = (out) => {
    if (!out) return null;
    if (typeof out === 'string') return out;
    if (Array.isArray(out)) {
      for (const item of out) {
        const u = _extractUrl(item);
        if (u) return u;
      }
      return null;
    }
    if (typeof out === 'object') {
      return out.url || out.image || out.image_url || out.imageUrl || null;
    }
    return null;
  };
  const remoteUrl = _extractUrl(pred.output);
  if (!remoteUrl) {
    console.warn('[replicate-poll] succeeded but no URL parsed. raw output:', JSON.stringify(pred.output).slice(0, 400));
    return { state: 'failed', error: 'Replicate: empty output (raw: ' + JSON.stringify(pred.output).slice(0, 200) + ')' };
  }
  console.log('[replicate-poll]', predictionId, 'succeeded →', remoteUrl.slice(0, 80));

  const urlPrefix = _urlPrefixOf(destDir);

  // Idempotent — reuse if we've already downloaded for this prediction.
  const tag = predictionId.slice(-10);
  const existing = fs.readdirSync(destDir).find(f => f.includes(tag));
  if (existing) return { state: 'success', imagePath: `/${urlPrefix}/${existing}` };

  const filename = `${prefix}_repl${tag}_${Date.now()}.jpg`;
  const destFilePath = path.join(destDir, filename);
  await downloadImage(remoteUrl, destFilePath);
  await trueJpeg(destFilePath);
  await compressBelow9MB(destFilePath);
  const thumbPath = path.join(destDir, 'thumbs', filename);
  try { await createThumbnail(destFilePath, thumbPath); } catch (e) { console.warn('[thumb]', e.message); }
  return { state: 'success', imagePath: `/${urlPrefix}/${filename}` };
}

// ── Reading a kie.ai job record ──────────────────────────────────────────────
// One place that turns ANY answer from /api/v1/jobs/recordInfo into one of three
// outcomes, because getting this wrong is silent and expensive.
//
// It was wrong: the code compared the state against 'failed' and kie says **'fail'**.
// A failure therefore matched neither the success branch nor the failure branch and
// came back as "pending", so every failed job looked like a job still working until a
// twenty-minute timeout - and the timeout message replaced the real reason. Measured on
// a live record: state 'fail', failCode '400', failMsg 'audio upload failed', costTime
// 15 - it had been over for ten minutes while the page still showed a spinner.
//
// The rules, in order:
//   the envelope's own code is not 200      -> failed (the request itself did not work)
//   state success                           -> success
//   a known failure word, OR failMsg/failCode present -> failed, quoting kie's reason
//   a known in-flight word                  -> pending
//   anything else                           -> FAILED, naming the state
//
// That last line is the point of the rewrite. An answer we do not recognise is not a job
// still working; treating it as one is how a mistyped comparison costs twenty minutes.
const KIE_FAILED_STATES = new Set(['fail', 'failed', 'error', 'cancel', 'cancelled', 'canceled', 'timeout', 'expired']);
const KIE_LIVE_STATES = new Set(['', 'wait', 'waiting', 'queue', 'queuing', 'queued', 'generate',
  'generating', 'processing', 'running', 'pending', 'in_progress', 'created', 'submitted']);

function readKieRecord(envelope) {
  const env = envelope || {};
  const data = env.data || {};
  const code = env.code;
  if (code != null && Number(code) !== 200) {
    return { state: 'failed', data, raw: '', error: String(env.msg || '').trim() || ('kie answered code ' + code) };
  }
  const raw = String(data.state == null ? '' : data.state).trim().toLowerCase();
  if (raw === 'success') return { state: 'success', data, raw };

  const failMsg = String(data.failMsg == null ? '' : data.failMsg).trim();
  const failCode = String(data.failCode == null ? '' : data.failCode).trim();
  if (KIE_FAILED_STATES.has(raw) || failMsg || failCode) {
    const why = failMsg || ('the job reported "' + (raw || 'no state') + '"');
    return { state: 'failed', data, raw, failCode, error: failCode ? `${why} (${failCode})` : why };
  }
  if (KIE_LIVE_STATES.has(raw)) return { state: 'pending', data, raw };
  return { state: 'failed', data, raw, error: `the job answered with an unknown state "${raw}"` };
}

async function resolveTask(taskId, destDir, prefix) {
  // The fake aggregator's (phase V0, lib/fake-agg.js) - made here, never asked of anybody.
  if (typeof taskId === 'string' && taskId.startsWith('fake:')) {
    return await require('./fake-agg').resolve(taskId, destDir, prefix);
  }
  // Replicate predictions are tagged with 'repl:' on creation.
  if (typeof taskId === 'string' && taskId.startsWith('repl:')) {
    return await _resolveReplicateTask(taskId.slice(5), destDir, prefix);
  }
  const statusRes = await axios.get(
    `${KIE_BASE}/api/v1/jobs/recordInfo`,
    { params: { taskId }, headers: kieHeaders(), timeout: 15000 }
  );
  // kie answers its own code in the envelope, and only 501 is the task failing (as lib/video-task.js reads it):
  // 429, 455 maintenance, 5xx, 401/403 a key changed, 404/422 a task not visible yet are a poll turned away -
  // thrown, so the caller asks again next time, like the Replicate branch (phase V22).
  const envCode = statusRes.data && statusRes.data.code != null ? Number(statusRes.data.code) : 200;
  if (envCode !== 200 && envCode !== 501) {
    throw new Error('kie.ai turned the poll away: ' + (String((statusRes.data || {}).msg || '').trim() || ('code ' + envCode)));
  }
  const read  = readKieRecord(statusRes.data);
  const data  = read.data;
  const state = read.state;

  if (state === 'success') {
    let remoteUrl = null;
    try {
      const parsed = JSON.parse(data.resultJson);
      console.log('[resolveTask] resultJson for', taskId, ':', JSON.stringify(parsed).slice(0, 300));
      remoteUrl = parsed.resultUrls?.[0]
        || parsed.images?.[0]
        || parsed.image_url
        || parsed.url
        || parsed.data?.[0]?.url
        || parsed.result?.url
        || (Array.isArray(parsed.output) ? parsed.output[0] : null)
        || (typeof parsed.output === 'string' ? parsed.output : null)
        || null;
    } catch {}
    if (!remoteUrl) return { state: 'failed', error: 'No result URL' };

    // The URL prefix is destDir's own place in the library, so callers can pass any subtree
    // (e.g. media/looks/<some-folder>/) and get the matching address.
    const urlPrefix = _urlPrefixOf(destDir);

    // Idempotent: reuse if already downloaded
    const existing = fs.readdirSync(destDir).find(f => f.includes(taskId));
    if (existing) return { state: 'success', imagePath: `/${urlPrefix}/${existing}` };

    const filename = `${prefix}_${taskId}_${Date.now()}.jpg`;
    const destFilePath = path.join(destDir, filename);
    await downloadImage(remoteUrl, destFilePath);
    await trueJpeg(destFilePath);
    await compressBelow9MB(destFilePath);
    const thumbPath = path.join(destDir, 'thumbs', filename);
    try { await createThumbnail(destFilePath, thumbPath); } catch (e) { console.warn('[thumb]', e.message); }
    return { state: 'success', imagePath: `/${urlPrefix}/${filename}` };
  }

  // readKieRecord has already decided, and it has already worded the reason - including
  // for a state string nobody has seen before.
  if (state === 'failed') return { state: 'failed', error: read.error };
  return { state: 'pending' };
}

// ── Vision AI call: Gemini 3.1 Pro (kie.ai routes all vision through Gemini) ──
// messages: OpenAI-format messages array (supports image_url for vision calls)

// content can be a plain string OR an array of content-parts [{type:'text',text:'...'}]
function _extractText(raw) {
  if (typeof raw === 'string') return raw.trim();
  if (Array.isArray(raw)) return raw.filter(p => p?.type === 'text').map(p => p.text || '').join('').trim();
  return '';
}

// ── Vision AI call with fallback chain: GPT-5.2 → Gemini 3.1 Pro → Gemini Flash ─
// messages: OpenAI-format messages array with image_url content parts
// Each provider gets exactly 1 attempt; on failure/empty moves to next.
// ── A ladder, when the caller brought one ───────────────────────────────────
// Character v2 stores its own order of models to try; every other caller here has the
// hardwired cascade below and is untouched. Passing `ladder` opts INTO that order and
// out of the cascade entirely - deliberately, because "it does what the popup says" is
// not true if a sixth model nobody chose answers when the five that were chosen did not.
//
// Steps whose key has already been proven dead are stepped over rather than tried: the
// verdict is read from cache, never waited on.
// ── Replicate as a VISION provider ──────────────────────────────────────────
// Replicate has no chat API. It has predictions: you POST an input object to a model and get
// a result back, and every model names its fields however it likes. So this is a translation
// layer rather than another HTTP call - the ladder speaks OpenAI-shaped messages, and this
// turns them into whatever the model on the other end actually wants.
//
// Two dialects, verified against the live schemas rather than assumed:
//   google/gemini-*   prompt, images[],      system_instruction
//   openai/*          prompt, image_input[], system_prompt
//
// Images are INLINED as data URIs instead of passed as links, which is the one surprising
// decision here. Handing Replicate a catbox URL failed with "Connection aborted" - the same
// flaky hosts that make uploadToPublicHost rotate through eight of them. The bytes are ours
// already; sending them removes an entire class of failure that has nothing to do with the
// model. It costs a base64 round trip on a file that is usually under a megabyte.
const _REPL_VISION_WAIT = 60;   // Prefer: wait caps here; longer needs polling

function _replDialect(model) {
  return String(model || '').startsWith('openai/')
    ? { image: 'image_input', system: 'system_prompt' }
    : { image: 'images', system: 'system_instruction' };
}

// http(s) -> fetched and inlined; data: -> as is; a local path -> read off disk.
async function _asDataUri(src) {
  const s = String(src || '');
  if (!s) return '';
  if (s.startsWith('data:')) return s;
  if (/^https?:\/\//i.test(s)) {
    const r = await axios.get(s, { responseType: 'arraybuffer', timeout: 30000 });
    const mime = String(r.headers['content-type'] || 'image/jpeg').split(';')[0];
    return `data:${mime};base64,${Buffer.from(r.data).toString('base64')}`;
  }
  const abs = resolveLocalMedia(s);
  if (!abs) throw new Error('image not found: ' + s);
  const ext = (abs.split('.').pop() || 'jpg').toLowerCase();
  const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  return `data:${mime};base64,${fs.readFileSync(abs).toString('base64')}`;
}

// The ladder's messages are OpenAI-shaped: a list of roles, each with either a string or a
// list of {type:'text'} / {type:'image_url'} parts. Replicate wants one prompt string and a
// separate list of images, so the parts are pulled apart here.
function _flattenForReplicate(messages) {
  const text = [];
  const system = [];
  const images = [];
  for (const m of (Array.isArray(messages) ? messages : [])) {
    const into = m && m.role === 'system' ? system : text;
    const c = m && m.content;
    if (typeof c === 'string') { if (c.trim()) into.push(c); continue; }
    for (const part of (Array.isArray(c) ? c : [])) {
      if (!part) continue;
      if (part.type === 'text' && part.text) into.push(String(part.text));
      else if (part.type === 'image_url') {
        const u = part.image_url && part.image_url.url;
        if (u) images.push(u);
      }
    }
  }
  return { prompt: text.join('\n\n'), system: system.join('\n\n'), images };
}

async function _callReplicateVision(messages, model, timeout = 90000) {
  const apiKey = _getReplicateApiKey();
  if (!apiKey) throw new Error('no Replicate key');
  const { prompt, system, images } = _flattenForReplicate(messages);
  if (!prompt) throw new Error('nothing to ask');

  const d = _replDialect(model);
  const input = { prompt };
  if (system) input[d.system] = system;
  if (images.length) input[d.image] = await Promise.all(images.map(_asDataUri));

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    // Blocks until the prediction is done instead of handing back an id to poll. A vision
    // answer takes about three seconds, so waiting is simpler and cheaper than a poll loop.
    Prefer: `wait=${Math.max(5, Math.min(_REPL_VISION_WAIT, Math.floor(timeout / 1000)))}`,
  };
  const res = await axios.post(
    `https://api.replicate.com/v1/models/${model}/predictions`,
    { input }, { headers, timeout },
  );

  let p = res.data || {};
  // Longer than the wait allows: fall back to polling the prediction it did hand back.
  const deadline = Date.now() + timeout;
  while ((p.status === 'starting' || p.status === 'processing') && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 2000));
    const poll = await axios.get(`https://api.replicate.com/v1/predictions/${p.id}`, {
      headers: { Authorization: `Bearer ${apiKey}` }, timeout: 20000,
    });
    p = poll.data || {};
  }

  if (p.status !== 'succeeded') {
    // Replicate reports a refusal as a finished prediction with an error, not as a bad status
    // code, so a caller trusting HTTP alone reads a refusal as an empty answer.
    throw new Error(String(p.error || ('prediction ' + (p.status || 'did not finish'))).slice(0, 300));
  }
  // The output is the STREAM, arriving as a list of chunks. Joined, not [0]: taking the first
  // element returns the first few words of the answer and nothing else.
  const out = Array.isArray(p.output) ? p.output.join('') : (p.output || '');
  return String(out).trim();
}

async function _runVisionLadder(messages, ladder, timeout) {
  const HEALTH = require('./keys-health');
  const said = [];
  for (const step of ladder) {
    const who = step.provider + ' / ' + step.model;
    if (HEALTH.isDown(step.provider)) {
      const why = HEALTH.reasonFor(step.provider);
      said.push(who + ': skipped, ' + why);
      continue;
    }
    try {
      let text = '';
      if (step.provider === 'openrouter') {
        const key = _getOpenRouterApiKey();
        if (!key) { said.push(who + ': no OpenRouter key'); continue; }
        text = await _callOpenRouterOne(messages, step.model, timeout, key);
      } else if (step.provider === 'kie.ai') {
        const res = await axios.post(
          `${KIE_BASE}/${step.model}/v1/chat/completions`,
          { stream: false, messages },
          { headers: kieHeaders(), timeout }
        );
        // kie puts a refusal inside a 200, so the envelope is read before the choices.
        const env = res.data || {};
        if (env.code != null && Number(env.code) !== 200) throw new Error(env.msg || ('code ' + env.code));
        text = _extractText(env.choices?.[0]?.message?.content);
      } else if (step.provider === 'replicate') {
        text = await _callReplicateVision(messages, step.model, timeout);
      } else {
        // An aggregator nobody has taught this ladder to speak to (the ladders are normalised to
        // kie.ai and Replicate, so this is a safety, not a path).
        said.push(who + ': no transport for this aggregator');
        continue;
      }
      if (text) { console.log('[vision-ladder]', who, 'ok'); return text; }
      said.push(who + ': empty answer');
    } catch (e) {
      const why = e.response?.data?.error?.message || e.response?.data?.msg || e.message;
      said.push(who + ': ' + String(why).slice(0, 140));
      console.warn('[vision-ladder]', who, 'failed:', String(why).slice(0, 140));
    }
  }
  throw new Error('every step of the vision ladder failed - ' + said.join(' | '));
}

async function callAIVisionWithFallback(messages, opts = {}) {
  const { timeout = 90000 } = opts;
  if (Array.isArray(opts.ladder) && opts.ladder.length) {
    return _runVisionLadder(messages, opts.ladder, timeout);
  }

  // 0. OpenRouter (default primary, opt-out via useOpenRouter:false) — same OpenAI-compatible vision messages
  if (opts.useOpenRouter !== false) {
    console.log('[callAIVisionFallback] trying OpenRouter…');
    const orText = await _callOpenRouter(messages, opts);
    if (orText) return orText;
    console.warn('[callAIVisionFallback] OpenRouter empty/error → kie.ai cascade');
  }

  // 1. GPT-5.4
  console.log('[callAIVisionFallback] trying GPT-5.4…');
  try {
    const res = await axios.post(
      `${KIE_BASE}/gpt-5-4/v1/chat/completions`,
      { stream: false, messages },
      { headers: kieHeaders(), timeout }
    );
    const text = _extractText(res.data?.choices?.[0]?.message?.content);
    if (text) { console.log('[callAIVisionFallback] GPT-5.4 ok'); return text; }
    console.warn('[callAIVisionFallback] GPT-5.4 empty');
  } catch (e) {
    console.warn('[callAIVisionFallback] GPT-5.4 error:', e.message);
  }

  // 2. GPT-5.2
  console.warn('[callAIVisionFallback] falling back to GPT-5.2…');
  try {
    const res = await axios.post(
      `${KIE_BASE}/gpt-5-2/v1/chat/completions`,
      { stream: false, messages },
      { headers: kieHeaders(), timeout }
    );
    const text = _extractText(res.data?.choices?.[0]?.message?.content);
    if (text) { console.log('[callAIVisionFallback] GPT-5.2 ok'); return text; }
    console.warn('[callAIVisionFallback] GPT-5.2 empty');
  } catch (e) {
    console.warn('[callAIVisionFallback] GPT-5.2 error:', e.message);
  }

  // 3. Gemini 3.1 Pro (OpenAI-compat vision)
  console.warn('[callAIVisionFallback] falling back to Gemini 3.1 Pro…');
  try {
    const res = await axios.post(
      `${KIE_BASE}/gemini-3.1-pro/v1/chat/completions`,
      { stream: false, messages },
      { headers: kieHeaders(), timeout }
    );
    const text = _extractText(res.data?.choices?.[0]?.message?.content);
    if (text) { console.log('[callAIVisionFallback] Gemini 3.1 Pro ok'); return text; }
    console.warn('[callAIVisionFallback] Gemini 3.1 Pro empty');
  } catch (e) {
    console.warn('[callAIVisionFallback] Gemini 3.1 Pro error:', e.message);
  }

  // 3. Gemini Flash (native format — download image, pass as base64 inline_data)
  console.warn('[callAIVisionFallback] falling back to Gemini Flash…');
  try {
    const imageUrls = [];
    let textContent = '';
    for (const msg of messages) {
      const parts = Array.isArray(msg.content) ? msg.content : [];
      for (const part of parts) {
        if (part.type === 'image_url' && part.image_url?.url) imageUrls.push(part.image_url.url);
        if (part.type === 'text') textContent = part.text || '';
      }
    }
    let geminiParts;
    if (imageUrls.length) {
      const imgBuffers = await Promise.all(
        imageUrls.map(url => axios.get(url, { responseType: 'arraybuffer', timeout: 30000 }))
      );
      const inlineParts = imgBuffers.map(r => ({
        inline_data: {
          mime_type: (r.headers['content-type'] || 'image/jpeg').split(';')[0].trim(),
          data: Buffer.from(r.data).toString('base64'),
        },
      }));
      geminiParts = [{ text: textContent }, ...inlineParts];
    } else {
      geminiParts = [{ text: textContent }];
    }
    const flashRes = await axios.post(
      `${KIE_BASE}/gemini/v1/models/gemini-3-flash-v1beta:generateContent`,
      { stream: false, contents: [{ role: 'user', parts: geminiParts }] },
      { headers: kieHeaders(), timeout }
    );
    const text = (flashRes.data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
    if (text) { console.log('[callAIVisionFallback] Gemini Flash ok'); return text; }
    console.warn('[callAIVisionFallback] Gemini Flash empty');
  } catch (e) {
    console.error('[callAIVisionFallback] Gemini Flash error:', e.message);
  }

  throw new Error('Все анализаторы вернули пустой ответ (GPT-5.4 → GPT-5.2 → Gemini 3.1 Pro → Gemini Flash)');
}

// ── Normalize a video to a browser/concat-safe format ───────────────────────
// Replicate-produced mp4s often use codec profiles or pixel formats that the
// browser's <video> tag can't decode (yuv422p, yuv420p10le, H.265) and that
// ffmpeg concat demuxer can't merge with other clips. This helper re-encodes
// any input to H.264 main + yuv420p + AAC 44.1kHz + faststart, in place,
// guaranteeing the file plays everywhere (Safari/iOS included) and merges
// cleanly with kie.ai-sourced clips.
//
// Strategy: ffmpeg → temp file, rename over the original. The caller passes
// an absolute path; we don't change the filename or extension. CPU cost is
// ~real-time-ish for 720p clips (1-3 sec per 5-sec video) — negligible vs
// the 30-60 sec the model itself took.
// onProc(child): optional hook so the caller can register the spawned ffmpeg and
// kill it (used by the render job's Cancel — normalization is otherwise a long,
// untracked re-encode that would keep running after Cancel).
async function normalizeVideoForBrowser(absPath, onProc) {
  const { execFile }   = require('child_process');
  const ffmpegPath     = require('ffmpeg-static');
  if (!absPath || !fs.existsSync(absPath)) return;
  // A PICTURE IS NOT A VIDEO TO NORMALISE, and this function replaces its input. Handed a
  // still it re-encoded it to one frame of H.264 and renamed that OVER the original: the
  // photograph was gone, the path unchanged, and the only sign was that everything which
  // opened it afterwards said "unsupported image format". Nothing warned, because from
  // ffmpeg's side the encode succeeded.
  //
  // Refusing here rather than only at the call site: this is a destructive in-place rewrite,
  // so the guard belongs where the damage is done. Every caller means "make this clip
  // decodable", and for a still the honest answer is that there is nothing to do.
  if (/\.(jpe?g|png|webp|avif|bmp|gif)$/i.test(absPath)) return;
  const tmpPath = absPath + '.norm.mp4';
  await new Promise((resolve, reject) => {
    const child = execFile(ffmpegPath, [
      '-y',
      '-i', absPath,
      '-c:v', 'libx264', '-profile:v', 'main', '-level', '4.0',
      '-pix_fmt', 'yuv420p', '-crf', '19', '-preset', 'veryfast',
      '-c:a', 'aac', '-b:a', '128k', '-ar', '44100',
      '-movflags', '+faststart',
      tmpPath,
    ], { timeout: 180000, windowsHide: true }, (err) => {
      if (err) { try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch {} return reject(err); }
      resolve();
    });
    if (typeof onProc === 'function') { try { onProc(child); } catch {} }
  });
  fs.renameSync(tmpPath, absPath);
}

// ── Tolerant JSON extraction for LLM responses ───────────────────────────────
// LLMs (esp. vision models) intermittently emit slightly malformed JSON — a
// dropped/mismatched closing bracket, a trailing comma, or markdown fences. The
// old pattern (strict JSON.parse on the first {…} match) lost the WHOLE response
// on any such glitch. parseLooseJson is a strict superset: it tries a clean parse
// first (identical result for valid JSON), then repairs and retries.
//   1) strip ```json fences / prose; take from the first { to the last }
//   2) strict JSON.parse
//   3) repair: walk the text respecting string literals, force every closer to
//      match its opener (fixes ]→} type mismatches), append missing closers, and
//      drop trailing commas — then parse again.
// Returns the parsed value, or null if even the repaired text won't parse.
function _repairJsonBrackets(s) {
  const stack = [];
  let out = '', inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      out += ch;
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; out += ch; continue; }
    if (ch === '{' || ch === '[') { stack.push(ch); out += ch; continue; }
    if (ch === '}' || ch === ']') {
      const open = stack[stack.length - 1];
      if (!open) continue;                         // stray closer → drop it
      stack.pop();
      out += (open === '{') ? '}' : ']';           // force the correct closer type
      continue;
    }
    out += ch;
  }
  while (stack.length) { const o = stack.pop(); out += (o === '{') ? '}' : ']'; }
  return out;
}
function parseLooseJson(raw) {
  if (raw == null) return null;
  let s = String(raw).trim().replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '').trim();
  const oi = s.indexOf('{'), ai = s.indexOf('[');                 // earliest opener (object or array)
  const start = (oi < 0) ? ai : (ai < 0) ? oi : Math.min(oi, ai);
  if (start < 0) return null;
  const lastObj = s.lastIndexOf('}'), lastArr = s.lastIndexOf(']');
  const end = Math.max(lastObj, lastArr);
  const candidate = (end > start) ? s.slice(start, end + 1) : s.slice(start);
  const stripCommas = (x) => x.replace(/,(\s*[}\]])/g, '$1');
  try { return JSON.parse(candidate); } catch (e) {}
  try { return JSON.parse(stripCommas(_repairJsonBrackets(candidate))); } catch (e) {}
  try { return JSON.parse(stripCommas(_repairJsonBrackets(s))); } catch (e) {}
  return null;
}

module.exports = {
  kieHeaders, callAIVisionWithFallback,
  parseLooseJson,
  // Submitting an ARBITRARY Replicate model, for lib/mv3-img.js. Every other caller here wraps
  // one model in one function; a table that pairs models with aggregators at run time cannot
  // have a wrapper per row, so it needs the plain submitter.
  createReplicateTask: _createReplicatePrediction,

  uploadToPublicHost, downloadImage, trueJpeg, compressBelow9MB, resolveLocalMedia,
  createNanoBananaProTask, createNanoBananaProTaskMulti, createQwen2Task,
  createGptImage2Task, createSeedream5LiteTask, createSeedream45Task, createZImageTurboTask, createFlux2MaxTask, createMultiRefEditTask, resolveTask,
  readKieRecord, isOurUpload,
  createThumbnail, THUMB_PX, generateMissingThumbs,
  normalizeVideoForBrowser,
};
