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

      // Thumbnail (static first frame)
      const thumb = _makeThumb(item, 90, 130);
      card.appendChild(thumb);

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

      // Telegram send button
      if (item.videoFile) {
        const tgBtn = document.createElement('button');
        tgBtn.textContent = '✈ Telegram';
        tgBtn.addEventListener('click', () => _sendToTelegram(item.videoFile, tgBtn));
        actions.appendChild(tgBtn);
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

// ── Combo-tab finals (inside Склейка → Финалы) — list layout ─────────────────
// ── Helper: restore a saved project to Склейка ───────────────────────────────
async function _restoreProjectToSkleyka(jsonFile, btn) {
  btn.disabled = true;
  const origText = btn.textContent;
  btn.textContent = '⏳';
  try {
    const proj = await fetch(jsonFile).then(r => r.json());

    const TIMELINE_KEY = 'timeline_data_v2';
    let tlData = {};
    try { tlData = JSON.parse(localStorage.getItem(TIMELINE_KEY) || '{}'); } catch {}
    if (proj.timelineData) tlData[proj.sessionKey] = proj.timelineData;
    localStorage.setItem(TIMELINE_KEY, JSON.stringify(tlData));

    if (proj.frozenSession && proj.sessionKey) {
      const LS_FROZEN = 'edit_frozen_sessions_v1';
      let sessions = {};
      try { sessions = JSON.parse(localStorage.getItem(LS_FROZEN) || '{}'); } catch {}
      if (!sessions[proj.sessionKey]) {
        sessions[proj.sessionKey] = proj.frozenSession;
        localStorage.setItem(LS_FROZEN, JSON.stringify(sessions));
      }
    }

    document.querySelector('#l1-tabs [aria-controls="l1-skleyka"]')?.click();
    setTimeout(() => {
      document.querySelectorAll('.combo-mode-btn')
        .forEach(b => b.classList.toggle('active', b.dataset.combo === 'skleyka'));
      localStorage.setItem('combo_selected_panel', 'skleyka');
      window.showComboPanel?.('skleyka');
    }, 80);

    btn.textContent = '✓';
    setTimeout(() => { btn.textContent = origText; btn.disabled = false; }, 2000);
  } catch (e) {
    btn.textContent = origText; btn.disabled = false;
    alert('Ошибка: ' + e.message);
  }
}

// ── Helper: make a thumbnail element (img if thumbFile, else video poster via canvas) ──
function _makeThumb(item, w, h) {
  const wrap = document.createElement('div');
  wrap.style.cssText =
    `width:${w}px;height:${h}px;flex-shrink:0;background:#000;cursor:pointer;` +
    `border:1px solid #808080;overflow:hidden;position:relative;`;

  if (item.thumbFile) {
    const img = document.createElement('img');
    img.src = item.thumbFile;
    img.style.cssText = `width:100%;height:100%;object-fit:cover;display:block;`;
    wrap.appendChild(img);
  } else {
    // Fallback: invisible video, capture first frame to canvas on loadeddata
    const vid = document.createElement('video');
    vid.src = item.videoFile || '';
    vid.muted = true; vid.preload = 'metadata';
    vid.style.cssText = 'position:absolute;width:100%;height:100%;object-fit:cover;opacity:0;pointer-events:none;';
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
    vid.addEventListener('loadeddata', () => {
      vid.currentTime = 0.01;
    });
    vid.addEventListener('seeked', () => {
      canvas.width  = vid.videoWidth  || w;
      canvas.height = vid.videoHeight || h;
      canvas.getContext('2d').drawImage(vid, 0, 0, canvas.width, canvas.height);
      vid.remove();
    }, { once: true });
    wrap.appendChild(canvas);
    wrap.appendChild(vid);
  }

  wrap.addEventListener('click', () => _openFinalLightbox(item.videoFile));
  wrap.title = '▶ Смотреть';
  return wrap;
}

// ── Helper: build a single save-version row ───────────────────────────────────
function _buildSaveRow(item, saveIndex, onDeleted) {
  const row = document.createElement('div');
  row.style.cssText =
    'display:flex;align-items:center;gap:6px;padding:4px 8px 4px 12px;' +
    'border-top:1px solid #c8c8c8;background:#e8e4dc;';

  // Save label: "Версия N — дата"
  const label = document.createElement('span');
  label.style.cssText = 'flex:1;font-size:10px;color:#333;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
  const dateStr = item.savedAt
    ? new Date(item.savedAt).toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' })
    : '';
  label.textContent = `Версия ${saveIndex}` + (dateStr ? ` — ${dateStr}` : '');
  row.appendChild(label);

  const btns = document.createElement('div');
  btns.style.cssText = 'display:flex;gap:3px;flex-shrink:0;align-items:center;';

  // Watch
  const watchBtn = document.createElement('button');
  watchBtn.textContent = '▶'; watchBtn.title = 'Смотреть';
  watchBtn.style.cssText = 'font-size:9px;padding:2px 5px;cursor:pointer;';
  watchBtn.addEventListener('click', () => _openFinalLightbox(item.videoFile));
  btns.appendChild(watchBtn);

  // Download
  if (item.videoFile) {
    const dlLink = document.createElement('a');
    dlLink.href = item.videoFile; dlLink.download = '';
    dlLink.textContent = '⬇'; dlLink.title = 'Скачать';
    dlLink.style.cssText =
      'font-size:9px;padding:2px 5px;cursor:pointer;text-decoration:none;' +
      'background:#d4d0c8;border:1px solid #808080;color:#000;display:inline-block;';
    btns.appendChild(dlLink);
  }

  // Open in Склейка
  if (item.jsonFile) {
    const openBtn = document.createElement('button');
    openBtn.textContent = '✏'; openBtn.title = 'Открыть в Склейке';
    openBtn.style.cssText = 'font-size:9px;padding:2px 5px;cursor:pointer;font-weight:bold;';
    openBtn.addEventListener('click', () => _restoreProjectToSkleyka(item.jsonFile, openBtn));
    btns.appendChild(openBtn);
  }

  // Send to Telegram
  if (item.videoFile) {
    const tgBtn = document.createElement('button');
    tgBtn.textContent = '✈'; tgBtn.title = 'Отправить в Telegram';
    tgBtn.style.cssText = 'font-size:9px;padding:2px 5px;cursor:pointer;';
    tgBtn.addEventListener('click', () => _sendToTelegram(item.videoFile, tgBtn));
    btns.appendChild(tgBtn);
  }

  // Delete this version
  const delBtn = document.createElement('button');
  delBtn.textContent = '🗑'; delBtn.title = 'Удалить эту версию';
  delBtn.style.cssText = 'font-size:9px;padding:2px 5px;cursor:pointer;color:#aa0000;';
  delBtn.addEventListener('click', async () => {
    if (!confirm('Удалить эту версию?')) return;
    delBtn.disabled = true;
    try {
      const r = await fetch('/api/finals/delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id }),
      });
      const res = await r.json();
      if (!res.success) throw new Error(res.error);
      row.remove();
      onDeleted();
    } catch (e) { alert('Ошибка: ' + e.message); delBtn.disabled = false; }
  });
  btns.appendChild(delBtn);

  row.appendChild(btns);
  return row;
}

