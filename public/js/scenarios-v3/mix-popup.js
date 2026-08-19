// Scenarios v3 — Build mix: composing the FIRST FRAME of each fragment.
//
//   left    sources (character + location), the edit field and the one button
//   centre  the active image, with the strip of generated frames beneath it
//   right   approved frames, the distribution mode and Save
//
// Exactly one thing is active at a time: either the two sources (compose from
// scratch) or a single generated frame (edit that frame). The whole workspace —
// frames, approvals, bans, the note, the settings — lives on the PROJECT, so
// closing the popup loses nothing and every project keeps its own.
//
// Phase scope: the shell and its persistence. Generation lands next.

import { patchProject } from './projects.js';
import { thumbImg, thumb } from './chars.js';
// The pickers, and the two popups their + opens, are fetched the first time one is asked
// for. None of them is needed to show a frame - most visits to this popup never open one -
// and together they are a sizeable share of the page's JavaScript.
//
// The resolved picker is kept so _close() can reach closePick() without awaiting: closing
// must not be the one thing on this page that has to wait for a network round trip.
let _pick = null;
const _needPick  = async () => (_pick || (_pick = await import('./pick-panel.js')));
const _needDress = () => import('./dress-popup.js');
const _needEnv   = () => import('./env-popup.js');
import { preview1k, genFrame, analyzeFrame, finalize, awaitTask,
         frameOptions, listPoses, cropFrame, mediaSize, getProject, saveProject } from './api.js';
import { startProgress, lockControls, freeze } from '../progress.js';

// Which service the task is created on. kie.ai is the default and carries the
// whole flow; Replicate hosts the same nano-banana-2 and stays selectable.
const AGGREGATORS = [
  { id: 'kie',       label: 'kie.ai',    models: ['nano-banana-2', 'nano-banana-2-lite'] },
  { id: 'replicate', label: 'Replicate', models: ['nano-banana-2'] },
];
const MODELS = [
  { id: 'nano-banana-2',      label: 'nano-banana-2',      quality: ['1K', '2K', '4K'] },
  { id: 'nano-banana-2-lite', label: 'nano-banana-2-lite', quality: ['1K'] },
];
const FORMATS = ['9:16', '2:3', '3:4', '1:1', '16:9'];

// What each parameter is for, shown on the "?" beside its dropdown.
const HELP = {
  camera: 'Optics only — focal length, aperture and sensor character. Steers facial '
        + 'geometry, how much the background blurs and overall sharpness. It does not '
        + 'change the pose or how much of the body is in frame.',
  framing: 'How much of the body the camera sees. Each framing is a GROUP: the poses '
         + 'below belong to it, so a pose can never carry a crop that fights the framing.',
  pose: 'The static body position — where the limbs are, not what the person is doing '
      + '(motion is set elsewhere). Only poses from the selected framing group are '
      + 'listed. A pose with a mannequin drawn for it becomes the BASE of the shot: its '
      + 'body position, camera angle and crop are reproduced, and the character is built '
      + 'onto it. "text only" means no mannequin exists yet, so the wording alone steers it.',
};

const MODES = [
  { id: 'same',   label: 'All fragments the same' },
  { id: 'cycle',  label: 'Cycle through frames' },
  { id: 'random', label: 'Random per fragment' },
  { id: 'manual', label: 'Assign manually' },
];

const SAVE_WAIT = 500;

let _ov    = null;
let _proj  = null;
let _mix   = null;      // the working copy; mirrored to the project on a debounce
let _saveT = null;
let _onSaved = null;
let _keepAssign = false;   // opened just to add frames: Save must not reshuffle fragments

// The in-flight generation, if any. It deliberately OUTLIVES the popup: closing the
// window mid-generation used to strand the job — the button stayed dead because the
// busy flag was never cleared, and the finished frame was thrown away because _mix
// had become null. The job now owns its own state, re-attaches its progress overlay
// whenever the popup opens again, and files its result either way.
//   { projectId, mode, label, total, done, startedAt, req, pr, thaw, unlock }
let _job = null;
// A failure that happened while nobody was watching, surfaced on the next open.
let _lastFail = null;
// Set when a job wrote to the record behind the page's back, so the next open
// refetches instead of saving a stale variant list over the new frame.
let _staleProject = '';
let _fopts = { cameras: [], framings: [] };   // global presets
let _poses = [];        // the existing mannequin base

const _q = sel => (_ov ? _ov.querySelector(sel) : null);

const _blank = () => ({
  settings: { aggregator: 'kie', model: 'nano-banana-2', format: '9:16', quality: '2K' },
  variants: [], approved: [], banned: [], activeId: '', note: '', distribution: 'same',
  pending: null, lastError: '',
});

// ── persistence ─────────────────────────────────────────────────────────────
// While the SERVER is finishing a generation for this project it owns the record:
// saving our copy would drop the frame it is about to file. The popup is frozen for
// the duration anyway, so there is nothing of the user's to lose by holding off.
const _serverOwnsRecord = () => !!(_job && _job.remote);

function _queueSave() {
  clearTimeout(_saveT);
  _saveT = setTimeout(async () => {
    if (!_mix || _serverOwnsRecord()) return;
    try { await patchProject({ mix: _mix }); } catch (e) { console.error('[sv3] mix save failed', e); }
  }, SAVE_WAIT);
}
async function _flushSave() {
  clearTimeout(_saveT);
  if (!_mix || _serverOwnsRecord()) return;
  try { await patchProject({ mix: _mix }); } catch (e) { console.error('[sv3] mix save failed', e); }
}

function _close() {
  document.removeEventListener('keydown', _onKey);
  _flushSave();
  _closePeek();               // the hover preview lives on <body>, not in the overlay
  if (_pick) _pick.closePick();   // null until a picker has actually been opened
  _cropClear();
  _detachJob();               // the generation keeps running; only its overlay goes
  if (_ov) _ov.remove();
  _ov = null; _proj = null; _mix = null;
}

// ── the in-flight job, and its detachable UI ────────────────────────────────
const _jobIsHere = () => !!(_job && _proj && String(_job.projectId) === String(_proj.id));

// Show the running job in the popup that is open now: the overlay picks up the
// real elapsed time, and the controls lock exactly as they did on the first paint.
function _attachJob() {
  if (!_ov || !_jobIsHere() || _job.pr) return;
  _job.pr = startProgress(_q('#sv3-mx-prev'),
    { label: _job.label, total: _job.total, startedAt: _job.startedAt });
  for (let i = 0; i < _job.done; i++) _job.pr.step();
  _job.thaw = freeze(_q('.sv3-mx'));
  _job.unlock = lockControls([_q('#sv3-mx-gen'), _q('#sv3-mx-note'), _q('#sv3-mx-save'),
                              _q('#sv3-mx-camera'), _q('#sv3-mx-framing'), _q('#sv3-mx-pose')]);
}

// Drop the overlay and the locks without touching the job itself. `detach` rather
// than `finish` so a closed popup never poisons the duration the countdown learns.
function _detachJob() {
  if (!_job) return;
  if (_job.pr) { try { _job.pr.detach(); } catch (e) {} _job.pr = null; }
  if (_job.thaw) { try { _job.thaw(); } catch (e) {} _job.thaw = null; }
  if (_job.unlock) { try { _job.unlock(); } catch (e) {} _job.unlock = null; }
}

