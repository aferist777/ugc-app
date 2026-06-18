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

// ── Per-type category stores ────────────────────────────────────────────────
// Hooks and uploads have their OWN categories, separate from birols (no cross).
// birols -> 'biroly_cats' (also via getMergedCategories), hooks -> 'hooks_cats',
// uploads -> 'uploads_cats'. All share the {id,label} shape.
function _catKey(type) { return (type || 'biroly') + '_cats'; }
function getTypeCategories(type) {
  try { return JSON.parse(localStorage.getItem(_catKey(type)) || '[]'); } catch { return []; }
}
function addTypeCategory(type, label) {
  label = String(label || '').trim();
  if (!label) return null;
  const arr = getTypeCategories(type);
  const hit = arr.find(c => (c.label || '').toLowerCase() === label.toLowerCase());
  if (hit) return hit;
  const cat = { id: 'cat_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), label };
  arr.push(cat);
  localStorage.setItem(_catKey(type), JSON.stringify(arr));
  return cat;
}
// Small centered popup to name + create a new category for `type`; cb(cat) on create.
function openAddCategoryPopup(type, cb) {
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:100050;display:flex;align-items:center;justify-content:center;';
  const box = document.createElement('div');
  box.style.cssText = 'background:#21232b;color:#eee;border:1px solid #3a3d49;border-radius:11px;box-shadow:0 14px 34px rgba(0,0,0,.6);padding:16px;width:300px;max-width:92vw;font-family:Inter,system-ui,sans-serif;';
  const title = document.createElement('div');
  title.textContent = 'New ' + (type === 'biroly' ? 'birol' : type) + ' category';
  title.style.cssText = 'font-size:13px;font-weight:650;margin-bottom:10px;';
  const inp = document.createElement('input');
  inp.type = 'text'; inp.placeholder = 'Category name';
  inp.style.cssText = 'width:100%;box-sizing:border-box;font-size:13px;padding:7px 9px;border:1px solid #3a3d49;border-radius:8px;background:#16181f;color:#eee;';
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:12px;';
  const cancel = document.createElement('button'); cancel.textContent = 'Cancel';
  cancel.style.cssText = 'font-size:12px;padding:6px 12px;border-radius:8px;border:1px solid #3a3d49;background:#2a2d36;color:#ccc;cursor:pointer;';
  const ok = document.createElement('button'); ok.textContent = 'Add';
  ok.style.cssText = 'font-size:12px;padding:6px 14px;border-radius:8px;border:none;background:#5a6cf0;color:#fff;font-weight:600;cursor:pointer;';
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey, true); };
  const submit = () => { const cat = addTypeCategory(type, inp.value); close(); if (cat && cb) cb(cat); };
  function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); close(); } else if (e.key === 'Enter') { e.preventDefault(); submit(); } }
  cancel.onclick = close; ok.onclick = submit;
  ov.addEventListener('mousedown', e => { if (e.target === ov) close(); });
  document.addEventListener('keydown', onKey, true);
  row.append(cancel, ok); box.append(title, inp, row); ov.appendChild(box); document.body.appendChild(ov);
  setTimeout(() => inp.focus(), 30);
}
window.getTypeCategories = getTypeCategories;
window.addTypeCategory = addTypeCategory;
window.openAddCategoryPopup = openAddCategoryPopup;

// A genuine per-video thumbnail lives in /uploads/thumbs/ and is named
// <videoBase>_thumb.jpg (created by refresh-thumbs from the video's own frame).
// Anything else (e.g. a generated_* source image that the old time-window
// heuristic paired with this video) does NOT belong to it and must never be
// shown as its thumbnail.
function _isValidVideoThumb(thumbPath, videoPath) {
  if (!thumbPath || !videoPath) return false;
  const base = p => String(p).split('/').pop().replace(/\.[^.]+$/, '');
  return thumbPath.includes('/thumbs/') && base(thumbPath).replace(/_thumb$/, '') === base(videoPath);
}

