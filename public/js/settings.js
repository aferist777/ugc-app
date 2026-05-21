/* ═══════════════════════════════════════════════════════════════
   SETTINGS — engine selection, persisted to localStorage + server
   ═══════════════════════════════════════════════════════════════ */

const IMAGE_ENGINE_KEY      = 'image_engine_v1';
const VIDEO_ENGINE_KEY      = 'video_engine_v1';   // grok video engine (Биролы)
const AUDIO_ENGINE_KEY      = 'audio_engine_v1';
const GROK_VIDEO_ENGINE_KEY = 'grok_video_engine_v1';

// ── Public API ────────────────────────────────────────────────────────────────
function getImageEngine() {
  return localStorage.getItem(IMAGE_ENGINE_KEY) || 'nano-banana-2';
}
function setImageEngine(engine) {
  localStorage.setItem(IMAGE_ENGINE_KEY, engine);
  fetch('/api/settings', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageEngine: engine }),
  }).catch(() => {});
}

function getVideoEngine() { return localStorage.getItem(GROK_VIDEO_ENGINE_KEY) || 'grok-imagine/image-to-video'; }
function setVideoEngine(engine) { localStorage.setItem(GROK_VIDEO_ENGINE_KEY, engine); }

function getAudioEngine() { return localStorage.getItem(AUDIO_ENGINE_KEY) || 'elevenlabs'; }
function setAudioEngine(engine) { localStorage.setItem(AUDIO_ENGINE_KEY, engine); }

// ── Engine parameter specs ────────────────────────────────────────────────────
// Defines editable JSON body parameters per engine with labels and descriptions.
const ENGINE_PARAMS_SPECS = {
  'nano-banana-2': [
    {
      key: 'resolution', type: 'select', options: ['2K', '4K'], default: '2K',
      label: 'Resolution',
      desc: 'Output image resolution. 4K — higher detail but slower.',
    },
    {
      key: 'output_format', type: 'select', options: ['jpg', 'png'], default: 'jpg',
      label: 'File format',
      desc: 'Output image format. PNG is lossless, JPG is more compact.',
    },
  ],
  'qwen2': [
    {
      key: 'output_format', type: 'select', options: ['jpeg', 'png'], default: 'jpeg',
      label: 'File format',
      desc: 'Output image format.',
    },
    {
      key: 'num_inference_steps', type: 'number', min: 1, max: 80, step: 1, default: 30,
      label: 'Diffusion steps',
      desc: 'Number of generation steps (text-to-image). More = higher quality and slower.',
    },
    {
      key: 'guidance_scale', type: 'number', min: 1, max: 20, step: 0.1, default: 2.5,
      label: 'CFG Scale',
      desc: 'Prompt adherence (text-to-image). Higher = closer to prompt, lower = more creative.',
    },
  ],
  'seedream': [
    {
      key: 'quality', type: 'select', options: ['basic', 'high'], default: 'basic',
      label: 'Quality',
      desc: 'basic = 2K (fast), high = 4K (slower, higher detail).',
    },
  ],
  'gptimage2': [
    {
      key: 'quality', type: 'select', options: ['auto', 'high', 'medium', 'low'], default: 'auto',
      label: 'Quality',
      desc: 'auto — balanced speed and detail. high — maximum quality, slower.',
    },
  ],
  'elevenlabs': [
    {
      key: 'model_id', type: 'select',
      options: ['eleven_multilingual_v2', 'eleven_turbo_v2_5', 'eleven_flash_v2_5'],
      default: 'eleven_multilingual_v2',
      label: 'Model',
      desc: 'multilingual_v2 — best quality, multilingual support. turbo_v2_5 — faster. flash_v2_5 — fastest.',
    },
    {
      key: 'stability', type: 'range', min: 0, max: 1, step: 0.05, default: 0.85,
      label: 'Stability',
      desc: 'Voice delivery consistency. Low = more expressive and emotional, high = more monotone.',
    },
    {
      key: 'similarity_boost', type: 'range', min: 0, max: 1, step: 0.05, default: 0.75,
      label: 'Voice similarity',
      desc: 'Closeness to the original voice model. High = closer to voice, low = more varied.',
    },
    {
      key: 'style', type: 'range', min: 0, max: 1, step: 0.05, default: 0,
      label: 'Style/Emotions',
      desc: 'Amplifies individual voice traits. 0 = neutral, higher = more characteristic.',
    },
    {
      key: 'speed', type: 'range', min: 0.7, max: 1.5, step: 0.05, default: 1.15,
      label: 'Speech rate',
      desc: 'Speaking pace. 1.0 = normal, 0.7 = slow, 1.5 = fast.',
    },
  ],
  'kling/ai-avatar-standard': [
    {
      key: 'prompt', type: 'textarea', default: 'Natural speaking motion with subtle head movement',
      label: 'Motion prompt',
      desc: 'Description of avatar movements during voiceover. Affects gestures, facial expressions and head motion.',
    },
  ],
  'grok-imagine/image-to-video': [
    {
      key: 'duration', type: 'number', min: 6, max: 30, step: 1, default: 6,
      label: 'Duration (sec)',
      desc: 'Video length from 6 to 30 seconds.',
    },
    {
      key: 'resolution', type: 'select', options: ['480p', '720p'], default: '480p',
      label: 'Resolution',
      desc: '480p — faster, 720p — higher quality.',
    },
    {
      key: 'aspect_ratio', type: 'select', options: ['9:16', '16:9', '1:1', '2:3', '3:2'], default: '9:16',
      label: 'Aspect ratio',
      desc: '9:16 for vertical UGC videos, 16:9 for horizontal.',
    },
    {
      key: 'mode', type: 'select', options: ['normal', 'fun', 'spicy'], default: 'normal',
      label: 'Mode',
      desc: 'normal — standard, fun — dynamic, spicy — internal images only.',
    },
  ],
  'grok-imagine/text-to-video': [
    {
      key: 'duration', type: 'number', min: 6, max: 30, step: 1, default: 6,
      label: 'Duration (sec)',
      desc: 'Video length from 6 to 30 seconds.',
    },
    {
      key: 'resolution', type: 'select', options: ['480p', '720p'], default: '480p',
      label: 'Resolution',
      desc: '480p — faster, 720p — higher quality.',
    },
    {
      key: 'aspect_ratio', type: 'select', options: ['9:16', '16:9', '1:1', '2:3', '3:2'], default: '9:16',
      label: 'Aspect ratio',
      desc: '9:16 for vertical UGC videos, 16:9 for horizontal.',
    },
    {
      key: 'mode', type: 'select', options: ['normal', 'fun'], default: 'normal',
      label: 'Mode',
      desc: 'normal — standard, fun — dynamic.',
    },
  ],
};

