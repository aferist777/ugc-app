/* ═══════════════════════════════════════════════════════════════
   SETTINGS — engine selection, persisted to localStorage + server
   ═══════════════════════════════════════════════════════════════ */

const IMAGE_ENGINE_KEY      = 'image_engine_v1';
const VIDEO_ENGINE_KEY      = 'video_engine_v1';   // grok video engine (Биролы)
const AUDIO_ENGINE_KEY      = 'audio_engine_v1';
const GROK_VIDEO_ENGINE_KEY = 'grok_video_engine_v1';

// ── Public API ────────────────────────────────────────────────────────────────
function getImageEngine() {
  return localStorage.getItem(IMAGE_ENGINE_KEY) || 'nano-banana-pro';
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

function getAudioEngine() { return localStorage.getItem(AUDIO_ENGINE_KEY) || 'elevenlabs/text-to-speech-turbo-2-5'; }
function setAudioEngine(engine) { localStorage.setItem(AUDIO_ENGINE_KEY, engine); }

// ── Engine parameter specs ────────────────────────────────────────────────────
// Defines editable JSON body parameters per engine with labels and descriptions.
const ENGINE_PARAMS_SPECS = {
  'nano-banana-pro': [
    {
      key: 'resolution', type: 'select', options: ['2K', '4K'], default: '2K',
      label: 'Разрешение',
      desc: 'Разрешение выходного изображения. 4K — выше детализация, но медленнее.',
    },
    {
      key: 'output_format', type: 'select', options: ['jpg', 'png'], default: 'jpg',
      label: 'Формат файла',
      desc: 'Формат выходного изображения. PNG без потерь, JPG — компактнее.',
    },
  ],
  'qwen2': [
    {
      key: 'output_format', type: 'select', options: ['jpeg', 'png'], default: 'jpeg',
      label: 'Формат файла',
      desc: 'Формат выходного изображения.',
    },
    {
      key: 'num_inference_steps', type: 'number', min: 1, max: 80, step: 1, default: 30,
      label: 'Шаги диффузии',
      desc: 'Количество шагов генерации (text-to-image). Больше = качественнее и медленнее.',
    },
    {
      key: 'guidance_scale', type: 'number', min: 1, max: 20, step: 0.1, default: 2.5,
      label: 'CFG Scale',
      desc: 'Следование тексту промпта (text-to-image). Выше = точнее к промпту, ниже = творчески.',
    },
  ],
  'seedream': [
    {
      key: 'quality', type: 'select', options: ['basic', 'high'], default: 'basic',
      label: 'Качество',
      desc: 'basic = 2K (быстро), high = 4K (медленнее, выше детализация).',
    },
  ],
  'elevenlabs/text-to-speech-turbo-2-5': [
    {
      key: 'stability', type: 'range', min: 0, max: 1, step: 0.05, default: 0.5,
      label: 'Стабильность',
      desc: 'Постоянство подачи голоса. Низкое = выразительнее и эмоциональнее, высокое = монотоннее.',
    },
    {
      key: 'similarity_boost', type: 'range', min: 0, max: 1, step: 0.05, default: 0.75,
      label: 'Сходство с голосом',
      desc: 'Близость к оригинальному голосу модели. Высокое = точнее к голосу, низкое = вариативнее.',
    },
    {
      key: 'style', type: 'range', min: 0, max: 1, step: 0.05, default: 0,
      label: 'Стиль/Эмоции',
      desc: 'Усиление индивидуальных черт голоса. 0 = нейтрально, выше = более характерно.',
    },
    {
      key: 'speed', type: 'range', min: 0.7, max: 1.3, step: 0.05, default: 1,
      label: 'Скорость речи',
      desc: 'Темп речи. 1.0 = нормальный, 0.7 = медленно, 1.3 = быстро.',
    },
  ],
  'kling/ai-avatar-pro': [
    {
      key: 'prompt', type: 'textarea', default: 'Natural speaking motion with subtle head movement',
      label: 'Промпт движений',
      desc: 'Описание движений аватара во время озвучки. Влияет на жесты, мимику и движения головы.',
    },
  ],
  'grok-imagine/image-to-video': [
    {
      key: 'duration', type: 'number', min: 6, max: 30, step: 1, default: 6,
      label: 'Длительность (сек)',
      desc: 'Длина видео от 6 до 30 секунд.',
    },
    {
      key: 'resolution', type: 'select', options: ['480p', '720p'], default: '480p',
      label: 'Разрешение',
      desc: '480p — быстрее, 720p — выше качество.',
    },
    {
      key: 'aspect_ratio', type: 'select', options: ['9:16', '16:9', '1:1', '2:3', '3:2'], default: '9:16',
      label: 'Соотношение сторон',
      desc: '9:16 для вертикальных UGC-видео, 16:9 для горизонтальных.',
    },
    {
      key: 'mode', type: 'select', options: ['normal', 'fun', 'spicy'], default: 'normal',
      label: 'Режим',
      desc: 'normal — стандартный, fun — динамичный, spicy — только для внутренних изображений.',
    },
  ],
  'grok-imagine/text-to-video': [
    {
      key: 'duration', type: 'number', min: 6, max: 30, step: 1, default: 6,
      label: 'Длительность (сек)',
      desc: 'Длина видео от 6 до 30 секунд.',
    },
    {
      key: 'resolution', type: 'select', options: ['480p', '720p'], default: '480p',
      label: 'Разрешение',
      desc: '480p — быстрее, 720p — выше качество.',
    },
    {
      key: 'aspect_ratio', type: 'select', options: ['9:16', '16:9', '1:1', '2:3', '3:2'], default: '9:16',
      label: 'Соотношение сторон',
      desc: '9:16 для вертикальных UGC-видео, 16:9 для горизонтальных.',
    },
    {
      key: 'mode', type: 'select', options: ['normal', 'fun'], default: 'normal',
      label: 'Режим',
      desc: 'normal — стандартный, fun — динамичный.',
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
  summary.innerHTML = '<span class="params-arrow">▶</span> Параметры';
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
  saveBtn.textContent = '💾 Сохранить';
  saveBtn.style.cssText = 'display:none;width:100%;margin-top:10px;font-size:11px;';
  let saveTimer = null;
  const markChanged = () => {
    saveBtn.style.display = 'block';
    saveBtn.textContent = '💾 Сохранить';
    saveBtn.disabled = false;
  };
  saveBtn.addEventListener('click', () => {
    // Persist image engine to server (already done on select change); rest is localStorage
    fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageEngine: getImageEngine() }),
    }).catch(() => {});
    saveBtn.textContent = '✅ Сохранено';
    saveBtn.disabled = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveBtn.style.display = 'none'; }, 2000);
  });

  // ── ImageEngines ──────────────────────────────────────────────────────────
  const imageSel = makeSelect([
    { value: 'nano-banana-pro', label: 'nano-banana-pro' },
    { value: 'qwen2',           label: 'Qwen2 (qwen2/image-edit)' },
    { value: 'seedream',        label: 'Seedream 5 Lite' },
  ], getImageEngine());

  body.appendChild(makeEngineRow('ImageEngines:', imageSel));
  body.appendChild(makeDesc(
    '<b>nano-banana-pro</b> — несколько референсов, оптимален для взаимодействий.<br>' +
    '<b>Qwen2</b> — одно референсное изображение, точное следование промпту.<br>' +
    '<b>Seedream 5 Lite</b> — до 14 референсов, качество 2K/4K.'
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
    '<b>Kling AI Avatar Pro</b> — lip-sync аватар. Привязан к генератору «Говорящая голова» во вкладке Сценарии.'
  ));

  const avatarParamsWrap = document.createElement('div');
  body.appendChild(avatarParamsWrap);
  const avatarDetails = buildCollapsibleParams('kling/ai-avatar-pro', markChanged);
  if (avatarDetails) avatarParamsWrap.appendChild(avatarDetails);

  body.appendChild(makeSeparator());

  // ── VideoEngines (Grok) ───────────────────────────────────────────────────
  const videoSel = makeSelect([
    { value: 'grok-imagine/image-to-video', label: 'Grok image-to-video' },
    { value: 'grok-imagine/text-to-video',  label: 'Grok text-to-video'  },
  ], getVideoEngine());

  body.appendChild(makeEngineRow('VideoEngines:', videoSel));
  body.appendChild(makeDesc(
    '<b>Grok image-to-video</b> — генерация видео из изображения + промпта (режим имг+видео).<br>' +
    '<b>Grok text-to-video</b> — прямая генерация видео из текстового промпта.'
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
    { value: 'elevenlabs/text-to-speech-turbo-2-5', label: 'ElevenLabs TTS Turbo 2.5' },
  ], getAudioEngine());

  body.appendChild(makeEngineRow('AudioEngines:', audioSel));
  body.appendChild(makeDesc(
    '<b>ElevenLabs TTS Turbo 2.5</b> — синтез речи с выбором голоса, скорости и стиля.'
  ));

  const audioParamsWrap = document.createElement('div');
  body.appendChild(audioParamsWrap);
  const audioDetails = buildCollapsibleParams(audioSel.value, markChanged);
  if (audioDetails) audioParamsWrap.appendChild(audioDetails);

  audioSel.addEventListener('change', () => {
    setAudioEngine(audioSel.value);
    setStatus?.(`AudioEngine: ${audioSel.value}`);
    markChanged();
  });

  body.appendChild(saveBtn);

  section.appendChild(header);
  section.appendChild(body);
  return section;
}

// ── Inject section into the left column of Мозги tab ─────────────────────────
function appendCreationEnginesToMozgi() {
  const container = document.getElementById('creation-engines-container');
  if (!container) return;
  container.innerHTML = '';
  container.appendChild(buildCreationEnginesSection());
}

// Inject on page load (left column is always in DOM)
appendCreationEnginesToMozgi();
