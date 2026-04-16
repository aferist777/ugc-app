/* scen-montage.js — openVideoLightbox, renderMontagePanel, biroly bar fill, music/sfx controls, getCompletedSessions */

// ── Video lightbox ─────────────────────────────────────────────────────────────
function openVideoLightbox(src) {
  let lb = document.getElementById('scen-video-lb');
  if (!lb) {
    lb = document.createElement('div');
    lb.id = 'scen-video-lb';
    lb.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.88);z-index:9999;align-items:center;justify-content:center;flex-direction:column;gap:12px;';
    lb.innerHTML = '<video id="scen-video-lb-el" controls style="max-width:90vw;max-height:80vh;display:block;background:#000;"></video><button style="padding:6px 24px;font-size:13px;cursor:pointer;">Закрыть</button>';
    lb.addEventListener('click', e => {
      if (e.target === lb || e.target.tagName === 'BUTTON') {
        lb.style.display = 'none';
        const vid = lb.querySelector('video');
        vid.pause(); vid.src = '';
      }
    });
    document.body.appendChild(lb);
  }
  lb.querySelector('#scen-video-lb-el').src = src;
  lb.style.display = 'flex';
}

// ── Монтаж panel — теперь алиас renderAllTimelines (монтаж встроен в таймлайн) ─
function renderMontagePanel() { renderAllTimelines(); }

// Derive thumbnail path: /uploads/foo.jpg → /uploads/thumbs/foo.jpg (with fallback)
function _toThumb(p) {
  if (!p) return p;
  return p.replace(/^(\/uploads\/)(?!thumbs\/)([^/]+)$/, '$1thumbs/$2');
}
function _imgWithThumb(src, fallback) {
  const img = document.createElement('img');
  const thumb = _toThumb(src);
  img.src = thumb || src;
  if (thumb && thumb !== src) {
    img.onerror = () => { img.src = fallback || src; img.onerror = null; };
  } else {
    img.onerror = () => { img.style.display = 'none'; img.onerror = null; };
  }
  return img;
}

// Make a video-poster thumbnail: shows first frame, click opens lightbox
function _videoThumb(videoPath, cssText, onClickFn) {
  const v = document.createElement('video');
  v.src = videoPath + '#t=0.1';
  v.muted = true;
  v.preload = 'metadata';
  v.style.cssText = cssText;
  v.style.cursor = 'pointer';
  v.title = '▶ Смотреть видео';
  if (onClickFn) v.addEventListener('click', e => { e.stopPropagation(); onClickFn(); });
  return v;
}

