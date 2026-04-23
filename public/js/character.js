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
      activeAssets: activeAssets.map(a => ({
        path:        a.path,
        thumbSrc:    a.thumbSrc,
        name:        a.name,
        assetType:   a.assetType,
        nameVal:     a.nameVal     || '',
        exhonVal:    a.exhonVal    || '',
        activnoeVal: a.activnoeVal || '',
        presetVal:   a.presetVal   || '',
        variants:    a.variants    || [],
      })),
    }));
  } catch (e) { console.warn('[saveAppState]', e.message); }
}

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
  setStatus(`Загружено: ${file.name}`);
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
      setStatus('Генерация удалена. Показана предыдущая.');
    } else {
      generationHistory = [];
      historyIndex = -1;
      clearFace();
      setStatus('Генерация удалена.');
    }
  } else {
    clearFace();
    setStatus('Лицо удалено.');
  }
});

btnRandomFace.addEventListener('click', async () => {
  btnRandomFace.disabled = true;
  setStatus('Загружаю случайное лицо…');
  try {
    const res = await fetch('/api/random-face');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    currentFaceBlob = blob; generatedImagePath = null;
    showSaveChar(false);
    faceDropzone.classList.remove('fullbody');
    showFace(URL.createObjectURL(blob));
    nameInput.value = randomName(genderSelect?.value || 'female');
    setStatus('Лицо загружено с thispersondoesnotexist.com');
  } catch (e) { setStatus('Ошибка: ' + e.message); }
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
        setStatus('Темпо: анализирую изображение (Gemini)…');
        const imageBase64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload  = e => resolve(e.target.result.split(',')[1]);
          reader.onerror = reject;
          reader.readAsDataURL(blobToAnalyze);
        });
        const withRealism = document.getElementById('chk-realism')?.checked || false;
        const saveRes  = await fetch('/api/refs/save', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageBase64, withRealism, category: 'character' }),
        });
        const saveData = await saveRes.json();
        if (!saveData.success) throw new Error(saveData.error);

        tempoOriginalBlob = blobToAnalyze;
        tempoRefId        = saveData.entry.id;
        tempoPrompt       = saveData.entry.generationPrompt;
        generationPrompt  = tempoPrompt;
        setStatus(`Темпо: «${saveData.entry.title}» — запускаю генерацию…`);
      } else {
        // ── Repeat run: reuse saved prompt, no analysis ──────────────────────────
        generationPrompt = tempoPrompt;
        setStatus('Темпо: использую сохранённый промпт — запускаю генерацию…');
      }

      if (!generationPrompt) throw new Error('Промпт не найден — попробуйте загрузить фото заново');

      // ── Launch generation — char tab engine takes priority over Мозги ───────
      const _engine = getCharImageEngine();
      const genRes  = await fetch('/api/refs/tempo-generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refId: tempoRefId, generationPrompt, forceEngine: _engine, engineParams: getEngineParams?.(_engine) || {} }),
      });
      const genData = await genRes.json();
      if (!genData.success) throw new Error(genData.error);

      setStatus(`Темпо: генерирую (${genData.engine})…`);

      // ── Poll until done ──────────────────────────────────────────────────────
      const imagePath = await new Promise((resolve, reject) => {
        const iv = setInterval(async () => {
          try {
            const sr = await fetch(`/api/refs/gen-status/${genData.taskId}`);
            const sd = await sr.json();
            if (!sd.success) { clearInterval(iv); reject(new Error(sd.error)); return; }
            if (sd.state === 'success')  { clearInterval(iv); resolve(sd.imagePath); }
            else if (sd.state === 'failed') { clearInterval(iv); reject(new Error(sd.error || 'Ошибка')); }
            else { setStatus(`Темпо: генерирую… (${sd.state})`); }
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
      saveAppState();

      // Link generated image to original ref entry
      await fetch(`/api/refs/${tempoRefId}/add-generation`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imagePath, seed: genData.seed }),
      });

      setStatus(`Темпо: готово. Движок: ${genData.engine}. Нажмите ещё раз для новой генерации.`);
    } catch (e) {
      setStatus('Темпо: ошибка — ' + e.message);
    } finally {
      btnTempo.disabled = false;
      setLoading(false);
    }
  });
}

