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

   PHASE SCOPE (docs/local-app/PLAN.md, phase C2). The character and its looks. The
   "+" that makes a new look is C3, the place is C5, the frames themselves C6.
   ════════════════════════════════════════════════════════════════════════════ */

import { loadCharacters, filterByGender, byLooks, derived } from '../chars-store.js';
import * as PV from './preview-b.js';

const PEEK_MS = 260;                     // hover before the enlargement appears

let _chars = null;
let _state = 'idle';                     // 'idle' | 'loading' | an error to show
let _all = false;                        // the gender filter lifted by hand
let _ctx = null;                         // { project, repaint } from the workshop
let _saving = false;

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
export function paint(host, ctx) {
  _ctx = ctx;
  _peekHide();

  const head = _el('div', 'mv3-ins-head');
  const txt = _el('div', 'mv3-ins-head-txt');
  txt.appendChild(_el('div', 'mv3-ins-title', 'first frames'));
  txt.appendChild(_el('div', 'mv3-ins-sub', _saving ? 'saving…' : 'Who says it, and where'));
  head.appendChild(txt);
  host.appendChild(head);

  if (!ctx.project) { host.appendChild(_note('Reading the project…')); return; }
  if (_chars === null) { _load(ctx.repaint); host.appendChild(_note('reading the characters…')); return; }
  if (_state !== 'idle' && _state !== 'loading') host.appendChild(_note(_state, true));

  _paintCharacters(host);
  const chosen = _chars.find(c => c.id === String(_casting().characterId || ''));
  if (chosen) _paintLooks(host, chosen);
  _showChoice(chosen);
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

function _paintCharacters(host) {
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
  host.appendChild(bar);

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
      // Picking a different character drops the look with it: a look belongs to one
      // character, and keeping the old id would point the project at someone else's.
      const same = c.id === String(_casting().characterId || '');
      _patch(same ? { characterId: c.id, characterName: c.name }
        : { characterId: c.id, characterName: c.name, obrazId: '', obrazImage: '' });
      _showInPreview(_faceOf(c).src, c.name);
    });
    grid.appendChild(tile);
  }
  host.appendChild(grid);
}

// ── The looks of the chosen character ───────────────────────────────────────
function _paintLooks(host, c) {
  const bar = _el('div', 'mv3-wk-bar');
  bar.appendChild(_el('span', 'mv3-wk-lbl', 'look'));
  bar.appendChild(_el('span', 'mv3-sc-meta', c.obrazy.length
    ? c.obrazy.length + ' for ' + c.name
    : 'none for ' + c.name + ' yet'));
  host.appendChild(bar);

  // One row that scrolls sideways: looks are a shelf of one character's wardrobe, and
  // a grid of them would push the rest of the step off the bottom of the column.
  const row = _el('div', 'mv3-wk-row');
  const add = _el('button', 'mv3-wk-look is-add', '+');
  add.type = 'button';
  add.title = 'Make a new look - being built (docs/local-app/PLAN.md, phase C3)';
  add.disabled = true;
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
  host.appendChild(row);
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
