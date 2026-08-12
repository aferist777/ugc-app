/* ═══════════════════════════════════════════════════════
   ОБРАЗЫ — saved outfit combinations (char + lb + env)
   ═══════════════════════════════════════════════════════ */

const OBRAZY_KEY = 'obrazy';

let _obrzSyncTimer = null;
function _persistObrazы(list) {
  localStorage.setItem(OBRAZY_KEY, JSON.stringify(list));
  clearTimeout(_obrzSyncTimer);
  _obrzSyncTimer = setTimeout(() => {
    fetch('/api/userdata/obrazy', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ list }),
    }).catch(() => {});
  }, 1000);
}
// Exposed for the old Character page's edit popup, which persisted voice/name edits through
// it rather than duplicating the LS-write + debounced server-sync logic. That page is gone;
// this stays until someone checks whether Merge or Birols reach for it too.
window._persistObrazы = _persistObrazы;

function getObrazы() {
  try { return JSON.parse(localStorage.getItem(OBRAZY_KEY) || '[]'); }
  catch { return []; }
}

// variations: optional array (null = pending, 'error' = failed, string = path)
// imageEngine: engine used for main image and variations (stored so реран reuses it)
function saveObraz(char, lb, env, name, gender, seed, variations, imageEngine, charId) {
  const list = getObrazы();
  list.unshift({
    id:          Date.now(),
    char:        char        || null,
    lb:          lb          || null,
    env:         env         || null,
    name:        name        || `Outfit ${new Date().toLocaleDateString('en-GB')}`,
    gender:      gender      || null,
    seed:        seed        || null,
    imageEngine: imageEngine || null,
    voice:       null,
    charId:      charId      || null,   // link to a persistent character (actor)
    projectId:   getCurrentProjectId?.() || null,
    date:        new Date().toISOString(),
    variations:  variations  || [],
    slotTasks:   [],
  });
  _persistObrazы(list);
}

function deleteObraz(id) {
  // Capture the entry's name so the backend can resolve the folder. The
  // folder name = obrazFolderName(name, id) — the same helper used at create
  // time, so as long as we send both the server finds the correct directory.
  const entry = getObrazы().find(o => o.id === id);
  const list  = getObrazы().filter(o => o.id !== id);
  _persistObrazы(list);
  if (entry) {
    fetch(`/api/obrazy/${encodeURIComponent(id)}?name=${encodeURIComponent(entry.name || '')}`, {
      method: 'DELETE',
    }).catch(() => {});
  }
}

// Legacy stub — editResults[] storage was retired together with the per-obraz
// folder refactor. Any callers in untouched code paths land here as a no-op.
// Kept callable to avoid ReferenceError until the call sites get cleaned up.
function addObrazEditResult(_obrazId, _imagePath) { /* no-op */ }

// Update a single variation slot (null → path or 'error')
function setObrazVariation(id, idx, imagePath) {
  const list  = getObrazы();
  const obraz = list.find(o => o.id === id);
  if (!obraz) return;
  if (!Array.isArray(obraz.variations)) obraz.variations = [];
  obraz.variations[idx] = imagePath;
  _persistObrazы(list);
}

// Set the active taskId for a specific variation slot
function setObrazSlotTask(obrazId, idx, taskId) {
  const list  = getObrazы();
  const obraz = list.find(o => o.id === obrazId);
  if (!obraz) return;
  if (!Array.isArray(obraz.slotTasks)) obraz.slotTasks = [];
  obraz.slotTasks[idx] = taskId;
  _persistObrazы(list);
}