// ── Generation helpers ────────────────────────────────────────────────────────
function setLoading(active) {
  btnGenerate.disabled   = active;
  btnRefine.disabled     = active;
  btnRandomFace.disabled = active;
  faceDropzone.style.pointerEvents = active ? 'none' : '';
  faceDropzone.classList.toggle('generating', active);
}

function pollUntilDone(statusEndpoint, label) {
  const trackId = `char_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const actRow  = startActiveGen?.(trackId, label || 'Генерация');
  return new Promise((resolve, reject) => {
    const iv = setInterval(async () => {
      try {
        const r = await fetch(statusEndpoint);
        const d = await r.json();
        if (!d.success) {
          clearInterval(iv);
          actRow?.finalize?.('❌ ' + (d.error || 'Ошибка'));
          finishActiveGen?.(trackId);
          logError(label || 'Генерация', d.error);
          reject(new Error(d.error)); return;
        }
        if (d.state === 'success') {
          clearInterval(iv);
          actRow?.setImage?.(d.imagePath);
          finishActiveGen?.(trackId);
          resolve(d.imagePath);
        } else if (d.state === 'failed') {
          clearInterval(iv);
          actRow?.finalize?.('❌ ' + (d.error || 'Ошибка'));
          finishActiveGen?.(trackId);
          logError(label || 'Генерация', d.error || 'Задача завершилась с ошибкой');
          reject(new Error(d.error || 'Ошибка'));
        } else { setStatus(`Генерация… (${d.state})`); }
      } catch (e) {
        clearInterval(iv);
        actRow?.finalize?.('❌ ' + e.message);
        finishActiveGen?.(trackId);
        logError(label || 'Генерация', e.message);
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
  if (!wrap || !msgEl) { setStatus('Ошибка: ' + msg); return; }
  msgEl.textContent = msg;
  wrap.style.display = 'block';
  if (retryFn) _lastGenFn = retryFn;
}
function _hideGenError() {
  const wrap = document.getElementById('gen-error-wrap');
  if (wrap) wrap.style.display = 'none';
}

async function runGeneration(payload, statusMsg) {
  _hideGenError();
  setLoading(true);
  setStatus(statusMsg);
  const balBefore = currentCredits;
  try {
    const _engine = getCharImageEngine();
    console.log('[runGeneration] imageEngine →', _engine, '| charEngineSelect.value:', charEngineSelect?.value, '| localStorage:', localStorage.getItem(CHAR_ENGINE_KEY));
    setStatus(statusMsg + ` [${_engine}]`);
    const _rmState = window.getRealismMarkersState?.() || {};
    const _enabledMarkers = Object.entries(_rmState).filter(([,v]) => v !== false).map(([k]) => k);
    const r = await fetch('/api/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        imageEngine:    _engine,
        withRealism:    document.getElementById('chk-realism')?.checked || false,
        enabledMarkers: _enabledMarkers,
      }),
    });
    const d = await r.json();
    if (!d.success) throw new Error(d.error);

    lastGeneratedSeed = d.seed || null;
    setStatus(d.skinTraits?.length ? `Кожа: ${d.skinTraits.join(', ')}. Генерирую…` : 'Генерирую…');
    const imagePath = await pollUntilDone(`/api/status/${d.taskId}`, payload.extraInstruction ? 'Уточнение' : 'Генерация');

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
    setStatus('Готово!');
    playCompletionSound?.();
    logGeneration(payload.extraInstruction ? 'Уточнение' : 'Генерация', location.origin + imagePath, balBefore);
  } catch (err) {
    setStatus('Ошибка: ' + err.message);
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
  if (!currentFaceBlob) { setStatus('Загрузите изображение сцены.'); return; }
  _hideGenError();
  setLoading(true);
  setStatus('Анализирую сцену (Gemini 3.1 Pro)…');
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

    setStatus('Анализ готов. Генерирую изображение (2K)…');

    const imagePath = await pollUntilDone(`/api/scene/status/${d.taskId}`, 'Сцена');

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
      descParts.push('Персонажи: ' + d.actors);
    resultDesc.textContent = descParts.join('\n\n') || '—';

    panel.style.display = 'block';

    // Hide char-specific buttons, show save-scene
    btnSaveChar.style.display   = 'none';
    document.getElementById('btn-save-scene').style.display = 'inline-block';

    setStatus('Сцена готова!');
    logGeneration('Сцена', location.origin + imagePath, balBefore);
  } catch (err) {
    setStatus('Ошибка: ' + err.message);
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
      'Применяю параметры к активному изображению…'
    );
    return;
  }

  // Fresh generation from face blob
  if (currentFaceBlob) {
    const faceBase64 = await blobToBase64(currentFaceBlob);
    runGeneration(
      { ...genPayload, faceBase64 },
      'Анализирую лицо (Gemini)…'
    );
    return;
  }

  setStatus('Загрузите или выберите изображение.');
});

btnRefine.addEventListener('click', () => {
  if (!generatedImagePath) { setStatus('Нет изображения для изменений.'); return; }
  const extra = refineExtra.value.trim();
  if (!extra) { setStatus('Введите изменения.'); return; }
  runGeneration(
    {
      age: document.getElementById('age').value,
      gender: document.getElementById('gender').value,
      imagePath: generatedImagePath,
      extraInstruction: extra,
      emotion: emotionSelect?.value || 'neutral',
    },
    'Применяю изменения…'
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

  function applyParam(extraInstruction, labelStatus) {
    const imgPath = activeImagePath();
    if (!imgPath && !currentFaceBlob) { setStatus('Загрузите или сгенерируйте изображение.'); return; }
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
      blobToBase64(currentFaceBlob).then(faceBase64 => {
        runGeneration({ ...payload, faceBase64 }, labelStatus);
      });
    } else {
      runGeneration(payload, labelStatus);
    }
  }

  document.getElementById('btn-gen-age')?.addEventListener('click', () => {
    const age = resolveAge();
    applyParam(`Change the apparent age of the person to ${age} years old. Keep everything else identical.`, 'Применяю возраст…');
  });

  document.getElementById('btn-gen-gender')?.addEventListener('click', () => {
    const gender = resolveGender();
    const word   = gender === 'male' ? 'male man' : 'female woman';
    applyParam(`Transform the person into a ${word}. Keep the same pose, outfit, background, and expression exactly.`, 'Применяю пол…');
  });

  document.getElementById('btn-gen-pose')?.addEventListener('click', () => {
    const { poseKey, customPosePrompt } = resolvePose();
    const imgPath = activeImagePath();
    if (!imgPath && !currentFaceBlob) { setStatus('Загрузите или сгенерируйте изображение.'); return; }
    const age    = resolveAge();
    const gender = resolveGender();
    const { emotion, customEmotionPrompt } = resolveEmotion();
    const payload = imgPath
      ? { age, gender, imagePath: imgPath, poseKey, customPosePrompt, emotion, customEmotionPrompt }
      : { age, gender, poseKey, customPosePrompt, emotion, customEmotionPrompt };
    if (!imgPath) {
      blobToBase64(currentFaceBlob).then(faceBase64 => runGeneration({ ...payload, faceBase64 }, 'Применяю позу…'));
    } else {
      runGeneration(payload, 'Применяю позу…');
    }
  });

  document.getElementById('btn-gen-emotion')?.addEventListener('click', () => {
    const { emotion, customEmotionPrompt } = resolveEmotion();
    const instruction  = customEmotionPrompt
      ? `Change the person's facial expression to: ${customEmotionPrompt}. Keep everything else identical.`
      : `Change the person's facial expression to ${emotion}. Keep pose, outfit, and background exactly the same.`;
    applyParam(instruction, 'Применяю эмоцию…');
  });
})();

