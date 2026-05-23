/* ═══════════════════════════════════════════════════════════════════
   TABS — generic tab switcher + L1/L2 event hooks
   ═══════════════════════════════════════════════════════════════════ */

function setupTabs(tabListId) {
  const list = document.getElementById(tabListId);
  if (!list) return;
  const buttons = list.querySelectorAll('[role="tab"]');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      buttons.forEach(b => {
        b.setAttribute('aria-selected', 'false');
        const panel = document.getElementById(b.getAttribute('aria-controls'));
        if (panel) panel.classList.remove('active');
      });
      btn.setAttribute('aria-selected', 'true');
      const target = document.getElementById(btn.getAttribute('aria-controls'));
      if (target) target.classList.add('active');
      // Sync asset table visibility when switching L1 tabs
      if (tabListId === 'l1-tabs') syncAssetDropZone?.();
    });
  });
}

setupTabs('l1-tabs');

// ── L1 Мозги: load prompts on first open ─────────────────────────────────────
document.querySelector('#l1-tabs [aria-controls="l1-mozgi"]')
  ?.addEventListener('click', () => { if (!promptsLoaded) loadPrompts(); });

// ── L1 База данных: top-row tab buttons (replaces former dropdown nav) ──────
// 5 user-facing categories at the top of the Library popup. Characters,
// Lookbooks and Environments map onto the same `archive-assets` HTML panel
// (split by the existing data-asset-shown attribute). Birols / Hooks each
// own their dedicated panel.
const ARCHIVE_PANELS = ['archive-assets', 'archive-obrazy', 'archive-scenes', 'archive-hooks', 'archive-biroly', 'archive-details', 'archive-refs'];
const ARCHIVE_CAT_KEY = 'archive_selected_cat_v2';
const ARCHIVE_CATS    = ['characters', 'lookbooks', 'environments', 'obrazy', 'scenes', 'biroly', 'hooks', 'details', 'refs'];

function _archivePanelForCat(cat) {
  if (cat === 'characters' || cat === 'lookbooks' || cat === 'environments') return 'archive-assets';
  if (cat === 'obrazy')  return 'archive-obrazy';
  if (cat === 'scenes')  return 'archive-scenes';
  if (cat === 'biroly')  return 'archive-biroly';
  if (cat === 'hooks')   return 'archive-hooks';
  if (cat === 'details') return 'archive-details';
  if (cat === 'refs')    return 'archive-refs';
  return 'archive-assets';
}

function showArchivePanel(panelIdOrCat) {
  // Accept either a panel id (legacy) or a category string (new). Resolve to category first.
  let cat;
  if (ARCHIVE_CATS.includes(panelIdOrCat)) {
    cat = panelIdOrCat;
  } else if (panelIdOrCat === 'archive-obrazy')      cat = 'obrazy';
  else if (panelIdOrCat === 'archive-scenes')        cat = 'scenes';
  else if (panelIdOrCat === 'archive-biroly')        cat = 'biroly';
  else if (panelIdOrCat === 'archive-hooks')         cat = 'hooks';
  else if (panelIdOrCat === 'archive-details')       cat = 'details';
  else if (panelIdOrCat === 'archive-refs')          cat = 'refs';
  else                                                cat = 'characters';

  const panelId = _archivePanelForCat(cat);

  // Toggle which panel is the active one
  ARCHIVE_PANELS.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('active', id === panelId);
  });

  // For archive-assets, also pick which of the 3 sub-columns to show
  const assetsPanel = document.getElementById('archive-assets');
  if (assetsPanel && panelId === 'archive-assets') {
    assetsPanel.setAttribute('data-asset-shown', cat);
  }

  // Toggle active tab button visual state
  document.querySelectorAll('#archive-tabs-bar .archive-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.cat === cat);
  });

  // Load data for the active category
  if (panelId === 'archive-assets') {
    const lookupKind = (cat === 'characters') ? 'character'
                      : (cat === 'lookbooks') ? 'lookbook'
                      : 'environment';
    loadArchive(lookupKind);
  } else if (panelId === 'archive-hooks')   loadAllHooks?.();
  else   if (panelId === 'archive-biroly')  loadAllBiroly?.();
  else   if (panelId === 'archive-obrazy')  loadObrazы?.();
  else   if (panelId === 'archive-scenes')  loadSceneList?.();
  else   if (panelId === 'archive-details') loadArchiveDetails?.();
  else   if (panelId === 'archive-refs')    loadRefs?.();
}

