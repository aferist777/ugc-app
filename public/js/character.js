/* ═══════════════════════════════════════════════
   CHARACTER TAB — face, generate, thumbs, apply
   ═══════════════════════════════════════════════ */

const faceDropzone    = document.getElementById('face-dropzone');
const faceInput       = document.getElementById('face-input');
const facePreview     = document.getElementById('face-preview');
const facePlaceholder = document.getElementById('face-placeholder');
const btnDeleteFace   = document.getElementById('btn-delete-face');
const btnRandomFace   = document.getElementById('btn-random-face');
const btnTempo        = document.getElementById('btn-tempo');
const btnObrinj       = document.getElementById('btn-obrinj');
const btnSaveObrazLeft  = document.getElementById('btn-save-obraz-left');
const btnSaveObrazCol2  = document.getElementById('btn-save-obraz-col2');
const btnSavePersaCol2  = document.getElementById('btn-save-persa-col2');

function showSaveChar(v) {
  // Buttons stay on view; just enable/disable them.
  const persa = document.getElementById('btn-save-persa-col2');
  const obraz = document.getElementById('btn-save-obraz-col2');
  if (persa) persa.disabled = !v;
  if (obraz) obraz.disabled = !v;
}
const genderSelect    = document.getElementById('gender');
const poseSelect      = document.getElementById('pose');
const emotionSelect   = document.getElementById('emotion');
const charEngineSelect = document.getElementById('char-image-engine');
const btnRefine       = document.getElementById('btn-refine');
const refineSection   = document.getElementById('refine-section');
const refineExtra     = document.getElementById('refine-extra');
const nameInput       = document.getElementById('char-name');
const lbThumbRow      = document.getElementById('lb-thumb-row');
const lbNoItems       = document.getElementById('lb-no-items');
const envThumbRow     = document.getElementById('env-thumb-row');
const envNoItems      = document.getElementById('env-no-items');
const charThumbRow       = document.getElementById('char-thumb-row');
const charNoItems        = document.getElementById('char-no-items');
const charDetailThumbRow = document.getElementById('char-detail-thumb-row');
const charDetailNoItems  = document.getElementById('char-detail-no-items');

const POSE_KEYS = ['pose_desk', 'pose_sofa', 'pose_window', 'pose_kitchen', 'pose_standing'];

// ── Brain-cached param instruction templates ──────────────────────────────────
const _paramPrompts = {
  param_age_instruction:         'Change the apparent age of the person to {age} years old. Keep everything else identical.',
  param_gender_instruction:      'Transform the person into a {gender}. Keep the same pose, outfit, background, and expression exactly.',
  param_pose_instruction:        '{poseScene} Keep the person\'s facial features and identity identical.',
  param_emotion_instruction:     'Change the person\'s facial expression to the following: {emotion}. Keep pose, outfit, and background exactly the same.',
  param_pose_scene_desk:         'Place this person sitting at a desk in a home office with a bookshelf and plant in the background. Professional soft studio lighting.',
  param_pose_scene_sofa:         'Place this person sitting comfortably on a sofa in a cozy living room with cushions and soft furnishings. Warm ambient lighting.',
  param_pose_scene_window:       'Place this person standing near a large window with natural soft daylight from the side. Blurred interior background with curtains.',
  param_pose_scene_kitchen:      'Place this person leaning casually against a kitchen counter. Warm kitchen lighting, modern kitchen background.',
  param_pose_scene_standing:     'Show this person standing upright facing the camera with a clean neutral background. Soft diffused studio lighting.',
  emotion_neutral:    'Neutral relaxed facial expression, natural composed face, no strong emotion, subtle calm look.',
  emotion_smile:      'Warm natural smile, corners of mouth gently raised, soft friendly eyes, pleasant approachable expression.',
  emotion_joy:        'Genuine joyful expression, radiant happiness, bright wide eyes full of delight, visible pure joy.',
  emotion_laugh:      'Natural open laugh, mouth open with genuine amusement, eyes crinkled, face animated and lively.',
  emotion_surprise:   'Surprised expression, wide open eyes, slightly raised eyebrows, open mouth, genuine astonishment.',
  emotion_sadness:    'Sad melancholy expression, slightly downturned mouth, soft distant eyes, quiet subtle vulnerability.',
  emotion_serious:    'Serious composed expression, firm closed mouth, steady direct confident gaze, professional focused look.',
  emotion_thoughtful: 'Pensive thoughtful expression, slight head tilt, contemplative inward gaze, calm focused inner thought.',
  emotion_confident:  'Confident self-assured expression, subtle knowing smile, strong direct eye contact, composed powerful presence.',
  emotion_excitement: 'Excited energetic expression, wide bright sparkling eyes, big open enthusiastic smile, vibrant energy.',
  emotion_anger:      'Frustrated tense expression, furrowed brows, tight lips pressed together, intense controlled gaze.',
  emotion_shy:        'Shy bashful expression, soft slightly downcast eyes, subtle embarrassed smile, gentle quiet vulnerability.',
};
const _itemLabels  = {};       // key → display label (custom-renamed or custom-created)
const _hiddenKeys  = new Set(); // keys of default prompts hidden by user (Del button)

(async function loadParamPrompts() {
  try {
    const d = await fetch('/api/prompts').then(r => r.json());
    if (!d.success) return;
    for (const p of d.prompts) {
      if (p.key in _paramPrompts) {
        _paramPrompts[p.key] = p.current;
        if (p.customLabel) _itemLabels[p.key] = p.customLabel;
      } else if (p.isDynamic) {
        if (p.key.startsWith('param_pose_scene_custom_')) {
          _paramPrompts[p.key] = p.current;
          _itemLabels[p.key] = p.label || p.key;
          const ts  = p.key.replace('param_pose_scene_custom_', '');
          const sel = document.getElementById('pose');
          if (sel && !sel.querySelector(`option[value="pose_custom_${ts}"]`)) {
            const opt = document.createElement('option');
            opt.value = `pose_custom_${ts}`; opt.textContent = p.label || p.key;
            sel.insertBefore(opt, sel.options[1] || null);
          }
        } else if (p.key.startsWith('emotion_custom_')) {
          _paramPrompts[p.key] = p.current;
          _itemLabels[p.key] = p.label || p.key;
          const ts  = p.key.replace('emotion_custom_', '');
          const sel = document.getElementById('emotion');
          if (sel && !sel.querySelector(`option[value="custom_${ts}"]`)) {
            const opt = document.createElement('option');
            opt.value = `custom_${ts}`; opt.textContent = p.label || p.key;
            sel.insertBefore(opt, sel.options[1] || null);
          }
        }
      }
    }
    // Sync select labels and hidden state for static pose/emotion items
    const poseSel    = document.getElementById('pose');
    const emotionSel = document.getElementById('emotion');
    for (const p of d.prompts) {
      if (p.isDynamic) continue;
      if (p.key.startsWith('param_pose_scene_') && !p.key.includes('custom')) {
        if (!poseSel) continue;
        const suffix = p.key.replace('param_pose_scene_', '');
        const opt = poseSel.querySelector(`option[value="pose_${suffix}"]`);
        if (!opt) continue;
        if (p.isHidden) { _hiddenKeys.add(p.key); opt.remove(); }
        else if (_itemLabels[p.key]) opt.textContent = _itemLabels[p.key];
      } else if (p.key.startsWith('emotion_') && !p.key.includes('custom')) {
        if (!emotionSel) continue;
        const suffix = p.key.replace('emotion_', '');
        const opt = emotionSel.querySelector(`option[value="${suffix}"]`);
        if (!opt) continue;
        if (p.isHidden) { _hiddenKeys.add(p.key); opt.remove(); }
        else if (_itemLabels[p.key]) opt.textContent = _itemLabels[p.key];
      }
    }
  } catch {}
})();

// Returns the image engine to use in the character tab —
// falls back to the global Мозги setting when "По умолчанию" is selected.
// getImageEngine() is defined in settings.js (loaded before this file).
/* global getImageEngine */
function getCharImageEngine() {
  const domVal = charEngineSelect ? charEngineSelect.value : '';
  if (domVal) return domVal;
  return localStorage.getItem(CHAR_ENGINE_KEY) || 'nano-banana-2';
}

const CHAR_ENGINE_KEY = 'char_image_engine_v1';
(function initCharEngine() {
  const saved = localStorage.getItem(CHAR_ENGINE_KEY);
  if (charEngineSelect) {
    if (saved && charEngineSelect.querySelector(`option[value="${saved}"]`)) {
      charEngineSelect.value = saved;
    } else {
      charEngineSelect.value = 'nano-banana-2';
      localStorage.setItem(CHAR_ENGINE_KEY, 'nano-banana-2');
    }
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
let selectedLbPath     = null;
let selectedEnvPath    = null;
let _applySlots        = { lookbook: null, environment: null, prop: null };  // D2: right-column slots
let lastGeneratedSeed  = null;  // seed from most recent generation

// Currently selected persistent character (actor). Set when picking from the
// Char dropdown or right after "Save char". Obrazы saved while a char is
// selected get stamped with this charId → they show up in the char's "личное
// дело" (portfolio) in the actor popup.
let _currentCharId = null;
// True only while the active character was just promoted via "Save char" in THIS
// session (vs. a pre-existing saved actor that was reused). Controls which popup
// "Save obraz" opens: fresh-saved char → obraz popup; reused actor → actor card.
let _charFromSavePersa = false;
let _actorCache    = [];   // last /api/char-store/list payload (for ref lookups)
window._getCurrentCharId = () => _currentCharId;
window._setCurrentCharId = (id) => { _currentCharId = id || null; _charFromSavePersa = false; try { saveAppState(); } catch {} };
// Reference sheet(s) of the currently selected actor, used as identity anchors
// when applying a lookbook / environment. ONLY the head-and-shoulders portrait
// is sent — the full-body T-pose in a flesh-toned bodysuit trips the engine's
// nudity moderation (E005 "sensitive"), so it is intentionally excluded here.
function _getCurrentCharRefs() {
  if (!_currentCharId) return null;
  const c = _actorCache.find(x => String(x.id) === String(_currentCharId));
  if (!c) return null;
  const refs = [c.portrait].filter(Boolean);
  return refs.length ? refs : null;
}

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
  if (prevBtn) prevBtn.disabled = historyIndex <= 0;
  if (nextBtn) nextBtn.disabled = historyIndex >= generationHistory.length - 1;
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

// ── State & variants persistence ──────────────────────────────────────────────
const STATE_KEY    = 'char_state_v1';
const VARIANTS_KEY = 'asset_variants_v1';

function _variantsStore() {
  try { return JSON.parse(localStorage.getItem(VARIANTS_KEY) || '{}'); } catch { return {}; }
}
function saveVariantsForPath(assetPath, variants) {
  const store = _variantsStore();
  store[assetPath] = variants;
  localStorage.setItem(VARIANTS_KEY, JSON.stringify(store));
}
function getVariantsForPath(assetPath) {
  return _variantsStore()[assetPath] || null;
}

// id of the most-recently saved obraz — used as the primary anchor for the
// "fallback to last obraz" recovery when generatedImagePath ends up pointing
// to a file that no longer exists (e.g. after a Save obraz that moved the
// file then a session restart that left LS-state pointing somewhere broken).
let lastSavedObrazId = null;

function saveAppState() {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify({
      generatedImagePath,
      generationHistory,
      historyIndex,
      lastGeneratedSeed,
      lastSavedObrazId,
      currentCharId:   _currentCharId,
      nameInputValue:  nameInput?.value  || '',
      genderValue:     genderSelect?.value  || 'female',
      poseValue:       poseSelect?.value    || 'random',
      emotionValue:    emotionSelect?.value || 'neutral',
      originValue:     _activeImageOrigin || null,
      activeAssets: activeAssets.map(a => ({
        path:        a.path,
        thumbSrc:    a.thumbSrc,
        name:        a.name,
        assetType:   a.assetType,
        size:        a.size        || '',
        nameVal:     a.nameVal     || '',
        exhonVal:    a.exhonVal    || '',
        activnoeVal: a.activnoeVal || '',
        presetVal:   a.presetVal   || '',
        variants:    a.variants    || [],
      })),
    }));
  } catch (e) { console.warn('[saveAppState]', e.message); }
}

// ── Active image origin (for gating) ──────────────────────────────────────────
// 'tpdne'  — random face from TPDNE → user must apply a lookbook before anything else
// 'upload' — user-uploaded face → user must press TEMPO before anything else
// 'normal' — finished character (after TEMPO / lookbook-mix / loaded char / etc.)
let _activeImageOrigin = null;

function setActiveImageOrigin(origin) {
  _activeImageOrigin = origin || null;
  applyDraftGate();
  saveAppState();
}
function getActiveImageOrigin() { return _activeImageOrigin; }
window.getActiveImageOrigin = getActiveImageOrigin;

const _GATE_DRAFT_BUTTON_IDS = [
  'btn-gen-age', 'btn-gen-gender', 'btn-gen-pose', 'btn-gen-emotion',
  'btn-refine',
  'btn-save-obraz-left',
  'btn-save-persa-col2', 'btn-save-obraz-col2',
  'btn-obrinj',
];

function applyDraftGate() {
  const origin  = _activeImageOrigin;
  const gated   = (origin === 'tpdne' || origin === 'upload');

  // Toggle disabled-by-gate class on Draft buttons. We use a CSS class so
  // setLoading/etc. can still own the .disabled property independently.
  _GATE_DRAFT_BUTTON_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (gated) {
      el.setAttribute('data-gate-disabled', '1');
      el.disabled = true;
      el.title = (origin === 'tpdne')
        ? 'Apply a lookbook to dress the character first'
        : 'Press TEMPO to process the uploaded image first';
    } else if (el.getAttribute('data-gate-disabled')) {
      el.removeAttribute('data-gate-disabled');
      el.disabled = false;
      el.removeAttribute('title');
    }
  });

  // Lookbook section: highlighted in tpdne mode, disabled in upload mode
  const lbSection  = document.getElementById('lookbook-apply-section');
  const envSection = document.getElementById('env-select-section');
  if (lbSection) {
    lbSection.classList.toggle('gate-highlight-lookbook', origin === 'tpdne');
    lbSection.classList.toggle('gate-section-disabled',   origin === 'upload');
    if (origin === 'tpdne') lbSection.open = true; // expand <details> so user sees it
  }
  if (envSection) {
    envSection.classList.toggle('gate-section-disabled', gated);
  }

  // Lookbook hint label (👉 …)
  const HINT_ID = 'gate-lookbook-hint';
  const existingHint = document.getElementById(HINT_ID);
  if (origin === 'tpdne' && lbSection) {
    if (!existingHint) {
      const hint = document.createElement('div');
      hint.id = HINT_ID;
      hint.className = 'gate-lookbook-hint';
      hint.textContent = '👉 Apply a lookbook to dress the character';
      lbSection.parentElement.insertBefore(hint, lbSection);
    }
  } else {
    existingHint?.remove();
  }

  // TEMPO button visual highlight (upload mode only)
  const tempoBtn = document.getElementById('btn-tempo');
  if (tempoBtn) tempoBtn.classList.toggle('gate-highlight-tempo', origin === 'upload');

  // Status bar gate message + warn styling
  const statusBar = document.getElementById('status-bar');
  if (statusBar) statusBar.classList.toggle('gate-warn', gated);
  if (origin === 'tpdne')       setStatus('👉 First pick a lookbook in the right column and press Generate');
  else if (origin === 'upload') setStatus('👉 First press TEMPO to process the uploaded image');
}
window.applyDraftGate = applyDraftGate;

