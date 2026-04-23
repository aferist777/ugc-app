/* scen-hooks.js — Хуки: upload in Биролы tab + per-session activation in Склейка */

const HOOKS_ARCHIVE_KEY = 'hooks_archive_v1';
function getHooksArchive()  { try { return JSON.parse(localStorage.getItem(HOOKS_ARCHIVE_KEY) || '[]'); } catch { return []; } }
function setHooksArchive(a) { localStorage.setItem(HOOKS_ARCHIVE_KEY, JSON.stringify(a)); }
function _huid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }

const HOOKS_MAX_MB = 20;

// ── Client-side video thumbnail via canvas ────────────────────────────────────
function generateVideoThumb(file, w = 200) {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file);
    const vid = document.createElement('video');
    vid.muted = true;
    vid.playsInline = true;
    vid.preload = 'metadata';
    let done = false;
    const finish = (dataUrl) => {
      if (done) return;
      done = true;
      URL.revokeObjectURL(url);
      resolve(dataUrl);
    };
    const drawFrame = () => {
      try {
        const h = vid.videoHeight ? Math.round(vid.videoHeight / vid.videoWidth * w) : Math.round(w * 9 / 16);
        const canvas = document.createElement('canvas');
        canvas.width  = w;
        canvas.height = h || 120;
        canvas.getContext('2d').drawImage(vid, 0, 0, canvas.width, canvas.height);
        finish(canvas.toDataURL('image/jpeg', 0.75));
      } catch { finish(null); }
    };
    vid.addEventListener('seeked',  drawFrame, { once: true });
    vid.addEventListener('error',   () => finish(null), { once: true });
    vid.addEventListener('loadedmetadata', () => {
      vid.currentTime = Math.min(0.5, (vid.duration || 1) * 0.1);
    }, { once: true });
    setTimeout(() => finish(null), 6000);
    vid.src = url;
  });
}

// ── Mini video preview lightbox (used inside popup) ───────────────────────────
function openVideoPreviewPopup(file) {
  const url = URL.createObjectURL(file);
  let lb = document.getElementById('hooks-vid-preview-lb');
  if (!lb) {
    lb = document.createElement('div');
    lb.id = 'hooks-vid-preview-lb';
    lb.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:11000;align-items:center;justify-content:center;cursor:pointer;';
    document.body.appendChild(lb);
  }
  lb.innerHTML = '';
  const vid = document.createElement('video');
  vid.src = vid._objectUrl = url;
  vid.controls = true;
  vid.autoplay = true;
  vid.style.cssText = 'max-width:92vw;max-height:90vh;display:block;';
  vid.addEventListener('click', e => e.stopPropagation());
  lb.appendChild(vid);
  lb.style.display = 'flex';
  lb.onclick = () => {
    lb.style.display = 'none';
    vid.pause();
    URL.revokeObjectURL(url);
  };
}

