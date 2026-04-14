/* ═══════════════════════════════════════════════════════════════════
   БИРОЛЫ ARCHIVE — localStorage storage for completed img+video birolys
   Includes: archive grid, horizontal video strip, Постпрод panel
   ═══════════════════════════════════════════════════════════════════ */

const BIROLY_ARCHIVE_KEY = 'biroly_archive_v1';
const BIROLY_ACTIVE_KEY  = 'biroly_active_v1';

function getBirolyArchive() {
  try { return JSON.parse(localStorage.getItem(BIROLY_ARCHIVE_KEY) || '[]'); } catch { return []; }
}

function getActiveBirolyIdxs() {
  try { return JSON.parse(localStorage.getItem(BIROLY_ACTIVE_KEY) || '[]'); } catch { return []; }
}

function setActiveBirolyIdxs(arr) {
  localStorage.setItem(BIROLY_ACTIVE_KEY, JSON.stringify(arr));
}

function toggleActiveBiroly(idx) {
  const active = getActiveBirolyIdxs();
  const pos = active.indexOf(idx);
  const adding = pos === -1;
  if (adding) active.push(idx);
  else active.splice(pos, 1);
  setActiveBirolyIdxs(active);
  renderBirolyStrip();
  renderPostprod();
  // Instant sync update of Биролы columns already in the DOM
  window.refreshTimelineBirolys?.();
  // Full async re-render (updates headers, timing bars, etc.)
  window.renderAllTimelines?.();
}

// Push a completed biroly (image + video) to the archive (legacy, kept for compat)
function pushToBirolyArchive(item) {
  if (!item.imagePath) return;
  const list = getBirolyArchive();
  list.unshift({ ...item, status: 'done', date: item.date || new Date().toISOString() });
  localStorage.setItem(BIROLY_ARCHIVE_KEY, JSON.stringify(list));
}

// ── Pending/live archive management ──────────────────────────────────────────
function _buid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }

// Add a generating entry immediately (returns its id)
// meta: optional { categoryId, categoryLabel } from the biroly slot
function addPendingBirolyEntry(name, prompt, meta = {}) {
  const id = _buid();
  const list = getBirolyArchive();
  list.unshift({ id, name, prompt, ...meta, imagePath: null, videoPath: null, status: 'generating', date: new Date().toISOString() });
  localStorage.setItem(BIROLY_ARCHIVE_KEY, JSON.stringify(list));
  loadAllBiroly();
  return id;
}

// Update a pending entry by id (imagePath, videoPath, status, etc.)
function updateBirolyEntry(id, updates) {
  const list = getBirolyArchive();
  const idx = list.findIndex(e => e.id === id);
  if (idx < 0) return;
  list[idx] = { ...list[idx], ...updates };
  localStorage.setItem(BIROLY_ARCHIVE_KEY, JSON.stringify(list));
  loadAllBiroly();
}

// ── Horizontal video strip in Биролы left column ─────────────────────────────
function renderBirolyStrip() {
  const wrap  = document.getElementById('biroly-vid-strip-wrap');
  const strip = document.getElementById('biroly-vid-strip');
  if (!strip) return;
  const fullList = getBirolyArchive();
  const list     = fullList.filter(b => b.videoPath);
  const active   = getActiveBirolyIdxs();

  if (wrap) wrap.style.display = list.length ? 'block' : 'none';

  strip.innerHTML = '';
  if (!list.length) return;

  list.forEach(item => {
    const globalIdx = fullList.indexOf(item);
    const isActive  = active.includes(globalIdx);

    const card = document.createElement('div');
    card.className = 'biroly-strip-card' + (isActive ? ' strip-active' : '');

    // Thumbnail — prefer thumbPath (small), then imagePath, then video poster frame
    const thumbSrc = item.thumbPath || item.imagePath || null;
    let thumb;
    if (thumbSrc) {
      thumb = document.createElement('img');
      thumb.src = thumbSrc;
      thumb.className = 'biroly-strip-thumb';
    } else {
      // Video-only: show first frame via video element
      thumb = document.createElement('video');
      thumb.src = item.videoPath + '#t=0.5';
      thumb.className = 'biroly-strip-thumb';
      thumb.muted = true;
      thumb.preload = 'metadata';
    }
    thumb.title = '▶ Смотреть видео';
    thumb.addEventListener('click', e => {
      e.stopPropagation();
      openBirolyVideoLightbox(item.videoPath, item.imagePath || item.thumbPath);
    });

    // Play badge overlay
    const badge = document.createElement('div');
    badge.className = 'biroly-strip-play-badge';
    badge.textContent = '▶';

    // Name
    const name = document.createElement('div');
    name.className = 'biroly-strip-name';
    name.textContent = item.name || 'Бирол';

    // Activate toggle button
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'biroly-strip-activate';
    toggleBtn.textContent = isActive ? '★ Активен' : '☆ Активировать';
    toggleBtn.title = isActive ? 'Убрать из Постпрод' : 'Добавить в Постпрод';
    toggleBtn.addEventListener('click', e => {
      e.stopPropagation();
      toggleActiveBiroly(globalIdx);
    });

    card.appendChild(thumb);
    card.appendChild(badge);
    card.appendChild(name);
    card.appendChild(toggleBtn);
    strip.appendChild(card);
  });
}

