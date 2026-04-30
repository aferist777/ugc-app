/* ═══════════════════════════════════════
   SCENARIOS & DETAILS tabs
   ═══════════════════════════════════════ */

// ── ElevenLabs voice list — only kie.ai supported named presets ───────────────
window.ELEVENLABS_VOICES = [
  { name: 'Rachel',  desc: 'Default female' },
  { name: 'Aria',    desc: 'Female' },
  { name: 'Roger',   desc: 'Male' },
  { name: 'Sarah',   desc: 'Female' },
  { name: 'Charlie', desc: 'Male' },
  { name: 'George',  desc: 'Male' },
  { name: 'River',   desc: 'Neutral' },
  { name: 'Alice',   desc: 'Female, British' },
  { name: 'Matilda', desc: 'Female' },
  { name: 'Will',    desc: 'Male' },
  { name: 'Eric',    desc: 'Male' },
  { name: 'Daniel',  desc: 'Male, British' },
  { name: 'Lily',    desc: 'Female, British' },
  { name: 'Bill',    desc: 'Male' },
];

// ── Lazy image loader (IntersectionObserver) ──────────────────────────────────
const _lazyObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    const img = entry.target;
    if (img.dataset.src) { img.src = img.dataset.src; delete img.dataset.src; }
    _lazyObserver.unobserve(img);
  });
}, { rootMargin: '100px' });
function lazyLoad(img) { _lazyObserver.observe(img); }

// ── Sub-tab switching ─────────────────────────────────────────────────────────
document.querySelectorAll('.scen-subtab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.scen-subtab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.scen-subpanel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    const target = btn.dataset.panel;
    document.getElementById(target)?.classList.add('active');
    // Toggle edit-active on the tab panel (hides образы/upload/предметы in right col)
    document.getElementById('l1-scenarii')?.classList.toggle('edit-active', target === 'scen-panel-edit');
    if (target === 'scen-panel-db')   loadArchivedScenarios();
    if (target === 'scen-panel-edit') { window._editPanelNeedsRender = false; renderEditPanel(); }
    if (target === 'scen-panel-active') {
      // If any generation is done, clear those scenario assignments for a fresh start
      const doneSessions = Object.entries(editFrozenSessions).filter(([, s]) => s.done);
      if (doneSessions.length) {
        const doneScens = new Set(doneSessions.map(([k]) => k.split('__').slice(1).join('__')));
        doneScens.forEach(scenFile => {
          Object.keys(scenarioAssignments).forEach(k => {
            if (k.startsWith(scenFile + '__')) delete scenarioAssignments[k];
          });
        });
        _saveAssignmentsToLS();
        saveScenarioAssignments();
        updateActiveScenariosList();
        loadScenarios();
      }
    }
  });
});

// ── Active образ selection (multi, up to 10) ──────────────────────────────────
const activeObrazIds = new Set();
const MAX_ACTIVE_OBRAZY = 10;

function getActiveObrazы() {
  const all = getObrazы?.() || [];
  return [...activeObrazIds].map(id => all.find(o => o.id === id)).filter(Boolean);
}

function setActiveObraz(id, wrapEl) {
  if (activeObrazIds.has(id)) {
    activeObrazIds.delete(id);
    wrapEl?.classList.remove('obraz-active');
  } else {
    if (activeObrazIds.size >= MAX_ACTIVE_OBRAZY) {
      setStatus(`Max ${MAX_ACTIVE_OBRAZY} outfits`);
      return;
    }
    activeObrazIds.add(id);
    wrapEl?.classList.add('obraz-active');
  }
  saveEditState();
  renderEditPanel();
}

// ── Scenario assignments ──────────────────────────────────────────────────────
// Persisted in localStorage (primary) + server (backup) so assignments survive
// page refresh, tab switches and any action that calls loadScenarioAssignments().
const LS_SCENARIO_ASSIGNMENTS = 'scenario_assignments_v1';
function _saveAssignmentsToLS() {
  try { localStorage.setItem(LS_SCENARIO_ASSIGNMENTS, JSON.stringify(scenarioAssignments)); } catch {}
}
let scenarioAssignments = (() => {
  try { return JSON.parse(localStorage.getItem(LS_SCENARIO_ASSIGNMENTS) || '{}'); } catch { return {}; }
})();
let scenarioFiles      = []; // cache of {file, name} for active-scenarios panel
let cachedDetailFiles  = []; // cache of detail {file, name, path, thumbPath}
const scenarioLinesCache = {}; // filename → lines[]

async function getLinesForScenario(filename) {
  if (scenarioLinesCache[filename]) return scenarioLinesCache[filename];
  const stored = getModifiedLines(filename);
  if (stored) { scenarioLinesCache[filename] = stored; return stored; }
  try {
    const d = await fetch(`/api/scenarios/${encodeURIComponent(filename)}`).then(r => r.json());
    scenarioLinesCache[filename] = d.lines || [];
    return scenarioLinesCache[filename];
  } catch { return []; }
}

// ── Default interaction options (label shown in dropdown, prompt used for generation) ──
const DEFAULT_INTERACTIONS = [
  { label: 'Random',            prompt: '' },
  { label: 'In left hand',      prompt: 'The character holds the item naturally in their left hand, arm relaxed at side, item clearly visible. Natural grip, correct proportional scale.' },
  { label: 'In right hand',     prompt: 'The character holds the item in their right hand raised slightly toward camera at a comfortable angle, item prominent and fully visible.' },
  { label: 'Both hands',        prompt: 'The character holds the item with both hands, centered in front of the body at natural chest height, secure and comfortable grip, item fully visible.' },
  { label: 'Above head',        prompt: 'The character lifts the item above their head with both arms extended upward, item clearly visible at the top of the frame, triumphant pose.' },
];

// Analysis cache: detailFile → [{label, prompt}, ...] (3 Gemini variants per asset)
// Persisted to localStorage so results survive tab switches and re-renders
const LS_ANALYSIS_CACHE = 'edit_analysis_cache_v1';
function _loadAnalysisCache() { try { return JSON.parse(localStorage.getItem(LS_ANALYSIS_CACHE) || '{}'); } catch { return {}; } }
function _saveAnalysisCache() { try { localStorage.setItem(LS_ANALYSIS_CACHE, JSON.stringify(analysisCache)); } catch {} }
const analysisCache = _loadAnalysisCache();

// Per-card selected interaction: `${scenFile}__${lineIndex}` → optionIndex (into merged options)
const cardInteractionSel = {};
// Per-scenario merged options (default + cached): scenFile → [{label,prompt}]
const scenarioMergedOptions = {};

// ── Эдит panel render guard ───────────────────────────────────────────────────
// Prevents destructive re-renders while panel is hidden (tab switch away).
// When panel becomes visible again, renderEditPanel() is called normally.
// Exposed on window so tabs.js can trigger deferred render on Склейка tab return.
window._editPanelNeedsRender = false;

// ── Frozen edit sessions ──────────────────────────────────────────────────────
// key: `${obrazId}__${scenFile}` → { lines, cells:[{imagePath,detInfo,line}], generating, done }
const editFrozenSessions = {};

// ── Per-card result cache — survives renderEditPanel re-renders (tab switches) ─
// key: `${scenFile}__${lineIdx}` (interaction) or `${scenFile}__${lineIdx}__pose` (pose gen)
const editCardCache = {};

// Each "Создание" click gets a unique instance key so sessions never overwrite each other
function editSessionKey(obrazId, scenFile) { return `${obrazId}__${scenFile}__${Date.now()}`; }

// ── Edit state persistence (localStorage) ────────────────────────────────────
const LS_ACTIVE_OBRAZY    = 'edit_active_obrazy_v1';
const LS_FROZEN_SESSIONS  = 'edit_frozen_sessions_v1';
const LS_CARD_CACHE       = 'edit_card_cache_v1';
// Last-visible sets: record exactly what was shown last time each panel rendered.
// On reload, anything NOT in these sets is auto-hidden/closed so the UI looks
// the same as when the user left.
const LS_EDIT_LAST_VISIBLE   = 'edit_last_visible_v1';   // Эдит  — session keys
const LS_SKLEYKA_LAST_SHOWN  = 'skleyka_last_shown_v1';  // Склейка — session keys
function _saveEditLastVisible(keyIterable) {
  try { localStorage.setItem(LS_EDIT_LAST_VISIBLE, JSON.stringify([...keyIterable])); } catch {}
}
function _loadEditLastVisible() {
  try {
    const raw = localStorage.getItem(LS_EDIT_LAST_VISIBLE);
    return raw ? new Set(JSON.parse(raw)) : null; // null = first run ever
  } catch { return null; }
}
function _saveSkleykaLastShown(keyIterable) {
  try { localStorage.setItem(LS_SKLEYKA_LAST_SHOWN, JSON.stringify([...keyIterable])); } catch {}
}
function _loadSkleykaLastShown() {
  try {
    const raw = localStorage.getItem(LS_SKLEYKA_LAST_SHOWN);
    return raw ? new Set(JSON.parse(raw)) : null;
  } catch { return null; }
}

function saveEditState() {
  try {
    localStorage.setItem(LS_ACTIVE_OBRAZY,   JSON.stringify([...activeObrazIds]));
    // Save ALL sessions — including generating ones (cells may have taskIds for recovery)
    localStorage.setItem(LS_FROZEN_SESSIONS, JSON.stringify(editFrozenSessions));
    localStorage.setItem(LS_CARD_CACHE,      JSON.stringify(editCardCache));
  } catch {}
}

function loadEditState() {
  try {
    const ids = JSON.parse(localStorage.getItem(LS_ACTIVE_OBRAZY) || '[]');
    ids.forEach(id => activeObrazIds.add(id));
    const sessions = JSON.parse(localStorage.getItem(LS_FROZEN_SESSIONS) || '{}');
    // Migrate old keys (format: "obrazId__scenFile") — inject scenFile/obrazId metadata
    for (const [key, sess] of Object.entries(sessions)) {
      if (!sess.scenFile) {
        const parts = key.split('__');
        sess.obrazId  = parts[0];
        sess.scenFile = parts.slice(1).join('__');
      }
    }
    Object.assign(editFrozenSessions, sessions);
    const cache = JSON.parse(localStorage.getItem(LS_CARD_CACHE) || '{}');
    Object.assign(editCardCache, cache);

    // ── Restore Эдит visible set ─────────────────────────────────────────────
    // Any session that was not shown during the last Эдит view gets auto-hidden,
    // so the tab looks exactly the same as when the user left.
    const lastVisible = _loadEditLastVisible();
    if (lastVisible !== null) {
      for (const [key, sess] of Object.entries(editFrozenSessions)) {
        if (!lastVisible.has(key) && !sess.hiddenFromEdit) {
          sess.hiddenFromEdit = true;
        }
      }
    }

    // ── Restore Склейка closed set ───────────────────────────────────────────
    // Completed sessions that were not shown last time → auto-close so the
    // timeline panel looks identical to what the user left. Runs after
    // editFrozenSessions is populated so getCompletedSessions() is accurate.
    const lastShown = _loadSkleykaLastShown();
    if (lastShown !== null) {
      const closed = getSkleykaClosed();
      let changed = false;
      getCompletedSessions().forEach(([key]) => {
        if (!closed.has(key) && !lastShown.has(key)) {
          closed.add(key);
          changed = true;
        }
      });
      if (changed) saveSkleykaClosed(closed);
    }
  } catch {}
}

function removeEditProject(sessionKey) {
  delete editFrozenSessions[sessionKey];
  // Remove all card cache entries for this session (keyed by sessionKey prefix)
  Object.keys(editCardCache).forEach(k => {
    if (k.startsWith(sessionKey + '__')) delete editCardCache[k];
  });
  saveEditState();
}

// ── Edit project archive (deleted projects) ───────────────────────────────────
const LS_EDIT_ARCHIVE        = 'edit_archived_projects_v1';
const LS_EDIT_ACTIVE_PROJECT = 'edit_active_project_key_v1';

function loadEditArchive() {
  try { return JSON.parse(localStorage.getItem(LS_EDIT_ARCHIVE) || '[]'); } catch { return []; }
}
function saveEditArchive(list) {
  try { localStorage.setItem(LS_EDIT_ARCHIVE, JSON.stringify(list)); } catch {}
}
function getActiveProjectKey() {
  return localStorage.getItem(LS_EDIT_ACTIVE_PROJECT) || '';
}
function setActiveProjectKey(key) {
  if (key) localStorage.setItem(LS_EDIT_ACTIVE_PROJECT, key);
  else localStorage.removeItem(LS_EDIT_ACTIVE_PROJECT);
}

// Restore persisted edit state immediately on script load
loadEditState();

// ── Resume polling for Edit cells that had in-flight tasks at restart ─────────
// Runs after page load; for each frozen session cell that has a taskId but no
// imagePath, resumes polling and fills the result in when the task completes.
async function resumeEditPendingCells() {
  let anyPending = false;
  const promises = [];

  for (const [sessionKey, session] of Object.entries(editFrozenSessions)) {
    if (!Array.isArray(session.cells)) continue;

    session.cells.forEach((cell, cellIdx) => {
      if (!cell.taskId || cell.imagePath) return;  // nothing to resume
      anyPending = true;
      const cardKey = `${sessionKey}__${cellIdx}`;

      promises.push((async () => {
        try {
          const imagePath = await pollTask(cell.taskId);
          cell.imagePath = imagePath;
          delete cell.taskId;
          editCardCache[cardKey] = { imagePath };
          saveEditState();
          renderEditPanel();
        } catch {
          // Task failed or timed out — mark cell as failed
          delete cell.taskId;
          session.generating = false;
          saveEditState();
          renderEditPanel();
        }
      })());
    });

    // If any cells still need recovery, keep session visually "generating"
    const hasPending = session.cells.some(c => c.taskId && !c.imagePath);
    if (hasPending) session.generating = true;
  }

  if (anyPending) {
    renderEditPanel();   // show spinners immediately
    setStatus('Restoring incomplete Edit generations…');
  }

  await Promise.all(promises);
  if (anyPending) setStatus('Edit restoration complete.');
}

// ── Resume polling for avatar video tasks that survived a tab switch / reload ──
// For each frozen session cell that has avatarTaskId but no videoPath, resumes
// polling pollAvatar() and writes the result back when kie.ai finishes.
async function resumeAvatarPendingCells() {
  let anyPending = false;
  const promises = [];

  for (const [, session] of Object.entries(editFrozenSessions)) {
    if (!Array.isArray(session.cells)) continue;

    session.cells.forEach(cell => {
      if (!cell.avatarTaskId || cell.videoPath) return;  // nothing to resume
      anyPending = true;
      cell._videoPending = true;  // show spinner in montage panel immediately

      promises.push((async () => {
        try {
          const videoPath = await pollAvatar(cell.avatarTaskId);
          cell.videoPath  = videoPath;
          cell.videoError = null;
          delete cell.avatarTaskId;
          delete cell._videoPending;
          saveEditState();
          renderEditPanel();
          renderMontagePanel();
        } catch (err) {
          cell.videoError = err.message || 'Avatar failed';
          delete cell.avatarTaskId;
          delete cell._videoPending;
          saveEditState();
          renderEditPanel();
          renderMontagePanel();
        }
      })());
    });
  }

  if (anyPending) {
    renderEditPanel();
    setStatus('Restoring incomplete talking head videos…');
  }

  await Promise.all(promises);
  if (anyPending) setStatus('Video restoration complete.');
}

// ── Pick a random image from obraz + its completed variations ─────────────────
function pickRandomObrazImage(obraz) {
  const completed = (obraz.variations || []).filter(v => v && v !== 'error');
  const pool = [obraz.char, ...completed].filter(Boolean);
  if (!pool.length) return obraz.char || '';
  return pool[Math.floor(Math.random() * pool.length)];
}

// ── Edit-pose dropdown options (must match EDIT_POSE_KEYS in config) ─────────
const EDIT_POSE_OPTIONS = [
  { value: '',                   label: '— pose —' },
  { value: 'edit_pose_look_left',  label: 'Turn left' },
  { value: 'edit_pose_look_right', label: 'Turn right' },
  { value: 'edit_pose_3quarter',   label: 'Three-quarter' },
  { value: 'edit_pose_head_tilt',  label: 'Head tilt' },
  { value: 'edit_pose_chin_up',    label: 'Chin up' },
];