// ── Upload popup: preview grid + rename + confirm ────────────────────────────
async function openHooksUploadPopup(rawFiles) {
  // Filter by size
  const valid     = rawFiles.filter(f => f.size <= HOOKS_MAX_MB * 1024 * 1024);
  const oversized = rawFiles.filter(f => f.size >  HOOKS_MAX_MB * 1024 * 1024);

  if (!valid.length) {
    alert(`Все файлы превышают ${HOOKS_MAX_MB} МБ.\nМаксимальный размер файла: ${HOOKS_MAX_MB} МБ.`);
    return;
  }

  // Show popup skeleton immediately
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:10000;display:flex;align-items:center;justify-content:center;';
  document.body.appendChild(overlay);

  const popup = document.createElement('div');
  popup.style.cssText = 'background:#c0c0c0;border:2px solid;border-color:#fff #808080 #808080 #fff;padding:10px;min-width:320px;max-width:92vw;max-height:90vh;display:flex;flex-direction:column;gap:8px;box-sizing:border-box;';

  // Title bar
  const titleBar = document.createElement('div');
  titleBar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;background:#000080;color:#fff;padding:3px 8px;margin:-10px -10px 0;flex-shrink:0;';
  const titleTxt = document.createElement('span');
  titleTxt.style.cssText = 'font-size:11px;font-weight:bold;';
  titleTxt.textContent = `Загрузка хуков (${valid.length} файл${valid.length === 1 ? '' : valid.length < 5 ? 'а' : 'ов'})`;
  const closeBtnT = document.createElement('button');
  closeBtnT.textContent = '✕';
  closeBtnT.style.cssText = 'background:none;border:none;color:#fff;cursor:pointer;font-size:13px;padding:0 2px;line-height:1;';
  closeBtnT.addEventListener('click', () => overlay.remove());
  titleBar.appendChild(titleTxt);
  titleBar.appendChild(closeBtnT);
  popup.appendChild(titleBar);

  // Oversized warning
  if (oversized.length) {
    const warn = document.createElement('div');
    warn.style.cssText = 'font-size:9px;color:#993300;background:#ffe0d0;padding:4px 6px;border:1px solid #cc6633;flex-shrink:0;';
    warn.textContent = `⚠ Пропущены (> ${HOOKS_MAX_MB} МБ): ${oversized.map(f => f.name).join(', ')}`;
    popup.appendChild(warn);
  }

  // Grid placeholder while generating thumbs
  const grid = document.createElement('div');
  grid.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;overflow-y:auto;max-height:55vh;padding:4px;flex:1;';
  grid.innerHTML = '<span style="font-size:10px;color:#555;padding:8px;">⏳ Генерируем превью…</span>';
  popup.appendChild(grid);

  // Status + buttons row (rendered now, active after thumbs load)
  const statusEl = document.createElement('span');
  statusEl.style.cssText = 'font-size:9px;color:#555;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Отмена';
  cancelBtn.style.cssText = 'font-size:9px;padding:3px 10px;cursor:pointer;flex-shrink:0;';
  cancelBtn.addEventListener('click', () => overlay.remove());

  const addBtn = document.createElement('button');
  addBtn.textContent = `Добавить (${valid.length})`;
  addBtn.disabled = true;
  addBtn.style.cssText = 'font-size:9px;padding:3px 14px;cursor:pointer;background:#c0ffc0;border:1px solid #4a8a4a;font-weight:bold;flex-shrink:0;';

  const bottomRow = document.createElement('div');
  bottomRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-top:2px;flex-shrink:0;';
  bottomRow.appendChild(statusEl);
  bottomRow.appendChild(cancelBtn);
  bottomRow.appendChild(addBtn);
  popup.appendChild(bottomRow);

  overlay.appendChild(popup);
  popup.addEventListener('mousedown', e => e.stopPropagation());
  popup.addEventListener('click',     e => e.stopPropagation());
  overlay.addEventListener('mousedown', e => { if (e.target === overlay) overlay.remove(); });

  // Generate thumbnails in parallel
  const items = await Promise.all(valid.map(async file => ({
    file,
    name: file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Zа-яА-ЯёЁ0-9_\- ]/g, '').trim().slice(0, 50) || 'hook',
    thumb: await generateVideoThumb(file),
  })));

  // Render preview cards (re-callable when items array changes)
  const renderGrid = () => {
    grid.innerHTML = '';
    addBtn.textContent = `Добавить (${items.length})`;
    addBtn.disabled = items.length === 0;
    items.forEach((item, i) => {
      const card = document.createElement('div');
      card.style.cssText = 'display:flex;flex-direction:column;gap:3px;width:110px;background:#e0e0e0;padding:4px;border:1px solid #aaa;flex-shrink:0;position:relative;';

      // Remove from list button
      const delX = document.createElement('button');
      delX.textContent = '✕';
      delX.title = 'Убрать из загрузки';
      delX.style.cssText = 'position:absolute;top:2px;right:2px;width:16px;height:16px;font-size:9px;padding:0;line-height:16px;text-align:center;cursor:pointer;background:rgba(180,0,0,0.75);color:#fff;border:none;z-index:2;border-radius:2px;';
      delX.addEventListener('click', () => { items.splice(i, 1); renderGrid(); });
      card.appendChild(delX);

      const thumbWrap = document.createElement('div');
      thumbWrap.style.cssText = 'width:100%;height:68px;background:#111;overflow:hidden;cursor:pointer;border:1px solid #808080;display:flex;align-items:center;justify-content:center;';
      thumbWrap.title = '▶ Нажмите для предпросмотра';
      thumbWrap.addEventListener('click', () => openVideoPreviewPopup(item.file));
      if (item.thumb) {
        const img = document.createElement('img');
        img.src = item.thumb;
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
        thumbWrap.appendChild(img);
      } else {
        thumbWrap.innerHTML = '<span style="color:#fff;font-size:22px;pointer-events:none;">▶</span>';
      }
      card.appendChild(thumbWrap);

      const nameInp = document.createElement('input');
      nameInp.type  = 'text';
      nameInp.value = item.name;
      nameInp.style.cssText = 'font-size:9px;width:100%;box-sizing:border-box;padding:2px 3px;border:1px solid #aaa;';
      nameInp.placeholder = 'Название';
      nameInp.addEventListener('input',  () => { items[i].name = nameInp.value; });
      nameInp.addEventListener('change', () => { items[i].name = nameInp.value.trim() || item.file.name.replace(/\.[^.]+$/, ''); nameInp.value = items[i].name; });
      card.appendChild(nameInp);

      const sizeEl = document.createElement('div');
      sizeEl.style.cssText = 'font-size:8px;color:#666;';
      sizeEl.textContent = (item.file.size / (1024 * 1024)).toFixed(1) + ' МБ';
      card.appendChild(sizeEl);

      grid.appendChild(card);
    });
  };
  renderGrid();

  // Upload handler
  addBtn.addEventListener('click', async () => {
    addBtn.disabled   = true;
    cancelBtn.disabled = true;
    let done = 0, failed = 0;

    const totalToUpload = items.length;
    for (const item of items) {
      statusEl.textContent = `⏳ ${done + failed + 1}/${totalToUpload} ${item.name}…`;
      try {
        const formData = new FormData();
        formData.append('video', item.file, item.file.name);
        formData.append('name',  item.name);
        const r  = await fetch('/api/hooks/upload', { method: 'POST', body: formData });
        let rj;
        try { rj = await r.json(); }
        catch (e) { throw new Error(`Сервер вернул не-JSON (статус ${r.status})`); }
        if (!rj.success) throw new Error(rj.error || `Ошибка сервера (${r.status})`);
        const arr = getHooksArchive();
        arr.unshift({
          id:        _huid(),
          name:      rj.name,
          filename:  rj.filename,
          videoPath: rj.videoPath,
          thumbPath: rj.thumbPath || null,
          date:      new Date().toISOString(),
        });
        setHooksArchive(arr);
        console.log('[hooks] saved to archive:', rj.filename, '| total:', arr.length);
        done++;
      } catch (err) {
        failed++;
        console.error('[hooks upload] ОШИБКА:', item.file.name, '—', err.message);
        statusEl.textContent = `⚠ ${item.file.name}: ${err.message}`;
      }
    }

    overlay.remove();
    renderHooksSection();
    loadAllHooks();
    window.refreshTimelineBirolys?.();
    console.log('[hooks] archive after upload:', getHooksArchive());

    const uploadStatus = document.getElementById('hooks-upload-status');
    if (uploadStatus) {
      uploadStatus.textContent = failed
        ? `✓ ${done} загружено, ⚠ ${failed} ошибок`
        : `✓ Загружено: ${done}`;
      setTimeout(() => { uploadStatus.textContent = ''; }, 4000);
    }
  });
}