// Wire the new tab buttons
function _wireArchiveTabs() {
  const bar = document.getElementById('archive-tabs-bar');
  if (!bar) return;
  bar.querySelectorAll('.archive-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const cat = btn.dataset.cat;
      if (!cat) return;
      try { localStorage.setItem(ARCHIVE_CAT_KEY, cat); } catch {}
      showArchivePanel(cat);
    });
  });
  // Restore last-selected category on first render
  let savedCat = null;
  try { savedCat = localStorage.getItem(ARCHIVE_CAT_KEY); } catch {}
  const initCat = (savedCat && ARCHIVE_CATS.includes(savedCat)) ? savedCat : 'characters';
  showArchivePanel(initCat);
}
_wireArchiveTabs();

// Keep window-level archiveDropdown reference null so legacy code paths short-circuit cleanly
const archiveDropdown = null;

// When user opens База данных tab — show the last selected category
document.querySelector('#l1-tabs [aria-controls="l1-archive"]')
  ?.addEventListener('click', () => {
    let cat = null;
    try { cat = localStorage.getItem(ARCHIVE_CAT_KEY); } catch {}
    if (!cat || !ARCHIVE_CATS.includes(cat)) cat = 'characters';
    showArchivePanel(cat);
  });

// ── Assets sub-dropdown: Characters / Lookbooks / Environments ───────────────
// Only one of the three is visible at a time inside Library → Assets.
// Selection persists in localStorage.
const ASSETS_SUB_KEY = 'archive_assets_sub_v1';
const archiveAssetsSubDropdown = document.getElementById('archive-assets-sub-dropdown');
const archiveAssetsPanel       = document.getElementById('archive-assets');
function applyAssetsSub(val) {
  if (!archiveAssetsPanel) return;
  archiveAssetsPanel.setAttribute('data-asset-shown', val || 'characters');
}
if (archiveAssetsSubDropdown && archiveAssetsPanel) {
  // Restore saved selection
  const savedSub = localStorage.getItem(ASSETS_SUB_KEY);
  const initSub  = (savedSub && ['characters','lookbooks','environments'].includes(savedSub)) ? savedSub : 'characters';
  archiveAssetsSubDropdown.value = initSub;
  applyAssetsSub(initSub);

  archiveAssetsSubDropdown.addEventListener('change', () => {
    const v = archiveAssetsSubDropdown.value;
    localStorage.setItem(ASSETS_SUB_KEY, v);
    applyAssetsSub(v);
  });
}

// ── Load details on Персонаж tab init ─────────────────────────────────────────
document.querySelector('#l1-tabs [aria-controls="l1-character"]')
  ?.addEventListener('click', () => loadDetails?.());

// ── Сцена tab: load assets on open ───────────────────────────────────────────
document.querySelector('#l1-tabs [aria-controls="l1-scena"]')
  ?.addEventListener('click', () => loadScenaAssets?.());

// ── Combo tab (Склейка): nav sub-buttons with Scenarios / Birols / Hooks / Merge ──
const COMBO_PANELS = ['l1-scenarii', 'l1-osnovnye', 'combo-sub-hooks', 'scen-panel-edit', 'combo-sub-skleyka'];
const COMBO_KEY = 'combo_selected_panel';

