/* ═══════════════════════════════════════════════════════════════════
   БИРОЛЫ ARCHIVE — localStorage storage for completed img+video birolys
   Includes: archive grid, horizontal video strip, Постпрод panel
   ═══════════════════════════════════════════════════════════════════ */

const BIROLY_ARCHIVE_KEY = 'biroly_archive_v1';
const BIROLY_ACTIVE_KEY  = 'biroly_active_v1';

function getBirolyArchive() {
  try { return JSON.parse(localStorage.getItem(BIROLY_ARCHIVE_KEY) || '[]'); } catch { return []; }
}

function getActiveBirolyIdxs() {
  try { return JSON.parse(localStorage.getItem(BIROLY_ACTIVE_KEY) || '[]'); } catch { return []; }
}

function setActiveBirolyIdxs(arr) {
  localStorage.setItem(BIROLY_ACTIVE_KEY, JSON.stringify(arr));
}

function toggleActiveBiroly(idx) {
  const active = getActiveBirolyIdxs();
  const pos = active.indexOf(idx);
  const adding = pos === -1;
  if (adding) active.push(idx);
  else active.splice(pos, 1);
  setActiveBirolyIdxs(active);
  renderBirolyStrip();
  renderPostprod();
  // Instant sync update of Биролы columns already in the DOM
  window.refreshTimelineBirolys?.();
  // Full async re-render (updates headers, timing bars, etc.)
  window.renderAllTimelines?.();
}

// Push a completed biroly (image + video) to the archive (legacy, kept for compat)
function pushToBirolyArchive(item) {
  if (!item.imagePath) return;
  const list = getBirolyArchive();
  list.unshift({ ...item, status: 'done', date: item.date || new Date().toISOString() });
  localStorage.setItem(BIROLY_ARCHIVE_KEY, JSON.stringify(list));
}

// ── Pending/live archive management ──────────────────────────────────────────
function _buid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }

// Add a generating entry immediately (returns its id)
// meta: optional { categoryId, categoryLabel } from the biroly slot
function addPendingBirolyEntry(name, prompt, meta = {}) {
  const id = _buid();
  const list = getBirolyArchive();
  list.unshift({ id, name, prompt, ...meta, imagePath: null, videoPath: null, status: 'generating', date: new Date().toISOString() });
  localStorage.setItem(BIROLY_ARCHIVE_KEY, JSON.stringify(list));
  loadAllBiroly();
  return id;
}

// Update a pending entry by id (imagePath, videoPath, status, etc.)
function updateBirolyEntry(id, updates) {
  const list = getBirolyArchive();
  const idx = list.findIndex(e => e.id === id);
  if (idx < 0) return;
  list[idx] = { ...list[idx], ...updates };
  localStorage.setItem(BIROLY_ARCHIVE_KEY, JSON.stringify(list));
  loadAllBiroly();
}

// Remove an archive entry by id (used by the merge gallery × button). No confirm.
function removeBirolyEntry(id) {
  const list = getBirolyArchive().filter(e => e.id !== id);
  localStorage.setItem(BIROLY_ARCHIVE_KEY, JSON.stringify(list));
  loadAllBiroly();
}

// ── Horizontal video strip — replaced by Hooks section (scen-hooks.js) ───────
function renderBirolyStrip() {
  // No-op: the biroly video strip has been replaced by the Хуки (hooks) section
  // in the Биролы tab Col 3. Hooks are managed via scen-hooks.js.
}

// ── Постпрод panel in Склейка tab ── биролы теперь управляются в колонке таймлайна ──
function renderPostprod() {
  const container = document.getElementById('postprod-content');
  if (!container) return;
  container.innerHTML = '<span style="color:#888;font-size:11px;">Birols are managed in the right column of each timeline</span>';
}

// ── Merged category list: generator cats + any cats already used in archive ───
function getMergedCategories() {
  const genCats = (() => { try { return JSON.parse(localStorage.getItem('biroly_cats') || '[]'); } catch { return []; } })();
  const seen    = new Set(genCats.map(c => c.id));
  const merged  = [...genCats];
  getBirolyArchive().forEach(item => {
    if (item.categoryId && !seen.has(item.categoryId)) {
      seen.add(item.categoryId);
      merged.push({ id: item.categoryId, label: item.categoryLabel || item.categoryId });
    }
  });
  return merged;
}

