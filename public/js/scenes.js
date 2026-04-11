/* ═══════════════════════════════════════════════════════
   СЦЕНЫ — saved scene analysis entries
   ═══════════════════════════════════════════════════════ */

function buildSceneCard(scene) {
  const card = document.createElement('div');
  card.className = 'scene-card';
  card.dataset.id = scene.id;

  // Thumbnails row
  const thumbs = document.createElement('div');
  thumbs.className = 'scene-thumbs';

  [
    { path: scene.originalPath,  label: 'Оригинал' },
    { path: scene.generatedPath, label: 'Сгенерировано' },
  ].forEach(({ path: p, label }) => {
    if (!p) return;
    const wrap = document.createElement('div');
    wrap.className = 'scene-thumb-wrap';
    const img = document.createElement('img');
    img.src = toThumbPath(p) + '?t=' + Date.now();
    img.title = label + ' · клик для просмотра';
    img.className = 'scene-thumb';
    img.addEventListener('click', () => openLightbox(p));
    const lbl = document.createElement('div');
    lbl.className = 'scene-thumb-label';
    lbl.textContent = label;
    wrap.appendChild(img);
    wrap.appendChild(lbl);
    thumbs.appendChild(wrap);
  });

  // Text data
  const info = document.createElement('div');
  info.className = 'scene-info';

  const date = new Date(scene.date).toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' });

  const rows = [
    { label: 'Название',   value: scene.title          || '—' },
    { label: 'Дата',       value: date },
    { label: 'Описание',   value: scene.description    || '—' },
    { label: 'Персонажи',  value: scene.actors          || '—' },
    { label: 'Промпт',     value: scene.generationPrompt || '—' },
  ];

  rows.forEach(({ label, value }) => {
    const row = document.createElement('div');
    row.className = 'scene-info-row';
    const lbl = document.createElement('span');
    lbl.className = 'scene-info-label';
    lbl.textContent = label + ':';
    const val = document.createElement('span');
    val.className = 'scene-info-value';
    val.textContent = value;
    row.appendChild(lbl);
    row.appendChild(val);
    info.appendChild(row);
  });

  // Delete button
  const delBtn = document.createElement('button');
  delBtn.className = 'g-delete scene-del';
  delBtn.textContent = '✕';
  delBtn.title = 'Удалить сцену';
  delBtn.addEventListener('click', async e => {
    e.stopPropagation();
    try {
      const r = await fetch(`/api/scene/${scene.id}`, { method: 'DELETE' });
      const d = await r.json();
      if (!d.success) throw new Error(d.error);
      card.remove();
    } catch (err) { setStatus('Ошибка удаления: ' + err.message); }
  });

  card.appendChild(thumbs);
  card.appendChild(info);
  card.appendChild(delBtn);
  return card;
}

async function loadSceneList() {
  const grid = document.getElementById('archive-scenes-grid');
  if (!grid) return;
  try {
    const d = await fetch('/api/scene/list').then(r => r.json());
    grid.innerHTML = '';
    if (!d.success || !d.scenes.length) {
      grid.innerHTML = '<div class="gallery-empty">Нет сохранённых сцен</div>';
      return;
    }
    d.scenes.forEach(s => grid.appendChild(buildSceneCard(s)));
  } catch {
    grid.innerHTML = '<div class="gallery-empty">Ошибка загрузки</div>';
  }
}
