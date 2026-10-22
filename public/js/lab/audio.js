/* ═══════════════════════════════════════════════════════════════════════════
   THE AUDIO LAB (phase V34.D, the owner 2026-10-22) - /lab/audio, public/lab/audio.html. A page of the app where the
   "generate audio" chat is tried before it moves into Merge (V34.E): "у каждого режима будет свой вид чата. типа это не
   совсем чат будет а основное одно сообщение от бота типа конструктора под каждый режим и поле для прикрепления, где
   нужно… импровизируй".

     left     the settings: the project the music is for (its kind picks the mode: a talking head - simple; blank,
              highlights - custom; its video's length is the length), the engine (Suno · kie.ai | ElevenLabs), the mode,
              the model, the length, the chips (the almanac's - public/js/audio/almanac-data.js, V34.A), the price of a
              press, the almanac's gold button
     middle   ONE message of the app - the CONSTRUCTOR of the open mode: its fields, its attachment where it takes one
              (Video to Music: a video), "generate". Below it, what was made (the records of GET /api/audio/gens): a press
              is a card - its stage while it is made, its tracks or sounds with a player and ★ when done, the lyrics with
              "use in custom", its error and "try again" when it failed
     right    AUDIO's gallery and tree (js/lab/audio-tree.js), the cut (audio-cut.js), the online search (audio-online.js)

   The server is the app's (routes/audio-gen.js, routes/audio-lib.js): a press writes its record and its Alerts row at
   once, the server asks, waits, downloads and files - the page only follows. What the person set is remembered
   (localStorage `ugc_lab_audio_v1`, mirrored into the library).
   ═══════════════════════════════════════════════════════════════════════════ */

import { initNav } from '../app-nav.js';
import * as Layers from '../layers.js';
import * as Tree from './audio-tree.js';
import * as Lanes from './audio-lanes.js';
import { openCut } from './audio-cut.js';
import { openOnline } from './audio-online.js';
import { waveEl, playToggle, playing, onChange, secs } from './audio-play.js';

initNav();

const $ = (s) => document.querySelector(s);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const KEY = 'ugc_lab_audio_v1';
const ls = (k, fb) => { try { const v = localStorage.getItem(k); return v == null ? fb : JSON.parse(v); } catch (e) { return fb; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* a private window */ } };
async function api(url, opts) {
  const r = await fetch(url, opts);
  const d = await r.json().catch(() => null);
  if (!d || d.success === false) throw new Error((d && d.error) || ('status ' + r.status));
  return d;
}
const post = (url, body) => api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });

let _sayT = 0;
function say(text, bad) {
  const s = $('#la-status');
  s.textContent = text || '';
  s.hidden = !text;
  s.classList.toggle('is-bad', !!bad);
  clearTimeout(_sayT);
  if (text && !bad) _sayT = setTimeout(() => { if (s.textContent === text) { s.textContent = ''; s.hidden = true; } }, 9000);
}

// ── what the person set ─────────────────────────────────────────────────────
const MODE_HELP = {
  simple: 'Background music with no voice, for a video where somebody talks. Pick the feel with the chips on the left and, if you like, say more in your own words (any language). The writer turns it into Suno\'s style and Suno makes TWO tracks of the length on the left. They go to AUDIO → Music.',
  custom: 'You write it: a title, a style and - unless it is instrumental - the lyrics ([Verse], [Chorus]…). The chips on the left add their words to the style. Suno makes TWO tracks; the length on the left (10–360 s) or Suno\'s own.',
  lyrics: 'Song lyrics from an idea - two or three texts. A text can go straight into Custom with "use in custom". Text only: no row in Alerts.',
  sounds: 'A sound or a loop by Suno, from a description. It goes to SFX → My sounds → Generated.',
  compose: 'Music by ElevenLabs from a description - instrumental unless you untick it. The chips add their words. It goes to AUDIO → Music.',
  video: 'Music made FOR a video: ElevenLabs watches it (cuts, pace, mood) and scores it. Choose the video below; say what you want if you like. It goes to AUDIO → Music.',
  sfx: 'A sound effect by ElevenLabs, from a description - up to 30 s, or the length it picks. It goes to SFX → My sounds → Generated.',
};
const MODEL_HELP = { V6: 'the newest - most natural', V6_MINI: 'faster', V6_WILD: 'bolder, stranger' };
const KIND_MODE = { 'talking head': 'simple', blank: 'custom', highlights: 'custom', draft: 'custom' };
const WRITER_KIND = { 'talking head': 'talking-head', blank: 'blank', highlights: 'highlights', draft: 'draft' };

const S = Object.assign({
  project: '', engine: 'suno', mode: 'simple', model: 'V6',
  lastMode: { suno: 'simple', eleven: 'compose' },
  f: {},
}, ls(KEY, {}));
S.f = Object.assign({
  simple: { words: '', seconds: 30, writer: true, picked: { genre: [], mood: [], sound: [] }, flat: [] },
  custom: { title: '', style: '', lyrics: '', instrumental: false, vocal: '', negative: '', styleWeight: '', weirdness: '', variety: 0, seconds: 0 },
  lyrics: { idea: '' },
  sounds: { prompt: '', loop: false, tempo: 0, key: 'Any' },
  compose: { prompt: '', seconds: 30, instrumental: true },
  video: { video: '', name: '', thumb: '', description: '', tags: '', sfx: false, useAudio: false },
  sfx: { prompt: '', seconds: 0, loop: false, influence: 0.3 },
}, S.f || {});
const save = () => lsSet(KEY, { project: S.project, engine: S.engine, mode: S.mode, model: S.model, lastMode: S.lastMode, f: S.f });

let CAT = null;            // GET /api/audio/catalog
let ALM = null;            // the almanac module, when it is there
let PROJECTS = [];
let GENS = [];
let LIBIDX = new Map();    // path -> a tile of the library (its wave, star, id)

const _proj = () => PROJECTS.find(p => p.key === S.project) || null;
const _chipsGroups = () => {
  // The almanac's (V34.A: { genre, mood, sound } of { id, label, style }) - else the catalog's three lists of words.
  if (ALM && ALM.CHIPS && Array.isArray(ALM.CHIPS.genre)) {
    return [['genre', 'Genre'], ['mood', 'Mood'], ['sound', 'Sound']]
      .map(([k, label]) => ({ key: k, label, chips: (ALM.CHIPS[k] || []).map(c => ({ id: c.id, label: c.label, style: c.style || c.label })) }))
      .filter(g => g.chips.length);
  }
  return ((CAT && CAT.chips) || []).map(g => ({ key: '', label: g.label, chips: g.chips.map(c => ({ id: c, label: c, style: c })) }));
};

