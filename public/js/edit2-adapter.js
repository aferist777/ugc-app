/* ═══════════════════════════════════════════════════════════════════════════
   edit2-adapter.js — data layer for Edit v2 (window.EDIT2).

   Reads the SAME model the current Edit tab uses (editFrozenSessions +
   editCardCache + timeline_data_v2 excludedSegments + obrazy library) and
   resolves two normalized shapes the new UI renders:

     EDIT2.listProjects(includeClosed)  → [projectSummary]   (cards overview)
     EDIT2.buildWorkspace(sessionKey)   → workspace model     (popup: rows × stages)

   Plus visibility/lifecycle helpers (open/close/reopen, star→Merge, delete) and
   a couple of thin write helpers. NO generation logic here (that's edit2-engine,
   later phases) and NO UI. Writes go back through the existing globals
   (saveEditState / setTimelineData / saveSkleykaClosed) so the legacy Edit tab
   and Edit v2 stay in sync on the same data.

   Reused globals (defined earlier in the <script> order):
     editFrozenSessions, saveEditState, removeEditProject,
     _loadEditLastVisible / _saveEditLastVisible           (scen-state.js)
     getObrazы                                              (obrazy.js)
     getTimelineData / setTimelineData                      (scen-montage.js)
     getSkleykaClosed / saveSkleykaClosed                   (scen-timeline.js)
   ═══════════════════════════════════════════════════════════════════════════ */

