/* ═══════════════════════════════════════════════
   CHARACTER TAB — face, generate, thumbs, apply
   ═══════════════════════════════════════════════ */

const faceDropzone    = document.getElementById('face-dropzone');
const faceInput       = document.getElementById('face-input');
const facePreview     = document.getElementById('face-preview');
const facePlaceholder = document.getElementById('face-placeholder');
const btnDeleteFace   = document.getElementById('btn-delete-face');
const btnRandomFace   = document.getElementById('btn-random-face');
const btnObrinj       = document.getElementById('btn-obrinj');
const btnSaveObrazLeft = document.getElementById('btn-save-obraz-left');
const genderSelect    = document.getElementById('gender');
const poseSelect      = document.getElementById('pose');
const typeSelect      = document.getElementById('char-type');
const btnGenerate     = document.getElementById('btn-generate');
const btnSaveChar     = document.getElementById('btn-save-char');
const btnRefine       = document.getElementById('btn-refine');
const refineSection   = document.getElementById('refine-section');
const refineExtra     = document.getElementById('refine-extra');
const nameInput       = document.getElementById('char-name');
const lbThumbRow      = document.getElementById('lb-thumb-row');
const lbNoItems       = document.getElementById('lb-no-items');
const btnApplyLb      = document.getElementById('btn-apply-lb');
const envThumbRow     = document.getElementById('env-thumb-row');
const envNoItems      = document.getElementById('env-no-items');
const btnApplyEnv     = document.getElementById('btn-apply-env');
const charThumbRow    = document.getElementById('char-thumb-row');
const charNoItems     = document.getElementById('char-no-items');

const POSE_KEYS = ['pose_desk', 'pose_sofa', 'pose_window', 'pose_kitchen', 'pose_standing'];