function restoreAppState() {
  let state;
  try { state = JSON.parse(localStorage.getItem(STATE_KEY) || 'null'); } catch { return; }
  if (!state) return;

  if (nameInput     && state.nameInputValue) nameInput.value      = state.nameInputValue;
  if (genderSelect  && state.genderValue)   genderSelect.value   = state.genderValue;
  if (poseSelect    && state.poseValue)     poseSelect.value     = state.poseValue;
  if (emotionSelect && state.emotionValue)  emotionSelect.value  = state.emotionValue;

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
    // fromCharThumb=true shows Обринж button if path is in /characters/
    showFace(state.generatedImagePath + '?t=' + Date.now(), state.generatedImagePath.includes('/characters/'));
    showSaveChar(true);
    renderHistoryNav();
  }

  if (state.activeAssets?.length) {
    activeAssets = state.activeAssets.map(a => ({ ...a, _imgEl: null }));
    renderAssetTable();
  }

  // Restore active image origin (for gating). Only honor it when there's
  // actually an active image to gate — otherwise the gate has nothing to lock onto.
  if (state.originValue && state.generatedImagePath) {
    _activeImageOrigin = state.originValue;
  } else {
    _activeImageOrigin = null;
  }
  applyDraftGate();
}

// Re-link _imgEl after a thumbnail row is (re)loaded — call from each load fn
function relinkActiveThumbs(row, pathAttr) {
  if (!activeAssets.length) return;
  row.querySelectorAll(`[${pathAttr || 'data-path'}]`).forEach(img => {
    const p = img.dataset.path;
    const asset = activeAssets.find(a => a.path === p);
    if (asset) { asset._imgEl = img; img.classList.add('asset-active'); }
  });
}

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
  if (btnObrinj) btnObrinj.style.display = fromCharThumb ? 'inline-block' : 'none';
  syncAssetDropZone?.();
  _updateImgActions();
}

function showTempo(v) {
  if (btnTempo) btnTempo.style.display = v ? 'inline-block' : 'none';
}

// tempoOriginalBlob — the very first uploaded file, kept for repeat TEMPO clicks
// tempoRefId        — id of the saved ref entry (set on first click)
// tempoPrompt       — generationPrompt from first analysis, reused on all repeat clicks (no re-analysis)
let tempoOriginalBlob = null;
let tempoRefId        = null;
let tempoPrompt       = null;

// In-flight cancel state. Set while a TEMPO generation is running.
//   abort        — AbortController for all fetches in the chain
//   pollIv       — setInterval id for the gen-status poll
//   newRefIdThisRun — id of the ref entry created on THIS run (deleted on cancel)
//   beautifyDone — true once we have a usable beautified prompt (cancel after this point keeps the ref)
let tempoRun = null;

function clearFace() {
  facePreview.src = '';
  facePreview.style.display = 'none';
  facePlaceholder.style.display = 'block';
  btnDeleteFace.style.display = 'none';
  if (btnObrinj) btnObrinj.style.display = 'none';
  tempoOriginalBlob = null;
  tempoRefId        = null;
  tempoPrompt       = null;
  showTempo(false);
  faceInput.value = '';
  currentFaceBlob    = null;
  generatedImagePath = null;
  _lastGen = null;
  _updateImgActions();
  _currentCharId     = null;
  refineExtra.value  = '';
  showSaveChar(false);
  faceDropzone.classList.remove('fullbody');
  setActiveImageOrigin(null);
  _hideFallbackBadge();
  saveAppState();
  syncAssetDropZone?.();
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
  tempoOriginalBlob = null;
  tempoRefId        = null;
  tempoPrompt       = null;
  showSaveChar(false);
  faceDropzone.classList.remove('fullbody');
  showFace(URL.createObjectURL(file));
  showTempo(true);
  nameInput.value = randomName(genderSelect?.value || 'female');
  // User-uploaded face → gate everything until TEMPO is pressed.
  setActiveImageOrigin('upload');
}
faceInput.addEventListener('change', () => handleFaceFile(faceInput.files[0]));
faceDropzone.addEventListener('dragover', e => { e.preventDefault(); faceDropzone.classList.add('drag-over'); });
faceDropzone.addEventListener('dragleave', () => faceDropzone.classList.remove('drag-over'));
faceDropzone.addEventListener('drop', e => {
  e.preventDefault(); faceDropzone.classList.remove('drag-over');
  const f = e.dataTransfer.files[0];
  if (f && f.type.startsWith('image/')) handleFaceFile(f);
});
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

btnRandomFace.addEventListener('click', async () => {
  btnRandomFace.disabled = true;
  setStatus('Loading random face…');
  const _sid = window.GenLog?.start('Character', '🎲 TPDNE: random face');
  try {
    const data = _sid && window.GenLog
      ? await window.GenLog.fetchLog(_sid, '🌐 thispersondoesnotexist.com', '/api/random-face', { method: 'GET' })
      : await fetch('/api/random-face').then(r => r.json());
    if (!data.success) throw new Error(data.error || 'TPDNE failed');
    // Treat TPDNE as a persistent active image (so the gated lookbook flow
    // survives page reloads). Origin = 'tpdne' → apply gate.
    currentFaceBlob = null;
    _currentCharId = null;   // fresh TPDNE face = new person → detach from selected actor
    generatedImagePath = data.imagePath;
    generationHistory  = []; historyIndex = -1; lastGeneratedSeed = null;
    showSaveChar(false);
    faceDropzone.classList.remove('fullbody');
    showFace(data.imagePath + '?t=' + Date.now());
    nameInput.value = randomName(genderSelect?.value || 'female');
    setActiveImageOrigin('tpdne');
    saveAppState();
    window.GenLog?.finalize(_sid, 'success');
  } catch (e) {
    window.GenLog?.finalize(_sid, 'error');
    setStatus('Error: ' + e.message);
  }
  finally { btnRandomFace.disabled = false; }
});

// ── TEMPO: analyze uploaded image → (save on first click) → generate 9:16 ─────
// First click: saves ref entry + analyzes + generates. Stores generationPrompt in tempoPrompt.
// Repeat clicks: skip analysis entirely — reuse tempoPrompt. Engine always from char tab (priority).
//
// While a run is in flight, the button switches to STOP (red). Single click on
// STOP flashes + shows tooltip; double-click pops a native confirm — accepting
// it aborts all fetches, stops polling, deletes the just-saved ref if the
// beautify pass hadn't finished yet, and restores the idle state.
function _enterStopMode() {
  btnTempo.classList.add('tempo-stop');
  btnTempo.textContent = 'STOP';
  btnTempo.title = 'Double-click to cancel TEMPO';
  btnTempo.disabled = false; // STOP must be clickable
}
function _exitStopMode() {
  btnTempo.classList.remove('tempo-stop', 'flash');
  btnTempo.textContent = 'TEMPO';
  btnTempo.title = '';
}
function _flashStop() {
  btnTempo.classList.remove('flash');
  // Force reflow so the animation can replay
  void btnTempo.offsetWidth;
  btnTempo.classList.add('flash');
}

async function _runTempo() {
  const blobToAnalyze = currentFaceBlob || tempoOriginalBlob;
  if (!blobToAnalyze) return;

  const isFirstRun = (tempoRefId === null);
  const ctrl = new AbortController();
  // Track the ref id we create on THIS run so cancellation can delete it.
  tempoRun = { abort: ctrl, pollIv: null, newRefIdThisRun: null, beautifyDone: !isFirstRun };

  setLoading(true);
  _enterStopMode();

  try {
    let generationPrompt;

    if (isFirstRun) {
      // ── First run: save + analyze + beautify (all inside /api/refs/save) ───
      setStatus('Tempo: analyzing image (Gemini)…');
      const imageBase64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload  = e => resolve(e.target.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blobToAnalyze);
      });
      const withRealism = true;   // realism always on (toggle removed)
      const markerGroups = window.getCategorizedRealismMarkers?.() || {};
      const saveRes  = await fetch('/api/refs/save', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64, withRealism, markerGroups, category: 'character' }),
        signal: ctrl.signal,
      });
      const saveData = await saveRes.json();
      if (!saveData.success) throw new Error(saveData.error);

      tempoOriginalBlob = blobToAnalyze;
      tempoRefId        = saveData.entry.id;
      tempoPrompt       = saveData.entry.generationPrompt;
      generationPrompt  = tempoPrompt;
      // Mark the ref id we just created so cancel can delete it; mark beautify done.
      if (tempoRun) {
        tempoRun.newRefIdThisRun = saveData.entry.id;
        tempoRun.beautifyDone = true;
      }
      setStatus(`Tempo: "${saveData.entry.title}" — launching generation…`);
    } else {
      // Repeat click: skip vision-analyze but still re-run the beautify pass
      // before generation, so each Tempo click produces a freshly-polished prompt.
      setStatus('Tempo: re-polishing saved prompt…');
      const beautyRes = await fetch('/api/refs/beautify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: tempoPrompt }),
        signal: ctrl.signal,
      });
      const beautyData = await beautyRes.json();
      if (!beautyData.success) throw new Error(beautyData.error || 'Beautify failed');
      generationPrompt = beautyData.prompt;
      setStatus('Tempo: prompt re-polished — launching generation…');
    }

    if (!generationPrompt) throw new Error('Prompt not found — try uploading the photo again');

    // Tempo always renders through GPT Image 2 — Character-tab engine selection
    // is intentionally ignored for this flow (the dropdown stays untouched in the UI).
    const _engine = 'gptimage2';
    const genRes  = await fetch('/api/refs/tempo-generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refId: tempoRefId, generationPrompt, forceEngine: _engine, engineParams: getEngineParams?.(_engine) || {} }),
      signal: ctrl.signal,
    });
    const genData = await genRes.json();
    if (!genData.success) throw new Error(genData.error);

    setStatus(`Tempo: generating (${genData.engine})…`);

    const imagePath = await new Promise((resolve, reject) => {
      const iv = setInterval(async () => {
        try {
          const sr = await fetch(`/api/refs/gen-status/${genData.taskId}`, { signal: ctrl.signal });
          const sd = await sr.json();
          if (!sd.success) { clearInterval(iv); reject(new Error(sd.error)); return; }
          if (sd.state === 'success')  { clearInterval(iv); resolve(sd.imagePath); }
          else if (sd.state === 'failed') { clearInterval(iv); reject(new Error(sd.error || 'Error')); }
          else { setStatus(`Tempo: generating… (${sd.state})`); }
        } catch (e) { clearInterval(iv); reject(e); }
      }, 3000);
      if (tempoRun) tempoRun.pollIv = iv;
      ctrl.signal.addEventListener('abort', () => {
        clearInterval(iv);
        reject(new Error('cancelled'));
      });
    });

    generatedImagePath = imagePath;
    currentFaceBlob    = null;
    lastGeneratedSeed  = genData.seed || null;
    showFace(imagePath + '?t=' + Date.now());
    pushToHistory(imagePath);
    showSaveChar(true);
    setActiveImageOrigin('normal');
    saveAppState();

    await fetch(`/api/refs/${tempoRefId}/add-generation`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imagePath, seed: genData.seed }),
    });

    setStatus(`Tempo: done. Engine: ${genData.engine}. Click again for a new generation.`);
  } catch (e) {
    const wasCancelled = (e.name === 'AbortError') || /cancelled/i.test(e.message || '');
    if (wasCancelled) {
      // Delete the ref entry created on THIS run (always — keeps refs.json clean).
      // newRefIdThisRun is only set when a first-run save completed, so we never
      // touch a ref that survived from an earlier successful run.
      if (tempoRun && tempoRun.newRefIdThisRun) {
        try {
          await fetch(`/api/refs/${tempoRun.newRefIdThisRun}`, { method: 'DELETE' });
        } catch {}
      }
      // Reset cached state so the next press starts fresh from analyze→beautify.
      tempoRefId  = null;
      tempoPrompt = null;
      setStatus('Tempo: cancelled — press TEMPO to retry.');
    } else {
      if (tempoPrompt === null || /beautify|generationPrompt/i.test(e.message || '')) {
        tempoRefId = null;
        tempoPrompt = null;
      }
      setStatus('Tempo: error — ' + e.message + '. Press TEMPO again to retry.');
    }
  } finally {
    if (tempoRun?.pollIv) clearInterval(tempoRun.pollIv);
    tempoRun = null;
    _exitStopMode();
    setLoading(false);
  }
}

if (btnTempo) {
  // Single click — start a run if idle; flash + tooltip while running.
  btnTempo.addEventListener('click', () => {
    if (tempoRun) {
      _flashStop();
      return;
    }
    _runTempo();
  });
  // Double click — only meaningful in STOP mode; native confirm aborts.
  btnTempo.addEventListener('dblclick', () => {
    if (!tempoRun) return;
    if (window.confirm('Cancel TEMPO?')) {
      tempoRun.abort.abort();
    }
  });
}

// ── Generation helpers ────────────────────────────────────────────────────────
// Locks every "regular" generation entry point on the Character tab while one is running.
// Lookbook+Environment (#btn-obrinj) is intentionally excluded — fully independent in both directions.
function setLoading(active) {
  btnRefine.disabled     = active;
  btnRandomFace.disabled = active;
  faceDropzone.style.pointerEvents = active ? 'none' : '';
  faceDropzone.classList.toggle('generating', active);
  ['btn-gen-age', 'btn-gen-gender', 'btn-gen-pose', 'btn-gen-emotion', 'btn-tempo'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    // While a TEMPO run is in flight, leave the STOP button clickable
    // so the user can cancel it (single click flashes, double-click confirms).
    if (id === 'btn-tempo' && tempoRun) return;
    el.disabled = active;
  });
  document.querySelectorAll('.adt-check-btn, .adt-gen-btn').forEach(el => {
    el.disabled = active;
  });
  // After releasing the loading lock, re-apply the gate so gate-disabled
  // buttons don't get re-enabled by setLoading(false).
  if (!active) applyDraftGate?.();
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
      createProject?.(imagePath, nameInput.value.trim() || randomName(genderSelect?.value || 'female'));
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

