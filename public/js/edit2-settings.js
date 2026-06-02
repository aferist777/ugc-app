/* ═══════════════════════════════════════════════════════════════════════════
   edit2-settings.js — project settings panel for the Edit v2 popup
   (window.EDIT2Settings). Core scope: Voice (+TTS) · Image (negative prompt) ·
   Video (avatar model + params). Writes the SAME localStorage keys / globals the
   legacy gen-settings used, so v1 and v2 stay in sync and the engine (Ф2/Ф3/Ф4)
   reads identical values.

   EDIT2Settings.build(sessionKey, onChange) → { node, summary() }
   ═══════════════════════════════════════════════════════════════════════════ */

(function () {
  const EDIT2Settings = {};

  const AVATAR_MODELS = ['kling/ai-avatar-standard', 'kling/ai-avatar-pro', 'prunaai/p-video-avatar'];
  const TTS_PARAMS = [
    { key: 'stability',        label: 'Stability',        min: 0,   max: 1,   step: 0.01, def: 0.85 },
    { key: 'similarity_boost', label: 'Similarity boost', min: 0,   max: 1,   step: 0.01, def: 0.75 },
    { key: 'style',            label: 'Style',            min: 0,   max: 1,   step: 0.01, def: 0 },
    { key: 'speed',            label: 'Speed',            min: 0.5, max: 2.0, step: 0.05, def: 1.15 },
  ];

  function _el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function _sess(k) { const all = (typeof editFrozenSessions !== 'undefined') ? editFrozenSessions : (window.editFrozenSessions || {}); return all[k]; }
  function _obrazVoice(k) {
    try { const s = _sess(k); const list = (typeof getObrazы === 'function') ? getObrazы() : []; const o = list.find(x => String(x.id) === String(s && s.obrazId)); return (o && o.voice) || ''; } catch { return ''; }
  }
  function _voiceName(val) {
    const v = (window.ELEVENLABS_VOICES || []).find(x => x.id === val || x.name === val);
    return v ? v.name : (val || '—');
  }
  function _modelLabel(id) { return (window.ENGINE_SCHEMAS && window.ENGINE_SCHEMAS[id] && window.ENGINE_SCHEMAS[id].label) || id; }

  // Global avatar model (validated) + per-model params store.
  function _getAvatarModel() { const v = localStorage.getItem('edit_avatar_model_global'); return AVATAR_MODELS.includes(v) ? v : 'kling/ai-avatar-standard'; }
  function _getAvatarParams(id) { try { return (JSON.parse(localStorage.getItem('edit_avatar_params_global') || '{}'))[id] || {}; } catch { return {}; } }
  function _setAvatarParams(id, p) { let all = {}; try { all = JSON.parse(localStorage.getItem('edit_avatar_params_global') || '{}'); } catch {} all[id] = p; localStorage.setItem('edit_avatar_params_global', JSON.stringify(all)); }
  function _ensureSeed(k) { const key = 'edit_avatar_seed__' + k; let s = parseInt(localStorage.getItem(key) || '0', 10); if (!s) { s = Math.floor((window.crypto ? crypto.getRandomValues(new Uint32Array(1))[0] : 1) % 1e9) || 1; localStorage.setItem(key, String(s)); } return s; }

  // Per-project TTS params merged over global Brain defaults.
  function _ttsMerged(k) {
    let global = {};
    try { if (typeof getEngineParams === 'function') global = getEngineParams((typeof getAudioEngine === 'function' ? getAudioEngine() : '') || 'elevenlabs/text-to-dialogue-v3') || {}; } catch {}
    let proj = null; try { proj = JSON.parse(localStorage.getItem('edit_tts_params__' + k) || 'null'); } catch {}
    return proj ? Object.assign({}, global, proj) : global;
  }

  let _previewAudio = null;

  EDIT2Settings.build = function (key, onChange) {
    const fire = () => { try { onChange && onChange(); } catch {} };
    const root = _el('div', 'e2-set');

    // ── Voice group ───────────────────────────────────────────────────────────
    const gV = _el('div', 'e2-set-group');
    gV.appendChild(_el('div', 'e2-set-title', 'Voice'));
    const vRow = _el('div', 'e2-set-row');
    const voiceSel = document.createElement('select'); voiceSel.className = 'e2-set-select';
    const savedVoice = localStorage.getItem('edit_voice__' + key) || _obrazVoice(key) || '';
    if (window.buildVoiceSelect) window.buildVoiceSelect(voiceSel, savedVoice);
    voiceSel.addEventListener('change', () => { localStorage.setItem('edit_voice__' + key, voiceSel.value); fire(); });
    if (window.registerVoiceSelect) window.registerVoiceSelect(voiceSel, () => localStorage.getItem('edit_voice__' + key) || savedVoice);
    const prev = _el('button', 'e2-btn', '▶'); prev.title = 'Preview voice';
    prev.addEventListener('click', () => {
      prev.disabled = true; prev.textContent = '…';
      const ttsParams = {}; TTS_PARAMS.forEach(p => { ttsParams[p.key] = _ttsState[p.key]; });
      fetch('/api/audio/tts-preview', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voice: voiceSel.value, ttsParams: ttsParams, model: (typeof getAudioEngine === 'function' ? getAudioEngine() : undefined) }) })
        .then(r => r.json()).then(d => {
          if (d && d.success && d.audioPath) { if (_previewAudio) { try { _previewAudio.pause(); } catch {} } _previewAudio = new Audio(d.audioPath); _previewAudio.play().catch(() => {}); }
        }).catch(() => {}).finally(() => { prev.disabled = false; prev.textContent = '▶'; });
    });
    vRow.appendChild(voiceSel); vRow.appendChild(prev);
    gV.appendChild(vRow);

    // TTS sliders
    const _ttsState = {}; const merged = _ttsMerged(key);
    const _saveTts = () => { localStorage.setItem('edit_tts_params__' + key, JSON.stringify(_ttsState)); fire(); };
    TTS_PARAMS.forEach(p => {
      _ttsState[p.key] = (merged[p.key] != null) ? merged[p.key] : p.def;
      const row = _el('div', 'e2-set-slider');
      row.appendChild(_el('label', null, p.label));
      const range = document.createElement('input'); range.type = 'range'; range.min = p.min; range.max = p.max; range.step = p.step; range.value = _ttsState[p.key];
      const num = document.createElement('input'); num.type = 'number'; num.min = p.min; num.max = p.max; num.step = p.step; num.value = _ttsState[p.key]; num.className = 'e2-set-num';
      range.addEventListener('input', () => { num.value = range.value; _ttsState[p.key] = parseFloat(range.value); _saveTts(); });
      num.addEventListener('input', () => { range.value = num.value; _ttsState[p.key] = parseFloat(num.value) || p.def; _saveTts(); });
      row.appendChild(range); row.appendChild(num);
      gV.appendChild(row);
    });
    // (groups appended below in Image | Voice | Video order, like Edit v1)

    // ── Image group (negative prompt) ──────────────────────────────────────────
    const gI = _el('div', 'e2-set-group');
    gI.appendChild(_el('div', 'e2-set-title', 'Image'));
    // Image engine (global → carries to new projects) + its params
    const ENG_LABELS = { 'nano-banana-2': 'nano-banana-2', 'qwen2': 'Qwen2', 'seedream': 'Seedream', 'gptimage2': 'GPT Image 2' };
    const engRow = _el('div', 'e2-set-row');
    const engSel = document.createElement('select'); engSel.className = 'e2-set-select';
    ['nano-banana-2', 'qwen2', 'seedream', 'gptimage2'].forEach(id => { const o = document.createElement('option'); o.value = id; o.textContent = ENG_LABELS[id] || id; engSel.appendChild(o); });
    engSel.value = (typeof getImageEngine === 'function' ? getImageEngine() : 'nano-banana-2');
    engRow.appendChild(engSel);
    const engParams = _el('div', 'e2-set-params');
    function _renderEngParams() {
      engParams.innerHTML = '';
      if (typeof buildEngineParamsForm === 'function') {
        const f = buildEngineParamsForm(engSel.value, () => {});
        if (f) engParams.appendChild(f); else engParams.appendChild(_el('span', 'e2-set-hint', 'No tunable params.'));
      }
    }
    engSel.addEventListener('change', () => { if (typeof setImageEngine === 'function') setImageEngine(engSel.value); _renderEngParams(); fire(); });
    _renderEngParams();
    gI.appendChild(engRow); gI.appendChild(engParams);
    const negLbl = _el('label', 'e2-set-sublabel', 'Negative prompt (global)');
    const negTa = document.createElement('textarea'); negTa.className = 'e2-set-neg'; negTa.rows = 2; negTa.placeholder = 'Things to avoid in every generated image…';
    fetch('/api/settings').then(r => r.json()).then(d => { negTa.value = (d.settings && d.settings.editNegativePrompt) || ''; }).catch(() => {});
    negTa.addEventListener('change', () => {
      fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ editNegativePrompt: negTa.value.trim() }) }).catch(() => {});
    });
    gI.appendChild(negLbl); gI.appendChild(negTa);

    // ── Video group (avatar model + params) ─────────────────────────────────────
    const gVid = _el('div', 'e2-set-group');
    gVid.appendChild(_el('div', 'e2-set-title', 'Video'));
    const mRow = _el('div', 'e2-set-row');
    const modelSel = document.createElement('select'); modelSel.className = 'e2-set-select';
    AVATAR_MODELS.forEach(id => { const o = document.createElement('option'); o.value = id; o.textContent = _modelLabel(id); modelSel.appendChild(o); });
    modelSel.value = _getAvatarModel();
    mRow.appendChild(modelSel); gVid.appendChild(mRow);
    const paramsHost = _el('div', 'e2-set-params'); gVid.appendChild(paramsHost);

    function _renderModelParams() {
      paramsHost.innerHTML = '';
      const id = modelSel.value;
      const sc = window.ENGINE_SCHEMAS && window.ENGINE_SCHEMAS[id];
      if (!sc || !sc.fields || !sc.fields.length) { paramsHost.appendChild(_el('span', 'e2-set-hint', 'No tunable params for this model.')); return; }
      const saved = _getAvatarParams(id);
      if (id === 'prunaai/p-video-avatar' && (!saved.seed || Number(saved.seed) <= 0)) saved.seed = _ensureSeed(key);
      if (window.buildEngineSettingsRow) {
        const built = window.buildEngineSettingsRow(id, saved, (collected) => { _setAvatarParams(id, collected); });
        paramsHost.appendChild(built.node);
      }
    }
    modelSel.addEventListener('change', () => { localStorage.setItem('edit_avatar_model_global', modelSel.value); _renderModelParams(); fire(); });
    _renderModelParams();

    // Motion prompt (per scenario, per model) — meta.motionPrompt / minimalistMotionPrompt
    const _scenFile = (_sess(key) || {}).scenFile;
    if (_scenFile) {
      const enc = encodeURIComponent(_scenFile);
      const fieldFor = (m) => (m === 'prunaai/p-video-avatar') ? 'minimalistMotionPrompt' : 'motionPrompt';
      gVid.appendChild(_el('div', 'e2-set-sublabel', 'Motion prompt (per scenario)'));
      const motionTa = document.createElement('textarea'); motionTa.className = 'e2-set-neg'; motionTa.rows = 3; motionTa.placeholder = 'Loading…';
      function _loadMotion(model) {
        const field = fieldFor(model); motionTa.value = ''; motionTa.placeholder = 'Loading…';
        fetch('/api/scenarios/meta/' + enc).then(r => r.json()).then(d => {
          const meta = (d && d.meta) || {}; const v = meta[field] || '';
          motionTa.value = v; motionTa.placeholder = v ? '' : '(empty — generated on AI scenario save; editable here)';
          if (!v && model === 'prunaai/p-video-avatar') {
            fetch('/api/scenarios/meta/' + enc + '/ensure-minimalist', { method: 'POST' }).then(r => r.json()).then(dd => { if (dd && dd.success) motionTa.value = dd.minimalistMotionPrompt || ''; }).catch(() => {});
          }
        }).catch(() => { motionTa.placeholder = '(failed to load)'; });
      }
      motionTa.addEventListener('change', () => {
        const body = {}; body[fieldFor(modelSel.value)] = motionTa.value.trim();
        fetch('/api/scenarios/meta/' + enc, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => {});
      });
      const reload = _el('button', 'e2-btn e2-set-reload', '↺ Reload');
      reload.addEventListener('click', () => _loadMotion(modelSel.value));
      gVid.appendChild(motionTa); gVid.appendChild(reload);
      modelSel.addEventListener('change', () => _loadMotion(modelSel.value));
      _loadMotion(modelSel.value);
    }

    // Append in Edit-v1 order: Image | Voice | Video.
    root.appendChild(gI); root.appendChild(gV); root.appendChild(gVid);

    const summary = () => 'Voice: ' + _voiceName(voiceSel.value) + ' · Image: ' + ((typeof getImageEngine === 'function' ? getImageEngine() : '—')) + ' · Video: ' + _modelLabel(modelSel.value);
    return { node: root, summary: summary };
  };

  window.EDIT2Settings = EDIT2Settings;
})();