// ── Render a single biroly card into a container ─────────────────────────────
function _renderBirolyCard(item, container) {
    const card = document.createElement('div');
    const gen  = item.status === 'generating';
    const err  = item.status === 'error';
    card.className = 'biroly-archive-card' + (gen ? ' biroly-card-generating' : '');

    const thumbSrc = item.thumbPath || item.imagePath || null;
    let thumb;
    if (thumbSrc) {
      thumb = document.createElement('img');
      thumb.src = thumbSrc;
      thumb.className = 'biroly-archive-thumb';
      if (!gen && item.videoPath) {
        thumb.title = '▶ Watch video';
        thumb.style.cursor = 'pointer';
        thumb.addEventListener('click', () => openBirolyVideoLightbox(item.videoPath, item.imagePath || item.thumbPath, item));
      } else if (!gen && !item.videoPath) {
        thumb.title = 'Open image';
        thumb.addEventListener('click', () => openLightbox?.(item.imagePath));
      }
    } else if (!gen && item.videoPath) {
      thumb = document.createElement('video');
      thumb.src = item.videoPath + '#t=0.5';
      thumb.className = 'biroly-archive-thumb';
      thumb.muted = true;
      thumb.preload = 'metadata';
      thumb.style.cursor = 'pointer';
      thumb.title = '▶ Watch video';
      thumb.addEventListener('click', () => openBirolyVideoLightbox(item.videoPath, null, item));
    } else {
      thumb = document.createElement('div');
      thumb.className = 'biroly-archive-thumb biroly-thumb-placeholder';
      thumb.textContent = err ? '❌' : '⏳';
    }

    const meta = document.createElement('div');
    meta.className = 'biroly-archive-meta';

    const nameEl = document.createElement('input');
    nameEl.type = 'text';
    nameEl.className = 'biroly-archive-name biroly-archive-name-input';
    nameEl.value = item.name || 'Birol';
    nameEl.title = 'Click to edit name';
    nameEl.addEventListener('change', () => {
      const newName = nameEl.value.trim() || 'Birol';
      nameEl.value = newName;
      const list = getBirolyArchive();
      const entry = list.find(e => e.id === item.id);
      if (entry) {
        entry.name = newName;
        localStorage.setItem(BIROLY_ARCHIVE_KEY, JSON.stringify(list));
        window.refreshTimelineBirolys?.();
      }
    });
    nameEl.addEventListener('click', e => e.stopPropagation());
    meta.appendChild(nameEl);

    {
      const cats = getMergedCategories();
      if (cats.length) {
        const catSel = document.createElement('select');
        catSel.className = 'biroly-archive-cat-sel';
        catSel.title = 'Category';
        const noneOpt = document.createElement('option');
        noneOpt.value = '';
        noneOpt.textContent = '— category —';
        catSel.appendChild(noneOpt);
        cats.forEach(c => {
          const o = document.createElement('option');
          o.value = c.id;
          o.textContent = c.label;
          catSel.appendChild(o);
        });
        catSel.value = item.categoryId || '';
        catSel.addEventListener('change', e => {
          e.stopPropagation();
          const list = getBirolyArchive();
          const entry = list.find(en => en.id === item.id);
          if (entry) {
            entry.categoryId    = catSel.value;
            entry.categoryLabel = cats.find(c => c.id === catSel.value)?.label || '';
            localStorage.setItem(BIROLY_ARCHIVE_KEY, JSON.stringify(list));
            window.refreshTimelineBirolys?.();
          }
        });
        catSel.addEventListener('click', e => e.stopPropagation());
        meta.appendChild(catSel);
      }
    }

    if (item.date) {
      const dateEl = document.createElement('div');
      dateEl.className = 'geni-date';
      dateEl.textContent = new Date(item.date).toLocaleString('en-GB', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
      });
      meta.appendChild(dateEl);
    }

    if (gen) {
      const badge = document.createElement('div');
      badge.className = 'biroly-gen-badge';
      badge.textContent = item.videoPath ? '⚙ waiting for video…' : item.imagePath ? '⚙ generating video…' : '⚙ generating…';
      meta.appendChild(badge);
    } else if (err) {
      const badge = document.createElement('div');
      badge.style.cssText = 'font-size:9px;color:#cc3333;font-weight:bold;margin-top:2px;';
      badge.textContent = '❌ Error';
      meta.appendChild(badge);
      if (item.errorMsg) {
        const errEl = document.createElement('div');
        errEl.style.cssText = 'font-size:8px;color:#cc6666;margin-top:2px;word-break:break-word;max-width:90px;';
        errEl.textContent = item.errorMsg;
        meta.appendChild(errEl);
      }
      // Re-check button — always shown for error items
      const checkBtn = document.createElement('button');
      checkBtn.textContent = '↺ Check';
      checkBtn.title = 'Re-check if files appeared on server';
      checkBtn.style.cssText = 'margin-top:4px;font-size:9px;padding:2px 5px;cursor:pointer;background:#1e2e3e;color:#8cf;border:1px solid #4a6a8a;border-radius:3px;width:100%;';
      checkBtn.addEventListener('click', async e => {
        e.stopPropagation();
        checkBtn.disabled = true; checkBtn.textContent = '…';
        await recheckBirolyEntry(item.id);
      });
      meta.appendChild(checkBtn);
      // Generate-video button — only when image exists and retryState is set
      if (item.retryState && item.id && typeof window.retryBirolyEntry === 'function') {
        const retryBtn = document.createElement('button');
        retryBtn.textContent = '▶ Gen video';
        retryBtn.title = `Generate video from stage: ${item.retryState.stage || '?'}`;
        retryBtn.style.cssText = 'margin-top:3px;font-size:9px;padding:2px 5px;cursor:pointer;background:#2a3a2a;color:#8fc;border:1px solid #4a7a4a;border-radius:3px;width:100%;';
        retryBtn.addEventListener('click', e => {
          e.stopPropagation();
          window.retryBirolyEntry(item.id);
        });
        meta.appendChild(retryBtn);
      }
    } else if (item.videoPath) {
      const badge = document.createElement('div');
      badge.style.cssText = 'font-size:9px;color:#006600;font-weight:bold;margin-top:2px;';
      badge.textContent = `▶ ${item.duration ? item.duration + 's' : 'video'}`;
      meta.appendChild(badge);
    }

    const delBtn = document.createElement('button');
    delBtn.textContent = '×';
    delBtn.title = 'Delete permanently';
    delBtn.className = 'biroly-archive-del-btn';
    delBtn.addEventListener('click', async e => {
      e.stopPropagation();
      // Remove from localStorage immediately
      const list = getBirolyArchive();
      const idx  = list.findIndex(en => en.id === item.id);
      if (idx !== -1) {
        list.splice(idx, 1);
        localStorage.setItem(BIROLY_ARCHIVE_KEY, JSON.stringify(list));
        window.refreshTimelineBirolys?.();
      }
      loadAllBiroly();
      // Delete physical files from server so recoverOrphanBirolys won't restore them
      fetch('/api/biroly/delete-files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imagePath: item.imagePath, thumbPath: item.thumbPath, videoPath: item.videoPath }),
      }).catch(() => {});
    });

    card.style.position = 'relative';
    card.appendChild(thumb);
    card.appendChild(meta);
    card.appendChild(delBtn);
    container.appendChild(card);
}

