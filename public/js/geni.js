/* ═══════════════════════════════════════════════════════════════
   GENI — all generated images archive (auto-saved after each gen)
   ═══════════════════════════════════════════════════════════════ */

const GENI_KEY = 'all_geni_v1';

function getGeniList() {
  try { return JSON.parse(localStorage.getItem(GENI_KEY) || '[]'); } catch { return []; }
}

// Push a generated image to the archive (called after every successful generation)
function pushToGeni(path, seed, projectId) {
  if (!path) return;
  const list = getGeniList();
  // Avoid exact duplicates (same path)
  if (list.some(g => g.path === path)) return;
  list.unshift({
    path,
    seed:      seed      || null,
    projectId: projectId || null,
    date:      new Date().toISOString(),
  });
  localStorage.setItem(GENI_KEY, JSON.stringify(list));
}

// Legacy alias used by the delete handler
function saveToDeletedGeni(path, seed) { pushToGeni(path, seed); }

// ── Render the "Все гени" tab ─────────────────────────────────────────────────
function loadAllGeni() {
  const grid = document.getElementById('archive-geni-grid');
  if (!grid) return;
  const list = getGeniList();
  grid.innerHTML = '';
  if (!list.length) {
    grid.innerHTML = '<div class="gallery-empty">No saved generations</div>';
    return;
  }
  list.forEach(item => {
    const card = document.createElement('div');
    card.className = 'geni-card';

    const img = document.createElement('img');
    img.src = item.path + '?t=' + Date.now();
    img.className = 'geni-thumb';
    img.title = 'Open';
    img.addEventListener('click', () => openLightbox?.(item.path));

    const meta = document.createElement('div');
    meta.className = 'geni-meta';

    if (item.date) {
      const dateEl = document.createElement('div');
      dateEl.className = 'geni-date';
      dateEl.textContent = new Date(item.date).toLocaleString('ru-RU', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
      });
      meta.appendChild(dateEl);
    }

    if (item.seed) {
      const seedEl = document.createElement('div');
      seedEl.className = 'obraz-seed';
      seedEl.textContent = 'seed: ' + item.seed;
      meta.appendChild(seedEl);
    }

    card.appendChild(img);
    card.appendChild(meta);
    grid.appendChild(card);
  });
}
