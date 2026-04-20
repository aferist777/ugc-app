/* ═══════════════════════════════════════════════════════
   ОБРАЗЫ — saved outfit combinations (char + lb + env)
   ═══════════════════════════════════════════════════════ */

const OBRAZY_KEY = 'obrazy';

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
    name:        name        || `Образ ${new Date().toLocaleDateString('ru-RU')}`,
    gender:      gender      || null,
    seed:        seed        || null,
    imageEngine: imageEngine || null,
    voice:       null,
    projectId:   getCurrentProjectId?.() || null,
    date:        new Date().toISOString(),
    variations:  variations  || [],
    slotTasks:   [],
  });
  localStorage.setItem(OBRAZY_KEY, JSON.stringify(list));
}

function deleteObraz(id) {
  const list = getObrazы().filter(o => o.id !== id);
  localStorage.setItem(OBRAZY_KEY, JSON.stringify(list));
}

// Append an Эдит/pose generation result to obraz.editResults[]
function addObrazEditResult(obrazId, imagePath) {
  const list  = getObrazы();
  const obraz = list.find(o => o.id === obrazId);
  if (!obraz) return;
  if (!Array.isArray(obraz.editResults)) obraz.editResults = [];
  if (obraz.editResults.includes(imagePath)) return; // no duplicates
  obraz.editResults.push(imagePath);
  localStorage.setItem(OBRAZY_KEY, JSON.stringify(list));
  // Refresh the card in the Образы grid if it's currently visible
  const grid = document.getElementById('archive-obrazy-grid');
  if (grid) {
    const card = grid.querySelector(`[data-obraz-id="${obrazId}"]`);
    if (card) {
      const fresh = buildObrazCard(obraz);
      card.replaceWith(fresh);
    }
  }
}

// Update a single variation slot (null → path or 'error')
function setObrazVariation(id, idx, imagePath) {
  const list  = getObrazы();
  const obraz = list.find(o => o.id === id);
  if (!obraz) return;
  if (!Array.isArray(obraz.variations)) obraz.variations = [];
  obraz.variations[idx] = imagePath;
  localStorage.setItem(OBRAZY_KEY, JSON.stringify(list));
}

// Set the active taskId for a specific variation slot
function setObrazSlotTask(obrazId, idx, taskId) {
  const list  = getObrazы();
  const obraz = list.find(o => o.id === obrazId);
  if (!obraz) return;
  if (!Array.isArray(obraz.slotTasks)) obraz.slotTasks = [];
  obraz.slotTasks[idx] = taskId;
  localStorage.setItem(OBRAZY_KEY, JSON.stringify(list));
}

// Fulfill a pose variation result:
// - if taskId is still the active slot owner → fill the slot
// - otherwise → route result to editResults (replaced by a newer реран)
// Returns true if this was the slot owner.
function fulfillObrazSlot(obrazId, taskId, idx, result) {
  const list  = getObrazы();
  const entry = list.find(o => o.id === obrazId);
  if (!entry) return false;
  const isOwner = Array.isArray(entry.slotTasks) && entry.slotTasks[idx] === taskId;
  if (isOwner) {
    if (!Array.isArray(entry.variations)) entry.variations = [];
    entry.variations[idx] = result;
    entry.slotTasks[idx]  = null;
    localStorage.setItem(OBRAZY_KEY, JSON.stringify(list));
    return true;
  } else {
    // Displaced by a newer реран — send result to editResults
    if (!Array.isArray(entry.editResults)) entry.editResults = [];
    const existingIdx = entry.editResults.findIndex(r => r && typeof r === 'object' && r.taskId === taskId);
    if (existingIdx !== -1) {
      entry.editResults[existingIdx] = (result === 'error')
        ? { taskId, state: 'error' }
        : result;
    } else if (result !== 'error') {
      entry.editResults.push(result);
    } else {
      entry.editResults.push({ taskId, state: 'error' });
    }
    localStorage.setItem(OBRAZY_KEY, JSON.stringify(list));
    return false;
  }
}

// Update a pending editResult entry to its final state (path or error)
function resolveEditResultTask(obrazId, taskId, result) {
  const list  = getObrazы();
  const entry = list.find(o => o.id === obrazId);
  if (!entry || !Array.isArray(entry.editResults)) return;
  const idx = entry.editResults.findIndex(r => r && typeof r === 'object' && r.taskId === taskId);
  if (idx !== -1) {
    entry.editResults[idx] = (result === 'error') ? { taskId, state: 'error' } : result;
  } else if (result !== 'error') {
    entry.editResults.push(result);
  }
  localStorage.setItem(OBRAZY_KEY, JSON.stringify(list));
}