// ── the settings column: Merge's chat column (.mv3-ig-set, css/mv3-imagen.css) ─────────────────────────────────
// The project is the page's own picker (the bar above, as in Merge): its kind picks the mode, its video the length.
function paintProjects() {
  const ps = $('#mv3-project');
  ps.textContent = '';
  const none = el('option', null, '— no project —');
  none.value = '';
  ps.appendChild(none);
  for (const p of PROJECTS) {
    const op = el('option', null, p.title + ' · ' + p.kind + (p.seconds ? ' · ' + secs(p.seconds) : ''));
    op.value = p.key;
    ps.appendChild(op);
  }
  ps.value = S.project;
  const p = _proj();
  $('#la-proj-note').textContent = p ? 'a ' + p.kind + ' - ' + (KIND_MODE[p.kind] === 'simple' ? 'Simple' : 'Custom') + ' by default, the length of its video' : 'pick one: its kind sets the mode, its video the length';
  $('#la-stage').textContent = p ? p.title : 'no project';
}

function paintCol() {
  const col = $('#la-col');
  col.textContent = '';
  const row = (label, body, note) => {
    const r = el('div', 'mv3-ig-row');
    if (label) r.appendChild(el('label', null, label));
    r.appendChild(body);
    if (note) r.appendChild(el('div', 'la-note', note));
    col.appendChild(r);
    return r;
  };
  const sep = (text) => col.appendChild(el('div', 'mv3-ig-sep', text));

  // The engine: two buttons, as a chat's shape row.
  const seg = el('div', 'mv3-ig-ar-row la-seg');
  for (const e of (CAT ? CAT.engines : [])) {
    const b = el('button', 'mv3-ig-ar-b' + (S.engine === e.id ? ' on' : ''), e.label);
    b.type = 'button';
    b.addEventListener('click', () => setEngine(e.id));
    seg.appendChild(b);
  }
  row('Engine', seg, CAT && !CAT.keys[S.engine === 'eleven' ? 'eleven' : 'kie'] && !CAT.fake
    ? 'No ' + (S.engine === 'eleven' ? 'ElevenLabs' : 'kie.ai') + ' key - add it on Admin → API keys.' : '');

  const ms = el('select');
  for (const m of (CAT ? CAT.modes.filter(x => x.engine === S.engine) : [])) {
    const op = el('option', null, m.label);
    op.value = m.id;
    ms.appendChild(op);
  }
  ms.value = S.mode;
  ms.addEventListener('change', () => setMode(ms.value));
  row('Mode', ms);

  if (S.engine === 'suno' && S.mode !== 'lyrics') {
    const mo = el('select');
    for (const id of (CAT ? CAT.sunoModels : ['V6'])) {
      const op = el('option', null, id + ' - ' + (MODEL_HELP[id] || ''));
      op.value = id;
      mo.appendChild(op);
    }
    mo.value = S.model;
    mo.addEventListener('change', () => { S.model = mo.value; save(); });
    row('Model', mo, 'one price for all three');
  } else if (S.engine === 'eleven') {
    row('Model', el('div', 'la-note', S.mode === 'sfx' ? 'eleven_text_to_sound_v2' : S.mode === 'compose' ? 'music_v2_5 (Eleven Music)' : 'Eleven Music'));
  }

  // The length: what a mode takes, 0 - the model decides.
  const LEN = { simple: [0, 360, 'the video\'s length - the bed comes out a little longer'], custom: [10, 360, '10–360 s'],
    compose: [3, 600, '3 s – 10 min'], sfx: [0.5, 30, '0.5–30 s'] };
  if (LEN[S.mode]) {
    const [lo, hi, note] = LEN[S.mode];
    const f = S.f[S.mode];
    sep('Length');
    const r = el('div', 'la-len');
    const n = el('input', 'la-in');
    n.type = 'number'; n.min = '0'; n.max = String(hi); n.step = S.mode === 'sfx' ? '0.5' : '1';
    n.value = f.seconds ? String(f.seconds) : '';
    n.placeholder = 'auto';
    n.addEventListener('change', () => {
      const v = +n.value || 0;
      f.seconds = v <= 0 ? 0 : Math.max(lo || 1, Math.min(hi, v));
      n.value = f.seconds ? String(f.seconds) : '';
      save(); paintPrice();
    });
    r.append(n, el('span', 'la-len-auto', 's · empty - the model decides'));
    if (_proj() && _proj().seconds && S.mode !== 'sfx') {
      const by = el('button', 'la-link', 'by the video (' + secs(_proj().seconds) + ')');
      by.type = 'button';
      by.addEventListener('click', () => { f.seconds = Math.max(lo || 1, Math.min(hi, Math.round(_proj().seconds))); save(); paintCol(); });
      r.appendChild(by);
    }
    row('', r, note);
  }

  // The chips: in Simple they ARE the request; in Custom and ElevenLabs' music a chip adds its words to the text.
  if (['simple', 'custom', 'compose'].includes(S.mode)) {
    for (const g of _chipsGroups()) {
      sep(g.label);
      const wrap = el('div', 'mv3-chips');
      for (const c of g.chips) {
        const on = S.mode === 'simple' && _isPicked(g.key, c);
        const b = el('button', 'mv3-chip' + (on ? ' on' : ''), c.label);
        b.type = 'button';
        b.title = c.style;
        b.addEventListener('click', () => {
          if (S.mode === 'simple') { _pick(g.key, c); paintCol(); paintMake(); }
          else _addWords(c.style);
        });
        wrap.appendChild(b);
      }
      col.appendChild(wrap);
    }
    col.appendChild(el('div', 'la-note', S.mode === 'simple' ? 'What the music is: the writer reads them with your words.'
      : 'A press adds the chip\'s words to the ' + (S.mode === 'custom' ? 'style' : 'description') + '.'));
  }

  const cost = el('div', 'mv3-ig-cost');
  cost.id = 'la-price';
  col.appendChild(cost);
  paintPrice();

  // The almanac at the foot of the column, as in the video chat: V34.A's notes, a press puts one into its field.
  const foot = $('#la-alm');
  foot.textContent = '';
  const alm = el('button', 'mv3-vc-almanac' + (_almSections().length ? '' : ' is-soon'), 'almanac');
  alm.type = 'button';
  alm.title = _almSections().length ? 'Notes on styles and sounds - a press puts one into its field' : 'The almanac of music and sounds is being written - soon';
  alm.addEventListener('click', () => { if (_almSections().length) openAlmanac(alm); else say('The almanac is being written (V34.A) - soon.'); });
  foot.appendChild(alm);
}