// Fulfill a pose variation result by filling the slot. The legacy
// editResults[] archive was retired together with the per-obraz folder
// refactor — replaced posevars are deleted from disk, not archived.
// Returns true if the result was applied to the slot.
function fulfillObrazSlot(obrazId, taskId, idx, result) {
  const list  = getObrazы();
  const entry = list.find(o => o.id === obrazId);
  if (!entry) return false;
  // Always fill the slot regardless of slotTasks bookkeeping — there's no
  // archive lane any more, so a stale-task result either lands here or is
  // dropped on the floor (latter only if user already started another rerun
  // and stored a new taskId in slotTasks[idx], in which case the slot is
  // claimed by the newer task).
  const slotIsClaimed = Array.isArray(entry.slotTasks) && entry.slotTasks[idx] && entry.slotTasks[idx] !== taskId;
  if (slotIsClaimed) return false; // displaced — silently drop, no archive
  if (!Array.isArray(entry.variations)) entry.variations = [];
  entry.variations[idx] = result;
  if (Array.isArray(entry.slotTasks)) entry.slotTasks[idx] = null;
  _persistObrazы(list);
  return true;
}

// ── Photoshoot POOL model ─────────────────────────────────────────────────────
// One list of all generations of a photoshoot: obraz.pool = [{ file, card, final }].
// obraz.variations is DERIVED (the final-flagged files) so the dossier / scenarios /
// gallery keep working unchanged. obraz.char (the cover) is left as the base photo.
const OBRAZ_FINAL_MAX = 10;
function _deriveObrazFinals(entry) {
  const pool = Array.isArray(entry.pool) ? entry.pool : [];
  entry.variations = pool.filter(e => e && e.final && e.file).map(e => e.file);
}
function addObrazPoolEntry(obrazId, file, card) {
  if (!file) return;
  const list = getObrazы(); const entry = list.find(o => String(o.id) === String(obrazId)); if (!entry) return;
  if (!Array.isArray(entry.pool)) entry.pool = [];
  if (entry.pool.some(e => e.file === file)) return;   // dedupe
  entry.pool.push({ file, card: (card == null ? null : card), final: false });
  _persistObrazы(list);
}
function toggleObrazPoolFinal(obrazId, file) {
  const list = getObrazы(); const entry = list.find(o => String(o.id) === String(obrazId)); if (!entry) return { ok: false };
  const pool = Array.isArray(entry.pool) ? entry.pool : (entry.pool = []);
  const e = pool.find(x => x.file === file); if (!e) return { ok: false };
  if (!e.final && pool.filter(x => x.final).length >= OBRAZ_FINAL_MAX) return { ok: false, full: true };
  e.final = !e.final;
  _deriveObrazFinals(entry);
  _persistObrazы(list);
  return { ok: true, final: e.final };
}
function deleteObrazPoolEntry(obrazId, file) {
  const list = getObrazы(); const entry = list.find(o => String(o.id) === String(obrazId)); if (!entry) return;
  if (!Array.isArray(entry.pool)) entry.pool = [];
  entry.pool = entry.pool.filter(e => e.file !== file);
  _deriveObrazFinals(entry);
  _persistObrazы(list);
  fetch('/api/obrazy/delete-file', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: file }) }).catch(() => {});
}
function getObrazPool(obrazId) {
  const o = getObrazы().find(x => String(x.id) === String(obrazId));
  return (o && Array.isArray(o.pool)) ? o.pool : [];
}
window.addObrazPoolEntry = addObrazPoolEntry;
window.toggleObrazPoolFinal = toggleObrazPoolFinal;
window.deleteObrazPoolEntry = deleteObrazPoolEntry;
window.getObrazPool = getObrazPool;
window.OBRAZ_FINAL_MAX = OBRAZ_FINAL_MAX;

/* ── Regenerate ALL variations for an образ — full reset, old files deleted ── */
function regenAllObrazVariations(obraz) {
  if (!obraz.char) return;
  const list  = getObrazы();
  const entry = list.find(o => o.id === obraz.id);
  if (entry) {
    // Delete all completed posevar files from disk before clearing slots —
    // editResults archive no longer exists.
    const completed = (entry.variations || []).filter(v => v && v !== 'error');
    completed.forEach(p => {
      fetch('/api/obrazy/delete-file', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: p }),
      }).catch(() => {});
    });
    entry.variations = [null, null, null, null];
    entry.slotTasks  = [null, null, null, null];
    _persistObrazы(list);
  }
  loadObrazы();
  loadScenarioObrazы?.();

  const imageEngine = obraz.imageEngine || getImageEngine?.() || 'nano-banana-2';
  fetch('/api/characters/pose-variations', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imagePath: obraz.char, imageEngine }),
  })
    .then(r => r.json())
    .then(d => {
      if (!d.success || !d.taskIds?.length) {
        setStatus?.('Variation launch error: ' + (d.error || ''));
        return;
      }
      setStatus?.(`Regenerating: ${d.taskIds.length} variations…`);
      d.taskIds.forEach((taskId, idx) => {
        setObrazSlotTask(obraz.id, idx, taskId);
        pollPoseVariation(obraz.id, taskId, idx);
      });
    })
    .catch(e => setStatus?.('Error: ' + e.message));
}

