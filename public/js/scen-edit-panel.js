/* scen-edit-panel.js — buildFrozenRow, renderEditPanel (with runGen + runSingleAvatar inside), doAnalyze, pollTask/pollTts/pollAvatar */

// ── Helper: build a frozen results row from a saved session ──────────────────
function buildFrozenRow(session, onReran, obraz, onRetryVideo) {
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:6px;overflow-x:auto;padding-bottom:4px;';

  // All character image variants for this obraz (used for lightbox slider)
  const charImages = obraz
    ? [obraz.char, ...(obraz.variations || []).filter(v => v && v !== 'error')].filter(Boolean)
    : null;

  session.cells.forEach((cell, i) => {
    const c = document.createElement('div');
    c.style.cssText = 'flex-shrink:0;width:66px;display:flex;flex-direction:column;align-items:center;gap:2px;';

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
      img.addEventListener('click', () => openImagePicker(
        cell.generatedImages?.length ? cell.generatedImages : (charImages?.length ? charImages : [cell.imagePath]),
        img, cell.imagePath, selected => {
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

    const reranBtn = document.createElement('button');
    reranBtn.textContent = '↺';
    reranBtn.title = 'Реран (рандомный промпт)';
    reranBtn.style.cssText = `width:66px;font-size:9px;padding:1px 0;margin-top:1px;cursor:pointer;${(!cell.detInfo || !cell.imagePath) ? 'display:none;' : ''}`;
    reranBtn.addEventListener('click', () => onReran(i, imgBox, reranBtn));

    const txt = document.createElement('div');
    txt.style.cssText = 'font-size:8px;color:#444;text-align:center;line-height:1.3;max-width:66px;word-break:break-word;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;';
    txt.textContent = cell.line;

    // Video container — pre-populate if videoPath, avatarTaskId, or videoError already stored
    const videoContainer = document.createElement('div');
    videoContainer.style.cssText = 'width:66px;margin-top:2px;' + (cell.videoPath || cell.avatarTaskId || cell.videoError ? '' : 'display:none;');
    if (cell.videoPath) {
      const vid = document.createElement('video');
      vid.controls = true; vid.src = cell.videoPath;
      vid.style.cssText = 'width:66px;';
      videoContainer.appendChild(vid);
    } else if (cell.avatarTaskId) {
      videoContainer.innerHTML = '<span style="font-size:8px;color:#888;">⏳ видео…</span>';
    } else if (cell.videoError) {
      const errSpan = document.createElement('span');
      errSpan.textContent = '❌ Видео'; errSpan.style.cssText = 'font-size:8px;color:#aa0000;';
      videoContainer.appendChild(errSpan);
      if (onRetryVideo) {
        const retryBtn = document.createElement('button');
        retryBtn.textContent = '↺ Повтор';
        retryBtn.title = 'Повторить генерацию видео';
        retryBtn.style.cssText = 'font-size:8px;padding:1px 3px;cursor:pointer;display:block;width:100%;margin-top:2px;';
        retryBtn.addEventListener('click', () => onRetryVideo(i, videoContainer, cell));
        videoContainer.appendChild(retryBtn);
      }
    }

    c.appendChild(num); c.appendChild(imgBox); c.appendChild(reranBtn); c.appendChild(txt);
    c.appendChild(videoContainer);
    row.appendChild(c);
    cell._imgBox         = imgBox;
    cell._reranBtn       = reranBtn;
    cell._videoContainer = videoContainer;
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

    const projectDate = frozen?.date ? new Date(frozen.date) : null;
    const projectDateStr = projectDate
      ? projectDate.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
      : new Date().toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const projNum = _getSessionNum(sessionKey, sessionData);
    const projectTitle = `${projectDateStr} — ${projNum} — ${f.name} — ${activeObraz.name}`;

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

    // ── Activate button ──
    const isActiveProj = getActiveProjectKey() === sessionKey;
    const activateBtn = document.createElement('button');
    activateBtn.textContent = isActiveProj ? '★' : '☆';
    activateBtn.title = isActiveProj ? 'Деактивировать' : 'Активировать проект';
    activateBtn.style.cssText =
      `font-size:12px;padding:0 4px;cursor:pointer;flex-shrink:0;border:none;background:transparent;` +
      `color:${isActiveProj ? '#cc8800' : '#888'};`;
    activateBtn.addEventListener('click', e => {
      e.stopPropagation();
      const wasActive = getActiveProjectKey() === sessionKey;
      setActiveProjectKey(wasActive ? '' : sessionKey);
      renderEditPanel();
    });

    // ── Copy button ──
    const copyProjBtn = document.createElement('button');
    copyProjBtn.textContent = 'copy';
    copyProjBtn.title = 'Скопировать название проекта';
    copyProjBtn.style.cssText = 'font-size:9px;padding:1px 5px;cursor:pointer;flex-shrink:0;';
    copyProjBtn.addEventListener('click', e => {
      e.stopPropagation();
      navigator.clipboard.writeText(projectTitle).then(() => {
        copyProjBtn.textContent = '✓';
        setTimeout(() => { copyProjBtn.textContent = 'copy'; }, 1500);
      });
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
    projectToggle.appendChild(copyProjBtn);
    projectToggle.appendChild(delProjBtn);

    if (isActiveProj) projectWrap.style.outline = '2px solid #cc8800';

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
    [['nano-banana-pro','NB Pro'],['qwen2','Qwen2'],['seedream','Seed']].forEach(([v,l]) => {
      const o = document.createElement('option'); o.value = v; o.textContent = l; engineSel.appendChild(o);
    });
    const engineStorageKey = `edit_engine__${sessionKey}`;
    engineSel.value = localStorage.getItem(engineStorageKey) || getImageEngine?.() || 'nano-banana-pro';
    engineSel.addEventListener('change', () => localStorage.setItem(engineStorageKey, engineSel.value));

    // Per-project voice selector
    const voiceSel = document.createElement('select');
    voiceSel.title = 'Голос для TTS этого проекта';
    voiceSel.style.cssText = 'font-size:9px;height:22px;padding:0 2px;width:100%;';
    const voiceStorageKey = `edit_voice__${sessionKey}`;
    // Migrate old stored value that may be a voice ID → resolve to name
    const _rawSaved = localStorage.getItem(voiceStorageKey) || activeObraz?.voice || 'Rachel';
    const _svByName = (window.ELEVENLABS_VOICES || []).find(v => v.name === _rawSaved);
    const _svById   = (window.ELEVENLABS_VOICES || []).find(v => v.id  === _rawSaved);
    const savedVoice = (_svByName || _svById)?.name || _rawSaved;
    const sortedVoices = [...(window.ELEVENLABS_VOICES || [])].sort((a, b) => (b.desc ? 1 : 0) - (a.desc ? 1 : 0));
    sortedVoices.forEach(v => {
      const o = document.createElement('option');
      o.value = v.name;   // always name — kie.ai only accepts names
      o.textContent = v.name + (v.desc ? ` — ${v.desc}` : '');
      if (v.name === savedVoice) o.selected = true;
      voiceSel.appendChild(o);
    });
    voiceSel.addEventListener('change', () => localStorage.setItem(voiceStorageKey, voiceSel.value));
    const getProjectVoice = () => voiceSel.value || savedVoice;

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
      removeEditProject(sessionKey);
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
    hdrLeft.appendChild(voiceSel);

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

    const btnRow2 = document.createElement('div');
    btnRow2.style.cssText = 'display:flex;gap:3px;';
    btnRow2.appendChild(ttsBtn);

    hdrRight.appendChild(btnRow1);
    hdrRight.appendChild(btnRow2);

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
        const imgPath = cell.imagePath || cell.charImagePath;
        if (!imgPath || !cell.audioPath) return;

        vc.style.display = '';
        vc.innerHTML = '<span style="font-size:8px;color:#888;">⏳</span>';

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
          const vid = document.createElement('video');
          vid.controls = true; vid.src = videoPath; vid.style.cssText = 'width:66px;';
          vc.appendChild(vid);
          renderMontagePanel(); renderAllTimelines();
        } catch (err) {
          delete cell.avatarTaskId; delete cell._videoPending; saveEditState();
          showVideoError(err.message);
        }
      };

      const frozenRow = buildFrozenRow(frozen, (cellIdx, imgBox, reranBtn) => {
        const cell = frozen.cells[cellIdx];
        if (!cell?.detInfo) return;
        runGen(imgBox, reranBtn, cell.detInfo, `${sessionKey}__${cellIdx}`, true, cellIdx, cell.charImagePath);
      }, frozenObraz, (idx, vc, cell) => runSingleAvatar(cell, vc, idx));
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
      голосаArrow.textContent = '▶'; голосаArrow.style.cssText = 'font-size:9px;color:#555;flex-shrink:0;';
      const голосаLabel = document.createElement('span');
      голосаLabel.style.cssText = 'font-size:10px;font-weight:bold;color:#333;';
      голосаLabel.textContent = 'Голоса';
      голосаHeader.appendChild(голосаArrow); голосаHeader.appendChild(голосаLabel);

      const голосаBody = document.createElement('div');
      голосаBody.style.cssText = 'display:none;padding:2px 0;';

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
              body: JSON.stringify({ text: newText, voice: getProjectVoice(), ttsParams: getEngineParams?.('elevenlabs/text-to-speech-turbo-2-5') || {} }),
            });
            const d = await r.json();
            if (!d.success) throw new Error(d.error);
            const audioPath = await pollTts(d.taskId);
            cell.audioPath = audioPath; delete cell.audioError; saveEditState();
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

        rowEl.appendChild(numEl); rowEl.appendChild(audioArea); rowEl.appendChild(textEl); rowEl.appendChild(remakeBtn);
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
      });
      block.appendChild(говорящаяГоловаBtn);

      // ── TTS "Голоса" button handler — auto-expands panel, updates audioArea per cell ──
      ttsBtn.disabled = false;
      ttsBtn.addEventListener('click', async () => {
        const voice = getProjectVoice();
        ttsBtn.disabled = true; ttsBtn.textContent = '⏳';
        // Auto-expand the голоса panel to show progress
        голосаBody.style.display = ''; голосаArrow.textContent = '▼';
        await Promise.all(frozen.cells.map(async (cell) => {
          if (cell.audioPath) return;
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
                  body: JSON.stringify({ text: cell.line, voice: getProjectVoice(), ttsParams: getEngineParams?.('elevenlabs/text-to-speech-turbo-2-5') || {} }),
                });
                const d2 = await r2.json();
                if (!d2.success) throw new Error(d2.error);
                const ap = await pollTts(d2.taskId);
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
              body: JSON.stringify({ text: cell.line, voice, ttsParams: getEngineParams?.('elevenlabs/text-to-speech-turbo-2-5') || {} }),
            });
            const d = await r.json();
            if (!d.success) throw new Error(d.error);
            const audioPath = await pollTts(d.taskId);
            cell.audioPath = audioPath; delete cell.audioError; saveEditState();
            if (container) {
              container.innerHTML = '';
              const aud = document.createElement('audio');
              aud.controls = true; aud.src = audioPath; aud.style.cssText = 'height:24px;width:110px;';
              container.appendChild(aud);
            }
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

          // ── Show/hide sel / poseSel dropdowns ─────────────────────────────
          sel.style.display     = detailInfo ? '' : 'none';
          poseSel.style.display = detailInfo ? 'none' : '';
          genaBtn.title = detailInfo ? 'Сгенерировать это изображение' : 'Сгенерировать с выбранной позой';

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

      // Pose dropdown — only shown when NO detail is assigned
      const poseSel = document.createElement('select');
      poseSel.style.cssText = 'width:66px;font-size:8px;margin-top:1px;' + (detailInfo ? 'display:none;' : '');
      EDIT_POSE_OPTIONS.forEach(o => {
        const opt = document.createElement('option');
        opt.value = o.value; opt.textContent = o.label;
        poseSel.appendChild(opt);
      });

      const txt = document.createElement('div');
      txt.style.cssText = 'font-size:8px;color:#444;text-align:center;line-height:1.3;max-width:66px;word-break:break-word;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;';
      txt.textContent = line;

      // ── Гена button ──
      const genaBtn = document.createElement('button');
      genaBtn.textContent = 'Гена';
      genaBtn.style.cssText = 'width:66px;font-size:8px;padding:1px 0;margin-top:1px;cursor:pointer;';
      genaBtn.title = detailInfo ? 'Сгенерировать это изображение' : 'Сгенерировать с выбранной позой';

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
          genaBtn.addEventListener('click', () => {
            runGen(obrazBox, genaBtn, detailInfo, cardKey, true, i, lineImages[i]);
          });
        } else {
          genaBtn.addEventListener('click', () => {
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
          });
        }
      } else {
        // Without detail: generate pose variation
        const poseCardKey = `${f.file}__${i}__pose`;
        if (editCardCache[poseCardKey]) {
          // Restore cached pose result immediately
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
          genaBtn.textContent = '↺';
        }
        genaBtn.addEventListener('click', () => {
          const poseKey = poseSel.value;
          if (!poseKey) { setStatus('Выберите позу в дропдауне'); return; }
          runEditPose(obrazBox, genaBtn, lineImages[i], poseKey, poseCardKey, activeObraz.id, engineSel.value);
        });
      }

      card.appendChild(num); card.appendChild(obrazBox); card.appendChild(detailBox);
      card.appendChild(sel); card.appendChild(poseSel); card.appendChild(genaBtn); card.appendChild(txt);
      cardsRow.appendChild(card);
    });

    block.appendChild(cardsRow);

    // ── Shared runGen: with retry, freeze update, reran support ──
    async function runGen(imgBox, reranBtn, detInfo, cardKey, useRandomPrompt, cellIdx, charImagePath) {
      const imageEngine = engineSel.value || getImageEngine?.() || 'nano-banana-pro';
      const activePath  = charImagePath || activeObraz.char;
      imgBox.style.cssText = 'width:62px;height:82px;border:1px solid #808080;background:#ddd;overflow:hidden;flex-shrink:0;display:flex;align-items:center;justify-content:center;';
      imgBox.innerHTML = '<span style="font-size:9px;color:#888;">⏳</span>';
      if (reranBtn) reranBtn.disabled = true;

      let interactionPrompt = '';
      if (!useRandomPrompt) {
        const selEntry = cardSelects.find(s => s.cardKey === cardKey);
        const selIdx   = selEntry ? Number(selEntry.sel.value) : 0;
        interactionPrompt = getMergedOptions(f.file)[selIdx]?.prompt || '';
      }

      const MAX_RETRIES = 3;
      let lastErr = null;
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          const gr = await fetch('/api/asset-interact/generate', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              activePath, assetPath: detInfo.path,
              prompt: interactionPrompt, assetType: 'detail', imageEngine,
              engineParams: getEngineParams?.(imageEngine) || {},
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

          const imagePath = await pollTask(gd.taskId);

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
          addObrazEditResult?.(activeObraz.id, imagePath);
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

        const txt = document.createElement('div');
        txt.style.cssText = 'font-size:8px;color:#444;text-align:center;line-height:1.3;max-width:66px;word-break:break-word;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;';
        txt.textContent = cell.line;
        c.appendChild(num); c.appendChild(imgBox);
        if (reranBtn) c.appendChild(reranBtn);
        c.appendChild(txt);
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

  // ── Archived projects section ─────────────────────────────────────────────
  const archiveList = loadEditArchive();
  if (archiveList.length) {
    const archSec = document.createElement('div');
    archSec.style.cssText = 'margin-top:12px;border-top:1px solid #808080;padding-top:6px;';

    const archToggle = document.createElement('div');
    archToggle.style.cssText =
      'display:flex;align-items:center;gap:6px;cursor:pointer;user-select:none;margin-bottom:4px;';
    const archArrow = document.createElement('span');
    archArrow.textContent = '▶';
    archArrow.style.cssText = 'font-size:9px;color:#555;flex-shrink:0;';
    const archLabel = document.createElement('span');
    archLabel.style.cssText = 'font-size:10px;font-weight:bold;color:#555;';
    archLabel.textContent = `Архив проектов (${archiveList.length})`;
    archToggle.appendChild(archArrow);
    archToggle.appendChild(archLabel);

    const archBody = document.createElement('div');
    archBody.style.cssText = 'display:none;';
    archToggle.addEventListener('click', () => {
      const open = archBody.style.display === 'none';
      archBody.style.display = open ? '' : 'none';
      archArrow.textContent = open ? '▼' : '▶';
    });

    archiveList.forEach(item => {
      const row = document.createElement('div');
      row.style.cssText =
        'display:flex;align-items:center;gap:6px;padding:3px 0;border-bottom:1px solid #d0d0d0;';

      if (item.obrazChar) {
        const thumbImg = document.createElement('img');
        thumbImg.src = item.obrazChar;
        thumbImg.style.cssText =
          'width:30px;height:40px;object-fit:cover;flex-shrink:0;border:1px solid #808080;';
        thumbImg.onerror = () => { thumbImg.style.display = 'none'; };
        row.appendChild(thumbImg);
      }

      const dateStr = new Date(item.date).toLocaleDateString('ru-RU',
        { day: '2-digit', month: '2-digit', year: 'numeric' });
      const textEl = document.createElement('span');
      textEl.style.cssText =
        'flex:1;font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#444;';
      textEl.textContent = `${dateStr} — ${item.scenName} — ${item.obrazName}`;
      textEl.title = textEl.textContent;
      row.appendChild(textEl);

      const restoreBtn = document.createElement('button');
      restoreBtn.textContent = '↩ restore';
      restoreBtn.style.cssText = 'font-size:9px;padding:1px 6px;cursor:pointer;flex-shrink:0;';
      restoreBtn.addEventListener('click', () => {
        if (item.session) {
          editFrozenSessions[item.sessionKey] = item.session;
          saveEditState();
        }
        saveEditArchive(loadEditArchive().filter(a => a.id !== item.id));
        renderEditPanel();
      });
      row.appendChild(restoreBtn);

      archBody.appendChild(row);
    });

    archSec.appendChild(archToggle);
    archSec.appendChild(archBody);
    panel.appendChild(archSec);
  }
}

// ── Shared analyze handler ────────────────────────────────────────────────────
// sessionAssignments: the assignments stored in the session body (primary source).
// Falls back to the global scenarioAssignments map for any key not found there.
async function doAnalyze(analyzeBtn, lines, activeObraz, f, cardSelects, sessionAssignments = {}) {
  analyzeBtn.disabled = true; analyzeBtn.textContent = '⏳';
  setStatus('Анализирую взаимодействия…');
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
  } catch (err) {
    setStatus('Ошибка анализа: ' + err.message);
  } finally {
    analyzeBtn.disabled = false; analyzeBtn.textContent = '🔍';
  }
}

// ── Poll task until success/failed ────────────────────────────────────────────
async function pollTask(taskId, intervalMs = 3000, maxAttempts = 120) {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, intervalMs));
    const r = await fetch(`/api/asset-interact/status/${taskId}`);
    const d = await r.json();
    if (d.state === 'success') return d.imagePath;
    if (d.state === 'failed')  throw new Error(d.error || 'failed');
  }
  throw new Error('Таймаут генерации');
}

async function pollTts(taskId, intervalMs = 3000, maxAttempts = 120) {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, intervalMs));
    const r = await fetch(`/api/audio/tts/status/${taskId}`);
    const d = await r.json();
    if (d.state === 'success') return d.audioPath;
    if (d.state === 'failed')  throw new Error(d.error || 'TTS failed');
  }
  throw new Error('Таймаут TTS');
}

async function pollAvatar(taskId, intervalMs = 5000, maxAttempts = 120) {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, intervalMs));
    const r = await fetch(`/api/audio/avatar/status/${taskId}`);
    const d = await r.json();
    if (d.state === 'success') return d.videoPath;
    if (d.state === 'failed')  throw new Error(d.error || 'Avatar failed');
  }
  throw new Error('Таймаут аватара');
}