// Run edit-pose generation: Gemini analysis → generation → show result
// cardKey and obrazId are optional — used to cache result and record in образ history
async function runEditPose(imgBox, genaBtn, charImagePath, poseKey, cardKey, obrazId, imageEngine) {
  imgBox.style.cssText = 'width:62px;height:82px;border:1px solid #808080;background:#ddd;overflow:hidden;flex-shrink:0;display:flex;align-items:center;justify-content:center;';
  imgBox.innerHTML = '<span style="font-size:9px;color:#888;">⏳</span>';
  genaBtn.disabled = true;

  const _sid = window.GenLog?.start('Scenarios', '🎭 Edit Pose');
  try {
    imageEngine = imageEngine || getImageEngine?.() || 'nano-banana-2';
    const gd = _sid && window.GenLog
      ? await window.GenLog.fetchLog(_sid, '🖼 Генерация позы', '/api/edit-pose/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imagePath: charImagePath, poseKey, imageEngine }) })
      : await fetch('/api/edit-pose/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imagePath: charImagePath, poseKey, imageEngine }) }).then(r => r.json());
    if (!gd.success) throw new Error(gd.error);

    // Poll until done
    const MAX = 120, INTERVAL = 3000;
    let imagePath = null;
    for (let i = 0; i < MAX; i++) {
      await new Promise(r => setTimeout(r, INTERVAL));
      const sr = await fetch(`/api/edit-pose/status/${gd.taskId}`);
      const sd = await sr.json();
      if (sd.state === 'success') { imagePath = sd.imagePath; break; }
      if (sd.state === 'failed')  throw new Error(sd.error || 'failed');
    }
    if (!imagePath) throw new Error('Pose generation timeout');

    imgBox.innerHTML = '';
    imgBox.style.cssText = 'width:62px;height:82px;border:1px solid #808080;background:#ccc;overflow:hidden;flex-shrink:0;cursor:zoom-in;';
    const img = document.createElement('img');
    img.src = imagePath + '?t=' + Date.now();
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';

    // Accumulate pose variants in cache for lightbox slider
    const prevPoseCache = cardKey ? (editCardCache[cardKey] || {}) : {};
    const poseGenImgs = prevPoseCache.generatedImages || [];
    if (!poseGenImgs.includes(imagePath)) poseGenImgs.push(imagePath);
    const poseCacheObj = { imagePath, generatedImages: poseGenImgs };
    if (cardKey) { editCardCache[cardKey] = poseCacheObj; saveEditState(); }

    img.addEventListener('click', () => openImagePicker(
      poseCacheObj.generatedImages?.length ? poseCacheObj.generatedImages : [poseCacheObj.imagePath],
      img, poseCacheObj.imagePath, selected => {
        poseCacheObj.imagePath = selected;
        img.src = selected + '?t=' + Date.now();
        if (cardKey) { editCardCache[cardKey] = poseCacheObj; saveEditState(); }
      }));
    imgBox.appendChild(img);
    if (obrazId)  addObrazEditResult?.(obrazId, imagePath);
    window.GenLog?.finalize(_sid, 'success');
  } catch (err) {
    window.GenLog?.finalize(_sid, 'error');
    console.error('[edit-pose]', err.message);
    imgBox.style.cssText = 'width:62px;height:82px;border:1px solid #808080;background:#ddd;overflow:hidden;flex-shrink:0;display:flex;align-items:center;justify-content:center;';
    imgBox.innerHTML = '<span style="font-size:8px;color:#aa0000;text-align:center;padding:2px;">Error</span>';
  } finally {
    genaBtn.disabled = false;
  }
}

function getMergedOptions(scenFile) {
  const extra = analysisCache[scenFile] || [];
  return [...DEFAULT_INTERACTIONS, ...extra];
}

// ── Эдит cell lightbox: slider over all generated variants ───────────────────
// cell           — session.cells[i] (mutated on save)
// onSave(path)   — called with chosen imagePath, then lightbox closes
// availableImgs  — optional explicit list (e.g. obraz variations)
function openEditCellLightbox(cell, onSave, availableImgs) {
  const images = availableImgs?.length ? availableImgs
    : (cell.generatedImages?.length ? cell.generatedImages : null)
    || (cell.imagePath ? [cell.imagePath] : []);
  if (!images.length) return;

  let idx = Math.max(0, images.lastIndexOf(cell.imagePath));

  // Overlay
  const overlay = document.createElement('div');
  overlay.style.cssText =
    'position:fixed;inset:0;background:rgba(0,0,0,0.88);z-index:9200;' +
    'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;';
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  // ── Image row: prev / img / next ────────────────────────────────────────────
  const imgRow = document.createElement('div');
  imgRow.style.cssText = 'display:flex;align-items:center;gap:10px;';

  const prevBtn = document.createElement('button');
  prevBtn.textContent = '◀';
  prevBtn.style.cssText = 'font-size:18px;padding:6px 14px;cursor:pointer;flex-shrink:0;';

  const mainImg = document.createElement('img');
  mainImg.style.cssText =
    'max-width:80vw;max-height:68vh;display:block;object-fit:contain;' +
    'border:2px solid #808080;background:#111;';
  mainImg.addEventListener('click', e => e.stopPropagation());

  const nextBtn = document.createElement('button');
  nextBtn.textContent = '▶';
  nextBtn.style.cssText = 'font-size:18px;padding:6px 14px;cursor:pointer;flex-shrink:0;';

  function render() {
    mainImg.src = images[idx] + '?t=' + Date.now();
    counterEl.textContent = `${idx + 1} / ${images.length}`;
    prevBtn.disabled = (idx === 0);
    nextBtn.disabled = (idx === images.length - 1);
    prevBtn.style.opacity = prevBtn.disabled ? '0.35' : '1';
    nextBtn.style.opacity = nextBtn.disabled ? '0.35' : '1';
  }

  prevBtn.addEventListener('click', () => { if (idx > 0) { idx--; render(); } });
  nextBtn.addEventListener('click', () => { if (idx < images.length - 1) { idx++; render(); } });

  // Keyboard navigation
  function onKey(e) {
    if (e.key === 'ArrowLeft')  { if (idx > 0) { idx--; render(); } }
    if (e.key === 'ArrowRight') { if (idx < images.length - 1) { idx++; render(); } }
    if (e.key === 'Escape')     { overlay.remove(); document.removeEventListener('keydown', onKey); }
    if (e.key === 'Enter')      { save(); }
  }
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('remove', () => document.removeEventListener('keydown', onKey));

  imgRow.appendChild(prevBtn);
  imgRow.appendChild(mainImg);
  imgRow.appendChild(nextBtn);

  // ── Counter ─────────────────────────────────────────────────────────────────
  const counterEl = document.createElement('div');
  counterEl.style.cssText = 'color:#bbb;font-size:11px;letter-spacing:0.5px;';

  // ── Hint ──────────────────────────────────────────────────────────────────
  const hint = document.createElement('div');
  hint.style.cssText = 'color:#777;font-size:10px;';
  hint.textContent = '← → to navigate';

  // ── Buttons ─────────────────────────────────────────────────────────────────
  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:8px;margin-top:2px;';

  function save() {
    document.removeEventListener('keydown', onKey);
    onSave(images[idx]);
    overlay.remove();
  }

  const saveBtn = document.createElement('button');
  saveBtn.textContent = 'Save';
  saveBtn.style.cssText =
    'padding:5px 24px;font-size:12px;font-weight:bold;cursor:pointer;' +
    'background:#000080;color:#fff;border:2px solid #6060c0;';
  saveBtn.addEventListener('click', save);

  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'Close';
  closeBtn.style.cssText = 'padding:5px 18px;font-size:12px;cursor:pointer;';
  closeBtn.addEventListener('click', () => {
    document.removeEventListener('keydown', onKey);
    overlay.remove();
  });

  btnRow.appendChild(saveBtn);
  btnRow.appendChild(closeBtn);

  overlay.appendChild(imgRow);
  overlay.appendChild(counterEl);
  overlay.appendChild(hint);
  overlay.appendChild(btnRow);
  document.body.appendChild(overlay);
  render();
}

// ── Image variation picker popup (anchored to anchor element) ────────────────
// images     — array of image paths
// anchorEl   — element to position popup near (the clicked img/box)
// currentPath — currently displayed image path
// onSave(path) — called with chosen path, popup closes
function openImagePicker(images, anchorEl, currentPath, onSave) {
  document.getElementById('image-picker-popup')?.remove();
  document.getElementById('image-picker-backdrop')?.remove();
  if (!images || !images.length) return;

  const THUMB_W = 60, THUMB_H = 80, COLS = 2, GAP = 4, PAD = 6;
  const POPUP_W = COLS * THUMB_W + (COLS - 1) * GAP + PAD * 2;

  const rect = anchorEl.getBoundingClientRect();
  let left = rect.left + window.scrollX;
  let top  = rect.bottom + window.scrollY + 4;
  if (left + POPUP_W > window.innerWidth - 8) left = window.innerWidth - POPUP_W - 8;
  if (left < 4) left = 4;

  const backdrop = document.createElement('div');
  backdrop.id = 'image-picker-backdrop';
  backdrop.style.cssText = 'position:fixed;inset:0;z-index:9190;';
  backdrop.addEventListener('click', close);

  const popup = document.createElement('div');
  popup.id = 'image-picker-popup';
  popup.style.cssText =
    `position:absolute;left:${left}px;top:${top}px;z-index:9200;` +
    'background:#1e1e1e;border:1px solid #555;box-shadow:0 4px 16px rgba(0,0,0,0.7);' +
    `padding:${PAD}px;width:${POPUP_W}px;box-sizing:border-box;`;
  popup.addEventListener('click', e => e.stopPropagation());

  const grid = document.createElement('div');
  grid.style.cssText =
    `display:grid;grid-template-columns:repeat(${COLS},${THUMB_W}px);gap:${GAP}px;` +
    'max-height:280px;overflow-y:auto;';

  images.forEach(src => {
    const cell = document.createElement('div');
    const isActive = src === currentPath;
    cell.style.cssText =
      `cursor:pointer;border:2px solid ${isActive ? '#5080ff' : 'transparent'};` +
      `width:${THUMB_W}px;height:${THUMB_H}px;overflow:hidden;background:#333;flex-shrink:0;`;

    const img = document.createElement('img');
    img.src = src;
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;pointer-events:none;';
    img.onerror = () => { img.style.display = 'none'; cell.style.background = '#555'; };
    cell.appendChild(img);

    cell.addEventListener('mouseenter', () => { if (src !== currentPath) cell.style.borderColor = '#888'; });
    cell.addEventListener('mouseleave', () => { cell.style.borderColor = (src === currentPath) ? '#5080ff' : 'transparent'; });
    cell.addEventListener('click', () => { close(); onSave(src); });
    grid.appendChild(cell);
  });

  popup.appendChild(grid);

  function close() { backdrop.remove(); popup.remove(); }

  document.body.appendChild(backdrop);
  document.body.appendChild(popup);
}

// ── Detail/item picker popup (anchored to anchor element) ────────────────────
// items       — array of { file, name, path, thumbPath }
// anchorEl    — element to position popup near (the clicked detailBox)
// currentFile — currently assigned detail file (or null)
// onSave(item|null) — called with chosen detail object or null (clear), popup closes
function openDetailPicker(items, anchorEl, currentFile, onSave) {
  // Remove any existing picker
  document.getElementById('detail-picker-popup')?.remove();
  if (!items || !items.length) return;

  // ── Position: below the anchor, shifted left to stay in viewport ─────────
  const rect = anchorEl.getBoundingClientRect();
  const POPUP_W = 220;
  let left = rect.left + window.scrollX;
  let top  = rect.bottom + window.scrollY + 4;
  if (left + POPUP_W > window.innerWidth - 8) left = window.innerWidth - POPUP_W - 8;
  if (left < 4) left = 4;

  // ── Backdrop (transparent, closes on outside click) ───────────────────────
  const backdrop = document.createElement('div');
  backdrop.style.cssText = 'position:fixed;inset:0;z-index:9190;';
  backdrop.addEventListener('click', close);

  // ── Popup container ───────────────────────────────────────────────────────
  const popup = document.createElement('div');
  popup.id = 'detail-picker-popup';
  popup.style.cssText =
    `position:absolute;left:${left}px;top:${top}px;z-index:9200;` +
    'background:#1e1e1e;border:1px solid #555;box-shadow:0 4px 16px rgba(0,0,0,0.7);' +
    'padding:6px;width:' + POPUP_W + 'px;box-sizing:border-box;';
  popup.addEventListener('click', e => e.stopPropagation());

  // ── Grid of thumbnails ────────────────────────────────────────────────────
  const grid = document.createElement('div');
  grid.style.cssText =
    'display:grid;grid-template-columns:repeat(3,1fr);gap:4px;' +
    'max-height:260px;overflow-y:auto;padding-right:2px;';

  items.forEach(item => {
    const cell = document.createElement('div');
    const isActive = item.file === currentFile;
    cell.style.cssText =
      'cursor:pointer;border:2px solid ' + (isActive ? '#5080ff' : 'transparent') + ';' +
      'background:#333;overflow:hidden;aspect-ratio:1/1;';
    cell.title = item.name || item.file;

    const img = document.createElement('img');
    img.src = (item.thumbPath || item.path);
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;pointer-events:none;';
    img.onerror = () => { img.style.display = 'none'; cell.style.background = '#555'; };
    cell.appendChild(img);

    cell.addEventListener('mouseenter', () => {
      if (item.file !== currentFile) cell.style.borderColor = '#888';
    });
    cell.addEventListener('mouseleave', () => {
      cell.style.borderColor = (item.file === currentFile) ? '#5080ff' : 'transparent';
    });
    cell.addEventListener('click', () => {
      close();
      onSave(item);
    });
    grid.appendChild(cell);
  });

  // ── "Clear" link at bottom ────────────────────────────────────────────────
  const clearRow = document.createElement('div');
  clearRow.style.cssText = 'text-align:center;margin-top:5px;';
  const clearBtn = document.createElement('button');
  clearBtn.textContent = '✕ Remove item';
  clearBtn.style.cssText =
    'font-size:9px;color:#aaa;background:none;border:none;cursor:pointer;padding:2px 6px;';
  clearBtn.addEventListener('click', () => { close(); onSave(null); });
  clearRow.appendChild(clearBtn);

  popup.appendChild(grid);
  popup.appendChild(clearRow);

  function close() {
    backdrop.remove();
    popup.remove();
  }

  document.body.appendChild(backdrop);
  document.body.appendChild(popup);
}

// ── Helper: build a frozen results row from a saved session ──────────────────
function buildFrozenRow(session, onReran, obraz, onRetryVideo) {
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:6px;overflow-x:auto;padding-bottom:4px;';

  // All character image variants for this obraz (used for lightbox slider)
  const charImages = obraz
    ? [obraz.char, ...(obraz.variations || []).filter(v => v && v !== 'error')].filter(Boolean)
    : null;

  session.cells.forEach((cell, i) => {
    const c = document.createElement('div');
    c.style.cssText = 'flex-shrink:0;width:66px;display:flex;flex-direction:column;align-items:center;gap:2px;';

    const num = document.createElement('div');
    num.style.cssText = 'font-size:9px;color:#808080;line-height:1.4;';
    num.textContent = i + 1;

    const imgBox = document.createElement('div');
    imgBox.style.cssText = 'width:62px;height:82px;border:1px solid #808080;overflow:hidden;flex-shrink:0;';

    if (!cell.detInfo) {
      // No-item cell: image IS the character photo → slider shows obraz variations
      imgBox.style.cssText += 'background:#ccc;cursor:zoom-in;';
      const img = document.createElement('img');
      img.dataset.src = cell.imagePath || '';
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
      if (cell.imagePath) {
        img.addEventListener('click', () => openImagePicker(
          charImages?.length ? charImages : (cell.generatedImages?.length ? cell.generatedImages : [cell.imagePath]),
          img, cell.imagePath, selected => {
            cell.imagePath = selected;
            cell.charImagePath = selected;
            img.src = selected + '?t=' + Date.now();
            saveEditState();
          }));
        lazyLoad(img);
      }
      imgBox.appendChild(img);
    } else if (cell.imagePath) {
      // Interaction cell: slider shows generated reruns (falls back to obraz vars if empty)
      imgBox.style.cssText += 'background:#ccc;cursor:zoom-in;';
      const img = document.createElement('img');
      img.dataset.src = cell.imagePath + '?t=' + Date.now();
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
      img.addEventListener('click', () => openImagePicker(
        cell.generatedImages?.length ? cell.generatedImages : (charImages?.length ? charImages : [cell.imagePath]),
        img, cell.imagePath, selected => {
          cell.imagePath = selected;
          img.src = selected + '?t=' + Date.now();
          saveEditState();
        }));
      lazyLoad(img);
      imgBox.appendChild(img);
    } else if (cell.taskId || session.generating) {
      imgBox.style.cssText += 'background:#ddd;display:flex;align-items:center;justify-content:center;';
      imgBox.innerHTML = '<span style="font-size:9px;color:#888;">⏳</span>';
    } else {
      imgBox.style.cssText += 'background:#ebebeb;display:flex;align-items:center;justify-content:center;';
      imgBox.innerHTML = '<span style="font-size:8px;color:#aa0000;">Error</span>';
    }

    const reranBtn = document.createElement('button');
    reranBtn.textContent = '↺';
    reranBtn.title = 'Rerun (random prompt)';
    reranBtn.style.cssText = `width:66px;font-size:9px;padding:1px 0;margin-top:1px;cursor:pointer;${(!cell.detInfo || !cell.imagePath) ? 'display:none;' : ''}`;
    reranBtn.addEventListener('click', () => onReran(i, imgBox, reranBtn));

    const txt = document.createElement('div');
    txt.style.cssText = 'font-size:8px;color:#444;text-align:center;line-height:1.3;max-width:66px;word-break:break-word;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;';
    txt.textContent = cell.line;

    // Video container — pre-populate if videoPath, avatarTaskId, or videoError already stored
    const videoContainer = document.createElement('div');
    videoContainer.style.cssText = 'width:66px;margin-top:2px;' + (cell.videoPath || cell.avatarTaskId || cell.videoError ? '' : 'display:none;');
    if (cell.videoPath) {
      const vid = document.createElement('video');
      vid.controls = true; vid.src = cell.videoPath;
      vid.style.cssText = 'width:66px;';
      videoContainer.appendChild(vid);
    } else if (cell.avatarTaskId) {
      videoContainer.innerHTML = '<span style="font-size:8px;color:#888;">⏳ video…</span>';
    } else if (cell.videoError) {
      const errSpan = document.createElement('span');
      errSpan.textContent = '❌ Video'; errSpan.style.cssText = 'font-size:8px;color:#aa0000;';
      videoContainer.appendChild(errSpan);
      if (onRetryVideo) {
        const retryBtn = document.createElement('button');
        retryBtn.textContent = '↺ Retry';
        retryBtn.title = 'Retry video generation';
        retryBtn.style.cssText = 'font-size:8px;padding:1px 3px;cursor:pointer;display:block;width:100%;margin-top:2px;';
        retryBtn.addEventListener('click', () => onRetryVideo(i, videoContainer, cell));
        videoContainer.appendChild(retryBtn);
      }
    }

    c.appendChild(num); c.appendChild(imgBox); c.appendChild(reranBtn); c.appendChild(txt);
    c.appendChild(videoContainer);
    row.appendChild(c);
    cell._imgBox         = imgBox;
    cell._reranBtn       = reranBtn;
    cell._videoContainer = videoContainer;
  });
  return row;
}

// ── Эдит panel renderer ───────────────────────────────────────────────────────
async function renderEditPanel() {
  const panel = document.getElementById('scen-panel-edit');
  if (!panel) return;

  // If panel is not currently visible (user switched tabs), defer the re-render.
  // scen-panel-edit keeps its 'active' class even when the parent l1-skleyka is
  // hidden — so we must check BOTH the sub-panel AND its L1 parent.
  // In-flight async jobs (analysis, generation) keep running; DOM elements remain
  // connected (just hidden) so their callbacks can still update the UI correctly.
  const l1Skleyka = document.getElementById('l1-skleyka');
  const editVisible = panel.classList.contains('active') && l1Skleyka?.classList.contains('active');
  if (!editVisible) {
    window._editPanelNeedsRender = true;
    return;
  }
  window._editPanelNeedsRender = false;

  panel.innerHTML = '';

  // Iterate all sessions (newest first), excluding ones hidden from Эдит
  const allSessions = Object.entries(editFrozenSessions)
    .filter(([, s]) => !s.hiddenFromEdit)
    .sort(([, a], [, b]) => new Date(b.date || 0) - new Date(a.date || 0));

  // Persist exactly what is shown so next reload restores the same view
  _saveEditLastVisible(allSessions.map(([key]) => key));

  // Build sequential number per scenFile using ALL sessions (incl. hidden/deleted),
  // sorted oldest-first. This way deleting a project never renumbers the others.
  const _scenFileNums = {}; // scenFile → [{key, date}, ...] oldest first
  Object.entries(editFrozenSessions).forEach(([key, sess]) => {
    const sf = sess.scenFile || key.split('__').slice(1, -1).join('__');
    if (!_scenFileNums[sf]) _scenFileNums[sf] = [];
    _scenFileNums[sf].push({ key, date: sess.date || '0' });
  });
  Object.values(_scenFileNums).forEach(arr => arr.sort((a, b) => new Date(a.date) - new Date(b.date)));
  function _getSessionNum(key, sess) {
    // Prefer the number stored at creation time; fall back to position in full list
    if (sess.num) return sess.num;
    const sf = sess.scenFile || key.split('__').slice(1, -1).join('__');
    const arr = _scenFileNums[sf] || [];
    const idx = arr.findIndex(e => e.key === key);
    return idx + 1; // 1-based; 0 means not found → fallback to 1
  }

  if (!allSessions.length) {
    const msg = document.createElement('div');
    msg.style.cssText = 'color:#888;font-size:11px;padding:8px 0;';
    msg.textContent = 'Select an outfit and click "Create"';
    panel.appendChild(msg);
    return;
  }

  for (const [sessionKey, sessionData] of allSessions) {
    const obrazId  = sessionData.obrazId  || sessionKey.split('__')[0];
    const scenFile = sessionData.scenFile || sessionKey.split('__').slice(1).join('__');
    const activeObraz = (getObrazы?.() || []).find(o => String(o.id) === obrazId);
    const f = scenarioFiles.find(sf => sf.file === scenFile);
    if (!activeObraz || !f) continue;

    const lines = await getLinesForScenario(f.file);
    if (!lines.length) continue;

    // pending = session created by "Создание" but ▶ not yet clicked
    const frozen = (sessionData.pending) ? null : sessionData;

    // ── Collapsible project dropdown wrapper ──────────────────────────────────
    const projectWrap = document.createElement('div');
    projectWrap.style.cssText = 'margin-bottom:8px;border:1px solid #808080;background:#c0c0c0;';

    const projectDate = frozen?.date ? new Date(frozen.date) : null;
    const projectDateStr = projectDate
      ? projectDate.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
      : new Date().toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const projNum = _getSessionNum(sessionKey, sessionData);
    const projectTitle = `${projectDateStr} — ${projNum} — ${f.name} — ${activeObraz.name}`;

    const projectToggle = document.createElement('div');
    projectToggle.style.cssText =
      'display:flex;align-items:center;gap:6px;padding:4px 6px;cursor:pointer;user-select:none;' +
      'background:#d4d0c8;border-bottom:1px solid #808080;font-size:11px;font-weight:bold;';
    const projectArrow = document.createElement('span');
    projectArrow.style.cssText = 'font-size:9px;color:#444;flex-shrink:0;';

    // ── Header thumbnail (first cell image, hidden when expanded) ────────────
    // Prefer charImagePath (character without item overlay) over imagePath
    let firstCellImg = frozen?.cells?.[0]?.charImagePath
      || frozen?.cells?.[0]?.imagePath
      || sessionData.obrazChar
      || null;

    // Fallback: pull from current obraz data and persist so next render is instant
    if (!firstCellImg && activeObraz?.char) {
      firstCellImg = activeObraz.char;
      if (editFrozenSessions[sessionKey]) {
        editFrozenSessions[sessionKey].obrazChar = activeObraz.char;
        saveEditState();
      }
    }

    const hdrThumb = document.createElement('img');
    hdrThumb.style.cssText =
      'width:22px;height:32px;object-fit:cover;flex-shrink:0;border:1px solid #808080;' +
      'background:#aaa;display:block;';
    if (firstCellImg) {
      const thumbSrc = _toThumb(firstCellImg);
      hdrThumb.src = thumbSrc || firstCellImg;
      if (thumbSrc && thumbSrc !== firstCellImg) {
        hdrThumb.onerror = () => { hdrThumb.src = firstCellImg; hdrThumb.onerror = null; };
      } else {
        hdrThumb.onerror = () => { hdrThumb.style.display = 'none'; hdrThumb.onerror = null; };
      }
    } else {
      hdrThumb.style.display = 'none';
    }

    const projectTitleEl = document.createElement('span');
    projectTitleEl.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    projectTitleEl.textContent = projectTitle;
    projectTitleEl.title = projectTitle;
    projectToggle.appendChild(projectArrow);
    projectToggle.appendChild(hdrThumb);
    projectToggle.appendChild(projectTitleEl);

    // ── Activate button ──
    const isActiveProj = getActiveProjectKey() === sessionKey;
    const activateBtn = document.createElement('button');
    activateBtn.textContent = isActiveProj ? '★' : '☆';
    activateBtn.title = isActiveProj ? 'Deactivate' : 'Activate project';
    activateBtn.style.cssText =
      `font-size:12px;padding:0 4px;cursor:pointer;flex-shrink:0;border:none;background:transparent;` +
      `color:${isActiveProj ? '#cc8800' : '#888'};`;
    activateBtn.addEventListener('click', e => {
      e.stopPropagation();
      const wasActive = getActiveProjectKey() === sessionKey;
      setActiveProjectKey(wasActive ? '' : sessionKey);
      renderEditPanel();
    });

    // ── Del button — hides from Эдит only; session stays in Склейка ──
    const delProjBtn = document.createElement('button');
    delProjBtn.textContent = 'del';
    delProjBtn.title = 'Hide from Edit (project stays in Merge)';
    delProjBtn.style.cssText = 'font-size:9px;padding:1px 5px;cursor:pointer;flex-shrink:0;color:#aa0000;';
    delProjBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (getActiveProjectKey() === sessionKey) setActiveProjectKey('');
      // Mark as hidden from Эдит without deleting — Склейка still sees this session
      if (editFrozenSessions[sessionKey]) {
        editFrozenSessions[sessionKey].hiddenFromEdit = true;
        saveEditState();
      }
      // Directly remove from last-visible so it stays hidden after reload
      const lv = _loadEditLastVisible();
      if (lv) { lv.delete(sessionKey); _saveEditLastVisible(lv); }
      renderEditPanel();
    });

    projectToggle.appendChild(activateBtn);
    projectToggle.appendChild(delProjBtn);

    if (isActiveProj) projectWrap.style.outline = '2px solid #cc8800';

    const projectBody = document.createElement('div');
    projectBody.style.cssText = 'padding:8px;display:none;';

    // Always start collapsed
    projectArrow.textContent = '▶';

    projectToggle.addEventListener('click', () => {
      const open = projectBody.style.display === 'none';
      projectBody.style.display = open ? '' : 'none';
      projectArrow.textContent = open ? '▼' : '▶';
      if (firstCellImg) hdrThumb.style.display = open ? 'none' : 'block';
    });

    projectWrap.appendChild(projectToggle);
    projectWrap.appendChild(projectBody);

    const block = document.createElement('div');
    block.style.cssText = 'margin-bottom:0;';

    // ── Project controls header ──
    const hdr = document.createElement('div');

    // Per-project engine selector (row 2)
    const engineSel = document.createElement('select');
    engineSel.style.cssText = 'font-size:9px;height:22px;padding:0 2px;flex:1;';
    engineSel.title = 'Engine for this project';
    [['nano-banana-2','NB Pro'],['qwen2','Qwen2'],['seedream','Seed']].forEach(([v,l]) => {
      const o = document.createElement('option'); o.value = v; o.textContent = l; engineSel.appendChild(o);
    });
    const engineStorageKey = `edit_engine__${sessionKey}`;
    engineSel.value = localStorage.getItem(engineStorageKey) || getImageEngine?.() || 'nano-banana-2';
    engineSel.addEventListener('change', () => localStorage.setItem(engineStorageKey, engineSel.value));

    // Per-project voice selector
    const voiceSel = document.createElement('select');
    voiceSel.title = 'Voice for TTS in this project';
    voiceSel.style.cssText = 'font-size:9px;height:22px;padding:0 2px;width:100%;';
    const voiceStorageKey = `edit_voice__${sessionKey}`;
    const _savedVoiceRaw  = localStorage.getItem(voiceStorageKey) || activeObraz?.voice || 'Rachel';
    window.buildVoiceSelect(voiceSel, _savedVoiceRaw);
    window.registerVoiceSelect?.(voiceSel, () => voiceSel.value || _savedVoiceRaw);
    voiceSel.addEventListener('change', () => localStorage.setItem(voiceStorageKey, voiceSel.value));
    const getProjectVoice = () => voiceSel.value || _savedVoiceRaw;

    // TTS "Голоса" button — enabled only when frozen session exists
    const ttsBtn = document.createElement('button');
    ttsBtn.textContent = '🎙';
    ttsBtn.title = 'Generate voices for scenario rows';
    ttsBtn.style.cssText = 'width:22px;height:22px;padding:0;font-size:10px;flex-shrink:0;cursor:pointer;';
    ttsBtn.disabled = !frozen;

    const analyzeBtn = document.createElement('button');
    analyzeBtn.style.cssText = 'width:22px;height:22px;padding:0;font-size:9px;flex-shrink:0;cursor:pointer;';
    analyzeBtn.textContent = '🔍';
    analyzeBtn.title = 'Analyze interactions';

    const generateBtn = document.createElement('button');
    generateBtn.style.cssText = 'width:22px;height:22px;padding:0;font-size:9px;flex-shrink:0;cursor:pointer;';
    generateBtn.textContent = '▶';
    generateBtn.title = 'Generate';

    const resetBtn = document.createElement('button');
    resetBtn.style.cssText = 'width:22px;height:22px;padding:0;font-size:9px;flex-shrink:0;cursor:pointer;color:#aa0000;' + (frozen ? '' : 'display:none;');
    resetBtn.textContent = '✕';
    resetBtn.title = 'Reset results';
    resetBtn.addEventListener('click', () => {
      // Soft reset: clear generated cells and card cache, keep session in Склейка
      const sess = editFrozenSessions[sessionKey];
      if (sess) {
        sess.cells = [];
        sess.generating = false;
        sess.done = false;
        sess.pending = true;
        Object.keys(editCardCache).forEach(k => {
          if (k.startsWith(sessionKey + '__')) delete editCardCache[k];
        });
        saveEditState();
      }
      renderEditPanel();
    });

    // 3-column layout: left=selects, center=spacer, right=buttons
    hdr.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;align-items:start;' +
      'margin-bottom:6px;padding-bottom:3px;border-bottom:1px solid #808080;';

    // Left col: dropdowns
    const hdrLeft = document.createElement('div');
    hdrLeft.style.cssText = 'display:flex;flex-direction:column;gap:3px;';
    engineSel.style.cssText = 'font-size:9px;height:22px;padding:0 2px;width:100%;';
    hdrLeft.appendChild(engineSel);
    hdrLeft.appendChild(voiceSel);

    // Center col: empty spacer
    const hdrCenter = document.createElement('div');

    // Right col: action buttons
    const hdrRight = document.createElement('div');
    hdrRight.style.cssText = 'display:flex;flex-direction:column;gap:3px;align-items:flex-end;';

    const btnRow1 = document.createElement('div');
    btnRow1.style.cssText = 'display:flex;gap:3px;';
    btnRow1.appendChild(analyzeBtn);
    btnRow1.appendChild(generateBtn);
    btnRow1.appendChild(resetBtn);

    const btnRow2 = document.createElement('div');
    btnRow2.style.cssText = 'display:flex;gap:3px;';
    btnRow2.appendChild(ttsBtn);

    hdrRight.appendChild(btnRow1);
    hdrRight.appendChild(btnRow2);

    hdr.appendChild(hdrLeft);
    hdr.appendChild(hdrCenter);
    hdr.appendChild(hdrRight);
    block.appendChild(hdr);

    // ── If frozen: render frozen row and skip cards ──
    if (frozen) {
      const frozenObraz = getObrazы?.().find(o => String(o.id) === String(frozen.obrazId)) || activeObraz;

      // ── Shared single-cell avatar runner (used by button + retry) ─────────
      const runSingleAvatar = async (cell, vc, idx) => {
        const videoParams   = getEngineParams?.('kling/ai-avatar-pro') || {};
        const defaultPrompt = videoParams.prompt || 'Natural speaking motion with subtle head movement and relaxed posture';
        const imgPath = cell.imagePath || cell.charImagePath;
        if (!imgPath || !cell.audioPath) return;

        vc.style.display = '';
        vc.innerHTML = '<span style="font-size:8px;color:#888;">⏳</span>';

        const _sid = window.GenLog?.start('Scenarios', '🎭 Talking Head');
        const _actRow = window.createActivityRow?.(`Avatar ${idx + 1}`);
        const _gf = (name, url, body) => window.GenLog && _sid
          ? window.GenLog.fetchLog(_sid, name, url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
          : fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());

        // Step 1: upload image (skip if cached from previous failed attempt)
        let _imgUrl = cell._cachedImgUrl || null;
        if (!_imgUrl) {
          _actRow?.setStatus('📤 Загрузка…');
          const _upR = await _gf('📤 Загрузка изображения', '/api/upload-public', { imagePath: imgPath });
          _imgUrl = _upR?.success ? _upR.url : null;
          if (_imgUrl) cell._cachedImgUrl = _imgUrl;
        }

        // Step 2: build prompt (skip if cached or first cell)
        let prompt = cell._cachedAvatarPrompt || defaultPrompt;
        if (!cell._cachedAvatarPrompt && idx > 0) {
          _actRow?.setStatus('🧠 Промпт…');
          try {
            const pd = await _gf('🧠 Промпт аватара', '/api/audio/avatar-prompt', _imgUrl
              ? { imageUrl: _imgUrl, text: cell.line }
              : { imagePath: imgPath, text: cell.line });
            if (pd.success && pd.prompt) { prompt = pd.prompt; cell._cachedAvatarPrompt = prompt; }
          } catch {}
        }

        const showVideoError = (msg) => {
          cell.videoError = msg || 'Avatar failed';
          delete cell._videoPending; saveEditState();
          vc.innerHTML = '';
          const errSpan = document.createElement('span');
          errSpan.textContent = '❌ Video'; errSpan.style.cssText = 'font-size:8px;color:#aa0000;';
          const retryBtn = document.createElement('button');
          retryBtn.textContent = '↺ Retry';
          retryBtn.title = 'Retry video generation';
          retryBtn.style.cssText = 'font-size:8px;padding:1px 3px;cursor:pointer;display:block;width:100%;margin-top:2px;';
          retryBtn.addEventListener('click', () => runSingleAvatar(cell, vc, idx));
          vc.appendChild(errSpan); vc.appendChild(retryBtn);
          _actRow?.setRetry('🎬 Аватар', () => runSingleAvatar(cell, vc, idx));
          renderMontagePanel(); renderAllTimelines();
        };

        _actRow?.setStatus('🎬 Аватар…');
        try {
          const d = await _gf('🎬 Генерация аватара', '/api/audio/avatar', _imgUrl
            ? { imageUrl: _imgUrl, audioPath: cell.audioPath, prompt, videoParams }
            : { imagePath: imgPath, audioPath: cell.audioPath, prompt, videoParams });
          if (!d.success) throw new Error(d.error);
          // Persist taskId so a tab switch / page reload can resume polling
          cell.avatarTaskId = d.taskId;
          cell._videoPending = true;
          saveEditState();
          const videoPath = await pollAvatar(d.taskId);
          cell.videoPath = videoPath; cell.videoError = null;
          delete cell.avatarTaskId; delete cell._videoPending;
          delete cell._cachedImgUrl; delete cell._cachedAvatarPrompt;
          saveEditState();
          vc.style.display = '';
          vc.innerHTML = '';
          const vid = document.createElement('video');
          vid.controls = true; vid.src = videoPath; vid.style.cssText = 'width:66px;';
          vc.appendChild(vid);
          _actRow?.finalize('✅');
          renderMontagePanel(); renderAllTimelines();
          window.GenLog?.finalize(_sid, 'success');
        } catch (err) {
          window.GenLog?.finalize(_sid, 'error');
          delete cell.avatarTaskId; delete cell._videoPending; saveEditState();
          showVideoError(err.message);
        }
      };

      const frozenRow = buildFrozenRow(frozen, (cellIdx, imgBox, reranBtn) => {
        const cell = frozen.cells[cellIdx];
        if (!cell?.detInfo) return;
        runGen(imgBox, reranBtn, cell.detInfo, `${sessionKey}__${cellIdx}`, true, cellIdx, cell.charImagePath);
      }, frozenObraz, (idx, vc, cell) => runSingleAvatar(cell, vc, idx));
      block.appendChild(frozenRow);

      // ── Define "Говорящая голова" early so голосаPanel rows can reference it ──
      const allHaveAudio = () => frozen.cells.every(c => c.audioPath);
      const говорящаяГоловаBtn = document.createElement('button');
      говорящаяГоловаBtn.textContent = '🗣 Talking head';
      говорящаяГоловаBtn.title = 'Create video avatar (Kling) for each frame';
      говорящаяГоловаBtn.style.cssText = 'margin-top:4px;font-size:10px;padding:3px 8px;cursor:pointer;width:100%;';
      говорящаяГоловаBtn.disabled = !allHaveAudio();

      // ── Голоса collapsible panel ──
      const голосаPanel = document.createElement('div');
      голосаPanel.style.cssText = 'margin-top:4px;';

      const голосаHeader = document.createElement('div');
      голосаHeader.style.cssText = 'display:flex;align-items:center;gap:4px;cursor:pointer;user-select:none;padding:3px 0;border-top:1px solid #c0c0c0;';
      const голосаArrow = document.createElement('span');
      голосаArrow.textContent = '▶'; голосаArrow.style.cssText = 'font-size:9px;color:#555;flex-shrink:0;';
      const голосаLabel = document.createElement('span');
      голосаLabel.style.cssText = 'font-size:10px;font-weight:bold;color:#333;';
      голосаLabel.textContent = 'Voices';
      голосаHeader.appendChild(голосаArrow); голосаHeader.appendChild(голосаLabel);

      const голосаBody = document.createElement('div');
      голосаBody.style.cssText = 'display:none;padding:2px 0;';

      голосаHeader.addEventListener('click', () => {
        const open = голосаBody.style.display === 'none';
        голосаBody.style.display = open ? '' : 'none';
        голосаArrow.textContent = open ? '▼' : '▶';
      });

      // Build one row per cell in the panel
      frozen.cells.forEach((cell, idx) => {
        const rowEl = document.createElement('div');
        rowEl.style.cssText = 'display:flex;align-items:flex-start;gap:4px;margin-bottom:5px;';

        const numEl = document.createElement('span');
        numEl.textContent = idx + 1;
        numEl.style.cssText = 'font-size:9px;color:#808080;min-width:14px;padding-top:5px;flex-shrink:0;';

        const audioArea = document.createElement('div');
        audioArea.style.cssText = 'flex-shrink:0;padding-top:2px;';
        const makeAudioPlayer = (src) => {
          const aud = document.createElement('audio');
          aud.controls = true; aud.src = src;
          aud.style.cssText = 'height:24px;width:110px;';
          return aud;
        };
        if (cell.audioPath) {
          audioArea.appendChild(makeAudioPlayer(cell.audioPath));
        } else if (cell.audioError) {
          audioArea.innerHTML = '<span style="font-size:9px;color:#aa0000;">❌</span>';
        } else {
          audioArea.innerHTML = '<span style="font-size:9px;color:#bbb;">—</span>';
        }
        cell._audioContainer = audioArea;

        const textEl = document.createElement('textarea');
        textEl.value = cell.line;
        textEl.rows = 2;
        textEl.style.cssText = 'flex:1;font-size:9px;resize:vertical;padding:2px 3px;font-family:inherit;min-width:0;';

        const remakeBtn = document.createElement('button');
        remakeBtn.textContent = '↺';
        remakeBtn.title = 'Redo voice for this row';
        remakeBtn.style.cssText = 'flex-shrink:0;width:22px;height:22px;padding:0;font-size:12px;cursor:pointer;';
        remakeBtn.addEventListener('click', async () => {
          const newText = textEl.value.trim() || cell.line;
          audioArea.innerHTML = '<span style="font-size:9px;color:#888;">⏳</span>';
          remakeBtn.disabled = true;
          try {
            const r = await fetch('/api/audio/tts', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text: newText, voice: getProjectVoice(), ttsParams: getEngineParams?.(getAudioEngine?.() || 'elevenlabs/text-to-dialogue-v3') || {}, model: getAudioEngine?.() }),
            });
            const d = await r.json();
            if (!d.success) throw new Error(d.error);
            const audioPath = d.audioPath || await pollTts(d.taskId);
            cell.audioPath = audioPath; delete cell.audioError; saveEditState();
            audioArea.innerHTML = '';
            audioArea.appendChild(makeAudioPlayer(audioPath));
            if (allHaveAudio()) говорящаяГоловаBtn.disabled = false;
          } catch (err) {
            cell.audioError = err.message; saveEditState();
            audioArea.innerHTML = '<span style="font-size:9px;color:#aa0000;">❌</span>';
          } finally {
            remakeBtn.disabled = false;
          }
        });

        rowEl.appendChild(numEl); rowEl.appendChild(audioArea); rowEl.appendChild(textEl); rowEl.appendChild(remakeBtn);
        голосаBody.appendChild(rowEl);
      });

      голосаPanel.appendChild(голосаHeader); голосаPanel.appendChild(голосаBody);
      block.appendChild(голосаPanel);

      // ── Attach говорящаяГоловаBtn click handler ──────────────────────────────
      говорящаяГоловаBtn.addEventListener('click', async () => {
        говорящаяГоловаBtn.disabled = true;
        говорящаяГоловаBtn.textContent = '⏳ Generating video…';

        // Mark cells as pending, switch to Склейка — placeholders show now
        frozen.cells.forEach(cell => { if (cell.audioPath) cell._videoPending = true; });
        renderMontagePanel();
        document.querySelector('#l1-tabs [aria-controls="l1-skleyka"]')?.click();

        let done = 0;
        await Promise.all(frozen.cells.map(async (cell, idx) => {
          if (!cell.audioPath) return;
          const vc = cell._videoContainer;
          await runSingleAvatar(cell, vc || document.createElement('div'), idx);
          if (cell.videoPath) done++;
        }));

        говорящаяГоловаBtn.textContent = done > 0 ? `✓ Video (${done})` : '🗣 Talking head';
        говорящаяГоловаBtn.disabled = false;
        renderAllTimelines();
      });
      block.appendChild(говорящаяГоловаBtn);

      // ── TTS "Голоса" button handler — auto-expands panel, updates audioArea per cell ──
      ttsBtn.disabled = false;
      ttsBtn.addEventListener('click', async () => {
        const voice = getProjectVoice();
        ttsBtn.disabled = true; ttsBtn.textContent = '⏳';
        // Auto-expand the голоса panel to show progress
        голосаBody.style.display = ''; голосаArrow.textContent = '▼';
        await Promise.all(frozen.cells.map(async (cell) => {
          if (cell.audioPath) return;
          const container = cell._audioContainer;
          if (container) container.innerHTML = '<span style="font-size:9px;color:#888;">⏳</span>';

          const showAudioError = () => {
            if (!container) return;
            container.innerHTML = '';
            const errSpan = document.createElement('span');
            errSpan.style.cssText = 'font-size:9px;color:#aa0000;'; errSpan.textContent = '❌';
            const retryBtn = document.createElement('button');
            retryBtn.textContent = '↺'; retryBtn.style.cssText = 'font-size:9px;padding:1px 3px;cursor:pointer;margin-left:3px;';
            retryBtn.addEventListener('click', async () => {
              container.innerHTML = '<span style="font-size:9px;color:#888;">⏳</span>';
              try {
                const r2 = await fetch('/api/audio/tts', {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ text: cell.line, voice: getProjectVoice(), ttsParams: getEngineParams?.(getAudioEngine?.() || 'elevenlabs/text-to-dialogue-v3') || {}, model: getAudioEngine?.() }),
                });
                const d2 = await r2.json();
                if (!d2.success) throw new Error(d2.error);
                const ap = d2.audioPath || await pollTts(d2.taskId);
                cell.audioPath = ap; delete cell.audioError; saveEditState();
                container.innerHTML = '';
                const aud = document.createElement('audio');
                aud.controls = true; aud.src = ap; aud.style.cssText = 'height:24px;width:110px;';
                container.appendChild(aud);
                if (allHaveAudio()) говорящаяГоловаBtn.disabled = false;
              } catch (e2) { cell.audioError = e2.message; saveEditState(); showAudioError(); }
            });
            container.appendChild(errSpan); container.appendChild(retryBtn);
          };

          try {
            const r = await fetch('/api/audio/tts', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text: cell.line, voice, ttsParams: getEngineParams?.(getAudioEngine?.() || 'elevenlabs/text-to-dialogue-v3') || {}, model: getAudioEngine?.() }),
            });
            const d = await r.json();
            if (!d.success) throw new Error(d.error);
            const audioPath = d.audioPath || await pollTts(d.taskId);
            cell.audioPath = audioPath; delete cell.audioError; saveEditState();
            if (container) {
              container.innerHTML = '';
              const aud = document.createElement('audio');
              aud.controls = true; aud.src = audioPath; aud.style.cssText = 'height:24px;width:110px;';
              container.appendChild(aud);
            }
          } catch (err) { cell.audioError = err.message || 'TTS failed'; saveEditState(); showAudioError(); }
        }));
        ttsBtn.disabled = false; ttsBtn.textContent = '🎙';
        if (allHaveAudio()) говорящаяГоловаBtn.disabled = false;
      });

      projectBody.appendChild(block);
      panel.appendChild(projectWrap);
      analyzeBtn.addEventListener('click', () => doAnalyze(analyzeBtn, lines, activeObraz, f, [], sessionData.assignments || {}));
      continue;
    }

    // ── Snapshot current assignments into the session body ────────────────────
    // This ensures образ/предмет pairs survive page refresh, tab switches, and
    // any event that resets the global scenarioAssignments map.
    {
      const snap = {};
      lines.forEach((_, i) => {
        const k = `${f.file}__${i}`;
        const v = scenarioAssignments[k];
        if (v) snap[k] = v;
      });
      if (Object.keys(snap).length > 0) {
        // Only update if global has data (guard against empty-after-reset overwriting)
        sessionData.assignments = { ...(sessionData.assignments || {}), ...snap };
        saveEditState();
      }
    }

    // ── Per-line random image (obraz.char or one of its completed variations) ──
    const lineImages = lines.map(() => pickRandomObrazImage(activeObraz));

    // ── Cards row (pre-generation) ──
    const cardsRow = document.createElement('div');
    cardsRow.style.cssText = 'display:flex;gap:6px;overflow-x:auto;padding-bottom:4px;';

    const cardSelects = [];

    lines.forEach((line, i) => {
      const assignKey  = `${f.file}__${i}`;          // scenario assignment key (scenFile-based)
      const cardKey    = `${sessionKey}__${i}`;       // cache key (session-unique)
      // Read from session body first (persistent), then fall back to global map
      let detFile    = sessionData.assignments?.[assignKey] || scenarioAssignments[assignKey] || null;
      let detailInfo = detFile ? cachedDetailFiles.find(d => d.file === detFile) : null;

      const card = document.createElement('div');
      card.style.cssText = 'flex-shrink:0;width:66px;display:flex;flex-direction:column;align-items:center;gap:2px;';

      const num = document.createElement('div');
      num.style.cssText = 'font-size:9px;color:#808080;line-height:1.4;';
      num.textContent = i + 1;

      const obrazBox = document.createElement('div');
      obrazBox.style.cssText = 'width:62px;height:82px;border:1px solid #808080;background:#ccc;overflow:hidden;flex-shrink:0;cursor:zoom-in;';
      const obrazImg = document.createElement('img');
      obrazImg.dataset.src = lineImages[i];
      obrazImg.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
      const allCharImgs = [activeObraz.char, ...(activeObraz.variations || []).filter(v => v && v !== 'error')].filter(Boolean);
      const charPseudoCell = { imagePath: lineImages[i] };
      obrazImg.addEventListener('click', () => openImagePicker(
        allCharImgs, obrazImg, lineImages[i], selected => {
          lineImages[i] = selected;
          obrazImg.src = selected + '?t=' + Date.now();
          const cellRef = editFrozenSessions[sessionKey]?.cells?.[i];
          if (cellRef) { cellRef.charImagePath = selected; if (!cellRef.detInfo) cellRef.imagePath = selected; saveEditState(); }
        }));
      lazyLoad(obrazImg);
      obrazBox.appendChild(obrazImg);

      const detailBox = document.createElement('div');
      if (detailInfo) {
        detailBox.style.cssText = 'width:62px;height:62px;border:1px solid #808080;background:#ccc;overflow:hidden;flex-shrink:0;cursor:pointer;';
        const detImg = document.createElement('img');
        detImg.dataset.src = detailInfo.thumbPath || detailInfo.path;
        detImg.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
        lazyLoad(detImg);
        detailBox.appendChild(detImg);
      } else {
        detailBox.style.cssText = 'width:62px;height:62px;border:1px dashed #bbb;background:#ebebeb;flex-shrink:0;cursor:pointer;display:flex;align-items:center;justify-content:center;';
        const plusEl = document.createElement('span');
        plusEl.textContent = '+';
        plusEl.style.cssText = 'font-size:22px;color:#bbb;pointer-events:none;';
        detailBox.appendChild(plusEl);
      }
      // Click on detailBox → open item picker (in-place update, no full re-render)
      detailBox.addEventListener('click', () => {
        if (!cachedDetailFiles.length) { setStatus('No items loaded'); return; }
        openDetailPicker(cachedDetailFiles, detailBox, detFile, chosen => {
          const newFile = chosen ? chosen.file : null;
          // Update assignments
          if (newFile) {
            scenarioAssignments[assignKey] = newFile;
          } else {
            delete scenarioAssignments[assignKey];
          }
          _saveAssignmentsToLS();
          saveScenarioAssignments();
          if (sessionData.assignments) {
            if (newFile) { sessionData.assignments[assignKey] = newFile; }
            else { delete sessionData.assignments[assignKey]; }
          }
          saveEditState();

          // Update mutable refs so subsequent clicks see the new state
          detFile    = newFile;
          detailInfo = newFile ? cachedDetailFiles.find(d => d.file === newFile) : null;

          // ── Update detailBox in-place ──────────────────────────────────────
          detailBox.innerHTML = '';
          if (detailInfo) {
            detailBox.style.cssText = 'width:62px;height:62px;border:1px solid #808080;background:#ccc;overflow:hidden;flex-shrink:0;cursor:pointer;';
            const di = document.createElement('img');
            di.src = detailInfo.thumbPath || detailInfo.path;
            di.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
            detailBox.appendChild(di);
          } else {
            detailBox.style.cssText = 'width:62px;height:62px;border:1px dashed #bbb;background:#ebebeb;flex-shrink:0;cursor:pointer;display:flex;align-items:center;justify-content:center;';
            const pl = document.createElement('span');
            pl.textContent = '+';
            pl.style.cssText = 'font-size:22px;color:#bbb;pointer-events:none;';
            detailBox.appendChild(pl);
          }

          // ── Show/hide sel / poseSel / genaBtn ─────────────────────────────
          sel.style.display     = detailInfo ? '' : 'none';
          poseSel.style.display = 'none';
          genaBtn.style.display = detailInfo ? '' : 'none';
          genaBtn.textContent   = 'Gen';
          genaBtn.title         = detailInfo ? 'Generate this image' : '';
          if (detailInfo) {
            genaBtn.onclick = () => {
              const resultBox = document.createElement('div');
              resultBox.style.cssText = 'width:62px;height:82px;border:1px solid #808080;overflow:hidden;flex-shrink:0;';
              obrazBox.replaceWith(resultBox);
              detailBox.remove();
              genaBtn.textContent = '↺';
              genaBtn.title = 'Rerun (random prompt)';
              let firstRun = true;
              const doRun = () => {
                runGen(resultBox, genaBtn, detailInfo, cardKey, !firstRun, i, lineImages[i]);
                firstRun = false;
              };
              genaBtn.onclick = doRun;
              doRun();
            };
          } else {
            genaBtn.onclick = null;
          }

          // Update cardSelects entry so runGen picks the right detFile
          const csEntry = cardSelects.find(s => s.cardKey === cardKey);
          if (csEntry) csEntry.detFile = newFile;
        });
      });

      // Interaction dropdown — only shown when detail is assigned
      const sel = document.createElement('select');
      sel.style.cssText = 'width:66px;font-size:8px;margin-top:1px;' + (detailInfo ? '' : 'display:none;');
      const opts = getMergedOptions(f.file);
      opts.forEach((o, idx) => {
        const opt = document.createElement('option');
        opt.value = idx; opt.textContent = o.label;
        sel.appendChild(opt);
      });
      const savedIdx = cardInteractionSel[cardKey];
      if (savedIdx != null && savedIdx < opts.length) sel.value = savedIdx;
      sel.addEventListener('change', () => { cardInteractionSel[cardKey] = Number(sel.value); });
      cardSelects.push({ sel, detFile, cardKey });

      // Pose dropdown — kept in DOM (hidden) for poseCardKey cache restore logic
      const poseSel = document.createElement('select');
      poseSel.style.cssText = 'width:66px;font-size:8px;margin-top:1px;display:none;';
      EDIT_POSE_OPTIONS.forEach(o => {
        const opt = document.createElement('option');
        opt.value = o.value; opt.textContent = o.label;
        poseSel.appendChild(opt);
      });

      const txt = document.createElement('div');
      txt.style.cssText = 'font-size:8px;color:#444;text-align:center;line-height:1.3;max-width:66px;word-break:break-word;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;';
      txt.textContent = line;

      // ── Gen button ──
      const genaBtn = document.createElement('button');
      genaBtn.textContent = 'Gen';
      genaBtn.style.cssText = 'width:66px;font-size:8px;padding:1px 0;margin-top:1px;cursor:pointer;' + (detailInfo ? '' : 'display:none;');
      genaBtn.title = detailInfo ? 'Generate this image' : '';

      if (detailInfo) {
        // With detail: generate asset interaction
        if (editCardCache[cardKey]) {
          // Restore cached result immediately (survives tab switches)
          const cached = editCardCache[cardKey];
          obrazBox.innerHTML = '';
          obrazBox.style.cssText = 'width:62px;height:82px;border:1px solid #808080;background:#ccc;overflow:hidden;flex-shrink:0;cursor:zoom-in;';
          const cImg = document.createElement('img');
          cImg.dataset.src = cached.imagePath + '?t=' + Date.now();
          cImg.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
          cImg.addEventListener('click', () => {
            const cellRef = editFrozenSessions[sessionKey]?.cells?.[i];
            const fallbackImgs = [activeObraz.char, ...(activeObraz.variations || []).filter(v => v && v !== 'error')].filter(Boolean);
            const targetCell = cellRef || { imagePath: cached.imagePath };
            const imgs = targetCell.generatedImages?.length ? targetCell.generatedImages : fallbackImgs;
            openImagePicker(imgs, cImg, targetCell.imagePath, selected => {
              if (cellRef) { cellRef.imagePath = selected; }
              cImg.src = selected + '?t=' + Date.now();
              editCardCache[cardKey] = { ...(editCardCache[cardKey] || {}), imagePath: selected };
              saveEditState();
            });
          });
          lazyLoad(cImg);
          obrazBox.appendChild(cImg);
          detailBox.style.display = 'none';
          genaBtn.textContent = '↺';
          genaBtn.title = 'Rerun (random prompt)';
          genaBtn.onclick = () => {
            runGen(obrazBox, genaBtn, detailInfo, cardKey, true, i, lineImages[i]);
          };
        } else {
          genaBtn.onclick = () => {
            const resultBox = document.createElement('div');
            resultBox.style.cssText = 'width:62px;height:82px;border:1px solid #808080;overflow:hidden;flex-shrink:0;';
            obrazBox.replaceWith(resultBox);
            detailBox.remove();
            genaBtn.textContent = '↺';
            genaBtn.title = 'Rerun (random prompt)';
            let firstRun = true;
            const doRun = () => {
              runGen(resultBox, genaBtn, detailInfo, cardKey, !firstRun, i, lineImages[i]);
              firstRun = false;
            };
            genaBtn.onclick = doRun;
            doRun();
          };
        }
      } else {
        // Without detail: genaBtn is hidden; keep poseCardKey for cache restore only
        const poseCardKey = `${f.file}__${i}__pose`;
        if (editCardCache[poseCardKey]) {
          const cachedPose = editCardCache[poseCardKey];
          obrazImg.src = cachedPose.imagePath + '?t=' + Date.now();
          obrazImg.style.cursor = 'zoom-in';
          {
            const poseCharImgs = [activeObraz.char, ...(activeObraz.variations || []).filter(v => v && v !== 'error')].filter(Boolean);
            obrazImg.onclick = () => openImagePicker(
              cachedPose.generatedImages?.length ? cachedPose.generatedImages : poseCharImgs,
              obrazImg, cachedPose.imagePath, selected => {
                cachedPose.imagePath = selected;
                obrazImg.src = selected + '?t=' + Date.now();
                editCardCache[poseCardKey] = cachedPose;
                saveEditState();
              });
          }
        }
        // genaBtn is hidden (display:none) — onclick set if user later adds a detail via detailBox
      }

      card.appendChild(num); card.appendChild(obrazBox); card.appendChild(detailBox);
      card.appendChild(sel); card.appendChild(poseSel); card.appendChild(genaBtn); card.appendChild(txt);
      cardsRow.appendChild(card);
    });

    block.appendChild(cardsRow);

    // ── Shared runGen: with retry, freeze update, reran support ──
    async function runGen(imgBox, reranBtn, detInfo, cardKey, useRandomPrompt, cellIdx, charImagePath) {
      const imageEngine = engineSel.value || getImageEngine?.() || 'nano-banana-2';
      const activePath  = charImagePath || activeObraz.char;
      imgBox.style.cssText = 'width:62px;height:82px;border:1px solid #808080;background:#ddd;overflow:hidden;flex-shrink:0;display:flex;align-items:center;justify-content:center;';
      imgBox.innerHTML = '<span style="font-size:9px;color:#888;">⏳</span>';
      if (reranBtn) reranBtn.disabled = true;

      let interactionPrompt = '';
      if (!useRandomPrompt) {
        const selEntry = cardSelects.find(s => s.cardKey === cardKey);
        const selIdx   = selEntry ? Number(selEntry.sel.value) : 0;
        interactionPrompt = getMergedOptions(f.file)[selIdx]?.prompt || '';
      }

      const MAX_RETRIES = 3;
      let lastErr = null;
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          const gr = await fetch('/api/asset-interact/generate', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              activePath, assetPath: detInfo.path,
              prompt: interactionPrompt, assetType: 'detail', imageEngine,
              engineParams: getEngineParams?.(imageEngine) || {},
            }),
          });
          const gd = await gr.json();
          if (!gd.success) throw new Error(gd.error);

          // Persist taskId in cell so a server restart can resume polling
          const sess = editFrozenSessions[sessionKey];
          if (sess && cellIdx != null) {
            sess.cells[cellIdx].taskId = gd.taskId;
            saveEditState();
          }

          const imagePath = await pollTask(gd.taskId);

          // Update frozen session cell
          if (sess && cellIdx != null) {
            const cellRef = sess.cells[cellIdx];
            cellRef.imagePath = imagePath;
            delete cellRef.taskId;
            // Accumulate all generated variants for this cell
            if (!cellRef.generatedImages) cellRef.generatedImages = [];
            if (!cellRef.generatedImages.includes(imagePath)) cellRef.generatedImages.push(imagePath);
          }

          imgBox.innerHTML = '';
          imgBox.style.cssText = 'width:62px;height:82px;border:1px solid #808080;background:#ccc;overflow:hidden;flex-shrink:0;cursor:zoom-in;';
          const img = document.createElement('img');
          img.src = imagePath + '?t=' + Date.now(); // generated now — load immediately, no lazy
          img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
          img.addEventListener('click', () => {
            const cellRef2 = editFrozenSessions[sessionKey]?.cells[cellIdx];
            const imgs2 = cellRef2?.generatedImages?.length ? cellRef2.generatedImages : [imagePath];
            openImagePicker(imgs2, img, cellRef2?.imagePath || imagePath, selected => {
              if (cellRef2) { cellRef2.imagePath = selected; saveEditState(); }
              img.src = selected + '?t=' + Date.now();
            });
          });
          imgBox.appendChild(img);
          editCardCache[cardKey] = { imagePath };
          saveEditState();
          if (reranBtn) reranBtn.disabled = false;
          return; // success
        } catch (err) {
          lastErr = err;
          console.error(`[Edit] Error row ${(cellIdx ?? '?') + 1}, attempt ${attempt}: ${err.message}`);
          setStatus(`Row ${(cellIdx ?? '?') + 1}: attempt ${attempt}/3 — ${err.message}`);
          if (attempt < MAX_RETRIES) await new Promise(r => setTimeout(r, 3000));
        }
      }
      // All retries exhausted
      imgBox.style.cssText = 'width:62px;height:82px;border:1px solid #808080;background:#ddd;overflow:hidden;flex-shrink:0;display:flex;align-items:center;justify-content:center;';
      imgBox.innerHTML = '<span style="font-size:8px;color:#aa0000;text-align:center;padding:2px;">Error</span>';
      if (reranBtn) reranBtn.disabled = false;
    }

    // ── Анализировать handler ──
    analyzeBtn.addEventListener('click', () => doAnalyze(analyzeBtn, lines, activeObraz, f, cardSelects, sessionData.assignments || {}));

    // ── Генерировать handler ──
    generateBtn.addEventListener('click', async () => {
      generateBtn.disabled = true; generateBtn.textContent = '⏳';
      resetBtn.style.display = '';

      // Freeze session immediately
      const sessionCells = lines.map((line, i) => {
        const assignKey2 = `${f.file}__${i}`;
        const detFile = scenarioAssignments[assignKey2] || null;
        const detInfo = detFile ? cachedDetailFiles.find(d => d.file === detFile) : null;
        return { line, detInfo, charImagePath: lineImages[i], imagePath: detInfo ? null : lineImages[i] };
      });
      editFrozenSessions[sessionKey] = { lines, cells: sessionCells, generating: true, done: false, date: sessionData.date || new Date().toISOString(), scenFile: f.file, obrazId: String(activeObraz.id) };
      saveEditState();   // persist immediately so restart can detect this session

      // Build results row
      const resultsRow = document.createElement('div');
      resultsRow.style.cssText = 'display:flex;gap:6px;overflow-x:auto;padding-bottom:4px;';

      const jobs = [];
      sessionCells.forEach((cell, i) => {
        const c = document.createElement('div');
        c.style.cssText = 'flex-shrink:0;width:66px;display:flex;flex-direction:column;align-items:center;gap:2px;';
        const num = document.createElement('div');
        num.style.cssText = 'font-size:9px;color:#808080;line-height:1.4;';
        num.textContent = i + 1;
        const imgBox = document.createElement('div');
        imgBox.style.cssText = 'width:62px;height:82px;border:1px solid #808080;overflow:hidden;flex-shrink:0;';
        cell._imgBox = imgBox;

        let reranBtn = null;
        if (!cell.detInfo) {
          imgBox.style.cssText += 'background:#ccc;cursor:zoom-in;';
          const img = document.createElement('img');
          img.src = cell.imagePath;
          img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
          img.addEventListener('click', () => openImagePicker(
            cell.generatedImages?.length ? cell.generatedImages : [cell.imagePath],
            img, cell.imagePath, selected => {
              cell.imagePath = selected;
              img.src = selected + '?t=' + Date.now();
              saveEditState();
            }));
          imgBox.appendChild(img);
        } else {
          reranBtn = document.createElement('button');
          reranBtn.textContent = '↺'; reranBtn.title = 'Rerun (random prompt)';
          reranBtn.style.cssText = 'width:66px;font-size:9px;padding:1px 0;margin-top:1px;cursor:pointer;display:none;';
          reranBtn.addEventListener('click', () => runGen(imgBox, reranBtn, cell.detInfo, `${sessionKey}__${i}`, true, i, cell.charImagePath));
          cell._reranBtn = reranBtn;
          jobs.push({ imgBox, reranBtn, detInfo: cell.detInfo, cardKey: `${sessionKey}__${i}`, cellIdx: i, charImagePath: cell.charImagePath });
        }

        const txt = document.createElement('div');
        txt.style.cssText = 'font-size:8px;color:#444;text-align:center;line-height:1.3;max-width:66px;word-break:break-word;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;';
        txt.textContent = cell.line;
        c.appendChild(num); c.appendChild(imgBox);
        if (reranBtn) c.appendChild(reranBtn);
        c.appendChild(txt);
        resultsRow.appendChild(c);
      });

      cardsRow.replaceWith(resultsRow);
      setStatus('Generating…');

      let done = 0;
      await Promise.all(jobs.map(({ imgBox, reranBtn, detInfo, cardKey, cellIdx, charImagePath }) =>
        runGen(imgBox, reranBtn, detInfo, cardKey, false, cellIdx, charImagePath).then(() => {
          if (reranBtn) reranBtn.style.display = 'block';
          done++;
          setStatus(`Generating: ${done}/${jobs.length}`);
        })
      ));

      editFrozenSessions[sessionKey].generating = false;
      editFrozenSessions[sessionKey].done = true;
      saveEditState();
      setStatus('Generation complete.');
      playCompletionSound?.();
      generateBtn.disabled = false; generateBtn.textContent = '▶';
      await renderEditPanel();
    });

    projectBody.appendChild(block);
    panel.appendChild(projectWrap);
  } // end for combos

  // ── Archived projects section ─────────────────────────────────────────────
  const archiveList = loadEditArchive();
  if (archiveList.length) {
    const archSec = document.createElement('div');
    archSec.style.cssText = 'margin-top:12px;border-top:1px solid #808080;padding-top:6px;';

    const archToggle = document.createElement('div');
    archToggle.style.cssText =
      'display:flex;align-items:center;gap:6px;cursor:pointer;user-select:none;margin-bottom:4px;';
    const archArrow = document.createElement('span');
    archArrow.textContent = '▶';
    archArrow.style.cssText = 'font-size:9px;color:#555;flex-shrink:0;';
    const archLabel = document.createElement('span');
    archLabel.style.cssText = 'font-size:10px;font-weight:bold;color:#555;';
    archLabel.textContent = `Project archive (${archiveList.length})`;
    archToggle.appendChild(archArrow);
    archToggle.appendChild(archLabel);

    const archBody = document.createElement('div');
    archBody.style.cssText = 'display:none;';
    archToggle.addEventListener('click', () => {
      const open = archBody.style.display === 'none';
      archBody.style.display = open ? '' : 'none';
      archArrow.textContent = open ? '▼' : '▶';
    });

    archiveList.forEach(item => {
      const row = document.createElement('div');
      row.style.cssText =
        'display:flex;align-items:center;gap:6px;padding:3px 0;border-bottom:1px solid #d0d0d0;';

      if (item.obrazChar) {
        const thumbImg = document.createElement('img');
        thumbImg.src = item.obrazChar;
        thumbImg.style.cssText =
          'width:30px;height:40px;object-fit:cover;flex-shrink:0;border:1px solid #808080;';
        thumbImg.onerror = () => { thumbImg.style.display = 'none'; };
        row.appendChild(thumbImg);
      }

      const dateStr = new Date(item.date).toLocaleDateString('ru-RU',
        { day: '2-digit', month: '2-digit', year: 'numeric' });
      const textEl = document.createElement('span');
      textEl.style.cssText =
        'flex:1;font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#444;';
      textEl.textContent = `${dateStr} — ${item.scenName} — ${item.obrazName}`;
      textEl.title = textEl.textContent;
      row.appendChild(textEl);

      const restoreBtn = document.createElement('button');
      restoreBtn.textContent = '↩ restore';
      restoreBtn.style.cssText = 'font-size:9px;padding:1px 6px;cursor:pointer;flex-shrink:0;';
      restoreBtn.addEventListener('click', () => {
        if (item.session) {
          editFrozenSessions[item.sessionKey] = item.session;
          saveEditState();
        }
        saveEditArchive(loadEditArchive().filter(a => a.id !== item.id));
        renderEditPanel();
      });
      row.appendChild(restoreBtn);

      archBody.appendChild(row);
    });

    archSec.appendChild(archToggle);
    archSec.appendChild(archBody);
    panel.appendChild(archSec);
  }
}

