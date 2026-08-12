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
import * as Voices from './voices.js';
import * as EditPanel from './edit-panel.js';
// The house style for "this is being generated" - the target blurs behind a spinner, a bar and
// a countdown that learns from previous runs. Shared with the scenarios page rather than
// reimplemented, so both pages wait the same way and one EMA teaches both.
import { startProgress, startInlineProgress, lockControls } from '../scenarios-v3/progress.js';

const $ = (id) => document.getElementById(id);

// Every displayed image goes through the thumbnail door: /api/thumb resizes to the named variant
// and caches by source path plus mtime, so the URL changes when the picture does and the browser
// can hold these forever. A 4096-wide sheet drawn into a 220px cell costs 640 KB to say almost
// nothing, which is what this is for.
//
// Data URLs pass straight through - a TPDNE face or a fresh upload is on no disk, so there is
// nothing for the server to resize.
const _thumb = (src, v) => (src && String(src).startsWith('/'))
  ? ('/api/thumb?v=' + v + '&src=' + encodeURIComponent(src))
  : src;

// Remembered, so reopening the page puts you back where you were. storage-sync.js mirrors
// these to the server automatically, so it survives a different browser too.
const LS_MODE = 'cv2_mode_v1';
const LS_CHAR = 'cv2_char_v1';
const LS_SIDE = 'cv2_side_open_v1';
const LS_CMODE = 'cv2_create_mode_v1';
const LS_FILTER = 'cv2_char_filter_v1';

let _chars = [];
let _cur = '';
// Which list the characters column is showing: the finished ones, or the takes kept with a star
// that still need their sheet. Remembered, like every other choice on this page.
let _charFilter = 'saved';
// The draft being finished, if any. It travels into the save as `id`, which is what makes the
// save OVERWRITE that record and flip its draft flag rather than making a second character.
let _resumeId = '';
let _resumeGender = '';   // the draft's gender, so the save form opens on it

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
let _face = { src: '', base64: '', path: '', name: '', source: '', figure: '', values: null };
// One job at a time. Two overlays on one host would stack, and the second to finish would lift
// a blur the first still wants.
let _busy = false;
// Panel handles: the ref state's, so discarding a face also clears the instruction that
// described it, and the head's, so a new reference can be named without reaching into its DOM.
let _refPanel = null;
let _headPanel = null;
let _savePanel = null;
let _voicePanel = null;
let _editPanel = null;
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
    $('cv2-vc-find'), $('cv2-vc-gender'), $('cv2-vc-lang'), $('cv2-vc-accent'),
    $('cv2-edit-txt'), $('cv2-edit-cancel'), $('cv2-edit-go'),
    // The chips as well: they write into that field, and a tap while a job runs would change what
    // it says after the job had already read it - then lose the change to the clear on success.
    ...document.querySelectorAll('.cv2-chip'),
    ...document.querySelectorAll('.cv2-var-star'),
    ...document.querySelectorAll('.cv2-filter-b'), ...document.querySelectorAll('.cv2-item-x'),
    // Unbinding writes to the character and talks to ElevenLabs, so it queues behind whatever
    // else is running - including the voice search that repaints the very row it sits on.
    ...document.querySelectorAll('.cv2-voice-x'), ...document.querySelectorAll('.cv2-star'),
  ];
}

// The voices' own runner. _run blurs #cv2-drop, which lives in create mode - in view mode it is
// not on screen, so a voice job had no visible progress at all. This puts it in the status row
// instead, the strip right where "no voice yet" sits, and scrolls that row into view first: a
// progress bar you have to go looking for is not one.
async function _runVoice(label, fn) {
  if (_busy) { _status('Already working - one at a time', 'err'); return; }
  _busy = true;
  const unlock = lockControls(_controls());
  const foot = $('cv2-voice-host');
  if (foot) foot.scrollTop = 0;
  const pr = startInlineProgress($('cv2-vc-stat'), { label });
  try {
    await fn();
    pr.finish();
  } catch (e) {
    pr.fail(e.message);
    _status(e.message, 'err');
  } finally {
    unlock();
    if (_savePanel) _savePanel.sync();
    _busy = false;
  }
}

// Text into a new picture, in two steps, and both text paths use it: the reference panel and the
// edit panel ask the same question of the same endpoints. Only the framing differs - a bare TPDNE
// crop is CONVERTED into the house portrait, everything else is edited where it stands - so that
// is the one thing the caller decides.
//
// The analyzer sees the picture together with the words and answers with prompt material or a
// refusal. A refusal costs no engine call, which is why it is its own request.
async function _fromText(text, pr, { convert }) {
  if (!_face.src) throw new Error('Nothing to work from - generate a portrait first');
  const ref = _face.base64 ? { imageBase64: _face.base64 } : { imagePath: _face.path };

  const a = await (await fetch('/api/character-v2/analyze', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...ref, text }),
  })).json();
  if (!a || !a.success) throw new Error((a && a.error) || 'the analyzer failed');
  if (!a.ok) throw new Error(a.reason);          // a "no", shown where a failure would be

  const prompt = convert ? genPromptFrom(a.who) : refEditPrompt(a.who, a.change);
  if (pr) pr.tick(convert ? 'Building the portrait…' : 'Applying the change…');

  const g = await (await fetch('/api/character-v2/generate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    // imageUrl, not the image again: analyze already put it on imgbb and said where.
    body: JSON.stringify({
      prompt, imageUrl: a.imageUrl, ...(_gear.i2i() || {}),
      aspect: convert ? '3:2' : 'match_input_image',
    }),
  })).json();
  if (!g || !g.success) throw new Error((g && g.error) || 'the engine refused the prompt');
  return await _poll(g.taskId);
}

