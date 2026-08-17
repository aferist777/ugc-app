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
import { genPrompt, genPromptFrom, refEditPrompt, exampleUrl } from './presets.js';
import { genName } from './schema.js';
import * as Gear from './gear.js';
import * as SavePanel from './save-panel.js';
import * as Voices from './voices.js';
import * as EditPanel from './edit-panel.js';
// The house style for "this is being generated" - the target blurs behind a spinner, a bar and
// a countdown that learns from previous runs. Shared with the scenarios page rather than
// reimplemented, so both pages wait the same way and one EMA teaches both.
import { startProgress, startInlineProgress, lockControls } from '../progress.js';

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
// The face being worked on, and the takes beside it. Everything else on this page was
// remembered and this was not, so a generated portrait lived in a variable and went with the
// tab: walk over to Merge, come back, and it was gone - the boot code even said so, falling
// back to the dropdowns "until generation persists what it made".
//
// The pictures themselves were never lost. A generation is downloaded to uploads/ as
// generated_*.jpg and there are hundreds of them there; what was lost was the pointer.
const LS_WORK = 'cv2_work_v1';

// ── Remembering the bench ───────────────────────────────────────────────────
// Only what is ON DISK. A TPDNE face travels as a data URL and is deliberately never written
// to a file, so there would be nothing to point at afterwards - and another one is a button
// press and costs nothing. Storing the base64 instead would put a megabyte a take into a
// store that mirrors itself to the server.
const _onDisk = (v) => !!(v && typeof v.src === 'string' && v.src.startsWith('/'));

const _slim = (v) => ({
  src: v.src, path: v.path || v.src, name: v.name || '', source: v.source || '',
  figure: v.figure || '', label: v.label || '', draftId: v.draftId || '',
});

// Written after every change rather than on leaving: there is no reliable moment to catch a
// tab being closed, and the whole point is that walking away costs nothing.
function _remember() {
  try {
    const vars = _vars.filter(_onDisk).map(_slim);
    if (!vars.length && !_onDisk(_face)) { localStorage.removeItem(LS_WORK); return; }
    localStorage.setItem(LS_WORK, JSON.stringify({
      face: _onDisk(_face) ? _slim(_face) : null,
      vars,
      at: _varAt,
    }));
  } catch (e) {}
}

// Put the bench back. Returns whether there was anything to put back, because boot uses that
// to decide whether the create column may open on a face - without one it has to fall back to
// the dropdowns, which is what the old code did unconditionally.
function _restoreWork() {
  let w = null;
  try { w = JSON.parse(localStorage.getItem(LS_WORK) || 'null'); } catch (e) {}
  if (!w || (!w.face && !(w.vars || []).length)) return false;
  _vars = (w.vars || []).map(v => ({ ...v, base64: '', values: null }));
  _varAt = (typeof w.at === 'number' && w.at >= 0 && w.at < _vars.length) ? w.at : (_vars.length - 1);
  const f = w.face || _vars[_varAt] || null;
  if (!f) return false;
  _face = { src: f.src, base64: '', path: f.path || f.src, name: f.name || '',
            source: f.source || 'gen', figure: f.figure || '', values: null };
  _paintDrop(_face.src);
  _paintVars();
  _paintPresetCancel();      // _face just moved, so what Cancel means may have moved with it
  // The name is seeded in boot, once the head panel exists - it is built after this runs.
  const sm = $('cv2-savemodel');
  if (sm) sm.disabled = !_face.src;
  return true;
}

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
// The Portrait column's own gear: the 4K sheet's aggregator, engine and tier, plus the button
// that spends them. Null until its engine list arrives, and every use is guarded on that.
let _sheetGear = null;

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

// ── The last failure, in words, under the picture ───────────────────────────
// A failure used to live in two places that both vanish: the overlay's fail card, gone the
// moment it is clicked, and the one-line status in the head, overwritten by the next action.
// Between them, "it generated but nothing happened" was a common and entirely truthful
// description of what the page showed.
//
// This block keeps the whole sentence - what was being attempted, what was asked to do it, and
// exactly what came back - until it is dismissed or the next job starts. Every runner reports
// through it, so there is no kind of error that lands somewhere else.
function _clearErr() {
  const b = $('cv2-err');
  if (b) { b.hidden = true; b.textContent = ''; }
}
// Dismissing the failed overlay dismisses the whole failure, not the half of it that was
// covering the picture. The overlay announces itself; this is the page agreeing.
document.addEventListener('sv3-progress-dismissed', _clearErr);

