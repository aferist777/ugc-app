/* scen-redesign.js — Scenarios tab redesign:
   - Hint banner above scenario list (3 step states)
   - Toolbar buttons: Edit (popup with rename + global default fill %) + New scenario (popup)
   - Per-row checkbox tracking via window.checkedScenarios (set in scen-list.js buildScenarioItem)
   - Project Looks gate-highlight when no образ selected
   - Create button gating (disabled until образ + ≥1 checked scenario)
   - Reset on Create: clear образ, uncheck all scenarios, clear props
   - Fill randomly: sequential per checked scenario, N% of (total-3), first 3 fragments locked
*/
(function () {
  'use strict';

  const FILL_PCT_KEY = 'scen_default_fill_pct_v1';

  // Global checked-scenarios set (read by buildScenarioItem in scen-list.js)
  if (!window.checkedScenarios) window.checkedScenarios = new Set();

  function getDefaultFillPct() {
    const v = parseInt(localStorage.getItem(FILL_PCT_KEY) || '55', 10);
    if (isNaN(v) || v < 1 || v > 100) return 55;
    return v;
  }
  function setDefaultFillPct(v) {
    const n = Math.max(1, Math.min(100, parseInt(v, 10) || 55));
    localStorage.setItem(FILL_PCT_KEY, String(n));
  }
  window.getScenDefaultFillPct = getDefaultFillPct;

  // ── Hint banner + Project Looks gate + Create button gate ─────────────────
  function refreshScenStateUI() {
    const ao         = (typeof activeObrazIds !== 'undefined') ? activeObrazIds : null;
    const obrazSel   = !!(ao && ao.size > 0);
    const scenSel    = window.checkedScenarios && window.checkedScenarios.size > 0;
    const banner     = document.getElementById('scen-hint-banner');
    const createBtn  = document.getElementById('btn-scen-create');
    const looksBlock = document.querySelector('.scenarii-obrazy-block');
    const editBtn    = document.getElementById('btn-scen-edit-all');

    if (banner) {
      banner.classList.remove('step-1', 'step-2', 'step-3');
      if (!obrazSel && !scenSel) {
        banner.textContent = 'Step 1 — please select a project look (right column) and at least one scenario.';
        banner.classList.add('step-1');
      } else if (obrazSel && !scenSel) {
        banner.textContent = 'Step 2 — now select at least one scenario from the list below.';
        banner.classList.add('step-2');
      } else {
        banner.textContent = 'Step 3 — add props to the selected scenario(s) (optional).';
        banner.classList.add('step-3');
      }
    }

    if (createBtn) {
      const ready = obrazSel && scenSel;
      createBtn.disabled = !ready;
      createBtn.style.opacity = ready ? '' : '0.45';
      createBtn.style.cursor  = ready ? '' : 'not-allowed';
    }

    if (looksBlock) {
      looksBlock.classList.toggle('scen-gate-need-look', !obrazSel);
    }

    // Edit button is active whenever scenarios exist; disabled if list is empty
    if (editBtn) {
      const sf = (typeof scenarioFiles !== 'undefined') ? scenarioFiles : [];
      const empty = !sf || sf.length === 0;
      editBtn.disabled = empty;
      editBtn.style.opacity = empty ? '0.45' : '';
      editBtn.style.cursor  = empty ? 'not-allowed' : '';
    }
  }
  window.refreshScenStateUI = refreshScenStateUI;

  // ── Modal helpers ─────────────────────────────────────────────────────────
  function openModal(id) {
    const ov = document.getElementById(id);
    if (ov) ov.classList.add('open');
  }
  function closeModal(id) {
    const ov = document.getElementById(id);
    if (ov) ov.classList.remove('open');
  }

  // Universal close handlers (✕, Cancel/Close, click outside)
  document.addEventListener('click', e => {
    const closeId = e.target?.dataset?.close;
    if (closeId) closeModal(closeId);
  });
  document.querySelectorAll('.scen-modal-overlay').forEach(ov => {
    ov.addEventListener('mousedown', e => {
      if (e.target === ov) ov.classList.remove('open');
    });
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.scen-modal-overlay.open').forEach(ov => ov.classList.remove('open'));
    }
  });

  // ── Edit popup: rename + global default fill % ────────────────────────────
  function buildEditPopupBody() {
    const list = document.getElementById('scen-edit-list');
    if (!list) return;
    list.innerHTML = '';
    const files = (typeof scenarioFiles !== 'undefined') ? scenarioFiles : [];
    if (!files.length) {
      list.innerHTML = '<div style="color:#888;font-size:11px;">No scenarios in the list.</div>';
      return;
    }
    files.forEach(f => {
      const row = document.createElement('div');
      row.className = 'scen-edit-row';
      const lbl = document.createElement('label');
      lbl.style.minWidth = '70px';
      lbl.textContent = '#' + (files.indexOf(f) + 1);
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.value = f.name;
      inp.dataset.origFile = f.file;
      inp.dataset.origName = f.name;

      // Two-click delete — first click arms (red), second within 2.5s confirms.
      // Mirrors the same UX as the gallery card delete elsewhere in the app.
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.textContent = '✕';
      delBtn.title = 'Click twice to delete';
      delBtn.style.cssText = 'margin-left:6px;width:24px;height:22px;padding:0;font-size:11px;cursor:pointer;flex-shrink:0;';
      let _armed = false;
      let _resetTimer = null;
      const _resetArm = () => {
        _armed = false;
        delBtn.style.background = '';
        delBtn.style.color = '';
        delBtn.title = 'Click twice to delete';
      };
      delBtn.addEventListener('click', async e => {
        e.stopPropagation();
        if (!_armed) {
          _armed = true;
          delBtn.style.background = '#a33';
          delBtn.style.color = '#fff';
          delBtn.title = 'Click again to confirm';
          clearTimeout(_resetTimer);
          _resetTimer = setTimeout(_resetArm, 2500);
          return;
        }
        clearTimeout(_resetTimer);
        delBtn.disabled = true;
        delBtn.textContent = '⏳';
        try {
          const r = await fetch('/api/scenarios/delete', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: f.file }),
          });
          const d = await r.json();
          if (!d.success) throw new Error(d.error || 'delete failed');
          // Remove the row from the popup, drop checked state, refresh the list.
          row.remove();
          window.checkedScenarios?.delete(f.file);
          await window.loadScenarios?.();
          refreshScenStateUI();
        } catch (err) {
          delBtn.disabled = false;
          delBtn.textContent = '✕';
          _resetArm();
          window.setStatus?.('Delete error: ' + err.message);
        }
      });

      row.appendChild(lbl); row.appendChild(inp); row.appendChild(delBtn);
      list.appendChild(row);
    });
    const pctInp = document.getElementById('scen-edit-fill-pct');
    if (pctInp) pctInp.value = getDefaultFillPct();
  }

  async function saveEditPopup() {
    const pctInp = document.getElementById('scen-edit-fill-pct');
    if (pctInp) setDefaultFillPct(pctInp.value);

    // Rename any scenarios whose input value differs from the original name
    const inputs = document.querySelectorAll('#scen-edit-list input[type="text"]');
    let renamed = 0, errors = 0;
    for (const inp of inputs) {
      const newName = (inp.value || '').trim();
      if (!newName || newName === inp.dataset.origName) continue;
      try {
        const r = await fetch('/api/scenarios/rename', {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: inp.dataset.origFile, newName }),
        });
        const d = await r.json();
        if (!d.success) { errors++; continue; }
        renamed++;
        // Migrate checked-scenarios set from old filename to new
        if (window.checkedScenarios?.has(inp.dataset.origFile)) {
          window.checkedScenarios.delete(inp.dataset.origFile);
          window.checkedScenarios.add(d.filename);
        }
      } catch { errors++; }
    }
    closeModal('scen-edit-modal-overlay');
    if (renamed) await window.loadScenarios?.();
    if (errors) window.setStatus?.(`Edit: ${renamed} renamed, ${errors} failed.`);
    else if (renamed) window.setStatus?.(`Edit: ${renamed} scenario(s) renamed.`);
    else window.setStatus?.('Edit: settings saved.');
    refreshScenStateUI();
  }

  // ── Toolbar wiring ────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', wireOnce);
  if (document.readyState !== 'loading') wireOnce();

  let _wired = false;
  function wireOnce() {
    if (_wired) return; _wired = true;

    const editBtn = document.getElementById('btn-scen-edit-all');
    editBtn?.addEventListener('click', () => {
      if (editBtn.disabled) return;
      buildEditPopupBody();
      openModal('scen-edit-modal-overlay');
    });

    document.getElementById('scen-edit-save')?.addEventListener('click', saveEditPopup);

    document.getElementById('btn-scen-new')?.addEventListener('click', () => {
      openModal('scen-new-modal-overlay');
    });

    document.getElementById('btn-detail-new')?.addEventListener('click', () => {
      openModal('prop-new-modal-overlay');
    });

    // Close the New prop popup automatically once a prop is saved successfully.
    // The legacy upload handler (in scen-list.js) clears `#detail-url-input` after
    // success, so we hook the same DOM event chain non-invasively: watch the
    // disabled state of the Save button, which transitions back to disabled
    // once detailClear() runs.
    const _saveBtn = document.getElementById('btn-detail-upload');
    if (_saveBtn) {
      _saveBtn.addEventListener('click', () => {
        // Poll briefly: handler is async, after it succeeds the button gets disabled
        // again via detailClear(); when that happens we close the modal.
        let tries = 0;
        const iv = setInterval(() => {
          tries++;
          if (_saveBtn.disabled && document.getElementById('detail-url-input')?.value === '') {
            clearInterval(iv);
            closeModal('prop-new-modal-overlay');
          }
          if (tries > 50) clearInterval(iv); // give up after ~10s
        }, 200);
      });
    }

    // Initial UI state
    refreshScenStateUI();
  }

  // ── Reset on Create ──────────────────────────────────────────────────────
  // The Create button has its own click handler in scenarios.js / scen-list.js;
  // we attach ours in capture phase so it runs first and snapshots prior state.
  document.addEventListener('click', e => {
    const t = e.target;
    if (!(t && t.id === 'btn-scen-create')) return;
    if (t.disabled) {
      e.preventDefault(); e.stopImmediatePropagation();
      return;
    }
    // Defer reset to a microtask so the actual create handler can read the
    // pre-reset state (selected образ, checked scenarios) before we wipe it.
    setTimeout(resetScenariosUI, 0);
  }, true);

  function resetScenariosUI() {
    // 1. Deselect all образы
    if (typeof activeObrazIds !== 'undefined') {
      activeObrazIds.clear();
      try { saveEditState?.(); } catch {}
      document.querySelectorAll('.scen-obraz-wrap.obraz-active').forEach(w => w.classList.remove('obraz-active'));
    }
    // 2. Deselect all scenarios in the list (keep the list visible)
    if (window.checkedScenarios) window.checkedScenarios.clear();
    document.querySelectorAll('.scenario-sel-btn').forEach(btn => {
      btn.classList.remove('on');
      btn.textContent = 'Select';
    });
    // 3. Clear props selection (remove .detail-selected on all detail cards)
    document.querySelectorAll('#details-grid .gallery-card.detail-selected')
      .forEach(c => c.classList.remove('detail-selected'));
    // 4. Refresh autofill indicator — panel stays visible so the user can
    //    always SEE whether they're about to create with items or noitems.
    //    (Previously this hid the panel after every Create, making users
    //    blind to the items/noitems state on subsequent runs.)
    if (typeof activeDetailFiles !== 'undefined') activeDetailFiles.clear();
    window.updateAutofillPanel?.();
    refreshScenStateUI();
  }
  window.resetScenariosUI = resetScenariosUI;

  // ── Fill randomly — sequential, N% of (total - 3), skip first 3 fragments ─
  // Replaces the legacy single-scenario autofill. Called by the Fill randomly
  // button, which is rewired below.
  async function fillRandomlyAcrossChecked() {
    const checked = [...(window.checkedScenarios || new Set())];
    if (!checked.length) {
      window.setStatus?.('Fill randomly: no scenarios checked.');
      return;
    }
    // Selected props — read from the .gallery-card.detail-selected nodes inside #details-grid
    const selectedDetails = [...document.querySelectorAll('#details-grid .gallery-card.detail-selected')]
      .map(c => c.dataset.file)
      .filter(Boolean);
    if (selectedDetails.length === 0) {
      window.setStatus?.('Fill randomly: select at least one prop first.');
      return;
    }

    const pct = getDefaultFillPct();
    let totalPlaced = 0;

    const cache = (typeof scenarioLinesCache !== 'undefined') ? scenarioLinesCache : null;
    for (const scenFile of checked) {
      // Resolve the line count for this scenario (use cache if present, else fetch)
      let lines = cache?.[scenFile];
      if (!lines) {
        try {
          const d = await fetch(`/api/scenarios/${encodeURIComponent(scenFile)}`).then(r => r.json());
          lines = d.lines || [];
          if (cache) cache[scenFile] = lines;
        } catch { lines = []; }
      }
      const total = lines.length;
      if (total <= 3) continue; // first 3 are always locked → nothing to fill

      const remaining = total - 3;
      const slotsToFill = Math.round((pct / 100) * remaining);
      if (slotsToFill <= 0) continue;

      // Random subset of indices in [3 .. total-1]
      const pool = [];
      for (let i = 3; i < total; i++) pool.push(i);
      // Shuffle (Fisher-Yates) and take first slotsToFill
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      const targets = pool.slice(0, slotsToFill);

      // Assign random selected detail to each target
      const assignments = (typeof scenarioAssignments !== 'undefined') ? scenarioAssignments : null;
      targets.forEach(idx => {
        const pick = selectedDetails[Math.floor(Math.random() * selectedDetails.length)];
        const key = `${scenFile}__${idx}`;
        if (assignments) assignments[key] = pick;
        // Update DOM dropdown if visible
        const sel = document.querySelector(
          `.scenario-item[data-file="${scenFile}"] .scenario-line[data-idx="${idx}"] .scenario-detail-select`
        );
        if (sel) sel.value = pick;
      });
      totalPlaced += targets.length;
    }

    // Persist
    try { _saveAssignmentsToLS?.(); } catch {}
    try { await saveScenarioAssignments?.(); } catch {}
    updateActiveScenariosList?.();
    setStatus?.(`Fill randomly: placed ${totalPlaced} prop(s) across ${checked.length} scenario(s) at ${pct}%.`);
  }
  window.fillRandomlyAcrossChecked = fillRandomlyAcrossChecked;

  // Wire the button (replace any legacy listener with our new one)
  document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('btn-detail-autofill');
    if (!btn) return;
    btn.addEventListener('click', e => {
      e.stopImmediatePropagation();
      fillRandomlyAcrossChecked();
    }, true);
  });
})();