const ENGINE_PARAMS_KEY_PREFIX = 'engine_params__v1__';

function getEngineParams(engineKey) {
  try {
    const stored = localStorage.getItem(ENGINE_PARAMS_KEY_PREFIX + engineKey);
    if (stored) return JSON.parse(stored);
  } catch {}
  // Return defaults
  const specs = ENGINE_PARAMS_SPECS[engineKey] || [];
  return Object.fromEntries(specs.map(s => [s.key, s.default]));
}

function setEngineParamValue(engineKey, paramKey, value) {
  const current = getEngineParams(engineKey);
  current[paramKey] = value;
  localStorage.setItem(ENGINE_PARAMS_KEY_PREFIX + engineKey, JSON.stringify(current));
}

// ── Build editable parameter form; calls onChange() on every user change ────
function buildEngineParamsForm(engineKey, onChange) {
  const specs = ENGINE_PARAMS_SPECS[engineKey];
  if (!specs || !specs.length) return null;

  const form = document.createElement('div');
  form.style.cssText = 'margin-top:4px;padding:6px 8px;background:#f8f8f8;border:1px solid #d0d0d0;';

  const params = getEngineParams(engineKey);

  const notify = (key, value) => {
    setEngineParamValue(engineKey, key, value);
    onChange?.();
  };

  specs.forEach(spec => {
    const row = document.createElement('div');
    row.style.cssText = 'margin-bottom:7px;';

    if (spec.type === 'textarea') {
      const lbl = document.createElement('div');
      lbl.style.cssText = 'font-size:10px;font-weight:bold;margin-bottom:2px;';
      lbl.textContent = spec.label + ':';

      const ta = document.createElement('textarea');
      ta.value = params[spec.key] ?? spec.default;
      ta.rows = 2;
      ta.style.cssText = 'width:100%;font-size:10px;font-family:inherit;padding:3px;box-sizing:border-box;resize:vertical;';
      ta.addEventListener('change', () => notify(spec.key, ta.value));

      const descEl = document.createElement('div');
      descEl.style.cssText = 'font-size:9px;color:#666;line-height:1.4;margin-top:2px;';
      descEl.textContent = spec.desc;

      row.appendChild(lbl); row.appendChild(ta); row.appendChild(descEl);

    } else if (spec.type === 'range') {
      const controlRow = document.createElement('div');
      controlRow.style.cssText = 'display:flex;align-items:center;gap:6px;';

      const lbl = document.createElement('span');
      lbl.style.cssText = 'font-size:10px;font-weight:bold;min-width:130px;flex-shrink:0;';
      lbl.textContent = spec.label + ':';

      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = spec.min; slider.max = spec.max; slider.step = spec.step;
      slider.value = params[spec.key] ?? spec.default;
      slider.style.cssText = 'flex:1;';

      const valSpan = document.createElement('span');
      valSpan.style.cssText = 'font-size:10px;min-width:34px;text-align:right;font-variant-numeric:tabular-nums;';
      valSpan.textContent = Number(slider.value).toFixed(2);

      slider.addEventListener('input', () => {
        valSpan.textContent = Number(slider.value).toFixed(2);
        notify(spec.key, Number(slider.value));
      });

      controlRow.appendChild(lbl); controlRow.appendChild(slider); controlRow.appendChild(valSpan);

      const descEl = document.createElement('div');
      descEl.style.cssText = 'font-size:9px;color:#666;line-height:1.4;margin-top:2px;padding-left:2px;';
      descEl.textContent = spec.desc;

      row.appendChild(controlRow); row.appendChild(descEl);

    } else if (spec.type === 'select') {
      const controlRow = document.createElement('div');
      controlRow.style.cssText = 'display:flex;align-items:center;gap:6px;';

      const lbl = document.createElement('span');
      lbl.style.cssText = 'font-size:10px;font-weight:bold;min-width:130px;flex-shrink:0;';
      lbl.textContent = spec.label + ':';

      const sel = document.createElement('select');
      sel.style.cssText = 'font-size:10px;height:20px;padding:0 2px;flex:1;';
      spec.options.forEach(opt => {
        const o = document.createElement('option');
        o.value = opt; o.textContent = opt;
        sel.appendChild(o);
      });
      sel.value = params[spec.key] ?? spec.default;
      sel.addEventListener('change', () => notify(spec.key, sel.value));

      controlRow.appendChild(lbl); controlRow.appendChild(sel);

      const descEl = document.createElement('div');
      descEl.style.cssText = 'font-size:9px;color:#666;line-height:1.4;margin-top:2px;padding-left:2px;';
      descEl.textContent = spec.desc;

      row.appendChild(controlRow); row.appendChild(descEl);

    } else if (spec.type === 'number') {
      const controlRow = document.createElement('div');
      controlRow.style.cssText = 'display:flex;align-items:center;gap:6px;';

      const lbl = document.createElement('span');
      lbl.style.cssText = 'font-size:10px;font-weight:bold;min-width:130px;flex-shrink:0;';
      lbl.textContent = spec.label + ':';

      const inp = document.createElement('input');
      inp.type = 'number';
      inp.min = spec.min; inp.max = spec.max; inp.step = spec.step || 1;
      inp.value = params[spec.key] ?? spec.default;
      inp.style.cssText = 'font-size:10px;width:70px;padding:1px 3px;';
      inp.addEventListener('change', () => notify(spec.key, Number(inp.value)));

      controlRow.appendChild(lbl); controlRow.appendChild(inp);

      const descEl = document.createElement('div');
      descEl.style.cssText = 'font-size:9px;color:#666;line-height:1.4;margin-top:2px;padding-left:2px;';
      descEl.textContent = spec.desc;

      row.appendChild(controlRow); row.appendChild(descEl);
    }

    form.appendChild(row);
  });

  return form;
}

