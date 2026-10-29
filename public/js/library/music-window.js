/* ═══════════════════════════════════════════════════════════════════════════
   THE LIBRARY'S MUSIC WINDOW (phase V59, the owner 2026-10-29: "надо бы еще попап с генератором музыки вложить в library.
   по аналогии с окружениями и лукбуками ... конкретно suno взять и в попап сделать генератор музыки в library") - Suno's
   generator in a window over the Media shelf (js/gen-window.js openFrame), the gallery and the tree staying where they are
   behind it. Phase V59.1 (the owner 2026-10-29, after the first look; (мз1а)-(мз9а)) gave it its present shape:

     head     the MODE's name - "Suno · Simple · background, no vocals" / "Suno · Custom · title, style, lyrics" /
              "Suno · Lyrics" - and a "?" right of it: the pointer resting on it shows how the mode works (phase V60,
              (пп11а): js/sound/qmark.js, on the stack of layers - once a press)
     left     the settings: the mode (Simple, Custom, Lyrics - (мг1а): no Sounds, they lie in SFX), Suno's model (V6 /
              V6_MINI / V6_WILD, remembered - (мг10а)), "Length [46] s" in one line, the folded chips; every row's name
              and every field of the card has its "?" (phase V60, (пп10а) - the hints on whole rows went). No price box.
              Its width is the person's - the sash right of it, remembered (`lib_music_sash_v1`)
     right    the gold card - the mode's fields only (js/sound/suno-form.js, the one Merge's "/ generate audio" is built
              from); in Lyrics the texts under it, a row each (▸ title - text): the last press's open, the earlier
              presses of this window folded below, the newest on top; each with "save" (Music -> Lyrics), "use in
              custom", "copy"
     foot     under the right column: ALMANAC on the left, the line of the last press ("in Alerts · …"), and at the
              right edge where the tracks go ("into Music → Pop"), the price and "generate" ("write the lyrics")

   1100×720, smaller on a smaller screen ((мз4а)).

   NO "MADE HERE" ((мг5б)): the window stays open after "generate", says the press is in Alerts, and what Suno makes lands in
   the gallery behind it - the opener reads the tree and the gallery again and outlines the new tracks while their folder is
   open (`onLanded`). WHERE THEY GO ((мг4а)): the folder under Music the window was opened on - Music itself, or a folder of
   the person's in it; highlights and Lyrics open - Music's root, and the foot says why (lib/audio-gens.js `_intoOf`, the
   server's rule). A MOOD FOLDER open (Music → highlights → <mood>; phase V60, (пп9а) - Merge makes no moods any more):
   Simple makes that mood - its preset, no chips, no words, the card says so -, and the tracks go into that folder (the
   server files a preset's tracks there, lib/music-store.js `place`); Custom there goes to Music's root. (phase V60.1,
   (пк6а)-(пк8а)) "edit" on that card shows the preset's Style and Exclude to change - for ONE press: after "generate" or a
   new opening of this window it is the standard preset again (js/sound/suno-form.js `resetEdit`); the press sends
   `presetEdit`, the title, the mood's `vary` and its folder stay the preset's. Simple's writer
   writes as for a blank project (lib/audio-writer-rules.js). The Alerts row
   leads to that folder with the press's tracks outlined once they are filed (js/alerts-bell.js _hrefOf, `where.spot.view`
   'musicmake'), to the folder alone while it runs or when it failed.

     open(o)    o: { place() -> the folder open { key, cat?, folder?, label, trail? }, anchor, onLanded(gen, dest),
                onSaved(), onClose, lyric? { title, text } - opened on Custom with that text (the event `ugc:lyric-use`) }
     follow(o)  the presses of this window still being made (a reload, the window closed) are followed with `o`'s onLanded
   What the person set is remembered in the browser (`lib_music_v1`).
   ═══════════════════════════════════════════════════════════════════════════ */

import { openFrame } from '../gen-window.js';
import { createSunoForm, el, api, ls, lsSet, copyText, titleOf, qmark, withQ, closeQ, modeRowHelp, MODEL_ROW_HELP } from '../sound/suno-form.js';

