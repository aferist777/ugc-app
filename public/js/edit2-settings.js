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

  // Casting pill + photoshoot-thumbnail picker styles (injected once).
  function _injectCastCss() {
    if (document.getElementById('e2-cast-styles')) return;
    const st = document.createElement('style'); st.id = 'e2-cast-styles';
    st.textContent = `
.e2-cast-pill{display:flex;align-items:stretch;height:30px;border:1px solid #9a958c;border-radius:999px;overflow:hidden;background:#fff;max-width:100%}
.e2-cast-role{display:flex;align-items:center;padding:0 11px;background:#ececec;color:#333;font-size:11px;font-weight:bold;white-space:nowrap;border-right:1px solid #cfcabf;max-width:130px;overflow:hidden;text-overflow:ellipsis;flex:0 0 auto}
.e2-cast-char{flex:1;min-width:0;border:none!important;background-color:transparent!important;border-radius:0!important;box-shadow:none!important;font-size:12px;cursor:pointer;height:100%}
.e2-cast-photo-btn{width:32px;flex:0 0 32px;border:none;border-left:1px solid #cfcabf;background:#f4f4f4;cursor:pointer;font-size:14px;line-height:1;color:#444;padding:0}
.e2-cast-photo-btn:hover{background:#e6e1d8}
.e2-cast-gear-btn{width:30px;flex:0 0 30px;border:none;border-left:1px solid #cfcabf;background:#f4f4f4;cursor:pointer;font-size:13px;line-height:1;color:#444;padding:0}
.e2-cast-gear-btn:hover{background:#e6e1d8}
.e2-cast-photos{position:fixed;z-index:100000;background:#fff;border:1px solid #888;border-radius:8px;box-shadow:0 12px 34px rgba(0,0,0,.4);padding:7px;display:grid;grid-template-columns:repeat(3,54px);gap:6px;max-height:62vh;overflow:auto}
.e2-cast-photo{width:54px;height:96px;object-fit:cover;border-radius:4px;border:2px solid transparent;cursor:pointer;background:#111;display:block}
.e2-cast-photo:hover{border-color:#2e86c1}
.e2-cast-photo.sel{border-color:#2e86c1;box-shadow:0 0 0 1px #2e86c1}
.e2-cast-empty{grid-column:1/-1;font-size:11px;color:#777;padding:6px 4px}
.e2-tts-v3 .e2-v3-warn{font-size:11px;line-height:1.35;color:#8a5a00;background:#fff7e6;border:1px solid #f0d28a;border-radius:6px;padding:6px 8px;margin:2px 0 8px}
.e2-v3-tags{width:100%;box-sizing:border-box;resize:vertical;font-size:12px;font-family:inherit;line-height:1.4;border:1px solid var(--e2-shadow,#9a958c);border-radius:6px;padding:5px 7px;min-height:38px;color:#222;background:#fff}
.e2-v3-analyze{margin-top:7px;width:100%}
`;
    document.head.appendChild(st);
  }

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

  EDIT2Settings.build = function (key, onChange, hooks) {
    hooks = hooks || {};
    const fire = () => { try { onChange && onChange(); } catch {} };
    const root = _el('div', 'e2-set');
    // Enable/disable the ✨ motion-gen button based on mix completion (assigned
    // inside the Video group below; called by the popup as mixes finish).
    let _refreshGating = function () {};

    // ── Voice group ───────────────────────────────────────────────────────────
    const gV = _el('div', 'e2-set-group');
    gV.appendChild(_el('div', 'e2-set-title', 'Voice'));

    // TTS model (per-project): v2 standard ⇄ v3 emotional (inline audio tags).
    const tmRow = _el('div', 'e2-set-row');
    tmRow.appendChild(_el('label', 'e2-set-sublabel', 'TTS model'));
    const modelTts = document.createElement('select'); modelTts.className = 'e2-set-select';
    [['v2', 'ElevenLabs v2 (multilingual)'], ['v3', 'ElevenLabs v3 (emotional)']].forEach(([v, t]) => {
      const o = document.createElement('option'); o.value = v; o.textContent = t; modelTts.appendChild(o);
    });
    let _prevTts = (window.EDIT2 && EDIT2.getVoiceModel) ? EDIT2.getVoiceModel(key) : 'v2';
    modelTts.value = _prevTts;
    modelTts.addEventListener('change', () => {
      const want = modelTts.value;
      modelTts.disabled = true;
      Promise.resolve(hooks.onVoiceModelChange ? hooks.onVoiceModelChange(want, _prevTts) : want)
        .then(final => { const m = (final === 'v3') ? 'v3' : 'v2'; modelTts.value = m; _prevTts = m; })
        .catch(() => { modelTts.value = _prevTts; })
        .finally(() => { modelTts.disabled = false; _syncTtsPanels(); _refreshV3TagsField(); fire(); });
    });
    tmRow.appendChild(modelTts);
    gV.appendChild(tmRow);

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
    vRow.style.display = 'none';   // voice is bound to the character (set via Casting) — no need to show it
    gV.appendChild(vRow);

    // ── TTS sliders (v2) live in their own panel; v3 swaps them for the
    //    emotional-tags UI (warning + editable tags field + Analyze button). ──
    const v2Panel = _el('div', 'e2-tts-v2');
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
      v2Panel.appendChild(row);
    });

    // v3 panel: warning + audio-tags readout (editable) + Analyze button.
    const v3Panel = _el('div', 'e2-tts-v3');
    v3Panel.appendChild(_el('div', 'e2-v3-warn', '⚠ ElevenLabs v3 voices each line with inline emotional “audio tags”. Analyzing the scenario (re)writes the tagged delivery — regenerate the voices afterwards. The spoken words never change.'));
    v3Panel.appendChild(_el('label', 'e2-set-sublabel', 'Audio tags (from scenario + emotion)'));
    const v3Tags = document.createElement('textarea'); v3Tags.className = 'e2-v3-tags'; v3Tags.rows = 2;
    v3Tags.placeholder = 'Run “Analyze scenario + emotion” to detect the audio tags…';
    const _tagsKey = 'edit_v3_tags__' + key;
    const _placedTags = () => { try { return (window.EDIT2 && EDIT2.placedTags) ? EDIT2.placedTags(key) : []; } catch { return []; } };
    function _refreshV3TagsField() {
      const stored = localStorage.getItem(_tagsKey);
      v3Tags.value = (stored != null) ? stored : _placedTags().join(' ');
    }
    v3Tags.addEventListener('input', () => { localStorage.setItem(_tagsKey, v3Tags.value); });
    v3Panel.appendChild(v3Tags);
    const analyzeBtn = _el('button', 'e2-btn e2-v3-analyze', '✨ Analyze scenario + emotion');
    analyzeBtn.addEventListener('click', () => {
      if (!hooks.onAnalyzeEmotion || analyzeBtn.disabled) return;
      analyzeBtn.disabled = true; const _t = analyzeBtn.textContent; analyzeBtn.textContent = '✨ Analyzing…';
      Promise.resolve(hooks.onAnalyzeEmotion()).then(res => {
        if (res && res.ok) {
          const tags = (res.tags && res.tags.length) ? res.tags : _placedTags();
          v3Tags.value = tags.join(' '); localStorage.setItem(_tagsKey, v3Tags.value);
        }
      }).catch(() => {}).finally(() => { analyzeBtn.textContent = _t; analyzeBtn.disabled = false; });
    });
    v3Panel.appendChild(analyzeBtn);

    gV.appendChild(v2Panel); gV.appendChild(v3Panel);

    // Toggle which TTS sub-panel is shown based on the current model dropdown value.
    function _syncTtsPanels() {
      const isV3 = modelTts.value === 'v3';
      v2Panel.style.display = isV3 ? 'none' : '';
      v3Panel.style.display = isV3 ? '' : 'none';
    }
    // Re-read the model (e.g. after the info-bar badge switched it) into dropdown + panels.
    function _syncFromModel() {
      const m = (window.EDIT2 && EDIT2.getVoiceModel) ? EDIT2.getVoiceModel(key) : 'v2';
      modelTts.value = m; _prevTts = m; _syncTtsPanels(); _refreshV3TagsField();
    }
    _refreshV3TagsField();
    _syncTtsPanels();

    // ── Casting — one rounded pill split into: [role] · [character ▾] · [▦ photoshoot] ──
    // The ▦ button opens a thumbnail picker of the character's saved photoshoots
    // (main-frame 9:16 previews, 3-per-row, newest top-left). The chosen photoshoot
    // drives the talking-head base image; the voice is pulled from the character card.
    _injectCastCss();
    const gCast = _el('div', 'e2-set-cast');
    gCast.style.cssText = 'border-bottom:1px solid var(--e2-shadow);padding-bottom:8px;margin-bottom:8px;';
    gCast.appendChild(_el('label', 'e2-set-sublabel', 'Casting'));
    const _isVoSess = (_sess(key) || {}).voiceKind === 'vo';
    const _roleLabel = (_sess(key) || {}).roleLabel || (_isVoSess ? 'Narrator' : 'Role');

    const pill = _el('div', 'e2-cast-pill');
    pill.appendChild(_el('span', 'e2-cast-role', _roleLabel));
    const charSel = document.createElement('select'); charSel.className = 'e2-cast-char';
    pill.appendChild(charSel);
    // ⚙ → opens the character's portfolio popup (where the voice can be regenerated).
    const gearBtn = _el('button', 'e2-cast-gear-btn', '⚙'); gearBtn.type = 'button'; gearBtn.title = 'Character portfolio — regenerate voice';
    gearBtn.addEventListener('click', () => { if (charSel.value && window.openCharacterActorPopup) window.openCharacterActorPopup(charSel.value); });
    pill.appendChild(gearBtn);
    const photoBtn = _el('button', 'e2-cast-photo-btn', '▦'); photoBtn.type = 'button'; photoBtn.title = 'Pick a photoshoot';
    if (_isVoSess) photoBtn.style.display = 'none';   // faceless voiceover → no photoshoot
    pill.appendChild(photoBtn);
    gCast.appendChild(pill);

    let _chars = [];
    const _obrazyOf = cid => { try { return ((typeof getObrazы === 'function') ? getObrazы() : []).filter(o => String(o.charId) === String(cid)); } catch { return []; } };
    const _newestFirst = list => list.slice().sort((a, b) => (Number(b.id) || 0) - (Number(a.id) || 0));
    function _setVoiceFromChar(cid) {
      const c = _chars.find(x => String(x.id) === String(cid));
      if (c && c.voice) { localStorage.setItem('edit_voice__' + key, c.voice); if (window.buildVoiceSelect) window.buildVoiceSelect(voiceSel, c.voice); voiceSel.value = c.voice; fire(); }
    }
    // Apply a photoshoot (obraz) to the session, or CLEAR it when obrazId is empty
    // (no photoshoot chosen → on-camera cells get no base image yet).
    function _applyPhoto(obrazId) {
      const s = _sess(key); if (!s) return;
      const obraz = obrazId ? (((typeof getObrazы === 'function') ? getObrazы() : []).find(o => String(o.id) === String(obrazId)) || null) : null;
      s.obrazId = obraz ? String(obraz.id) : '';
      s.obrazChar = obraz ? obraz.char : null;
      const vars = obraz ? [obraz.char].concat((obraz.variations || []).filter(v => v && v !== 'error')).filter(Boolean) : [];
      const pick = () => vars.length ? vars[Math.floor(Math.random() * vars.length)] : ((obraz && obraz.char) || null);
      (s.cells || []).forEach(c => { if (c.segKind !== 'vo') c.charImagePath = obraz ? pick() : null; });
      if (typeof saveEditState === 'function') saveEditState();
      if (hooks.onCast) { try { hooks.onCast(); } catch {} }
    }

    // Floating photoshoot thumbnail picker (3-per-row, newest top-left).
    let _photoPanel = null;
    function _onDocDown(e) { if (_photoPanel && !_photoPanel.contains(e.target) && e.target !== photoBtn) _closePhotos(); }
    function _closePhotos() { if (_photoPanel) { _photoPanel.remove(); _photoPanel = null; document.removeEventListener('mousedown', _onDocDown, true); } }
    function _openPhotos() {
      if (_photoPanel) { _closePhotos(); return; }
      const list = _newestFirst(_obrazyOf(charSel.value));
      const cur = (_sess(key) || {}).obrazId;
      const panel = _el('div', 'e2-cast-photos');
      if (!list.length) panel.appendChild(_el('div', 'e2-cast-empty', 'No photoshoots for this character.'));
      else list.forEach(o => {
        const img = document.createElement('img'); img.className = 'e2-cast-photo' + (String(o.id) === String(cur) ? ' sel' : '');
        img.src = (window.toThumbPath ? window.toThumbPath(o.char) : o.char) || o.char; img.title = o.name || String(o.id); img.loading = 'lazy';
        img.onerror = () => { img.onerror = null; img.src = o.char; };
        img.addEventListener('click', () => { _applyPhoto(o.id); _closePhotos(); });
        panel.appendChild(img);
      });
      document.body.appendChild(panel); _photoPanel = panel;
      const r = photoBtn.getBoundingClientRect();
      panel.style.top = Math.min(r.bottom + 4, window.innerHeight - panel.offsetHeight - 8) + 'px';
      panel.style.left = Math.max(8, Math.min(r.right - panel.offsetWidth, window.innerWidth - panel.offsetWidth - 8)) + 'px';
      setTimeout(() => document.addEventListener('mousedown', _onDocDown, true), 0);
    }
    photoBtn.addEventListener('click', _openPhotos);

    charSel.addEventListener('change', () => {
      _closePhotos();
      _setVoiceFromChar(charSel.value);
      // Auto-apply the photoshoot ONLY when the character has exactly one; with
      // several, default to empty so the user picks one via the ▦ button.
      if (!_isVoSess) { const list = _obrazyOf(charSel.value); _applyPhoto(list.length === 1 ? list[0].id : ''); }
    });

    // Load characters; preselect the one owning the current obraz (reflect state).
    fetch('/api/char-store/list').then(r => r.json()).then(d => {
      _chars = (d && d.chars) || [];
      charSel.innerHTML = _chars.length ? _chars.map(c => `<option value="${c.id}">${(c.name || c.id)}</option>`).join('') : '<option value="">(no characters)</option>';
      const curObrazId = (_sess(key) || {}).obrazId;
      let curCharId = null;
      if (curObrazId && curObrazId !== '__vo__') {
        const all = (typeof getObrazы === 'function') ? getObrazы() : [];
        const oo = all.find(x => String(x.id) === String(curObrazId));
        if (oo) curCharId = oo.charId;
      }
      if (curCharId != null && _chars.some(c => String(c.id) === String(curCharId))) charSel.value = String(curCharId);
      // Skip-cast projects open with no voice yet → seed it from the shown character.
      if (!localStorage.getItem('edit_voice__' + key)) _setVoiceFromChar(charSel.value);
      // Skip-cast (no obraz yet) + the shown character has exactly ONE photoshoot
      // → auto-apply it. With several, leave empty (the user picks via ▦).
      if (!_isVoSess && !(_sess(key) || {}).obrazId) {
        const list = _obrazyOf(charSel.value);
        if (list.length === 1) _applyPhoto(list[0].id);
      }
    }).catch(() => { charSel.innerHTML = '<option value="">(failed to load characters)</option>'; });
    // casting (gCast) is mounted as its own "Cast" accordion in the assembly below

    // (groups appended below in Image | Voice | Video order, like Edit v1)

    // ── Image group (negative prompt) ──────────────────────────────────────────
    const gI = _el('div', 'e2-set-group');
    gI.appendChild(_el('div', 'e2-set-title', 'Image'));
    // Image engine (global → carries to new projects) + its params
    const ENG_LABELS = { 'nano-banana-2': 'nano-banana-2', 'qwen2': 'Qwen2', 'seedream': 'Seedream', 'seedream4.5': 'Seedream 4.5', 'gptimage2': 'GPT Image 2' };
    const engRow = _el('div', 'e2-set-row');
    const engSel = document.createElement('select'); engSel.className = 'e2-set-select';
    ['nano-banana-2', 'qwen2', 'seedream', 'seedream4.5', 'gptimage2'].forEach(id => { const o = document.createElement('option'); o.value = id; o.textContent = ENG_LABELS[id] || id; engSel.appendChild(o); });
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
      // The per-fragment "Motion" generation button now lives in the project's gen
      // bar (between Mixes and Videos). Here we keep only the editable per-scenario
      // motion prompt + a Reload to re-pull it from the backend.
      const reload = _el('button', 'e2-btn', '↺ Reload');
      reload.addEventListener('click', () => _loadMotion(modelSel.value));
      const motionRow = _el('div', 'e2-set-row');
      reload.style.marginLeft = 'auto';
      motionRow.appendChild(reload);
      gVid.appendChild(motionTa); gVid.appendChild(motionRow);
      modelSel.addEventListener('change', () => _loadMotion(modelSel.value));
      _loadMotion(modelSel.value);
    }

    // Mount as collapsed accordions in the left settings column: Cast · Voice · Video · Image.
    const _acc = (title, el, sumCls) => { const d = _el('details', 'e2-acc'); d.appendChild(_el('summary', 'e2-acc-sum' + (sumCls ? ' ' + sumCls : ''), title)); d.appendChild(el); return d; };
    root.appendChild(_acc('🎭 Cast', gCast));
    root.appendChild(_acc('🎙 Voice', gV, 'e2-voice-sum'));   // the v2/v3 model badge docks into this summary (from edit2-popup)
    root.appendChild(_acc('🎬 Video', gVid));
    root.appendChild(_acc('🖼 Image', gI));

    const summary = () => 'Voice: ' + _voiceName(voiceSel.value) + ' · Image: ' + ((typeof getImageEngine === 'function' ? getImageEngine() : '—')) + ' · Video: ' + _modelLabel(modelSel.value);
    return {
      node: root, summary: summary,
      refreshGating: function () { try { _refreshGating(); } catch {} },
      syncModel: function () { try { _syncFromModel(); } catch {} },
    };
  };

  window.EDIT2Settings = EDIT2Settings;
})();