(function () {
  const EDIT2 = {};

  // ── small utils ─────────────────────────────────────────────────────────────
  function _sessions() {
    return (typeof editFrozenSessions !== 'undefined') ? editFrozenSessions : (window.editFrozenSessions || {});
  }
  function _obrazList() {
    return (typeof getObrazы === 'function') ? getObrazы() : [];
  }
  function _obrazOf(sess) {
    if (!sess) return null;
    const id = String(sess.obrazId);
    return _obrazList().find(o => String(o.id) === id) || null;
  }
  // Character image pool for an образ: main char + valid pose variations.
  function _variations(obraz) {
    if (!obraz) return [];
    return [obraz.char].concat(((obraz.variations) || []).filter(v => v && v !== 'error')).filter(Boolean);
  }
  function _pickVar(vars, obraz) {
    if (vars.length) return vars[Math.floor(Math.random() * vars.length)];
    return (obraz && obraz.char) || null;
  }

  function _scenName(sess, key) {
    const raw = (sess && sess.scenFile) || key.split('__').slice(1, -1).join('__') || '';
    return raw.replace(/\.txt$/i, '');
  }
  function _title(key, sess) {
    if (sess && sess.title) return sess.title;
    let dstr = '';
    if (sess && sess.date) {
      try {
        dstr = new Date(sess.date).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
               ' ' + new Date(sess.date).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      } catch {}
    }
    const obraz = _obrazOf(sess);
    return [dstr, _scenName(sess, key), obraz && obraz.name].filter(Boolean).join(' — ') || key;
  }

  // Set of excluded line indices for a session (timeline_data_v2.excludedSegments).
  function _excludedSet(key) {
    try {
      const d = (typeof getTimelineData === 'function') ? getTimelineData() : {};
      return new Set((d[key] && d[key].excludedSegments) || []);
    } catch { return new Set(); }
  }

  // ── per-cell stage state derivation (best-effort from persisted data) ─────────
  // The live authoritative states (queued/running) are driven by edit2-engine in
  // later phases; here we derive {none|running|done|error|na} from what's stored.
  function _voiceState(c) {
    if (c.audioError) return 'error';
    if (c.audioPath)  return 'done';
    return 'none';
  }
  function _hasMix(c) {
    return !!(c.detInfo && c.mixes && c.detInfo.file && c.mixes[c.detInfo.file]);
  }
  function _mixState(c) {
    if (!c.detInfo) return 'na';            // no product assigned → char image is the frame, no mix step
    if (_hasMix(c)) return 'done';
    if (c.mixTaskId || c.taskId) return 'running';
    return 'none';
  }
  function _videoState(c) {
    if (c.videoError) return 'error';
    if (c.videoPath)  return 'done';
    if (c.avatarTaskId || c._videoPending) return 'running';
    return 'none';
  }
  function _frameImage(c, obraz) {
    // What shows in the "image" column: explicit user pick → mix → imagePath → char.
    if (c.chosenImage) return c.chosenImage;
    if (_hasMix(c)) return c.mixes[c.detInfo.file];
    return c.imagePath || c.charImagePath || (obraz && obraz.char) || null;
  }

  // ── project summary (one card) ────────────────────────────────────────────────
  function _summary(key, sess) {
    const obraz = _obrazOf(sess);
    const cells = Array.isArray(sess.cells) ? sess.cells : [];
    const excl  = _excludedSet(key);
    const active = cells.filter((c, i) => !excl.has(i));
    const nLines  = active.length || cells.length;
    const nVoices = active.filter(c => c.audioPath).length;
    const nMixes  = active.filter(c => _hasMix(c)).length;
    const nVideos = active.filter(c => c.videoPath).length;
    const nMixNeed = active.filter(c => !!c.detInfo).length; // rows that actually need a mix

    let stage;
    if (sess.pending)                                stage = 'draft';
    else if (active.length && nVideos === active.length) stage = 'done';
    else if (nVideos > 0 || active.some(c => c.avatarTaskId || c._videoPending)) stage = 'producing';
    else if (active.length && nVoices === active.length) stage = 'voiced';
    else                                             stage = 'voicing';

    // Thumbnail: first active cell's frame, else the образ's main character image
    // (so freshly-created / pending projects show the character, not a placeholder).
    let thumb = null;
    for (const c of cells) { const f = _frameImage(c, obraz); if (f) { thumb = f; break; } }
    if (!thumb && obraz) thumb = obraz.char || _pickVar(_variations(obraz), obraz) || null;

    return {
      sessionKey: key,
      title:      _title(key, sess),
      scenName:   _scenName(sess, key),
      obrazName:  obraz ? obraz.name : '',
      date:       sess.date || null,
      thumb,
      pending:    !!sess.pending,
      starred:    sess.starred === true,
      closed:     !!sess.hiddenFromEdit,
      stage,
      counts: { lines: nLines, voices: nVoices, mixes: nMixes, mixNeed: nMixNeed, videos: nVideos },
    };
  }

  // ── public: list projects for the cards overview ───────────────────────────────
  // includeClosed=false hides sessions with hiddenFromEdit. Sorted newest-first.
  EDIT2.listProjects = function (includeClosed) {
    const out = [];
    for (const [key, sess] of Object.entries(_sessions())) {
      if (!sess) continue;
      if (!Array.isArray(sess.cells) && !sess.pending) continue;   // include pending (cells built on open)
      if (!includeClosed && sess.hiddenFromEdit) continue;
      try { out.push(_summary(key, sess)); } catch (e) { /* skip a malformed session, never break the list */ }
    }
    // date may be an ISO string OR a numeric timestamp across sessions — coerce.
    out.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    return out;
  };

  EDIT2.getProject = function (sessionKey) {
    const sess = _sessions()[sessionKey];
    return sess ? _summary(sessionKey, sess) : null;
  };

  // ── public: build the workspace model for the popup (rows × stages) ────────────
  EDIT2.buildWorkspace = function (sessionKey) {
    const sess = _sessions()[sessionKey];
    if (!sess || !Array.isArray(sess.cells)) return null;
    const obraz = _obrazOf(sess);
    const excl  = _excludedSet(sessionKey);

    const rows = sess.cells.map((c, idx) => ({
      idx,
      line:          c.line || '',
      excluded:      excl.has(idx),
      charImagePath: c.charImagePath || null,
      detInfo:       c.detInfo || null,
      hasMix:        _hasMix(c),
      motionPrompt:  c.motionPrompt || '',
      frameImage:    _frameImage(c, obraz),
      imagePath:     c.imagePath || null,
      audioPath:     c.audioPath || null,
      videoPath:     c.videoPath || null,
      avatarTaskId:  c.avatarTaskId || null,
      videoPending:  !!c._videoPending,
      audioError:    c.audioError || null,
      videoError:    c.videoError || null,
      voiceState:    _voiceState(c),
      mixState:      _mixState(c),
      videoState:    _videoState(c),
    }));

    const summary = _summary(sessionKey, sess);
    return {
      sessionKey,
      title:    summary.title,
      scenName: summary.scenName,
      scenFile: sess.scenFile || null,
      pending:  !!sess.pending,
      stage:    summary.stage,
      counts:   summary.counts,
      obraz:    obraz ? { id: obraz.id, name: obraz.name, char: obraz.char || null, voice: obraz.voice || null } : null,
      itemsMode: sess.itemsMode || null,
      rows,
    };
  };

  // ── visibility / lifecycle ─────────────────────────────────────────────────────
  // Close in Edit: hide the card; drop it from the last-visible set so it stays
  // hidden on reload. Does NOT touch Merge (skleyka) — mirrors the legacy ✕ button.
  EDIT2.closeProject = function (sessionKey) {
    const sess = _sessions()[sessionKey];
    if (sess) sess.hiddenFromEdit = true;
    if (typeof _loadEditLastVisible === 'function' && typeof _saveEditLastVisible === 'function') {
      const lv = _loadEditLastVisible();
      if (lv && lv.delete(sessionKey)) _saveEditLastVisible(lv);
    }
    if (typeof saveEditState === 'function') saveEditState();
  };

  // Reopen a closed project in Edit. Also add it back to the last-visible set so
  // it stays open across reloads (loadEditState re-derives hiddenFromEdit from it).
  EDIT2.reopenProject = function (sessionKey) {
    const sess = _sessions()[sessionKey];
    if (sess) sess.hiddenFromEdit = false;
    if (typeof _loadEditLastVisible === 'function' && typeof _saveEditLastVisible === 'function') {
      const lv = _loadEditLastVisible() || new Set();
      lv.add(sessionKey); _saveEditLastVisible(lv);
    }
    if (typeof saveEditState === 'function') saveEditState();
  };

  // Persist exactly which projects are currently open in Edit v2, so the same set
  // is restored after an app reload (mirrors the legacy Edit panel's behaviour).
  EDIT2.persistVisible = function (sessionKeys) {
    if (typeof _saveEditLastVisible === 'function') _saveEditLastVisible(sessionKeys || []);
  };

  // Star ⇄ "show in Merge". starred + remove-from-skleyka-closed, or unstar + add.
  EDIT2.setStarred = function (sessionKey, val) {
    const sess = _sessions()[sessionKey];
    if (!sess) return;
    sess.starred = !!val;
    if (typeof getSkleykaClosed === 'function' && typeof saveSkleykaClosed === 'function') {
      const c = getSkleykaClosed();
      if (val) c.delete(sessionKey); else c.add(sessionKey);
      saveSkleykaClosed(c);
    }
    if (typeof saveEditState === 'function') saveEditState();
  };

  // ── ★ Send-to-Merge: one-way incremental sync Edit → Merge ──────────────────
  // Membership lives on the session (sess.inMerge) and persists + syncs cross-page
  // via edit-sync. sess.mergeSyncSig records the Edit state at the last sync, so ★
  // re-lights when something changed in Edit (new videos / regenerated voices).
  // The fragment media is read LIVE by Merge's buildModel and the user's manual
  // timeline edits live separately in timeline_data_v2 (never touched here).
  EDIT2.mergeSignature = function (sessionKey) {
    const s = _sessions()[sessionKey];
    if (!s || !Array.isArray(s.cells)) return '';
    return s.cells.map(c => (c.audioPath ? 'a' : '-') + (c.videoPath ? 'v' : '-') + ':' + String(c.line || '').length).join('|');
  };
  // True once EVERY fragment has a generated voice (video not required).
  EDIT2.allVoicesReady = function (sessionKey) {
    const s = _sessions()[sessionKey];
    if (!s || !Array.isArray(s.cells) || !s.cells.length) return false;
    return s.cells.every(c => !!c.audioPath);
  };
  EDIT2.isInMerge = function (sessionKey) { const s = _sessions()[sessionKey]; return !!(s && s.inMerge === true); };
  // ★ state: 'disabled' (voices not all ready) | 'create' (ready, not in Merge yet)
  //          | 'sync' (in Merge + Edit changed since last sync) | 'synced'.
  EDIT2.mergeStarState = function (sessionKey) {
    if (!EDIT2.isInMerge(sessionKey)) return EDIT2.allVoicesReady(sessionKey) ? 'create' : 'disabled';
    const s = _sessions()[sessionKey];
    return (s && s.mergeSyncSig === EDIT2.mergeSignature(sessionKey)) ? 'synced' : 'sync';
  };
  EDIT2.createInMerge = function (sessionKey) {
    const s = _sessions()[sessionKey]; if (!s) return false;
    s.inMerge = true; s.mergeSyncSig = EDIT2.mergeSignature(sessionKey);
    if (typeof saveEditState === 'function') saveEditState();
    return true;
  };
  EDIT2.syncToMerge = function (sessionKey) {
    const s = _sessions()[sessionKey]; if (!s || s.inMerge !== true) return false;
    s.mergeSyncSig = EDIT2.mergeSignature(sessionKey);
    if (typeof saveEditState === 'function') saveEditState();
    return true;
  };
  // ★ click dispatcher (card / popup): create if new, else sync. Returns the action
  // performed ('created' | 'synced') or null when disabled / already up to date.
  EDIT2.sendToMerge = function (sessionKey) {
    const st = EDIT2.mergeStarState(sessionKey);
    if (st === 'create') { EDIT2.createInMerge(sessionKey); return 'created'; }
    if (st === 'sync')   { EDIT2.syncToMerge(sessionKey);   return 'synced'; }
    return null;
  };
  // Paint a ★ button to reflect the current send-to-Merge state. Shared by the
  // Edit card and the project popup so they always look identical.
  EDIT2.renderMergeStar = function (btn, sessionKey) {
    const st = EDIT2.mergeStarState(sessionKey);
    btn.classList.remove('star-disabled', 'star-create', 'star-sync', 'star-synced');
    btn.classList.add('star-' + st);
    btn.disabled = (st === 'disabled');
    if (st === 'disabled')      { btn.textContent = '☆'; btn.title = 'Generate all voices first to send this project to Merge'; }
    else if (st === 'create')   { btn.textContent = '☆'; btn.title = 'Send to Merge'; }
    else if (st === 'sync')     { btn.textContent = '★'; btn.title = 'Sync new fragments (video/voice) into the Merge project'; }
    else                        { btn.textContent = '★'; btn.title = 'In Merge — up to date'; }
    return st;
  };

  // Delete the project RECORD (+ card cache) via the existing helper. The on-disk
  // file wipe (audio/mix/video) + Merge renders are added in Ф7 (needs a backend
  // endpoint); this only clears the localStorage record for now.
  EDIT2.deleteProjectRecord = function (sessionKey) {
    if (typeof removeEditProject === 'function') removeEditProject(sessionKey);
    else { delete _sessions()[sessionKey]; if (typeof saveEditState === 'function') saveEditState(); }
    if (typeof _loadEditLastVisible === 'function' && typeof _saveEditLastVisible === 'function') {
      const lv = _loadEditLastVisible();
      if (lv && lv.delete(sessionKey)) _saveEditLastVisible(lv);
    }
    if (typeof getSkleykaClosed === 'function' && typeof saveSkleykaClosed === 'function') {
      const c = getSkleykaClosed();
      if (c.delete(sessionKey)) saveSkleykaClosed(c);
    }
  };

  // Delete a project: wipe its generated files (audio/mix/video) + Merge renders,
  // then remove the record. Does NOT touch the образ/product library (server only
  // deletes under uploads/finals). Returns { files, renders }.
  EDIT2.deleteProject = async function (sessionKey) {
    const s = _sessions()[sessionKey];
    const paths = new Set();
    if (s && Array.isArray(s.cells)) {
      s.cells.forEach(c => {
        [c.audioPath, c.videoPath, c.imagePath].forEach(u => { if (u) paths.add(u); });
        if (c.mixes) Object.values(c.mixes).forEach(u => { if (u) paths.add(u); });
        if (Array.isArray(c.generatedImages)) c.generatedImages.forEach(u => { if (u) paths.add(u); });
      });
    }
    let files = 0, renders = 0;
    try {
      const r = await fetch('/api/edit/session-files', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paths: [...paths] }) });
      const d = await r.json(); if (d && d.success) files = d.deleted || 0;
    } catch {}
    try {
      const r = await fetch('/api/finals/by-project', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: sessionKey }) });
      const d = await r.json(); if (d && d.success) renders = d.deleted || 0;
    } catch {}
    // Phase B: remove the whole per-project folder (catches any leftover files).
    try { await fetch('/api/edit/project-folder', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectKey: sessionKey }) }); } catch {}
    EDIT2.deleteProjectRecord(sessionKey);
    return { files: files, renders: renders };
  };

  // ── thin write helpers (used by later phases) ──────────────────────────────────
  EDIT2.setLine = function (sessionKey, idx, text) {
    const sess = _sessions()[sessionKey];
    if (!sess || !sess.cells || !sess.cells[idx]) return;
    const cell = sess.cells[idx];
    cell.line = text;
    // Keep the active voice-model's text slot in sync so toggling v2⇄v3 keeps edits.
    if (cell.lineBase == null) cell.lineBase = text;
    if (_voiceModeOf(sess) === 'v3') cell.lineTagged = text; else cell.lineBase = text;
    if (typeof saveEditState === 'function') saveEditState();
  };

  // List available product/detail files (for the picker). Cached after first load.
  // Pass force=true (or call EDIT2.invalidateDetails()) after upload/generate/delete
  // so the picker + gallery see the fresh library.
  let _detailsCache = null;
  EDIT2.invalidateDetails = function () { _detailsCache = null; };
  EDIT2.getDetails = function (force) {
    if (_detailsCache && !force) return Promise.resolve(_detailsCache);
    return fetch('/api/details').then(r => r.json())
      .then(d => { _detailsCache = (d && d.success) ? (d.files || []) : []; return _detailsCache; })
      .catch(() => []);
  };

  // Assign (or clear) the product for a cell. detInfo = {file,path,thumbPath,name} | null.
  EDIT2.setDetInfo = function (sessionKey, idx, detInfo) {
    const s = _sessions()[sessionKey];
    if (!s || !Array.isArray(s.cells) || !s.cells[idx]) return;
    if (detInfo) s.cells[idx].detInfo = detInfo;
    else delete s.cells[idx].detInfo;
    if (typeof saveEditState === 'function') saveEditState();
  };

  // Materialize cells for a session that has none yet (freshly CREATEd / pending):
  // fetch the scenario lines, build one cell per line with the product from the
  // session's assignment snapshot and a RANDOM образ variation as the base image.
  // This is the "CREATE lays out random variations" behaviour. No-op if cells exist.
  EDIT2.ensureCells = async function (sessionKey) {
    const s = _sessions()[sessionKey];
    if (!s) return null;
    if (Array.isArray(s.cells) && s.cells.length) return s;
    const scenFile = s.scenFile;
    let lines = [];
    try { if (typeof getLinesForScenario === 'function') lines = await getLinesForScenario(scenFile); } catch {}
    if (!lines.length) return s;
    const obraz = _obrazOf(s);
    const vars = _variations(obraz);
    let detailsByFile = {};
    try { const items = await EDIT2.getDetails(); (items || []).forEach(d => { detailsByFile[d.file] = d; }); } catch {}
    const assignments = s.assignments || {};
    s.cells = lines.map((line, idx) => {
      const detFile = assignments[scenFile + '__' + idx] || null;
      const det = detFile ? (detailsByFile[detFile] || { file: detFile, path: '/details/' + detFile, name: detFile }) : null;
      return { line: line, detInfo: det, charImagePath: _pickVar(vars, obraz), imagePath: null, audioPath: null };
    });
    if (typeof saveEditState === 'function') saveEditState();
    return s;
  };

  // Re-roll the base character image for rows WITHOUT a mix (rows with a mix are
  // left untouched). Returns how many cells changed.
  EDIT2.randomizeImages = function (sessionKey) {
    const s = _sessions()[sessionKey];
    if (!s || !Array.isArray(s.cells)) return 0;
    const obraz = _obrazOf(s);
    const vars = _variations(obraz);
    if (vars.length <= 1) return 0; // nothing to shuffle
    let n = 0;
    s.cells.forEach(c => { if (_hasMix(c)) return; c.charImagePath = _pickVar(vars, obraz); n++; });
    if (n && typeof saveEditState === 'function') saveEditState();
    return n;
  };
  EDIT2.hasVariations = function (sessionKey) {
    const s = _sessions()[sessionKey];
    return s ? _variations(_obrazOf(s)).length > 1 : false;
  };

  // All candidate images for a cell (for the per-cell preview lightbox), deduped:
  // mix → generated → variations → base char. Returns [{url, label}].
  EDIT2.imageCandidates = function (sessionKey, idx) {
    const s = _sessions()[sessionKey];
    if (!s || !Array.isArray(s.cells) || !s.cells[idx]) return [];
    const cell = s.cells[idx];
    const obraz = _obrazOf(s);
    const out = []; const seen = new Set();
    const add = (url, label) => { if (url && !seen.has(url)) { seen.add(url); out.push({ url: url, label: label }); } };
    if (_hasMix(cell)) add(cell.mixes[cell.detInfo.file], 'Mix');
    (cell.generatedImages || []).forEach((u, i) => add(u, 'Generated ' + (i + 1)));
    if (cell.charImagePath) add(cell.charImagePath, 'Current base');
    _variations(obraz).forEach((u, i) => add(u, i === 0 ? 'Base' : 'Variation ' + i));
    return out;
  };

  // Product files marked for THIS project (via the 🔧 product manager). The
  // per-row ➕ picker defaults to these. Back-compat: if a session predates the
  // explicit set, seed it from the legacy assignment snapshot.
  EDIT2.projectProductFiles = function (sessionKey) {
    const s = _sessions()[sessionKey];
    const set = new Set();
    if (!s) return set;
    if (Array.isArray(s.productFiles)) { s.productFiles.forEach(f => { if (f) set.add(f); }); return set; }
    if (s.assignments) Object.values(s.assignments).forEach(v => { if (v) set.add(v); });
    return set;
  };
  EDIT2.isProjectProduct = function (sessionKey, file) {
    return EDIT2.projectProductFiles(sessionKey).has(file);
  };
  // Toggle a library item's membership in this project. Returns the new state.
  EDIT2.toggleProjectProduct = function (sessionKey, file) {
    const s = _sessions()[sessionKey];
    if (!s || !file) return false;
    const set = EDIT2.projectProductFiles(sessionKey);
    if (set.has(file)) set.delete(file); else set.add(file);
    s.productFiles = [...set];
    if (typeof saveEditState === 'function') saveEditState();
    return set.has(file);
  };
  EDIT2.addProjectProducts = function (sessionKey, files) {
    const s = _sessions()[sessionKey];
    if (!s) return;
    const set = EDIT2.projectProductFiles(sessionKey);
    (files || []).forEach(f => { if (f) set.add(f); });
    s.productFiles = [...set];
    if (typeof saveEditState === 'function') saveEditState();
  };
  // Drop a deleted library item from the project + clear any cell pointing at it.
  EDIT2.purgeProduct = function (sessionKey, file) {
    const s = _sessions()[sessionKey];
    if (!s || !file) return;
    if (Array.isArray(s.productFiles)) s.productFiles = s.productFiles.filter(f => f !== file);
    if (Array.isArray(s.cells)) s.cells.forEach(c => { if (c && c.detInfo && c.detInfo.file === file) delete c.detInfo; });
    if (typeof saveEditState === 'function') saveEditState();
  };

  // Explicit per-cell image pick (overrides mix/base for the frame + video).
  EDIT2.setChosenImage = function (sessionKey, idx, url) {
    const s = _sessions()[sessionKey];
    if (!s || !Array.isArray(s.cells) || !s.cells[idx]) return;
    if (url) s.cells[idx].chosenImage = url; else delete s.cells[idx].chosenImage;
    if (typeof saveEditState === 'function') saveEditState();
  };

  // ── Character ⇄ product interaction presets (fed to pre-analyze as presetPrompt) ──
  EDIT2.INTERACTIONS = [
    { key: 'auto', label: 'Auto', prompt:
      "Look at the character's hands, pose and the free space around them, then choose the single most natural way to present this product and write the scene for it. Options to consider: (a) the product lying on a table/surface in front of the character, who looks at or gestures toward it; (b) the product standing upright on a surface beside the character; (c) held in one hand; (d) held in both hands at chest height toward the camera; (e) raised near the face toward the camera. Keep the grip and hands anatomically correct and the product fully visible." },
    { key: 'table_lying', label: 'On table (lying)', prompt:
      'The product lies on a table or surface in front of the character, who looks at or gestures toward it. Product fully visible, correct scale.' },
    { key: 'table_standing', label: 'On table (standing)', prompt:
      'The product stands upright on a table/surface beside the character, clearly visible at correct scale.' },
    { key: 'one_hand', label: 'In one hand', prompt:
      "The character holds the product naturally in one hand — correct grip and proportion, product clearly visible. Pay attention to which hand is free in the source pose." },
    { key: 'both_hands', label: 'In both hands', prompt:
      'The character holds the product with both hands at chest height, presenting it toward the camera. Correct grip, product fully visible.' },
    { key: 'show_camera', label: 'Show to camera', prompt:
      'The character raises the product toward the camera near the face, showcasing it; product prominent and fully visible.' },
  ];
  EDIT2.interactionPrompt = function (interKey) {
    const it = EDIT2.INTERACTIONS.find(x => x.key === (interKey || 'auto'));
    return it ? it.prompt : '';
  };
  EDIT2.setInteraction = function (sessionKey, idx, interKey) {
    const s = _sessions()[sessionKey];
    if (!s || !Array.isArray(s.cells) || !s.cells[idx]) return;
    s.cells[idx].interaction = interKey || 'auto';
    if (typeof saveEditState === 'function') saveEditState();
  };

  // Per-fragment motion/animation prompt (used by genVideo verbatim when set;
  // empty → genVideo auto-analyzes text + image at generation time).
  EDIT2.setMotionPrompt = function (sessionKey, idx, text) {
    const s = _sessions()[sessionKey];
    if (!s || !Array.isArray(s.cells) || !s.cells[idx]) return;
    const t = (text == null) ? '' : String(text);
    if (t.trim()) s.cells[idx].motionPrompt = t; else delete s.cells[idx].motionPrompt;
    if (typeof saveEditState === 'function') saveEditState();
  };

  // True when every active cell that NEEDS a mix already has one (or none need a
  // mix). Gates motion-prompt + video generation, which depend on the mix image.
  EDIT2.allMixesDone = function (sessionKey) {
    const s = _sessions()[sessionKey];
    if (!s || !Array.isArray(s.cells)) return true;
    const excl = _excludedSet(sessionKey);
    return s.cells.every((c, i) => excl.has(i) || !c.detInfo || _hasMix(c));
  };

  // Per-fragment video readiness: a row with a product may only be voiced into
  // video once its mix exists AND the mix image is the active frame (default, or
  // explicitly chosen). Rows without a product use the character image → ready.
  EDIT2.cellVideoReady = function (sessionKey, idx) {
    const s = _sessions()[sessionKey];
    if (!s || !Array.isArray(s.cells) || !s.cells[idx]) return false;
    const c = s.cells[idx];
    if (!c.detInfo) return true;          // no product → no mix needed
    if (!_hasMix(c)) return false;        // mix not generated yet
    const mixUrl = c.mixes[c.detInfo.file];
    // Active frame must be the mix: either no override, or the override IS the mix.
    return !c.chosenImage || c.chosenImage === mixUrl;
  };

  // The image a cell's video/motion analysis uses: explicit pick → mix → base char.
  EDIT2.cellFrame = function (sessionKey, idx) {
    const s = _sessions()[sessionKey];
    if (!s || !Array.isArray(s.cells) || !s.cells[idx]) return null;
    return _frameImage(s.cells[idx], _obrazOf(s));
  };

  EDIT2.setExcluded = function (sessionKey, idx, excluded) {
    if (typeof getTimelineData !== 'function' || typeof setTimelineData !== 'function') return;
    const d = getTimelineData();
    if (!d[sessionKey]) d[sessionKey] = {};
    const set = new Set(d[sessionKey].excludedSegments || []);
    if (excluded) set.add(idx); else set.delete(idx);
    d[sessionKey].excludedSegments = [...set];
    setTimelineData(d);
  };

  // ── Voice model v2 ⇄ v3 (ElevenLabs) with dual generated variants ────────────
  // The active text/audio/video on each cell mirror the CURRENT model. The other
  // model's generated audio/video is archived in cell.gen[mode] so switching back
  // restores it instead of regenerating. lineBase = plain (v2) text, lineTagged =
  // emotionally-tagged (v3) text. Files stay flat for now (per-project folders are
  // Phase B). Default model is v2.
  const _GEN_FIELDS = ['audioPath', 'audioError', 'videoPath', 'videoError', 'avatarTaskId', 'avatarPrompt', '_audioSec', '_videoPending'];
  function _voiceModeOf(sess) { return (sess && sess.voiceModel === 'v3') ? 'v3' : 'v2'; }
  function _ensureBase(cell) { if (cell.lineBase == null) cell.lineBase = cell.line || ''; }
  function _archiveActive(cell, mode) {
    cell.gen = cell.gen || {};
    const snap = {};
    _GEN_FIELDS.forEach(f => { if (cell[f] != null) snap[f] = cell[f]; });
    cell.gen[mode] = snap;
  }
  function _restoreActive(cell, mode) {
    const snap = (cell.gen && cell.gen[mode]) || {};
    _GEN_FIELDS.forEach(f => { if (snap[f] != null) cell[f] = snap[f]; else delete cell[f]; });
  }

  EDIT2.getVoiceModel = function (sessionKey) { return _voiceModeOf(_sessions()[sessionKey]); };

  // True when every active (non-excluded) cell already has a v3 tagged text.
  EDIT2.hasTagged = function (sessionKey) {
    const s = _sessions()[sessionKey];
    if (!s || !Array.isArray(s.cells)) return false;
    const excl = _excludedSet(sessionKey);
    const cells = s.cells.filter((c, i) => !excl.has(i));
    return cells.length > 0 && cells.every(c => c.lineTagged != null && String(c.lineTagged).trim());
  };

  // The plain (v2/base) texts for the tagging request — index-aligned with cells.
  EDIT2.baseLines = function (sessionKey) {
    const s = _sessions()[sessionKey];
    if (!s || !Array.isArray(s.cells)) return [];
    return s.cells.map(c => (c.lineBase != null ? c.lineBase : (c.line || '')));
  };

  // Store the v3 tagged texts returned by /api/scenarios-v2/emotional-tags (aligned
  // to cells by index). When the project is ALREADY on v3 (re-analysing), the
  // active cell.line is updated in place too so the grid reflects the new tags
  // immediately. Does NOT switch the active model — the caller does that.
  EDIT2.applyTaggedTexts = function (sessionKey, arr) {
    const s = _sessions()[sessionKey];
    if (!s || !Array.isArray(s.cells)) return;
    const isV3 = _voiceModeOf(s) === 'v3';
    s.cells.forEach((c, i) => {
      _ensureBase(c);
      if (arr[i] != null) { c.lineTagged = String(arr[i]); if (isV3) c.line = c.lineTagged; }
    });
    if (typeof saveEditState === 'function') saveEditState();
  };

  // Distinct inline audio tags ([excited], [whispers]…) currently placed in the
  // active (non-excluded) cells' tagged text — for the v3 settings field readout.
  EDIT2.placedTags = function (sessionKey) {
    const s = _sessions()[sessionKey];
    if (!s || !Array.isArray(s.cells)) return [];
    const excl = _excludedSet(sessionKey);
    const seen = new Set(), out = [];
    s.cells.forEach((c, i) => {
      if (excl.has(i)) return;
      const t = (c.lineTagged != null) ? String(c.lineTagged) : '';
      const re = /\[[^\]]+\]/g; let m;
      while ((m = re.exec(t))) { const k = m[0].toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(m[0]); } }
    });
    return out;
  };

  // Switch the project's voice model. Archives the current model's generated
  // audio/video + active text, then restores the target model's. Returns true if
  // the active set changed. UI should re-render rows afterwards.
  EDIT2.setVoiceModel = function (sessionKey, mode) {
    mode = (mode === 'v3') ? 'v3' : 'v2';
    const s = _sessions()[sessionKey];
    if (!s || !Array.isArray(s.cells)) return false;
    const cur = _voiceModeOf(s);
    if (cur === mode) return false;
    s.cells.forEach(c => {
      _ensureBase(c);
      // Capture any in-place text edit into the current model's slot first.
      if (cur === 'v3') c.lineTagged = c.line; else c.lineBase = c.line;
      _archiveActive(c, cur);
      _restoreActive(c, mode);
      c.line = (mode === 'v3') ? (c.lineTagged != null ? c.lineTagged : c.lineBase) : c.lineBase;
    });
    s.voiceModel = mode;
    if (typeof saveEditState === 'function') saveEditState();
    return true;
  };

  // Readiness of each model (for the popup badge). Counts active model from live
  // fields, the other model from its gen[] archive.
  EDIT2.voiceModelStats = function (sessionKey) {
    const s = _sessions()[sessionKey];
    const cur = _voiceModeOf(s);
    const other = (cur === 'v3') ? 'v2' : 'v3';
    const empty = { cur, other, curCounts: { voices: 0, videos: 0, lines: 0 }, otherCounts: { voices: 0, videos: 0, lines: 0 }, otherHasAny: false };
    if (!s || !Array.isArray(s.cells)) return empty;
    const excl = _excludedSet(sessionKey);
    const tally = (mode) => {
      let voices = 0, videos = 0, lines = 0;
      s.cells.forEach((c, i) => {
        if (excl.has(i)) return;
        lines++;
        const src = (mode === cur) ? c : ((c.gen && c.gen[mode]) || {});
        if (src.audioPath) voices++;
        if (src.videoPath) videos++;
      });
      return { voices, videos, lines };
    };
    const curCounts = tally(cur), otherCounts = tally(other);
    return { cur, other, curCounts, otherCounts, otherHasAny: (otherCounts.voices + otherCounts.videos) > 0 };
  };

  window.EDIT2 = EDIT2;
})();
