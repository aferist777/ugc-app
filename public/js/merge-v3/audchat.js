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
   ═══════════════════════════════════════════════════════════════════════════ */

import * as Layers from '../layers.js';
import * as Store from './store.js';
import * as Views from './lib-views.js';
import { DRAG_TYPE, DRAG_MEDIA } from './store.js';
import { setOpenColumn } from './layout.js';
import { isTalking } from './workshop.js';
import { setMediaDrag, createTree } from '../media-tree.js';
import { waveEl, secs } from '../sound/wave.js';
import { refuseHome } from './chat-shell.js';

const NAME = 'audio';
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const KEY = 'mv3_audio_v1';
const ls = (k, fb) => { try { const v = localStorage.getItem(k); return v == null ? fb : JSON.parse(v); } catch (e) { return fb; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* a private window */ } };
async function api(url, opts) {
  const r = await fetch(url, opts);
  const d = await r.json().catch(() => null);
  if (!d || d.success === false) throw new Error((d && d.error) || ('status ' + r.status));
  return d;
}
const post = (url, body) => api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });

// ── what the person set ─────────────────────────────────────────────────────
const MODE_HELP = {
  simple: 'Background music with no voice, for a video where somebody talks. Pick the feel with the chips on the left and, if you like, say more in your own words (any language). The writer turns it into Suno\'s style and Suno makes TWO tracks of the length on the left. They go to AUDIO → Music.',
  custom: 'You write it: a title, a style and - unless it is instrumental - the lyrics ([Verse], [Chorus]…). The chips on the left add their words to the style. Suno makes TWO tracks; the length on the left (10–360 s) or Suno\'s own.',
  lyrics: 'Song lyrics from an idea - two or three texts. A text can go straight into Custom with "use in custom". Text only: no row in Alerts.',
  sounds: 'A sound or a loop by Suno, from a description. It goes to SFX → My sounds → Generated.',
  compose: 'Music by ElevenLabs from a description - instrumental unless you untick it. The chips add their words. It goes to AUDIO → Music.',
  video: 'Music made FOR a video: ElevenLabs watches it (cuts, pace, mood) and scores it. Press a video in the tree on the right - or a clip on the timeline with the right button, and the track is laid under that clip too. Say what you want if you like. It goes to AUDIO → Music.',
  sfx: 'A sound effect by ElevenLabs, from a description - up to 30 s, or the length it picks. It goes to SFX → My sounds → Generated.',
};
const MODEL_HELP = { V6: 'the newest - most natural', V6_MINI: 'faster', V6_WILD: 'bolder, stranger' };
const KIND_MODE = { 'talking head': 'simple', blank: 'custom', draft: 'custom', highlights: 'simple' };
const WRITER_KIND = { 'talking head': 'talking-head', blank: 'blank', draft: 'draft', highlights: 'highlights' };

const S = Object.assign({ engine: 'suno', mode: 'custom', model: 'V6', lastMode: { suno: 'simple', eleven: 'compose' }, f: {}, of: {} }, ls(KEY, {}));
S.f = Object.assign({
  simple: { words: '', seconds: 30, writer: true, picked: { genre: [], mood: [], sound: [] }, flat: [], preset: '', pSeconds: 120, presetN: {} },
  custom: { title: '', style: '', lyrics: '', instrumental: false, vocal: '', negative: '', styleWeight: '', weirdness: '', variety: 0, seconds: 0 },
  lyrics: { idea: '' },
  sounds: { prompt: '', loop: false, tempo: 0, key: 'Any' },
  compose: { prompt: '', seconds: 30, instrumental: true },
  // `clip` (phase V54) - a clip of a timeline { key, trackId, clipId, name, start, dur, thumb } in place of a file; `dur` - the
  // file's length when it is known (the price).
  video: { video: '', name: '', thumb: '', dur: 0, clip: null, description: '', tags: '', sfx: false, useAudio: false },
  sfx: { prompt: '', seconds: 0, loop: false, influence: 0.3 },
}, S.f || {});
if (!S.of || typeof S.of !== 'object') S.of = {};
// Each project's mode, as it was left - the last 60.
const save = () => {
  const of = {};
  for (const k of Object.keys(S.of).slice(-60)) of[k] = S.of[k];
  S.of = of;
  lsSet(KEY, { engine: S.engine, mode: S.mode, model: S.model, lastMode: S.lastMode, f: S.f, of: S.of });
};