const MODES = ['simple', 'custom', 'lyrics'];
const VIEW = 'musicmake';
const KEY = 'lib_music_v1';
const KEY_SASH = 'lib_music_sash_v1';
const SIZE = { w: 1100, h: 720 };             // (мз4а)
const SET_W = 260, SET_MIN = 200, SET_MAX = 460, RIGHT_MIN = 480;
const LYR_MAX = 12;                           // the presses of Lyrics shown

let F = null;              // the form - made at the first open, kept for the page
let _win = null;           // the window, while it is open
let _ui = null;            // its parts
let _o = {};               // the opener's hooks - kept after the window closes: a press lands whether or not it is open
let _going = false;
const _runs = new Map();   // id -> { gen, dest } - the presses of this window being followed
let _last = null;          // { gen, dest } - the last press: its line in the foot
let _err = '';             // the last press refused before it started - said in the foot until the next one
let _lyricGens = [];       // this window's Lyrics records that wrote texts, newest first
const _rowOpen = new Map(); // a text's row the person opened or folded: `<gen>:<i>` -> true / false
let _looked = false;       // the server asked once for presses of this window still being made
let _timer = 0;

const S = () => F.S;
const _mode = () => (F.cat() ? F.cat().modes.find(x => x.id === S().mode) : null);
// (phase V60, (пп9а)) The mood folder the window is open on (Music → highlights → <mood>) - its id, '' for any other folder.
function _moodOpen() {
  const p = (typeof _o.place === 'function' ? _o.place() : null) || null;
  const m = /^music:highlights:(.+)$/.exec(String((p && p.key) || ''));
  return m && F && F.moods().some(x => x.id === m[1]) ? m[1] : '';
}

// (phase V60.2, the owner 2026-10-29: "а вот lyrics убираем из дропдауна если генерируем трек настроений"; (ми7а), (ми8а))
// On a mood folder the modes are Simple and Custom, and the window opens there on Simple - the mood's own generator. The
// mode remembered for the other folders (`_rest`) is not changed by what is chosen on a mood folder: the form writes it,
// not the mode of the moment, while a mood folder is open.
const _modes = () => (_moodOpen() ? MODES.filter(m => m !== 'lyrics') : MODES);
let _rest = '';            // the mode remembered for the folders that are not a mood's
let _placeKey = null;      // the folder the window was last fitted to

function _form() {
  if (F) return F;
  F = createSunoForm({
    store: KEY, title: 'Generate music',
    base: { mode: 'simple' },
    mood: () => _moodOpen(),
    lyricsOff: () => !!_moodOpen(),
    say: (t, bad) => _say(t, bad),
    paintCol: () => paintCol(),
    paintMake: () => paintMake(),
    paintMakePrice: () => paintFoot(),
    setMode: (id, how) => setMode(id, how),
    persist: (st) => ({ mode: _moodOpen() ? (_rest || 'simple') : st.mode, model: st.model, f: st.f }),
    onSaved: () => { if (typeof _o.onSaved === 'function') _o.onSaved(); if (_ui && S().mode === 'lyrics') paintMake(); },
    // No video here: the length is said in seconds.
    lengthNote: (mode) => (mode === 'simple' ? 'up to 360 s - the bed comes out a little longer' : mode === 'custom' ? '10–360 s' : ''),
  });
  if (!MODES.includes(F.S.mode)) F.S.mode = 'simple';
  _rest = F.S.mode;
  return F;
}

// The mode fitted to the folder the window is opened on: a mood's - Simple; another - the mode remembered for them.
function _fitMode() {
  const p = (typeof _o.place === 'function' ? _o.place() : null) || null;
  const key = String((p && p.key) || '');
  if (key === _placeKey) return;
  _placeKey = key;
  if (_moodOpen()) S().mode = 'simple';
  else if (_rest && MODES.includes(_rest)) S().mode = _rest;
}

function setMode(id, how) {
  if (!_modes().includes(id)) return;
  // (phase V60.2, (ми2а)-(ми4а)) Custom picked while the mood's card is in "edit": its Style and Exclude go with it.
  const carried = id === 'custom' && how === 'pick' && F.carryEdit();
  S().mode = id;
  if (!_moodOpen()) _rest = id;
  F.save();
  _err = '';
  paint();
  if (carried) _say('The mood\'s Style and Exclude are in Custom - its tracks go into Music → highlights.');
}
function paint() {
  paintHead();
  paintCol();
  paintMake();
  paintFoot();
}