function _isPicked(group, c) {
  const f = S.f.simple;
  return group ? (f.picked[group] || []).includes(c.id) : (f.flat || []).includes(c.label);
}
function _pick(group, c) {
  const f = S.f.simple;
  if (group) {
    const l = f.picked[group] || (f.picked[group] = []);
    const i = l.indexOf(c.id);
    if (i >= 0) l.splice(i, 1); else l.push(c.id);
  } else {
    f.flat = f.flat || [];
    const i = f.flat.indexOf(c.label);
    if (i >= 0) f.flat.splice(i, 1); else f.flat.push(c.label);
  }
  save();
}
function _pickedLabels() {
  const out = [];
  for (const g of _chipsGroups()) for (const c of g.chips) if (_isPicked(g.key, c)) out.push(c.label);
  return out;
}
function _addWords(words) {
  const key = S.mode === 'custom' ? 'style' : 'prompt';
  const f = S.f[S.mode];
  const cur = String(f[key] || '').trim();
  f[key] = cur ? cur.replace(/[,\s]*$/, '') + ', ' + words : words;
  save();
  paintMake();
}

function _price() {
  const P = (CAT && CAT.prices) || {};
  const p = P[S.mode];
  if (!p) return { big: '', small: '' };
  const f = S.f[S.mode] || {};
  if (p.credits != null) return { big: '$' + p.usd, small: p.credits + ' kie credits · ' + p.note };
  if (p.usdPerMin) {
    if (S.mode === 'video') return { big: '≈ $' + p.usdPerMin + '/min', small: 'of music, as long as the video' };
    const sec = +f.seconds || 0;
    return sec ? { big: '≈ $' + (p.usdPerMin * sec / 60).toFixed(3), small: sec + ' s · ' + p.note } : { big: '≈ $' + p.usdPerMin + '/min', small: p.note };
  }
  if (p.elPerSec) {
    const sec = +f.seconds || 0;
    return sec ? { big: '≈ ' + Math.round(p.elPerSec * sec), small: 'ElevenLabs credits for ' + sec + ' s' }
      : { big: '≈ ' + p.elPerSec + '/s', small: 'ElevenLabs credits per second of what comes back' };
  }
  return { big: '', small: '' };
}
const _priceText = () => { const p = _price(); return p.big ? p.big + ' · ' + p.small : ''; };
function paintPrice() {
  const box = $('#la-price');
  if (!box) return;
  const p = _price();
  box.textContent = '';
  box.appendChild(el('b', null, p.big));
  box.appendChild(el('span', null, 'per press · ' + p.small + (CAT && CAT.fake ? ' · FAKE - nothing is paid' : '')));
}

function setProject(key, apply) {
  S.project = key;
  const p = _proj();
  if (p && apply) {
    const mode = KIND_MODE[p.kind] || 'custom';
    S.engine = 'suno';
    S.mode = mode;
    if (p.seconds > 0) {
      S.f.simple.seconds = Math.min(360, Math.round(p.seconds));
      S.f.custom.seconds = Math.max(10, Math.min(360, Math.round(p.seconds)));
      S.f.compose.seconds = Math.max(3, Math.min(600, Math.round(p.seconds)));
    }
  }
  save();
  paintProjects();
  paintCol();
  paintMake();
  Lanes.show(S.project);
}
function setEngine(id) {
  if (S.engine === id) return;
  S.lastMode[S.engine] = S.mode;
  S.engine = id;
  S.mode = S.lastMode[id] || (CAT.engines.find(e => e.id === id) || { modes: ['compose'] }).modes[0];
  save();
  paintCol();
  paintMake();
}
function setMode(id) {
  const m = CAT && CAT.modes.find(x => x.id === id);
  if (!m) return;
  S.mode = id;
  S.engine = m.engine;
  S.lastMode[m.engine] = id;
  save();
  paintCol();
  paintMake();
}

// ── the constructor ─────────────────────────────────────────────────────────
function _field(label, input, opts) {
  const o = opts || {};
  const f = el('div', 'la-f');
  const h = el('div', 'la-f-h');
  h.appendChild(document.createTextNode(label));
  if (o.small) h.appendChild(el('small', null, o.small));
  if (o.max) {
    const cnt = el('span', 'la-cnt');
    const upd = () => { const n = String(input.value || '').length; cnt.textContent = n + ' / ' + o.max; cnt.classList.toggle('is-over', n > o.max); };
    input.addEventListener('input', upd);
    upd();
    h.appendChild(cnt);
  }
  f.append(h, input);
  return f;
}
function _text(obj, key, opts) {
  const o = opts || {};
  const t = el(o.area ? 'textarea' : 'input', o.area ? 'la-ta' : 'la-in');
  if (!o.area) t.type = 'text';
  if (o.rows) t.rows = o.rows;
  t.placeholder = o.placeholder || '';
  t.value = obj[key] == null ? '' : String(obj[key]);
  t.addEventListener('input', () => { obj[key] = t.value; save(); });
  return t;
}
function _check(obj, key, label, after) {
  const lab = el('label', 'la-check');
  const c = el('input');
  c.type = 'checkbox';
  c.checked = !!obj[key];
  c.addEventListener('change', () => { obj[key] = c.checked; save(); if (after) after(); });
  lab.append(c, el('span', null, label));
  return lab;
}
function _knob(obj, key, label, min, max, step, hint) {
  const row = el('div', 'la-knob');
  row.title = hint || '';
  row.appendChild(el('span', null, label));
  const r = el('input');
  r.type = 'range'; r.min = String(min); r.max = String(max); r.step = String(step);
  const v = el('span', null, obj[key] === '' || obj[key] == null ? 'auto' : String(obj[key]));
  r.value = obj[key] === '' || obj[key] == null ? String((min + max) / 2) : String(obj[key]);
  r.addEventListener('input', () => { obj[key] = +r.value; v.textContent = String(obj[key]); save(); });
  v.addEventListener('dblclick', () => { obj[key] = ''; v.textContent = 'auto'; save(); });
  v.title = 'a double press: back to Suno\'s own';
  row.append(r, v);
  return row;
}

