/* ═══════════════════════════════════════════════════════════════════════════
   edit2-popup.js — the Edit v2 workspace popup (window.EDIT2Popup).

   Opened from a project card. Renders, for one session, a scenario TABLE: one
   row per line, with stage columns (image · product/pose · voice · video) plus
   the editable line text.

   Ф1 = read-only shell. Ф2 = VOICES live: editable line text, per-row 🎙
   generate → audio player, and a "Generate voices" bulk button with progress.
   Mixes (Ф3) and video (Ф4) extend the Action column + footer next.
   ═══════════════════════════════════════════════════════════════════════════ */

(function () {
  const EDIT2Popup = {};

  const STAGE_LABEL = { draft: 'Draft', voicing: 'Voicing', voiced: 'Voiced', producing: 'Producing', done: 'Done' };
  const STAGE_COLOR = { draft: '#888', voicing: '#2e86c1', voiced: '#7a5cae', producing: '#c8801a', done: '#1a8a1a' };

  let _key = null;        // current sessionKey
  let _voiceTds = {};     // idx → <td> for live voice-cell updates
  let _imgTds = {};       // idx → <td> for live image/mix-cell updates
  let _detTds = {};       // idx → <td> for live product/pose-cell updates
  let _itemsMode = null;  // 'items' | 'noitems' — whether products are expected
  let _obrazChar = null;  // fallback character image for the frame
  let _infoEl = null;     // info strip element
  let _genBtn = null;     // "Generate voices" button
  let _mixBtn = null;     // "Generate mixes" button
  let _activeBulk = null; // 'voices' | 'mixes' | null — only one bulk run at a time
  let _statusEl = null;   // footer status text
  let _lastFocus = null;

  function _el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function _liveCell(idx) {
    const all = (typeof editFrozenSessions !== 'undefined') ? editFrozenSessions : (window.editFrozenSessions || {});
    const s = all[_key];
    return (s && Array.isArray(s.cells)) ? s.cells[idx] : null;
  }
  function _openVideo(src) {
    if (typeof openVideoPopup === 'function') { try { openVideoPopup(src); return; } catch {} }
    window.open(src, '_blank');
  }
  function _setStatus(msg) { if (_statusEl) _statusEl.textContent = msg || ''; }

  // ── Live voice cell ───────────────────────────────────────────────────────
  //    override forces a transient state (queued|running); otherwise derive from
  //    the persisted cell (done|error|none).
  function _renderVoiceCell(td, idx, override) {
    if (!td) return;
    const cell = _liveCell(idx);
    let state = override;
    if (!state) state = (cell && cell.audioPath) ? 'done' : (cell && cell.audioError) ? 'error' : 'none';
    td.innerHTML = '';

    if (state === 'queued')  { td.appendChild(_el('span', 'e2-state is-running', '⏳ queued')); return; }
    if (state === 'running') { td.appendChild(_el('span', 'e2-state is-running', '🎙 generating…')); return; }

    if (state === 'done') {
      const a = _el('audio', 'e2-audio'); a.controls = true; a.preload = 'none'; a.src = cell.audioPath;
      td.appendChild(a);
      const re = _el('button', 'e2-vbtn', '↻'); re.title = 'Regenerate voice';
      re.addEventListener('click', () => _runOne(idx));
      td.appendChild(re);
      return;
    }
    if (state === 'error') {
      td.appendChild(_el('span', 'e2-state is-error', '✗'));
      const b = _el('button', 'e2-vbtn go', '🎙 Retry'); b.title = (cell && cell.audioError) || 'Retry';
      b.addEventListener('click', () => _runOne(idx));
      td.appendChild(b);
      return;
    }
    // none
    const b = _el('button', 'e2-vbtn go', '🎙 Voice');
    b.title = 'Generate voice for this line';
    b.addEventListener('click', () => _runOne(idx));
    td.appendChild(b);
  }

  function _runOne(idx) {
    const td = _voiceTds[idx];
    _renderVoiceCell(td, idx, 'running');
    window.EDIT2Engine.genVoice(_key, idx, {})
      .then(() => { _renderVoiceCell(td, idx); _refreshInfo(); })
      .catch(() => { _renderVoiceCell(td, idx); });
  }

  // ── Live image / mix cell ─────────────────────────────────────────────────
  function _frameOf(cell) {
    if (!cell) return null;
    if (window.EDIT2Engine && EDIT2Engine.hasMix(cell)) return cell.mixes[cell.detInfo.file];
    return cell.imagePath || cell.charImagePath || _obrazChar || null;
  }
  function _renderImageCell(td, idx, override) {
    if (!td) return;
    const cell = _liveCell(idx);
    td.innerHTML = '';
    const wrap = _el('div', 'e2-imgcell');

    const frame = _frameOf(cell);
    if (frame) {
      const img = _el('img', 'e2-thumb'); img.src = frame; img.loading = 'lazy'; img.decoding = 'async'; img.alt = 'Frame ' + (idx + 1);
      wrap.appendChild(img);
    } else {
      wrap.appendChild(_el('div', 'e2-thumb e2-thumb-empty', '—'));
    }

    // Mix control only for rows that have a product assigned.
    if (cell && cell.detInfo) {
      const hasMix = window.EDIT2Engine && EDIT2Engine.hasMix(cell);
      let state = override;
      if (!state) state = hasMix ? 'done' : (cell.imageError ? 'error' : 'none');
      if (state === 'queued')  wrap.appendChild(_el('span', 'e2-state is-running', '⏳ queued'));
      else if (state === 'running') wrap.appendChild(_el('span', 'e2-state is-running', '🖼 mixing…'));
      else if (state === 'done') {
        const re = _el('button', 'e2-vbtn', '↻ mix'); re.title = 'Regenerate mix';
        re.addEventListener('click', () => _runMix(idx)); wrap.appendChild(re);
      } else if (state === 'error') {
        const b = _el('button', 'e2-vbtn go', '🖼 Retry'); b.title = cell.imageError || 'Retry mix';
        b.addEventListener('click', () => _runMix(idx)); wrap.appendChild(b);
      } else {
        const b = _el('button', 'e2-vbtn go', '🖼 Mix'); b.title = 'Generate mix (character + product)';
        b.addEventListener('click', () => _runMix(idx)); wrap.appendChild(b);
      }
    }
    td.appendChild(wrap);
  }
  function _runMix(idx) {
    const td = _imgTds[idx];
    _renderImageCell(td, idx, 'running');
    window.EDIT2Engine.genMix(_key, idx, {})
      .then(() => { _renderImageCell(td, idx); _refreshInfo(); })
      .catch(() => { _renderImageCell(td, idx); });
  }

  // ── Live product / pose cell (assign or change the product) ───────────────
  function _renderDetailCell(td, idx) {
    if (!td) return;
    const cell = _liveCell(idx);
    td.innerHTML = '';
    if (cell && cell.detInfo) {
      const d = _el('div', 'e2-det'); d.style.cursor = 'pointer'; d.title = 'Change product';
      if (cell.detInfo.thumbPath || cell.detInfo.path) {
        const di = _el('img'); di.src = cell.detInfo.thumbPath || cell.detInfo.path; di.loading = 'lazy'; di.alt = cell.detInfo.name || 'Product';
        d.appendChild(di);
      }
      d.appendChild(_el('span', null, cell.detInfo.name || 'Product'));
      d.addEventListener('click', () => _pickProduct(idx, d));
      td.appendChild(d);
    } else if (_itemsMode !== 'noitems') {
      const b = _el('button', 'e2-addprod', '➕'); b.title = 'Add a product to this line';
      b.addEventListener('click', () => _pickProduct(idx, b));
      td.appendChild(b);
    } else {
      td.appendChild(_el('span', 'e2-state is-na', '—'));
    }
  }
  function _pickProduct(idx, anchorEl) {
    if (typeof openDetailPicker !== 'function') { _setStatus('Picker unavailable.'); return; }
    window.EDIT2.getDetails().then(items => {
      if (!items || !items.length) { _setStatus('No products in the library.'); return; }
      const cur = _liveCell(idx);
      const curFile = (cur && cur.detInfo) ? cur.detInfo.file : null;
      openDetailPicker(items, anchorEl, curFile, (chosen) => {
        window.EDIT2.setDetInfo(_key, idx, chosen || null);
        _renderDetailCell(_detTds[idx], idx);
        _renderImageCell(_imgTds[idx], idx);   // mix control appears/disappears
        _refreshInfo();
      });
    });
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
      onRow: (idx, st) => { const td = _voiceTds[idx]; if (td) _renderVoiceCell(td, idx, (st === 'queued' || st === 'running') ? st : undefined); },
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
    const bits = [
      p.obrazName ? ('Character: ' + p.obrazName) : null,
      'Scenario: ' + (p.scenName || '—'),
      'Voices ' + (c.voices || 0) + '/' + (c.lines || 0),
      'Mixes ' + (c.mixes || 0) + '/' + (c.mixNeed || 0),
      'Videos ' + (c.videos || 0) + '/' + (c.lines || 0),
    ].filter(Boolean);
    bits.forEach((t, i) => {
      if (i) _infoEl.appendChild(_el('span', 'e2-sep', '·'));
      _infoEl.appendChild(_el('span', null, t));
    });
  }

  EDIT2Popup.close = function () {
    const ov = document.getElementById('edit2-modal');
    if (ov) ov.remove();
    document.removeEventListener('keydown', _onKey);
    _key = null; _voiceTds = {}; _imgTds = {}; _detTds = {}; _itemsMode = null; _obrazChar = null;
    _infoEl = null; _genBtn = null; _mixBtn = null; _activeBulk = null; _statusEl = null;
    if (_lastFocus && _lastFocus.focus) { try { _lastFocus.focus(); } catch {} }
    _lastFocus = null;
  };

  function _onKey(e) { if (e.key === 'Escape') { e.preventDefault(); EDIT2Popup.close(); } }

  EDIT2Popup.open = function (sessionKey) {
    const model = (window.EDIT2 && EDIT2.buildWorkspace) ? EDIT2.buildWorkspace(sessionKey) : null;
    if (!model) return;
    EDIT2Popup.close();
    _key = sessionKey; _voiceTds = {}; _imgTds = {}; _detTds = {};
    _itemsMode = model.itemsMode || null;
    _obrazChar = (model.obraz && model.obraz.char) || null;
    _lastFocus = document.activeElement;

    const overlay = _el('div'); overlay.id = 'edit2-modal';
    overlay.addEventListener('mousedown', e => { if (e.target === overlay) EDIT2Popup.close(); });

    const box = _el('div', 'e2-modal-box');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', 'Project workspace: ' + model.title);

    // Header
    const head = _el('div', 'e2-modal-head');
    const chip = _el('span', 'e2-chip', STAGE_LABEL[model.stage] || model.stage);
    chip.style.background = STAGE_COLOR[model.stage] || '#888'; chip.style.color = '#fff';
    head.appendChild(chip);
    head.appendChild(_el('b', null, model.title));
    const xBtn = _el('button', 'e2-modal-x', '✕'); xBtn.title = 'Close';
    xBtn.addEventListener('click', EDIT2Popup.close);
    head.appendChild(xBtn);
    box.appendChild(head);

    // Info strip
    _infoEl = _el('div', 'e2-modal-info');
    box.appendChild(_infoEl);
    _refreshInfo();

    // Table
    const wrap = _el('div', 'e2-table-wrap');
    const table = _el('table', 'e2-table');
    const thead = _el('thead');
    const htr = _el('tr');
    ['#', 'Line', 'Image', 'Product / Pose', 'Voice', 'Video', 'Action'].forEach(h => htr.appendChild(_el('th', null, h)));
    thead.appendChild(htr);
    table.appendChild(thead);

    const tbody = _el('tbody');
    model.rows.forEach(row => {
      const tr = _el('tr', 'e2-row' + (row.excluded ? ' excluded' : ''));
      tr.appendChild(_el('td', 'e2-num', String(row.idx + 1)));

      // Line — editable
      const tdLine = _el('td');
      const ta = _el('textarea', 'e2-line-edit'); ta.rows = 2; ta.value = row.line || '';
      ta.addEventListener('change', () => { window.EDIT2 && EDIT2.setLine(_key, row.idx, ta.value); });
      tdLine.appendChild(ta);
      tr.appendChild(tdLine);

      // Image — live (frame + mix control for rows with a product)
      const tdImg = _el('td');
      _imgTds[row.idx] = tdImg;
      _renderImageCell(tdImg, row.idx);
      tr.appendChild(tdImg);

      // Product / Pose — live (➕ to add, click to change)
      const tdDet = _el('td');
      _detTds[row.idx] = tdDet;
      _renderDetailCell(tdDet, row.idx);
      tr.appendChild(tdDet);

      // Voice — live
      const tdVoice = _el('td');
      _voiceTds[row.idx] = tdVoice;
      _renderVoiceCell(tdVoice, row.idx);
      tr.appendChild(tdVoice);

      // Video — read-only (Ф4)
      const tdVid = _el('td');
      if (row.videoPath) {
        const v = _el('button', 'e2-vidbtn', '▶ play'); v.title = 'Play video';
        v.addEventListener('click', () => _openVideo(row.videoPath));
        tdVid.appendChild(v);
      } else if (row.videoState === 'running') { tdVid.appendChild(_el('span', 'e2-state is-running', '⏳')); }
      else if (row.videoState === 'error') { tdVid.appendChild(_el('span', 'e2-state is-error', '✗ ' + (row.videoError || 'error').slice(0, 30))); }
      else { tdVid.appendChild(_el('span', 'e2-state is-none', '—')); }
      tr.appendChild(tdVid);

      // Action — placeholder (mix/video wired in Ф3/Ф4)
      const tdAct = _el('td');
      const act = _el('button', 'e2-btn', '🗣'); act.disabled = true; act.title = 'Mix + video wired in next phases';
      tdAct.appendChild(act);
      tr.appendChild(tdAct);

      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    box.appendChild(wrap);

    // Footer — bulk Generate voices / mixes + status + Close
    const foot = _el('div', 'e2-modal-foot');
    _genBtn = _el('button', 'e2-btn e2-genvoices', '🎙 Generate voices');
    _genBtn.addEventListener('click', () => _toggleBulk('voices'));
    foot.appendChild(_genBtn);
    _mixBtn = _el('button', 'e2-btn e2-genmixes', '🖼 Generate mixes');
    _mixBtn.addEventListener('click', () => _toggleBulk('mixes'));
    foot.appendChild(_mixBtn);
    _statusEl = _el('span', 'e2-foot-status'); foot.appendChild(_statusEl);
    const closeF = _el('button', 'e2-btn', 'Close'); closeF.style.marginLeft = 'auto';
    closeF.addEventListener('click', EDIT2Popup.close);
    foot.appendChild(closeF);
    box.appendChild(foot);

    overlay.appendChild(box);
    document.body.appendChild(overlay);
    document.addEventListener('keydown', _onKey);
    try { xBtn.focus(); } catch {}
  };

  window.EDIT2Popup = EDIT2Popup;
})();
