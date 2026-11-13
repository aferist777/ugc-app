'use strict';

const fs       = require('fs');
const path     = require('path');
const crypto   = require('crypto');
const axios    = require('axios');
const sharp    = require('sharp');

const { KIE_BASE, DATA_DIR } = require('./config');

// ── API keys: only what Admin -> API keys saved in settings.json, read on every call ─
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

function _loadSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch { return {}; }
}

function _getReplicateApiKey() {
  const s = _loadSettings();
  return (s.replicateApiKey && s.replicateApiKey.trim()) ? s.replicateApiKey.trim() : '';
}

function _getKieApiKey() {
  const s = _loadSettings();
  return (s.kieApiKey && s.kieApiKey.trim()) ? s.kieApiKey.trim() : '';
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
// callers asking for the same bytes at the same moment would both upload - which is exactly what
// asking for two pictures from one reference does: each generation hosts the same file, and
// neither has landed when the other starts. They share one upload.
const _uploadFlight = new Map();
// The whole content's SHA-256 - a sample of 512 bytes could take two clips of one length for one. A file is
// hashed as a stream, never read whole.
function _bufHash(buf) {
  return buf.length + '_' + crypto.createHash('sha256').update(buf).digest('hex');
}
function _fileHash(p) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    let n = 0;
    fs.createReadStream(p).on('data', (d) => { n += d.length; h.update(d); }).on('error', reject)
      .on('end', () => resolve(n + '_' + h.digest('hex')));   // the same key as the same bytes in a Buffer
  });
}

// ── Upload: one host, see the note further down ─────────────────────────────
// A contentType of 'image/jpeg' for whatever is handed over would be a plain untruth for the mp3
// a clip render depends on, and a host that believes it can serve the file back under the wrong
// type - which the renderer's audio decoder then refuses.
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