// ── An untouched preset ─────────────────────────────────────────────────────
// The picture on the bench IS the preset's own file until something is applied to it -
// the first edit returns a new file somewhere else. So the path is the answer, and it
// needs no flag to be kept in step: click back to the preset in the takes and it is an
// untouched preset again, which a flag set at the first edit would have got wrong.
const _isPresetFace = () => /^\/presets\//.test(String((_face && _face.src) || ''));

// The sheet an untouched preset already has. Answers '' when the bench is not standing on a
// preset, or when that preset has no sheet drawn yet - both are "generate it the usual way".
//
// Asked of the server rather than assumed: the sheets are files on disk, and a preset added
// later without one would otherwise promise a picture that is not there.
// Leaving the save stage on the character that was just made. Lands in view mode on it: there
// is still something to do - it has no voice yet - and view mode is where voices live, under
// the reference. The create column is emptied on the way out so coming back to it later starts
// clean rather than on a face that has already become somebody.
//
// Its own function because two paths end here now: Done, and a preset save that had nothing
// to generate and therefore nothing to stop and look at.
function _finishSave() {
  const id = _savedId, name = _savePanel && _savePanel.name();
  setStage('');
  showFace(null);
  setMode('view');
  loadChars().then(() => {
    if (id) select(id);
    _status(name ? ('Saved "' + name + '" - pick a voice below') : 'Saved');
  });
}

async function _presetSheetUrl() {
  const m = String((_face && _face.src) || '').match(/^\/presets\/([a-z0-9._-]+)\.jpg$/i);
  if (!m) return '';
  const url = '/presets/sheets/' + m[1] + '.jpg';
  try {
    const r = await fetch(url, { method: 'HEAD' });
    return r.ok ? url : '';
  } catch (e) { return ''; }
}

