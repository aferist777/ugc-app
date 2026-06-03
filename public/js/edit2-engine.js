/* ═══════════════════════════════════════════════════════════════════════════
   edit2-engine.js — generation orchestrator for Edit v2 (window.EDIT2Engine).

   Calls the SAME backend endpoints the legacy Edit uses, with byte-identical
   request bodies, but decoupled from the old DOM. Writes results straight into
   editFrozenSessions + saveEditState (single source of truth), and reports
   progress/state via hooks so the popup can update individual rows live.

   Ф2 = voices. Mixes (Ф3) and talking-head video (Ф4) extend this file.

   Reused globals: editFrozenSessions, saveEditState, getTimelineData, getObrazы,
   getAudioEngine, getEngineParams, pollTts (all defined earlier in load order).
   ═══════════════════════════════════════════════════════════════════════════ */

(function () {
  const E = {};
  const _abort   = {};   // sessionKey → bool (stop requested)
  const _running = {};   // sessionKey → bool (bulk voices in flight)

  function _sess(k) {
    const all = (typeof editFrozenSessions !== 'undefined') ? editFrozenSessions : (window.editFrozenSessions || {});
    return all[k];
  }
  function _obrazVoice(k) {
    try {
      const s = _sess(k);
      const list = (typeof getObrazы === 'function') ? getObrazы() : [];
      const o = list.find(x => String(x.id) === String(s && s.obrazId));
      return (o && o.voice) || null;
    } catch { return null; }
  }

  // ── Resolve the same voice/params/model the legacy Edit would send ───────────
  E.resolveVoice = function (k) {
    try { return localStorage.getItem('edit_voice__' + k) || _obrazVoice(k) || 'Rachel'; }
    catch { return 'Rachel'; }
  };
  E.resolveModel = function () {
    return (typeof getAudioEngine === 'function') ? getAudioEngine() : undefined;
  };
  E.resolveTtsParams = function (k) {
    let global = {};
    try {
      if (typeof getEngineParams === 'function') {
        global = getEngineParams(E.resolveModel() || 'elevenlabs/text-to-dialogue-v3') || {};
      }
    } catch {}
    let proj = null;
    try { proj = JSON.parse(localStorage.getItem('edit_tts_params__' + k) || 'null'); } catch {}
    const params = proj ? Object.assign({}, global, proj) : Object.assign({}, global);
    // Per-project voice model: v3 = emotional (reads inline [tags] in the text),
    // v2 = standard multilingual. Overrides any global model_id.
    try {
      const vm = (window.EDIT2 && EDIT2.getVoiceModel) ? EDIT2.getVoiceModel(k) : 'v2';
      params.model_id = (vm === 'v3') ? 'eleven_v3' : 'eleven_multilingual_v2';
    } catch {}
    return params;
  };

  // ── Per-project file foldering (Phase B) ────────────────────────────────────
  // Move freshly-generated files into data/uploads/edit/<key>/<bucket>/.
  // bucket: 'v2'|'v3' for audio/video (model-specific), 'mixes' for images.
  function _voiceBucket(k) { try { return (window.EDIT2 && EDIT2.getVoiceModel) ? EDIT2.getVoiceModel(k) : 'v2'; } catch { return 'v2'; } }
  E._organize = async function (k, bucket, paths) {
    const list = (paths || []).filter(Boolean);
    if (!list.length) return {};
    try {
      const r = await fetch('/api/edit/organize', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectKey: k, bucket: bucket, paths: list }),
      });
      const d = await r.json();
      return (d && d.success && d.moved) ? d.moved : {};
    } catch { return {}; }
  };

  async function _ttsOnce(k, text) {
    const r = await fetch('/api/audio/tts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text, voice: E.resolveVoice(k), ttsParams: E.resolveTtsParams(k), model: E.resolveModel() }),
    });
    const d = await r.json();
    if (!d.success) throw new Error(d.error || 'TTS error');
    // elevenlabs returns audioPath synchronously; kie.ai returns a taskId to poll.
    return d.audioPath || await pollTts(d.taskId);
  }

  // ── Generate the voice for ONE cell. hooks: { onState(state, msg?) } ─────────
  //    state ∈ running | done | error. Writes cell.audioPath / cell.audioError.
  E.genVoice = async function (k, idx, hooks) {
    hooks = hooks || {};
    const s = _sess(k);
    if (!s || !Array.isArray(s.cells) || !s.cells[idx]) return null;
    const cell = s.cells[idx];
    if (hooks.onState) hooks.onState('running');
    delete cell.audioError;

    let ap, last = null;
    for (let a = 0; a < 3; a++) {                       // 3 attempts, 2.5s backoff (matches legacy)
      try { ap = await _ttsOnce(k, cell.line || ''); last = null; break; }
      catch (e) { last = e; if (a < 2) await new Promise(r => setTimeout(r, 2500)); }
    }
    if (last) {
      cell.audioError = last.message || 'TTS failed';
      if (typeof saveEditState === 'function') saveEditState();
      if (hooks.onState) hooks.onState('error', cell.audioError);
      throw last;
    }
    cell.audioPath = ap; delete cell.audioError;
    try { const mv = await E._organize(k, _voiceBucket(k), [ap]); if (mv[ap]) cell.audioPath = mv[ap]; } catch {}
    if (typeof saveEditState === 'function') saveEditState();
    if (hooks.onState) hooks.onState('done');
    return cell.audioPath;
  };

  E.stop = function (k) { _abort[k] = true; };
  E.isRunning = function (k) { return !!_running[k]; };

  // (bulk runners — genAllVoices / genAllMixes / genAllVideos / genAll — are
  //  consolidated near the end of this file with bounded-concurrency pooling.)

  // ═══ MIXES (Ф3) ═══════════════════════════════════════════════════════════
  function _obraz(k) {
    try {
      const s = _sess(k);
      const list = (typeof getObrazы === 'function') ? getObrazы() : [];
      return list.find(x => String(x.id) === String(s && s.obrazId)) || null;
    } catch { return null; }
  }
  function _hasMix(cell) {
    return !!(cell && cell.detInfo && cell.mixes && cell.detInfo.file && cell.mixes[cell.detInfo.file]);
  }
  E.hasMix = _hasMix;

  E.resolveImageEngine = function () {
    return (typeof getImageEngine === 'function' && getImageEngine()) || 'seedream';
  };

  // Generate a mix image (character + assigned product) for ONE cell. Mirrors the
  // legacy retryCellImage: random char from the образ, pre-analyze once, then up
  // to 3 generate+poll attempts. hooks: { onState(state, msg?) }.
  E.genMix = async function (k, idx, hooks) {
    hooks = hooks || {};
    const s = _sess(k);
    if (!s || !Array.isArray(s.cells) || !s.cells[idx]) return null;
    const cell = s.cells[idx];
    if (!cell.detInfo) return null; // no product → no mix step

    const ob = _obraz(k);
    const chars = [ob && ob.char].concat(((ob && ob.variations) || []).filter(v => v && v !== 'error')).filter(Boolean);
    const assetSrc = cell.detInfo.path || (cell.detInfo.file ? ('/details/' + cell.detInfo.file) : null);
    const fail = (msg) => { delete cell.taskId; cell.imageError = msg; if (typeof saveEditState === 'function') saveEditState(); if (hooks.onState) hooks.onState('error', msg); throw new Error(msg); };
    if (!chars.length) return fail('no outfit image');
    if (!assetSrc)     return fail('no item image');

    if (hooks.onState) hooks.onState('running');
    delete cell.imageError;
    // Prefer the randomized per-cell character so the mix matches the Image column.
    const charSrc = cell.charImagePath || chars[Math.floor(Math.random() * chars.length)];

    // Interaction directive (v2 preset → presetPrompt for the analyzer).
    let iPrompt = '';
    try { if (window.EDIT2 && EDIT2.interactionPrompt) iPrompt = EDIT2.interactionPrompt(cell.interaction); } catch {}

    // Negative prompt (global setting), best-effort.
    let neg = '';
    try { const sd = await (await fetch('/api/settings')).json(); neg = (sd.settings && sd.settings.editNegativePrompt) || ''; } catch {}

    // Pre-analyze once → combined prompt.
    let combined = '';
    try {
      const ar = await fetch('/api/asset-interact/pre-analyze', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activePath: charSrc, assetPath: assetSrc, presetPrompt: iPrompt }),
      });
      const ad = await ar.json();
      if (ad.success && ad.combinedPrompt) combined = ad.combinedPrompt;
    } catch {}
    if (neg && combined) combined += '\nAvoid in generation: ' + neg;

    const imageEngine = E.resolveImageEngine();
    const engineParams = (typeof getEngineParams === 'function' && getEngineParams(imageEngine)) || {};

    let imagePath, last = null;
    for (let a = 0; a < 3; a++) {
      try {
        const gr = await fetch('/api/asset-interact/generate', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ activePath: charSrc, assetPath: assetSrc, prompt: combined, assetType: 'detail', imageEngine: imageEngine, engineParams: engineParams }),
        });
        const gd = await gr.json();
        if (!gd.success) throw new Error(gd.error || 'generation error');
        cell.taskId = gd.taskId; if (typeof saveEditState === 'function') saveEditState();
        imagePath = await pollTask(gd.taskId, 3000, 120);
        last = null; break;
      } catch (e) { last = e; if (a < 2) await new Promise(r => setTimeout(r, 3000)); }
    }
    if (last) return fail(last.message || 'mix failed');

    delete cell.taskId;
    cell.imagePath = imagePath;
    if (!cell.mixes) cell.mixes = {};
    cell.mixes[cell.detInfo.file] = imagePath;
    if (!cell.generatedImages) cell.generatedImages = [];
    if (!cell.generatedImages.includes(imagePath)) cell.generatedImages.push(imagePath);
    try {
      const mv = await E._organize(k, 'mixes', [imagePath]);
      const np = mv[imagePath];
      if (np) {
        cell.imagePath = np;
        cell.mixes[cell.detInfo.file] = np;
        cell.generatedImages = cell.generatedImages.map(u => (u === imagePath ? np : u));
        imagePath = np;
      }
    } catch {}
    delete cell.imageError;
    if (typeof saveEditState === 'function') saveEditState();
    if (hooks.onState) hooks.onState('done');
    return imagePath;
  };

  // ═══ TALKING-HEAD VIDEO (Ф4) ═════════════════════════════════════════════
  function _avatarModel() {
    const v = localStorage.getItem('edit_avatar_model_global');
    const allowed = ['kling/ai-avatar-standard', 'kling/ai-avatar-pro', 'prunaai/p-video-avatar'];
    return allowed.includes(v) ? v : 'kling/ai-avatar-standard';
  }
  const _validPrompt = (p) => {
    if (!p || typeof p !== 'string') return false;
    const t = p.trim();
    if (t.length < 30) return false;
    if (/^error\b/i.test(t)) return false;
    if (/error in message stream/i.test(t)) return false;
    return true;
  };

  // Rolling per-model generation-time ratios (durationSec / audioSec), cached
  // for ~60s. Drives the live ETA countdown shown in the video cell.
  let _ratiosCache = null, _ratiosTs = 0;
  async function _genRatios() {
    const now = Date.now();
    if (_ratiosCache && (now - _ratiosTs) < 60000) return _ratiosCache;
    try { const d = await (await fetch('/api/gen-timings')).json(); _ratiosCache = (d && d.success) ? (d.ratios || {}) : {}; _ratiosTs = now; }
    catch { _ratiosCache = _ratiosCache || {}; }
    return _ratiosCache;
  }
  async function _probeAudioSec(url) {
    return new Promise(res => {
      const a = new Audio(url);
      a.addEventListener('loadedmetadata', () => res(a.duration || 0), { once: true });
      a.addEventListener('error', () => res(0), { once: true });
      a.load();
    });
  }

  // Generate the talking-head video for ONE cell. Mirrors runSingleAvatar (minus
  // the vestigial upload steps — avatar-prompt/avatar take imagePath directly).
  E.genVideo = async function (k, idx, hooks) {
    hooks = hooks || {};
    const s = _sess(k);
    if (!s || !Array.isArray(s.cells) || !s.cells[idx]) return null;
    const cell = s.cells[idx];
    const ob = _obraz(k);
    const imgPath = cell.chosenImage || (_hasMix(cell) ? cell.mixes[cell.detInfo.file] : null) || cell.imagePath || cell.charImagePath || (ob && ob.char);
    const failV = (msg) => {
      delete cell._videoPending; cell.videoError = msg;
      if (!String(msg).includes('no connection')) delete cell.avatarTaskId;
      if (typeof saveEditState === 'function') saveEditState();
      if (hooks.onState) hooks.onState('error', msg); throw new Error(msg);
    };
    if (!imgPath) return failV('no image');
    if (!cell.audioPath) return failV('no voice');

    if (hooks.onState) hooks.onState('running');
    cell._videoPending = true; delete cell.videoError; if (typeof saveEditState === 'function') saveEditState();

    const model = _avatarModel();
    const isMini = (model === 'prunaai/p-video-avatar');
    const videoParams = (typeof getEngineParams === 'function' && getEngineParams('kling/ai-avatar-standard')) || {};
    const defaultPrompt = videoParams.prompt || 'Natural speaking motion with subtle head movement and relaxed posture';
    const schema = (window.ENGINE_SCHEMAS && window.ENGINE_SCHEMAS[model]) || null;

    // Audio length — needed for the kie.ai max-audio guard AND the ETA estimate.
    if (!cell._audioSec && cell.audioPath) cell._audioSec = await _probeAudioSec(cell.audioPath);
    if (schema && schema.maxAudioSec && cell._audioSec > schema.maxAudioSec) {
      return failV('audio ' + cell._audioSec.toFixed(1) + 's exceeds ' + schema.maxAudioSec + 's cap — use p-video-avatar or shorten');
    }

    // Scenario-wide motion hint (per model).
    let motionHint = '';
    try {
      const sf = s.scenFile;
      if (sf) {
        const mr = await fetch('/api/scenarios/meta/' + encodeURIComponent(sf));
        const md = await mr.json();
        if (md.success && md.meta) motionHint = isMini ? (md.meta.minimalistMotionPrompt || '') : (md.meta.motionPrompt || '');
      }
    } catch {}

    // Motion-prompt resolution:
    //   • per-fragment cell.motionPrompt set (typed by user OR pre-generated via
    //     the ✨ settings button) → use it verbatim, skip the analysis call;
    //   • empty → auto-analyze (text + image) here, 3 attempts (default behaviour).
    let prompt;
    const userMotion = (cell.motionPrompt && String(cell.motionPrompt).trim()) ? String(cell.motionPrompt).trim() : '';
    if (userMotion) {
      prompt = userMotion;
    } else {
      prompt = cell.avatarPrompt || defaultPrompt;
      for (let a = 0; a < 3; a++) {
        try {
          const pr = await fetch('/api/audio/avatar-prompt', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imagePath: imgPath, text: cell.line, detailImagePath: (cell.detInfo && cell.detInfo.path) || null, motionHint: motionHint || undefined, targetModel: model }),
          });
          const pd = await pr.json();
          if (pd.success && _validPrompt(pd.prompt)) { prompt = pd.prompt; cell.avatarPrompt = prompt; if (typeof saveEditState === 'function') saveEditState(); break; }
          if (a < 2) await new Promise(r => setTimeout(r, 1500));
        } catch { if (a < 2) await new Promise(r => setTimeout(r, 1500)); }
      }
    }

    // ETA estimate from rolling timings (model|resolution ratio × audio length),
    // pushed to the UI so the video cell can show a live countdown.
    const _resolution = (videoParams && videoParams.resolution) || (schema && schema.resolution) || '';
    let _etaSec = 0;
    try { const _rt = await _genRatios(); const _r = _rt[model + '|' + _resolution]; if (_r > 0 && cell._audioSec > 0) _etaSec = cell._audioSec * _r; } catch {}
    const _genStartTs = Date.now();
    if (hooks.onState) hooks.onState('running', null, { etaSec: _etaSec });

    // Dispatch + poll.
    try {
      let d;
      if (isMini) {
        let params = {}; try { params = (JSON.parse(localStorage.getItem('edit_avatar_params_global') || '{}'))['prunaai/p-video-avatar'] || {}; } catch {}
        const r = await fetch('/api/audio/avatar-replicate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imagePath: imgPath, audioPath: cell.audioPath, prompt: prompt, params: params }) });
        d = await r.json();
      } else {
        const r = await fetch('/api/audio/avatar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imagePath: imgPath, audioPath: cell.audioPath, prompt: prompt, videoParams: videoParams, model: model }) });
        d = await r.json();
      }
      if (!d.success) throw new Error(d.error || 'avatar error');
      cell.avatarTaskId = d.taskId; cell._videoPending = true; if (typeof saveEditState === 'function') saveEditState();
      const videoPath = await pollAvatar(d.taskId);
      cell.videoPath = videoPath; cell.videoError = null;
      // Record the actual generation time so the ETA self-tunes over runs.
      try { const _dur = (Date.now() - _genStartTs) / 1000; if (cell._audioSec > 0 && _dur > 0) fetch('/api/gen-timings/record', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ modelId: model, resolution: _resolution, audioSec: cell._audioSec, durationSec: _dur }) }).catch(() => {}); } catch {}
      try { const mv = await E._organize(k, _voiceBucket(k), [videoPath]); if (mv[videoPath]) cell.videoPath = mv[videoPath]; } catch {}
      delete cell.avatarTaskId; delete cell._videoPending;
      if (typeof saveEditState === 'function') saveEditState();
      if (hooks.onState) hooks.onState('done');
      return videoPath;
    } catch (e) {
      if (e && e.message === 'Cancelled') { delete cell._videoPending; if (typeof saveEditState === 'function') saveEditState(); if (hooks.onState) hooks.onState('error', 'Cancelled'); throw e; }
      return failV((e && e.message) || 'avatar failed');
    }
  };

  // ═══ BULK ORCHESTRATION ═══════════════════════════════════════════════════
  // Parallel WITHIN a stage (bounded pool + gentle stagger), sequential BETWEEN
  // stages. Dispatches are spaced by _STAGGER and capped per stage by _CAP: the
  // next item only launches once a slot frees (≤cap in flight at any time).
  const _CONCURRENCY = 20;                               // resume re-poll cap
  const _CAP = { voices: 3, mixes: 20, videos: 20 };     // max in flight per stage
  const _STAGGER = 1000;                                 // ms between dispatches

  function _excl(k) { try { const d = getTimelineData(); return new Set((d[k] && d[k].excludedSegments) || []); } catch { return new Set(); } }
  function _elig(k, stage) {
    const s = _sess(k); if (!s || !Array.isArray(s.cells)) return [];
    const ex = _excl(k); const out = [];
    s.cells.forEach((c, i) => {
      if (ex.has(i)) return;
      if (stage === 'voices') { if (c.videoPath || c.avatarTaskId || c._videoPending) return; if (c.audioPath) return; out.push(i); }
      else if (stage === 'mixes') { if (!c.detInfo) return; if (c.videoPath) return; if (_hasMix(c)) return; out.push(i); }
      else if (stage === 'videos') { if (!c.audioPath) return; if (c.videoPath) return; if (window.EDIT2 && EDIT2.cellVideoReady && !EDIT2.cellVideoReady(k, i)) return; out.push(i); }
    });
    return out;
  }
  function _genFor(stage) { return stage === 'voices' ? E.genVoice : stage === 'mixes' ? E.genMix : E.genVideo; }

  // Run a stage's items with bounded concurrency. hooks: onRow(stage,idx,st,msg),
  // onProgress(stage,done,total,failed). Returns the number of failures.
  async function _pool(k, idxs, stage, hooks) {
    const genOne = _genFor(stage);
    const cap = _CAP[stage] || _CONCURRENCY;
    if (hooks.onRow) idxs.forEach(i => hooks.onRow(stage, i, 'queued'));
    const total = idxs.length;
    let done = 0, failed = 0, inFlight = 0, next = 0;
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const promises = [];
    // Staggered launcher: keep ≤cap in flight, ~1s between launches; the next
    // item only dispatches once a slot frees. Stop (_abort) launches no more,
    // but in-flight items finish.
    while (next < total) {
      if (_abort[k]) break;
      if (inFlight >= cap) { await sleep(120); continue; }
      const idx = idxs[next++];
      inFlight++;
      const p = genOne(k, idx, { onState: (st, msg, info) => hooks.onRow && hooks.onRow(stage, idx, st, msg, info) })
        .catch(() => { failed++; })
        .then(() => { inFlight--; done++; if (hooks.onProgress) hooks.onProgress(stage, done, total, failed); });
      promises.push(p);
      if (next < total && !_abort[k]) await sleep(_STAGGER);
    }
    await Promise.allSettled(promises);
    return failed;
  }

  // Standalone single-stage bulk. hooks: onStart(total), onRow(idx,st,msg),
  // onProgress(done,total,failed), onDone(failed).
  async function _bulk(k, stage, h) {
    h = h || {};
    const idxs = _elig(k, stage);
    if (h.onStart) h.onStart(idxs.length);
    if (!idxs.length) { if (h.onDone) h.onDone(0); return; }
    _running[k] = true; _abort[k] = false;
    let failed = 0;
    try {
      failed = await _pool(k, idxs, stage, {
        onRow: (st, idx, s, m, info) => h.onRow && h.onRow(idx, s, m, info),
        onProgress: (st, d, t, f) => h.onProgress && h.onProgress(d, t, f),
      });
    } finally { _running[k] = false; _abort[k] = false; if (h.onDone) h.onDone(failed); }
  }

  E.genAllVoices = (k, h) => _bulk(k, 'voices', h);
  E.genAllMixes  = (k, h) => _bulk(k, 'mixes', h);
  E.genAllVideos = (k, h) => _bulk(k, 'videos', h);

  // Full pipeline: voices → mixes → videos (eligibility recomputed per phase, so
  // freshly-voiced lines flow into the video phase). hooks: onPhase(name),
  // onRow(stage,idx,st,msg), onProgress(stage,done,total,failed), onDone(failedTotal).
  E.genAll = async function (k, hooks) {
    hooks = hooks || {};
    _running[k] = true; _abort[k] = false;
    let failedTotal = 0;
    try {
      for (const stage of ['voices', 'mixes', 'videos']) {
        if (_abort[k]) break;
        // Optional per-segment motion-prompt pass AFTER mixes, before any video
        // dispatch (runs regardless of mix eligibility so it also fires when the
        // mixes were already done).
        if (stage === 'videos' && hooks.beforeVideos && !_abort[k]) { try { await hooks.beforeVideos(); } catch {} }
        const idxs = _elig(k, stage);
        if (!idxs.length) continue;
        if (hooks.onPhase) hooks.onPhase(stage);
        failedTotal += await _pool(k, idxs, stage, hooks);
      }
    } finally { _running[k] = false; _abort[k] = false; if (hooks.onDone) hooks.onDone(failedTotal); }
  };

  // ═══ RESUME (Ф5) — re-attach polling to tasks left in flight before a reload ═
  // Voice TTS has no persisted handle (sync / awaited inline), so resume covers
  // mix (cell.taskId) and video (cell.avatarTaskId).
  E.inFlight = function (k) {
    const s = _sess(k);
    if (!s || !Array.isArray(s.cells)) return [];
    const out = [];
    s.cells.forEach((c, i) => {
      if (c.avatarTaskId && !c.videoPath) out.push({ idx: i, kind: 'video', taskId: c.avatarTaskId });
      else if (c.taskId && c.detInfo && !_hasMix(c)) out.push({ idx: i, kind: 'mix', taskId: c.taskId });
    });
    return out;
  };

  async function _resumeOne(k, item, hooks) {
    hooks = hooks || {};
    const s = _sess(k); const cell = s && s.cells && s.cells[item.idx];
    if (!cell) return false;
    if (hooks.onState) hooks.onState('running');
    try {
      if (item.kind === 'video') {
        const vp = await pollAvatar(item.taskId);
        cell.videoPath = vp; cell.videoError = null; delete cell.avatarTaskId; delete cell._videoPending;
      } else {
        const ip = await pollTask(item.taskId, 3000, 120);
        cell.imagePath = ip;
        if (cell.detInfo) { if (!cell.mixes) cell.mixes = {}; cell.mixes[cell.detInfo.file] = ip; }
        if (!cell.generatedImages) cell.generatedImages = [];
        if (!cell.generatedImages.includes(ip)) cell.generatedImages.push(ip);
        delete cell.taskId; delete cell.imageError;
      }
      if (typeof saveEditState === 'function') saveEditState();
      if (hooks.onState) hooks.onState('done');
      return true;
    } catch (e) {
      const msg = (e && e.message) || 'failed';
      if (item.kind === 'video') { delete cell._videoPending; if (!String(msg).includes('no connection')) delete cell.avatarTaskId; cell.videoError = msg; }
      else { delete cell.taskId; cell.imageError = msg; }
      if (typeof saveEditState === 'function') saveEditState();
      if (hooks.onState) hooks.onState('error', msg);
      return false;
    }
  }

  // hooks: onStart(total), onRow(kind, idx, state, msg?), onProgress(done,total,failed), onDone(failed).
  E.resume = async function (k, hooks) {
    hooks = hooks || {};
    const items = E.inFlight(k);
    if (hooks.onStart) hooks.onStart(items.length);
    if (!items.length) { if (hooks.onDone) hooks.onDone(0); return; }
    _running[k] = true; _abort[k] = false;
    let done = 0, failed = 0, next = 0;
    async function worker() {
      while (true) {
        if (_abort[k]) return;
        const pos = next++; if (pos >= items.length) return;
        const it = items[pos];
        const ok = await _resumeOne(k, it, { onState: (st, msg) => hooks.onRow && hooks.onRow(it.kind, it.idx, st, msg) });
        if (!ok) failed++;
        done++; if (hooks.onProgress) hooks.onProgress(done, items.length, failed);
      }
    }
    try { await Promise.all(Array.from({ length: Math.min(_CONCURRENCY, items.length) }, () => worker())); }
    finally { _running[k] = false; _abort[k] = false; if (hooks.onDone) hooks.onDone(failed); }
  };

  window.EDIT2Engine = E;
})();