// ── Shared analyze handler ────────────────────────────────────────────────────
// sessionAssignments: the assignments stored in the session body (primary source).
// Falls back to the global scenarioAssignments map for any key not found there.
async function doAnalyze(analyzeBtn, lines, activeObraz, f, cardSelects, sessionAssignments = {}) {
  analyzeBtn.disabled = true; analyzeBtn.textContent = '⏳';
  setStatus('Analyzing interactions…');
  const uniqueDetails = [...new Set(
    lines.map((_, i) => {
      const k = `${f.file}__${i}`;
      return sessionAssignments[k] || scenarioAssignments[k];
    }).filter(Boolean)
  )];
  console.log('[doAnalyze] f.file:', f.file, '| uniqueDetails:', uniqueDetails, '| sessionAssignments:', sessionAssignments, '| scenarioAssignments:', scenarioAssignments);
  if (!uniqueDetails.length) {
    setStatus('No assigned items to analyze.');
    analyzeBtn.disabled = false; analyzeBtn.textContent = '🔍'; return;
  }
  // Reset scenario-level cache so re-analysis always gives fresh results
  delete analysisCache[f.file];
  try {
    const newVariants = [];
    for (const detFile of uniqueDetails) {
      // Always call the API (ignore detFile cache) — user explicitly requested analysis
      const detInfo = cachedDetailFiles.find(d => d.file === detFile);
      if (!detInfo) continue;
      const r = await fetch('/api/scenarios/analyze', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activePath: activeObraz.char, assetPath: detInfo.path, assetSize: detInfo.size || '' }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error);
      analysisCache[detFile] = d.variants;
      _saveAnalysisCache();
      newVariants.push(...d.variants);
    }
    // Deduplicate by label across multiple detail files
    const seen = new Set();
    const fresh = newVariants.filter(v => { if (seen.has(v.label)) return false; seen.add(v.label); return true; });
    analysisCache[f.file] = fresh;
    _saveAnalysisCache();

    const merged = getMergedOptions(f.file);
    // Update live select elements (may be detached if panel was re-rendered — harmless)
    cardSelects.forEach(({ sel }) => {
      if (!sel.isConnected) return; // skip detached elements
      const curVal = Number(sel.value);
      while (sel.options.length > DEFAULT_INTERACTIONS.length) sel.remove(DEFAULT_INTERACTIONS.length);
      merged.slice(DEFAULT_INTERACTIONS.length).forEach((o, idx) => {
        const opt = document.createElement('option');
        opt.value = DEFAULT_INTERACTIONS.length + idx; opt.textContent = o.label;
        sel.appendChild(opt);
      });
      sel.value = curVal < merged.length ? curVal : 0;
    });
    setStatus(`Added variations: ${fresh.length}`);
  } catch (err) {
    setStatus('Analysis error: ' + err.message);
  } finally {
    analyzeBtn.disabled = false; analyzeBtn.textContent = '🔍';
  }
}

