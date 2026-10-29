/* ═══════════════════════════════════════════════════════════════════════════
   THE LIBRARY'S MUSIC WINDOW (phase V59, the owner 2026-10-29: "надо бы еще попап с генератором музыки вложить в library.
   по аналогии с окружениями и лукбуками ... конкретно suno взять и в попап сделать генератор музыки в library") - Suno's
   generator in a window over the Media shelf, the almanac's size (js/gen-window.js openFrame, 860×560, as the generators of
   environments and lookbooks), the gallery and the tree staying where they are behind it.

     left     the settings: the mode (Simple, Custom, Lyrics - (мг1а): no Sounds, they lie in SFX), Suno's model (V6 /
              V6_MINI / V6_WILD, remembered - (мг10а)), in Simple a highlights mood, the length (a number - there is no video
              here), the folded chips, the price, the almanac at the foot
     middle   the constructor of the mode and "generate" - js/sound/suno-form.js, the one Merge's "/ generate audio" is
              built from; under it the line of the last press ("in Alerts · …"), and in Lyrics the texts written last

   NO "MADE HERE" ((мг5б)): the window stays open after "generate", says the press is in Alerts, and what Suno makes lands in
   the gallery behind it - the opener reads the tree and the gallery again and outlines the new tracks while their folder is
   open (`onLanded`). WHERE THEY GO ((мг4а)): the folder under Music the window was opened on - Music itself, or a folder of
   the person's in it; a highlights mood's preset files its two tracks into Music -> highlights -> that mood whatever is open,
   and highlights or a mood open without one - Music's root (lib/audio-gens.js `_intoOf`, the server's rule). Simple's
   writer writes as for a blank project (lib/audio-writer-rules.js). The Alerts row leads to that folder with the press's
   tracks outlined once they are filed (js/alerts-bell.js _hrefOf, `where.spot.view` 'musicmake'), to the folder alone while
   it runs or when it failed.

     open(o)    o: { place() -> the folder open { key, cat?, folder?, label, trail? }, anchor, onLanded(gen, dest), onClose }
     follow(o)  the presses of this window still being made (a reload, the window closed) are followed with `o`'s onLanded
   What the person set is remembered in the browser (`lib_music_v1`).
   ═══════════════════════════════════════════════════════════════════════════ */

import { openFrame } from '../gen-window.js';
import { createSunoForm, el, api } from '../sound/suno-form.js';

const MODES = ['simple', 'custom', 'lyrics'];
const VIEW = 'musicmake';
const KEY = 'lib_music_v1';

let F = null;              // the form - made at the first open, kept for the page
let _win = null;           // the window, while it is open
let _ui = null;            // its parts
let _o = {};               // the opener's hooks - kept after the window closes: a press lands whether or not it is open
let _going = false;
const _runs = new Map();   // id -> { gen, dest } - the presses of this window being followed
let _last = null;          // { gen, dest } - the last press: its line under "generate"
let _lyrics = null;        // the last Lyrics record written: its texts under the Lyrics card
let _looked = false;       // the server asked once for presses of this window still being made
let _timer = 0;

const S = () => F.S;

function _form() {
  if (F) return F;
  F = createSunoForm({
    store: KEY, title: 'Generate music',
    base: { mode: 'simple' },
    say: (t, bad) => _say(t, bad),
    paintCol: () => paintCol(),
    paintMake: () => paintMake(),
    paintMakePrice: () => paintMakePrice(),
    setMode: (id) => setMode(id),
    // No video here: the length is said in seconds.
    lengthNote: (mode) => (mode === 'simple' ? 'how long the music is - the bed comes out a little longer' : ''),
  });
  if (!MODES.includes(F.S.mode)) F.S.mode = 'simple';
  return F;
}