// ── Re-check one error item: does its video/image still exist on server? ──────
async function recheckBirolyEntry(id) {
  const list  = getBirolyArchive();
  const item  = list.find(i => i.id === id);
  if (!item) return;
  try {
    const r = await fetch('/api/biroly/check-item', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoPath: item.videoPath || null, imagePath: item.imagePath || null }),
    }).then(r => r.json());

    if (r.hasVideo) {
      item.status   = 'done';
      item.errorMsg = null;
      if (r.thumbPath) item.thumbPath = r.thumbPath;
    } else if (r.hasImage) {
      item.status   = 'error';
      item.errorMsg = 'Image ready — video not found';
      if (!item.retryState) {
        item.retryState = {
          mode: item.mode || 'base', prompt: item.prompt || '',
          imagePath: item.imagePath, thumbPath: item.thumbPath || null,
          stage: 'analyze', enhancedPrompt: item.enhancedPrompt || null,
        };
      }
    }
    // if neither: keep existing error unchanged
    localStorage.setItem(BIROLY_ARCHIVE_KEY, JSON.stringify(list));
  } catch (e) {
    console.warn('[biroly] recheckBirolyEntry:', e.message);
  }
  loadAllBiroly();
}
window.recheckBirolyEntry = recheckBirolyEntry;

