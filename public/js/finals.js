/* ═══════════════════════════════════════════════════════════════════
   FINALS — РЕДИ ФИНАЛЕ ВИДЕОС archive (База данных panel)
   ═══════════════════════════════════════════════════════════════════ */

async function loadFinals() {
  const grid = document.getElementById('archive-finals-grid');
  if (!grid) return;
  grid.innerHTML = '<div class="gallery-empty" style="color:#888;font-size:11px;">Загрузка…</div>';

  try {
    const d = await fetch('/api/finals/list').then(r => r.json());
    if (!d.success) throw new Error(d.error || 'Ошибка');

    if (!d.finals.length) {
      grid.innerHTML = '<div class="gallery-empty">Нет финальных видео</div>';
      return;
    }

    grid.innerHTML = '';
    d.finals.forEach(item => {
      const card = document.createElement('div');
      card.className = 'finals-card';

      // Video player
      const vid = document.createElement('video');
      vid.src = item.videoFile || '';
      vid.controls = false;
      vid.muted = true;
      vid.loop = true;
      vid.preload = 'metadata';
      vid.title = '▶ Смотреть';
      vid.addEventListener('click', () => {
        _openFinalLightbox(item.videoFile);
      });
      vid.addEventListener('mouseenter', () => vid.play().catch(() => {}));
      vid.addEventListener('mouseleave', () => { vid.pause(); vid.currentTime = 0; });
      card.appendChild(vid);

      // Name
      const nameEl = document.createElement('div');
      nameEl.className = 'finals-card-name';
      nameEl.textContent = item.sessionLabel || 'Финал';
      card.appendChild(nameEl);

      // Date
      if (item.savedAt) {
        const dateEl = document.createElement('div');
        dateEl.className = 'finals-card-date';
        dateEl.textContent = new Date(item.savedAt).toLocaleString('ru-RU', {
          day: '2-digit', month: '2-digit', year: '2-digit',
          hour: '2-digit', minute: '2-digit',
        });
        card.appendChild(dateEl);
      }

      // Actions
      const actions = document.createElement('div');
      actions.className = 'finals-card-actions';

      // Watch button
      const watchBtn = document.createElement('button');
      watchBtn.textContent = '▶ Смотреть';
      watchBtn.addEventListener('click', () => _openFinalLightbox(item.videoFile));
      actions.appendChild(watchBtn);

      // Download link
      if (item.videoFile) {
        const dlLink = document.createElement('a');
        dlLink.href = item.videoFile;
        dlLink.download = '';
        dlLink.textContent = '⬇ Скачать';
        actions.appendChild(dlLink);
      }

      // Project JSON link
      if (item.jsonFile) {
        const jsonLink = document.createElement('a');
        jsonLink.href = item.jsonFile;
        jsonLink.download = '';
        jsonLink.textContent = '{ } JSON';
        jsonLink.title = 'Скачать данные проекта';
        actions.appendChild(jsonLink);
      }

      card.appendChild(actions);
      grid.appendChild(card);
    });
  } catch (e) {
    grid.innerHTML = `<div class="gallery-empty" style="color:#cc3333;">Ошибка: ${e.message}</div>`;
  }
}

// ── Video lightbox ─────────────────────────────────────────────────────────────
function _openFinalLightbox(videoPath) {
  let lb = document.getElementById('finals-vid-lb');
  if (!lb) {
    lb = document.createElement('div');
    lb.id = 'finals-vid-lb';
    lb.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.9);z-index:9100;align-items:center;justify-content:center;cursor:pointer;';
    lb.addEventListener('click', () => {
      lb.style.display = 'none';
      lb.querySelector('video')?.pause();
    });
    document.body.appendChild(lb);
  }
  lb.innerHTML = '';
  const vid = document.createElement('video');
  vid.src = videoPath;
  vid.controls = true;
  vid.autoplay = true;
  vid.style.cssText = 'max-width:90vw;max-height:90vh;display:block;';
  vid.addEventListener('click', e => e.stopPropagation());
  lb.appendChild(vid);
  lb.style.display = 'flex';
}

window.loadFinals = loadFinals;