// ── Biroly timeline bar: fill (or re-fill) a bar element ─────────────────────
function _fillBirolyBar(bBar, sessionKey, totalDur) {
  bBar.innerHTML = '';
  const archive  = typeof getBirolyArchive === 'function' ? getBirolyArchive() : [];
  const tlData   = getTimelineData();
  const sessData = tlData[sessionKey] || {};
  const activated = sessData.activated || [];
  const bTimings  = sessData.timings   || {};

  activated.forEach(idx => {
    const b = archive[idx];
    const t = bTimings[idx];
    if (!b || !t || t.start === undefined) return;

    const startVal = parseFloat(t.start);
    const endVal   = parseFloat(t.end);
    const cropVal  = parseFloat(t.crop) || 0;
    if (isNaN(startVal) || isNaN(endVal) || endVal <= startVal) return;

    const duration  = endVal - startVal;          // clip duration stays fixed during drag
    const cropStart = Math.max(0, startVal - cropVal);
    const blockLeft  = cropStart / totalDur * 100;
    const blockWidth = (endVal - cropStart) / totalDur * 100;
    const cropFrac   = (blockWidth > 0 && (startVal - cropStart) > 0)
      ? ((startVal - cropStart) / (endVal - cropStart) * 100) : 0;

    const block = document.createElement('div');
    block.style.cssText = `position:absolute;left:${blockLeft.toFixed(3)}%;width:${Math.max(blockWidth, 0.3).toFixed(3)}%;height:100%;box-sizing:border-box;overflow:hidden;border-radius:2px;cursor:grab;`;
    block.title = `${b.name || 'Бирол'}\nс: ${startVal.toFixed(2)}s  до: ${endVal.toFixed(2)}s  crop: ${cropVal.toFixed(2)}s\nТяни для перемещения`;

    if (cropFrac > 0) {
      const cropPart = document.createElement('div');
      cropPart.style.cssText = `position:absolute;left:0;width:${cropFrac.toFixed(3)}%;height:100%;background:#666;filter:grayscale(1);border-right:2px dashed #aaa;box-sizing:border-box;`;
      block.appendChild(cropPart);
    }

    const color = TL_COLORS[idx % TL_COLORS.length];
    const activePart = document.createElement('div');
    activePart.style.cssText = `position:absolute;left:${cropFrac.toFixed(3)}%;width:${(100 - cropFrac).toFixed(3)}%;height:100%;background:${color};box-sizing:border-box;display:flex;align-items:center;overflow:hidden;`;
    activePart.innerHTML = `<span style="font-size:7px;color:#fff;font-weight:bold;padding:0 2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;pointer-events:none;">${b.name || 'Б'}</span>`;
    block.appendChild(activePart);

    // ── Drag to reposition ──────────────────────────────────────────────────
    block.addEventListener('mousedown', e => {
      e.preventDefault();
      const barRect  = bBar.getBoundingClientRect();
      const origLeft = cropStart;   // seconds from bar start to block left edge
      const startX   = e.clientX;

      block.style.cursor = 'grabbing';
      document.body.style.userSelect = 'none';

      const onMove = ev => {
        const deltaX   = ev.clientX - startX;
        const deltaSec = deltaX / barRect.width * totalDur;
        // Clamp: block left edge ≥ 0, block right edge ≤ totalDur
        const newCropStart = Math.max(0, Math.min(origLeft + deltaSec, totalDur - (endVal - cropStart)));
        const newStart     = newCropStart + cropVal;
        const newEnd       = newStart + duration;
        // Move block visually
        block.style.left = (newCropStart / totalDur * 100).toFixed(3) + '%';
        block.title = `${b.name || 'Бирол'}\nс: ${newStart.toFixed(2)}s  до: ${newEnd.toFixed(2)}s  crop: ${cropVal.toFixed(2)}s`;
      };

      const onUp = ev => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        block.style.cursor = 'grab';
        document.body.style.userSelect = '';

        // Final position
        const deltaX   = ev.clientX - startX;
        const deltaSec = deltaX / barRect.width * totalDur;
        const newCropStart = Math.max(0, Math.min(origLeft + deltaSec, totalDur - (endVal - cropStart)));
        const newStart     = parseFloat((newCropStart + cropVal).toFixed(2));
        const newEnd       = parseFloat((newStart + duration).toFixed(2));

        // Save to localStorage
        const d = getTimelineData();
        if (!d[sessionKey]) d[sessionKey] = {};
        if (!d[sessionKey].timings) d[sessionKey].timings = {};
        d[sessionKey].timings[idx] = { crop: cropVal.toFixed(2), start: newStart.toFixed(2), end: newEnd.toFixed(2) };
        setTimelineData(d);

        // Re-render right column — re-sorts active birolys by new start time
        window.refreshTimelineBirolys?.();
        // Re-render bar (refreshTimelineBirolys → renderSessionBirolys → refreshBirolyBars covers it,
        // but call directly too in case the column isn't in DOM yet)
        _fillBirolyBar(bBar, sessionKey, totalDur);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    bBar.appendChild(block);
  });
}

// Refresh only biroly bars already in DOM (fast, no async) ────────────────────
function refreshBirolyBars() {
  document.querySelectorAll('.timeline-biroly-bar[data-session-key]').forEach(el => {
    const totalDur = parseFloat(el.dataset.totalDur) || 0;
    if (totalDur > 0) _fillBirolyBar(el, el.dataset.sessionKey, totalDur);
  });
}
window.refreshBirolyBars = refreshBirolyBars;

// ── Build video fragments strip for one session (used inside timeline row) ────
function _buildFragStrip(session, sessionKey, opts = {}) {
  const excludedSet = opts.excludedSet || new Set();
  const fragRow = document.createElement('div');
  fragRow.style.cssText = 'display:flex;gap:8px;overflow-x:auto;padding-bottom:6px;margin-bottom:8px;border-bottom:1px solid #a0a0a0;';

  // Build ordered list: non-excluded first, excluded at end (greyed)
  const cellOrder = [];
  session.cells.forEach((cell, idx) => {
    if (!cell.videoPath && !cell.videoError && !cell._videoPending && !cell.avatarTaskId) return;
    cellOrder.push({ cell, idx, excluded: excludedSet.has(idx) });
  });
  cellOrder.sort((a, b) => (a.excluded ? 1 : 0) - (b.excluded ? 1 : 0));

  cellOrder.forEach(({ cell, idx, excluded }) => {
    const imgPath = cell.thumbPath || cell.imagePath || cell.charImagePath;

    const frag = document.createElement('div');
    frag.style.cssText = 'flex-shrink:0;width:88px;display:flex;flex-direction:column;align-items:center;gap:3px;' + (excluded ? 'opacity:0.35;filter:grayscale(1);' : '');

    const numEl = document.createElement('div');
    numEl.style.cssText = 'font-size:8px;color:#808080;align-self:flex-start;';
    numEl.textContent = idx + 1;

    const thumbBox = document.createElement('div');
    thumbBox.style.cssText = `width:86px;height:115px;border:1px solid #808080;overflow:hidden;background:#1a1a1a;flex-shrink:0;cursor:${cell.videoPath ? 'pointer' : 'default'};position:relative;`;
    if (imgPath) {
      const img = _imgWithThumb(imgPath, cell.imagePath || cell.charImagePath);
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
      // If image fails entirely, fall back to video first-frame
      img.addEventListener('error', () => {
        if (cell.videoPath && img.parentNode) {
          const vt = _videoThumb(cell.videoPath, 'width:100%;height:100%;object-fit:cover;display:block;', () => openVideoLightbox(cell.videoPath));
          img.parentNode.replaceChild(vt, img);
        }
      }, { once: true });
      thumbBox.appendChild(img);
    } else if (cell.videoPath) {
      // No image at all — show video first-frame directly
      const vt = _videoThumb(cell.videoPath, 'width:100%;height:100%;object-fit:cover;display:block;', () => openVideoLightbox(cell.videoPath));
      thumbBox.appendChild(vt);
    }
    if (cell._videoPending || cell.avatarTaskId) {
      const ov = document.createElement('div');
      ov.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;';
      ov.innerHTML = '<span style="color:#fff;font-size:18px;">⏳</span>';
      thumbBox.appendChild(ov);
    } else if (cell.videoPath) {
      thumbBox.title = 'Нажмите для просмотра видео';
      const playOv = document.createElement('div');
      playOv.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity 0.15s;background:rgba(0,0,0,0.3);';
      playOv.innerHTML = '<span style="color:#fff;font-size:24px;">▶</span>';
      thumbBox.appendChild(playOv);
      thumbBox.addEventListener('mouseenter', () => { playOv.style.opacity = '1'; });
      thumbBox.addEventListener('mouseleave', () => { playOv.style.opacity = '0'; });
      thumbBox.addEventListener('click', () => openVideoLightbox(cell.videoPath));
    } else if (cell.videoError) {
      const errOv = document.createElement('div');
      errOv.style.cssText = 'position:absolute;inset:0;background:rgba(170,0,0,0.35);display:flex;align-items:center;justify-content:center;';
      errOv.innerHTML = '<span style="color:#fff;font-size:18px;">❌</span>';
      thumbBox.appendChild(errOv);
    }

    const statusArea = document.createElement('div');
    statusArea.style.cssText = 'width:86px;';

    if (cell.videoPath) {
      const playBtn = document.createElement('button');
      playBtn.textContent = '▶';
      playBtn.style.cssText = 'width:86px;font-size:9px;padding:2px 0;cursor:pointer;';
      playBtn.addEventListener('click', () => openVideoLightbox(cell.videoPath));
      statusArea.appendChild(playBtn);
    } else if (cell._videoPending || cell.avatarTaskId) {
      const d = document.createElement('div');
      d.style.cssText = 'font-size:8px;color:#666;text-align:center;padding:2px 0;';
      d.textContent = '⏳ Генерация…';
      statusArea.appendChild(d);
    } else if (cell.videoError) {
      const retryBtn = document.createElement('button');
      retryBtn.textContent = '↺';
      retryBtn.title = 'Повторить генерацию';
      retryBtn.style.cssText = 'width:86px;font-size:9px;padding:2px 0;cursor:pointer;';
      retryBtn.addEventListener('click', async () => {
        if (!cell.audioPath || !imgPath) return;
        retryBtn.disabled = true;
        cell._videoPending = true; delete cell.videoError;
        renderAllTimelines();
        try {
          const videoParams = getEngineParams?.('kling/ai-avatar-pro') || {};
          const defaultPrompt = videoParams.prompt || 'Natural speaking motion with subtle head movement and relaxed posture';
          let prompt = defaultPrompt;
          if (idx > 0) {
            try {
              const pr = await fetch('/api/audio/avatar-prompt', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ imagePath: imgPath, text: cell.line }),
              });
              const pd = await pr.json();
              if (pd.success && pd.prompt) prompt = pd.prompt;
            } catch {}
          }
          const r = await fetch('/api/audio/avatar', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imagePath: imgPath, audioPath: cell.audioPath, prompt, videoParams }),
          });
          const d = await r.json();
          if (!d.success) throw new Error(d.error);
          cell.avatarTaskId = d.taskId; saveEditState();
          const videoPath = await pollAvatar(d.taskId);
          cell.videoPath = videoPath; cell.videoError = null;
          delete cell.avatarTaskId;
        } catch (err) {
          cell.videoError = err.message || 'Avatar failed';
          delete cell.avatarTaskId;
        }
        delete cell._videoPending; saveEditState(); renderAllTimelines();
      });
      statusArea.appendChild(retryBtn);
    }

    frag.appendChild(numEl); frag.appendChild(thumbBox); frag.appendChild(statusArea);
    fragRow.appendChild(frag);
  });

  return fragRow;
}