// ── Poll task until success/failed ────────────────────────────────────────────
async function pollTask(taskId, intervalMs = 3000, maxAttempts = 120) {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, intervalMs));
    const r = await fetch(`/api/asset-interact/status/${taskId}`);
    const d = await r.json();
    if (d.state === 'success') return d.imagePath;
    if (d.state === 'failed')  throw new Error(d.error || 'failed');
  }
  throw new Error('Generation timeout');
}

async function pollTts(taskId, intervalMs = 3000, maxAttempts = 120) {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, intervalMs));
    const r = await fetch(`/api/audio/tts/status/${taskId}`);
    const d = await r.json();
    if (d.state === 'success') return d.audioPath;
    if (d.state === 'failed')  throw new Error(d.error || 'TTS failed');
  }
  throw new Error('TTS timeout');
}

async function pollAvatar(taskId, intervalMs = 5000, maxAttempts = 120) {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, intervalMs));
    const r = await fetch(`/api/audio/avatar/status/${taskId}`);
    const d = await r.json();
    if (d.state === 'success') return d.videoPath;
    if (d.state === 'failed')  throw new Error(d.error || 'Avatar failed');
  }
  throw new Error('Avatar timeout');
}

// ── Video lightbox ─────────────────────────────────────────────────────────────
function openVideoLightbox(src) {
  let lb = document.getElementById('scen-video-lb');
  if (!lb) {
    lb = document.createElement('div');
    lb.id = 'scen-video-lb';
    lb.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.88);z-index:9999;align-items:center;justify-content:center;flex-direction:column;gap:12px;';
    lb.innerHTML = '<video id="scen-video-lb-el" controls style="max-width:90vw;max-height:80vh;display:block;background:#000;"></video><button style="padding:6px 24px;font-size:13px;cursor:pointer;">Close</button>';
    lb.addEventListener('click', e => {
      if (e.target === lb || e.target.tagName === 'BUTTON') {
        lb.style.display = 'none';
        const vid = lb.querySelector('video');
        vid.pause(); vid.src = '';
      }
    });
    document.body.appendChild(lb);
  }
  lb.querySelector('#scen-video-lb-el').src = src;
  lb.style.display = 'flex';
}

// ── Монтаж panel — теперь алиас renderAllTimelines (монтаж встроен в таймлайн) ─
function renderMontagePanel() { renderAllTimelines(); }

// Derive thumbnail path: /uploads/foo.jpg → /uploads/thumbs/foo.jpg (with fallback)
function _toThumb(p) {
  if (!p) return p;
  return p.replace(/^(\/uploads\/)(?!thumbs\/)([^/]+)$/, '$1thumbs/$2');
}
function _imgWithThumb(src, fallback) {
  const img = document.createElement('img');
  const thumb = _toThumb(src);
  img.src = thumb || src;
  if (thumb && thumb !== src) {
    img.onerror = () => { img.src = fallback || src; img.onerror = null; };
  } else {
    img.onerror = () => { img.style.display = 'none'; img.onerror = null; };
  }
  return img;
}

// Make a video-poster thumbnail: shows first frame, click opens lightbox
function _videoThumb(videoPath, cssText, onClickFn) {
  const v = document.createElement('video');
  v.src = videoPath + '#t=0.1';
  v.muted = true;
  v.preload = 'metadata';
  v.style.cssText = cssText;
  v.style.cursor = 'pointer';
  v.title = '▶ Watch video';
  if (onClickFn) v.addEventListener('click', e => { e.stopPropagation(); onClickFn(); });
  return v;
}

// ── Biroly timeline bar: fill (or re-fill) a bar element ─────────────────────
function _fillBirolyBar(bBar, sessionKey, totalDur) {
  bBar.innerHTML = '';
  const archive  = typeof getBirolyArchive === 'function' ? getBirolyArchive() : [];
  const tlData   = getTimelineData();
  const sessData = tlData[sessionKey] || {};
  const activated = sessData.activated || [];
  const bTimings  = sessData.timings   || {};

  activated.forEach(idx => {
    const b = archive[idx];
    const t = bTimings[idx];
    if (!b || !t || t.start === undefined) return;

    const startVal = parseFloat(t.start);
    const endVal   = parseFloat(t.end);
    const cropVal  = parseFloat(t.crop) || 0;
    if (isNaN(startVal) || isNaN(endVal) || endVal <= startVal) return;

    const duration  = endVal - startVal;          // clip duration stays fixed during drag
    const cropStart = Math.max(0, startVal - cropVal);
    const blockLeft  = cropStart / totalDur * 100;
    const blockWidth = (endVal - cropStart) / totalDur * 100;
    const cropFrac   = (blockWidth > 0 && (startVal - cropStart) > 0)
      ? ((startVal - cropStart) / (endVal - cropStart) * 100) : 0;

    const block = document.createElement('div');
    block.style.cssText = `position:absolute;left:${blockLeft.toFixed(3)}%;width:${Math.max(blockWidth, 0.3).toFixed(3)}%;height:100%;box-sizing:border-box;overflow:hidden;border-radius:2px;cursor:grab;`;
    block.title = `${b.name || 'Birol'}\nfrom: ${startVal.toFixed(2)}s  to: ${endVal.toFixed(2)}s  crop: ${cropVal.toFixed(2)}s\nDrag to reposition`;

    if (cropFrac > 0) {
      const cropPart = document.createElement('div');
      cropPart.style.cssText = `position:absolute;left:0;width:${cropFrac.toFixed(3)}%;height:100%;background:#666;filter:grayscale(1);border-right:2px dashed #aaa;box-sizing:border-box;`;
      block.appendChild(cropPart);
    }

    const color = TL_COLORS[idx % TL_COLORS.length];
    const activePart = document.createElement('div');
    activePart.style.cssText = `position:absolute;left:${cropFrac.toFixed(3)}%;width:${(100 - cropFrac).toFixed(3)}%;height:100%;background:${color};box-sizing:border-box;display:flex;align-items:center;overflow:hidden;`;
    activePart.innerHTML = `<span style="font-size:7px;color:#fff;font-weight:bold;padding:0 2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;pointer-events:none;">${b.name || 'B'}</span>`;
    block.appendChild(activePart);

    // ── Drag to reposition ──────────────────────────────────────────────────
    block.addEventListener('mousedown', e => {
      e.preventDefault();
      const barRect  = bBar.getBoundingClientRect();
      const origLeft = cropStart;   // seconds from bar start to block left edge
      const startX   = e.clientX;

      block.style.cursor = 'grabbing';
      document.body.style.userSelect = 'none';

      const onMove = ev => {
        const deltaX   = ev.clientX - startX;
        const deltaSec = deltaX / barRect.width * totalDur;
        // Clamp: block left edge ≥ 0, block right edge ≤ totalDur
        const newCropStart = Math.max(0, Math.min(origLeft + deltaSec, totalDur - (endVal - cropStart)));
        const newStart     = newCropStart + cropVal;
        const newEnd       = newStart + duration;
        // Move block visually
        block.style.left = (newCropStart / totalDur * 100).toFixed(3) + '%';
        block.title = `${b.name || 'Birol'}\nfrom: ${newStart.toFixed(2)}s  to: ${newEnd.toFixed(2)}s  crop: ${cropVal.toFixed(2)}s`;
      };

      const onUp = ev => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        block.style.cursor = 'grab';
        document.body.style.userSelect = '';

        // Final position
        const deltaX   = ev.clientX - startX;
        const deltaSec = deltaX / barRect.width * totalDur;
        const newCropStart = Math.max(0, Math.min(origLeft + deltaSec, totalDur - (endVal - cropStart)));
        const newStart     = parseFloat((newCropStart + cropVal).toFixed(2));
        const newEnd       = parseFloat((newStart + duration).toFixed(2));

        // Save to localStorage
        const d = getTimelineData();
        if (!d[sessionKey]) d[sessionKey] = {};
        if (!d[sessionKey].timings) d[sessionKey].timings = {};
        d[sessionKey].timings[idx] = { crop: cropVal.toFixed(2), start: newStart.toFixed(2), end: newEnd.toFixed(2) };
        setTimelineData(d);

        // Re-render right column — re-sorts active birolys by new start time
        window.refreshTimelineBirolys?.();
        // Re-render bar (refreshTimelineBirolys → renderSessionBirolys → refreshBirolyBars covers it,
        // but call directly too in case the column isn't in DOM yet)
        _fillBirolyBar(bBar, sessionKey, totalDur);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    bBar.appendChild(block);
  });
}

// Refresh only biroly bars already in DOM (fast, no async) ────────────────────
function refreshBirolyBars() {
  document.querySelectorAll('.timeline-biroly-bar[data-session-key]').forEach(el => {
    const totalDur = parseFloat(el.dataset.totalDur) || 0;
    if (totalDur > 0) _fillBirolyBar(el, el.dataset.sessionKey, totalDur);
  });
}
window.refreshBirolyBars = refreshBirolyBars;

// ── Build video fragments strip for one session (used inside timeline row) ────
function _buildFragStrip(session, sessionKey, opts = {}) {
  const excludedSet = opts.excludedSet || new Set();
  const fragRow = document.createElement('div');
  fragRow.style.cssText = 'display:flex;gap:8px;overflow-x:auto;padding-bottom:6px;margin-bottom:8px;border-bottom:1px solid #a0a0a0;';

  // Build ordered list: non-excluded first, excluded at end (greyed)
  const cellOrder = [];
  session.cells.forEach((cell, idx) => {
    if (!cell.videoPath && !cell.videoError && !cell._videoPending && !cell.avatarTaskId) return;
    cellOrder.push({ cell, idx, excluded: excludedSet.has(idx) });
  });
  cellOrder.sort((a, b) => (a.excluded ? 1 : 0) - (b.excluded ? 1 : 0));

  cellOrder.forEach(({ cell, idx, excluded }) => {
    const imgPath = cell.thumbPath || cell.imagePath || cell.charImagePath;

    const frag = document.createElement('div');
    frag.style.cssText = 'flex-shrink:0;width:88px;display:flex;flex-direction:column;align-items:center;gap:3px;' + (excluded ? 'opacity:0.35;filter:grayscale(1);' : '');

    const numEl = document.createElement('div');
    numEl.style.cssText = 'font-size:8px;color:#808080;align-self:flex-start;';
    numEl.textContent = idx + 1;

    const thumbBox = document.createElement('div');
    thumbBox.style.cssText = `width:86px;height:115px;border:1px solid #808080;overflow:hidden;background:#1a1a1a;flex-shrink:0;cursor:${cell.videoPath ? 'pointer' : 'default'};position:relative;`;
    if (imgPath) {
      const img = _imgWithThumb(imgPath, cell.imagePath || cell.charImagePath);
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
      // If image fails entirely, fall back to video first-frame
      img.addEventListener('error', () => {
        if (cell.videoPath && img.parentNode) {
          const vt = _videoThumb(cell.videoPath, 'width:100%;height:100%;object-fit:cover;display:block;', () => openVideoLightbox(cell.videoPath));
          img.parentNode.replaceChild(vt, img);
        }
      }, { once: true });
      thumbBox.appendChild(img);
    } else if (cell.videoPath) {
      // No image at all — show video first-frame directly
      const vt = _videoThumb(cell.videoPath, 'width:100%;height:100%;object-fit:cover;display:block;', () => openVideoLightbox(cell.videoPath));
      thumbBox.appendChild(vt);
    }
    if (cell._videoPending || cell.avatarTaskId) {
      const ov = document.createElement('div');
      ov.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;';
      ov.innerHTML = '<span style="color:#fff;font-size:18px;">⏳</span>';
      thumbBox.appendChild(ov);
    } else if (cell.videoPath) {
      thumbBox.title = 'Click to watch video';
      const playOv = document.createElement('div');
      playOv.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity 0.15s;background:rgba(0,0,0,0.3);';
      playOv.innerHTML = '<span style="color:#fff;font-size:24px;">▶</span>';
      thumbBox.appendChild(playOv);
      thumbBox.addEventListener('mouseenter', () => { playOv.style.opacity = '1'; });
      thumbBox.addEventListener('mouseleave', () => { playOv.style.opacity = '0'; });
      thumbBox.addEventListener('click', () => openVideoLightbox(cell.videoPath));
    } else if (cell.videoError) {
      const errOv = document.createElement('div');
      errOv.style.cssText = 'position:absolute;inset:0;background:rgba(170,0,0,0.35);display:flex;align-items:center;justify-content:center;';
      errOv.innerHTML = '<span style="color:#fff;font-size:18px;">❌</span>';
      thumbBox.appendChild(errOv);
    }

    const statusArea = document.createElement('div');
    statusArea.style.cssText = 'width:86px;';

    if (cell.videoPath) {
      const playBtn = document.createElement('button');
      playBtn.textContent = '▶';
      playBtn.style.cssText = 'width:86px;font-size:9px;padding:2px 0;cursor:pointer;';
      playBtn.addEventListener('click', () => openVideoLightbox(cell.videoPath));
      statusArea.appendChild(playBtn);
    } else if (cell._videoPending || cell.avatarTaskId) {
      const d = document.createElement('div');
      d.style.cssText = 'font-size:8px;color:#666;text-align:center;padding:2px 0;';
      d.textContent = '⏳ Generating…';
      statusArea.appendChild(d);
    } else if (cell.videoError) {
      const retryBtn = document.createElement('button');
      retryBtn.textContent = '↺';
      retryBtn.title = 'Retry generation';
      retryBtn.style.cssText = 'width:86px;font-size:9px;padding:2px 0;cursor:pointer;';
      retryBtn.addEventListener('click', async () => {
        if (!cell.audioPath || !imgPath) return;
        retryBtn.disabled = true;
        cell._videoPending = true; delete cell.videoError;
        renderAllTimelines();
        try {
          const videoParams = getEngineParams?.('kling/ai-avatar-pro') || {};
          const defaultPrompt = videoParams.prompt || 'Natural speaking motion with subtle head movement and relaxed posture';
          let prompt = defaultPrompt;
          let _imgUrl = null;
          try {
            const _ur = await fetch('/api/upload-public', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imagePath: imgPath }) });
            const _ud = await _ur.json();
            if (_ud.success) _imgUrl = _ud.url;
          } catch {}
          if (idx > 0) {
            try {
              const pr = await fetch('/api/audio/avatar-prompt', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(_imgUrl ? { imageUrl: _imgUrl, text: cell.line } : { imagePath: imgPath, text: cell.line }),
              });
              const pd = await pr.json();
              if (pd.success && pd.prompt) prompt = pd.prompt;
            } catch {}
          }
          const r = await fetch('/api/audio/avatar', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(_imgUrl
              ? { imageUrl: _imgUrl, audioPath: cell.audioPath, prompt, videoParams }
              : { imagePath: imgPath, audioPath: cell.audioPath, prompt, videoParams }),
          });
          const d = await r.json();
          if (!d.success) throw new Error(d.error);
          cell.avatarTaskId = d.taskId; saveEditState();
          const videoPath = await pollAvatar(d.taskId);
          cell.videoPath = videoPath; cell.videoError = null;
          delete cell.avatarTaskId;
        } catch (err) {
          cell.videoError = err.message || 'Avatar failed';
          delete cell.avatarTaskId;
        }
        delete cell._videoPending; saveEditState(); renderAllTimelines();
      });
      statusArea.appendChild(retryBtn);
    }

    frag.appendChild(numEl); frag.appendChild(thumbBox); frag.appendChild(statusArea);
    fragRow.appendChild(frag);
  });

  return fragRow;
}

// ── Helper: get audio duration via Audio element ──────────────────────────────
function getAudioDuration(src) {
  return new Promise(resolve => {
    const a = new Audio(src);
    a.addEventListener('loadedmetadata', () => resolve(a.duration || 0), { once: true });
    a.addEventListener('error', () => resolve(0), { once: true });
    a.load();
  });
}

// ── Timeline timings: { [sessionKey]: { [birolyIdx]: { start, end } } } ────────
// Source of truth for WHICH birolys to show is always getActiveBirolyIdxs() order.
// This store holds only the start/end values entered by the user,
// plus a per-session "excluded" set for birolys removed with ×.
const TIMELINE_DATA_KEY    = 'timeline_data_v2';
const BIROLY_DEFAULTS_KEY  = 'biroly_defaults_v1';
function getTimelineData()  { try { return JSON.parse(localStorage.getItem(TIMELINE_DATA_KEY)   || '{}'); } catch { return {}; } }
function setTimelineData(d) { localStorage.setItem(TIMELINE_DATA_KEY, JSON.stringify(d)); }
function getBirolyDefaults()  { try { return JSON.parse(localStorage.getItem(BIROLY_DEFAULTS_KEY) || '{}'); } catch { return {}; } }
function setBirolyDefaults(d) { localStorage.setItem(BIROLY_DEFAULTS_KEY, JSON.stringify(d)); }

// ── Audio library (music + sfx uploaded by user) ─────────────────────────────
const AUDIO_LIB_KEY = 'audio_library_v1';
function getAudioLib()    { try { return JSON.parse(localStorage.getItem(AUDIO_LIB_KEY) || '[]'); } catch { return []; } }
function saveAudioLib(lib){ localStorage.setItem(AUDIO_LIB_KEY, JSON.stringify(lib)); }

