/* ═══════════════════════════════════════════════════════════════════════════
   MERGE — "/ generate audio" (phase V34.E, the owner 2026-10-23: "давай добавим в приложение, то что получилось"): the
   Library panel's fourth view, after "generate video" and before "captions" - the audio lab's constructor (V34.D) moved
   into Merge. Not a chat: ONE message of the app per mode - its fields, its attachment where it takes one - and what was
   made under it.

     left     the settings: the engine (Suno · kie.ai | ElevenLabs), the mode, the model, the length (the video's by a press),
              the chips (V34.A's almanac, public/js/audio/almanac-data.js) or, in Simple, one of the ten HIGHLIGHTS MOODS
              (V34.F: two tracks into Music -> highlights -> that mood), the price of a press; the almanac at its foot (a press
              on a note copies it)
     middle   the CONSTRUCTOR of the open mode and "generate"
     right    MADE HERE - the presses of THE OPEN PROJECT only (the owner's (р1); the draft's are the drafts' one list, as their
              chats' conversation is): its stage while it is made, its tracks or sounds when done - a press plays one, ★,
              "show" (on the shelf), and dragged onto an audio lane it lies there as a tile of the shelf does -, the lyrics
              with "use in custom", its error and "try again" when it failed. A sash between it and the constructor.
              (phase V54, the owner's (зв23)) In VIDEO TO MUSIC the right column is the VIDEO tree (js/media-tree.js `roots`,
              its own memory `v2m`): the path to the node open, its folders as tiles, then its videos - a press puts one into
              "The video" (its track goes to Music and "Made here" only, (зв24)); "Made here" moves under the constructor.

   (phase V54, block 2, the owner's (зв3)-(зв7)) VIDEO TO MUSIC FROM A CLIP: the right button on a clip of a video lane
   (timeline-b.js) brings THAT clip, as it is seen, into "The video" (videoToMusicFromClip) - its lane, from-to, length and
   the price of its seconds; "generate" asks the server, which makes the clip into a file ("preparing the clip"), asks
   ElevenLabs and files the track as "music for <the clip>" into Music AND lays it under the clip (lib/audio-gens.js). The
   picker of renders and videos ("choose…") is gone; "from this computer…" and a file let go on the field stay.

   The project is the one open in Merge - there is no picker here. Its kind gives the mode the first time it is opened here:
   a talking head - Simple; blank, the draft - Custom (the owner's (р7)); a highlights project - Simple, with its moods (phase
   V49, the owner's (пр7); its home and fragments are one project here, lib-views.js chatKey); afterwards the mode it was left on.

   The server is routes/audio-gen.js and lib/audio-gens.js: a press writes its record and its Alerts row at once, the server
   asks, waits, downloads and files - this view only follows. Its Alerts row leads back here (?open=audio, js/merge-v3/main.js).
   What the person set is remembered (localStorage `mv3_audio_v1`).

   (phase V59, the owner 2026-10-29) SUNO'S PART IS SHARED with the Library's music window: the settings rows, the chips, the
   price, the almanac and the constructor of Simple / Custom / Lyrics are js/sound/suno-form.js; this view adds what is
   Merge's own - the engine switch, ElevenLabs, Sounds, Video to Music, "Made here", "by the video", the project's mode.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as Store from './store.js';
import * as Views from './lib-views.js';
import { DRAG_TYPE, DRAG_MEDIA } from './store.js';
import { setOpenColumn } from './layout.js';
import { isTalking } from './workshop.js';
import { setMediaDrag, createTree } from '../media-tree.js';
import { waveEl, secs } from '../sound/wave.js';
import { refuseHome } from './chat-shell.js';
import { createSunoForm, el, api, post, ls, lsSet } from '../sound/suno-form.js';

const NAME = 'audio';
const $ = (id) => document.getElementById(id);
const KEY = 'mv3_audio_v1';

// ── what the person set ─────────────────────────────────────────────────────
// Simple, Custom and Lyrics say what they are in js/sound/suno-form.js (modeHelp); these are Merge's own modes.
const MODE_HELP = {
  sounds: 'A sound or a loop by Suno, from a description. It goes to SFX → My sounds → Generated.',
  compose: 'Music by ElevenLabs from a description - instrumental unless you untick it. The chips add their words. It goes to AUDIO → Music.',
  video: 'Music made FOR a video: ElevenLabs watches it (cuts, pace, mood) and scores it. Press a video in the tree on the right - or a clip on the timeline with the right button, and the track is laid under that clip too. Say what you want if you like. It goes to AUDIO → Music.',
  sfx: 'A sound effect by ElevenLabs, from a description - up to 30 s, or the length it picks. It goes to SFX → My sounds → Generated.',
};
const KIND_MODE = { 'talking head': 'simple', blank: 'custom', draft: 'custom', highlights: 'simple' };
const WRITER_KIND = { 'talking head': 'talking-head', blank: 'blank', draft: 'draft', highlights: 'highlights' };

// The shared form (js/sound/suno-form.js) holds the state - Suno's three modes and, through `fields`, Merge's own four.
const F = createSunoForm({
  store: KEY, title: 'Generate audio',
  base: { engine: 'suno', mode: 'custom', lastMode: { suno: 'simple', eleven: 'compose' }, f: {}, of: {} },
  fields: {
    sounds: { prompt: '', loop: false, tempo: 0, key: 'Any' },
    compose: { prompt: '', seconds: 30, instrumental: true },
    // `clip` (phase V54) - a clip of a timeline { key, trackId, clipId, name, start, dur, thumb } in place of a file; `dur` - the
    // file's length when it is known (the price).
    video: { video: '', name: '', thumb: '', dur: 0, clip: null, description: '', tags: '', sfx: false, useAudio: false },
    sfx: { prompt: '', seconds: 0, loop: false, influence: 0.3 },
  },
  // Each project's mode, as it was left - the last 60.
  persist: (st) => {
    const of = {};
    for (const k of Object.keys(st.of || {}).slice(-60)) of[k] = st.of[k];
    st.of = of;
    return { engine: st.engine, mode: st.mode, model: st.model, lastMode: st.lastMode, f: st.f, of: st.of };
  },
  say: (t, bad) => say(t, bad),
  paintCol: () => paintCol(),
  paintMake: () => paintMake(),
  paintMakePrice: () => paintMakePrice(),
  setMode: (id) => setMode(id),
  videoSecs: () => _videoSecs(),
  priceOf: (mode, p) => {
    if (mode !== 'video' || !p.usdPerMin) return null;
    // (phase V54) By the seconds of the clip or the file in "The video", when they are known.
    const sec = _v2m().dur;
    return sec ? { big: '≈ $' + (p.usdPerMin * sec / 60).toFixed(3), small: secs(sec) + ' of music, as long as the video · ElevenLabs' }
      : { big: '≈ $' + p.usdPerMin + '/min', small: 'of music, as long as the video' };
  },
});
const S = F.S;
if (!S.of || typeof S.of !== 'object') S.of = {};
const save = () => F.save();

let CAT = null;            // GET /api/audio/catalog (the shared form reads it - F.ready())
let GENS = [];
let LIBIDX = new Map();    // path -> the shelf's item (its wave, star, id, name)
let _ui = null;            // the view's parts, built the first time it shows
let _shown = false;
let _key = null;           // the project the view follows
let _draftHere = false;

// ── the project ─────────────────────────────────────────────────────────────
// (phase V49, the owner's (пр4), (пр7)) In a highlights project too: its home and every fragment are ONE list of what was made
// (the key is the home's - lib-views.js chatKey), and it opens in Simple with the highlights moods.
const _hl = (k) => /^hl_/.test(String(k || ''));
const _allowed = () => Store.isReady() && !!Store.key() && Store.canEdit();
const _lk = (k) => (k === _key && _draftHere ? 'draft' : (k || ''));
const _kind = () => (_hl(Store.key()) ? 'highlights' : isTalking() ? 'talking head' : Store.isDraft() ? 'draft' : 'blank');
// The video's length: the video lanes' end (a talking head's lines, a blank project's clips).
function _videoSecs() {
  const t = Store.timeline();
  if (!t) return 0;
  let end = 0;
  for (const k of Object.keys(t.tracks || {})) {
    const tr = t.tracks[k];
    if (!tr || tr.kind !== 'video') continue;
    for (const c of (tr.clips || [])) { const e = (+c.start || 0) + (+c.dur || 0); if (e > end) end = e; }
  }
  return Math.round(end * 10) / 10;
}

let _sayT = 0;
function say(text, bad) {
  if (!_ui) return;
  const s = _ui.status;
  s.textContent = text || '';
  s.hidden = !text;
  s.classList.toggle('is-bad', !!bad);
  clearTimeout(_sayT);
  if (text && !bad) _sayT = setTimeout(() => { if (s.textContent === text) { s.textContent = ''; s.hidden = true; } }, 9000);
}

// (phase V34.F) The highlights moods and the one picked - the shared form's (js/sound/suno-form.js).
const _moods = () => F.moods();
const _preset = () => F.preset();

// ── the settings column: the chats' column (.mv3-ig-set, css/mv3-imagen.css) ───────────────────────────────
// Suno's rows - the model, a highlights mood, the length, the folded chips, the price, the almanac - are the shared form's;
// the engine and ElevenLabs' model are Merge's own.
function paintCol() {
  const col = _ui.col;
  col.textContent = '';
  const row = (label, body, note) => {
    const r = el('div', 'mv3-ig-row');
    if (label) r.appendChild(el('label', null, label));
    r.appendChild(body);
    if (note) r.appendChild(el('div', 'au-note', note));
    col.appendChild(r);
    return r;
  };
  const sep = (text) => col.appendChild(el('div', 'mv3-ig-sep', text));

  const seg = el('div', 'mv3-ig-ar-row');
  for (const e of (CAT ? CAT.engines : [])) {
    const b = el('button', 'mv3-ig-ar-b' + (S.engine === e.id ? ' on' : ''), e.label);
    b.type = 'button';
    b.addEventListener('click', () => setEngine(e.id));
    seg.appendChild(b);
  }
  row('Engine', seg, CAT && !CAT.keys[S.engine === 'eleven' ? 'eleven' : 'kie'] && !CAT.fake
    ? 'No ' + (S.engine === 'eleven' ? 'ElevenLabs' : 'kie.ai') + ' key - add it on Admin → API keys.' : '');

  row('Mode', F.modeSelect(CAT ? CAT.modes.filter(x => x.engine === S.engine) : []));

  if (S.engine === 'suno' && S.mode !== 'lyrics') {
    row('Model', F.modelSelect(), 'one price for all three');
  } else if (S.engine === 'eleven') {
    row('Model', el('div', 'au-note', S.mode === 'sfx' ? 'eleven_text_to_sound_v2' : S.mode === 'compose' ? 'music_v2_5 (Eleven Music)' : 'Eleven Music'));
  }

  F.moodRow(row);
  F.lengthRows(row, sep);
  F.chipRows(col);
  F.priceBox(col);

  // The almanac at the foot of the column, as in the video chat: V34.A's notes, a press copies one (V34.F).
  _ui.alm.textContent = '';
  F.almanacButton(_ui.alm);
}

const paintPrice = () => F.paintPrice();
const _priceText = () => F.priceText();
function paintMakePrice() {
  const s = _ui && _ui.make.querySelector('.au-go-row .au-muted');
  if (s) s.textContent = _priceText();
}

// A project opened here: its mode as it was left - or, the first time, the one its kind wants (and the lengths of its video).
function _forProject() {
  // (phase V54) A clip of another project is no video of this one.
  const vc = S.f.video.clip;
  if (vc && Views.chatKey(vc.key) !== _key) { S.f.video.clip = null; save(); }
  const lk = _lk(_key);
  const was = S.of[lk];
  const m = CAT && CAT.modes.find(x => x.id === was);
  if (m) { S.mode = m.id; S.engine = m.engine; return; }
  const kind = _kind();
  S.mode = KIND_MODE[kind] || 'custom';
  S.engine = 'suno';
  const vs = _videoSecs();
  if (vs > 0) {
    S.f.simple.seconds = Math.min(360, Math.round(vs));
    S.f.custom.seconds = Math.max(10, Math.min(360, Math.round(vs)));
    S.f.compose.seconds = Math.max(3, Math.min(600, Math.round(vs)));
  }
  S.of[lk] = S.mode;
  save();
}
function setEngine(id) {
  if (S.engine === id) return;
  S.lastMode[S.engine] = S.mode;
  S.engine = id;
  setMode(S.lastMode[id] || (CAT.engines.find(e => e.id === id) || { modes: ['compose'] }).modes[0]);
}
function setMode(id) {
  const m = CAT && CAT.modes.find(x => x.id === id);
  if (!m) return;
  S.mode = id;
  S.engine = m.engine;
  S.lastMode[m.engine] = id;
  S.of[_lk(_key)] = id;
  save();
  paintCol();
  paintMake();
}

// ── the constructor ─────────────────────────────────────────────────────────
// The field builders are the shared form's (they write what is typed into its state).
const _field = (label, input, opts) => F.field(label, input, opts);
const _text = (obj, key, opts) => F.text(obj, key, opts);
const _check = (obj, key, label, after) => F.check(obj, key, label, after);
const _knob = (obj, key, label, min, max, step, hint) => F.knob(obj, key, label, min, max, step, hint);

function paintMake() {
  const host = _ui.make;
  host.textContent = '';
  const m = CAT && CAT.modes.find(x => x.id === S.mode);
  if (!m) return;
  const card = el('div', 'au-card');
  const h = el('div', 'au-card-h');
  h.appendChild(document.createTextNode((S.engine === 'eleven' ? 'ElevenLabs' : 'Suno') + ' · ' + m.label));
  h.appendChild(el('span', 'au-muted', 'for ' + (Store.title() || 'this project')));
  card.appendChild(h);
  const bot = el('div', 'au-bot');
  bot.appendChild(el('div', 'au-bot-ico', S.mode === 'sounds' || S.mode === 'sfx' ? '✦' : '♪'));
  bot.appendChild(el('div', 'au-bot-tx', F.helpText() || MODE_HELP[S.mode] || ''));
  card.appendChild(bot);
  const f = S.f[S.mode];

  // Simple (or its highlights mood), Custom, Lyrics - the shared form's; the rest are Merge's own.
  if (F.paintFields(card)) { /* painted */ } else if (S.mode === 'sounds') {
    card.appendChild(_field('The sound', _text(f, 'prompt', { area: true, rows: 3, placeholder: 'e.g. a soft camera shutter click with a short mechanical whir' }), { max: 500 }));
    const r2 = el('div', 'au-row2');
    const tempo = el('input', 'au-in');
    tempo.type = 'number'; tempo.min = '0'; tempo.max = '300'; tempo.placeholder = 'auto';
    tempo.value = f.tempo ? String(f.tempo) : '';
    tempo.addEventListener('change', () => { f.tempo = Math.max(0, Math.min(300, Math.round(+tempo.value || 0))); save(); });
    r2.appendChild(_field('Tempo', tempo, { small: 'BPM, for a loop' }));
    const key = el('select', 'au-sel');
    for (const k of (CAT.soundKeys || ['Any'])) { const op = el('option', null, k); op.value = k; key.appendChild(op); }
    key.value = f.key || 'Any';
    key.addEventListener('change', () => { f.key = key.value; save(); });
    r2.appendChild(_field('Key', key));
    card.appendChild(r2);
    card.appendChild(_check(f, 'loop', 'a seamless loop'));
  } else if (S.mode === 'compose') {
    card.appendChild(_field('The music', _text(f, 'prompt', { area: true, rows: 4, placeholder: 'e.g. calm lo-fi with soft piano and vinyl crackle, steady, nothing that jumps out - under a voiceover' }), { max: 4100 }));
    card.appendChild(_check(f, 'instrumental', 'instrumental - no voice'));
  } else if (S.mode === 'video') {
    card.appendChild(_field('The video', _attachment(f)));
    card.appendChild(_field('What you want', _text(f, 'description', { area: true, rows: 3, placeholder: 'optional - e.g. upbeat and modern, builds to the reveal at the end' }), { max: 4100 }));
    card.appendChild(_field('Tags', _text(f, 'tags', { placeholder: 'upbeat, cinematic' }), { small: 'up to 10, by commas' }));
    card.appendChild(_check(f, 'sfx', 'add sound effects from what happens in the video'));
    card.appendChild(_check(f, 'useAudio', 'use the video\'s own sound as a reference (its genre, tempo, mood)'));
  } else if (S.mode === 'sfx') {
    card.appendChild(_field('The sound', _text(f, 'prompt', { area: true, rows: 3, placeholder: 'e.g. a quick airy whoosh, left to right' }), { max: 1000 }));
    const inf = el('div');
    inf.appendChild(_knob(f, 'influence', 'follow the words', 0, 1, 0.05, 'higher - closer to the description, less varied'));
    card.appendChild(_field('', inf));
    card.appendChild(_check(f, 'loop', 'a seamless loop'));
  }

  const goRow = el('div', 'au-go-row');
  const go = el('button', 'au-go', S.mode === 'lyrics' ? 'write the lyrics' : 'generate');
  go.type = 'button';
  go.addEventListener('click', () => generate(go));
  goRow.appendChild(go);
  goRow.appendChild(el('span', 'au-muted', _priceText()));
  card.appendChild(goRow);
  card.appendChild(el('div', 'au-err'));
  host.appendChild(card);
  // (phase V54) The right column follows the mode: Video to Music's VIDEO tree, or "Made here".
  _place();
}

