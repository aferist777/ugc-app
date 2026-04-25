/* ═══════════════════════════════════════════════════════
   REFS — uploaded reference images with AI analysis
   ═══════════════════════════════════════════════════════ */

let _refsCurrentCat = 'character'; // active category filter

// ── Category filter bar ───────────────────────────────────────────────────────
document.querySelectorAll('.refs-cat-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.refs-cat-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    _refsCurrentCat = btn.dataset.cat;
    loadRefs();
  });
});

// ── Load & render ─────────────────────────────────────────────────────────────
async function loadRefs() {
  const grid = document.getElementById('archive-refs-grid');
  if (!grid) return;
  grid.innerHTML = '<div class="gallery-empty" style="padding:20px;">Загрузка…</div>';
  try {
    const url = `/api/refs/list?category=${encodeURIComponent(_refsCurrentCat)}`;
    const d = await fetch(url).then(r => r.json());
    grid.innerHTML = '';
    if (!d.success || !d.refs?.length) {
      grid.innerHTML = '<div class="gallery-empty">Нет сохранённых референсов</div>';
      return;
    }
    d.refs.forEach(ref => grid.appendChild(buildRefCard(ref)));
  } catch (e) {
    console.warn('[refs] load failed:', e.message);
    grid.innerHTML = '<div class="gallery-empty">Ошибка загрузки</div>';
  }
}

// ── Build one ref card ────────────────────────────────────────────────────────
function buildRefCard(ref) {
  const card = document.createElement('div');
  card.className = 'ref-card';
  card.dataset.refId = String(ref.id);

  const thumbPath = toThumbPath?.(ref.originalPath) || ref.originalPath;
  const img = document.createElement('img');
  img.src = thumbPath + '?t=' + Date.now();
  img.className = 'ref-thumb';
  img.onerror = () => { img.onerror = null; img.src = ref.originalPath + '?t=' + Date.now(); };
  img.addEventListener('click', () => openRefDetail(ref));
  card.appendChild(img);

  const titleEl = document.createElement('div');
  titleEl.className = 'ref-title';
  titleEl.textContent = ref.title || ref.originalPath;
  card.appendChild(titleEl);

  const dateEl = document.createElement('div');
  dateEl.className = 'ref-date';
  dateEl.textContent = ref.date ? new Date(ref.date).toLocaleDateString('ru-RU') : '';
  card.appendChild(dateEl);

  if (ref.category === 'detail' && ref.analyzed === false) {
    const noBadge = document.createElement('div');
    noBadge.style.cssText = 'font-size:9px;color:#888;margin-top:2px;';
    noBadge.textContent = 'без анализа';
    card.appendChild(noBadge);
  }

  if (ref.generations?.length) {
    const genBadge = document.createElement('div');
    genBadge.className = 'ref-gen-badge';
    genBadge.textContent = `▶ ${ref.generations.length} ген.`;
    card.appendChild(genBadge);
  }

  const delBtn = document.createElement('button');
  delBtn.className = 'g-delete ref-del';
  delBtn.textContent = '✕';
  delBtn.title = 'Удалить референс';
  delBtn.addEventListener('click', async e => {
    e.stopPropagation();
    await fetch(`/api/refs/${ref.id}`, { method: 'DELETE' });
    card.remove();
    // If this was a detail ref, sync the Сценарии details grid
    if (ref.category === 'detail') loadDetails?.();
  });
  card.appendChild(delBtn);

  return card;
}

// ── Archive Details tab ───────────────────────────────────────────────────────
async function loadArchiveDetails() {
  const grid = document.getElementById('archive-details-grid');
  if (!grid) return;
  grid.style.cssText = 'display:flex;flex-direction:column;gap:8px;padding:10px;';
  grid.innerHTML = '<div class="gallery-empty" style="padding:20px;">Загрузка…</div>';
  try {
    const [detailsResp, refsResp] = await Promise.all([
      fetch('/api/details').then(r => r.json()),
      fetch('/api/refs/list?category=detail').then(r => r.json()).catch(() => ({ refs: [] })),
    ]);
    grid.innerHTML = '';
    if (!detailsResp.success || !detailsResp.files?.length) {
      grid.innerHTML = '<div class="gallery-empty">Нет предметов — загрузите через Сценарии → Предметы</div>';
      return;
    }
    // Build maps: by detailFile (exact) and by title (fallback for older entries)
    const refByFile  = new Map();
    const refByTitle = new Map();
    (refsResp.refs || []).forEach(r => {
      if (r.detailFile) refByFile.set(r.detailFile, r);
      if (r.title) refByTitle.set(r.title.toLowerCase().trim(), r);
    });
    detailsResp.files.forEach(item => {
      const ref = refByFile.get(item.file)
        || refByTitle.get((item.name || '').toLowerCase().trim())
        || null;
      grid.appendChild(_buildDetailArchiveCard(item, ref));
    });
  } catch (e) {
    console.warn('[archive-details] load failed:', e.message);
    grid.innerHTML = '<div class="gallery-empty">Ошибка загрузки</div>';
  }
}

