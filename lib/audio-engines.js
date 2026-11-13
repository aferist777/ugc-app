'use strict';

// ════════════════════════════════════════════════════════════════════════════
// THE ENGINES OF SOUND (phase V34.C, the owner 2026-10-22) - the ONLY place the field names of Suno on kie.ai's jobs API
// and of ElevenLabs' music and sound effects are written. lib/audio-gens.js keeps the records and the journal; this file
// turns what the person chose into a request, asks, and reads the answer.
//
//   MODES                      every mode of the "generate audio" constructor: its engine, what it makes, its limits
//   normalize(mode, body)      the person's choices -> a request (throws 400 in words for a choice that cannot be sent)
//   sunoCreate(req)            kie.ai createTask -> taskId (a failure carries `unsure` - lib/task-started.js)
//   sunoPoll(taskId)           kie.ai recordInfo -> { state, tracks[], lyrics[], error, refused }
//   eleven(req, video?)        ElevenLabs, which answers with the FILE itself -> Buffer (a failure carries `unsure`)
//   price(req)                 what one press costs, in words
//
// SUNO (kie.ai, docs 2026-10-22): POST /api/v1/jobs/createTask { model: 'ai-music-api/<mode>', input: {...} }, polled
// with GET /api/v1/jobs/recordInfo?taskId= (state waiting | queuing | generating | success | fail). HTTP is 200 even for
// a refusal: the body's `code` says. No callBackUrl - it is optional on the jobs API, and this app polls. The models are
// V6, V6_MINI and V6_WILD (V4-V5_5 are discontinued). Generate makes TWO tracks per request (12 credits, $0.06), sounds
// 2.5 credits, lyrics 0.4 credits (200 credits = $1).
//
// ELEVENLABS (the owner's key, docs 2026-10-22): POST /v1/sound-generation { text, duration_seconds 0.5-30, loop,
// prompt_influence, model_id }, POST /v1/music { prompt, music_length_ms 3000-600000, force_instrumental, model_id },
// POST /v1/music/video-to-music (multipart: videos, description, tags, add_sfx, use_audio_as_reference) - each answers
// with the audio itself, so there is no task to follow: the call IS the generation.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { KIE_BASE, DATA_DIR } = require('./config');
const { kieHeaders } = require('./helpers');
const { notStarted, said } = require('./task-started');
const REFUSAL = require('./gen-refusal');

const EL_BASE = 'https://api.elevenlabs.io';

const SUNO_MODELS = ['V6', 'V6_MINI', 'V6_WILD'];
const SOUND_KEYS = ['Any', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B',
  'Cm', 'C#m', 'Dm', 'D#m', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'A#m', 'Bm'];

// What each mode makes and what it takes. `kind`: music (AUDIO -> Music), sound (SFX -> My sounds -> Generated), lyrics
// (text only - kept on the record). `label` is what the constructor's list says.
const MODES = {
  simple:  { engine: 'suno',   kind: 'music',  label: 'Simple · background, no vocals', model: 'ai-music-api/generate' },
  custom:  { engine: 'suno',   kind: 'music',  label: 'Custom · title, style, lyrics',  model: 'ai-music-api/generate' },
  lyrics:  { engine: 'suno',   kind: 'lyrics', label: 'Lyrics',                         model: 'ai-music-api/generate-lyrics' },
  sounds:  { engine: 'suno',   kind: 'sound',  label: 'Sounds',                         model: 'ai-music-api/sounds' },
  compose: { engine: 'eleven', kind: 'music',  label: 'Music from a description' },
  video:   { engine: 'eleven', kind: 'music',  label: 'Video to Music' },
  sfx:     { engine: 'eleven', kind: 'sound',  label: 'Sound effects' },
};
const ENGINES = { suno: 'Suno · kie.ai', eleven: 'ElevenLabs' };

