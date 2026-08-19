// Scenarios v3 — locations.
//
// One way in: the POPUP -> saved grid | 1K preview + Save | collapsible generator.
// A hover flyout used to sit beside the old casting card as a quick pick. The card is
// gone and so is it: choosing a place is now one of the two questions the annexed
// column in Build mix asks, and a hover target cannot hold a second level anyway.
//
// Four generation modes, all rendering 2:3 and landing in the shared environments
// library. A fresh result becomes the ACTIVE selection immediately, so it can be
// refined again right away — and a refinement moves the selection onto its result.

import { preview1k, genEnv, finalize, awaitTask } from './api.js';
import { thumb, thumbImg } from './chars.js';
import { startProgress, lockControls, freeze } from '../progress.js';

// Two engine settings, mirroring the looks popup: the header gear governs edits to
// a selected location, the generator column's own gear governs new ones.
const ENGINE_KEY     = 'sv3_env_engine_v1';
const CREATE_ENGINE_KEY = 'sv3_env_create_engine_v1';
const _pref = (k, d) => { try { return localStorage.getItem(k) || d; } catch (e) { return d; } };
const _engine       = () => _pref(ENGINE_KEY, 'nano-banana-2');
const _createEngine = () => _pref(CREATE_ENGINE_KEY, 'nano-banana-2');

let _envs = null;   // [{name, path, thumbPath}] — cached list

export async function loadEnvs(force) {
  if (_envs && !force) return _envs;
  try {
    const d = await fetch('/api/gallery/environments').then(r => r.json());
    _envs = (d && d.files) || [];
  } catch (e) { _envs = []; }
  return _envs;
}

// ════════════════════════════════════════════════════════════════════════════
// POPUP
// ════════════════════════════════════════════════════════════════════════════
let _ov = null;
let _active = null;    // the environment shown in the centre (public path)
let _file = null;      // { dataUrl } of an uploaded reference photo
let _busy = false;
let _onCommit = null;
let _prevToken = 0;

const _q = sel => (_ov ? _ov.querySelector(sel) : null);

function _close() {
  document.removeEventListener('keydown', _onKey);
  if (_ov) _ov.remove();
  _ov = null; _active = null; _file = null;
}
function _onKey(e) { if (e.key === 'Escape' && !_busy) _close(); }

function _status(t) { const n = _q('#sv3-env-st'); if (n) n.textContent = t || ''; }

// ── left grid ───────────────────────────────────────────────────────────────
function _renderGrid() {
  const box = _q('#sv3-env-grid');
  if (!box) return;
  box.textContent = '';
  const list = _envs || [];
  if (!list.length) {
    const e = document.createElement('div');
    e.className = 'sv3-empty';
    e.textContent = 'No locations yet — describe one on the right.';
    box.appendChild(e);
    return;
  }
  // the selected one jumps to the first row, left — so it is always in sight
  const ordered = list.slice().sort((a, b) => (a.path === _active ? -1 : 0) - (b.path === _active ? -1 : 0));
  ordered.forEach(env => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sv3-env-tile' + (_active === env.path ? ' on' : '');
    b.style.backgroundImage = `url('${env.thumbPath || env.path}')`;
    b.title = env.name || env.path;
    b.addEventListener('click', () => { _setActive(env.path); });
    box.appendChild(b);
  });
}

function _setActive(p) {
  _active = p || null;
  _renderGrid(); _renderPreview(); _syncSave(); _syncGen(); _syncEdit();
}

// ── centre preview at 1K ────────────────────────────────────────────────────
async function _renderPreview() {
  const box = _q('#sv3-env-prev');
  if (!box) return;
  box.textContent = '';
  if (!_active) {
    const e = document.createElement('div');
    e.className = 'sv3-empty';
    e.textContent = 'Pick a location on the left, or generate one.';
    box.appendChild(e);
    return;
  }
  const token = ++_prevToken;
  const img = document.createElement('img');
  img.alt = '';
  img.src = thumb(_active);
  img.className = 'warming';
  box.appendChild(img);
  const p = await preview1k(_active);
  if (token !== _prevToken || !_ov || !img.isConnected) return;
  img.src = p;
  img.classList.remove('warming');
}