/* ── Retry only null/error variation slots for an образ ─────────────────────── */
function retryObrazVariations(obraz) {
  if (!obraz.char) return;
  const list  = getObrazы();
  const entry = list.find(o => o.id === obraz.id);

  // Collect indices of slots that need regeneration (null or error)
  const nullSlots = ((entry?.variations) || [null, null, null, null])
    .map((v, i) => (v === null || v === 'error') ? i : -1)
    .filter(i => i !== -1);

  if (!nullSlots.length) {
    setStatus?.('All variations already done');
    return;
  }

  if (entry) {
    nullSlots.forEach(i => { entry.variations[i] = null; });
    localStorage.setItem(OBRAZY_KEY, JSON.stringify(list));
  }
  loadObrazы();
  loadScenarioObrazы?.();

  const imageEngine = obraz.imageEngine || getImageEngine?.() || 'nano-banana-2';
  fetch('/api/characters/pose-variations', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imagePath: obraz.char, imageEngine, count: nullSlots.length }),
  })
    .then(r => r.json())
    .then(d => {
      if (!d.success || !d.taskIds?.length) {
        setStatus?.('Variation launch error: ' + (d.error || ''));
        return;
      }
      setStatus?.(`Retry: generating ${d.taskIds.length} variations…`);
      // Map each returned taskId to its specific null/error slot index
      d.taskIds.forEach((taskId, j) => {
        const slotIdx = nullSlots[j];
        if (slotIdx === undefined) return;
        setObrazSlotTask(obraz.id, slotIdx, taskId);
        pollPoseVariation(obraz.id, taskId, slotIdx);
      });
    })
    .catch(e => setStatus?.('Error: ' + e.message));
}

// Poll a pose variation task — respects slot ownership (fulfillObrazSlot routes to
// slot or editResults depending on whether a newer реран has taken ownership).
// Guards against duplicate polling. Timeout after 5 minutes → error.
const _activePoseVariationPolls = new Set();

async function pollPoseVariation(obrazId, taskId, idx) {
  if (_activePoseVariationPolls.has(taskId)) return;
  _activePoseVariationPolls.add(taskId);
  const MAX = 100, INTERVAL = 3000; // 5 minutes
  try {
    for (let i = 0; i < MAX; i++) {
      await new Promise(r => setTimeout(r, INTERVAL));
      try {
        const r = await fetch(`/api/characters/pose-status/${taskId}?obrazId=${encodeURIComponent(obrazId)}`);
        const d = await r.json();
        if (d.state === 'success') {
          const wasOwner = fulfillObrazSlot(obrazId, taskId, idx, d.imagePath);
          loadObrazы();
          window.loadScenarioObrazы?.();
          if (wasOwner) {
            const entry = getObrazы().find(o => o.id === obrazId);
            if (entry?.variations?.every(v => v && v !== null)) setStatus?.('All pose variations ready!');
          }
          return;
        }
        if (d.state === 'failed') {
          console.error(`[pose-var] idx=${idx} failed: ${d.error}`);
          fulfillObrazSlot(obrazId, taskId, idx, 'error');
          loadObrazы();
          window.loadScenarioObrazы?.();
          return;
        }
      } catch (e) {
        console.warn(`[pose-var] poll idx=${idx}:`, e.message);
      }
    }
    // Timeout after 5 min
    console.warn(`[pose-var] timeout idx=${idx} taskId=${taskId}`);
    fulfillObrazSlot(obrazId, taskId, idx, 'error');
    loadObrazы();
    window.loadScenarioObrazы?.();
  } finally {
    _activePoseVariationPolls.delete(taskId);
  }
}