// ── Refine ─────────────────────────────────────
btnRefine.addEventListener('click', () => {
  if (!generatedImagePath) { setStatus('No image to edit.'); return; }
  const extra = refineExtra.value.trim();
  if (!extra) { setStatus('Enter changes.'); return; }

  runGeneration(
    { imagePath: generatedImagePath, extraInstruction: extra },
    'Applying refine…',
    { skipRealism: true }
  );
});

// ── Per-parameter apply buttons ───────────────────────────────────────────────
// Each button applies only its single parameter to the active image via extraInstruction.
// Falls back to full generation from blob if no generated image exists yet.
(function setupParamGenButtons() {
  function activeImagePath() { return generatedImagePath || null; }

  function resolveAge() {
    const v = document.getElementById('age')?.value || '18-30';
    return isCustomValue?.(v) ? (resolveCustomSelectValue?.(v) || v) : v;
  }
  function resolveGender() {
    const v = document.getElementById('gender')?.value || 'female';
    return isCustomValue?.(v) ? (resolveCustomSelectValue?.(v) || v) : v;
  }
  function resolveEmotion() {
    const v = emotionSelect?.value || 'neutral';
    if (isCustomValue?.(v)) return { emotion: null, customEmotionPrompt: resolveCustomSelectValue?.(v) || '' };
    return { emotion: v, customEmotionPrompt: '' };
  }
  function resolvePose() {
    let v = poseSelect?.value || 'random';
    if (isCustomValue?.(v)) return { poseKey: null, customPosePrompt: resolveCustomSelectValue?.(v) || '' };
    if (v === 'random') {
      v = POSE_KEYS[Math.floor(Math.random() * POSE_KEYS.length)];
      if (poseSelect) poseSelect.value = v;
    }
    return { poseKey: v, customPosePrompt: '' };
  }

  function applyParam(extraInstruction, labelStatus, opts = {}) {
    const imgPath = activeImagePath();
    if (!imgPath && !currentFaceBlob) { setStatus('Upload or generate an image.'); return; }
    const age    = resolveAge();
    const gender = resolveGender();
    const payload = imgPath
      ? { age, gender, imagePath: imgPath, extraInstruction }
      : (() => {
          // no generated image yet — run full generation instead
          const { poseKey, customPosePrompt } = resolvePose();
          const { emotion, customEmotionPrompt } = resolveEmotion();
          return { age, gender, poseKey, customPosePrompt, emotion, customEmotionPrompt };
        })();
    if (!imgPath) {
      // Fallback: full generation from face blob — keep full analysis pipeline
      blobToBase64(currentFaceBlob).then(faceBase64 => {
        runGeneration({ ...payload, faceBase64 }, labelStatus);
      });
    } else {
      runGeneration(payload, labelStatus, opts);
    }
  }

  // Age/gender instructions are finalized English templates → skip translation + realism analysis,
  // go straight to the selected engine.
  const _DIRECT_OPTS = { skipRealism: true, skipTranslate: true };

  document.getElementById('btn-gen-age')?.addEventListener('click', () => {
    const age = resolveAge();
    const instruction = _paramPrompts['param_age_instruction'].replace('{age}', age);
    applyParam(instruction, 'Applying age…', _DIRECT_OPTS);
  });

  document.getElementById('btn-gen-gender')?.addEventListener('click', () => {
    const gender = resolveGender();
    const word   = gender === 'male' ? 'male man' : 'female woman';
    const instruction = _paramPrompts['param_gender_instruction'].replace('{gender}', word);
    applyParam(instruction, 'Applying gender…', _DIRECT_OPTS);
  });

  document.getElementById('btn-gen-pose')?.addEventListener('click', async () => {
    const imgPath = activeImagePath();
    if (!imgPath && !currentFaceBlob) { setStatus('Upload or generate an image.'); return; }
    const { poseKey, customPosePrompt } = resolvePose();

    // No active generated image — fall back to full generation from face blob
    if (!imgPath) {
      const age = resolveAge(), gender = resolveGender();
      blobToBase64(currentFaceBlob).then(faceBase64 =>
        runGeneration({ age, gender, poseKey, customPosePrompt, faceBase64 }, 'Applying pose…')
      );
      return;
    }

    const poseSuffix    = poseKey ? poseKey.replace('pose_', '') : '';
    const poseScene     = customPosePrompt || _paramPrompts['param_pose_scene_' + poseSuffix] || 'Change the pose.';

    setLoading(true);
    setStatus('Analyzing character…');
    try {
      const r = await fetch('/api/character/apply-pose', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imagePath: imgPath, poseDescription: poseScene }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error || 'Pose analysis failed');
      runGeneration({ imagePath: imgPath, readyPrompt: d.prompt }, 'Applying pose…');
    } catch (err) {
      setStatus('Error: ' + err.message);
      _showGenError(err.message, () => document.getElementById('btn-gen-pose')?.click());
      setLoading(false);
    }
  });

  document.getElementById('btn-gen-emotion')?.addEventListener('click', async () => {
    const imgPath = activeImagePath();
    if (!imgPath && !currentFaceBlob) { setStatus('Upload or generate an image.'); return; }
    const { emotion, customEmotionPrompt } = resolveEmotion();

    // No active generated image — fall back to full generation from face blob
    if (!imgPath) {
      const age = resolveAge(), gender = resolveGender();
      blobToBase64(currentFaceBlob).then(faceBase64 =>
        runGeneration({ age, gender, emotion, customEmotionPrompt, faceBase64 }, 'Applying emotion…')
      );
      return;
    }

    const emotionDesc = customEmotionPrompt || _paramPrompts['emotion_' + emotion] || emotion;

    setLoading(true);
    setStatus('Analyzing character…');
    try {
      const r = await fetch('/api/character/apply-emotion', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imagePath: imgPath, emotionDescription: emotionDesc }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error || 'Emotion analysis failed');
      runGeneration({ imagePath: imgPath, readyPrompt: d.prompt }, 'Applying emotion…');
    } catch (err) {
      setStatus('Error: ' + err.message);
      _showGenError(err.message, () => document.getElementById('btn-gen-emotion')?.click());
      setLoading(false);
    }
  });
})();

// ── Select a persistent character (actor) from the dropdown / thumb row ───────
// Loads the actor's base face into the active image (a normal, dressable
// portrait), sets _currentCharId so the next "Save obraz" lands in this actor's
// личное дело, and reflects the selection in the dropdown.
function _loadActorByItem(c) {
  if (!c) return;
  snapshotCurrentProject?.();
  _currentCharId = c.id;
  _charFromSavePersa = false;   // reusing a pre-existing saved actor → Save obraz opens the actor card
  const src = c.baseFace || c.portrait || c.tpose || null;
  if (src) {
    generationHistory = []; historyIndex = -1; lastGeneratedSeed = null;
    generatedImagePath = src; currentFaceBlob = null;
    showFace(src + '?t=' + Date.now(), false);
    showSaveChar(true);
    setActiveImageOrigin('normal');
  }
  if (c.name) nameInput.value = c.name;
  const btnLabel = document.getElementById('char-dd-label');
  if (btnLabel) btnLabel.textContent = c.name || 'Character';
  _highlightCharDd();
  saveAppState();
  setStatus(`Character selected: ${c.name}. Dress it via Apply, then “Save obraz”. Press Edit for the full profile.`);
}

// Legacy flat-gallery loader (kept for any external callers).
function _loadCharacterByItem(item) {
  if (!item || !item.path) return;
  snapshotCurrentProject?.();
  generationHistory = []; historyIndex = -1; lastGeneratedSeed = null;
  generatedImagePath = item.path; currentFaceBlob = null;
  showFace(item.path + '?t=' + Date.now(), true);
  const parts = (item.name || '').split('_');
  nameInput.value = (parts[0] + (parts[1] ? ' ' + parts[1] : '')).replace(/_/g, ' ');
  showSaveChar(true);
  setActiveImageOrigin('normal');
  _highlightCharDd();
  saveAppState();
  setStatus(`Character loaded: ${item.name}`);
}

// Custom Character dropdown (actors) in the Media column.
function _highlightCharDd() {
  const list = document.getElementById('char-dd-list');
  if (!list) return;
  list.querySelectorAll('.char-dd-item').forEach(el =>
    el.classList.toggle('selected', String(el.dataset.charId) === String(_currentCharId)));
}
function _closeCharDd() {
  const l = document.getElementById('char-dd-list');
  if (l) l.style.display = 'none';
  document.removeEventListener('mousedown', _charDdOutside, true);
}
function _openCharDd() {
  const l = document.getElementById('char-dd-list');
  if (l) { l.style.display = 'block'; document.addEventListener('mousedown', _charDdOutside, true); }
}
function _charDdOutside(e) {
  const dd = document.getElementById('char-dd');
  if (dd && !dd.contains(e.target)) _closeCharDd();
}
// Build the dropdown list from persistent character (actor) records.
function _charThumbSrc(c) {
  const p = c.portrait || c.baseFace || c.tpose;
  return p ? (window.toThumbPath?.(p) || p) : '';
}
function _populateCharSelect(chars) {
  const list  = document.getElementById('char-dd-list');
  const label = document.getElementById('char-dd-label');
  if (!list) return;
  list.innerHTML = '';
  if (!chars || !chars.length) {
    const e = document.createElement('div'); e.className = 'char-dd-empty'; e.textContent = 'No saved characters';
    list.appendChild(e);
    if (label && !_currentCharId) label.textContent = 'No saved characters';
    return;
  }
  chars.forEach((c, i) => {
    const row = document.createElement('div'); row.className = 'char-dd-item'; row.dataset.charId = c.id;
    const img = document.createElement('img');
    const src = _charThumbSrc(c);
    const full = c.portrait || c.baseFace || c.tpose || '';
    if (src) { img.src = src + '?t=' + Date.now(); img.onerror = () => { img.onerror = null; if (full) img.src = full + '?t=' + Date.now(); }; }
    img.alt = '';
    const nm  = document.createElement('span'); nm.className = 'char-dd-name'; nm.textContent = c.name || ('Character ' + (i + 1));
    if ((c.portraitTask && !c.portrait) || (c.tposeTask && !c.tpose)) {
      const badge = document.createElement('span'); badge.textContent = ' ⏳'; badge.title = 'reference sheets generating'; nm.appendChild(badge);
    }
    row.appendChild(img); row.appendChild(nm);
    row.addEventListener('click', () => { _closeCharDd(); _loadActorByItem(c); });
    list.appendChild(row);
  });
  // Keep the label in sync with the currently selected actor.
  if (label && _currentCharId) {
    const cur = chars.find(c => String(c.id) === String(_currentCharId));
    if (cur) label.textContent = cur.name || 'Character';
  }
  _highlightCharDd();
}
document.getElementById('char-dd-btn')?.addEventListener('click', () => {
  const l = document.getElementById('char-dd-list');
  if (l && l.style.display === 'block') _closeCharDd(); else _openCharDd();
});
document.getElementById('char-edit-btn')?.addEventListener('click', () => {
  if (!_currentCharId) { setStatus('Select a character in the dropdown first.'); return; }
  window.openCharacterActorPopup?.(_currentCharId);
});

// ── D2: "Apply to image" 3-slot panel (Lookbook / Environment / Prop) ─────────
const _APPLY_URLS = { lookbook: '/api/lookbooks', environment: '/api/environments', prop: '/api/details' };
const _APPLY_PH = {
  lookbook:    'Optional — e.g. wear the jacket open, roll up the sleeves, add a belt',
  environment: 'Optional — e.g. golden-hour light, sit by the window, blurred background',
  prop:        'Optional — e.g. hold in the right hand near the face, place it on the table',
};

function _renderApplySlot(kind) {
  const sel   = _applySlots[kind];
  const thumb = document.querySelector('.apply-slot-thumb[data-kind="' + kind + '"]');
  const gen   = document.querySelector('.apply-slot-gen[data-kind="' + kind + '"]');
  const clr   = document.querySelector('.apply-slot-clear[data-kind="' + kind + '"]');
  const ta    = document.querySelector('.apply-slot-text[data-kind="' + kind + '"]');
  if (thumb) {
    thumb.innerHTML = '';
    if (sel) { const i = document.createElement('img'); i.src = sel.thumbPath || sel.path; thumb.appendChild(i); }
    else     { const s = document.createElement('span'); s.textContent = '＋'; thumb.appendChild(s); }
  }
  if (gen) gen.disabled = !sel;
  if (clr) clr.style.display = sel ? '' : 'none';
  if (ta) {
    ta.disabled = !sel;                       // text field present always, active only when chosen
    if (sel) { ta.placeholder = _APPLY_PH[kind] || ''; ta.classList.remove('needs-asset'); }
    else     { ta.placeholder = 'Pick an asset with the ＋ button'; ta.value = ''; ta.classList.add('needs-asset'); }
  }
}

// Transient engine/network errors worth one silent retry (the engine couldn't
// fetch an input image because the host dropped the connection, etc.).
function _isTransientGenError(msg) {
  return /connection aborted|remotedisconnected|remote end closed|econnreset|timeout|timed out|socket hang up|fetch failed|input or output was flagged/i.test(String(msg || ''));
}

