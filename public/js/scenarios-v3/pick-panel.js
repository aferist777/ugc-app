// Scenarios v3 — the annexed column: choosing WHO and WHERE, without leaving the frame.
//
// Casting used to happen in a column of its own, before the mix popup was ever opened: go
// there, set a character, set a place, come back, press Build mix. A preparatory step that
// showed nothing. This puts the choice inside the thing that needs it, so the frame being
// composed stays on screen while you pick what goes into it.
//
// It attaches to the LEFT of the popup rather than replacing a column, for the same reason:
// covering the sources to choose a source would defeat the point.
//
// ONE column, two modes. Clicking the portrait asks who; clicking the location asks where;
// clicking the other cell swaps what the column offers instead of stacking a second panel
// beside it. Two columns would eat the width the frame needs, and only one question is ever
// being answered.
//
// CLICK, NOT HOVER, to open a character's looks. The environments flyout already opens on
// hover and gets away with it because it is one flat list; a second level - hover a
// character, see its looks - is a target inside a target, missed constantly with a mouse and
// unreachable on a touchscreen. Hover only lights the row.
//
// Thumbnails come from /api/thumb at the `card` variant: 320px, capped at 20 KB, and cached
// forever because its key carries the source's mtime. chars.js has a thumb() of its own that
// rewrites a path to a neighbouring thumbs/ folder - it returns whatever happens to be there,
// at whatever weight, and nothing at all when the file was never made.

import { loadCharacters, filterByGender } from './chars.js';

const CARD = (src) => '/api/thumb?src=' + encodeURIComponent(src) + '&v=card';

let _el = null;         // the column itself
let _state = null;      // { mode, openId, onPick, onPlus, gender, current }
let _peek = null;       // the enlarged tile, parked beside the column

// ── The enlarged look, always beside the COLUMN ─────────────────────────────
// Not beside the tile it belongs to, which is what the lookbook hover does. The looks scroll
// sideways in a 200px strip, so a preview hung off each one would land in a different place
// every time and half of them would be over the popup's edge. One position, at the column's
// right margin, vertically level with whatever is hovered: the eye learns where to look once.
//
// The image is the same `card` derivative the tile already showed, so a hover costs nothing -
// it is in the browser cache before the pointer arrives.
function _hidePeek() {
  if (_peek) { _peek.remove(); _peek = null; }
}

function _showPeek(anchor, src) {
  _hidePeek();
  if (!src || !_el) return;
  const el = document.createElement('div');
  // A person is cropped to fit; a place is not. The library holds locations at 16:9, 1:1 and
  // 9:16, and a wide room shown as a narrow crop says less than the tile it came from - the
  // peek is the one place the whole thing has to be visible.
  el.className = 'sv3-pk-peek' + (_state.mode === 'location' ? ' whole' : '');
  const img = document.createElement('img');
  img.alt = '';
  img.src = CARD(src);
  el.appendChild(img);
  document.body.appendChild(el);
  _peek = el;

  const place = () => {
    if (_peek !== el) return;
    const col = _el.getBoundingClientRect();
    const a = anchor.getBoundingClientRect();
    const h = el.offsetHeight || 260;
    let top = a.top + a.height / 2 - h / 2;
    // Clamped to the viewport rather than to the popup: the column is the leftmost thing on
    // screen, and a tile near the bottom would otherwise push this off the edge.
    top = Math.min(Math.max(top, 8), window.innerHeight - h - 8);
    el.style.left = Math.round(col.right + 8) + 'px';
    el.style.top = Math.round(top) + 'px';
  };
  place();
  img.addEventListener('load', place, { once: true });
}

function _img(src, cls) {
  const i = document.createElement('img');
  i.className = cls || '';
  i.alt = '';
  i.loading = 'lazy';
  if (src) i.src = CARD(src);
  return i;
}

function _blank(text) {
  const d = document.createElement('div');
  d.className = 'sv3-pk-empty';
  d.textContent = text;
  return d;
}

// One character, and its looks underneath when it is the open one.
function _charRow(c, box) {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'sv3-pk-row' + (_state.openId === c.id ? ' on' : '');

  // The portrait if there is one. A sheet at 34px is three tiny bodies and no face.
  const shot = c.face || c.sheet;
  const face = shot ? _img(shot, 'sv3-pk-face') : _blank('—');
  if (shot) {
    face.addEventListener('mouseenter', () => _showPeek(face, shot));
    face.addEventListener('mouseleave', _hidePeek);
  }
  row.appendChild(face);

  const tx = document.createElement('span');
  tx.className = 'sv3-pk-tx';
  const nm = document.createElement('b');
  nm.textContent = c.name;
  tx.appendChild(nm);
  const sub = document.createElement('i');
  // Said plainly, because a character with no looks cannot be cast and the row would
  // otherwise open onto nothing with no explanation.
  sub.textContent = c.obrazy.length
    ? c.obrazy.length + (c.obrazy.length === 1 ? ' look' : ' looks')
    : 'no looks yet — use +';
  tx.appendChild(sub);
  row.appendChild(tx);

  const car = document.createElement('span');
  car.className = 'sv3-pk-caret';
  car.textContent = _state.openId === c.id ? '▾' : '▸';
  row.appendChild(car);

  row.addEventListener('click', () => {
    _state.openId = (_state.openId === c.id) ? '' : c.id;
    _paint(box);
  });
  return row;
}

