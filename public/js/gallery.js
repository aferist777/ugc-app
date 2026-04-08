/* ═══════════════════════════════════════════
   GALLERY & ARCHIVE — cards, load functions
   ═══════════════════════════════════════════ */

function buildGalleryCard(item) {
  const card = document.createElement('div');
  card.className = 'gallery-card';
  const wrap = document.createElement('div');
  wrap.className = 'g-img-wrap';

  const img = document.createElement('img');
  img.src = item.path;
  img.addEventListener('click', () => openLightbox(item.path));

  const delBtn = document.createElement('button');
  delBtn.className = 'g-delete'; delBtn.textContent = '✕'; delBtn.title = 'В архив';
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

  wrap.appendChild(img); wrap.appendChild(delBtn);
  const name = document.createElement('div');
  name.className = 'g-name'; name.textContent = item.name;
  card.appendChild(wrap); card.appendChild(name);
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
  restoreBtn.className = 'g-delete'; restoreBtn.textContent = '↩'; restoreBtn.title = 'Восстановить';
  restoreBtn.style.cssText = 'color:#007000;right:24px;';
  restoreBtn.addEventListener('click', async e => {
    e.stopPropagation();
    try {
      const r = await fetch('/api/gallery/restore', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: item.path }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error);
      card.remove(); setStatus(`Восстановлено: ${item.name}`);
    } catch (err) { setStatus('Ошибка восстановления: ' + err.message); }
  });

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'g-delete'; deleteBtn.textContent = '✕'; deleteBtn.title = 'Удалить навсегда';
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
      card.remove(); setStatus(`Удалено: ${item.name}`);
    } catch (err) { setStatus('Ошибка удаления: ' + err.message); }
  });

  wrap.appendChild(img); wrap.appendChild(restoreBtn); wrap.appendChild(deleteBtn);
  const name = document.createElement('div');
  name.className = 'g-name'; name.textContent = item.name;
  card.appendChild(wrap); card.appendChild(name);
  return card;
}

async function loadGalleryChars() {
  const grid = document.getElementById('gallery-chars-grid');
  try {
    const d = await fetch('/api/gallery/characters').then(r => r.json());
    grid.innerHTML = '';
    if (!d.files.length) { grid.innerHTML = '<div class="gallery-empty">Сохранённых персонажей нет</div>'; return; }
    d.files.forEach(item => grid.appendChild(buildGalleryCard(item)));
  } catch { grid.innerHTML = '<div class="gallery-empty">Ошибка загрузки</div>'; }
}

async function loadGalleryLookbooks() {
  const grid = document.getElementById('gallery-lb-grid');
  try {
    const d = await fetch('/api/gallery/lookbooks').then(r => r.json());
    grid.innerHTML = '';
    if (!d.files.length) { grid.innerHTML = '<div class="gallery-empty">Лукбуков нет</div>'; return; }
    d.files.forEach(item => grid.appendChild(buildGalleryCard(item)));
  } catch { grid.innerHTML = '<div class="gallery-empty">Ошибка загрузки</div>'; }
}

async function loadGalleryEnvironments() {
  const grid = document.getElementById('gallery-env-grid');
  try {
    const d = await fetch('/api/gallery/environments').then(r => r.json());
    grid.innerHTML = '';
    if (!d.files.length) { grid.innerHTML = '<div class="gallery-empty">Окружений нет</div>'; return; }
    d.files.forEach(item => grid.appendChild(buildGalleryCard(item)));
  } catch { grid.innerHTML = '<div class="gallery-empty">Ошибка загрузки</div>'; }
}

const ARCHIVE_GRID_IDS = { character: 'archive-chars-grid', lookbook: 'archive-lb-grid', environment: 'archive-env-grid' };
const ARCHIVE_EMPTY    = { character: 'Архив персонажей пуст', lookbook: 'Архив лукбуков пуст', environment: 'Архив окружений пуст' };

async function loadArchive(subfolder) {
  const grid = document.getElementById(ARCHIVE_GRID_IDS[subfolder]);
  if (!grid) return;
  try {
    const d = await fetch(`/api/archive/${subfolder}`).then(r => r.json());
    grid.innerHTML = '';
    if (!d.files || !d.files.length) { grid.innerHTML = `<div class="gallery-empty">${ARCHIVE_EMPTY[subfolder]}</div>`; return; }
    d.files.forEach(item => grid.appendChild(buildArchiveCard(item)));
  } catch { grid.innerHTML = '<div class="gallery-empty">Ошибка загрузки</div>'; }
}