// ── Video to Music's video (phase V54, block 2) ────────────────────────────────────────────────────────────────────────────
// ONE CLIP of a timeline (its right button) or a FILE (a press in the VIDEO tree on the right, "from this computer…", a file
// let go on the field). A clip is shown as it is NOW on the open timeline - moved, trimmed, sped up, its name -; a clip of
// another fragment of the same highlights project as it was put in; one taken off the open timeline says so.
const V2M_MAX = 600;
// The clip in the field on the open timeline: { track, clip } - null when another timeline is open, or it is not on this one.
function _liveClip(c) {
  if (!c || Store.key() !== c.key) return null;
  for (const t of ((Store.timeline() || {}).tracks || [])) {
    const x = (t.clips || []).find(y => y.id === c.clipId);
    if (x) return t.kind === 'video' ? { track: t, clip: x } : null;
  }
  return null;
}
// What "The video" holds now: { clip?, live?, gone, name, start, dur, thumb, lane }.
function _v2m() {
  const f = S.f.video;
  const c = f.clip;
  if (c) {
    const live = _liveClip(c);
    const x = live ? live.clip : null;
    return { clip: c, live, gone: !live && Store.key() === c.key, name: (x && x.name) || c.name || 'clip',
      start: x ? +x.start || 0 : +c.start || 0, dur: Math.round((x ? +x.dur || 0 : +c.dur || 0) * 10) / 10,
      thumb: (x && x.thumb) || c.thumb || '', lane: live ? live.track.name : '' };
  }
  return { name: f.name || '', dur: +f.dur || 0, thumb: f.thumb || '', gone: false };
}
const _clock = (t) => { const s = Math.max(0, +t || 0); return Math.floor(s / 60) + ':' + (s % 60).toFixed(1).padStart(4, '0'); };
const _usd = (s) => '≈ $' + (0.15 * (+s || 0) / 60).toFixed(3);

