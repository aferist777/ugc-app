// ════════════════════════════════════════════════════════════════════════════
// NEW PROP (phase V26.6, the owner 2026-10-30, (п3), (пр1)-(пр5)): a product brought into IMAGES -> Props - ONE window,
// opened from anywhere: the "+" of Props in the media tree (the Library and Merge's Library panel), the Library's bar, Merge's
// gallery "+" tile, and the frames chat's picker opened from its product place ((пр3)).
//
//   openNewProp({ anchor, onAdded(item), onClose })   -> the window (the one open already, when there is one)
//     item  { id, media, name } - the product, once it lies in Props (its description is written behind)
//
// On the left the PHOTO: a press opens this computer's files, a file let go on it, Ctrl+V of a copied picture, or
// "from IMAGES…" - the attachment window with the tree (js/merge-v3/chat-pick.js); a picture of IMAGES is COPIED (it stays
// where it is, (пр5)). On the right its name (optional - the agent names it) and what the person knows about it, in any
// language, and `add` (POST /api/props/add). Nothing is generated and no Alerts row is written.
// After `add` THE WINDOW STAYS ((пр1) "а"): the product as it landed - its name and the agent's description once it is
// written ("describing…"; not written - why, and "read again") - and "add another".
// ════════════════════════════════════════════════════════════════════════════

import { openFrame, ensureCss } from './gen-window.js';
import { isPictureFile, pictureDataUrl, PICTURE_ACCEPT } from './picture-file.js';
import { openPick, closePick, ensurePickCss } from './merge-v3/chat-pick.js';
import * as Src from './merge-v3/chat-sources.js';
import { showPicture } from './merge-v3/wk-maker.js';
import { showError } from './notice.js';

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const json = async (url, opts) => {
  const r = await fetch(url, opts);
  let d = null;
  try { d = await r.json(); } catch (e) { d = null; }
  if (!r.ok || !d || d.success === false) throw new Error((d && d.error) || ('HTTP ' + r.status));
  return d;
};
const post = (url, body) => json(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });

const POLL_MS = 1500;
const POLL_MAX = 240;                       // six minutes of "describing…" at most

let _win = null;
let _o = {};
let _s = null;
let _poll = 0;
let _input = null;

const _blank = () => ({ photo: null, name: '', words: '', busy: false, added: null, info: null, polls: 0 });

/** The window of New prop - over everything open; the one open already when there is one. */
export function openNewProp(o) {
  _o = o || {};
  if (_win && _win.alive()) return _win;
  ensureCss();
  ensurePickCss();                         // "from IMAGES…" opens the attachment window - its look ready before
  _s = _blank();
  // (phase V64, fix (е)) The almanac's size again, over its place - not a generation's 1280×800.
  _win = openFrame({ name: 'new prop', anchor: _o.anchor, cls: 'is-gen is-prop', onClose: _closed });
  _win.setCrumbs([{ label: 'new prop' }]);
  document.addEventListener('paste', _onPaste, true);
  _render();
  return _win;
}

function _closed() {
  clearTimeout(_poll);
  document.removeEventListener('paste', _onPaste, true);
  closePick();
  _win = null;
  if (typeof _o.onClose === 'function') { try { _o.onClose(); } catch (e) { /* the caller's */ } }
}

// Ctrl+V of a copied picture - while this window is the top one and has not added yet.
function _onPaste(e) {
  if (!_win || !_win.isTop() || !_s || _s.added) return;
  const files = [...((e.clipboardData && e.clipboardData.files) || [])].filter(isPictureFile);
  if (!files.length) return;
  e.preventDefault();
  e.stopPropagation();
  _take(files[0]);
}

// (phase V73 block 2) A refused or unread file, and a failed `add`, are said in the corner (js/notice.js).
async function _take(file) {
  if (!file) return;
  if (!isPictureFile(file)) { showError('That is not a picture.'); return; }
  try { _s.photo = { dataUrl: await pictureDataUrl(file), name: file.name || 'photo' }; }
  catch (e) { showError((e && e.message) || 'The file could not be read'); return; }
  _render();
}