function paintMake() {
  const host = $('#la-make');
  host.textContent = '';
  const m = CAT && CAT.modes.find(x => x.id === S.mode);
  if (!m) return;
  const card = el('div', 'la-card');
  const h = el('div', 'la-card-h');
  h.appendChild(document.createTextNode((S.engine === 'eleven' ? 'ElevenLabs' : 'Suno') + ' · ' + m.label));
  if (_proj()) h.appendChild(el('span', 'la-muted', 'for ' + _proj().title));
  card.appendChild(h);
  const bot = el('div', 'la-bot');
  bot.appendChild(el('div', 'la-bot-ico', S.mode === 'sounds' || S.mode === 'sfx' ? '✦' : '♪'));
  bot.appendChild(el('div', 'la-bot-tx', MODE_HELP[S.mode] || ''));
  card.appendChild(bot);
  const f = S.f[S.mode];

  if (S.mode === 'simple') {
    const picked = _pickedLabels();
    const row = el('div', 'la-picked');
    if (picked.length) for (const p of picked) row.appendChild(el('span', 'la-chip on', p));
    else row.appendChild(el('span', null, 'No chips yet - pick the genre, the mood and the sound on the left.'));
    card.appendChild(_field('The feel', row));
    card.appendChild(_field('In your words', _text(f, 'words', { area: true, rows: 3, placeholder: 'e.g. soft and warm under a skincare review, nothing that pulls the ear away from the voice' }), { small: 'any language · optional', max: 1000 }));
    card.appendChild(_check(f, 'writer', 'the writer makes Suno\'s style of it (off - the chips go as they are)'));
  } else if (S.mode === 'custom') {
    card.appendChild(_field('Title', _text(f, 'title', { placeholder: 'the track\'s name' }), { max: 80 }));
    card.appendChild(_field('Style', _text(f, 'style', { area: true, rows: 3, placeholder: 'genre, mood, instruments, tempo, production - e.g. indie pop, bright clean guitars, 110 BPM, warm female vocal' }), { max: 1000 }));
    card.appendChild(_check(f, 'instrumental', 'instrumental - no voice, no lyrics', () => paintMake()));
    if (!f.instrumental) {
      const ly = _text(f, 'lyrics', { area: true, rows: 7, placeholder: '[Verse]\n...\n[Chorus]\n...' });
      const fl = _field('Lyrics', ly, { max: 5000, small: 'empty - Suno sings what it makes up' });
      const wr = el('button', 'la-link', 'write lyrics from an idea…');
      wr.type = 'button';
      wr.addEventListener('click', () => {
        if (!S.f.lyrics.idea) S.f.lyrics.idea = [f.title, f.style].filter(Boolean).join(' - ').slice(0, 200);
        setMode('lyrics');
      });
      fl.appendChild(wr);
      card.appendChild(fl);
      const vs = el('select', 'la-sel');
      for (const [v, t] of [['', 'any voice'], ['f', 'a woman\'s voice (likelier)'], ['m', 'a man\'s voice (likelier)']]) { const op = el('option', null, t); op.value = v; vs.appendChild(op); }
      vs.value = f.vocal || '';
      vs.addEventListener('change', () => { f.vocal = vs.value; save(); });
      card.appendChild(_field('Voice', vs));
    }
    card.appendChild(_field('Keep out', _text(f, 'negative', { placeholder: 'e.g. heavy metal, distortion, choir' }), { small: 'styles Suno should avoid', max: 500 }));
    const kn = el('details', 'la-knobs');
    kn.appendChild(el('summary', null, 'fine-tuning (Suno\'s own when untouched)'));
    kn.appendChild(_knob(f, 'styleWeight', 'hold the style', 0, 1, 0.05, 'how closely it keeps to the style'));
    kn.appendChild(_knob(f, 'weirdness', 'weirdness', 0, 1, 0.05, 'how far it may wander'));
    kn.appendChild(_knob(f, 'variety', 'variety', 0, 4, 1, '0 - your style as written (V6 rewrites it at 1 and up) · 4 max: how different the two tracks are'));
    card.appendChild(kn);
  } else if (S.mode === 'lyrics') {
    card.appendChild(_field('The idea', _text(f, 'idea', { area: true, rows: 2, placeholder: 'e.g. a hopeful song about the first coffee of the morning' }), { max: 200 }));
  } else if (S.mode === 'sounds') {
    card.appendChild(_field('The sound', _text(f, 'prompt', { area: true, rows: 3, placeholder: 'e.g. a soft camera shutter click with a short mechanical whir' }), { max: 500 }));
    const r2 = el('div', 'la-row2');
    const tempo = el('input', 'la-in');
    tempo.type = 'number'; tempo.min = '0'; tempo.max = '300'; tempo.placeholder = 'auto';
    tempo.value = f.tempo ? String(f.tempo) : '';
    tempo.addEventListener('change', () => { f.tempo = Math.max(0, Math.min(300, Math.round(+tempo.value || 0))); save(); });
    r2.appendChild(_field('Tempo', tempo, { small: 'BPM, for a loop' }));
    const key = el('select', 'la-sel');
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

  const goRow = el('div', 'la-go-row');
  const go = el('button', 'la-go', S.mode === 'lyrics' ? 'write the lyrics' : 'generate');
  go.type = 'button';
  go.addEventListener('click', () => generate(go));
  goRow.appendChild(go);
  goRow.appendChild(el('span', 'la-muted', _priceText()));
  card.appendChild(goRow);
  card.appendChild(el('div', 'la-err'));
  host.appendChild(card);
}

// Video to Music: the video, chosen from the library (renders and VIDEO) or brought in from this computer.
function _attachment(f) {
  const att = el('div', 'la-att');
  const paint = () => {
    att.textContent = '';
    if (f.video) {
      if (f.thumb) { const im = el('img'); im.src = f.thumb; att.appendChild(im); } else att.appendChild(el('div', 'la-att-ph'));
      const tx = el('div', 'la-att-tx');
      tx.appendChild(el('b', null, f.name || f.video.split('/').pop()));
      tx.appendChild(el('span', 'la-muted', f.video));
      att.appendChild(tx);
    } else {
      att.appendChild(el('div', 'la-att-ph'));
      att.appendChild(el('div', 'la-att-tx', 'Drop a video here, or choose one. Up to 10 minutes and 200 MB.'));
    }
    const pick = el('button', 'la-btn', f.video ? 'another…' : 'choose…');
    pick.type = 'button';
    pick.addEventListener('click', () => _pickVideo(pick, (v) => { Object.assign(f, v); save(); paint(); }));
    att.appendChild(pick);
    if (f.video) {
      const x = el('button', 'la-x', '✕');
      x.type = 'button';
      x.title = 'no video';
      x.addEventListener('click', () => { f.video = ''; f.name = ''; f.thumb = ''; save(); paint(); });
      att.appendChild(x);
    }
  };
  att.addEventListener('dragover', (e) => { if (Array.from(e.dataTransfer.types || []).includes('Files')) { e.preventDefault(); att.classList.add('is-drop'); } });
  att.addEventListener('dragleave', () => att.classList.remove('is-drop'));
  att.addEventListener('drop', async (e) => {
    att.classList.remove('is-drop');
    const file = Array.from(e.dataTransfer.files || [])[0];
    if (!file) return;
    e.preventDefault();
    const v = await _uploadVideo(file);
    if (v) { Object.assign(f, v); save(); paint(); }
  });
  paint();
  return att;
}
async function _uploadVideo(file) {
  say('Bringing the video in (VIDEO → Uploads)…');
  const fd = new FormData();
  fd.append('video', file);
  fd.append('name', file.name);
  // Under the project's name in Uploads, as the video chat files what it is given.
  if (S.project) fd.append('project', S.project);
  try {
    const d = await api('/api/mv3/video/upload', { method: 'POST', body: fd });
    say('"' + file.name + '" is in VIDEO → Uploads.');
    const it = d.item || {};
    return { video: it.videoPath, name: it.name || file.name, thumb: it.thumbPath || '' };
  } catch (e) { say(e.message, true); return null; }
}
let _pickEl = null, _pickLayer = null;
function _closePick() { if (_pickEl) _pickEl.remove(); _pickEl = null; if (_pickLayer) Layers.close(_pickLayer); _pickLayer = null; }
async function _pickVideo(anchor, done) {
  _closePick();
  const box = el('div', 'la-pick');
  const tabs = el('div', 'la-pick-tabs');
  const grid = el('div', 'la-pick-grid');
  box.append(tabs, grid);
  document.body.appendChild(box);
  const r = anchor.getBoundingClientRect();
  box.style.left = Math.max(8, Math.min(window.innerWidth - 528, r.left - 200)) + 'px';
  box.style.top = Math.max(8, Math.min(window.innerHeight * 0.3, r.bottom + 6)) + 'px';
  _pickEl = box;
  _pickLayer = Layers.open(box, { modal: true, onEsc: _closePick });
  const away = (e) => { if (_pickEl && !_pickEl.contains(e.target)) { document.removeEventListener('mousedown', away, true); _closePick(); } };
  setTimeout(() => document.addEventListener('mousedown', away, true), 0);
  const show = async (which) => {
    for (const b of tabs.querySelectorAll('button')) b.classList.toggle('is-primary', b.dataset.k === which);
    grid.textContent = '';
    grid.appendChild(el('div', 'la-empty', 'reading…'));
    let items = [];
    try {
      const d = await api(which === 'renders' ? '/api/library/shelf/renders' : '/api/library/shelf/media?group=video');
      items = (d.items || []).filter(i => i.media && /\.(mp4|mov|webm|m4v)$/i.test(i.media)).slice(0, 120);
    } catch (e) { grid.textContent = ''; grid.appendChild(el('div', 'la-err', e.message)); return; }
    grid.textContent = '';
    if (!items.length) grid.appendChild(el('div', 'la-empty', 'Nothing here.'));
    for (const it of items) {
      const b = el('button', 'la-pick-it');
      b.type = 'button';
      if (it.thumb) { const im = el('img'); im.src = it.thumb; im.loading = 'lazy'; b.appendChild(im); } else b.appendChild(el('div', 'la-att-ph'));
      b.appendChild(el('span', null, it.name || it.media.split('/').pop()));
      b.title = it.name + (it.dur || (it.meta && it.meta.dur) ? ' · ' + secs(it.dur || it.meta.dur) : '');
      b.addEventListener('click', () => { _closePick(); done({ video: it.media, name: it.name, thumb: it.thumb || '' }); });
      grid.appendChild(b);
    }
  };
  for (const [k, label] of [['renders', 'Renders'], ['video', 'VIDEO library']]) {
    const b = el('button', 'la-btn', label);
    b.type = 'button';
    b.dataset.k = k;
    b.addEventListener('click', () => show(k));
    tabs.appendChild(b);
  }
  const up = el('button', 'la-btn', 'from this computer…');
  up.type = 'button';
  up.addEventListener('click', () => {
    const inp = el('input');
    inp.type = 'file'; inp.accept = 'video/*';
    inp.addEventListener('change', async () => {
      const file = inp.files && inp.files[0];
      if (!file) return;
      _closePick();
      const v = await _uploadVideo(file);
      if (v) done(v);
    });
    inp.click();
  });
  tabs.appendChild(el('span', 'sp'));
  tabs.appendChild(up);
  show('renders');
}

// The request of the open mode.
function _body() {
  const f = S.f[S.mode];
  const b = { mode: S.mode, model: S.model };
  if (S.mode === 'simple') {
    const groups = _chipsGroups();
    b.chips = groups.length && groups[0].key ? { genre: f.picked.genre || [], mood: f.picked.mood || [], sound: f.picked.sound || [] } : (f.flat || []);
    b.words = f.words; b.seconds = f.seconds || 0; b.writer = f.writer !== false;
    b.projectKind = (_proj() && WRITER_KIND[_proj().kind]) || 'blank';
  } else if (S.mode === 'custom') {
    Object.assign(b, { title: f.title, style: f.style, lyrics: f.lyrics, instrumental: !!f.instrumental, vocal: f.vocal, negative: f.negative,
      styleWeight: f.styleWeight, weirdness: f.weirdness, variety: f.variety, seconds: f.seconds || 0 });
  } else if (S.mode === 'lyrics') b.idea = f.idea;
  else if (S.mode === 'sounds') Object.assign(b, { prompt: f.prompt, loop: !!f.loop, tempo: f.tempo || 0, key: f.key || 'Any' });
  else if (S.mode === 'compose') Object.assign(b, { prompt: f.prompt, seconds: f.seconds || 0, instrumental: f.instrumental !== false });
  else if (S.mode === 'video') Object.assign(b, { video: f.video, description: f.description, tags: f.tags, sfx: !!f.sfx, useAudio: !!f.useAudio });
  else if (S.mode === 'sfx') Object.assign(b, { prompt: f.prompt, seconds: f.seconds || 0, loop: !!f.loop, influence: f.influence });
  const m = CAT.modes.find(x => x.id === S.mode);
  b.where = {
    page: 'lab', href: '/lab/audio?mode=' + S.mode + (S.project ? '&p=' + encodeURIComponent(S.project) : ''),
    label: 'Audio lab · ' + (m ? m.label : S.mode),
  };
  if (S.project) b.project = S.project;
  return b;
}

let _going = false;
async function generate(btn) {
  if (_going) return;
  _going = true;
  btn.disabled = true;
  const err = btn.closest('.la-card').querySelector('.la-err');
  err.textContent = '';
  try {
    const d = await post('/api/audio/gen', _body());
    GENS = [d.gen].concat(GENS.filter(g => g.id !== d.gen.id));
    paintMade();
    say(d.gen.kind === 'lyrics' ? 'Writing the lyrics…' : 'Asked - it is in Alerts too; you can leave the page, the app files it when it comes.');
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
  const host = $('#la-made');
  host.textContent = '';
  $('#la-made-n').textContent = GENS.length ? '· ' + GENS.length : '';
  if (!GENS.length) { host.appendChild(el('div', 'la-empty', 'Nothing yet - what you make appears here, newest first.')); return; }
  for (const g of GENS) host.appendChild(_genCard(g));
}
function _genCard(g) {
  const card = el('div', 'la-gen' + (g.state === 'failed' ? ' is-failed' : ''));
  const h = el('div', 'la-gen-h');
  h.appendChild(el('span', 'la-state ' + (g.state === 'pending' ? 'run' : g.state === 'done' ? 'ok' : 'bad'),
    g.state === 'pending' ? 'making' : g.state === 'done' ? 'done' : (g.refused ? 'refused' : 'failed')));
  h.appendChild(el('b', null, g.said || MODE_NAME(g.mode)));
  h.appendChild(el('span', 'sp'));
  h.appendChild(el('span', null, (g.engine === 'eleven' ? 'ElevenLabs' : 'Suno') + ' · ' + MODE_NAME(g.mode) + (g.fake ? ' · FAKE' : '') + ' · ' + _ago(g.at)));
  if (g.state !== 'pending') {
    const x = el('button', 'la-x', '✕');
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
    const w = el('div', 'la-said');
    w.appendChild(el('b', null, (g.written.by === 'as picked' ? 'Sent as picked' : 'The writer wrote') + ': '));
    w.appendChild(document.createTextNode(g.written.title + ' — ' + g.written.style));
    if (g.fell) w.appendChild(el('div', 'la-muted', g.fell));
    card.appendChild(w);
  }
  if (g.state === 'pending') {
    const bar = el('div', 'la-bar');
    bar.appendChild(el('i'));
    card.appendChild(bar);
    const row = el('div', 'la-gen-h');
    row.appendChild(el('span', null, (g.stage || (g.taskId ? (g.engine === 'eleven' ? 'ElevenLabs is making it' : 'Suno is making it') : 'starting')) + ' · ' + _ago(g.at).replace(' ago', '')));
    row.appendChild(el('span', 'sp'));
    if (g.alertId) {
      const st = el('button', 'la-link', 'stop waiting');
      st.type = 'button';
      st.title = 'It stops being waited for and is not filed - the money is not given back';
      st.addEventListener('click', async () => {
        try { await post('/api/alerts/' + encodeURIComponent(g.alertId) + '/cancel', {}); _poll(); } catch (e) { say(e.message, true); }
      });
      row.appendChild(st);
    }
    card.appendChild(row);
  } else if (g.state === 'failed') {
    card.appendChild(el('div', 'la-err', g.error || 'it did not come'));
    if (g.alertId && !g.refused) {
      const again = el('button', 'la-link', 'try again (pays again)');
      again.type = 'button';
      again.addEventListener('click', async () => {
        if (!window.confirm('Ask for it again? It costs ' + (g.engine === 'eleven' ? 'ElevenLabs credits' : 'kie credits') + ' again.')) return;
        try { await post('/api/alerts/' + encodeURIComponent(g.alertId) + '/retry', {}); say('Asked again.'); _follow(); } catch (e) { say(e.message, true); }
      });
      card.appendChild(again);
    }
  } else if (g.kind === 'lyrics') {
    for (const l of (g.lyrics || [])) card.appendChild(_lyric(l));
  } else {
    for (const r of (g.results || [])) card.appendChild(_result(r));
  }
  return card;
}
function _result(r) {
  const it = LIBIDX.get(r.path);
  const row = el('div', 'la-res' + (playing() === r.path ? ' is-playing' : ''));
  row.dataset.path = r.path;
  const pb = el('button', 'la-play', '▶');
  pb.type = 'button';
  row.appendChild(pb);
  row.appendChild(el('span', 'la-res-n', (it && it.name) || r.title));
  row.appendChild(waveEl(it ? it.wave : []));
  row.appendChild(el('span', 'la-muted', secs(r.dur)));
  if (it) {
    const star = el('button', 'la-star' + (it.fav ? ' on' : ''), it.fav ? '★' : '☆');
    star.type = 'button';
    star.title = it.fav ? 'Take it out of Favorites' : 'Into Favorites';
    star.addEventListener('click', async (e) => {
      e.stopPropagation();
      try { await post('/api/audio/lib/fav', { kind: it.kind, id: it.id, path: it.path, on: !it.fav }); await _index(); paintMade(); Tree.refresh(); }
      catch (er) { say(er.message, true); }
    });
    row.appendChild(star);
    const show = el('button', 'la-link', 'show');
    show.type = 'button';
    show.title = 'Where it lies, in the tree';
    show.addEventListener('click', (e) => { e.stopPropagation(); Tree.select(Tree.nodeOf(it.kind, it.categoryId)); });
    row.appendChild(show);
  } else {
    row.appendChild(el('span', 'la-muted', 'deleted'));
  }
  row.addEventListener('click', () => playToggle(r.path, row));
  // Onto an audio lane of the timeline below, as a tile of the gallery is.
  row.draggable = true;
  row.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData(Tree.TILE_DRAG, JSON.stringify({ kind: r.kind, id: r.id, name: (it && it.name) || r.title, path: r.path, dur: r.dur }));
    e.dataTransfer.effectAllowed = 'copy';
  });
  return row;
}
function _lyric(l) {
  const box = el('div', 'la-lyr');
  const h = el('div', 'la-lyr-h');
  h.appendChild(el('span', null, l.title || 'Lyrics'));
  h.appendChild(el('span', 'sp'));
  const use = el('button', 'la-link', 'use in custom');
  use.type = 'button';
  use.addEventListener('click', () => {
    S.f.custom.lyrics = l.text;
    if (!S.f.custom.title) S.f.custom.title = String(l.title || '').slice(0, 80);
    S.f.custom.instrumental = false;
    setMode('custom');
    say('The lyrics are in Custom.');
  });
  const copy = el('button', 'la-link', 'copy');
  copy.type = 'button';
  copy.addEventListener('click', () => { navigator.clipboard.writeText(l.text).then(() => say('Copied.')).catch(() => say('Not copied.', true)); });
  const more = el('button', 'la-link', 'all');
  more.type = 'button';
  more.addEventListener('click', () => box.classList.toggle('open'));
  h.append(use, copy, more);
  box.appendChild(h);
  box.appendChild(el('pre', null, l.text));
  return box;
}

