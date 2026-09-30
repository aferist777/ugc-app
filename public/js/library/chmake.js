// LIBRARY - making a character, on the Characters shelf (phase H, the owner 2026-09-30 / 10-01).
//
// "New Character" in the shelf's header puts this where the grid and its column were, and
// "← Characters" (the same place) brings them back. It is the Character page's creation, moved: the
// parameters and presets, TPDNE and your own picture, the edit chips, the takes, and the save form that
// draws the 4K reference sheet. The panels themselves are the Character page's modules (create-panel,
// edit-panel, save-panel, presets, schema); what is new is the orchestration below, the layout
// (css/char-make.css) and the waiting.
//
// THE WAITING FOLLOWS THE JOURNAL. A portrait and a sheet each have an Alerts row written at the press
// (routes/character-v2.js, routes/char-store.js); this page follows that row by its id instead of
// polling the engine itself, so a portrait that takes five minutes still lands, a cross in Alerts stops
// the wait here too, and leaving costs nothing: the row, the portrait and the sheet go on without the
// page. Whatever is being waited for is remembered with the bench, so the area picks it up again when it
// is opened - after another shelf, after a reload, after the app was closed.
//
// THE BENCH IS KEPT until it is saved or thrown away with "start over" (the owner: work that was paid
// for is not lost by closing the area). Only pictures ON DISK are remembered: a TPDNE face is a data URL
// that was never written anywhere, and another one is a press away. There are no drafts (the owner:
// "не будем хранить черновики") - a take is kept by saving it.
//
// Leaving is allowed at every step, the sheet included (the owner): the area is only hidden.

import * as CreatePanel from '../character-v2/create-panel.js';
import * as EditPanel from '../character-v2/edit-panel.js';
import * as SavePanel from '../character-v2/save-panel.js';
import { genPrompt, genPromptFrom, refEditPrompt, exampleUrl } from '../character-v2/presets.js';
import { genName } from '../character-v2/schema.js';
import { startProgress, lockControls } from '../progress.js';

const $ = (id) => document.getElementById(id);
const LS_WORK = 'lib_chmake_v1';
const ADDRESS = '/library?shelf=characters&make=1';

// Where a generation here was asked from, for the Alerts list: pressing its row brings the Library back
// onto this area (js/library/main.js reads the address and hears ugc:goto).
const _where = (what) => ({ page: 'library', href: ADDRESS, label: 'Library · New Character · ' + what, spot: { view: 'chmake' } });

// Every picture through the thumbnail door; a data URL (TPDNE, an upload) passes straight through.
const _thumb = (src, v) => (src && String(src).startsWith('/'))
  ? ('/api/thumb?v=' + v + '&src=' + encodeURIComponent(src))
  : src;

const _sleep = (ms) => new Promise(r => setTimeout(r, ms));

let _built = false;
let _hooks = {};
let _root = null;
// The face on the bench. `base64` for one on no disk (TPDNE, an upload), `path` for a file; `source`
// 'tpdne' | 'upload' | 'gen' decides how an edit treats it; `figure` and `values` are what the
// parameters said, and travel to the save.
let _face = { src: '', base64: '', path: '', name: '', source: '', figure: '', values: null };
let _vars = [];           // every take of this person, oldest first
let _varAt = -1;
let _busy = false;
let _headPanel = null, _refPanel = null, _editPanel = null, _savePanel = null;
// What is being waited for, remembered with the bench so it can be picked up again:
//   _pending  a portrait: { alertId, label, from: 'create'|'text', text, values, name, figure, startedAt }
//   _saving   the save stage: { charId, alertId, name, gender, sheet, state: 'sheet'|'saved', note, kind }
let _pending = null;
let _saving = null;
let _follow = 0;          // which follow is current - an older one that answers late is dropped

// ── The bench, remembered ───────────────────────────────────────────────────
const _onDisk = (v) => !!(v && typeof v.src === 'string' && v.src.startsWith('/'));
const _slim = (v) => ({ src: v.src, path: v.path || v.src, name: v.name || '', source: v.source || '',
  figure: v.figure || '', label: v.label || '', values: v.values || null });

function _remember() {
  try {
    const vars = _vars.filter(_onDisk).map(_slim);
    if (!vars.length && !_onDisk(_face) && !_pending && !_saving) { localStorage.removeItem(LS_WORK); return; }
    localStorage.setItem(LS_WORK, JSON.stringify({
      face: _onDisk(_face) ? _slim(_face) : null,
      vars, at: _varAt, pending: _pending, saving: _saving,
    }));
  } catch (e) { /* this view only */ }
}

