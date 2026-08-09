// Scenarios v3 — the Fragments column: one card per line of the open project.
//
//   [n] [ mix 3:4 ] [ the full line, editable ] [ video 3:4 ]
//
// Both media fields are the same size and 3:4, and they only ever hold a
// THUMBNAIL — never the full asset. They stay empty until the mix and video
// phases fill them; the video's first-frame poster and its click-to-play popup
// are deliberately left for the generation phase.
//
// Editing a line writes to the PROJECT only. The scenario in the library keeps
// the wording it was saved with.

import { onProjectChange, patchProject } from './projects.js';
import { thumbImg } from './chars.js';

const SAVE_WAIT = 600;

const $ = id => document.getElementById(id);

let _project = null;
let _lines   = [];
let _saveT   = null;
let _saving  = false;
let _reSave  = false;
let _dirty   = false;

function _status(text, kind) {
  const n = $('sv3-frag-status');
  if (!n) return;
  n.textContent = text || '';
  n.className = 'sv3-status' + (kind ? ' ' + kind : '');
}

// A media field: a tag, and either a thumbnail or an empty placeholder.
// onPick makes the field a chooser (used for the mix slot).
function _media(tag, fullPath, onPick) {
  const box = document.createElement('div');
  box.className = 'sv3-frag-media' + (onPick ? ' pickable' : '');

  const t = document.createElement('div');
  t.className = 'sv3-frag-mtag';
  t.textContent = tag;
  box.appendChild(t);

  if (fullPath) {
    box.appendChild(thumbImg(fullPath, null, { noFit: true }));   // thumbnail only
  } else {
    const ph = document.createElement('div');
    ph.className = 'sv3-frag-mph';
    ph.textContent = '+';
    box.appendChild(ph);
  }
  if (onPick) {
    box.title = 'Pick a first frame for this fragment';
    box.addEventListener('click', (e) => { e.stopPropagation(); onPick(box); });
  }
  return box;
}

// The approved pool of the open project, in approval order.
function _pool() {
  const mix = (_project && _project.mix) || {};
  const variants = mix.variants || [];
  return (mix.approved || [])
    .filter(id => !(mix.banned || []).includes(id))
    .map(id => variants.find(v => v.id === id))
    .filter(Boolean);
}
const _frameById = (id) => (((_project && _project.mix) || {}).variants || []).find(v => v.id === id) || null;

// Flyout of approved frames, anchored to the slot that opened it.
let _pickFly = null;
function _closePick() { if (_pickFly) { _pickFly.remove(); _pickFly = null; } }

function _openPick(anchor, idx) {
  _closePick();
  const pool = _pool();
  const el = document.createElement('div');
  el.className = 'sv3-frag-pick';
  if (!pool.length) {
    const e = document.createElement('div');
    e.className = 'sv3-frag-pickempty';
    e.textContent = 'No approved frames yet — build them in Build mix.';
    el.appendChild(e);
  }
  pool.forEach(v => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sv3-frag-pickit' + (_lines[idx] && _lines[idx].frameId === v.id ? ' on' : '');
    b.appendChild(thumbImg(v.path, null, { noFit: true }));
    b.addEventListener('click', () => {
      _lines[idx].frameId = v.id;
      _closePick(); _dirty = true; _flush(); _render();
    });
    el.appendChild(b);
  });
  // clearing the choice
  if (_lines[idx] && _lines[idx].frameId) {
    const clr = document.createElement('button');
    clr.type = 'button';
    clr.className = 'sv3-frag-pickclear';
    clr.textContent = 'clear';
    clr.addEventListener('click', () => {
      _lines[idx].frameId = '';
      _closePick(); _dirty = true; _flush(); _render();
    });
    el.appendChild(clr);
  }
  document.body.appendChild(el);
  _pickFly = el;

  const a = anchor.getBoundingClientRect();
  const w = el.offsetWidth, h = el.offsetHeight;
  let left = Math.min(a.right + 8, Math.max(8, window.innerWidth - w - 8));
  let top  = Math.min(Math.max(a.top, 8), Math.max(8, window.innerHeight - h - 8));
  el.style.left = Math.round(left) + 'px';
  el.style.top  = Math.round(top) + 'px';
  setTimeout(() => {
    document.addEventListener('click', function once(ev) {
      if (el.contains(ev.target)) return;
      _closePick(); document.removeEventListener('click', once);
    });
  }, 0);
}

function _render() {
  const box = $('sv3-frags');
  if (!box) return;
  box.textContent = '';

  if (!_project) {
    const e = document.createElement('div');
    e.className = 'sv3-empty';
    e.textContent = 'Open a project to see its fragments.';
    box.appendChild(e);
    return;
  }
  if (!_lines.length) {
    const e = document.createElement('div');
    e.className = 'sv3-empty';
    e.textContent = 'This project has no lines.';
    box.appendChild(e);
    return;
  }

  _lines.forEach((ln, i) => {
    const card = document.createElement('div');
    card.className = 'sv3-frag';

    const n = document.createElement('div');
    n.className = 'sv3-frag-n';
    n.textContent = String(i + 1);

    const text = document.createElement('div');
    text.className = 'sv3-frag-text';
    text.contentEditable = 'true';
    text.spellcheck = false;
    text.dataset.idx = String(i);
    text.textContent = ln.text || '';
    text.addEventListener('input', _onEdit);

    const frame = ln.frameId ? _frameById(ln.frameId) : null;
    card.append(
      n,
      _media('mix', frame ? frame.path : '', (anchor) => _openPick(anchor, i)),
      text,
      _media('video', ln.videoThumb || ''),
    );
    box.appendChild(card);
  });
}

function _onEdit(e) {
  const i = +e.target.dataset.idx;
  if (!Number.isInteger(i) || !_lines[i]) return;
  _lines[i].text = e.target.textContent || '';
  clearTimeout(_saveT);
  _dirty = true;
  _status('editing…');
  _saveT = setTimeout(_flush, SAVE_WAIT);
}

async function _flush() {
  if (!_project || !_dirty) return;
  if (_saving) { _reSave = true; return; }
  _saving = true;
  _dirty  = false;
  const id = _project.id;
  try {
    // lines only — text plus whichever first frame the fragment is tied to
    await patchProject({ lines: _lines.map(l => ({ text: l.text || '', frameId: l.frameId || '' })) });
    if (_project && String(_project.id) === String(id)) _status('saved', 'ok');
  } catch (e) {
    _dirty = true;   // keep it pending so the next flush retries
    _status('save failed: ' + e.message, 'err');
  } finally {
    _saving = false;
    if (_reSave) { _reSave = false; _flush(); }
  }
}

export function initFragments() {
  onProjectChange((project) => {
    clearTimeout(_saveT);
    _dirty = false;
    _project = project;
    _lines = project ? (project.lines || []).map(l => ({ ...l })) : [];
    _status('');
    _render();
  });
  _render();
}
