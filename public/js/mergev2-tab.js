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
  let _birolCat = '__favorites__'; // category filter for the Birols gallery (defaults to the Favorites view; '' = none picked)
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
  const PREF_KEY_VSL = 'mergev2_last_vsl_v1';
  const MODE_KEY = 'mv2_mode_v1';            // 'creatives' | 'vsl'
  let _vslVideos = [];                       // cached /api/vsl/list result

  function _mode() {
    const sel = document.getElementById('mv2-mode');
    if (sel && sel.value) return sel.value;
    try { return localStorage.getItem(MODE_KEY) || 'creatives'; } catch { return 'creatives'; }
  }
  function _prefKey() { return _mode() === 'vsl' ? PREF_KEY_VSL : PREF_KEY; }

  function _injectStyles() {
    if (document.getElementById('mv2-styles')) return;
    const css = `
/* Design tokens (palette) — single source for accents + ink */
#mv2-root, #mv2-subs-box { --mv2-ink:#333; --mv2-muted:#444; --mv2-accent:#2e86c1; --mv2-accent-d:#1c5e85; --mv2-purple:#7a5cae; --mv2-focus:#0a4fb5; }
#mv2-root { --mv2-insp-w:240px; --mv2-canvas-w:200px; }   /* resizable top columns (persisted) */
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
#mv2-media { flex:1 1 auto; min-width:120px; display:flex; flex-direction:column; background:#cfcbc3; }
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
.mv2-media-star { position:absolute; top:1px; left:1px; width:15px; height:15px; padding:0; margin:0; border:none; line-height:13px; font-size:13px; text-align:center; background:rgba(0,0,0,0.45); color:#fff; cursor:pointer; z-index:6; opacity:0.6; border-radius:2px; }
.mv2-media-star:hover { opacity:1; }
.mv2-media-star.on { color:#ffcc33; opacity:1; }
.mv2-media-empty { font-size:10px; color:#777; font-style:italic; padding:8px; }
#mv2-canvas-wrap { flex:0 0 var(--mv2-canvas-w,200px); min-width:120px; position:relative; display:flex; align-items:center; justify-content:center; overflow:hidden; }
#mv2-canvas { max-height:100%; max-width:100%; box-shadow:0 0 8px #000; background:#000; }
/* Preview overlay controls: quality (bottom-right) + fullscreen (bottom-left) */
.mv2-pv-ctl { position:absolute; bottom:6px; z-index:8; opacity:0.82; transition:opacity .12s; }
.mv2-pv-ctl:hover { opacity:1; }
#mv2-pv-quality { right:6px; font-size:10px; padding:2px 4px; background:rgba(0,0,0,0.6); color:#fff; border:1px solid #999; border-radius:3px; cursor:pointer; }
#mv2-pv-fs { left:6px; width:26px; height:24px; padding:0; font-size:14px; line-height:22px; text-align:center; background:rgba(0,0,0,0.6); color:#fff; border:1px solid #999; border-radius:3px; cursor:pointer; }
#mv2-pv-transport { left:50%; transform:translateX(-50%); display:flex; align-items:center; gap:8px; }
.mv2-pv-play, .mv2-pv-seg { background:rgba(0,0,0,0.6); color:#fff; border:1px solid #999; border-radius:3px; cursor:pointer; padding:0; text-align:center; }
.mv2-pv-play { width:36px; height:26px; font-size:14px; line-height:24px; }
.mv2-pv-seg { width:28px; height:24px; font-size:12px; line-height:22px; }
.mv2-pv-play:hover, .mv2-pv-seg:hover { background:rgba(0,0,0,0.85); }
#mv2-pv-vol { left:38px; }
#mv2-pv-vol-btn { width:26px; height:24px; padding:0; font-size:13px; line-height:22px; text-align:center; background:rgba(0,0,0,0.6); color:#fff; border:1px solid #999; border-radius:3px; cursor:pointer; }
#mv2-pv-vol-btn:hover { background:rgba(0,0,0,0.85); }
#mv2-pv-vol-pop { position:absolute; left:50%; bottom:28px; transform:translateX(-50%); background:rgba(0,0,0,0.78); border:1px solid #999; border-radius:5px; padding:9px 0; width:22px; display:flex; justify-content:center; opacity:0; visibility:hidden; transition:opacity .12s; }
#mv2-pv-vol:hover #mv2-pv-vol-pop, #mv2-pv-vol.open #mv2-pv-vol-pop, #mv2-pv-vol.dragging #mv2-pv-vol-pop { opacity:1; visibility:visible; }
#mv2-pv-vol-trk { position:relative; width:4px; height:60px; background:rgba(255,255,255,0.28); border-radius:3px; cursor:pointer; touch-action:none; }
#mv2-pv-vol-fill { position:absolute; left:0; bottom:0; width:100%; background:#fff; border-radius:3px; }
#mv2-pv-vol-knob { position:absolute; left:50%; width:11px; height:11px; border-radius:50%; background:#fff; transform:translate(-50%,50%); }
#mv2-canvas-wrap:fullscreen { width:100vw; height:100vh; background:#000; }
#mv2-canvas-wrap:fullscreen #mv2-canvas { max-height:100vh; max-width:100vw; box-shadow:none; }
#mv2-canvas-wrap:fullscreen .mv2-pv-ctl { bottom:18px; opacity:0.7; }
#mv2-canvas-wrap:fullscreen #mv2-pv-quality { right:18px; font-size:13px; }
#mv2-canvas-wrap:fullscreen #mv2-pv-fs { left:18px; width:34px; height:30px; font-size:18px; line-height:28px; }
#mv2-canvas-wrap:fullscreen .mv2-pv-play { width:48px; height:34px; font-size:18px; line-height:32px; }
#mv2-canvas-wrap:fullscreen .mv2-pv-seg { width:38px; height:32px; font-size:16px; line-height:30px; }
#mv2-canvas-wrap:fullscreen #mv2-pv-vol { left:60px; }
#mv2-canvas-wrap:fullscreen #mv2-pv-vol-btn { width:34px; height:30px; font-size:17px; line-height:28px; }
#mv2-transport { display:flex; align-items:center; gap:8px; padding:4px 8px; background:#c0c0c0; border-top:1px solid #fff; border-bottom:1px solid #808080; flex:0 0 auto; }
#mv2-play { font-size:12px; padding:1px 9px; cursor:pointer; min-width:30px; }
#mv2-tracks-wrap { position:relative; flex:0 1 auto; min-height:120px; overflow:auto; background:#b8b4ac; scrollbar-width:auto; }
/* Chunkier timeline scrollbars (esp. the horizontal one used for scrubbing long VSLs) */
#mv2-tracks-wrap::-webkit-scrollbar { height:18px; width:18px; }
#mv2-tracks-wrap::-webkit-scrollbar-track { background:#cfcbc3; }
#mv2-tracks-wrap::-webkit-scrollbar-thumb { background:#1a1815; border:2px solid #cfcbc3; border-radius:9px; }
#mv2-tracks-wrap::-webkit-scrollbar-thumb:hover { background:#000; }
#mv2-ruler { position:relative; height:16px; margin-left:64px; background:#a8a49c; border-bottom:1px solid #808080; }
#mv2-ruler .mv2-tick { position:absolute; top:0; height:16px; border-left:1px solid #6a665e; }
#mv2-ruler .mv2-tick span { font-size:9px; color:var(--mv2-ink); padding-left:2px; }
#mv2-tracks { position:relative; }
.mv2-track { display:flex; align-items:stretch; height:22px; border-bottom:1px solid #9a968e; }
.mv2-track-label { width:64px; flex:0 0 64px; font-size:10px; font-weight:bold; color:#000080; display:flex; align-items:center; padding-left:4px; background:#cfcbc3; border-right:1px solid #808080; box-sizing:border-box; }
.mv2-track-label-btn { cursor:pointer; text-decoration:underline; color:#1c5e85; }
.mv2-track-label-btn:hover { background:#bfe0f2; }
/* Highlight the track being worked on: selected clip -> its name cell; selected whole track -> the row. */
.mv2-track-label.active { background:#ffe28a; color:#6a4a00; }
.mv2-track.track-active { background:rgba(255,206,74,0.14); }
.mv2-track.track-active .mv2-track-label { background:#ffce4a; color:#5a3d00; }
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
.mv2-clip.multi { outline:2px dashed #ff8c00; outline-offset:-1px; z-index:3; }
/* Render-range toggle (in the transport row) — highlighted when active */
#mv2-range-toggle { font-size:10px; padding:1px 7px; cursor:pointer; }
#mv2-range-toggle.on { background:#2e86c1; color:#fff; border-color:#1c5e85; font-weight:bold; }
/* Render-range bar above the ruler */
#mv2-range { position:relative; height:14px; margin-left:64px; background:#a8a49c; border-bottom:1px solid #8a867e; }
#mv2-range.active { background:#9a968e; }
#mv2-range .rng-hl { position:absolute; top:0; bottom:0; background:rgba(46,134,193,.40); border-left:2px solid #1c5e85; border-right:2px solid #1c5e85; pointer-events:none; }
#mv2-range .rng-h { position:absolute; top:0; bottom:0; width:9px; cursor:ew-resize; z-index:2; }
#mv2-range .rng-h:hover { background:rgba(28,94,133,.35); }
#mv2-range .rng-lbl { position:absolute; top:1px; font-size:9px; color:#143a52; font-weight:bold; pointer-events:none; white-space:nowrap; }
.mv2-trim { position:absolute; top:0; bottom:0; width:10px; cursor:ew-resize; z-index:4; background:rgba(255,208,0,0); }
.mv2-trim:hover { background:rgba(255,208,0,0.55); }
.mv2-trim-l { left:-2px; } .mv2-trim-r { right:-2px; }
/* Inspector is the MIDDLE column of the preview row (resizable), stacked vertically. */
#mv2-inspector { flex:0 0 var(--mv2-insp-w,240px); min-width:150px; overflow-y:auto; padding:5px 8px; background:#c0c0c0; }
#mv2-inspector-body { display:flex; flex-direction:column; align-items:stretch; gap:6px; }
.mv2-insp-row { justify-content:space-between; }
/* Uniform control width, flush to the right of the column; label takes the rest on the left. */
.mv2-insp-row > label:not(.mv2-switch) { flex:1 1 auto; min-width:0; }
.mv2-insp-row select, .mv2-insp-row input[type=range], .mv2-insp-row input[type=number] { flex:0 0 130px; width:130px; box-sizing:border-box; }
/* Drag handles between the 3 top columns (Media | Inspector | Preview). */
.mv2-col-resizer { flex:0 0 6px; align-self:stretch; cursor:col-resize; background:#000; opacity:0.5; z-index:7; }
.mv2-col-resizer:hover { background:#2e86c1; opacity:0.9; }
/* Empty field below the timeline so the timeline does not stick to the screen bottom. */
#mv2-bottom-spacer { flex:1 1 auto; min-height:24px; background:#b0aca4; border-top:1px solid #9a968e; }
.mv2-insp-row { display:flex; align-items:center; gap:5px; }
.mv2-insp-row label { font-size:10px; color:#333; }
.mv2-insp-title { font-size:10px; font-weight:bold; color:#000080; width:100%; }
.mv2-insp-subtitle { font-size:9px; color:#555; line-height:1.25; white-space:normal; word-break:break-word; width:100%; }
.mv2-insp-titlerow { display:flex; align-items:center; justify-content:space-between; gap:6px; }
.mv2-insp-reset { font-size:12px; line-height:1; padding:1px 7px; cursor:pointer; background:#d4d0c8; border:1px solid #888; border-radius:3px; color:#333; }
.mv2-insp-reset:hover { background:#f0c040; border-color:#a07000; }
.mv2-insp-del { background:#c0392b; color:#fff; border:1px solid #7a241a; font-size:10px; padding:2px 9px; cursor:pointer; }
.mv2-insp-hint { font-size:10px; color:var(--mv2-muted); }
.mv2-insp-help { font-size:10px; color:#333; line-height:1.4; }
.mv2-insp-help ul, .mv2-insp-help ol { margin:2px 0 8px; padding-left:18px; }
.mv2-insp-help li { margin:1px 0; }
.mv2-insp-help .mv2-insp-title { margin-top:4px; }
.mv2-insp-help b { color:#000080; }
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
  // Main-segment start times (the spine), sorted — used by the prev/next buttons.
  function _segStarts() {
    const m = window.MV2Compositor && window.MV2Compositor.model;
    return ((m && m.main) || []).map(c => c.start).filter(t => t != null).sort((a, b) => a - b);
  }
  // Jump the playhead to the previous (-1) / next (+1) main-segment boundary.
  function _jumpSeg(dir) {
    const starts = _segStarts();
    if (!starts.length) return;
    const t = (window.MV2Compositor && window.MV2Compositor.clockT) || 0;
    const EPS = 0.05;
    let target;
    if (dir > 0) {
      target = starts.find(s => s > t + EPS);
      if (target == null) target = starts[starts.length - 1];
    } else {
      target = 0;
      for (const s of starts) { if (s < t - EPS) target = s; else break; }
    }
    window.MV2Compositor.seek(Math.max(0, target));
  }

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

    // Center-bottom transport overlay: prev segment | play/pause | next segment.
    const tr = document.createElement('div'); tr.id = 'mv2-pv-transport'; tr.className = 'mv2-pv-ctl';
    const prevB = document.createElement('button'); prevB.className = 'mv2-pv-seg'; prevB.textContent = '⏮'; prevB.title = 'Previous segment';
    prevB.addEventListener('click', () => _jumpSeg(-1));
    const playB = document.createElement('button'); playB.id = 'mv2-play'; playB.className = 'mv2-pv-play'; playB.textContent = '▶'; playB.title = 'Play / Pause (Space)';
    const nextB = document.createElement('button'); nextB.className = 'mv2-pv-seg'; nextB.textContent = '⏭'; nextB.title = 'Next segment';
    nextB.addEventListener('click', () => _jumpSeg(1));
    tr.appendChild(prevB); tr.appendChild(playB); tr.appendChild(nextB);

    // Preview master volume — vertical pop-up next to the fullscreen button. PREVIEW
    // ONLY (scales MV2Compositor playback; never touches the model / export). Persisted.
    const vol = document.createElement('div'); vol.id = 'mv2-pv-vol'; vol.className = 'mv2-pv-ctl';
    const spk = document.createElement('button'); spk.id = 'mv2-pv-vol-btn'; spk.title = 'Preview volume (click to mute)'; spk.textContent = '🔊';
    const pop = document.createElement('div'); pop.id = 'mv2-pv-vol-pop';
    const vtrk = document.createElement('div'); vtrk.id = 'mv2-pv-vol-trk';
    const vfill = document.createElement('div'); vfill.id = 'mv2-pv-vol-fill';
    const vknob = document.createElement('div'); vknob.id = 'mv2-pv-vol-knob';
    vtrk.appendChild(vfill); vtrk.appendChild(vknob); pop.appendChild(vtrk);
    vol.appendChild(spk); vol.appendChild(pop);

    let _pvVol = 1, _pvPrev = 1;
    try { const sv = parseFloat(localStorage.getItem('mv2_preview_volume')); if (sv >= 0 && sv <= 1) _pvVol = sv; } catch {}
    const _applyPvVol = (v, save) => {
      _pvVol = Math.max(0, Math.min(1, v));
      const pct = Math.round(_pvVol * 100);
      vfill.style.height = pct + '%'; vknob.style.bottom = pct + '%';
      spk.textContent = _pvVol <= 0 ? '🔇' : _pvVol < 0.5 ? '🔉' : '🔊';
      if (window.MV2Compositor && window.MV2Compositor.setPreviewVolume) window.MV2Compositor.setPreviewVolume(_pvVol);
      if (save) { try { localStorage.setItem('mv2_preview_volume', String(_pvVol)); } catch {} }
    };
    const _pvFrom = (e) => { const r = vtrk.getBoundingClientRect(); return Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height)); };
    let _pvDrag = false;
    vtrk.addEventListener('pointerdown', (e) => { _pvDrag = true; vol.classList.add('dragging'); try { vtrk.setPointerCapture(e.pointerId); } catch {} _applyPvVol(_pvFrom(e), true); e.preventDefault(); });
    vtrk.addEventListener('pointermove', (e) => { if (_pvDrag) _applyPvVol(_pvFrom(e), true); });
    window.addEventListener('pointerup', () => { _pvDrag = false; vol.classList.remove('dragging'); });
    spk.addEventListener('click', () => { if (_pvVol > 0) { _pvPrev = _pvVol; _applyPvVol(0, true); } else { _applyPvVol(_pvPrev || 1, true); } });
    // Keep the pop-up open for 1s after the pointer leaves, so there's time to grab the slider.
    let _pvCloseT = null;
    vol.addEventListener('mouseenter', () => { if (_pvCloseT) { clearTimeout(_pvCloseT); _pvCloseT = null; } vol.classList.add('open'); });
    vol.addEventListener('mouseleave', () => { if (_pvCloseT) clearTimeout(_pvCloseT); _pvCloseT = setTimeout(() => { vol.classList.remove('open'); _pvCloseT = null; }, 1000); });
    _applyPvVol(_pvVol, false);   // push the saved value to the compositor on load

    wrap.appendChild(sel); wrap.appendChild(fs); wrap.appendChild(tr); wrap.appendChild(vol);

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

  // Resizable top columns (Media | Inspector | Preview). Widths persist in
  // localStorage (applied instantly) and sync to server settings (mergeColW) so
  // they survive reloads, server restarts, and a fresh browser/device.
  function _initColResizers() {
    const root = document.getElementById('mv2-root');
    if (!root) return;
    const W = { inspW: 240, canvasW: 200 };
    const _apply = () => {
      root.style.setProperty('--mv2-insp-w',   Math.round(W.inspW)   + 'px');
      root.style.setProperty('--mv2-canvas-w', Math.round(W.canvasW) + 'px');
    };
    try { const c = JSON.parse(localStorage.getItem('mv2_col_w') || '{}'); if (c.inspW > 0) W.inspW = +c.inspW; if (c.canvasW > 0) W.canvasW = +c.canvasW; } catch {}
    _apply();
    fetch('/api/settings').then(r => r.json()).then(d => {       // cross-device refresh
      const m = d && d.settings && d.settings.mergeColW;
      if (m && (m.inspW > 0 || m.canvasW > 0)) {
        if (m.inspW > 0) W.inspW = +m.inspW;
        if (m.canvasW > 0) W.canvasW = +m.canvasW;
        _apply();
        try { localStorage.setItem('mv2_col_w', JSON.stringify(W)); } catch {}
      }
    }).catch(() => {});
    let _saveT = null;
    const _persist = () => {
      try { localStorage.setItem('mv2_col_w', JSON.stringify(W)); } catch {}
      if (_saveT) clearTimeout(_saveT);
      _saveT = setTimeout(() => {
        fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mergeColW: { inspW: Math.round(W.inspW), canvasW: Math.round(W.canvasW) } }) }).catch(() => {});
      }, 500);
    };
    const CL = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    document.querySelectorAll('#mv2-preview .mv2-col-resizer').forEach(rz => {
      rz.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const which = rz.dataset.resize;       // 'insp' = Media|Inspector, 'canvas' = Inspector|Preview
        const startX = e.clientX, s = { inspW: W.inspW, canvasW: W.canvasW };
        const rootW = root.getBoundingClientRect().width;
        const onMove = (ev) => {
          const dx = ev.clientX - startX;
          if (which === 'insp') {               // Media|Inspector: trade media <-> inspector, preview fixed
            const maxInsp = Math.max(150, rootW - 12 - s.canvasW - 120);   // keep media >= 120px
            W.inspW = CL(s.inspW - dx, 150, maxInsp);
          } else {                              // Inspector|Preview: trade inspector <-> preview, MEDIA stays fixed
            const total = s.inspW + s.canvasW;                             // keep the sum constant so the inspector left edge never moves
            W.inspW   = CL(s.inspW + dx, 150, total - 120);                // preview >= 120px
            W.canvasW = total - W.inspW;
          }
          _apply();
        };
        const onUp = () => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          document.body.style.userSelect = '';
          _persist();
        };
        document.body.style.userSelect = 'none';
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
    });
  }

  function _initOnce() {
    if (_inited) return;
    _inited = true;
    _injectStyles();
    _initColResizers();

    const canvas = document.getElementById('mv2-canvas');
    window.MV2Compositor.mount(canvas);
    // Persist a finished on-canvas move/resize of an insert (birol/hook).
    window.MV2Compositor.onTransform = (kind, key, tf) => {
      if (!_sessionKey) return;
      _pushHistory();
      window.MV2.setInsertTiming(_sessionKey, kind, key, {
        tx: +tf.tx.toFixed(4), ty: +tf.ty.toFixed(4), tw: +tf.tw.toFixed(4),
      });
      _renderInspector();   // refresh the numeric X/Y/W fields
    };
    _setupPreviewControls();
    window.MV2Compositor.setOnTick((cur, total, playing) => {
      const t = document.getElementById('mv2-time');
      if (t) t.textContent = (Math.round(cur * 100) / 100).toFixed(2) + ' / ' + (Math.round(total * 100) / 100).toFixed(2) + 's';
      const pb = document.getElementById('mv2-play');
      if (pb) pb.textContent = playing ? '❚❚' : '▶';
      window.MV2Timeline.setPlayhead(cur);
    });

    document.getElementById('mv2-play')?.addEventListener('click', () => window.MV2Compositor.toggle());

    // Spacebar = play/pause hotkey for this tab (always toggles). Ignored while
    // typing in a field and when the merge tab is not the visible one.
    document.addEventListener('keydown', (e) => {
      if (e.code !== 'Space' && e.key !== ' ') return;
      const t = e.target, tag = t && t.tagName;
      if (t && (t.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT')) return;
      const root = document.getElementById('mv2-root');
      if (!root || root.offsetParent === null) return;   // merge tab not visible
      e.preventDefault();
      window.MV2Compositor.toggle();
    });

    // Esc = clear the timeline selection (clip or track). Skipped while the
    // subtitle popup is open (it has its own Esc-to-close) and when nothing is
    // selected, so popups keep their Esc.
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const root = document.getElementById('mv2-root');
      if (!root || root.offsetParent === null) return;   // merge tab not visible
      if (document.getElementById('mv2-subs-overlay')) return;
      if (!_selected) return;                            // nothing to deselect
      MV2Tab.selectClip(null, null);
    });

    document.getElementById('mv2-zoom')?.addEventListener('input', () => {
      if (!window.MV2Compositor.model) return;
      // Zoom toward the playhead: keep it pixel-stable in the viewport instead of
      // letting the timeline grow from the left edge.
      const wrap = document.getElementById('mv2-tracks-wrap');
      const t = window.MV2Compositor.clockT || 0;
      const oldPps = window.MV2Timeline.lastRenderPps ? window.MV2Timeline.lastRenderPps() : 60;
      const newPps = parseInt(document.getElementById('mv2-zoom').value, 10) || 60;
      const oldScroll = wrap ? wrap.scrollLeft : 0;
      window.MV2Timeline.render(window.MV2Compositor.model);
      if (wrap) wrap.scrollLeft = Math.max(0, oldScroll + t * (newPps - oldPps));
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

    // ── Mode switch (Creatives | VSL) ─────────────────────────────────────────
    const modeSel = document.getElementById('mv2-mode');
    if (modeSel) {
      try { modeSel.value = localStorage.getItem(MODE_KEY) || 'creatives'; } catch {}
      if (!modeSel.value) modeSel.value = 'creatives';
      modeSel.addEventListener('change', () => {
        try { localStorage.setItem(MODE_KEY, modeSel.value); } catch {}
        _persistCurrent();
        _sessionKey = null; _model = null; _selected = null;
        window.MV2Compositor.load(null); window.MV2Timeline.render(null, null); _renderInspector();
        _setSaveCloseEnabled(false);
        _updateModeUi();
        MV2Tab.activate();           // re-list projects + restore last one for this mode
      });
    }
    _updateModeUi();

    // VSL: picking a video creates a NEW project on it (pick again = new cut).
    document.getElementById('mv2-vsl-video')?.addEventListener('change', async (e) => {
      const file = e.target.value;
      if (!file) return;
      e.target.value = '';                                   // reset to placeholder
      const v = _vslVideos.find(x => x.file === file);
      if (!v) return;
      _status('Preparing VSL project…');
      if (!(v.duration > 0) || !(v.width > 0)) {
        const p = await _probeVideo(v.url);
        if (p.duration > 0) { Object.assign(v, p); _saveVslMeta(v.file, p); }
      }
      _persistCurrent();
      const key = window.MV2.createVslSession(v);
      _refreshPicker();
      _loadSession(key);
    });

    document.getElementById('mv2-vsl-upload')?.addEventListener('click', _openVslUpload);

    // Render-range toggle: on → select the first 2 min (drag to adjust); off → full.
    document.getElementById('mv2-range-toggle')?.addEventListener('click', () => {
      if (!_sessionKey) { _status('Select a project first'); return; }
      _setRangeOn(!_rangeOn);
      _status(_rangeOn ? 'Render range ON (first 2 min) — drag the bar to adjust' : 'Render range OFF (full timeline)');
    });

    // Delete the selected VSL project (next to the Project picker): wipes the
    // project + its timeline/inserts + its renders; the source video stays.
    document.getElementById('mv2-vsl-del')?.addEventListener('click', async () => {
      if (!_sessionKey) { _status('Pick a VSL project to delete'); return; }
      const label = (_model && _model.title) || _sessionKey;
      if (!window.confirm('Delete VSL project "' + label + '" and all its data?\nThe source video stays in the library.')) return;
      const key = _sessionKey;
      let n = 0;
      try {
        const r = await fetch('/api/finals/by-project', {
          method: 'DELETE', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: key }),
        });
        const j = await r.json();
        if (j && j.success) n = j.deleted || 0;
      } catch {}
      window.MV2.deleteVslSession(key);
      _sessionKey = null; _model = null; _selected = null; _multiSel.clear();
      window.MV2Compositor.load(null); window.MV2Timeline.render(null, null); _renderInspector();
      _setSaveCloseEnabled(false);
      const list = _refreshPicker();
      _status('Deleted VSL project · ' + n + ' render(s) wiped');
      if (list[0]) _loadSession(list[0].sessionKey);
    });

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
      // VSL projects have no Edit session behind them — those are removed for good
      // (the uploaded video itself stays in the VSL library).
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
      if (_mode() === 'vsl') {
        window.MV2.deleteVslSession(key);
        _status('Deleted ' + n + ' render(s) · VSL project removed (video kept in library)');
      } else {
        window.MV2.closeProject(key);   // removes from Merge (inMerge=false); re-star in Edit to bring back
        _status('Deleted ' + n + ' render(s) · removed from Merge (kept in Edit)');
      }
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

  // ── VSL mode helpers ─────────────────────────────────────────────────────────
  function _updateModeUi() {
    const vsl = _mode() === 'vsl';
    ['mv2-vsl-video-lbl', 'mv2-vsl-video', 'mv2-vsl-upload', 'mv2-vsl-del'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = vsl ? '' : 'none';
    });
    if (vsl) _refreshVslVideos();
  }

  function _fmtDur(s) {
    if (!(s > 0)) return '';
    const m = Math.floor(s / 60), ss = Math.round(s % 60);
    return m + ':' + String(ss).padStart(2, '0');
  }

  async function _refreshVslVideos(selectFile) {
    const sel = document.getElementById('mv2-vsl-video');
    if (!sel) return;
    try {
      const r = await fetch('/api/vsl/list');
      const j = await r.json();
      _vslVideos = (j && j.videos) || [];
    } catch { _vslVideos = []; }
    sel.innerHTML = '';
    const ph = document.createElement('option');
    ph.value = ''; ph.textContent = _vslVideos.length ? '— pick a video (new project) —' : 'No videos — upload one ⬆';
    sel.appendChild(ph);
    _vslVideos.forEach(v => {
      const o = document.createElement('option');
      o.value = v.file;
      const tag = v.proxying ? ' · ⏳ proxy' : v.proxyError ? ' · ⚠ proxy failed' : v.proxyReady ? ' · ⚡ ready' : '';
      o.textContent = v.name + (v.duration ? ' · ' + _fmtDur(v.duration) : '') + tag;
      sel.appendChild(o);
    });
    if (selectFile) sel.value = selectFile;
    // When the loaded project's proxy just became ready, hot-swap the preview to it.
    if (_sessionKey) {
      const sess = (typeof editFrozenSessions !== 'undefined' ? editFrozenSessions : {})[_sessionKey];
      if (sess && sess.isVsl && !sess.vslProxy) {
        const v = _vslVideos.find(x => x.file === sess.vslFile);
        if (v && v.proxy) { sess.vslProxy = v.proxy; _reload(); }   // switch preview to the proxy
      }
    }
    // Poll while any video is still building its proxy so the tag + hot-swap fire.
    const anyProxying = _vslVideos.some(v => v.proxying);
    if (anyProxying && _mode() === 'vsl') {
      clearTimeout(_vslOptPoll);
      _vslOptPoll = setTimeout(() => { if (_mode() === 'vsl') _refreshVslVideos(); }, 8000);
    }
  }
  let _vslOptPoll = null;

  // Probe duration + natural dimensions via a detached <video> element.
  function _probeVideo(url) {
    return new Promise(res => {
      const v = document.createElement('video');
      v.preload = 'metadata'; v.muted = true;
      let done = false;
      const fin = (out) => { if (done) return; done = true; try { v.removeAttribute('src'); v.load(); } catch {} res(out); };
      v.addEventListener('loadedmetadata', () => fin({
        duration: isFinite(v.duration) ? v.duration : 0,
        width: v.videoWidth || 0, height: v.videoHeight || 0,
      }), { once: true });
      v.addEventListener('error', () => fin({ duration: 0, width: 0, height: 0 }), { once: true });
      setTimeout(() => fin({ duration: 0, width: 0, height: 0 }), 15000);
      v.src = url;
    });
  }

  function _saveVslMeta(file, p) {
    fetch('/api/vsl/meta', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file, duration: p.duration, width: p.width, height: p.height }),
    }).catch(() => {});
  }

  // Upload popup: file picker + progress bar (XHR for upload progress), then
  // client-side metadata probe so the picker can show duration right away.
  function _openVslUpload() {
    if (document.getElementById('mv2-vsl-up-overlay')) return;
    const ov = document.createElement('div');
    ov.id = 'mv2-vsl-up-overlay';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:9000;display:flex;align-items:center;justify-content:center;';
    const box = document.createElement('div');
    box.style.cssText = 'background:#c0c0c0;border:2px solid #808080;box-shadow:4px 4px 0 rgba(0,0,0,.3);padding:12px;width:340px;font-size:11px;';
    box.innerHTML =
      '<div style="font-weight:bold;margin-bottom:8px;">Upload VSL video</div>' +
      '<input type="file" id="mv2-vsl-file" accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov,.avi,.mkv" style="width:100%;margin-bottom:8px;font-size:11px;">' +
      '<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">' +
      '  <label style="white-space:nowrap;">Name:</label>' +
      '  <input type="text" id="mv2-vsl-name" placeholder="(from file name)" style="flex:1;font-size:11px;">' +
      '</div>' +
      '<div id="mv2-vsl-prog-wrap" style="display:none;height:14px;background:#fff;border:1px solid #808080;margin-bottom:8px;">' +
      '  <div id="mv2-vsl-prog" style="height:100%;width:0%;background:#2e86c1;"></div>' +
      '</div>' +
      '<div id="mv2-vsl-up-status" style="min-height:14px;color:#333;margin-bottom:8px;"></div>' +
      '<div style="display:flex;gap:6px;justify-content:flex-end;">' +
      '  <button id="mv2-vsl-up-go">Upload</button>' +
      '  <button id="mv2-vsl-up-close">Close</button>' +
      '</div>';
    ov.appendChild(box);
    document.body.appendChild(ov);
    const close = () => { try { ov.remove(); } catch {} };
    ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
    box.querySelector('#mv2-vsl-up-close').addEventListener('click', close);
    const st = box.querySelector('#mv2-vsl-up-status');
    box.querySelector('#mv2-vsl-up-go').addEventListener('click', () => {
      const fi = box.querySelector('#mv2-vsl-file');
      const f  = fi.files && fi.files[0];
      if (!f) { st.textContent = 'Pick a file first'; return; }
      const goBtn = box.querySelector('#mv2-vsl-up-go');
      goBtn.disabled = true; fi.disabled = true;
      const wrap = box.querySelector('#mv2-vsl-prog-wrap');
      const bar  = box.querySelector('#mv2-vsl-prog');
      wrap.style.display = '';
      st.textContent = 'Uploading…';
      const fd = new FormData();
      fd.append('video', f);
      const nm = box.querySelector('#mv2-vsl-name').value.trim();
      if (nm) fd.append('name', nm);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/vsl/upload');
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) bar.style.width = Math.round(e.loaded / e.total * 100) + '%';
      };
      xhr.onerror = () => { st.textContent = '⚠ Network error'; goBtn.disabled = false; fi.disabled = false; };
      xhr.onload = async () => {
        let j = null; try { j = JSON.parse(xhr.responseText); } catch {}
        if (!j || !j.success) { st.textContent = '⚠ ' + ((j && j.error) || ('HTTP ' + xhr.status)); goBtn.disabled = false; fi.disabled = false; return; }
        bar.style.width = '100%';
        st.textContent = 'Probing metadata…';
        const p = await _probeVideo(j.url);
        if (p.duration > 0) _saveVslMeta(j.filename, p);
        st.textContent = '✅ Uploaded: ' + j.name + (p.duration ? ' · ' + _fmtDur(p.duration) : '') +
          ' — building a light preview proxy in the background (usable now).';
        await _refreshVslVideos();
        goBtn.disabled = false; fi.disabled = false; fi.value = '';
      };
      xhr.send(fd);
    });
  }

  // Slice popup: scene-detect the whole VSL into fragments. Sensitivity maps to
  // ffmpeg's scene score threshold (lower threshold = more cuts). The detection
  // is a decode-only server pass with live progress + found-cut count.
  function _openSlicePopup(clip) {
    if (document.getElementById('mv2-vsl-slice-overlay')) return;
    const sess = (typeof editFrozenSessions !== 'undefined' ? editFrozenSessions : {})[_sessionKey] || {};
    const file = sess.vslFile;
    if (!file) { _status('No source video file on this project'); return; }
    const srcDur = clip.srcDur || 0;

    const ov = document.createElement('div');
    ov.id = 'mv2-vsl-slice-overlay';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:9000;display:flex;align-items:center;justify-content:center;';
    const box = document.createElement('div');
    box.style.cssText = 'background:#c0c0c0;border:2px solid #808080;box-shadow:4px 4px 0 rgba(0,0,0,.3);padding:12px;width:360px;font-size:11px;';
    box.innerHTML =
      '<div style="font-weight:bold;margin-bottom:8px;">Slice into fragments</div>' +
      '<div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;">' +
      '  <label id="mv2-slice-th-lbl" style="white-space:nowrap;min-width:150px;">Sensitivity</label>' +
      '  <input id="mv2-slice-th" type="range" min="0.05" max="0.5" step="0.05" value="0.2" style="flex:1;">' +
      '</div>' +
      '<div style="color:#555;margin-bottom:8px;">Left = more cuts (every shot change), right = only strong scene changes.</div>' +
      '<div id="mv2-slice-prog-wrap" style="display:none;height:14px;background:#fff;border:1px solid #808080;margin-bottom:8px;">' +
      '  <div id="mv2-slice-prog" style="height:100%;width:0%;background:#2e86c1;"></div>' +
      '</div>' +
      '<div id="mv2-slice-status" style="min-height:14px;color:#333;margin-bottom:8px;"></div>' +
      '<div style="display:flex;gap:6px;justify-content:flex-end;">' +
      '  <button id="mv2-slice-go">Detect scenes</button>' +
      '  <button id="mv2-slice-apply" style="display:none;font-weight:bold;">Apply</button>' +
      '  <button id="mv2-slice-close">Close</button>' +
      '</div>';
    ov.appendChild(box);
    document.body.appendChild(ov);

    const st    = box.querySelector('#mv2-slice-status');
    const thInp = box.querySelector('#mv2-slice-th');
    const thLbl = box.querySelector('#mv2-slice-th-lbl');
    const updTh = () => { thLbl.textContent = 'Sensitivity (threshold ' + parseFloat(thInp.value).toFixed(2) + ')'; };
    thInp.addEventListener('input', updTh); updTh();

    let jobId = null, pollTimer = null, boundaries = null, jobDur = 0;
    const stopPoll = () => { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } };
    const close = () => {
      stopPoll();
      if (jobId) fetch('/api/vsl/scenes/' + jobId, { method: 'DELETE' }).catch(() => {});
      try { ov.remove(); } catch {}
    };
    ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
    box.querySelector('#mv2-slice-close').addEventListener('click', close);

    box.querySelector('#mv2-slice-go').addEventListener('click', async () => {
      const goBtn = box.querySelector('#mv2-slice-go');
      goBtn.disabled = true; thInp.disabled = true;
      box.querySelector('#mv2-slice-apply').style.display = 'none';
      boundaries = null;
      const wrap = box.querySelector('#mv2-slice-prog-wrap');
      const bar  = box.querySelector('#mv2-slice-prog');
      wrap.style.display = ''; bar.style.width = '0%';
      st.textContent = 'Starting…';
      let r = null;
      try {
        r = await (await fetch('/api/vsl/scenes', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ file, threshold: parseFloat(thInp.value) }),
        })).json();
      } catch {}
      if (!r || !r.success) { st.textContent = '⚠ ' + ((r && r.error) || 'Failed to start'); goBtn.disabled = false; thInp.disabled = false; return; }
      jobId = r.jobId;
      pollTimer = setInterval(async () => {
        let j = null;
        try { j = await (await fetch('/api/vsl/scenes/' + jobId)).json(); } catch {}
        if (!j || !j.success) return;                      // transient — keep polling
        bar.style.width = Math.round((j.progress || 0) * 100) + '%';
        st.textContent = 'Analyzing… ' + Math.round((j.progress || 0) * 100) + '% · ' + (j.cuts || 0) + ' cuts found';
        if (j.done) {
          stopPoll(); jobId = null;
          goBtn.disabled = false; thInp.disabled = false;
          if (j.error) { st.textContent = '⚠ ' + j.error; return; }
          boundaries = j.boundaries || [];
          jobDur = j.duration || 0;
          bar.style.width = '100%';
          st.textContent = '✅ ' + boundaries.length + ' cuts → ' + (boundaries.length + 1) + ' fragments. Apply to slice the timeline.';
          box.querySelector('#mv2-slice-apply').style.display = '';
        }
      }, 700);
    });

    box.querySelector('#mv2-slice-apply').addEventListener('click', () => {
      if (!boundaries) return;
      const dur = jobDur > 0 ? jobDur : srcDur;
      if (!(dur > 0)) { st.textContent = '⚠ Unknown source duration'; return; }
      const n = window.MV2.applyVslFragments(_sessionKey, boundaries, dur);
      if (!n) { st.textContent = '⚠ Slicing failed'; return; }
      // Remember this slice on the video so a NEW project on it reuses it
      // without re-detecting. Also update the cached list entry immediately.
      if (file) {
        fetch('/api/vsl/save-fragments', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ file, boundaries }),
        }).catch(() => {});
        const v = _vslVideos.find(x => x.file === file); if (v) v.fragments = boundaries.slice();
      }
      _multiSel.clear();
      _selected = null;
      _undoStack.length = 0; _redoStack.length = 0;   // cells changed — old snapshots are invalid
      close();
      _status('Sliced into ' + n + ' fragments');
      _reload();
    });
  }

  // ── Extract a hook from the VSL (double-click the main track) ────────────────
  // In/out are SOURCE-video seconds (clamped to the clicked fragment's source
  // span). Save cuts the fragment from the ORIGINAL (full quality) → hooks lib.
  function _mainClipAtTime(t) {
    const m = (_model && _model.main) || [];
    return m.find(c => t >= c.start && t < c.end) || m[m.length - 1] || null;
  }
  function _tlToSrc(clip, t) { return (clip.trimIn || 0) + Math.max(0, (t - clip.start)) * (clip.speed || 1); }
  MV2Tab.openHookExtract = function (tlTime) {
    if (!_sessionKey || !_model || !_model.isVsl) return;
    if (document.getElementById('mv2-hookx-overlay')) return;
    const sess = (typeof editFrozenSessions !== 'undefined' ? editFrozenSessions : {})[_sessionKey] || {};
    if (!sess.vslFile) { _status('No source video on this project'); return; }
    const clip = _mainClipAtTime(tlTime);
    if (!clip) return;
    const sp = clip.speed || 1;
    const srcLo = clip.trimIn || 0;
    const srcHi = srcLo + (clip.end - clip.start) * sp;     // source span of this fragment
    let inS  = Math.max(srcLo, Math.min(_tlToSrc(clip, tlTime), srcHi - 0.1));
    let outS = Math.min(srcHi, inS + 5);

    const ov = document.createElement('div');
    ov.id = 'mv2-hookx-overlay';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:9000;display:flex;align-items:center;justify-content:center;';
    const box = document.createElement('div');
    box.style.cssText = 'background:#c0c0c0;border:2px solid #808080;box-shadow:4px 4px 0 rgba(0,0,0,.3);padding:12px;width:340px;font-size:11px;';
    const _fmt = (v) => (Math.round(v * 100) / 100).toFixed(2);
    box.innerHTML =
      '<div style="font-weight:bold;margin-bottom:8px;">Extract hook from VSL</div>' +
      '<div style="color:#555;margin-bottom:8px;">Cut a fragment from the original (full quality) into your Hooks library.</div>' +
      '<div style="display:flex;align-items:center;gap:6px;margin-bottom:5px;">' +
      '  <label style="min-width:80px;">In (s):</label>' +
      '  <input id="mv2-hx-in" type="number" step="0.05" style="flex:1;font-size:11px;">' +
      '  <button id="mv2-hx-in-ph" title="Set In to the playhead">⊳ playhead</button>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:6px;margin-bottom:5px;">' +
      '  <label style="min-width:80px;">Out (s):</label>' +
      '  <input id="mv2-hx-out" type="number" step="0.05" style="flex:1;font-size:11px;">' +
      '  <button id="mv2-hx-out-ph" title="Set Out to the playhead">⊳ playhead</button>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">' +
      '  <label style="min-width:80px;">Name:</label>' +
      '  <input id="mv2-hx-name" type="text" placeholder="(auto)" style="flex:1;font-size:11px;">' +
      '</div>' +
      '<div id="mv2-hx-status" style="min-height:14px;color:#333;margin-bottom:8px;"></div>' +
      '<div style="display:flex;gap:6px;justify-content:flex-end;">' +
      '  <button id="mv2-hx-save" style="font-weight:bold;">✂ Save to Hooks</button>' +
      '  <button id="mv2-hx-close">Close</button>' +
      '</div>';
    ov.appendChild(box); document.body.appendChild(ov);
    const close = () => { try { ov.remove(); } catch {} };
    ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
    box.querySelector('#mv2-hx-close').onclick = close;
    const inEl = box.querySelector('#mv2-hx-in'), outEl = box.querySelector('#mv2-hx-out');
    const st = box.querySelector('#mv2-hx-status');
    inEl.value = _fmt(inS); outEl.value = _fmt(outS);
    // Playhead (timeline) → source time, clamped to this fragment.
    const phToSrc = () => Math.max(srcLo, Math.min(_tlToSrc(clip, window.MV2Compositor.clockT || 0), srcHi));
    box.querySelector('#mv2-hx-in-ph').onclick  = () => { inEl.value  = _fmt(phToSrc()); };
    box.querySelector('#mv2-hx-out-ph').onclick = () => { outEl.value = _fmt(phToSrc()); };

    box.querySelector('#mv2-hx-save').onclick = async () => {
      let a = Math.max(srcLo, Math.min(parseFloat(inEl.value) || 0, srcHi));
      let b = Math.max(srcLo, Math.min(parseFloat(outEl.value) || 0, srcHi));
      if (!(b > a)) { st.textContent = '⚠ Out must be greater than In'; return; }
      const save = box.querySelector('#mv2-hx-save');
      save.disabled = true; st.textContent = '✂ Cutting from the original…';
      try {
        const r = await fetch('/api/vsl/extract-hook', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ file: sess.vslFile, start: a, end: b, name: box.querySelector('#mv2-hx-name').value }),
        });
        const j = await r.json();
        if (!j.success) throw new Error(j.error || 'cut failed');
        // Register in the Hooks library (localStorage archive) + refresh the gallery.
        const arr = (typeof getHooksArchive === 'function') ? getHooksArchive() : [];
        arr.unshift({ id: 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
          name: j.name, filename: j.filename, videoPath: j.videoPath, thumbPath: j.thumbPath || null, date: new Date().toISOString() });
        if (typeof setHooksArchive === 'function') setHooksArchive(arr);
        try { window.MV2Tab.refreshMedia && window.MV2Tab.refreshMedia(); } catch {}
        try { window.loadAllHooks && window.loadAllHooks(); } catch {}
        st.textContent = '✅ Saved "' + j.name + '" to Hooks (' + _fmt(b - a) + 's)';
        save.disabled = false;
        setTimeout(close, 1200);
      } catch (e) { st.textContent = '⚠ ' + (e.message || 'error'); save.disabled = false; }
    };
  };

  function _refreshPicker() {
    const sel = document.getElementById('mv2-session');
    if (!sel) return [];
    const list = window.MV2.listSessions(_mode());
    sel.innerHTML = '';
    if (!list.length) {
      const o = document.createElement('option');
      o.value = '';
      o.textContent = _mode() === 'vsl' ? 'No VSL projects — pick a video to start' : 'No projects — send one from Edit (★)';
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
    try { localStorage.setItem(_prefKey(), sessionKey); } catch {}
    const sel = document.getElementById('mv2-session');
    if (sel && sel.value !== sessionKey) sel.value = sessionKey;
    _status('Loading…');
    _selected = null;
    _multiSel.clear();
    _undoStack.length = 0; _redoStack.length = 0;
    try {
      const tld = getTimelineData()[sessionKey] || {};
      const rg = tld.mv2Range;
      _rangePct = (rg && rg.right > rg.left) ? { left: +rg.left || 0, right: +rg.right || 1 } : { left: 0, right: 1 };
      _rangeOn = !!tld.mv2RangeOn;
    } catch { _rangePct = { left: 0, right: 1 }; _rangeOn = false; }
    // Stamp the proxy onto the session so the preview uses it (if the build has
    // finished since this project was created).
    try {
      const s = (typeof editFrozenSessions !== 'undefined' ? editFrozenSessions : {})[sessionKey];
      if (s && s.isVsl && !s.vslProxy) { const v = _vslVideos.find(x => x.file === s.vslFile); if (v && v.proxy) s.vslProxy = v.proxy; }
    } catch {}
    const model = await window.MV2.buildModel(sessionKey);
    if (!model) { _status('Project not found'); return; }
    _model = model;
    window.MV2.recomputeIntoModel(model);  // re-time subtitles for the current speed/trim (no-op without STT segments)
    window.MV2Compositor.load(model);
    _applyFitZoom(model);                 // default to a zoom that shows the whole timeline
    window.MV2Timeline.render(model, _selected);
    _applyRangeToggleUi();                 // reflect persisted range on/off + show/hide the bar
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
    const lo = Math.max(1, Math.min(20, Math.floor(fit)));       // ensure min ≤ fit so fit is reachable (1 px/s floor for long VSLs)
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
    _multiSel.clear();                            // plain click always drops multi-select
    window.MV2Timeline.applySelection(_selected); // in-place (drag-safe, no rebuild)
    try { window.MV2Compositor.setSelectedInsert(_selected); } catch {}   // canvas transform handles
    _renderInspector();
  };
  MV2Tab.getSelected = function () { return _selected; };

  // Render-range (the bar above the ruler). Per-project, persisted in timeline
  // data; the timeline draws it and calls setRangePct after a drag. Gated by a
  // toggle (_rangeOn) — off = render the whole timeline.
  let _rangePct = { left: 0, right: 1 };
  let _rangeOn  = false;
  const RANGE_DEFAULT_SEC = 120;   // first 2 minutes when the range is enabled
  MV2Tab.getRangePct = function () { return _rangeOn ? _rangePct : { left: 0, right: 1 }; };
  MV2Tab.isRangeOn = function () { return _rangeOn; };
  MV2Tab.setRangePct = function (p) {
    let l = Math.max(0, Math.min(+p.left || 0, 0.998));
    let r = Math.max(0.002, Math.min(+p.right == null ? 1 : +p.right, 1));
    if (r - l < 0.002) { l = Math.max(0, r - 0.002); }
    _rangePct = { left: l, right: r };
    try { window.MV2.setFields(_sessionKey, { mv2Range: _rangePct }); } catch {}
    try { window.MV2Timeline.renderRange(); } catch {}
    _exportReset();   // export button shows the selected span length
  };
  // VSL fragment-display toggle (view-only): collapse the main track into one
  // block or show the per-scene fragments. Does NOT touch the fragment data, so
  // render is unaffected. Persisted per project as mv2FlatView.
  MV2Tab.setFlatView = function (on) {
    if (!_sessionKey) return;
    try { window.MV2.setFields(_sessionKey, { mv2FlatView: !!on }); } catch {}
    _selected = { kind: 'track', scope: 'seg' };   // keep the toggle visible in the inspector
    _multiSel.clear();
    _reload();
  };

  // Default the range to the first RANGE_DEFAULT_SEC (clamped to the timeline).
  function _rangeDefault() {
    const total = (_model && _model.totalDur) || 0;
    const right = total > 0 ? Math.min(1, RANGE_DEFAULT_SEC / total) : 1;
    return { left: 0, right };
  }
  function _applyRangeToggleUi() {
    const btn = document.getElementById('mv2-range-toggle');
    if (btn) btn.classList.toggle('on', _rangeOn);
    const bar = document.getElementById('mv2-range');
    if (bar) bar.style.display = _rangeOn ? '' : 'none';
  }
  // Turn the render-range on/off. persist=false during load (no write-back).
  function _setRangeOn(on, persist) {
    _rangeOn = !!on;
    if (_rangeOn) _rangePct = _rangeDefault();      // each toggle resets to the first 2 min
    if (persist !== false) { try { window.MV2.setFields(_sessionKey, { mv2RangeOn: _rangeOn, mv2Range: _rangePct }); } catch {} }
    _applyRangeToggleUi();
    try { window.MV2Timeline.renderRange(); } catch {}
    _exportReset();
  }

  // Shift-click on a main fragment (VSL): accumulate a multi-selection for the
  // Merge action. Seeds from the currently selected fragment, then toggles.
  const _multiSel = new Set();
  MV2Tab.shiftSelectMain = function (idx) {
    if (!_model || !_model.isVsl) { MV2Tab.selectClip('main', idx); return; }
    if (!_multiSel.size && _selected && _selected.kind === 'main') _multiSel.add(_selected.key);
    if (_multiSel.has(idx) && _multiSel.size > 1) _multiSel.delete(idx);
    else _multiSel.add(idx);
    _selected = { kind: 'main', key: idx };
    window.MV2Timeline.applySelection(_selected);
    _renderInspector();
  };

  // Select a whole track (clicking its name) → inspector shows track-wide effects.
  MV2Tab.selectTrack = function (scope) {
    _selected = { kind: 'track', scope };
    _multiSel.clear();
    window.MV2Timeline.applySelection(_selected); // clears clip highlights + highlights the whole track row
    try { window.MV2Compositor.setSelectedInsert(null); } catch {}
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
    // Multi-selected VSL fragments → exclude the whole selection at once.
    if (_multiSel.size >= 2 && _model && _model.isVsl && _selected.kind === 'main') {
      _pushHistory();
      _multiSel.forEach(i => window.MV2.setExcluded(_sessionKey, i, true));
      _status(_multiSel.size + ' fragments excluded');
      _multiSel.clear();
      _selected = null;
      _reload();
      return;
    }
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

  // Label+slider row with the live value shown IN the left label, uniform-width slider
  // flush to the right. opts: { min, max, step, value, fmt(v)->str, onChange(v) }.
  function _sliderRow(labelText, opts) {
    const inp = document.createElement('input');
    inp.type = 'range'; inp.min = opts.min; inp.max = opts.max; inp.step = opts.step; inp.value = opts.value;
    const fmt = opts.fmt || (v => String(v));
    const row = _row(labelText, inp);
    const lab = row.querySelector('label');
    const upd = () => { lab.textContent = labelText + '  ' + fmt(parseFloat(inp.value)); };
    inp.addEventListener('input', upd);
    if (opts.onChange) inp.addEventListener('change', () => opts.onChange(parseFloat(inp.value)));
    upd();
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

  // Reset a whole track row to defaults (undoable via Ctrl+Z). Clears that scope's
  // track-wide settings; for the MAIN track it also clears per-segment speed / trim /
  // effects / reverse and un-excludes every segment.
  function _resetTrack(scope) {
    if (!_sessionKey) return;
    _pushHistory();
    const d = getTimelineData();
    const s = d[_sessionKey]; if (!s) return;
    if (scope === 'seg') {
      ['segSpeed', 'segVolume', 'segTransition', 'segAnimation', 'segFilter', 'segSfx', 'segSfxVolume'].forEach(k => delete s[k]);
      s.segmentSpeed = {}; s.segmentTrim = {}; s.segmentEffects = {}; s.segmentReversed = {}; s.excludedSegments = [];
    } else {
      [scope + 'Volume', scope + 'Audio', scope + 'Transition', scope + 'Animation', scope + 'Filter', scope + 'Sfx', scope + 'SfxVolume'].forEach(k => delete s[k]);
    }
    setTimelineData(d);
    _reload();
  }

  function _renderTrackInspector(body, scope) {
    if (scope === 'music') { _renderMusicInspector(body); return; }
    const sd = (typeof getTimelineData === 'function') ? (getTimelineData()[_sessionKey] || {}) : {};
    const TITLES = { seg: 'Main track — applies to all segments', biro: 'Birols track', hook: 'Hooks track', halfer: 'Halfers track' };
    const hasFx  = (scope === 'seg' || scope === 'biro');   // per-track effect + SFX UI
    const isSeg  = (scope === 'seg');

    const titleRow = document.createElement('div'); titleRow.className = 'mv2-insp-title mv2-insp-titlerow';
    const titleTxt = document.createElement('span'); titleTxt.textContent = TITLES[scope] || 'Track';
    titleRow.appendChild(titleTxt);
    const resetBtn = document.createElement('button'); resetBtn.className = 'mv2-insp-reset';
    resetBtn.textContent = '↺'; resetBtn.title = 'Reset this track to defaults';
    resetBtn.onclick = () => _resetTrack(scope);
    titleRow.appendChild(resetBtn);
    body.appendChild(titleRow);

    // VSL (sliced): show/hide the per-scene fragment boundaries (view only — does
    // not change the cut data or the render).
    if (isSeg && _model && _model.isVsl && ((_model.main || []).length > 1 || _model.flatView)) {
      const sw = _switch(!_model.flatView, (shown) => { MV2Tab.setFlatView(!shown); });
      body.appendChild(_row('Show fragments', sw));
    }

    // Main track: one speed that applies to EVERY talking-head segment and recomputes
    // the spine lengths. Inserts KEEP their absolute timeline position — changing a
    // track's speed must not move (or re-time) the other tracks' clips.
    if (isSeg) {
      body.appendChild(_sliderRow('Speed (all)', {
        min: '0.5', max: '2', step: '0.05', value: (sd.segSpeed != null ? sd.segSpeed : 1),
        fmt: v => v.toFixed(2) + 'x',
        onChange: (v) => {
          _pushHistory();
          const newSpeed = v || 1;
          ((_model && _model.main) || []).forEach(c => window.MV2.setSegmentSpeed(_sessionKey, c.idx, newSpeed));
          window.MV2.setFields(_sessionKey, { segSpeed: newSpeed });
          _reload();   // inserts stay put (no rescaleInserts)
        },
      }));
    }

    if (hasFx) {
      body.appendChild(_row('Transition', _fxSelect(_TRANS_OPTS, sd[scope + 'Transition'] || 'none', v => _stampTrack(scope, scope + 'Transition', 'transition', v))));
      body.appendChild(_row('Animation', _fxSelect(_ANIM_OPTS, sd[scope + 'Animation'] || 'none', v => _stampTrack(scope, scope + 'Animation', 'animation', v))));
      body.appendChild(_row('Filter', _fxSelect(_FILTER_OPTS, sd[scope + 'Filter'] || 'none', v => _stampTrack(scope, scope + 'Filter', 'filter', v))));
    }

    // Track volume master. main → segVolume; inserts → <scope>Volume. Per-clip Volume overrides it.
    const volKey = isSeg ? 'segVolume' : (scope + 'Volume');
    body.appendChild(_sliderRow('Volume', {
      min: '0', max: '1.5', step: '0.05', value: (sd[volKey] != null ? sd[volKey] : 1),
      fmt: v => Math.round(v * 100) + '%',
      onChange: (v) => { _pushHistory(); window.MV2.setFields(_sessionKey, { [volKey]: v }); _reload(); },
    }));

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
      const curSfx = sd[scope + 'Sfx'];
      const sfxOn = !!(curSfx && curSfx !== 'Нет');
      sfxSel.value = sfxOn ? curSfx : '';
      sfxSel.onchange = () => { _pushHistory(); window.MV2.setFields(_sessionKey, { [scope + 'Sfx']: sfxSel.value || 'Нет' }); _reload(); };
      body.appendChild(_row('SFX', sfxSel));

      // SFX volume row only when an SFX is selected (default is no SFX).
      if (sfxOn) {
        body.appendChild(_sliderRow('SFX vol', {
          min: '0', max: '1', step: '0.05', value: (sd[scope + 'SfxVolume'] != null ? sd[scope + 'SfxVolume'] : 0.8),
          fmt: v => Math.round(v * 100) + '%',
          onChange: (v) => { _pushHistory(); window.MV2.setFields(_sessionKey, { [scope + 'SfxVolume']: v }); _reload(); },
        }));
      }
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
    try { window.MV2Timeline.applyMultiSelection(_multiSel); } catch {}
    body.innerHTML = '';
    if (_selected && _selected.kind === 'track') { _renderTrackInspector(body, _selected.scope); return; }
    const clip = _findSelected();
    if (!clip) {
      body.innerHTML =
        '<div class="mv2-insp-help">' +
          '<div class="mv2-insp-title">Hot-keys</div>' +
          '<ul>' +
            '<li><b>Space</b> — play / pause</li>' +
            '<li><b>Esc</b> — deselect</li>' +
            '<li><b>Delete</b> — remove the selected clip</li>' +
            '<li><b>Ctrl+Z / Ctrl+Y</b> — undo / redo</li>' +
          '</ul>' +
          '<div class="mv2-insp-title">How to assemble</div>' +
          '<ol>' +
            '<li>Pick a category, then drag birols / hooks from the library onto the timeline.</li>' +
            '<li>Click a clip to edit it (speed, volume, effects); drag its edges to trim.</li>' +
            '<li>Click a track name on the left for track-wide settings.</li>' +
            '<li>Drag a track onto the Music lane; click "Subtitles" to add captions.</li>' +
            '<li>Press "Export (FFmpeg)" to render the final video.</li>' +
          '</ol>' +
        '</div>';
      return;
    }

    const title = document.createElement('div');
    title.className = 'mv2-insp-title';
    const kindLabel = clip.kind === 'main' ? 'Talking head'
      : clip.kind.charAt(0).toUpperCase() + clip.kind.slice(1);
    title.textContent = kindLabel + '  (' + clip.start.toFixed(2) + 's → ' + clip.end.toFixed(2) + 's)';
    body.appendChild(title);
    // Fragment text (the line for main; the clip name for inserts) on its own line below.
    if (clip.name) {
      const sub = document.createElement('div');
      sub.className = 'mv2-insp-subtitle';
      sub.textContent = clip.name;
      sub.title = clip.name;
      body.appendChild(sub);
    }

    if (clip.kind === 'main') {
      // VSL: merge UI for a multi-selection of fragments (shift-click).
      if (_model.isVsl && _multiSel.size >= 2) {
        const sorted = [..._multiSel].sort((a, b) => a - b);
        const contiguous = sorted.every((v, i) => i === 0 || v === sorted[i - 1] + 1);
        const mergeBtn = document.createElement('button');
        mergeBtn.textContent = '⛙ Merge ' + sorted.length + ' fragments';
        mergeBtn.style.cssText = 'font-size:11px;padding:3px 10px;cursor:pointer;width:100%;';
        mergeBtn.disabled = !contiguous;
        mergeBtn.onclick = () => {
          if (!window.MV2.mergeVslFragments(_sessionKey, sorted)) { _status('Merge failed'); return; }
          _multiSel.clear();
          _selected = null;
          _undoStack.length = 0; _redoStack.length = 0;   // cells changed — old snapshots are invalid
          _status('Merged into Fr.' + (sorted[0] + 1));
          _reload();
        };
        body.appendChild(_row('', mergeBtn));
        const mh = document.createElement('span'); mh.className = 'mv2-insp-hint';
        mh.textContent = contiguous
          ? sorted.length + ' fragments selected (Fr.' + (sorted[0] + 1) + '–Fr.' + (sorted[sorted.length - 1] + 1) + '). Delete excludes them all.'
          : 'Only ADJACENT fragments can merge — adjust the selection.';
        body.appendChild(mh);
      }
      // VSL: a single whole-video segment offers slicing into scene fragments.
      if (_model.isVsl && _model.main.length === 1 && _multiSel.size < 2) {
        const sliceBtn = document.createElement('button');
        sliceBtn.textContent = '✂ Slice into fragments';
        sliceBtn.style.cssText = 'font-size:11px;padding:3px 10px;cursor:pointer;width:100%;';
        sliceBtn.onclick = () => _openSlicePopup(clip);
        body.appendChild(_row('', sliceBtn));
      }
      // VSL sliced: show/hide fragment boundaries (view-only, render unaffected).
      if (_model.isVsl && _model.main.length > 1 && _multiSel.size < 2) {
        const sw = _switch(!_model.flatView, (shown) => { MV2Tab.setFlatView(!shown); });
        body.appendChild(_row('Show fragments', sw));
      }
      // Per-fragment speed for the talking head. Changing it recompacts the spine,
      // but inserts KEEP their absolute timeline position (a speed change must not
      // move the other tracks' clips).
      body.appendChild(_sliderRow('Speed', {
        min: '0.5', max: '2', step: '0.05', value: clip.speed || 1,
        fmt: v => v.toFixed(2) + 'x',
        onChange: (v) => { _pushHistory(); window.MV2.setSegmentSpeed(_sessionKey, clip.idx, v || 1); _reload(); },
      }));

      body.appendChild(_revRow(clip));
      _fragFxRows(body, clip);
      const exBtn = document.createElement('button');
      exBtn.className = 'mv2-insp-del';
      exBtn.textContent = 'Exclude segment';
      exBtn.onclick = () => { _pushHistory(); window.MV2.setExcluded(_sessionKey, clip.idx, true); _selected = null; _reload(); };
      body.appendChild(_row('', exBtn));
      const hint = document.createElement('span'); hint.className = 'mv2-insp-hint';
      hint.textContent = 'Speed resizes this fragment; inserts keep their position.';
      body.appendChild(hint);
      return;
    }

    if (clip.kind === 'music') {
      // Speed resizes the clip on the timeline (same content, faster = shorter).
      body.appendChild(_sliderRow('Speed', {
        min: '0.5', max: '2', step: '0.05', value: clip.speed || 1,
        fmt: v => v.toFixed(2) + 'x',
        onChange: (newSpeed) => {
          _pushHistory();
          const oldSpeed = clip.speed || 1;
          let newDur = (clip.end - clip.start) * (oldSpeed / (newSpeed || 1));
          if (clip.srcDur > 0) newDur = Math.min(newDur, clip.srcDur / (newSpeed || 1));   // can't exceed the source
          window.MV2.setMusicTiming(_sessionKey, clip.key, { speed: newSpeed || 1, end: (clip.start + Math.max(0.2, newDur)).toFixed(2) });
          _reload();
        },
      }));

      body.appendChild(_sliderRow('Volume', {
        min: '0', max: '1.5', step: '0.05', value: (clip.volume != null ? clip.volume : 0.5),
        fmt: v => Math.round(v * 100) + '%',
        onChange: (v) => { _pushHistory(); window.MV2.setMusicTiming(_sessionKey, clip.key, { volume: v }); _reload(); },
      }));

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

    body.appendChild(_sliderRow('Speed', {
      min: '0.25', max: '2', step: '0.05', value: clip.speed || 1,
      fmt: v => v.toFixed(2) + 'x',
      onChange: (newSpeed) => {
        _pushHistory();
        const oldSpeed = clip.speed || 1;
        // Speed resizes the clip on the timeline: same content plays, faster = shorter.
        let newDur = (clip.end - clip.start) * (oldSpeed / (newSpeed || 1));
        if (clip.srcDur > 0) newDur = Math.min(newDur, clip.srcDur / (newSpeed || 1));   // can't exceed the source
        window.MV2.setInsertTiming(_sessionKey, clip.kind, clip.key, { speed: newSpeed || 1, end: (clip.start + Math.max(0.1, newDur)).toFixed(2) });
        _reload();
      },
    }));

    // Audio on/off for THIS insert (default muted) — overrides the track default.
    const audSw = _switch(!!clip.audioOn, (on) => {
      _pushHistory();
      window.MV2.setInsertTiming(_sessionKey, clip.kind, clip.key, { audio: on });
      _reload();
    });
    body.appendChild(_row('Audio', audSw));

    // Per-insert volume — overrides the track volume. Effective = this ?? track ?? 1.
    body.appendChild(_sliderRow('Volume', {
      min: '0', max: '1.5', step: '0.05', value: (clip.volume != null ? clip.volume : 1),
      fmt: v => Math.round(v * 100) + '%',
      onChange: (v) => { _pushHistory(); window.MV2.setInsertTiming(_sessionKey, clip.kind, clip.key, { volume: v }); _reload(); },
    }));

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

    // Picture-in-picture position/size (birols + hooks; halfers use band controls).
    // Drag the insert on the preview to move, corners to resize; these fields
    // mirror it numerically. "Full frame" clears the transform.
    if (!isHalfer) {
      const hasTf = clip.tw != null;
      const pct = (v) => Math.round((v || 0) * 100);
      const applyTf = (patch) => {
        _pushHistory();
        const base = { tx: clip.tx || 0, ty: clip.ty || 0, tw: clip.tw != null ? clip.tw : 1 };
        const next = Object.assign(base, patch);
        next.tw = Math.max(0.04, Math.min(1, next.tw));
        next.tx = Math.max(0, Math.min(1 - 0.02, next.tx));
        next.ty = Math.max(0, Math.min(1 - 0.02, next.ty));
        window.MV2.setInsertTiming(_sessionKey, clip.kind, clip.key, next);
        clip.tx = next.tx; clip.ty = next.ty; clip.tw = next.tw;   // live preview without a video reload
        try { window.MV2Compositor.setSelectedInsert(_selected); } catch {}
        _renderInspector();
      };
      const _numRow = (label, val, onCommit) => {
        const inp = document.createElement('input');
        inp.type = 'number'; inp.min = '0'; inp.max = '100'; inp.step = '1'; inp.value = String(val);
        inp.style.cssText = 'width:130px;font-size:11px;';
        inp.addEventListener('change', () => onCommit(Math.max(0, Math.min(100, parseFloat(inp.value) || 0)) / 100));
        return _row(label, inp);
      };
      if (hasTf) {
        body.appendChild(_numRow('Size %',  pct(clip.tw), (v) => applyTf({ tw: v })));
        body.appendChild(_numRow('Left %',  pct(clip.tx), (v) => applyTf({ tx: v })));
        body.appendChild(_numRow('Top %',   pct(clip.ty), (v) => applyTf({ ty: v })));
        const ffBtn = document.createElement('button');
        ffBtn.textContent = '⛶ Full frame';
        ffBtn.title = 'Clear the picture-in-picture transform (cover the whole frame)';
        ffBtn.style.cssText = 'font-size:11px;padding:3px 10px;cursor:pointer;';
        ffBtn.onclick = () => {
          _pushHistory();
          window.MV2.setInsertTiming(_sessionKey, clip.kind, clip.key, { tx: null, ty: null, tw: null });
          clip.tx = undefined; clip.ty = undefined; clip.tw = undefined;
          try { window.MV2Compositor.setSelectedInsert(_selected); } catch {}
          _renderInspector();
        };
        body.appendChild(_row('', ffBtn));
      } else {
        const pipBtn = document.createElement('button');
        pipBtn.textContent = '⧉ Picture-in-picture';
        pipBtn.title = 'Shrink this insert into a movable box (or drag a corner on the preview)';
        pipBtn.style.cssText = 'font-size:11px;padding:3px 10px;cursor:pointer;';
        pipBtn.onclick = () => applyTf({ tx: 0.05, ty: 0.05, tw: 0.4 });
        body.appendChild(_row('', pipBtn));
      }
      const th = document.createElement('span'); th.className = 'mv2-insp-hint';
      th.textContent = hasTf ? 'Drag on the preview to move · corners to resize.' : 'Full frame. Enable PiP, then drag on the preview.';
      body.appendChild(th);
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
      add('__favorites__', '⭐ Favorites');   // top + default — birols starred with the ☆ on each card
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
      if (_birolCat === '__favorites__') items = items.filter(it => it.isFavorited);
      else if (_birolCat === '__uncat__') items = items.filter(it => it.categoryId !== '__uploads__' && (!it.categoryId || !validCatIds.has(it.categoryId)));
      else items = items.filter(it => it.categoryId === _birolCat);
    }
    if (!items.length) {
      const e = document.createElement('div');
      e.className = 'mv2-media-empty';
      e.textContent = _mediaTab === 'hook' ? 'No hooks yet — upload them in the Hooks tab.'
        : _mediaTab === 'upload' ? 'No uploads yet — use the “＋ Upload videos” button above.'
        : _birolCat === '__favorites__' ? 'No favorites yet — click the ☆ on a birol to add it here.'
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

      // ☆/★ (top-left) → toggle Favorite. Birols tab only; persists on the archive
      // entry (isFavorited) like categoryId does. The Favorites dropdown view lists them.
      if (_mediaTab === 'birol') {
        const fav = !!item.isFavorited;
        const star = document.createElement('button');
        star.className = 'mv2-media-star' + (fav ? ' on' : '');
        star.textContent = fav ? '★' : '☆';
        star.title = fav ? 'Remove from Favorites' : 'Add to Favorites';
        star.addEventListener('mousedown', (e) => e.stopPropagation());   // don't start a drag
        star.addEventListener('click', (e) => {
          e.stopPropagation();                                            // don't open the preview
          if (typeof updateBirolyEntry === 'function') updateBirolyEntry(item.id, { isFavorited: !fav });
          _renderMedia();
        });
        card.appendChild(star);
      }

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
      _status(_mode() === 'vsl' ? 'Pick a video above to start a VSL project.' : 'Star a project in Merge to edit it here.');
      return;
    }
    let want = _sessionKey;
    if (!want) { try { want = localStorage.getItem(_prefKey()); } catch {} }
    if (!want || !list.some(s => s.sessionKey === want)) want = list[0].sessionKey;
    _loadSession(want);
  };

  // Refresh the media gallery (called after a hook upload completes).
  MV2Tab.refreshMedia = function () { if (_inited) _reload(); };

  // ── Export via FFmpeg (reuses the SHARED buildRenderPayload → identical body) ─
  function _fmtSpan(t) {
    const m = Math.floor(t / 60), s = Math.round(t % 60);
    return m + ':' + String(s).padStart(2, '0');
  }
  function _exportReset() {
    const btn = document.getElementById('mv2-export');
    if (!btn) return;
    const rp = MV2Tab.getRangePct();
    const ranged = _rangeOn && (rp.left > 0.001 || rp.right < 0.999);
    const span = _model ? (rp.right - rp.left) * _model.totalDur : 0;
    btn.textContent = ranged ? ('Export ' + _fmtSpan(span) + ' (FFmpeg)') : 'Export (FFmpeg)';
    btn.disabled = !(_model && _model.main && _model.main.length);
  }

  // The render popup: progress while the job runs, the finished video inside
  // when it's done. "Hide" keeps the render going (status line keeps updating;
  // the result overlay still opens on completion). "Cancel" aborts the job.
  function _openRenderPopup(title, expectedDur) {
    document.getElementById('mv2-render-overlay')?.remove();
    const ov = document.createElement('div');
    ov.id = 'mv2-render-overlay';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:10050;display:flex;align-items:center;justify-content:center;';
    const box = document.createElement('div');
    box.style.cssText = 'background:#1a1a1a;border:1.5px solid #555;border-radius:6px;padding:12px;display:flex;flex-direction:column;gap:8px;width:420px;max-width:94vw;max-height:92vh;color:#ddd;font-size:11px;';
    box.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;">' +
      '  <b style="font-size:12px;color:#fff;">🎬 Render — ' + String(title).replace(/</g, '&lt;') + '</b>' +
      '  <button id="mv2-r-hide" title="Hide — the render keeps going" style="background:#444;color:#fff;border:1px solid #666;border-radius:3px;cursor:pointer;padding:2px 8px;">✕</button>' +
      '</div>' +
      '<div id="mv2-r-status" style="min-height:14px;">Starting…</div>' +
      '<div style="height:16px;background:#000;border:1px solid #555;border-radius:3px;overflow:hidden;">' +
      '  <div id="mv2-r-prog" style="height:100%;width:0%;background:linear-gradient(90deg,#1c5e85,#2e86c1);transition:width .4s;"></div>' +
      '</div>' +
      '<div id="mv2-r-result" style="display:none;flex-direction:column;gap:8px;"></div>' +
      '<div style="display:flex;gap:6px;justify-content:flex-end;">' +
      '  <button id="mv2-r-cancel" style="background:#5a2222;color:#fff;border:1px solid #855;border-radius:3px;cursor:pointer;padding:3px 10px;">⏹ Cancel render</button>' +
      '</div>';
    ov.appendChild(box);
    document.body.appendChild(ov);
    box.querySelector('#mv2-r-hide').onclick = () => ov.remove();
    box.querySelector('#mv2-r-cancel').onclick = () => {
      if (_exportJob) _export();          // toggle path = cancel
      else ov.remove();
    };
    return {
      update(sj) {
        const st = document.getElementById('mv2-r-status');
        const bar = document.getElementById('mv2-r-prog');
        if (!st || !bar) return;          // popup hidden — skip silently
        if (sj.status === 'queued') {
          st.textContent = 'In queue' + (sj.queuePos > 0 ? ' — ' + sj.queuePos + ' render(s) ahead' : '') + '…';
          bar.style.width = '0%';
        } else if (sj.status === 'normalizing') {
          const cur = sj.normalizeCurrent ?? 0, tot = sj.normalizeTotal ?? 0;
          st.textContent = 'Normalizing clips ' + cur + '/' + tot + '…';
          bar.style.width = (tot > 0 ? Math.round(cur / tot * 25) : 5) + '%';   // first quarter of the bar
        } else {
          const pct = expectedDur > 0 ? Math.min(99, Math.round((sj.progressSecs || 0) / expectedDur * 100)) : 0;
          st.textContent = 'Rendering… ' + pct + '%' + (sj.progressSecs > 0 ? ' (' + Math.round(sj.progressSecs) + 's / ' + Math.round(expectedDur) + 's)' : '');
          bar.style.width = pct + '%';
        }
      },
      done(url) {
        const st = document.getElementById('mv2-r-status');
        const bar = document.getElementById('mv2-r-prog');
        const resWrap = document.getElementById('mv2-r-result');
        if (!st || !resWrap) { _showExportResult(url); return; }   // popup was hidden
        st.textContent = '✅ Done';
        if (bar) bar.style.width = '100%';
        resWrap.style.display = 'flex';
        resWrap.innerHTML = '';
        const vid = document.createElement('video');
        vid.src = url; vid.controls = true; vid.autoplay = true;
        vid.style.cssText = 'max-width:100%;max-height:60vh;background:#000;';
        const dl = document.createElement('a');
        dl.href = url; dl.download = ''; dl.target = '_blank';
        dl.textContent = '⬇ Download / open';
        dl.style.cssText = 'color:#8cf;text-decoration:underline;';
        resWrap.appendChild(vid); resWrap.appendChild(dl);
        const c = document.getElementById('mv2-r-cancel');
        if (c) { c.textContent = 'Close'; c.style.background = '#444'; c.style.borderColor = '#666'; }
        box.style.width = 'auto';
      },
      fail(msg) {
        const st = document.getElementById('mv2-r-status');
        if (st) st.textContent = '⚠ ' + (msg || 'Render error');
        const c = document.getElementById('mv2-r-cancel');
        if (c) { c.textContent = 'Close'; c.style.background = '#444'; c.style.borderColor = '#666'; }
      },
    };
  }

  // Ensure a VSL render master (variant 3: built once on first export, with a
  // progress popup). Resolves to the master URL, or null if cancelled/failed.
  function _ensureVslMaster(file) {
    return new Promise(async (resolve) => {
      const ov = document.createElement('div');
      ov.id = 'mv2-master-overlay';
      ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:10050;display:flex;align-items:center;justify-content:center;';
      const box = document.createElement('div');
      box.style.cssText = 'background:#1a1a1a;border:1.5px solid #555;border-radius:6px;padding:12px;width:420px;color:#ddd;font-size:11px;';
      box.innerHTML =
        '<div style="font-weight:bold;color:#fff;margin-bottom:6px;">⚙ Preparing fast-render master (one-time)</div>' +
        '<div style="color:#aaa;margin-bottom:8px;">Re-encoding the original with dense keyframes so this and future renders are fast. The original is kept.</div>' +
        '<div style="height:16px;background:#000;border:1px solid #555;border-radius:3px;overflow:hidden;"><div id="mv2-mst-bar" style="height:100%;width:0%;background:linear-gradient(90deg,#1c5e85,#2e86c1);transition:width .4s;"></div></div>' +
        '<div id="mv2-mst-status" style="min-height:14px;margin-top:6px;">Starting…</div>' +
        '<div style="display:flex;justify-content:flex-end;margin-top:8px;"><button id="mv2-mst-cancel" style="background:#5a2222;color:#fff;border:1px solid #855;border-radius:3px;cursor:pointer;padding:3px 10px;">Cancel</button></div>';
      ov.appendChild(box); document.body.appendChild(ov);
      const bar = box.querySelector('#mv2-mst-bar'), st = box.querySelector('#mv2-mst-status');
      let jobId = null, poll = null, cancelled = false;
      const finish = (val) => { if (poll) clearInterval(poll); try { ov.remove(); } catch {} resolve(val); };
      box.querySelector('#mv2-mst-cancel').onclick = () => { cancelled = true; if (jobId) fetch('/api/vsl/master/' + jobId, { method: 'DELETE' }).catch(() => {}); finish(null); };
      let r = null;
      try { r = await (await fetch('/api/vsl/master', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file }) })).json(); } catch {}
      if (!r || !r.success) { st.textContent = '⚠ ' + ((r && r.error) || 'Failed to start'); setTimeout(() => finish(null), 2000); return; }
      if (r.ready) { finish(r.master); return; }
      jobId = r.jobId;
      poll = setInterval(async () => {
        if (cancelled) return;
        let j = null; try { j = await (await fetch('/api/vsl/master/' + jobId)).json(); } catch {}
        if (!j || !j.success) return;
        bar.style.width = Math.round((j.progress || 0) * 100) + '%';
        st.textContent = 'Building… ' + Math.round((j.progress || 0) * 100) + '%';
        if (j.done) {
          if (j.error) { st.textContent = '⚠ ' + j.error; setTimeout(() => finish(null), 2500); }
          else { const v = _vslVideos.find(x => x.file === file); if (v) v.master = j.master; finish(j.master); }
        }
      }, 1500);
    });
  }

  async function _export() {
    const btn = document.getElementById('mv2-export');
    // Toggle = cancel a running job
    if (_exportJob) {
      try { fetch('/api/ffmpeg/cancel/' + _exportJob, { method: 'DELETE' }); } catch {}
      if (_exportPoll) { clearInterval(_exportPoll); _exportPoll = null; }
      _exportJob = null; _exportReset(); _status('Export cancelled');
      document.getElementById('mv2-render-overlay')?.remove();
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
      rangePct:    MV2Tab.getRangePct(),   // {0,1} when the range toggle is off
      musicClips:  _model.musicClips || [],
      segSfxUrl:   sd.segSfx || 'Нет',
      biroSfxUrl:  sd.biroSfx || 'Нет',
      outputLabel: _model.title || _sessionKey,
      advDefaults: (typeof ADV_DEFAULTS !== 'undefined') ? ADV_DEFAULTS : {},
      assDefaults: (typeof ASS_DEFAULTS !== 'undefined') ? ASS_DEFAULTS : {},
    });
    if (!payload.segmentClips.length) { _status('No video segments in the selected range'); return; }

    // VSL: render from a dense-keyframe master so smart-copy is fast (built once
    // on first export). Until then the render reads the pristine original.
    if (_model.isVsl) {
      const sess = (typeof editFrozenSessions !== 'undefined' ? editFrozenSessions : {})[_sessionKey] || {};
      const v = _vslVideos.find(x => x.file === sess.vslFile);
      let masterUrl = (v && v.master) || null;
      if (!masterUrl && sess.vslFile) {
        _status('Preparing fast-render master…');
        masterUrl = await _ensureVslMaster(sess.vslFile);
        if (!masterUrl) { _exportReset(); _status('Render cancelled'); return; }   // cancelled / failed
      }
      if (masterUrl) payload.segmentClips.forEach(c => {
        const p = String(c.videoPath || '');
        if (p.indexOf('/vsl/') === 0 && p.indexOf('/proxies/') < 0 && p.indexOf('/masters/') < 0) c.videoPath = masterUrl;
      });
    }

    const _rp = MV2Tab.getRangePct();
    const expectedDur = Math.max(0.1, (_rp.right - _rp.left) * _model.totalDur);
    const popup = _openRenderPopup(_model.title || _sessionKey, expectedDur);
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
            popup.done(sj.url);
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
            if (sj.status === 'cancelled') document.getElementById('mv2-render-overlay')?.remove();
            else popup.fail(sj.error);
          } else {
            popup.update(sj);
            if (sj.status === 'normalizing') _status('Normalizing clips ' + (sj.normalizeCurrent ?? 0) + '/' + (sj.normalizeTotal ?? 0) + '…');
            else if (sj.status === 'queued') _status('Render queued…');
            else _status('Rendering…' + (sj.progressSecs > 0 ? ' (' + Math.round(sj.progressSecs) + 's)' : ''));
          }
        } catch {}
      }, 1500);
    }).catch(e => { _exportJob = null; _exportReset(); _status((e.message || e).slice(0, 120)); popup.fail((e.message || e).slice(0, 120)); });
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
