/* ════════════════════════════════════════════════════════════════════════════
   MERGE — the workshop's first step: WHO says it, WHERE, and the first frame.

   Loaded when the step is opened (js/merge-v3/workshop.js), because this is the
   heaviest part of the page and most visits never come here.

   The step is a stack that reveals itself as it is answered: pick a character and
   that character's looks appear under it; pick a look and the place is asked for;
   and so on to the frames. A question you have not reached yet is not on screen -
   the column is 280px wide and a form of everything at once is unreadable in it.

   WHAT IS SAVED. Only ids, and on the scenario project, where casting has always
   lived: characterId / characterName, then obrazId / obrazImage, then the location
   pair (routes/scen3.js, _normCasting). Nothing here owns a character or a look -
   they belong to the Character tab and to the looks library, and this only points
   at them.

   THE PREVIEW SHOWS WHO IS PICKED. The stage is lent to this step while it is open
   (PV.borrow), and at this point the timeline is empty anyway, so the frame that
   would otherwise be black shows the choice being made.

   MAKING A LOOK IS THE SAME STEP, not a window over it. "+" in the drawer turns the panel
   into the lookbook shelf; picking one and pressing apply dresses the character in it. The
   waiting happens on the STAGE - the blurred overlay with the countdown that the rest of the
   app uses - because that is where the answer will appear, and because a panel that freezes
   while a minute passes says nothing about what it is doing.

   The look belongs to the CHARACTER when it is done (obraz-save), not to this project. The
   project only points at it, so the next talking head cast with the same person finds the
   wardrobe already there.

   MAKING A LOOKBOOK is the third face of the panel: a reference to take an outfit from, a
   sentence about what is wanted, or both - the server decides what that means (extract the
   outfit, draw one, or read the photo and apply the sentence). Deliberately not the old
   generator: no count, no variants, no gallery of candidates. One picture, made to be worn
   by the character already standing in the panel.

   PHASE SCOPE (docs/local-app/PLAN.md, phase C4). The place is C5 and the frames C6.
   ════════════════════════════════════════════════════════════════════════════ */

import { loadCharacters, filterByGender, byLooks, derived } from '../chars-store.js';
import * as API from './scen-api.js';
import * as PV from './preview-b.js';
import { askDelete } from './ask.js';
import * as Layers from '../layers.js';
import { openViewer } from '../library/viewer.js';
import { startProgress } from '../progress.js';

const PEEK_MS = 260;                     // hover before the enlargement appears

let _chars = null;
let _state = 'idle';                     // 'idle' | 'loading' | an error to show
let _all = false;                        // the gender filter lifted by hand
let _ctx = null;                         // { project, repaint } from the workshop
let _saving = false;
// The panel has two faces: the casting, and the shelf of outfits to make a look from. Not a
// window over it - a 280px column has no room for a window, and this is the same question
// ("what does this person wear") one level down.
let _view = 'cast';                      // 'cast' | 'lookbooks' | 'newlb'
// What the next lookbook is made FROM: either a file the person chose here, or one the
// library already holds. Never both - choosing on one side clears the other, because the
// question "what is this based on" has one answer.
let _ref = null;                          // { name, dataUrl } - a picture from this computer
let _refLb = '';                          // ...or the path of a lookbook already on the shelf
let _lbNote = '';                         // what is wanted, in words
let _making = false;
let _lbs = null;                         // the lookbook shelf, read once
let _lbPick = '';                         // the outfit selected in that shelf
let _dressing = false;                    // one at a time: it is a minute and it is paid for

// The engine the dressing runs on. The same key the old page's gear writes, so the two agree
// while both exist (js/scenarios-v3/dress-popup.js, ENGINE_KEY).
const ENGINE_KEY = 'sv3_engine_v1';
const _engine = () => {
  try { return localStorage.getItem(ENGINE_KEY) || ''; } catch (e) { return ''; }
};

const _el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

const _casting = () => (_ctx && _ctx.project && _ctx.project.casting) || {};

// ── Reading the shelf ───────────────────────────────────────────────────────
async function _load(repaint) {
  if (_state === 'loading') return;
  _state = 'loading';
  repaint();
  try {
    _chars = byLooks(await loadCharacters());
    _state = 'idle';
  } catch (e) {
    _chars = [];
    _state = 'Could not read the characters: ' + e.message;
  }
  repaint();
}