function _recall() {
  let w = null;
  try { w = JSON.parse(localStorage.getItem(LS_WORK) || 'null'); } catch (e) { w = null; }
  if (!w) return;
  _vars = (w.vars || []).map(v => ({ ...v, base64: '' }));
  _varAt = (typeof w.at === 'number' && w.at >= 0 && w.at < _vars.length) ? w.at : (_vars.length - 1);
  const f = w.face || _vars[_varAt] || null;
  if (f) {
    _face = { src: f.src, base64: '', path: f.path || f.src, name: f.name || '', source: f.source || 'gen',
      figure: f.figure || '', values: f.values || null };
  }
  _pending = w.pending || null;
  _saving = w.saving || null;
}

// ── Status and the last failure ─────────────────────────────────────────────
function _status(text, kind) {
  const el = $('chm-status');
  if (!el) return;
  el.textContent = text || '';
  el.className = 'chm-status' + (kind ? ' ' + kind : '');
  el.title = text || '';
}

function _clearErr() {
  const b = $('chm-err');
  if (b) { b.hidden = true; b.textContent = ''; }
}

// The whole sentence, under the picture, until it is dismissed or the next job starts: what was being
// attempted and exactly what came back - an engine's own words say whether to wait or to change something.
function _showErr(label, message, detail) {
  const b = $('chm-err');
  if (!b) return;
  b.textContent = '';
  const h = document.createElement('div'); h.className = 'cv2-err-h'; h.textContent = label || 'That did not work';
  const m = document.createElement('div'); m.className = 'cv2-err-m'; m.textContent = String(message || 'no reason was given');
  b.appendChild(h); b.appendChild(m);
  if (detail) { const d = document.createElement('div'); d.className = 'cv2-err-d'; d.textContent = detail; b.appendChild(d); }
  const x = document.createElement('button');
  x.type = 'button'; x.className = 'cv2-err-x'; x.textContent = '×'; x.title = 'Dismiss';
  x.addEventListener('click', _clearErr);
  b.appendChild(x);
  b.hidden = false;
}

// ── Following a row of the journal ──────────────────────────────────────────
// Until the row ends: done answers its result, failed throws its reason. `onStage` hears the row's own
// words while it runs ("uploading the face", "drawing"). A follow that is no longer the current one - the
// bench was thrown away, another started - stops quietly.
async function _followRow(alertId, onStage) {
  const my = ++_follow;
  let said = '';
  for (;;) {
    await _sleep(1500);
    if (my !== _follow) throw Object.assign(new Error('no longer waited for'), { stopped: true });
    let d = null;
    try { d = await (await fetch('/api/alerts/' + encodeURIComponent(alertId))).json(); }
    catch (e) { continue; }                      // the server restarting: ask again
    if (my !== _follow) throw Object.assign(new Error('no longer waited for'), { stopped: true });
    const it = d && d.item;
    if (!it) throw new Error((d && d.error) || 'the row of this generation is gone from Alerts');
    if (it.state === 'done') return (it.result && it.result.path) || '';
    if (it.state === 'failed') throw Object.assign(new Error(it.error || 'the generation failed'), { cancelled: !!it.cancelled });
    const s = it.stage || '';
    if (s && s !== said) { said = s; if (onStage) { try { onStage(s); } catch (e) { /* only words */ } } }
  }
}

// The cross on the overlay, offered once a wait is longer than usual: the row is let go of, and the
// wait here ends with it. What was asked for is paid for.
async function _letGo(alertId) {
  try { await fetch('/api/alerts/' + encodeURIComponent(alertId) + '/cancel', { method: 'POST' }); }
  catch (e) { /* the follow goes on and says what happened */ }
}

// ── The runner: one job at a time, everything locked, the portrait blurred ──
function _controls() {
  if (!_root) return [];
  return [
    $('cv2-name'), $('cv2-rnd'), $('cv2-gen'), $('cv2-preset'), $('cv2-preset-use'), $('cv2-preset-clear'),
    _root.querySelector('.cv2-tpdne'), $('cv2-refine'), $('cv2-apply'), $('cv2-refout'), $('chm-upload'),
    $('chm-savemodel'), $('chm-over'), $('cv2-save-cancel'), $('cv2-save-go'), $('cv2-save-retry'),
    $('cv2-edit-txt'), $('cv2-edit-cancel'), $('cv2-edit-go'),
    ..._root.querySelectorAll('.cv2-chip'), ..._root.querySelectorAll('.cv2-row-sel'),
  ];
}