// Cache of "main image" paths keyed by obraz id, populated once on load from
// /api/obrazy/main-images (server scans each obraz folder and returns the
// earliest-mtime image). Filesystem mtime is the source of truth — more
// reliable than parsing timestamps out of filenames.
const _mainImageCache = new Map();
async function _loadMainImageCache() {
  try {
    const r = await fetch('/api/obrazy/main-images');
    const d = await r.json();
    if (!d.success) return;
    Object.entries(d.mainImages || {}).forEach(([id, p]) => _mainImageCache.set(String(id), p));
  } catch {}
}

// Pick the look-image to show as the card's main thumbnail. Order of preference:
//   1. Cached server-computed earliest-mtime image for this obraz id (most accurate).
//   2. obraz.char if present.
//   3. First non-error variation as a last-ditch fallback.
function _pickMainObrazImage(obraz) {
  if (obraz && obraz.id != null) {
    const cached = _mainImageCache.get(String(obraz.id));
    if (cached) return cached;
  }
  if (typeof obraz?.char === 'string' && obraz.char) return obraz.char;
  if (Array.isArray(obraz?.variations)) {
    const fallback = obraz.variations.find(v => typeof v === 'string' && v && v !== 'error');
    if (fallback) return fallback;
  }
  return null;
}
window.pickMainObrazImage = _pickMainObrazImage;

// Generate the 4K 3-angle "technical reference sheet" for an obraz (Seedance appearance
// reference). SSE, backend auto-retries up to 3x. On success writes obraz.refSheet + persists.
// onUpdate(state, path?, label?) reports progress. Lives here (loaded on Character + Scenarios)
// so the photoshoot popup's 4K button works on both pages.
window.generateObrazRefSheet = async function (obrazId, imagePath, onUpdate) {
  if (!obrazId || !imagePath) { try { onUpdate && onUpdate('error', null, 'missing obraz/image'); } catch (e) {} return; }
  const cb = (s, p, l) => { try { onUpdate && onUpdate(s, p, l); } catch (e) {} };
  cb('generating', null, 'starting');
  try {
    const resp = await fetch('/api/characters/reference-sheet', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imagePath, obrazId }) });
    const reader = resp.body.getReader(), dec = new TextDecoder(); let buf = '', img = '', err = '';
    for (;;) { const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true }); let k;
      while ((k = buf.indexOf('\n\n')) >= 0) { const line = buf.slice(0, k); buf = buf.slice(k + 2); if (!line.startsWith('data:')) continue; let o; try { o = JSON.parse(line.slice(5).trim()); } catch (e) { continue; }
        if (o.type === 'step') cb('generating', null, o.label);
        else if (o.type === 'done' && o.image) img = o.image;
        else if (o.type === 'error') err = o.error || 'failed';
      }
    }
    if (img) {
      try { const list = getObrazы(); const o = list.find(x => String(x.id) === String(obrazId)); if (o) { o.refSheet = img; (window._persistObrazы || ((l) => localStorage.setItem('obrazy', JSON.stringify(l))))(list); (typeof loadObrazы === 'function') && loadObrazы(); window.loadScenarioObrazы && window.loadScenarioObrazы(); } } catch (e) {}
      cb('done', img);
    } else cb('error', null, err || 'failed');
  } catch (e) { cb('error', null, e.message); }
};

/* ── Build a tile for one saved образ ──────────────────────────────────────
   New compact grid tile: single thumbnail + name + delete. Everything else
   (variations grid, voice picker, regen button, generations archive) now
   lives in the Character Edit popup which opens on click. Cards with no
   valid voice get a red outline + "Setup voice" badge, signalling the user
   that this obraz isn't usable in scenarios until voice setup is finished.
   ────────────────────────────────────────────────────────────────────────── */