function setMode(id) {
  if (!MODES.includes(id)) return;
  S().mode = id;
  F.save();
  paintCol();
  paintMake();
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
// { node: the tree's key of the folder they lie in, into: the folder's id for the server ('' - Music's root or a mood),
//   label: its path in words, note: why it is not the folder open }.
function _dest() {
  const p = (typeof _o.place === 'function' ? _o.place() : null) || null;
  const mood = F.preset();
  if (S().mode === 'lyrics') return { node: p && p.key ? p.key : 'music', into: '', label: '' };
  if (mood) return { node: 'music:highlights:' + mood.id, into: '', label: 'Music → highlights → ' + mood.label };
  if (p && p.cat) return { node: p.key, into: p.cat, label: 'Music → ' + (p.trail || p.label) };
  return { node: 'music', into: '', label: 'Music',
    note: p && p.folder === 'highlights' ? 'highlights and its moods take only what a mood\'s preset makes' : '' };
}

// ── the settings column ─────────────────────────────────────────────────────
function paintCol() {
  if (!_ui || !F.cat()) return;
  const CAT = F.cat();
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
  row('Mode', F.modeSelect(CAT.modes.filter(m => MODES.includes(m.id))),
    CAT.keys && !CAT.keys.kie && !CAT.fake ? 'No kie.ai key - add it on Admin → API keys.' : '');
  if (S().mode !== 'lyrics') row('Model', F.modelSelect(), 'one price for all three');
  F.moodRow(row);
  F.lengthRows(row, sep);
  F.chipRows(col);
  F.priceBox(col);
  _ui.alm.textContent = '';
  F.almanacButton(_ui.alm);
}

function paintMakePrice() {
  const s = _ui && _ui.make.querySelector('.au-go-row .au-muted');
  if (s) s.textContent = F.priceText();
}

// ── the constructor ─────────────────────────────────────────────────────────
function paintMake() {
  if (!_ui || !F.cat()) return;
  const host = _ui.make;
  host.textContent = '';
  const m = F.cat().modes.find(x => x.id === S().mode);
  if (!m) return;
  const d = _dest();
  const card = el('div', 'au-card');
  const h = el('div', 'au-card-h');
  h.appendChild(document.createTextNode('Suno · ' + m.label));
  h.appendChild(el('span', 'au-muted', S().mode === 'lyrics' ? 'text only - nothing is filed'
    : 'into ' + d.label + (d.note ? ' - ' + d.note : '')));
  card.appendChild(h);
  const bot = el('div', 'au-bot');
  bot.appendChild(el('div', 'au-bot-ico', '♪'));
  bot.appendChild(el('div', 'au-bot-tx', F.helpText('AUDIO → ' + (d.label || 'Music')) || ''));
  card.appendChild(bot);
  F.paintFields(card);
  const goRow = el('div', 'au-go-row');
  const go = el('button', 'au-go', S().mode === 'lyrics' ? 'write the lyrics' : 'generate');
  go.type = 'button';
  go.addEventListener('click', () => _generate(go));
  goRow.appendChild(go);
  goRow.appendChild(el('span', 'au-muted', F.priceText()));
  card.appendChild(goRow);
  const line = el('div', 'au-line');
  card.appendChild(line);
  card.appendChild(el('div', 'au-err'));
  host.appendChild(card);
  _ui.line = line;
  _paintLine();
  // Lyrics: the texts written last, each with "use in custom".
  if (S().mode === 'lyrics' && _lyrics && (_lyrics.lyrics || []).length) {
    const box = el('div', 'au-lyrs');
    box.appendChild(el('div', 'au-made-h', 'written last · ' + (_lyrics.said || '')));
    for (const l of _lyrics.lyrics) box.appendChild(F.lyricCard(l));
    host.appendChild(box);
  }
}

// The line of the last press: where it is in Alerts, what came of it.
function _paintLine() {
  const line = _ui && _ui.line;
  if (!line || !line.isConnected) return;
  const r = _last;
  const g = r && r.gen;
  line.textContent = '';
  line.className = 'au-line';
  if (!g) return;
  const lyr = g.kind === 'lyrics';
  let t;
  if (g.state === 'pending') {
    t = (lyr ? 'writing the lyrics' : 'in Alerts · ' + (g.stage || (g.taskId ? 'Suno is making it' : 'starting'))) + '…';
    line.classList.add('is-on');
  } else if (g.state === 'done') {
    const n = (g.results || []).length;
    t = lyr ? 'the lyrics are written - ' + (S().mode === 'lyrics' ? 'below' : 'in Lyrics')
      : 'in Alerts · done - ' + n + ' track' + (n === 1 ? '' : 's') + ' in ' + (r.dest.label || 'Music');
  } else {
    t = (lyr ? '' : 'in Alerts · ') + (g.refused ? 'refused' : 'failed') + ' - ' + (g.error || 'it did not come');
    line.classList.add('is-bad');
  }
  line.textContent = t;
}

async function _generate(btn) {
  if (_going || !F.cat()) return;
  _going = true;
  btn.disabled = true;
  const err = btn.closest('.au-card').querySelector('.au-err');
  err.textContent = '';
  try {
    const b = F.body('blank');
    if (!b) throw new Error('nothing to ask for in this mode');
    const d = _dest();
    const m = F.cat().modes.find(x => x.id === S().mode);
    // The Alerts row keeps `spot`'s key, view and step (lib/alerts.js): the key is the tree's key of the folder; the words of
    // it stay on the record of the press (lib/audio-gens.js keeps `where` as it is) for the line after a reload.
    b.where = {
      page: 'library', href: '/library?shelf=media&kind=' + encodeURIComponent(d.node),
      label: 'Library · ' + (d.label || 'Generate music') + ' · ' + (m ? m.label : S().mode), spot: { view: VIEW, key: d.node, label: d.label },
    };
    if (d.into) b.into = d.into;
    const r = await F.press(b);
    _track(r.gen, d);
    paintMake();
  } catch (e) {
    err.textContent = e.message;
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
  _tick();
}
function _tick() {
  if (!_timer && _runs.size) _timer = setTimeout(_poll, 3000);
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
    if (g.kind === 'lyrics') { if (g.state === 'done') { _lyrics = g; lyricsCame = true; } }
    else if (g.state === 'done' && typeof _o.onLanded === 'function') {
      try { await _o.onLanded(g, r.dest); } catch (e) { /* the opener's */ }
    }
  }
  if (lyricsCame && _ui && S().mode === 'lyrics') paintMake(); else _paintLine();
  _tick();
}

// The presses of this window the server is still making - after a reload, or with the window closed and opened again -
// are followed to their end; and the lyrics written last are shown again. Asked once per page.
async function _pickUp() {
  if (_looked) return;
  _looked = true;
  let items = [];
  try { items = (await api('/api/audio/gens?limit=60')).items || []; } catch (e) { return; }
  const mine = items.filter(g => g && g.where && g.where.page === 'library' && g.where.spot && g.where.spot.view === VIEW);
  const destOf = (g) => ({ node: g.where.spot.key || 'music', into: g.into || '', label: g.where.spot.label || '' });
  for (const g of mine.slice().reverse()) {
    if (g.state === 'pending' && !_runs.has(g.id)) _track(g, destOf(g));
  }
  if (!_lyrics) _lyrics = mine.find(g => g.kind === 'lyrics' && g.state === 'done') || null;
  if (!_last && mine[0]) _last = { gen: mine[0], dest: destOf(mine[0]) };
  if (_ui) paintMake();
}

/** The presses of this window still being made are followed with `o.onLanded` - the Library calls it as it starts. */
export function follow(o) {
  _o = Object.assign({}, _o, o || {});
  _pickUp();
}

/** The window - one per page: pressed again while it is open, the same one stays (its place followed anew). */
export async function open(o) {
  _o = Object.assign({}, _o, o || {});
  _form();
  if (_win && _win.alive()) { paintCol(); paintMake(); return _win; }
  _win = openFrame({
    name: 'generate music', anchor: _o.anchor, cls: 'is-music',
    onClose: () => {
      F.closeAlmanac();
      _win = null;
      _ui = null;
      if (typeof _o.onClose === 'function') _o.onClose();
    },
  });
  _win.setCrumbs([{ label: 'generate music' }]);
  const body = _win.body;
  body.classList.add('au-win');
  const set = el('div', 'mv3-ig-set au-set');
  const col = el('div', 'mv3-ig-scroll');
  const alm = el('div', 'au-alm-foot');
  set.append(col, alm);
  const mid = el('div', 'au-mid');
  const status = el('div', 'au-status');
  status.hidden = true;
  const make = el('div', 'au-make');
  mid.append(status, make);
  body.append(set, mid);
  _ui = { col, alm, mid, status, make, line: null };
  col.appendChild(el('div', 'au-note', 'reading…'));
  const win = _win;
  if (!(await F.ready()) || win !== _win) return win;
  paintCol();
  paintMake();
  _pickUp();
  return win;
}

/** The window open now, or null. */
export const shown = () => (_win && _win.alive() ? _win : null);