// What one press costs. kie: credits (200 = $1); ElevenLabs: its own credits, from the owner's plan.
const PRICES = {
  simple: { credits: 12, usd: 0.06, note: 'two tracks' },
  custom: { credits: 12, usd: 0.06, note: 'two tracks' },
  lyrics: { credits: 0.4, usd: 0.002, note: '2-3 texts' },
  sounds: { credits: 2.5, usd: 0.0125, note: 'one press' },
  compose: { usdPerMin: 0.15, note: 'ElevenLabs paid plan, by the minute' },
  video: { usdPerMin: 0.15, note: 'ElevenLabs paid plan, by the minute of music', maxSec: 600, maxMB: 200 },
  sfx: { elPerSec: 40, note: 'ElevenLabs credits per second' },
};

const _bad = (msg) => Object.assign(new Error(msg), { status: 400 });
const _s = (v, n) => String(v == null ? '' : v).replace(/\r\n/g, '\n').trim().slice(0, n);
const _num = (v, lo, hi, dflt) => {
  if (v === '' || v == null) return dflt;
  const n = +v;
  if (!Number.isFinite(n)) return dflt;
  return Math.max(lo, Math.min(hi, n));
};
const _round = (n, k) => Math.round(n * k) / k;
// A length, a tempo: 0 or nothing means "the model decides" (0 back); anything else is held within the engine's bounds.
const _pos = (v, lo, hi) => {
  const n = +v;
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.max(lo, Math.min(hi, n));
};

/**
 * What the person chose -> the request kept on the record and sent (nothing here asks anybody). Every limit is the
 * engine's own: a field over it is refused in words rather than cut silently, where cutting would change the meaning.
 */
