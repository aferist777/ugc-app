/* ════════════════════════════════════════════════════════════════════════════
   PHOTOSHOOT POPUP (v2.1) — pose cards + generation pool

   Each CARD works on the same BASE image (the character/obraz photo that was active
   when "Save obraz" was pressed). A card: a preview (shows the base by default; ‹ ›
   flip THIS card's generated variants; click → lightbox) + 3 aligned rows:
     row1  pose text        → ▶️/🔄 generate (contrasty)
     row2  ai-insert note   → ⚡ ai-insert
     row3  pose thumbnails  → Apply pose (mannequin = composition; the base character
                              is applied onto it). Generate then uses the applied pose.
   Toolbar: view dropdown (4 layouts) · Add · Gen all   …   i2i engine · ⚙ params.
   Pose dropdown floats OVER the UI (10 thumbnails per row). A full-width POOL at the
   bottom collects every generation (finals first, 5/row, ✓ final / ✕ delete / click →
   lightbox). Generating shows a shimmer + ETA on the card. Styled with the project's
   design tokens. Close asks to save.
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  let _state = null;
  const POLL_MS = 3000, POLL_MAX = 120;

  function _ensureCss() {
    if (document.getElementById('photoshoot-popup-css')) return;
    const st = document.createElement('style');
    st.id = 'photoshoot-popup-css';
    st.textContent = `
      #photoshoot-popup-overlay { position:fixed; inset:0; z-index:99992; background:rgba(0,0,0,.6); display:flex; align-items:center; justify-content:center; }
      .ps-box { background:var(--surface,#1b1b22); color:var(--ink,#eef0f4); border:1px solid var(--border,#34343f); border-radius:var(--r,10px); box-shadow:var(--shadow,0 12px 48px rgba(0,0,0,.6)); width:min(1120px,96vw); max-height:92vh; display:flex; flex-direction:column; font-family:var(--font,system-ui,'Segoe UI',Roboto,sans-serif); }
      .ps-tb { display:flex; align-items:center; gap:8px; background:var(--surface-2,#24242e); color:var(--ink,#eef0f4); padding:9px 12px; font-size:13px; font-weight:700; border-bottom:1px solid var(--border,#34343f); border-radius:var(--r,10px) var(--r,10px) 0 0; }
      .ps-tb button { font-size:13px; padding:3px 9px; cursor:pointer; background:var(--surface,#1b1b22); color:var(--ink,#eef0f4); border:1px solid var(--border,#34343f); border-radius:var(--r-sm,7px); }
      .ps-body { display:flex; flex-direction:column; gap:10px; padding:12px; overflow-y:auto; flex:1; min-height:0; }
      .ps-status { font-size:12.5px; color:var(--muted,#aab); display:flex; align-items:center; gap:7px; min-height:18px; }
      .ps-acc { border:1px solid var(--border,#34343f); background:var(--surface-2,#24242e); border-radius:var(--r-sm,7px); }
      .ps-acc > summary { cursor:pointer; font-size:12px; font-weight:700; color:var(--ink,#eef0f4); padding:8px 10px; list-style:none; }
      .ps-acc > summary::-webkit-details-marker { display:none; }
      .ps-acc-body { display:flex; flex-direction:column; gap:6px; padding:0 10px 10px; }
      .ps-acc-body label { font-size:11px; color:var(--muted,#aab); }
      .ps-acc-body textarea { width:100%; box-sizing:border-box; font-size:12px; padding:6px 8px; resize:vertical; font-family:inherit; line-height:1.35; background:var(--surface,#1b1b22); border:1px solid var(--border,#34343f); color:var(--ink,#eef0f4); border-radius:var(--r-xs,5px); }
      .ps-toolbar { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
      .ps-toolbar .sp { flex:1; }
      .ps-toolbar select, .ps-toolbar button { font-size:12.5px; padding:8px 12px; min-height:36px; box-sizing:border-box; cursor:pointer; background:var(--surface-2,#24242e); color:var(--ink,#eef0f4); border:1px solid var(--border,#34343f); border-radius:var(--r-sm,7px); line-height:1.2; }
      .ps-toolbar select { padding-right:26px; }
      .ps-toolbar button:hover { border-color:var(--primary,#5b8cff); }
      .ps-eng-pop { position:fixed; z-index:99995; display:none; width:min(360px,92vw); max-height:70vh; overflow-y:auto; padding:10px 12px; background:var(--surface,#1b1b22); color:var(--ink,#eef0f4); border:1px solid var(--border,#34343f); border-radius:var(--r-sm,7px); box-shadow:var(--shadow,0 12px 48px rgba(0,0,0,.6)); font-size:12px; }
      .ps-eng-pop.open { display:block; }
      .ps-eng-pop .es-row { display:flex; align-items:center; gap:8px; margin:6px 0; }
      .ps-eng-pop .es-row label { flex:0 0 42%; font-size:11px; color:var(--muted,#aab); }
      .ps-eng-pop .es-row select, .ps-eng-pop .es-row input { flex:1; min-height:30px; box-sizing:border-box; padding:5px 8px; background:var(--surface-2,#24242e); color:var(--ink,#eef0f4); border:1px solid var(--border,#34343f); border-radius:var(--r-xs,5px); font-size:12px; }
      .ps-eng-pop .es-desc { font-size:10px; color:var(--muted,#aab); margin:0 0 6px; }
      .ps-eng-pop .ps-eng-title { font-weight:700; font-size:12.5px; margin-bottom:8px; }
      .ps-gearbtn { flex:0 0 auto; width:36px; min-height:36px; box-sizing:border-box; cursor:pointer; background:var(--surface,#1b1b22); color:var(--ink,#eef0f4); border:1px solid var(--border,#34343f); border-radius:var(--r-xs,5px); font-size:13px; }
      .ps-toolbar .ps-genall { background:var(--primary,#5b8cff); color:var(--primary-ink,#fff); border-color:var(--primary,#5b8cff); font-weight:700; }
      .ps-cards-det > summary { cursor:pointer; font-size:12px; font-weight:700; color:var(--ink,#eef0f4); padding:5px 2px; user-select:none; }
      .ps-cards { margin-top:6px; }
      .ps-cards.m-list  { display:flex; flex-direction:column; gap:9px; }
      .ps-cards.m-grid2 { display:grid; grid-template-columns:repeat(2,1fr); gap:9px; }
      .ps-cards.m-side2 { display:grid; grid-template-columns:repeat(2,1fr); gap:9px; }
      .ps-cards.m-grid4 { display:grid; grid-template-columns:repeat(4,1fr); gap:7px; }
      .ps-card { display:flex; gap:9px; border:1px solid var(--border,#34343f); background:var(--surface-2,#24242e); padding:8px; border-radius:var(--r-sm,7px); min-width:0; }
      .ps-cards.m-list .ps-card, .ps-cards.m-side2 .ps-card { flex-direction:row; }
      .ps-cards.m-grid2 .ps-card, .ps-cards.m-grid4 .ps-card { flex-direction:column; }
      .ps-media { position:relative; background:#111; border:1px solid var(--border,#34343f); border-radius:var(--r-xs,5px); overflow:hidden; display:flex; align-items:center; justify-content:center; }
      .ps-cards.m-list  .ps-media { flex:0 0 160px; width:160px; height:224px; }
      .ps-cards.m-side2 .ps-media { flex:0 0 132px; width:132px; height:185px; }
      .ps-cards.m-grid2 .ps-media { width:100%; height:300px; }
      .ps-cards.m-grid4 .ps-media { width:100%; height:200px; }
      .ps-media img { width:100%; height:100%; object-fit:contain; cursor:zoom-in; display:block; }
      .ps-media .ph { color:#888; font-size:11px; }
      .ps-arrows { position:absolute; left:0; right:0; bottom:0; display:flex; align-items:center; justify-content:center; gap:10px; background:rgba(0,0,0,.5); color:#fff; font-size:12px; padding:3px 0; }
      .ps-arrows button { background:rgba(255,255,255,.18); color:#fff; border:none; border-radius:4px; cursor:pointer; font-size:13px; padding:0 8px; }
      .ps-busy { position:absolute; inset:0; display:none; }
      .ps-busy.on { display:block; }
      .ps-busy-shim { position:absolute; inset:0; background:linear-gradient(100deg,rgba(255,255,255,0) 35%,rgba(255,255,255,.20) 50%,rgba(255,255,255,0) 65%); background-size:220% 100%; animation:psShim 1.1s linear infinite; }
      @keyframes psShim { 0%{background-position:170% 0} 100%{background-position:-70% 0} }
      .ps-busy-t { position:absolute; left:0; right:0; bottom:8px; text-align:center; color:#fff; font:700 12.5px var(--font,system-ui); text-shadow:0 1px 3px #000; }
      .ps-cardbody { flex:1; display:flex; flex-direction:column; gap:6px; min-width:0; }
      .ps-row { display:flex; gap:6px; align-items:flex-start; }
      .ps-row > .f { flex:1; min-width:0; box-sizing:border-box; font-size:12px; padding:6px 8px; font-family:inherit; line-height:1.35; background:var(--surface,#1b1b22); border:1px solid var(--border,#34343f); color:var(--ink,#eef0f4); border-radius:var(--r-xs,5px); }
      .ps-row textarea.f { resize:vertical; }
      .ps-row > .b { flex:0 0 100px; font-size:12px; padding:6px 0; cursor:pointer; white-space:nowrap; background:var(--surface,#1b1b22); color:var(--ink,#eef0f4); border:1px solid var(--border,#34343f); border-radius:var(--r-xs,5px); }
      .ps-row > .b:disabled { opacity:.45; cursor:not-allowed; }
      .ps-row > .b.ps-gen { background:var(--primary,#5b8cff); color:var(--primary-ink,#fff); border-color:var(--primary,#5b8cff); font-weight:700; }
      .ps-row > .b.ps-apply-on { background:#2e7d46; color:#fff; border-color:#2e7d46; }
      .ps-posebtn { text-align:left; }
      .ps-pose-pop { position:fixed; z-index:99995; display:none; grid-template-columns:repeat(10,1fr); gap:5px; padding:7px; background:var(--surface,#1b1b22); border:1px solid var(--border,#34343f); border-radius:var(--r-sm,7px); box-shadow:var(--shadow,0 12px 48px rgba(0,0,0,.6)); max-height:62vh; overflow-y:auto; }
      .ps-pose-pop.open { display:grid; }
      .ps-pose-pop .ps-pose-empty { grid-column:1/-1; font-size:12px; color:var(--muted,#aab); padding:8px; text-align:center; }
      .ps-posethumb { position:relative; aspect-ratio:1/1; border:1px solid var(--border,#34343f); border-radius:4px; overflow:hidden; cursor:pointer; background:#222; }
      .ps-posethumb img { width:100%; height:100%; object-fit:cover; display:block; }
      .ps-posethumb.sel { outline:2px solid var(--primary,#5b8cff); outline-offset:-2px; }
      .ps-pool-det { border-top:1px solid var(--border,#34343f); }
      .ps-pool-det > summary { cursor:pointer; font-size:12px; font-weight:700; color:var(--ink,#eef0f4); padding:8px 2px; user-select:none; }
      .ps-pool-grid { display:grid; grid-template-columns:repeat(5,1fr); gap:7px; padding:4px 0 8px; }
      .ps-pool-item { position:relative; aspect-ratio:3/4; border:1px solid var(--border,#34343f); border-radius:var(--r-xs,5px); overflow:hidden; background:#111; }
      .ps-pool-item img { width:100%; height:100%; object-fit:cover; cursor:zoom-in; display:block; }
      .ps-pool-item.final { outline:2px solid var(--primary,#5b8cff); outline-offset:-2px; }
      .ps-chk { position:absolute; top:4px; left:4px; width:22px; height:22px; border-radius:5px; border:1px solid #fff; background:rgba(0,0,0,.55); color:#fff; font-size:13px; line-height:20px; text-align:center; cursor:pointer; }
      .ps-chk.on { background:var(--primary,#5b8cff); }
      .ps-del { position:absolute; top:4px; right:4px; width:22px; height:22px; border-radius:50%; border:none; background:rgba(0,0,0,.65); color:#fff; font-size:13px; line-height:22px; text-align:center; cursor:pointer; }
      .ps-pool-empty { grid-column:1/-1; font-size:12px; color:var(--muted,#aab); padding:12px; text-align:center; }
      .ps-footer { display:flex; justify-content:flex-end; gap:8px; padding:9px 12px; border-top:1px solid var(--border,#34343f); }
      .ps-footer button { padding:6px 18px; font-size:12.5px; cursor:pointer; background:var(--surface-2,#24242e); color:var(--ink,#eef0f4); border:1px solid var(--border,#34343f); border-radius:var(--r-sm,7px); }
      .ps-footer .ps-save { background:var(--primary,#5b8cff); color:var(--primary-ink,#fff); border-color:var(--primary,#5b8cff); font-weight:700; }
    `;
    document.head.appendChild(st);
  }

  function _esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function _bust(p) { return p ? (p + (p.indexOf('?') < 0 ? ('?t=' + Date.now()) : '')) : ''; }
  function _engine() {
    try { if (typeof window.getCharImageEngine === 'function') return window.getCharImageEngine(); } catch (e) {}
    return (localStorage.getItem('char_image_engine_v1')) || (_state && _state.obraz && _state.obraz.imageEngine) || 'firered-edit';
  }

  // per-label generation-duration EMA for the ETA
  function _avg() { try { return JSON.parse(localStorage.getItem('ps_gen_avg_v1') || '{}'); } catch (e) { return {}; } }
  function _est(k) { const v = _avg()[k]; return (typeof v === 'number' && v > 1000) ? v : 18000; }
  function _rec(k, ms) { if (!(ms > 0)) return; const s = _avg(); const p = s[k]; s[k] = (typeof p === 'number') ? Math.round(p * 0.6 + ms * 0.4) : ms; try { localStorage.setItem('ps_gen_avg_v1', JSON.stringify(s)); } catch (e) {} }

  window.openPhotoshootPopup = function (obrazId, opts) {
    if (_state) _close();
    const obraz = (typeof getObrazы === 'function' ? getObrazы() : []).find(o => String(o.id) === String(obrazId));
    if (!obraz) { console.warn('[photoshoot] obraz not found:', obrazId); return; }
    _ensureCss();
    _state = {
      obraz,
      photoPath: (obraz.char || (window.pickMainObrazImage ? window.pickMainObrazImage(obraz) : null)),  // base = active image at Save obraz
      charId: (opts && opts.charId != null) ? opts.charId : null,
      isNew: !(opts && opts.isNew === false),
      saved: false,
      onSaved: (opts && typeof opts.onSaved === 'function') ? opts.onSaved : null,
      cards: [],
      nextCardId: 1,
      poses: [],
      polls: new Set(),
      gateOn: false,
      view: 'm-grid2',
      form: obraz.psForm || null,   // saved appearance/env + per-card pose text
    };
    _loadPoses();
    _build();
    if (_state.isNew && !_state.form) _runAnalysis();    // new photoshoot → analyze once
    else { _setGate(true); _setStatus(_state.form ? 'Restored. Edit / pick a pose, then generate.' : 'Pick a pose or type a prompt, then generate.', false); }
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
      if (pool.length) { if (confirm('Save this photoshoot? OK = save, Cancel = discard all generations.')) { _save(); return; } _discardObraz(); }
      else _discardObraz();
    }
    _teardown();
  }
  function _teardown() {
    if (!_state) return;
    _state.polls.forEach(id => clearInterval(id));
    if (_state.escHandler) document.removeEventListener('keydown', _state.escHandler);
    if (_state.posePopOutside) document.removeEventListener('mousedown', _state.posePopOutside, true);
    if (_state.engPopOutside) document.removeEventListener('mousedown', _state.engPopOutside, true);
    _state.posePop && _state.posePop.remove();
    _state.engPop && _state.engPop.remove();
    _state.overlay && _state.overlay.remove();
    _state = null;
  }
  function _discardObraz() {
    const ob = _state.obraz;
    try { window._persistObrazы(getObrazы().filter(o => String(o.id) !== String(ob.id))); } catch (e) {}
    try { fetch('/api/obrazy/' + encodeURIComponent(ob.id) + '?name=' + encodeURIComponent(ob.name || ''), { method: 'DELETE' }); } catch (e) {}
    try { window.loadObrazы && window.loadObrazы(); window.loadScenarioObrazы && window.loadScenarioObrazы(); window.loadCharCol3Obrazy && window.loadCharCol3Obrazy(); } catch (e) {}
  }

  // ── Build ──────────────────────────────────────────────────────────────────
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

    // collapsed appearance / clothing + environment
    const acc = document.createElement('details'); acc.className = 'ps-acc';
    const accSum = document.createElement('summary'); accSum.textContent = '🔒 Appearance / clothing & environment (locked — click to view)';
    const accBody = document.createElement('div'); accBody.className = 'ps-acc-body';
    _state.appearanceTa = _accField(accBody, 'Appearance + clothing');
    _state.environmentTa = _accField(accBody, 'Environment');
    if (_state.form) { _state.appearanceTa.value = _state.form.appearance || ''; _state.environmentTa.value = _state.form.environment || ''; }
    _state.appearanceTa.addEventListener('change', _persistForm);
    _state.environmentTa.addEventListener('change', _persistForm);
    acc.appendChild(accSum); acc.appendChild(accBody); body.appendChild(acc);

    // toolbar: view · add · gen all  ……  engine · gear
    const toolbar = document.createElement('div'); toolbar.className = 'ps-toolbar';
    const viewSel = document.createElement('select');
    [['m-grid2', '▦ 2 per row'], ['m-side2', '▤ 2 · fields right'], ['m-grid4', '⠿ 4 per row'], ['m-list', '☰ List']]
      .forEach(([v, lbl]) => { const o = document.createElement('option'); o.value = v; o.textContent = lbl; viewSel.appendChild(o); });
    viewSel.value = _state.view;
    viewSel.addEventListener('change', () => { _state.view = viewSel.value; _state.cardsWrap.className = 'ps-cards ' + _state.view; });
    const addBtn = document.createElement('button'); addBtn.textContent = '＋ Add';
    addBtn.addEventListener('click', () => { const c = _buildCard(); _state.cardsWrap.appendChild(c.el); _state.cardsDet.open = true; });
    const genAllBtn = document.createElement('button'); genAllBtn.className = 'ps-genall'; genAllBtn.textContent = '⚡ Gen all';
    genAllBtn.addEventListener('click', _genAll);
    const sp = document.createElement('div'); sp.className = 'sp';
    const engSel = document.createElement('select'); engSel.title = 'i2i engine';
    _i2iEngines().forEach(([id, lbl]) => { const o = document.createElement('option'); o.value = id; o.textContent = lbl; engSel.appendChild(o); });
    engSel.value = _engine();
    _state.engSel = engSel;
    engSel.addEventListener('change', () => { try { localStorage.setItem('char_image_engine_v1', engSel.value); } catch (e) {} if (_state.engPop && _state.engPop.classList.contains('open')) _openEnginePop(_state.engGear, engSel.value, true); });
    const gear = document.createElement('button'); gear.textContent = '⚙'; gear.title = 'Engine parameters'; _state.engGear = gear;
    gear.addEventListener('click', () => _openEnginePop(gear, engSel.value));
    toolbar.appendChild(viewSel); toolbar.appendChild(addBtn); toolbar.appendChild(genAllBtn);
    toolbar.appendChild(sp); toolbar.appendChild(engSel); toolbar.appendChild(gear);
    body.appendChild(toolbar);

    // collapsible cards block
    const cardsDet = document.createElement('details'); cardsDet.className = 'ps-cards-det'; cardsDet.open = _state.isNew; _state.cardsDet = cardsDet;
    const cardsSum = document.createElement('summary'); cardsSum.textContent = 'Pose cards';
    const cardsWrap = document.createElement('div'); cardsWrap.className = 'ps-cards ' + _state.view; _state.cardsWrap = cardsWrap;
    cardsDet.appendChild(cardsSum); cardsDet.appendChild(cardsWrap); body.appendChild(cardsDet);
    const _n = (_state.form && Array.isArray(_state.form.cards) && _state.form.cards.length) ? _state.form.cards.length : 4;
    for (let i = 0; i < _n; i++) { const c = _buildCard(); if (_state.form && _state.form.cards && _state.form.cards[i]) c.poseTa.value = _state.form.cards[i].pose || ''; cardsWrap.appendChild(c.el); }

    // pool
    const poolDet = document.createElement('details'); poolDet.className = 'ps-pool-det';
    const poolSum = document.createElement('summary'); poolSum.textContent = 'All shots'; _state.poolSum = poolSum;
    const poolGrid = document.createElement('div'); poolGrid.className = 'ps-pool-grid'; _state.poolGrid = poolGrid;
    poolDet.appendChild(poolSum); poolDet.appendChild(poolGrid); _state.poolDet = poolDet; body.appendChild(poolDet);

    box.appendChild(body);

    const footer = document.createElement('div'); footer.className = 'ps-footer';
    const closeBtn = document.createElement('button'); closeBtn.textContent = 'Close'; closeBtn.addEventListener('click', _close);
    const saveBtn = document.createElement('button'); saveBtn.className = 'ps-save'; saveBtn.textContent = '💾 Save'; saveBtn.addEventListener('click', _save); _state.saveBtn = saveBtn;
    footer.appendChild(closeBtn); footer.appendChild(saveBtn); box.appendChild(footer);

    ovr.appendChild(box); document.body.appendChild(ovr); _state.overlay = ovr;
    _state.escHandler = (e) => { if (e.key === 'Escape') _close(); };
    document.addEventListener('keydown', _state.escHandler);
    _renderPool();
  }

  function _i2iEngines() {
    const S = window.ENGINE_SCHEMAS || {};
    const ids = Object.keys(S).filter(id => S[id] && S[id].kind === 'image' && Array.isArray(S[id].capabilities) && S[id].capabilities.includes('i2i'));
    if (!ids.length) return [['firered-edit', 'FireRed Edit'], ['nano-banana-2', 'Nano Banana 2'], ['gptimage2', 'GPT-Image-2'], ['qwen2', 'Qwen Edit+'], ['seedream', 'Seedream'], ['seedream4.5', 'Seedream 4.5']];
    return ids.map(id => [id, S[id].label || id]);
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

    const media = document.createElement('div'); media.className = 'ps-media';
    const img = document.createElement('img');
    img.addEventListener('click', () => { const s = card.variants.length ? card.variants[card.vIdx] : _state.photoPath; if (s) window.openLightbox && window.openLightbox(s); });
    const ph = document.createElement('div'); ph.className = 'ph'; ph.textContent = 'base'; ph.style.display = 'none';
    const arrows = document.createElement('div'); arrows.className = 'ps-arrows'; arrows.style.display = 'none';
    const prev = document.createElement('button'); prev.textContent = '‹';
    const cnt = document.createElement('span');
    const next = document.createElement('button'); next.textContent = '›';
    prev.addEventListener('click', () => _flip(card, -1)); next.addEventListener('click', () => _flip(card, 1));
    arrows.appendChild(prev); arrows.appendChild(cnt); arrows.appendChild(next);
    const busy = document.createElement('div'); busy.className = 'ps-busy';
    const shim = document.createElement('div'); shim.className = 'ps-busy-shim';
    const busyT = document.createElement('div'); busyT.className = 'ps-busy-t';
    busy.appendChild(shim); busy.appendChild(busyT);
    media.appendChild(img); media.appendChild(ph); media.appendChild(arrows); media.appendChild(busy);
    card.img = img; card.ph = ph; card.arrows = arrows; card.cnt = cnt; card.busy = busy; card.busyT = busyT;

    const cb = document.createElement('div'); cb.className = 'ps-cardbody';

    const r1 = document.createElement('div'); r1.className = 'ps-row';
    const poseTa = document.createElement('textarea'); poseTa.rows = 3; poseTa.placeholder = 'Pose…'; poseTa.className = 'f';
    const genBtn = document.createElement('button'); genBtn.className = 'b ps-gen'; genBtn.textContent = '▶️ Generate'; genBtn.disabled = true;
    genBtn.addEventListener('click', () => _runGen(card, 'text'));   // text-prompt generation
    poseTa.addEventListener('change', _persistForm);
    r1.appendChild(poseTa); r1.appendChild(genBtn); card.poseTa = poseTa; card.genBtn = genBtn;

    const r2 = document.createElement('div'); r2.className = 'ps-row';
    const note = document.createElement('input'); note.type = 'text'; note.placeholder = 'add to the pose…'; note.className = 'f';
    const aiBtn = document.createElement('button'); aiBtn.className = 'b'; aiBtn.textContent = '⚡ ai-insert'; aiBtn.disabled = true;
    aiBtn.addEventListener('click', () => _aiInsert(card));
    r2.appendChild(note); r2.appendChild(aiBtn); card.note = note; card.aiBtn = aiBtn;

    const r3 = document.createElement('div'); r3.className = 'ps-row';
    const poseBtn = document.createElement('button'); poseBtn.className = 'f ps-posebtn'; poseBtn.textContent = '▾ pick a pose'; poseBtn.style.cssText = 'cursor:pointer;';
    const poseGear = document.createElement('button'); poseGear.className = 'ps-gearbtn'; poseGear.textContent = '⚙'; poseGear.title = 'Pose library — add / manage poses';
    poseGear.addEventListener('click', () => { if (window.openPoseLibrary) window.openPoseLibrary(); else _setStatus('Pose library is on the Character tab.', false); });
    const applyBtn = document.createElement('button'); applyBtn.className = 'b'; applyBtn.textContent = 'Apply'; applyBtn.disabled = true;
    poseBtn.addEventListener('click', () => _openPosePop(card, poseBtn));
    applyBtn.addEventListener('click', () => _applyPose(card));
    r3.appendChild(poseBtn); r3.appendChild(poseGear); r3.appendChild(applyBtn); card.poseBtn = poseBtn; card.applyBtn = applyBtn;

    cb.appendChild(r1); cb.appendChild(r2); cb.appendChild(r3);
    el.appendChild(media); el.appendChild(cb); card.el = el;

    if (_state.gateOn) { genBtn.disabled = false; aiBtn.disabled = false; applyBtn.disabled = false; }
    _state.cards.push(card);
    _refreshImg(card);   // show the base image by default
    return card;
  }

  // ── Floating pose dropdown (over the UI, 10 per row) ──────────────────────────
  function _posePop() {
    if (_state.posePop) return _state.posePop;
    const p = document.createElement('div'); p.className = 'ps-pose-pop'; document.body.appendChild(p); _state.posePop = p;
    _state.posePopOutside = (e) => { if (p.contains(e.target)) return; if (_state.posePopAnchor && _state.posePopAnchor.contains(e.target)) return; _closePosePop(); };
    return p;
  }
  function _closePosePop() { if (_state && _state.posePop) _state.posePop.classList.remove('open'); if (_state && _state.posePopOutside) document.removeEventListener('mousedown', _state.posePopOutside, true); if (_state) _state.posePopAnchor = null; }
  function _openPosePop(card, btn) {
    const p = _posePop();
    if (p.classList.contains('open') && _state.posePopCard === card) { _closePosePop(); return; }
    _state.posePopCard = card; _state.posePopAnchor = btn;
    p.innerHTML = '';
    const poses = _state.poses || [];
    if (!poses.length) { const e = document.createElement('div'); e.className = 'ps-pose-empty'; e.textContent = 'Loading poses…'; p.appendChild(e); }
    poses.forEach(po => {
      const t = document.createElement('div'); t.className = 'ps-posethumb' + (card.appliedPose && card.appliedPose.file === po.file ? ' sel' : ''); t.title = po.label || po.key || '';
      const im = document.createElement('img'); im.loading = 'lazy'; if (window.loadThumb) window.loadThumb(im, po.file); else im.src = po.file; t.appendChild(im);
      t.addEventListener('click', () => {
        // selecting a pose already APPLIES it to this card (Apply/Gen all use it)
        card.appliedPose = { file: po.file, desc: po.desc || '', label: po.label || po.key || '' };
        card.poseBtn.textContent = '✓ ' + (po.label || po.key || 'pose');
        if ((po.desc || '') && !(card.poseTa.value || '').trim()) card.poseTa.value = po.desc;
        _closePosePop();
      });
      p.appendChild(t);
    });
    const r = btn.getBoundingClientRect();
    const w = Math.min(680, window.innerWidth - 16);
    p.style.width = w + 'px';
    p.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + 'px';
    p.classList.add('open');
    const ph = p.offsetHeight;
    if (window.innerHeight - r.bottom > ph + 8 || window.innerHeight - r.bottom > 240) { p.style.top = (r.bottom + 4) + 'px'; p.style.bottom = 'auto'; }
    else { p.style.bottom = (window.innerHeight - r.top + 4) + 'px'; p.style.top = 'auto'; }
    document.addEventListener('mousedown', _state.posePopOutside, true);
  }

  // ── Engine params dropdown (standalone, for the selected i2i engine) ─────────
  function _engPop() {
    if (_state.engPop) return _state.engPop;
    const p = document.createElement('div'); p.className = 'ps-eng-pop'; document.body.appendChild(p); _state.engPop = p;
    _state.engPopOutside = (e) => { if (p.contains(e.target)) return; if (_state.engGear && _state.engGear.contains(e.target)) return; _closeEnginePop(); };
    return p;
  }
  function _closeEnginePop() { if (_state && _state.engPop) _state.engPop.classList.remove('open'); if (_state && _state.engPopOutside) document.removeEventListener('mousedown', _state.engPopOutside, true); }
  function _openEnginePop(btn, engineId, keepOpen) {
    const p = _engPop();
    if (!keepOpen && p.classList.contains('open')) { _closeEnginePop(); return; }
    p.innerHTML = '';
    const title = document.createElement('div'); title.className = 'ps-eng-title';
    const lbl = (window.ENGINE_SCHEMAS && window.ENGINE_SCHEMAS[engineId] && window.ENGINE_SCHEMAS[engineId].label) || engineId;
    title.textContent = '⚙ ' + lbl + ' — parameters'; p.appendChild(title);
    let saved = {}; try { saved = JSON.parse(localStorage.getItem('engine_params__v1__' + engineId) || '{}'); } catch (e) {}
    if (typeof window.buildEngineSettingsRow === 'function') {
      const row = window.buildEngineSettingsRow(engineId, saved, (vals) => { try { localStorage.setItem('engine_params__v1__' + engineId, JSON.stringify(vals)); } catch (e) {} });
      p.appendChild(row.node);
    } else { const e = document.createElement('div'); e.textContent = 'No parameters for this engine.'; p.appendChild(e); }
    const r = btn.getBoundingClientRect(); const w = Math.min(360, window.innerWidth - 16);
    p.style.left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8)) + 'px';
    p.classList.add('open');
    const ph = p.offsetHeight;
    if (window.innerHeight - r.bottom > ph + 8 || window.innerHeight - r.bottom > 260) { p.style.top = (r.bottom + 4) + 'px'; p.style.bottom = 'auto'; }
    else { p.style.bottom = (window.innerHeight - r.top + 4) + 'px'; p.style.top = 'auto'; }
    if (!keepOpen) document.addEventListener('mousedown', _state.engPopOutside, true);
  }

  // Pose dropdown selection already applies the pose to the card (sets appliedPose);
  // the "Apply" button (and Generate) below run the actual generation.
  function _applyPose(card) {
    if (!card.appliedPose) { _openPosePop(card, card.poseBtn); return; }   // none picked -> open the picker
    _runGen(card, 'pose');   // immediately generate the pose × character mix
  }

  function _flip(card, d) { if (!card.variants.length) return; card.vIdx = (card.vIdx + d + card.variants.length) % card.variants.length; _refreshImg(card); }
  function _refreshImg(card) {
    const hasVar = card.variants.length > 0;
    const src = hasVar ? card.variants[card.vIdx] : _state.photoPath;
    if (src) { if (window.loadThumb) window.loadThumb(card.img, src); else card.img.src = _bust(src); card.img.style.display = ''; card.ph.style.display = 'none'; }
    else { card.img.style.display = 'none'; card.ph.style.display = ''; }
    if (hasVar && card.variants.length > 1) { card.arrows.style.display = ''; card.cnt.textContent = (card.vIdx + 1) + '/' + card.variants.length; }
    else card.arrows.style.display = 'none';
  }

  function _setGate(on) { _state.gateOn = on; _state.cards.forEach(c => { c.genBtn.disabled = !on; c.aiBtn.disabled = !on; c.applyBtn.disabled = !on; }); }
  function _setStatus(msg, spin) { if (_state && _state.statusEl) _state.statusEl.innerHTML = (spin ? '⏳ ' : '') + _esc(msg); }

  // Persist the form (appearance/env + per-card pose text) on the obraz so reopening
  // restores it without re-running the analysis. Pose-dropdown selection is NOT saved.
  function _persistForm() {
    try {
      const list = getObrazы(); const o = list.find(x => String(x.id) === String(_state.obraz.id)); if (!o) return;
      o.psForm = {
        appearance: _state.appearanceTa ? _state.appearanceTa.value : '',
        environment: _state.environmentTa ? _state.environmentTa.value : '',
        cards: _state.cards.map(c => ({ pose: c.poseTa.value || '' })),
      };
      window._persistObrazы(list);
    } catch (e) {}
  }

  function _cardBusy(card, label) { card._bs = Date.now(); card._bl = label; card._be = _est(label); card.busy.classList.add('on'); const t = () => { const el = Date.now() - card._bs; const rem = Math.max(0, card._be - el); card.busyT.textContent = rem > 500 ? ('~' + Math.ceil(rem / 1000) + 's') : 'finishing…'; }; t(); card._biv = setInterval(t, 500); }
  function _cardBusyEnd(card, ok) { if (card._biv) { clearInterval(card._biv); card._biv = null; } if (ok && card._bs) _rec(card._bl, Date.now() - card._bs); card.busy.classList.remove('on'); }

  // ── Analysis ─────────────────────────────────────────────────────────────────
  async function _runAnalysis() {
    const st = _state; _setStatus('Analyzing the obraz and environment…', true);
    try {
      const d = await (await fetch('/api/characters/pose-analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imagePath: st.photoPath }) })).json();
      if (_state !== st) return;
      if (!d.success) throw new Error(d.error || 'analyze failed');
      _state.appearanceTa.value = d.appearance || '';
      _state.environmentTa.value = d.environment || '';
      (d.poses || []).slice(0, _state.cards.length).forEach((p, i) => { const c = _state.cards[i]; if (!c) return; c.poseTa.value = p.pose || ''; if (p.examples && p.examples.length) c.note.placeholder = 'e.g.: ' + p.examples.join(' · '); });
      _setStatus('✓ Ready. Edit / pick a pose, then ▶️ Generate (or Gen all).', false);
      _setGate(true);
      _persistForm();
    } catch (e) {
      if (_state !== st) return;
      _setStatus('⚠ Analysis error: ' + e.message + ' — enter poses manually.', false);
      _setGate(true);
    }
  }

  // ── Generation ─────────────────────────────────────────────────────────────
  function _composeText(card) {
    const a = (_state.appearanceTa.value || '').trim(), env = (_state.environmentTa.value || '').trim(), pose = (card.poseTa.value || '').trim();
    return [a, env, pose].filter(Boolean).join('. ');
  }
  function _genAll() { if (!_state.gateOn) { _setStatus('Wait for the analysis to finish.', false); return; } _state.cards.forEach(c => _runGen(c, c.appliedPose ? 'pose' : 'text')); }

  // mode: 'text' (Generate button → prompt) | 'pose' (Apply → mannequin × character mix)
  async function _runGen(card, mode) {
    if (!_state.gateOn) { _setStatus('Wait for the analysis to finish.', false); return; }
    if (card._biv) return;
    if (mode === 'pose' && !card.appliedPose) { _openPosePop(card, card.poseBtn); return; }
    const base = _state.photoPath;
    card.genBtn.disabled = true; card.applyBtn.disabled = true;
    _cardBusy(card, mode === 'pose' ? 'pose-mannequin' : 'pose-text');
    try {
      let imagePath;
      if (mode === 'pose') imagePath = await _genWithMannequin(card, base);
      else {
        const prompt = _composeText(card);
        if (!prompt) { _cardBusyEnd(card, false); _setStatus('⚠ Empty pose.', false); return; }
        imagePath = await _genWithText(base, prompt);
      }
      if (!imagePath) throw new Error('no image');
      card.variants.push(imagePath); card.vIdx = card.variants.length - 1; _refreshImg(card);
      card.genBtn.textContent = '🔄 Regenerate';
      try { window.addObrazPoolEntry && window.addObrazPoolEntry(_state.obraz.id, imagePath, card.id); } catch (e) {}
      _renderPool(); _persistForm();
      _cardBusyEnd(card, true);
    } catch (e) {
      _cardBusyEnd(card, false);
      _setStatus('⚠ Generation failed: ' + (e.message || e), false);
    } finally { card.genBtn.disabled = false; card.applyBtn.disabled = false; }
  }

  function _genWithText(base, prompt) {
    return fetch('/api/characters/pose-generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imagePath: base, prompt, imageEngine: _engine() }) })
      .then(r => r.json()).then(d => { if (!d.success || !d.taskId) throw new Error(d.error || 'no taskId'); return _poll('/api/characters/pose-status/' + encodeURIComponent(d.taskId) + '?obrazId=' + encodeURIComponent(_state.obraz.id)); });
  }
  async function _genWithMannequin(card, base) {
    const pdesc = (card.poseTa.value || '').trim() || (card.appliedPose.desc || '');
    let prompt = '';
    try { const c = await (await fetch('/api/character-creator/pose-compose', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'apply', poseDesc: pdesc }) })).json(); if (c && c.success && c.prompt) prompt = c.prompt; } catch (e) {}
    if (!prompt) prompt = 'Use the FIRST image (a grey artist mannequin) as a composition AND crop mask: keep its camera angle, framing, body pose, subject scale and exact cropping. Render the person from the SECOND image (face, identity, hair, skin, clothing) in that composition, fully replacing the mannequin; if the angle reveals areas not in the second image, plausibly extend the environment. Match the mannequin crop EXACTLY — the SAME body parts inside the frame and the SAME parts cut off at the SAME frame edges (e.g. a hand or arm out of frame); do NOT zoom out to fit the whole body. One photorealistic person, no mannequin, no text.' + (pdesc ? (' Target pose: ' + pdesc + '.') : '');
    const d = await (await fetch('/api/asset-interact/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ activePath: card.appliedPose.file, assetPath: base, prompt, assetType: 'pose', imageEngine: _engine() }) })).json();
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
          if (d.imagePath && (d.state === 'success' || d.success === true)) { clearInterval(iv); _state.polls.delete(iv); resolve(d.imagePath); }
          else if (d.state === 'failed') { clearInterval(iv); _state.polls.delete(iv); reject(new Error(d.error || 'failed')); }
        } catch (e) { /* keep polling */ }
      }, POLL_MS);
      _state.polls.add(iv);
    });
  }

  async function _aiInsert(card) {
    const note = (card.note.value || '').trim(), pose = (card.poseTa.value || '').trim();
    if (!note) { card.note.focus(); return; }
    if (!pose) return;
    const old = card.poseTa.value; card.poseTa.value = '⏳ weaving…';
    try {
      const d = await (await fetch('/api/characters/pose-ai-insert', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pose, note }) })).json();
      if (d.success && d.pose) { card.poseTa.value = d.pose; card.note.value = ''; _persistForm(); }
      else { card.poseTa.value = old; _setStatus('⚠ ai-insert: ' + (d.error || 'error'), false); }
    } catch (e) { card.poseTa.value = old; _setStatus('⚠ ai-insert: ' + e.message, false); }
  }

  // ── Pool ───────────────────────────────────────────────────────────────────
  function _renderPool() {
    if (!_state || !_state.poolGrid) return;
    const pool = (typeof getObrazPool === 'function') ? getObrazPool(_state.obraz.id) : [];
    const ordered = pool.slice().sort((a, b) => (b.final ? 1 : 0) - (a.final ? 1 : 0));   // finals first
    const finals = pool.filter(e => e.final).length, max = window.OBRAZ_FINAL_MAX || 10;
    _state.poolSum.textContent = 'All shots (' + pool.length + ') · finals ' + finals + '/' + max;
    if (!_state.poolDet.dataset.init) { _state.poolDet.open = pool.length > 0; _state.poolDet.dataset.init = '1'; }
    const g = _state.poolGrid; g.innerHTML = '';
    if (!ordered.length) { const e = document.createElement('div'); e.className = 'ps-pool-empty'; e.textContent = 'No generations yet.'; g.appendChild(e); return; }
    ordered.forEach(entry => {
      const it = document.createElement('div'); it.className = 'ps-pool-item' + (entry.final ? ' final' : '');
      const im = document.createElement('img'); im.loading = 'lazy'; if (window.loadThumb) window.loadThumb(im, entry.file); else im.src = _bust(entry.file);
      im.addEventListener('click', () => window.openLightbox && window.openLightbox(entry.file));
      const chk = document.createElement('div'); chk.className = 'ps-chk' + (entry.final ? ' on' : ''); chk.textContent = entry.final ? '✓' : ''; chk.title = 'Mark as a final (saved to the photoshoot)';
      chk.addEventListener('click', (e) => { e.stopPropagation(); const r = window.toggleObrazPoolFinal(_state.obraz.id, entry.file); if (r && r.full) { _setStatus('⚠ Max ' + max + ' finals.', false); return; } _renderPool(); });
      const del = document.createElement('button'); del.className = 'ps-del'; del.textContent = '✕'; del.title = 'Delete this image';
      del.addEventListener('click', (e) => { e.stopPropagation(); if (!confirm('Delete this image?')) return; try { window.deleteObrazPoolEntry(_state.obraz.id, entry.file); } catch (er) {} _state.cards.forEach(c => { const i = c.variants.indexOf(entry.file); if (i >= 0) { c.variants.splice(i, 1); c.vIdx = Math.min(c.vIdx, c.variants.length - 1); _refreshImg(c); } }); _renderPool(); });
      it.appendChild(im); it.appendChild(chk); it.appendChild(del); g.appendChild(it);
    });
  }

  // ── Save ───────────────────────────────────────────────────────────────────
  async function _save() {
    if (!_state) return;
    const obrazId = _state.obraz.id;
    const pool = (typeof getObrazPool === 'function') ? getObrazPool(obrazId) : [];
    if (!pool.length) { _setStatus('⚠ Generate at least one pose first.', false); return; }
    if (_state.saveBtn) _state.saveBtn.disabled = true;
    let charId = _state.charId; const isFlowB = !charId;
    if (isFlowB) {
      _setStatus('💾 Creating the character…', true);
      const eng = _state.obraz.imageEngine || undefined;
      try {
        const cr = await fetch('/api/char-store/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: _state.obraz.name || '', gender: _state.obraz.gender || null, faceImagePath: _state.photoPath, imageEngine: eng, engineParams: (eng && window.getEngineParams) ? window.getEngineParams(eng) : undefined, sourceObrazId: obrazId }) }).then(r => r.json());
        charId = (cr && cr.char && cr.char.id) || null;
      } catch (e) { console.warn('[photoshoot] char create failed:', e.message); }
      if (charId) { try { const l = getObrazы(); const o = l.find(x => String(x.id) === String(obrazId)); if (o) { o.charId = charId; window._persistObrazы(l); } } catch (e) {} try { window._setCurrentCharId && window._setCurrentCharId(charId); } catch (e) {} }
    }
    _state.saved = true;
    try { window.loadObrazы && window.loadObrazы(); window.loadScenarioObrazы && window.loadScenarioObrazы(); window.loadCharCol3Obrazy && window.loadCharCol3Obrazy(); } catch (e) {}
    const onSaved = _state.onSaved; _teardown();
    try { if (isFlowB && charId) window.openCharacterActorPopup && window.openCharacterActorPopup(charId); if (onSaved) onSaved({ obrazId, charId, isNewChar: isFlowB }); } catch (e) {}
  }
})();
