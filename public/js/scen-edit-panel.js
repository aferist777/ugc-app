/* scen-edit-panel.js — buildFrozenRow, renderEditPanel (with runGen + runSingleAvatar inside), doAnalyze, pollTask/pollTts/pollAvatar */

// ── Per-session voice preview cache (voice name → audio URL) ─────────────────
const _voicePreviewCache = new Map();

// ── Video thumbnail: first-frame canvas + ▶ overlay, click → popup ───────────
function _buildVideoThumb(src) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:relative;width:66px;cursor:pointer;flex-shrink:0;';
  wrap.title = 'Нажмите для просмотра';

  const canvas = document.createElement('canvas');
  canvas.width  = 66;
  canvas.height = 88;
  canvas.style.cssText = 'display:block;width:66px;height:88px;object-fit:cover;background:#111;';
  wrap.appendChild(canvas);

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;';
  overlay.innerHTML = '<div style="background:rgba(0,0,0,0.55);border-radius:50%;width:24px;height:24px;display:flex;align-items:center;justify-content:center;"><span style="color:#fff;font-size:12px;margin-left:2px;">▶</span></div>';
  wrap.appendChild(overlay);

  // Extract first frame via hidden video
  const probe = document.createElement('video');
  probe.src      = src;
  probe.muted    = true;
  probe.preload  = 'metadata';
  probe.currentTime = 0;
  probe.addEventListener('seeked', () => {
    try {
      const ctx = canvas.getContext('2d');
      ctx.drawImage(probe, 0, 0, canvas.width, canvas.height);
    } catch {}
    probe.src = '';
  }, { once: true });
  probe.addEventListener('loadedmetadata', () => { probe.currentTime = 0.01; }, { once: true });

  wrap.addEventListener('click', () => openVideoPopup(src));
  return wrap;
}

// ── Video lightbox popup ──────────────────────────────────────────────────────
function openVideoPopup(src) {

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:99999;display:flex;align-items:center;justify-content:center;';
  const _close = () => { overlay.remove(); };
  overlay.addEventListener('click', e => { if (e.target === overlay) _close(); });

  const vid = document.createElement('video');
  vid.src = src;
  vid.controls = true;
  vid.autoplay = true;
  vid.style.cssText = 'max-width:90vw;max-height:88vh;border:2px solid #555;background:#000;';

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.style.cssText = 'position:absolute;top:14px;right:18px;background:none;border:none;color:#fff;font-size:22px;cursor:pointer;line-height:1;';
  closeBtn.addEventListener('click', () => _close());

  document.addEventListener('keydown', function _esc(e) {
    if (e.key === 'Escape') { _close(); document.removeEventListener('keydown', _esc); }
  });

  overlay.appendChild(vid);
  overlay.appendChild(closeBtn);
  document.body.appendChild(overlay);
}

// ── Helper: build a frozen results row from a saved session ──────────────────
function buildFrozenRow(session, onReran, obraz, onRetryVideo, excludedSet = new Set()) {
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:6px;overflow-x:auto;padding-bottom:4px;';

  // All character image variants for this obraz (used for lightbox slider)
  const charImages = obraz
    ? [obraz.char, ...(obraz.variations || []).filter(v => v && v !== 'error')].filter(Boolean)
    : null;

  session.cells.forEach((cell, i) => {
    const c = document.createElement('div');
    const isExcl = excludedSet.has(i);
    c.style.cssText = 'flex-shrink:0;width:66px;display:flex;flex-direction:column;align-items:center;gap:2px;' +
      (isExcl ? 'opacity:0.35;filter:grayscale(1);pointer-events:none;' : '');

    const num = document.createElement('div');
    num.style.cssText = 'font-size:9px;color:#808080;line-height:1.4;';
    num.textContent = i + 1;

    const imgBox = document.createElement('div');
    imgBox.style.cssText = 'width:62px;height:82px;border:1px solid #808080;overflow:hidden;flex-shrink:0;';

    if (!cell.detInfo) {
      // No-item cell: image IS the character photo → slider shows obraz variations
      imgBox.style.cssText += 'background:#ccc;cursor:zoom-in;';
      const img = document.createElement('img');
      img.dataset.src = cell.imagePath || '';
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
      if (cell.imagePath) {
        img.addEventListener('click', () => openImagePicker(
          charImages?.length ? charImages : (cell.generatedImages?.length ? cell.generatedImages : [cell.imagePath]),
          img, cell.imagePath, selected => {
            cell.imagePath = selected;
            cell.charImagePath = selected;
            img.src = selected + '?t=' + Date.now();
            saveEditState();
          }));
        lazyLoad(img);
      }
      imgBox.appendChild(img);
    } else if (cell.imagePath) {
      // Interaction cell: slider shows generated reruns (falls back to obraz vars if empty)
      imgBox.style.cssText += 'background:#ccc;cursor:zoom-in;';
      const img = document.createElement('img');
      img.dataset.src = cell.imagePath + '?t=' + Date.now();
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
      img.addEventListener('click', () => openEditCellLightbox(cell, selected => {
        cell.imagePath = selected;
        img.src = selected + '?t=' + Date.now();
        saveEditState();
      }));
      lazyLoad(img);
      imgBox.appendChild(img);
    } else if (cell.taskId || session.generating) {
      imgBox.style.cssText += 'background:#ddd;display:flex;align-items:center;justify-content:center;';
      imgBox.innerHTML = '<span style="font-size:9px;color:#888;">⏳</span>';
    } else {
      imgBox.style.cssText += 'background:#ebebeb;display:flex;align-items:center;justify-content:center;';
      imgBox.innerHTML = '<span style="font-size:8px;color:#aa0000;">Ошибка</span>';
    }

    const isErrCell  = !!(cell.detInfo && !cell.imagePath && !cell.taskId && !session.generating);
    const reranBtn = document.createElement('button');
    reranBtn.textContent = '↺ Повторить';
    reranBtn.title       = 'Повторить генерацию';
    reranBtn.style.cssText = `width:66px;font-size:9px;padding:1px 0;margin-top:1px;cursor:pointer;${!isErrCell ? 'display:none;' : ''}`;
    reranBtn.addEventListener('click', () => onReran(i, imgBox, reranBtn));

    // Video container — pre-populate if videoPath, avatarTaskId, or videoError already stored
    const videoContainer = document.createElement('div');
    videoContainer.style.cssText = 'width:66px;' + (cell.videoPath || cell.avatarTaskId || cell.videoError ? '' : 'display:none;');
    if (cell.videoPath) {
      videoContainer.appendChild(_buildVideoThumb(cell.videoPath));
    } else if (cell.avatarTaskId) {
      videoContainer.innerHTML = '<span style="font-size:8px;color:#888;">⏳ видео…</span>';
    } else if (cell.videoError) {
      const errSpan = document.createElement('span');
      errSpan.textContent = '❌ Видео'; errSpan.style.cssText = 'font-size:8px;color:#aa0000;display:block;';
      videoContainer.appendChild(errSpan);
      const errRetryBtn = document.createElement('button');
      errRetryBtn.textContent = '↺';
      errRetryBtn.title = 'Повторить генерацию видео';
      errRetryBtn.style.cssText = 'font-size:8px;padding:1px 3px;cursor:pointer;width:100%;margin-top:2px;';
      errRetryBtn.addEventListener('click', () => { if (onRetryVideo) onRetryVideo(i, videoContainer, cell); });
      videoContainer.appendChild(errRetryBtn);
    }

    // Hide source photo when video is ready
    if (cell.videoPath) imgBox.style.display = 'none';

    // Per-cell avatar button — force (re)send individual talking head generation
    const avatarBtn = document.createElement('button');
    avatarBtn.title = cell.videoPath ? 'Пересоздать видео говорящей головы' : 'Создать видео говорящей головы';
    avatarBtn.textContent = cell.videoPath ? '↺🗣' : '🗣';
    avatarBtn.style.cssText = `width:66px;font-size:9px;padding:1px 0;margin-top:1px;cursor:pointer;${!cell.audioPath ? 'display:none;' : ''}`;
    avatarBtn.addEventListener('click', () => {
      if (onRetryVideo) onRetryVideo(i, videoContainer, cell);
    });

    // Order: num → video → photo (hidden when video ready) → reran → avatar btn
    c.appendChild(num); c.appendChild(videoContainer); c.appendChild(imgBox); c.appendChild(reranBtn);
    c.appendChild(avatarBtn);
    row.appendChild(c);
    cell._imgBox         = imgBox;
    cell._reranBtn       = reranBtn;
    cell._videoContainer = videoContainer;
    cell._avatarBtn      = avatarBtn;
    cell._colEl          = c;
  });
  return row;
}

