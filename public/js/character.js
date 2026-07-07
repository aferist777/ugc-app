/* ═══════════════════════════════════════════════
   CHARACTER TAB — face, generate, thumbs, apply
   ═══════════════════════════════════════════════ */

const faceDropzone    = document.getElementById('face-dropzone');
const faceInput       = document.getElementById('face-input');
const facePreview     = document.getElementById('face-preview');
const facePlaceholder = document.getElementById('face-placeholder');
const btnDeleteFace   = document.getElementById('btn-delete-face');
const btnSavePersaCol2  = document.getElementById('btn-save-persa-col2');

function showSaveChar(v) {
  // Button stays on view; just enable/disable it.
  const persa = document.getElementById('btn-save-persa-col2');
  if (persa) persa.disabled = !v;
}
// Live gender comes from the redesign quick param (built at boot).
function _charGender() { return document.getElementById('cr-p-gender')?.value || 'female'; }
const charEngineSelect = document.getElementById('char-image-engine');
const btnRefine       = document.getElementById('btn-refine');
const refineSection   = document.getElementById('refine-section');
const refineExtra     = document.getElementById('refine-extra');
const nameInput       = document.getElementById('char-name');

// Returns the image engine to use in the character tab —
// falls back to the global Мозги setting when "По умолчанию" is selected.
// getImageEngine() is defined in settings.js (loaded before this file).
/* global getImageEngine */
function getCharImageEngine() {
  // The EDIT (image-to-image) engine. localStorage is authoritative (set by the
  // 2-column engine popup); default = firered-edit. The legacy <select> is a
  // hidden cosmetic mirror and is NOT a fallback — it can't hold non-legacy
  // options like firered-edit / seedream4.5 / flux-2-max.
  return localStorage.getItem(CHAR_ENGINE_KEY) || 'firered-edit';
}
// The CREATE (text-to-image) engine used by the character creator's "Generate base".
function getCharCreateEngine() {
  return localStorage.getItem('char_create_engine_v1') || 'z-turbo';
}
window.getCharCreateEngine = getCharCreateEngine;

const CHAR_ENGINE_KEY = 'char_image_engine_v1';
(function initCharEngine() {
  // The legacy <select> is a hidden cosmetic mirror only — never clobber the
  // authoritative localStorage edit-engine (it may hold a non-legacy option
  // like firered-edit / seedream4.5 / flux-2-max not present in the <select>).
  const saved = localStorage.getItem(CHAR_ENGINE_KEY);
  if (charEngineSelect && saved && charEngineSelect.querySelector(`option[value="${saved}"]`)) {
    charEngineSelect.value = saved;
  }
  charEngineSelect?.addEventListener('change', () => {
    localStorage.setItem(CHAR_ENGINE_KEY, charEngineSelect.value);
  });
})();

// Realism is now ALWAYS applied (the user-facing toggle/markers were removed
// from the engine-settings popup). The prompt compiler adds the iPhone-14
// home-video look to scene images, and face generation always sends realism on.

let currentFaceBlob    = null;
let generatedImagePath = null;
let lastGeneratedSeed  = null;  // seed from most recent generation

// Currently selected persistent character (actor). Set when picking from the
// Char dropdown or right after "Save char". Obrazы saved while a char is
// selected get stamped with this charId → they show up in the char's "личное
// дело" (portfolio) in the actor popup.
let _currentCharId = null;
let _actorCache    = [];   // last /api/char-store/list payload (for ref lookups)
window._getCurrentCharId = () => _currentCharId;
window._setCurrentCharId = (id) => { _currentCharId = id || null; try { saveAppState(); } catch {} };
// ── Generation history ────────────────────────────────────────────────────────
let generationHistory = [];  // array of image paths
let historyIndex = -1;
let _lastGen = null;   // redo closure for the working-image Retry button (last generation of any kind)

function pushToHistory(imagePath) {
  if (!imagePath) return;
  // Never truncate — branched generation from any history position appends to the end,
  // keeping the original forward path still navigable.
  if (generationHistory[generationHistory.length - 1] !== imagePath) {
    generationHistory.push(imagePath);
  }
  historyIndex = generationHistory.length - 1;
  renderHistoryNav();
  _updateImgActions();
}