// ── Saving a choice ─────────────────────────────────────────────────────────
// Straight to the project and straight away: a casting choice is one click and the
// next thing the person does is act on it, so a debounce here would only be a window
// in which the two disagree.
async function _patch(casting) {
  if (!_ctx || !_ctx.project) return;
  const next = { ..._casting(), ...casting };
  _ctx.project.casting = next;                 // shown now; confirmed below
  _saving = true;
  _ctx.repaint();
  try {
    const r = await fetch('/api/scen3/projects', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: _ctx.project.id, casting: next }),
    }).then(x => x.json());
    if (!r || !r.success) throw new Error((r && r.error) || 'refused');
    _ctx.project = r.project;
  } catch (e) {
    _state = 'Could not save the casting: ' + e.message;
  }
  _saving = false;
  _ctx.repaint();
}

// ── The picture of a character ──────────────────────────────────────────────
// The portrait when there is one. When there is not, the 4K reference sheet - three
// full bodies side by side - pushed LEFT, because the head this is being chosen by is
// at that end of it. (Decided with the owner: everyone gets a portrait eventually, so
// this is a fallback and not a second design.)
function _faceOf(c) {
  return { src: c.face || c.sheet || '', left: !c.face && !!c.sheet };
}

function _tileImg(c, variant) {
  const f = _faceOf(c);
  const img = _el('img', 'mv3-wk-face' + (f.left ? ' is-left' : ''));
  img.alt = '';
  img.loading = 'lazy';
  img.src = derived(f.src, variant || 'card');
  return img;
}

// ── The enlargement under the pointer ───────────────────────────────────────
// Not a layer (js/layers.js): it takes no keyboard and answers no question - it is a
// bigger look at what is already on screen. It follows the tile it belongs to, and it
// goes the moment the pointer leaves, on a scroll, or when the panel is rebuilt.
let _peek = null;
let _peekT = 0;

function _peekHide() {
  clearTimeout(_peekT);
  if (!_peek) return;
  _peek.el.remove();
  window.removeEventListener('scroll', _peekHide, true);
  _peek = null;
}

function _peekShow(tile, c) {
  _peekHide();
  const el = _el('div', 'mv3-wk-peek');
  el.appendChild(_tileImg(c, 'main'));
  el.appendChild(_el('span', null, c.name));
  document.body.appendChild(el);
  const r = tile.getBoundingClientRect();
  const w = el.offsetWidth, h = el.offsetHeight;
  // Beside the tile, on the side with room; clamped so it is never half off screen.
  const left = r.right + 8 + w <= window.innerWidth - 6 ? r.right + 8 : Math.max(6, r.left - w - 8);
  el.style.left = Math.round(left) + 'px';
  el.style.top = Math.round(Math.max(6, Math.min(window.innerHeight - h - 6, r.top - 10))) + 'px';
  _peek = { el, tile };
  window.addEventListener('scroll', _peekHide, true);
}

// ── The panel ───────────────────────────────────────────────────────────────
// Two parts, and the lower one is a DRAWER. The faces need the height, the looks need to be
// big enough to tell apart, and a column 280px wide has not got both - so the looks live at
// the foot of the panel and open OVER the faces when there is a character to show them for.
// Shut, they are a strip that still says what it is: an empty band at the bottom of a panel
// explains nothing, and a row of looks that appears from nowhere is worse.
export function paint(host, ctx) {
  _ctx = ctx;
  _peekHide();
  host.classList.add('is-wk');

  const root = _el('div', 'mv3-wk-frames');
  host.appendChild(root);

  // The title line carries the filter: both answer "which faces am I looking at", and a
  // second line of labels would cost the grid a row of them.
  const head = _el('div', 'mv3-ins-head is-wk');
  const txt = _el('div', 'mv3-ins-head-txt');
  txt.appendChild(_el('div', 'mv3-ins-title', 'first frames'));
  txt.appendChild(_el('div', 'mv3-ins-sub', _saving ? 'saving…' : 'Who says it, and where'));
  head.appendChild(txt);
  root.appendChild(head);
  _paintWhere(root);

  if (!ctx.project) { root.appendChild(_note('Reading the project…')); return; }
  if (_chars === null) { _load(ctx.repaint); root.appendChild(_note('reading the characters…')); return; }
  if (_state !== 'idle' && _state !== 'loading') root.appendChild(_note(_state, true));

  const chosen = _chars.find(c => c.id === String(_casting().characterId || ''));
  const scroll = _el('div', 'mv3-wk-scroll');
  root.appendChild(scroll);
  if (_view === 'newlb' && chosen) {
    _paintNewLookbook(scroll, head, chosen, root);
  } else if (_view === 'lookbooks' && chosen) {
    // No drawer here at all. It is the character's wardrobe, and what is being answered on
    // this face of the panel is which outfit to make the next one from.
    _paintLookbooks(scroll, head, chosen);
    _showDressing(chosen);
  } else {
    _view = 'cast';
    _paintCharacters(scroll, head);
    _paintLooks(root, chosen);
    _stageButton(null);
    _showChoice(chosen);
  }
}

