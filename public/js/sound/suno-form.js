/* ═══════════════════════════════════════════════════════════════════════════
   SUNO'S FORM (phase V59, the owner 2026-10-29: "создать попап с генератором музыки как в merge. конкретно suno взять") -
   ONE constructor of Suno's music for two places:
     - Merge's "/ generate audio" (js/merge-v3/audchat.js) - which adds what is Merge's own: the engine switch and
       ElevenLabs, Sounds, Video to Music, "Made here", "by the video", the mode a project was left on;
     - the Library's window (js/library/music-window.js) - Simple, Custom and Lyrics, nothing else.

   What is here:
     the state of a page's form    remembered in the browser under the page's own key (Merge `mv3_audio_v1` as before)
     the catalog and the almanac    GET /api/audio/catalog, V34.A's public/js/audio/almanac-data.js - once per page
     the settings column's rows     the mode, Suno's model (V6 / V6_MINI / V6_WILD), a highlights mood (Simple), the
                                    length, the chips folded into Genre / Mood / Sound (one open at a time), the price,
                                    the almanac at the foot (a press on a note copies it)
     the constructor                Simple (the chips and the person's words, or a highlights mood's preset), Custom,
                                    Lyrics - their fields, their request (body), a press of "generate" (press)
     the lyrics' card               "use in custom", "save", "copy", "all"
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
// The length a mode takes: [lowest, highest, what the note under it says]; empty - the model decides.
const LEN = { simple: [0, 360, 'the video\'s length - the bed comes out a little longer'], custom: [10, 360, '10–360 s'],
  compose: [3, 600, '3 s – 10 min'], sfx: [0.5, 30, '0.5–30 s'] };

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
 *   o.setMode(id)      another mode chosen here ("write lyrics from an idea…", "use in custom", the mode's dropdown)
 *   o.videoSecs()      the video's length - "by the video (N s)" beside the length (Merge only)
 *   o.lengthNote(mode) what the length's note says (the Library has no video: not "the video's length")
 *   o.priceOf(mode, p) a price this form does not know how to say (Merge's Video to Music) - or null
 *   o.moods            false - no highlights moods here (the Library's window, phase V59.1: a mood's tracks are Merge's)
 *   o.compact          true - the Library's window (phase V59.1, (мз1а), (мз2а)): the settings column's grey notes are
 *                      hover hints, the length one line with its name on the left, the fields' hints on hover
 */
