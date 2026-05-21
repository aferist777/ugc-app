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

function getObrazы() {
  try { return JSON.parse(localStorage.getItem(OBRAZY_KEY) || '[]'); }
  catch { return []; }
}

// variations: optional array (null = pending, 'error' = failed, string = path)
// imageEngine: engine used for main image and variations (stored so реран reuses it)
function saveObraz(char, lb, env, name, gender, seed, variations, imageEngine) {
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

/* ── Build a card for one saved образ ────────────────────────────────────── */
function buildObrazCard(obraz) {
  const card = document.createElement('div');
  card.className = 'obraz-card';
  card.dataset.obrazId = String(obraz.id);

  const hasVariations = Array.isArray(obraz.variations) && obraz.variations.length > 0;
  const mainImagePath = _pickMainObrazImage(obraz);

  if (hasVariations) {
    // ── Row 1: original char + variation thumbs ─────────────────────────────
    const charsRow = document.createElement('div');
    charsRow.className = 'obraz-chars-row';

    if (mainImagePath) {
      const img = document.createElement('img');
      img.src       = toThumbPath(mainImagePath) + '?t=' + Date.now();
      img.className = 'obraz-thumb obraz-thumb-char';
      img.title     = 'Original';
      img.onerror   = () => { img.onerror = null; img.src = mainImagePath + '?t=' + Date.now(); };
      img.addEventListener('click', () => openLightbox(mainImagePath));
      charsRow.appendChild(img);
    }

    const hasErrors = obraz.variations.some(v => v === 'error' || v === null);

    obraz.variations.forEach((v, i) => {
      const varWrap = document.createElement('div');
      varWrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:2px;';

      // Visual element — depends on slot state
      if (!v) {
        const el = document.createElement('div');
        el.className = 'obraz-var-pending';
        el.title     = `Variation ${i + 1}: generating…`;
        varWrap.appendChild(el);
      } else if (v === 'error') {
        const el = document.createElement('div');
        el.className = 'obraz-var-error';
        el.title     = `Variation ${i + 1}: error`;
        el.textContent = '✕';
        varWrap.appendChild(el);
      } else {
        const img = document.createElement('img');
        img.src       = toThumbPath(v) + '?t=' + Date.now();
        img.className = 'obraz-var-thumb';
        img.title     = `Variation ${i + 1}`;
        img.onerror   = () => { img.onerror = null; img.src = v + '?t=' + Date.now(); };
        img.addEventListener('click', () => openLightbox(v));
        varWrap.appendChild(img);
      }

      // "реран" — always present in all states
      const reranBtn = document.createElement('button');
      reranBtn.textContent = 'rerun';
      reranBtn.title = 'Regenerate this variation';
      reranBtn.style.cssText = 'font-size:7px;padding:1px 3px;cursor:pointer;width:100%;white-space:nowrap;';
      reranBtn.addEventListener('click', async e => {
        e.stopPropagation();
        reranBtn.disabled = true; reranBtn.textContent = '⏳';

        // Delete the previous posevar file from disk — no archive any more, the
        // new generation replaces the old one outright. Server endpoint reads
        // the path from the request body and unlinks the file + its thumb.
        const prevPath = v && v !== 'error' ? v : null;
        if (prevPath) {
          fetch('/api/obrazy/delete-file', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: prevPath }),
          }).catch(() => {});
        }

        const _list  = getObrazы();
        const _entry = _list.find(o => o.id === obraz.id);
        if (_entry) {
          if (!Array.isArray(_entry.slotTasks))   _entry.slotTasks   = [];
          _entry.variations[i] = null;
          _entry.slotTasks[i]  = null;
          _persistObrazы(_list);
        }

        loadObrazы(); // Immediate re-render showing spinner

        try {
          const engine = obraz.imageEngine || getImageEngine?.() || 'nano-banana-2';
          const r = await fetch('/api/characters/pose-variations', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imagePath: obraz.char, imageEngine: engine, count: 1 }),
          });
          const d = await r.json();
          if (!d.success || !d.taskIds?.length) throw new Error(d.error || 'No taskId');
          setObrazSlotTask(obraz.id, i, d.taskIds[0]);
          pollPoseVariation(obraz.id, d.taskIds[0], i);
        } catch (err) {
          console.error('[реран]', err.message);
          const _l = getObrazы();
          const _e = _l.find(o => o.id === obraz.id);
          if (_e) { _e.variations[i] = 'error'; _persistObrazы(_l); }
          loadObrazы();
        }
      });
      varWrap.appendChild(reranBtn);
      charsRow.appendChild(varWrap);
    });

    // Global retry button — shown when any slot is null or error
    if (hasErrors) {
      const retryBtn = document.createElement('button');
      retryBtn.className = 'obraz-var-retry-btn';
      retryBtn.textContent = '↺';
      retryBtn.title = 'Retry unfinished variations';
      retryBtn.addEventListener('click', e => {
        e.stopPropagation();
        retryBtn.disabled = true;
        retryBtn.textContent = '⏳';
        retryObrazVariations(obraz);
      });
      charsRow.appendChild(retryBtn);
    }

    card.appendChild(charsRow);

    // ── Row 2: assets (lb + env) ────────────────────────────────────────────
    const assetsRow = document.createElement('div');
    assetsRow.className = 'obraz-assets-row';
    [
      { path: obraz.lb,  cls: 'obraz-thumb obraz-thumb-lb'  },
      { path: obraz.env, cls: 'obraz-thumb obraz-thumb-env' },
    ].forEach(({ path, cls }) => {
      if (!path) return;
      const img = document.createElement('img');
      img.src = toThumbPath(path) + '?t=' + Date.now();
      img.className = cls;
      img.onerror = () => { img.onerror = null; img.src = path + '?t=' + Date.now(); };
      img.addEventListener('click', () => openLightbox(path));
      assetsRow.appendChild(img);
    });
    if (assetsRow.children.length) card.appendChild(assetsRow);

  } else {
    // ── Legacy / no-variations layout — show thumbs + generate-variations btn ─
    const thumbs = document.createElement('div');
    thumbs.className = 'obraz-thumbs';
    [
      { path: mainImagePath, cls: 'obraz-thumb obraz-thumb-char' },
      { path: obraz.lb,      cls: 'obraz-thumb obraz-thumb-lb'   },
      { path: obraz.env,     cls: 'obraz-thumb obraz-thumb-env'  },
    ].forEach(({ path, cls }) => {
      if (!path) return;
      const img = document.createElement('img');
      img.src = toThumbPath(path) + '?t=' + Date.now();
      img.className = cls;
      img.onerror = () => { img.onerror = null; img.src = path + '?t=' + Date.now(); };
      img.addEventListener('click', () => openLightbox(path));
      thumbs.appendChild(img);
    });
    card.appendChild(thumbs);

    if (obraz.char) {
      const retryBtn = document.createElement('button');
      retryBtn.className = 'obraz-var-retry-btn obraz-var-retry-gen';
      retryBtn.textContent = '↺ Variations';
      retryBtn.title = 'Generate pose variations for this outfit';
      retryBtn.addEventListener('click', e => {
        e.stopPropagation();
        retryBtn.disabled = true;
        retryBtn.textContent = '⏳';
        retryObrazVariations(obraz);
      });
      card.appendChild(retryBtn);
    }
  }

  // (The "Generations" collapsible — formerly stored replaced pose-variations
  // as obraz.editResults[] — was removed together with the editResults concept.
  // Replaced posevars are now simply unlinked from disk.)

  // ── Meta ────────────────────────────────────────────────────────────────────
  const meta = document.createElement('div');
  meta.className = 'obraz-meta';

  const nameEl = document.createElement('span');
  nameEl.className = 'obraz-name';
  const genderIcon = obraz.gender === 'male' ? '♂ ' : obraz.gender === 'female' ? '♀ ' : '';
  nameEl.textContent = genderIcon + obraz.name;
  meta.appendChild(nameEl);

  if (obraz.seed) {
    const seedEl = document.createElement('div');
    seedEl.className = 'obraz-seed';
    seedEl.textContent = 'seed: ' + obraz.seed;
    meta.appendChild(seedEl);
  }

  // ── Voice selector ─────────────────────────────────────────────────────────
  const voiceRow = document.createElement('div');
  voiceRow.style.cssText = 'display:flex;align-items:center;gap:4px;margin-top:4px;width:100%;';

  const voiceSel = document.createElement('select');
  voiceSel.style.cssText = 'font-size:9px;height:22px;padding:0 2px;flex:1;min-width:0;';
  voiceSel.title = 'ElevenLabs voice for this outfit';
  window.buildVoiceSelect(voiceSel, obraz.voice || 'Rachel');
  window.registerVoiceSelect?.(voiceSel, () => voiceSel.value || obraz.voice || 'Rachel');

  const voicePreviewBtn = document.createElement('button');
  voicePreviewBtn.style.cssText = 'width:22px;height:22px;padding:0;font-size:10px;flex-shrink:0;cursor:pointer;';
  voicePreviewBtn.title = 'Preview voice';
  voicePreviewBtn.textContent = '▷';
  let _previewAudio = null;

  const _findVoice = () => (window.ELEVENLABS_VOICES || []).find(v => (v.id || v.name) === voiceSel.value || v.name === voiceSel.value);

  function _updateObrazVoicePreview() {
    voicePreviewBtn.style.display = ''; // always show — we can preview any voice via tts-preview
  }

  voicePreviewBtn.addEventListener('click', async () => {
    if (_previewAudio) { _previewAudio.pause(); _previewAudio = null; voicePreviewBtn.textContent = '▷'; return; }
    voicePreviewBtn.textContent = '⏳'; voicePreviewBtn.disabled = true;
    try {
      const r = await fetch('/api/audio/tts-preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voice: voiceSel.value }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      if (!d.success) throw new Error(d.error);
      _previewAudio = new Audio(d.audioPath);
      voicePreviewBtn.textContent = '■';
      _previewAudio.play().catch(() => {});
      _previewAudio.addEventListener('ended', () => { _previewAudio = null; voicePreviewBtn.textContent = '▷'; });
    } catch (e) {
      voicePreviewBtn.textContent = '▷';
    } finally {
      voicePreviewBtn.disabled = false;
    }
  });

  voiceSel.addEventListener('change', () => {
    const list  = getObrazы();
    const entry = list.find(o => o.id === obraz.id);
    if (entry) { entry.voice = voiceSel.value; _persistObrazы(list); }
    _updateObrazVoicePreview();
  });

  _updateObrazVoicePreview();
  voiceRow.appendChild(voiceSel);
  voiceRow.appendChild(voicePreviewBtn);
  meta.appendChild(voiceRow);

  if (obraz.char) {
    const regenBtn = document.createElement('button');
    regenBtn.className = 'obraz-regen-btn';
    regenBtn.textContent = '↺';
    regenBtn.title = 'Regenerate variations';
    regenBtn.addEventListener('click', e => {
      e.stopPropagation();
      regenBtn.disabled = true;
      regenBtn.textContent = '⏳';
      regenAllObrazVariations(obraz);
    });
    meta.appendChild(regenBtn);
  }

  card.appendChild(meta);

  // ── Delete ──────────────────────────────────────────────────────────────────
  const delBtn = document.createElement('button');
  delBtn.className = 'g-delete obraz-del';
  delBtn.textContent = '✕';
  delBtn.title = 'Delete outfit';
  delBtn.addEventListener('click', e => {
    e.stopPropagation();
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
      loadObrazы?.();
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
function loadObrazы() {
  const grid = document.getElementById('archive-obrazy-grid');
  if (!grid) return;
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
