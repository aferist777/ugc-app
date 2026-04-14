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

let customOptionsData = {};  // { dropdown: [{ id, name, prompt }] }

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

// ── Build "Создать опцию" panel for Мозги ─────────────────────────────────────
// Called from prompts.js buildAccordionGroup when subgroup.dropdown is set
function buildCustomOptionPanel(dropdown) {
  const panel = document.createElement('div');
  panel.className = 'cop-panel';

  // List of existing custom options
  const listEl = document.createElement('div');
  listEl.className = 'cop-list';
  _renderCopList(listEl, dropdown);

  // "＋ Создать опцию" toggle button
  const addBtn = document.createElement('button');
  addBtn.className = 'cop-add-btn';
  addBtn.textContent = '＋ Создать опцию';

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

  // ── Image extract zone ──
  const imgRow = document.createElement('div');
  imgRow.className = 'cop-row cop-img-row';
  const imgLbl = document.createElement('label');
  imgLbl.className = 'cop-label';
  imgLbl.textContent = 'фото (опц.):';

  const imgZone = document.createElement('div');
  imgZone.className = 'cop-img-zone';
  imgZone.title = 'Нажмите или вставьте изображение (Ctrl+V)';

  const imgPreview = document.createElement('img');
  imgPreview.className = 'cop-img-preview';
  imgPreview.style.display = 'none';

  const imgPlaceholder = document.createElement('span');
  imgPlaceholder.className = 'cop-img-placeholder';
  imgPlaceholder.textContent = '+ фото';

  const imgFileInput = document.createElement('input');
  imgFileInput.type = 'file';
  imgFileInput.accept = 'image/jpeg,image/png,image/webp';
  imgFileInput.style.display = 'none';

  let imgBase64 = null;

  function setImage(blob) {
    const reader = new FileReader();
    reader.onload = e => {
      const dataUrl = e.target.result;
      imgBase64 = dataUrl.split(',')[1];
      imgPreview.src = dataUrl;
      imgPreview.style.display = 'block';
      imgPlaceholder.style.display = 'none';
      extractBtn.disabled = false;
    };
    reader.readAsDataURL(blob);
  }

  imgZone.addEventListener('click', () => imgFileInput.click());
  imgFileInput.addEventListener('change', () => { if (imgFileInput.files[0]) setImage(imgFileInput.files[0]); });
  imgZone.addEventListener('paste', e => {
    const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
    if (item) { e.preventDefault(); setImage(item.getAsFile()); }
  });
  // Also allow global paste when promptIn or nameIn is focused
  [nameIn, promptIn].forEach(el => {
    el.addEventListener('paste', e => {
      const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
      if (item) { e.preventDefault(); setImage(item.getAsFile()); }
    });
  });

  imgZone.appendChild(imgPreview);
  imgZone.appendChild(imgPlaceholder);
  imgRow.appendChild(imgLbl);
  imgRow.appendChild(imgZone);
  imgRow.appendChild(imgFileInput);

  const extractBtn = document.createElement('button');
  extractBtn.className = 'cop-extract-btn';
  extractBtn.textContent = '🤖 Извлечь из фото';
  extractBtn.title = 'Отправить фото на анализ ИИ и получить промпт';
  extractBtn.disabled = true;

  const extractStatus = document.createElement('div');
  extractStatus.className = 'cop-extract-status';

  extractBtn.addEventListener('click', async () => {
    if (!imgBase64) return;
    extractBtn.disabled = true;
    extractBtn.textContent = '⏳ Анализирую…';
    extractStatus.textContent = '';
    try {
      const r = await fetch('/api/custom-options/analyze-image', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: imgBase64, dropdown }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error);
      promptIn.value = d.result;
      extractStatus.textContent = '✓ Промпт извлечён. Отредактируйте если нужно.';
      extractStatus.style.color = '#007700';
    } catch (err) {
      extractStatus.textContent = 'Ошибка: ' + err.message;
      extractStatus.style.color = '#aa0000';
    } finally {
      extractBtn.disabled = false;
      extractBtn.textContent = '🤖 Извлечь из фото';
    }
  });

  const saveBtn = document.createElement('button');
  saveBtn.className = 'cop-save-btn';
  saveBtn.textContent = '💾 Добавить';

  inputCol.appendChild(nameRow);
  inputCol.appendChild(imgRow);
  inputCol.appendChild(extractBtn);
  inputCol.appendChild(extractStatus);
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
    addBtn.textContent = open ? '＋ Создать опцию' : '✕ Отменить';
    if (!open) nameIn.focus();
  });

  // ── Save ──
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
      addBtn.textContent = '＋ Создать опцию';
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

    row.appendChild(nameEl);
    row.appendChild(promptEl);
    row.appendChild(delBtn);
    listEl.appendChild(row);
  });
}