function _attachment(f) {
  const att = el('div', 'au-att');
  const paint = () => {
    att.textContent = '';
    const v = _v2m();
    if (f.clip || f.video) {
      if (v.thumb) { const im = el('img'); im.src = v.thumb; att.appendChild(im); } else att.appendChild(el('div', 'au-att-ph'));
      const tx = el('div', 'au-att-tx');
      tx.appendChild(el('b', null, f.clip ? v.name : (f.name || f.video.split('/').pop())));
      if (f.clip) {
        tx.appendChild(el('span', 'au-muted', 'a clip' + (v.lane ? ' of ' + v.lane : '') + ' · ' + _clock(v.start) + ' – ' + _clock(v.start + v.dur)
          + ' · ' + secs(v.dur)));
        if (v.gone) tx.appendChild(el('span', 'au-err', 'Not on the timeline any more - press a clip with the right button again.'));
        else if (v.dur > V2M_MAX) tx.appendChild(el('span', 'au-err', 'Longer than 10 minutes - Video to Music takes up to 10.'));
        else tx.appendChild(el('span', 'au-muted', _usd(v.dur) + ' for its ' + secs(v.dur) + ' · the track is laid under it'));
      } else {
        tx.appendChild(el('span', 'au-muted', (v.dur ? secs(v.dur) + ' · ' + _usd(v.dur) + ' · ' : '') + 'into Music only - not onto the timeline'));
      }
      att.appendChild(tx);
    } else {
      att.appendChild(el('div', 'au-att-ph'));
      att.appendChild(el('div', 'au-att-tx', 'Press a video in the tree on the right, or a clip on the timeline with the right button - or drop a file here. Up to 10 minutes and 200 MB.'));
    }
    const up = el('button', 'au-btn', 'from this computer…');
    up.type = 'button';
    up.title = 'A video from this computer - it is copied into VIDEO → Uploads first';
    up.addEventListener('click', () => {
      const inp = el('input');
      inp.type = 'file'; inp.accept = 'video/*';
      inp.addEventListener('change', async () => {
        const file = inp.files && inp.files[0];
        if (!file) return;
        const v2 = await _uploadVideo(file);
        if (v2) { Object.assign(f, v2, { clip: null }); save(); paintMake(); paintPrice(); }
      });
      inp.click();
    });
    att.appendChild(up);
    if (f.video || f.clip) {
      const x = el('button', 'au-x', '✕');
      x.type = 'button';
      x.title = 'no video';
      x.addEventListener('click', () => { Object.assign(f, { video: '', name: '', thumb: '', dur: 0, clip: null }); save(); paintMake(); paintPrice(); });
      att.appendChild(x);
    }
  };
  _attPaint = paint;
  att.addEventListener('dragover', (e) => { if (Array.from(e.dataTransfer.types || []).includes('Files')) { e.preventDefault(); e.stopPropagation(); att.classList.add('is-drop'); } });
  att.addEventListener('dragleave', () => att.classList.remove('is-drop'));
  att.addEventListener('drop', async (e) => {
    att.classList.remove('is-drop');
    const file = Array.from(e.dataTransfer.files || [])[0];
    if (!file) return;
    e.preventDefault();
    e.stopPropagation();
    const v = await _uploadVideo(file);
    if (v) { Object.assign(f, v, { clip: null }); save(); paintMake(); paintPrice(); }
  });
  paint();
  return att;
}
let _attPaint = null;          // the field of the video, painted again when the timeline changes under its clip
async function _uploadVideo(file) {
  say('Bringing the video in (VIDEO → Uploads)…');
  const fd = new FormData();
  fd.append('video', file);
  fd.append('name', file.name);
  // Into VIDEO → Uploads itself, as the chats file what they are given (phase V56, (ги4): no project folder any more).
  try {
    const d = await api('/api/mv3/video/upload', { method: 'POST', body: fd });
    say('"' + file.name + '" is in VIDEO → Uploads.');
    const it = d.item || {};
    return { video: it.videoPath, name: it.name || file.name, thumb: it.thumbPath || '', dur: +it.duration || 0 };
  } catch (e) { say(e.message, true); return null; }
}
// The request of the open mode, and where its Alerts row leads: back here, in this project.
function _body() {
  const f = S.f[S.mode];
  // Simple, Custom, Lyrics - the shared form's request (Simple's writer told this project's kind); the rest Merge's own.
  const b = F.body(WRITER_KIND[_kind()] || 'blank') || { mode: S.mode, model: S.model };
  if (S.mode === 'sounds') Object.assign(b, { prompt: f.prompt, loop: !!f.loop, tempo: f.tempo || 0, key: f.key || 'Any' });
  else if (S.mode === 'compose') Object.assign(b, { prompt: f.prompt, seconds: f.seconds || 0, instrumental: f.instrumental !== false });
  else if (S.mode === 'video') {
    // (phase V54) A clip - the server makes it into a file and lays the track under it - or a file of the library.
    const v = _v2m();
    if (f.clip) b.clip = { key: f.clip.key, clipId: f.clip.clipId, name: v.name, start: v.start, dur: v.dur };
    else Object.assign(b, { video: f.video, name: f.name || '' });
    Object.assign(b, { seconds: v.dur || 0, description: f.description, tags: f.tags, sfx: !!f.sfx, useAudio: !!f.useAudio });
  }
  else if (S.mode === 'sfx') Object.assign(b, { prompt: f.prompt, seconds: f.seconds || 0, loop: !!f.loop, influence: f.influence });
  const m = CAT.modes.find(x => x.id === S.mode);
  b.where = {
    page: 'merge', href: '/merge?p=' + encodeURIComponent(_key) + '&open=audio',
    label: 'Merge · ' + (Store.title() || 'project') + ' · audio · ' + (m ? m.label : S.mode),
    spot: { key: _key, view: 'audio' },
  };
  b.project = _key;
  return b;
}