function normalize(mode, body) {
  const b = body || {};
  const m = MODES[mode];
  if (!m) throw _bad('no such mode: ' + mode);
  const out = { mode, engine: m.engine, kind: m.kind };
  const model = SUNO_MODELS.includes(String(b.model)) ? String(b.model) : 'V6';

  if (mode === 'simple') {
    // A background with no voice (the owner: "простой генератор музыки для фона без слов"): chips and the person's words,
    // made into Suno's style by the writer (lib/audio-gens.js), sent in custom mode as an instrumental of a set length.
    // The chips are the almanac's ids by group (public/js/audio/almanac-data.js CHIPS: genre, mood, sound).
    const chips = b.chips && !Array.isArray(b.chips) && typeof b.chips === 'object' ? b.chips : {};
    out.chips = {};
    for (const k of ['genre', 'mood', 'sound']) out.chips[k] = (Array.isArray(chips[k]) ? chips[k] : []).map(c => _s(c, 40)).filter(Boolean).slice(0, 8);
    const n = Object.values(out.chips).reduce((x, l) => x + l.length, 0);
    out.words = _s(b.words, 1000);
    // (phase V34.F, the owner's (ф3)) A HIGHLIGHTS MOOD instead of the chips: one of V34.A's ten presets, written by its own
    // rule (lib/audio-writer-rules.js fromPreset - no writer asked), and the track is filed into Music -> highlights -> that
    // mood (lib/music-store.js). `n` - which press of this mood it is: it turns the preset's varying colour.
    const preset = _s(b.preset, 40);
    if (preset) {
      if (!require('./music-store').isMood(preset)) throw _bad('no such mood: ' + preset);
      out.preset = preset;
      out.n = Math.max(0, Math.min(999, Math.floor(+b.n || 0)));
    } else if (!n && !out.words) throw _bad('pick a chip, a mood or say in words what the music is');
    // The VIDEO's length (the writer's rules make the bed a little longer, within Suno's 10-360 s); 0 - the model decides.
    out.seconds = Math.round(_pos(b.seconds, 1, 360));
    out.bpm = Math.round(_pos(b.bpm, 40, 220));
    // The project's kind, for the writer ('talking-head' | 'blank' | 'highlights' | 'draft') - not the record's own `kind`.
    out.projectKind = ['talking-head', 'blank', 'highlights', 'draft'].includes(String(b.projectKind || b.kind)) ? String(b.projectKind || b.kind) : 'blank';
    out.model = model;
    out.writer = b.writer !== false;
    return out;
  }
  if (mode === 'custom') {
    out.title = _s(b.title, 80);
    if (!out.title) throw _bad('a title is needed (up to 80 characters)');
    out.style = _s(b.style, 1000);
    out.instrumental = !!b.instrumental;
    const lyrics = String(b.lyrics || '').replace(/\r\n/g, '\n').trim();
    if (lyrics.length > 5000) throw _bad('the lyrics are ' + lyrics.length + ' characters - Suno V6 takes up to 5000');
    out.lyrics = out.instrumental ? '' : lyrics;
    out.negative = _s(b.negative, 500);
    if (!out.style && !out.lyrics && !out.negative) throw _bad('write a style, lyrics or what to avoid - Suno needs one of them');
    out.vocal = (!out.instrumental && (b.vocal === 'm' || b.vocal === 'f')) ? b.vocal : '';
    out.styleWeight = _num(b.styleWeight, 0, 1, null);
    out.weirdness = _num(b.weirdness, 0, 1, null);
    // Not sent: `audio_weight` weighs an UPLOADED sound, and nothing is uploaded here (V34.A's research).
    out.audioWeight = null;
    // 0 unless asked: at kie's own 1, V6 REWRITES the style before it makes the track (Suno's v6 FAQ, V34.A).
    out.variety = b.variety === '' || b.variety == null ? 0 : Math.round(_num(b.variety, 0, 4, 0));
    out.seconds = Math.round(_pos(b.seconds, 10, 360));
    out.model = model;
    return out;
  }
  if (mode === 'lyrics') {
    out.idea = _s(b.idea, 200);
    if (!out.idea) throw _bad('say what the song is about (up to 200 characters)');
    return out;
  }
  if (mode === 'sounds') {
    out.prompt = _s(b.prompt, 500);
    if (!out.prompt) throw _bad('describe the sound (up to 500 characters)');
    out.loop = !!b.loop;
    out.tempo = Math.round(_pos(b.tempo, 1, 300));
    out.key = SOUND_KEYS.includes(String(b.key)) ? String(b.key) : 'Any';
    out.model = model;
    return out;
  }
  if (mode === 'compose') {
    out.prompt = _s(b.prompt, 4100);
    if (!out.prompt) throw _bad('describe the music');
    out.seconds = _round(_pos(b.seconds, 3, 600), 10);
    out.instrumental = b.instrumental !== false;
    return out;
  }
  if (mode === 'video') {
    out.video = _s(b.video, 1000);
    // (phase V54, block 2) Or ONE CLIP of a timeline as it is seen - its right button: `clip` { key, clipId }, the file made
    // from it by the server when the press is asked (lib/audio-gens.js, lib/merge-clips.js startClip). `name` and the moment
    // are the record's words; the server reads them again from the timeline.
    const c = b.clip && typeof b.clip === 'object' ? b.clip : null;
    if (c && c.key && c.clipId) {
      out.video = '';
      out.clip = { key: _s(c.key, 80), clipId: _s(c.clipId, 80), name: _s(c.name, 200),
        start: Math.max(0, +c.start || 0), dur: Math.max(0, +c.dur || 0) };
    }
    if (!out.video && !out.clip) throw _bad('choose the video the music is for');
    if (!out.clip) out.name = _s(b.name, 200);
    // Its length, for the price (and the fake's tone) - the server measures it; nothing of it is sent.
    out.seconds = Math.round(_pos(b.seconds, 0.1, 36000) * 10) / 10;
    out.description = _s(b.description, 4100);
    out.tags = (Array.isArray(b.tags) ? b.tags : String(b.tags || '').split(','))
      .map(t => _s(t, 40)).filter(Boolean).slice(0, 10);
    out.sfx = !!b.sfx;
    out.useAudio = !!b.useAudio;
    return out;
  }
  // sfx
  out.prompt = _s(b.prompt, 1000);
  if (!out.prompt) throw _bad('describe the sound');
  out.seconds = _round(_pos(b.seconds, 0.5, 30), 10);
  out.loop = !!b.loop;
  out.influence = _num(b.influence, 0, 1, 0.3);
  return out;
}

