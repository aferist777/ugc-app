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
import { genPrompt, genPromptFrom, refEditPrompt } from './presets.js';
import { genName } from './schema.js';
import * as Gear from './gear.js';
import * as SavePanel from './save-panel.js';
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
// Everything generates at 3:2, and that is not a setting - it is what the page is. The preset
// examples were made at that ratio, so a generated face lands looking like the example that sold
// it, and the reference sheet downstream expects the same shape.
//
// Which engine and which quality tier IS a setting, and it lives behind the gear. Sending no
// engine is legitimate: the server then picks its own default, which is what happens if the gear
// could not load its list.
let _gear = { t2i: () => null, i2i: () => null };

// The face currently in the middle column. `base64` for one that arrived as a data URL (TPDNE,
// which the server deliberately never writes to disk) and `path` for one that exists as a file
// - the edit route takes either, and this is what decides which it gets. `name` is carried for
// the Save card, which is not built yet: dropping it here would lose what the user typed.
// `source` is 'tpdne' | 'upload' | '' and outlives the arrival, because the two references are
// treated differently downstream: a TPDNE head has nothing worth preserving and is converted to
// the house format, while an upload keeps its own framing, clothing and background.
// `figure` is what the PAGE knows about the build - the body dropdown, when the image was built
// from parameters. It beats the framing agent's read of a face, so it travels with the save. For
// a reference we leave it empty and let the agent decide, because we genuinely do not know.
let _face = { src: '', base64: '', path: '', name: '', source: '', figure: '' };
// One job at a time. Two overlays on one host would stack, and the second to finish would lift
// a blur the first still wants.
let _busy = false;
// Panel handles: the ref state's, so discarding a face also clears the instruction that
// described it, and the head's, so a new reference can be named without reaching into its DOM.
let _refPanel = null;
let _headPanel = null;
let _savePanel = null;
let _savedId = '';                   // the character created in this save stage, if any
let _sideWasOpen = true;             // what the looks column was doing before the stage took it

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

// The 4K sheet, from a save that has already returned. Its taskId does not exist yet when the
// save answers - the kickoff is deliberately asynchronous so a throttled engine never blocks the
// save - so the record is watched until it names one, the way character-redesign.js does it.
// Six minutes: nano-banana-2 at 4K is slow, and the route retries a 429 up to three times.
async function _awaitSheet(charId, knownTask) {
  const deadline = Date.now() + 6 * 60 * 1000;
  let taskId = knownTask ? String(knownTask) : '';
  for (;;) {
    if (Date.now() > deadline) throw new Error('the sheet did not arrive within six minutes');
    if (!taskId) {
      const d = await (await fetch('/api/char-store/list')).json();
      const rec = ((d && d.chars) || []).find(c => String(c.id) === String(charId));
      if (rec && rec.sheet) return rec.sheet;          // already resolved by someone else
      if (rec && rec.sheetTask) taskId = String(rec.sheetTask);
      else { await _sleep(2000); continue; }
    }
    const q = '?charId=' + encodeURIComponent(charId) + '&kind=sheet';
    const s = await (await fetch('/api/char-store/ref-status/' + encodeURIComponent(taskId) + q)).json();
    if (!s || !s.success) throw new Error((s && s.error) || 'could not read the sheet status');
    if (s.state === 'success') {
      if (!s.imagePath) throw new Error('the sheet finished without an image');
      return s.imagePath;
    }
    if (s.state === 'failed') throw new Error(s.error || 'the sheet generation failed');
    await _sleep(3000);
  }
}

// Everything a generation needs around it, in one place: the overlay over the thing being
// made, every control locked while it runs, and one job at a time. The action itself only has
// to describe what it wants.
function _controls() {
  return [
    $('cv2-name'), $('cv2-rnd'), $('cv2-gen'), $('cv2-preset'),
    document.querySelector('.cv2-tpdne'), $('cv2-refine'), $('cv2-apply'),
    // Leaving ref mode mid-job would discard the face the job is still working on.
    $('cv2-refout'), $('cv2-upload'),
    // And the save form's own buttons, so a running job locks them like everything else.
    $('cv2-savemodel'), $('cv2-save-cancel'), $('cv2-save-go'), $('cv2-save-retry'),
  ];
}