// ── Render a single biroly card into a container ─────────────────────────────
function _renderBirolyCard(item, container) {
    const card = document.createElement('div');
    const gen  = item.status === 'generating';
    const err  = item.status === 'error';
    card.className = 'biroly-archive-card' + (gen ? ' biroly-card-generating' : '');

    // Thumbnail policy: when a video exists, the thumbnail MUST be derived from the
    // video itself (a validated per-video *_thumb.jpg, else the video's own first
    // frame). We never fall back to item.imagePath for a video-bearing card, because
    // for restored birols that path was a time-window *guess* and may belong to a
    // different clip (the "blood thumb on a beaver video" bug).
    let thumb;
    if (!gen && item.videoPath) {
      const validThumb = _isValidVideoThumb(item.thumbPath, item.videoPath) ? item.thumbPath : null;
      if (validThumb) {
        thumb = document.createElement('img');
        thumb.src = validThumb;
      } else {
        thumb = document.createElement('video');
        thumb.src = item.videoPath + '#t=0.5';
        thumb.muted = true;
        thumb.preload = 'metadata';
      }
      thumb.className = 'biroly-archive-thumb';
      thumb.style.cursor = 'pointer';
      thumb.title = '▶ Watch video';
      thumb.addEventListener('click', () => openBirolyVideoLightbox(item.videoPath, validThumb, item));
    } else if (item.imagePath) {
      // No video yet (image-only entry, or still generating) — show the source image.
      thumb = document.createElement('img');
      thumb.src = item.imagePath;
      thumb.className = 'biroly-archive-thumb';
      if (!gen) {
        thumb.title = 'Open image';
        thumb.style.cursor = 'pointer';
        thumb.addEventListener('click', () => openLightbox?.(item.imagePath));
      }
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
      const catSel = document.createElement('select');
      catSel.className = 'biroly-archive-cat-sel';
      catSel.title = 'Category';
      const addOpt = (v, l) => { const o = document.createElement('option'); o.value = v; o.textContent = l; catSel.appendChild(o); };
      addOpt('', '— category —');
      cats.forEach(c => addOpt(c.id, c.label));
      addOpt('__newcat__', '＋ New category…');
      catSel.value = item.categoryId || '';
      const _assign = (id, label) => {
        const list = getBirolyArchive();
        const entry = list.find(en => en.id === item.id);
        if (entry) {
          entry.categoryId    = id;
          entry.categoryLabel = label;
          localStorage.setItem(BIROLY_ARCHIVE_KEY, JSON.stringify(list));
          window.refreshTimelineBirolys?.();
        }
      };
      catSel.addEventListener('click', e => e.stopPropagation());
      catSel.addEventListener('change', e => {
        e.stopPropagation();
        if (catSel.value === '__newcat__') {
          catSel.value = item.categoryId || '';
          openAddCategoryPopup('biroly', cat => { _assign(cat.id, cat.label); loadAllBiroly(); });
          return;
        }
        const c = cats.find(c => c.id === catSel.value);
        _assign(catSel.value, c ? c.label : '');
      });
      meta.appendChild(catSel);
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

    // Migration: drop cross-contaminated thumb/image paths left by the old
    // time-window pairing, so the correct per-video thumbnail gets regenerated
    // below. Idempotent: once a real *_thumb.jpg exists it passes validation.
    list.forEach(e => {
      if (!e.videoPath) return;
      if (e.thumbPath && !_isValidVideoThumb(e.thumbPath, e.videoPath)) { e.thumbPath = null; changed = true; }
      // Restored birols never had a real source image; their imagePath was a guess
      // (and would make delete-files remove another birol's file).
      if (e.name === 'Birol (restored)' && e.imagePath) { e.imagePath = null; changed = true; }
    });

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

// Current page of the "Uncategorised" section (it can hold hundreds of restored
// birols, so it is paged 20 at a time). Survives re-renders, resets on reload.
let _orphanPage = 0;
const BIROLY_PAGE_SIZE = 20;

// Build a centered Prev / "Page X / Y" / Next bar that spans the full grid width.
function _buildBirolyPager(page, totalPages, onGo) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'width:100%;flex-basis:100%;grid-column:1/-1;display:flex;align-items:center;justify-content:center;gap:12px;padding:10px 4px 4px;box-sizing:border-box;';
  const mkBtn = (label, disabled, target) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.disabled = disabled;
    b.style.cssText = 'font-size:11px;padding:3px 12px;border:1px solid #888;border-radius:3px;background:#e8e8e8;color:#000;' + (disabled ? 'opacity:0.4;cursor:default;' : 'cursor:pointer;');
    if (!disabled) b.addEventListener('click', () => onGo(target));
    return b;
  };
  wrap.appendChild(mkBtn('‹ Prev', page <= 0, page - 1));
  const lbl = document.createElement('span');
  lbl.style.cssText = 'font-size:10px;color:#ddd;min-width:84px;text-align:center;';
  lbl.textContent = `Page ${page + 1} / ${totalPages}`;
  wrap.appendChild(lbl);
  wrap.appendChild(mkBtn('Next ›', page >= totalPages - 1, page + 1));
  return wrap;
}

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