// ── Build a collapsible <details> wrapper for engine params ──────────────────
function buildCollapsibleParams(engineKey, onChange) {
  const specs = ENGINE_PARAMS_SPECS[engineKey];
  if (!specs || !specs.length) return null;

  const details = document.createElement('details');
  details.style.cssText = 'margin-top:4px;margin-bottom:8px;';

  const summary = document.createElement('summary');
  summary.style.cssText = 'font-size:10px;color:#444;cursor:pointer;user-select:none;padding:2px 0;list-style:none;display:flex;align-items:center;gap:4px;';
  summary.innerHTML = '<span class="params-arrow">▶</span> Parameters';
  details.addEventListener('toggle', () => {
    const arrow = summary.querySelector('.params-arrow');
    if (arrow) arrow.textContent = details.open ? '▼' : '▶';
  });

  const form = buildEngineParamsForm(engineKey, onChange);
  details.appendChild(summary);
  if (form) details.appendChild(form);
  return details;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeSeparator() {
  const hr = document.createElement('div');
  hr.style.cssText = 'border-top:1px solid #d0d0d0;margin:10px 0 8px;';
  return hr;
}

function makeEngineRow(labelText, selectEl) {
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:4px;';
  const lbl = document.createElement('label');
  lbl.textContent = labelText;
  lbl.style.cssText = 'font-weight:bold;font-size:11px;white-space:nowrap;min-width:110px;flex-shrink:0;';
  row.appendChild(lbl);
  if (selectEl) row.appendChild(selectEl);
  return row;
}

function makeSelect(options, currentValue) {
  const sel = document.createElement('select');
  sel.style.cssText = 'flex:1;font-size:11px;';
  options.forEach(({ value, label }) => {
    const o = document.createElement('option');
    o.value = value; o.textContent = label;
    sel.appendChild(o);
  });
  sel.value = currentValue;
  return sel;
}

function makeDesc(html) {
  const d = document.createElement('div');
  d.style.cssText = 'font-size:10px;color:#555;line-height:1.5;margin-bottom:2px;';
  d.innerHTML = html;
  return d;
}

// ── Build the API Keys top-level section for Мозги tab ───────────────────────
function buildApiKeysSection() {
  const section = document.createElement('div');
  section.className = 'mozgi-group';
  section.style.marginTop = '12px';

  const header = document.createElement('div');
  header.className = 'mozgi-group-header';
  const arrow = document.createElement('span');
  arrow.className = 'mozgi-group-arrow';
  arrow.textContent = '▶';
  const labelEl = document.createElement('span');
  labelEl.textContent = '🔑 API Keys';
  header.appendChild(arrow);
  header.appendChild(labelEl);

  const body = document.createElement('div');
  body.className = 'mozgi-group-body mozgi-collapsed';
  body.style.padding = '10px 8px';

  header.addEventListener('click', () => {
    const collapsed = body.classList.toggle('mozgi-collapsed');
    arrow.textContent = collapsed ? '▶' : '▼';
  });

  // Helper: build a simple key row (label + input + 👁 + desc/link)
  function _buildKeyRow({ label, placeholder, link, linkText, desc, settingsKey, inputType = 'password' }) {
    const rowWrap = document.createElement('div');
    rowWrap.style.cssText = 'margin-bottom:10px;';

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:3px;';

    const lbl = document.createElement('label');
    lbl.textContent = label;
    lbl.style.cssText = 'font-size:10px;font-weight:700;white-space:nowrap;min-width:130px;flex-shrink:0;';

    const input = document.createElement('input');
    input.type = inputType;
    input.placeholder = placeholder;
    input.autocomplete = 'off';
    input.style.cssText = 'flex:1;font-size:10px;padding:2px 5px;border:1.5px solid #888;border-radius:3px;font-family:monospace;';

    const eyeBtn = document.createElement('button');
    eyeBtn.type = 'button';
    eyeBtn.textContent = '👁';
    eyeBtn.title = 'Show / hide';
    eyeBtn.style.cssText = 'background:transparent;border:1px solid #aaa;border-radius:3px;font-size:11px;padding:1px 5px;cursor:pointer;';
    eyeBtn.addEventListener('click', () => {
      input.type = (input.type === 'password') ? 'text' : 'password';
    });

    row.appendChild(lbl);
    row.appendChild(input);
    row.appendChild(eyeBtn);
    rowWrap.appendChild(row);

    if (desc || link) {
      const descEl = document.createElement('div');
      descEl.style.cssText = 'font-size:10px;color:#555;line-height:1.5;margin-left:4px;';
      descEl.innerHTML = link
        ? `${desc} <a href="${link}" target="_blank" rel="noopener" style="color:#06c;text-decoration:underline;">${linkText}</a>`
        : desc;
      rowWrap.appendChild(descEl);
    }

    return { rowWrap, row, input, settingsKey };
  }

  const kieKey  = _buildKeyRow({
    label: 'kie.ai API:',
    placeholder: 'kie_••• (kie.ai)',
    link: 'https://kie.ai/api-key',
    linkText: 'kie.ai/api-key',
    desc: 'Image / video / avatar generation. Required for the balance counter.',
    settingsKey: 'kieApiKey',
  });
  const elKey   = _buildKeyRow({
    label: 'ElevenLabs API:',
    placeholder: 'sk_••• (elevenlabs.io)',
    link: 'https://elevenlabs.io/app/settings/api-keys',
    linkText: 'elevenlabs.io → API keys',
    desc: 'Speech synthesis (TTS) for scenes.',
    settingsKey: 'elevenLabsApiKey',
  });
  const groqKey = _buildKeyRow({
    label: 'Groq (Whisper STT):',
    placeholder: 'gsk_••• (console.groq.com)',
    link: 'https://console.groq.com/keys',
    linkText: 'console.groq.com → API keys',
    desc: 'Free Speech-to-Text for subtitles. Model whisper-large-v3-turbo.',
    settingsKey: 'groqApiKey',
  });
  const orKey = _buildKeyRow({
    label: 'OpenRouter API:',
    placeholder: 'sk-or-v1-••• (openrouter.ai)',
    link: 'https://openrouter.ai/settings/keys',
    linkText: 'openrouter.ai → keys',
    desc: 'Primary text/vision analysis (replaces kie.ai for prompt engineering when set).',
    settingsKey: 'openRouterApiKey',
  });
  const orModel = _buildKeyRow({
    label: 'OpenRouter models:',
    placeholder: 'anthropic/claude-sonnet-4.6,openai/gpt-5.5,google/gemini-3.1-pro-preview',
    desc: 'Comma-separated model chain — server tries each in order until one returns a non-empty response, then falls back to the kie.ai cascade. Model IDs from <a href="https://openrouter.ai/models" target="_blank" rel="noopener" style="color:#06c;">openrouter.ai/models</a>.',
    settingsKey: 'openRouterTextModel',
    inputType: 'text',
  });
  const tgTokenKey = _buildKeyRow({
    label: 'Telegram Bot Token:',
    placeholder: '123456:AAE••• (BotFather)',
    desc: '',
    settingsKey: 'telegramBotToken',
  });
  const tgChatKey = _buildKeyRow({
    label: 'Telegram Chat:',
    placeholder: '@channel  or  -1001234567890',
    desc: '',
    settingsKey: 'telegramChatId',
    inputType: 'text',
  });

  // Add 🔍 Detect button into the chat row (next to the 👁)
  const detectBtn = document.createElement('button');
  detectBtn.type = 'button';
  detectBtn.textContent = '🔍 Detect';
  detectBtn.title = 'Auto-detect chat_id from getUpdates';
  detectBtn.style.cssText = 'background:#eef;border:1px solid #88a;border-radius:3px;font-size:10px;padding:1px 6px;cursor:pointer;white-space:nowrap;';
  detectBtn.addEventListener('click', async () => {
    detectBtn.disabled = true;
    const orig = detectBtn.textContent;
    detectBtn.textContent = '⏳…';
    try {
      // Use the just-typed token if present (works without saving first); else server falls back to settings.json
      const liveToken = tgTokenKey.input.value.trim();
      const r = await fetch('/api/telegram/detect-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(liveToken ? { token: liveToken } : {}),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error || 'Detect failed');
      tgChatKey.input.value = String(d.chatId);
      tgChatKey.input.type = 'text';
      detectBtn.textContent = '✓ ' + (d.title || 'detected');
      setTimeout(() => { detectBtn.textContent = orig; detectBtn.disabled = false; }, 3500);
    } catch (e) {
      detectBtn.textContent = '⚠ ' + (e.message || 'error').slice(0, 40);
      setTimeout(() => { detectBtn.textContent = orig; detectBtn.disabled = false; }, 6000);
    }
  });
  tgChatKey.row.appendChild(detectBtn);

  body.appendChild(kieKey.rowWrap);
  body.appendChild(elKey.rowWrap);
  body.appendChild(groqKey.rowWrap);
  body.appendChild(orKey.rowWrap);
  body.appendChild(orModel.rowWrap);
  body.appendChild(tgTokenKey.rowWrap);
  body.appendChild(tgChatKey.rowWrap);

  // Combined instruction block under both telegram fields
  const tgInstr = document.createElement('div');
  tgInstr.style.cssText = 'font-size:10px;color:#555;line-height:1.55;margin:-4px 0 10px 4px;padding:6px 8px;background:#f4f4f0;border-left:2px solid #88a;border-radius:2px;';
  tgInstr.innerHTML =
    '<b>Telegram setup:</b><br>' +
    '1. Create a bot via <a href="https://t.me/BotFather" target="_blank" rel="noopener" style="color:#06c;">@BotFather</a> → <code>/newbot</code> → paste the token above.<br>' +
    '2. Add the bot to your group/channel.<br>' +
    '3. In that chat send <code>/start@your_bot_name</code>.<br>' +
    '4. Click <b>🔍 Detect</b> — chat_id will fill in automatically.<br>' +
    'Manual format: <code>@public_channel</code> or numeric id like <code>-1001234567890</code>. ' +
    'Invite links (<code>t.me/+xxx</code>) are not supported by the Bot API.';
  body.appendChild(tgInstr);

  // Save button
  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.textContent = '💾 Save API Keys';
  saveBtn.style.cssText = 'width:100%;margin-top:4px;font-size:11px;padding:5px;';
  let saveTimer = null;
  const allRows = [kieKey, elKey, groqKey, orKey, orModel, tgTokenKey, tgChatKey];
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    saveBtn.textContent = '⏳ Saving…';
    const payload = {};
    allRows.forEach(k => {
      const v = k.input.value.trim();
      if (v) payload[k.settingsKey] = v;
    });
    try {
      if (Object.keys(payload).length) {
        await fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        // Reset password-type inputs back to hidden (dots) but keep their values so 👁 still works
        allRows.forEach(k => {
          if (k !== tgChatKey && k !== orModel && k.input.value) k.input.type = 'password';
        });
      }
      saveBtn.textContent = '✅ Saved';
      try { window.refreshBalance?.(); } catch {}
    } catch {
      saveBtn.textContent = '⚠ Error — retry';
    } finally {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        saveBtn.disabled = false;
        saveBtn.textContent = '💾 Save API Keys';
      }, 2200);
    }
  });
  body.appendChild(saveBtn);

  // Load existing values into inputs (so 👁 reveals the actual saved key on click)
  fetch('/api/settings').then(r => r.json()).then(d => {
    const s = d.settings || {};
    if (s.kieApiKey)         kieKey.input.value     = s.kieApiKey;
    if (s.elevenLabsApiKey)  elKey.input.value      = s.elevenLabsApiKey;
    if (s.groqApiKey)        groqKey.input.value    = s.groqApiKey;
    if (s.openRouterApiKey)    orKey.input.value      = s.openRouterApiKey;
    if (s.openRouterTextModel) orModel.input.value    = s.openRouterTextModel;
    if (s.telegramBotToken)  tgTokenKey.input.value = s.telegramBotToken;
    if (s.telegramChatId)    tgChatKey.input.value  = s.telegramChatId;
  }).catch(() => {});

  section.appendChild(header);
  section.appendChild(body);
  return section;
}