// Apply one asset to the active image (pre-analyze → asset-interact/generate → poll).
async function _applyAssetToActive(assetPath, kind, userText, _attempt = 0) {
  // analyze uses the slot kind (lookbook|environment|prop) to pick the role prompt;
  // generate expects 'detail' for products (matches Edit's mix).
  const genType = { lookbook: 'lookbook', environment: 'environment', prop: 'detail' }[kind] || kind;
  const activePath = generatedImagePath;
  // Record this apply so the working-image Retry re-runs it against the SAME source
  // (not the result). Only the initial call records (skip the transient-error retry).
  if (_attempt === 0 && activePath) {
    const _src = activePath;
    _recordGen(() => { generatedImagePath = _src; _applyAssetToActive(assetPath, kind, userText); });
  }
  if (!activePath) { setStatus('No active image — load or generate a character first.'); return; }
  if (!assetPath)  { setStatus('Pick an asset first.'); return; }
  // When a persistent actor is selected, lookbook / environment apply also
  // sends its reference sheets so the face & body stay locked to that actor.
  const charRefPaths = (kind === 'lookbook' || kind === 'environment') ? _getCurrentCharRefs() : null;
  setLoading(true); setStatus(charRefPaths ? 'Analyzing (with character references)…' : 'Analyzing…');
  try {
    const preR = await fetch('/api/asset-interact/apply-analyze', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activePath, assetPath, assetType: kind, userText: userText || '', charRefPaths }),
    });
    const preD = await preR.json();
    if (!preD.success) throw new Error(preD.error);
    setStatus('Generating with asset…');
    const genR = await fetch('/api/asset-interact/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activePath, assetPath, prompt: preD.combinedPrompt, assetType: genType, imageEngine: getCharImageEngine(), charRefPaths }),
    });
    const d = await genR.json();
    if (!d.success) throw new Error(d.error);
    lastGeneratedSeed = d.seed || null;
    const imagePath = await pollUntilDone('/api/asset-interact/status/' + d.taskId, 'Asset');
    generatedImagePath = imagePath;
    showFace(imagePath + '?t=' + Date.now());
    pushToHistory(imagePath);
    pushToGeni?.(imagePath, lastGeneratedSeed, getCurrentProjectId?.());
    showSaveChar(true);
    // Dressing a gated raw face (TPDNE / upload) with a lookbook yields a finished
    // character → release the draft gate so Refine / Save char / Save obraz enable.
    // The asset-interact drag path already did this; this right-column slot apply
    // (the flow the gate hint tells the user to use) was missing it, so the gate
    // stayed on and setLoading(false)'s applyDraftGate() re-disabled everything.
    if (kind === 'lookbook' && (_activeImageOrigin === 'tpdne' || _activeImageOrigin === 'upload')) {
      setActiveImageOrigin('normal');
    }
    saveAppState();
    setStatus('Done! Result in the active image.');
  } catch (e) {
    // One automatic retry on transient remote/network failures (fresh upload +
    // new task) before surfacing the error to the user.
    if (_attempt < 1 && _isTransientGenError(e.message)) {
      setStatus('Transient engine error — retrying once…');
      setLoading(false);
      return _applyAssetToActive(assetPath, kind, userText, _attempt + 1);
    }
    setStatus('Generation error: ' + e.message);
  } finally { setLoading(false); }
}

// Modal picker: choose an asset from the matching gallery to fill a slot.
async function _openAssetPicker(kind) {
  const url = _APPLY_URLS[kind]; if (!url) return;
  let files = [];
  try { const d = await fetch(url).then(r => r.json()); files = (d && (d.files || d.items)) || []; } catch {}
  const ov  = document.createElement('div'); ov.className = 'apply-picker-ov';
  const box = document.createElement('div'); box.className = 'apply-picker-box';
  const ttl = document.createElement('div'); ttl.className = 'apply-picker-title'; ttl.textContent = 'Select ' + kind;
  const grid = document.createElement('div'); grid.className = 'apply-picker-grid';
  if (!files.length) { const e = document.createElement('div'); e.style.cssText = 'color:#888;padding:12px;'; e.textContent = 'Nothing here yet.'; grid.appendChild(e); }
  files.forEach(item => {
    const fp = item.path || (item.file ? ('/details/' + item.file) : null);
    if (!fp) return;
    const img = document.createElement('img'); img.className = 'apply-picker-thumb';
    img.src = item.thumbPath || fp; img.title = item.name || '';
    img.addEventListener('click', () => {
      _applySlots[kind] = { path: fp, thumbPath: item.thumbPath || fp, name: item.name || '' };
      _renderApplySlot(kind);
      ov.remove();
    });
    grid.appendChild(img);
  });
  const close = document.createElement('button'); close.className = 'apply-picker-close'; close.textContent = 'Close';
  close.addEventListener('click', () => ov.remove());
  box.appendChild(ttl); box.appendChild(grid); box.appendChild(close); ov.appendChild(box);
  ov.addEventListener('mousedown', e => { if (e.target === ov) ov.remove(); });
  document.body.appendChild(ov);
}

// Public hook for D3 (left dropdowns will fill the Lookbook/Environment slots).
window.fillApplySlot = function (kind, item) {
  if (!_applySlots.hasOwnProperty(kind) || !item) return;
  _applySlots[kind] = { path: item.path, thumbPath: item.thumbPath || item.path, name: item.name || '' };
  _renderApplySlot(kind);
};

['lookbook', 'environment', 'prop'].forEach(kind => {
  document.querySelector('.apply-slot-thumb[data-kind="' + kind + '"]')?.addEventListener('click', () => _openAssetPicker(kind));
  document.querySelector('.apply-slot-gen[data-kind="' + kind + '"]')?.addEventListener('click', () => {
    const s = _applySlots[kind]; if (!s) return;
    const ta = document.querySelector('.apply-slot-text[data-kind="' + kind + '"]');
    _applyAssetToActive(s.path, kind, ta ? ta.value : '');
  });
  document.querySelector('.apply-slot-clear[data-kind="' + kind + '"]')?.addEventListener('click', () => { _applySlots[kind] = null; _renderApplySlot(kind); });
  _renderApplySlot(kind);   // initial empty state (hint + highlight)
});

// ── Persistent characters (actors) — dropdown + thumb row ─────────────────────
// Source of truth is data/characters.json via /api/char-store/list. Powers both
// the Char dropdown and the thumbnail strip. Click selects (loads base face +
// sets _currentCharId); ✕ deletes the whole actor; the Edit button opens the
// full actor profile popup.
async function loadCharacterThumbs() {
  try {
    const d = await fetch('/api/char-store/list').then(r => r.json());
    const chars = (d && d.success && Array.isArray(d.chars)) ? d.chars : [];
    _actorCache = chars;
    _populateCharSelect(chars);
    if (!charThumbRow) return;
    charThumbRow.querySelector('#char-no-items')?.remove();
    charThumbRow.querySelectorAll('.char-thumb-wrap').forEach(el => el.remove());
    if (!chars.length) {
      const span = document.createElement('span');
      span.id = 'char-no-items'; span.textContent = 'No saved characters';
      charThumbRow.appendChild(span);
      return;
    }
    chars.forEach(c => {
      const wrap = document.createElement('div');
      wrap.className = 'char-thumb-wrap asset-thumb-wrap';

      const img = document.createElement('img');
      const src = _charThumbSrc(c);
      const full = c.portrait || c.baseFace || c.tpose || '';
      if (src) { img.src = src + '?t=' + Date.now(); img.onerror = () => { img.onerror = null; if (full) img.src = full + '?t=' + Date.now(); }; }
      img.className = 'char-thumb'; img.dataset.charId = c.id;
      const pending = (c.portraitTask && !c.portrait) || (c.tposeTask && !c.tpose);
      img.title = (c.name || '') + (pending ? ' · ⏳ reference sheets generating' : '') + ' · click — select · Edit — profile';
      img.addEventListener('click', e => {
        e.stopPropagation();
        charThumbRow.querySelectorAll('.char-thumb').forEach(t => t.classList.remove('selected'));
        img.classList.add('selected');
        _loadActorByItem(c);
      });
      img.addEventListener('dblclick', e => { e.stopPropagation(); window.openCharacterActorPopup?.(c.id); });

      const delBtn = document.createElement('button');
      delBtn.textContent = '✕'; delBtn.title = 'Delete character'; delBtn.className = 'asset-del-btn';
      let _armed = false, _t = null;
      delBtn.addEventListener('click', async e => {
        e.stopPropagation();
        if (!_armed) { _armed = true; delBtn.style.background = '#c0392b'; delBtn.style.color = '#fff';
          _t = setTimeout(() => { _armed = false; delBtn.style.background = ''; delBtn.style.color = ''; }, 2000); return; }
        clearTimeout(_t);
        try {
          // Cascade: remove all of this actor's photoshoots (files + records),
          // keep the voice in the library, then delete the actor.
          const linked = (getObrazы?.() || []).filter(o => String(o.charId) === String(c.id));
          linked.forEach(o => { try { deleteObraz(o.id); } catch {} });
          const r = await fetch('/api/char-store/' + encodeURIComponent(c.id), { method: 'DELETE' });
          const rd = await r.json();
          if (!rd.success) throw new Error(rd.error || 'delete failed');
          if (String(_currentCharId) === String(c.id)) _currentCharId = null;
          wrap.remove();
          setStatus(`Character deleted (${linked.length} photoshoot(s) removed, voice kept).`);
          loadCharacterThumbs();
          loadObrazы?.(); window.loadScenarioObrazы?.(); loadCharCol3Obrazy?.();
        } catch (err) { setStatus('Error: ' + err.message); }
      });

      wrap.appendChild(img); wrap.appendChild(delBtn);
      charThumbRow.appendChild(wrap);
    });
  } catch (e) { console.warn('loadCharacterThumbs:', e.message); }
}
// Public alias used by the actor popup to refresh dropdown + strip after edits.
window.loadActorChars = loadCharacterThumbs;

// ── Lookbook thumbnails ───────────────────────────────────────────────────────
async function loadLookbookThumbs() {
  try {
    const d = await fetch('/api/lookbooks').then(r => r.json());
    lbNoItems?.remove();
    lbThumbRow.querySelectorAll('.asset-thumb-wrap').forEach(el => el.remove());
    if (!d.success || !d.files.length) {
      if (!lbThumbRow.querySelector('#lb-no-items')) {
        const span = document.createElement('span');
        span.id = 'lb-no-items'; span.textContent = 'No lookbooks';
        lbThumbRow.appendChild(span);
      }
      return;
    }
    d.files.forEach(item => {
      const fp = item.path || item;
      if (lbThumbRow.querySelector(`[data-path="${fp}"]`)) return;
      const wrap = document.createElement('div');
      wrap.className = 'asset-thumb-wrap';

      const img = document.createElement('img');
      const lbThumbSrc = (item.thumbPath || fp) + '?t=' + Date.now();
      img.src = lbThumbSrc; img.className = 'lb-thumb'; img.dataset.path = fp;
      if (fp === selectedLbPath) img.classList.add('selected');
      img.title = 'click — activate · double-click — select for Apply';
      makeThumbDraggable?.(img, fp, item.thumbPath || fp, item.name || '', 'lookbook');
      let _lbClickTimer = null;
      img.addEventListener('click', e => {
        e.stopPropagation();
        clearTimeout(_lbClickTimer);
        _lbClickTimer = setTimeout(() => {
          activateAsset?.(fp, item.thumbPath || fp, item.name || '', 'lookbook', img);
        }, 220);
      });
      img.addEventListener('dblclick', e => {
        e.stopPropagation();
        clearTimeout(_lbClickTimer);
        lbThumbRow.querySelectorAll('.lb-thumb').forEach(t => t.classList.remove('selected'));
        img.classList.add('selected');
        selectedLbPath = fp;
        setStatus('Lookbook selected.');
      });

      const delBtn = document.createElement('button');
      delBtn.className = 'asset-del-btn'; delBtn.textContent = '✕'; delBtn.title = 'Archive';
      delBtn.addEventListener('click', async e => {
        e.stopPropagation();
        try {
          const r = await fetch('/api/gallery/archive', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filePath: fp }),
          });
          const rd = await r.json();
          if (!rd.success) throw new Error(rd.error);
          if (selectedLbPath === fp) { selectedLbPath = null; }
          wrap.remove(); setStatus('Lookbook moved to archive.');
        } catch (err) { setStatus('Error: ' + err.message); }
      });

      wrap.appendChild(img); wrap.appendChild(delBtn);
      lbThumbRow.appendChild(wrap);
    });
    relinkActiveThumbs(lbThumbRow, 'data-path');
  } catch (e) { console.warn('loadLookbookThumbs:', e.message); }
}

// ── Environment thumbnails ────────────────────────────────────────────────────
async function loadEnvironmentThumbs() {
  try {
    const d = await fetch('/api/environments').then(r => r.json());
    envNoItems?.remove();
    envThumbRow.querySelectorAll('.asset-thumb-wrap').forEach(el => el.remove());
    if (!d.success || !d.files.length) {
      if (!envThumbRow.querySelector('#env-no-items')) {
        const span = document.createElement('span');
        span.id = 'env-no-items'; span.textContent = 'No environments';
        envThumbRow.appendChild(span);
      }
      return;
    }
    d.files.forEach(item => {
      const fp = item.path || item;
      if (envThumbRow.querySelector(`[data-path="${fp}"]`)) return;
      const wrap = document.createElement('div');
      wrap.className = 'asset-thumb-wrap';

      const img = document.createElement('img');
      img.src = (item.thumbPath || fp) + '?t=' + Date.now(); img.className = 'env-thumb'; img.dataset.path = fp;
      if (fp === selectedEnvPath) img.classList.add('selected');
      img.title = 'click — activate · double-click — select for Apply';
      makeThumbDraggable?.(img, fp, item.thumbPath || fp, item.name || '', 'environment');
      let _envClickTimer = null;
      img.addEventListener('click', e => {
        e.stopPropagation();
        clearTimeout(_envClickTimer);
        _envClickTimer = setTimeout(() => {
          activateAsset?.(fp, item.thumbPath || fp, item.name || '', 'environment', img);
        }, 220);
      });
      img.addEventListener('dblclick', e => {
        e.stopPropagation();
        clearTimeout(_envClickTimer);
        envThumbRow.querySelectorAll('.env-thumb').forEach(t => t.classList.remove('selected'));
        img.classList.add('selected');
        selectedEnvPath = fp;
        setStatus('Environment selected.');
      });

      const delBtn = document.createElement('button');
      delBtn.className = 'asset-del-btn'; delBtn.textContent = '✕'; delBtn.title = 'Archive';
      delBtn.addEventListener('click', async e => {
        e.stopPropagation();
        try {
          const r = await fetch('/api/gallery/archive', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filePath: fp }),
          });
          const rd = await r.json();
          if (!rd.success) throw new Error(rd.error);
          if (selectedEnvPath === fp) { selectedEnvPath = null; }
          wrap.remove(); setStatus('Environment moved to archive.');
        } catch (err) { setStatus('Error: ' + err.message); }
      });

      wrap.appendChild(img); wrap.appendChild(delBtn);
      envThumbRow.appendChild(wrap);
    });
    relinkActiveThumbs(envThumbRow, 'data-path');
  } catch (e) { console.warn('loadEnvironmentThumbs:', e.message); }
}