// ── Постпрод panel in Склейка tab ── биролы теперь управляются в колонке таймлайна ──
function renderPostprod() {
  const container = document.getElementById('postprod-content');
  if (!container) return;
  container.innerHTML = '<span style="color:#888;font-size:11px;">Биролы управляются в правой колонке каждого таймлайна</span>';
}

// ── Database archive grid ─────────────────────────────────────────────────────
function loadAllBiroly() {
  const grid = document.getElementById('archive-biroly-grid');
  if (!grid) return;
  const list = getBirolyArchive();
  grid.innerHTML = '';
  if (!list.length) {
    grid.innerHTML = '<div class="gallery-empty">Нет сохранённых биролов</div>';
    return;
  }
  list.forEach(item => {
    const card = document.createElement('div');
    const gen  = item.status === 'generating';
    const err  = item.status === 'error';
    card.className = 'biroly-archive-card' + (gen ? ' biroly-card-generating' : '');

    // Thumbnail — prefer thumbPath (small), fall back to imagePath, then video poster frame
    const thumbSrc = item.thumbPath || item.imagePath || null;
    let thumb;
    if (thumbSrc) {
      thumb = document.createElement('img');
      thumb.src = thumbSrc;
      thumb.className = 'biroly-archive-thumb';
      if (!gen && item.videoPath) {
        thumb.title = '▶ Смотреть видео';
        thumb.style.cursor = 'pointer';
        thumb.addEventListener('click', () => openBirolyVideoLightbox(item.videoPath, item.imagePath || item.thumbPath));
      } else if (!gen && !item.videoPath) {
        thumb.title = 'Открыть изображение';
        thumb.addEventListener('click', () => openLightbox?.(item.imagePath));
      }
      // gen === true → no click (not interactive yet)
    } else if (!gen && item.videoPath) {
      // Video-only entry: use a <video> element for poster frame
      thumb = document.createElement('video');
      thumb.src = item.videoPath + '#t=0.5';
      thumb.className = 'biroly-archive-thumb';
      thumb.muted = true;
      thumb.preload = 'metadata';
      thumb.style.cursor = 'pointer';
      thumb.title = '▶ Смотреть видео';
      thumb.addEventListener('click', () => openBirolyVideoLightbox(item.videoPath, null));
    } else {
      // No image yet — placeholder
      thumb = document.createElement('div');
      thumb.className = 'biroly-archive-thumb biroly-thumb-placeholder';
      thumb.textContent = err ? '❌' : '⏳';
    }

    const meta = document.createElement('div');
    meta.className = 'biroly-archive-meta';

    const nameEl = document.createElement('input');
    nameEl.type = 'text';
    nameEl.className = 'biroly-archive-name biroly-archive-name-input';
    nameEl.value = item.name || 'Бирол';
    nameEl.title = 'Нажмите для редактирования названия';
    nameEl.addEventListener('change', () => {
      const newName = nameEl.value.trim() || 'Бирол';
      nameEl.value = newName;
      const list = getBirolyArchive();
      const entry = list.find(e => e.id === item.id);
      if (entry) {
        entry.name = newName;
        localStorage.setItem(BIROLY_ARCHIVE_KEY, JSON.stringify(list));
        // Refresh склейка birolys if visible
        window.refreshTimelineBirolys?.();
      }
    });
    nameEl.addEventListener('click', e => e.stopPropagation());
    meta.appendChild(nameEl);

    // Category assignment dropdown
    {
      const cats = (() => { try { return JSON.parse(localStorage.getItem('biroly_cats') || '[]'); } catch { return []; } })();
      if (cats.length) {
        const catSel = document.createElement('select');
        catSel.className = 'biroly-archive-cat-sel';
        catSel.title = 'Категория';
        const noneOpt = document.createElement('option');
        noneOpt.value = '';
        noneOpt.textContent = '— категория —';
        catSel.appendChild(noneOpt);
        cats.forEach(c => {
          const o = document.createElement('option');
          o.value = c.id;
          o.textContent = c.label;
          catSel.appendChild(o);
        });
        catSel.value = item.categoryId || '';
        catSel.addEventListener('change', e => {
          e.stopPropagation();
          const list = getBirolyArchive();
          const entry = list.find(en => en.id === item.id);
          if (entry) {
            entry.categoryId    = catSel.value;
            entry.categoryLabel = cats.find(c => c.id === catSel.value)?.label || '';
            localStorage.setItem(BIROLY_ARCHIVE_KEY, JSON.stringify(list));
            window.refreshTimelineBirolys?.();
          }
        });
        catSel.addEventListener('click', e => e.stopPropagation());
        meta.appendChild(catSel);
      }
    }

    if (item.date) {
      const dateEl = document.createElement('div');
      dateEl.className = 'geni-date';
      dateEl.textContent = new Date(item.date).toLocaleString('ru-RU', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
      });
      meta.appendChild(dateEl);
    }

    if (gen) {
      const badge = document.createElement('div');
      badge.className = 'biroly-gen-badge';
      badge.textContent = item.videoPath ? '⚙ ждём видео…' : item.imagePath ? '⚙ генерация видео…' : '⚙ генерация…';
      meta.appendChild(badge);
    } else if (err) {
      const badge = document.createElement('div');
      badge.style.cssText = 'font-size:9px;color:#cc3333;font-weight:bold;margin-top:2px;';
      badge.textContent = '❌ Ошибка';
      meta.appendChild(badge);
      if (item.errorMsg) {
        const errEl = document.createElement('div');
        errEl.style.cssText = 'font-size:8px;color:#cc6666;margin-top:2px;word-break:break-word;max-width:90px;';
        errEl.textContent = item.errorMsg;
        meta.appendChild(errEl);
      }
      if (item.retryState && item.id && typeof window.retryBirolyEntry === 'function') {
        const retryBtn = document.createElement('button');
        retryBtn.textContent = '↺ Повторить';
        retryBtn.title = `Повторить с этапа: ${item.retryState.stage || '?'}`;
        retryBtn.style.cssText = 'margin-top:4px;font-size:9px;padding:2px 5px;cursor:pointer;background:#2a3a2a;color:#8fc;border:1px solid #4a7a4a;border-radius:3px;width:100%;';
        retryBtn.addEventListener('click', e => {
          e.stopPropagation();
          window.retryBirolyEntry(item.id);
        });
        meta.appendChild(retryBtn);
      }
    } else if (item.videoPath) {
      const badge = document.createElement('div');
      badge.style.cssText = 'font-size:9px;color:#006600;font-weight:bold;margin-top:2px;';
      badge.textContent = `▶ ${item.duration ? item.duration + 'с' : 'видео'}`;
      meta.appendChild(badge);
    }

    card.appendChild(thumb);
    card.appendChild(meta);
    grid.appendChild(card);
  });
}