function renderHistoryNav() {
  const nav = document.getElementById('history-nav');
  if (!nav) return;
  if (generationHistory.length <= 1) { nav.style.display = 'none'; return; }
  nav.style.display = 'flex';
  const counter = document.getElementById('hist-counter');
  if (counter) counter.textContent = `${historyIndex + 1} / ${generationHistory.length}`;
  const prevBtn = document.getElementById('btn-hist-prev');
  const nextBtn = document.getElementById('btn-hist-next');
  // Show an arrow only when it has somewhere to go; hide it (not just disable) otherwise.
  if (prevBtn) { const noPrev = historyIndex <= 0; prevBtn.disabled = noPrev; prevBtn.style.display = noPrev ? 'none' : ''; }
  if (nextBtn) { const noNext = historyIndex >= generationHistory.length - 1; nextBtn.disabled = noNext; nextBtn.style.display = noNext ? 'none' : ''; }
}

// ── Working-image corner actions: Retry (redo last generation) / Cancel (revert) ──
function _recordGen(fn) { _lastGen = fn; _updateImgActions(); }
function _updateImgActions() {
  const a = document.getElementById('img-actions');
  if (!a) return;
  a.style.display = generatedImagePath ? 'flex' : 'none';
  const r = document.getElementById('btn-img-retry');
  const c = document.getElementById('btn-img-cancel');
  if (r) r.disabled = !_lastGen;
  if (c) c.disabled = historyIndex <= 0;   // nothing to revert to
}

// ── State persistence ─────────────────────────────────────────────────────────
const STATE_KEY = 'char_state_v1';

// id of the most-recently saved obraz — used as the primary anchor for the
// "fallback to last obraz" recovery when generatedImagePath ends up pointing
// to a file that no longer exists (e.g. after a Save obraz that moved the
// file then a session restart that left LS-state pointing somewhere broken).
let lastSavedObrazId = null;

function saveAppState() {
  try {
    // Persist only the last 3 images: the in-session history can be longer (the
    // arrows flip through everything generated this session), but a reload keeps
    // just the 3 most recent.
    const _histTail = generationHistory.slice(-3);
    let _histIdx = _histTail.indexOf(generatedImagePath);
    if (_histIdx < 0) _histIdx = _histTail.length - 1;
    localStorage.setItem(STATE_KEY, JSON.stringify({
      generatedImagePath,
      generationHistory: _histTail,
      historyIndex: _histIdx,
      lastGeneratedSeed,
      lastSavedObrazId,
      currentCharId:   _currentCharId,
      nameInputValue:  nameInput?.value  || '',
    }));
  } catch (e) { console.warn('[saveAppState]', e.message); }
}

function restoreAppState() {
  let state;
  try { state = JSON.parse(localStorage.getItem(STATE_KEY) || 'null'); } catch { return; }
  if (!state) return;

  if (nameInput     && state.nameInputValue) nameInput.value      = state.nameInputValue;

  if (state.generationHistory?.length) {
    generationHistory = state.generationHistory;
    historyIndex = state.historyIndex ?? generationHistory.length - 1;
  }
  if (state.lastGeneratedSeed != null) lastGeneratedSeed = state.lastGeneratedSeed;
  if (state.lastSavedObrazId != null)  lastSavedObrazId  = state.lastSavedObrazId;
  if (state.currentCharId != null)     _currentCharId    = state.currentCharId;

  if (state.generatedImagePath) {
    generatedImagePath = state.generatedImagePath;
    currentFaceBlob    = null;
    showFace(state.generatedImagePath + '?t=' + Date.now());
    showSaveChar(true);
    renderHistoryNav();
  }
}

// Re-link _imgEl after a thumbnail row is (re)loaded — call from each load fn

// ── Face helpers ──────────────────────────────────────────────────────────────
// Hide the "from last saved obraz" badge. Called from every showFace path
// except the fallback one (where it gets shown explicitly).
function _hideFallbackBadge() {
  const el = document.getElementById('face-fallback-badge');
  if (el) el.style.display = 'none';
}