// For work too short to deserve a progress bar - a delete is a file unlink and a JSON write, and
// a bar would only flash. Same locking and the same one-at-a-time rule; the header line reports.
async function _runQuiet(label, fn) {
  if (_busy) { _status('Already working - one at a time', 'err'); return; }
  _busy = true;
  const unlock = lockControls(_controls());
  _status(label);
  try {
    await fn();
  } catch (e) {
    _status(e.message, 'err');
  } finally {
    unlock();
    if (_refPanel) _refPanel.sync();
    if (_editPanel) _editPanel.sync();
    if (_savePanel) _savePanel.sync();
    _busy = false;
  }
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
    if (_editPanel) _editPanel.sync();
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
  if (t) t.textContent = m === 'create' ? 'Model' : 'Scenes';
  if (sp) sp.textContent = m === 'create' ? 'Model' : 'Scenes';

  // The middle column's title follows the mode too. In create it was inheriting whichever
  // character is selected in view, which is a plain lie: that column is showing the portrait
  // being made, not that character.
  //
  // "Portrait" rather than "Created image": the picture is not always something we created - it
  // can be a TPDNE face or the user's own upload - and when a draft is being finished it is not
  // new either. One word that is true in every one of those cases beats four that are not.
  const wt = $('cv2-work-title');
  if (wt) {
    if (m === 'create') wt.textContent = 'Portrait';
    else {
      const cur = _chars.find(x => String(x.id) === _cur);
      wt.textContent = (cur && cur.name) || 'Character';
    }
  }
  try { localStorage.setItem(LS_MODE, m); } catch (e) {}
}

// ── The create column's own two states ──────────────────────────────────────
// main: build a face from the dropdowns. ref: a face arrived from outside - TPDNE or the user's
// own upload - which no set of dropdowns describes, so it is steered by words instead. Two ways
// back: the 5px arrow above the field, or the cross on the image. Both discard the face.
function setCreateMode(mode) {
  const m = (mode === 'ref' || mode === 'edit') ? mode : 'main';
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
    _face = { src: '', base64: '', path: '', name: '', source: '', figure: '', values: null };
    if (hint) hint.style.display = '';
    if (_refPanel) _refPanel.clear();    // the instruction described a face that is gone
    if (_headPanel) _headPanel.setName('');
    _face.values = null;
    // This branch returns early, so it has to shut the save button itself - otherwise it sits
    // there looking available over an empty field. Its handler refuses anyway; a button that
    // refuses is worse than one that says so.
    const sm0 = $('cv2-savemodel');
    if (sm0) sm0.disabled = true;
    _vars = []; _varAt = -1; _paintVars();
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
    values: _face.values || null,
  };
  _paintDrop(src);
  // A new reference is a new person: name it, and drop an instruction meant for the last one.
  if (isNew) {
    _face.name = genName();
    if (_headPanel) _headPanel.setName(_face.name);
    if (_refPanel) _refPanel.clear();
    setCreateMode('ref');
    _vars = []; _varAt = -1; _paintVars();   // a different person starts its own list
  }
  // The button's meaning follows the source, and a generated result inherits the source it came
  // from - an edited upload is still an upload, so it keeps being edited in place.
  if (_refPanel) _refPanel.setSource(_face.source);
  // Nothing to save until there is something in the middle.
  const sm = $('cv2-savemodel');
  if (sm) sm.disabled = !_face.src;
}

// Just the picture, with nothing decided: paging through the variations repaints the middle
// without touching the name, the mode or what the panels think, because none of that has changed
// - only which of the same character's takes is on screen.
function _paintDrop(src) {
  const drop = $('cv2-drop'), hint = $('cv2-drop-hint');
  if (!drop) return;
  drop.querySelectorAll('img, .cv2-drop-del').forEach(n => n.remove());
  if (hint) hint.style.display = src ? 'none' : '';
  if (!src) return;
  const img = document.createElement('img');
  img.src = _thumb(src, 'main');
  img.alt = 'generated face';
  drop.appendChild(img);
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'cv2-drop-del';
  del.title = 'Delete this image and go back to the parameters';
  del.textContent = '✕';
  del.addEventListener('click', () => showFace(null));
  drop.appendChild(del);
}

// ── The variations of one character ─────────────────────────────────────────
// Every take of the SAME person, in the order they were made: the first generation and then each
// edit. A new reference - a TPDNE face or an upload - is a different person, so it starts the list
// over rather than joining it.
//
// Each entry is a whole snapshot of _face, not just a path. Going back to the first take has to
// bring back the values that made it, or a save would carry someone else's description; and the
// take you are standing on is the one _face holds, which is what makes "save the one you like"
// work without a special case.
let _vars = [];
let _varAt = -1;

function _pushVar(label) {
  _vars.push({ ..._face, label: String(label || '') });
  _varAt = _vars.length - 1;
  _paintVars();
}

function _showVar(i) {
  if (i < 0 || i >= _vars.length || i === _varAt) return;
  _varAt = i;
  _face = { ..._vars[i] };
  _paintDrop(_face.src);
  _paintVars();
  if (_refPanel) _refPanel.setSource(_face.source);
}