// ── Library -> Uploads tab: user-uploaded clips (source:'upload'), own categories ─
function loadAllUploads() {
  const grid = document.getElementById('archive-uploads-grid');
  if (!grid) return;
  const list = getBirolyArchive().filter(it => it && (it.source === 'upload' || it.categoryId === '__uploads__'));
  grid.innerHTML = '';
  if (!list.length) { grid.innerHTML = '<div class="gallery-empty">No uploads yet</div>'; return; }
  const cats = getTypeCategories('uploads');
  const _save = arr => localStorage.setItem(BIROLY_ARCHIVE_KEY, JSON.stringify(arr));
  list.forEach(item => {
    const card = document.createElement('div');
    card.className = 'biroly-archive-card';
    card.style.cssText = 'width:100px;display:flex;flex-direction:column;border:2px solid;border-color:#808080 #fff #fff #808080;background:#c0c0c0;position:relative;';
    const thumbWrap = document.createElement('div');
    thumbWrap.style.cssText = 'width:100%;height:70px;background:#111;overflow:hidden;cursor:pointer;display:flex;align-items:center;justify-content:center;';
    const tsrc = item.thumbPath || item.imagePath;
    if (tsrc) { const img = document.createElement('img'); img.src = tsrc; img.style.cssText = 'width:100%;height:100%;object-fit:cover;'; thumbWrap.appendChild(img); }
    else thumbWrap.innerHTML = '<span style="color:#fff;font-size:20px;">▶</span>';
    thumbWrap.title = '▶ ' + (item.name || 'Upload');
    thumbWrap.addEventListener('click', () => { if (typeof openBirolyVideoLightbox === 'function') openBirolyVideoLightbox(item.videoPath, item.thumbPath || item.imagePath); });
    card.appendChild(thumbWrap);
    const meta = document.createElement('div'); meta.style.cssText = 'padding:3px 4px;display:flex;flex-direction:column;gap:2px;';
    const nameInp = document.createElement('input'); nameInp.type = 'text'; nameInp.value = item.name || 'Upload';
    nameInp.style.cssText = 'font-size:8px;width:100%;box-sizing:border-box;padding:1px 2px;border:1px solid #aaa;';
    nameInp.addEventListener('click', e => e.stopPropagation());
    nameInp.addEventListener('change', () => { const arr = getBirolyArchive(); const e = arr.find(x => x.id === item.id); if (e) { e.name = nameInp.value.trim() || 'Upload'; _save(arr); window.MV2Tab?.refreshMedia?.(); } });
    meta.appendChild(nameInp);
    const catSel = document.createElement('select'); catSel.title = 'Category';
    catSel.style.cssText = 'font-size:8px;width:100%;box-sizing:border-box;padding:1px 2px;border:1px solid #aaa;';
    const addOpt = (v, l) => { const o = document.createElement('option'); o.value = v; o.textContent = l; catSel.appendChild(o); };
    addOpt('', '— uncategorized —'); cats.forEach(c => addOpt(c.id, c.label || c.id)); addOpt('__newcat__', '＋ New category…');
    catSel.value = (item.categoryId && item.categoryId !== '__uploads__') ? item.categoryId : '';
    const _assign = (id, label) => { const arr = getBirolyArchive(); const e = arr.find(x => x.id === item.id); if (e) { e.categoryId = id; e.categoryLabel = label; e.source = 'upload'; _save(arr); window.MV2Tab?.refreshMedia?.(); } };
    catSel.addEventListener('click', e => e.stopPropagation());
    catSel.addEventListener('change', () => {
      if (catSel.value === '__newcat__') { catSel.value = (item.categoryId && item.categoryId !== '__uploads__') ? item.categoryId : ''; openAddCategoryPopup('uploads', cat => { _assign(cat.id, cat.label); loadAllUploads(); }); return; }
      const c = cats.find(c => c.id === catSel.value); _assign(catSel.value, c ? c.label : '');
    });
    meta.appendChild(catSel);
    card.appendChild(meta);
    const delBtn = document.createElement('button'); delBtn.textContent = '✕'; delBtn.title = 'Delete';
    delBtn.style.cssText = 'position:absolute;top:1px;right:1px;width:14px;height:14px;font-size:8px;padding:0;cursor:pointer;background:rgba(200,0,0,0.7);color:#fff;border:none;line-height:14px;text-align:center;';
    delBtn.addEventListener('click', e => { e.stopPropagation(); if (!confirm(`Delete upload "${item.name || ''}"?`)) return; _save(getBirolyArchive().filter(x => x.id !== item.id)); loadAllUploads(); window.MV2Tab?.refreshMedia?.(); window.refreshTimelineBirolys?.(); });
    card.appendChild(delBtn);
    grid.appendChild(card);
  });
}
window.loadAllUploads = loadAllUploads;