// ── Эдит panel renderer ───────────────────────────────────────────────────────
async function renderEditPanel() {
  const panel = document.getElementById('scen-panel-edit');
  if (!panel) return;

  // If panel is not currently visible (user switched tabs), defer the re-render.
  // scen-panel-edit keeps its 'active' class even when the parent l1-skleyka is
  // hidden — so we must check BOTH the sub-panel AND its L1 parent.
  // In-flight async jobs (analysis, generation) keep running; DOM elements remain
  // connected (just hidden) so their callbacks can still update the UI correctly.
  const l1Skleyka = document.getElementById('l1-skleyka');
  const editVisible = panel.classList.contains('active') && l1Skleyka?.classList.contains('active');
  if (!editVisible) {
    window._editPanelNeedsRender = true;
    return;
  }
  window._editPanelNeedsRender = false;

  panel.innerHTML = '';

  // Iterate all sessions (newest first), excluding ones hidden from Эдит
  const allSessions = Object.entries(editFrozenSessions)
    .filter(([, s]) => !s.hiddenFromEdit)
    .sort(([, a], [, b]) => new Date(b.date || 0) - new Date(a.date || 0));

  // Persist exactly what is shown so next reload restores the same view
  _saveEditLastVisible(allSessions.map(([key]) => key));

  // Build sequential number per scenFile using ALL sessions (incl. hidden/deleted),
  // sorted oldest-first. This way deleting a project never renumbers the others.
  const _scenFileNums = {}; // scenFile → [{key, date}, ...] oldest first
  Object.entries(editFrozenSessions).forEach(([key, sess]) => {
    const sf = sess.scenFile || key.split('__').slice(1, -1).join('__');
    if (!_scenFileNums[sf]) _scenFileNums[sf] = [];
    _scenFileNums[sf].push({ key, date: sess.date || '0' });
  });
  Object.values(_scenFileNums).forEach(arr => arr.sort((a, b) => new Date(a.date) - new Date(b.date)));
  function _getSessionNum(key, sess) {
    // Prefer the number stored at creation time; fall back to position in full list
    if (sess.num) return sess.num;
    const sf = sess.scenFile || key.split('__').slice(1, -1).join('__');
    const arr = _scenFileNums[sf] || [];
    const idx = arr.findIndex(e => e.key === key);
    return idx + 1; // 1-based; 0 means not found → fallback to 1
  }

  if (!allSessions.length) {
    const msg = document.createElement('div');
    msg.style.cssText = 'color:#888;font-size:11px;padding:8px 0;';
    msg.textContent = 'Выберите образ и нажмите «Создание»';
    panel.appendChild(msg);
    return;
  }

  for (const [sessionKey, sessionData] of allSessions) {
    const obrazId  = sessionData.obrazId  || sessionKey.split('__')[0];
    const scenFile = sessionData.scenFile || sessionKey.split('__').slice(1).join('__');
    const activeObraz = (getObrazы?.() || []).find(o => String(o.id) === obrazId);
    const f = scenarioFiles.find(sf => sf.file === scenFile);
    if (!activeObraz || !f) continue;

    const lines = await getLinesForScenario(f.file);
    if (!lines.length) continue;

    // pending = session created by "Создание" but ▶ not yet clicked
    const frozen = (sessionData.pending) ? null : sessionData;

    // ── Collapsible project dropdown wrapper ──────────────────────────────────
    const projectWrap = document.createElement('div');
    projectWrap.style.cssText = 'margin-bottom:8px;border:1px solid #808080;background:#c0c0c0;';

    const _projDateObj = sessionData.date ? new Date(sessionData.date) : new Date();
    const _projDateStr = _projDateObj.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const _projTimeStr = _projDateObj.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    const projectTitle = `${_projDateStr} — ${_projTimeStr} — ${f.name} — ${activeObraz.name}`;

    const projectToggle = document.createElement('div');
    projectToggle.style.cssText =
      'display:flex;align-items:center;gap:6px;padding:4px 6px;cursor:pointer;user-select:none;' +
      'background:#d4d0c8;border-bottom:1px solid #808080;font-size:11px;font-weight:bold;';
    const projectArrow = document.createElement('span');
    projectArrow.style.cssText = 'font-size:9px;color:#444;flex-shrink:0;';

    // ── Header thumbnail (first cell image, hidden when expanded) ────────────
    // Prefer charImagePath (character without item overlay) over imagePath
    let firstCellImg = frozen?.cells?.[0]?.charImagePath
      || frozen?.cells?.[0]?.imagePath
      || sessionData.obrazChar
      || null;

    // Fallback: pull from current obraz data and persist so next render is instant
    if (!firstCellImg && activeObraz?.char) {
      firstCellImg = activeObraz.char;
      if (editFrozenSessions[sessionKey]) {
        editFrozenSessions[sessionKey].obrazChar = activeObraz.char;
        saveEditState();
      }
    }

    const hdrThumb = document.createElement('img');
    hdrThumb.style.cssText =
      'width:22px;height:32px;object-fit:cover;flex-shrink:0;border:1px solid #808080;' +
      'background:#aaa;display:block;';
    if (firstCellImg) {
      const thumbSrc = _toThumb(firstCellImg);
      hdrThumb.src = thumbSrc || firstCellImg;
      if (thumbSrc && thumbSrc !== firstCellImg) {
        hdrThumb.onerror = () => { hdrThumb.src = firstCellImg; hdrThumb.onerror = null; };
      } else {
        hdrThumb.onerror = () => { hdrThumb.style.display = 'none'; hdrThumb.onerror = null; };
      }
    } else {
      hdrThumb.style.display = 'none';
    }

    const projectTitleEl = document.createElement('span');
    projectTitleEl.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    projectTitleEl.textContent = projectTitle;
    projectTitleEl.title = projectTitle;
    projectToggle.appendChild(projectArrow);
    projectToggle.appendChild(hdrThumb);
    projectToggle.appendChild(projectTitleEl);

    // ── Star button: available when all audio cells finished their attempts (no in-flight)
    // and at least one cell has a videoPath. Individual errors on cells are OK.
    const avatarsDone = (() => {
      if (!frozen?.cells) return false;
      const audioCells = frozen.cells.filter(c => c.audioPath);
      return audioCells.length > 0 &&
        audioCells.every(c => !c._videoPending && !c.avatarTaskId) &&
        audioCells.some(c => c.videoPath);
    })();
    // starred: must be explicitly true to appear in Склейка
    const isStarred = editFrozenSessions[sessionKey]?.starred === true;
    const activateBtn = document.createElement('button');
    activateBtn.textContent = isStarred ? '★' : '☆';
    activateBtn.title = isStarred
      ? 'Убрать из Склейки'
      : avatarsDone
        ? 'Добавить в Склейку'
        : 'Доступно после генерации всех видео «Говорящей головы»';
    activateBtn.style.cssText =
      `font-size:12px;padding:0 4px;flex-shrink:0;border:none;background:transparent;` +
      `color:${avatarsDone ? (isStarred ? '#cc8800' : '#888') : '#ccc'};` +
      `cursor:${avatarsDone ? 'pointer' : 'default'};`;
    activateBtn.disabled = !avatarsDone;
    activateBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (!avatarsDone) return;
      const sess = editFrozenSessions[sessionKey];
      if (!sess) return;
      const nowStarred = sess.starred !== true; // toggle
      sess.starred = nowStarred;
      // Keep closedSet in sync: un-starring closes the project; re-starring re-opens it
      const closed = getSkleykaClosed();
      if (nowStarred) {
        closed.delete(sessionKey);
      } else {
        closed.add(sessionKey);
      }
      saveSkleykaClosed(closed);
      saveEditState();
      renderEditPanel();
      renderAllTimelines();
    });

    // ── Del button — hides from Эдит only; session stays in Склейка ──
    const delProjBtn = document.createElement('button');
    delProjBtn.textContent = 'del';
    delProjBtn.title = 'Скрыть из Эдит (проект останется в Склейке)';
    delProjBtn.style.cssText = 'font-size:9px;padding:1px 5px;cursor:pointer;flex-shrink:0;color:#aa0000;';
    delProjBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (getActiveProjectKey() === sessionKey) setActiveProjectKey('');
      // Mark as hidden from Эдит without deleting — Склейка still sees this session
      if (editFrozenSessions[sessionKey]) {
        editFrozenSessions[sessionKey].hiddenFromEdit = true;
        saveEditState();
      }
      // Directly remove from last-visible so it stays hidden after reload
      const lv = _loadEditLastVisible();
      if (lv) { lv.delete(sessionKey); _saveEditLastVisible(lv); }
      renderEditPanel();
    });

    projectToggle.appendChild(activateBtn);
    projectToggle.appendChild(delProjBtn);

    if (avatarsDone && isStarred) projectWrap.style.outline = '2px solid #cc8800';

    const projectBody = document.createElement('div');
    projectBody.style.cssText = 'padding:8px;display:none;';

    // Always start collapsed
    projectArrow.textContent = '▶';

    projectToggle.addEventListener('click', () => {
      const open = projectBody.style.display === 'none';
      projectBody.style.display = open ? '' : 'none';
      projectArrow.textContent = open ? '▼' : '▶';
      if (firstCellImg) hdrThumb.style.display = open ? 'none' : 'block';
    });

    projectWrap.appendChild(projectToggle);
    projectWrap.appendChild(projectBody);

    const block = document.createElement('div');
    block.style.cssText = 'margin-bottom:0;';

    // ── Project controls header ──
    const hdr = document.createElement('div');

    // Per-project engine selector (row 2)
    const engineSel = document.createElement('select');
    engineSel.style.cssText = 'font-size:9px;height:22px;padding:0 2px;flex:1;';
    engineSel.title = 'Движок для этого проекта';
    [['nano-banana-2','NB Pro'],['qwen2','Qwen2'],['seedream','Seed'],['gptimage2','GPT-Img2']].forEach(([v,l]) => {
      const o = document.createElement('option'); o.value = v; o.textContent = l; engineSel.appendChild(o);
    });
    const engineStorageKey = `edit_engine__${sessionKey}`;
    engineSel.value = localStorage.getItem(engineStorageKey) || getImageEngine?.() || 'nano-banana-2';
    engineSel.addEventListener('change', () => localStorage.setItem(engineStorageKey, engineSel.value));

    // Per-project voice selector
    const voiceSel = document.createElement('select');
    voiceSel.title = 'Голос для TTS этого проекта';
    voiceSel.style.cssText = 'font-size:9px;height:22px;padding:0 2px;width:100%;';
    const voiceStorageKey = `edit_voice__${sessionKey}`;
    const _savedVoiceRaw = localStorage.getItem(voiceStorageKey) || activeObraz?.voice || 'Rachel';
    window.buildVoiceSelect(voiceSel, _savedVoiceRaw);
    window.registerVoiceSelect?.(voiceSel, () => voiceSel.value || _savedVoiceRaw);
    voiceSel.addEventListener('change', () => localStorage.setItem(voiceStorageKey, voiceSel.value));
    const getProjectVoice = () => voiceSel.value || 'Rachel';

    // ── Per-project TTS params (override global Мозги settings) ─────────────
    const ttsParamsStorageKey = `edit_tts_params__${sessionKey}`;
    function loadProjectTtsParams() {
      try { return JSON.parse(localStorage.getItem(ttsParamsStorageKey) || 'null') || null; } catch { return null; }
    }
    function saveProjectTtsParams(obj) {
      localStorage.setItem(ttsParamsStorageKey, JSON.stringify(obj));
    }
    // Returns per-project params if set, else falls back to global Мозги params
    const getProjectTtsParams = () => {
      const proj   = loadProjectTtsParams();
      const global = getEngineParams?.(getAudioEngine?.() || 'elevenlabs/text-to-dialogue-v3') || {};
      if (!proj) return global;
      return { ...global, ...proj };
    };

    // ── Voice preview button ─────────────────────────────────────────────────
    const voicePreviewBtn = document.createElement('button');
    voicePreviewBtn.textContent = '▶';
    voicePreviewBtn.title = 'Прослушать голос';
    voicePreviewBtn.style.cssText = 'width:22px;height:22px;padding:0;font-size:9px;flex-shrink:0;cursor:pointer;';
    let _previewAudio = null;
    voicePreviewBtn.addEventListener('click', async () => {
      const voice = getProjectVoice();
      // Stop any playing preview
      if (_previewAudio) { _previewAudio.pause(); _previewAudio = null; }
      if (voicePreviewBtn._playing) {
        voicePreviewBtn._playing = false;
        voicePreviewBtn.textContent = '▶';
        voicePreviewBtn.style.color = '';
        return;
      }
      // Use cached URL if available
      if (_voicePreviewCache.has(voice)) {
        const url = _voicePreviewCache.get(voice);
        _previewAudio = new Audio(url);
        voicePreviewBtn.textContent = '■'; voicePreviewBtn.style.color = '#0070cc'; voicePreviewBtn._playing = true;
        _previewAudio.play();
        _previewAudio.addEventListener('ended', () => { voicePreviewBtn.textContent = '▶'; voicePreviewBtn.style.color = ''; voicePreviewBtn._playing = false; });
        return;
      }

      const _vObj = window.findVoiceByValue?.(voice);
      const _staticUrl = window.getVoicePreviewUrl?.(_vObj);

      if (_staticUrl) {
        // ── Free static preview (voices with id) ──────────────────────────────
        _voicePreviewCache.set(voice, _staticUrl);
        _previewAudio = new Audio(_staticUrl);
        voicePreviewBtn.textContent = '■'; voicePreviewBtn.style.color = '#0070cc'; voicePreviewBtn._playing = true;
        _previewAudio.play();
        _previewAudio.addEventListener('ended', () => { voicePreviewBtn.textContent = '▶'; voicePreviewBtn.style.color = ''; voicePreviewBtn._playing = false; });
      } else {
        // ── TTS request preview (voices without id) ───────────────────────────
        voicePreviewBtn.textContent = '⏳'; voicePreviewBtn.disabled = true;
        try {
          const r = await fetch('/api/audio/tts-preview', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ voice, ttsParams: getProjectTtsParams(), model: getAudioEngine?.() }),
          });
          if (!r.ok) throw new Error(`HTTP ${r.status} — перезапусти сервер`);
          const d = await r.json();
          if (!d.success) throw new Error(d.error);
          _voicePreviewCache.set(voice, d.audioPath);
          _previewAudio = new Audio(d.audioPath);
          voicePreviewBtn.textContent = '■'; voicePreviewBtn.style.color = '#0070cc'; voicePreviewBtn._playing = true;
          _previewAudio.play();
          _previewAudio.addEventListener('ended', () => { voicePreviewBtn.textContent = '▶'; voicePreviewBtn.style.color = ''; voicePreviewBtn._playing = false; });
        } catch (err) {
          voicePreviewBtn.textContent = '▶';
          setStatus('Ошибка предпросмотра голоса: ' + err.message);
        } finally {
          voicePreviewBtn.disabled = false;
        }
      }
    });
    // Clear cache when voice changes so new selection generates fresh preview
    voiceSel.addEventListener('change', () => { if (_previewAudio) { _previewAudio.pause(); _previewAudio = null; } voicePreviewBtn.textContent = '▶'; voicePreviewBtn.style.color = ''; voicePreviewBtn._playing = false; });

    // ── TTS params button ────────────────────────────────────────────────────
    const ttsParamsBtn = document.createElement('button');
    ttsParamsBtn.textContent = '{}';
    ttsParamsBtn.title = 'Параметры генерации голоса (приоритет над Мозгами)';
    ttsParamsBtn.style.cssText = 'width:22px;height:22px;padding:0;font-size:8px;flex-shrink:0;cursor:pointer;font-family:monospace;font-weight:bold;';

    // Highlight button if custom params are saved
    const _refreshParamsBtnState = () => {
      const has = !!loadProjectTtsParams();
      ttsParamsBtn.style.background = has ? '#ffe0a0' : '';
      ttsParamsBtn.style.color      = has ? '#663300' : '';
    };
    _refreshParamsBtnState();

    ttsParamsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      // Remove any existing popup
      const existing = document.getElementById('_tts_params_popup');
      if (existing) { existing.remove(); return; }

      const current = loadProjectTtsParams() || {};
      const global  = getEngineParams?.('elevenlabs/text-to-speech-turbo-2-5') || {};

      const popup = document.createElement('div');
      popup.id = '_tts_params_popup';
      popup.style.cssText =
        'position:fixed;z-index:9999;background:#d4d0c8;border:2px solid #808080;' +
        'box-shadow:3px 3px 0 #808080;padding:10px;min-width:220px;font-size:11px;';

      const rect = ttsParamsBtn.getBoundingClientRect();
      popup.style.top  = (rect.bottom + 4) + 'px';
      popup.style.left = Math.max(4, rect.left - 120) + 'px';

      const title = document.createElement('div');
      title.textContent = 'Параметры голоса (для этого проекта)';
      title.style.cssText = 'font-weight:bold;margin-bottom:8px;font-size:10px;color:#333;';
      popup.appendChild(title);

      const hint = document.createElement('div');
      hint.textContent = 'Переопределяют глобальные настройки из Мозгов';
      hint.style.cssText = 'font-size:9px;color:#808080;margin-bottom:8px;';
      popup.appendChild(hint);

      const PARAMS = [
        { key: 'stability',        label: 'Stability',        min: 0,   max: 1,   step: 0.01, def: 0.5 },
        { key: 'similarity_boost', label: 'Similarity boost', min: 0,   max: 1,   step: 0.01, def: 0.75 },
        { key: 'style',            label: 'Style',            min: 0,   max: 1,   step: 0.01, def: 0 },
        { key: 'speed',            label: 'Speed',            min: 0.5, max: 2.0, step: 0.05, def: 1 },
      ];

      const vals = {};
      PARAMS.forEach(p => {
        vals[p.key] = current[p.key] ?? global[p.key] ?? p.def;
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:6px;';

        const lbl = document.createElement('label');
        lbl.textContent = p.label;
        lbl.style.cssText = 'min-width:100px;font-size:10px;';

        const range = document.createElement('input');
        range.type = 'range'; range.min = p.min; range.max = p.max; range.step = p.step;
        range.value = vals[p.key];
        range.style.cssText = 'flex:1;';

        const num = document.createElement('input');
        num.type = 'number'; num.min = p.min; num.max = p.max; num.step = p.step;
        num.value = vals[p.key];
        num.style.cssText = 'width:46px;font-size:10px;padding:1px 3px;';

        range.addEventListener('input', () => { num.value = range.value; vals[p.key] = parseFloat(range.value); });
        num.addEventListener('input',   () => { range.value = num.value; vals[p.key] = parseFloat(num.value) || p.def; });

        row.appendChild(lbl); row.appendChild(range); row.appendChild(num);
        popup.appendChild(row);
      });

      const btnRow = document.createElement('div');
      btnRow.style.cssText = 'display:flex;gap:6px;margin-top:10px;justify-content:flex-end;';

      const saveBtn = document.createElement('button');
      saveBtn.textContent = 'Применить';
      saveBtn.style.cssText = 'font-size:10px;padding:3px 8px;cursor:pointer;';
      saveBtn.addEventListener('click', () => {
        saveProjectTtsParams(vals);
        _refreshParamsBtnState();
        popup.remove();
      });

      const resetBtn2 = document.createElement('button');
      resetBtn2.textContent = 'Сброс';
      resetBtn2.title = 'Удалить настройки проекта, использовать глобальные из Мозгов';
      resetBtn2.style.cssText = 'font-size:10px;padding:3px 8px;cursor:pointer;color:#aa0000;';
      resetBtn2.addEventListener('click', () => {
        localStorage.removeItem(ttsParamsStorageKey);
        _refreshParamsBtnState();
        popup.remove();
      });

      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = 'Отмена';
      cancelBtn.style.cssText = 'font-size:10px;padding:3px 8px;cursor:pointer;';
      cancelBtn.addEventListener('click', () => popup.remove());

      btnRow.appendChild(resetBtn2); btnRow.appendChild(cancelBtn); btnRow.appendChild(saveBtn);
      popup.appendChild(btnRow);

      document.body.appendChild(popup);
      // Close on outside click
      const _onOutside = (ev) => { if (!popup.contains(ev.target) && ev.target !== ttsParamsBtn) { popup.remove(); document.removeEventListener('mousedown', _onOutside); } };
      document.addEventListener('mousedown', _onOutside);
    });

    // TTS "Голоса" button — enabled only when frozen session exists
    const ttsBtn = document.createElement('button');
    ttsBtn.textContent = '🎙';
    ttsBtn.title = 'Генерировать голоса для строк сценария';
    ttsBtn.style.cssText = 'width:22px;height:22px;padding:0;font-size:10px;flex-shrink:0;cursor:pointer;';
    ttsBtn.disabled = !frozen;

    const analyzeBtn = document.createElement('button');
    analyzeBtn.style.cssText = 'width:22px;height:22px;padding:0;font-size:9px;flex-shrink:0;cursor:pointer;';
    analyzeBtn.textContent = '🔍';
    analyzeBtn.title = 'Анализировать взаимодействия';

    const generateBtn = document.createElement('button');
    generateBtn.style.cssText = 'width:22px;height:22px;padding:0;font-size:9px;flex-shrink:0;cursor:pointer;';
    generateBtn.textContent = '▶';
    generateBtn.title = 'Генерировать';

    const resetBtn = document.createElement('button');
    resetBtn.style.cssText = 'width:22px;height:22px;padding:0;font-size:9px;flex-shrink:0;cursor:pointer;color:#aa0000;' + (frozen ? '' : 'display:none;');
    resetBtn.textContent = '✕';
    resetBtn.title = 'Сбросить результаты';
    resetBtn.addEventListener('click', () => {
      // Soft reset: clear generated cells and card cache, keep session in Склейка
      const sess = editFrozenSessions[sessionKey];
      if (sess) {
        sess.cells = [];
        sess.generating = false;
        sess.done = false;
        sess.pending = true;
        Object.keys(editCardCache).forEach(k => {
          if (k.startsWith(sessionKey + '__')) delete editCardCache[k];
        });
        saveEditState();
      }
      renderEditPanel();
    });

    // 3-column layout: left=selects, center=spacer, right=buttons
    hdr.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;align-items:start;' +
      'margin-bottom:6px;padding-bottom:3px;border-bottom:1px solid #808080;';

    // Left col: dropdowns
    const hdrLeft = document.createElement('div');
    hdrLeft.style.cssText = 'display:flex;flex-direction:column;gap:3px;';
    engineSel.style.cssText = 'font-size:9px;height:22px;padding:0 2px;width:100%;';
    hdrLeft.appendChild(engineSel);
    // Voice selector row: [dropdown] [▶ preview] [{ } params]
    const voiceRow = document.createElement('div');
    voiceRow.style.cssText = 'display:flex;gap:2px;align-items:center;';
    voiceSel.style.cssText = 'font-size:9px;height:22px;padding:0 2px;flex:1;min-width:0;';
    voiceRow.appendChild(voiceSel);
    voiceRow.appendChild(voicePreviewBtn);
    voiceRow.appendChild(ttsParamsBtn);
    voiceRow.appendChild(ttsBtn);
    hdrLeft.appendChild(voiceRow);

    // Center col: empty spacer
    const hdrCenter = document.createElement('div');

    // Right col: action buttons
    const hdrRight = document.createElement('div');
    hdrRight.style.cssText = 'display:flex;flex-direction:column;gap:3px;align-items:flex-end;';

    const btnRow1 = document.createElement('div');
    btnRow1.style.cssText = 'display:flex;gap:3px;';
    btnRow1.appendChild(analyzeBtn);
    btnRow1.appendChild(generateBtn);
    btnRow1.appendChild(resetBtn);

    hdrRight.appendChild(btnRow1);

    hdr.appendChild(hdrLeft);
    hdr.appendChild(hdrCenter);
    hdr.appendChild(hdrRight);
    block.appendChild(hdr);

    // ── If frozen: render frozen row and skip cards ──
    if (frozen) {
      const frozenObraz = getObrazы?.().find(o => String(o.id) === String(frozen.obrazId)) || activeObraz;

      // ── Shared single-cell avatar runner (used by button + retry) ─────────
      const runSingleAvatar = async (cell, vc, idx) => {
        const videoParams   = getEngineParams?.('kling/ai-avatar-pro') || {};
        const defaultPrompt = videoParams.prompt || 'Natural speaking motion with subtle head movement and relaxed posture';
        const imgPath = cell.imagePath || cell.charImagePath || frozenObraz?.char || activeObraz?.char;
        if (!imgPath || !cell.audioPath) return;

        vc.style.display = '';
        vc.innerHTML = '<span style="font-size:8px;color:#888;">⏳</span>';

        let prompt = defaultPrompt;
        try {
          const pr = await fetch('/api/audio/avatar-prompt', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imagePath: imgPath, text: cell.line, detailImagePath: cell.detInfo?.path || null }),
          });
          const pd = await pr.json();
          if (pd.success && pd.prompt) prompt = pd.prompt;
        } catch {}

        const showVideoError = (msg) => {
          cell.videoError = msg || 'Avatar failed';
          delete cell._videoPending; saveEditState();
          vc.innerHTML = '';
          const errSpan = document.createElement('span');
          errSpan.textContent = '❌ Видео'; errSpan.style.cssText = 'font-size:8px;color:#aa0000;';
          const retryBtn = document.createElement('button');
          retryBtn.textContent = '↺ Повтор';
          retryBtn.title = 'Повторить генерацию видео';
          retryBtn.style.cssText = 'font-size:8px;padding:1px 3px;cursor:pointer;display:block;width:100%;margin-top:2px;';
          retryBtn.addEventListener('click', () => runSingleAvatar(cell, vc, idx));
          vc.appendChild(errSpan); vc.appendChild(retryBtn);
          renderMontagePanel(); renderAllTimelines();
        };

        try {
          const r = await fetch('/api/audio/avatar', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imagePath: imgPath, audioPath: cell.audioPath, prompt, videoParams }),
          });
          const d = await r.json();
          if (!d.success) throw new Error(d.error);
          // Persist taskId so a tab switch / page reload can resume polling
          cell.avatarTaskId = d.taskId;
          cell._videoPending = true;
          saveEditState();
          const videoPath = await pollAvatar(d.taskId);
          cell.videoPath = videoPath; cell.videoError = null;
          delete cell.avatarTaskId; delete cell._videoPending; saveEditState();
          vc.style.display = '';
          vc.innerHTML = '';
          vc.appendChild(_buildVideoThumb(videoPath));
          // Hide source photo — only video needed
          if (cell._imgBox) cell._imgBox.style.display = 'none';
          if (cell._avatarBtn) { cell._avatarBtn.textContent = '↺🗣'; cell._avatarBtn.title = 'Пересоздать видео говорящей головы'; cell._avatarBtn.style.display = ''; cell._avatarBtn.style.background = ''; }
          if (cell._colEl) { cell._colEl.style.outline = ''; cell._colEl.style.background = ''; }
          renderMontagePanel(); renderAllTimelines();
        } catch (err) {
          delete cell.avatarTaskId; delete cell._videoPending; saveEditState();
          showVideoError(err.message);
        }
      };

      // ── Retry / reran a single image cell in the frozen session ─────────────
      const retryCellImage = async (cellIdx, imgBox, reranBtn) => {
        // Always read from the live session in case state changed since render
        const liveSession = editFrozenSessions[sessionKey];
        const cell        = liveSession?.cells?.[cellIdx];
        if (!cell) { setStatus(`Ячейка ${cellIdx + 1}: сессия не найдена`); return; }

        // ── Active image: random from образ variations (ignore stale charImagePath) ──
        const _obraz = frozenObraz || activeObraz;
        const _charCandidates = [
          _obraz?.char,
          ...(_obraz?.variations || []).filter(v => v && v !== 'error'),
        ].filter(Boolean);
        if (!_charCandidates.length) { setStatus(`Ячейка ${cellIdx + 1}: нет изображений образа`); return; }
        const _pickChar = () => _charCandidates[Math.floor(Math.random() * _charCandidates.length)];

        // ── Asset image: random from all предметы assigned to this project ──
        const _assignments = liveSession.assignments || frozen.assignments || {};
        const _assignedFiles = [...new Set(Object.values(_assignments).filter(Boolean))];
        const _assetCandidates = _assignedFiles
          .map(f => cachedDetailFiles.find(d => d.file === f)?.path || `/details/${f}`)
          .filter(Boolean);
        // Fallback: use cell's own detInfo if assignments are empty
        if (!_assetCandidates.length) {
          let detInfo = cell.detInfo;
          if (detInfo && !detInfo.path && detInfo.file)
            detInfo = cachedDetailFiles.find(d => d.file === detInfo.file) || detInfo;
          if (detInfo?.path) _assetCandidates.push(detInfo.path);
        }
        if (!_assetCandidates.length) { setStatus(`Ячейка ${cellIdx + 1}: нет предметов в проекте`); return; }
        const _pickAsset = () => _assetCandidates[Math.floor(Math.random() * _assetCandidates.length)];

        const imageEngine = engineSel.value || getImageEngine?.() || 'nano-banana-2';

        imgBox.style.cssText = 'width:62px;height:82px;border:1px solid #808080;background:#ddd;overflow:hidden;flex-shrink:0;display:flex;align-items:center;justify-content:center;';
        imgBox.innerHTML = '<span style="font-size:9px;color:#888;">⏳</span>';
        if (reranBtn) { reranBtn.disabled = true; reranBtn.textContent = '⏳'; }

        const MAX_RETRIES = 3;
        let lastErr = null;
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
          try {
            const gr = await fetch('/api/asset-interact/generate', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                activePath: _pickChar(), assetPath: _pickAsset(),
                prompt: '', assetType: 'detail', imageEngine,
                engineParams: getEngineParams?.(imageEngine) || {},
              }),
            });
            const gd = await gr.json();
            if (!gd.success) throw new Error(gd.error);

            const sess = editFrozenSessions[sessionKey];
            if (sess) { sess.cells[cellIdx].taskId = gd.taskId; saveEditState(); }

            const _ar1 = window.createActivityRow?.(`Предмет ячейка ${cellIdx + 1}`);
            const imagePath = await pollTask(gd.taskId, 3000, 120, _ar1);

            if (sess) {
              const cellRef = sess.cells[cellIdx];
              cellRef.imagePath = imagePath;
              delete cellRef.taskId;
              if (!cellRef.generatedImages) cellRef.generatedImages = [];
              if (!cellRef.generatedImages.includes(imagePath)) cellRef.generatedImages.push(imagePath);
              saveEditState();
            }

            imgBox.innerHTML = '';
            imgBox.style.cssText = 'width:62px;height:82px;border:1px solid #808080;background:#ccc;overflow:hidden;flex-shrink:0;cursor:zoom-in;';
            const img = document.createElement('img');
            img.src = imagePath + '?t=' + Date.now();
            img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
            img.addEventListener('click', () => {
              const cellRef2 = editFrozenSessions[sessionKey]?.cells[cellIdx];
              const fakeCell = cellRef2 || { imagePath, generatedImages: [imagePath] };
              openEditCellLightbox(fakeCell, selected => {
                if (cellRef2) { cellRef2.imagePath = selected; saveEditState(); }
                img.src = selected + '?t=' + Date.now();
              });
            });
            imgBox.appendChild(img);

            if (reranBtn) { reranBtn.disabled = false; reranBtn.textContent = '↺'; reranBtn.title = 'Реран (рандомный промпт)'; reranBtn.style.display = 'block'; }
            playCompletionSound?.();
            return; // success
          } catch (err) {
            lastErr = err;
            setStatus(`Ячейка ${cellIdx + 1}: попытка ${attempt}/3 — ${err.message}`);
            if (attempt < MAX_RETRIES) await new Promise(r => setTimeout(r, 3000));
          }
        }
        // All retries exhausted — show error with message
        imgBox.style.cssText = 'width:62px;height:82px;border:1px solid #808080;background:#ddd;overflow:hidden;flex-shrink:0;display:flex;align-items:center;justify-content:center;flex-direction:column;';
        imgBox.innerHTML = `<span style="font-size:7px;color:#aa0000;text-align:center;padding:2px;word-break:break-all;">${(lastErr?.message || 'Ошибка').slice(0, 60)}</span>`;
        playCompletionSound?.();
        if (reranBtn) { reranBtn.disabled = false; reranBtn.textContent = '↺ Повторить'; reranBtn.title = 'Повторить генерацию'; }
      };

      const _tlData = getTimelineData();
      const _editExcludedSet = new Set(_tlData[sessionKey]?.excludedSegments || []);
      const frozenRow = buildFrozenRow(frozen, retryCellImage, frozenObraz, (idx, vc, cell) => runSingleAvatar(cell, vc, idx), _editExcludedSet);
      block.appendChild(frozenRow);

      // ── Define "Говорящая голова" early so голосаPanel rows can reference it ──
      const allHaveAudio = () => frozen.cells.every(c => c.audioPath);
      const говорящаяГоловаBtn = document.createElement('button');
      говорящаяГоловаBtn.textContent = '🗣 Говорящая голова';
      говорящаяГоловаBtn.title = 'Создать видео-аватар (Kling) для каждого кадра';
      говорящаяГоловаBtn.style.cssText = 'margin-top:4px;font-size:10px;padding:3px 8px;cursor:pointer;width:100%;';
      говорящаяГоловаBtn.disabled = !allHaveAudio();

      // ── Голоса collapsible panel ──
      const голосаPanel = document.createElement('div');
      голосаPanel.style.cssText = 'margin-top:4px;';

      const голосаHeader = document.createElement('div');
      голосаHeader.style.cssText = 'display:flex;align-items:center;gap:4px;cursor:pointer;user-select:none;padding:3px 0;border-top:1px solid #c0c0c0;';
      const голосаArrow = document.createElement('span');
      голосаArrow.textContent = '▼'; голосаArrow.style.cssText = 'font-size:9px;color:#555;flex-shrink:0;';
      const голосаLabel = document.createElement('span');
      голосаLabel.style.cssText = 'font-size:10px;font-weight:bold;color:#333;';
      голосаLabel.textContent = 'Голоса';
      голосаHeader.appendChild(голосаArrow); голосаHeader.appendChild(голосаLabel);

      const голосаBody = document.createElement('div');
      голосаBody.style.cssText = 'display:;padding:2px 0;';

      голосаHeader.addEventListener('click', () => {
        const open = голосаBody.style.display === 'none';
        голосаBody.style.display = open ? '' : 'none';
        голосаArrow.textContent = open ? '▼' : '▶';
      });

      // Build one row per cell in the panel
      frozen.cells.forEach((cell, idx) => {
        const rowEl = document.createElement('div');
        rowEl.style.cssText = 'display:flex;align-items:flex-start;gap:4px;margin-bottom:5px;';

        const numEl = document.createElement('span');
        numEl.textContent = idx + 1;
        numEl.dataset.linenum = '1';
        numEl.style.cssText = 'font-size:9px;color:#808080;min-width:14px;padding-top:5px;flex-shrink:0;';

        const audioArea = document.createElement('div');
        audioArea.style.cssText = 'flex-shrink:0;padding-top:2px;';
        const makeAudioPlayer = (src) => {
          const aud = document.createElement('audio');
          aud.controls = true; aud.src = src;
          aud.style.cssText = 'height:24px;width:110px;';
          return aud;
        };
        if (cell.audioPath) {
          audioArea.appendChild(makeAudioPlayer(cell.audioPath));
        } else if (cell.audioError) {
          audioArea.innerHTML = '<span style="font-size:9px;color:#aa0000;">❌</span>';
        } else {
          audioArea.innerHTML = '<span style="font-size:9px;color:#bbb;">—</span>';
        }
        cell._audioContainer = audioArea;

        const textEl = document.createElement('textarea');
        textEl.value = cell.line;
        textEl.rows = 2;
        textEl.style.cssText = 'flex:1;font-size:9px;resize:vertical;padding:2px 3px;font-family:inherit;min-width:0;';
        textEl.addEventListener('change', () => {
          cell.line = textEl.value;
          saveEditState();
        });

        const remakeBtn = document.createElement('button');
        remakeBtn.textContent = '↺';
        remakeBtn.title = 'Переделать голос для этой строки';
        remakeBtn.style.cssText = 'flex-shrink:0;width:22px;height:22px;padding:0;font-size:12px;cursor:pointer;';
        remakeBtn.addEventListener('click', async () => {
          const newText = textEl.value.trim() || cell.line;
          audioArea.innerHTML = '<span style="font-size:9px;color:#888;">⏳</span>';
          remakeBtn.disabled = true;
          try {
            const r = await fetch('/api/audio/tts', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text: newText, voice: getProjectVoice(), ttsParams: getProjectTtsParams(), model: getAudioEngine?.() }),
            });
            const d = await r.json();
            if (!d.success) throw new Error(d.error);
            const audioPath = d.audioPath || await pollTts(d.taskId);
            cell.line = newText;
            cell.audioPath = audioPath; delete cell.audioError;
            // Clear outdated talking-head video for this cell
            if (cell.videoPath || cell.avatarTaskId) {
              cell.videoPath = null; delete cell.videoError; delete cell.avatarTaskId; delete cell._videoPending;
              if (cell._videoContainer) {
                cell._videoContainer.style.display = 'none';
                cell._videoContainer.innerHTML = '';
              }
              if (cell._colEl) { cell._colEl.style.outline = '2px solid #cc0000'; cell._colEl.style.background = '#fff5f5'; }
              if (cell._imgBox) cell._imgBox.style.display = '';
              if (cell._avatarBtn) { cell._avatarBtn.textContent = '⚠🗣'; cell._avatarBtn.style.background = '#fff3cd'; cell._avatarBtn.title = 'Аудио изменено — перегенерировать видео'; }
            }
            saveEditState();
            renderAllTimelines();
            audioArea.innerHTML = '';
            audioArea.appendChild(makeAudioPlayer(audioPath));
            if (allHaveAudio()) говорящаяГоловаBtn.disabled = false;
          } catch (err) {
            cell.audioError = err.message; saveEditState();
            audioArea.innerHTML = '<span style="font-size:9px;color:#aa0000;">❌</span>';
          } finally {
            remakeBtn.disabled = false;
          }
        });

        const _initExcl = _editExcludedSet.has(idx);
        const toggleLineBtn = document.createElement('button');
        const _applyToggleStyle = (excl) => {
          toggleLineBtn.textContent = excl ? '↺' : '✕';
          toggleLineBtn.title = excl ? 'Восстановить строку' : 'Деактивировать строку';
          toggleLineBtn.style.color = excl ? '#008800' : '#aa0000';
          rowEl.style.opacity = excl ? '0.5' : '';
          const col = frozen.cells[idx]?._colEl;
          if (col) {
            col.style.opacity       = excl ? '0.35' : '';
            col.style.filter        = excl ? 'grayscale(1)' : '';
            col.style.pointerEvents = excl ? 'none' : '';
          }
        };
        toggleLineBtn.style.cssText = 'flex-shrink:0;width:18px;height:22px;padding:0;font-size:10px;cursor:pointer;';
        _applyToggleStyle(_initExcl);
        toggleLineBtn.addEventListener('click', () => {
          const d = getTimelineData();
          if (!d[sessionKey]) d[sessionKey] = {};
          const excl = new Set(d[sessionKey].excludedSegments || []);
          const nowExcluded = !excl.has(idx);
          if (nowExcluded) excl.add(idx); else excl.delete(idx);
          d[sessionKey].excludedSegments = [...excl];
          setTimelineData(d);
          _applyToggleStyle(nowExcluded);
          renderAllTimelines();
        });

        rowEl.appendChild(numEl); rowEl.appendChild(audioArea); rowEl.appendChild(textEl); rowEl.appendChild(remakeBtn); rowEl.appendChild(toggleLineBtn);
        голосаBody.appendChild(rowEl);
      });

      голосаPanel.appendChild(голосаHeader); голосаPanel.appendChild(голосаBody);
      block.appendChild(голосаPanel);

      // ── Attach говорящаяГоловаBtn click handler ──────────────────────────────
      говорящаяГоловаBtn.addEventListener('click', async () => {
        говорящаяГоловаBtn.disabled = true;
        говорящаяГоловаBtn.textContent = '⏳ Генерация видео…';

        // Mark cells as pending, switch to Склейка — placeholders show now
        frozen.cells.forEach(cell => { if (cell.audioPath) cell._videoPending = true; });
        renderMontagePanel();
        document.querySelector('#l1-tabs [aria-controls="l1-skleyka"]')?.click();

        let done = 0;
        await Promise.all(frozen.cells.map(async (cell, idx) => {
          if (!cell.audioPath) return;
          const vc = cell._videoContainer;
          await runSingleAvatar(cell, vc || document.createElement('div'), idx);
          if (cell.videoPath) done++;
        }));

        говорящаяГоловаBtn.textContent = done > 0 ? `✓ Видео (${done})` : '🗣 Говорящая голова';
        говорящаяГоловаBtn.disabled = false;

        renderAllTimelines();
        // Re-render edit panel so the ★ button becomes active
        const _editEl = document.getElementById('scen-panel-edit');
        const _sklEl  = document.getElementById('l1-skleyka');
        if (_editEl?.classList.contains('active') && _sklEl?.classList.contains('active')) {
          renderEditPanel();
        } else {
          window._editPanelNeedsRender = true;
        }
      });
      block.appendChild(говорящаяГоловаBtn);

      // ── TTS "Голоса" button handler — auto-expands panel, updates audioArea per cell ──
      ttsBtn.disabled = false;
      ttsBtn.addEventListener('click', async () => {
        const voice = getProjectVoice();
        ttsBtn.disabled = true; ttsBtn.textContent = '⏳';
        // Auto-expand the голоса panel to show progress
        голосаBody.style.display = ''; голосаArrow.textContent = '▼';
        // Clear all existing audio before regenerating
        frozen.cells.forEach(cell => {
          delete cell.audioPath; delete cell.audioError; delete cell.videoPath;
          delete cell.avatarTaskId; delete cell.videoError;
          if (cell._audioContainer) cell._audioContainer.innerHTML = '<span style="font-size:9px;color:#888;">⏳</span>';
        });
        saveEditState();
        await Promise.all(frozen.cells.map(async (cell) => {
          const container = cell._audioContainer;
          if (container) container.innerHTML = '<span style="font-size:9px;color:#888;">⏳</span>';

          const showAudioError = () => {
            if (!container) return;
            container.innerHTML = '';
            const errSpan = document.createElement('span');
            errSpan.style.cssText = 'font-size:9px;color:#aa0000;'; errSpan.textContent = '❌';
            const retryBtn = document.createElement('button');
            retryBtn.textContent = '↺'; retryBtn.style.cssText = 'font-size:9px;padding:1px 3px;cursor:pointer;margin-left:3px;';
            retryBtn.addEventListener('click', async () => {
              container.innerHTML = '<span style="font-size:9px;color:#888;">⏳</span>';
              try {
                const r2 = await fetch('/api/audio/tts', {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ text: cell.line, voice: getProjectVoice(), ttsParams: getProjectTtsParams(), model: getAudioEngine?.() }),
                });
                const d2 = await r2.json();
                if (!d2.success) throw new Error(d2.error);
                const ap = d2.audioPath || await pollTts(d2.taskId);
                cell.audioPath = ap; delete cell.audioError; saveEditState();
                container.innerHTML = '';
                const aud = document.createElement('audio');
                aud.controls = true; aud.src = ap; aud.style.cssText = 'height:24px;width:110px;';
                container.appendChild(aud);
                if (allHaveAudio()) говорящаяГоловаBtn.disabled = false;
              } catch (e2) { cell.audioError = e2.message; saveEditState(); showAudioError(); }
            });
            container.appendChild(errSpan); container.appendChild(retryBtn);
          };

          try {
            const r = await fetch('/api/audio/tts', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text: cell.line, voice, ttsParams: getProjectTtsParams(), model: getAudioEngine?.() }),
            });
            const d = await r.json();
            if (!d.success) throw new Error(d.error);
            const audioPath = d.audioPath || await pollTts(d.taskId);
            cell.audioPath = audioPath; delete cell.audioError; saveEditState();
            if (container) {
              container.innerHTML = '';
              const aud = document.createElement('audio');
              aud.controls = true; aud.src = audioPath; aud.style.cssText = 'height:24px;width:110px;';
              container.appendChild(aud);
            }
            if (cell._avatarBtn) cell._avatarBtn.style.display = '';
          } catch (err) { cell.audioError = err.message || 'TTS failed'; saveEditState(); showAudioError(); }
        }));
        ttsBtn.disabled = false; ttsBtn.textContent = '🎙';
        if (allHaveAudio()) говорящаяГоловаBtn.disabled = false;
      });

      projectBody.appendChild(block);
      panel.appendChild(projectWrap);
      analyzeBtn.addEventListener('click', () => doAnalyze(analyzeBtn, lines, activeObraz, f, [], sessionData.assignments || {}));
      continue;
    }

    // ── Snapshot current assignments into the session body ────────────────────
    // This ensures образ/предмет pairs survive page refresh, tab switches, and
    // any event that resets the global scenarioAssignments map.
    {
      const snap = {};
      lines.forEach((_, i) => {
        const k = `${f.file}__${i}`;
        const v = scenarioAssignments[k];
        if (v) snap[k] = v;
      });
      if (Object.keys(snap).length > 0) {
        // Only update if global has data (guard against empty-after-reset overwriting)
        sessionData.assignments = { ...(sessionData.assignments || {}), ...snap };
        saveEditState();
      }
    }

    // ── Per-line random image (obraz.char or one of its completed variations) ──
    const lineImages = lines.map(() => pickRandomObrazImage(activeObraz));

    // ── Cards row (pre-generation) ──
    const cardsRow = document.createElement('div');
    cardsRow.style.cssText = 'display:flex;gap:6px;overflow-x:auto;padding-bottom:4px;';

    const cardSelects = [];

    lines.forEach((line, i) => {
      const assignKey  = `${f.file}__${i}`;          // scenario assignment key (scenFile-based)
      const cardKey    = `${sessionKey}__${i}`;       // cache key (session-unique)
      // Read from session body first (persistent), then fall back to global map
      let detFile    = sessionData.assignments?.[assignKey] || scenarioAssignments[assignKey] || null;
      let detailInfo = detFile ? cachedDetailFiles.find(d => d.file === detFile) : null;

      const card = document.createElement('div');
      card.style.cssText = 'flex-shrink:0;width:66px;display:flex;flex-direction:column;align-items:center;gap:2px;';

      const num = document.createElement('div');
      num.style.cssText = 'font-size:9px;color:#808080;line-height:1.4;';
      num.textContent = i + 1;

      const obrazBox = document.createElement('div');
      obrazBox.style.cssText = 'width:62px;height:82px;border:1px solid #808080;background:#ccc;overflow:hidden;flex-shrink:0;cursor:zoom-in;';
      const obrazImg = document.createElement('img');
      obrazImg.dataset.src = lineImages[i];
      obrazImg.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
      const allCharImgs = [activeObraz.char, ...(activeObraz.variations || []).filter(v => v && v !== 'error')].filter(Boolean);
      const charPseudoCell = { imagePath: lineImages[i] };
      obrazImg.addEventListener('click', () => openImagePicker(
        allCharImgs, obrazImg, lineImages[i], selected => {
          lineImages[i] = selected;
          obrazImg.src = selected + '?t=' + Date.now();
          const cellRef = editFrozenSessions[sessionKey]?.cells?.[i];
          if (cellRef) { cellRef.charImagePath = selected; if (!cellRef.detInfo) cellRef.imagePath = selected; saveEditState(); }
        }));
      lazyLoad(obrazImg);
      obrazBox.appendChild(obrazImg);

      const detailBox = document.createElement('div');
      if (detailInfo) {
        detailBox.style.cssText = 'width:62px;height:62px;border:1px solid #808080;background:#ccc;overflow:hidden;flex-shrink:0;cursor:pointer;';
        const detImg = document.createElement('img');
        detImg.dataset.src = detailInfo.thumbPath || detailInfo.path;
        detImg.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
        lazyLoad(detImg);
        detailBox.appendChild(detImg);
      } else {
        detailBox.style.cssText = 'width:62px;height:62px;border:1px dashed #bbb;background:#ebebeb;flex-shrink:0;cursor:pointer;display:flex;align-items:center;justify-content:center;';
        const plusEl = document.createElement('span');
        plusEl.textContent = '+';
        plusEl.style.cssText = 'font-size:22px;color:#bbb;pointer-events:none;';
        detailBox.appendChild(plusEl);
      }
      // Click on detailBox → open item picker (in-place update, no full re-render)
      detailBox.addEventListener('click', () => {
        if (!cachedDetailFiles.length) { setStatus('Нет загруженных предметов'); return; }
        openDetailPicker(cachedDetailFiles, detailBox, detFile, chosen => {
          const newFile = chosen ? chosen.file : null;
          // Update assignments
          if (newFile) {
            scenarioAssignments[assignKey] = newFile;
          } else {
            delete scenarioAssignments[assignKey];
          }
          _saveAssignmentsToLS();
          saveScenarioAssignments();
          if (sessionData.assignments) {
            if (newFile) { sessionData.assignments[assignKey] = newFile; }
            else { delete sessionData.assignments[assignKey]; }
          }
          saveEditState();

          // Update mutable refs so subsequent clicks see the new state
          detFile    = newFile;
          detailInfo = newFile ? cachedDetailFiles.find(d => d.file === newFile) : null;

          // ── Update detailBox in-place ──────────────────────────────────────
          detailBox.innerHTML = '';
          if (detailInfo) {
            detailBox.style.cssText = 'width:62px;height:62px;border:1px solid #808080;background:#ccc;overflow:hidden;flex-shrink:0;cursor:pointer;';
            const di = document.createElement('img');
            di.src = detailInfo.thumbPath || detailInfo.path;
            di.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
            detailBox.appendChild(di);
          } else {
            detailBox.style.cssText = 'width:62px;height:62px;border:1px dashed #bbb;background:#ebebeb;flex-shrink:0;cursor:pointer;display:flex;align-items:center;justify-content:center;';
            const pl = document.createElement('span');
            pl.textContent = '+';
            pl.style.cssText = 'font-size:22px;color:#bbb;pointer-events:none;';
            detailBox.appendChild(pl);
          }

          // ── Show/hide sel / poseSel / genaBtn ─────────────────────────────
          sel.style.display     = detailInfo ? '' : 'none';
          poseSel.style.display = 'none'; // always hidden — pose-only generation removed from UI
          genaBtn.style.display = detailInfo ? '' : 'none';
          genaBtn.textContent   = 'Гена';
          genaBtn.title         = detailInfo ? 'Сгенерировать это изображение' : '';
          // Reassign onclick so it uses the current detailInfo state
          if (detailInfo) {
            genaBtn.onclick = () => {
              const resultBox = document.createElement('div');
              resultBox.style.cssText = 'width:62px;height:82px;border:1px solid #808080;overflow:hidden;flex-shrink:0;';
              obrazBox.replaceWith(resultBox);
              detailBox.remove();
              genaBtn.textContent = '↺';
              genaBtn.title = 'Реран (рандомный промпт)';
              let firstRun = true;
              const doRun = () => {
                runGen(resultBox, genaBtn, detailInfo, cardKey, !firstRun, i, lineImages[i]);
                firstRun = false;
              };
              genaBtn.onclick = doRun;
              doRun();
            };
          } else {
            genaBtn.onclick = null;
          }

          // Update cardSelects entry so runGen picks the right detFile
          const csEntry = cardSelects.find(s => s.cardKey === cardKey);
          if (csEntry) csEntry.detFile = newFile;
        });
      });

      // Interaction dropdown — only shown when detail is assigned
      const sel = document.createElement('select');
      sel.style.cssText = 'width:66px;font-size:8px;margin-top:1px;' + (detailInfo ? '' : 'display:none;');
      const opts = getMergedOptions(f.file);
      opts.forEach((o, idx) => {
        const opt = document.createElement('option');
        opt.value = idx; opt.textContent = o.label;
        sel.appendChild(opt);
      });
      const savedIdx = cardInteractionSel[cardKey];
      if (savedIdx != null && savedIdx < opts.length) sel.value = savedIdx;
      sel.addEventListener('change', () => { cardInteractionSel[cardKey] = Number(sel.value); });
      cardSelects.push({ sel, detFile, cardKey });

      // Pose dropdown — kept in DOM (hidden) for poseCardKey cache restore logic
      const poseSel = document.createElement('select');
      poseSel.style.cssText = 'width:66px;font-size:8px;margin-top:1px;display:none;';
      EDIT_POSE_OPTIONS.forEach(o => {
        const opt = document.createElement('option');
        opt.value = o.value; opt.textContent = o.label;
        poseSel.appendChild(opt);
      });

      // ── Гена button ──
      const genaBtn = document.createElement('button');
      genaBtn.textContent = 'Гена';
      genaBtn.style.cssText = 'width:66px;font-size:8px;padding:1px 0;margin-top:1px;cursor:pointer;' + (detailInfo ? '' : 'display:none;');
      genaBtn.title = detailInfo ? 'Сгенерировать это изображение' : '';

      if (detailInfo) {
        // With detail: generate asset interaction
        if (editCardCache[cardKey]) {
          // Restore cached result immediately (survives tab switches)
          const cached = editCardCache[cardKey];
          obrazBox.innerHTML = '';
          obrazBox.style.cssText = 'width:62px;height:82px;border:1px solid #808080;background:#ccc;overflow:hidden;flex-shrink:0;cursor:zoom-in;';
          const cImg = document.createElement('img');
          cImg.dataset.src = cached.imagePath + '?t=' + Date.now();
          cImg.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
          cImg.addEventListener('click', () => {
            const cellRef = editFrozenSessions[sessionKey]?.cells?.[i];
            const fallbackImgs = [activeObraz.char, ...(activeObraz.variations || []).filter(v => v && v !== 'error')].filter(Boolean);
            const targetCell = cellRef || { imagePath: cached.imagePath };
            const imgs = targetCell.generatedImages?.length ? targetCell.generatedImages : fallbackImgs;
            openImagePicker(imgs, cImg, targetCell.imagePath, selected => {
              if (cellRef) { cellRef.imagePath = selected; }
              cImg.src = selected + '?t=' + Date.now();
              editCardCache[cardKey] = { ...(editCardCache[cardKey] || {}), imagePath: selected };
              saveEditState();
            });
          });
          lazyLoad(cImg);
          obrazBox.appendChild(cImg);
          detailBox.style.display = 'none';
          genaBtn.textContent = '↺';
          genaBtn.title = 'Реран (рандомный промпт)';
          genaBtn.onclick = () => {
            runGen(obrazBox, genaBtn, detailInfo, cardKey, true, i, lineImages[i]);
          };
        } else {
          genaBtn.onclick = () => {
            const resultBox = document.createElement('div');
            resultBox.style.cssText = 'width:62px;height:82px;border:1px solid #808080;overflow:hidden;flex-shrink:0;';
            obrazBox.replaceWith(resultBox);
            detailBox.remove();
            genaBtn.textContent = '↺';
            genaBtn.title = 'Реран (рандомный промпт)';
            let firstRun = true;
            const doRun = () => {
              runGen(resultBox, genaBtn, detailInfo, cardKey, !firstRun, i, lineImages[i]);
              firstRun = false;
            };
            genaBtn.onclick = doRun;
            doRun();
          };
        }
      } else {
        // Without detail: genaBtn is hidden; keep poseCardKey for cache restore only
        const poseCardKey = `${f.file}__${i}__pose`;
        if (editCardCache[poseCardKey]) {
          const cachedPose = editCardCache[poseCardKey];
          obrazImg.src = cachedPose.imagePath + '?t=' + Date.now();
          obrazImg.style.cursor = 'zoom-in';
          {
            const poseCharImgs = [activeObraz.char, ...(activeObraz.variations || []).filter(v => v && v !== 'error')].filter(Boolean);
            obrazImg.onclick = () => openImagePicker(
              cachedPose.generatedImages?.length ? cachedPose.generatedImages : poseCharImgs,
              obrazImg, cachedPose.imagePath, selected => {
                cachedPose.imagePath = selected;
                obrazImg.src = selected + '?t=' + Date.now();
                editCardCache[poseCardKey] = cachedPose;
                saveEditState();
              });
          }
        }
        // genaBtn is hidden (display:none) — onclick set if user later adds a detail via detailBox
      }

      card.appendChild(num); card.appendChild(obrazBox); card.appendChild(detailBox);
      card.appendChild(sel); card.appendChild(poseSel); card.appendChild(genaBtn);
      cardsRow.appendChild(card);
    });

    block.appendChild(cardsRow);

    // ── Shared runGen: with retry, freeze update, reran support ──
    async function runGen(imgBox, reranBtn, detInfo, cardKey, useRandomPrompt, cellIdx, charImagePath) {
      const imageEngine = engineSel.value || getImageEngine?.() || 'nano-banana-2';
      const activePath  = charImagePath || activeObraz.char;
      imgBox.style.cssText = 'width:62px;height:82px;border:1px solid #808080;background:#ddd;overflow:hidden;flex-shrink:0;display:flex;align-items:center;justify-content:center;';
      imgBox.innerHTML = '<span style="font-size:9px;color:#888;">⏳</span>';
      if (reranBtn) reranBtn.disabled = true;

      let interactionLabel = '';
      if (!useRandomPrompt) {
        const selEntry = cardSelects.find(s => s.cardKey === cardKey);
        const selIdx   = selEntry ? Number(selEntry.sel.value) : 0;
        interactionLabel = getMergedOptions(f.file)[selIdx]?.label || '';
      }

      const MAX_RETRIES = 3;
      let lastErr = null;
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          const gr = await fetch('/api/asset-interact/generate-with-analysis', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              activePath, assetPath: detInfo.path,
              interactionLabel, assetSize: detInfo.size || '',
              imageEngine, engineParams: getEngineParams?.(imageEngine) || {},
            }),
          });
          const gd = await gr.json();
          if (!gd.success) throw new Error(gd.error);

          // Persist taskId in cell so a server restart can resume polling
          const sess = editFrozenSessions[sessionKey];
          if (sess && cellIdx != null) {
            sess.cells[cellIdx].taskId = gd.taskId;
            saveEditState();
          }

          const _ar2 = window.createActivityRow?.(`Сцена строка ${cellIdx != null ? cellIdx + 1 : ''}`);
          const imagePath = await pollTask(gd.taskId, 3000, 120, _ar2);

          // Update frozen session cell
          if (sess && cellIdx != null) {
            const cellRef = sess.cells[cellIdx];
            cellRef.imagePath = imagePath;
            delete cellRef.taskId;
            // Accumulate all generated variants for this cell
            if (!cellRef.generatedImages) cellRef.generatedImages = [];
            if (!cellRef.generatedImages.includes(imagePath)) cellRef.generatedImages.push(imagePath);
          }

          imgBox.innerHTML = '';
          imgBox.style.cssText = 'width:62px;height:82px;border:1px solid #808080;background:#ccc;overflow:hidden;flex-shrink:0;cursor:zoom-in;';
          const img = document.createElement('img');
          img.src = imagePath + '?t=' + Date.now(); // generated now — load immediately, no lazy
          img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
          img.addEventListener('click', () => {
            const cellRef2 = editFrozenSessions[sessionKey]?.cells[cellIdx];
            const imgs2 = cellRef2?.generatedImages?.length ? cellRef2.generatedImages : [imagePath];
            openImagePicker(imgs2, img, cellRef2?.imagePath || imagePath, selected => {
              if (cellRef2) { cellRef2.imagePath = selected; saveEditState(); }
              img.src = selected + '?t=' + Date.now();
            });
          });
          imgBox.appendChild(img);
          editCardCache[cardKey] = { imagePath };
          saveEditState();
          if (reranBtn) reranBtn.disabled = false;
          return; // success
        } catch (err) {
          lastErr = err;
          console.error(`[Эдит] Ошибка строка ${(cellIdx ?? '?') + 1}, попытка ${attempt}: ${err.message}`);
          setStatus(`Строка ${(cellIdx ?? '?') + 1}: попытка ${attempt}/3 — ${err.message}`);
          if (attempt < MAX_RETRIES) await new Promise(r => setTimeout(r, 3000));
        }
      }
      // All retries exhausted
      imgBox.style.cssText = 'width:62px;height:82px;border:1px solid #808080;background:#ddd;overflow:hidden;flex-shrink:0;display:flex;align-items:center;justify-content:center;';
      imgBox.innerHTML = '<span style="font-size:8px;color:#aa0000;text-align:center;padding:2px;">Ошибка</span>';
      if (reranBtn) reranBtn.disabled = false;
    }

    // ── Анализировать handler ──
    analyzeBtn.addEventListener('click', () => doAnalyze(analyzeBtn, lines, activeObraz, f, cardSelects, sessionData.assignments || {}));

    // ── Генерировать handler ──
    generateBtn.addEventListener('click', async () => {
      generateBtn.disabled = true; generateBtn.textContent = '⏳';
      resetBtn.style.display = '';

      // Freeze session immediately
      const sessionCells = lines.map((line, i) => {
        const assignKey2 = `${f.file}__${i}`;
        const detFile = scenarioAssignments[assignKey2] || null;
        const detInfo = detFile ? cachedDetailFiles.find(d => d.file === detFile) : null;
        return { line, detInfo, charImagePath: lineImages[i], imagePath: detInfo ? null : lineImages[i] };
      });
      editFrozenSessions[sessionKey] = { lines, cells: sessionCells, generating: true, done: false, date: sessionData.date || new Date().toISOString(), scenFile: f.file, obrazId: String(activeObraz.id) };
      saveEditState();   // persist immediately so restart can detect this session

      // Build results row
      const resultsRow = document.createElement('div');
      resultsRow.style.cssText = 'display:flex;gap:6px;overflow-x:auto;padding-bottom:4px;';

      const jobs = [];
      sessionCells.forEach((cell, i) => {
        const c = document.createElement('div');
        c.style.cssText = 'flex-shrink:0;width:66px;display:flex;flex-direction:column;align-items:center;gap:2px;';
        const num = document.createElement('div');
        num.style.cssText = 'font-size:9px;color:#808080;line-height:1.4;';
        num.textContent = i + 1;
        const imgBox = document.createElement('div');
        imgBox.style.cssText = 'width:62px;height:82px;border:1px solid #808080;overflow:hidden;flex-shrink:0;';
        cell._imgBox = imgBox;

        let reranBtn = null;
        if (!cell.detInfo) {
          imgBox.style.cssText += 'background:#ccc;cursor:zoom-in;';
          const img = document.createElement('img');
          img.src = cell.imagePath;
          img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
          img.addEventListener('click', () => openImagePicker(
            cell.generatedImages?.length ? cell.generatedImages : [cell.imagePath],
            img, cell.imagePath, selected => {
              cell.imagePath = selected;
              img.src = selected + '?t=' + Date.now();
              saveEditState();
            }));
          imgBox.appendChild(img);
        } else {
          reranBtn = document.createElement('button');
          reranBtn.textContent = '↺'; reranBtn.title = 'Реран (рандомный промпт)';
          reranBtn.style.cssText = 'width:66px;font-size:9px;padding:1px 0;margin-top:1px;cursor:pointer;display:none;';
          reranBtn.addEventListener('click', () => runGen(imgBox, reranBtn, cell.detInfo, `${sessionKey}__${i}`, true, i, cell.charImagePath));
          cell._reranBtn = reranBtn;
          jobs.push({ imgBox, reranBtn, detInfo: cell.detInfo, cardKey: `${sessionKey}__${i}`, cellIdx: i, charImagePath: cell.charImagePath });
        }

        c.appendChild(num); c.appendChild(imgBox);
        if (reranBtn) c.appendChild(reranBtn);
        resultsRow.appendChild(c);
      });

      cardsRow.replaceWith(resultsRow);
      setStatus('Генерация…');

      let done = 0;
      await Promise.all(jobs.map(({ imgBox, reranBtn, detInfo, cardKey, cellIdx, charImagePath }) =>
        runGen(imgBox, reranBtn, detInfo, cardKey, false, cellIdx, charImagePath).then(() => {
          if (reranBtn) reranBtn.style.display = 'block';
          done++;
          setStatus(`Генерация: ${done}/${jobs.length}`);
        })
      ));

      editFrozenSessions[sessionKey].generating = false;
      editFrozenSessions[sessionKey].done = true;
      saveEditState();
      setStatus('Генерация завершена.');
      generateBtn.disabled = false; generateBtn.textContent = '▶';
      await renderEditPanel();
    });

    projectBody.appendChild(block);
    panel.appendChild(projectWrap);
  } // end for combos

}

