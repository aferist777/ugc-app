/* ═══════════════════════════════════════════════════════════════════════════
   edit2-popup.js — the Edit v2 workspace popup (window.EDIT2Popup).

   One row per scenario line. Columns: # · Line · Image · Video.
   - Line cell: editable text on top; below it the voice playback (gray, disabled
     placeholder until generated) with the 🎙 generate button to its right.
   - Image cell: frame thumbnail with the mix/add controls to the right and the
     product name underneath.
   - Video cell: play / state (generation wired in Ф4).
   Columns are resizable; widths persist globally (all projects) in localStorage.
   ═══════════════════════════════════════════════════════════════════════════ */

(function () {
  const EDIT2Popup = {};

  const STAGE_LABEL = { draft: 'Draft', voicing: 'Voicing', voiced: 'Voiced', producing: 'Producing', done: 'Done' };
  const STAGE_COLOR = { draft: '#888', voicing: '#2e86c1', voiced: '#7a5cae', producing: '#c8801a', done: '#1a8a1a' };

  // Column model — def width + min; widths saved globally.
  const COLS = [
    { key: 'num',     label: '#',       def: 38,  min: 28 },
    { key: 'line',    label: 'Line',    def: 300, min: 170 },
    { key: 'image',   label: 'Image',   def: 150, min: 90 },
    { key: 'product', label: 'Product', def: 110, min: 70 },
    { key: 'video',   label: 'Video',   def: 110, min: 80 },
  ];
  const COL_LS = 'edit2_col_widths_v1';
  function _loadColW() { try { return JSON.parse(localStorage.getItem(COL_LS) || '{}'); } catch { return {}; } }
  function _saveColW(w) { try { localStorage.setItem(COL_LS, JSON.stringify(w)); } catch {} }
  function _colW(key) { const w = _loadColW(); const c = COLS.find(x => x.key === key); return w[key] || (c ? c.def : 100); }

  let _key = null, _itemsMode = null, _obrazChar = null;
  let _voiceWraps = {};   // idx → voice-area container (under the line text)
  let _imgTds = {};       // idx → image <td>
  let _detTds = {};       // idx → product <td>
  let _infoEl = null, _genBtn = null, _mixBtn = null, _activeBulk = null, _statusEl = null;
  let _colEls = {}, _table = null, _lastFocus = null;

  function _el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function _liveCell(idx) {
    const all = (typeof editFrozenSessions !== 'undefined') ? editFrozenSessions : (window.editFrozenSessions || {});
    const s = all[_key];
    return (s && Array.isArray(s.cells)) ? s.cells[idx] : null;
  }
  function _openVideo(src) { if (typeof openVideoPopup === 'function') { try { openVideoPopup(src); return; } catch {} } window.open(src, '_blank'); }
  function _setStatus(msg) { if (_statusEl) _statusEl.textContent = msg || ''; }
  function _hasMix(cell) { return !!(window.EDIT2Engine && EDIT2Engine.hasMix && EDIT2Engine.hasMix(cell)); }
  function _frameOf(cell) {
    if (!cell) return null;
    if (_hasMix(cell)) return cell.mixes[cell.detInfo.file];
    return cell.imagePath || cell.charImagePath || _obrazChar || null;
  }

  // ── Columns / resize ──────────────────────────────────────────────────────
  function _applyTableWidth() {
    if (!_table) return;
    let total = 0;
    COLS.forEach(c => { total += _colEls[c.key] ? (parseInt(_colEls[c.key].style.width, 10) || c.def) : c.def; });
    _table.style.width = total + 'px';
  }
  function _buildColgroup() {
    const cg = _el('colgroup');
    _colEls = {};
    COLS.forEach(c => { const col = _el('col'); col.style.width = _colW(c.key) + 'px'; _colEls[c.key] = col; cg.appendChild(col); });
    return cg;
  }
  function _attachResize(handle, col) {
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault(); e.stopPropagation();
      const colEl = _colEls[col.key];
      const startX = e.clientX, startW = parseInt(colEl.style.width, 10) || col.def;
      const mv = (ev) => { const w = Math.max(col.min, startW + (ev.clientX - startX)); colEl.style.width = w + 'px'; _applyTableWidth(); };
      const up = () => {
        document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up);
        const wmap = _loadColW(); wmap[col.key] = parseInt(colEl.style.width, 10) || col.def; _saveColW(wmap);
      };
      document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
    });
  }

  // ── Voice area (under the line text) ──────────────────────────────────────
  function _renderVoiceArea(wrap, idx, override) {
    if (!wrap) return;
    const cell = _liveCell(idx);
    let state = override;
    if (!state) state = (cell && cell.audioPath) ? 'done' : (cell && cell.audioError) ? 'error' : 'none';
    wrap.innerHTML = '';

    // Left: playback (real audio when done, gray disabled placeholder otherwise)
    if (state === 'done') {
      const a = _el('audio', 'e2-audio'); a.controls = true; a.preload = 'none'; a.src = cell.audioPath;
      wrap.appendChild(a);
    } else {
      const ph = _el('div', 'e2-audio-ph');
      ph.textContent = state === 'running' ? '🎙 generating…' : (state === 'queued' ? '⏳ queued' : '— no voice —');
      wrap.appendChild(ph);
    }

    // Right: generate / regenerate / retry button
    const btn = _el('button', 'e2-vbtn' + (state === 'done' ? '' : ' go'));
    if (state === 'done')        { btn.textContent = '↻'; btn.title = 'Regenerate voice'; }
    else if (state === 'error')  { btn.textContent = '🎙 Retry'; btn.title = (cell && cell.audioError) || 'Retry'; }
    else if (state === 'running' || state === 'queued') { btn.textContent = '⏳'; btn.disabled = true; }
    else                         { btn.textContent = '🎙'; btn.title = 'Generate voice for this line'; }
    if (!btn.disabled) btn.addEventListener('click', () => _runOne(idx));
    wrap.appendChild(btn);
  }
  function _runOne(idx) {
    const wrap = _voiceWraps[idx];
    _renderVoiceArea(wrap, idx, 'running');
    window.EDIT2Engine.genVoice(_key, idx, {})
      .then(() => { _renderVoiceArea(wrap, idx); _refreshInfo(); })
      .catch(() => { _renderVoiceArea(wrap, idx); });
  }

  // ── Image cell (frame thumbnail + mix control to the right) ───────────────
  function _renderImageCell(td, idx, override) {
    if (!td) return;
    const cell = _liveCell(idx);
    td.innerHTML = '';
    const row = _el('div', 'e2-imgcell-row');
    const frame = _frameOf(cell);
    if (frame) { const img = _el('img', 'e2-thumb'); img.src = frame; img.loading = 'lazy'; img.decoding = 'async'; img.alt = 'Frame ' + (idx + 1); row.appendChild(img); }
    else { row.appendChild(_el('div', 'e2-thumb e2-thumb-empty', '—')); }

    if (cell && cell.detInfo) {                 // mix control only for rows with a product
      const ctrls = _el('div', 'e2-img-ctrls');
      const hasMix = _hasMix(cell);
      let state = override || (hasMix ? 'done' : (cell.imageError ? 'error' : 'none'));
      if (state === 'queued' || state === 'running') ctrls.appendChild(_el('span', 'e2-state is-running', state === 'queued' ? '⏳' : '🖼…'));
      else {
        const b = _el('button', 'e2-vbtn' + (state === 'done' ? '' : ' go'));
        if (state === 'done')       { b.textContent = '↻ mix'; b.title = 'Regenerate mix'; }
        else if (state === 'error') { b.textContent = '🖼 Retry'; b.title = cell.imageError || 'Retry mix'; }
        else                        { b.textContent = '🖼 Mix'; b.title = 'Generate mix (character + product)'; }
        b.addEventListener('click', () => _runMix(idx));
        ctrls.appendChild(b);
      }
      row.appendChild(ctrls);
    }
    td.appendChild(row);
  }

  // ── Product cell (product thumbnail with its name underneath; ➕ to add) ───
  function _renderProductCell(td, idx) {
    if (!td) return;
    const cell = _liveCell(idx);
    td.innerHTML = '';
    if (cell && cell.detInfo) {
      const box = _el('div', 'e2-prod-cell');
      const src = cell.detInfo.thumbPath || cell.detInfo.path;
      if (src) { const img = _el('img', 'e2-prod-img'); img.src = src; img.loading = 'lazy'; img.alt = cell.detInfo.name || 'Product'; box.appendChild(img); }
      const nm = _el('div', 'e2-prodname', cell.detInfo.name || (cell.detInfo.file || 'Product'));
      box.appendChild(nm);
      box.title = 'Change product'; box.style.cursor = 'pointer';
      box.addEventListener('click', () => _pickProduct(idx, box));
      td.appendChild(box);
    } else if (_itemsMode !== 'noitems') {
      const add = _el('button', 'e2-addprod', '➕'); add.title = 'Add a product to this line';
      add.addEventListener('click', () => _pickProduct(idx, add));
      td.appendChild(add);
    } else {
      td.appendChild(_el('span', 'e2-state is-na', '—'));
    }
  }
  function _pickProduct(idx, anchorEl) {
    if (typeof openDetailPicker !== 'function') { _setStatus('Picker unavailable.'); return; }
    window.EDIT2.getDetails().then(items => {
      if (!items || !items.length) { _setStatus('No products in the library.'); return; }
      const cur = _liveCell(idx); const curFile = (cur && cur.detInfo) ? cur.detInfo.file : null;
      openDetailPicker(items, anchorEl, curFile, (chosen) => {
        window.EDIT2.setDetInfo(_key, idx, chosen || null);
        _renderProductCell(_detTds[idx], idx);
        _renderImageCell(_imgTds[idx], idx);   // mix control appears/disappears
        _refreshInfo();
      });
    });
  }
  function _runMix(idx) {
    const td = _imgTds[idx];
    _renderImageCell(td, idx, 'running');
    window.EDIT2Engine.genMix(_key, idx, {})
      .then(() => { _renderImageCell(td, idx); _refreshInfo(); })
      .catch(() => { _renderImageCell(td, idx); });
  }

  // ── Bulk runs (one at a time) ─────────────────────────────────────────────
  function _toggleBulk(kind) {
    if (_activeBulk === kind) { window.EDIT2Engine.stop(_key); return; }
    if (_activeBulk) { _setStatus('Busy — finish the current run first.'); return; }
    if (kind === 'voices') _runVoicesBulk(); else _runMixesBulk();
  }
  function _runVoicesBulk() {
    _activeBulk = 'voices'; if (_mixBtn) _mixBtn.disabled = true;
    window.EDIT2Engine.genAllVoices(_key, {
      onStart: (n) => { _genBtn.textContent = n ? '⏹ Stop' : '🎙 Generate voices'; if (!n) _setStatus('All voices already generated.'); },
      onRow: (idx, st) => { const w = _voiceWraps[idx]; if (w) _renderVoiceArea(w, idx, (st === 'queued' || st === 'running') ? st : undefined); },
      onProgress: (d, t) => _setStatus('Voices ' + d + '/' + t + '…'),
      onDone: () => { _genBtn.textContent = '🎙 Generate voices'; if (_mixBtn) _mixBtn.disabled = false; _activeBulk = null; _refreshInfo(); },
    });
  }
  function _runMixesBulk() {
    _activeBulk = 'mixes'; if (_genBtn) _genBtn.disabled = true;
    window.EDIT2Engine.genAllMixes(_key, {
      onStart: (n) => { _mixBtn.textContent = n ? '⏹ Stop' : '🖼 Generate mixes'; if (!n) _setStatus('No products need a mix.'); },
      onRow: (idx, st) => { const td = _imgTds[idx]; if (td) _renderImageCell(td, idx, (st === 'queued' || st === 'running') ? st : undefined); },
      onProgress: (d, t) => _setStatus('Mixes ' + d + '/' + t + '…'),
      onDone: () => { _mixBtn.textContent = '🖼 Generate mixes'; if (_genBtn) _genBtn.disabled = false; _activeBulk = null; _refreshInfo(); },
    });
  }

  function _refreshInfo() {
    if (!_infoEl) return;
    const p = (window.EDIT2 && EDIT2.getProject) ? EDIT2.getProject(_key) : null;
    if (!p) return;
    const c = p.counts || {};
    _infoEl.innerHTML = '';
    [
      p.obrazName ? ('Character: ' + p.obrazName) : null,
      'Scenario: ' + (p.scenName || '—'),
      'Voices ' + (c.voices || 0) + '/' + (c.lines || 0),
      'Mixes ' + (c.mixes || 0) + '/' + (c.mixNeed || 0),
      'Videos ' + (c.videos || 0) + '/' + (c.lines || 0),
    ].filter(Boolean).forEach((t, i) => { if (i) _infoEl.appendChild(_el('span', 'e2-sep', '·')); _infoEl.appendChild(_el('span', null, t)); });
  }

  EDIT2Popup.close = function () {
    const ov = document.getElementById('edit2-modal'); if (ov) ov.remove();
    document.removeEventListener('keydown', _onKey);
    _key = null; _itemsMode = null; _obrazChar = null;
    _voiceWraps = {}; _imgTds = {}; _detTds = {}; _colEls = {}; _table = null;
    _infoEl = null; _genBtn = null; _mixBtn = null; _activeBulk = null; _statusEl = null;
    if (_lastFocus && _lastFocus.focus) { try { _lastFocus.focus(); } catch {} }
    _lastFocus = null;
  };
  function _onKey(e) { if (e.key === 'Escape') { e.preventDefault(); EDIT2Popup.close(); } }

  EDIT2Popup.open = function (sessionKey) {
    const model = (window.EDIT2 && EDIT2.buildWorkspace) ? EDIT2.buildWorkspace(sessionKey) : null;
    if (!model) return;
    EDIT2Popup.close();
    _key = sessionKey; _voiceWraps = {}; _imgTds = {}; _detTds = {};
    _itemsMode = model.itemsMode || null;
    _obrazChar = (model.obraz && model.obraz.char) || null;
    _lastFocus = document.activeElement;

    const overlay = _el('div'); overlay.id = 'edit2-modal';
    overlay.addEventListener('mousedown', e => { if (e.target === overlay) EDIT2Popup.close(); });

    const box = _el('div', 'e2-modal-box');
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', 'Project workspace: ' + model.title);

    // Header
    const head = _el('div', 'e2-modal-head');
    const chip = _el('span', 'e2-chip', STAGE_LABEL[model.stage] || model.stage);
    chip.style.background = STAGE_COLOR[model.stage] || '#888'; chip.style.color = '#fff';
    head.appendChild(chip);
    head.appendChild(_el('b', null, model.title));
    const xBtn = _el('button', 'e2-modal-x', '✕'); xBtn.title = 'Close';
    xBtn.addEventListener('click', EDIT2Popup.close); head.appendChild(xBtn);
    box.appendChild(head);

    // Info strip
    _infoEl = _el('div', 'e2-modal-info'); box.appendChild(_infoEl); _refreshInfo();

    // Project settings (collapsible accordion at the top)
    if (window.EDIT2Settings) {
      const bar = _el('div', 'e2-set-bar');
      const caret = _el('span', 'e2-set-caret', '▸');
      bar.appendChild(caret);
      bar.appendChild(_el('span', 'e2-set-label', '⚙ Project settings'));
      const sum = _el('span', 'e2-set-summary');
      bar.appendChild(sum);
      const body = _el('div', 'e2-set-body'); body.style.display = 'none';
      const built = EDIT2Settings.build(_key, () => { sum.textContent = built.summary(); });
      body.appendChild(built.node);
      sum.textContent = built.summary();
      bar.addEventListener('click', () => {
        const opening = body.style.display === 'none';
        body.style.display = opening ? 'flex' : 'none';
        caret.textContent = opening ? '▾' : '▸';
      });
      box.appendChild(bar); box.appendChild(body);
    }

    // Table
    const wrap = _el('div', 'e2-table-wrap');
    _table = _el('table', 'e2-table');
    _table.appendChild(_buildColgroup());

    const thead = _el('thead');
    const htr = _el('tr');
    COLS.forEach(c => {
      const th = _el('th', 'e2-th', c.label);
      const handle = _el('div', 'e2-th-resize'); _attachResize(handle, c); th.appendChild(handle);
      htr.appendChild(th);
    });
    thead.appendChild(htr); _table.appendChild(thead);

    const tbody = _el('tbody');
    model.rows.forEach(row => {
      const tr = _el('tr', 'e2-row' + (row.excluded ? ' excluded' : ''));

      // # number
      tr.appendChild(_el('td', 'e2-num', String(row.idx + 1)));

      // Line: editable text + voice area underneath
      const tdLine = _el('td');
      const ta = _el('textarea', 'e2-line-edit'); ta.rows = 2; ta.value = row.line || '';
      ta.addEventListener('change', () => { window.EDIT2 && EDIT2.setLine(_key, row.idx, ta.value); });
      tdLine.appendChild(ta);
      const vWrap = _el('div', 'e2-voicebar'); _voiceWraps[row.idx] = vWrap;
      _renderVoiceArea(vWrap, row.idx); tdLine.appendChild(vWrap);
      tr.appendChild(tdLine);

      // Image (frame + mix control)
      const tdImg = _el('td'); _imgTds[row.idx] = tdImg; _renderImageCell(tdImg, row.idx);
      tr.appendChild(tdImg);

      // Product (thumbnail + name underneath, ➕ to add)
      const tdDet = _el('td'); _detTds[row.idx] = tdDet; _renderProductCell(tdDet, row.idx);
      tr.appendChild(tdDet);

      // Video — read-only (Ф4)
      const tdVid = _el('td');
      if (row.videoPath) { const v = _el('button', 'e2-vidbtn', '▶ play'); v.title = 'Play video'; v.addEventListener('click', () => _openVideo(row.videoPath)); tdVid.appendChild(v); }
      else if (row.videoState === 'running') tdVid.appendChild(_el('span', 'e2-state is-running', '⏳'));
      else if (row.videoState === 'error') tdVid.appendChild(_el('span', 'e2-state is-error', '✗ ' + (row.videoError || 'error').slice(0, 30)));
      else tdVid.appendChild(_el('span', 'e2-state is-none', '—'));
      tr.appendChild(tdVid);

      tbody.appendChild(tr);
    });
    _table.appendChild(tbody);
    wrap.appendChild(_table); box.appendChild(wrap);
    _applyTableWidth();

    // Footer — bulk Generate voices / mixes + status + Close
    const foot = _el('div', 'e2-modal-foot');
    _genBtn = _el('button', 'e2-btn e2-genvoices', '🎙 Generate voices');
    _genBtn.addEventListener('click', () => _toggleBulk('voices')); foot.appendChild(_genBtn);
    _mixBtn = _el('button', 'e2-btn e2-genmixes', '🖼 Generate mixes');
    _mixBtn.addEventListener('click', () => _toggleBulk('mixes')); foot.appendChild(_mixBtn);
    _statusEl = _el('span', 'e2-foot-status'); foot.appendChild(_statusEl);
    const closeF = _el('button', 'e2-btn', 'Close'); closeF.style.marginLeft = 'auto';
    closeF.addEventListener('click', EDIT2Popup.close); foot.appendChild(closeF);
    box.appendChild(foot);

    overlay.appendChild(box); document.body.appendChild(overlay);
    document.addEventListener('keydown', _onKey);
    try { xBtn.focus(); } catch {}
  };

  window.EDIT2Popup = EDIT2Popup;
})();