// ── Build the CreationEngines section for Мозги tab ───────────────────────────
function buildCreationEnginesSection() {
  const section = document.createElement('div');
  section.className = 'mozgi-group';
  section.style.marginTop = '12px';

  const header = document.createElement('div');
  header.className = 'mozgi-group-header';
  const arrow = document.createElement('span');
  arrow.className = 'mozgi-group-arrow';
  arrow.textContent = '▶';
  const labelEl = document.createElement('span');
  labelEl.textContent = '⚙️ CreationEngines';
  header.appendChild(arrow);
  header.appendChild(labelEl);

  const body = document.createElement('div');
  body.className = 'mozgi-group-body mozgi-collapsed';
  body.style.padding = '10px 8px';

  header.addEventListener('click', () => {
    const collapsed = body.classList.toggle('mozgi-collapsed');
    arrow.textContent = collapsed ? '▶' : '▼';
  });

  // ── Save button (shown on any change) ────────────────────────────────────
  const saveBtn = document.createElement('button');
  saveBtn.textContent = '💾 Save';
  saveBtn.style.cssText = 'display:none;width:100%;margin-top:10px;font-size:11px;';
  let saveTimer = null;
  const markChanged = () => {
    saveBtn.style.display = 'block';
    saveBtn.textContent = '💾 Save';
    saveBtn.disabled = false;
  };
  saveBtn.addEventListener('click', () => {
    // Persist image engine to server (already done on select change); rest is localStorage
    fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageEngine: getImageEngine() }),
    }).catch(() => {});
    saveBtn.textContent = '✅ Saved';
    saveBtn.disabled = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveBtn.style.display = 'none'; }, 2000);
  });

  // ── ImageEngines ──────────────────────────────────────────────────────────
  const imageSel = makeSelect([
    { value: 'nano-banana-2', label: 'nano-banana-2' },
    { value: 'qwen2',         label: 'Qwen2 (qwen2/image-edit)' },
    { value: 'seedream',      label: 'Seedream 5 Lite' },
    { value: 'gptimage2',     label: 'GPT Image 2' },
  ], getImageEngine());

  body.appendChild(makeEngineRow('ImageEngines:', imageSel));
  body.appendChild(makeDesc(
    '<b>nano-banana-2</b> — multiple references, optimal for interactions.<br>' +
    '<b>Qwen2</b> — single reference image, precise prompt adherence.<br>' +
    '<b>Seedream 5 Lite</b> — up to 14 references, 2K/4K quality.<br>' +
    '<b>GPT Image 2</b> — OpenAI gpt/image-2, high quality, single reference image.'
  ));

  const imageParamsWrap = document.createElement('div');
  body.appendChild(imageParamsWrap);

  const rebuildImageParams = () => {
    imageParamsWrap.innerHTML = '';
    const d = buildCollapsibleParams(imageSel.value, markChanged);
    if (d) imageParamsWrap.appendChild(d);
  };
  rebuildImageParams();

  imageSel.addEventListener('change', () => {
    setImageEngine(imageSel.value);
    setStatus?.(`ImageEngine: ${imageSel.value}`);
    rebuildImageParams();
    markChanged();
  });

  body.appendChild(makeSeparator());

  // ── AvatarEngines (Kling — hardcoded for Сценарии) ────────────────────────
  const avatarFixed = document.createElement('div');
  avatarFixed.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:4px;';
  const avatarLbl = document.createElement('label');
  avatarLbl.textContent = 'AvatarEngines:';
  avatarLbl.style.cssText = 'font-weight:bold;font-size:11px;white-space:nowrap;min-width:110px;flex-shrink:0;';
  const avatarVal = document.createElement('span');
  avatarVal.textContent = 'Kling AI Avatar Pro';
  avatarVal.style.cssText = 'font-size:11px;color:#333;';
  avatarFixed.appendChild(avatarLbl);
  avatarFixed.appendChild(avatarVal);
  body.appendChild(avatarFixed);
  body.appendChild(makeDesc(
    '<b>Kling AI Avatar Pro</b> — lip-sync avatar. Linked to the Talking Head generator in the Scenarios tab.'
  ));

  const avatarParamsWrap = document.createElement('div');
  body.appendChild(avatarParamsWrap);
  const avatarDetails = buildCollapsibleParams('kling/ai-avatar-standard', markChanged);
  if (avatarDetails) avatarParamsWrap.appendChild(avatarDetails);

  body.appendChild(makeSeparator());

  // ── VideoEngines (Grok) ───────────────────────────────────────────────────
  const videoSel = makeSelect([
    { value: 'grok-imagine/image-to-video', label: 'Grok image-to-video' },
    { value: 'grok-imagine/text-to-video',  label: 'Grok text-to-video'  },
  ], getVideoEngine());

  body.appendChild(makeEngineRow('VideoEngines:', videoSel));
  body.appendChild(makeDesc(
    '<b>Grok image-to-video</b> — video generation from image + prompt (img+video mode).<br>' +
    '<b>Grok text-to-video</b> — direct video generation from text prompt.'
  ));

  const videoParamsWrap = document.createElement('div');
  body.appendChild(videoParamsWrap);

  const rebuildVideoParams = () => {
    videoParamsWrap.innerHTML = '';
    const d = buildCollapsibleParams(videoSel.value, markChanged);
    if (d) videoParamsWrap.appendChild(d);
  };
  rebuildVideoParams();

  videoSel.addEventListener('change', () => {
    setVideoEngine(videoSel.value);
    setStatus?.(`VideoEngine: ${videoSel.value}`);
    rebuildVideoParams();
    markChanged();
  });

  body.appendChild(makeSeparator());

  // ── AudioEngines ──────────────────────────────────────────────────────────
  const audioSel = makeSelect([
    { value: 'elevenlabs', label: 'ElevenLabs (direct API)' },
  ], getAudioEngine());

  body.appendChild(makeEngineRow('AudioEngines:', audioSel));
  body.appendChild(makeDesc(
    '<b>ElevenLabs</b> — direct API call. Key required below. ' +
    'Model eleven_multilingual_v2 supports multiple languages.'
  ));

  const audioParamsWrap = document.createElement('div');
  body.appendChild(audioParamsWrap);

  const rebuildAudioParams = () => {
    audioParamsWrap.innerHTML = '';
    const d = buildCollapsibleParams(audioSel.value, markChanged);
    if (d) audioParamsWrap.appendChild(d);
  };
  rebuildAudioParams();

  audioSel.addEventListener('change', () => {
    setAudioEngine(audioSel.value);
    setStatus?.(`AudioEngine: ${audioSel.value}`);
    rebuildAudioParams();
    markChanged();
  });

  body.appendChild(makeSeparator());

  // ── Custom voices (ElevenLabs) — voice library for scene generation ─────
  const CV_LS_KEY = 'el_custom_voices_v1';
  function _loadCvStored() {
    try { return JSON.parse(localStorage.getItem(CV_LS_KEY) || '{}'); } catch { return {}; }
  }

  const cvDetails = document.createElement('details');
  cvDetails.style.cssText = 'margin-top:5px;margin-bottom:4px;';
  const cvSummary = document.createElement('summary');
  cvSummary.style.cssText = 'font-size:10px;color:#444;cursor:pointer;user-select:none;padding:2px 0;list-style:none;display:flex;align-items:center;gap:4px;';
  cvSummary.innerHTML = '<span class="cv-arrow">▶</span> Custom voices';
  cvDetails.addEventListener('toggle', () => {
    cvSummary.querySelector('.cv-arrow').textContent = cvDetails.open ? '▼' : '▶';
  });

  const cvBody = document.createElement('div');
  cvBody.style.cssText = 'padding:6px 0 2px;';

  function _makeCvField(labelText, placeholder) {
    const wrap = document.createElement('div');
    wrap.style.marginBottom = '6px';
    const lbl = document.createElement('div');
    lbl.style.cssText = 'font-size:10px;font-weight:700;margin-bottom:2px;';
    lbl.textContent = labelText;
    const ta = document.createElement('textarea');
    ta.rows = 4;
    ta.placeholder = placeholder;
    ta.style.cssText = 'width:100%;font-size:10px;font-family:monospace;padding:3px 4px;box-sizing:border-box;resize:vertical;border:1px solid #bbb;line-height:1.5;';
    ta.spellcheck = false;
    wrap.appendChild(lbl);
    wrap.appendChild(ta);
    return { wrap, ta };
  }

  const PH = 'voiceId - voice description';
  const { wrap: cvFWrap, ta: cvFTa } = _makeCvField('♀ Female:', PH);
  const { wrap: cvMWrap, ta: cvMTa } = _makeCvField('♂ Male:', PH);

  // Load saved values
  const _cvStored = _loadCvStored();
  cvFTa.value = _cvStored.female || '';
  cvMTa.value = _cvStored.male   || '';

  const cvSaveBtn = document.createElement('button');
  cvSaveBtn.textContent = '💾 Save voices';
  cvSaveBtn.style.cssText = 'width:100%;font-size:10px;margin-top:2px;';
  cvSaveBtn.addEventListener('click', () => {
    const data = { female: cvFTa.value, male: cvMTa.value };
    localStorage.setItem(CV_LS_KEY, JSON.stringify(data));
    window.loadCustomVoices?.();
    cvSaveBtn.textContent = '✅ Saved';
    setTimeout(() => { cvSaveBtn.textContent = '💾 Save voices'; }, 2000);
  });

  cvBody.appendChild(cvFWrap);
  cvBody.appendChild(cvMWrap);
  cvBody.appendChild(makeDesc('Format: <b>voiceId - description</b>, one voice per line. ID from elevenlabs.io → Voices.'));
  cvBody.appendChild(cvSaveBtn);
  cvDetails.appendChild(cvSummary);
  cvDetails.appendChild(cvBody);
  body.appendChild(cvDetails);

  body.appendChild(saveBtn);

  section.appendChild(header);
  section.appendChild(body);
  return section;
}