// Remove a specific editResult entry (used to delete error entries)
function removeObrazEditResult(obrazId, taskId) {
  const list  = getObrazы();
  const entry = list.find(o => o.id === obrazId);
  if (!entry) return;
  entry.editResults = (entry.editResults || []).filter(r =>
    !(r && typeof r === 'object' && r.taskId === taskId)
  );
  localStorage.setItem(OBRAZY_KEY, JSON.stringify(list));
}

// ── Poll a displaced (non-slot-owner) editResult task ────────────────────────
// Guards against duplicate polling with a Set.
const _activeEditResultPolls = new Set();

async function pollEditResultTask(obrazId, taskId) {
  if (_activeEditResultPolls.has(taskId)) return;
  _activeEditResultPolls.add(taskId);
  const MAX = 100, INTERVAL = 3000; // 5 minutes
  try {
    for (let i = 0; i < MAX; i++) {
      await new Promise(r => setTimeout(r, INTERVAL));
      try {
        const r = await fetch(`/api/characters/pose-status/${taskId}`);
        const d = await r.json();
        if (d.state === 'success') {
          resolveEditResultTask(obrazId, taskId, d.imagePath);
          loadObrazы();
          return;
        }
        if (d.state === 'failed') {
          resolveEditResultTask(obrazId, taskId, 'error');
          loadObrazы();
          return;
        }
      } catch (e) {
        console.warn(`[edit-result-poll] ${taskId}:`, e.message);
      }
    }
    // Timeout after 5 min
    resolveEditResultTask(obrazId, taskId, 'error');
    loadObrazы();
  } finally {
    _activeEditResultPolls.delete(taskId);
  }
}

/* ── Regenerate ALL variations for an образ (full reset, archive old ones) ── */
function regenAllObrazVariations(obraz) {
  if (!obraz.char) return;
  const list  = getObrazы();
  const entry = list.find(o => o.id === obraz.id);
  if (entry) {
    const completed = (entry.variations || []).filter(v => v && v !== 'error');
    if (completed.length) {
      if (!Array.isArray(entry.editResults)) entry.editResults = [];
      completed.forEach(v => { if (!entry.editResults.includes(v)) entry.editResults.push(v); });
    }
    entry.variations = [null, null, null, null];
    entry.slotTasks  = [null, null, null, null];
    localStorage.setItem(OBRAZY_KEY, JSON.stringify(list));
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
        setStatus?.('Ошибка запуска вариаций: ' + (d.error || ''));
        return;
      }
      setStatus?.(`Перегенерация: ${d.taskIds.length} вариации…`);
      d.taskIds.forEach((taskId, idx) => {
        setObrazSlotTask(obraz.id, idx, taskId);
        pollPoseVariation(obraz.id, taskId, idx);
      });
    })
    .catch(e => setStatus?.('Ошибка: ' + e.message));
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
    setStatus?.('Все вариации уже готовы');
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
        setStatus?.('Ошибка запуска вариаций: ' + (d.error || ''));
        return;
      }
      setStatus?.(`Повтор: генерирую ${d.taskIds.length} вариации…`);
      // Map each returned taskId to its specific null/error slot index
      d.taskIds.forEach((taskId, j) => {
        const slotIdx = nullSlots[j];
        if (slotIdx === undefined) return;
        setObrazSlotTask(obraz.id, slotIdx, taskId);
        pollPoseVariation(obraz.id, taskId, slotIdx);
      });
    })
    .catch(e => setStatus?.('Ошибка: ' + e.message));
}

