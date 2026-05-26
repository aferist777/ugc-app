/* ═══════════════════════════════════════════════════════════════════
   DETAILS AI — "🤖 Generate with AI" section inside the New prop popup.

   Flow:
     1. Pick a scenario → 🔍 Analyze → list of 3-5 prop items (English
        2-3 word names) extracted by an uncensored OpenRouter model.
     2. Each row in the items list has:
          [static name (English)] [editable extras (English)]
          [▶ Generate] [🗑 Del]
        - `name` is immutable and becomes the saved filename.
        - `extras` is free-form text appended to the generation prompt
          via the server-side beautify pass.
        - 🗑 Del removes the row from the list (single-click).
     3. Each successful generation lands as a STAGED file under uploads/
        and a thumbnail appears in the grid on the RIGHT (4 per row).
     4. Double-click ✕ on a thumb discards that staged file.
     5. 💾 Save all (blue, under the thumbs grid) commits remaining
        staged files to DETAILS_DIR with the analysis names.
   ═══════════════════════════════════════════════════════════════════ */

(function () {
  const $ = id => document.getElementById(id);

  // Each entry: { stagedFile, name, extras, engine, imagePath, thumbPath }
  let _staged = [];

  function _populateScenarioDropdown() {
    const sel = $('prop-ai-scenario');
    if (!sel) return;
    const files = (typeof window.scenarioFiles !== 'undefined' && Array.isArray(window.scenarioFiles))
      ? window.scenarioFiles
      : (typeof scenarioFiles !== 'undefined' && Array.isArray(scenarioFiles) ? scenarioFiles : []);
    const prev = sel.value;
    sel.innerHTML = '<option value="">— (none — type items manually) —</option>';
    files.forEach(f => {
      const opt = document.createElement('option');
      opt.value = f.file;
      opt.textContent = f.name || f.file;
      sel.appendChild(opt);
    });
    if (prev && sel.querySelector(`option[value="${prev}"]`)) sel.value = prev;
    _refreshAnalyzeBtn();
  }

  function _refreshAnalyzeBtn() {
    const btn = $('prop-ai-analyze-btn');
    const sel = $('prop-ai-scenario');
    if (!btn || !sel) return;
    btn.disabled = !sel.value;
    btn.title = btn.disabled ? 'Pick a scenario first' : '';
  }

  function _setStatus(text, isError) {
    const el = $('prop-ai-status');
    if (!el) return;
    el.textContent = text || '';
    el.style.color = isError ? '#a33' : '#555';
  }

  async function _analyze() {
    const filename = $('prop-ai-scenario')?.value;
    if (!filename) return;

    const btn  = $('prop-ai-analyze-btn');
    const list = $('prop-ai-items');
    if (btn) btn.disabled = true;
    _setStatus('⏳ Analyzing scenario…');
    if (list) list.innerHTML = '<div style="color:#888;font-size:10px;font-style:italic;">Analyzing…</div>';

    try {
      const r = await fetch('/api/details/extract-items-from-scenario', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ filename }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error || 'analyze failed');
      _renderItems(d.items || []);
      _setStatus(`✅ Found ${d.items.length} item(s). Edit details (optional) and click ▶ Generate.`);
    } catch (e) {
      _setStatus('⚠ ' + e.message, true);
      if (list) list.innerHTML = '<div style="color:#a33;font-size:10px;">Error.</div>';
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function _renderItems(items) {
    const host = $('prop-ai-items');
    if (!host) return;
    host.innerHTML = '';
    if (!items.length) {
      host.innerHTML = '<div style="color:#888;font-size:10px;font-style:italic;">No items extracted.</div>';
      return;
    }
    items.forEach(it => host.appendChild(_buildItemRow(it)));
  }

  function _buildItemRow(item) {
    const row = document.createElement('div');
    row.style.cssText = 'border:1px solid #c0c0c0;padding:6px;background:#fff;display:flex;flex-direction:column;gap:4px;';

    // Row 1: static name + Generate + Del.
    const top = document.createElement('div');
    top.style.cssText = 'display:flex;gap:6px;align-items:center;';

    const nameSpan = document.createElement('span');
    nameSpan.textContent = item.name;
    nameSpan.style.cssText = 'flex:1;font-size:11px;font-weight:bold;color:#222;';
    nameSpan.title = 'Saved filename uses this name (read-only)';
    top.appendChild(nameSpan);

    const genBtn = document.createElement('button');
    genBtn.type = 'button';
    genBtn.textContent = '▶ Generate';
    genBtn.style.cssText = 'flex-shrink:0;font-size:10px;padding:3px 8px;cursor:pointer;background:#d4f0d4;font-weight:bold;';
    top.appendChild(genBtn);

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.textContent = '🗑 Del';
    delBtn.title = 'Remove this row';
    delBtn.style.cssText = 'flex-shrink:0;font-size:10px;padding:3px 8px;cursor:pointer;background:#f0d4d4;';
    delBtn.addEventListener('click', () => row.remove());
    top.appendChild(delBtn);

    row.appendChild(top);

    // Row 2: editable extras input (English) — prefilled with the hint
    // returned from the analyzer. Goes into the generation prompt as the
    // user-controlled details. NEVER affects the saved filename.
    const extrasInput = document.createElement('input');
    extrasInput.type = 'text';
    extrasInput.value = item.hint || '';
    extrasInput.placeholder = 'Brand, color, packaging, size… (English, optional)';
    extrasInput.style.cssText = 'width:100%;font-size:10px;padding:3px 4px;box-sizing:border-box;';
    row.appendChild(extrasInput);

    // Row 3: per-item status (small inline messages).
    const status = document.createElement('div');
    status.style.cssText = 'font-size:10px;color:#555;min-height:12px;';
    row.appendChild(status);

    async function runGenerate() {
      const engine = $('prop-ai-engine')?.value || 'nano-banana-2';
      const extras = extrasInput.value.trim();
      const name   = item.name;
      genBtn.disabled = true;
      status.style.color = '#555';
      status.textContent = `⏳ Beautify + ${engine}…`;
      try {
        const r = await fetch('/api/details/ai/generate', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ itemName: name, extras, engine }),
        });
        const d = await r.json();
        if (!d.success) throw new Error(d.error || 'generation failed');
        _staged.push({
          stagedFile: d.stagedFile,
          name:       d.name,
          extras,
          engine:     d.engine,
          imagePath:  d.imagePath,
          thumbPath:  d.thumbPath,
        });
        _renderStagedGrid();
        status.textContent = `✅ Added to grid.`;
        status.style.color = '#0a0';
      } catch (e) {
        status.textContent = '⚠ ' + e.message;
        status.style.color = '#a33';
      } finally {
        genBtn.disabled = false;
      }
    }

    genBtn.addEventListener('click', runGenerate);
    return row;
  }

  // ── Staged thumbnails grid (RIGHT column) ────────────────────────────────
  function _renderStagedGrid() {
    const grid    = $('prop-ai-staged-grid');
    const count   = $('prop-ai-staged-count');
    const save    = $('prop-ai-save-all');
    const empty   = $('prop-ai-staged-empty');
    if (!grid) return;

    grid.innerHTML = '';
    if (!_staged.length) {
      if (empty) empty.style.display = 'block';
      if (count) count.textContent = '0';
      if (save) { save.disabled = true; save.textContent = '💾 Save all'; }
      return;
    }
    if (empty) empty.style.display = 'none';
    _staged.forEach((s, idx) => grid.appendChild(_buildThumb(s, idx)));
    if (count) count.textContent = `${_staged.length}`;
    if (save) {
      save.disabled = false;
      save.textContent = `💾 Save all (${_staged.length})`;
    }
  }

  function _buildThumb(s, idx) {
    const cell = document.createElement('div');
    cell.style.cssText = 'position:relative;border:1px solid #888;background:#fff;aspect-ratio:1/1;overflow:hidden;';

    const img = document.createElement('img');
    img.src = (s.thumbPath || s.imagePath) + '?t=' + Date.now();
    img.alt = s.name;
    img.title = s.name + (s.extras ? `\n${s.extras}` : '');
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;cursor:zoom-in;';
    img.addEventListener('click', () => window.openLightbox?.(s.imagePath));
    cell.appendChild(img);

    const label = document.createElement('div');
    label.textContent = s.name;
    label.style.cssText = 'position:absolute;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);color:#fff;font-size:9px;padding:1px 4px;text-align:center;line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    cell.appendChild(label);

    const del = document.createElement('button');
    del.type = 'button';
    del.textContent = '✕';
    del.title = 'Click twice to discard';
    del.style.cssText = 'position:absolute;top:2px;right:2px;width:18px;height:18px;background:rgba(255,255,255,0.85);border:1px solid #888;font-size:11px;font-weight:bold;color:#a33;cursor:pointer;padding:0;line-height:14px;';
    // Two-click delete with visible armed state: first click → button turns
    // red as a visual "are you sure?". Second click within 2s → discards.
    // After 2s the armed state resets to neutral.
    let _armed = false;
    let _resetTimer = null;
    const _setArmed = (on) => {
      _armed = on;
      del.style.background = on ? '#a02020' : 'rgba(255,255,255,0.85)';
      del.style.color      = on ? '#fff'    : '#a33';
      del.style.borderColor = on ? '#a02020' : '#888';
      del.title = on ? 'Click again to discard' : 'Click twice to discard';
    };
    del.addEventListener('click', async () => {
      if (!_armed) {
        _setArmed(true);
        if (_resetTimer) clearTimeout(_resetTimer);
        _resetTimer = setTimeout(() => _setArmed(false), 2000);
        return;
      }
      if (_resetTimer) { clearTimeout(_resetTimer); _resetTimer = null; }
      del.disabled = true;
      try {
        await fetch('/api/details/ai/discard-staged', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ stagedFile: s.stagedFile }),
        });
      } catch {}
      _staged.splice(idx, 1);
      _renderStagedGrid();
    });
    cell.appendChild(del);

    return cell;
  }

  async function _saveAll() {
    if (!_staged.length) return;
    const save = $('prop-ai-save-all');
    if (save) { save.disabled = true; save.textContent = '⏳ Saving…'; }
    _setStatus('⏳ Committing staged props…');
    try {
      const r = await fetch('/api/details/ai/commit', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ items: _staged.map(s => ({
          stagedFile: s.stagedFile,
          name:       s.name,
          extras:     s.extras || '',
          engine:     s.engine,
        })) }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error || 'commit failed');
      _staged = [];
      _renderStagedGrid();
      _setStatus(`✅ Saved ${d.savedCount} prop(s) to details.`);
      try { window.loadDetails?.(); } catch {}
      // Also reload scenarios so the per-line item dropdowns (built from
      // cachedDetailFiles at render time) pick up the newly-added props.
      // Without this, "Fill randomly" misses new items because the scenario
      // items were rendered against a stale detailFiles snapshot.
      try { await window.loadScenarios?.(); } catch {}
      try { window.dispatchEvent(new CustomEvent('details-updated')); } catch {}
      setTimeout(() => {
        document.querySelector('#prop-new-modal-overlay [data-close]')?.click();
      }, 1200);
    } catch (e) {
      _setStatus('⚠ ' + e.message, true);
      if (save) { save.disabled = false; save.textContent = `💾 Save all (${_staged.length})`; }
    }
  }

  function _wire() {
    const section = $('prop-ai-section');

    document.getElementById('btn-detail-new')?.addEventListener('click', () => {
      setTimeout(() => {
        if (section) _populateScenarioDropdown();
      }, 100);
    });
    section?.addEventListener('toggle', () => {
      if (section.open) _populateScenarioDropdown();
    });

    $('prop-ai-scenario')?.addEventListener('change', _refreshAnalyzeBtn);
    $('prop-ai-analyze-btn')?.addEventListener('click', _analyze);
    $('prop-ai-save-all')?.addEventListener('click', _saveAll);

    _populateScenarioDropdown();
    _wireSinglePropSection();
  }

  // ── Single-prop section ──────────────────────────────────────────────────
  // Sibling collapsible block above the items-list flow. Flow per click:
  //   text → /api/details/ai/generate (beautify via Hermes → image gen via
  //   Replicate; engine = gpt-image-2 default or nano-banana-2). Result lands
  //   as a staged_prop_* file; Save commits it via /api/details/ai/commit,
  //   Retry discards the current staged file and regenerates from the same
  //   text. The image is shown inline so the user previews before saving.
  function _wireSinglePropSection() {
    const textEl   = $('prop-single-text');
    const engineEl = $('prop-single-engine');
    const genBtn   = $('prop-single-gen-btn');
    const retryBtn = $('prop-single-retry-btn');
    const saveBtn  = $('prop-single-save-btn');
    const imgWrap  = $('prop-single-img-wrap');
    const statusEl = $('prop-single-status');
    if (!textEl || !genBtn) return;

    let _current = null;  // {stagedFile, imagePath, thumbPath, name, extras, engine}

    const _setStatus = (txt, isErr) => {
      if (!statusEl) return;
      statusEl.textContent = txt || '';
      statusEl.style.color = isErr ? '#a33' : '#555';
    };
    const _refreshBtns = () => {
      const hasText = textEl.value.trim().length > 0;
      genBtn.disabled   = !hasText;
      retryBtn.disabled = !hasText || !_current;
      saveBtn.disabled  = !_current;
    };
    textEl.addEventListener('input', _refreshBtns);

    async function _discardCurrent() {
      if (!_current?.stagedFile) return;
      try {
        await fetch('/api/details/ai/discard-staged', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stagedFile: _current.stagedFile }),
        });
      } catch {}
      _current = null;
    }

    async function _runGenerate() {
      const text = textEl.value.trim();
      if (!text) return;
      const engine = engineEl?.value || 'gpt-image-2';

      // Retry / fresh Generate — wipe any previously staged file so we don't
      // leak orphaned uploads.
      await _discardCurrent();

      genBtn.disabled = true;
      retryBtn.disabled = true;
      saveBtn.disabled = true;
      _setStatus(`⏳ Hermes beautify + ${engine} (60-90s)…`);
      imgWrap.innerHTML = '<span style="font-size:10px;color:#888;">⏳ Generating…</span>';
      try {
        const r = await fetch('/api/details/ai/generate', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ itemName: text, extras: '', engine }),
        });
        const d = await r.json();
        if (!d.success) throw new Error(d.error || 'generation failed');
        _current = {
          stagedFile: d.stagedFile,
          imagePath:  d.imagePath,
          thumbPath:  d.thumbPath,
          name:       d.name,
          extras:     d.extras || '',
          engine:     d.engine,
        };
        imgWrap.innerHTML = '';
        const img = document.createElement('img');
        img.src = d.imagePath + '?t=' + Date.now();
        img.alt = d.name;
        img.title = d.name;
        img.style.cssText = 'width:100%;height:100%;object-fit:contain;cursor:zoom-in;background:#fff;';
        img.addEventListener('click', () => window.openLightbox?.(d.imagePath));
        imgWrap.appendChild(img);
        _setStatus(`✅ Generated. Click 💾 Save to keep, 🔄 Retry to regenerate.`);
      } catch (e) {
        imgWrap.innerHTML = '<span style="font-size:10px;color:#a33;">⚠ failed</span>';
        _setStatus('⚠ ' + e.message, true);
      } finally {
        _refreshBtns();
      }
    }

    async function _runSave() {
      if (!_current) return;
      saveBtn.disabled = true;
      _setStatus('⏳ Saving…');
      try {
        // Step 1: commit the staged file → DETAILS_DIR + detailsMeta entry.
        const r = await fetch('/api/details/ai/commit', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: [{
            stagedFile: _current.stagedFile,
            name:       _current.name,
            extras:     _current.extras,
            engine:     _current.engine,
          }] }),
        });
        const d = await r.json();
        if (!d.success) throw new Error(d.error || 'save failed');
        const savedName = d.items?.[0]?.filename || _current.name;

        // Step 2: register the file in refs.json so the scenarios props grid
        // sees it immediately (loadDetails reads /api/refs/list?category=detail).
        // No AI vision here — keeps Save fast; user can run analysis later if
        // they want enriched metadata.
        try {
          await fetch('/api/refs/register-from-detail', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: savedName, name: _current.name }),
          });
        } catch (regErr) {
          console.warn('[single-prop save] refs register failed:', regErr.message);
        }

        _setStatus(`✅ Saved as ${savedName}. Added to scenarios props.`);
        _current = null;
        imgWrap.innerHTML = '<span style="font-size:10px;color:#5a9c5a;">✅ Saved</span>';

        // Refresh the scenarios props grid + Edit-panel details dropdowns.
        try { window.loadDetails?.(); } catch {}
        try { window.loadScenarios?.(); } catch {}
        try { window.dispatchEvent(new CustomEvent('details-updated')); } catch {}
        try { window.dispatchEvent(new CustomEvent('details-prop-saved', { detail: { filename: savedName } })); } catch {}
      } catch (e) {
        _setStatus('⚠ ' + e.message, true);
        saveBtn.disabled = false;
      } finally {
        _refreshBtns();
      }
    }

    genBtn.addEventListener('click', _runGenerate);
    retryBtn.addEventListener('click', _runGenerate);
    saveBtn.addEventListener('click', _runSave);
    _refreshBtns();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _wire);
  else _wire();
})();
