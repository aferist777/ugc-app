/* ═══════════════════════════════════════════════════════════════
   МОЗГИ — system prompt editor with version history
   ═══════════════════════════════════════════════════════════════ */

let promptsData = [];   // full state from server
let promptsLoaded = false;
// Expose so other modules can invalidate the cache
Object.defineProperty(window, 'promptsLoaded', {
  get: () => promptsLoaded,
  set: v => { promptsLoaded = v; },
});

// ── Helper: get a single prompt's current text (used by biroly.js) ────────────
async function getPromptText(key) {
  if (promptsLoaded) {
    return promptsData.find(p => p.key === key)?.current || null;
  }
  try {
    const d = await fetch('/api/prompts').then(r => r.json());
    if (d.success) { promptsData = d.prompts; promptsLoaded = true; }
    return d.prompts?.find(p => p.key === key)?.current || null;
  } catch { return null; }
}
window.getPromptText = getPromptText;

// ── Rename map: which prompt keys appear in a dropdown and how ────────────────
// prefix = immutable part shown in Мозги before the editable name
// selectId = id of the <select> in Черновик
// optionValue = value attribute of the <option> to update
const RENAME_MAP = {
  pose_desk:          { prefix: 'Поза 1 — ', selectId: 'pose',    optionValue: 'pose_desk'    },
  pose_sofa:          { prefix: 'Поза 2 — ', selectId: 'pose',    optionValue: 'pose_sofa'    },
  pose_window:        { prefix: 'Поза 3 — ', selectId: 'pose',    optionValue: 'pose_window'  },
  pose_kitchen:       { prefix: 'Поза 4 — ', selectId: 'pose',    optionValue: 'pose_kitchen' },
  pose_standing:      { prefix: 'Поза 5 — ', selectId: 'pose',    optionValue: 'pose_standing'},
  emotion_neutral:    { prefix: 'Эмоция: ',  selectId: 'emotion', optionValue: 'neutral'      },
  emotion_smile:      { prefix: 'Эмоция: ',  selectId: 'emotion', optionValue: 'smile'        },
  emotion_joy:        { prefix: 'Эмоция: ',  selectId: 'emotion', optionValue: 'joy'          },
  emotion_laugh:      { prefix: 'Эмоция: ',  selectId: 'emotion', optionValue: 'laugh'        },
  emotion_surprise:   { prefix: 'Эмоция: ',  selectId: 'emotion', optionValue: 'surprise'     },
  emotion_sadness:    { prefix: 'Эмоция: ',  selectId: 'emotion', optionValue: 'sadness'      },
  emotion_serious:    { prefix: 'Эмоция: ',  selectId: 'emotion', optionValue: 'serious'      },
  emotion_thoughtful: { prefix: 'Эмоция: ',  selectId: 'emotion', optionValue: 'thoughtful'   },
  emotion_confident:  { prefix: 'Эмоция: ',  selectId: 'emotion', optionValue: 'confident'    },
  emotion_excitement: { prefix: 'Эмоция: ',  selectId: 'emotion', optionValue: 'excitement'   },
  emotion_anger:      { prefix: 'Эмоция: ',  selectId: 'emotion', optionValue: 'anger'        },
  emotion_shy:        { prefix: 'Эмоция: ',  selectId: 'emotion', optionValue: 'shy'          },
};

// ── Sync dropdown option text after a rename ──────────────────────────────────
function syncDropdownLabel(key, newDisplayName) {
  const entry = RENAME_MAP[key];
  if (!entry) return;
  const sel = document.getElementById(entry.selectId);
  if (!sel) return;
  const opt = sel.querySelector(`option[value="${entry.optionValue}"]`);
  if (opt) opt.textContent = newDisplayName;
}

// ── Render fixed-phrase hint below editor ─────────────────────────────────────
function renderFixedHint(fixedPhrases) {
  if (!fixedPhrases.length) return null;
  const div = document.createElement('div');
  div.className = 'prompt-fixed-hint';
  div.innerHTML = '🔒 Cannot remove: ' +
    fixedPhrases.map(p => `<b>"${p}"</b>`).join('; ');
  return div;
}