// fn receives the overlay's handle. opts.startedAt picks a running wait up at its real age; opts.onCancel
// offers the overlay's own Cancel once the wait is longer than usual; opts.detail reaches the error block.
async function _run(label, fn, opts = {}) {
  if (_busy) { _status('Already working - one thing at a time', 'err'); return false; }
  _busy = true;
  _clearErr();
  const unlock = lockControls(_controls());
  const pr = startProgress($('chm-drop'), { label, total: 1, startedAt: opts.startedAt || 0, onCancel: opts.onCancel || null });
  let ok = false;
  try {
    await fn(pr);
    pr.finish();
    ok = true;
  } catch (e) {
    if (e && e.stopped) pr.detach();             // the bench was emptied under it: nothing to report
    else if (e && e.cancelled) { pr.detach(); _status('Let go of - what was asked for is paid for'); }
    else { pr.fail(e.message); _status(e.message, 'err'); _showErr(label, e.message, opts.detail); }
  } finally {
    unlock();
    if (_refPanel) _refPanel.sync();
    if (_editPanel) _editPanel.sync();
    if (_savePanel) _savePanel.sync();
    _busy = false;
    _paintSaveBtn();
  }
  return ok;
}

// ── The face on the bench ───────────────────────────────────────────────────
function _setMode(m) {
  if (_root) _root.dataset.createMode = (m === 'ref' || m === 'edit') ? m : 'main';
}

const _isPresetFace = () => /^\/presets\//.test(String((_face && _face.src) || ''));

function _paintPresetCancel() {
  const b = $('cv2-edit-cancel');
  if (!b) return;
  const undo = _isPresetFace();
  b.classList.toggle('is-drop', undo);
  b.textContent = undo ? 'Cancel selection' : 'Cancel';
  b.title = undo ? 'Drop this preset and go back to the parameters' : 'Leave the portrait as it is and go back to the parameters';
}

function _paintSaveBtn() {
  const b = $('chm-savemodel');
  if (b) b.disabled = _busy || !_face.src || !!_pending;
}

// The one writer of _face. 'tpdne' and 'upload' are a NEW person: a fresh name, the reference panel, the
// takes start over. 'gen' is the same person a step further: name and mode stay.
function _showFace(src, source) {
  if (!src) {
    _face = { src: '', base64: '', path: '', name: '', source: '', figure: '', values: null };
    _vars = []; _varAt = -1;
    _paintDrop('');
    _paintVars();
    if (_refPanel) _refPanel.clear();
    if (_headPanel) _headPanel.setName('');
    _paintPresetCancel();
    _setMode('main');
    _paintSaveBtn();
    _remember();
    return;
  }
  const isNew = source === 'tpdne' || source === 'upload';
  const isData = src.startsWith('data:');
  _face = {
    src, base64: isData ? src.slice(src.indexOf(',') + 1) : '', path: isData ? '' : src,
    name: _face.name, source: source || _face.source, figure: _face.figure, values: _face.values || null,
  };
  _paintDrop(src);
  if (isNew) {
    _face.name = genName();
    if (_headPanel) _headPanel.setName(_face.name);
    if (_refPanel) _refPanel.clear();
    _setMode('ref');
    _vars = []; _varAt = -1; _paintVars();
  }
  if (_refPanel) _refPanel.setSource(_face.source);
  _paintPresetCancel();
  _paintSaveBtn();
  _remember();
}

// Just the picture: paging through the takes, or the ready sheet shown in the save stage.
function _paintDrop(src) {
  const drop = $('chm-drop'), hint = $('chm-drop-hint');
  if (!drop) return;
  if (_root) _root.dataset.portrait = src ? '1' : '';
  drop.querySelectorAll('img, .cv2-drop-del').forEach(n => n.remove());
  if (hint) hint.style.display = src ? 'none' : '';
  if (!src) return;
  const img = document.createElement('img');
  img.src = _thumb(src, 'main');
  img.alt = 'the portrait';
  drop.appendChild(img);
  // The cross acts on the TAKE, so only while the take is what is shown - not over a sheet.
  if (src !== _face.src || (_root && _root.dataset.stage === 'save')) return;
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'cv2-drop-del';
  del.textContent = '✕';
  del.title = _vars.length > 1 ? 'Delete this take' : 'Delete this image and go back to the parameters';
  del.addEventListener('click', (e) => { e.stopPropagation(); if (!_busy) _deleteVar(); });
  drop.appendChild(del);
}

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
  _paintPresetCancel();
  if (_refPanel) _refPanel.setSource(_face.source);
}