// ── Realism markers section ───────────────────────────────────────────────────
const RM_LS_KEY = 'realism_markers_v1';

const REALISM_MARKER_GROUPS = [
  {
    id: 'no_retouch',
    label: 'No retouch',
    desc: 'Always added to the prompt when generating a character.',
    markers: [
      'unretouched', 'no smoothing', 'no airbrushing',
      'no beauty filters', 'no retouching', 'no plastic skin',
    ],
  },
  {
    id: 'skin_texture',
    label: 'Skin texture',
    desc: 'AI selects appropriate markers when analyzing the character\'s skin.',
    markers: [
      'visible pores', 'fine micro-texture', 'organic acne marks', 'non-repeating marks',
      'uneven pigmentation', 'subtle redness', 'natural oil sheen', 'acne scars',
      'bare skin', 'fine lines', 'subtle under-eye texture', 'visible veins',
      'fine wrinkles', 'skin texture',
    ],
  },
  {
    id: 'camera',
    label: 'Camera / Optics',
    desc: 'Applied when the "Realism" checkbox is enabled on the Character tab.',
    markers: [
      'phone-camera realism', 'subtle sensor grain', 'slight edge softness',
      'shallow depth of field', 'editorial realism',
    ],
  },
  {
    id: 'lighting',
    label: 'Lighting',
    desc: 'Applied when the "Realism" checkbox is enabled on the Character tab.',
    markers: [
      'indoor near window', 'natural contrast', 'accurate white balance', 'soft side lighting',
    ],
  },
  {
    id: 'anatomy',
    label: 'Anatomy / Details',
    desc: 'Applied when the "Realism" checkbox is enabled on the Character tab.',
    markers: [
      'no symmetry correction', 'natural flyaways',
      'visible veins', 'hand anatomy', 'realistic proportions', 'clear fabric texture separation',
    ],
  },
];

