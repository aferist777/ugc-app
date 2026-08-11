// CHARACTER v2 — the shell.
//
// Four columns in a fixed order: create, characters, work, looks. `create` and `characters`
// are two states of ONE layout rather than two screens - expanding either collapses the
// other, so "create model" and "view model" are the same page in two positions. That is why
// there is no character popup here: editing happens in the work column, in place.
//
// This phase is the shape, not the features. What IS wired is only what makes the shape
// legible: the real character list, the selected character's sheet, and their looks - all
// from endpoints that already exist (routes/library.js). Everything else says out loud that
// it is not built yet, so an empty column never reads as a broken one.

import { initNav } from '../app-nav.js';

const $ = (id) => document.getElementById(id);

// Remembered, so reopening the page puts you back where you were. storage-sync.js mirrors
// these to the server automatically, so it survives a different browser too.
const LS_MODE = 'cv2_mode_v1';
const LS_CHAR = 'cv2_char_v1';
const LS_SIDE = 'cv2_side_open_v1';

let _chars = [];
let _cur = '';

function _status(text, kind) {
  const el = $('cv2-status');
  if (!el) return;
  el.textContent = text || '';
  el.className = 'cv2-status' + (kind ? ' ' + kind : '');
}

// ── Mode ────────────────────────────────────────────────────────────────────
// One writer for the pair. `view` means the characters column is open and create is a spine;
// `create` is the mirror. Nothing else may set these classes, or the two can end up both
// open (no room for the work column) or both collapsed (nothing to look at).
function setMode(mode) {
  const m = mode === 'create' ? 'create' : 'view';
  document.body.dataset.mode = m;
  $('cv2-create').classList.toggle('is-collapsed', m !== 'create');
  $('cv2-list').classList.toggle('is-collapsed', m !== 'view');
  const tag = $('cv2-mode-tag');
  if (tag) tag.textContent = m;
  try { localStorage.setItem(LS_MODE, m); } catch (e) {}
}

function setSideOpen(open) {
  $('cv2-side').classList.toggle('is-collapsed', !open);
  try { localStorage.setItem(LS_SIDE, open ? '1' : '0'); } catch (e) {}
}

// ── Characters ──────────────────────────────────────────────────────────────
// The same shelf the Library reads, so there is one definition of "a character" and one
// sort order (by number of looks) rather than a second list that drifts from it.
async function loadChars() {
  _status('Reading…');
  try {
    const d = await (await fetch('/api/library/shelf/characters')).json();
    if (!d || !d.success) throw new Error((d && d.error) || 'read failed');
    _chars = d.items || [];
    renderChars();
    $('cv2-count').textContent = String(_chars.length);
    _status('');

    // A page that opens on nothing is a page you have to click before it says anything, so
    // the first character is selected on arrival - unless a remembered one is still here.
    let want = '';
    try { want = localStorage.getItem(LS_CHAR) || ''; } catch (e) {}
    const found = _chars.find(c => String(c.id) === want);
    if (found) select(found.id);
    else if (_chars.length) select(_chars[0].id);
    else renderSheet(null);
  } catch (e) {
    _chars = [];
    renderChars();
    _status(e.message, 'err');
  }
}

function renderChars() {
  const box = $('cv2-chars');
  box.textContent = '';
  if (!_chars.length) {
    const e = document.createElement('div');
    e.className = 'cv2-empty';
    e.textContent = 'No characters yet.';
    box.appendChild(e);
    return;
  }
  for (const c of _chars) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'cv2-item' + (String(c.id) === _cur ? ' cur' : '');
    row.title = c.name;

    const img = document.createElement('img');
    img.className = 'cv2-item-thumb';
    img.alt = c.name;
    img.loading = 'lazy';
    img.decoding = 'async';
    if (c.thumb) img.src = c.thumb;
    row.appendChild(img);

    const txt = document.createElement('div');
    txt.className = 'cv2-item-txt';
    const name = document.createElement('div');
    name.className = 'cv2-item-name';
    name.textContent = c.name;
    const sub = document.createElement('div');
    sub.className = 'cv2-item-sub';
    const n = (c.meta && c.meta.looks) || 0;
    sub.textContent = n + (n === 1 ? ' look' : ' looks') + ((c.meta && c.meta.voices) ? ' · voice' : '');
    txt.appendChild(name); txt.appendChild(sub);
    row.appendChild(txt);

    row.addEventListener('click', () => select(c.id));
    box.appendChild(row);
  }
}