function _deleteVar() {
  if (_varAt < 0 || _varAt >= _vars.length) return _showFace(null);
  _vars.splice(_varAt, 1);
  if (!_vars.length) return _showFace(null);
  _varAt = Math.min(_varAt, _vars.length - 1);
  _face = { ..._vars[_varAt] };
  _paintDrop(_face.src);
  _paintVars();
  _paintPresetCancel();
  if (_refPanel) _refPanel.setSource(_face.source);
  _status('Take deleted');
}

// The takes under the portrait, newest on the left. Every change to them passes here, so this is the
// one place the bench is written down.
function _paintVars() {
  _remember();
  const box = $('chm-vars');
  if (!box) return;
  box.textContent = '';
  box.hidden = !_vars.length;
  const drop = $('chm-drop');
  if (drop) drop.classList.toggle('has-vars', _vars.length > 1);
  if (!_vars.length) return;
  const order = _vars.map((v, i) => i).reverse();
  order.forEach((i) => {
    const v = _vars[i];
    const cell = document.createElement('div');
    cell.className = 'cv2-var' + (i === _varAt ? ' is-cur' : '');
    cell.title = i === 0 ? 'the first take' : (v.label || ('take ' + (i + 1)));
    const img = document.createElement('img');
    img.src = _thumb(v.src, 'card');
    img.alt = '';
    cell.appendChild(img);
    cell.addEventListener('click', () => { if (!_busy) _showVar(i); });
    box.appendChild(cell);
  });
  const del = document.querySelector('#chm-drop .cv2-drop-del');
  if (del) del.title = _vars.length > 1 ? 'Delete this take' : 'Delete this image and go back to the parameters';
  const cur = box.children[order.indexOf(_varAt)];
  if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

// ── A portrait: asked for, then followed ─────────────────────────────────────
// `p` is what landing it needs: where it came from, the words or the values, the name. Kept in _pending
// until it lands, so an area opened again - or the app started again - goes on waiting for it.
async function _askPortrait(body, p) {
  const r = await (await fetch('/api/character-v2/generate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, where: _where('portrait') }),
  })).json();
  if (!r || !r.success) throw new Error((r && r.error) || 'the engine refused the prompt');
  if (!r.alertId) throw new Error('the portrait was asked for, but the server wrote no row to follow');
  _pending = { ...p, alertId: r.alertId, startedAt: Date.now(), detail: r.engine ? (r.engine + ' @ ' + r.provider + ', ' + r.quality) : '' };
  _remember();
  _paintSaveBtn();
  return _pending;
}

// The portrait has landed: onto the bench as a take of whoever asked for it.
function _landPortrait(path, p) {
  _pending = null;
  if (p.from === 'create') {
    _showFace(path, 'gen');
    _face.name = p.name || _face.name || '';
    _face.figure = (p.values && p.values.body) || '';
    _face.values = p.values ? { ...p.values } : null;
    _vars = []; _varAt = -1;
    _pushVar('the first take');
    if (_editPanel) _editPanel.clear();
    _setMode('edit');
    if (_headPanel && p.name) _headPanel.setName(p.name);
  } else {
    _showFace(path, 'gen');
    _pushVar(p.text || 'an edit');
    if (p.panel === 'ref' && _refPanel) _refPanel.clear();
    if (p.panel === 'edit' && _editPanel) _editPanel.clear();
    _setMode(p.panel === 'ref' ? 'ref' : 'edit');
  }
  _paintSaveBtn();
  _remember();
}

// Waiting for the portrait in _pending, under the overlay. Also how a wait is picked up again.
function _awaitPortrait() {
  const p = _pending;
  if (!p) return Promise.resolve(false);
  return _run(p.label || 'Generating the portrait…', async (pr) => {
    try {
      const path = await _followRow(p.alertId, (s) => pr.tick(s));
      if (!path) throw new Error('the portrait finished without a picture');
      if (_pending && _pending.alertId === p.alertId) _landPortrait(path, p);
    } catch (e) {
      if (!e.stopped && _pending && _pending.alertId === p.alertId) { _pending = null; _remember(); }
      throw e;
    }
  }, { startedAt: p.startedAt, detail: p.detail, onCancel: () => _letGo(p.alertId) });
}