// While it is untouched, Cancel is not "keep this portrait" - there is no portrait of
// yours to keep, only a choice to undo. It says so, and it is red, because it throws
// the picture away rather than stepping back from it.
function _paintPresetCancel() {
  const b = $('cv2-edit-cancel');
  if (!b) return;
  const undo = _isPresetFace();
  b.classList.toggle('is-drop', undo);
  b.textContent = undo ? 'Cancel selection' : 'Cancel';
  b.title = undo
    ? 'Drop this preset and go back to the parameters'
    : 'Leave the portrait as it is and go back to the parameters';
}
// "nano-banana-2 @ replicate, 4K" - which engine, which aggregator, which tier. Two failures with
// the same message but different lines under them are different problems: one says wait, the
// other says switch.
const _pickDetail = (p) => (p && p.engine) ? (p.engine + ' @ ' + p.provider + ', ' + p.quality) : undefined;
function _showErr(label, message, detail) {
  const b = $('cv2-err');
  if (!b) return;
  b.textContent = '';

  const h = document.createElement('div');
  h.className = 'cv2-err-h';
  h.textContent = label || 'That did not work';
  b.appendChild(h);

  const m = document.createElement('div');
  m.className = 'cv2-err-m';
  // Verbatim. The engine's own wording is what says whether to wait or to change something.
  m.textContent = String(message || 'no reason was given');
  b.appendChild(m);

  if (detail) {
    const d = document.createElement('div');
    d.className = 'cv2-err-d';
    d.textContent = detail;
    b.appendChild(d);
  }

  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'cv2-err-x';
  x.textContent = '×';
  x.title = 'Dismiss';
  x.addEventListener('click', _clearErr);
  b.appendChild(x);

  b.hidden = false;
  if (b.scrollIntoView) b.scrollIntoView({ block: 'nearest' });
}

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
// save - so the record is watched until it names one, the way the page this replaced did.
// Six minutes: nano-banana-2 at 4K is slow, and the route retries a 429 up to three times.
// `was` is the sheet this character had BEFORE this attempt started. Without it, a run whose
// submit never happened would poll the record, find the picture from a previous attempt sitting
// there and report it as the new one - a generation that "worked" and changed nothing.
// onNote hears every hop of the cascade - "Replicate could not: ... - trying kie.ai" - so the
// progress bar can say what is happening instead of a generation looking stalled while the server
// quietly works its way down the list.
async function _awaitSheet(charId, knownTask, was, onNote) {
  const deadline = Date.now() + 8 * 60 * 1000;   // the cascade can visit three aggregators
  let taskId = knownTask ? String(knownTask) : '';
  let said = '';
  const note = (text) => {
    if (!text || text === said) return;
    said = text;
    if (onNote) { try { onNote(text); } catch (e) {} }
  };
  for (;;) {
    if (Date.now() > deadline) throw new Error('the sheet did not arrive within eight minutes');
    if (!taskId) {
      // Both buckets: the route splits drafts from finished characters, and a save crosses that
      // line in the middle of exactly this wait. Reading one of them would work until the day it
      // was the other one.
      const [a, b] = await Promise.all([
        (await fetch('/api/char-store/list')).json(),
        (await fetch('/api/char-store/list?drafts=1')).json(),
      ]);
      const all = ((a && a.chars) || []).concat((b && b.chars) || []);
      const rec = all.find(c => String(c.id) === String(charId));
      // Resolved by someone else - another poll of the same task - but only if it is not the
      // picture that was already there.
      if (rec && rec.sheet && rec.sheet !== was) return rec.sheet;
      if (rec && rec.sheetNote) note(rec.sheetNote);          // the submit is still walking the list
      if (rec && rec.sheetTask) taskId = String(rec.sheetTask);
      // The submit happens in the background, so its failure cannot be thrown at anyone - it is
      // written onto the record instead. Reading it here turns a six-minute wait for a task that
      // will never exist into the actual reason, immediately. It is only ever written once every
      // aggregator has refused.
      else if (rec && rec.sheetError) throw new Error(rec.sheetError);
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
    // A task that failed and was handed to another aggregator comes back as pending under a NEW
    // id. Following it is what makes that hop invisible from here.
    if (s.note) note(s.note);
    if (s.taskId && String(s.taskId) !== taskId) { taskId = String(s.taskId); continue; }
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
    // The sheet's gear: changing the model mid-run would describe the next attempt while the
    // current one is still walking the list.
    $('cv2-sheet-gear'),
    $('cv2-sheet-provider'), $('cv2-sheet-model'), $('cv2-sheet-quality'),
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
  _clearErr();
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
    _showErr(label, e.message);
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
  _clearErr();
  const unlock = lockControls(_controls());
  _status(label);
  try {
    await fn();
  } catch (e) {
    _status(e.message, 'err');
    _showErr(label, e.message);
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
//
// opts.host names what to blur behind the spinner, because that is not always the same element:
// a generation in create mode happens to the portrait in #cv2-drop, and a sheet regenerated from
// view mode happens to the big image - where #cv2-drop is not even on screen, so the progress
// would have run invisibly. opts.detail rides along to the error block: which engine, which
// aggregator, which tier, so a failure names what was actually asked.
async function _run(label, fn, opts = {}) {
  if (_busy) { _status('Already generating - one at a time', 'err'); return; }
  _busy = true;
  _clearErr();
  const unlock = lockControls(_controls());
  const pr = startProgress($(opts.host || 'cv2-drop'), { label, total: 1 });
  try {
    await fn(pr);
    pr.finish();                 // records the duration, so the next countdown is sharper
    _status('');
  } catch (e) {
    pr.fail(e.message);          // stays up until clicked, so a failure is not missed
    _status(e.message, 'err');
    _showErr(label, e.message, opts.detail);
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

// ── The 4K sheet, generated on demand ───────────────────────────────────────
// One action for one intent - "make this character's reference sheet again" - reached from two
// places that look different only because of where you are standing. During the save stage the
// form reports it; from view mode the big image blurs and the character reloads with the new
// sheet. Regenerating used to be reachable ONLY during the save stage, which is the one moment
// you are least likely to want it: the sheet you want redone is usually one saved yesterday.
//
// `pick` is the Portrait gear's { provider, engine, quality }. Sending none leaves the server on
// whatever this character was made with, which is what Retry has always meant.
// The gear no longer carries a button of its own, so there is nothing left to enable or
// disable: it only exists inside the save form, where the stage itself decides when it is
// reachable. Kept as a no-op rather than chased through four call sites.
function _syncSheetBtn() {}

function _genSheet(pick) {
  const inSave = !!(_savedId && document.body.dataset.stage === 'save');
  const id = inSave ? _savedId : _cur;
  if (!id) {
    _showErr('Nothing to regenerate', 'No character is selected, so there is no sheet to make. '
      + 'Pick one in the Characters column, or save the portrait you are working on.');
    return;
  }
  // The panel is a settings drawer, not somewhere to watch a generation from - and the thing it
  // would be covering is the picture being replaced.
  if (_sheetGear && _sheetGear.close) _sheetGear.close();
  // Blur whatever is actually on screen. In create mode the big image is not rendered at all, so
  // running the progress on it would have hidden the whole generation behind a collapsed panel.
  const host = document.body.dataset.mode === 'create' ? 'cv2-drop' : 'cv2-big';
  // Mutable on purpose: the server answers WHICH picture it regenerated from, and that only
  // becomes known after the request. _run reads this at failure time, so a line written here
  // still reaches the error block.
  const opts = { host, detail: _pickDetail(pick) };

  return _run('Generating the 4K sheet…', async (pr) => {
    const body = { charId: id, figure: _face.figure || '' };
    if (pick && pick.engine) {
      body.imageProvider = pick.provider;
      body.imageEngine = pick.engine;
      body.sheetQuality = pick.quality;
    }
    // The face in the create column belongs to the character being SAVED. In view mode it can
    // easily be somebody else entirely, and handing the server a stranger's face is how a
    // character comes back as the wrong person - so it only travels on the save path.
    if (inSave) {
      if (_face.base64) body.faceImageBase64 = _face.base64;
      else if (_face.path) body.faceImagePath = _face.path;
    }
    const r = await (await fetch('/api/char-store/regen-ref', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })).json();
    if (!r || !r.success) throw new Error((r && r.error) || 'the sheet could not be resubmitted');
    // What it drew FROM. "from the current sheet" and "from the saved face" produce visibly
    // different results, and when a regeneration comes back looking like the last one, this line
    // is the answer to why: it was redrawn from it.
    if (r.from) opts.detail = (opts.detail ? opts.detail + ' · ' : '') + 'from ' + r.from;
    if (inSave) {
      _savePanel.setState('sheet');           // shut the exit again for as long as this runs
      _savePanel.status('Generating…');
    }
    try {
      // The route answers before it generates, so there is no taskId yet - the record grows one.
      // `r.was` is the picture that is on screen now, and the wait ends when it is not that one
      // any more.
      const sheet = await _awaitSheet(id, null, r.was, (n) => {
        pr.tick(n);
        if (inSave) _savePanel.status(n);
      });
      if (inSave) {
        showFace(sheet, 'gen');
        _savePanel.setState('saved');
        _savePanel.status('The sheet is ready.', 'ok');
      } else {
        // The new sheet on screen IS the confirmation, which is why nothing is said here: _run
        // clears the status line on success anyway, so a message set now would be wiped a
        // moment later by the very thing reporting that it worked.
        await loadChars();
        select(id);                            // repaints the big image from the record just written

        // Unless it is not. "It generated and nothing changed" is the one outcome this page must
        // never produce in silence - so the picture that ended up on screen is checked against
        // the picture that was just made, and a mismatch is said out loud instead of left for
        // the eye to notice.
        const c = _chars.find(x => String(x.id) === String(id));
        const file = String(sheet).split('/').pop();
        if (!c || String(c.media || '').indexOf(file) === -1) {
          _showErr('The sheet was generated, but the character still shows the old picture',
            'The generation finished as ' + sheet + ', and the character record is still pointing at '
            + ((c && c.media) || 'nothing') + '. Reload the page - if it comes back, the record was not written.');
        }
      }
    } catch (e) {
      if (inSave) {
        _savePanel.setState('saved');          // stopped, badly - so Done and Regenerate both open up
        _savePanel.status(e.message, 'err');
      }
      throw e;                                 // so the overlay reports it too
    } finally {
      // Win or lose, the sheet's model goes back to nano-banana-2: a one-off try of another
      // engine should not become what every future character is drawn with.
      if (_sheetGear && _sheetGear.reset) _sheetGear.reset();
    }
  }, opts);
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
  _syncSheetBtn();                 // create has no saved character to regenerate for
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
    // Discarding IS the clear. Nothing else empties the bench, so nothing else has to forget.
    try { localStorage.removeItem(LS_WORK); } catch (e) {}
    // Through the painter rather than by hand. This branch used to clear the field itself,
    // which is why the "there is a portrait" flag survived a discard: the flag lives with the
    // painting, and the painting was happening in two places.
    _paintDrop('');
    if (_refPanel) _refPanel.clear();    // the instruction described a face that is gone
    if (_headPanel) _headPanel.setName('');
    _face.values = null;
    // This branch returns early, so it has to shut the save button itself - otherwise it sits
    // there looking available over an empty field. Its handler refuses anyway; a button that
    // refuses is worse than one that says so.
    const sm0 = $('cv2-savemodel');
    if (sm0) sm0.disabled = true;
    _vars = []; _varAt = -1; _paintVars();
    _paintPresetCancel();                // this branch returns early, so it repaints its own
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
  _remember();
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
  // Last, because it reads the _face this function just finished writing.
  _paintPresetCancel();
}

// Just the picture, with nothing decided: paging through the variations repaints the middle
// without touching the name, the mode or what the panels think, because none of that has changed
// - only which of the same character's takes is on screen.
function _paintDrop(src) {
  const drop = $('cv2-drop'), hint = $('cv2-drop-hint');
  if (!drop) return;
  // Said on the body, so CSS can answer "is there a portrait" without asking the DOM. Set from
  // the FIELD rather than from the mode: an image can arrive in more than one state, and the
  // two buttons it turns off are wrong in every one of them.
  document.body.dataset.portrait = src ? '1' : '';
  drop.querySelectorAll('img, .cv2-drop-del').forEach(n => n.remove());
  if (hint) hint.style.display = src ? 'none' : '';
  if (!src) return;
  const img = document.createElement('img');
  img.src = _thumb(src, 'main');
  img.alt = 'generated face';
  drop.appendChild(img);
  // The cross acts on the TAKE, so it only belongs while the take is what is on screen. During
  // the save stage the field shows the preset's ready sheet instead, and a cross there could
  // only hide the picture you are about to keep - it has no take to remove.
  if (src !== _face.src) return;
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'cv2-drop-del';
  del.title = 'Delete this image and go back to the parameters';
  del.textContent = '✕';
  _paintDelTitle(del);
  // stopPropagation because the field itself opens the file picker on click, and the cross
  // sits on top of it.
  del.addEventListener('click', (e) => { e.stopPropagation(); _deleteVar(); });
  drop.appendChild(del);
}

// What the cross removes depends on how many takes there are, so it cannot be decided once
// when the image is painted: a take pushed AFTER that paint would leave the tooltip a lie.
// Both painters call this, and _paintVars is the one that runs on every change to the list.
function _paintDelTitle(el) {
  const b = el || document.querySelector('.cv2-drop-del');
  if (!b) return;
  b.title = _vars.length > 1 ? 'Delete this take' : 'Delete this image and go back to the parameters';
}

// The cross deletes the take you are LOOKING AT. It used to empty the whole bench, which was
// defensible while the strip only appeared at two takes and mostly showed nothing - now that
// every take is on screen from the first one, wiping all of them to get rid of one reads as
// losing work rather than tidying up.
//
// A take kept with a star also lives in Unsaved, and removing it here leaves that record alone:
// the star's whole promise is that the take survives whatever happens on the bench.
function _deleteVar() {
  if (_varAt < 0 || _varAt >= _vars.length) return showFace(null);
  _vars.splice(_varAt, 1);
  if (!_vars.length) return showFace(null);          // the last one takes the bench with it
  // Stay where you were standing: after removing take 3 of 5, the one that slid into its place
  // is the one you are now looking at. Only the newest take has to step back instead.
  _varAt = Math.min(_varAt, _vars.length - 1);
  _face = { ..._vars[_varAt] };
  _paintDrop(_face.src);
  _paintVars();
  _paintPresetCancel();
  if (_refPanel) _refPanel.setSource(_face.source);
  _status('Take deleted');
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
  _paintPresetCancel();      // _face just moved, so what Cancel means may have moved with it
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
  // Every mutation of the strip goes through here - a take added, a star toggled, a take
  // chosen - so this is the one place that has to write it down.
  _remember();
  const box = $('cv2-vars');
  if (!box) return;
  box.textContent = '';
  // The strip shows from the very first take, including the one everything started from: it is
  // the picture you compare the rest against, and hiding it until a second one exists meant the
  // original was the one take you could never get back to.
  box.hidden = !_vars.length;
  // The arrows still need two - there is nowhere to step from a list of one.
  const arrows = $('cv2-drop');
  if (arrows) arrows.classList.toggle('has-vars', _vars.length > 1);
  if (!_vars.length) return;
  // Newest on the LEFT, and the reversal happens HERE rather than in the array. _varAt, the
  // star's _toggleDraft(i) and the `at` written to localStorage are all positions in _vars;
  // reversing the data to reverse the display would have moved all four at once, silently.
  const order = _vars.map((v, i) => i).reverse();
  order.forEach((i) => {
    const v = _vars[i];
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
  _paintDelTitle();          // the list just changed, so what the cross removes may have too
  // Through the same reversal the cells were laid out with, or this scrolls to the take at the
  // mirror image of the one that is actually current.
  const cur = box.children[order.indexOf(_varAt)];
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
  _syncSheetBtn();                  // entering or leaving the save stage changes what it acts on
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
      // Clicking the row picks the draft up in the EDITOR, not the save stage: an unfinished
      // character is one you came back to change, and Save character is one press away when it
      // is right. (This said "the save stage, at the sheet" long after it stopped being true.)
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
  _paintPresetCancel();      // _face just moved, so what Cancel means may have moved with it
  if (_headPanel) _headPanel.setName(_face.name);
  if (_editPanel) _editPanel.clear();
  setCreateMode('edit');             // chips open: this is a character to carry on with
  const sm = $('cv2-savemodel');
  if (sm) sm.disabled = false;
  _status('Editing "' + (rec.name || 'draft') + '" - change it, or Save character to finish it');
}

function select(id) {
  _cur = String(id);
  // Whatever is showing belongs to whoever was selected a moment ago. Left alone, one character's
  // missing sheet would follow you onto the next one.
  _clearErr();
  try { localStorage.setItem(LS_CHAR, _cur); } catch (e) {}
  renderChars();
  const c = _chars.find(x => String(x.id) === _cur) || null;
  renderSheet(c);
  loadLooks(c);
  // Guarded against arriving late: a slow read must not paint the voices - or the failure - of
  // the character you have already clicked away from.
  if (_voicePanel) _voicePanel.show(null);
  _charRec(_cur).then(rec => {
    if (String(_cur) !== String(id)) return;
    if (_voicePanel) _voicePanel.show(rec);
    if (!rec || rec.sheet) return;
    // A sheet that failed - or was left half-generated when the page was closed - is written on
    // the record and, until now, had nowhere to appear. This is the moment someone asks about
    // this character, so this is where it says what happened. Without it, a character with no
    // sheet is just a character showing its face, with no hint that anything went wrong.
    const where = [rec.imageEngine, rec.imageProvider && ('@ ' + rec.imageProvider), rec.sheetQuality]
      .filter(Boolean).join(' ');
    if (rec.sheetError) {
      _showErr('This character has no 4K sheet', rec.sheetError,
        (where ? where + ' · ' : '') + 'the gear above has a Generate 4K sheet button');
    } else if (rec.sheetTask) {
      _showErr('This character\'s 4K sheet never landed',
        'A generation was started and nobody was left watching it - closing the page ends the wait, '
        + 'not the job. Press Generate 4K sheet to make one now.',
        (where ? where + ' · ' : '') + 'task ' + String(rec.sheetTask).slice(0, 24));
    }
  }).catch(() => {});
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

// The voice panel is hidden rather than emptied: emptying would still leave the gender,
// language and accent pickers and a Search library button sitting there, and a search with no
// character to attach the result to has nowhere to put it.
function _showVoices(on) {
  const host = $('cv2-voice-host');
  if (host) host.hidden = !on;
}

function renderSheet(c) {
  _looks = [];
  _look = '';
  _syncSheetBtn();     // the Portrait gear's button acts on the character on screen
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
    // The voices belong to a character. With none selected - switching to Unsaved, say - the
    // panel was still showing the library filters and the voices of whoever WAS selected,
    // under a line asking you to pick somebody. Two answers to the same question, one of them
    // stale. So the whole panel goes and the line stands alone.
    _showVoices(false);
    return;
  }
  _showVoices(true);
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
  // The bench comes back first, because whether there IS a face decides which state the
  // create column may open in. It used to be forced to the dropdowns every time, since
  // nothing survived a reload; now ref and edit are honoured when there is something to steer.
  const hadWork = _restoreWork();
  setCreateMode((!hadWork && (cmode === 'ref' || cmode === 'edit')) ? 'main' : cmode);

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
  }, { detail: _pickDetail(_gear.t2i()) });

  // The name lives above both panels and the TPDNE button below them, so that neither moves
  // when the column flips. Head first: the ref panel names a face the moment one arrives.
  const hhost = $('cv2-create-head-host');
  if (hhost) _headPanel = CreatePanel.buildHead(hhost, { onGenerate });
  // The bench was put back before this panel existed, so its name never reached the field.
  // Seeding it here rather than moving the restore: the restore has to run first, because
  // whether there is a face decides which state the create column may open in.
  if (_headPanel && _face.name) _headPanel.setName(_face.name);
  const host = $('cv2-create-main-host');
  if (host) CreatePanel.build(host, {
    onGenerate,
    // A preset's example, taken as the face to work on. Everything a finished generation does
    // is done here too - the takes start again, the name and the build travel with it, the
    // column turns into the editor - because from this point on it IS a generated portrait as
    // far as the rest of the page is concerned. The only difference is that nothing was paid
    // for: the picture already existed.
    //
    // 'gen' and not 'upload': the examples were made in the house format, so an edit should
    // keep the frame rather than rebuild it, which is exactly what that source means.
    onUse: (p) => {
      showFace(exampleUrl(p.id), 'gen');
      _face.name = ($('cv2-name') && $('cv2-name').value.trim()) || p.name;
      if (_headPanel) _headPanel.setName(_face.name);
      _face.figure = (p.v && p.v.body) || '';
      _face.values = { ...(p.v || {}) };
      _vars = []; _varAt = -1;
      _pushVar('the preset\u2019s own face');
      if (_editPanel) _editPanel.clear();
      setCreateMode('edit');
      const sm = $('cv2-savemodel');
      if (sm) sm.disabled = false;
      _status('Using the ' + p.name + ' example - edit it, or save it as it is');
    },
  });
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
      }, { detail: _pickDetail(_gear.i2i()) }),

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
        const all = (rec && Array.isArray(rec.voices) ? rec.voices : []);
        const had = all.some(v => v.voiceId === t.voiceId);       // this character already had it
        const kept = all.filter(v => v.voiceId !== t.voiceId);
        const entry = {
          voiceId: t.voiceId, name: t.name || card.name, gender: card.gender || '',
          age: card.age || '', accent: card.accent || '', descriptive: card.descriptive || '',
          sample: t.sample || '', dur: t.dur || 0,
        };
        await _patchChar(_cur, { voice: t.voiceId, voices: kept.concat([entry]) });
        // Three different things can have happened, and they deserve three different sentences.
        // `reused` means the voice was already in our library, so no demo was recorded for it -
        // saying "Saved" there sends you looking for a second copy that does not exist.
        _voicePanel.status(
          had ? 'Already this character\'s - it is now their starred voice.'
          : t.reused ? 'Already in the library, so its demo was kept. Bound to this character.'
          : t.sampleError ? 'Saved. Its demo failed to record, which is cosmetic.'
          : 'Saved.', 'ok');
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
          // Nothing of yours has been made yet, so this undoes the choice rather than
          // stepping back from a result: the bench is emptied and the preset released.
          if (_isPresetFace()) {
            showFace(null);
            CreatePanel.clearPreset();
            _vars = []; _varAt = -1; _paintVars();
            setCreateMode('main');
            _status('Preset dropped');
            return;
          }
          setCreateMode('main');
          _status('Portrait kept as it is');
        },
      onEdit: (text) => _run('Reading the portrait…', async (pr) => {
        // Never a conversion: this portrait is already in the house format, so the frame is kept
        // and only the appearance moves.
        showFace(await _fromText(text, pr, { convert: false }), 'gen');
        _pushVar(text);
        _editPanel.clear();
      }, { detail: _pickDetail(_gear.i2i()) }),
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
          // The form may have been showing the preset's ready sheet. Nothing was saved, so the
          // bench goes back to the picture it was actually holding - _face never moved.
          _paintDrop(_face.src);
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
      onDone: () => _finishSave(),

      onSave: ({ name, gender }) => _run('Saving the character…', async (pr) => {
        const body = { name, gender, figure: _face.figure || '' };
        // Finishing a draft rather than making a new character: same id, so upsert overwrites it
        // and the draft flag comes off - which is the promotion path create already had.
        if (_resumeId) body.id = _resumeId;
        if (_face.base64) body.faceImageBase64 = _face.base64; else body.faceImagePath = _face.path;
        // The sheet this save kicks off is the same sheet the Portrait gear settles, so it is
        // asked for on the same terms. Without this, saving would ignore the gear and go to the
        // server's default aggregator - which is exactly the one that might be refusing.
        const sg = _sheetGear && _sheetGear.get();
        if (sg && sg.engine) {
          body.imageProvider = sg.provider;
          body.imageEngine = sg.engine;
          body.sheetQuality = sg.quality;
        }
        const r = await (await fetch('/api/char-store/create', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        })).json();
        if (!r || !r.success) throw new Error((r && r.error) || 'the character could not be saved');

        // The record exists from here on, and nothing below undoes it. `sheet` rather than
        // `saved`: the sheet is still being made, and Done stays shut until it stops - leaving
        // now is how a character ends up without the one asset Scenarios reads.
        _savedId = String(r.char.id);
        _resumeId = ''; _resumeGender = '';    // it is a character now, not a draft

        // An untouched preset comes back with its sheet already attached, and there is nothing
        // to wait for. It has to be checked BEFORE the wait rather than inside it: _awaitSheet
        // ends when the record's sheet stops being the one it started with, and here they are
        // the same picture - so the wait would have run to its eight-minute timeout showing
        // "Generating…" over a sheet that was finished before the request returned.
        // Straight out, not into `saved`. That state exists to hold you while you decide whether
        // the sheet that just came back is good enough to keep - and here nothing was generated
        // to have an opinion about. Stopping to offer Regenerate made Save a two-press button
        // for the one path that was supposed to be the quick one.
        if (r.char.sheet) {
          _finishSave();
          return;
        }

        _savePanel.setState('sheet');
        _savePanel.status('Saved. The 4K sheet is generating…');
        pr.tick('Generating the 4K sheet…');
        try {
          // Whatever this record already had - finishing a draft, or saving the same character
          // twice - so a picture from before cannot be handed back as this one's result. The
          // notes are the cascade talking: which aggregator refused, which one is being tried.
          showFace(await _awaitSheet(_savedId, null, (r.char && r.char.sheet) || null, (n) => {
            pr.tick(n);
            _savePanel.status(n);
          }), 'gen');
          _savePanel.setState('saved');
          _savePanel.status('The sheet is ready.', 'ok');
        } catch (e) {
          _savePanel.setState('saved');   // stopped, badly - so Done and Regenerate both open up
          _savePanel.status(e.message + ' - the character is saved; try Regenerate sheet.', 'err');
          throw e;                        // so the overlay and the error block report it too
        }
      }, { detail: _pickDetail(_sheetGear && _sheetGear.get()) }),

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

      // The same action the Portrait gear's button runs, with the same settings - one sheet, one
      // implementation. The face travels with it from here: the server prefers the character's
      // own sheet when it has one, and this is what it uses when it does not, which is exactly
      // the case that brings anyone to this button.
      onRetrySheet: () => _genSheet(_sheetGear && _sheetGear.get()),
    });

    $('cv2-savemodel').addEventListener('click', async () => {
      if (!_face.src) return;
      // An untouched preset arrives with its sheet already drawn, so the form opens on the
      // SHEET rather than on the portrait: that is the asset being saved, and showing the
      // portrait here would ask for a name over a picture that is about to be replaced.
      //
      // Painted, not written into _face: the save must still send /presets/<id>.jpg, which is
      // what tells the server it may take the shortcut.
      const ready = await _presetSheetUrl();
      if (ready) _paintDrop(ready);
      _savePanel.open({
        ready: !!ready,
        name: _face.name || ($('cv2-name') && $('cv2-name').value.trim()) || '',
        // The gender is already known by the time this form opens: a draft carries it, and a
        // portrait built here carries the values it was built from - a preset's own `gender`,
        // or the dropdown that was set. Asking again for something the page has been told is
        // how a field ends up wrong: it defaults to female, and nobody corrects a default.
        gender: _resumeGender || (_face.values && _face.values.gender) || '',
      });
      _savePanel.setResume(!!_resumeId);   // a draft being finished can also be deleted here
      setStage('save');
    });
  }

  // Last, and not awaited: they fetch one engine list between them, and nothing above needs to
  // wait for it. Until it answers, _gear returns null and a generation simply sends no engine,
  // which the server reads as "use your default".
  Gear.init($('cv2-gear-host'), $('cv2-gear')).then(g => { _gear = g; });
  // Both live inside the save form now, which SavePanel.build has already put on the page.
  Gear.initSheet($('cv2-sheet-gear-host'), $('cv2-sheet-gear')).then(g => { _sheetGear = g; });


  setMode(mode);
  setSideOpen(side);          // the looks panel starts open, as asked
  loadChars();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