// ── Where you are inside the step ───────────────────────────────────────────
// The chips in the panel's own header say which STEP is open; this says where inside it, and
// the bracket under the two says that the second belongs to the first. It is drawn even when
// there is nothing to say - an empty band the exact height of a full one - because a header
// that grows when you go one level deeper moves everything below it at the moment you are
// reading it.
const WHERE = {
  cast: 'character',
  lookbooks: 'looks',
  newlb: 'new lookbook',
};

function _paintWhere(root) {
  const bar = _el('div', 'mv3-wk-where');
  if (_view !== 'cast') {
    const back = _el('button', 'mv3-wk-crumb', WHERE.cast);
    back.type = 'button';
    back.title = 'Back to choosing who says it';
    back.addEventListener('click', () => { _view = 'cast'; _ctx.repaint(); });
    bar.appendChild(back);
    if (_view === 'newlb') {
      const mid = _el('button', 'mv3-wk-crumb', WHERE.lookbooks);
      mid.type = 'button';
      mid.title = 'Back to the shelf of outfits';
      mid.addEventListener('click', () => { _view = 'lookbooks'; _ctx.repaint(); });
      bar.appendChild(mid);
    }
    bar.appendChild(_el('span', 'mv3-wk-crumb is-here', WHERE[_view]));
  }
  root.appendChild(bar);
}

// ── The shelf of outfits ────────────────────────────────────────────────────
// Two buttons at the top, as agreed: this one, and the generator that makes a lookbook out of
// a reference and a sentence (C4). The first tile leads to that generator too, because an
// empty shelf has to offer the way to fill it.
function _paintLookbooks(host, head, c) {
  const acts = _el('div', 'mv3-wk-bar');
  const mk = (label, title, on, primary) => {
    const b = _el('button', 'mv3-sc-tab' + (primary ? ' is-on' : ''), label);
    b.type = 'button';
    b.title = title;
    if (on) b.addEventListener('click', on); else b.disabled = true;
    return b;
  };
  acts.append(
    mk('create look', 'Dress ' + c.name + ' in one of these', null, true),
    mk('new lookbook', 'Make one from a photo and a sentence',
      () => { _view = 'newlb'; _ctx.repaint(); }, false),
  );
  const back = _el('button', 'mv3-iconbtn', '\u2715');
  back.type = 'button';
  back.title = 'Back to the casting';
  back.addEventListener('click', () => { _view = 'cast'; _ctx.repaint(); });
  acts.appendChild(back);
  head.appendChild(acts);

  if (_lbs === null) {
    host.appendChild(_note('reading the lookbooks…'));
    API.lookbooks().then((files) => { _lbs = files; _ctx.repaint(); })
      .catch((e) => { _lbs = []; _state = 'Could not read the lookbooks: ' + e.message; _ctx.repaint(); });
    return;
  }

  const grid = _el('div', 'mv3-wk-grid is-lb');
  const add = _el('button', 'mv3-wk-tile is-add', '+');
  add.type = 'button';
  add.title = 'Make a lookbook from a photo and a sentence';
  add.addEventListener('click', () => { _view = 'newlb'; _ctx.repaint(); });
  grid.appendChild(add);
  for (const p of _lbs) {
    const path = String((p && p.path) || p || '');
    if (!path) continue;
    grid.appendChild(_lbTile(path, path === _lbPick, () => {
      _lbPick = (_lbPick === path ? '' : path);
      _ctx.repaint();
    }));
  }
  host.appendChild(grid);
  if (!_lbs.length) host.appendChild(_note('No lookbooks yet. Make one with "new lookbook".'));
}

// ── What the stage shows while an outfit is being chosen ────────────────────
// The person on top, the outfit below, and the button that joins them between the two: the
// dressing IS that sentence, and a button in the panel would be a long way from the thing it
// acts on. Nothing is under the shelf for the same reason - a row that appears there when an
// outfit is picked pushes the shelf about while it is being read.
function _showDressing(c) {
  _shownFor = '';                              // the casting view will paint its own again
  PV.showPair(derived(_faceOf(c).src, 'main'), _lbPick ? derived(_lbPick, 'main') : '');
  _stageButton(_lbPick ? {
    label: _dressing ? 'dressing…' : 'apply',
    title: 'Dress ' + c.name + ' in this outfit and save it as a look',
    busy: _dressing,
    on: () => _apply(c),
  } : null);
}