export function createSunoForm(o) {
  const S = Object.assign({ mode: 'simple', model: 'V6' }, o.base || {}, ls(o.store, {}));
  S.f = Object.assign({
    simple: { words: '', seconds: 30, writer: true, picked: { genre: [], mood: [], sound: [] }, flat: [], preset: '', pSeconds: 120, presetN: {} },
    custom: { title: '', style: '', lyrics: '', instrumental: false, vocal: '', negative: '', styleWeight: '', weirdness: '', variety: 0, seconds: 0 },
    lyrics: { idea: '' },
  }, o.fields || {}, S.f || {});
  const say = (t, bad) => { if (typeof o.say === 'function') o.say(t, bad); };
  const call = (name, ...a) => { if (typeof o[name] === 'function') return o[name](...a); return undefined; };
  const save = () => lsSet(o.store, typeof o.persist === 'function' ? o.persist(S) : { mode: S.mode, model: S.model, f: S.f });

  let _chipOpen = '';            // (phase V54) the one chip group open in the settings column - '' all folded
  let _priceBox = null;
  let _almWin = null;
  // (phase V59.1) A hover hint - only in the Library's window; Merge's look stays as it was.
  const tip = (node, t) => { if (o.compact && node && t) node.title = t; return node; };

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
    if (o.moods === false) return [];
    const fromCat = (CAT && Array.isArray(CAT.moods)) ? CAT.moods : [];
    const P = (ALM && Array.isArray(ALM.HIGHLIGHT_PRESETS)) ? ALM.HIGHLIGHT_PRESETS : [];
    return fromCat.map(m => Object.assign({}, P.find(x => x.id === m.id) || {}, m));
  }
  const preset = () => (S.mode === 'simple' && S.f.simple.preset ? moods().find(m => m.id === S.f.simple.preset) || null : null);

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

  // ── the settings column's rows ────────────────────────────────────────────
  /** The mode's dropdown, of `modes` (the catalog's records). */
  function modeSelect(modes) {
    const ms = el('select');
    for (const m of modes || []) {
      const op = el('option', null, m.label);
      op.value = m.id;
      ms.appendChild(op);
    }
    ms.value = S.mode;
    ms.addEventListener('change', () => call('setMode', ms.value));
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
    return tip(mo, 'Suno\'s model - one price for all three.');
  }
  // (phase V34.F, the owner's (ф3)) A HIGHLIGHTS MOOD in place of the chips: one of the ten presets, written by its own rule,
  // and the two tracks are filed into Music -> highlights -> that mood - what the highlights popup offers.
  function moodRow(row) {
    if (S.mode !== 'simple' || !moods().length) return;
    const f = S.f.simple;
    const sel = el('select');
    const none = el('option', null, '— none: the chips and your words —');
    none.value = '';
    sel.appendChild(none);
    for (const m of moods()) {
      const op = el('option', null, m.label);
      op.value = m.id;
      op.title = m.about || '';
      sel.appendChild(op);
    }
    sel.value = preset() ? f.preset : '';
    sel.addEventListener('change', () => { f.preset = sel.value; save(); call('paintCol'); call('paintMake'); });
    const p = preset();
    row('Highlights mood', sel, p ? 'into Music → highlights → ' + p.label : 'for the highlights popup: a mood\'s preset, filed into its folder');
  }
  // The length: what a mode takes, empty - the model decides.
  function lengthRows(row, sep) {
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
    if (o.compact) {
      // (phase V59.1, the owner: "lenght - название параметра поместить слева от поля") One line - "Length [46] s" -, what
      // it means on hover.
      const one = el('div', 'au-len au-len-one');
      one.append(el('label', null, 'Length'), n, el('span', 'au-len-auto', 's'));
      one.title = note.charAt(0).toUpperCase() + note.slice(1) + '. Empty - the model decides.';
      row('', one);
      return;
    }
    sep('Length');
    const r = el('div', 'au-len');
    r.append(n, el('span', 'au-len-auto', 's · empty - the model decides'));
    const vs = +call('videoSecs') || 0;
    if (vs > 0 && S.mode !== 'sfx' && !mood) {
      const by = el('button', 'au-link', 'by the video (' + secs(vs) + ')');
      by.type = 'button';
      by.addEventListener('click', () => { f.seconds = Math.max(lo || 1, Math.min(hi, Math.round(vs))); save(); call('paintCol'); call('paintMakePrice'); });
      r.appendChild(by);
    }
    row('', r, note);
  }
  // The chips: in Simple they ARE the request; in Custom and ElevenLabs' music a chip adds its words to the text.
  // (phase V54, block 7, the owner 2026-10-27: "чтобы они были свернутыми дропдаунами и открыт может быть только один из
  // них") Each group is a FOLDED ROW - its name and, in Simple, what is picked in it ("Genre · Lo-fi, Jazz"); a press opens
  // it and folds the one open before.
  function chipRows(col) {
    if (!['simple', 'custom', 'compose'].includes(S.mode) || preset()) return;
    const why = S.mode === 'simple' ? 'What the music is: the writer reads them with your words.'
      : 'A press adds the chip\'s words to the ' + (S.mode === 'custom' ? 'style' : 'description') + '.';
    for (const g of chipGroups()) {
      const gk = g.key || g.label;
      const open = _chipOpen === gk;
      const picked = S.mode === 'simple' ? g.chips.filter(c => isPicked(g.key, c)).map(c => c.label) : [];
      const head = el('button', 'au-chips-h' + (open ? ' is-open' : '') + (picked.length ? ' has-picked' : ''));
      head.type = 'button';
      head.setAttribute('aria-expanded', open ? 'true' : 'false');
      head.appendChild(el('span', 'au-chips-tw', '▸'));
      head.appendChild(el('b', null, g.label));
      head.appendChild(el('span', 'au-chips-sel', picked.length ? '· ' + picked.join(', ') : ''));
      head.appendChild(el('span', 'au-chips-n', String(g.chips.length)));
      head.title = (o.compact ? why + '\n' : '') + (open ? 'Fold ' : 'Open ') + g.label + (picked.length ? ' - picked: ' + picked.join(', ') : '');
      head.addEventListener('click', () => { _chipOpen = open ? '' : gk; call('paintCol'); });
      col.appendChild(head);
      if (!open) continue;
      const wrap = el('div', 'mv3-chips au-chips-open');
      for (const c of g.chips) {
        const on = S.mode === 'simple' && isPicked(g.key, c);
        const b = el('button', 'mv3-chip' + (on ? ' on' : ''), c.label);
        b.type = 'button';
        b.title = (o.compact && S.mode !== 'simple' ? 'Adds: ' : '') + c.style;
        b.addEventListener('click', () => {
          if (S.mode === 'simple') { pick(g.key, c); call('paintCol'); call('paintMake'); }
          else addWords(c.style);
        });
        wrap.appendChild(b);
      }
      col.appendChild(wrap);
    }
    if (!o.compact) col.appendChild(el('div', 'au-note', why));
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
  function field(label, input, opts) {
    const op = opts || {};
    const f = el('div', 'au-f');
    const h = el('div', 'au-f-h');
    h.appendChild(document.createTextNode(label));
    if (op.small) h.appendChild(el('small', null, op.small));
    if (op.max) {
      const cnt = el('span', 'au-cnt');
      const upd = () => { const n = String(input.value || '').length; cnt.textContent = n + ' / ' + op.max; cnt.classList.toggle('is-over', n > op.max); };
      input.addEventListener('input', upd);
      upd();
      h.appendChild(cnt);
    }
    f.append(h, input);
    tip(h, op.tip);
    tip(input, op.tip);
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
  function check(obj, key, label, after) {
    const lab = el('label', 'au-check');
    const c = el('input');
    c.type = 'checkbox';
    c.checked = !!obj[key];
    c.addEventListener('change', () => { obj[key] = c.checked; save(); if (after) after(); });
    lab.append(c, el('span', null, label));
    return lab;
  }
  function knob(obj, key, label, min, max, step, hint) {
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

  /** The words under the card's head: a mood's, or the mode's own (`into` - where its tracks go). null - not a mode of
   *  this form. */
  function helpText(into) {
    const p = preset();
    if (p) return 'Background music for highlights in one mood: its preset goes to Suno as it is, and Suno makes TWO tracks. They go to Music → highlights → ' + p.label + ', and the highlights popup offers them. Each press turns one colour of the mood, so the next tracks differ.';
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
      if (mood.style) box.appendChild(el('div', 'au-preset-style', mood.style));
      box.appendChild(el('div', 'au-muted', 'press ' + (n + 1) + ' of this mood' + (Array.isArray(mood.vary) && mood.vary.length
        ? ' - with a touch of ' + mood.vary[n % mood.vary.length] : '') + ' · two tracks into Music → highlights → ' + mood.label));
      card.appendChild(field('The mood', box));
      return true;
    }
    if (S.mode === 'simple') {
      const picked = pickedLabels();
      const row = el('div', 'au-picked');
      if (picked.length) for (const p of picked) row.appendChild(el('span', 'au-chip on', p));
      else row.appendChild(el('span', null, 'No chips yet - pick the genre, the mood and the sound on the left.'));
      card.appendChild(field('The feel', row, { tip: 'The chips picked on the left - the genre, the mood and the sound.' }));
      card.appendChild(field('In your words', text(f, 'words', { area: true, rows: 3, placeholder: 'e.g. soft and warm under a skincare review, nothing that pulls the ear away from the voice' }), { small: 'any language · optional', max: 1000, tip: 'More about the feel, in any language - the writer reads it with the chips.' }));
      card.appendChild(tip(check(f, 'writer', 'the writer makes Suno\'s style of it (off - the chips go as they are)'), 'The writer turns the chips and your words into Suno\'s style. Off - the chips go to Suno as they are.'));
      return true;
    }
    if (S.mode === 'custom') {
      card.appendChild(field('Title', text(f, 'title', { placeholder: 'the track\'s name' }), { max: 80, tip: 'The track\'s name - both tracks are called by it.' }));
      card.appendChild(field('Style', text(f, 'style', { area: true, rows: 3, placeholder: 'genre, mood, instruments, tempo, production - e.g. indie pop, bright clean guitars, 110 BPM, warm female vocal' }), { max: 1000, tip: 'Genre, mood, instruments, tempo, production. A chip on the left adds its words here.' }));
      card.appendChild(tip(check(f, 'instrumental', 'instrumental - no voice, no lyrics', () => call('paintMake')), 'Only the music: no voice and no lyrics.'));
      if (!f.instrumental) {
        const ly = text(f, 'lyrics', { area: true, rows: 7, placeholder: '[Verse]\n...\n[Chorus]\n...' });
        const fl = field('Lyrics', ly, { max: 5000, small: 'empty - Suno sings what it makes up', tip: 'What is sung, in parts: [Verse], [Chorus]… Up to 5000 characters. Empty - Suno sings what it makes up.' });
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
        links.append(wr, saveOwn(f, ly));
        fl.appendChild(links);
        card.appendChild(fl);
        const vs = el('select', 'au-sel');
        for (const [v, t] of [['', 'any voice'], ['f', 'a woman\'s voice (likelier)'], ['m', 'a man\'s voice (likelier)']]) { const op = el('option', null, t); op.value = v; vs.appendChild(op); }
        vs.value = f.vocal || '';
        vs.addEventListener('change', () => { f.vocal = vs.value; save(); });
        card.appendChild(field('Voice', vs));
      }
      card.appendChild(field('Keep out', text(f, 'negative', { placeholder: 'e.g. heavy metal, distortion, choir' }), { small: 'styles Suno should avoid', max: 500 }));
      const kn = el('details', 'au-knobs');
      kn.appendChild(el('summary', null, 'fine-tuning (Suno\'s own when untouched)'));
      kn.appendChild(knob(f, 'styleWeight', 'hold the style', 0, 1, 0.05, 'how closely it keeps to the style'));
      kn.appendChild(knob(f, 'weirdness', 'weirdness', 0, 1, 0.05, 'how far it may wander'));
      kn.appendChild(knob(f, 'variety', 'variety', 0, 4, 1, '0 - your style as written (V6 rewrites it at 1 and up) · 4 max: how different the two tracks are'));
      card.appendChild(kn);
      return true;
    }
    if (S.mode === 'lyrics') {
      card.appendChild(field('The idea', text(f, 'idea', { area: true, rows: 2, placeholder: 'e.g. a hopeful song about the first coffee of the morning' }), { max: 200, tip: 'What the song is about - Suno writes two or three texts from it.' }));
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
    sel.title = 'Lyrics kept in Music → Lyrics: a choice replaces the text below; the title is taken only when it is empty.';
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
    if (S.mode === 'simple' && preset()) {
      // (V34.F) A highlights mood: its preset and which press of it this is; the chips and the words stay out.
      b.preset = f.preset;
      b.n = (f.presetN || {})[f.preset] || 0;
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
      // The next press of this mood turns another of its colours.
      const f = S.f.simple;
      f.presetN = f.presetN || {};
      f.presetN[b.preset] = (f.presetN[b.preset] || 0) + 1;
      save();
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
  // Its SECTIONS in two groups (Music, Sounds) on the left, the open one's categories under it, its NOTES on the right.
  // (phase V34.F, the owner 2026-10-23, (т6)-(т9), (у5)) A press on a note COPIES its text - "copied" on the note - and is
  // pasted by the person where it is wanted: nothing is written into a field, no knob is set. No sources under the notes. A
  // press anywhere outside the window closes it, as Escape and its cross do; it opens again where it was left - the same
  // section, category and scroll (kept in the browser, `mv3_audio_alm_v1` - one for every page).
  const KEY_ALM = 'mv3_audio_alm_v1';
  const almSections = () => ((ALM && Array.isArray(ALM.SECTIONS)) ? ALM.SECTIONS.filter(s => s && s.label && Array.isArray(s.notes)) : []);
  const fieldLabel = (f) => (ALM && ALM.FIELDS && ALM.FIELDS[f] && ALM.FIELDS[f].label) || f;

  /** The almanac's gold button, into the column's foot. */
  function almanacButton(foot) {
    const alm = el('button', 'mv3-vc-almanac' + (almSections().length ? '' : ' is-soon'), 'almanac');
    alm.type = 'button';
    alm.title = almSections().length ? 'Notes on styles and sounds - a press on a note copies it' : 'The almanac of music and sounds is being written - soon';
    alm.addEventListener('click', () => { if (almSections().length) openAlmanac(alm); else say('The almanac is being written (V34.A) - soon.'); });
    foot.appendChild(alm);
    return alm;
  }
  function closeAlmanac() { if (_almWin) _almWin.close(); }

  function openAlmanac(anchor) {
    if (_almWin) { _almWin.close(); return; }
    const secs0 = almSections();
    const win = el('div', 'hp au-alm');
    const head = el('div', 'hp-head');
    head.appendChild(el('b', null, 'Almanac'));
    head.appendChild(el('span', 'hp-sub', 'music and sounds · a press copies a note - paste it where you want it' + (ALM.UPDATED ? ' · ' + ALM.UPDATED : '')));
    const x = el('button', 'hp-x', '✕');
    x.type = 'button';
    head.appendChild(x);
    win.appendChild(head);
    const bodyEl = el('div', 'hp-body');
    const side = el('div', 'hp-side');
    const main = el('div', 'au-alm-main');
    bodyEl.append(side, main);
    win.appendChild(bodyEl);
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
        const to = (n.to || []).map(fieldLabel);
        h.appendChild(el('span', 'au-muted', to.length ? 'for ' + to.join(', ') : 'advice'));
        h.appendChild(el('span', 'au-copied', 'copied'));
        b.appendChild(h);
        b.appendChild(el('div', 'au-alm-text', n.text));
        if (n.why) b.appendChild(el('div', 'au-said', n.why));
        // What the note suggests for the knobs and the length - to set by hand; nothing is set by the press.
        const extra = [];
        if (n.set) extra.push(Object.entries(n.set).map(([k, v]) => k + ' ' + v).join(', '));
        if (n.seconds) extra.push(n.seconds + ' s');
        if (extra.length) b.appendChild(el('div', 'au-muted au-alm-set', 'try ' + extra.join(' · ')));
        b.addEventListener('click', async () => {
          const ok = await copyText(n.text);
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

  return {
    S, save, ready,
    cat: () => CAT, alm: () => ALM,
    moods, preset, chipGroups,
    modeSelect, modelSelect, moodRow, lengthRows, chipRows,
    price, priceText, priceBox, paintPrice,
    field, text, check, knob,
    helpText, paintFields, body, press, lyricCard,
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
