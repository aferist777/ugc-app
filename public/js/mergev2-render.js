/* ═══════════════════════════════════════════════════════════════════════════
   mergev2-render.js — SHARED render payload builder for the FFmpeg pipeline.

   Extracted verbatim from the old Merge (Склейка) btnMerge click handler in
   scen-timeline.js so that BOTH the old Merge AND the new "Merge v2" editor
   produce a BYTE-IDENTICAL body for POST /api/ffmpeg/render. This is the single
   source of truth for the render payload — never duplicate this math elsewhere.

   Loaded BEFORE scen-timeline.js (so window.buildRenderPayload exists by the
   time a Merge button is clicked).

   buildRenderPayload(ctx) is PURE: no DOM access. The caller resolves all
   dynamic values (music/sfx URLs, title, defaults) into `ctx` and passes them
   in; this function only reads the timeline data model + archives (globals).

   ctx = {
     sessionKey,            // "obrazId__scenFile"
     activeSegments,        // [{ cell:{videoPath,line}, idx, activeStart, activeEnd }]
     totalDur,              // number, seconds (sum of active segment durations)
     rangePct,              // { left:0..1, right:0..1 } range-selector fractions
     musicUrl, musicOffset, // from musicCtrl.getUrl()/getOffset()
     segSfxUrl,             // from segSfxCtrl.getUrl()
     biroSfxUrl,            // from biroSfxCtrl.getUrl()
     outputLabel,           // _tlTitle
     advDefaults,           // ADV_DEFAULTS  (scen-ffmpeg-modal.js)
     assDefaults,           // ASS_DEFAULTS  (scen-ffmpeg-modal.js)
   }

   Returns the exact request body object (segmentClips/clips/halferClips + all
   seg/biro params + subtitles). Caller checks body.segmentClips.length before
   sending and aborts on 0 (same as the original handler).
   ═══════════════════════════════════════════════════════════════════════════ */