function _loadRealismMarkers() {
  try {
    const s = localStorage.getItem(RM_LS_KEY);
    return s ? JSON.parse(s) : null;
  } catch { return null; }
}

function _defaultRealismState() {
  const state = {};
  REALISM_MARKER_GROUPS.forEach(g => g.markers.forEach(m => { state[m] = true; }));
  return state;
}

function getRealismMarkersState() {
  return _loadRealismMarkers() || _defaultRealismState();
}

window.getRealismMarkersState = getRealismMarkersState;

// Returns { groupId: [enabled markers] } — used by REALISM_TEMPO_PROMPT injection
// in routes/refs.js. Includes user-added custom markers per group.
function getCategorizedRealismMarkers() {
  const state  = getRealismMarkersState();
  let custom = {};
  try { custom = JSON.parse(localStorage.getItem('realism_custom_markers_v1') || '{}'); } catch {}
  const result = {};
  REALISM_MARKER_GROUPS.forEach(g => {
    const enabledBuiltin = g.markers.filter(m => state[m] !== false);
    const enabledCustom  = (custom[g.id] || []).filter(m => state[m] !== false);
    result[g.id] = [...enabledBuiltin, ...enabledCustom];
  });
  return result;
}
window.getCategorizedRealismMarkers = getCategorizedRealismMarkers;