// A generation this page did NOT start — begun before a reload, or in another tab.
// The server is driving it, so all this does is show progress and pick up the
// result when it lands. Nothing here may write to the record: the watcher owns it.
async function _followPending(projectId, pending) {
  if (_job) return;
  _job = {
    projectId, mode: pending.mode || 'compose', remote: true,
    label: 'Generating…', total: 1, done: 0,
    startedAt: Date.parse(pending.startedAt || '') || Date.now(),
    pr: null, thaw: null, unlock: null,
  };
  _attachJob();
  _syncGenerate();
  try {
    for (;;) {
      await new Promise(r => setTimeout(r, 3000));
      const full = await getProject(projectId).catch(() => null);
      const mix = full && full.mix;
      if (!mix) continue;
      if (mix.pending && mix.pending.taskId === pending.taskId) continue;   // still running
      // it finished one way or the other — adopt whatever the server wrote
      const openHere = _ov && _proj && String(_proj.id) === String(projectId);
      if (openHere) {
        _mix = Object.assign(_blank(), mix);
        _renderAll();
        _status(mix.lastError ? 'Last generation failed: ' + mix.lastError : 'Frame composed.');
      } else if (mix.lastError) {
        _lastFail = { projectId, message: mix.lastError };
      }
      if (_job && _job.pr) { if (mix.lastError) _job.pr.fail(mix.lastError); else _job.pr.finish(); }
      return;
    }
  } finally {
    if (_job) { if (_job.thaw) _job.thaw(); if (_job.unlock) _job.unlock(); }
    _job = null;
    _syncGenerate();
  }
}

// ── crop the active frame ───────────────────────────────────────────────────
// Generation is not always obedient: a half-body request can come back knees-up.
// Rather than re-roll it, the shot can be cut by hand — free and instant. The
// selection is locked to the working format from the gear, so a crop can never
// change the shape of the frame, and the result lands in the strip as a NEW variant
// instead of replacing what it came from.
const CROP_MIN = 1 / 3;        // matches the server's floor
const CROP_HINT_MS = 500;

let _crop = null;   // { rect:{x,y,w,h} in image fractions, dragging, mode, ... }
let _cropHintT = null;
let _cropSrc = null;      // real pixel size of the frame being cropped
let _cropSrcFor = '';

// The label must state the size the crop will REALLY be, so it is measured on the
// stored frame rather than on the derivative the preview happens to show.
async function _cropMeasure(path) {
  if (_cropSrcFor === path) return;
  _cropSrcFor = path;
  try {
    const m = await mediaSize(path);
    if (_cropSrcFor !== path) return;
    _cropSrc = { w: m.width, h: m.height };
    if (_crop) { _crop.srcSize = _cropSrc; _cropRender(); }
  } catch (e) { /* the label falls back to a placeholder */ }
}

const _cropRatio = () => {
  const [a, b] = String((_mix && _mix.settings.format) || '9:16').split(':').map(Number);
  return (a > 0 && b > 0) ? a / b : 9 / 16;
};

// The image is `object-fit: contain`, so it does not fill its box: everything has to
// be measured against the LETTERBOXED rectangle, not the container.
function _cropImgBox() {
  const box = _q('#sv3-mx-prev');
  const img = box && box.querySelector('img');
  if (!img || !img.naturalWidth) return null;
  const br = box.getBoundingClientRect();
  const scale = Math.min(br.width / img.naturalWidth, br.height / img.naturalHeight);
  const w = img.naturalWidth * scale, h = img.naturalHeight * scale;
  return { left: br.left + (br.width - w) / 2, top: br.top + (br.height - h) / 2, w, h, br };
}

function _cropClear() {
  clearTimeout(_cropHintT);
  _crop = null;
  _cropSrc = null; _cropSrcFor = '';   // the next frame has its own size
  const box = _q('#sv3-mx-prev');
  if (!box) return;
  box.querySelectorAll('.sv3-crop, .sv3-crop-hint').forEach(n => n.remove());
  box.classList.remove('cropping');
}

function _cropHint(show) {
  const box = _q('#sv3-mx-prev');
  if (!box) return;
  box.querySelectorAll('.sv3-crop-hint').forEach(n => n.remove());
  if (!show) return;
  const h = document.createElement('div');
  h.className = 'sv3-crop-hint';
  h.textContent = `Drag to crop this frame · ${(_mix && _mix.settings.format) || '9:16'} is kept`;
  box.appendChild(h);
}

// Draw the selection: a dimmed surround, the box, corner handles, and the two
// actions. The actions sit above the box, flipping below when there is no room.
function _cropRender() {
  const box = _q('#sv3-mx-prev');
  const g = _cropImgBox();
  if (!box || !g || !_crop) return;
  box.querySelectorAll('.sv3-crop').forEach(n => n.remove());

  const r = _crop.rect;
  const px = {
    left: g.left - g.br.left + r.x * g.w,
    top:  g.top  - g.br.top  + r.y * g.h,
    w: r.w * g.w, h: r.h * g.h,
  };

  const wrap = document.createElement('div');
  wrap.className = 'sv3-crop';

  const shade = document.createElement('div');
  shade.className = 'sv3-crop-shade';
  // a box-shadow spread far beyond the frame is the cheapest reliable dimmer
  shade.style.cssText = `left:${px.left}px; top:${px.top}px; width:${px.w}px; height:${px.h}px`;
  wrap.appendChild(shade);

  ['nw', 'ne', 'sw', 'se'].forEach(k => {
    const hd = document.createElement('div');
    hd.className = 'sv3-crop-h ' + k;
    hd.dataset.k = k;
    const x = k[1] === 'w' ? px.left : px.left + px.w;
    const y = k[0] === 'n' ? px.top  : px.top + px.h;
    hd.style.cssText = `left:${x}px; top:${y}px`;
    wrap.appendChild(hd);
  });

  const acts = document.createElement('div');
  acts.className = 'sv3-crop-acts';
  const above = px.top - 30;
  acts.style.cssText = `left:${px.left + px.w / 2}px; top:${above >= 2 ? above : px.top + px.h + 6}px`;
  const ok = document.createElement('button');
  ok.type = 'button'; ok.className = 'sv3-crop-ok'; ok.textContent = '✓';
  ok.title = 'Crop to this region — adds a new frame to the strip';
  const no = document.createElement('button');
  no.type = 'button'; no.className = 'sv3-crop-no'; no.textContent = '✕';
  no.title = 'Discard the selection';
  const size = document.createElement('span');
  size.className = 'sv3-crop-size';
  // measured on the FULL frame, which the preview is only a 1K derivative of
  const ss = _crop.srcSize;
  size.textContent = ss ? `${Math.round(r.w * ss.w)}×${Math.round(r.h * ss.h)}` : '…';
  acts.append(ok, size, no);
  wrap.appendChild(acts);

  ok.addEventListener('mousedown', e => e.stopPropagation());
  no.addEventListener('mousedown', e => e.stopPropagation());
  ok.addEventListener('click', (e) => { e.stopPropagation(); _cropApply(); });
  no.addEventListener('click', (e) => { e.stopPropagation(); _cropClear(); });

  box.appendChild(wrap);
}

// Keep the rect inside the image and no smaller than the floor, at a fixed ratio.
function _cropFit(rect, g) {
  const ratio = _cropRatio();                       // width / height, in pixels
  let w = Math.max(CROP_MIN, Math.min(1, rect.w));
  // the ratio is in pixels, so convert through the image's own aspect
  const imgAspect = g.w / g.h;
  let h = (w * imgAspect) / ratio;
  if (h > 1) { h = 1; w = (h * ratio) / imgAspect; }
  if (h < CROP_MIN) { h = CROP_MIN; w = (h * ratio) / imgAspect; }
  const x = Math.max(0, Math.min(rect.x, 1 - w));
  const y = Math.max(0, Math.min(rect.y, 1 - h));
  return { x, y, w, h };
}

