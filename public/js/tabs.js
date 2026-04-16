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

// ── L1 База данных: dropdown nav ─────────────────────────────────────────────
const ARCHIVE_PANELS = ['archive-assets', 'archive-obrazy', 'archive-scenes', 'archive-biroly', 'archive-geni', 'archive-projects', 'archive-refs', 'archive-finals'];
const ARCHIVE_KEY = 'archive_selected_panel';

function showArchivePanel(panelId) {
  ARCHIVE_PANELS.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('active', id === panelId);
  });
  // Load data for the selected panel
  if (panelId === 'archive-assets') {
    loadArchive('character');
    loadArchive('lookbook');
    loadArchive('environment');
  } else if (panelId === 'archive-obrazy') {
    loadObrazы?.();
  } else if (panelId === 'archive-scenes') {
    loadSceneList?.();
  } else if (panelId === 'archive-biroly') {
    loadAllBiroly?.();
  } else if (panelId === 'archive-geni') {
    loadAllGeni?.();
  } else if (panelId === 'archive-projects') {
    loadProjectsArchive?.();
  } else if (panelId === 'archive-refs') {
    loadRefs?.();
  } else if (panelId === 'archive-finals') {
    loadFinals?.();
  }
}

const archiveDropdown = document.getElementById('archive-dropdown');
if (archiveDropdown) {
  // Restore last selection
  const saved = localStorage.getItem(ARCHIVE_KEY);
  if (saved && ARCHIVE_PANELS.includes(saved)) {
    archiveDropdown.value = saved;
  }

  archiveDropdown.addEventListener('change', () => {
    const panelId = archiveDropdown.value;
    localStorage.setItem(ARCHIVE_KEY, panelId);
    showArchivePanel(panelId);
  });
}

// When user opens База данных tab — show the last selected panel
document.querySelector('#l1-tabs [aria-controls="l1-archive"]')
  ?.addEventListener('click', () => {
    const panelId = archiveDropdown?.value || 'archive-assets';
    showArchivePanel(panelId);
  });

// ── Load details on Персонаж tab init ─────────────────────────────────────────
document.querySelector('#l1-tabs [aria-controls="l1-character"]')
  ?.addEventListener('click', () => loadDetails?.());

// ── Сцена tab: load assets on open ───────────────────────────────────────────
document.querySelector('#l1-tabs [aria-controls="l1-scena"]')
  ?.addEventListener('click', () => loadScenaAssets?.());

// ── Combo tab (Склейка): dropdown with Сценарии / Биролы / Склейка ───────────
const COMBO_PANELS = ['l1-scenarii', 'l1-osnovnye', 'combo-sub-skleyka', 'combo-sub-finals'];
const COMBO_KEY = 'combo_selected_panel';

function showComboPanel(value) {
  // value: 'scenarii' | 'biroly' | 'skleyka' | 'finals'
  const scenariiEl = document.getElementById('l1-scenarii');
  const birolyEl   = document.getElementById('l1-osnovnye');
  const skleykaEl  = document.getElementById('combo-sub-skleyka');
  const finalsEl   = document.getElementById('combo-sub-finals');

  if (scenariiEl) scenariiEl.classList.toggle('active', value === 'scenarii');
  if (birolyEl)   birolyEl.classList.toggle('active',   value === 'biroly');
  if (skleykaEl)  skleykaEl.style.display = (value === 'skleyka') ? 'flex' : 'none';
  if (finalsEl)   finalsEl.style.display  = (value === 'finals')  ? 'block' : 'none';

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
  else if (value === 'skleyka') { renderMontagePanel?.(); renderPostprod?.(); renderAllTimelines?.(); }
  else if (value === 'finals')  { loadComboFinals?.(); }
}

const comboBtns = document.querySelectorAll('.combo-mode-btn');
let activeComboVal = localStorage.getItem(COMBO_KEY) || 'scenarii';

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
    showComboPanel(activeComboVal);
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
  const skleykaEl  = document.getElementById('combo-sub-skleyka');
  const finalsEl   = document.getElementById('combo-sub-finals');
  if (scenariiEl) scenariiEl.classList.toggle('active', activeComboVal === 'scenarii');
  if (birolyEl)   birolyEl.classList.toggle('active',   activeComboVal === 'biroly');
  if (skleykaEl)  skleykaEl.style.display = (activeComboVal === 'skleyka') ? 'flex' : 'none';
  if (finalsEl)   finalsEl.style.display  = (activeComboVal === 'finals')  ? 'block' : 'none';
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
      setStatus?.(`Восстановлено ${d.recovered} генерац${d.recovered === 1 ? 'ия' : d.recovered < 5 ? 'ии' : 'ий'} из предыдущей сессии`);
    }
  } catch {}
})();