// ── Shared analyze handler ────────────────────────────────────────────────────
// sessionAssignments: the assignments stored in the session body (primary source).
// Falls back to the global scenarioAssignments map for any key not found there.
async function doAnalyze(analyzeBtn, lines, activeObraz, f, cardSelects, sessionAssignments = {}) {
  analyzeBtn.disabled = true; analyzeBtn.textContent = '⏳';
  setStatus('Анализирую взаимодействия…');
  const _arAn = window.createActivityRow?.('Анализ взаимодействий');
  const uniqueDetails = [...new Set(
    lines.map((_, i) => {
      const k = `${f.file}__${i}`;
      return sessionAssignments[k] || scenarioAssignments[k];
    }).filter(Boolean)
  )];
  console.log('[doAnalyze] f.file:', f.file, '| uniqueDetails:', uniqueDetails, '| sessionAssignments:', sessionAssignments, '| scenarioAssignments:', scenarioAssignments);
  if (!uniqueDetails.length) {
    setStatus('Нет назначенных предметов для анализа.');
    analyzeBtn.disabled = false; analyzeBtn.textContent = '🔍'; return;
  }
  // Reset scenario-level cache so re-analysis always gives fresh results
  delete analysisCache[f.file];
  try {
    const newVariants = [];
    for (const detFile of uniqueDetails) {
      // Always call the API (ignore detFile cache) — user explicitly requested analysis
      const detInfo = cachedDetailFiles.find(d => d.file === detFile);
      if (!detInfo) continue;
      const r = await fetch('/api/scenarios/analyze', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activePath: activeObraz.char, assetPath: detInfo.path }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error);
      analysisCache[detFile] = d.variants;
      _saveAnalysisCache();
      newVariants.push(...d.variants);
    }
    // Deduplicate by label across multiple detail files
    const seen = new Set();
    const fresh = newVariants.filter(v => { if (seen.has(v.label)) return false; seen.add(v.label); return true; });
    analysisCache[f.file] = fresh;
    _saveAnalysisCache();

    const merged = getMergedOptions(f.file);
    // Update live select elements (may be detached if panel was re-rendered — harmless)
    cardSelects.forEach(({ sel }) => {
      if (!sel.isConnected) return; // skip detached elements
      const curVal = Number(sel.value);
      while (sel.options.length > DEFAULT_INTERACTIONS.length) sel.remove(DEFAULT_INTERACTIONS.length);
      merged.slice(DEFAULT_INTERACTIONS.length).forEach((o, idx) => {
        const opt = document.createElement('option');
        opt.value = DEFAULT_INTERACTIONS.length + idx; opt.textContent = o.label;
        sel.appendChild(opt);
      });
      sel.value = curVal < merged.length ? curVal : 0;
    });
    setStatus(`Добавлено вариантов: ${fresh.length}`);
    _arAn?.finalize?.(`✅ +${fresh.length} вариантов`);
  } catch (err) {
    setStatus('Ошибка анализа: ' + err.message);
    _arAn?.finalize?.('❌ ' + err.message);
  } finally {
    analyzeBtn.disabled = false; analyzeBtn.textContent = '🔍';
  }
}