function _cropInit() {
  const box = _q('#sv3-mx-prev');
  if (!box) return;

  const usable = () => !!(_activeVariant() && !_job && box.querySelector('img'));

  box.addEventListener('mouseenter', () => {
    if (!usable()) return;
    box.classList.add('cropping');
    // the hint explains the crosshair, but only while nothing has been drawn yet
    if (_crop) return;
    clearTimeout(_cropHintT);
    _cropHintT = setTimeout(() => { if (!_crop && usable()) _cropHint(true); }, CROP_HINT_MS);
  });
  box.addEventListener('mouseleave', () => {
    clearTimeout(_cropHintT);
    _cropHint(false);
    if (!_crop) box.classList.remove('cropping');
  });

  box.addEventListener('mousedown', (e) => {
    if (!usable() || e.button !== 0) return;
    const g = _cropImgBox();
    if (!g) return;
    clearTimeout(_cropHintT);
    _cropHint(false);

    const fx = (e.clientX - g.left) / g.w, fy = (e.clientY - g.top) / g.h;
    const handle = e.target.classList && e.target.classList.contains('sv3-crop-h') ? e.target.dataset.k : '';
    const inside = _crop && fx >= _crop.rect.x && fx <= _crop.rect.x + _crop.rect.w
                         && fy >= _crop.rect.y && fy <= _crop.rect.y + _crop.rect.h;

    if (handle)      _crop.drag = { mode: 'resize', k: handle, start: { ..._crop.rect } };
    else if (inside) _crop.drag = { mode: 'move', fx, fy, start: { ..._crop.rect } };
    else {
      // a fresh selection grows from where the mouse went down
      _crop = { rect: _cropFit({ x: fx, y: fy, w: CROP_MIN, h: CROP_MIN }, g),
                drag: { mode: 'new', fx, fy }, srcSize: _cropSrc };
      if (!_cropSrc) _cropMeasure(_activeVariant().path);
    }
    e.preventDefault();

    const onMove = (ev) => {
      const gg = _cropImgBox();
      if (!gg || !_crop) return;
      const cx = (ev.clientX - gg.left) / gg.w, cy = (ev.clientY - gg.top) / gg.h;
      const d = _crop.drag;
      if (d.mode === 'new') {
        const w = Math.abs(cx - d.fx);
        _crop.rect = _cropFit({ x: Math.min(d.fx, cx), y: Math.min(d.fy, cy), w, h: 0 }, gg);
      } else if (d.mode === 'move') {
        _crop.rect = _cropFit({ ...d.start, x: d.start.x + (cx - d.fx), y: d.start.y + (cy - d.fy) }, gg);
      } else {
        // resize from a corner: the opposite corner stays put
        const ax = d.k[1] === 'w' ? d.start.x + d.start.w : d.start.x;
        const w = Math.abs(cx - ax);
        const fitted = _cropFit({ x: Math.min(ax, cx), y: 0, w, h: 0 }, gg);
        const ay = d.k[0] === 'n' ? d.start.y + d.start.h : d.start.y;
        fitted.y = d.k[0] === 'n' ? Math.max(0, ay - fitted.h) : Math.min(1 - fitted.h, ay);
        _crop.rect = fitted;
      }
      _cropRender();
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (_crop) { _crop.drag = null; _cropRender(); }
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    _cropRender();
  });
}

async function _cropApply() {
  const av = _activeVariant();
  if (!av || !_crop) return;
  const rect = { ..._crop.rect };
  const projectId = _proj.id;
  _cropClear();
  _status('Cropping…');
  try {
    const r = await cropFrame(av.path, rect);
    const variant = {
      id: 'f' + Date.now(), path: r.path, preview: r.preview || '',
      prompt: av.prompt || '', at: new Date().toISOString(), taskId: '',
      croppedFrom: av.id, crop: rect, size: { w: r.width, h: r.height },
    };
    if (_ov && _mix && _proj && String(_proj.id) === String(projectId)) {
      _mix.variants.unshift(variant);
      _mix.activeId = variant.id;      // the crop becomes what you are looking at
      await _flushSave();
      _renderAll();
      _status(`Cropped to ${r.width}×${r.height} — added to the strip.`);
    }
  } catch (e) {
    _status('Crop failed: ' + e.message);
  }
}

// ── pose picker ─────────────────────────────────────────────────────────────
// A list drawn over the hidden <select>: each row carries the mannequin as a small
// thumbnail, and hovering a row opens the same big preview the attached references
// use. A native <option> can do neither, which is why this exists at all.
const _poseById = (id) => _poses.find(p => p.id === id) || null;

function _closePoseList() {
  const list = _q('#sv3-mx-poselist');
  if (list) list.classList.remove('open');
  _closePeek();
}

function _renderPosePicker() {
  const sel  = _q('#sv3-mx-pose');
  const btn  = _q('#sv3-mx-posebtn');
  const list = _q('#sv3-mx-poselist');
  if (!sel || !btn || !list) return;

  const opts = [...sel.options].filter(o => !o.disabled);
  const cur  = _poseById(sel.value);

  // the trigger shows what is chosen right now, thumbnail and all
  btn.textContent = '';
  btn.disabled = sel.disabled || !opts.length;
  if (cur && cur.file) {
    const t = document.createElement('span');
    t.className = 'sv3-mx-posebtnthumb';
    t.appendChild(thumbImg(cur.file, null, { noFit: true }));
    btn.appendChild(t);
  }
  const cap = document.createElement('span');
  cap.className = 'sv3-mx-posebtncap';
  cap.textContent = opts.length
    ? (cur ? cur.label : (sel.options[0] || {}).textContent || '')
    : 'no pose in this group';
  btn.appendChild(cap);
  const arrow = document.createElement('span');
  arrow.className = 'sv3-mx-posebtnarrow';
  arrow.textContent = '▾';
  btn.appendChild(arrow);

  list.textContent = '';
  opts.forEach(o => {
    const pose = _poseById(o.value);
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'sv3-mx-poserow' + (o.value === sel.value ? ' on' : '');
    row.title = (pose && pose.desc) || '';

    const cell = document.createElement('span');
    cell.className = 'sv3-mx-poserowthumb';
    if (pose && pose.file) cell.appendChild(thumbImg(pose.file, null, { noFit: true }));
    else { const e = document.createElement('span'); e.className = 'sv3-mx-posenone'; e.textContent = '—'; cell.appendChild(e); }

    const name = document.createElement('span');
    name.className = 'sv3-mx-poserowcap';
    name.textContent = o.textContent;

    row.append(cell, name);
    // hovering shows the mannequin large, so the choice is made on the picture
    if (pose && pose.file) {
      row.addEventListener('mouseenter', () => _openPeek(row, pose.file, pose.label, list));
      row.addEventListener('mouseleave', _closePeek);
    }
    row.addEventListener('click', () => {
      _closePoseList();
      if (sel.value === o.value) return;
      sel.value = o.value;
      sel.dispatchEvent(new Event('change'));
    });
    list.appendChild(row);
  });
}

function _initPosePicker() {
  const btn  = _q('#sv3-mx-posebtn');
  const list = _q('#sv3-mx-poselist');
  if (!btn || !list) return;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const sel = _q('#sv3-mx-pose');
    if (sel && sel.disabled) return;
    list.classList.toggle('open');
    if (!list.classList.contains('open')) _closePeek();
  });
  // clicking anywhere else, or Escape, puts it away
  document.addEventListener('click', (e) => {
    if (!list.classList.contains('open')) return;
    if (list.contains(e.target) || e.target === btn) return;
    _closePoseList();
  });
  list.addEventListener('mouseleave', _closePeek);
}

// Leave edit mode and go back to composing from the sources. Used by the frame
// parameters, which have no effect on an edit.
function _toCompose() {
  if (!_mix || !_mix.activeId) return;
  _mix.activeId = '';
}

function _jobTick(label) {
  if (!_job) return;
  _job.label = label;
  if (_job.pr) _job.pr.tick(label);
}
function _jobStep() {
  if (!_job) return;
  _job.done = Math.min(_job.total, _job.done + 1);
  if (_job.pr) _job.pr.step();
}
function _onKey(e) { if (e.key === 'Escape') _close(); }

// ── derived views over the workspace ────────────────────────────────────────
const _visible = () => _mix.variants.filter(v => !_mix.banned.includes(v.id));
const _bannedList = () => _mix.variants.filter(v => _mix.banned.includes(v.id));
const _approvedList = () => _mix.approved
  .map(id => _mix.variants.find(v => v.id === id))
  .filter(Boolean);
const _activeVariant = () => (_mix.activeId ? _mix.variants.find(v => v.id === _mix.activeId) : null);