function _looks(c, box) {
  const wrap = document.createElement('div');
  wrap.className = 'sv3-pk-looks';
  if (!c.obrazy.length) {
    wrap.appendChild(_blank('Nothing to wear yet. + dresses this character.'));
    return wrap;
  }
  for (const o of c.obrazy) {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'sv3-pk-look' + (_state.current && _state.current === o.image ? ' cur' : '');
    cell.title = o.name || 'look';
    cell.appendChild(_img(o.image, ''));
    if (o.name) {
      const cap = document.createElement('span');
      cap.className = 'sv3-pk-lookcap';
      cap.textContent = o.name;
      cell.appendChild(cap);
    }
    cell.addEventListener('mouseenter', () => _showPeek(cell, o.image));
    cell.addEventListener('mouseleave', _hidePeek);
    cell.addEventListener('click', (e) => {
      e.stopPropagation();
      _hidePeek();
      if (_state.onPick) {
        _state.onPick({
          characterId: c.id,
          characterName: c.name,
          obrazId: o.id,
          obrazImage: o.image,
        });
      }
    });
    wrap.appendChild(cell);
  }
  return wrap;
}

// Title, the + that makes a new one, and the scroller both modes fill. Returns the scroller.
function _head(box, title, plusTitle) {
  const head = document.createElement('div');
  head.className = 'sv3-pk-head';
  const ttl = document.createElement('span');
  ttl.textContent = title;
  head.appendChild(ttl);
  const sp = document.createElement('span');
  sp.className = 'sp';
  head.appendChild(sp);
  const plus = document.createElement('button');
  plus.type = 'button';
  plus.className = 'sv3-btn sm';
  plus.textContent = '+';
  plus.title = plusTitle;
  plus.addEventListener('click', () => { if (_state.onPlus) _state.onPlus(); });
  head.appendChild(plus);
  box.appendChild(head);

  const list = document.createElement('div');
  list.className = 'sv3-pk-list';
  box.appendChild(list);
  list.appendChild(_blank('Loading…'));
  return list;
}

function _paint(box) {
  _hidePeek();
  box.textContent = '';
  return _state.mode === 'location' ? _paintEnvs(box) : _paintChars(box);
}

// Locations tile two-up and fill the column. They are a flat set with no second level to
// open, so nothing has to stay readable underneath the way the character list does beneath
// its strip of looks.
async function _paintEnvs(box) {
  const list = _head(box, 'Location', 'Create a location');
  // env-popup carries the whole location generator; the column needs only its cached list,
  // so it is fetched here rather than pulled in by anyone who merely imports this file.
  const { loadEnvs } = await import('./env-popup.js');
  // loadEnvs answers [] rather than throwing when the gallery cannot be read.
  const envs = await loadEnvs();
  list.textContent = '';
  if (!envs.length) {
    list.appendChild(_blank('No locations here yet. + makes one.'));
    return;
  }
  const grid = document.createElement('div');
  grid.className = 'sv3-pk-envs';
  list.appendChild(grid);
  for (const env of envs) {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'sv3-pk-env' + (_state.current && _state.current === env.path ? ' cur' : '');
    cell.title = env.name || env.path;
    cell.appendChild(_img(env.path, ''));
    if (env.name) {
      const cap = document.createElement('span');
      cap.className = 'sv3-pk-envcap';
      cap.textContent = env.name;
      cell.appendChild(cap);
    }
    cell.addEventListener('mouseenter', () => _showPeek(cell, env.path));
    cell.addEventListener('mouseleave', _hidePeek);
    cell.addEventListener('click', () => {
      _hidePeek();
      if (_state.onPick) _state.onPick(env.path);
    });
    grid.appendChild(cell);
  }
}

async function _paintChars(box) {
  const list = _head(box, 'Character', 'Dress a character for this project');

  let chars = [];
  try { chars = await loadCharacters(); } catch (e) {
    list.textContent = '';
    list.appendChild(_blank('Could not read the characters: ' + e.message));
    return;
  }
  // The project's gender is a lock, not a preference: casting a man in a script written for
  // a woman is not a choice anyone makes on purpose.
  const shown = filterByGender(chars, _state.gender);
  list.textContent = '';
  if (!shown.length) {
    list.appendChild(_blank('No characters match this project. + makes one.'));
    return;
  }
  for (const c of shown) {
    list.appendChild(_charRow(c, box));
    if (_state.openId === c.id) list.appendChild(_looks(c, box));
  }
}

/**
 * Open the column beside a popup, asking one question.
 * @param {HTMLElement} host   where the column is appended (the popup's own row of columns)
 * @param {string} mode        'character' | 'location'
 * @param {object} o           { gender, current, onPick, onPlus }
 */
function _open(host, mode, o) {
  closePick();
  _state = { mode, openId: '', gender: o.gender || '', current: o.current || '',
             onPick: o.onPick, onPlus: o.onPlus };
  _el = document.createElement('div');
  _el.className = 'sv3-pop-col sv3-pk';
  // First in the row, so it reads as attached to the popup's left edge rather than dropped
  // into the middle of its columns.
  host.insertBefore(_el, host.firstChild);
  _paint(_el);
  return _el;
}

// A character pick hands back a whole casting ({characterId, obrazImage, …}); a location
// pick hands back the environment's path, which is all a place is.
export const openCharPick = (host, o = {}) => _open(host, 'character', o);
export const openEnvPick  = (host, o = {}) => _open(host, 'location',  o);

export function closePick() {
  _hidePeek();
  if (_el && _el.parentNode) _el.parentNode.removeChild(_el);
  _el = null;
  _state = null;
}

export const pickOpen = () => !!_el;
export const pickMode = () => (_state ? _state.mode : '');
