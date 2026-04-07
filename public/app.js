/* ════════════════════════════════════════
   TAB SWITCHING (two-level)
   ════════════════════════════════════════ */

function setupTabs(tabListId) {
  const list   = document.getElementById(tabListId);
  if (!list) return;
  const buttons = list.querySelectorAll('[role="tab"]');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      buttons.forEach(b => b.setAttribute('aria-selected', 'false'));
      // deactivate all sibling panels in same group
      buttons.forEach(b => {
        const panel = document.getElementById(b.getAttribute('aria-controls'));
        if (panel) panel.classList.remove('active');
      });
      btn.setAttribute('aria-selected', 'true');
      const target = document.getElementById(btn.getAttribute('aria-controls'));
      if (target) target.classList.add('active');
    });
  });
}

setupTabs('l1-tabs');
setupTabs('l2-char-tabs');
setupTabs('l2-osnovnye-tabs');
setupTabs('l2-skleyka-tabs');
setupTabs('inner-tabs-gallery');
setupTabs('inner-tabs-archive');

// Load gallery when gallery sub-tab opens
document.querySelector('#l2-char-tabs [aria-controls="tab-gallery"]')
  ?.addEventListener('click', () => { loadGalleryChars(); loadGalleryLookbooks(); loadGalleryEnvironments(); });

// Load archive when archive sub-tab opens
document.querySelector('#l2-char-tabs [aria-controls="tab-archive"]')
  ?.addEventListener('click', () => { loadArchive('character'); loadArchive('lookbook'); loadArchive('environment'); });

// Reload individual gallery sub-tabs on click
document.querySelector('#inner-tabs-gallery [aria-controls="tab-g-chars"]')
  ?.addEventListener('click', () => loadGalleryChars());
document.querySelector('#inner-tabs-gallery [aria-controls="tab-g-lb"]')
  ?.addEventListener('click', () => loadGalleryLookbooks());
document.querySelector('#inner-tabs-gallery [aria-controls="tab-g-env"]')
  ?.addEventListener('click', () => loadGalleryEnvironments());

// Reload individual archive sub-tabs on click
document.querySelector('#inner-tabs-archive [aria-controls="tab-a-chars"]')
  ?.addEventListener('click', () => loadArchive('character'));
document.querySelector('#inner-tabs-archive [aria-controls="tab-a-lb"]')
  ?.addEventListener('click', () => loadArchive('lookbook'));
document.querySelector('#inner-tabs-archive [aria-controls="tab-a-env"]')
  ?.addEventListener('click', () => loadArchive('environment'));

/* ════════════════════════════════════════
   RANDOM NAME GENERATOR
   ════════════════════════════════════════ */

const FIRST_NAMES = [
  'Emma','Liam','Olivia','Noah','Ava','Ethan','Sophia','Mason','Isabella','Logan',
  'Mia','Lucas','Charlotte','Aiden','Amelia','Jackson','Harper','Elijah','Evelyn',
  'Sebastian','Abigail','Mateo','Emily','James','Ella','Benjamin','Elizabeth','Carter',
  'Camila','Luke','Luna','Owen','Sofia','Wyatt','Avery','Dylan','Mila','Nathan',
  'Aria','Henry','Scarlett','Ryan','Penelope','Michael','Layla','Alexander','Riley',
  'Daniel','Zoey','Jack','Nora','David','Lily','Joseph','Eleanor','Samuel','Hannah',
];
const LAST_NAMES = [
  'Smith','Johnson','Williams','Brown','Jones','Garcia','Miller','Davis','Wilson',
  'Martinez','Anderson','Taylor','Thomas','Hernandez','Moore','Martin','Jackson',
  'Thompson','White','Lopez','Lee','Gonzalez','Harris','Clark','Lewis','Robinson',
  'Walker','Perez','Hall','Young','Allen','Sanchez','Wright','King','Scott','Green',
  'Baker','Adams','Nelson','Carter','Mitchell','Parker','Collins','Edwards','Stewart',
];
function randomName() {
  const f = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
  const l = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
  return `${f} ${l}`;
}

/* ════════════════════════════════════════
   UTILITIES
   ════════════════════════════════════════ */

const statusBar  = document.getElementById('status-bar');
const balanceBar = document.getElementById('balance-bar');

function setStatus(msg) { statusBar.textContent = msg; }

async function refreshBalance() {
  try {
    const d = await fetch('/api/balance').then(r => r.json());
    if (d.success) {
      balanceBar.textContent = `${d.credits} кр. / $${d.dollars.toFixed(2)}`;
    }
  } catch {}
}