// The star is a toggle. Keeping a take makes an unfinished character - a draft - and costs no
// engine call, since the sheet is what finishing it will generate. Un-keeping deletes that draft
// again, face and all: the star said the take was worth coming back to, so taking it back should
// leave nothing behind. Neither interrupts - the point is to bookmark and keep working.
function _toggleDraft(i) {
  const v = _vars[i];
  if (!v) return;
  if (v.draftId) {
    const id = v.draftId;
    return _runQuiet('Removing from drafts…', async () => {
      const d = await (await fetch('/api/char-store/' + encodeURIComponent(id), { method: 'DELETE' })).json();
      if (!d || !d.success) throw new Error((d && d.error) || 'the draft could not be removed');
      _vars[i].draftId = '';
      _paintVars();
      _status('Removed from drafts');
      if (_charFilter === 'unsaved') loadChars();     // the list is showing them, so it changes
    });
  }
  return _runQuiet('Keeping this take…', async () => {
    const body = {
      draft: true,
      name: genName(),                       // a random one, as asked - renamed when it is finished
      gender: (v.values && v.values.gender) || null,
      figure: v.figure || '',
    };
    if (v.base64) body.faceImageBase64 = v.base64; else body.faceImagePath = v.path;
    const d = await (await fetch('/api/char-store/create', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })).json();
    if (!d || !d.success) throw new Error((d && d.error) || 'the take could not be kept');
    _vars[i].draftId = String(d.char.id);
    _paintVars();
    _status('Kept "' + d.char.name + '" as a draft');
    if (_charFilter === 'unsaved') loadChars();
  });
}

function _paintVars() {
  const box = $('cv2-vars');
  if (!box) return;
  box.textContent = '';
  // One take is not a choice, so the strip and the arrows stay out of the way until there are two.
  box.hidden = _vars.length < 2;
  const arrows = $('cv2-drop');
  if (arrows) arrows.classList.toggle('has-vars', _vars.length > 1);
  if (_vars.length < 2) return;
  _vars.forEach((v, i) => {
    // A div, not a button: the star inside is a button of its own, and a button inside a button
    // is not something a browser will lay out.
    const cell = document.createElement('div');
    cell.className = 'cv2-var' + (i === _varAt ? ' is-cur' : '');
    cell.title = (i === 0 ? 'the first take' : v.label || ('take ' + (i + 1)));
    const img = document.createElement('img');
    img.src = _thumb(v.src, 'card');
    img.alt = '';
    cell.appendChild(img);
    cell.addEventListener('click', () => _showVar(i));

    // Top left, and gold once it has been kept. Keeping does not interrupt anything: the take
    // goes to the drafts and you carry on with this one.
    const star = document.createElement('button');
    star.type = 'button';
    star.className = 'cv2-var-star' + (v.draftId ? ' is-on' : '');
    star.textContent = '★';
    star.title = v.draftId ? 'Kept as a draft - press to remove it' : 'Keep this take as a draft to come back to';
    star.addEventListener('click', (e) => { e.stopPropagation(); _toggleDraft(i); });
    cell.appendChild(star);

    box.appendChild(cell);
  });
  const cur = box.children[_varAt];
  if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest', inline: 'nearest' });
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
  const drafts = _charFilter === 'unsaved';
  try {
    if (drafts) {
      // char-store's own list, asked for the unfinished ones. Shaped like a shelf item so one
      // renderer draws both - a draft is a character that is not done, not a different thing.
      const d = await (await fetch('/api/char-store/list?drafts=1')).json();
      if (!d || !d.success) throw new Error((d && d.error) || 'read failed');
      _chars = (d.chars || []).map(c => ({
        id: String(c.id), name: c.name || 'draft', draft: true, rec: c,
        media: c.baseFace || '', thumb: c.baseFace || '',
        meta: { gender: c.gender || '', looks: 0, date: c.date || null },
      }));
    } else {
      const d = await (await fetch('/api/library/shelf/characters')).json();
      if (!d || !d.success) throw new Error((d && d.error) || 'read failed');
      _chars = d.items || [];
    }
    renderChars();
    $('cv2-count').textContent = String(_chars.length);
    _status('');

    // Only the finished list opens on something. A draft's row is a way INTO the save stage, and
    // opening that by itself on arrival would be the page deciding to finish one for you.
    if (drafts) { renderSheet(null); return; }
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
    // Through the door as well: a draft's thumbnail is its full-size kept face, and a list of
    // fourteen of those is exactly what the 10 KB variant exists for.
    if (c.thumb) img.src = _thumb(c.thumb, 'strip');
    row.appendChild(img);

    const txt = document.createElement('div');
    txt.className = 'cv2-item-txt';
    const name = document.createElement('div');
    name.className = 'cv2-item-name';
    name.textContent = c.name;
    const sub = document.createElement('div');
    sub.className = 'cv2-item-sub';
    if (c.draft) {
      sub.textContent = 'draft · no sheet yet';
    } else {
      const n = (c.meta && c.meta.looks) || 0;
      sub.textContent = n + (n === 1 ? ' look' : ' looks') + ((c.meta && c.meta.voices) ? ' · voice' : '');
    }
    txt.appendChild(name); txt.appendChild(sub);
    row.appendChild(txt);

    if (c.draft) {
      row.classList.add('is-draft');
      // The cross ends the draft: the record, its folder and the face inside it. char-store's own
      // delete does all three, so nothing here reaches into its files.
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'cv2-item-x';
      x.textContent = '✕';
      x.title = 'Delete this draft and its files';
      x.addEventListener('click', (e) => { e.stopPropagation(); _deleteDraft(c); });
      row.appendChild(x);
      // Clicking the row itself picks the draft up where it was left: the save stage, at the sheet.
      row.addEventListener('click', () => _resumeDraft(c.rec || c));
    } else {
      row.addEventListener('click', () => select(c.id));
    }
    box.appendChild(row);
  }
}

