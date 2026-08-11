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
      // Sync asset table visibility when switching L1 tabs. window.-guarded: on
      // trimmed standalone pages the defining script may be absent, and a bare
      // `fn?.()` on an UNDECLARED identifier still throws ReferenceError (which
      // would abort the whole tab activation). window.fn?.() safely no-ops.
      if (tabListId === 'l1-tabs') window.syncAssetDropZone?.();
    });
  });
}

setupTabs('l1-tabs');

// ── L1 Мозги: load prompts on first open ─────────────────────────────────────
document.querySelector('#l1-tabs [aria-controls="l1-mozgi"]')
  ?.addEventListener('click', () => { if (!promptsLoaded) loadPrompts(); });

// ── L1 База данных: top-row tab buttons (replaces former dropdown nav) ──────
// 5 user-facing categories at the top of the Library popup. Characters,
// ── Combo tab (Склейка): nav sub-buttons with Scenarios / Birols / Hooks / Merge ──
// Two panels left: Birols (only on its own page) and Merge. The old v1 Scenarios panel
// and the retired Edit panel are gone (Ph17) — every other tab is its own page now, and
// page-router turns a nav click for it into navigation.
const COMBO_PANELS = ['l1-osnovnye', 'combo-sub-mergev2'];
const COMBO_KEY = 'combo_selected_panel';

function showComboPanel(value) {
  // value: 'biroly' | 'mergev2' | 'scen2' (Scenarios: navigation, no panel here)
  const birolyEl   = document.getElementById('l1-osnovnye');
  const mergev2El  = document.getElementById('combo-sub-mergev2');
  const handsEl    = document.getElementById('biroly-hands-panel');
  const modeSel    = document.getElementById('biroly-mode-select');
  const isHandsMode = (modeSel?.value === 'hands');

  if (birolyEl)   birolyEl.classList.toggle('active',   value === 'biroly' && !isHandsMode);
  if (handsEl) {
    const showHands = (value === 'biroly' && isHandsMode);
    handsEl.style.display = showHands ? 'flex' : 'none';
    handsEl.classList.toggle('active', showHands);
  }
  if (mergev2El)  mergev2El.style.display = (value === 'mergev2') ? 'flex' : 'none';
  const birolyModeBar = document.getElementById('biroly-mode-bar');
  if (birolyModeBar) birolyModeBar.style.display = (value === 'biroly') ? 'flex' : 'none';

  if (value === 'biroly')       { window.renderBirolyStrip?.(); }
  else if (value === 'mergev2') { window.MV2Tab?.activate?.(); }
}

const comboBtns = document.querySelectorAll('.combo-mode-btn');
let activeComboVal = localStorage.getItem(COMBO_KEY) || 'scen2';
// Old Merge ('skleyka', legacy 'finals') replaced by Merge v2; Hooks sub-tab removed.
if (activeComboVal === 'finals' || activeComboVal === 'skleyka') { activeComboVal = 'mergev2'; localStorage.setItem(COMBO_KEY, activeComboVal); }
if (activeComboVal === 'hooks')  { activeComboVal = 'scen2'; localStorage.setItem(COMBO_KEY, activeComboVal); }
if (activeComboVal === 'edit' || activeComboVal === 'edit2') { activeComboVal = 'scen2'; localStorage.setItem(COMBO_KEY, activeComboVal); }  // Edit tab removed -> land on Scenarios
// Old v1 Scenarios tab retired — its nav button is gone; route any saved selection to the new Scenarios (scen2).
if (activeComboVal === 'scenarii') { activeComboVal = 'scen2'; localStorage.setItem(COMBO_KEY, activeComboVal); }

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


// ── Init: always show the saved combo sub-panel inside l1-skleyka ────────────
{
  const birolyEl   = document.getElementById('l1-osnovnye');
  const handsElInit = document.getElementById('biroly-hands-panel');
  const modeSelInit = document.getElementById('biroly-mode-select');
  const isHandsModeInit = (modeSelInit?.value === 'hands');
  if (birolyEl)   birolyEl.classList.toggle('active',   activeComboVal === 'biroly' && !isHandsModeInit);
  if (handsElInit) {
    const showHands = (activeComboVal === 'biroly' && isHandsModeInit);
    handsElInit.style.display = showHands ? 'flex' : 'none';
    handsElInit.classList.toggle('active', showHands);
  }
  const mergev2ElInit = document.getElementById('combo-sub-mergev2');
  if (mergev2ElInit) mergev2ElInit.style.display = (activeComboVal === 'mergev2') ? 'flex' : 'none';
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
        window.syncDropdownLabel?.(p.key, p.customLabel);
      }
    });
  } catch {}
})();

// ── Init: recover pending tasks from previous session ────────────────────────
(async () => {
  try {
    const d = await fetch('/api/recover-tasks').then(r => r.json());
    if (d.success && d.recovered > 0) {
      window.setStatus?.(`Restored ${d.recovered} generation${d.recovered === 1 ? '' : 's'} from the previous session`);
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
    brain:   { el: document.getElementById('brain-popup'),   opened: false, onFirstOpen: () => {
      // Lazy-load Brain prompts on first open.
      if (typeof loadPrompts === 'function' && typeof promptsLoaded !== 'undefined' && !promptsLoaded) {
        loadPrompts();
      }
    }},
    // first-open hook is just here for symmetry (no extra work required).
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
  // 📚 Library is its own page now (Ph18). The button keeps its familiar place and
  // navigates instead of opening the popup; the popup itself goes once the page covers
  // everything it did.
  document.getElementById('btn-open-library')?.addEventListener('click', () => { window.location.href = '/library'; });
  document.getElementById('btn-open-brain')  ?.addEventListener('click', () => openPopup('brain'));

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

// ── (Removed) Resizable nav columns ──────────────────────────────────────────
// The navigation moved to a fixed horizontal top bar (.app-topnav), so the old
// vertical-column drag handles and --nav-w / --lib-w resizing are gone.