// Text into a new picture, in two steps: the analyzer reads the picture together with the words and
// answers with prompt material or a refusal (a refusal costs no engine call), then the engine draws it.
// A bare TPDNE crop is CONVERTED into the house portrait; anything else is edited where it stands.
async function _fromText(text, panel) {
  if (!_face.src) throw new Error('Nothing to work from - make a portrait first');
  const convert = panel === 'ref' && _face.source === 'tpdne';
  const ref = _face.base64 ? { imageBase64: _face.base64 } : { imagePath: _face.path };
  const a = await (await fetch('/api/character-v2/analyze', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...ref, text }),
  })).json();
  if (!a || !a.success) throw new Error((a && a.error) || 'the analyzer failed');
  if (!a.ok) throw new Error(a.reason);
  await _askPortrait({
    prompt: convert ? genPromptFrom(a.who) : refEditPrompt(a.who, a.change),
    imageUrl: a.imageUrl, aspect: convert ? '3:2' : 'match_input_image',
  }, { from: 'text', text, panel, label: panel === 'ref' ? 'Reading the reference…' : 'Reading the portrait…' });
}

// ── The save stage ──────────────────────────────────────────────────────────
function _setStage(on) {
  if (!_root) return;
  if (on) _root.dataset.stage = 'save'; else delete _root.dataset.stage;
}

// Following the sheet of the character in _saving. The save form says each stage the row says.
function _awaitSheet() {
  const s = _saving;
  if (!s || !s.alertId) return Promise.resolve(false);
  _savePanel.setState('sheet');
  _savePanel.status(s.note || 'The 4K sheet is being made…');
  return _run('Generating the 4K sheet…', async (pr) => {
    try {
      const sheet = await _followRow(s.alertId, (st) => { pr.tick('4K sheet · ' + st); _savePanel.status(st); s.note = st; _remember(); });
      if (_saving !== s) return;
      s.sheet = sheet; s.state = 'saved'; s.note = 'The sheet is ready.'; s.kind = 'ok';
      _remember();
      if (sheet) _paintDrop(sheet);
      _savePanel.setState('saved');
      _savePanel.status('The sheet is ready.', 'ok');
    } catch (e) {
      if (e.stopped || _saving !== s) throw e;
      s.state = 'saved'; s.kind = 'err';
      s.note = (e.cancelled ? 'The sheet was let go of' : e.message) + ' - the character is saved; Try again draws it again.';
      _remember();
      _savePanel.setState('saved');
      _savePanel.status(s.note, 'err');
      throw e;
    }
  }, { startedAt: s.startedAt, onCancel: () => _letGo(s.alertId) });
}

// Done, or a preset whose sheet was ready: the bench empties, the area closes, and the shelf is read
// again with the new character selected and in view (js/library/main.js, onSaved).
function _finishSave() {
  const s = _saving || {};
  const id = s.charId || '', name = (_savePanel && _savePanel.name()) || s.name || '';
  _saving = null;
  _follow++;
  _setStage(false);
  _showFace(null);
  _remember();
  if (_hooks.onSaved) _hooks.onSaved(id, name);
}

async function _patchChar(id, fields) {
  const p = await (await fetch('/api/char-store/' + encodeURIComponent(id), {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields),
  })).json();
  if (!p || !p.success) throw new Error((p && p.error) || 'the character could not be changed');
  return p.char;
}

// The same person drawn again, from the save form's "Try again" / "Regenerate": the character's own
// picture (the server picks it), a new row, the same wait.
function _retrySheet() {
  const s = _saving;
  if (!s || !s.charId) return;
  return _run('Asking for the sheet again…', async () => {
    const body = { charId: s.charId, figure: _face.figure || '', where: _where('sheet') };
    if (_face.base64) body.faceImageBase64 = _face.base64; else if (_face.path) body.faceImagePath = _face.path;
    const r = await (await fetch('/api/char-store/regen-ref', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })).json();
    if (!r || !r.success) throw new Error((r && r.error) || 'the sheet could not be asked for again');
    s.alertId = r.alertId || ''; s.state = 'sheet'; s.note = ''; s.kind = ''; s.startedAt = Date.now();
    _remember();
  }).then((ok) => { if (ok && s.alertId) return _awaitSheet(); });
}

