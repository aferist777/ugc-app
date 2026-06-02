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

    // Thumbnail: first active cell's frame, else obraz char.
    let thumb = null;
    for (const c of cells) { const f = _frameImage(c, obraz); if (f) { thumb = f; break; } }

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

  // ── thin write helpers (used by later phases) ──────────────────────────────────
  EDIT2.setLine = function (sessionKey, idx, text) {
    const sess = _sessions()[sessionKey];
    if (!sess || !sess.cells || !sess.cells[idx]) return;
    sess.cells[idx].line = text;
    if (typeof saveEditState === 'function') saveEditState();
  };

  // List available product/detail files (for the picker). Cached after first load.
  let _detailsCache = null;
  EDIT2.getDetails = function () {
    if (_detailsCache) return Promise.resolve(_detailsCache);
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

  // Explicit per-cell image pick (overrides mix/base for the frame + video).
  EDIT2.setChosenImage = function (sessionKey, idx, url) {
    const s = _sessions()[sessionKey];
    if (!s || !Array.isArray(s.cells) || !s.cells[idx]) return;
    if (url) s.cells[idx].chosenImage = url; else delete s.cells[idx].chosenImage;
    if (typeof saveEditState === 'function') saveEditState();
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

  window.EDIT2 = EDIT2;
})();
