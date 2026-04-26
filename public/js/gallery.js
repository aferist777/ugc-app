/* ═══════════════════════════════════════════════════════
   GALLERY & БАЗА ДАННЫХ — cards, load functions
   ═══════════════════════════════════════════════════════ */

/* ── localStorage: hidden archive paths (UI-only removal) ───────── */
const DB_HIDDEN_KEY = 'db_hidden_paths';
function getHiddenPaths() {
  try { return new Set(JSON.parse(localStorage.getItem(DB_HIDDEN_KEY) || '[]')); }
  catch { return new Set(); }
}
function hideArchivePath(p) {
  const s = getHiddenPaths(); s.add(p);
  localStorage.setItem(DB_HIDDEN_KEY, JSON.stringify([...s]));
}

/* ── Gallery card (active assets) ───────────────────────────────── */
function buildGalleryCard(item, onActivate, onDelete) {
  const card = document.createElement('div');
  card.className = 'gallery-card';
  const wrap = document.createElement('div');
  wrap.className = 'g-img-wrap';

  const img = document.createElement('img');
  img.src = item.thumbPath || item.path;
  img.draggable = true;
  img.title = (img.title || '') + ' · drag to workspace';
  img.addEventListener('dragstart', e => {
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('application/x-asset-path',  item.path);
    e.dataTransfer.setData('application/x-asset-thumb', item.thumbPath || item.path);
    e.dataTransfer.setData('application/x-asset-label', item.name || '');
    e.dataTransfer.setData('application/x-asset-type',  'detail');
  });
  img.addEventListener('click', () => {
    if (onActivate) { onActivate(item, img); return; }
    openLightbox(item.path);
  });

  const delBtn = document.createElement('button');
  delBtn.className = 'g-delete'; delBtn.textContent = '✕'; delBtn.title = 'Archive';
  delBtn.addEventListener('click', async e => {
    e.stopPropagation();
    if (onDelete) { onDelete(item, card); return; }
    try {
      const r = await fetch('/api/gallery/archive', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: item.path }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error);
      card.remove();
    } catch (err) { setStatus('Archive error: ' + err.message); }
  });

  wrap.appendChild(img); wrap.appendChild(delBtn);
  const name = document.createElement('div');
  name.className = 'g-name'; name.textContent = item.name;
  card.appendChild(wrap); card.appendChild(name);
  return card;
}

/* ── База данных card (archived assets) ─────────────────────────── */
function buildArchiveCard(item) {
  const card = document.createElement('div');
  card.className = 'gallery-card';
  const wrap = document.createElement('div');
  wrap.className = 'g-img-wrap';

  const img = document.createElement('img');
  img.src = item.thumbPath || item.path;
  img.addEventListener('click', () => openLightbox(item.path));

  // Restore to active gallery + refresh thumb rows in Персонаж tab
  const addBtn = document.createElement('button');
  addBtn.className = 'g-delete';
  addBtn.textContent = '↩';
  addBtn.title = 'Add to Character';
  addBtn.style.cssText = 'color:#007000; right:24px;';
  addBtn.addEventListener('click', async e => {
    e.stopPropagation();
    try {
      const r = await fetch('/api/gallery/restore', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: item.path }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error);
      card.remove();
      setStatus(`Added to Character: ${item.name}`);
      // Refresh relevant thumb row
      if (item.path.includes('/character/'))    loadCharacterThumbs?.();
      else if (item.path.includes('/lookbook/')) loadLookbookThumbs?.();
      else if (item.path.includes('/environment/')) loadEnvironmentThumbs?.();
    } catch (err) { setStatus('Error: ' + err.message); }
  });

  // Hide from UI only — file stays on disk in archive folder
  const hideBtn = document.createElement('button');
  hideBtn.className = 'g-delete';
  hideBtn.textContent = '✕';
  hideBtn.title = 'Hide from database';
  hideBtn.addEventListener('click', e => {
    e.stopPropagation();
    hideArchivePath(item.path);
    card.remove();
  });

  wrap.appendChild(img);
  wrap.appendChild(addBtn);
  wrap.appendChild(hideBtn);
  const name = document.createElement('div');
  name.className = 'g-name'; name.textContent = item.name;
  card.appendChild(wrap); card.appendChild(name);
  return card;
}

/* ── База данных loaders ─────────────────────────────────────────── */
const ARCHIVE_GRID_IDS = {
  character:   'archive-chars-grid',
  lookbook:    'archive-lb-grid',
  environment: 'archive-env-grid',
};
const ARCHIVE_EMPTY = {
  character:   'Character database is empty',
  lookbook:    'Lookbook database is empty',
  environment: 'Background database is empty',
};

async function loadArchive(subfolder) {
  const grid = document.getElementById(ARCHIVE_GRID_IDS[subfolder]);
  if (!grid) return;
  const hidden = getHiddenPaths();
  try {
    const d = await fetch(`/api/archive/${subfolder}`).then(r => r.json());
    grid.innerHTML = '';
    const visible = (d.files || []).filter(item => !hidden.has(item.path));
    if (!visible.length) {
      grid.innerHTML = `<div class="gallery-empty">${ARCHIVE_EMPTY[subfolder]}</div>`;
      return;
    }
    visible.forEach(item => grid.appendChild(buildArchiveCard(item)));
  } catch { grid.innerHTML = '<div class="gallery-empty">Load error</div>'; }
}