// ── Build ───────────────────────────────────────────────────────────────────
function _build() {
  const host = $('lib-chmake');
  if (!host || _built) return;
  host.innerHTML = `
    <div class="chm" data-create-mode="main" data-portrait="">
      <section class="chm-col chm-params" aria-label="Create model">
        <div class="chm-spine">Create model</div>
        <div class="chm-head">
          <span class="chm-t">Create model</span><span class="sp"></span>
          <button class="lib-btn chm-over" type="button" id="chm-over" title="Empty the bench: the portrait and its takes go (their files stay in media/work)">start over</button>
        </div>
        <div class="chm-body">
          <div id="chm-head-host"></div>
          <div data-mode-when="main" id="chm-main-host"></div>
          <div data-mode-when="ref" id="chm-ref-host"></div>
          <div data-mode-when="edit" id="chm-edit-host"></div>
          <div id="chm-foot-host"></div>
        </div>
      </section>
      <section class="chm-col chm-work" aria-label="Portrait">
        <div class="chm-head"><span class="chm-t">Portrait</span><span class="sp"></span><span class="chm-status" id="chm-status"></span></div>
        <div class="chm-body">
          <div class="cv2-drop" id="chm-drop">
            <button class="cv2-page is-prev" type="button" id="chm-prev" title="Previous take"></button>
            <button class="cv2-page is-next" type="button" id="chm-next" title="Next take"></button>
            <div class="cv2-drop-hint" id="chm-drop-hint">Nothing here yet.<br>Set the parameters and press Create, take a preset as it is with “use”, or a random face with TPDNE.<br>You can also drop your own picture here, or click to pick one.</div>
          </div>
          <div class="cv2-mid-bar">
            <div class="cv2-vars" id="chm-vars" hidden></div>
            <div class="cv2-mid-foot">
              <button class="cv2-savemodel" type="button" id="chm-savemodel" disabled title="Name this character and draw its 4K reference sheet">Save character</button>
            </div>
          </div>
          <div class="cv2-err" id="chm-err" hidden></div>
        </div>
      </section>
      <section class="chm-col chm-save" aria-label="Save character">
        <div class="chm-head"><span class="chm-t">Save character</span></div>
        <div class="chm-body" id="chm-save-host"></div>
      </section>
    </div>`;
  _root = host.querySelector('.chm');
  _built = true;

  // No "Save image as" on a miniature: every picture here cancels the window's own menu (phase B7).
  host.addEventListener('contextmenu', (e) => { if (e.target.closest('img')) e.preventDefault(); });
  // Dismissing a failed overlay dismisses the whole failure, the block under the picture too.
  host.addEventListener('sv3-progress-dismissed', _clearErr);

  const onGenerate = (values, name) => _run('Generating the character…', async (pr) => {
    const p = await _askPortrait({ prompt: genPrompt(values) },
      { from: 'create', values: { ...values }, name: name || '', label: 'Generating the character…' });
    const path = await _followRow(p.alertId, (s) => pr.tick(s));
    if (!path) throw new Error('the portrait finished without a picture');
    if (_pending && _pending.alertId === p.alertId) _landPortrait(path, p);
  }, { onCancel: () => { if (_pending) _letGo(_pending.alertId); } }).then((ok) => {
    if (!ok && _pending && !_busy) { _pending = null; _remember(); _paintSaveBtn(); }
  });

  _headPanel = CreatePanel.buildHead($('chm-head-host'), { onGenerate });
  CreatePanel.build($('chm-main-host'), {
    onGenerate,
    // A preset's own face, taken as it is: nothing is paid for, and saving it untouched takes the
    // preset's ready sheet too (routes/char-store.js, the preset shortcut).
    onUse: (p) => {
      if (_busy) return;
      _showFace(exampleUrl(p.id), 'gen');
      _face.name = ($('cv2-name') && $('cv2-name').value.trim()) || p.name;
      if (_headPanel) _headPanel.setName(_face.name);
      _face.figure = (p.v && p.v.body) || '';
      _face.values = { ...(p.v || {}) };
      _vars = []; _varAt = -1;
      _pushVar('the preset’s own face');
      if (_editPanel) _editPanel.clear();
      _setMode('edit');
      _paintSaveBtn();
      _status('Using the ' + p.name + ' preset - edit it, or save it as it is');
    },
  });
  CreatePanel.buildFoot($('chm-foot-host'), {
    onTpdne: () => _run('Fetching a face…', async () => {
      const d = await (await fetch('/api/random-face')).json();
      if (!d || !d.success) throw new Error((d && d.error) || 'TPDNE did not answer with a face');
      _showFace(d.dataUrl, 'tpdne');
    }),
  });
  _refPanel = CreatePanel.buildRef($('chm-ref-host'), {
    onApply: (text) => _run('Reading the reference…', async (pr) => {
      await _fromText(text, 'ref');
      pr.tick('Drawing…');
      const p = _pending;
      const path = await _followRow(p.alertId, (s) => pr.tick(s));
      if (!path) throw new Error('the portrait finished without a picture');
      if (_pending && _pending.alertId === p.alertId) _landPortrait(path, p);
    }, { onCancel: () => { if (_pending) _letGo(_pending.alertId); } }).then((ok) => {
      if (!ok && _pending && !_busy) { _pending = null; _remember(); _paintSaveBtn(); }
    }),
    onExit: () => { if (!_busy) _showFace(null); },
  });
  _editPanel = EditPanel.build($('chm-edit-host'), {
    onCancel: () => {
      if (_isPresetFace()) {
        _showFace(null);
        CreatePanel.clearPreset();
        _status('Preset dropped');
        return;
      }
      _setMode('main');
      _status('Portrait kept as it is');
    },
    onEdit: (text) => _run('Reading the portrait…', async (pr) => {
      await _fromText(text, 'edit');
      pr.tick('Drawing…');
      const p = _pending;
      const path = await _followRow(p.alertId, (s) => pr.tick(s));
      if (!path) throw new Error('the portrait finished without a picture');
      if (_pending && _pending.alertId === p.alertId) _landPortrait(path, p);
    }, { onCancel: () => { if (_pending) _letGo(_pending.alertId); } }).then((ok) => {
      if (!ok && _pending && !_busy) { _pending = null; _remember(); _paintSaveBtn(); }
    }),
  });

  for (const [id, step] of [['chm-prev', -1], ['chm-next', 1]]) {
    $(id).addEventListener('click', (e) => {
      e.stopPropagation();
      if (_vars.length < 2 || _busy) return;
      _showVar(Math.min(_vars.length - 1, Math.max(0, _varAt + step)));
    });
  }
  _wireUpload();

  $('chm-over').addEventListener('click', () => {
    if (_busy) return;
    if ((_face.src || _vars.length) && !confirm('Start over? The portrait and its takes leave the bench - their files stay in media/work.')) return;
    _pending = null;
    _follow++;
    _showFace(null);
    _clearErr();
    _status('');
  });

  _savePanel = SavePanel.build($('chm-save-host'), {
    onCancel: () => {
      _setStage(false);
      _paintDrop(_face.src);
      _status('Not saved - the portrait is still here');
    },
    onDelete: () => {},                          // drafts are gone: the button never shows
    onDone: () => _finishSave(),
    onSave: ({ name, gender }) => _run('Saving the character…', async () => {
      const body = { name, gender, figure: _face.figure || '', where: _where('sheet') };
      if (_face.base64) body.faceImageBase64 = _face.base64; else body.faceImagePath = _face.path;
      const r = await (await fetch('/api/char-store/create', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })).json();
      if (!r || !r.success) throw new Error((r && r.error) || 'the character could not be saved');
      _saving = { charId: String(r.char.id), alertId: r.alertId || '', name, gender, state: 'sheet', startedAt: Date.now(), note: '', kind: '' };
      _remember();
      // An untouched preset came with its sheet: nothing to wait for, straight out.
      if (r.char.sheet) { _finishSave(); return; }
      if (!r.alertId) throw new Error('the character is saved, but its sheet has no row to follow - see Alerts');
    }).then((ok) => { if (ok && _saving && _saving.state === 'sheet') return _awaitSheet(); }),
    onRename: (name) => {
      if (!_saving) return;
      _saving.name = name; _remember();
      _patchChar(_saving.charId, { name }).then(() => _status('Renamed to “' + name + '”')).catch(e => _status(e.message, 'err'));
    },
    onRegender: (gender) => {
      if (!_saving) return;
      _saving.gender = gender; _remember();
      _patchChar(_saving.charId, { gender }).then(() => _status('Gender set to ' + gender)).catch(e => _status(e.message, 'err'));
    },
    onRetrySheet: () => _retrySheet(),
  });

  $('chm-savemodel').addEventListener('click', async () => {
    if (!_face.src || _busy || _pending) return;
    // An untouched preset arrives with its sheet already drawn: the form opens on the SHEET.
    const ready = await _presetSheetUrl();
    if (ready) _paintDrop(ready);
    _savePanel.open({
      ready: !!ready,
      name: _face.name || ($('cv2-name') && $('cv2-name').value.trim()) || '',
      gender: (_face.values && _face.values.gender) || '',
    });
    _savePanel.setResume(false);
    _setStage(true);
    _paintDrop(ready || _face.src);
  });
}