// ── Helper: get audio duration via Audio element ──────────────────────────────
function getAudioDuration(src) {
  return new Promise(resolve => {
    const a = new Audio(src);
    a.addEventListener('loadedmetadata', () => resolve(a.duration || 0), { once: true });
    a.addEventListener('error', () => resolve(0), { once: true });
    a.load();
  });
}

// ── Timeline timings: { [sessionKey]: { [birolyIdx]: { start, end } } } ────────
// Source of truth for WHICH birolys to show is always getActiveBirolyIdxs() order.
// This store holds only the start/end values entered by the user,
// plus a per-session "excluded" set for birolys removed with ×.
const TIMELINE_DATA_KEY    = 'timeline_data_v2';
const BIROLY_DEFAULTS_KEY  = 'biroly_defaults_v1';
function getTimelineData()  { try { return JSON.parse(localStorage.getItem(TIMELINE_DATA_KEY)   || '{}'); } catch { return {}; } }
function setTimelineData(d) { localStorage.setItem(TIMELINE_DATA_KEY, JSON.stringify(d)); }
function getBirolyDefaults()  { try { return JSON.parse(localStorage.getItem(BIROLY_DEFAULTS_KEY) || '{}'); } catch { return {}; } }
function setBirolyDefaults(d) { localStorage.setItem(BIROLY_DEFAULTS_KEY, JSON.stringify(d)); }