// ── Poll task until success/failed ────────────────────────────────────────────
async function pollTask(taskId, intervalMs = 3000, maxAttempts = 120, actRow = null) {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, intervalMs));
    const r = await fetch(`/api/asset-interact/status/${taskId}`);
    const d = await r.json();
    if (d.state === 'success') { actRow?.setImage?.(d.imagePath); actRow?.finalize?.('✅ Готово'); return d.imagePath; }
    if (d.state === 'failed')  { actRow?.finalize?.('❌ ' + (d.error || 'Ошибка')); throw new Error(d.error || 'failed'); }
  }
  actRow?.finalize?.('❌ Таймаут');
  throw new Error('Таймаут генерации');
}

async function pollTts(taskId, intervalMs = 3000, maxAttempts = 120, actRow = null) {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, intervalMs));
    const r = await fetch(`/api/audio/tts/status/${taskId}`);
    const d = await r.json();
    if (d.state === 'success') { actRow?.finalize?.('✅ TTS'); return d.audioPath; }
    if (d.state === 'failed')  { actRow?.finalize?.('❌ TTS'); throw new Error(d.error || 'TTS failed'); }
  }
  actRow?.finalize?.('❌ TTS таймаут');
  throw new Error('Таймаут TTS');
}

async function pollAvatar(taskId, intervalMs = 5000, maxAttempts = 120, actRow = null) {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, intervalMs));
    const r = await fetch(`/api/audio/avatar/status/${taskId}`);
    const d = await r.json();
    if (d.state === 'success') { actRow?.setVideo?.(d.videoPath); actRow?.finalize?.('✅ Аватар'); return d.videoPath; }
    if (d.state === 'failed')  { actRow?.finalize?.('❌ Аватар'); throw new Error(d.error || 'Avatar failed'); }
  }
  actRow?.finalize?.('❌ Аватар таймаут');
  throw new Error('Таймаут аватара');
}