// ── Sync: remove stale entries, add orphans, refresh thumbnails ───────────────
async function syncBirolyArchive() {
  // Skip sync briefly after a backup import — otherwise a transient mismatch
  // between the just-restored LS entries and on-disk files could nuke entries
  // (and re-add them as "Birol (restored)" with no category).
  const _imp = parseInt(localStorage.getItem('__just_imported_at') || '0', 10);
  if (_imp && Date.now() - _imp < 30000) {
    console.log('[biroly] skipping sync — fresh import detected');
    return;
  }
  let list = getBirolyArchive();
  try {
    const res = await fetch('/api/biroly/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: list.map(i => ({ id: i.id, imagePath: i.imagePath || null, videoPath: i.videoPath || null, status: i.status || 'done' })) }),
    }).then(r => r.json());
    if (!res.success) return;

    let changed = false;

    // Remove stale entries
    if (res.toRemove?.length) {
      const removeSet = new Set(res.toRemove);
      list = list.filter(i => !removeSet.has(i.id));
      changed = true;
    }

    // Add orphan videos not yet in list
    if (res.orphans?.length) {
      const knownVideos = new Set(list.map(i => i.videoPath).filter(Boolean));
      for (const vp of res.orphans) {
        if (knownVideos.has(vp)) continue;
        list.push({ id: _buid(), name: 'Birol (restored)', prompt: '', imagePath: null, thumbPath: null, videoPath: vp, status: 'done', duration: 6, date: new Date().toISOString() });
        changed = true;
      }
    }

    if (changed) {
      list.sort((a, b) => new Date(b.date) - new Date(a.date));
      localStorage.setItem(BIROLY_ARCHIVE_KEY, JSON.stringify(list));
      window.refreshTimelineBirolys?.();
      console.log(`[biroly] sync: removed ${res.toRemove?.length || 0}, added ${res.orphans?.length || 0} orphans`);
    }

    // Refresh thumbnails for items with video but no thumb
    const needsThumbs = list.filter(i => i.videoPath && !i.thumbPath);
    if (needsThumbs.length) {
      const tr = await fetch('/api/biroly/refresh-thumbs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: needsThumbs.map(i => ({ id: i.id, videoPath: i.videoPath })) }),
      }).then(r => r.json());
      if (tr.success && tr.results?.length) {
        tr.results.forEach(({ id, thumbPath }) => {
          const entry = list.find(i => i.id === id);
          if (entry) entry.thumbPath = thumbPath;
        });
        localStorage.setItem(BIROLY_ARCHIVE_KEY, JSON.stringify(list));
        console.log(`[biroly] sync: refreshed ${tr.results.length} thumbnails`);
      }
    }
  } catch (e) {
    console.warn('[biroly] sync error:', e.message);
  }
  loadAllBiroly();
}
window.syncBirolyArchive = syncBirolyArchive;

// ── Clean uncategorized archive items ────────────────────────────────────────
// Removes entries with empty / '__nocat__' / orphaned categoryId from the
// localStorage biroly archive. Disk files (referenced via item.videoPath /
// item.imagePath) are NOT touched — only the metadata is dropped, so a future
// resync or manual recategorization can still recover them if needed.
// After cleaning, force-flushes to the server so data/biroly.json matches.
async function cleanUncategorizedBirolyArchive() {
  const list = getBirolyArchive();
  const validCats = _validBirolyCategoryIds();
  const kept = list.filter(item =>
    item.categoryId &&
    item.categoryId !== '__nocat__' &&
    validCats.has(item.categoryId)
  );
  const removed = list.length - kept.length;
  if (removed === 0) {
    alert('Nothing to clean — all archive items have valid categories.');
    return;
  }
  if (!confirm(`Remove ${removed} uncategorized biroly entries from the archive?\n\n(Video / image files on disk stay — only the archive metadata is dropped.)`)) {
    return;
  }
  localStorage.setItem(BIROLY_ARCHIVE_KEY, JSON.stringify(kept));
  // Force a server sync so the change reaches data/biroly.json immediately,
  // then re-render the archive grid.
  try { await window.birolyServerSyncFlush?.(); } catch {}
  loadAllBiroly();
}
window.cleanUncategorizedBirolyArchive = cleanUncategorizedBirolyArchive;

