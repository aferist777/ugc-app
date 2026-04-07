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

const statusBar = document.getElementById('status-bar');

function setStatus(msg) { statusBar.textContent = msg; }

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
    if (!d.success || !d.files.length) return;

    charNoItems?.remove();
    charThumbRow.querySelectorAll('.char-thumb').forEach(el => el.remove());

    d.files.forEach(item => {
      if (charThumbRow.querySelector(`[data-path="${item.path}"]`)) return;
      const img = document.createElement('img');
      img.src = item.path;
      img.className = 'char-thumb';
      img.dataset.path = item.path;
      img.title = item.name;
      img.addEventListener('click', () => {
        charThumbRow.querySelectorAll('.char-thumb').forEach(t => t.classList.remove('selected'));
        img.classList.add('selected');
        // Load into face dropzone
        generatedImagePath = item.path;
        currentFaceBlob    = null;
        showFace(item.path + '?t=' + Date.now());
        // Try to extract a readable name from filename
        const parts = item.name.split('_');
        nameInput.value = (parts[0] + (parts[1] ? ' ' + parts[1] : '')).replace(/_/g, ' ');
        refineSection.style.display = 'block';
        btnSaveChar.style.display   = 'inline-block';
        setStatus(`Персонаж загружен: ${item.name}`);
      });
      charThumbRow.prepend(img);
    });
  } catch (e) { console.warn('loadCharacterThumbs:', e.message); }
}

loadCharacterThumbs();

/* ── Environment select thumbnails ── */
const envThumbRow = document.getElementById('env-thumb-row');
const envNoItems  = document.getElementById('env-no-items');
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
        openLightbox(fp);
      });
      envThumbRow.prepend(img);
    });
  } catch (e) { console.warn('loadEnvironmentThumbs:', e.message); }
}

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
  delBtn.title = 'Удалить из галереи';
  delBtn.addEventListener('click', e => {
    e.stopPropagation();
    card.remove();
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
    d.files.forEach(item => grid.appendChild(buildGalleryCard(item)));
  } catch (e) {
    grid.innerHTML = '<div class="gallery-empty">Ошибка загрузки</div>';
  }
}