function loadAllBiroly() {
  const grid = document.getElementById('archive-biroly-grid');
  if (!grid) return;
  const list = getBirolyArchive().filter(it => !(it && (it.source === 'upload' || it.categoryId === '__uploads__')));
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
    item.status !== 'generating' && item.categoryId !== '__uploads__' && !hasValidCategory(item)
  );
  if (orphanItems.length) {
    const orphKey = '__nocat__';
    const isOpen  = _openBirolyCats.has(orphKey);
    const section = document.createElement('div');
    section.style.cssText = 'width:100%;margin-bottom:4px;';
    const hdr = document.createElement('div');
    hdr.style.cssText = 'width:100%;font-size:10px;font-weight:bold;color:#fff;background:#5a5a4a;border-top:2px solid #777;border-bottom:1px solid #444;padding:4px 8px;box-sizing:border-box;cursor:pointer;user-select:none;letter-spacing:0.03em;';
    const _orphTotalPages = Math.max(1, Math.ceil(orphanItems.length / BIROLY_PAGE_SIZE));
    if (_orphanPage >= _orphTotalPages || _orphanPage < 0) _orphanPage = 0;
    hdr.textContent = (isOpen ? '▼ ' : '▶ ') + `📂 Uncategorised (${orphanItems.length})` +
      (isOpen && _orphTotalPages > 1 ? ` — page ${_orphanPage + 1}/${_orphTotalPages}` : '');
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
    if (isOpen) {
      const startIdx = _orphanPage * BIROLY_PAGE_SIZE;
      orphanItems.slice(startIdx, startIdx + BIROLY_PAGE_SIZE).forEach(item => _renderBirolyCard(item, orphGrid));
      // Pager at the very bottom of the whole "Uncategorised" folder.
      if (_orphTotalPages > 1) {
        section.appendChild(_buildBirolyPager(_orphanPage, _orphTotalPages, (p) => { _orphanPage = p; loadAllBiroly(); }));
      }
    }
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
        e.imagePath  = e.imagePath || null;   // keep the entry's own source image; never adopt a time-window guess
        e.thumbPath  = null;                  // refresh-thumbs derives the real thumb from the video itself
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
      .forEach(({ videoPath, mtime }) => {
        list.push({
          id:        _buid(),
          name:      'Birol (restored)',
          prompt:    '',
          imagePath: null,   // restored entries have no reliable source image
          thumbPath: null,   // refresh-thumbs derives the real thumb from the video
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