// ── Scan uploads/ and recover orphan videos not in archive ───────────────────
async function recoverOrphanBirolys() {
  try {
    const res = await fetch('/api/biroly/scan-uploads').then(r => r.json());
    if (!res.success) return;
    let list = getBirolyArchive();
    let changed = 0;

    // 1. Fix entries with videoPath already set but stuck as 'generating'
    list.forEach(e => {
      if (e.status === 'generating' && e.videoPath) {
        e.status = 'done';
        changed++;
      }
    });

    // 2. Fix 'generating' entries stuck too long (>15 min) — mark as error
    //    But first try to match with an unmatched scan video by date proximity
    const STALE_MS    = 15 * 60 * 1000;
    const MATCH_MS    = 40 * 60 * 1000;
    const knownVideos = new Set(list.map(e => e.videoPath).filter(Boolean));
    const orphanFiles = res.files.filter(f => !knownVideos.has(f.videoPath));
    const usedVideos  = new Set();

    list.forEach(e => {
      if (e.status !== 'generating') return;
      const age = Date.now() - new Date(e.date).getTime();
      if (age < STALE_MS) return; // still might be in progress

      // Try to find an orphan video close in time
      const entryMs = new Date(e.date).getTime();
      const match = orphanFiles.find(f => !usedVideos.has(f.videoPath) && Math.abs(f.mtime - entryMs) < MATCH_MS);
      if (match) {
        usedVideos.add(match.videoPath);
        e.videoPath  = match.videoPath;
        e.imagePath  = e.imagePath || match.imagePath || null;
        e.thumbPath  = match.thumbPath || null;
        e.status     = 'done';
        e.duration   = 6;
      } else {
        e.status = 'error';
        // Save retry state so the user can retry from the database tab
        if (!e.retryState) {
          e.retryState = {
            mode:    e.mode || 'base',
            prompt:  e.prompt || '',
            imagePath: e.imagePath || null,
            thumbPath: e.thumbPath || null,
            stage:   e.imagePath ? 'analyze' : (e.mode === 'plus' ? 'img1' : 'img'),
            enhancedPrompt: e.enhancedPrompt || null,
            img1done: e.img1done || false,
          };
        }
      }
      changed++;
    });

    // 3. Add remaining orphan videos as new entries
    orphanFiles
      .filter(f => !usedVideos.has(f.videoPath))
      .forEach(({ videoPath, imagePath, thumbPath, mtime }) => {
        list.push({
          id:        _buid(),
          name:      'Бирол (восстановлен)',
          prompt:    '',
          imagePath: imagePath || null,
          thumbPath: thumbPath || null,
          videoPath,
          status:    'done',
          duration:  6,
          date:      new Date(mtime).toISOString(),
        });
        changed++;
      });

    if (changed > 0) {
      list.sort((a, b) => new Date(b.date) - new Date(a.date));
      localStorage.setItem(BIROLY_ARCHIVE_KEY, JSON.stringify(list));
      loadAllBiroly();
      renderBirolyStrip();
      console.log(`[biroly] recoverOrphanBirolys: ${changed} изменений`);
    }
  } catch (e) {
    console.warn('[biroly] recoverOrphanBirolys:', e.message);
  }
}

// ── Video lightbox ────────────────────────────────────────────────────────────
function openBirolyVideoLightbox(videoPath, posterPath) {
  let lb = document.getElementById('biroly-vid-lb');
  if (!lb) {
    lb = document.createElement('div');
    lb.id = 'biroly-vid-lb';
    lb.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.88);z-index:9000;align-items:center;justify-content:center;cursor:pointer;';
    lb.addEventListener('click', () => {
      lb.style.display = 'none';
      const v = lb.querySelector('video');
      if (v) v.pause();
    });
    document.body.appendChild(lb);
  }
  lb.innerHTML = '';
  const vid = document.createElement('video');
  vid.src = videoPath;
  if (posterPath) vid.poster = posterPath;
  vid.controls = true;
  vid.autoplay = true;
  vid.style.cssText = 'max-width:90vw;max-height:90vh;display:block;';
  vid.addEventListener('click', e => e.stopPropagation());
  lb.appendChild(vid);
  lb.style.display = 'flex';
}