// ── header settings ─────────────────────────────────────────────────────────
function _modelDef(id) { return MODELS.find(m => m.id === id) || MODELS[0]; }
function _aggDef(id) { return AGGREGATORS.find(a => a.id === id) || AGGREGATORS[0]; }

// The model list narrows to what the chosen aggregator actually hosts, so the two
// dropdowns can never describe a combination that does not exist.
const _effModel = () => {
  const hosted = _aggDef(_mix.settings.aggregator).models;
  return hosted.includes(_mix.settings.model) ? _mix.settings.model : hosted[0];
};

// What the chosen model will ACTUALLY return. settings.quality holds the user's
// preference untouched, so stepping through lite and back keeps their 2K/4K pick.
function _effQuality() {
  const allowed = _modelDef(_effModel()).quality;
  return allowed.includes(_mix.settings.quality) ? _mix.settings.quality : allowed[0];
}

function _renderSettings() {
  const s = _mix.settings;
  const hosted = _aggDef(s.aggregator).models;
  const model = _effModel();
  const allowed = _modelDef(model).quality;
  const eff = _effQuality();

  const asel = _q('#sv3-mx-agg');
  if (asel) asel.value = s.aggregator;

  // only the models this aggregator hosts are offered
  const msel = _q('#sv3-mx-model');
  if (msel) {
    msel.textContent = '';
    hosted.forEach(id => {
      const o = document.createElement('option');
      o.value = id; o.textContent = _modelDef(id).label;
      msel.appendChild(o);
    });
    msel.value = model;
    msel.disabled = hosted.length < 2;
    msel.title = hosted.length < 2 ? `${_aggDef(s.aggregator).label} hosts only ${hosted[0]}` : '';
  }

  const qsel = _q('#sv3-mx-quality');
  if (qsel) {
    qsel.textContent = '';
    allowed.forEach(v => {
      const o = document.createElement('option');
      o.value = v; o.textContent = v;
      qsel.appendChild(o);
    });
    qsel.value = eff;
    qsel.disabled = allowed.length < 2;
    qsel.title = allowed.length < 2
      ? `${model} only renders ${allowed[0]}`
      : '';
  }

  // the summary always states what will really come back
  const sum = _q('#sv3-mx-sum');
  if (sum) {
    sum.textContent = `${_aggDef(s.aggregator).label} · ${model} · ${s.format} · ${eff}`;
    sum.title = eff !== s.quality
      ? `You picked ${s.quality}; ${model} renders ${eff}. Your choice is kept for models that support it.`
      : '';
  }
}

// ── left: sources + the working strip ───────────────────────────────────────
function _renderSources() {
  const box = _q('#sv3-mx-src');
  if (!box) return;
  box.textContent = '';
  const cast = (_proj && _proj.casting) || {};
  const sourcesActive = !_mix.activeId;

  [['character', cast.obrazImage], ['location', cast.locationImage]].forEach(([tag, img]) => {
    const cell = document.createElement('div');
    cell.className = 'sv3-mx-srccell' + (sourcesActive ? ' on' : '');
    const t = document.createElement('div');
    t.className = 'sv3-slot-tag';
    t.textContent = tag;
    cell.appendChild(t);
    if (img) cell.appendChild(thumbImg(img, null, { noFit: true }));
    else {
      const ph = document.createElement('div');
      ph.className = 'sv3-slot-ph';
      ph.textContent = '–';
      cell.appendChild(ph);
    }
    cell.title = tag === 'character'
      ? (img ? 'character — click to change who is in the frame' : 'no character cast yet — click to choose')
      : (img ? 'location — click to change where the frame is set' : 'no location chosen yet — click to choose');
    cell.addEventListener('click', () => {
      // Going back to composing from the sources, as it always did - and opening the column
      // that changes THIS source. The two belong together: clicking a tile is how you say
      // "this is the part I want to change", so it has to answer with the choice.
      _mix.activeId = '';
      _queueSave();
      _renderAll();
      _togglePick(tag);
    });
    box.appendChild(cell);
  });
}

// Who, then where - or where, then who. A pick moves the column on to the OTHER question
// while that one is still unanswered: one after the next, without going back out to the page
// between them, which is the point of annexing the column at all. Once both are set the
// guided path is over and the column folds instead, so from then on each tile changes the
// one thing it was clicked for and nothing else is imposed.
function _afterPick(just) {
  const cast = (_proj && _proj.casting) || {};
  const other = just === 'character' ? 'location' : 'character';
  const answered = other === 'character' ? cast.obrazImage : cast.locationImage;
  if (answered) { if (_pick) _pick.closePick(); return; }
  _togglePick(other);
}

// ── The annexed column ──────────────────────────────────────────────────────
// Opened from a source tile, attached to the left of the popup's columns. Picking writes the
// casting onto the project and closes it; the frame behind stays where it was, which is the
// whole reason this is here rather than in a column of its own.
async function _togglePick(tag) {
  // The same tile twice folds the column away; the OTHER tile swaps the question rather than
  // closing, so moving between who and where is one click either way. Answered before the
  // await, so a second click on an open column closes it instantly.
  if (_pick && _pick.pickOpen() && _pick.pickMode() === tag) return _pick.closePick();
  const host = _q('.sv3-pop-cols');
  if (!host) return;
  const M = await _needPick();
  // The popup can be closed while the module is still in flight.
  if (!_proj || !document.body.contains(host)) return;
  const cast = (_proj && _proj.casting) || {};

  if (tag === 'location') {
    M.openEnvPick(host, {
      current: cast.locationImage || '',
      onPick: async (path) => {
        // locationId is cleared for the same reason the page's own flyout used to clear it:
        // this is a bare path out of the gallery, with no saved record standing behind it.
        await _commitCasting({ locationId: '', locationImage: path });
        _afterPick('location');
      },
      onPlus: async () => {
        M.closePick();
        // Same bargain as dressing somebody: make a place and land back here with it set.
        const { openEnvPopup } = await _needEnv();
        openEnvPopup({
          project: _proj,
          // Build mix stays open underneath, so Save really does come back here. The button
          // says so rather than leaving it to be discovered.
          backTo: 'the mix',
          onCommit: async (casting) => { await _commitCasting(casting); },
        });
      },
    });
    return;
  }

  M.openCharPick(host, {
    gender: (_proj && _proj.gender) || '',
    current: cast.obrazImage || '',
    onPick: async (casting) => {
      await _commitCasting(casting);
      _afterPick('character');
    },
    onPlus: async () => {
      M.closePick();
      // Dressing somebody new and landing back here with them cast is one gesture as far as
      // the user is concerned, so the popup returns rather than dropping them at the page.
      const { openDressPopup } = await _needDress();
      openDressPopup({
        project: _proj,
        backTo: 'the mix',
        onCommit: async (casting) => { await _commitCasting(casting); },
      });
    },
  });
}

async function _commitCasting(casting) {
  if (!casting || !_proj) return;
  _proj.casting = { ...(_proj.casting || {}), ...casting };
  _renderAll();
  try { await patchProject({ casting: _proj.casting }); }
  catch (e) { console.warn('[mix] casting not saved:', e.message); }
}

// The mannequin of the chosen pose, or '' — the same rule the server applies:
// the pose must belong to the selected framing group and have an image.
function _poseImage() {
  const p = _poses.find(x => x.id === _mix.poseId);
  if (!p || !p.file) return '';
  return (!_mix.framing || p.group === _mix.framing) ? p.file : '';
}