// characters.json belongs to char-store, and the shelf the list is drawn from carries only how
// MANY voices a character has, not which. So the record itself is read when one is selected.
async function _charRec(id) {
  const d = await (await fetch('/api/char-store/list')).json();
  return ((d && d.chars) || []).find(c => String(c.id) === String(id)) || null;
}

// The one door into characters.json, for anything that edits a character: a voice, a name, a
// gender. It hands the updated record straight back, so whatever is on screen is repainted from
// what was actually stored rather than from what we hoped we stored.
async function _patchChar(id, fields) {
  const p = await (await fetch('/api/char-store/' + encodeURIComponent(id), {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields),
  })).json();
  if (!p || !p.success) throw new Error((p && p.error) || 'the character could not be updated');
  if (_voicePanel) _voicePanel.show(p.char);
  return p.char;
}

function _deleteDraft(c) {
  return _runQuiet('Deleting the draft…', async () => {
    const d = await (await fetch('/api/char-store/' + encodeURIComponent(c.id), { method: 'DELETE' })).json();
    if (!d || !d.success) throw new Error((d && d.error) || 'the draft could not be deleted');
    // A take in the strip may have been the thing that made it; its star is no longer true.
    _vars.forEach(v => { if (String(v.draftId || '') === String(c.id)) v.draftId = ''; });
    _paintVars();
    await loadChars();
    _status('Draft deleted');
  });
}

// Cancelling out of a draft - from EITHER of the two Cancels that can mean it: the one in the
// editor beside Edit, and the one in the save form. One definition, because two were already
// disagreeing about it.
//
// What decides the behaviour is whether the picture exists anywhere else. A draft's does: in its
// own folder, with its row in the Unsaved list. So closing the middle loses nothing, and Cancel is
// not "carry on with this" - the image goes, the name clears, the takes go, and you are back in
// the list you came from. A freshly built portrait exists ONLY in the middle, so for that one
// Cancel leaves the editor and keeps the picture.
//
// Returns true when it acted, so each caller can say the right thing afterwards.
function _cancelDraft() {
  if (!_resumeId) return false;
  _resumeId = ''; _resumeGender = '';
  showFace(null);
  setMode('view');
  // After the reload, not before: loadChars clears the status line when it succeeds, so a message
  // set first is a message nobody sees.
  loadChars().then(() => _status('Cancelled - the draft is still in Unsaved'));
  return true;
}

// Picking a draft up where it was left, in the editor rather than the save form. A draft is
// unfinished by definition, so the first thing offered is the way to change it - chips and words
// against the kept face. Save character is one press away when it is right.
//
// _resumeId travels with it: whenever the save does happen, it carries that id, so finishing
// OVERWRITES the record and flips its draft flag instead of leaving a second character behind.
function _resumeDraft(rec) {
  if (!rec || !rec.baseFace) { _status('That draft has no image to finish from', 'err'); return; }
  _resumeId = String(rec.id);
  _resumeGender = rec.gender || '';
  _face = { src: rec.baseFace, base64: '', path: rec.baseFace, name: rec.name || '',
            source: 'gen', figure: rec.figure || '', values: null };
  _vars = [{ ..._face, label: 'the kept take', draftId: _resumeId }];
  _varAt = 0;
  setMode('create');
  _paintDrop(_face.src);
  _paintVars();
  if (_headPanel) _headPanel.setName(_face.name);
  if (_editPanel) _editPanel.clear();
  setCreateMode('edit');             // chips open: this is a character to carry on with
  const sm = $('cv2-savemodel');
  if (sm) sm.disabled = false;
  _status('Editing "' + (rec.name || 'draft') + '" - change it, or Save character to finish it');
}

function select(id) {
  _cur = String(id);
  try { localStorage.setItem(LS_CHAR, _cur); } catch (e) {}
  renderChars();
  const c = _chars.find(x => String(x.id) === _cur) || null;
  renderSheet(c);
  loadLooks(c);
  // Guarded against arriving late: a slow read must not paint the voices of the character you
  // have already clicked away from.
  if (_voicePanel) {
    _voicePanel.show(null);
    _charRec(_cur).then(rec => { if (String(_cur) === String(id)) _voicePanel.show(rec); }).catch(() => {});
  }
}

// ── The view: one big image, and a strip that chooses it ────────────────────
// The strip's first entry is the 4K reference, so returning to it is the same gesture as
// picking a look rather than a separate control. Clicking the look that is already showing
// also returns - both ways out, because either is the one a hand reaches for.
//
// Which look is selected drives two panels at once: the big image here, and the gallery of
// what Scenarios generated with that look in the column to the right.
let _looks = [];
let _look = '';                      // the selected look's id, or '' for the reference

function renderSheet(c) {
  _looks = [];
  _look = '';
  // Only in view mode. select() also runs while creating - after a save, for instance - and the
  // middle column is not showing that character then, it is showing the portrait being made.
  if (document.body.dataset.mode !== 'create') {
    $('cv2-work-title').textContent = c ? c.name : 'Character';
  }
  if (!c) {
    $('cv2-big').textContent = '';
    const e = document.createElement('div');
    e.className = 'cv2-empty';
    e.textContent = 'Pick a character on the left, or switch to Create.';
    $('cv2-big').appendChild(e);
    $('cv2-strip').textContent = '';
    _paintGallery(null);
    return;
  }
  _paintBig(c);
  _paintStrip(c);
  _paintGallery(null);
}

function _current(c) {
  if (!_look) return { src: c.media, name: c.name, isRef: true };
  const l = _looks.find(x => String(x.id) === _look);
  return l ? { src: l.media || l.thumb, name: l.name, isRef: false } : { src: c.media, name: c.name, isRef: true };
}

