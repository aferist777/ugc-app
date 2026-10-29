/* ═══════════════════════════════════════════════════════════════════════════
   SUNO'S FORM (phase V59, the owner 2026-10-29: "создать попап с генератором музыки как в merge. конкретно suno взять") -
   ONE constructor of Suno's music for two places:
     - Merge's "/ generate audio" (js/merge-v3/audchat.js) - which adds what is Merge's own: the engine switch and
       ElevenLabs, Sounds, Video to Music, the project's presses under the card, "by the video", the mode a project was
       left on;
     - the Library's window (js/library/music-window.js) - Simple, Custom and Lyrics, nothing else.

   What is here:
     the state of a page's form    remembered in the browser under the page's own key (Merge `mv3_audio_v1` as before)
     the catalog and the almanac    GET /api/audio/catalog, V34.A's public/js/audio/almanac-data.js - once per page
     the settings column's rows     the mode, Suno's model (V6 / V6_MINI / V6_WILD), the length in one line, the chips
                                    folded into Genre / Mood / Sound (one open at a time), the price, the almanac's button
     the constructor                Simple (the chips and the person's words, or - the Library's window opened on a mood
                                    folder of Music -> highlights - that mood's preset), Custom, Lyrics - their fields,
                                    their request (body), a press of "generate" (press)
     the lyrics' card               "use in custom", "save", "copy", "all"
     THE "?" (phase V60, (пп10а))   every parameter's name and every field of the card has a "?" right of it - what it is
                                    and how to use it, on the pointer resting there (js/sound/qmark.js); the grey notes
                                    under the rows and the hints on whole rows (V59.1) went into them
     THE ALMANAC (phase V60, (пп13а)-(пп15а))   a window in the middle over a darkened, blurred page: the sections on the
                                    left, the open one's notes as chips under their categories, a chip's note under them
                                    ("+ add", "copy"), and a field the notes are gathered in - "into <field>" adds it to
                                    the open mode's own field
     SAVED LYRICS (phase V59.1, (мз7а)-(мз9а))   Music -> Lyrics, sub-session Q's store (GET|POST /api/audio/lyrics): in
                                    Custom a dropdown of them over the Lyrics field (a choice replaces the text, the title
                                    only when it is empty) and "save" under it; "save" on every text Lyrics wrote - a text
                                    saved is marked and not saved twice. The list is read at every ready() (a window or a
                                    view opened) and after a save.

   The caller builds its own frame around them and says, through `o`, how to paint itself again; the server is
   routes/audio-gen.js and lib/audio-gens.js - a press writes its record and its Alerts row at once.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as Layers from '../layers.js';
import { secs } from './wave.js';
import { qmark, withQ, closeQ } from './qmark.js';

export { qmark, withQ, closeQ };

export const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
export const ls = (k, fb) => { try { const v = localStorage.getItem(k); return v == null ? fb : JSON.parse(v); } catch (e) { return fb; } };
export const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* a private window */ } };
export async function api(url, opts) {
  const r = await fetch(url, opts);
  const d = await r.json().catch(() => null);
  if (!d || d.success === false) throw new Error((d && d.error) || ('status ' + r.status));
  return d;
}
export const post = (url, body) => api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });

/** What each of Suno's three music modes is, in the constructor's words. `into` - where its tracks go. */
export function modeHelp(mode, into) {
  const to = into || 'AUDIO → Music';
  if (mode === 'simple') return 'Background music with no voice, for a video where somebody talks. Pick the feel with the chips on the left and, if you like, say more in your own words (any language). The writer turns it into Suno\'s style and Suno makes TWO tracks of the length on the left. They go to ' + to + '.';
  if (mode === 'custom') return 'You write it: a title, a style and - unless it is instrumental - the lyrics ([Verse], [Chorus]…). The chips on the left add their words to the style. Suno makes TWO tracks; the length on the left (10–360 s) or Suno\'s own.';
  if (mode === 'lyrics') return 'Song lyrics from an idea - two or three texts. A text can go straight into Custom with "use in custom", or be kept in Music → Lyrics with "save". Text only: no row in Alerts.';
  return '';
}
export const MODEL_HELP = { V6: 'the newest - most natural', V6_MINI: 'faster', V6_WILD: 'bolder, stranger' };
// The length a mode takes: [lowest, highest, what its "?" says]; empty - the model decides.
const LEN = { simple: [0, 360, 'the video\'s length - the bed comes out a little longer'], custom: [10, 360, '10–360 s'],
  compose: [3, 600, '3 s – 10 min'], sfx: [0.5, 30, '0.5–30 s'] };

// (phase V60, (пп10а)) What the "?" of the shared rows says - the mode's dropdown lists the modes it offers, each in a line.
export const MODE_SHORT = {
  simple: 'background music for a voice to talk over - from the chips and your words, no singing',
  custom: 'a track of your own - you write the title, the style and, unless it is instrumental, the lyrics',
  lyrics: 'song lyrics from an idea - text only, two or three versions',
  sounds: 'a sound or a loop by Suno, from a description',
  compose: 'music by ElevenLabs from a description',
  video: 'music made for a video - ElevenLabs watches it and scores it',
  sfx: 'a sound effect by ElevenLabs, up to 30 s',
};
const CHIP_HELP = {
  genre: 'The kind of music - lo-fi, pop, cinematic…',
  mood: 'How it feels - calm, bright, dark…',
  sound: 'What it is made of - the instruments, the texture, the production.',
};
/** The "?" of the mode's row: what each of `modes` makes. */
export function modeRowHelp(modes) {
  const lines = (modes || []).map(m => m.label + ' - ' + (MODE_SHORT[m.id] || ''));
  return 'What to make.\n' + lines.join('\n');
}
export const MODEL_ROW_HELP = 'Suno\'s model - one price for all three.\nV6 - the newest, most natural · V6_MINI - faster · V6_WILD - bolder, stranger.\nThe choice is remembered.';

// The catalog and the almanac, read once per page.
let CAT = null;
let ALM = null;
let _readying = null;

// ── saved lyrics (phase V59.1) - Music -> Lyrics, sub-session Q's store ───────
// [{ id, title, text, from: 'suno' | 'own', gen, date }], newest first; [] while the store does not answer.
let SAVED = [];
const _norm = (t) => String(t || '').replace(/\r\n/g, '\n').trim();
/** The saved texts read again. Never throws: a store that does not answer leaves the list as it was. */
export async function loadSaved() {
  try { SAVED = (await api('/api/audio/lyrics')).items || []; } catch (e) { /* not there yet */ }
  return SAVED;
}
export const savedLyrics = () => SAVED.slice();
/** A text is saved when Music -> Lyrics holds the same text. */
export const isSaved = (text) => !!_norm(text) && SAVED.some(x => _norm(x.text) === _norm(text));
/** A text into Music -> Lyrics: { title, text, from, gen? } -> the item (the one there already when it was). */
export async function saveLyric(l) {
  const d = await post('/api/audio/lyrics', { title: String(l.title || '').slice(0, 120), text: _norm(l.text), from: l.from || 'own', gen: l.gen || undefined });
  if (d.item && !SAVED.some(x => x.id === d.item.id)) SAVED.unshift(d.item);
  return d.item || null;
}
// A title for a text written by hand with no title: its first line that is not a [Verse]-like mark.
export function titleOf(text) {
  const line = _norm(text).split('\n').map(s => s.trim()).find(s => s && !/^\[[^\]]*\]$/.test(s)) || '';
  return line.replace(/^\[[^\]]*\]\s*/, '').slice(0, 80) || 'Lyrics';
}