// ── Open category accordion state (survives re-renders, resets on page load) ──
const _openBirolyCats = new Set();

// ── Database archive grid ─────────────────────────────────────────────────────
// Birolys without a valid category are hidden from this view (3 cases):
//   1. categoryId empty / null / undefined
//   2. categoryId === '__nocat__' (the synthetic "no category" group)
//   3. categoryId points to a category that no longer exists in biroly_cats
function _validBirolyCategoryIds() {
  try {
    const cats = JSON.parse(localStorage.getItem('biroly_cats') || '[]');
    return new Set((Array.isArray(cats) ? cats : []).map(c => c && c.id).filter(Boolean));
  } catch { return new Set(); }
}

function loadAllBiroly() {
  const grid = document.getElementById('archive-biroly-grid');
  if (!grid) return;
  const list = getBirolyArchive();
  grid.innerHTML = '';
  if (!list.length) {
    grid.innerHTML = '<div class="gallery-empty">No saved birols</div>';
    return;
  }

  const validCats = _validBirolyCategoryIds();
  const hasValidCategory = item => {
    const cid = item && item.categoryId;
    if (!cid) return false;                 // empty / null / undefined
    if (cid === '__nocat__') return false;  // synthetic no-category bucket
    return validCats.has(cid);              // skip orphaned ids
  };

  // Generating items pinned to top (no category filter — these are in-flight)
  const generatingItems = list.filter(item => item.status === 'generating');
  if (generatingItems.length) {
    const section = document.createElement('div');
    section.style.cssText = 'width:100%;margin-bottom:10px;';
    const hdr = document.createElement('div');
    hdr.style.cssText = 'width:100%;font-size:10px;font-weight:bold;color:#884400;background:#fff4e0;border-top:2px solid #e0a040;border-bottom:1px solid #e0c080;padding:4px 8px;box-sizing:border-box;margin-bottom:6px;';
    hdr.textContent = `⚙ Generating (${generatingItems.length})`;
    section.appendChild(hdr);
    const genGrid = document.createElement('div');
    genGrid.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;padding:0 4px;';
    section.appendChild(genGrid);
    grid.appendChild(section);
    generatingItems.forEach(item => _renderBirolyCard(item, genGrid));
  }

  // ── Uncategorised section (top, just under "Generating") ────────────────
  // Archive entries with no/orphaned categoryId — previously hidden from the
  // Library by the hasValidCategory() filter. Surfaces them here so the user
  // can assign them to a category. Each card uses the same _renderBirolyCard
  // helper as the per-category sections (so the inline category <select>
  // built inside that helper handles re-categorisation automatically).
  const orphanItems = list.filter(item =>
    item.status !== 'generating' && !hasValidCategory(item)
  );
  if (orphanItems.length) {
    const orphKey = '__nocat__';
    const isOpen  = _openBirolyCats.has(orphKey);
    const section = document.createElement('div');
    section.style.cssText = 'width:100%;margin-bottom:4px;';
    const hdr = document.createElement('div');
    hdr.style.cssText = 'width:100%;font-size:10px;font-weight:bold;color:#fff;background:#5a5a4a;border-top:2px solid #777;border-bottom:1px solid #444;padding:4px 8px;box-sizing:border-box;cursor:pointer;user-select:none;letter-spacing:0.03em;';
    hdr.textContent = (isOpen ? '▼ ' : '▶ ') + `📂 Uncategorised (${orphanItems.length})`;
    hdr.addEventListener('mouseenter', () => { hdr.style.background = '#6a6a5a'; });
    hdr.addEventListener('mouseleave', () => { hdr.style.background = '#5a5a4a'; });
    hdr.addEventListener('click', () => {
      if (_openBirolyCats.has(orphKey)) _openBirolyCats.delete(orphKey);
      else _openBirolyCats.add(orphKey);
      loadAllBiroly();
    });
    section.appendChild(hdr);
    const orphGrid = document.createElement('div');
    orphGrid.style.cssText = `display:${isOpen ? 'flex' : 'none'};flex-wrap:wrap;gap:8px;padding:8px 4px 4px;`;
    section.appendChild(orphGrid);
    grid.appendChild(section);
    if (isOpen) orphanItems.forEach(item => _renderBirolyCard(item, orphGrid));
  }

  // Completed items: only those tagged with a valid category
  const groupMap = new Map(); // categoryKey → { label, items[] }
  list.filter(item => item.status !== 'generating' && hasValidCategory(item)).forEach(item => {
    const key   = item.categoryId;
    const label = item.categoryLabel || `Category (${String(key).slice(0,6)})`;
    if (!groupMap.has(key)) groupMap.set(key, { label, items: [] });
    groupMap.get(key).items.push(item);
  });

  // Sort by label alphabetically (no "no category" bucket anymore)
  const sorted = [...groupMap.entries()].sort(([, a], [, b]) =>
    a.label.localeCompare(b.label, 'en')
  );

  sorted.forEach(([key, { label, items }]) => {
    const isOpen = _openBirolyCats.has(key);
    const section = document.createElement('div');
    section.style.cssText = 'width:100%;margin-bottom:4px;';

    const hdr = document.createElement('div');
    hdr.style.cssText = 'width:100%;font-size:10px;font-weight:bold;color:#444;background:#e8e4dc;border-top:2px solid #b0a890;border-bottom:1px solid #c8c0b0;padding:4px 8px;box-sizing:border-box;cursor:pointer;user-select:none;letter-spacing:0.03em;';
    hdr.textContent = (isOpen ? '▼ ' : '▶ ') + label + ` (${items.length})`;
    hdr.addEventListener('mouseenter', () => { hdr.style.background = '#d8d4cc'; });
    hdr.addEventListener('mouseleave', () => { hdr.style.background = '#e8e4dc'; });
    hdr.addEventListener('click', () => {
      if (_openBirolyCats.has(key)) _openBirolyCats.delete(key);
      else _openBirolyCats.add(key);
      loadAllBiroly();
    });
    section.appendChild(hdr);

    const groupGrid = document.createElement('div');
    groupGrid.style.cssText = `display:${isOpen ? 'flex' : 'none'};flex-wrap:wrap;gap:8px;padding:8px 4px 4px;`;
    section.appendChild(groupGrid);
    grid.appendChild(section);

    if (isOpen) items.forEach(item => _renderBirolyCard(item, groupGrid));
  }); // end sorted.forEach
}