async function _presetSheetUrl() {
  const m = String((_face && _face.src) || '').match(/^\/presets\/([a-z0-9._-]+)\.jpg$/i);
  if (!m) return '';
  const url = '/presets/sheets/' + m[1] + '.jpg';
  try { const r = await fetch(url, { method: 'HEAD' }); return r.ok ? url : ''; } catch (e) { return ''; }
}

// Your own picture as the face: pressing the empty field, or dropping a file on it. It behaves like a
// TPDNE face - the reference panel - except that an upload keeps its framing, clothing and background.
const _UPLOAD_MAX = 20 * 1024 * 1024;
function _wireUpload() {
  const drop = $('chm-drop');
  const inp = document.createElement('input');
  inp.type = 'file'; inp.id = 'chm-upload'; inp.accept = 'image/*'; inp.hidden = true;
  drop.appendChild(inp);
  const take = (file) => {
    if (!file) return;
    if (!/^image\//.test(file.type || '')) { _status('That file is not a picture', 'err'); return; }
    if (file.size > _UPLOAD_MAX) { _status('That picture is ' + Math.round(file.size / 1048576) + ' MB - the limit is 20', 'err'); return; }
    const fr = new FileReader();
    fr.onerror = () => _status('Could not read that file', 'err');
    fr.onload = () => {
      if (_busy || _pending || (_root && _root.dataset.stage === 'save')) { _status('Busy - drop it again in a moment', 'err'); return; }
      _status('');
      _showFace(String(fr.result), 'upload');
    };
    fr.readAsDataURL(file);
  };
  inp.addEventListener('change', () => { const f = (inp.files && inp.files[0]) || null; inp.value = ''; take(f); });
  drop.addEventListener('click', (e) => {
    if (_busy || _face.src || _pending) return;
    if (e.target.closest('.cv2-drop-del, .cv2-page')) return;
    inp.click();
  });
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, (e) => { e.preventDefault(); if (!_busy) drop.classList.add('is-drag'); }));
  ['dragleave', 'dragend'].forEach(ev => drop.addEventListener(ev, () => drop.classList.remove('is-drag')));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('is-drag');
    if (_busy || _face.src) return;
    take((e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) || null);
  });
}