// The button lives in the stage, between the halves. Rebuilt rather than kept: the stage is
// cleared whenever the preview remounts, and a button that survives its own container is a
// button that outlives the question it asked.
function _stageButton(spec) {
  const stage = document.getElementById('mv3-stage');
  if (!stage) return;
  const old = stage.querySelector('.mv3-wk-apply');
  if (old) old.remove();
  if (!spec) return;
  const b = _el('button', 'mv3-wk-apply', spec.label);
  b.type = 'button';
  b.title = spec.title || '';
  b.disabled = !!spec.busy;
  b.addEventListener('click', spec.on);
  stage.appendChild(b);
}

// ── Making a lookbook ───────────────────────────────────────────────────────
// Two fields and one button. What they mean together is the server's rule, and it is worth
// stating where it is read: a photo alone takes the outfit OUT of it, a sentence alone draws
// one, and both together read the photo and apply the sentence to it. So the button says
// which of the three is about to happen instead of a flat "generate".
function _mode() {
  const base = !!(_ref || _refLb);
  if (base && _lbNote.trim()) return 'edit';
  if (base) return 'extract';
  if (_lbNote.trim()) return 'draw';
  return '';
}

// WORDS ALONE HAVE TO BE WORDS. With a picture in the field the sentence is an edit - "red
// shoes" is a complete instruction - but with nothing else to go on, a handful of characters
// is not an outfit, and the twenty below is the owner's number.
//
// The nonsense test is deliberately shallow and LOCAL: it catches a fist on the keyboard for
// free and instantly. Anything subtler - a real sentence about nothing, a shopping list, a
// question - is the agent's to refuse, and it does that before an image is paid for
// (routes/scen3.js, _readLookbookIdea).
const MIN_WORDS_ALONE = 20;

function _nonsense(s) {
  const t = String(s || '').trim().toLowerCase();
  if (!t) return false;
  const letters = t.replace(/[^a-zа-яё]/gi, '');
  if (!letters) return true;                               // digits and punctuation only
  if (/^(.)\1+$/.test(letters)) return true;               // one character, held down
  const vowels = (letters.match(/[aeiouyаеёиоуыэюя]/gi) || []).length;
  if (vowels / letters.length < 0.15) return true;         // no vowels worth the name
  const words = t.split(/\s+/).filter(Boolean);
  // One long unbroken run of letters is a keyboard, not a sentence.
  if (words.length === 1 && letters.length >= 12) return true;
  return false;
}

// What stops the button, in words. Empty means nothing does.
function _why() {
  const base = !!(_ref || _refLb);
  const note = _lbNote.trim();
  if (!base && !note) return 'a photo or a sentence';
  if (!base) {
    if (note.length < MIN_WORDS_ALONE) return (MIN_WORDS_ALONE - note.length) + ' more characters';
    if (_nonsense(note)) return 'that is not a description';
  } else if (note && _nonsense(note)) {
    return 'that is not a description';
  }
  return '';
}
const _MODE_LABEL = {
  edit: 'read the photo and apply the words',
  extract: 'take the outfit out of the photo',
  draw: 'draw it from the words',
};

