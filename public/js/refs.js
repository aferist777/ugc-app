/* ═══════════════════════════════════════════════════════
   REFS — uploaded reference images with AI analysis
   ═══════════════════════════════════════════════════════ */

// ── Load & render ─────────────────────────────────────────────────────────────
async function loadRefs() {
  const grid = document.getElementById('archive-refs-grid');
  if (!grid) return;
  try {
    const d = await fetch('/api/refs/list').then(r => r.json());
    grid.innerHTML = '';
    if (!d.success || !d.refs?.length) {
      grid.innerHTML = '<div class="gallery-empty">Нет сохранённых референсов</div>';
      return;
    }
    d.refs.forEach(ref => grid.appendChild(buildRefCard(ref)));
  } catch (e) {
    console.warn('[refs] load failed:', e.message);
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
  });
  card.appendChild(delBtn);

  return card;
}

// ── Detail lightbox ───────────────────────────────────────────────────────────
function openRefDetail(ref) {
  const existing = document.getElementById('ref-detail-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'ref-detail-overlay';
  overlay.className = 'ref-detail-overlay';
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  const box = document.createElement('div');
  box.className = 'ref-detail-box';

  // Close
  const closeBtn = document.createElement('button');
  closeBtn.className = 'ref-detail-close';
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', () => overlay.remove());
  box.appendChild(closeBtn);

  // ── Left: original image ──────────────────────────────────────────────────
  const imgWrap = document.createElement('div');
  imgWrap.className = 'ref-detail-img-wrap';

  const img = document.createElement('img');
  img.src = ref.originalPath + '?t=' + Date.now();
  img.className = 'ref-detail-img';
  imgWrap.appendChild(img);

  // ── Generations slider (below original) ─────────────────────────────────
  const gens = ref.generations || [];
  if (gens.length) {
    const sliderSection = document.createElement('div');
    sliderSection.className = 'ref-gen-slider-section';

    const sliderLabel = document.createElement('div');
    sliderLabel.className = 'ref-gen-slider-label';
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

      if (gen.seed) {
        const seedEl = document.createElement('div');
        seedEl.className = 'ref-gen-slide-seed';
        seedEl.textContent = 'seed: ' + gen.seed;
        genThumb.appendChild(genImg);
        genThumb.appendChild(seedEl);
      } else {
        genThumb.appendChild(genImg);
      }

      sliderTrack.appendChild(genThumb);
    });

    sliderSection.appendChild(sliderTrack);

    // Scrollbar hint
    const hint = document.createElement('div');
    hint.className = 'ref-gen-slider-hint';
    hint.textContent = '← прокрутите →';
    sliderSection.appendChild(hint);

    imgWrap.appendChild(sliderSection);
  }

  box.appendChild(imgWrap);

  // ── Right: analysis ────────────────────────────────────────────────────────
  const infoWrap = document.createElement('div');
  infoWrap.className = 'ref-detail-info';

  function addSection(label, text) {
    if (!text) return;
    const sec = document.createElement('div');
    sec.className = 'ref-detail-section';

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
    infoWrap.appendChild(sec);
  }

  addSection('Название', ref.title);
  if (ref.seed) addSection('Seed', String(ref.seed));
  addSection('Описание', ref.descriptionRu);
  addSection('Субъекты / действие', ref.subjects);
  addSection('Цветовой профиль / фильтры', ref.colorProfile);
  addSection('Технические маркеры', ref.technicalMarkers);
  if (ref.realismMarkers) addSection('Маркеры реализма', ref.realismMarkers);
  addSection('Промпт для генерации', ref.generationPrompt);

  box.appendChild(infoWrap);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
}
