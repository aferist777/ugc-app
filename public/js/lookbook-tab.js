/* ═══════════════════════════════════════════════════════
   LOOKBOOK TAB — generate, show results with checkboxes
   ═══════════════════════════════════════════════════════ */

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

/* ── Result cards ────────────────────────────────────────────────── */
function lbAddCard(id, type) {
  document.getElementById('lb-empty')?.remove();
  document.getElementById('lb-add-to-db-btn')?.remove();

  const wrap = document.createElement('div');
  wrap.className = 'lb-result-wrap';
  wrap.id = `lb-wrap-${id}`;
  wrap.dataset.type = type;

  const typeLabel = document.createElement('div');
  typeLabel.className = 'lb-result-label';
  typeLabel.textContent = type === 'clothing' ? '👗 Одежда'
    : type === 'tpose'   ? '🧍 T-pose'
    : type === 'environment' ? '🖼 Окружение'
    : '🖼 Фон';
  wrap.appendChild(typeLabel);

  const card = document.createElement('div');
  card.className = 'lb-card pending';
  card.id = `lb-card-${id}`;
  wrap.appendChild(card);

  const cbLabel = document.createElement('label');
  cbLabel.className = 'lb-result-check';
  const cb = document.createElement('input');
  cb.type = 'checkbox'; cb.checked = true; cb.className = 'lb-result-cb';
  cbLabel.appendChild(cb);
  cbLabel.appendChild(document.createTextNode(' Добавить в базу'));
  wrap.appendChild(cbLabel);

  lbGrid.appendChild(wrap);
}

function lbCardDone(id, imgPath) {
  const card = document.getElementById(`lb-card-${id}`);
  const wrap = document.getElementById(`lb-wrap-${id}`);
  if (!card) return;
  card.classList.remove('pending');
  const img = document.createElement('img');
  img.src = toThumbPath(imgPath) + '?t=' + Date.now();
  img.title = 'Нажмите для увеличения';
  img.addEventListener('click', () => openLightbox(imgPath));
  card.appendChild(img);
  if (wrap) wrap.dataset.path = imgPath;
}

function lbCardError(id, errorMsg, retryFn) {
  const card = document.getElementById(`lb-card-${id}`);
  if (!card) return;
  card.classList.remove('pending');
  card.innerHTML = '';
  const btn = document.createElement('button');
  btn.className = 'lb-retry-btn';
  btn.textContent = '↺';
  btn.title = errorMsg || 'Ошибка — нажмите для повтора';
  btn.addEventListener('click', () => {
    card.classList.add('pending');
    card.innerHTML = '';
    retryFn?.().catch(() => {});
  });
  card.appendChild(btn);
}

function pollTask(taskId, statusEndpoint, cardId, label) {
  function startPolling() {
    return new Promise((resolve, reject) => {
      const iv = setInterval(async () => {
        try {
          const sr = await fetch(statusEndpoint);
          const sd = await sr.json();
          if (!sd.success) {
            clearInterval(iv);
            const msg = sd.error || 'Ошибка сервера';
            lbCardError(cardId, msg, startPolling);
            logError(label, msg);
            reject(new Error(msg));
            return;
          }
          if (sd.state === 'success') {
            clearInterval(iv); lbCardDone(cardId, sd.imagePath); resolve(sd.imagePath);
          } else if (sd.state === 'failed') {
            clearInterval(iv);
            const msg = sd.error || 'Задача завершилась с ошибкой';
            lbCardError(cardId, msg, startPolling);
            logError(label, msg);
            reject(new Error(msg));
          } else { setStatus(`${label}: ${sd.state}…`); }
        } catch (e) {
          clearInterval(iv);
          lbCardError(cardId, e.message, startPolling);
          logError(label, e.message);
          reject(e);
        }
      }, 3000);
    });
  }
  return startPolling();
}

function showAddToDbButton() {
  const btn = document.createElement('button');
  btn.id = 'lb-add-to-db-btn';
  btn.textContent = '✚ Добавить отмеченное в базу';
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    const wraps = [...lbGrid.querySelectorAll('.lb-result-wrap')];
    const items = wraps.map(w => ({
      path:    w.dataset.path,
      checked: w.querySelector('.lb-result-cb')?.checked ?? true,
    }));

    // Archive unchecked items that have a saved path
    for (const { path, checked } of items) {
      if (!path || checked) continue;
      try {
        await fetch('/api/gallery/archive', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filePath: path }),
        });
      } catch {}
    }

    // Refresh all asset thumb rows so approved items appear immediately in the left column
    loadCharacterThumbs?.();
    loadLookbookThumbs?.();
    loadEnvironmentThumbs?.();

    // Reset grid
    lbGrid.innerHTML = '<div id="lb-empty">Загрузите изображение и нажмите «Сгенерировать»</div>';
    btn.remove();
    setStatus('Добавлено в базу!');
  });
  lbGrid.after(btn);
}

/* ── Generate ────────────────────────────────────────────────────── */
btnLbGenerate.addEventListener('click', async () => {
  if (!lbBlob) { setStatus('Загрузите изображение.'); return; }
  const balBefore = currentCredits;
  btnLbGenerate.disabled = true;
  lbDropzone.classList.add('generating');

  // Clear previous results
  lbGrid.innerHTML = '';
  document.getElementById('lb-add-to-db-btn')?.remove();

  const clothingId = Date.now();
  const bgId = clothingId + 1;
  lbAddCard(clothingId, 'clothing');
  lbAddCard(bgId, 'background');
  setStatus('Генерирую лукбук и фон…');
  try {
    const base64 = await blobToBase64(lbBlob);
    const r = await fetch('/api/lookbook/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64: base64, imageEngine: getImageEngine() }),
    });
    const d = await r.json();
    if (!d.success) throw new Error(d.error);

    const [clothingPath, bgPath] = await Promise.all([
      pollTask(d.clothingTaskId, `/api/lookbook/status/${d.clothingTaskId}`,   clothingId, 'Одежда'),
      pollTask(d.bgTaskId,       `/api/environment/status/${d.bgTaskId}`,       bgId,       'Фон'),
    ]);

    setStatus('Лукбук и фон готовы! Выберите, что добавить.');
    if (clothingPath) logGeneration('Обринж (одежда)', location.origin + clothingPath, balBefore);
    if (bgPath)       logGeneration('Обринж (фон)',    location.origin + bgPath, null);

    // Show "Add to DB" button — user decides what to keep
    showAddToDbButton();
  } catch (e) { setStatus('Ошибка: ' + e.message); }
  finally { btnLbGenerate.disabled = false; lbDropzone.classList.remove('generating'); }
});