// ── Биролы tab Col 3: upload control + hooks grid ────────────────────────────
function renderHooksSection() {
  const uploadBtn    = document.getElementById('hooks-upload-btn');
  const uploadInput  = document.getElementById('hooks-upload-input');
  const section      = document.getElementById('hooks-section');
  const details      = document.getElementById('hooks-details');
  const arrow        = document.getElementById('hooks-arrow');

  if (uploadBtn && !uploadBtn._hooksInited) {
    uploadBtn._hooksInited = true;

    // Button click → trigger hidden file input; stop event so details won't toggle
    uploadBtn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      uploadInput?.click();
    });

    // File input change → open popup
    uploadInput?.addEventListener('change', async () => {
      const files = Array.from(uploadInput.files || []);
      uploadInput.value = ''; // reset so re-selecting same files works
      if (files.length) await openHooksUploadPopup(files);
    });

    // Update arrow on details toggle
    if (details && arrow) {
      details.addEventListener('toggle', () => {
        arrow.textContent = details.open ? '▼' : '▶';
      });
    }

    // Drag & drop on hooks section
    if (section) {
      section.addEventListener('dragover', e => {
        e.preventDefault();
        section.style.outline = '2px dashed #4a8a4a';
        section.style.outlineOffset = '-2px';
      });
      section.addEventListener('dragleave', e => {
        if (!section.contains(e.relatedTarget)) {
          section.style.outline = '';
          section.style.outlineOffset = '';
        }
      });
      section.addEventListener('drop', async e => {
        e.preventDefault();
        section.style.outline = '';
        section.style.outlineOffset = '';
        const files = Array.from(e.dataTransfer.files || []).filter(f => f.type.startsWith('video/') || /\.(mp4|mov|avi|webm|mkv)$/i.test(f.name));
        if (files.length) await openHooksUploadPopup(files);
      });
    }
  }

  // Update title with count
  const titleEl = document.getElementById('hooks-title');
  const list = getHooksArchive();
  if (titleEl) titleEl.textContent = 'Хуки' + (list.length ? ` (${list.length})` : '');

  // Render grid
  const grid = document.getElementById('hooks-grid');
  if (!grid) return;
  grid.innerHTML = '';
  if (!list.length) {
    const empty = document.createElement('div');
    empty.style.cssText = 'color:#888;font-size:10px;font-style:italic;padding:4px;width:100%;text-align:center;';
    empty.textContent = 'Перетащите видео или нажмите «+ Загрузить»';
    grid.appendChild(empty);
    return;
  }

  list.forEach(hook => {
    const card = document.createElement('div');
    card.style.cssText = 'flex-shrink:0;width:70px;position:relative;border:2px solid;border-color:#808080 #fff #fff #808080;background:#c0c0c0;';

    // Thumbnail
    const thumbWrap = document.createElement('div');
    thumbWrap.style.cssText = 'width:70px;height:50px;background:#111;overflow:hidden;cursor:pointer;display:flex;align-items:center;justify-content:center;';
    thumbWrap.title = '▶ ' + hook.name;
    if (hook.thumbPath) {
      const img = document.createElement('img');
      img.src = hook.thumbPath;
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
      thumbWrap.appendChild(img);
    } else {
      // Fallback: video poster frame
      const vid = document.createElement('video');
      vid.src = hook.videoPath + '#t=0.5';
      vid.muted = true; vid.preload = 'metadata';
      vid.style.cssText = 'width:100%;height:100%;object-fit:cover;';
      thumbWrap.appendChild(vid);
    }
    thumbWrap.addEventListener('click', () => {
      if (typeof openBirolyVideoLightbox === 'function') openBirolyVideoLightbox(hook.videoPath, hook.thumbPath);
    });
    card.appendChild(thumbWrap);

    const nameLbl = document.createElement('div');
    nameLbl.style.cssText = 'font-size:8px;text-align:center;padding:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:70px;';
    nameLbl.textContent = hook.name;
    card.appendChild(nameLbl);

    const delBtn = document.createElement('button');
    delBtn.textContent = '✕';
    delBtn.title = 'Удалить хук';
    delBtn.style.cssText = 'position:absolute;top:1px;right:1px;width:14px;height:14px;font-size:8px;padding:0;cursor:pointer;background:rgba(200,0,0,0.7);color:#fff;border:none;line-height:14px;text-align:center;';
    delBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (!confirm(`Удалить хук "${hook.name}"?`)) return;
      fetch('/api/hooks/delete', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: hook.filename }),
      }).catch(() => {});
      const arr = getHooksArchive();
      const i = arr.findIndex(h => h.id === hook.id);
      if (i >= 0) arr.splice(i, 1);
      setHooksArchive(arr);
      renderHooksSection();
      loadAllHooks?.();
      window.refreshTimelineBirolys?.();
    });
    card.appendChild(delBtn);
    grid.appendChild(card);
  });
}