function _paintNewLookbook(host, head, c, root) {
  host.classList.add('is-split');
  const acts = _el('div', 'mv3-wk-bar');
  const back = _el('button', 'mv3-sc-tab', 'create look');
  back.type = 'button';
  back.title = 'Back to the shelf of outfits';
  back.addEventListener('click', () => { _view = 'lookbooks'; _ctx.repaint(); });
  const here = _el('button', 'mv3-sc-tab is-on', 'new lookbook');
  here.type = 'button';
  here.disabled = true;
  const x = _el('button', 'mv3-iconbtn', '\u2715');
  x.type = 'button';
  x.title = 'Back to the casting';
  x.addEventListener('click', () => { _view = 'cast'; _ctx.repaint(); });
  acts.append(back, here, x);
  head.appendChild(acts);

  // LEFT: the shelf this one is drawn from. Picking a lookbook here puts it in the field on
  // the right as the base - which is what "make another one like that, but ..." means - and
  // the new lookbook joins this same shelf when it is done, so the pile grows while you work.
  const left = _el('div', 'mv3-wk-half is-shelf');
  if (_lbs === null) {
    left.appendChild(_note('reading the lookbooks…'));
    API.lookbooks().then((files) => { _lbs = files; _ctx.repaint(); })
      .catch((e) => { _lbs = []; _state = 'Could not read the lookbooks: ' + e.message; _ctx.repaint(); });
  } else if (!_lbs.length) {
    left.appendChild(_note('No lookbooks yet. The first one is made on the right.'));
  } else {
    const grid = _el('div', 'mv3-wk-grid is-lb');
    for (const p of _lbs) {
      const path = String((p && p.path) || p || '');
      if (path) grid.appendChild(_lbTile(path, path === _refLb, () => {
        _refLb = (_refLb === path ? '' : path);
        if (_refLb) _ref = null;                 // one base, not two
        _ctx.repaint();
      }));
    }
    left.appendChild(grid);
  }
  host.appendChild(left);

  // RIGHT: what is being made. The field takes a picture from this computer, and doing that
  // drops whatever was chosen on the left.
  const right = _el('div', 'mv3-wk-half');
  const baseSrc = _ref ? _ref.dataUrl : (_refLb ? derived(_refLb, 'card') : '');
  const drop = _el('div', 'mv3-wk-drop' + (baseSrc ? ' is-full' : ''));
  drop.title = 'Drop a photo here, or click to choose one from this computer';
  if (baseSrc) {
    const img = _el('img');
    img.alt = '';
    img.src = baseSrc;
    drop.appendChild(img);
    const clear = _el('button', 'mv3-wk-dropx', '\u2715');
    clear.type = 'button';
    clear.title = 'Take it off';
    clear.addEventListener('click', (e) => { e.stopPropagation(); _ref = null; _refLb = ''; _ctx.repaint(); });
    drop.appendChild(clear);
  } else {
    drop.appendChild(_el('span', null, 'a photo from this computer, or pick a lookbook on the left'));
  }
  const pick = _el('input');
  pick.type = 'file';
  pick.accept = 'image/*';
  pick.hidden = true;
  pick.addEventListener('change', () => { if (pick.files && pick.files[0]) _takeRef(pick.files[0]); });
  drop.addEventListener('click', () => pick.click());
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('is-over');
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) _takeRef(f);
  });
  right.append(drop, pick);

  host.appendChild(right);

  // The sentence and its button at the FOOT of the panel, across both halves: what is written
  // there applies to whatever is in the field above, and it is the last thing done before
  // spending - so it sits where the hand ends up, not in the middle of a column that scrolls.
  const foot = _el('div', 'mv3-wk-foot');
  const note = _el('textarea', 'mv3-sc-lines is-short');
  note.placeholder = 'What should it be? With a photo, say what to change - "shoes to white Nike trainers".';
  note.value = _lbNote;
  const row = _el('div', 'mv3-wk-footrow');
  const hint = _el('span', 'mv3-wk-mode mv3-sc-meta');
  const go = _el('button', 'mv3-wk-create', 'create');
  go.type = 'button';
  const sync = () => {
    const why = _why();
    go.disabled = !!why || _making;
    go.textContent = _making ? 'making…' : 'create';
    go.title = why ? why : 'Make it - this spends credits';
    hint.textContent = _making ? '' : (why || (_mode() ? _MODE_LABEL[_mode()] : ''));
    hint.classList.toggle('is-why', !!why);
  };
  note.addEventListener('input', () => { _lbNote = note.value; sync(); });
  go.addEventListener('click', () => _make(c));
  row.append(hint, go);
  foot.append(note, row);
  sync();
  root.appendChild(foot);

  // The stage shows who it is for, and only that: what is being made is already in the field
  // on the right, and a second copy of it on the stage would say nothing new.
  _shownFor = '';
  PV.showStill(derived(_faceOf(c).src, 'main'), c.name);
  _stageButton(null);
}

// ── One tile on a lookbook shelf ────────────────────────────────────────────
// Used by both shelves - the one that picks what to WEAR and the one that picks what a new
// lookbook is BASED on - because a lookbook is the same thing on either, and so is getting
// rid of one. The cross asks first; deleting is the only act here that cannot be undone.
function _lbTile(path, on, pick) {
  const tile = _el('button', 'mv3-wk-tile is-lb' + (on ? ' is-on' : ''));
  tile.type = 'button';
  tile.title = path.split('/').pop();
  const img = _el('img', 'mv3-wk-face');
  img.alt = '';
  img.loading = 'lazy';
  img.src = derived(path, 'card');
  tile.appendChild(img);

  const x = _el('button', 'mv3-wk-tilex', '\u2715');
  x.type = 'button';
  x.title = 'Delete this lookbook';
  x.addEventListener('click', (e) => { e.stopPropagation(); _askDeleteLb(tile, path); });
  tile.appendChild(x);

  tile.addEventListener('click', pick);
  tile.addEventListener('contextmenu', (e) => { e.preventDefault(); _lbMenu(e, tile, path); });
  return tile;
}