function showComboPanel(value) {
  // value: 'scenarii' | 'biroly' | 'hooks' | 'edit' | 'skleyka'
  const scenariiEl = document.getElementById('l1-scenarii');
  const birolyEl   = document.getElementById('l1-osnovnye');
  const hooksEl    = document.getElementById('combo-sub-hooks');
  const editEl     = document.getElementById('scen-panel-edit');
  const skleykaEl  = document.getElementById('combo-sub-skleyka');
  const handsEl    = document.getElementById('biroly-hands-panel');
  const modeSel    = document.getElementById('biroly-mode-select');
  const isHandsMode = (modeSel?.value === 'hands');

  if (scenariiEl) scenariiEl.classList.toggle('active', value === 'scenarii');
  if (birolyEl)   birolyEl.classList.toggle('active',   value === 'biroly' && !isHandsMode);
  if (handsEl) {
    const showHands = (value === 'biroly' && isHandsMode);
    handsEl.style.display = showHands ? 'flex' : 'none';
    handsEl.classList.toggle('active', showHands);
  }
  if (hooksEl)    hooksEl.style.display   = (value === 'hooks')   ? 'flex' : 'none';
  if (editEl) {
    const showEdit = (value === 'edit');
    editEl.style.display = showEdit ? 'block' : 'none';
    editEl.classList.toggle('active', showEdit);
  }
  if (skleykaEl)  skleykaEl.style.display = (value === 'skleyka') ? 'flex' : 'none';
  const birolyModeBar = document.getElementById('biroly-mode-bar');
  if (birolyModeBar) birolyModeBar.style.display = (value === 'biroly') ? 'flex' : 'none';

  if (value === 'scenarii') {
    loadScenarios?.(); loadScenarioObrazы?.();
    // Fire deferred Эдит re-render if the user was on Эдит sub-tab and switched away
    setTimeout(() => {
      const editPanel = document.getElementById('scen-panel-edit');
      if (editPanel?.classList.contains('active') && window._editPanelNeedsRender) {
        window._editPanelNeedsRender = false;
        renderEditPanel?.();
      }
    }, 0);
  }
  else if (value === 'biroly')  { renderBirolyStrip?.(); }
  else if (value === 'hooks')   { renderHooksSection?.(); }
  else if (value === 'edit')    {
    window._editPanelNeedsRender = false;
    _migrateStarredSessions?.();
    renderEditPanel?.();
  }
  else if (value === 'skleyka') { renderMontagePanel?.(); renderPostprod?.(); renderAllTimelines?.(); }
}

const comboBtns = document.querySelectorAll('.combo-mode-btn');
let activeComboVal = localStorage.getItem(COMBO_KEY) || 'scenarii';
if (activeComboVal === 'finals') { activeComboVal = 'skleyka'; localStorage.setItem(COMBO_KEY, activeComboVal); }

function setActiveComboBtnUI(value) {
  comboBtns.forEach(b => b.classList.toggle('active', b.dataset.combo === value));
}

// Restore saved selection on load
setActiveComboBtnUI(activeComboVal);

comboBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    activeComboVal = btn.dataset.combo;
    localStorage.setItem(COMBO_KEY, activeComboVal);
    setActiveComboBtnUI(activeComboVal);
    // Sub-buttons live in the left nav now — clicking one should also activate
    // the Production L1 tab if it isn't already. The Production click handler
    // will chain to showComboPanel(activeComboVal) via the listener below.
    const prodTabBtn = document.querySelector('#l1-tabs [aria-controls="l1-skleyka"]');
    const prodActive = prodTabBtn?.getAttribute('aria-selected') === 'true';
    if (!prodActive && prodTabBtn) {
      prodTabBtn.click();
    } else {
      showComboPanel(activeComboVal);
    }
  });
});

// ── Склейка tab click: show last-selected combo sub-panel ────────────────────
document.querySelector('#l1-tabs [aria-controls="l1-skleyka"]')
  ?.addEventListener('click', () => { showComboPanel(activeComboVal); });

// ── Init: if База данных tab is active on page load, show saved panel ────────
if (document.getElementById('l1-archive')?.classList.contains('active')) {
  const initPanel = archiveDropdown?.value || 'archive-assets';
  showArchivePanel(initPanel);
}