let _sayT = 0;
function _say(text, bad) {
  if (!_ui) return;
  const s = _ui.status;
  s.textContent = text || '';
  s.hidden = !text;
  s.classList.toggle('is-bad', !!bad);
  clearTimeout(_sayT);
  if (text && !bad) _sayT = setTimeout(() => { if (s.textContent === text) { s.textContent = ''; s.hidden = true; } }, 9000);
}

// ── where the tracks go ─────────────────────────────────────────────────────
// { node: the tree's key of the folder they lie in, into: the folder's id for the server ('' - Music's root),
//   label: its path in words, note: why it is not the folder open }.
function _dest() {
  const p = (typeof _o.place === 'function' ? _o.place() : null) || null;
  if (S().mode === 'lyrics') return { node: p && p.key ? p.key : 'music', into: '', label: '' };
  const key = String((p && p.key) || '');
  const hl = /^music:highlights(:|$)/.test(key) || (p && p.folder === 'highlights');
  const lyr = key === 'music:lyrics';
  if (p && p.cat && !hl && !lyr) return { node: key, into: p.cat, label: 'Music → ' + (p.trail || p.label) };
  // (phase V60, (пп9а)) A mood folder open: Simple makes its mood, and the server files the tracks there.
  const mood = F.preset();
  if (mood) return { node: key, into: '', label: 'Music → highlights → ' + mood.label };
  // (phase V60.2, (ми6а)) Custom on a mood folder: into highlights itself - the highlights popup offers it; the mood folder
  // keeps only what its preset made (the owner's (ф3)).
  if (_moodOpen()) return { node: 'music:highlights', into: 'highlights', label: 'Music → highlights' };
  return { node: 'music', into: '', label: 'Music',
    note: hl ? 'highlights takes only a mood\'s preset - open a mood\'s folder' : lyr ? 'Lyrics holds texts only' : '' };
}

// ── the head: the mode's name and its "?" ───────────────────────────────────
// (phase V60, (пп11а)) The mode's instruction - what the gold card used to say - in the "?" right of its name, on the pointer
// resting there (js/sound/qmark.js), as every "?" of the form.
function paintHead() {
  if (!_win || !_win.alive()) return;
  closeQ();
  const m = _mode();
  _win.setCrumbs([{ label: 'Suno · ' + (m ? m.label : 'music') }]);
  _win.crumbs.appendChild(qmark(() => F.helpText('AUDIO → ' + (_dest().label || 'Music')) || '',
    { title: 'Suno · ' + (m ? m.label : '') }));
}

// ── the settings column ─────────────────────────────────────────────────────
function paintCol() {
  if (!_ui || !F.cat()) return;
  const CAT = F.cat();
  const col = _ui.col;
  col.textContent = '';
  const row = (label, body, help, warn) => {
    const r = el('div', 'mv3-ig-row');
    if (label) r.appendChild(withQ(el('label', null, label), help));
    r.appendChild(body);
    if (warn) r.appendChild(el('div', 'au-note', warn));
    col.appendChild(r);
    return r;
  };
  // A missing key stays in words: it is why nothing would come.
  const modes = CAT.modes.filter(m => _modes().includes(m.id));
  row('Mode', F.modeSelect(modes), modeRowHelp(modes),
    CAT.keys && !CAT.keys.kie && !CAT.fake ? 'No kie.ai key - add it on Admin → API keys.' : '');
  if (S().mode !== 'lyrics') row('Model', F.modelSelect(), MODEL_ROW_HELP);
  F.lengthRows(row);
  F.chipRows(col);
}

// ── the right column: the gold card, and Lyrics' texts under it ────────────────
function paintMake() {
  if (!_ui || !F.cat()) return;
  const host = _ui.make;
  host.textContent = '';
  if (!_mode()) return;
  const card = el('div', 'au-card');
  F.paintFields(card);
  host.appendChild(card);
  if (S().mode === 'lyrics') host.appendChild(_lyricsList());
}