let CAT = null;            // GET /api/audio/catalog
let ALM = null;            // the almanac module, when it is there
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

// (phase V34.F, the owner's (ф3)) The highlights moods - V34.A's ten presets: the server's list (the catalog), the
// almanac's own words for them when it is there.
function _moods() {
  const fromCat = (CAT && Array.isArray(CAT.moods)) ? CAT.moods : [];
  const P = (ALM && Array.isArray(ALM.HIGHLIGHT_PRESETS)) ? ALM.HIGHLIGHT_PRESETS : [];
  return fromCat.map(m => Object.assign({}, P.find(x => x.id === m.id) || {}, m));
}
const _preset = () => (S.mode === 'simple' && S.f.simple.preset ? _moods().find(m => m.id === S.f.simple.preset) || null : null);

const _chipsGroups = () => {
  // The almanac's (V34.A: { genre, mood, sound } of { id, label, style }) - else the catalog's three lists of words.
  if (ALM && ALM.CHIPS && Array.isArray(ALM.CHIPS.genre)) {
    return [['genre', 'Genre'], ['mood', 'Mood'], ['sound', 'Sound']]
      .map(([k, label]) => ({ key: k, label, chips: (ALM.CHIPS[k] || []).map(c => ({ id: c.id, label: c.label, style: c.style || c.label })) }))
      .filter(g => g.chips.length);
  }
  return ((CAT && CAT.chips) || []).map(g => ({ key: '', label: g.label, chips: g.chips.map(c => ({ id: c, label: c, style: c })) }));
};