// ── makeMusicControl(sessionKey, tlData, getVideoDur) ────────────────────────
// Returns { el, getUrl, getOffset, getVolume, setSaveCallback }
function makeMusicControl(sessionKey, tlData, getVideoDur) {
  const sd = tlData[sessionKey] || {};
  let currentUrl    = sd.music        || 'None';
  let currentOffset = parseFloat(sd.musicOffset) || 0;
  let currentVolume = (sd.musicVolume != null && !isNaN(sd.musicVolume)) ? parseFloat(sd.musicVolume) : 0.1;
  let _saveCallback = null;

  function _saveTl(patch) {
    const d = getTimelineData();
    if (!d[sessionKey]) d[sessionKey] = {};
    Object.assign(d[sessionKey], patch);
    setTimelineData(d);
  }

  const wrap = document.createElement('div');
  wrap.className = 'audio-ctrl-wrap';

  // ── Row 1: label + dropdown + del button ─────────────────────────────────
  const row1 = document.createElement('div');
  row1.className = 'audio-ctrl-row';
  const lbl = document.createElement('span');
  lbl.className = 'audio-ctrl-lbl';
  lbl.textContent = 'Music:';
  const sel = document.createElement('select');
  sel.className = 'audio-ctrl-sel';
  const delBtn = document.createElement('button');
  delBtn.className = 'audio-del-btn'; delBtn.textContent = '🗑'; delBtn.title = 'Delete from library';

  function _rebuildSel() {
    const lib = getAudioLib().filter(x => x.type === 'music');
    sel.innerHTML = '';
    ['None', 'Random'].forEach(v => { const o = document.createElement('option'); o.value = v; o.textContent = v; sel.appendChild(o); });
    lib.forEach(item => { const o = document.createElement('option'); o.value = item.webPath; o.textContent = item.name; sel.appendChild(o); });
    sel.value = currentUrl;
  }
  _rebuildSel();
  row1.appendChild(lbl); row1.appendChild(sel); row1.appendChild(delBtn);
  wrap.appendChild(row1);

  // ── Upload row (analogous to SFX) ────────────────────────────────────────
  const musicUpRow = document.createElement('div');
  musicUpRow.className = 'audio-upload-row';
  const musicFileInp = document.createElement('input');
  musicFileInp.type = 'file'; musicFileInp.accept = 'audio/*';
  const musicNameInp = document.createElement('input');
  musicNameInp.type = 'text'; musicNameInp.placeholder = 'Name…'; musicNameInp.maxLength = 60;
  const musicUpBtn = document.createElement('button');
  musicUpBtn.className = 'audio-upload-btn'; musicUpBtn.textContent = '⬆ Upload';

  musicFileInp.addEventListener('change', () => {
    if (musicFileInp.files[0] && !musicNameInp.value) musicNameInp.value = musicFileInp.files[0].name.replace(/\.[^.]+$/, '').slice(0, 40);
  });

  musicUpBtn.addEventListener('click', async () => {
    if (!musicFileInp.files[0]) return;
    musicUpBtn.disabled = true; musicUpBtn.textContent = '…';
    try {
      const fd = new FormData();
      fd.append('file', musicFileInp.files[0]);
      if (musicNameInp.value) fd.append('name', musicNameInp.value);
      const r = await fetch('/api/audio/upload-file', { method: 'POST', body: fd });
      const d = await r.json();
      if (!d.success) throw new Error(d.error);
      const lib = getAudioLib();
      lib.push({ id: Date.now().toString(), name: d.name, webPath: d.webPath, type: 'music', addedAt: new Date().toISOString() });
      saveAudioLib(lib);
      _rebuildSel();
      sel.value = d.webPath;
      _applyUrl(d.webPath);
      musicFileInp.value = ''; musicNameInp.value = '';
    } catch (e) { alert('Upload error: ' + e.message); }
    finally { musicUpBtn.disabled = false; musicUpBtn.textContent = '⬆ Upload'; }
  });

  musicUpRow.appendChild(musicFileInp); musicUpRow.appendChild(musicNameInp); musicUpRow.appendChild(musicUpBtn);
  wrap.appendChild(musicUpRow);

  // ── Collapsible details panel ─────────────────────────────────────────────
  const details = document.createElement('details');
  details.className = 'audio-details';
  const summary = document.createElement('summary');
  summary.className = 'audio-details-summary';
  summary.textContent = 'Settings…';
  details.appendChild(summary);

  // ── Native audio player ───────────────────────────────────────────────────
  const player = document.createElement('audio');
  player.className = 'audio-player'; player.controls = true; player.preload = 'metadata';
  details.appendChild(player);

  // ── Timeline bar with video projection ───────────────────────────────────
  const barOuter = document.createElement('div');
  barOuter.className = 'audio-bar-outer';

  // ruler: left label (0s), right label (vidDur)
  const rulerRow = document.createElement('div');
  rulerRow.className = 'audio-bar-ruler';
  const rulerLeft  = document.createElement('span'); rulerLeft.textContent = '0s';
  const rulerRight = document.createElement('span');
  rulerRow.appendChild(rulerLeft); rulerRow.appendChild(rulerRight);
  barOuter.appendChild(rulerRow);

  // bar track
  const barWrap = document.createElement('div');
  barWrap.className = 'audio-music-bar-wrap';
  barWrap.title = 'Drag to shift';
  const bar    = document.createElement('div'); bar.className = 'audio-music-bar';
  const barLbl = document.createElement('div'); barLbl.className = 'audio-music-bar-lbl';
  // video duration overlay (shows exactly 0→vidDur as a faint region)
  const vidOverlay = document.createElement('div'); vidOverlay.className = 'audio-vid-overlay';
  barWrap.appendChild(vidOverlay);
  barWrap.appendChild(bar);
  barWrap.appendChild(barLbl);
  barOuter.appendChild(barWrap);
  details.appendChild(barOuter);

  // ── Offset + Volume row ───────────────────────────────────────────────────
  const paramsRow = document.createElement('div');
  paramsRow.className = 'audio-params-row';

  const offInp = document.createElement('input');
  offInp.type = 'number'; offInp.min = '0'; offInp.step = '0.1'; offInp.value = currentOffset.toFixed(1);
  offInp.style.cssText = 'width:46px;font-size:10px;padding:1px 3px;border:1px solid #bbb;border-radius:2px;';
  const offWrap = document.createElement('label');
  offWrap.style.cssText = 'display:flex;align-items:center;gap:3px;font-size:9px;color:#666;';
  offWrap.textContent = 'Start:'; offWrap.appendChild(offInp);
  const offSuf = document.createElement('span'); offSuf.textContent = 's'; offSuf.style.cssText = 'font-size:9px;color:#888;';

  const volInp = document.createElement('input');
  volInp.type = 'range'; volInp.min = '0'; volInp.max = '1'; volInp.step = '0.05'; volInp.value = currentVolume; volInp.style.width = '68px';
  const volVal = document.createElement('span'); volVal.textContent = currentVolume.toFixed(2); volVal.style.cssText = 'font-size:9px;color:#666;min-width:24px;';
  const volWrap = document.createElement('label');
  volWrap.style.cssText = 'display:flex;align-items:center;gap:3px;font-size:9px;color:#666;';
  volWrap.textContent = 'Vol:'; volWrap.appendChild(volInp);

  // Save button
  const saveBtn = document.createElement('button');
  saveBtn.className = 'audio-save-btn'; saveBtn.textContent = '💾'; saveBtn.title = 'Save parameters and update renderBody';

  paramsRow.appendChild(offWrap); paramsRow.appendChild(offSuf);
  paramsRow.appendChild(volWrap); paramsRow.appendChild(volVal);
  paramsRow.appendChild(saveBtn);
  details.appendChild(paramsRow);

  // ── Update bar visuals ────────────────────────────────────────────────────
  function _updateBar() {
    const audioDur = (player.duration && isFinite(player.duration)) ? player.duration : 0;
    const vidDur   = getVideoDur ? Math.max(getVideoDur(), 1) : 30;

    // Update ruler right label
    rulerRight.textContent = vidDur.toFixed(1) + 's';

    // Video overlay: full-width = 100% of bar, but we want to show where vidDur ends relative to musicDur
    // The bar "scale" is max(audioDur+offset, vidDur). Show full audio range.
    const scaleDur = Math.max(audioDur + currentOffset, vidDur, 1);
    const vidPct   = (vidDur / scaleDur) * 100;
    vidOverlay.style.width = vidPct + '%';

    if (!audioDur) { bar.style.width = '0'; barLbl.textContent = ''; return; }

    const pctLeft  = (currentOffset / scaleDur) * 100;
    const pctWidth = (audioDur     / scaleDur) * 100;
    bar.style.left  = pctLeft + '%';
    bar.style.width = Math.max(pctWidth, 1) + '%';
    barLbl.textContent = audioDur.toFixed(1) + 's';
  }

  player.addEventListener('loadedmetadata', _updateBar);

  // Drag the blue music bar to set offset
  barWrap.addEventListener('mousedown', e => {
    e.preventDefault();
    const rect    = barWrap.getBoundingClientRect();
    const audioDur = (player.duration && isFinite(player.duration)) ? player.duration : 0;
    const vidDur   = getVideoDur ? Math.max(getVideoDur(), 1) : 30;
    const scaleDur = Math.max(audioDur + currentOffset, vidDur, 1);
    const startX   = e.clientX;
    const origOffset = currentOffset;
    const onMove = ev => {
      const dx = ev.clientX - startX;
      currentOffset = parseFloat(Math.max(0, origOffset + (dx / rect.width) * scaleDur).toFixed(1));
      offInp.value = currentOffset.toFixed(1);
      _updateBar();
    };
    const onUp = () => {
      _saveTl({ musicOffset: currentOffset });
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  offInp.addEventListener('change', () => {
    currentOffset = Math.max(0, parseFloat(offInp.value) || 0);
    offInp.value = currentOffset.toFixed(1);
    _saveTl({ musicOffset: currentOffset });
    _updateBar();
  });
  volInp.addEventListener('input', () => {
    currentVolume = parseFloat(volInp.value);
    volVal.textContent = currentVolume.toFixed(2);
    player.volume = currentVolume;
    _saveTl({ musicVolume: currentVolume });
  });

  saveBtn.addEventListener('click', async () => {
    _saveTl({ musicOffset: currentOffset, musicVolume: currentVolume });
    if (!_saveCallback) { saveBtn.textContent = '✓'; setTimeout(() => { saveBtn.textContent = '💾'; }, 1200); return; }
    saveBtn.disabled = true; saveBtn.textContent = '…';
    try {
      const result = await _saveCallback();
      saveBtn.textContent = result.success ? '✓' : '⚠';
      if (!result.success) console.warn('[music save]', result.error);
    } catch (e) { saveBtn.textContent = '⚠'; console.warn('[music save]', e); }
    finally { saveBtn.disabled = false; setTimeout(() => { saveBtn.textContent = '💾'; }, 2000); }
  });

  // ── Show/hide details based on file selection ─────────────────────────────
  function _applyUrl(url) {
    currentUrl = url;
    const isFile = url && url !== 'None' && url !== 'Random';
    details.style.display = isFile ? '' : 'none';
    delBtn.style.display  = isFile ? '' : 'none';
    if (isFile) { player.src = url; player.load(); }
    _saveTl({ music: url });
    _updateBar();
  }

  _applyUrl(currentUrl);
  sel.addEventListener('change', () => _applyUrl(sel.value));

  delBtn.addEventListener('click', () => {
    if (!currentUrl || currentUrl === 'None' || currentUrl === 'Random') return;
    saveAudioLib(getAudioLib().filter(x => !(x.type === 'music' && x.webPath === currentUrl)));
    currentUrl = 'None'; _rebuildSel(); _applyUrl('None');
  });

  // ── Upload row ────────────────────────────────────────────────────────────
  const upRow = document.createElement('div');
  upRow.className = 'audio-upload-row';
  const fileInp = document.createElement('input'); fileInp.type = 'file'; fileInp.accept = 'audio/*';
  const nameInp = document.createElement('input'); nameInp.type = 'text'; nameInp.placeholder = 'Name…'; nameInp.maxLength = 60;
  const upBtn   = document.createElement('button'); upBtn.className = 'audio-upload-btn'; upBtn.textContent = '⬆ Upload';

  fileInp.addEventListener('change', () => { if (fileInp.files[0] && !nameInp.value) nameInp.value = fileInp.files[0].name.replace(/\.[^.]+$/, '').slice(0, 40); });
  upBtn.addEventListener('click', async () => {
    if (!fileInp.files[0]) return;
    upBtn.disabled = true; upBtn.textContent = '…';
    try {
      const fd = new FormData(); fd.append('file', fileInp.files[0]);
      if (nameInp.value) fd.append('name', nameInp.value);
      const r = await fetch('/api/audio/upload-file', { method: 'POST', body: fd });
      const d = await r.json();
      if (!d.success) throw new Error(d.error);
      const lib = getAudioLib();
      lib.push({ id: Date.now().toString(), name: d.name, webPath: d.webPath, type: 'music', addedAt: new Date().toISOString() });
      saveAudioLib(lib); _rebuildSel(); sel.value = d.webPath; _applyUrl(d.webPath);
      fileInp.value = ''; nameInp.value = '';
    } catch (e) { alert('Upload error: ' + e.message); }
    finally { upBtn.disabled = false; upBtn.textContent = '⬆ Upload'; }
  });

  upRow.appendChild(fileInp); upRow.appendChild(nameInp); upRow.appendChild(upBtn);
  wrap.appendChild(details);
  wrap.appendChild(upRow);

  return {
    el: wrap,
    getUrl:    () => currentUrl,
    getOffset: () => currentOffset,
    getVolume: () => currentVolume,
    setSaveCallback: cb => { _saveCallback = cb; },
  };
}

// ── makeSfxControl(sessionKey, tlData, sfxKey) ───────────────────────────────
// Returns { el, getUrl }
// sfxKey: key in tlData[sessionKey] to store selection (default 'sfx')
function makeSfxControl(sessionKey, tlData, sfxKey = 'sfx') {
  const sd = tlData[sessionKey] || {};
  let currentUrl = sd[sfxKey] || 'None';

  function _saveTl(patch) {
    const d = getTimelineData();
    if (!d[sessionKey]) d[sessionKey] = {};
    Object.assign(d[sessionKey], patch);
    setTimelineData(d);
  }

  const wrap = document.createElement('div');
  wrap.className = 'audio-ctrl-wrap audio-sfx-wrap'; // black top border separator via CSS

  const row1 = document.createElement('div');
  row1.className = 'audio-ctrl-row';
  const lbl = document.createElement('span');
  lbl.className = 'audio-ctrl-lbl'; lbl.textContent = sfxKey === 'segSfx' ? 'SFX (talking):' : sfxKey === 'biroSfx' ? 'SFX (birols):' : 'SFX:';
  const sel   = document.createElement('select'); sel.className = 'audio-ctrl-sel';
  const playBtn = document.createElement('button'); playBtn.className = 'audio-play-btn'; playBtn.textContent = '▶'; playBtn.title = 'Preview';
  const delBtn  = document.createElement('button'); delBtn.className = 'audio-del-btn'; delBtn.textContent = '🗑'; delBtn.title = 'Delete from library';

  // hidden player
  const player = document.createElement('audio'); player.preload = 'none'; player.style.display = 'none';
  wrap.appendChild(player);

  function _rebuildSel() {
    const lib = getAudioLib().filter(x => x.type === 'sfx');
    sel.innerHTML = '';
    ['None', 'Random'].forEach(v => { const o = document.createElement('option'); o.value = v; o.textContent = v; sel.appendChild(o); });
    lib.forEach(item => { const o = document.createElement('option'); o.value = item.webPath; o.textContent = item.name; sel.appendChild(o); });
    sel.value = currentUrl;
  }
  _rebuildSel();

  function _applyUrl(url) {
    currentUrl = url;
    const isFile = url && url !== 'None' && url !== 'Random';
    playBtn.style.display = isFile ? '' : 'none';
    delBtn.style.display  = isFile ? '' : 'none';
    if (isFile) player.src = url;
    _saveTl({ [sfxKey]: url });
  }
  _applyUrl(currentUrl);

  sel.addEventListener('change', () => _applyUrl(sel.value));
  playBtn.addEventListener('click', () => {
    if (player.paused) { player.load(); player.play(); playBtn.textContent = '⏹'; }
    else { player.pause(); player.currentTime = 0; playBtn.textContent = '▶'; }
  });
  player.addEventListener('ended', () => { playBtn.textContent = '▶'; });
  delBtn.addEventListener('click', () => {
    if (!currentUrl || currentUrl === 'None' || currentUrl === 'Random') return;
    saveAudioLib(getAudioLib().filter(x => !(x.type === 'sfx' && x.webPath === currentUrl)));
    currentUrl = 'None'; _rebuildSel(); _applyUrl('None');
  });

  row1.appendChild(lbl); row1.appendChild(sel); row1.appendChild(playBtn); row1.appendChild(delBtn);
  wrap.appendChild(row1);

  // ── Upload row ───────────────────────────────────────────────────────────
  const upRow = document.createElement('div');
  upRow.className = 'audio-upload-row';
  const fileInp = document.createElement('input');
  fileInp.type = 'file'; fileInp.accept = 'audio/*';
  const nameInp = document.createElement('input');
  nameInp.type = 'text'; nameInp.placeholder = 'Name…'; nameInp.maxLength = 60;
  const upBtn = document.createElement('button');
  upBtn.className = 'audio-upload-btn'; upBtn.textContent = '⬆ Upload';

  fileInp.addEventListener('change', () => {
    if (fileInp.files[0] && !nameInp.value) nameInp.value = fileInp.files[0].name.replace(/\.[^.]+$/, '').slice(0, 40);
  });

  upBtn.addEventListener('click', async () => {
    if (!fileInp.files[0]) return;
    upBtn.disabled = true; upBtn.textContent = '…';
    try {
      const fd = new FormData();
      fd.append('file', fileInp.files[0]);
      if (nameInp.value) fd.append('name', nameInp.value);
      const r = await fetch('/api/audio/upload-file', { method: 'POST', body: fd });
      const d = await r.json();
      if (!d.success) throw new Error(d.error);
      const lib = getAudioLib();
      lib.push({ id: Date.now().toString(), name: d.name, webPath: d.webPath, type: 'sfx', addedAt: new Date().toISOString() });
      saveAudioLib(lib);
      _rebuildSel();
      sel.value = d.webPath;
      _applyUrl(d.webPath);
      fileInp.value = ''; nameInp.value = '';
    } catch (e) { alert('Upload error: ' + e.message); }
    finally { upBtn.disabled = false; upBtn.textContent = '⬆ Upload'; }
  });

  upRow.appendChild(fileInp); upRow.appendChild(nameInp); upRow.appendChild(upBtn);
  wrap.appendChild(upRow);

  return { el: wrap, getUrl: () => currentUrl };
}

function getCompletedSessions() {
  return Object.entries(editFrozenSessions).filter(([, s]) => {
    if (!Array.isArray(s.cells)) return false;
    const audioCells = s.cells.filter(c => c.audioPath);
    return audioCells.length > 0 && audioCells.every(c => c.videoPath && !c._videoPending && !c.avatarTaskId && !c.videoError);
  });
}

// ── Right column: biroly list for one session ────────────────────────────────
// Active birolys sorted by start time. Inactive birolys below (hideable).
// Per-session state in timeline_data_v2: { activated[], timings{}, hideInactive }
function renderSessionBirolys(container, sessionKey) {
  container.innerHTML = '';
  const data        = getTimelineData();
  const archive     = typeof getBirolyArchive === 'function' ? getBirolyArchive() : [];
  const sessionData = data[sessionKey] || {};
  const activated   = new Set(sessionData.activated || []);
  const timings     = sessionData.timings || {};
  const hideInactive = !!sessionData.hideInactive;

  // ── Header row: "Биролы" + hide-toggle + save-default + reset ───────────
  const hdrRow = document.createElement('div');
  hdrRow.style.cssText = 'display:flex;align-items:center;gap:3px;margin-bottom:5px;flex-wrap:wrap;';
  const hdrLbl = document.createElement('span');
  hdrLbl.style.cssText = 'font-size:9px;color:#555;font-weight:bold;flex:1;min-width:0;';
  hdrLbl.textContent = 'Birols';

  const _btnStyle = 'font-size:8px;padding:1px 5px;cursor:pointer;background:#d4d0c8;border:1px solid #808080;flex-shrink:0;white-space:nowrap;';

  const hideBtn = document.createElement('button');
  hideBtn.style.cssText = _btnStyle;
  hideBtn.textContent = hideInactive ? 'Show all' : 'Hide inactive';
  hideBtn.title = hideInactive ? 'Show inactive birols' : 'Hide inactive birols';
  hideBtn.addEventListener('click', () => {
    const d = getTimelineData();
    if (!d[sessionKey]) d[sessionKey] = {};
    d[sessionKey].hideInactive = !d[sessionKey].hideInactive;
    setTimelineData(d);
    renderSessionBirolys(container, sessionKey);
  });

  // ── Save as default ──────────────────────────────────────────────────────
  const defaults     = getBirolyDefaults();
  const hasDefault   = !!defaults[sessionKey];

  const saveDefBtn = document.createElement('button');
  saveDefBtn.style.cssText = _btnStyle + 'background:#e4f0e4;border-color:#5a9a5a;color:#1a5c1a;';
  saveDefBtn.textContent = '⭐ Default';
  saveDefBtn.title = hasDefault
    ? 'Save current order and timings as default (overwrites saved)'
    : 'Save current birols order and timings as default';
  saveDefBtn.addEventListener('click', () => {
    const d  = getTimelineData();
    const sd = d[sessionKey] || {};
    const snap = {
      activated: JSON.parse(JSON.stringify(sd.activated || [])),
      timings:   JSON.parse(JSON.stringify(sd.timings   || {})),
    };
    const defs = getBirolyDefaults();
    defs[sessionKey] = snap;
    setBirolyDefaults(defs);
    saveDefBtn.textContent = '⭐ Saved';
    saveDefBtn.style.background = '#b8e0b8';
    setTimeout(() => {
      saveDefBtn.textContent = '⭐ Default';
      saveDefBtn.style.background = '#e4f0e4';
    }, 1500);
  });

  // ── Reset to default ─────────────────────────────────────────────────────
  const resetDefBtn = document.createElement('button');
  resetDefBtn.style.cssText = _btnStyle + (hasDefault
    ? 'background:#f0e4d4;border-color:#9a6a1a;color:#5c3a00;'
    : 'opacity:0.45;cursor:default;');
  resetDefBtn.textContent = '↺ Reset';
  resetDefBtn.title = hasDefault ? 'Restore default birols order' : 'Default not saved yet';
  resetDefBtn.disabled = !hasDefault;
  resetDefBtn.addEventListener('click', () => {
    if (!hasDefault) return;
    const defs = getBirolyDefaults();
    const snap = defs[sessionKey];
    if (!snap) return;
    const d = getTimelineData();
    if (!d[sessionKey]) d[sessionKey] = {};
    d[sessionKey].activated = JSON.parse(JSON.stringify(snap.activated || []));
    d[sessionKey].timings   = JSON.parse(JSON.stringify(snap.timings   || {}));
    setTimelineData(d);
    renderSessionBirolys(container, sessionKey);
    refreshBirolyBars();
  });

  hdrRow.appendChild(hdrLbl);
  hdrRow.appendChild(saveDefBtn);
  hdrRow.appendChild(resetDefBtn);
  hdrRow.appendChild(hideBtn);
  container.appendChild(hdrRow);

  const allItems = archive
    .map((item, idx) => ({ item, idx }))
    .filter(({ item }) => item && item.videoPath);

  if (!allItems.length) {
    const empty = document.createElement('span');
    empty.style.cssText = 'font-size:9px;color:#888;';
    empty.textContent = 'No birols with video';
    container.appendChild(empty);
    return;
  }

  // Read category order from biroly_cats localStorage key (same source as Биролы tab)
  const BIROLY_DEFAULT_CATS = [
    { id: 'hooks',   label: 'Hooks' },
    { id: 'science', label: 'Science' },
    { id: 'hands',   label: 'Hands' },
    { id: 'faces',   label: 'Faces' },
  ];
  const catOrder = (() => {
    try {
      const parsed = JSON.parse(localStorage.getItem('biroly_cats') || '[]');
      return parsed.length ? parsed : BIROLY_DEFAULT_CATS;
    } catch { return BIROLY_DEFAULT_CATS; }
  })();

  function saveTiming(birolyIdx, updates) {
    const d = getTimelineData();
    if (!d[sessionKey])                    d[sessionKey] = {};
    if (!d[sessionKey].timings)            d[sessionKey].timings = {};
    if (!d[sessionKey].timings[birolyIdx]) d[sessionKey].timings[birolyIdx] = {};
    Object.assign(d[sessionKey].timings[birolyIdx], updates);
    setTimelineData(d);
  }

  // Render a single biroly card into container
  function renderBirolyCard(item, birolyIdx) {
    const isActive = activated.has(birolyIdx);
    const saved    = timings[birolyIdx] || {};
    const dur      = parseFloat(item.duration || 6);

    // Match timeline bar color for this biroly
    const tlColor  = TL_COLORS[birolyIdx % TL_COLORS.length];
    // Derive a subtle background tint from the timeline color (low opacity)
    const bgActive = tlColor + '28'; // ~16% opacity hex suffix

    const card = document.createElement('div');
    card.style.cssText = `display:flex;flex-direction:column;gap:3px;margin-bottom:4px;padding:3px 4px;
      border:1px solid ${isActive ? tlColor : '#c0c0c0'};
      background:${isActive ? bgActive : '#ebebeb'};
      ${!isActive ? 'opacity:0.75;' : ''}`;

    const topRow = document.createElement('div');
    topRow.style.cssText = 'display:flex;align-items:center;gap:4px;';

    const thumbSrc = item.thumbPath || item.imagePath;
    const thumbCss = 'width:22px;height:30px;object-fit:cover;flex-shrink:0;cursor:pointer;border:1px solid #808080;';
    const openFn   = item.videoPath ? () => window.openBirolyVideoLightbox?.(item.videoPath, item.imagePath || item.thumbPath) : null;
    if (thumbSrc) {
      const thumb = document.createElement('img');
      thumb.src = thumbSrc; thumb.style.cssText = thumbCss;
      thumb.title = '▶ ' + (item.name || 'Birol');
      if (openFn) {
        thumb.addEventListener('click', openFn);
        thumb.addEventListener('error', () => {
          if (item.videoPath && thumb.parentNode)
            thumb.parentNode.replaceChild(_videoThumb(item.videoPath, thumbCss, openFn), thumb);
          else thumb.style.display = 'none';
        }, { once: true });
      }
      topRow.appendChild(thumb);
    } else if (item.videoPath) {
      topRow.appendChild(_videoThumb(item.videoPath, thumbCss, openFn));
    }

    const nameEl = document.createElement('span');
    nameEl.style.cssText = 'flex:1;font-size:9px;color:#333;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;';
    nameEl.textContent = item.name || 'Birol';
    topRow.appendChild(nameEl);

    // Category badge (resolved from catOrder by closure)
    const catFound = catOrder.find(c => c.id === item.categoryId);
    const catLabel = (catFound ? catFound.label : '') || item.categoryLabel || '';
    if (catLabel) {
      const catBadge = document.createElement('span');
      catBadge.style.cssText = 'font-size:7px;color:#555;background:#d8d4cc;border:1px solid #b0aca0;border-radius:2px;padding:0 3px;flex-shrink:0;white-space:nowrap;max-width:52px;overflow:hidden;text-overflow:ellipsis;';
      catBadge.textContent = catLabel;
      catBadge.title = catLabel;
      topRow.appendChild(catBadge);
    }

    const toggleBtn = document.createElement('button');
    toggleBtn.style.cssText = `flex-shrink:0;font-size:9px;padding:1px 5px;cursor:pointer;
      ${isActive ? `background:${tlColor};color:#fff;font-weight:bold;border:1px solid ${tlColor};` : 'background:#d4d4d4;border:1px solid #a0a0a0;'}`;
    toggleBtn.textContent = isActive ? '★' : '☆';
    toggleBtn.title = isActive ? 'Deactivate' : 'Activate';
    toggleBtn.addEventListener('click', () => {
      const d = getTimelineData();
      if (!d[sessionKey])           d[sessionKey] = {};
      if (!d[sessionKey].activated) d[sessionKey].activated = [];
      const arr = d[sessionKey].activated;
      const pos = arr.indexOf(birolyIdx);
      if (pos === -1) {
        arr.push(birolyIdx);
        if (!d[sessionKey].timings)            d[sessionKey].timings = {};
        if (!d[sessionKey].timings[birolyIdx]) {
          d[sessionKey].timings[birolyIdx] = { crop: '0', start: '0.00', end: dur.toFixed(2) };
        }
      } else { arr.splice(pos, 1); }
      setTimelineData(d);
      renderSessionBirolys(container, sessionKey);
    });
    topRow.appendChild(toggleBtn);
    card.appendChild(topRow);

    if (isActive) {
      const timingRow = document.createElement('div');
      timingRow.style.cssText = 'display:flex;align-items:center;gap:2px;flex-wrap:nowrap;';
      const lbl = t => { const s = document.createElement('span'); s.style.cssText = 'font-size:8px;color:#555;flex-shrink:0;'; s.textContent = t; return s; };
      const inp = (val, ph, w) => { const i = document.createElement('input'); i.type = 'text'; i.value = val || ''; i.placeholder = ph; i.style.cssText = `width:${w||34}px;font-size:8px;padding:1px 2px;box-sizing:border-box;`; return i; };

      const cropInp  = inp(saved.crop  ?? '0',            'crop', 30);
      const startInp = inp(saved.start ?? '0.00',         '0.00', 36);
      const endInp   = inp(saved.end   ?? dur.toFixed(2), '0.00', 36);

      // Data attributes so drag handler can find + update these inputs directly
      startInp.dataset.timingKey = `${sessionKey}__${birolyIdx}__start`;
      endInp.dataset.timingKey   = `${sessionKey}__${birolyIdx}__end`;

      const recalcEnd = () => { const c = parseFloat(cropInp.value)||0; const s = parseFloat(startInp.value)||0; endInp.value = (s + Math.max(0, dur - c)).toFixed(2); };
      const saveAll   = () => saveTiming(birolyIdx, { crop: cropInp.value, start: startInp.value, end: endInp.value });

      cropInp.addEventListener('input',  () => { recalcEnd(); saveAll(); });
      cropInp.addEventListener('change', () => { saveAll(); refreshBirolyBars(); });
      startInp.addEventListener('input',  () => { recalcEnd(); saveAll(); });
      startInp.addEventListener('change', () => { saveAll(); renderSessionBirolys(container, sessionKey); refreshBirolyBars(); });
      endInp.addEventListener('change',   () => { saveAll(); refreshBirolyBars(); });

      timingRow.appendChild(lbl('crop')); timingRow.appendChild(cropInp);
      timingRow.appendChild(lbl('from:')); timingRow.appendChild(startInp);
      timingRow.appendChild(lbl('to:'));   timingRow.appendChild(endInp);
      card.appendChild(timingRow);
    }
    container.appendChild(card);
  }

  // Flat list: active items sorted by timeline start time, then inactive below
  const activeItems   = allItems
    .filter(({ idx }) => activated.has(idx))
    .sort((a, b) => (parseFloat(timings[a.idx]?.start) || 0) - (parseFloat(timings[b.idx]?.start) || 0));
  const inactiveItems = hideInactive ? [] : allItems.filter(({ idx }) => !activated.has(idx));

  activeItems.forEach(({ item, idx }) => renderBirolyCard(item, idx));

  if (inactiveItems.length) {
    const sep = document.createElement('div');
    sep.style.cssText = 'border-top:1px dashed #bbb;margin:3px 0 2px;font-size:8px;color:#aaa;padding-top:2px;';
    sep.textContent = 'inactive';
    container.appendChild(sep);
    inactiveItems.forEach(({ item, idx }) => renderBirolyCard(item, idx));
  }
  // After any re-render, sync biroly bars
  refreshBirolyBars();
}

// ── Per-project Таймлайн rows (one per completed session) ─────────────────────
const TL_COLORS = ['#3a7a5a','#4a6a9a','#7a4a8a','#9a7a3a','#3a6a7a','#7a3a4a','#5a8a3a','#8a5a3a'];

// ── FFmpeg Advanced Settings — defaults ───────────────────────────────────────
const ADV_DEFAULTS = {
  resolution:   '1080x1920',
  fps:          30,
  crf:          23,
  preset:       'fast',
  audioBitrate: '192k',
  eqBrightness: 0,
  eqContrast:   1,
  eqSaturation: 1,
  eqGamma:      1,
  subsEnabled:  false,
  subsFontSize: 48,
  subsPosition: 'bottom',
  subsColor:    '#ffffff',
  subsStyle:    'outline',
  extra1:       'none',
  extra2:       'none',
  extra3:       'none',
};

// ── Advanced-settings modal (global, one instance shared across sessions) ─────
let _advModalInited = false;
let _advCurSessionKey = null;

function _advSlider(id, valId, fmt) {
  const sl = document.getElementById(id);
  const vl = document.getElementById(valId);
  if (!sl || !vl) return;
  sl.addEventListener('input', () => { vl.textContent = fmt(parseFloat(sl.value)); });
}

function _advSubsToggle() {
  const enabled = document.getElementById('adv-subs-enabled')?.checked;
  const opts    = document.getElementById('adv-subs-opts');
  if (opts) opts.classList.toggle('adv-hidden', !enabled);
}

function _openAdvModal(sessionKey) {
  if (!_advModalInited) {
    _advModalInited = true;
    document.getElementById('adv-modal-close') .addEventListener('click',  _closeAdvModal);
    document.getElementById('adv-modal-cancel').addEventListener('click',  _closeAdvModal);
    document.getElementById('adv-modal-apply') .addEventListener('click',  _applyAdvModal);
    document.getElementById('adv-modal-overlay').addEventListener('click', e => {
      if (e.target === document.getElementById('adv-modal-overlay')) _closeAdvModal();
    });
    _advSlider('adv-crf',        'adv-crf-val',        v => v.toFixed(0));
    _advSlider('adv-brightness', 'adv-brightness-val', v => v.toFixed(2));
    _advSlider('adv-contrast',   'adv-contrast-val',   v => v.toFixed(2));
    _advSlider('adv-saturation', 'adv-saturation-val', v => v.toFixed(2));
    _advSlider('adv-gamma',      'adv-gamma-val',      v => v.toFixed(2));
    _advSlider('adv-subs-size',  'adv-subs-size-val',  v => v.toFixed(0));
    document.getElementById('adv-subs-enabled')?.addEventListener('change', _advSubsToggle);
  }
  _advCurSessionKey = sessionKey;
  const tlData = getTimelineData();
  const adv = { ...ADV_DEFAULTS, ...(tlData[sessionKey]?.advSettings || {}) };
  _populateAdvModal(adv);
  document.getElementById('adv-modal-overlay').classList.add('open');
}

function _closeAdvModal() {
  document.getElementById('adv-modal-overlay').classList.remove('open');
}

function _populateAdvModal(adv) {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  const setChk = (id, v) => { const el = document.getElementById(id); if (el) el.checked = !!v; };
  const setVal = (valId, v, fmt) => { const el = document.getElementById(valId); if (el) el.textContent = fmt(v); };

  set('adv-resolution',   adv.resolution);
  set('adv-fps',          String(adv.fps));
  set('adv-crf',          String(adv.crf));          setVal('adv-crf-val',        adv.crf,          v => v.toFixed(0));
  set('adv-preset',       adv.preset);
  set('adv-audio-bitrate', adv.audioBitrate);
  set('adv-brightness',   String(adv.eqBrightness)); setVal('adv-brightness-val', adv.eqBrightness, v => v.toFixed(2));
  set('adv-contrast',     String(adv.eqContrast));   setVal('adv-contrast-val',   adv.eqContrast,   v => v.toFixed(2));
  set('adv-saturation',   String(adv.eqSaturation)); setVal('adv-saturation-val', adv.eqSaturation, v => v.toFixed(2));
  set('adv-gamma',        String(adv.eqGamma));      setVal('adv-gamma-val',      adv.eqGamma,      v => v.toFixed(2));
  setChk('adv-subs-enabled', adv.subsEnabled);
  set('adv-subs-size',    String(adv.subsFontSize)); setVal('adv-subs-size-val',  adv.subsFontSize, v => v.toFixed(0));
  set('adv-subs-pos',     adv.subsPosition);
  set('adv-subs-color',   adv.subsColor);
  set('adv-subs-style',   adv.subsStyle);
  set('adv-extra-1',      adv.extra1 || 'none');
  set('adv-extra-2',      adv.extra2 || 'none');
  set('adv-extra-3',      adv.extra3 || 'none');
  _advSubsToggle();
}

function _readAdvModal() {
  const num  = id => parseFloat(document.getElementById(id)?.value) || 0;
  const str  = id => document.getElementById(id)?.value || '';
  const chk  = id => !!document.getElementById(id)?.checked;
  return {
    resolution:   str('adv-resolution')   || ADV_DEFAULTS.resolution,
    fps:          parseInt(str('adv-fps')) || ADV_DEFAULTS.fps,
    crf:          parseInt(str('adv-crf')) || ADV_DEFAULTS.crf,
    preset:       str('adv-preset')       || ADV_DEFAULTS.preset,
    audioBitrate: str('adv-audio-bitrate')|| ADV_DEFAULTS.audioBitrate,
    eqBrightness: num('adv-brightness'),
    eqContrast:   num('adv-contrast')   || 1,
    eqSaturation: num('adv-saturation') || 1,
    eqGamma:      num('adv-gamma')      || 1,
    subsEnabled:  chk('adv-subs-enabled'),
    subsFontSize: parseInt(str('adv-subs-size')) || ADV_DEFAULTS.subsFontSize,
    subsPosition: str('adv-subs-pos')   || ADV_DEFAULTS.subsPosition,
    subsColor:    str('adv-subs-color') || ADV_DEFAULTS.subsColor,
    subsStyle:    str('adv-subs-style') || ADV_DEFAULTS.subsStyle,
    extra1:       str('adv-extra-1')    || ADV_DEFAULTS.extra1,
    extra2:       str('adv-extra-2')    || ADV_DEFAULTS.extra2,
    extra3:       str('adv-extra-3')    || ADV_DEFAULTS.extra3,
  };
}

function _applyAdvModal() {
  const adv = _readAdvModal();
  const d   = getTimelineData();
  if (!d[_advCurSessionKey]) d[_advCurSessionKey] = {};
  d[_advCurSessionKey].advSettings = adv;
  setTimelineData(d);
  _closeAdvModal();
}

// ── ASS subtitle styling modal ────────────────────────────────────────────────
const ASS_DEFAULTS = {
  fontName:        'Impact',
  fontSize:        80,
  bold:            true,
  italic:          false,
  primaryColor:    '#ffffff',
  outlineColor:    '#000000',
  shadowColor:     '#000000',
  backColor:       '#000000',
  backAlpha:       128,
  borderStyle:     1,
  outline:         2.5,
  shadow:          1,
  blur:            0,
  posAlign:        'bc',       // tl/tc/tr/ul/uc/ur/ml/mc/mr/ll/lc/lr/bl/bc/br (15 positions)
  rotationPreset:  'none',
  animPreset:      'none',
  appearPreset:    'fade_std',
  karaokeStyle:    'sweep',
  wrapStyle:       1,
  wordsPerLine:    3,
};

// ── Available fonts for subtitle dropdown ─────────────────────────────────────
const ASS_FONTS = [
  { name: 'Impact',            css: 'Impact, fantasy' },
  { name: 'Arial',             css: 'Arial, sans-serif' },
  { name: 'Arial Black',       css: '"Arial Black", sans-serif' },
  { name: 'Helvetica',         css: 'Helvetica, Arial, sans-serif' },
  { name: 'Verdana',           css: 'Verdana, sans-serif' },
  { name: 'Tahoma',            css: 'Tahoma, sans-serif' },
  { name: 'Trebuchet MS',      css: '"Trebuchet MS", sans-serif' },
  { name: 'Comic Sans MS',     css: '"Comic Sans MS", cursive' },
  { name: 'Times New Roman',   css: '"Times New Roman", serif' },
  { name: 'Georgia',           css: 'Georgia, serif' },
  { name: 'Courier New',       css: '"Courier New", monospace' },
  { name: 'Palatino Linotype', css: '"Palatino Linotype", serif' },
];

// position grid definition: key → {col, row} — 3×5 = 15 positions
const _ASS_POS_KEYS = [
  {k:'tl',col:'l',row:'top'},    {k:'tc',col:'c',row:'top'},    {k:'tr',col:'r',row:'top'},
  {k:'ul',col:'l',row:'upper'},  {k:'uc',col:'c',row:'upper'},  {k:'ur',col:'r',row:'upper'},
  {k:'ml',col:'l',row:'middle'}, {k:'mc',col:'c',row:'middle'}, {k:'mr',col:'r',row:'middle'},
  {k:'ll',col:'l',row:'lower'},  {k:'lc',col:'c',row:'lower'},  {k:'lr',col:'r',row:'lower'},
  {k:'bl',col:'l',row:'bottom'}, {k:'bc',col:'c',row:'bottom'}, {k:'br',col:'r',row:'bottom'},
];
const _POS_BAR_CSS = {
  top:    'top:3px;',
  upper:  'top:6px;',
  middle: 'top:calc(50% - 1px);',
  lower:  'bottom:6px;',
  bottom: 'bottom:3px;',
};
const _POS_COL_CSS = {
  l: 'left:2px;right:50%;',
  c: 'left:15%;right:15%;',
  r: 'left:50%;right:2px;',
};

let _assModalInited = false;
let _assCurSessionKey = null;

function _assSlider(id, valId, fmt) {
  const sl = document.getElementById(id);
  const vl = document.getElementById(valId);
  if (!sl || !vl) return;
  sl.addEventListener('input', () => { vl.textContent = fmt(parseFloat(sl.value)); });
}

function _assRadioInit(groupName) {
  document.querySelectorAll(`.ass-radio-opt[data-group="${groupName}"]`).forEach(lbl => {
    lbl.addEventListener('click', () => {
      document.querySelectorAll(`.ass-radio-opt[data-group="${groupName}"]`).forEach(l => l.classList.remove('active'));
      lbl.classList.add('active');
      const inp = lbl.querySelector('input[type=radio]');
      if (inp) inp.checked = true;
    });
  });
}

function _assRadioSet(name, val) {
  document.querySelectorAll(`[name="${name}"]`).forEach(inp => {
    inp.checked = (inp.value === String(val));
    inp.closest('.ass-radio-opt')?.classList.toggle('active', inp.value === String(val));
  });
}

function _openAssModal(sessionKey) {
  if (!_assModalInited) {
    _assModalInited = true;
    document.getElementById('ass-modal-close') .addEventListener('click',  _closeAssModal);
    document.getElementById('ass-modal-cancel').addEventListener('click',  _closeAssModal);
    document.getElementById('ass-modal-apply') .addEventListener('click',  _applyAssModal);
    document.getElementById('ass-modal-overlay').addEventListener('click', e => {
      if (e.target === document.getElementById('ass-modal-overlay')) _closeAssModal();
    });
    // Sliders
    _assSlider('ass-font-size',  'ass-font-size-val',  v => v.toFixed(0));
    _assSlider('ass-back-alpha', 'ass-back-alpha-val', v => Math.round(v * 100 / 255) + '%');
    _assSlider('ass-outline',    'ass-outline-val',    v => v.toFixed(1));
    _assSlider('ass-shadow',     'ass-shadow-val',     v => v.toFixed(1));
    _assSlider('ass-blur',       'ass-blur-val',       v => v.toFixed(1));
    // Bold/italic toggle
    ['ass-bold-chk','ass-italic-chk'].forEach(id => {
      const lbl = document.getElementById(id);
      if (!lbl) return;
      lbl.addEventListener('click', () => {
        const chk = lbl.querySelector('input[type=checkbox]');
        if (!chk) return;
        setTimeout(() => lbl.classList.toggle('active', chk.checked), 0);
      });
    });
    // Build position grid
    const grid = document.getElementById('ass-pos-grid');
    if (grid) {
      _ASS_POS_KEYS.forEach(({k, col, row}) => {
        const btn = document.createElement('button');
        btn.className = 'ass-pos-btn';
        btn.dataset.posKey = k;
        const bar = document.createElement('div');
        bar.className = 'ass-pos-bar';
        bar.style.cssText = _POS_BAR_CSS[row] + _POS_COL_CSS[col];
        btn.appendChild(bar);
        btn.addEventListener('click', () => {
          document.querySelectorAll('.ass-pos-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        });
        grid.appendChild(btn);
      });
    }
    // Radio rows (scoped by data-group)
    _assRadioInit('karaoke');
    _assRadioInit('wrap');
    // Font dropdown
    const fontList = document.getElementById('ass-font-list');
    if (fontList && !fontList.hasChildNodes()) {
      ASS_FONTS.forEach(f => {
        const opt = document.createElement('div');
        opt.className = 'ass-font-opt';
        opt.dataset.font = f.name;
        opt.style.fontFamily = f.css;
        opt.textContent = f.name;
        opt.addEventListener('click', e => {
          e.stopPropagation();
          document.querySelectorAll('.ass-font-opt').forEach(o => o.classList.remove('selected'));
          opt.classList.add('selected');
          document.getElementById('ass-font-name').value = f.name;
          const prev = document.getElementById('ass-font-preview');
          if (prev) { prev.textContent = f.name; prev.style.fontFamily = f.css; }
          fontList.classList.remove('open');
        });
        fontList.appendChild(opt);
      });
    }
    const fontSel = document.getElementById('ass-font-sel');
    if (fontSel) {
      fontSel.addEventListener('click', e => {
        e.stopPropagation();
        fontList?.classList.toggle('open');
      });
    }
    document.addEventListener('click', () => fontList?.classList.remove('open'));
  }
  _assCurSessionKey = sessionKey;
  const tlData = getTimelineData();
  const ass = { ...ASS_DEFAULTS, ...(tlData[sessionKey]?.assSettings || {}) };
  _populateAssModal(ass);
  document.getElementById('ass-modal-overlay').classList.add('open');
}

function _closeAssModal() {
  document.getElementById('ass-modal-overlay').classList.remove('open');
}

function _populateAssModal(ass) {
  const set    = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  const setChk = (id, v) => { const el = document.getElementById(id); if (el) { el.checked = !!v; el.closest('.ass-chk')?.classList.toggle('active', !!v); } };
  const setVal = (valId, v, fmt) => { const el = document.getElementById(valId); if (el) el.textContent = fmt(v); };

  // Font name (hidden input + dropdown preview)
  const fn = ass.fontName || 'Arial';
  set('ass-font-name', fn);
  const fontEntry = ASS_FONTS.find(f => f.name === fn);
  const fontCss   = fontEntry ? fontEntry.css : `"${fn}", sans-serif`;
  const prevEl = document.getElementById('ass-font-preview');
  if (prevEl) { prevEl.textContent = fn; prevEl.style.fontFamily = fontCss; }
  document.querySelectorAll('.ass-font-opt').forEach(o => o.classList.toggle('selected', o.dataset.font === fn));
  set('ass-font-size',     String(ass.fontSize));    setVal('ass-font-size-val', ass.fontSize, v => v.toFixed(0));
  setChk('ass-bold',       ass.bold);
  setChk('ass-italic',     ass.italic);
  set('ass-primary-color', ass.primaryColor);
  set('ass-outline-color', ass.outlineColor);
  set('ass-shadow-color',  ass.shadowColor);
  set('ass-back-color',    ass.backColor);
  set('ass-back-alpha',    String(ass.backAlpha));   setVal('ass-back-alpha-val', ass.backAlpha, v => Math.round(v * 100 / 255) + '%');
  set('ass-border-style',  String(ass.borderStyle));
  set('ass-outline',       String(ass.outline));     setVal('ass-outline-val', ass.outline, v => v.toFixed(1));
  set('ass-shadow',        String(ass.shadow));      setVal('ass-shadow-val', ass.shadow, v => v.toFixed(1));
  set('ass-blur',          String(ass.blur));        setVal('ass-blur-val', ass.blur, v => v.toFixed(1));
  // Position grid
  const posKey = ass.posAlign || 'bc';
  document.querySelectorAll('.ass-pos-btn').forEach(b => b.classList.toggle('active', b.dataset.posKey === posKey));
  // Presets
  set('ass-rotation-preset', ass.rotationPreset || 'none');
  set('ass-anim-preset',     ass.animPreset     || 'none');
  set('ass-appear-preset',   ass.appearPreset   || 'none');
  // Radio groups
  _assRadioSet('ass-karaoke', ass.karaokeStyle || 'none');
  _assRadioSet('ass-wrap',    String(ass.wrapStyle ?? 0));
  // Words per line
  set('ass-words-per-line', String(ass.wordsPerLine ?? 7));
}

function _readAssModal() {
  const num    = id => parseFloat(document.getElementById(id)?.value) || 0;
  const str    = id => document.getElementById(id)?.value || '';
  const chk    = id => !!document.getElementById(id)?.checked;
  const radio  = name => document.querySelector(`[name="${name}"]:checked`)?.value || '';
  const posBtn = () => document.querySelector('.ass-pos-btn.active')?.dataset.posKey || 'bc';
  return {
    fontName:       str('ass-font-name')     || ASS_DEFAULTS.fontName,
    fontSize:       parseInt(str('ass-font-size')) || ASS_DEFAULTS.fontSize,
    bold:           chk('ass-bold'),
    italic:         chk('ass-italic'),
    primaryColor:   str('ass-primary-color') || ASS_DEFAULTS.primaryColor,
    outlineColor:   str('ass-outline-color') || ASS_DEFAULTS.outlineColor,
    shadowColor:    str('ass-shadow-color')  || ASS_DEFAULTS.shadowColor,
    backColor:      str('ass-back-color')    || ASS_DEFAULTS.backColor,
    backAlpha:      Math.round(num('ass-back-alpha')),
    borderStyle:    parseInt(str('ass-border-style')) || 1,
    outline:        num('ass-outline'),
    shadow:         num('ass-shadow'),
    blur:           num('ass-blur'),
    posAlign:       posBtn(),
    rotationPreset: str('ass-rotation-preset') || 'none',
    animPreset:     str('ass-anim-preset')     || 'none',
    appearPreset:   str('ass-appear-preset')   || 'none',
    karaokeStyle:   radio('ass-karaoke')       || 'none',
    wrapStyle:      parseInt(radio('ass-wrap') || '0'),
    wordsPerLine:   parseInt(str('ass-words-per-line')) || 7,
  };
}

async function _applyAssModal() {
  const ass = _readAssModal();
  const d   = getTimelineData();
  if (!d[_assCurSessionKey]) d[_assCurSessionKey] = {};
  d[_assCurSessionKey].assSettings = ass;

  // Show building status in the Apply button
  const applyBtn = document.getElementById('ass-modal-apply');
  const origText = applyBtn?.textContent || '✓ Apply';
  if (applyBtn) { applyBtn.textContent = '⏳ Building…'; applyBtn.disabled = true; }

  try {
    const sd           = d[_assCurSessionKey];
    const srtSubtitles = sd.srtSubtitles || [];
    const srtWords     = sd.srtWords     || [];
    const resolution   = sd.advSettings?.resolution || '1080x1920';

    if (srtSubtitles.length > 0 || srtWords.length > 0) {
      const r  = await fetch('/api/ffmpeg/build-ass', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ srtSubtitles, srtWords, assSettings: ass, resolution, sessionKey: _assCurSessionKey }),
      });
      const rj = await r.json();
      if (rj.success) {
        d[_assCurSessionKey].prebuiltAssPath = rj.assFilePath;
        if (applyBtn) applyBtn.textContent = '✓ Done!';
        await new Promise(res => setTimeout(res, 600));
      } else {
        console.warn('[ass] build-ass error:', rj.error);
      }
    }
  } catch (e) {
    console.warn('[ass] build-ass fetch error:', e.message);
  } finally {
    if (applyBtn) { applyBtn.textContent = origText; applyBtn.disabled = false; }
  }

  setTimelineData(d);
  _closeAssModal();
}

// ── Parse SRT content to [{text,start,end}] ───────────────────────────────────
function _parseSrt(srtContent) {
  const blocks = (srtContent || '').trim().split(/\n\n+/);
  const subs = [];
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    const timeLine = lines.find(l => l.includes('-->'));
    if (!timeLine) continue;
    const [startStr, endStr] = timeLine.split('-->').map(s => s.trim());
    const parseTime = s => {
      const [h, m, rest] = s.split(':');
      const [sec, ms] = rest.replace(',', '.').split('.');
      return parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(sec) + parseInt(ms || 0) / 1000;
    };
    const textLines = lines.slice(lines.indexOf(timeLine) + 1).filter(Boolean);
    const text = textLines.join(' ').trim();
    if (text) subs.push({ text, start: parseTime(startStr), end: parseTime(endStr) });
  }
  return subs;
}

let _tlRunning = false, _tlQueued = false;
async function renderAllTimelines() {
  if (_tlRunning) { _tlQueued = true; return; }
  _tlRunning = true;
  try { await _renderAllTimelinesImpl(); }
  finally {
    _tlRunning = false;
    if (_tlQueued) { _tlQueued = false; renderAllTimelines(); }
  }
}
// ── Склейка project collapse/close persistence ────────────────────────────────
const LS_SKLEYKA_COLLAPSED = 'skleyka_collapsed_v1';
const LS_SKLEYKA_CLOSED    = 'skleyka_closed_v1';
function getSkleykaCollapsed() { try { return new Set(JSON.parse(localStorage.getItem(LS_SKLEYKA_COLLAPSED)||'[]')); } catch { return new Set(); } }
function saveSkleykaCollapsed(s) { localStorage.setItem(LS_SKLEYKA_COLLAPSED, JSON.stringify([...s])); }
function getSkleykaClosed() { try { return new Set(JSON.parse(localStorage.getItem(LS_SKLEYKA_CLOSED)||'[]')); } catch { return new Set(); } }
function saveSkleykaClosed(s) { localStorage.setItem(LS_SKLEYKA_CLOSED, JSON.stringify([...s])); }

// ── Close-project modal ───────────────────────────────────────────────────────
function _showCloseProjectModal(sessionKey, getBtnSave, onClose) {
  let modal = document.getElementById('skleyka-close-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'skleyka-close-modal';
    modal.style.cssText =
      'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.55);' +
      'z-index:9200;align-items:center;justify-content:center;';
    document.body.appendChild(modal);
  }
  modal.innerHTML = '';
  const box = document.createElement('div');
  box.style.cssText =
    'background:#c0c0c0;border:2px solid #808080;padding:18px 22px;min-width:300px;' +
    'box-shadow:4px 4px 0 #808080;font-size:12px;';
  const title = document.createElement('div');
  title.style.cssText = 'font-weight:bold;font-size:13px;margin-bottom:8px;';
  title.textContent = 'Close project?';
  const msg = document.createElement('div');
  msg.style.cssText = 'color:#444;font-size:11px;margin-bottom:16px;';
  msg.textContent = 'Project will disappear from Merge. Edit data will be preserved.';
  const btns = document.createElement('div');
  btns.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;';
  const closeModal = () => { modal.style.display = 'none'; };
  const makeBtn = (text, fn, color) => {
    const b = document.createElement('button');
    b.textContent = text;
    b.style.cssText = `padding:4px 10px;cursor:pointer;font-size:11px;${color ? 'color:'+color+';' : ''}`;
    b.addEventListener('click', fn);
    return b;
  };
  btns.appendChild(makeBtn('💾 Save and close', () => {
    closeModal();
    const bs = getBtnSave();
    if (bs && !bs.disabled) bs.click();
    setTimeout(onClose, 600);
  }));
  btns.appendChild(makeBtn('Close without saving', () => { closeModal(); onClose(); }, '#aa0000'));
  btns.appendChild(makeBtn('Cancel', closeModal));
  box.appendChild(title); box.appendChild(msg); box.appendChild(btns);
  modal.appendChild(box);
  modal.style.display = 'flex';
}

async function _renderAllTimelinesImpl() {
  const wrap = document.getElementById('skleyka-timelines');
  if (!wrap) return;
  wrap.innerHTML = '';

  // Only sessions where ALL audio cells have finished videos
  const allSessions = getCompletedSessions();
  const closedSet   = getSkleykaClosed();
  const sessions    = allSessions.filter(([key]) => !closedSet.has(key));

  // Persist which sessions are currently shown so next reload closes the rest
  _saveSkleykaLastShown(sessions.map(([key]) => key));

  if (!sessions.length) {
    const row = document.createElement('div');
    row.className = 'skleyka-row';
    const emptyMsg = allSessions.length && closedSet.size
      ? 'All projects closed. Open a project from the Finals tab or finish generation.'
      : 'Timeline will appear after all video segments are generated';
    row.innerHTML = `<div class="col-header">Timeline</div><span style="color:#888;font-size:11px;">${emptyMsg}</span>`;
    wrap.appendChild(row);
    return;
  }

  const collapsedSet = getSkleykaCollapsed();

  for (let si = 0; si < sessions.length; si++) {
    const [sessionKey, session] = sessions[si];
    const scenName = sessionKey.split('__').slice(1).join('__').replace(/\.txt$/i, '');

    // Resolve scenario file object and activeObraz for this session
    const _sesScenFile = session.scenFile || sessionKey.split('__').slice(1,-1).join('__');
    const _sesObrazId  = session.obrazId  || sessionKey.split('__')[0];
    const f          = scenarioFiles.find(sf => sf.file === _sesScenFile) || { file: _sesScenFile, name: scenName };
    const activeObraz = (getObrazы?.() || []).find(o => String(o.id) === String(_sesObrazId))
                        || { id: _sesObrazId, name: session.obrazName || '', char: session.obrazChar || '' };

    // Full project title — used for merged file name and Telegram caption
    const _frozen     = editFrozenSessions[sessionKey] || null;
    const _renderDate = _frozen?.date ? new Date(_frozen.date) : new Date();
    const _renderDateStr = _renderDate.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const _renderTimeStr = _renderDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const _renderTitle = `${_renderDateStr} — ${_renderTimeStr} — ${f.name} — ${activeObraz.name}`;

    // Load audio durations (all sessions here are completed — every audio cell has a video)
    const durations = await Promise.all(
      session.cells.map(c => c.audioPath ? getAudioDuration(c.audioPath) : Promise.resolve(0))
    );

    // Read per-session exclusions and controls settings
    const tlData = getTimelineData();
    const sessData = tlData[sessionKey] || {};
    const excludedSet = new Set(sessData.excludedSegments || []);

    // Build all segments with original (full) timing
    let allCursor = 0;
    const allSegments = session.cells.map((cell, i) => {
      const dur = durations[i] || 0; const start = allCursor; allCursor += dur;
      return { cell, idx: i, start, end: allCursor, dur };
    }).filter(s => s.dur > 0);

    // Active segments (non-excluded) with recalculated consecutive timing
    let activeCursor = 0;
    const activeSegments = allSegments
      .filter(s => !excludedSet.has(s.idx))
      .map(s => { const st = activeCursor; activeCursor += s.dur; return { ...s, activeStart: st, activeEnd: activeCursor }; });
    const totalDur = activeCursor;

    // ── Collapsible project wrapper ───────────────────────────────────────────
    let _btnSaveRef = null; // filled when btnSave is created below
    const isCollapsed = collapsedSet.has(sessionKey);

    const projectWrap = document.createElement('div');
    projectWrap.style.cssText = 'border-bottom:2px solid #808080;';

    const projectHdr = document.createElement('div');
    projectHdr.style.cssText =
      'display:flex;align-items:center;gap:6px;padding:4px 8px;' +
      'background:#a8a49c;cursor:pointer;user-select:none;';

    const pArrow = document.createElement('span');
    pArrow.style.cssText = 'font-size:9px;color:#333;flex-shrink:0;';
    pArrow.textContent = isCollapsed ? '▶' : '▼';

    const pTitle = document.createElement('span');
    pTitle.style.cssText = 'flex:1;font-weight:bold;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    pTitle.textContent = `Timeline-${si + 1}: ${scenName}` + (totalDur > 0 ? `  (${totalDur.toFixed(2)}s)` : '');

    const pRefresh = document.createElement('button');
    pRefresh.textContent = '↺'; pRefresh.title = 'Refresh timeline';
    pRefresh.style.cssText = 'font-size:10px;padding:1px 5px;cursor:pointer;flex-shrink:0;';
    pRefresh.addEventListener('click', e => { e.stopPropagation(); renderAllTimelines(); });

    const pClose = document.createElement('button');
    pClose.textContent = '✕'; pClose.title = 'Close project';
    pClose.style.cssText = 'font-size:10px;padding:1px 5px;cursor:pointer;flex-shrink:0;color:#aa0000;font-weight:bold;';
    pClose.addEventListener('click', e => {
      e.stopPropagation();
      _showCloseProjectModal(sessionKey, () => _btnSaveRef, () => {
        const closed = getSkleykaClosed();
        closed.add(sessionKey);
        saveSkleykaClosed(closed);
        renderAllTimelines();
      });
    });

    projectHdr.appendChild(pArrow);
    projectHdr.appendChild(pTitle);
    projectHdr.appendChild(pRefresh);
    projectHdr.appendChild(pClose);

    const projectBody = document.createElement('div');
    projectBody.style.display = isCollapsed ? 'none' : '';

    projectHdr.addEventListener('click', () => {
      const col = getSkleykaCollapsed();
      if (projectBody.style.display === 'none') {
        projectBody.style.display = ''; pArrow.textContent = '▼'; col.delete(sessionKey);
      } else {
        projectBody.style.display = 'none'; pArrow.textContent = '▶'; col.add(sessionKey);
      }
      saveSkleykaCollapsed(col);
    });

    projectWrap.appendChild(projectHdr);
    projectWrap.appendChild(projectBody);

    // ── Row (content inside collapsible body) ─────────────────────────────────
    const row = document.createElement('div');
    row.className = 'skleyka-row';
    row.style.cssText = 'border-bottom:none;';

    const cols = document.createElement('div');
    cols.className = 'timeline-cols';

    // ── Left: fragment strip + audio bar + timing list ───────────────────────
    const leftCol = document.createElement('div');
    leftCol.className = 'timeline-col-left';

    // Fragment strip: excluded cells greyed and moved to end
    leftCol.appendChild(_buildFragStrip(session, sessionKey, { excludedSet }));

    // ── Video preview (filled after _ssState is init'd below) ────────────────
    const videoPreviewWrap = document.createElement('div');
    videoPreviewWrap.className = 'video-preview-wrap';
    videoPreviewWrap.innerHTML = '<div class="video-preview-placeholder">Preview will appear after render</div>';
    leftCol.appendChild(videoPreviewWrap);

    // ── Biroly timeline bar (above audio bar) ────────────────────────────────
    if (totalDur > 0) {
      const bLbl = document.createElement('div');
      bLbl.style.cssText = 'font-size:8px;color:#888;margin-bottom:1px;';
      bLbl.textContent = 'Birols:';

      const bBar = document.createElement('div');
      bBar.className = 'timeline-biroly-bar';
      bBar.dataset.sessionKey = sessionKey;
      bBar.dataset.totalDur   = String(totalDur);
      bBar.style.cssText = 'position:relative;height:26px;background:#111;border-radius:3px;overflow:hidden;margin-bottom:3px;';

      _fillBirolyBar(bBar, sessionKey, totalDur);
      leftCol.appendChild(bLbl);
      leftCol.appendChild(bBar);
    }

    if (activeSegments.length && totalDur > 0) {
      // Visual bar (active segments only, with recalculated positions)
      const bar = document.createElement('div');
      bar.style.cssText = 'position:relative;height:28px;background:#1a1a1a;border-radius:3px;overflow:hidden;margin-bottom:3px;';
      activeSegments.forEach(seg => {
        const el = document.createElement('div');
        el.style.cssText = `position:absolute;left:${(seg.activeStart/totalDur*100).toFixed(3)}%;width:${(seg.dur/totalDur*100).toFixed(3)}%;height:100%;background:${TL_COLORS[seg.idx%TL_COLORS.length]};border-right:1px solid rgba(0,0,0,0.4);box-sizing:border-box;display:flex;align-items:center;justify-content:center;overflow:hidden;`;
        el.title = `Fr.${seg.idx+1}: ${seg.activeStart.toFixed(2)}s–${seg.activeEnd.toFixed(2)}s (${seg.dur.toFixed(2)}s)\n${seg.cell.line||''}`;
        el.innerHTML = `<span style="font-size:8px;color:#fff;font-weight:bold;pointer-events:none;">${seg.idx+1}</span>`;
        bar.appendChild(el);
      });
      leftCol.appendChild(bar);

      // Ruler (active segments)
      const ruler = document.createElement('div');
      ruler.style.cssText = 'position:relative;height:12px;margin-bottom:4px;';
      activeSegments.forEach(seg => {
        const tick = document.createElement('span');
        tick.style.cssText = `position:absolute;left:${(seg.activeStart/totalDur*100).toFixed(3)}%;font-size:8px;color:#555;white-space:nowrap;transform:translateX(-50%);`;
        tick.textContent = seg.activeStart.toFixed(1)+'s';
        ruler.appendChild(tick);
      });
      const endTick = document.createElement('span');
      endTick.style.cssText = 'position:absolute;right:0;font-size:8px;color:#555;';
      endTick.textContent = totalDur.toFixed(1)+'s';
      ruler.appendChild(endTick);
      leftCol.appendChild(ruler);
    }

    // Fragment list — collapsed under a <details> dropdown
    if (allSegments.length) {
      const details = document.createElement('details');
      details.style.cssText = 'margin-top:4px;';
      const summary = document.createElement('summary');
      const exclCount = allSegments.filter(s => excludedSet.has(s.idx)).length;
      summary.style.cssText = 'font-size:12px;font-weight:700;color:#111;cursor:pointer;user-select:none;list-style:none;display:flex;align-items:center;gap:5px;padding:3px 0;';
      summary.innerHTML = `<span style="font-size:10px;color:#444;">▶</span><span>Fragments (${allSegments.length - exclCount}/${allSegments.length})</span>`;
      details.addEventListener('toggle', () => {
        const arrow = summary.querySelector('span:first-child');
        if (arrow) arrow.textContent = details.open ? '▼' : '▶';
      });

      const list = document.createElement('div');
      list.style.cssText = 'display:flex;flex-direction:column;gap:2px;margin-top:3px;';
      allSegments.forEach(seg => {
        const excluded = excludedSet.has(seg.idx);
        const r = document.createElement('div');
        r.style.cssText = 'display:flex;align-items:center;gap:5px;' + (excluded ? 'opacity:0.5;' : '');
        const dot = document.createElement('span');
        dot.style.cssText = `flex-shrink:0;width:8px;height:8px;border-radius:2px;background:${excluded ? '#777' : TL_COLORS[seg.idx%TL_COLORS.length]};`;
        const timing = document.createElement('span');
        timing.style.cssText = 'flex-shrink:0;font-size:9px;color:#555;white-space:nowrap;min-width:82px;' + (excluded ? 'text-decoration:line-through;' : '');
        timing.textContent = `${seg.start.toFixed(2)}s–${seg.end.toFixed(2)}s (${seg.dur.toFixed(2)}s)`;
        const text = document.createElement('span');
        text.style.cssText = 'font-size:9px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;' + (excluded ? 'text-decoration:line-through;color:#888;' : 'color:#333;');
        text.textContent = seg.cell.line || `Fr. ${seg.idx+1}`;
        const toggleBtn = document.createElement('button');
        toggleBtn.textContent = excluded ? '↺' : '×';
        toggleBtn.title = excluded ? 'Include fragment' : 'Exclude fragment';
        toggleBtn.style.cssText = `flex-shrink:0;font-size:9px;padding:0 4px;cursor:pointer;line-height:1.4;border:1px solid ${excluded ? '#4a7a4a' : '#c05050'};background:${excluded ? '#2a3a2a' : '#3a2020'};color:${excluded ? '#8fc' : '#faa'};border-radius:2px;`;
        toggleBtn.addEventListener('click', () => {
          const d = getTimelineData();
          if (!d[sessionKey]) d[sessionKey] = {};
          const excl = new Set(d[sessionKey].excludedSegments || []);
          if (excluded) excl.delete(seg.idx); else excl.add(seg.idx);
          d[sessionKey].excludedSegments = [...excl];
          setTimelineData(d);
          renderAllTimelines();
        });
        r.appendChild(dot); r.appendChild(timing); r.appendChild(text); r.appendChild(toggleBtn);
        list.appendChild(r);
      });
      details.appendChild(summary);
      details.appendChild(list);
      leftCol.appendChild(details);

      // ── Subtitle generation row ──────────────────────────────────────────
      const sttRow = document.createElement('div');
      sttRow.style.cssText = 'display:flex;align-items:center;gap:5px;margin-top:5px;flex-wrap:wrap;';

      const sttBtn = document.createElement('button');
      sttBtn.textContent = '🎙 Subtitles';
      sttBtn.style.cssText = 'font-size:10px;font-weight:700;padding:3px 9px;cursor:pointer;border:1.5px solid #5a7a5a;background:#e8f0e8;color:#2a5a2a;border-radius:3px;white-space:nowrap;';

      const sttHelp = document.createElement('span');
      sttHelp.textContent = '?';
      sttHelp.title = 'Automatic transcription of each fragment audio.\n\n⚡ Groq Whisper (priority) — fast, free. Add GROQ_API_KEY to .env or Brain → CreationEngines → API Keys.\n\n☁ kie.ai ElevenLabs (fallback) — if Groq key not configured.\n\nCreates an .srt subtitle file with precise timestamps synchronized to the video timeline.';
      sttHelp.style.cssText = 'font-size:9px;font-weight:700;color:#666;border:1px solid #aaa;border-radius:50%;width:14px;height:14px;display:inline-flex;align-items:center;justify-content:center;cursor:help;flex-shrink:0;';

      const sttStatus = document.createElement('span');
      sttStatus.style.cssText = 'font-size:9px;color:#666;';

      const assBtn = document.createElement('button');
      assBtn.textContent = '{ }';
      assBtn.title = 'Subtitle style settings (libass):\nfonts, colors, outline, animations, position';
      assBtn.style.cssText = 'font-size:10px;font-weight:700;padding:2px 7px;cursor:pointer;border:1.5px solid #5a6a9a;background:#e8eaf8;color:#2a3a7a;border-radius:3px;white-space:nowrap;';
      assBtn.addEventListener('click', () => _openAssModal(sessionKey));

      sttRow.appendChild(sttBtn);
      sttRow.appendChild(sttHelp);
      sttRow.appendChild(assBtn);
      sttRow.appendChild(sttStatus);

      // Result row (hidden until done)
      const sttResultRow = document.createElement('div');
      sttResultRow.style.cssText = 'display:none;flex-direction:column;gap:4px;margin-top:4px;';

      const sttResultBtns = document.createElement('div');
      sttResultBtns.style.cssText = 'display:flex;gap:5px;align-items:center;';

      const sttDownBtn = document.createElement('a');
      sttDownBtn.textContent = '⬇ Download .srt';
      sttDownBtn.style.cssText = 'font-size:10px;font-weight:700;padding:3px 8px;border:1.5px solid #5a7a9a;background:#e8edf8;color:#2a4a7a;border-radius:3px;text-decoration:none;cursor:pointer;';

      const sttPreviewBtn = document.createElement('button');
      sttPreviewBtn.textContent = '👁 Preview';
      sttPreviewBtn.style.cssText = 'font-size:10px;font-weight:700;padding:3px 8px;border:1.5px solid #888;background:#f0f0f0;color:#333;border-radius:3px;cursor:pointer;';

      const sttPreviewBox = document.createElement('pre');
      sttPreviewBox.style.cssText = 'display:none;font-size:9px;font-family:monospace;color:#222;background:#f8f8f8;border:1px solid #ccc;border-radius:3px;padding:5px 7px;max-height:140px;overflow-y:auto;white-space:pre-wrap;word-break:break-word;margin:0;';

      sttPreviewBtn.addEventListener('click', () => {
        const open = sttPreviewBox.style.display === 'none';
        sttPreviewBox.style.display = open ? 'block' : 'none';
        sttPreviewBtn.textContent = open ? '▲ Hide' : '👁 Preview';
      });

      sttResultBtns.appendChild(sttDownBtn);
      sttResultBtns.appendChild(sttPreviewBtn);
      sttResultRow.appendChild(sttResultBtns);
      sttResultRow.appendChild(sttPreviewBox);
      leftCol.appendChild(sttRow);
      leftCol.appendChild(sttResultRow);

      // STT generation handler
      sttBtn.addEventListener('click', async () => {
        const segsForStt = activeSegments.filter(s => s.cell.audioPath);
        if (!segsForStt.length) { sttStatus.textContent = '⚠ No audio'; return; }
        sttBtn.disabled = true;
        sttStatus.textContent = 'Requesting…';
        sttResultRow.style.display = 'none';
        sttPreviewBox.style.display = 'none';
        sttPreviewBtn.textContent = '👁 Preview';

        try {
          const r = await fetch('/api/audio/stt', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              segments: segsForStt.map(s => ({
                audioPath:  s.cell.audioPath,
                timeOffset: s.activeStart,
              })),
            }),
          });
          const rj = await r.json();
          if (!rj.success) throw new Error(rj.error || 'Launch error');
          const { jobId } = rj;
          sttStatus.textContent = rj.provider === 'groq' ? '⚡ Groq…' : '☁ kie.ai…';

          // Poll
          const poll = setInterval(async () => {
            try {
              const sr = await fetch(`/api/audio/stt/status/${jobId}`);
              const sj = await sr.json();
              if (!sj.success) return;

              if (sj.state === 'done') {
                clearInterval(poll);
                sttBtn.disabled = false;
                sttStatus.textContent = '✓ Done';

                // Download link
                sttDownBtn.href = sj.srtPath;
                sttDownBtn.download = `subtitles_${scenName}.srt`;

                // Preview
                sttPreviewBox.textContent = sj.srtContent || '';
                sttResultRow.style.display = 'flex';

                // Store parsed subtitles + raw words in session for render
                const parsedSubs = _parseSrt(sj.srtContent || '');
                const _d = getTimelineData();
                if (!_d[sessionKey]) _d[sessionKey] = {};
                _d[sessionKey].srtSubtitles = parsedSubs;
                _d[sessionKey].srtWords     = sj.words || [];
                setTimelineData(_d);

              } else if (sj.state === 'failed') {
                clearInterval(poll);
                sttBtn.disabled = false;
                sttStatus.textContent = '⚠ ' + (sj.error || 'Error').slice(0, 60);
              } else {
                const prog = sj.progress ? ` (${sj.progress})` : '…';
                sttStatus.textContent = `Processing${prog}`;
              }
            } catch {}
          }, 3000);

        } catch (e) {
          sttBtn.disabled = false;
          sttStatus.textContent = '⚠ ' + e.message.slice(0, 60);
        }
      });
    }

    // ── Right: biroly timings + action buttons ─────────────────────────────
    const rightArea = document.createElement('div');
    rightArea.className = 'timeline-col-right-area';

    const rightCol = document.createElement('div');
    rightCol.className = 'timeline-col-right';
    rightCol.dataset.sessionKey = sessionKey;
    renderSessionBirolys(rightCol, sessionKey);
    rightArea.appendChild(rightCol);
    // ssCol (action buttons) will be appended to rightArea after construction below

    cols.appendChild(leftCol);
    cols.appendChild(rightArea);
    row.appendChild(cols);

    // ── Separator + per-project controls ────────────────────────────────────
    const hr = document.createElement('hr');
    hr.style.cssText = 'border:none;border-top:1px solid #a0a0a0;margin:6px 0 5px;';
    row.appendChild(hr);

    const controls = document.createElement('div');
    controls.style.cssText = 'display:flex;flex-direction:column;gap:5px;padding:0 4px 6px;font-size:10px;color:#444;';

    const makeSelect = (label, options, key) => {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'display:flex;align-items:center;gap:6px;';
      const lbl = document.createElement('span');
      lbl.style.cssText = 'white-space:nowrap;font-size:10px;color:#555;min-width:68px;';
      lbl.textContent = label + ':';
      const sel = document.createElement('select');
      sel.style.cssText = 'font-size:10px;padding:1px 3px;flex:1;max-width:120px;';
      options.forEach(opt => {
        const o = document.createElement('option');
        o.value = opt; o.textContent = opt;
        sel.appendChild(o);
      });
      const savedVal = (tlData[sessionKey] || {})[key];
      if (savedVal && options.includes(savedVal)) sel.value = savedVal;
      sel.addEventListener('change', () => {
        const d = getTimelineData();
        if (!d[sessionKey]) d[sessionKey] = {};
        d[sessionKey][key] = sel.value;
        setTimelineData(d);
      });
      wrap.appendChild(lbl); wrap.appendChild(sel);
      return wrap;
    };

    // ── FFmpeg transition options ──────────────────────────────────────────────
    // Paired transitions: applied at start AND end of each clip
    const SEG_TRANS_OPTS = [
      { v:'none',       l:'None' },
      { v:'fade',       l:'Fade (black)' },
      { v:'fadewhite',  l:'Fade (white)' },
      { v:'fadegrays',  l:'Fade (gray)' },
      { v:'blur',       l:'Blur In/Out' },
    ];
    const BIRO_TRANS_OPTS = [
      { v:'none',       l:'None' },
      { v:'fade',       l:'Fade (black)' },
      { v:'fadewhite',  l:'Fade (white)' },
      { v:'fadegrays',  l:'Fade (gray)' },
      { v:'blur',       l:'Blur In/Out' },
    ];
    const ANIM_OPTS = [
      { v:'none',     l:'None' },
      { v:'zoom_in',  l:'Zoom In (slow)' },
      { v:'zoom_out', l:'Zoom Out (slow)' },
      { v:'vignette', l:'Vignette' },
      { v:'sharpen',  l:'Sharpen' },
      { v:'warm',     l:'Warm tone' },
      { v:'cool',     l:'Cool tone' },
    ];

    const _makeVolumeRow = (label, tlKey, defaultVal) => {
      const row = document.createElement('div');
      row.className = 'ss-param-row';
      const lbl = document.createElement('span');
      lbl.className = 'ss-param-lbl'; lbl.textContent = label;
      const slider = document.createElement('input');
      slider.type = 'range'; slider.min = '0'; slider.max = '2'; slider.step = '0.05';
      slider.className = 'ss-vol-slider';
      const saved = sessData[tlKey];
      slider.value = (saved != null && !isNaN(saved)) ? saved : defaultVal;
      slider.addEventListener('input', () => {
        const d = getTimelineData(); if (!d[sessionKey]) d[sessionKey] = {};
        d[sessionKey][tlKey] = parseFloat(slider.value); setTimelineData(d);
      });
      row.appendChild(lbl); row.appendChild(slider);
      return row;
    };

    const _makeSettingRow = (label, opts, tlKey, defaultVal) => {
      const row = document.createElement('div');
      row.className = 'ss-param-row';
      const lbl = document.createElement('span');
      lbl.className = 'ss-param-lbl'; lbl.textContent = label;
      const sel = document.createElement('select');
      sel.className = 'ss-param-sel';
      opts.forEach(o => {
        const opt = document.createElement('option'); opt.value = o.v; opt.textContent = o.l; sel.appendChild(opt);
      });
      const saved = (sessData)[tlKey];
      sel.value = (saved && opts.find(o => o.v === saved)) ? saved : (defaultVal || opts[0].v);
      sel.addEventListener('change', () => {
        const d = getTimelineData(); if (!d[sessionKey]) d[sessionKey] = {};
        d[sessionKey][tlKey] = sel.value; setTimelineData(d);
      });
      row.appendChild(lbl); row.appendChild(sel);
      return row;
    };

    // ── Two-column settings panel ──────────────────────────────────────────────
    const settingsPanel = document.createElement('div');
    settingsPanel.className = 'ss-settings-panel';

    const segCol = document.createElement('div');
    segCol.className = 'ss-settings-col';
    const segHdr = document.createElement('div');
    segHdr.className = 'ss-settings-col-hdr'; segHdr.textContent = '🎬 Talking head';
    segCol.appendChild(segHdr);
    segCol.appendChild(_makeVolumeRow('Volume', 'segVolume', 1.0));
    segCol.appendChild(_makeSettingRow('Transition', SEG_TRANS_OPTS, 'segTransition', 'fade'));
    segCol.appendChild(_makeSettingRow('Animation',  ANIM_OPTS,      'segAnimation',  'none'));
    const segSfxCtrl = makeSfxControl(sessionKey, tlData, 'segSfx');
    segCol.appendChild(segSfxCtrl.el);
    segCol.appendChild(_makeVolumeRow('SFX vol.', 'segSfxVolume', 0.45));

    const biroCol = document.createElement('div');
    biroCol.className = 'ss-settings-col';
    const biroHdr = document.createElement('div');
    biroHdr.className = 'ss-settings-col-hdr'; biroHdr.textContent = '🎭 Birols';
    biroCol.appendChild(biroHdr);
    biroCol.appendChild(_makeSettingRow('Transition', BIRO_TRANS_OPTS, 'biroTransition', 'fade'));
    biroCol.appendChild(_makeSettingRow('Animation',  ANIM_OPTS,       'biroAnimation',  'none'));
    const biroSfxCtrl = makeSfxControl(sessionKey, tlData, 'biroSfx');
    biroCol.appendChild(biroSfxCtrl.el);
    biroCol.appendChild(_makeVolumeRow('SFX vol.', 'biroSfxVolume', 0.45));

    settingsPanel.appendChild(segCol);
    settingsPanel.appendChild(biroCol);
    controls.appendChild(settingsPanel);

    // ── Music section (full width) ─────────────────────────────────────────────
    const getVideoDur = () => activeSegments.reduce((m, s) => Math.max(m, s.activeEnd || 0), 30);
    const musicCtrl = makeMusicControl(sessionKey, tlData, getVideoDur);

    const audioSection = document.createElement('details');
    audioSection.className = 'audio-section-details';
    const audioSummary = document.createElement('summary');
    audioSummary.className = 'audio-section-summary';
    audioSummary.textContent = '🎵 Music';
    const musicVolSlider = document.createElement('input');
    musicVolSlider.type = 'range'; musicVolSlider.min = '0'; musicVolSlider.max = '2'; musicVolSlider.step = '0.05';
    musicVolSlider.className = 'ss-vol-slider ss-vol-slider-music';
    const savedMV = sessData.musicVolume;
    musicVolSlider.value = (savedMV != null && !isNaN(savedMV)) ? savedMV : 0.1;
    musicVolSlider.addEventListener('click', e => e.stopPropagation()); // prevent toggle
    musicVolSlider.addEventListener('input', () => {
      const d = getTimelineData(); if (!d[sessionKey]) d[sessionKey] = {};
      d[sessionKey].musicVolume = parseFloat(musicVolSlider.value); setTimelineData(d);
    });
    audioSummary.appendChild(musicVolSlider);
    audioSection.appendChild(audioSummary);
    audioSection.appendChild(musicCtrl.el);
    controls.appendChild(audioSection);
    // ── Action column ──────────────────────────────────────────────────────────
    const ssCol = document.createElement('div');
    ssCol.className = 'ss-action-col';

    const statusEl = document.createElement('div');
    statusEl.className = 'ss-status';

    const btnMerge = document.createElement('button');
    btnMerge.className = 'ss-btn ss-btn-merge';
    btnMerge.textContent = '▶ Merge';
    btnMerge.title = 'Render via FFmpeg locally';

    const btnMergeJson = document.createElement('button');
    btnMergeJson.className = 'ss-btn-json';
    btnMergeJson.textContent = '{ }';
    btnMergeJson.title = 'FFmpeg settings (resolution, quality, color, subtitles)';

    const btnSave = document.createElement('button');
    btnSave.className = 'ss-btn ss-btn-save';
    btnSave.textContent = '💾 Save';
    btnSave.title = 'Save video to archive';
    btnSave.disabled = true;
    _btnSaveRef = btnSave; // allow close-modal to reference it

    // Per-session state (renderUrl persisted to localStorage)
    const _SS_KEY = `ss_state_${sessionKey}`;
    const _ssStateStored = (() => { try { return JSON.parse(localStorage.getItem(_SS_KEY) || '{}'); } catch { return {}; } })();
    let _ssState = { renderUrl: _ssStateStored.renderUrl || null };

    function _updateVideoPreview(url) {
      videoPreviewWrap.innerHTML = '';
      if (url) {
        const vid = document.createElement('video');
        vid.src = url; vid.controls = true; vid.preload = 'metadata';
        vid.style.cssText = 'width:100%;max-height:220px;border-radius:3px;background:#000;display:block;';
        videoPreviewWrap.appendChild(vid);
      } else {
        videoPreviewWrap.innerHTML = '<div class="video-preview-placeholder">Preview will appear after render</div>';
      }
    }
    if (_ssState.renderUrl) { _updateVideoPreview(_ssState.renderUrl); btnSave.disabled = false; }

    function _setStatus(msg, cls = '') {
      statusEl.textContent = msg;
      statusEl.className = 'ss-status' + (cls ? ' ' + cls : '');
    }

    // ── СОХРАНИТЬ ─────────────────────────────────────────────────────────────
    btnSave.addEventListener('click', async () => {
      if (!_ssState.renderUrl) { _setStatus('No video URL', 'err'); return; }
      btnSave.disabled = true;
      _setStatus('Saving…', 'spin');

      try {
        const archive = typeof getBirolyArchive === 'function' ? getBirolyArchive() : [];
        const tlData  = getTimelineData();
        const sd      = tlData[sessionKey] || {};
        const projectData = {
          sessionKey,
          timelineData: sd,
          archive,
          frozenSession: editFrozenSessions[sessionKey] || null,
          scenFile: f.file,
          scenName: f.name,
          obrazId:  String(activeObraz.id),
          obrazName: activeObraz.name,
          obrazChar: activeObraz.char || '',
        };

        const r = await fetch('/api/finals/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            renderUrl:    _ssState.renderUrl,
            sessionLabel: _renderTitle,
            projectData,
          }),
        });
        const d = await r.json();
        if (!d.success) throw new Error(d.error || 'Error');
        _setStatus('Saved!', 'ok');
        window.loadFinals?.();
        window.loadComboFinals?.();
      } catch (e) {
        _setStatus(e.message, 'err');
        btnSave.disabled = false;
      }
    });

    // ── JSON VIEWER (modal elements) ─────────────────────────────────────────
    const _rbOverlay  = document.getElementById('rb-modal-overlay');
    const _rbTa       = document.getElementById('rb-modal-ta');
    const _rbErr      = document.getElementById('rb-modal-err');
    const _rbSaveBtn  = document.getElementById('rb-modal-save');
    const _rbCloseBtn = document.getElementById('rb-modal-close');

    function _closeRbModal() { _rbOverlay.classList.remove('open'); }
    _rbCloseBtn.addEventListener('click', _closeRbModal);
    _rbOverlay.addEventListener('click', e => { if (e.target === _rbOverlay) _closeRbModal(); });

    // Ctrl+S inside textarea — save; Escape — close
    _rbTa.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); _rbSaveBtn.click(); }
      if (e.key === 'Escape') _closeRbModal();
    });

    _rbSaveBtn.addEventListener('click', async () => {
      try {
        const parsed = JSON.parse(_rbTa.value);
        const jid = _rbSaveBtn._ffmpegJobId;
        if (jid) {
          const r = await fetch(`/api/ffmpeg/body/${jid}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(parsed),
          });
          const d = await r.json();
          if (!d.success) throw new Error(d.error || 'Save error');
        }
        _rbErr.style.color = '#9fe09f';
        _rbErr.textContent = '✓ Saved';
        setTimeout(() => { _rbErr.textContent = ''; _rbErr.style.color = ''; }, 2000);
      } catch (e) {
        _rbErr.style.color = '#e07070';
        _rbErr.textContent = '⚠ Error: ' + e.message;
      }
    });

    // ── МЕРДЖ (FFmpeg локально) ───────────────────────────────────────────────
    btnMerge.addEventListener('click', async () => {
      const archive   = typeof getBirolyArchive === 'function' ? getBirolyArchive() : [];
      const tlDataNow = getTimelineData();
      const sd        = tlDataNow[sessionKey] || {};
      const activated = sd.activated || [];
      const timings   = sd.timings   || {};

      const localClips = activated.map(idx => {
        const b = archive[idx]; const t = timings[idx];
        if (!b || !b.videoPath || !t || t.start === undefined) return null;
        return { videoPath: b.videoPath, name: b.name || 'Birol',
                 start: parseFloat(t.start)||0, end: parseFloat(t.end)||6, crop: parseFloat(t.crop)||0 };
      }).filter(Boolean).sort((a, b) => a.start - b.start);

      const localSegClips = activeSegments.filter(s => s.cell.videoPath).map(s => ({
        name: s.cell.line || `Fr.${s.idx+1}`, videoPath: s.cell.videoPath,
        start: s.activeStart, end: s.activeEnd, crop: 0,
      }));

      if (!localSegClips.length) { _setStatus('No segment videos', 'err'); return; }

      btnMerge.disabled = true;
      btnSave.disabled = true;
      _setStatus('Rendering…', 'spin');

      try {
        const advSettings   = { ...ADV_DEFAULTS, ...(sd.advSettings || {}) };
        const assSettings   = { ...ASS_DEFAULTS, ...(sd.assSettings || {}) };
        const subtitles     = advSettings.subsEnabled
          ? localSegClips.map(s => ({ text: s.name, start: s.start, end: s.end }))
          : [];
        const srtSubtitles    = sd.srtSubtitles    || [];
        const srtWords        = sd.srtWords        || [];
        const prebuiltAssPath = sd.prebuiltAssPath || null;

        const r = await fetch('/api/ffmpeg/render', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            segmentClips:   localSegClips,
            clips:          localClips,
            music:          musicCtrl.getUrl(),
            musicOffset:    musicCtrl.getOffset(),
            musicVolume:    sd.musicVolume   != null ? sd.musicVolume   : 0.1,
            segVolume:      sd.segVolume     != null ? sd.segVolume     : 1.0,
            segTransition:  sd.segTransition  || 'fade',
            segAnimation:   sd.segAnimation   || 'none',
            segSfx:         segSfxCtrl.getUrl(),
            segSfxVolume:   sd.segSfxVolume  != null ? sd.segSfxVolume  : 0.45,
            biroTransition: sd.biroTransition || 'fade',
            biroAnimation:  sd.biroAnimation  || 'none',
            biroSfx:        biroSfxCtrl.getUrl(),
            biroSfxVolume:  sd.biroSfxVolume != null ? sd.biroSfxVolume : 0.45,
            outputLabel:    _renderTitle,
            advSettings,
            subtitles,
            srtSubtitles,
            srtWords,
            assSettings,
            prebuiltAssPath,
          }),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status} — restart server`);
        const rj = await r.json();
        if (!rj.success) throw new Error(rj.error || 'Launch error');

        const { jobId } = rj;
        btnMergeJson._jobId = jobId;
        btnMergeJson.disabled = false;

        const poll = setInterval(async () => {
          try {
            const sr = await fetch(`/api/ffmpeg/status/${jobId}`);
            const sj = await sr.json();
            if (!sj.success) return;
            if (sj.status === 'done') {
              clearInterval(poll);
              _ssState.renderUrl = sj.url;
              try { const st2 = JSON.parse(localStorage.getItem(_SS_KEY)||'{}'); localStorage.setItem(_SS_KEY, JSON.stringify({...st2, renderUrl: sj.url})); } catch {}
              _updateVideoPreview(sj.url);
              btnSave.disabled = false;
              btnMerge.disabled = false;
              _setStatus('Done!', 'ok');
            } else if (sj.status === 'failed') {
              clearInterval(poll);
              btnMerge.disabled = false;
              _setStatus((sj.error || 'Render error').slice(0, 120), 'err');
            } else {
              const prog = sj.progressSecs > 0 ? ` (${sj.progressSecs.toFixed(0)}s)` : '';
              _setStatus(`Rendering…${prog}`, 'spin');
            }
          } catch {}
        }, 2000);
      } catch (e) {
        btnMerge.disabled = false;
        _setStatus(e.message.slice(0, 120), 'err');
      }
    });

    // ── НАСТРОЙКИ FFmpeg ──────────────────────────────────────────────────────
    btnMergeJson.addEventListener('click', () => _openAdvModal(sessionKey));

    const mergeRow = document.createElement('div');
    mergeRow.className = 'ss-merge-row';
    mergeRow.appendChild(btnMerge);
    mergeRow.appendChild(btnMergeJson);

    ssCol.appendChild(mergeRow);
    ssCol.appendChild(btnSave);
    ssCol.appendChild(statusEl);

    // Action buttons go to the bottom of the right (biroly) area
    rightArea.appendChild(ssCol);

    row.appendChild(controls);
    projectBody.appendChild(row);
    wrap.appendChild(projectWrap);
  }
}
window.renderAllTimelines = renderAllTimelines;

