/* ═══════════════════════════════════════════════════════════════════════════
   edit2-product-manager.js — per-project PRODUCT manager for the Edit² popup.

   Opened from the 🔧 button in the "Product" column header. A body-appended
   dropdown panel with three tabs:

     • Gallery — every item in the shared library (/api/details). Click a thumb
       to toggle whether it belongs to THIS project; the per-row ➕ picker then
       defaults to the project's items. 🗑 deletes an item from the library.
     • Upload  — manually upload an item image into the library (auto-marked).
     • AI      — extract a prop list from THIS project's scenario, then generate
       each item image (beautify → image gen → commit), auto-marked for the project.

   API:  window.EditProductManager.open(anchorEl, sessionKey, scenFile, onChange)
   onChange() fires whenever library membership / items change so the popup can
   re-render the product cells.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  const PM = {};
  let _panel = null, _anchor = null, _docDown = null;
  let _key = null, _scenFile = null, _onChange = null, _tab = 'gallery';

  function _el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function _fire() { try { _onChange && _onChange(); } catch {} }

  function _injectCss() {
    if (document.getElementById('e2-pm-styles')) return;
    const st = document.createElement('style'); st.id = 'e2-pm-styles';
    st.textContent = `
.e2-pm-panel{position:fixed;z-index:10098;width:340px;max-width:94vw;background:#fff;border:1px solid #888;border-radius:8px;box-shadow:0 14px 40px rgba(0,0,0,.42);display:flex;flex-direction:column;overflow:hidden;font-size:12px;color:#222}
.e2-pm-head{display:flex;align-items:center;gap:6px;padding:7px 9px;background:#2e86c1;color:#fff}
.e2-pm-head b{flex:1;font-size:12px}
.e2-pm-x{border:none;background:transparent;color:#fff;font-size:14px;cursor:pointer;line-height:1;padding:2px 4px}
.e2-pm-tabs{display:flex;border-bottom:1px solid #ddd;background:#f4f4f4}
.e2-pm-tab{flex:1;border:none;background:transparent;padding:7px 4px;font-size:11px;cursor:pointer;color:#555;border-bottom:2px solid transparent}
.e2-pm-tab.on{color:#1a6699;font-weight:bold;border-bottom-color:#2e86c1;background:#fff}
.e2-pm-body{padding:9px;max-height:60vh;overflow:auto}
.e2-pm-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:7px}
.e2-pm-item{position:relative;border:2px solid transparent;border-radius:6px;overflow:hidden;cursor:pointer;background:#111;aspect-ratio:1/1}
.e2-pm-item img{width:100%;height:100%;object-fit:cover;display:block}
.e2-pm-item.sel{border-color:#2e86c1;box-shadow:0 0 0 1px #2e86c1}
.e2-pm-check{position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:rgba(0,0,0,.45);color:#fff;font-size:12px;display:flex;align-items:center;justify-content:center}
.e2-pm-item.sel .e2-pm-check{background:#2e86c1}
.e2-pm-del{position:absolute;top:3px;right:3px;width:18px;height:18px;border-radius:4px;border:none;background:rgba(0,0,0,.5);color:#fff;font-size:11px;cursor:pointer;display:none;line-height:1}
.e2-pm-item:hover .e2-pm-del{display:block}
.e2-pm-name{position:absolute;left:0;right:0;bottom:0;background:rgba(0,0,0,.55);color:#fff;font-size:9px;padding:2px 3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.e2-pm-empty{color:#777;font-size:11px;padding:14px 6px;text-align:center}
.e2-pm-row{display:flex;gap:6px;align-items:center;margin-bottom:7px}
.e2-pm-input{flex:1;min-width:0;font-size:12px;padding:5px 7px;border:1px solid #bbb;border-radius:5px;font-family:inherit}
.e2-pm-btn{font-size:11px;padding:5px 10px;border:1px solid #2e86c1;background:#2e86c1;color:#fff;border-radius:5px;cursor:pointer;white-space:nowrap}
.e2-pm-btn.ghost{background:#fff;color:#1a6699}
.e2-pm-btn:disabled{opacity:.5;cursor:default}
.e2-pm-status{font-size:11px;color:#666;margin-top:6px;min-height:14px}
.e2-pm-ai{display:flex;flex-direction:column;gap:8px}
.e2-pm-aiitem{border:1px solid #e2e2e2;border-radius:6px;padding:7px;display:flex;gap:8px;align-items:flex-start}
.e2-pm-aithumb{width:48px;height:48px;flex:0 0 48px;border-radius:5px;object-fit:cover;background:#eee;border:1px solid #ddd}
.e2-pm-aifields{flex:1;min-width:0;display:flex;flex-direction:column;gap:5px}
.e2-pm-aibtns{display:flex;gap:5px}
.e2-pm-hint{font-size:11px;color:#888;margin:2px 0 8px}
`;
    document.head.appendChild(st);
  }

  // ── lifecycle ───────────────────────────────────────────────────────────────
  function close() {
    if (_docDown) { document.removeEventListener('mousedown', _docDown, true); _docDown = null; }
    if (_panel) { _panel.remove(); _panel = null; }
    _anchor = null;
  }

  PM.open = function (anchorEl, sessionKey, scenFile, onChange) {
    // Toggle: clicking the same anchor while open closes it.
    if (_panel && _anchor === anchorEl) { close(); return; }
    close();
    _injectCss();
    _key = sessionKey; _scenFile = scenFile || null; _onChange = onChange || null; _anchor = anchorEl;
    _tab = 'gallery';

    _panel = _el('div', 'e2-pm-panel');
    const head = _el('div', 'e2-pm-head');
    head.appendChild(_el('b', null, '🔧 Project products'));
    const x = _el('button', 'e2-pm-x', '✕'); x.addEventListener('click', close); head.appendChild(x);
    _panel.appendChild(head);

    const tabs = _el('div', 'e2-pm-tabs');
    const mk = (id, label) => { const b = _el('button', 'e2-pm-tab' + (_tab === id ? ' on' : ''), label); b.dataset.tab = id; b.addEventListener('click', () => _switch(id)); return b; };
    tabs.appendChild(mk('gallery', 'Gallery'));
    tabs.appendChild(mk('upload', 'Upload'));
    tabs.appendChild(mk('ai', 'AI from scenario'));
    _panel.appendChild(tabs);

    const body = _el('div', 'e2-pm-body'); body.id = 'e2-pm-body'; _panel.appendChild(body);

    document.body.appendChild(_panel);
    _position();
    _renderTab();

    setTimeout(() => {
      _docDown = (e) => { if (_panel && !_panel.contains(e.target) && e.target !== _anchor) close(); };
      document.addEventListener('mousedown', _docDown, true);
    }, 0);
  };

  function _position() {
    if (!_panel || !_anchor) return;
    const r = _anchor.getBoundingClientRect();
    const w = _panel.offsetWidth, h = _panel.offsetHeight;
    let left = Math.min(r.left, window.innerWidth - w - 8);
    left = Math.max(8, left);
    let top = r.bottom + 4;
    if (top + h > window.innerHeight - 8) top = Math.max(8, window.innerHeight - h - 8);
    _panel.style.left = left + 'px';
    _panel.style.top = top + 'px';
  }

  function _switch(id) {
    _tab = id;
    if (_panel) _panel.querySelectorAll('.e2-pm-tab').forEach(b => b.classList.toggle('on', b.dataset.tab === id));
    _renderTab();
  }
  function _body() { return _panel ? _panel.querySelector('#e2-pm-body') : null; }
  function _renderTab() {
    const b = _body(); if (!b) return;
    b.innerHTML = '';
    if (_tab === 'gallery') _renderGallery(b);
    else if (_tab === 'upload') _renderUpload(b);
    else _renderAI(b);
    requestAnimationFrame(_position);
  }

  // ── Gallery ──────────────────────────────────────────────────────────────────
  function _renderGallery(b) {
    const status = _el('div', 'e2-pm-status', 'Loading…');
    b.appendChild(_el('div', 'e2-pm-hint', 'Tap an item to (de)select it for this project. 🗑 removes it from the library.'));
    const grid = _el('div', 'e2-pm-grid'); b.appendChild(grid); b.appendChild(status);
    (window.EDIT2 ? window.EDIT2.getDetails(true) : Promise.resolve([])).then(all => {
      status.textContent = '';
      if (!all || !all.length) { grid.replaceWith(_el('div', 'e2-pm-empty', 'No items yet. Use Upload or AI to add some.')); return; }
      grid.innerHTML = '';
      all.forEach(d => {
        const sel = window.EDIT2 && window.EDIT2.isProjectProduct(_key, d.file);
        const cell = _el('div', 'e2-pm-item' + (sel ? ' sel' : ''));
        const img = _el('img'); img.src = d.thumbPath || d.path; img.loading = 'lazy'; img.alt = d.name || d.file;
        img.onerror = () => { img.onerror = null; img.src = d.path; };
        cell.appendChild(img);
        cell.appendChild(_el('span', 'e2-pm-check', sel ? '✓' : ''));
        cell.appendChild(_el('span', 'e2-pm-name', d.name || d.file));
        const del = _el('button', 'e2-pm-del', '🗑'); del.title = 'Delete from library';
        del.addEventListener('click', (e) => { e.stopPropagation(); _deleteItem(d); });
        cell.appendChild(del);
        cell.addEventListener('click', () => {
          const now = window.EDIT2.toggleProjectProduct(_key, d.file);
          cell.classList.toggle('sel', now);
          cell.querySelector('.e2-pm-check').textContent = now ? '✓' : '';
          _fire();
        });
        grid.appendChild(cell);
      });
    });
  }

  function _deleteItem(d) {
    if (!confirm('Delete "' + (d.name || d.file) + '" from the library? This removes it from every project.')) return;
    fetch('/api/details/' + encodeURIComponent(d.file), { method: 'DELETE' })
      .then(r => r.json()).then(() => {
        if (window.EDIT2) { window.EDIT2.invalidateDetails(); window.EDIT2.purgeProduct(_key, d.file); }
        _fire(); _renderTab();
      }).catch(() => {});
  }

  // ── Upload ───────────────────────────────────────────────────────────────────
  function _renderUpload(b) {
    b.appendChild(_el('div', 'e2-pm-hint', 'Upload a product image. It joins the library and is selected for this project.'));
    const nameRow = _el('div', 'e2-pm-row');
    const nameIn = _el('input', 'e2-pm-input'); nameIn.placeholder = 'Name (optional)'; nameRow.appendChild(nameIn);
    b.appendChild(nameRow);
    const fileRow = _el('div', 'e2-pm-row');
    const file = _el('input', 'e2-pm-input'); file.type = 'file'; file.accept = 'image/*'; fileRow.appendChild(file);
    b.appendChild(fileRow);
    const up = _el('button', 'e2-pm-btn', '⬆ Upload'); b.appendChild(up);
    const status = _el('div', 'e2-pm-status'); b.appendChild(status);
    up.addEventListener('click', () => {
      const f = file.files && file.files[0];
      if (!f) { status.textContent = 'Choose a file first.'; return; }
      up.disabled = true; status.textContent = 'Uploading…';
      const reader = new FileReader();
      reader.onload = () => {
        const b64 = String(reader.result).split(',')[1] || '';
        fetch('/api/details/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageBase64: b64, name: nameIn.value.trim() }) })
          .then(r => r.json()).then(d => {
            if (!d || !d.success) throw new Error((d && d.error) || 'upload failed');
            if (window.EDIT2) { window.EDIT2.invalidateDetails(); window.EDIT2.addProjectProducts(_key, [d.filename]); }
            _fire(); status.textContent = '✅ Added.'; _switch('gallery');
          }).catch(e => { status.textContent = '⚠ ' + (e.message || 'failed'); })
          .finally(() => { up.disabled = false; });
      };
      reader.readAsDataURL(f);
    });
  }

  // ── AI from scenario ─────────────────────────────────────────────────────────
  function _renderAI(b) {
    if (!_scenFile) { b.appendChild(_el('div', 'e2-pm-empty', 'This project has no scenario to extract items from.')); return; }
    b.appendChild(_el('div', 'e2-pm-hint', 'Extract the prop list from this scenario, tweak names, then generate each on a clean white background.'));
    const row = _el('div', 'e2-pm-row');
    const exBtn = _el('button', 'e2-pm-btn', '🔍 Extract from scenario'); row.appendChild(exBtn);
    b.appendChild(row);
    const status = _el('div', 'e2-pm-status'); b.appendChild(status);
    const list = _el('div', 'e2-pm-ai'); b.appendChild(list);
    exBtn.addEventListener('click', () => {
      exBtn.disabled = true; status.textContent = 'Analyzing scenario…'; list.innerHTML = '';
      fetch('/api/scenarios-v2/extract-items', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenFile: _scenFile }) })
        .then(r => r.json()).then(d => {
          if (!d || !d.success || !Array.isArray(d.items) || !d.items.length) throw new Error((d && d.error) || 'no items');
          status.textContent = '';
          d.items.forEach(it => list.appendChild(_aiRow(it)));
        }).catch(e => { status.textContent = '⚠ ' + (e.message || 'failed'); })
        .finally(() => { exBtn.disabled = false; });
    });
  }

  // One extracted item: [thumb] [name][details][Generate/Save].
  function _aiRow(it) {
    const wrap = _el('div', 'e2-pm-aiitem');
    const thumb = _el('img', 'e2-pm-aithumb'); thumb.alt = it.name || ''; wrap.appendChild(thumb);
    const fields = _el('div', 'e2-pm-aifields');
    const nameIn = _el('input', 'e2-pm-input'); nameIn.value = it.name || ''; nameIn.placeholder = 'name'; fields.appendChild(nameIn);
    const detIn = _el('input', 'e2-pm-input'); detIn.value = it.hint || ''; detIn.placeholder = 'details (material, color, container…)'; fields.appendChild(detIn);
    const btns = _el('div', 'e2-pm-aibtns');
    const genBtn = _el('button', 'e2-pm-btn ghost', '✨ Generate');
    const saveBtn = _el('button', 'e2-pm-btn', '💾 Save'); saveBtn.disabled = true;
    const rmBtn = _el('button', 'e2-pm-btn ghost', '✕'); rmBtn.title = 'Remove this found item';
    btns.appendChild(genBtn); btns.appendChild(saveBtn); btns.appendChild(rmBtn); fields.appendChild(btns);
    const st = _el('div', 'e2-pm-status'); fields.appendChild(st);
    wrap.appendChild(fields);

    let staged = null;
    genBtn.addEventListener('click', () => {
      const nm = nameIn.value.trim(); if (!nm) { st.textContent = 'Enter a name.'; return; }
      genBtn.disabled = true; saveBtn.disabled = true; st.textContent = 'Generating…';
      // Discard a previous staged image before regenerating to avoid orphans.
      const pre = staged ? fetch('/api/details/ai/discard-staged', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stagedFile: staged }) }).catch(() => {}) : Promise.resolve();
      pre.then(() => fetch('/api/details/ai/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemName: nm, extras: detIn.value.trim() }) }))
        .then(r => r.json()).then(d => {
          if (!d || !d.success || !d.stagedFile) throw new Error((d && d.error) || 'generate failed');
          staged = d.stagedFile; thumb.src = d.thumbPath || d.imagePath; thumb.onerror = () => { thumb.onerror = null; thumb.src = d.imagePath; };
          st.textContent = 'Generated — Save to keep.'; saveBtn.disabled = false; genBtn.textContent = '🔄 Regenerate';
        }).catch(e => { st.textContent = '⚠ ' + (e.message || 'failed'); })
        .finally(() => { genBtn.disabled = false; });
    });
    saveBtn.addEventListener('click', () => {
      if (!staged) return;
      saveBtn.disabled = true; st.textContent = 'Saving…';
      fetch('/api/details/ai/commit', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [{ stagedFile: staged, name: nameIn.value.trim(), extras: detIn.value.trim() }] }) })
        .then(r => r.json()).then(d => {
          const saved = d && d.items && d.items[0];
          if (!d || !d.success || !saved) throw new Error((d && d.error) || 'save failed');
          if (window.EDIT2) { window.EDIT2.invalidateDetails(); window.EDIT2.addProjectProducts(_key, [saved.filename]); }
          staged = null; _fire(); st.textContent = '✅ Saved & selected.'; genBtn.disabled = true;
        }).catch(e => { st.textContent = '⚠ ' + (e.message || 'failed'); saveBtn.disabled = false; });
    });
    // Drop an unneeded found item; discard its staged image so we don't orphan files.
    rmBtn.addEventListener('click', () => {
      if (staged) {
        fetch('/api/details/ai/discard-staged', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stagedFile: staged }) }).catch(() => {});
        staged = null;
      }
      wrap.remove();
    });
    return wrap;
  }

  window.EditProductManager = PM;
})();