// ── База данных → Хуки: archive grid ─────────────────────────────────────────
function loadAllHooks() {
  const grid = document.getElementById('archive-hooks-grid');
  if (!grid) return;
  const list = getHooksArchive();
  console.log('[hooks] loadAllHooks called, found', list.length, 'hooks');
  grid.innerHTML = '';
  if (!list.length) {
    grid.innerHTML = '<div class="gallery-empty">Нет сохранённых хуков</div>';
    return;
  }
  list.forEach(hook => {
    const card = document.createElement('div');
    card.className = 'biroly-archive-card';
    card.style.cssText = 'width:100px;display:flex;flex-direction:column;border:2px solid;border-color:#808080 #fff #fff #808080;background:#c0c0c0;position:relative;';

    const thumbWrap = document.createElement('div');
    thumbWrap.style.cssText = 'width:100%;height:70px;background:#111;overflow:hidden;cursor:pointer;display:flex;align-items:center;justify-content:center;';
    if (hook.thumbPath) {
      const img = document.createElement('img');
      img.src = hook.thumbPath;
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
      thumbWrap.appendChild(img);
    } else {
      thumbWrap.innerHTML = '<span style="color:#fff;font-size:20px;">▶</span>';
    }
    thumbWrap.title = '▶ ' + hook.name;
    thumbWrap.addEventListener('click', () => {
      if (typeof openBirolyVideoLightbox === 'function') openBirolyVideoLightbox(hook.videoPath, hook.thumbPath);
    });
    card.appendChild(thumbWrap);

    const meta = document.createElement('div');
    meta.style.cssText = 'padding:3px 4px;display:flex;flex-direction:column;gap:2px;';

    const nameInp = document.createElement('input');
    nameInp.type = 'text'; nameInp.value = hook.name || 'Хук';
    nameInp.style.cssText = 'font-size:8px;width:100%;box-sizing:border-box;padding:1px 2px;border:1px solid #aaa;';
    nameInp.title = 'Нажмите для редактирования';
    nameInp.addEventListener('change', () => {
      const newName = nameInp.value.trim() || 'Хук';
      nameInp.value = newName;
      const arr = getHooksArchive();
      const e = arr.find(h => h.id === hook.id);
      if (e) { e.name = newName; setHooksArchive(arr); window.refreshTimelineBirolys?.(); }
    });
    nameInp.addEventListener('click', e => e.stopPropagation());
    meta.appendChild(nameInp);

    if (hook.date) {
      const dateEl = document.createElement('div');
      dateEl.style.cssText = 'font-size:8px;color:#666;';
      dateEl.textContent = new Date(hook.date).toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
      meta.appendChild(dateEl);
    }
    card.appendChild(meta);

    const delBtn = document.createElement('button');
    delBtn.textContent = '✕'; delBtn.title = 'Удалить';
    delBtn.style.cssText = 'position:absolute;top:1px;right:1px;width:14px;height:14px;font-size:8px;padding:0;cursor:pointer;background:rgba(200,0,0,0.7);color:#fff;border:none;line-height:14px;text-align:center;';
    delBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (!confirm(`Удалить хук "${hook.name}"?`)) return;
      fetch('/api/hooks/delete', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: hook.filename }) }).catch(() => {});
      const arr = getHooksArchive();
      const i = arr.findIndex(h => h.id === hook.id);
      if (i >= 0) arr.splice(i, 1);
      setHooksArchive(arr);
      loadAllHooks();
      renderHooksSection();
      window.refreshTimelineBirolys?.();
    });
    card.appendChild(delBtn);
    grid.appendChild(card);
  });
}