// ── the settings column: the chats' column (.mv3-ig-set, css/mv3-imagen.css) ───────────────────────────────
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
    row('Model', el('div', 'au-note', S.mode === 'sfx' ? 'eleven_text_to_sound_v2' : S.mode === 'compose' ? 'music_v2_5 (Eleven Music)' : 'Eleven Music'));
  }

  // (phase V34.F, the owner's (ф3)) A HIGHLIGHTS MOOD in place of the chips: one of the ten presets, written by its own rule,
  // and the two tracks are filed into Music -> highlights -> that mood - what the highlights popup offers.
  if (S.mode === 'simple' && _moods().length) {
    const f = S.f.simple;
    const sel = el('select');
    const none = el('option', null, '— none: the chips and your words —');
    none.value = '';
    sel.appendChild(none);
    for (const m of _moods()) {
      const op = el('option', null, m.label);
      op.value = m.id;
      op.title = m.about || '';
      sel.appendChild(op);
    }
    sel.value = _preset() ? f.preset : '';
    sel.addEventListener('change', () => { f.preset = sel.value; save(); paintCol(); paintMake(); });
    const p = _preset();
    row('Highlights mood', sel, p ? 'into Music → highlights → ' + p.label : 'for the highlights popup: a mood\'s preset, filed into its folder');
  }

  // The length: what a mode takes, empty - the model decides.
  const LEN = { simple: [0, 360, 'the video\'s length - the bed comes out a little longer'], custom: [10, 360, '10–360 s'],
    compose: [3, 600, '3 s – 10 min'], sfx: [0.5, 30, '0.5–30 s'] };
  if (LEN[S.mode]) {
    let [lo, hi, note] = LEN[S.mode];
    const f = S.f[S.mode];
    // A mood's track is longer than a fragment: the highlight takes a window from its middle (V33.8) - its own length.
    const mood = !!_preset();
    const key = mood ? 'pSeconds' : 'seconds';
    if (mood) { lo = 30; note = 'a highlight plays a window from its middle - 90-180 s leaves room'; if (f.pSeconds == null) f.pSeconds = 120; }
    sep('Length');
    const r = el('div', 'au-len');
    const n = el('input', 'au-in');
    n.type = 'number'; n.min = '0'; n.max = String(hi); n.step = S.mode === 'sfx' ? '0.5' : '1';
    n.value = f[key] ? String(f[key]) : '';
    n.placeholder = 'auto';
    n.addEventListener('change', () => {
      const v = +n.value || 0;
      f[key] = v <= 0 ? 0 : Math.max(lo || 1, Math.min(hi, v));
      n.value = f[key] ? String(f[key]) : '';
      save(); paintPrice(); paintMakePrice();
    });
    r.append(n, el('span', 'au-len-auto', 's · empty - the model decides'));
    const vs = _videoSecs();
    if (vs > 0 && S.mode !== 'sfx' && !mood) {
      const by = el('button', 'au-link', 'by the video (' + secs(vs) + ')');
      by.type = 'button';
      by.addEventListener('click', () => { f.seconds = Math.max(lo || 1, Math.min(hi, Math.round(vs))); save(); paintCol(); paintMakePrice(); });
      r.appendChild(by);
    }
    row('', r, note);
  }

  // The chips: in Simple they ARE the request; in Custom and ElevenLabs' music a chip adds its words to the text.
  // (phase V54, block 7, the owner 2026-10-27: "чтобы они были свернутыми дропдаунами и открыт может быть только один из
  // них") Each group is a FOLDED ROW - its name and, in Simple, what is picked in it ("Genre · Lo-fi, Jazz"); a press opens
  // it and folds the one open before (_chipOpen).
  if (['simple', 'custom', 'compose'].includes(S.mode) && !_preset()) {
    for (const g of _chipsGroups()) {
      const gk = g.key || g.label;
      const open = _chipOpen === gk;
      const picked = S.mode === 'simple' ? g.chips.filter(c => _isPicked(g.key, c)).map(c => c.label) : [];
      const head = el('button', 'au-chips-h' + (open ? ' is-open' : '') + (picked.length ? ' has-picked' : ''));
      head.type = 'button';
      head.setAttribute('aria-expanded', open ? 'true' : 'false');
      head.appendChild(el('span', 'au-chips-tw', '▸'));
      head.appendChild(el('b', null, g.label));
      const said = el('span', 'au-chips-sel', picked.length ? '· ' + picked.join(', ') : '');
      head.appendChild(said);
      head.appendChild(el('span', 'au-chips-n', String(g.chips.length)));
      head.title = (open ? 'Fold ' : 'Open ') + g.label + (picked.length ? ' - picked: ' + picked.join(', ') : '');
      head.addEventListener('click', () => { _chipOpen = open ? '' : gk; paintCol(); });
      col.appendChild(head);
      if (!open) continue;
      const wrap = el('div', 'mv3-chips au-chips-open');
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
    col.appendChild(el('div', 'au-note', S.mode === 'simple' ? 'What the music is: the writer reads them with your words.'
      : 'A press adds the chip\'s words to the ' + (S.mode === 'custom' ? 'style' : 'description') + '.'));
  }

  const cost = el('div', 'mv3-ig-cost');
  _ui.price = cost;
  col.appendChild(cost);
  paintPrice();

  // The almanac at the foot of the column, as in the video chat: V34.A's notes, a press copies one (V34.F).
  const foot = _ui.alm;
  foot.textContent = '';
  const alm = el('button', 'mv3-vc-almanac' + (_almSections().length ? '' : ' is-soon'), 'almanac');
  alm.type = 'button';
  alm.title = _almSections().length ? 'Notes on styles and sounds - a press on a note copies it' : 'The almanac of music and sounds is being written - soon';
  alm.addEventListener('click', () => { if (_almSections().length) openAlmanac(alm); else say('The almanac is being written (V34.A) - soon.'); });
  foot.appendChild(alm);
}

let _chipOpen = '';            // (phase V54) the one chip group open in the settings column - '' all folded