// ── Save character ────────────────────────────────────────────────────────────
btnSaveChar.addEventListener('click', async () => {
  if (!generatedImagePath) { setStatus('Нет изображения для сохранения.'); return; }
  btnSaveChar.disabled = true;
  setStatus('Сохраняю персонажа…');
  try {
    const r = await fetch('/api/save-character', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imagePath: generatedImagePath, characterName: nameInput.value }),
    });
    const d = await r.json();
    if (!d.success) throw new Error(d.error);
    setStatus(`Сохранено: ${d.filename}`);
    loadCharacterThumbs();
  } catch (e) { setStatus('Ошибка сохранения: ' + e.message); }
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
      span.id = 'char-no-items'; span.textContent = 'Нет сохранённых персонажей';
      charThumbRow.appendChild(span);
      return;
    }
    d.files.forEach(item => {
      if (charThumbRow.querySelector(`[data-path="${item.path}"]`)) return;
      const wrap = document.createElement('div');
      wrap.className = 'char-thumb-wrap asset-thumb-wrap';

      const img = document.createElement('img');
      img.src = item.thumbPath || item.path; img.className = 'char-thumb'; img.dataset.path = item.path;
      img.title = item.name + ' · клик — загрузить в активное изображение · перетащить — в таблицу';
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
        saveAppState();
        setStatus(`Персонаж загружен: ${item.name}`);
      });

      const archBtn = document.createElement('button');
      archBtn.textContent = '✕'; archBtn.title = 'В архив'; archBtn.className = 'asset-del-btn';
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
          setStatus('Перемещено в архив.');
        } catch (err) { setStatus('Ошибка: ' + err.message); }
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
        span.id = 'lb-no-items'; span.textContent = 'Нет лукбуков';
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
      img.title = 'клик — активировать · двойной клик — выбрать для «Применить»';
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
        setStatus('Лукбук выбран.');
      });

      const delBtn = document.createElement('button');
      delBtn.className = 'asset-del-btn'; delBtn.textContent = '✕'; delBtn.title = 'В архив';
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
          wrap.remove(); setStatus('Лукбук перемещён в архив.');
        } catch (err) { setStatus('Ошибка: ' + err.message); }
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
        span.id = 'env-no-items'; span.textContent = 'Нет окружений';
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
      img.title = 'клик — активировать · двойной клик — выбрать для «Применить»';
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
        setStatus('Окружение выбрано.');
      });

      const delBtn = document.createElement('button');
      delBtn.className = 'asset-del-btn'; delBtn.textContent = '✕'; delBtn.title = 'В архив';
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
          wrap.remove(); setStatus('Окружение перемещено в архив.');
        } catch (err) { setStatus('Ошибка: ' + err.message); }
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
        span.textContent = 'Нет предметов';
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
      img.title = (item.name || '') + ' · клик — активировать';
      makeThumbDraggable?.(img, fp, item.thumbPath || fp, item.name || '', 'detail');
      img.addEventListener('click', e => {
        e.stopPropagation();
        activateAsset?.(fp, item.thumbPath || fp, item.name || '', 'detail', img);
      });

      const delBtn = document.createElement('button');
      delBtn.className = 'asset-del-btn'; delBtn.textContent = '✕'; delBtn.title = 'В архив';
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
          setStatus('Предмет перемещён в архив.');
        } catch (err) { setStatus('Ошибка: ' + err.message); }
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
    setStatus('Для Обринжа сначала сгенерируйте полнотелого персонажа.'); return;
  }

  const imageBase64 = await blobToBase64(await fetch(generatedImagePath).then(r => r.blob()));

  btnObrinj.disabled = true;
  setStatus('Запускаю Обринж…');

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

    setStatus('Обринж: генерирую 3 изображения…');
    await Promise.all([
      pollTask(d.tposeTaskId,    `/api/obrinj/tpose/status/${d.tposeTaskId}`,    tposeId,    'T-pose')
        .then(p => { if (p) logGeneration('Обринж (T-pose)',    location.origin + p, balBefore); }).catch(() => {}),
      pollTask(d.clothingTaskId, `/api/lookbook/status/${d.clothingTaskId}`,     clothingId, 'Одежда')
        .then(p => { if (p) logGeneration('Обринж (одежда)',    location.origin + p, null);      }).catch(() => {}),
      pollTask(d.envTaskId,      `/api/environment/status/${d.envTaskId}`,        envId,      'Окружение')
        .then(p => { if (p) logGeneration('Обринж (окружение)', location.origin + p, null);      }).catch(() => {}),
    ]);

    setStatus('Обринж готов! Выберите, что сохранить.');
    showAddToDbButton();
  } catch (e) { setStatus('Ошибка Обринж: ' + e.message); }
  finally { btnObrinj.disabled = false; }
});