/** What a press of this request costs, in words. */
function price(req) {
  const p = PRICES[req && req.mode];
  if (!p) return '';
  if (p.credits != null) return p.credits + ' kie credits ≈ $' + p.usd + ' (' + p.note + ')';
  if (p.usdPerMin) {
    const s = +req.seconds || 0;
    return s ? '≈ $' + (p.usdPerMin * s / 60).toFixed(3) + ' for ' + s + ' s (' + p.note + ')' : '≈ $' + p.usdPerMin + ' per minute (' + p.note + ')';
  }
  if (p.elPerSec) {
    const s = +req.seconds || 0;
    return s ? '≈ ' + Math.round(p.elPerSec * s) + ' ElevenLabs credits for ' + s + ' s' : '≈ ' + p.elPerSec + ' ElevenLabs credits per second of what comes back';
  }
  return '';
}

// ── Suno through kie.ai ─────────────────────────────────────────────────────

/** The createTask body of a request (`style`, `title`, `negative` of the simple mode written by the writer first). */
function sunoBody(req) {
  const r = req || {};
  if (r.mode === 'lyrics') return { model: MODES.lyrics.model, input: { prompt: r.idea } };
  if (r.mode === 'sounds') {
    const input = { prompt: r.prompt, model: r.model || 'V6', sound_loop: !!r.loop };
    if (r.tempo) input.sound_tempo = r.tempo;
    if (r.key && r.key !== 'Any') input.sound_key = r.key;
    return { model: MODES.sounds.model, input };
  }
  // generate - always Suno's custom mode: the simple one is an instrumental whose style the writer wrote.
  const simple = r.mode === 'simple';
  const instrumental = simple ? true : !!r.instrumental;
  const input = {
    custom_mode: true,
    instrumental,
    model: r.model || 'V6',
    title: String(r.title || 'Background').slice(0, 80),
  };
  if (r.style) input.style = String(r.style).slice(0, 1000);
  if (!instrumental && r.lyrics) input.lyrics = String(r.lyrics).slice(0, 5000);
  if (r.negative) input.negative_tags = String(r.negative).slice(0, 500);
  if (!instrumental && r.vocal) input.vocal_gender = r.vocal;
  if (r.styleWeight != null) input.style_weight = _round(+r.styleWeight, 100);
  if (r.weirdness != null) input.weirdness_constraint = _round(+r.weirdness, 100);
  if (!instrumental && r.audioWeight != null) input.audio_weight = _round(+r.audioWeight, 100);
  if (r.variety != null) input.variety = Math.round(+r.variety);
  if (r.seconds) input.duration = Math.max(10, Math.min(360, Math.round(+r.seconds)));
  return { model: MODES.custom.model, input };
}

/**
 * Ask kie.ai for the task. An answer that says no (a 4xx, or kie's refusal inside a 200 - `code` other than 200) started
 * nothing; NO answer (a timeout, a reset, a 5xx, a 200 with no task number) may have started one: `unsure`.
 */
async function sunoCreate(req) {
  let r;
  try {
    r = await axios.post(`${KIE_BASE}/api/v1/jobs/createTask`, sunoBody(req), { headers: kieHeaders(), timeout: 30000 });
  } catch (e) {
    throw notStarted('kie.ai', e);
  }
  const d = r.data || {};
  const code = +d.code;
  const taskId = d.data && d.data.taskId;
  if (code === 200 && taskId) return String(taskId);
  const words = said(d) || ('code ' + (d.code == null ? '?' : d.code));
  // kie's own 500 inside a 200 is its edge failing - it may have started the task all the same; a 200 with no number too.
  const unsure = code === 200 || code === 500 || !d.code;
  const err = new Error('kie.ai ' + (unsure ? 'did not say whether it started it: ' : 'did not start it: ') + words);
  err.unsure = unsure;
  err.refused = !unsure && REFUSAL.isRefusal(words);
  return Promise.reject(err);
}