function buildObrazCard(obraz) {
  const card = document.createElement('div');
  card.className = 'obraz-card';
  card.dataset.obrazId = String(obraz.id);

  const hasVariations = Array.isArray(obraz.variations) && obraz.variations.length > 0;
  const mainImagePath = _pickMainObrazImage(obraz);
  const hasPending    = hasVariations && obraz.variations.some(v => v === null);
  const orphan        = window.isOrphanVoiceRef ? window.isOrphanVoiceRef(obraz.voice) : !obraz.voice;
  if (orphan) card.classList.add('obraz-card-orphan');

  // Main thumbnail
  if (mainImagePath) {
    const img = document.createElement('img');
    img.className = 'obraz-card-main';
    img.src       = toThumbPath(mainImagePath) + '?t=' + Date.now();
    img.onerror   = () => { img.onerror = null; img.src = mainImagePath + '?t=' + Date.now(); };
    card.appendChild(img);
  } else {
    const ph = document.createElement('div');
    ph.className = 'obraz-card-main';
    ph.style.cssText += 'display:flex;align-items:center;justify-content:center;color:#666;font-size:11px;';
    ph.textContent = 'No image';
    card.appendChild(ph);
  }

  // Pending status line
  if (hasPending) {
    const bar = document.createElement('div');
    bar.className = 'obraz-card-pending-bar';
    const done = obraz.variations.filter(v => v && v !== 'error' && v !== null).length;
    bar.textContent = `⏳ variations ${done}/${obraz.variations.length}`;
    card.appendChild(bar);
  }

  // Name row
  const nameRow = document.createElement('div');
  nameRow.className = 'obraz-card-name';
  const genderIcon = obraz.gender === 'male' ? '♂ ' : obraz.gender === 'female' ? '♀ ' : '';
  nameRow.textContent = genderIcon + (obraz.name || '');
  card.appendChild(nameRow);

  // Click on tile → open the popup
  card.addEventListener('click', e => {
    if (e.target.closest('.obraz-del')) return; // don't open when deleting
    window.openCharacterEditPopup?.(obraz.id);
  });

  // Delete (two-click confirm)
  const delBtn = document.createElement('button');
  delBtn.className = 'g-delete obraz-del';
  delBtn.textContent = '✕';
  delBtn.title = 'Click twice to delete outfit';
  delBtn.style.cssText = 'position:absolute;top:3px;right:3px;width:18px;height:18px;cursor:pointer;font-size:11px;padding:0;display:block;z-index:5;';
  let _delTimer = null;
  delBtn.addEventListener('click', e => {
    e.stopPropagation();
    if (!delBtn.dataset.armed) {
      delBtn.dataset.armed = '1';
      delBtn.style.background = '#a02020';
      delBtn.style.color = '#fff';
      _delTimer = setTimeout(() => {
        delBtn.dataset.armed = '';
        delBtn.style.background = '';
        delBtn.style.color = '';
      }, 2000);
      return;
    }
    clearTimeout(_delTimer);
    deleteObraz(obraz.id);
    card.remove();
    window.loadCharCol3Obrazy?.();
    loadScenarioObrazы?.();
  });
  card.appendChild(delBtn);

  return card;
}


/* ── Server-side persistence bootstrap ──────────────────────────────────── */
(async () => {
  // Note: __just_imported_at sentinel (set by data-io.js after Import) is
  // handled per-bootstrap. For obrazy the existing flow already pulls
  // from server unconditionally — both the import case and the normal
  // case want server-side data to win — so no special branch is needed
  // here. biroly-server-sync needs special handling because biroly.js
  // eagerly writes defaults to LS on init, racing the pull.
  try {
    const r = await fetch('/api/userdata/obrazy');
    const d = await r.json();
    if (!d.success) return;
    // Populate main-image cache in parallel so the first render has it.
    await _loadMainImageCache();
    if (d.list?.length) {
      localStorage.setItem(OBRAZY_KEY, JSON.stringify(d.list));
      // The Library Obrazy grid renders lazily on first popup open; only refresh
      // it here if it's already on screen (avoids fetching every obraz thumbnail
      // into the hidden Library popup on every page load).
      if (document.getElementById('archive-obrazy')?.classList.contains('active')) loadObrazы?.();
      // Re-render the Character-tab compact row too — it was already drawn
      // synchronously on page load with whatever was in LS before this fetch.
      window.loadCharCol3Obrazy?.();
    } else {
      const local = getObrazы();
      if (local.length) {
        fetch('/api/userdata/obrazy', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ list: local }),
        }).catch(() => {});
      }
    }
  } catch {}
})();