function _paintBig(c) {
  const box = $('cv2-big');
  box.textContent = '';
  const cur = _current(c);
  if (cur.src) {
    const img = document.createElement('img');
    img.className = 'cv2-sheet-img';
    img.src = _thumb(cur.src, 'sheet');
    img.alt = cur.name;
    box.appendChild(img);
  }
  const meta = document.createElement('div');
  meta.className = 'cv2-meta';
  const m = c.meta || {};
  const bits = [];
  // What is on screen first, then what the character is - the label changes with the picture.
  bits.push(cur.isRef ? '4K reference' : ('look: ' + cur.name));
  bits.push((m.looks || 0) + ' looks');
  if (m.voices) bits.push(m.voices + (m.voices === 1 ? ' voice' : ' voices'));
  if (m.date) {
    const d = new Date(m.date);
    if (!isNaN(d)) bits.push(d.toLocaleDateString('en-GB'));
  }
  for (const b of bits) { const s = document.createElement('span'); s.textContent = b; meta.appendChild(s); }
  box.appendChild(meta);

  // The gender badge is the control for it. It decides which half of the voice library is worth
  // searching, so it has to be changeable from where the character is actually looked at - and
  // the two values make a press clearer than a dropdown would be.
  const gEl = document.createElement('button');
  gEl.type = 'button';
  gEl.className = 'cv2-meta-gender' + (m.gender ? '' : ' is-unset');
  gEl.textContent = m.gender || 'gender?';
  gEl.title = 'Press to change - the voice search follows it';
  gEl.addEventListener('click', () => {
    const next = String(m.gender || '') === 'male' ? 'female' : 'male';
    _setGender(c, next);
  });
  meta.insertBefore(gEl, meta.firstChild ? meta.children[1] || null : null);
}

// Written through the one door, which hands the record back - and the voice panel is shown that
// record, so its filter re-points itself rather than being told twice.
function _setGender(c, gender) {
  return _runQuiet('Setting the gender…', async () => {
    const rec = await _patchChar(c.id, { gender });
    const item = _chars.find(x => String(x.id) === String(c.id));
    if (item) { item.meta = { ...(item.meta || {}), gender: rec.gender || gender }; }
    _paintBig(item || c);
    _status('Gender set to ' + (rec.gender || gender) + ' - the voice search follows it');
  });
}

function _paintStrip(c) {
  const strip = $('cv2-strip');
  strip.textContent = '';
  const add = (id, src, label, title) => {
    const it = document.createElement('div');
    it.className = 'cv2-strip-item' + (String(id) === _look ? ' is-cur' : '');
    it.title = title;
    if (src) {
      const img = document.createElement('img');
      img.src = _thumb(src, 'strip'); img.alt = label; img.decoding = 'async';
      it.appendChild(img);
    }
    const lab = document.createElement('div');
    lab.className = 'cv2-strip-lab';
    lab.textContent = label;
    it.appendChild(lab);
    // Clicking what is already showing goes back to the reference.
    it.addEventListener('click', () => _pickLook(String(id) === _look ? '' : String(id), c));
    strip.appendChild(it);
    return it;
  };
  add('', c.media, '4K', 'The character reference sheet');
  // Looks are named "<character> - look <date>", which in a 92px column ellipsises down to the
  // same truncated string for every one of them. The character's name is the part they all
  // share, so it is the part that goes; the full name stays in the tooltip.
  const short = (n) => {
    let s = String(n || '').trim();
    if (c.name && s.startsWith(c.name)) s = s.slice(c.name.length).replace(/^[\s–-]*(look\b\s*)?/i, '');
    return s.trim() || 'look';
  };
  for (const l of _looks) add(l.id, l.thumb || l.media, short(l.name), l.name);
}

function _pickLook(id, c) {
  _look = id || '';
  _paintBig(c);
  _paintStrip(c);
  _paintGallery(_look ? (_looks.find(x => String(x.id) === _look) || null) : null);
}

// The right-hand column: what Scenarios generated with the selected look. A casting is per
// project - one character and one look for a whole script - so "made with this look" means the
// frames of every project cast with it, which is what the endpoint answers.
//
// The cross deletes the frame for real: the variant, every reference the project still holds to
// it, and the file. Through Scenarios' own endpoint, because two writers of its store is how a
// store starts drifting.
let _galLook = '';                   // whose frames are on screen, so a late answer can be dropped

function _galTitle(look, n) {
  const title = $('cv2-side-title'), spine = $('cv2-side-spine');
  if (document.body.dataset.mode !== 'view') return;
  if (title) title.textContent = look ? ('Scenes · ' + (n == null ? '' : n)) : 'Scenes';
  if (spine) spine.textContent = 'Scenes';
}

function _galNote(text) {
  const box = $('cv2-gal');
  box.textContent = '';
  const e = document.createElement('div');
  e.className = 'cv2-empty';
  e.style.gridColumn = '1 / -1';
  e.textContent = text;
  box.appendChild(e);
}

async function _paintGallery(look) {
  const box = $('cv2-gal');
  if (!box) return;
  _galLook = look ? String(look.id) : '';
  if (!look) {
    _galTitle(null);
    _galNote('Pick a look in the strip to see what Scenarios made with it.');
    return;
  }
  _galTitle(look, null);
  _galNote('Reading…');
  const want = _galLook;
  try {
    const d = await (await fetch('/api/scen3/look-frames/' + encodeURIComponent(want))).json();
    if (want !== _galLook) return;                 // a different look was picked meanwhile
    if (!d || !d.success) throw new Error((d && d.error) || 'could not read the frames');
    _galFrames = d.items || [];
    _galProjects = d.projects || [];
    _galProject = '';                              // a new look is a fresh question
    _renderGallery(look);
  } catch (e) {
    if (want === _galLook) _galNote(e.message);
  }
}