/**
 * A page's form.
 *   o.store            the browser key it is remembered under
 *   o.base             more of the state's top (Merge: the engine, the mode it opens on, lastMode, of)
 *   o.fields           the fields of the caller's other modes (Merge: sounds, compose, video, sfx)
 *   o.persist(S)       what is written under the key (default: the mode, the model and the fields)
 *   o.say(text, bad)   the caller's line
 *   o.title            the generator's name in a failure to start ("Generate audio" - Merge's)
 *   o.paintCol() / o.paintMake() / o.paintMakePrice()   paint the settings column / the constructor / the price beside
 *                      "generate" again
 *   o.setMode(id, how) another mode chosen here ("write lyrics from an idea…", "use in custom", the mode's dropdown - `how`
 *                      'pick')
 *   o.videoSecs()      the video's length - "by the video (N s)" beside the length (Merge only)
 *   o.lengthNote(mode) what the length's note says (the Library has no video: not "the video's length")
 *   o.priceOf(mode, p) a price this form does not know how to say (Merge's Video to Music) - or null
 *   o.mood()           the highlights mood Simple makes - the id of the mood folder the Library's window is open on, '' for
 *                      none (phase V60, (пп9а): a mood's tracks are made there now; Merge has no moods any more)
 *   o.lyricsOff()      true - Lyrics is not a mode here (phase V60.2: the Library's window on a mood folder): Custom shows
 *                      no "write lyrics from an idea…"
 *                      (a pick in the dropdown is when the Library's window carries a mood's edit into Custom: carryEdit)
 */