refreshBalance();
setInterval(refreshBalance, 60000);

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onloadend = () => resolve(r.result.split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

/* ── Lightbox ── */
const lightbox       = document.getElementById('lightbox');
const lightboxImg    = document.getElementById('lightbox-img');
function openLightbox(src) { lightboxImg.src = src; lightbox.classList.add('open'); }
function closeLightbox()   { lightbox.classList.remove('open'); lightboxImg.src = ''; }
document.getElementById('lightbox-close').addEventListener('click', closeLightbox);
document.getElementById('lightbox-close-x').addEventListener('click', closeLightbox);
lightbox.addEventListener('click', e => { if (e.target === lightbox) closeLightbox(); });

/* ════════════════════════════════════════
   CHARACTER TAB
   ════════════════════════════════════════ */

const faceDropzone    = document.getElementById('face-dropzone');
const faceInput       = document.getElementById('face-input');
const facePreview     = document.getElementById('face-preview');
const facePlaceholder = document.getElementById('face-placeholder');
const btnDeleteFace   = document.getElementById('btn-delete-face');
const btnRandomFace   = document.getElementById('btn-random-face');
const btnGenerate     = document.getElementById('btn-generate');
const btnSaveChar     = document.getElementById('btn-save-char');
const btnRefine       = document.getElementById('btn-refine');
const refineSection   = document.getElementById('refine-section');
const refineExtra     = document.getElementById('refine-extra');
const nameInput       = document.getElementById('char-name');

let currentFaceBlob    = null;
let generatedImagePath = null;

/* ── Face helpers ── */
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
}

/* ── Face upload events ── */
faceDropzone.addEventListener('click', () => {
  if (!facePreview.style.display || facePreview.style.display === 'none') faceInput.click();
});
facePreview.addEventListener('click', e => { e.stopPropagation(); openLightbox(facePreview.src); });

faceInput.addEventListener('change', () => {
  const file = faceInput.files[0];
  if (!file) return;
  currentFaceBlob = file; generatedImagePath = null;
  refineSection.style.display = 'none';
  btnSaveChar.style.display = 'none';
  showFace(URL.createObjectURL(file));
  nameInput.value = randomName();
  setStatus(`Загружено: ${file.name}`);
});

faceDropzone.addEventListener('dragover', e => { e.preventDefault(); faceDropzone.classList.add('drag-over'); });
faceDropzone.addEventListener('dragleave', () => faceDropzone.classList.remove('drag-over'));
faceDropzone.addEventListener('drop', e => {
  e.preventDefault();
  faceDropzone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (!file || !file.type.startsWith('image/')) return;
  currentFaceBlob = file; generatedImagePath = null;
  refineSection.style.display = 'none';
  btnSaveChar.style.display = 'none';
  showFace(URL.createObjectURL(file));
  nameInput.value = randomName();
  setStatus(`Загружено: ${file.name}`);
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
    showFace(URL.createObjectURL(blob));
    nameInput.value = randomName();
    setStatus('Лицо загружено с thispersondoesnotexist.com');
  } catch (e) { setStatus('Ошибка: ' + e.message); }
  finally { btnRandomFace.disabled = false; }
});

/* ── Generation core ── */
function setLoading(active) {
  btnGenerate.disabled  = active;
  btnRefine.disabled    = active;
  btnRandomFace.disabled = active;
  btnApplyLb.disabled   = active ? true : selectedLbPath === null;
  faceDropzone.style.pointerEvents = active ? 'none' : '';
  faceDropzone.classList.toggle('generating', active);
  if (!active) facePreview.style.opacity = '1';
}

