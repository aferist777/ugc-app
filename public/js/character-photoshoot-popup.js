/* ════════════════════════════════════════════════════════════════════════
   PHOTOSHOOT POPUP — opens after "Save obraz" (wired in Phase 3).
     RIGHT (1/4, full height): the obraz photo the user stopped on.
     LEFT  (3/4): two LOCKED fields (appearance + environment, yellow — "do not
                  change") + 4 pose rows. Each row:
                    mini-preview · editable pose prompt · ai-insert field+button ·
                    🔄 Remake (regenerate just this pose).
     FOOTER: Gen all · Save · Close.
   On open: /api/characters/pose-analyze fills the fields (spinner shown). Each
   pose generates via /api/characters/pose-generate (env-locked + realism-compiled
   server-side) and polls /api/characters/pose-status?obrazId=, storing the result
   into obraz.variations[idx] via fulfillObrazSlot. The environment / camera /
   clothing never change — only the pose.
   ════════════════════════════════════════════════════════════════════════ */
(function () {
  if (window.openPhotoshootPopup) return;

  const POLL_MS = 3000, POLL_MAX = 100;   // 5-min timeout per pose
  let _state = null;

  function _ensureCss() {
    if (document.getElementById('photoshoot-popup-css')) return;
    const st = document.createElement('style');
    st.id = 'photoshoot-popup-css';
    st.textContent = '@keyframes psh-spin{to{transform:rotate(360deg)}}';
    document.head.appendChild(st);
  }

  window.openPhotoshootPopup = function (obrazId, opts) {
    if (_state) _close();
    const obraz = (typeof getObrazы === 'function' ? getObrazы() : []).find(o => String(o.id) === String(obrazId));
    if (!obraz) { console.warn('[photoshoot] obraz not found:', obrazId); return; }
    _ensureCss();
    _state = {
      obraz,
      photoPath: (window.pickMainObrazImage ? window.pickMainObrazImage(obraz) : obraz.char),
      charId: (opts && opts.charId != null) ? opts.charId : null,   // flow A = linked char; null = flow B (new face)
      isNew: !(opts && opts.isNew === false),                       // opened from Save obraz → discard on close-without-save
      saved: false,
      rows: [],            // [{ poseTa, noteInput, preview, aiBtn, examples }]
      polls: new Set(),    // active interval ids
      appearanceTa: null,
      environmentTa: null,
      onSaved: (opts && typeof opts.onSaved === 'function') ? opts.onSaved : null,
    };
    _build();
    _runAnalysis();
  };

  function _close() {
    if (!_state) return;
    // Discard a NEW, unsaved photoshoot obraz so nothing is left hanging in the
    // character dropdown / gallery. Confirm first if poses were already generated.
    if (_state.isNew && !_state.saved) {
      const fresh = (typeof getObrazы === 'function' ? getObrazы() : []).find(o => String(o.id) === String(_state.obraz.id));
      const hasVar = ((fresh && fresh.variations) || []).some(v => v && v !== 'error');
      if (hasVar && !confirm('Discard the unsaved photoshoot? The generated poses will be lost.')) return;
      _discardObraz();
    }
    _state.polls.forEach(id => clearInterval(id));
    if (_state.escHandler) document.removeEventListener('keydown', _state.escHandler);
    _state.overlay?.remove();
    _state = null;
  }

  // Remove the new obraz (localStorage + server folder) when cancelled.
  function _discardObraz() {
    const ob = _state.obraz;
    try { window._persistObrazы(getObrazы().filter(o => String(o.id) !== String(ob.id))); } catch {}
    try { fetch('/api/obrazy/' + encodeURIComponent(ob.id) + '?name=' + encodeURIComponent(ob.name || ''), { method: 'DELETE' }); } catch {}
    try { window.loadObrazы?.(); window.loadScenarioObrazы?.(); window.loadCharCol3Obrazy?.(); } catch {}
  }

  // ── DOM ──────────────────────────────────────────────────────────────────
  function _build() {
    const ovr = document.createElement('div');
    ovr.id = 'photoshoot-popup-overlay';
    ovr.style.cssText = 'position:fixed;inset:0;z-index:99992;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;';
    ovr.addEventListener('click', e => { if (e.target === ovr) _close(); });

    const box = document.createElement('div');
    box.style.cssText = 'background:#d4d0c8;color:#111;border:2px solid;border-color:#fff #808080 #808080 #fff;box-shadow:0 8px 40px rgba(0,0,0,.55);width:min(1080px,96vw);max-height:92vh;display:flex;flex-direction:column;font-family:"MS Sans Serif",Tahoma,sans-serif;';

    // title bar
    const tb = document.createElement('div');
    tb.style.cssText = 'display:flex;align-items:center;gap:6px;background:#000080;color:#fff;padding:3px 6px;font-size:12px;font-weight:bold;';
    tb.innerHTML = `<span style="flex:1;">📸 Photoshoot — ${_esc(_state.obraz.name || '')}</span>`;
    const x = document.createElement('button'); x.textContent = '✕'; x.style.cssText = 'font-size:10px;padding:1px 6px;cursor:pointer;'; x.addEventListener('click', _close);
    tb.appendChild(x);
    box.appendChild(tb);

    // body: left (rows) | right (photo)
    const body = document.createElement('div');
    body.style.cssText = 'display:flex;gap:10px;align-items:stretch;padding:8px;overflow:hidden;flex:1;min-height:0;';

    // LEFT (3/4)
    const left = document.createElement('div');
    left.style.cssText = 'flex:3;display:flex;flex-direction:column;gap:7px;overflow-y:auto;min-width:0;';

    // status / spinner line
    const status = document.createElement('div');
    status.style.cssText = 'font-size:11px;color:#225;display:flex;align-items:center;gap:7px;min-height:16px;';
    left.appendChild(status);
    _state.statusEl = status;

    // locked appearance + environment
    const lockWrap = document.createElement('div');
    lockWrap.style.cssText = 'display:flex;flex-direction:column;gap:5px;border:1px solid #c9a227;background:#fffbe6;padding:6px 7px;border-radius:3px;';
    const lockHint = document.createElement('div');
    lockHint.style.cssText = 'font-size:10px;color:#7a5d00;font-weight:bold;';
    lockHint.textContent = '🔒 Appearance / clothing and environment are locked (best left unchanged). Only the pose changes.';
    lockWrap.appendChild(lockHint);
    _state.appearanceTa = _lockedField(lockWrap, 'Appearance + clothing');
    _state.environmentTa = _lockedField(lockWrap, 'Environment');
    left.appendChild(lockWrap);

    // 4 pose rows
    const rowsWrap = document.createElement('div');
    rowsWrap.style.cssText = 'display:flex;flex-direction:column;gap:6px;';
    for (let i = 0; i < 4; i++) rowsWrap.appendChild(_buildRow(i));
    left.appendChild(rowsWrap);

    body.appendChild(left);

    // RIGHT (1/4): the obraz photo, full height
    const right = document.createElement('div');
    right.style.cssText = 'flex:1;min-width:170px;max-width:260px;display:flex;flex-direction:column;';
    const photoCap = document.createElement('div');
    photoCap.style.cssText = 'font-size:10px;color:#555;margin-bottom:3px;text-align:center;';
    photoCap.textContent = 'Original obraz photo';
    const photo = document.createElement('img');
    photo.src = _bust(_state.photoPath);
    photo.style.cssText = 'width:100%;flex:1;min-height:0;object-fit:contain;border:1px solid #888;background:#222;border-radius:3px;';
    photo.onerror = () => { photo.style.opacity = '0.3'; };
    right.appendChild(photoCap);
    right.appendChild(photo);
    body.appendChild(right);

    box.appendChild(body);

    // footer
    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex;justify-content:flex-end;gap:6px;padding:6px 8px;border-top:1px solid #888;';
    const genAll = document.createElement('button');
    genAll.textContent = '⚡ Gen all';
    genAll.title = 'Generate all 4 poses';
    genAll.style.cssText = 'padding:4px 14px;font-size:11px;cursor:pointer;font-weight:bold;';
    genAll.addEventListener('click', () => _genAll());
    genAll.disabled = true;   // re-enabled after the pre-analysis completes
    _state.genAllBtn = genAll;
    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close'; closeBtn.style.cssText = 'padding:4px 14px;font-size:11px;cursor:pointer;'; closeBtn.addEventListener('click', _close);
    const saveBtn = document.createElement('button');
    saveBtn.textContent = '💾 Save'; saveBtn.style.cssText = 'padding:4px 16px;font-size:11px;cursor:pointer;background:#90c090;font-weight:bold;'; saveBtn.addEventListener('click', () => _save());
    _state.saveBtn = saveBtn;
    footer.appendChild(genAll);
    footer.appendChild(closeBtn);
    footer.appendChild(saveBtn);
    box.appendChild(footer);

    ovr.appendChild(box);
    document.body.appendChild(ovr);
    _state.overlay = ovr;
    _state.escHandler = (e) => { if (e.key === 'Escape') _close(); };
    document.addEventListener('keydown', _state.escHandler);

    // preload any already-generated variations
    (_state.obraz.variations || []).forEach((v, i) => { if (v && v !== 'error' && _state.rows[i]) _setPreviewImage(i, v); });
  }

  function _lockedField(parent, label) {
    const l = document.createElement('div'); l.style.cssText = 'font-size:9px;color:#7a5d00;'; l.textContent = label;
    const ta = document.createElement('textarea'); ta.rows = 2;
    ta.style.cssText = 'width:100%;box-sizing:border-box;font-size:10px;padding:3px 5px;resize:vertical;font-family:inherit;line-height:1.3;background:#fff7cc;border:1px solid #c9a227;color:#332;font-weight:600;';
    parent.appendChild(l); parent.appendChild(ta);
    return ta;
  }

  function _buildRow(idx) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:7px;align-items:stretch;border:1px solid #b8b3a4;background:#cfccc4;padding:5px;border-radius:3px;';

    // preview (left of the row)
    const preview = document.createElement('div');
    preview.style.cssText = 'flex:0 0 86px;width:86px;height:116px;border:1px solid #888;background:#1a1a1a;border-radius:3px;display:flex;align-items:center;justify-content:center;overflow:hidden;position:relative;cursor:default;';
    preview.innerHTML = '<span style="color:#666;font-size:9px;">pose ' + (idx + 1) + '</span>';

    // middle: pose textarea
    const mid = document.createElement('div');
    mid.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:4px;min-width:0;';
    const poseTa = document.createElement('textarea'); poseTa.rows = 3;
    poseTa.placeholder = 'Pose ' + (idx + 1) + '…';
    poseTa.style.cssText = 'width:100%;box-sizing:border-box;font-size:10px;padding:3px 5px;resize:vertical;font-family:inherit;line-height:1.3;';
    const aiRow = document.createElement('div'); aiRow.style.cssText = 'display:flex;gap:4px;';
    const noteInput = document.createElement('input'); noteInput.type = 'text';
    noteInput.placeholder = 'add to the pose…';
    noteInput.style.cssText = 'flex:1;font-size:10px;padding:2px 5px;box-sizing:border-box;';
    const aiBtn = document.createElement('button'); aiBtn.textContent = '⚡ ai-insert'; aiBtn.title = 'Weave the note into this pose via LLM';
    aiBtn.style.cssText = 'font-size:9px;padding:1px 7px;cursor:pointer;white-space:nowrap;';
    aiBtn.addEventListener('click', () => _aiInsert(idx));
    aiRow.appendChild(noteInput); aiRow.appendChild(aiBtn);
    mid.appendChild(poseTa); mid.appendChild(aiRow);

    // right of the row: remake
    const ctrl = document.createElement('div');
    ctrl.style.cssText = 'flex:0 0 auto;display:flex;flex-direction:column;justify-content:center;gap:4px;';
    const remake = document.createElement('button'); remake.textContent = '🔄'; remake.title = 'Regenerate this pose (Remake)';
    remake.style.cssText = 'font-size:13px;padding:4px 8px;cursor:pointer;';
    remake.addEventListener('click', () => _generateOne(idx));
    ctrl.appendChild(remake);

    row.appendChild(preview); row.appendChild(mid); row.appendChild(ctrl);

    remake.disabled = true; aiBtn.disabled = true;   // re-enabled after the pre-analysis
    _state.rows[idx] = { poseTa, noteInput, preview, remake, aiBtn, examples: [] };
    return row;
  }

  // Generation controls stay disabled until the pre-analysis fills the prompts.
  function _setControlsEnabled(on) {
    if (!_state) return;
    if (_state.genAllBtn) _state.genAllBtn.disabled = !on;
    _state.rows.forEach(r => { if (r) { r.remake.disabled = !on; r.aiBtn.disabled = !on; } });
  }

  // ── Analysis ──────────────────────────────────────────────────────────────
  async function _runAnalysis() {
    const st = _state;   // guard: ignore the result if the popup was closed/reopened meanwhile
    _setStatus('🔍 Analyzing the obraz and environment…', true);
    try {
      const d = await (await fetch('/api/characters/pose-analyze', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imagePath: st.photoPath }),
      })).json();
      if (_state !== st) return;
      if (!d.success) throw new Error(d.error || 'analyze failed');
      _state.appearanceTa.value  = d.appearance || '';
      _state.environmentTa.value = d.environment || '';
      (d.poses || []).slice(0, 4).forEach((p, i) => {
        const r = _state.rows[i]; if (!r) return;
        r.poseTa.value = p.pose || '';
        r.examples = p.examples || [];
        if (r.examples.length) r.noteInput.placeholder = 'e.g.: ' + r.examples.join(' · ');
      });
      _setStatus('✓ Analysis ready. Edit if you like, then click "Gen all" (or 🔄 on an individual pose).', false);
      _setControlsEnabled(true);
    } catch (e) {
      if (_state !== st) return;
      _setStatus('⚠ Analysis error: ' + e.message + ' — you can enter the poses manually.', false);
      _setControlsEnabled(true);
    }
  }

  // ── Generation ──────────────────────────────────────────────────────────────
  function _composePrompt(idx) {
    const a = (_state.appearanceTa.value || '').trim();
    const env = (_state.environmentTa.value || '').trim();
    const pose = (_state.rows[idx].poseTa.value || '').trim();
    return [a, env, pose].filter(Boolean).join('. ');
  }

  async function _generateOne(idx) {
    const r = _state.rows[idx]; if (!r) return;
    const prompt = _composePrompt(idx);
    if (!prompt) { _setStatus('⚠ Pose ' + (idx + 1) + ' is empty', false); return; }
    _setPreviewSpinner(idx);
    r.remake.disabled = true;
    try {
      const d = await (await fetch('/api/characters/pose-generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imagePath: _state.photoPath, prompt }),
      })).json();
      if (!d.success || !d.taskId) throw new Error(d.error || 'no taskId');
      try { setObrazSlotTask(_state.obraz.id, idx, d.taskId); } catch {}
      _pollOne(idx, d.taskId);
    } catch (e) {
      r.remake.disabled = false;
      _setPreviewError(idx, e.message);
    }
  }

  function _genAll() {
    for (let i = 0; i < 4; i++) {
      if ((_state.rows[i].poseTa.value || '').trim()) _generateOne(i);
    }
  }

  function _pollOne(idx, taskId) {
    let n = 0;
    const iv = setInterval(async () => {
      if (!_state) { clearInterval(iv); return; }
      if (++n > POLL_MAX) { clearInterval(iv); _state.polls.delete(iv); _setPreviewError(idx, 'timeout'); _state.rows[idx].remake.disabled = false; return; }
      try {
        const d = await (await fetch('/api/characters/pose-status/' + encodeURIComponent(taskId) + '?obrazId=' + encodeURIComponent(_state.obraz.id))).json();
        if (d.state === 'success' && d.imagePath) {
          clearInterval(iv); _state.polls.delete(iv);
          try { fulfillObrazSlot(_state.obraz.id, taskId, idx, d.imagePath); } catch {}
          _setPreviewImage(idx, d.imagePath);
          _state.rows[idx].remake.disabled = false;
        } else if (d.state === 'failed') {
          clearInterval(iv); _state.polls.delete(iv);
          _setPreviewError(idx, d.error || 'failed');
          _state.rows[idx].remake.disabled = false;
        }
      } catch { /* keep polling */ }
    }, POLL_MS);
    _state.polls.add(iv);
  }

  async function _aiInsert(idx) {
    const r = _state.rows[idx]; if (!r) return;
    const note = (r.noteInput.value || '').trim();
    const pose = (r.poseTa.value || '').trim();
    if (!note) { r.noteInput.focus(); return; }
    if (!pose) { return; }
    const old = r.poseTa.value;
    r.poseTa.value = '⏳ weaving…';
    try {
      const d = await (await fetch('/api/characters/pose-ai-insert', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pose, note }),
      })).json();
      if (d.success && d.pose) { r.poseTa.value = d.pose; r.noteInput.value = ''; }
      else { r.poseTa.value = old; _setStatus('⚠ ai-insert: ' + (d.error || 'error'), false); }
    } catch (e) { r.poseTa.value = old; _setStatus('⚠ ai-insert: ' + e.message, false); }
  }

  // Save the photoshoot. Flow A (linked char): lands in the character's dossier.
  // Flow B (new face): creates the character now, links the obraz, opens the voice
  // profile. Pose images are already persisted to obraz.variations via fulfillObrazSlot.
  async function _save() {
    if (!_state) return;
    const obrazId = _state.obraz.id;
    // Require at least one generated pose — can't save an empty photoshoot.
    const fresh = (typeof getObrazы === 'function' ? getObrazы() : []).find(o => String(o.id) === String(obrazId));
    const vars = ((fresh && fresh.variations) || []).filter(v => v && v !== 'error');
    if (!vars.length) { _setStatus('⚠ Generate at least one pose first (Gen all / 🔄).', false); return; }

    if (_state.saveBtn) _state.saveBtn.disabled = true;
    let charId = _state.charId;
    const isFlowB = !charId;
    if (isFlowB) {
      // Flow B: NOW create the character (deferred from Save obraz) + link the obraz.
      _setStatus('💾 Creating the character…', true);
      const eng = _state.obraz.imageEngine || undefined;
      try {
        const cr = await fetch('/api/char-store/create', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: _state.obraz.name || '', gender: _state.obraz.gender || null,
            faceImagePath: _state.photoPath, imageEngine: eng,
            engineParams: (eng && window.getEngineParams) ? window.getEngineParams(eng) : undefined,
            sourceObrazId: obrazId,
          }),
        }).then(r => r.json());
        charId = (cr && cr.char && cr.char.id) || null;
      } catch (e) { console.warn('[photoshoot] char create failed:', e.message); }
      if (charId) {
        try { const l = getObrazы(); const o = l.find(x => String(x.id) === String(obrazId)); if (o) { o.charId = charId; window._persistObrazы(l); } } catch {}
        try { window._setCurrentCharId?.(charId); } catch {}
      }
    }
    _state.saved = true;   // prevents _close from discarding the obraz
    try { window.loadObrazы?.(); window.loadScenarioObrazы?.(); window.loadCharCol3Obrazy?.(); } catch {}
    const onSaved = _state.onSaved;
    _close();
    // Flow B → open the character profile for voice. Flow A → done (lands in dossier).
    try {
      if (isFlowB && charId) window.openCharacterActorPopup?.(charId);
      if (onSaved) onSaved({ obrazId, charId, isNewChar: isFlowB });
    } catch {}
  }

  // ── Preview helpers ───────────────────────────────────────────────────────
  function _setPreviewSpinner(idx) {
    const p = _state.rows[idx].preview;
    p.innerHTML = '<div style="width:22px;height:22px;border:3px solid #555;border-top-color:#7ad;border-radius:50%;animation:psh-spin .8s linear infinite;"></div>';
  }
  function _setPreviewError(idx, msg) {
    const p = _state.rows[idx].preview;
    p.innerHTML = '<span style="color:#e88;font-size:9px;text-align:center;padding:3px;">✕ ' + _esc(String(msg || 'error').slice(0, 40)) + '</span>';
  }
  function _setPreviewImage(idx, src) {
    const p = _state.rows[idx].preview;
    p.innerHTML = '';
    const img = document.createElement('img');
    img.src = _bust(src);
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;cursor:zoom-in;';
    img.title = 'Open';
    img.addEventListener('click', () => _openLightbox(img.src));
    p.appendChild(img);
  }

  // In-app fullscreen lightbox (over the popup) — click anywhere or Esc to close.
  function _openLightbox(src) {
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;cursor:zoom-out;';
    const im = document.createElement('img');
    im.src = src;
    im.style.cssText = 'max-width:94vw;max-height:94vh;object-fit:contain;box-shadow:0 0 40px rgba(0,0,0,.6);';
    ov.appendChild(im);
    const close = () => { ov.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    ov.addEventListener('click', close);
    document.addEventListener('keydown', onKey, true);   // capture: closes the lightbox before the popup's Esc handler
    document.body.appendChild(ov);
  }

  function _setStatus(txt, spin) {
    const el = _state?.statusEl; if (!el) return;
    el.innerHTML = '';
    if (spin) {
      const s = document.createElement('span');
      s.style.cssText = 'display:inline-block;width:13px;height:13px;border:2px solid #99a;border-top-color:#225;border-radius:50%;animation:psh-spin .8s linear infinite;flex:0 0 auto;';
      el.appendChild(s);
    }
    const t = document.createElement('span'); t.textContent = txt; el.appendChild(t);
  }

  function _bust(p) { return p ? (p.split('?')[0] + '?t=' + Date.now()) : ''; }
  function _esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
})();