// ── Init: always show the saved combo sub-panel inside l1-skleyka ────────────
{
  const scenariiEl = document.getElementById('l1-scenarii');
  const birolyEl   = document.getElementById('l1-osnovnye');
  const hooksEl    = document.getElementById('combo-sub-hooks');
  const skleykaEl  = document.getElementById('combo-sub-skleyka');
  const handsElInit = document.getElementById('biroly-hands-panel');
  const modeSelInit = document.getElementById('biroly-mode-select');
  const isHandsModeInit = (modeSelInit?.value === 'hands');
  if (scenariiEl) scenariiEl.classList.toggle('active', activeComboVal === 'scenarii');
  if (birolyEl)   birolyEl.classList.toggle('active',   activeComboVal === 'biroly' && !isHandsModeInit);
  if (handsElInit) {
    const showHands = (activeComboVal === 'biroly' && isHandsModeInit);
    handsElInit.style.display = showHands ? 'flex' : 'none';
    handsElInit.classList.toggle('active', showHands);
  }
  if (hooksEl)    hooksEl.style.display   = (activeComboVal === 'hooks')   ? 'flex' : 'none';
  const editElInit = document.getElementById('scen-panel-edit');
  if (editElInit) {
    const showEdit = (activeComboVal === 'edit');
    editElInit.style.display = showEdit ? 'block' : 'none';
    editElInit.classList.toggle('active', showEdit);
  }
  if (skleykaEl)  skleykaEl.style.display = (activeComboVal === 'skleyka') ? 'flex' : 'none';
  const birolyModeBarInit = document.getElementById('biroly-mode-bar');
  if (birolyModeBarInit) birolyModeBarInit.style.display = (activeComboVal === 'biroly') ? 'flex' : 'none';
}

// ── Init: sync custom prompt labels to dropdowns on page load ─────────────────
(async () => {
  try {
    const d = await fetch('/api/prompts').then(r => r.json());
    if (!d.success) return;
    d.prompts.forEach(p => {
      if (p.customLabel && typeof RENAME_MAP !== 'undefined' && RENAME_MAP[p.key]) {
        syncDropdownLabel?.(p.key, p.customLabel);
      }
    });
  } catch {}
})();

// ── Init: recover pending tasks from previous session ────────────────────────
(async () => {
  try {
    const d = await fetch('/api/recover-tasks').then(r => r.json());
    if (d.success && d.recovered > 0) {
      setStatus?.(`Restored ${d.recovered} generation${d.recovered === 1 ? '' : 's'} from the previous session`);
    }
  } catch {}
})();

// ── App popups (Library, Brain) — only one open at a time ────────────────────
// Library and Brain are no longer L1 tabs. They're modal overlays toggled by
// buttons at the bottom of the left nav. Open/close behaviour: button click,
// backdrop click (event.target === popup), Esc key. Mutex: opening a popup
// closes any currently-open one. First-open hooks lazy-load content.
(function setupAppPopups() {
  const POPUPS = {
    library: { el: document.getElementById('library-popup'), opened: false, onFirstOpen: () => {
      // Show the saved sub-panel inside Library on first open.
      const dd = document.getElementById('archive-dropdown');
      const panelId = dd?.value || 'archive-assets';
      if (typeof showArchivePanel === 'function') showArchivePanel(panelId);
    }},
    brain:   { el: document.getElementById('brain-popup'),   opened: false, onFirstOpen: () => {
      // Lazy-load Brain prompts on first open.
      if (typeof loadPrompts === 'function' && typeof promptsLoaded !== 'undefined' && !promptsLoaded) {
        loadPrompts();
      }
    }},
    // Realism markers popup — moved out of Brain in 2026-05 per UX request so the
    // markers can be toggled from the Character tab without navigating away.
    // The body is built eagerly at startup by settings.js → appendRealismMarkersToPopup;
    // first-open hook is just here for symmetry (no extra work required).
    realism: { el: document.getElementById('realism-popup'), opened: false, onFirstOpen: () => {} },
    // Import / Export popup — wired by js/data-io.js. The category list inside
    // is lazy-loaded on first open via fetch('/api/data/categories').
    data:    { el: document.getElementById('data-popup'),    opened: false, onFirstOpen: () => {} },
    // Engine settings popup — per-model default params (aspect_ratio, quality,
    // etc.) for image generation. Wired by js/engine-settings.js, opened from
    // the ⚙ button next to the Character → Engine dropdown.
    'engine-settings': { el: document.getElementById('engine-settings-popup'), opened: false, onFirstOpen: () => {} },
    // Biroly engines popup — flow + video engine + (conditional) image engine,
    // each with its own params. Wired by js/biroly.js.
    'biroly-engines': { el: document.getElementById('biroly-engines-popup'), opened: false, onFirstOpen: () => {} },
  };

  function closeAll() {
    Object.values(POPUPS).forEach(p => { if (p.el) p.el.hidden = true; });
  }
  function openPopup(name) {
    closeAll();
    const p = POPUPS[name];
    if (!p?.el) return;
    p.el.hidden = false;
    if (!p.opened) { p.opened = true; try { p.onFirstOpen?.(); } catch (e) { console.warn('popup first-open', e); } }
  }
  window.openAppPopup  = openPopup;
  window.closeAppPopup = closeAll;

  // Wire up triggers
  document.getElementById('btn-open-library')?.addEventListener('click', () => openPopup('library'));
  document.getElementById('btn-open-brain')  ?.addEventListener('click', () => openPopup('brain'));
  document.getElementById('btn-open-realism')?.addEventListener('click', () => openPopup('realism'));

  // Close on backdrop click (clicking the dim overlay, not the inner window)
  Object.values(POPUPS).forEach(p => {
    if (!p.el) return;
    p.el.addEventListener('click', e => { if (e.target === p.el) closeAll(); });
  });
  // Close on ✕ button
  document.querySelectorAll('.app-popup-close').forEach(btn => {
    btn.addEventListener('click', closeAll);
  });
  // Close on Esc
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      const anyOpen = Object.values(POPUPS).some(p => p.el && !p.el.hidden);
      if (anyOpen) closeAll();
    }
  });
})();