// HEAD-check a path. Returns true only on HTTP 200 — anything else (404, 5xx,
// network) is treated as "file not there".
async function _headOk(url) {
  try {
    const r = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    return r.ok;
  } catch { return false; }
}

// Try to recover from a broken active image by reaching for the most recent
// saved obraz's main image. Order:
//   1) lastSavedObrazId (if its char path passes HEAD)
//   2) all other obrazы by date desc (first one whose char passes HEAD)
// Returns the working path on success, null on failure.
async function _tryFallbackImage(failedSrc) {
  const list = (typeof getObrazы === 'function') ? getObrazы() : [];
  if (!Array.isArray(list) || !list.length) return null;

  const ordered = [];
  if (lastSavedObrazId != null) {
    const pinned = list.find(o => o.id === lastSavedObrazId);
    if (pinned) ordered.push(pinned);
  }
  // Sort the rest by date desc and append (skipping the pinned one)
  const rest = list
    .filter(o => o.id !== lastSavedObrazId)
    .slice()
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  ordered.push(...rest);

  const failedBare = String(failedSrc || '').split('?')[0];
  for (const o of ordered) {
    const candidate = o && o.char;
    if (!candidate) continue;
    if (candidate.split('?')[0] === failedBare) continue;
    if (await _headOk(candidate)) return candidate;
  }
  return null;
}

function showFace(src, fromCharThumb) {
  // If the active image fails to load (file 404 — archived, deleted, or stale
  // path in LS), try a fallback chain: most recently saved obraz first, then
  // iterate other obrazы by date desc. HEAD-check before swapping the src so
  // we never trigger another onerror loop.
  facePreview.onerror = async () => {
    facePreview.onerror = null;
    console.warn('[showFace] image failed to load — trying fallback chain:', src);
    const fallback = await _tryFallbackImage(src);
    if (fallback) {
      console.log('[showFace] fallback resolved:', fallback);
      const badge = document.getElementById('face-fallback-badge');
      if (badge) badge.style.display = 'block';
      // Setting onerror to null on this assignment — if the fallback itself
      // 404s (race condition: file deleted between HEAD and load) just clear.
      facePreview.onerror = () => {
        facePreview.onerror = null;
        _hideFallbackBadge();
        clearFace();
        generatedImagePath = null;
        showSaveChar(false);
        try { saveAppState(); } catch {}
      };
      facePreview.src = fallback;
      generatedImagePath = fallback;
      try { saveAppState(); } catch {}
      return;
    }
    console.warn('[showFace] no fallback available — clearing stale state');
    _hideFallbackBadge();
    clearFace();
    generatedImagePath = null;
    showSaveChar(false);
    try { saveAppState(); } catch {}
  };
  _hideFallbackBadge();
  facePreview.src = src;
  facePreview.style.display = 'block';
  facePlaceholder.style.display = 'none';
  btnDeleteFace.style.display = 'inline-block';
  _updateImgActions();
}

function clearFace() {
  facePreview.src = '';
  facePreview.style.display = 'none';
  facePlaceholder.style.display = 'block';
  btnDeleteFace.style.display = 'none';
  faceInput.value = '';
  currentFaceBlob    = null;
  generatedImagePath = null;
  _lastGen = null;
  _updateImgActions();
  _currentCharId     = null;
  refineExtra.value  = '';
  showSaveChar(false);
  faceDropzone.classList.remove('fullbody');
  _hideFallbackBadge();
  saveAppState();
}

// ── Face upload ───────────────────────────────────────────────────────────────
faceDropzone.addEventListener('click', () => {
  if (!facePreview.style.display || facePreview.style.display === 'none') faceInput.click();
});
facePreview.addEventListener('click', e => { e.stopPropagation(); openLightbox(facePreview.src); });