let currentFaceBlob    = null;
let generatedImagePath = null;
let selectedLbPath     = null;
let selectedEnvPath    = null;

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
      nameInputValue:  nameInput?.value  || '',
      genderValue:     genderSelect?.value || 'female',
      poseValue:       poseSelect?.value   || 'random',
      charTypeValue:   typeSelect?.value   || 'character',
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

  if (nameInput    && state.nameInputValue) nameInput.value     = state.nameInputValue;
  if (genderSelect && state.genderValue)   genderSelect.value   = state.genderValue;
  if (poseSelect   && state.poseValue)     poseSelect.value     = state.poseValue;
  if (typeSelect   && state.charTypeValue) {
    typeSelect.value = state.charTypeValue;
    applyTypeMode?.(state.charTypeValue);
  }

  if (state.generatedImagePath) {
    generatedImagePath = state.generatedImagePath;
    currentFaceBlob    = null;
    // fromCharThumb=true shows Обринж button if path is in /characters/
    showFace(state.generatedImagePath + '?t=' + Date.now(), state.generatedImagePath.includes('/characters/'));
    refineSection.style.display = 'block';
    btnSaveChar.style.display   = 'inline-block';
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
  facePreview.src = src;
  facePreview.style.display = 'block';
  facePlaceholder.style.display = 'none';
  btnDeleteFace.style.display = 'inline-block';
  if (btnObrinj) btnObrinj.style.display = fromCharThumb ? 'inline-block' : 'none';
  syncAssetDropZone?.();
}
function clearFace() {
  facePreview.src = '';
  facePreview.style.display = 'none';
  facePlaceholder.style.display = 'block';
  btnDeleteFace.style.display = 'none';
  if (btnObrinj) btnObrinj.style.display = 'none';
  faceInput.value = '';
  currentFaceBlob    = null;
  generatedImagePath = null;
  refineSection.style.display = 'none';
  refineExtra.value  = '';
  btnSaveChar.style.display = 'none';
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
  currentFaceBlob = file; generatedImagePath = null;
  refineSection.style.display = 'none';
  btnSaveChar.style.display = 'none';
  faceDropzone.classList.remove('fullbody');
  showFace(URL.createObjectURL(file));
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
btnDeleteFace.addEventListener('click', e => { e.stopPropagation(); clearFace(); setStatus('Лицо удалено.'); });

btnRandomFace.addEventListener('click', async () => {
  btnRandomFace.disabled = true;
  setStatus('Загружаю случайное лицо…');
  try {
    const res = await fetch('/api/random-face');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    currentFaceBlob = blob; generatedImagePath = null;
    refineSection.style.display = 'none';
    btnSaveChar.style.display = 'none';
    faceDropzone.classList.remove('fullbody');
    showFace(URL.createObjectURL(blob));
    nameInput.value = randomName(genderSelect?.value || 'female');
    setStatus('Лицо загружено с thispersondoesnotexist.com');
  } catch (e) { setStatus('Ошибка: ' + e.message); }
  finally { btnRandomFace.disabled = false; }
});

// ── Generation helpers ────────────────────────────────────────────────────────
function setLoading(active) {
  btnGenerate.disabled   = active;
  btnRefine.disabled     = active;
  btnRandomFace.disabled = active;
  btnApplyLb.disabled    = active ? true : selectedLbPath === null;
  faceDropzone.style.pointerEvents = active ? 'none' : '';
  faceDropzone.classList.toggle('generating', active);
}

function pollUntilDone(statusEndpoint, label) {
  return new Promise((resolve, reject) => {
    const iv = setInterval(async () => {
      try {
        const r = await fetch(statusEndpoint);
        const d = await r.json();
        if (!d.success) {
          clearInterval(iv);
          logError(label || 'Генерация', d.error);
          reject(new Error(d.error)); return;
        }
        if (d.state === 'success') { clearInterval(iv); resolve(d.imagePath); }
        else if (d.state === 'failed') {
          clearInterval(iv);
          logError(label || 'Генерация', d.error || 'Задача завершилась с ошибкой');
          reject(new Error(d.error || 'Ошибка'));
        }
        else { setStatus(`Генерация… (${d.state})`); }
      } catch (e) { clearInterval(iv); logError(label || 'Генерация', e.message); reject(e); }
    }, 3000);
  });
}

async function runGeneration(payload, statusMsg) {
  setLoading(true);
  setStatus(statusMsg);
  const balBefore = currentCredits;
  try {
    const r = await fetch('/api/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const d = await r.json();
    if (!d.success) throw new Error(d.error);

    setStatus(d.skinTraits?.length ? `Кожа: ${d.skinTraits.join(', ')}. Генерирую…` : 'Генерирую…');
    const imagePath = await pollUntilDone(`/api/status/${d.taskId}`, payload.extraInstruction ? 'Уточнение' : 'Генерация');

    generatedImagePath = imagePath; currentFaceBlob = null;
    showFace(imagePath + '?t=' + Date.now());
    refineSection.style.display = 'block';
    refineExtra.value = '';
    btnSaveChar.style.display = 'inline-block';
    saveAppState();
    setStatus('Готово!');
    logGeneration(payload.extraInstruction ? 'Уточнение' : 'Генерация', location.origin + imagePath, balBefore);
  } catch (err) {
    setStatus('Ошибка: ' + err.message);
  } finally {
    setLoading(false);
  }
}

// ── Scene mode: analyse + generate ───────────────────────────────────────────
let pendingSceneData = null; // stores analysis result until generation completes

async function runSceneAnalysis() {
  if (!currentFaceBlob) { setStatus('Загрузите изображение сцены.'); return; }
  setLoading(true);
  setStatus('Анализирую сцену (Gemini 3.1 Pro)…');
  const balBefore = currentCredits;
  try {
    const imageBase64 = await blobToBase64(currentFaceBlob);
    const r = await fetch('/api/scene/analyze', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64 }),
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
    refineSection.style.display = 'none';
    btnSaveChar.style.display   = 'none';
    document.getElementById('btn-save-scene').style.display = 'inline-block';

    setStatus('Сцена готова!');
    logGeneration('Сцена', location.origin + imagePath, balBefore);
  } catch (err) {
    setStatus('Ошибка: ' + err.message);
  } finally {
    setLoading(false);
  }
}

// ── Generate & Refine ─────────────────────────────────────────────────────────
btnGenerate.addEventListener('click', async () => {
  if (typeSelect?.value === 'scene') {
    runSceneAnalysis();
    return;
  }

  if (!currentFaceBlob) { setStatus('Загрузите лицо персонажа.'); return; }
  const faceBase64 = await blobToBase64(currentFaceBlob);

  // Resolve pose: if random, pick one and reflect it in the select
  let poseKey = poseSelect?.value || 'random';
  if (poseKey === 'random') {
    poseKey = POSE_KEYS[Math.floor(Math.random() * POSE_KEYS.length)];
    if (poseSelect) poseSelect.value = poseKey;
  }

  runGeneration(
    { age: document.getElementById('age').value, gender: document.getElementById('gender').value, faceBase64, poseKey },
    'Анализирую лицо (Gemini)…'
  );
});

btnRefine.addEventListener('click', () => {
  if (!generatedImagePath) { setStatus('Нет изображения для изменений.'); return; }
  const extra = refineExtra.value.trim();
  if (!extra) { setStatus('Введите изменения.'); return; }
  runGeneration(
    { age: document.getElementById('age').value, gender: document.getElementById('gender').value, imagePath: generatedImagePath, extraInstruction: extra },
    'Применяю изменения…'
  );
});

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
    charNoItems?.remove();
    charThumbRow.querySelectorAll('.char-thumb-wrap').forEach(el => el.remove());
    if (!d.success || !d.files.length) {
      if (!charThumbRow.querySelector('#char-no-items')) {
        const span = document.createElement('span');
        span.id = 'char-no-items'; span.textContent = 'Нет сохранённых персонажей';
        charThumbRow.appendChild(span);
      }
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
        charThumbRow.querySelectorAll('.char-thumb').forEach(t => t.classList.remove('selected'));
        img.classList.add('selected');
        generatedImagePath = item.path; currentFaceBlob = null;
        showFace(item.path + '?t=' + Date.now(), true);
        const parts = item.name.split('_');
        nameInput.value = (parts[0] + (parts[1] ? ' ' + parts[1] : '')).replace(/_/g, ' ');
        refineSection.style.display = 'block';
        btnSaveChar.style.display   = 'inline-block';
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
        selectedLbPath = fp; btnApplyLb.disabled = false;
        setStatus('Лукбук выбран. Нажмите «Применить».');
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
          if (selectedLbPath === fp) { selectedLbPath = null; btnApplyLb.disabled = true; }
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
        selectedEnvPath = fp; if (btnApplyEnv) btnApplyEnv.disabled = false;
        setStatus('Окружение выбрано. Нажмите «Применить».');
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
          if (selectedEnvPath === fp) { selectedEnvPath = null; if (btnApplyEnv) btnApplyEnv.disabled = true; }
          wrap.remove(); setStatus('Окружение перемещено в архив.');
        } catch (err) { setStatus('Ошибка: ' + err.message); }
      });

      wrap.appendChild(img); wrap.appendChild(delBtn);
      envThumbRow.appendChild(wrap);
    });
    relinkActiveThumbs(envThumbRow, 'data-path');
  } catch (e) { console.warn('loadEnvironmentThumbs:', e.message); }
}