let _going = false;
async function generate(btn) {
  if (_going || !_key) return;
  _going = true;
  btn.disabled = true;
  const err = btn.closest('.au-card').querySelector('.au-err');
  err.textContent = '';
  try {
    // (phase V54) A clip of the open timeline: the server reads it from the SAVED timeline - what is not saved yet goes first.
    const vc = S.mode === 'video' ? S.f.video.clip : null;
    if (vc && vc.key === Store.key() && !(await Store.flush())) throw new Error('The timeline could not be saved - the clip is read from the saved one. Try again in a moment.');
    const body = _body();
    // The shared press: a mood's next press turns another of its colours.
    const d = await F.press(body);
    if (body.preset) paintMake();
    GENS = [d.gen].concat(GENS.filter(g => g.id !== d.gen.id));
    paintMade();
    say(d.gen.kind === 'lyrics' ? 'Writing the lyrics…' : 'Asked - it is in Alerts too; you can go on working, the app files it when it comes.');
    _follow();
  } catch (e) {
    err.textContent = e.message;
  } finally {
    _going = false;
    btn.disabled = false;
  }
}

// ── what was made ───────────────────────────────────────────────────────────
const MODE_NAME = (id) => ((CAT && CAT.modes.find(m => m.id === id)) || { label: id }).label;
const _ago = (iso) => {
  const t = Date.parse(iso);
  if (!t) return '';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return s + ' s ago';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  const d = new Date(t);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ', ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
};
function paintMade() {
  if (!_ui) return;
  const host = _ui.made;
  host.textContent = '';
  _ui.madeN.textContent = GENS.length ? '· ' + GENS.length : '';
  if (!GENS.length) { host.appendChild(el('div', 'au-empty', 'Nothing yet for this project - what you make appears here, newest first.')); return; }
  for (const g of GENS) host.appendChild(_genCard(g));
}
function _genCard(g) {
  const card = el('div', 'au-gen' + (g.state === 'failed' ? ' is-failed' : ''));
  const h = el('div', 'au-gen-h');
  h.appendChild(el('span', 'au-state ' + (g.state === 'pending' ? 'run' : g.state === 'done' ? 'ok' : 'bad'),
    g.state === 'pending' ? 'making' : g.state === 'done' ? 'done' : (g.refused ? 'refused' : 'failed')));
  h.appendChild(el('b', null, g.said || MODE_NAME(g.mode)));
  h.appendChild(el('span', 'sp'));
  h.appendChild(el('span', null, (g.engine === 'eleven' ? 'ElevenLabs' : 'Suno') + ' · ' + MODE_NAME(g.mode) + (g.fake ? ' · FAKE' : '') + ' · ' + _ago(g.at)));
  if (g.state !== 'pending') {
    const x = el('button', 'au-x', '✕');
    x.type = 'button';
    x.title = 'Off this list - the files stay where they are';
    x.addEventListener('click', async () => {
      try { await api('/api/audio/gens/' + encodeURIComponent(g.id), { method: 'DELETE' }); GENS = GENS.filter(y => y.id !== g.id); paintMade(); }
      catch (e) { say(e.message, true); }
    });
    h.appendChild(x);
  }
  card.appendChild(h);
  if (g.mode === 'simple' && g.written && g.written.style) {
    const w = el('div', 'au-said');
    w.appendChild(el('b', null, (g.written.by === 'as picked' ? 'Sent as picked' : g.written.by === 'preset' ? 'The mood\'s preset' : 'The writer wrote') + ': '));
    w.appendChild(document.createTextNode(g.written.title + ' — ' + g.written.style));
    if (g.fell) w.appendChild(el('div', 'au-muted', g.fell));
    card.appendChild(w);
  }
  if (g.state === 'pending') {
    const bar = el('div', 'au-bar');
    bar.appendChild(el('i'));
    card.appendChild(bar);
    const row = el('div', 'au-gen-h');
    row.appendChild(el('span', null, (g.stage || (g.taskId ? (g.engine === 'eleven' ? 'ElevenLabs is making it' : 'Suno is making it') : 'starting')) + ' · ' + _ago(g.at).replace(' ago', '')));
    row.appendChild(el('span', 'sp'));
    if (g.alertId) {
      const st = el('button', 'au-link', 'stop waiting');
      st.type = 'button';
      st.title = 'It stops being waited for and is not filed - the money is not given back';
      st.addEventListener('click', async () => {
        try { await post('/api/alerts/' + encodeURIComponent(g.alertId) + '/cancel', {}); _poll(); } catch (e) { say(e.message, true); }
      });
      row.appendChild(st);
    }
    card.appendChild(row);
  } else if (g.state === 'failed') {
    card.appendChild(el('div', 'au-err', g.error || 'it did not come'));
    if (g.alertId && !g.refused) {
      const again = el('button', 'au-link', 'try again (pays again)');
      again.type = 'button';
      again.addEventListener('click', async () => {
        if (!window.confirm('Ask for it again? It costs ' + (g.engine === 'eleven' ? 'ElevenLabs credits' : 'kie credits') + ' again.')) return;
        try { await post('/api/alerts/' + encodeURIComponent(g.alertId) + '/retry', {}); say('Asked again.'); _follow(); _poll(); } catch (e) { say(e.message, true); }
      });
      card.appendChild(again);
    }
  } else if (g.kind === 'lyrics') {
    for (const l of (g.lyrics || [])) card.appendChild(_lyric(l));
  } else {
    for (const r of (g.results || [])) card.appendChild(_result(r));
    // (phase V54) Made from a clip: where its track was laid, or why not.
    if (g.laid) card.appendChild(el('div', 'au-said', 'Laid under its clip on ' + g.laid.lane + ' at ' + _clock(g.laid.at) + '.'));
    else if (g.notLaid) card.appendChild(el('div', 'au-said', 'Not laid on the timeline: ' + g.notLaid + '.'));
  }
  return card;
}