// (мз5а) Every Lyrics press of this window: the last one's texts open, the earlier ones folded below, the newest on top.
function _lyricsList() {
  const box = el('div', 'au-lyrs');
  const gens = _lyricGens.slice(0, LYR_MAX);
  if (!gens.length) {
    box.appendChild(el('div', 'au-note', 'The texts come here - a row each, to save into Music → Lyrics or to use in Custom.'));
    return box;
  }
  gens.forEach((g, gi) => {
    const grp = el('div', 'au-lyr-g');
    grp.appendChild(el('div', 'au-made-h', (gi ? 'written ' : 'written last · ') + _when(g.doneAt || g.at) + (g.said ? ' · ' + g.said : '')));
    (g.lyrics || []).forEach((l, i) => grp.appendChild(_lyricRow(l, g, gi === 0, g.id + ':' + i)));
    box.appendChild(grp);
  });
  return box;
}
function _lyricRow(l, g, latest, key) {
  const open = _rowOpen.has(key) ? _rowOpen.get(key) : latest;
  const row = el('div', 'au-lr' + (open ? ' is-open' : ''));
  const h = el('div', 'au-lr-h');
  const t = el('button', 'au-lr-t');
  t.type = 'button';
  t.title = 'Open or fold the text';
  const peek = String(l.text || '').split('\n').map(s => s.trim()).filter(s => s && !/^\[[^\]]*\]$/.test(s)).slice(0, 2).join(' / ');
  t.append(el('span', 'au-chips-tw', '▸'), el('b', null, l.title || titleOf(l.text)), el('span', 'au-lr-peek', peek ? '— ' + peek : ''));
  t.addEventListener('click', () => {
    const now = !row.classList.contains('is-open');
    _rowOpen.set(key, now);
    row.classList.toggle('is-open', now);
  });
  const use = el('button', 'au-link', 'use in custom');
  use.type = 'button';
  use.addEventListener('click', () => F.useLyric(l));
  const copy = el('button', 'au-link', 'copy');
  copy.type = 'button';
  copy.addEventListener('click', async () => { const ok = await copyText(l.text); _say(ok ? 'Copied.' : 'Not copied - the clipboard refused it.', !ok); });
  h.append(t, F.saveButton(l, g), use, copy);
  row.append(h, el('pre', 'au-lr-text', l.text || ''));
  return row;
}
function _when(iso) {
  const d = new Date(iso || Date.now());
  if (isNaN(d)) return '';
  const hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  const now = new Date();
  return d.toDateString() === now.toDateString() ? hm : String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0') + ' ' + hm;
}

// ── the foot: ALMANAC, the line of the last press, where the tracks go, the price, "generate" ─────────────────────────
function paintFoot() {
  if (!_ui) return;
  const lyr = S().mode === 'lyrics';
  const d = _dest();
  const into = lyr ? 'texts only · save → Music → Lyrics' : 'into ' + d.label + (d.note ? ' - ' + d.note : '');
  _ui.into.textContent = into;
  _ui.into.title = lyr ? 'Texts only - nothing is filed by itself; "save" keeps a text in Music → Lyrics' : into;
  const p = F.price();
  _ui.price.textContent = '';
  if (p.big) {
    _ui.price.appendChild(el('b', null, p.big));
    _ui.price.appendChild(el('span', null, p.small + (F.cat() && F.cat().fake ? ' · FAKE' : '')));
  }
  _ui.price.title = p.big ? 'per press · ' + p.big + ' · ' + p.small : '';
  _ui.go.textContent = lyr ? 'write the lyrics' : 'generate';
  _paintLine();
}

// The line of the last press: where it is in Alerts, what came of it - or why it did not start.
function _paintLine() {
  const line = _ui && _ui.line;
  if (!line) return;
  line.className = 'au-line';
  if (_err) { line.textContent = _err; line.title = _err; line.classList.add('is-bad'); return; }
  const r = _last;
  const g = r && r.gen;
  line.textContent = '';
  line.title = '';
  if (!g) return;
  const lyr = g.kind === 'lyrics';
  let t;
  if (g.state === 'pending') {
    t = (lyr ? 'writing the lyrics' : 'in Alerts · ' + (g.stage || (g.taskId ? 'Suno is making it' : 'starting'))) + '…';
    line.classList.add('is-on');
  } else if (g.state === 'done') {
    const n = (g.results || []).length;
    t = lyr ? 'the lyrics are written - ' + (S().mode === 'lyrics' ? 'above' : 'in Lyrics')
      : 'in Alerts · done - ' + n + ' track' + (n === 1 ? '' : 's') + ' in ' + (r.dest.label || 'Music');
  } else {
    t = (lyr ? '' : 'in Alerts · ') + (g.refused ? 'refused' : 'failed') + ' - ' + (g.error || 'it did not come');
    line.classList.add('is-bad');
  }
  line.textContent = t;
  line.title = t;
}

