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
  if (_tlSelected?._nameEl) {
    _tlSelected._nameEl.style.fontWeight = '';
  }
  if (_tlSelected?._openedDetails) {
    _tlSelected._openedDetails.open = false;
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
      // Open birolys (track if we opened it), collapse hooks
      const detB = birolysSub?.querySelector('details');
      if (detB && !detB.open) { detB.open = true; _tlSelected._openedDetails = detB; }
      const detH = hooksSub?.querySelector('details');
      if (detH && detH.open) detH.open = false;

      const card = birolysSub?.querySelector(`[data-biroly-idx="${idx}"]`);
      if (card) {
        card.style.outline = '2px solid #4a6a9a';
        const nameEl = card.querySelector('span');
        if (nameEl) { nameEl.style.fontWeight = 'bold'; _tlSelected._nameEl = nameEl; }
        card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        _tlSelected._rightCard = card;
      }
    } else if (type === 'hook') {
      // Open hooks (track if we opened it), collapse birolys
      const detH = hooksSub?.querySelector('details');
      if (detH && !detH.open) { detH.open = true; _tlSelected._openedDetails = detH; }
      const detB = birolysSub?.querySelector('details');
      if (detB && detB.open) detB.open = false;

      const card = hooksSub?.querySelector(`[data-hook-idx="${idx}"]`);
      if (card) {
        card.style.outline = '2px solid #b05010';
        const nameEl = card.querySelector('span');
        if (nameEl) { nameEl.style.fontWeight = 'bold'; _tlSelected._nameEl = nameEl; }
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
    lb.innerHTML = '<video id="scen-video-lb-el" controls style="max-width:90vw;max-height:80vh;display:block;background:#000;"></video><button style="padding:6px 24px;font-size:13px;cursor:pointer;">Close</button>';
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
  v.title = '▶ Watch video';
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
    block.style.cssText = `position:absolute;left:${blockLeft.toFixed(3)}%;width:${Math.max(blockWidth, 0.3).toFixed(3)}%;height:100%;box-sizing:border-box;overflow:hidden;border-radius:2px;cursor:grab;opacity:0.6;`;
    block.title = `${b.name || 'Birol'}\nfrom: ${startVal.toFixed(2)}s  to: ${endVal.toFixed(2)}s  crop↑: ${cropVal.toFixed(2)}s  crop↓: ${cropEndVal.toFixed(2)}s\nDrag to move`;

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
    activePart.innerHTML = `<span style="font-size:7px;color:#fff;font-weight:bold;padding:0 2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;pointer-events:none;text-shadow:0 0 3px #000,0 0 3px #000;">${b.name || 'B'}</span>`;
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
        block.title = `${b.name || 'Birol'}\nfrom: ${newStart.toFixed(2)}s  to: ${newEnd.toFixed(2)}s  crop↑: ${cropVal.toFixed(2)}s  crop↓: ${cropEndVal.toFixed(2)}s\n[Del] — remove from timeline`;
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
        // Preserve any other params the user set on this segment (speed, trimIn,
        // trimOut, align, from, to, reverse, etc.) — only the position fields
        // change on a drag move.
        d[sessionKey].timings[key] = {
          ...(d[sessionKey].timings[key] || {}),
          crop:    cropVal.toFixed(2),
          cropEnd: cropEndVal.toFixed(2),
          start:   newStart.toFixed(2),
          end:     newEnd.toFixed(2),
        };
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
      thumbBox.title = 'Click to watch video';
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
      reranBtn.textContent = '↺ Rerun';
      reranBtn.style.cssText = 'width:86px;font-size:9px;padding:2px 0;cursor:pointer;';
      reranBtn.addEventListener('click', () => {
        const _obraz = (getObrazы?.() || []).find(o => String(o.id) === String(session.obrazId)) || null;
        _openSkleykaReranPopup(sessionKey, session, _obraz, idx);
      });
      statusArea.appendChild(reranBtn);
    } else if (cell._videoPending || cell.avatarTaskId) {
      const d = document.createElement('div');
      d.style.cssText = 'font-size:8px;color:#666;text-align:center;padding:2px 0;';
      d.textContent = '⏳ Generating…';
      statusArea.appendChild(d);
    } else if (cell.videoError) {
      const retryBtn = document.createElement('button');
      retryBtn.textContent = '↺';
      retryBtn.title = 'Retry generation';
      retryBtn.style.cssText = 'width:86px;font-size:9px;padding:2px 0;cursor:pointer;';
      retryBtn.addEventListener('click', async () => {
        if (!cell.audioPath || !imgPath) return;
        retryBtn.disabled = true;
        cell._videoPending = true; delete cell.videoError;
        renderAllTimelines();
        const _mt_sid = window.GenLog?.start('Montage', '🎭 Retry Avatar');
        const _mtgf = (name, url, body) => window.GenLog && _mt_sid
          ? window.GenLog.fetchLog(_mt_sid, name, url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
          : fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
        try {
          const videoParams = getEngineParams?.('kling/ai-avatar-standard') || {};
          const defaultPrompt = videoParams.prompt || 'Natural speaking motion with subtle head movement and relaxed posture';
          // Use cached upload URLs from previous attempt if available
          let _imgUrl = cell._cachedImgUrl || null;
          if (!_imgUrl) {
            const _upR = await _mtgf('📤 Загрузка изображения', '/api/upload-public', { imagePath: imgPath });
            _imgUrl = _upR?.success ? _upR.url : null;
            if (_imgUrl) cell._cachedImgUrl = _imgUrl;
          }
          let _detUrl = cell._cachedDetUrl || null;
          if (!_detUrl && _imgUrl && cell.detInfo?.path) {
            try { const _dr = await _mtgf('📤 Загрузка предмета', '/api/upload-public', { imagePath: cell.detInfo.path }); if (_dr?.success) { _detUrl = _dr.url; cell._cachedDetUrl = _detUrl; } } catch {}
          }
          let prompt = cell.avatarPrompt || defaultPrompt;
          if (!cell.avatarPrompt) {
            try {
              // Always send imagePath for talking-head so the server re-uploads
              // with forceFresh and never reuses an expired tmpfiles.org URL.
              const pd = await _mtgf('🧠 Промпт аватара', '/api/audio/avatar-prompt',
                { imagePath: imgPath, text: cell.line, detailImagePath: cell.detInfo?.path || null });
              if (pd.success && pd.prompt) { prompt = pd.prompt; cell.avatarPrompt = prompt; saveEditState(); }
            } catch {}
          }
          const d = await _mtgf('🎬 Генерация аватара', '/api/audio/avatar',
            { imagePath: imgPath, audioPath: cell.audioPath, prompt, videoParams });
          if (!d.success) throw new Error(d.error);
          cell.avatarTaskId = d.taskId; saveEditState(); window.maybeStartAvatarPoller?.();
          const videoPath = await pollAvatar(d.taskId);
          cell.videoPath = videoPath; cell.videoError = null;
          delete cell.avatarTaskId;
          delete cell._cachedImgUrl; delete cell._cachedDetUrl;
          window.GenLog?.finalize(_mt_sid, 'success');
        } catch (err) {
          window.GenLog?.finalize(_mt_sid, 'error');
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

// getAudioDuration moved to js/timeline-store.js, for the same reason.

// ── Timeline timings: { [sessionKey]: { [birolyIdx]: { start, end } } } ────────
// Source of truth for WHICH birolys to show is always getActiveBirolyIdxs() order.
// This store holds only the start/end values entered by the user,
// plus a per-session "excluded" set for birolys removed with ×.
// TIMELINE_DATA_KEY, getTimelineData and setTimelineData moved to js/timeline-store.js:
// the Merge v2 editor needs them and should not have to load this 72KB file to get them.
const BIROLY_DEFAULTS_KEY  = 'biroly_defaults_v1';
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

  // ── Row 1: dropdown + 🗑 delete + ⬆ upload toggle ──────────────────────
  const row1 = document.createElement('div');
  row1.style.cssText = 'display:flex;gap:3px;align-items:center;';

  const sel = document.createElement('select');
  sel.className = 'audio-ctrl-sel';
  sel.style.flex = '1';

  const genBtn = document.createElement('button');
  genBtn.textContent = '🎵 Generate Music (Suno)'; genBtn.title = 'Generate music track via Suno';
  genBtn.style.cssText = 'font-size:9px;padding:3px 8px;cursor:pointer;margin-top:5px;background:#d8e0f8;border:1px solid #3a6bc0;border-radius:2px;font-weight:bold;';

  const delBtn = document.createElement('button');
  delBtn.textContent = '🗑'; delBtn.title = 'Delete track from library';
  delBtn.style.cssText = 'width:24px;height:22px;padding:0;font-size:11px;cursor:pointer;flex-shrink:0;display:none;';

  const upToggleBtn = document.createElement('button');
  upToggleBtn.textContent = '⬆'; upToggleBtn.title = 'Upload your track';
  upToggleBtn.style.cssText = 'width:24px;height:22px;padding:0;font-size:11px;cursor:pointer;flex-shrink:0;';

  row1.appendChild(sel); row1.appendChild(delBtn); row1.appendChild(upToggleBtn);
  wrap.appendChild(row1);

  // ── Upload row (collapsed by default) ────────────────────────────────────
  const upRow = document.createElement('div');
  upRow.style.cssText = 'display:none;gap:3px;align-items:center;margin-top:3px;flex-wrap:wrap;';
  const fileInp = document.createElement('input'); fileInp.type = 'file'; fileInp.accept = 'audio/*';
  fileInp.style.cssText = 'font-size:9px;flex:1;min-width:0;';
  const nameInp = document.createElement('input'); nameInp.type = 'text'; nameInp.placeholder = 'Name…'; nameInp.maxLength = 60;
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
  barTrack.title = 'Drag the blue shadow to set the music start point';

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
  volLabel.textContent = 'Vol:'; volLabel.style.cssText = 'font-size:9px;color:#666;white-space:nowrap;';
  const volInp = document.createElement('input');
  volInp.type = 'range'; volInp.min = '0'; volInp.max = '1'; volInp.step = '0.05'; volInp.value = currentVolume;
  volInp.style.cssText = 'flex:1;';
  const volVal = document.createElement('span');
  volVal.textContent = currentVolume.toFixed(2); volVal.style.cssText = 'font-size:9px;color:#666;min-width:24px;';
  const saveBtn = document.createElement('button');
  saveBtn.textContent = '💾'; saveBtn.title = 'Save parameters';
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
    timingLabel.textContent = `${_fmtTime(currentOffset)} → ${_fmtTime(endSec)}  (video: ${vidDur.toFixed(1)}s)`;
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
    const noneOpt = document.createElement('option'); noneOpt.value = 'Нет'; noneOpt.textContent = 'None'; sel.appendChild(noneOpt);

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
      const og = document.createElement('optgroup'); og.label = '📁 Uploaded';
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
    } catch (e) { alert('Upload error: ' + e.message); }
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

  // ── Per-session background generation state ──────────────────────────────
  // Survives popup close: if the user dismisses the dialog mid-generation, the
  // polling loop continues; on success we still apply the track to the music
  // dropdown automatically. genBtn flashes as a progress indicator while the
  // popup is gone.
  let _genInFlight = false;

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
    titleBar.innerHTML = '<span style="font-size:11px;font-weight:bold;">🎵 Suno music generator</span>';
    const closeX = document.createElement('button');
    closeX.textContent = '✕'; closeX.style.cssText = 'background:none;border:none;color:#fff;cursor:pointer;font-size:13px;padding:0 2px;';
    closeX.addEventListener('click', () => overlay.remove());
    titleBar.appendChild(closeX);
    popup.appendChild(titleBar);

    const body = document.createElement('div');
    body.style.cssText = 'padding:10px;display:flex;flex-direction:column;gap:7px;';

    // ── Target duration banner (from session totalDur via getVideoDur callback) ─
    // Read at popup open; shows the user how long the music will need to cover
    // the timeline. We always concat both Suno variants into a 3-5 min track,
    // so this is informational — if the session is shorter, the music just
    // tails out beyond it (still useful for fades).
    const targetSec = (typeof getVideoDur === 'function') ? Math.max(0, Math.round(parseFloat(getVideoDur()) || 0)) : 0;
    const _fmtDur = s => {
      if (!s) return '0:00';
      const m = Math.floor(s / 60); const r = Math.floor(s % 60);
      return `${m}:${String(r).padStart(2, '0')}`;
    };
    const targetBanner = document.createElement('div');
    targetBanner.style.cssText = 'background:#e8eef8;border:1px solid #98a8c8;border-radius:2px;padding:4px 8px;font-size:9px;color:#234;line-height:1.4;';
    targetBanner.innerHTML = targetSec
      ? `🎯 Timeline length: <b>${_fmtDur(targetSec)}</b> — Suno will return 2 variants (~1:30-2:30 each); we concat them via crossfade into a single <b>3-5 min track</b> covering your timeline.`
      : `ℹ Timeline length unknown — will still generate a 3-5 min background track from 2 Suno variants.`;
    body.appendChild(targetBanner);

    // ── Random presets registry (chip lists + slider ranges) ─────────────────
    const GENRES      = ['Lo-fi', 'Chillhop', 'Bedroom Pop', 'Soft R&B', 'Indie Pop', 'Dark Pop', 'Cinematic', 'Trendy'];
    const MOODS       = ['Cozy', 'Playful', 'Mysterious', 'Romantic', 'Dreamy', 'Energetic', 'Intimate', 'Moody'];
    const INSTRUMENTS = ['Piano', 'Synth', 'Guitar', 'Soft Bass', 'Subtle Drums', 'Strings', '808', 'Vinyl Crackle'];
    const MODELS      = ['V4_5PLUS', 'V4_5', 'V5', 'V5_5'];
    function _pickRandom(arr, n) {
      const pool = arr.slice();
      const out = [];
      const take = Math.min(n, pool.length);
      for (let i = 0; i < take; i++) out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
      return out;
    }
    function _randFloat(min, max, prec = 2) {
      const v = min + Math.random() * (max - min);
      return Math.round(v * 10 ** prec) / 10 ** prec;
    }
    function _randInt(min, max, step = 1) {
      const steps = Math.floor((max - min) / step);
      return min + Math.floor(Math.random() * (steps + 1)) * step;
    }

    // ── Chip group builder ────────────────────────────────────────────────────
    const _selectedChips = new Set();
    const _chipEls = [];   // [{ item, chipBtn, group }] — so Re-roll can update visual state
    function _chipGroup(label, items, groupKey) {
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
          if (on) _setChipSelected(chip, item, false);
          else    _setChipSelected(chip, item, true);
          _syncStyle();
        });
        chips.appendChild(chip);
        _chipEls.push({ item, chipBtn: chip, group: groupKey });
      });
      sec.appendChild(chips);
      return sec;
    }
    function _setChipSelected(chipBtn, item, on) {
      if (on) {
        _selectedChips.add(item);
        chipBtn.style.background = '#3a6bc0'; chipBtn.style.color = '#fff';
      } else {
        _selectedChips.delete(item);
        chipBtn.style.background = '#e0e0e0'; chipBtn.style.color = '';
      }
    }

    body.appendChild(_chipGroup('GENRE',       GENRES,      'genre'));
    body.appendChild(_chipGroup('MOOD',        MOODS,       'mood'));
    body.appendChild(_chipGroup('INSTRUMENTS', INSTRUMENTS, 'instruments'));

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
    styleLbl.textContent = 'STYLE (auto from chips + editable)';
    const styleArea = document.createElement('textarea');
    styleArea.rows = 3; styleArea.placeholder = 'Choose genre/mood/instruments above or enter manually…';
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
      return { row, slider: sl, valueEl: val, get: () => parseFloat(sl.value) };
    }
    const swCtrl = _slRow('Style Weight (style accuracy)', 0, 1, 0.05, 0.7);
    const wcCtrl = _slRow('Weirdness (experiment)', 0, 1, 0.05, 0.3);
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
    MODELS.forEach(m => {
      const o = document.createElement('option'); o.value = m; o.textContent = m;
      if (m === 'V4_5PLUS') o.selected = true;
      modelSel.appendChild(o);
    });
    const titleInp = document.createElement('input'); titleInp.type = 'text'; titleInp.placeholder = 'Track name…'; titleInp.maxLength = 80;
    titleInp.style.cssText = 'font-size:9px;flex:1;padding:3px 4px;';
    mtRow.appendChild(modelSel); mtRow.appendChild(titleInp);
    body.appendChild(mtRow);

    // ── Apply random preset (used on open + Re-roll click) ───────────────────
    function _applyRandomPreset() {
      // Clear current selections + repaint chips to deselected
      _selectedChips.clear();
      _chipEls.forEach(({ item, chipBtn }) => _setChipSelected(chipBtn, item, false));
      // Pick random N from each group
      const pickGenre = _pickRandom(GENRES,      _randInt(1, 2));
      const pickMood  = _pickRandom(MOODS,       _randInt(1, 2));
      const pickInstr = _pickRandom(INSTRUMENTS, _randInt(2, 3));
      [...pickGenre, ...pickMood, ...pickInstr].forEach(item => {
        const ent = _chipEls.find(e => e.item === item);
        if (ent) _setChipSelected(ent.chipBtn, item, true);
      });
      // Sliders — "safe" ranges for chill background music
      bpmSl.value  = String(_randInt(80, 130, 5));
      bpmVal.textContent = bpmSl.value;
      swCtrl.slider.value   = String(_randFloat(0.60, 0.85, 2));
      swCtrl.valueEl.textContent = parseFloat(swCtrl.slider.value).toFixed(2);
      wcCtrl.slider.value   = String(_randFloat(0.20, 0.40, 2));
      wcCtrl.valueEl.textContent = parseFloat(wcCtrl.slider.value).toFixed(2);
      // Auto-fill title from picked chips (user can override)
      titleInp.value = [...pickGenre, ...pickMood].slice(0, 3).join(' ') + ' @ ' + bpmSl.value + 'BPM';
      _syncStyle();
    }

    // Roll the random preset right away so the popup opens already populated.
    _applyRandomPreset();

    // ── Progress bar (replaces the seconds counter) ──────────────────────────
    const progWrap = document.createElement('div');
    progWrap.style.cssText = 'display:none;flex-direction:column;gap:3px;';
    const progBar = document.createElement('div');
    progBar.style.cssText = 'width:100%;height:14px;background:#d0d0d0;border:1px solid #888;overflow:hidden;position:relative;';
    const progFill = document.createElement('div');
    progFill.style.cssText = 'height:100%;background:linear-gradient(90deg,#3a6bc0,#5d8fd9);width:0%;transition:width 0.4s ease;';
    progBar.appendChild(progFill);
    const progText = document.createElement('div');
    progText.style.cssText = 'font-size:9px;text-align:center;color:#555;';
    progText.textContent = '';
    progWrap.appendChild(progBar);
    progWrap.appendChild(progText);
    body.appendChild(progWrap);

    // Status line (errors / final ready msg)
    const genStatus = document.createElement('div');
    genStatus.style.cssText = 'font-size:9px;min-height:14px;text-align:center;color:#555;';
    body.appendChild(genStatus);

    // ── Action row: Re-roll + Generate ───────────────────────────────────────
    const actionRow = document.createElement('div');
    actionRow.style.cssText = 'display:flex;gap:6px;margin-top:2px;';
    const rerollBtn = document.createElement('button');
    rerollBtn.type = 'button'; rerollBtn.textContent = '🎲 Re-roll';
    rerollBtn.title = 'Randomize chips, BPM, and sliders again';
    rerollBtn.style.cssText = 'font-size:10px;padding:5px 10px;cursor:pointer;background:#e8e0d0;border:1px solid #aa8c5a;font-weight:bold;flex-shrink:0;';
    rerollBtn.addEventListener('click', () => _applyRandomPreset());
    const doGenBtn = document.createElement('button');
    doGenBtn.type = 'button'; doGenBtn.textContent = '🎵 Generate';
    doGenBtn.style.cssText = 'font-size:10px;padding:5px;cursor:pointer;font-weight:bold;background:#d0ead0;border:1px solid #4a8a4a;flex:1;';
    actionRow.appendChild(rerollBtn);
    actionRow.appendChild(doGenBtn);
    body.appendChild(actionRow);

    // ── Generation flow ──────────────────────────────────────────────────────
    // Polling loop is hoisted to a free function so it can keep running after
    // the popup is closed. While running, the genBtn in the music-control row
    // shows live progress (% / status) — when finished, the new track is
    // auto-inserted into the dropdown regardless of whether the popup is gone.
    async function _runGen(payload, trackTitle, style) {
      _genInFlight = true;
      const origGenBtnText = '🎵 Generate Music (Suno)';
      genBtn.disabled = true;

      const updateUI = (pct, msg, isError) => {
        // Popup is still on screen — update its progress bar + text
        if (document.body.contains(progWrap)) {
          progWrap.style.display = 'flex';
          progFill.style.width = Math.min(100, Math.max(0, pct)) + '%';
          progText.textContent = msg;
        }
        // Persistent genBtn — visible even when popup closed
        if (isError) {
          genBtn.textContent = '❌ ' + msg;
        } else if (pct >= 100) {
          genBtn.textContent = '✅ Track ready';
        } else {
          genBtn.textContent = `⏳ ${Math.round(pct)}% — ${msg.slice(0, 30)}`;
        }
      };

      try {
        updateUI(5, 'Sending task to Suno…', false);
        const r = await fetch('/api/audio/suno/generate', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const rd = await r.json();
        if (!rd.success) throw new Error(rd.error);

        // Polling: Suno usually takes ~90-150s; budget 6 min total. Linear
        // progress from 10% to 95% based on elapsed time, then jump to 100%
        // on actual success.
        const MAX_SEC = 360, INTERVAL = 4000;
        const t0 = Date.now();
        for (let i = 0; i * INTERVAL / 1000 < MAX_SEC; i++) {
          await new Promise(res => setTimeout(res, INTERVAL));
          const elapsed = (Date.now() - t0) / 1000;
          const expected = 130; // typical Suno completion
          const linearPct = Math.min(95, 10 + (elapsed / expected) * 85);

          let sd2;
          try {
            const sr = await fetch(`/api/audio/suno/status/${rd.taskId}`);
            sd2 = await sr.json();
          } catch (_) {
            updateUI(linearPct, 'Network blip — retrying…', false);
            continue;
          }
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
            updateUI(100, sd2.concatenated ? '3-5 min track ready (2 variants concat’d)' : 'Track ready', false);
            // If popup is still up, auto-close shortly
            const _stillOpen = document.body.contains(progWrap);
            if (_stillOpen) {
              genStatus.textContent = '✅ ' + (sd2.concatenated ? 'Concatenated 2 variants — ~3-5 min' : 'Track ready');
              genStatus.style.color = '#007000';
              setTimeout(() => overlay.remove(), 1800);
            }
            // Restore genBtn after a beat
            setTimeout(() => { genBtn.textContent = origGenBtnText; genBtn.disabled = false; _genInFlight = false; }, 2500);
            return;
          }
          if (sd2.state === 'failed') throw new Error(sd2.error || 'Suno failed');
          // Pending — show stage hint if backend supplied one (FIRST_SUCCESS, etc)
          const stageMsg = sd2.stage
            ? `Generating… (${sd2.stage})`
            : `Generating… ${elapsed.toFixed(0)}s`;
          updateUI(linearPct, stageMsg, false);
        }
        throw new Error('Timeout — try again later');
      } catch (err) {
        updateUI(0, err.message, true);
        if (document.body.contains(genStatus)) {
          genStatus.textContent = '❌ ' + err.message; genStatus.style.color = '#aa0000';
        }
        setTimeout(() => { genBtn.textContent = origGenBtnText; genBtn.disabled = false; _genInFlight = false; }, 4000);
      }
    }

    doGenBtn.addEventListener('click', () => {
      if (_genInFlight) return;
      const style = styleArea.value.trim();
      if (!style) { genStatus.textContent = '⚠ Enter a style'; genStatus.style.color = '#aa0000'; return; }
      doGenBtn.disabled = true;
      genStatus.textContent = ''; genStatus.style.color = '#555';
      const trackTitle = titleInp.value.trim() || 'UGC Background';
      const payload = {
        style,
        title:               trackTitle,
        negativeTags:        negInp.value.trim(),
        styleWeight:         swCtrl.get(),
        weirdnessConstraint: wcCtrl.get(),
        model:               modelSel.value,
        targetDuration:      targetSec || undefined,
      };
      // Fire-and-forget — the polling loop survives popup close.
      _runGen(payload, trackTitle, style);
    });

    popup.appendChild(body);
    overlay.appendChild(popup);
    document.body.appendChild(overlay);
    document.addEventListener('keydown', function _esc(e) {
      if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', _esc); }
    });
  });

  wrap.appendChild(genBtn);

  return {
    el: wrap,
    getUrl:    () => currentUrl,
    getOffset: () => currentOffset,
    getVolume: () => currentVolume,
    setSaveCallback: cb => { _saveCallback = cb; },
  };
}