// One sound heard at a time: a press on a row plays it, a press again stops it; the row shows how far it is.
let _hear = null;
function _stopHearing() {
  if (!_hear) return;
  try { _hear.audio.pause(); } catch (e) { /* gone */ }
  _hear.row.classList.remove('is-playing');
  _hear.row.style.removeProperty('--p');
  _hear = null;
}
function _hearToggle(path, row) {
  if (_hear && _hear.path === path) { _stopHearing(); return; }
  _stopHearing();
  const audio = new Audio(path);
  _hear = { path, row, audio };
  row.classList.add('is-playing');
  audio.addEventListener('timeupdate', () => { if (_hear && _hear.audio === audio && audio.duration) row.style.setProperty('--p', (audio.currentTime / audio.duration * 100).toFixed(1) + '%'); });
  audio.addEventListener('ended', () => { if (_hear && _hear.audio === audio) _stopHearing(); });
  audio.play().catch(() => { _stopHearing(); say('That file will not play', true); });
}

function _result(r) {
  const it = LIBIDX.get(r.path);
  const row = el('div', 'au-res' + (_hear && _hear.path === r.path ? ' is-playing' : ''));
  row.dataset.path = r.path;
  const pb = el('button', 'au-play', '▶');
  pb.type = 'button';
  row.appendChild(pb);
  row.appendChild(el('span', 'au-res-n', (it && it.name) || r.title));
  row.appendChild(waveEl(it ? (it.meta || {}).wave : [], 'au-wave'));
  row.appendChild(el('span', 'au-muted', secs(r.dur)));
  if (it) {
    const fav = !!(it.meta && it.meta.favorite);
    const star = el('button', 'au-star' + (fav ? ' on' : ''), fav ? '★' : '☆');
    star.type = 'button';
    star.title = fav ? 'Take it out of Favorites' : 'Into Favorites';
    star.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await api('/api/library/item/' + encodeURIComponent(it.kind) + '/' + encodeURIComponent(it.id),
          { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ favorite: !fav }) });
        await _index();
        paintMade();
        window.dispatchEvent(new Event('mv3:lib-reload'));
      } catch (er) { say(er.message, true); }
    });
    row.appendChild(star);
    const show = el('button', 'au-link', 'show');
    show.type = 'button';
    show.title = 'Where it lies - on the shelf, in its place in the tree';
    show.addEventListener('click', async (e) => {
      e.stopPropagation();
      _stopHearing();
      const L = await import('./library.js');
      L.reveal(r.path);
    });
    row.appendChild(show);
  } else {
    row.appendChild(el('span', 'au-muted', 'deleted'));
  }
  row.addEventListener('click', () => _hearToggle(r.path, row));
  // Onto an audio lane, as a tile of the shelf is: a track of music lies as a bed, a sound as a sound effect.
  if (it) {
    row.draggable = true;
    row.title = 'A press plays it · drag it onto an audio lane';
    row.addEventListener('dragstart', (e) => {
      // (phase V49) Not onto a highlights project's own timeline - a fragment is opened first.
      if (refuseHome(row, e)) return;
      e.dataTransfer.effectAllowed = 'copyMove';
      e.dataTransfer.setData(DRAG_TYPE, JSON.stringify({
        libId: it.id, src: it.media, thumb: null, name: it.name || r.title || '', group: it.kind,
        dur: +it.dur || +r.dur || 0, media: 'audio', bed: it.kind === 'music',
      }));
      e.dataTransfer.setData(DRAG_MEDIA + 'audio', '1');
      setMediaDrag(e.dataTransfer, it);
    });
  }
  return row;
}
// A text of Lyrics - the shared form's card ("use in custom", "copy", "all").
const _lyric = (l) => F.lyricCard(l);

