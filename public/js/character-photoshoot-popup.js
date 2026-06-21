/* ════════════════════════════════════════════════════════════════════════════
   PHOTOSHOOT POPUP (v2) — pose cards + generation pool

   No right-side reference photo. Each CARD works on the same BASE image (the
   character/obraz photo). A card: a working preview (with ‹ › to flip THIS card's
   variants) + 3 aligned rows, each with its own right-side button:
     row1  pose text        → ▶️ generate (→ 🔄 after a result)
     row2  ai-insert note   → ⚡ ai-insert
     row3  pose thumbnails  → Apply pose   (mannequin = composition; character
                                            from the base image is applied onto it)
   View dropdown (grid 2-col default / list) + Add card; the whole cards block is
   collapsible (open on a new photoshoot, collapsed when reopened for viewing).
   A full-width POOL dropdown at the bottom collects every generation: finals first,
   5 per row, ✓ (top-left) marks a final (max 10), ✕ (top-right) deletes, click →
   lightbox. Appearance/clothing + environment is a collapsed section.
   Close asks to save; pool + final flags persist on the obraz (see obrazy.js).
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  let _state = null;
  const POLL_MS = 3000, POLL_MAX = 100;

  function _ensureCss() {
    if (document.getElementById('photoshoot-popup-css')) return;
    const st = document.createElement('style');
    st.id = 'photoshoot-popup-css';
    st.textContent = `
      #photoshoot-popup-overlay { position:fixed; inset:0; z-index:99992; background:rgba(0,0,0,.55); display:flex; align-items:center; justify-content:center; }
      .ps-box { background:#d4d0c8; color:#111; border:2px solid; border-color:#fff #808080 #808080 #fff; box-shadow:0 8px 40px rgba(0,0,0,.55); width:min(1080px,96vw); max-height:92vh; display:flex; flex-direction:column; font-family:system-ui,'Segoe UI',Roboto,Tahoma,sans-serif; }
      .ps-tb { display:flex; align-items:center; gap:6px; background:#000080; color:#fff; padding:3px 6px; font-size:12px; font-weight:bold; }
      .ps-tb button { font-size:10px; padding:1px 6px; cursor:pointer; }
      .ps-body { display:flex; flex-direction:column; gap:8px; padding:8px; overflow-y:auto; flex:1; min-height:0; }
      .ps-status { font-size:11px; color:#225; display:flex; align-items:center; gap:7px; min-height:16px; }
      .ps-acc { border:1px solid #c9a227; background:#fffbe6; border-radius:3px; }
      .ps-acc > summary { cursor:pointer; font-size:10px; font-weight:bold; color:#7a5d00; padding:5px 7px; list-style:none; }
      .ps-acc > summary::-webkit-details-marker { display:none; }
      .ps-acc-body { display:flex; flex-direction:column; gap:5px; padding:0 7px 7px; }
      .ps-acc-body label { font-size:9px; color:#7a5d00; }
      .ps-acc-body textarea { width:100%; box-sizing:border-box; font-size:10px; padding:3px 5px; resize:vertical; font-family:inherit; line-height:1.3; background:#fff7cc; border:1px solid #c9a227; color:#332; font-weight:600; }
      .ps-toolbar { display:flex; align-items:center; gap:8px; }
      .ps-toolbar select, .ps-toolbar button { font-size:11px; padding:3px 9px; cursor:pointer; }
      .ps-cards-det > summary { cursor:pointer; font-size:11px; font-weight:bold; color:#225; padding:4px 2px; user-select:none; }
      .ps-cards { margin-top:6px; }
      .ps-cards.grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
      .ps-cards.list { display:flex; flex-direction:column; gap:8px; }
      .ps-card { display:flex; gap:8px; border:1px solid #b8b3a4; background:#cfccc4; padding:6px; border-radius:4px; min-width:0; }
      .ps-cards.grid .ps-card { flex-direction:column; }
      .ps-cards.list .ps-card { flex-direction:row; }
      .ps-media { position:relative; background:#1a1a1a; border:1px solid #888; border-radius:3px; overflow:hidden; display:flex; align-items:center; justify-content:center; }
      .ps-cards.grid .ps-media { width:100%; height:300px; }
      .ps-cards.list .ps-media { flex:0 0 150px; width:150px; height:210px; }
      .ps-media img { width:100%; height:100%; object-fit:contain; cursor:zoom-in; display:block; }
      .ps-media .ph { color:#666; font-size:10px; }
      .ps-arrows { position:absolute; left:0; right:0; bottom:0; display:flex; align-items:center; justify-content:center; gap:8px; background:rgba(0,0,0,.45); color:#fff; font-size:11px; padding:2px 0; }
      .ps-arrows button { background:rgba(255,255,255,.15); color:#fff; border:none; border-radius:3px; cursor:pointer; font-size:12px; padding:0 7px; }
      .ps-cardbody { flex:1; display:flex; flex-direction:column; gap:5px; min-width:0; }
      .ps-row { display:flex; gap:6px; align-items:flex-start; }
      .ps-row > .f { flex:1; min-width:0; }
      .ps-row textarea, .ps-row input { width:100%; box-sizing:border-box; font-size:10px; padding:3px 5px; font-family:inherit; line-height:1.3; }
      .ps-row textarea { resize:vertical; }
      .ps-row > .b { flex:0 0 96px; font-size:10px; padding:4px 0; cursor:pointer; white-space:nowrap; }
      .ps-row > .b:disabled { opacity:.5; cursor:not-allowed; }
      .ps-posebtn { text-align:left; }
      .ps-posepanel { display:none; grid-template-columns:repeat(3,1fr); gap:5px; padding:5px; margin-top:4px; background:#bdb9af; border:1px solid #888; border-radius:3px; max-height:180px; overflow-y:auto; }
      .ps-posepanel.open { display:grid; }
      .ps-posethumb { position:relative; aspect-ratio:1/1; border:1px solid #888; border-radius:2px; overflow:hidden; cursor:pointer; background:#222; }
      .ps-posethumb img { width:100%; height:100%; object-fit:cover; display:block; }
      .ps-posethumb.sel { outline:2px solid #2e86c1; outline-offset:-2px; }
      .ps-pool-det { border-top:1px solid #888; }
      .ps-pool-det > summary { cursor:pointer; font-size:11px; font-weight:bold; color:#225; padding:6px 2px; user-select:none; }
      .ps-pool-grid { display:grid; grid-template-columns:repeat(5,1fr); gap:6px; padding:4px 0 8px; }
      .ps-pool-item { position:relative; aspect-ratio:3/4; border:1px solid #888; border-radius:3px; overflow:hidden; background:#1a1a1a; }
      .ps-pool-item img { width:100%; height:100%; object-fit:cover; cursor:zoom-in; display:block; }
      .ps-pool-item.final { outline:2px solid #2e86c1; outline-offset:-2px; }
      .ps-chk { position:absolute; top:3px; left:3px; width:20px; height:20px; border-radius:4px; border:1px solid #fff; background:rgba(0,0,0,.5); color:#fff; font-size:12px; line-height:18px; text-align:center; cursor:pointer; }
      .ps-chk.on { background:#2e86c1; }
      .ps-del { position:absolute; top:3px; right:3px; width:20px; height:20px; border-radius:50%; border:none; background:rgba(0,0,0,.6); color:#fff; font-size:12px; line-height:20px; text-align:center; cursor:pointer; }
      .ps-pool-empty { grid-column:1/-1; font-size:11px; color:#666; padding:10px; text-align:center; }
      .ps-footer { display:flex; justify-content:flex-end; gap:6px; padding:6px 8px; border-top:1px solid #888; }
      .ps-footer button { padding:4px 16px; font-size:11px; cursor:pointer; }
    `;
    document.head.appendChild(st);
  }

  function _esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function _bust(p) { return p ? (p + (p.indexOf('?') < 0 ? ('?t=' + Date.now()) : '')) : ''; }
  function _engine() {
    try { if (typeof window.getCharImageEngine === 'function') return window.getCharImageEngine(); } catch (e) {}
    return (_state && _state.obraz && _state.obraz.imageEngine) || 'nano-banana-2';
  }

  window.openPhotoshootPopup = function (obrazId, opts) {
    if (_state) _close();
    const obraz = (typeof getObrazы === 'function' ? getObrazы() : []).find(o => String(o.id) === String(obrazId));
    if (!obraz) { console.warn('[photoshoot] obraz not found:', obrazId); return; }
    _ensureCss();
    _state = {
      obraz,
      photoPath: (obraz.char || (window.pickMainObrazImage ? window.pickMainObrazImage(obraz) : null)),   // base = the character face
      charId: (opts && opts.charId != null) ? opts.charId : null,
      isNew: !(opts && opts.isNew === false),   // from Save obraz = new; from dossier = reopen
      saved: false,
      onSaved: (opts && typeof opts.onSaved === 'function') ? opts.onSaved : null,
      cards: [],
      nextCardId: 1,
      poses: [],            // [{key,label,file,desc}] built-in + custom
      polls: new Set(),
      gateOn: false,        // generation allowed only after analysis
    };
    _loadPoses();
    _build();
    _runAnalysis();
  };

  function _loadPoses() {
    let custom = [];
    try { custom = JSON.parse(localStorage.getItem('cr_custom_poses_v1') || '[]'); } catch (e) {}
    fetch('/poses/poses.json').then(r => r.json())
      .then(d => { _state && (_state.poses = (Array.isArray(d) ? d : []).concat(custom)); })
      .catch(() => { _state && (_state.poses = custom); });
  }

  function _close() {
    if (!_state) return;
    if (_state.isNew && !_state.saved) {
      const pool = (typeof getObrazPool === 'function') ? getObrazPool(_state.obraz.id) : [];
      if (pool.length) {
        const ok = confirm('Save this photoshoot? OK = save, Cancel = discard all generations.');
        if (ok) { _save(); return; }
        _discardObraz();
      } else {
        _discardObraz();
      }
    }
    _teardown();
  }
  function _teardown() {
    if (!_state) return;
    _state.polls.forEach(id => clearInterval(id));
    if (_state.escHandler) document.removeEventListener('keydown', _state.escHandler);
    _state.overlay && _state.overlay.remove();
    _state = null;
  }
  function _discardObraz() {
    const ob = _state.obraz;
    try { window._persistObrazы(getObrazы().filter(o => String(o.id) !== String(ob.id))); } catch (e) {}
    try { fetch('/api/obrazy/' + encodeURIComponent(ob.id) + '?name=' + encodeURIComponent(ob.name || ''), { method: 'DELETE' }); } catch (e) {}
    try { window.loadObrazы && window.loadObrazы(); window.loadScenarioObrazы && window.loadScenarioObrazы(); window.loadCharCol3Obrazy && window.loadCharCol3Obrazy(); } catch (e) {}
  }

  // ── Build ────────────────────────────────────────────────────────────────────
  function _build() {
    const ovr = document.createElement('div'); ovr.id = 'photoshoot-popup-overlay';
    ovr.addEventListener('click', e => { if (e.target === ovr) _close(); });
    const box = document.createElement('div'); box.className = 'ps-box';

    const tb = document.createElement('div'); tb.className = 'ps-tb';
    tb.innerHTML = `<span style="flex:1;">📸 Photoshoot — ${_esc(_state.obraz.name || '')}</span>`;
    const x = document.createElement('button'); x.textContent = '✕'; x.addEventListener('click', _close);
    tb.appendChild(x); box.appendChild(tb);

    const body = document.createElement('div'); body.className = 'ps-body';

    const status = document.createElement('div'); status.className = 'ps-status'; _state.statusEl = status; body.appendChild(status);

    // Collapsed appearance / clothing + environment
    const acc = document.createElement('details'); acc.className = 'ps-acc';
    const accSum = document.createElement('summary'); accSum.textContent = '🔒 Appearance / clothing & environment (locked — click to view)';
    const accBody = document.createElement('div'); accBody.className = 'ps-acc-body';
    _state.appearanceTa = _accField(accBody, 'Appearance + clothing');
    _state.environmentTa = _accField(accBody, 'Environment');
    acc.appendChild(accSum); acc.appendChild(accBody); body.appendChild(acc);

    // Toolbar: view dropdown + Add
    const toolbar = document.createElement('div'); toolbar.className = 'ps-toolbar';
    const viewSel = document.createElement('select');
    [['grid', '▦ 2 per row'], ['list', '☰ List']].forEach(([v, lbl]) => { const o = document.createElement('option'); o.value = v; o.textContent = lbl; viewSel.appendChild(o); });
    viewSel.value = 'grid';
    viewSel.addEventListener('change', () => { _state.cardsWrap.className = 'ps-cards ' + viewSel.value; });
    const addBtn = document.createElement('button'); addBtn.textContent = '＋ Add'; addBtn.title = 'Add a blank pose card';
    addBtn.addEventListener('click', () => { const c = _buildCard(); _state.cardsWrap.appendChild(c.el); _state.cardsDet.open = true; });
    toolbar.appendChild(viewSel); toolbar.appendChild(addBtn); body.appendChild(toolbar);

    // Collapsible cards block
    const cardsDet = document.createElement('details'); cardsDet.className = 'ps-cards-det'; cardsDet.open = _state.isNew;
    _state.cardsDet = cardsDet;
    const cardsSum = document.createElement('summary'); cardsSum.textContent = 'Pose cards';
    const cardsWrap = document.createElement('div'); cardsWrap.className = 'ps-cards grid'; _state.cardsWrap = cardsWrap;
    cardsDet.appendChild(cardsSum); cardsDet.appendChild(cardsWrap);
    body.appendChild(cardsDet);

    // initial 4 cards (filled by analysis)
    for (let i = 0; i < 4; i++) cardsWrap.appendChild(_buildCard().el);

    // Pool (bottom, full width)
    const poolDet = document.createElement('details'); poolDet.className = 'ps-pool-det';
    const poolSum = document.createElement('summary'); poolSum.textContent = 'All shots'; _state.poolSum = poolSum;
    const poolGrid = document.createElement('div'); poolGrid.className = 'ps-pool-grid'; _state.poolGrid = poolGrid;
    poolDet.appendChild(poolSum); poolDet.appendChild(poolGrid);
    _state.poolDet = poolDet; body.appendChild(poolDet);

    box.appendChild(body);

    const footer = document.createElement('div'); footer.className = 'ps-footer';
    const closeBtn = document.createElement('button'); closeBtn.textContent = 'Close'; closeBtn.addEventListener('click', _close);
    const saveBtn = document.createElement('button'); saveBtn.textContent = '💾 Save'; saveBtn.style.cssText = 'background:#90c090;font-weight:bold;'; saveBtn.addEventListener('click', _save); _state.saveBtn = saveBtn;
    footer.appendChild(closeBtn); footer.appendChild(saveBtn); box.appendChild(footer);

    ovr.appendChild(box); document.body.appendChild(ovr); _state.overlay = ovr;
    _state.escHandler = (e) => { if (e.key === 'Escape') _close(); };
    document.addEventListener('keydown', _state.escHandler);

    _renderPool();
  }

  function _accField(parent, label) {
    const l = document.createElement('label'); l.textContent = label;
    const ta = document.createElement('textarea'); ta.rows = 2;
    parent.appendChild(l); parent.appendChild(ta); return ta;
  }

  // ── Card ───────────────────────────────────────────────────────────────────
  function _buildCard() {
    const id = _state.nextCardId++;
    const card = { id, appliedPose: null, variants: [], vIdx: -1, poseCandidate: null };

    const el = document.createElement('div'); el.className = 'ps-card';

    // media + variant arrows
    const media = document.createElement('div'); media.className = 'ps-media';
    const img = document.createElement('img'); img.style.display = 'none';
    img.addEventListener('click', () => { const s = card.variants[card.vIdx]; if (s) window.openLightbox && window.openLightbox(s); });
    const ph = document.createElement('div'); ph.className = 'ph'; ph.textContent = 'not generated';
    const arrows = document.createElement('div'); arrows.className = 'ps-arrows'; arrows.style.display = 'none';
    const prev = document.createElement('button'); prev.textContent = '‹';
    const cnt = document.createElement('span');
    const next = document.createElement('button'); next.textContent = '›';
    prev.addEventListener('click', () => _flipCard(card, -1));
    next.addEventListener('click', () => _flipCard(card, 1));
    arrows.appendChild(prev); arrows.appendChild(cnt); arrows.appendChild(next);
    media.appendChild(img); media.appendChild(ph); media.appendChild(arrows);
    card.img = img; card.ph = ph; card.arrows = arrows; card.cnt = cnt;

    const cb = document.createElement('div'); cb.className = 'ps-cardbody';

    // row 1: pose text + generate
    const r1 = document.createElement('div'); r1.className = 'ps-row';
    const poseTa = document.createElement('textarea'); poseTa.rows = 3; poseTa.placeholder = 'Pose…'; poseTa.className = 'f';
    const genBtn = document.createElement('button'); genBtn.className = 'b'; genBtn.textContent = '▶️ Generate'; genBtn.disabled = true;
    genBtn.addEventListener('click', () => _generateCard(card));
    r1.appendChild(poseTa); r1.appendChild(genBtn);
    card.poseTa = poseTa; card.genBtn = genBtn;

    // row 2: note + ai-insert
    const r2 = document.createElement('div'); r2.className = 'ps-row';
    const note = document.createElement('input'); note.type = 'text'; note.placeholder = 'add to the pose…'; note.className = 'f';
    const aiBtn = document.createElement('button'); aiBtn.className = 'b'; aiBtn.textContent = '⚡ ai-insert'; aiBtn.disabled = true;
    aiBtn.addEventListener('click', () => _aiInsert(card));
    r2.appendChild(note); r2.appendChild(aiBtn);
    card.note = note; card.aiBtn = aiBtn;

    // row 3: pose dropdown + apply pose
    const r3 = document.createElement('div'); r3.className = 'ps-row';
    const poseBtn = document.createElement('button'); poseBtn.className = 'f ps-posebtn'; poseBtn.style.cssText = 'font-size:10px;padding:4px 6px;cursor:pointer;'; poseBtn.textContent = '▾ pick a pose';
    const applyBtn = document.createElement('button'); applyBtn.className = 'b'; applyBtn.textContent = 'Apply pose'; applyBtn.disabled = true;
    r3.appendChild(poseBtn); r3.appendChild(applyBtn);
    card.poseBtn = poseBtn; card.applyBtn = applyBtn;

    const panel = document.createElement('div'); panel.className = 'ps-posepanel'; card.panel = panel;
    poseBtn.addEventListener('click', () => { const open = panel.classList.toggle('open'); if (open) _renderPosePanel(card); });
    applyBtn.addEventListener('click', () => _applyPose(card));

    cb.appendChild(r1); cb.appendChild(r2); cb.appendChild(r3); cb.appendChild(panel);
    el.appendChild(media); el.appendChild(cb);
    card.el = el;

    if (_state.gateOn) { genBtn.disabled = false; aiBtn.disabled = false; applyBtn.disabled = false; }
    _state.cards.push(card);
    return card;
  }

  function _renderPosePanel(card) {
    const panel = card.panel; panel.innerHTML = '';
    const poses = _state.poses || [];
    if (!poses.length) { const e = document.createElement('div'); e.style.cssText = 'grid-column:1/-1;font-size:10px;color:#555;'; e.textContent = 'No poses.'; panel.appendChild(e); return; }
    poses.forEach(p => {
      const t = document.createElement('div'); t.className = 'ps-posethumb'; t.title = p.label || p.key || '';
      if (card.poseCandidate && card.poseCandidate.file === p.file) t.classList.add('sel');
      const im = document.createElement('img'); im.loading = 'lazy'; im.src = p.file; t.appendChild(im);
      t.addEventListener('click', () => {
        card.poseCandidate = { file: p.file, desc: p.desc || '', label: p.label || p.key || '' };
        card.poseBtn.textContent = '▾ ' + (card.poseCandidate.label || 'pose');
        panel.classList.remove('open');
      });
      panel.appendChild(t);
    });
  }

  // Apply the picked pose: mannequin = composition for this card; fill the pose text
  // with its key points so it's visible/editable. Click again to clear.
  function _applyPose(card) {
    if (card.appliedPose) {   // toggle off
      card.appliedPose = null;
      card.applyBtn.textContent = 'Apply pose';
      card.applyBtn.style.background = '';
      return;
    }
    const cand = card.poseCandidate;
    if (!cand) { card.panel.classList.add('open'); _renderPosePanel(card); return; }
    card.appliedPose = { file: cand.file, desc: cand.desc };
    if (cand.desc && !(card.poseTa.value || '').trim()) card.poseTa.value = cand.desc;
    card.applyBtn.textContent = '✓ Pose set';
    card.applyBtn.style.background = '#a9d0ec';
  }

  function _flipCard(card, d) {
    if (!card.variants.length) return;
    card.vIdx = (card.vIdx + d + card.variants.length) % card.variants.length;
    _showCardImage(card, card.variants[card.vIdx]);
  }
  function _showCardImage(card, src) {
    if (!src) { card.img.style.display = 'none'; card.ph.style.display = ''; card.arrows.style.display = 'none'; return; }
    card.img.src = _bust(src); card.img.style.display = ''; card.ph.style.display = 'none';
    if (card.variants.length > 1) { card.arrows.style.display = ''; card.cnt.textContent = (card.vIdx + 1) + '/' + card.variants.length; }
    else card.arrows.style.display = 'none';
  }

  function _setGate(on) {
    _state.gateOn = on;
    _state.cards.forEach(c => { c.genBtn.disabled = !on; c.aiBtn.disabled = !on; c.applyBtn.disabled = !on; });
  }
  function _setStatus(msg, spin) {
    if (!_state || !_state.statusEl) return;
    _state.statusEl.innerHTML = (spin ? '<span class="spin">⏳</span> ' : '') + _esc(msg);
  }

  // ── Analysis ─────────────────────────────────────────────────────────────────
  async function _runAnalysis() {
    const st = _state;
    _setStatus('Analyzing the obraz and environment…', true);
    try {
      const d = await (await fetch('/api/characters/pose-analyze', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imagePath: st.photoPath }),
      })).json();
      if (_state !== st) return;
      if (!d.success) throw new Error(d.error || 'analyze failed');
      _state.appearanceTa.value = d.appearance || '';
      _state.environmentTa.value = d.environment || '';
      (d.poses || []).slice(0, _state.cards.length).forEach((p, i) => {
        const c = _state.cards[i]; if (!c) return;
        c.poseTa.value = p.pose || '';
        if (p.examples && p.examples.length) c.note.placeholder = 'e.g.: ' + p.examples.join(' · ');
      });
      _setStatus('✓ Ready. Edit / pick a pose, then ▶️ Generate per card.', false);
      _setGate(true);
    } catch (e) {
      if (_state !== st) return;
      _setStatus('⚠ Analysis error: ' + e.message + ' — enter poses manually.', false);
      _setGate(true);
    }
  }

  // ── Generation ─────────────────────────────────────────────────────────────
  function _composeText(card) {
    const a = (_state.appearanceTa.value || '').trim();
    const env = (_state.environmentTa.value || '').trim();
    const pose = (card.poseTa.value || '').trim();
    return [a, env, pose].filter(Boolean).join('. ');
  }

  async function _generateCard(card) {
    if (!_state.gateOn) { _setStatus('Wait for the analysis to finish.', false); return; }
    const base = _state.photoPath;
    card.genBtn.disabled = true; _setStatus('Generating…', true);
    try {
      let imagePath;
      if (card.appliedPose) {
        imagePath = await _genWithMannequin(card, base);
      } else {
        const prompt = _composeText(card);
        if (!prompt) { _setStatus('⚠ Empty pose.', false); card.genBtn.disabled = false; return; }
        imagePath = await _genWithText(base, prompt);
      }
      if (!imagePath) throw new Error('no image');
      card.variants.push(imagePath); card.vIdx = card.variants.length - 1;
      _showCardImage(card, imagePath);
      card.genBtn.textContent = '🔄 Regenerate';
      try { window.addObrazPoolEntry && window.addObrazPoolEntry(_state.obraz.id, imagePath, card.id); } catch (e) {}
      _renderPool();
      _setStatus('✓ Done.', false);
    } catch (e) {
      _setStatus('⚠ Generation failed: ' + (e.message || e), false);
    } finally {
      card.genBtn.disabled = false;
    }
  }

  // text pose (env-locked) → pose-generate + pose-status
  function _genWithText(base, prompt) {
    return fetch('/api/characters/pose-generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imagePath: base, prompt, imageEngine: _engine() }),
    }).then(r => r.json()).then(d => {
      if (!d.success || !d.taskId) throw new Error(d.error || 'no taskId');
      return _poll('/api/characters/pose-status/' + encodeURIComponent(d.taskId) + '?obrazId=' + encodeURIComponent(_state.obraz.id));
    });
  }

  // mannequin = composition; the base character is applied onto it (compose prompt
  // via the LLM, then asset-interact/generate with [mannequin, base]).
  async function _genWithMannequin(card, base) {
    const pdesc = (card.poseTa.value || '').trim() || (card.appliedPose.desc || '');
    let prompt = '';
    try {
      const c = await (await fetch('/api/character-creator/pose-compose', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'apply', poseDesc: pdesc }),
      })).json();
      if (c && c.success && c.prompt) prompt = c.prompt;
    } catch (e) {}
    if (!prompt) {
      prompt = 'Use the FIRST image (a grey artist mannequin) as the composition base: keep its camera angle, framing and body pose exactly. Render the person from the SECOND image (their face, identity, hair, skin and clothing) in that composition, fully replacing the mannequin. If the angle reveals areas not in the second image, plausibly extend the environment. One photorealistic person, no mannequin, no text.' + (pdesc ? (' Target pose: ' + pdesc + '.') : '');
    }
    const d = await (await fetch('/api/asset-interact/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activePath: card.appliedPose.file, assetPath: base, prompt, assetType: 'pose', imageEngine: _engine() }),
    })).json();
    if (!d.success || !d.taskId) throw new Error(d.error || 'no taskId');
    return _poll('/api/asset-interact/status/' + encodeURIComponent(d.taskId));
  }

  function _poll(url) {
    return new Promise((resolve, reject) => {
      let n = 0;
      const iv = setInterval(async () => {
        if (!_state) { clearInterval(iv); return reject(new Error('closed')); }
        if (++n > POLL_MAX) { clearInterval(iv); _state.polls.delete(iv); return reject(new Error('timeout')); }
        try {
          const d = await (await fetch(url)).json();
          if ((d.state === 'success' || d.success === true) && d.imagePath) { clearInterval(iv); _state.polls.delete(iv); resolve(d.imagePath); }
          else if (d.state === 'failed' || d.success === false && d.state) { clearInterval(iv); _state.polls.delete(iv); reject(new Error(d.error || 'failed')); }
        } catch (e) { /* keep polling */ }
      }, POLL_MS);
      _state.polls.add(iv);
    });
  }

  async function _aiInsert(card) {
    const note = (card.note.value || '').trim();
    const pose = (card.poseTa.value || '').trim();
    if (!note) { card.note.focus(); return; }
    if (!pose) return;
    const old = card.poseTa.value; card.poseTa.value = '⏳ weaving…';
    try {
      const d = await (await fetch('/api/characters/pose-ai-insert', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pose, note }),
      })).json();
      if (d.success && d.pose) { card.poseTa.value = d.pose; card.note.value = ''; }
      else { card.poseTa.value = old; _setStatus('⚠ ai-insert: ' + (d.error || 'error'), false); }
    } catch (e) { card.poseTa.value = old; _setStatus('⚠ ai-insert: ' + e.message, false); }
  }

  // ── Pool (bottom) ─────────────────────────────────────────────────────────────
  function _renderPool() {
    if (!_state || !_state.poolGrid) return;
    const pool = (typeof getObrazPool === 'function') ? getObrazPool(_state.obraz.id) : [];
    // finals first (top-left), then the rest
    const ordered = pool.slice().sort((a, b) => (b.final ? 1 : 0) - (a.final ? 1 : 0));
    const finals = pool.filter(e => e.final).length;
    const max = window.OBRAZ_FINAL_MAX || 10;
    _state.poolSum.textContent = 'All shots (' + pool.length + ') · finals ' + finals + '/' + max;
    if (!_state.isNew && !_state.poolDet.dataset.init) { _state.poolDet.open = pool.length > 0; }
    _state.poolDet.dataset.init = '1';
    const g = _state.poolGrid; g.innerHTML = '';
    if (!ordered.length) { const e = document.createElement('div'); e.className = 'ps-pool-empty'; e.textContent = 'No generations yet.'; g.appendChild(e); return; }
    ordered.forEach(entry => {
      const it = document.createElement('div'); it.className = 'ps-pool-item' + (entry.final ? ' final' : '');
      const im = document.createElement('img'); im.loading = 'lazy'; im.src = _bust(entry.file);
      im.addEventListener('click', () => window.openLightbox && window.openLightbox(entry.file));
      const chk = document.createElement('div'); chk.className = 'ps-chk' + (entry.final ? ' on' : ''); chk.textContent = entry.final ? '✓' : ''; chk.title = 'Mark as a final (saved to the photoshoot)';
      chk.addEventListener('click', (e) => {
        e.stopPropagation();
        const r = window.toggleObrazPoolFinal(_state.obraz.id, entry.file);
        if (r && r.full) { _setStatus('⚠ Max ' + max + ' finals.', false); return; }
        _renderPool();
      });
      const del = document.createElement('button'); del.className = 'ps-del'; del.textContent = '✕'; del.title = 'Delete this image';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!confirm('Delete this image?')) return;
        try { window.deleteObrazPoolEntry(_state.obraz.id, entry.file); } catch (er) {}
        _state.cards.forEach(c => { const i = c.variants.indexOf(entry.file); if (i >= 0) { c.variants.splice(i, 1); c.vIdx = Math.min(c.vIdx, c.variants.length - 1); _showCardImage(c, c.variants[c.vIdx]); } });
        _renderPool();
      });
      it.appendChild(im); it.appendChild(chk); it.appendChild(del); g.appendChild(it);
    });
  }

  // ── Save ─────────────────────────────────────────────────────────────────────
  async function _save() {
    if (!_state) return;
    const obrazId = _state.obraz.id;
    const pool = (typeof getObrazPool === 'function') ? getObrazPool(obrazId) : [];
    if (!pool.length) { _setStatus('⚠ Generate at least one pose first.', false); return; }
    if (_state.saveBtn) _state.saveBtn.disabled = true;
    let charId = _state.charId;
    const isFlowB = !charId;
    if (isFlowB) {
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
        try { const l = getObrazы(); const o = l.find(x => String(x.id) === String(obrazId)); if (o) { o.charId = charId; window._persistObrazы(l); } } catch (e) {}
        try { window._setCurrentCharId && window._setCurrentCharId(charId); } catch (e) {}
      }
    }
    _state.saved = true;
    try { window.loadObrazы && window.loadObrazы(); window.loadScenarioObrazы && window.loadScenarioObrazы(); window.loadCharCol3Obrazy && window.loadCharCol3Obrazy(); } catch (e) {}
    const onSaved = _state.onSaved;
    _teardown();
    try {
      if (isFlowB && charId) window.openCharacterActorPopup && window.openCharacterActorPopup(charId);
      if (onSaved) onSaved({ obrazId, charId, isNewChar: isFlowB });
    } catch (e) {}
  }
})();