function _isPicked(group, c) {
  const f = S.f.simple;
  return group ? ((f.picked || {})[group] || []).includes(c.id) : (f.flat || []).includes(c.label);
}
function _pick(group, c) {
  const f = S.f.simple;
  if (group) {
    f.picked = f.picked || {};
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
    if (S.mode === 'video') {
      // (phase V54) By the seconds of the clip or the file in "The video", when they are known.
      const sec = _v2m().dur;
      return sec ? { big: '≈ $' + (p.usdPerMin * sec / 60).toFixed(3), small: secs(sec) + ' of music, as long as the video · ElevenLabs' }
        : { big: '≈ $' + p.usdPerMin + '/min', small: 'of music, as long as the video' };
    }
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
  const box = _ui && _ui.price;
  if (!box) return;
  const p = _price();
  box.textContent = '';
  box.appendChild(el('b', null, p.big));
  box.appendChild(el('span', null, 'per press · ' + p.small + (CAT && CAT.fake ? ' · FAKE - nothing is paid' : '')));
}
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
function _field(label, input, opts) {
  const o = opts || {};
  const f = el('div', 'au-f');
  const h = el('div', 'au-f-h');
  h.appendChild(document.createTextNode(label));
  if (o.small) h.appendChild(el('small', null, o.small));
  if (o.max) {
    const cnt = el('span', 'au-cnt');
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
  const t = el(o.area ? 'textarea' : 'input', o.area ? 'au-ta' : 'au-in');
  if (!o.area) t.type = 'text';
  if (o.rows) t.rows = o.rows;
  t.placeholder = o.placeholder || '';
  t.value = obj[key] == null ? '' : String(obj[key]);
  t.addEventListener('input', () => { obj[key] = t.value; save(); });
  return t;
}
function _check(obj, key, label, after) {
  const lab = el('label', 'au-check');
  const c = el('input');
  c.type = 'checkbox';
  c.checked = !!obj[key];
  c.addEventListener('change', () => { obj[key] = c.checked; save(); if (after) after(); });
  lab.append(c, el('span', null, label));
  return lab;
}
function _knob(obj, key, label, min, max, step, hint) {
  const row = el('div', 'au-knob');
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
  bot.appendChild(el('div', 'au-bot-tx', _preset()
    ? 'Background music for highlights in one mood: its preset goes to Suno as it is, and Suno makes TWO tracks. They go to Music → highlights → ' + _preset().label + ', and the highlights popup offers them. Each press turns one colour of the mood, so the next tracks differ.'
    : (MODE_HELP[S.mode] || '')));
  card.appendChild(bot);
  const f = S.f[S.mode];

  const mood = _preset();
  if (mood) {
    // The preset says it all: what it is for, the style Suno is given (the rules add the bed's excludes and knobs).
    const n = (f.presetN || {})[mood.id] || 0;
    const box = el('div', 'au-preset');
    box.appendChild(el('b', null, mood.label + (mood.title ? ' · ' + mood.title : '')));
    if (mood.about) box.appendChild(el('div', 'au-muted', mood.about));
    if (mood.style) box.appendChild(el('div', 'au-preset-style', mood.style));
    box.appendChild(el('div', 'au-muted', 'press ' + (n + 1) + ' of this mood' + (Array.isArray(mood.vary) && mood.vary.length
      ? ' - with a touch of ' + mood.vary[n % mood.vary.length] : '') + ' · two tracks into Music → highlights → ' + mood.label));
    card.appendChild(_field('The mood', box));
  } else if (S.mode === 'simple') {
    const picked = _pickedLabels();
    const row = el('div', 'au-picked');
    if (picked.length) for (const p of picked) row.appendChild(el('span', 'au-chip on', p));
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
      const wr = el('button', 'au-link', 'write lyrics from an idea…');
      wr.type = 'button';
      wr.addEventListener('click', () => {
        if (!S.f.lyrics.idea) S.f.lyrics.idea = [f.title, f.style].filter(Boolean).join(' - ').slice(0, 200);
        setMode('lyrics');
      });
      fl.appendChild(wr);
      card.appendChild(fl);
      const vs = el('select', 'au-sel');
      for (const [v, t] of [['', 'any voice'], ['f', 'a woman\'s voice (likelier)'], ['m', 'a man\'s voice (likelier)']]) { const op = el('option', null, t); op.value = v; vs.appendChild(op); }
      vs.value = f.vocal || '';
      vs.addEventListener('change', () => { f.vocal = vs.value; save(); });
      card.appendChild(_field('Voice', vs));
    }
    card.appendChild(_field('Keep out', _text(f, 'negative', { placeholder: 'e.g. heavy metal, distortion, choir' }), { small: 'styles Suno should avoid', max: 500 }));
    const kn = el('details', 'au-knobs');
    kn.appendChild(el('summary', null, 'fine-tuning (Suno\'s own when untouched)'));
    kn.appendChild(_knob(f, 'styleWeight', 'hold the style', 0, 1, 0.05, 'how closely it keeps to the style'));
    kn.appendChild(_knob(f, 'weirdness', 'weirdness', 0, 1, 0.05, 'how far it may wander'));
    kn.appendChild(_knob(f, 'variety', 'variety', 0, 4, 1, '0 - your style as written (V6 rewrites it at 1 and up) · 4 max: how different the two tracks are'));
    card.appendChild(kn);
  } else if (S.mode === 'lyrics') {
    card.appendChild(_field('The idea', _text(f, 'idea', { area: true, rows: 2, placeholder: 'e.g. a hopeful song about the first coffee of the morning' }), { max: 200 }));
  } else if (S.mode === 'sounds') {
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
  // Under the project's name in Uploads, as the video chat files what it is given.
  if (_key) fd.append('project', _key);
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
  const b = { mode: S.mode, model: S.model };
  if (S.mode === 'simple' && _preset()) {
    // (V34.F) A highlights mood: its preset and which press of it this is; the chips and the words stay out.
    b.preset = f.preset;
    b.n = (f.presetN || {})[f.preset] || 0;
    b.seconds = f.pSeconds == null ? 120 : (f.pSeconds || 0);
    b.chips = {}; b.words = ''; b.projectKind = 'highlights';
  } else if (S.mode === 'simple') {
    const groups = _chipsGroups();
    b.chips = groups.length && groups[0].key ? { genre: (f.picked || {}).genre || [], mood: (f.picked || {}).mood || [], sound: (f.picked || {}).sound || [] } : (f.flat || []);
    b.words = f.words; b.seconds = f.seconds || 0; b.writer = f.writer !== false;
    b.projectKind = WRITER_KIND[_kind()] || 'blank';
  } else if (S.mode === 'custom') {
    Object.assign(b, { title: f.title, style: f.style, lyrics: f.lyrics, instrumental: !!f.instrumental, vocal: f.vocal, negative: f.negative,
      styleWeight: f.styleWeight, weirdness: f.weirdness, variety: f.variety, seconds: f.seconds || 0 });
  } else if (S.mode === 'lyrics') b.idea = f.idea;
  else if (S.mode === 'sounds') Object.assign(b, { prompt: f.prompt, loop: !!f.loop, tempo: f.tempo || 0, key: f.key || 'Any' });
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
    const d = await post('/api/audio/gen', body);
    if (body.preset) {
      const f = S.f.simple;
      f.presetN = f.presetN || {};
      f.presetN[body.preset] = (f.presetN[body.preset] || 0) + 1;
      save();
      paintMake();
    }
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
function _lyric(l) {
  const box = el('div', 'au-lyr');
  const h = el('div', 'au-lyr-h');
  h.appendChild(el('span', null, l.title || 'Lyrics'));
  h.appendChild(el('span', 'sp'));
  const use = el('button', 'au-link', 'use in custom');
  use.type = 'button';
  use.addEventListener('click', () => {
    S.f.custom.lyrics = l.text;
    if (!S.f.custom.title) S.f.custom.title = String(l.title || '').slice(0, 80);
    S.f.custom.instrumental = false;
    setMode('custom');
    say('The lyrics are in Custom.');
  });
  const copy = el('button', 'au-link', 'copy');
  copy.type = 'button';
  copy.addEventListener('click', () => { navigator.clipboard.writeText(l.text).then(() => say('Copied.')).catch(() => say('Not copied.', true)); });
  const more = el('button', 'au-link', 'all');
  more.type = 'button';
  more.addEventListener('click', () => box.classList.toggle('open'));
  h.append(use, copy, more);
  box.appendChild(h);
  box.appendChild(el('pre', null, l.text));
  return box;
}

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

// ── the almanac (V34.A: public/js/audio/almanac-data.js) ────────────────────
// Its SECTIONS in two groups (Music, Sounds) on the left, the open one's categories under it, its NOTES on the right.
// (phase V34.F, the owner 2026-10-23, (т6)-(т9), (у5)) A press on a note COPIES its text - "copied" on the note - and is
// pasted by the person where it is wanted: nothing is written into a field, no knob is set. No sources under the notes. A
// press anywhere outside the window closes it, as Escape and its cross do; it opens again where it was left - the same
// section, category and scroll (kept in the browser, `mv3_audio_alm_v1`).
const KEY_ALM = 'mv3_audio_alm_v1';
function _almSections() {
  return (ALM && Array.isArray(ALM.SECTIONS)) ? ALM.SECTIONS.filter(s => s && s.label && Array.isArray(s.notes)) : [];
}
const _fieldLabel = (f) => (ALM && ALM.FIELDS && ALM.FIELDS[f] && ALM.FIELDS[f].label) || f;
async function _copy(text) {
  try { await navigator.clipboard.writeText(String(text || '')); return true; } catch (e) { /* not allowed */ }
  // Without the clipboard API: a hidden field, selected and copied.
  try {
    const t = el('textarea');
    t.value = String(text || '');
    t.style.position = 'fixed'; t.style.opacity = '0';
    document.body.appendChild(t);
    t.select();
    const ok = document.execCommand('copy');
    t.remove();
    return ok;
  } catch (e) { return false; }
}
let _almWin = null;
function openAlmanac(anchor) {
  if (_almWin) { _almWin.close(); return; }
  const secs0 = _almSections();
  const win = el('div', 'hp au-alm');
  const head = el('div', 'hp-head');
  head.appendChild(el('b', null, 'Almanac'));
  head.appendChild(el('span', 'hp-sub', 'music and sounds · a press copies a note - paste it where you want it' + (ALM.UPDATED ? ' · ' + ALM.UPDATED : '')));
  const x = el('button', 'hp-x', '✕');
  x.type = 'button';
  head.appendChild(x);
  win.appendChild(head);
  const body = el('div', 'hp-body');
  const side = el('div', 'hp-side');
  const main = el('div', 'au-alm-main');
  body.append(side, main);
  win.appendChild(body);
  // Beside the settings column: the constructor stays in sight, to paste into.
  const r = anchor.getBoundingClientRect();
  const w = Math.max(520, Math.min(820, window.innerWidth - r.right - 30));
  win.style.left = Math.round(Math.max(8, Math.min(r.right + 10, window.innerWidth - w - 16))) + 'px';
  win.style.top = '84px';
  win.style.width = w + 'px';
  win.style.height = 'calc(100vh - 120px)';
  document.body.appendChild(win);

  // Where it was left: the section, its category and how far it was scrolled.
  const at = ls(KEY_ALM, {}) || {};
  const soundy = S.mode === 'sounds' || S.mode === 'sfx';
  let open = secs0.find(s => s.id && s.id === at.sec) || secs0.find(s => (s.group === 'sound') === soundy) || secs0[0];
  let cat = open && at.sec === open.id && (open.cats || []).some(c => c.id === at.cat) ? at.cat : '';
  const remember = () => lsSet(KEY_ALM, { sec: open ? open.id : '', cat, scroll: Math.round(main.scrollTop) });

  const away = (e) => { if (!win.contains(e.target) && !anchor.contains(e.target)) close(); };
  const layer = Layers.open(win, { modal: false, name: 'the audio almanac', onEsc: () => close() });
  const close = () => {
    remember();
    document.removeEventListener('mousedown', away, true);
    win.remove();
    Layers.close(layer);
    _almWin = null;
  };
  _almWin = { close };
  x.addEventListener('click', close);
  setTimeout(() => { if (_almWin) document.addEventListener('mousedown', away, true); }, 0);
  let _st = 0;
  main.addEventListener('scroll', () => { clearTimeout(_st); _st = setTimeout(remember, 250); });

  const paintSide = () => {
    side.textContent = '';
    for (const [g, label] of [['music', 'Music'], ['sound', 'Sounds']]) {
      const list = secs0.filter(s => s.group === g);
      if (!list.length) continue;
      side.appendChild(el('div', 'au-lbl au-alm-g', label));
      for (const s of list) {
        const b = el('button', 'hp-sec' + (s === open ? ' on' : ''));
        b.type = 'button';
        b.appendChild(el('span', 'nm', s.label));
        b.appendChild(el('small', null, String(s.notes.length)));
        b.title = s.about || '';
        b.addEventListener('click', () => { open = s; cat = ''; paintSide(); paintNotes(); main.scrollTop = 0; remember(); });
        side.appendChild(b);
        if (s === open && (s.cats || []).length > 1) {
          for (const c of s.cats) {
            const cb = el('button', 'hp-cat' + (cat === c.id ? ' on' : ''));
            cb.type = 'button';
            cb.appendChild(el('span', 'nm', c.label));
            cb.appendChild(el('small', null, String(s.notes.filter(n => n.cat === c.id).length)));
            cb.addEventListener('click', () => { cat = cat === c.id ? '' : c.id; paintSide(); paintNotes(); main.scrollTop = 0; remember(); });
            side.appendChild(cb);
          }
        }
      }
    }
  };
  const paintNotes = () => {
    main.textContent = '';
    if (!open) return;
    if (open.about) main.appendChild(el('div', 'au-said', open.about));
    for (const n of open.notes.filter(y => !cat || y.cat === cat)) {
      const b = el('button', 'au-alm-note' + ((n.to || []).length ? '' : ' is-advice'));
      b.type = 'button';
      const h = el('div', 'au-lyr-h');
      h.appendChild(el('span', null, n.title));
      h.appendChild(el('span', 'sp'));
      const to = (n.to || []).map(_fieldLabel);
      h.appendChild(el('span', 'au-muted', to.length ? 'for ' + to.join(', ') : 'advice'));
      const done = el('span', 'au-copied', 'copied');
      h.appendChild(done);
      b.appendChild(h);
      b.appendChild(el('div', 'au-alm-text', n.text));
      if (n.why) b.appendChild(el('div', 'au-said', n.why));
      // What the note suggests for the knobs and the length - to set by hand; nothing is set by the press.
      const extra = [];
      if (n.set) extra.push(Object.entries(n.set).map(([k, v]) => k + ' ' + v).join(', '));
      if (n.seconds) extra.push(n.seconds + ' s');
      if (extra.length) b.appendChild(el('div', 'au-muted au-alm-set', 'try ' + extra.join(' · ')));
      b.addEventListener('click', async () => {
        const ok = await _copy(n.text);
        if (!ok) { say('Not copied - the clipboard refused it.', true); return; }
        b.classList.add('is-put');
        setTimeout(() => b.classList.remove('is-put'), 1200);
      });
      main.appendChild(b);
    }
  };
  paintSide();
  paintNotes();
  // The scroll it was left at - once the notes are there.
  if (open && at.sec === open.id && (at.cat || '') === cat && +at.scroll > 0) main.scrollTop = +at.scroll;
}

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

async function _ready() {
  if (CAT) return true;
  try { CAT = await api('/api/audio/catalog'); } catch (e) { CAT = null; say('Generate audio could not start: ' + e.message, true); return false; }
  if (CAT.almanac) { try { ALM = await import('/js/audio/almanac-data.js'); } catch (e) { ALM = null; } }
  if (!CAT.sunoModels.includes(S.model)) S.model = 'V6';
  return true;
}

// `remember` is false when another view took the base (onYield): that one writes its own mark.
async function _show(on, remember = true) {
  _shown = !!on;
  if (remember) Views.rememberView(_lk(_key), _shown ? NAME : null, NAME);
  Views.setBase(NAME, _shown);
  if (!_shown) { _stopHearing(); _unfollow(); if (_almWin) _almWin.close(); return; }
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