async function pollUntilDone(statusEndpoint) {
  return new Promise((resolve, reject) => {
    const iv = setInterval(async () => {
      try {
        const r = await fetch(statusEndpoint);
        const d = await r.json();
        if (!d.success) { clearInterval(iv); reject(new Error(d.error)); return; }
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
  try {
    const r = await fetch('/api/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const d = await r.json();
    if (!d.success) throw new Error(d.error);

    setStatus(d.skinTraits?.length ? `Кожа: ${d.skinTraits.join(', ')}. Генерирую…` : 'Генерирую…');
    const imagePath = await pollUntilDone(`/api/status/${d.taskId}`);

    generatedImagePath = imagePath;
    currentFaceBlob    = null;
    showFace(imagePath + '?t=' + Date.now());
    refineSection.style.display = 'block';
    refineExtra.value = '';
    btnSaveChar.style.display = 'inline-block';
    setStatus('Готово! Нажмите на изображение для просмотра или сохраните.');
  } catch (err) {
    setStatus('Ошибка: ' + err.message);
  } finally {
    setLoading(false);
  }
}

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

/* ── Save character ── */
btnSaveChar.addEventListener('click', async () => {
  if (!generatedImagePath) { setStatus('Нет изображения для сохранения.'); return; }
  btnSaveChar.disabled = true;
  setStatus('Анализирую персонажа и сохраняю…');
  try {
    const r = await fetch('/api/save-character', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imagePath: generatedImagePath, characterName: nameInput.value }),
    });
    const d = await r.json();
    if (!d.success) throw new Error(d.error);
    setStatus(`Сохранено: ${d.filename}`);
    loadCharacterThumbs();
  } catch (e) {
    setStatus('Ошибка сохранения: ' + e.message);
  } finally {
    btnSaveChar.disabled = false;
  }
});

/* ════════════════════════════════════════
   LOOKBOOK APPLY (in character tab)
   ════════════════════════════════════════ */

const lbThumbRow = document.getElementById('lb-thumb-row');
const lbNoItems  = document.getElementById('lb-no-items');
const btnApplyLb = document.getElementById('btn-apply-lb');
let selectedLbPath = null;

async function loadLookbookThumbs() {
  try {
    const d = await fetch('/api/lookbooks').then(r => r.json());
    if (!d.success || !d.files.length) return;
    lbNoItems?.remove();
    lbThumbRow.querySelectorAll('.lb-thumb').forEach(el => el.remove());
    d.files.forEach(fp => {
      if (lbThumbRow.querySelector(`[data-path="${fp}"]`)) return;
      const img = document.createElement('img');
      img.src = fp + '?t=' + Date.now();
      img.className = 'lb-thumb';
      img.dataset.path = fp;
      if (fp === selectedLbPath) img.classList.add('selected');
      img.addEventListener('click', () => {
        lbThumbRow.querySelectorAll('.lb-thumb').forEach(t => t.classList.remove('selected'));
        img.classList.add('selected');
        selectedLbPath = fp;
        btnApplyLb.disabled = false;
      });
      lbThumbRow.prepend(img);
    });
  } catch (e) { console.warn('loadLookbookThumbs:', e.message); }
}

btnApplyLb.addEventListener('click', async () => {
  if (!selectedLbPath) { setStatus('Выберите лукбук.'); return; }

  let characterBase64 = null;
  if (currentFaceBlob) {
    characterBase64 = await blobToBase64(currentFaceBlob);
  } else if (generatedImagePath) {
    const blob = await fetch(generatedImagePath).then(r => r.blob());
    characterBase64 = await blobToBase64(blob);
  } else { setStatus('Загрузите или сгенерируйте персонажа.'); return; }

  setLoading(true);
  setStatus('Применяю лукбук…');
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
    showFace(imagePath + '?t=' + Date.now());
    refineSection.style.display = 'block';
    btnSaveChar.style.display = 'inline-block';
    setStatus('Лукбук применён!');
  } catch (e) { setStatus('Ошибка: ' + e.message); }
  finally { setLoading(false); }
});

loadLookbookThumbs();

/* ── Character select thumbnails ── */
const charThumbRow = document.getElementById('char-thumb-row');
const charNoItems  = document.getElementById('char-no-items');

async function loadCharacterThumbs() {
  try {
    const d = await fetch('/api/gallery/characters').then(r => r.json());
    charNoItems?.remove();
    charThumbRow.querySelectorAll('.char-thumb-wrap').forEach(el => el.remove());
    if (!d.success || !d.files.length) {
      if (!charThumbRow.querySelector('#char-no-items')) {
        const span = document.createElement('span');
        span.id = 'char-no-items';
        span.textContent = 'Нет сохранённых персонажей';
        charThumbRow.appendChild(span);
      }
      return;
    }

    d.files.forEach(item => {
      if (charThumbRow.querySelector(`[data-path="${item.path}"]`)) return;

      const wrap = document.createElement('div');
      wrap.className = 'char-thumb-wrap';
      wrap.style.cssText = 'position:relative;flex-shrink:0;';

      const img = document.createElement('img');
      img.src = item.path;
      img.className = 'char-thumb';
      img.dataset.path = item.path;
      img.title = item.name;
      img.addEventListener('click', () => {
        charThumbRow.querySelectorAll('.char-thumb').forEach(t => t.classList.remove('selected'));
        img.classList.add('selected');
        generatedImagePath = item.path;
        currentFaceBlob    = null;
        showFace(item.path + '?t=' + Date.now());
        const parts = item.name.split('_');
        nameInput.value = (parts[0] + (parts[1] ? ' ' + parts[1] : '')).replace(/_/g, ' ');
        refineSection.style.display = 'block';
        btnSaveChar.style.display   = 'inline-block';
        setStatus(`Персонаж загружен: ${item.name}`);
      });

      const archBtn = document.createElement('button');
      archBtn.textContent = '✕';
      archBtn.title = 'В архив';
      archBtn.style.cssText = 'position:absolute;top:0;right:0;width:14px;height:14px;font-size:8px;padding:0;line-height:1;display:none;background:#c0c0c0;color:#aa0000;font-weight:bold;';
      wrap.addEventListener('mouseenter', () => archBtn.style.display = 'block');
      wrap.addEventListener('mouseleave', () => archBtn.style.display = 'none');
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

      wrap.appendChild(img);
      wrap.appendChild(archBtn);
      charThumbRow.prepend(wrap);
    });
  } catch (e) { console.warn('loadCharacterThumbs:', e.message); }
}

loadCharacterThumbs();

/* ── Environment select thumbnails ── */
const envThumbRow  = document.getElementById('env-thumb-row');
const envNoItems   = document.getElementById('env-no-items');
const btnApplyEnv  = document.getElementById('btn-apply-env');
let selectedEnvPath = null;

async function loadEnvironmentThumbs() {
  try {
    const d = await fetch('/api/environments').then(r => r.json());
    if (!d.success || !d.files.length) return;
    envNoItems?.remove();
    envThumbRow.querySelectorAll('.env-thumb').forEach(el => el.remove());
    d.files.forEach(fp => {
      if (envThumbRow.querySelector(`[data-path="${fp}"]`)) return;
      const img = document.createElement('img');
      img.src = fp + '?t=' + Date.now();
      img.className = 'env-thumb';
      img.dataset.path = fp;
      if (fp === selectedEnvPath) img.classList.add('selected');
      img.addEventListener('click', () => {
        envThumbRow.querySelectorAll('.env-thumb').forEach(t => t.classList.remove('selected'));
        img.classList.add('selected');
        selectedEnvPath = fp;
        if (btnApplyEnv) btnApplyEnv.disabled = false;
      });
      envThumbRow.prepend(img);
    });
  } catch (e) { console.warn('loadEnvironmentThumbs:', e.message); }
}

btnApplyEnv?.addEventListener('click', async () => {
  if (!selectedEnvPath) { setStatus('Выберите окружение.'); return; }

  let characterBase64 = null;
  if (currentFaceBlob) {
    characterBase64 = await blobToBase64(currentFaceBlob);
  } else if (generatedImagePath) {
    const blob = await fetch(generatedImagePath).then(r => r.blob());
    characterBase64 = await blobToBase64(blob);
  } else { setStatus('Загрузите или сгенерируйте персонажа.'); return; }

  setLoading(true);
  setStatus('Применяю окружение…');
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
    showFace(imagePath + '?t=' + Date.now());
    refineSection.style.display = 'block';
    btnSaveChar.style.display = 'inline-block';
    setStatus('Окружение применено!');
  } catch (e) { setStatus('Ошибка: ' + e.message); }
  finally { setLoading(false); }
});

loadEnvironmentThumbs();

/* ════════════════════════════════════════
   LOOKBOOK TAB
   ════════════════════════════════════════ */

const lbDropzone    = document.getElementById('lb-dropzone');
const lbInput       = document.getElementById('lb-input');
const lbPreview     = document.getElementById('lb-preview');
const lbPlaceholder = document.getElementById('lb-placeholder');
const btnLbDelete   = document.getElementById('btn-lb-delete');
const btnLbGenerate = document.getElementById('btn-lb-generate');
const lbGrid        = document.getElementById('lb-grid');
let lbBlob = null;

function lbShowImg(src) {
  lbPreview.src = src; lbPreview.style.display = 'block';
  lbPlaceholder.style.display = 'none'; btnLbDelete.style.display = 'inline-block';
}
function lbClear() {
  lbPreview.src = ''; lbPreview.style.display = 'none';
  lbPlaceholder.style.display = 'block'; btnLbDelete.style.display = 'none';
  lbInput.value = ''; lbBlob = null;
}

lbDropzone.addEventListener('click', () => { if (!lbPreview.style.display || lbPreview.style.display === 'none') lbInput.click(); });
lbPreview.addEventListener('click', e => { e.stopPropagation(); openLightbox(lbPreview.src); });
lbInput.addEventListener('change', () => {
  const f = lbInput.files[0]; if (!f) return;
  lbBlob = f; lbShowImg(URL.createObjectURL(f)); setStatus(`Загружено: ${f.name}`);
});
lbDropzone.addEventListener('dragover', e => { e.preventDefault(); lbDropzone.classList.add('drag-over'); });
lbDropzone.addEventListener('dragleave', () => lbDropzone.classList.remove('drag-over'));
lbDropzone.addEventListener('drop', e => {
  e.preventDefault(); lbDropzone.classList.remove('drag-over');
  const f = e.dataTransfer.files[0]; if (!f || !f.type.startsWith('image/')) return;
  lbBlob = f; lbShowImg(URL.createObjectURL(f)); setStatus(`Загружено: ${f.name}`);
});
btnLbDelete.addEventListener('click', e => { e.stopPropagation(); lbClear(); setStatus('Удалено.'); });

function lbAddCard(id) {
  document.getElementById('lb-empty')?.remove();
  const card = document.createElement('div');
  card.className = 'lb-card pending'; card.id = `lb-card-${id}`;
  lbGrid.appendChild(card);
}
function lbCardDone(id, imgPath) {
  const card = document.getElementById(`lb-card-${id}`);
  if (!card) return;
  card.classList.remove('pending');
  const img = document.createElement('img');
  img.src = imgPath + '?t=' + Date.now();
  img.addEventListener('click', () => openLightbox(img.src));
  card.appendChild(img);
}
function lbCardError(id) {
  const card = document.getElementById(`lb-card-${id}`);
  if (card) { card.classList.remove('pending'); card.textContent = 'Ошибка'; card.style.color = '#aa0000'; }
}

btnLbGenerate.addEventListener('click', async () => {
  if (!lbBlob) { setStatus('Загрузите изображение.'); return; }
  btnLbGenerate.disabled = true;
  lbDropzone.classList.add('generating');
  const clothingId = Date.now();
  const bgId = clothingId + 1;
  lbAddCard(clothingId);
  lbAddCard(bgId);
  setStatus('Генерирую лукбук и фон…');
  try {
    const base64 = await blobToBase64(lbBlob);
    const r = await fetch('/api/lookbook/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64: base64 }),
    });
    const d = await r.json();
    if (!d.success) throw new Error(d.error);

    function pollTask(taskId, statusEndpoint, cardId, label) {
      return new Promise((resolve, reject) => {
        const iv = setInterval(async () => {
          try {
            const sr = await fetch(statusEndpoint);
            const sd = await sr.json();
            if (!sd.success) { clearInterval(iv); lbCardError(cardId); reject(new Error(sd.error)); return; }
            if (sd.state === 'success') { clearInterval(iv); lbCardDone(cardId, sd.imagePath); resolve(sd.imagePath); }
            else if (sd.state === 'failed') { clearInterval(iv); lbCardError(cardId); reject(new Error(sd.error || 'Ошибка')); }
            else { setStatus(`${label}: ${sd.state}…`); }
          } catch (e) { clearInterval(iv); lbCardError(cardId); reject(e); }
        }, 3000);
      });
    }

    await Promise.all([
      pollTask(d.clothingTaskId, `/api/lookbook/status/${d.clothingTaskId}`, clothingId, 'Одежда'),
      pollTask(d.bgTaskId,       `/api/environment/status/${d.bgTaskId}`,    bgId,       'Фон'),
    ]);

    setStatus('Лукбук и фон готовы!');
    loadLookbookThumbs();
    loadEnvironmentThumbs();
  } catch (e) { setStatus('Ошибка: ' + e.message); }
  finally { btnLbGenerate.disabled = false; lbDropzone.classList.remove('generating'); }
});

