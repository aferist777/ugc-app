/* ═══════════════════════════════════════════════════════════════
   CUSTOM OPTIONS — user-defined entries for Черновик dropdowns
   ═══════════════════════════════════════════════════════════════ */

// Value prefix used to identify custom options in select elements
const CUSTOM_PREFIX = 'custom__';

// Map: dropdown-id → select element id in Черновик
const DROPDOWN_SELECT_IDS = {
  'pose':      'pose',
  'emotion':   'emotion',
  'char-type': 'char-type',
  'age':       'age',
  'gender':    'gender',
};

// Labels shown in Мозги
const DROPDOWN_LABELS = {
  'pose':      'Поза',
  'emotion':   'Эмоция',
  'char-type': 'Тип',
  'age':       'Возраст',
  'gender':    'Пол',
};

// Template keys shown in legend (clickable → inserted at cursor)
const DROPDOWN_LEGEND_KEYS = {
  'pose':      [
    { key: '{gender}', hint: 'мужчина / женщина' },
    { key: '{age}',    hint: 'возраст персонажа'  },
  ],
  'emotion':   [],
  'char-type': [
    { key: '{gender}', hint: 'мужчина / женщина' },
    { key: '{age}',    hint: 'возраст персонажа'  },
    { key: '{name}',   hint: 'имя персонажа'       },
  ],
  'age':       [],
  'gender':    [],
};

// Dropdowns that support full image-based analysis (get name + prompt from AI)
const ANALYZE_DROPDOWNS = new Set(['pose', 'emotion', 'char-type']);

let customOptionsData = {};  // { dropdown: [{ id, name, prompt, imageId? }] }

// ── Load from server and populate all dropdowns ───────────────────────────────
async function loadCustomOptions() {
  try {
    const d = await fetch('/api/custom-options').then(r => r.json());
    if (d.success) {
      customOptionsData = d.options || {};
      _populateAllDropdowns();
    }
  } catch (e) { console.warn('[custom-options] load failed:', e.message); }
}

function _populateAllDropdowns() {
  for (const [dropdown, selId] of Object.entries(DROPDOWN_SELECT_IDS)) {
    _populateDropdown(dropdown, selId);
  }
}

function _populateDropdown(dropdown, selId) {
  const sel = document.getElementById(selId);
  if (!sel) return;
  // Remove previously injected custom options
  sel.querySelectorAll('[data-custom-opt]').forEach(o => o.remove());
  const items = customOptionsData[dropdown] || [];
  if (!items.length) return;

  const sep = document.createElement('option');
  sep.disabled = true;
  sep.textContent = '── Свои ──';
  sep.dataset.customOpt = '1';
  sel.appendChild(sep);

  items.forEach(item => {
    const opt = document.createElement('option');
    opt.value = CUSTOM_PREFIX + dropdown + '__' + item.id;
    opt.textContent = item.name;
    opt.dataset.customOpt = '1';
    sel.appendChild(opt);
  });
}

// ── Resolve a custom select value → prompt text ───────────────────────────────
// Returns '' if not a custom value or if prompt is empty
function resolveCustomSelectValue(selectValue) {
  if (!selectValue?.startsWith(CUSTOM_PREFIX)) return null; // not custom
  const parts = selectValue.slice(CUSTOM_PREFIX.length).split('__');
  const dropdown = parts[0];
  const id       = parts[1];
  if (!dropdown || !id) return '';
  const item = (customOptionsData[dropdown] || []).find(i => i.id === id);
  return item ? item.prompt : '';
}

// Checks if a value is a custom option
function isCustomValue(val) {
  return val?.startsWith(CUSTOM_PREFIX);
}

