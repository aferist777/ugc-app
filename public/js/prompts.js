/* ═══════════════════════════════════════════════════════════════
   МОЗГИ — system prompt editor with version history
   ═══════════════════════════════════════════════════════════════ */

let promptsData = [];   // full state from server
let promptsLoaded = false;

// ── Render fixed-phrase hint below editor ─────────────────────────────────────
function renderFixedHint(fixedPhrases) {
  if (!fixedPhrases.length) return null;
  const div = document.createElement('div');
  div.className = 'prompt-fixed-hint';
  div.innerHTML = '🔒 Нельзя удалять: ' +
    fixedPhrases.map(p => `<b>"${p}"</b>`).join('; ');
  return div;
}

// ── Build one prompt block ────────────────────────────────────────────────────
function buildPromptBlock(p) {
  const block = document.createElement('div');
  block.className = 'prompt-block';
  if (p.current !== p.default) block.classList.add('modified');
  block.dataset.key = p.key;

  // ── Header ─────────────────────────────────────────────────────────────────
  const header = document.createElement('div');
  header.className = 'prompt-block-header';

  const label = document.createElement('span');
  label.className = 'prompt-block-label';
  label.textContent = p.label;

  const badge = document.createElement('span');
  badge.className = 'prompt-modified-badge';
  badge.textContent = 'изменён';

  const verSel = document.createElement('select');
  verSel.className = 'prompt-version-select';
  verSel.title = 'История версий';
  rebuildVersionSelect(verSel, p);

  const resetBtn = document.createElement('button');
  resetBtn.className = 'prompt-btn-reset';
  resetBtn.textContent = '↺ Сброс';
  resetBtn.title = 'Вернуть промпт по умолчанию';

  const saveBtn = document.createElement('button');
  saveBtn.className = 'prompt-btn-save';
  saveBtn.textContent = '💾 Сохранить';

  header.appendChild(label);
  header.appendChild(badge);
  header.appendChild(verSel);
  header.appendChild(resetBtn);
  header.appendChild(saveBtn);

  // ── Body ───────────────────────────────────────────────────────────────────
  const body = document.createElement('div');
  body.className = 'prompt-body';

  const editor = document.createElement('div');
  editor.className = 'prompt-editor';
  editor.contentEditable = 'true';
  editor.spellcheck = false;
  renderEditorContent(editor, p.current, p.fixedPhrases);

  const hint = renderFixedHint(p.fixedPhrases);

  body.appendChild(editor);
  if (hint) body.appendChild(hint);

  block.appendChild(header);
  block.appendChild(body);

  // ── Version select: load historical version into editor ───────────────────
  verSel.addEventListener('change', () => {
    const val = verSel.value;
    editor.blur();
    if (val === '__current__') {
      renderEditorContent(editor, p.current, p.fixedPhrases);
    } else {
      const ver = p.versions[parseInt(val, 10)];
      if (ver) renderEditorContent(editor, ver.text, p.fixedPhrases);
    }
  });

  // ── Save ──────────────────────────────────────────────────────────────────
  saveBtn.addEventListener('click', async () => {
    const text = editor.innerText.trim();
    if (!text) return;
    // Validate fixed phrases
    for (const phrase of p.fixedPhrases) {
      if (!text.includes(phrase)) {
        setStatus(`Ошибка: обязательная фраза не найдена: "${phrase}"`);
        return;
      }
    }
    saveBtn.disabled = true;
    try {
      const r = await fetch(`/api/prompts/${p.key}/save`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error);
      // Update local state
      p.versions.unshift({ text: p.current, ts: new Date().toISOString() });
      p.versions = p.versions.slice(0, 10);
      p.current = text;
      block.classList.toggle('modified', text !== p.default);
      rebuildVersionSelect(verSel, p);
      setStatus(`Промпт «${p.label}» сохранён.`);
    } catch (e) { setStatus('Ошибка сохранения: ' + e.message); }
    finally { saveBtn.disabled = false; }
  });

  // ── Reset ─────────────────────────────────────────────────────────────────
  resetBtn.addEventListener('click', async () => {
    resetBtn.disabled = true;
    resetBtn.textContent = '…';
    try {
      const r = await fetch(`/api/prompts/${p.key}/reset`, { method: 'POST' });
      const d = await r.json();
      if (!d.success) throw new Error(d.error);
      if (p.current !== p.default) {
        p.versions.unshift({ text: p.current, ts: new Date().toISOString() });
        p.versions = p.versions.slice(0, 10);
      }
      p.current = p.default;
      block.classList.remove('modified');
      editor.blur();
      renderEditorContent(editor, p.default, p.fixedPhrases);
      rebuildVersionSelect(verSel, p);
      setStatus(`Промпт «${p.label}» сброшен.`);
      resetBtn.textContent = '✓ Сброшен';
      setTimeout(() => { resetBtn.textContent = '↺ Сброс'; }, 1500);
    } catch (e) {
      setStatus('Ошибка сброса: ' + e.message);
      resetBtn.textContent = '↺ Сброс';
    }
    finally { resetBtn.disabled = false; }
  });

  return block;
}

// ── Render editor content: highlight fixed phrases in blue/bold ───────────────
function renderEditorContent(editor, text, fixedPhrases) {
  if (!fixedPhrases.length) {
    editor.textContent = text;
    return;
  }
  // Build regex that matches any fixed phrase
  const escaped = fixedPhrases.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`(${escaped.join('|')})`, 'g');
  // Split into parts
  const parts = text.split(re);
  editor.innerHTML = '';
  for (const part of parts) {
    if (fixedPhrases.includes(part)) {
      const b = document.createElement('b');
      b.style.color = '#000080';
      b.textContent = part;
      editor.appendChild(b);
    } else {
      editor.appendChild(document.createTextNode(part));
    }
  }
}