// ── makeSfxControl(sessionKey, tlData, sfxKey) ───────────────────────────────
// Returns { el, getUrl } — select row only (upload lives in Music & SFX › SFX)
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

  const tooltip = 'Swoosh files can be added in Music & SFX dropdown';

  const row = document.createElement('div');
  row.style.cssText = 'display:flex;align-items:center;gap:4px;font-size:9px;';

  const lbl = document.createElement('span');
  lbl.style.cssText = 'color:#444;min-width:66px;';
  lbl.textContent = sfxKey === 'segSfx' ? 'Swoosh (vid.)' : sfxKey === 'biroSfx' ? 'Swoosh (bir.)' : 'Swoosh';
  lbl.title = tooltip;

  const sel = document.createElement('select');
  sel.style.cssText = 'flex:1;font-size:9px;padding:1px 2px;';
  sel.title = tooltip;

  const playBtn = document.createElement('button');
  playBtn.textContent = '▶'; playBtn.title = 'Preview';
  playBtn.style.cssText = 'width:20px;height:18px;padding:0;font-size:9px;cursor:pointer;flex-shrink:0;';

  const delBtn = document.createElement('button');
  delBtn.textContent = '🗑'; delBtn.title = 'Remove from library';
  delBtn.style.cssText = 'width:20px;height:18px;padding:0;font-size:9px;cursor:pointer;flex-shrink:0;';

  const player = document.createElement('audio');
  player.preload = 'none'; player.style.display = 'none';

  function _rebuildSel() {
    const lib = getAudioLib().filter(x => x.type === 'sfx');
    sel.innerHTML = '';
    [['Нет','None'],['Рандом','Random']].forEach(([v,t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; sel.appendChild(o); });
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
    document.dispatchEvent(new CustomEvent('sfx-library-updated'));
  });

  document.addEventListener('sfx-library-updated', _rebuildSel);

  row.appendChild(lbl); row.appendChild(sel); row.appendChild(playBtn); row.appendChild(delBtn);
  row.appendChild(player);

  return { el: row, getUrl: () => currentUrl };
}

