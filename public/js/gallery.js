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
  // Two-click confirmation with 3-second auto-revert. First click arms the
  // button (turns into "?"); second click within 3 s actually deletes.
  let _delTimer = null;
  function _disarmDelete() {
    delBtn.dataset.armed = '';
    delBtn.textContent = '✕';
    delBtn.style.background = '';
    delBtn.style.color = '';
    delBtn.title = 'Archive';
    if (_delTimer) { clearTimeout(_delTimer); _delTimer = null; }
  }
  delBtn.addEventListener('click', async e => {
    e.stopPropagation();
    if (!delBtn.dataset.armed) {
      delBtn.dataset.armed = '1';
      delBtn.textContent = '?';
      delBtn.style.background = '#ffcccc';
      delBtn.style.color = '#cc0000';
      delBtn.title = 'Click again within 3 s to delete';
      _delTimer = setTimeout(_disarmDelete, 3000);
      return;
    }
    _disarmDelete();
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

/* ── Library card — reads directly from active galleries now that the
   archive/restore intermediate layer is gone. Two-click delete on ✕: first
   click arms (red), second click permanently unlinks the file on the server.
   The old ↩ "restore" button is removed — files no longer live in archive/. */
function buildArchiveCard(item) {
  const card = document.createElement('div');
  card.className = 'gallery-card';
  const wrap = document.createElement('div');
  wrap.className = 'g-img-wrap';

  const img = document.createElement('img');
  img.src = item.thumbPath || item.path;
  img.addEventListener('click', () => openLightbox(item.path));

  // Delete (permanent unlink) — same backend route as the Character-tab thumb row
  const delBtn = document.createElement('button');
  delBtn.className = 'g-delete';
  delBtn.textContent = '✕';
  delBtn.title = 'Delete (click twice)';
  let armed = false;
  delBtn.addEventListener('click', async e => {
    e.stopPropagation();
    if (!armed) {
      armed = true;
      delBtn.style.background = '#a33';
      delBtn.style.color = '#fff';
      delBtn.title = 'Click again to confirm delete';
      setTimeout(() => {
        if (armed) {
          armed = false;
          delBtn.style.background = '';
          delBtn.style.color = '';
          delBtn.title = 'Delete (click twice)';
        }
      }, 2500);
      return;
    }
    try {
      const r = await fetch('/api/gallery/archive', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: item.path }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error);
      card.remove();
      // Refresh relevant thumb row in the Character tab so the deletion is reflected there too
      if (item.path.includes('/characters/'))    loadCharacterThumbs?.();
      else if (item.path.includes('/lookbooks/')) loadLookbookThumbs?.();
      else if (item.path.includes('/environments/')) loadEnvironmentThumbs?.();
    } catch (err) { setStatus('Error: ' + err.message); }
  });

  wrap.appendChild(img);
  wrap.appendChild(delBtn);
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

// Library Characters / Lookbooks / Environments tabs now read directly from
// the active galleries (no archive intermediate). Maps singular subfolder name
// → plural gallery endpoint.
const _ARCHIVE_TO_GALLERY = { character: 'characters', lookbook: 'lookbooks', environment: 'environments' };

async function loadArchive(subfolder) {
  const grid = document.getElementById(ARCHIVE_GRID_IDS[subfolder]);
  if (!grid) return;
  const hidden = getHiddenPaths();
  const galleryEndpoint = _ARCHIVE_TO_GALLERY[subfolder] || subfolder;
  try {
    const d = await fetch(`/api/gallery/${galleryEndpoint}`).then(r => r.json());
    grid.innerHTML = '';
    const visible = (d.files || []).filter(item => !hidden.has(item.path));
    if (!visible.length) {
      grid.innerHTML = `<div class="gallery-empty">${ARCHIVE_EMPTY[subfolder]}</div>`;
      return;
    }
    visible.forEach(item => grid.appendChild(buildArchiveCard(item)));
  } catch { grid.innerHTML = '<div class="gallery-empty">Load error</div>'; }
}