/* ── Render the Образы tab ───────────────────────────────────────────────── */
// Awaits window.elVoicesReady so isOrphanVoiceRef(obraz.voice) inside
// buildObrazCard sees the loaded catalog. Without this gate the boot-time
// render races the /api/audio/custom-voices fetch and falsely flags every
// voiced obraz as orphan (red + click-opens-popup). After the first resolve
// the Promise stays resolved → all subsequent calls run with zero await cost.
// One-click maintenance: prune obrazy (and geni history) whose image files are
// missing on the server, then refresh the local list + every obraz renderer.
// Orphan obrazy (e.g. left by a partial import) otherwise 404 in the Looks row.
function _ensureObrazPruneBtn() {
  const panel = document.getElementById('archive-obrazy');
  if (!panel || document.getElementById('obraz-prune-btn')) return;
  const bar = document.createElement('div');
  bar.style.cssText = 'display:flex;justify-content:flex-end;padding:4px 0 8px;';
  const btn = document.createElement('button');
  btn.id = 'obraz-prune-btn';
  btn.textContent = '🧹 Remove outfits without images';
  btn.title = 'Remove outfits that have no image files on the server (broken entries)';
  btn.style.cssText = 'font-size:12px;padding:5px 12px;cursor:pointer;border:1px solid #888;border-radius:4px;background:#f3f3f3;';
  btn.addEventListener('click', () => pruneMissingObrazy(btn));
  bar.appendChild(btn);
  const grid = document.getElementById('archive-obrazy-grid');
  panel.insertBefore(bar, grid || panel.firstChild);
}
async function pruneMissingObrazy(btn) {
  const orig = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '🧹 Checking…'; }
  try {
    const r = await fetch('/api/obrazy/prune-missing', { method: 'POST' });
    const d = await r.json();
    if (!d.success) throw new Error(d.error || 'prune failed');
    if (Array.isArray(d.obrazy)) localStorage.setItem(OBRAZY_KEY, JSON.stringify(d.obrazy));
    if (Array.isArray(d.geni))   { try { localStorage.setItem('all_geni_v1', JSON.stringify(d.geni)); } catch {} }
    try { window._missingImgUrls && window._missingImgUrls.clear(); } catch {}
    loadObrazы();
    window.loadCharCol3Obrazy?.();
    window.loadScenarioObrazы?.();
    const removed = d.removedObrazy || [];
    const names = removed.map(o => o.name).filter(Boolean).join(', ');
    const msg = removed.length
      ? `Outfits without images removed: ${removed.length}${names ? ' (' + names + ')' : ''}${d.removedGeniCount ? ' · geni entries: ' + d.removedGeniCount : ''}`
      : 'No broken outfits found.';
    window.setStatus?.(msg);
    alert(msg);
  } catch (e) {
    const m = 'Cleanup error: ' + ((e && e.message) || e);
    window.setStatus?.(m); alert(m);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = orig || '🧹 Remove outfits without images'; }
  }
}

async function loadObrazы() {
  await window.elVoicesReady;
  const grid = document.getElementById('archive-obrazy-grid');
  if (!grid) return;
  _ensureObrazPruneBtn();
  const list = getObrazы();
  grid.innerHTML = '';
  if (!list.length) {
    grid.innerHTML = '<div class="gallery-empty">No saved outfits</div>';
    return;
  }
  list.forEach(o => grid.appendChild(buildObrazCard(o)));

  // Restart any polls that were active before page reload
  list.forEach(o => {
    // Active slot tasks
    (o.slotTasks || []).forEach((taskId, idx) => {
      if (taskId) pollPoseVariation(o.id, taskId, idx);
    });
    // Pending editResult tasks (card render already calls pollEditResultTask, but guard handles dedup)
  });
}