// What the next generation will actually be handed — every reference that goes
// into the call, in the order the prompt names them.
function _renderWorkingWith() {
  const box = _q('#sv3-mx-working');
  if (!box) return;
  box.textContent = '';
  const cast = (_proj && _proj.casting) || {};
  const av = _activeVariant();
  // the mannequin leads: it is the base the character is built onto
  const imgs = av
    ? [['frame', av.path]]
    : [['pose', _poseImage()], ['character', cast.obrazImage], ['location', cast.locationImage]]
        .filter(([, p]) => p);
  if (!imgs.length) return;
  const cap = document.createElement('span');
  cap.className = 'sv3-mx-workcap';
  cap.textContent = av ? 'editing' : 'composing from';
  box.appendChild(cap);
  imgs.forEach(([tag, p]) => {
    const w = document.createElement('span');
    // The character and location tiles crop to what matters (the face, the room).
    // A POSE has to be seen whole — cropping a mannequin to a band of torso in a
    // 24x32 tile shows nothing at all — so it letterboxes instead.
    w.className = 'sv3-mx-workthumb' + (tag === 'pose' ? ' whole' : '');
    w.appendChild(thumbImg(p, null, { noFit: true }));
    // Hover only — a look at what is attached must never change what is selected.
    w.addEventListener('mouseenter', () => _openPeek(w, p, tag));
    w.addEventListener('mouseleave', _closePeek);
    box.appendChild(w);
  });
}

// ── hover preview for the attached references ───────────────────────────────
// Reads the ~1K derivative rather than the full asset, so the popup appears at
// once on a 4K sheet. Pure hover: no clicks, no selection side effects.
let _peek = null;
let _peekFor = '';

function _closePeek() {
  if (_peek) { _peek.remove(); _peek = null; }
  _peekFor = '';
}

// `beside` puts the preview to the RIGHT of that element instead of above the anchor.
// The pose list needs it: sitting above a row, the preview covered the very options
// the user was reading. Vertical placement still follows the hovered row.
async function _openPeek(anchor, fullPath, tag, beside) {
  if (_peekFor === fullPath && _peek) return;
  _closePeek();
  _peekFor = fullPath;

  const el = document.createElement('div');
  el.className = 'sv3-mx-peek';
  const cap = document.createElement('div');
  cap.className = 'sv3-mx-peekcap';
  cap.textContent = tag;
  const img = document.createElement('img');
  img.alt = tag;
  img.src = thumb(fullPath);          // the small one shows instantly…
  el.append(img, cap);
  document.body.appendChild(el);
  _peek = el;

  const place = () => {
    if (_peek !== el) return;
    const a = anchor.getBoundingClientRect();
    const w = el.offsetWidth, h = el.offsetHeight;
    const clampTop = (t) => Math.round(Math.min(Math.max(8, t), Math.max(8, window.innerHeight - h - 8)));

    if (beside) {
      // to the side of the whole list, centred on the hovered row; flips to the left
      // when there is no room on the right
      const b = beside.getBoundingClientRect();
      let left = b.right + 10;
      if (left + w > window.innerWidth - 8) left = b.left - w - 10;
      el.style.left = Math.round(Math.max(8, left)) + 'px';
      el.style.top  = clampTop(a.top + a.height / 2 - h / 2) + 'px';
      return;
    }
    const left = Math.min(Math.max(8, a.left + a.width / 2 - w / 2), Math.max(8, window.innerWidth - w - 8));
    const above = a.top - h - 10;
    el.style.left = Math.round(left) + 'px';
    el.style.top  = Math.round(above >= 8 ? above : Math.min(a.bottom + 10, window.innerHeight - h - 8)) + 'px';
  };
  place();

  // …then the 1K derivative replaces it, unless the cursor has already left
  try {
    const big = await preview1k(fullPath);
    if (_peek !== el || _peekFor !== fullPath) return;
    img.addEventListener('load', place, { once: true });
    img.src = big;
  } catch (e) { /* the thumbnail is preview enough */ }
}

function _syncGenerate() {
  const btn = _q('#sv3-mx-gen');
  const wrap = _q('#sv3-mx-gen-wrap');
  if (!btn) return;
  const cast = (_proj && _proj.casting) || {};
  const note = ((_q('#sv3-mx-note') || {}).value || '').trim();
  const av = _activeVariant();

  let label = 'Compose';
  let reason = '';
  if (_job) {
    // one paid job at a time, and say plainly which one is holding the button
    reason = _jobIsHere()
      ? 'A frame is being generated for this project…'
      : 'A frame is being generated in another project…';
  } else if (av) {
    label = 'Apply the edit';
    if (!note) reason = 'Describe what to change on this frame';
  } else if (!cast.obrazImage)  reason = 'Pick a character first';
  else if (!cast.locationImage) reason = 'Pick a location first';
  if (av) label = 'Apply the edit';

  btn.textContent = label;
  btn.disabled = !!reason;
  if (wrap) {
    wrap.title = reason
      || (av ? 'Apply the edit — this spends credits'
             : (note ? 'Compose with your direction — this spends credits'
                     : 'Compose the frame — this spends credits'));
  }
}

// Three ways in, one button:
//   A  both sources, no note  -> read the light, composite
//   B  both sources + note    -> read the light AND clean up the note, composite
//   C  a frame is active      -> read that frame against the note, edit it
// Every path is two steps, so the progress can say which one it is on.
async function _onGenerate() {
  if (_job) return;
  const cast = (_proj && _proj.casting) || {};
  const av   = _activeVariant();
  const note = ((_q('#sv3-mx-note') || {}).value || '').trim();
  if (av ? !note : (!cast.obrazImage || !cast.locationImage)) return;

  // Everything the two requests need is SNAPSHOTTED here. Closing the popup nulls
  // _proj and _mix, and reading them after an await would throw halfway through a
  // paid job — which is exactly how a finished frame used to get lost.
  const mode = av ? 'edit' : 'compose';
  const snap = {
    projectId: _proj.id,
    note,
    basePath:      av ? av.path : '',
    characterPath: cast.obrazImage || '',
    locationPath:  cast.locationImage || '',
    camera:  _mix.camera,
    framing: _mix.framing,
    poseId:  _mix.poseId,
    aggregator: _mix.settings.aggregator,
    engine:  _effModel(),
    format:  _mix.settings.format,
    quality: _effQuality(),
  };

  _job = {
    projectId: snap.projectId, mode,
    label: 'Reading 1/2', total: 2, done: 0, startedAt: Date.now(),
    pr: null, thaw: null, unlock: null,
  };
  _lastFail = null;
  _attachJob();
  _syncGenerate();

  try {
    // The reading pass sees the mannequin too, so it needs the pose and its group.
    const read = await analyzeFrame(mode === 'edit'
      ? { basePath: snap.basePath, note: snap.note }
      : { characterPath: snap.characterPath, locationPath: snap.locationPath, note: snap.note,
          poseId: snap.poseId, framing: snap.framing });
    _jobStep();
    _jobTick('Generating 2/2');

    // projectId arms the SERVER's watcher: it files the frame even if this page is
    // reloaded or closed before the generator answers.
    const r = await genFrame(mode === 'edit'
      ? {
          projectId: snap.projectId,
          basePath: snap.basePath, note: snap.note, intent: read.intent || '',
          aggregator: snap.aggregator,
          engine: snap.engine, format: snap.format, quality: snap.quality,
        }
      : {
          projectId: snap.projectId,
          characterPath: snap.characterPath,
          locationPath:  snap.locationPath,
          // one labelled block per reference, straight from the reading pass
          pose:        read.pose        || '',
          character:   read.character   || '',
          environment: read.environment || '',
          lighting:    read.lighting    || '',
          intent:  read.intent || '',
          note:    snap.note,
          camera:  snap.camera,
          framing: snap.framing,
          poseId:  snap.poseId,   // the server checks it belongs to the chosen group
          aggregator: snap.aggregator,
          engine:  snap.engine,
          format:  snap.format,
          quality: snap.quality,
        });
    const s = await awaitTask(r.taskId);
    const f = await finalize(s.imagePath, '');   // frames stay in uploads/, only the 1K is built
    _jobStep();

    await _commitVariant(snap.projectId, mode, {
      id: 'f' + Date.now(), path: f.path, preview: f.preview || '',
      prompt: r.prompt || '', at: new Date().toISOString(), taskId: r.taskId,
    });
    if (_job && _job.pr) _job.pr.finish();
  } catch (e) {
    const msg = e.message || 'generation failed';
    if (_job && _job.pr) _job.pr.fail(msg);
    // nobody was watching — hold it and say so when the popup opens again
    else _lastFail = { projectId: snap.projectId, message: msg };
  } finally {
    if (_job) { if (_job.thaw) _job.thaw(); if (_job.unlock) _job.unlock(); }
    _job = null;
    _syncGenerate();
  }
}