// The shelf's items by path: a result row's name, waveform and star - and what a lane is given when it is dragged.
async function _index() {
  const map = new Map();
  for (const f of ['music', 'sounds']) {
    try { for (const it of (await api('/api/library/shelf/media?filter=' + f)).items || []) map.set(String(it.media || '').split('?')[0], it); } catch (e) { /* none */ }
  }
  LIBIDX = map;
}

// Followed while anything is being made and the view is up: every 3 s, the list again; what ended is filed, the shelf read
// again. Alerts says when something lands while the view is not up.
let _timer = 0;
async function _poll() {
  if (!_key) return;
  const asked = _key;
  let d;
  try { d = await api('/api/audio/gens?limit=40&project=' + encodeURIComponent(_key)); } catch (e) { return; }
  if (asked !== _key) return;
  const before = new Map(GENS.map(g => [g.id, g.state]));
  GENS = d.items || [];
  const ended = GENS.some(g => before.get(g.id) === 'pending' && g.state !== 'pending');
  if (ended) {
    await _index();
    window.dispatchEvent(new Event('mv3:lib-reload'));
    const done = GENS.find(g => before.get(g.id) === 'pending' && g.state === 'done');
    const moodOf = (g) => (g.req && g.req.preset ? (_moods().find(m => m.id === g.req.preset) || { label: g.req.preset }).label : '');
    if (done) say((done.kind === 'lyrics' ? 'The lyrics are here.' : 'Done - ' + (done.kind === 'sound' ? 'in SFX → My sounds → Generated.'
      : moodOf(done) ? 'in Music → highlights → ' + moodOf(done) + '.'
      : done.laid ? 'in AUDIO → Music, and laid under its clip on ' + done.laid.lane + '.'
      : done.notLaid ? 'in AUDIO → Music; not laid on the timeline - ' + done.notLaid + '.' : 'in AUDIO → Music.')));
    // (phase V54) The server laid a track on the timeline open here: taken now, not at the next look in 20 s.
    if (GENS.some(g => before.get(g.id) === 'pending' && g.laid && g.laid.key === Store.key())) Store.refresh();
  }
  paintMade();
  if (!GENS.some(g => g.state === 'pending')) _unfollow();
}
function _follow() {
  if (_timer || !_shown) return;
  _timer = setInterval(_poll, 3000);
}
function _unfollow() { clearInterval(_timer); _timer = 0; }

