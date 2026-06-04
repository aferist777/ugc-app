/* ═══════════════════════════════════════════════════════════════════
   SCENARIO AI — "🤖 Generate with AI" section inside the New Scenario
   popup.

   Layout: two columns. LEFT — user inputs (gender, product, audience,
   emotion+desc, style+desc, must-include, additional notes, examples
   list). RIGHT — model dropdown, Generate + History at the top, then
   the output textarea + Regen/Tighten/Expand + Save row.

   All UI strings are English. The LLM output is enforced to be English
   server-side via the system prompt (and post-processed to 1 line per
   scene, no blank lines between scenes).

   Auto-name template:
     "<Product Name OR untitled> #N - <m|f> - <emotion> - <style>.txt"
   Where N is the per-product counter (count of existing scenarios-meta
   entries with the same product, +1). For empty product → "untitled".
   ═══════════════════════════════════════════════════════════════════ */

(function () {
  const $ = id => document.getElementById(id);

  const MODEL_OPTIONS = [
    { id: 'nousresearch/hermes-3-llama-3.1-70b',           label: 'Hermes 3 Llama 70B (uncensored)' },
    { id: 'cognitivecomputations/dolphin-3.0-mistral-24b', label: 'Dolphin 3.0 Mistral 24B (uncensored)' },
    { id: 'anthropic/claude-sonnet-4.6',                   label: 'Claude Sonnet 4.6 (best quality, moderated)' },
    { id: 'openai/gpt-4o',                                 label: 'GPT-4o (balanced)' },
    { id: 'google/gemini-pro-1.5',                         label: 'Gemini Pro 1.5 (cheap)' },
  ];

  let _modelsLoaded = false;
  let _examplesLoaded = false;
  const _historyByPopupSession = [];     // [{ text, ts, opMode }]
  let _lastUsedExampleFiles = [];

  // Catalog cache for the current gender — used to look up descriptions.
  let _currentCatalog = { emotions: [], styles: [] };

  // Cache of all scenarios-meta on popup open, used to compute the
  // per-product counter for the auto-name. Refreshed each Save.
  let _scenariosMetaCache = {};

  // Tracks whether the user manually edited the Name input. Once true, we
  // stop auto-updating it on field changes.
  let _nameUserDirty = false;

  // ── Scenario type + multi-role state (Phase 1) ──────────────────────────────
  let _typesLoaded = false;
  let _roles       = [{ name: 'Host', charId: '' }, { name: 'Guest', charId: '' }];
  let _actorsCache = [];   // saved characters, for binding roles → actors

  function _currentType() { return $('ai-type')?.value || 'ugc_ad'; }
  function _isMulti()     { return !!$('ai-multi')?.checked; }

  async function _loadActors() {
    try {
      const d = await fetch('/api/char-store/list').then(r => r.json());
      _actorsCache = (d && d.success && Array.isArray(d.chars)) ? d.chars : [];
    } catch { _actorsCache = []; }
  }

  function _fillTypes(types) {
    const sel = $('ai-type');
    if (!sel) return;
    sel.innerHTML = '';
    (types || []).forEach(t => {
      const o = document.createElement('option');
      o.value = t.id; o.textContent = t.label;
      o.dataset.defaultMulti = t.defaultMulti ? '1' : '';
      sel.appendChild(o);
    });
    _typesLoaded = true;
  }

  function _actorOptionsHtml(selectedId) {
    let html = '<option value="">— unbound —</option>';
    _actorsCache.forEach(c => {
      const s = String(c.id) === String(selectedId) ? ' selected' : '';
      html += `<option value="${c.id}"${s}>${(c.name || 'Character').replace(/</g, '&lt;')}</option>`;
    });
    return html;
  }

  function _renderRoles() {
    const list = $('ai-roles-list');
    if (!list) return;
    list.innerHTML = '';
    _roles.forEach((role, i) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:4px;align-items:center;';
      const name = document.createElement('input');
      name.type = 'text'; name.value = role.name || ''; name.placeholder = 'Role';
      name.style.cssText = 'flex:0 0 84px;font-size:10px;padding:2px 4px;';
      name.addEventListener('input', () => { _roles[i].name = name.value; });
      const actor = document.createElement('select');
      actor.style.cssText = 'flex:1;font-size:10px;padding:2px 4px;min-width:0;';
      actor.innerHTML = _actorOptionsHtml(role.charId);
      actor.addEventListener('change', () => { _roles[i].charId = actor.value; });
      const del = document.createElement('button');
      del.type = 'button'; del.textContent = '✕'; del.title = 'Remove role';
      del.style.cssText = 'flex:0 0 auto;font-size:10px;padding:2px 6px;cursor:pointer;';
      del.addEventListener('click', () => { if (_roles.length > 1) { _roles.splice(i, 1); _renderRoles(); } });
      row.appendChild(name); row.appendChild(actor); row.appendChild(del);
      list.appendChild(row);
    });
  }

  function _toggleRolesBlock() {
    const block = $('ai-roles-block');
    if (block) block.style.display = _isMulti() ? '' : 'none';
    if (_isMulti()) {
      if (!_roles.length) _roles = [{ name: 'Host', charId: '' }, { name: 'Guest', charId: '' }];
      _renderRoles();
    }
  }

  function _rolesForSubmit() {
    return _roles
      .map((r, i) => ({ id: 'r' + i, name: (r.name || '').trim() || ('Role' + (i + 1)), charId: r.charId || null }))
      .filter(r => r.name);
  }

  function _setStatus(text, isError) {
    const el = $('ai-status');
    if (!el) return;
    el.textContent = text || '';
    el.style.color = isError ? '#a33' : '#555';
  }

  function _currentGender() {
    const v = $('ai-gender')?.value;
    return (v === 'men') ? 'men' : 'women';
  }

  function _fillModelsDropdown() {
    if (_modelsLoaded) return;
    const modelSel = $('ai-model');
    if (!modelSel) return;
    MODEL_OPTIONS.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id; opt.textContent = m.label;
      modelSel.appendChild(opt);
    });
    _modelsLoaded = true;
  }

  // ── Description preview helpers ──────────────────────────────────────────
  function _updateEmotionDesc() {
    const id = $('ai-emotion')?.value || '';
    const entry = _currentCatalog.emotions.find(e => e.id === id);
    const el = $('ai-emotion-desc');
    if (el) el.textContent = entry?.desc || '';
  }
  function _updateStyleDesc() {
    const id = $('ai-style')?.value || '';
    const entry = _currentCatalog.styles.find(s => s.id === id);
    const el = $('ai-style-desc');
    if (el) el.textContent = entry?.desc || '';
  }

  async function _loadEmotionsStyles(gender) {
    try {
      const r = await fetch(`/api/scenarios/ai/options?gender=${encodeURIComponent(gender)}`);
      const d = await r.json();
      if (!d.success) return;
      _currentCatalog = { emotions: d.emotions || [], styles: d.styles || [] };
      if (!_typesLoaded && Array.isArray(d.types)) _fillTypes(d.types);

      const emoSel   = $('ai-emotion');
      const styleSel = $('ai-style');
      if (!emoSel || !styleSel) return;

      const prevEmo   = emoSel.value;
      const prevStyle = styleSel.value;

      emoSel.innerHTML   = '<option value="">— (none) —</option>';
      styleSel.innerHTML = '<option value="">— (none) —</option>';
      _currentCatalog.emotions.forEach(e => {
        const opt = document.createElement('option');
        opt.value = e.id; opt.textContent = e.label;
        emoSel.appendChild(opt);
      });
      _currentCatalog.styles.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.id; opt.textContent = s.label;
        styleSel.appendChild(opt);
      });

      if (prevEmo   && emoSel.querySelector(`option[value="${prevEmo}"]`))     emoSel.value   = prevEmo;
      if (prevStyle && styleSel.querySelector(`option[value="${prevStyle}"]`)) styleSel.value = prevStyle;

      _updateEmotionDesc();
      _updateStyleDesc();
      _updateAutoName();
    } catch (e) {
      console.warn('[scenario-ai] options load failed:', e.message);
    }
  }

  // ── Auto-name computation ────────────────────────────────────────────────
  // Template: "<Product OR untitled> #N - <m|f> - <emotion> - <style>"
  // N = (existing meta entries with same product) + 1.
  async function _loadScenariosMeta() {
    try {
      const r = await fetch('/api/scenarios-all-meta');
      const d = await r.json();
      _scenariosMetaCache = (d.success ? d.meta : {}) || {};
    } catch { _scenariosMetaCache = {}; }
  }
  function _computeAutoName() {
    const product = ($('ai-product')?.value || '').trim();
    const key     = product || 'untitled';
    const keyLc   = key.toLowerCase();
    // Count existing meta entries with the same product (case-insensitive).
    let count = 0;
    for (const m of Object.values(_scenariosMetaCache)) {
      const p = ((m && m.product) || '').trim().toLowerCase();
      if (p === keyLc) count++;
    }
    const n = count + 1;
    const g = _currentGender() === 'men' ? 'm' : 'f';
    const emotion = $('ai-emotion')?.value || 'none';
    const style   = $('ai-style')?.value   || 'none';
    // Append must-include items (first 3 trimmed, joined by comma) as a `+`
    // suffix so the file name immediately tells you which props the recipe
    // is built around — e.g. "Product A #2 - f - aspiration - expert + vick, cucumber, honey".
    const rawIngr = ($('ai-ingredients')?.value || '').trim();
    let itemsSuffix = '';
    if (rawIngr) {
      const items = rawIngr
        .split(/[,;\n]+/)
        .map(s => s.trim())
        .filter(Boolean)
        .slice(0, 3)
        .join(', ');
      if (items) itemsSuffix = ' + ' + items.slice(0, 40);
    }
    return `${key} #${n} - ${g} - ${emotion} - ${style}${itemsSuffix}`;
  }
  function _updateAutoName() {
    if (_nameUserDirty) return; // user typed their own — don't override
    const input = $('ai-save-name');
    if (!input) return;
    input.value = _computeAutoName();
  }

  // ── Examples picker — removed ────────────────────────────────────────────
  // The picker UI was retired together with the dynamic example pipeline.
  // Reference scripts (4 vick/cucumber-honey) are now hardcoded on the server
  // in routes/scenarios.js → _getHardcodedExamples(). Stubs are kept so any
  // residual callers don't throw.
  function _loadExamplesList() { /* no-op — server uses hardcoded refs */ }
  function _selectedExampleFiles() { return []; }
  function _updateCounter() {
    // Generate button is always usable now (no examples to pick).
    const genBtn = $('ai-generate-btn');
    if (genBtn) { genBtn.disabled = false; genBtn.title = ''; }
  }

  // Scenes-range select — persist last-used choice across popup opens so
  // user doesn't reselect every time.
  const SCENES_RANGE_KEY = 'scenario_ai_scenes_range_v1';
  function _currentScenesRange() {
    const sel = $('ai-scenes-range');
    const v = sel?.value || localStorage.getItem(SCENES_RANGE_KEY) || '14-17';
    const allowed = ['10-13','14-17','18-22'];
    return allowed.includes(v) ? v : '14-17';
  }

  function _collectBody(opMode) {
    return {
      gender:       _currentGender(),
      type:         _currentType(),
      mode:         _isMulti() ? 'multi' : 'single',
      roles:        _isMulti() ? _rolesForSubmit() : undefined,
      structured: {
        product:     $('ai-product')?.value.trim()     || '',
        audience:    $('ai-audience')?.value.trim()    || '',
        emotion:     $('ai-emotion')?.value             || '',
        style:       $('ai-style')?.value               || '',
        ingredients: $('ai-ingredients')?.value.trim() || '',
      },
      notes:        $('ai-notes')?.value.trim() || '',
      scenesRange:  _currentScenesRange(),
      model:        $('ai-model')?.value || MODEL_OPTIONS[0].id,
      opMode,
      prevText:     (opMode === 'tighten' || opMode === 'expand') ? ($('ai-output')?.value || '') : '',
    };
  }

  async function _callGenerate(opMode) {
    const body = _collectBody(opMode);

    const buttons = ['ai-generate-btn','ai-regen-btn','ai-tighten-btn','ai-expand-btn','ai-save-btn'];
    buttons.forEach(id => { const b = $(id); if (b) b.disabled = true; });
    _setStatus('⏳ Generating…');

    try {
      const r = await fetch('/api/scenarios/ai/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error || 'generation failed');

      const out = $('ai-output');
      if (out) out.value = d.text;

      _historyByPopupSession.unshift({ text: d.text, ts: Date.now(), opMode });
      if (_historyByPopupSession.length > 5) _historyByPopupSession.length = 5;
      _renderHistory();

      const meta = d.meta || {};
      _setStatus(`✅ Generated (${meta.exampleCount} examples · avg ${meta.avgScenes} scenes · ~${meta.avgTotalChars} chars · via ${meta.modelUsed?.split('/').pop() || ''})`);
    } catch (e) {
      _setStatus('⚠ ' + e.message, true);
    } finally {
      $('ai-generate-btn').disabled = false;
      const hasText = !!($('ai-output')?.value || '').trim();
      ['ai-regen-btn','ai-tighten-btn','ai-expand-btn','ai-save-btn'].forEach(id => {
        const b = $(id); if (b) b.disabled = !hasText;
      });
    }
  }

  function _renderHistory() {
    const sel = $('ai-history-sel');
    if (!sel) return;
    sel.innerHTML = '';
    if (!_historyByPopupSession.length) {
      const opt = document.createElement('option');
      opt.value = ''; opt.textContent = '—';
      sel.appendChild(opt);
      return;
    }
    _historyByPopupSession.forEach((h, i) => {
      const opt = document.createElement('option');
      opt.value = String(i);
      const tag = h.opMode === 'regenerate' ? '↻' : h.opMode === 'tighten' ? '🔽' : h.opMode === 'expand' ? '🔼' : '✨';
      opt.textContent = `v${_historyByPopupSession.length - i} ${tag}`;
      sel.appendChild(opt);
    });
    sel.value = '0';
  }

  function _wireHistorySwitch() {
    const sel = $('ai-history-sel');
    sel?.addEventListener('change', () => {
      const idx = parseInt(sel.value, 10);
      if (!isNaN(idx) && _historyByPopupSession[idx]) {
        const out = $('ai-output');
        if (out) out.value = _historyByPopupSession[idx].text;
      }
    });
  }

  async function _save() {
    const text = ($('ai-output')?.value || '').trim();
    if (!text) { _setStatus('Output is empty — generate first', true); return; }

    let name = ($('ai-save-name')?.value || '').trim();
    if (!name) name = _computeAutoName();

    const btn = $('ai-save-btn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Saving…'; }
    try {
      const r = await fetch('/api/scenarios/ai/save-with-meta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          textBase64: btoa(unescape(encodeURIComponent(text))),
          name,
          gender:  _currentGender(),
          emotion: $('ai-emotion')?.value || '',
          style:   $('ai-style')?.value   || '',
          product: $('ai-product')?.value.trim() || '',
          model:   $('ai-model')?.value   || '',
          type:    _currentType(),
          mode:    _isMulti() ? 'multi' : 'single',
          roles:   _isMulti() ? _rolesForSubmit() : undefined,
        }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error || 'save failed');
      _setStatus(`✅ Saved as ${d.filename}${d.meta?.motionPrompt ? ' · motion clause cached' : ''}`);
      // Refresh meta cache so the next auto-name reflects the new entry's
      // increment, then re-fill name with the next suggestion.
      await _loadScenariosMeta();
      _nameUserDirty = false;
      _updateAutoName();
      await window.loadScenarios?.();
    } catch (e) {
      _setStatus('⚠ ' + e.message, true);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '💾 Save'; }
    }
  }

  function _wire() {
    const ai = $('scenario-ai-section');
    ai?.addEventListener('toggle', async () => {
      if (ai.open) {
        _fillModelsDropdown();
        await _loadEmotionsStyles(_currentGender());
        await _loadActors();
        _toggleRolesBlock();
        _loadExamplesList();
        await _loadScenariosMeta();
        _updateAutoName();
        _updateCounter();
      }
    });
    document.getElementById('btn-scen-new')?.addEventListener('click', () => {
      setTimeout(() => {
        if ($('scenario-ai-section')?.open) {
          _loadExamplesList();
          _loadScenariosMeta().then(() => _updateAutoName());
        }
      }, 100);
    });

    $('ai-gender')?.addEventListener('change', () => {
      _loadEmotionsStyles(_currentGender());
    });
    $('ai-emotion')?.addEventListener('change', () => { _updateEmotionDesc(); _updateAutoName(); });
    $('ai-style')?.addEventListener('change',   () => { _updateStyleDesc();   _updateAutoName(); });
    // Scenario type: auto-enable multi-role for dialogue-style types.
    $('ai-type')?.addEventListener('change', () => {
      const opt = $('ai-type')?.selectedOptions?.[0];
      if (opt && opt.dataset.defaultMulti) { const m = $('ai-multi'); if (m) m.checked = true; }
      _toggleRolesBlock();
    });
    $('ai-multi')?.addEventListener('change', _toggleRolesBlock);
    $('ai-role-add')?.addEventListener('click', () => { _roles.push({ name: '', charId: '' }); _renderRoles(); });
    $('ai-product')?.addEventListener('input',  _updateAutoName);
    // Ingredients now flow into the auto-name suffix so the file name reflects
    // which props the recipe is built around.
    $('ai-ingredients')?.addEventListener('input', _updateAutoName);

    // ── Analyze product button ────────────────────────────────────────────
    // Sends product name + current notes (any language) to gemini-3.5-flash,
    // REPLACES the notes textarea with the one-sentence English analysis.
    $('ai-analyze-product-btn')?.addEventListener('click', async () => {
      const btn  = $('ai-analyze-product-btn');
      const prod = ($('ai-product')?.value || '').trim();
      if (!prod) { _setStatus('Fill in Product name first', true); return; }
      btn.disabled = true; const origText = btn.textContent; btn.textContent = '⏳';
      _setStatus('Analysing product…');
      try {
        const r = await fetch('/api/scenarios/ai/analyze-product', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ product: prod, notes: $('ai-notes')?.value || '' }),
        });
        const d = await r.json();
        if (!d.success) throw new Error(d.error || 'Analyze failed');
        const notesEl = $('ai-notes');
        if (notesEl) notesEl.value = d.analysis;
        _setStatus('Product analysis ready');
      } catch (e) {
        _setStatus('⚠ ' + e.message, true);
      } finally {
        btn.disabled = false; btn.textContent = origText;
      }
    });

    // Restore + persist scenes-range choice.
    const _scenesSel = $('ai-scenes-range');
    if (_scenesSel) {
      const _savedRange = localStorage.getItem(SCENES_RANGE_KEY);
      if (_savedRange && _scenesSel.querySelector(`option[value="${_savedRange}"]`)) {
        _scenesSel.value = _savedRange;
      }
      _scenesSel.addEventListener('change', () => {
        localStorage.setItem(SCENES_RANGE_KEY, _scenesSel.value);
      });
    }

    // User typing in the Name input → stop auto-overwriting it.
    $('ai-save-name')?.addEventListener('input', () => { _nameUserDirty = true; });

    $('ai-generate-btn')?.addEventListener('click', () => _callGenerate('fresh'));
    $('ai-regen-btn')   ?.addEventListener('click', () => _callGenerate('regenerate'));
    $('ai-tighten-btn') ?.addEventListener('click', () => _callGenerate('tighten'));
    $('ai-expand-btn')  ?.addEventListener('click', () => _callGenerate('expand'));
    $('ai-save-btn')    ?.addEventListener('click', _save);

    $('ai-output')?.addEventListener('input', () => {
      const has = !!($('ai-output').value || '').trim();
      ['ai-regen-btn','ai-tighten-btn','ai-expand-btn','ai-save-btn'].forEach(id => {
        const b = $(id); if (b) b.disabled = !has;
      });
    });

    _wireHistorySwitch();
    _updateCounter();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _wire);
  } else {
    _wire();
  }
})();