// Build only the inner body content of the realism markers UI — five marker
// groups (No retouch, Skin texture, Camera, Lighting, Anatomy) with pills,
// per-group custom-add input, and a Reset button. No collapsible wrapper
// (the popup IS the container; an extra fold would be redundant).
function buildRealismMarkersBody() {
  const body = document.createElement('div');

  let state = getRealismMarkersState();

  const saveState = () => {
    localStorage.setItem(RM_LS_KEY, JSON.stringify(state));
  };

  const RM_CUSTOM_KEY = 'realism_custom_markers_v1';
  function loadCustomMarkers() {
    try { return JSON.parse(localStorage.getItem(RM_CUSTOM_KEY) || '{}'); } catch { return {}; }
  }
  function saveCustomMarkers(cm) { localStorage.setItem(RM_CUSTOM_KEY, JSON.stringify(cm)); }

  function makePill(marker, grid, isCustom) {
    const pill = document.createElement('label');
    pill.style.cssText = 'display:inline-flex;align-items:center;gap:3px;font-size:10px;cursor:pointer;padding:2px 5px;border:1px solid #bbb;border-radius:3px;background:#f8f8f8;user-select:none;';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = state[marker] !== false;
    cb.style.cssText = 'margin:0;cursor:pointer;';
    cb.addEventListener('change', () => {
      state[marker] = cb.checked;
      saveState();
      pill.style.background = cb.checked ? '#f8f8f8' : '#eee';
      pill.style.color = cb.checked ? '' : '#aaa';
      pill.style.textDecoration = cb.checked ? '' : 'line-through';
    });

    if (!cb.checked) {
      pill.style.background = '#eee';
      pill.style.color = '#aaa';
      pill.style.textDecoration = 'line-through';
    }

    const txt = document.createElement('span');
    txt.textContent = marker;
    pill.appendChild(cb);
    pill.appendChild(txt);

    if (isCustom) {
      const del = document.createElement('span');
      del.textContent = '×';
      del.title = 'Delete';
      del.style.cssText = 'margin-left:2px;color:#999;font-size:11px;line-height:1;cursor:pointer;';
      del.addEventListener('click', e => {
        e.preventDefault();
        pill.remove();
        delete state[marker];
        saveState();
      });
      pill.appendChild(del);
    }

    grid.appendChild(pill);
  }

  REALISM_MARKER_GROUPS.forEach((group, gi) => {
    if (gi > 0) {
      const sep = document.createElement('div');
      sep.style.cssText = 'border-top:1px solid #d0d0d0;margin:8px 0 6px;';
      body.appendChild(sep);
    }

    const groupHdr = document.createElement('div');
    groupHdr.style.cssText = 'font-size:10px;font-weight:800;color:#000080;text-transform:uppercase;letter-spacing:.06em;margin-bottom:2px;';
    groupHdr.textContent = group.label;
    body.appendChild(groupHdr);

    const descEl = document.createElement('div');
    descEl.style.cssText = 'font-size:9px;color:#666;margin-bottom:5px;line-height:1.4;';
    descEl.textContent = group.desc;
    body.appendChild(descEl);

    const grid = document.createElement('div');
    grid.style.cssText = 'display:flex;flex-wrap:wrap;gap:3px 6px;margin-bottom:5px;';

    group.markers.forEach(m => makePill(m, grid, false));

    const customMarkers = loadCustomMarkers();
    (customMarkers[group.id] || []).forEach(m => makePill(m, grid, true));

    body.appendChild(grid);

    // Add-new-marker row
    const addRow = document.createElement('div');
    addRow.style.cssText = 'display:flex;gap:4px;align-items:center;';
    const addInput = document.createElement('input');
    addInput.type = 'text';
    addInput.placeholder = 'new marker…';
    addInput.style.cssText = 'flex:1;font-size:10px;padding:2px 5px;border:1px solid #bbb;border-radius:3px;';
    const addBtn = document.createElement('button');
    addBtn.textContent = 'add';
    addBtn.style.cssText = 'font-size:10px;padding:2px 8px;white-space:nowrap;';
    addBtn.addEventListener('click', () => {
      const val = addInput.value.trim();
      if (!val) return;
      const cm = loadCustomMarkers();
      if (!cm[group.id]) cm[group.id] = [];
      if (cm[group.id].includes(val)) { addInput.value = ''; return; }
      cm[group.id].push(val);
      saveCustomMarkers(cm);
      state[val] = true;
      saveState();
      makePill(val, grid, true);
      addInput.value = '';
    });
    addInput.addEventListener('keydown', e => { if (e.key === 'Enter') addBtn.click(); });
    addRow.appendChild(addInput);
    addRow.appendChild(addBtn);
    body.appendChild(addRow);
  });

  // Reset button
  const resetRow = document.createElement('div');
  resetRow.style.cssText = 'margin-top:10px;text-align:right;';
  const resetBtn = document.createElement('button');
  resetBtn.textContent = '↺ Reset all';
  resetBtn.style.cssText = 'font-size:10px;padding:2px 8px;';
  resetBtn.addEventListener('click', () => {
    const defaults = _defaultRealismState();
    Object.assign(state, defaults);
    saveState();
    body.querySelectorAll('input[type=checkbox]').forEach(cb => {
      cb.checked = true;
      const pill = cb.parentElement;
      pill.style.background = '#f8f8f8';
      pill.style.color = '';
      pill.style.textDecoration = '';
    });
  });
  resetRow.appendChild(resetBtn);
  body.appendChild(resetRow);

  return body;
}


// ── Inject section into the left column of Мозги tab ─────────────────────────
function appendCreationEnginesToMozgi() {
  const container = document.getElementById('creation-engines-container');
  if (!container) return;
  container.innerHTML = '';
  container.appendChild(buildApiKeysSection());
  container.appendChild(buildCreationEnginesSection());
  container.appendChild(buildAppSettingsSection());
}

// Build the realism markers content directly into the popup body — no
// collapsible wrapper, no inner header (the popup titlebar already names the
// section). Just the five marker groups + Reset.
function appendRealismMarkersToPopup() {
  try {
    const container = document.getElementById('realism-popup-body');
    if (!container) { console.warn('[realism] popup body not found'); return; }
    container.innerHTML = '';
    container.appendChild(buildRealismMarkersBody());
  } catch (e) {
    console.error('[realism] build error:', e);
  }
}

// Inject on page load (left column is always in DOM)
try { appendCreationEnginesToMozgi(); } catch(e) { console.error('[engines] build error:', e); }
try { appendRealismMarkersToPopup(); } catch(e) { console.error('[realism] outer error:', e); }

// ── Web Audio — completion sound presets ─────────────────────────────────────
const COMPLETION_SOUNDS = [
  { id: 'vжух_1',  label: 'Vzh 1 — short whistle' },
  { id: 'vжух_2',  label: 'Vzh 2 — rise' },
  { id: 'vжух_3',  label: 'Vzh 3 — ping' },
  { id: 'vжух_4',  label: 'Vzh 4 — bubble' },
  { id: 'vжух_5',  label: 'Vzh 5 — retro beep' },
  { id: 'vжух_6',  label: 'Vzh 6 — soft bell' },
  { id: 'vжух_7',  label: 'Vzh 7 — dubstep' },
  { id: 'vжух_8',  label: 'Vzh 8 — victory' },
];