// The viewer the Library uses, so a lookbook is looked at the same way wherever it is met -
// and it is where its description will be read once there is one (phase C4c).
function _openLb(path) {
  openViewer([{ id: path, name: path.split('/').pop(), kind: 'lookbooks', media: path }], 0);
}

function _lbMenu(ev, tile, path) {
  _closeMenu();
  const el = _el('div', 'mv3-plus-menu');
  const item = (label, sub, on, danger) => {
    const b = _el('button', 'mv3-plus-item' + (danger ? ' is-danger' : ''));
    b.type = 'button';
    b.appendChild(_el('span', null, label));
    if (sub) b.appendChild(_el('small', null, sub));
    b.addEventListener('click', (e) => { e.stopPropagation(); _closeMenu(); on(); });
    el.appendChild(b);
  };
  item('open', 'look at it, full size', () => _openLb(path));
  item('delete', 'for good', () => _askDeleteLb(tile, path), true);

  document.body.appendChild(el);
  const w = el.offsetWidth, h = el.offsetHeight;
  el.style.left = Math.round(Math.max(6, Math.min(window.innerWidth - w - 6, ev.clientX))) + 'px';
  el.style.top = Math.round(Math.max(6, Math.min(window.innerHeight - h - 6, ev.clientY))) + 'px';
  const away = (e) => { if (!el.contains(e.target)) _closeMenu(); };
  const layer = Layers.open(el, { modal: false, name: 'lookbook menu', onEsc: _closeMenu });
  _menu = { el, away, layer };
  setTimeout(() => document.addEventListener('mousedown', away, true), 0);
}

let _menu = null;
function _closeMenu() {
  if (!_menu) return;
  _menu.el.remove();
  document.removeEventListener('mousedown', _menu.away, true);
  Layers.close(_menu.layer);
  _menu = null;
}

function _askDeleteLb(anchor, path) {
  const name = path.split('/').pop();
  askDelete(anchor, 'Delete "' + name + '"?',
    'The picture goes from the shelf for good. Looks already made from it keep what they are.',
    async () => {
      try {
        const r = await fetch('/api/library/item/lookbooks/' + encodeURIComponent(name), { method: 'DELETE' })
          .then(x => x.json());
        if (!r || !r.success) throw new Error((r && r.error) || 'refused');
      } catch (e) {
        _state = 'Could not delete it: ' + e.message;
      }
      _lbs = await API.lookbooks().catch(() => _lbs);
      if (_lbPick === path) _lbPick = '';
      if (_refLb === path) _refLb = '';
      _ctx.repaint();
    });
}

