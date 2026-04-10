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
const btnSaveObraz    = document.getElementById('btn-save-obraz');
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

let currentFaceBlob    = null;
let generatedImagePath = null;
let selectedLbPath     = null;
let selectedEnvPath    = null;

// ── Face helpers ──────────────────────────────────────────────────────────────
function showFace(src) {
  facePreview.src = src;
  facePreview.style.display = 'block';
  facePlaceholder.style.display = 'none';
  btnDeleteFace.style.display = 'inline-block';
}
function clearFace() {
  facePreview.src = '';
  facePreview.style.display = 'none';
  facePlaceholder.style.display = 'block';
  btnDeleteFace.style.display = 'none';
  faceInput.value = '';
  currentFaceBlob    = null;
  generatedImagePath = null;
  refineSection.style.display = 'none';
  refineExtra.value  = '';
  btnSaveChar.style.display = 'none';
  faceDropzone.classList.remove('fullbody');
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
  nameInput.value = randomName();
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
    nameInput.value = randomName();
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

function pollUntilDone(statusEndpoint) {
  return new Promise((resolve, reject) => {
    const iv = setInterval(async () => {
      try {
        const r = await fetch(statusEndpoint);
        const d = await r.json();
        if (!d.success)            { clearInterval(iv); reject(new Error(d.error)); return; }
        if (d.state === 'success') { clearInterval(iv); resolve(d.imagePath); }
        else if (d.state === 'failed') { clearInterval(iv); reject(new Error(d.error || 'Ошибка')); }
        else { setStatus(`Генерация… (${d.state})`); }
      } catch (e) { clearInterval(iv); reject(e); }
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
    const imagePath = await pollUntilDone(`/api/status/${d.taskId}`);

    generatedImagePath = imagePath; currentFaceBlob = null;
    showFace(imagePath + '?t=' + Date.now());
    refineSection.style.display = 'block';
    refineExtra.value = '';
    btnSaveChar.style.display = 'inline-block';
    setStatus('Готово!');
    logGeneration(payload.extraInstruction ? 'Уточнение' : 'Генерация', location.origin + imagePath, balBefore);
  } catch (err) {
    setStatus('Ошибка: ' + err.message);
  } finally {
    setLoading(false);
  }
}

// ── Generate & Refine ─────────────────────────────────────────────────────────
btnGenerate.addEventListener('click', async () => {
  if (!currentFaceBlob) { setStatus('Загрузите лицо персонажа.'); return; }
  const faceBase64 = await blobToBase64(currentFaceBlob);
  runGeneration(
    { age: document.getElementById('age').value, gender: document.getElementById('gender').value, faceBase64 },
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
      img.src = item.thumbPath || item.path; img.className = 'char-thumb'; img.dataset.path = item.path; img.title = item.name;
      img.addEventListener('click', () => {
        charThumbRow.querySelectorAll('.char-thumb').forEach(t => t.classList.remove('selected'));
        img.classList.add('selected');
        generatedImagePath = item.path; currentFaceBlob = null;
        showFace(item.path + '?t=' + Date.now());
        const parts = item.name.split('_');
        nameInput.value = (parts[0] + (parts[1] ? ' ' + parts[1] : '')).replace(/_/g, ' ');
        refineSection.style.display = 'block';
        btnSaveChar.style.display   = 'inline-block';
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
      img.src = (item.thumbPath || fp) + '?t=' + Date.now(); img.className = 'lb-thumb'; img.dataset.path = fp;
      if (fp === selectedLbPath) img.classList.add('selected');
      img.addEventListener('click', () => {
        lbThumbRow.querySelectorAll('.lb-thumb').forEach(t => t.classList.remove('selected'));
        img.classList.add('selected');
        selectedLbPath = fp; btnApplyLb.disabled = false;
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
      img.addEventListener('click', () => {
        envThumbRow.querySelectorAll('.env-thumb').forEach(t => t.classList.remove('selected'));
        img.classList.add('selected');
        selectedEnvPath = fp; if (btnApplyEnv) btnApplyEnv.disabled = false;
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
    const imagePath = await pollUntilDone(`/api/apply-lookbook/status/${d.taskId}`);
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
    const imagePath = await pollUntilDone(`/api/apply-environment/status/${d.taskId}`);
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
  if (!currentFaceBlob && !generatedImagePath) {
    setStatus('Загрузите лицо или сгенерируйте персонажа.'); return;
  }

  let imageBase64;
  if (currentFaceBlob) {
    imageBase64 = await blobToBase64(currentFaceBlob);
  } else {
    imageBase64 = await blobToBase64(await fetch(generatedImagePath).then(r => r.blob()));
  }

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

// ── Сохобраз: save current char + lb + env combination ───────────────────────
btnSaveObraz?.addEventListener('click', () => {
  if (!generatedImagePath) { setStatus('Нет изображения персонажа.'); return; }
  saveObraz(generatedImagePath, selectedLbPath, selectedEnvPath, nameInput.value);
  setStatus('Образ сохранён в базу данных!');
});

// ── Init ──────────────────────────────────────────────────────────────────────
loadCharacterThumbs();
loadLookbookThumbs();
loadEnvironmentThumbs();
