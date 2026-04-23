/* scen-montage.js — openVideoLightbox, renderMontagePanel, biroly bar fill, music/sfx controls, getCompletedSessions */

// ── Timeline block selection (click to select, Del to deactivate) ─────────────
let _tlSelected = null; // { type:'biroly'|'hook', sessionKey, idx, blockEl, bBar, totalDur }

function _clearTlSelection() {
  if (_tlSelected?.blockEl) {
    _tlSelected.blockEl.style.outline = '';
    _tlSelected.blockEl.style.zIndex  = '';
  }
  if (_tlSelected?._rightCard) {
    _tlSelected._rightCard.style.outline = '';
  }
  _tlSelected = null;
}

function _setTlSelected(type, sessionKey, idx, blockEl, bBar, totalDur) {
  _clearTlSelection();
  _tlSelected = { type, sessionKey, idx, blockEl, bBar, totalDur };
  blockEl.style.outline = '2px solid #fff';
  blockEl.style.zIndex  = '10';

  // Highlight matching card in right column; open its dropdown, collapse the other
  const rightCol = document.querySelector(`.timeline-col-right[data-session-key="${sessionKey}"]`);
  if (rightCol) {
    const birolysSub = rightCol.querySelector('.birolys-sub');
    const hooksSub   = rightCol.querySelector('.hooks-sub');

    if (type === 'biroly') {
      // Open birolys, collapse hooks
      const detB = birolysSub?.querySelector('details');
      if (detB && !detB.open) detB.open = true;
      const detH = hooksSub?.querySelector('details');
      if (detH && detH.open) detH.open = false;

      const card = birolysSub?.querySelector(`[data-biroly-idx="${idx}"]`);
      if (card) {
        card.style.outline = '2px solid #4a6a9a';
        card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        _tlSelected._rightCard = card;
      }
    } else if (type === 'hook') {
      // Open hooks, collapse birolys
      const detH = hooksSub?.querySelector('details');
      if (detH && !detH.open) detH.open = true;
      const detB = birolysSub?.querySelector('details');
      if (detB && detB.open) detB.open = false;

      const card = hooksSub?.querySelector(`[data-hook-idx="${idx}"]`);
      if (card) {
        card.style.outline = '2px solid #b05010';
        card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        _tlSelected._rightCard = card;
      }
    }
  }
}

// One-time Del key handler
if (!window._tlDelHandlerAdded) {
  window._tlDelHandlerAdded = true;
  document.addEventListener('keydown', e => {
    if (e.key !== 'Delete' && e.key !== 'Del') return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.contentEditable === 'true') return;
    if (!_tlSelected) return;

    const { type, sessionKey, idx } = _tlSelected;
    _clearTlSelection();

    const d = getTimelineData();
    if (!d[sessionKey]) return;

    if (type === 'biroly') {
      const arr = d[sessionKey].activated || [];
      const pos = arr.indexOf(idx);
      if (pos !== -1) arr.splice(pos, 1);
      d[sessionKey].activated = arr;
      setTimelineData(d);
      window.refreshTimelineBirolys?.();

    } else if (type === 'hook') {
      const hd = d[sessionKey].hooks || {};
      const arr = hd.activated || [];
      const pos = arr.indexOf(idx);
      if (pos !== -1) arr.splice(pos, 1);
      if (hd.timings) delete hd.timings[idx];
      d[sessionKey].hooks = hd;
      setTimelineData(d);
      window.refreshTimelineBirolys?.();
    }
  });
}