// ── Apply lookbook ────────────────────────────────────────────────────────────
btnApplyLb.addEventListener('click', async () => {
  if (!selectedLbPath) { setStatus('Выберите лукбук.'); return; }
  let characterBase64 = null;
  if (currentFaceBlob) {
    characterBase64 = await blobToBase64(currentFaceBlob);
  } else if (generatedImagePath) {
    characterBase64 = await blobToBase64(await fetch(generatedImagePath).then(r => r.blob()));
  } else { setStatus('Загрузите или сгенерируйте персонажа.'); return; }

  const balBefore = currentCredits;
  setLoading(true); setStatus('Применяю лукбук…');
  try {
    const r = await fetch('/api/apply-lookbook', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ characterBase64, lookbookPath: selectedLbPath }),
    });
    const d = await r.json();
    if (!d.success) throw new Error(d.error);
    setStatus('Генерирую образ…');
    const imagePath = await pollUntilDone(`/api/apply-lookbook/status/${d.taskId}`, 'Лукбук');
    generatedImagePath = imagePath; currentFaceBlob = null;
    faceDropzone.classList.add('fullbody');
    showFace(imagePath + '?t=' + Date.now());
    refineSection.style.display = 'block'; btnSaveChar.style.display = 'inline-block';
    setStatus('Лукбук применён!');
    logGeneration('Лукбук', location.origin + imagePath, balBefore);
  } catch (e) { setStatus('Ошибка: ' + e.message); }
  finally { setLoading(false); }
});

