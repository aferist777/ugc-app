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
import * as CreatePanel from './create-panel.js';
import { genPrompt } from './presets.js';
// The house style for "this is being generated" - the target blurs behind a spinner, a bar and
// a countdown that learns from previous runs. Shared with the scenarios page rather than
// reimplemented, so both pages wait the same way and one EMA teaches both.
import { startProgress, lockControls } from '../scenarios-v3/progress.js';

const $ = (id) => document.getElementById(id);

// Remembered, so reopening the page puts you back where you were. storage-sync.js mirrors
// these to the server automatically, so it survives a different browser too.
const LS_MODE = 'cv2_mode_v1';
const LS_CHAR = 'cv2_char_v1';
const LS_SIDE = 'cv2_side_open_v1';
const LS_CMODE = 'cv2_create_mode_v1';

let _chars = [];
let _cur = '';

// ── Generation ──────────────────────────────────────────────────────────────
// 3:2 through z-image by default. The ratio is not cosmetic: the preset examples were made at
// this size with this engine, so a generated face lands looking like the example that sold it.
// Only z-turbo honours an explicit width and height - the other engines in the route take a
// fixed aspect - which is the other reason it is the default here.
const GEN_ENGINE = 'z-turbo';
const GEN_W = 1152, GEN_H = 768;

// The face currently in the middle column. `base64` for one that arrived as a data URL (TPDNE,
// which the server deliberately never writes to disk) and `path` for one that exists as a file
// - the edit route takes either, and this is what decides which it gets. `name` is carried for
// the Save card, which is not built yet: dropping it here would lose what the user typed.
let _face = { src: '', base64: '', path: '', name: '' };
// One job at a time. Two overlays on one host would stack, and the second to finish would lift
// a blur the first still wants.
let _busy = false;
// The text state's handle, so deleting the image can also clear the instruction that described
// it. Set when that panel is built.
let _textPanel = null;

function _status(text, kind) {
  const el = $('cv2-status');
  if (!el) return;
  el.textContent = text || '';
  el.className = 'cv2-status' + (kind ? ' ' + kind : '');
}

const _sleep = (ms) => new Promise(r => setTimeout(r, ms));

// The status endpoint answers with one poll of the provider, so looping is the caller's job.
// It waits first: a task created a moment ago is never already finished, so an immediate poll
// only costs a request.
async function _poll(taskId, { timeoutMs = 240000, everyMs = 1500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await _sleep(everyMs);
    const d = await (await fetch('/api/status/' + encodeURIComponent(taskId))).json();
    if (!d || !d.success) throw new Error((d && d.error) || 'could not read the task status');
    if (d.state === 'success') {
      if (!d.imagePath) throw new Error('the job finished without an image');
      return d.imagePath;
    }
    if (d.state === 'failed') throw new Error(d.error || 'generation failed');
    if (Date.now() > deadline) throw new Error('timed out after ' + Math.round(timeoutMs / 1000) + 's');
  }
}

// Everything a generation needs around it, in one place: the overlay over the thing being
// made, every control locked while it runs, and one job at a time. The action itself only has
// to describe what it wants.
function _controls() {
  return [
    $('cv2-name'), $('cv2-rnd'), $('cv2-gen'), $('cv2-preset'),
    document.querySelector('.cv2-tpdne'), $('cv2-refine'), $('cv2-apply'),
  ];
}

async function _run(label, fn) {
  if (_busy) { _status('Already generating - one at a time', 'err'); return; }
  _busy = true;
  const unlock = lockControls(_controls());
  const pr = startProgress($('cv2-drop'), { label, total: 1 });
  try {
    await fn();
    pr.finish();                 // records the duration, so the next countdown is sharper
    _status('');
  } catch (e) {
    pr.fail(e.message);          // stays up until clicked, so a failure is not missed
    _status(e.message, 'err');
  } finally {
    // unlock restores exactly what it disabled, which would hand Apply back as enabled even
    // though the job just emptied the field it applies. So the last word on that button is the
    // field's content, not what the lock remembered.
    unlock();
    const ta = $('cv2-refine'), ap = $('cv2-apply');
    if (ta && ap) ap.disabled = !ta.value.trim();
    _busy = false;
  }
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
  // The side column shows looks in view and the character card in create, so its label has
  // to follow. Which PANEL is visible is CSS's job; only the words are set here.
  const t = $('cv2-side-title'), sp = $('cv2-side-spine');
  if (t) t.textContent = m === 'create' ? 'Model' : 'Looks';
  if (sp) sp.textContent = m === 'create' ? 'Model' : 'Looks';
  try { localStorage.setItem(LS_MODE, m); } catch (e) {}
}

// ── The create column's own two states ──────────────────────────────────────
// main: build a face from the dropdowns. text: a face arrived from TPDNE, which no set of
// dropdowns describes, so it is steered by words instead. Deleting the image in the middle
// is the way back - that is the only exit, because the image is what put us here.
function setCreateMode(mode) {
  const m = mode === 'text' ? 'text' : 'main';
  document.body.dataset.createMode = m;
  try { localStorage.setItem(LS_CMODE, m); } catch (e) {}
}