/* ════════════════════════════════════════
   GALLERY TAB
   ════════════════════════════════════════ */

function buildGalleryCard(item) {
  const card = document.createElement('div');
  card.className = 'gallery-card';

  const wrap = document.createElement('div');
  wrap.className = 'g-img-wrap';

  const img = document.createElement('img');
  img.src = item.path;
  img.addEventListener('click', () => openLightbox(item.path));

  const delBtn = document.createElement('button');
  delBtn.className = 'g-delete';
  delBtn.textContent = '✕';
  delBtn.title = 'В архив';
  delBtn.addEventListener('click', async e => {
    e.stopPropagation();
    try {
      const r = await fetch('/api/gallery/archive', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: item.path }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error);
      card.remove();
    } catch (err) { setStatus('Ошибка архивации: ' + err.message); }
  });

  wrap.appendChild(img);
  wrap.appendChild(delBtn);

  const name = document.createElement('div');
  name.className = 'g-name';
  name.textContent = item.name;

  card.appendChild(wrap);
  card.appendChild(name);
  return card;
}

function buildArchiveCard(item) {
  const card = document.createElement('div');
  card.className = 'gallery-card';

  const wrap = document.createElement('div');
  wrap.className = 'g-img-wrap';

  const img = document.createElement('img');
  img.src = item.path;
  img.addEventListener('click', () => openLightbox(item.path));

  const restoreBtn = document.createElement('button');
  restoreBtn.className = 'g-delete';
  restoreBtn.textContent = '↩';
  restoreBtn.title = 'Восстановить';
  restoreBtn.style.cssText = 'color:#007000;right:18px;';
  restoreBtn.addEventListener('click', async e => {
    e.stopPropagation();
    try {
      const r = await fetch('/api/gallery/restore', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: item.path }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error);
      card.remove();
      setStatus(`Восстановлено: ${item.name}`);
    } catch (err) { setStatus('Ошибка восстановления: ' + err.message); }
  });

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'g-delete';
  deleteBtn.textContent = '✕';
  deleteBtn.title = 'Удалить навсегда';
  deleteBtn.style.color = '#aa0000';
  deleteBtn.addEventListener('click', async e => {
    e.stopPropagation();
    if (!confirm(`Удалить навсегда: ${item.name}?`)) return;
    try {
      const r = await fetch('/api/archive/delete', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: item.path }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error);
      card.remove();
      setStatus(`Удалено: ${item.name}`);
    } catch (err) { setStatus('Ошибка удаления: ' + err.message); }
  });

  wrap.appendChild(img);
  wrap.appendChild(restoreBtn);
  wrap.appendChild(deleteBtn);

  const name = document.createElement('div');
  name.className = 'g-name';
  name.textContent = item.name;

  card.appendChild(wrap);
  card.appendChild(name);
  return card;
}