// File the finished frame. When its popup is still open on the same project the
// working copy is updated and repainted; otherwise the record is patched directly,
// so a frame is never lost just because the window was closed.
async function _commitVariant(projectId, mode, variant) {
  const here = _ov && _mix && _proj && String(_proj.id) === String(projectId);
  const seen = (list) => !!(variant.taskId && (list || []).some(v => v.taskId === variant.taskId));

  if (here) {
    // the server watches the same task; if it filed the frame first, leave it be
    if (!seen(_mix.variants)) {
      _mix.variants.unshift(variant);
      _mix.activeId = variant.id;       // the fresh frame becomes the active one
    }
    // The note has been consumed — leaving it would silently fold into the next
    // run, or turn a forgotten line into an unintended edit.
    _mix.note = '';
    _mix.pending = null;
    const ta = _q('#sv3-mx-note'); if (ta) ta.value = '';
    await _flushSave();
    _renderAll();
    _status(mode === 'edit' ? 'Edit applied — the result is the active frame.' : 'Frame composed.');
    return;
  }
  const full = await getProject(projectId);
  const mix = full && full.mix;
  if (!mix) throw new Error('the project no longer has a mix workspace to file the frame in');
  if (!seen(mix.variants)) {
    mix.variants = [variant, ...(mix.variants || [])];
    mix.activeId = variant.id;
  }
  mix.note = '';
  mix.pending = null;
  await saveProject({ id: projectId, mix });
  // the page's in-memory copy is now behind; make the next open refetch
  _staleProject = String(projectId);
}

function _status(t) { const n = _q('#sv3-mx-st'); if (n) n.textContent = t || ''; }

// ── centre: the active image and the strip of frames ────────────────────────
let _prevToken = 0;
async function _renderPreview() {
  const box = _q('#sv3-mx-prev');
  if (!box) return;
  // Clear the preview but LEAVE a running progress overlay alone — this repaints
  // while a job is in flight, and wiping the whole box would take the spinner with it.
  [...box.children].forEach(n => { if (!n.classList.contains('sv3-gen-ov')) n.remove(); });
  const av = _activeVariant();
  const cast = (_proj && _proj.casting) || {};

  if (!av) {
    const e = document.createElement('div');
    e.className = 'sv3-empty';
    e.textContent = (cast.obrazImage && cast.locationImage)
      ? 'Compose a frame to see it here.'
      : 'Pick a character and a location first.';
    box.appendChild(e);
    return;
  }
  const token = ++_prevToken;
  const img = document.createElement('img');
  img.alt = '';
  img.src = thumb(av.path);
  img.className = 'warming';
  box.appendChild(img);
  const p = await preview1k(av.path);
  if (token !== _prevToken || !_ov || !img.isConnected) return;
  img.src = p;
  img.classList.remove('warming');
}

function _renderStrip() {
  const box = _q('#sv3-mx-strip');
  if (!box) return;
  box.textContent = '';
  const list = _visible();
  if (!list.length) {
    const e = document.createElement('div');
    e.className = 'sv3-mx-stripempty';
    e.textContent = 'Generated frames appear here.';
    box.appendChild(e);
  }
  list.forEach(v => {
    const approved = _mix.approved.includes(v.id);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sv3-mx-frame' + (_mix.activeId === v.id ? ' on' : '') + (approved ? ' approved' : '');
    b.title = v.prompt ? v.prompt.slice(0, 120) : 'frame';
    b.appendChild(thumbImg(v.path, null, { noFit: true }));
    b.addEventListener('click', () => { _mix.activeId = v.id; _queueSave(); _renderAll(); });

    // ✓ top-left: send a copy to the approved column. The frame stays on the strip.
    const ok = document.createElement('span');
    ok.className = 'sv3-mx-fok' + (approved ? ' done' : '');
    ok.textContent = '✓';
    ok.title = approved ? 'Already approved — remove it from the right column'
                        : 'Approve this frame';
    ok.addEventListener('click', (e) => {
      e.stopPropagation();
      if (approved) return;
      _mix.approved.push(v.id);
      _queueSave(); _renderAll();
    });

    // ✕ top-right: hide rather than delete — it folds away under the dropdown and
    // can be brought back. A hidden frame also drops out of the approved pool.
    const ban = document.createElement('span');
    ban.className = 'sv3-mx-fban';
    ban.textContent = '×';
    ban.title = 'Hide this frame — it can be restored from the hidden list';
    ban.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!_mix.banned.includes(v.id)) _mix.banned.push(v.id);
      _mix.approved = _mix.approved.filter(id => id !== v.id);
      if (_mix.activeId === v.id) {
        const next = _visible().find(x => x.id !== v.id);
        _mix.activeId = next ? next.id : '';   // fall back to another frame, else the sources
      }
      _queueSave(); _renderAll();
    });

    b.append(ok, ban);
    box.appendChild(b);
  });
  _renderBanned();
}

// Banned frames fold away to the right; the dropdown opens upward.
function _renderBanned() {
  const host = _q('#sv3-mx-banned');
  if (!host) return;
  const list = _bannedList();
  host.style.display = list.length ? '' : 'none';
  const btn = _q('#sv3-mx-banned-btn');
  if (btn) btn.textContent = `hidden ${list.length}`;
  const pop = _q('#sv3-mx-banned-pop');
  if (!pop) return;
  pop.textContent = '';
  list.forEach(v => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sv3-mx-frame banned';
    b.title = 'Restore this frame';
    b.appendChild(thumbImg(v.path, null, { noFit: true }));
    b.addEventListener('click', () => {
      _mix.banned = _mix.banned.filter(id => id !== v.id);
      _queueSave(); _renderAll();
    });
    pop.appendChild(b);
  });
}

// ── right: approved frames, distribution, Save ──────────────────────────────
function _renderApproved() {
  const box = _q('#sv3-mx-appr');
  if (!box) return;
  box.textContent = '';
  const list = _approvedList();
  if (!list.length) {
    const e = document.createElement('div');
    e.className = 'sv3-empty';
    e.textContent = 'Approve frames with the ✓ on the strip.';
    box.appendChild(e);
    return;
  }
  list.forEach(v => {
    const cell = document.createElement('div');
    cell.className = 'sv3-mx-appritem';
    cell.appendChild(thumbImg(v.path, null, { noFit: true }));
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'sv3-mx-apprx';
    x.textContent = '×';
    x.title = 'Remove approval — the frame stays on the strip';
    x.addEventListener('click', (e) => {
      e.stopPropagation();
      _mix.approved = _mix.approved.filter(id => id !== v.id);
      _queueSave(); _renderAll();
    });
    cell.appendChild(x);
    cell.addEventListener('click', () => { _mix.activeId = v.id; _queueSave(); _renderAll(); });
    box.appendChild(cell);
  });
}