// ── Rebuild version dropdown ──────────────────────────────────────────────────
function rebuildVersionSelect(sel, p) {
  sel.innerHTML = '';
  const cur = document.createElement('option');
  cur.value = '__current__';
  cur.textContent = p.current === p.default ? '— текущая (по умолч.) —' : '— текущая (изменена) —';
  sel.appendChild(cur);
  if (p.versions.length) {
    const sep = document.createElement('option');
    sep.disabled = true;
    sep.textContent = '── история ──';
    sel.appendChild(sep);
    p.versions.forEach((v, i) => {
      const opt = document.createElement('option');
      opt.value = i;
      const ts = new Date(v.ts).toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
      opt.textContent = `v${p.versions.length - i} · ${ts}`;
      sel.appendChild(opt);
    });
  }
  sel.value = '__current__';
}

// ── Accordion group structure ─────────────────────────────────────────────────
const PROMPT_GROUPS = [
  {
    label: '🧑 Персонаж',
    subgroups: [
      {
        label: 'Левый столбец — Позы',
        keys: ['pose_desk', 'pose_sofa', 'pose_window', 'pose_kitchen', 'pose_standing'],
      },
      {
        label: 'Средний столбец — Применить ассеты',
        keys: ['APPLY_LOOKBOOK_PROMPT', 'APPLY_ENV_PROMPT'],
      },
      {
        label: 'Правый столбец — Обринж',
        keys: ['TPOSE_PROMPT', 'EXTRACT_BG_PROMPT_SQ'],
      },
    ],
  },
  {
    label: '👗 Лукбук',
    subgroups: [
      {
        label: 'Правый столбец — Генерация',
        keys: ['EXTRACT_CLOTHING_PROMPT', 'EXTRACT_BG_PROMPT'],
      },
    ],
  },
  {
    label: '🎬 Сцены',
    subgroups: [
      {
        label: 'Левый столбец — Анализ сцены',
        keys: ['SCENE_ANALYSIS_PROMPT'],
      },
    ],
  },
];

function buildAccordionGroup(group, byKey) {
  const groupEl = document.createElement('div');
  groupEl.className = 'mozgi-group';

  const header = document.createElement('div');
  header.className = 'mozgi-group-header';
  const arrow = document.createElement('span');
  arrow.className = 'mozgi-group-arrow';
  arrow.textContent = '▶';
  const labelEl = document.createElement('span');
  labelEl.textContent = group.label;
  header.appendChild(arrow);
  header.appendChild(labelEl);

  const body = document.createElement('div');
  body.className = 'mozgi-group-body mozgi-collapsed';

  header.addEventListener('click', () => {
    const collapsed = body.classList.toggle('mozgi-collapsed');
    arrow.textContent = collapsed ? '▶' : '▼';
  });

  for (const sub of group.subgroups) {
    const subEl = document.createElement('div');
    subEl.className = 'mozgi-subgroup';

    const subHeader = document.createElement('div');
    subHeader.className = 'mozgi-subgroup-header';
    const subArrow = document.createElement('span');
    subArrow.className = 'mozgi-group-arrow';
    subArrow.textContent = '▶';
    const subLabel = document.createElement('span');
    subLabel.textContent = sub.label;
    subHeader.appendChild(subArrow);
    subHeader.appendChild(subLabel);

    const subBody = document.createElement('div');
    subBody.className = 'mozgi-subgroup-body mozgi-collapsed';

    subHeader.addEventListener('click', () => {
      const collapsed = subBody.classList.toggle('mozgi-collapsed');
      subArrow.textContent = collapsed ? '▶' : '▼';
    });

    for (const key of sub.keys) {
      const p = byKey[key];
      if (p) subBody.appendChild(buildPromptBlock(p));
    }

    subEl.appendChild(subHeader);
    subEl.appendChild(subBody);
    body.appendChild(subEl);
  }

  groupEl.appendChild(header);
  groupEl.appendChild(body);
  return groupEl;
}

// ── Load and render all prompts ───────────────────────────────────────────────
async function loadPrompts() {
  const container = document.getElementById('prompts-container');
  if (!container) return;
  try {
    const d = await fetch('/api/prompts').then(r => r.json());
    if (!d.success) throw new Error(d.error);
    promptsData = d.prompts;

    const byKey = {};
    d.prompts.forEach(p => { byKey[p.key] = p; });

    container.innerHTML = '';

    for (const group of PROMPT_GROUPS) {
      container.appendChild(buildAccordionGroup(group, byKey));
    }

    // Any prompts not assigned to a group fall into "Прочее"
    const grouped = new Set(PROMPT_GROUPS.flatMap(g => g.subgroups.flatMap(s => s.keys)));
    const rest = d.prompts.filter(p => !grouped.has(p.key));
    if (rest.length) {
      const miscGroup = {
        label: '📦 Прочее',
        subgroups: [{ label: 'Неклассифицированные', keys: rest.map(p => p.key) }],
      };
      container.appendChild(buildAccordionGroup(miscGroup, byKey));
    }

    promptsLoaded = true;
  } catch (e) {
    container.innerHTML = `<div style="color:#a00;padding:20px;font-size:11px;">Ошибка загрузки промптов: ${e.message}</div>`;
  }
}
