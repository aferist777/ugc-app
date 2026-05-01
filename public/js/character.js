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
const btnSavePersaLeft  = document.getElementById('btn-save-persa-left');
const btnSavePersaCol2  = document.getElementById('btn-save-persa-col2');

function showSaveChar(v) {
  const d = v ? 'inline-block' : 'none';
  btnSaveChar.style.display     = d;
  const col2wrap = document.getElementById('btn-save-obraz-col2-wrap');
  if (col2wrap) col2wrap.style.display = v ? '' : 'none';
}
const genderSelect    = document.getElementById('gender');
const poseSelect      = document.getElementById('pose');
const emotionSelect   = document.getElementById('emotion');
const typeSelect      = document.getElementById('char-type');
const charEngineSelect = document.getElementById('char-image-engine');
const btnGenerate     = document.getElementById('btn-generate');
const btnSaveChar     = document.getElementById('btn-save-char');
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

let currentFaceBlob    = null;
let generatedImagePath = null;
let selectedLbPath     = null;
let selectedEnvPath    = null;
let lastGeneratedSeed  = null;  // seed from most recent generation

// ── Generation history ────────────────────────────────────────────────────────
let generationHistory = [];  // array of image paths
let historyIndex = -1;

function pushToHistory(imagePath) {
  if (!imagePath) return;
  // Never truncate — branched generation from any history position appends to the end,
  // keeping the original forward path still navigable.
  if (generationHistory[generationHistory.length - 1] !== imagePath) {
    generationHistory.push(imagePath);
  }
  historyIndex = generationHistory.length - 1;
  renderHistoryNav();
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

function saveAppState() {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify({
      generatedImagePath,
      generationHistory,
      historyIndex,
      lastGeneratedSeed,
      nameInputValue:  nameInput?.value  || '',
      genderValue:     genderSelect?.value  || 'female',
      poseValue:       poseSelect?.value    || 'random',
      emotionValue:    emotionSelect?.value || 'neutral',
      charTypeValue:   typeSelect?.value    || 'character',
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
  'btn-refine', 'btn-generate',
  'btn-save-char', 'btn-save-persa-left', 'btn-save-obraz-left',
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
  if (origin === 'tpdne')       setStatus('👉 Сначала выберите лукбук в правой колонке и нажмите Generate');
  else if (origin === 'upload') setStatus('👉 Сначала нажмите TEMPO для обработки загруженного изображения');
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
  if (typeSelect    && state.charTypeValue) {
    typeSelect.value = state.charTypeValue;
    applyTypeMode?.(state.charTypeValue);
  }

  if (state.generationHistory?.length) {
    generationHistory = state.generationHistory;
    historyIndex = state.historyIndex ?? generationHistory.length - 1;
  }
  if (state.lastGeneratedSeed != null) lastGeneratedSeed = state.lastGeneratedSeed;

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
function showFace(src, fromCharThumb) {
  facePreview.onerror = null;
  facePreview.src = src;
  facePreview.style.display = 'block';
  facePlaceholder.style.display = 'none';
  btnDeleteFace.style.display = 'inline-block';
  if (btnObrinj) btnObrinj.style.display = fromCharThumb ? 'inline-block' : 'none';
  syncAssetDropZone?.();
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
  refineExtra.value  = '';
  showSaveChar(false);
  faceDropzone.classList.remove('fullbody');
  setActiveImageOrigin(null);
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
if (btnTempo) {
  btnTempo.addEventListener('click', async () => {
    const blobToAnalyze = currentFaceBlob || tempoOriginalBlob;
    if (!blobToAnalyze) return;

    btnTempo.disabled = true;
    setLoading(true);

    const isFirstRun = (tempoRefId === null);

    try {
      let generationPrompt;

      if (isFirstRun) {
        // ── First run: save + analyze ────────────────────────────────────────────
        setStatus('Tempo: analyzing image (Gemini)…');
        const imageBase64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload  = e => resolve(e.target.result.split(',')[1]);
          reader.onerror = reject;
          reader.readAsDataURL(blobToAnalyze);
        });
        const withRealism = document.getElementById('chk-realism')?.checked || false;
        const markerGroups = window.getCategorizedRealismMarkers?.() || {};
        const saveRes  = await fetch('/api/refs/save', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageBase64, withRealism, markerGroups, category: 'character' }),
        });
        const saveData = await saveRes.json();
        if (!saveData.success) throw new Error(saveData.error);

        tempoOriginalBlob = blobToAnalyze;
        tempoRefId        = saveData.entry.id;
        tempoPrompt       = saveData.entry.generationPrompt;
        generationPrompt  = tempoPrompt;
        setStatus(`Tempo: "${saveData.entry.title}" — launching generation…`);
      } else {
        // ── Repeat run: reuse saved prompt, no analysis ──────────────────────────
        generationPrompt = tempoPrompt;
        setStatus('Tempo: using saved prompt — launching generation…');
      }

      if (!generationPrompt) throw new Error('Prompt not found — try uploading the photo again');

      // ── Launch generation — char tab engine takes priority over Мозги ───────
      const _engine = getCharImageEngine();
      const genRes  = await fetch('/api/refs/tempo-generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refId: tempoRefId, generationPrompt, forceEngine: _engine, engineParams: getEngineParams?.(_engine) || {} }),
      });
      const genData = await genRes.json();
      if (!genData.success) throw new Error(genData.error);

      setStatus(`Tempo: generating (${genData.engine})…`);

      // ── Poll until done ──────────────────────────────────────────────────────
      const imagePath = await new Promise((resolve, reject) => {
        const iv = setInterval(async () => {
          try {
            const sr = await fetch(`/api/refs/gen-status/${genData.taskId}`);
            const sd = await sr.json();
            if (!sd.success) { clearInterval(iv); reject(new Error(sd.error)); return; }
            if (sd.state === 'success')  { clearInterval(iv); resolve(sd.imagePath); }
            else if (sd.state === 'failed') { clearInterval(iv); reject(new Error(sd.error || 'Error')); }
            else { setStatus(`Tempo: generating… (${sd.state})`); }
          } catch (e) { clearInterval(iv); reject(e); }
        }, 3000);
      });

      // ── Show in active image ─────────────────────────────────────────────────
      generatedImagePath = imagePath;
      currentFaceBlob    = null;
      lastGeneratedSeed  = genData.seed || null;
      showFace(imagePath + '?t=' + Date.now());
      pushToHistory(imagePath);
      showSaveChar(true);
      // Successful TEMPO output is a finished character → release the upload-gate.
      setActiveImageOrigin('normal');
      saveAppState();

      // Link generated image to original ref entry
      await fetch(`/api/refs/${tempoRefId}/add-generation`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imagePath, seed: genData.seed }),
      });

      setStatus(`Tempo: done. Engine: ${genData.engine}. Click again for a new generation.`);
    } catch (e) {
      setStatus('Tempo: error — ' + e.message);
    } finally {
      btnTempo.disabled = false;
      setLoading(false);
    }
  });
}