// ── Video lightbox ─────────────────────────────────────────────────────────────
function openVideoLightbox(src) {
  let lb = document.getElementById('scen-video-lb');
  if (!lb) {
    lb = document.createElement('div');
    lb.id = 'scen-video-lb';
    lb.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.88);z-index:99999;align-items:center;justify-content:center;flex-direction:column;gap:12px;';
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

  activated.forEach(key => {
    const isNumericKey = typeof key === 'number' || /^\d+$/.test(String(key));
    const archiveIdx   = isNumericKey ? parseInt(key, 10) : archive.findIndex(e => e.id === key);
    const b = archiveIdx >= 0 ? archive[archiveIdx] : undefined;
    const t = bTimings[key];
    if (!b || !t || t.start === undefined) return;

    const startVal   = parseFloat(t.start);
    const endVal     = parseFloat(t.end);
    const cropVal    = parseFloat(t.crop)    || 0;
    const cropEndVal = parseFloat(t.cropEnd) || 0;
    if (isNaN(startVal) || isNaN(endVal) || endVal <= startVal) return;

    const duration      = endVal - startVal;      // clip duration stays fixed during drag
    const cropStart     = Math.max(0, startVal - cropVal);
    const totalBlockDur = endVal + cropEndVal - cropStart;
    const blockLeft     = cropStart / totalDur * 100;
    const blockWidth    = totalBlockDur / totalDur * 100;
    const csFrac        = totalBlockDur > 0 ? (startVal - cropStart) / totalBlockDur * 100 : 0;
    const actFrac       = totalBlockDur > 0 ? duration               / totalBlockDur * 100 : 100;
    const ceFrac        = totalBlockDur > 0 ? cropEndVal             / totalBlockDur * 100 : 0;

    const block = document.createElement('div');
    block.style.cssText = `position:absolute;left:${blockLeft.toFixed(3)}%;width:${Math.max(blockWidth, 0.3).toFixed(3)}%;height:100%;box-sizing:border-box;overflow:hidden;border-radius:2px;cursor:grab;`;
    block.title = `${b.name || 'Бирол'}\nс: ${startVal.toFixed(2)}s  до: ${endVal.toFixed(2)}s  crop↑: ${cropVal.toFixed(2)}s  crop↓: ${cropEndVal.toFixed(2)}s\nТяни для перемещения`;

    if (csFrac > 0) {
      const csPart = document.createElement('div');
      csPart.style.cssText = `position:absolute;left:0;width:${csFrac.toFixed(3)}%;height:100%;background:#666;filter:grayscale(1);border-right:2px dashed #aaa;box-sizing:border-box;`;
      block.appendChild(csPart);
    }

    const color = TL_COLORS[(archiveIdx >= 0 ? archiveIdx : 0) % TL_COLORS.length];
    const activePart = document.createElement('div');
    activePart.style.cssText = `position:absolute;left:${csFrac.toFixed(3)}%;width:${actFrac.toFixed(3)}%;height:100%;box-sizing:border-box;display:flex;align-items:center;overflow:hidden;`;
    const thumbSrc = b.thumbPath || b.imagePath;
    if (thumbSrc) {
      activePart.style.backgroundImage    = `url(${thumbSrc})`;
      activePart.style.backgroundSize     = 'cover';
      activePart.style.backgroundPosition = 'center';
      activePart.style.outline = `1px solid ${color}`;
    } else {
      activePart.style.background = color;
    }
    activePart.innerHTML = `<span style="font-size:7px;color:#fff;font-weight:bold;padding:0 2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;pointer-events:none;text-shadow:0 0 3px #000,0 0 3px #000;">${b.name || 'Б'}</span>`;
    block.appendChild(activePart);

    if (ceFrac > 0) {
      const cePart = document.createElement('div');
      cePart.style.cssText = `position:absolute;left:${(csFrac + actFrac).toFixed(3)}%;width:${ceFrac.toFixed(3)}%;height:100%;background:#666;filter:grayscale(1);border-left:2px dashed #aaa;box-sizing:border-box;`;
      block.appendChild(cePart);
    }

    // ── Click to select / drag to reposition ────────────────────────────────
    block.addEventListener('mousedown', e => {
      e.preventDefault();
      e.stopPropagation();
      const barRect  = bBar.getBoundingClientRect();
      const origLeft = cropStart;
      const startX   = e.clientX;
      let moved = false;

      block.style.cursor = 'grabbing';
      document.body.style.userSelect = 'none';

      const onMove = ev => {
        if (Math.abs(ev.clientX - startX) > 4) moved = true;
        if (!moved) return;
        const deltaSec     = (ev.clientX - startX) / barRect.width * totalDur;
        const newCropStart = Math.max(0, Math.min(origLeft + deltaSec, totalDur - totalBlockDur));
        const newStart     = newCropStart + cropVal;
        const newEnd       = newStart + duration;
        block.style.left = (newCropStart / totalDur * 100).toFixed(3) + '%';
        block.title = `${b.name || 'Бирол'}\nс: ${newStart.toFixed(2)}s  до: ${newEnd.toFixed(2)}s  crop↑: ${cropVal.toFixed(2)}s  crop↓: ${cropEndVal.toFixed(2)}s\n[Del] — удалить с таймлайна`;
      };

      const onUp = ev => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        block.style.cursor = 'grab';
        document.body.style.userSelect = '';

        if (!moved) {
          // Click — toggle selection
          if (_tlSelected?.blockEl === block) {
            _clearTlSelection();
          } else {
            _setTlSelected('biroly', sessionKey, key, block, bBar, totalDur);
          }
          return;
        }

        // Drag — save new position, clear selection
        _clearTlSelection();
        const deltaSec     = (ev.clientX - startX) / barRect.width * totalDur;
        const newCropStart = Math.max(0, Math.min(origLeft + deltaSec, totalDur - totalBlockDur));
        const newStart     = parseFloat((newCropStart + cropVal).toFixed(2));
        const newEnd       = parseFloat((newStart + duration).toFixed(2));

        const d = getTimelineData();
        if (!d[sessionKey]) d[sessionKey] = {};
        if (!d[sessionKey].timings) d[sessionKey].timings = {};
        d[sessionKey].timings[key] = { crop: cropVal.toFixed(2), cropEnd: cropEndVal.toFixed(2), start: newStart.toFixed(2), end: newEnd.toFixed(2) };
        setTimelineData(d);

        window.refreshTimelineBirolys?.();
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
      const reranBtn = document.createElement('button');
      reranBtn.textContent = '↺ Реран';
      reranBtn.style.cssText = 'width:86px;font-size:9px;padding:2px 0;cursor:pointer;';
      reranBtn.addEventListener('click', () => {
        const _obraz = (getObrazы?.() || []).find(o => String(o.id) === String(session.obrazId)) || null;
        _openSkleykaReranPopup(sessionKey, session, _obraz, idx);
      });
      statusArea.appendChild(reranBtn);
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
          try {
            const pr = await fetch('/api/audio/avatar-prompt', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ imagePath: imgPath, text: cell.line, detailImagePath: cell.detInfo?.path || null }),
            });
            const pd = await pr.json();
            if (pd.success && pd.prompt) prompt = pd.prompt;
          } catch {}
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
  let _trackDur     = 0;
  let _sunoLib      = [];

  function _saveTl(patch) {
    const d = getTimelineData();
    if (!d[sessionKey]) d[sessionKey] = {};
    Object.assign(d[sessionKey], patch);
    setTimelineData(d);
  }

  const wrap = document.createElement('div');
  wrap.className = 'audio-ctrl-wrap';

  // ── Row 1: dropdown + 🎵 generate + 🗑 delete + ⬆ upload toggle ─────────
  const row1 = document.createElement('div');
  row1.style.cssText = 'display:flex;gap:3px;align-items:center;';

  const sel = document.createElement('select');
  sel.className = 'audio-ctrl-sel';
  sel.style.flex = '1';

  const genBtn = document.createElement('button');
  genBtn.textContent = '🎵'; genBtn.title = 'Сгенерировать трек (Suno)';
  genBtn.style.cssText = 'width:24px;height:22px;padding:0;font-size:11px;cursor:pointer;flex-shrink:0;';

  const delBtn = document.createElement('button');
  delBtn.textContent = '🗑'; delBtn.title = 'Удалить трек из библиотеки';
  delBtn.style.cssText = 'width:24px;height:22px;padding:0;font-size:11px;cursor:pointer;flex-shrink:0;display:none;';

  const upToggleBtn = document.createElement('button');
  upToggleBtn.textContent = '⬆'; upToggleBtn.title = 'Загрузить свой трек';
  upToggleBtn.style.cssText = 'width:24px;height:22px;padding:0;font-size:11px;cursor:pointer;flex-shrink:0;';

  row1.appendChild(sel); row1.appendChild(genBtn); row1.appendChild(delBtn); row1.appendChild(upToggleBtn);
  wrap.appendChild(row1);

  // ── Upload row (collapsed by default) ────────────────────────────────────
  const upRow = document.createElement('div');
  upRow.style.cssText = 'display:none;gap:3px;align-items:center;margin-top:3px;flex-wrap:wrap;';
  const fileInp = document.createElement('input'); fileInp.type = 'file'; fileInp.accept = 'audio/*';
  fileInp.style.cssText = 'font-size:9px;flex:1;min-width:0;';
  const nameInp = document.createElement('input'); nameInp.type = 'text'; nameInp.placeholder = 'Название…'; nameInp.maxLength = 60;
  nameInp.style.cssText = 'font-size:9px;width:90px;padding:1px 3px;';
  const upBtn = document.createElement('button'); upBtn.textContent = '⬆';
  upBtn.style.cssText = 'font-size:9px;padding:1px 5px;cursor:pointer;white-space:nowrap;';
  upRow.appendChild(fileInp); upRow.appendChild(nameInp); upRow.appendChild(upBtn);
  wrap.appendChild(upRow);

  upToggleBtn.addEventListener('click', () => {
    upRow.style.display = upRow.style.display === 'none' ? 'flex' : 'none';
  });

  // ── Audio player ──────────────────────────────────────────────────────────
  const player = document.createElement('audio');
  player.controls = true; player.preload = 'metadata';
  player.style.cssText = 'width:100%;height:28px;margin-top:4px;display:none;';
  wrap.appendChild(player);

  // ── Shadow timeline bar ───────────────────────────────────────────────────
  const barOuter = document.createElement('div');
  barOuter.style.cssText = 'display:none;margin-top:5px;';

  const rulerRow = document.createElement('div');
  rulerRow.style.cssText = 'display:flex;justify-content:space-between;font-size:8px;color:#888;margin-bottom:2px;';
  const rulerLeft  = document.createElement('span'); rulerLeft.textContent = '0:00';
  const rulerRight = document.createElement('span'); rulerRight.textContent = '—';
  rulerRow.appendChild(rulerLeft); rulerRow.appendChild(rulerRight);
  barOuter.appendChild(rulerRow);

  const barTrack = document.createElement('div');
  barTrack.style.cssText = 'position:relative;height:18px;background:#c8c8c8;border-radius:2px;overflow:hidden;user-select:none;cursor:default;';
  barTrack.title = 'Перетащи синюю тень чтобы задать начало музыки';

  const shadowBlock = document.createElement('div');
  shadowBlock.style.cssText = 'position:absolute;top:0;height:100%;background:rgba(30,90,200,0.55);border-radius:2px;cursor:grab;min-width:6px;';
  barTrack.appendChild(shadowBlock);
  barOuter.appendChild(barTrack);

  const timingLabel = document.createElement('div');
  timingLabel.style.cssText = 'font-size:8px;color:#555;margin-top:2px;text-align:center;';
  barOuter.appendChild(timingLabel);
  wrap.appendChild(barOuter);

  // ── Volume + Save row ─────────────────────────────────────────────────────
  const paramsRow = document.createElement('div');
  paramsRow.style.cssText = 'display:none;gap:6px;align-items:center;margin-top:5px;';

  const volLabel = document.createElement('span');
  volLabel.textContent = 'Громк:'; volLabel.style.cssText = 'font-size:9px;color:#666;white-space:nowrap;';
  const volInp = document.createElement('input');
  volInp.type = 'range'; volInp.min = '0'; volInp.max = '1'; volInp.step = '0.05'; volInp.value = currentVolume;
  volInp.style.cssText = 'flex:1;';
  const volVal = document.createElement('span');
  volVal.textContent = currentVolume.toFixed(2); volVal.style.cssText = 'font-size:9px;color:#666;min-width:24px;';
  const saveBtn = document.createElement('button');
  saveBtn.textContent = '💾'; saveBtn.title = 'Сохранить параметры';
  saveBtn.style.cssText = 'padding:1px 4px;font-size:10px;cursor:pointer;flex-shrink:0;';
  paramsRow.appendChild(volLabel); paramsRow.appendChild(volInp); paramsRow.appendChild(volVal); paramsRow.appendChild(saveBtn);
  wrap.appendChild(paramsRow);

  // ── Shadow bar helpers ────────────────────────────────────────────────────
  function _fmtTime(s) {
    const m = Math.floor(s / 60);
    return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  }

  function _updateShadow() {
    if (!_trackDur) return;
    const vidDur = getVideoDur ? Math.max(getVideoDur(), 1) : 30;
    rulerRight.textContent = _fmtTime(_trackDur);
    const pctLeft  = Math.min((currentOffset / _trackDur) * 100, 100);
    const pctWidth = Math.min((vidDur / _trackDur) * 100, 100 - pctLeft);
    shadowBlock.style.left  = pctLeft  + '%';
    shadowBlock.style.width = Math.max(pctWidth, 1) + '%';
    const endSec = Math.min(currentOffset + vidDur, _trackDur);
    timingLabel.textContent = `${_fmtTime(currentOffset)} → ${_fmtTime(endSec)}  (видео: ${vidDur.toFixed(1)}s)`;
  }

  shadowBlock.addEventListener('mousedown', e => {
    e.preventDefault();
    const rect = barTrack.getBoundingClientRect();
    const vidDur = getVideoDur ? Math.max(getVideoDur(), 1) : 30;
    const startX = e.clientX;
    const origOffset = currentOffset;
    shadowBlock.style.cursor = 'grabbing';
    const onMove = ev => {
      const dx    = ev.clientX - startX;
      const delta = (dx / rect.width) * _trackDur;
      currentOffset = parseFloat(Math.max(0, Math.min(origOffset + delta, _trackDur - vidDur)).toFixed(1));
      _updateShadow();
    };
    const onUp = () => {
      shadowBlock.style.cursor = 'grab';
      _saveTl({ musicOffset: currentOffset });
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  });

  player.addEventListener('loadedmetadata', () => {
    _trackDur = (player.duration && isFinite(player.duration)) ? player.duration : 0;
    _updateShadow();
  });

  // ── Dropdown population ───────────────────────────────────────────────────
  function _rebuildSel() {
    const uploaded = getAudioLib().filter(x => x.type === 'music');
    sel.innerHTML = '';
    const noneOpt = document.createElement('option'); noneOpt.value = 'Нет'; noneOpt.textContent = 'Нет'; sel.appendChild(noneOpt);

    if (_sunoLib.length) {
      const og = document.createElement('optgroup'); og.label = '🎵 Suno AI';
      _sunoLib.forEach(t => {
        const o = document.createElement('option');
        o.value = t.audioPath; o.textContent = t.title;
        o.dataset.sunoId = t.id;
        og.appendChild(o);
      });
      sel.appendChild(og);
    }
    if (uploaded.length) {
      const og = document.createElement('optgroup'); og.label = '📁 Загруженные';
      uploaded.forEach(t => {
        const o = document.createElement('option'); o.value = t.webPath; o.textContent = t.name; og.appendChild(o);
      });
      sel.appendChild(og);
    }
    if (currentUrl && currentUrl !== 'Нет') sel.value = currentUrl;
  }

  async function _loadAndRebuildSel() {
    try {
      const r = await fetch('/api/audio/suno/library');
      const d = await r.json();
      if (d.success) _sunoLib = d.list || [];
    } catch {}
    _rebuildSel();
  }

  function _applyUrl(url) {
    currentUrl = url;
    const isFile = url && url !== 'Нет';
    player.style.display   = isFile ? '' : 'none';
    barOuter.style.display = isFile ? '' : 'none';
    paramsRow.style.display = isFile ? 'flex' : 'none';
    delBtn.style.display    = isFile ? '' : 'none';
    if (isFile) { player.src = url; player.load(); }
    _saveTl({ music: url });
  }

  _loadAndRebuildSel().then(() => _applyUrl(currentUrl));
  sel.addEventListener('change', () => _applyUrl(sel.value));

  // ── Delete ────────────────────────────────────────────────────────────────
  delBtn.addEventListener('click', async () => {
    if (!currentUrl || currentUrl === 'Нет') return;
    const sunoId = sel.selectedOptions[0]?.dataset?.sunoId;
    if (sunoId) {
      await fetch(`/api/audio/suno/library/${sunoId}`, { method: 'DELETE' });
      _sunoLib = _sunoLib.filter(t => t.id !== sunoId);
    } else {
      saveAudioLib(getAudioLib().filter(x => !(x.type === 'music' && x.webPath === currentUrl)));
    }
    currentUrl = 'Нет';
    _rebuildSel();
    _applyUrl('Нет');
  });

  // ── Upload ────────────────────────────────────────────────────────────────
  fileInp.addEventListener('change', () => {
    if (fileInp.files[0] && !nameInp.value)
      nameInp.value = fileInp.files[0].name.replace(/\.[^.]+$/, '').slice(0, 40);
  });
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
      saveAudioLib(lib);
      _rebuildSel(); sel.value = d.webPath; _applyUrl(d.webPath);
      fileInp.value = ''; nameInp.value = ''; upRow.style.display = 'none';
    } catch (e) { alert('Ошибка загрузки: ' + e.message); }
    finally { upBtn.disabled = false; upBtn.textContent = '⬆'; }
  });

  // ── Volume + Save ─────────────────────────────────────────────────────────
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
    } catch { saveBtn.textContent = '⚠'; }
    finally { saveBtn.disabled = false; setTimeout(() => { saveBtn.textContent = '💾'; }, 2000); }
  });

  // ── Suno generator popup ──────────────────────────────────────────────────
  genBtn.addEventListener('click', () => {
    document.getElementById('_suno_gen_popup')?.remove();

    const overlay = document.createElement('div');
    overlay.id = '_suno_gen_popup';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.65);z-index:13000;display:flex;align-items:center;justify-content:center;';
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    const popup = document.createElement('div');
    popup.style.cssText = 'background:#c8c8c8;border:2px solid;border-color:#fff #808080 #808080 #fff;width:500px;max-width:97vw;max-height:92vh;display:flex;flex-direction:column;overflow-y:auto;box-sizing:border-box;';

    const titleBar = document.createElement('div');
    titleBar.style.cssText = 'background:#000080;color:#fff;padding:4px 8px;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;';
    titleBar.innerHTML = '<span style="font-size:11px;font-weight:bold;">🎵 Генератор музыки Suno</span>';
    const closeX = document.createElement('button');
    closeX.textContent = '✕'; closeX.style.cssText = 'background:none;border:none;color:#fff;cursor:pointer;font-size:13px;padding:0 2px;';
    closeX.addEventListener('click', () => overlay.remove());
    titleBar.appendChild(closeX);
    popup.appendChild(titleBar);

    const body = document.createElement('div');
    body.style.cssText = 'padding:10px;display:flex;flex-direction:column;gap:7px;';

    // Chip group builder
    const _selectedChips = new Set();
    function _chipGroup(label, items) {
      const sec = document.createElement('div');
      const lbl = document.createElement('div');
      lbl.style.cssText = 'font-size:9px;font-weight:bold;color:#444;margin-bottom:3px;letter-spacing:0.5px;';
      lbl.textContent = label;
      sec.appendChild(lbl);
      const chips = document.createElement('div');
      chips.style.cssText = 'display:flex;flex-wrap:wrap;gap:3px;';
      items.forEach(item => {
        const chip = document.createElement('button');
        chip.type = 'button'; chip.textContent = item;
        chip.style.cssText = 'font-size:9px;padding:2px 8px;border:1px solid #999;background:#e0e0e0;cursor:pointer;border-radius:2px;';
        chip.addEventListener('click', () => {
          const on = _selectedChips.has(item);
          if (on) { _selectedChips.delete(item); chip.style.background = '#e0e0e0'; chip.style.color = ''; }
          else    { _selectedChips.add(item);    chip.style.background = '#3a6bc0'; chip.style.color = '#fff'; }
          _syncStyle();
        });
        chips.appendChild(chip);
      });
      sec.appendChild(chips);
      return sec;
    }

    body.appendChild(_chipGroup('ЖАНР', ['Lo-fi', 'Chillhop', 'Bedroom Pop', 'Soft R&B', 'Indie Pop', 'Dark Pop', 'Cinematic', 'Trendy']));
    body.appendChild(_chipGroup('НАСТРОЕНИЕ', ['Cozy', 'Playful', 'Mysterious', 'Romantic', 'Dreamy', 'Energetic', 'Intimate', 'Moody']));
    body.appendChild(_chipGroup('ИНСТРУМЕНТЫ', ['Piano', 'Synth', 'Guitar', 'Soft Bass', 'Subtle Drums', 'Strings', '808', 'Vinyl Crackle']));

    // BPM slider
    const bpmRow = document.createElement('div');
    bpmRow.style.cssText = 'display:flex;align-items:center;gap:6px;';
    const bpmLbl = document.createElement('span'); bpmLbl.textContent = 'BPM:'; bpmLbl.style.cssText = 'font-size:9px;color:#444;min-width:28px;';
    const bpmSl  = document.createElement('input'); bpmSl.type = 'range'; bpmSl.min = '60'; bpmSl.max = '180'; bpmSl.step = '5'; bpmSl.value = '100'; bpmSl.style.flex = '1';
    const bpmVal = document.createElement('span'); bpmVal.textContent = '100'; bpmVal.style.cssText = 'font-size:9px;color:#333;min-width:30px;';
    bpmSl.addEventListener('input', () => { bpmVal.textContent = bpmSl.value; _syncStyle(); });
    bpmRow.appendChild(bpmLbl); bpmRow.appendChild(bpmSl); bpmRow.appendChild(bpmVal);
    body.appendChild(bpmRow);

    // Style textarea
    const styleLbl = document.createElement('div');
    styleLbl.style.cssText = 'font-size:9px;font-weight:bold;color:#444;';
    styleLbl.textContent = 'STYLE (авто из чипсов + редактируемый)';
    const styleArea = document.createElement('textarea');
    styleArea.rows = 3; styleArea.placeholder = 'Выберите жанр/настроение/инструменты выше или введите вручную…';
    styleArea.style.cssText = 'font-size:9px;padding:4px;resize:vertical;font-family:inherit;width:100%;box-sizing:border-box;';
    body.appendChild(styleLbl); body.appendChild(styleArea);

    function _syncStyle() {
      const parts = [..._selectedChips];
      const bpm = parseInt(bpmSl.value);
      if (bpm !== 100) parts.push(bpm + ' BPM');
      styleArea.value = parts.join(', ');
    }

    // Slider helper
    function _slRow(label, min, max, step, def) {
      const row = document.createElement('div'); row.style.cssText = 'display:flex;align-items:center;gap:6px;';
      const lbl = document.createElement('span'); lbl.style.cssText = 'font-size:9px;color:#444;min-width:140px;'; lbl.textContent = label;
      const sl  = document.createElement('input'); sl.type = 'range'; sl.min = min; sl.max = max; sl.step = step; sl.value = def; sl.style.flex = '1';
      const val = document.createElement('span'); val.style.cssText = 'font-size:9px;color:#333;min-width:28px;'; val.textContent = def;
      sl.addEventListener('input', () => { val.textContent = parseFloat(sl.value).toFixed(2); });
      row.appendChild(lbl); row.appendChild(sl); row.appendChild(val);
      return { row, get: () => parseFloat(sl.value) };
    }
    const swCtrl = _slRow('Style Weight (точность стиля)', 0, 1, 0.05, 0.7);
    const wcCtrl = _slRow('Weirdness (эксперимент)', 0, 1, 0.05, 0.3);
    body.appendChild(swCtrl.row);
    body.appendChild(wcCtrl.row);

    // Negative tags
    const negLbl = document.createElement('div'); negLbl.style.cssText = 'font-size:9px;font-weight:bold;color:#444;'; negLbl.textContent = 'NEGATIVE TAGS';
    const negInp = document.createElement('input'); negInp.type = 'text'; negInp.style.cssText = 'font-size:9px;padding:3px 4px;width:100%;box-sizing:border-box;';
    negInp.value = 'vocals, lyrics, metal, aggressive, heavy, noise';
    body.appendChild(negLbl); body.appendChild(negInp);

    // Model + Title row
    const mtRow = document.createElement('div'); mtRow.style.cssText = 'display:flex;gap:6px;';
    const modelSel = document.createElement('select'); modelSel.style.cssText = 'font-size:9px;padding:2px;flex-shrink:0;';
    ['V4_5PLUS', 'V4_5', 'V5', 'V5_5'].forEach(m => {
      const o = document.createElement('option'); o.value = m; o.textContent = m;
      if (m === 'V4_5PLUS') o.selected = true;
      modelSel.appendChild(o);
    });
    const titleInp = document.createElement('input'); titleInp.type = 'text'; titleInp.placeholder = 'Название трека…'; titleInp.maxLength = 80;
    titleInp.style.cssText = 'font-size:9px;flex:1;padding:3px 4px;';
    mtRow.appendChild(modelSel); mtRow.appendChild(titleInp);
    body.appendChild(mtRow);

    // Status line
    const genStatus = document.createElement('div');
    genStatus.style.cssText = 'font-size:9px;min-height:16px;text-align:center;color:#555;';
    body.appendChild(genStatus);

    // Generate button
    const doGenBtn = document.createElement('button');
    doGenBtn.type = 'button'; doGenBtn.textContent = '🎵 Генерировать';
    doGenBtn.style.cssText = 'font-size:10px;padding:5px;cursor:pointer;font-weight:bold;background:#d0ead0;border:1px solid #4a8a4a;margin-bottom:4px;';
    doGenBtn.addEventListener('click', async () => {
      const style = styleArea.value.trim();
      if (!style) { genStatus.textContent = '⚠ Укажите стиль'; genStatus.style.color = '#aa0000'; return; }
      doGenBtn.disabled = true; genStatus.style.color = '#555'; genStatus.textContent = 'Отправляем задачу…';
      try {
        const r = await fetch('/api/audio/suno/generate', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            style,
            title:               titleInp.value.trim() || 'UGC Background',
            negativeTags:        negInp.value.trim(),
            styleWeight:         swCtrl.get(),
            weirdnessConstraint: wcCtrl.get(),
            model:               modelSel.value,
          }),
        });
        const rd = await r.json();
        if (!rd.success) throw new Error(rd.error);

        genStatus.textContent = '⏳ Генерация (~2 мин)…';
        const trackTitle = titleInp.value.trim() || 'UGC Background';
        const MAX = 90, INTERVAL = 4000;
        for (let i = 0; i < MAX; i++) {
          await new Promise(res => setTimeout(res, INTERVAL));
          const sr = await fetch(`/api/audio/suno/status/${rd.taskId}`);
          const sd2 = await sr.json();
          if (sd2.state === 'success') {
            const trackId = 'suno_' + Date.now();
            await fetch('/api/audio/suno/library', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: trackId, title: trackTitle, audioPath: sd2.audioPath, style }),
            });
            _sunoLib.unshift({ id: trackId, title: trackTitle, audioPath: sd2.audioPath, style, createdAt: new Date().toISOString() });
            _rebuildSel();
            sel.value = sd2.audioPath;
            _applyUrl(sd2.audioPath);
            genStatus.textContent = '✅ Трек готов!'; genStatus.style.color = '#007000';
            doGenBtn.disabled = false;
            setTimeout(() => overlay.remove(), 1800);
            return;
          }
          if (sd2.state === 'failed') throw new Error(sd2.error || 'Suno failed');
          genStatus.textContent = `⏳ Генерация… ${((i + 1) * INTERVAL / 1000).toFixed(0)}s`;
        }
        throw new Error('Таймаут — попробуй позже');
      } catch (err) {
        genStatus.textContent = '❌ ' + err.message; genStatus.style.color = '#aa0000';
        doGenBtn.disabled = false;
      }
    });
    body.appendChild(doGenBtn);

    popup.appendChild(body);
    overlay.appendChild(popup);
    document.body.appendChild(overlay);
    document.addEventListener('keydown', function _esc(e) {
      if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', _esc); }
    });
  });

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
    if (s.starred !== true) return false;  // must be explicitly starred by user
    const audioCells = s.cells.filter(c => c.audioPath);
    // Session stays in Склейка if at least one cell has a finished video.
    // This allows single-cell re-generation without dropping the session from the timeline.
    return audioCells.length > 0 &&
      audioCells.some(c => c.videoPath && !c._videoPending && !c.avatarTaskId);
  });
}