// ── makeSfxSection() ─────────────────────────────────────────────────────────
// Returns { el } — shared SFX upload + generator (lives in Music & SFX › SFX)
function makeSfxSection() {
  const wrap = document.createElement('div');
  wrap.className = 'audio-ctrl-wrap';

  // ── Preview row: select + 🗑 delete ──────────────────────────────────────
  const prevRow = document.createElement('div');
  prevRow.style.cssText = 'display:flex;gap:3px;align-items:center;';
  const prevSel = document.createElement('select');
  prevSel.className = 'audio-ctrl-sel';
  prevSel.style.flex = '1';
  const prevDel = document.createElement('button');
  prevDel.textContent = '🗑'; prevDel.title = 'Delete from library';
  prevDel.style.cssText = 'width:24px;height:22px;padding:0;font-size:11px;cursor:pointer;flex-shrink:0;display:none;';
  prevRow.appendChild(prevSel); prevRow.appendChild(prevDel);
  wrap.appendChild(prevRow);

  // ── Audio player ─────────────────────────────────────────────────────────
  const player = document.createElement('audio');
  player.controls = true; player.preload = 'metadata';
  player.style.cssText = 'width:100%;height:28px;margin-top:4px;display:none;';
  wrap.appendChild(player);

  function _rebuildPrevSel() {
    const lib = getAudioLib().filter(x => x.type === 'sfx');
    const cur = prevSel.value;
    prevSel.innerHTML = '';
    const o0 = document.createElement('option');
    o0.value = ''; o0.textContent = lib.length ? '— preview SFX file —' : '— library is empty —';
    prevSel.appendChild(o0);
    lib.forEach(item => {
      const o = document.createElement('option'); o.value = item.webPath; o.textContent = item.name; prevSel.appendChild(o);
    });
    if (cur && lib.some(x => x.webPath === cur)) prevSel.value = cur;
  }
  _rebuildPrevSel();

  prevSel.addEventListener('change', () => {
    const url = prevSel.value;
    if (url) {
      player.src = url;
      player.style.display = 'block';
      prevDel.style.display = '';
    } else {
      player.pause(); player.removeAttribute('src');
      player.style.display = 'none';
      prevDel.style.display = 'none';
    }
  });

  prevDel.addEventListener('click', () => {
    if (!prevSel.value) return;
    if (!confirm('Remove this SFX file from library?')) return;
    saveAudioLib(getAudioLib().filter(x => !(x.type === 'sfx' && x.webPath === prevSel.value)));
    player.pause(); player.removeAttribute('src');
    player.style.display = 'none';
    prevDel.style.display = 'none';
    prevSel.value = '';
    document.dispatchEvent(new CustomEvent('sfx-library-updated'));
  });

  document.addEventListener('sfx-library-updated', _rebuildPrevSel);

  // ── Upload row ───────────────────────────────────────────────────────────
  const upRow = document.createElement('div');
  upRow.className = 'audio-upload-row';
  const fileInp = document.createElement('input');
  fileInp.type = 'file'; fileInp.accept = 'audio/*';
  const nameInp = document.createElement('input');
  nameInp.type = 'text'; nameInp.placeholder = 'Name…'; nameInp.maxLength = 60;
  const upBtn = document.createElement('button');
  upBtn.className = 'audio-upload-btn'; upBtn.textContent = '⬆ Upload SFX';

  fileInp.addEventListener('change', () => {
    if (fileInp.files[0] && !nameInp.value)
      nameInp.value = fileInp.files[0].name.replace(/\.[^.]+$/, '').slice(0, 40);
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
      document.dispatchEvent(new CustomEvent('sfx-library-updated'));
      fileInp.value = ''; nameInp.value = '';
    } catch (e) { alert('Upload error: ' + e.message); }
    finally { upBtn.disabled = false; upBtn.textContent = '⬆ Upload SFX'; }
  });

  upRow.appendChild(fileInp); upRow.appendChild(nameInp); upRow.appendChild(upBtn);
  wrap.appendChild(upRow);

  // Generate button
  const genBtn = document.createElement('button');
  genBtn.style.cssText = 'font-size:9px;padding:3px 8px;cursor:pointer;margin-top:5px;background:#ede0f8;border:1px solid #9060b8;border-radius:2px;font-weight:bold;';
  genBtn.textContent = '🔊 Generate SFX (ElevenLabs)';
  genBtn.addEventListener('click', _openSfxGeneratorPopup);
  wrap.appendChild(genBtn);

  return { el: wrap };
}