let _galFrames = [];
let _galProjects = [];
let _galProject = '';                // '' = all of them

function _renderGallery(look) {
  const box = $('cv2-gal');
  box.textContent = '';
  const shown = _galProject ? _galFrames.filter(f => f.projectId === _galProject) : _galFrames;
  _galTitle(look, shown.length);
  if (!_galFrames.length) {
    _galNote('Nothing generated with this look yet.');
    return;
  }

  // One look can be cast in several scripts, and mixing their frames into one wall makes none of
  // them readable. The picker spans the grid; "all" is the default because that is the question
  // you arrive with.
  if (_galProjects.length > 1) {
    const row = document.createElement('div');
    row.className = 'cv2-gal-pick';
    const sel = document.createElement('select');
    sel.className = 'cv2-gal-sel';
    sel.id = 'cv2-gal-project';
    const all = document.createElement('option');
    all.value = ''; all.textContent = 'all projects (' + _galFrames.length + ')';
    sel.appendChild(all);
    for (const p of _galProjects) {
      const o = document.createElement('option');
      o.value = p.id; o.textContent = (p.title || p.id) + ' (' + p.count + ')';
      sel.appendChild(o);
    }
    sel.value = _galProject;
    sel.addEventListener('change', () => { _galProject = sel.value; _renderGallery(look); });
    row.appendChild(sel);
    box.appendChild(row);
  }

  if (!shown.length) {
    const e = document.createElement('div');
    e.className = 'cv2-empty';
    e.style.gridColumn = '1 / -1';
    e.textContent = 'Nothing for that project.';
    box.appendChild(e);
    return;
  }

  for (const f of shown) {
    const cell = document.createElement('div');
    cell.className = 'cv2-frame is-' + (f.state || 'yellow') + (f.approved ? ' is-approved' : '');
    cell.title = [
      f.state === 'green' ? (f.active ? 'In use: the active pick' : 'In use: a script line uses it')
        : f.state === 'grey' ? 'Hidden in the project' : 'Not used by anything',
      f.approved ? 'approved' : '',
      f.projectTitle, f.prompt,
    ].filter(Boolean).join(' — ');

    const img = document.createElement('img');
    img.src = _thumb(f.preview || f.path, 'frame');
    img.alt = f.projectTitle || 'frame';
    img.decoding = 'async';
    cell.appendChild(img);

    // Hover shows it big. Its own element rather than a title attribute: the point is the
    // picture, and a tooltip cannot hold one. Placed on hover because it is position:fixed -
    // the only way out of a scrolling column that would otherwise clip it.
    const pop = document.createElement('div');
    pop.className = 'cv2-frame-pop';
    const big = document.createElement('img');
    big.alt = '';
    pop.appendChild(big);
    cell.appendChild(pop);
    // Left of the cell, since this column is at the page's right edge; flipped right only if
    // there is genuinely no room, and clamped so a tall preview never runs off the bottom.
    const place = () => {
      const r = cell.getBoundingClientRect();
      const w = pop.offsetWidth || 240, h = pop.offsetHeight || 300;
      const left = (r.left - 7 - w >= 6) ? (r.left - 7 - w) : Math.min(r.right + 7, window.innerWidth - w - 6);
      pop.style.left = Math.max(6, left) + 'px';
      pop.style.top = Math.max(6, Math.min(r.top, window.innerHeight - h - 6)) + 'px';
    };
    // Placed again once the picture arrives: until then its height is a guess, and the guess is
    // what would put a tall preview through the floor.
    big.addEventListener('load', () => { if (pop.classList.contains('is-on')) place(); });
    cell.addEventListener('mouseenter', () => {
      // Fetched on FIRST hover, not at render: eleven previews at their 100 KB budget is a
      // megabyte of pictures nobody has pointed at. Not loading="lazy" - that never fires in the
      // automated pane, which composites nothing.
      if (!big.getAttribute('src')) big.src = _thumb(f.path, 'main');
      pop.classList.add('is-on');
      place();
    });
    cell.addEventListener('mouseleave', () => pop.classList.remove('is-on'));

    // No cross on a green one. The server refuses it too - this only saves the trip.
    if (f.state !== 'green') {
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'cv2-frame-x';
      x.textContent = '✕';
      x.title = 'Delete this frame - the file and the reference in the scenario';
      x.addEventListener('click', (ev) => {
        ev.stopPropagation();
        _deleteFrame(look, f);
      });
      cell.appendChild(x);
    }

    box.appendChild(cell);
  }
}

function _deleteFrame(look, f) {
  return _runQuiet('Deleting the frame…', async () => {
    const d = await (await fetch('/api/scen3/look-frames/' + encodeURIComponent(look.id)
      + '/' + encodeURIComponent(f.id), { method: 'DELETE' })).json();
    if (!d || !d.success) throw new Error((d && d.error) || 'the frame could not be deleted');
    _galFrames = _galFrames.filter(x => x.id !== f.id);
    _renderGallery(look);
    _status(d.removed && d.removed.length
      ? 'Frame deleted' : 'Frame removed from the scenario; its file is still used elsewhere');
  });
}

