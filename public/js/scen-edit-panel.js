/* scen-edit-panel.js — buildCellComponent (per-cell component factory), renderEditPanel (with runGen + runSingleAvatar inside), doAnalyze, pollTask/pollTts/pollAvatar */

// ── Per-session voice preview cache (voice name → audio URL) ─────────────────
const _voicePreviewCache = new Map();

// ── Global generation lock — tracks cells being individually generated ─────────
// Key: `${sessionKey}__${cellIdx}`. Persists across renderEditPanel calls.
// Used to defer panel re-renders and prevent bulk-gen from touching active cells.
const _editCellsRunning = new Set();

// ── Items/noitems mode resolver ──────────────────────────────────────────────
// Sessions created with itemsMode='noitems' must NEVER show prop assignments,
// even if scenarioAssignments LS contains entries for the same scenFile (left
// over from manual detail-view edits or earlier 'items'-mode sessions).
// Legacy sessions (no itemsMode field) fall back to 'items' behaviour so
// pre-existing projects keep rendering as before.
function _resolveAssignment(sessionData, key) {
  const fromSnap = sessionData?.assignments?.[key];
  if (fromSnap) return fromSnap;
  if (sessionData?.itemsMode === 'noitems') return null; // hard block fallback
  return scenarioAssignments[key] || null;
}

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
      setTimeout(() => { if (delBtn.dataset.confirm === '1') { delBtn.dataset.confirm = ''; delBtn.textContent = '🗑'; delBtn.style.background = '#f8e8e8'; } }, 3000);
      return;
    }
    delBtn.dataset.confirm = '';
    delBtn.textContent = '🗑';
    delBtn.style.background = '#f8e8e8';
    const key = sel.value;
    if (!key || !editFrozenSessions[key]) return;
    // Immediately remove option from dropdown for instant visual feedback
    sel.querySelector(`option[value="${CSS.escape(key)}"]`)?.remove();
    if (!sel.options.length) bar.remove();
    delete editFrozenSessions[key];
    // Remove any running cell locks for this session so renderEditPanel isn't blocked
    [..._editCellsRunning].filter(k => k.startsWith(key + '__')).forEach(k => _editCellsRunning.delete(k));
    // Directly remove the project card from DOM (works even when panel isn't visible)
    document.getElementById('scen-panel-edit')
      ?.querySelector(`[data-session-key="${CSS.escape(key)}"]`)?.remove();
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
    projectWrap.dataset.sessionKey = sessionKey;

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

    // ── Star button: available only when ALL audio cells have a videoPath (no exceptions)
    const avatarsDone = (() => {
      if (!frozen?.cells) return false;
      const audioCells = frozen.cells.filter(c => c.audioPath);
      return audioCells.length > 0 &&
        audioCells.every(c => !c._videoPending && !c.avatarTaskId) &&
        audioCells.every(c => c.videoPath);
    })();
    // Auto-star on first render when avatars are done and the user hasn't decided yet.
    // Covers: (a) legacy sessions, (b) videos completed while Edit tab was closed.
    if (avatarsDone) _autoStarIfAvatarsDone(sessionKey);
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
    delProjBtn.textContent = '✕';
    delProjBtn.title = 'Hide from Edit (project stays in Merge)';
    delProjBtn.style.cssText = 'font-size:11px;padding:1px 6px;cursor:pointer;flex-shrink:0;color:#aa0000;';
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

    // ── Run All button: 3-phase state machine ──
    // ph1 = generate all voices  •  ph2 = generate all mix images  •  ph3 = generate all videos
    // State derived from actual data each render. Sequential SUBMISSION.
    //   • Pending state (before user clicks 🗣 to freeze): only ph1 makes sense
    //     — phases 2/3 require frozen cells. After all voices done in pending,
    //     button is hidden (user must click 🗣 to enter frozen state for ph2/ph3).
    //   • Frozen state: full ph1 → ph2 → ph3 → done sequence.
    const _getRunAllPhase = () => {
      const tlData = getTimelineData();
      const exclSet = new Set(tlData[sessionKey]?.excludedSegments || []);

      if (frozen?.cells) {
        const cells = frozen.cells.filter((c, i) => !exclSet.has(i) && c.line);
        if (cells.length === 0) return null;
        if (!cells.every(c => c.audioPath)) return 'ph1';
        if (!cells.every(c => !c.detInfo || c.mixes?.[c.detInfo.file])) return 'ph2';
        if (!cells.every(c => c.videoPath)) return 'ph3';
        return 'done';
      }

      // Pending state: detect ph1 by missing audio in editCardCache (or null if all done)
      if (lines && lines.length) {
        const allAudio = lines.every((_, i) => {
          if (exclSet.has(i)) return true;
          const audioKey = `${sessionKey}__${i}__audio`;
          return !!editCardCache[audioKey]?.audioPath;
        });
        return allAudio ? null : 'ph1';
      }
      return null;
    };

    const runAllBtn = document.createElement('button');
    runAllBtn.style.cssText =
      'font-size:9px;font-weight:bold;padding:1px 7px;flex-shrink:0;cursor:pointer;' +
      'border:1px solid #aa1010;border-radius:2px;background:#cc1818;color:#fff;height:20px;';
    // Running flag persisted across re-renders via window (so UI knows during async ops).
    window._runAllRunning = window._runAllRunning || {};
    const _isRunAllRunning = () => !!window._runAllRunning[sessionKey];
    // Registry of latest _refreshRunAllBtn per session. When a panel re-render
    // creates a fresh runAllBtn (e.g. _autoStarIfAvatarsDone triggers
    // renderEditPanel mid-phase), this slot is overwritten with the new
    // function. All async callers should refresh via window._refreshRunAllBtn[
    // sessionKey] so the *current* DOM button is updated, not the orphaned one.
    window._refreshRunAllBtn = window._refreshRunAllBtn || {};

    const _refreshRunAllBtn = () => {
      const phase = _getRunAllPhase();
      if (phase === null) { runAllBtn.style.display = 'none'; return; }
      runAllBtn.style.display = '';
      if (_isRunAllRunning()) {
        runAllBtn.textContent = '⏳';
        runAllBtn.title = 'Running…  click to stop (asks confirmation)';
        runAllBtn.style.background = '#888';
        runAllBtn.style.borderColor = '#666';
        runAllBtn.disabled = false;  // can be clicked to stop
        return;
      }
      if (phase === 'done') {
        runAllBtn.textContent = '✓';
        runAllBtn.title = 'All fragments fully generated';
        runAllBtn.style.background = '#1a8a1a';
        runAllBtn.style.borderColor = '#0a6a0a';
        runAllBtn.disabled = true;
      } else {
        runAllBtn.textContent = phase; // 'ph1' | 'ph2' | 'ph3'
        runAllBtn.title =
          phase === 'ph1' ? 'Run all: generate all voices for this project'
        : phase === 'ph2' ? 'Run all: generate all mix images for this project'
                          : 'Run all: generate all talking-head videos for this project';
        runAllBtn.style.background = '#cc1818';
        runAllBtn.style.borderColor = '#aa1010';
        runAllBtn.disabled = false;
      }
    };
    // Register the LATEST refresh fn for this session so async callers from
    // any "generation" of this panel (orphaned closures after renderEditPanel
    // mid-phase) end up updating the currently-mounted button.
    window._refreshRunAllBtn[sessionKey] = _refreshRunAllBtn;
    const _refreshLatestRunAllBtn = () => window._refreshRunAllBtn[sessionKey]?.();

    runAllBtn.addEventListener('click', async (e) => {
      // Prevent click from bubbling to projectToggle (which would collapse the project)
      e.stopPropagation();
      if (_isRunAllRunning()) {
        // Two-click cancel confirmation. Current fragment finishes (POST sent),
        // then loop stops. Already-submitted fragments continue polling normally.
        if (runAllBtn._cancelArmed) {
          window._runAllAbort = window._runAllAbort || {};
          window._runAllAbort[sessionKey] = true;
          runAllBtn._cancelArmed = false;
          runAllBtn.textContent = '⏳⏹';
          runAllBtn.title = 'Stopping after current fragment…';
        } else {
          runAllBtn._cancelArmed = true;
          runAllBtn.textContent = 'really?';
          runAllBtn.title = 'Click again to stop. Current fragment will finish.';
          // Auto-revert to ⏳ after 3 seconds if no second click
          setTimeout(() => {
            if (runAllBtn._cancelArmed && _isRunAllRunning()) {
              runAllBtn._cancelArmed = false;
              _refreshLatestRunAllBtn();
            }
          }, 3000);
        }
        return;
      }
      const phase = _getRunAllPhase();
      if (!phase || phase === 'done') return;
      window._runAllRunning[sessionKey] = true;
      _refreshLatestRunAllBtn();
      try {
        if (phase === 'ph1') {
          // Delegate to the underlying voices-generation function. The old
          // 🔊 _genVoicesTopBtn button was removed (workflow consolidated
          // into ph1/ph2/ph3), but `_handleGenVoices` is still defined and
          // wired by the frozen-state setup further down in renderEditPanel.
          // If a previous run is still flagged as in-flight, set the abort
          // flag so it cancels gracefully; otherwise kick a fresh run.
          if (_genVoicesRunning) {
            _genVoicesAbort = true;
          } else if (typeof _handleGenVoices === 'function') {
            await _handleGenVoices();
          }
          // Wait until the flag clears in case `_handleGenVoices` returned
          // synchronously while internal polling is still active.
          await new Promise(resolve => {
            const _poll = setInterval(() => {
              if (!_genVoicesRunning) { clearInterval(_poll); resolve(); }
            }, 200);
          });
        } else if (phase === 'ph2') {
          // Phase 2: sequential SUBMISSION of mix images, parallel polling
          const _ph2Fn = window._runPhase2?.[sessionKey];
          if (typeof _ph2Fn === 'function') {
            await _ph2Fn();
          } else {
            console.warn('Phase 2 handler not yet bound for session', sessionKey);
          }
        } else if (phase === 'ph3') {
          // Phase 3: sequential SUBMISSION of Kling avatar videos, parallel polling
          const _ph3Fn = window._runPhase3?.[sessionKey];
          if (typeof _ph3Fn === 'function') {
            await _ph3Fn();
          } else {
            console.warn('Phase 3 handler not yet bound for session', sessionKey);
          }
        }
      } finally {
        window._runAllRunning[sessionKey] = false;
        // Clear abort flag for next run
        if (window._runAllAbort) delete window._runAllAbort[sessionKey];
        runAllBtn._cancelArmed = false;
        // Route through registry — if the panel was re-rendered mid-phase
        // (e.g. _autoStarIfAvatarsDone triggered renderEditPanel), this hits
        // the currently-mounted button, not the orphaned one we were attached to.
        _refreshLatestRunAllBtn();
        // Belt-and-suspenders for the ★ button: if phase work brought all
        // avatars in, ensure the panel is freshly rendered so the activateBtn
        // closes over the latest avatarsDone snapshot.
        {
          const _s = editFrozenSessions[sessionKey];
          const _audioCells = _s?.cells?.filter(c => c.audioPath) || [];
          const _allDone = _audioCells.length > 0 &&
            _audioCells.every(c => c.videoPath && !c._videoPending && !c.avatarTaskId);
          if (_allDone) renderEditPanel();
        }
      }
    });

    _refreshRunAllBtn(); // initial sync to current data state

    projectToggle.appendChild(runAllBtn);
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
    // flex column → enables `style.order` on children to control visual order
    // independently of DOM-insertion order (mirrors Merge tab's LAYOUT_ORDER pattern).
    block.style.cssText = 'margin-bottom:0;display:flex;flex-direction:column;';

    // Layout order registry — single source of truth for block-child positioning.
    // Step of 10 lets us insert new sections later without renumbering.
    // BOTH states (uniform layout): hdr → voiceRow → voicesPanel → fragments
    //   FROZEN  (after ▶/🗣 freeze): hdr(10) → voiceRow(20) → голосаPanel(30) → frozenRow(40)
    //   PENDING (after Создание):    hdr(10) → voiceRow(20) → голосаПанельP(30) → tableWrap(40)
    const EDIT_BLOCK_ORDER = {
      hdr:           10,
      voiceRow:      20,
      voicesPanel:   30,   // frozen
      pendingVoices: 30,   // pending — same slot as voicesPanel
      frozenRow:     40,   // frozen
      tableWrap:     40,   // pending — same slot as frozenRow
    };

    // ── Project controls header ──
    const hdr = document.createElement('div');

    // Per-project engine selector (row 2). Dropdown is rebuilt from
    // window.ENGINE_SCHEMAS — only entries whose `kind` is image AND whose
    // capabilities include 'i2i' make the cut (this tab is i2i-only).
    const engineSel = document.createElement('select');
    engineSel.style.cssText = 'font-size:9px;height:22px;padding:0 2px;flex:1;min-width:0;';
    engineSel.title = 'Engine for this project (i2i only)';
    // Short display labels — fallback to the schema's label when unknown.
    const _shortEngineLabel = {
      'nano-banana-2': 'nano-banana-2 i2i',
      'qwen2':         'Qwen2 i2i',
      'seedream':      'Seedream 5 Lite i2i',
      'gptimage2':     'GPT Image 2 i2i',
    };
    const _schemas = (typeof window !== 'undefined' && window.ENGINE_SCHEMAS) ? window.ENGINE_SCHEMAS : {};
    const _i2iEngines = Object.keys(_schemas)
      .filter(id => _schemas[id]?.kind === 'image' && Array.isArray(_schemas[id]?.capabilities) && _schemas[id].capabilities.includes('i2i'));
    // Hard-coded fallback if ENGINE_SCHEMAS isn't loaded yet (script-order safety).
    const _engineIds = _i2iEngines.length ? _i2iEngines : ['nano-banana-2','qwen2','seedream','gptimage2'];
    _engineIds.forEach(id => {
      const o = document.createElement('option');
      o.value = id;
      o.textContent = _shortEngineLabel[id] || (_schemas[id]?.label || id);
      engineSel.appendChild(o);
    });
    const engineStorageKey = `edit_engine__${sessionKey}`;
    engineSel.value = localStorage.getItem(engineStorageKey) || 'seedream';
    engineSel.addEventListener('change', () => localStorage.setItem(engineStorageKey, engineSel.value));

    // ── Global avatar (talking-head) state ───────────────────────────────────
    // The model + its params persist GLOBALLY (not per-project) so a new
    // project inherits the same talking-head choice. Voice settings stay
    // per-project (handled below in voiceSel/ttsParams).
    const avatarModelStorageKey  = 'edit_avatar_model_global';
    const avatarParamsStorageKey = 'edit_avatar_params_global';

    function getAvatarModel() {
      const v = localStorage.getItem(avatarModelStorageKey);
      const allowed = ['kling/ai-avatar-standard', 'kling/ai-avatar-pro', 'prunaai/p-video-avatar'];
      return allowed.includes(v) ? v : 'kling/ai-avatar-standard';
    }
    function getAvatarParams(modelId) {
      try {
        const all = JSON.parse(localStorage.getItem(avatarParamsStorageKey) || '{}');
        return all[modelId] || {};
      } catch { return {}; }
    }
    function setAvatarParams(modelId, params) {
      let all = {};
      try { all = JSON.parse(localStorage.getItem(avatarParamsStorageKey) || '{}'); } catch {}
      all[modelId] = params;
      localStorage.setItem(avatarParamsStorageKey, JSON.stringify(all));
    }
    // Seed: random per project (different fragments share it). Lazily created
    // and STORED PER-PROJECT (different from model/params which are global).
    // Same seed across all fragments of one project gives a consistent face,
    // but each new project gets a fresh seed.
    const avatarSeedStorageKey = `edit_avatar_seed__${sessionKey}`;
    function ensureProjectSeed() {
      let s = parseInt(localStorage.getItem(avatarSeedStorageKey) || '0', 10);
      if (!s) {
        s = Math.floor(Math.random() * 1e9);
        localStorage.setItem(avatarSeedStorageKey, String(s));
      }
      return s;
    }
    window._editAvatarFor = window._editAvatarFor || {};
    window._editAvatarFor[sessionKey] = { getAvatarModel, getAvatarParams, ensureProjectSeed };

    // ── Gen-settings popup: 2-column (image | video) ──────────────────────────
    // LEFT  — image engine + params + negative prompt (existing image flow).
    // RIGHT — talking-head model dropdown, per-model params, max cost based
    //         on sum of audio fragment durations, motion prompt textarea
    //         (loaded from scenarios-meta.json, override-saves back to it).
    const negPromptBtn = document.createElement('button');
    negPromptBtn.textContent = 'gen settings';
    negPromptBtn.title = 'Image + video generation settings';
    const _applyNegBtnColor = (val) => {
      negPromptBtn.style.cssText = `font-size:9px;height:22px;padding:0 6px;border:1px solid #555;border-radius:3px;cursor:pointer;background:${val ? '#b85c00' : '#333'};color:#fff;flex-shrink:0;`;
    };
    fetch('/api/settings').then(r => r.json()).then(d => _applyNegBtnColor(d.settings?.editNegativePrompt || '')).catch(() => {});

    // Compute audio duration on demand and cache on the cell.
    async function _getCellAudioSec(cell) {
      if (cell._audioSec > 0) return cell._audioSec;
      if (!cell?.audioPath) return 0;
      const sec = await new Promise(resolve => {
        const a = new Audio(cell.audioPath);
        a.addEventListener('loadedmetadata', () => resolve(a.duration || 0), { once: true });
        a.addEventListener('error', () => resolve(0), { once: true });
        a.load();
      });
      cell._audioSec = sec;
      return sec;
    }
    // Sum durations of every cell that already has audioPath (used for Max cost).
    async function _sumProjectAudioSec() {
      const sess = editFrozenSessions[sessionKey];
      if (!sess?.cells?.length) return { total: 0, pending: 0 };
      let total = 0, pending = 0;
      for (const c of sess.cells) {
        if (c.audioPath) total += await _getCellAudioSec(c);
        else pending++;
      }
      return { total, pending };
    }

    // ── Per-project onboarding tip (English, one-shot) ─────────────────────────
    const ONBOARDED_KEY = `edit_gen_settings_onboarded__${sessionKey}`;
    function _showOnboardingTip() {
      if (localStorage.getItem(ONBOARDED_KEY) === '1') return;
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;z-index:10001;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;';
      const win = document.createElement('div');
      win.style.cssText = 'background:#c0c0c0;border:2px solid;border-color:#fff #808080 #808080 #fff;box-shadow:4px 4px 16px rgba(0,0,0,0.5);width:480px;max-width:92vw;font-family:inherit;color:#222;';
      const tb = document.createElement('div');
      tb.style.cssText = 'background:#000080;color:#fff;padding:4px 8px;font-size:12px;font-weight:bold;';
      tb.textContent = 'Quick start — Edit tab workflow';
      win.appendChild(tb);
      const body2 = document.createElement('div');
      body2.style.cssText = 'padding:14px 16px;font-size:11px;line-height:1.55;';
      body2.innerHTML =
        '<p style="margin:0 0 10px 0;">Settings saved. Here is the recommended flow to run this project:</p>' +
        '<ol style="margin:0 0 10px 18px;padding:0;">' +
        '<li>Click the <b>ph1</b> button at the top of the project header — it generates voices for every fragment.</li>' +
        '<li>When voices are ready the same button becomes <b>ph2</b> — click it to generate mix images for the cells.</li>' +
        '<li>When mixes are ready it becomes <b>ph3</b> — click it to generate the talking-head videos.</li>' +
        '</ol>' +
        '<p style="margin:0 0 10px 0;">You can also run any single fragment manually via its 🎙 / 🖼 / 🎬 buttons in the cell — no need to use ph1-ph3 if you prefer.</p>' +
        '<p style="margin:0 0 0 0;font-size:10px;color:#555;font-style:italic;">This message won\'t appear again for this project.</p>';
      win.appendChild(body2);
      const ft = document.createElement('div');
      ft.style.cssText = 'padding:8px 10px;border-top:1px solid #808080;display:flex;justify-content:flex-end;gap:6px;background:#c0c0c0;';
      const okBtn = document.createElement('button');
      okBtn.textContent = 'OK';
      okBtn.style.cssText = 'font-size:11px;padding:5px 22px;cursor:pointer;font-weight:bold;';
      okBtn.addEventListener('click', () => {
        localStorage.setItem(ONBOARDED_KEY, '1');
        overlay.remove();
      });
      ft.appendChild(okBtn);
      win.appendChild(ft);
      overlay.appendChild(win);
      document.body.appendChild(overlay);
    }

    negPromptBtn.addEventListener('click', async () => {
      const _ex = document.getElementById('edit-gen-settings-popup');
      if (_ex) { _ex.remove(); return; }

      const popup = document.createElement('div');
      popup.id = 'edit-gen-settings-popup';
      popup.style.cssText =
        'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:9999;' +
        'background:#c0c0c0;border:2px solid;border-color:#fff #808080 #808080 #fff;' +
        'width:1300px;max-width:96vw;max-height:92vh;display:flex;flex-direction:column;' +
        'box-shadow:4px 4px 16px rgba(0,0,0,0.5);font-family:inherit;color:#222;';

      // ── Titlebar ─────────────────────────────────────────────────────────────
      const titlebar = document.createElement('div');
      titlebar.style.cssText = 'background:#000080;color:#fff;padding:4px 8px;font-size:12px;font-weight:bold;display:flex;align-items:center;justify-content:space-between;';
      const titleTxt = document.createElement('span');
      titleTxt.textContent = 'gen settings';
      titlebar.appendChild(titleTxt);
      const closeX = document.createElement('button');
      closeX.textContent = '✕';
      closeX.style.cssText = 'background:#c0c0c0;color:#000;border:1px solid;border-color:#fff #808080 #808080 #fff;cursor:pointer;font-size:11px;padding:0 6px;line-height:1;';
      closeX.addEventListener('click', () => popup.remove());
      titlebar.appendChild(closeX);
      popup.appendChild(titlebar);

      // ── Body grid: THREE columns (image | voice | talking-head) ─────────────
      const body = document.createElement('div');
      body.style.cssText = 'padding:10px;overflow-y:auto;flex:1;font-size:11px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;';
      popup.appendChild(body);

      // ╔════════════════════ LEFT — IMAGE ════════════════════╗
      const leftCol = document.createElement('div');
      leftCol.style.cssText = 'display:flex;flex-direction:column;gap:8px;min-width:0;';
      body.appendChild(leftCol);

      const leftHdr = document.createElement('div');
      leftHdr.textContent = '🖼 Image generation';
      leftHdr.style.cssText = 'font-weight:bold;font-size:12px;background:#000080;color:#fff;padding:3px 6px;';
      leftCol.appendChild(leftHdr);

      // Image engine dropdown (moved from project header into the popup).
      const imgEngineDropRow = document.createElement('div');
      imgEngineDropRow.style.cssText = 'display:flex;align-items:center;gap:6px;';
      const imgEngineLbl = document.createElement('label');
      imgEngineLbl.textContent = 'Engine:';
      imgEngineLbl.style.cssText = 'font-size:11px;font-weight:bold;flex-shrink:0;';
      imgEngineDropRow.appendChild(imgEngineLbl);
      imgEngineDropRow.appendChild(engineSel);   // <-- the existing engineSel
      leftCol.appendChild(imgEngineDropRow);

      const imgEngHost = document.createElement('div');
      imgEngHost.style.cssText = 'padding:6px 8px;background:#f4f4f4;border:1px solid #d0d0d0;';
      leftCol.appendChild(imgEngHost);

      let _imgEngineRow = null;
      async function _renderImgEngineParams() {
        const engineId = engineSel.value;
        const imgSchema = window.ENGINE_SCHEMAS?.[engineId];
        imgEngHost.innerHTML = '';
        _imgEngineRow = null;
        if (window.buildEngineSettingsRow && imgSchema) {
          const saved = await (window.fetchEngineDefaults?.(engineId) || Promise.resolve({}));
          _imgEngineRow = window.buildEngineSettingsRow(engineId, saved, null);
          imgEngHost.appendChild(_imgEngineRow.node);
        } else {
          imgEngHost.textContent = '(no schema available)';
        }
      }
      // Re-render params when user picks a different image engine.
      engineSel.addEventListener('change', () => _renderImgEngineParams());
      await _renderImgEngineParams();

      const negHdr = document.createElement('div');
      negHdr.textContent = 'Negative prompt';
      negHdr.style.cssText = 'font-weight:bold;font-size:11px;border-bottom:1px solid #888;padding-bottom:3px;margin-top:6px;';
      leftCol.appendChild(negHdr);

      const negHint = document.createElement('div');
      negHint.textContent = 'What should NOT appear. Appended to per-cell image analysis + final prompt.';
      negHint.style.cssText = 'font-size:10px;color:#555;line-height:1.4;';
      leftCol.appendChild(negHint);

      const negTa = document.createElement('textarea');
      negTa.placeholder = 'Loading…';
      negTa.style.cssText = 'width:100%;box-sizing:border-box;height:80px;font-size:10px;padding:4px 6px;resize:vertical;font-family:inherit;';
      leftCol.appendChild(negTa);
      fetch('/api/settings').then(r => r.json()).then(d => {
        negTa.value = d.settings?.editNegativePrompt || '';
        negTa.placeholder = 'E.g.: blurry, watermark, extra limbs, text…';
      }).catch(() => { negTa.placeholder = 'Load error'; });

      // ╔════════════════════ CENTER — VOICE + OBRAZ ════════════════════╗
      const centerCol = document.createElement('div');
      centerCol.style.cssText = 'display:flex;flex-direction:column;gap:8px;min-width:0;';
      body.appendChild(centerCol);

      const centerHdr = document.createElement('div');
      centerHdr.textContent = '🎙 Voice & obraz';
      centerHdr.style.cssText = 'font-weight:bold;font-size:12px;background:#000080;color:#fff;padding:3px 6px;';
      centerCol.appendChild(centerHdr);

      // ── Obraz custom dropdown (with hover-thumb tooltip) ───────────────────
      // Track "pending obraz" — voice/thumb update live, but cell imagePath
      // changes are deferred until user clicks Save (and confirms the
      // destructive switch). On open we mirror the current session obraz.
      const _origObrazId = String(editFrozenSessions[sessionKey]?.obrazId || activeObraz?.id || '');
      let _pendingObrazId = _origObrazId;
      let _obrazSwitchAccepted = false; // becomes true only after dbl-click Accept

      const obrazRow = document.createElement('div');
      obrazRow.style.cssText = 'display:flex;align-items:center;gap:6px;';
      const obrazLbl = document.createElement('label');
      obrazLbl.textContent = 'Obraz:';
      obrazLbl.style.cssText = 'font-size:11px;font-weight:bold;flex-shrink:0;';
      obrazRow.appendChild(obrazLbl);

      // Custom dropdown: a button showing current selection + a panel listing
      // every obraz with thumbs. Native <select> can't show rich content per
      // option, so we roll our own. Tooltip preview appears on row hover.
      const obrazDrop = document.createElement('div');
      obrazDrop.style.cssText = 'position:relative;flex:1;min-width:0;';
      const obrazBtn = document.createElement('button');
      obrazBtn.type = 'button';
      obrazBtn.style.cssText = 'width:100%;font-size:11px;padding:4px 6px;cursor:pointer;text-align:left;display:flex;align-items:center;gap:6px;background:#fff;border:1px solid #888;';
      obrazRow.appendChild(obrazDrop);
      obrazDrop.appendChild(obrazBtn);
      centerCol.appendChild(obrazRow);

      const obrazyList = (typeof getObrazы === 'function') ? getObrazы() : [];
      function _findObraz(id) {
        return obrazyList.find(o => String(o.id) === String(id)) || null;
      }
      function _renderObrazBtnLabel() {
        const o = _findObraz(_pendingObrazId);
        obrazBtn.innerHTML = '';
        if (o?.thumbPath || o?.char) {
          const t = document.createElement('img');
          t.src = (o.thumbPath || o.char) + (o.thumbPath ? '' : '?t=' + Date.now());
          t.style.cssText = 'width:22px;height:30px;object-fit:cover;flex-shrink:0;';
          obrazBtn.appendChild(t);
        }
        const name = document.createElement('span');
        name.textContent = o ? (o.name || `obraz #${o.id}`) : '(none)';
        name.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        obrazBtn.appendChild(name);
        const caret = document.createElement('span');
        caret.textContent = '▼'; caret.style.cssText = 'flex-shrink:0;font-size:8px;color:#777;';
        obrazBtn.appendChild(caret);
      }
      _renderObrazBtnLabel();

      // Hover-tooltip showing a big thumb for the row under the cursor.
      let _obrazHoverTip = null;
      function _showHoverTip(o, anchorEl) {
        _hideHoverTip();
        const src = o?.char || o?.thumbPath;
        if (!src) return;
        _obrazHoverTip = document.createElement('img');
        _obrazHoverTip.src = src + (src.includes('?') ? '' : `?t=${Date.now()}`);
        _obrazHoverTip.style.cssText = 'position:fixed;z-index:10005;border:2px solid #444;background:#000;width:180px;height:240px;object-fit:cover;pointer-events:none;box-shadow:3px 3px 12px rgba(0,0,0,0.6);';
        const r = anchorEl.getBoundingClientRect();
        _obrazHoverTip.style.left = (r.right + 8) + 'px';
        _obrazHoverTip.style.top  = Math.max(8, r.top - 30) + 'px';
        document.body.appendChild(_obrazHoverTip);
      }
      function _hideHoverTip() {
        if (_obrazHoverTip) { _obrazHoverTip.remove(); _obrazHoverTip = null; }
      }

      // Click obrazBtn → toggle a popup list of obrazы.
      obrazBtn.addEventListener('click', () => {
        const existing = document.getElementById('_gen_obraz_list');
        if (existing) { existing.remove(); _hideHoverTip(); return; }
        const list = document.createElement('div');
        list.id = '_gen_obraz_list';
        const r = obrazBtn.getBoundingClientRect();
        list.style.cssText = `position:fixed;z-index:10004;background:#fff;border:1px solid #555;box-shadow:3px 3px 10px rgba(0,0,0,0.4);max-height:300px;overflow-y:auto;font-size:11px;left:${r.left}px;top:${r.bottom + 2}px;width:${r.width}px;`;
        obrazyList.forEach(o => {
          const row = document.createElement('div');
          row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:4px 6px;cursor:pointer;border-bottom:1px solid #eee;';
          if (String(o.id) === String(_pendingObrazId)) row.style.background = '#dbe9ff';
          if (o.thumbPath || o.char) {
            const t = document.createElement('img');
            t.src = (o.thumbPath || o.char);
            t.style.cssText = 'width:22px;height:30px;object-fit:cover;flex-shrink:0;';
            row.appendChild(t);
          }
          const nm = document.createElement('span');
          nm.textContent = o.name || `obraz #${o.id}`;
          nm.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
          row.appendChild(nm);
          row.addEventListener('mouseenter', () => _showHoverTip(o, row));
          row.addEventListener('mouseleave', () => _hideHoverTip());
          row.addEventListener('mouseover',  () => { row.style.background = String(o.id) === String(_pendingObrazId) ? '#dbe9ff' : '#f0f4ff'; });
          row.addEventListener('mouseout',   () => { row.style.background = String(o.id) === String(_pendingObrazId) ? '#dbe9ff' : '#fff'; });
          row.addEventListener('click', () => {
            list.remove(); _hideHoverTip();
            _onObrazPicked(String(o.id));
          });
          list.appendChild(row);
        });
        document.body.appendChild(list);
        // Close on outside click.
        const outside = (e) => {
          if (!list.contains(e.target) && e.target !== obrazBtn) {
            list.remove(); _hideHoverTip();
            document.removeEventListener('mousedown', outside, true);
          }
        };
        setTimeout(() => document.addEventListener('mousedown', outside, true), 0);
      });

      function _onObrazPicked(newId) {
        if (newId === _pendingObrazId) return;
        if (newId === _origObrazId) {
          // Switched back to the original — clear pending state, no confirm.
          _pendingObrazId = newId;
          _obrazSwitchAccepted = false;
          _liveApplyObraz();
          return;
        }
        // Different from original — show confirmation modal with dbl-click Accept.
        _confirmObrazSwitch(newId);
      }

      // Voice + obraz thumb + first scenario line — these UPDATE LIVE when
      // _pendingObrazId changes (after accept), but cells are NOT touched
      // until user clicks Save.
      function _liveApplyObraz() {
        _renderObrazBtnLabel();
        // Voice — pull from picked obraz's `voice` field (set in library).
        const o = _findObraz(_pendingObrazId);
        if (o?.voice && voiceSel) {
          voiceSel.value = o.voice;
        }
        // Thumb image preview
        if (_obrazThumbEl) {
          _obrazThumbEl.src = (o?.thumbPath || o?.char || '');
        }
      }

      // Confirmation modal — dbl-click Accept, single-click Cancel. English.
      function _confirmObrazSwitch(newId) {
        const newO = _findObraz(newId);
        const ov = document.createElement('div');
        ov.style.cssText = 'position:fixed;inset:0;z-index:10010;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;';
        const w = document.createElement('div');
        w.style.cssText = 'background:#c0c0c0;border:2px solid;border-color:#fff #808080 #808080 #fff;box-shadow:4px 4px 16px rgba(0,0,0,0.5);width:520px;max-width:92vw;font-family:inherit;color:#222;';
        const tb = document.createElement('div');
        tb.style.cssText = 'background:#a02020;color:#fff;padding:4px 8px;font-size:12px;font-weight:bold;';
        tb.textContent = '⚠ Confirm obraz switch';
        w.appendChild(tb);
        const bd = document.createElement('div');
        bd.style.cssText = 'padding:14px 16px;font-size:11px;line-height:1.55;';
        bd.innerHTML =
          `<p style="margin:0 0 10px 0;">You are switching this project from <b>${(_findObraz(_origObrazId)?.name) || '?'}</b> to <b>${newO?.name || '?'}</b>.</p>` +
          '<p style="margin:0 0 10px 0;">When you click <b>Save</b> in the gen-settings popup afterwards, the following will be deleted from this project:</p>' +
          '<ul style="margin:0 0 10px 18px;padding:0;">' +
          '<li>All generated mix images for every fragment.</li>' +
          '<li>All generated talking-head videos.</li>' +
          '<li>All generated voice files.</li>' +
          '</ul>' +
          '<p style="margin:0;font-size:10px;color:#a02020;">Tick the box below to enable Accept.</p>';
        w.appendChild(bd);
        const ft = document.createElement('div');
        ft.style.cssText = 'padding:8px 10px;border-top:1px solid #808080;display:flex;justify-content:flex-end;gap:6px;background:#c0c0c0;';
        // Confirmation gate: a checkbox the user has to tick BEFORE the
        // destructive Accept button becomes clickable. Replaces the older
        // double-click approach (browser dblclick was unreliable + invisible
        // to the user that there's a 2-step gate).
        const gateRow = document.createElement('div');
        gateRow.style.cssText = 'padding:8px 16px;border-top:1px solid #c0a0a0;background:#fff0f0;font-size:11px;display:flex;align-items:center;gap:6px;';
        const gateChk = document.createElement('input');
        gateChk.type = 'checkbox';
        gateChk.id = '_obraz_switch_gate';
        gateChk.style.cssText = 'margin:0;cursor:pointer;';
        const gateLbl = document.createElement('label');
        gateLbl.htmlFor = '_obraz_switch_gate';
        gateLbl.textContent = 'I understand this will delete all generated content for this project.';
        gateLbl.style.cssText = 'cursor:pointer;user-select:none;';
        gateRow.appendChild(gateChk);
        gateRow.appendChild(gateLbl);
        w.appendChild(gateRow);

        const cancel = document.createElement('button');
        cancel.textContent = 'Cancel'; cancel.style.cssText = 'font-size:11px;padding:5px 16px;cursor:pointer;';
        cancel.addEventListener('click', () => ov.remove());
        const accept = document.createElement('button');
        accept.textContent = 'Accept';
        accept.disabled = true;
        accept.style.cssText = 'font-size:11px;padding:5px 16px;cursor:pointer;background:#a02020;color:#fff;font-weight:bold;opacity:0.5;';
        gateChk.addEventListener('change', () => {
          accept.disabled = !gateChk.checked;
          accept.style.opacity = gateChk.checked ? '1' : '0.5';
        });
        accept.addEventListener('click', () => {
          if (accept.disabled) return;
          _pendingObrazId = newId;
          _obrazSwitchAccepted = true;
          ov.remove();
          _liveApplyObraz();
        });
        ft.appendChild(cancel);
        ft.appendChild(accept);
        w.appendChild(ft);
        ov.appendChild(w);
        document.body.appendChild(ov);
      }

      // Voice dropdown — uses the existing voiceSel element.
      const voiceLineRow = document.createElement('div');
      voiceLineRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-top:4px;';
      const voiceLbl = document.createElement('label');
      voiceLbl.textContent = 'Voice:'; voiceLbl.style.cssText = 'font-size:11px;font-weight:bold;flex-shrink:0;';
      voiceLineRow.appendChild(voiceLbl);
      voiceSel.style.cssText = 'flex:1;font-size:11px;height:24px;padding:0 2px;min-width:0;';
      voiceLineRow.appendChild(voiceSel);
      voicePreviewBtn.style.cssText = 'width:26px;height:24px;padding:0;font-size:10px;flex-shrink:0;cursor:pointer;';
      voiceLineRow.appendChild(voicePreviewBtn);
      voiceLineRow.appendChild(ttsParamsBtn);
      centerCol.appendChild(voiceLineRow);

      // First-sentence-of-scenario block (used for the voice preview text).
      // First scenario sentence — used as preview-TTS text. Sources, in order:
      //   1. sess.cells[0].line (frozen session — already has cells).
      //   2. sess.lines[0] (frozen session with lines).
      //   3. fetched via getLinesForScenario(scenFile) (PENDING session has
      //      only scenFile, cells/lines aren't materialised yet).
      let _firstLine = (editFrozenSessions[sessionKey]?.cells?.[0]?.line)
                    || (editFrozenSessions[sessionKey]?.lines?.[0])
                    || '';
      const _sf = editFrozenSessions[sessionKey]?.scenFile;
      if (!_firstLine && _sf && typeof getLinesForScenario === 'function') {
        try {
          const _lines = await getLinesForScenario(_sf);
          _firstLine = (_lines && _lines[0]) || '';
        } catch {}
      }
      const _firstSentence = String(_firstLine).split(/[.!?]/)[0].trim().slice(0, 200);
      const firstLineHdr = document.createElement('div');
      firstLineHdr.textContent = 'Preview text (1st scenario sentence):';
      firstLineHdr.style.cssText = 'font-weight:bold;font-size:10px;color:#555;margin-top:6px;';
      centerCol.appendChild(firstLineHdr);
      const firstLineBox = document.createElement('div');
      firstLineBox.textContent = _firstSentence || '(no scenario line found)';
      firstLineBox.style.cssText = 'font-size:10px;color:#222;background:#fafafa;border:1px solid #ccc;padding:4px 6px;font-style:italic;line-height:1.4;';
      centerCol.appendChild(firstLineBox);

      // Patch the voice preview button to use the first sentence as TTS text.
      // We intercept the click and request a tts-preview with the line text.
      // (Original preview still works via _voicePreviewCache for known voices.)
      window._editPreviewTextOverride = _firstSentence || null;

      // Obraz thumbnail panel.
      const obrazThumbHdr = document.createElement('div');
      obrazThumbHdr.textContent = 'Current obraz:';
      obrazThumbHdr.style.cssText = 'font-weight:bold;font-size:10px;color:#555;margin-top:6px;';
      centerCol.appendChild(obrazThumbHdr);
      const _obrazThumbEl = document.createElement('img');
      const _initObraz = _findObraz(_pendingObrazId);
      _obrazThumbEl.src = _initObraz?.thumbPath || _initObraz?.char || '';
      _obrazThumbEl.style.cssText = 'width:100%;max-height:280px;object-fit:contain;background:#222;border:1px solid #555;display:block;';
      _obrazThumbEl.alt = _initObraz?.name || 'obraz';
      centerCol.appendChild(_obrazThumbEl);

      // ╔════════════════════ RIGHT — TALKING-HEAD ════════════════════╗
      const rightCol = document.createElement('div');
      rightCol.style.cssText = 'display:flex;flex-direction:column;gap:8px;min-width:0;';
      body.appendChild(rightCol);

      const rightHdr = document.createElement('div');
      rightHdr.textContent = '🎬 Talking-head video';
      rightHdr.style.cssText = 'font-weight:bold;font-size:12px;background:#000080;color:#fff;padding:3px 6px;';
      rightCol.appendChild(rightHdr);

      const modelRow = document.createElement('div');
      modelRow.style.cssText = 'display:flex;align-items:center;gap:6px;';
      const modelLbl = document.createElement('label');
      modelLbl.textContent = 'Model:';
      modelLbl.style.cssText = 'font-size:11px;font-weight:bold;flex-shrink:0;';
      const modelSel = document.createElement('select');
      modelSel.style.cssText = 'flex:1;font-size:11px;padding:2px 4px;min-width:0;';
      ['kling/ai-avatar-standard','kling/ai-avatar-pro','prunaai/p-video-avatar'].forEach(id => {
        const o = document.createElement('option');
        o.value = id; o.textContent = window.ENGINE_SCHEMAS?.[id]?.label || id;
        modelSel.appendChild(o);
      });
      modelSel.value = getAvatarModel();
      modelRow.appendChild(modelLbl);
      modelRow.appendChild(modelSel);
      rightCol.appendChild(modelRow);

      const modelParamsHost = document.createElement('div');
      modelParamsHost.style.cssText = 'padding:6px 8px;background:#f4f4f4;border:1px solid #d0d0d0;';
      rightCol.appendChild(modelParamsHost);

      const costRow = document.createElement('div');
      costRow.style.cssText = 'font-size:10px;color:#333;background:#fffbe6;border:1px solid #e0d080;padding:4px 6px;';
      costRow.textContent = '…';
      rightCol.appendChild(costRow);

      const motionHdr = document.createElement('div');
      motionHdr.textContent = 'Motion prompt (per scenario)';
      motionHdr.style.cssText = 'font-weight:bold;font-size:11px;border-bottom:1px solid #888;padding-bottom:3px;margin-top:6px;';
      rightCol.appendChild(motionHdr);

      const motionHint = document.createElement('div');
      motionHint.textContent = 'Used by every per-scene avatar prompt as a base movement clause. Auto-generated on AI scenario save; editable here.';
      motionHint.style.cssText = 'font-size:10px;color:#555;line-height:1.4;';
      rightCol.appendChild(motionHint);

      const motionTa = document.createElement('textarea');
      motionTa.placeholder = 'Loading…';
      motionTa.style.cssText = 'width:100%;box-sizing:border-box;height:80px;font-size:10px;padding:4px 6px;resize:vertical;font-family:inherit;';
      rightCol.appendChild(motionTa);

      // ── Per-model motion prompt source ────────────────────────────────────
      // kie.ai Kling Standard/Pro use meta.motionPrompt (rich, scenario-
      // flavored, fed as motionHint into the per-cell LLM analyzer).
      // prunaai/p-video-avatar uses meta.minimalistMotionPrompt (restrained,
      // low-motion, fed into the minimalist branch of the same analyzer).
      // The textarea swaps sources when modelSel changes. User edits get
      // auto-PATCHed to the previous model's field on switch so nothing is
      // lost. Final Save patches whichever field is currently active.
      const _isMinimalistModel = (id) => id === 'prunaai/p-video-avatar';
      const _fieldForModel = (id) => _isMinimalistModel(id) ? 'minimalistMotionPrompt' : 'motionPrompt';

      let _scenarioMeta = null;
      const _scenFile = editFrozenSessions[sessionKey]?.scenFile;
      async function _fetchMeta() {
        if (!_scenFile) return null;
        try {
          const r = await fetch(`/api/scenarios/meta/${encodeURIComponent(_scenFile)}`);
          const d = await r.json();
          return d.success ? d.meta : null;
        } catch { return null; }
      }
      // Hits the back-fill endpoint when meta is missing the minimalist
      // clause (legacy scenarios saved before the two-field schema landed).
      async function _ensureMinimalistInMeta() {
        if (!_scenFile) return '';
        try {
          const r = await fetch(`/api/scenarios/meta/${encodeURIComponent(_scenFile)}/ensure-minimalist`, { method: 'POST' });
          const d = await r.json();
          return d.success ? (d.minimalistMotionPrompt || '') : '';
        } catch { return ''; }
      }

      async function _loadMotionForModel(modelId) {
        _scenarioMeta = await _fetchMeta();
        if (!_scenarioMeta) {
          motionTa.value = '';
          motionTa.placeholder = '(no meta — this scenario was uploaded manually)';
          motionHdr.textContent = _isMinimalistModel(modelId)
            ? 'Motion prompt — MINIMALIST (sent to p-video-avatar analyzer)'
            : 'Motion prompt — RICH (sent to Kling analyzer)';
          return;
        }
        if (_isMinimalistModel(modelId)) {
          let v = _scenarioMeta.minimalistMotionPrompt || '';
          if (!v) {
            motionTa.placeholder = '⏳ generating minimalist clause…';
            v = await _ensureMinimalistInMeta();
            _scenarioMeta = await _fetchMeta(); // refresh
          }
          motionTa.value = v || '';
          motionTa.placeholder = '';
          motionHdr.textContent = 'Motion prompt — MINIMALIST (p-video-avatar)';
        } else {
          motionTa.value = _scenarioMeta.motionPrompt || '';
          motionTa.placeholder = _scenarioMeta.motionPrompt ? '' : '(empty — fill or regenerate via AI scenario save)';
          motionHdr.textContent = 'Motion prompt — RICH (Kling)';
        }
      }
      // Initial load for whichever model is currently selected.
      await _loadMotionForModel(getAvatarModel());

      // Track which model the textarea currently reflects so we can PATCH
      // the right field when the user toggles to another model.
      let _motionTaModelId = getAvatarModel();

      let _modelEngineRow = null;
      async function _renderModelParams() {
        const id = modelSel.value;
        modelParamsHost.innerHTML = '';
        _modelEngineRow = null;
        const sc = window.ENGINE_SCHEMAS?.[id];
        if (!sc) { modelParamsHost.textContent = '(no schema)'; return; }
        if (!sc.fields?.length) {
          modelParamsHost.textContent = '(no user-tunable params for this model)';
          modelParamsHost.style.fontStyle = 'italic';
          modelParamsHost.style.color = '#777';
          return;
        }
        modelParamsHost.style.fontStyle = '';
        modelParamsHost.style.color = '';
        const saved = getAvatarParams(id);
        if (id === 'prunaai/p-video-avatar' && (!saved.seed || Number(saved.seed) <= 0)) {
          saved.seed = ensureProjectSeed();
        }
        _modelEngineRow = window.buildEngineSettingsRow(id, saved, () => recalcCost());
        modelParamsHost.appendChild(_modelEngineRow.node);
      }

      async function recalcCost() {
        const id = modelSel.value;
        const sc = window.ENGINE_SCHEMAS?.[id];
        if (!sc) { costRow.textContent = '—'; return; }
        let pricePerSec = sc.pricePerSec;
        if (!pricePerSec && sc.pricePerSecByResolution) {
          const res = _modelEngineRow?.collect()?.resolution || sc.fields?.find(f => f.key === 'resolution')?.default || '720p';
          pricePerSec = sc.pricePerSecByResolution[res] || 0;
        }
        const { total, pending } = await _sumProjectAudioSec();
        const max = (pricePerSec || 0) * total;
        const tail = pending ? ` (${pending} pending audio)` : '';
        const limitClause = sc.maxAudioSec ? ` · per-cell limit ${sc.maxAudioSec}s` : '';
        costRow.textContent = `~$${(pricePerSec||0).toFixed(3)}/sec · max est. $${max.toFixed(2)} for ${total.toFixed(1)}s of audio${tail}${limitClause}`;
      }

      modelSel.addEventListener('change', async () => {
        const oldModelId = _motionTaModelId;
        const newModelId = modelSel.value;
        localStorage.setItem(avatarModelStorageKey, newModelId);
        await _renderModelParams();
        await recalcCost();

        // Auto-PATCH the textarea content into the OLD model's meta field so
        // any unsaved edits survive the swap. Silently best-effort.
        if (_scenFile && oldModelId && oldModelId !== newModelId) {
          const field = _fieldForModel(oldModelId);
          const body = {}; body[field] = motionTa.value.trim();
          try {
            await fetch(`/api/scenarios/meta/${encodeURIComponent(_scenFile)}`, {
              method: 'PATCH', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            });
          } catch {}
        }
        // Load the NEW model's field into the textarea.
        await _loadMotionForModel(newModelId);
        _motionTaModelId = newModelId;
      });

      await _renderModelParams();
      await recalcCost();

      // ── Footer ──────────────────────────────────────────────────────────────
      const footer = document.createElement('div');
      footer.style.cssText = 'padding:8px 10px;border-top:1px solid #808080;display:flex;align-items:center;gap:6px;background:#c0c0c0;';

      const saveBtn = document.createElement('button');
      saveBtn.textContent = '💾 Save';
      saveBtn.style.cssText = 'font-size:11px;padding:4px 12px;cursor:pointer;font-weight:bold;background:#2d6cb6;color:#fff;border:1px solid;border-color:#5d8ec9 #1c4a82 #1c4a82 #5d8ec9;';

      const resetEngineBtn = document.createElement('button');
      resetEngineBtn.textContent = '↺ Reset img engine';
      resetEngineBtn.style.cssText = 'font-size:10px;padding:3px 10px;cursor:pointer;';

      const resetMotionBtn = document.createElement('button');
      resetMotionBtn.textContent = '↺ Reset motion';
      resetMotionBtn.title = 'Re-build motion clause from the LLM (clears your override)';
      resetMotionBtn.style.cssText = 'font-size:10px;padding:3px 10px;cursor:pointer;';

      const status = document.createElement('span');
      status.style.cssText = 'font-size:10px;color:#555;margin-left:auto;';

      const closeBtn = document.createElement('button');
      closeBtn.textContent = 'Close';
      closeBtn.style.cssText = 'font-size:11px;padding:4px 12px;cursor:pointer;';
      closeBtn.addEventListener('click', () => popup.remove());

      footer.appendChild(saveBtn);
      footer.appendChild(resetEngineBtn);
      footer.appendChild(resetMotionBtn);
      footer.appendChild(status);
      footer.appendChild(closeBtn);
      popup.appendChild(footer);

      saveBtn.addEventListener('click', async () => {
        saveBtn.disabled = true;
        status.textContent = 'Saving…';
        try {
          const ops = [];
          const engineId = engineSel.value;
          if (_imgEngineRow && window.saveEngineDefaults) {
            ops.push(window.saveEngineDefaults(engineId, _imgEngineRow.collect()));
          }
          ops.push(fetch('/api/settings', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ editNegativePrompt: negTa.value.trim() }),
          }));
          // Avatar model + per-model params persist to LS (GLOBAL — same for new projects).
          localStorage.setItem(avatarModelStorageKey, modelSel.value);
          if (_modelEngineRow) {
            setAvatarParams(modelSel.value, _modelEngineRow.collect());
          }
          if (_scenFile) {
            // PATCH the field tied to the currently-selected talking-head
            // model (motionPrompt for Kling, minimalistMotionPrompt for
            // p-video-avatar). Auto-PATCH on model-switch already handled
            // any in-flight unsaved edit on the OTHER field.
            const _motionField = _fieldForModel(modelSel.value);
            const _motionBody = {}; _motionBody[_motionField] = motionTa.value.trim();
            ops.push(fetch(`/api/scenarios/meta/${encodeURIComponent(_scenFile)}`, {
              method: 'PATCH', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(_motionBody),
            }));
          }
          await Promise.all(ops);
          _applyNegBtnColor(negTa.value.trim());

          // ── Destructive obraz switch (deferred from popup-open until Save) ──
          if (_obrazSwitchAccepted && _pendingObrazId && _pendingObrazId !== _origObrazId) {
            _applyObrazSwitch(_pendingObrazId);
          }

          // Voice preview override no longer relevant after popup closes.
          delete window._editPreviewTextOverride;

          popup.remove();
          // Onboarding tip — once per project, ONLY after a successful Save.
          _showOnboardingTip();
        } catch (e) {
          status.textContent = '⚠ ' + (e?.message || 'error');
          status.style.color = '#a33';
          saveBtn.disabled = false;
        }
      });

      // ── Apply destructive obraz switch ────────────────────────────────────
      // 1. Wipe every cell's audio/mix/video on disk + state.
      // 2. Refill cell.imagePath with random posevars of the new obraz.
      // 3. Update sess.obrazId + sess.title.
      // 4. Re-render the edit panel so the user sees the fresh state.
      function _applyObrazSwitch(newId) {
        const sess = editFrozenSessions[sessionKey];
        if (!sess) return;
        const newO = _findObraz(newId);
        if (!newO) return;
        const candidates = [newO.char, ...((newO.variations || []).filter(v => v && v !== 'error'))].filter(Boolean);
        (sess.cells || []).forEach((c, _i) => {
          // Wipe generated media for both branches.
          delete c.videoPath; delete c.avatarTaskId; delete c._videoPending;
          c.videoError = null;
          delete c.audioPath; delete c.audioError;
          // Pick a fresh random posevar from the new obraz for every cell.
          // (Used as the BASE face for ph2 mix-image gen on detInfo cells,
          // and directly as the cell image on char-only cells.)
          const pose = candidates.length ? candidates[Math.floor(Math.random() * candidates.length)] : null;
          c.charImagePath = pose;
          if (c.detInfo) {
            // Mix image is derived from charImagePath + detInfo at ph2 time.
            // Wipe the previously-generated mix and any per-detail mix cache
            // so a fresh ph2 must run.
            delete c.imagePath;
            delete c.mixes;
          } else {
            // Char-only cell — imagePath IS the posevar.
            c.imagePath = pose;
          }
        });
        sess.obrazId = String(newId);
        // Rename: replace obraz name part in title. We rebuild it from scratch
        // so the user sees the new obraz name immediately.
        const scenName = (typeof scenarioFiles !== 'undefined' && Array.isArray(scenarioFiles))
          ? (scenarioFiles.find(sf => sf.file === sess.scenFile)?.name || (sess.scenFile || '').replace(/\.txt$/, ''))
          : (sess.scenFile || '').replace(/\.txt$/, '');
        const _d = sess.date ? new Date(sess.date) : new Date();
        const _date = isNaN(_d) ? '' : _d.toLocaleDateString('en-GB');
        const _time = isNaN(_d) ? '' : _d.toTimeString().slice(0, 5);
        sess.title = [_date, _time, scenName, newO.name].filter(Boolean).join(' — ');
        saveEditState();
        renderEditPanel();
      }

      resetEngineBtn.addEventListener('click', async () => {
        const engineId = engineSel.value;
        const imgSchema = window.ENGINE_SCHEMAS?.[engineId];
        if (!imgSchema) return;
        if (!confirm('Reset parameters for image engine ' + imgSchema.label + ' to model defaults?')) return;
        try {
          await window.clearEngineDefaults?.(engineId);
          await _renderImgEngineParams();
          status.textContent = '↺ Image engine reset';
          setTimeout(() => { status.textContent = ''; }, 1500);
        } catch (e) {
          status.textContent = '⚠ ' + (e?.message || 'error');
          status.style.color = '#a33';
        }
      });

      resetMotionBtn.addEventListener('click', async () => {
        if (!_scenarioMeta) {
          status.textContent = '⚠ no scenario meta to reset from';
          status.style.color = '#a33';
          return;
        }
        // Reset to the LLM-generated value for the currently-selected model.
        await _loadMotionForModel(modelSel.value);
      });

      document.body.appendChild(popup);
    });

    // engineSel and negPromptBtn used to live in their own header row. After
    // the gen-settings redesign they BOTH moved into the popup body — engineSel
    // into the LEFT column, negPromptBtn next to ph1/ph2/ph3 in projectToggle.
    // The DOM elements are not appended to the header anymore, but they stay
    // alive in JS scope (engineSel.value / change-listeners still work fine
    // even when the element is detached from DOM).
    projectToggle.insertBefore(negPromptBtn, runAllBtn);

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
      // Override text wins over static preview / cache when present (gen-
      // settings popup sets this to the first scenario sentence so the user
      // hears the actual content with their voice settings).
      const _overrideText = window._editPreviewTextOverride || '';

      // Use cached URL if available — but only when no override text is set.
      // With an override we always re-request TTS so the preview matches the
      // current first sentence.
      if (!_overrideText && _voicePreviewCache.has(voice)) {
        const url = _voicePreviewCache.get(voice);
        _previewAudio = new Audio(url);
        voicePreviewBtn.textContent = '■'; voicePreviewBtn.style.color = '#0070cc'; voicePreviewBtn._playing = true;
        _previewAudio.play();
        _previewAudio.addEventListener('ended', () => { voicePreviewBtn.textContent = '▶'; voicePreviewBtn.style.color = ''; voicePreviewBtn._playing = false; });
        return;
      }

      const _vObj = window.findVoiceByValue?.(voice);
      const _staticUrl = window.getVoicePreviewUrl?.(_vObj);

      if (_staticUrl && !_overrideText) {
        // ── Free static preview (voices with id) ──────────────────────────────
        _voicePreviewCache.set(voice, _staticUrl);
        _previewAudio = new Audio(_staticUrl);
        voicePreviewBtn.textContent = '■'; voicePreviewBtn.style.color = '#0070cc'; voicePreviewBtn._playing = true;
        _previewAudio.play();
        _previewAudio.addEventListener('ended', () => { voicePreviewBtn.textContent = '▶'; voicePreviewBtn.style.color = ''; voicePreviewBtn._playing = false; });
      } else {
        // ── TTS request preview (voices without id OR override text set) ─────
        voicePreviewBtn.textContent = '⏳'; voicePreviewBtn.disabled = true;
        try {
          const _ttsBody = { voice, ttsParams: getProjectTtsParams(), model: getAudioEngine?.() };
          if (_overrideText) _ttsBody.text = _overrideText;
          const r = await fetch('/api/audio/tts-preview', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(_ttsBody),
          });
          if (!r.ok) throw new Error(`HTTP ${r.status} — restart server`);
          const d = await r.json();
          if (!d.success) throw new Error(d.error);
          // Only cache when using the stock preview text — caching override-text
          // audio would replay the wrong content next time without override.
          if (!_overrideText) _voicePreviewCache.set(voice, d.audioPath);
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
        { key: 'stability',        label: 'Stability',        min: 0,   max: 1,   step: 0.01, def: 0.85,
          hint: 'Stability: low values — livelier and more emotional, high — more monotone and predictable' },
        { key: 'similarity_boost', label: 'Similarity boost', min: 0,   max: 1,   step: 0.01, def: 0.75,
          hint: 'Similarity to the original voice: high values match the voice timbre more closely' },
        { key: 'style',            label: 'Style',            min: 0,   max: 1,   step: 0.01, def: 0,
          hint: 'Expressiveness: amplifies style and intonation, may reduce stability (v2+ only)' },
        { key: 'speed',            label: 'Speed',            min: 0.5, max: 2.0, step: 0.05, def: 1.15,
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

    // hdrLeft is now an empty container — engineRow + voiceRow moved into the
    // gen-settings popup body. Kept for layout symmetry (parts of the template
    // expect hdr/hdrLeft/voiceRow structure to exist).
    const hdrLeft = document.createElement('div');
    hdrLeft.style.cssText = 'display:flex;flex-direction:column;gap:3px;';

    let _handleGenVoices = null;
    let _genVoicesRunning = false, _genVoicesAbort = false;

    // voiceRow used to be the per-project voice strip [voiceSel + preview +
    // ttsParamsBtn + "Generate all voices" 🔊]. The "Generate all voices"
    // button was removed (workflow is now ph1-ph2-ph3); the rest of the
    // controls moved into the gen-settings popup body. We keep voiceRow as an
    // empty placeholder div because two appendChild(voiceRow) calls below
    // (frozen + pending branches) still reference it. Width:0 / no-padding
    // means it's invisible without breaking the layout.
    const voiceRow = document.createElement('div');
    voiceRow.style.cssText = 'display:none;';

    hdr.appendChild(hdrLeft);
    hdr.style.order = EDIT_BLOCK_ORDER.hdr;
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
        const videoParams   = getEngineParams?.('kling/ai-avatar-standard') || {};
        const defaultPrompt = videoParams.prompt || 'Natural speaking motion with subtle head movement and relaxed posture';
        const imgPath = cell.imagePath || cell.charImagePath || frozenObraz?.char || activeObraz?.char;
        // Phase 3 callback safety net: ensure _onAvatarSubmitted fires exactly once
        // so Run All never deadlocks on a failed/short-circuited cell.
        const _origAvatarHook = cell._onAvatarSubmitted;
        let _avatarHookFired = false;
        cell._onAvatarSubmitted = () => {
          if (_avatarHookFired) return;
          _avatarHookFired = true;
          try { _origAvatarHook?.(); } catch {}
        };
        if (!imgPath || !cell.audioPath) { cell._onAvatarSubmitted?.(); return; }

        const _sid = window.GenLog?.start('Scenarios Edit', '🎭 Talking Head');
        const _actRow = window.createActivityRow?.(`Edit avatar ${idx + 1}`);
        const _gf = (name, url, body) => window.GenLog && _sid
          ? window.GenLog.fetchLog(_sid, name, url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
          : fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());

        // Grey out the fragment immediately for SINGLE retry case (so user sees
        // which cell is regenerating). Skip during Run All Phase 3 — there we
        // want the hourglass to appear ONLY after the POST is sent to Kling.
        const _isPhase3Run = window._runAllPhaseRunning?.[sessionKey] === 'ph3';
        if (!_isPhase3Run) {
          delete cell.videoPath;
          cell.videoError = null;
          cell._videoPending = true;
          saveEditState();
          cell._applyActionState?.();
        }

        // Step 1: upload main image (skip if cached from previous failed attempt)
        let _imgUrl = cell._cachedImgUrl || null;
        if (!_imgUrl) {
          _actRow?.setStatus('📤 Загрузка…');
          const _upR = await _gf('📤 Загрузка изображения', '/api/upload-public', { imagePath: imgPath });
          _imgUrl = _upR?.success ? _upR.url : null;
          if (_imgUrl) cell._cachedImgUrl = _imgUrl;
        }

        // Step 2: upload detail image (skip if cached)
        let _detUrl = cell._cachedDetUrl || null;
        if (!_detUrl && _imgUrl && cell.detInfo?.path) {
          try {
            const _dr = await _gf('📤 Загрузка предмета', '/api/upload-public', { imagePath: cell.detInfo.path });
            if (_dr?.success) { _detUrl = _dr.url; cell._cachedDetUrl = _detUrl; }
          } catch {}
        }

        // Step 3: build avatar prompt (uses cell.avatarPrompt as cache — already persisted)
        let prompt = cell.avatarPrompt || defaultPrompt;
        _actRow?.setStatus('🧠 Промпт…');
        // Detect AI/LLM transient errors that come back as the prompt body itself
        // (e.g. "Error in message stream") instead of throwing — retry on those.
        const _isValidPrompt = (p) => {
          if (!p || typeof p !== 'string') return false;
          const _t = p.trim();
          if (_t.length < 30) return false;                          // too short → probably error
          if (/^error\b/i.test(_t)) return false;                    // starts with "Error..."
          if (/error in message stream/i.test(_t)) return false;     // explicit OpenAI/Anthropic SSE failure
          if (/^\{.*"error".*\}$/.test(_t)) return false;            // raw JSON error envelope
          return true;
        };
        // Pull scenario-wide motionPrompt from server meta (one HTTP each
        // avatar gen — cheap, cached server-side). Becomes `motionHint` in
        // the per-scene LLM call so all scenes share a consistent narrator
        // persona while each still gets its own per-scene final prompt.
        // The motionHint source depends on the target talking-head model:
        //   prunaai/p-video-avatar → meta.minimalistMotionPrompt
        //   anything else (kling/*) → meta.motionPrompt
        // Server-side, /api/audio/avatar-prompt switches its system prompt
        // by `targetModel` to either the rich or minimalist instructions.
        const _selectedAvatarModel = (() => {
          const v = localStorage.getItem(`edit_avatar_model_global`);
          const allowed = ['kling/ai-avatar-standard','kling/ai-avatar-pro','prunaai/p-video-avatar'];
          return allowed.includes(v) ? v : 'kling/ai-avatar-standard';
        })();
        const _isMinimalistAvatar = (_selectedAvatarModel === 'prunaai/p-video-avatar');
        let _scenarioMotionHint = '';
        try {
          const _scenFile = editFrozenSessions[sessionKey]?.scenFile;
          if (_scenFile) {
            const _mr = await fetch(`/api/scenarios/meta/${encodeURIComponent(_scenFile)}`);
            const _md = await _mr.json();
            if (_md.success && _md.meta) {
              _scenarioMotionHint = _isMinimalistAvatar
                ? (_md.meta.minimalistMotionPrompt || '')
                : (_md.meta.motionPrompt || '');
            }
          }
        } catch {}

        // Up to 3 attempts with 1.5s back-off — covers transient SSE drops.
        for (let _att = 0; _att < 3; _att++) {
          try {
            // Always send imagePath (not imageUrl) for talking-head so the
            // server re-uploads with forceFresh and never reuses a stale URL.
            const pd = await _gf('🧠 Промпт аватара', '/api/audio/avatar-prompt',
              { imagePath: imgPath, text: cell.line, detailImagePath: cell.detInfo?.path || null,
                motionHint: _scenarioMotionHint || undefined,
                targetModel: _selectedAvatarModel });
            if (pd.success && _isValidPrompt(pd.prompt)) {
              prompt = pd.prompt;
              cell.avatarPrompt = prompt;
              saveEditState();
              break;
            }
            // Got a response but content is invalid (error string) → retry
            if (_att < 2) {
              _actRow?.setStatus(`🧠 Промпт… retry ${_att + 2}/3`);
              await new Promise(r => setTimeout(r, 1500));
            }
          } catch {
            if (_att < 2) await new Promise(r => setTimeout(r, 1500));
          }
        }

        const showVideoError = (msg) => {
          cell.videoError = msg || 'Avatar failed';
          delete cell._videoPending; saveEditState();
          if (cell._statusEl) cell._statusEl.textContent = (msg || 'Error').slice(0, 40);
          cell._applyActionState?.();
          _actRow?.setRetry('🎬 Аватар', () => runSingleAvatar(cell, vc, idx));
          renderMontagePanel(); renderAllTimelines();
        };

        _actRow?.setStatus('🎬 Аватар…');
        try {
          // Resolve the selected talking-head model (per-project, in LS).
          const _selectedModel = (() => {
            const v = localStorage.getItem(`edit_avatar_model_global`);
            const allowed = ['kling/ai-avatar-standard','kling/ai-avatar-pro','prunaai/p-video-avatar'];
            return allowed.includes(v) ? v : 'kling/ai-avatar-standard';
          })();
          const _modelSchema = window.ENGINE_SCHEMAS?.[_selectedModel];

          // 15s audio block for kie.ai models (Kling max-audio limit per docs +
          // user-confirmed cap). We check the cached audio duration; if not
          // yet known, probe it once here.
          if (_modelSchema?.maxAudioSec) {
            let _audioSec = cell._audioSec || 0;
            if (!_audioSec && cell.audioPath) {
              _audioSec = await new Promise(resolve => {
                const a = new Audio(cell.audioPath);
                a.addEventListener('loadedmetadata', () => resolve(a.duration || 0), { once: true });
                a.addEventListener('error', () => resolve(0), { once: true });
                a.load();
              });
              cell._audioSec = _audioSec;
            }
            if (_audioSec > _modelSchema.maxAudioSec) {
              throw new Error(`audio is ${_audioSec.toFixed(1)}s — ${_modelSchema.label.split(' ')[0]} caps at ${_modelSchema.maxAudioSec}s. Switch to p-video-avatar or shorten the audio.`);
            }
          }

          // Track start time for gen-timings recording on success.
          const _genStartTs = Date.now();
          const _audioSecForRecord = cell._audioSec || 0;

          // Arm an ETA countdown next to the ✕ if we know the model's
          // typical ratio. Best-effort — silently skipped on error/no data.
          (async () => {
            try {
              const _tr = await fetch('/api/gen-timings');
              const _td = await _tr.json();
              if (!_td?.success) return;
              const _params2 = (function () {
                try {
                  const all = JSON.parse(localStorage.getItem(`edit_avatar_params_global`) || '{}');
                  return all[_selectedModel] || {};
                } catch { return {}; }
              })();
              const _res = _params2.resolution || _modelSchema?.resolution || '';
              const _ratio = _td.ratios[`${_selectedModel}|${_res}`];
              if (_ratio > 0 && _audioSecForRecord > 0) {
                _actRow?.setEtaCountdown(_audioSecForRecord * _ratio);
              }
            } catch {}
          })();

          // Dispatch by selected model.
          let d;
          if (_selectedModel === 'prunaai/p-video-avatar') {
            const _params = (() => {
              try {
                const all = JSON.parse(localStorage.getItem(`edit_avatar_params_global`) || '{}');
                return all['prunaai/p-video-avatar'] || {};
              } catch { return {}; }
            })();
            d = await _gf('🎬 Генерация аватара (p-video-avatar)', '/api/audio/avatar-replicate',
              { imagePath: imgPath, audioPath: cell.audioPath, prompt, params: _params });
          } else {
            // kie.ai Kling Standard or Pro
            d = await _gf('🎬 Генерация аватара', '/api/audio/avatar',
              { imagePath: imgPath, audioPath: cell.audioPath, prompt, videoParams, model: _selectedModel });
          }
          if (!d.success) throw new Error(d.error);
          // Persist taskId so a tab switch / page reload can resume polling
          cell.avatarTaskId = d.taskId;
          cell._avatarStartTs   = _genStartTs;
          cell._avatarAudioSec  = _audioSecForRecord;
          cell._avatarModelUsed = _selectedModel;
          cell._videoPending = true;
          saveEditState();
          window.maybeStartAvatarPoller?.();
          cell._applyActionState?.();
          // ✅ Kling POST sent + taskId received → unblock Run All Phase 3 sequential loop
          // (does NOT block on pollAvatar — polling continues in background here)
          try { cell._onAvatarSubmitted?.(); } catch {}
          const videoPath = await pollAvatar(d.taskId);

          // Record gen timing (silent — best-effort)
          try {
            const _durSec = Math.max(0.1, (Date.now() - _genStartTs) / 1000);
            const _params = (function () {
              try {
                const all = JSON.parse(localStorage.getItem(`edit_avatar_params_global`) || '{}');
                return all[_selectedModel] || {};
              } catch { return {}; }
            })();
            const _res = _params.resolution || _modelSchema?.resolution || '';
            if (_audioSecForRecord > 0) {
              await fetch('/api/gen-timings/record', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ modelId: _selectedModel, resolution: _res, audioSec: _audioSecForRecord, durationSec: _durSec }),
              });
            }
          } catch {}
          cell.videoPath = videoPath; cell.videoError = null;
          delete cell.avatarTaskId; delete cell._videoPending;
          delete cell._cachedImgUrl; delete cell._cachedDetUrl;
          saveEditState();
          vc.style.display = '';
          vc.innerHTML = '';
          vc.appendChild(_buildVideoThumb(videoPath));
          if (cell._statusEl) cell._statusEl.textContent = '';
          if (cell._imgBox) cell._imgBox.style.display = 'none';
          if (cell._colEl) { cell._colEl.style.outline = ''; cell._colEl.style.background = ''; }
          cell._applyActionState?.();
          // Run All button state reflects data: this cell now has videoPath →
          // possibly transition ph3 → done. Refresh button.
          window._refreshRunAllBtn?.[sessionKey]?.();
          _actRow?.finalize('✅');
          renderMontagePanel(); renderAllTimelines();
          // Auto-light "★ add to merge" if this was the last video to finish
          // (no-ops if sess.starred was already explicitly set).
          _autoStarIfAvatarsDone(sessionKey);
          // Re-render whenever ALL avatars are now in — independent of whether
          // _autoStar fired. This guarantees the activateBtn ★ snaps to its
          // active state after rollback + re-run scenarios where sess.starred
          // is already !== undefined and auto-star short-circuits.
          {
            const _s = editFrozenSessions[sessionKey];
            const _audioCells = _s?.cells?.filter(c => c.audioPath) || [];
            const _allDone = _audioCells.length > 0 &&
              _audioCells.every(c => c.videoPath && !c._videoPending && !c.avatarTaskId);
            if (_allDone) renderEditPanel();
          }
          window.GenLog?.finalize(_sid, 'success');
        } catch (err) {
          // Always unblock Phase 3 sequential loop (single-fire wrapper handles double-call)
          try { cell._onAvatarSubmitted?.(); } catch {}
          if (err.message === 'Cancelled') { window.GenLog?.cancel(_sid); _actRow?.remove(); return; }
          window.GenLog?.finalize(_sid, 'error');
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
        // Phase 2 unblock callback: fires once after the POST is successfully sent
        // (or once after all retries fail, so Run All Phase 2 can advance to the
        // next cell instead of waiting for full polling).
        let _submittedFired = false;
        const _liveCell = editFrozenSessions[sessionKey]?.cells?.[cellIdx];
        const _fireSubmitted = () => {
          if (_submittedFired) return;
          _submittedFired = true;
          try { _liveCell?._onMixSubmitted?.(); } catch {}
        };
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
        const _cellSid = window.GenLog?.start('Scenarios Edit', '🖼 Cell Image');
        const _cgf = (name, url, body) => window.GenLog && _cellSid
          ? window.GenLog.fetchLog(_cellSid, name, url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
          : fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());

        let _combinedPrompt = '';
        {
          let _negP = '';
          try { const _sd = await (await fetch('/api/settings')).json(); _negP = _sd.settings?.editNegativePrompt || ''; } catch {}
          const _iPrompt = getInteractPromptFn ? getInteractPromptFn() : '';
          // Analysis receives only the interaction prompt — no generation instructions
          const _arAnalyze = window.createActivityRow?.(`Analyze cell ${cellIdx + 1}`);
          try {
            const _analyzeD = await _cgf('🔍 Анализ сцены', '/api/asset-interact/pre-analyze', { activePath: _charSrc, assetPath: _assetSrc, presetPrompt: _iPrompt || '' });
            if (_analyzeD.success && _analyzeD.combinedPrompt) _combinedPrompt = _analyzeD.combinedPrompt;
            _arAnalyze?.finalize(_combinedPrompt ? '✅' : '❌ empty prompt');
          } catch (_ae) {
            _arAnalyze?.finalize('❌ ' + _ae.message.slice(0, 50));
            setStatus(`Cell ${cellIdx + 1}: analysis failed — ${_ae.message}`);
          }
          // Append negative prompt to the generation prompt (not to the analysis)
          if (_negP && _combinedPrompt) _combinedPrompt += `\nAvoid in generation: ${_negP}`;
        }

        const MAX_RETRIES = 3;
        let lastErr = null;
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
          try {
            const gd = await _cgf('🖼 Генерация изображения', '/api/asset-interact/generate', {
              activePath: _charSrc, assetPath: _assetSrc,
              prompt: _combinedPrompt, assetType: 'detail', imageEngine,
              engineParams: getEngineParams?.(imageEngine) || {},
            });
            if (!gd.success) throw new Error(gd.error);

            const sess = editFrozenSessions[sessionKey];
            if (sess && sess.cells?.[cellIdx]) { sess.cells[cellIdx].taskId = gd.taskId; saveEditState(); }
            // ✅ POST sent + taskId received → unblock Run All Phase 2 sequential loop
            // (does NOT block on pollTask — polling continues in background here)
            _fireSubmitted();

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
            // Run All button state reflects data: this cell now has its mix →
            // possibly transition ph2 → ph3 (or stays ph2 if more cells need mix).
            window._refreshRunAllBtn?.[sessionKey]?.();
            window.GenLog?.finalize(_cellSid, 'success');
            return; // success
          } catch (err) {
            lastErr = err;
            setStatus(`Cell ${cellIdx + 1}: attempt ${attempt}/3 — ${err.message}`);
            if (attempt < MAX_RETRIES) await new Promise(r => setTimeout(r, 3000));
          }
        }
        // All retries exhausted — show error with message
        window.GenLog?.finalize(_cellSid, 'error');
        imgBox.style.cssText = 'width:62px;height:82px;border:1px solid #808080;background:#ddd;overflow:hidden;flex-shrink:0;display:flex;align-items:center;justify-content:center;flex-direction:column;';
        imgBox.innerHTML = `<span style="font-size:7px;color:#aa0000;text-align:center;padding:2px;word-break:break-all;">${(lastErr?.message || 'Error').slice(0, 60)}</span>`;
        // Clear taskId so the state machine doesn't stay in ⏳ after failure
        const _cellForClean = editFrozenSessions[sessionKey]?.cells?.[cellIdx];
        if (_cellForClean) { delete _cellForClean.taskId; saveEditState(); }
        cell._applyActionState?.();
        } finally {
          // Always unblock Run All Phase 2 (even on total failure) so it can advance
          _fireSubmitted();
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
          // ── Visibility toggle MUST run before phase-lock early-return ──
          // (Otherwise during Run All ph2/ph3 the imgBox/detailImgBox/_dropSel
          // would never get display:none, leaving them stacked above the video.)
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

          // ── Phase lock: force-disable action + reset buttons during ph2/ph3 ──
          const _phaseLock = window._runAllPhaseRunning?.[sessionKey];
          if (_phaseLock === 'ph2' || _phaseLock === 'ph3') {
            actionBtn.disabled = true;
            actionBtn.style.opacity = '0.4';
            actionBtn.title = `Disabled during Run All Phase ${_phaseLock === 'ph2' ? '2 (mixes)' : '3 (videos)'}`;
            if (cell._resetBtn) {
              cell._resetBtn.disabled = true;
              cell._resetBtn.style.opacity = '0.4';
              cell._resetBtn.title = 'Disabled during Run All';
            }
            return;
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
          // 2. Video generating → ⏹ (cancel button)
          if (cell.avatarTaskId || cell._videoPending) {
            actionBtn.textContent = '⏹';
            actionBtn.title = 'Video is generating. Click to cancel and restart.';
            actionBtn.style.background = '#aa4400'; actionBtn.style.color = '#fff';
            actionBtn.style.fontWeight = 'bold'; actionBtn.disabled = false;
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
          // Cancel avatar generation
          if (cell.avatarTaskId || cell._videoPending) {
            if (cell.avatarTaskId) _avatarAbortedTasks.add(cell.avatarTaskId);
            delete cell.avatarTaskId; delete cell._videoPending;
            cell.videoError = null;
            _editCellsRunning.delete(_mkCellKey(idx));
            saveEditState();
            _applyActionState();
            window._refreshRunAllBtn?.[sessionKey]?.();
            renderMontagePanel?.(); renderAllTimelines?.();
            return;
          }
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

        const resetBtn = document.createElement('button');
        resetBtn.textContent = '⟳';
        resetBtn.style.cssText = 'width:66px;font-size:10px;padding:1px 0;margin-top:2px;cursor:pointer;background:#111;color:#fff;border:1px solid #444;border-radius:2px;';
        resetBtn.addEventListener('click', () => {
          if (cell.videoPath || cell.avatarTaskId || cell._videoPending || cell.videoError) {
            // Stage 1 — clear video, keep mixes and item
            resetBtn.title = 'Reset fragment — clear video, keep audio and mixes';
            delete cell.videoPath; delete cell.videoError;
            delete cell.avatarTaskId; delete cell._videoPending;
            delete cell.avatarPrompt; delete cell.avatarPromptMozgi;
            delete cell._cachedImgUrl; delete cell._cachedDetUrl;
            // Allow auto-star to fire again on the next full ph3 completion.
            // Preserve explicit user opt-out (sess.starred === false): respect it.
            const _sessForStar = editFrozenSessions[sessionKey];
            if (_sessForStar && _sessForStar.starred !== false) delete _sessForStar.starred;
          } else {
            // Stage 2 — clear mixes only; KEEP detInfo (item assignment) so that
            // _getRunAllPhase() correctly reports 'ph2' (needs mix re-gen) and
            // the user can re-run mix → avatar without re-picking the item.
            // To clear the item itself, the user uses the item dropdown directly.
            resetBtn.title = 'Reset fragment — clear mix, keep item assignment';
            delete cell.mixes;
            delete cell._cachedImgUrl; delete cell._cachedDetUrl;
            cell.imagePath = cell.charImagePath || null;
            _mixReady = false;
            _renderImgBox();
            _buildDropdown();
          }
          saveEditState();
          _applyActionState();
          // Run All button state depends on cell data (videoPath/mixes/audio).
          // After reset, recompute so button re-activates if work is now incomplete.
          window._refreshRunAllBtn?.[sessionKey]?.();
          renderMontagePanel?.(); renderAllTimelines?.();
        });

        c.appendChild(num); c.appendChild(imgBox); c.appendChild(detailImgBox);
        c.appendChild(videoContainer); c.appendChild(statusEl); c.appendChild(actionBtn);
        c.appendChild(resetBtn);

        cell._imgBox           = imgBox;
        cell._detailImgBox     = detailImgBox;
        cell._actionBtn        = actionBtn;
        cell._resetBtn         = resetBtn;   // black ⟳ button, also disabled during ph2/ph3
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
        // (Old _genVoicesTopBtn button UI was removed — workflow runs through
        // ph1/ph2/ph3 now. runAllBtn shows the in-progress state for us.)
        const _v = getProjectVoice();
        // Status helper: idle/queued/active/done/fail per audio container
        const _setStatus = (cont, kind, msg) => {
          if (!cont) return;
          if (kind === 'queued')  cont.innerHTML = '<span style="font-size:9px;color:#888;">⏳ queued</span>';
          else if (kind === 'active') cont.innerHTML = '<span style="font-size:9px;color:#0070cc;font-weight:bold;">🎙 generating…</span>';
          else if (kind === 'fail')   { cont.innerHTML = ''; const e = document.createElement('span'); e.textContent = '❌'; e.title = msg || 'TTS failed'; e.style.cssText = 'font-size:9px;color:#aa0000;'; cont.appendChild(e); }
        };
        // Mark all to-be-processed cells as "queued" so user sees the scope upfront.
        // Skip cells with video, in progress, or already-generated audio.
        frozenComponents.forEach((comp, i) => {
          if (_editExcludedSet.has(i)) return;
          if (comp.isRunning) return;
          const _c = comp.cell;
          if (_c.videoPath || _c.avatarTaskId || _c._videoPending) return; // don't touch cells with video
          if (_c.audioPath) return; // ✅ keep existing audio — don't regenerate
          delete _c.audioError;
          _setStatus(_c._audioContainer, 'queued');
        });
        saveEditState();
        try {
        for (let _i = 0; _i < frozenComponents.length; _i++) {
          if (_genVoicesAbort) break;
          if (_editExcludedSet.has(_i)) continue;
          const _cell = frozenComponents[_i].cell;
          if (_cell.videoPath || _cell.avatarTaskId || _cell._videoPending) continue; // skip cells with video
          if (_cell.audioPath) continue; // ✅ skip cells that already have audio
          const _cont = _cell._audioContainer;
          await new Promise(r => setTimeout(r, 800));
          if (_genVoicesAbort) break;
          // Mark THIS cell as currently active (distinguishes from queued ones below)
          _setStatus(_cont, 'active');
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
            // 3 attempts total (initial + 2 retries) with 2.5s wait between tries
            let _ap, _lastErr;
            for (let _att = 0; _att < 3; _att++) {
              try { _ap = await _doTtsReq(); _lastErr = null; break; }
              catch (_e) { _lastErr = _e; if (_att < 2) await new Promise(r => setTimeout(r, 2500)); }
            }
            if (_lastErr) throw _lastErr;
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
          // (Old _genVoicesTopBtn UI reset removed — button no longer exists.)
          frozenComponents.forEach((comp, ci) => { if (!comp.isRunning) comp.applyState(); });
          // Auto-collapse Voices panel + show ✓ when all done (whether by Run All or this batch).
          // Defined later in голосаPanel block — guarded since execution order may vary across re-renders.
          if (typeof _refreshVoicesPanelState === 'function') _refreshVoicesPanelState();
        }
      };

      // ── Phase 2 (mix images) — sequential SUBMISSION + parallel polling ──────
      // For each cell needing a mix:
      //   1. analyze + POST (via existing retryCellImage)
      //   2. Wait ONLY until POST succeeds (via _onMixSubmitted callback)
      //   3. Move to next cell — polling continues in background
      // After all submitted, await all parallel polls so UI updates fully.
      window._runPhase2 = window._runPhase2 || {};
      const _runPhase2Internal = async () => {
        // Block per-cell action buttons across the whole project during the run
        window._runAllPhaseRunning = window._runAllPhaseRunning || {};
        window._runAllPhaseRunning[sessionKey] = 'ph2';
        frozenComponents.forEach(c => {
          // Block ALL cell clicks (image / item / dropdown picker) so user
          // can't accidentally swap an образ/предмет mid-generation.
          // BUT keep video thumb clickable so user can preview ready clips.
          if (c.cell?._colEl)          c.cell._colEl.style.pointerEvents = 'none';
          if (c.cell?._videoContainer) c.cell._videoContainer.style.pointerEvents = 'auto';
          if (c.actionBtn) {
            c.actionBtn.disabled = true;
            c.actionBtn.style.opacity = '0.4';
            c.actionBtn.title = 'Disabled during Run All Phase 2';
          }
          if (c.cell?._resetBtn) {
            c.cell._resetBtn.disabled = true;
            c.cell._resetBtn.style.opacity = '0.4';
            c.cell._resetBtn.title = 'Disabled during Run All Phase 2';
          }
        });
        try {
          const todo = frozenComponents.filter((comp, idx) => {
            if (_editExcludedSet.has(idx)) return false;
            const c = comp.cell;
            if (!c.line || !c.detInfo) return false;
            return !c.mixes?.[c.detInfo.file];
          });
          const allPolls = [];
          for (const comp of todo) {
            // Cancel hook: stops issuing NEW submissions; current one finishes
            if (window._runAllAbort?.[sessionKey]) break;
            // Set up "submitted" promise for this cell
            const cellRef = editFrozenSessions[sessionKey]?.cells?.[comp.idx];
            if (!cellRef) continue;
            const submitted = new Promise(resolve => { cellRef._onMixSubmitted = resolve; });
            // Kick off full mix gen in BACKGROUND — don't await full completion
            const fullPromise = comp.generateMix();
            allPolls.push(fullPromise);
            // Wait only for THIS cell's POST to be sent before starting next
            await submitted;
            delete cellRef._onMixSubmitted;
          }
          // After sequential submission, wait for parallel polling to finish
          await Promise.all(allPolls);
          // Belt-and-suspenders: refresh the run-all button so it transitions to ph3
          // even if the parent click-handler's finally hasn't run yet.
          try { window._refreshRunAllBtn?.[sessionKey]?.(); } catch {}
        } finally {
          // Re-enable per-cell action + reset buttons; restore clicks; styling
          delete window._runAllPhaseRunning[sessionKey];
          frozenComponents.forEach(c => {
            if (c.cell?._colEl)          c.cell._colEl.style.pointerEvents = '';
            if (c.cell?._videoContainer) c.cell._videoContainer.style.pointerEvents = '';
            if (c.actionBtn) {
              c.actionBtn.style.opacity = '';
              c.actionBtn.title = '';
            }
            if (c.cell?._resetBtn) {
              c.cell._resetBtn.disabled = false;
              c.cell._resetBtn.style.opacity = '';
              c.cell._resetBtn.title = '';
            }
            // applyState restores correct disabled state for current cell data
            c.applyState?.();
          });
        }
      };
      window._runPhase2[sessionKey] = _runPhase2Internal;

      // ── Phase 3 (Kling avatar videos) — sequential SUBMISSION + parallel polling ──
      // For each cell needing a video:
      //   1. analyze + uploadImage + buildPrompt + POST /api/audio/avatar (Kling)
      //   2. Wait ONLY until POST succeeds (via _onAvatarSubmitted callback)
      //   3. Move to next cell — polling continues in background
      // After all submitted, await all parallel polls so UI updates fully.
      window._runPhase3 = window._runPhase3 || {};
      const _runPhase3Internal = async () => {
        window._runAllPhaseRunning = window._runAllPhaseRunning || {};
        window._runAllPhaseRunning[sessionKey] = 'ph3';
        // Block per-cell action + reset buttons + ALL cell clicks during the run.
        // BUT keep video thumb clickable so user can preview ready clips.
        frozenComponents.forEach(c => {
          if (c.cell?._colEl)          c.cell._colEl.style.pointerEvents = 'none';
          if (c.cell?._videoContainer) c.cell._videoContainer.style.pointerEvents = 'auto';
          if (c.actionBtn) {
            c.actionBtn.disabled = true;
            c.actionBtn.style.opacity = '0.4';
            c.actionBtn.title = 'Disabled during Run All Phase 3';
          }
          if (c.cell?._resetBtn) {
            c.cell._resetBtn.disabled = true;
            c.cell._resetBtn.style.opacity = '0.4';
            c.cell._resetBtn.title = 'Disabled during Run All Phase 3';
          }
        });
        try {
          const todo = frozenComponents.filter((comp, idx) => {
            if (_editExcludedSet.has(idx)) return false;
            const c = comp.cell;
            if (!c.line || !c.audioPath) return false; // need audio for Kling
            return !c.videoPath; // skip cells already with video
          });
          const allPolls = [];
          for (const comp of todo) {
            // Cancel hook: stops issuing NEW submissions; current finishes
            if (window._runAllAbort?.[sessionKey]) break;
            const cellRef = editFrozenSessions[sessionKey]?.cells?.[comp.idx];
            if (!cellRef) continue;
            // Set up "submitted" promise — resolved by runSingleAvatar after POST
            const submitted = new Promise(resolve => { cellRef._onAvatarSubmitted = resolve; });
            // Kick off avatar gen in BACKGROUND
            const fullPromise = comp.generateAvatar();
            allPolls.push(fullPromise);
            // Wait only for THIS cell's POST to be sent before starting next
            await submitted;
            delete cellRef._onAvatarSubmitted;
          }
          // After sequential submission, wait for parallel polling to finish
          await Promise.all(allPolls);
          // Belt-and-suspenders: refresh the run-all button (ph3 → done).
          try { window._refreshRunAllBtn?.[sessionKey]?.(); } catch {}
        } finally {
          // Re-enable per-cell action + reset buttons; restore clicks; styling
          delete window._runAllPhaseRunning[sessionKey];
          frozenComponents.forEach(c => {
            if (c.cell?._colEl)          c.cell._colEl.style.pointerEvents = '';
            if (c.cell?._videoContainer) c.cell._videoContainer.style.pointerEvents = '';
            if (c.actionBtn) {
              c.actionBtn.style.opacity = '';
              c.actionBtn.title = '';
            }
            if (c.cell?._resetBtn) {
              c.cell._resetBtn.disabled = false;
              c.cell._resetBtn.style.opacity = '';
              c.cell._resetBtn.title = '';
            }
            c.applyState?.();
          });
        }
      };
      window._runPhase3[sessionKey] = _runPhase3Internal;



      // Auto-run after pending→frozen transition
      if (window._editAutoRun?.sessionKey === sessionKey) {
        const _autoAction = window._editAutoRun.action;
        delete window._editAutoRun;
        if (_autoAction === 'voices') setTimeout(() => { if (typeof _handleGenVoices === 'function') _handleGenVoices(); }, 100);
      }

      voiceRow.style.cssText = 'display:flex;gap:2px;align-items:center;padding:2px 0 4px;border-bottom:1px solid #888;margin-bottom:4px;';
      voiceRow.style.order   = EDIT_BLOCK_ORDER.voiceRow;
      frozenRow.style.order  = EDIT_BLOCK_ORDER.frozenRow;
      block.appendChild(voiceRow);
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
      голосаHeader.style.cssText = 'display:flex;align-items:center;gap:4px;cursor:pointer;user-select:none;padding:3px 0;border-bottom:1px solid #c0c0c0;';
      const голосаArrow = document.createElement('span');
      голосаArrow.textContent = allHaveAudio() ? '▶' : '▼'; голосаArrow.style.cssText = 'font-size:9px;color:#555;flex-shrink:0;';
      const голосаLabel = document.createElement('span');
      голосаLabel.style.cssText = 'font-size:10px;font-weight:bold;color:#333;';
      голосаLabel.textContent = 'Voices';
      // ✓ green checkmark — visible when all non-excluded cells have audioPath
      const голосаCheck = document.createElement('span');
      голосаCheck.textContent = '✓';
      голосаCheck.style.cssText = `font-size:11px;font-weight:bold;color:#1a8a1a;flex-shrink:0;display:${allHaveAudio() ? 'inline' : 'none'};`;
      голосаHeader.appendChild(голосаArrow); голосаHeader.appendChild(голосаLabel); голосаHeader.appendChild(голосаCheck);

      const голосаBody = document.createElement('div');
      голосаBody.style.cssText = `${allHaveAudio() ? 'display:none' : 'display:block'};padding:2px 0;max-height:210px;overflow-y:auto;`;

      голосаHeader.addEventListener('click', () => {
        const open = голосаBody.style.display === 'none';
        голосаBody.style.display = open ? '' : 'none';
        голосаArrow.textContent = open ? '▼' : '▶';
      });

      // Helper to refresh Voices panel state (collapse + show ✓ when all done).
      // Called from _handleGenVoices finally block AND should be call-able after
      // individual cell completions to keep visual state in sync.
      const _refreshVoicesPanelState = () => {
        if (allHaveAudio()) {
          голосаBody.style.display = 'none';
          голосаArrow.textContent = '▶';
          голосаCheck.style.display = 'inline';
        } else {
          голосаCheck.style.display = 'none';
        }
      };
      block._refreshVoicesPanel = _refreshVoicesPanelState; // expose for external triggers

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
      голосаPanel.style.order = EDIT_BLOCK_ORDER.voicesPanel;
      block.appendChild(голосаPanel);


      projectBody.appendChild(block);
      panel.appendChild(projectWrap);
      continue;
    }

    // ── Snapshot current assignments into the session body ────────────────────
    // This ensures образ/предмет pairs survive page refresh, tab switches, and
    // any event that resets the global scenarioAssignments map.
    // SKIPPED for sessions created in 'noitems' mode — otherwise this would
    // re-pull LS-persisted items from prior sessions on every render, undoing
    // the user's explicit "⚪ noitems" choice. Manual item edits inside the
    // Edit panel still flow through their own write path which updates the
    // session snapshot directly (see prodCell click handler below).
    if (sessionData.itemsMode !== 'noitems') {
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

    // ── Auto-freeze helper ───────────────────────────────────────────────────
    // When every line in a pending session has audio, transition pending → frozen
    // so ph2 (mix images) becomes available without a manual 🗣 click. Mirrors the
    // cell-construction logic of pendingActionBtn / generateBtn freeze handlers.
    // Returns true if the session was frozen and renderEditPanel was triggered.
    const _autoFreezeIfAllVoicesDone = async () => {
      const sess = editFrozenSessions[sessionKey];
      if (!sess?.pending) return false;                       // already frozen
      const tlD = getTimelineData();
      const exclSet = new Set(tlD[sessionKey]?.excludedSegments || []);
      const allDone = lines.every((_, idx) => {
        if (exclSet.has(idx)) return true;
        return !!editCardCache[`${sessionKey}__${idx}__audio`]?.audioPath;
      });
      if (!allDone) return false;
      const sessionCells = lines.map((ln, lineIdx) => {
        const ak2 = `${f.file}__${lineIdx}`;
        const df2 = _resolveAssignment(sessionData, ak2);
        const di2 = df2
          ? (cachedDetailFiles.find(d => d.file === df2) || {
              file: df2,
              path: `/details/${df2}`,
              thumbPath: `/details/thumbs/${df2.replace(/\.[^.]+$/, '')}.jpg`,
              name: df2.replace(/\.[^.]+$/, ''),
            })
          : null;
        const ck2  = `${sessionKey}__${lineIdx}`;
        const aud2 = editCardCache[`${sessionKey}__${lineIdx}__audio`]?.audioPath || null;
        const img2 = editCardCache[ck2]?.imagePath || null;
        return {
          line: ln, detInfo: di2,
          charImagePath: lineImages[lineIdx],
          imagePath: di2 ? (img2 || null) : lineImages[lineIdx],
          audioPath: aud2,
        };
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
      await renderEditPanel();
      return true;
    };

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
      let detFile    = _resolveAssignment(sessionData, assignKey);
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
          const df2 = _resolveAssignment(sessionData, ak2);
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
            // Saved value matches current options → restore it.
            poseSel.value = saved;
          } else if (saved === null && hasChar && hasProd) {
            // ONLY when NO saved value at all → pick random and persist.
            // Don't overwrite saved values that happen not to match current options
            // (state may swing between options sets — preserve user's preference).
            const _rndPose = Math.random() < 0.5 ? 'left_hand' : 'right_hand_face';
            poseSel.value = _rndPose;
            localStorage.setItem(poseKey, _rndPose);
          } else if (saved !== null) {
            // Saved exists but doesn't match current options (e.g. state switched
            // BOTH ↔ PRODUCT_ONLY). Show first option visually, but DO NOT save —
            // user's saved preference is preserved for when state matches again.
            if (poseOpts.length > 0) poseSel.value = poseOpts[0].value;
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

    // ── Pending: voice selection row (voice + ▶ preview + { } params + 🔊 gen all) ─
    // Same voiceRow used in frozen state — append it here too so voiceSel/ttsParamsBtn
    // are visible in PENDING state (before user clicks 🗣 to freeze).
    voiceRow.style.cssText = 'display:flex;gap:2px;align-items:center;padding:2px 0 4px;border-bottom:1px solid #888;margin-bottom:4px;';
    voiceRow.style.order   = EDIT_BLOCK_ORDER.voiceRow;
    block.appendChild(voiceRow);

    // Wire up _handleGenVoices for PENDING state (frozen branch wires its own).
    // Skips lines that already have audio in editCardCache → no needless regen.
    // Per-row status indicators are populated by голосаПанельP forEach (below) into
    // _pendingAudioRefs — captured here by closure, used at click-time when refs exist.
    const _pendingAudioRefs = {}; // idx → audioArea DOM element
    {
      const _tlDataPV = getTimelineData();
      const _exclSetPV = new Set(_tlDataPV[sessionKey]?.excludedSegments || []);
      // Per-row status helper (queued / active / done / fail)
      const _setRowStatus = (idx, kind, payload) => {
        const area = _pendingAudioRefs[idx];
        if (!area) return;
        if (kind === 'queued') area.innerHTML = '<span style="font-size:9px;color:#888;">⏳ queued</span>';
        else if (kind === 'active') area.innerHTML = '<span style="font-size:9px;color:#0070cc;font-weight:bold;">🎙 generating…</span>';
        else if (kind === 'done') {
          area.innerHTML = '';
          const a = document.createElement('audio'); a.controls = true; a.src = payload;
          a.style.cssText = 'height:24px;width:110px;'; area.appendChild(a);
        } else if (kind === 'fail') {
          area.innerHTML = ''; const e = document.createElement('span'); e.textContent = '❌'; e.title = payload || 'TTS failed';
          e.style.cssText = 'font-size:9px;color:#aa0000;'; area.appendChild(e);
        }
      };
      _handleGenVoices = async () => {
        if (_genVoicesRunning) return;
        _genVoicesRunning = true; _genVoicesAbort = false;
        // (Old _genVoicesTopBtn button UI was removed — workflow runs through
        // ph1/ph2/ph3 now. runAllBtn shows the in-progress state for us.)
        const _v = getProjectVoice();

        // Pre-mark all cells that will be processed as "queued" so user sees
        // the full scope of work upfront. Skip excluded and already-generated.
        const _todoIdx = [];
        for (let idx = 0; idx < lines.length; idx++) {
          if (_exclSetPV.has(idx)) continue;
          const audioKey = `${sessionKey}__${idx}__audio`;
          if (editCardCache[audioKey]?.audioPath) continue; // ✅ skip already-generated
          _todoIdx.push(idx);
          _setRowStatus(idx, 'queued');
        }

        try {
          for (const idx of _todoIdx) {
            if (_genVoicesAbort) break;
            const audioKey = `${sessionKey}__${idx}__audio`;
            _setRowStatus(idx, 'active');
            const _doTtsReq = async () => {
              const r = await fetch('/api/audio/tts', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: lines[idx], voice: _v, ttsParams: getProjectTtsParams(), model: getAudioEngine?.() }),
              });
              const d = await r.json();
              if (!d.success) throw new Error(d.error);
              return d.audioPath || await pollTts(d.taskId);
            };
            try {
              // 3 attempts total (initial + 2 retries) with 2.5s wait between tries
              let audioPath, _lastErr;
              for (let _att = 0; _att < 3; _att++) {
                try { audioPath = await _doTtsReq(); _lastErr = null; break; }
                catch (e) { _lastErr = e; if (_att < 2) await new Promise(r => setTimeout(r, 2500)); }
              }
              if (_lastErr) throw _lastErr;
              editCardCache[audioKey] = { audioPath };
              _setRowStatus(idx, 'done', audioPath);
              // Enable corresponding pending action button (it gates on audio ready)
              const _pb = _pendingActionBtns[idx];
              if (_pb) { _pb.disabled = false; _pb.style.color = ''; }
            } catch (err) {
              editCardCache[audioKey] = { audioError: err.message };
              _setRowStatus(idx, 'fail', err.message);
            }
            saveEditState();
          }
        } finally {
          _genVoicesRunning = false; _genVoicesAbort = false;
          // (Old _genVoicesTopBtn UI reset removed — button no longer exists.)
        }
        // After bulk completion, auto-freeze if all voices are present so ph2 unlocks.
        await _autoFreezeIfAllVoicesDone();
      };
    }

    tableWrap.style.order = EDIT_BLOCK_ORDER.tableWrap;
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
        // Register audioArea for bulk-gen status updates (queued/active/done/fail)
        _pendingAudioRefs[idx] = audioArea;

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
          // If this single-cell run completed the set, auto-freeze the session.
          await _autoFreezeIfAllVoicesDone();
        };

        genBtn.addEventListener('click', _runTtsP);

        rowEl.appendChild(numEl); rowEl.appendChild(genBtn);
        rowEl.appendChild(audioArea); rowEl.appendChild(textEl);
        голосаТелоP.appendChild(rowEl);
      });

      // ttsBtn bulk handler for pending state — skips already-generated audio
      ttsBtn.addEventListener('click', async () => {
        ttsBtn.disabled = true; ttsBtn.textContent = '⏳';
        голосаТелоP.style.display = ''; голосаArrowP.textContent = '▼';
        await Promise.all(lines.map(async (line, idx) => {
          if (_exclSetP.has(idx)) return;
          const audioKey = `${sessionKey}__${idx}__audio`;
          if (editCardCache[audioKey]?.audioPath) return; // ✅ skip already-generated
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
        // Auto-freeze if everything is in; otherwise just re-render to refresh row states.
        const _froze = await _autoFreezeIfAllVoicesDone();
        if (!_froze) renderEditPanel();
      });

      голосаПанельP.appendChild(голосаHdrP); голосаПанельP.appendChild(голосаТелоP);
      голосаПанельP.style.order = EDIT_BLOCK_ORDER.pendingVoices;
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
        const df = _resolveAssignment(sessionData, ak);
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
  // Use only the session snapshot — never fall back to the global
  // scenarioAssignments LS, which may still hold prior-session items even
  // for noitems-mode sessions. Manual item edits in the Edit panel write
  // to both LS and the session snapshot, so the snapshot is authoritative.
  const uniqueDetails = [...new Set(
    lines.map((_, i) => sessionAssignments[`${f.file}__${i}`]).filter(Boolean)
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

const _avatarAbortedTasks = new Set();
window._avatarAbortedTasks = _avatarAbortedTasks;

async function pollAvatar(taskId, intervalMs = 5000, maxAttempts = 120, actRow = null) {
  let netErrors = 0;
  for (let i = 0; i < maxAttempts; ) {
    await new Promise(r => setTimeout(r, intervalMs));
    if (_avatarAbortedTasks.has(taskId)) {
      _avatarAbortedTasks.delete(taskId);
      actRow?.finalize?.('⏹ Cancelled');
      throw new Error('Cancelled');
    }
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

// ── Auto-star "★ add to merge" once all talking-head videos are generated ─
// Sets sess.starred = true ONCE, when every audio cell has videoPath. Returns
// true if it just transitioned the flag (caller may want to re-render).
// Skips if user already toggled the star (starred === true or === false).
function _autoStarIfAvatarsDone(sessionKey) {
  const sess = editFrozenSessions[sessionKey];
  if (!sess?.cells) return false;
  if (sess.starred !== undefined) return false;
  const audioCells = sess.cells.filter(c => c.audioPath);
  const allVideosIn = audioCells.length > 0 &&
    audioCells.every(c => c.videoPath && !c._videoPending && !c.avatarTaskId);
  if (!allVideosIn) return false;
  sess.starred = true;
  saveEditState();
  return true;
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

  const videoParams   = getEngineParams?.('kling/ai-avatar-standard') || {};
  const defaultPrompt = 'Natural speaking motion with subtle head movement and relaxed posture';

  // Selected avatar model per-global + its params.
  const _selectedModel = (() => {
    const v = localStorage.getItem(`edit_avatar_model_global`);
    const allowed = ['kling/ai-avatar-standard','kling/ai-avatar-pro','prunaai/p-video-avatar'];
    return allowed.includes(v) ? v : 'kling/ai-avatar-standard';
  })();
  const _isMinimalistAvatar = (_selectedModel === 'prunaai/p-video-avatar');
  const _avatarParams = (() => {
    try {
      const all = JSON.parse(localStorage.getItem(`edit_avatar_params_global`) || '{}');
      return all[_selectedModel] || {};
    } catch { return {}; }
  })();
  const _modelSchema = window.ENGINE_SCHEMAS?.[_selectedModel];

  // Pull the right scenario motion-hint based on target model: the rich
  // motionPrompt for kling, the minimalistMotionPrompt for p-video-avatar.
  let _scenarioMotionHint = '';
  try {
    const _scenFile = frozen?.scenFile;
    if (_scenFile) {
      const _mr = await fetch(`/api/scenarios/meta/${encodeURIComponent(_scenFile)}`);
      const _md = await _mr.json();
      if (_md.success && _md.meta) {
        _scenarioMotionHint = _isMinimalistAvatar
          ? (_md.meta.minimalistMotionPrompt || '')
          : (_md.meta.motionPrompt || '');
      }
    }
  } catch {}

  onProgress?.('Generating prompt…');
  let prompt = defaultPrompt;
  try {
    const pr = await fetch('/api/audio/avatar-prompt', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imagePath: imgPath, text: cell.line, detailImagePath: cell.detInfo?.path || null,
                            motionHint: _scenarioMotionHint || undefined,
                            targetModel: _selectedModel }),
    });
    const pd = await pr.json();
    if (pd.success && pd.prompt) prompt = pd.prompt;
  } catch {}

  // 15s audio block for kie.ai models.
  if (_modelSchema?.maxAudioSec) {
    let _audioSec = cell._audioSec || 0;
    if (!_audioSec && cell.audioPath) {
      _audioSec = await new Promise(resolve => {
        const a = new Audio(cell.audioPath);
        a.addEventListener('loadedmetadata', () => resolve(a.duration || 0), { once: true });
        a.addEventListener('error', () => resolve(0), { once: true });
        a.load();
      });
      cell._audioSec = _audioSec;
    }
    if (_audioSec > _modelSchema.maxAudioSec) {
      return { success: false, error: `audio is ${_audioSec.toFixed(1)}s — Kling caps at ${_modelSchema.maxAudioSec}s. Switch to p-video-avatar.` };
    }
  }

  // Clear old video, mark pending
  delete cell.videoPath;
  cell.videoError = null;
  cell._videoPending = true;
  saveEditState();

  try {
    onProgress?.('Launching avatar…');
    const _endpoint = (_selectedModel === 'prunaai/p-video-avatar') ? '/api/audio/avatar-replicate' : '/api/audio/avatar';
    const _body = (_selectedModel === 'prunaai/p-video-avatar')
      ? { imagePath: imgPath, audioPath: cell.audioPath, prompt, params: _avatarParams }
      : { imagePath: imgPath, audioPath: cell.audioPath, prompt, videoParams, model: _selectedModel };
    const r = await fetch(_endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(_body),
    });
    const d = await r.json();
    if (!d.success) throw new Error(d.error);
    cell.avatarTaskId  = d.taskId;
    cell._videoPending = true;
    saveEditState();
    window.maybeStartAvatarPoller?.();
    onProgress?.('Waiting for result…');
    const videoPath = await pollAvatar(d.taskId);
    cell.videoPath = videoPath; cell.videoError = null;
    delete cell.avatarTaskId; delete cell._videoPending;
    saveEditState();
    renderMontagePanel?.(); renderAllTimelines?.();
    // Auto-light "★ add to merge" if this finished the set (sets starred=true so the
    // upcoming renderEditPanel picks it up).
    _autoStarIfAvatarsDone(sessionKey);
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
    if (err.message === 'Cancelled') return { success: false, error: 'Cancelled' };
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