// ── Смена пола → перегенерировать имя ────────────────────────────────────────
genderSelect?.addEventListener('change', () => {
  nameInput.value = randomName(genderSelect.value);
});

// ── Смена типа → переключить UI между режимами ───────────────────────────────
function applyTypeMode(mode) {
  const isScene = mode === 'scene';
  btnGenerate.textContent = isScene ? 'Анализировать' : 'Сгенерировать';
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
    setStatus('Загружаю изображение…');
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
      setStatus('Ошибка загрузки: ' + e.message);
      btnSaveObrazLeft.disabled = false;
      return;
    }
    btnSaveObrazLeft.disabled = false;
  }

  if (!imgPath) {
    setStatus('Сначала сгенерируйте или загрузите изображение персонажа.');
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
  setStatus(`Образ «${name}» сохранён! Анализирую позу…`);

  // Trigger pose variation generation — same engine as the main image
  fetch('/api/characters/pose-variations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imagePath: imgPath, imageEngine: _saveEngine }),
  })
    .then(r => r.json())
    .then(d => {
      if (!d.success || !d.taskIds?.length) {
        console.warn('[pose-variations]', d.error);
        // Clear pending placeholders so card shows cleanly without spinners
        const list  = getObrazы();
        const entry = list.find(o => o.id === obrazId);
        if (entry) { entry.variations = []; localStorage.setItem('obrazy', JSON.stringify(list)); loadObrazы(); }
        return;
      }
      setStatus(`Генерирую ${d.taskIds.length} вариации позы…`);
      d.taskIds.forEach((taskId, idx) => {
        setObrazSlotTask(obrazId, idx, taskId);
        pollPoseVariation(obrazId, taskId, idx);
      });
    })
    .catch(e => {
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
            if (entry?.variations?.every(v => v && v !== null)) setStatus('Все вариации позы готовы!');
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
  if (!imgPath) { setStatus('Нет активного изображения для сохранения.'); return; }
  const btn1 = btnSavePersaLeft;
  const btn2 = btnSavePersaCol2;
  if (btn1) btn1.disabled = true;
  if (btn2) btn2.disabled = true;
  setStatus('Сохраняю персонажа…');
  try {
    const r = await fetch('/api/save-character', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imagePath: imgPath, characterName: nameInput.value }),
    });
    const d = await r.json();
    if (!d.success) throw new Error(d.error);
    setStatus(`Персонаж сохранён: ${d.filename}`);
    loadCharacterThumbs();
  } catch (e) { setStatus('Ошибка сохранения: ' + e.message); }
  finally {
    if (btn1) btn1.disabled = false;
    if (btn2) btn2.disabled = false;
  }
}
btnSavePersaLeft?.addEventListener('click', savePersa);
btnSavePersaCol2?.addEventListener('click', savePersa);