// ── Rerun avatar for a specific cell — callable from Склейка ──────────────
// newImagePath: optional override; if omitted, uses cell.imagePath / cell.charImagePath
// onProgress(msg): optional status callback
window.rerunAvatarForCell = async function(sessionKey, cellIdx, newImagePath, onProgress) {
  const frozen = editFrozenSessions[sessionKey];
  if (!frozen || !frozen.cells) return { success: false, error: 'Сессия не найдена' };
  const cell = frozen.cells[cellIdx];
  if (!cell || !cell.audioPath) return { success: false, error: 'Нет аудио для этого фрагмента' };

  if (newImagePath) {
    cell.imagePath = newImagePath;
    cell.charImagePath = newImagePath;
    saveEditState();
  }

  const imgPath = cell.imagePath || cell.charImagePath;
  if (!imgPath) return { success: false, error: 'Нет изображения для аватара' };

  const videoParams   = getEngineParams?.('kling/ai-avatar-pro') || {};
  const defaultPrompt = videoParams.prompt || 'Natural speaking motion with subtle head movement and relaxed posture';

  onProgress?.('Генерируем промпт…');
  let prompt = defaultPrompt;
  try {
    const pr = await fetch('/api/audio/avatar-prompt', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imagePath: imgPath, text: cell.line, detailImagePath: cell.detInfo?.path || null }),
    });
    const pd = await pr.json();
    if (pd.success && pd.prompt) prompt = pd.prompt;
  } catch {}

  // Clear old video, mark pending
  delete cell.videoPath;
  cell.videoError = null;
  cell._videoPending = true;
  saveEditState();

  try {
    onProgress?.('Запускаем аватар…');
    const r = await fetch('/api/audio/avatar', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imagePath: imgPath, audioPath: cell.audioPath, prompt, videoParams }),
    });
    const d = await r.json();
    if (!d.success) throw new Error(d.error);
    cell.avatarTaskId  = d.taskId;
    cell._videoPending = true;
    saveEditState();
    onProgress?.('Ожидаем результат…');
    const videoPath = await pollAvatar(d.taskId);
    cell.videoPath = videoPath; cell.videoError = null;
    delete cell.avatarTaskId; delete cell._videoPending;
    saveEditState();
    renderMontagePanel?.(); renderAllTimelines?.();
    // Trigger edit panel re-render if open
    const _editEl = document.getElementById('scen-panel-edit');
    const _sklEl  = document.getElementById('l1-skleyka');
    if (_editEl?.classList.contains('active') && _sklEl?.classList.contains('active')) {
      renderEditPanel?.();
    } else {
      window._editPanelNeedsRender = true;
    }
    return { success: true, videoPath };
  } catch (err) {
    cell.videoError = err.message;
    delete cell.avatarTaskId; delete cell._videoPending;
    saveEditState();
    renderMontagePanel?.(); renderAllTimelines?.();
    return { success: false, error: err.message };
  }
};

// Expose polling helpers so scen-timeline.js can use them in Склейка Реран popup
window.pollTask   = pollTask;
window.pollTts    = pollTts;
window.pollAvatar = pollAvatar;