export function createSunoForm(o) {
  const S = Object.assign({ mode: 'simple', model: 'V6' }, o.base || {}, ls(o.store, {}));
  S.f = Object.assign({
    simple: { words: '', seconds: 30, writer: true, picked: { genre: [], mood: [], sound: [] }, flat: [], pSeconds: 120, presetN: {} },
    custom: { title: '', style: '', lyrics: '', instrumental: false, vocal: '', negative: '', styleWeight: '', weirdness: '', variety: 0, seconds: 0 },
    lyrics: { idea: '' },
  }, o.fields || {}, S.f || {});
  const say = (t, bad) => { if (typeof o.say === 'function') o.say(t, bad); };
  const call = (name, ...a) => { if (typeof o[name] === 'function') return o[name](...a); return undefined; };
  const save = () => lsSet(o.store, typeof o.persist === 'function' ? o.persist(S) : { mode: S.mode, model: S.model, f: S.f });

  let _chipOpen = '';            // (phase V54) the one chip group open in the settings column - '' all folded
  let _priceBox = null;
  let _almWin = null;
  // (phase V60.1, the owner 2026-10-29: "давай в simple давать пользователю редактировать стандартный шаблон кнопкой edit на
  // самой карточке в золотой рамке"; (пк6а)-(пк8а)) The mood's preset as the person changes it - Suno's style and excludes -
  // { mood, style, negative }, for ONE press ((пк7б)): gone after "generate" and when the Library's window opens again
  // (resetEdit); never kept in the browser.
  let _edit = null;
  let _litT = 0;                 // the chips' light painted again a moment after the mood's Style is typed in

  async function ready() {
    const saved = loadSaved();
    if (CAT) { if (!CAT.sunoModels.includes(S.model)) S.model = 'V6'; await saved; return true; }
    if (!_readying) {
      _readying = (async () => {
        const c = await api('/api/audio/catalog');
        let a = null;
        if (c.almanac) { try { a = await import('/js/audio/almanac-data.js'); } catch (e) { a = null; } }
        CAT = c; ALM = a;
      })().finally(() => { _readying = null; });
    }
    try { await _readying; } catch (e) { say((o.title || 'Generate audio') + ' could not start: ' + e.message, true); await saved; return !!CAT; }
    await saved;
    if (CAT && !CAT.sunoModels.includes(S.model)) S.model = 'V6';
    return !!CAT;
  }

  // (phase V34.F, the owner's (ф3)) The highlights moods - V34.A's ten presets: the server's list (the catalog), the
  // almanac's own words for them when it is there.
  function moods() {
    const fromCat = (CAT && Array.isArray(CAT.moods)) ? CAT.moods : [];
    const P = (ALM && Array.isArray(ALM.HIGHLIGHT_PRESETS)) ? ALM.HIGHLIGHT_PRESETS : [];
    return fromCat.map(m => Object.assign({}, P.find(x => x.id === m.id) || {}, m));
  }
  // (phase V60, (пп9а)) The mood Simple makes is the folder's the Library's window is open on - no dropdown anywhere.
  const preset = () => {
    if (S.mode !== 'simple') return null;
    const id = String(call('mood') || '');
    return id ? moods().find(m => m.id === id) || null : null;
  };
  // (phase V60.1) The edit of THIS mood's preset, when it is being edited; changed - it says other than the preset does.
  const editOf = (mood) => (_edit && mood && _edit.mood === mood.id ? _edit : null);
  const _t = (s) => String(s || '').replace(/\r\n/g, '\n').trim();
  const editChanged = (mood, e) => !!e && (_t(e.style) !== _t(mood.style) || _t(e.negative) !== _t(mood.negative));
  function resetEdit() { _edit = null; }

  function chipGroups() {
    // The almanac's (V34.A: { genre, mood, sound } of { id, label, style }) - else the catalog's three lists of words.
    if (ALM && ALM.CHIPS && Array.isArray(ALM.CHIPS.genre)) {
      return [['genre', 'Genre'], ['mood', 'Mood'], ['sound', 'Sound']]
        .map(([k, label]) => ({ key: k, label, chips: (ALM.CHIPS[k] || []).map(c => ({ id: c.id, label: c.label, style: c.style || c.label })) }))
        .filter(g => g.chips.length);
    }
    return ((CAT && CAT.chips) || []).map(g => ({ key: '', label: g.label, chips: g.chips.map(c => ({ id: c, label: c, style: c })) }));
  }
  function isPicked(group, c) {
    const f = S.f.simple;
    return group ? ((f.picked || {})[group] || []).includes(c.id) : (f.flat || []).includes(c.label);
  }
  function pick(group, c) {
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
  function pickedLabels() {
    const out = [];
    for (const g of chipGroups()) for (const c of g.chips) if (isPicked(g.key, c)) out.push(c.label);
    return out;
  }
  function addWords(words) {
    const key = S.mode === 'custom' ? 'style' : 'prompt';
    const f = S.f[S.mode];
    const cur = String(f[key] || '').trim();
    f[key] = cur ? cur.replace(/[,\s]*$/, '') + ', ' + words : words;
    save();
    call('paintMake');
  }

  // (phase V60.2, the owner 2026-10-29: "только во время создания музыки для mood нужно приписать чипсы для добавления";
  // (ми1а)) On a mood folder a chip's words go into the mood's Style as the person edits it: the chip opens "edit" by itself
  // when it is not open, its words are written after the Style, a press again takes them out; it is lit while they are
  // there. Like the edit, for ONE press.
  const moodHas = (mood, c) => { const e = editOf(mood); return !!e && !!c.style && String(e.style || '').includes(c.style); };
  function moodChip(mood, c) {
    if (!editOf(mood)) _edit = { mood: mood.id, style: String(mood.style || ''), negative: String(mood.negative || '') };
    _edit.style = moodHas(mood, c) ? _takeOut(_edit.style, c.style) : _join(_edit.style, c.style);
    call('paintCol');
    call('paintMake');
  }
  // (phase V60.2, (ми2а)-(ми5а)) Custom chosen while the mood's card is in "edit": its Style and Exclude go into Custom's,
  // replacing what was there; the title is the mood's when Custom has none; instrumental on (the presets are). From then on it
  // is Custom's own text; the mood's edit stays on its card for its one press. true - carried.
  function carryEdit() {
    const mood = preset();
    const e = editOf(mood);
    if (!mood || !e) return false;
    const c = S.f.custom;
    c.style = _t(e.style);
    c.negative = _t(e.negative);
    if (!_t(c.title)) c.title = String(mood.title || mood.label || '').slice(0, 80);
    c.instrumental = true;
    save();
    return true;
  }

  // ── the settings column's rows ────────────────────────────────────────────
  /** The mode's dropdown, of `modes` (the catalog's records). A choice here is the person's: setMode(id, 'pick'). */
  function modeSelect(modes) {
    const ms = el('select');
    for (const m of modes || []) {
      const op = el('option', null, m.label);
      op.value = m.id;
      ms.appendChild(op);
    }
    ms.value = S.mode;
    ms.addEventListener('change', () => call('setMode', ms.value, 'pick'));
    return ms;
  }
  /** Suno's model - one price for all three; the choice is remembered. */
  function modelSelect() {
    const mo = el('select');
    for (const id of (CAT ? CAT.sunoModels : ['V6'])) {
      const op = el('option', null, id + ' - ' + (MODEL_HELP[id] || ''));
      op.value = id;
      mo.appendChild(op);
    }
    mo.value = S.model;
    mo.addEventListener('change', () => { S.model = mo.value; save(); });
    return mo;
  }
  // The length: what a mode takes, empty - the model decides. (phase V59.1 in the Library, V60 in Merge, the owner: "название
  // length и дропдаун в одну строку") ONE line - "Length ? [46] s · by the video (46 s)" -, its name left of the field, what
  // it means in its "?". `row(label, body)` - the caller's row of the settings column.
  function lengthRows(row) {
    if (!LEN[S.mode]) return;
    let [lo, hi, note] = LEN[S.mode];
    const said = call('lengthNote', S.mode);
    if (said) note = said;
    const f = S.f[S.mode];
    // A mood's track is longer than a fragment: the highlight takes a window from its middle (V33.8) - its own length.
    const mood = !!preset();
    const key = mood ? 'pSeconds' : 'seconds';
    if (mood) { lo = 30; note = 'a highlight plays a window from its middle - 90-180 s leaves room'; if (f.pSeconds == null) f.pSeconds = 120; }
    const n = el('input', 'au-in');
    n.type = 'number'; n.min = '0'; n.max = String(hi); n.step = S.mode === 'sfx' ? '0.5' : '1';
    n.value = f[key] ? String(f[key]) : '';
    n.placeholder = 'auto';
    n.addEventListener('change', () => {
      const v = +n.value || 0;
      f[key] = v <= 0 ? 0 : Math.max(lo || 1, Math.min(hi, v));
      n.value = f[key] ? String(f[key]) : '';
      save(); paintPrice(); call('paintMakePrice');
    });
    const vs = +call('videoSecs') || 0;
    const byVideo = vs > 0 && S.mode !== 'sfx' && !mood;
    const one = el('div', 'au-len au-len-one');
    const lab = withQ(el('label', null, 'Length'), 'How long it is, in seconds: ' + note + '. Empty - the model decides.'
      + (byVideo ? '\n"by the video" - as long as the video lanes of this project.' : ''));
    one.append(lab, n, el('span', 'au-len-auto', 's'));
    if (byVideo) {
      const by = el('button', 'au-link', '· by the video (' + secs(vs) + ')');
      by.type = 'button';
      by.addEventListener('click', () => { f.seconds = Math.max(lo || 1, Math.min(hi, Math.round(vs))); save(); call('paintCol'); call('paintMakePrice'); });
      one.appendChild(by);
    }
    row('', one);
  }
  // The chips: in Simple they ARE the request; in Custom and ElevenLabs' music a chip adds its words to the text.
  // (phase V54, block 7, the owner 2026-10-27: "чтобы они были свернутыми дропдаунами и открыт может быть только один из
  // них") Each group is a FOLDED ROW - its name and its "?", in Simple what is picked in it ("Genre · Lo-fi, Jazz"); a press
  // opens it and folds the one open before.
  function chipRows(col) {
    if (!['simple', 'custom', 'compose'].includes(S.mode)) return;
    const mood = preset();
    const why = mood ? 'A press adds the chip\'s words to the mood\'s Style on the card - "edit" opens by itself; a press again takes them out. For this press only, as the edit.'
      : S.mode === 'simple' ? 'Pick any in each group, or none - the writer reads them with your words.'
      : 'A press on a chip adds its words to the ' + (S.mode === 'custom' ? 'style' : 'description') + '.';
    // Lit: in Simple the chips picked; on a mood folder those whose words are in the mood's Style.
    const lit = (g, c) => (mood ? moodHas(mood, c) : S.mode === 'simple' && isPicked(g.key, c));
    for (const g of chipGroups()) {
      const gk = g.key || g.label;
      const open = _chipOpen === gk;
      const picked = mood || S.mode === 'simple' ? g.chips.filter(c => lit(g, c)).map(c => c.label) : [];
      const head = el('button', 'au-chips-h' + (open ? ' is-open' : '') + (picked.length ? ' has-picked' : ''));
      head.type = 'button';
      head.setAttribute('aria-expanded', open ? 'true' : 'false');
      head.appendChild(el('span', 'au-chips-tw', '▸'));
      head.appendChild(withQ(el('b', null, g.label), (CHIP_HELP[g.key] ? CHIP_HELP[g.key] + '\n' : '') + why + '\nOne group is open at a time.'));
      head.appendChild(el('span', 'au-chips-sel', picked.length ? '· ' + picked.join(', ') : ''));
      head.appendChild(el('span', 'au-chips-n', String(g.chips.length)));
      head.addEventListener('click', () => { _chipOpen = open ? '' : gk; call('paintCol'); });
      col.appendChild(head);
      if (!open) continue;
      const wrap = el('div', 'mv3-chips au-chips-open');
      for (const c of g.chips) {
        const on = lit(g, c);
        const b = el('button', 'mv3-chip' + (on ? ' on' : ''), c.label);
        b.type = 'button';
        b.title = c.style;
        b.addEventListener('click', () => {
          if (mood) moodChip(mood, c);
          else if (S.mode === 'simple') { pick(g.key, c); call('paintCol'); call('paintMake'); }
          else addWords(c.style);
        });
        wrap.appendChild(b);
      }
      col.appendChild(wrap);
    }
  }

  // ── the price ─────────────────────────────────────────────────────────────
  function price() {
    const P = (CAT && CAT.prices) || {};
    const p = P[S.mode];
    if (!p) return { big: '', small: '' };
    const over = call('priceOf', S.mode, p);
    if (over) return over;
    const f = S.f[S.mode] || {};
    if (p.credits != null) return { big: '$' + p.usd, small: p.credits + ' kie credits · ' + p.note };
    if (p.usdPerMin) {
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
  const priceText = () => { const p = price(); return p.big ? p.big + ' · ' + p.small : ''; };
  /** The price box at the foot of the settings column - painted again by paintPrice(). */
  function priceBox(col) {
    _priceBox = el('div', 'mv3-ig-cost');
    col.appendChild(_priceBox);
    paintPrice();
  }
  function paintPrice() {
    const box = _priceBox;
    if (!box || !box.isConnected) return;
    const p = price();
    box.textContent = '';
    box.appendChild(el('b', null, p.big));
    box.appendChild(el('span', null, 'per press · ' + p.small + (CAT && CAT.fake ? ' · FAKE - nothing is paid' : '')));
  }

  // ── the constructor's builders ───────────────────────────────────────────
  // (phase V60, (пп10а)) `help` - what the field's "?" says (right of its name); no grey words in its head any more.
  function field(label, input, opts) {
    const op = opts || {};
    const f = el('div', 'au-f');
    const h = el('div', 'au-f-h');
    if (label) h.appendChild(withQ(el('span', 'au-f-n', label), op.help));
    if (op.max) {
      const cnt = el('span', 'au-cnt');
      const upd = () => { const n = String(input.value || '').length; cnt.textContent = n + ' / ' + op.max; cnt.classList.toggle('is-over', n > op.max); };
      input.addEventListener('input', upd);
      upd();
      h.appendChild(cnt);
    }
    if (h.childNodes.length) f.appendChild(h);
    f.appendChild(input);
    return f;
  }
  function text(obj, key, opts) {
    const op = opts || {};
    const t = el(op.area ? 'textarea' : 'input', op.area ? 'au-ta' : 'au-in');
    if (!op.area) t.type = 'text';
    if (op.rows) t.rows = op.rows;
    t.placeholder = op.placeholder || '';
    t.value = obj[key] == null ? '' : String(obj[key]);
    t.addEventListener('input', () => { obj[key] = t.value; save(); });
    return t;
  }
  // A tick box - its words, and its "?" (`help`) right of them.
  function check(obj, key, label, after, help) {
    const lab = el('label', 'au-check');
    const c = el('input');
    c.type = 'checkbox';
    c.checked = !!obj[key];
    c.addEventListener('change', () => { obj[key] = c.checked; save(); if (after) after(); });
    lab.append(c, withQ(el('span', null, label), help));
    return lab;
  }
  // A knob of fine-tuning - its name with its "?" (`hint`), the slider, the value (a double press: back to the engine's own).
  function knob(obj, key, label, min, max, step, hint) {
    const row = el('div', 'au-knob');
    row.appendChild(withQ(el('span', null, label), (hint ? hint + '\n' : '') + 'A double press on the value gives it back to the engine.'));
    const r = el('input');
    r.type = 'range'; r.min = String(min); r.max = String(max); r.step = String(step);
    const v = el('span', null, obj[key] === '' || obj[key] == null ? 'auto' : String(obj[key]));
    r.value = obj[key] === '' || obj[key] == null ? String((min + max) / 2) : String(obj[key]);
    r.addEventListener('input', () => { obj[key] = +r.value; v.textContent = String(obj[key]); save(); });
    v.addEventListener('dblclick', () => { obj[key] = ''; v.textContent = 'auto'; save(); });
    row.append(r, v);
    return row;
  }

  /** How the mode works - the "?" of the mode's name (phase V60, (пп11а): once the ♪ block of the gold card): a mood's, or
   *  the mode's own (`into` - where its tracks go). null - not a mode of this form. */
  function helpText(into) {
    const p = preset();
    if (p) return 'Background music for highlights in one mood: its preset goes to Suno as it is - no chips, no words - and Suno makes TWO tracks. They go to Music → highlights → ' + p.label + ', and the highlights popup offers them. Each press turns one colour of the mood, so the next tracks differ.';
    return ['simple', 'custom', 'lyrics'].includes(S.mode) ? modeHelp(S.mode, into) : null;
  }

  /** The fields of Simple (or its highlights mood), Custom or Lyrics, into `card`. false - not one of them. */
  function paintFields(card) {
    const f = S.f[S.mode];
    const mood = preset();
    if (mood) {
      // The preset says it all: what it is for, the style Suno is given (the rules add the bed's excludes and knobs).
      const n = (f.presetN || {})[mood.id] || 0;
      const box = el('div', 'au-preset');
      box.appendChild(el('b', null, mood.label + (mood.title ? ' · ' + mood.title : '')));
      if (mood.about) box.appendChild(el('div', 'au-muted', mood.about));
      // (phase V60.1) "edit": the preset's style and excludes in two fields, filled with the mood's own, for this press only.
      const e = editOf(mood);
      const mark = el('span', 'au-edited', 'edited · this press only');
      const paintMark = () => { mark.hidden = !editChanged(mood, e); };
      if (!e) {
        if (mood.style) box.appendChild(el('div', 'au-preset-style', mood.style));
      } else {
        const area = (key, rows, ph) => {
          const t = el('textarea', 'au-ta');
          t.rows = rows;
          t.placeholder = ph;
          t.value = e[key] == null ? '' : String(e[key]);
          // (phase V60.2) The chips lit by the words in the Style follow what is typed.
          t.addEventListener('input', () => { e[key] = t.value; paintMark(); clearTimeout(_litT); _litT = setTimeout(() => call('paintCol'), 250); });
          return t;
        };
        box.appendChild(field('Style', area('style', 4, 'genre, tempo, instruments, texture, production - by commas'),
          { max: 1000, help: 'What Suno is asked for - the mood\'s own words to start with. By commas, the most important first; the bed\'s own words (instrumental, background, steady) are added after them by themselves. Up to 1000 characters.' }));
        box.appendChild(field('Exclude', area('negative', 2, 'what must not be there - bare words, by commas'),
          { max: 1000, help: 'What Suno should keep out - bare words by commas, never "no …". Voices, drops and risers are kept out of every bed by themselves. Up to 1000 characters.' }));
      }
      box.appendChild(el('div', 'au-muted', 'press ' + (n + 1) + ' of this mood' + (Array.isArray(mood.vary) && mood.vary.length
        ? ' - with a touch of ' + mood.vary[n % mood.vary.length] : '') + ' · two tracks into Music → highlights → ' + mood.label));
      const fl = field('The mood', box, { help: 'The preset of this mood folder: it goes to Suno as it is - no words are needed. Its two tracks go into this folder, and the highlights popup offers them.\nEach press turns another colour of the mood, so the next tracks differ - an edited style too.\n"edit" - change its style and excludes for THIS press; a chip on the left adds its words to the style. After "generate", or when the window opens again, it is the mood\'s own preset. "standard" - back to it now.\nCustom chosen while editing takes this style and these excludes.' });
      const act = el('span', 'au-f-act');
      const btn = el('button', 'au-link au-edit', e ? 'standard' : 'edit');
      btn.type = 'button';
      btn.title = e ? 'Back to the mood\'s own preset' : 'Change the mood\'s style and excludes - for this press only';
      btn.addEventListener('click', () => {
        _edit = e ? null : { mood: mood.id, style: String(mood.style || ''), negative: String(mood.negative || '') };
        call('paintCol');
        call('paintMake');
      });
      paintMark();
      act.append(mark, btn);
      fl.querySelector('.au-f-h').appendChild(act);
      card.appendChild(fl);
      return true;
    }
    if (S.mode === 'simple') {
      const picked = pickedLabels();
      const row = el('div', 'au-picked');
      if (picked.length) for (const p of picked) row.appendChild(el('span', 'au-chip on', p));
      else row.appendChild(el('span', null, 'No chips yet - pick the genre, the mood and the sound on the left.'));
      card.appendChild(field('The feel', row, { help: 'The chips picked on the left - the genre, the mood and the sound. None - the writer chooses.' }));
      card.appendChild(field('In your words', text(f, 'words', { area: true, rows: 3, placeholder: 'e.g. soft and warm under a skincare review, nothing that pulls the ear away from the voice' }), { max: 1000, help: 'More about the feel, in any language - optional. The writer reads it with the chips. Up to 1000 characters.' }));
      card.appendChild(check(f, 'writer', 'the writer makes Suno\'s style', null, 'The writer turns the chips and your words into Suno\'s style - what it wrote shows on the press.\nOff - the chips go to Suno as they are.'));
      return true;
    }
    if (S.mode === 'custom') {
      card.appendChild(field('Title', text(f, 'title', { placeholder: 'the track\'s name' }), { max: 80, help: 'The track\'s name - both tracks are called by it. Up to 80 characters.' }));
      card.appendChild(field('Style', text(f, 'style', { area: true, rows: 3, placeholder: 'genre, mood, instruments, tempo, production - e.g. indie pop, bright clean guitars, 110 BPM, warm female vocal' }), { max: 1000, help: 'Genre, mood, instruments, tempo, production - the most important first, by commas. A chip on the left adds its words here. Up to 1000 characters.' }));
      card.appendChild(check(f, 'instrumental', 'instrumental', () => call('paintMake'), 'Only the music: no voice and no lyrics.'));
      if (!f.instrumental) {
        const ly = text(f, 'lyrics', { area: true, rows: 7, placeholder: '[Verse]\n...\n[Chorus]\n...' });
        const fl = field('Lyrics', ly, { max: 5000, help: 'What is sung, in parts: [Verse], [Chorus]… Up to 5000 characters. Empty - Suno sings what it makes up.\nThe list over it - the texts kept in Music → Lyrics: a choice replaces the text, the title is taken only when it is empty. "save" keeps this text there; "write lyrics from an idea…" opens Lyrics.' });
        // (phase V59.1, (мз8)) The saved texts over the field: a choice replaces the text, the title only when it is empty.
        fl.insertBefore(savedPick(f), ly);
        const wr = el('button', 'au-link', 'write lyrics from an idea…');
        wr.type = 'button';
        wr.addEventListener('click', () => {
          if (!S.f.lyrics.idea) S.f.lyrics.idea = [f.title, f.style].filter(Boolean).join(' - ').slice(0, 200);
          call('setMode', 'lyrics');
        });
        // (phase V59.1, (мз7а)) "save" - the text written here into Music -> Lyrics, named by the title (else its first line).
        const links = el('div', 'au-f-links');
        // (phase V60.2, (ми7а)) Not on a mood folder: Lyrics is not one of its modes there.
        if (call('lyricsOff')) links.append(saveOwn(f, ly)); else links.append(wr, saveOwn(f, ly));
        fl.appendChild(links);
        card.appendChild(fl);
        const vs = el('select', 'au-sel');
        for (const [v, t] of [['', 'any voice'], ['f', 'a woman\'s voice (likelier)'], ['m', 'a man\'s voice (likelier)']]) { const op = el('option', null, t); op.value = v; vs.appendChild(op); }
        vs.value = f.vocal || '';
        vs.addEventListener('change', () => { f.vocal = vs.value; save(); });
        card.appendChild(field('Voice', vs, { help: 'Whose voice Suno is asked for - it only makes it likelier. Saying it in the style ("warm female vocal") holds better.' }));
      }
      card.appendChild(field('Exclude', text(f, 'negative', { placeholder: 'e.g. heavy metal, distortion, choir' }), { max: 500, help: 'Styles and sounds Suno should avoid - bare words by commas (heavy metal, choir), never "no …" in the style. Up to 500 characters.' }));
      const kn = el('details', 'au-knobs');
      kn.appendChild(withQ(el('summary', null, 'fine-tuning'), 'Suno\'s own values while untouched - open it only to steer the result.'));
      kn.appendChild(knob(f, 'styleWeight', 'hold the style', 0, 1, 0.05, 'How closely it keeps to the style.'));
      kn.appendChild(knob(f, 'weirdness', 'weirdness', 0, 1, 0.05, 'How far it may wander from the expected.'));
      kn.appendChild(knob(f, 'variety', 'variety', 0, 4, 1, '0 - your style as written (V6 rewrites it at 1 and up); 4 - the two tracks as different as they get.'));
      card.appendChild(kn);
      return true;
    }
    if (S.mode === 'lyrics') {
      card.appendChild(field('The idea', text(f, 'idea', { area: true, rows: 2, placeholder: 'e.g. a hopeful song about the first coffee of the morning' }), { max: 200, help: 'What the song is about - Suno writes two or three texts from it. Up to 200 characters.' }));
      return true;
    }
    return false;
  }

  // ── saved lyrics (phase V59.1) ────────────────────────────────────────────
  /** Custom's dropdown of the texts in Music -> Lyrics. */
  function savedPick(f) {
    const sel = el('select', 'au-sel au-saved');
    const head = el('option', null, SAVED.length ? 'saved lyrics (' + SAVED.length + ') - pick one to put it below'
      : 'no saved lyrics yet - "save" keeps one in Music → Lyrics');
    head.value = '';
    sel.appendChild(head);
    for (const it of SAVED) {
      const op = el('option', null, (it.title || titleOf(it.text)) + (it.from === 'suno' ? ' · Suno' : ''));
      op.value = it.id;
      sel.appendChild(op);
    }
    sel.disabled = !SAVED.length;
    sel.addEventListener('change', () => {
      const it = SAVED.find(x => x.id === sel.value);
      if (!it) return;
      f.lyrics = _norm(it.text);
      if (!String(f.title || '').trim()) f.title = String(it.title || '').slice(0, 80);
      save();
      call('paintMake');
    });
    return sel;
  }
  /** Custom's "save": the text in the Lyrics field into Music -> Lyrics. */
  function saveOwn(f, ly) {
    const b = el('button', 'au-link au-save');
    b.type = 'button';
    b.title = 'Keep this text in Music → Lyrics - named by the title, else by its first line';
    const upd = () => {
      const on = isSaved(f.lyrics);
      b.textContent = on ? 'saved ✓' : 'save';
      b.disabled = on || !_norm(f.lyrics);
      b.classList.toggle('is-saved', on);
    };
    ly.addEventListener('input', upd);
    b.addEventListener('click', async () => {
      if (!_norm(f.lyrics) || isSaved(f.lyrics)) return;
      b.disabled = true;
      try {
        await saveLyric({ title: String(f.title || '').trim() || titleOf(f.lyrics), text: f.lyrics, from: 'own' });
        say('Saved in Music → Lyrics.');
        call('onSaved');
        call('paintMake');
      } catch (e) { say('Not saved: ' + e.message, true); upd(); }
    });
    upd();
    return b;
  }
  /** "save" on a text Lyrics wrote (`gen` - its record): into Music -> Lyrics, marked once it is there. */
  function saveButton(l, gen) {
    const b = el('button', 'au-link au-save');
    b.type = 'button';
    b.title = 'Keep this text in Music → Lyrics';
    const upd = () => { const on = isSaved(l.text); b.textContent = on ? 'saved ✓' : 'save'; b.disabled = on; b.classList.toggle('is-saved', on); };
    b.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (isSaved(l.text)) return;
      b.disabled = true;
      try {
        await saveLyric({ title: l.title || titleOf(l.text), text: l.text, from: 'suno', gen: gen && gen.id });
        say('Saved in Music → Lyrics.');
        call('onSaved');
      } catch (er) { say('Not saved: ' + er.message, true); }
      upd();
    });
    upd();
    return b;
  }
  /** A text into Custom - "use in custom" here, or the event `ugc:lyric-use` from a tile of Music -> Lyrics. */
  function useLyric(l) {
    if (!l || !_norm(l.text)) return;
    S.f.custom.lyrics = _norm(l.text);
    if (!String(S.f.custom.title || '').trim()) S.f.custom.title = String(l.title || '').slice(0, 80);
    S.f.custom.instrumental = false;
    save();
    call('setMode', 'custom');
    say('The lyrics are in Custom.');
  }

  /** The request of Simple, Custom or Lyrics - { mode, model, … }; null for another mode. `writerKind` - the project's
   *  kind for Simple's writer ('talking-head' | 'blank' | 'draft' | 'highlights'; the Library has none: 'blank'). */
  function body(writerKind) {
    const f = S.f[S.mode];
    const b = { mode: S.mode, model: S.model };
    const mood = preset();
    if (mood) {
      // (V34.F) A highlights mood: its preset and which press of it this is; the chips and the words stay out.
      b.preset = mood.id;
      b.n = (f.presetN || {})[mood.id] || 0;
      // (phase V60.1) The preset as the person changed it, for this press - only when it says other than the preset.
      const e = editOf(mood);
      if (editChanged(mood, e)) {
        if (!_t(e.style)) throw new Error('The mood\'s style is empty - write it, or press "standard".');
        b.presetEdit = { style: _t(e.style), negative: _t(e.negative) };
      }
      b.seconds = f.pSeconds == null ? 120 : (f.pSeconds || 0);
      b.chips = {}; b.words = ''; b.projectKind = 'highlights';
    } else if (S.mode === 'simple') {
      const groups = chipGroups();
      b.chips = groups.length && groups[0].key ? { genre: (f.picked || {}).genre || [], mood: (f.picked || {}).mood || [], sound: (f.picked || {}).sound || [] } : (f.flat || []);
      b.words = f.words; b.seconds = f.seconds || 0; b.writer = f.writer !== false;
      b.projectKind = writerKind || 'blank';
    } else if (S.mode === 'custom') {
      Object.assign(b, { title: f.title, style: f.style, lyrics: f.lyrics, instrumental: !!f.instrumental, vocal: f.vocal, negative: f.negative,
        styleWeight: f.styleWeight, weirdness: f.weirdness, variety: f.variety, seconds: f.seconds || 0 });
    } else if (S.mode === 'lyrics') b.idea = f.idea;
    else return null;
    return b;
  }

  /** A press of "generate": the record and its Alerts row are the server's at once. -> { gen, price } */
  async function press(b) {
    const d = await post('/api/audio/gen', b);
    if (b.preset) {
      // The next press of this mood turns another of its colours; (phase V60.1, (пк7б)) an edit served its one press.
      const f = S.f.simple;
      f.presetN = f.presetN || {};
      f.presetN[b.preset] = (f.presetN[b.preset] || 0) + 1;
      save();
      _edit = null;
      call('paintCol');
      call('paintMake');
    }
    return d;
  }

  /** A text of Lyrics: "use in custom" puts it into Custom, "save" keeps it in Music -> Lyrics (phase V59.1), "copy", "all"
   *  unfolds it. `gen` - the record that wrote it. */
  function lyricCard(l, gen) {
    const box = el('div', 'au-lyr');
    const h = el('div', 'au-lyr-h');
    h.appendChild(el('span', null, l.title || 'Lyrics'));
    h.appendChild(el('span', 'sp'));
    const use = el('button', 'au-link', 'use in custom');
    use.type = 'button';
    use.addEventListener('click', () => useLyric(l));
    const copy = el('button', 'au-link', 'copy');
    copy.type = 'button';
    copy.addEventListener('click', async () => { const ok = await copyText(l.text); say(ok ? 'Copied.' : 'Not copied.', !ok); });
    const more = el('button', 'au-link', 'all');
    more.type = 'button';
    more.addEventListener('click', () => box.classList.toggle('open'));
    h.append(use, saveButton(l, gen), copy, more);
    box.appendChild(h);
    box.appendChild(el('pre', null, l.text));
    return box;
  }

  // ── the almanac (V34.A: public/js/audio/almanac-data.js) ──────────────────
  // (phase V60, the owner 2026-10-29: "давай almanac переберем для музыки ... задний фон под попапом нужно темнить и размывать
  // немного ... поле где пользователь может скомпоновать нужные теги ... слева ... кнопкой выбора категории ... в правом будут
  // появляться чипсы расположеные по подкатегориям при нажатии на которые под всеми чипсами снизу будут описываться текстом
  // описания чипса"; (пп13а)-(пп15а)) A window of 860×560 in the middle, the page under it darkened and a little blurred - a
  // press on it, its ✕ or Escape closes it. Left: the SECTIONS as buttons in two groups (Music, Sounds) - a press chooses one.
  // Right, on top: the section's name with its "?" (`about`), its NOTES as chips under their categories; a chip pressed shows
  // its note under all of them - the text, why, the fields it is for, "try …" (the knobs and the length it suggests, to set by
  // hand) - with "+ add" (not on an advice: nothing to insert) and "copy". Right, at the foot: YOUR PROMPT - the notes added,
  // a field to change by hand, ✕ empties it; a chip whose text is in it is gold. "into <field>" adds it AFTER what the open
  // mode's own field holds, by a comma (Simple - In your words, Custom - Style, Lyrics - the idea, ElevenLabs - its
  // description, Sounds - the sound); in Custom a note of Exclude goes into Exclude and a note of the lyrics into Lyrics. The
  // prompt is never emptied by itself. It opens where it was left - the section, the note, the scroll and the prompt, kept in
  // the browser (`mv3_audio_alm_v1`, one for every page).
  const KEY_ALM = 'mv3_audio_alm_v1';
  const almSections = () => ((ALM && Array.isArray(ALM.SECTIONS)) ? ALM.SECTIONS.filter(s => s && s.label && Array.isArray(s.notes)) : []);
  const fieldLabel = (f) => (ALM && ALM.FIELDS && ALM.FIELDS[f] && ALM.FIELDS[f].label) || f;
  // The open mode's own field a prompt goes into: { key of S.f[mode], its name in the card }.
  const INTO = {
    simple: { key: 'words', label: 'In your words' }, custom: { key: 'style', label: 'Style' }, lyrics: { key: 'idea', label: 'The idea' },
    compose: { key: 'prompt', label: 'The music' }, video: { key: 'description', label: 'What you want' },
    sounds: { key: 'prompt', label: 'The sound' }, sfx: { key: 'prompt', label: 'The sound' },
  };
  // Text after text: by a comma, or by a blank line when either holds lines (a note of the lyrics).
  const _join = (cur, add) => {
    const c = String(cur || '').replace(/[\s,]+$/, '');
    const a = String(add || '').trim();
    if (!c.trim()) return a;
    if (!a) return c;
    return c + (/\n/.test(c) || /\n/.test(a) ? '\n\n' : ', ') + a;
  };
  // A text taken out of the prompt, the comma or the blank line around it with it.
  const _takeOut = (s, t) => {
    const i = String(s || '').indexOf(t);
    if (!t || i < 0) return s;
    const a = s.slice(0, i).replace(/[\s,]+$/, '');
    const b = s.slice(i + t.length).replace(/^[\s,]+/, '');
    const nl = /\n/.test(s.slice(a.length, i)) || /\n/.test(s.slice(i + t.length, s.length - b.length));
    return a && b ? a + (nl ? '\n\n' : ', ') + b : a || b;
  };

  /** The almanac's gold button, into the column's foot. */
  function almanacButton(foot) {
    const alm = el('button', 'mv3-vc-almanac' + (almSections().length ? '' : ' is-soon'), 'almanac');
    alm.type = 'button';
    alm.title = almSections().length ? 'Notes on styles and sounds - gather them into a prompt' : 'The almanac of music and sounds is being written - soon';
    alm.addEventListener('click', () => { if (almSections().length) openAlmanac(); else say('The almanac is being written (V34.A) - soon.'); });
    foot.appendChild(alm);
    return alm;
  }
  function closeAlmanac() { if (_almWin) _almWin.close(); }

  function openAlmanac() {
    if (_almWin) return;
    closeQ();
    const secs0 = almSections();
    const allNotes = secs0.flatMap(s => s.notes.map(n => Object.assign({ sec: s.id }, n)));
    const ov = el('div', 'aal-ov');
    const win = el('div', 'aal');
    win.setAttribute('role', 'dialog');
    const head = el('div', 'aal-head');
    head.appendChild(el('b', null, 'Almanac'));
    head.appendChild(el('span', 'aal-sub', 'music and sounds · press a chip to read it, "+ add" gathers it into your prompt' + (ALM.UPDATED ? ' · ' + ALM.UPDATED : '')));
    const x = el('button', 'aal-x', '✕');
    x.type = 'button';
    x.title = 'Close (Esc)';
    head.appendChild(x);
    const side = el('div', 'aal-side');
    const chips = el('div', 'aal-chips');
    const desc = el('div', 'aal-desc');
    const build = el('div', 'aal-build');
    const right = el('div', 'aal-right');
    right.append(chips, desc, build);
    const bodyEl = el('div', 'aal-body');
    bodyEl.append(side, right);
    win.append(head, bodyEl);
    ov.appendChild(win);
    document.body.appendChild(ov);

    // Where it was left: the section, the note pressed, how far the chips were scrolled, the prompt.
    const at = ls(KEY_ALM, {}) || {};
    const soundy = S.mode === 'sounds' || S.mode === 'sfx';
    let open = secs0.find(s => s.id && s.id === at.sec) || secs0.find(s => (s.group === 'sound') === soundy) || secs0[0];
    let noteId = open && at.sec === open.id && open.notes.some(n => n.id === at.note) ? at.note : '';
    let built = String(at.built || '');
    const remember = () => lsSet(KEY_ALM, { sec: open ? open.id : '', note: noteId, scroll: Math.round(chips.scrollTop), built });

    const layer = Layers.open(ov, { name: 'the audio almanac', onEsc: () => close() });
    const close = () => {
      remember();
      closeQ();
      ov.remove();
      Layers.close(layer);
      _almWin = null;
    };
    _almWin = { close };
    x.addEventListener('click', close);
    ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });
    let _st = 0;
    chips.addEventListener('scroll', () => { clearTimeout(_st); _st = setTimeout(remember, 250); });

    const inBuilt = (n) => !!n.text && built.includes(n.text);
    const paintSide = () => {
      side.textContent = '';
      for (const [g, label] of [['music', 'Music'], ['sound', 'Sounds']]) {
        const list = secs0.filter(s => s.group === g);
        if (!list.length) continue;
        side.appendChild(el('div', 'aal-g', label));
        for (const s of list) {
          const b = el('button', 'aal-sec' + (s === open ? ' on' : ''));
          b.type = 'button';
          b.appendChild(el('span', 'nm', s.label));
          b.appendChild(el('small', null, String(s.notes.length)));
          b.addEventListener('click', () => {
            if (s === open) return;
            open = s; noteId = '';
            paintSide(); paintChips(); paintDesc();
            chips.scrollTop = 0;
            remember();
          });
          side.appendChild(b);
        }
      }
    };
    const paintChips = () => {
      chips.textContent = '';
      if (!open) return;
      chips.appendChild(withQ(el('div', 'aal-title', open.label), open.about || ''));
      const cats = (open.cats || []).length ? open.cats : [{ id: '', label: '' }];
      for (const c of cats) {
        const list = open.notes.filter(n => !c.id || n.cat === c.id);
        if (!list.length) continue;
        if (c.label) chips.appendChild(el('div', 'aal-cat', c.label));
        const row = el('div', 'aal-row');
        for (const n of list) {
          const b = el('button', 'aal-chip' + (n.id === noteId ? ' on' : '') + (inBuilt(n) ? ' is-in' : '') + ((n.to || []).length ? '' : ' is-advice'), n.title);
          b.type = 'button';
          b.dataset.id = n.id;
          b.addEventListener('click', () => { noteId = n.id; paintChips(); paintDesc(); remember(); });
          row.appendChild(b);
        }
        chips.appendChild(row);
      }
    };
    // The gold of the chips whose text is in the prompt - again after every change of it.
    const markChips = () => {
      for (const b of chips.querySelectorAll('.aal-chip')) {
        const n = open && open.notes.find(y => y.id === b.dataset.id);
        b.classList.toggle('is-in', !!n && inBuilt(n));
      }
    };
    const paintDesc = () => {
      desc.textContent = '';
      const n = open && open.notes.find(y => y.id === noteId);
      if (!n) {
        desc.appendChild(el('div', 'aal-hint', 'Press a chip to read its note. "+ add" puts its words into your prompt below; dashed chips are advice - to read, nothing to add.'));
        return;
      }
      const h = el('div', 'aal-note-h');
      h.appendChild(el('b', null, n.title));
      const to = (n.to || []).map(fieldLabel);
      h.appendChild(el('span', 'aal-for', to.length ? 'for ' + to.join(', ') : 'advice'));
      h.appendChild(el('span', 'sp'));
      if (to.length) {
        const has = inBuilt(n);
        const add = el('button', 'aal-btn' + (has ? '' : ' is-primary'), has ? '− take out' : '+ add');
        add.type = 'button';
        add.title = has ? 'Take its words out of your prompt' : 'Add its words to your prompt below';
        add.addEventListener('click', () => {
          built = inBuilt(n) ? _takeOut(built, n.text) : _join(built, n.text);
          paintBuild(); markChips(); paintDesc(); remember();
        });
        h.appendChild(add);
      }
      const cp = el('button', 'aal-btn', 'copy');
      cp.type = 'button';
      cp.addEventListener('click', async () => {
        const ok = await copyText(n.text);
        cp.textContent = ok ? 'copied ✓' : 'not copied';
        setTimeout(() => { if (cp.isConnected) cp.textContent = 'copy'; }, 1400);
      });
      h.appendChild(cp);
      desc.appendChild(h);
      desc.appendChild(el('div', 'aal-text', n.text));
      if (n.why) desc.appendChild(el('div', 'aal-why', n.why));
      // What the note suggests for the knobs and the length - to set by hand; nothing is set by a press.
      const extra = [];
      if (n.set) extra.push(Object.entries(n.set).map(([k, v]) => k + ' ' + v).join(', '));
      if (n.seconds) extra.push(n.seconds + ' s');
      if (extra.length) desc.appendChild(el('div', 'aal-try', 'try ' + extra.join(' · ')));
    };

    // ── your prompt ──
    const bh = el('div', 'aal-build-h');
    bh.appendChild(withQ(el('span', 'aal-lbl', 'Your prompt'), 'The notes you add with "+ add" gather here - change the words by hand if you like.\n"into …" puts it after what the open mode\'s field holds, by a comma: Simple - In your words, Custom - Style (a note of Exclude into Exclude, of the lyrics into Lyrics), Lyrics - the idea, ElevenLabs - its description, Sounds - the sound; what the field holds already is not added twice.\nIt stays here until ✕ empties it.'));
    const said = el('span', 'aal-said');
    const sp = el('span', 'sp');
    const clear = el('button', 'aal-x aal-clear', '✕');
    clear.type = 'button';
    clear.title = 'Empty your prompt';
    const into = el('button', 'aal-btn is-primary aal-into');
    into.type = 'button';
    bh.append(said, sp, clear, into);
    const ta = el('textarea', 'aal-ta');
    ta.rows = 3;
    ta.placeholder = 'Empty - press a chip, then "+ add".';
    build.append(bh, ta);
    let _bt = 0;
    ta.addEventListener('input', () => {
      built = ta.value;
      paintInto(); markChips();
      clearTimeout(_bt); _bt = setTimeout(() => { remember(); paintDesc(); }, 300);
    });
    clear.addEventListener('click', () => { built = ''; paintBuild(); markChips(); paintDesc(); remember(); ta.focus(); });
    // A mood's preset (Simple on a mood folder) takes no words - nothing to write into.
    const target = () => (preset() ? null : INTO[S.mode] || null);
    const paintInto = () => {
      const t = target();
      into.textContent = t ? 'into ' + t.label : 'no field here';
      into.title = t ? '' : 'This mode has no field for words - a mood\'s preset goes to Suno as it is';
      into.disabled = !t || !built.trim();
      clear.disabled = !built;
    };
    const paintBuild = () => { if (ta.value !== built) ta.value = built; paintInto(); };
    let _saidT = 0;
    const tell = (t) => { said.textContent = t; clearTimeout(_saidT); _saidT = setTimeout(() => { said.textContent = ''; }, 2600); };
    into.addEventListener('click', () => {
      const t = target();
      const f = t && S.f[S.mode];
      if (!f || !built.trim()) return;
      // In Custom a note's own field when it has one there - Exclude, Lyrics; in a mode with no Exclude a note of Exclude
      // goes in as "without …", so the writer or the engine is not asked FOR it.
      let rest = built;
      const neg = [], lyr = [];
      for (const n of allNotes) {
        if (!n.text || !rest.includes(n.text)) continue;
        const to = n.to || [];
        const onlyNeg = to.length && to.every(k => k === 'negative');
        if (S.mode === 'custom' && onlyNeg) { neg.push(n.text); rest = _takeOut(rest, n.text); }
        else if (S.mode === 'custom' && to[0] === 'lyrics') { lyr.push(n.text); rest = _takeOut(rest, n.text); }
        else if (onlyNeg) rest = rest.replace(n.text, 'without ' + n.text);
      }
      // What the field holds already is not written twice - "into" pressed again adds nothing.
      const has = (k, t2) => String(f[k] || '').includes(t2);
      const went = [];
      if (rest.trim() && !has(t.key, rest.trim())) { f[t.key] = _join(f[t.key], rest.trim()); went.push(t.label); }
      const negNew = neg.filter(x => !has('negative', x));
      if (negNew.length) { f.negative = _join(f.negative, negNew.join(', ')); went.push('Exclude'); }
      const lyrNew = lyr.filter(x => !has('lyrics', x));
      if (lyrNew.length) { f.lyrics = [String(f.lyrics || '').trim(), ...lyrNew].filter(Boolean).join('\n\n'); went.push('Lyrics'); }
      save();
      call('paintMake');
      tell(went.length ? 'into ' + went.join(', ') + ' ✓' : 'it is there already');
    });

    paintSide();
    paintChips();
    paintDesc();
    paintBuild();
    // The scroll it was left at - once the chips are there.
    if (open && at.sec === open.id && +at.scroll > 0) chips.scrollTop = +at.scroll;
  }

  return {
    S, save, ready,
    cat: () => CAT, alm: () => ALM,
    moods, preset, chipGroups,
    modeSelect, modelSelect, lengthRows, chipRows,
    price, priceText, priceBox, paintPrice,
    field, text, check, knob,
    helpText, paintFields, body, press, lyricCard, resetEdit, carryEdit,
    saveButton, useLyric,
    almanacButton, closeAlmanac,
  };
}

/** A text onto the clipboard - true when it is there. */
export async function copyText(t) {
  try { await navigator.clipboard.writeText(String(t || '')); return true; } catch (e) { /* not allowed */ }
  // Without the clipboard API: a hidden field, selected and copied.
  try {
    const ta = el('textarea');
    ta.value = String(t || '');
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch (e) { return false; }
}