async function _generate(btn) {
  if (_going || !F.cat()) return;
  _going = true;
  btn.disabled = true;
  _err = '';
  _paintLine();
  try {
    const b = F.body('blank');
    if (!b) throw new Error('nothing to ask for in this mode');
    const d = _dest();
    const m = _mode();
    // The Alerts row keeps `spot`'s key, view and step (lib/alerts.js): the key is the tree's key of the folder; the words of
    // it stay on the record of the press (lib/audio-gens.js keeps `where` as it is) for the line after a reload.
    b.where = {
      page: 'library', href: '/library?shelf=media&kind=' + encodeURIComponent(d.node),
      label: 'Library · ' + (d.label || 'Generate music') + ' · ' + (m ? m.label : S().mode), spot: { view: VIEW, key: d.node, label: d.label },
    };
    if (d.into) b.into = d.into;
    const r = await F.press(b);
    _track(r.gen, d);
  } catch (e) {
    _err = e.message;
    _paintLine();
  } finally {
    _going = false;
    btn.disabled = false;
  }
}

// ── following what was pressed ──────────────────────────────────────────────
function _track(gen, dest) {
  if (!gen || !gen.id) return;
  _last = { gen, dest };
  if (gen.state === 'pending') _runs.set(gen.id, { gen, dest });
  _paintLine();
  _tick();
}
function _tick() {
  if (!_timer && _runs.size) _timer = setTimeout(_poll, 3000);
}
function _addLyrics(g) {
  if (!g || g.kind !== 'lyrics' || g.state !== 'done' || !(g.lyrics || []).length) return false;
  _lyricGens = [g, ..._lyricGens.filter(x => x.id !== g.id)]
    .sort((a, b) => String(b.doneAt || b.at || '').localeCompare(String(a.doneAt || a.at || '')));
  return true;
}
async function _poll() {
  _timer = 0;
  let lyricsCame = false;
  for (const [id, r] of [..._runs]) {
    let g;
    try { g = (await api('/api/audio/gens/' + encodeURIComponent(id))).gen; }
    catch (e) { if (/not found/i.test(e.message)) _runs.delete(id); continue; }
    r.gen = g;
    if (_last && _last.gen.id === id) _last.gen = g;
    if (g.state === 'pending') continue;
    _runs.delete(id);
    if (g.kind === 'lyrics') { if (_addLyrics(g)) lyricsCame = true; }
    else if (g.state === 'done' && typeof _o.onLanded === 'function') {
      try { await _o.onLanded(g, r.dest); } catch (e) { /* the opener's */ }
    }
  }
  if (lyricsCame && _ui && S().mode === 'lyrics') paintMake();
  _paintLine();
  _tick();
}

// The presses of this window the server is still making - after a reload, or with the window closed and opened again -
// are followed to their end; and the texts Lyrics wrote here are shown again. Asked once per page.
async function _pickUp() {
  if (_looked) return;
  _looked = true;
  let items = [];
  try { items = (await api('/api/audio/gens?limit=60')).items || []; } catch (e) { return; }
  const mine = items.filter(g => g && g.where && g.where.page === 'library' && g.where.spot && g.where.spot.view === VIEW);
  const destOf = (g) => ({ node: g.where.spot.key || 'music', into: g.into || '', label: g.where.spot.label || '' });
  for (const g of mine.slice().reverse()) {
    if (g.state === 'pending' && !_runs.has(g.id)) _track(g, destOf(g));
    _addLyrics(g);
  }
  if (!_last && mine[0]) _last = { gen: mine[0], dest: destOf(mine[0]) };
  if (_ui) { paintMake(); _paintLine(); }
}

