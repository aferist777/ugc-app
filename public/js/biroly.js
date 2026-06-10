/* ═══════════════════════════════════════════════════════════════════
   БИРОЛЫ TAB — user-defined spintax prompt slots.
   Spintax format: {option1|option2|option3}
   Also parses JS-style: {{ "a|b|c".split('|')[Math.floor(Math.random()*N)] }}
   Editing happens in a modal popup. Dropdowns in the main column.
   State persisted in localStorage.
   ═══════════════════════════════════════════════════════════════════ */

(function () {

  /* ── Random name pool for new categories ───────────────────────── */
  const ADJ  = ['Scarlet','Blue','Golden','Green','Silver','Purple','Amber','White','Dark','Bright','Wild','Swift','Lazy','Bold','Quiet','Fiery','Icy','Stormy','Light','Gloomy'];
  const ANIM = ['Tiger','Fox','Wolf','Bear','Eagle','Dolphin','Panther','Raccoon','Owl','Moose','Lynx','Jaguar','Crane','Cat','Lion','Crab','Shark','Horse','Snake','Deer'];
  function randomCatName() {
    return ADJ[Math.floor(Math.random() * ADJ.length)] + ' ' + ANIM[Math.floor(Math.random() * ANIM.length)];
  }

  const EMOJI_POOL = ['🎬','🎥','🌟','🎭','🎪','🎨','💡','🔥','⚡','🌊','🦋','🎯','💎','🌙','🎵','🍀','🦊','🐙','🌈','🎲'];

  const DEFAULT_CATS = [
    { id: 'hooks',   label: 'Hooks' },
    { id: 'science', label: 'Science' },
    { id: 'hands',   label: 'Hands' },
    { id: 'faces',   label: 'Faces' },
  ];

  /* ── State ──────────────────────────────────────────────────────── */
  let slots      = {};
  let categories = [];
  let selectedId   = null;
  let _pendingNewId = null; // id of a just-created slot not yet saved by user

  const LS_SLOTS = 'biroly_slots_v2';
  const LS_CATS  = 'biroly_cats';

  function loadState() {
    try {
      const rs = localStorage.getItem(LS_SLOTS);
      const rc = localStorage.getItem(LS_CATS);
      if (rs) slots = JSON.parse(rs);
      categories = rc ? JSON.parse(rc) : [...DEFAULT_CATS];
      if (!categories.length) categories = [...DEFAULT_CATS];
    } catch {
      slots = {}; categories = [...DEFAULT_CATS];
    }
    // Always persist so renderSessionBirolys (Склейка) can read the current order
    try { localStorage.setItem(LS_CATS, JSON.stringify(categories)); } catch {}
  }

  function saveState() {
    try {
      localStorage.setItem(LS_SLOTS, JSON.stringify(slots));
      localStorage.setItem(LS_CATS,  JSON.stringify(categories));
    } catch {}
  }

  /* ── Helpers ────────────────────────────────────────────────────── */
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  /* Convert JS-style spintax → simple {a|b|c} */
  function normalizeSpintax(text) {
    return text.replace(
      /\{\{\s*["']([^"']+)["']\.split\(['"][\|]['"][^)]*\)\[Math\.floor\(Math\.random\(\)\s*\*\s*\d+\)\]\s*\}\}/g,
      (_, options) => `{${options}}`
    );
  }

  /* Parse {a|b|c} groups → [{ options }] */
  function parseSpintax(text) {
    const groups = [];
    const re = /\{([^}]+)\}/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const options = m[1].split('|').map(s => s.trim()).filter(Boolean);
      if (options.length > 0) groups.push({ options });
    }
    return groups;
  }

  /* Build preview HTML: replace {a|b|c} with bolded selection */
  function buildPreviewHTML(slot) {
    if (!slot.prompt) return null;
    const groups = parseSpintax(slot.prompt);
    if (!groups.length) {
      return slot.prompt.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }
    let i = 0;
    return slot.prompt
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/\{([^}]+)\}/g, (_, inner) => {
        const options = inner.split('|').map(s => s.trim()).filter(Boolean);
        if (!options.length) return `{${inner}}`;
        const selIdx = (slot.selections && slot.selections[i] != null) ? slot.selections[i] : 0;
        const chosen = options[Math.min(selIdx, options.length - 1)];
        i++;
        return `<strong>${chosen}</strong>`;
      });
  }

  /* ── Gen state ─────────────────────────────────────────────────── */
  let birolEnhancedPrompt  = null; // enhanced prompt after realism button, null if not enhanced
  let _modalPromptTemplate = '';   // current prompt template inside the edit modal

  /* Resolve prompt with current selections */
  function resolvePromptCurrent(slot) {
    if (!slot.prompt) return '';
    let gIdx = 0;
    return slot.prompt.replace(/\{([^}]+)\}/g, (_, inner) => {
      const opts = inner.split('|').map(s => s.trim()).filter(Boolean);
      const sel  = (slot.selections && slot.selections[gIdx] != null) ? slot.selections[gIdx] : 0;
      gIdx++;
      return opts[Math.min(sel, opts.length - 1)] || opts[0] || '';
    });
  }

  /* Resolve prompt with random selections (updates slot.selections) */
  function resolvePromptRandom(slot) {
    const groups = parseSpintax(slot.prompt || '');
    slot.selections = groups.map(g => Math.floor(Math.random() * g.options.length));
    return resolvePromptCurrent(slot);
  }

  /* ── DOM refs ───────────────────────────────────────────────────── */
  // Collapsible state for biroly categories (Production → Birols tab).
  // In-memory only, no localStorage — every reload resets to "all collapsed".
  // During a session, the set survives re-renders so manually-opened categories
  // stay open until the user closes them or refreshes the page.
  const _openBirolyCats = new Set();

  const catListEl        = document.getElementById('biroly-category-list');
  const addRowBtn        = document.getElementById('biroly-add-row-btn');
  const previewEmptyEl   = document.getElementById('biroly-preview-empty');
  const promptOutputEl   = document.getElementById('biroly-prompt-output');
  const genAreaEl        = document.getElementById('biroly-gen-area');
  const genStatusEl      = document.getElementById('biroly-gen-status');
  const genImgEl         = document.getElementById('biroly-gen-img');
  const noSelEl          = document.getElementById('biroly-no-sel');
  const editorEl         = document.getElementById('biroly-editor');
  const slotHeaderEl     = document.getElementById('biroly-slot-header');
  const spintaxContainer = document.getElementById('biroly-spintax-controls');
  const editBtn          = document.getElementById('biroly-edit-btn');
  const deleteBtn        = document.getElementById('biroly-delete-btn');
  const genBtn           = document.getElementById('biroly-gen-btn');
  const genPlusBtn       = document.getElementById('biroly-gen-plus-btn');
  const realismRowEl     = document.getElementById('biroly-realism-row');
  const realismBtn       = document.getElementById('biroly-realism-btn');
  const realismResetBtn  = document.getElementById('biroly-realism-reset');
  const enhancedBadgeEl  = document.getElementById('biroly-enhanced-badge');
  // ── Engine + flow selection ────────────────────────────────────────────────
  // Selections persist to LS. Image engines are Replicate-only (we phase out
  // kie.ai from this tab). Flow controls whether stage-1 image gen runs at all:
  //   'i2v' — text → image → video (3 stages, image params apply)
  //   't2v' — text → video direct (skips image gen, uses /api/video/grok-text)
  const BIROLY_IMG_ENGINE_KEY = 'biroly_img_engine_v1';
  const BIROLY_VID_ENGINE_KEY = 'biroly_vid_engine_v1';
  const BIROLY_FLOW_KEY       = 'biroly_flow_v1';

  // Image engines available in biroly. Source of truth for the popup dropdown
  // + the badge labels. `caps` is used by the popup to fan-out the engines list
  // by selected flow (only image engines used in i2v stage; video engines
  // filtered by t2v vs i2v).
  const BIROLY_IMG_ENGINES = [
    { id: 'seedream',       label: 'Seedream 5 Lite' },
    { id: 'gptimage2',      label: 'GPT Image 2' },
    { id: 'nano-banana-2',  label: 'nano-banana-2' },
    { id: 'qwen2',          label: 'Qwen2' },
  ];
  const BIROLY_VID_ENGINES = [
    { id: 'grok-imagine/image-to-video', label: 'Grok Imagine', caps: ['i2v'] },
    { id: 'grok-imagine/text-to-video',  label: 'Grok Imagine', caps: ['t2v'] },
    { id: 'prunaai/p-video',             label: 'p-video',      caps: ['t2v', 'i2v'] },
  ];

  function getBirolyImgEngine() {
    const v = localStorage.getItem(BIROLY_IMG_ENGINE_KEY);
    return BIROLY_IMG_ENGINES.some(e => e.id === v) ? v : 'seedream';
  }
  function getBirolyVidEngine() {
    const v = localStorage.getItem(BIROLY_VID_ENGINE_KEY);
    return BIROLY_VID_ENGINES.some(e => e.id === v) ? v : 'grok-imagine/image-to-video';
  }
  function getBirolyFlow() {
    const v = localStorage.getItem(BIROLY_FLOW_KEY);
    return (v === 't2v' || v === 'i2v') ? v : 'i2v';
  }
  // Expose for _execBaseGen which is defined below.
  window.getBirolyFlow = getBirolyFlow;

  function _labelForEngine(id) {
    const im = BIROLY_IMG_ENGINES.find(e => e.id === id);
    if (im) return im.label;
    const vi = BIROLY_VID_ENGINES.find(e => e.id === id);
    if (vi) return vi.label + (vi.caps[0] === 't2v' ? ' · t2v' : ' · i2v');
    return id;
  }

  // ── Engines bar badge ──────────────────────────────────────────────────────
  const enginesBarBadge = document.getElementById('biroly-engines-badge');
  function _updateEnginesBadge() {
    if (!enginesBarBadge) return;
    const flow = getBirolyFlow();
    const vid  = getBirolyVidEngine();
    const img  = getBirolyImgEngine();
    const parts = [`🎬 ${_labelForEngine(vid)}`];
    if (flow === 'i2v') parts.push(`🖼 ${_labelForEngine(img)}`);
    enginesBarBadge.textContent = `${flow} · ` + parts.join(' · ');
  }
  _updateEnginesBadge();

  // ── Biroly engines popup ───────────────────────────────────────────────────
  // Combined Flow + Video + (conditional) Image selectors, each with their
  // params rendered inline via window.buildEngineSettingsRow(). Save persists
  // to server engineDefaults + mirrors to LS (engine_params__v1__<id>) so
  // existing biroly code that reads getEngineParams() picks up new values.
  const enginesBtn         = document.getElementById('biroly-engines-btn');
  const enginesStatusEl    = document.getElementById('biroly-engines-status');
  const flowSel            = document.getElementById('biroly-flow-sel');
  const vidEngSel          = document.getElementById('biroly-vid-engine-sel');
  const imgEngSel          = document.getElementById('biroly-img-engine-sel');
  const vidParamsHost      = document.getElementById('biroly-vid-params-host');
  const imgParamsHost      = document.getElementById('biroly-img-params-host');
  const imgEngineBlock     = document.getElementById('biroly-img-engine-block');

  // Currently-rendered rows (so Save / Reset can read them).
  let _vidRow = null; // { node, collect, refresh } from buildEngineSettingsRow
  let _imgRow = null;

  function _populateVidEngineOptions(flow) {
    if (!vidEngSel) return;
    const want = flow === 't2v' ? 't2v' : 'i2v';
    vidEngSel.innerHTML = '';
    BIROLY_VID_ENGINES.filter(e => e.caps.includes(want)).forEach(e => {
      const opt = document.createElement('option');
      opt.value = e.id;
      opt.textContent = `${e.label} — ${e.caps.join('+')}`;
      vidEngSel.appendChild(opt);
    });
    // Pick current if compatible, otherwise pick first
    const current = getBirolyVidEngine();
    if (vidEngSel.querySelector(`option[value="${current}"]`)) vidEngSel.value = current;
    else if (vidEngSel.options.length) {
      vidEngSel.value = vidEngSel.options[0].value;
      localStorage.setItem(BIROLY_VID_ENGINE_KEY, vidEngSel.value);
    }
  }

  function _populateImgEngineOptions() {
    if (!imgEngSel) return;
    imgEngSel.innerHTML = '';
    BIROLY_IMG_ENGINES.forEach(e => {
      const opt = document.createElement('option');
      opt.value = e.id;
      // Annotate capability so user understands which flow each model fits.
      const schema = window.ENGINE_SCHEMAS?.[e.id];
      const caps = schema?.capabilities?.length ? ` — ${schema.capabilities.join('+')}` : '';
      opt.textContent = `${e.label}${caps}`;
      imgEngSel.appendChild(opt);
    });
    imgEngSel.value = getBirolyImgEngine();
  }

  async function _renderEngineParams(engineId, host, refSetter) {
    if (!host) return;
    host.innerHTML = '';
    const saved = await (window.fetchEngineDefaults?.(engineId) || {});
    if (window.buildEngineSettingsRow) {
      const row = window.buildEngineSettingsRow(engineId, saved, null);
      host.appendChild(row.node);
      refSetter(row);
    }
  }

  async function _refreshVidParams() {
    await _renderEngineParams(vidEngSel.value, vidParamsHost, r => { _vidRow = r; });
  }
  async function _refreshImgParams() {
    await _renderEngineParams(imgEngSel.value, imgParamsHost, r => { _imgRow = r; });
  }

  function _applyFlowVisibility() {
    const flow = flowSel?.value || 'i2v';
    if (imgEngineBlock) imgEngineBlock.style.display = (flow === 'i2v') ? 'flex' : 'none';
  }

  async function _openEnginesPopup() {
    if (!flowSel) return;
    flowSel.value = getBirolyFlow();
    _populateVidEngineOptions(flowSel.value);
    _populateImgEngineOptions();
    _applyFlowVisibility();
    if (enginesStatusEl) enginesStatusEl.textContent = '';
    await _refreshVidParams();
    if (flowSel.value === 'i2v') await _refreshImgParams();
    window.openAppPopup?.('biroly-engines');
  }
  enginesBtn?.addEventListener('click', _openEnginesPopup);

  flowSel?.addEventListener('change', async () => {
    localStorage.setItem(BIROLY_FLOW_KEY, flowSel.value);
    _populateVidEngineOptions(flowSel.value);
    _applyFlowVisibility();
    await _refreshVidParams();
    if (flowSel.value === 'i2v') await _refreshImgParams();
    _updateEnginesBadge();
  });

  vidEngSel?.addEventListener('change', async () => {
    localStorage.setItem(BIROLY_VID_ENGINE_KEY, vidEngSel.value);
    await _refreshVidParams();
    _updateEnginesBadge();
  });
  imgEngSel?.addEventListener('change', async () => {
    localStorage.setItem(BIROLY_IMG_ENGINE_KEY, imgEngSel.value);
    await _refreshImgParams();
    _updateEnginesBadge();
  });

  document.getElementById('biroly-engines-save')?.addEventListener('click', async () => {
    if (enginesStatusEl) enginesStatusEl.textContent = 'Saving…';
    try {
      if (_vidRow) await window.saveEngineDefaults(vidEngSel.value, _vidRow.collect());
      if (_imgRow && flowSel.value === 'i2v') await window.saveEngineDefaults(imgEngSel.value, _imgRow.collect());
      if (enginesStatusEl) enginesStatusEl.textContent = '✅ Saved';
      setTimeout(() => { window.closeAppPopup?.(); }, 800);
    } catch (e) {
      if (enginesStatusEl) enginesStatusEl.textContent = '⚠ ' + e.message;
    }
  });

  document.getElementById('biroly-engines-reset')?.addEventListener('click', async () => {
    // Reset both engines currently visible in the popup.
    if (!confirm('Reset parameters for the selected engines?')) return;
    try {
      if (_vidRow) await window.clearEngineDefaults(vidEngSel.value);
      if (_imgRow && flowSel.value === 'i2v') await window.clearEngineDefaults(imgEngSel.value);
      await _refreshVidParams();
      if (flowSel.value === 'i2v') await _refreshImgParams();
      if (enginesStatusEl) {
        enginesStatusEl.textContent = '↺ Reset';
        setTimeout(() => { enginesStatusEl.textContent = ''; }, 1800);
      }
    } catch {}
  });

  /* ── Realism enhancement ────────────────────────────────────────── */
  function clearEnhanced() {
    birolEnhancedPrompt = null;
    promptOutputEl.classList.remove('realism-enhanced');
    if (enhancedBadgeEl)  enhancedBadgeEl.style.display  = 'none';
    if (realismResetBtn)  realismResetBtn.style.display   = 'none';
    if (realismBtn)       { realismBtn.textContent = '✨ Realism'; realismBtn.disabled = false; }
  }

  realismBtn?.addEventListener('click', async () => {
    if (!selectedId || !slots[selectedId]) return;
    const slot = slots[selectedId];
    const basePrompt = birolEnhancedPrompt || resolvePromptCurrent(slot);
    if (!basePrompt) return;

    realismBtn.textContent = '⏳ Enhancing…';
    realismBtn.disabled = true;

    try {
      const res = await fetch('/api/biroly/enhance-realism', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: basePrompt }),
      }).then(r => r.json());

      if (!res.success) throw new Error(res.error);

      birolEnhancedPrompt = res.prompt;
      promptOutputEl.innerHTML = birolEnhancedPrompt
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      promptOutputEl.style.display = 'block';
      promptOutputEl.classList.add('realism-enhanced');
      previewEmptyEl.style.display = 'none';
      if (enhancedBadgeEl)  enhancedBadgeEl.style.display  = 'block';
      if (realismResetBtn)  realismResetBtn.style.display   = 'inline-block';
      realismBtn.textContent = '✨ Again';
      realismBtn.disabled = false;
    } catch (e) {
      realismBtn.textContent = '✨ Realism';
      realismBtn.disabled = false;
      setStatus?.(`Realism: error — ${e.message}`);
    }
  });

  realismResetBtn?.addEventListener('click', () => {
    clearEnhanced();
    renderPreview();
  });

  /* ── Gen flow — parallel, background ───────────────────────────── */

  let _genCount = 0; // number of active concurrent generations

  /* Open the center gen-area (call at start of any gen) */
  function _genOpen() {
    _genCount++;
    previewEmptyEl.style.display = 'none';
    genAreaEl.style.display      = 'flex';
  }

  /* Called when a gen finishes (success or error) */
  function _genClose(finalStatus) {
    if (finalStatus !== undefined) genStatusEl.textContent = finalStatus;
    _genCount = Math.max(0, _genCount - 1);
    if (_genCount === 0) {
      setTimeout(() => {
        if (_genCount === 0) {
          genAreaEl.style.display = 'none';
          genImgEl.style.display  = 'none';
          genImgEl.src            = '';
          genStatusEl.textContent = '';
          renderPreview();
        }
      }, 2000);
    }
  }

  /* Promise-based poll wrappers */
  function _awaitImg(taskId) {
    return new Promise((res, rej) => pollImageStatus(taskId, res, e => rej(new Error(e))));
  }
  function _awaitVid(taskId) {
    return new Promise((res, rej) => pollVideoStatus(taskId, res, e => rej(new Error(e))));
  }
  function _awaitVidText(taskId) {
    return new Promise((res, rej) => pollVideoTextStatus(taskId, res, e => rej(new Error(e))));
  }
  function _awaitPVideo(taskId) {
    return new Promise((res, rej) => pollPVideoStatus(taskId, res, e => rej(new Error(e))));
  }

  // Build the params body for prunaai/p-video from the user-configured engine
  // params (whatever the gen-settings popup stored in engine_params LS).
  function _pVideoParamsFromVp(_vp) {
    return {
      duration:              Number(_vp.duration) || 5,
      aspect_ratio:          _vp.aspect_ratio   || '16:9',
      resolution:            _vp.resolution     || '720p',
      fps:                   Number(_vp.fps)    || 24,
      draft:                 !!_vp.draft,
      prompt_upsampling:     _vp.prompt_upsampling !== false,
      save_audio:            _vp.save_audio !== false,
      disable_safety_filter: _vp.disable_safety_filter !== false,
      seed:                  _vp.seed,
    };
  }
  async function _post(url, body, logCtx) {
    if (logCtx?.sid && window.GenLog) {
      return window.GenLog.fetchLog(logCtx.sid, logCtx.name || url.split('/').pop(), url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
    }
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('json')) throw new Error(`HTTP ${res.status} from ${url.split('/').pop()}`);
    return res.json();
  }

  function _st(t) { genStatusEl.textContent = t; }
  function _img(p) { genImgEl.src = p; genImgEl.style.display = 'block'; }

  function _createGenRow(label) {
    return window.createActivityRow?.(label) ||
      { setStatus:()=>{}, setImage:()=>{}, setVideo:()=>{}, finalize:()=>{}, setRetry:()=>{}, remove:()=>{} };
  }

  // ── Model-fallback helper: tries each { name, submit, poll } in order ─────────
  // submit() → taskId (throws on failure)
  // poll(taskId) → result (throws on failure)
  // Returns first successful result; throws last error if all fail.
  async function _genWithFallback(stageLabel, models, row, gs) {
    let lastErr;
    for (let i = 0; i < models.length; i++) {
      if (gs?.cancelled) throw Object.assign(new Error('Cancelled by user'), { cancelled: true });
      const { name, submit, poll } = models[i];
      const label = i === 0 ? stageLabel : `${stageLabel} ↪ ${name}…`;
      _st(label); row.setStatus(label);
      try {
        const taskId = await submit();
        if (gs?.cancelled) throw Object.assign(new Error('Cancelled by user'), { cancelled: true });
        return await poll(taskId);
      } catch (e) {
        if (e.cancelled || gs?.cancelled) throw e;
        lastErr = e;
        if (i < models.length - 1) {
          const warn = `⚠ ${name}: ${(e.message || 'error').slice(0, 55)} → trying ${models[i + 1].name}…`;
          _st(warn); row.setStatus(warn);
          await new Promise(r => setTimeout(r, 1500));
        }
      }
    }
    throw lastErr;
  }

  // ── Pending gen persistence ──────────────────────────────────────────────────
  const BIROLY_PENDING_KEY = 'biroly_pending_v1';
  function _getPendingGens()    { try { return JSON.parse(localStorage.getItem(BIROLY_PENDING_KEY) || '[]'); } catch { return []; } }
  function _savePendingGens(l)  { localStorage.setItem(BIROLY_PENDING_KEY, JSON.stringify(l)); }
  function _upsertPendingGen(g) { const l = _getPendingGens(); const i = l.findIndex(x => x.genId === g.genId); if (i >= 0) l[i] = g; else l.unshift(g); _savePendingGens(l); }
  function _removePendingGen(id){ _savePendingGens(_getPendingGens().filter(g => g.genId !== id)); }
  function _genUid()            { return Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }

  // ── Base pipeline (i2v): 3 stages ──────────────────────────────────────────
  // Stage 1: AI → image prompt for the first frame
  // Stage 2: image gen via selected Replicate engine → Seedream fallback
  // Stage 3: Grok image-to-video from the generated image + animation prompt
  //
  // When gs.flow === 't2v', stages 1 + 2 are skipped: the slot prompt goes
  // straight to Grok text-to-video.
  async function _execBaseGen(gs, row) {
    const _chkCancel = () => { if (gs.cancelled) throw Object.assign(new Error('Cancelled by user'), { cancelled: true }); };

    // ── t2v fast-path: prompt → video direct ──
    if (gs.flow === 't2v') {
      _chkCancel();
      // Pull params for the ACTUAL selected engine — used to hardcode
      // grok-text params here which exploded as 422 when user picked
      // p-video (resolution '480p' isn't in p-video's enum).
      const _vidEng = getBirolyVidEngine();
      const _isPVideo = (_vidEng === 'prunaai/p-video');
      const _vp = (typeof getEngineParams === 'function')
        ? (getEngineParams(_vidEng) || {})
        : {};
      let vidTaskId = (gs.stage === 'video' && gs.currentTaskId) ? gs.currentTaskId : null;
      let videoPath;
      if (vidTaskId) {
        const st = '🎬 1/1 — Resuming video…'; _st(st); row.setStatus(st);
        videoPath = await (_isPVideo ? _awaitPVideo(vidTaskId) : _awaitVidText(vidTaskId));
      } else {
        _st(`🎬 1/1 — Generating video (t2v · ${_vidEng.split('/').pop()})…`);
        row.setStatus(`🎬 1/1 — Generating video (t2v · ${_vidEng.split('/').pop()})…`);
        let vidRes;
        if (_isPVideo) {
          vidRes = await _post('/api/video/p-video',
            { prompt: gs.prompt, params: _pVideoParamsFromVp(_vp) },
            { sid: gs.logSid, name: '🎬 p-video t2v' });
        } else {
          vidRes = await _post('/api/video/grok-text',
            {
              prompt: gs.prompt,
              duration:    _vp.duration    || '6',
              resolution:  _vp.resolution  || '480p',
              aspectRatio: _vp.aspect_ratio || '9:16',
              mode:        _vp.mode        || 'normal',
            },
            { sid: gs.logSid, name: '🎬 Grok t2v' });
        }
        _chkCancel();
        if (!vidRes.success) throw new Error(vidRes.error || 't2v error');
        gs.stage = 'video'; gs.currentTaskId = vidRes.taskId;
        gs.vidStatusBase = _isPVideo ? '/api/video/p-video/status/' : '/api/video/grok-text/status/';
        gs.duration = Number(_vp.duration) || 6;
        _upsertPendingGen(gs);
        videoPath = await (_isPVideo ? _awaitPVideo(vidRes.taskId) : _awaitVidText(vidRes.taskId));
        _chkCancel();
      }
      row.setVideo(videoPath);
      _sessionVideos.push({ videoPath, thumbPath: null });
      _sessionVideoIdx = _sessionVideos.length - 1;
      _renderSessionGallery();
      updateBirolyEntry(gs.birolyId, { videoPath, status: 'done', duration: Number(_vp.duration) || 6 });
      _removePendingGen(gs.genId);
      renderBirolyStrip?.();
      row.finalize('✅ Saved to Birols');
      _genClose('✅ Saved to Birols');
      return;
    }

    // ── Stage 1: image prompt ──
    if (!gs.frame1Prompt) {
      _chkCancel();
      const st = '🧠 1/3 — Image prompt…'; _st(st); row.setStatus(st);
      const r = await _post('/api/biroly/analyze-for-first-frame', { animationPrompt: gs.prompt }, { sid: gs.logSid, name: '🧠 Image prompt' });
      _chkCancel();
      if (!r.success) throw new Error(r.error || 'Prompt analysis error');
      gs.frame1Prompt = r.framePrompt; gs.stage = 'frame1'; gs.currentTaskId = null;
      _upsertPendingGen(gs);
    }

    // ── Stage 2: generate image (selected engine → Seedream fallback) ──
    if (!gs.frame1Path) {
      _chkCancel();
      genImgEl.style.display = 'none';
      const p = gs.frame1Prompt;
      const imgEng = getBirolyImgEngine();
      const imgEngLabel = imgEng === 'gptimage2' ? 'GPT Image 2' : imgEng === 'qwen2' ? 'Qwen2' : imgEng === 'nano-banana-2' ? 'nano-banana-2' : 'Seedream';
      const imgModels = [
        { name: imgEngLabel,
          submit: async () => { const r = await _post('/api/biroly/gen-image', { prompt: p, imageEngine: imgEng, engineParams: getEngineParams?.(imgEng) || {} }, { sid: gs.logSid, name: `🖼 Image generation (${imgEngLabel})` }); if (!r.success) throw new Error(r.error || 'err'); return r.taskId; },
          poll: _awaitImg },
      ];
      if (imgEng !== 'seedream') {
        imgModels.push({ name: 'Seedream (fallback)',
          submit: async () => { const r = await _post('/api/biroly/gen-image', { prompt: p, imageEngine: 'seedream', engineParams: getEngineParams?.('seedream') || {} }, { sid: gs.logSid, name: '🖼 Image generation (Seedream fallback)' }); if (!r.success) throw new Error(r.error || 'err'); return r.taskId; },
          poll: _awaitImg });
      }
      const { imagePath: f1, thumbPath: tp1 } = await _genWithFallback('🖼 2/3 — Image', imgModels, row, gs);
      gs.frame1Path = f1; gs.thumbPath = tp1; gs.imagePath = f1;
      gs.stage = 'video'; gs.currentTaskId = null; _upsertPendingGen(gs);
      updateBirolyEntry(gs.birolyId, { imagePath: f1, thumbPath: tp1 });
      pushToGeni?.(f1, null, null);
    }
    _img(gs.frame1Path); row.setImage(gs.frame1Path);

    // ── Stage 3: i2v video (Grok i2v or prunaai/p-video depending on engine) ──
    _chkCancel();
    let vidTaskId = (gs.stage === 'video' && gs.currentTaskId) ? gs.currentTaskId : null;
    let videoPath;
    const _vidEng = getBirolyVidEngine();
    const _isPVideo = (_vidEng === 'prunaai/p-video');
    const _vp = getEngineParams?.(_vidEng) || {};
    if (vidTaskId) {
      const st = '🎬 3/3 — Resuming video…'; _st(st); row.setStatus(st);
      videoPath = await (_isPVideo ? _awaitPVideo(vidTaskId) : _awaitVid(vidTaskId));
    } else {
      _st(`🎬 3/3 — Generating video (${_vidEng.split('/').pop()})…`);
      row.setStatus(`🎬 3/3 — Generating video (${_vidEng.split('/').pop()})…`);
      const _upR = await _post('/api/upload-public', { imagePath: gs.frame1Path }, { sid: gs.logSid, name: '📤 Image upload' });
      if (!_upR.success) throw new Error(_upR.error || 'Image upload error');
      let vidRes;
      if (_isPVideo) {
        vidRes = await _post('/api/video/p-video',
          { prompt: gs.prompt, imageUrl: _upR.url, params: _pVideoParamsFromVp(_vp) },
          { sid: gs.logSid, name: '🎬 p-video i2v' });
      } else {
        vidRes = await _post('/api/video/grok',
          { imageUrl: _upR.url, prompt: gs.prompt, aspectRatio: _vp.aspect_ratio || '9:16', videoEngine: _vidEng, duration: _vp.duration || '6', resolution: _vp.resolution || '480p', mode: _vp.mode || 'normal' },
          { sid: gs.logSid, name: '🎬 Grok i2v' });
      }
      _chkCancel();
      if (!vidRes.success) throw new Error(vidRes.error || 'Video error');
      gs.stage = 'video'; gs.currentTaskId = vidRes.taskId;
      gs.vidStatusBase = _isPVideo ? '/api/video/p-video/status/' : '/api/video/grok/status/';
      gs.duration = Number(_vp.duration) || (_isPVideo ? 5 : 6);
      _upsertPendingGen(gs);
      videoPath = await (_isPVideo ? _awaitPVideo(vidRes.taskId) : _awaitVid(vidRes.taskId));
      _chkCancel();
    }
    row.setVideo(videoPath);
    _sessionVideos.push({ videoPath, thumbPath: gs.thumbPath || null });
    _sessionVideoIdx = _sessionVideos.length - 1;
    _renderSessionGallery();

    updateBirolyEntry(gs.birolyId, { videoPath, status: 'done', duration: Number(_vp.duration) || (_isPVideo ? 5 : 6) });
    _removePendingGen(gs.genId);
    renderBirolyStrip?.();
    row.finalize('✅ Saved to Birols');
    _genClose('✅ Saved to Birols');
  }

  // ── Plus pipeline (throws on error) ─────────────────────────────────────────
  async function _execPlusGen(gs, row) {
    const _chkCancel = () => { if (gs.cancelled) throw Object.assign(new Error('Cancelled by user'), { cancelled: true }); };
    if (!gs.img1done) {
      _chkCancel();
      const st1 = gs.currentTaskId ? '⏳ Resuming…' : '⏳ 1/4 — Generating image…';
      _st(st1); row.setStatus(st1);
      genImgEl.style.display = 'none';
      if (!gs.currentTaskId || gs.stage !== 'img1') {
        const r = await _post('/api/biroly/gen-image', { prompt: gs.prompt, imageEngine: getBirolyImgEngine(), engineParams: getEngineParams?.(getBirolyImgEngine()) || {} }, { sid: gs.logSid, name: '⏳ 1/4 Image generation' });
        _chkCancel();
        if (!r.success) throw new Error(r.error || 'Launch error');
        gs.stage = 'img1'; gs.currentTaskId = r.taskId; _upsertPendingGen(gs);
      }
      const { imagePath: ip1 } = await _awaitImg(gs.currentTaskId);
      _chkCancel();
      pushToGeni?.(ip1, null, null);
      gs.img1done = true; gs.stage = 'enhance'; gs.currentTaskId = null; _upsertPendingGen(gs);
    }

    if (!gs.enhancedPrompt) {
      _chkCancel();
      _st('✨ 2/4 — Enhancing prompt (realism)…'); row.setStatus('✨ 2/4 — Enhancing prompt (realism)…');
      const realRes = await _post('/api/biroly/enhance-realism', { prompt: gs.prompt }, { sid: gs.logSid, name: '✨ 2/4 Prompt enhancement' });
      _chkCancel();
      if (!realRes.success) throw new Error(realRes.error || 'Enhancement error');
      gs.enhancedPrompt = realRes.prompt; gs.stage = 'img2'; _upsertPendingGen(gs);
    }

    if (!gs.imagePath) {
      _chkCancel();
      const st3 = gs.currentTaskId ? '⏳ Resuming…' : '⏳ 3/4 — Generating enhanced image…';
      _st(st3); row.setStatus(st3);
      if (!gs.currentTaskId || gs.stage !== 'img2') {
        const r = await _post('/api/biroly/gen-image', { prompt: gs.enhancedPrompt, imageEngine: getBirolyImgEngine(), engineParams: getEngineParams?.(getBirolyImgEngine()) || {} }, { sid: gs.logSid, name: '⏳ 3/4 Enhanced image' });
        _chkCancel();
        if (!r.success) throw new Error(r.error || 'Launch error');
        gs.stage = 'img2'; gs.currentTaskId = r.taskId; _upsertPendingGen(gs);
      }
      const { imagePath: ip2, thumbPath: tp2 } = await _awaitImg(gs.currentTaskId);
      _chkCancel();
      gs.imagePath = ip2; gs.thumbPath = tp2; gs.stage = 'analyze'; gs.currentTaskId = null; _upsertPendingGen(gs);
      updateBirolyEntry(gs.birolyId, { imagePath: ip2, thumbPath: tp2 });
      pushToGeni?.(ip2, null, null);
    }
    _img(gs.imagePath); row.setImage(gs.imagePath);

    _chkCancel();
    let vidTaskId = (gs.stage === 'video' && gs.currentTaskId) ? gs.currentTaskId : null;
    const _vidEng2 = getBirolyVidEngine();
    const _isPVideo2 = (_vidEng2 === 'prunaai/p-video');
    const _vp2 = getEngineParams?.(_vidEng2) || {};
    if (!vidTaskId) {
      _st('📤 4/4 — Uploading image…'); row.setStatus('📤 4/4 — Uploading image…');
      const _upR2 = await _post('/api/upload-public', { imagePath: gs.imagePath }, { sid: gs.logSid, name: '📤 Image upload' });
      if (!_upR2.success) throw new Error(_upR2.error || 'Image upload error');
      _st('🔍 4/4 — Analyzing image…'); row.setStatus('🔍 4/4 — Analyzing image…');
      const analRes = await _post('/api/biroly/analyze-for-video', { imageUrl: _upR2.url }, { sid: gs.logSid, name: '🔍 4/4 Analysis for video' });
      _chkCancel();
      if (!analRes.success) throw new Error(analRes.error || 'Analysis error');
      _st(`🎬 4/4 — Generating video (${_vidEng2.split('/').pop()})…`);
      row.setStatus(`🎬 4/4 — Generating video (${_vidEng2.split('/').pop()})…`);
      let vidRes;
      if (_isPVideo2) {
        vidRes = await _post('/api/video/p-video',
          { prompt: analRes.prompt, imageUrl: _upR2.url, params: _pVideoParamsFromVp(_vp2) },
          { sid: gs.logSid, name: '🎬 4/4 p-video i2v' });
      } else {
        vidRes = await _post('/api/video/grok',
          { imageUrl: _upR2.url, prompt: analRes.prompt, aspectRatio: _vp2.aspect_ratio || '9:16', videoEngine: _vidEng2, duration: _vp2.duration || '6', resolution: _vp2.resolution || '480p', mode: _vp2.mode || 'normal' },
          { sid: gs.logSid, name: '🎬 4/4 Grok i2v' });
      }
      _chkCancel();
      if (!vidRes.success) throw new Error(vidRes.error || 'Video error');
      gs.stage = 'video'; gs.currentTaskId = vidRes.taskId; vidTaskId = vidRes.taskId;
      gs.vidStatusBase = _isPVideo2 ? '/api/video/p-video/status/' : '/api/video/grok/status/';
      gs.duration = Number(_vp2.duration) || (_isPVideo2 ? 5 : 6);
      _upsertPendingGen(gs);
    } else {
      _st('🎬 4/4 — Resuming video generation…'); row.setStatus('🎬 4/4 — Resuming video generation…');
    }
    const videoPath = await (_isPVideo2 ? _awaitPVideo(vidTaskId) : _awaitVid(vidTaskId));
    _chkCancel();
    row.setVideo(videoPath);
    _sessionVideos.push({ videoPath, thumbPath: gs.thumbPath || null });
    _sessionVideoIdx = _sessionVideos.length - 1;
    _renderSessionGallery();

    updateBirolyEntry(gs.birolyId, { videoPath, status: 'done', duration: Number(_vp2.duration) || (_isPVideo2 ? 5 : 6) });
    _removePendingGen(gs.genId);
    renderBirolyStrip?.();
    row.finalize('✅ Saved to Birols');
    _genClose('✅ Saved to Birols');
  }

  // ── Auto-retry wrapper: up to _MAX_RETRIES outer attempts, resumes from last checkpoint ──
  const _MAX_RETRIES = 5;
  async function _execWithRetry(gs) {
    const row = _createGenRow((gs.prompt || '').slice(0, 50) || 'Birols');
    row.setCancelCallback?.(() => {
      gs.cancelled = true;
      _removePendingGen(gs.genId);
      updateBirolyEntry?.(gs.birolyId, { status: 'error', errorMsg: 'Cancelled by user' });
      _genClose('❌ Cancelled');
    });
    for (let attempt = 1; attempt <= _MAX_RETRIES; attempt++) {
      try {
        if (gs.mode === 'plus') await _execPlusGen(gs, row);
        else await _execBaseGen(gs, row);
        window.GenLog?.finalize(gs.logSid, 'success');
        return;
      } catch (e) {
        if (gs.cancelled) { window.GenLog?.cancel(gs.logSid); return; }
        gs.currentTaskId = null; gs._vidIsGrok = false;
        _upsertPendingGen(gs);
        if (attempt < _MAX_RETRIES) {
          const delaySec = Math.min(attempt * 8, 30);
          const retryMsg = `⚠ Attempt ${attempt}/${_MAX_RETRIES}: ${(e.message || 'error').slice(0, 60)}. Retrying in ${delaySec}s…`;
          _st(retryMsg); row.setStatus(retryMsg);
          updateBirolyEntry(gs.birolyId, { status: 'generating' });
          await new Promise(r => setTimeout(r, delaySec * 1000));
        } else {
          const retryState = gs.mode === 'plus'
            ? { mode: 'plus', prompt: gs.prompt, imagePath: gs.imagePath || null, thumbPath: gs.thumbPath || null,
                stage: gs.stage === 'video' ? 'analyze' : gs.stage,
                enhancedPrompt: gs.enhancedPrompt || null, img1done: gs.img1done || false }
            : { mode: 'base', flow: gs.flow || 'i2v', prompt: gs.prompt,
                frame1Prompt: gs.frame1Prompt || null, frame1Path: gs.frame1Path || null,
                thumbPath: gs.thumbPath || null, imagePath: gs.imagePath || null,
                stage: gs.stage || 'frame1-prompt' };
          updateBirolyEntry(gs.birolyId, { status: 'error', errorMsg: e.message, retryState });
          _removePendingGen(gs.genId);
          row.setRetry(e.message.slice(0, 45), () => retryBirolyEntry(gs.birolyId));
          _genClose(`❌ ${e.message}`);
          window.GenLog?.finalize(gs.logSid, 'error');
        }
      }
    }
  }

  // ── Manual retry from database tab ───────────────────────────────────────────
  function retryBirolyEntry(birolyId) {
    const list = typeof getBirolyArchive === 'function' ? getBirolyArchive() : [];
    const entry = list.find(e => e.id === birolyId);
    if (!entry || !entry.retryState) return;
    const rs = entry.retryState;
    updateBirolyEntry(birolyId, { status: 'generating', retryState: null, errorMsg: null });
    const gs = {
      genId: _genUid(), mode: rs.mode || 'base', flow: rs.flow || 'i2v', birolyId,
      logSid: window.GenLog?.start('Birols', '🔄 Retry'),
      prompt: rs.prompt, imagePath: rs.imagePath || null, thumbPath: rs.thumbPath || null,
      stage: rs.stage || (rs.mode === 'plus' ? 'img1' : 'frame1-prompt'), currentTaskId: null,
      // Base pipeline fields
      frame1Prompt: rs.frame1Prompt || null, frame1Path: rs.frame1Path || null,
      // Plus pipeline fields
      enhancedPrompt: rs.enhancedPrompt || null, img1done: rs.img1done || false,
    };
    _upsertPendingGen(gs);
    _genOpen();
    _execWithRetry(gs);
  }
  window.retryBirolyEntry = retryBirolyEntry;

  // ── Public gen entry points ──────────────────────────────────────────────────

  /* ── Генерировать ── */
  function startBirolyGen() {
    if (!selectedId || !slots[selectedId]) return;
    const slot = slots[selectedId];
    // Use edited preview text if user modified it, otherwise use current spintax selections
    const editedText = promptOutputEl ? (promptOutputEl.innerText || '').trim() : '';
    const prompt = editedText || resolvePromptCurrent(slot);
    saveState();
    const catLabel = categories.find(c => c.id === slot.categoryId)?.label || '';
    const birolyId = addPendingBirolyEntry(slot.name || 'Birol', prompt, { categoryId: slot.categoryId || '', categoryLabel: catLabel, source: 'birols' });
    const flow = (typeof getBirolyFlow === 'function' ? getBirolyFlow() : 'i2v');
    // Base (i2v / t2v) generation now runs on the SERVER to completion: it keeps
    // going in the background across tab switches and even server restarts, and
    // the universal monitor (BirolyBgMonitor) applies the finished video to this
    // archive entry + toasts on whatever page the user is on.
    _startServerGen(birolyId, slot.name, prompt, flow, slot.categoryId || '', catLabel);
  }

  async function _startServerGen(birolyId, slotName, prompt, flow, categoryId, categoryLabel) {
    const imgEng = getBirolyImgEngine();
    const vidEng = getBirolyVidEngine();
    const vp = (typeof getEngineParams === 'function' ? getEngineParams(vidEng) : null) || {};
    const isP = vidEng === 'prunaai/p-video';
    const body = {
      birolyId, name: slotName || 'Birol', prompt, flow,
      imageEngine: imgEng, imageEngineParams: (typeof getEngineParams === 'function' ? getEngineParams(imgEng) : null) || {},
      videoEngine: vidEng,
      duration: vp.duration || '6', resolution: vp.resolution || '480p',
      aspectRatio: vp.aspect_ratio || '9:16', mode: vp.mode || 'normal',
      pVideoParams: isP ? _pVideoParamsFromVp(vp) : undefined,
      categoryId, categoryLabel, source: 'birols',
    };
    try {
      const r = await fetch('/api/biroly/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }).then(x => x.json());
      if (!r || !r.success) throw new Error((r && r.error) || 'generate failed');
      try { _st('🚀 Generating in background — you can leave this tab.'); } catch (e) {}
      try { renderBirolyStrip && renderBirolyStrip(); } catch (e) {}
      _pollServerJob(r.jobId, birolyId, slotName);
      try { window.BirolyBgMonitor?.kick?.(); } catch (e) {}
    } catch (e) {
      try { updateBirolyEntry(birolyId, { status: 'error', errorMsg: e.message }); } catch (er) {}
      try { _st('❌ ' + e.message); } catch (er) {}
    }
  }

  // Shared (with BirolyBgMonitor) "already handled" set, keyed by jobId, so the
  // on-page progress row and the cross-tab monitor never double-apply a result.
  const _BG_NOTIFIED_KEY = 'biroly_bg_notified_v1';
  function _bgNotified()      { try { return new Set(JSON.parse(localStorage.getItem(_BG_NOTIFIED_KEY) || '[]')); } catch { return new Set(); } }
  function _bgMarkNotified(id){ const s = _bgNotified(); s.add(id); try { localStorage.setItem(_BG_NOTIFIED_KEY, JSON.stringify(Array.from(s).slice(-60))); } catch {} }

  // On /birols: show a live progress row for a server gen job + apply the result
  // here (richer + faster feedback than the 20s cross-tab monitor).
  const _activeJobPolls = new Set();
  function _pollServerJob(jobId, birolyId, name) {
    if (!jobId || _activeJobPolls.has(jobId)) return;  // already polling this job
    _activeJobPolls.add(jobId);
    const row = (typeof window.createActivityRow === 'function') ? window.createActivityRow('Birol · ' + String(name || 'Birol').slice(0, 28)) : null;
    if (row) row.setStatus('⚙ Generating…');
    let tries = 0;
    const iv = setInterval(async () => {
      if (++tries > 150) { clearInterval(iv); _activeJobPolls.delete(jobId); if (row) row.remove(); return; }
      let d; try { d = await fetch('/api/biroly/generate/status/' + encodeURIComponent(jobId)).then(x => x.json()); } catch (e) { return; }
      if (!d || !d.success) return;
      if (d.status === 'done' && d.videoPath) {
        clearInterval(iv); _activeJobPolls.delete(jobId);
        if (_bgNotified().has(jobId)) { if (row) row.remove(); return; }
        _bgMarkNotified(jobId);
        try { updateBirolyEntry(birolyId, { videoPath: d.videoPath, thumbPath: d.thumbPath || null, status: 'done', duration: 6 }); } catch (e) {}
        try { renderBirolyStrip && renderBirolyStrip(); } catch (e) {}
        try { window.refreshTimelineBirolys && window.refreshTimelineBirolys(); } catch (e) {}
        try { if (row) { row.setVideo && row.setVideo(d.videoPath); row.finalize('✅ Birol ready'); } } catch (e) {}
        try { fetch('/api/biroly/generate/' + encodeURIComponent(jobId), { method: 'DELETE' }); } catch (e) {}
      } else if (d.status === 'error') {
        clearInterval(iv); _activeJobPolls.delete(jobId);
        if (_bgNotified().has(jobId)) { if (row) row.remove(); return; }
        _bgMarkNotified(jobId);
        try { updateBirolyEntry(birolyId, { status: 'error', errorMsg: d.error || 'generation failed' }); } catch (e) {}
        try { renderBirolyStrip && renderBirolyStrip(); } catch (e) {}
        try { if (row) row.finalize('❌ ' + String(d.error || 'failed').slice(0, 50)); } catch (e) {}
        try { fetch('/api/biroly/generate/' + encodeURIComponent(jobId), { method: 'DELETE' }); } catch (e) {}
      } else if (row) {
        const lbl = d.stage === 'frame-prompt' ? '🧠 image prompt' : d.stage === 'image' ? '🖼 image' : d.stage === 'video' ? '🎬 video' : (d.stage || 'generating');
        row.setStatus('⚙ ' + lbl + '…');
      }
    }, 4000);
  }

  /* ── Генерировать+ ── */
  function startBirolyGenPlus() {
    if (!selectedId || !slots[selectedId]) return;
    const slot = slots[selectedId];
    const prompt = resolvePromptCurrent(slot);
    saveState();
    const catLabel = categories.find(c => c.id === slot.categoryId)?.label || '';
    const birolyId = addPendingBirolyEntry(slot.name || 'Birol', prompt, { categoryId: slot.categoryId || '', categoryLabel: catLabel, source: 'birols' });
    const gs = { genId: _genUid(), mode: 'plus', birolyId, prompt, logSid: window.GenLog?.start('Birols', '▶ Generate+'), enhancedPrompt: null, img1done: false, imagePath: null, stage: 'img1', currentTaskId: null };
    _upsertPendingGen(gs);
    _genOpen();
    _execWithRetry(gs);
  }

  // ── Resume pending gens on startup ───────────────────────────────────────────
  function resumePendingBirolyGens() {
    const pending = _getPendingGens();
    if (!pending.length) return;
    pending.forEach(gs => {
      _genOpen();
      _execWithRetry(gs);
    });
  }

  /* Wire gen buttons */
  genBtn?.addEventListener('click',     startBirolyGen);
  genPlusBtn?.addEventListener('click', startBirolyGenPlus);

  /* Open image in lightbox on click */
  genImgEl?.addEventListener('click', () => {
    if (genImgEl.src) openLightbox?.(genImgEl.getAttribute('src'));
  });

  function setGenUI(phase, imagePath) {
    if (phase === null) {
      genAreaEl.style.display = 'none';
      genImgEl.style.display  = 'none';
      genImgEl.src            = '';
      genStatusEl.textContent = '';
    } else {
      previewEmptyEl.style.display = 'none';
      genAreaEl.style.display      = 'flex';
      if (imagePath) { genImgEl.src = imagePath; genImgEl.style.display = 'block'; }
    }
  }

  /* Poll /api/status/:taskId for image result */
  function pollImageStatus(taskId, onDone, onError) {
    let stopped = false;
    let ticks = 0;
    const maxTicks = 75; // 75 * 4s = 5 min
    const stop = () => { stopped = true; };
    const tick = async () => {
      if (stopped) return;
      if (++ticks > maxTicks) { onError('Timed out (5 min)'); return; }
      try {
        const d = await fetch(`/api/status/${encodeURIComponent(taskId)}`).then(r => r.json());
        if (d.state === 'success') { if (!stopped) onDone({ imagePath: d.imagePath, thumbPath: d.thumbPath || null }); }
        else if (d.state === 'failed') { if (!stopped) onError(d.error || 'Generation error'); }
        else if (!stopped) setTimeout(tick, 4000);
      } catch (e) { if (!stopped) onError(e.message); }
    };
    setTimeout(tick, 4000);
    return stop;
  }

  /* Poll /api/video/grok/status/:taskId for video result */
  function pollVideoStatus(taskId, onDone, onError) {
    let stopped = false;
    let ticks = 0;
    const maxTicks = 50; // 50 * 6s = 5 min
    const stop = () => { stopped = true; };
    const tick = async () => {
      if (stopped) return;
      if (++ticks > maxTicks) { onError('Timed out (5 min)'); return; }
      try {
        const d = await fetch(`/api/video/grok/status/${taskId}`).then(r => r.json());
        if (d.state === 'success') { if (!stopped) onDone(d.videoPath); }
        else if (d.state === 'failed') { if (!stopped) onError(d.error || 'Video error'); }
        else if (!stopped) setTimeout(tick, 6000);
      } catch (e) { if (!stopped) onError(e.message); }
    };
    setTimeout(tick, 6000);
    return stop;
  }

  /* Poll /api/video/p-video/status/:taskId for prunaai/p-video result */
  function pollPVideoStatus(taskId, onDone, onError) {
    let stopped = false;
    let ticks = 0;
    const maxTicks = 75; // 75 * 4s = 5 min
    const stop = () => { stopped = true; };
    const tick = async () => {
      if (stopped) return;
      if (++ticks > maxTicks) { onError('Timed out (5 min)'); return; }
      try {
        const d = await fetch(`/api/video/p-video/status/${encodeURIComponent(taskId)}`).then(r => r.json());
        if (d.state === 'success') { if (!stopped) onDone(d.videoPath); }
        else if (d.state === 'failed') { if (!stopped) onError(d.error || 'p-video error'); }
        else if (!stopped) setTimeout(tick, 4000);
      } catch (e) { if (!stopped) onError(e.message); }
    };
    setTimeout(tick, 4000);
    return stop;
  }

  /* Poll /api/video/grok-text/status/:taskId for text-to-video result */
  function pollVideoTextStatus(taskId, onDone, onError) {
    let stopped = false;
    let ticks = 0;
    const maxTicks = 50; // 50 * 6s = 5 min
    const stop = () => { stopped = true; };
    const tick = async () => {
      if (stopped) return;
      if (++ticks > maxTicks) { onError('Timed out (5 min)'); return; }
      try {
        const d = await fetch(`/api/video/grok-text/status/${taskId}`).then(r => r.json());
        if (d.state === 'success') { if (!stopped) onDone(d.videoPath); }
        else if (d.state === 'failed') { if (!stopped) onError(d.error || 't2v error'); }
        else if (!stopped) setTimeout(tick, 6000);
      } catch (e) { if (!stopped) onError(e.message); }
    };
    setTimeout(tick, 6000);
    return stop;
  }

  /* ── Modal ──────────────────────────────────────────────────────── */
  let modalOverlay = null;

  function createModal() {
    const overlay = document.createElement('div');
    overlay.id = 'biroly-modal-overlay';
    overlay.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:5000;align-items:center;justify-content:center;';

    const win = document.createElement('div');
    win.style.cssText = 'background:#c0c0c0;border:2px solid;border-color:#fff #808080 #808080 #fff;width:560px;max-width:94vw;max-height:88vh;display:flex;flex-direction:column;box-shadow:4px 4px 0 #000;';

    // Title bar
    const titleBar = document.createElement('div');
    titleBar.style.cssText = 'background:#000080;color:#fff;padding:4px 8px;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;user-select:none;';
    const titleText = document.createElement('span');
    titleText.id = 'biroly-modal-title';
    titleText.style.cssText = 'font-size:11px;font-weight:bold;';
    titleText.textContent = 'Edit';
    const closeX = document.createElement('button');
    closeX.textContent = '✕';
    closeX.style.cssText = 'background:none;border:none;color:#fff;cursor:pointer;font-size:12px;padding:0 2px;line-height:1;';
    closeX.addEventListener('click', closeModal);
    titleBar.appendChild(titleText);
    titleBar.appendChild(closeX);

    // Body
    const body = document.createElement('div');
    body.style.cssText = 'padding:12px;overflow-y:auto;flex:1;';

    // Name row
    const nameRow = document.createElement('div');
    nameRow.className = 'biroly-editor-row';
    const nameLabel = document.createElement('label');
    nameLabel.textContent = 'Name:';
    const nameInp = document.createElement('input');
    nameInp.type = 'text';
    nameInp.id = 'biroly-modal-name';
    nameInp.style.cssText = 'width:100%;font-size:11px;box-sizing:border-box;';
    nameRow.appendChild(nameLabel);
    nameRow.appendChild(nameInp);

    // ── Idea row + Variant button ──────────────────────────────────────────────
    const ideaRow = document.createElement('div');
    ideaRow.id = 'biroly-modal-idea-row';
    ideaRow.className = 'biroly-editor-row';

    const ideaLabel = document.createElement('label');
    ideaLabel.textContent = 'B-roll idea or a ready-made prompt:';
    ideaLabel.style.cssText = 'font-size:10px;font-weight:bold;display:block;margin-bottom:3px;';

    const ideaTa = document.createElement('textarea');
    ideaTa.id = 'biroly-modal-idea';
    ideaTa.rows = 3;
    ideaTa.placeholder = 'Variant — a short idea (AI will write a prompt with all groups).\nExtract — a ready-made prompt with your own {a|b|c} groups (if there are none, AI will add only the 5 mandatory ones).';
    ideaTa.style.cssText = 'width:100%;font-size:10px;font-family:inherit;resize:vertical;box-sizing:border-box;padding:4px;';

    const ideaActionRow = document.createElement('div');
    ideaActionRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-top:4px;';

    const variantBtn = document.createElement('button');
    variantBtn.id = 'biroly-modal-variant-btn';
    variantBtn.textContent = '✦ Variant';
    variantBtn.style.cssText = 'font-size:10px;padding:3px 12px;cursor:pointer;background:#000080;color:#fff;border:1px solid #000055;font-weight:bold;flex-shrink:0;';
    variantBtn.title = 'Generate a B-roll prompt with spintax';

    const variantStatus = document.createElement('span');
    variantStatus.style.cssText = 'font-size:9px;color:#555;flex:1;';

    // ── Prompt preview (shown after generation) ───────────────────────────────
    const promptPreview = document.createElement('div');
    promptPreview.id = 'biroly-modal-prompt-preview';
    promptPreview.style.cssText = 'display:none;margin-top:8px;padding:7px 8px;background:#f0f0f0;border:1px inset #808080;font-size:10px;line-height:1.65;font-family:inherit;word-break:break-word;max-height:160px;overflow-y:auto;';

    function _renderPromptPreview(promptText) {
      promptPreview.innerHTML = '';
      if (!promptText) { promptPreview.style.display = 'none'; return; }
      const re = /\{([^}]+)\}/g;
      let last = 0, m;
      while ((m = re.exec(promptText)) !== null) {
        if (m.index > last) {
          promptPreview.appendChild(document.createTextNode(promptText.slice(last, m.index)));
        }
        const badge = document.createElement('b');
        badge.style.cssText = 'color:#000080;background:#d8e4ff;border:1px solid #99b3ee;border-radius:3px;padding:0 3px;font-weight:bold;white-space:nowrap;';
        badge.textContent = '{' + m[1] + '}';
        promptPreview.appendChild(badge);
        last = m.index + m[0].length;
      }
      if (last < promptText.length) {
        promptPreview.appendChild(document.createTextNode(promptText.slice(last)));
      }
      promptPreview.style.display = 'block';
    }

    variantBtn.addEventListener('click', async () => {
      const idea = ideaTa.value.trim();
      if (!idea) { variantStatus.textContent = '⚠ Enter an idea'; variantStatus.style.color = '#a00'; return; }
      variantBtn.disabled = true;
      variantBtn.textContent = '⏳ Generating…';
      variantStatus.textContent = '';
      promptPreview.style.display = 'none';
      try {
        const r = await fetch('/api/biroly/gen-broll-prompt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idea }),
        });
        const d = await r.json();
        if (!d.success) throw new Error(d.error);
        _modalPromptTemplate = d.prompt;

        // Fill any missing group names from the first option of each spintax group
        const parsedGroups = parseSpintax(d.prompt);
        const aiNames = d.groupNames || [];
        const fullGroupNames = parsedGroups.map((g, i) => {
          if (aiNames[i] && aiNames[i].trim()) return aiNames[i].trim();
          // fallback: first 3 words of first option, capitalised
          const firstOpt = (g.options[0] || '').trim().split(/\s+/).slice(0, 3).join(' ');
          return firstOpt ? firstOpt.charAt(0).toUpperCase() + firstOpt.slice(1) : `Group ${i + 1}`;
        });

        if (selectedId && slots[selectedId]) {
          slots[selectedId].groupNames = fullGroupNames;
        }
        _renderPromptPreview(d.prompt);
        renderModalGroups(d.prompt, { groupNames: fullGroupNames });
        variantStatus.textContent = '✓ Done — edit the options and save';
        variantStatus.style.color = '#007700';
      } catch (e) {
        variantStatus.textContent = '⚠ ' + e.message;
        variantStatus.style.color = '#a00000';
      } finally {
        variantBtn.disabled = false;
        variantBtn.textContent = '✦ Variant';
      }
    });

    // ── Extract button — same input field, parses user spintaxes locally;
    // if no spintax groups present, calls AI agent to inject ONLY the 5
    // mandatory categories (Camera & Optics, Angle & Shot Type, Camera Movement,
    // Lighting & Atmosphere, Shot Scale) into the user text.
    const extractBtn = document.createElement('button');
    extractBtn.id = 'biroly-modal-extract-btn';
    extractBtn.textContent = '✂ Extract';
    extractBtn.style.cssText = 'font-size:10px;padding:3px 12px;cursor:pointer;background:#4a8a4a;color:#fff;border:1px solid #2a6a2a;font-weight:bold;flex-shrink:0;';
    extractBtn.title = 'Parse the pasted prompt with spintax (if there is no spintax, AI will add only the 5 mandatory groups)';

    extractBtn.addEventListener('click', async () => {
      const userText = ideaTa.value.trim();
      if (!userText) { variantStatus.textContent = '⚠ Paste a prompt in the field above'; variantStatus.style.color = '#a00'; return; }

      const localGroups = parseSpintax(userText);
      const hasSpintax  = localGroups.length > 0;

      extractBtn.disabled = true;
      variantBtn.disabled = true;
      variantStatus.textContent = '';
      promptPreview.style.display = 'none';

      try {
        let promptOut, groupNamesOut;

        if (hasSpintax) {
          // Local mode — no AI call. Auto-name groups from first option of each.
          extractBtn.textContent = '⏳ Parsing…';
          promptOut = userText;
          groupNamesOut = localGroups.map((g, i) => {
            const firstOpt = (g.options[0] || '').trim().split(/\s+/).slice(0, 3).join(' ');
            return firstOpt ? firstOpt.charAt(0).toUpperCase() + firstOpt.slice(1) : `Group ${i + 1}`;
          });
          variantStatus.textContent = `✓ Found ${localGroups.length} groups — edit and save`;
          variantStatus.style.color = '#007700';
        } else {
          // No spintax in text → AI fallback: inject only the 5 mandatory groups.
          extractBtn.textContent = '⏳ AI is adding 5 groups…';
          const r = await fetch('/api/biroly/extract-mandatory', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: userText }),
          });
          const d = await r.json();
          if (!d.success) throw new Error(d.error || 'AI fallback failed');
          promptOut = d.prompt;
          groupNamesOut = d.groupNames || [];
          variantStatus.textContent = '✓ AI added the 5 mandatory groups — edit and save';
          variantStatus.style.color = '#007700';
        }

        _modalPromptTemplate = promptOut;

        // Backfill any missing names from the first-option fallback
        const parsedGroups = parseSpintax(promptOut);
        const fullGroupNames = parsedGroups.map((g, i) => {
          if (groupNamesOut[i] && groupNamesOut[i].trim()) return groupNamesOut[i].trim();
          const firstOpt = (g.options[0] || '').trim().split(/\s+/).slice(0, 3).join(' ');
          return firstOpt ? firstOpt.charAt(0).toUpperCase() + firstOpt.slice(1) : `Group ${i + 1}`;
        });

        if (selectedId && slots[selectedId]) {
          slots[selectedId].groupNames = fullGroupNames;
        }
        _renderPromptPreview(promptOut);
        renderModalGroups(promptOut, { groupNames: fullGroupNames });
      } catch (e) {
        variantStatus.textContent = '⚠ ' + e.message;
        variantStatus.style.color = '#a00000';
      } finally {
        extractBtn.disabled = false;
        variantBtn.disabled = false;
        extractBtn.textContent = '✂ Extract';
      }
    });

    ideaActionRow.appendChild(variantBtn);
    ideaActionRow.appendChild(extractBtn);
    ideaActionRow.appendChild(variantStatus);
    ideaRow.appendChild(ideaLabel);
    ideaRow.appendChild(ideaTa);
    ideaRow.appendChild(ideaActionRow);
    ideaRow.appendChild(promptPreview);


    // Groups editor section
    const groupsSection = document.createElement('div');
    groupsSection.id = 'biroly-modal-spintax';
    groupsSection.style.cssText = 'margin-top:8px;';

    // Actions
    const actions = document.createElement('div');
    actions.className = 'biroly-editor-actions';
    actions.style.cssText = 'margin-top:10px;';
    const modalSaveBtn = document.createElement('button');
    modalSaveBtn.textContent = '💾 Save';
    modalSaveBtn.style.cssText = 'flex:1;font-size:10px;';
    modalSaveBtn.addEventListener('click', () => saveFromModal());
    const modalCancelBtn = document.createElement('button');
    modalCancelBtn.textContent = 'Cancel';
    modalCancelBtn.style.cssText = 'flex:1;font-size:10px;';
    modalCancelBtn.addEventListener('click', closeModal);
    actions.appendChild(modalSaveBtn);
    actions.appendChild(modalCancelBtn);

    // ── AI-Edit row — VERY TOP: user describes changes → AI applies them ─────────
    const aiEditRow = document.createElement('div');
    aiEditRow.id = 'biroly-modal-ai-edit-row';
    aiEditRow.style.cssText = 'margin-bottom:10px;padding-bottom:10px;border-bottom:2px solid #808080;';

    const aiEditLbl = document.createElement('div');
    aiEditLbl.style.cssText = 'font-size:10px;font-weight:bold;color:#000080;margin-bottom:3px;';
    aiEditLbl.textContent = '✏ What to change in the prompt:';

    const aiEditTa = document.createElement('textarea');
    aiEditTa.id = 'biroly-modal-ai-edit';
    aiEditTa.rows = 2;
    aiEditTa.placeholder = 'For example: add more variety to the camera movements, remove mentions of the office, make it more dynamic…';
    aiEditTa.style.cssText = 'width:100%;font-size:10px;font-family:inherit;resize:vertical;box-sizing:border-box;padding:4px;margin-bottom:4px;';

    const aiEditActionRow = document.createElement('div');
    aiEditActionRow.style.cssText = 'display:flex;align-items:center;gap:6px;';

    const aiApplyBtn = document.createElement('button');
    aiApplyBtn.textContent = '⚡ Apply';
    aiApplyBtn.style.cssText = 'font-size:10px;padding:3px 12px;cursor:pointer;background:#6040a0;color:#fff;border:1px solid #402080;font-weight:bold;flex-shrink:0;';
    aiApplyBtn.title = 'Send the current prompt for AI editing with your changes';

    const aiEditStatus = document.createElement('span');
    aiEditStatus.style.cssText = 'font-size:9px;color:#555;flex:1;';

    aiApplyBtn.addEventListener('click', async () => {
      const request = aiEditTa.value.trim();
      if (!request) {
        aiEditStatus.textContent = '⚠ Enter a description of the changes';
        aiEditStatus.style.color = '#a00'; return;
      }
      const curPrompt = _modalPromptTemplate;
      if (!curPrompt) {
        aiEditStatus.textContent = '⚠ Prompt is empty — create one first via Variant or analysis';
        aiEditStatus.style.color = '#a00'; return;
      }
      aiApplyBtn.disabled = true;
      aiApplyBtn.textContent = '⏳ Applying…';
      aiEditStatus.textContent = '';
      try {
        const r = await fetch('/api/biroly/apply-edit', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ currentPrompt: curPrompt, userRequest: request }),
        });
        const d = await r.json();
        if (!d.success) throw new Error(d.error);
        _modalPromptTemplate = d.newPrompt;
        _renderPromptPreview(d.newPrompt);
        const slot = selectedId && slots[selectedId] ? slots[selectedId] : {};
        renderModalGroups(d.newPrompt, slot);
        aiEditTa.value = '';
        aiEditStatus.textContent = '✓ Done — review and save';
        aiEditStatus.style.color = '#007700';
      } catch (e) {
        aiEditStatus.textContent = '⚠ ' + e.message;
        aiEditStatus.style.color = '#a00000';
      } finally {
        aiApplyBtn.disabled = false;
        aiApplyBtn.textContent = '⚡ Apply';
      }
    });

    aiEditActionRow.appendChild(aiApplyBtn);
    aiEditActionRow.appendChild(aiEditStatus);
    aiEditRow.appendChild(aiEditLbl);
    aiEditRow.appendChild(aiEditTa);
    aiEditRow.appendChild(aiEditActionRow);

    body.appendChild(aiEditRow);
    body.appendChild(nameRow);
    body.appendChild(ideaRow);
    body.appendChild(groupsSection);
    body.appendChild(actions);
    win.appendChild(titleBar);
    win.appendChild(body);
    overlay.appendChild(win);

    win.addEventListener('mousedown', e => e.stopPropagation());
    win.addEventListener('click',     e => e.stopPropagation());
    overlay.addEventListener('mousedown', e => { if (e.target === overlay) closeModal(); });
    document.body.appendChild(overlay);
    modalOverlay = overlay;
  }

  function openModal(slotId, isNew = false) {
    if (!modalOverlay) createModal();
    if (!slotId || !slots[slotId]) return;
    const slot = slots[slotId];

    document.getElementById('biroly-modal-title').textContent = isNew
      ? `New slot: ${slot.name || 'Slot'}`
      : `Edit: ${slot.name || 'Slot'}`;
    document.getElementById('biroly-modal-name').value = slot.name || '';
    _modalPromptTemplate = slot.prompt || '';

    // Show idea row only when adding a new slot
    const ideaRowEl = document.getElementById('biroly-modal-idea-row');
    if (ideaRowEl) ideaRowEl.style.display = isNew ? '' : 'none';

    // Hide AI-edit row when creating a new slot (nothing to edit yet)
    const aiEditRowEl = document.getElementById('biroly-modal-ai-edit-row');
    if (aiEditRowEl) aiEditRowEl.style.display = isNew ? 'none' : '';

    // Clear idea field and status on re-open
    const ideaEl = document.getElementById('biroly-modal-idea');
    if (ideaEl) ideaEl.value = '';
    const variantStatusEl = modalOverlay?.querySelector('#biroly-modal-variant-btn + span');
    if (variantStatusEl) variantStatusEl.textContent = '';

    // Show existing prompt preview if slot already has one
    const previewEl = document.getElementById('biroly-modal-prompt-preview');
    if (previewEl) {
      if (slot.prompt) {
        previewEl.innerHTML = '';
        const re = /\{([^}]+)\}/g;
        let last = 0, m, txt = slot.prompt;
        while ((m = re.exec(txt)) !== null) {
          if (m.index > last) previewEl.appendChild(document.createTextNode(txt.slice(last, m.index)));
          const b = document.createElement('b');
          b.style.cssText = 'color:#000080;background:#d8e4ff;border:1px solid #99b3ee;border-radius:3px;padding:0 3px;font-weight:bold;white-space:nowrap;';
          b.textContent = '{' + m[1] + '}';
          previewEl.appendChild(b);
          last = m.index + m[0].length;
        }
        if (last < txt.length) previewEl.appendChild(document.createTextNode(txt.slice(last)));
        previewEl.style.display = 'block';
      } else {
        previewEl.style.display = 'none';
      }
    }

    renderModalGroups(slot.prompt || '', slot);
    modalOverlay.style.display = 'flex';
  }

  function closeModal() {
    if (modalOverlay) modalOverlay.style.display = 'none';
    if (_pendingNewId) {
      delete slots[_pendingNewId];
      if (selectedId === _pendingNewId) selectedId = null;
      _pendingNewId = null;
      render();
    }
  }

  /* Render editable group boxes in the modal */
  function renderModalGroups(promptText, slot) {
    const container = document.getElementById('biroly-modal-spintax');
    if (!container) return;
    container.innerHTML = '';

    const groups = parseSpintax(promptText);
    if (!groups.length) return;

    const hdr = document.createElement('div');
    hdr.style.cssText = 'font-size:10px;font-weight:bold;color:#444;margin-bottom:6px;border-top:1px solid #808080;padding-top:8px;';
    hdr.textContent = `Spintax groups (${groups.length}):`;
    container.appendChild(hdr);

    groups.forEach(({ options }, groupIdx) => {
      const box = document.createElement('div');
      box.className = 'biroly-modal-group-box';
      box.style.cssText = 'border:1px solid #808080;padding:6px 8px;margin-bottom:8px;background:#d4d0c8;';

      // Group header: number + editable name
      const groupHdr = document.createElement('div');
      groupHdr.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:6px;';

      const groupNum = document.createElement('span');
      groupNum.style.cssText = 'font-size:10px;font-weight:bold;color:#444;flex-shrink:0;';
      const assignedName = slot.groupNames && slot.groupNames[groupIdx];
      groupNum.textContent = assignedName ? `${groupIdx + 1}. ${assignedName}` : `Group ${groupIdx + 1}`;

      const nameInp = document.createElement('input');
      nameInp.type = 'text';
      nameInp.className = 'biroly-modal-group-name';
      nameInp.placeholder = `Group ${groupIdx + 1} name`;
      nameInp.value = (slot.groupNames && slot.groupNames[groupIdx]) || '';
      nameInp.style.cssText = 'flex:1;font-size:10px;padding:1px 4px;';

      groupHdr.appendChild(groupNum);
      groupHdr.appendChild(nameInp);
      box.appendChild(groupHdr);

      // Options list
      const optList = document.createElement('div');
      optList.className = 'biroly-modal-opt-list';
      optList.style.cssText = 'display:flex;flex-direction:column;gap:3px;margin-bottom:5px;';

      options.forEach(opt => appendOptionRow(optList, opt));
      box.appendChild(optList);

      appendNewVarRow(box, optList);

      container.appendChild(box);
    });
  }

  /* Append a single editable option row to optList (• text [✕ delete]) */
  function appendOptionRow(optList, value) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:4px;margin-bottom:1px;';

    const bullet = document.createElement('span');
    bullet.textContent = '•';
    bullet.style.cssText = 'font-size:10px;color:#666;flex-shrink:0;';

    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'biroly-modal-opt-input';
    inp.value = value;
    inp.style.cssText = 'flex:1;font-size:10px;padding:1px 4px;';

    const delBtn = document.createElement('button');
    delBtn.textContent = '✕';
    delBtn.title = 'Delete option';
    delBtn.style.cssText = 'font-size:9px;padding:0 4px;cursor:pointer;color:#a00;flex-shrink:0;border:none;background:transparent;';
    delBtn.addEventListener('click', () => row.remove());

    row.appendChild(bullet);
    row.appendChild(inp);
    row.appendChild(delBtn);
    optList.appendChild(row);
  }

  /* Append new-variant input row at bottom of group: [input] [mode] [ген] [✓] */
  function appendNewVarRow(box, optList) {
    const sep = document.createElement('div');
    sep.style.cssText = 'border-top:1px dashed #999;margin:5px 0 4px;';
    box.appendChild(sep);

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:4px;';

    const newInp = document.createElement('input');
    newInp.type = 'text';
    newInp.className = 'biroly-modal-new-opt-input';
    newInp.placeholder = 'New option…';
    newInp.style.cssText = 'flex:1;font-size:10px;padding:1px 4px;';

    const modeSel = document.createElement('select');
    modeSel.style.cssText = 'font-size:9px;padding:1px 2px;flex-shrink:0;cursor:pointer;';
    modeSel.title = 'Generation mode';
    [['friend', 'similar'], ['expand', 'wider+var']].forEach(([val, label]) => {
      const o = document.createElement('option');
      o.value = val;
      o.textContent = label;
      modeSel.appendChild(o);
    });
    modeSel.value = 'friend';

    const genBtn = document.createElement('button');
    genBtn.textContent = 'gen';
    genBtn.title = 'Generate an option (empty → new based on examples; with text → improve/expand)';
    genBtn.style.cssText = 'font-size:9px;padding:1px 6px;cursor:pointer;flex-shrink:0;background:#000080;color:#fff;border:1px solid #000055;';
    genBtn.addEventListener('click', async () => {
      const text = newInp.value.trim();
      const existingVariants = [...optList.querySelectorAll('.biroly-modal-opt-input')]
        .map(i => i.value.trim()).filter(Boolean);

      genBtn.disabled = true;
      genBtn.textContent = '⏳';
      try {
        const r = await fetch('/api/biroly/gen-variant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            variant: text || null,
            existingVariants,
            mode: text ? modeSel.value : 'new',
          }),
        });
        const d = await r.json();
        if (!d.success) throw new Error(d.error);
        newInp.value = d.text;
        newInp.focus();
      } catch (e) {
        genBtn.style.background = '#a00';
        setTimeout(() => { genBtn.style.background = '#000080'; }, 2000);
      } finally {
        genBtn.disabled = false;
        if (genBtn.textContent === '⏳') genBtn.textContent = 'gen';
      }
    });

    const saveBtn = document.createElement('button');
    saveBtn.textContent = '✓';
    saveBtn.title = 'Save option';
    saveBtn.style.cssText = 'font-size:11px;padding:0 6px;cursor:pointer;flex-shrink:0;background:#006600;color:#fff;border:1px solid #004400;font-weight:bold;line-height:1.4;';
    saveBtn.addEventListener('click', () => {
      const text = newInp.value.trim();
      if (!text) return;
      appendOptionRow(optList, text);
      newInp.value = '';
      newInp.focus();
    });

    // Enter key in new input = save
    newInp.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); saveBtn.click(); }
    });

    row.appendChild(newInp);
    row.appendChild(modeSel);
    row.appendChild(genBtn);
    row.appendChild(saveBtn);
    box.appendChild(row);
  }

  function saveFromModal() {
    if (!selectedId || !slots[selectedId]) return;
    _pendingNewId = null;
    const slot = slots[selectedId];

    const newName    = (document.getElementById('biroly-modal-name')?.value || '').trim() || 'Slot';
    const basePrompt = normalizeSpintax(_modalPromptTemplate || '');

    // Read group names and options from group editor UI
    const container = document.getElementById('biroly-modal-spintax');
    const groupBoxes = container ? [...container.querySelectorAll('.biroly-modal-group-box')] : [];

    const newGroupNames   = groupBoxes.map(box =>
      (box.querySelector('.biroly-modal-group-name')?.value || '').trim()
    );
    const newGroupOptions = groupBoxes.map(box =>
      [...box.querySelectorAll('.biroly-modal-opt-input')]
        .map(i => i.value.trim()).filter(Boolean)
    );

    // Rebuild prompt: replace each {group} in basePrompt with new options
    let gIdx = 0;
    const newPrompt = basePrompt.replace(/\{([^}]+)\}/g, () => {
      const opts = newGroupOptions[gIdx] || [];
      gIdx++;
      return opts.length ? `{${opts.join('|')}}` : '';
    });

    // Update selections: clamp to new option counts, reset if group count changed
    const newGroups = parseSpintax(newPrompt);
    const oldCount  = parseSpintax(slot.prompt || '').length;
    if (newGroups.length !== oldCount) {
      slot.selections = new Array(newGroups.length).fill(0);
    } else {
      slot.selections = newGroups.map((g, i) => {
        const prev = slot.selections?.[i] ?? 0;
        return Math.min(prev, g.options.length - 1);
      });
    }

    slot.name       = newName;
    slot.prompt     = newPrompt;
    slot.groupNames = newGroupNames;

    // Update textarea + title bar
    const ta = document.getElementById('biroly-modal-prompt');
    if (ta) ta.value = newPrompt;
    document.getElementById('biroly-modal-title').textContent = `Edit: ${newName}`;

    // Rebuild modal groups with updated data
    renderModalGroups(newPrompt, slot);

    saveState();
    render();
  }

  /* ── Render: left column categories ────────────────────────────── */
  function renderCategories() {
    catListEl.innerHTML = '';
    let _dragSrcIdx = null;

    categories.forEach((cat, catIdx) => {
      const catDiv = document.createElement('div');
      catDiv.className = 'biroly-cat';
      const isOpen = _openBirolyCats.has(cat.id);
      if (!isOpen) catDiv.classList.add('collapsed');

      // Drag-over highlight
      catDiv.addEventListener('dragover', e => {
        if (_dragSrcIdx === null || _dragSrcIdx === catIdx) return;
        e.preventDefault();
        catDiv.classList.add('drag-over');
      });
      catDiv.addEventListener('dragleave', () => catDiv.classList.remove('drag-over'));
      catDiv.addEventListener('drop', e => {
        e.preventDefault();
        catDiv.classList.remove('drag-over');
        if (_dragSrcIdx === null || _dragSrcIdx === catIdx) return;
        const moved    = categories.splice(_dragSrcIdx, 1)[0];
        let insertAt   = catIdx;
        if (_dragSrcIdx < catIdx) insertAt--;
        categories.splice(insertAt, 0, moved);
        _dragSrcIdx = null;
        saveState();
        renderCategories();
      });

      const headerDiv = document.createElement('div');
      headerDiv.className = 'biroly-cat-header';
      // Click anywhere on the header (except drag handle / rename / chevron itself)
      // toggles the category open/closed.
      headerDiv.addEventListener('click', e => {
        if (e.target.closest('.biroly-cat-rename-btn') || e.target.closest('.biroly-cat-drag-handle')) return;
        if (_openBirolyCats.has(cat.id)) _openBirolyCats.delete(cat.id);
        else _openBirolyCats.add(cat.id);
        renderCategories();
      });

      // Chevron (left) — visually mirrors the open state
      const chevronSpan = document.createElement('span');
      chevronSpan.className = 'biroly-cat-chevron';
      chevronSpan.textContent = isOpen ? '▼' : '▶';

      // Drag handle
      const dragHandle = document.createElement('span');
      dragHandle.className = 'biroly-cat-drag-handle';
      dragHandle.textContent = '⠿';
      dragHandle.title = 'Drag to reorder';
      dragHandle.draggable = true;
      dragHandle.addEventListener('dragstart', e => {
        _dragSrcIdx = catIdx;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(catIdx));
        setTimeout(() => catDiv.style.opacity = '0.5', 0);
      });
      dragHandle.addEventListener('dragend', () => {
        catDiv.style.opacity = '';
        _dragSrcIdx = null;
        document.querySelectorAll('.biroly-cat.drag-over').forEach(el => el.classList.remove('drag-over'));
      });
      headerDiv.appendChild(dragHandle);

      const titleSpan = document.createElement('span');
      titleSpan.className = 'biroly-cat-title-text';
      titleSpan.textContent = cat.label;

      const renameBtn = document.createElement('button');
      renameBtn.className = 'biroly-cat-rename-btn';
      renameBtn.textContent = '✏';
      renameBtn.title = 'Edit category';
      renameBtn.addEventListener('click', e => {
        e.stopPropagation();  // don't toggle collapse
        _openCatEditPopup(cat);
      });

      // Header order: chevron · drag handle · title · rename
      // (delete moved to edit popup titlebar — pencil button below)
      headerDiv.insertBefore(chevronSpan, dragHandle);
      headerDiv.appendChild(titleSpan);
      headerDiv.appendChild(renameBtn);
      catDiv.appendChild(headerDiv);

      // Body wraps everything that hides on collapse
      const bodyDiv = document.createElement('div');
      bodyDiv.className = 'biroly-cat-body';

      // Thin full-width "+ Add slot" button at the top of the body
      const addBtn = document.createElement('button');
      addBtn.className = 'biroly-add-btn';
      addBtn.textContent = '+';
      addBtn.title = 'Add slot';
      addBtn.addEventListener('click', () => addSlot(cat.id));
      bodyDiv.appendChild(addBtn);

      // Slot grid (5 per row, newest first)
      const slotsDiv = document.createElement('div');
      slotsDiv.className = 'biroly-cat-slots';

      const catSlots = Object.values(slots).filter(s => s.categoryId === cat.id);
      // Newest first — slots are stamped with createdAt at addSlot time. Old
      // slots without createdAt fall back to 0 and render last.
      catSlots.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      catSlots.forEach(slot => {
        const card = document.createElement('div');
        card.className = 'biroly-slot-card' + (slot.id === selectedId ? ' selected' : '');
        card.dataset.id = slot.id;

        const emojiSpan = document.createElement('span');
        emojiSpan.className = 'slot-emoji';
        emojiSpan.textContent = slot.emoji;

        const nameSpan = document.createElement('span');
        nameSpan.className = 'slot-name';
        nameSpan.textContent = slot.name || '';

        card.appendChild(emojiSpan);
        card.appendChild(nameSpan);
        card.addEventListener('click', () => selectSlot(slot.id));
        slotsDiv.appendChild(card);
      });

      bodyDiv.appendChild(slotsDiv);
      catDiv.appendChild(bodyDiv);
      catListEl.appendChild(catDiv);
    });
  }

  /* ── Session video gallery ──────────────────────────────────────
     Seeded from the archive's last-5 generated birols on load, so the preview
     is restored (frozen) after leaving the page or restarting the server. ── */
  const _sessionVideos = [];
  let _sessionVideoIdx = 0;

  // Restore the preview from the PERSISTED archive (data/biroly.json ↔ LS):
  // the 5 most recently generated birols that have a video, newest first.
  function _seedSessionFromArchive() {
    try {
      const arch = (typeof getBirolyArchive === 'function') ? getBirolyArchive() : [];
      // Only birols GENERATED in this Birols tab (source: 'birols') — not the
      // merge Ideas popup ('ideas') or uploads ('upload').
      const recent = arch.filter(b => b && b.videoPath && b.source === 'birols').slice()
        .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
        .slice(0, 5)
        .map(b => ({ videoPath: b.videoPath, thumbPath: b.thumbPath || null, item: b }));
      _sessionVideos.length = 0;
      recent.forEach(r => _sessionVideos.push(r));
      _sessionVideoIdx = 0;
    } catch {}
  }

  function _renderSessionGallery() {
    const galleryEl  = document.getElementById('biroly-session-gallery');
    const thumbWrap  = document.getElementById('biroly-session-thumb-wrap');
    const counter    = document.getElementById('biroly-session-counter');
    const prevBtn    = document.getElementById('biroly-session-prev');
    const nextBtn    = document.getElementById('biroly-session-next');
    if (!galleryEl) return;
    if (!_sessionVideos.length) { galleryEl.style.display = 'none'; return; }

    galleryEl.style.display = 'flex';
    previewEmptyEl.style.display = 'none';

    const cur = _sessionVideos[_sessionVideoIdx];
    if (counter) counter.textContent = `${_sessionVideoIdx + 1} / ${_sessionVideos.length}`;
    if (prevBtn) prevBtn.disabled = _sessionVideoIdx === 0;
    if (nextBtn) nextBtn.disabled = _sessionVideoIdx === _sessionVideos.length - 1;

    if (thumbWrap) {
      thumbWrap.innerHTML = '';
      const canvas = document.createElement('canvas');
      canvas.width = 160; canvas.height = 284;
      canvas.style.cssText = 'display:block;width:160px;height:284px;object-fit:cover;background:#111;margin:0 auto;border:1px solid #555;';
      thumbWrap.appendChild(canvas);
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;';
      overlay.innerHTML = '<div style="background:rgba(0,0,0,0.55);border-radius:50%;width:30px;height:30px;display:flex;align-items:center;justify-content:center;"><span style="color:#fff;font-size:14px;margin-left:3px;">▶</span></div>';
      thumbWrap.appendChild(overlay);
      const probe = document.createElement('video');
      probe.src = cur.videoPath; probe.muted = true; probe.preload = 'metadata';
      probe.addEventListener('seeked', () => {
        try { canvas.getContext('2d').drawImage(probe, 0, 0, 160, 284); } catch {}
        probe.src = '';
      }, { once: true });
      probe.addEventListener('loadedmetadata', () => { probe.currentTime = 0.01; }, { once: true });
      thumbWrap.onclick = () => {
        // openVideoPopup lives in scen-edit-panel.js (not loaded on /birols), so
        // use the biroly lightbox (always present here) to actually play the clip.
        if (typeof openBirolyVideoLightbox === 'function') openBirolyVideoLightbox(cur.videoPath, cur.thumbPath || null, cur.item || null);
        else window.open(cur.videoPath, '_blank');
      };
    }

    if (prevBtn) prevBtn.onclick = () => { if (_sessionVideoIdx > 0) { _sessionVideoIdx--; _renderSessionGallery(); } };
    if (nextBtn) nextBtn.onclick = () => { if (_sessionVideoIdx < _sessionVideos.length - 1) { _sessionVideoIdx++; _renderSessionGallery(); } };
  }

  /* ── Render: center column empty state ──────────────────────────── */
  function renderPreview() {
    if (_genCount > 0) return;
    setGenUI(null);
    if (!_sessionVideos.length) _seedSessionFromArchive();   // restore last-5 generated (frozen across reload/restart)
    if (_sessionVideos.length) { _renderSessionGallery(); return; }
    if (!selectedId || !slots[selectedId]) {
      previewEmptyEl.innerHTML = '<span class="preview-emoji">📋</span>Select slot';
      previewEmptyEl.style.display = 'flex';
    } else {
      previewEmptyEl.style.display = 'none';
    }
  }

  /* ── Render: right column prompt preview ────────────────────────── */
  function renderPromptPreview(slot) {
    if (!promptOutputEl) return;
    if (!slot?.prompt) {
      promptOutputEl.style.display = 'none';
      if (enhancedBadgeEl) enhancedBadgeEl.style.display = 'none';
      return;
    }
    if (birolEnhancedPrompt) {
      promptOutputEl.innerHTML = birolEnhancedPrompt.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      if (enhancedBadgeEl) enhancedBadgeEl.style.display = 'block';
    } else {
      promptOutputEl.innerHTML = buildPreviewHTML(slot) || '';
      if (enhancedBadgeEl) enhancedBadgeEl.style.display = 'none';
    }
    promptOutputEl.style.display = 'block';
    if (realismRowEl) realismRowEl.style.display = 'flex';
  }

  /* Update only the bold spintax parts in the editable preview (preserves user additions) */
  function updateSpintaxPartsInPreview(slot) {
    if (!promptOutputEl || birolEnhancedPrompt) return;
    const strongs = promptOutputEl.querySelectorAll('strong');
    const groups  = parseSpintax(slot.prompt || '');
    strongs.forEach((el, idx) => {
      if (!groups[idx]) return;
      const sel = (slot.selections && slot.selections[idx] != null) ? slot.selections[idx] : 0;
      el.textContent = groups[idx].options[Math.min(sel, groups[idx].options.length - 1)];
    });
  }

  /* ── Render: right column editor (slot header + dropdowns + buttons) */
  function renderEditor() {
    if (!selectedId || !slots[selectedId]) {
      noSelEl.style.display = 'block';
      editorEl.style.display = 'none';
      if (promptOutputEl) promptOutputEl.style.display = 'none';
      if (enhancedBadgeEl) enhancedBadgeEl.style.display = 'none';
      return;
    }
    noSelEl.style.display = 'none';
    editorEl.style.display = 'block';

    const slot = slots[selectedId];
    if (slotHeaderEl) {
      slotHeaderEl.textContent = `${slot.emoji || ''} ${slot.name || 'Slot'}`;
    }
    renderPromptPreview(slot);

    // Category move dropdown
    let moveSel = document.getElementById('biroly-move-cat-sel');
    if (!moveSel) {
      const moveRow = document.createElement('div');
      moveRow.id = 'biroly-move-cat-row';
      moveRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:8px;';
      const moveLabel = document.createElement('label');
      moveLabel.textContent = 'Group:';
      moveLabel.style.cssText = 'font-size:11px;font-weight:bold;flex-shrink:0;';
      moveSel = document.createElement('select');
      moveSel.id = 'biroly-move-cat-sel';
      moveSel.style.cssText = 'flex:1;font-size:11px;';
      moveSel.addEventListener('change', () => {
        if (!selectedId || !slots[selectedId]) return;
        slots[selectedId].categoryId = moveSel.value;
        saveState();
        renderCategories();
      });
      moveRow.appendChild(moveLabel);
      moveRow.appendChild(moveSel);
      editorEl.insertBefore(moveRow, document.getElementById('biroly-spintax-controls'));
    }
    // Populate options
    moveSel.innerHTML = '';
    categories.forEach(cat => {
      const o = document.createElement('option');
      o.value = cat.id;
      o.textContent = cat.label;
      moveSel.appendChild(o);
    });
    moveSel.value = slot.categoryId || '';

    renderSpintaxDropdowns(slot);
  }

  /* ── Render: spintax dropdowns in right column ──────────────────── */
  function renderSpintaxDropdowns(slot) {
    spintaxContainer.innerHTML = '';
    if (!slot.prompt) {
      const hint = document.createElement('div');
      hint.style.cssText = 'color:#888;font-size:10px;font-style:italic;margin-bottom:8px;';
      hint.textContent = 'Click "Edit" to add a prompt';
      spintaxContainer.appendChild(hint);
      return;
    }
    const groups = parseSpintax(slot.prompt);
    if (!groups.length) {
      const note = document.createElement('div');
      note.style.cssText = 'color:#888;font-size:10px;font-style:italic;margin-bottom:8px;';
      note.textContent = 'Prompt without spintax';
      spintaxContainer.appendChild(note);
      return;
    }

    groups.forEach(({ options }, idx) => {
      const group = document.createElement('div');
      group.className = 'biroly-spintax-group';

      const label = document.createElement('label');
      label.textContent = `Group ${idx + 1}`;
      group.appendChild(label);

      const sel = document.createElement('select');
      options.forEach((opt, optIdx) => {
        const o = document.createElement('option');
        o.value = String(optIdx);
        o.textContent = opt;
        sel.appendChild(o);
      });
      const curIdx = (slot.selections && slot.selections[idx] != null)
        ? Math.min(slot.selections[idx], options.length - 1) : 0;
      sel.value = String(curIdx);
      sel.addEventListener('change', () => {
        if (!selectedId || !slots[selectedId]) return;
        if (!slots[selectedId].selections) slots[selectedId].selections = [];
        slots[selectedId].selections[idx] = Number(sel.value);
        clearEnhanced();
        saveState();
        updateSpintaxPartsInPreview(slots[selectedId]);
      });

      group.appendChild(sel);
      spintaxContainer.appendChild(group);
    });
  }

  /* ── Full re-render ─────────────────────────────────────────────── */
  function render() {
    renderCategories();
    renderPreview();
    renderEditor();
  }

  /* ── Actions ────────────────────────────────────────────────────── */
  function selectSlot(id) {
    clearEnhanced();
    if (promptOutputEl) promptOutputEl.innerHTML = '';
    selectedId = id;
    // Randomize spintax selections on every slot click
    if (slots[id]?.prompt) {
      const groups = parseSpintax(slots[id].prompt);
      slots[id].selections = groups.map(g => Math.floor(Math.random() * g.options.length));
      saveState();
    }
    render();
  }

  function addSlot(categoryId) {
    const id    = uid();
    const emoji = EMOJI_POOL[Math.floor(Math.random() * EMOJI_POOL.length)];
    // createdAt timestamps the new slot so it sorts to the front of the grid
    // (newest first). All older slots without this field fall back to 0.
    slots[id]   = { id, categoryId, emoji, name: 'New', prompt: '', selections: [], createdAt: Date.now() };
    _pendingNewId = id;
    selectedId = id;
    // Ensure the host category is open so the new slot is immediately visible.
    _openBirolyCats.add(categoryId);
    render();
    openModal(id, true);
  }

  /* ── Events ─────────────────────────────────────────────────────── */

  // Open edit modal
  editBtn?.addEventListener('click', () => {
    if (!selectedId) return;
    openModal(selectedId);
  });

  // Delete slot
  deleteBtn?.addEventListener('click', () => {
    if (!selectedId || !slots[selectedId]) return;
    delete slots[selectedId];
    selectedId = null;
    saveState();
    render();
  });


  // Add new category — opens creation popup
  addRowBtn?.addEventListener('click', () => openNewCategoryPopup());

  // 💡 Ideas — opens the biroly-ideas-popup module which writes slots back
  // through localStorage + dispatches `biroly-state-updated`. We catch that
  // event here to refresh the left-column slot grid without reload.
  document.getElementById('biroly-ideas-btn')?.addEventListener('click', () => {
    if (typeof window.openBirolyIdeasPopup === 'function') {
      window.openBirolyIdeasPopup();
    } else {
      console.warn('[biroly] openBirolyIdeasPopup not loaded yet');
    }
  });
  window.addEventListener('biroly-state-updated', () => {
    // External writer (ideas popup, sync from server, etc) touched LS — reload
    // and re-render so the left-column slot grid reflects the new slots.
    loadState();
    render();
  });

  /* ── New category popup ─────────────────────────────────────────────────── */
  function openNewCategoryPopup() {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.82);z-index:10500;display:flex;align-items:center;justify-content:center;';

    const popup = document.createElement('div');
    popup.style.cssText = 'background:#c0c0c0;border:2px solid;border-color:#fff #808080 #808080 #fff;padding:10px;width:340px;max-width:96vw;display:flex;flex-direction:column;gap:10px;box-sizing:border-box;';

    const titleBar = document.createElement('div');
    titleBar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;background:#000080;color:#fff;padding:3px 8px;margin:-10px -10px 0;flex-shrink:0;';
    const titleTxt = document.createElement('span');
    titleTxt.style.cssText = 'font-size:11px;font-weight:bold;';
    titleTxt.textContent = 'New category';
    const closeX = document.createElement('button');
    closeX.textContent = '✕';
    closeX.style.cssText = 'background:none;border:none;color:#fff;cursor:pointer;font-size:13px;padding:0 2px;';
    closeX.addEventListener('click', () => overlay.remove());
    titleBar.appendChild(titleTxt); titleBar.appendChild(closeX);
    popup.appendChild(titleBar);

    const lbl = document.createElement('label');
    lbl.style.cssText = 'font-size:10px;font-weight:bold;';
    lbl.textContent = 'Name:';
    const nameInp = document.createElement('input');
    nameInp.type = 'text';
    nameInp.value = randomCatName();
    nameInp.style.cssText = 'font-size:11px;padding:3px 5px;box-sizing:border-box;width:100%;margin-top:3px;';
    nameInp.placeholder = 'Category name';
    const nameWrap = document.createElement('div');
    nameWrap.appendChild(lbl); nameWrap.appendChild(nameInp);
    popup.appendChild(nameWrap);

    const bottomRow = document.createElement('div');
    bottomRow.style.cssText = 'display:flex;gap:8px;';
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = 'font-size:10px;padding:3px 12px;cursor:pointer;flex:1;';
    cancelBtn.addEventListener('click', () => overlay.remove());
    const createBtn = document.createElement('button');
    createBtn.textContent = '✓ Create';
    createBtn.style.cssText = 'font-size:10px;padding:3px 14px;cursor:pointer;background:#c0ffc0;border:1px solid #4a8a4a;font-weight:bold;flex:2;';
    bottomRow.appendChild(cancelBtn); bottomRow.appendChild(createBtn);
    popup.appendChild(bottomRow);

    overlay.appendChild(popup);
    document.body.appendChild(overlay);
    popup.addEventListener('mousedown', e => e.stopPropagation());
    popup.addEventListener('click',     e => e.stopPropagation());
    overlay.addEventListener('mousedown', e => { if (e.target === overlay) overlay.remove(); });
    nameInp.focus(); nameInp.select();

    const doCreate = () => {
      const name = nameInp.value.trim() || 'Category';
      categories.push({ id: uid(), label: name });
      saveState();
      render();
      overlay.remove();
    };
    createBtn.addEventListener('click', doCreate);
    nameInp.addEventListener('keydown', e => { if (e.key === 'Enter') doCreate(); });
  }

  /* ── Edit-Category popup ─────────────────────────────────────────── */
  function _openCatEditPopup(cat) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:10000;display:flex;align-items:center;justify-content:center;';

    const popup = document.createElement('div');
    popup.style.cssText = 'background:#c0c0c0;border:2px solid;border-color:#fff #808080 #808080 #fff;min-width:560px;max-width:96vw;max-height:92vh;display:flex;flex-direction:column;box-sizing:border-box;';

    // Title bar
    const titleBar = document.createElement('div');
    titleBar.style.cssText = 'background:#000080;color:#fff;padding:4px 8px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;';
    const titleBarText = document.createElement('span');
    titleBarText.style.cssText = 'font-size:11px;font-weight:bold;';
    titleBarText.textContent = 'Edit category';
    const titleBarBtns = document.createElement('div');
    titleBarBtns.style.cssText = 'display:flex;gap:4px;align-items:center;';
    const saveBtn = document.createElement('button');
    saveBtn.textContent = '💾 Save';
    saveBtn.style.cssText = 'font-size:10px;padding:2px 10px;cursor:pointer;background:#4a8a4a;color:#fff;border:1px solid #2a6a2a;font-weight:bold;';

    // Delete-category button — sits next to ✕, two-click confirmation.
    // First click → red "?" / pulsing. Second click within 2.5s → execute
    // and close the popup. Idle reset after 2.5s.
    const deleteCatBtn = document.createElement('button');
    deleteCatBtn.textContent = '🗑';
    deleteCatBtn.title = 'Delete category (click twice)';
    const _delIdleStyle = 'font-size:11px;padding:2px 8px;cursor:pointer;background:#a04040;color:#fff;border:1px solid #6a2020;font-weight:bold;line-height:1;';
    const _delArmedStyle = 'font-size:11px;padding:2px 8px;cursor:pointer;background:#ff5555;color:#fff;border:1px solid #aa0000;font-weight:bold;line-height:1;';
    deleteCatBtn.style.cssText = _delIdleStyle;
    let _delPending = false, _delTimer = null;

    const closeX = document.createElement('button');
    closeX.textContent = '✕';
    closeX.style.cssText = 'background:none;border:none;color:#fff;cursor:pointer;font-size:14px;padding:0 3px;line-height:1;';
    titleBarBtns.appendChild(saveBtn);
    titleBarBtns.appendChild(deleteCatBtn);
    titleBarBtns.appendChild(closeX);
    titleBar.appendChild(titleBarText);
    titleBar.appendChild(titleBarBtns);
    popup.appendChild(titleBar);

    deleteCatBtn.addEventListener('click', () => {
      if (!_delPending) {
        _delPending = true;
        deleteCatBtn.textContent = '? Sure?';
        deleteCatBtn.style.cssText = _delArmedStyle;
        _delTimer = setTimeout(() => {
          _delPending = false;
          deleteCatBtn.textContent = '🗑';
          deleteCatBtn.style.cssText = _delIdleStyle;
        }, 2500);
        return;
      }
      clearTimeout(_delTimer);
      // Wipe slots in this category
      Object.keys(slots).forEach(id => {
        if (slots[id].categoryId === cat.id) delete slots[id];
      });
      if (selectedId && slots[selectedId] === undefined) selectedId = null;
      // Drop the in-memory open marker (no UI leak after delete)
      _openBirolyCats.delete(cat.id);
      // Remove category system prompt from Brain if it had one
      if (cat.systemPromptKey) {
        fetch(`/api/prompts/dynamic/${cat.systemPromptKey}`, { method: 'DELETE' }).catch(() => {});
        promptsLoaded = false;
      }
      categories = categories.filter(c => c.id !== cat.id);
      saveState();
      overlay.remove();
      render();
    });

    // Body
    const body = document.createElement('div');
    body.style.cssText = 'padding:12px;display:flex;flex-direction:column;gap:10px;overflow-y:auto;flex:1;min-height:0;';

    // Name row
    const nameRow = document.createElement('div');
    nameRow.style.cssText = 'display:flex;align-items:center;gap:8px;';
    const nameLbl = document.createElement('span');
    nameLbl.style.cssText = 'font-size:11px;font-weight:bold;white-space:nowrap;';
    nameLbl.textContent = 'Name:';
    const nameInp = document.createElement('input');
    nameInp.type = 'text';
    nameInp.value = cat.label;
    nameInp.style.cssText = 'flex:1;font-size:11px;padding:3px 6px;';
    nameRow.appendChild(nameLbl);
    nameRow.appendChild(nameInp);
    body.appendChild(nameRow);

    // System-prompt section — collapsed under a <details> by default. The
    // backend now treats this text as optional category context, NOT as a
    // replacement for the spintax structure, so most users never need to open it.
    const promptDetails = document.createElement('details');
    promptDetails.style.cssText = 'margin-top:2px;';
    const promptSummary = document.createElement('summary');
    promptSummary.textContent = 'System prompt (optional — category context, does not replace the spintax structure)';
    promptSummary.style.cssText = 'font-size:11px;font-weight:bold;cursor:pointer;padding:4px 6px;background:#d8d8d8;border:1px solid #888;user-select:none;';
    promptDetails.appendChild(promptSummary);

    const promptInner = document.createElement('div');
    promptInner.style.cssText = 'display:flex;flex-direction:column;gap:10px;padding:8px 4px 2px;';

    // Prompt header row
    const promptHdr = document.createElement('div');
    promptHdr.style.cssText = 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;';
    const promptLbl = document.createElement('span');
    promptLbl.style.cssText = 'font-size:11px;font-weight:bold;white-space:nowrap;';
    promptLbl.textContent = 'Prompt text:';
    const versionSel = document.createElement('select');
    versionSel.style.cssText = 'font-size:10px;padding:2px 4px;flex:1;min-width:0;max-width:200px;';
    const resetBtn = document.createElement('button');
    resetBtn.textContent = '↺ Default';
    resetBtn.title = 'Revert to the default prompt';
    resetBtn.style.cssText = 'font-size:10px;padding:2px 7px;cursor:pointer;white-space:nowrap;';
    promptHdr.appendChild(promptLbl);
    promptHdr.appendChild(versionSel);
    promptHdr.appendChild(resetBtn);
    promptInner.appendChild(promptHdr);

    // Prompt textarea
    const promptTA = document.createElement('textarea');
    promptTA.style.cssText = 'width:100%;height:220px;font-size:10px;padding:6px;resize:vertical;box-sizing:border-box;font-family:monospace;line-height:1.45;';
    promptInner.appendChild(promptTA);

    // Divider
    const divider = document.createElement('div');
    divider.style.cssText = 'border-top:1px dashed #888;margin-top:2px;';
    promptInner.appendChild(divider);

    // User request label
    const reqLbl = document.createElement('div');
    reqLbl.style.cssText = 'font-size:11px;font-weight:bold;';
    reqLbl.textContent = 'Edits (describe what to change):';
    promptInner.appendChild(reqLbl);

    // User request textarea
    const reqTA = document.createElement('textarea');
    reqTA.style.cssText = 'width:100%;height:68px;font-size:11px;padding:6px;resize:vertical;box-sizing:border-box;';
    reqTA.placeholder = 'For example: emphasize amateur handheld footage, more lighting variations…';
    promptInner.appendChild(reqTA);

    // Implement row
    const implRow = document.createElement('div');
    implRow.style.cssText = 'display:flex;align-items:center;gap:8px;';
    const implBtn = document.createElement('button');
    implBtn.textContent = '▶ Implement';
    implBtn.style.cssText = 'font-size:11px;padding:4px 16px;cursor:pointer;background:#1a3a6a;color:#fff;border:1px solid #4a6aaa;font-weight:bold;';
    const implStatus = document.createElement('span');
    implStatus.style.cssText = 'font-size:10px;color:#555;';
    implRow.appendChild(implBtn);
    implRow.appendChild(implStatus);
    promptInner.appendChild(implRow);

    promptDetails.appendChild(promptInner);
    body.appendChild(promptDetails);

    popup.appendChild(body);
    overlay.appendChild(popup);
    document.body.appendChild(overlay);

    // ── Version management ──────────────────────────────────────────
    if (!cat.promptVersions) cat.promptVersions = [];
    const versions = cat.promptVersions;

    function _fmtDate(iso) {
      const d = new Date(iso);
      const m = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return `${d.getDate()} ${m[d.getMonth()]} ${d.getFullYear()}`;
    }

    function _rebuildVersions() {
      versionSel.innerHTML = '';
      const curr = document.createElement('option');
      curr.value = '__current__';
      curr.textContent = 'Current';
      versionSel.appendChild(curr);
      [...versions].reverse().forEach((ver, i) => {
        const o = document.createElement('option');
        o.value = String(i);
        o.textContent = `v${ver.v} — ${_fmtDate(ver.date)}`;
        versionSel.appendChild(o);
      });
      versionSel.value = '__current__';
    }

    async function _loadDefault() {
      try {
        const r = await fetch('/api/biroly/default-system-prompt').then(x => x.json());
        promptTA.value = r.prompt || '';
      } catch { promptTA.value = ''; }
    }

    // Initial fill
    _rebuildVersions();
    if (cat.systemPrompt) {
      promptTA.value = cat.systemPrompt;
    } else {
      _loadDefault();
    }

    // Version select
    versionSel.addEventListener('change', () => {
      if (versionSel.value === '__current__') {
        promptTA.value = cat.systemPrompt || '';
        if (!cat.systemPrompt) _loadDefault();
      } else {
        const rev = [...versions].reverse();
        const ver = rev[parseInt(versionSel.value, 10)];
        if (ver) promptTA.value = ver.prompt;
      }
    });

    // Reset to default
    resetBtn.addEventListener('click', () => { _loadDefault(); versionSel.value = '__current__'; });

    // Implement
    implBtn.addEventListener('click', async () => {
      const req = reqTA.value.trim();
      if (!req) { implStatus.textContent = 'Enter edits'; return; }
      const cur = promptTA.value.trim();
      if (!cur) { implStatus.textContent = 'No prompt'; return; }
      implBtn.disabled = true;
      implStatus.textContent = '⏳ Generating…';
      try {
        const r = await fetch('/api/biroly/edit-system-prompt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ currentPrompt: cur, userRequest: req }),
        }).then(x => x.json());
        if (!r.success) throw new Error(r.error || 'Error');
        const nextV = versions.length ? Math.max(...versions.map(v => v.v)) + 1 : 1;
        versions.push({ v: nextV, date: new Date().toISOString(), prompt: cur });
        cat.promptVersions = versions;
        promptTA.value = r.newPrompt;
        reqTA.value = '';
        implStatus.textContent = '✓ Done';
        setTimeout(() => { implStatus.textContent = ''; }, 3000);
        _rebuildVersions();
      } catch (e) {
        implStatus.textContent = '✕ ' + e.message;
      } finally {
        implBtn.disabled = false;
      }
    });

    // Save
    saveBtn.addEventListener('click', () => {
      cat.label = nameInp.value.trim() || cat.label;
      const p = promptTA.value.trim();
      cat.systemPrompt = p || null;
      saveState();
      render();
      overlay.remove();
    });

    closeX.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  }

  /* ── Init ───────────────────────────────────────────────────────── */
  loadState();
  render();
  // Re-attach an on-page progress row for any server gen still running (e.g. the
  // user navigated back to /birols mid-generation).
  async function _resumeServerJobs() {
    let data; try { data = await fetch('/api/biroly/generate/active').then(r => r.json()); } catch (e) { return; }
    if (!data || !data.success || !Array.isArray(data.jobs)) return;
    const notified = _bgNotified();
    data.jobs.forEach(j => {
      if (j && j.status === 'running' && j.jobId && !notified.has(j.jobId)) _pollServerJob(j.jobId, j.birolyId, j.name);
    });
  }
  setTimeout(() => { resumePendingBirolyGens(); recoverOrphanBirolys?.(); _resumeServerJobs(); }, 500);

})();