// ── _openSfxGeneratorPopup() ─────────────────────────────────────────────────
function _openSfxGeneratorPopup() {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.65);z-index:13000;display:flex;align-items:center;justify-content:center;';
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  const popup = document.createElement('div');
  popup.style.cssText = 'background:#c8c8c8;border:2px solid;border-color:#fff #808080 #808080 #fff;width:420px;max-width:97vw;max-height:92vh;display:flex;flex-direction:column;overflow-y:auto;box-sizing:border-box;';

  const titleBar = document.createElement('div');
  titleBar.style.cssText = 'background:#000080;color:#fff;padding:4px 8px;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;';
  titleBar.innerHTML = '<span style="font-size:11px;font-weight:bold;">🔊 ElevenLabs SFX Generator</span>';
  const closeX = document.createElement('button');
  closeX.textContent = '✕'; closeX.style.cssText = 'background:none;border:none;color:#fff;cursor:pointer;font-size:13px;padding:0 2px;';
  closeX.addEventListener('click', () => overlay.remove());
  titleBar.appendChild(closeX);
  popup.appendChild(titleBar);

  const body = document.createElement('div');
  body.style.cssText = 'padding:10px;display:flex;flex-direction:column;gap:7px;';

  const promptLbl = document.createElement('div');
  promptLbl.style.cssText = 'font-size:9px;font-weight:bold;color:#444;';
  promptLbl.textContent = 'DESCRIBE THE SOUND';
  const promptArea = document.createElement('textarea');
  promptArea.rows = 3; promptArea.placeholder = 'e.g. Cinematic braam, swoosh transition, glass break, rain…';
  promptArea.style.cssText = 'font-size:9px;padding:4px;resize:vertical;font-family:inherit;width:100%;box-sizing:border-box;';
  body.appendChild(promptLbl); body.appendChild(promptArea);

  function _slRow(label, min, max, step, def, suffix) {
    const row = document.createElement('div'); row.style.cssText = 'display:flex;align-items:center;gap:6px;';
    const lbl = document.createElement('span'); lbl.style.cssText = 'font-size:9px;color:#444;min-width:120px;'; lbl.textContent = label;
    const sl  = document.createElement('input'); sl.type = 'range'; sl.min = min; sl.max = max; sl.step = step; sl.value = def; sl.style.flex = '1';
    const val = document.createElement('span'); val.style.cssText = 'font-size:9px;color:#333;min-width:36px;'; val.textContent = def + (suffix || '');
    sl.addEventListener('input', () => { val.textContent = parseFloat(sl.value).toFixed(1) + (suffix || ''); });
    row.appendChild(lbl); row.appendChild(sl); row.appendChild(val);
    return { row, get: () => parseFloat(sl.value) };
  }

  const durCtrl = _slRow('Duration sec (0 = auto)', 0, 22, 0.5, 0, 's');
  const infCtrl = _slRow('Prompt influence', 0, 1, 0.05, 0.3, '');
  body.appendChild(durCtrl.row);
  body.appendChild(infCtrl.row);

  const loopRow = document.createElement('div');
  loopRow.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:9px;color:#444;';
  const loopChk = document.createElement('input'); loopChk.type = 'checkbox'; loopChk.id = 'sfx-gen-loop';
  const loopLbl = document.createElement('label'); loopLbl.htmlFor = 'sfx-gen-loop'; loopLbl.textContent = 'Loop (seamless looping)';
  loopRow.appendChild(loopChk); loopRow.appendChild(loopLbl);
  body.appendChild(loopRow);

  const nameLbl = document.createElement('div'); nameLbl.style.cssText = 'font-size:9px;font-weight:bold;color:#444;'; nameLbl.textContent = 'SAVE AS';
  const nameInp = document.createElement('input'); nameInp.type = 'text'; nameInp.placeholder = 'Name…'; nameInp.maxLength = 60;
  nameInp.style.cssText = 'font-size:9px;padding:3px 4px;width:100%;box-sizing:border-box;';
  body.appendChild(nameLbl); body.appendChild(nameInp);

  const genStatus = document.createElement('div');
  genStatus.style.cssText = 'font-size:9px;min-height:16px;text-align:center;color:#555;';
  body.appendChild(genStatus);

  const doGenBtn = document.createElement('button');
  doGenBtn.type = 'button'; doGenBtn.textContent = '🔊 Generate';
  doGenBtn.style.cssText = 'font-size:10px;padding:5px;cursor:pointer;font-weight:bold;background:#ede0f8;border:1px solid #9060b8;margin-bottom:4px;';
  doGenBtn.addEventListener('click', async () => {
    const text = promptArea.value.trim();
    if (!text) { genStatus.textContent = '⚠ Enter a sound description'; genStatus.style.color = '#aa0000'; return; }
    doGenBtn.disabled = true; genStatus.style.color = '#555'; genStatus.textContent = 'Generating…';
    try {
      const payload = { text };
      const dur = durCtrl.get();
      if (dur > 0) payload.duration_seconds = dur;
      payload.prompt_influence = infCtrl.get();
      if (loopChk.checked) payload.loop = true;

      const r = await fetch('/api/audio/sfx/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const rd = await r.json();
      if (!rd.success) throw new Error(rd.error);

      const name = nameInp.value.trim() || rd.name || text.slice(0, 40);
      const lib = getAudioLib();
      lib.push({ id: Date.now().toString(), name, webPath: rd.webPath, type: 'sfx', addedAt: new Date().toISOString() });
      saveAudioLib(lib);
      document.dispatchEvent(new CustomEvent('sfx-library-updated'));
      genStatus.textContent = '✅ SFX ready!'; genStatus.style.color = '#007000';
      doGenBtn.disabled = false;
      setTimeout(() => overlay.remove(), 1600);
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