function _playSound(id) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const g   = ctx.createGain();
    g.connect(ctx.destination);
    const now = ctx.currentTime;

    if (id === 'vжух_1') {
      // Short whoosh sweep up
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(300, now); o.frequency.linearRampToValueAtTime(1200, now + 0.18);
      g.gain.setValueAtTime(0.4, now); g.gain.linearRampToValueAtTime(0, now + 0.22);
      o.connect(g); o.start(now); o.stop(now + 0.22);

    } else if (id === 'vжух_2') {
      // Build-up swell
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(100, now); o.frequency.exponentialRampToValueAtTime(800, now + 0.4);
      g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(0.3, now + 0.3); g.gain.linearRampToValueAtTime(0, now + 0.45);
      o.connect(g); o.start(now); o.stop(now + 0.45);

    } else if (id === 'vжух_3') {
      // Clean ping
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(880, now);
      g.gain.setValueAtTime(0.5, now); g.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
      o.connect(g); o.start(now); o.stop(now + 0.6);

    } else if (id === 'vжух_4') {
      // Bubble pop
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(600, now); o.frequency.exponentialRampToValueAtTime(200, now + 0.15);
      g.gain.setValueAtTime(0.45, now); g.gain.linearRampToValueAtTime(0, now + 0.18);
      o.connect(g); o.start(now); o.stop(now + 0.18);

    } else if (id === 'vжух_5') {
      // Retro bip-bip
      [0, 0.12].forEach(dt => {
        const o = ctx.createOscillator(); o.type = 'square';
        o.frequency.setValueAtTime(440, now + dt);
        const gn = ctx.createGain(); gn.gain.setValueAtTime(0.15, now + dt); gn.gain.linearRampToValueAtTime(0, now + dt + 0.09);
        o.connect(gn); gn.connect(ctx.destination); o.start(now + dt); o.stop(now + dt + 0.09);
      });

    } else if (id === 'vжух_6') {
      // Soft bell
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(523, now);
      g.gain.setValueAtTime(0.35, now); g.gain.exponentialRampToValueAtTime(0.001, now + 1.2);
      o.connect(g); o.start(now); o.stop(now + 1.2);

    } else if (id === 'vжух_7') {
      // Dubstep wobble
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 8;
      const lfog = ctx.createGain(); lfog.gain.value = 200;
      lfo.connect(lfog); lfog.connect(o.frequency);
      o.frequency.setValueAtTime(120, now);
      g.gain.setValueAtTime(0.3, now); g.gain.linearRampToValueAtTime(0, now + 0.5);
      o.connect(g); o.start(now); lfo.start(now); o.stop(now + 0.5); lfo.stop(now + 0.5);

    } else if (id === 'vжух_8') {
      // Victory fanfare (3 notes)
      [[0, 523], [0.15, 659], [0.3, 784]].forEach(([dt, freq]) => {
        const o = ctx.createOscillator(); o.type = 'triangle';
        o.frequency.setValueAtTime(freq, now + dt);
        const gn = ctx.createGain(); gn.gain.setValueAtTime(0.3, now + dt); gn.gain.linearRampToValueAtTime(0, now + dt + 0.25);
        o.connect(gn); gn.connect(ctx.destination); o.start(now + dt); o.stop(now + dt + 0.25);
      });
    }
    setTimeout(() => ctx.close(), 2000);
  } catch (e) { console.warn('[sound]', e.message); }
}

// Called globally from generation completion points
window.playCompletionSound = function() {
  try {
    const s = JSON.parse(localStorage.getItem('app_settings') || '{}');
    // Support both old format (soundEnabled + soundId) and new (notificationSound)
    const soundId = s.notificationSound || (s.soundEnabled ? (s.soundId || 'vжух_3') : null);
    if (!soundId || soundId === 'none') return;
    _playSound(soundId);
  } catch {}
};

// ── App Settings section ──────────────────────────────────────────────────────
function buildAppSettingsSection() {
  const APP_SETTINGS_LS = 'app_settings';
  function loadAppSettings() {
    try { return JSON.parse(localStorage.getItem(APP_SETTINGS_LS) || '{}'); } catch { return {}; }
  }
  function saveAppSettings(obj) {
    try { localStorage.setItem(APP_SETTINGS_LS, JSON.stringify(obj)); } catch {}
  }

  const saved = loadAppSettings();

  const section = document.createElement('div');
  section.className = 'mozgi-group';
  section.style.marginTop = '8px';

  const header = document.createElement('div');
  header.className = 'mozgi-group-header';
  const arrow = document.createElement('span');
  arrow.className = 'mozgi-group-arrow';
  arrow.textContent = '▶';
  const labelEl = document.createElement('span');
  labelEl.textContent = '🔧 Настройки программы';
  header.appendChild(arrow); header.appendChild(labelEl);

  const body = document.createElement('div');
  body.className = 'mozgi-group-body';
  body.style.padding = '10px 8px';
  arrow.textContent = '▼';

  header.addEventListener('click', () => {
    const collapsed = body.classList.toggle('mozgi-collapsed');
    arrow.textContent = collapsed ? '▶' : '▼';
  });

  // ── Оповещение при завершении генерации ─────────────────────────────────
  const notifRow = document.createElement('div');
  notifRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap;';

  const notifLbl = document.createElement('label');
  notifLbl.style.cssText = 'font-size:11px;font-weight:600;white-space:nowrap;';
  notifLbl.textContent = 'Оповещение при завершении:';

  const notifSel = document.createElement('select');
  notifSel.style.cssText = 'font-size:11px;padding:2px 4px;flex:1;min-width:160px;';

  // Derive current value: prefer new notificationSound field, fall back to old format
  const currentNotif = saved.notificationSound ||
    (saved.soundEnabled ? (saved.soundId || 'vжух_3') : 'none');

  const noneOpt = document.createElement('option');
  noneOpt.value = 'none'; noneOpt.textContent = '— Без оповещения —';
  if (currentNotif === 'none') noneOpt.selected = true;
  notifSel.appendChild(noneOpt);

  COMPLETION_SOUNDS.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id; opt.textContent = s.label;
    if (s.id === currentNotif) opt.selected = true;
    notifSel.appendChild(opt);
  });

  const previewBtn = document.createElement('button');
  previewBtn.textContent = '▶';
  previewBtn.title = 'Тест звука';
  previewBtn.style.cssText = 'font-size:10px;padding:2px 8px;white-space:nowrap;';
  previewBtn.addEventListener('click', () => {
    if (notifSel.value !== 'none') _playSound(notifSel.value);
  });

  notifRow.appendChild(notifLbl);
  notifRow.appendChild(notifSel);
  notifRow.appendChild(previewBtn);

  // Save button
  const saveBtn = document.createElement('button');
  saveBtn.textContent = '💾 Save';
  saveBtn.style.cssText = 'width:100%;font-size:11px;margin-top:4px;';
  let saveTimer = null;
  saveBtn.addEventListener('click', () => {
    saveAppSettings({ notificationSound: notifSel.value });
    saveBtn.textContent = '✅ Saved';
    saveBtn.disabled = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveBtn.textContent = '💾 Save'; saveBtn.disabled = false; }, 2000);
  });

  body.appendChild(notifRow);
  body.appendChild(saveBtn);
  section.appendChild(header);
  section.appendChild(body);
  return section;
}
