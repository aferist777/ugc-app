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

   PHASE SCOPE (docs/local-app/PLAN.md, phase C3). The place is C5 and the frames C6; the
   lookbook GENERATOR behind "new lookbook" is C4, so that button says so for now.
   ════════════════════════════════════════════════════════════════════════════ */

import { loadCharacters, filterByGender, byLooks, derived } from '../chars-store.js';
import * as API from './scen-api.js';
import * as PV from './preview-b.js';
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
let _view = 'cast';                      // 'cast' | 'lookbooks'
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

  if (!ctx.project) { root.appendChild(_note('Reading the project…')); return; }
  if (_chars === null) { _load(ctx.repaint); root.appendChild(_note('reading the characters…')); return; }
  if (_state !== 'idle' && _state !== 'loading') root.appendChild(_note(_state, true));

  const chosen = _chars.find(c => c.id === String(_casting().characterId || ''));
  const scroll = _el('div', 'mv3-wk-scroll');
  root.appendChild(scroll);
  if (_view === 'lookbooks' && chosen) _paintLookbooks(scroll, head, chosen);
  else { _view = 'cast'; _paintCharacters(scroll, head); }
  _paintLooks(root, chosen);
  _showChoice(chosen);
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
    mk('new lookbook', 'Make a lookbook from a reference and a sentence - being built (phase C4)', null, false),
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
  add.title = 'Make a lookbook - being built (docs/local-app/PLAN.md, phase C4)';
  add.disabled = true;
  grid.appendChild(add);
  for (const p of _lbs) {
    const path = String((p && p.path) || p || '');
    if (!path) continue;
    const tile = _el('button', 'mv3-wk-tile is-lb' + (path === _lbPick ? ' is-on' : ''));
    tile.type = 'button';
    tile.title = path.split('/').pop();
    const img = _el('img', 'mv3-wk-face');
    img.alt = '';
    img.loading = 'lazy';
    img.src = derived(path, 'card');
    tile.appendChild(img);
    tile.addEventListener('click', () => { _lbPick = (_lbPick === path ? '' : path); _ctx.repaint(); });
    grid.appendChild(tile);
  }
  host.appendChild(grid);
  if (!_lbs.length) host.appendChild(_note('No lookbooks yet. Make one with "new lookbook".'));

  // Under the chosen outfit, and only then: apply is what spends, so it appears when there is
  // something to spend it on.
  if (_lbPick) {
    const row = _el('div', 'mv3-ins-row');
    const go = _el('button', 'mv3-x-go', _dressing ? 'dressing…' : 'apply');
    go.type = 'button';
    go.title = 'Dress ' + c.name + ' in this outfit';
    go.disabled = _dressing;
    go.addEventListener('click', () => _apply(c));
    row.appendChild(go);
    host.appendChild(row);
    host.appendChild(_note('The result is saved as a look of ' + c.name + ', and this project uses it.'));
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
    // Made for this project, so this project wears it.
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
  const drawer = _el('div', 'mv3-wk-drawer' + (c ? ' is-open' : ''));

  const strip = _el('div', 'mv3-wk-strip');
  strip.appendChild(_el('span', 'mv3-wk-lbl', 'looks'));
  strip.appendChild(_el('span', 'mv3-sc-meta', c
    ? (c.obrazy.length ? c.obrazy.length + ' for ' + c.name : 'none for ' + c.name + ' yet')
    : 'pick a character to see theirs'));
  drawer.appendChild(strip);

  if (c) {
    // One row that scrolls sideways: a wardrobe is a shelf, and a grid of it would need the
    // height the faces above are using.
    const row = _el('div', 'mv3-wk-row');
    const add = _el('button', 'mv3-wk-look is-add', '+');
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