(function () {
  function buildRenderPayload(ctx) {
    const {
      sessionKey,
      activeSegments,
      totalDur,
      rangePct,
      musicClips = [],
      segSfxUrl,
      biroSfxUrl,
      outputLabel,
      advDefaults,
      assDefaults,
    } = ctx;

    // Extract optional per-clip effect override fields (omitted when unset →
    // JSON drops undefined keys → byte-identical payload for the no-override case).
    const _fx = (src) => {
      const o = {};
      if (!src) return o;
      if (src.transition != null) { o.transition = src.transition; o.transitionParams = src.transitionParams || {}; }
      if (src.animation  != null) { o.animation  = src.animation;  o.animParams       = src.animParams       || {}; }
      if (src.filter     != null) { o.filter     = src.filter;     o.filterParams     = src.filterParams     || {}; }
      return o;
    };

    const archive   = typeof getBirolyArchive === 'function' ? getBirolyArchive() : [];
    const tlDataNow = getTimelineData();
    const sd        = tlDataNow[sessionKey] || {};
    const activated = sd.activated || [];
    const timings   = sd.timings   || {};

    // Biroly clips
    const birolyClips = activated.map(key => {
      const base = String(key).split('#')[0];   // multi-instance: srcKey#N -> srcKey
      const b = /^\d+$/.test(base) ? archive[parseInt(base, 10)] : archive.find(e => e.id === base);
      const t = timings[key];
      if (!b || !b.videoPath || !t || t.start === undefined) return null;
      return { videoPath: b.videoPath, name: b.name || 'Birol',
               start: parseFloat(t.start)||0, end: parseFloat(t.end)||6,
               crop: parseFloat(t.crop)||0, speed: parseFloat(t.speed)||1,
               cropAlign: t.cropAlign || 'center', reversed: !!t.reversed,
               audio: (t.audio != null) ? !!t.audio : !!sd.biroAudio,
               volume: (t.volume != null) ? +t.volume : (sd.biroVolume != null ? +sd.biroVolume : 1), ..._fx(t) };
    }).filter(Boolean);

    // Hook clips
    const hooksData  = sd.hooks || {};
    const hooksList  = typeof getHooksArchive === 'function' ? getHooksArchive() : [];
    const hookClips  = (hooksData.activated || []).map(idx => {
      const h = hooksList[parseInt(String(idx).split('#')[0], 10)]; const ht = (hooksData.timings || {})[idx];
      if (!h || !h.videoPath || !ht || ht.start === undefined) return null;
      return { videoPath: h.videoPath, name: h.name || 'Hook',
               start: parseFloat(ht.start)||0, end: parseFloat(ht.end)||6,
               crop: parseFloat(ht.crop)||0, speed: parseFloat(ht.speed)||1,
               cropAlign: ht.cropAlign || 'center', reversed: !!ht.reversed,
               audio: (ht.audio != null) ? !!ht.audio : (sd.hookAudio != null ? !!sd.hookAudio : !!sd.biroAudio),
               volume: (ht.volume != null) ? +ht.volume : (sd.hookVolume != null ? +sd.hookVolume : 1), ..._fx(ht) };
    }).filter(Boolean);

    // Halfer clips (2/5-height overlays placed top or bottom on the main video)
    const halfersData = sd.halfers || {};
    const halferTimings = halfersData.timings || {};
    const halferClips = (halfersData.activated || []).map(stableKey => {
      const base = String(stableKey).split('#')[0];   // multi-instance: srcKey#N -> srcKey
      const item = /^\d+$/.test(base) ? archive[parseInt(base, 10)] : archive.find(e => e.id === base);
      const ht = halferTimings[stableKey];
      if (!item || !item.videoPath || !ht || ht.start === undefined) return null;
      return {
        videoPath: item.videoPath, name: item.name || 'Halfer',
        start: parseFloat(ht.start) || 0, end: parseFloat(ht.end) || 5,
        crop: parseFloat(ht.crop) || 0, speed: parseFloat(ht.speed) || 1,
        cropAlign:   ht.cropAlign   || 'center',
        halferAlign: ht.halferAlign || 'top',
        reversed:    !!ht.reversed,
        audio:       (ht.audio != null) ? !!ht.audio : (sd.halferAudio != null ? !!sd.halferAudio : !!sd.biroAudio),
        volume:      (ht.volume != null) ? +ht.volume : (sd.halferVolume != null ? +sd.halferVolume : 1),
      };
    }).filter(Boolean);

    const localClipsRaw = [...birolyClips, ...hookClips].sort((a, b) => a.start - b.start);

    const segFx = sd.segmentEffects || {};
    const segSpeed = sd.segmentSpeed || {};
    const segTrim  = sd.segmentTrim  || {};                // edge trim {in,out}; in-point → ffmpeg -ss
    const localSegClipsRaw = activeSegments
      .filter(s => s.cell.videoPath || s.cell.audioPath)   // include voice-only fragments (audio, no video)
      .map(s => ({
        name: s.cell.line || `Fr.${s.idx+1}`,
        videoPath: s.cell.videoPath || null,
        audioPath: s.cell.audioPath || null,
        voiceOnly: !s.cell.videoPath,                      // → render as black video + voice + subtitles
        start: s.activeStart, end: s.activeEnd,
        crop: parseFloat((segTrim[s.idx] || {}).in) || 0,  // in-point (start trim) — backend uses it as -ss
        speed: parseFloat(segSpeed[s.idx]) || 1,           // talking-head per-fragment speed (render mirrors preview)
        reversed: !!((sd.segmentReversed || {})[s.idx]),
        ..._fx(segFx[s.idx]),
      }));

    // Apply range selector (if not full range)
    const applyRange = totalDur > 0 && (rangePct.left > 0.001 || rangePct.right < 0.999);
    const trimStart  = applyRange ? rangePct.left  * totalDur : 0;
    const trimEnd    = applyRange ? rangePct.right * totalDur : (totalDur || Infinity);

    const _trimClip = (c) => {
      const cs = Math.max(c.start, trimStart);
      const ce = Math.min(c.end,   trimEnd);
      if (cs >= ce) return null;
      return { ...c, start: cs - trimStart, end: ce - trimStart };
    };

    const localSegClips = applyRange
      ? localSegClipsRaw.map(_trimClip).filter(Boolean)
      : localSegClipsRaw;
    const localClips = applyRange
      ? localClipsRaw.map(_trimClip).filter(Boolean)
      : localClipsRaw;
    const localHalferClips = applyRange
      ? halferClips.map(_trimClip).filter(Boolean)
      : halferClips;

    // Music clips (multi-instance): timeline [start,end], source plays from 0.
    // Range-trim like inserts; ffmpeg derives delay/atrim/atempo from start/end/speed.
    const musicRenderRaw = (musicClips || [])
      .filter(mc => mc && mc.url && mc.url !== 'Нет' && mc.end > mc.start)
      .map(mc => ({ url: mc.url, start: +mc.start, end: +mc.end, speed: (mc.speed > 0 ? +mc.speed : 1), volume: (mc.volume != null ? +mc.volume : 0.5) }));
    const localMusicClips = applyRange
      ? musicRenderRaw.map(_trimClip).filter(Boolean)
      : musicRenderRaw;

    const advSettings   = { ...advDefaults, ...(sd.advSettings || {}) };
    const assSettings   = { ...assDefaults, ...(sd.assSettings || {}) };
    // Strip ElevenLabs v3 inline audio tags ([excited], [whispers]…) from caption
    // text — they belong in the TTS input, never on screen.
    const _stripTags = (t) => String(t == null ? '' : t).replace(/\[[^\]]*\]/g, '').replace(/\s{2,}/g, ' ').trim();
    const subtitles     = advSettings.subsEnabled
      ? localSegClips.map(s => ({ text: _stripTags(s.name), start: s.start, end: s.end }))
      : [];
    // Adjust subtitle timestamps when range trim is active
    const _shiftSubs = (subs) => !applyRange ? subs : subs
      .map(s => ({ ...s, start: s.start - trimStart, end: s.end - trimStart }))
      .filter(s => s.end > 0);
    const _shiftWords = (ws) => !applyRange ? ws : ws
      .map(w => ({ ...w, start: w.start - trimStart, end: w.end - trimStart }))
      .filter(w => w.end > 0);
    const srtSubtitles    = _shiftSubs(sd.srtSubtitles    || []);
    const srtWords        = _shiftWords(sd.srtWords        || []);
    const prebuiltAssPath = applyRange ? null : (sd.prebuiltAssPath || null);

    return {
      segmentClips:   localSegClips,
      clips:          localClips,
      halferClips:    localHalferClips,
      musicClips:     localMusicClips,
      segVolume:      sd.segVolume     != null ? sd.segVolume     : 1.0,
      segTransition:        sd.segTransition       || 'none',
      segTransitionParams:  sd.segTransitionParams || {},
      segAnimation:         sd.segAnimation        || 'none',
      segAnimParams:        sd.segAnimParams       || {},
      segFilter:            sd.segFilter           || 'none',
      segFilterParams:      sd.segFilterParams     || {},
      segSfx:               segSfxUrl,
      segSfxVolume:         sd.segSfxVolume       != null ? sd.segSfxVolume  : 0.8,
      biroTransition:       sd.biroTransition      || 'none',
      biroTransitionParams: sd.biroTransitionParams|| {},
      biroAnimation:        sd.biroAnimation       || 'none',
      biroAnimParams:       sd.biroAnimParams      || {},
      biroFilter:           sd.biroFilter          || 'none',
      biroFilterParams:     sd.biroFilterParams    || {},
      biroSfx:              biroSfxUrl,
      biroSfxVolume:        sd.biroSfxVolume      != null ? sd.biroSfxVolume : 0.8,
      outputLabel:    outputLabel,
      advSettings,
      subtitles,
      srtSubtitles,
      srtWords,
      assSettings,
      prebuiltAssPath,
    };
  }

  window.buildRenderPayload = buildRenderPayload;
})();