// ── Scan uploads/ and recover orphan videos not in archive ───────────────────
async function recoverOrphanBirolys() {
  try {
    const res = await fetch('/api/biroly/scan-uploads').then(r => r.json());
    if (!res.success) return;
    let list = getBirolyArchive();
    let changed = 0;

    // 1. Fix entries with videoPath already set but stuck as 'generating'
    list.forEach(e => {
      if (e.status === 'generating' && e.videoPath) {
        e.status = 'done';
        changed++;
      }
    });

    // 2. Fix 'generating' entries stuck too long (>15 min) — mark as error
    //    But first try to match with an unmatched scan video by date proximity
    const STALE_MS    = 15 * 60 * 1000;
    const MATCH_MS    = 40 * 60 * 1000;
    const knownVideos = new Set(list.map(e => e.videoPath).filter(Boolean));
    const orphanFiles = res.files.filter(f => !knownVideos.has(f.videoPath));
    const usedVideos  = new Set();

    list.forEach(e => {
      if (e.status !== 'generating') return;
      const age = Date.now() - new Date(e.date).getTime();
      if (age < STALE_MS) return; // still might be in progress

      // Try to find an orphan video close in time
      const entryMs = new Date(e.date).getTime();
      const match = orphanFiles.find(f => !usedVideos.has(f.videoPath) && Math.abs(f.mtime - entryMs) < MATCH_MS);
      if (match) {
        usedVideos.add(match.videoPath);
        e.videoPath  = match.videoPath;
        e.imagePath  = e.imagePath || match.imagePath || null;
        e.thumbPath  = match.thumbPath || null;
        e.status     = 'done';
        e.duration   = 6;
      } else {
        e.status = 'error';
        // Save retry state so the user can retry from the database tab
        if (!e.retryState) {
          e.retryState = {
            mode:    e.mode || 'base',
            prompt:  e.prompt || '',
            imagePath: e.imagePath || null,
            thumbPath: e.thumbPath || null,
            stage:   e.imagePath ? 'analyze' : (e.mode === 'plus' ? 'img1' : 'img'),
            enhancedPrompt: e.enhancedPrompt || null,
            img1done: e.img1done || false,
          };
        }
      }
      changed++;
    });

    // 3. Add remaining orphan videos as new entries
    orphanFiles
      .filter(f => !usedVideos.has(f.videoPath))
      .forEach(({ videoPath, imagePath, thumbPath, mtime }) => {
        list.push({
          id:        _buid(),
          name:      'Birol (restored)',
          prompt:    '',
          imagePath: imagePath || null,
          thumbPath: thumbPath || null,
          videoPath,
          status:    'done',
          duration:  6,
          date:      new Date(mtime).toISOString(),
        });
        changed++;
      });

    if (changed > 0) {
      list.sort((a, b) => new Date(b.date) - new Date(a.date));
      localStorage.setItem(BIROLY_ARCHIVE_KEY, JSON.stringify(list));
      loadAllBiroly();
      renderBirolyStrip();
      console.log(`[biroly] recoverOrphanBirolys: ${changed} changes`);
    }
  } catch (e) {
    console.warn('[biroly] recoverOrphanBirolys:', e.message);
  }
}