// The attachment window with the tree, on IMAGES (REFERENCES above it) - one picture is taken and the window closes.
function _fromLibrary(anchor) {
  const T = Src.TREE.image;
  openPick({
    kind: 'image', title: 'a photo of the product', hint: 'It is copied into Props - the picture stays where it is',
    sources: [], tree: T, start: ['node:images'], anchor: (_win && _win.box) || anchor,
    left: () => 1, mark: () => '', room: () => 'One photo of the product',
    why: () => '',
    press: (it) => {
      _s.photo = { path: it.path, name: it.name || String(it.path).split('/').pop(), src: it.big || it.thumb || it.path };
      closePick();
      _render();
    },
    computer: {
      word: 'a photo', hint: 'A photo of the product from this computer.',
      open: () => { closePick(); if (_input) _input.click(); },
      accepts: isPictureFile,
      drop: (files) => { closePick(); _take(files[0]); },
    },
  });
}

function _render() {
  if (!_win || !_win.alive()) return;
  const host = _win.body;
  host.textContent = '';
  host.classList.add('gw-bench', 'pw-bench');
  host.append(_left(), _s.added ? _result() : _form());
}

// LEFT: the photo.
function _left() {
  const left = el('div', 'gw-half is-shelf pw-left');
  const src = _s.photo ? (_s.photo.dataUrl || _s.photo.src) : '';
  const box = el('div', 'gw-drop pw-drop' + (src ? ' is-full' : ''));
  _input = el('input');
  _input.type = 'file';
  _input.accept = PICTURE_ACCEPT;
  _input.hidden = true;
  _input.addEventListener('change', () => _take(_input.files && _input.files[0]));
  const done = !!_s.added;
  if (src) {
    const img = el('img');
    img.alt = '';
    img.src = src;
    box.appendChild(img);
    if (!done) {
      const x = el('button', 'gw-dropx u-onpic is-del u-x', '');
      x.type = 'button';
      x.title = 'Take it off';
      x.addEventListener('click', (e) => { e.stopPropagation(); _s.photo = null; _render(); });
      box.appendChild(x);
    }
    box.title = done ? 'Press to look at it large' : 'Press to look at it large - let another photo go here to replace it';
  } else {
    box.appendChild(el('span', null, 'A photo of the product - press to choose one from this computer, let it go here, or Ctrl+V'));
    box.title = 'One photo of the product: the whole product, its label readable';
  }
  box.addEventListener('click', () => {
    if (!src) { _input.click(); return; }
    showPicture({ src, name: _s.photo.name || 'the product' });
  });
  if (!done) {
    box.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); box.classList.add('is-over'); });
    box.addEventListener('dragleave', () => box.classList.remove('is-over'));
    box.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      box.classList.remove('is-over');
      _take(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]);
    });
  }
  const wrap = el('div', 'gw-fieldwrap');
  wrap.append(box, _input);
  left.appendChild(wrap);
  if (!done) {
    const lib = el('button', 'pw-lib u-btn is-s', 'from IMAGES…');
    lib.type = 'button';
    lib.title = 'A picture of the Library - it is copied into Props, and stays where it is';
    lib.addEventListener('click', () => _fromLibrary(lib));
    left.appendChild(lib);
  }
  return left;
}

// RIGHT, before `add`: the name and the words.
function _form() {
  const right = el('div', 'gw-half is-make pw-right');
  const body = el('div', 'pw-fields');
  body.appendChild(el('label', 'pw-lab', 'name'));
  const name = el('input', 'pw-name u-in');
  name.type = 'text';
  name.maxLength = 120;
  name.placeholder = 'Optional - the agent names it from the picture';
  name.value = _s.name;
  name.addEventListener('input', () => { _s.name = name.value; });
  body.appendChild(name);
  body.appendChild(el('label', 'pw-lab', 'what you know about the product'));
  const words = el('textarea', 'gw-say pw-words u-area');
  words.placeholder = 'What it is, its size, what it does, what matters to show - in any language. What the photo does not show comes from here.';
  words.value = _s.words;
  words.addEventListener('input', () => { _s.words = words.value; });
  body.appendChild(words);
  right.appendChild(body);
  const foot = el('div', 'gw-foot');
  const row = el('div', 'gw-row');
  const hint = el('span', 'gw-hint' + (_s.photo ? '' : ' is-why'),
    _s.photo ? 'An agent describes it for the frames chat - fractions of a cent, nothing is drawn' : 'a photo of the product first');
  const go = el('button', 'gw-create u-btn is-main', _s.busy ? 'adding…' : 'add');
  go.type = 'button';
  go.disabled = !_s.photo || _s.busy;
  go.title = _s.photo ? 'Into IMAGES → Props' : 'a photo of the product first';
  go.addEventListener('click', _add);
  row.append(hint, go);
  foot.appendChild(row);
  right.appendChild(foot);
  return right;
}