async function loadGalleryChars() {
  const grid = document.getElementById('gallery-chars-grid');
  try {
    const d = await fetch('/api/gallery/characters').then(r => r.json());
    grid.innerHTML = '';
    if (!d.files.length) { grid.innerHTML = '<div class="gallery-empty">Сохранённых персонажей нет</div>'; return; }
    d.files.forEach(item => grid.appendChild(buildGalleryCard(item)));
  } catch (e) { grid.innerHTML = '<div class="gallery-empty">Ошибка загрузки</div>'; }
}

async function loadGalleryLookbooks() {
  const grid = document.getElementById('gallery-lb-grid');
  try {
    const d = await fetch('/api/gallery/lookbooks').then(r => r.json());
    grid.innerHTML = '';
    if (!d.files.length) { grid.innerHTML = '<div class="gallery-empty">Лукбуков нет</div>'; return; }
    d.files.forEach(item => grid.appendChild(buildGalleryCard(item)));
  } catch (e) { grid.innerHTML = '<div class="gallery-empty">Ошибка загрузки</div>'; }
}

async function loadGalleryEnvironments() {
  const grid = document.getElementById('gallery-env-grid');
  try {
    const d = await fetch('/api/gallery/environments').then(r => r.json());
    grid.innerHTML = '';
    if (!d.files.length) { grid.innerHTML = '<div class="gallery-empty">Окружений нет</div>'; return; }
    d.files.forEach(item => grid.appendChild(buildGalleryCard(item)));
  } catch (e) { grid.innerHTML = '<div class="gallery-empty">Ошибка загрузки</div>'; }
}