// ── Склейка right col: per-session hook activation + timing ──────────────────
// Manages its own .hooks-sub child inside container (doesn't clear siblings)
function renderSessionHooks(container, sessionKey) {
  const prevSub = container.querySelector('.hooks-sub');
  if (prevSub) prevSub.remove();

  const sub = document.createElement('div');
  sub.className = 'hooks-sub';

  const hooks      = getHooksArchive();
  const data       = getTimelineData();
  const sessData   = data[sessionKey] || {};
  const hd         = sessData.hooks   || {};
  const activated  = new Set(hd.activated || []);
  const timings    = hd.timings || {};

  const details = document.createElement('details');
  const summary = document.createElement('summary');
  const activeCnt = hooks.filter((_, i) => activated.has(i)).length;
  details.open = true; // expanded by default so hooks are immediately visible
  summary.style.cssText = 'cursor:pointer;user-select:none;list-style:none;font-size:9px;color:#555;font-weight:bold;padding:3px 0 2px;display:flex;align-items:center;gap:3px;border-top:1px solid #ccc;margin-top:4px;';
  const arrow = document.createElement('span');
  arrow.style.cssText = 'font-size:8px;color:#777;flex-shrink:0;';
  arrow.textContent = '▼';
  const titleEl = document.createElement('span');
  titleEl.textContent = 'Хуки' + (hooks.length ? ` (${activeCnt}/${hooks.length})` : '');
  summary.appendChild(arrow);
  summary.appendChild(titleEl);
  details.addEventListener('toggle', () => { arrow.textContent = details.open ? '▼' : '▶'; });
  details.appendChild(summary);

  const inner = document.createElement('div');
  inner.style.cssText = 'margin-top:3px;';

  // "Еще вары" only — no hide button
  if (hooks.length > 8) {
    const varsBtn = document.createElement('button');
    varsBtn.style.cssText = 'font-size:8px;padding:1px 5px;cursor:pointer;background:#e8e4f4;border:1px solid #7060a0;color:#30206a;font-weight:bold;white-space:nowrap;margin-bottom:4px;';
    varsBtn.textContent = '＋ Еще вары';
    varsBtn.title = 'Показать все хуки и добавить на таймлайн';
    varsBtn.addEventListener('click', () => _openHookVarsPopup(container, sessionKey));
    inner.appendChild(varsBtn);
  }

  if (!hooks.length) {
    const empty = document.createElement('span');
    empty.style.cssText = 'font-size:9px;color:#888;display:block;margin:3px 0;';
    empty.textContent = 'Нет хуков — загрузите во вкладке Биролы';
    inner.appendChild(empty);
    details.appendChild(inner);
    sub.appendChild(details);
    container.appendChild(sub);
    return;
  }

  const HOOK_COLOR = '#b05010';

  function saveHookTiming(hookIdx, updates) {
    const d = getTimelineData();
    if (!d[sessionKey])                        d[sessionKey] = {};
    if (!d[sessionKey].hooks)                  d[sessionKey].hooks = {};
    if (!d[sessionKey].hooks.timings)          d[sessionKey].hooks.timings = {};
    if (!d[sessionKey].hooks.timings[hookIdx]) d[sessionKey].hooks.timings[hookIdx] = {};
    Object.assign(d[sessionKey].hooks.timings[hookIdx], updates);
    setTimelineData(d);
  }

  function renderHookCard(hook, hookIdx) {
    const isActive = activated.has(hookIdx);
    const saved    = timings[hookIdx] || {};
    const dur      = parseFloat(saved.duration || hook.duration || 6);

    const card = document.createElement('div');
    card.dataset.hookIdx = hookIdx;
    card.style.cssText = `display:flex;flex-direction:column;gap:3px;margin-bottom:4px;padding:3px 4px;
      border:1px solid ${isActive ? HOOK_COLOR : '#c0c0c0'};
      background:${isActive ? '#f0e0d0' : '#ebebeb'};
      ${!isActive ? 'opacity:0.75;' : ''}`;

    const topRow = document.createElement('div');
    topRow.style.cssText = 'display:flex;align-items:center;gap:4px;';

    const thumbWrap = document.createElement('div');
    thumbWrap.style.cssText = 'width:22px;height:30px;flex-shrink:0;overflow:hidden;border:1px solid #808080;cursor:pointer;background:#111;display:flex;align-items:center;justify-content:center;';
    thumbWrap.title = '▶ ' + hook.name;
    if (hook.thumbPath) {
      const img = document.createElement('img');
      img.src = hook.thumbPath;
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
      thumbWrap.appendChild(img);
    } else {
      const vid = document.createElement('video');
      vid.src = hook.videoPath + '#t=0.5';
      vid.muted = true; vid.preload = 'metadata';
      vid.style.cssText = 'width:100%;height:100%;object-fit:cover;';
      thumbWrap.appendChild(vid);
    }
    thumbWrap.addEventListener('click', () => {
      if (typeof openBirolyVideoLightbox === 'function') openBirolyVideoLightbox(hook.videoPath, hook.thumbPath);
    });
    topRow.appendChild(thumbWrap);

    const nameEl = document.createElement('span');
    nameEl.style.cssText = 'flex:1;font-size:9px;color:#333;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;';
    nameEl.textContent = hook.name;
    topRow.appendChild(nameEl);

    const toggleBtn = document.createElement('button');
    toggleBtn.style.cssText = `flex-shrink:0;font-size:9px;padding:1px 5px;cursor:pointer;
      ${isActive
        ? `background:${HOOK_COLOR};color:#fff;font-weight:bold;border:1px solid ${HOOK_COLOR};`
        : 'background:#d4d4d4;border:1px solid #a0a0a0;'}`;
    toggleBtn.textContent = isActive ? '★' : '☆';
    toggleBtn.title = isActive ? 'Деактивировать' : 'Активировать';
    toggleBtn.addEventListener('click', () => {
      const d = getTimelineData();
      if (!d[sessionKey])                 d[sessionKey] = {};
      if (!d[sessionKey].hooks)           d[sessionKey].hooks = {};
      if (!d[sessionKey].hooks.activated) d[sessionKey].hooks.activated = [];
      const arr = d[sessionKey].hooks.activated;
      const pos = arr.indexOf(hookIdx);
      if (pos === -1) {
        arr.push(hookIdx);
        if (!d[sessionKey].hooks.timings)           d[sessionKey].hooks.timings = {};
        if (!d[sessionKey].hooks.timings[hookIdx]) {
          d[sessionKey].hooks.timings[hookIdx] = { crop: '0', cropEnd: '0', start: '0.00', end: dur.toFixed(2) };
        }
      } else { arr.splice(pos, 1); }
      setTimelineData(d);
      renderSessionHooks(container, sessionKey);
      refreshHooksBars();
    });
    topRow.appendChild(toggleBtn);
    card.appendChild(topRow);

    if (isActive) {
      const timingRow = document.createElement('div');
      timingRow.style.cssText = 'display:flex;align-items:center;gap:2px;flex-wrap:nowrap;';
      const mkLbl = t => { const s = document.createElement('span'); s.style.cssText = 'font-size:8px;color:#555;flex-shrink:0;'; s.textContent = t; return s; };
      const mkInp = (val, ph, w) => { const i = document.createElement('input'); i.type = 'text'; i.value = val || ''; i.placeholder = ph; i.style.cssText = `width:${w || 34}px;font-size:8px;padding:1px 2px;box-sizing:border-box;`; return i; };

      const cropInp    = mkInp(saved.crop    ?? '0',            'crop', 28);
      const startInp   = mkInp(saved.start   ?? '0.00',         '0.00', 34);
      const endInp     = mkInp(saved.end     ?? dur.toFixed(2), '0.00', 34);
      const cropEndInp = mkInp(saved.cropEnd ?? '0',            'cEnd', 28);

      // Speed slider (0.25x … 2x)
      const _spdSaved = Math.min(2, Math.max(0.25, parseFloat(saved.speed) || 1));
      const speedSlider = document.createElement('input');
      speedSlider.type = 'range'; speedSlider.min = '0.25'; speedSlider.max = '2'; speedSlider.step = '0.05';
      speedSlider.style.cssText = 'width:48px;cursor:pointer;vertical-align:middle;flex-shrink:0;';
      speedSlider.title = 'Скорость воспроизведения (0.25x–2x)';
      speedSlider.value = _spdSaved;
      const speedLbl = document.createElement('span');
      speedLbl.style.cssText = 'font-size:8px;color:#333;flex-shrink:0;min-width:30px;';
      speedLbl.textContent = _spdSaved.toFixed(2) + 'x';

      const recalcEnd = () => {
        const c   = parseFloat(cropInp.value)     || 0;
        const ce  = parseFloat(cropEndInp.value)  || 0;
        const s   = parseFloat(startInp.value)    || 0;
        const spd = parseFloat(speedSlider.value) || 1;
        endInp.value = (s + Math.max(0, dur - c - ce) / spd).toFixed(2);
      };
      // Crop align dropdown
      const cropAlignSel = document.createElement('select');
      cropAlignSel.style.cssText = 'font-size:8px;padding:1px 2px;width:54px;flex-shrink:0;';
      cropAlignSel.title = 'Позиция кадрирования по ширине';
      ['left','center','right'].forEach(v => {
        const o = document.createElement('option'); o.value = v; o.textContent = v; cropAlignSel.appendChild(o);
      });
      cropAlignSel.value = saved.cropAlign || 'center';

      const saveAll = () => saveHookTiming(hookIdx, {
        crop:      cropInp.value,
        cropEnd:   cropEndInp.value,
        start:     startInp.value,
        end:       endInp.value,
        speed:     speedSlider.value,
        cropAlign: cropAlignSel.value,
      });

      cropAlignSel.addEventListener('change', () => saveAll());

      cropInp.addEventListener('input',   () => { recalcEnd(); saveAll(); });
      cropInp.addEventListener('change',  () => { saveAll(); refreshHooksBars(); });
      startInp.addEventListener('input',  () => { recalcEnd(); saveAll(); });
      startInp.addEventListener('change', () => { saveAll(); renderSessionHooks(container, sessionKey); refreshHooksBars(); });
      endInp.addEventListener('change',   () => { saveAll(); refreshHooksBars(); });
      cropEndInp.addEventListener('input',  () => { recalcEnd(); saveAll(); });
      cropEndInp.addEventListener('change', () => { saveAll(); refreshHooksBars(); });
      speedSlider.addEventListener('input', () => {
        speedLbl.textContent = parseFloat(speedSlider.value).toFixed(2) + 'x';
        recalcEnd(); saveAll(); refreshHooksBars();
      });

      timingRow.appendChild(mkLbl('crop'));   timingRow.appendChild(cropInp);
      timingRow.appendChild(mkLbl('с:'));     timingRow.appendChild(startInp);
      timingRow.appendChild(mkLbl('до:'));    timingRow.appendChild(endInp);
      timingRow.appendChild(mkLbl('cropE:')); timingRow.appendChild(cropEndInp);
      timingRow.appendChild(mkLbl('spd:'));   timingRow.appendChild(speedSlider); timingRow.appendChild(speedLbl);
      card.appendChild(timingRow);

      const alignRow = document.createElement('div');
      alignRow.style.cssText = 'display:flex;align-items:center;gap:4px;margin-top:2px;';
      const alignLbl = document.createElement('span');
      alignLbl.style.cssText = 'font-size:8px;color:#555;flex-shrink:0;';
      alignLbl.textContent = 'align:';
      alignRow.appendChild(alignLbl);
      alignRow.appendChild(cropAlignSel);
      card.appendChild(alignRow);
    }
    inner.appendChild(card);
  }

  // Active hooks sorted by start time; inactive shown only when total ≤ 8
  const allHookItems  = hooks.map((h, i) => ({ hook: h, idx: i }));
  const activeHooks   = allHookItems.filter(({ idx }) => activated.has(idx))
    .sort((a, b) => (parseFloat(timings[a.idx]?.start) || 0) - (parseFloat(timings[b.idx]?.start) || 0));
  const inactiveHooks = hooks.length > 8
    ? []
    : allHookItems.filter(({ idx }) => !activated.has(idx));

  activeHooks.forEach(({ hook, idx }) => renderHookCard(hook, idx));

  if (inactiveHooks.length) {
    const sep = document.createElement('div');
    sep.style.cssText = 'border-top:1px dashed #bbb;margin:3px 0 2px;font-size:8px;color:#aaa;padding-top:2px;';
    sep.textContent = 'неактивные';
    inner.appendChild(sep);
    inactiveHooks.forEach(({ hook, idx }) => renderHookCard(hook, idx));
  }

  details.appendChild(inner);
  sub.appendChild(details);
  container.appendChild(sub);
}

// ── "Еще вары" popup: browse all hooks, toggle active ────────────────────────
function _openHookVarsPopup(container, sessionKey) {
  const hooks = getHooksArchive();
  if (!hooks.length) return;

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:10000;display:flex;align-items:center;justify-content:center;';

  const popup = document.createElement('div');
  popup.style.cssText = 'background:#c0c0c0;border:2px solid;border-color:#fff #808080 #808080 #fff;padding:10px;min-width:340px;max-width:92vw;max-height:90vh;display:flex;flex-direction:column;gap:8px;box-sizing:border-box;';

  const titleBar = document.createElement('div');
  titleBar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;background:#000080;color:#fff;padding:3px 8px;margin:-10px -10px 0;flex-shrink:0;';
  const titleTxt = document.createElement('span');
  titleTxt.style.cssText = 'font-size:11px;font-weight:bold;';
  titleTxt.textContent = `Все хуки (${hooks.length})`;
  const closeX = document.createElement('button');
  closeX.textContent = '✕';
  closeX.style.cssText = 'background:none;border:none;color:#fff;cursor:pointer;font-size:13px;padding:0 2px;';
  closeX.addEventListener('click', () => overlay.remove());
  titleBar.appendChild(titleTxt);
  titleBar.appendChild(closeX);
  popup.appendChild(titleBar);

  const HOOK_COLOR = '#b05010';
  const grid = document.createElement('div');
  grid.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;overflow-y:auto;max-height:70vh;padding:4px;flex:1;';

  const refreshCards = () => {
    grid.innerHTML = '';
    const d   = getTimelineData();
    const hd  = (d[sessionKey] || {}).hooks || {};
    const act = hd.activated || [];

    hooks.forEach((hook, idx) => {
      const isActive = act.includes(idx);
      const dur      = parseFloat(hook.duration || 6);

      const card = document.createElement('div');
      card.style.cssText = `width:100px;display:flex;flex-direction:column;gap:3px;padding:4px;
        background:${isActive ? '#f0ddd0' : '#e8e8e8'};
        border:1px solid ${isActive ? HOOK_COLOR : '#aaa'};box-sizing:border-box;`;

      const thumbWrap = document.createElement('div');
      thumbWrap.style.cssText = 'width:100%;height:66px;background:#111;overflow:hidden;cursor:pointer;border:1px solid #808080;display:flex;align-items:center;justify-content:center;';
      if (hook.thumbPath) {
        const img = document.createElement('img');
        img.src = hook.thumbPath;
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
        thumbWrap.appendChild(img);
      } else {
        thumbWrap.innerHTML = '<span style="color:#fff;font-size:18px;pointer-events:none;">▶</span>';
      }
      thumbWrap.title = '▶ Предпросмотр';
      thumbWrap.addEventListener('click', () => {
        if (typeof openBirolyVideoLightbox === 'function') openBirolyVideoLightbox(hook.videoPath, hook.thumbPath);
      });
      card.appendChild(thumbWrap);

      const nameEl = document.createElement('div');
      nameEl.style.cssText = 'font-size:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      nameEl.textContent = hook.name || 'Хук';
      card.appendChild(nameEl);

      const addBtn = document.createElement('button');
      addBtn.textContent = isActive ? '★ Активен' : '＋ Добавить';
      addBtn.style.cssText = `font-size:8px;padding:2px 4px;cursor:pointer;width:100%;
        ${isActive ? `background:${HOOK_COLOR};color:#fff;border:1px solid ${HOOK_COLOR};` : 'background:#e0e0e0;border:1px solid #a0a0a0;'}`;
      addBtn.addEventListener('click', () => {
        const d2 = getTimelineData();
        if (!d2[sessionKey])                 d2[sessionKey] = {};
        if (!d2[sessionKey].hooks)           d2[sessionKey].hooks = {};
        if (!d2[sessionKey].hooks.activated) d2[sessionKey].hooks.activated = [];
        const arr = d2[sessionKey].hooks.activated;
        const pos = arr.indexOf(idx);
        if (pos === -1) {
          arr.push(idx);
          if (!d2[sessionKey].hooks.timings)       d2[sessionKey].hooks.timings = {};
          if (!d2[sessionKey].hooks.timings[idx]) d2[sessionKey].hooks.timings[idx] = { crop: '0', cropEnd: '0', start: '0.00', end: dur.toFixed(2) };
        } else {
          arr.splice(pos, 1);
        }
        setTimelineData(d2);
        refreshCards();
        renderSessionHooks(container, sessionKey);
        refreshHooksBars();
      });
      card.appendChild(addBtn);
      grid.appendChild(card);
    });
  };
  refreshCards();
  popup.appendChild(grid);

  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'Закрыть';
  closeBtn.style.cssText = 'font-size:9px;padding:3px 14px;cursor:pointer;align-self:flex-end;flex-shrink:0;';
  closeBtn.addEventListener('click', () => overlay.remove());
  popup.appendChild(closeBtn);

  overlay.appendChild(popup);
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

// ── Hooks timeline bar fill ──────────────────────────────────────────────────
function _fillHooksBar(bBar, sessionKey, totalDur) {
  bBar.innerHTML = '';
  const hooks     = getHooksArchive();
  const tlData    = getTimelineData();
  const sessData  = tlData[sessionKey] || {};
  const hd        = sessData.hooks     || {};
  const activated = hd.activated       || [];
  const timings   = hd.timings         || {};

  activated.forEach(idx => {
    const h = hooks[idx];
    const t = timings[idx];
    if (!h || !h.videoPath || !t || t.start === undefined) return;

    const startVal   = parseFloat(t.start);
    const endVal     = parseFloat(t.end);
    const cropVal    = parseFloat(t.crop)    || 0;
    const cropEndVal = parseFloat(t.cropEnd) || 0;
    if (isNaN(startVal) || isNaN(endVal) || endVal <= startVal) return;

    const duration      = endVal - startVal;
    const cropStart     = Math.max(0, startVal - cropVal);
    const totalBlockDur = endVal + cropEndVal - cropStart;
    const blockLeft     = cropStart / totalDur * 100;
    const blockWidth    = totalBlockDur / totalDur * 100;
    const csFrac        = totalBlockDur > 0 ? (startVal - cropStart)  / totalBlockDur * 100 : 0;
    const actFrac       = totalBlockDur > 0 ? duration                / totalBlockDur * 100 : 100;
    const ceFrac        = totalBlockDur > 0 ? cropEndVal              / totalBlockDur * 100 : 0;

    const block = document.createElement('div');
    block.style.cssText = `position:absolute;left:${blockLeft.toFixed(3)}%;width:${Math.max(blockWidth, 0.3).toFixed(3)}%;height:100%;box-sizing:border-box;overflow:hidden;border-radius:2px;cursor:grab;`;
    block.title = `${h.name || 'Хук'}\nс: ${startVal.toFixed(2)}s  до: ${endVal.toFixed(2)}s  crop↑: ${cropVal.toFixed(2)}s  crop↓: ${cropEndVal.toFixed(2)}s\nКлик — выделить [Del] — удалить с таймлайна`;

    if (csFrac > 0) {
      const csPart = document.createElement('div');
      csPart.style.cssText = `position:absolute;left:0;width:${csFrac.toFixed(3)}%;height:100%;background:#555;filter:grayscale(1);border-right:2px dashed #999;box-sizing:border-box;`;
      block.appendChild(csPart);
    }

    const HOOK_COLOR = '#b05010';
    const actPart = document.createElement('div');
    actPart.style.cssText = `position:absolute;left:${csFrac.toFixed(3)}%;width:${actFrac.toFixed(3)}%;height:100%;box-sizing:border-box;overflow:hidden;display:flex;align-items:center;`;
    if (h.thumbPath) {
      actPart.style.backgroundImage    = `url(${h.thumbPath})`;
      actPart.style.backgroundSize     = 'cover';
      actPart.style.backgroundPosition = 'center';
      actPart.style.outline = `1px solid ${HOOK_COLOR}`;
    } else {
      actPart.style.background = HOOK_COLOR;
    }
    actPart.innerHTML = `<span style="font-size:7px;color:#fff;font-weight:bold;padding:0 2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;pointer-events:none;text-shadow:0 0 3px #000,0 0 3px #000;">${h.name || 'Х'}</span>`;
    block.appendChild(actPart);

    if (ceFrac > 0) {
      const cePart = document.createElement('div');
      cePart.style.cssText = `position:absolute;left:${(csFrac + actFrac).toFixed(3)}%;width:${ceFrac.toFixed(3)}%;height:100%;background:#555;filter:grayscale(1);border-left:2px dashed #999;box-sizing:border-box;`;
      block.appendChild(cePart);
    }

    // Click to select; drag to reposition
    block.addEventListener('mousedown', e => {
      e.preventDefault();
      const barRect  = bBar.getBoundingClientRect();
      const origLeft = cropStart;
      const startX   = e.clientX;
      let moved      = false;
      block.style.cursor = 'grabbing';
      document.body.style.userSelect = 'none';

      const onMove = ev => {
        if (Math.abs(ev.clientX - startX) > 3) moved = true;
        if (!moved) return;
        const deltaSec     = (ev.clientX - startX) / barRect.width * totalDur;
        const newCropStart = Math.max(0, Math.min(origLeft + deltaSec, totalDur - totalBlockDur));
        block.style.left = (newCropStart / totalDur * 100).toFixed(3) + '%';
        block.title = `${h.name || 'Хук'}\nс: ${(newCropStart + cropVal).toFixed(2)}s  до: ${(newCropStart + cropVal + duration).toFixed(2)}s  crop↑: ${cropVal.toFixed(2)}s  crop↓: ${cropEndVal.toFixed(2)}s`;
      };
      const onUp = ev => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        block.style.cursor = 'grab';
        document.body.style.userSelect = '';

        if (!moved) {
          // Pure click → select block
          _setTlSelected('hook', sessionKey, idx, block, bBar, totalDur);
          return;
        }

        // Drag ended → save new position
        const deltaSec     = (ev.clientX - startX) / barRect.width * totalDur;
        const newCropStart = Math.max(0, Math.min(origLeft + deltaSec, totalDur - totalBlockDur));
        const newStart     = parseFloat((newCropStart + cropVal).toFixed(2));
        const newEnd       = parseFloat((newStart + duration).toFixed(2));
        const d = getTimelineData();
        if (!d[sessionKey])               d[sessionKey] = {};
        if (!d[sessionKey].hooks)         d[sessionKey].hooks = {};
        if (!d[sessionKey].hooks.timings) d[sessionKey].hooks.timings = {};
        d[sessionKey].hooks.timings[idx] = {
          crop: cropVal.toFixed(2), cropEnd: cropEndVal.toFixed(2),
          start: newStart.toFixed(2), end: newEnd.toFixed(2),
        };
        setTimelineData(d);
        _clearTlSelection();
        window.refreshTimelineBirolys?.();
        _fillHooksBar(bBar, sessionKey, totalDur);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    bBar.appendChild(block);
  });
}

// Refresh all hooks bars already in DOM
function refreshHooksBars() {
  document.querySelectorAll('.timeline-hooks-bar[data-session-key]').forEach(el => {
    const totalDur = parseFloat(el.dataset.totalDur) || 0;
    if (totalDur > 0) _fillHooksBar(el, el.dataset.sessionKey, totalDur);
  });
}
window.refreshHooksBars = refreshHooksBars;
window.loadAllHooks     = loadAllHooks;
window.getHooksArchive  = getHooksArchive;
window.setHooksArchive  = setHooksArchive;