// The library's tiles by path: a result row's waveform and star.
async function _index() {
  const map = new Map();
  for (const node of ['music', 'mine']) {
    try { for (const it of (await api('/api/audio/lib/items?node=' + node)).items || []) map.set(it.path, it); } catch (e) { /* none */ }
  }
  LIBIDX = map;
}

// Followed while anything is being made: every 3 s, the list again; what ended is filed, the tree read again.
let _timer = 0;
async function _poll() {
  let d;
  try { d = await api('/api/audio/gens?limit=40'); } catch (e) { return; }
  const before = new Map(GENS.map(g => [g.id, g.state]));
  GENS = d.items || [];
  const ended = GENS.some(g => before.get(g.id) === 'pending' && g.state !== 'pending');
  if (ended) {
    await _index();
    Tree.refresh();
    const done = GENS.find(g => before.get(g.id) === 'pending' && g.state === 'done');
    if (done) say((done.kind === 'lyrics' ? 'The lyrics are here.' : 'Done - ' + (done.kind === 'sound' ? 'in SFX → My sounds → Generated.' : 'in AUDIO → Music.')));
  }
  paintMade();
  if (!GENS.some(g => g.state === 'pending')) { clearInterval(_timer); _timer = 0; }
}
function _follow() {
  if (_timer) return;
  _timer = setInterval(_poll, 3000);
}