// Fast sync update — re-renders only the Биролы right columns already in the DOM.
// Called by toggleActiveBiroly so birolys appear instantly without waiting for async render.
function refreshTimelineBirolys() {
  document.querySelectorAll('.timeline-col-right[data-session-key]').forEach(col => {
    renderSessionBirolys(col, col.dataset.sessionKey);
  });
}
window.refreshTimelineBirolys = refreshTimelineBirolys;

function updateActiveScenariosList() {
  const panel = document.getElementById('active-scenarios-panel');
  if (!panel) return;

  // Find scenario filenames that have at least one non-empty assignment
  const activeFiles = scenarioFiles.filter(f =>
    Object.entries(scenarioAssignments).some(
      ([key, val]) => key.startsWith(f.file + '__') && val
    )
  );

  panel.innerHTML = '';
  if (!activeFiles.length) {
    panel.style.display = 'none';
    return;
  }

  panel.style.display = 'block';
  const header = document.createElement('div');
  header.className = 'active-scen-header';
  header.textContent = 'Active scenarios';
  panel.appendChild(header);

  activeFiles.forEach(f => {
    const row = document.createElement('div');
    row.className = 'active-scen-item';

    const name = document.createElement('span');
    name.className = 'active-scen-name';
    name.textContent = f.name;

    // Count assigned lines
    const count = Object.entries(scenarioAssignments).filter(
      ([key, val]) => key.startsWith(f.file + '__') && val
    ).length;
    const badge = document.createElement('span');
    badge.className = 'active-scen-badge';
    badge.textContent = count;

    row.appendChild(name);
    row.appendChild(badge);
    panel.appendChild(row);
  });

  renderEditPanel();
}