// ── The one upload host ─────────────────────────────────────────────────────
// A free host answers 200 to US and the renderer then cannot read the link, which is
// indistinguishable from success right up until a paid task fails on it - and a list of free
// hosts tried in order does not help. Measured in one afternoon: imgbb went down, catbox answered
// 412 for hours, tmpfiles served links kie called corrupt, and a box of our own was readable by
// kie's image endpoint and not by its vision endpoint.
//
// R2 is our own bucket and the only address all three accepted - OpenRouter, kie.ai and
// Replicate each read the same link and described the same picture - with video and audio
// going through as readily as images, which imgbb does not allow at all.
//
// One host is a single point of failure on purpose. One we pay for and control fails loudly;
// hosts we do not control fail quietly, an hour later, as a wrong answer from a model that was handed
// a link to nothing.
// `imageBuffer` may be { path } - a FILE in scratch, sent as a stream (lib/r2.js putObject): a prepared
// clip is not read into memory. Only a file the caller owns: a library file held open by the upload could not be
// renamed meanwhile (lib/video-prep.js works on copies for exactly that).
async function uploadToPublicHost(imageBuffer, extOrOpts) {
  const opts = (typeof extOrOpts === 'string') ? { ext: extOrOpts } : (extOrOpts || {});
  // verify reads the link back before it is handed to an engine - a 2KB round trip against a
  // render that fails ten seconds after being charged for.
  const { ext, forceFresh = false, verify = false } = opts;
  const file = !Buffer.isBuffer(imageBuffer) && imageBuffer && imageBuffer.path ? imageBuffer : null;

  const key = file ? await _fileHash(file.path) : _bufHash(imageBuffer);
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
    throw new Error('[uploadToPublicHost] R2 is not configured - a checked Cloudflare key on Admin -> API keys');
  }
  // A random tail: two uploads started in the same millisecond - the references of one send are hosted in one
  // pass - would share a key, and the second PUT would overwrite the first, so both callers would get the second
  // picture's link.
  const fileName = `upload_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${ext || 'jpg'}`;
  // Filed under refs/<date>/ so the bucket stays readable in the dashboard and a lifecycle
  // rule can expire a whole day at a time.
  const day = new Date().toISOString().slice(0, 10);
  // Published as a promise BEFORE it is awaited, so anybody arriving mid-flight waits on this
  // one instead of starting a second. Cleared either way - a failed upload must not be handed
  // to the next caller as if it were a link.
  const flight = (async () => {
    const url = await R2.putObject(file ? { path: file.path, size: fs.statSync(file.path).size } : imageBuffer, `refs/${day}/${fileName}`, _mimeOf(fileName));
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
// Setting the only host aside after a failure would take the app down with it, so the answer to
// "they could not read it" is a fresh
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
// The thumbs/<name>.jpg beside an image, the file the stores point at. Twice the size a card needs
// (300px): here the bytes cost nothing, and a card is sharp on a dense screen.
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

// ── Replicate image generation ────────────────────────────────────────────────
// A picture asked of Replicate goes through its predictions API (kie.ai's are asked by
// lib/mv3-img.js and lib/img-providers.js). Each Replicate prediction's id is prefixed with 'repl:'
// so resolveTask can detect it and route polling to Replicate instead of kie.
// New Character's two (latest version auto-selected by Replicate):
//   nano-banana-2          → google/nano-banana-2
//   z-image-turbo          → prunaai/z-image-turbo          (text-to-image only)
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
// An explicit param, else the value written here.
async function createNanoBananaProTask(prompt, imageUrl, aspectRatio, params = {}) {
  const input = {
    prompt,
    aspect_ratio: aspectRatio || (imageUrl ? 'match_input_image' : '9:16'),
    output_format: params.output_format || 'jpg',
    resolution: params.resolution || '2K',
    image_search: params.image_search ?? false,
    google_search: params.google_search ?? false,
  };
  if (imageUrl) input.image_input = [imageUrl];
  return await _createReplicatePrediction('google/nano-banana-2', input);
}

// ── Create nano-banana-2 task with multiple reference images ──────────────────
async function createNanoBananaProTaskMulti(prompt, imageUrls, aspectRatio, _seed, params = {}) {
  const urls = Array.isArray(imageUrls) ? imageUrls : (imageUrls ? [imageUrls] : []);
  const input = {
    prompt,
    aspect_ratio: aspectRatio || (urls.length ? 'match_input_image' : '9:16'),
    output_format: params.output_format || 'jpg',
    resolution: params.resolution || '2K',
    image_search: params.image_search ?? false,
    google_search: params.google_search ?? false,
  };
  if (urls.length) input.image_input = urls;
  return await _createReplicatePrediction('google/nano-banana-2', input);
}

// ── Create prunaai/z-image-turbo task (TEXT-TO-IMAGE, fast distilled 6B) ──────
// Pure t2i — NO image input. Size is in PIXELS (width/height, 64-2048), not an
// aspect enum. Turbo model: guidance_scale must stay 0, ~8 inference steps.
// Used by New Character (lib/img-providers.js).
async function createZImageTurboTask(prompt, params = {}) {
  const clamp = (n, def) => { n = parseInt(n, 10); return Number.isFinite(n) ? Math.max(64, Math.min(2048, n)) : def; };
  const input = {
    prompt,
    width:  clamp(params.width,  768),
    height: clamp(params.height, 1344),
    num_inference_steps: params.num_inference_steps != null ? params.num_inference_steps : 8,
    guidance_scale: params.guidance_scale != null ? params.guidance_scale : 0,
    go_fast: params.go_fast != null ? params.go_fast : true,
    output_format: params.output_format || 'jpg',
    output_quality: params.output_quality != null ? params.output_quality : 90,
  };
  if (params.seed) input.seed = params.seed;
  return await _createReplicatePrediction('prunaai/z-image-turbo', input);
}

// ── Poll task and download result ─────────────────────────────────────────────
// A Replicate prediction's poll. resolveTask (below) dispatches by taskId prefix:
// 'repl:<id>' → here, otherwise kie.ai's recordInfo endpoint. Same response shape on both
// paths so callers don't need to know which provider produced the task.
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
    // A REFUSED POLL IS NOT A FAILED TASK: the network, a key changed on Admin, a prediction this
    // key cannot see - the task runs on, paid for. Thrown, so every caller asks again next time (lib/gen-jobs.js,
    // cv2-watch and mv3-gens all do) and its own clock ends the rest. Answered 'failed' here, it would
    // send New Character's sheet to the next aggregator to be paid for again, and fail a portrait or a
    // picture that is still being drawn.
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
  //   ["url1", "url2", …]       (gpt-image, seedream: an array of URLs)
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
// kie says **'fail'**, not 'failed'. A comparison against the wrong word matches neither the
// success branch nor the failure branch and comes back as "pending", so every failed job looks
// like a job still working until a twenty-minute timeout - and the timeout message replaces the
// real reason. A live record: state 'fail', failCode '400', failMsg 'audio upload failed',
// costTime 15 - over for ten minutes while the page still showed a spinner.
//
// The rules, in order:
//   the envelope's own code is not 200      -> failed (the request itself did not work)
//   state success                           -> success
//   a known failure word, OR failMsg/failCode present -> failed, quoting kie's reason
//   a known in-flight word                  -> pending
//   anything else                           -> FAILED, naming the state
//
// That last line is the point. An answer we do not recognise is not a job
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
  // The fake aggregator's (lib/fake-agg.js) - made here, never asked of anybody.
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
  // thrown, so the caller asks again next time, like the Replicate branch.
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

// ── Reading words and pictures: the agents' ladder ──────────────────────────
// Every caller here - New Character's reading and framing, the scen3 makers, the
// talking head's agents - asks the ONE agents' ladder of lib/agents.js, the chats' writers' too, edited on Admin -> AI
// settings.
// `messages` are OpenAI-shaped, pictures as image_url parts; the answer is the text, or a throw naming every step.
async function callAIVisionWithFallback(messages, opts = {}) {
  const r = await require('./agents').ask(messages, { timeout: opts.timeout });
  if (r.raw) return r.raw;
  throw new Error('every step of the agents ladder failed - ' + r.tried.join(' | '));
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
  // still it would re-encode it to one frame of H.264 and rename that OVER the original: the
  // photograph gone, the path unchanged, and the only sign that everything which
  // opened it afterwards says "unsupported image format". Nothing warns, because from
  // ffmpeg's side the encode succeeds.
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
// dropped/mismatched closing bracket, a trailing comma, or markdown fences. A
// strict JSON.parse on the first {…} match loses the WHOLE response
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
  createNanoBananaProTask, createNanoBananaProTaskMulti, createZImageTurboTask, resolveTask,
  readKieRecord, isOurUpload,
  createThumbnail, THUMB_PX, generateMissingThumbs,
  normalizeVideoForBrowser,
};