// ── Generation helpers ────────────────────────────────────────────────────────
// Locks every "regular" generation entry point on the Character tab while one is running.
// Lookbook+Environment (#btn-obrinj) is intentionally excluded — fully independent in both directions.
function setLoading(active) {
  btnGenerate.disabled   = active;
  btnRefine.disabled     = active;
  btnRandomFace.disabled = active;
  faceDropzone.style.pointerEvents = active ? 'none' : '';
  faceDropzone.classList.toggle('generating', active);
  ['btn-gen-age', 'btn-gen-gender', 'btn-gen-pose', 'btn-gen-emotion', 'btn-tempo'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = active;
  });
  document.querySelectorAll('.adt-check-btn, .adt-gen-btn').forEach(el => {
    el.disabled = active;
  });
  // After releasing the loading lock, re-apply the gate so gate-disabled
  // buttons don't get re-enabled by setLoading(false).
  if (!active) applyDraftGate?.();
}

function pollUntilDone(statusEndpoint, label) {
  const trackId = `char_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const actRow  = startActiveGen?.(trackId, label || 'Generation');
  return new Promise((resolve, reject) => {
    const iv = setInterval(async () => {
      try {
        const r = await fetch(statusEndpoint);
        const d = await r.json();
        if (!d.success) {
          clearInterval(iv);
          actRow?.finalize?.('❌ ' + (d.error || 'Error'));
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
          finishActiveGen?.(trackId);
          logError(label || 'Generation', d.error || 'Task failed with an error');
          reject(new Error(d.error || 'Error'));
        } else { setStatus(`Generating… (${d.state})`); }
      } catch (e) {
        clearInterval(iv);
        actRow?.finalize?.('❌ ' + e.message);
        finishActiveGen?.(trackId);
        logError(label || 'Generation', e.message);
        reject(e);
      }
    }, 3000);
  });
}

// Last action saved for inline retry
let _lastGenFn = null;

function _showGenError(msg, retryFn) {
  const wrap = document.getElementById('gen-error-wrap');
  const msgEl = document.getElementById('gen-error-msg');
  if (!wrap || !msgEl) { setStatus('Error: ' + msg); return; }
  msgEl.textContent = msg;
  wrap.style.display = 'block';
  if (retryFn) _lastGenFn = retryFn;
}
function _hideGenError() {
  const wrap = document.getElementById('gen-error-wrap');
  if (wrap) wrap.style.display = 'none';
}

async function runGeneration(payload, statusMsg, opts = {}) {
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
      _withRealism = document.getElementById('chk-realism')?.checked || false;
    }
    const _reqBody = { ...payload, imageEngine: _engine, withRealism: _withRealism, enabledMarkers: _enabledMarkers };
    if (opts.skipTranslate) _reqBody.skipTranslate = true;
    const d = _sid && window.GenLog
      ? await window.GenLog.fetchLog(_sid, '🖼 Генерация персонажа', '/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(_reqBody) })
      : await fetch('/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(_reqBody) }).then(r => r.json());
    if (!d.success) throw new Error(d.error);

    lastGeneratedSeed = d.seed || null;
    setStatus(d.skinTraits?.length ? `Skin: ${d.skinTraits.join(', ')}. Generating…` : 'Generating…');
    const imagePath = await pollUntilDone(`/api/status/${d.taskId}`, payload.extraInstruction ? 'Refinement' : 'Generation');

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
    playCompletionSound?.();
    logGeneration(payload.extraInstruction ? 'Refinement' : 'Generation', location.origin + imagePath, balBefore);
    window.GenLog?.finalize(_sid, 'success');
  } catch (err) {
    window.GenLog?.finalize(_sid, 'error');
    setStatus('Error: ' + err.message);
    playCompletionSound?.();
    _showGenError(err.message, () => runGeneration(payload, statusMsg));
  } finally {
    setLoading(false);
  }
}

// Wire up retry button once DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('gen-retry-btn')?.addEventListener('click', () => {
    if (_lastGenFn) _lastGenFn();
  });
});

// ── Scene mode: analyse + generate ───────────────────────────────────────────
let pendingSceneData = null; // stores analysis result until generation completes

async function runSceneAnalysis() {
  if (!currentFaceBlob) { setStatus('Upload a scene image.'); return; }
  _hideGenError();
  setLoading(true);
  setStatus('Analyzing scene (Gemini 3.1 Pro)…');
  const balBefore = currentCredits;
  try {
    const imageBase64 = await blobToBase64(currentFaceBlob);
    const r = await fetch('/api/scene/analyze', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64, imageEngine: getCharImageEngine() }),
    });
    const d = await r.json();
    if (!d.success) throw new Error(d.error);

    pendingSceneData = {
      originalPath:     d.originalPath,
      title:            d.title,
      generationPrompt: d.generationPrompt,
      actors:           d.actors,
      description:      d.description,
    };

    // Set scene title in name field
    if (d.title) nameInput.value = d.title;

    setStatus('Analysis ready. Generating image (2K)…');

    const imagePath = await pollUntilDone(`/api/scene/status/${d.taskId}`, 'Scene');

    pendingSceneData.generatedPath = imagePath;
    generatedImagePath = imagePath;
    pushToHistory(imagePath);

    // Show result panel (table) below buttons in center column
    const panel    = document.getElementById('scene-result-panel');
    const resultImg = document.getElementById('scene-result-img');
    const resultDesc = document.getElementById('scene-result-desc');

    resultImg.src = toThumbPath(imagePath) + '?t=' + Date.now();
    resultImg.addEventListener('click', () => openLightbox(imagePath), { once: true });

    const descParts = [];
    if (d.description) descParts.push(d.description);
    if (d.actors && d.actors !== 'No people present.')
      descParts.push('Characters: ' + d.actors);
    resultDesc.textContent = descParts.join('\n\n') || '—';

    panel.style.display = 'block';

    // Hide char-specific buttons, show save-scene
    btnSaveChar.style.display   = 'none';
    document.getElementById('btn-save-scene').style.display = 'inline-block';

    setStatus('Scene ready!');
    logGeneration('Scene', location.origin + imagePath, balBefore);
  } catch (err) {
    setStatus('Error: ' + err.message);
    _showGenError(err.message, () => runSceneAnalysis());
  } finally {
    setLoading(false);
  }
}

// ── Generate & Refine ─────────────────────────────────────────────────────────
btnGenerate.addEventListener('click', async () => {
  if (typeSelect?.value === 'scene') { runSceneAnalysis(); return; }

  // Resolve pose
  let poseKey = poseSelect?.value || 'random';
  let customPosePrompt = '';
  if (isCustomValue?.(poseKey)) {
    customPosePrompt = resolveCustomSelectValue?.(poseKey) || '';
    poseKey = null;
  } else if (poseKey === 'random') {
    poseKey = POSE_KEYS[Math.floor(Math.random() * POSE_KEYS.length)];
    if (poseSelect) poseSelect.value = poseKey;
  }

  // Resolve emotion
  let emotion = emotionSelect?.value || 'neutral';
  let customEmotionPrompt = '';
  if (isCustomValue?.(emotion)) {
    customEmotionPrompt = resolveCustomSelectValue?.(emotion) || '';
    emotion = null;
  }

  // Resolve age (custom option's "prompt" is the age value string)
  let age = document.getElementById('age').value;
  if (isCustomValue?.(age)) age = resolveCustomSelectValue?.(age) || age;

  // Resolve gender (custom option's "prompt" is the gender value string)
  let gender = document.getElementById('gender').value;
  if (isCustomValue?.(gender)) gender = resolveCustomSelectValue?.(gender) || gender;

  const genPayload = { age, gender, poseKey, emotion, customPosePrompt, customEmotionPrompt };

  // Apply to active image (from any source: char thumb, URL, paste, previous gen)
  if (generatedImagePath && !currentFaceBlob) {
    runGeneration(
      { ...genPayload, imagePath: generatedImagePath },
      'Applying parameters to active image…'
    );
    return;
  }

  // Fresh generation from face blob
  if (currentFaceBlob) {
    const faceBase64 = await blobToBase64(currentFaceBlob);
    runGeneration(
      { ...genPayload, faceBase64 },
      'Analyzing face (Gemini)…'
    );
    return;
  }

  setStatus('Upload or select an image.');
});

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
    setStatus('Анализирую персонажа…');
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
    setStatus('Анализирую персонажа…');
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

// ── Save character ────────────────────────────────────────────────────────────
btnSaveChar.addEventListener('click', async () => {
  if (!generatedImagePath) { setStatus('No image to save.'); return; }
  btnSaveChar.disabled = true;
  setStatus('Saving character…');
  try {
    const r = await fetch('/api/save-character', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imagePath: generatedImagePath, characterName: nameInput.value }),
    });
    const d = await r.json();
    if (!d.success) throw new Error(d.error);
    setStatus(`Saved: ${d.filename}`);
    loadCharacterThumbs();
  } catch (e) { setStatus('Save error: ' + e.message); }
  finally { btnSaveChar.disabled = false; }
});

// ── Character thumbnails ──────────────────────────────────────────────────────
async function loadCharacterThumbs() {
  try {
    const d = await fetch('/api/gallery/characters').then(r => r.json());
    charThumbRow.querySelector('#char-no-items')?.remove();
    charThumbRow.querySelectorAll('.char-thumb-wrap').forEach(el => el.remove());
    if (!d.success || !d.files.length) {
      const span = document.createElement('span');
      span.id = 'char-no-items'; span.textContent = 'No saved characters';
      charThumbRow.appendChild(span);
      return;
    }
    d.files.forEach(item => {
      if (charThumbRow.querySelector(`[data-path="${item.path}"]`)) return;
      const wrap = document.createElement('div');
      wrap.className = 'char-thumb-wrap asset-thumb-wrap';

      const img = document.createElement('img');
      img.src = item.thumbPath || item.path; img.className = 'char-thumb'; img.dataset.path = item.path;
      img.title = item.name + ' · click — load into active image · drag — to table';
      makeThumbDraggable?.(img, item.path, item.thumbPath || item.path, item.name || '', 'character');
      img.addEventListener('click', e => {
        e.stopPropagation();
        // Save current project, then start a new one for this character
        snapshotCurrentProject?.();
        generationHistory = []; historyIndex = -1; lastGeneratedSeed = null;
        charThumbRow.querySelectorAll('.char-thumb').forEach(t => t.classList.remove('selected'));
        img.classList.add('selected');
        generatedImagePath = item.path; currentFaceBlob = null;
        showFace(item.path + '?t=' + Date.now(), true);
        const parts = item.name.split('_');
        nameInput.value = (parts[0] + (parts[1] ? ' ' + parts[1] : '')).replace(/_/g, ' ');
        showSaveChar(true);
        // Loaded a finished character → no gate.
        setActiveImageOrigin('normal');
        saveAppState();
        setStatus(`Character loaded: ${item.name}`);
      });

      const archBtn = document.createElement('button');
      archBtn.textContent = '✕'; archBtn.title = 'Archive'; archBtn.className = 'asset-del-btn';
      archBtn.addEventListener('click', async e => {
        e.stopPropagation();
        try {
          const r = await fetch('/api/gallery/archive', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filePath: item.path }),
          });
          const rd = await r.json();
          if (!rd.success) throw new Error(rd.error);
          wrap.remove();
          setStatus('Moved to archive.');
        } catch (err) { setStatus('Error: ' + err.message); }
      });

      wrap.appendChild(img); wrap.appendChild(archBtn);
      charThumbRow.appendChild(wrap);
    });
    relinkActiveThumbs(charThumbRow, 'data-path');
  } catch (e) { console.warn('loadCharacterThumbs:', e.message); }
}

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

// ── Смена типа → переключить UI между режимами ───────────────────────────────
function applyTypeMode(mode) {
  const isScene = mode === 'scene';
  btnGenerate.textContent = isScene ? 'Analyze' : 'Generate';
  // Show the generate button only in scene mode (character mode uses per-param ▶ buttons)
  const genWrap = document.getElementById('char-generate-wrap');
  if (genWrap) genWrap.style.display = isScene ? '' : 'none';
  document.getElementById('btn-save-obraz-left').style.display = isScene ? 'none' : '';
  if (btnSavePersaLeft) btnSavePersaLeft.style.display = isScene ? 'none' : '';
  // Hide scene-specific elements when switching back to character mode
  if (!isScene) {
    document.getElementById('scene-result-panel').style.display = 'none';
    document.getElementById('btn-save-scene').style.display     = 'none';
    pendingSceneData = null;
  }
}
typeSelect?.addEventListener('change', () => applyTypeMode(typeSelect.value));

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
  // Save with empty variations array (will be filled as generations complete)
  // imageEngine stored so реран always uses the same engine
  saveObraz(imgPath, selectedLbPath, selectedEnvPath, name, gender, lastGeneratedSeed, [null, null, null, null], _saveEngine);
  const obrazId = getObrazы()[0].id;
  loadObrazы();
  loadScenarioObrazы?.();
  setStatus(`Outfit "${name}" saved! Analyzing pose…`);

  // Trigger pose variation generation — same engine as the main image
  const _poseSid = window.GenLog?.start('Character', '💾 Save Outfit (Pose Variations)');
  fetch('/api/characters/pose-variations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imagePath: imgPath, imageEngine: _saveEngine }),
  })
    .then(r => r.json())
    .then(d => {
      if (!d.success || !d.taskIds?.length) {
        window.GenLog?.finalize(_poseSid, 'error');
        console.warn('[pose-variations]', d.error);
        // Clear pending placeholders so card shows cleanly without spinners
        const list  = getObrazы();
        const entry = list.find(o => o.id === obrazId);
        if (entry) { entry.variations = []; localStorage.setItem('obrazy', JSON.stringify(list)); loadObrazы(); }
        return;
      }
      setStatus(`Generating ${d.taskIds.length} pose variations…`);
      window.GenLog?.finalize(_poseSid, 'success');
      d.taskIds.forEach((taskId, idx) => {
        setObrazSlotTask(obrazId, idx, taskId);
        pollPoseVariation(obrazId, taskId, idx);
      });
    })
    .catch(e => {
      window.GenLog?.finalize(_poseSid, 'error');
      console.warn('[pose-variations]', e.message);
      const list  = getObrazы();
      const entry = list.find(o => o.id === obrazId);
      if (entry) { entry.variations = []; localStorage.setItem('obrazy', JSON.stringify(list)); loadObrazы(); }
    });
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
        const r = await fetch(`/api/characters/pose-status/${taskId}`);
        const d = await r.json();
        if (d.state === 'success') {
          const wasOwner = fulfillObrazSlot(obrazId, taskId, idx, d.imagePath);
          loadObrazы();
          loadScenarioObrazы?.();
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
          loadScenarioObrazы?.();
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
    loadScenarioObrazы?.();
  } finally {
    _activePoseVariationPolls.delete(taskId);
  }
}

// Col 2 save-образ button — same logic as left column button
btnSaveObrazCol2?.addEventListener('click', () => btnSaveObrazLeft?.click());

// ── Сейв перса — save active image to character gallery ──────────────────────
async function savePersa() {
  const imgPath = generatedImagePath;
  if (!imgPath) { setStatus('No active image to save.'); return; }
  const btn1 = btnSavePersaLeft;
  const btn2 = btnSavePersaCol2;
  if (btn1) btn1.disabled = true;
  if (btn2) btn2.disabled = true;
  setStatus('Saving character…');
  try {
    const r = await fetch('/api/save-character', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imagePath: imgPath, characterName: nameInput.value }),
    });
    const d = await r.json();
    if (!d.success) throw new Error(d.error);
    setStatus(`Character saved: ${d.filename}`);
    loadCharacterThumbs();
  } catch (e) { setStatus('Save error: ' + e.message); }
  finally {
    if (btn1) btn1.disabled = false;
    if (btn2) btn2.disabled = false;
  }
}
btnSavePersaLeft?.addEventListener('click', savePersa);
btnSavePersaCol2?.addEventListener('click', savePersa);

// ── Save scene to База данных ─────────────────────────────────────────────────
document.getElementById('btn-save-scene')?.addEventListener('click', async () => {
  if (!pendingSceneData?.generatedPath) { setStatus('No scene data to save.'); return; }
  const btn = document.getElementById('btn-save-scene');
  btn.disabled = true;
  try {
    const r = await fetch('/api/scene/save', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pendingSceneData),
    });
    const d = await r.json();
    if (!d.success) throw new Error(d.error);
    pendingSceneData = null;
    btn.style.display = 'none';
    // Hide result panel after saving
    document.getElementById('scene-result-panel').style.display = 'none';
    loadSceneList?.();
    setStatus('Scene saved to library!');
  } catch (e) {
    setStatus('Save error: ' + e.message);
    btn.disabled = false;
  }
});

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
          setStatus('Анализирую лицо + лукбук…');
          const mixBody = { imagePath: activePath, lookbookImagePath: asset.path };
          const mixD = _glSid && window.GenLog
            ? await window.GenLog.fetchLog(_glSid, '🧠 Анализ: лицо + лукбук', '/api/character/apply-lookbook-mix', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(mixBody) })
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
        setStatus(isTpdneLookbookMix ? 'Генерирую персонажа в выбранном лукбуке…' : 'Generating with asset…');
        const genBody = { activePath, assetPath: asset.path, prompt: combinedPrompt, assetType: asset.assetType, imageEngine: getCharImageEngine() };
        const d = _glSid && window.GenLog
          ? await window.GenLog.fetchLog(_glSid, '🖼 Микс: лукбук + лицо', '/api/asset-interact/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(genBody) })
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
  if (!assetDropZone) return;
  const hasChar = !!(generatedImagePath || (currentFaceBlob && facePreview.style.display !== 'none'));
  const onCharTab = document.querySelector('#l1-tabs [aria-controls="l1-character"]')?.getAttribute('aria-selected') === 'true';
  assetDropZone.style.display = (hasChar && activeAssets.length > 0 && onCharTab) ? 'block' : 'none';
}

// Kept for drag-and-drop compatibility
function addAssetDropRow(imgPath, thumbSrc, defaultName, assetType) {
  activateAsset(imgPath, thumbSrc, defaultName, assetType, null);
}

// ── Make thumb img draggable (char/lb/env thumbnails) ─────────────────────────
function makeThumbDraggable(img, fullPath, thumbSrc, label, assetType) {
  img.draggable = true;
  img.addEventListener('dragstart', e => {
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('application/x-asset-path',  fullPath);
    e.dataTransfer.setData('application/x-asset-thumb', thumbSrc || '');
    e.dataTransfer.setData('application/x-asset-label', label    || '');
    e.dataTransfer.setData('application/x-asset-type',  assetType || '');
  });
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

// ── Сцена tab: populate right column with assets from same APIs ───────────────
async function loadScenaAssets() {
  function fillRow(rowId, items, thumbKey, pathKey, emptyText) {
    const row = document.getElementById(rowId);
    if (!row) return;
    row.innerHTML = '';
    if (!items || !items.length) {
      row.innerHTML = `<div class="gallery-empty" style="padding:8px 0;">${emptyText}</div>`;
      return;
    }
    items.forEach(item => {
      const fp   = item[pathKey] || item;
      const src  = (item[thumbKey] || fp) + '?t=' + Date.now();
      const img  = document.createElement('img');
      img.src    = src;
      img.title  = item.name || '';
      img.dataset.path = fp;
      img.addEventListener('click', () => openLightbox(fp));
      row.appendChild(img);
    });
  }

  // Образы — from localStorage (show char thumb only)
  const obrazyRow = document.getElementById('scena-obrazy-row');
  if (obrazyRow) {
    const list = (() => { try { return JSON.parse(localStorage.getItem('obrazy') || '[]'); } catch { return []; } })();
    obrazyRow.innerHTML = '';
    if (!list.length) {
      obrazyRow.innerHTML = '<div class="gallery-empty" style="padding:8px 0;">No outfits</div>';
    } else {
      list.forEach(o => {
        const path = o.char || o.lb || o.env;
        if (!path) return;
        const img = document.createElement('img');
        img.src   = toThumbPath(path) + '?t=' + Date.now();
        img.title = o.name || '';
        img.style.cssText = 'height:70px; width:auto; max-width:52px; object-fit:cover;';
        img.addEventListener('click', () => openLightbox(path));
        obrazyRow.appendChild(img);
      });
    }
  }

  try {
    const [, lbs, envs, details] = await Promise.all([
      fetch('/api/gallery/characters').then(r => r.json()),
      fetch('/api/lookbooks').then(r => r.json()),
      fetch('/api/environments').then(r => r.json()),
      fetch('/api/details').then(r => r.json()),
    ]);
    fillRow('scena-items-row', details.files || [], 'thumbPath', 'path', 'No items');
    fillRow('scena-lb-row',    lbs.files     || [], 'thumbPath', 'path', 'No lookbooks');
    fillRow('scena-env-row',   envs.files    || [], 'thumbPath', 'path', 'No environments');
  } catch (e) { console.warn('loadScenaAssets:', e.message); }
}

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

  list.forEach(obraz => {
    const card = document.createElement('div');
    card.className = 'char-col3-obraz-card';
    card.title = obraz.name || '';

    // Main image (char)
    if (obraz.char) {
      const img = document.createElement('img');
      img.src = toThumbPath(obraz.char) + '?t=' + Date.now();
      img.className = 'char-col3-obraz-img';
      img.addEventListener('click', () => openLightbox(obraz.char));
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
    if (!currentText || !additions) { statusEl.textContent = 'Введите промпт и дополнения.'; return; }
    statusEl.textContent = 'Обрабатываю…';
    try {
      const r = await fetch(`/api/prompts/${encodeURIComponent(key)}/merge`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentText, additions, fixedPhrases }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error || 'Merge failed');
      textEl.value = d.merged;
      statusEl.textContent = 'Готово.';
    } catch (err) {
      statusEl.textContent = 'Ошибка: ' + err.message;
    }
  }

  // ── Single-prompt view (Age, Gender) ─────────────────────────────────────────
  function openSingle(param) {
    const key = 'param_' + param + '_instruction';
    titleEl.textContent = param === 'age' ? 'Age ▶' : 'Gender ▶';
    bodyEl.innerHTML = `
      <label style="font-weight:bold;display:block;margin-bottom:4px;">Системный промпт:</label>
      <textarea id="ppm-text" rows="5" style="width:100%;font-size:11px;font-family:monospace;resize:vertical;border:1px solid #ccc;padding:5px;box-sizing:border-box;border-radius:3px;">${esc(_paramPrompts[key] || '')}</textarea>
      <div style="margin-top:10px;">
        <label style="font-weight:bold;display:block;margin-bottom:4px;">Дополнения для ИИ-встраивания:</label>
        <textarea id="ppm-add" rows="3" style="width:100%;font-size:11px;font-family:monospace;resize:vertical;border:1px solid #ccc;background:#f9f9ff;padding:5px;box-sizing:border-box;border-radius:3px;" placeholder="Введите дополнения — ИИ органично встроит их в промпт..."></textarea>
      </div>
      <div style="margin-top:8px;display:flex;align-items:center;gap:8px;">
        <button id="ppm-merge" style="font-size:11px;padding:3px 12px;">AI Merge</button>
        <span id="ppm-status" style="font-size:10px;color:#666;"></span>
      </div>`;
    footEl.innerHTML = `
      <div style="flex:1"></div>
      <button id="ppm-save" style="font-size:11px;padding:3px 16px;">Сохранить</button>
      <button id="ppm-cancel" style="font-size:11px;padding:3px 16px;">Отмена</button>`;

    const textEl   = document.getElementById('ppm-text');
    const addEl    = document.getElementById('ppm-add');
    const statusEl = document.getElementById('ppm-status');

    document.getElementById('ppm-merge').addEventListener('click', () =>
      mergeInto(key, PARAM_FIXED[key] || [], textEl, addEl, statusEl));
    document.getElementById('ppm-save').addEventListener('click', async () => {
      const text = textEl.value.trim(); if (!text) return;
      const btn = document.getElementById('ppm-save'); btn.disabled = true;
      try { await saveBrainPrompt(key, text); closeModal(); setStatus?.('Промпт сохранён в Brain.'); }
      catch (err) { statusEl.textContent = 'Ошибка: ' + err.message; }
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
        <input class="ppm-list-name-input" value="${esc(label)}" title="Кликните чтобы переименовать">
      </div>
      <textarea class="ppm-list-text" rows="3">${esc(_paramPrompts[key] || '')}</textarea>
      <div class="ppm-list-row">
        <textarea class="ppm-list-add" rows="2" placeholder="Дополнения для ИИ-встраивания..."></textarea>
        <div class="ppm-list-actions">
          <button class="ppm-list-merge" style="font-size:10px;padding:2px 8px;">AI Merge</button>
          <button class="ppm-list-save"  style="font-size:10px;padding:2px 8px;">Сохранить</button>
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
        statusEl.textContent = 'Сохранено.';
        setTimeout(() => { statusEl.textContent = ''; }, 2000);
      } catch (err) { statusEl.textContent = 'Ошибка: ' + err.message; }
      finally { saveBtn.disabled = false; }
    });
    let _delConfirming = false;
    delBtn.addEventListener('click', async () => {
      if (!_delConfirming) {
        _delConfirming = true;
        delBtn.textContent = 'Точно?';
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
        statusEl.textContent = 'Ошибка: ' + err.message;
        delBtn.disabled = false;
      }
    });

    return div;
  }

  // ── "Create new" section (collapsible, top of list popup) ───────────────────
  function makeNewSection(param, listContainerEl) {
    const isEmotion = param === 'emotion';
    const placeholder = isEmotion
      ? 'Опишите эмоцию в свободной форме…'
      : 'Опишите позу в свободной форме…';
    const namePlaceholder = isEmotion ? 'Excited smile' : 'Sitting on floor';
    const toggleLabel = isEmotion ? '＋ Добавить эмоцию' : '＋ Добавить позу';

    const section = document.createElement('div');
    section.style.cssText = 'margin-bottom:10px;';

    const toggleBtn = document.createElement('button');
    toggleBtn.textContent = toggleLabel;
    toggleBtn.style.cssText = 'width:100%;text-align:left;font-size:11px;font-weight:bold;padding:5px 10px;background:#e8e8f8;border:1px solid #aab;border-radius:4px;cursor:pointer;color:#335;';

    const form = document.createElement('div');
    form.style.cssText = 'display:none;background:#f0f0ff;border:1px solid #aab;border-top:none;border-radius:0 0 5px 5px;padding:10px;';
    form.innerHTML = `
      <label style="font-size:10px;display:block;margin-bottom:2px;">Описание:</label>
      <textarea id="ppm-new-desc" rows="2" style="width:100%;font-size:11px;font-family:monospace;resize:vertical;border:1px solid #ccc;padding:4px;box-sizing:border-box;border-radius:3px;" placeholder="${esc(placeholder)}"></textarea>
      <div style="display:flex;align-items:center;gap:6px;margin-top:5px;">
        <button id="ppm-beautify-btn" style="font-size:11px;padding:3px 12px;">Beautify</button>
        <span id="ppm-beautify-status" style="font-size:10px;color:#666;"></span>
      </div>
      <label style="font-size:10px;display:block;margin-top:8px;margin-bottom:2px;">Результат:</label>
      <textarea id="ppm-new-result" rows="3" style="width:100%;font-size:11px;font-family:monospace;resize:vertical;border:1px solid #ccc;padding:4px;box-sizing:border-box;border-radius:3px;" placeholder="Здесь появится улучшенный промпт…"></textarea>
      <div style="display:flex;align-items:center;gap:6px;margin-top:7px;">
        <label style="font-size:10px;flex-shrink:0;">Название:</label>
        <input id="ppm-new-name" type="text" style="flex:1;font-size:11px;padding:3px;border:1px solid #ccc;border-radius:3px;" placeholder="${esc(namePlaceholder)}">
        <button id="ppm-add-btn" style="font-size:11px;padding:3px 12px;background:#d4f0d4;border:1px solid #888;border-radius:3px;">Add ▼</button>
      </div>`;

    toggleBtn.addEventListener('click', () => {
      const open = form.style.display !== 'none';
      form.style.display = open ? 'none' : 'block';
      toggleBtn.style.borderRadius = open ? '4px' : '4px 4px 0 0';
      toggleBtn.textContent = open ? toggleLabel : '✕ Закрыть';
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
      if (!text) { statusEl.textContent = 'Введите описание.'; return; }
      beatBtn.disabled = true; statusEl.textContent = 'Обрабатываю…';
      try {
        const r = await fetch('/api/prompts/beautify', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, type: param }),
        });
        const d = await r.json();
        if (!d.success) throw new Error(d.error || 'Beautify failed');
        resultEl.value = d.beautified;
        statusEl.textContent = 'Готово.';
      } catch (err) { statusEl.textContent = 'Ошибка: ' + err.message; }
      finally { beatBtn.disabled = false; }
    });

    addBtn.addEventListener('click', async () => {
      const promptText = resultEl.value.trim() || descEl.value.trim();
      const label = nameEl.value.trim();
      if (!promptText) { statusEl.textContent = 'Нет промпта для добавления.'; return; }
      if (!label)      { statusEl.textContent = 'Введите название.'; return; }

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
        statusEl.textContent = 'Добавлено.';
        setTimeout(() => { statusEl.textContent = ''; }, 2500);
      } catch (err) { statusEl.textContent = 'Ошибка: ' + err.message; }
      finally { addBtn.disabled = false; }
    });

    return section;
  }

  // ── List view (Pose, Emotion) ─────────────────────────────────────────────────
  function openList(param) {
    const defaultList = param === 'pose' ? POSE_LIST : EMOTION_LIST;
    titleEl.textContent = param === 'pose' ? 'Pose ▶ — все позы' : 'Emotion ▶ — все эмоции';
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
      <button id="ppm-cancel" style="font-size:11px;padding:3px 16px;">Закрыть</button>`;
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