// ── The bench put back, and whatever it was waiting for picked up again ─────
function _restore() {
  _recall();
  if (_face.src) {
    _paintDrop(_face.src);
    if (_headPanel) _headPanel.setName(_face.name);
    _setMode(_face.source === 'upload' || _face.source === 'tpdne' ? 'ref' : 'edit');
    if (_refPanel) _refPanel.setSource(_face.source);
  }
  _paintVars();
  _paintPresetCancel();
  _paintSaveBtn();
  if (_saving) {
    // The save stage comes back as it was left: the form, the character's name, and the sheet - still
    // coming, or landed, or failed with its reason.
    _savePanel.open({ name: _saving.name || '', gender: _saving.gender || '' });
    _savePanel.setResume(false);
    _setStage(true);
    if (_saving.sheet) _paintDrop(_saving.sheet);
    if (_saving.state === 'sheet' && _saving.alertId) { _awaitSheet(); return; }
    _savePanel.setState('saved');
    if (_saving.note) _savePanel.status(_saving.note, _saving.kind || undefined);
    return;
  }
  if (_pending && _pending.alertId) _awaitPortrait().then((ok) => { if (!ok && _pending && !_busy) { _pending = null; _remember(); _paintSaveBtn(); } });
}

// ── The area's door ─────────────────────────────────────────────────────────
export function init(hooks) { _hooks = hooks || {}; }

let _opened = false;
export function open() {
  const host = $('lib-chmake');
  if (!host) return;
  if (!_built) _build();
  host.hidden = false;
  // The first time only: after that the area keeps its own state - it was only hidden.
  if (!_opened) { _opened = true; _restore(); }
}

// Hidden, not stopped: a portrait or a sheet being waited for goes on, and so does its wait here.
export function close() {
  const host = $('lib-chmake');
  if (host) host.hidden = true;
}

// Whether a save stage or a wait is open - the shelf says so on the button that comes back to it.
export function working() { return !!(_busy || _pending || _saving); }
