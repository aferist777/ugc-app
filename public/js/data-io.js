/* ═══════════════════════════════════════════════════════════════════
   DATA I/O — Import / Export popup wiring.
   Backend: routes/data-io.js (/api/data/categories, /api/data/stats,
   /api/data/export, /api/data/import, /api/data/import-progress/:jobId).

   Export side: each category is a row (checkbox + label + "N items · size").
   All rows start UNCHECKED. A "Рассчитать" button fetches per-category sizes;
   the running total recalculates live as rows are toggled.
   ═══════════════════════════════════════════════════════════════════ */

(function () {
  const $ = id => document.getElementById(id);

  function _humanBytes(n) {
    if (n == null) return '—';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
    return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  }

  let _stats = {};            // key → { items, baseBytes, mediaBytes }
  let _statsLoaded = false;

  // ── Injected styling (applies on every page; no per-page HTML edits) ────────
  function _injectStyles() {
    if (document.getElementById('dio-styles')) return;
    const s = document.createElement('style');
    s.id = 'dio-styles';
    s.textContent = `
#data-popup .app-popup-window { width: min(760px, 96vw); }
#data-export-cats { display:flex !important; flex-direction:column !important; flex-wrap:nowrap !important; gap:2px !important; padding:4px !important; background:#fff !important; border:2px solid !important; border-color:#808080 #fff #fff #808080 !important; max-height:340px; overflow-y:auto; }
.dio-cat-row { display:flex; align-items:center; gap:8px; width:100%; padding:5px 7px; cursor:pointer; border:1px solid transparent; border-radius:3px; box-sizing:border-box; user-select:none; }
.dio-cat-row:hover { background:#eef2fb; }
.dio-cat-row[data-checked="true"] { background:#d0d8f0; border-color:#000080; }
.dio-chk { flex:0 0 14px; width:14px; height:14px; border:2px solid; border-color:#808080 #fff #fff #808080; background:#fff; display:grid; place-items:center; font-size:11px; line-height:1; color:#000080; border-radius:2px; }
.dio-cat-row[data-checked="true"] .dio-chk { background:#000080; border-color:#00004a #5a5af0 #5a5af0 #00004a; color:#fff; }
.dio-lbl { flex:1; font-size:11px; color:#000; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.dio-cat-row.warn .dio-lbl { color:#a33; }
.dio-meta { font-size:10px; color:#555; white-space:nowrap; font-variant-numeric:tabular-nums; }
.dio-cat-row[data-checked="true"] .dio-meta { color:#000080; }
.dio-total { display:flex; align-items:center; gap:6px; flex-wrap:wrap; font-size:11px; padding:7px 9px; background:#eef2fb; border:1px solid #b8c4e0; border-radius:3px; }
.dio-total b { color:#000080; }
.dio-total .dio-spacer { flex:1; }
#data-popup .dio-btn { font-size:11px; padding:4px 10px; cursor:pointer; background:#d4d0c8; border:2px solid; border-color:#fff #808080 #808080 #fff; border-radius:2px; color:#000; }
#data-popup .dio-btn:hover { background:#e0ddd6; }
#data-popup .dio-btn:active { border-color:#808080 #fff #fff #808080; }
#data-popup #data-export-btn { background:#000080; color:#fff; border:2px solid; border-color:#5a5af0 #00004a #00004a #5a5af0; font-weight:bold; padding:6px; border-radius:2px; cursor:pointer; }
#data-popup #data-export-btn:hover { background:#0000aa; }
#data-popup #data-export-btn:disabled { background:#888; color:#ccc; border-color:#aaa #666 #666 #aaa; cursor:default; }
#data-popup #data-import-btn { font-size:11px; padding:6px; cursor:pointer; background:#d4d0c8; border:2px solid; border-color:#fff #808080 #808080 #fff; border-radius:2px; }
.dio-vidrow { display:flex; align-items:center; gap:7px; font-size:10px; color:#444; cursor:pointer; user-select:none; padding:2px 0; }
.dio-vidrow .dio-chk { flex:0 0 13px; width:13px; height:13px; }
.dio-drop { border:2px dashed #9aa6c0; border-radius:4px; background:#f7f9ff; padding:14px 10px; text-align:center; font-size:11px; color:#556; cursor:pointer; }
.dio-drop.over { border-color:#000080; background:#e6ecff; color:#000080; }
.dio-drop b { color:#000080; }
`;
    document.head.appendChild(s);
  }

  // ── Selection helpers ───────────────────────────────────────────────────────
  function _rows() { return Array.from(document.querySelectorAll('#data-export-cats .dio-cat-row')); }
  function _isChecked(row) { return row.getAttribute('data-checked') === 'true'; }
  function _setChecked(row, on) {
    row.setAttribute('data-checked', on ? 'true' : 'false');
    const chk = row.querySelector('.dio-chk'); if (chk) chk.textContent = on ? '✓' : '';
  }
  function _selectedCategories() { return _rows().filter(_isChecked).map(r => r.dataset.cat); }
  function _setAll(on) { _rows().forEach(r => _setChecked(r, on)); _recalcTotal(); }
  function _vidOn() { const v = $('data-export-biroly-videos'); return v && v.getAttribute('data-checked') === 'true'; }

  // ── Live total ──────────────────────────────────────────────────────────────
  function _recalcTotal() {
    const sel = _selectedCategories();
    let items = 0, bytes = 0, knownSize = _statsLoaded;
    const vids = _vidOn();
    sel.forEach(k => {
      const s = _stats[k];
      if (!s) { knownSize = false; return; }
      items += s.items || 0;
      bytes += s.baseBytes || 0;
      if (k === 'biroly' && vids) bytes += s.mediaBytes || 0;
    });
    const totalEl = $('dio-total-text');
    if (totalEl) {
      totalEl.innerHTML = sel.length
        ? `Selected: <b>${sel.length}</b> cat. · <b>${items}</b> items · <b>${knownSize ? _humanBytes(bytes) : '— (click "Calculate")'}</b>`
        : `<span style="color:#888;">Nothing selected</span>`;
    }
    const exBtn = $('data-export-btn'); if (exBtn) exBtn.disabled = !sel.length;
    // refresh the biroly-videos row size hint
    const vh = $('dio-vid-hint');
    if (vh) { const b = _stats.biroly; vh.textContent = (b && b.mediaBytes) ? ('(+' + _humanBytes(b.mediaBytes) + ')') : ''; }
  }

  // ── Build the export UI (rows + total + Рассчитать), all unchecked ──────────
  async function _loadCategories() {
    _injectStyles();
    const host = $('data-export-cats');
    if (!host) return;
    host.innerHTML = '<div style="color:#888;font-size:10px;padding:6px;">Loading…</div>';
    let cats = [];
    try {
      const d = await (await fetch('/api/data/categories')).json();
      if (!d.success || !Array.isArray(d.categories)) throw new Error('bad response');
      cats = d.categories;
    } catch (e) {
      host.innerHTML = `<div style="color:#a33;font-size:10px;padding:6px;">Failed to load categories: ${e.message}</div>`;
      return;
    }
    host.innerHTML = '';
    cats.forEach(c => {
      const row = document.createElement('div');
      row.className = 'dio-cat-row' + (c.key === 'settings' ? ' warn' : '');
      row.dataset.cat = c.key;
      row.setAttribute('data-checked', 'false');               // all UNCHECKED by default
      row.innerHTML =
        `<span class="dio-chk"></span>` +
        `<span class="dio-lbl">${c.label.replace(/[<>&]/g, '')}</span>` +
        `<span class="dio-meta" data-meta>—</span>`;
      row.addEventListener('click', () => { _setChecked(row, !_isChecked(row)); _recalcTotal(); });
      host.appendChild(row);
    });

    _ensureExtraUI();
    _recalcTotal();
    _loadStats();   // auto-calc once on open; the button re-fetches
  }

  // Inject the Рассчитать button (into the header) + the total bar (above Export),
  // once. Reuses the existing #data-export-all / none / biroly-videos / btn shell.
  function _ensureExtraUI() {
    // Calculate button next to all/none
    if (!$('dio-calc-btn')) {
      const allBtn = $('data-export-all');
      const calc = document.createElement('button');
      calc.id = 'dio-calc-btn'; calc.type = 'button'; calc.className = 'dio-btn';
      calc.textContent = '🧮 Calculate';
      calc.title = 'Recalculate sizes of all categories';
      calc.addEventListener('click', () => _loadStats(true));
      if (allBtn && allBtn.parentElement) allBtn.parentElement.insertBefore(calc, allBtn);
      // restyle the all/none buttons to match
      ['data-export-all', 'data-export-none'].forEach(id => { const b = $(id); if (b) b.className = 'dio-btn'; });
      const a = $('data-export-all'); if (a) a.textContent = 'All';
      const n = $('data-export-none'); if (n) n.textContent = 'Clear';
    }
    // Total bar just before the Export button
    if (!$('dio-total')) {
      const exBtn = $('data-export-btn');
      const bar = document.createElement('div');
      bar.id = 'dio-total'; bar.className = 'dio-total';
      bar.innerHTML = `<span id="dio-total-text"></span>`;
      if (exBtn && exBtn.parentElement) exBtn.parentElement.insertBefore(bar, exBtn);
    }
    // upgrade the biroly-videos toggle look + size hint
    const vid = $('data-export-biroly-videos');
    if (vid && !vid.dataset.dioUpgraded) {
      vid.dataset.dioUpgraded = '1';
      vid.style.cssText = '';
      vid.className = 'dio-vidrow';
      const on = vid.getAttribute('data-checked') === 'true';
      vid.innerHTML = `<span class="dio-chk">${on ? '✓' : ''}</span><span>Include birol video files</span> <span id="dio-vid-hint" class="dio-meta"></span>`;
    }
  }

  async function _loadStats(force) {
    const calc = $('dio-calc-btn');
    if (calc) { calc.disabled = true; calc.textContent = '⏳ Calculating…'; }
    try {
      const d = await (await fetch('/api/data/stats')).json();
      if (d.success && Array.isArray(d.categories)) {
        _stats = {}; d.categories.forEach(c => { _stats[c.key] = c; });
        _statsLoaded = true;
        // fill per-row meta
        _rows().forEach(row => {
          const s = _stats[row.dataset.cat];
          const m = row.querySelector('[data-meta]');
          if (m) m.textContent = s ? `${s.items} · ${_humanBytes(s.baseBytes)}` : '—';
        });
      }
    } catch (e) { /* leave dashes */ }
    finally {
      if (calc) { calc.disabled = false; calc.textContent = '🧮 Calculate'; }
      _recalcTotal();
    }
  }

  // ── Export handler ──────────────────────────────────────────────────────────
  async function _runExport() {
    const btn    = $('data-export-btn');
    const status = $('data-export-status');
    const cats   = _selectedCategories();
    if (!cats.length) { status.textContent = 'Select at least one category'; return; }
    const includeBirolyVideos = _vidOn();

    btn.disabled = true; btn.textContent = '⏳ Building ZIP…';
    status.textContent = '';
    try { await window.birolyServerSyncFlush?.(); } catch {}
    try { await window.EditSync?.flush?.(); } catch {}   // flush merge edits so export is current

    try {
      const r = await fetch('/api/data/export', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categories: cats, includeBirolyVideos }),
      });
      if (!r.ok) {
        let msg = `HTTP ${r.status}`;
        try { const j = await r.json(); if (j.error) msg = j.error; } catch {}
        throw new Error(msg);
      }
      const blob = await r.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      const disp = r.headers.get('Content-Disposition') || '';
      const m    = disp.match(/filename="?([^"]+)"?/);
      a.href = url;
      a.download = m ? m[1] : `ugc-data-${Date.now()}.zip`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      status.textContent = `✅ Downloaded: ${a.download} (${_humanBytes(blob.size)})`;
    } catch (e) {
      status.textContent = '⚠ ' + e.message;
    } finally {
      btn.disabled = false;
      btn.textContent = '📦 Export ZIP';
    }
  }

  // ── Import handler ──────────────────────────────────────────────────────────
  async function _runImport() {
    const btn    = $('data-import-btn');
    const status = $('data-import-status');
    const fileInp = $('data-import-file');
    const file = fileInp.files?.[0];
    if (!file) { status.textContent = 'Select a ZIP file'; return; }
    if (!file.name.toLowerCase().endsWith('.zip')) { status.textContent = 'A .zip is required'; return; }

    if (!confirm(`Import "${file.name}" (${_humanBytes(file.size)})?\n\nCategories from the archive manifest will be merged into the current data (no duplicates are created, local records win). Other categories are left untouched.`)) return;

    btn.disabled = true; btn.textContent = '⏳ Uploading…';
    status.textContent = '';

    const progWrap = $('data-import-progress-wrap');
    const progBar  = $('data-import-progress-bar');
    const progPct  = $('data-import-progress-pct');
    const _setPct = (pct, label) => {
      const p = Math.max(0, Math.min(100, pct));
      if (progBar) progBar.style.width = p.toFixed(1) + '%';
      if (progPct) progPct.textContent = (label != null) ? label : p.toFixed(0) + '%';
    };
    if (progWrap) progWrap.style.display = 'flex';
    _setPct(0, '0%');

    try {
      const fd = new FormData();
      fd.append('file', file);
      const d = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/data/import');
        xhr.timeout = 20 * 60 * 1000;   // 20 min window for large multi-GB uploads
        xhr.upload.addEventListener('progress', e => {
          if (!e.lengthComputable) return;
          const pct = (e.loaded / e.total) * 100;
          _setPct(pct, `${pct.toFixed(0)}% — ${_humanBytes(e.loaded)} / ${_humanBytes(e.total)}`);
          status.textContent = `Uploading ${_humanBytes(e.loaded)} of ${_humanBytes(e.total)}…`;
        });
        xhr.upload.addEventListener('load', () => { _setPct(0, 'Server processing…'); status.textContent = 'Server processing…'; });
        xhr.onload = () => {
          try {
            const json = JSON.parse(xhr.responseText);
            if (xhr.status >= 200 && xhr.status < 300 && json.success) resolve(json);
            else reject(new Error(json.error || `HTTP ${xhr.status}`));
          } catch (e) { reject(new Error('Bad server response')); }
        };
        xhr.onerror   = () => reject(new Error('Network error during upload'));
        xhr.ontimeout = () => reject(new Error('Upload timeout'));
        xhr.send(fd);
      });
      const jobId = d.jobId;

      btn.textContent = '⏳ Extracting…';
      const finalState = await new Promise((resolve, reject) => {
        const _poll = setInterval(async () => {
          try {
            const pr = await fetch('/api/data/import-progress/' + encodeURIComponent(jobId));
            const pd = await pr.json();
            if (!pd.success) { clearInterval(_poll); reject(new Error(pd.error || 'progress lost')); return; }
            if (pd.totalFiles > 0) {
              const pct = (pd.filesWritten / pd.totalFiles) * 100;
              _setPct(pct, `${pct.toFixed(0)}% — ${pd.filesWritten} / ${pd.totalFiles} files`);
              status.textContent = `Extracting: ${pd.filesWritten} / ${pd.totalFiles} files…`;
            } else { _setPct(0, 'Reading bundle…'); status.textContent = 'Reading bundle…'; }
            if (pd.status === 'done')        { clearInterval(_poll); _setPct(100, 'Done'); resolve(pd); }
            else if (pd.status === 'failed') { clearInterval(_poll); reject(new Error(pd.error || 'import failed')); }
          } catch (e) { clearInterval(_poll); reject(e); }
        }, 300);
      });

      localStorage.setItem('__just_imported_at', String(Date.now()));
      const cats = finalState.manifest?.categories || [];
      status.textContent = `✅ Restored ${finalState.filesWritten} files (${cats.join(', ')}). Reloading…`;
      setTimeout(() => location.reload(), 1200);
    } catch (e) {
      status.textContent = '⚠ ' + e.message;
      btn.disabled = false;
      btn.textContent = '📥 Import ZIP';
    } finally {
      fileInp.value = '';
    }
  }

  // ── Wire ──────────────────────────────────────────────────────────────────
  function _wire() {
    $('data-export-all') ?.addEventListener('click', () => _setAll(true));
    $('data-export-none')?.addEventListener('click', () => _setAll(false));
    $('data-export-btn') ?.addEventListener('click', _runExport);
    $('data-import-btn') ?.addEventListener('click', _runImport);

    const vidBtn = $('data-export-biroly-videos');
    vidBtn?.addEventListener('click', () => {
      const next = vidBtn.getAttribute('data-checked') !== 'true';
      vidBtn.setAttribute('data-checked', next ? 'true' : 'false');
      const chk = vidBtn.querySelector('.dio-chk'); if (chk) chk.textContent = next ? '✓' : '';
      _recalcTotal();
    });
  }

  let _catsLoaded = false;
  window.addEventListener('DOMContentLoaded', () => {
    _wire();
    document.getElementById('btn-open-data')?.addEventListener('click', () => {
      window.openAppPopup?.('data');
      if (!_catsLoaded) { _catsLoaded = true; _loadCategories(); }
      else { _loadStats(); }   // refresh sizes each open
    });
  });
})();