// The tracks of a finished generate or sounds task: `data.response.data[]` (the docs), or the same read out of
// `resultJson` - tolerant of the shapes kie has used (`sunoData`, camelCase).
function _parse(v) {
  if (!v) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch (e) { return null; }
}
function _tracksOf(data) {
  const resp = _parse(data.response) || _parse(data.resultJson) || {};
  const lists = [resp.data, resp.sunoData, resp.tracks, resp.resultObject && resp.resultObject.data,
    resp.data && resp.data.data, resp.response && resp.response.sunoData];
  const list = lists.find(l => Array.isArray(l) && l.length) || [];
  return list.map(t => ({
    url: String((t && (t.audio_url || t.audioUrl || t.source_audio_url || t.sourceAudioUrl)) || ''),
    dur: +((t && t.duration) || 0) || 0,
    title: String((t && t.title) || ''),
    id: String((t && t.id) || ''),
    tags: String((t && t.tags) || ''),
  })).filter(t => t.url);
}
function _lyricsOf(data) {
  const resp = _parse(data.response) || _parse(data.resultJson) || {};
  const lists = [resp.resultObject && resp.resultObject.lyricsData, resp.lyricsData, resp.data,
    resp.resultObject && resp.resultObject.data];
  const list = lists.find(l => Array.isArray(l) && l.length) || [];
  return list.filter(x => x && x.text && String(x.status || 'complete') !== 'failed')
    .map(x => ({ title: String(x.title || '').slice(0, 120), text: String(x.text || '').slice(0, 6000) }));
}

/** One look at a task: { state: pending | success | failed, tracks?, lyrics?, error?, refused?, stage? }. Throws when kie
 *  did not answer (the runner asks again next tick). */
async function sunoPoll(taskId, kind) {
  const r = await axios.get(`${KIE_BASE}/api/v1/jobs/recordInfo`, { params: { taskId }, headers: kieHeaders(), timeout: 15000 });
  const body = r.data || {};
  if (+body.code !== 200 || !body.data) {
    // A poll turned away is not a failed task (CLAUDE.md "Paid once"): thrown, asked again next tick.
    throw new Error('kie.ai did not answer about the task: ' + (said(body) || ('code ' + body.code)));
  }
  const data = body.data;
  const state = String(data.state || '').toLowerCase();
  if (state === 'success') {
    if (kind === 'lyrics') {
      const lyrics = _lyricsOf(data);
      return lyrics.length ? { state: 'success', lyrics } : { state: 'failed', error: 'kie.ai finished the task with no lyrics in it' };
    }
    const tracks = _tracksOf(data);
    // Suno's two tracks: kie reports success once both are in - one alone is kept alone.
    return tracks.length ? { state: 'success', tracks } : { state: 'pending', stage: 'finished - waiting for the files' };
  }
  if (state === 'fail' || state === 'failed') {
    const error = String(data.failMsg || data.errorMessage || ('failed (' + (data.failCode || '?') + ')')).slice(0, 400);
    return { state: 'failed', error, refused: REFUSAL.isRefusal(error) || /artist name|flagged|rephras/i.test(error) };
  }
  return { state: 'pending', stage: state === 'generating' ? 'Suno is making it' : (state ? 'in kie.ai\'s queue' : '') };
}

// ── ElevenLabs ──────────────────────────────────────────────────────────────

function elKey() {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'settings.json'), 'utf8'));
    return String(s.elevenLabsApiKey || '').trim();
  } catch (e) { return ''; }
}

// ElevenLabs' refusals come as JSON in an arraybuffer body: read them out for the words.
function _elWords(e) {
  const d = e && e.response && e.response.data;
  let body = d;
  if (d && (d instanceof ArrayBuffer || Buffer.isBuffer(d))) {
    try { body = JSON.parse(Buffer.from(d).toString('utf8')); } catch (er) { body = Buffer.from(d).toString('utf8').slice(0, 300); }
  }
  if (body && body.detail && typeof body.detail === 'object' && !Array.isArray(body.detail)) {
    return String(body.detail.message || body.detail.status || JSON.stringify(body.detail)).slice(0, 300);
  }
  if (body && Array.isArray(body.detail)) return body.detail.map(x => (x && (x.msg || x.message)) || '').join('; ').slice(0, 300);
  return said(body);
}

/**
 * The request asked of ElevenLabs; the answer is the audio itself. `video` (Video to Music): the file on disk.
 * Returns { buf, ext }. A failure carries `unsure` (no answer may still have been billed) and `refused` (its words).
 */
