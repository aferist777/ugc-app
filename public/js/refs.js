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
  grid.innerHTML = '<div class="gallery-empty" style="padding:20px;">Загрузка…</div>';
  try {
    const d = await fetch('/api/refs/list?category=detail').then(r => r.json());
    grid.innerHTML = '';
    if (!d.success || !d.refs?.length) {
      grid.innerHTML = '<div class="gallery-empty">Нет сохранённых предметов</div>';
      return;
    }
    d.refs.forEach(ref => grid.appendChild(buildRefCard(ref)));
  } catch (e) {
    console.warn('[archive-details] load failed:', e.message);
    grid.innerHTML = '<div class="gallery-empty">Ошибка загрузки</div>';
  }
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

  function addSection(label, text) {
    if (!text) return;
    const sec = document.createElement('div');
    sec.style.cssText = 'position:relative;padding-right:32px;';

    const lbl = document.createElement('div');
    lbl.className = 'ref-detail-label';
    lbl.textContent = label;

    const val = document.createElement('div');
    val.className = 'ref-detail-value';
    val.textContent = text;

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

    sec.appendChild(lbl);
    sec.appendChild(val);
    sec.appendChild(copyBtn);
    rightCol.appendChild(sec);
  }

  addSection('Название', ref.title);
  if (ref.seed) addSection('Seed', String(ref.seed));

  if (ref.category === 'detail') {
    // Detail-specific fields
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