// ── Audio library (music + sfx uploaded by user) ─────────────────────────────
const AUDIO_LIB_KEY = 'audio_library_v1';
function getAudioLib()    { try { return JSON.parse(localStorage.getItem(AUDIO_LIB_KEY) || '[]'); } catch { return []; } }
function saveAudioLib(lib){ localStorage.setItem(AUDIO_LIB_KEY, JSON.stringify(lib)); }

// ── makeMusicControl(sessionKey, tlData, getVideoDur) ────────────────────────
// Returns { el, getUrl, getOffset, getVolume, setSaveCallback }
function makeMusicControl(sessionKey, tlData, getVideoDur) {
  const sd = tlData[sessionKey] || {};
  let currentUrl    = sd.music        || 'Нет';
  let currentOffset = parseFloat(sd.musicOffset) || 0;
  let currentVolume = (sd.musicVolume != null && !isNaN(sd.musicVolume)) ? parseFloat(sd.musicVolume) : 0.5;
  let _saveCallback = null;

  function _saveTl(patch) {
    const d = getTimelineData();
    if (!d[sessionKey]) d[sessionKey] = {};
    Object.assign(d[sessionKey], patch);
    setTimelineData(d);
  }

  const wrap = document.createElement('div');
  wrap.className = 'audio-ctrl-wrap';

  // ── Row 1: label + dropdown + del button ─────────────────────────────────
  const row1 = document.createElement('div');
  row1.className = 'audio-ctrl-row';
  const lbl = document.createElement('span');
  lbl.className = 'audio-ctrl-lbl';
  lbl.textContent = 'Музычка:';
  const sel = document.createElement('select');
  sel.className = 'audio-ctrl-sel';
  const delBtn = document.createElement('button');
  delBtn.className = 'audio-del-btn'; delBtn.textContent = '🗑'; delBtn.title = 'Удалить из библиотеки';

  function _rebuildSel() {
    const lib = getAudioLib().filter(x => x.type === 'music');
    sel.innerHTML = '';
    ['Нет', 'Рандом'].forEach(v => { const o = document.createElement('option'); o.value = v; o.textContent = v; sel.appendChild(o); });
    lib.forEach(item => { const o = document.createElement('option'); o.value = item.webPath; o.textContent = item.name; sel.appendChild(o); });
    sel.value = currentUrl;
  }
  _rebuildSel();
  row1.appendChild(lbl); row1.appendChild(sel); row1.appendChild(delBtn);
  wrap.appendChild(row1);

  // ── Collapsible details panel ─────────────────────────────────────────────
  const details = document.createElement('details');
  details.className = 'audio-details';
  const summary = document.createElement('summary');
  summary.className = 'audio-details-summary';
  summary.textContent = 'Настройки…';
  details.appendChild(summary);

  // ── Native audio player ───────────────────────────────────────────────────
  const player = document.createElement('audio');
  player.className = 'audio-player'; player.controls = true; player.preload = 'metadata';
  details.appendChild(player);

  // ── Timeline bar with video projection ───────────────────────────────────
  const barOuter = document.createElement('div');
  barOuter.className = 'audio-bar-outer';

  // ruler: left label (0s), right label (vidDur)
  const rulerRow = document.createElement('div');
  rulerRow.className = 'audio-bar-ruler';
  const rulerLeft  = document.createElement('span'); rulerLeft.textContent = '0s';
  const rulerRight = document.createElement('span');
  rulerRow.appendChild(rulerLeft); rulerRow.appendChild(rulerRight);
  barOuter.appendChild(rulerRow);

  // bar track
  const barWrap = document.createElement('div');
  barWrap.className = 'audio-music-bar-wrap';
  barWrap.title = 'Перетащи мышью для смещения';
  const bar    = document.createElement('div'); bar.className = 'audio-music-bar';
  const barLbl = document.createElement('div'); barLbl.className = 'audio-music-bar-lbl';
  // video duration overlay (shows exactly 0→vidDur as a faint region)
  const vidOverlay = document.createElement('div'); vidOverlay.className = 'audio-vid-overlay';
  barWrap.appendChild(vidOverlay);
  barWrap.appendChild(bar);
  barWrap.appendChild(barLbl);
  barOuter.appendChild(barWrap);
  details.appendChild(barOuter);

  // ── Offset + Volume row ───────────────────────────────────────────────────
  const paramsRow = document.createElement('div');
  paramsRow.className = 'audio-params-row';

  const offInp = document.createElement('input');
  offInp.type = 'number'; offInp.min = '0'; offInp.step = '0.1'; offInp.value = currentOffset.toFixed(1);
  offInp.style.cssText = 'width:46px;font-size:10px;padding:1px 3px;border:1px solid #bbb;border-radius:2px;';
  const offWrap = document.createElement('label');
  offWrap.style.cssText = 'display:flex;align-items:center;gap:3px;font-size:9px;color:#666;';
  offWrap.textContent = 'Старт:'; offWrap.appendChild(offInp);
  const offSuf = document.createElement('span'); offSuf.textContent = 's'; offSuf.style.cssText = 'font-size:9px;color:#888;';

  const volInp = document.createElement('input');
  volInp.type = 'range'; volInp.min = '0'; volInp.max = '1'; volInp.step = '0.05'; volInp.value = currentVolume; volInp.style.width = '68px';
  const volVal = document.createElement('span'); volVal.textContent = currentVolume.toFixed(2); volVal.style.cssText = 'font-size:9px;color:#666;min-width:24px;';
  const volWrap = document.createElement('label');
  volWrap.style.cssText = 'display:flex;align-items:center;gap:3px;font-size:9px;color:#666;';
  volWrap.textContent = 'Громк:'; volWrap.appendChild(volInp);

  // Save button
  const saveBtn = document.createElement('button');
  saveBtn.className = 'audio-save-btn'; saveBtn.textContent = '💾'; saveBtn.title = 'Сохранить параметры и обновить renderBody';

  paramsRow.appendChild(offWrap); paramsRow.appendChild(offSuf);
  paramsRow.appendChild(volWrap); paramsRow.appendChild(volVal);
  paramsRow.appendChild(saveBtn);
  details.appendChild(paramsRow);

  // ── Update bar visuals ────────────────────────────────────────────────────
  function _updateBar() {
    const audioDur = (player.duration && isFinite(player.duration)) ? player.duration : 0;
    const vidDur   = getVideoDur ? Math.max(getVideoDur(), 1) : 30;

    // Update ruler right label
    rulerRight.textContent = vidDur.toFixed(1) + 's';

    // Video overlay: full-width = 100% of bar, but we want to show where vidDur ends relative to musicDur
    // The bar "scale" is max(audioDur+offset, vidDur). Show full audio range.
    const scaleDur = Math.max(audioDur + currentOffset, vidDur, 1);
    const vidPct   = (vidDur / scaleDur) * 100;
    vidOverlay.style.width = vidPct + '%';

    if (!audioDur) { bar.style.width = '0'; barLbl.textContent = ''; return; }

    const pctLeft  = (currentOffset / scaleDur) * 100;
    const pctWidth = (audioDur     / scaleDur) * 100;
    bar.style.left  = pctLeft + '%';
    bar.style.width = Math.max(pctWidth, 1) + '%';
    barLbl.textContent = audioDur.toFixed(1) + 's';
  }

  player.addEventListener('loadedmetadata', _updateBar);

  // Drag the blue music bar to set offset
  barWrap.addEventListener('mousedown', e => {
    e.preventDefault();
    const rect    = barWrap.getBoundingClientRect();
    const audioDur = (player.duration && isFinite(player.duration)) ? player.duration : 0;
    const vidDur   = getVideoDur ? Math.max(getVideoDur(), 1) : 30;
    const scaleDur = Math.max(audioDur + currentOffset, vidDur, 1);
    const startX   = e.clientX;
    const origOffset = currentOffset;
    const onMove = ev => {
      const dx = ev.clientX - startX;
      currentOffset = parseFloat(Math.max(0, origOffset + (dx / rect.width) * scaleDur).toFixed(1));
      offInp.value = currentOffset.toFixed(1);
      _updateBar();
    };
    const onUp = () => {
      _saveTl({ musicOffset: currentOffset });
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  offInp.addEventListener('change', () => {
    currentOffset = Math.max(0, parseFloat(offInp.value) || 0);
    offInp.value = currentOffset.toFixed(1);
    _saveTl({ musicOffset: currentOffset });
    _updateBar();
  });
  volInp.addEventListener('input', () => {
    currentVolume = parseFloat(volInp.value);
    volVal.textContent = currentVolume.toFixed(2);
    player.volume = currentVolume;
    _saveTl({ musicVolume: currentVolume });
  });

  saveBtn.addEventListener('click', async () => {
    _saveTl({ musicOffset: currentOffset, musicVolume: currentVolume });
    if (!_saveCallback) { saveBtn.textContent = '✓'; setTimeout(() => { saveBtn.textContent = '💾'; }, 1200); return; }
    saveBtn.disabled = true; saveBtn.textContent = '…';
    try {
      const result = await _saveCallback();
      saveBtn.textContent = result.success ? '✓' : '⚠';
      if (!result.success) console.warn('[music save]', result.error);
    } catch (e) { saveBtn.textContent = '⚠'; console.warn('[music save]', e); }
    finally { saveBtn.disabled = false; setTimeout(() => { saveBtn.textContent = '💾'; }, 2000); }
  });

  // ── Show/hide details based on file selection ─────────────────────────────
  function _applyUrl(url) {
    currentUrl = url;
    const isFile = url && url !== 'Нет' && url !== 'Рандом';
    details.style.display = isFile ? '' : 'none';
    delBtn.style.display  = isFile ? '' : 'none';
    if (isFile) { player.src = url; player.load(); }
    _saveTl({ music: url });
    _updateBar();
  }

  _applyUrl(currentUrl);
  sel.addEventListener('change', () => _applyUrl(sel.value));

  delBtn.addEventListener('click', () => {
    if (!currentUrl || currentUrl === 'Нет' || currentUrl === 'Рандом') return;
    saveAudioLib(getAudioLib().filter(x => !(x.type === 'music' && x.webPath === currentUrl)));
    currentUrl = 'Нет'; _rebuildSel(); _applyUrl('Нет');
  });

  // ── Upload row ────────────────────────────────────────────────────────────
  const upRow = document.createElement('div');
  upRow.className = 'audio-upload-row';
  const fileInp = document.createElement('input'); fileInp.type = 'file'; fileInp.accept = 'audio/*';
  const nameInp = document.createElement('input'); nameInp.type = 'text'; nameInp.placeholder = 'Название…'; nameInp.maxLength = 60;
  const upBtn   = document.createElement('button'); upBtn.className = 'audio-upload-btn'; upBtn.textContent = '⬆ Загрузить';

  fileInp.addEventListener('change', () => { if (fileInp.files[0] && !nameInp.value) nameInp.value = fileInp.files[0].name.replace(/\.[^.]+$/, '').slice(0, 40); });
  upBtn.addEventListener('click', async () => {
    if (!fileInp.files[0]) return;
    upBtn.disabled = true; upBtn.textContent = '…';
    try {
      const fd = new FormData(); fd.append('file', fileInp.files[0]);
      if (nameInp.value) fd.append('name', nameInp.value);
      const r = await fetch('/api/audio/upload-file', { method: 'POST', body: fd });
      const d = await r.json();
      if (!d.success) throw new Error(d.error);
      const lib = getAudioLib();
      lib.push({ id: Date.now().toString(), name: d.name, webPath: d.webPath, type: 'music', addedAt: new Date().toISOString() });
      saveAudioLib(lib); _rebuildSel(); sel.value = d.webPath; _applyUrl(d.webPath);
      fileInp.value = ''; nameInp.value = '';
    } catch (e) { alert('Ошибка загрузки: ' + e.message); }
    finally { upBtn.disabled = false; upBtn.textContent = '⬆ Загрузить'; }
  });

  upRow.appendChild(fileInp); upRow.appendChild(nameInp); upRow.appendChild(upBtn);
  wrap.appendChild(details);
  wrap.appendChild(upRow);

  return {
    el: wrap,
    getUrl:    () => currentUrl,
    getOffset: () => currentOffset,
    getVolume: () => currentVolume,
    setSaveCallback: cb => { _saveCallback = cb; },
  };
}

// ── makeSfxControl(sessionKey, tlData, sfxKey) ───────────────────────────────
// Returns { el, getUrl }
// sfxKey: key in tlData[sessionKey] to store selection (default 'sfx')
function makeSfxControl(sessionKey, tlData, sfxKey = 'sfx') {
  const sd = tlData[sessionKey] || {};
  let currentUrl = sd[sfxKey] || 'Нет';

  function _saveTl(patch) {
    const d = getTimelineData();
    if (!d[sessionKey]) d[sessionKey] = {};
    Object.assign(d[sessionKey], patch);
    setTimelineData(d);
  }

  const wrap = document.createElement('div');
  wrap.className = 'audio-ctrl-wrap audio-sfx-wrap'; // black top border separator via CSS

  const row1 = document.createElement('div');
  row1.className = 'audio-ctrl-row';
  const lbl = document.createElement('span');
  lbl.className = 'audio-ctrl-lbl'; lbl.textContent = sfxKey === 'segSfx' ? 'Вжухи (гол.):' : sfxKey === 'biroSfx' ? 'Вжухи (бир.):' : 'Вжухи:';
  const sel   = document.createElement('select'); sel.className = 'audio-ctrl-sel';
  const playBtn = document.createElement('button'); playBtn.className = 'audio-play-btn'; playBtn.textContent = '▶'; playBtn.title = 'Прослушать';
  const delBtn  = document.createElement('button'); delBtn.className = 'audio-del-btn'; delBtn.textContent = '🗑'; delBtn.title = 'Удалить из библиотеки';

  // hidden player
  const player = document.createElement('audio'); player.preload = 'none'; player.style.display = 'none';
  wrap.appendChild(player);

  function _rebuildSel() {
    const lib = getAudioLib().filter(x => x.type === 'sfx');
    sel.innerHTML = '';
    ['Нет', 'Рандом'].forEach(v => { const o = document.createElement('option'); o.value = v; o.textContent = v; sel.appendChild(o); });
    lib.forEach(item => { const o = document.createElement('option'); o.value = item.webPath; o.textContent = item.name; sel.appendChild(o); });
    sel.value = currentUrl;
  }
  _rebuildSel();

  function _applyUrl(url) {
    currentUrl = url;
    const isFile = url && url !== 'Нет' && url !== 'Рандом';
    playBtn.style.display = isFile ? '' : 'none';
    delBtn.style.display  = isFile ? '' : 'none';
    if (isFile) player.src = url;
    _saveTl({ [sfxKey]: url });
  }
  _applyUrl(currentUrl);

  sel.addEventListener('change', () => _applyUrl(sel.value));
  playBtn.addEventListener('click', () => {
    if (player.paused) { player.load(); player.play(); playBtn.textContent = '⏹'; }
    else { player.pause(); player.currentTime = 0; playBtn.textContent = '▶'; }
  });
  player.addEventListener('ended', () => { playBtn.textContent = '▶'; });
  delBtn.addEventListener('click', () => {
    if (!currentUrl || currentUrl === 'Нет' || currentUrl === 'Рандом') return;
    saveAudioLib(getAudioLib().filter(x => !(x.type === 'sfx' && x.webPath === currentUrl)));
    currentUrl = 'Нет'; _rebuildSel(); _applyUrl('Нет');
  });

  row1.appendChild(lbl); row1.appendChild(sel); row1.appendChild(playBtn); row1.appendChild(delBtn);
  wrap.appendChild(row1);

  // ── Upload row ───────────────────────────────────────────────────────────
  const upRow = document.createElement('div');
  upRow.className = 'audio-upload-row';
  const fileInp = document.createElement('input');
  fileInp.type = 'file'; fileInp.accept = 'audio/*';
  const nameInp = document.createElement('input');
  nameInp.type = 'text'; nameInp.placeholder = 'Название…'; nameInp.maxLength = 60;
  const upBtn = document.createElement('button');
  upBtn.className = 'audio-upload-btn'; upBtn.textContent = '⬆ Загрузить';

  fileInp.addEventListener('change', () => {
    if (fileInp.files[0] && !nameInp.value) nameInp.value = fileInp.files[0].name.replace(/\.[^.]+$/, '').slice(0, 40);
  });

  upBtn.addEventListener('click', async () => {
    if (!fileInp.files[0]) return;
    upBtn.disabled = true; upBtn.textContent = '…';
    try {
      const fd = new FormData();
      fd.append('file', fileInp.files[0]);
      if (nameInp.value) fd.append('name', nameInp.value);
      const r = await fetch('/api/audio/upload-file', { method: 'POST', body: fd });
      const d = await r.json();
      if (!d.success) throw new Error(d.error);
      const lib = getAudioLib();
      lib.push({ id: Date.now().toString(), name: d.name, webPath: d.webPath, type: 'sfx', addedAt: new Date().toISOString() });
      saveAudioLib(lib);
      _rebuildSel();
      sel.value = d.webPath;
      _applyUrl(d.webPath);
      fileInp.value = ''; nameInp.value = '';
    } catch (e) { alert('Ошибка загрузки: ' + e.message); }
    finally { upBtn.disabled = false; upBtn.textContent = '⬆ Загрузить'; }
  });

  upRow.appendChild(fileInp); upRow.appendChild(nameInp); upRow.appendChild(upBtn);
  wrap.appendChild(upRow);

  return { el: wrap, getUrl: () => currentUrl };
}

function getCompletedSessions() {
  return Object.entries(editFrozenSessions).filter(([, s]) => {
    if (!Array.isArray(s.cells)) return false;
    const audioCells = s.cells.filter(c => c.audioPath);
    return audioCells.length > 0 && audioCells.every(c => c.videoPath && !c._videoPending && !c.avatarTaskId && !c.videoError);
  });
}
