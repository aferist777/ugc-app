/* scen-edit-panel.js — buildCellComponent (per-cell component factory), renderEditPanel (with runGen + runSingleAvatar inside), doAnalyze, pollTask/pollTts/pollAvatar */

// ── Per-session voice preview cache (voice name → audio URL) ─────────────────
const _voicePreviewCache = new Map();

// ── Global generation lock — tracks cells being individually generated ─────────
// Key: `${sessionKey}__${cellIdx}`. Persists across renderEditPanel calls.
// Used to defer panel re-renders and prevent bulk-gen from touching active cells.
const _editCellsRunning = new Set();

// ── Global negative prompt (persisted forever, appended on save) ──────────────
function getEditNegativePrompt() {
  try { return localStorage.getItem('edit_negative_prompt_v1') || ''; } catch { return ''; }
}
function setEditNegativePrompt(val) {
  try { localStorage.setItem('edit_negative_prompt_v1', val); } catch {}
}

// ── Video thumbnail: first-frame canvas + ▶ overlay, click → popup ───────────
function _buildVideoThumb(src) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:relative;width:66px;cursor:pointer;flex-shrink:0;';
  wrap.title = 'Click to preview';

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


// ── Эдит projects bar (top of panel, like Склейка's saved-projects bar) ────────
function _buildEditProjectsBar() {
  const bar = document.createElement('div');
  bar.style.cssText = 'display:flex;align-items:center;gap:6px;padding:5px 8px;background:#b8b4aa;border-bottom:2px solid #808080;flex-wrap:wrap;';

  // All sessions sorted newest first (including hidden)
  const allSess = Object.entries(editFrozenSessions)
    .sort(([, a], [, b]) => new Date(b.date || 0) - new Date(a.date || 0));

  if (!allSess.length) {
    bar.style.display = 'none';
    return bar;
  }

  const savedKeys = new Set((typeof getSavedProjects === 'function' ? getSavedProjects() : []).map(p => p.sessionKey));

  const lbl = document.createElement('span');
  lbl.style.cssText = 'font-size:11px;font-weight:bold;flex-shrink:0;';
  lbl.textContent = '📁 Projects:';
  bar.appendChild(lbl);

  const sel = document.createElement('select');
  sel.style.cssText = 'font-size:11px;flex:1;min-width:160px;max-width:420px;';
  const _allObrazы = getObrazы?.() || [];
  const _obrazCount = {};
  allSess.forEach(([, sess]) => {
    const n = _allObrazы.find(o => String(o.id) === String(sess.obrazId))?.name || '';
    if (n) _obrazCount[n] = (_obrazCount[n] || 0) + 1;
  });
  const _obrazSeen = {};
  allSess.forEach(([key, sess]) => {
    const opt = document.createElement('option');
    opt.value = key;
    const _dateObj = sess.date ? new Date(sess.date) : null;
    const _dateStr = _dateObj ? _dateObj.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
    const _timeStr = _dateObj ? _dateObj.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
    const _scenName = scenarioFiles.find(sf => sf.file === sess.scenFile)?.name || (sess.scenFile || '').replace(/\.txt$/, '');
    const _rawObraz = _allObrazы.find(o => String(o.id) === String(sess.obrazId))?.name || '';
    _obrazSeen[_rawObraz] = (_obrazSeen[_rawObraz] || 0) + 1;
    const _obrazName = _rawObraz && _obrazCount[_rawObraz] > 1 ? `${_rawObraz} #${_obrazSeen[_rawObraz]}` : _rawObraz;
    const dispName = [_dateStr, _timeStr, _scenName, _obrazName].filter(Boolean).join(' — ') || (sess.title || key);
    const cellCount = Array.isArray(sess.cells) ? sess.cells.length : 0;
    const isPending = !!sess.pending;
    const isHidden  = !!sess.hiddenFromEdit;
    const isLinked  = savedKeys.has(key);
    const tag = isPending ? ' [new]' : isHidden ? ' [closed]' : ` [${cellCount} fr.]`;
    const link = isLinked ? ' 💾' : '';
    opt.textContent = `${dispName}${tag}${link}`;
    if (isHidden) opt.style.color = '#888';
    sel.appendChild(opt);
  });
  // Prefer first non-hidden session
  const firstOpen = allSess.find(([, s]) => !s.hiddenFromEdit);
  if (firstOpen) sel.value = firstOpen[0];
  bar.appendChild(sel);

  // "Открыть" — un-hide if hidden
  const openBtn = document.createElement('button');
  openBtn.textContent = '↩ Open';
  openBtn.style.cssText = 'font-size:11px;padding:2px 8px;cursor:pointer;flex-shrink:0;';
  openBtn.addEventListener('click', () => {
    const key = sel.value;
    if (!key || !editFrozenSessions[key]) return;
    editFrozenSessions[key].hiddenFromEdit = false;
    // Opening in Эдит hides from Склейка — each panel controls its own visibility
    const _closed = getSkleykaClosed();
    _closed.add(key);
    saveSkleykaClosed(_closed);
    saveEditState();
    renderEditPanel();
  });
  bar.appendChild(openBtn);


  // "Удалить" — permanently delete from editFrozenSessions (with confirmation)
  const delBtn = document.createElement('button');
  delBtn.textContent = '🗑';
  delBtn.title = 'Delete project permanently';
  delBtn.style.cssText = 'font-size:11px;padding:2px 7px;cursor:pointer;color:#aa0000;background:#f8e8e8;border:1px solid #c05050;flex-shrink:0;';
  delBtn.addEventListener('click', () => {
    if (delBtn.dataset.confirm !== '1') {
      delBtn.dataset.confirm = '1';
      delBtn.textContent = '?';
      delBtn.style.background = '#ffcccc';
      setTimeout(() => { if (delBtn.dataset.confirm) { delBtn.dataset.confirm = ''; delBtn.textContent = '🗑'; delBtn.style.background = '#f8e8e8'; } }, 3000);
      return;
    }
    delBtn.dataset.confirm = '';
    const key = sel.value;
    if (!key || !editFrozenSessions[key]) return;
    delete editFrozenSessions[key];
    // Clean up related state
    Object.keys(editCardCache || {}).forEach(k => { if (k.startsWith(key + '__')) delete editCardCache[k]; });
    const lv = _loadEditLastVisible?.();
    if (lv) { lv.delete(key); _saveEditLastVisible?.(lv); }
    saveEditState();
    populateTemplateSelect?.();
    renderEditPanel();
  });
  bar.appendChild(delBtn);

  return bar;
}