// The almanac (V34.A's notes, a press copies one) is the shared form's - js/sound/suno-form.js.

// ── the view ────────────────────────────────────────────────────────────────
// Built the first time it shows: the settings column, the middle (the word line, the constructor), the sash, "Made here".
// Narrower than 900 px "Made here" goes under the constructor (.au-mid); narrower than 620 the settings column goes above
// both (.au-narrow).
const KEY_MADE_W = 'mv3_audio_made_w';
function _build() {
  if (_ui) return;
  const root = $('mv3-ac');
  if (!root) return;
  root.textContent = '';
  const set = el('div', 'mv3-ig-set au-set');
  const col = el('div', 'mv3-ig-scroll');
  const alm = el('div', 'au-alm-foot');
  set.append(col, alm);
  const mid = el('div', 'au-mid');
  const status = el('div', 'au-status');
  status.hidden = true;
  const make = el('div', 'au-make');
  mid.append(status, make);
  const sash = el('div', 'mv3-lib-sash au-sash');
  sash.title = 'Drag to resize - a double press gives the default width back';
  // The right column: "Made here" - or (phase V54) in Video to Music the VIDEO tree, "Made here" under the constructor.
  const madeCol = el('div', 'au-madecol');
  const madeBox = el('div', 'au-madebox');
  const madeH = el('div', 'au-made-h', 'Made here ');
  const madeN = el('span', 'au-muted');
  madeH.appendChild(madeN);
  const made = el('div', 'au-made');
  madeBox.append(madeH, made);
  const v2m = el('div', 'au-v2m');
  const v2mGal = el('div', 'au-v2m-gal');
  const v2mTree = el('div', 'au-v2m-tree');
  v2m.append(v2mGal, v2mTree);
  v2m.hidden = true;
  madeCol.append(madeBox);
  root.append(set, mid, sash, madeCol);
  _ui = { root, set, col, alm, mid, status, make, sash, madeCol, madeBox, made, madeN, v2m, v2mGal, v2mTree, price: null, narrow: '' };
  _wireMadeSash();
  new ResizeObserver(() => _fit()).observe(root);
}
function _fit() {
  if (!_ui) return;
  const w = _ui.root.clientWidth;
  if (!w) return;
  // Its own names: the chats' `is-narrow` (css/mv3-imagen.css) folds their settings into one row, which this column is not.
  const n = w < 620 ? 'au-narrow' : w < 900 ? 'au-mid' : '';
  if (n === _ui.narrow) return;
  _ui.narrow = n;
  _ui.root.classList.toggle('au-narrow', n === 'au-narrow');
  _ui.root.classList.toggle('au-mid', n !== '');
  _place();
}
// Where the right column's parts go. Wide: beside the constructor behind the sash - "Made here", or in Video to Music the VIDEO
// tree with "Made here" under the constructor. Narrower than 900 px: all of it under the constructor, the tree first.
function _place() {
  if (!_ui) return;
  const video = S.mode === 'video';
  _ui.v2m.hidden = !video;
  _ui.root.classList.toggle('au-v2m-on', video);
  if (_ui.narrow) {
    _ui.mid.appendChild(_ui.madeCol);
    if (video) _ui.madeCol.append(_ui.v2m, _ui.madeBox);
    else _ui.madeCol.append(_ui.madeBox);
  } else {
    _ui.root.appendChild(_ui.madeCol);
    if (video) { _ui.madeCol.appendChild(_ui.v2m); _ui.mid.appendChild(_ui.madeBox); }
    else _ui.madeCol.appendChild(_ui.madeBox);
  }
  if (video) _v2mOpen();
}

// ── The VIDEO tree of Video to Music (phase V54, the owner's (зв23), (зв24), (зв31)) ─────────────────────────────────────
// js/media-tree.js with VIDEO alone (`roots`, A's), remembering its own branches (`page: 'v2m'`) - no renders in it. The
// gallery beside it: the path to the node open, its folders as tiles, then the videos lying directly in it (the shelf's `q`);
// a press on one puts it into "The video" - a longer one than ten minutes is refused in words.
let _vtree = null;
let _vseq = 0;
let _vRead = 0;                // when the tree was last read - read again on coming back to the mode
function _v2mOpen() {
  if (!_ui) return;
  if (!_vtree) {
    _vtree = createTree(_ui.v2mTree, { page: 'v2m', roots: ['video'], fallback: 'uploads',
      status: (t, bad) => { if (t) say(t, bad); },
      onSelect: (n) => _v2mLoad(n),
      onChanged: () => _v2mLoad(_vtree.selected()) });
  }
  if (Date.now() - _vRead < 2000) return;
  _vRead = Date.now();
  _vtree.load().then(() => _v2mLoad(_vtree.selected()));
}
async function _v2mLoad(n) {
  if (!_ui || !_vtree || !n) return;
  const mine = ++_vseq;
  const gal = _ui.v2mGal;
  gal.textContent = '';
  gal.appendChild(_vtree.crumbsEl(n));
  const fold = _vtree.foldersEl(n);
  if (fold) gal.appendChild(fold);
  const grid = el('div', 'au-v2m-grid');
  gal.appendChild(grid);
  if (!n.q) { if (!fold) grid.appendChild(el('div', 'au-empty', 'Nothing here.')); return; }
  grid.appendChild(el('div', 'au-empty', 'reading…'));
  let items = [];
  try {
    const d = await api('/api/library/shelf/media?' + new URLSearchParams(n.q));
    items = (d.items || []).filter(i => i && i.media && /\.(mp4|mov|webm|m4v|mkv)$/i.test(String(i.media).split('?')[0]));
  } catch (e) {
    if (mine === _vseq) { grid.textContent = ''; grid.appendChild(el('div', 'au-err', e.message)); }
    return;
  }
  if (mine !== _vseq) return;
  grid.textContent = '';
  if (!items.length && !fold) grid.appendChild(el('div', 'au-empty', 'No videos here.'));
  for (const it of items) grid.appendChild(_v2mTile(it));
}
function _v2mTile(it) {
  const f = S.f.video;
  const dur = +it.dur || +((it.meta || {}).dur) || 0;
  const long = dur > V2M_MAX;
  const b = el('button', 'au-v2m-it' + (!f.clip && f.video === it.media ? ' is-on' : '') + (long ? ' is-long' : ''));
  b.type = 'button';
  b.dataset.media = it.media;
  if (it.thumb) { const im = el('img'); im.src = it.thumb; im.loading = 'lazy'; im.alt = ''; b.appendChild(im); } else b.appendChild(el('div', 'au-att-ph'));
  b.appendChild(el('span', 'nm', it.name || String(it.media).split('/').pop()));
  if (dur) b.appendChild(el('span', 'd', secs(dur)));
  b.title = (it.name || '') + (dur ? ' · ' + secs(dur) : '') + (long ? ' - longer than 10 minutes: Video to Music takes up to 10'
    : ' - a press puts it into "The video"; its music goes to Music only');
  b.addEventListener('click', () => {
    if (long) { say('"' + (it.name || 'that video') + '" is ' + secs(dur) + ' - Video to Music takes up to 10 minutes.', true); return; }
    Object.assign(f, { clip: null, video: it.media, name: it.name || '', thumb: it.thumb || '', dur });
    save();
    paintMake();
    paintPrice();
    for (const x of _ui.v2mGal.querySelectorAll('.au-v2m-it')) x.classList.toggle('is-on', x.dataset.media === it.media);
  });
  return b;
}