// ── the almanac (V34.A: public/js/audio/almanac-data.js) ────────────────────
// Its SECTIONS in two groups (Music, Sounds) on the left, the open one's categories under it, its NOTES on the right; a
// press puts a note's `text` into the field it is for (`to` - the first one the open mode has; else the mode of the
// first is opened) and applies its `set` and `seconds` to the mode's controls. An advice note (`to` empty) is read.
const FIELD_AT = {
  words: ['simple', 'words'], style: ['custom', 'style'], negative: ['custom', 'negative'], lyrics: ['custom', 'lyrics'],
  idea: ['lyrics', 'idea'], sound: ['sounds', 'prompt'], sfx: ['sfx', 'prompt'], music: ['compose', 'prompt'],
};
const SET_AT = {
  style_weight: ['custom', 'styleWeight'], weirdness_constraint: ['custom', 'weirdness'], variety: ['custom', 'variety'],
  vocal_gender: ['custom', 'vocal'], sound_loop: ['sounds', 'loop'], sound_tempo: ['sounds', 'tempo'], sound_key: ['sounds', 'key'],
  prompt_influence: ['sfx', 'influence'], loop: ['sfx', 'loop'],
};
function _almSections() {
  return (ALM && Array.isArray(ALM.SECTIONS)) ? ALM.SECTIONS.filter(s => s && s.label && Array.isArray(s.notes)) : [];
}
const _fieldLabel = (f) => (ALM && ALM.FIELDS && ALM.FIELDS[f] && ALM.FIELDS[f].label) || f;
function _applyNote(n) {
  const to = Array.isArray(n.to) ? n.to.filter(f => FIELD_AT[f]) : [];
  if (!to.length) {
    // Advice is read - a press copies it, as the video chat's almanac does.
    try { navigator.clipboard.writeText(String(n.text || '')); } catch (e) { /* not allowed */ }
    return { said: 'Advice - copied.' };
  }
  const here = to.find(f => FIELD_AT[f][0] === S.mode) || to[0];
  const [mode, key] = FIELD_AT[here];
  const switched = mode !== S.mode;
  const f = S.f[mode];
  const spec = (ALM.FIELDS && ALM.FIELDS[here]) || {};
  const cur = String(f[key] || '').replace(/\s+$/, '');
  const next = cur ? cur + (spec.join || ', ') + n.text : String(n.text || '');
  // Over the field's limit it is not put in - said (V34.A: "за max не вставлять, а сказать").
  if (spec.max && next.length > spec.max) return { bad: true, said: _fieldLabel(here) + ' is full: ' + cur.length + ' of ' + spec.max + ' characters - make room first.' };
  f[key] = next;
  if (mode === 'custom' && here === 'lyrics') f.instrumental = false;
  for (const [k, v] of Object.entries(n.set || {})) {
    const at = SET_AT[k];
    if (at && at[0] === mode) S.f[mode][at[1]] = v;
  }
  if (+n.seconds > 0 && (mode === 'sfx' || mode === 'compose')) f.seconds = +n.seconds;
  save();
  if (switched) setMode(mode); else { paintCol(); paintMake(); }
  return { said: '"' + n.title + '" is in ' + _fieldLabel(here) + (switched ? ' - the mode ' + MODE_NAME(mode) + ' is open' : '') + '.' };
}
let _almWin = null;
function openAlmanac(anchor) {
  if (_almWin) { _almWin.close(); return; }
  const secs0 = _almSections();
  const win = el('div', 'hp la-alm');
  const head = el('div', 'hp-head');
  head.appendChild(el('b', null, 'Almanac'));
  head.appendChild(el('span', 'hp-sub', 'music and sounds · a press puts a note into its field' + (ALM.UPDATED ? ' · ' + ALM.UPDATED : '')));
  const x = el('button', 'hp-x', '✕');
  x.type = 'button';
  head.appendChild(x);
  win.appendChild(head);
  const body = el('div', 'hp-body');
  const side = el('div', 'hp-side');
  const main = el('div', 'la-alm-main');
  body.append(side, main);
  win.appendChild(body);
  // Over the gallery, at the right: the constructor stays in sight, so the note is seen landing in its field.
  const r = anchor.getBoundingClientRect();
  const w = Math.max(520, Math.min(820, window.innerWidth - r.right - 30));
  win.style.left = Math.round(Math.max(r.right + 10, window.innerWidth - w - 16)) + 'px';
  win.style.top = '84px';
  win.style.width = w + 'px';
  win.style.height = 'calc(100vh - 120px)';
  document.body.appendChild(win);
  const layer = Layers.open(win, { modal: false, onEsc: () => close() });
  const close = () => { win.remove(); Layers.close(layer); _almWin = null; };
  _almWin = { close };
  x.addEventListener('click', close);
  const soundy = S.mode === 'sounds' || S.mode === 'sfx';
  let open = secs0.find(s => (s.group === 'sound') === soundy) || secs0[0];
  let cat = '';
  const paintSide = () => {
    side.textContent = '';
    for (const [g, label] of [['music', 'Music'], ['sound', 'Sounds']]) {
      const list = secs0.filter(s => s.group === g);
      if (!list.length) continue;
      side.appendChild(el('div', 'la-lbl la-alm-g', label));
      for (const s of list) {
        const b = el('button', 'hp-sec' + (s === open ? ' on' : ''));
        b.type = 'button';
        b.appendChild(el('span', 'nm', s.label));
        b.appendChild(el('small', null, String(s.notes.length)));
        b.title = s.about || '';
        b.addEventListener('click', () => { open = s; cat = ''; paintSide(); paintNotes(); });
        side.appendChild(b);
        if (s === open && (s.cats || []).length > 1) {
          for (const c of s.cats) {
            const cb = el('button', 'hp-cat' + (cat === c.id ? ' on' : ''));
            cb.type = 'button';
            cb.appendChild(el('span', 'nm', c.label));
            cb.appendChild(el('small', null, String(s.notes.filter(n => n.cat === c.id).length)));
            cb.addEventListener('click', () => { cat = cat === c.id ? '' : c.id; paintSide(); paintNotes(); });
            side.appendChild(cb);
          }
        }
      }
    }
  };
  const paintNotes = () => {
    main.textContent = '';
    if (!open) return;
    if (open.about) main.appendChild(el('div', 'la-said', open.about));
    for (const n of open.notes.filter(x => !cat || x.cat === cat)) {
      const b = el('button', 'la-alm-note' + ((n.to || []).length ? '' : ' is-advice'));
      b.type = 'button';
      const h = el('div', 'la-lyr-h');
      h.appendChild(el('span', null, n.title));
      h.appendChild(el('span', 'sp'));
      const to = (n.to || []).map(_fieldLabel);
      h.appendChild(el('span', 'la-muted', to.length ? '→ ' + to.join(', ') : 'advice'));
      b.appendChild(h);
      b.appendChild(el('div', 'la-alm-text', n.text));
      if (n.why) b.appendChild(el('div', 'la-said', n.why));
      const extra = [];
      if (n.set) extra.push(Object.entries(n.set).map(([k, v]) => k + ' ' + v).join(', '));
      if (n.seconds) extra.push(n.seconds + ' s');
      if (extra.length) b.appendChild(el('div', 'la-muted la-alm-set', 'sets ' + extra.join(' · ')));
      const srcs = (n.src || []).map(id => ALM.SOURCES && ALM.SOURCES[id]).filter(Boolean);
      if (srcs.length) {
        const sr = el('div', 'la-alm-src');
        for (const s of srcs.slice(0, 4)) {
          const a = el('a', null, s.name);
          a.href = s.url; a.target = '_blank'; a.rel = 'noopener';
          a.addEventListener('click', (e) => e.stopPropagation());
          sr.appendChild(a);
        }
        b.appendChild(sr);
      }
      b.addEventListener('click', () => {
        const r = _applyNote(n);
        if (!r.bad) { b.classList.add('is-put'); setTimeout(() => b.classList.remove('is-put'), 700); }
        say(r.said, !!r.bad);
      });
      main.appendChild(b);
    }
  };
  paintSide();
  paintNotes();
}