// ── Resizable nav / library columns ──────────────────────────────────────────
// Two drag handles between the 3 grid columns. User pulls them, columns resize,
// center column compensates. Sizes persist in localStorage so they survive
// reloads. Each handle controls one CSS variable (--nav-w or --lib-w) on
// .app-grid; the center column is `1fr` and adjusts automatically.
(function setupAppResize() {
  const grid = document.querySelector('.app-grid');
  if (!grid) return;

  const LS_NAV = 'app_nav_width_v1';
  const LS_LIB = 'app_lib_width_v1';
  const NAV_MIN = 80,  NAV_MAX = 600;
  const LIB_MIN = 200, LIB_MAX = 560;

  // Restore saved widths
  const savedNav = parseInt(localStorage.getItem(LS_NAV), 10);
  const savedLib = parseInt(localStorage.getItem(LS_LIB), 10);
  if (savedNav >= NAV_MIN && savedNav <= NAV_MAX) grid.style.setProperty('--nav-w', savedNav + 'px');
  if (savedLib >= LIB_MIN && savedLib <= LIB_MAX) grid.style.setProperty('--lib-w', savedLib + 'px');

  function startDrag(handle, side) {
    const gridRect = grid.getBoundingClientRect();
    handle.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    function onMove(ev) {
      const x = ev.clientX;
      if (side === 'nav') {
        // Nav now sits on the RIGHT of the grid: distance from cursor to the
        // right edge = new nav width. Dragging the handle left-ward grows nav.
        let w = Math.max(NAV_MIN, Math.min(NAV_MAX, gridRect.right - x));
        grid.style.setProperty('--nav-w', w + 'px');
      } else {
        // (Legacy 'lib' side, no longer present in DOM — kept for safety.)
        let w = Math.max(LIB_MIN, Math.min(LIB_MAX, gridRect.right - x));
        grid.style.setProperty('--lib-w', w + 'px');
      }
    }
    function onUp() {
      handle.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      // Persist
      const cs = getComputedStyle(grid);
      const nav = parseInt(cs.getPropertyValue('--nav-w'), 10);
      const lib = parseInt(cs.getPropertyValue('--lib-w'), 10);
      if (nav) localStorage.setItem(LS_NAV, String(nav));
      if (lib) localStorage.setItem(LS_LIB, String(lib));
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  grid.querySelectorAll('.app-resize-handle').forEach(h => {
    const side = h.dataset.handle; // 'nav' | 'lib'
    h.addEventListener('mousedown', e => { e.preventDefault(); startDrag(h, side); });
    // Double-click to reset to default
    h.addEventListener('dblclick', () => {
      if (side === 'nav') { grid.style.setProperty('--nav-w', '140px'); localStorage.removeItem(LS_NAV); }
      else                { grid.style.setProperty('--lib-w', '300px'); localStorage.removeItem(LS_LIB); }
    });
  });
})();
