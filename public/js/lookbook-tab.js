/* ═══════════════════════════════════
   LOOKBOOK TAB — Обринж: generate
   ═══════════════════════════════════ */

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

// ── Result cards ──────────────────────────────────────────────────────────────
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

// ── Generate ──────────────────────────────────────────────────────────────────
btnLbGenerate.addEventListener('click', async () => {
  if (!lbBlob) { setStatus('Загрузите изображение.'); return; }
  const balBefore = currentCredits;
  btnLbGenerate.disabled = true;
  lbDropzone.classList.add('generating');
  const clothingId = Date.now();
  const bgId = clothingId + 1;
  lbAddCard(clothingId); lbAddCard(bgId);
  setStatus('Генерирую лукбук и фон…');
  try {
    const base64 = await blobToBase64(lbBlob);
    const r = await fetch('/api/lookbook/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64: base64 }),
    });
    const d = await r.json();
    if (!d.success) throw new Error(d.error);

    const [clothingPath, bgPath] = await Promise.all([
      pollTask(d.clothingTaskId, `/api/lookbook/status/${d.clothingTaskId}`,   clothingId, 'Одежда'),
      pollTask(d.bgTaskId,       `/api/environment/status/${d.bgTaskId}`,       bgId,       'Фон'),
    ]);

    setStatus('Лукбук и фон готовы!');
    if (clothingPath) logGeneration('Обринж (одежда)', location.origin + clothingPath, balBefore);
    if (bgPath)       logGeneration('Обринж (фон)',    location.origin + bgPath, null);
    loadLookbookThumbs();
    loadEnvironmentThumbs();
  } catch (e) { setStatus('Ошибка: ' + e.message); }
  finally { btnLbGenerate.disabled = false; lbDropzone.classList.remove('generating'); }
});