function _syncSave() {
  const b = _q('#sv3-env-save');
  if (b) b.disabled = !_active || _busy;
}

// ── generator column: NEW locations only ────────────────────────────────────
// photo+text -> read the photo first; photo -> extract; text alone -> from scratch.
// Editing an existing location lives under its grid instead (see _onEdit).
function _mode() {
  const txt = ((_q('#sv3-env-prompt') || {}).value || '').trim();
  if (_file && txt) return 'extract-edit';
  if (_file) return 'extract';
  if (txt) return 'scratch';
  return '';
}
const _MODE_TEXT = {
  'extract-edit': 'Reads the photo with your notes, then draws the location.',
  extract:        'Pulls the location out of the photo, emptied of people.',
  scratch:        'Draws a new location from your description.',
};
const _GEN_LABEL = {
  'extract-edit': 'Reading the photo…',
  extract:        'Extracting the location…',
  scratch:        'Drawing the location…',
  refine:         'Adding that to the location…',
};

function _syncGen() {
  const m = _mode();
  const hint = _q('#sv3-env-mode');
  const btn = _q('#sv3-env-gen');
  const wrap = _q('#sv3-env-gen-wrap');
  if (hint) hint.textContent = m ? _MODE_TEXT[m] : 'Describe a location, or drop a photo.';
  if (btn) btn.disabled = !m || _busy;
  if (wrap) wrap.title = m ? 'Generate — this spends credits' : 'Describe a location, or drop a photo';
}

// ── edits to the SELECTED location, under its grid ──────────────────────────
function _syncEdit() {
  const ta = _q('#sv3-env-edit');
  const btn = _q('#sv3-env-edit-btn');
  const wrap = _q('#sv3-env-edit-wrap');
  if (!btn) return;
  const txt = ((ta || {}).value || '').trim();
  const ready = !!(_active && txt);
  if (ta) ta.disabled = _busy;
  btn.disabled = !ready || _busy;
  if (wrap) wrap.title = !_active ? 'Pick a location first'
    : (!txt ? 'Describe what to add or change' : 'Apply the change — this spends credits');
}

// A refinement produces a NEW location; the original is left alone. The result
// becomes the selection, so the next edit builds on it.
async function _onEdit() {
  if (!_active || _busy) return;
  const note = ((_q('#sv3-env-edit') || {}).value || '').trim();
  if (!note) return;
  await _run('refine', { prompt: note, basePath: _active, engine: _engine() },
    _q('#sv3-env-prev'), [_q('#sv3-env-edit'), _q('#sv3-env-edit-btn')],
    () => { const t = _q('#sv3-env-edit'); if (t) t.value = ''; });
}

function _showDropped(dataUrl) {
  const drop = _q('#sv3-env-drop');
  if (!drop) return;
  drop.textContent = '';
  if (dataUrl) {
    const img = document.createElement('img');
    img.src = dataUrl; img.alt = '';
    drop.appendChild(img);
    const x = document.createElement('button');
    x.type = 'button'; x.className = 'sv3-pop-dropx'; x.textContent = '×';
    x.title = 'Remove the photo';
    x.addEventListener('click', e => { e.stopPropagation(); _file = null; _showDropped(null); _syncGen(); });
    drop.appendChild(x);
  } else {
    const s = document.createElement('span');
    s.innerHTML = 'Drop a photo to pull its location<br>(or click to upload)';
    drop.appendChild(s);
  }
}