/* ── Build a card for one saved образ ────────────────────────────────────── */
function buildObrazCard(obraz) {
  const card = document.createElement('div');
  card.className = 'obraz-card';
  card.dataset.obrazId = String(obraz.id);

  const hasVariations = Array.isArray(obraz.variations) && obraz.variations.length > 0;

  if (hasVariations) {
    // ── Row 1: original char + variation thumbs ─────────────────────────────
    const charsRow = document.createElement('div');
    charsRow.className = 'obraz-chars-row';

    if (obraz.char) {
      const img = document.createElement('img');
      img.src       = toThumbPath(obraz.char) + '?t=' + Date.now();
      img.className = 'obraz-thumb obraz-thumb-char';
      img.title     = 'Оригинал';
      img.onerror   = () => { img.onerror = null; img.src = obraz.char + '?t=' + Date.now(); };
      img.addEventListener('click', () => openLightbox(obraz.char));
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
        el.title     = `Вариация ${i + 1}: генерируется…`;
        varWrap.appendChild(el);
      } else if (v === 'error') {
        const el = document.createElement('div');
        el.className = 'obraz-var-error';
        el.title     = `Вариация ${i + 1}: ошибка`;
        el.textContent = '✕';
        varWrap.appendChild(el);
      } else {
        const img = document.createElement('img');
        img.src       = toThumbPath(v) + '?t=' + Date.now();
        img.className = 'obraz-var-thumb';
        img.title     = `Вариация ${i + 1}`;
        img.onerror   = () => { img.onerror = null; img.src = v + '?t=' + Date.now(); };
        img.addEventListener('click', () => openLightbox(v));
        varWrap.appendChild(img);
      }

      // "реран" — always present in all states
      const reranBtn = document.createElement('button');
      reranBtn.textContent = 'реран';
      reranBtn.title = 'Перегенерировать эту вариацию';
      reranBtn.style.cssText = 'font-size:7px;padding:1px 3px;cursor:pointer;width:100%;white-space:nowrap;';
      reranBtn.addEventListener('click', async e => {
        e.stopPropagation();
        reranBtn.disabled = true; reranBtn.textContent = '⏳';

        const _list  = getObrazы();
        const _entry = _list.find(o => o.id === obraz.id);
        if (_entry) {
          if (!Array.isArray(_entry.slotTasks))   _entry.slotTasks   = [];
          if (!Array.isArray(_entry.editResults)) _entry.editResults = [];

          // If there's already an active task for this slot, displace it to editResults
          const currentSlotTask = _entry.slotTasks[i];
          if (currentSlotTask) {
            const alreadyTracked = _entry.editResults.some(r => r?.taskId === currentSlotTask);
            if (!alreadyTracked) _entry.editResults.push({ taskId: currentSlotTask, state: 'pending' });
          }
          // Archive completed variation (only valid paths, not null/error)
          if (v && v !== 'error' && !_entry.editResults.includes(v)) {
            _entry.editResults.push(v);
          }
          _entry.variations[i] = null;
          _entry.slotTasks[i]  = null;
          localStorage.setItem(OBRAZY_KEY, JSON.stringify(_list));
        }

        loadObrazы(); // Immediate re-render showing spinner

        try {
          const engine = obraz.imageEngine || getImageEngine?.() || 'nano-banana-2';
          const r = await fetch('/api/characters/pose-variations', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imagePath: obraz.char, imageEngine: engine, count: 1 }),
          });
          const d = await r.json();
          if (!d.success || !d.taskIds?.length) throw new Error(d.error || 'Нет taskId');
          setObrazSlotTask(obraz.id, i, d.taskIds[0]);
          pollPoseVariation(obraz.id, d.taskIds[0], i);
        } catch (err) {
          console.error('[реран]', err.message);
          const _l = getObrazы();
          const _e = _l.find(o => o.id === obraz.id);
          if (_e) { _e.variations[i] = 'error'; localStorage.setItem(OBRAZY_KEY, JSON.stringify(_l)); }
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
      retryBtn.title = 'Повторить генерацию незавершённых вариаций';
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
      { path: obraz.char, cls: 'obraz-thumb obraz-thumb-char' },
      { path: obraz.lb,   cls: 'obraz-thumb obraz-thumb-lb'   },
      { path: obraz.env,  cls: 'obraz-thumb obraz-thumb-env'  },
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
      retryBtn.textContent = '↺ Вариации';
      retryBtn.title = 'Сгенерировать вариации позы для этого образа';
      retryBtn.addEventListener('click', e => {
        e.stopPropagation();
        retryBtn.disabled = true;
        retryBtn.textContent = '⏳';
        retryObrazVariations(obraz);
      });
      card.appendChild(retryBtn);
    }
  }

  // ── Генерации (collapsible): archived/replaced variations ────────────────────
  const editResults = obraz.editResults || [];

  {
    const genSection = document.createElement('div');
    genSection.className = 'obraz-gen-row';

    const toggle = document.createElement('button');
    toggle.className = 'obraz-gen-toggle';
    toggle.textContent = `▶ Генерации (${editResults.length})`;
    toggle.addEventListener('click', e => {
      e.stopPropagation();
      const body = genSection.querySelector('.obraz-gen-body');
      const open = body.style.display !== 'none';
      body.style.display = open ? 'none' : 'flex';
      toggle.textContent = (open ? '▶' : '▼') + ` Генерации (${editResults.length})`;
    });

    const body = document.createElement('div');
    body.className = 'obraz-gen-body';
    body.style.display = 'none';

    editResults.forEach(item => {
      if (typeof item === 'string') {
        // Completed image — click to view
        const img = document.createElement('img');
        img.src     = toThumbPath(item) + '?t=' + Date.now();
        img.onerror = () => { img.onerror = null; img.src = item + '?t=' + Date.now(); };
        img.className = 'obraz-gen-thumb';
        img.title = item;
        img.addEventListener('click', e => { e.stopPropagation(); openLightbox(item); });
        body.appendChild(img);

      } else if (item && typeof item === 'object') {
        if (item.state === 'pending') {
          // Pending — show spinner, ensure poll is running
          const spinner = document.createElement('div');
          spinner.className = 'obraz-var-pending obraz-gen-thumb';
          spinner.title = 'Генерация в процессе…';
          body.appendChild(spinner);
          pollEditResultTask(obraz.id, item.taskId);

        } else if (item.state === 'error') {
          // Error — click to re-check status, delete button to remove
          const errWrap = document.createElement('div');
          errWrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:2px;';

          const errEl = document.createElement('div');
          errEl.className = 'obraz-var-error';
          errEl.title = 'Ошибка генерации — нажмите для проверки статуса';
          errEl.textContent = '✕';
          errEl.style.cursor = 'pointer';
          errEl.addEventListener('click', async e2 => {
            e2.stopPropagation();
            errEl.textContent = '⏳'; errEl.style.cursor = 'default';
            try {
              const rr = await fetch(`/api/characters/pose-status/${item.taskId}`);
              const dd = await rr.json();
              if (dd.state === 'success') {
                resolveEditResultTask(obraz.id, item.taskId, dd.imagePath);
                loadObrazы();
              } else {
                errEl.textContent = '✕'; errEl.style.cursor = 'pointer';
              }
            } catch { errEl.textContent = '✕'; errEl.style.cursor = 'pointer'; }
          });
          errWrap.appendChild(errEl);

          const delErrBtn = document.createElement('button');
          delErrBtn.title = 'Удалить ошибочную генерацию';
          delErrBtn.textContent = '🗑';
          delErrBtn.style.cssText = 'font-size:8px;padding:0 2px;cursor:pointer;';
          delErrBtn.addEventListener('click', e2 => {
            e2.stopPropagation();
            removeObrazEditResult(obraz.id, item.taskId);
            loadObrazы();
          });
          errWrap.appendChild(delErrBtn);
          body.appendChild(errWrap);
        }
      }
    });

    if (!editResults.length) {
      const empty = document.createElement('span');
      empty.style.cssText = 'font-size:9px;color:#888;padding:4px;';
      empty.textContent = 'Нет архивных генераций';
      body.appendChild(empty);
    }

    genSection.appendChild(toggle);
    genSection.appendChild(body);
    card.appendChild(genSection);
  }

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
  voiceSel.title = 'Голос ElevenLabs для этого образа';
  window.buildVoiceSelect(voiceSel, obraz.voice || 'Rachel');

  const voicePreviewBtn = document.createElement('button');
  voicePreviewBtn.style.cssText = 'width:22px;height:22px;padding:0;font-size:10px;flex-shrink:0;cursor:pointer;';
  voicePreviewBtn.title = 'Прослушать голос';
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
    if (entry) { entry.voice = voiceSel.value; localStorage.setItem(OBRAZY_KEY, JSON.stringify(list)); }
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
    regenBtn.title = 'Перегенерировать вариации';
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
  delBtn.title = 'Удалить образ';
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

/* ── Render the Образы tab ───────────────────────────────────────────────── */
function loadObrazы() {
  const grid = document.getElementById('archive-obrazy-grid');
  if (!grid) return;
  const list = getObrazы();
  grid.innerHTML = '';
  if (!list.length) {
    grid.innerHTML = '<div class="gallery-empty">Нет сохранённых образов</div>';
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