function _editCloseWithSavePrompt(sessionKey, sess) {
  const existing = document.getElementById('edit-close-modal');
  if (existing) existing.remove();

  const scenName = sess.title || (sess.scenFile || sessionKey).replace(/\.txt$/, '');
  const overlay = document.createElement('div');
  overlay.id = 'edit-close-modal';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9800;display:flex;align-items:center;justify-content:center;';

  const box = document.createElement('div');
  box.style.cssText = 'background:#c0c0c0;border:2px solid;border-color:#fff #808080 #808080 #fff;padding:16px 20px;min-width:280px;max-width:420px;';

  const title = document.createElement('div');
  title.style.cssText = 'font-size:12px;font-weight:bold;margin-bottom:10px;';
  title.textContent = `Close "${scenName}"?`;
  box.appendChild(title);

  const msg = document.createElement('div');
  msg.style.cssText = 'font-size:11px;color:#444;margin-bottom:14px;';
  msg.textContent = 'Save a project snapshot before closing? Saved projects are available in Merge for restoration.';
  box.appendChild(msg);

  const btnsRow = document.createElement('div');
  btnsRow.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;';

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.cssText = 'font-size:11px;padding:3px 12px;cursor:pointer;';
  cancelBtn.addEventListener('click', () => overlay.remove());

  const closeNoSaveBtn = document.createElement('button');
  closeNoSaveBtn.textContent = 'Close';
  closeNoSaveBtn.style.cssText = 'font-size:11px;padding:3px 12px;cursor:pointer;';
  closeNoSaveBtn.addEventListener('click', () => {
    overlay.remove();
    editFrozenSessions[sessionKey].hiddenFromEdit = true;
    saveEditState();
    renderEditPanel();
  });

  const saveCloseBtn = document.createElement('button');
  saveCloseBtn.textContent = '💾 Save and close';
  saveCloseBtn.style.cssText = 'font-size:11px;padding:3px 12px;cursor:pointer;background:#000080;color:#fff;border:2px solid;border-color:#6060c0 #000040 #000040 #6060c0;';
  saveCloseBtn.addEventListener('click', () => {
    overlay.remove();
    if (typeof saveProjectSnapshot === 'function') {
      const tlData = (typeof getTimelineData === 'function') ? getTimelineData() : {};
      const title = (sess.title) || (sess.scenFile || sessionKey).replace(/\.txt$/, '');
      saveProjectSnapshot(sessionKey, title);
    }
    editFrozenSessions[sessionKey].hiddenFromEdit = true;
    saveEditState();
    populateTemplateSelect?.();
    if (typeof renderAllTimelines === 'function') renderAllTimelines();
    renderEditPanel();
  });

  btnsRow.appendChild(cancelBtn);
  btnsRow.appendChild(closeNoSaveBtn);
  btnsRow.appendChild(saveCloseBtn);
  box.appendChild(btnsRow);
  overlay.appendChild(box);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

// ── Tracks which project dropdowns are open (survives re-renders) ────────────
let _editExpandedSessions = new Set();

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
  // Defer re-render while any cell is actively generating — avoids destroying in-progress DOM
  if (_editCellsRunning.size > 0) {
    window._editPanelNeedsRender = true;
    return;
  }
  window._editPanelNeedsRender = false;

  // Ensure detail files are cached — they may be missing if this render was triggered
  // before loadScenarios()/loadDetails() completed (e.g., resumeEditPendingCells on load).
  if (!cachedDetailFiles.length) {
    try {
      const _dd = await fetch('/api/details').then(r => r.json());
      if (_dd.success) cachedDetailFiles = _dd.files || [];
    } catch {}
  }

  panel.innerHTML = '';

  // ── Projects bar at the top of Эдит ─────────────────────────────────────────
  panel.appendChild(_buildEditProjectsBar());

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
    msg.textContent = 'Select an outfit and click "Create"';
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
    const _projDateStr = _projDateObj.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const _projTimeStr = _projDateObj.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
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
      ? 'Remove from Merge'
      : avatarsDone
        ? 'Add to Merge'
        : 'Available after all Talking head videos are generated';
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
    delProjBtn.title = 'Hide from Edit (project stays in Merge)';
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

    // Frozen sessions expand by default; pending sessions start collapsed.
    // User-toggled state (stored in _editExpandedSessions) always wins.
    const _defaultExpanded = frozen && !_editExpandedSessions._userCollapsed?.has(sessionKey);
    const _shouldExpand = _editExpandedSessions.has(sessionKey) || _defaultExpanded;
    if (_shouldExpand) {
      projectBody.style.display = '';
      projectArrow.textContent = '▼';
      if (firstCellImg) hdrThumb.style.display = 'none';
      _editExpandedSessions.add(sessionKey);
    } else {
      projectArrow.textContent = '▶';
    }

    projectToggle.addEventListener('click', () => {
      const open = projectBody.style.display === 'none';
      projectBody.style.display = open ? '' : 'none';
      projectArrow.textContent = open ? '▼' : '▶';
      if (firstCellImg) hdrThumb.style.display = open ? 'none' : 'block';
      if (open) {
        _editExpandedSessions.add(sessionKey);
        if (_editExpandedSessions._userCollapsed) _editExpandedSessions._userCollapsed.delete(sessionKey);
      } else {
        _editExpandedSessions.delete(sessionKey);
        if (!_editExpandedSessions._userCollapsed) _editExpandedSessions._userCollapsed = new Set();
        _editExpandedSessions._userCollapsed.add(sessionKey);
      }
    });

    projectWrap.appendChild(projectToggle);
    projectWrap.appendChild(projectBody);

    const block = document.createElement('div');
    block.style.cssText = 'margin-bottom:0;';

    // ── Project controls header ──
    const hdr = document.createElement('div');

    // Per-project engine selector (row 2)
    const engineSel = document.createElement('select');
    engineSel.style.cssText = 'font-size:9px;height:22px;padding:0 2px;flex:1;min-width:0;';
    engineSel.title = 'Engine for this project';
    [['nano-banana-2','NB Pro i2i'],['qwen2','Qwen2 i2i'],['seedream','Seedream i2i'],['gptimage2','GPT-Img2 i2i']].forEach(([v,l]) => {
      const o = document.createElement('option'); o.value = v; o.textContent = l; engineSel.appendChild(o);
    });
    const engineStorageKey = `edit_engine__${sessionKey}`;
    engineSel.value = localStorage.getItem(engineStorageKey) || 'seedream';
    engineSel.addEventListener('change', () => localStorage.setItem(engineStorageKey, engineSel.value));

    // Negative-prompt button
    const negPromptBtn = document.createElement('button');
    negPromptBtn.textContent = '{}';
    negPromptBtn.title = 'Image generation settings (Negative prompt)';
    const _applyNegBtnColor = (val) => {
      negPromptBtn.style.cssText = `font-size:9px;height:22px;padding:0 4px;border:1px solid #555;border-radius:3px;cursor:pointer;background:${val ? '#b85c00' : '#333'};color:#fff;flex-shrink:0;`;
    };
    // Init color from server
    fetch('/api/settings').then(r => r.json()).then(d => _applyNegBtnColor(d.settings?.editNegativePrompt || '')).catch(() => {});

    negPromptBtn.addEventListener('click', () => {
      const _ex = document.getElementById('edit-neg-prompt-popup');
      if (_ex) { _ex.remove(); return; }

      const popup = document.createElement('div');
      popup.id = 'edit-neg-prompt-popup';
      popup.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:9999;' +
        'background:#1e1e1e;border:1px solid #555;border-radius:6px;padding:14px;width:380px;box-shadow:0 4px 20px rgba(0,0,0,0.7);';

      const title = document.createElement('div');
      title.textContent = 'Image generation settings';
      title.style.cssText = 'font-size:11px;font-weight:bold;color:#ccc;margin-bottom:10px;';
      popup.appendChild(title);

      const label = document.createElement('div');
      label.textContent = 'Negative prompt';
      label.style.cssText = 'font-size:9px;color:#888;margin-bottom:4px;';
      popup.appendChild(label);

      const hint = document.createElement('div');
      hint.textContent = 'What should not appear in generations. Appended to analysis and to the final prompt.';
      hint.style.cssText = 'font-size:8px;color:#666;margin-bottom:6px;line-height:1.4;';
      popup.appendChild(hint);

      const ta = document.createElement('textarea');
      ta.value = ''; ta.placeholder = 'Loading…';
      ta.style.cssText = 'width:100%;box-sizing:border-box;height:100px;font-size:9px;background:#111;color:#ddd;' +
        'border:1px solid #555;border-radius:3px;padding:6px;resize:vertical;';
      popup.appendChild(ta);

      // Load current value from server
      fetch('/api/settings').then(r => r.json()).then(d => {
        ta.value = d.settings?.editNegativePrompt || '';
        ta.placeholder = 'E.g.: blurry, watermark, extra limbs, text...';
      }).catch(() => { ta.placeholder = 'Load error'; });

      // Auto-save on every keystroke (debounced 600ms)
      let _negSaveTimer = null;
      ta.addEventListener('input', () => {
        clearTimeout(_negSaveTimer);
        _negSaveTimer = setTimeout(() => {
          fetch('/api/settings', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ editNegativePrompt: ta.value.trim() }),
          }).then(() => _applyNegBtnColor(ta.value.trim())).catch(() => {});
        }, 600);
      });

      const btnRow = document.createElement('div');
      btnRow.style.cssText = 'display:flex;gap:6px;margin-top:8px;justify-content:flex-end;';

      const clearBtn = document.createElement('button');
      clearBtn.textContent = 'Clear';
      clearBtn.style.cssText = 'font-size:9px;padding:3px 8px;background:#4a0000;color:#fff;border:1px solid #700;border-radius:3px;cursor:pointer;';
      clearBtn.addEventListener('click', () => { ta.value = ''; });

      const saveBtn = document.createElement('button');
      saveBtn.textContent = 'Save';
      saveBtn.style.cssText = 'font-size:9px;padding:3px 8px;background:#1a5c1a;color:#fff;border:1px solid #2a8a2a;border-radius:3px;cursor:pointer;';
      saveBtn.addEventListener('click', async () => {
        saveBtn.disabled = true; saveBtn.textContent = '⏳';
        try {
          await fetch('/api/settings', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ editNegativePrompt: ta.value.trim() }),
          });
          _applyNegBtnColor(ta.value.trim());
          popup.remove();
        } catch {
          saveBtn.disabled = false; saveBtn.textContent = 'Save';
        }
      });

      const closeBtn = document.createElement('button');
      closeBtn.textContent = '✕';
      closeBtn.style.cssText = 'font-size:9px;padding:3px 8px;background:#333;color:#aaa;border:1px solid #555;border-radius:3px;cursor:pointer;';
      closeBtn.addEventListener('click', () => popup.remove());

      btnRow.appendChild(clearBtn);
      btnRow.appendChild(saveBtn);
      btnRow.appendChild(closeBtn);
      popup.appendChild(btnRow);
      document.body.appendChild(popup);
    });

    // Engine row: [dropdown flex] [{}btn]
    const engineRow = document.createElement('div');
    engineRow.style.cssText = 'display:flex;gap:2px;align-items:center;';
    engineRow.appendChild(engineSel);
    engineRow.appendChild(negPromptBtn);

    // Per-project voice selector
    const voiceSel = document.createElement('select');
    voiceSel.title = 'Voice for TTS of this project';
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
    voicePreviewBtn.title = 'Preview voice';
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
          if (!r.ok) throw new Error(`HTTP ${r.status} — restart server`);
          const d = await r.json();
          if (!d.success) throw new Error(d.error);
          _voicePreviewCache.set(voice, d.audioPath);
          _previewAudio = new Audio(d.audioPath);
          voicePreviewBtn.textContent = '■'; voicePreviewBtn.style.color = '#0070cc'; voicePreviewBtn._playing = true;
          _previewAudio.play();
          _previewAudio.addEventListener('ended', () => { voicePreviewBtn.textContent = '▶'; voicePreviewBtn.style.color = ''; voicePreviewBtn._playing = false; });
        } catch (err) {
          voicePreviewBtn.textContent = '▶';
          setStatus('Voice preview error: ' + err.message);
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
    ttsParamsBtn.title = 'Voice generation settings (overrides global Brain settings)';
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
      title.textContent = 'Voice settings (for this project)';
      title.style.cssText = 'font-weight:bold;margin-bottom:8px;font-size:10px;color:#333;';
      popup.appendChild(title);

      const hint = document.createElement('div');
      hint.textContent = 'Override global settings from Brain';
      hint.style.cssText = 'font-size:9px;color:#808080;margin-bottom:8px;';
      popup.appendChild(hint);

      const PARAMS = [
        { key: 'stability',        label: 'Stability',        min: 0,   max: 1,   step: 0.01, def: 0.65,
          hint: 'Stability: low values — livelier and more emotional, high — more monotone and predictable' },
        { key: 'similarity_boost', label: 'Similarity boost', min: 0,   max: 1,   step: 0.01, def: 0.75,
          hint: 'Similarity to the original voice: high values match the voice timbre more closely' },
        { key: 'style',            label: 'Style',            min: 0,   max: 1,   step: 0.01, def: 0.05,
          hint: 'Expressiveness: amplifies style and intonation, may reduce stability (v2+ only)' },
        { key: 'speed',            label: 'Speed',            min: 0.5, max: 2.0, step: 0.05, def: 1.10,
          hint: 'Speech speed: 0.5 = very slow, 1.0 = normal, 2.0 = very fast' },
      ];

      const vals = {};
      PARAMS.forEach(p => {
        vals[p.key] = current[p.key] ?? global[p.key] ?? p.def;
        const wrap = document.createElement('div');
        wrap.style.cssText = 'margin-bottom:8px;';

        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:6px;';

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

        const hintEl = document.createElement('div');
        hintEl.textContent = p.hint;
        hintEl.style.cssText = 'font-size:8px;color:#777;padding-left:106px;line-height:1.3;margin-top:2px;';

        wrap.appendChild(row);
        wrap.appendChild(hintEl);
        popup.appendChild(wrap);
      });

      const btnRow = document.createElement('div');
      btnRow.style.cssText = 'display:flex;gap:6px;margin-top:10px;justify-content:flex-end;';

      const saveBtn = document.createElement('button');
      saveBtn.textContent = 'Apply';
      saveBtn.style.cssText = 'font-size:10px;padding:3px 8px;cursor:pointer;';
      saveBtn.addEventListener('click', () => {
        saveProjectTtsParams(vals);
        _refreshParamsBtnState();
        popup.remove();
      });

      const resetBtn2 = document.createElement('button');
      resetBtn2.textContent = 'Reset';
      resetBtn2.title = 'Delete project settings, use global settings from Brain';
      resetBtn2.style.cssText = 'font-size:10px;padding:3px 8px;cursor:pointer;color:#aa0000;';
      resetBtn2.addEventListener('click', () => {
        localStorage.removeItem(ttsParamsStorageKey);
        _refreshParamsBtnState();
        popup.remove();
      });

      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = 'Cancel';
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
    ttsBtn.title = 'Generate voices for script lines';
    ttsBtn.style.cssText = 'width:22px;height:22px;padding:0;font-size:10px;flex-shrink:0;cursor:pointer;';
    ttsBtn.disabled = false;

    // generateBtn: internal only (not in DOM) — triggered by pendingActionBtn to freeze session
    const generateBtn = document.createElement('button');
    generateBtn.textContent = '▶';

    hdr.style.cssText = 'display:flex;flex-direction:column;gap:3px;' +
      'margin-bottom:6px;padding-bottom:3px;border-bottom:1px solid #808080;';

    const hdrLeft = document.createElement('div');
    hdrLeft.style.cssText = 'display:flex;flex-direction:column;gap:3px;';
    hdrLeft.appendChild(engineRow);

    let _handleGenVoices = null;
    let _genVoicesRunning = false, _genVoicesAbort = false;

    const voiceRow = document.createElement('div');
    voiceRow.style.cssText = 'display:flex;gap:2px;align-items:center;';
    voiceSel.style.cssText = 'font-size:9px;height:22px;padding:0 2px;flex:1;min-width:0;';
    voiceRow.appendChild(voiceSel);
    voiceRow.appendChild(voicePreviewBtn);
    voiceRow.appendChild(ttsParamsBtn);

    const _genVoicesTopBtn = document.createElement('button');
    _genVoicesTopBtn.textContent = '🔊';
    _genVoicesTopBtn.title = 'Generate voices for all fragments';
    _genVoicesTopBtn.style.cssText = 'font-size:10px;padding:1px 5px;cursor:pointer;background:#006620;color:#fff;border:none;border-radius:2px;flex-shrink:0;height:22px;';
    _genVoicesTopBtn.addEventListener('click', async () => {
      if (_genVoicesRunning) { _genVoicesAbort = true; return; }
      if (_handleGenVoices) await _handleGenVoices();
    });
    voiceRow.appendChild(_genVoicesTopBtn);

    hdrLeft.appendChild(voiceRow);

    hdr.appendChild(hdrLeft);
    block.appendChild(hdr);


    // ── Pose option sets needed by both frozen and pending sections ───────────
    const POSE_OPTS_CHAR_ONLY = [
      { value: '',            label: 'none' },
      { value: 'hands_down',  label: 'Hands down' },
      { value: 'hands_side',  label: 'Hands aside' },
      { value: 'hands_front', label: 'Hands forward' },
    ];
    const POSE_CHAR_PROMPTS = {
      hands_down:  'Same person, arms relaxed at sides, head slightly tilted forward, looking at camera, open relaxed posture, hands visible and open',
      hands_side:  'Same person, arms loosely at sides slightly away from body, head slightly tilted forward, looking at camera, hands visible and open',
      hands_front: 'Same person, hands loosely in front of body, head slightly tilted forward, looking at camera, hands visible and open',
    };

    // ── If frozen: render frozen row and skip cards ──
    if (frozen) {
      const frozenObraz = getObrazы?.().find(o => String(o.id) === String(frozen.obrazId)) || activeObraz;
      const charImages = frozenObraz
        ? [frozenObraz.char, ...(frozenObraz.variations || []).filter(v => v && v !== 'error')].filter(Boolean)
        : null;

      // ── Shared single-cell avatar runner (used by button + retry) ─────────
      const runSingleAvatar = async (cell, vc, idx) => {
        const videoParams   = getEngineParams?.('kling/ai-avatar-pro') || {};
        const defaultPrompt = videoParams.prompt || 'Natural speaking motion with subtle head movement and relaxed posture';
        const imgPath = cell.imagePath || cell.charImagePath || frozenObraz?.char || activeObraz?.char;
        if (!imgPath || !cell.audioPath) return;

        // Show ⏳ on the action button
        if (cell._actionBtn) { cell._actionBtn.textContent = '⏳'; cell._actionBtn.disabled = true; cell._actionBtn.style.background = ''; cell._actionBtn.style.color = '#888'; cell._actionBtn.style.fontWeight = ''; }
        if (cell._statusEl) cell._statusEl.textContent = '';

        // Start from last saved prompt (analysis or мозги — whichever ran last)
        let prompt = cell.avatarPrompt || defaultPrompt;
        try {
          const pr = await fetch('/api/audio/avatar-prompt', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imagePath: imgPath, text: cell.line, detailImagePath: cell.detInfo?.path || null }),
          });
          const pd = await pr.json();
          if (pd.success && pd.prompt) {
            prompt = pd.prompt;
            cell.avatarPrompt = prompt;  // persist: analysis wins, becomes new default for re-runs
            saveEditState();
          }
        } catch {}
        // If мозги prompt changed since last analysis, it takes priority (user explicitly set it)
        const mozgiPrompt = videoParams.prompt;
        if (mozgiPrompt && mozgiPrompt !== (cell.avatarPromptMozgi || '') && cell.avatarPromptMozgi !== undefined) {
          prompt = mozgiPrompt;
          cell.avatarPrompt = mozgiPrompt;
        }
        cell.avatarPromptMozgi = mozgiPrompt || '';
        saveEditState();

        const showVideoError = (msg) => {
          cell.videoError = msg || 'Avatar failed';
          delete cell._videoPending; saveEditState();
          if (cell._statusEl) cell._statusEl.textContent = (msg || 'Error').slice(0, 40);
          cell._applyActionState?.();
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
          cell._applyActionState?.();
          const videoPath = await pollAvatar(d.taskId);
          cell.videoPath = videoPath; cell.videoError = null;
          delete cell.avatarTaskId; delete cell._videoPending; saveEditState();
          vc.style.display = '';
          vc.innerHTML = '';
          vc.appendChild(_buildVideoThumb(videoPath));
          if (cell._statusEl) cell._statusEl.textContent = '';
          if (cell._imgBox) cell._imgBox.style.display = 'none';
          if (cell._colEl) { cell._colEl.style.outline = ''; cell._colEl.style.background = ''; }
          cell._applyActionState?.();
          renderMontagePanel(); renderAllTimelines();
        } catch (err) {
          // Keep avatarTaskId on network errors so resumeAvatarPendingCells can retry after reload
          if (!err.message?.includes('no connection')) delete cell.avatarTaskId;
          delete cell._videoPending; saveEditState();
          showVideoError(err.message);
        }
      };

      // ── Retry / reran a single image cell in the frozen session ─────────────
      const retryCellImage = async (cellIdx, imgBox, reranBtn, getInteractPromptFn = null) => {
        const _ck = _mkCellKey(cellIdx);
        if (_editCellsRunning.has(_ck)) return; // already generating this cell individually
        _editCellsRunning.add(_ck);
        try {
        // Always read from the live session in case state changed since render
        const liveSession = editFrozenSessions[sessionKey];
        const cell        = liveSession?.cells?.[cellIdx];
        if (!cell) { setStatus(`Cell ${cellIdx + 1}: session not found`); return; }

        // ── Active image: random from образ variations (ignore stale charImagePath) ──
        const _obraz = frozenObraz || activeObraz;
        const _charCandidates = [
          _obraz?.char,
          ...(_obraz?.variations || []).filter(v => v && v !== 'error'),
        ].filter(Boolean);
        if (!_charCandidates.length) { setStatus(`Cell ${cellIdx + 1}: no outfit images`); return; }
        const _pickChar = () => _charCandidates[Math.floor(Math.random() * _charCandidates.length)];

        // ── Asset image: use the item currently shown in detailImgBox (cell.detInfo) ──
        let _assetSrc = null;
        {
          let detInfo = cell.detInfo;
          if (detInfo && !detInfo.path && detInfo.file)
            detInfo = cachedDetailFiles.find(d => d.file === detInfo.file) || detInfo;
          if (detInfo?.path) {
            _assetSrc = detInfo.path;
          } else {
            // Fallback: any item assigned to this project
            const _assignments = liveSession.assignments || frozen.assignments || {};
            const _assignedFiles = [...new Set(Object.values(_assignments).filter(Boolean))];
            const _candidates = _assignedFiles
              .map(f => cachedDetailFiles.find(d => d.file === f)?.path || `/details/${f}`)
              .filter(Boolean);
            if (_candidates.length) _assetSrc = _candidates[Math.floor(Math.random() * _candidates.length)];
          }
        }
        if (!_assetSrc) { setStatus(`Cell ${cellIdx + 1}: no item for mix`); return; }

        const imageEngine = engineSel.value || getImageEngine?.() || 'seedream';
        const _charSrc = _pickChar();

        imgBox.style.cssText = 'width:62px;height:82px;border:1px solid #808080;background:#ddd;overflow:hidden;flex-shrink:0;display:flex;align-items:center;justify-content:center;';
        imgBox.innerHTML = '<span style="font-size:9px;color:#888;">⏳</span>';
        if (reranBtn) { reranBtn.disabled = true; reranBtn.textContent = '⏳'; reranBtn.style.background = ''; reranBtn.style.color = '#888'; }

        // ── Pre-analyze: образ + предмет + взаимодействие + negative → готовый промпт ──
        let _combinedPrompt = '';
        {
          let _negP = '';
          try { const _sd = await (await fetch('/api/settings')).json(); _negP = _sd.settings?.editNegativePrompt || ''; } catch {}
          const _iPrompt = getInteractPromptFn ? getInteractPromptFn() : '';
          const _presetR = [_iPrompt, _negP ? `Avoid in generation: ${_negP}` : ''].filter(Boolean).join('\n');
          const _arAnalyze = window.createActivityRow?.(`Analyze cell ${cellIdx + 1}`);
          try {
            const _analyzeR = await fetch('/api/asset-interact/pre-analyze', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ activePath: _charSrc, assetPath: _assetSrc, presetPrompt: _presetR }),
            });
            const _analyzeD = await _analyzeR.json();
            if (_analyzeD.success && _analyzeD.combinedPrompt) _combinedPrompt = _analyzeD.combinedPrompt;
          } catch (_ae) {
            setStatus(`Cell ${cellIdx + 1}: analysis failed — ${_ae.message}`);
          }
        }

        const MAX_RETRIES = 3;
        let lastErr = null;
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
          try {
            const gr = await fetch('/api/asset-interact/generate', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                activePath: _charSrc, assetPath: _assetSrc,
                prompt: _combinedPrompt, assetType: 'detail', imageEngine,
                engineParams: getEngineParams?.(imageEngine) || {},
              }),
            });
            const gd = await gr.json();
            if (!gd.success) throw new Error(gd.error);

            const sess = editFrozenSessions[sessionKey];
            if (sess && sess.cells?.[cellIdx]) { sess.cells[cellIdx].taskId = gd.taskId; saveEditState(); }

            const _ar1 = window.createActivityRow?.(`Item cell ${cellIdx + 1}`);
            const imagePath = await pollTask(gd.taskId, 3000, 120, _ar1);

            if (sess) {
              const cellRef = sess.cells?.[cellIdx];
              if (cellRef) {
                cellRef.imagePath = imagePath;
                delete cellRef.taskId;
                if (!cellRef.generatedImages) cellRef.generatedImages = [];
                if (!cellRef.generatedImages.includes(imagePath)) cellRef.generatedImages.push(imagePath);
                saveEditState();
              }
            }

            imgBox.innerHTML = '';
            imgBox.style.cssText = 'width:62px;height:82px;border:1px solid #808080;background:#ccc;overflow:hidden;flex-shrink:0;cursor:zoom-in;';
            const img = document.createElement('img');
            img.src = imagePath + '?t=' + Date.now();
            img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
            img.addEventListener('click', () => {
              const cellRef2 = editFrozenSessions[sessionKey]?.cells?.[cellIdx];
              const fakeCell = cellRef2 || { imagePath, generatedImages: [imagePath] };
              openEditCellLightbox(fakeCell, selected => {
                if (cellRef2) { cellRef2.imagePath = selected; saveEditState(); }
                img.src = selected + '?t=' + Date.now();
              });
            });
            imgBox.appendChild(img);

            // Notify component: mix succeeded → store in per-item cache, rebuild state
            cell._onMixSuccess?.(imagePath);
            cell._applyActionState?.();
            playCompletionSound?.();
            return; // success
          } catch (err) {
            lastErr = err;
            setStatus(`Cell ${cellIdx + 1}: attempt ${attempt}/3 — ${err.message}`);
            if (attempt < MAX_RETRIES) await new Promise(r => setTimeout(r, 3000));
          }
        }
        // All retries exhausted — show error with message
        imgBox.style.cssText = 'width:62px;height:82px;border:1px solid #808080;background:#ddd;overflow:hidden;flex-shrink:0;display:flex;align-items:center;justify-content:center;flex-direction:column;';
        imgBox.innerHTML = `<span style="font-size:7px;color:#aa0000;text-align:center;padding:2px;word-break:break-all;">${(lastErr?.message || 'Error').slice(0, 60)}</span>`;
        // Clear taskId so the state machine doesn't stay in ⏳ after failure
        const _cellForClean = editFrozenSessions[sessionKey]?.cells?.[cellIdx];
        if (_cellForClean) { delete _cellForClean.taskId; saveEditState(); }
        playCompletionSound?.();
        cell._applyActionState?.();
        } finally {
          _editCellsRunning.delete(_ck);
          // If a render was deferred while we were running, do it now
          if (window._editPanelNeedsRender && _editCellsRunning.size === 0) renderEditPanel();
        }
      };

      const _tlData = getTimelineData();
      const _editExcludedSet = new Set(_tlData[sessionKey]?.excludedSegments || []);

      // Local alias for per-session keys in the global _editCellsRunning set
      const _mkCellKey = (idx) => `${sessionKey}__${idx}`;

      // ── Shared pose image generator (no avatar step) ──────────────────────
      const _genFrozenPoseImage = async (cell, idx, poseVal) => {
        const poseCardKey = `${f.file}__${idx}__pose`;
        const prompt = POSE_CHAR_PROMPTS[poseVal] || '';
        const srcPath = cell.imagePath || cell.charImagePath || frozenObraz?.char || activeObraz?.char;
        const imageEngine = engineSel.value || getImageEngine?.() || 'seedream';
        if (cell._imgBox) {
          cell._imgBox.style.cssText = 'width:62px;height:82px;border:1px solid #808080;background:#ddd;overflow:hidden;flex-shrink:0;display:flex;align-items:center;justify-content:center;';
          cell._imgBox.innerHTML = '<span style="font-size:9px;color:#888;">⏳</span>';
        }
        try {
          const gr = await fetch('/api/asset-interact/generate', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ activePath: srcPath, assetPath: null, prompt, assetType: 'char_pose', imageEngine, engineParams: getEngineParams?.(imageEngine) || {} }),
          });
          const gd = await gr.json();
          if (!gd.success) throw new Error(gd.error);
          const _ar = window.createActivityRow?.('Gen. pose');
          const resultPath = await pollTask(gd.taskId, 3000, 120, _ar);
          cell.imagePath = resultPath; cell.charImagePath = resultPath;
          editCardCache[poseCardKey] = { imagePath: resultPath }; saveEditState();
          if (cell._imgBox) {
            cell._imgBox.innerHTML = '';
            cell._imgBox.style.cssText = 'width:62px;height:82px;border:1px solid #808080;background:#ccc;overflow:hidden;flex-shrink:0;display:block;';
            const _pi = document.createElement('img');
            _pi.src = resultPath + '?t=' + Date.now(); _pi.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
            cell._imgBox.appendChild(_pi);
          }
          cell._applyActionState?.();
          return true;
        } catch (err) {
          if (cell._imgBox) {
            cell._imgBox.style.cssText = 'width:62px;height:82px;border:1px solid #808080;background:#ddd;overflow:hidden;flex-shrink:0;display:flex;align-items:center;justify-content:center;';
            cell._imgBox.innerHTML = `<span style="font-size:8px;color:#aa0000;text-align:center;padding:2px;">${(err.message || 'Error').slice(0, 30)}</span>`;
          }
          cell._applyActionState?.();
          return false;
        }
      };

      // ── Per-cell component factory — each cell is fully self-contained ────
      const buildCellComponent = (cell, idx) => {
        const isExcl = _editExcludedSet.has(idx);

        const c = document.createElement('div');
        c.style.cssText = 'flex-shrink:0;width:66px;display:flex;flex-direction:column;align-items:center;gap:2px;';

        const num = document.createElement('div');
        num.style.cssText = 'font-size:9px;color:#808080;line-height:1.4;';
        num.textContent = idx + 1;

        const imgBox = document.createElement('div');

        // _renderImgBox: fully redraws imgBox based on current _mixReady + cell state.
        // Called on init, after item change, and after mix generation completes.
        const _renderImgBox = () => {
          imgBox.innerHTML = '';
          imgBox.style.cssText = 'width:62px;height:82px;border:1px solid #808080;overflow:hidden;flex-shrink:0;';

          if (cell.detInfo) {
            if (_mixReady) {
              // Mix is ready — show the generated mix image
              const mixPath = cell.mixes?.[cell.detInfo.file] || cell.imagePath;
              imgBox.style.cssText += 'background:#ccc;cursor:zoom-in;';
              const img = document.createElement('img');
              img.src = (mixPath || '') + '?t=' + Date.now();
              img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
              img.addEventListener('click', () => openEditCellLightbox(cell, selected => {
                if (!cell.mixes) cell.mixes = {};
                if (cell.detInfo?.file) cell.mixes[cell.detInfo.file] = selected;
                cell.imagePath = selected;
                img.src = selected + '?t=' + Date.now();
                saveEditState();
              }));
              lazyLoad(img);
              imgBox.appendChild(img);
            } else if (cell.taskId) {
              // Mix currently generating
              imgBox.style.cssText += 'background:#ddd;display:flex;align-items:center;justify-content:center;';
              imgBox.innerHTML = '<span style="font-size:9px;color:#888;">⏳</span>';
            } else {
              // No mix for this item yet — show original char image (no item overlay)
              const charPath = cell.charImagePath || frozenObraz?.char;
              if (charPath) {
                imgBox.style.cssText += 'background:#ccc;cursor:zoom-in;';
                const img = document.createElement('img');
                img.src = charPath;
                img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
                img.addEventListener('click', () => openImagePicker(
                  charImages?.length ? charImages : [charPath],
                  img, charPath, selected => {
                    cell.charImagePath = selected;
                    img.src = selected + '?t=' + Date.now();
                    saveEditState();
                  }));
                lazyLoad(img);
                imgBox.appendChild(img);
              } else {
                imgBox.style.cssText += 'background:#ccc;';
              }
            }
          } else {
            // No item — show current imagePath (pose or char)
            if (cell.imagePath) {
              imgBox.style.cssText += 'background:#ccc;cursor:zoom-in;';
              const img = document.createElement('img');
              img.dataset.src = cell.imagePath;
              img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
              img.addEventListener('click', () => openImagePicker(
                charImages?.length ? charImages : (cell.generatedImages?.length ? cell.generatedImages : [cell.imagePath]),
                img, cell.imagePath, selected => {
                  cell.imagePath = selected; cell.charImagePath = selected;
                  img.src = selected + '?t=' + Date.now(); saveEditState();
                }));
              lazyLoad(img);
              imgBox.appendChild(img);
            } else if (cell.taskId) {
              imgBox.style.cssText += 'background:#ddd;display:flex;align-items:center;justify-content:center;';
              imgBox.innerHTML = '<span style="font-size:9px;color:#888;">⏳</span>';
            } else {
              imgBox.style.cssText += 'background:#ccc;overflow:hidden;position:relative;';
              if (frozenObraz?.char) {
                const img = document.createElement('img');
                img.src = frozenObraz.char;
                img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;opacity:0.35;filter:grayscale(0.4);';
                imgBox.appendChild(img);
              }
            }
          }
        };

        const detailImgBox = document.createElement('div');
        const _renderDetailBox = () => {
          detailImgBox.innerHTML = '';
          if (cell.detInfo?.path) {
            detailImgBox.style.cssText = 'width:62px;height:46px;border:1px solid #808080;overflow:hidden;flex-shrink:0;background:#ccc;cursor:pointer;';
            const detImg = document.createElement('img');
            detImg.src = cell.detInfo.path;
            detImg.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
            detailImgBox.appendChild(detImg);
          } else {
            detailImgBox.style.cssText = 'width:62px;height:46px;border:1px dashed #bbb;background:#ebebeb;flex-shrink:0;cursor:pointer;display:flex;align-items:center;justify-content:center;';
            const pl = document.createElement('span');
            pl.textContent = '+'; pl.style.cssText = 'font-size:18px;color:#bbb;pointer-events:none;';
            detailImgBox.appendChild(pl);
          }
        };
        _renderDetailBox();

        const videoContainer = document.createElement('div');
        let _videoThumbBuilt = false;
        if (cell.videoPath) { videoContainer.appendChild(_buildVideoThumb(cell.videoPath)); _videoThumbBuilt = true; }

        const statusEl = document.createElement('div');
        statusEl.style.cssText = 'width:66px;font-size:7px;margin-top:1px;text-align:center;color:#aa0000;word-break:break-word;';
        if (cell.videoError && !cell.videoPath) statusEl.textContent = (cell.videoError || '').slice(0, 40);

        const actionBtn = document.createElement('button');
        actionBtn.style.cssText = 'width:66px;font-size:10px;padding:2px 0;margin-top:1px;cursor:pointer;';

        let _dropSel  = null;
        let _dropType = null;

        // _mixReady: true when cell.mixes has an entry for the currently selected item.
        // cell.mixes = { [detInfo.file]: imagePath } — persisted cache of all generated mixes.
        // Survives renderEditPanel rebuilds and page reloads.
        let _mixReady = !!(cell.detInfo && cell.mixes?.[cell.detInfo.file]);
        // Keep cell.imagePath in sync with mix state so runSingleAvatar picks the right image
        if (_mixReady) cell.imagePath = cell.mixes[cell.detInfo.file];
        else if (cell.detInfo) cell.imagePath = cell.charImagePath || frozenObraz?.char || null;

        const _applyActionState = () => {
          const _vid    = cell.videoPath;
          const _vidGen = !!(cell.avatarTaskId || cell._videoPending);
          const _showVideo = _vid || _vidGen;

          if (_showVideo) {
            imgBox.style.display = 'none'; detailImgBox.style.display = 'none';
            if (_dropSel) _dropSel.style.display = 'none';
          } else {
            if (imgBox.style.display === 'none') imgBox.style.display = '';
            detailImgBox.style.display = '';
            detailImgBox.style.opacity = ''; detailImgBox.style.pointerEvents = '';
            if (_dropSel) _dropSel.style.display = '';
          }
          if (_vid) {
            if (!_videoThumbBuilt) {
              videoContainer.style.cssText = 'width:66px;';
              videoContainer.innerHTML = '';
              videoContainer.appendChild(_buildVideoThumb(cell.videoPath));
              _videoThumbBuilt = true;
            }
            videoContainer.style.display = '';
          } else if (_vidGen) {
            videoContainer.style.cssText = 'width:66px;height:88px;background:#ddd;display:flex;align-items:center;justify-content:center;';
            videoContainer.innerHTML = '<span style="font-size:9px;color:#888;">⏳</span>';
            _videoThumbBuilt = false;
          } else {
            videoContainer.style.cssText = 'width:66px;display:none;';
          }

          // Button states — priority order, each returns early:

          // 1. Video done → ↺🗣
          if (cell.videoPath) {
            actionBtn.textContent = '↺🗣';
            actionBtn.title = 'Video ready. Click to regenerate the talking head video.';
            actionBtn.style.background = '#cc2200'; actionBtn.style.color = '#fff';
            actionBtn.style.fontWeight = 'bold'; actionBtn.disabled = false;
            return;
          }
          // 2. Video generating → ⏳
          if (cell.avatarTaskId || cell._videoPending) {
            actionBtn.textContent = '⏳';
            actionBtn.title = 'Talking head video is generating.';
            actionBtn.style.background = ''; actionBtn.style.color = '#888';
            actionBtn.style.fontWeight = ''; actionBtn.disabled = true;
            return;
          }
          // 3. Video error → ↺🗣 retry
          if (cell.videoError) {
            actionBtn.textContent = '↺🗣';
            actionBtn.title = `Video error: "${(cell.videoError || 'Error').slice(0, 60)}". Click to retry.`;
            actionBtn.style.background = '#993300'; actionBtn.style.color = '#fff';
            actionBtn.style.fontWeight = 'bold'; actionBtn.disabled = false;
            return;
          }
          // 4. Mix image currently generating → ⏳
          if (cell.taskId) {
            actionBtn.textContent = '⏳';
            actionBtn.title = 'Mix image is generating.';
            actionBtn.style.background = ''; actionBtn.style.color = '#888';
            actionBtn.style.fontWeight = ''; actionBtn.disabled = true;
            return;
          }
          // 5. Has item, mix NOT ready → "generate mix" (enabled regardless of audio)
          if (cell.detInfo && !_mixReady) {
            actionBtn.textContent = '🗣';
            actionBtn.title = 'Item assigned — click to generate outfit + item mix image.';
            actionBtn.style.background = '#5500aa'; actionBtn.style.color = '#fff';
            actionBtn.style.fontWeight = 'bold'; actionBtn.disabled = false;
            return;
          }
          // 6. Mix ready + audio → generate video (green)
          if (cell.detInfo && _mixReady && cell.audioPath) {
            actionBtn.textContent = '🗣';
            actionBtn.title = 'Mix ready, voice recorded — click to launch talking head video.';
            actionBtn.style.background = '#006600'; actionBtn.style.color = '#fff';
            actionBtn.style.fontWeight = 'bold'; actionBtn.disabled = false;
            return;
          }
          // 7. Mix ready, no audio → waiting (disabled)
          if (cell.detInfo && _mixReady) {
            actionBtn.textContent = '🗣';
            actionBtn.title = 'Mix ready, but no voice. Generate voice for this fragment first.';
            actionBtn.style.background = '#555'; actionBtn.style.color = '#fff';
            actionBtn.style.fontWeight = 'bold'; actionBtn.disabled = true;
            return;
          }
          // 8. No item, has audio → direct video (green)
          if (!cell.detInfo && cell.audioPath) {
            actionBtn.textContent = '🗣';
            actionBtn.title = 'Voice ready — click to create talking head video.';
            actionBtn.style.background = '#006600'; actionBtn.style.color = '#fff';
            actionBtn.style.fontWeight = 'bold'; actionBtn.disabled = false;
            return;
          }
          // 9. No item, pose selected → generate pose + video
          if (!cell.detInfo && _dropType === 'pose' && _dropSel?.value) {
            actionBtn.textContent = '🗣';
            actionBtn.title = `Pose "${_dropSel.options[_dropSel.selectedIndex]?.text || _dropSel.value}" selected. Click to generate pose photo, then video.`;
            actionBtn.style.background = ''; actionBtn.style.color = '';
            actionBtn.style.fontWeight = ''; actionBtn.disabled = false;
            return;
          }
          // 10. Default: disabled
          actionBtn.textContent = '🗣';
          actionBtn.title = 'No voice and no item assigned. Unavailable.';
          actionBtn.style.background = ''; actionBtn.style.fontWeight = '';
          actionBtn.style.color = '#aaa'; actionBtn.disabled = true;
        };

        const _buildDropdown = () => {
          if (_dropSel) { _dropSel.remove(); _dropSel = null; _dropType = null; }
          if (isExcl) { _applyActionState(); return; }

          if (cell.detInfo && !_mixReady) {
            // Interact dropdown: item assigned but mix not yet generated
            _dropType = 'interact';
            const _iKey = `edit_interact__${sessionKey}__${idx}`;
            const sel = document.createElement('select');
            sel.style.cssText = 'width:64px;font-size:8px;height:20px;padding:0 2px;margin-bottom:1px;';
            getMergedOptions(f.file).forEach((o, oi) => {
              const op = document.createElement('option'); op.value = oi; op.textContent = o.label;
              sel.appendChild(op);
            });
            const saved = localStorage.getItem(_iKey);
            if (saved !== null && saved !== '') sel.value = saved;
            localStorage.setItem(_iKey, sel.value); // persist even if default (survives rebuilds)
            sel.addEventListener('change', () => localStorage.setItem(_iKey, sel.value));
            _dropSel = sel;
            c.insertBefore(sel, actionBtn);
          } else if (!cell.detInfo && !cell.videoPath) {
            // Pose dropdown: no item, no video
            _dropType = 'pose';
            const _pKey = `edit_pose2__${sessionKey}__${idx}`;
            const sel = document.createElement('select');
            sel.style.cssText = 'width:64px;font-size:8px;height:20px;padding:0 2px;margin-bottom:1px;';
            POSE_OPTS_CHAR_ONLY.forEach(o => {
              const op = document.createElement('option'); op.value = o.value; op.textContent = o.label;
              sel.appendChild(op);
            });
            const saved = localStorage.getItem(_pKey);
            if (saved && POSE_OPTS_CHAR_ONLY.find(o => o.value === saved)) sel.value = saved;
            localStorage.setItem(_pKey, sel.value); // persist even if default
            sel.addEventListener('change', () => { localStorage.setItem(_pKey, sel.value); _applyActionState(); });
            _dropSel = sel;
            c.insertBefore(sel, actionBtn);
          }
          _applyActionState();
        };

        const getPoseVal      = () => _dropType === 'pose' ? (_dropSel?.value || '') : '';
        const getInteractPrompt = () => _dropType === 'interact'
          ? (getMergedOptions(f.file)[Number(_dropSel?.value || 0)]?.prompt || '')
          : '';

        const generateMix = () => retryCellImage(idx, imgBox, actionBtn, getInteractPrompt);

        const generateAvatar = async () => {
          const _ck = _mkCellKey(idx);
          if (_editCellsRunning.has(_ck)) return;
          _editCellsRunning.add(_ck);
          try {
            if (!cell.videoPath && !cell.detInfo && _dropType === 'pose' && _dropSel?.value) {
              const ok = await _genFrozenPoseImage(cell, idx, _dropSel.value);
              if (!ok) return;
            }
            // Sync imagePath to what is currently displayed: mix for current item, or char image
            if (cell.detInfo && _mixReady) {
              cell.imagePath = cell.mixes?.[cell.detInfo.file] || cell.imagePath;
            } else if (!cell.detInfo) {
              cell.imagePath = cell.imagePath || cell.charImagePath || frozenObraz?.char || null;
            }
            await runSingleAvatar(cell, videoContainer, idx);
          } finally {
            _editCellsRunning.delete(_ck);
            if (window._editPanelNeedsRender && _editCellsRunning.size === 0) renderEditPanel();
          }
        };

        const generatePoseImage = (poseVal) => _genFrozenPoseImage(cell, idx, poseVal);

        // Called by retryCellImage on successful mix generation — stores mix in per-item cache
        cell._onMixSuccess = (generatedPath) => {
          if (!cell.mixes) cell.mixes = {};
          const file = cell.detInfo?.file;
          if (file && generatedPath) { cell.mixes[file] = generatedPath; cell.imagePath = generatedPath; }
          _mixReady = true;
          saveEditState();
          _buildDropdown();
          _renderImgBox();
          if (cell.audioPath) generateAvatar();
        };

        actionBtn.addEventListener('click', async () => {
          if (actionBtn.disabled) return;
          // Video done or error → re-generate video
          if (cell.videoPath || cell.videoError) {
            await generateAvatar();
            return;
          }
          // Mix ready + audio → generate video
          if (cell.detInfo && _mixReady && cell.audioPath) {
            await generateAvatar();
            return;
          }
          // Item present, mix not ready → generate mix, then auto-chain to video on success
          if (cell.detInfo && !_mixReady) {
            actionBtn.textContent = '⏳'; actionBtn.disabled = true;
            actionBtn.style.background = ''; actionBtn.style.color = '#888'; actionBtn.style.fontWeight = '';
            detailImgBox.style.opacity = '0.4'; detailImgBox.style.pointerEvents = 'none';
            generateMix();
            return;
          }
          // No item, has audio → direct video
          if (!cell.detInfo && cell.audioPath) {
            await generateAvatar();
            return;
          }
          // No item, pose selected → generate pose + video
          if (!cell.detInfo && _dropType === 'pose' && _dropSel?.value) {
            await generateAvatar();
          }
        });

        detailImgBox.addEventListener('click', () => {
          if (_editCellsRunning.has(_mkCellKey(idx))) return; // mix generating — block picker
          if (!cachedDetailFiles.length) { setStatus('No uploaded items'); return; }
          const _prevFile = cell.detInfo?.file || null;
          openDetailPicker(cachedDetailFiles, detailImgBox, _prevFile, chosen => {
            if (chosen) { cell.detInfo = chosen; } else { delete cell.detInfo; }
            const newFile = cell.detInfo?.file || null;
            if (_prevFile !== newFile) {
              // Item changed — restore mix for new item if it was generated before
              if (newFile && cell.mixes?.[newFile]) {
                _mixReady = true;
                cell.imagePath = cell.mixes[newFile];
              } else {
                _mixReady = false;
                cell.imagePath = cell.charImagePath || frozenObraz?.char || null;
              }
            }
            saveEditState(); _renderDetailBox(); _renderImgBox(); _buildDropdown();
          });
        });

        c.appendChild(num); c.appendChild(imgBox); c.appendChild(detailImgBox);
        c.appendChild(videoContainer); c.appendChild(statusEl); c.appendChild(actionBtn);

        cell._imgBox           = imgBox;
        cell._detailImgBox     = detailImgBox;
        cell._actionBtn        = actionBtn;
        cell._applyActionState = _applyActionState;
        cell._statusEl         = statusEl;
        cell._videoContainer   = videoContainer;
        cell._colEl            = c;

        _renderImgBox();
        _buildDropdown(); // also calls _applyActionState

        return { el: c, cell, idx, actionBtn,
          get isRunning() { return _editCellsRunning.has(_mkCellKey(idx)); },
          applyState: _applyActionState, getPoseVal, getInteractPrompt,
          generateMix, generateAvatar, generatePoseImage };
      };

      const frozenComponents = frozen.cells.map(buildCellComponent);

      const frozenRow = document.createElement('div');
      frozenRow.style.cssText = 'display:flex;gap:6px;overflow-x:auto;padding-bottom:4px;';
      frozenComponents.forEach(comp => frozenRow.appendChild(comp.el));

      // ── Wire up gen voices handler ────────────────────────────────────────
      _handleGenVoices = async () => {
        if (_genVoicesRunning) return;
        _genVoicesRunning = true; _genVoicesAbort = false;
        _genVoicesTopBtn.textContent = '⏳🔊'; _genVoicesTopBtn.disabled = true;
        const _v = getProjectVoice();
        // Clear audio only for cells that are not generating/have video
        frozenComponents.forEach((comp, i) => {
          if (_editExcludedSet.has(i)) return;
          if (comp.isRunning) return;
          const _c = comp.cell;
          if (_c.videoPath || _c.avatarTaskId || _c._videoPending) return; // don't touch cells with video
          delete _c.audioPath; delete _c.audioError;
          if (_c._audioContainer) _c._audioContainer.innerHTML = '<span style="font-size:9px;color:#888;">⏳</span>';
        });
        saveEditState();
        try {
        for (let _i = 0; _i < frozenComponents.length; _i++) {
          if (_genVoicesAbort) break;
          if (_editExcludedSet.has(_i)) continue;
          const _cell = frozenComponents[_i].cell;
          if (_cell.videoPath || _cell.avatarTaskId || _cell._videoPending) continue; // skip cells with video
          const _cont = _cell._audioContainer;
          await new Promise(r => setTimeout(r, 800));
          if (_genVoicesAbort) break;
          if (_cont) _cont.innerHTML = '<span style="font-size:9px;color:#888;">⏳</span>';
          const _doTtsReq = async () => {
            const _r = await fetch('/api/audio/tts', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text: _cell.line, voice: _v, ttsParams: getProjectTtsParams(), model: getAudioEngine?.() }),
            });
            const _d = await _r.json();
            if (!_d.success) throw new Error(_d.error);
            return _d.audioPath || await pollTts(_d.taskId);
          };
          try {
            let _ap;
            try { _ap = await _doTtsReq(); }
            catch { await new Promise(r => setTimeout(r, 2500)); _ap = await _doTtsReq(); }
            _cell.audioPath = _ap; delete _cell.audioError; saveEditState();
            if (_cont) {
              _cont.innerHTML = '';
              const _aud = document.createElement('audio');
              _aud.controls = true; _aud.src = _ap; _aud.style.cssText = 'height:24px;width:110px;';
              _cont.appendChild(_aud);
            }
            frozenComponents[_i].applyState();
          } catch (_err) {
            _cell.audioError = _err.message || 'TTS failed'; saveEditState();
            if (_cont) { _cont.innerHTML = ''; const _e = document.createElement('span'); _e.textContent = '❌'; _e.style.cssText = 'font-size:9px;color:#aa0000;'; _cont.appendChild(_e); }
          }
        }
        } finally {
          _genVoicesRunning = false; _genVoicesAbort = false;
          _genVoicesTopBtn.textContent = '🔊'; _genVoicesTopBtn.disabled = false;
          frozenComponents.forEach((comp, ci) => { if (!comp.isRunning) comp.applyState(); });
        }
      };

      // Auto-run after pending→frozen transition
      if (window._editAutoRun?.sessionKey === sessionKey) {
        const _autoAction = window._editAutoRun.action;
        delete window._editAutoRun;
        if (_autoAction === 'voices') setTimeout(() => _genVoicesTopBtn.click(), 100);
      }

      block.appendChild(frozenRow);

      // ── Auto-start cell action triggered by pending section 🗣 click ──
      if (window._pendingAutoStart?.sessionKey === sessionKey) {
        const { cellIdx: _startIdx } = window._pendingAutoStart;
        delete window._pendingAutoStart;
        const _startComp = frozenComponents[_startIdx];
        if (_startComp?.actionBtn && !_startComp.actionBtn.disabled) {
          setTimeout(() => _startComp.actionBtn.click(), 50);
        }
      }

      const allHaveAudio = () => frozenComponents.every((comp, i) => _editExcludedSet.has(i) || comp.cell.audioPath);

      // ── Голоса collapsible panel ──
      const голосаPanel = document.createElement('div');
      голосаPanel.style.cssText = 'margin-top:4px;';

      const голосаHeader = document.createElement('div');
      голосаHeader.style.cssText = 'display:flex;align-items:center;gap:4px;cursor:pointer;user-select:none;padding:3px 0;border-top:1px solid #c0c0c0;';
      const голосаArrow = document.createElement('span');
      голосаArrow.textContent = allHaveAudio() ? '▶' : '▼'; голосаArrow.style.cssText = 'font-size:9px;color:#555;flex-shrink:0;';
      const голосаLabel = document.createElement('span');
      голосаLabel.style.cssText = 'font-size:10px;font-weight:bold;color:#333;';
      голосаLabel.textContent = 'Voices';
      голосаHeader.appendChild(голосаArrow); голосаHeader.appendChild(голосаLabel);

      const голосаBody = document.createElement('div');
      голосаBody.style.cssText = `${allHaveAudio() ? 'display:none' : 'display:block'};padding:2px 0;max-height:210px;overflow-y:auto;`;

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

        const makeAudioPlayer = (src) => {
          const aud = document.createElement('audio');
          aud.controls = true; aud.src = src;
          aud.style.cssText = 'height:24px;width:110px;';
          return aud;
        };

        const audioArea = document.createElement('div');
        audioArea.style.cssText = 'flex-shrink:0;padding-top:2px;';

        const _renderAudioArea = () => {
          audioArea.innerHTML = '';
          audioArea.style.cssText = 'flex-shrink:0;padding-top:2px;';
          if (cell.audioPath) {
            audioArea.appendChild(makeAudioPlayer(cell.audioPath));
          } else if (cell.audioError) {
            audioArea.style.cssText += 'display:flex;align-items:center;gap:2px;';
            const errSpan = document.createElement('span');
            errSpan.textContent = '❌'; errSpan.style.cssText = 'font-size:9px;color:#aa0000;';
            audioArea.appendChild(errSpan);
          } else {
            audioArea.innerHTML = '<span style="font-size:9px;color:#bbb;">—</span>';
          }
        };
        _renderAudioArea();
        cell._audioContainer = audioArea;

        const textEl = document.createElement('textarea');
        textEl.value = cell.line;
        textEl.rows = 2;
        textEl.style.cssText = 'flex:1;font-size:9px;resize:vertical;height:22px;padding:2px 3px;font-family:inherit;min-width:0;';
        textEl.addEventListener('change', () => {
          cell.line = textEl.value;
          saveEditState();
        });

        const genBtn = document.createElement('button');
        genBtn.textContent = '🎙';
        genBtn.title = 'Generate voice for this line';
        genBtn.style.cssText = 'flex-shrink:0;width:22px;height:22px;padding:0;font-size:10px;cursor:pointer;';

        const _runTts = async () => {
          const newText = textEl.value.trim() || cell.line;
          audioArea.innerHTML = '<span style="font-size:9px;color:#888;">⏳</span>';
          genBtn.disabled = true;
          const _doTtsReq = async () => {
            const r = await fetch('/api/audio/tts', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text: newText, voice: getProjectVoice(), ttsParams: getProjectTtsParams(), model: getAudioEngine?.() }),
            });
            const d = await r.json();
            if (!d.success) throw new Error(d.error);
            return d.audioPath || await pollTts(d.taskId);
          };
          try {
            let audioPath;
            try { audioPath = await _doTtsReq(); }
            catch { await new Promise(r => setTimeout(r, 2500)); audioPath = await _doTtsReq(); }
            cell.line = newText;
            cell.audioPath = audioPath; delete cell.audioError;
            if (cell.videoPath || cell.avatarTaskId) {
              cell.videoPath = null; delete cell.videoError; delete cell.avatarTaskId; delete cell._videoPending;
              if (cell._videoContainer) { cell._videoContainer.style.display = 'none'; cell._videoContainer.innerHTML = ''; }
              if (cell._colEl) { cell._colEl.style.outline = '2px solid #cc0000'; cell._colEl.style.background = '#fff5f5'; }
              if (cell._imgBox) cell._imgBox.style.display = '';
            }
            saveEditState(); renderAllTimelines();
            _renderAudioArea();
            cell._applyActionState?.();
          } catch (err) {
            cell.audioError = err.message; saveEditState();
            _renderAudioArea();
          } finally {
            genBtn.disabled = false;
          }
        };

        genBtn.addEventListener('click', _runTts);

        const _initExcl = _editExcludedSet.has(idx);
        const toggleLineBtn = document.createElement('button');
        const _applyToggleStyle = (excl) => {
          toggleLineBtn.textContent = excl ? '↺' : '✕';
          toggleLineBtn.title = excl ? 'Restore line' : 'Deactivate line';
          toggleLineBtn.style.color = excl ? '#008800' : '#aa0000';
          rowEl.style.opacity = excl ? '0.5' : '';
          const col = frozen.cells?.[idx]?._colEl;
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

        rowEl.appendChild(numEl); rowEl.appendChild(genBtn); rowEl.appendChild(audioArea); rowEl.appendChild(textEl); rowEl.appendChild(toggleLineBtn);
        голосаBody.appendChild(rowEl);
      });

      голосаPanel.appendChild(голосаHeader); голосаPanel.appendChild(голосаBody);
      block.appendChild(голосаPanel);


      projectBody.appendChild(block);
      panel.appendChild(projectWrap);
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

    // ── Pose option sets (3 types depending on cell content) ───────────────────
    // POSE_OPTS_CHAR_ONLY and POSE_CHAR_PROMPTS hoisted above if(frozen) block
    const POSE_OPTS_BOTH = [
      { value: 'left_hand',       label: 'Left hand' },
      { value: 'right_hand_face', label: 'Right at face' },
      { value: 'both_hands',      label: 'Both hands' },
      { value: 'hold_point',      label: 'Hold+point' },
    ];
    const POSE_OPTS_PRODUCT_ONLY = [
      { value: 'random',         label: 'random' },
      { value: 'iphone_kitchen', label: 'iPhone kitchen' },
      { value: 'closeup_table',  label: 'Close-up table' },
      { value: 'store_shelf',    label: 'Mall shelf' },
    ];
    const POSE_BOTH_LABELS = {
      left_hand:       'holds the product naturally in the left hand',
      right_hand_face: 'holds the product in the right hand at face level showing it to camera',
      both_hands:      'holds the product firmly with both hands',
      hold_point:      'holds the product in one hand and points at it with the other hand',
    };
    const POSE_PRODUCT_PROMPTS = {
      iphone_kitchen: 'Casual amateur iPhone photo, product placed on kitchen table, natural daylight, lifestyle photography, slightly imperfect angle',
      closeup_table:  'Professional close-up product photography on clean table surface, soft studio lighting, sharp focus on product details, minimal background',
      store_shelf:    'Product on retail shelf in luxury shopping mall, well-dressed business people visible in soft background, upscale retail atmosphere',
    };

    // ── Cells table: 5 horizontal rows ─────────────────────────────────────────
    const cellCss = (extra) => `width:66px;flex-shrink:0;${extra || ''}`;
    const ROW_CSS = 'display:flex;gap:4px;margin-bottom:2px;align-items:flex-start;';

    const rowNums   = document.createElement('div'); rowNums.style.cssText   = ROW_CSS;
    const rowChar   = document.createElement('div'); rowChar.style.cssText   = ROW_CSS;
    const rowProd   = document.createElement('div'); rowProd.style.cssText   = ROW_CSS;
    const rowPose   = document.createElement('div'); rowPose.style.cssText   = ROW_CSS;
    const rowAction = document.createElement('div'); rowAction.style.cssText = ROW_CSS;

    const tableWrap = document.createElement('div');
    tableWrap.style.cssText = 'overflow-x:auto;padding-bottom:4px;';
    tableWrap.appendChild(rowNums);
    tableWrap.appendChild(rowChar);
    tableWrap.appendChild(rowProd);
    tableWrap.appendChild(rowPose);
    tableWrap.appendChild(rowAction);

    const cardSelects = []; // stub — kept for generateBtn handler compatibility
    const _pendingActionBtns = {}; // cellIdx → actionBtn (for audio-ready updates)

    lines.forEach((line, i) => {
      const assignKey = `${f.file}__${i}`;
      const cardKey   = `${sessionKey}__${i}`;
      let detFile    = sessionData.assignments?.[assignKey] || scenarioAssignments[assignKey] || null;
      let detailInfo = detFile
        ? (cachedDetailFiles.find(d => d.file === detFile) || { file: detFile, path: `/details/${detFile}`, thumbPath: `/details/thumbs/${detFile.replace(/\.[^.]+$/, '')}.jpg`, name: detFile.replace(/\.[^.]+$/, '') })
        : null;
      const poseKey  = `edit_pose2__${cardKey}`;

      // Row 1: number
      const numCell = document.createElement('div');
      numCell.style.cssText = cellCss('font-size:9px;color:#808080;text-align:center;line-height:1.4;');
      numCell.textContent = i + 1;
      rowNums.appendChild(numCell);

      // Row 3: char image
      const charCell = document.createElement('div');
      charCell.style.cssText = cellCss('display:flex;justify-content:center;');
      const obrazBox = document.createElement('div');
      obrazBox.style.cssText = 'width:62px;height:82px;border:1px solid #808080;background:#ccc;overflow:hidden;flex-shrink:0;cursor:zoom-in;';
      const obrazImg = document.createElement('img');
      obrazImg.dataset.src = lineImages[i];
      obrazImg.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
      const allCharImgs = [activeObraz.char, ...(activeObraz.variations || []).filter(v => v && v !== 'error')].filter(Boolean);
      obrazImg.addEventListener('click', () => openImagePicker(
        allCharImgs, obrazImg, lineImages[i], selected => {
          lineImages[i] = selected;
          obrazImg.src = selected + '?t=' + Date.now();
          const cellRef = editFrozenSessions[sessionKey]?.cells?.[i];
          if (cellRef) { cellRef.charImagePath = selected; if (!cellRef.detInfo) cellRef.imagePath = selected; saveEditState(); }
          updateCell();
        }));
      lazyLoad(obrazImg);
      obrazBox.appendChild(obrazImg);
      charCell.appendChild(obrazBox);
      rowChar.appendChild(charCell);

      // Row 4: product image
      const prodCell = document.createElement('div');
      prodCell.style.cssText = cellCss('display:flex;justify-content:center;');
      const detailBox = document.createElement('div');
      const _renderDetailBox = () => {
        detailBox.innerHTML = '';
        if (detailInfo) {
          detailBox.style.cssText = 'width:62px;height:62px;border:1px solid #808080;background:#ccc;overflow:hidden;flex-shrink:0;cursor:pointer;';
          const di = document.createElement('img');
          di.src = detailInfo.thumbPath || detailInfo.path;
          di.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
          detailBox.appendChild(di);
        } else {
          detailBox.style.cssText = 'width:62px;height:62px;border:1px dashed #bbb;background:#ebebeb;flex-shrink:0;cursor:pointer;display:flex;align-items:center;justify-content:center;';
          const pl = document.createElement('span'); pl.textContent = '+'; pl.style.cssText = 'font-size:22px;color:#bbb;pointer-events:none;';
          detailBox.appendChild(pl);
        }
      };
      _renderDetailBox();
      detailBox.addEventListener('click', () => {
        if (!cachedDetailFiles.length) { setStatus('No uploaded items'); return; }
        openDetailPicker(cachedDetailFiles, detailBox, detFile, chosen => {
          const newFile = chosen ? chosen.file : null;
          if (newFile) { scenarioAssignments[assignKey] = newFile; } else { delete scenarioAssignments[assignKey]; }
          _saveAssignmentsToLS();
          saveScenarioAssignments();
          if (sessionData.assignments) {
            if (newFile) { sessionData.assignments[assignKey] = newFile; } else { delete sessionData.assignments[assignKey]; }
          }
          saveEditState();
          detFile    = newFile;
          detailInfo = newFile ? cachedDetailFiles.find(d => d.file === newFile) : null;
          _renderDetailBox();
          const csEntry = cardSelects.find(s => s.cardKey === cardKey);
          if (csEntry) csEntry.detFile = newFile;
          updateCell();
        });
      });
      prodCell.appendChild(detailBox);
      rowProd.appendChild(prodCell);

      // Row 5: pose dropdown (type depends on content)
      const poseCell = document.createElement('div');
      poseCell.style.cssText = cellCss();
      const poseSel = document.createElement('select');
      poseSel.style.cssText = 'width:66px;font-size:8px;height:20px;padding:0 2px;';
      poseSel.addEventListener('change', () => { localStorage.setItem(poseKey, poseSel.value); updateCell(); });
      poseCell.appendChild(poseSel);
      rowPose.appendChild(poseCell);

      // Row 6: action button 🗣
      const actionCell = document.createElement('div');
      actionCell.style.cssText = cellCss('display:flex;justify-content:center;');
      const pendingActionBtn = document.createElement('button');
      pendingActionBtn.textContent = '🗣';
      pendingActionBtn.style.cssText = 'width:62px;font-size:12px;padding:2px 0;cursor:pointer;';
      _pendingActionBtns[i] = pendingActionBtn;

      pendingActionBtn.addEventListener('click', async () => {
        if (pendingActionBtn.disabled) return;

        // Char-only + pose selected → generate pose image inline, don't freeze yet
        if (!detailInfo && lineImages[i] && poseSel.value) {
          const poseCardKey = `${f.file}__${i}__pose`;
          const prompt = POSE_CHAR_PROMPTS[poseSel.value] || '';
          await runGenSingle(obrazBox, pendingActionBtn, lineImages[i], prompt, 'char_pose', poseCardKey, null);
          const newPath = editCardCache[poseCardKey]?.imagePath;
          if (newPath) lineImages[i] = newPath;
          updateCell();
          return;
        }

        // Normal path: freeze session and re-render
        const sessionCells = lines.map((ln, lineIdx) => {
          const ak2 = `${f.file}__${lineIdx}`;
          const df2 = sessionData.assignments?.[ak2] || scenarioAssignments[ak2] || null;
          const di2 = df2 ? (cachedDetailFiles.find(d => d.file === df2) || { file: df2, path: `/details/${df2}`, thumbPath: `/details/thumbs/${df2.replace(/\.[^.]+$/, '')}.jpg`, name: df2.replace(/\.[^.]+$/, '') }) : null;
          const ck2  = `${sessionKey}__${lineIdx}`;
          const aud2 = editCardCache[`${sessionKey}__${lineIdx}__audio`]?.audioPath || null;
          const img2 = editCardCache[ck2]?.imagePath || null;
          return { line: ln, detInfo: di2, charImagePath: lineImages[lineIdx], imagePath: di2 ? (img2 || null) : lineImages[lineIdx], audioPath: aud2 };
        });
        editFrozenSessions[sessionKey] = {
          lines, cells: sessionCells, generating: false, done: false,
          date: sessionData.date || new Date().toISOString(),
          scenFile: f.file, obrazId: String(activeObraz.id),
          assignments: sessionData.assignments || {},
          templateSessionKey: sessionData.templateSessionKey || null,
          num: sessionData.num,
        };
        delete editFrozenSessions[sessionKey].pending;
        saveEditState();
        window._pendingAutoStart = { sessionKey, cellIdx: i };
        await renderEditPanel();
      });

      actionCell.appendChild(pendingActionBtn);
      rowAction.appendChild(actionCell);

      // Rebuild pose dropdown options and refresh action button state
      function updateCell() {
        const hasChar = !!lineImages[i];
        const hasProd = !!detailInfo;
        const poseOpts = (hasChar && hasProd) ? POSE_OPTS_BOTH
                       : hasChar              ? POSE_OPTS_CHAR_ONLY
                       : hasProd              ? POSE_OPTS_PRODUCT_ONLY
                       : null;
        poseSel.innerHTML = '';
        if (poseOpts) {
          poseOpts.forEach(o => {
            const op = document.createElement('option'); op.value = o.value; op.textContent = o.label;
            poseSel.appendChild(op);
          });
          const saved = localStorage.getItem(poseKey);
          if (saved !== null && poseOpts.find(o => o.value === saved)) {
            poseSel.value = saved;
          } else if (hasChar && hasProd) {
            poseSel.value = Math.random() < 0.5 ? 'left_hand' : 'right_hand_face';
          }
        }
        poseCell.style.display = poseOpts ? '' : 'none';
        // Update action btn
        const _hd = !!detailInfo;
        const _ha = !!editCardCache[`${sessionKey}__${i}__audio`]?.audioPath;
        const _hasPose = !_hd && hasChar && poseSel.value !== '';
        const _canAct = _hd || _ha || _hasPose;
        pendingActionBtn.disabled = !_canAct;
        pendingActionBtn.style.color = _canAct ? '' : '#aaa';
        // Descriptive tooltip
        const _poseLbl = poseSel.options[poseSel.selectedIndex]?.text || poseSel.value;
        if (_hd && _ha)
          pendingActionBtn.title = `Item assigned, voice recorded. Click to generate outfit + item image and launch talking head video for fragment ${i + 1}.`;
        else if (_hd)
          pendingActionBtn.title = `Item assigned. Click to generate outfit + item image and then create talking head video.`;
        else if (_hasPose)
          pendingActionBtn.title = `Pose "${_poseLbl}" selected. Click to generate a new outfit photo with this pose — without item.`;
        else if (_ha)
          pendingActionBtn.title = `Voice recorded, no item assigned. Click to create talking head video with the current outfit photo.`;
        else
          pendingActionBtn.title = `Button unavailable. Assign an item, select a pose from the dropdown, or generate voice for fragment ${i + 1} first.`;
      }
      updateCell();

      // Stub _wireRerun (no longer used but avoids undefined errors in runGen/runGenSingle calls)
      function _wireRerun(_resultBox) {}

      if (editCardCache[cardKey]) {
        // Restore cached result
        const cached = editCardCache[cardKey];
        charCell.innerHTML = '';
        const resultBox = document.createElement('div');
        resultBox.style.cssText = 'width:62px;height:82px;border:1px solid #808080;background:#ccc;overflow:hidden;flex-shrink:0;cursor:zoom-in;';
        const cImg = document.createElement('img');
        cImg.dataset.src = cached.imagePath + '?t=' + Date.now();
        cImg.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
        cImg.addEventListener('click', () => {
          const cellRef = editFrozenSessions[sessionKey]?.cells?.[i];
          const allImgs = cellRef?.generatedImages?.length
            ? cellRef.generatedImages
            : (cached.generatedImages?.length ? cached.generatedImages : null);
          const pickerImgs = allImgs || [activeObraz.char, ...(activeObraz.variations || []).filter(v => v && v !== 'error')].filter(Boolean);
          const currentPath = cellRef?.imagePath || cached.imagePath;
          openImagePicker(pickerImgs, cImg, currentPath, selected => {
            if (cellRef) { cellRef.imagePath = selected; }
            cImg.src = selected + '?t=' + Date.now();
            editCardCache[cardKey] = { ...(editCardCache[cardKey] || {}), imagePath: selected };
            saveEditState();
          });
        });
        lazyLoad(cImg);
        resultBox.appendChild(cImg);
        charCell.appendChild(resultBox);
        _wireRerun(resultBox);
      } else {
        // Pose-only cache restore (char-only previous gen)
        const poseCardKey = `${f.file}__${i}__pose`;
        if (editCardCache[poseCardKey]) {
          const cp = editCardCache[poseCardKey];
          obrazImg.src = cp.imagePath + '?t=' + Date.now();
          const pcImgs = [activeObraz.char, ...(activeObraz.variations || []).filter(v => v && v !== 'error')].filter(Boolean);
          obrazImg.onclick = () => openImagePicker(
            cp.generatedImages?.length ? cp.generatedImages : pcImgs, obrazImg, cp.imagePath, selected => {
              cp.imagePath = selected; obrazImg.src = selected + '?t=' + Date.now();
              editCardCache[poseCardKey] = cp; saveEditState();
            });
        }
        // No cached result — 🗣 button in rowAction will trigger generation
      }

      cardSelects.push({ cardKey, detFile });
    });

    block.appendChild(tableWrap);

    // ── Pending: Голоса panel ─────────────────────────────────────────────────
    {
      const _tlDataP  = getTimelineData();
      const _exclSetP = new Set(_tlDataP[sessionKey]?.excludedSegments || []);
      block._updateGovBtn = () => {}; // no-op stub (kept for runGen compatibility)

      // Голоса collapsible panel
      const голосаПанельP = document.createElement('div');
      голосаПанельP.style.cssText = 'margin-top:4px;';
      const голосаHdrP = document.createElement('div');
      голосаHdrP.style.cssText = 'display:flex;align-items:center;gap:4px;cursor:pointer;user-select:none;padding:3px 0;border-top:1px solid #c0c0c0;';
      const голосаArrowP = document.createElement('span');
      голосаArrowP.textContent = '▼'; голосаArrowP.style.cssText = 'font-size:9px;color:#555;flex-shrink:0;';
      const голосаLabelP = document.createElement('span');
      голосаLabelP.style.cssText = 'font-size:10px;font-weight:bold;color:#333;';
      голосаLabelP.textContent = 'Voices';
      голосаHdrP.appendChild(голосаArrowP); голосаHdrP.appendChild(голосаLabelP);

      const голосаТелоP = document.createElement('div');
      голосаТелоP.style.cssText = 'display:block;padding:2px 0;max-height:210px;overflow-y:auto;';

      голосаHdrP.addEventListener('click', () => {
        const open = голосаТелоP.style.display === 'none';
        голосаТелоP.style.display = open ? '' : 'none';
        голосаArrowP.textContent = open ? '▼' : '▶';
      });

      lines.forEach((line, idx) => {
        const rowEl = document.createElement('div');
        rowEl.style.cssText = 'display:flex;align-items:flex-start;gap:4px;margin-bottom:5px;';
        if (_exclSetP.has(idx)) rowEl.style.opacity = '0.5';

        const audioKey = `${sessionKey}__${idx}__audio`;

        const numEl = document.createElement('span');
        numEl.textContent = idx + 1;
        numEl.style.cssText = 'font-size:9px;color:#808080;min-width:14px;padding-top:5px;flex-shrink:0;';

        const makeAudP = (src) => {
          const a = document.createElement('audio'); a.controls = true; a.src = src;
          a.style.cssText = 'height:24px;width:110px;'; return a;
        };
        const audioArea = document.createElement('div');
        audioArea.style.cssText = 'flex-shrink:0;padding-top:2px;';

        const textEl = document.createElement('textarea');
        textEl.value = line;
        textEl.style.cssText = 'flex:1;font-size:9px;resize:vertical;height:22px;padding:2px;';

        const genBtn = document.createElement('button');
        genBtn.textContent = '🎙'; genBtn.title = 'Generate voice';
        genBtn.style.cssText = 'flex-shrink:0;width:22px;height:22px;padding:0;font-size:10px;cursor:pointer;';

        const _renderAudP = () => {
          audioArea.innerHTML = '';
          const saved = editCardCache[audioKey];
          if (saved?.audioPath) {
            audioArea.appendChild(makeAudP(saved.audioPath));
          } else if (saved?.audioError) {
            const e = document.createElement('span'); e.textContent = '❌'; e.style.cssText = 'font-size:9px;color:#aa0000;';
            audioArea.appendChild(e);
          } else {
            audioArea.innerHTML = '<span style="font-size:9px;color:#bbb;">—</span>';
          }
        };
        _renderAudP();

        const _runTtsP = async () => {
          const text = textEl.value.trim() || line;
          audioArea.innerHTML = '<span style="font-size:9px;color:#888;">⏳</span>';
          genBtn.disabled = true;
          const _doTtsReq = async () => {
            const r = await fetch('/api/audio/tts', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text, voice: getProjectVoice(), ttsParams: getProjectTtsParams(), model: getAudioEngine?.() }),
            });
            const d = await r.json();
            if (!d.success) throw new Error(d.error);
            return d.audioPath || await pollTts(d.taskId);
          };
          try {
            let audioPath;
            try { audioPath = await _doTtsReq(); }
            catch { await new Promise(r => setTimeout(r, 2500)); audioPath = await _doTtsReq(); }
            editCardCache[audioKey] = { audioPath };
            saveEditState();
            _renderAudP();
            const _pb = _pendingActionBtns[idx];
            if (_pb) { _pb.disabled = false; _pb.style.color = ''; }
          } catch (err) {
            editCardCache[audioKey] = { audioError: err.message };
            saveEditState(); _renderAudP();
          } finally { genBtn.disabled = false; }
        };

        genBtn.addEventListener('click', _runTtsP);

        rowEl.appendChild(numEl); rowEl.appendChild(genBtn);
        rowEl.appendChild(audioArea); rowEl.appendChild(textEl);
        голосаТелоP.appendChild(rowEl);
      });

      // ttsBtn bulk handler for pending state
      ttsBtn.addEventListener('click', async () => {
        ttsBtn.disabled = true; ttsBtn.textContent = '⏳';
        голосаТелоP.style.display = ''; голосаArrowP.textContent = '▼';
        await Promise.all(lines.map(async (line, idx) => {
          if (_exclSetP.has(idx)) return;
          const audioKey = `${sessionKey}__${idx}__audio`;
          try {
            const r = await fetch('/api/audio/tts', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text: line, voice: getProjectVoice(), ttsParams: getProjectTtsParams(), model: getAudioEngine?.() }),
            });
            const d = await r.json();
            if (!d.success) throw new Error(d.error);
            const audioPath = d.audioPath || await pollTts(d.taskId);
            editCardCache[audioKey] = { audioPath };
          } catch (err) {
            editCardCache[audioKey] = { audioError: err.message };
          }
          saveEditState();
        }));
        ttsBtn.disabled = false; ttsBtn.textContent = '🎙';
        renderEditPanel();
      });

      голосаПанельP.appendChild(голосаHdrP); голосаПанельP.appendChild(голосаТелоP);
      block.appendChild(голосаПанельP);
    }

    // ── Shared runGen: with retry, freeze update, reran support ──
    async function runGen(imgBox, reranBtn, detInfo, cardKey, useRandomPrompt, cellIdx, charImagePath, poseLabel) {
      const imageEngine = engineSel.value || getImageEngine?.() || 'seedream';
      const activePath  = charImagePath || activeObraz.char;
      imgBox.style.cssText = 'width:62px;height:82px;border:1px solid #808080;background:#ddd;overflow:hidden;flex-shrink:0;display:flex;align-items:center;justify-content:center;';
      imgBox.innerHTML = '<span style="font-size:9px;color:#888;">⏳</span>';
      if (reranBtn) reranBtn.disabled = true;

      let interactionLabel = (poseLabel != null) ? poseLabel : '';
      if (poseLabel == null && !useRandomPrompt) {
        const selEntry = cardSelects.find(s => s.cardKey === cardKey);
        interactionLabel = selEntry?.sel ? getMergedOptions(f.file)[Number(selEntry.sel.value || 0)]?.label || '' : '';
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
          if (sess && cellIdx != null && sess.cells?.[cellIdx]) {
            sess.cells[cellIdx].taskId = gd.taskId;
            saveEditState();
          }

          const _ar2 = window.createActivityRow?.(`Scene row ${cellIdx != null ? cellIdx + 1 : ''}`);
          const imagePath = await pollTask(gd.taskId, 3000, 120, _ar2);

          // Update frozen session cell (only if session has cells; pending sessions have no cells yet)
          if (sess && cellIdx != null) {
            const cellRef = sess.cells?.[cellIdx];
            // If cells array exists but this cell is gone — session was reset mid-generation, abort
            if (Array.isArray(sess.cells) && !cellRef) { imgBox.innerHTML = ''; return; }
            if (cellRef) {
              cellRef.imagePath = imagePath;
              delete cellRef.taskId;
              if (!cellRef.generatedImages) cellRef.generatedImages = [];
              if (!cellRef.generatedImages.includes(imagePath)) cellRef.generatedImages.push(imagePath);
            }
          }

          imgBox.innerHTML = '';
          imgBox.style.cssText = 'width:62px;height:82px;border:1px solid #808080;background:#ccc;overflow:hidden;flex-shrink:0;cursor:zoom-in;';
          const img = document.createElement('img');
          img.src = imagePath + '?t=' + Date.now(); // generated now — load immediately, no lazy
          img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
          img.addEventListener('click', () => {
            const cellRef2 = editFrozenSessions[sessionKey]?.cells?.[cellIdx];
            const imgs2 = cellRef2?.generatedImages?.length ? cellRef2.generatedImages : [imagePath];
            openImagePicker(imgs2, img, cellRef2?.imagePath || imagePath, selected => {
              if (cellRef2) { cellRef2.imagePath = selected; saveEditState(); }
              img.src = selected + '?t=' + Date.now();
            });
          });
          imgBox.appendChild(img);
          const prevCache = editCardCache[cardKey] || {};
          const allGenerated = [...new Set([...(prevCache.generatedImages || []), imagePath])];
          editCardCache[cardKey] = { imagePath, generatedImages: allGenerated };
          saveEditState();
          block._updateGovBtn?.();
          if (reranBtn) reranBtn.disabled = false;
          return; // success
        } catch (err) {
          lastErr = err;
          console.error(`[Edit] Error row ${(cellIdx ?? '?') + 1}, attempt ${attempt}: ${err.message}`);
          setStatus(`Row ${(cellIdx ?? '?') + 1}: attempt ${attempt}/3 — ${err.message}`);
          if (attempt < MAX_RETRIES) await new Promise(r => setTimeout(r, 3000));
        }
      }
      // All retries exhausted
      imgBox.style.cssText = 'width:62px;height:82px;border:1px solid #808080;background:#ddd;overflow:hidden;flex-shrink:0;display:flex;align-items:center;justify-content:center;';
      imgBox.innerHTML = '<span style="font-size:8px;color:#aa0000;text-align:center;padding:2px;">Error</span>';
      if (reranBtn) reranBtn.disabled = false;
    }

    // ── Single-image generation (char-only pose or product-only style) ──────────
    async function runGenSingle(imgBox, reranBtn, imagePath, assetType, prompt, cardKey, cellIdx) {
      const imageEngine = engineSel.value || getImageEngine?.() || 'seedream';
      imgBox.style.cssText = 'width:62px;height:82px;border:1px solid #808080;background:#ddd;overflow:hidden;flex-shrink:0;display:flex;align-items:center;justify-content:center;';
      imgBox.innerHTML = '<span style="font-size:9px;color:#888;">⏳</span>';
      if (reranBtn) reranBtn.disabled = true;
      const MAX_RETRIES = 3; let lastErr = null;
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          const gr = await fetch('/api/asset-interact/generate', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ activePath: imagePath, assetPath: null, prompt, assetType, imageEngine, engineParams: getEngineParams?.(imageEngine) || {} }),
          });
          const gd = await gr.json();
          if (!gd.success) throw new Error(gd.error);
          const sess = editFrozenSessions[sessionKey];
          if (sess && cellIdx != null && sess.cells?.[cellIdx]) { sess.cells[cellIdx].taskId = gd.taskId; saveEditState(); }
          const _ar = window.createActivityRow?.(`Gen. cell ${cellIdx != null ? cellIdx + 1 : ''}`);
          const resultPath = await pollTask(gd.taskId, 3000, 120, _ar);
          if (sess && cellIdx != null) {
            const cr = sess.cells?.[cellIdx]; if (!cr) return; cr.imagePath = resultPath; delete cr.taskId;
            if (!cr.generatedImages) cr.generatedImages = [];
            if (!cr.generatedImages.includes(resultPath)) cr.generatedImages.push(resultPath);
          }
          imgBox.innerHTML = '';
          imgBox.style.cssText = 'width:62px;height:82px;border:1px solid #808080;background:#ccc;overflow:hidden;flex-shrink:0;cursor:zoom-in;';
          const img = document.createElement('img');
          img.src = resultPath + '?t=' + Date.now();
          img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
          img.addEventListener('click', () => {
            const cr2 = editFrozenSessions[sessionKey]?.cells?.[cellIdx];
            const imgs2 = cr2?.generatedImages?.length ? cr2.generatedImages : [resultPath];
            openImagePicker(imgs2, img, cr2?.imagePath || resultPath, selected => {
              if (cr2) { cr2.imagePath = selected; saveEditState(); }
              img.src = selected + '?t=' + Date.now();
            });
          });
          imgBox.appendChild(img);
          editCardCache[cardKey] = { imagePath: resultPath }; saveEditState();
          if (reranBtn) reranBtn.disabled = false;
          return;
        } catch (err) {
          lastErr = err;
          setStatus(`Cell ${(cellIdx ?? '?') + 1}: attempt ${attempt}/3 — ${err.message}`);
          if (attempt < MAX_RETRIES) await new Promise(r => setTimeout(r, 3000));
        }
      }
      imgBox.style.cssText = 'width:62px;height:82px;border:1px solid #808080;background:#ddd;overflow:hidden;flex-shrink:0;display:flex;align-items:center;justify-content:center;';
      imgBox.innerHTML = '<span style="font-size:8px;color:#aa0000;text-align:center;padding:2px;">Error</span>';
      if (reranBtn) reranBtn.disabled = false;
    }

    // ── ▶ handler: freeze session and show frozen view (per-cell 🗣 buttons handle generation) ──
    generateBtn.addEventListener('click', async () => {
      generateBtn.disabled = true; generateBtn.textContent = '⏳';
      const sessionCells = lines.map((line, i) => {
        const ak = `${f.file}__${i}`;
        const df = sessionData.assignments?.[ak] || scenarioAssignments[ak] || null;
        const di = df ? (cachedDetailFiles.find(d => d.file === df) || { file: df, path: `/details/${df}`, thumbPath: `/details/thumbs/${df.replace(/\.[^.]+$/, '')}.jpg`, name: df.replace(/\.[^.]+$/, '') }) : null;
        const ck = `${sessionKey}__${i}`;
        const img = editCardCache[ck]?.imagePath || null;
        const aud = editCardCache[`${sessionKey}__${i}__audio`]?.audioPath || null;
        return { line, detInfo: di, charImagePath: lineImages[i], imagePath: di ? (img || null) : lineImages[i], audioPath: aud };
      });
      editFrozenSessions[sessionKey] = {
        lines, cells: sessionCells, generating: false, done: false,
        date: sessionData.date || new Date().toISOString(),
        scenFile: f.file, obrazId: String(activeObraz.id),
        assignments: sessionData.assignments || {},
        templateSessionKey: sessionData.templateSessionKey || null,
        num: sessionData.num,
      };
      delete editFrozenSessions[sessionKey].pending;
      saveEditState();
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
  setStatus('Analysing interactions…');
  const _arAn = window.createActivityRow?.('Interaction analysis');
  const uniqueDetails = [...new Set(
    lines.map((_, i) => {
      const k = `${f.file}__${i}`;
      return sessionAssignments[k] || scenarioAssignments[k];
    }).filter(Boolean)
  )];
  console.log('[doAnalyze] f.file:', f.file, '| uniqueDetails:', uniqueDetails, '| sessionAssignments:', sessionAssignments, '| scenarioAssignments:', scenarioAssignments);
  if (!uniqueDetails.length) {
    setStatus('No items assigned for analysis.');
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
        body: JSON.stringify({ activePath: activeObraz.char, assetPath: detInfo.path, assetSize: detInfo.size || '' }),
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
    setStatus(`Added variants: ${fresh.length}`);
    _arAn?.finalize?.(`✅ +${fresh.length} variants`);
  } catch (err) {
    setStatus('Analysis error: ' + err.message);
    _arAn?.finalize?.('❌ ' + err.message);
  } finally {
    analyzeBtn.disabled = false; analyzeBtn.textContent = '🔍';
  }
}

// ── Poll task until success/failed ────────────────────────────────────────────
async function pollTask(taskId, intervalMs = 3000, maxAttempts = 120, actRow = null) {
  let netErrors = 0;
  for (let i = 0; i < maxAttempts; ) {
    await new Promise(r => setTimeout(r, intervalMs));
    let d;
    try {
      const r = await fetch(`/api/asset-interact/status/${taskId}`);
      d = await r.json();
      netErrors = 0; i++;
    } catch {
      if (++netErrors > 120) { actRow?.finalize?.('❌ Timeout (no connection)'); throw new Error('Generation timeout (no connection)'); }
      continue;
    }
    if (d.state === 'success') { actRow?.setImage?.(d.imagePath); actRow?.finalize?.('✅ Done'); return d.imagePath; }
    if (d.state === 'failed')  { actRow?.finalize?.('❌ ' + (d.error || 'Error')); throw new Error(d.error || 'failed'); }
  }
  actRow?.finalize?.('❌ Timeout');
  throw new Error('Generation timeout');
}

async function pollTts(taskId, intervalMs = 3000, maxAttempts = 120, actRow = null) {
  let netErrors = 0;
  for (let i = 0; i < maxAttempts; ) {
    await new Promise(r => setTimeout(r, intervalMs));
    let d;
    try {
      const r = await fetch(`/api/audio/tts/status/${taskId}`);
      d = await r.json();
      netErrors = 0; i++;
    } catch {
      if (++netErrors > 120) { actRow?.finalize?.('❌ TTS timeout (no connection)'); throw new Error('TTS timeout (no connection)'); }
      continue;
    }
    if (d.state === 'success') { actRow?.finalize?.('✅ TTS'); return d.audioPath; }
    if (d.state === 'failed')  { actRow?.finalize?.('❌ TTS'); throw new Error(d.error || 'TTS failed'); }
  }
  actRow?.finalize?.('❌ TTS timeout');
  throw new Error('TTS timeout');
}

async function pollAvatar(taskId, intervalMs = 5000, maxAttempts = 120, actRow = null) {
  let netErrors = 0;
  for (let i = 0; i < maxAttempts; ) {
    await new Promise(r => setTimeout(r, intervalMs));
    let d;
    try {
      const r = await fetch(`/api/audio/avatar/status/${taskId}`);
      d = await r.json();
      netErrors = 0; i++;
    } catch {
      if (++netErrors > 72) { actRow?.finalize?.('❌ Avatar (no connection)'); throw new Error('Avatar timeout (no connection)'); }
      continue;
    }
    if (d.state === 'success') { actRow?.setVideo?.(d.videoPath); actRow?.finalize?.('✅ Avatar'); return d.videoPath; }
    if (d.state === 'failed')  { actRow?.finalize?.('❌ Avatar'); throw new Error(d.error || 'Avatar failed'); }
  }
  actRow?.finalize?.('❌ Avatar timeout');
  throw new Error('Avatar timeout');
}

// ── Rerun avatar for a specific cell — callable from Склейка ──────────────
// newImagePath: optional override; if omitted, uses cell.imagePath / cell.charImagePath
// onProgress(msg): optional status callback
window.rerunAvatarForCell = async function(sessionKey, cellIdx, newImagePath, onProgress) {
  const frozen = editFrozenSessions[sessionKey];
  if (!frozen || !frozen.cells) return { success: false, error: 'Session not found' };
  const cell = frozen.cells[cellIdx];
  if (!cell || !cell.audioPath) return { success: false, error: 'No audio for this fragment' };

  if (newImagePath) {
    cell.imagePath = newImagePath;
    cell.charImagePath = newImagePath;
    saveEditState();
  }

  const imgPath = cell.imagePath || cell.charImagePath;
  if (!imgPath) return { success: false, error: 'No image for avatar' };

  const videoParams   = getEngineParams?.('kling/ai-avatar-pro') || {};
  const defaultPrompt = videoParams.prompt || 'Natural speaking motion with subtle head movement and relaxed posture';

  onProgress?.('Generating prompt…');
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
    onProgress?.('Launching avatar…');
    const r = await fetch('/api/audio/avatar', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imagePath: imgPath, audioPath: cell.audioPath, prompt, videoParams }),
    });
    const d = await r.json();
    if (!d.success) throw new Error(d.error);
    cell.avatarTaskId  = d.taskId;
    cell._videoPending = true;
    saveEditState();
    onProgress?.('Waiting for result…');
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
    if (!err.message?.includes('no connection')) delete cell.avatarTaskId;
    delete cell._videoPending;
    saveEditState();
    renderMontagePanel?.(); renderAllTimelines?.();
    return { success: false, error: err.message };
  }
};

// Expose polling helpers so scen-timeline.js can use them in Склейка Реран popup
window.pollTask   = pollTask;
window.pollTts    = pollTts;
window.pollAvatar = pollAvatar;