// ── Analysis popup modal ──────────────────────────────────────────────────────
function showAnalysisPopup({ dropdown, imageDataUrl, name, prompt, listEl }) {
  // Remove any existing popup
  document.getElementById('cop-analysis-popup')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'cop-analysis-popup';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:10000;display:flex;align-items:center;justify-content:center;';

  const box = document.createElement('div');
  box.style.cssText = 'background:#f4f4f4;width:700px;max-width:96vw;border:2px solid #000080;box-shadow:4px 4px 16px #0005;display:flex;flex-direction:column;';

  // Header
  const hdr = document.createElement('div');
  hdr.style.cssText = 'background:#000080;color:#fff;padding:5px 10px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;';
  hdr.innerHTML = `<span style="font-weight:bold;font-size:12px;">Анализ ИИ — ${DROPDOWN_LABELS[dropdown] || dropdown}</span>`;
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.style.cssText = 'background:transparent;border:1px solid #aac;color:#fff;padding:1px 7px;cursor:pointer;font-size:11px;';
  closeBtn.addEventListener('click', () => overlay.remove());
  hdr.appendChild(closeBtn);

  // Body: left inputs + right image
  const body = document.createElement('div');
  body.style.cssText = 'display:flex;gap:0;padding:12px;gap:12px;';

  // Left column
  const left = document.createElement('div');
  left.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:8px;min-width:0;';

  const nameLbl = document.createElement('label');
  nameLbl.style.cssText = 'font-size:10px;font-weight:bold;';
  nameLbl.textContent = 'Название (отображается в dropdown):';
  const nameIn = document.createElement('input');
  nameIn.type = 'text';
  nameIn.value = name || '';
  nameIn.style.cssText = 'font-size:11px;padding:3px 5px;width:100%;box-sizing:border-box;';

  const promptLbl = document.createElement('label');
  promptLbl.style.cssText = 'font-size:10px;font-weight:bold;margin-top:4px;';
  promptLbl.textContent = 'Промпт:';
  const promptIn = document.createElement('textarea');
  promptIn.value = prompt || '';
  promptIn.rows = 6;
  promptIn.style.cssText = 'font-size:11px;padding:3px 5px;width:100%;box-sizing:border-box;resize:vertical;font-family:monospace;';

  // Legend keys (clickable)
  const legendKeys = DROPDOWN_LEGEND_KEYS[dropdown] || [];
  let legendEl = null;
  if (legendKeys.length) {
    legendEl = document.createElement('div');
    legendEl.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;';
    legendKeys.forEach(({ key, hint }) => {
      const chip = document.createElement('span');
      chip.style.cssText = 'font-size:10px;background:#e0e8ff;border:1px solid #88a;padding:1px 5px;cursor:pointer;border-radius:2px;';
      chip.title = hint;
      chip.textContent = key;
      chip.addEventListener('click', () => {
        const pos = promptIn.selectionStart ?? promptIn.value.length;
        promptIn.value = promptIn.value.slice(0, pos) + key + promptIn.value.slice(pos);
        promptIn.focus();
        promptIn.setSelectionRange(pos + key.length, pos + key.length);
      });
      legendEl.appendChild(chip);
    });
  }

  const saveBtn = document.createElement('button');
  saveBtn.textContent = '💾 Сохранить опцию';
  saveBtn.style.cssText = 'margin-top:8px;padding:5px;font-weight:bold;font-size:11px;background:#000080;color:#fff;border:none;cursor:pointer;';

  left.appendChild(nameLbl);
  left.appendChild(nameIn);
  left.appendChild(promptLbl);
  left.appendChild(promptIn);
  if (legendEl) left.appendChild(legendEl);
  left.appendChild(saveBtn);

  // Right column: image preview
  const right = document.createElement('div');
  right.style.cssText = 'width:200px;flex-shrink:0;display:flex;flex-direction:column;align-items:center;gap:6px;';
  const imgEl = document.createElement('img');
  imgEl.src = imageDataUrl;
  imgEl.style.cssText = 'width:100%;max-height:260px;object-fit:contain;border:1px solid #ccc;background:#000;';
  const imgNote = document.createElement('div');
  imgNote.style.cssText = 'font-size:9px;color:#888;text-align:center;';
  imgNote.textContent = 'Изображение будет сохранено\nвместе с опцией';
  right.appendChild(imgEl);
  right.appendChild(imgNote);

  body.appendChild(left);
  body.appendChild(right);
  box.appendChild(hdr);
  box.appendChild(body);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  nameIn.focus();

  saveBtn.addEventListener('click', async () => {
    const n = nameIn.value.trim();
    const p = promptIn.value.trim();
    if (!n) { nameIn.focus(); return; }
    saveBtn.disabled = true;
    saveBtn.textContent = '⏳ Сохраняю…';
    try {
      const b64 = imageDataUrl.includes(',') ? imageDataUrl.split(',')[1] : imageDataUrl;
      const r = await fetch(`/api/custom-options/${dropdown}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: n, prompt: p, imageRef: b64 }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error);

      if (!customOptionsData[dropdown]) customOptionsData[dropdown] = [];
      customOptionsData[dropdown].push(d.item);
      _populateDropdown(dropdown, DROPDOWN_SELECT_IDS[dropdown]);
      if (listEl) _renderCopList(listEl, dropdown);
      overlay.remove();
      setStatus?.(`Опция «${n}» добавлена → ${DROPDOWN_LABELS[dropdown]}.`);
    } catch (e) {
      setStatus?.('Ошибка: ' + e.message);
      saveBtn.disabled = false;
      saveBtn.textContent = '💾 Сохранить опцию';
    }
  });
}

// ── Drag-drop image zone that triggers immediate AI analysis ──────────────────
function buildImageAnalyzeZone(dropdown, listEl) {
  const zone = document.createElement('div');
  zone.className = 'cop-analyze-zone';
  zone.innerHTML = `<span class="cop-az-icon">📷</span><span class="cop-az-text">Перетащите фото или нажмите для анализа ИИ</span>`;

  const fileIn = document.createElement('input');
  fileIn.type = 'file';
  fileIn.accept = 'image/jpeg,image/png,image/webp';
  fileIn.style.display = 'none';
  zone.appendChild(fileIn);

  let analyzing = false;
  let lastBlob = null;

  // Inline error area inside zone
  const azErr = document.createElement('div');
  azErr.style.cssText = 'display:none;margin-top:4px;padding:3px 6px;background:#3a1111;border:1px solid #a33;border-radius:3px;font-size:9px;color:#f99;text-align:left;';
  const azErrMsg = document.createElement('span');
  const azRetry  = document.createElement('button');
  azRetry.textContent = '↺ Повторить';
  azRetry.style.cssText = 'margin-left:6px;font-size:9px;padding:1px 5px;cursor:pointer;background:#1155cc;color:#fff;border:none;border-radius:3px;';
  azErr.appendChild(azErrMsg);
  azErr.appendChild(azRetry);
  zone.appendChild(azErr);

  async function analyzeImage(blob) {
    if (analyzing) return;
    analyzing = true;
    lastBlob = blob;
    azErr.style.display = 'none';
    zone.classList.add('cop-az-loading');
    zone.querySelector('.cop-az-text').textContent = '⏳ Анализирую…';

    try {
      const dataUrl = await new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onload = e => res(e.target.result);
        reader.onerror = rej;
        reader.readAsDataURL(blob);
      });
      const b64 = dataUrl.split(',')[1];
      const r = await fetch('/api/custom-options/analyze-image', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: b64, dropdown }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error);
      // Show popup with results
      showAnalysisPopup({ dropdown, imageDataUrl: dataUrl, name: d.name || '', prompt: d.prompt || d.result || '', listEl });
    } catch (err) {
      setStatus?.('Ошибка анализа: ' + err.message);
      azErrMsg.textContent = err.message;
      azErr.style.display = 'block';
    } finally {
      analyzing = false;
      zone.classList.remove('cop-az-loading');
      zone.querySelector('.cop-az-text').textContent = 'Перетащите фото или нажмите для анализа ИИ';
    }
  }

  azRetry.addEventListener('click', e => {
    e.stopPropagation(); // don't trigger zone click → fileInput
    if (lastBlob) analyzeImage(lastBlob);
  });

  zone.addEventListener('click', () => fileIn.click());
  fileIn.addEventListener('change', () => { if (fileIn.files[0]) analyzeImage(fileIn.files[0]); });
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('cop-az-drag'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('cop-az-drag'));
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.classList.remove('cop-az-drag');
    const f = [...e.dataTransfer.files].find(f => f.type.startsWith('image/'));
    if (f) analyzeImage(f);
  });
  zone.addEventListener('paste', e => {
    const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
    if (item) { e.preventDefault(); analyzeImage(item.getAsFile()); }
  });

  return zone;
}

// ── Build "Создать опцию" panel for Мозги ─────────────────────────────────────
// Called from prompts.js buildAccordionGroup when subgroup.dropdown is set
function buildCustomOptionPanel(dropdown) {
  const panel = document.createElement('div');
  panel.className = 'cop-panel';

  // List of existing custom options
  const listEl = document.createElement('div');
  listEl.className = 'cop-list';
  _renderCopList(listEl, dropdown);

  // ── Drag-drop analyze zone (only for supported dropdowns) ──
  if (ANALYZE_DROPDOWNS.has(dropdown)) {
    panel.appendChild(buildImageAnalyzeZone(dropdown, listEl));
  }

  // "＋ Создать опцию вручную" toggle button
  const addBtn = document.createElement('button');
  addBtn.className = 'cop-add-btn';
  addBtn.textContent = '＋ Создать вручную';

  // Form (hidden initially)
  const form = document.createElement('div');
  form.className = 'cop-form';
  form.style.display = 'none';

  // ── Left: inputs ──
  const inputCol = document.createElement('div');
  inputCol.className = 'cop-input-col';

  const nameRow = document.createElement('div');
  nameRow.className = 'cop-row';
  const nameLbl = document.createElement('label');
  nameLbl.className = 'cop-label';
  nameLbl.textContent = 'промпт-нейм:';
  const nameIn = document.createElement('input');
  nameIn.type = 'text';
  nameIn.className = 'cop-name-input';
  nameIn.placeholder = 'Отображается в dropdown…';
  nameRow.appendChild(nameLbl);
  nameRow.appendChild(nameIn);

  const promptRow = document.createElement('div');
  promptRow.className = 'cop-row';
  const promptLbl = document.createElement('label');
  promptLbl.className = 'cop-label';
  promptLbl.textContent = 'промпт:';
  const promptIn = document.createElement('textarea');
  promptIn.className = 'cop-prompt-input';
  promptIn.rows = 5;
  promptIn.placeholder = 'Текст промпта для генерации…';
  promptRow.appendChild(promptLbl);
  promptRow.appendChild(promptIn);

  const saveBtn = document.createElement('button');
  saveBtn.className = 'cop-save-btn';
  saveBtn.textContent = '💾 Добавить';

  inputCol.appendChild(nameRow);
  inputCol.appendChild(promptRow);
  inputCol.appendChild(saveBtn);
  form.appendChild(inputCol);

  // ── Right: legend (only if keys exist) ──
  const legendKeys = DROPDOWN_LEGEND_KEYS[dropdown] || [];
  if (legendKeys.length) {
    const legendEl = document.createElement('div');
    legendEl.className = 'cop-legend';

    const legendTitle = document.createElement('div');
    legendTitle.className = 'cop-legend-title';
    legendTitle.textContent = 'Ключи для промпта:';
    legendEl.appendChild(legendTitle);

    legendKeys.forEach(({ key, hint }) => {
      const chip = document.createElement('div');
      chip.className = 'cop-legend-key';
      chip.innerHTML = `<b>${key}</b> <span class="cop-legend-hint">${hint}</span>`;
      chip.title = 'Нажмите чтобы вставить в промпт';
      chip.addEventListener('click', () => {
        const pos = promptIn.selectionStart ?? promptIn.value.length;
        promptIn.value = promptIn.value.slice(0, pos) + key + promptIn.value.slice(pos);
        promptIn.focus();
        promptIn.setSelectionRange(pos + key.length, pos + key.length);
      });
      legendEl.appendChild(chip);
    });
    form.appendChild(legendEl);
  }

  // ── Toggle form ──
  addBtn.addEventListener('click', () => {
    const open = form.style.display !== 'none';
    form.style.display = open ? 'none' : 'flex';
    addBtn.textContent = open ? '＋ Создать вручную' : '✕ Отменить';
    if (!open) nameIn.focus();
  });

  // ── Save manual ──
  saveBtn.addEventListener('click', async () => {
    const name   = nameIn.value.trim();
    const prompt = promptIn.value.trim();
    if (!name) { setStatus?.('Введите промпт-нейм.'); nameIn.focus(); return; }
    saveBtn.disabled = true;
    try {
      const r = await fetch(`/api/custom-options/${dropdown}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, prompt }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error);

      if (!customOptionsData[dropdown]) customOptionsData[dropdown] = [];
      customOptionsData[dropdown].push(d.item);
      _populateDropdown(dropdown, DROPDOWN_SELECT_IDS[dropdown]);
      _renderCopList(listEl, dropdown);

      nameIn.value = '';
      promptIn.value = '';
      form.style.display = 'none';
      addBtn.textContent = '＋ Создать вручную';
      setStatus?.(`Опция «${name}» добавлена → ${DROPDOWN_LABELS[dropdown]}.`);
    } catch (e) {
      setStatus?.('Ошибка: ' + e.message);
    } finally {
      saveBtn.disabled = false;
    }
  });

  panel.appendChild(addBtn);
  panel.appendChild(form);
  panel.appendChild(listEl);
  return panel;
}

