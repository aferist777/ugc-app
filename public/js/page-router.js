/* ═══════════════════════════════════════════════════════════════════════════
   page-router.js — per-tab URLs + cross-page navigation (Phase 5c).

   Each tab has its own path: /character, /scenarios, /edit, /merge, /birols.
   A page declares which tabs it HOSTS in-page via `window.__PAGE_TABS` (set in a
   small inline <script> before this file loads). Clicking a nav item:
     • hosted here  → instant in-page switch + history.pushState (no reload),
     • not hosted   → full navigation to that page's URL.
   So every standalone page (e.g. character.html, hosts only 'character') uses
   ONE consistent nav.

   Deep links / refresh / bookmarks land on the right tab; Back/Forward work.
   Relative asset URLs stay correct via <base href="/"> in the HTML.
   Reuses the EXISTING tab/combo buttons (just .click()s them) — no duplicated
   activation logic. Load AFTER tabs.js.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  function _clickL1(panelId) { const b = document.querySelector('#l1-tabs [aria-controls="' + panelId + '"]'); if (b) b.click(); }
  function _clickCombo(v) { const b = document.querySelector('.combo-mode-btn[data-combo="' + v + '"]'); if (b) b.click(); }

  // tab id → { path, activate() }.
  const TABS = {
    character: { path: '/character', activate: () => _clickL1('l1-character') },
    scenarios: { path: '/scenarios', activate: () => _clickCombo('scen2') },
    edit:      { path: '/edit',      activate: () => _clickCombo('edit') },
    merge:     { path: '/merge',     activate: () => _clickCombo('mergev2') },
    birols:    { path: '/birols',    activate: () => _clickCombo('biroly') },
  };
  const COMBO_TAB = { scen2: 'scenarios', edit: 'edit', mergev2: 'merge', biroly: 'birols' };
  const PATH_TAB = {}; Object.keys(TABS).forEach(id => { PATH_TAB[TABS[id].path] = id; });

  // Tabs this page renders in-page; others are reached by full navigation.
  const HOSTED = Array.isArray(window.__PAGE_TABS) ? window.__PAGE_TABS : Object.keys(TABS);
  const _hosts = (id) => HOSTED.indexOf(id) >= 0;

  let _suppress = false;   // true while activating programmatically (don't push/navigate)
  function _push(path) { if (location.pathname !== path) history.pushState({ path: path }, '', path); }
  function _go(path) { window.location.href = path; }

  // Keep EXACTLY ONE nav button highlighted (the current tab). The nav mixes a
  // role=tab "Character" (lit via aria-selected) with .combo-mode-btn siblings
  // (lit via .active); their states were independent, so the hardcoded combo
  // .active + Character aria-selected="true" both lit at once. Force them to agree.
  function _syncNav(curId) {
    const charBtn = document.querySelector('#l1-tabs [aria-controls="l1-character"]');
    if (charBtn) {
      const isCur = (curId === 'character');
      charBtn.setAttribute('aria-selected', isCur ? 'true' : 'false');
      // A legacy inline-<style> rule pins the INACTIVE role=tab button to a light
      // "chip" with !important (and it's duplicated across several <style> blocks),
      // so it outranks the skin and Character looked lit on every page. Element-inline
      // !important is the strongest author declaration — use it to force the flat look
      // when inactive, and clear it when active so the normal highlight shows.
      if (isCur) {
        ['background', 'color', 'border', 'box-shadow'].forEach(function (p) { charBtn.style.removeProperty(p); });
      } else {
        charBtn.style.setProperty('background', 'transparent', 'important');
        charBtn.style.setProperty('color', 'var(--muted)', 'important');
        charBtn.style.setProperty('border', 'none', 'important');
        charBtn.style.setProperty('box-shadow', 'none', 'important');
      }
    }
    document.querySelectorAll('.combo-mode-btn').forEach(function (b) {
      const id = COMBO_TAB[b.dataset.combo];
      if (id) b.classList.toggle('active', id === curId);
    });
  }

  // Go to a tab: in-page if hosted (+push URL), else navigate to its page.
  function _select(id, noPush) {
    const t = TABS[id]; if (!t) return;
    if (_hosts(id)) {
      _suppress = true;
      try { t.activate(); } catch (e) { console.warn('[page-router] activate failed', e); } finally { _suppress = false; }
      if (!noPush) _push(t.path);
      _syncNav(id);
    } else {
      _go(t.path);
    }
  }
  // Decide what a nav click for tab `id` should do (in-page push vs navigate).
  function _navClick(id) { if (_suppress) return; if (_hosts(id)) { _push(TABS[id].path); _syncNav(id); } else _go(TABS[id].path); }

  function _wire() {
    const charBtn = document.querySelector('#l1-tabs [aria-controls="l1-character"]');
    if (charBtn) charBtn.addEventListener('click', () => _navClick('character'));
    document.querySelectorAll('.combo-mode-btn').forEach(b =>
      b.addEventListener('click', () => { const id = COMBO_TAB[b.dataset.combo]; if (id) _navClick(id); }));
    const prodBtn = document.querySelector('#l1-tabs [aria-controls="l1-skleyka"]');
    if (prodBtn) prodBtn.addEventListener('click', () => {
      let v = 'scen2'; try { v = localStorage.getItem('combo_selected_panel') || 'scen2'; } catch {}
      _navClick(COMBO_TAB[v] || 'scenarios');
    });

    // Back/Forward → activate the tab for the new URL (or navigate if not hosted).
    window.addEventListener('popstate', () => {
      const id = PATH_TAB[location.pathname];
      if (id && _hosts(id)) _select(id, true);
      else if (id) _go(TABS[id].path);
    });

    // Deep-link on load: activate the URL's tab if this page hosts it.
    const id = PATH_TAB[location.pathname];
    if (id && _hosts(id)) _select(id, true);

    // Highlight exactly the current tab (fixes two buttons lit at once from the
    // hardcoded default combo .active). Fall back to this page's sole hosted tab.
    _syncNav(id || (HOSTED.length === 1 ? HOSTED[0] : null));

    _maybeAutoOpenEdit();
  }

  // Send-to-Edit from the standalone Scenarios page lands here as
  // /edit?open=<sessionKey>. Wait for the grid to hydrate that session, then open
  // its popup (parity with the in-shell flow), and clean the URL.
  function _maybeAutoOpenEdit() {
    if (location.pathname !== '/edit') return;
    const m = location.search.match(/[?&]open=([^&]+)/);
    if (!m) return;
    const key = decodeURIComponent(m[1]);
    let tries = 0;
    const tick = () => {
      tries++;
      const FZ = (typeof editFrozenSessions !== 'undefined') ? editFrozenSessions : (window.editFrozenSessions || {});
      if (window.EDIT2Popup && EDIT2Popup.open && FZ && FZ[key]) {
        try { EDIT2Popup.open(key); } catch (e) { console.warn('[page-router] auto-open', e); }
        try { history.replaceState({}, '', '/edit'); } catch {}
        return;
      }
      if (tries < 40) setTimeout(tick, 200);   // up to ~8s for hydrate
    };
    setTimeout(tick, 300);
  }

  // Programmatic navigation for other modules (e.g. Send-to-Edit → /edit).
  window.PageRouter = { go: function (path) { const id = PATH_TAB[path]; if (id) _select(id); }, hosts: _hosts };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _wire);
  else _wire();
})();