// A face landed in the middle. Everything that makes one goes through here: it fills the drop
// field, mirrors the portrait into the card, records what the face IS so an edit can be sent
// against it, and puts the create column into text mode when the face came from TPDNE rather
// than from the parameters.
//
// The one writer of _face, deriving the shape from the src rather than trusting each caller to
// split it - a data URL has to travel as base64 because it is on no disk, a generated file
// travels as its path. Passing fromTpdne=false leaves the mode alone, which is what an edit
// wants: it produced a new file but we are still steering by text.
function showFace(src, fromTpdne) {
  const drop = $('cv2-drop');
  const hint = $('cv2-drop-hint');
  if (!drop) return;
  drop.querySelectorAll('img, .cv2-drop-del').forEach(n => n.remove());
  if (!src) {
    _face = { src: '', base64: '', path: '', name: _face.name };
    if (hint) hint.style.display = '';
    _paintPortrait(null);
    if (_textPanel) _textPanel.clear();  // the instruction described a face that is gone
    setCreateMode('main');               // no image, so back to the dropdowns
    return;
  }
  const isData = src.startsWith('data:');
  _face = {
    src,
    base64: isData ? src.slice(src.indexOf(',') + 1) : '',
    path: isData ? '' : src,
    name: _face.name,
  };
  if (hint) hint.style.display = 'none';
  const img = document.createElement('img');
  img.src = src;
  img.alt = 'generated face';
  drop.appendChild(img);
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'cv2-drop-del';
  del.title = 'Delete this image and go back to the parameters';
  del.textContent = '✕';
  del.addEventListener('click', () => showFace(null));
  drop.appendChild(del);
  _paintPortrait(src);
  if (fromTpdne) setCreateMode('text');
}

function _paintPortrait(src) {
  const slot = $('cv2-card-portrait');
  if (!slot) return;
  if (!src) {
    slot.className = 'cv2-card-portrait-ph';
    slot.textContent = 'Portrait appears once a face exists';
    slot.removeAttribute('style');
    return;
  }
  slot.className = 'cv2-card-portrait';
  slot.textContent = '';
  slot.style.backgroundImage = 'url("' + src + '")';
  slot.style.backgroundSize = 'cover';
  slot.style.backgroundPosition = 'center top';
}

// Exposed so the panels built in the next step can drive this without importing it.
window.cv2 = { showFace, setCreateMode, setMode };

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
  const naming = document.body.dataset.mode === 'view';   // in create the column is the card
  if (!c) { if (naming) title.textContent = 'Looks'; return; }
  try {
    const d = await (await fetch('/api/library/looks/' + encodeURIComponent(c.id))).json();
    if (!d || !d.success) throw new Error((d && d.error) || 'read failed');
    if (naming) title.textContent = 'Looks · ' + d.items.length;
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

  let mode = 'view', side = true, cmode = 'main';
  try {
    mode = localStorage.getItem(LS_MODE) || 'view';
    side = (localStorage.getItem(LS_SIDE) || '1') === '1';
    cmode = localStorage.getItem(LS_CMODE) || 'main';
  } catch (e) {}
  // No image survives a reload yet, so text mode would strand the column with nothing to
  // refine. Start from the parameters until generation persists what it made.
  setCreateMode(cmode === 'text' ? 'main' : cmode);

  // The parameters panel. Create sends the prompt the field is showing - the same string, so
  // what you read is what gets generated - with the realism markers and wardrobe appended by
  // genPrompt(), which is generation policy rather than something anyone edits here.
  const host = $('cv2-create-main-host');
  if (host) {
    CreatePanel.build(host, {
      onGenerate: (values, name, preset) => _run('Generating the character…', async () => {
        _face.name = name || '';         // kept for the Save card, which comes later
        const r = await (await fetch('/api/character-creator/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: genPrompt(values), imageEngine: GEN_ENGINE, width: GEN_W, height: GEN_H,
          }),
        })).json();
        if (!r || !r.success) throw new Error((r && r.error) || 'the engine refused the prompt');
        showFace(await _poll(r.taskId), false);
      }),
      // A face from outside, described by no dropdown - so it arrives and the column switches
      // to steering by words. Deliberately never written to disk: it travels as a data URL and
      // an edit sends it back as base64.
      onTpdne: () => _run('Fetching a face…', async () => {
        const d = await (await fetch('/api/random-face')).json();
        if (!d || !d.success) throw new Error((d && d.error) || 'TPDNE did not answer with a face');
        showFace(d.dataUrl, true);
      }),
    });
  }

  // The text state's panel. Its Apply edits the face already in the middle column, which is
  // why it is a separate action from Create rather than a second one.
  const thost = $('cv2-create-text-host');
  if (thost) {
    _textPanel = CreatePanel.buildText(thost, {
      onApply: (text) => _run('Applying the change…', async () => {
        if (!_face.src) throw new Error('No face to edit - generate one or take one from TPDNE');
        const body = { extraInstruction: text, withRealism: false };
        // Whichever form the current face is in. withRealism stays off on purpose: the base
        // already carries the markers, and re-applying them on every edit compounds them.
        if (_face.base64) body.faceBase64 = _face.base64; else body.imagePath = _face.path;
        const r = await (await fetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })).json();
        if (!r || !r.success) throw new Error((r && r.error) || 'the edit was refused');
        // false, so the mode is left alone - the edit made a new file but we are still in text.
        showFace(await _poll(r.taskId), false);
        _textPanel.clear();              // this instruction has been applied
      }),
    });
  }

  setMode(mode);
  setSideOpen(side);          // the looks panel starts open, as asked
  loadChars();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