function _buildDetailArchiveCard(item, ref) {
  // Merge: details-meta fields take priority; ref data fills gaps
  const mergedName = item.name || ref?.title || '';
  const mergedSize = item.size || ref?.size || '';
  const mergedDesc = item.description || ref?.description || '';

  const card = document.createElement('div');
  card.style.cssText =
    'display:flex;gap:10px;background:#c8c4bc;border:2px solid;' +
    'border-color:#fff #808080 #808080 #fff;padding:8px;box-sizing:border-box;';

  // Thumbnail — click opens full analysis popup if ref exists, else lightbox
  const thumb = document.createElement('img');
  thumb.src = (item.thumbPath || item.path) + '?t=' + Date.now();
  thumb.style.cssText =
    'width:70px;height:100px;object-fit:cover;flex-shrink:0;border:1px solid #808080;cursor:zoom-in;';
  thumb.onerror = () => { thumb.onerror = null; thumb.src = item.path + '?t=' + Date.now(); };
  thumb.addEventListener('click', () => {
    if (ref) {
      // Enrich ref with latest editable values from the card inputs before opening
      openRefDetail({ ...ref, title: nameInput?.value || mergedName });
    } else {
      _openSimpleDetailPopup(item, mergedName, mergedSize, mergedDesc);
    }
  });
  // Badge: "подробнее" if ref available
  const thumbWrap = document.createElement('div');
  thumbWrap.style.cssText = 'position:relative;flex-shrink:0;width:70px;';
  thumbWrap.appendChild(thumb);
  if (ref) {
    const badge = document.createElement('div');
    badge.style.cssText =
      'position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,80,0.7);' +
      'color:#ccd;font-size:8px;text-align:center;padding:1px 0;pointer-events:none;';
    badge.textContent = '▶ подробнее';
    thumbWrap.appendChild(badge);
  }
  card.appendChild(thumbWrap);

  // Fields column
  const fields = document.createElement('div');
  fields.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:5px;min-width:0;';

  const statusEl = document.createElement('span');
  statusEl.style.cssText = 'font-size:9px;color:#888;min-height:13px;display:block;';

  let _saveTimer = null;
  let nameInput, sizeInput, descInput, nameRow, sizeRow, descRow;

  async function _saveMeta() {
    const body = {
      displayName: nameInput.value.trim(),
      size:        sizeInput.value.trim(),
      description: descInput.value.trim(),
    };
    statusEl.textContent = '💾…';
    try {
      const r = await fetch(`/api/details/meta/${encodeURIComponent(item.file)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const rd = await r.json();
      if (!rd.success) throw new Error(rd.error);
      item.name = body.displayName || item.name;
      item.size = body.size;
      item.description = body.description;
      loadDetails?.(); // sync Сценарии details grid + cachedDetailFiles
      statusEl.textContent = '✓ Сохранено';
      setTimeout(() => { statusEl.textContent = ''; }, 2000);
    } catch (e) {
      statusEl.textContent = '⚠ Ошибка: ' + e.message.slice(0, 40);
    }
  }

  function _debounceSave() {
    statusEl.textContent = '…';
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(_saveMeta, 700);
  }

  function _makeField(labelText, value, placeholder, isTextarea) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:flex-start;gap:5px;';
    const lbl = document.createElement('label');
    lbl.style.cssText =
      'font-size:10px;font-weight:bold;color:#444;white-space:nowrap;padding-top:3px;min-width:68px;';
    lbl.textContent = labelText;
    const el = document.createElement(isTextarea ? 'textarea' : 'input');
    el.value = value || '';
    el.placeholder = placeholder;
    el.style.cssText =
      'flex:1;font-size:10px;padding:2px 4px;border:1px solid;' +
      'border-color:#808080 #fff #fff #808080;background:#fff;min-width:0;box-sizing:border-box;';
    if (isTextarea) { el.rows = 2; el.style.cssText += 'resize:vertical;'; }
    el.addEventListener('input', _debounceSave);
    row.appendChild(lbl); row.appendChild(el);
    return { row, el };
  }

  ({ row: nameRow, el: nameInput } = _makeField('Название:', mergedName, 'Имя предмета'));
  ({ row: sizeRow, el: sizeInput } = _makeField('Размер:', mergedSize, 'напр. 30×20 см'));
  ({ row: descRow, el: descInput } = _makeField('Описание:', mergedDesc, 'Материал, бренд, особенности…', true));

  // Bottom row: status + filename + delete
  const bottomRow = document.createElement('div');
  bottomRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-top:2px;';

  const fileLabel = document.createElement('span');
  fileLabel.style.cssText = 'font-size:9px;color:#888;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;';
  fileLabel.textContent = item.file;
  fileLabel.title = item.file;

  const delBtn = document.createElement('button');
  delBtn.textContent = '✕';
  delBtn.title = 'Удалить предмет';
  delBtn.style.cssText =
    'font-size:9px;padding:1px 7px;cursor:pointer;flex-shrink:0;' +
    'border:1px solid #c05050;background:#f8e8e8;color:#aa0000;';
  delBtn.addEventListener('click', async e => {
    e.stopPropagation();
    if (!delBtn._confirming) {
      delBtn._confirming = true;
      delBtn.textContent = 'Удалить?';
      delBtn.style.background = '#f0d0d0';
      setTimeout(() => {
        if (delBtn._confirming) { delBtn._confirming = false; delBtn.textContent = '✕'; delBtn.style.background = '#f8e8e8'; }
      }, 3000);
      return;
    }
    const r = await fetch(`/api/details/${encodeURIComponent(item.file)}`, { method: 'DELETE' });
    const rd = await r.json();
    if (rd.success) { card.remove(); loadDetails?.(); }
    else { statusEl.textContent = '⚠ ' + rd.error; }
  });

  bottomRow.appendChild(statusEl);
  bottomRow.appendChild(fileLabel);
  bottomRow.appendChild(delBtn);

  fields.appendChild(nameRow);
  fields.appendChild(sizeRow);
  fields.appendChild(descRow);
  fields.appendChild(bottomRow);
  card.appendChild(fields);
  return card;
}

// ── Simple popup for detail without ref analysis ─────────────────────────────
function _openSimpleDetailPopup(item, name, size, description) {
  const existing = document.getElementById('ref-detail-overlay');
  if (existing) existing.remove();
  const overlay = document.createElement('div');
  overlay.id = 'ref-detail-overlay';
  overlay.style.cssText =
    'position:fixed;inset:0;background:rgba(0,0,0,0.82);z-index:9500;display:flex;align-items:center;justify-content:center;';
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  const box = document.createElement('div');
  box.style.cssText =
    'background:#c0c0c0;border:2px solid;border-color:#fff #808080 #808080 #fff;' +
    'padding:20px;max-width:500px;width:90%;position:relative;display:flex;gap:16px;';
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.style.cssText =
    'position:absolute;top:8px;right:8px;font-size:11px;padding:2px 8px;cursor:pointer;' +
    'background:#c0c0c0;border:2px solid;border-color:#fff #808080 #808080 #fff;';
  closeBtn.addEventListener('click', () => overlay.remove());
  box.appendChild(closeBtn);
  const img = document.createElement('img');
  img.src = item.path + '?t=' + Date.now();
  img.style.cssText = 'width:120px;height:160px;object-fit:cover;flex-shrink:0;border:1px solid #808080;';
  box.appendChild(img);
  const info = document.createElement('div');
  info.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:8px;padding-top:4px;';
  const addRow = (lbl, val) => {
    if (!val) return;
    const d = document.createElement('div');
    const l = document.createElement('div');
    l.style.cssText = 'font-size:10px;font-weight:bold;color:#555;text-transform:uppercase;margin-bottom:2px;';
    l.textContent = lbl;
    const v = document.createElement('div');
    v.style.cssText = 'font-size:11px;color:#000;line-height:1.4;';
    v.textContent = val;
    d.appendChild(l); d.appendChild(v); info.appendChild(d);
  };
  addRow('Название', name);
  addRow('Размер', size);
  addRow('Описание', description);
  const noData = document.createElement('div');
  noData.style.cssText = 'font-size:10px;color:#888;margin-top:auto;';
  noData.textContent = 'Детальный анализ недоступен (предмет загружен без анализа)';
  info.appendChild(noData);
  box.appendChild(info);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
}

// ── Detail overlay — fullscreen, fills entire interface ──────────────────────
function openRefDetail(ref) {
  const existing = document.getElementById('ref-detail-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'ref-detail-overlay';
  overlay.style.cssText =
    'position:fixed;inset:0;background:rgba(0,0,0,0.82);z-index:9500;display:flex;align-items:stretch;';
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  // ── Main container — fills viewport ──────────────────────────────────────
  const box = document.createElement('div');
  box.style.cssText =
    'display:flex;flex:1;overflow:hidden;position:relative;background:#c0c0c0;' +
    'border:2px solid;border-color:#fff #808080 #808080 #fff;margin:0;';

  // Close button
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕ Закрыть';
  closeBtn.style.cssText =
    'position:absolute;top:8px;right:8px;z-index:10;font-size:11px;padding:3px 10px;cursor:pointer;' +
    'background:#c0c0c0;border:2px solid;border-color:#fff #808080 #808080 #fff;';
  closeBtn.addEventListener('click', () => overlay.remove());
  box.appendChild(closeBtn);

  // ── Left column: full-size image ─────────────────────────────────────────
  const leftCol = document.createElement('div');
  leftCol.style.cssText =
    'flex:0 0 auto;display:flex;flex-direction:column;align-items:center;justify-content:center;' +
    'background:#1a1a1a;padding:16px;min-width:280px;max-width:50%;overflow:hidden;';

  const fullImg = document.createElement('img');
  fullImg.src = ref.originalPath + '?t=' + Date.now();
  fullImg.style.cssText =
    'max-width:100%;max-height:calc(100vh - 80px);object-fit:contain;border:1px solid #555;display:block;';
  leftCol.appendChild(fullImg);

  // Generations slider below image
  const gens = ref.generations || [];
  if (gens.length) {
    const sliderSection = document.createElement('div');
    sliderSection.style.cssText = 'width:100%;margin-top:10px;';

    const sliderLabel = document.createElement('div');
    sliderLabel.style.cssText = 'font-size:10px;font-weight:bold;color:#aaa;text-transform:uppercase;margin-bottom:4px;';
    sliderLabel.textContent = `Генерации (${gens.length})`;
    sliderSection.appendChild(sliderLabel);

    const sliderTrack = document.createElement('div');
    sliderTrack.className = 'ref-gen-slider-track';

    gens.forEach((gen, idx) => {
      const genThumb = document.createElement('div');
      genThumb.className = 'ref-gen-slide';

      const genImg = document.createElement('img');
      const tp = toThumbPath?.(gen.path) || gen.path;
      genImg.src = tp + '?t=' + Date.now();
      genImg.onerror = () => { genImg.onerror = null; genImg.src = gen.path + '?t=' + Date.now(); };
      genImg.className = 'ref-gen-slide-img';
      genImg.title = gen.seed ? `seed: ${gen.seed}` : `Генерация ${idx + 1}`;
      genImg.addEventListener('click', e => { e.stopPropagation(); openLightbox?.(gen.path); });

      genThumb.appendChild(genImg);
      if (gen.seed) {
        const seedEl = document.createElement('div');
        seedEl.className = 'ref-gen-slide-seed';
        seedEl.textContent = 'seed: ' + gen.seed;
        genThumb.appendChild(seedEl);
      }
      sliderTrack.appendChild(genThumb);
    });

    sliderSection.appendChild(sliderTrack);
    leftCol.appendChild(sliderSection);
  }

  box.appendChild(leftCol);

  // ── Right column: analysis data ───────────────────────────────────────────
  const rightCol = document.createElement('div');
  rightCol.style.cssText =
    'flex:1;overflow-y:auto;padding:40px 20px 20px 20px;display:flex;flex-direction:column;gap:10px;';

  const READ_MORE_LIMIT = 500;

  function addSection(label, text) {
    if (!text) return;
    const sec = document.createElement('div');
    sec.style.cssText = 'position:relative;padding-right:32px;';

    const lbl = document.createElement('div');
    lbl.className = 'ref-detail-label';
    lbl.textContent = label;
    sec.appendChild(lbl);

    const val = document.createElement('div');
    val.className = 'ref-detail-value';

    if (text.length > READ_MORE_LIMIT) {
      val.textContent = text.slice(0, READ_MORE_LIMIT) + '…';
      sec.appendChild(val);
      const moreBtn = document.createElement('button');
      moreBtn.textContent = '▼ Читать далее';
      moreBtn.style.cssText =
        'display:block;margin-top:3px;font-size:10px;background:none;border:none;' +
        'color:#0044aa;cursor:pointer;padding:0;text-decoration:underline;';
      let _expanded = false;
      moreBtn.addEventListener('click', () => {
        _expanded = !_expanded;
        val.textContent = _expanded ? text : text.slice(0, READ_MORE_LIMIT) + '…';
        moreBtn.textContent = _expanded ? '▲ Свернуть' : '▼ Читать далее';
      });
      sec.appendChild(moreBtn);
    } else {
      val.textContent = text;
      sec.appendChild(val);
    }

    const copyBtn = document.createElement('button');
    copyBtn.className = 'ref-copy-btn';
    copyBtn.textContent = '⎘';
    copyBtn.title = 'Скопировать';
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(text).then(() => {
        copyBtn.textContent = '✓';
        setTimeout(() => { copyBtn.textContent = '⎘'; }, 1500);
      });
    });
    sec.appendChild(copyBtn);
    rightCol.appendChild(sec);
  }

  addSection('Название', ref.title);
  if (ref.seed) addSection('Seed', String(ref.seed));

  if (ref.category === 'detail') {
    addSection('Размеры', ref.size);
    addSection('Описание', ref.description);
    addSection('Технические детали', ref.technicalDetails);
    if (ref.userNotes) addSection('Заметки пользователя', ref.userNotes);
    addSection('Субъекты', ref.subjects);
    addSection('Цветовой профиль', ref.colorProfile);
    addSection('Промпт для генерации', ref.generationPrompt);

    // Interactions list
    if (Array.isArray(ref.interactions) && ref.interactions.length) {
      const sec = document.createElement('div');
      sec.style.cssText = 'display:flex;flex-direction:column;gap:4px;';
      const lbl = document.createElement('div');
      lbl.className = 'ref-detail-label';
      lbl.textContent = 'Варианты взаимодействий';
      sec.appendChild(lbl);
      ref.interactions.forEach((item, idx) => {
        const row = document.createElement('div');
        row.style.cssText = 'background:#eee;border:1px solid #ccc;padding:5px 8px;font-size:11px;position:relative;padding-right:32px;';
        const labelEl = document.createElement('div');
        labelEl.style.cssText = 'font-weight:bold;margin-bottom:2px;';
        labelEl.textContent = `${idx + 1}. ${item.label || ''}`;
        const promptEl = document.createElement('div');
        promptEl.style.cssText = 'color:#333;line-height:1.4;';
        promptEl.textContent = item.prompt || '';
        const copyBtn = document.createElement('button');
        copyBtn.className = 'ref-copy-btn';
        copyBtn.textContent = '⎘';
        copyBtn.title = 'Скопировать промпт';
        copyBtn.addEventListener('click', () => {
          navigator.clipboard.writeText(item.prompt || '').then(() => {
            copyBtn.textContent = '✓';
            setTimeout(() => { copyBtn.textContent = '⎘'; }, 1500);
          });
        });
        row.appendChild(labelEl);
        row.appendChild(promptEl);
        row.appendChild(copyBtn);
        sec.appendChild(row);
      });
      rightCol.appendChild(sec);
    }
  } else {
    addSection('Описание', ref.descriptionRu);
    addSection('Субъекты / действие', ref.subjects);
    addSection('Цветовой профиль / фильтры', ref.colorProfile);
    addSection('Технические маркеры', ref.technicalMarkers);
    if (ref.realismMarkers) addSection('Маркеры реализма', ref.realismMarkers);
    addSection('Промпт для генерации', ref.generationPrompt);
  }

  box.appendChild(rightCol);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
}