/**
 * (phase V54, block 2) THE RIGHT BUTTON ON A CLIP (timeline-b.js): "generate audio" -> ElevenLabs -> Video to Music opens with
 * THAT clip in "The video" - nothing is asked until "generate". `o` - { key, trackId, clipId } of the open timeline.
 */
export async function videoToMusicFromClip(o) {
  if (!_allowed() || !o || !o.clipId) return;
  const t = ((Store.timeline() || {}).tracks || []).find(x => x.id === o.trackId);
  const c = t && (t.clips || []).find(x => x.id === o.clipId);
  if (!c) return;
  await openAudio();
  if (!CAT || !_shown) return;
  Object.assign(S.f.video, { video: '', name: '', thumb: '', dur: 0,
    clip: { key: String(o.key || Store.key()), trackId: t.id, clipId: c.id, name: c.name || '', start: +c.start || 0, dur: +c.dur || 0, thumb: c.thumb || '' } });
  if (S.mode !== 'video') setMode('video');
  else { save(); paintCol(); paintMake(); }
  say('The clip is in "The video" - say what you want if you like, then generate. Its track is laid under it when it comes.');
}
function _wireMadeSash() {
  const { sash, madeCol: box, root } = _ui;
  const room = () => {
    const view = root.getBoundingClientRect().width;
    const set = _ui.set.getBoundingClientRect().width;
    return Math.max(260, view - set - 360 - 5);
  };
  const apply = (w) => {
    if (!(w > 0)) { box.style.flexBasis = ''; return 0; }
    const v = Math.max(260, Math.min(room(), Math.round(w)));
    box.style.flexBasis = v + 'px';
    return v;
  };
  apply(+ls(KEY_MADE_W, 0) || 0);
  sash.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const from = e.clientX;
    const base = box.getBoundingClientRect().width;
    document.body.classList.add('mv3-resize-v');
    const move = (ev) => apply(base - (ev.clientX - from));
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.body.classList.remove('mv3-resize-v');
      lsSet(KEY_MADE_W, Math.round(box.getBoundingClientRect().width));
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
  sash.addEventListener('dblclick', () => { apply(0); lsSet(KEY_MADE_W, 0); });
}

// The catalog and the almanac - the shared form reads them once (a model it does not know falls back to V6).
async function _ready() {
  const ok = await F.ready();
  CAT = F.cat();
  return ok;
}

// `remember` is false when another view took the base (onYield): that one writes its own mark.
async function _show(on, remember = true) {
  _shown = !!on;
  if (remember) Views.rememberView(_lk(_key), _shown ? NAME : null, NAME);
  Views.setBase(NAME, _shown);
  if (!_shown) { _stopHearing(); _unfollow(); F.closeAlmanac(); return; }
  _build();
  if (!(await _ready()) || !_shown) return;
  _forProject();
  paintCol();
  paintMake();
  GENS = [];
  paintMade();
  await _index();
  await _poll();
  if (GENS.some(g => g.state === 'pending')) _follow();
  requestAnimationFrame(_fit);
}

/** Every way in: the crumb, ?open=audio (an Alerts row). */
export async function openAudio() {
  if (!_allowed()) return;
  Views.toBase();
  setOpenColumn('library');
  await _show(true);
}

function _crumb() {
  const c = $('mv3-lib-agen');
  if (c) c.hidden = !(Store.isReady() && !!Store.key());
}

function _onStore() {
  if (!Store.isReady()) return;
  _crumb();
  // (phase V54) The clip in "The video" as it is now - moved, trimmed, taken off.
  if (_shown && S.mode === 'video' && S.f.video.clip && _attPaint) { _attPaint(); paintPrice(); paintMakePrice(); }
  // (phase V49, (пр5)) A highlights fragment's key is its project's home: another fragment pressed is no project switch here.
  const k = Views.chatKey(Store.key());
  // The draft saved under a name: its own from now on, and it stays on the view it was on.
  if (k === _key && _draftHere && !Store.isDraft()) {
    _draftHere = false;
    if (_shown) Views.rememberView(k, NAME);
    return;
  }
  if (k === _key) return;
  _key = k;
  _draftHere = !!Store.isDraft();
  _stopHearing();
  _unfollow();
  const want = _allowed() && Views.viewOf(_lk(k)) === NAME;
  if (want) _show(true, false);
  else if (_shown) _show(false, false);
  else Views.sync();
}

export function initAudChat() {
  Views.registerChat(NAME, {
    root: 'mv3-ac', crumb: 'mv3-lib-agen',
    crumbTitle: 'Generate music and sounds - Suno and ElevenLabs',
    onBack: () => _show(false), onYield: () => _show(false, false), onCrumb: () => { openAudio(); },
  });
  Store.onChange(_onStore);
  _onStore();
}
