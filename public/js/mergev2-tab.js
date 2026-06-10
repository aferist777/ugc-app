/* ═══════════════════════════════════════════════════════════════════════════
   mergev2-tab.js — bootstrap for the Merge v2 sub-tab.

   Lazy-initializes on first activation (called from showComboPanel('mergev2')
   in tabs.js). Wires the session picker, transport, zoom and the (Phase 5)
   export button, and injects the scoped stylesheet. Owns the active sessionKey.
   ═══════════════════════════════════════════════════════════════════════════ */

(function () {
  const MV2Tab = {};
  let _inited = false;
  let _sessionKey = null;
  let _mediaTab = 'birol'; // 'birol' | 'hook'
  let _birolCat = ''; // category filter for the Birols gallery ('' = none picked yet → empty)
  let _birolPage = 0;       // current page in the Birols gallery (paged 20/page; uncategorized can be hundreds)
  const MV2_MEDIA_PAGE_SIZE = 20;
  let _mediaIO = null;      // IntersectionObserver: lazy-load gallery thumbnails on scroll-in
  let _model = null;
  let _selected = null;     // { kind, key } | null
  let _exportJob = null;
  let _exportPoll = null;
  const _undoStack = [];
  const _redoStack = [];
  const HISTORY_CAP = 60;
  const PREF_KEY = 'mergev2_last_session_v1';

  function _injectStyles() {
    if (document.getElementById('mv2-styles')) return;
    const css = `
/* Design tokens (palette) — single source for accents + ink */
#mv2-root, #mv2-subs-box { --mv2-ink:#333; --mv2-muted:#444; --mv2-accent:#2e86c1; --mv2-accent-d:#1c5e85; --mv2-purple:#7a5cae; --mv2-focus:#0a4fb5; }
/* Keyboard focus visibility (a11y / WCAG 2.4.7) */
#mv2-root button:focus-visible, #mv2-root select:focus-visible, #mv2-root input:focus-visible, #mv2-root [role="button"]:focus-visible,
#mv2-subs-box button:focus-visible, #mv2-subs-box input:focus-visible, #mv2-subs-box select:focus-visible, #mv2-subs-box textarea:focus-visible { outline:2px solid var(--mv2-focus); outline-offset:2px; }
#combo-sub-mergev2 { background:#d4d0c8; }
#mv2-root { display:flex; flex-direction:column; height:100%; min-height:0; font-family:inherit; }
#mv2-topbar { display:flex; align-items:center; gap:6px; padding:5px 8px; background:#c0c0c0; border-bottom:1px solid #808080; flex:0 0 auto; }
#mv2-topbar .mv2-spacer, #mv2-transport .mv2-spacer { flex:1; }
#mv2-export { font-size:10px; padding:2px 10px; cursor:pointer; background:#2e86c1; color:#fff; border:2px solid; border-color:#7fc0ec #1c5e85 #1c5e85 #7fc0ec; font-weight:bold; }
#mv2-export:disabled { background:#9bb; color:#eee; cursor:default; }
#mv2-export-settings { font-size:13px; line-height:1; padding:3px 7px; cursor:pointer; background:#d4d0c8; border:2px solid; border-color:#fff #808080 #808080 #fff; }
#mv2-save, #mv2-close, #mv2-copy { font-size:10px; padding:2px 8px; cursor:pointer; background:#d4d0c8; border:2px solid; border-color:#fff #808080 #808080 #fff; }
#mv2-save:disabled, #mv2-close:disabled, #mv2-copy:disabled { color:#999; cursor:default; }
#mv2-close { color:#aa0000; font-weight:bold; }
#mv2-delete { font-size:10px; padding:2px 8px; cursor:pointer; background:#d4d0c8; border:2px solid; border-color:#fff #808080 #808080 #fff; }
#mv2-delete:disabled { color:#999; cursor:default; }
#mv2-delete.armed { background:#c0392b; color:#fff; border-color:#e07a6e #7a241a #7a241a #e07a6e; font-weight:bold; }
#mv2-preview { flex:0 0 auto; height:320px; background:#1a1a1a; display:flex; flex-direction:row; overflow:hidden; }
#mv2-media { flex:1 1 50%; min-width:0; display:flex; flex-direction:column; background:#cfcbc3; border-right:2px solid #000; }
#mv2-media-tabs { display:flex; align-items:center; gap:4px; padding:4px 6px; background:#c0c0c0; border-bottom:1px solid #808080; flex:0 0 auto; }
#mv2-media-bar { display:flex; align-items:center; gap:6px; padding:3px 6px; background:#c8c4bc; border-bottom:1px solid #aaa; flex:0 0 auto; min-height:22px; font-size:10px; color:#333; }
#mv2-media-bar select { font-size:10px; padding:1px 3px; }
#mv2-media-bar button { font-size:10px; padding:2px 8px; cursor:pointer; }
.mv2-media-tab { font-size:10px; padding:2px 9px; cursor:pointer; background:#d4d0c8; border:2px solid; border-color:#fff #808080 #808080 #fff; }
.mv2-media-tab.active { background:#7a5cae; color:#fff; border-color:#b39ddb #4a3576 #4a3576 #b39ddb; font-weight:bold; }
#mv2-media-grid { flex:1 1 auto; min-height:0; overflow-y:auto; display:flex; flex-wrap:wrap; align-content:flex-start; gap:6px; padding:6px; }
.mv2-media-card { width:72px; box-sizing:border-box; cursor:pointer; border:2px solid #808080; background:#c0c0c0; position:relative; }
.mv2-media-card.active { border-color:#1a8a1a; box-shadow:0 0 0 1px #1a8a1a inset; }
.mv2-media-card .mv2-media-thumb { width:100%; height:50px; background:#111; object-fit:cover; display:block; }
.mv2-media-card .mv2-media-name { font-size:10px; padding:1px 3px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.mv2-media-card .mv2-media-flag { position:absolute; top:1px; right:1px; background:rgba(26,138,26,0.9); color:#fff; font-size:8px; padding:0 3px; border-radius:2px; }
.mv2-media-x { position:absolute; top:1px; right:1px; width:13px; height:13px; padding:0; margin:0; border:none; line-height:11px; font-size:12px; font-weight:bold; text-align:center; background:rgba(0,0,0,0.55); color:#fff; cursor:pointer; z-index:6; opacity:0.7; border-radius:2px; }
.mv2-media-x:hover { background:#c0392b; opacity:1; }
.mv2-media-empty { font-size:10px; color:#777; font-style:italic; padding:8px; }
#mv2-canvas-wrap { flex:1 1 50%; min-width:0; position:relative; display:flex; align-items:center; justify-content:center; overflow:hidden; }
#mv2-canvas { max-height:100%; max-width:100%; box-shadow:0 0 8px #000; background:#000; }
/* Preview overlay controls: quality (bottom-right) + fullscreen (bottom-left) */
.mv2-pv-ctl { position:absolute; bottom:6px; z-index:8; opacity:0.82; transition:opacity .12s; }
.mv2-pv-ctl:hover { opacity:1; }
#mv2-pv-quality { right:6px; font-size:10px; padding:2px 4px; background:rgba(0,0,0,0.6); color:#fff; border:1px solid #999; border-radius:3px; cursor:pointer; }
#mv2-pv-fs { left:6px; width:26px; height:24px; padding:0; font-size:14px; line-height:22px; text-align:center; background:rgba(0,0,0,0.6); color:#fff; border:1px solid #999; border-radius:3px; cursor:pointer; }
#mv2-canvas-wrap:fullscreen { width:100vw; height:100vh; background:#000; }
#mv2-canvas-wrap:fullscreen #mv2-canvas { max-height:100vh; max-width:100vw; box-shadow:none; }
#mv2-canvas-wrap:fullscreen .mv2-pv-ctl { bottom:18px; opacity:0.7; }
#mv2-canvas-wrap:fullscreen #mv2-pv-quality { right:18px; font-size:13px; }
#mv2-canvas-wrap:fullscreen #mv2-pv-fs { left:18px; width:34px; height:30px; font-size:18px; line-height:28px; }
#mv2-transport { display:flex; align-items:center; gap:8px; padding:4px 8px; background:#c0c0c0; border-top:1px solid #fff; border-bottom:1px solid #808080; flex:0 0 auto; }
#mv2-play { font-size:12px; padding:1px 9px; cursor:pointer; min-width:30px; }
#mv2-tracks-wrap { position:relative; flex:1 1 auto; min-height:0; overflow:auto; background:#b8b4ac; }
#mv2-ruler { position:relative; height:16px; margin-left:64px; background:#a8a49c; border-bottom:1px solid #808080; }
#mv2-ruler .mv2-tick { position:absolute; top:0; height:16px; border-left:1px solid #6a665e; }
#mv2-ruler .mv2-tick span { font-size:9px; color:var(--mv2-ink); padding-left:2px; }
#mv2-tracks { position:relative; }
.mv2-track { display:flex; align-items:stretch; height:22px; border-bottom:1px solid #9a968e; }
.mv2-track-label { width:64px; flex:0 0 64px; font-size:10px; font-weight:bold; color:#000080; display:flex; align-items:center; padding-left:4px; background:#cfcbc3; border-right:1px solid #808080; box-sizing:border-box; }
.mv2-track-label-btn { cursor:pointer; text-decoration:underline; color:#1c5e85; }
.mv2-track-label-btn:hover { background:#bfe0f2; }
.mv2-sub-clip { top:2px !important; height:16px !important; opacity:0.92; }
.mv2-lane { position:relative; flex:1 1 auto; }
.mv2-lane.drag-over { outline:2px dashed #2e86c1; outline-offset:-2px; background:rgba(46,134,193,0.08); }
.mv2-media-card[draggable="true"] { cursor:grab; }
.mv2-lane-empty { font-size:10px; color:var(--mv2-muted); font-style:italic; padding:3px 6px; }
.mv2-clip { position:absolute; top:2px; height:18px; box-sizing:border-box; border:1px solid rgba(0,0,0,0.35); border-radius:2px; cursor:pointer; overflow:hidden; display:flex; align-items:center; }
.mv2-clip span { font-size:9px; color:#fff; padding:0 3px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; text-shadow:0 0 2px #000; pointer-events:none; }
#mv2-playhead { position:absolute; top:0; bottom:0; width:1px; background:#ff2020; pointer-events:none; z-index:5; }
.mv2-clip { cursor:pointer; }
.mv2-clip.selected { outline:2px solid #ffd000; outline-offset:-1px; z-index:3; }
.mv2-trim { position:absolute; top:0; bottom:0; width:10px; cursor:ew-resize; z-index:4; background:rgba(255,208,0,0); }
.mv2-trim:hover { background:rgba(255,208,0,0.55); }
.mv2-trim-l { left:-2px; } .mv2-trim-r { right:-2px; }
#mv2-inspector { flex:0 0 auto; max-height:130px; overflow:auto; padding:5px 8px; background:#c0c0c0; border-top:1px solid #808080; }
#mv2-inspector-body { display:flex; flex-wrap:wrap; align-items:center; gap:10px; }
.mv2-insp-row { display:flex; align-items:center; gap:5px; }
.mv2-insp-row label { font-size:10px; color:#333; }
.mv2-insp-title { font-size:10px; font-weight:bold; color:#000080; width:100%; }
.mv2-insp-del { background:#c0392b; color:#fff; border:1px solid #7a241a; font-size:10px; padding:2px 9px; cursor:pointer; }
.mv2-insp-hint { font-size:10px; color:var(--mv2-muted); }
.mv2-switch { position:relative; display:inline-block; width:34px; height:18px; flex:0 0 auto; }
.mv2-switch input { opacity:0; width:0; height:0; margin:0; }
.mv2-switch .mv2-sl { position:absolute; inset:0; background:#999; border-radius:18px; transition:.15s; cursor:pointer; }
.mv2-switch .mv2-sl:before { content:''; position:absolute; width:14px; height:14px; left:2px; top:2px; background:#fff; border-radius:50%; transition:.15s; }
.mv2-switch input:checked + .mv2-sl { background:#2e86c1; }
.mv2-switch input:checked + .mv2-sl:before { transform:translateX(16px); }
.nav-mergev2-btn { background:#7a5cae !important; border-color:#b39ddb #4a3576 #4a3576 #b39ddb !important; }
.nav-mergev2-btn.active { background:#5e3aae !important; color:#fff !important; }
/* Subtitles popup */
#mv2-subs-overlay { position:fixed; inset:0; background:rgba(0,0,0,.5); z-index:10050; display:flex; align-items:center; justify-content:center; }
#mv2-subs-box { background:#f0f0f0; color:#111; border:1.5px solid #999; border-radius:6px; width:min(97vw,940px); max-height:90vh; display:flex; flex-direction:column; box-shadow:0 8px 40px rgba(0,0,0,.5); }
#mv2-subs-head { display:flex; align-items:center; justify-content:space-between; padding:8px 12px; background:#e0e0e0; border-bottom:1.5px solid #bbb; border-radius:6px 6px 0 0; }
#mv2-subs-head b { font-size:13px; }
#mv2-subs-x { background:#ccc; border:1px solid #999; border-radius:3px; cursor:pointer; padding:2px 8px; font-size:12px; }
#mv2-subs-body { display:grid; grid-template-columns:1fr 190px 1fr; gap:14px; padding:12px 14px; overflow:auto; }
#mv2-subs-col-text, #mv2-subs-col-style, #mv2-subs-col-preview { display:flex; flex-direction:column; gap:8px; min-width:0; }
#mv2-subs-col-preview, #mv2-subs-col-style { border-left:1px solid #ccc; padding-left:14px; }
#mv2-subs-col-preview { align-items:center; }
#mv2-subs-stage { position:relative; width:158px; height:281px; background:linear-gradient(160deg,#3d3d3d,#242424); border:1px solid #555; border-radius:4px; overflow:hidden; flex:none; }
#mv2-subs-sample { position:absolute; left:50%; transform:translate(-50%,-50%); max-width:92%; text-align:center; line-height:1.14; white-space:pre-wrap; word-break:break-word; cursor:grab; user-select:none; }
#mv2-subs-sample.dragging { cursor:grabbing; }
.mv2-subs-phint { font-size:9px; color:#666; text-align:center; }
.mv2-subs-h { font-size:11px; font-weight:bold; color:#000080; }
#mv2-subs-genrow { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
#mv2-subs-gen { font-size:11px; padding:4px 10px; cursor:pointer; background:#2e86c1; color:#fff; border:1px solid #1c5e85; border-radius:3px; font-weight:bold; }
#mv2-subs-status { font-size:10px; color:#555; }
#mv2-subs-ta { width:100%; min-height:240px; box-sizing:border-box; font-family:monospace; font-size:11px; padding:6px; resize:vertical; }
#mv2-subs-saverow { display:flex; align-items:center; gap:10px; }
#mv2-subs-save { font-size:10px; padding:3px 12px; cursor:pointer; background:#c0ffc0; border:1px solid #4a8a4a; font-weight:bold; }
.mv2-srow { display:grid; grid-template-columns:90px 1fr; align-items:center; gap:8px; }
.mv2-srow > label { font-size:10px; color:#333; }
.mv2-srow input[type=text], .mv2-srow input[type=number], .mv2-srow select { font-size:10px; padding:2px 4px; width:100%; box-sizing:border-box; }
.mv2-srow input[type=color] { width:34px; height:20px; padding:0; border:1px solid #999; cursor:pointer; }
.mv2-srow-2 { display:flex; align-items:center; gap:14px; }
.mv2-srow-2 label { font-size:10px; color:#333; display:flex; align-items:center; gap:5px; }
@media (max-width:760px){ #mv2-subs-body{ grid-template-columns:1fr; } #mv2-subs-col-style, #mv2-subs-col-preview{ border-left:none; padding-left:0; border-top:1px solid #ccc; padding-top:10px; } }
`;
    const style = document.createElement('style');
    style.id = 'mv2-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function _status(msg) {
    const el = document.getElementById('mv2-status');
    if (el) el.textContent = msg || '';
  }

  // Overlay controls on the preview canvas: a quality dropdown (bottom-right)
  // and a fullscreen toggle (bottom-left; in fullscreen its icon flips to
  // "restore" and Esc also exits). Injected once over #mv2-canvas-wrap.
  function _setupPreviewControls() {
    const wrap = document.getElementById('mv2-canvas-wrap');
    if (!wrap || document.getElementById('mv2-pv-quality')) return;

    const sel = document.createElement('select');
    sel.id = 'mv2-pv-quality'; sel.className = 'mv2-pv-ctl';
    sel.title = 'Preview quality — lower = smoother on slow connections (the final render is always full quality)';
    [['full', 'Full'], ['720', '720p'], ['480', '480p'], ['360', '360p']].forEach(([v, l]) => {
      const o = document.createElement('option'); o.value = v; o.textContent = l; sel.appendChild(o);
    });
    let q = '480'; try { q = localStorage.getItem('mv2_preview_quality') || '480'; } catch {}
    sel.value = q;
    sel.addEventListener('change', () => {
      try { localStorage.setItem('mv2_preview_quality', sel.value); } catch {}
      if (window.MV2Compositor && window.MV2Compositor.reloadSources) window.MV2Compositor.reloadSources();
    });

    const fs = document.createElement('button');
    fs.id = 'mv2-pv-fs'; fs.className = 'mv2-pv-ctl';
    fs.title = 'Fullscreen preview'; fs.textContent = '⛶';
    fs.addEventListener('click', () => {
      if (document.fullscreenElement === wrap) { if (document.exitFullscreen) document.exitFullscreen(); }
      else if (wrap.requestFullscreen) { wrap.requestFullscreen().catch(() => {}); }
    });

    wrap.appendChild(sel); wrap.appendChild(fs);

    document.addEventListener('fullscreenchange', () => {
      const on = (document.fullscreenElement === wrap);
      fs.textContent = on ? '🗗' : '⛶';     // restore vs expand
      fs.title = on ? 'Exit fullscreen (Esc)' : 'Fullscreen preview';
      if (window.MV2Compositor) {
        try { window.MV2Compositor._fitCanvas(); } catch {}
        try { window.MV2Compositor._drawFrame(window.MV2Compositor.clockT); } catch {}
      }
    });
  }

  function _initOnce() {
    if (_inited) return;
    _inited = true;
    _injectStyles();

    const canvas = document.getElementById('mv2-canvas');
    window.MV2Compositor.mount(canvas);
    _setupPreviewControls();
    window.MV2Compositor.setOnTick((cur, total, playing) => {
      const t = document.getElementById('mv2-time');
      if (t) t.textContent = (Math.round(cur * 100) / 100).toFixed(2) + ' / ' + (Math.round(total * 100) / 100).toFixed(2) + 's';
      const pb = document.getElementById('mv2-play');
      if (pb) pb.textContent = playing ? '❚❚' : '▶';
      window.MV2Timeline.setPlayhead(cur);
    });

    document.getElementById('mv2-play')?.addEventListener('click', () => window.MV2Compositor.toggle());

    document.getElementById('mv2-zoom')?.addEventListener('input', () => {
      if (window.MV2Compositor.model) window.MV2Timeline.render(window.MV2Compositor.model);
    });

    document.getElementById('mv2-session')?.addEventListener('change', (e) => {
      // Switching projects: persist the current one (snapshot + flush) first.
      _persistCurrent();
      const v = e.target.value;
      if (!v) {   // placeholder selected → unload the editor, keep the list intact
        _sessionKey = null; _model = null; _selected = null;
        window.MV2Compositor.load(null); window.MV2Timeline.render(null, null); _renderInspector();
        _setSaveCloseEnabled(false);
        return;
      }
      _loadSession(v);
    });

    // Save button retired — projects autosave every 30s + on switch/leave
    // (see _startAutosave / _persistCurrent). Hide the legacy button if present.
    const _saveBtn = document.getElementById('mv2-save');
    if (_saveBtn) _saveBtn.style.display = 'none';

    document.getElementById('mv2-copy')?.addEventListener('click', _openCopyFrom);

    document.getElementById('mv2-delete')?.addEventListener('click', async () => {
      if (!_sessionKey) return;
      const b = document.getElementById('mv2-delete');
      if (!b.classList.contains('armed')) {
        // First click → arm (red + question); auto-disarm after 3s.
        b.classList.add('armed'); b.textContent = '⚠ Delete?';
        _delTimer = setTimeout(_disarmDelete, 3000);
        return;
      }
      // Second click within 3s → delete: wipe this project's renders, then close it in
      // Merge. The Edit session is kept intact (re-star in Edit to bring it back).
      _disarmDelete();
      const key = _sessionKey;
      let n = 0;
      try {
        const r = await fetch('/api/finals/by-project', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: key }),
        });
        const j = await r.json();
        if (j && j.success) n = j.deleted || 0;
      } catch {}
      window.MV2.closeProject(key);   // removes from Merge (inMerge=false); re-star in Edit to bring back
      _status('Deleted ' + n + ' render(s) · removed from Merge (kept in Edit)');
      const list = _refreshPicker();
      const next = list[0];
      if (next) _loadSession(next.sessionKey);
      else { _sessionKey = null; _model = null; _selected = null; window.MV2Compositor.load(null); window.MV2Timeline.render(null, null); _renderInspector(); _setSaveCloseEnabled(false); }
    });

    // Close = unload the editor but KEEP the project in the dropdown (it stays in
    // Merge). To actually remove it from Merge, use Delete. Reopen by picking it.
    document.getElementById('mv2-close')?.addEventListener('click', () => {
      if (!_sessionKey) return;
      _persistCurrent();                 // save before unloading
      _sessionKey = null; _model = null; _selected = null;
      window.MV2Compositor.load(null); window.MV2Timeline.render(null, null); _renderInspector();
      const sel = document.getElementById('mv2-session'); if (sel) sel.value = '';   // back to placeholder
      _setSaveCloseEnabled(false);
      _status('Closed — still in the dropdown. Pick it again to reopen.');
    });

    // Add the "Uploads" media tab (own videos → Birols track) if not already present.
    (function () {
      const tabs = document.getElementById('mv2-media-tabs');
      if (tabs && !document.getElementById('mv2-media-uploads')) {
        const b = document.createElement('button');
        b.id = 'mv2-media-uploads'; b.className = 'mv2-media-tab'; b.dataset.media = 'upload'; b.textContent = 'Uploads';
        const hooksBtn = document.getElementById('mv2-media-hooks');
        if (hooksBtn && hooksBtn.nextSibling) tabs.insertBefore(b, hooksBtn.nextSibling); else tabs.appendChild(b);
      }
    })();

    // Media library tabs (Birols / Hooks / Uploads)
    document.querySelectorAll('.mv2-media-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        _mediaTab = btn.dataset.media;
        _birolPage = 0;
        document.querySelectorAll('.mv2-media-tab').forEach(b => b.classList.toggle('active', b === btn));
        _renderMedia();
      });
    });

    document.getElementById('mv2-export')?.addEventListener('click', _export);
    document.getElementById('mv2-export-settings')?.addEventListener('click', () => {
      if (!_sessionKey) { _status('Select a project first'); return; }
      if (typeof _openAdvModal === 'function') _openAdvModal(_sessionKey);
    });

    // Keyboard: Delete (remove selected) + Ctrl/Cmd+Z / Ctrl/Cmd+Y (undo/redo),
    // layout-independent via e.code. Active only when the Merge v2 panel is open
    // and focus is not in a form field (so native editing/undo still works there).
    document.addEventListener('keydown', _onKey);
    _startAutosave();
  }

  function _panelOpen() {
    const p = document.getElementById('combo-sub-mergev2');
    return p && p.style.display !== 'none';
  }

  function _onKey(e) {
    if (!_panelOpen()) return;
    const ae = document.activeElement;
    if (ae && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName)) return; // let native handle it
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.code === 'KeyZ') { e.preventDefault(); e.shiftKey ? _redo() : _undo(); return; }
    if (ctrl && e.code === 'KeyY') { e.preventDefault(); _redo(); return; }
    if (e.code === 'Delete' || e.code === 'Backspace') { e.preventDefault(); _deleteSelected(); return; }
  }

  function _setSaveCloseEnabled(on) {
    ['mv2-save', 'mv2-close', 'mv2-copy', 'mv2-delete'].forEach(id => { const el = document.getElementById(id); if (el) el.disabled = !on; });
  }

  let _delTimer = null;
  function _disarmDelete() {
    if (_delTimer) { clearTimeout(_delTimer); _delTimer = null; }
    const b = document.getElementById('mv2-delete');
    if (b) { b.classList.remove('armed'); b.textContent = '🗑 Delete'; }
  }

  function _refreshPicker() {
    const sel = document.getElementById('mv2-session');
    if (!sel) return [];
    const list = window.MV2.listSessions();
    sel.innerHTML = '';
    if (!list.length) {
      const o = document.createElement('option');
      o.value = ''; o.textContent = 'No projects — send one from Edit (★)';
      sel.appendChild(o);
      return list;
    }
    const ph = document.createElement('option'); ph.value = ''; ph.textContent = '— select a project —';
    sel.appendChild(ph);
    list.forEach(({ sessionKey, label }) => {
      const o = document.createElement('option');
      o.value = sessionKey; o.textContent = label;
      sel.appendChild(o);
    });
    return list;
  }

  // Persist the active project: a browser restore snapshot (overwrites the prior
  // one for this project) + flush the live timeline data to the server. No-op when
  // nothing is loaded.
  function _persistCurrent() {
    if (!_sessionKey) return;
    try { window.MV2.saveSnapshot(_sessionKey); } catch {}
    try { if (window.EditSync && EditSync.flush) EditSync.flush(); } catch {}
  }

  // Autosave: every 30s while a project is open, plus on tab-hide / page-unload, so
  // edits are never lost on close or when switching pages.
  let _autosaveTimer = null;
  function _startAutosave() {
    if (_autosaveTimer) return;
    _autosaveTimer = setInterval(() => { if (_sessionKey && _panelOpen()) _persistCurrent(); }, 30000);
    window.addEventListener('beforeunload', _persistCurrent);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') _persistCurrent(); });
  }

  async function _loadSession(sessionKey) {
    if (!sessionKey) { _status('No project selected'); return; }
    _sessionKey = sessionKey;
    try { localStorage.setItem(PREF_KEY, sessionKey); } catch {}
    const sel = document.getElementById('mv2-session');
    if (sel && sel.value !== sessionKey) sel.value = sessionKey;
    _status('Loading…');
    _selected = null;
    _undoStack.length = 0; _redoStack.length = 0;
    const model = await window.MV2.buildModel(sessionKey);
    if (!model) { _status('Project not found'); return; }
    _model = model;
    window.MV2.recomputeIntoModel(model);  // re-time subtitles for the current speed/trim (no-op without STT segments)
    window.MV2Compositor.load(model);
    _applyFitZoom(model);                 // default to a zoom that shows the whole timeline
    window.MV2Timeline.render(model, _selected);
    _renderMedia();
    _renderInspector();
    const exBtn = document.getElementById('mv2-export');
    if (exBtn && !_exportJob) exBtn.disabled = !(model.main && model.main.length);
    _setSaveCloseEnabled(true);
    _disarmDelete();
    _status(model.main.length + ' segment(s) · ' + (Math.round(model.totalDur * 100) / 100).toFixed(2) + 's');
    _maybeAutoSubtitles();
  }

  // ── Auto-generate subtitles once per project ─────────────────────────────────
  // The first time a project with talking-head audio and no subtitles yet is
  // opened, transcribe it in the background (headless: an activity-log row + the
  // completion chime, no popup). Guarded by sttAutoDone so it never re-fires on
  // reloads or when the user has already added/edited subtitles.
  function _maybeAutoSubtitles() {
    if (!_model) return;
    if (_model.sttAutoDone) return;
    if (_model.subsEnabled === false) return;
    if (_model.srtRawText && _model.srtRawText.trim()) return; // already has subtitles
    const hasAudio = (_model.main || []).some(c => c.audioPath);
    if (!hasAudio) return;
    window.MV2.setFields(_sessionKey, { sttAutoDone: true }); // stamp immediately to avoid double-trigger
    _autoSttGenerate(_sessionKey);
  }

  // Apply a finished STT job: prefer raw per-fragment words (enables proper
  // re-timing on speed/trim change); fall back to the flat words if the server
  // didn't return segWords. audioClips is the ordered list of audio-bearing main
  // clips that produced the segments (index-aligned with sj.segWords).
  function _applySttDone(sessionKey, sj, audioClips) {
    if (Array.isArray(sj.segWords) && sj.segWords.length && audioClips) {
      const srtSegments = sj.segWords
        .map(sw => ({ idx: audioClips[sw.index] ? audioClips[sw.index].idx : null, words: sw.words }))
        .filter(seg => seg.idx != null);
      window.MV2.storeSttSegments(sessionKey, srtSegments);
    } else {
      window.MV2.storeSttResult(sessionKey, sj.srtContent || '', sj.words || []);
    }
  }

  async function _autoSttGenerate(sessionKey) {
    const audioClips = (_model.main || []).filter(c => c.audioPath);
    const segs = audioClips.map(c => ({ audioPath: c.audioPath, timeOffset: c.start }));
    if (!segs.length) return;
    const row = window.createActivityRow ? window.createActivityRow('Subtitles · ' + (_model.title || 'project')) : null;
    row && row.setStatus('🎙 Auto subtitles…');
    try {
      const rj = await (await fetch('/api/audio/stt', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ segments: segs }),
      })).json();
      if (!rj.success) throw new Error(rj.error || 'STT start failed');
      const jobId = rj.jobId;
      await new Promise((resolve) => {
        const poll = setInterval(async () => {
          try {
            const sj = await (await fetch('/api/audio/stt/status/' + jobId)).json();
            if (!sj.success) return;
            if (sj.state === 'done') {
              clearInterval(poll);
              _applySttDone(sessionKey, sj, audioClips);
              if (_sessionKey === sessionKey) _reload();
              row && row.finalize('✅ Subtitles ready');   // success → rings the chime
              resolve();
            } else if (sj.state === 'failed') {
              clearInterval(poll);
              row && row.finalize('❌ ' + (sj.error || 'STT failed').slice(0, 50));
              resolve();
            } else {
              row && row.setStatus('Processing' + (sj.progress ? ' (' + sj.progress + ')' : '…'));
            }
          } catch (e) { /* transient — keep polling */ }
        }, 3000);
      });
    } catch (e) {
      row && row.finalize('❌ ' + ((e && e.message) || 'STT error').slice(0, 50));
    }
  }

  // Set the zoom slider so the entire timeline fits the visible width (no scroll),
  // and lower the slider min if needed so that fit level is always reachable.
  function _applyFitZoom(model) {
    const wrap = document.getElementById('mv2-tracks-wrap');
    const z = document.getElementById('mv2-zoom');
    if (!wrap || !z || !model || !model.totalDur) return;
    const labelW = 64;
    const avail = Math.max(50, wrap.clientWidth - labelW - 14); // minus track label + padding
    const fit = avail / model.totalDur;                          // px/sec to fit the whole timeline
    const max = parseInt(z.max, 10) || 240;
    const lo = Math.max(2, Math.min(20, Math.floor(fit)));       // ensure min ≤ fit so fit is reachable
    z.min = String(lo);
    z.value = String(Math.max(lo, Math.min(Math.round(fit), max)));
  }

  // Rebuild the model after an edit, preserving the current playhead + selection.
  async function _reload() {
    if (!_sessionKey) return;
    const model = await window.MV2.buildModel(_sessionKey);
    if (!model) return;
    _model = model;
    window.MV2.recomputeIntoModel(model);  // re-time subtitles after any timing edit (speed / trim / exclude)
    if (_selected && _selected.kind !== 'track' && !_findSelected()) _selected = null; // clip vanished (deleted/converted)
    window.MV2Compositor.load(model);   // load() preserves clockT if within range
    window.MV2Timeline.render(model, _selected);
    _renderMedia();
    _renderInspector();
    try { window.__mv2SubsPreview && window.__mv2SubsPreview(); } catch (e) {}  // refresh live subtitle preview if popup open
  }

  // ── Selection ───────────────────────────────────────────────────────────────
  function _findSelected() {
    if (!_model || !_selected) return null;
    const pools = { main: _model.main, birol: _model.birols, hook: _model.hooks, halfer: _model.halfers, music: _model.musicClips };
    const arr = pools[_selected.kind] || [];
    return arr.find(c => (c.kind === 'main' ? c.idx : c.key) === _selected.key) || null;
  }

  MV2Tab.selectClip = function (kind, key) {
    _selected = kind ? { kind, key } : null;
    window.MV2Timeline.applySelection(_selected); // in-place (drag-safe, no rebuild)
    _renderInspector();
  };
  MV2Tab.getSelected = function () { return _selected; };

  // Select a whole track (clicking its name) → inspector shows track-wide effects.
  MV2Tab.selectTrack = function (scope) {
    _selected = { kind: 'track', scope };
    window.MV2Timeline.applySelection(null); // clear clip highlights
    _renderInspector();
  };

  // Drop a library track onto the Music lane → ADD a music instance there.
  // `at` null → butt after the last music clip (repeat-add). Probes the source
  // length so the new clip spans the full track at its default speed.
  MV2Tab.setMusicFromDrop = async function (url, at) {
    if (!_sessionKey) { _status('Select a project first'); return; }
    _pushHistory();
    let srcDur = 0; try { srcDur = await window.MV2.getVideoDuration(url) || 0; } catch {}
    await window.MV2.addMusic(_sessionKey, url, (at == null ? null : Math.max(0, +at || 0)), srcDur);
    _status('Music added'); _reload();
  };

  // Copy the insert layout (birols/hooks/halfers + timings) from another project.
  function _openCopyFrom() {
    if (!_sessionKey) { _status('Select a project first'); return; }
    document.getElementById('mv2-copy-overlay')?.remove();
    const sources = window.MV2.listCopySources(_sessionKey);

    const overlay = document.createElement('div');
    overlay.id = 'mv2-copy-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:10055;display:flex;align-items:center;justify-content:center;';
    overlay.addEventListener('mousedown', e => { if (e.target === overlay) overlay.remove(); });
    const box = document.createElement('div');
    box.style.cssText = 'background:#f0f0f0;border:1.5px solid #999;border-radius:6px;width:min(94vw,440px);max-height:80vh;display:flex;flex-direction:column;box-shadow:0 8px 40px rgba(0,0,0,.5);';
    box.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:#e0e0e0;border-bottom:1.5px solid #bbb;border-radius:6px 6px 0 0;"><b style="font-size:13px;">Copy insert layout from…</b></div>';
    const body = document.createElement('div'); body.style.cssText = 'padding:8px;overflow:auto;display:flex;flex-direction:column;gap:4px;';

    if (!sources.length) {
      const e = document.createElement('div'); e.className = 'mv2-insp-hint'; e.style.padding = '8px';
      e.textContent = 'No other projects with birols / hooks / halfers.';
      body.appendChild(e);
    } else {
      sources.forEach(src => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:5px 6px;border:1px solid #ccc;border-radius:3px;';
        const info = document.createElement('div'); info.style.cssText = 'flex:1;min-width:0;';
        const nm = document.createElement('div'); nm.style.cssText = 'font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'; nm.textContent = src.label;
        const st = document.createElement('div'); st.className = 'mv2-insp-hint';
        st.textContent = [src.b && (src.b + ' birol'), src.h && (src.h + ' hook'), src.ha && (src.ha + ' halfer')].filter(Boolean).join(' · ');
        info.appendChild(nm); info.appendChild(st);
        const btn = document.createElement('button'); btn.textContent = 'Copy'; btn.style.cssText = 'font-size:10px;padding:2px 10px;cursor:pointer;';
        btn.onclick = () => {
          _pushHistory();
          window.MV2.copyLayoutFrom(_sessionKey, src.sessionKey);
          overlay.remove();
          _reload();
          _status('Copied layout from ' + src.label);
        };
        row.appendChild(info); row.appendChild(btn);
        body.appendChild(row);
      });
    }
    box.appendChild(body); overlay.appendChild(box); document.body.appendChild(overlay);
  }

  // Insert a media item (birol/hook) at a specific time — used by drag-and-drop.
  MV2Tab.insertMediaAt = async function (kind, key, at) {
    if (!_sessionKey) { _status('Select a project first'); return; }
    _pushHistory();
    const item = (window.MV2.listMedia(kind) || [])[kind === 'hook' ? key : null] ||
                 (window.MV2.listMedia(kind) || []).find(x => x.id === key);
    const srcDur = item ? await window.MV2.getVideoDuration(item.videoPath) : 0;
    window.MV2.addInsert(_sessionKey, kind, key, Math.max(0, at || 0), srcDur > 0 ? srcDur : 6);
    _status('Inserted ' + (item && item.name ? item.name : kind) + ' at ' + (at || 0).toFixed(2) + 's');
    _reload();
  };

  // ── Subtitles popup: left = text (generate/edit), right = libass style ──────
  function _sRow(labelText, control) {
    const row = document.createElement('div'); row.className = 'mv2-srow';
    const l = document.createElement('label'); l.textContent = labelText; row.appendChild(l);
    row.appendChild(control);
    return row;
  }
  function _onAss(field, getVal) {
    return () => { _pushHistory(); window.MV2.setAss(_sessionKey, { [field]: getVal() }); _reload(); };
  }

  const _ASS_POS = [
    ['tl', 'Top L'], ['tc', 'Top C'], ['tr', 'Top R'],
    ['ul', 'Upper L'], ['uc', 'Upper C'], ['ur', 'Upper R'],
    ['ml', 'Middle L'], ['mc', 'Middle C'], ['mr', 'Middle R'],
    ['ll', 'Lower L'], ['lc', 'Lower C'], ['lr', 'Lower R'],
    ['bl', 'Bottom L'], ['bc', 'Bottom C'], ['br', 'Bottom R'],
  ];

  MV2Tab.openSubtitles = function () {
    if (!_sessionKey || !_model) { _status('Select a project first'); return; }
    document.getElementById('mv2-subs-overlay')?.remove();
    const ass = _model.assSettings || {};

    const overlay = document.createElement('div');
    overlay.id = 'mv2-subs-overlay';
    let _onClose = () => overlay.remove();   // reassigned below to also clean up the preview hook + drag listeners
    overlay.addEventListener('mousedown', e => { if (e.target === overlay) _onClose(); });

    const box = document.createElement('div'); box.id = 'mv2-subs-box';
    const head = document.createElement('div'); head.id = 'mv2-subs-head';
    const ttl = document.createElement('b'); ttl.textContent = 'Subtitles';
    const xBtn = document.createElement('button'); xBtn.id = 'mv2-subs-x'; xBtn.textContent = '✕';
    xBtn.onclick = () => _onClose();
    head.appendChild(ttl); head.appendChild(xBtn);
    box.appendChild(head);

    const body = document.createElement('div'); body.id = 'mv2-subs-body';

    // ── Left column: text ─────────────────────────────────────────────────
    const colT = document.createElement('div'); colT.id = 'mv2-subs-col-text';
    const hT = document.createElement('div'); hT.className = 'mv2-subs-h'; hT.textContent = 'Text';
    colT.appendChild(hT);

    const genRow = document.createElement('div'); genRow.id = 'mv2-subs-genrow';
    const genBtn = document.createElement('button'); genBtn.id = 'mv2-subs-gen'; genBtn.textContent = '🎙 Generate';
    const genStatus = document.createElement('span'); genStatus.id = 'mv2-subs-status';
    const enWrap = document.createElement('label'); enWrap.style.cssText = 'display:flex;align-items:center;gap:5px;font-size:10px;margin-left:auto;';
    enWrap.appendChild(document.createTextNode('Show'));
    enWrap.appendChild(_switch(_model.subsEnabled, (on) => { _pushHistory(); window.MV2.setAdv(_sessionKey, { subsEnabled: on }); _reload(); }));
    genRow.appendChild(genBtn); genRow.appendChild(genStatus); genRow.appendChild(enWrap);
    colT.appendChild(genRow);

    const ta = document.createElement('textarea'); ta.id = 'mv2-subs-ta';
    ta.value = _model.srtRawText ||
      ((_model.subtitles && _model.subtitles.length && typeof _rebuildSrt === 'function') ? _rebuildSrt(_model.subtitles) : '');
    ta.placeholder = 'SRT subtitles — generate above, or paste/edit here, then Save.';
    colT.appendChild(ta);

    const saveRow = document.createElement('div'); saveRow.id = 'mv2-subs-saverow';
    const saveBtn = document.createElement('button'); saveBtn.id = 'mv2-subs-save'; saveBtn.textContent = '💾 Save text';
    saveBtn.onclick = () => { _pushHistory(); window.MV2.setSubtitlesFromSrt(_sessionKey, ta.value); _reload(); genStatus.textContent = '✓ Saved'; };
    const saveHint = document.createElement('span'); saveHint.className = 'mv2-insp-hint';
    saveHint.textContent = 'Groq Whisper / kie.ai per fragment.';
    saveRow.appendChild(saveBtn); saveRow.appendChild(saveHint);
    colT.appendChild(saveRow);

    // ── Right column: libass style ────────────────────────────────────────
    const colS = document.createElement('div'); colS.id = 'mv2-subs-col-style';
    const hS = document.createElement('div'); hS.className = 'mv2-subs-h'; hS.textContent = 'Style (libass)';
    colS.appendChild(hS);

    // Font
    const fontSel = document.createElement('select');
    const fonts = (typeof ASS_FONTS !== 'undefined') ? ASS_FONTS.map(f => f.name)
      : ['Impact', 'Arial', 'Arial Black', 'Verdana', 'Tahoma', 'Georgia', 'Courier New'];
    fonts.forEach(n => { const o = document.createElement('option'); o.value = n; o.textContent = n; fontSel.appendChild(o); });
    fontSel.value = ass.fontName || 'Impact';
    fontSel.onchange = _onAss('fontName', () => fontSel.value);
    colS.appendChild(_sRow('Font', fontSel));

    // Size
    const sizeInp = document.createElement('input'); sizeInp.type = 'number'; sizeInp.min = '10'; sizeInp.max = '200'; sizeInp.step = '1';
    sizeInp.value = ass.fontSize != null ? ass.fontSize : 85;
    sizeInp.onchange = _onAss('fontSize', () => parseInt(sizeInp.value, 10) || 85);
    colS.appendChild(_sRow('Size (px)', sizeInp));

    // Bold / Italic
    const biWrap = document.createElement('div'); biWrap.className = 'mv2-srow-2';
    const bLbl = document.createElement('label'); bLbl.appendChild(document.createTextNode('Bold'));
    bLbl.appendChild(_switch(ass.bold, on => { _pushHistory(); window.MV2.setAss(_sessionKey, { bold: on }); _reload(); }));
    const iLbl = document.createElement('label'); iLbl.appendChild(document.createTextNode('Italic'));
    iLbl.appendChild(_switch(ass.italic, on => { _pushHistory(); window.MV2.setAss(_sessionKey, { italic: on }); _reload(); }));
    biWrap.appendChild(bLbl); biWrap.appendChild(iLbl);
    colS.appendChild(_sRow('Weight', biWrap));

    // Text color
    const txtColor = document.createElement('input'); txtColor.type = 'color'; txtColor.value = ass.primaryColor || '#ffffff';
    txtColor.onchange = _onAss('primaryColor', () => txtColor.value);
    colS.appendChild(_sRow('Text color', txtColor));

    // Outline color + width
    const outColor = document.createElement('input'); outColor.type = 'color'; outColor.value = ass.outlineColor || '#000000';
    outColor.onchange = _onAss('outlineColor', () => outColor.value);
    colS.appendChild(_sRow('Outline color', outColor));

    const outW = document.createElement('input'); outW.type = 'number'; outW.min = '0'; outW.max = '10'; outW.step = '0.5';
    outW.value = ass.outline != null ? ass.outline : 2.5;
    outW.onchange = _onAss('outline', () => parseFloat(outW.value) || 0);
    colS.appendChild(_sRow('Outline px', outW));

    // Shadow
    const shadow = document.createElement('input'); shadow.type = 'number'; shadow.min = '0'; shadow.max = '10'; shadow.step = '0.5';
    shadow.value = ass.shadow != null ? ass.shadow : 1;
    shadow.onchange = _onAss('shadow', () => parseFloat(shadow.value) || 0);
    colS.appendChild(_sRow('Shadow px', shadow));

    // Position is set by dragging the sample text in the middle preview (fine,
    // continuous vertical), so the old 3x5 grid is gone. Always horizontally centered.

    // Words shown ON SCREEN at once (subtitle cue size) — NOT line-wrapping. A
    // wide cue wraps across lines automatically (libass on export, CSS in
    // preview). Stored key stays `wordsPerLine` (= words per cue/group).
    const wpl = document.createElement('input'); wpl.type = 'number'; wpl.min = '1'; wpl.max = '12'; wpl.step = '1';
    wpl.value = ass.wordsPerLine != null ? ass.wordsPerLine : 3;
    wpl.title = 'How many words appear on screen at once (per subtitle cue). A wide cue wraps to more lines automatically.';
    wpl.onchange = _onAss('wordsPerLine', () => parseInt(wpl.value, 10) || 3);
    colS.appendChild(_sRow('Words on screen', wpl));

    // Karaoke
    const kar = document.createElement('select');
    [['kf', 'Sweep (karaoke)'], ['none', 'Off']].forEach(([v, l]) => { const o = document.createElement('option'); o.value = v; o.textContent = l; kar.appendChild(o); });
    kar.value = ass.karaokeStyle || 'kf';
    kar.onchange = _onAss('karaokeStyle', () => kar.value);
    colS.appendChild(_sRow('Karaoke', kar));

    // Karaoke sweep colour (the next-word highlight — used to be hard-coded red)
    const karColor = document.createElement('input'); karColor.type = 'color'; karColor.value = ass.secondaryColor || '#ff0000';
    karColor.onchange = _onAss('secondaryColor', () => karColor.value);
    colS.appendChild(_sRow('Karaoke color', karColor));

    // Background box (borderStyle 3 = opaque box) + its colour + transparency
    const boxWrap = document.createElement('div'); boxWrap.className = 'mv2-srow-2';
    const boxLbl = document.createElement('label'); boxLbl.appendChild(document.createTextNode('Box'));
    boxLbl.appendChild(_switch((parseInt(ass.borderStyle, 10) || 1) >= 3, on => { _pushHistory(); window.MV2.setAss(_sessionKey, { borderStyle: on ? 3 : 1 }); _reload(); }));
    const boxColor = document.createElement('input'); boxColor.type = 'color'; boxColor.value = ass.backColor || '#000000';
    boxColor.onchange = _onAss('backColor', () => boxColor.value);
    boxWrap.appendChild(boxLbl); boxWrap.appendChild(boxColor);
    colS.appendChild(_sRow('Background', boxWrap));

    const boxAlpha = document.createElement('input'); boxAlpha.type = 'range'; boxAlpha.min = '0'; boxAlpha.max = '255'; boxAlpha.step = '5';
    boxAlpha.value = (ass.backAlpha != null ? ass.backAlpha : 128);
    boxAlpha.title = '0 = solid, 255 = fully transparent';
    boxAlpha.onchange = _onAss('backAlpha', () => parseInt(boxAlpha.value, 10));
    colS.appendChild(_sRow('Box transparency', boxAlpha));

    const styleHint = document.createElement('span'); styleHint.className = 'mv2-insp-hint';
    styleHint.textContent = 'Preview is approximate — exact styling is applied by FFmpeg/libass on export.';
    colS.appendChild(styleHint);

    // ── Middle column: live preview (static 9:16 stage, sample text) ──────────
    const colP = document.createElement('div'); colP.id = 'mv2-subs-col-preview';
    const hP = document.createElement('div'); hP.className = 'mv2-subs-h'; hP.textContent = 'Preview';
    const stage = document.createElement('div'); stage.id = 'mv2-subs-stage';
    const subEl = document.createElement('div'); subEl.id = 'mv2-subs-sample';
    stage.appendChild(subEl);
    const pHint = document.createElement('div'); pHint.className = 'mv2-subs-phint'; pHint.textContent = 'Live — updates as you change the style. Drag the text to position.';
    colP.appendChild(hP); colP.appendChild(stage); colP.appendChild(pHint);

    function _escP(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
    function _rgbaHex(hex,a){ hex=String(hex||'#000').replace('#',''); if(hex.length===3)hex=hex.split('').map(c=>c+c).join(''); const r=parseInt(hex.slice(0,2),16)||0,g=parseInt(hex.slice(2,4),16)||0,b=parseInt(hex.slice(4,6),16)||0; return 'rgba('+r+','+g+','+b+','+(a==null?1:a)+')'; }
    function _posYFromAlign(pa){ const r=(pa||'bc')[0]; return r==='t'?9:r==='u'?27:r==='m'?50:r==='l'?72:90; }
    function _renderSubPreview() {
      const a = Object.assign({}, (typeof ASS_DEFAULTS!=='undefined'?ASS_DEFAULTS:{}), ((typeof getTimelineData==='function'?getTimelineData():{})[_sessionKey]||{}).assSettings || {});
      const H = stage.clientHeight || 281, sc = H/1920;
      const fs = Math.max(8,(a.fontSize||85)*sc);
      const _fam = (typeof ASS_FONTS!=='undefined' ? ((ASS_FONTS.find(f=>f.name===a.fontName)||{}).css) : '') || (a.fontName||'Impact');
      subEl.style.fontFamily = _fam;
      subEl.style.setProperty('--mv2-sub-font', _fam);   // wins over the global readable-font !important override
      subEl.style.fontSize = fs+'px';
      subEl.style.fontWeight = a.bold ? '800':'600';
      subEl.style.fontStyle = a.italic ? 'italic':'normal';
      subEl.style.color = a.primaryColor || '#fff';
      const ow=Math.max(0,(a.outline!=null?a.outline:2.5)*sc), shp=Math.max(0,(a.shadow!=null?a.shadow:1)*sc);
      const sh=[]; if(ow>0) for(let d=0;d<360;d+=30) sh.push((Math.cos(d*Math.PI/180)*ow).toFixed(1)+'px '+(Math.sin(d*Math.PI/180)*ow).toFixed(1)+'px 0 '+(a.outlineColor||'#000'));
      if(shp>0) sh.push(shp.toFixed(1)+'px '+shp.toFixed(1)+'px '+(shp*1.2).toFixed(1)+'px '+(a.shadowColor||'#000'));
      subEl.style.textShadow = sh.join(', ');
      const isBox=(parseInt(a.borderStyle,10)||1)>=3;
      subEl.style.background = isBox ? _rgbaHex(a.backColor||'#000', 1-((a.backAlpha!=null?a.backAlpha:128)/255)) : 'transparent';
      subEl.style.padding = isBox ? ((fs*0.18).toFixed(0)+'px '+(fs*0.45).toFixed(0)+'px') : '0';
      subEl.style.borderRadius = isBox ? ((fs*0.28).toFixed(0)+'px') : '0';
      // Preview ONE on-screen cue = the first `wpl` words (what shows at once).
      // No forced line breaks: a wide cue wraps naturally by stage width, the
      // same way libass wraps on export. This mirrors "words on screen", not
      // "words per line".
      const wpl=Math.max(1,parseInt(a.wordsPerLine,10)||3);
      let pool=['Sample','subtitle','words','shown','on','screen','at','once','here'];
      try{const subs=(_model.subtitles||[]); const joined=subs.slice(0,4).map(s=>s&&s.text).filter(Boolean).join(' ').trim(); if(joined) pool=joined.split(/\s+/).filter(Boolean);}catch(e){}
      const cue=pool.slice(0,wpl);
      const kara=a.karaokeStyle&&a.karaokeStyle!=='none', sec=a.secondaryColor||'#ff0000';
      subEl.innerHTML = cue.map((w,wi)=> (kara&&wi===0)?('<span style="color:'+sec+'">'+_escP(w)+'</span>'):_escP(w)).join(' ');
      const posY=(a.posY!=null)?a.posY:_posYFromAlign(a.posAlign);
      subEl.style.top = posY+'%';
    }
    window.__mv2SubsPreview = _renderSubPreview;

    // Drag the sample text vertically to set the position (fine, continuous).
    (function(){
      let dy=null;
      subEl.addEventListener('mousedown', (e)=>{ e.preventDefault(); subEl.classList.add('dragging'); dy=null; });
      window.addEventListener('mousemove', _dragMove);
      window.addEventListener('mouseup', _dragUp);
      function _dragMove(e){ if(!subEl.classList.contains('dragging')) return; const r=stage.getBoundingClientRect(); dy=Math.max(5,Math.min(95,(e.clientY-r.top)/r.height*100)); subEl.style.top=dy+'%'; }
      function _dragUp(){ if(!subEl.classList.contains('dragging')) return; subEl.classList.remove('dragging'); if(dy!=null){ _pushHistory(); window.MV2.setAss(_sessionKey,{ posY: Math.round(dy) }); _reload(); } }
      subEl._cleanupDrag = ()=>{ window.removeEventListener('mousemove',_dragMove); window.removeEventListener('mouseup',_dragUp); };
    })();

    // Close cleanup: drop the live-preview hook + remove the window drag listeners.
    _onClose = () => { try { delete window.__mv2SubsPreview; } catch(e){} try { subEl._cleanupDrag && subEl._cleanupDrag(); } catch(e){} overlay.remove(); };

    body.appendChild(colT);
    body.appendChild(colP);
    body.appendChild(colS);
    box.appendChild(body);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    setTimeout(_renderSubPreview, 0);

    genBtn.onclick = () => _sttGenerate(genStatus, ta, genBtn);
  };

  async function _sttGenerate(statusEl, textarea, btn) {
    if (!_model) return;
    const audioClips = (_model.main || []).filter(c => c.audioPath);
    const segs = audioClips.map(c => ({ audioPath: c.audioPath, timeOffset: c.start }));
    if (!segs.length) { statusEl.textContent = '⚠ No audio'; return; }
    btn.disabled = true; statusEl.textContent = 'Requesting…';
    try {
      const r = await fetch('/api/audio/stt', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ segments: segs }),
      });
      const rj = await r.json();
      if (!rj.success) throw new Error(rj.error || 'Startup error');
      statusEl.textContent = rj.provider === 'groq' ? '⚡ Groq…' : '☁ kie.ai…';
      const jobId = rj.jobId;
      const poll = setInterval(async () => {
        try {
          const sr = await fetch('/api/audio/stt/status/' + jobId);
          const sj = await sr.json();
          if (!sj.success) return;
          if (sj.state === 'done') {
            clearInterval(poll); btn.disabled = false;
            const srt = sj.srtContent || '';
            _pushHistory();
            _applySttDone(_sessionKey, sj, audioClips);
            if (textarea) textarea.value = srt;
            statusEl.textContent = '✓ Done';
            _reload();
          } else if (sj.state === 'failed') {
            clearInterval(poll); btn.disabled = false;
            statusEl.textContent = '⚠ ' + (sj.error || 'Error').slice(0, 60);
          } else {
            statusEl.textContent = 'Processing' + (sj.progress ? ' (' + sj.progress + ')' : '…');
          }
        } catch {}
      }, 3000);
    } catch (e) {
      btn.disabled = false;
      statusEl.textContent = '⚠ ' + (e.message || e).slice(0, 60);
    }
  }

  // ── Effect option lists (shared by track + per-fragment inspector) ──────────
  const _TRANS_OPTS = [['none', 'None'], ['fade', 'Fade (black)'], ['fadewhite', 'Fade (white)'], ['blur', 'Blur In/Out'], ['whip-pan-h', 'Whip Pan ↔'], ['whip-pan-v', 'Whip Pan ↕'], ['zoom-punch-in', 'Zoom Punch In'], ['zoom-punch-out', 'Zoom Punch Out'], ['flash-white', 'Flash (white)'], ['glitch', 'Glitch']];
  const _ANIM_OPTS = [['none', 'None'], ['zoom_in', 'Zoom In (slow)'], ['zoom_out', 'Zoom Out (slow)']];
  const _FILTER_OPTS = [['none', 'None'], ['vignette', 'Vignette'], ['sharpen', 'Sharpen'], ['warm', 'Warm tone'], ['cool', 'Cool tone'], ['glitch', 'Glitch'], ['bw', 'B&W'], ['vhs', 'VHS / Vintage'], ['cinematic', 'Cinematic'], ['sepia', 'Sepia']];

  function _selFrom(opts, value) {
    const sel = document.createElement('select');
    opts.forEach(([v, l]) => { const o = document.createElement('option'); o.value = v; o.textContent = l; sel.appendChild(o); });
    sel.value = value;
    return sel;
  }

  // ── Compact Suno music generator (reuses /api/audio/suno/* endpoints) ───────
  MV2Tab.openMusicGen = function () {
    if (!_sessionKey) { _status('Select a project first'); return; }
    document.getElementById('mv2-mus-overlay')?.remove();
    const targetSec = _model ? Math.round(_model.totalDur || 0) : 0;

    const overlay = document.createElement('div');
    overlay.id = 'mv2-mus-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:10055;display:flex;align-items:center;justify-content:center;';
    overlay.addEventListener('mousedown', e => { if (e.target === overlay) overlay.remove(); });
    const box = document.createElement('div');
    box.style.cssText = 'background:#f0f0f0;border:1.5px solid #999;border-radius:6px;width:min(94vw,440px);display:flex;flex-direction:column;box-shadow:0 8px 40px rgba(0,0,0,.5);';
    box.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:#e0e0e0;border-bottom:1.5px solid #bbb;border-radius:6px 6px 0 0;"><b style="font-size:13px;">🎵 Music generator (Suno)</b></div>';

    const body = document.createElement('div'); body.style.cssText = 'padding:12px 14px;display:flex;flex-direction:column;gap:8px;';
    const banner = document.createElement('div');
    banner.className = 'mv2-insp-hint';
    banner.textContent = targetSec ? ('Timeline ≈ ' + targetSec + 's — generates a 3–5 min track to cover it.') : 'Generates a 3–5 min background track.';
    body.appendChild(banner);

    // Genre chips (multi-select) — composed into the Suno style prompt.
    const GENRES = ['Lo-fi', 'Cinematic', 'Corporate', 'Ambient', 'Phonk', 'Hip-hop', 'EDM', 'Acoustic', 'Trailer', 'Pop'];
    const selectedGenres = new Set();
    const gLbl = document.createElement('label'); gLbl.textContent = 'Genres'; gLbl.style.cssText = 'font-size:10px;color:#333;';
    body.appendChild(gLbl);
    const chipsRow = document.createElement('div'); chipsRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;';
    GENRES.forEach(g => {
      const c = document.createElement('button'); c.type = 'button'; c.textContent = g;
      const paint = () => { const on = selectedGenres.has(g); c.style.cssText = 'font-size:10px;padding:2px 8px;cursor:pointer;border:1px solid ' + (on ? '#1c5e85' : '#999') + ';border-radius:11px;background:' + (on ? '#2e86c1' : '#e8e6e0') + ';color:' + (on ? '#fff' : '#444') + ';font-weight:' + (on ? 'bold' : 'normal') + ';'; };
      c.addEventListener('click', () => { if (selectedGenres.has(g)) selectedGenres.delete(g); else selectedGenres.add(g); paint(); });
      paint(); chipsRow.appendChild(c);
    });
    body.appendChild(chipsRow);

    // BPM slider
    const bpmRow = document.createElement('div'); bpmRow.style.cssText = 'display:flex;align-items:center;gap:8px;';
    const bpmLbl = document.createElement('label'); bpmLbl.textContent = 'BPM'; bpmLbl.style.cssText = 'font-size:10px;color:#333;min-width:30px;';
    const bpmInp = document.createElement('input'); bpmInp.type = 'range'; bpmInp.min = '60'; bpmInp.max = '180'; bpmInp.step = '1'; bpmInp.value = '120'; bpmInp.style.cssText = 'flex:1;';
    const bpmVal = document.createElement('span'); bpmVal.textContent = '120'; bpmVal.style.cssText = 'font-size:11px;font-weight:bold;min-width:28px;text-align:right;';
    bpmInp.addEventListener('input', () => { bpmVal.textContent = bpmInp.value; });
    bpmRow.appendChild(bpmLbl); bpmRow.appendChild(bpmInp); bpmRow.appendChild(bpmVal);
    body.appendChild(bpmRow);

    const titleInp = document.createElement('input'); titleInp.type = 'text'; titleInp.placeholder = 'Title (optional)'; titleInp.value = 'UGC Background';
    titleInp.style.cssText = 'font-size:11px;padding:3px 5px;';
    const styleTa = document.createElement('textarea'); styleTa.rows = 2; styleTa.placeholder = 'Extra style notes (optional) — mood, instruments…';
    styleTa.style.cssText = 'font-size:11px;padding:5px;resize:vertical;font-family:inherit;';
    const modelSel = _selFrom([['V4_5PLUS', 'V4.5+'], ['V4_5', 'V4.5'], ['V5', 'V5'], ['V5_5', 'V5.5']], 'V4_5PLUS');
    modelSel.style.fontSize = '11px';

    [['Title', titleInp], ['Style', styleTa], ['Model', modelSel]].forEach(([lbl, ctl]) => {
      const row = document.createElement('div'); row.style.cssText = 'display:flex;flex-direction:column;gap:3px;';
      const l = document.createElement('label'); l.textContent = lbl; l.style.cssText = 'font-size:10px;color:#333;';
      row.appendChild(l); row.appendChild(ctl); body.appendChild(row);
    });

    const foot = document.createElement('div'); foot.style.cssText = 'display:flex;align-items:center;gap:10px;margin-top:4px;';
    const genBtn = document.createElement('button'); genBtn.textContent = '🎬 Generate'; genBtn.style.cssText = 'font-size:11px;padding:4px 12px;cursor:pointer;background:#2e86c1;color:#fff;border:1px solid #1c5e85;border-radius:3px;font-weight:bold;';
    const status = document.createElement('span'); status.className = 'mv2-insp-hint';
    const closeBtn = document.createElement('button'); closeBtn.textContent = 'Close'; closeBtn.style.cssText = 'font-size:10px;padding:3px 10px;cursor:pointer;margin-left:auto;';
    closeBtn.onclick = () => overlay.remove();
    foot.appendChild(genBtn); foot.appendChild(status); foot.appendChild(closeBtn);
    body.appendChild(foot);

    box.appendChild(body); overlay.appendChild(box); document.body.appendChild(overlay);

    genBtn.onclick = async () => {
      const parts = [...selectedGenres];
      if (styleTa.value.trim()) parts.push(styleTa.value.trim());
      parts.push(bpmInp.value + ' BPM');
      const style = parts.join(', ');
      if (!selectedGenres.size && !styleTa.value.trim()) { status.textContent = '⚠ Pick a genre or add a style note'; return; }
      genBtn.disabled = true; status.textContent = 'Sending to Suno…';
      try {
        const r = await fetch('/api/audio/suno/generate', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ style, title: titleInp.value.trim() || 'UGC Background', model: modelSel.value, targetDuration: targetSec || undefined }),
        });
        const rd = await r.json();
        if (!rd.success) throw new Error(rd.error || 'Suno error');
        const taskId = rd.taskId;
        const t0 = Date.now(); const MAX = 360 * 1000;
        const poll = setInterval(async () => {
          if (Date.now() - t0 > MAX) { clearInterval(poll); genBtn.disabled = false; status.textContent = '⚠ Timed out'; return; }
          status.textContent = 'Generating… (' + Math.round((Date.now() - t0) / 1000) + 's)';
          try {
            const sr = await fetch('/api/audio/suno/status/' + taskId);
            const sj = await sr.json();
            if (sj.state === 'success') {
              clearInterval(poll); genBtn.disabled = false;
              const trackId = 'suno_' + Math.round((Date.now() - t0)) + '_' + taskId.slice(-4);
              try {
                await fetch('/api/audio/suno/library', {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ id: trackId, title: titleInp.value.trim() || 'UGC Background', audioPath: sj.audioPath, style }),
                });
              } catch {}
              _pushHistory();
              let _sd = 0; try { _sd = await window.MV2.getVideoDuration(sj.audioPath) || 0; } catch {}
              await window.MV2.addMusic(_sessionKey, sj.audioPath, null, _sd);   // butt after last clip
              status.textContent = '✓ Track ready';
              _reload();
              setTimeout(() => overlay.remove(), 1200);
            } else if (sj.state === 'failed' || sj.state === 'error') {
              clearInterval(poll); genBtn.disabled = false; status.textContent = '⚠ ' + (sj.error || 'Failed').slice(0, 60);
            }
          } catch {}
        }, 4000);
      } catch (e) { genBtn.disabled = false; status.textContent = '⚠ ' + (e.message || e).slice(0, 60); }
    };
  };

  // ── History (per-session timeline_data_v2 snapshots) ────────────────────────
  function _snap() { const d = getTimelineData(); return JSON.stringify(d[_sessionKey] || {}); }
  function _restore(json) { const d = getTimelineData(); d[_sessionKey] = JSON.parse(json); setTimelineData(d); }
  function _pushHistory() {
    if (!_sessionKey) return;
    _undoStack.push(_snap());
    if (_undoStack.length > HISTORY_CAP) _undoStack.shift();
    _redoStack.length = 0;
  }
  function _undo() {
    if (!_undoStack.length) { _status('Nothing to undo'); return; }
    _redoStack.push(_snap());
    _restore(_undoStack.pop());
    _reload(); _status('Undo');
  }
  function _redo() {
    if (!_redoStack.length) { _status('Nothing to redo'); return; }
    _undoStack.push(_snap());
    _restore(_redoStack.pop());
    _reload(); _status('Redo');
  }
  // Exposed for the timeline edge-drag (snapshot before, reload after).
  MV2Tab.beginEdit = _pushHistory;
  MV2Tab.commitReload = _reload;

  function _deleteSelected() {
    if (!_selected || _selected.kind === 'track') return;
    _pushHistory();
    if (_selected.kind === 'main') {
      window.MV2.setExcluded(_sessionKey, _selected.key, true);
      _status('Segment excluded');
    } else if (_selected.kind === 'music') {
      window.MV2.removeMusic(_sessionKey, _selected.key);
      _status('Music removed');
    } else {
      window.MV2.removeInsert(_sessionKey, _selected.kind, _selected.key);
      _status('Clip removed');
    }
    _selected = null;
    _reload();
  }

  // ── Inspector (below the timeline) ──────────────────────────────────────────
  function _row(labelText, control) {
    const row = document.createElement('div'); row.className = 'mv2-insp-row';
    if (labelText) { const l = document.createElement('label'); l.textContent = labelText; row.appendChild(l); }
    row.appendChild(control);
    return row;
  }

  // Styled on/off toggle switch (replaces a bare checkbox)
  function _switch(checked, onChange) {
    const wrap = document.createElement('label'); wrap.className = 'mv2-switch';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!checked;
    const sl = document.createElement('span'); sl.className = 'mv2-sl';
    cb.addEventListener('change', () => onChange(cb.checked));
    wrap.appendChild(cb); wrap.appendChild(sl);
    return wrap;
  }

  function _revRow(clip) {
    const sw = _switch(clip.reversed, (on) => {
      _pushHistory();
      if (clip.kind === 'main') window.MV2.setSegmentReversed(_sessionKey, clip.idx, on);
      else window.MV2.setInsertTiming(_sessionKey, clip.kind, clip.key, { reversed: on });
      _reload();
    });
    return _row('Reverse', sw);
  }

  // Effect dropdown (Transition / Animation / Filter). No "inherit" option: every
  // selection is an explicit value and an unset effect defaults to "none".
  function _fxSelect(opts, current, onChange) {
    const sel = document.createElement('select');
    opts.forEach(([v, l]) => { const o = document.createElement('option'); o.value = v; o.textContent = l; sel.appendChild(o); });
    sel.value = current || 'none';
    sel.onchange = () => onChange(sel.value);
    return sel;
  }

  // Applying a track-level effect STAMPS the value onto every clip of that track
  // (overwriting their individual values). Re-applying re-stamps. After a stamp
  // the user can still tweak individual clips.
  function _stampTrack(scope, trackField, clipField, value) {
    _pushHistory();
    window.MV2.setFields(_sessionKey, { [trackField]: value }); // remember the track choice
    if (scope === 'seg') {
      (_model.main || []).forEach(c => window.MV2.setSegmentEffect(_sessionKey, c.idx, { [clipField]: value }));
    } else {
      (_model.birols || []).forEach(c => window.MV2.setInsertTiming(_sessionKey, 'birol', c.key, { [clipField]: value }));
      (_model.hooks  || []).forEach(c => window.MV2.setInsertTiming(_sessionKey, 'hook',  c.key, { [clipField]: value }));
    }
    _reload();
  }

  // Track-level controls. Scopes: 'seg' (Main), 'biro' (Birols), 'hook' (Hooks),
  // 'halfer' (Halfers). Effects live on seg + biro (biro* is shared with hooks in
  // the render); Audio + Volume are per-track; SFX on seg + biro.
  // ── Music preview (one track at a time; the play button toggles play/stop) ─────
  let _musicPreview = null;   // { audio, btn }
  function _stopMusicPreview() {
    if (!_musicPreview) return;
    try { _musicPreview.audio.pause(); _musicPreview.audio.currentTime = 0; } catch {}
    try { _musicPreview.btn.textContent = '▶'; _musicPreview.btn.title = 'Preview'; } catch {}
    _musicPreview = null;
  }
  function _toggleMusicPreview(url, btn) {
    // Clicking the same track again stops it; clicking another switches.
    if (_musicPreview && _musicPreview.btn === btn) { _stopMusicPreview(); return; }
    _stopMusicPreview();
    let a; try { a = new Audio(url); a.volume = 0.8; } catch { return; }
    _musicPreview = { audio: a, btn };
    btn.textContent = '⏹'; btn.title = 'Stop';
    a.addEventListener('ended', () => { if (_musicPreview && _musicPreview.audio === a) _stopMusicPreview(); });
    a.play().catch(() => _stopMusicPreview());
  }

  // Music track inspector: generate + volume + speed + library table (drag to lane).
  function _renderMusicInspector(body) {
    _stopMusicPreview();   // stop any preview when the inspector rebuilds (buttons are recreated)
    const sd = (typeof getTimelineData === 'function') ? (getTimelineData()[_sessionKey] || {}) : {};
    const title = document.createElement('div'); title.className = 'mv2-insp-title'; title.textContent = 'Music track';
    body.appendChild(title);

    const genBtn = document.createElement('button'); genBtn.textContent = '🎵 Generate music';
    genBtn.style.cssText = 'font-size:11px;padding:3px 10px;cursor:pointer;';
    genBtn.onclick = () => MV2Tab.openMusicGen();
    body.appendChild(_row('', genBtn));

    const clips = (_model && _model.musicClips) || [];
    const cnt = document.createElement('span'); cnt.className = 'mv2-insp-hint';
    cnt.textContent = clips.length
      ? (clips.length + ' clip' + (clips.length > 1 ? 's' : '') + ' on the track — select one to set speed / volume, drag to move, drag edges to trim.')
      : 'No music yet. Generate one, drag a library track onto the Music lane, or ＋ below.';
    body.appendChild(cnt);

    const libLbl = document.createElement('span'); libLbl.className = 'mv2-insp-hint'; libLbl.textContent = 'Library — ＋ adds after the last clip; drag onto the lane to place at a point:';
    body.appendChild(libLbl);
    const libWrap = document.createElement('div'); libWrap.style.cssText = 'display:flex;flex-direction:column;gap:3px;max-height:200px;overflow-y:auto;';
    libWrap.textContent = 'Loading…';
    body.appendChild(libWrap);
    (async () => {
      let list = [];
      try { const d = await (await fetch('/api/audio/suno/library')).json(); list = (d && d.list) || []; } catch {}
      libWrap.innerHTML = '';
      if (!list.length) { const e = document.createElement('span'); e.className = 'mv2-insp-hint'; e.textContent = 'No saved tracks — Generate one.'; libWrap.appendChild(e); return; }
      list.forEach(tr => {
        const r = document.createElement('div'); r.draggable = true;
        r.style.cssText = 'display:flex;align-items:center;gap:4px;padding:2px 4px;border:1px solid #ccc;border-radius:3px;background:#fff;cursor:grab;';
        r.addEventListener('dragstart', (e) => { e.dataTransfer.effectAllowed = 'copy'; e.dataTransfer.setData('text/plain', JSON.stringify({ kind: 'music', url: tr.audioPath })); });
        const nm = document.createElement('span'); nm.textContent = (tr.title || 'track') + (tr.style ? (' · ' + tr.style) : ''); nm.title = nm.textContent;
        nm.style.cssText = 'flex:1;font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        const use = document.createElement('button'); use.textContent = '＋'; use.title = 'Add to the Music track (after the last clip)'; use.style.cssText = 'font-size:10px;padding:0 6px;cursor:pointer;';
        use.onclick = () => MV2Tab.setMusicFromDrop(tr.audioPath, null);
        const play = document.createElement('button'); play.textContent = '▶'; play.title = 'Preview'; play.style.cssText = 'font-size:10px;padding:0 6px;cursor:pointer;';
        play.onclick = () => _toggleMusicPreview(tr.audioPath, play);
        const del = document.createElement('button'); del.textContent = '🗑'; del.title = 'Delete from library'; del.style.cssText = 'font-size:10px;padding:0 5px;cursor:pointer;color:#a33;';
        del.onclick = async () => { del.disabled = true; try { await fetch('/api/audio/suno/library/' + encodeURIComponent(tr.id), { method: 'DELETE' }); r.remove(); } catch { del.disabled = false; } };
        r.appendChild(nm); r.appendChild(use); r.appendChild(play); r.appendChild(del);
        libWrap.appendChild(r);
      });
    })();
  }

  function _renderTrackInspector(body, scope) {
    if (scope === 'music') { _renderMusicInspector(body); return; }
    const sd = (typeof getTimelineData === 'function') ? (getTimelineData()[_sessionKey] || {}) : {};
    const TITLES = { seg: 'Main track — applies to all segments', biro: 'Birols track', hook: 'Hooks track', halfer: 'Halfers track' };
    const hasFx  = (scope === 'seg' || scope === 'biro');   // per-track effect + SFX UI
    const isSeg  = (scope === 'seg');

    const title = document.createElement('div'); title.className = 'mv2-insp-title';
    title.textContent = TITLES[scope] || 'Track';
    body.appendChild(title);

    // Main track: one speed that applies to EVERY talking-head segment and recomputes
    // the spine lengths. Inserts KEEP their absolute timeline position — changing a
    // track's speed must not move (or re-time) the other tracks' clips.
    if (isSeg) {
      const curSpeed = (sd.segSpeed != null) ? sd.segSpeed : 1;
      const tspd = document.createElement('input');
      tspd.type = 'range'; tspd.min = '0.5'; tspd.max = '2'; tspd.step = '0.05'; tspd.value = curSpeed; tspd.style.width = '90px';
      const tspdLbl = document.createElement('span'); tspdLbl.className = 'mv2-insp-hint'; tspdLbl.textContent = (+curSpeed).toFixed(2) + 'x';
      tspd.oninput = () => { tspdLbl.textContent = parseFloat(tspd.value).toFixed(2) + 'x'; };
      tspd.onchange = () => {
        _pushHistory();
        const newSpeed = parseFloat(tspd.value) || 1;
        const mains = (_model && _model.main) || [];
        mains.forEach(c => window.MV2.setSegmentSpeed(_sessionKey, c.idx, newSpeed));
        window.MV2.setFields(_sessionKey, { segSpeed: newSpeed });
        _reload();   // inserts stay put (no rescaleInserts)
      };
      const tspdRow = _row('Speed (all)', tspd); tspdRow.appendChild(tspdLbl); body.appendChild(tspdRow);
    }

    if (hasFx) {
      body.appendChild(_row('Transition', _fxSelect(_TRANS_OPTS, sd[scope + 'Transition'] || 'none', v => _stampTrack(scope, scope + 'Transition', 'transition', v))));
      body.appendChild(_row('Animation', _fxSelect(_ANIM_OPTS, sd[scope + 'Animation'] || 'none', v => _stampTrack(scope, scope + 'Animation', 'animation', v))));
      body.appendChild(_row('Filter', _fxSelect(_FILTER_OPTS, sd[scope + 'Filter'] || 'none', v => _stampTrack(scope, scope + 'Filter', 'filter', v))));
    }

    // Track volume master. main → segVolume; inserts → <scope>Volume. Per-clip Volume overrides it.
    const volKey = isSeg ? 'segVolume' : (scope + 'Volume');
    const curVol = (sd[volKey] != null) ? sd[volKey] : 1;
    const vol = document.createElement('input'); vol.type = 'range'; vol.min = '0'; vol.max = '1.5'; vol.step = '0.05'; vol.value = curVol; vol.style.width = '90px';
    const volLbl = document.createElement('span'); volLbl.className = 'mv2-insp-hint'; volLbl.textContent = Math.round(curVol * 100) + '%';
    vol.oninput = () => { volLbl.textContent = Math.round(parseFloat(vol.value) * 100) + '%'; };
    vol.onchange = () => { _pushHistory(); window.MV2.setFields(_sessionKey, { [volKey]: parseFloat(vol.value) }); _reload(); };
    const volRow = _row('Volume', vol); volRow.appendChild(volLbl); body.appendChild(volRow);

    // Audio on/off for the WHOLE insert track (stamps its clips + sets the default).
    if (!isSeg) {
      const kind = scope === 'hook' ? 'hook' : scope === 'halfer' ? 'halfer' : 'birol';
      const clipArr = scope === 'hook' ? (_model.hooks || []) : scope === 'halfer' ? (_model.halfers || []) : (_model.birols || []);
      const audAll = _switch(!!sd[scope + 'Audio'], (on) => {
        _pushHistory();
        window.MV2.setFields(_sessionKey, { [scope + 'Audio']: on });
        clipArr.forEach(c => window.MV2.setInsertTiming(_sessionKey, kind, c.key, { audio: on }));
        _reload();
      });
      body.appendChild(_row('Audio (all)', audAll));
    }

    if (hasFx) {
      // Track-level SFX (Main → segSfx, Birols → biroSfx). Played at clip junctions on export.
      const sfxSel = document.createElement('select');
      const none = document.createElement('option'); none.value = ''; none.textContent = '(no SFX)'; sfxSel.appendChild(none);
      window.MV2.getSfxList().forEach(s => { const o = document.createElement('option'); o.value = s.url; o.textContent = s.name; sfxSel.appendChild(o); });
      const curSfx = sd[scope + 'Sfx']; sfxSel.value = (curSfx && curSfx !== 'Нет') ? curSfx : '';
      sfxSel.onchange = () => { _pushHistory(); window.MV2.setFields(_sessionKey, { [scope + 'Sfx']: sfxSel.value || 'Нет' }); _reload(); };
      body.appendChild(_row('SFX', sfxSel));

      const sfxVol = document.createElement('input'); sfxVol.type = 'range'; sfxVol.min = '0'; sfxVol.max = '1'; sfxVol.step = '0.05';
      sfxVol.value = sd[scope + 'SfxVolume'] != null ? sd[scope + 'SfxVolume'] : 0.8; sfxVol.style.width = '90px';
      sfxVol.onchange = () => { _pushHistory(); window.MV2.setFields(_sessionKey, { [scope + 'SfxVolume']: parseFloat(sfxVol.value) }); _reload(); };
      body.appendChild(_row('SFX vol', sfxVol));
    }

    const hint = document.createElement('span'); hint.className = 'mv2-insp-hint';
    hint.textContent = isSeg
      ? 'Volume + effects apply to all talking-head segments.'
      : 'Track volume is the master for this track; each clip’s Volume overrides it.';
    body.appendChild(hint);
  }

  // Per-fragment effect overrides (main → segmentEffects, birol/hook → timings).
  function _fragFxRows(body, clip) {
    if (clip.kind === 'halfer') return; // halfer bands don't take effects in the render
    const sd = (typeof getTimelineData === 'function') ? (getTimelineData()[_sessionKey] || {}) : {};
    let src;
    if (clip.kind === 'main') src = (sd.segmentEffects || {})[clip.idx] || {};
    else if (clip.kind === 'hook') src = ((sd.hooks || {}).timings || {})[clip.key] || {};
    else src = (sd.timings || {})[clip.key] || {};
    const write = (patch) => {
      _pushHistory();
      if (clip.kind === 'main') window.MV2.setSegmentEffect(_sessionKey, clip.idx, patch);
      else window.MV2.setInsertTiming(_sessionKey, clip.kind, clip.key, patch);
      _reload();
    };
    body.appendChild(_row('Transition', _fxSelect(_TRANS_OPTS, src.transition || 'none', v => write({ transition: v }))));
    body.appendChild(_row('Animation', _fxSelect(_ANIM_OPTS, src.animation || 'none', v => write({ animation: v }))));
    body.appendChild(_row('Filter', _fxSelect(_FILTER_OPTS, src.filter || 'none', v => write({ filter: v }))));
  }

  function _renderInspector() {
    const body = document.getElementById('mv2-inspector-body');
    if (!body) return;
    body.innerHTML = '';
    if (_selected && _selected.kind === 'track') { _renderTrackInspector(body, _selected.scope); return; }
    const clip = _findSelected();
    if (!clip) {
      body.innerHTML = '<span class="mv2-insp-hint">Select a clip to edit it · click a track name for track-wide effects · Delete = remove · Ctrl+Z / Ctrl+Y = undo / redo</span>';
      return;
    }

    const title = document.createElement('div');
    title.className = 'mv2-insp-title';
    const kindLabel = clip.kind === 'main' ? 'Talking head'
      : clip.kind.charAt(0).toUpperCase() + clip.kind.slice(1);
    title.textContent = kindLabel + ': ' + (clip.name || '') +
      '  (' + clip.start.toFixed(2) + 's → ' + clip.end.toFixed(2) + 's)';
    body.appendChild(title);

    if (clip.kind === 'main') {
      // Per-fragment speed for the talking head. Changing it recompacts the spine,
      // but inserts KEEP their absolute timeline position (a speed change must not
      // move the other tracks' clips).
      const mspd = document.createElement('input');
      mspd.type = 'range'; mspd.min = '0.5'; mspd.max = '2'; mspd.step = '0.05'; mspd.value = clip.speed || 1; mspd.style.width = '90px';
      const mspdLbl = document.createElement('span'); mspdLbl.className = 'mv2-insp-hint'; mspdLbl.textContent = (clip.speed || 1).toFixed(2) + 'x';
      mspd.oninput = () => { mspdLbl.textContent = parseFloat(mspd.value).toFixed(2) + 'x'; };
      mspd.onchange = () => {
        _pushHistory();
        const newSpeed = parseFloat(mspd.value) || 1;
        window.MV2.setSegmentSpeed(_sessionKey, clip.idx, newSpeed);
        _reload();   // inserts stay put (no rescaleInserts)
      };
      const mspdRow = _row('Speed', mspd); mspdRow.appendChild(mspdLbl); body.appendChild(mspdRow);

      body.appendChild(_revRow(clip));
      _fragFxRows(body, clip);
      const exBtn = document.createElement('button');
      exBtn.className = 'mv2-insp-del';
      exBtn.textContent = 'Exclude segment';
      exBtn.onclick = () => { _pushHistory(); window.MV2.setExcluded(_sessionKey, clip.idx, true); _selected = null; _reload(); };
      body.appendChild(_row('', exBtn));
      const hint = document.createElement('span'); hint.className = 'mv2-insp-hint';
      hint.textContent = 'Speed resizes the fragment; inserts reposition proportionally.';
      body.appendChild(hint);
      return;
    }

    if (clip.kind === 'music') {
      // Speed resizes the clip on the timeline (same content, faster = shorter).
      const spd = document.createElement('input');
      spd.type = 'range'; spd.min = '0.5'; spd.max = '2'; spd.step = '0.05'; spd.value = clip.speed || 1; spd.style.width = '90px';
      const spdLbl = document.createElement('span'); spdLbl.className = 'mv2-insp-hint'; spdLbl.textContent = (clip.speed || 1).toFixed(2) + 'x';
      spd.oninput = () => { spdLbl.textContent = parseFloat(spd.value).toFixed(2) + 'x'; };
      spd.onchange = () => {
        _pushHistory();
        const newSpeed = parseFloat(spd.value) || 1;
        const oldSpeed = clip.speed || 1;
        let newDur = (clip.end - clip.start) * (oldSpeed / newSpeed);
        if (clip.srcDur > 0) newDur = Math.min(newDur, clip.srcDur / newSpeed);   // can't exceed the source
        window.MV2.setMusicTiming(_sessionKey, clip.key, { speed: spd.value, end: (clip.start + Math.max(0.2, newDur)).toFixed(2) });
        _reload();
      };
      const spdRow = _row('Speed', spd); spdRow.appendChild(spdLbl); body.appendChild(spdRow);

      const mv = (clip.volume != null) ? clip.volume : 0.5;
      const vol = document.createElement('input');
      vol.type = 'range'; vol.min = '0'; vol.max = '1.5'; vol.step = '0.05'; vol.value = mv; vol.style.width = '90px';
      const volLbl = document.createElement('span'); volLbl.className = 'mv2-insp-hint'; volLbl.textContent = Math.round(mv * 100) + '%';
      vol.oninput = () => { volLbl.textContent = Math.round(parseFloat(vol.value) * 100) + '%'; };
      vol.onchange = () => { _pushHistory(); window.MV2.setMusicTiming(_sessionKey, clip.key, { volume: parseFloat(vol.value) }); _reload(); };
      const volRow = _row('Volume', vol); volRow.appendChild(volLbl); body.appendChild(volRow);

      const rep = document.createElement('button'); rep.textContent = '⧉ Repeat after';
      rep.title = 'Add another copy of this track right after the last music clip';
      rep.style.cssText = 'font-size:11px;padding:3px 10px;cursor:pointer;';
      rep.onclick = async () => { _pushHistory(); await window.MV2.addMusic(_sessionKey, clip.url, null, clip.srcDur, clip.speed, clip.volume); _status('Music added'); _reload(); };
      body.appendChild(_row('', rep));

      const del = document.createElement('button'); del.className = 'mv2-insp-del'; del.textContent = 'Delete';
      del.onclick = () => _deleteSelected();
      body.appendChild(_row('', del));

      const hint = document.createElement('span'); hint.className = 'mv2-insp-hint';
      hint.textContent = 'Drag the clip to move · drag its edges to trim · speed changes its length.';
      body.appendChild(hint);
      return;
    }

    const isHalfer = clip.kind === 'halfer';
    const isBirolFamily = clip.kind === 'birol' || clip.kind === 'halfer';

    if (!isHalfer) {
      const sel = document.createElement('select');
      ['left', 'center', 'right'].forEach(v => { const o = document.createElement('option'); o.value = v; o.textContent = v; sel.appendChild(o); });
      sel.value = clip.cropAlign || 'center';
      sel.onchange = () => { _pushHistory(); window.MV2.setInsertTiming(_sessionKey, clip.kind, clip.key, { cropAlign: sel.value }); _reload(); };
      body.appendChild(_row('Align', sel));
    }

    const spd = document.createElement('input');
    spd.type = 'range'; spd.min = '0.25'; spd.max = '2'; spd.step = '0.05'; spd.value = clip.speed || 1; spd.style.width = '90px';
    const spdLbl = document.createElement('span'); spdLbl.className = 'mv2-insp-hint'; spdLbl.textContent = (clip.speed || 1).toFixed(2) + 'x';
    spd.oninput = () => { spdLbl.textContent = parseFloat(spd.value).toFixed(2) + 'x'; };
    spd.onchange = () => {
      _pushHistory();
      const newSpeed = parseFloat(spd.value) || 1;
      const oldSpeed = clip.speed || 1;
      // Speed resizes the clip on the timeline: same content plays, faster = shorter.
      let newDur = (clip.end - clip.start) * (oldSpeed / newSpeed);
      if (clip.srcDur > 0) newDur = Math.min(newDur, clip.srcDur / newSpeed);   // can't exceed the source
      const patch = { speed: spd.value, end: (clip.start + Math.max(0.1, newDur)).toFixed(2) };
      window.MV2.setInsertTiming(_sessionKey, clip.kind, clip.key, patch);
      _reload();
    };
    const spdRow = _row('Speed', spd); spdRow.appendChild(spdLbl); body.appendChild(spdRow);

    // Audio on/off for THIS insert (default muted) — overrides the track default.
    const audSw = _switch(!!clip.audioOn, (on) => {
      _pushHistory();
      window.MV2.setInsertTiming(_sessionKey, clip.kind, clip.key, { audio: on });
      _reload();
    });
    body.appendChild(_row('Audio', audSw));

    // Per-insert volume — overrides the track volume. Effective = this ?? track ?? 1.
    const insVol = (clip.volume != null) ? clip.volume : 1;
    const vol = document.createElement('input');
    vol.type = 'range'; vol.min = '0'; vol.max = '1.5'; vol.step = '0.05'; vol.value = insVol; vol.style.width = '90px';
    const volLbl = document.createElement('span'); volLbl.className = 'mv2-insp-hint'; volLbl.textContent = Math.round(insVol * 100) + '%';
    vol.oninput = () => { volLbl.textContent = Math.round(parseFloat(vol.value) * 100) + '%'; };
    vol.onchange = () => { _pushHistory(); window.MV2.setInsertTiming(_sessionKey, clip.kind, clip.key, { volume: parseFloat(vol.value) }); _reload(); };
    const volRow = _row('Volume', vol); volRow.appendChild(volLbl); body.appendChild(volRow);

    body.appendChild(_revRow(clip));

    if (isBirolFamily) {
      const sw = _switch(isHalfer, () => {
        _pushHistory();
        const to = isHalfer ? 'birol' : 'halfer';
        window.MV2.convertInsert(_sessionKey, clip.kind, to, clip.key);
        _selected = { kind: to, key: clip.key };
        _reload();
      });
      body.appendChild(_row('Halfer (band)', sw));

      if (isHalfer) {
        const al = document.createElement('select');
        ['top', 'bottom'].forEach(v => { const o = document.createElement('option'); o.value = v; o.textContent = v; al.appendChild(o); });
        al.value = clip.halferAlign || 'top';
        al.onchange = () => { _pushHistory(); window.MV2.setInsertTiming(_sessionKey, 'halfer', clip.key, { halferAlign: al.value }); _reload(); };
        body.appendChild(_row('Band', al));

        const rot = document.createElement('select');
        [['0', '0°'], ['90', '90°'], ['180', '180°'], ['270', '270°']].forEach(([v, l]) => { const o = document.createElement('option'); o.value = v; o.textContent = l; rot.appendChild(o); });
        rot.value = String(clip.rotation != null ? clip.rotation : 90);
        rot.onchange = () => { _pushHistory(); window.MV2.setInsertTiming(_sessionKey, 'halfer', clip.key, { rotation: rot.value }); _reload(); };
        body.appendChild(_row('Rotation', rot));

        // At 0/180 the content is NOT stretched to fill the band — it covers the
        // band keeping aspect, and this Align picks which vertical part is kept.
        const rotVal = (clip.rotation != null) ? (parseInt(clip.rotation, 10) || 0) : 90;
        if (rotVal === 0 || rotVal === 180) {
          const va = document.createElement('select');
          ['top', 'bottom'].forEach(v => { const o = document.createElement('option'); o.value = v; o.textContent = v; va.appendChild(o); });
          va.value = clip.valign || 'top';
          va.onchange = () => { _pushHistory(); window.MV2.setInsertTiming(_sessionKey, 'halfer', clip.key, { valign: va.value }); _reload(); };
          body.appendChild(_row('Align', va));
        }
      }
    }

    _fragFxRows(body, clip);

    const del = document.createElement('button'); del.className = 'mv2-insp-del'; del.textContent = 'Delete';
    del.onclick = () => _deleteSelected();
    body.appendChild(_row('', del));
  }

  // ── Media library (left half of the preview area) ───────────────────────────
  function _uploadHooks() {
    let inp = document.getElementById('mv2-hook-upload-input');
    if (!inp) {
      inp = document.createElement('input');
      inp.type = 'file'; inp.id = 'mv2-hook-upload-input'; inp.accept = 'video/*'; inp.multiple = true; inp.style.display = 'none';
      document.body.appendChild(inp);
      inp.addEventListener('change', async () => {
        const files = Array.from(inp.files || []); inp.value = '';
        if (files.length && typeof openHooksUploadPopup === 'function') await openHooksUploadPopup(files);
      });
    }
    inp.click();
  }

  // Upload arbitrary videos (not hooks/birols). Saved on the server via the shared
  // upload endpoint, then added to the biroly archive under the Uploads category so
  // they show in the Uploads tab and can be placed on the Birols track.
  function _uploadVideos() {
    let inp = document.getElementById('mv2-upload-input');
    if (!inp) {
      inp = document.createElement('input');
      inp.type = 'file'; inp.id = 'mv2-upload-input'; inp.accept = 'video/*'; inp.multiple = true; inp.style.display = 'none';
      document.body.appendChild(inp);
      inp.addEventListener('change', async () => {
        const files = Array.from(inp.files || []); inp.value = '';
        if (!files.length) return;
        _status('Uploading ' + files.length + ' video(s)…');
        let ok = 0;
        for (const f of files) {
          try {
            const fd = new FormData();
            fd.append('video', f);
            fd.append('name', f.name.replace(/\.[^.]+$/, ''));
            const r = await fetch('/api/hooks/upload', { method: 'POST', body: fd });
            const d = await r.json();
            if (d && d.success && d.videoPath && typeof addPendingBirolyEntry === 'function') {
              const id = addPendingBirolyEntry(d.name || f.name, '', { categoryId: '__uploads__', categoryLabel: 'Uploads', source: 'upload' });
              if (typeof updateBirolyEntry === 'function') updateBirolyEntry(id, { videoPath: d.videoPath, thumbPath: d.thumbPath || null, imagePath: d.thumbPath || null, status: 'done' });
              ok++;
            }
          } catch (e) { /* keep going on the next file */ }
        }
        _renderMedia();
        _status(ok ? ('Uploaded ' + ok + ' video(s)') : 'Upload failed');
      });
    }
    inp.click();
  }

  function _renderMediaBar() {
    const bar = document.getElementById('mv2-media-bar');
    if (!bar) return;
    bar.innerHTML = '';
    if (_mediaTab === 'hook') {
      const up = document.createElement('button');
      up.textContent = '＋ Upload hooks';
      up.title = 'Upload new hook video files';
      up.onclick = _uploadHooks;
      bar.appendChild(up);
    } else if (_mediaTab === 'upload') {
      const up = document.createElement('button');
      up.textContent = '＋ Upload videos';
      up.title = 'Upload your own video files (added to the Birols track)';
      up.onclick = _uploadVideos;
      bar.appendChild(up);
      const hint = document.createElement('span'); hint.className = 'mv2-insp-hint'; hint.style.marginLeft = '8px';
      hint.textContent = 'Your own clips — placed on the Birols track.';
      bar.appendChild(hint);
    } else {
      bar.appendChild(document.createTextNode('Category:'));
      const sel = document.createElement('select');
      const cats = ((typeof getMergedCategories === 'function') ? getMergedCategories() : []).filter(c => c.id !== '__uploads__');
      const add = (v, l) => { const o = document.createElement('option'); o.value = v; o.textContent = l; sel.appendChild(o); };
      add('', '— select category —');   // no "all categories"; organize/browse all in Library
      cats.forEach(c => add(c.id, c.label || c.id));
      add('__uncat__', 'Uncategorized');
      sel.value = _birolCat;
      sel.onchange = () => { _birolCat = sel.value; _birolPage = 0; _renderMedia(); };
      bar.appendChild(sel);

      // 💡 Ideas — opens the b-roll ideas popup locked to this project's scenario.
      const ideasBtn = document.createElement('button');
      ideasBtn.textContent = '💡 Ideas';
      ideasBtn.title = 'Generate b-roll ideas from this project’s scenario';
      ideasBtn.style.cssText = 'margin-left:auto;background:#fff0b5;font-weight:bold;';
      ideasBtn.onclick = () => {
        if (typeof window.openBirolyIdeasPopup !== 'function') return;
        // sv2 projects don't store the scenario as a .txt — pass the live monologue
        // text so the Ideas popup analyzes THIS project. The model's main[].name
        // carries the line text (editFrozenSessions cells aren't hydrated on /merge).
        const lines = ((_model && _model.main) || []).map(m => String((m && m.name) || '').trim()).filter(Boolean);
        // Vertical is encoded in the project title: "DATE — VERTICAL — TYPE — ...".
        const _ttl = (_model && (_model.title || _model.scenName)) || '';
        const _vparts = _ttl.split('—').map(s => s.trim()).filter(Boolean);
        const _vertical = _vparts.length >= 2 ? _vparts[1] : '';
        window.openBirolyIdeasPopup({
          scenFile:     _model && _model.scenFile,
          scenarioText: lines.join('\n'),
          projectName:  _ttl || 'project',
          vertical:     _vertical,
          autoAnalyze:  true,
        });
      };
      bar.appendChild(ideasBtn);
    }
  }

  // Centered video preview popup: clicking a gallery card previews the clip so the
  // user can see what it is before dragging it onto the timeline. Close on ✕ / click
  // outside / Esc.
  function _openVideoPreview(url, name) {
    if (!url) { _status('No video to preview'); return; }
    document.getElementById('mv2-vid-preview')?.remove();
    const ov = document.createElement('div');
    ov.id = 'mv2-vid-preview';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:10060;display:flex;align-items:center;justify-content:center;';
    const box = document.createElement('div');
    box.style.cssText = 'background:#000;border:2px solid #808080;box-shadow:0 8px 40px rgba(0,0,0,.6);max-width:92vw;max-height:92vh;display:flex;flex-direction:column;';
    const cap = document.createElement('div');
    cap.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:11px;color:#ddd;background:#222;padding:4px 8px;';
    const nm = document.createElement('span');
    nm.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    nm.textContent = name || 'Preview';
    const x = document.createElement('button'); x.textContent = '✕'; x.style.cssText = 'font-size:11px;padding:1px 8px;cursor:pointer;';
    cap.appendChild(nm); cap.appendChild(x);
    const v = document.createElement('video');
    v.src = url; v.controls = true; v.autoplay = true; v.playsInline = true;
    v.style.cssText = 'max-width:92vw;max-height:82vh;display:block;background:#000;';
    box.appendChild(cap); box.appendChild(v); ov.appendChild(box); document.body.appendChild(ov);
    const close = () => { try { v.pause(); } catch {} ov.remove(); document.removeEventListener('keydown', onEsc, true); };
    const onEsc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    x.onclick = close;
    ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });
    document.addEventListener('keydown', onEsc, true);
  }

  // Non-overlapping start for a new insert: begin after the clip under the playhead
  // (if any), then push past any overlapping clips of the same kind — so repeat-adds
  // chain one after another instead of stacking on top of each other.
  function _nextInsertSlot(kind, dur) {
    const clips = (_model && (kind === 'hook' ? _model.hooks : _model.birols)) || [];
    let at = (window.MV2Compositor && window.MV2Compositor.clockT) || 0;
    const under = clips.find(c => at >= c.start && at < c.end);
    if (under) at = under.end;
    let guard = 0;
    while (guard++ < 500) {
      const hit = clips.find(c => c.start < at + dur && c.end > at);
      if (!hit) break;
      at = hit.end;
    }
    return at;
  }

  function _renderMedia() {
    _renderMediaBar();
    const grid = document.getElementById('mv2-media-grid');
    if (!grid) return;
    grid.innerHTML = '';
    // Lazy thumbnail loading: each card's image/video metadata is fetched only when the
    // card scrolls into the grid's viewport, so opening a tab/category does not fire a
    // request for every clip at once.
    if (_mediaIO) { _mediaIO.disconnect(); _mediaIO = null; }
    if ('IntersectionObserver' in window) {
      _mediaIO = new IntersectionObserver((entries, obs) => {
        entries.forEach(en => {
          if (!en.isIntersecting) return;
          const el = en.target;
          if (el.dataset.lazySrc) { el.src = el.dataset.lazySrc; delete el.dataset.lazySrc; }
          obs.unobserve(el);
        });
      }, { root: grid, rootMargin: '150px' });
    }
    let items = window.MV2.listMedia(_mediaTab);
    // Birols start EMPTY until a category is picked (browse/organize all in Library).
    if (_mediaTab === 'birol') {
      if (!_birolCat) {
        const e = document.createElement('div');
        e.className = 'mv2-media-empty';
        e.textContent = 'Pick a category from the dropdown above to see birols.';
        grid.appendChild(e);
        return;
      }
      const validCatIds = new Set(((typeof getMergedCategories === 'function') ? getMergedCategories() : []).map(c => c.id));
      if (_birolCat === '__uncat__') items = items.filter(it => !it.categoryId || !validCatIds.has(it.categoryId));
      else items = items.filter(it => it.categoryId === _birolCat);
    }
    if (!items.length) {
      const e = document.createElement('div');
      e.className = 'mv2-media-empty';
      e.textContent = _mediaTab === 'hook' ? 'No hooks yet — upload them in the Hooks tab.'
        : _mediaTab === 'upload' ? 'No uploads yet — use the “＋ Upload videos” button above.'
        : 'No birols in this category.';
      grid.appendChild(e);
      return;
    }
    // Pagination — large birol groups (Uncategorized can be hundreds) show 20/page
    // with a Prev/Next bar at the very bottom of the gallery.
    let pageItems = items, _mTotalPages = 1;
    if (_mediaTab === 'birol' && items.length > MV2_MEDIA_PAGE_SIZE) {
      _mTotalPages = Math.ceil(items.length / MV2_MEDIA_PAGE_SIZE);
      if (_birolPage >= _mTotalPages || _birolPage < 0) _birolPage = 0;
      const s = _birolPage * MV2_MEDIA_PAGE_SIZE;
      pageItems = items.slice(s, s + MV2_MEDIA_PAGE_SIZE);
    }
    pageItems.forEach((item, idx) => {
      const key = (_mediaTab === 'hook') ? idx : item.id;
      const insertKind = (_mediaTab === 'upload') ? 'birol' : _mediaTab;  // uploads go on the Birols track
      // No "active"/checkmark: clicking ALWAYS adds a new instance (repeat-add OK).
      // Removal is done on the timeline clip itself.
      const card = document.createElement('div');
      card.className = 'mv2-media-card';
      card.title = (item.name || '') + '\nClick to preview · drag onto the timeline to add';

      // Drag onto the timeline to insert at the drop position
      card.draggable = true;
      card.addEventListener('dragstart', (e) => {
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('text/plain', JSON.stringify({ kind: insertKind, key }));
      });

      const thumb = document.createElement(item.thumbPath ? 'img' : 'video');
      thumb.className = 'mv2-media-thumb';
      thumb.alt = item.label || '';
      // Defer the real src to the IntersectionObserver (lazy on scroll-in).
      if (item.thumbPath) { thumb.dataset.lazySrc = item.thumbPath; thumb.decoding = 'async'; }
      else { thumb.dataset.lazySrc = (item.videoPath || '') + '#t=0.5'; thumb.muted = true; thumb.preload = 'metadata'; }
      if (_mediaIO) _mediaIO.observe(thumb); else thumb.src = thumb.dataset.lazySrc;
      card.appendChild(thumb);

      const name = document.createElement('div');
      name.className = 'mv2-media-name';
      name.textContent = item.name || (_mediaTab === 'hook' ? 'Hook' : 'Birol');
      card.appendChild(name);

      // Small × (top-right) → delete this clip from the library, no confirm. Hooks live
      // in the hooks archive; birols/uploads in the biroly archive (+ the mp4 on disk).
      const del = document.createElement('button');
      del.className = 'mv2-media-x';
      del.textContent = '×';
      del.title = 'Delete from library';
      del.addEventListener('mousedown', (e) => e.stopPropagation());   // don't start a drag
      del.addEventListener('click', (e) => {
        e.stopPropagation();                                           // don't open the preview
        if (_mediaTab === 'hook') {
          if (typeof removeHookEntry === 'function') removeHookEntry(item);
        } else {
          if (item.videoPath) { try { fetch('/api/biroly/delete-video', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ videoPath: item.videoPath }) }); } catch {} }
          if (typeof removeBirolyEntry === 'function') removeBirolyEntry(item.id);
        }
        window.refreshTimelineBirolys?.();
        window.renderAllTimelines?.();
        _renderMedia();   // refresh the gallery
      });
      card.appendChild(del);

      // Click = preview the clip in a popup (adding is done by dragging onto the timeline).
      card.addEventListener('click', () => _openVideoPreview(item.videoPath, item.name || _mediaTab));

      grid.appendChild(card);
    });
    if (_mTotalPages > 1) grid.appendChild(_buildMediaPager(_birolPage, _mTotalPages));
  }

  // Centered Prev / "Page X / Y" / Next bar spanning the full gallery width.
  function _buildMediaPager(page, totalPages) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'width:100%;flex-basis:100%;grid-column:1/-1;display:flex;align-items:center;justify-content:center;gap:12px;padding:10px 4px 4px;box-sizing:border-box;';
    const mk = (label, disabled, target) => {
      const b = document.createElement('button');
      b.textContent = label; b.disabled = disabled;
      b.style.cssText = 'font-size:11px;padding:3px 12px;border:1px solid #888;border-radius:3px;' + (disabled ? 'opacity:0.4;cursor:default;' : 'cursor:pointer;');
      if (!disabled) b.addEventListener('click', () => { _birolPage = target; _renderMedia(); });
      return b;
    };
    wrap.appendChild(mk('‹ Prev', page <= 0, page - 1));
    const lbl = document.createElement('span');
    lbl.style.cssText = 'font-size:10px;color:#888;min-width:84px;text-align:center;';
    lbl.textContent = `Page ${page + 1} / ${totalPages}`;
    wrap.appendChild(lbl);
    wrap.appendChild(mk('Next ›', page >= totalPages - 1, page + 1));
    return wrap;
  }

  MV2Tab.activate = function () {
    _initOnce();
    const list = _refreshPicker();
    if (!list.length) {
      window.MV2Compositor.load(null);
      window.MV2Timeline.render(null);
      _status('Star a project in Merge to edit it here.');
      return;
    }
    let want = _sessionKey;
    if (!want) { try { want = localStorage.getItem(PREF_KEY); } catch {} }
    if (!want || !list.some(s => s.sessionKey === want)) want = list[0].sessionKey;
    _loadSession(want);
  };

  // Refresh the media gallery (called after a hook upload completes).
  MV2Tab.refreshMedia = function () { if (_inited) _reload(); };

  // ── Export via FFmpeg (reuses the SHARED buildRenderPayload → identical body) ─
  function _exportReset() {
    const btn = document.getElementById('mv2-export');
    if (btn) { btn.textContent = 'Export (FFmpeg)'; btn.disabled = !(_model && _model.main && _model.main.length); }
  }

  function _export() {
    const btn = document.getElementById('mv2-export');
    // Toggle = cancel a running job
    if (_exportJob) {
      try { fetch('/api/ffmpeg/cancel/' + _exportJob, { method: 'DELETE' }); } catch {}
      if (_exportPoll) { clearInterval(_exportPoll); _exportPoll = null; }
      _exportJob = null; _exportReset(); _status('Export cancelled');
      return;
    }
    if (!_sessionKey || !_model) { _status('Select a project first'); return; }

    const sd = (typeof getTimelineData === 'function') ? (getTimelineData()[_sessionKey] || {}) : {};
    const activeSegments = (_model.main || []).map(m => ({
      cell: { videoPath: m.videoPath, audioPath: m.audioPath, line: m.name }, idx: m.idx, activeStart: m.start, activeEnd: m.end,
    }));
    const payload = window.buildRenderPayload({
      sessionKey:  _sessionKey,
      activeSegments,
      totalDur:    _model.totalDur,
      rangePct:    { left: 0, right: 1 },
      musicClips:  _model.musicClips || [],
      segSfxUrl:   sd.segSfx || 'Нет',
      biroSfxUrl:  sd.biroSfx || 'Нет',
      outputLabel: _model.title || _sessionKey,
      advDefaults: (typeof ADV_DEFAULTS !== 'undefined') ? ADV_DEFAULTS : {},
      assDefaults: (typeof ASS_DEFAULTS !== 'undefined') ? ASS_DEFAULTS : {},
    });
    if (!payload.segmentClips.length) { _status('No video segments'); return; }

    if (btn) { btn.textContent = '⏹ Cancel'; }
    _status('Rendering…');

    fetch('/api/ffmpeg/render', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    }).then(async r => {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' — restart server');
      const rj = await r.json();
      if (!rj.success) throw new Error(rj.error || 'Startup error');
      _exportJob = rj.jobId;
      _exportPoll = setInterval(async () => {
        try {
          const sr = await fetch('/api/ffmpeg/status/' + _exportJob);
          const sj = await sr.json();
          if (!sj.success) return;
          if (sj.status === 'done') {
            clearInterval(_exportPoll); _exportPoll = null; _exportJob = null;
            _exportReset(); _status('✓ Done');
            _showExportResult(sj.url);
            // Register the render (keyed by sessionKey) so Delete can wipe it later.
            const pid = _sessionKey;
            try {
              fetch('/api/finals/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ renderUrl: sj.url, sessionLabel: (_model && _model.title) || pid, projectId: pid }),
              });
            } catch {}
          } else if (sj.status === 'failed' || sj.status === 'cancelled') {
            clearInterval(_exportPoll); _exportPoll = null; _exportJob = null;
            _exportReset(); _status(sj.status === 'cancelled' ? 'Cancelled' : (sj.error || 'Render error').slice(0, 120));
          } else if (sj.status === 'normalizing') {
            _status('Normalizing clips ' + (sj.normalizeCurrent ?? 0) + '/' + (sj.normalizeTotal ?? 0) + '…');
          } else {
            _status('Rendering…' + (sj.progressSecs > 0 ? ' (' + Math.round(sj.progressSecs) + 's)' : ''));
          }
        } catch {}
      }, 2000);
    }).catch(e => { _exportJob = null; _exportReset(); _status((e.message || e).slice(0, 120)); });
  }

  function _showExportResult(url) {
    document.getElementById('mv2-exp-overlay')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'mv2-exp-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:10060;display:flex;align-items:center;justify-content:center;';
    overlay.addEventListener('mousedown', e => { if (e.target === overlay) overlay.remove(); });
    const box = document.createElement('div');
    box.style.cssText = 'background:#1a1a1a;border:1.5px solid #555;border-radius:6px;padding:10px;display:flex;flex-direction:column;gap:8px;max-width:94vw;max-height:92vh;';
    const head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;color:#fff;font-size:12px;';
    head.innerHTML = '<b>Export result</b>';
    const close = document.createElement('button');
    close.textContent = '✕'; close.style.cssText = 'background:#444;color:#fff;border:1px solid #666;border-radius:3px;cursor:pointer;padding:2px 8px;';
    close.onclick = () => overlay.remove();
    head.appendChild(close);
    const vid = document.createElement('video');
    vid.src = url; vid.controls = true; vid.autoplay = true;
    vid.style.cssText = 'max-width:88vw;max-height:78vh;background:#000;';
    const dl = document.createElement('a');
    dl.href = url; dl.download = ''; dl.textContent = '⬇ Download / open';
    dl.target = '_blank';
    dl.style.cssText = 'color:#8cf;font-size:11px;text-decoration:underline;';
    box.appendChild(head); box.appendChild(vid); box.appendChild(dl);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  }

  window.MV2Tab = MV2Tab;
})();
