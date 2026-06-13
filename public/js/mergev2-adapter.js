/* ═══════════════════════════════════════════════════════════════════════════
   mergev2-adapter.js — data layer for Merge v2.

   Reads the SAME localStorage model the old Merge uses (timeline_data_v2 +
   editFrozenSessions + archives) and resolves a normalized `model` object the
   compositor/timeline can render. Writes go back through setTimelineData, so
   edits made in v2 are visible in the old Merge and vice-versa.

   Exposes window.MV2 with:
     listSessions()                 → [{ sessionKey, label }]
     buildModel(sessionKey)         → Promise<model>  (probes audio durations)
     setSegmentReversed(key, idx, v)
     setExcluded(key, idx, excluded)
     setInsertTiming(key, kind, id, patch)   // kind: 'birol'|'hook'|'halfer'
     setMusic(key, patch)

   Reuses existing globals: getCompletedSessions, getSkleykaClosed,
   getTimelineData/setTimelineData, getAudioDuration (scen-montage.js /
   scen-timeline.js). Phase 1 resolves the MAIN track only; inserts are added
   in Phase 2.
   ═══════════════════════════════════════════════════════════════════════════ */

(function () {
  const MV2 = {};

  function _parseResolution(s) {
    // Returns {w,h}; default 9:16 portrait (matches the typical UGC output).
    if (typeof s === 'string') {
      const m = s.match(/(\d+)\s*[x×]\s*(\d+)/);
      if (m) return { w: parseInt(m[1], 10), h: parseInt(m[2], 10) };
    }
    return { w: 1080, h: 1920 };
  }

  // Probe a video file's natural duration (seconds), cached. 0 on failure.
  const _vdCache = {};
  MV2.getVideoDuration = function (url) {
    if (!url) return Promise.resolve(0);
    if (_vdCache[url] != null) return Promise.resolve(_vdCache[url]);
    return new Promise(res => {
      const v = document.createElement('video');
      v.preload = 'metadata'; v.muted = true;
      let done = false;
      const fin = (d) => {
        if (done) return; done = true;
        _vdCache[url] = d;
        try { v.removeAttribute('src'); v.load(); } catch {}
        res(d);
      };
      v.addEventListener('loadedmetadata', () => fin(isFinite(v.duration) ? v.duration : 0), { once: true });
      v.addEventListener('error', () => fin(0), { once: true });
      setTimeout(() => fin(0), 6000);
      v.src = url;
    });
  };

  function _label(key, s) {
    if (s && s.title) return s.title;
    const scen = key.split('__').slice(1).join('__').replace(/\.txt$/i, '');
    let dstr = '';
    if (s && s.date) {
      try { dstr = new Date(s.date).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }); } catch {}
    }
    return [dstr, scen, s && s.obrazName].filter(Boolean).join(' — ') || key;
  }

  // Sessions object (bare global from scen-state.js).
  function _sessions() {
    return (typeof editFrozenSessions !== 'undefined') ? editFrozenSessions : (window.editFrozenSessions || {});
  }
  // "complete" = has ≥1 finished video and nothing still rendering.
  function _isComplete(s) {
    if (!s || !Array.isArray(s.cells)) return false;
    const audioCells = s.cells.filter(c => c.audioPath);
    return audioCells.length > 0 && audioCells.some(c => c.videoPath && !c._videoPending && !c.avatarTaskId);
  }

  // ── List completed projects. Open/closed is determined ONLY by skleyka_closed
  //    (not the per-device `starred` flag), so closed projects remain reopenable
  //    here. includeClosed surfaces closed ones (flagged); default hides them.
  // A project appears in the Merge dropdown ONLY if it was explicitly sent there
  // via the ★ button in Edit (sess.inMerge). Once created it stays until removed
  // from inside Merge. (The old _isComplete + skleyka_closed auto-membership is
  // retired — voice-only projects are allowed too.)
  // mode: 'creatives' (default) lists regular Edit projects; 'vsl' lists VSL
  // projects (created right in Merge from an uploaded long video).
  MV2.listSessions = function (mode) {
    const wantVsl = mode === 'vsl';
    const out = [];
    for (const [key, s] of Object.entries(_sessions())) {
      if (!s || s.inMerge !== true) continue;
      if (!!s.isVsl !== wantVsl) continue;
      out.push({ sessionKey: key, label: _label(key, s), closed: false });
    }
    return out;
  };

  // Create a VSL project: one session whose single cell is the whole long video.
  // hiddenFromEdit keeps it out of the Edit tab; the canvas follows the video's
  // native aspect via advSettings.resolution. Returns the new session key.
  MV2.createVslSession = function (video) {
    const sessions = _sessions();
    const ts  = Date.now();
    const key = 'vsl__' + ts;
    const base = String(video.name || 'VSL').replace(/\.[^.]+$/, '');
    let n = 1;
    for (const s of Object.values(sessions)) if (s && s.isVsl && s.vslFile === video.file) n++;
    sessions[key] = {
      isVsl: true, hiddenFromEdit: true, inMerge: true,
      rev: 1,                                   // structural revision — guards against stale-tab flushes
      title: base + (n > 1 ? ' #' + n : ''),
      date: new Date(ts).toISOString(),
      vslFile: video.file,
      vslW: Math.round(video.width) || 0, vslH: Math.round(video.height) || 0,
      cells: [{ line: base, videoPath: video.url, audioPath: null }],
    };
    if (typeof saveEditState === 'function') saveEditState();
    if (video.width > 0 && video.height > 0) {
      const d = getTimelineData();
      if (!d[key]) d[key] = {};
      d[key].advSettings = Object.assign({}, d[key].advSettings, { resolution: Math.round(video.width) + 'x' + Math.round(video.height) });
      setTimelineData(d);
    }
    return key;
  };

  // ── VSL fragments ────────────────────────────────────────────────────────────
  // A fragment is a REGULAR main segment whose source window lives in
  // segmentTrim[idx] = {in, out} (source seconds): one shared file, N cells.
  // Speed / effects / exclude / edge-trim all work unchanged on fragments.

  // Replace the project's cells with one cell per fragment cut at `boundaries`
  // (seconds, ascending, exclusive of 0 and srcDur). Resets per-fragment edits.
  MV2.applyVslFragments = function (sessionKey, boundaries, srcDur) {
    const sessions = _sessions();
    const s = sessions[sessionKey];
    if (!s || !s.isVsl || !Array.isArray(s.cells) || !s.cells.length) return 0;
    const videoPath = s.cells[0].videoPath;
    const pts = [0].concat(
      (boundaries || []).filter(b => b > 0.05 && b < srcDur - 0.05).sort((a, b) => a - b),
      [srcDur]
    );
    const cells = [];
    const trims = {};
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1];
      if (b - a < 0.05) continue;
      const idx = cells.length;
      cells.push({ line: 'Fr.' + (idx + 1), videoPath, audioPath: null });
      const tin = a, tout = Math.max(0, srcDur - b);
      if (tin > 1e-3 || tout > 1e-3) trims[idx] = { in: +tin.toFixed(3), out: +tout.toFixed(3) };
    }
    if (!cells.length) return 0;
    // Fragment windows live ON THE SESSION (vslTrims), not in timeline_data_v2:
    // the session merges by key + rev server-side, while timeline_data_v2 is a
    // last-write-wins blob a stale tab could clobber.
    s.cells = cells;
    s.vslTrims = trims;
    s.rev = (s.rev || 0) + 1;
    if (typeof saveEditState === 'function') saveEditState();
    const d = getTimelineData();
    const sd = d[sessionKey] = d[sessionKey] || {};
    sd.segmentTrim = {};
    sd.segmentSpeed = {}; sd.segmentEffects = {}; sd.segmentReversed = {};
    sd.excludedSegments = [];
    setTimelineData(d);
    return cells.length;
  };

  // Merge a CONSECUTIVE run of fragments (cell indices) into one: the merged
  // window spans from the first fragment's start to the last one's end. The
  // first fragment's speed/effects survive; idx-keyed overrides are remapped.
  MV2.mergeVslFragments = function (sessionKey, idxs) {
    const sessions = _sessions();
    const s = sessions[sessionKey];
    if (!s || !s.isVsl || !Array.isArray(s.cells)) return false;
    const sorted = (idxs || []).slice().sort((a, b) => a - b);
    if (sorted.length < 2) return false;
    for (let i = 1; i < sorted.length; i++) if (sorted[i] !== sorted[i - 1] + 1) return false;  // must be adjacent
    const i0 = sorted[0], i1 = sorted[sorted.length - 1];
    if (i0 < 0 || i1 >= s.cells.length) return false;

    const oldTrim = s.vslTrims || {};
    const mergedTrim = {
      in:  (oldTrim[i0] && +oldTrim[i0].in)  || 0,
      out: (oldTrim[i1] && +oldTrim[i1].out) || 0,
    };

    const videoPath = s.cells[i0].videoPath;
    const removed = i1 - i0;                      // how many indices vanish
    const newCells = s.cells.slice(0, i0)
      .concat([{ line: '', videoPath, audioPath: null }], s.cells.slice(i1 + 1));
    newCells.forEach((c, i) => { c.line = 'Fr.' + (i + 1); });
    s.cells = newCells;

    // Remap idx-keyed override maps: keep < i0 as-is, collapse [i0..i1] into i0
    // (first fragment's values), shift > i1 down by `removed`.
    const remap = (m) => {
      const out = {};
      for (const [k, v] of Object.entries(m || {})) {
        const i = +k;
        if (i < i0) out[i] = v;
        else if (i === i0) out[i0] = v;
        else if (i > i1) out[i - removed] = v;
      }
      return out;
    };
    s.vslTrims = remap(oldTrim);
    if (mergedTrim.in > 1e-3 || mergedTrim.out > 1e-3) s.vslTrims[i0] = mergedTrim;
    else delete s.vslTrims[i0];
    s.rev = (s.rev || 0) + 1;
    if (typeof saveEditState === 'function') saveEditState();

    const d = getTimelineData();
    const sd = d[sessionKey] = d[sessionKey] || {};
    sd.segmentSpeed    = remap(sd.segmentSpeed);
    sd.segmentEffects  = remap(sd.segmentEffects);
    sd.segmentReversed = remap(sd.segmentReversed);
    sd.excludedSegments = (sd.excludedSegments || [])
      .filter(i => i < i0 || i > i1)
      .map(i => (i > i1 ? i - removed : i));
    setTimelineData(d);
    return true;
  };

  // Fully remove a VSL project (unlike creatives, there is no Edit session to
  // keep): drop the session + its timeline data, locally and on the server.
  MV2.deleteVslSession = function (sessionKey) {
    const sessions = _sessions();
    if (sessions[sessionKey]) delete sessions[sessionKey];
    if (typeof saveEditState === 'function') saveEditState();
    const d = getTimelineData();
    if (d[sessionKey]) { delete d[sessionKey]; setTimelineData(d); }
    try { if (window.EditSync && EditSync.deleteSession) EditSync.deleteSession(sessionKey); } catch {}
  };

  // ── Save / Close / Reopen (snapshot + closed set + keep `starred` in sync) ──
  MV2.saveSnapshot = function (sessionKey) {
    const s = _sessions()[sessionKey];
    const title = _label(sessionKey, s || {});
    if (typeof saveProjectSnapshot === 'function') saveProjectSnapshot(sessionKey, title);
  };
  function _setStarred(sessionKey, val) {
    const s = _sessions()[sessionKey];
    if (s) { s.starred = val; if (typeof saveEditState === 'function') saveEditState(); }
  }
  MV2.closeProject = function (sessionKey) {
    MV2.saveSnapshot(sessionKey); // auto-snapshot so nothing is lost
    const s = _sessions()[sessionKey];
    if (s) { s.inMerge = false; delete s.mergeSyncSig; }   // ★ membership removed; Edit ★ can re-create
    if (typeof getSkleykaClosed === 'function') { const c = getSkleykaClosed(); c.add(sessionKey); saveSkleykaClosed(c); }
    _setStarred(sessionKey, false);   // persists via saveEditState
  };
  MV2.reopenProject = function (sessionKey) {
    if (typeof getSkleykaClosed === 'function') { const c = getSkleykaClosed(); c.delete(sessionKey); saveSkleykaClosed(c); }
    _setStarred(sessionKey, true);
  };

  // ── SFX library (track-level sound effects) ─────────────────────────────────
  MV2.getSfxList = function () {
    const lib = (typeof getAudioLib === 'function') ? getAudioLib() : [];
    return lib.filter(x => x.type === 'sfx').map(x => ({ url: x.webPath, name: x.name || x.webPath }));
  };

  // ── Copy insert layout from another project ─────────────────────────────────
  MV2.listCopySources = function (currentKey) {
    const d = getTimelineData();
    const fr = (typeof editFrozenSessions !== 'undefined') ? editFrozenSessions : (window.editFrozenSessions || {});
    return Object.entries(d).filter(([key, val]) => {
      if (key === currentKey) return false;
      const hasB  = Array.isArray(val.activated) && val.activated.length;
      const hasH  = val.hooks   && Array.isArray(val.hooks.activated)   && val.hooks.activated.length;
      const hasHa = val.halfers && Array.isArray(val.halfers.activated) && val.halfers.activated.length;
      return hasB || hasH || hasHa;
    }).map(([key, val]) => ({
      sessionKey: key, label: _label(key, fr[key] || {}),
      b: (val.activated || []).length, h: (val.hooks?.activated || []).length, ha: (val.halfers?.activated || []).length,
    }));
  };
  MV2.copyLayoutFrom = function (currentKey, srcKey) {
    const d = getTimelineData();
    const src = d[srcKey] || {};
    if (!d[currentKey]) d[currentKey] = {};
    const clone = (x) => JSON.parse(JSON.stringify(x));
    if (src.activated !== undefined) d[currentKey].activated = clone(src.activated || []);
    if (src.timings   !== undefined) d[currentKey].timings   = clone(src.timings   || {});
    if (src.hooks)                   d[currentKey].hooks     = clone(src.hooks);
    if (src.halfers)                 d[currentKey].halfers   = clone(src.halfers);
    setTimelineData(d);
  };

  // ── Resolve a renderable model for one session (MAIN track only in Phase 1) ──
  MV2.buildModel = async function (sessionKey) {
    // Look up the session directly (works for closed projects too, regardless of `starred`).
    const session = _sessions()[sessionKey];
    if (!session || !Array.isArray(session.cells)) return null;
    const cells   = session.cells;

    // Probe audio durations (same as scen-timeline.js ~640-642). VSL cells have
    // no audio at all — their length comes from the video file itself.
    const isVsl = !!session.isVsl;
    const durations = await Promise.all(
      cells.map(c => c.audioPath ? getAudioDuration(c.audioPath)
        : (isVsl && c.videoPath) ? MV2.getVideoDuration(c.videoPath)
        : Promise.resolve(0))
    );

    const tlData      = getTimelineData();
    const sd          = tlData[sessionKey] || {};
    const excludedSet = new Set(sd.excludedSegments || []);

    // All segments with original timing, then active (non-excluded) recompacted.
    // VSL fragment windows live on the session (rev-guarded) — see applyVslFragments.
    const segSpeed = sd.segmentSpeed || {};
    const segTrim  = isVsl ? (session.vslTrims || {}) : (sd.segmentTrim || {});  // per-fragment edge trim {in,out} in SOURCE seconds
    let allCursor = 0;
    const allSegments = cells.map((cell, i) => {
      const sp = parseFloat(segSpeed[i]) || 1;                 // talking-head per-fragment speed
      const srcLen = durations[i] || 0;                        // full source (audio) length
      const tr = segTrim[i] || {};
      const tin  = Math.max(0, parseFloat(tr.in)  || 0);
      const tout = Math.max(0, parseFloat(tr.out) || 0);
      const effLen = Math.max(0, srcLen - tin - tout);         // shown source length after trim
      const dur = effLen / (sp > 0 ? sp : 1);                  // faster = shorter on the timeline
      const start = allCursor; allCursor += dur;
      return { cell, idx: i, start, end: allCursor, dur, speed: sp, trimIn: tin, srcDur: srcLen };
    }).filter(s => s.dur > 0);

    let activeCursor = 0;
    const activeSegments = allSegments
      .filter(s => !excludedSet.has(s.idx))
      .map(s => { const st = activeCursor; activeCursor += s.dur; return Object.assign({}, s, { activeStart: st, activeEnd: activeCursor }); });
    const totalDur = activeCursor;

    // Effective effect = per-clip override ?? track default.
    const segFx = sd.segmentEffects || {};
    const segT = sd.segTransition || 'none', segA = sd.segAnimation || 'none', segFi = sd.segFilter || 'none';
    const biroT = sd.biroTransition || 'none', biroA = sd.biroAnimation || 'none', biroFi = sd.biroFilter || 'none';
    const _eff = (ov, tr, an, fi) => ({
      transition: (ov && ov.transition != null) ? ov.transition : tr,
      animation:  (ov && ov.animation  != null) ? ov.animation  : an,
      filter:     (ov && ov.filter     != null) ? ov.filter     : fi,
    });

    // Include voice-only fragments (audio but no video yet): they render as a
    // light-blue clip / black-screen-with-audio in preview. Durations are
    // audio-driven, so later upgrading a fragment voice→video keeps the layout.
    const main = activeSegments
      .filter(s => s.cell.videoPath || s.cell.audioPath)
      .map(s => Object.assign({
        kind:      'main',
        idx:       s.idx,
        name:      s.cell.line || ('Fr.' + (s.idx + 1)),
        videoPath: s.cell.videoPath || null,
        voiceOnly: !s.cell.videoPath,
        audioPath: s.cell.audioPath || null,
        start:     s.activeStart,
        end:       s.activeEnd,
        dur:       s.dur,
        speed:     s.speed || 1,
        trimIn:    s.trimIn || 0,
        srcDur:    s.srcDur || 0,
        crop:      0,
        cropAlign: 'center',
        reversed:  !!((sd.segmentReversed || {})[s.idx]),
      }, _eff(segFx[s.idx], segT, segA, segFi)));

    // ── Inserts (mirror buildRenderPayload so preview matches the render) ──────
    const archive   = (typeof getBirolyArchive === 'function') ? getBirolyArchive() : [];
    const hooksList  = (typeof getHooksArchive === 'function') ? getHooksArchive() : [];

    // Resolve a birol/halfer source from an insert key, tolerating multi-instance
    // suffixes (srcKey#N) and legacy bare keys.
    const _byKey = (key) => {
      const base = String(key).split('#')[0];
      return /^\d+$/.test(base) ? archive[parseInt(base, 10)] : archive.find(e => e.id === base);
    };

    const birols = (sd.activated || []).map(key => {
      const b = _byKey(key);
      const t = (sd.timings || {})[key];
      if (!b || !b.videoPath || !t || t.start === undefined) return null;
      return Object.assign({
        kind: 'birol', key, name: b.name || 'Birol', videoPath: b.videoPath,
        start: parseFloat(t.start) || 0, end: parseFloat(t.end) || 6,
        trimIn: parseFloat(t.trimIn) || 0,
        crop: parseFloat(t.crop) || 0, speed: parseFloat(t.speed) || 1,
        cropAlign: t.cropAlign || 'center', reversed: !!t.reversed,
        audioOn: (t.audio != null) ? !!t.audio : !!sd.biroAudio,
        volume: (t.volume != null) ? +t.volume : (sd.biroVolume != null ? +sd.biroVolume : 1),
      }, _eff(t, biroT, biroA, biroFi));
    }).filter(Boolean);

    const hooksData = sd.hooks || {};
    const hooks = (hooksData.activated || []).map(idx => {
      const h = hooksList[parseInt(String(idx).split('#')[0], 10)]; const t = (hooksData.timings || {})[idx];
      if (!h || !h.videoPath || !t || t.start === undefined) return null;
      return Object.assign({
        kind: 'hook', key: idx, name: h.name || 'Hook', videoPath: h.videoPath,
        start: parseFloat(t.start) || 0, end: parseFloat(t.end) || 6,
        trimIn: parseFloat(t.trimIn) || 0,
        crop: parseFloat(t.crop) || 0, speed: parseFloat(t.speed) || 1,
        cropAlign: t.cropAlign || 'center', reversed: !!t.reversed,
        audioOn: (t.audio != null) ? !!t.audio : (sd.hookAudio != null ? !!sd.hookAudio : !!sd.biroAudio),
        volume: (t.volume != null) ? +t.volume : (sd.hookVolume != null ? +sd.hookVolume : 1),
      }, _eff(t, biroT, biroA, biroFi));
    }).filter(Boolean);

    const halfersData = sd.halfers || {};
    const halfers = (halfersData.activated || []).map(key => {
      const item = _byKey(key);
      const t = (halfersData.timings || {})[key];
      if (!item || !item.videoPath || !t || t.start === undefined) return null;
      return {
        kind: 'halfer', key, name: item.name || 'Halfer', videoPath: item.videoPath,
        start: parseFloat(t.start) || 0, end: parseFloat(t.end) || 5,
        trimIn: parseFloat(t.trimIn) || 0,
        crop: parseFloat(t.crop) || 0, speed: parseFloat(t.speed) || 1,
        cropAlign: t.cropAlign || 'center',
        halferAlign: t.halferAlign || 'top', reversed: !!t.reversed,
        rotation: (t.rotation != null) ? (parseInt(t.rotation, 10) || 0) : 90,   // band content rotation; default 90 (legacy)
        valign: t.valign || 'top',                                               // 0/180: which vertical part covers the band
        audioOn: (t.audio != null) ? !!t.audio : (sd.halferAudio != null ? !!sd.halferAudio : !!sd.biroAudio),
        volume: (t.volume != null) ? +t.volume : (sd.halferVolume != null ? +sd.halferVolume : 1),
      };
    }).filter(Boolean);

    // Probe insert source durations → max timeline length = srcDur / speed.
    const allInserts = birols.concat(hooks, halfers);
    await Promise.all(allInserts.map(async c => { c.srcDur = await MV2.getVideoDuration(c.videoPath) || 0; }));

    // Music track (multi-instance: each clip = own placement / trim / speed / volume)
    let _musicRaw = Array.isArray(sd.musicClips) ? sd.musicClips.slice() : [];
    if (!_musicRaw.length && sd.music && sd.music !== 'Нет') {
      // Legacy single-music migration → one clip starting at its old offset.
      _musicRaw = [{ id: 'm1', url: sd.music, start: sd.musicOffset || 0, end: null,
                     speed: sd.musicSpeed != null ? sd.musicSpeed : 1,
                     volume: sd.musicVolume != null ? sd.musicVolume : 0.5 }];
    }
    const musicClips = [];
    for (const mc of _musicRaw) {
      if (!mc || !mc.url || mc.url === 'Нет') continue;
      const srcDur = await MV2.getVideoDuration(mc.url) || 0;
      const speed  = (mc.speed != null && mc.speed > 0) ? +mc.speed : 1;
      const start  = parseFloat(mc.start) || 0;
      const fullLen = srcDur > 0 ? srcDur / speed : Math.max(1, totalDur - start);
      let end = (mc.end != null) ? parseFloat(mc.end) : start + fullLen;
      if (!(end > start)) end = start + Math.max(0.2, fullLen);
      if (srcDur > 0) end = Math.min(end, start + srcDur / speed);   // can't exceed source
      musicClips.push({
        kind: 'music', key: String(mc.id), name: (mc.url.split('/').pop() || 'music'),
        url: mc.url, start, end, speed, volume: mc.volume != null ? +mc.volume : 0.5, srcDur,
      });
    }

    return {
      sessionKey,
      title:      _label(sessionKey, session),
      scenFile:   session.scenFile || sessionKey.split('__').slice(1, -1).join('__'),
      isVsl:      !!session.isVsl,
      totalDur,
      // VSL projects fall back to the video's native dimensions (stored on the
      // session, which merges by key server-side) when no explicit resolution is
      // set — timeline_data_v2 is last-write-wins across tabs and can be clobbered.
      resolution: (sd.advSettings && sd.advSettings.resolution) ? _parseResolution(sd.advSettings.resolution)
        : (session.isVsl && session.vslW > 0 && session.vslH > 0) ? { w: session.vslW, h: session.vslH }
        : _parseResolution(null),
      segVolume:  sd.segVolume != null ? sd.segVolume : 1.0,
      musicClips,
      subtitles: (sd.srtSubtitles || []).map(s => ({
        text: s.text || '', start: parseFloat(s.start) || 0, end: parseFloat(s.end) || 0,
      })),
      // Word-level timings (from STT) so the preview can mirror the final render's
      // wordsPerLine grouping + karaoke sweep instead of showing whole SRT blocks.
      srtWords: (sd.srtWords || []).map(w => ({
        text: w.text || '', start: parseFloat(w.start) || 0, end: parseFloat(w.end) || 0,
      })),
      subsEnabled: !(sd.advSettings && sd.advSettings.subsEnabled === false),
      srtRawText: sd.srtRawText || '',
      sttAutoDone: !!sd.sttAutoDone,   // auto-subtitle pass already attempted for this project
      assSettings: Object.assign({}, (typeof ASS_DEFAULTS !== 'undefined' ? ASS_DEFAULTS : {}), sd.assSettings || {}),
      main, birols, hooks, halfers,
    };
  };

  // ── Write helpers (single source of truth = timeline_data_v2) ───────────────
  function _ensure(d, key) {
    if (!d[key]) d[key] = {};
    return d[key];
  }

  MV2.setSegmentReversed = function (sessionKey, idx, val) {
    const d = getTimelineData();
    const s = _ensure(d, sessionKey);
    if (!s.segmentReversed) s.segmentReversed = {};
    s.segmentReversed[idx] = !!val;
    setTimelineData(d);
  };

  MV2.setExcluded = function (sessionKey, idx, excluded) {
    const d = getTimelineData();
    const s = _ensure(d, sessionKey);
    const set = new Set(s.excludedSegments || []);
    if (excluded) set.add(idx); else set.delete(idx);
    s.excludedSegments = [...set];
    setTimelineData(d);
  };

  MV2.setInsertTiming = function (sessionKey, kind, id, patch) {
    const d = getTimelineData();
    const s = _ensure(d, sessionKey);
    const bucket = kind === 'hook' ? 'hooks' : kind === 'halfer' ? 'halfers' : null;
    let timings;
    if (bucket) {
      if (!s[bucket]) s[bucket] = {};
      if (!s[bucket].timings) s[bucket].timings = {};
      timings = s[bucket].timings;
    } else {
      if (!s.timings) s.timings = {};
      timings = s.timings;
    }
    if (!timings[id]) timings[id] = {};
    // null / '' removes a key (used by effect "inherit"); other values set it.
    Object.keys(patch).forEach(k => {
      if (patch[k] == null || patch[k] === '') delete timings[id][k];
      else timings[id][k] = patch[k];
    });
    setTimelineData(d);
  };

  // ── Insert add / remove / query (birols use archive id, hooks use index) ────
  // True if ANY instance of a source key is on the timeline (suffix-tolerant).
  MV2.isInsertActive = function (sessionKey, kind, key) {
    const d = getTimelineData(); const s = d[sessionKey]; if (!s) return false;
    const base = String(key).split('#')[0];
    const arr = kind === 'hook' ? (s.hooks && s.hooks.activated)
              : kind === 'halfer' ? (s.halfers && s.halfers.activated)
              : s.activated;
    return Array.isArray(arr) && arr.some(k => String(k).split('#')[0] === base);
  };

  // Fresh instance id for a source key (srcKey#N) so the same birol/hook can be
  // placed many times, each with its own timing. Tolerates legacy bare keys.
  function _newInstId(arr, srcKey) {
    let max = 0;
    (arr || []).forEach(k => { const m = String(k).match(/^(.*)#(\d+)$/); if (m && m[1] === srcKey) max = Math.max(max, parseInt(m[2], 10)); });
    return srcKey + '#' + (max + 1);
  }

  // Add a NEW instance of an insert. `key` is the SOURCE key (birol id / hook idx).
  // Returns the new instance id (srcKey#N).
  MV2.addInsert = function (sessionKey, kind, key, startSec, dur) {
    const d = getTimelineData();
    const s = _ensure(d, sessionKey);
    const st = Math.max(0, startSec || 0);
    const timing = {
      start: st.toFixed(2), end: (st + (dur || 6)).toFixed(2),
      crop: '0', cropEnd: '0', speed: '1', cropAlign: 'center', reversed: false,
    };
    const bucket = kind === 'hook' ? 'hooks' : kind === 'halfer' ? 'halfers' : null;
    let arr, tim;
    if (bucket) {
      if (!s[bucket]) s[bucket] = {};
      if (!Array.isArray(s[bucket].activated)) s[bucket].activated = [];
      if (!s[bucket].timings) s[bucket].timings = {};
      arr = s[bucket].activated; tim = s[bucket].timings;
    } else {
      if (!Array.isArray(s.activated)) s.activated = [];
      if (!s.timings) s.timings = {};
      arr = s.activated; tim = s.timings;
    }
    const instId = _newInstId(arr, String(key));
    arr.push(instId); tim[instId] = timing;
    setTimelineData(d);
    return instId;
  };

  MV2.removeInsert = function (sessionKey, kind, key) {
    const d = getTimelineData(); const s = d[sessionKey]; if (!s) return;
    if (kind === 'hook') {
      if (s.hooks && Array.isArray(s.hooks.activated)) s.hooks.activated = s.hooks.activated.filter(k => k !== key);
      if (s.hooks && s.hooks.timings) delete s.hooks.timings[key];
    } else if (kind === 'halfer') {
      // Halfers live in their OWN bucket (s.halfers.activated), not the birol bucket
      // (s.activated) -- removing them here is what was missing, so Delete on a
      // halfer silently did nothing until it was first converted to a birol.
      if (s.halfers && Array.isArray(s.halfers.activated)) s.halfers.activated = s.halfers.activated.filter(k => k !== key);
      if (s.halfers && s.halfers.timings) delete s.halfers.timings[key];
    } else {
      if (Array.isArray(s.activated)) s.activated = s.activated.filter(k => k !== key);
      if (s.timings) delete s.timings[key];
    }
    setTimelineData(d);
  };

  // Convert an insert between 'birol' (full-frame) and 'halfer' (band), preserving
  // timing. Both come from the biroly archive so the key (archive id) is unchanged.
  MV2.convertInsert = function (sessionKey, fromKind, toKind, key) {
    if (fromKind === toKind) return;
    const d = getTimelineData(); const s = d[sessionKey]; if (!s) return;
    const bucket = (k) => k === 'halfer' ? 'halfers' : k === 'hook' ? 'hooks' : null;
    const fb = bucket(fromKind), tb = bucket(toKind);
    const srcTim = fb ? (s[fb] && s[fb].timings) : s.timings;
    const t = (srcTim && srcTim[key]) ? Object.assign({}, srcTim[key]) : {};

    // Remove from source bucket
    if (fb) {
      if (s[fb]) {
        s[fb].activated = (s[fb].activated || []).filter(k => k !== key);
        if (s[fb].timings) delete s[fb].timings[key];
      }
    } else {
      s.activated = (s.activated || []).filter(k => k !== key);
      if (s.timings) delete s.timings[key];
    }

    // Adjust halfer-specific field
    if (toKind === 'halfer') { if (!t.halferAlign) t.halferAlign = 'top'; }
    else { delete t.halferAlign; }

    // Add to destination bucket
    if (tb) {
      if (!s[tb]) s[tb] = {};
      if (!Array.isArray(s[tb].activated)) s[tb].activated = [];
      if (!s[tb].activated.includes(key)) s[tb].activated.push(key);
      if (!s[tb].timings) s[tb].timings = {};
      s[tb].timings[key] = t;
    } else {
      if (!Array.isArray(s.activated)) s.activated = [];
      if (!s.activated.includes(key)) s.activated.push(key);
      if (!s.timings) s.timings = {};
      s.timings[key] = t;
    }
    setTimelineData(d);
  };

  // Archive listings for the media browser (birols + hooks share the biroly archive shape)
  // Uploads (user's own videos) are stored as biroly-archive entries tagged with
  // categoryId '__uploads__' so they render on the Birols track, but are listed
  // under the Uploads tab and excluded from the Birols gallery.
  MV2.UPLOADS_CAT = '__uploads__';
  MV2.listMedia = function (kind) {
    if (kind === 'hook') return (typeof getHooksArchive === 'function') ? getHooksArchive() : [];
    const arch = (typeof getBirolyArchive === 'function') ? getBirolyArchive() : [];
    if (kind === 'upload') return arch.filter(it => it.categoryId === MV2.UPLOADS_CAT);
    return arch.filter(it => it.categoryId !== MV2.UPLOADS_CAT);   // 'birol' excludes uploads
  };

  MV2.setMusic = function (sessionKey, patch) {
    const d = getTimelineData();
    const s = _ensure(d, sessionKey);
    Object.assign(s, patch); // { music, musicOffset, musicVolume }
    setTimelineData(d);
  };

  // ── Multi-instance music (same shape as inserts: place many, move, trim, speed) ──
  function _newMusicId(arr) {
    let max = 0;
    (arr || []).forEach(c => { const m = String(c.id || '').match(/^m(\d+)$/); if (m) max = Math.max(max, parseInt(m[1], 10)); });
    return 'm' + (max + 1);
  }
  // Convert a legacy single-music project (sd.music + sd.musicOffset/Volume/Speed)
  // into one REAL musicClips entry. buildModel only shows that legacy track as a
  // VIRTUAL clip with key 'm1' — it is never in sd.musicClips, so move/trim/speed/
  // delete were silent no-ops on it. We materialize on the first mutation using the
  // SAME id ('m1') the virtual clip carries, then DELETE the legacy fields so
  // buildModel cannot resurrect the virtual clip. Idempotent + defensive.
  function _materializeLegacyMusic(s) {
    if (!s) return;
    if (Array.isArray(s.musicClips) && s.musicClips.length) {
      // A real clip already exists — drop any stale legacy field to avoid a ghost.
      if (s.music != null) { delete s.music; delete s.musicOffset; delete s.musicSpeed; delete s.musicVolume; }
      return;
    }
    if (!s.music || s.music === 'Нет') return;
    s.musicClips = [{
      id: 'm1', url: s.music,
      start: +(s.musicOffset || 0), end: null,   // end resolved on read (buildModel / addMusic probe)
      speed: (s.musicSpeed != null && s.musicSpeed > 0) ? +s.musicSpeed : 1,
      volume: s.musicVolume != null ? +s.musicVolume : 0.5,
    }];
    delete s.music; delete s.musicOffset; delete s.musicSpeed; delete s.musicVolume;
  }
  // Add a music instance. `atSec` null → butt right after the last music clip.
  // Returns the new clip id. srcDur (if known) sets the default full length.
  // Async: a legacy clip materialized with unknown end is probed so the butt
  // position lands after it instead of overlapping at 0.
  MV2.addMusic = async function (sessionKey, url, atSec, srcDur, speed, volume) {
    const d = getTimelineData();
    const s = _ensure(d, sessionKey);
    _materializeLegacyMusic(s);
    if (!Array.isArray(s.musicClips)) s.musicClips = [];
    const sp = (speed != null && speed > 0) ? +speed : 1;
    let at = atSec;
    if (at == null) {
      at = 0;
      for (const c of s.musicClips) {
        let e = parseFloat(c.end);
        if (!isFinite(e)) {
          const csd = await MV2.getVideoDuration(c.url) || 0;
          const csp = (c.speed > 0 ? +c.speed : 1);
          e = (parseFloat(c.start) || 0) + (csd > 0 ? csd / csp : 6);
          c.end = +e.toFixed(2);   // resolve the stored null end so it persists numeric
        }
        if (e > at) at = e;
      }
    }
    at = Math.max(0, +at || 0);
    const dur = (srcDur && srcDur > 0) ? srcDur / sp : 6;
    const clip = { id: _newMusicId(s.musicClips), url, start: +at.toFixed(2), end: +(at + dur).toFixed(2), speed: sp, volume: volume != null ? +volume : 0.5 };
    s.musicClips.push(clip);
    setTimelineData(d);
    return clip.id;
  };
  MV2.setMusicTiming = function (sessionKey, id, patch) {
    const d = getTimelineData(); const s = d[sessionKey]; if (!s) return;
    _materializeLegacyMusic(s);
    if (!Array.isArray(s.musicClips)) return;
    const c = s.musicClips.find(x => String(x.id) === String(id)); if (!c) return;
    if (patch.start  != null) c.start  = parseFloat(patch.start);
    if (patch.end    != null) c.end    = parseFloat(patch.end);
    if (patch.speed  != null) c.speed  = parseFloat(patch.speed) || 1;
    if (patch.volume != null) c.volume = parseFloat(patch.volume);
    if (patch.url    != null) c.url    = patch.url;
    setTimelineData(d);
  };
  MV2.removeMusic = function (sessionKey, id) {
    const d = getTimelineData(); const s = d[sessionKey]; if (!s) return;
    _materializeLegacyMusic(s);
    if (!Array.isArray(s.musicClips)) return;
    s.musicClips = s.musicClips.filter(x => String(x.id) !== String(id));
    setTimelineData(d);
  };

  // Merge arbitrary top-level keys into the session (e.g. seg/biro effect fields).
  MV2.setFields = function (sessionKey, patch) {
    const d = getTimelineData();
    const s = _ensure(d, sessionKey);
    Object.assign(s, patch);
    setTimelineData(d);
  };

  // Per-main-segment (talking-head) playback speed. dur becomes audioDur/speed,
  // so the fragment shrinks/grows on the timeline and the spine recompacts.
  MV2.setSegmentSpeed = function (sessionKey, idx, speed) {
    const d = getTimelineData();
    const s = _ensure(d, sessionKey);
    if (!s.segmentSpeed) s.segmentSpeed = {};
    const sp = parseFloat(speed) || 1;
    if (Math.abs(sp - 1) < 1e-6) delete s.segmentSpeed[idx];   // default → drop the key
    else s.segmentSpeed[idx] = sp;
    setTimelineData(d);
  };

  // Per-main-segment edge trim. {in,out} in SOURCE seconds cut from the start/end of
  // the fragment's audio/video. Length on the timeline becomes (src - in - out)/speed.
  // VSL projects store trims on the session itself (vslTrims, rev-guarded) — the
  // trims ARE the fragment structure there and must survive stale-tab flushes.
  MV2.setSegmentTrim = function (sessionKey, idx, patch) {
    const sess = _sessions()[sessionKey];
    if (sess && sess.isVsl) {
      const trims = sess.vslTrims = sess.vslTrims || {};
      const cur = trims[idx] || {};
      const tin  = (patch.in  != null) ? Math.max(0, parseFloat(patch.in)  || 0) : (cur.in  || 0);
      const tout = (patch.out != null) ? Math.max(0, parseFloat(patch.out) || 0) : (cur.out || 0);
      if (tin < 1e-3 && tout < 1e-3) delete trims[idx];
      else trims[idx] = { in: +tin.toFixed(3), out: +tout.toFixed(3) };
      sess.rev = (sess.rev || 0) + 1;
      if (typeof saveEditState === 'function') saveEditState();
      return;
    }
    const d = getTimelineData();
    const s = _ensure(d, sessionKey);
    if (!s.segmentTrim) s.segmentTrim = {};
    const cur = s.segmentTrim[idx] || {};
    const tin  = (patch.in  != null) ? Math.max(0, parseFloat(patch.in)  || 0) : (cur.in  || 0);
    const tout = (patch.out != null) ? Math.max(0, parseFloat(patch.out) || 0) : (cur.out || 0);
    if (tin < 1e-3 && tout < 1e-3) delete s.segmentTrim[idx];   // back to full clip → drop the key
    else s.segmentTrim[idx] = { in: +tin.toFixed(3), out: +tout.toFixed(3) };
    setTimelineData(d);
  };

  // Proportionally reposition every insert (birol/hook/halfer) by scaling each
  // insert's START by `ratio`, preserving its own duration. CURRENTLY UNUSED: by
  // design, main-track speed/trim changes leave inserts at their absolute position
  // (per user request), so nothing calls this anymore. Kept as a utility in case a
  // future "reposition inserts with the spine" toggle is wanted.
  MV2.rescaleInserts = function (sessionKey, ratio) {
    if (!isFinite(ratio) || ratio <= 0 || Math.abs(ratio - 1) < 1e-6) return;
    const d = getTimelineData();
    const s = d[sessionKey];
    if (!s) return;
    const scale = (tim) => {
      if (!tim) return;
      Object.keys(tim).forEach(k => {
        const t = tim[k];
        const st = parseFloat(t.start) || 0;
        const en = parseFloat(t.end) || 0;
        const ns = st * ratio;
        t.start = ns.toFixed(2);
        t.end   = (ns + Math.max(0, en - st)).toFixed(2);   // keep the clip's own length
      });
    };
    scale(s.timings);                          // birols
    if (s.hooks)   scale(s.hooks.timings);
    if (s.halfers) scale(s.halfers.timings);
    setTimelineData(d);
  };

  // Per-main-segment effect override (sd.segmentEffects[idx]). Keys set to
  // undefined are removed (→ inherit the track-level seg* value).
  MV2.setSegmentEffect = function (sessionKey, idx, patch) {
    const d = getTimelineData();
    const s = _ensure(d, sessionKey);
    if (!s.segmentEffects) s.segmentEffects = {};
    if (!s.segmentEffects[idx]) s.segmentEffects[idx] = {};
    Object.keys(patch).forEach(k => {
      if (patch[k] == null || patch[k] === '') delete s.segmentEffects[idx][k];
      else s.segmentEffects[idx][k] = patch[k];
    });
    setTimelineData(d);
  };

  // Merge keys into advSettings (e.g. { subsEnabled: true }).
  MV2.setAdv = function (sessionKey, patch) {
    const d = getTimelineData();
    const s = _ensure(d, sessionKey);
    s.advSettings = Object.assign({}, s.advSettings || {}, patch);
    setTimelineData(d);
  };

  // Merge keys into assSettings (libass style) and drop any prebuilt ASS so the
  // next render rebuilds it with the new style.
  MV2.setAss = function (sessionKey, patch) {
    const d = getTimelineData();
    const s = _ensure(d, sessionKey);
    s.assSettings = Object.assign({}, s.assSettings || {}, patch);
    delete s.prebuiltAssPath;
    setTimelineData(d);
  };

  // Store subtitles from raw SRT text: parse → srtSubtitles + words + raw text,
  // and drop any prebuilt ASS so the next render rebuilds it with current styles.
  MV2.setSubtitlesFromSrt = function (sessionKey, srtText) {
    const d = getTimelineData();
    const s = _ensure(d, sessionKey);
    const subs = (typeof _parseSrt === 'function') ? _parseSrt(srtText || '') : [];
    s.srtSubtitles = subs;
    s.srtRawText   = srtText || '';
    s.srtWords     = (typeof _rebuildWordsFromSubs === 'function') ? _rebuildWordsFromSubs(subs) : [];
    delete s.srtSegments;   // manual edit takes over — stop auto-recomputing from STT words
    delete s._srtWordsSig;
    delete s.prebuiltAssPath;
    setTimelineData(d);
  };

  // Store an STT result (raw SRT + word timings from the provider). Flat-words
  // path (no per-fragment recompute) — used as a fallback when the provider
  // didn't return segWords.
  MV2.storeSttResult = function (sessionKey, srtText, words) {
    const d = getTimelineData();
    const s = _ensure(d, sessionKey);
    s.srtSubtitles = (typeof _parseSrt === 'function') ? _parseSrt(srtText || '') : [];
    s.srtRawText   = srtText || '';
    s.srtWords     = words || [];
    delete s.srtSegments;
    delete s._srtWordsSig;
    delete s.prebuiltAssPath;
    setTimelineData(d);
  };

  // ── Per-fragment subtitle recompute (proper timing on speed/trim change) ─────
  // Group flat (absolute-timed) words into SRT blocks. Mirrors the server's
  // _wordsToSrt grouping so the preview / SRT text match the libass export.
  function _groupWordsToSubs(words) {
    const MAX_WORDS = 7, MAX_DUR = 4.0, GAP_BREAK = 1.0;
    const subs = []; let cur = [], curStart = null, prevEnd = null;
    for (const w of words) {
      const gap = prevEnd !== null ? w.start - prevEnd : 0;
      if (cur.length && (cur.length >= MAX_WORDS || (w.end - curStart) > MAX_DUR || gap > GAP_BREAK)) {
        subs.push({ start: curStart, end: prevEnd, text: cur.join(' ') });
        cur = []; curStart = null;
      }
      if (curStart === null) curStart = w.start;
      cur.push(w.text); prevEnd = w.end;
    }
    if (cur.length) subs.push({ start: curStart, end: prevEnd, text: cur.join(' ') });
    return subs;
  }

  // Store raw per-fragment STT words (un-offset, keyed by main-clip idx). This is
  // the durable source of truth; srtWords/srtSubtitles are derived from it by
  // recomputeIntoModel using the CURRENT per-fragment start/speed/trim.
  MV2.storeSttSegments = function (sessionKey, srtSegments) {
    const d = getTimelineData();
    const s = _ensure(d, sessionKey);
    s.srtSegments = (srtSegments || [])
      .filter(seg => seg && seg.idx != null)
      .map(seg => ({
        idx: seg.idx,
        words: (seg.words || []).map(w => ({ text: w.text || '', start: parseFloat(w.start) || 0, end: parseFloat(w.end) || 0 })),
      }));
    delete s._srtWordsSig;     // force the next recomputeIntoModel to rebuild
    delete s.prebuiltAssPath;
    setTimelineData(d);
  };

  // Derive absolute-timed srtWords + srtSubtitles + srtRawText from srtSegments
  // and the freshly-built model's per-fragment timing, write them back to the
  // timeline data, and patch them onto `model` so the caller renders the current
  // result without a second build. No-op when there are no raw segments (e.g.
  // manually pasted subtitles, which the user owns) or when nothing changed.
  MV2.recomputeIntoModel = function (model) {
    if (!model || !model.sessionKey) return false;
    const d = getTimelineData();
    const s = d[model.sessionKey];
    if (!s || !Array.isArray(s.srtSegments) || !s.srtSegments.length) return false;

    const byIdx = {};
    (model.main || []).forEach(c => { byIdx[c.idx] = c; });

    const words = [];
    for (const seg of s.srtSegments) {
      const c = byIdx[seg.idx];
      if (!c) continue; // fragment excluded / removed → its words drop out
      const trimIn = c.trimIn || 0;
      const speed  = (c.speed && c.speed > 0) ? c.speed : 1;
      const start  = c.start || 0, end = c.end || 0;
      // visible source window = [trimIn, srcDur - trimOut] = [trimIn, trimIn + dur*speed]
      const winEnd = (c.srcDur && c.srcDur > 0) ? (trimIn + (c.dur || 0) * speed) : Infinity;
      for (const w of (seg.words || [])) {
        const ws = w.start, we = Math.max(w.end, w.start);
        if (ws < trimIn - 0.05) continue;  // before the in-point — trimmed away
        if (ws > winEnd + 0.05) continue;   // after the out-point — trimmed away
        let a = start + (ws - trimIn) / speed;
        let b = start + (we - trimIn) / speed;
        a = Math.max(start, Math.min(a, end));
        b = Math.max(a + 0.04, Math.min(b, end));
        words.push({ text: w.text, start: a, end: b });
      }
    }
    words.sort((x, y) => x.start - y.start);

    // Skip the write when nothing changed (cheap signature) so we don't thrash
    // localStorage or needlessly invalidate the prebuilt ASS every reload.
    const sig = words.length + ':' +
      (words.length ? words[0].start.toFixed(3) + ':' + words[words.length - 1].end.toFixed(3) : '0');
    const subs = _groupWordsToSubs(words);
    if (s._srtWordsSig !== sig) {
      const dd = getTimelineData();
      const ss = _ensure(dd, model.sessionKey);
      ss.srtWords     = words;
      ss.srtSubtitles = subs;
      ss.srtRawText   = (typeof _rebuildSrt === 'function') ? _rebuildSrt(subs) : (ss.srtRawText || '');
      ss._srtWordsSig = sig;
      delete ss.prebuiltAssPath;
      setTimelineData(dd);
    }

    // Patch the model so the current render/preview reflects the new timing.
    model.srtWords  = words.map(w => ({ text: w.text, start: w.start, end: w.end }));
    model.subtitles = subs.map(x => ({ text: x.text, start: x.start, end: x.end }));
    return true;
  };

  window.MV2 = MV2;
})();