function handleFaceFile(file) {
  if (!file) return;
  snapshotCurrentProject?.();
  _currentCharId = null;   // new face = new person → detach from any selected actor
  currentFaceBlob = file; generatedImagePath = null;
  generationHistory = []; historyIndex = -1; lastGeneratedSeed = null;
  showSaveChar(false);
  faceDropzone.classList.remove('fullbody');
  showFace(URL.createObjectURL(file));
  nameInput.value = randomName(_charGender());
  saveAppState();
}
faceInput.addEventListener('change', () => handleFaceFile(faceInput.files[0]));
faceDropzone.addEventListener('dragover', e => { e.preventDefault(); faceDropzone.classList.add('drag-over'); });
faceDropzone.addEventListener('dragleave', () => faceDropzone.classList.remove('drag-over'));
faceDropzone.addEventListener('drop', e => {
  e.preventDefault(); faceDropzone.classList.remove('drag-over');
  const f = e.dataTransfer.files[0];
  if (f && f.type.startsWith('image/')) handleFaceFile(f);
});

// TPDNE — pull a random face from thispersondoesnotexist.com and make it the
// active image (server path, so Save character can build the 4K sheet from it,
// exactly like a generated portrait). Click again to swap it for a new face.
async function loadRandomFace() {
  snapshotCurrentProject?.();
  setStatus('🎲 Fetching a random face…');
  setLoading?.(true);
  try {
    const d = await fetch('/api/random-face').then(r => r.json());
    if (!d.success || !d.imagePath) throw new Error(d.error || 'TPDNE failed');
    _currentCharId = null;              // fresh face = new person -> detach from any actor
    currentFaceBlob = null;
    generatedImagePath = d.imagePath;
    generationHistory = []; historyIndex = -1; lastGeneratedSeed = null;
    showFace(d.imagePath + '?t=' + Date.now());
    pushToHistory(d.imagePath);
    if (!getCurrentProjectId?.()) createProject?.(d.imagePath, nameInput.value.trim() || randomName(_charGender()));
    if (!nameInput.value.trim()) nameInput.value = randomName(_charGender());
    showSaveChar(true);
    saveAppState();
    setStatus('Random face ready — tweak or Save character to build the 4K sheet.');
  } catch (e) {
    setStatus('TPDNE error: ' + e.message);
  } finally {
    setLoading?.(false);
  }
}
window.loadRandomFace = loadRandomFace;

btnDeleteFace.addEventListener('click', e => {
  e.stopPropagation();
  if (generatedImagePath) {
    // Save to all-time archive before removing
    saveToDeletedGeni?.(generatedImagePath, lastGeneratedSeed);
    // Remove from history
    generationHistory = generationHistory.filter(p => p !== generatedImagePath);
    if (generationHistory.length > 0) {
      historyIndex = Math.min(historyIndex, generationHistory.length - 1);
      generatedImagePath = generationHistory[historyIndex];
      currentFaceBlob = null;
      showFace(generatedImagePath + '?t=' + Date.now(), generatedImagePath.includes('/characters/'));
      showSaveChar(true);
      renderHistoryNav();
      saveAppState();
      setStatus('Generation deleted. Showing previous.');
    } else {
      generationHistory = [];
      historyIndex = -1;
      clearFace();
      setStatus('Generation deleted.');
    }
  } else {
    clearFace();
    setStatus('Face removed.');
  }
});

// ── Generation helpers ────────────────────────────────────────────────────────
// Locks every "regular" generation entry point on the Character tab while one is running.
// Lookbook+Environment (#btn-obrinj) is intentionally excluded — fully independent in both directions.
function setLoading(active) {
  btnRefine.disabled     = active;
  faceDropzone.style.pointerEvents = active ? 'none' : '';
  faceDropzone.classList.toggle('generating', active);
}

// Long-poll a kie.ai-style task status endpoint until it succeeds or fails.
// On hard timeout (POLL_TIMEOUT_MS) the activity-log row stays in place with a
// [↻ Check] button — clicking it does a one-shot status re-check and, if the
// task has finished server-side, finalises the row as success. The user
// removes the row manually via the ✕ button.
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS  = 8 * 60 * 1000; // 8 min — most kie.ai tasks finish well before this