function _readFile(f) {
  if (!f || !/^image\//.test(f.type)) return;
  const fr = new FileReader();
  fr.onload = () => { _file = { dataUrl: String(fr.result || '') }; _showDropped(_file.dataUrl); _syncGen(); };
  fr.readAsDataURL(f);
}

// One runner for every paid path. Whatever comes out is saved to the library AND
// becomes the active selection, so it can be edited again immediately — an edit
// therefore always walks forward onto its own output.
async function _run(mode, body, progressHost, extraLocks, onDone) {
  _busy = true; _syncGen(); _syncSave(); _syncEdit();
  const unlock = lockControls([_q('#sv3-env-gen'), _q('#sv3-env-prompt'), _q('#sv3-env-save')].concat(extraLocks || []));
  const pr = startProgress(progressHost, { label: _GEN_LABEL[mode], total: 1 });
  const thaw = freeze(_q('.sv3-pop'));
  try {
    const r = await genEnv(body);
    const s = await awaitTask(r.taskId);
    const f = await finalize(s.imagePath, 'environment');
    pr.step(); pr.finish();

    _envs = await loadEnvs(true);
    _active = f.path;
    if (onDone) onDone();
    _renderGrid(); _renderPreview();
    _status('Location saved and selected — edit it again or press Save.');
  } catch (e) {
    pr.fail(e.message || 'generation failed');
  } finally {
    _busy = false; thaw(); unlock(); _syncGen(); _syncSave(); _syncEdit();
  }
}

async function _onGenerate() {
  const mode = _mode();
  if (!mode || _busy) return;
  const promptTxt = ((_q('#sv3-env-prompt') || {}).value || '').trim();
  await _run(mode, {
    prompt: promptTxt,
    imageBase64: _file ? _file.dataUrl : '',
    engine: _createEngine(),
  }, _q('#sv3-env-drop'), [], () => {
    _file = null; _showDropped(null);
    const ta = _q('#sv3-env-prompt'); if (ta) ta.value = '';
  });
}

// ── open ────────────────────────────────────────────────────────────────────
// backTo names whatever is still open underneath - see the note on openDressPopup.
export async function openEnvPopup({ project, onCommit, backTo }) {
  _close();
  _onCommit = onCommit;
  const cast = (project && project.casting) || {};
  _active = cast.locationImage || null;

  _ov = document.createElement('div');
  _ov.className = 'sv3-pop-ov';
  _ov.innerHTML = `
    <div class="sv3-pop">
      <div class="sv3-pop-head">
        <span class="sv3-pop-title">Location</span>
        <span class="sp"></span>
        <span class="sv3-gearwrap">
          <button class="sv3-btn sm" id="sv3-env-gear" type="button" title="Generation settings">&#9881;</button>
          <div class="sv3-gearpop" id="sv3-env-gearpop">
            <label>Engine for location generation
              <select id="sv3-env-engine">
                <option value="nano-banana-2">nano-banana-2 &mdash; 2K</option>
                <option value="nano-banana-2-lite">nano-banana-2-lite &mdash; 1K</option>
              </select>
            </label>
          </div>
        </span>
        <button class="sv3-btn sm" id="sv3-env-x" type="button" title="Close without changing the location">&times;</button>
      </div>
      <div class="sv3-pop-cols">
        <div class="sv3-pop-col sv3-env-colgrid">
          <div class="sv3-pop-sub2">Saved locations</div>
          <div class="sv3-pop-scroll" id="sv3-env-grid"></div>
          <!-- edits to whichever location is selected above -->
          <div class="sv3-env-editbox">
            <textarea class="sv3-pop-refine" id="sv3-env-edit" rows="3"
              placeholder="Add to the selected location: an armchair in the centre, a small side table, a floor lamp by the window, a rug, plants on the sill…"></textarea>
            <span id="sv3-env-edit-wrap"><button class="sv3-btn primary" id="sv3-env-edit-btn" type="button" disabled>Add to location</button></span>
          </div>
        </div>
        <div class="sv3-pop-col sv3-pop-colmid">
          <div class="sv3-pop-prev" id="sv3-env-prev"></div>
          <div class="sv3-pop-savebar">
            <span class="sv3-pop-st" id="sv3-env-st"></span>
            <span class="sp"></span>
            <button class="sv3-btn primary" id="sv3-env-save" type="button" disabled
              title="Use the shown location for this project">Save</button>
          </div>
          <div class="sv3-pop-hint">Click a location to preview it. Only Save applies it to the project.</div>
        </div>
        <div class="sv3-pop-col sv3-pop-colcreate" id="sv3-env-create">
          <div class="sv3-pop-spine" id="sv3-env-spine" title="Open the location generator">Create a location</div>
          <div class="sv3-pop-createbody">
            <div class="sv3-pop-sub2">
              Create a location
              <span class="sp"></span>
              <span class="sv3-gearwrap">
                <button class="sv3-btn sm" id="sv3-env-cgear" type="button" title="Location generation settings">&#9881;</button>
                <div class="sv3-gearpop" id="sv3-env-cgearpop">
                  <label>Engine for new locations
                    <select id="sv3-env-cengine">
                      <option value="nano-banana-2">nano-banana-2 &mdash; 2K</option>
                      <option value="nano-banana-2-lite">nano-banana-2-lite &mdash; 1K</option>
                    </select>
                  </label>
                </div>
              </span>
              <button class="sv3-btn sm" id="sv3-env-createx" type="button" title="Collapse">&times;</button>
            </div>
            <div class="sv3-pop-drop" id="sv3-env-drop">
              <span>Drop a photo to pull its location<br>(or click to upload)</span>
            </div>
            <input type="file" id="sv3-env-file" accept="image/*" style="display:none">
            <div class="sv3-pop-createfoot">
              <textarea class="sv3-pop-refine" id="sv3-env-prompt" rows="5"
                placeholder="cozy cafe by a rainy window&#10;neon night street after rain&#10;sunlit loft with brick walls&#10;quiet home kitchen, morning light&#10;hotel bathroom, warm lamps"></textarea>
              <div class="sv3-pop-mode" id="sv3-env-mode"></div>
              <div class="sv3-pop-genrow">
                <span class="sp"></span>
                <span id="sv3-env-gen-wrap"><button class="sv3-btn primary" id="sv3-env-gen" type="button" disabled>Generate</button></span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(_ov);

  _q('#sv3-env-x').addEventListener('click', () => { if (!_busy) _close(); });
  _ov.addEventListener('mousedown', e => { if (e.target === _ov && !_busy) _close(); });
  document.addEventListener('keydown', _onKey);

  if (backTo) {
    const sv = _q('#sv3-env-save');
    sv.textContent = 'Save and back to ' + backTo;
    sv.title = 'Use the shown location and return to ' + backTo;
  }

  _q('#sv3-env-save').addEventListener('click', () => {
    if (!_active) return;
    const found = (_envs || []).find(e => e.path === _active);
    const payload = { locationId: (found && found.name) || '', locationImage: _active };
    _close();
    if (_onCommit) _onCommit(payload);
  });

  _q('#sv3-env-spine').addEventListener('click', () => _q('#sv3-env-create').classList.remove('is-collapsed'));
  _q('#sv3-env-createx').addEventListener('click', () => _q('#sv3-env-create').classList.add('is-collapsed'));
  _q('#sv3-env-create').classList.add('is-collapsed');

  const drop = _q('#sv3-env-drop'), file = _q('#sv3-env-file');
  drop.addEventListener('click', () => file.click());
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => {
    e.preventDefault(); drop.classList.remove('over');
    _readFile(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]);
  });
  file.addEventListener('change', () => _readFile(file.files && file.files[0]));

  _q('#sv3-env-prompt').addEventListener('input', _syncGen);
  _q('#sv3-env-gen').addEventListener('click', _onGenerate);
  _q('#sv3-env-edit').addEventListener('input', _syncEdit);
  _q('#sv3-env-edit-btn').addEventListener('click', _onEdit);

  // header gear governs edits, the generator's own gear governs new locations
  const wireGear = (gid, pid, sid, key) => {
    const gear = _q('#' + gid), gpop = _q('#' + pid), gsel = _q('#' + sid);
    if (!gear || !gpop || !gsel) return;
    const want = _pref(key, 'nano-banana-2');
    gsel.value = Array.prototype.some.call(gsel.options, o => o.value === want) ? want : 'nano-banana-2';
    gsel.addEventListener('change', () => { try { localStorage.setItem(key, gsel.value); } catch (e) {} });
    gear.addEventListener('click', e => { e.stopPropagation(); gpop.classList.toggle('open'); });
    document.addEventListener('click', e => {
      if (gpop.classList.contains('open') && !gpop.contains(e.target) && e.target !== gear) gpop.classList.remove('open');
    });
  };
  wireGear('sv3-env-gear',  'sv3-env-gearpop',  'sv3-env-engine',  ENGINE_KEY);
  wireGear('sv3-env-cgear', 'sv3-env-cgearpop', 'sv3-env-cengine', CREATE_ENGINE_KEY);

  _status('loading…');
  _envs = await loadEnvs(true);
  if (!_ov) return;
  _status('');
  _renderGrid(); _renderPreview(); _syncSave(); _syncGen(); _syncEdit();
}