// ── Save scene to База данных ─────────────────────────────────────────────────
document.getElementById('btn-save-scene')?.addEventListener('click', async () => {
  if (!pendingSceneData?.generatedPath) { setStatus('Нет данных сцены для сохранения.'); return; }
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
    setStatus('Сцена сохранена в базу!');
  } catch (e) {
    setStatus('Ошибка сохранения: ' + e.message);
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
  { value: '',              label: '— пресет —' },
  { value: 'pose_desk',     label: '1 — За столом' },
  { value: 'pose_sofa',     label: '2 — На диване' },
  { value: 'pose_window',   label: '3 — У окна' },
  { value: 'pose_kitchen',  label: '4 — На кухне' },
  { value: 'pose_standing', label: '5 — Стоя' },
];
const DETAIL_PRESET_OPTIONS = [
  { value: '',         label: '— пресет —' },
  { value: 'holds',    label: 'Держит в руке' },
  { value: 'wears',    label: 'Надевает' },
  { value: 'near',     label: 'Стоит рядом' },
  { value: 'uses',     label: 'Использует' },
  { value: 'looks_at', label: 'Смотрит на' },
];
const LB_ENV_PRESET_OPTIONS = [
  { value: '',           label: '— пресет —' },
  { value: 'apply',      label: 'Применить стиль' },
  { value: 'background', label: 'Использовать как фон' },
  { value: 'blend',      label: 'Смешать с текущим' },
];

const ASSET_TYPE_LABELS = {
  character:   'Персонаж',
  lookbook:    'Лукбук',
  environment: 'Окружение',
  detail:      'Предмет',
};

// Build preset select from AI-generated variants stored on the asset object
function buildPresetSelectFromVariants(asset) {
  const sel = document.createElement('select');
  sel.className = 'adt-select';
  const placeholder = document.createElement('option');
  placeholder.value = ''; placeholder.textContent = '— нажмите ✓ —';
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
    const inputs = tr.querySelectorAll('.adt-input');
    if (inputs[0]) activeAssets[i].nameVal    = inputs[0].value;
    if (inputs[1]) activeAssets[i].exhonVal   = inputs[1].value;
    if (inputs[2]) activeAssets[i].activnoeVal = inputs[2].value;
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

    // Col 4: НЕЙМ
    const tdName = document.createElement('td');
    const nameIn = document.createElement('input');
    nameIn.type = 'text'; nameIn.className = 'adt-input';
    nameIn.placeholder = 'Название…';
    nameIn.value = asset.nameVal ?? asset.name ?? '';
    nameIn.addEventListener('blur', () => { asset.nameVal = nameIn.value; saveAppState(); });
    tdName.appendChild(nameIn);

    // Col 5: ЭКШОН
    const tdExhon = document.createElement('td');
    const exhonIn = document.createElement('input');
    exhonIn.type = 'text'; exhonIn.className = 'adt-input';
    exhonIn.placeholder = 'Взаимодействие…';
    exhonIn.value = asset.exhonVal || '';
    exhonIn.addEventListener('blur', () => { asset.exhonVal = exhonIn.value; saveAppState(); });
    tdExhon.appendChild(exhonIn);

    // Col 6: АКТИВНОЕ
    const tdActivnoe = document.createElement('td');
    const activnoeIn = document.createElement('input');
    activnoeIn.type = 'text'; activnoeIn.className = 'adt-input';
    activnoeIn.placeholder = 'Область / деталь…';
    activnoeIn.value = asset.activnoeVal || '';
    activnoeIn.addEventListener('blur', () => { asset.activnoeVal = activnoeIn.value; saveAppState(); });
    tdActivnoe.appendChild(activnoeIn);

    // Col 7: ПРЕСЕТ (empty until ✓ pressed)
    const tdPreset = document.createElement('td');
    tdPreset.className = 'adt-preset-cell';
    tdPreset.appendChild(buildPresetSelectFromVariants(asset));

    // Col 8: ✓ — запустить AI-анализ
    const tdCheck = document.createElement('td');
    const checkBtn = document.createElement('button');
    checkBtn.className = 'adt-check-btn'; checkBtn.textContent = '✓';
    checkBtn.title = 'Анализировать варианты';
    checkBtn.addEventListener('click', async () => {
      // Collect current row inputs
      asset.nameVal     = nameIn.value;
      asset.exhonVal    = exhonIn.value;
      asset.activnoeVal = activnoeIn.value;

      const activePath = generatedImagePath;
      if (!activePath) { setStatus('Сначала загрузите активное изображение.'); return; }

      checkBtn.disabled = true;
      checkBtn.textContent = '…';
      setStatus('Анализирую варианты взаимодействия…');

      try {
        const r = await fetch('/api/asset-interact/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            activePath,
            assetPath:  asset.path,
            nameVal:    asset.nameVal,
            exhon:      asset.exhonVal,
            activnoe:   asset.activnoeVal,
          }),
        });
        const d = await r.json();
        if (!d.success) throw new Error(d.error);

        asset.variants = d.variants; // [{label, prompt}, ...]
        asset.presetVal = '';
        saveVariantsForPath(asset.path, d.variants);

        // Rebuild only the preset cell in this row without full re-render
        tdPreset.innerHTML = '';
        tdPreset.appendChild(buildPresetSelectFromVariants(asset));
        saveAppState();
        setStatus(`Получено ${d.variants.length} вариантов. Выберите в столбце ПРЕСЕТ.`);
      } catch (e) {
        setStatus('Ошибка анализа: ' + e.message);
      } finally {
        checkBtn.disabled = false;
        checkBtn.textContent = '✓';
      }
    });
    tdCheck.appendChild(checkBtn);

    // Col 9: ГЕНЕРИРОВАТЬ
    const tdGen = document.createElement('td');
    const genBtn = document.createElement('button');
    genBtn.className = 'adt-gen-btn'; genBtn.textContent = 'Генерировать';

    // Inline error row for this asset
    const assetErrWrap = document.createElement('div');
    assetErrWrap.style.cssText = 'display:none;margin-top:3px;padding:3px 5px;background:#3a1111;border:1px solid #a33;border-radius:3px;font-size:9px;color:#f99;';
    const assetErrMsg  = document.createElement('div');
    assetErrMsg.style.cssText = 'margin-bottom:3px;word-break:break-word;';
    const assetRetry   = document.createElement('button');
    assetRetry.textContent = '↺ Повторить';
    assetRetry.style.cssText = 'font-size:9px;padding:1px 6px;cursor:pointer;background:#1155cc;color:#fff;border:none;border-radius:3px;';
    assetErrWrap.appendChild(assetErrMsg);
    assetErrWrap.appendChild(assetRetry);

    async function runAssetGen() {
      const activePath = generatedImagePath;
      if (!activePath) { setStatus('Нет активного изображения.'); return; }

      genBtn.disabled = true; genBtn.textContent = '…';
      assetErrWrap.style.display = 'none';

      try {
        // Step 1: Gemini pre-analysis — combine active image + asset + optional preset into one prompt
        setStatus('Анализирую ассет (Gemini)…');
        const preR = await fetch('/api/asset-interact/pre-analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ activePath, assetPath: asset.path, presetPrompt: asset.presetVal || '' }),
        });
        const preD = await preR.json();
        if (!preD.success) throw new Error(preD.error);
        const combinedPrompt = preD.combinedPrompt;

        // Step 2: Generate with the combined prompt
        setStatus('Генерирую с ассетом…');
        const r = await fetch('/api/asset-interact/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ activePath, assetPath: asset.path, prompt: combinedPrompt, assetType: asset.assetType, imageEngine: getCharImageEngine() }),
        });
        const d = await r.json();
        if (!d.success) throw new Error(d.error);

        lastGeneratedSeed = d.seed || null;
        const imagePath = await pollUntilDone(`/api/asset-interact/status/${d.taskId}`, 'Ассет');
        generatedImagePath = imagePath;
        showFace(imagePath + '?t=' + Date.now());
        pushToHistory(imagePath);
        pushToGeni?.(imagePath, lastGeneratedSeed, getCurrentProjectId?.());
        showSaveChar(true);
        saveAppState();
        updateCurrentProject?.(JSON.parse(localStorage.getItem('char_state_v1') || 'null'));
        setStatus('Готово! Результат в активном изображении.');
      } catch (e) {
        setStatus('Ошибка генерации: ' + e.message);
        assetErrMsg.textContent = e.message;
        assetErrWrap.style.display = 'block';
      } finally {
        genBtn.disabled = false; genBtn.textContent = 'Генерировать';
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
    tr.appendChild(tdName);  tr.appendChild(tdExhon); tr.appendChild(tdActivnoe);
    tr.appendChild(tdPreset); tr.appendChild(tdCheck); tr.appendChild(tdGen); tr.appendChild(tdDel);
    assetDropTbody.appendChild(tr);
  });

  syncAssetDropZone();
}

// Toggle activate/deactivate an asset in the table
function activateAsset(path, thumbSrc, name, assetType, imgEl) {
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
    setStatus(`Максимум ${MAX_ASSETS} активных ассетов.`);
    return;
  }
  const savedVariants = getVariantsForPath(path);
  activeAssets.push({
    path, thumbSrc, name, assetType,
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
      obrazyRow.innerHTML = '<div class="gallery-empty" style="padding:8px 0;">Нет образов</div>';
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
    fillRow('scena-items-row', details.files || [], 'thumbPath', 'path', 'Нет предметов');
    fillRow('scena-lb-row',    lbs.files     || [], 'thumbPath', 'path', 'Нет лукбуков');
    fillRow('scena-env-row',   envs.files    || [], 'thumbPath', 'path', 'Нет окружений');
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
  setStatus('Скачиваю изображение по ссылке…');
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
    setStatus('Изображение загружено по ссылке.');
  } catch (err) { setStatus('Ошибка загрузки: ' + err.message); }
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
  setStatus(`История: ${historyIndex + 1} / ${generationHistory.length}`);
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
  setStatus(`История: ${historyIndex + 1} / ${generationHistory.length}`);
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
    span.textContent = 'Нет образов';
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
