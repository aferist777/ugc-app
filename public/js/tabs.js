/* ═══════════════════════════
   TABS — generic tab switcher
   ═══════════════════════════ */

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
setupTabs('l2-char-tabs');
setupTabs('l2-osnovnye-tabs');
setupTabs('l2-skleyka-tabs');
setupTabs('inner-tabs-gallery');
setupTabs('inner-tabs-archive');
setupTabs('l2-test-tabs');

// ── Gallery tab clicks ────────────────────────────────────────────────────────
document.querySelector('#l2-char-tabs [aria-controls="tab-gallery"]')
  ?.addEventListener('click', () => { loadGalleryChars(); loadGalleryLookbooks(); loadGalleryEnvironments(); });
document.querySelector('#l2-char-tabs [aria-controls="tab-archive"]')
  ?.addEventListener('click', () => { loadArchive('character'); loadArchive('lookbook'); loadArchive('environment'); });

document.querySelector('#inner-tabs-gallery [aria-controls="tab-g-chars"]')?.addEventListener('click', loadGalleryChars);
document.querySelector('#inner-tabs-gallery [aria-controls="tab-g-lb"]')   ?.addEventListener('click', loadGalleryLookbooks);
document.querySelector('#inner-tabs-gallery [aria-controls="tab-g-env"]')  ?.addEventListener('click', loadGalleryEnvironments);

document.querySelector('#inner-tabs-archive [aria-controls="tab-a-chars"]')?.addEventListener('click', () => loadArchive('character'));
document.querySelector('#inner-tabs-archive [aria-controls="tab-a-lb"]')   ?.addEventListener('click', () => loadArchive('lookbook'));
document.querySelector('#inner-tabs-archive [aria-controls="tab-a-env"]')  ?.addEventListener('click', () => loadArchive('environment'));

// ── Основные tab clicks ───────────────────────────────────────────────────────
document.querySelector('#l2-osnovnye-tabs [aria-controls="tab-scenarii"]')?.addEventListener('click', loadScenarios);
document.querySelector('#l2-osnovnye-tabs [aria-controls="tab-predmety"]') ?.addEventListener('click', loadDetails);