// ── Modal open/close ──────────────────────────────────────────────────────────
document.getElementById('btn-open-prompts')?.addEventListener('click', () => {
  const modal = document.getElementById('prompts-modal');
  if (modal) { modal.style.display = 'flex'; if (!promptsLoaded) loadPrompts(); }
});
document.getElementById('btn-close-prompts')?.addEventListener('click', () => {
  const modal = document.getElementById('prompts-modal');
  if (modal) modal.style.display = 'none';
});
document.getElementById('prompts-modal')?.addEventListener('click', e => {
  if (e.target === e.currentTarget) e.currentTarget.style.display = 'none';
});

// ── Build one prompt block ────────────────────────────────────────────────────
function buildPromptBlock(p) {
  const block = document.createElement('div');
  block.className = 'prompt-block';
  if (p.current !== p.default) block.classList.add('modified');
  block.dataset.key = p.key;

  // ── Header ─────────────────────────────────────────────────────────────────
  const header = document.createElement('div');
  header.className = 'prompt-block-header';

  const renameEntry = RENAME_MAP[p.key];
  let label;

  if (renameEntry) {
    // Split label into immutable prefix + editable display name
    const prefixSpan = document.createElement('span');
    prefixSpan.className = 'prompt-block-label prompt-label-prefix';
    prefixSpan.textContent = renameEntry.prefix;

    // The editable display name (suffix after the prefix)
    const defaultSuffix = p.defaultLabel.startsWith(renameEntry.prefix)
      ? p.defaultLabel.slice(renameEntry.prefix.length)
      : p.defaultLabel;
    const currentSuffix = p.customLabel || defaultSuffix;

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'prompt-name-input';
    nameInput.value = currentSuffix;
    nameInput.title = 'Edit name (shown in dropdown)';

    const renameBtn = document.createElement('button');
    renameBtn.className = 'prompt-btn-rename';
    renameBtn.textContent = '✎';
    renameBtn.title = 'Save name';

    const resetNameBtn = document.createElement('button');
    resetNameBtn.className = 'prompt-btn-rename-reset';
    resetNameBtn.textContent = '↺';
    resetNameBtn.title = 'Reset name to default';
    resetNameBtn.style.display = p.customLabel ? 'inline-block' : 'none';

    renameBtn.addEventListener('click', async () => {
      const newName = nameInput.value.trim();
      if (!newName) return;
      renameBtn.disabled = true;
      try {
        const r = await fetch(`/api/prompts/${p.key}/rename`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ label: newName }),
        });
        const d = await r.json();
        if (!d.success) throw new Error(d.error);
        p.customLabel = newName;
        syncDropdownLabel(p.key, newName);
        resetNameBtn.style.display = 'inline-block';
        setStatus(`Name updated: "${renameEntry.prefix}${newName}"`);
      } catch (e) { setStatus('Error: ' + e.message); }
      finally { renameBtn.disabled = false; }
    });

    resetNameBtn.addEventListener('click', async () => {
      resetNameBtn.disabled = true;
      try {
        const r = await fetch(`/api/prompts/${p.key}/rename`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ label: '' }),
        });
        const d = await r.json();
        if (!d.success) throw new Error(d.error);
        p.customLabel = null;
        nameInput.value = defaultSuffix;
        syncDropdownLabel(p.key, defaultSuffix);
        resetNameBtn.style.display = 'none';
        setStatus(`Name reset: "${renameEntry.prefix}${defaultSuffix}"`);
      } catch (e) { setStatus('Error: ' + e.message); }
      finally { resetNameBtn.disabled = false; }
    });

    label = document.createElement('span'); // placeholder for later appendChild order
    header.appendChild(prefixSpan);
    header.appendChild(nameInput);
    header.appendChild(renameBtn);
    header.appendChild(resetNameBtn);
  } else {
    label = document.createElement('span');
    label.className = 'prompt-block-label';
    label.textContent = p.label;
    header.appendChild(label);
  }

  const badge = document.createElement('span');
  badge.className = 'prompt-modified-badge';
  badge.textContent = 'modified';

  const verSel = document.createElement('select');
  verSel.className = 'prompt-version-select';
  verSel.title = 'Version history';
  rebuildVersionSelect(verSel, p);

  const resetBtn = document.createElement('button');
  resetBtn.className = 'prompt-btn-reset';
  resetBtn.textContent = '↺ Reset';
  resetBtn.title = 'Reset prompt to default';
  if (p.isDynamic) resetBtn.style.display = 'none'; // dynamic prompts have no factory default

  const saveBtn = document.createElement('button');
  saveBtn.className = 'prompt-btn-save';
  saveBtn.textContent = '💾 Save';

  header.appendChild(badge);
  header.appendChild(verSel);
  header.appendChild(resetBtn);

  // Delete button for dynamic prompts
  if (p.isDynamic) {
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'prompt-btn-reset';
    deleteBtn.textContent = '🗑 Delete';
    deleteBtn.title = 'Delete this category prompt';
    deleteBtn.style.cssText = 'background:#ffe0e0;border-color:#c00;color:#800;';
    deleteBtn.addEventListener('click', async () => {
      if (!confirm(`Delete category prompt "${p.label}"?\nThe category itself stays in Birolys, but video analysis will use the default prompt.`)) return;
      deleteBtn.disabled = true;
      try {
        const r = await fetch(`/api/prompts/dynamic/${p.key}`, { method: 'DELETE' });
        const d = await r.json();
        if (!d.success) throw new Error(d.error);
        block.remove();
        setStatus(`Prompt "${p.label}" deleted.`);
        promptsLoaded = false; // invalidate cache
      } catch (e) { setStatus('Error: ' + e.message); deleteBtn.disabled = false; }
    });
    header.appendChild(deleteBtn);
  }

  header.appendChild(saveBtn);

  // Toggle body on header click
  header.style.cursor = 'pointer';
  header.addEventListener('click', e => {
    // Don't toggle when clicking buttons/inputs inside header
    if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    body.classList.toggle('mozgi-collapsed');
    block.querySelector('.prompt-block-arrow').textContent =
      body.classList.contains('mozgi-collapsed') ? '▶' : '▼';
  });

  // Arrow indicator
  const arrow = document.createElement('span');
  arrow.className = 'prompt-block-arrow';
  arrow.textContent = '▶';
  arrow.style.cssText = 'font-size:9px;flex-shrink:0;margin-right:4px;';
  header.insertBefore(arrow, header.firstChild);

  // ── Body ───────────────────────────────────────────────────────────────────
  const body = document.createElement('div');
  body.className = 'prompt-body mozgi-collapsed';

  const editor = document.createElement('div');
  editor.className = 'prompt-editor';
  editor.contentEditable = 'true';
  editor.spellcheck = false;
  renderEditorContent(editor, p.current, p.fixedPhrases);

  const hint = renderFixedHint(p.fixedPhrases);

  // ── AI merge zone ──────────────────────────────────────────────────────────
  const mergeZone = document.createElement('div');
  mergeZone.className = 'prompt-merge-zone';

  const mergeLabel = document.createElement('div');
  mergeLabel.className = 'prompt-merge-label';
  mergeLabel.textContent = 'AI integration additions:';

  const mergeTextarea = document.createElement('textarea');
  mergeTextarea.className = 'prompt-merge-textarea';
  mergeTextarea.placeholder = 'Describe what to add or change in the prompt…';
  mergeTextarea.rows = 3;
  mergeTextarea.spellcheck = false;

  const mergeBtn = document.createElement('button');
  mergeBtn.className = 'prompt-btn-merge';
  mergeBtn.textContent = '🤖 Merge';
  mergeBtn.title = 'Send to AI to organically merge your additions into the prompt';

  const mergeStatus = document.createElement('div');
  mergeStatus.className = 'prompt-merge-status';

  mergeBtn.addEventListener('click', async () => {
    const additions = mergeTextarea.value.trim();
    if (!additions) { mergeStatus.textContent = 'Enter additions.'; return; }
    const currentText = editor.innerText.trim();
    if (!currentText) { mergeStatus.textContent = 'Prompt is empty.'; return; }

    mergeBtn.disabled = true;
    mergeBtn.textContent = '⏳ Analyzing…';
    mergeStatus.textContent = '';

    try {
      const r = await fetch(`/api/prompts/${p.key}/merge`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentText, additions, fixedPhrases: p.fixedPhrases }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error);

      renderEditorContent(editor, d.merged, p.fixedPhrases);
      mergeTextarea.value = '';
      mergeStatus.textContent = '✓ Merged. Review and click "Save".';
      mergeStatus.style.color = '#007700';
    } catch (err) {
      mergeStatus.textContent = 'Error: ' + err.message;
      mergeStatus.style.color = '#aa0000';
    } finally {
      mergeBtn.disabled = false;
      mergeBtn.textContent = '🤖 Merge';
    }
  });

  mergeZone.appendChild(mergeLabel);
  mergeZone.appendChild(mergeTextarea);
  mergeZone.appendChild(mergeBtn);
  mergeZone.appendChild(mergeStatus);

  body.appendChild(editor);
  if (hint) body.appendChild(hint);
  body.appendChild(mergeZone);

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
        setStatus(`Error: required phrase not found: "${phrase}"`);
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
      setStatus(`Prompt "${p.label}" saved.`);
    } catch (e) { setStatus('Save error: ' + e.message); }
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
      setStatus(`Prompt "${p.label}" reset.`);
      resetBtn.textContent = '✓ Reset';
      setTimeout(() => { resetBtn.textContent = '↺ Reset'; }, 1500);
    } catch (e) {
      setStatus('Reset error: ' + e.message);
      resetBtn.textContent = '↺ Reset';
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
  cur.textContent = p.current === p.default ? '— current (default) —' : '— current (modified) —';
  sel.appendChild(cur);
  if (p.versions.length) {
    const sep = document.createElement('option');
    sep.disabled = true;
    sep.textContent = '── history ──';
    sel.appendChild(sep);
    p.versions.forEach((v, i) => {
      const opt = document.createElement('option');
      opt.value = i;
      const ts = new Date(v.ts).toLocaleString('en-GB', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
      opt.textContent = `v${p.versions.length - i} · ${ts}`;
      sel.appendChild(opt);
    });
  }
  sel.value = '__current__';
}

// ── Accordion group structure ─────────────────────────────────────────────────
// subgroups with `dropdown` field get a "Создать опцию" panel at the top
const PROMPT_GROUPS = [
  {
    label: '🧑 Character',
    subgroups: [
      // Per-parameter popups in Character/Edit tabs handle Pose / Emotion /
      // Age / Gender / Type / Edit-pose draft prompts (hidden from Brain UI).
      {
        label: 'Draft — Apply assets',
        keys: ['APPLY_LOOKBOOK_PROMPT', 'APPLY_ENV_PROMPT'],
      },
      {
        label: 'Image analysis & variations',
        keys: [
          'POSE_VARIATION_PROMPT',
          'EDIT_POSE_ANALYZE_PROMPT',
          'APPLY_POSE_ANALYZE_PROMPT',     // ▶ Pose btn — analyzes active image then applies pose
          'APPLY_EMOTION_ANALYZE_PROMPT',  // ▶ Emotion btn — same flow for emotion
          'APPLY_LOOKBOOK_MIX_PROMPT',     // TPDNE/upload + lookbook mix → dressed waist-up portrait
          'REALISM_TEMPO_PROMPT',
          'REF_ANALYZE_PROMPT',
        ],
      },
    ],
  },
  {
    label: '👗 Lookbook / Environment',
    subgroups: [
      {
        label: 'Lookbook — Generation',
        keys: ['EXTRACT_CLOTHING_PROMPT', 'LOOKBOOK_DEFAULT_GENERATE_PROMPT'],
      },
      {
        label: 'Environment — Generation',
        keys: ['EXTRACT_BG_PROMPT', 'ENVIRONMENT_DEFAULT_GENERATE_PROMPT'],
      },
    ],
  },
  {
    label: '🎬 Assets',
    subgroups: [
      {
        label: 'Asset — interaction & pre-generation',
        keys: ['ASSET_INTERACT_ANALYZE_PROMPT', 'ASSET_PRE_GENERATE_PROMPT'],
      },
      {
        label: 'Asset — default prompt (items)',
        keys: ['DETAIL_DEFAULT_GENERATE_PROMPT'],
      },
    ],
  },
  {
    label: '📋 Scenarios',
    subgroups: [
      {
        label: 'Character + item interaction analysis',
        keys: ['SCENARIO_ANALYZE_PROMPT'],
      },
    ],
  },
  // 🖼 Refs & Tempo group removed — REF_ANALYZE_PROMPT moved into 🧑 Character
  // (under "Image analysis & variations" alongside other Tempo/analysis prompts).
];

// Keys intentionally excluded from display.
// Legacy/removed: TPOSE_PROMPT, EXTRACT_BG_PROMPT_SQ.
// Per-parameter templates moved to Character/Edit tab popups (no Brain UI):
//   param_age/gender/pose/emotion_instruction, param_pose_scene_*
// Plus all hidden Черновик keys (pose_*, emotion_*, age_*, gender_*, edit_pose_*)
// — they're editable via Character/Edit tab parameter popups but should not
// appear if they fall through to "Прочее" via any code path.
const EXCLUDED_PROMPT_KEYS = new Set([
  'TPOSE_PROMPT', 'EXTRACT_BG_PROMPT_SQ',
  // param_* templates (formerly in Прочее → Неклассифицированные)
  'param_age_instruction', 'param_gender_instruction',
  'param_pose_instruction', 'param_emotion_instruction',
  'param_pose_scene_desk', 'param_pose_scene_sofa', 'param_pose_scene_window',
  'param_pose_scene_kitchen', 'param_pose_scene_standing',
  // Черновик — Поза / Эмоция / Возраст / Пол / Эдит-поза (now Character/Edit popups)
  'pose_desk', 'pose_sofa', 'pose_window', 'pose_kitchen', 'pose_standing',
  'emotion_neutral', 'emotion_smile', 'emotion_joy', 'emotion_laugh', 'emotion_surprise',
  'emotion_sadness', 'emotion_serious', 'emotion_thoughtful', 'emotion_confident',
  'emotion_excitement', 'emotion_anger', 'emotion_shy',
  'age_18_22','age_23_27','age_28_32','age_33_37','age_38_42',
  'age_43_47','age_48_52','age_53_57','age_58_62','age_63_67','age_68_72',
  'gender_female', 'gender_male',
  'edit_pose_look_left', 'edit_pose_look_right', 'edit_pose_3quarter',
  'edit_pose_head_tilt', 'edit_pose_chin_up',
]);

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

    // Inject custom option panel at the top if this subgroup maps to a dropdown
    if (sub.dropdown && typeof buildCustomOptionPanel === 'function') {
      subBody.appendChild(buildCustomOptionPanel(sub.dropdown));
    }

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

    // 🎥 Биролы — Категории removed from Brain UI.
    // Custom slots (param_pose_scene_custom_*, emotion_custom_*) are managed
    // directly in Биролы / Character / Edit tabs. Underlying isDynamic prompts
    // still load and remain functional via getPromptText(); only Brain editor hides.

    // Any prompts not assigned to a group fall into "Other", excluding hidden keys
    const grouped = new Set(PROMPT_GROUPS.flatMap(g => g.subgroups.flatMap(s => s.keys)));
    const rest = d.prompts.filter(p => !grouped.has(p.key) && !EXCLUDED_PROMPT_KEYS.has(p.key) && !p.isDynamic);
    if (rest.length) {
      const miscGroup = {
        label: '📦 Other',
        subgroups: [{ label: 'Uncategorized', keys: rest.map(p => p.key) }],
      };
      container.appendChild(buildAccordionGroup(miscGroup, byKey));
    }

    // Sync any custom labels to dropdowns in Черновик
    d.prompts.forEach(p => {
      if (p.customLabel && RENAME_MAP[p.key]) syncDropdownLabel(p.key, p.customLabel);
    });

    promptsLoaded = true;
  } catch (e) {
    container.innerHTML = `<div style="color:#a00;padding:20px;font-size:11px;">Ошибка загрузки промптов: ${e.message}</div>`;
  }
}