/* ════════════════════════════════════════
   ARCHIVE TAB
   ════════════════════════════════════════ */

const ARCHIVE_GRID_IDS = {
  character:   'archive-chars-grid',
  lookbook:    'archive-lb-grid',
  environment: 'archive-env-grid',
};
const ARCHIVE_EMPTY_MSG = {
  character:   'Архив персонажей пуст',
  lookbook:    'Архив лукбуков пуст',
  environment: 'Архив окружений пуст',
};

async function loadArchive(subfolder) {
  const gridId = ARCHIVE_GRID_IDS[subfolder];
  const grid   = document.getElementById(gridId);
  if (!grid) return;
  try {
    const d = await fetch(`/api/archive/${subfolder}`).then(r => r.json());
    grid.innerHTML = '';
    if (!d.files || !d.files.length) {
      grid.innerHTML = `<div class="gallery-empty">${ARCHIVE_EMPTY_MSG[subfolder]}</div>`;
      return;
    }
    d.files.forEach(item => grid.appendChild(buildArchiveCard(item)));
  } catch (e) {
    grid.innerHTML = '<div class="gallery-empty">Ошибка загрузки</div>';
  }
}

/* ════════════════════════════════════════
   SCENARIOS TAB
   ════════════════════════════════════════ */

const scenarioDropzone  = document.getElementById('scenario-dropzone');
const scenarioInput     = document.getElementById('scenario-input');
const scenarioFileLabel = document.getElementById('scenario-file-label');
const scenarioNameInput = document.getElementById('scenario-name');
const btnScenarioUpload = document.getElementById('btn-scenario-upload');
const scenarioList      = document.getElementById('scenario-list');
let scenarioBlob = null;

scenarioDropzone?.addEventListener('click', () => scenarioInput?.click());
scenarioDropzone?.addEventListener('dragover', e => { e.preventDefault(); scenarioDropzone.classList.add('drag-over'); });
scenarioDropzone?.addEventListener('dragleave', () => scenarioDropzone.classList.remove('drag-over'));
scenarioDropzone?.addEventListener('drop', e => {
  e.preventDefault(); scenarioDropzone.classList.remove('drag-over');
  const f = e.dataTransfer.files[0];
  if (!f || !f.name.endsWith('.txt')) { setStatus('Только .txt файлы.'); return; }
  scenarioBlob = f;
  scenarioFileLabel.textContent = f.name;
  scenarioDropzone.classList.add('has-file');
  btnScenarioUpload.disabled = false;
});
scenarioInput?.addEventListener('change', () => {
  const f = scenarioInput.files[0];
  if (!f) return;
  scenarioBlob = f;
  scenarioFileLabel.textContent = f.name;
  scenarioDropzone.classList.add('has-file');
  btnScenarioUpload.disabled = false;
});

btnScenarioUpload?.addEventListener('click', async () => {
  if (!scenarioBlob) return;
  btnScenarioUpload.disabled = true;
  setStatus('Загружаю сценарий…');
  try {
    const base64 = await blobToBase64(scenarioBlob);
    const name = scenarioNameInput.value.trim();
    const r = await fetch('/api/scenarios/upload', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ textBase64: base64, name }),
    });
    const d = await r.json();
    if (!d.success) throw new Error(d.error);
    setStatus(`Сценарий сохранён: ${d.name}`);
    // reset
    scenarioBlob = null;
    scenarioFileLabel.textContent = 'Нажмите или перетащите .txt файл';
    scenarioDropzone.classList.remove('has-file');
    scenarioNameInput.value = '';
    scenarioInput.value = '';
    loadScenarios();
  } catch (e) { setStatus('Ошибка: ' + e.message); }
  finally { btnScenarioUpload.disabled = false; }
});

