/* ═══════════════════════════════════════════════════════════════════════════
   page-router.js — per-tab URLs over the shared shell (Phase 5c, step 1).

   Each tab is reachable at its own path (/character, /scenarios, /edit, /merge,
   /birols). The server serves the single index.html at every one of these paths;
   this module maps URL ⇄ the existing tab/combo buttons so that:
     • a deep link / refresh / bookmark lands on the right tab,
     • switching tabs updates the address bar (history.pushState),
     • browser Back/Forward move between tabs,
   while in-page switching stays instant (no reload). Relative asset URLs keep
   working because index.html declares <base href="/">.

   It reuses the EXISTING button handlers (it just .click()s them), so there's no
   duplicated activation logic. Load AFTER tabs.js.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  // path → how to activate that tab (drive the existing buttons).
  const ACTIVATE = {
    '/character': () => _clickL1('l1-character'),
    '/scenarios': () => _clickCombo('scen2'),
    '/edit':      () => _clickCombo('edit'),
    '/merge':     () => _clickCombo('mergev2'),
    '/birols':    () => _clickCombo('biroly'),
  };
  // combo value → canonical path (for reflecting manual switches in the URL).
  const COMBO_PATH = { scen2: '/scenarios', edit: '/edit', mergev2: '/merge', biroly: '/birols' };

  let _suppress = false;   // true while activating programmatically (don't push URL)

  function _clickL1(panelId) { const b = document.querySelector('#l1-tabs [aria-controls="' + panelId + '"]'); if (b) b.click(); }
  function _clickCombo(v) { const b = document.querySelector('.combo-mode-btn[data-combo="' + v + '"]'); if (b) b.click(); }

  function _activate(path) {
    const fn = ACTIVATE[path];
    if (!fn) return false;
    _suppress = true;
    try { fn(); } catch (e) { console.warn('[page-router] activate failed', e); } finally { _suppress = false; }
    return true;
  }
  function _push(path) { if (location.pathname !== path) history.pushState({ path: path }, '', path); }

  function _wire() {
    // Reflect manual tab switches in the address bar.
    const charBtn = document.querySelector('#l1-tabs [aria-controls="l1-character"]');
    if (charBtn) charBtn.addEventListener('click', () => { if (!_suppress) _push('/character'); });
    document.querySelectorAll('.combo-mode-btn').forEach(b =>
      b.addEventListener('click', () => { if (_suppress) return; const p = COMBO_PATH[b.dataset.combo]; if (p) _push(p); }));
    // Clicking the Production L1 tab shows the last-used combo → reflect its path.
    const prodBtn = document.querySelector('#l1-tabs [aria-controls="l1-skleyka"]');
    if (prodBtn) prodBtn.addEventListener('click', () => {
      if (_suppress) return;
      let v = 'scen2'; try { v = localStorage.getItem('combo_selected_panel') || 'scen2'; } catch {}
      const p = COMBO_PATH[v]; if (p) _push(p);
    });

    // Browser Back/Forward → activate the tab for the new URL (no extra push).
    window.addEventListener('popstate', () => { _activate(location.pathname); });

    // Deep-link on load: activate the tab the URL points to (overrides the
    // localStorage-restored default). For '/' we leave the default as-is.
    _activate(location.pathname);
  }

  // Programmatic navigation for other modules (e.g. Send-to-Edit → /edit).
  window.PageRouter = {
    go: function (path) { if (!ACTIVATE[path]) return; _push(path); _activate(path); },
    paths: Object.keys(ACTIVATE),
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _wire);
  else _wire();
})();
