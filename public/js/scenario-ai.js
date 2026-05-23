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
    return `${key} #${n} - ${g} - ${emotion} - ${style}`;
  }
  function _updateAutoName() {
    if (_nameUserDirty) return; // user typed their own — don't override
    const input = $('ai-save-name');
    if (!input) return;
    input.value = _computeAutoName();
  }

  // ── Examples picker (left column) ────────────────────────────────────────
  function _loadExamplesList() {
    const host = $('ai-examples-list');
    if (!host) return;
    const files = (typeof window.scenarioFiles !== 'undefined' && Array.isArray(window.scenarioFiles))
      ? window.scenarioFiles
      : (typeof scenarioFiles !== 'undefined' && Array.isArray(scenarioFiles) ? scenarioFiles : []);

    host.innerHTML = '';
    if (!files.length) {
      host.innerHTML = '<div style="color:#888;">No scenarios in the list yet — upload one first, then come back.</div>';
      _updateCounter();
      return;
    }
    files.forEach(f => {
      const row = document.createElement('label');
      row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:2px 0;cursor:pointer;';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = f.file;
      cb.className = 'ai-example-cb';
      cb.addEventListener('change', _updateCounter);
      const txt = document.createElement('span');
      txt.textContent = f.name || f.file;
      row.appendChild(cb);
      row.appendChild(txt);
      host.appendChild(row);
    });
    _examplesLoaded = true;
    _updateCounter();
  }

  function _selectedExampleFiles() {
    return Array.from(document.querySelectorAll('#ai-examples-list input.ai-example-cb:checked'))
      .map(cb => cb.value);
  }
  function _updateCounter() {
    const n = _selectedExampleFiles().length;
    const el = $('ai-examples-counter');
    if (el) {
      el.textContent = `${n} selected`;
      el.style.color = (n >= 2 && n <= 5) ? '#0a0' : '#a55';
    }
    const ok = n >= 2 && n <= 5;
    const genBtn = $('ai-generate-btn');
    if (genBtn) {
      genBtn.disabled = !ok;
      genBtn.title = ok ? '' : 'Select 2 to 5 example scenarios first';
    }
  }

  function _collectBody(opMode) {
    return {
      gender:       _currentGender(),
      structured: {
        product:     $('ai-product')?.value.trim()     || '',
        audience:    $('ai-audience')?.value.trim()    || '',
        emotion:     $('ai-emotion')?.value             || '',
        style:       $('ai-style')?.value               || '',
        ingredients: $('ai-ingredients')?.value.trim() || '',
      },
      notes:        $('ai-notes')?.value.trim() || '',
      exampleFiles: _lastUsedExampleFiles.length ? _lastUsedExampleFiles : _selectedExampleFiles(),
      model:        $('ai-model')?.value || MODEL_OPTIONS[0].id,
      opMode,
      prevText:     (opMode === 'tighten' || opMode === 'expand') ? ($('ai-output')?.value || '') : '',
    };
  }

  async function _callGenerate(opMode) {
    const body = _collectBody(opMode);
    if (!body.exampleFiles.length || body.exampleFiles.length < 2) {
      _setStatus('Select 2-5 examples first', true);
      return;
    }
    if (opMode === 'fresh') {
      _lastUsedExampleFiles = body.exampleFiles.slice();
    }

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
      $('ai-generate-btn').disabled = (_selectedExampleFiles().length < 2);
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
    $('ai-product')?.addEventListener('input',  _updateAutoName);

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