// key: scenarioFile__lineIndex → detail filename
let scenarioAssignments = {};

async function loadScenarioAssignments() {
  try {
    const d = await fetch('/api/scenarios/assignments').then(r => r.json());
    if (d.success) scenarioAssignments = d.assignments;
  } catch {}
}

async function saveScenarioAssignments() {
  await fetch('/api/scenarios/assignments', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assignments: scenarioAssignments }),
  });
}

function buildScenarioItem(file, detailFiles) {
  const item = document.createElement('div');
  item.className = 'scenario-item';

  const header = document.createElement('div');
  header.className = 'scenario-item-header';

  const delBtn = document.createElement('button');
  delBtn.className = 'scenario-del-btn';
  delBtn.textContent = '🗑';
  delBtn.title = 'Удалить сценарий';
  delBtn.addEventListener('click', async e => {
    e.stopPropagation();
    if (!confirm(`Удалить сценарий «${file.name}»?`)) return;
    try {
      const r = await fetch('/api/scenarios/delete', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.file }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error);
      item.remove();
      setStatus(`Удалено: ${file.name}`);
    } catch (err) { setStatus('Ошибка: ' + err.message); }
  });

  const toggle = document.createElement('span');
  toggle.className = 'scenario-toggle';
  toggle.textContent = '▶';

  const title = document.createElement('span');
  title.className = 'scenario-title';
  title.textContent = file.name;

  header.appendChild(delBtn);
  header.appendChild(toggle);
  header.appendChild(title);

  const body = document.createElement('div');
  body.className = 'scenario-body';
  let loaded = false;

  header.addEventListener('click', async () => {
    const open = body.classList.toggle('open');
    toggle.textContent = open ? '▼' : '▶';
    if (open && !loaded) {
      body.innerHTML = '<span style="font-size:11px;color:#888;">Загрузка…</span>';
      try {
        const d = await fetch(`/api/scenarios/${encodeURIComponent(file.file)}`).then(r => r.json());
        body.innerHTML = '';

        // save button
        const saveRow = document.createElement('div');
        saveRow.style.cssText = 'margin-bottom:6px;';
        const saveBtn = document.createElement('button');
        saveBtn.textContent = '💾 Сохранить назначения';
        saveBtn.style.fontSize = '11px';
        saveBtn.addEventListener('click', async () => {
          saveBtn.disabled = true;
          await saveScenarioAssignments();
          setStatus('Назначения сохранены.');
          saveBtn.disabled = false;
        });
        saveRow.appendChild(saveBtn);
        body.appendChild(saveRow);

        d.lines.forEach((line, i) => {
          const row = document.createElement('div');
          row.className = 'scenario-line';

          const num = document.createElement('span');
          num.className = 'scenario-line-num';
          num.textContent = i + 1;

          const text = document.createElement('span');
          text.className = 'scenario-line-text';
          text.textContent = line;

          // detail select
          const sel = document.createElement('select');
          sel.className = 'scenario-detail-select';
          const blankOpt = document.createElement('option');
          blankOpt.value = '';
          blankOpt.textContent = '— предмет —';
          sel.appendChild(blankOpt);
          detailFiles.forEach(df => {
            const opt = document.createElement('option');
            opt.value = df.file;
            opt.textContent = df.name;
            sel.appendChild(opt);
          });
          const assignKey = `${file.file}__${i}`;
          if (scenarioAssignments[assignKey]) sel.value = scenarioAssignments[assignKey];
          sel.addEventListener('change', () => {
            scenarioAssignments[assignKey] = sel.value;
          });

          row.appendChild(num);
          row.appendChild(text);
          row.appendChild(sel);
          body.appendChild(row);
        });
        loaded = true;
      } catch (e) { body.textContent = 'Ошибка загрузки'; }
    }
  });

  item.appendChild(header);
  item.appendChild(body);
  return item;
}

async function loadScenarios() {
  if (!scenarioList) return;
  try {
    const [sd, dd] = await Promise.all([
      fetch('/api/scenarios').then(r => r.json()),
      fetch('/api/details').then(r => r.json()),
    ]);
    await loadScenarioAssignments();
    scenarioList.innerHTML = '';
    if (!sd.files.length) {
      scenarioList.innerHTML = '<div style="color:#888;font-size:11px;">Нет сценариев</div>';
      return;
    }
    const detailFiles = dd.success ? dd.files : [];
    sd.files.forEach(f => scenarioList.appendChild(buildScenarioItem(f, detailFiles)));
  } catch (e) { scenarioList.innerHTML = '<div style="color:#888;font-size:11px;">Ошибка загрузки</div>'; }
}