// One frame can only mean "every fragment the same"; several frames can mean
// anything except that.
function _renderDistribution() {
  const sel = _q('#sv3-mx-dist');
  if (!sel) return;
  const n = _approvedList().length;
  sel.textContent = '';
  MODES.forEach(m => {
    const o = document.createElement('option');
    o.value = m.id;
    o.textContent = m.label;
    if (n === 0) { o.disabled = true; o.title = 'Approve a frame first'; }
    else if (n === 1) {
      o.disabled = m.id !== 'same';
      if (o.disabled) o.title = 'Only one frame is approved';
    } else {
      o.disabled = m.id === 'same';
      if (o.disabled) o.title = 'Several frames are approved — pick how to spread them';
    }
    sel.appendChild(o);
  });
  const allowed = [...sel.options].filter(o => !o.disabled).map(o => o.value);
  if (!allowed.includes(_mix.distribution)) _mix.distribution = allowed[0] || 'same';
  sel.value = _mix.distribution;
  // Opened to add frames: the distribution is not consulted, so it is greyed out rather
  // than left looking like a choice Save will honour.
  sel.disabled = n === 0 || _keepAssign;

  const save = _q('#sv3-mx-save');
  const swrap = _q('#sv3-mx-save-wrap');
  const lines = ((_proj && _proj.lines) || []).length;
  const reason = !n ? 'Approve at least one frame first'
    : (!lines ? 'This project has no fragments yet' : '');
  if (save) {
    save.disabled = !!reason || !!_job;
    save.textContent = _keepAssign ? 'Save frames' : 'Save';
  }
  if (swrap) {
    swrap.title = reason || (_keepAssign
      ? 'Add these frames to the project. Every fragment keeps the frame it has now, so'
        + ' nothing already rendered is thrown away.'
      : _mix.distribution === 'manual'
      ? `Close and assign frames yourself on the ${lines} fragment cards`
      : `Spread the approved frames over ${lines} fragment${lines === 1 ? '' : 's'}`);
  }
}

// Work out which frame each fragment gets. `manual` deliberately changes nothing —
// the user picks per card instead.
function _assign(mode, poolIds, count) {
  if (mode === 'manual') return null;
  const out = [];
  for (let i = 0; i < count; i++) {
    if (mode === 'cycle')       out.push(poolIds[i % poolIds.length]);
    else if (mode === 'random') out.push(poolIds[Math.floor(Math.random() * poolIds.length)]);
    else                        out.push(poolIds[0]);   // 'same' — the first approved frame
  }
  return out;
}

async function _onSave() {
  const btn = _q('#sv3-mx-save');
  if (!btn || btn.disabled || !_proj) return;
  const pool = _mix.approved.filter(id => _mix.variants.some(v => v.id === id) && !_mix.banned.includes(id));
  const lines = (_proj.lines || []).map(l => ({ ...l }));
  if (!pool.length || !lines.length) return;

  btn.disabled = true;
  try {
    // null means "leave every fragment as it is" — either the distribution is manual or
    // this popup was opened only to add frames.
    const picks = _keepAssign ? null : _assign(_mix.distribution, pool, lines.length);
    if (picks) lines.forEach((l, i) => { l.frameId = picks[i] || ''; });
    await _flushSave();                                  // the workspace first
    await patchProject({ lines });                        // then the assignments
    if (_onSaved) _onSaved();
    _close();
  } catch (e) {
    btn.disabled = false;
    _status('Could not save: ' + e.message);
  }
}

// ── frame parameters: camera optics, framing, mannequin pose ────────────────
function _fillSelect(sel, items, current, emptyLabel) {
  if (!sel) return;
  // Never trust the shape: a missing list used to throw here and take the whole
  // popup render down with it, leaving every dropdown blank.
  const list = Array.isArray(items) ? items : [];
  sel.textContent = '';
  if (emptyLabel) {
    const o = document.createElement('option');
    o.value = ''; o.textContent = emptyLabel;
    sel.appendChild(o);
  }
  list.forEach(it => {
    const o = document.createElement('option');
    o.value = it.id; o.textContent = it.label;
    if (it.prompt) o.title = it.prompt;
    sel.appendChild(o);
  });
  const want = String(current || '');
  sel.value = [...sel.options].some(o => o.value === want) ? want : (sel.options[0] || {}).value || '';
}

// Framing is a group; the pose list only ever shows mannequins from the group
// currently selected, so a crop can never contradict a pose.
function _renderParams() {
  _fillSelect(_q('#sv3-mx-camera'),  _fopts.cameras,  _mix.camera,  '');
  _fillSelect(_q('#sv3-mx-framing'), _fopts.framings, _mix.framing, '');
  if (_fopts.cameras.length)  _mix.camera  = (_q('#sv3-mx-camera')  || {}).value || '';
  if (_fopts.framings.length) _mix.framing = (_q('#sv3-mx-framing') || {}).value || '';

  const inGroup = _poses
    .filter(p => p.active !== false && p.group === _mix.framing)
    .map(p => ({ id: p.id, label: p.label + (p.file ? '' : ' · text only'), prompt: p.desc || '' }));
  _fillSelect(_q('#sv3-mx-pose'), inGroup, _mix.poseId, inGroup.length ? '' : 'no pose in this group');
  // Adopt the select's value only once it has real options — the presets land a
  // moment after the popup opens, and an empty list would wipe the stored choice.
  if (inGroup.length) _mix.poseId = (_q('#sv3-mx-pose') || {}).value || '';
  _renderPosePicker();

  // the chosen camera's technical digest, right under its dropdown
  const sum = _q('#sv3-mx-camsum');
  if (sum) {
    const cam = _fopts.cameras.find(c => c.id === _mix.camera);
    sum.textContent = cam ? (cam.summary || cam.prompt) : '';
    sum.title = cam ? cam.prompt : '';
  }
}

function _renderAll() {
  // a selection belongs to the frame it was drawn on; a repaint may swap that frame
  _cropClear();
  _renderSettings(); _renderSources(); _renderParams(); _renderWorkingWith(); _syncGenerate();
  _renderPreview(); _renderStrip(); _renderApproved(); _renderDistribution();
}