// Read once, kept as a data URL: it is what the server wants (imageBase64), and holding the
// File itself would mean reading it again on every repaint.
function _takeRef(file) {
  if (!file || !/^image\//.test(file.type)) return;
  const fr = new FileReader();
  fr.onload = () => {
    _ref = { name: file.name, dataUrl: String(fr.result || '') };
    _refLb = '';                               // a picture from this computer wins the field
    _ctx.repaint();
  };
  fr.readAsDataURL(file);
}

async function _make(c) {
  const mode = _mode();
  if (!mode || _making) return;
  _making = true;
  _ctx.repaint();
  const stage = document.getElementById('mv3-stage');
  const pr = startProgress(stage, {
    label: mode === 'extract' ? 'Taking the outfit out of the photo'
      : mode === 'edit' ? 'Reading the photo and your words' : 'Drawing the outfit',
    total: 1, estimateMs: 45000,
  });
  try {
    const r = await API.makeLookbook({
      prompt: _lbNote.trim(),
      imageBase64: _ref ? _ref.dataUrl : '',
      imagePath: _ref ? '' : _refLb,
      count: 1,
      engine: _engine(),
    });
    const id = (r.taskIds || [])[0];
    if (!id) throw new Error('the engine did not accept the task');
    const done = await API.awaitTask(id);
    // Until it is filed it is a scratch file with no shelf; filing gives it the path the
    // shelf and the dressing both use.
    const filed = await API.fileAs(done.imagePath, 'lookbook', r.gender || '', {
      description: r.description || '', prompt: (r.prompts || [])[0] || '',
    });
    pr.step();
    pr.finish();
    // The shelf on the left gains a tile and the maker stays where it is: one lookbook is
    // rarely the end of it, and being thrown back to the casting after each would make a
    // second one a journey.
    _lbs = await API.lookbooks();
    _refLb = String(filed.path || '');
    _ref = null;
    _lbNote = '';
    _making = false;
    _ctx.repaint();
  } catch (e) {
    const msg = (e && e.message) || 'unknown';
    pr.fail(msg);
    _making = false;
    // A refusal from the agent is not a failure of the machinery - it is an answer about what
    // was asked for, and it reads better as that than as an error.
    _state = /not (a|an)|nothing|gibberish|describe/i.test(msg) ? msg : 'The lookbook failed: ' + msg;
    _ctx.repaint();
  }
}

// ── The dressing itself ─────────────────────────────────────────────────────
// On the stage, because that is where the answer lands. The overlay carries the countdown
// that learns from the last run of the same job (js/progress.js), so the second dressing
// already says roughly how long it will take.
async function _apply(c) {
  if (_dressing) return;
  const base = c.sheet || c.face || '';
  if (!base) { _state = c.name + ' has no reference sheet to dress.'; return _ctx.repaint(); }
  const lb = _lbPick;
  _dressing = true;
  _ctx.repaint();

  const stage = document.getElementById('mv3-stage');
  const pr = startProgress(stage, { label: 'Dressing ' + c.name, total: 1, estimateMs: 60000 });
  try {
    const taskId = await API.dress({ basePath: base, lookbookPath: lb, note: '', engine: _engine() });
    const done = await API.awaitTask(taskId);
    const saved = await API.saveLook({
      charId: c.id, charName: c.name, imagePath: done.imagePath,
      gender: c.gender || '', lookbookPath: lb, engine: _engine(),
    });
    pr.step();
    pr.finish();
    // The wardrobe is read again rather than patched by hand: the look is filed by the
    // server, and what it filed is what should be on screen.
    _chars = byLooks(await loadCharacters(true));
    _view = 'cast';
    _lbPick = '';
    _dressing = false;
    _stageButton(null);
    // Made for this project, so this project wears it: the panel comes back to the faces with
    // the drawer open on the character it was made for, the new look selected in it, and that
    // look on the stage.
    await _patch({ obrazId: String(saved.obrazId || ''), obrazImage: String(saved.path || '') });
    _shownFor = '';
    _showChoice(_chars.find(x => x.id === c.id));
  } catch (e) {
    pr.fail((e && e.message) || 'the dressing failed');
    _dressing = false;
    _state = 'The dressing failed: ' + ((e && e.message) || 'unknown');
    _ctx.repaint();
  }
}

// Coming back to a project should look like coming back to it: the stage shows what is cast
// without anything being clicked. Tracked by what it is showing, so a repaint - and there is
// one after every save - does not re-load the same picture.
let _shownFor = '';
function _showChoice(chosen) {
  const cast = _casting();
  const id = String(cast.obrazId || cast.characterId || '');
  if (id === _shownFor) return;
  _shownFor = id;
  if (!id) return _showInPreview('', '');
  if (cast.obrazImage) {
    return _showInPreview(cast.obrazImage, (cast.characterName || '') + (chosen ? '' : ' · look'));
  }
  _showInPreview(chosen ? _faceOf(chosen).src : '', cast.characterName || '');
}

function _paintCharacters(host, head) {
  const want = String((_ctx.project && _ctx.project.gender) || '').toLowerCase();
  const castId = String(_casting().characterId || '');
  let shown = _all ? _chars : filterByGender(_chars, want);
  // WHOEVER IS CAST IS ALWAYS ON SCREEN, filter or no filter. A scenario that says female and
  // a project cast with a man is a deliberate choice somebody made; hiding him leaves the panel
  // claiming nobody is cast while the project says otherwise, and the way back is a chip the
  // person has no reason to press.
  if (castId && !shown.some(c => c.id === castId)) {
    const cast = _chars.find(c => c.id === castId);
    if (cast) shown = [cast].concat(shown);
  }

  const bar = _el('div', 'mv3-wk-bar');
  bar.appendChild(_el('span', 'mv3-wk-lbl', 'character'));
  // The filter says what it is hiding. A column that silently shows twelve of
  // twenty-seven reads as a bug the first time somebody looks for a missing face.
  if (want) {
    const t = _el('button', 'mv3-sc-tab' + (_all ? '' : ' is-on'), want + ' · ' + filterByGender(_chars, want).length);
    t.type = 'button';
    t.title = 'Only the gender the scenario states';
    t.addEventListener('click', () => { _all = false; _ctx.repaint(); });
    const a = _el('button', 'mv3-sc-tab' + (_all ? ' is-on' : ''), 'all · ' + _chars.length);
    a.type = 'button';
    a.title = 'Every character on the shelf';
    a.addEventListener('click', () => { _all = true; _ctx.repaint(); });
    bar.append(t, a);
  } else {
    bar.appendChild(_el('span', 'mv3-sc-meta', _chars.length + ' on the shelf'));
  }
  head.appendChild(bar);

  if (!shown.length) {
    host.appendChild(_note(_chars.length
      ? 'Nobody of that gender on the shelf. Show all to cast anyway.'
      : 'No characters yet - make one on the Character tab.'));
    return;
  }

  const grid = _el('div', 'mv3-wk-grid');
  const pickedId = castId;
  for (const c of shown) {
    const tile = _el('button', 'mv3-wk-tile' + (c.id === pickedId ? ' is-on' : ''));
    tile.type = 'button';
    tile.title = c.name + (c.obrazy.length ? ' · ' + c.obrazy.length + ' looks' : ' · no looks yet');
    tile.appendChild(_tileImg(c));
    tile.appendChild(_el('span', 'mv3-wk-name', c.name));
    tile.addEventListener('mouseenter', () => { _peekT = setTimeout(() => _peekShow(tile, c), PEEK_MS); });
    tile.addEventListener('mouseleave', _peekHide);
    tile.addEventListener('click', () => {
      _peekHide();
      // A second press on the face already cast is how you take it back: the drawer shuts
      // with it, which is the whole step saying "nobody yet" again.
      if (c.id === String(_casting().characterId || '')) {
        _patch({ characterId: '', characterName: '', obrazId: '', obrazImage: '' });
        _showInPreview('', '');
        return;
      }
      // A look belongs to one character, so changing who is cast drops it rather than
      // pointing the project at somebody else's wardrobe.
      _patch({ characterId: c.id, characterName: c.name, obrazId: '', obrazImage: '' });
      _showInPreview(_faceOf(c).src, c.name);
    });
    grid.appendChild(tile);
  }
  host.appendChild(grid);
}

// ── The drawer of looks ─────────────────────────────────────────────────────
// Shut when nobody is cast, open over the faces when somebody is. Its height is the height
// of what is in it - one row of 16:9 thumbnails, which is the shape that shows an outfit
// rather than a slice of one.
function _paintLooks(root, c) {
  // Shut while the look is being MADE: the shelf of outfits is the question then, and the
  // wardrobe underneath it is what the answer will join. It opens again on the way back,
  // for the same character - that is where the new look will be.
  const open = !!c && _view !== 'lookbooks';
  const drawer = _el('div', 'mv3-wk-drawer' + (open ? ' is-open' : ''));

  const strip = _el('div', 'mv3-wk-strip');
  strip.appendChild(_el('span', 'mv3-wk-lbl', 'looks'));
  strip.appendChild(_el('span', 'mv3-sc-meta', c
    ? (c.obrazy.length ? c.obrazy.length + ' for ' + c.name : 'none for ' + c.name + ' yet')
    : 'pick a character to see theirs'));
  drawer.appendChild(strip);

  if (open) {
    // One row that scrolls sideways: a wardrobe is a shelf, and a grid of it would need the
    // height the faces above are using.
    const row = _el('div', 'mv3-wk-row');
    // With no looks yet the "+" is the whole shelf rather than a sliver beside nothing:
    // an empty drawer with a thin dash in it reads as something broken.
    const add = _el('button', 'mv3-wk-look is-add' + (c.obrazy.length ? '' : ' is-only'), '+');
    add.type = 'button';
    add.title = 'Dress ' + c.name + ' in a lookbook';
    add.addEventListener('click', () => { _view = 'lookbooks'; _lbPick = ''; _ctx.repaint(); });
    row.appendChild(add);

    const pickedId = String(_casting().obrazId || '');
    for (const o of c.obrazy) {
      const b = _el('button', 'mv3-wk-look' + (o.id === pickedId ? ' is-on' : ''));
      b.type = 'button';
      b.title = o.name || 'look';
      const img = _el('img');
      img.alt = '';
      img.loading = 'lazy';
      img.src = derived(o.image, 'card');
      b.appendChild(img);
      b.addEventListener('click', () => {
        _patch({ obrazId: o.id, obrazImage: o.image });
        _showInPreview(o.image, c.name + (o.name ? ' · ' + o.name : ''));
      });
      row.appendChild(b);
    }
    drawer.appendChild(row);
  }
  root.appendChild(drawer);
}

// ── The stage ───────────────────────────────────────────────────────────────
// What the preview shows while this step is open. The timeline is empty at this point
// in a project's life, so the stage is free for the thing being decided.
function _showInPreview(src, caption) {
  PV.showStill(derived(src, 'main'), caption || '');
}

function _note(text, bad) {
  return _el('div', 'mv3-ins-note' + (bad ? ' is-err' : ''), text);
}

/** Painted over? Drop the enlargement with it. */
export function leave() { _peekHide(); }