// ── Video lightbox ────────────────────────────────────────────────────────────
function openBirolyVideoLightbox(videoPath, posterPath, item) {
  let lb = document.getElementById('biroly-vid-lb');
  if (!lb) {
    lb = document.createElement('div');
    lb.id = 'biroly-vid-lb';
    lb.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.88);z-index:99999;align-items:center;justify-content:center;cursor:pointer;';
    lb.addEventListener('click', () => {
      lb.style.display = 'none';
      const v = lb.querySelector('video');
      if (v) v.pause();
    });
    document.body.appendChild(lb);
  }
  lb.innerHTML = '';
  const vid = document.createElement('video');
  vid.src = videoPath;
  if (posterPath) vid.poster = posterPath;
  vid.controls = true;
  vid.playsInline = true;
  vid.style.cssText = 'width:80vw;max-width:90vw;max-height:90vh;display:block;background:#000;';
  vid.addEventListener('click', e => e.stopPropagation());
  lb.appendChild(vid);

  // Delete-from-preview: removes this birol from the gallery grid. If a video file
  // exists on the server it is deleted too; broken entries (missing/404 video) are
  // simply dropped from the grid. Only shown when opened from a gallery entry.
  if (item && item.id) {
    const del = document.createElement('button');
    del.textContent = '🗑 Delete';
    del.title = 'Delete this birol from the gallery (removes its video file if present)';
    del.style.cssText = 'position:fixed;top:14px;right:16px;z-index:100001;font-size:13px;font-weight:bold;padding:6px 14px;cursor:pointer;background:#d96a6a;color:#fff;border:1px solid #9a4040;border-radius:4px;';
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      const msg = item.videoPath
        ? 'Delete this birol from the gallery?\n\nIts video file is removed from the server too.'
        : 'This birol has no video on the server.\n\nRemove it from the grid?';
      if (!confirm(msg)) return;
      del.disabled = true; del.textContent = '⏳ Deleting…';
      if (item.videoPath) {
        try { await fetch('/api/biroly/delete-video', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ videoPath: item.videoPath }) }); } catch {}
      }
      try {
        const list = getBirolyArchive().filter(e2 => e2.id !== item.id);
        localStorage.setItem(BIROLY_ARCHIVE_KEY, JSON.stringify(list));
        if (typeof loadAllBiroly === 'function') loadAllBiroly();
        window.refreshTimelineBirolys?.();
        window.renderAllTimelines?.();
        if (window.MV2Tab && MV2Tab.refreshMedia) MV2Tab.refreshMedia();
      } catch {}
      lb.style.display = 'none'; try { vid.pause(); } catch {}
    });
    lb.appendChild(del);
  }

  lb.style.display = 'flex';
  // Auto-play (try with audio first; if blocked, mute and retry)
  vid.play().catch(() => { vid.muted = true; vid.play().catch(() => {}); });
}
