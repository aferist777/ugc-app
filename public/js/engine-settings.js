/* ═══════════════════════════════════════════════════════════════════
   ENGINE SETTINGS — per-model default parameters.

   Two consumers:
   1. Character tab: ⚙ button next to <select id="char-image-engine">
      → opens the engine-settings popup for the currently selected
      character image engine.
   2. Biroly tab: reuses ENGINE_SCHEMAS via window.buildEngineSettingsRow()
      to render image- and video-engine params inside its own combined
      "Engines" popup.

   Defaults persist to data/settings.json → engineDefaults[<engineId>]
   via POST /api/settings. Applied at generation time by lib/helpers.js
   (_getEngineDefaults). The biroly tab also mirrors values into the
   legacy LS key engine_params__v1__<engineId> so existing biroly code
   that reads getEngineParams() works without change.
   ═══════════════════════════════════════════════════════════════════ */

(function () {
  // Engine schemas — what fields to render for each engine.
  // type: 'select'  → option list
  //       'number'  → bounded numeric input
  //       'bool'    → On/Off select
  const ENGINE_SCHEMAS = {
    'nano-banana-2': {
      label: 'nano-banana-2 (Google)',
      kind: 'image',
      capabilities: ['t2i', 'i2i'],
      fields: [
        { key: 'aspect_ratio',  label: 'Aspect ratio',  type: 'select', default: '9:16',
          options: ['match_input_image','1:1','9:16','16:9','2:3','3:2','3:4','4:3','4:5','5:4','21:9'],
          desc: '"match_input_image" сохраняет соотношение исходного изображения (image-to-image).' },
        { key: 'resolution',    label: 'Resolution',    type: 'select', default: '2K',
          options: ['1K','2K','4K'],
          desc: 'Размер выходного изображения. 4K заметно медленнее.' },
        { key: 'image_search',  label: 'Image search',  type: 'bool', default: false,
          desc: 'Google Image Search grounding для визуального контекста.' },
        { key: 'google_search', label: 'Web search',    type: 'bool', default: false,
          desc: 'Google Web Search grounding (новости, погода и т.д.).' },
      ],
    },
    'qwen2': {
      label: 'qwen-image-edit-plus (Qwen)',
      kind: 'image',
      capabilities: ['i2i'],
      desc: 'Только image-to-image — для text-to-image fallback на seedream.',
      fields: [
        { key: 'aspect_ratio',  label: 'Aspect ratio',  type: 'select', default: 'match_input_image',
          options: ['match_input_image','1:1','9:16','16:9','4:3','3:4'] },
        { key: 'output_quality',label: 'Output quality',type: 'number', default: 95, min: 0, max: 100,
          desc: 'JPEG-качество 0-100. 95 = практически без потерь.' },
        { key: 'go_fast',       label: 'Fast mode',     type: 'bool', default: true,
          desc: 'Быстрее, но чуть менее детализировано.' },
        { key: 'disable_safety_checker', label: 'Disable safety', type: 'bool', default: false,
          desc: '⚠️ Отключает фильтр контента. Используйте только если NSFW false-positives мешают.' },
      ],
    },
    'seedream': {
      label: 'seedream-5-lite (ByteDance)',
      kind: 'image',
      capabilities: ['t2i', 'i2i'],
      fields: [
        { key: 'aspect_ratio',  label: 'Aspect ratio',  type: 'select', default: '9:16',
          options: ['match_input_image','1:1','9:16','16:9','2:3','3:2','3:4','4:3'] },
        { key: 'size',          label: 'Resolution',    type: 'select', default: '2K',
          options: ['2K','3K'],
          desc: 'Разрешение выхода: 2K (2048px) или 3K (3072px).' },
        { key: 'max_images',    label: 'Max images',    type: 'number', default: 1, min: 1, max: 15,
          desc: 'Используется только когда sequential_image_generation = auto.' },
        { key: 'sequential_image_generation', label: 'Sequential', type: 'select', default: 'disabled',
          options: ['disabled','auto'],
          desc: 'auto: модель сама решает делать ли серию связанных изображений.' },
      ],
    },
    'seedream4.5': {
      label: 'Seedream 4.5',
      kind: 'image',
      capabilities: ['t2i', 'i2i'],
      fields: [
        { key: 'aspect_ratio',  label: 'Aspect ratio',  type: 'select', default: '9:16',
          options: ['match_input_image','1:1','9:16','16:9','4:5','5:4','2:3','3:2','3:4','4:3','21:9','9:21'] },
        { key: 'size',          label: 'Resolution',    type: 'select', default: '2K',
          options: ['2K','4K'],
          desc: 'Разрешение выхода: 2K (2048px) или 4K. Быстрее 5 Lite.' },
        { key: 'max_images',    label: 'Max images',    type: 'number', default: 1, min: 1, max: 15,
          desc: 'Используется только когда sequential_image_generation = auto.' },
        { key: 'sequential_image_generation', label: 'Sequential', type: 'select', default: 'disabled',
          options: ['disabled','auto'],
          desc: 'auto: модель сама решает делать ли серию связанных изображений.' },
      ],
    },
    'gptimage2': {
      label: 'gpt-image-2 (OpenAI)',
      kind: 'image',
      capabilities: ['t2i', 'i2i'],
      fields: [
        { key: 'aspect_ratio',  label: 'Aspect ratio',  type: 'select', default: '9:16',
          options: ['1:1','9:16','16:9','2:3','3:2','3:4','4:3'] },
        { key: 'quality',       label: 'Quality',       type: 'select', default: 'auto',
          options: ['auto','high','medium','low'],
          desc: 'auto балансирует скорость/качество.' },
        { key: 'background',    label: 'Background',    type: 'select', default: 'auto',
          options: ['auto','opaque','transparent'],
          desc: 'transparent → PNG с альфой (полезно для ассетов).' },
        { key: 'moderation',    label: 'Moderation',    type: 'select', default: 'auto',
          options: ['auto','low'],
          desc: 'low — менее строгая фильтрация контента.' },
      ],
    },
    'imagen-4-ultra': {
      label: 'imagen-4-ultra (Google)',
      kind: 'image',
      capabilities: ['t2i'],
      desc: 'Только text-to-image. Используется для генерации props на белом фоне.',
      fields: [
        { key: 'aspect_ratio',  label: 'Aspect ratio',  type: 'select', default: '1:1',
          options: ['1:1','9:16','16:9','3:4','4:3'] },
        { key: 'output_format', label: 'Output format', type: 'select', default: 'jpg',
          options: ['jpg','png'] },
        { key: 'safety_filter_level', label: 'Safety filter', type: 'select', default: 'block_only_high',
          options: ['block_low_and_above','block_medium_and_above','block_only_high'],
          desc: 'Строгость фильтрации. block_only_high — самый мягкий.' },
      ],
    },
    // ── Talking-head / avatar engines ────────────────────────────────────────
    // No user-tunable params for kie.ai Kling — image_url/audio_url/prompt
    // come from the call site automatically. Kept here just so the gen-
    // settings popup can show "(no editable params)" instead of erroring.
    'kling/ai-avatar-standard': {
      label: 'Kling AI Avatar Standard (kie.ai · 720p · $0.04/s · max 15s)',
      kind: 'avatar',
      provider: 'kie.ai',
      capabilities: ['lipsync'],
      pricePerSec: 0.04,
      resolution:  '720p',
      maxAudioSec: 15,
      fields: [],
    },
    'kling/ai-avatar-pro': {
      label: 'Kling AI Avatar Pro (kie.ai · 1080p · $0.08/s · max 15s)',
      kind: 'avatar',
      provider: 'kie.ai',
      capabilities: ['lipsync'],
      pricePerSec: 0.08,
      resolution:  '1080p',
      maxAudioSec: 15,
      fields: [],
    },
    'prunaai/p-video-avatar': {
      label: 'p-video-avatar (replicate · $0.025/s @720p · $0.045/s @1080p · no audio limit)',
      kind: 'avatar',
      provider: 'replicate',
      capabilities: ['lipsync'],
      // Two-tier pricing — UI looks up by selected `resolution`.
      pricePerSecByResolution: { '720p': 0.025, '1080p': 0.045 },
      maxAudioSec: null, // no documented limit
      fields: [
        { key: 'resolution', label: 'Resolution', type: 'select', default: '720p',
          options: ['720p','1080p'],
          desc: '720p = $0.025/s, 1080p = $0.045/s.' },
        { key: 'disable_safety_filter', label: 'Disable safety filter', type: 'bool', default: true,
          desc: 'Replicate default is also true — leave on unless you need stricter moderation.' },
        { key: 'disable_prompt_upsampling', label: 'Disable prompt upsampling', type: 'bool', default: false,
          desc: 'When ON, the model uses video_prompt verbatim. OFF lets it auto-enhance.' },
        { key: 'seed', label: 'Seed (shared across project)', type: 'number', default: 0,
          desc: 'Same seed for every fragment of the project gives a consistent look. 0 = no seed (random).' },
      ],
    },
    // ── Video engines ───────────────────────────────────────────────────────
    'grok-imagine/image-to-video': {
      label: 'Grok Imagine — image-to-video',
      kind: 'video',
      capabilities: ['i2v'],
      fields: [
        { key: 'duration',     label: 'Duration (sec)', type: 'number', default: 6, min: 6, max: 30,
          desc: 'Длина видео в секундах (6–30).' },
        { key: 'resolution',   label: 'Resolution',     type: 'select', default: '480p',
          options: ['480p','720p'],
          desc: '480p быстрее, 720p выше качества.' },
        { key: 'aspect_ratio', label: 'Aspect ratio',   type: 'select', default: '9:16',
          options: ['9:16','16:9','1:1','2:3','3:2'] },
        { key: 'mode',         label: 'Mode',           type: 'select', default: 'normal',
          options: ['normal','fun','spicy'],
          desc: 'normal — стандарт, fun — динамика, spicy — особый режим.' },
      ],
    },
    'grok-imagine/text-to-video': {
      label: 'Grok Imagine — text-to-video',
      kind: 'video',
      capabilities: ['t2v'],
      fields: [
        { key: 'duration',     label: 'Duration (sec)', type: 'number', default: 6, min: 6, max: 30 },
        { key: 'resolution',   label: 'Resolution',     type: 'select', default: '480p',
          options: ['480p','720p'] },
        { key: 'aspect_ratio', label: 'Aspect ratio',   type: 'select', default: '9:16',
          options: ['9:16','16:9','1:1','2:3','3:2'] },
        { key: 'mode',         label: 'Mode',           type: 'select', default: 'normal',
          options: ['normal','fun'] },
      ],
    },
    // p-video (Replicate, prunaai) — supports t2v and i2v in one endpoint.
    // Pricing: $0.02/sec @ 720p, $0.04/sec @ 1080p; draft mode = ¼ cost + 4× faster.
    'prunaai/p-video': {
      label: 'p-video (Replicate · t2v + i2v · $0.02-0.04/s · draft ¼ cost)',
      kind: 'video',
      capabilities: ['t2v', 'i2v'],
      pricePerSecByResolution: { '720p': 0.02, '1080p': 0.04 },
      desc: 'Fast t2v + i2v from prunaai. Draft mode = 4× faster + 4× cheaper preview.',
      fields: [
        { key: 'duration',     label: 'Duration (sec)', type: 'number', default: 5, min: 1, max: 20,
          desc: 'Video length 1-20 s. Ignored when audio is provided.' },
        { key: 'aspect_ratio', label: 'Aspect ratio',   type: 'select', default: '16:9',
          options: ['16:9','9:16','4:3','3:4','3:2','2:3','1:1'],
          desc: 'Ignored when an input image is provided (i2v keeps the image AR).' },
        { key: 'resolution',   label: 'Resolution',     type: 'select', default: '720p',
          options: ['720p','1080p'],
          desc: '720p $0.02/s · 1080p $0.04/s (¼ in draft mode).' },
        { key: 'fps',          label: 'FPS',            type: 'select', default: '24',
          options: ['24','48'] },
        { key: 'draft',        label: 'Draft mode',     type: 'bool', default: false,
          desc: 'Low-quality preview, 4× faster + 4× cheaper.' },
        { key: 'prompt_upsampling', label: 'Prompt upsampling', type: 'bool', default: true,
          desc: 'Auto-enhance the prompt before generation.' },
        { key: 'save_audio',   label: 'Save audio',     type: 'bool', default: true,
          desc: 'Include audio in the output video (when audio is provided).' },
        { key: 'disable_safety_filter', label: 'Disable safety filter', type: 'bool', default: true,
          desc: 'Replicate default is also true; leave on unless you need stricter moderation.' },
        { key: 'seed',         label: 'Seed (optional)', type: 'number', default: 0,
          desc: 'Reproducible output. 0 = random.' },
      ],
    },
  };
  // Expose globally for biroly + scenarios tabs that build their own popups.
  window.ENGINE_SCHEMAS = ENGINE_SCHEMAS;

  const $ = id => document.getElementById(id);

  // Build one form input from a field spec. Returns the input element with
  // dataset.fieldKey / dataset.fieldType set so collectValues() can read them.
  function _buildInput(field, current) {
    let inp;
    if (field.type === 'select') {
      inp = document.createElement('select');
      field.options.forEach(opt => {
        const o = document.createElement('option');
        o.value = opt; o.textContent = opt;
        inp.appendChild(o);
      });
      inp.value = (current !== undefined ? current : field.default);
    } else if (field.type === 'number') {
      inp = document.createElement('input');
      inp.type = 'number';
      if (field.min != null) inp.min = field.min;
      if (field.max != null) inp.max = field.max;
      inp.value = (current !== undefined ? current : field.default);
    } else if (field.type === 'bool') {
      inp = document.createElement('select');
      ['Off', 'On'].forEach(opt => {
        const o = document.createElement('option');
        o.value = opt; o.textContent = opt;
        inp.appendChild(o);
      });
      const effective = (current !== undefined ? !!current : !!field.default);
      inp.value = effective ? 'On' : 'Off';
    }
    inp.dataset.fieldKey = field.key;
    inp.dataset.fieldType = field.type;
    return inp;
  }

  function _readInputValue(inp) {
    const type = inp.dataset.fieldType;
    if (type === 'bool')   return inp.value === 'On';
    if (type === 'number') return inp.value === '' ? null : Number(inp.value);
    return inp.value;
  }

  // Build a self-contained <div> with the form rows for one engine.
  // `savedValues` seeds the inputs. `onChange(values)` fires on any edit
  // with the full collected values object.
  // Returns: { node, collect() → values, refresh(values) }
  function buildEngineSettingsRow(engineId, savedValues = {}, onChange = null) {
    const schema = ENGINE_SCHEMAS[engineId];
    const node = document.createElement('div');
    node.className = 'engine-settings-row';
    node.dataset.engineId = engineId;
    if (!schema) {
      node.textContent = `(no schema for ${engineId})`;
      return { node, collect: () => ({}), refresh: () => {} };
    }

    const inputs = [];

    if (schema.desc) {
      const intro = document.createElement('div');
      intro.style.cssText = 'font-size:10px;color:#666;margin-bottom:6px;line-height:1.4;';
      intro.textContent = schema.desc;
      node.appendChild(intro);
    }

    const collect = () => {
      const out = {};
      inputs.forEach(inp => { out[inp.dataset.fieldKey] = _readInputValue(inp); });
      return out;
    };
    const fireChange = () => onChange && onChange(collect());

    schema.fields.forEach(field => {
      const row = document.createElement('div');
      row.className = 'es-row';

      const lbl = document.createElement('label');
      lbl.textContent = field.label + ':';
      row.appendChild(lbl);

      const inp = _buildInput(field, savedValues[field.key]);
      inp.addEventListener('change', fireChange);
      inp.addEventListener('input',  fireChange);
      inputs.push(inp);
      row.appendChild(inp);

      node.appendChild(row);

      if (field.desc) {
        const d = document.createElement('div');
        d.className = 'es-desc';
        d.textContent = field.desc;
        node.appendChild(d);
      }
    });

    const refresh = (newValues) => {
      inputs.forEach(inp => {
        const k = inp.dataset.fieldKey;
        const v = newValues[k];
        if (v === undefined) return;
        if (inp.dataset.fieldType === 'bool') inp.value = v ? 'On' : 'Off';
        else inp.value = v;
      });
    };

    return { node, collect, refresh };
  }
  window.buildEngineSettingsRow = buildEngineSettingsRow;

  // Fetch saved engine defaults from server (one engine).
  async function fetchEngineDefaults(engineId) {
    try {
      const r = await fetch('/api/settings');
      const d = await r.json();
      if (d.success && d.settings?.engineDefaults?.[engineId]) return d.settings.engineDefaults[engineId];
    } catch {}
    return {};
  }
  window.fetchEngineDefaults = fetchEngineDefaults;

  // Persist values for one engine. Shallow-merge with the rest. Also mirrors
  // values into LS (engine_params__v1__<id>) so legacy code that reads
  // getEngineParams() picks them up without round-tripping the server.
  async function saveEngineDefaults(engineId, values) {
    const r = await fetch('/api/settings');
    const d = await r.json();
    const merged = { ...(d.settings?.engineDefaults || {}) };
    merged[engineId] = values;
    const sr = await fetch('/api/settings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ engineDefaults: merged }),
    });
    const sd = await sr.json();
    if (!sd.success) throw new Error(sd.error || 'save failed');
    try { localStorage.setItem('engine_params__v1__' + engineId, JSON.stringify(values)); } catch {}
  }
  window.saveEngineDefaults = saveEngineDefaults;

  async function clearEngineDefaults(engineId) {
    try {
      const r = await fetch('/api/settings');
      const d = await r.json();
      const merged = { ...(d.settings?.engineDefaults || {}) };
      delete merged[engineId];
      await fetch('/api/settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ engineDefaults: merged }),
      });
    } catch {}
    try { localStorage.removeItem('engine_params__v1__' + engineId); } catch {}
  }
  window.clearEngineDefaults = clearEngineDefaults;

  // ── Character-tab popup ────────────────────────────────────────────────────
  // Single-engine view, anchored to the engine currently selected in
  // <select id="char-image-engine">. Re-rendered on every open.

  // Track which engine the popup is currently editing (so Save/Reset don't
  // depend on the select being unchanged between open and click).
  let _currentEngineId = null;
  let _currentRow = null; // { node, collect, refresh }

  function _renderPopupForEngine(engineId, savedValues) {
    const schema = ENGINE_SCHEMAS[engineId];
    const form = $('engine-settings-form');
    if (!schema || !form) return;
    form.innerHTML = '';
    _currentEngineId = engineId;
    _currentRow = buildEngineSettingsRow(engineId, savedValues, null);
    form.appendChild(_currentRow.node);
  }

  // Render the popup's param form + title for whatever engine the in-popup
  // <select id="char-image-engine"> currently holds. Returns false if no schema.
  async function _renderForCurrentEngine() {
    const engineSel = $('char-image-engine');
    if (!engineSel) return false;
    const engineId = engineSel.value;
    const schema = ENGINE_SCHEMAS[engineId];
    if (!schema) { console.warn('[engine-settings] no schema for', engineId); return false; }

    const titleEl = $('engine-settings-title');
    if (titleEl) titleEl.textContent = '⚙ ' + schema.label;
    const statusEl = $('engine-settings-status');
    if (statusEl) statusEl.textContent = '';

    const saved = await fetchEngineDefaults(engineId);
    _renderPopupForEngine(engineId, saved);
    return true;
  }

  async function _openPopup() {
    if (await _renderForCurrentEngine()) window.openAppPopup?.('engine-settings');
  }

  // Keep the Draft trigger button label in sync with the selected engine.
  function _updateTriggerLabel() {
    const engineSel = $('char-image-engine');
    const labelEl = $('btn-open-engine-label');
    if (!engineSel || !labelEl) return;
    const opt = engineSel.options[engineSel.selectedIndex];
    labelEl.textContent = (opt && opt.textContent) || engineSel.value;
  }
  window.syncEngineTrigger = _updateTriggerLabel;

  async function _saveCurrent() {
    if (!_currentEngineId || !_currentRow) return;
    const values = _currentRow.collect();
    const statusEl = $('engine-settings-status');
    const saveBtn = $('engine-settings-save');
    if (saveBtn) saveBtn.disabled = true;
    if (statusEl) statusEl.textContent = 'Saving…';
    try {
      await saveEngineDefaults(_currentEngineId, values);
      if (statusEl) statusEl.textContent = '✅ Saved';
      setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 1800);
      // Auto-close the engine popup shortly after a successful save.
      setTimeout(() => { window.closeAppPopup?.(); }, 1000);
    } catch (e) {
      if (statusEl) statusEl.textContent = '⚠ ' + e.message;
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  async function _resetCurrent() {
    if (!_currentEngineId) return;
    const schema = ENGINE_SCHEMAS[_currentEngineId];
    if (!schema) return;
    if (!confirm('Reset settings for ' + schema.label + ' to defaults?')) return;
    _renderPopupForEngine(_currentEngineId, {});
    await clearEngineDefaults(_currentEngineId);
    const statusEl = $('engine-settings-status');
    if (statusEl) {
      statusEl.textContent = '↺ Reset';
      setTimeout(() => { statusEl.textContent = ''; }, 1800);
    }
  }

  function _wire() {
    $('btn-open-engine')?.addEventListener('click', _openPopup);
    $('engine-settings-save')?.addEventListener('click', _saveCurrent);
    $('engine-settings-reset')?.addEventListener('click', _resetCurrent);
    // Engine selector now lives inside the popup — switching it swaps the param
    // form live and updates the Draft trigger label.
    $('char-image-engine')?.addEventListener('change', () => {
      _updateTriggerLabel();
      _renderForCurrentEngine();
    });
    _updateTriggerLabel();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _wire);
  else _wire();
})();