function _statusCheckOnce(statusEndpoint) {
  return fetch(statusEndpoint)
    .then(r => r.json())
    .then(d => {
      if (!d || d.success === false) return { state: 'failed', error: d?.error || 'Status check failed' };
      if (d.state === 'success') return { state: 'success', imagePath: d.imagePath, videoPath: d.videoPath };
      if (d.state === 'failed')  return { state: 'failed',  error: d.error || 'Task failed' };
      return { state: d.state || 'pending' };
    })
    .catch(e => ({ state: 'failed', error: e.message || 'Network error' }));
}

function pollUntilDone(statusEndpoint, label) {
  const trackId = `char_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const actRow  = startActiveGen?.(trackId, label || 'Generation');
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const iv = setInterval(async () => {
      // Hard timeout — stop polling, leave row + arm Check button
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        clearInterval(iv);
        actRow?.finalize?.('❌ Timeout — task may still be running');
        actRow?.armStatusCheck?.(() => _statusCheckOnce(statusEndpoint));
        finishActiveGen?.(trackId);
        logError(label || 'Generation', 'Polling timed out after ' + Math.round(POLL_TIMEOUT_MS / 1000) + 's');
        reject(new Error('Timeout'));
        return;
      }
      try {
        const r = await fetch(statusEndpoint);
        const d = await r.json();
        if (!d.success) {
          clearInterval(iv);
          actRow?.finalize?.('❌ ' + (d.error || 'Error'));
          actRow?.armStatusCheck?.(() => _statusCheckOnce(statusEndpoint));
          finishActiveGen?.(trackId);
          logError(label || 'Generation', d.error);
          reject(new Error(d.error)); return;
        }
        if (d.state === 'success') {
          clearInterval(iv);
          actRow?.setImage?.(d.imagePath);
          finishActiveGen?.(trackId);
          resolve(d.imagePath);
        } else if (d.state === 'failed') {
          clearInterval(iv);
          actRow?.finalize?.('❌ ' + (d.error || 'Error'));
          actRow?.armStatusCheck?.(() => _statusCheckOnce(statusEndpoint));
          finishActiveGen?.(trackId);
          logError(label || 'Generation', d.error || 'Task failed with an error');
          reject(new Error(d.error || 'Error'));
        } else { setStatus(`Generating… (${d.state})`); }
      } catch (e) {
        clearInterval(iv);
        actRow?.finalize?.('❌ ' + e.message);
        actRow?.armStatusCheck?.(() => _statusCheckOnce(statusEndpoint));
        finishActiveGen?.(trackId);
        logError(label || 'Generation', e.message);
        reject(e);
      }
    }, POLL_INTERVAL_MS);
  });
}

function _showGenError(msg) { setStatus('Error: ' + msg); }
function _hideGenError() {}

async function runGeneration(payload, statusMsg, opts = {}) {
  _recordGen(() => runGeneration(payload, statusMsg, opts));   // Retry redoes this exact generation (same source/params)
  _hideGenError();
  setLoading(true);
  setStatus(statusMsg);
  const _sid = window.GenLog?.start('Character', '▶ Generate');
  const balBefore = currentCredits;
  try {
    const _engine = getCharImageEngine();
    console.log('[runGeneration] imageEngine →', _engine, '| charEngineSelect.value:', charEngineSelect?.value, '| localStorage:', localStorage.getItem(CHAR_ENGINE_KEY));
    setStatus(statusMsg + ` [${_engine}]`);
    let _withRealism, _enabledMarkers;
    if (opts.skipRealism) {
      _withRealism = false;
      _enabledMarkers = [];
    } else {
      const _rmState = window.getRealismMarkersState?.() || {};
      _enabledMarkers = Object.entries(_rmState).filter(([,v]) => v !== false).map(([k]) => k);
      _withRealism = true;   // realism always on (toggle removed)
    }
    const _reqBody = { ...payload, imageEngine: _engine, withRealism: _withRealism, enabledMarkers: _enabledMarkers };
    if (opts.skipTranslate) _reqBody.skipTranslate = true;
    const d = _sid && window.GenLog
      ? await window.GenLog.fetchLog(_sid, '🖼 Character generation', '/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(_reqBody) })
      : await fetch('/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(_reqBody) }).then(r => r.json());
    if (!d.success) throw new Error(d.error);

    lastGeneratedSeed = d.seed || null;
    setStatus(d.skinTraits?.length ? `Skin: ${d.skinTraits.join(', ')}. Generating…` : 'Generating…');
    const imagePath = await pollUntilDone(`/api/status/${encodeURIComponent(d.taskId)}`, payload.extraInstruction ? 'Refinement' : 'Generation');

    generatedImagePath = imagePath; currentFaceBlob = null;
    showFace(imagePath + '?t=' + Date.now());
    pushToHistory(imagePath);

    // Create project on first generation if none exists yet
    if (!getCurrentProjectId?.()) {
      createProject?.(imagePath, nameInput.value.trim() || randomName(_charGender()));
    }

    pushToGeni?.(imagePath, lastGeneratedSeed, getCurrentProjectId?.());
    refineExtra.value = '';
    showSaveChar(true);
    saveAppState();
    updateCurrentProject?.(JSON.parse(localStorage.getItem('char_state_v1') || 'null'));
    setStatus('Done!');
    logGeneration(payload.extraInstruction ? 'Refinement' : 'Generation', location.origin + imagePath, balBefore);
    window.GenLog?.finalize(_sid, 'success');
  } catch (err) {
    window.GenLog?.finalize(_sid, 'error');
    setStatus('Error: ' + err.message);
    _showGenError(err.message, () => runGeneration(payload, statusMsg));
  } finally {
    setLoading(false);
  }
}

// For an UPLOADED image (in-memory blob, no server path yet) persist it to
// /uploads on first edit so Refine / apply-lookbook / apply-environment have a
// real file path to send. Returns the path (and caches it as generatedImagePath),
// or null when there is nothing to edit.
async function _ensureActivePath() {
  if (generatedImagePath) return generatedImagePath;
  if (!currentFaceBlob) return null;
  const b64 = await blobToBase64(currentFaceBlob);
  const d = await fetch('/api/upload-face', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageBase64: b64 }),
  }).then(x => x.json());
  if (!d.success || !d.imagePath) throw new Error(d.error || 'upload failed');
  generatedImagePath = d.imagePath;   // cache so further edits skip re-upload
  return generatedImagePath;
}

// ── Refine ─────────────────────────────────────
btnRefine.addEventListener('click', async () => {
  if (!generatedImagePath && !currentFaceBlob) { setStatus('No image to edit.'); return; }
  const extra = refineExtra.value.trim();
  if (!extra) { setStatus('Enter changes.'); return; }
  let imgPath;
  try { imgPath = await _ensureActivePath(); } catch (e) { setStatus('Upload error: ' + e.message); return; }
  if (!imgPath) { setStatus('No image to edit.'); return; }
  runGeneration(
    { imagePath: imgPath, extraInstruction: extra },
    'Applying refine…',
    { skipRealism: true }
  );
});

// ── Select a persistent character (actor) from the dropdown / thumb row ───────
// Loads the actor's base face into the active image (a normal, dressable
// portrait), sets _currentCharId so the next "Save obraz" lands in this actor's
// личное дело, and reflects the selection in the dropdown.
function _loadActorByItem(c) {
  if (!c) return;
  snapshotCurrentProject?.();
  _currentCharId = c.id;
  const src = c.baseFace || c.sheet || c.portrait || c.tpose || null;
  if (src) {
    generationHistory = []; historyIndex = -1; lastGeneratedSeed = null;
    generatedImagePath = src; currentFaceBlob = null;
    showFace(src + '?t=' + Date.now(), false);
    showSaveChar(true);
  }
  if (c.name) nameInput.value = c.name;
  saveAppState();
  setStatus(`Character selected: ${c.name}.`);
}

// Like _loadActorByItem but loads a SPECIFIC frame (e.g. the photoshoot image the
// redesign gallery card is currently flipped to) instead of always the created-from
// base. History is seeded with just that one frame. Doing the global writes here (in
// character.js's own scope) guarantees they hit the real bindings the rest of the
// module reads.
function _loadActorByItemFrame(c, framePath) {
  if (!c) return;
  const src = framePath || c.baseFace || c.sheet || c.portrait || c.tpose || null;
  if (!src) { _loadActorByItem(c); return; }
  snapshotCurrentProject?.();
  _currentCharId = c.id;
  generationHistory = [src]; historyIndex = 0; lastGeneratedSeed = null;
  generatedImagePath = src; currentFaceBlob = null;
  showFace(src + '?t=' + Date.now(), false);
  showSaveChar(true);
  if (c.name) nameInput.value = c.name;
  renderHistoryNav();
  saveAppState();
  setStatus(`Character loaded: ${c.name}.`);
}

// ── Persistent characters (actors) — cache refresh ────────────────────────────
// Source of truth is data/characters.json via /api/char-store/list. Refreshes
// _actorCache; the redesign gallery wraps this fn and re-renders its cards from
// the cache (select / edit / delete all live on the gallery).
async function loadCharacterThumbs() {
  try {
    const d = await fetch('/api/char-store/list').then(r => r.json());
    _actorCache = (d && d.success && Array.isArray(d.chars)) ? d.chars : [];
  } catch (e) { console.warn('loadCharacterThumbs:', e.message); }
}
// Public alias used by the actor popup to refresh the gallery after edits.
window.loadActorChars = loadCharacterThumbs;

// ── Save char — create a persistent reusable actor ───────────────────────────
// Snapshots the active face, kicks off the SINGLE combined 4K reference sheet
// (large portrait + full-body turnaround, neutral bodysuit), then opens the
// actor profile popup where the sheet fills in live and the user can set up
// the voice. The sheet is later used as the appearance reference for
// photoshoot / pose generation in Scenarios.
async function savePersa() {
  const imgPath = generatedImagePath;
  if (!imgPath) { setStatus('No active image to save.'); return; }
  const btn2 = btnSavePersaCol2;
  if (btn2) btn2.disabled = true;
  setStatus('Saving character & generating the reference sheet…');
  try {
    // The reference sheet defaults to nano-banana-2 (4K); the actor popup's
    // engine dropdown can change this and remembers the choice.
    const refEngine = localStorage.getItem('char_ref_engine_v1') || 'nano-banana-2';
    // Find the obraz this active image belongs to — if it has a draft character
    // (voice designed in the Save-obraz popup), the server promotes it so the
    // voice + description carry over instead of being regenerated. We omit a
    // client id so the server can reuse the draft's id on promotion.
    let sourceObrazId = null;
    try {
      const _bare = (imgPath || '').split('?')[0];
      const _match = (getObrazы?.() || []).find(o => (o.char || '').split('?')[0] === _bare);
      sourceObrazId = _match ? _match.id : (lastSavedObrazId || null);
    } catch {}
    const r = await fetch('/api/char-store/create', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name:          nameInput.value.trim() || randomName(_charGender()),
        // The created character's gender = the picked Gender param, exactly as
        // chosen (incl. androgynous); no female-guessing when nothing is picked.
        gender:        document.getElementById('cr-p-gender')?.value || null,
        faceImagePath: imgPath,
        imageEngine:   refEngine,
        engineParams:  window.getEngineParams?.(refEngine) || {},
        sourceObrazId,
      }),
    });
    const d = await r.json();
    if (!d.success) throw new Error(d.error);
    // The promoted char keeps the draft's id — use the id the server returned.
    const newCharId = (d.char && d.char.id) || Date.now();
    _currentCharId = newCharId;
    // Retroactively link the originating obraz (the one this character was built
    // from) so it shows up in the actor's личное дело alongside later outfits.
    if (sourceObrazId) {
      const _list = getObrazы?.() || [];
      const _o = _list.find(x => String(x.id) === String(sourceObrazId));
      if (_o && !_o.charId) {
        _o.charId = newCharId;
        (window._persistObrazы || ((l) => localStorage.setItem('obrazy', JSON.stringify(l))))(_list);
        loadObrazы?.();
      }
    }
    saveAppState();
    await loadCharacterThumbs();
    setStatus(d.promotedFromDraft
      ? 'Character saved (voice carried over) — reference sheets are generating.'
      : 'Character saved — reference sheets are generating.');
    window.openCharacterActorPopup?.(newCharId);
  } catch (e) { setStatus('Save error: ' + e.message); }
  finally {
    if (btn2) btn2.disabled = false;
  }
}
btnSavePersaCol2?.addEventListener('click', savePersa);

// ── URL paste → скачать и показать в активном изображении ────────────────────
document.addEventListener('paste', async e => {
  // Only when Персонаж tab is active
  const charPanel = document.getElementById('l1-character');
  if (!charPanel?.classList.contains('active')) return;

  const text = e.clipboardData?.getData('text/plain')?.trim();
  if (!text || !/^https?:\/\//i.test(text)) return;

  e.preventDefault();
  setStatus('Downloading image from URL…');
  try {
    const r = await fetch('/api/temp/fetch-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: text }),
    });
    const d = await r.json();
    if (!d.success) throw new Error(d.error);
    currentFaceBlob = null;
    _currentCharId = null;   // pasted image = new person → detach from selected actor
    generatedImagePath = null;
    showSaveChar(false);
    faceDropzone.classList.remove('fullbody');
    showFace(d.path + '?t=' + Date.now());
    setStatus('Image loaded from URL.');
  } catch (err) { setStatus('Download error: ' + err.message); }
});

// ── History navigation ────────────────────────────────────────────────────────
document.getElementById('btn-hist-prev')?.addEventListener('click', () => {
  if (historyIndex <= 0) return;
  historyIndex--;
  generatedImagePath = generationHistory[historyIndex];
  currentFaceBlob = null;
  showFace(generatedImagePath + '?t=' + Date.now(), generatedImagePath.includes('/characters/'));
  showSaveChar(true);
  renderHistoryNav();
  saveAppState();
  setStatus(`History: ${historyIndex + 1} / ${generationHistory.length}`);
});

document.getElementById('btn-hist-next')?.addEventListener('click', () => {
  if (historyIndex >= generationHistory.length - 1) return;
  historyIndex++;
  generatedImagePath = generationHistory[historyIndex];
  currentFaceBlob = null;
  showFace(generatedImagePath + '?t=' + Date.now(), generatedImagePath.includes('/characters/'));
  showSaveChar(true);
  renderHistoryNav();
  saveAppState();
  setStatus(`History: ${historyIndex + 1} / ${generationHistory.length}`);
});

// Working-image Retry — redo the last generation (analysis + image) of any type.
document.getElementById('btn-img-retry')?.addEventListener('click', (e) => {
  e.stopPropagation();
  if (!_lastGen) return;
  const fn = _lastGen;
  fn();
});

// Working-image Cancel — revert to the previous image in history (undo the apply/gen).
document.getElementById('btn-img-cancel')?.addEventListener('click', (e) => {
  e.stopPropagation();
  if (historyIndex <= 0) return;
  historyIndex--;
  generatedImagePath = generationHistory[historyIndex];
  currentFaceBlob = null;
  showFace(generatedImagePath + '?t=' + Date.now(), generatedImagePath.includes('/characters/'));
  showSaveChar(true);
  renderHistoryNav();
  saveAppState();
  setStatus('Отменено — предыдущее изображение');
});

// ── Init ──────────────────────────────────────────────────────────────────────
// Load custom dropdown options first (populates selects), then restore state
loadCustomOptions().then(() => {
  restoreAppState();        // restore after custom options are in the selects
  renderHistoryNav();       // reflect history on load — hides the arrows when there is <=1 image
}).catch(() => {
  restoreAppState();        // fallback: restore even if custom options fail
  renderHistoryNav();
});
// These build the Character-tab galleries. Only run them when this page hosts
// the Character tab -- the Edit page also loads character.js (for shared helpers
// like the character edit popup), and without this gate it would fetch every
// character / lookbook / environment / detail / obraz thumbnail into the hidden
// Character panel on page load.
if (!Array.isArray(window.__PAGE_TABS) || window.__PAGE_TABS.includes('character')) {
  loadCharacterThumbs();
}