async function loadLooks(c) {
  if (!c) { _looks = []; return; }
  try {
    const d = await (await fetch('/api/library/looks/' + encodeURIComponent(c.id))).json();
    if (!d || !d.success) throw new Error((d && d.error) || 'read failed');
    _looks = d.items || [];
    _paintStrip(c);
  } catch (e) {
    _looks = [];
    _status(e.message, 'err');
  }
}

function boot() {
  initNav();

  // A collapsed column is one big click target; open ones collapse from the head button.
  // A collapsed column is one big click target. The guard matters: a click on CONTENT must never
  // count as a click on the spine, because a handler that collapses this column mid-click would
  // otherwise see it collapsed and reopen it - the same click undoing what it just did.
  const onSpine = (col, e) => col.classList.contains('is-collapsed') && !e.target.closest('.cv2-col-body');
  $('cv2-create').addEventListener('click', (e) => { if (onSpine($('cv2-create'), e)) setMode('create'); });
  $('cv2-list').addEventListener('click', (e) => { if (onSpine($('cv2-list'), e)) setMode('view'); });
  $('cv2-side').addEventListener('click', (e) => { if (onSpine($('cv2-side'), e)) setSideOpen(true); });
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
  setCreateMode((cmode === 'ref' || cmode === 'edit') ? 'main' : cmode);

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
    _face.values = { ...values };            // what the card's prompt is painted from
    _vars = []; _varAt = -1;                 // a fresh build starts its own list of takes
    _pushVar('the first take');
    // There is something to change now, so the column becomes the place to change it.
    if (_editPanel) _editPanel.clear();
    setCreateMode('edit');
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
        // A bare TPDNE crop is converted into the house portrait; anything else is edited where
        // it stands, which is also what the edit panel asks for.
        showFace(await _fromText(text, pr, { convert: _face.source === 'tpdne' }), 'gen');
        _pushVar(text);
        _refPanel.clear();               // this instruction has been carried out
      }),

      // The 5px arrow. Discarding the face IS the exit: the column has nothing to steer without
      // one, and another reference costs nothing.
      onExit: () => showFace(null),
    });
  }

  // ── Voices, in the room the smaller image left ──
  // The library search is the proxy the Scenarios voice studio already uses, so the ElevenLabs
  // key never reaches the browser and there is one search in the project rather than two.
  const vhost = $('cv2-voice-host');
  if (vhost) {
    _voicePanel = Voices.build(vhost, {
      onFind: (filters) => _runVoice('Searching the voice library…', async () => {
        // Blank filters are dropped by the route on purpose: an empty accent= matches nothing
        // there, where no accent at all means any.
        const p = new URLSearchParams({ page_size: '12' });
        for (const [k, v] of Object.entries(filters || {})) if (v) p.set(k, v);
        const d = await (await fetch('/api/scen3/voices/library?' + p)).json();
        if (!d || !d.success) throw new Error((d && d.error) || 'the voice library did not answer');
        const list = d.voices || [];
        _voicePanel.results(list, d.total || list.length);
        _voicePanel.status(list.length
          ? (list.length + ' of ' + (d.total || list.length) + ' - listen, then Save')
          : 'Nothing matched that.', list.length ? '' : 'err');
      }),

      // Taking ADDS the voice to the account: ElevenLabs answers voice_not_found for a library id
      // that is not in it. The account-side id it returns is what goes on the character, and it
      // becomes the gold star - the newest one is the one just chosen on purpose.
      onTake: (card) => _runVoice('Saving the voice…', async () => {
        if (!_cur) throw new Error('no character selected');
        const t = await (await fetch('/api/scen3/voices/take', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ownerId: card.public_owner_id, voiceId: card.voice_id, name: card.name }),
        })).json();
        if (!t || !t.success) throw new Error((t && t.error) || 'the voice could not be taken');

        const rec = await _charRec(_cur);
        const kept = (rec && Array.isArray(rec.voices) ? rec.voices : []).filter(v => v.voiceId !== t.voiceId);
        const entry = {
          voiceId: t.voiceId, name: t.name || card.name, gender: card.gender || '',
          age: card.age || '', accent: card.accent || '', descriptive: card.descriptive || '',
          sample: t.sample || '',
        };
        await _patchChar(_cur, { voice: t.voiceId, voices: kept.concat([entry]) });
        _voicePanel.status(t.sampleError
          ? 'Saved. Its demo failed to record, which is cosmetic.' : 'Saved.', 'ok');
      }),

      // A grey star becomes the gold one. `voices` is untouched - only which of them is THE voice.
      onStar: (voiceId) => _runVoice('Setting the voice…', async () => {
        if (!_cur) throw new Error('no character selected');
        await _patchChar(_cur, { voice: voiceId });
        _voicePanel.status('Set.', 'ok');
      }),

      // Letting a voice go. Not a delete: the server puts everything the ElevenLabs account
      // knows about it on the Library's Voices shelf first - tags, owner id, our demo - and only
      // then gives the slot back. So this frees space without losing the voice.
      onUnbind: (voiceId, name) => _runVoice('Unbinding the voice…', async () => {
        if (!_cur) throw new Error('no character selected');
        const d = await (await fetch('/api/char-store/' + encodeURIComponent(_cur)
          + '/voice/' + encodeURIComponent(voiceId), { method: 'DELETE' })).json();
        if (!d || !d.success) throw new Error((d && d.error) || 'the voice could not be unbound');
        // From the record the server actually wrote, like every other edit on this page.
        if (d.char) _voicePanel.show(d.char);
        const slot = d.slot || {};
        _voicePanel.status('"' + (name || voiceId) + '" is on the Library shelf. '
          + (slot.released ? 'Its ElevenLabs slot is free.' : 'Slot ' + (slot.reason || 'kept') + '.'), 'ok');
      }),
    });
  }

  // The edit state: chips and words against the portrait the parameters just made. Same two
  // endpoints as the reference path - one pipeline, two ways in.
  const ehost = $('cv2-create-edit-host');
  if (ehost) {
    _editPanel = EditPanel.build(ehost, {
        onCancel: () => {
          if (_cancelDraft()) return;            // a draft: close it, it is already saved
          setCreateMode('main');
          _status('Portrait kept as it is');
        },
      onEdit: (text) => _run('Reading the portrait…', async (pr) => {
        // Never a conversion: this portrait is already in the house format, so the frame is kept
        // and only the appearance moves.
        showFace(await _fromText(text, pr, { convert: false }), 'gen');
        _pushVar(text);
        _editPanel.clear();
      }),
    });
  }

  // A third of the image at each edge pages through the takes. Only alive when there is more than
  // one - a page button over a single image is a button that does nothing.
  for (const [id, step] of [['cv2-prev', -1], ['cv2-next', 1]]) {
    const z = $(id);
    if (!z) continue;
    z.addEventListener('click', (e) => {
      e.stopPropagation();                  // or the empty-field click opens the file picker
      if (_vars.length < 2) return;
      _showVar(Math.min(_vars.length - 1, Math.max(0, _varAt + step)));
    });
  }

  // Saved or unsaved. Remembered, and it reloads rather than filtering in place: the two lists
  // come from different endpoints, so there is nothing to filter locally.
  try { _charFilter = localStorage.getItem(LS_FILTER) === 'unsaved' ? 'unsaved' : 'saved'; } catch (e) {}
  document.querySelectorAll('#cv2-filter .cv2-filter-b').forEach(b => {
    b.classList.toggle('is-on', b.dataset.filter === _charFilter);
    b.addEventListener('click', () => {
      if (_charFilter === b.dataset.filter) return;
      _charFilter = b.dataset.filter;
      try { localStorage.setItem(LS_FILTER, _charFilter); } catch (e) {}
      document.querySelectorAll('#cv2-filter .cv2-filter-b')
        .forEach(x => x.classList.toggle('is-on', x.dataset.filter === _charFilter));
      loadChars();
    });
  });

  _wireUpload();           // so the card says what will appear there, not nothing

  // ── Save model ──
  // The image in the middle is the identity source, never stored on the character itself: the
  // sheet is what gets kept, which is why the sheet is what the 2/5 field ends up showing.
  const shost = $('cv2-save-host');
  if (shost) {
    _savePanel = SavePanel.build(shost, {
        onCancel: () => {
          setStage('');
          if (_cancelDraft()) return;
          _status('Not saved - the portrait is still here');
        },
      // Only offered while finishing a draft. char-store's delete takes the record, the folder and
      // the face together, so nothing here reaches into its files.
      onDelete: () => _runQuiet('Deleting the draft…', async () => {
        const id = _resumeId;
        if (!id) throw new Error('nothing to delete');
        const d = await (await fetch('/api/char-store/' + encodeURIComponent(id), { method: 'DELETE' })).json();
        if (!d || !d.success) throw new Error((d && d.error) || 'the draft could not be deleted');
        _resumeId = '';
        setStage('');
        showFace(null);
        await loadChars();
        _status('Draft deleted');
      }),
      // Done lands in view mode on the character just made. There is still something to do with
      // it - it has no voice yet - and view mode is where voices live, under the reference. The
      // create column is emptied on the way out so coming back to it later starts clean rather
      // than on a face that has already become somebody.
      onDone: () => {
        const id = _savedId, name = _savePanel.name();
        setStage('');
        showFace(null);
        setMode('view');
        loadChars().then(() => {
          if (id) select(id);       // which also loads their voices, ready to pick one
          _status(name ? ('Saved "' + name + '" - pick a voice below') : 'Saved');
        });
      },

      onSave: ({ name, gender }) => _run('Saving the character…', async (pr) => {
        const body = { name, gender, figure: _face.figure || '' };
        // Finishing a draft rather than making a new character: same id, so upsert overwrites it
        // and the draft flag comes off - which is the promotion path create already had.
        if (_resumeId) body.id = _resumeId;
        if (_face.base64) body.faceImageBase64 = _face.base64; else body.faceImagePath = _face.path;
        const r = await (await fetch('/api/char-store/create', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        })).json();
        if (!r || !r.success) throw new Error((r && r.error) || 'the character could not be saved');

        // The record exists from here on, and nothing below undoes it. `sheet` rather than
        // `saved`: the sheet is still being made, and Done stays shut until it stops - leaving
        // now is how a character ends up without the one asset Scenarios reads.
        _savedId = String(r.char.id);
        _resumeId = ''; _resumeGender = '';    // it is a character now, not a draft
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

      // While the sheet is being made the character already exists, so a change to its name or
      // gender is a change to the record - written through the one door into characters.json.
      onRename: (name) => _patchChar(_savedId, { name }).then(() => {
        _status('Renamed to "' + name + '"');
        loadChars();
      }).catch(e => _status(e.message, 'err')),
      onRegender: (gender) => _patchChar(_savedId, { gender }).then(() => {
        _status('Gender set to ' + gender);
        loadChars();
      }).catch(e => _status(e.message, 'err')),

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
      _savePanel.open({
        name: _face.name || ($('cv2-name') && $('cv2-name').value.trim()) || '',
        gender: _resumeGender || '',
      });
      _savePanel.setResume(!!_resumeId);   // a draft being finished can also be deleted here
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