async function loadComboFinals() {
  const list = document.getElementById('combo-finals-grid');
  if (!list) return;
  list.innerHTML = '<div style="color:#888;font-size:11px;padding:8px;">Загрузка…</div>';

  try {
    const d = await fetch('/api/finals/list').then(r => r.json());
    if (!d.success) throw new Error(d.error || 'Ошибка');

    if (!d.finals.length) {
      list.innerHTML = '<div style="color:#888;font-size:11px;padding:8px;">Нет сохранённых финалов</div>';
      return;
    }

    // ── Group by sessionKey (entries without sessionKey each form their own group) ──
    const groups = [];
    const keyIndex = {}; // sessionKey → index in groups[]

    d.finals.forEach(item => {
      const sk = item.sessionKey || `_solo_${item.id}`;
      if (sk in keyIndex) {
        groups[keyIndex[sk]].saves.push(item);
      } else {
        keyIndex[sk] = groups.length;
        groups.push({ sk, label: item.sessionLabel || 'Финал', saves: [item] });
      }
    });

    list.innerHTML = '';

    groups.forEach(group => {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'border-bottom:1px solid #b0b0b0;';

      // ── Group header row ─────────────────────────────────────────────────────
      const latest = group.saves[0]; // newest first (API already sorts newest first)

      const hdr = document.createElement('div');
      hdr.style.cssText =
        'display:flex;align-items:center;gap:8px;padding:6px 4px;cursor:pointer;background:#d4d0c8;';

      // Thumbnail of the latest save
      const thumb = _makeThumb(latest, 36, 52);
      thumb.addEventListener('click', e => e.stopPropagation());
      thumb.addEventListener('click', () => _openFinalLightbox(latest.videoFile));
      hdr.appendChild(thumb);

      // Name + version count
      const info = document.createElement('div');
      info.style.cssText = 'flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;';

      const nameEl = document.createElement('div');
      nameEl.style.cssText =
        'font-size:11px;font-weight:bold;color:#111;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
      nameEl.textContent = group.label;
      nameEl.title = group.label;
      info.appendChild(nameEl);

      const countEl = document.createElement('div');
      countEl.style.cssText = 'font-size:9px;color:#666;';
      const updateCount = () => {
        const n = wrap.querySelectorAll('.final-save-row').length;
        countEl.textContent = `${n} версий`;
      };
      updateCount();
      info.appendChild(countEl);
      hdr.appendChild(info);

      // Expand/collapse arrow
      const arrow = document.createElement('span');
      arrow.style.cssText = 'font-size:9px;color:#444;flex-shrink:0;padding:0 4px;';
      arrow.textContent = '▼';
      hdr.appendChild(arrow);

      // ── Saves body (collapsible) ─────────────────────────────────────────────
      const body = document.createElement('div');
      body.style.display = group.saves.length > 1 ? 'none' : ''; // collapsed if multiple saves

      group.saves.forEach((item, idx) => {
        const saveRow = _buildSaveRow(item, group.saves.length - idx, () => {
          updateCount();
          if (!body.querySelector('.final-save-row')) wrap.remove();
        });
        saveRow.classList.add('final-save-row');
        body.appendChild(saveRow);
      });

      // Toggle on header click
      const toggleBody = () => {
        const open = body.style.display !== 'none';
        body.style.display = open ? 'none' : '';
        arrow.textContent = open ? '▶' : '▼';
      };
      hdr.addEventListener('click', toggleBody);
      // Auto-open if only one save
      if (group.saves.length === 1) {
        body.style.display = '';
        arrow.textContent = '▼';
      }

      wrap.appendChild(hdr);
      wrap.appendChild(body);
      list.appendChild(wrap);
    });
  } catch (e) {
    list.innerHTML = `<div style="color:#cc3333;font-size:11px;padding:8px;">Ошибка: ${e.message}</div>`;
  }
}

window.loadComboFinals = loadComboFinals;

// ── Send final video to Telegram ──────────────────────────────────────────────
async function _sendToTelegram(videoFile, btn) {
  const orig = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳';
  try {
    const r = await fetch('/api/finals/send-telegram', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoFile }),
    });
    const d = await r.json();
    if (!d.success) throw new Error(d.error);
    btn.textContent = '✓ Отправлено';
    btn.style.color = '#006600';
    setTimeout(() => { btn.textContent = orig; btn.style.color = ''; btn.disabled = false; }, 3000);
  } catch (e) {
    btn.textContent = '❌ ' + e.message.slice(0, 40);
    btn.style.color = '#aa0000';
    setTimeout(() => { btn.textContent = orig; btn.style.color = ''; btn.disabled = false; }, 5000);
  }
}