// ── Detail (предмет) thumbnails — Col 3 of character tab ─────────────────────
async function loadDetailThumbs() {
  if (!charDetailThumbRow) return;
  try {
    const d = await fetch('/api/details').then(r => r.json());
    charDetailNoItems?.remove();
    charDetailThumbRow.querySelectorAll('.asset-thumb-wrap').forEach(el => el.remove());
    if (!d.success || !d.files.length) {
      if (!charDetailThumbRow.querySelector('#char-detail-no-items')) {
        const span = document.createElement('span');
        span.id = 'char-detail-no-items';
        span.style.cssText = 'color:#888;font-size:11px;';
        span.textContent = 'No items';
        charDetailThumbRow.appendChild(span);
      }
      return;
    }
    d.files.forEach(item => {
      const fp = item.path || item;
      if (charDetailThumbRow.querySelector(`[data-path="${fp}"]`)) return;
      const wrap = document.createElement('div');
      wrap.className = 'asset-thumb-wrap';

      const img = document.createElement('img');
      img.src = (item.thumbPath || fp) + '?t=' + Date.now();
      img.className = 'detail-thumb';
      img.dataset.path = fp;
      img.title = (item.name || '') + ' · click — activate';
      makeThumbDraggable?.(img, fp, item.thumbPath || fp, item.name || '', 'detail');
      img.addEventListener('click', e => {
        e.stopPropagation();
        activateAsset?.(fp, item.thumbPath || fp, item.name || '', 'detail', img, item.size || '');
      });

      const delBtn = document.createElement('button');
      delBtn.className = 'asset-del-btn'; delBtn.textContent = '✕'; delBtn.title = 'Archive';
      delBtn.addEventListener('click', async e => {
        e.stopPropagation();
        try {
          const r = await fetch('/api/gallery/archive', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filePath: fp }),
          });
          const rd = await r.json();
          if (!rd.success) throw new Error(rd.error);
          wrap.remove();
          setStatus('Item moved to archive.');
        } catch (err) { setStatus('Error: ' + err.message); }
      });

      wrap.appendChild(img); wrap.appendChild(delBtn);
      charDetailThumbRow.appendChild(wrap);
    });
    relinkActiveThumbs(charDetailThumbRow, 'data-path');
  } catch (e) { console.warn('loadDetailThumbs:', e.message); }
}

// ── Обринж: generate t-pose + clothing + environment from current face ────────
btnObrinj?.addEventListener('click', async () => {
  if (!generatedImagePath) {
    setStatus('For Obrinj, generate a full-body character first.'); return;
  }

  const imageBase64 = await blobToBase64(await fetch(generatedImagePath).then(r => r.blob()));

  btnObrinj.disabled = true;
  setStatus('Launching Obrinj…');

  // Prepare result grid in Col 3
  const lbGrid = document.getElementById('lb-grid');
  if (lbGrid) lbGrid.innerHTML = '';
  document.getElementById('lb-add-to-db-btn')?.remove();

  const tposeId    = Date.now();
  const clothingId = tposeId + 1;
  const envId      = tposeId + 2;
  lbAddCard(tposeId,    'tpose');
  lbAddCard(clothingId, 'clothing');
  lbAddCard(envId,      'environment');

  const balBefore = currentCredits;
  try {
    const r = await fetch('/api/obrinj/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64, imageEngine: getCharImageEngine() }),
    });
    const d = await r.json();
    if (!d.success) throw new Error(d.error);

    setStatus('Obrinj: generating 3 images…');
    await Promise.all([
      pollTask(d.tposeTaskId,    `/api/obrinj/tpose/status/${d.tposeTaskId}`,    tposeId,    'T-pose')
        .then(p => { if (p) logGeneration('Obrinj (T-pose)',    location.origin + p, balBefore); }).catch(() => {}),
      pollTask(d.clothingTaskId, `/api/lookbook/status/${d.clothingTaskId}`,     clothingId, 'Clothing')
        .then(p => { if (p) logGeneration('Obrinj (clothing)',    location.origin + p, null);      }).catch(() => {}),
      pollTask(d.envTaskId,      `/api/environment/status/${d.envTaskId}`,        envId,      'Environment')
        .then(p => { if (p) logGeneration('Obrinj (environment)', location.origin + p, null);      }).catch(() => {}),
    ]);

    setStatus('Obrinj ready! Select what to save.');
    showAddToDbButton();
  } catch (e) { setStatus('Obrinj error: ' + e.message); }
  finally { btnObrinj.disabled = false; }
});

// ── Смена пола → перегенерировать имя ────────────────────────────────────────
genderSelect?.addEventListener('change', () => {
  nameInput.value = randomName(genderSelect.value);
});

// ── Сохранить образ (левая колонка) ──────────────────────────────────────────
btnSaveObrazLeft?.addEventListener('click', async () => {
  let imgPath = generatedImagePath;

  if (!imgPath && currentFaceBlob) {
    // Face was uploaded but not generated — save blob to server first
    btnSaveObrazLeft.disabled = true;
    setStatus('Uploading image…');
    try {
      const b64 = await blobToBase64(currentFaceBlob);
      const r   = await fetch('/api/upload-face', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: b64 }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error);
      imgPath = d.imagePath;
      generatedImagePath = imgPath; // cache so next save skips re-upload
    } catch (e) {
      setStatus('Upload error: ' + e.message);
      btnSaveObrazLeft.disabled = false;
      return;
    }
    btnSaveObrazLeft.disabled = false;
  }

  if (!imgPath) {
    setStatus('First generate or upload a character image.');
    return;
  }

  const gender  = genderSelect?.value || 'female';
  const name    = nameInput.value.trim() || randomName(gender);
  const _saveEngine = getCharImageEngine();

  // Step 1: ask the server to create a dedicated obrazy/<slug>_<id>/ folder
  // and MOVE the active look-image into it. Returns the new char path. If the
  // call fails we fall back to the legacy /characters/ path so the user
  // doesn't lose their save.
  const _newObrazId = Date.now();
  let _finalCharPath = imgPath;
  try {
    const cr = await fetch('/api/obrazy/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: _newObrazId, name, charPath: imgPath }),
    }).then(r => r.json());
    if (cr.success && cr.charPath) {
      _finalCharPath = cr.charPath;
      // Update the in-memory state so subsequent UI ops (history, showFace,
      // next "Save char" click) keep working after the file has been moved.
      generatedImagePath = _finalCharPath;
      const lastIdx = generationHistory.length - 1;
      if (lastIdx >= 0 && generationHistory[lastIdx] === imgPath) {
        generationHistory[lastIdx] = _finalCharPath;
      }
    } else {
      console.warn('[save-obraz] create-folder failed:', cr.error);
    }
  } catch (e) {
    console.warn('[save-obraz] create-folder error, falling back to legacy path:', e.message);
  }

  // Step 2: persist obraz with the (possibly relocated) char path. saveObraz
  // assigns its own Date.now() id internally, so we patch the just-inserted
  // entry to use _newObrazId — the same id the folder is keyed on.
  saveObraz(_finalCharPath, selectedLbPath, selectedEnvPath, name, gender, lastGeneratedSeed, [null, null, null, null], _saveEngine, _currentCharId);
  // Rewrite the freshly-saved entry's id to match the folder
  {
    const list = getObrazы();
    if (list[0]) {
      list[0].id = _newObrazId;
      localStorage.setItem('obrazy', JSON.stringify(list));
    }
  }
  const obrazId = _newObrazId;
  // Anchor the fallback chain on this newly-saved obraz: if generatedImagePath
  // ever fails to load (file moved, deleted, etc.), restoreAppState / showFace
  // will use this id to look up the obraz and substitute its char image.
  lastSavedObrazId = _newObrazId;
  saveAppState();
  loadObrazы();
  window.loadScenarioObrazы?.();
  // ── Open the photoshoot popup (poses) ──────────────────────────────────────
  // The character CARD is created only when the user SAVES the photoshoot (handled
  // inside the popup), not here:
  //   - Flow A (a saved character is linked, _currentCharId set): the popup saves the
  //     photoshoot into that character's dossier. No new card, no voice popup.
  //   - Flow B (raw new face from TPDNE / TEMPO, no character): the popup creates the
  //     character on Save, then opens its profile for voice. Closing the popup WITHOUT
  //     saving discards this new obraz — so nothing hangs in the character dropdown.
  if (_currentCharId) {
    // Flow A: inherit the actor's voice onto this obraz for convenience.
    fetch('/api/char-store/list').then(r => r.json()).then(cd => {
      const c = (cd.chars || []).find(x => String(x.id) === String(_currentCharId));
      if (c && c.voice) {
        const list = getObrazы(); const o = list.find(o => o.id === _newObrazId);
        if (o) { o.voice = c.voice; (window._persistObrazы || ((l) => localStorage.setItem('obrazy', JSON.stringify(l))))(list); loadObrazы(); window.loadScenarioObrazы?.(); loadCharCol3Obrazy?.(); }
      }
    }).catch(() => {});
  }
  setStatus(`Образ "${name}" сохранён — фотосессия.`);
  window.openPhotoshootPopup?.(obrazId, { charId: _currentCharId || null, isNew: true });
});

// Poll a pose variation task — respects slot ownership (fulfillObrazSlot routes to
// slot or editResults depending on whether a newer реран has taken ownership).
// Guards against duplicate polling. Timeout after 5 minutes → error.
const _activePoseVariationPolls = new Set();

async function pollPoseVariation(obrazId, taskId, idx) {
  if (_activePoseVariationPolls.has(taskId)) return;
  _activePoseVariationPolls.add(taskId);
  const MAX = 100, INTERVAL = 3000; // 5 minutes
  try {
    for (let i = 0; i < MAX; i++) {
      await new Promise(r => setTimeout(r, INTERVAL));
      try {
        const r = await fetch(`/api/characters/pose-status/${taskId}?obrazId=${encodeURIComponent(obrazId)}`);
        const d = await r.json();
        if (d.state === 'success') {
          const wasOwner = fulfillObrazSlot(obrazId, taskId, idx, d.imagePath);
          loadObrazы();
          window.loadScenarioObrazы?.();
          if (wasOwner) {
            const entry = getObrazы().find(o => o.id === obrazId);
            if (entry?.variations?.every(v => v && v !== null)) setStatus('All pose variations ready!');
          }
          return;
        }
        if (d.state === 'failed') {
          console.error(`[pose-var] idx=${idx} failed: ${d.error}`);
          fulfillObrazSlot(obrazId, taskId, idx, 'error');
          loadObrazы();
          window.loadScenarioObrazы?.();
          return;
        }
      } catch (e) {
        console.warn(`[pose-var] poll idx=${idx}:`, e.message);
      }
    }
    // Timeout after 5 min
    console.warn(`[pose-var] timeout idx=${idx} taskId=${taskId}`);
    fulfillObrazSlot(obrazId, taskId, idx, 'error');
    loadObrazы();
    window.loadScenarioObrazы?.();
  } finally {
    _activePoseVariationPolls.delete(taskId);
  }
}

// Col 2 save-образ button — same logic as left column button
btnSaveObrazCol2?.addEventListener('click', () => btnSaveObrazLeft?.click());

