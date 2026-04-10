/* ═══════════════════════════════════════════════════════
   ОБРАЗЫ — saved outfit combinations (char + lb + env)
   ═══════════════════════════════════════════════════════ */

const OBRAZY_KEY = 'obrazy';

function getObrazы() {
  try { return JSON.parse(localStorage.getItem(OBRAZY_KEY) || '[]'); }
  catch { return []; }
}

function saveObraz(char, lb, env, name, gender) {
  const list = getObrazы();
  list.unshift({
    id:     Date.now(),
    char:   char   || null,
    lb:     lb     || null,
    env:    env    || null,
    name:   name   || `Образ ${new Date().toLocaleDateString('ru-RU')}`,
    gender: gender || null,
    date:   new Date().toISOString(),
  });
  localStorage.setItem(OBRAZY_KEY, JSON.stringify(list));
}

function deleteObraz(id) {
  const list = getObrazы().filter(o => o.id !== id);
  localStorage.setItem(OBRAZY_KEY, JSON.stringify(list));
}

/* ── Build a card for one saved образ ────────────────────────────────────── */
function buildObrazCard(obraz) {
  const card = document.createElement('div');
  card.className = 'obraz-card';

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
    img.addEventListener('click', () => openLightbox(path));
    thumbs.appendChild(img);
  });

  const meta = document.createElement('div');
  meta.className = 'obraz-meta';

  const nameEl = document.createElement('span');
  nameEl.className = 'obraz-name';
  const genderIcon = obraz.gender === 'male' ? '♂ ' : obraz.gender === 'female' ? '♀ ' : '';
  nameEl.textContent = genderIcon + obraz.name;

  const delBtn = document.createElement('button');
  delBtn.className = 'g-delete obraz-del';
  delBtn.textContent = '✕';
  delBtn.title = 'Удалить образ';
  delBtn.addEventListener('click', e => {
    e.stopPropagation();
    deleteObraz(obraz.id);
    card.remove();
  });

  meta.appendChild(nameEl);
  card.appendChild(thumbs);
  card.appendChild(meta);
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
