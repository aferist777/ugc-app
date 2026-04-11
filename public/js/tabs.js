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
    });
  });
}

setupTabs('l1-tabs');
setupTabs('l2-osnovnye-tabs');
setupTabs('archive-tabs');

// ── L1 Мозги: load prompts on first open ─────────────────────────────────────
document.querySelector('#l1-tabs [aria-controls="l1-mozgi"]')
  ?.addEventListener('click', () => { if (!promptsLoaded) loadPrompts(); });

// ── L1 База данных: load archives + set up sub-tab ──────────────────────────
document.querySelector('#l1-tabs [aria-controls="l1-archive"]')
  ?.addEventListener('click', () => {
    loadArchive('character');
    loadArchive('lookbook');
    loadArchive('environment');
  });

// ── L1 Сценарии: load scenarios on tab switch ────────────────────────────────
document.querySelector('#l1-tabs [aria-controls="l1-scenarii"]')
  ?.addEventListener('click', loadScenarios);

// ── Archive sub-tabs ──────────────────────────────────────────────────────────
document.querySelector('#archive-tabs [aria-controls="archive-obrazy"]')
  ?.addEventListener('click', loadObrazы);
document.querySelector('#archive-tabs [aria-controls="archive-scenes"]')
  ?.addEventListener('click', loadSceneList);

// ── Load details on Персонаж tab init ─────────────────────────────────────────
document.querySelector('#l1-tabs [aria-controls="l1-character"]')
  ?.addEventListener('click', () => loadDetails?.());

// ── Сцена tab: load assets on open ───────────────────────────────────────────
document.querySelector('#l1-tabs [aria-controls="l1-scena"]')
  ?.addEventListener('click', () => loadScenaAssets?.());
