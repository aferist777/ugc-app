/* ═══════════════════════════════════════════════════════
   ОБРАЗЫ — saved outfit combinations (char + lb + env)
   ═══════════════════════════════════════════════════════ */

const OBRAZY_KEY = 'obrazy';

function getObrazы() {
  try { return JSON.parse(localStorage.getItem(OBRAZY_KEY) || '[]'); }
  catch { return []; }
}

// variations: optional array (null = pending, 'error' = failed, string = path)
function saveObraz(char, lb, env, name, gender, seed, variations) {
  const list = getObrazы();
  list.unshift({
    id:        Date.now(),
    char:      char   || null,
    lb:        lb     || null,
    env:       env    || null,
    name:      name   || `Образ ${new Date().toLocaleDateString('ru-RU')}`,
    gender:    gender || null,
    seed:      seed   || null,
    projectId: getCurrentProjectId?.() || null,
    date:      new Date().toISOString(),
    variations: variations || [],
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

/* ── Regenerate ALL variations for an образ (full reset, archive old ones) ── */
function regenAllObrazVariations(obraz) {
  if (!obraz.char) return;
  const list = getObrazы();
  const entry = list.find(o => o.id === obraz.id);
  if (entry) {
    // Archive existing completed variations into editResults before reset
    const completed = (entry.variations || []).filter(v => v && v !== 'error');
    if (completed.length) {
      if (!Array.isArray(entry.editResults)) entry.editResults = [];
      completed.forEach(v => {
        if (!entry.editResults.includes(v)) entry.editResults.push(v);
      });
    }
    entry.variations = [null, null, null, null];
    localStorage.setItem(OBRAZY_KEY, JSON.stringify(list));
  }
  loadObrazы();
  loadScenarioObrazы?.();

  const imageEngine = getImageEngine?.() || 'nano-banana-pro';
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
      d.taskIds.forEach((taskId, idx) => pollPoseVariation(obraz.id, taskId, idx));
    })
    .catch(e => setStatus?.('Ошибка: ' + e.message));
}

/* ── Retry failed/missing pose variations for an образ ───────────────────── */
function retryObrazVariations(obraz) {
  if (!obraz.char) return;
  const list  = getObrazы();
  const entry = list.find(o => o.id === obraz.id);
  if (entry) {
    // Archive any already-completed variations before clearing failed slots
    const completed = (entry.variations || []).filter(v => v && v !== 'error');
    if (completed.length) {
      if (!Array.isArray(entry.editResults)) entry.editResults = [];
      completed.forEach(v => {
        if (!entry.editResults.includes(v)) entry.editResults.push(v);
      });
    }
    const hasAny = Array.isArray(entry.variations) && entry.variations.length > 0;
    entry.variations = hasAny
      ? entry.variations.map(v => (v === 'error' || !v) ? null : v)
      : [null, null, null, null];
    localStorage.setItem(OBRAZY_KEY, JSON.stringify(list));
  }
  loadObrazы();
  loadScenarioObrazы?.();

  const imageEngine = getImageEngine?.() || 'nano-banana-pro';
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
      setStatus?.(`Повтор: генерирую ${d.taskIds.length} вариации…`);
      d.taskIds.forEach((taskId, idx) => {
        // Only poll slots that are still null (not already completed)
        const current = getObrazы().find(o => o.id === obraz.id);
        if (current && current.variations[idx] && current.variations[idx] !== 'error') return;
        pollPoseVariation(obraz.id, taskId, idx);
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
      if (!v) {
        const el = document.createElement('div');
        el.className = 'obraz-var-pending';
        el.title     = `Вариация ${i + 1}: генерируется…`;
        charsRow.appendChild(el);
      } else if (v === 'error') {
        const el = document.createElement('div');
        el.className = 'obraz-var-error';
        el.title     = `Вариация ${i + 1}: ошибка — нажмите ↺ для повтора`;
        el.textContent = '✕';
        charsRow.appendChild(el);
      } else {
        const img = document.createElement('img');
        img.src       = toThumbPath(v) + '?t=' + Date.now();
        img.className = 'obraz-var-thumb';
        img.title     = `Вариация ${i + 1}`;
        img.onerror   = () => { img.onerror = null; img.src = v + '?t=' + Date.now(); };
        img.addEventListener('click', () => openLightbox(v));
        charsRow.appendChild(img);
      }
    });

    // Retry button — shown when any slot is error or null
    if (hasErrors) {
      const retryBtn = document.createElement('button');
      retryBtn.className = 'obraz-var-retry-btn';
      retryBtn.textContent = '↺';
      retryBtn.title = 'Повторить генерацию ошибочных вариаций';
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

  // ── Генерации (collapsible): completed variations + edit results ─────────────
  const completedVars = (obraz.variations || []).filter(v => v && v !== 'error');
  const editResults   = obraz.editResults || [];
  const allGeni       = [...completedVars, ...editResults];

  if (allGeni.length) {
    const genSection = document.createElement('div');
    genSection.className = 'obraz-gen-row';

    const toggle = document.createElement('button');
    toggle.className = 'obraz-gen-toggle';
    toggle.textContent = `▶ Генерации (${allGeni.length})`;
    toggle.addEventListener('click', e => {
      e.stopPropagation();
      const body = genSection.querySelector('.obraz-gen-body');
      const open = body.style.display !== 'none';
      body.style.display = open ? 'none' : 'flex';
      toggle.textContent = (open ? '▶' : '▼') + ` Генерации (${allGeni.length})`;
    });

    const body = document.createElement('div');
    body.className = 'obraz-gen-body';
    body.style.display = 'none';

    allGeni.forEach(imgPath => {
      const img = document.createElement('img');
      img.src     = toThumbPath(imgPath) + '?t=' + Date.now();
      img.onerror = () => { img.onerror = null; img.src = imgPath + '?t=' + Date.now(); };
      img.className = 'obraz-gen-thumb';
      img.title = imgPath;
      img.addEventListener('click', e => { e.stopPropagation(); openLightbox(imgPath); });
      body.appendChild(img);
    });

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
}