async function _add() {
  if (!_s.photo || _s.busy) return;
  _s.busy = true;
  _render();
  const body = { name: _s.name.trim(), words: _s.words.trim() };
  if (_s.photo.dataUrl) body.imageBase64 = _s.photo.dataUrl; else body.imagePath = _s.photo.path;
  try {
    const d = await post('/api/props/add', body);
    _s.added = { id: d.id, media: d.media, name: d.name };
    _s.info = { name: d.name, description: '', reading: true };
    _s.polls = 0;
    if (typeof _o.onAdded === 'function') { try { _o.onAdded(_s.added); } catch (e) { /* the caller's */ } }
    _follow();
  } catch (e) { showError('Not added: ' + e.message); }
  _s.busy = false;
  _render();
}

// The description is written behind the answer: read again every moment while it is.
function _follow() {
  clearTimeout(_poll);
  if (!_win || !_win.alive() || !_s.added) return;
  _poll = setTimeout(async () => {
    if (!_win || !_win.alive() || !_s.added) return;
    try {
      _s.info = await json('/api/library/info/props/' + encodeURIComponent(_s.added.id));
    } catch (e) { _s.info = { reading: false, fail: e.message }; }
    _s.polls++;
    _render();
    if (_s.info && _s.info.reading && _s.polls < POLL_MAX) _follow();
    else if (typeof _o.onAdded === 'function') { try { _o.onAdded(Object.assign({}, _s.added, { name: (_s.info || {}).name || _s.added.name, described: true })); } catch (e) { /* the caller's */ } }
  }, POLL_MS);
}

// RIGHT, after `add`: the product as it landed, its description, "add another".
function _result() {
  const right = el('div', 'gw-half is-make pw-right');
  const i = _s.info || {};
  const body = el('div', 'pw-fields');
  body.appendChild(el('div', 'pw-landed', 'In IMAGES → Props'));
  body.appendChild(el('div', 'pw-title', i.name || _s.added.name || 'the product'));
  body.appendChild(el('label', 'pw-lab', 'description'));
  if (i.reading) body.appendChild(el('div', 'pw-desc is-wait', 'describing…'));
  else if (i.description) body.appendChild(el('div', 'pw-desc', i.description));
  else {
    body.appendChild(el('div', 'pw-desc is-fail', 'Not described: ' + (i.fail || 'the agent did not answer') + '.'));
    const again = el('button', 'pw-again u-btn is-s', 'read again');
    again.type = 'button';
    again.title = 'The agent looks at the picture and reads your words again';
    again.addEventListener('click', async () => {
      again.disabled = true;
      try { await post('/api/props/' + encodeURIComponent(_s.added.id) + '/read', {}); _s.info = Object.assign({}, i, { reading: true, fail: '' }); _s.polls = 0; _render(); _follow(); }
      // (phase V73 block 2) the press failed: in the corner; the description's own state stays as it was
      catch (e) { again.disabled = false; showError(e.message); }
    });
    body.appendChild(again);
  }
  body.appendChild(el('div', 'pw-note', 'Change the name, your words or the description in its viewer - open it in Props.'
    + ' The frames chat takes it into its product place.'));
  right.appendChild(body);
  const foot = el('div', 'gw-foot');
  const row = el('div', 'gw-row');
  row.appendChild(el('span', 'gw-hint'));
  const more = el('button', 'gw-create u-btn is-main', 'add another');
  more.type = 'button';
  more.title = 'A new product - the window empties';
  more.addEventListener('click', () => { clearTimeout(_poll); _s = _blank(); _render(); });
  row.appendChild(more);
  foot.appendChild(row);
  right.appendChild(foot);
  return right;
}