// fn receives the progress handle, so a job with two steps can say which one it is on. The EMA
// stays keyed to the label it STARTED with, which is right: one job, one timing.
async function _run(label, fn) {
  if (_busy) { _status('Already generating - one at a time', 'err'); return; }
  _busy = true;
  const unlock = lockControls(_controls());
  const pr = startProgress($('cv2-drop'), { label, total: 1 });
  try {
    await fn(pr);
    pr.finish();                 // records the duration, so the next countdown is sharper
    _status('');
  } catch (e) {
    pr.fail(e.message);          // stays up until clicked, so a failure is not missed
    _status(e.message, 'err');
  } finally {
    // unlock restores exactly what it disabled, which would hand the ref button back as enabled
    // over a field the job just emptied. The panel's own rule gets the last word.
    unlock();
    if (_refPanel) _refPanel.sync();
    if (_savePanel) _savePanel.sync();
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
// main: build a face from the dropdowns. ref: a face arrived from outside - TPDNE or the user's
// own upload - which no set of dropdowns describes, so it is steered by words instead. Two ways
// back: the 5px arrow above the field, or the cross on the image. Both discard the face.
function setCreateMode(mode) {
  const m = mode === 'ref' ? 'ref' : 'main';
  document.body.dataset.createMode = m;
  try { localStorage.setItem(LS_CMODE, m); } catch (e) {}
}

// A face landed in the middle. Everything that makes one goes through here: it fills the drop
// field, mirrors the portrait into the card, records what the face IS so an edit can be sent
// against it, and switches the create column to ref mode when the face arrived from outside.
//
// `source` says where it came from, and it decides more than the mode. 'tpdne' and 'upload' are
// NEW references - a different person - so each gets a fresh name and clears an instruction that
// described whoever was there before. 'gen' is a generated result: the same person one step
// further on, so name, mode and typed text all stay put.
//
// It also says what to do NEXT with the image, which is why a conversion overwrites it. Only
// 'tpdne' means "a bare crop that still has to become the house portrait"; once that has
// happened the result is 'gen', and from then on edits preserve the frame instead of rebuilding
// it. An upload is in the same position from the start.
//
// The one writer of _face, deriving the shape from the src rather than trusting each caller to
// split it - a data URL has to travel as base64 because it is on no disk, a generated file
// travels as its path.
function showFace(src, source) {
  const drop = $('cv2-drop');
  const hint = $('cv2-drop-hint');
  if (!drop) return;
  drop.querySelectorAll('img, .cv2-drop-del').forEach(n => n.remove());
  if (!src) {
    _face = { src: '', base64: '', path: '', name: '', source: '', figure: '' };
    if (hint) hint.style.display = '';
    _paintPortrait(null);
    if (_refPanel) _refPanel.clear();    // the instruction described a face that is gone
    if (_headPanel) _headPanel.setName('');
    setCreateMode('main');               // no image, so back to the dropdowns
    return;
  }
  const isNew = source === 'tpdne' || source === 'upload';
  const isData = src.startsWith('data:');
  _face = {
    src,
    base64: isData ? src.slice(src.indexOf(',') + 1) : '',
    path: isData ? '' : src,
    name: _face.name,
    source: source || _face.source,
    figure: _face.figure,
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
  // A new reference is a new person: name it, and drop an instruction meant for the last one.
  if (isNew) {
    _face.name = genName();
    if (_headPanel) _headPanel.setName(_face.name);
    if (_refPanel) _refPanel.clear();
    setCreateMode('ref');
  }
  // The button's meaning follows the source, and a generated result inherits the source it came
  // from - an edited upload is still an upload, so it keeps being edited in place.
  if (_refPanel) _refPanel.setSource(_face.source);
  // Nothing to save until there is something in the middle.
  const sm = $('cv2-savemodel');
  if (sm) sm.disabled = !_face.src;
}

// ── The user's own image as the reference ───────────────────────────────────
// Two ways in, because the empty field reads as both: click it to pick a file, or drop one on
// it. It then behaves exactly like a TPDNE face - same ref mode, same instruction field - and
// the difference is only what happens later: an upload keeps its framing, clothing and
// background, where a TPDNE head has none worth keeping.
const _UPLOAD_MAX = 20 * 1024 * 1024;

function _wireUpload() {
  const drop = $('cv2-drop');
  if (!drop) return;

  const inp = document.createElement('input');
  inp.type = 'file';
  inp.id = 'cv2-upload';
  inp.accept = 'image/*';
  inp.hidden = true;
  drop.appendChild(inp);

  const take = (file) => {
    if (!file) return;
    if (!/^image\//.test(file.type || '')) { _status('That file is not an image', 'err'); return; }
    if (file.size > _UPLOAD_MAX) {
      _status('That image is ' + Math.round(file.size / 1048576) + ' MB - the limit is 20', 'err');
      return;
    }
    const fr = new FileReader();
    fr.onerror = () => _status('Could not read that file', 'err');
    // Reading is asynchronous, so the guard has to be here as well as at the drop: a job can
    // start in between, and landing a new reference mid-flight would swap the image the running
    // job is about to write over.
    fr.onload = () => {
      if (_busy) { _status('Busy generating - drop it again in a moment', 'err'); return; }
      _status('');
      showFace(String(fr.result), 'upload');
    };
    fr.readAsDataURL(file);
  };

  inp.addEventListener('change', () => {
    // Hold the File itself BEFORE clearing the input: value='' empties the live FileList, so
    // reading files afterwards finds nothing. Clearing at all is what lets the same file be
    // picked twice in a row and still fire.
    const f = (inp.files && inp.files[0]) || null;
    inp.value = '';
    take(f);
  });

  drop.addEventListener('click', (e) => {
    if (_busy || _face.src) return;        // an image is showing: the cross is how it goes
    if (e.target.closest('.cv2-drop-del')) return;
    inp.click();
  });

  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, (e) => {
    e.preventDefault();
    if (!_busy) drop.classList.add('is-drag');
  }));
  ['dragleave', 'dragend'].forEach(ev => drop.addEventListener(ev, () => drop.classList.remove('is-drag')));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('is-drag');
    if (_busy) return;
    take((e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) || null);
  });
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

// ── The save stage ──────────────────────────────────────────────────────────
// A layer over the mode rather than a mode of its own, because it breaks the pair's invariant:
// both left columns shut at once. As an overlay the invariant is never violated, only overruled,
// and leaving restores whatever mode was underneath without having to remember it.
//
// Not remembered across a reload on purpose. The stage is about an image held in memory; coming
// back to a form with nothing behind it would be a dead end.
function setStage(stage) {
  const s = stage === 'save' ? 'save' : '';
  if (s) {
    _sideWasOpen = !$('cv2-side').classList.contains('is-collapsed');
    document.body.dataset.stage = s;
    setSideOpen(true);              // the form lives in that column, so it has to be open
  } else {
    delete document.body.dataset.stage;
    setSideOpen(_sideWasOpen);      // give the column back the state the stage borrowed
    _savedId = '';
  }
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
  // No image survives a reload, so ref mode would strand the column with no face to steer.
  // Start from the parameters until generation persists what it made.
  setCreateMode(cmode === 'ref' ? 'main' : cmode);

  // A face from outside, described by no dropdown. Deliberately never written to disk: it
  // travels as a data URL and an edit sends it back as base64. Pressing TPDNE again simply
  // fetches another - the button stays put in both states, which is what makes that possible.
  const onTpdne = () => _run('Fetching a face…', async () => {
    const d = await (await fetch('/api/random-face')).json();
    if (!d || !d.success) throw new Error((d && d.error) || 'TPDNE did not answer with a face');
    showFace(d.dataUrl, 'tpdne');
  });

  // Create sends the prompt the field is showing - the same string, so what you read is what
  // gets generated - with the realism markers and wardrobe appended by genPrompt(), which is
  // generation policy rather than something anyone edits here.
  const onGenerate = (values, name) => _run('Generating the character…', async () => {
    const r = await (await fetch('/api/character-v2/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // No reference image, so the route reads this as text-to-image and fixes the aspect at 3:2
      // itself - there is nothing to match against.
      body: JSON.stringify({ prompt: genPrompt(values), ...(_gear.t2i() || {}) }),
    })).json();
    if (!r || !r.success) throw new Error((r && r.error) || 'the engine refused the prompt');
    showFace(await _poll(r.taskId), 'gen');
    _face.name = name || '';         // after showFace, which preserves whatever name is set
    // The build the user actually chose. It travels to the sheet, where it beats a guess read
    // off a face - and a head-and-shoulders portrait is exactly the case where that matters.
    _face.figure = values.body || '';
    if (_headPanel && name) _headPanel.setName(name);
  });

  // The name lives above both panels and the TPDNE button below them, so that neither moves
  // when the column flips. Head first: the ref panel names a face the moment one arrives.
  const hhost = $('cv2-create-head-host');
  if (hhost) _headPanel = CreatePanel.buildHead(hhost, { onGenerate });
  const host = $('cv2-create-main-host');
  if (host) CreatePanel.build(host, { onGenerate });
  const fhost = $('cv2-create-foot-host');
  if (fhost) CreatePanel.buildFoot(fhost, { onTpdne });

  // The ref state's panel. Its Apply edits the face already in the middle column, which is why
  // it is a separate action from Create rather than a second one.
  const rhost = $('cv2-create-ref-host');
  if (rhost) {
    _refPanel = CreatePanel.buildRef(rhost, {
      // Two steps, and the first can say no. The analyzer reads the reference together with
      // whatever was typed - in any language - and answers with prompt material or a refusal;
      // the generator never sees the raw text. A refusal costs no engine call, which is the
      // whole reason it is its own request.
      onApply: (text) => _run('Reading the reference…', async (pr) => {
        if (!_face.src) throw new Error('Nothing to work from - take a face from TPDNE or drop your own image');
        const ref = _face.base64 ? { imageBase64: _face.base64 } : { imagePath: _face.path };

        const a = await (await fetch('/api/character-v2/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...ref, text }),
        })).json();
        if (!a || !a.success) throw new Error((a && a.error) || 'the analyzer failed');
        if (!a.ok) throw new Error(a.reason);      // a "no", shown where a failure would be

        // A bare TPDNE crop is converted into the house portrait; anything else is edited where
        // it stands. Same two prompts the page shows for Create, one description apart.
        const convert = _face.source === 'tpdne';
        const prompt = convert ? genPromptFrom(a.who) : refEditPrompt(a.who, a.change);
        pr.tick(convert ? 'Building the portrait…' : 'Applying the change…');

        const g = await (await fetch('/api/character-v2/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // imageUrl, not the image again: analyze already put it on imgbb and said where.
          body: JSON.stringify({
            prompt, imageUrl: a.imageUrl, ...(_gear.i2i() || {}),
            aspect: convert ? '3:2' : 'match_input_image',
          }),
        })).json();
        if (!g || !g.success) throw new Error((g && g.error) || 'the engine refused the prompt');

        showFace(await _poll(g.taskId), 'gen');
        _refPanel.clear();               // this instruction has been carried out
      }),
      // The 5px arrow. Discarding the face IS the exit: the column has nothing to steer without
      // one, and another reference costs nothing.
      onExit: () => showFace(null),
    });
  }

  _wireUpload();

  // ── Save model ──
  // The image in the middle is the identity source, never stored on the character itself: the
  // sheet is what gets kept, which is why the sheet is what the 2/5 field ends up showing.
  const shost = $('cv2-save-host');
  if (shost) {
    _savePanel = SavePanel.build(shost, {
      onCancel: () => { setStage(''); _status('Nothing was saved'); },
      // Once saved the character is real, so this only leaves the stage - and takes the list with
      // it, since there is now one more character in it.
      onDone: () => { const id = _savedId; setStage(''); loadChars().then(() => { if (id) select(id); }); },

      onSave: ({ name, gender }) => _run('Saving the character…', async (pr) => {
        const body = { name, gender, figure: _face.figure || '' };
        if (_face.base64) body.faceImageBase64 = _face.base64; else body.faceImagePath = _face.path;
        const r = await (await fetch('/api/char-store/create', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        })).json();
        if (!r || !r.success) throw new Error((r && r.error) || 'the character could not be saved');

        // The record exists from here on, and nothing below undoes it. `sheet` rather than
        // `saved`: the sheet is still being made, and Done stays shut until it stops - leaving
        // now is how a character ends up without the one asset Scenarios reads.
        _savedId = String(r.char.id);
        _savePanel.setState('sheet');
        _savePanel.status('Saved. The 4K sheet is generating…');
        pr.tick('Generating the 4K sheet…');
        try {
          showFace(await _awaitSheet(_savedId), 'gen');
          _savePanel.setState('saved');
          _savePanel.status('The sheet is ready.', 'ok');
        } catch (e) {
          _savePanel.setState('saved');   // stopped, badly - so Done and Regenerate both open up
          _savePanel.status(e.message + ' - the character is saved; try Regenerate sheet.', 'err');
          throw e;                        // so the overlay reports it too
        }
      }),

      onRetrySheet: () => _run('Regenerating the sheet…', async () => {
        if (!_savedId) throw new Error('nothing has been saved yet');
        const r = await (await fetch('/api/char-store/regen-ref', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ charId: _savedId, figure: _face.figure || '' }),
        })).json();
        if (!r || !r.success) throw new Error((r && r.error) || 'the sheet could not be resubmitted');
        _savePanel.setState('sheet');     // shut the exit again for as long as this runs
        _savePanel.status('Generating…');
        try {
          showFace(await _awaitSheet(_savedId, r.taskId), 'gen');
          _savePanel.setState('saved');
          _savePanel.status('The sheet is ready.', 'ok');
        } catch (e) {
          _savePanel.setState('saved');
          _savePanel.status(e.message, 'err');
          throw e;
        }
      }),
    });

    $('cv2-savemodel').addEventListener('click', () => {
      if (!_face.src) return;
      _savePanel.open({ name: _face.name || ($('cv2-name') && $('cv2-name').value.trim()) || '' });
      setStage('save');
    });
  }

  // Last, and not awaited: it fetches its engine list, and nothing above needs to wait for that.
  // Until it answers, _gear returns null and a generation simply sends no engine, which the
  // server reads as "use your default".
  Gear.init($('cv2-gear-host'), $('cv2-gear')).then(g => { _gear = g; });

  setMode(mode);
  setSideOpen(side);          // the looks panel starts open, as asked
  loadChars();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