// Manual text input
const btnScenarioManual = document.getElementById('btn-scenario-manual-upload');
btnScenarioManual?.addEventListener('click', async () => {
  const text = document.getElementById('scenario-manual-text')?.value.trim();
  if (!text) { setStatus('Введите текст сценария.'); return; }
  btnScenarioManual.disabled = true;
  setStatus('Сохраняю сценарий…');
  try {
    const base64 = btoa(unescape(encodeURIComponent(text)));
    const name = document.getElementById('scenario-manual-name')?.value.trim();
    const r = await fetch('/api/scenarios/upload', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ textBase64: base64, name }),
    });
    const d = await r.json();
    if (!d.success) throw new Error(d.error);
    setStatus(`Сценарий сохранён: ${d.name}`);
    document.getElementById('scenario-manual-text').value = '';
    document.getElementById('scenario-manual-name').value = '';
    loadScenarios();
  } catch (e) { setStatus('Ошибка: ' + e.message); }
  finally { btnScenarioManual.disabled = false; }
});

// Load when Сценарии tab opens
document.querySelector('#l2-osnovnye-tabs [aria-controls="tab-scenarii"]')
  ?.addEventListener('click', () => loadScenarios());

loadScenarios();

/* ════════════════════════════════════════
   БИРОЛЫ TAB
   ════════════════════════════════════════ */

document.querySelectorAll('.biroly-slot').forEach(slot => {
  slot.addEventListener('click', () => slot.classList.toggle('selected'));
});

/* ════════════════════════════════════════
   DETAILS TAB (Предметы)
   ════════════════════════════════════════ */

const detailDropzone    = document.getElementById('detail-dropzone');
const detailInput       = document.getElementById('detail-input');
const detailPreview     = document.getElementById('detail-preview');
const detailPlaceholder = document.getElementById('detail-placeholder');
const btnDetailDelete   = document.getElementById('btn-detail-delete');
const btnDetailUpload   = document.getElementById('btn-detail-upload');
const detailNameInput   = document.getElementById('detail-name');
const detailsGrid       = document.getElementById('details-grid');
let detailBlob = null;

function detailShowImg(src) {
  detailPreview.src = src; detailPreview.style.display = 'block';
  detailPlaceholder.style.display = 'none'; btnDetailDelete.style.display = 'inline-block';
}
function detailClear() {
  detailPreview.src = ''; detailPreview.style.display = 'none';
  detailPlaceholder.style.display = 'block'; btnDetailDelete.style.display = 'none';
  detailInput.value = ''; detailBlob = null; btnDetailUpload.disabled = true;
}

detailDropzone?.addEventListener('click', () => { if (!detailPreview.style.display || detailPreview.style.display === 'none') detailInput?.click(); });
detailPreview?.addEventListener('click', e => { e.stopPropagation(); openLightbox(detailPreview.src); });
detailDropzone?.addEventListener('dragover', e => { e.preventDefault(); detailDropzone.classList.add('drag-over'); });
detailDropzone?.addEventListener('dragleave', () => detailDropzone.classList.remove('drag-over'));
detailDropzone?.addEventListener('drop', e => {
  e.preventDefault(); detailDropzone.classList.remove('drag-over');
  const f = e.dataTransfer.files[0]; if (!f || !f.type.startsWith('image/')) return;
  detailBlob = f; detailShowImg(URL.createObjectURL(f)); btnDetailUpload.disabled = false;
});
detailInput?.addEventListener('change', () => {
  const f = detailInput.files[0]; if (!f) return;
  detailBlob = f; detailShowImg(URL.createObjectURL(f)); btnDetailUpload.disabled = false;
});
btnDetailDelete?.addEventListener('click', e => { e.stopPropagation(); detailClear(); });

btnDetailUpload?.addEventListener('click', async () => {
  if (!detailBlob) return;
  btnDetailUpload.disabled = true;
  setStatus('Сохраняю предмет…');
  try {
    const base64 = await blobToBase64(detailBlob);
    const name = detailNameInput.value.trim();
    const r = await fetch('/api/details/upload', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64: base64, name }),
    });
    const d = await r.json();
    if (!d.success) throw new Error(d.error);
    setStatus(`Предмет сохранён: ${d.name}`);
    detailClear();
    detailNameInput.value = '';
    loadDetails();
  } catch (e) { setStatus('Ошибка: ' + e.message); }
  finally { btnDetailUpload.disabled = false; }
});

async function loadDetails() {
  if (!detailsGrid) return;
  try {
    const d = await fetch('/api/details').then(r => r.json());
    detailsGrid.innerHTML = '';
    if (!d.files.length) { detailsGrid.innerHTML = '<div class="gallery-empty">Нет предметов</div>'; return; }
    d.files.forEach(item => detailsGrid.appendChild(buildGalleryCard(item)));
  } catch (e) { detailsGrid.innerHTML = '<div class="gallery-empty">Ошибка загрузки</div>'; }
}

document.querySelector('#l2-osnovnye-tabs [aria-controls="tab-predmety"]')
  ?.addEventListener('click', () => loadDetails());

loadDetails();