function select(id) {
  _cur = String(id);
  try { localStorage.setItem(LS_CHAR, _cur); } catch (e) {}
  renderChars();
  const c = _chars.find(x => String(x.id) === _cur) || null;
  renderSheet(c);
  loadLooks(c);
}

function renderSheet(c) {
  const box = $('cv2-sheet');
  box.textContent = '';
  $('cv2-work-title').textContent = c ? c.name : 'Character';
  if (!c) {
    const e = document.createElement('div');
    e.className = 'cv2-empty';
    e.textContent = 'Pick a character on the left, or switch to Create.';
    box.appendChild(e);
    return;
  }
  if (c.media) {
    const img = document.createElement('img');
    img.className = 'cv2-sheet-img';
    img.src = c.media;
    img.alt = c.name;
    box.appendChild(img);
  }
  const meta = document.createElement('div');
  meta.className = 'cv2-meta';
  const m = c.meta || {};
  const bits = [];
  if (m.gender) bits.push(m.gender);
  bits.push(((m.looks || 0)) + ' looks');
  if (m.voices) bits.push(m.voices + (m.voices === 1 ? ' voice' : ' voices'));
  if (m.date) {
    const d = new Date(m.date);
    if (!isNaN(d)) bits.push(d.toLocaleDateString('en-GB'));
  }
  for (const b of bits) { const s = document.createElement('span'); s.textContent = b; meta.appendChild(s); }
  box.appendChild(meta);

  // The editing surface belongs here rather than in a popup - that is the point of the
  // layout - but the fields are not built yet.
  const ph = document.createElement('div');
  ph.className = 'cv2-ph';
  const t = document.createElement('div'); t.className = 'cv2-ph-t'; t.textContent = 'View and edit';
  const p = document.createElement('p');
  p.textContent = 'Name, gender, notes and voices are edited here, in place. No popup.';
  const n = document.createElement('p');
  n.className = 'cv2-ph-note';
  n.textContent = 'Fields not wired yet.';
  ph.appendChild(t); ph.appendChild(p); ph.appendChild(n);
  box.appendChild(ph);
}

async function loadLooks(c) {
  const box = $('cv2-looks');
  const title = $('cv2-side-title');
  box.textContent = '';
  if (!c) { title.textContent = 'Looks'; return; }
  try {
    const d = await (await fetch('/api/library/looks/' + encodeURIComponent(c.id))).json();
    if (!d || !d.success) throw new Error((d && d.error) || 'read failed');
    title.textContent = 'Looks · ' + d.items.length;
    if (!d.items.length) {
      const e = document.createElement('div');
      e.className = 'cv2-empty';
      e.textContent = 'No looks for this character yet.';
      box.appendChild(e);
      return;
    }
    for (const l of d.items) {
      const card = document.createElement('div');
      card.className = 'cv2-look';
      card.title = l.name;
      const img = document.createElement('img');
      img.alt = l.name; img.loading = 'lazy'; img.decoding = 'async';
      if (l.thumb) img.src = l.thumb;
      const nm = document.createElement('div');
      nm.className = 'cv2-look-name';
      nm.textContent = l.name;
      card.appendChild(img); card.appendChild(nm);
      box.appendChild(card);
    }
  } catch (e) {
    const err = document.createElement('div');
    err.className = 'cv2-empty';
    err.textContent = e.message;
    box.appendChild(err);
  }
}

function boot() {
  initNav();

  // A collapsed column is one big click target; open ones collapse from the head button.
  $('cv2-create').addEventListener('click', (e) => {
    if ($('cv2-create').classList.contains('is-collapsed')) setMode('create');
  });
  $('cv2-list').addEventListener('click', (e) => {
    if ($('cv2-list').classList.contains('is-collapsed')) setMode('view');
  });
  $('cv2-side').addEventListener('click', () => {
    if ($('cv2-side').classList.contains('is-collapsed')) setSideOpen(true);
  });
  document.querySelectorAll('[data-collapse]').forEach(b => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();                       // or the column's own click reopens it
      const id = b.dataset.collapse;
      if (id === 'cv2-side') return setSideOpen(false);
      // Collapsing one of the pair means opening the other: leaving both shut would leave
      // the page with no way back in.
      setMode(id === 'cv2-create' ? 'view' : 'create');
    });
  });

  let mode = 'view', side = true;
  try {
    mode = localStorage.getItem(LS_MODE) || 'view';
    side = (localStorage.getItem(LS_SIDE) || '1') === '1';
  } catch (e) {}
  setMode(mode);
  setSideOpen(side);          // the looks panel starts open, as asked
  loadChars();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