function _renderCopList(listEl, dropdown) {
  listEl.innerHTML = '';
  const items = customOptionsData[dropdown] || [];
  if (!items.length) return;

  const title = document.createElement('div');
  title.className = 'cop-list-title';
  title.textContent = 'Пользовательские опции:';
  listEl.appendChild(title);

  items.forEach(item => {
    const row = document.createElement('div');
    row.className = 'cop-item';

    const nameEl = document.createElement('span');
    nameEl.className = 'cop-item-name';
    nameEl.textContent = item.name;

    const promptEl = document.createElement('span');
    promptEl.className = 'cop-item-prompt';
    const preview = item.prompt ? item.prompt.slice(0, 70) + (item.prompt.length > 70 ? '…' : '') : '(без промпта)';
    promptEl.textContent = preview;
    promptEl.title = item.prompt || '';

    const delBtn = document.createElement('button');
    delBtn.className = 'g-delete cop-item-del';
    delBtn.textContent = '✕';
    delBtn.title = 'Удалить опцию';
    delBtn.addEventListener('click', async () => {
      delBtn.disabled = true;
      try {
        await fetch(`/api/custom-options/${dropdown}/${item.id}`, { method: 'DELETE' });
        customOptionsData[dropdown] = (customOptionsData[dropdown] || []).filter(i => i.id !== item.id);
        _populateDropdown(dropdown, DROPDOWN_SELECT_IDS[dropdown]);
        _renderCopList(listEl, dropdown);
        setStatus?.(`Опция «${item.name}» удалена.`);
      } catch (e) {
        setStatus?.('Ошибка удаления: ' + e.message);
        delBtn.disabled = false;
      }
    });

    if (item.imageId) {
      const thumb = document.createElement('img');
      thumb.src = `/api/custom-options/image/${item.imageId}`;
      thumb.className = 'cop-item-thumb';
      thumb.title = 'Исходное изображение анализа';
      thumb.style.cssText = 'width:36px;height:36px;object-fit:cover;border-radius:3px;flex-shrink:0;cursor:pointer;';
      thumb.addEventListener('click', () => {
        const ov = document.createElement('div');
        ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:10000;display:flex;align-items:center;justify-content:center;cursor:zoom-out;';
        const big = document.createElement('img');
        big.src = thumb.src;
        big.style.cssText = 'max-width:90vw;max-height:90vh;border-radius:6px;box-shadow:0 4px 24px rgba(0,0,0,.6);';
        ov.appendChild(big);
        ov.addEventListener('click', () => ov.remove());
        document.body.appendChild(ov);
      });
      row.appendChild(thumb);
    }
    row.appendChild(nameEl);
    row.appendChild(promptEl);
    row.appendChild(delBtn);
    listEl.appendChild(row);
  });
}