async function loadScenarioAssignments() {
  try {
    const d = await fetch('/api/scenarios/assignments').then(r => r.json());
    if (d.success && d.assignments) {
      // Merge: localStorage (auto-saved on every change) wins over server.
      // This prevents a slow/stale server response from wiping locally-set assignments.
      const ls = (() => {
        try { return JSON.parse(localStorage.getItem(LS_SCENARIO_ASSIGNMENTS) || '{}'); } catch { return {}; }
      })();
      scenarioAssignments = Object.keys(ls).length > 0 ? ls : d.assignments;
      _saveAssignmentsToLS();
    }
  } catch {}
}

async function saveScenarioAssignments() {
  await fetch('/api/scenarios/assignments', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assignments: scenarioAssignments }),
  });
}

// ── Per-scenario modified lines storage (localStorage) ───────────────────────
function getModifiedLines(filename) {
  try {
    const raw = localStorage.getItem('scen_lines_v1__' + filename);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function saveModifiedLines(filename, lines) {
  localStorage.setItem('scen_lines_v1__' + filename, JSON.stringify(lines));
}
function clearModifiedLines(filename) {
  localStorage.removeItem('scen_lines_v1__' + filename);
}

// Re-index assignments after a line deletion so keys stay correct
function reindexAssignments(filename, deletedIdx, totalBefore) {
  delete scenarioAssignments[`${filename}__${deletedIdx}`];
  for (let j = deletedIdx + 1; j < totalBefore; j++) {
    const oldKey = `${filename}__${j}`;
    const newKey = `${filename}__${j - 1}`;
    if (scenarioAssignments[oldKey] != null) {
      scenarioAssignments[newKey] = scenarioAssignments[oldKey];
    } else {
      delete scenarioAssignments[newKey];
    }
    delete scenarioAssignments[oldKey];
  }
  _saveAssignmentsToLS();
}

// ── Build scenario item ───────────────────────────────────────────────────────
function buildScenarioItem(file, detailFiles) {
  const item = document.createElement('div');
  item.className = 'scenario-item';

  const header = document.createElement('div');
  header.className = 'scenario-item-header';

  // Delete scenario button (two-click confirmation — no browser dialog)
  const delBtn = document.createElement('button');
  delBtn.className = 'scenario-del-btn'; delBtn.textContent = '🗑'; delBtn.title = 'Delete scenario';
  let delConfirmTimer = null;
  delBtn.addEventListener('click', async e => {
    e.stopPropagation();
    // First click: arm confirmation
    if (!delBtn.dataset.armed) {
      delBtn.dataset.armed = '1';
      delBtn.textContent = '✓';
      delBtn.title = 'Click again to confirm';
      delBtn.style.background = '#ffcccc';
      delConfirmTimer = setTimeout(() => {
        delBtn.dataset.armed = '';
        delBtn.textContent = '🗑';
        delBtn.title = 'Delete scenario';
        delBtn.style.background = '';
      }, 3000);
      return;
    }
    // Second click within 3 s: execute
    clearTimeout(delConfirmTimer);
    delBtn.dataset.armed = '';
    delBtn.textContent = '🗑';
    delBtn.style.background = '';
    delBtn.disabled = true;
    try {
      const r = await fetch('/api/scenarios/delete', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.file }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error);
      clearModifiedLines(file.file);
      scenarioFiles = scenarioFiles.filter(f => f.file !== file.file);
      Object.keys(scenarioAssignments).forEach(k => {
        if (k.startsWith(file.file + '__')) delete scenarioAssignments[k];
      });
      _saveAssignmentsToLS();
      updateActiveScenariosList();
      item.remove();
      setStatus(`Scenario moved to database: ${file.name}`);
    } catch (err) {
      delBtn.disabled = false;
      setStatus('Error: ' + err.message);
    }
  });

  // Restore default lines button
  const restoreBtn = document.createElement('button');
  restoreBtn.className = 'scenario-del-btn';
  restoreBtn.textContent = '↺'; restoreBtn.title = 'Restore default rows';
  restoreBtn.style.color = '#006600';
  restoreBtn.addEventListener('click', async e => {
    e.stopPropagation();
    clearModifiedLines(file.file);
    // Clear all assignments for this scenario
    Object.keys(scenarioAssignments).forEach(key => {
      if (key.startsWith(file.file + '__')) delete scenarioAssignments[key];
    });
    // Immediately reset any currently visible dropdowns in DOM
    body.querySelectorAll('.scenario-detail-select').forEach(s => { s.value = ''; });
    _saveAssignmentsToLS();
    await saveScenarioAssignments();
    updateActiveScenariosList();
    await renderBody();
    setStatus('Rows and assignments restored.');
  });

  const toggle = document.createElement('span');
  toggle.className = 'scenario-toggle'; toggle.textContent = '▶';

  const title = document.createElement('span');
  title.className = 'scenario-title'; title.textContent = file.name;

  header.appendChild(delBtn); header.appendChild(restoreBtn);
  header.appendChild(toggle); header.appendChild(title);

  const body = document.createElement('div');
  body.className = 'scenario-body';

  // ── Render body from a lines array ──────────────────────────────────────────
  async function renderBody() {
    body.innerHTML = '<span style="font-size:11px;color:#888;">Loading…</span>';
    try {
      // Use modified lines from localStorage if available, else fetch from API
      let lines = getModifiedLines(file.file);
      if (!lines) {
        const d = await fetch(`/api/scenarios/${encodeURIComponent(file.file)}`).then(r => r.json());
        lines = d.lines;
      }
      scenarioLinesCache[file.file] = lines; // keep cache fresh
      body.innerHTML = '';

      // Save assignments button
      const saveRow = document.createElement('div');
      saveRow.style.cssText = 'margin-bottom:6px;display:flex;gap:6px;';
      const saveBtn = document.createElement('button');
      saveBtn.textContent = '💾 Save assignments'; saveBtn.style.fontSize = '11px';
      saveBtn.addEventListener('click', async () => {
        saveBtn.disabled = true;
        await saveScenarioAssignments();
        setStatus('Assignments saved.');
        saveBtn.disabled = false;
      });
      saveRow.appendChild(saveBtn);
      body.appendChild(saveRow);

      // Render each line
      lines.forEach((line, i) => {
        const row = document.createElement('div');
        row.className = 'scenario-line';

        const num = document.createElement('span');
        num.className = 'scenario-line-num'; num.textContent = i + 1;

        const text = document.createElement('input');
        text.type = 'text';
        text.className = 'scenario-line-text';
        text.value = line;
        text.title = 'Click to edit';
        text.addEventListener('change', () => {
          lines[i] = text.value;
          saveModifiedLines(file.file, lines);
          scenarioLinesCache[file.file] = [...lines];
        });

        const sel = document.createElement('select');
        sel.className = 'scenario-detail-select';
        const blank = document.createElement('option');
        blank.value = ''; blank.textContent = '— item —';
        sel.appendChild(blank);
        detailFiles.forEach(df => {
          const opt = document.createElement('option');
          opt.value = df.file; opt.textContent = df.name;
          sel.appendChild(opt);
        });
        const key = `${file.file}__${i}`;
        if (scenarioAssignments[key]) sel.value = scenarioAssignments[key];
        sel.addEventListener('change', () => {
          scenarioAssignments[key] = sel.value;
          _saveAssignmentsToLS();     // immediate localStorage — survives tab switch
          saveScenarioAssignments();  // async server backup
          // Push change into every pending session for this scenFile so pairs
          // are stored in the session body and survive all re-renders/reloads
          Object.values(editFrozenSessions).forEach(sess => {
            if (sess.scenFile === file.file) {
              if (!sess.assignments) sess.assignments = {};
              if (sel.value) sess.assignments[key] = sel.value;
              else delete sess.assignments[key];
            }
          });
          saveEditState();
          updateActiveScenariosList();
        });

        // Delete line button
        const lineDelBtn = document.createElement('button');
        lineDelBtn.className = 'scenario-line-del';
        lineDelBtn.textContent = '✕'; lineDelBtn.title = 'Delete row';
        lineDelBtn.addEventListener('click', () => {
          reindexAssignments(file.file, i, lines.length);
          lines.splice(i, 1);
          saveModifiedLines(file.file, lines);
          renderBody();
        });

        row.appendChild(num); row.appendChild(text); row.appendChild(sel); row.appendChild(lineDelBtn);
        body.appendChild(row);
      });
    } catch { body.textContent = 'Load error'; }
  }

  header.addEventListener('click', async e => {
    const open = body.classList.toggle('open');
    toggle.textContent = open ? '▼' : '▶';
    if (open) await renderBody();
  });

  item.appendChild(header); item.appendChild(body);
  return item;
}

// ── Archive (База данных) ─────────────────────────────────────────────────────
async function loadArchivedScenarios() {
  const list = document.getElementById('scenario-archive-list');
  if (!list) return;
  list.innerHTML = '<span style="color:#888;font-size:11px;">Loading…</span>';
  try {
    const d = await fetch('/api/scenarios/archive').then(r => r.json());
    list.innerHTML = '';
    if (!d.files.length) {
      list.innerHTML = '<div style="color:#888;font-size:11px;padding:8px 0;">Archive is empty</div>';
      return;
    }
    d.files.forEach(f => {
      const row = document.createElement('div');
      row.className = 'scen-archive-item';

      const name = document.createElement('span');
      name.className = 'scen-archive-name';
      name.textContent = f.name;

      const date = document.createElement('span');
      date.className = 'scen-archive-date';
      date.textContent = new Date(f.mtime).toLocaleDateString('en-GB');

      const restoreBtn = document.createElement('button');
      restoreBtn.className = 'scen-archive-btn restore';
      restoreBtn.textContent = '↩ Restore';
      restoreBtn.addEventListener('click', async () => {
        restoreBtn.disabled = true;
        try {
          const r = await fetch('/api/scenarios/restore', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: f.file }),
          });
          const res = await r.json();
          if (!res.success) throw new Error(res.error);
          row.remove();
          setStatus(`Scenario restored: ${f.name}`);
          loadScenarios(); // refresh active list
        } catch (err) {
          setStatus('Error: ' + err.message);
          restoreBtn.disabled = false;
        }
      });

      const purgeBtn = document.createElement('button');
      purgeBtn.className = 'scen-archive-btn purge';
      purgeBtn.textContent = '🗑';
      let purgeTimer = null;
      purgeBtn.addEventListener('click', async () => {
        if (!purgeBtn.dataset.armed) {
          purgeBtn.dataset.armed = '1';
          purgeBtn.textContent = '✓?';
          purgeBtn.style.background = '#ffcccc';
          purgeTimer = setTimeout(() => {
            purgeBtn.dataset.armed = '';
            purgeBtn.textContent = '🗑';
            purgeBtn.style.background = '';
          }, 3000);
          return;
        }
        clearTimeout(purgeTimer);
        purgeBtn.dataset.armed = '';
        purgeBtn.textContent = '🗑';
        purgeBtn.style.background = '';
        purgeBtn.disabled = true;
        try {
          const r = await fetch('/api/scenarios/archive/purge', {
            method: 'DELETE', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: f.file }),
          });
          const res = await r.json();
          if (!res.success) throw new Error(res.error);
          row.remove();
          if (!list.querySelector('.scen-archive-item')) {
            list.innerHTML = '<div style="color:#888;font-size:11px;padding:8px 0;">Archive is empty</div>';
          }
          setStatus(`Permanently deleted: ${f.name}`);
        } catch (err) {
          setStatus('Error: ' + err.message);
          purgeBtn.disabled = false;
        }
      });

      row.appendChild(name);
      row.appendChild(date);
      row.appendChild(restoreBtn);
      row.appendChild(purgeBtn);
      list.appendChild(row);
    });
  } catch {
    list.innerHTML = '<div style="color:#888;font-size:11px;">Load error</div>';
  }
}

