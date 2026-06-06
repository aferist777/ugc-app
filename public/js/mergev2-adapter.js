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
  MV2.listSessions = function () {
    const out = [];
    for (const [key, s] of Object.entries(_sessions())) {
      if (!s || s.inMerge !== true) continue;
      out.push({ sessionKey: key, label: _label(key, s), closed: false });
    }
    return out;
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

    // Probe audio durations (same as scen-timeline.js ~640-642)
    const durations = await Promise.all(
      cells.map(c => c.audioPath ? getAudioDuration(c.audioPath) : Promise.resolve(0))
    );

    const tlData      = getTimelineData();
    const sd          = tlData[sessionKey] || {};
    const excludedSet = new Set(sd.excludedSegments || []);

    // All segments with original timing, then active (non-excluded) recompacted
    let allCursor = 0;
    const allSegments = cells.map((cell, i) => {
      const dur = durations[i] || 0; const start = allCursor; allCursor += dur;
      return { cell, idx: i, start, end: allCursor, dur };
    }).filter(s => s.dur > 0);

    let activeCursor = 0;
    const activeSegments = allSegments
      .filter(s => !excludedSet.has(s.idx))
      .map(s => { const st = activeCursor; activeCursor += s.dur; return Object.assign({}, s, { activeStart: st, activeEnd: activeCursor }); });
    const totalDur = activeCursor;

    // Effective effect = per-clip override ?? track default.
    const segFx = sd.segmentEffects || {};
    const segT = sd.segTransition || 'fade', segA = sd.segAnimation || 'none', segFi = sd.segFilter || 'none';
    const biroT = sd.biroTransition || 'fade', biroA = sd.biroAnimation || 'none', biroFi = sd.biroFilter || 'none';
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
        speed:     1,
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
        crop: parseFloat(t.crop) || 0, speed: parseFloat(t.speed) || 1,
        cropAlign: t.cropAlign || 'center', reversed: !!t.reversed,
        audioOn: (t.audio != null) ? !!t.audio : !!sd.biroAudio,
      }, _eff(t, biroT, biroA, biroFi));
    }).filter(Boolean);

    const hooksData = sd.hooks || {};
    const hooks = (hooksData.activated || []).map(idx => {
      const h = hooksList[parseInt(String(idx).split('#')[0], 10)]; const t = (hooksData.timings || {})[idx];
      if (!h || !h.videoPath || !t || t.start === undefined) return null;
      return Object.assign({
        kind: 'hook', key: idx, name: h.name || 'Hook', videoPath: h.videoPath,
        start: parseFloat(t.start) || 0, end: parseFloat(t.end) || 6,
        crop: parseFloat(t.crop) || 0, speed: parseFloat(t.speed) || 1,
        cropAlign: t.cropAlign || 'center', reversed: !!t.reversed,
        audioOn: (t.audio != null) ? !!t.audio : !!sd.biroAudio,
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
        crop: parseFloat(t.crop) || 0, speed: parseFloat(t.speed) || 1,
        cropAlign: t.cropAlign || 'center',
        halferAlign: t.halferAlign || 'top', reversed: !!t.reversed,
        audioOn: (t.audio != null) ? !!t.audio : !!sd.biroAudio,
      };
    }).filter(Boolean);

    // Probe insert source durations → max timeline length = srcDur / speed.
    const allInserts = birols.concat(hooks, halfers);
    await Promise.all(allInserts.map(async c => { c.srcDur = await MV2.getVideoDuration(c.videoPath) || 0; }));

    // Music track
    const musicUrl = (sd.music && sd.music !== 'Нет') ? sd.music : null;
    const musicDur = musicUrl ? (await MV2.getVideoDuration(musicUrl) || 0) : 0;

    return {
      sessionKey,
      title:      _label(sessionKey, session),
      scenFile:   session.scenFile || sessionKey.split('__').slice(1, -1).join('__'),
      totalDur,
      resolution: _parseResolution(sd.advSettings && sd.advSettings.resolution),
      segVolume:  sd.segVolume != null ? sd.segVolume : 1.0,
      music: {
        url:    musicUrl,
        offset: sd.musicOffset || 0,
        volume: sd.musicVolume != null ? sd.musicVolume : 0.5,
        dur:    musicDur,
      },
      subtitles: (sd.srtSubtitles || []).map(s => ({
        text: s.text || '', start: parseFloat(s.start) || 0, end: parseFloat(s.end) || 0,
      })),
      subsEnabled: !(sd.advSettings && sd.advSettings.subsEnabled === false),
      srtRawText: sd.srtRawText || '',
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
    } else {
      if (Array.isArray(s.activated)) s.activated = s.activated.filter(k => k !== key);
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
  MV2.listMedia = function (kind) {
    if (kind === 'hook') return (typeof getHooksArchive === 'function') ? getHooksArchive() : [];
    return (typeof getBirolyArchive === 'function') ? getBirolyArchive() : [];
  };

  MV2.setMusic = function (sessionKey, patch) {
    const d = getTimelineData();
    const s = _ensure(d, sessionKey);
    Object.assign(s, patch); // { music, musicOffset, musicVolume }
    setTimelineData(d);
  };

  // Merge arbitrary top-level keys into the session (e.g. seg/biro effect fields).
  MV2.setFields = function (sessionKey, patch) {
    const d = getTimelineData();
    const s = _ensure(d, sessionKey);
    Object.assign(s, patch);
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
    delete s.prebuiltAssPath;
    setTimelineData(d);
  };

  // Store an STT result (raw SRT + word timings from the provider).
  MV2.storeSttResult = function (sessionKey, srtText, words) {
    const d = getTimelineData();
    const s = _ensure(d, sessionKey);
    s.srtSubtitles = (typeof _parseSrt === 'function') ? _parseSrt(srtText || '') : [];
    s.srtRawText   = srtText || '';
    s.srtWords     = words || [];
    delete s.prebuiltAssPath;
    setTimelineData(d);
  };

  window.MV2 = MV2;
})();
