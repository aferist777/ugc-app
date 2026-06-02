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
  let _vidTds = {};       // idx → video <td>
  let _infoEl = null, _progEl = null, _genBtn = null, _mixBtn = null, _vidBtn = null, _allBtn = null;
  let _retryBtn = null, _resumeBtn = null, _lastBulkKind = null, _activeBulk = null, _statusEl = null;
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
    if (cell.chosenImage) return cell.chosenImage;
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

  // ── Image cell (frame thumbnail only; click → preview lightbox) ───────────
  function _renderImageCell(td, idx) {
    if (!td) return;
    const cell = _liveCell(idx);
    td.innerHTML = '';
    const frame = _frameOf(cell);
    if (frame) {
      const img = _el('img', 'e2-thumb e2-thumb-clk'); img.src = frame; img.loading = 'lazy'; img.decoding = 'async';
      img.alt = 'Frame ' + (idx + 1); img.title = 'Click to preview / choose image';
      img.addEventListener('click', () => _openImageLightbox(idx));
      td.appendChild(img);
    } else { td.appendChild(_el('div', 'e2-thumb e2-thumb-empty', '—')); }
  }

  // ── Product cell: [thumb | Mix button] row + interaction dropdown below ────
  function _renderProductCell(td, idx, override) {
    if (!td) return;
    const cell = _liveCell(idx);
    td.innerHTML = '';
    if (cell && cell.detInfo) {
      const box = _el('div', 'e2-prod-cell');
      const top = _el('div', 'e2-prod-top');
      const src = cell.detInfo.thumbPath || cell.detInfo.path;
      if (src) {
        const img = _el('img', 'e2-prod-img'); img.src = src; img.loading = 'lazy';
        img.alt = cell.detInfo.name || 'Product';
        img.title = 'Change product: ' + (cell.detInfo.name || cell.detInfo.file || '');
        img.style.cursor = 'pointer';
        img.addEventListener('click', () => _pickProduct(idx));
        top.appendChild(img);
      }
      // Mix control — right of the product image
      const hasMix = _hasMix(cell);
      const st = override || (hasMix ? 'done' : (cell.taskId ? 'running' : (cell.imageError ? 'error' : 'none')));
      if (st === 'queued' || st === 'running') top.appendChild(_el('span', 'e2-state is-running', st === 'queued' ? '⏳' : '🖼…'));
      else {
        const b = _el('button', 'e2-vbtn' + (st === 'done' ? '' : ' go'));
        if (st === 'done')       { b.textContent = '↻ mix'; b.title = 'Regenerate mix'; }
        else if (st === 'error') { b.textContent = '🖼 Retry'; b.title = cell.imageError || 'Retry mix'; }
        else                     { b.textContent = '🖼 Mix'; b.title = 'Generate mix (character + product)'; }
        b.addEventListener('click', () => _runMix(idx));
        top.appendChild(b);
      }
      box.appendChild(top);
      // Interaction dropdown
      const sel = document.createElement('select'); sel.className = 'e2-inter';
      ((window.EDIT2 && EDIT2.INTERACTIONS) || []).forEach(it => { const o = document.createElement('option'); o.value = it.key; o.textContent = it.label; sel.appendChild(o); });
      sel.value = cell.interaction || 'auto';
      sel.title = 'How the character interacts with the product';
      sel.addEventListener('change', () => {
        window.EDIT2.setInteraction(_key, idx, sel.value);
        if (_hasMix(_liveCell(idx))) _runMix(idx);   // auto-regenerate when a mix already exists
      });
      box.appendChild(sel);
      td.appendChild(box);
    } else if (_itemsMode !== 'noitems') {
      const add = _el('button', 'e2-addprod', '➕'); add.title = 'Add a product to this line';
      add.addEventListener('click', () => _pickProduct(idx));
      td.appendChild(add);
    } else {
      td.appendChild(_el('span', 'e2-state is-na', '—'));
    }
  }

  // Product picker — same lightbox as the character preview, with a project/all
  // toggle and Select / Remove actions.
  function _pickProduct(idx) {
    if (!window.EDIT2 || !EDIT2.getDetails) return;
    EDIT2.getDetails().then(all => {
      if (!all || !all.length) { _setStatus('No products in the library.'); return; }
      const toItems = (list) => list.map(d => ({ url: d.thumbPath || d.path, label: d.name || d.file, det: d }));
      const allItems = toItems(all);
      const projFiles = EDIT2.projectProductFiles ? EDIT2.projectProductFiles(_key) : new Set();
      const projItems = toItems(all.filter(d => projFiles.has(d.file)));
      let mode = projItems.length ? 'project' : 'all';
      const cur = _liveCell(idx); const curUrl = (cur && cur.detInfo) ? (cur.detInfo.thumbPath || cur.detInfo.path) : null;
      const apply = (det, ctx) => { window.EDIT2.setDetInfo(_key, idx, det); _renderProductCell(_detTds[idx], idx); _renderImageCell(_imgTds[idx], idx); _refreshInfo(); ctx.close(); };
      _lightbox({
        load: () => ({ items: (mode === 'project' ? projItems : allItems), startUrl: curUrl }),
        toggle: projItems.length ? { label: () => (mode === 'project' ? ('Show all (' + allItems.length + ')') : ('Show project (' + projItems.length + ')')), fn: (ctx) => { mode = (mode === 'project' ? 'all' : 'project'); ctx.reload(); } } : null,
        actions: () => [
          { label: '✓ Select', primary: true, fn: (it, ctx) => { if (it && it.det) apply(it.det, ctx); else ctx.close(); } },
          { label: '✕ Remove', fn: (it, ctx) => apply(null, ctx) },
        ],
      });
    });
  }

  function _runMix(idx) {
    _renderProductCell(_detTds[idx], idx, 'running');
    window.EDIT2Engine.genMix(_key, idx, {})
      .then(() => { _renderProductCell(_detTds[idx], idx); _renderImageCell(_imgTds[idx], idx); _refreshInfo(); })
      .catch(() => { _renderProductCell(_detTds[idx], idx); });
  }
  function _randomizeImages() {
    const n = (window.EDIT2 && EDIT2.randomizeImages) ? EDIT2.randomizeImages(_key) : 0;
    if (!n) { _setStatus('No variations to shuffle.'); return; }
    Object.keys(_imgTds).forEach(i => _renderImageCell(_imgTds[i], +i));
    _refreshInfo();
    _setStatus('Randomized ' + n + ' image(s).');
  }

  // ── Reusable lightbox: big image + ‹/› + keyboard + filmstrip + action bar ──
  // spec.load() → { items:[{url,label,det?}], startUrl }; spec.actions() →
  // [{label, primary?, fn(item, ctx)}]; spec.toggle? → {label():string, fn(ctx)}.
  // ctx = { close, reload }.
  function _lightbox(spec) {
    const old = document.getElementById('edit2-lightbox'); if (old) old.remove();
    const ov = _el('div'); ov.id = 'edit2-lightbox';
    const box = _el('div', 'e2-lb-box');
    const prev = _el('button', 'e2-lb-nav', '‹');
    const next = _el('button', 'e2-lb-nav', '›');
    const frame = _el('div', 'e2-lb-frame'); const imgEl = _el('img', 'e2-lb-img'); frame.appendChild(imgEl);
    const rowNav = _el('div', 'e2-lb-row'); rowNav.appendChild(prev); rowNav.appendChild(frame); rowNav.appendChild(next);
    const cap = _el('div', 'e2-lb-cap');
    const strip = _el('div', 'e2-lb-strip');
    const bar = _el('div', 'e2-lb-bar');
    let items = [], pos = 0;

    function render() {
      if (!items.length) { imgEl.removeAttribute('src'); cap.textContent = '(empty)'; }
      else { imgEl.src = items[pos].url; cap.textContent = items[pos].label + '  ·  ' + (pos + 1) + '/' + items.length; }
      Array.from(strip.children).forEach((c, i) => c.classList.toggle('active', i === pos));
    }
    function renderStrip() {
      strip.innerHTML = '';
      items.forEach((it, i) => { const t = _el('img', 'e2-lb-thumb'); t.src = it.url; t.title = it.label; t.addEventListener('click', () => { pos = i; render(); }); strip.appendChild(t); });
    }
    function go(d) { if (items.length) { pos = (pos + d + items.length) % items.length; render(); } }
    function close() { ov.remove(); document.removeEventListener('keydown', key, true); }
    function key(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); go(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); go(1); }
    }
    const ctx = { close: close, reload: function () { rebuild(); } };
    function rebuildBar() {
      bar.innerHTML = '';
      if (spec.toggle) { const tb = _el('button', 'e2-btn', spec.toggle.label()); tb.addEventListener('click', () => spec.toggle.fn(ctx)); bar.appendChild(tb); }
      (spec.actions ? spec.actions() : []).forEach(a => { const b = _el('button', 'e2-btn' + (a.primary ? ' primary' : '')); b.textContent = a.label; b.addEventListener('click', () => a.fn(items[pos], ctx)); bar.appendChild(b); });
      const cl = _el('button', 'e2-btn', 'Close'); cl.style.marginLeft = 'auto'; cl.addEventListener('click', close); bar.appendChild(cl);
    }
    function rebuild() {
      const r = spec.load() || {}; items = r.items || [];
      pos = items.findIndex(x => x.url === r.startUrl); if (pos < 0) pos = 0;
      renderStrip(); render(); rebuildBar();
    }
    prev.addEventListener('click', () => go(-1));
    next.addEventListener('click', () => go(1));
    ov.addEventListener('mousedown', e => { if (e.target === ov) close(); });
    document.addEventListener('keydown', key, true);
    box.appendChild(rowNav); box.appendChild(cap); box.appendChild(strip); box.appendChild(bar);
    ov.appendChild(box); document.body.appendChild(ov);
    rebuild();
    return ctx;
  }

  // Per-cell image preview: mix / generated / variations / base → pick (chosenImage).
  function _openImageLightbox(idx) {
    const cell = _liveCell(idx);
    _lightbox({
      load: () => ({ items: ((window.EDIT2 && EDIT2.imageCandidates) ? EDIT2.imageCandidates(_key, idx) : []), startUrl: (cell && cell.chosenImage) || _frameOf(cell) }),
      actions: () => [
        { label: '✓ Use this image', primary: true, fn: (it, ctx) => { if (it) window.EDIT2.setChosenImage(_key, idx, it.url); _renderImageCell(_imgTds[idx], idx); _refreshInfo(); ctx.close(); } },
        { label: '↺ Auto', fn: (it, ctx) => { window.EDIT2.setChosenImage(_key, idx, null); _renderImageCell(_imgTds[idx], idx); _refreshInfo(); ctx.close(); } },
      ],
    });
  }

  // First-frame thumbnail for a generated video (canvas, probe released after
  // drawing → no retained decoder). Sized like the Image-column thumb.
  function _videoThumb(idx, src) {
    const wrap = _el('div', 'e2-vthumb'); wrap.title = 'Play video';
    const canvas = document.createElement('canvas'); canvas.width = 46; canvas.height = 62; canvas.className = 'e2-vthumb-cv';
    wrap.appendChild(canvas);
    wrap.appendChild(_el('div', 'e2-vthumb-play', '▶'));
    const probe = document.createElement('video');
    probe.muted = true; probe.preload = 'metadata'; probe.playsInline = true;
    const draw = () => {
      try { canvas.getContext('2d').drawImage(probe, 0, 0, canvas.width, canvas.height); } catch {}
      try { probe.removeAttribute('src'); probe.load(); } catch {}   // release the decoder
    };
    probe.addEventListener('loadeddata', draw, { once: true });
    probe.addEventListener('error', () => {}, { once: true });
    probe.src = src;
    wrap.addEventListener('click', () => _openVideo(src));
    return wrap;
  }

  // ── Live video cell ───────────────────────────────────────────────────────
  function _renderVideoCell(td, idx, override) {
    if (!td) return;
    const cell = _liveCell(idx);
    td.innerHTML = '';
    let state = override;
    if (!state) {
      if (cell && cell.videoPath) state = 'done';
      else if (cell && (cell.avatarTaskId || cell._videoPending)) state = 'running';
      else if (cell && cell.videoError) state = 'error';
      else state = (cell && cell.audioPath) ? 'none' : 'noaudio';
    }
    if (state === 'done') {
      const wrap = _el('div', 'e2-vdone');
      wrap.appendChild(_videoThumb(idx, cell.videoPath));
      const re = _el('button', 'e2-vbtn', '↻'); re.title = 'Regenerate video'; re.addEventListener('click', () => _runVideo(idx)); wrap.appendChild(re);
      td.appendChild(wrap);
    } else if (state === 'queued')  td.appendChild(_el('span', 'e2-state is-running', '⏳ queued'));
    else if (state === 'running')   td.appendChild(_el('span', 'e2-state is-running', '🎬…'));
    else if (state === 'error') {
      td.appendChild(_el('span', 'e2-state is-error', '✗'));
      const b = _el('button', 'e2-vbtn go', '🎬 Retry'); b.title = (cell && cell.videoError) || 'Retry'; b.addEventListener('click', () => _runVideo(idx)); td.appendChild(b);
    } else if (state === 'noaudio') {
      td.appendChild(_el('span', 'e2-state is-na', 'needs voice'));
    } else {
      const b = _el('button', 'e2-vbtn go', '🎬 Video'); b.title = 'Generate talking-head video'; b.addEventListener('click', () => _runVideo(idx)); td.appendChild(b);
    }
  }
  function _runVideo(idx) {
    const td = _vidTds[idx];
    _renderVideoCell(td, idx, 'running');
    window.EDIT2Engine.genVideo(_key, idx, {})
      .then(() => { _renderVideoCell(td, idx); _refreshInfo(); })
      .catch(() => { _renderVideoCell(td, idx); });
  }

  // ── Bulk runs (one at a time) ─────────────────────────────────────────────
  function _bulkBtns() { return { all: _allBtn, voices: _genBtn, mixes: _mixBtn, videos: _vidBtn }; }
  function _setOthersDisabled(active, on) { const m = _bulkBtns(); Object.keys(m).forEach(k => { if (k !== active && m[k]) m[k].disabled = on; }); }
  function _toggleBulk(kind) {
    if (_activeBulk === kind) { window.EDIT2Engine.stop(_key); return; }
    if (_activeBulk) { _setStatus('Busy — finish the current run first.'); return; }
    if (kind === 'voices') _runVoicesBulk();
    else if (kind === 'mixes') _runMixesBulk();
    else if (kind === 'videos') _runVideosBulk();
    else _runAll();
  }
  function _refreshRow(stage, idx, st) {
    const transient = (st === 'queued' || st === 'running') ? st : undefined;
    if (stage === 'voices') { const w = _voiceWraps[idx]; if (w) _renderVoiceArea(w, idx, transient); }
    else if (stage === 'mixes') { if (_detTds[idx]) _renderProductCell(_detTds[idx], idx, transient); if (_imgTds[idx]) _renderImageCell(_imgTds[idx], idx); }
    else if (stage === 'videos') { const td = _vidTds[idx]; if (td) _renderVideoCell(td, idx, transient); }
  }
  function _runVoicesBulk() {
    _activeBulk = 'voices'; _setOthersDisabled('voices', true); _hideRetry();
    window.EDIT2Engine.genAllVoices(_key, {
      onStart: (n) => { _genBtn.textContent = n ? '⏹ Stop' : '🎙 Voices'; if (!n) _setStatus('All voices already generated.'); },
      onRow: (idx, st) => _refreshRow('voices', idx, st),
      onProgress: (d, t, f) => { _setStatus('Voices ' + d + '/' + t + (f ? ' · ' + f + ' failed' : '') + '…'); _renderProgBar(); },
      onDone: (failed) => _afterBulk('voices', _genBtn, '🎙 Voices', failed),
    });
  }
  function _runMixesBulk() {
    _activeBulk = 'mixes'; _setOthersDisabled('mixes', true); _hideRetry();
    window.EDIT2Engine.genAllMixes(_key, {
      onStart: (n) => { _mixBtn.textContent = n ? '⏹ Stop' : '🖼 Mixes'; if (!n) _setStatus('No products need a mix.'); },
      onRow: (idx, st) => _refreshRow('mixes', idx, st),
      onProgress: (d, t, f) => { _setStatus('Mixes ' + d + '/' + t + (f ? ' · ' + f + ' failed' : '') + '…'); _renderProgBar(); },
      onDone: (failed) => _afterBulk('mixes', _mixBtn, '🖼 Mixes', failed),
    });
  }
  function _runVideosBulk() {
    _activeBulk = 'videos'; _setOthersDisabled('videos', true); _hideRetry();
    window.EDIT2Engine.genAllVideos(_key, {
      onStart: (n) => { _vidBtn.textContent = n ? '⏹ Stop' : '🎬 Videos'; if (!n) _setStatus('No lines ready for video (need voice).'); },
      onRow: (idx, st) => _refreshRow('videos', idx, st),
      onProgress: (d, t, f) => { _setStatus('Videos ' + d + '/' + t + (f ? ' · ' + f + ' failed' : '') + '…'); _renderProgBar(); },
      onDone: (failed) => _afterBulk('videos', _vidBtn, '🎬 Videos', failed),
    });
  }
  function _runAll() {
    _activeBulk = 'all'; _setOthersDisabled('all', true); _allBtn.textContent = '⏹ Stop'; _hideRetry();
    const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
    window.EDIT2Engine.genAll(_key, {
      onPhase: (name) => _setStatus('Phase: ' + cap(name) + '…'),
      onRow: (stage, idx, st) => _refreshRow(stage, idx, st),
      onProgress: (stage, d, t, f) => { _setStatus(cap(stage) + ' ' + d + '/' + t + (f ? ' · ' + f + ' failed' : '') + '…'); _renderProgBar(); },
      onDone: (failed) => { _allBtn.textContent = '▶ Generate all'; _setOthersDisabled('all', false); _activeBulk = null; _refreshInfo(); if (failed > 0) { _lastBulkKind = 'all'; _setStatus(failed + ' failed'); _showRetry(failed); } else { _hideRetry(); _setStatus(''); } },
    });
  }

  function _refreshResumeBtn() {
    if (!_resumeBtn) return;
    if (_activeBulk === 'resume') return; // running — leave as Stop
    const n = (window.EDIT2Engine && EDIT2Engine.inFlight) ? EDIT2Engine.inFlight(_key).length : 0;
    if (n > 0) { _resumeBtn.style.display = ''; _resumeBtn.textContent = '⟳ Resume (' + n + ')'; }
    else _resumeBtn.style.display = 'none';
  }
  function _runResume() {
    if (_activeBulk === 'resume') { window.EDIT2Engine.stop(_key); return; }
    if (_activeBulk) { _setStatus('Busy — finish the current run first.'); return; }
    _activeBulk = 'resume'; _setOthersDisabled('resume', true); _hideRetry(); _resumeBtn.textContent = '⏹ Stop';
    window.EDIT2Engine.resume(_key, {
      onRow: (kind, idx, st) => {
        const transient = (st === 'running' || st === 'queued') ? st : undefined;
        if (kind === 'video') { const td = _vidTds[idx]; if (td) _renderVideoCell(td, idx, transient); }
        else { const td = _imgTds[idx]; if (td) _renderImageCell(td, idx, transient); }
      },
      onProgress: (d, t, f) => { _setStatus('Resuming ' + d + '/' + t + (f ? ' · ' + f + ' failed' : '') + '…'); _renderProgBar(); },
      onDone: (failed) => { _activeBulk = null; _setOthersDisabled('resume', false); _refreshInfo(); if (failed > 0) _setStatus(failed + ' failed'); else _setStatus(''); },
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
    _renderProgBar();
    _refreshResumeBtn();
  }

  function _renderProgBar() {
    if (!_progEl) return;
    const p = (window.EDIT2 && EDIT2.getProject) ? EDIT2.getProject(_key) : null;
    if (!p) return;
    const c = p.counts || {};
    _progEl.innerHTML = '';
    [['Voices', c.voices || 0, c.lines || 0], ['Mixes', c.mixes || 0, c.mixNeed || 0], ['Videos', c.videos || 0, c.lines || 0]].forEach(arr => {
      const lbl = arr[0], d = arr[1], t = arr[2];
      const seg = _el('div', 'e2-progseg');
      seg.appendChild(_el('span', 'e2-progseg-lbl', lbl));
      const bar = _el('div', 'e2-progbar' + (t > 0 && d >= t ? ' full' : ''));
      const fill = _el('i'); fill.style.width = (t > 0 ? Math.round(d / t * 100) : 0) + '%'; bar.appendChild(fill);
      seg.appendChild(bar);
      seg.appendChild(_el('span', 'e2-progseg-num', d + '/' + t));
      _progEl.appendChild(seg);
    });
  }

  function _showRetry(n) { if (_retryBtn) { _retryBtn.style.display = ''; _retryBtn.textContent = '↻ Retry failed (' + n + ')'; } }
  function _hideRetry() { if (_retryBtn) _retryBtn.style.display = 'none'; }
  function _afterBulk(kind, btn, label, failed) {
    btn.textContent = label; _setOthersDisabled(kind, false); _activeBulk = null; _refreshInfo();
    if (failed > 0) { _lastBulkKind = kind; _setStatus(failed + ' failed'); _showRetry(failed); }
    else { _hideRetry(); _setStatus(''); }
  }

  EDIT2Popup.close = function () {
    const ov = document.getElementById('edit2-modal'); if (ov) ov.remove();
    document.removeEventListener('keydown', _onKey);
    _key = null; _itemsMode = null; _obrazChar = null;
    _voiceWraps = {}; _imgTds = {}; _detTds = {}; _vidTds = {}; _colEls = {}; _table = null;
    _infoEl = null; _progEl = null; _genBtn = null; _mixBtn = null; _vidBtn = null; _allBtn = null;
    _retryBtn = null; _resumeBtn = null; _lastBulkKind = null; _activeBulk = null; _statusEl = null;
    if (_lastFocus && _lastFocus.focus) { try { _lastFocus.focus(); } catch {} }
    _lastFocus = null;
  };
  function _onKey(e) { if (e.key === 'Escape') { e.preventDefault(); EDIT2Popup.close(); } }

  function _openNow(sessionKey) {
    const model = (window.EDIT2 && EDIT2.buildWorkspace) ? EDIT2.buildWorkspace(sessionKey) : null;
    if (!model) return;
    EDIT2Popup.close();
    _key = sessionKey; _voiceWraps = {}; _imgTds = {}; _detTds = {}; _vidTds = {};
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

    // Info strip + top progress bar
    _infoEl = _el('div', 'e2-modal-info'); box.appendChild(_infoEl);
    _progEl = _el('div', 'e2-prog-top'); box.appendChild(_progEl);
    _refreshInfo();

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
      if (c.key === 'image') {
        const dice = _el('button', 'e2-dice', '🎲');
        dice.title = 'Randomize images from the образ variations (rows without a mix)';
        if (window.EDIT2 && EDIT2.hasVariations && !EDIT2.hasVariations(_key)) dice.disabled = true;
        dice.addEventListener('click', (e) => { e.stopPropagation(); _randomizeImages(); });
        th.appendChild(dice);
      }
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

      // Video — live (generate / play / state)
      const tdVid = _el('td'); _vidTds[row.idx] = tdVid; _renderVideoCell(tdVid, row.idx);
      tr.appendChild(tdVid);

      tbody.appendChild(tr);
    });
    _table.appendChild(tbody);
    wrap.appendChild(_table); box.appendChild(wrap);
    _applyTableWidth();

    // Footer — Generate all (full pipeline) + per-stage bulk + status + Close
    const foot = _el('div', 'e2-modal-foot');
    _allBtn = _el('button', 'e2-btn primary e2-genall', '▶ Generate all');
    _allBtn.title = 'Voices → mixes → videos for the whole project';
    _allBtn.addEventListener('click', () => _toggleBulk('all')); foot.appendChild(_allBtn);
    _genBtn = _el('button', 'e2-btn e2-genvoices', '🎙 Voices');
    _genBtn.addEventListener('click', () => _toggleBulk('voices')); foot.appendChild(_genBtn);
    _mixBtn = _el('button', 'e2-btn e2-genmixes', '🖼 Mixes');
    _mixBtn.addEventListener('click', () => _toggleBulk('mixes')); foot.appendChild(_mixBtn);
    _vidBtn = _el('button', 'e2-btn e2-genvideos', '🎬 Videos');
    _vidBtn.addEventListener('click', () => _toggleBulk('videos')); foot.appendChild(_vidBtn);
    _statusEl = _el('span', 'e2-foot-status'); foot.appendChild(_statusEl);
    _retryBtn = _el('button', 'e2-btn e2-retry', '↻ Retry failed'); _retryBtn.style.display = 'none';
    _retryBtn.addEventListener('click', () => { if (_lastBulkKind) _toggleBulk(_lastBulkKind); });
    foot.appendChild(_retryBtn);
    _resumeBtn = _el('button', 'e2-btn e2-resume', '⟳ Resume'); _resumeBtn.style.display = 'none';
    _resumeBtn.title = 'Re-attach to tasks left running before reload';
    _resumeBtn.addEventListener('click', _runResume);
    foot.appendChild(_resumeBtn);
    _refreshResumeBtn();
    const closeF = _el('button', 'e2-btn', 'Close'); closeF.style.marginLeft = 'auto';
    closeF.addEventListener('click', EDIT2Popup.close); foot.appendChild(closeF);
    box.appendChild(foot);

    overlay.appendChild(box); document.body.appendChild(overlay);
    document.addEventListener('keydown', _onKey);
    try { xBtn.focus(); } catch {}
  };

  // Public open: materialize cells for fresh/pending projects first (builds lines
  // → cells with random образ variations), then render.
  EDIT2Popup.open = function (sessionKey) {
    if (window.EDIT2 && EDIT2.ensureCells) {
      EDIT2.ensureCells(sessionKey).then(() => _openNow(sessionKey)).catch(() => _openNow(sessionKey));
    } else {
      _openNow(sessionKey);
    }
  };

  window.EDIT2Popup = EDIT2Popup;
})();