// ── the panel's two views (the owner 2026-10-23: "крошка library доступная но только с музыкой") ─────────────────
// As Merge's lib-views.js: "Library" is the shelf (the panel without `is-chat`: Merge's grid and tree, only AUDIO awake);
// "/ generate audio" the constructor. The one showing is lit, the other one press away; remembered.
const KEY_VIEW = 'ugc_lab_audio_view';
function setView(v) {
  const chat = v !== 'shelf';
  $('#mv3-library').classList.toggle('is-chat', chat);
  const title = $('#la-lib-title');
  title.classList.toggle('is-link', chat);
  title.title = chat ? 'Back to the Library - AUDIO: music and sounds' : '';
  const crumb = $('#la-crumb-audio');
  crumb.classList.toggle('is-on', chat);
  crumb.title = chat ? '' : 'Generate music and sounds';
  lsSet(KEY_VIEW, chat ? 'chat' : 'shelf');
}
function _wireViews() {
  $('#la-lib-title').addEventListener('click', () => setView('shelf'));
  $('#la-crumb-audio').addEventListener('click', () => setView('chat'));
  setView(ls(KEY_VIEW, 'chat'));
}

// ── start ───────────────────────────────────────────────────────────────────
async function start() {
  try { CAT = await api('/api/audio/catalog'); } catch (e) { say('The lab could not start: ' + e.message, true); return; }
  if (CAT.fake) $('#la-fake').hidden = false;
  if (CAT.almanac) { try { ALM = await import('/js/audio/almanac-data.js'); } catch (e) { ALM = null; } }
  try { PROJECTS = (await api('/api/audio/projects')).items || []; } catch (e) { PROJECTS = []; }
  // An Alerts row leads back here with its mode and project.
  const q = new URLSearchParams(location.search);
  if (q.get('p') && PROJECTS.some(p => p.key === q.get('p'))) S.project = q.get('p');
  if (!PROJECTS.some(p => p.key === S.project)) S.project = '';
  const want = q.get('mode');
  const m = CAT.modes.find(x => x.id === (want || S.mode)) || CAT.modes[0];
  S.mode = m.id; S.engine = m.engine;
  if (!CAT.sunoModels.includes(S.model)) S.model = 'V6';
  // The two views of the Library panel, by its crumbs: "Library" - the shelf, "generate audio" - the constructor.
  _wireViews();
  // The project picker in the bar, as in Merge; the timeline below shows its lanes.
  paintProjects();
  $('#mv3-project').addEventListener('change', (e) => setProject(e.target.value, true));
  paintCol();
  paintMake();
  Lanes.mount($('#mv3-tl'), { say });
  Lanes.show(S.project);
  await Tree.mount($('#la-tree'), $('#la-gal'), {
    say,
    // Not into Generated (locked): it is what the engines make.
    cut: (it) => openCut(it, { cats: Tree.myCats().filter(c => !c.locked), cat: '', done: (item) => { say('"' + item.name + '" is a new sound in My sounds.'); Tree.refresh(); Tree.select(Tree.nodeOf('sounds', item.categoryId)); } }),
    online: (cat) => openOnline({ cats: Tree.myCats().filter(c => !c.locked), cat, added: () => Tree.refresh() }),
  });
  await _index();
  await _poll();
  if (GENS.some(g => g.state === 'pending')) _follow();
  onChange((p) => {
    for (const r of document.querySelectorAll('.la-res')) r.classList.toggle('is-playing', !!p && r.dataset.path === p);
  });
}
start();