// ── open ────────────────────────────────────────────────────────────────────
// `keepAssignments` opens the workspace to ADD frames and nothing else: Save commits the
// pool and leaves every fragment on the frame it already has. That matters because a clip
// belongs to one first frame — redistributing from here would quietly turn rendered
// fragments back into unrendered ones, and they cost money.
// pick names the question to open on: 'character', 'location', or nothing at all. The two
// frames in Montage each open this on their own, so the popup arrives already asking about
// the thing that was clicked.
export async function openMixPopup({ project, onSaved, keepAssignments, pick }) {
  _close();
  _keepAssign = !!keepAssignments;

  // Never open on a record that has no mix: starting from a blank workspace and
  // autosaving it would wipe every frame already generated for this project.
  // A summary-shaped project (no `mix`) gets refetched in full first — and so is one
  // a detached job wrote to behind the page's back, or the copy in hand would save
  // its stale variant list straight over the frame that job just filed.
  let proj = project;
  const stale = proj && _staleProject && String(proj.id) === _staleProject;
  if (proj && proj.id && (!proj.mix || stale)) {
    try {
      const full = await getProject(proj.id);
      if (full && full.mix) { proj = full; if (stale) _staleProject = ''; }
    } catch (e) { console.error('[sv3] could not load the project mix', e); }
  }
  if (!proj || !proj.mix) {
    console.error('[sv3] refusing to open Build mix without a mix workspace');
    return;
  }

  _proj = proj;
  _onSaved = onSaved;
  _mix = Object.assign(_blank(), proj.mix);
  if (!_mix.settings) _mix.settings = _blank().settings;

  _ov = document.createElement('div');
  _ov.className = 'sv3-pop-ov';
  _ov.innerHTML = `
    <div class="sv3-pop sv3-mx">
      <div class="sv3-pop-head">
        <span class="sv3-pop-title">Build mix</span>
        <span class="sp"></span>
        <span class="sv3-mx-sum" id="sv3-mx-sum"></span>
        <span class="sv3-gearwrap">
          <button class="sv3-btn sm" id="sv3-mx-gear" type="button" title="Generation settings">&#9881;</button>
          <div class="sv3-gearpop" id="sv3-mx-gearpop">
            <label>Aggregator
              <select id="sv3-mx-agg">
                ${AGGREGATORS.map(a => `<option value="${a.id}">${a.label}</option>`).join('')}
              </select>
            </label>
            <label>Model
              <select id="sv3-mx-model"></select>
            </label>
            <label>Format
              <select id="sv3-mx-format">
                ${FORMATS.map(f => `<option value="${f}">${f}</option>`).join('')}
              </select>
            </label>
            <label>Quality
              <select id="sv3-mx-quality"></select>
            </label>
          </div>
        </span>
        <button class="sv3-btn sm" id="sv3-mx-x" type="button" title="Close — your work here is kept">&times;</button>
      </div>

      <div class="sv3-pop-cols">
        <div class="sv3-pop-col sv3-mx-colsrc">
          <div class="sv3-pop-sub2">
            Sources
            <span id="sv3-mx-pgear-wrap" title="Preset and mannequin editor - in development">
              <button class="sv3-btn sm" id="sv3-mx-pgear" type="button" disabled>&#9881;</button>
            </span>
            <span class="sp"></span>
          </div>
          <div class="sv3-mx-src" id="sv3-mx-src"></div>
          <div class="sv3-mx-foot">
            <label class="sv3-mx-parm">Camera<span class="sv3-mx-help" title="${HELP.camera}">?</span>
              <select id="sv3-mx-camera"></select>
            </label>
            <div class="sv3-mx-camsum" id="sv3-mx-camsum"></div>
            <label class="sv3-mx-parm">Framing<span class="sv3-mx-help" title="${HELP.framing}">?</span>
              <select id="sv3-mx-framing"></select>
            </label>
            <label class="sv3-mx-parm">Pose<span class="sv3-mx-help" title="${HELP.pose}">?</span>
              <!-- The native select stays as the value holder so everything that reads
                   .value, sets .disabled or listens for change keeps working; the list
                   the user actually sees is drawn on top of it, because an <option>
                   cannot carry a thumbnail and cannot be hovered. -->
              <span class="sv3-mx-posepick" id="sv3-mx-posepick">
                <select id="sv3-mx-pose" class="sv3-mx-posehidden"></select>
                <button class="sv3-mx-posebtn" id="sv3-mx-posebtn" type="button"></button>
                <div class="sv3-mx-poselist" id="sv3-mx-poselist"></div>
              </span>
            </label>
            <textarea class="sv3-pop-refine" id="sv3-mx-note" rows="3"
              placeholder="Describe the shot, the light, the details… Leave empty to place the character into the location as-is."></textarea>
            <span id="sv3-mx-gen-wrap"><button class="sv3-btn primary" id="sv3-mx-gen" type="button" disabled>Compose</button></span>
            <div class="sv3-mx-working" id="sv3-mx-working"></div>
          </div>
        </div>

        <div class="sv3-pop-col sv3-pop-colmid">
          <div class="sv3-pop-prev" id="sv3-mx-prev"></div>
          <div class="sv3-mx-striprow">
            <div class="sv3-mx-strip" id="sv3-mx-strip"></div>
            <div class="sv3-mx-bannedwrap" id="sv3-mx-banned" style="display:none">
              <button class="sv3-btn sm" id="sv3-mx-banned-btn" type="button" title="Hidden frames — click to restore">hidden</button>
              <div class="sv3-mx-bannedpop" id="sv3-mx-banned-pop"></div>
            </div>
          </div>
          <div class="sv3-pop-st" id="sv3-mx-st"></div>
        </div>

        <div class="sv3-pop-col sv3-mx-colappr">
          <div class="sv3-pop-sub2">Approved frames</div>
          <div class="sv3-pop-scroll" id="sv3-mx-appr"></div>
          <div class="sv3-mx-distbox">
            <label class="sv3-mx-distlbl">Spread over fragments
              <select id="sv3-mx-dist"></select>
            </label>
            <span id="sv3-mx-save-wrap"><button class="sv3-btn primary" id="sv3-mx-save" type="button" disabled>Save</button></span>
          </div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(_ov);

  _q('#sv3-mx-x').addEventListener('click', _close);
  _ov.addEventListener('mousedown', e => { if (e.target === _ov) _close(); });
  document.addEventListener('keydown', _onKey);

  const note = _q('#sv3-mx-note');
  note.value = _mix.note || '';
  note.addEventListener('input', () => { _mix.note = note.value; _syncGenerate(); _queueSave(); });

  // gear
  const gear = _q('#sv3-mx-gear'), gpop = _q('#sv3-mx-gearpop');
  gear.addEventListener('click', e => { e.stopPropagation(); gpop.classList.toggle('open'); });
  document.addEventListener('click', e => {
    if (gpop.classList.contains('open') && !gpop.contains(e.target) && e.target !== gear) gpop.classList.remove('open');
  });
  const asel = _q('#sv3-mx-agg'), msel = _q('#sv3-mx-model'),
        fsel = _q('#sv3-mx-format'), qsel = _q('#sv3-mx-quality');
  fsel.value = _mix.settings.format;
  // _renderSettings fills the model list from the aggregator, so switching the
  // aggregator away from a model it does not host snaps the model to a real one.
  asel.addEventListener('change', () => {
    _mix.settings.aggregator = asel.value;
    _mix.settings.model = _effModel();
    _renderSettings(); _queueSave();
  });
  msel.addEventListener('change', () => { _mix.settings.model = msel.value; _renderSettings(); _queueSave(); });
  fsel.addEventListener('change', () => { _mix.settings.format = fsel.value; _renderSettings(); _queueSave(); });
  qsel.addEventListener('change', () => { _mix.settings.quality = qsel.value; _renderSettings(); _queueSave(); });

  // banned dropdown opens upward
  const bbtn = _q('#sv3-mx-banned-btn'), bpop = _q('#sv3-mx-banned-pop');
  bbtn.addEventListener('click', e => { e.stopPropagation(); bpop.classList.toggle('open'); });
  document.addEventListener('click', e => {
    if (bpop.classList.contains('open') && !bpop.contains(e.target) && e.target !== bbtn) bpop.classList.remove('open');
  });

  _q('#sv3-mx-gen').addEventListener('click', _onGenerate);
  _q('#sv3-mx-save').addEventListener('click', _onSave);
  _q('#sv3-mx-dist').addEventListener('change', (e) => {
    _mix.distribution = e.target.value; _renderDistribution(); _queueSave();
  });

  // The three frame parameters only steer a COMPOSE — an edit works from the frame
  // it is given and ignores them. Touching one is therefore a statement of intent to
  // compose, so it drops the active frame and switches back rather than being
  // silently ignored. Changing the group also re-filters the pose list.
  _q('#sv3-mx-camera').addEventListener('change', e => {
    _mix.camera = e.target.value; _toCompose(); _renderParams(); _renderAll(); _queueSave();
  });
  _q('#sv3-mx-framing').addEventListener('change', e => {
    _mix.framing = e.target.value;
    _mix.poseId = '';          // the old pose belonged to the old group
    _toCompose(); _renderParams(); _renderAll(); _queueSave();
  });
  _q('#sv3-mx-pose').addEventListener('change', e => {
    _mix.poseId = e.target.value; _toCompose(); _renderAll(); _queueSave();
  });
  _initPosePicker();
  _cropInit();

  _renderAll();

  // A generation started before this popup was closed is still running: show it
  // again, spinner, bar, countdown and locks, so reopening explains itself instead
  // of presenting a dead button.
  _attachJob();
  // Or the page was reloaded — or this is another tab — and the SERVER is the one
  // seeing that generation through. Follow it rather than pretending it is idle.
  if (!_job && _mix.pending && _mix.pending.taskId) _followPending(_proj.id, _mix.pending);
  if (_lastFail && String(_lastFail.projectId) === String(_proj.id)) {
    _status('Last generation failed: ' + _lastFail.message);
    _lastFail = null;
  } else if (!_job && _mix.lastError) {
    _status('Last generation failed: ' + _mix.lastError);
  }
  _syncGenerate();
  if (pick) _togglePick(pick);

  // presets and mannequins load in the background; the selects refill when they land
  Promise.all([frameOptions().catch(() => null), listPoses().catch(() => [])])
    .then(([fo, poses]) => {
      if (!_ov) return;
      if (fo && fo.cameras && fo.framings) _fopts = fo;
      _poses = poses || [];
      _renderParams(); _renderWorkingWith(); _syncGenerate();
    });
}