// ── Load scenarios ────────────────────────────────────────────────────────────
const scenarioList = document.getElementById('scenario-list');

async function loadScenarios() {
  if (!scenarioList) return;
  try {
    const [sd, dd] = await Promise.all([
      fetch('/api/scenarios').then(r => r.json()),
      fetch('/api/details').then(r => r.json()),
    ]);
    await loadScenarioAssignments();
    scenarioFiles     = sd.files || [];
    cachedDetailFiles = dd.success ? dd.files : [];
    scenarioList.innerHTML = '';
    if (!sd.files.length) {
      scenarioList.innerHTML = '<div style="color:#888;font-size:11px;">No scenarios</div>';
      updateActiveScenariosList();
      return;
    }
    sd.files.forEach(f => scenarioList.appendChild(buildScenarioItem(f, cachedDetailFiles)));
    updateActiveScenariosList();
    updateAutofillPanel();
  } catch { scenarioList.innerHTML = '<div style="color:#888;font-size:11px;">Load error</div>'; }
  // Also refresh the образы panel whenever scenarios reload
  loadScenarioObrazы();
}

// ── Образы catalog in Сценарии right column ───────────────────────────────────
// Hidden set: образы the user removed from this view (persisted in localStorage)
const SCEN_HIDDEN_KEY = 'scen_hidden_obrazy_v1';

function getHiddenObrazы() {
  try { return new Set(JSON.parse(localStorage.getItem(SCEN_HIDDEN_KEY) || '[]')); } catch { return new Set(); }
}
function hideObraz(id) {
  const s = getHiddenObrazы(); s.add(String(id));
  localStorage.setItem(SCEN_HIDDEN_KEY, JSON.stringify([...s]));
}

function loadScenarioObrazы() {
  const row = document.getElementById('scenarii-obrazy-row');
  if (!row) return;

  const hidden     = getHiddenObrazы();
  const allObrazы  = getObrazы?.() || [];
  const curProjId  = getCurrentProjectId?.() || null;

  // Filter out hidden; sort: current-project ones first, then rest by date desc
  const visible = allObrazы.filter(o => !hidden.has(String(o.id)));
  if (!visible.length) {
    row.innerHTML = '<span style="color:#888;font-size:11px;">No outfits</span>';
    return;
  }

  const projOnes  = visible.filter(o => o.projectId === curProjId && curProjId);
  const otherOnes = visible.filter(o => o.projectId !== curProjId || !curProjId);
  const sorted    = [...projOnes, ...otherOnes];

  row.innerHTML = '';
  sorted.forEach(obraz => {
    if (!obraz.char) return; // skip obrazы without a character image

    // Pending if variations array has nulls (generation still in progress)
    const hasPending = Array.isArray(obraz.variations) && obraz.variations.length > 0
      && obraz.variations.some(v => v === null);

    const wrap = document.createElement('div');
    wrap.className = 'scen-obraz-wrap';
    if (hasPending) wrap.style.opacity = '0.5';

    const img = document.createElement('img');
    img.src = obraz.char + '?t=' + Date.now();
    img.className = 'scen-obraz-thumb' + (obraz.projectId === curProjId && curProjId ? ' proj-obraz' : '');

    if (hasPending) {
      img.style.cursor = 'not-allowed';
      img.title = obraz.name + ' · generating variations…';
    } else {
      img.title = obraz.name + ' · click to select / deselect';
      img.addEventListener('click', () => setActiveObraz(obraz.id, wrap));
    }

    // Restore active state if this образ was previously selected
    if (activeObrazIds.has(obraz.id)) wrap.classList.add('obraz-active');

    const name = document.createElement('div');
    name.className = 'scen-obraz-name';
    name.textContent = hasPending ? '⏳ ' + obraz.name : obraz.name;

    const delBtn = document.createElement('button');
    delBtn.className = 'scen-obraz-del';
    delBtn.textContent = '✕';
    delBtn.title = 'Remove from project';
    delBtn.addEventListener('click', e => {
      e.stopPropagation();
      hideObraz(obraz.id);
      wrap.remove();
      if (!row.querySelector('.scen-obraz-wrap')) {
        row.innerHTML = '<span style="color:#888;font-size:11px;">No outfits</span>';
      }
    });

    wrap.appendChild(img);
    wrap.appendChild(name);
    wrap.appendChild(delBtn);
    row.appendChild(wrap);
  });
}

// ── Upload scenario file ──────────────────────────────────────────────────────
const scenarioDropzone  = document.getElementById('scenario-dropzone');
const scenarioInput     = document.getElementById('scenario-input');
const scenarioFileLabel = document.getElementById('scenario-file-label');
const scenarioNameInput = document.getElementById('scenario-name');
const btnScenarioUpload = document.getElementById('btn-scenario-upload');
let scenarioBlob = null;

scenarioDropzone?.addEventListener('click', () => scenarioInput?.click());
scenarioDropzone?.addEventListener('dragover', e => { e.preventDefault(); scenarioDropzone.classList.add('drag-over'); });
scenarioDropzone?.addEventListener('dragleave', () => scenarioDropzone.classList.remove('drag-over'));
scenarioDropzone?.addEventListener('drop', e => {
  e.preventDefault(); scenarioDropzone.classList.remove('drag-over');
  const f = e.dataTransfer.files[0];
  if (!f || !f.name.endsWith('.txt')) { setStatus('Only .txt files allowed.'); return; }
  scenarioBlob = f; scenarioFileLabel.textContent = f.name;
  scenarioDropzone.classList.add('has-file'); btnScenarioUpload.disabled = false;
});
scenarioInput?.addEventListener('change', () => {
  const f = scenarioInput.files[0]; if (!f) return;
  scenarioBlob = f; scenarioFileLabel.textContent = f.name;
  scenarioDropzone.classList.add('has-file'); btnScenarioUpload.disabled = false;
});

btnScenarioUpload?.addEventListener('click', async () => {
  if (!scenarioBlob) return;
  btnScenarioUpload.disabled = true; setStatus('Uploading scenario…');
  try {
    const base64 = await blobToBase64(scenarioBlob);
    const r = await fetch('/api/scenarios/upload', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ textBase64: base64, name: scenarioNameInput.value.trim() }),
    });
    const d = await r.json();
    if (!d.success) throw new Error(d.error);
    setStatus(`Scenario saved: ${d.name}`);
    scenarioBlob = null;
    scenarioFileLabel.textContent = 'Click or drag a .txt file';
    scenarioDropzone.classList.remove('has-file');
    scenarioNameInput.value = ''; scenarioInput.value = '';
    loadScenarios();
  } catch (e) { setStatus('Error: ' + e.message); }
  finally { btnScenarioUpload.disabled = false; }
});

// ── Manual text input ─────────────────────────────────────────────────────────
document.getElementById('btn-scenario-manual-upload')?.addEventListener('click', async () => {
  const text = document.getElementById('scenario-manual-text')?.value.trim();
  if (!text) { setStatus('Enter scenario text.'); return; }
  const btn = document.getElementById('btn-scenario-manual-upload');
  btn.disabled = true; setStatus('Saving scenario…');
  try {
    const base64 = btoa(unescape(encodeURIComponent(text)));
    const r = await fetch('/api/scenarios/upload', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ textBase64: base64, name: document.getElementById('scenario-manual-name')?.value.trim() }),
    });
    const d = await r.json();
    if (!d.success) throw new Error(d.error);
    setStatus(`Scenario saved: ${d.name}`);
    document.getElementById('scenario-manual-text').value = '';
    document.getElementById('scenario-manual-name').value = '';
    loadScenarios();
  } catch (e) { setStatus('Error: ' + e.message); }
  finally { btn.disabled = false; }
});

// ── Active detail selection ───────────────────────────────────────────────────
const activeDetailFiles = new Set(); // file names of selected details

function toggleDetailActive(file, cardEl) {
  if (activeDetailFiles.has(file)) {
    activeDetailFiles.delete(file);
    cardEl.classList.remove('detail-selected');
  } else {
    activeDetailFiles.add(file);
    cardEl.classList.add('detail-selected');
  }
  updateAutofillPanel();
}

function updateAutofillPanel() {
  const panel = document.getElementById('detail-autofill-panel');
  if (!panel) return;
  if (activeDetailFiles.size < 1) { panel.style.display = 'none'; return; }
  panel.style.display = 'block';
  // Populate scenario dropdown with current scenarioFiles list
  const sel = document.getElementById('detail-autofill-scenario');
  if (sel) {
    const prev = sel.value;
    sel.innerHTML = '';
    if (!scenarioFiles.length) {
      const opt = document.createElement('option'); opt.value = ''; opt.textContent = 'No scenarios'; sel.appendChild(opt);
    } else {
      scenarioFiles.forEach(f => {
        const opt = document.createElement('option'); opt.value = f.file; opt.textContent = f.name; sel.appendChild(opt);
      });
      if (prev && [...sel.options].some(o => o.value === prev)) sel.value = prev;
    }
  }
}

document.getElementById('btn-detail-autofill')?.addEventListener('click', async () => {
  const scenFile = document.getElementById('detail-autofill-scenario')?.value;
  const pct      = Math.max(1, Math.min(100, Number(document.getElementById('detail-autofill-pct')?.value) || 60));
  if (!scenFile) { setStatus('Select a scenario.'); return; }
  if (!activeDetailFiles.size) { setStatus('No active items.'); return; }

  // Get lines for the scenario (use cache or fetch)
  const lines = await getLinesForScenario(scenFile);
  if (!lines.length) { setStatus('Scenario is empty.'); return; }

  const detailArr = [...activeDetailFiles];
  const count     = Math.max(1, Math.round(lines.length * pct / 100));

  // Pick `count` random line indices (without repetition if count ≤ lines.length)
  const indices = [];
  const pool    = lines.map((_, i) => i);
  while (indices.length < count && pool.length) {
    const r = Math.floor(Math.random() * pool.length);
    indices.push(pool.splice(r, 1)[0]);
  }

  // Assign a random detail from the active set to each picked line
  indices.forEach(i => {
    const det = detailArr[Math.floor(Math.random() * detailArr.length)];
    scenarioAssignments[`${scenFile}__${i}`] = det;
  });

  await saveScenarioAssignments();
  updateActiveScenariosList();

  // Re-render the open scenario body if it's currently visible
  const allBodies = document.querySelectorAll('.scenario-item');
  allBodies.forEach(item => {
    const titleEl = item.querySelector('.scenario-title');
    const scenObj = scenarioFiles.find(f => f.name === titleEl?.textContent && f.file === scenFile);
    if (scenObj) {
      const body = item.querySelector('.scenario-body');
      if (body?.classList.contains('open')) body.dispatchEvent(new Event('rerender'));
    }
  });

  setStatus(`Filled: ${count} of ${lines.length} rows (${pct}%)`);
});

// ── Details ───────────────────────────────────────────────────────────────────
const detailInput     = document.getElementById('detail-input');
const detailUrlInput  = document.getElementById('detail-url-input');
const btnDetailPick   = document.getElementById('btn-detail-file-pick');
const btnDetailUpload = document.getElementById('btn-detail-upload');
const detailNameInput = document.getElementById('detail-name');
const detailsGrid     = document.getElementById('details-grid');
let detailBlob = null;

function detailMarkReady(label) {
  if (detailUrlInput) detailUrlInput.value = label;
  if (btnDetailUpload) btnDetailUpload.disabled = false;
}
function detailClear() {
  if (detailUrlInput) detailUrlInput.value = '';
  if (detailInput)    detailInput.value = '';
  if (btnDetailUpload) btnDetailUpload.disabled = true;
  detailBlob = null;
}

// File picker button
btnDetailPick?.addEventListener('click', () => detailInput?.click());
detailInput?.addEventListener('change', () => {
  const f = detailInput.files[0]; if (!f) return;
  detailBlob = f;
  detailMarkReady(`📁 ${f.name}`);
});

// URL typed into the text field
detailUrlInput?.addEventListener('input', () => {
  const v = detailUrlInput.value.trim();
  if (v.startsWith('http')) {
    detailBlob = null;
    if (btnDetailUpload) btnDetailUpload.disabled = false;
  } else if (!detailBlob) {
    if (btnDetailUpload) btnDetailUpload.disabled = true;
  }
});

// Paste image from clipboard (Ctrl+V)
detailUrlInput?.addEventListener('paste', e => {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault();
      detailBlob = item.getAsFile();
      detailMarkReady('📋 Image pasted');
      return;
    }
  }
  // Plain text paste (URL) — handled by 'input' event
});

btnDetailUpload?.addEventListener('click', async () => {
  const urlVal = detailUrlInput?.value.trim() || '';
  if (!detailBlob && !urlVal.startsWith('http')) {
    setStatus('Upload a file or enter an image URL.'); return;
  }
  btnDetailUpload.disabled = true; setStatus('Saving item…');
  try {
    const body = { name: detailNameInput?.value.trim() };
    let base64 = null;
    if (detailBlob) {
      base64 = await blobToBase64(detailBlob);
      body.imageBase64 = base64;
    } else {
      body.imageUrl = urlVal;
    }
    const r = await fetch('/api/details/upload', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (!d.success) throw new Error(d.error);
    const savedName = detailNameInput?.value.trim() || d.name;
    const userNotes = document.getElementById('detail-user-notes')?.value.trim() || '';
    setStatus(`Item saved: ${d.name}. AI analysis started in background…`);

    // Trigger background AI analysis on the server (reads the already-saved file)
    fetch('/api/refs/analyze-from-detail', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: d.filename, name: savedName, userNotes }),
    }).then(r => r.json()).then(rd => {
      if (rd.success) {
        // Poll server log indirectly — server logs completion; just notify user after ~60s
        setTimeout(() => setStatus(`Item «${savedName}» analysis complete`), 62000);
      }
    }).catch(e => console.warn('[detail bg-analyze]', e.message));

    detailClear();
    if (detailNameInput) detailNameInput.value = '';
    const _unEl = document.getElementById('detail-user-notes');
    if (_unEl) _unEl.value = '';
    loadDetails();

  } catch (e) { setStatus('Error: ' + e.message); }
  finally { btnDetailUpload.disabled = false; }
});

function _makeDetailField(label, value, onSave) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;align-items:center;gap:3px;margin-top:2px;';
  const lbl = document.createElement('span');
  lbl.textContent = label + ':';
  lbl.style.cssText = 'font-size:8px;color:#666;flex-shrink:0;';
  const inp = document.createElement('input');
  inp.type = 'text'; inp.value = value;
  inp.style.cssText = 'flex:1;min-width:0;font-size:8px;padding:1px 3px;border:1px solid #aaa;background:#fff;';
  inp.title = label;
  let _timer;
  inp.addEventListener('input', () => {
    clearTimeout(_timer);
    _timer = setTimeout(() => onSave(inp.value.trim()), 800);
  });
  inp.addEventListener('blur', () => { clearTimeout(_timer); onSave(inp.value.trim()); });
  wrap.appendChild(lbl); wrap.appendChild(inp);
  return { wrap, inp };
}

async function loadDetails() {
  if (!detailsGrid) return;
  try {
    // Source of truth: refs.json category=detail (same as База данных → Предметы)
    const d = await fetch('/api/refs/list?category=detail').then(r => r.json());
    const refs = (d.success && d.refs) ? d.refs : [];

    cachedDetailFiles = refs.map(r => {
      const thumbPath = r.originalPath.replace('/refs/', '/refs/thumbs/').replace(/(\.[^.]+)$/, '.jpg');
      return { file: String(r.id), refId: r.id, name: r.title || 'Item', size: '', path: r.originalPath, thumbPath };
    });

    detailsGrid.innerHTML = '';
    if (!refs.length) { detailsGrid.innerHTML = '<div class="gallery-empty">No items</div>'; return; }

    refs.forEach(ref => {
      const item = cachedDetailFiles.find(f => f.refId === ref.id);

      // Build card from scratch — no buildGalleryCard to avoid its archive handler
      const card = document.createElement('div');
      card.className = 'gallery-card';
      const wrap = document.createElement('div');
      wrap.className = 'g-img-wrap';

      const img = document.createElement('img');
      img.src = (item.thumbPath || item.path) + '?t=' + Date.now();
      img.onerror = () => { img.onerror = null; img.src = item.path + '?t=' + Date.now(); };
      img.draggable = true;
      img.addEventListener('dragstart', e => {
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('application/x-asset-path',  item.path);
        e.dataTransfer.setData('application/x-asset-thumb', item.thumbPath || item.path);
        e.dataTransfer.setData('application/x-asset-label', item.name || '');
        e.dataTransfer.setData('application/x-asset-type',  'detail');
      });

      const delBtn = document.createElement('button');
      delBtn.className = 'g-delete';
      delBtn.textContent = '✕';
      delBtn.title = 'Delete item';
      delBtn.addEventListener('click', e => {
        e.stopPropagation();
        // Immediate UI removal — no confirmation needed
        card.remove();
        cachedDetailFiles = cachedDetailFiles.filter(f => f.refId !== ref.id);
        activeDetailFiles.delete(String(ref.id));
        // Fire-and-forget server cleanup
        fetch(`/api/refs/${ref.id}`, { method: 'DELETE' }).catch(() => {});
        loadArchiveDetails?.();
      });

      wrap.appendChild(img);
      wrap.appendChild(delBtn);
      card.appendChild(wrap);

      // Editable name + size fields
      const metaWrap = document.createElement('div');
      metaWrap.style.cssText = 'padding:2px 3px 4px;display:flex;flex-direction:column;gap:0;';

      const { wrap: nameWrap } = _makeDetailField('Name', item.name, v => {
        if (item) item.name = v;
        fetch(`/api/refs/${ref.id}/set-title`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: v }),
        }).catch(() => {});
      });
      const { wrap: sizeWrap } = _makeDetailField('Size', ref.technicalDetails ? '' : '', () => {});
      metaWrap.appendChild(nameWrap);
      metaWrap.appendChild(sizeWrap);
      metaWrap.addEventListener('click', e => e.stopPropagation());
      card.appendChild(metaWrap);

      if (activeDetailFiles.has(String(ref.id))) card.classList.add('detail-selected');
      wrap.addEventListener('click', e => {
        e.stopPropagation();
        // Removed activateAsset() call — it was polluting Character's assets table
        // with items selected here. Scenario selection is handled by toggleDetailActive only.
        toggleDetailActive(String(ref.id), card);
      });

      detailsGrid.appendChild(card);
    });
    relinkActiveThumbs?.(detailsGrid, 'data-path');
    updateAutofillPanel();
    updateDetailsCount?.(refs.length);
  } catch (e) {
    console.warn('[loadDetails]', e.message);
    detailsGrid.innerHTML = '<div class="gallery-empty">Load error</div>';
  }
}

// ── Scenario collapsible toggle ───────────────────────────────────────────────
(function () {
  const toggle = document.getElementById('scenario-collapse-toggle');
  const body   = document.getElementById('scenario-collapse-body');
  const arrow  = document.getElementById('scenario-collapse-arrow');
  if (!toggle || !body) return;
  toggle.addEventListener('click', () => {
    const open = body.style.display === 'none';
    body.style.display = open ? '' : 'none';
    if (arrow) arrow.textContent = open ? '▼' : '▶';
  });
})();

// ── Details collapsible toggle ────────────────────────────────────────────────
(function () {
  const toggle = document.getElementById('details-collapse-toggle');
  const body   = document.getElementById('details-collapse-body');
  const arrow  = document.getElementById('details-collapse-arrow');
  if (!toggle || !body) return;
  toggle.addEventListener('click', () => {
    const open = body.style.display === 'none';
    body.style.display = open ? '' : 'none';
    arrow.textContent  = open ? '▼' : '▶';
  });
})();

// Update the count label in the collapsible header whenever details load
function updateDetailsCount(n) {
  const el = document.getElementById('details-count');
  if (el) el.textContent = n;
}

// ── Создание button ────────────────────────────────────────────────────────────
document.getElementById('btn-scen-create')?.addEventListener('click', () => {
  // Validate: at least one образ selected
  if (activeObrazIds.size === 0) {
    setStatus('Select at least one outfit before creating.');
    return;
  }
  // Validate: at least one scenario has an assigned предмет
  const activeScensForCreate = scenarioFiles.filter(f =>
    Object.entries(scenarioAssignments).some(([k, v]) => k.startsWith(f.file + '__') && v)
  );
  if (!activeScensForCreate.length) {
    setStatus('Add items to at least one scenario.');
    return;
  }
  // Create a new unique pending session for each образ × сценарий combo
  const now = Date.now();
  let idx = 0;
  const allObrazыForCreate = getObrazы?.() || [];
  for (const obrazId of activeObrazIds) {
    const obraz = allObrazыForCreate.find(o => String(o.id) === String(obrazId));
    for (const f of activeScensForCreate) {
      const key = `${obrazId}__${f.file}__${now + idx}`;
      idx++;
      // Assign a permanent sequential number for this scenFile (never changes after creation)
      const _existingNums = Object.values(editFrozenSessions)
        .filter(s => (s.scenFile || '') === f.file)
        .map(s => s.num || 0);
      const _nextNum = _existingNums.length > 0 ? Math.max(..._existingNums) + 1 : 1;
      // Snapshot current образ/предмет pairs for this scenario into the session body
      const _snapAssignments = {};
      Object.entries(scenarioAssignments).forEach(([k, v]) => {
        if (v && k.startsWith(f.file + '__')) _snapAssignments[k] = v;
      });
      editFrozenSessions[key] = {
        pending:     true,
        num:         _nextNum,
        assignments: _snapAssignments,  // образ/предмет pairs stored in session body
        obrazId:     String(obrazId),
        scenFile:    f.file,
        obrazChar:   obraz?.char || null,
        date:        new Date(now + idx).toISOString(),
      };
    }
  }
  saveEditState();
  // Switch to Эдит sub-panel
  document.querySelectorAll('.scen-subtab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.scen-subpanel').forEach(p => p.classList.remove('active'));
  const editBtn = document.querySelector('.scen-subtab[data-panel="scen-panel-edit"]');
  const editPanel = document.getElementById('scen-panel-edit');
  if (editBtn)  editBtn.classList.add('active');
  if (editPanel) editPanel.classList.add('active');
  document.getElementById('l1-scenarii')?.classList.add('edit-active');
  renderEditPanel();
});

// ── Init ──────────────────────────────────────────────────────────────────────
loadScenarios();
loadDetails();
loadScenarioObrazы();
// Resume any in-flight Edit panel generations that survived a restart
resumeEditPendingCells();
// Resume any in-flight avatar video tasks that survived a tab switch or reload
resumeAvatarPendingCells();