// ── the sash between the columns (remembered, `lib_music_sash_v1`) ───────────
function _setW(w) {
  if (!_ui || !_win) return SET_W;
  const room = _win.box.clientWidth - RIGHT_MIN;
  const v = Math.round(Math.max(SET_MIN, Math.min(Math.max(SET_MIN, Math.min(SET_MAX, room)), +w || SET_W)));
  _ui.set.style.flexBasis = v + 'px';
  return v;
}
function _wireSash() {
  const { sash, set } = _ui;
  sash.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    sash.setPointerCapture(e.pointerId);
    sash.classList.add('is-on');
    const x0 = e.clientX, w0 = set.getBoundingClientRect().width;
    let w = w0;
    const move = (ev) => { w = _setW(w0 + ev.clientX - x0); };
    const up = () => {
      sash.removeEventListener('pointermove', move);
      sash.removeEventListener('pointerup', up);
      sash.removeEventListener('pointercancel', up);
      sash.classList.remove('is-on');
      lsSet(KEY_SASH, w);
    };
    sash.addEventListener('pointermove', move);
    sash.addEventListener('pointerup', up);
    sash.addEventListener('pointercancel', up);
  });
  // A double press: back to the width it came with.
  sash.addEventListener('dblclick', () => lsSet(KEY_SASH, _setW(SET_W)));
}
const _onResize = () => { if (_ui) _setW(ls(KEY_SASH, SET_W)); };

/** The presses of this window still being made are followed with `o.onLanded` - the Library calls it as it starts. */
export function follow(o) {
  _o = Object.assign({}, _o, o || {});
  _pickUp();
}

/** The window - one per page: pressed again while it is open, the same one stays (its place followed anew). `o.lyric`
 *  { title, text } - on Custom with that text (the title only when it is empty). */
export async function open(o) {
  const { lyric, ...hooks } = o || {};
  _o = Object.assign({}, _o, hooks);
  _form();
  if (_win && _win.alive()) {
    // (phase V60.2) Opened again on another folder: the mode fitted to it.
    if (F.cat()) _fitMode();
    if (lyric && F.cat()) F.useLyric(lyric); else if (F.cat()) paint();
    return _win;
  }
  // (phase V60.1, (пк7б)) A mood's preset edited in an earlier opening is not carried into this one: the standard again -
  // and a refusal said then is not said again.
  F.resetEdit();
  _placeKey = null;
  _err = '';
  _win = openFrame({
    name: 'generate music', anchor: _o.anchor, cls: 'is-music', size: SIZE,
    onClose: () => {
      F.closeAlmanac();
      closeQ();
      window.removeEventListener('resize', _onResize);
      _win = null;
      _ui = null;
      if (typeof _o.onClose === 'function') _o.onClose();
    },
  });
  _win.setCrumbs([{ label: 'Suno' }]);
  const body = _win.body;
  body.classList.add('au-win');
  const set = el('div', 'mv3-ig-set au-set');
  const col = el('div', 'mv3-ig-scroll');
  set.appendChild(col);
  const sash = el('div', 'au-msash');
  sash.title = 'Drag to widen the settings - a double press puts it back';
  const right = el('div', 'au-right');
  const mid = el('div', 'au-mid');
  const status = el('div', 'au-status');
  status.hidden = true;
  const make = el('div', 'au-make');
  mid.append(status, make);
  const foot = el('div', 'au-foot');
  const alm = el('div', 'au-foot-alm');
  const line = el('div', 'au-line');
  const into = el('div', 'au-into');
  const price = el('div', 'au-price');
  const go = el('button', 'au-go', 'generate');
  go.type = 'button';
  go.addEventListener('click', () => _generate(go));
  foot.append(alm, line, into, price, go);
  right.append(mid, foot);
  body.append(set, sash, right);
  _ui = { set, col, sash, mid, status, make, alm, line, into, price, go };
  _setW(ls(KEY_SASH, SET_W));
  _wireSash();
  window.addEventListener('resize', _onResize);
  col.appendChild(el('div', 'au-note', 'reading…'));
  const win = _win;
  if (!(await F.ready()) || win !== _win) return win;
  F.almanacButton(alm);
  _fitMode();
  if (lyric) F.useLyric(lyric); else paint();
  _pickUp();
  return win;
}

/** The window open now, or null. */
export const shown = () => (_win && _win.alive() ? _win : null);
