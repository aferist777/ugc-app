/* ═══════════════════════════════════════════════════════════════════
   DATA I/O — Import / Export popup wiring.
   Backend: routes/data-io.js (/api/data/categories, /api/data/export,
   /api/data/import, /api/data/import-progress/:jobId).
   ═══════════════════════════════════════════════════════════════════ */

(function () {
  const $ = id => document.getElementById(id);

  // Toggle helper — keeps data-checked attribute in sync with visual state.
  function _setBtnChecked(btn, checked) {
    btn.setAttribute('data-checked', checked ? 'true' : 'false');
  }
  function _isBtnChecked(btn) {
    return btn.getAttribute('data-checked') === 'true';
  }

  // ── Populate Export category buttons from server-provided catalog ─────────
  async function _loadCategories() {
    const host = $('data-export-cats');
    if (!host) return;
    host.innerHTML = '<div style="color:#888;font-size:10px;">Loading…</div>';
    try {
      const r = await fetch('/api/data/categories');
      const d = await r.json();
      if (!d.success || !Array.isArray(d.categories)) throw new Error('bad response');
      host.innerHTML = '';
      d.categories.forEach(c => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'data-cat-btn' + (c.key === 'settings' ? ' warn' : '');
        btn.dataset.cat = c.key;
        btn.textContent = c.label;
        // settings starts UNchecked — contains secrets, opt-in only
        _setBtnChecked(btn, c.key !== 'settings');
        btn.addEventListener('click', () => _setBtnChecked(btn, !_isBtnChecked(btn)));
        host.appendChild(btn);
      });
    } catch (e) {
      host.innerHTML = `<div style="color:#a33;font-size:10px;">Не удалось загрузить категории: ${e.message}</div>`;
    }
  }

  function _selectedCategories() {
    return Array.from(document.querySelectorAll('#data-export-cats .data-cat-btn'))
      .filter(b => _isBtnChecked(b)).map(b => b.dataset.cat);
  }
  function _setAll(checked) {
    document.querySelectorAll('#data-export-cats .data-cat-btn').forEach(b => _setBtnChecked(b, checked));
  }

  // ── Export handler ──────────────────────────────────────────────────────
  async function _runExport() {
    const btn    = $('data-export-btn');
    const status = $('data-export-status');
    const cats   = _selectedCategories();
    if (!cats.length) { status.textContent = 'Выберите хотя бы одну категорию'; return; }
    const vidBtn = $('data-export-biroly-videos');
    const includeBirolyVideos = vidBtn ? _isBtnChecked(vidBtn) : false;

    btn.disabled = true; btn.textContent = '⏳ Building ZIP…';
    status.textContent = '';

    // Flush Biroly sync first so the export includes the latest LS state
    try { await window.birolyServerSyncFlush?.(); } catch {}

    try {
      const r = await fetch('/api/data/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      status.textContent = `✅ Скачано: ${a.download}`;
    } catch (e) {
      status.textContent = '⚠ ' + e.message;
    } finally {
      btn.disabled = false;
      btn.textContent = '📦 Export ZIP';
    }
  }

  // ── Import handler ──────────────────────────────────────────────────────
  async function _runImport() {
    const btn    = $('data-import-btn');
    const status = $('data-import-status');
    const fileInp = $('data-import-file');
    const file = fileInp.files?.[0];
    if (!file) { status.textContent = 'Выберите ZIP-файл'; return; }
    if (!file.name.toLowerCase().endsWith('.zip')) { status.textContent = 'Нужен .zip'; return; }

    if (!confirm(`Импортировать "${file.name}"?\n\nКатегории, перечисленные в манифесте архива, будут ЗАМЕНЕНЫ на содержимое ZIP. Остальные категории на сервере не пострадают.`)) {
      return;
    }

    btn.disabled = true; btn.textContent = '⏳ Uploading…';
    status.textContent = '';

    // Show + reset progress bar
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

    function _humanBytes(n) {
      if (n < 1024) return n + ' B';
      if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
      if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
      return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
    }

    try {
      // Step 1 — upload with XHR so we can watch the upload progress.
      // fetch() doesn't expose upload progress, so we use the older XHR API.
      const fd = new FormData();
      fd.append('file', file);
      const d = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/data/import');
        xhr.upload.addEventListener('progress', e => {
          if (!e.lengthComputable) return;
          const pct = (e.loaded / e.total) * 100;
          _setPct(pct, `${pct.toFixed(0)}% — ${_humanBytes(e.loaded)} / ${_humanBytes(e.total)}`);
          status.textContent = `Uploading ${_humanBytes(e.loaded)} of ${_humanBytes(e.total)}…`;
        });
        xhr.upload.addEventListener('load', () => {
          // Upload finished; reset bar for extraction phase.
          _setPct(0, 'Server processing…');
          status.textContent = 'Server processing…';
        });
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

      // Step 2 — poll extraction progress, drive the same bar.
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
            } else {
              _setPct(0, 'Reading bundle…');
              status.textContent = 'Reading bundle…';
            }
            if (pd.status === 'done')         { clearInterval(_poll); _setPct(100, 'Done'); resolve(pd); }
            else if (pd.status === 'failed')  { clearInterval(_poll); reject(new Error(pd.error || 'import failed')); }
          } catch (e) { clearInterval(_poll); reject(e); }
        }, 300);
      });

      // Set a "force pull from server" sentinel. The post-reload bootstraps
      // (biroly-server-sync, obrazy.js, projects.js) read this flag and, when
      // it's recent, OVERWRITE their LS keys with whatever the server has —
      // instead of trusting LS (which biroly.js eagerly rewrites with default
      // categories on init, causing a race that nukes the restored server JSON).
      localStorage.setItem('__just_imported_at', String(Date.now()));

      const cats = finalState.manifest?.categories || [];
      status.textContent = `✅ Restored ${finalState.filesWritten} files (${cats.join(', ')}). Reloading…`;
      console.group('[data-import] complete');
      console.log('Manifest:', finalState.manifest);
      console.log('Files written:', finalState.filesWritten, '/', finalState.totalFiles);
      console.groupEnd();
      setTimeout(() => location.reload(), 1200);
    } catch (e) {
      status.textContent = '⚠ ' + e.message;
      btn.disabled = false;
      btn.textContent = '📥 Import ZIP';
    } finally {
      fileInp.value = '';
    }
  }

  // ── Wire ──────────────────────────────────────────────────────────────
  function _wire() {
    $('data-export-all') ?.addEventListener('click', () => _setAll(true));
    $('data-export-none')?.addEventListener('click', () => _setAll(false));
    $('data-export-btn') ?.addEventListener('click', _runExport);
    $('data-import-btn') ?.addEventListener('click', _runImport);

    // Biroly-videos toggle button
    const vidBtn = $('data-export-biroly-videos');
    vidBtn?.addEventListener('click', () => {
      const next = !_isBtnChecked(vidBtn);
      _setBtnChecked(vidBtn, next);
      vidBtn.textContent = (next ? '☑' : '☐') + ' Include biroly video files';
    });

    $('btn-open-data')?.addEventListener('click', () => {
      window.openAppPopup?.('data');
    });
  }

  // Lazy: load category list the first time the popup is opened
  let _catsLoaded = false;
  window.addEventListener('DOMContentLoaded', () => {
    _wire();
    document.getElementById('btn-open-data')?.addEventListener('click', () => {
      if (!_catsLoaded) { _catsLoaded = true; _loadCategories(); }
    });
  });
})();