async function eleven(req, video) {
  const key = elKey();
  if (!key) throw Object.assign(new Error('there is no ElevenLabs key - add it on Admin -> API keys'), { unsure: false });
  const fmt = { output_format: 'mp3_44100_128' };
  let r;
  try {
    if (req.mode === 'sfx') {
      const body = { text: req.prompt, prompt_influence: req.influence, model_id: 'eleven_text_to_sound_v2' };
      if (req.seconds) body.duration_seconds = req.seconds;
      if (req.loop) body.loop = true;
      r = await axios.post(`${EL_BASE}/v1/sound-generation`, body, {
        params: fmt, headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
        responseType: 'arraybuffer', timeout: 180000,
      });
    } else if (req.mode === 'compose') {
      // music_v2_5 by name: the API still defaults to v1 (V34.A's research, ElevenLabs' docs 2026-10-22).
      const body = { prompt: req.prompt, model_id: 'music_v2_5', force_instrumental: !!req.instrumental };
      if (req.seconds) body.music_length_ms = Math.round(req.seconds * 1000);
      r = await axios.post(`${EL_BASE}/v1/music`, body, {
        params: fmt, headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
        responseType: 'arraybuffer', timeout: 15 * 60000,
      });
    } else if (req.mode === 'video') {
      if (!video || !fs.existsSync(video)) throw Object.assign(new Error('the video is not on disk any more'), { unsure: false });
      // The `form-data` package, as Groq's hearing sends its sound (lib/groq-stt.js): the file read from disk as it is.
      const FormData = require('form-data');
      const form = new FormData();
      const ext = path.extname(video).toLowerCase();
      form.append('videos', fs.createReadStream(video), {
        filename: path.basename(video), contentType: ext === '.mov' ? 'video/quicktime' : ext === '.webm' ? 'video/webm' : 'video/mp4',
      });
      if (req.description) form.append('description', req.description);
      for (const t of (req.tags || [])) form.append('tags', t);
      if (req.sfx) form.append('add_sfx', 'true');
      if (req.useAudio) form.append('use_audio_as_reference', 'true');
      r = await axios.post(`${EL_BASE}/v1/music/video-to-music`, form, {
        params: fmt, headers: { ...form.getHeaders(), 'xi-api-key': key, Accept: 'audio/mpeg' },
        responseType: 'arraybuffer', timeout: 15 * 60000, maxBodyLength: Infinity, maxContentLength: Infinity,
      });
    } else {
      throw Object.assign(new Error('not an ElevenLabs mode: ' + req.mode), { unsure: false });
    }
  } catch (e) {
    if (e && typeof e.unsure === 'boolean') throw e;
    const err = notStarted('ElevenLabs', e);
    const words = _elWords(e);
    if (words && e.response) err.message = 'ElevenLabs ' + (err.unsure ? 'answered ' + e.response.status + ' - it may have made it all the same: ' : 'did not make it: ') + words;
    err.refused = !err.unsure && (REFUSAL.isRefusal(words) || /bad_prompt|artist|copyright|terms of service/i.test(words));
    throw err;
  }
  const buf = Buffer.from(r.data || []);
  if (buf.length < 512) {
    const err = new Error('ElevenLabs answered with no sound in it');
    err.unsure = true;
    throw err;
  }
  return { buf, ext: '.mp3' };
}

/** For the page: the engines, their modes, the models, the chips and the prices. */
function catalog() {
  const modes = Object.entries(MODES).map(([id, m]) => ({ id, engine: m.engine, kind: m.kind, label: m.label, price: price({ mode: id }) }));
  return {
    engines: Object.entries(ENGINES).map(([id, label]) => ({ id, label, modes: modes.filter(x => x.engine === id).map(x => x.id) })),
    modes, sunoModels: SUNO_MODELS, soundKeys: SOUND_KEYS, prices: PRICES,
    // (V34.F) The simple mode's highlights moods - V34.A's ten presets.
    moods: require('./music-store').moods(),
    keys: { kie: !!(kieHeaders().Authorization || '').replace(/^Bearer\s*/, ''), eleven: !!elKey() },
  };
}

module.exports = { MODES, ENGINES, PRICES, SUNO_MODELS, SOUND_KEYS, normalize, price, sunoBody, sunoCreate, sunoPoll, eleven, elKey, catalog };
