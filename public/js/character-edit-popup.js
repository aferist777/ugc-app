/* ════════════════════════════════════════════════════════════════════════
   CHARACTER EDIT POPUP — opens from "Save obraz" button, Library grid card
   click, and Scenarios red-orphan thumb click. Two columns × 420px:
     LEFT  — main character image (large) + pose-variations stack
              (clicking a variation swaps the main image)
     RIGHT — voice generation flow:
              user-text field → Analyze (OpenRouter vision) →
              voice description (editable) → Gen voice (ElevenLabs) →
              3 preview cards (▶ + select) → Add to library →
              "Voice for this character" dropdown → Save
   Voices live server-side in data/custom-voices.json; obraz.voice stores the
   selected voice's voiceId (raw ElevenLabs id). Closing the popup auto-prunes
   orphan voices (those nobody references) via /api/audio/custom-voices/prune.
   ════════════════════════════════════════════════════════════════════════ */

(function () {
  if (window.openCharacterEditPopup) return; // already loaded

  const LLM_OPTIONS = [
    { id: 'google/gemini-3.5-flash',               label: 'Gemini 3.5 Flash (default)' },
    { id: 'google/gemini-pro-1.5',                 label: 'Gemini Pro 1.5' },
    { id: 'anthropic/claude-sonnet-4.6',           label: 'Claude Sonnet 4.6' },
    { id: 'openai/gpt-4o',                         label: 'GPT-4o' },
  ];
  const LLM_LS_KEY = 'voice_design_llm_v1';

  // Active popup state — null when closed. Single-instance modal.
  let _state = null;

  // ── Top-level entry point ───────────────────────────────────────────────────
  window.openCharacterEditPopup = function (obrazId) {
    if (_state) { _close(); }
    const obraz = (getObrazы?.() || []).find(o => String(o.id) === String(obrazId));
    if (!obraz) {
      console.warn('[character-edit-popup] obraz not found:', obrazId);
      return;
    }
    _state = {
      obraz,
      mainImagePath:    null,    // currently displayed in the large pane
      voiceDescription: '',
      previews:         [],      // [{ previewId, generatedVoiceId, audioPath, fourWordSummary, selected }]
      fourWordSummary:  '',
      varPollTimer:     null,
    };
    _state.mainImagePath = window.pickMainObrazImage?.(obraz) || obraz.char;
    _build();
    _startVariationPollIfNeeded();
  };

  // ── DOM construction ────────────────────────────────────────────────────────
  function _build() {
    const ovr = document.createElement('div');
    ovr.id = 'character-edit-popup-overlay';
    ovr.style.cssText = `
      position: fixed; inset: 0; z-index: 99990;
      background: rgba(0,0,0,0.55);
      display: flex; align-items: center; justify-content: center;
    `;
    ovr.addEventListener('click', e => { if (e.target === ovr) _close(); });

    const box = document.createElement('div');
    box.style.cssText = `
      background: #d4d0c8; color: #111;
      border: 2px solid; border-color: #fff #808080 #808080 #fff;
      box-shadow: 0 8px 40px rgba(0,0,0,0.55);
      width: 900px; max-height: 90vh; overflow-y: auto;
      padding: 8px; display: flex; flex-direction: column; gap: 8px;
      font-family: 'MS Sans Serif', Tahoma, sans-serif;
    `;

    // ── Title bar ─────────────────────────────────────────────────────────────
    const titleBar = document.createElement('div');
    titleBar.style.cssText = `
      display: flex; align-items: center; gap: 6px;
      background: #000080; color: #fff; padding: 3px 6px;
      font-size: 12px; font-weight: bold;
    `;
    titleBar.innerHTML = `<span style="flex:1;">Edit character — ${_state.obraz.name || ''}</span>`;
    const llmBtn = document.createElement('button');
    llmBtn.textContent = '⚙ LLM';
    llmBtn.title = 'Pick OpenRouter model for voice description';
    llmBtn.style.cssText = 'font-size:10px;padding:1px 6px;cursor:pointer;';
    llmBtn.addEventListener('click', () => _openLLMPicker(llmBtn));
    titleBar.appendChild(llmBtn);
    const xBtn = document.createElement('button');
    xBtn.textContent = '✕'; xBtn.title = 'Close';
    xBtn.style.cssText = 'font-size:10px;padding:1px 6px;cursor:pointer;';
    xBtn.addEventListener('click', _close);
    titleBar.appendChild(xBtn);
    box.appendChild(titleBar);

    // ── Name row ──────────────────────────────────────────────────────────────
    const nameRow = document.createElement('div');
    nameRow.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:11px;';
    nameRow.innerHTML = '<label style="flex-shrink:0;">Name:</label>';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = _state.obraz.name || '';
    nameInput.style.cssText = 'flex:1;font-size:11px;padding:2px 4px;';
    nameInput.addEventListener('input', () => { _state.nameEdited = nameInput.value; });
    nameRow.appendChild(nameInput);
    box.appendChild(nameRow);

    // ── Two columns ───────────────────────────────────────────────────────────
    const cols = document.createElement('div');
    cols.style.cssText = 'display:flex;gap:10px;align-items:flex-start;';
    cols.appendChild(_buildLeftColumn());
    cols.appendChild(_buildRightColumn());
    box.appendChild(cols);

    // ── Footer ────────────────────────────────────────────────────────────────
    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex;justify-content:flex-end;gap:6px;padding-top:6px;border-top:1px solid #888;';
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = 'padding:4px 14px;font-size:11px;cursor:pointer;';
    cancelBtn.addEventListener('click', _close);
    footer.appendChild(cancelBtn);
    const saveBtn = document.createElement('button');
    saveBtn.textContent = '💾 Save';
    saveBtn.style.cssText = 'padding:4px 14px;font-size:11px;cursor:pointer;background:#90c090;font-weight:bold;';
    saveBtn.addEventListener('click', () => _saveAndClose(nameInput.value));
    footer.appendChild(saveBtn);
    box.appendChild(footer);

    ovr.appendChild(box);
    document.body.appendChild(ovr);
    _state.overlay = ovr;
    _state.nameInput = nameInput;
  }

  // ── LEFT column: main image + variations stack ──────────────────────────────
  // Sized so left + right column total roughly the same height — keeps the
  // popup at one viewport without inner scroll once previews load on the right.
  // Main pane ~440px tall; 5 variation thumbs at 60×80 stack to ~420px.
  function _buildLeftColumn() {
    const col = document.createElement('div');
    col.style.cssText = 'width:420px;flex-shrink:0;display:flex;gap:5px;';

    // Main image (large)
    const mainWrap = document.createElement('div');
    mainWrap.style.cssText = 'flex:1;background:#000;display:flex;align-items:center;justify-content:center;height:440px;border:1px solid #808080;';
    const mainImg = document.createElement('img');
    mainImg.style.cssText = 'max-width:100%;max-height:440px;display:block;';
    mainImg.src = _state.mainImagePath ? (_state.mainImagePath + '?t=' + Date.now()) : '';
    mainImg.onerror = () => { mainImg.style.display = 'none'; };
    mainWrap.appendChild(mainImg);
    col.appendChild(mainWrap);
    _state.mainImg = mainImg;

    // Variations stack (vertical column) + regen button — narrower thumbs to
    // keep total column height in line with the right-column voice flow.
    const varColWrap = document.createElement('div');
    varColWrap.style.cssText = 'width:64px;display:flex;flex-direction:column;gap:5px;';
    const varCol = document.createElement('div');
    varCol.style.cssText = 'display:flex;flex-direction:column;gap:3px;';
    _state.varCol = varCol;
    _renderVariations();
    varColWrap.appendChild(varCol);

    // Regen-all button — wipes the 4 posevars from disk and kicks off fresh
    // generation via the same /pose-variations endpoint used at obraz save.
    // The popup's _startVariationPollIfNeeded() picks up the new pending slots
    // and live-refreshes thumbnails as each one completes.
    const regenBtn = document.createElement('button');
    regenBtn.textContent = '↺ Regen';
    regenBtn.title = 'Regenerate all pose variations';
    regenBtn.style.cssText = 'font-size:9px;padding:2px 0;cursor:pointer;width:60px;';
    regenBtn.addEventListener('click', () => _handleRegenVariations(regenBtn));
    varColWrap.appendChild(regenBtn);
    _state.regenBtn = regenBtn;

    col.appendChild(varColWrap);

    return col;
  }

  function _handleRegenVariations(btn) {
    if (typeof regenAllObrazVariations !== 'function') {
      _setStatus('Regen helper not loaded', true);
      return;
    }
    btn.disabled = true;
    const orig = btn.textContent;
    btn.textContent = '⏳';
    try {
      regenAllObrazVariations(_state.obraz);
    } catch (e) {
      _setStatus('Regen error: ' + e.message, true);
      btn.disabled = false; btn.textContent = orig;
      return;
    }
    // Refresh _state.obraz from LS so the popup sees the cleared-to-null slots
    // immediately, then restart the poll timer for live updates.
    const fresh = (getObrazы?.() || []).find(o => String(o.id) === String(_state.obraz.id));
    if (fresh) _state.obraz = fresh;
    _renderVariations();
    if (_state.varPollTimer) { clearInterval(_state.varPollTimer); _state.varPollTimer = null; }
    _startVariationPollIfNeeded();
    _setStatus('Variations queued for regeneration — will update live as they complete');
    btn.disabled = false; btn.textContent = orig;
  }

  function _renderVariations() {
    if (!_state.varCol) return;
    _state.varCol.innerHTML = '';
    const vars = Array.isArray(_state.obraz.variations) ? _state.obraz.variations : [];
    // Always show the original char as the first thumb so user can swap back.
    // varIdx=null marks it as "not a variation" so no rerun button is shown.
    _addVariationThumb(_state.obraz.char, '★ orig', null);
    vars.forEach((v, i) => {
      if (v && v !== 'error') {
        _addVariationThumb(v, `v${i + 1}`, i);
      } else if (v === 'error') {
        // Error slot — show ✕ + small ↻ to retry just this one
        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:0;';
        const ph = document.createElement('div');
        ph.style.cssText = 'width:60px;height:80px;background:#f5d5d5;border:1px dashed #c00;display:flex;align-items:center;justify-content:center;color:#c00;font-size:14px;';
        ph.textContent = '✕';
        ph.title = `Variation ${i + 1}: failed`;
        wrap.appendChild(ph);
        const cap = document.createElement('div');
        cap.style.cssText = 'font-size:8px;color:#c00;line-height:1.1;';
        cap.textContent = `v${i + 1}`;
        wrap.appendChild(cap);
        wrap.appendChild(_buildRerunBtn(i));
        _state.varCol.appendChild(wrap);
      } else {
        // null → pending (generating). No rerun button — already in flight.
        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:0;';
        const ph = document.createElement('div');
        ph.style.cssText = 'width:60px;height:80px;background:#e4e4e4;border:1px dashed #888;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#666;font-size:9px;gap:1px;';
        ph.innerHTML = '<span style="font-size:12px;">⏳</span><span>v' + (i + 1) + '</span>';
        ph.title = `Variation ${i + 1}: generating…`;
        wrap.appendChild(ph);
        _state.varCol.appendChild(wrap);
      }
    });
  }

  // Small ↻ button used under each variation thumb (and under error slots).
  // Calls _handleRerunSingleVariation with the variation index 0..3.
  function _buildRerunBtn(varIdx) {
    const btn = document.createElement('button');
    btn.textContent = '↻';
    btn.title = `Regenerate variation v${varIdx + 1}`;
    btn.style.cssText = 'font-size:9px;padding:0;cursor:pointer;width:60px;line-height:1.1;margin-top:1px;';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      _handleRerunSingleVariation(varIdx, btn);
    });
    return btn;
  }

  function _addVariationThumb(path, label, varIdx) {
    if (!path) return;
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:0;';
    const img = document.createElement('img');
    img.src = (window.toThumbPath?.(path) || path) + '?t=' + Date.now();
    img.style.cssText = 'width:60px;height:80px;object-fit:cover;border:1px solid #808080;cursor:pointer;';
    img.title = 'Click — show in main pane';
    img.onerror = () => { img.onerror = null; img.src = path + '?t=' + Date.now(); };
    img.addEventListener('click', () => {
      _state.mainImg.src = path + '?t=' + Date.now();
      _state.mainImg.style.display = '';
      _state.mainImagePath = path;
      // Highlight selected thumb
      _state.varCol.querySelectorAll('img').forEach(t => { t.style.outline = ''; });
      img.style.outline = '2px solid #000080';
    });
    const cap = document.createElement('div');
    cap.style.cssText = 'font-size:8px;color:#333;line-height:1.1;';
    cap.textContent = label;
    wrap.appendChild(img);
    wrap.appendChild(cap);
    // Per-thumb rerun button — only for actual variations (v1..v4), not orig.
    if (typeof varIdx === 'number' && varIdx >= 0) {
      wrap.appendChild(_buildRerunBtn(varIdx));
    }
    _state.varCol.appendChild(wrap);
  }

  // Rerun a single variation slot. Mirrors the legacy per-thumb rerun in
  // obrazy.js but operates against the popup's _state.obraz directly. Flow:
  //   1. Delete previous posevar from disk (no archive — fire-and-forget).
  //   2. Clear slot to null + clear slotTasks[idx] in obrazы LS+server.
  //   3. Submit a single new /pose-variations task (count=1).
  //   4. setObrazSlotTask binds the new taskId to this slot, pollPoseVariation
  //      drives the slot-fill on completion via fulfillObrazSlot.
  //   5. _startVariationPollIfNeeded restarts the popup's UI live-refresh.
  async function _handleRerunSingleVariation(idx, btn) {
    const obrazId = _state.obraz.id;
    const prevPath = (_state.obraz.variations || [])[idx];
    const isErrorOrPath = prevPath && prevPath !== 'error';
    btn.disabled = true; const origText = btn.textContent; btn.textContent = '⏳';

    // 1. Delete previous file (best-effort; failure non-blocking).
    if (isErrorOrPath) {
      fetch('/api/obrazy/delete-file', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: prevPath }),
      }).catch(() => {});
    }

    // 2. Clear slot in LS through the same helpers obrazy.js exposes.
    const list = getObrazы?.() || [];
    const entry = list.find(o => o.id === obrazId);
    if (entry) {
      if (!Array.isArray(entry.slotTasks)) entry.slotTasks = [];
      entry.variations[idx] = null;
      entry.slotTasks[idx]  = null;
      (window._persistObrazы || ((l) => localStorage.setItem('obrazy', JSON.stringify(l))))(list);
      _state.obraz = entry;
    }
    _renderVariations();   // immediate ⏳ feedback

    // 3. Submit single-count gen task.
    try {
      const engine = _state.obraz.imageEngine || (window.getImageEngine?.() || 'nano-banana-2');
      const r = await fetch('/api/characters/pose-variations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imagePath: _state.obraz.char, imageEngine: engine, count: 1 }),
      });
      const d = await r.json();
      if (!d.success || !d.taskIds?.length) throw new Error(d.error || 'No taskId returned');
      const taskId = d.taskIds[0];
      if (typeof setObrazSlotTask === 'function') setObrazSlotTask(obrazId, idx, taskId);
      if (typeof pollPoseVariation === 'function') pollPoseVariation(obrazId, taskId, idx);
      // Re-attach popup-side polling so the thumb refreshes as soon as the
      // backend marks the slot done.
      if (_state.varPollTimer) { clearInterval(_state.varPollTimer); _state.varPollTimer = null; }
      _startVariationPollIfNeeded();
      _setStatus(`Regenerating variation v${idx + 1}…`);
    } catch (e) {
      // Mark the slot as error so the user sees ✕ + a fresh ↻ to try again.
      const list2 = getObrazы?.() || [];
      const entry2 = list2.find(o => o.id === obrazId);
      if (entry2) {
        entry2.variations[idx] = 'error';
        (window._persistObrazы || ((l) => localStorage.setItem('obrazy', JSON.stringify(l))))(list2);
        _state.obraz = entry2;
      }
      _renderVariations();
      _setStatus(`Variation v${idx + 1} regen error: ${e.message}`, true);
    } finally {
      // The thumb (and its ↻) gets replaced on next _renderVariations call, so
      // restoring btn state isn't strictly needed — but keep it tidy in case
      // the slot wasn't re-rendered.
      btn.disabled = false; btn.textContent = origText;
    }
  }

  // ── RIGHT column: voice generator + library + dropdown ──────────────────────
  function _buildRightColumn() {
    const col = document.createElement('div');
    col.style.cssText = 'width:420px;flex-shrink:0;display:flex;flex-direction:column;gap:8px;font-size:11px;';

    // ── 1. Describe character (free text + Analyze) ───────────────────────────
    // User can type a short hint first OR leave it empty and click Analyze.
    // Analyze sends photo + hint to vision LLM, which writes a richer
    // CHARACTER description (look, age, profession, manner) BACK into this
    // same field. Voice description (step 2) is derived from this in a later
    // step.
    const stepA = document.createElement('div');
    stepA.innerHTML = '<div style="font-weight:bold;margin-bottom:3px;">1. Describe character (free text)</div>';
    const userTextArea = document.createElement('textarea');
    userTextArea.placeholder = 'Hint for the LLM, or leave empty — click Analyze to fill from the photo. Russian/any language ok.';
    userTextArea.style.cssText = 'width:100%;height:80px;font-size:11px;padding:4px;box-sizing:border-box;resize:vertical;';
    stepA.appendChild(userTextArea);
    const analyzeBtn = document.createElement('button');
    analyzeBtn.textContent = '🔍 Analyze character';
    analyzeBtn.title = 'LLM looks at the photo + your hint and writes a full character description back into this field';
    analyzeBtn.style.cssText = 'margin-top:4px;padding:4px 10px;font-size:11px;cursor:pointer;';
    stepA.appendChild(analyzeBtn);
    col.appendChild(stepA);
    _state.userTextArea = userTextArea;

    // ── 2. Voice description (auto-derived from step 1, editable) ─────────────
    // Empty by default. When user clicks Gen voice and this field is empty,
    // we first call /derive-voice with the character description from step 1
    // to populate this field, then call ElevenLabs previews. User can also
    // pre-fill it manually or edit the auto-derived text before clicking.
    const stepB = document.createElement('div');
    stepB.innerHTML = '<div style="font-weight:bold;margin-bottom:3px;margin-top:6px;">2. Voice description <span style="font-weight:normal;color:#777;font-size:10px;">(auto-derived from step 1 on Gen voice)</span></div>';
    const descArea = document.createElement('textarea');
    descArea.placeholder = '(empty — will be auto-filled when you click Gen voice. You can also write/edit it manually.)';
    descArea.style.cssText = 'width:100%;height:80px;font-size:11px;padding:4px;box-sizing:border-box;resize:vertical;';
    stepB.appendChild(descArea);
    const fourWordRow = document.createElement('div');
    fourWordRow.style.cssText = 'font-size:10px;color:#555;margin-top:2px;';
    fourWordRow.textContent = '4-word summary: —';
    stepB.appendChild(fourWordRow);
    const genVoiceBtn = document.createElement('button');
    genVoiceBtn.textContent = '🎤 Gen voice';
    genVoiceBtn.title = 'Derive voice description from step 1 (if empty) and generate 3 previews via ElevenLabs';
    genVoiceBtn.style.cssText = 'margin-top:4px;padding:4px 10px;font-size:11px;cursor:pointer;';
    stepB.appendChild(genVoiceBtn);
    col.appendChild(stepB);
    _state.descArea = descArea;
    _state.fourWordRow = fourWordRow;

    // ── 3. Previews ───────────────────────────────────────────────────────────
    // Each preview row has its own [+ Add] button — clicking adds just that
    // voice to the catalog. Bulk-select was dropped in favour of per-voice
    // control so the user can audition + decide one at a time.
    const stepC = document.createElement('div');
    stepC.innerHTML = '<div style="font-weight:bold;margin-bottom:3px;margin-top:6px;">3. Previews</div>';
    const previewWrap = document.createElement('div');
    previewWrap.style.cssText = 'display:flex;flex-direction:column;gap:3px;min-height:30px;';
    previewWrap.innerHTML = '<div style="font-size:10px;color:#777;">(empty — click Gen voice)</div>';
    stepC.appendChild(previewWrap);
    col.appendChild(stepC);
    _state.previewWrap = previewWrap;

    // ── 4. Voice-for-this-character dropdown ─────────────────────────────────
    const stepD = document.createElement('div');
    stepD.innerHTML = '<div style="font-weight:bold;margin-bottom:3px;margin-top:6px;">4. Voice for this character</div>';
    const voiceRow = document.createElement('div');
    voiceRow.style.cssText = 'display:flex;gap:4px;align-items:center;';
    const voiceSel = document.createElement('select');
    voiceSel.style.cssText = 'flex:1;font-size:11px;padding:2px 4px;';
    window.buildVoiceSelect(voiceSel, _state.obraz.voice || '');
    window.registerVoiceSelect?.(voiceSel, () => voiceSel.value || _state.obraz.voice || '');
    voiceRow.appendChild(voiceSel);
    const playBtn = document.createElement('button');
    playBtn.textContent = '▷';
    playBtn.title = 'Preview selected voice';
    playBtn.style.cssText = 'width:24px;height:22px;cursor:pointer;font-size:11px;';
    voiceRow.appendChild(playBtn);
    stepD.appendChild(voiceRow);
    const voiceHint = document.createElement('div');
    voiceHint.style.cssText = 'font-size:10px;color:#777;margin-top:2px;';
    voiceHint.textContent = 'Saved voices appear here after step 3.';
    stepD.appendChild(voiceHint);
    col.appendChild(stepD);
    _state.voiceSel = voiceSel;
    _state.voicePlayBtn = playBtn;

    // ── Status line ──────────────────────────────────────────────────────────
    const status = document.createElement('div');
    status.style.cssText = 'font-size:10px;color:#555;margin-top:4px;min-height:14px;';
    col.appendChild(status);
    _state.statusEl = status;

    // ── Wire handlers ────────────────────────────────────────────────────────
    analyzeBtn.addEventListener('click', () => _handleAnalyze(analyzeBtn));
    genVoiceBtn.addEventListener('click', () => _handleGenVoice(genVoiceBtn));
    playBtn.addEventListener('click', () => _handlePreviewSaved(playBtn));

    return col;
  }

  // ── Status helper ───────────────────────────────────────────────────────────
  function _setStatus(text, isError) {
    if (!_state?.statusEl) return;
    _state.statusEl.textContent = text || '';
    _state.statusEl.style.color = isError ? '#a33' : '#555';
  }

  // ── LLM picker ──────────────────────────────────────────────────────────────
  function _currentLLM() {
    return localStorage.getItem(LLM_LS_KEY) || LLM_OPTIONS[0].id;
  }
  function _openLLMPicker(anchor) {
    const existing = document.getElementById('cep-llm-menu');
    if (existing) { existing.remove(); return; }
    const menu = document.createElement('div');
    menu.id = 'cep-llm-menu';
    const rect = anchor.getBoundingClientRect();
    menu.style.cssText = `
      position: fixed; top: ${rect.bottom + 2}px; left: ${rect.left}px;
      background: #fff; border: 1px solid #888; box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      z-index: 100000; min-width: 220px; font-size: 11px;
    `;
    const cur = _currentLLM();
    LLM_OPTIONS.forEach(opt => {
      const item = document.createElement('div');
      item.style.cssText = `padding:4px 8px;cursor:pointer;${opt.id === cur ? 'background:#e0e8ff;font-weight:bold;' : ''}`;
      item.textContent = opt.label;
      item.addEventListener('mouseover', () => { item.style.background = '#cce0ff'; });
      item.addEventListener('mouseout',  () => { item.style.background = opt.id === cur ? '#e0e8ff' : ''; });
      item.addEventListener('click', () => {
        localStorage.setItem(LLM_LS_KEY, opt.id);
        menu.remove();
        _setStatus(`LLM: ${opt.label}`);
      });
      menu.appendChild(item);
    });
    document.body.appendChild(menu);
    // Close on outside click
    setTimeout(() => {
      document.addEventListener('click', function onClick(e) {
        if (!menu.contains(e.target) && e.target !== anchor) {
          menu.remove();
          document.removeEventListener('click', onClick);
        }
      });
    }, 0);
  }

  // ── Handlers ────────────────────────────────────────────────────────────────
  // Step 1: vision LLM looks at photo + any hint the user typed → writes a
  // CHARACTER description (look/age/profession/manner) into the SAME field.
  // Voice description (step 2) is derived later, on Gen voice click.
  async function _handleAnalyze(btn) {
    const userText = _state.userTextArea.value.trim();
    if (!_state.mainImagePath) { _setStatus('No image to analyze', true); return; }
    btn.disabled = true; btn.textContent = '⏳ Analyzing…';
    _setStatus('LLM analysing photo + your hint…');
    try {
      const r = await fetch('/api/audio/voice-design/analyze-character', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imagePath: _state.mainImagePath,
          userText,
          llmModel:  _currentLLM(),
        }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error || 'Analyze failed');
      // Character description REPLACES whatever the user typed — that text
      // was just a hint and the LLM has now incorporated it.
      _state.userTextArea.value = d.characterDescription || '';
      _setStatus('Character description ready — edit if needed, then click Gen voice');
    } catch (e) {
      _setStatus('Analyze error: ' + e.message, true);
    } finally {
      btn.disabled = false; btn.textContent = '🔍 Analyze character';
    }
  }

  // Gen voice: if step 2 (voice description) is empty/short, first derive it
  // from step 1 (character description) via /derive-voice, then call ElevenLabs
  // for previews. If user pre-filled step 2 we skip the derive step.
  async function _handleGenVoice(btn) {
    btn.disabled = true; btn.textContent = '⏳ Generating…';
    try {
      // Auto-derive step 2 from step 1 if missing/short
      let desc = _state.descArea.value.trim();
      if (desc.length < 20) {
        const charDesc = _state.userTextArea.value.trim();
        if (charDesc.length < 20) {
          _setStatus('Step 1 (character description) is empty — click Analyze first', true);
          btn.disabled = false; btn.textContent = '🎤 Gen voice';
          return;
        }
        _setStatus('Deriving voice description from step 1…');
        const dr = await fetch('/api/audio/voice-design/derive-voice', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            characterDescription: charDesc,
            llmModel: _currentLLM(),
          }),
        });
        const dd = await dr.json();
        if (!dd.success) throw new Error(dd.error || 'Derive voice failed');
        _state.descArea.value = dd.voiceDescription || '';
        _state.fourWordSummary = dd.fourWordSummary || '';
        _state.fourWordRow.textContent = '4-word summary: ' + (dd.fourWordSummary || '—');
        desc = _state.descArea.value.trim();
      }
      _setStatus('Calling ElevenLabs (up to ~30 s)…');
      const r = await fetch('/api/audio/voice-design/previews', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voiceDescription: desc }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error || 'ElevenLabs failed');
      // savedVoiceId is set per-row after a successful Add — used to render
      // the row's button as "✓ Added" / disabled so the user can't add twice.
      _state.previews = (d.previews || []).map(p => ({ ...p, savedVoiceId: null }));
      _renderPreviews();
      _setStatus(`Got ${_state.previews.length} previews — click [+ Add] next to the ones you want`);
    } catch (e) {
      _setStatus('Gen voice error: ' + e.message, true);
    } finally {
      btn.disabled = false; btn.textContent = '🎤 Gen voice';
    }
  }

  function _renderPreviews() {
    _state.previewWrap.innerHTML = '';
    if (!_state.previews.length) {
      _state.previewWrap.innerHTML = '<div style="font-size:10px;color:#777;">(empty — click Gen voice)</div>';
      return;
    }
    let _audio = null;
    let _activeBtn = null;
    _state.previews.forEach((p, idx) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:5px;padding:3px;background:#e8e8e8;border:1px solid #aaa;';

      const play = document.createElement('button');
      play.textContent = '▷';
      play.style.cssText = 'width:24px;height:22px;cursor:pointer;font-size:11px;flex-shrink:0;';
      play.addEventListener('click', () => {
        if (_audio) { _audio.pause(); _audio = null; if (_activeBtn) _activeBtn.textContent = '▷'; }
        if (_activeBtn === play) { _activeBtn = null; return; } // toggle off
        _audio = new Audio(p.audioPath);
        play.textContent = '■';
        _activeBtn = play;
        _audio.play().catch(() => {});
        _audio.addEventListener('ended', () => { play.textContent = '▷'; _activeBtn = null; });
      });
      row.appendChild(play);

      const label = document.createElement('span');
      label.style.cssText = 'flex:1;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      label.textContent = `Preview ${idx + 1}${_state.fourWordSummary ? ' — ' + _state.fourWordSummary : ''}`;
      row.appendChild(label);

      // Per-row Add — adds just this one preview to the catalog
      const addBtn = document.createElement('button');
      addBtn.textContent = p.savedVoiceId ? '✓ Added' : '+ Add';
      addBtn.title = p.savedVoiceId ? 'Already in library' : 'Add this voice to the library';
      addBtn.disabled = !!p.savedVoiceId;
      addBtn.style.cssText = 'flex-shrink:0;padding:2px 8px;font-size:10px;cursor:pointer;' +
        (p.savedVoiceId ? 'background:#cfd; color:#363; cursor:default;' : '');
      addBtn.addEventListener('click', () => _handleAddOne(p, addBtn));
      row.appendChild(addBtn);

      _state.previewWrap.appendChild(row);
    });
  }

  // Add a single preview to the server-side catalog. Updates the row's
  // button to "✓ Added" on success and auto-selects the new voice in the
  // "Voice for this character" dropdown so the user can immediately Save.
  async function _handleAddOne(preview, btn) {
    if (preview.savedVoiceId) return;
    btn.disabled = true;
    const origText = btn.textContent;
    btn.textContent = '⏳';
    _setStatus('Adding voice to library…');

    // Voice name = 4-word summary from derive-voice (always ends with the
    // gender word, e.g. "warm gravelly midwestern male"). Character name is
    // intentionally NOT included — voices are reusable across characters and
    // their display label should describe the voice itself, not the persona
    // that triggered their creation.
    const fwSummary = (_state.fourWordSummary || '').trim();
    // Best-effort gender extraction from the summary's last word for the
    // catalog's `gender` field. Fallback to obraz.gender if the summary is
    // malformed (the catalog needs SOME gender flag for the ♀/♂ optgroups).
    const lastWord = fwSummary.split(/\s+/).pop()?.toLowerCase() || '';
    const inferredGender = lastWord === 'male' ? 'm' : lastWord === 'female' ? 'f' : null;
    const gender = inferredGender || (_state.obraz.gender === 'male' ? 'm' : 'f');
    // Fallback when summary is empty: first 6 significant words of the voice
    // description, or a generic "voice" tag — keeps the label non-empty.
    const fallbackTag = (_state.descArea.value || '')
      .split(/\s+/).filter(Boolean).slice(0, 6).join(' ').trim();
    let baseName = fwSummary || fallbackTag || 'voice';
    // Disambiguate when several previews from the same description are added —
    // append #N to keep dropdown labels distinct.
    const variantTag = _state.previews.filter(p => p.savedVoiceId).length + 1;
    const name = baseName + (_state.previews.length > 1 ? ` #${variantTag}` : '');

    try {
      const r = await fetch('/api/audio/voice-design/save', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selections: [{
            generatedVoiceId: preview.generatedVoiceId,
            name, gender,
            desc: _state.fourWordSummary || '',
            characterId: _state.obraz.id,
          }],
          voiceDescription: _state.descArea.value.trim(),
        }),
      });
      const d = await r.json();
      if (!d.success || !d.added?.length) throw new Error(d.error || 'Save failed');
      preview.savedVoiceId = d.added[0].voiceId;
      // Reload catalog so all voice dropdowns app-wide repopulate
      await window.loadCustomVoices?.();
      // Auto-select just-added voice in this popup's dropdown
      _state.voiceSel.value = preview.savedVoiceId;
      btn.textContent = '✓ Added';
      btn.style.background = '#cfd';
      btn.style.color = '#363';
      btn.style.cursor = 'default';
      _setStatus(`Added "${name}" to library`);
    } catch (e) {
      btn.disabled = false; btn.textContent = origText;
      _setStatus('Add error: ' + e.message, true);
    }
  }

  let _savedVoiceAudio = null;
  async function _handlePreviewSaved(btn) {
    const val = _state.voiceSel.value;
    if (!val) { _setStatus('No voice selected', true); return; }
    if (_savedVoiceAudio) {
      _savedVoiceAudio.pause(); _savedVoiceAudio = null;
      btn.textContent = '▷'; return;
    }
    btn.disabled = true; btn.textContent = '⏳';
    try {
      const r = await fetch('/api/audio/tts-preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voice: val }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error);
      _savedVoiceAudio = new Audio(d.audioPath);
      btn.textContent = '■';
      _savedVoiceAudio.play().catch(() => {});
      _savedVoiceAudio.addEventListener('ended', () => {
        _savedVoiceAudio = null; btn.textContent = '▷';
      });
    } catch (e) {
      _setStatus('Preview error: ' + e.message, true);
      btn.textContent = '▷';
    } finally {
      btn.disabled = false;
    }
  }

  // ── Variation polling — if obraz has null slots, watch obrazы list for updates ─
  function _startVariationPollIfNeeded() {
    const hasPending = (_state.obraz.variations || []).some(v => v === null);
    if (!hasPending) return;
    _state.varPollTimer = setInterval(() => {
      const fresh = (getObrazы?.() || []).find(o => String(o.id) === String(_state.obraz.id));
      if (!fresh) return;
      const before = JSON.stringify(_state.obraz.variations || []);
      const after  = JSON.stringify(fresh.variations || []);
      if (before !== after) {
        _state.obraz = fresh;
        _renderVariations();
      }
      const stillPending = (fresh.variations || []).some(v => v === null);
      if (!stillPending) { clearInterval(_state.varPollTimer); _state.varPollTimer = null; }
    }, 2000);
  }

  // ── Save & close ────────────────────────────────────────────────────────────
  // Critical ordering: prune MUST run after obrazы.json on disk has the new
  // voice ref. _persistObrazы's server sync is debounced 1s, so a naïve
  // prune-right-after-save races and kills the just-bound voice. We sync the
  // list synchronously here, then prune, then close.
  async function _saveAndClose(newName) {
    const list = getObrazы?.() || [];
    const entry = list.find(o => String(o.id) === String(_state.obraz.id));
    if (entry) {
      const selectedVoice = _state.voiceSel?.value || '';
      if (selectedVoice) entry.voice = selectedVoice;
      const trimmed = (newName || '').trim();
      if (trimmed && trimmed !== entry.name) entry.name = trimmed;
      // Local write — immediate so UI reflects the change while we hit the
      // server. Also primes the debounced sync helper so subsequent edits
      // outside the popup behave normally.
      try { localStorage.setItem('obrazy', JSON.stringify(list)); } catch {}
    }
    // Force-sync to server BEFORE pruning so the prune endpoint reads the
    // new voice ref instead of the stale on-disk obrazы. Await ensures order.
    try {
      await fetch('/api/userdata/obrazy', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ list }),
      });
    } catch (e) {
      console.warn('[character-edit-popup] obrazы sync failed:', e.message);
    }
    // Now safe to prune — orphans removed only if no obraz references them
    try {
      const pr = await fetch('/api/audio/custom-voices/prune', { method: 'POST' });
      const pd = await pr.json();
      if (pd?.removed) console.log(`[voice-prune] removed ${pd.removed} orphan voice(s)`);
    } catch {}
    // Refresh dependent views
    window.loadObrazы?.();
    window.loadScenarioObrazы?.();
    window.loadCharCol3Obrazy?.();
    _close();
  }

  function _close() {
    if (!_state) return;
    if (_state.varPollTimer) { clearInterval(_state.varPollTimer); }
    document.getElementById('cep-llm-menu')?.remove();
    _state.overlay?.remove();
    _state = null;
  }
})();