// ── Apply environment ─────────────────────────────────────────────────────────
btnApplyEnv?.addEventListener('click', async () => {
  if (!selectedEnvPath) { setStatus('Выберите окружение.'); return; }
  let characterBase64 = null;
  if (currentFaceBlob) {
    characterBase64 = await blobToBase64(currentFaceBlob);
  } else if (generatedImagePath) {
    characterBase64 = await blobToBase64(await fetch(generatedImagePath).then(r => r.blob()));
  } else { setStatus('Загрузите или сгенерируйте персонажа.'); return; }

  const balBefore = currentCredits;
  setLoading(true); setStatus('Применяю окружение…');
  try {
    const r = await fetch('/api/apply-environment', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ characterBase64, environmentPath: selectedEnvPath }),
    });
    const d = await r.json();
    if (!d.success) throw new Error(d.error);
    setStatus('Генерирую с окружением…');
    const imagePath = await pollUntilDone(`/api/apply-environment/status/${d.taskId}`, 'Окружение');
    generatedImagePath = imagePath; currentFaceBlob = null;
    faceDropzone.classList.add('fullbody');
    showFace(imagePath + '?t=' + Date.now());
    refineSection.style.display = 'block'; btnSaveChar.style.display = 'inline-block';
    setStatus('Окружение применено!');
    logGeneration('Окружение', location.origin + imagePath, balBefore);
  } catch (e) { setStatus('Ошибка: ' + e.message); }
  finally { setLoading(false); }
});

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
      body: JSON.stringify({ imageBase64 }),
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
  document.getElementById('btn-save-obraz-left').style.display = isScene ? 'none' : '';
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

  const gender = genderSelect?.value || 'female';
  const name   = nameInput.value.trim() || randomName(gender);
  saveObraz(imgPath, selectedLbPath, selectedEnvPath, name, gender);
  loadObrazы();
  setStatus(`Образ «${name}» сохранён!`);
});

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
    genBtn.addEventListener('click', async () => {
      const prompt = asset.presetVal;
      if (!prompt) { setStatus('Выберите вариант в столбце ПРЕСЕТ.'); return; }
      const activePath = generatedImagePath;
      if (!activePath) { setStatus('Нет активного изображения.'); return; }

      genBtn.disabled = true; genBtn.textContent = '…';
      setStatus('Генерирую с ассетом…');

      try {
        const r = await fetch('/api/asset-interact/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ activePath, assetPath: asset.path, prompt }),
        });
        const d = await r.json();
        if (!d.success) throw new Error(d.error);

        // Poll until done, then show in active image
        const imagePath = await pollUntilDone(`/api/asset-interact/status/${d.taskId}`, 'Ассет');
        generatedImagePath = imagePath;
        showFace(imagePath + '?t=' + Date.now());
        refineSection.style.display = 'block';
        btnSaveChar.style.display   = 'inline-block';
        saveAppState();
        setStatus('Готово! Результат в активном изображении.');
      } catch (e) {
        setStatus('Ошибка генерации: ' + e.message);
      } finally {
        genBtn.disabled = false; genBtn.textContent = 'Генерировать';
      }
    });
    tdGen.appendChild(genBtn);

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
  assetDropZone.style.display = (hasChar && activeAssets.length > 0) ? 'block' : 'none';
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
    refineSection.style.display = 'none';
    btnSaveChar.style.display = 'none';
    faceDropzone.classList.remove('fullbody');
    showFace(d.path + '?t=' + Date.now());
    setStatus('Изображение загружено по ссылке.');
  } catch (err) { setStatus('Ошибка загрузки: ' + err.message); }
});

// ── Init ──────────────────────────────────────────────────────────────────────
restoreAppState();          // restore before loading thumbs so relinkActiveThumbs works
loadCharacterThumbs();
loadLookbookThumbs();
loadEnvironmentThumbs();
