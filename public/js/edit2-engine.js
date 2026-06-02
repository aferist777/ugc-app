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
    return proj ? Object.assign({}, global, proj) : global;
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
    if (typeof saveEditState === 'function') saveEditState();
    if (hooks.onState) hooks.onState('done');
    return ap;
  };

  E.stop = function (k) { _abort[k] = true; };
  E.isRunning = function (k) { return !!_running[k]; };

  // ── Generate ALL missing voices, sequentially. hooks:
  //    { onStart(total), onRow(idx, state, msg?), onProgress(done, total), onDone() }
  E.genAllVoices = async function (k, hooks) {
    hooks = hooks || {};
    const s = _sess(k);
    if (!s || !Array.isArray(s.cells)) { if (hooks.onDone) hooks.onDone(); return; }

    let excl = new Set();
    try { const d = getTimelineData(); excl = new Set((d[k] && d[k].excludedSegments) || []); } catch {}

    const todo = [];
    s.cells.forEach((c, i) => {
      if (excl.has(i)) return;
      if (c.videoPath || c.avatarTaskId || c._videoPending) return;  // don't touch cells with video
      if (c.audioPath) return;                                        // keep existing audio
      todo.push(i);
    });

    if (hooks.onStart) hooks.onStart(todo.length);
    if (!todo.length) { if (hooks.onDone) hooks.onDone(); return; }

    _running[k] = true; _abort[k] = false;
    if (hooks.onRow) todo.forEach(i => hooks.onRow(i, 'queued'));
    let done = 0;
    try {
      for (const idx of todo) {
        if (_abort[k]) break;
        try {
          await E.genVoice(k, idx, { onState: (st, msg) => hooks.onRow && hooks.onRow(idx, st, msg) });
        } catch { /* error already recorded on the cell + reported via onRow */ }
        done++;
        if (hooks.onProgress) hooks.onProgress(done, todo.length);
      }
    } finally {
      _running[k] = false; _abort[k] = false;
      if (hooks.onDone) hooks.onDone();
    }
  };

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
    const charSrc = chars[Math.floor(Math.random() * chars.length)];

    // Interaction prompt (saved per cell), best-effort.
    let iPrompt = '';
    try {
      const sel = JSON.parse(localStorage.getItem('edit_interact__' + k + '__' + idx) || 'null');
      if (sel != null && typeof getMergedOptions === 'function') {
        const opts = getMergedOptions(s.scenFile) || [];
        iPrompt = (opts[sel] && opts[sel].prompt) || '';
      }
    } catch {}

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
    delete cell.imageError;
    if (typeof saveEditState === 'function') saveEditState();
    if (hooks.onState) hooks.onState('done');
    return imagePath;
  };

  // Generate all missing mixes (rows with a product, no mix yet). Same hook shape
  // as genAllVoices.
  E.genAllMixes = async function (k, hooks) {
    hooks = hooks || {};
    const s = _sess(k);
    if (!s || !Array.isArray(s.cells)) { if (hooks.onDone) hooks.onDone(); return; }
    let excl = new Set();
    try { const d = getTimelineData(); excl = new Set((d[k] && d[k].excludedSegments) || []); } catch {}

    const todo = [];
    s.cells.forEach((c, i) => {
      if (excl.has(i)) return;
      if (!c.detInfo) return;                 // only rows with a product need a mix
      if (c.videoPath) return;
      if (_hasMix(c)) return;                 // already mixed
      todo.push(i);
    });

    if (hooks.onStart) hooks.onStart(todo.length);
    if (!todo.length) { if (hooks.onDone) hooks.onDone(); return; }

    _running[k] = true; _abort[k] = false;
    if (hooks.onRow) todo.forEach(i => hooks.onRow(i, 'queued'));
    let done = 0;
    try {
      for (const idx of todo) {
        if (_abort[k]) break;
        try { await E.genMix(k, idx, { onState: (st, msg) => hooks.onRow && hooks.onRow(idx, st, msg) }); }
        catch {}
        done++;
        if (hooks.onProgress) hooks.onProgress(done, todo.length);
      }
    } finally {
      _running[k] = false; _abort[k] = false;
      if (hooks.onDone) hooks.onDone();
    }
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

  // Generate the talking-head video for ONE cell. Mirrors runSingleAvatar (minus
  // the vestigial upload steps — avatar-prompt/avatar take imagePath directly).
  E.genVideo = async function (k, idx, hooks) {
    hooks = hooks || {};
    const s = _sess(k);
    if (!s || !Array.isArray(s.cells) || !s.cells[idx]) return null;
    const cell = s.cells[idx];
    const ob = _obraz(k);
    const imgPath = (_hasMix(cell) ? cell.mixes[cell.detInfo.file] : null) || cell.imagePath || cell.charImagePath || (ob && ob.char);
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

    // kie.ai max-audio guard.
    if (schema && schema.maxAudioSec) {
      let sec = cell._audioSec || 0;
      if (!sec && cell.audioPath) {
        sec = await new Promise(res => { const a = new Audio(cell.audioPath); a.addEventListener('loadedmetadata', () => res(a.duration || 0), { once: true }); a.addEventListener('error', () => res(0), { once: true }); a.load(); });
        cell._audioSec = sec;
      }
      if (sec > schema.maxAudioSec) return failV('audio ' + sec.toFixed(1) + 's exceeds ' + schema.maxAudioSec + 's cap — use p-video-avatar or shorten');
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

    // Avatar (motion) prompt — 3 attempts, validate.
    let prompt = cell.avatarPrompt || defaultPrompt;
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
      delete cell.avatarTaskId; delete cell._videoPending;
      if (typeof saveEditState === 'function') saveEditState();
      if (hooks.onState) hooks.onState('done');
      return videoPath;
    } catch (e) {
      if (e && e.message === 'Cancelled') { delete cell._videoPending; if (typeof saveEditState === 'function') saveEditState(); if (hooks.onState) hooks.onState('error', 'Cancelled'); throw e; }
      return failV((e && e.message) || 'avatar failed');
    }
  };

  E.genAllVideos = async function (k, hooks) {
    hooks = hooks || {};
    const s = _sess(k);
    if (!s || !Array.isArray(s.cells)) { if (hooks.onDone) hooks.onDone(); return; }
    let excl = new Set(); try { const d = getTimelineData(); excl = new Set((d[k] && d[k].excludedSegments) || []); } catch {}
    const todo = [];
    s.cells.forEach((c, i) => { if (excl.has(i)) return; if (!c.audioPath) return; if (c.videoPath) return; todo.push(i); });
    if (hooks.onStart) hooks.onStart(todo.length);
    if (!todo.length) { if (hooks.onDone) hooks.onDone(); return; }
    _running[k] = true; _abort[k] = false;
    if (hooks.onRow) todo.forEach(i => hooks.onRow(i, 'queued'));
    let done = 0;
    try {
      for (const idx of todo) {
        if (_abort[k]) break;
        try { await E.genVideo(k, idx, { onState: (st, msg) => hooks.onRow && hooks.onRow(idx, st, msg) }); } catch {}
        done++; if (hooks.onProgress) hooks.onProgress(done, todo.length);
      }
    } finally { _running[k] = false; _abort[k] = false; if (hooks.onDone) hooks.onDone(); }
  };

  // Full pipeline: voices → mixes → videos. hooks:
  //   { onPhase(name), onRow(stage, idx, state, msg?), onProgress(stage, done, total), onDone() }
  E.genAll = async function (k, hooks) {
    hooks = hooks || {};
    const s = _sess(k);
    if (!s || !Array.isArray(s.cells)) { if (hooks.onDone) hooks.onDone(); return; }
    const exclOf = () => { try { const d = getTimelineData(); return new Set((d[k] && d[k].excludedSegments) || []); } catch { return new Set(); } };
    const seq = async (idxs, genOne, stage) => {
      if (hooks.onRow) idxs.forEach(i => hooks.onRow(stage, i, 'queued'));
      let done = 0;
      for (const idx of idxs) {
        if (_abort[k]) break;
        try { await genOne(k, idx, { onState: (st, msg) => hooks.onRow && hooks.onRow(stage, idx, st, msg) }); } catch {}
        done++; if (hooks.onProgress) hooks.onProgress(stage, done, idxs.length);
      }
    };
    _running[k] = true; _abort[k] = false;
    try {
      let ex = exclOf();
      const vlist = []; s.cells.forEach((c, i) => { if (ex.has(i)) return; if (c.videoPath || c.avatarTaskId || c._videoPending) return; if (c.audioPath) return; vlist.push(i); });
      if (vlist.length) { if (hooks.onPhase) hooks.onPhase('voices'); await seq(vlist, E.genVoice, 'voices'); }
      if (_abort[k]) return;
      ex = exclOf();
      const mlist = []; s.cells.forEach((c, i) => { if (ex.has(i)) return; if (!c.detInfo) return; if (c.videoPath) return; if (_hasMix(c)) return; mlist.push(i); });
      if (mlist.length) { if (hooks.onPhase) hooks.onPhase('mixes'); await seq(mlist, E.genMix, 'mixes'); }
      if (_abort[k]) return;
      ex = exclOf();
      const vidlist = []; s.cells.forEach((c, i) => { if (ex.has(i)) return; if (!c.audioPath) return; if (c.videoPath) return; vidlist.push(i); });
      if (vidlist.length) { if (hooks.onPhase) hooks.onPhase('videos'); await seq(vidlist, E.genVideo, 'videos'); }
    } finally { _running[k] = false; _abort[k] = false; if (hooks.onDone) hooks.onDone(); }
  };

  window.EDIT2Engine = E;
})();