// ── Save char — create a persistent reusable actor ───────────────────────────
// Snapshots the active face, kicks off the two neutral reference sheets
// (portrait 3-views + full-body T-pose), then opens the actor profile popup
// where the sheets fill in live and the user can set up the voice.
async function savePersa() {
  const imgPath = generatedImagePath;
  if (!imgPath) { setStatus('No active image to save.'); return; }
  const btn2 = btnSavePersaCol2;
  if (btn2) btn2.disabled = true;
  setStatus('Saving character & generating reference sheets…');
  try {
    // Reference sheets default to gpt-image-2 (high quality); the actor popup's
    // engine dropdown can change this and remembers the choice.
    const refEngine = localStorage.getItem('char_ref_engine_v1') || 'gptimage2';
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
        name:          nameInput.value.trim() || randomName(genderSelect?.value || 'female'),
        gender:        genderSelect?.value || null,
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
    _charFromSavePersa = true;   // freshly saved this session → next "Save obraz" opens the obraz popup
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

// ── Active assets table (full-width, above status bar) ────────────────────────
const assetDropZone  = document.getElementById('asset-drop-zone');
const assetDropTbody = document.getElementById('asset-drop-tbody');

const MAX_ASSETS = 5;
// Each entry: { path, thumbSrc, name, assetType, nameVal, presetVal, _imgEl }
let activeAssets = [];

const POSE_PRESET_OPTIONS = [
  { value: '',              label: '— preset —' },
  { value: 'pose_desk',     label: '1 — At the desk' },
  { value: 'pose_sofa',     label: '2 — On the sofa' },
  { value: 'pose_window',   label: '3 — By the window' },
  { value: 'pose_kitchen',  label: '4 — In the kitchen' },
  { value: 'pose_standing', label: '5 — Standing' },
];
const DETAIL_PRESET_OPTIONS = [
  { value: '',         label: '— preset —' },
  { value: 'holds',    label: 'Holds in hand' },
  { value: 'wears',    label: 'Puts on' },
  { value: 'near',     label: 'Stands nearby' },
  { value: 'uses',     label: 'Uses' },
  { value: 'looks_at', label: 'Looks at' },
];
const LB_ENV_PRESET_OPTIONS = [
  { value: '',           label: '— preset —' },
  { value: 'apply',      label: 'Apply style' },
  { value: 'background', label: 'Use as background' },
  { value: 'blend',      label: 'Blend with current' },
];

const ASSET_TYPE_LABELS = {
  character:   'Character',
  lookbook:    'Lookbook',
  environment: 'Environment',
  detail:      'Item',
};

// Build preset select from AI-generated variants stored on the asset object
function buildPresetSelectFromVariants(asset) {
  const sel = document.createElement('select');
  sel.className = 'adt-select';
  const placeholder = document.createElement('option');
  placeholder.value = ''; placeholder.textContent = '— press ✓ —';
  sel.appendChild(placeholder);
  (asset.variants || []).forEach(({ label, prompt }) => {
    const opt = document.createElement('option');
    opt.value = prompt; opt.textContent = label;
    if (prompt === asset.presetVal) opt.selected = true;
    sel.appendChild(opt);
  });
  sel.addEventListener('change', () => { asset.presetVal = sel.value; saveAppState(); });
  return sel;
}

// Save current input values from DOM rows back into activeAssets
function saveRowValues() {
  if (!assetDropTbody) return;
  Array.from(assetDropTbody.rows).forEach((tr, i) => {
    if (!activeAssets[i]) return;
    const inputs = tr.querySelectorAll('.adt-input:not(.adt-size-input)');
    if (inputs[0]) activeAssets[i].exhonVal = inputs[0].value;
    const sizeIn = tr.querySelector('.adt-size-input');
    if (sizeIn) activeAssets[i].size = sizeIn.value;
    const presetSel = tr.querySelector('.adt-select');
    if (presetSel) activeAssets[i].presetVal = presetSel.value;
  });
}

// Re-render all rows from activeAssets array
function renderAssetTable() {
  if (!assetDropTbody) return;
  assetDropTbody.innerHTML = '';
  const n = activeAssets.length;
  if (!n) {
    assetDropTbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:#888;padding:14px;font-size:11px;">Drag characters, lookbooks or products here to batch-generate.</td></tr>';
    return;
  }

  activeAssets.forEach((asset, idx) => {
    const tr = document.createElement('tr');
    tr.dataset.path = asset.path;

    // Col 1: № dropdown
    const tdOrder = document.createElement('td');
    const orderSel = document.createElement('select');
    orderSel.className = 'adt-order-sel';
    for (let p = 1; p <= n; p++) {
      const opt = document.createElement('option');
      opt.value = p; opt.textContent = p;
      if (p === idx + 1) opt.selected = true;
      orderSel.appendChild(opt);
    }
    orderSel.addEventListener('change', () => {
      const target = parseInt(orderSel.value, 10) - 1;
      if (target === idx) { orderSel.value = idx + 1; return; }
      saveRowValues();
      const [moved] = activeAssets.splice(idx, 1);
      activeAssets.splice(target, 0, moved);
      renderAssetTable();
      saveAppState();
    });
    tdOrder.appendChild(orderSel);

    // Col 2: ИМГ
    const tdImg = document.createElement('td');
    const thumb = document.createElement('img');
    thumb.src = asset.thumbSrc || toThumbPath(asset.path);
    thumb.className = 'adt-img';
    thumb.addEventListener('click', () => openLightbox(asset.path));
    tdImg.appendChild(thumb);

    // Col 3: АССЕТ badge
    const tdAsset = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = 'adt-asset-badge';
    badge.textContent = ASSET_TYPE_LABELS[asset.assetType] || asset.assetType || '—';
    tdAsset.appendChild(badge);

    // Col 4: РАЗМЕР (only for detail assets)
    const tdSize = document.createElement('td');
    if (asset.assetType === 'detail') {
      const sizeIn = document.createElement('input');
      sizeIn.type = 'text'; sizeIn.className = 'adt-input adt-size-input';
      sizeIn.placeholder = 'e.g. 250ml';
      sizeIn.value = asset.size || '';
      sizeIn.addEventListener('blur', async () => {
        const val = sizeIn.value.trim();
        asset.size = val;
        saveAppState();
        const filename = asset.path.replace(/^\/details\//, '');
        await fetch(`/api/details/meta/${encodeURIComponent(filename)}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ size: val }),
        }).catch(() => {});
      });
      tdSize.appendChild(sizeIn);
    } else {
      tdSize.style.color = '#888';
      tdSize.textContent = '—';
    }

    // Col 5: ЭКШОН
    const tdExhon = document.createElement('td');
    const exhonIn = document.createElement('input');
    exhonIn.type = 'text'; exhonIn.className = 'adt-input';
    exhonIn.placeholder = 'Interaction…';
    exhonIn.value = asset.exhonVal || '';
    exhonIn.addEventListener('blur', () => { asset.exhonVal = exhonIn.value; saveAppState(); });
    tdExhon.appendChild(exhonIn);

    // Col 6: ПРЕСЕТ (empty until ✓ pressed)
    const tdPreset = document.createElement('td');
    tdPreset.className = 'adt-preset-cell';
    tdPreset.appendChild(buildPresetSelectFromVariants(asset));

    // Col 8: ✓ — запустить AI-анализ
    const tdCheck = document.createElement('td');
    const checkBtn = document.createElement('button');
    checkBtn.className = 'adt-check-btn'; checkBtn.textContent = '✓';
    checkBtn.title = 'Analyze variants';
    checkBtn.addEventListener('click', async () => {
      // Collect current row inputs
      asset.exhonVal = exhonIn.value;
      const userAction = (asset.exhonVal || '').trim();

      const activePath = generatedImagePath;
      if (!activePath) { setStatus('First upload the active image.'); return; }

      checkBtn.textContent = '…';
      setLoading(true);
      setStatus('Analyzing interaction variants…');

      let analyzeOk = false;
      try {
        const r = await fetch('/api/asset-interact/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            activePath,
            assetPath: asset.path,
            nameVal:   asset.name || '',
            exhon:     asset.exhonVal,
            assetSize: asset.size || '',
          }),
        });
        const d = await r.json();
        if (!d.success) throw new Error(d.error);

        asset.variants = d.variants; // [{label, prompt}, ...]
        // When user typed something in Action, seed the first variant as the
        // active preset so the immediate auto-generate uses it (matches the
        // user's intent). Empty action → no preset selection, no auto-gen.
        asset.presetVal = (userAction && d.variants?.[0]?.prompt) ? d.variants[0].prompt : '';
        saveVariantsForPath(asset.path, d.variants);

        // Rebuild only the preset cell in this row without full re-render
        tdPreset.innerHTML = '';
        tdPreset.appendChild(buildPresetSelectFromVariants(asset));
        saveAppState();
        if (!userAction) setStatus(`Received ${d.variants.length} variants. Select in the PRESET column.`);
        analyzeOk = true;
      } catch (e) {
        setStatus('Analysis error: ' + e.message);
      } finally {
        checkBtn.textContent = '✓';
        setLoading(false);
      }

      // Auto-chain into Generate ONLY when user typed an action and analyze
      // succeeded. runAssetGen owns its own setLoading lifecycle + error inline UI.
      if (analyzeOk && userAction && asset.presetVal) {
        runAssetGen();
      }
    });
    tdCheck.appendChild(checkBtn);

    // Col 9: ГЕНЕРИРОВАТЬ
    const tdGen = document.createElement('td');
    const genBtn = document.createElement('button');
    genBtn.className = 'adt-gen-btn'; genBtn.textContent = 'Generate';

    // Inline error row for this asset
    const assetErrWrap = document.createElement('div');
    assetErrWrap.style.cssText = 'display:none;margin-top:3px;padding:3px 5px;background:#3a1111;border:1px solid #a33;border-radius:3px;font-size:9px;color:#f99;';
    const assetErrMsg  = document.createElement('div');
    assetErrMsg.style.cssText = 'margin-bottom:3px;word-break:break-word;';
    const assetRetry   = document.createElement('button');
    assetRetry.textContent = '↺ Retry';
    assetRetry.style.cssText = 'font-size:9px;padding:1px 6px;cursor:pointer;background:#1155cc;color:#fff;border:none;border-radius:3px;';
    assetErrWrap.appendChild(assetErrMsg);
    assetErrWrap.appendChild(assetRetry);

    async function runAssetGen() {
      const activePath = generatedImagePath;
      if (!activePath) { setStatus('No active image.'); return; }

      genBtn.textContent = '…';
      assetErrWrap.style.display = 'none';
      setLoading(true);

      // TPDNE-gated mode: dressing a raw face with a lookbook → use the
      // dedicated apply-lookbook-mix analysis (face identity + outfit → waist-up
      // portrait on neutral contrasting background). Falls back to the generic
      // asset-interact pre-analyze for non-tpdne / non-lookbook combinations.
      const isTpdneLookbookMix = (_activeImageOrigin === 'tpdne' && asset.assetType === 'lookbook');

      // GenLog session — only opened for the TPDNE-lookbook flow so the
      // dropdown shows the same per-step breakdown other generations do. For
      // regular asset interactions the existing pollUntilDone activity row stays.
      const _glSid = isTpdneLookbookMix
        ? window.GenLog?.start('Character', '👗 Lookbook on TPDNE')
        : null;

      try {
        let combinedPrompt;
        if (isTpdneLookbookMix) {
          setStatus('Analyzing face + lookbook…');
          const mixBody = { imagePath: activePath, lookbookImagePath: asset.path };
          const mixD = _glSid && window.GenLog
            ? await window.GenLog.fetchLog(_glSid, '🧠 Analysis: face + lookbook', '/api/character/apply-lookbook-mix', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(mixBody) })
            : await fetch('/api/character/apply-lookbook-mix', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(mixBody) }).then(r => r.json());
          if (!mixD.success) throw new Error(mixD.error);
          combinedPrompt = mixD.prompt;
        } else {
          // Step 1: Gemini pre-analysis — combine active image + asset + optional preset into one prompt
          setStatus('Analyzing asset (Gemini)…');
          const preR = await fetch('/api/asset-interact/pre-analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ activePath, assetPath: asset.path, presetPrompt: asset.presetVal || '', assetSize: asset.size || '' }),
          });
          const preD = await preR.json();
          if (!preD.success) throw new Error(preD.error);
          combinedPrompt = preD.combinedPrompt;
        }

        // Step 2: Generate with the combined prompt (active + asset images)
        setStatus(isTpdneLookbookMix ? 'Generating character in the selected lookbook…' : 'Generating with asset…');
        const genBody = { activePath, assetPath: asset.path, prompt: combinedPrompt, assetType: asset.assetType, imageEngine: getCharImageEngine() };
        const d = _glSid && window.GenLog
          ? await window.GenLog.fetchLog(_glSid, '🖼 Mix: lookbook + face', '/api/asset-interact/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(genBody) })
          : await fetch('/api/asset-interact/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(genBody) }).then(r => r.json());
        if (!d.success) throw new Error(d.error);

        lastGeneratedSeed = d.seed || null;
        const imagePath = await pollUntilDone(`/api/asset-interact/status/${d.taskId}`, isTpdneLookbookMix ? 'Lookbook on TPDNE' : 'Asset');
        generatedImagePath = imagePath;
        showFace(imagePath + '?t=' + Date.now());
        pushToHistory(imagePath);
        pushToGeni?.(imagePath, lastGeneratedSeed, getCurrentProjectId?.());
        showSaveChar(true);
        // Successful lookbook-mix output is a finished character → release the gate.
        if (isTpdneLookbookMix) setActiveImageOrigin('normal');
        saveAppState();
        updateCurrentProject?.(JSON.parse(localStorage.getItem('char_state_v1') || 'null'));
        setStatus('Done! Result in the active image.');
        window.GenLog?.finalize(_glSid, 'success');
      } catch (e) {
        window.GenLog?.finalize(_glSid, 'error');
        setStatus('Generation error: ' + e.message);
        assetErrMsg.textContent = e.message;
        assetErrWrap.style.display = 'block';
      } finally {
        genBtn.textContent = 'Generate';
        setLoading(false);
      }
    }

    genBtn.addEventListener('click', runAssetGen);
    assetRetry.addEventListener('click', runAssetGen);
    tdGen.appendChild(genBtn);
    tdGen.appendChild(assetErrWrap);

    // Col 10: ✕
    const tdDel = document.createElement('td');
    const delBtn = document.createElement('button');
    delBtn.className = 'adt-del-btn'; delBtn.textContent = '✕';
    delBtn.addEventListener('click', () => {
      saveRowValues();
      deactivateAsset(asset.path);
    });
    tdDel.appendChild(delBtn);

    tr.appendChild(tdOrder); tr.appendChild(tdImg);   tr.appendChild(tdAsset);
    tr.appendChild(tdSize);  tr.appendChild(tdExhon);
    tr.appendChild(tdPreset); tr.appendChild(tdCheck); tr.appendChild(tdGen); tr.appendChild(tdDel);
    assetDropTbody.appendChild(tr);
  });

  syncAssetDropZone();
}

// Toggle activate/deactivate an asset in the table
function activateAsset(path, thumbSrc, name, assetType, imgEl, size) {
  const existingIdx = activeAssets.findIndex(a => a.path === path);
  if (existingIdx !== -1) {
    // Already active → deactivate
    saveRowValues();
    activeAssets.splice(existingIdx, 1);
    if (imgEl) imgEl.classList.remove('asset-active');
    renderAssetTable();
    return;
  }
  if (activeAssets.length >= MAX_ASSETS) {
    setStatus(`Maximum ${MAX_ASSETS} active assets.`);
    return;
  }
  const savedVariants = getVariantsForPath(path);
  activeAssets.push({
    path, thumbSrc, name, assetType, size: size || '',
    nameVal: name || '', exhonVal: '', activnoeVal: '', presetVal: '',
    variants: savedVariants || [],
    _imgEl: imgEl,
  });
  if (imgEl) imgEl.classList.add('asset-active');
  renderAssetTable();
  saveAppState();
}

function deactivateAsset(path) {
  const idx = activeAssets.findIndex(a => a.path === path);
  if (idx === -1) return;
  const asset = activeAssets[idx];
  if (asset._imgEl) asset._imgEl.classList.remove('asset-active');
  activeAssets.splice(idx, 1);
  renderAssetTable();
  saveAppState();
}

// Show table only when character active AND assets exist
function syncAssetDropZone() {
  // D2: the bottom asset table is removed — replaced by the right-column
  // "Apply to image" 3-slot panel. Keep the zone hidden.
  if (assetDropZone) assetDropZone.style.display = 'none';
}

// Kept for drag-and-drop compatibility
function addAssetDropRow(imgPath, thumbSrc, defaultName, assetType) {
  activateAsset(imgPath, thumbSrc, defaultName, assetType, null);
}

// ── Thumb drag-to-apply removed ───────────────────────────────────────────────
// Assets are now applied ONLY via the right-column "Apply to image" cards
// (_applyAssetToActive). Kept as a no-op so existing callers stay safe; it
// explicitly clears draggability in case the browser defaults images to draggable.
function makeThumbDraggable(img /*, fullPath, thumbSrc, label, assetType */) {
  if (img) img.draggable = false;
}

// ── Global drag-over: intercept asset drags anywhere in the page ──────────────
// When character is active, any asset drag going over the window-body
// should show the table as drop target and NOT let default replace the face image.
const windowBody = document.querySelector('.window-body');
let  _globalDragActive = false;

function isAssetDrag(e) {
  return e.dataTransfer.types.includes('application/x-asset-path');
}
function hasActiveChar() {
  return !!(generatedImagePath || (currentFaceBlob && facePreview.style.display !== 'none'));
}

document.addEventListener('dragover', e => {
  if (!isAssetDrag(e) || !hasActiveChar()) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  _globalDragActive = true;
  assetDropZone?.classList.add('drag-over');
});
document.addEventListener('dragleave', e => {
  // Only clear highlight when leaving the document entirely
  if (e.relatedTarget === null) {
    assetDropZone?.classList.remove('drag-over');
    _globalDragActive = false;
  }
});
document.addEventListener('drop', e => {
  if (!isAssetDrag(e) || !hasActiveChar()) return;
  e.preventDefault();
  assetDropZone?.classList.remove('drag-over');
  _globalDragActive = false;
  const assetPath = e.dataTransfer.getData('application/x-asset-path');
  const thumbSrc  = e.dataTransfer.getData('application/x-asset-thumb');
  const label     = e.dataTransfer.getData('application/x-asset-label');
  const assetType = e.dataTransfer.getData('application/x-asset-type');
  addAssetDropRow(assetPath, thumbSrc, label, assetType);
});

// faceDropzone: BLOCK default image replacement when asset drag + char active
faceDropzone.addEventListener('dragover', e => {
  if (isAssetDrag(e) && hasActiveChar()) { e.preventDefault(); e.stopPropagation(); }
});
faceDropzone.addEventListener('drop', e => {
  if (isAssetDrag(e) && hasActiveChar()) { e.preventDefault(); e.stopPropagation(); /* handled by document drop */ }
});

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

// ── Образы compact row — Col 3 character tab ─────────────────────────────────
window.loadCharCol3Obrazy = function loadCharCol3Obrazy() {
  const row = document.getElementById('char-col3-obrazy-row');
  if (!row) return;

  let list = [];
  try { list = JSON.parse(localStorage.getItem('obrazy') || '[]'); } catch {}

  row.innerHTML = '';

  if (!list.length) {
    const span = document.createElement('span');
    span.id = 'char-col3-obrazy-empty';
    span.style.cssText = 'color:#888;font-size:11px;';
    span.textContent = 'No outfits';
    row.appendChild(span);
    return;
  }

  const voicesLoaded = (window.ELEVENLABS_VOICES || []).length > 0;

  list.forEach(obraz => {
    const card = document.createElement('div');
    card.className = 'char-col3-obraz-card';
    card.title = obraz.name || '';

    // Red flag when this look has no usable voice (mirrors "Project Looks" in
    // Scenarios): outline it red and make a click open the Edit popup so the
    // user can finish voice setup. Only once the voice catalog is loaded —
    // otherwise every look would briefly look orphaned.
    const orphan = voicesLoaded && (window.isOrphanVoiceRef ? window.isOrphanVoiceRef(obraz.voice) : !obraz.voice);
    if (orphan) {
      card.classList.add('char-col3-obraz-card-orphan');
      card.style.outline = '2px solid #c00';
      card.style.outlineOffset = '-2px';
      card.title = (obraz.name || '') + ' · NO VOICE — click to finish setup';
    }

    // Main image — earliest-mtime image inside the obraz folder (cached by
    // obrazy.js bootstrap from /api/obrazy/main-images). Falls back to obraz.char.
    const mainPath = window.pickMainObrazImage?.(obraz) || obraz.char;
    if (mainPath) {
      const img = document.createElement('img');
      img.src = toThumbPath(mainPath) + '?t=' + Date.now();
      img.className = 'char-col3-obraz-img';
      img.addEventListener('click', () => {
        if (orphan) window.openCharacterEditPopup?.(obraz.id);
        else openLightbox(mainPath);
      });
      card.appendChild(img);
    }

    // Name label
    const name = document.createElement('div');
    name.className = 'char-col3-obraz-name';
    name.textContent = obraz.name || '';
    card.appendChild(name);

    row.appendChild(card);
  });
}

// Re-render the Looks row when the voice catalog loads/changes, so the
// no-voice red flags resolve correctly (mirrors the registered <select>s).
window.addEventListener('el-voices-updated', () => window.loadCharCol3Obrazy?.());

// ── Init ──────────────────────────────────────────────────────────────────────
// Load custom dropdown options first (populates selects), then restore state
loadCustomOptions().then(() => {
  restoreAppState();        // restore after custom options are in the selects
}).catch(() => {
  restoreAppState();        // fallback: restore even if custom options fail
});
loadCharacterThumbs();
loadLookbookThumbs();
loadEnvironmentThumbs();
loadDetailThumbs();
loadCharCol3Obrazy();

// ── Param prompt edit popup ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function setupParamPromptModal() {
  const PARAM_FIXED = {
    param_age_instruction:     ['{age}'],
    param_gender_instruction:  ['{gender}'],
    param_pose_instruction:    ['{poseScene}'],
    param_emotion_instruction: ['{emotion}'],
  };
  const POSE_LIST = [
    { key: 'param_pose_scene_desk',     label: '1 — At desk' },
    { key: 'param_pose_scene_sofa',     label: '2 — On sofa' },
    { key: 'param_pose_scene_window',   label: '3 — By window' },
    { key: 'param_pose_scene_kitchen',  label: '4 — In kitchen' },
    { key: 'param_pose_scene_standing', label: '5 — Standing' },
  ];
  const EMOTION_LIST = [
    { key: 'emotion_neutral',    label: 'Neutral' },
    { key: 'emotion_smile',      label: 'Smile' },
    { key: 'emotion_joy',        label: 'Joy' },
    { key: 'emotion_laugh',      label: 'Laugh' },
    { key: 'emotion_surprise',   label: 'Surprise' },
    { key: 'emotion_sadness',    label: 'Sadness' },
    { key: 'emotion_serious',    label: 'Serious' },
    { key: 'emotion_thoughtful', label: 'Thoughtful' },
    { key: 'emotion_confident',  label: 'Confident' },
    { key: 'emotion_excitement', label: 'Excited' },
    { key: 'emotion_anger',      label: 'Angry' },
    { key: 'emotion_shy',        label: 'Shy' },
  ];

  const modal   = document.getElementById('param-prompt-modal');
  const titleEl = document.getElementById('param-prompt-modal-title');
  const bodyEl  = document.getElementById('param-prompt-modal-body');
  const footEl  = document.getElementById('param-prompt-modal-foot');
  if (!modal) return;

  function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function closeModal() { modal.classList.remove('open'); }

  async function saveBrainPrompt(key, text) {
    const r = await fetch(`/api/prompts/${encodeURIComponent(key)}/save`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const d = await r.json();
    if (!d.success) throw new Error(d.error || 'Save failed');
    _paramPrompts[key] = text;
  }

  async function renameBrainPrompt(key, label) {
    _itemLabels[key] = label;
    await fetch(`/api/prompts/${encodeURIComponent(key)}/rename`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label }),
    });
  }

  async function mergeInto(key, fixedPhrases, textEl, addEl, statusEl) {
    const currentText = textEl.value.trim();
    const additions   = addEl.value.trim();
    if (!currentText || !additions) { statusEl.textContent = 'Enter a prompt and additions.'; return; }
    statusEl.textContent = 'Processing…';
    try {
      const r = await fetch(`/api/prompts/${encodeURIComponent(key)}/merge`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentText, additions, fixedPhrases }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error || 'Merge failed');
      textEl.value = d.merged;
      statusEl.textContent = 'Done.';
    } catch (err) {
      statusEl.textContent = 'Error: ' + err.message;
    }
  }

  // ── Single-prompt view (Age, Gender) ─────────────────────────────────────────
  function openSingle(param) {
    const key = 'param_' + param + '_instruction';
    titleEl.textContent = param === 'age' ? 'Age ▶' : 'Gender ▶';
    bodyEl.innerHTML = `
      <label style="font-weight:bold;display:block;margin-bottom:4px;">System prompt:</label>
      <textarea id="ppm-text" rows="5" style="width:100%;font-size:11px;font-family:monospace;resize:vertical;border:1px solid #ccc;padding:5px;box-sizing:border-box;border-radius:3px;">${esc(_paramPrompts[key] || '')}</textarea>
      <div style="margin-top:10px;">
        <label style="font-weight:bold;display:block;margin-bottom:4px;">Additions for AI embedding:</label>
        <textarea id="ppm-add" rows="3" style="width:100%;font-size:11px;font-family:monospace;resize:vertical;border:1px solid #ccc;background:#f9f9ff;padding:5px;box-sizing:border-box;border-radius:3px;" placeholder="Enter additions — the AI will weave them into the prompt..."></textarea>
      </div>
      <div style="margin-top:8px;display:flex;align-items:center;gap:8px;">
        <button id="ppm-merge" style="font-size:11px;padding:3px 12px;">AI Merge</button>
        <span id="ppm-status" style="font-size:10px;color:#666;"></span>
      </div>`;
    footEl.innerHTML = `
      <div style="flex:1"></div>
      <button id="ppm-save" style="font-size:11px;padding:3px 16px;">Save</button>
      <button id="ppm-cancel" style="font-size:11px;padding:3px 16px;">Cancel</button>`;

    const textEl   = document.getElementById('ppm-text');
    const addEl    = document.getElementById('ppm-add');
    const statusEl = document.getElementById('ppm-status');

    document.getElementById('ppm-merge').addEventListener('click', () =>
      mergeInto(key, PARAM_FIXED[key] || [], textEl, addEl, statusEl));
    document.getElementById('ppm-save').addEventListener('click', async () => {
      const text = textEl.value.trim(); if (!text) return;
      const btn = document.getElementById('ppm-save'); btn.disabled = true;
      try { await saveBrainPrompt(key, text); closeModal(); setStatus?.('Prompt saved to Brain.'); }
      catch (err) { statusEl.textContent = 'Error: ' + err.message; }
      finally { btn.disabled = false; }
    });
    document.getElementById('ppm-cancel').addEventListener('click', closeModal);
    modal.classList.add('open');
  }

  // Maps prompt key → { selId, optVal } for syncing with <select> elements
  function keyToSelectInfo(k) {
    if (k.startsWith('param_pose_scene_')) {
      const suffix = k.replace('param_pose_scene_', '');
      return { selId: 'pose', optVal: 'pose_' + suffix };
    }
    if (k.startsWith('emotion_')) {
      return { selId: 'emotion', optVal: k.replace('emotion_', '') };
    }
    return null;
  }

  // ── One list item element ─────────────────────────────────────────────────────
  function makeListItemEl(key, defaultLabel) {
    const label = _itemLabels[key] || defaultLabel;
    const div = document.createElement('div');
    div.className = 'ppm-list-item';
    div.dataset.key = key;
    div.innerHTML = `
      <div class="ppm-list-name-row">
        <input class="ppm-list-name-input" value="${esc(label)}" title="Click to rename">
      </div>
      <textarea class="ppm-list-text" rows="3">${esc(_paramPrompts[key] || '')}</textarea>
      <div class="ppm-list-row">
        <textarea class="ppm-list-add" rows="2" placeholder="Additions for AI embedding..."></textarea>
        <div class="ppm-list-actions">
          <button class="ppm-list-merge" style="font-size:10px;padding:2px 8px;">AI Merge</button>
          <button class="ppm-list-save"  style="font-size:10px;padding:2px 8px;">Save</button>
          <button class="ppm-list-del"   style="font-size:10px;padding:2px 8px;background:#ffe0e0;border:1px solid #c88;color:#800;border-radius:2px;">Del</button>
          <span class="ppm-list-status"></span>
        </div>
      </div>`;

    const nameInput = div.querySelector('.ppm-list-name-input');
    const textEl    = div.querySelector('.ppm-list-text');
    const addEl     = div.querySelector('.ppm-list-add');
    const statusEl  = div.querySelector('.ppm-list-status');
    const mergeBtn  = div.querySelector('.ppm-list-merge');
    const saveBtn   = div.querySelector('.ppm-list-save');
    const delBtn    = div.querySelector('.ppm-list-del');

    nameInput.addEventListener('blur', async () => {
      const newLabel = nameInput.value.trim();
      if (!newLabel || newLabel === (_itemLabels[key] || defaultLabel)) return;
      try {
        await renameBrainPrompt(key, newLabel);
        const info = keyToSelectInfo(key);
        if (info) {
          const opt = document.getElementById(info.selId)?.querySelector(`option[value="${info.optVal}"]`);
          if (opt) opt.textContent = newLabel;
        }
      } catch {}
    });

    mergeBtn.addEventListener('click', async () => {
      mergeBtn.disabled = true;
      await mergeInto(key, [], textEl, addEl, statusEl);
      mergeBtn.disabled = false;
    });
    saveBtn.addEventListener('click', async () => {
      const text = textEl.value.trim(); if (!text) return;
      saveBtn.disabled = true;
      try {
        await saveBrainPrompt(key, text);
        statusEl.textContent = 'Saved.';
        setTimeout(() => { statusEl.textContent = ''; }, 2000);
      } catch (err) { statusEl.textContent = 'Error: ' + err.message; }
      finally { saveBtn.disabled = false; }
    });
    let _delConfirming = false;
    delBtn.addEventListener('click', async () => {
      if (!_delConfirming) {
        _delConfirming = true;
        delBtn.textContent = 'Sure?';
        delBtn.style.background = '#f44';
        delBtn.style.color = '#fff';
        delBtn.style.borderColor = '#c00';
        setTimeout(() => {
          if (_delConfirming) {
            _delConfirming = false;
            delBtn.textContent = 'Del';
            delBtn.style.background = '#ffe0e0';
            delBtn.style.color = '#800';
            delBtn.style.borderColor = '#c88';
          }
        }, 2500);
        return;
      }
      _delConfirming = false;
      delBtn.disabled = true;
      try {
        const isCustom = key.includes('_custom_');
        const url    = isCustom
          ? `/api/prompts/dynamic/${encodeURIComponent(key)}`
          : `/api/prompts/${encodeURIComponent(key)}/hide`;
        const method = isCustom ? 'DELETE' : 'POST';
        const r = await fetch(url, { method });
        const d = await r.json();
        if (!d.success) throw new Error(d.error || 'Failed');
        if (isCustom) {
          delete _paramPrompts[key];
          delete _itemLabels[key];
        }
        _hiddenKeys.add(key);
        const info = keyToSelectInfo(key);
        if (info) {
          document.getElementById(info.selId)
            ?.querySelector(`option[value="${info.optVal}"]`)
            ?.remove();
        }
        div.remove();
      } catch (err) {
        statusEl.textContent = 'Error: ' + err.message;
        delBtn.disabled = false;
      }
    });

    return div;
  }

  // ── "Create new" section (collapsible, top of list popup) ───────────────────
  function makeNewSection(param, listContainerEl) {
    const isEmotion = param === 'emotion';
    const placeholder = isEmotion
      ? 'Describe the emotion freely…'
      : 'Describe the pose freely…';
    const namePlaceholder = isEmotion ? 'Excited smile' : 'Sitting on floor';
    const toggleLabel = isEmotion ? '＋ Add emotion' : '＋ Add pose';

    const section = document.createElement('div');
    section.style.cssText = 'margin-bottom:10px;';

    const toggleBtn = document.createElement('button');
    toggleBtn.textContent = toggleLabel;
    toggleBtn.style.cssText = 'width:100%;text-align:left;font-size:11px;font-weight:bold;padding:5px 10px;background:#e8e8f8;border:1px solid #aab;border-radius:4px;cursor:pointer;color:#335;';

    const form = document.createElement('div');
    form.style.cssText = 'display:none;background:#f0f0ff;border:1px solid #aab;border-top:none;border-radius:0 0 5px 5px;padding:10px;';
    form.innerHTML = `
      <label style="font-size:10px;display:block;margin-bottom:2px;">Description:</label>
      <textarea id="ppm-new-desc" rows="2" style="width:100%;font-size:11px;font-family:monospace;resize:vertical;border:1px solid #ccc;padding:4px;box-sizing:border-box;border-radius:3px;" placeholder="${esc(placeholder)}"></textarea>
      <div style="display:flex;align-items:center;gap:6px;margin-top:5px;">
        <button id="ppm-beautify-btn" style="font-size:11px;padding:3px 12px;">Beautify</button>
        <span id="ppm-beautify-status" style="font-size:10px;color:#666;"></span>
      </div>
      <label style="font-size:10px;display:block;margin-top:8px;margin-bottom:2px;">Result:</label>
      <textarea id="ppm-new-result" rows="3" style="width:100%;font-size:11px;font-family:monospace;resize:vertical;border:1px solid #ccc;padding:4px;box-sizing:border-box;border-radius:3px;" placeholder="The improved prompt will appear here…"></textarea>
      <div style="display:flex;align-items:center;gap:6px;margin-top:7px;">
        <label style="font-size:10px;flex-shrink:0;">Name:</label>
        <input id="ppm-new-name" type="text" style="flex:1;font-size:11px;padding:3px;border:1px solid #ccc;border-radius:3px;" placeholder="${esc(namePlaceholder)}">
        <button id="ppm-add-btn" style="font-size:11px;padding:3px 12px;background:#d4f0d4;border:1px solid #888;border-radius:3px;">Add ▼</button>
      </div>`;

    toggleBtn.addEventListener('click', () => {
      const open = form.style.display !== 'none';
      form.style.display = open ? 'none' : 'block';
      toggleBtn.style.borderRadius = open ? '4px' : '4px 4px 0 0';
      toggleBtn.textContent = open ? toggleLabel : '✕ Close';
    });

    section.appendChild(toggleBtn);
    section.appendChild(form);

    const descEl   = form.querySelector('#ppm-new-desc');
    const resultEl = form.querySelector('#ppm-new-result');
    const nameEl   = form.querySelector('#ppm-new-name');
    const statusEl = form.querySelector('#ppm-beautify-status');
    const beatBtn  = form.querySelector('#ppm-beautify-btn');
    const addBtn   = form.querySelector('#ppm-add-btn');

    beatBtn.addEventListener('click', async () => {
      const text = descEl.value.trim();
      if (!text) { statusEl.textContent = 'Enter a description.'; return; }
      beatBtn.disabled = true; statusEl.textContent = 'Processing…';
      try {
        const r = await fetch('/api/prompts/beautify', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, type: param }),
        });
        const d = await r.json();
        if (!d.success) throw new Error(d.error || 'Beautify failed');
        resultEl.value = d.beautified;
        statusEl.textContent = 'Done.';
      } catch (err) { statusEl.textContent = 'Error: ' + err.message; }
      finally { beatBtn.disabled = false; }
    });

    addBtn.addEventListener('click', async () => {
      const promptText = resultEl.value.trim() || descEl.value.trim();
      const label = nameEl.value.trim();
      if (!promptText) { statusEl.textContent = 'No prompt to add.'; return; }
      if (!label)      { statusEl.textContent = 'Enter a name.'; return; }

      const ts     = Date.now();
      const key    = isEmotion ? `emotion_custom_${ts}` : `param_pose_scene_custom_${ts}`;
      const optVal = isEmotion ? `custom_${ts}` : `pose_custom_${ts}`;

      addBtn.disabled = true;
      try {
        const r = await fetch('/api/prompts/dynamic/save', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key, text: promptText, label }),
        });
        const d = await r.json();
        if (!d.success) throw new Error(d.error || 'Save failed');
        _paramPrompts[key] = promptText;
        _itemLabels[key]   = label;

        // Add to dropdown after first option (Random/Neutral stays on top)
        const sel = document.getElementById(param);
        if (sel) {
          const opt = document.createElement('option');
          opt.value = optVal; opt.textContent = label;
          sel.insertBefore(opt, sel.options[1] || null);
        }

        // Prepend to list
        listContainerEl.prepend(makeListItemEl(key, label));

        descEl.value = ''; resultEl.value = ''; nameEl.value = '';
        statusEl.textContent = 'Added.';
        setTimeout(() => { statusEl.textContent = ''; }, 2500);
      } catch (err) { statusEl.textContent = 'Error: ' + err.message; }
      finally { addBtn.disabled = false; }
    });

    return section;
  }

  // ── List view (Pose, Emotion) ─────────────────────────────────────────────────
  function openList(param) {
    const defaultList = param === 'pose' ? POSE_LIST : EMOTION_LIST;
    titleEl.textContent = param === 'pose' ? 'Pose ▶ — all poses' : 'Emotion ▶ — all emotions';
    bodyEl.innerHTML = '';

    const listContainer = document.createElement('div');
    listContainer.id = 'ppm-list-container';

    // One flat list: defaults first (skip hidden), then customs
    const customPrefix = param === 'pose' ? 'param_pose_scene_custom_' : 'emotion_custom_';
    defaultList.forEach(item => {
      if (_hiddenKeys.has(item.key)) return;
      listContainer.appendChild(makeListItemEl(item.key, item.label));
    });
    Object.keys(_paramPrompts)
      .filter(k => k.startsWith(customPrefix))
      .forEach(k => listContainer.appendChild(makeListItemEl(k, _itemLabels[k] || k)));

    bodyEl.appendChild(makeNewSection(param, listContainer));
    bodyEl.appendChild(listContainer);

    footEl.innerHTML = `
      <div style="flex:1"></div>
      <button id="ppm-cancel" style="font-size:11px;padding:3px 16px;">Close</button>`;
    document.getElementById('ppm-cancel').addEventListener('click', closeModal);
    modal.classList.add('open');
  }

  document.querySelectorAll('label[data-param]').forEach(lbl => {
    lbl.addEventListener('click', e => {
      e.preventDefault();
      const param = lbl.dataset.param;
      if (param === 'pose' || param === 'emotion') openList(param);
      else openSingle(param);
    });
  });

  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
});

// Show the persistent assets panel on the initially-active Character tab (C2).
setTimeout(() => { try { syncAssetDropZone(); } catch {} }, 0);

// ── D4: Looks & Env popup — 3 columns (lookbooks | generator | environments) ──
(function setupLooksEnv() {
  const modal = document.getElementById('looks-env-modal');
  if (!modal) return;
  const KEY = 'looks_env_engine_v1';
  window.getLooksEnvEngine = () => { try { return localStorage.getItem(KEY) || 'nano-banana-2'; } catch { return 'nano-banana-2'; } };
  const eng = document.getElementById('le-engine');
  if (eng) { eng.value = window.getLooksEnvEngine(); eng.addEventListener('change', () => { try { localStorage.setItem(KEY, eng.value); } catch {} }); }

  // open / close
  document.getElementById('btn-looks-env')?.addEventListener('click', () => { modal.classList.add('open'); _leLoadGrids(); });
  document.getElementById('le-close')?.addEventListener('click', () => modal.classList.remove('open'));
  modal.addEventListener('mousedown', e => { if (e.target === modal) modal.classList.remove('open'); });

  // ── middle column: dropzone + generate ──
  let _leBlob = null;
  const dz = document.getElementById('le-dropzone'), input = document.getElementById('le-input'),
        prev = document.getElementById('le-preview'), ph = document.getElementById('le-ph'), del = document.getElementById('le-del');
  function showPrev(src) { if (prev) { prev.src = src; prev.style.display = ''; } if (ph) ph.style.display = 'none'; if (del) del.style.display = ''; }
  function clearPrev() { if (prev) { prev.src = ''; prev.style.display = 'none'; } if (ph) ph.style.display = ''; if (del) del.style.display = 'none'; if (input) input.value = ''; _leBlob = null; }
  dz?.addEventListener('click', () => { if (!_leBlob) input?.click(); });
  input?.addEventListener('change', () => { const f = input.files[0]; if (!f) return; _leBlob = f; showPrev(URL.createObjectURL(f)); });
  dz?.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag'); });
  dz?.addEventListener('dragleave', () => dz.classList.remove('drag'));
  dz?.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('drag'); const f = e.dataTransfer.files[0]; if (f && f.type.startsWith('image/')) { _leBlob = f; showPrev(URL.createObjectURL(f)); } });
  del?.addEventListener('click', e => { e.stopPropagation(); clearPrev(); });

  const genBtns = ['le-gen-lookbook', 'le-gen-both', 'le-gen-env'].map(id => document.getElementById(id)).filter(Boolean);
  async function _lePoll(url) {
    for (let i = 0; i < 180; i++) {
      await new Promise(r => setTimeout(r, 2000));
      let d; try { d = await (await fetch(url)).json(); } catch { continue; }
      if (d && d.state === 'success') return true;
      if (d && d.state === 'failed') throw new Error('generation failed');
    }
    throw new Error('timeout');
  }
  async function gen(mode) {
    if (!_leBlob) { setStatus('Upload an image first.'); return; }
    genBtns.forEach(b => b.disabled = true);
    setStatus(mode === 'lookbook' ? 'Extracting lookbook…' : mode === 'environment' ? 'Extracting environment…' : 'Extracting lookbook + environment…');
    try {
      const base64 = await blobToBase64(_leBlob);
      const r = await fetch('/api/lookbook/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageBase64: base64, mode, imageEngine: window.getLooksEnvEngine() }) });
      const d = await r.json(); if (!d.success) throw new Error(d.error);
      const tasks = [];
      if (d.clothingTaskId) tasks.push(_lePoll('/api/lookbook/status/' + d.clothingTaskId));
      if (d.bgTaskId)       tasks.push(_lePoll('/api/environment/status/' + d.bgTaskId));
      await Promise.all(tasks);
      setStatus('✓ Saved to library'); _leLoadGrids();
    } catch (e) { setStatus('✗ ' + (e.message || e)); }
    finally { genBtns.forEach(b => b.disabled = false); }
  }
  document.getElementById('le-gen-lookbook')?.addEventListener('click', () => gen('lookbook'));
  document.getElementById('le-gen-both')?.addEventListener('click', () => gen('both'));
  document.getElementById('le-gen-env')?.addEventListener('click', () => gen('environment'));

  // ── side columns: libraries + lightbox ──
  function _leLoadGrids() {
    _leFillGrid('le-lb-grid', '/api/lookbooks', 'lookbook');
    _leFillGrid('le-env-grid', '/api/environments', 'environment');
  }
  async function _leFillGrid(gridId, url, kind) {
    const grid = document.getElementById(gridId); if (!grid) return;
    let files = []; try { const d = await (await fetch(url)).json(); files = (d && d.files) || []; } catch {}
    grid.innerHTML = '';
    if (!files.length) { const e = document.createElement('div'); e.className = 'le-empty'; e.textContent = 'Empty'; grid.appendChild(e); return; }
    files.forEach((item, idx) => {
      const img = document.createElement('img'); img.src = item.thumbPath || item.path; img.title = item.name || '';
      img.addEventListener('click', () => _leLightbox(files, idx, gridId, url));
      grid.appendChild(img);
    });
  }
  // Fullscreen viewer with ‹/›, Esc/backdrop close, and delete-from-library.
  function _leLightbox(files, start, gridId, gridUrl) {
    let pos = start;
    const ov = document.createElement('div'); ov.id = 'le-lightbox';
    const box = document.createElement('div'); box.style.cssText = 'display:flex;flex-direction:column;align-items:center;';
    const prevB = document.createElement('button'); prevB.className = 'lb-nav'; prevB.textContent = '‹';
    const nextB = document.createElement('button'); nextB.className = 'lb-nav'; nextB.textContent = '›';
    const frame = document.createElement('div'); frame.className = 'lb-frame'; const big = document.createElement('img'); frame.appendChild(big);
    const rowEl = document.createElement('div'); rowEl.className = 'lb-row'; rowEl.appendChild(prevB); rowEl.appendChild(frame); rowEl.appendChild(nextB);
    const cap = document.createElement('div'); cap.style.cssText = 'color:#ddd;font-size:12px;margin-top:6px;';
    const bar = document.createElement('div'); bar.className = 'lb-bar';
    const delB = document.createElement('button'); delB.textContent = '🗑 Delete';
    const clB = document.createElement('button'); clB.textContent = 'Close';
    bar.appendChild(delB); bar.appendChild(clB);
    function render() { const it = files[pos]; if (!it) { close(); return; } big.src = it.path || it.thumbPath; cap.textContent = (it.name || '') + '  ·  ' + (pos + 1) + '/' + files.length; }
    function go(d) { if (files.length) { pos = (pos + d + files.length) % files.length; render(); } }
    function close() { ov.remove(); document.removeEventListener('keydown', key, true); }
    function key(e) { if (e.key === 'Escape') { e.preventDefault(); close(); } else if (e.key === 'ArrowLeft') { go(-1); } else if (e.key === 'ArrowRight') { go(1); } }
    prevB.addEventListener('click', () => go(-1));
    nextB.addEventListener('click', () => go(1));
    clB.addEventListener('click', close);
    delB.addEventListener('click', async () => {
      const it = files[pos]; if (!it) return;
      delB.disabled = true;
      try {
        await fetch('/api/gallery/archive', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filePath: it.path }) });
        files.splice(pos, 1);
        setStatus('Moved to archive.');
        _leFillGrid(gridId, gridUrl, '');
        if (!files.length) { close(); return; }
        if (pos >= files.length) pos = files.length - 1;
        render();
      } catch (e) { setStatus('Error: ' + e.message); }
      finally { delB.disabled = false; }
    });
    ov.addEventListener('mousedown', e => { if (e.target === ov) close(); });
    document.addEventListener('keydown', key, true);
    box.appendChild(rowEl); box.appendChild(cap); box.appendChild(bar); ov.appendChild(box); document.body.appendChild(ov);
    render();
  }
})();
