/* scen-list.js — updateActiveScenariosList, buildScenarioItem, loadScenarios, loadDetails, loadScenarioObrazы, assignments, autofill */


function updateActiveScenariosList() {
  const panel = document.getElementById('active-scenarios-panel');
  if (!panel) return;

  // Find scenario filenames that have at least one non-empty assignment
  const activeFiles = scenarioFiles.filter(f =>
    Object.entries(scenarioAssignments).some(
      ([key, val]) => key.startsWith(f.file + '__') && val
    )
  );

  panel.innerHTML = '';
  if (!activeFiles.length) {
    panel.style.display = 'none';
    return;
  }

  panel.style.display = 'block';
  const headerRow = document.createElement('div');
  headerRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:2px;';
  const header = document.createElement('div');
  header.className = 'active-scen-header';
  header.style.cssText = 'margin-bottom:0;border-bottom:none;';
  header.textContent = 'Active scenarios';
  const resetAllBtn = document.createElement('button');
  resetAllBtn.textContent = '✕ Reset';
  resetAllBtn.title = 'Reset all item assignments in all scenarios';
  resetAllBtn.style.cssText = 'font-size:9px;padding:1px 6px;cursor:pointer;background:#f4e8e8;border:1px solid #c05050;color:#7a1a1a;';
  resetAllBtn.addEventListener('click', async () => {
    Object.keys(scenarioAssignments).forEach(k => delete scenarioAssignments[k]);
    _saveAssignmentsToLS();
    await saveScenarioAssignments();
    document.querySelectorAll('.scenario-detail-select').forEach(s => { s.value = ''; });
    updateActiveScenariosList();
    setStatus('All item assignments have been reset.');
  });
  headerRow.appendChild(header);
  headerRow.appendChild(resetAllBtn);
  panel.appendChild(headerRow);

  activeFiles.forEach(f => {
    const row = document.createElement('div');
    row.className = 'active-scen-item';

    const name = document.createElement('span');
    name.className = 'active-scen-name';
    name.textContent = f.name;

    // Count assigned lines
    const count = Object.entries(scenarioAssignments).filter(
      ([key, val]) => key.startsWith(f.file + '__') && val
    ).length;
    const badge = document.createElement('span');
    badge.className = 'active-scen-badge';
    badge.textContent = count;

    row.appendChild(name);
    row.appendChild(badge);
    panel.appendChild(row);
  });

  renderEditPanel();
}

async function loadScenarioAssignments() {
  try {
    const d = await fetch('/api/scenarios/assignments').then(r => r.json());
    if (d.success && d.assignments) {
      // Merge: localStorage (auto-saved on every change) wins over server.
      // This prevents a slow/stale server response from wiping locally-set assignments.
      const ls = (() => {
        try { return JSON.parse(localStorage.getItem(LS_SCENARIO_ASSIGNMENTS) || '{}'); } catch { return {}; }
      })();
      scenarioAssignments = Object.keys(ls).length > 0 ? ls : d.assignments;
      _saveAssignmentsToLS();
    }
  } catch {}
}

async function saveScenarioAssignments() {
  await fetch('/api/scenarios/assignments', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assignments: scenarioAssignments }),
  });
}

// ── Per-scenario modified lines storage (localStorage) ───────────────────────
function getModifiedLines(filename) {
  try {
    const raw = localStorage.getItem('scen_lines_v1__' + filename);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function saveModifiedLines(filename, lines) {
  localStorage.setItem('scen_lines_v1__' + filename, JSON.stringify(lines));
}
function clearModifiedLines(filename) {
  localStorage.removeItem('scen_lines_v1__' + filename);
}

// Re-index assignments after a line deletion so keys stay correct
function reindexAssignments(filename, deletedIdx, totalBefore) {
  delete scenarioAssignments[`${filename}__${deletedIdx}`];
  for (let j = deletedIdx + 1; j < totalBefore; j++) {
    const oldKey = `${filename}__${j}`;
    const newKey = `${filename}__${j - 1}`;
    if (scenarioAssignments[oldKey] != null) {
      scenarioAssignments[newKey] = scenarioAssignments[oldKey];
    } else {
      delete scenarioAssignments[newKey];
    }
    delete scenarioAssignments[oldKey];
  }
  _saveAssignmentsToLS();
}

// ── Build scenario item ───────────────────────────────────────────────────────
function buildScenarioItem(file, detailFiles) {
  const item = document.createElement('div');
  item.className = 'scenario-item';

  const header = document.createElement('div');
  header.className = 'scenario-item-header';

  // ── Settings popup ──────────────────────────────────────────────────────────
  function openScenarioSettings() {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center;';

    const box = document.createElement('div');
    box.style.cssText = 'background:#c0c0c0;border:2px solid;border-color:#fff #808080 #808080 #fff;min-width:280px;max-width:360px;display:flex;flex-direction:column;box-shadow:4px 4px 0 #808080;';

    // Title bar
    const titleBar = document.createElement('div');
    titleBar.style.cssText = 'background:#000080;color:#fff;font-size:11px;font-weight:bold;padding:3px 8px;display:flex;align-items:center;justify-content:space-between;';
    titleBar.textContent = 'Scenario settings';
    const closeX = document.createElement('button');
    closeX.textContent = '✕';
    closeX.style.cssText = 'background:none;border:none;color:#fff;cursor:pointer;font-size:12px;padding:0 2px;line-height:1;';
    closeX.addEventListener('click', () => overlay.remove());
    titleBar.appendChild(closeX);
    box.appendChild(titleBar);

    const inner = document.createElement('div');
    inner.style.cssText = 'padding:12px 14px;display:flex;flex-direction:column;gap:10px;';

    // ── Rename section ──────────────────────────────────────────────────────
    const renameLabel = document.createElement('div');
    renameLabel.style.cssText = 'font-size:10px;color:#555;margin-bottom:3px;';
    renameLabel.textContent = 'Rename:';

    const nameInp = document.createElement('input');
    nameInp.type = 'text';
    nameInp.value = file.name;
    nameInp.style.cssText = 'width:100%;box-sizing:border-box;font-size:11px;padding:3px 5px;border:1px solid #808080;background:#fff;margin-bottom:5px;';

    const renameRow = document.createElement('div');
    renameRow.style.cssText = 'display:flex;gap:5px;';

    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save';
    saveBtn.style.cssText = 'flex:1;font-size:11px;padding:3px 8px;cursor:pointer;background:#e8f0e8;border:1px solid #4a8a4a;color:#1a5a1a;font-weight:bold;';
    saveBtn.addEventListener('click', async () => {
      const newName = nameInp.value.trim();
      if (!newName || newName === file.name) { overlay.remove(); return; }
      saveBtn.disabled = true;
      try {
        const r = await fetch('/api/scenarios/rename', {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: file.file, newName }),
        });
        const d = await r.json();
        if (!d.success) throw new Error(d.error);
        // Update local state: rekey assignments
        const oldFile = file.file;
        Object.keys(scenarioAssignments).forEach(k => {
          if (k.startsWith(oldFile + '__')) {
            scenarioAssignments[d.filename + '__' + k.slice(oldFile.length + 2)] = scenarioAssignments[k];
            delete scenarioAssignments[k];
          }
        });
        _saveAssignmentsToLS();
        // Update file object and DOM
        file.file = d.filename;
        file.name = d.name;
        title.textContent = d.name;
        const fi = scenarioFiles.findIndex(f => f.file === oldFile);
        if (fi !== -1) { scenarioFiles[fi].file = d.filename; scenarioFiles[fi].name = d.name; }
        updateActiveScenariosList();
        setStatus(`Scenario renamed: ${d.name}`);
        overlay.remove();
      } catch (err) {
        setStatus('Error: ' + err.message);
        saveBtn.disabled = false;
      }
    });

    const cancelRenameBtn = document.createElement('button');
    cancelRenameBtn.textContent = 'Cancel';
    cancelRenameBtn.style.cssText = 'font-size:11px;padding:3px 8px;cursor:pointer;';
    cancelRenameBtn.addEventListener('click', () => overlay.remove());

    renameRow.appendChild(saveBtn);
    renameRow.appendChild(cancelRenameBtn);

    const renameBlock = document.createElement('div');
    renameBlock.appendChild(renameLabel);
    renameBlock.appendChild(nameInp);
    renameBlock.appendChild(renameRow);
    inner.appendChild(renameBlock);

    // ── Divider ─────────────────────────────────────────────────────────────
    const hr = document.createElement('div');
    hr.style.cssText = 'border-top:1px solid #a0a0a0;';
    inner.appendChild(hr);

    // ── Delete section ───────────────────────────────────────────────────────
    const delBtn = document.createElement('button');
    delBtn.textContent = '🗑 Delete scenario';
    delBtn.style.cssText = 'width:100%;font-size:11px;padding:4px 8px;cursor:pointer;background:#f4e8e8;border:1px solid #c05050;color:#7a1a1a;';
    let delTimer = null;
    delBtn.addEventListener('click', async () => {
      if (!delBtn.dataset.armed) {
        delBtn.dataset.armed = '1';
        delBtn.textContent = '? Click again to delete';
        delBtn.style.background = '#ffcccc';
        delBtn.style.color = '#cc0000';
        delTimer = setTimeout(() => {
          delBtn.dataset.armed = '';
          delBtn.textContent = '🗑 Delete scenario';
          delBtn.style.background = '#f4e8e8';
          delBtn.style.color = '#7a1a1a';
        }, 3000);
        return;
      }
      clearTimeout(delTimer);
      delBtn.disabled = true;
      try {
        const r = await fetch('/api/scenarios/delete', {
          method: 'DELETE', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: file.file }),
        });
        const d = await r.json();
        if (!d.success) throw new Error(d.error);
        clearModifiedLines(file.file);
        scenarioFiles = scenarioFiles.filter(f => f.file !== file.file);
        Object.keys(scenarioAssignments).forEach(k => {
          if (k.startsWith(file.file + '__')) delete scenarioAssignments[k];
        });
        _saveAssignmentsToLS();
        updateActiveScenariosList();
        item.remove();
        overlay.remove();
        setStatus(`Scenario moved to archive: ${file.name}`);
      } catch (err) {
        delBtn.disabled = false;
        setStatus('Error: ' + err.message);
      }
    });
    inner.appendChild(delBtn);

    box.appendChild(inner);
    overlay.appendChild(box);
    overlay.addEventListener('mousedown', e => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
    nameInp.focus();
    nameInp.select();
  }

  // Settings button (replaces delete button)
  const settingsBtn = document.createElement('button');
  settingsBtn.className = 'scenario-del-btn';
  settingsBtn.textContent = '⚙';
  settingsBtn.title = 'Scenario settings';
  settingsBtn.addEventListener('click', e => { e.stopPropagation(); openScenarioSettings(); });

  // Restore default lines button
  const restoreBtn = document.createElement('button');
  restoreBtn.className = 'scenario-del-btn';
  restoreBtn.textContent = '↺'; restoreBtn.title = 'Restore default lines';
  restoreBtn.style.color = '#006600';
  restoreBtn.addEventListener('click', async e => {
    e.stopPropagation();
    clearModifiedLines(file.file);
    // Clear all assignments for this scenario
    Object.keys(scenarioAssignments).forEach(key => {
      if (key.startsWith(file.file + '__')) delete scenarioAssignments[key];
    });
    // Immediately reset any currently visible dropdowns in DOM
    body.querySelectorAll('.scenario-detail-select').forEach(s => { s.value = ''; });
    _saveAssignmentsToLS();
    await saveScenarioAssignments();
    updateActiveScenariosList();
    await renderBody();
    setStatus('Lines and assignments restored.');
  });

  const toggle = document.createElement('span');
  toggle.className = 'scenario-toggle'; toggle.textContent = '▶';

  const title = document.createElement('span');
  title.className = 'scenario-title'; title.textContent = file.name;

  header.appendChild(settingsBtn); header.appendChild(restoreBtn);
  header.appendChild(toggle); header.appendChild(title);

  const body = document.createElement('div');
  body.className = 'scenario-body';

  // ── Render body from a lines array ──────────────────────────────────────────
  async function renderBody() {
    body.innerHTML = '<span style="font-size:11px;color:#888;">Loading…</span>';
    try {
      // Use modified lines from localStorage if available, else fetch from API
      let lines = getModifiedLines(file.file);
      if (!lines) {
        const d = await fetch(`/api/scenarios/${encodeURIComponent(file.file)}`).then(r => r.json());
        lines = d.lines;
      }
      scenarioLinesCache[file.file] = lines; // keep cache fresh
      body.innerHTML = '';

      // Save assignments button
      const saveRow = document.createElement('div');
      saveRow.style.cssText = 'margin-bottom:6px;display:flex;gap:6px;';
      const saveBtn = document.createElement('button');
      saveBtn.textContent = '💾 Save assignments'; saveBtn.style.fontSize = '11px';
      saveBtn.addEventListener('click', async () => {
        saveBtn.disabled = true;
        await saveScenarioAssignments();
        setStatus('Assignments saved.');
        saveBtn.disabled = false;
      });
      saveRow.appendChild(saveBtn);
      body.appendChild(saveRow);

      // Render each line
      lines.forEach((line, i) => {
        const row = document.createElement('div');
        row.className = 'scenario-line';

        const num = document.createElement('span');
        num.className = 'scenario-line-num'; num.textContent = i + 1;

        const text = document.createElement('input');
        text.type = 'text';
        text.className = 'scenario-line-text';
        text.value = line;
        text.title = 'Click to edit';
        text.addEventListener('change', () => {
          lines[i] = text.value;
          saveModifiedLines(file.file, lines);
          scenarioLinesCache[file.file] = [...lines];
        });

        const sel = document.createElement('select');
        sel.className = 'scenario-detail-select';
        const blank = document.createElement('option');
        blank.value = ''; blank.textContent = '— item —';
        sel.appendChild(blank);
        detailFiles.forEach(df => {
          const opt = document.createElement('option');
          opt.value = df.file; opt.textContent = df.name;
          sel.appendChild(opt);
        });
        const key = `${file.file}__${i}`;
        if (scenarioAssignments[key]) sel.value = scenarioAssignments[key];
        sel.addEventListener('change', () => {
          scenarioAssignments[key] = sel.value;
          _saveAssignmentsToLS();     // immediate localStorage — survives tab switch
          saveScenarioAssignments();  // async server backup
          // Push change into every pending session for this scenFile so pairs
          // are stored in the session body and survive all re-renders/reloads
          Object.values(editFrozenSessions).forEach(sess => {
            if (sess.scenFile === file.file) {
              if (!sess.assignments) sess.assignments = {};
              if (sel.value) sess.assignments[key] = sel.value;
              else delete sess.assignments[key];
            }
          });
          saveEditState();
          updateActiveScenariosList();
        });

        // Delete line button
        const lineDelBtn = document.createElement('button');
        lineDelBtn.className = 'scenario-line-del';
        lineDelBtn.textContent = '✕'; lineDelBtn.title = 'Delete line';
        lineDelBtn.addEventListener('click', () => {
          reindexAssignments(file.file, i, lines.length);
          lines.splice(i, 1);
          saveModifiedLines(file.file, lines);
          renderBody();
        });

        row.appendChild(num); row.appendChild(text); row.appendChild(sel); row.appendChild(lineDelBtn);
        body.appendChild(row);
      });
    } catch { body.textContent = 'Load error'; }
  }

  header.addEventListener('click', async e => {
    const open = body.classList.toggle('open');
    toggle.textContent = open ? '▼' : '▶';
    if (open) await renderBody();
  });

  item.appendChild(header); item.appendChild(body);
  return item;
}

// ── Archive (База данных) ─────────────────────────────────────────────────────
async function loadArchivedScenarios() {
  const list = document.getElementById('scenario-archive-list');
  if (!list) return;
  list.innerHTML = '<span style="color:#888;font-size:11px;">Loading…</span>';
  try {
    const d = await fetch('/api/scenarios/archive').then(r => r.json());
    list.innerHTML = '';
    if (!d.files.length) {
      list.innerHTML = '<div style="color:#888;font-size:11px;padding:8px 0;">Archive is empty</div>';
      return;
    }
    d.files.forEach(f => {
      const row = document.createElement('div');
      row.className = 'scen-archive-item';

      const name = document.createElement('span');
      name.className = 'scen-archive-name';
      name.textContent = f.name;

      const date = document.createElement('span');
      date.className = 'scen-archive-date';
      date.textContent = new Date(f.mtime).toLocaleDateString('en-GB');

      const restoreBtn = document.createElement('button');
      restoreBtn.className = 'scen-archive-btn restore';
      restoreBtn.textContent = '↩ Restore';
      restoreBtn.addEventListener('click', async () => {
        restoreBtn.disabled = true;
        try {
          const r = await fetch('/api/scenarios/restore', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: f.file }),
          });
          const res = await r.json();
          if (!res.success) throw new Error(res.error);
          row.remove();
          setStatus(`Scenario restored: ${f.name}`);
          loadScenarios(); // refresh active list
        } catch (err) {
          setStatus('Error: ' + err.message);
          restoreBtn.disabled = false;
        }
      });

      const purgeBtn = document.createElement('button');
      purgeBtn.className = 'scen-archive-btn purge';
      purgeBtn.textContent = '🗑';
      let purgeTimer = null;
      purgeBtn.addEventListener('click', async () => {
        if (!purgeBtn.dataset.armed) {
          purgeBtn.dataset.armed = '1';
          purgeBtn.textContent = '✓?';
          purgeBtn.style.background = '#ffcccc';
          purgeTimer = setTimeout(() => {
            purgeBtn.dataset.armed = '';
            purgeBtn.textContent = '🗑';
            purgeBtn.style.background = '';
          }, 3000);
          return;
        }
        clearTimeout(purgeTimer);
        purgeBtn.dataset.armed = '';
        purgeBtn.textContent = '🗑';
        purgeBtn.style.background = '';
        purgeBtn.disabled = true;
        try {
          const r = await fetch('/api/scenarios/archive/purge', {
            method: 'DELETE', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: f.file }),
          });
          const res = await r.json();
          if (!res.success) throw new Error(res.error);
          row.remove();
          if (!list.querySelector('.scen-archive-item')) {
            list.innerHTML = '<div style="color:#888;font-size:11px;padding:8px 0;">Archive is empty</div>';
          }
          setStatus(`Permanently deleted: ${f.name}`);
        } catch (err) {
          setStatus('Error: ' + err.message);
          purgeBtn.disabled = false;
        }
      });

      row.appendChild(name);
      row.appendChild(date);
      row.appendChild(restoreBtn);
      row.appendChild(purgeBtn);
      list.appendChild(row);
    });
  } catch {
    list.innerHTML = '<div style="color:#888;font-size:11px;">Load error</div>';
  }
}

// ── Load scenarios ────────────────────────────────────────────────────────────
const scenarioList = document.getElementById('scenario-list');

async function loadScenarios() {
  if (!scenarioList) return;
  try {
    const [sd, dd] = await Promise.all([
      fetch('/api/scenarios').then(r => r.json()),
      fetch('/api/details').then(r => r.json()),
    ]);
    await loadScenarioAssignments();
    scenarioFiles     = sd.files || [];
    cachedDetailFiles = dd.success ? dd.files : [];
    scenarioList.innerHTML = '';
    if (!sd.files.length) {
      scenarioList.innerHTML = '<div style="color:#888;font-size:11px;">No scenarios</div>';
      updateActiveScenariosList();
      return;
    }
    sd.files.forEach(f => scenarioList.appendChild(buildScenarioItem(f, cachedDetailFiles)));
    updateActiveScenariosList();
    updateAutofillPanel();
  } catch { scenarioList.innerHTML = '<div style="color:#888;font-size:11px;">Load error</div>'; }
  // Also refresh the образы panel whenever scenarios reload
  loadScenarioObrazы();
}

// ── Образы catalog in Сценарии right column ───────────────────────────────────
// Hidden set: образы the user removed from this view (persisted in localStorage)
const SCEN_HIDDEN_KEY = 'scen_hidden_obrazy_v1';

function getHiddenObrazы() {
  try { return new Set(JSON.parse(localStorage.getItem(SCEN_HIDDEN_KEY) || '[]')); } catch { return new Set(); }
}
function hideObraz(id) {
  const s = getHiddenObrazы(); s.add(String(id));
  localStorage.setItem(SCEN_HIDDEN_KEY, JSON.stringify([...s]));
}

function loadScenarioObrazы() {
  const row = document.getElementById('scenarii-obrazy-row');
  if (!row) return;

  const hidden     = getHiddenObrazы();
  const allObrazы  = getObrazы?.() || [];
  const curProjId  = getCurrentProjectId?.() || null;

  // Filter out hidden; sort: current-project ones first, then rest by date desc
  const visible = allObrazы.filter(o => !hidden.has(String(o.id)));
  if (!visible.length) {
    row.innerHTML = '<span style="color:#888;font-size:11px;">No outfits</span>';
    return;
  }

  const projOnes  = visible.filter(o => o.projectId === curProjId && curProjId);
  const otherOnes = visible.filter(o => o.projectId !== curProjId || !curProjId);
  const sorted    = [...projOnes, ...otherOnes];

  row.innerHTML = '';
  sorted.forEach(obraz => {
    if (!obraz.char) return; // skip obrazы without a character image

    // Pending if variations array has nulls (generation still in progress)
    const hasPending = Array.isArray(obraz.variations) && obraz.variations.length > 0
      && obraz.variations.some(v => v === null);

    const wrap = document.createElement('div');
    wrap.className = 'scen-obraz-wrap';
    if (hasPending) wrap.style.opacity = '0.5';

    const img = document.createElement('img');
    img.src = obraz.char + '?t=' + Date.now();
    img.className = 'scen-obraz-thumb' + (obraz.projectId === curProjId && curProjId ? ' proj-obraz' : '');

    if (hasPending) {
      img.style.cursor = 'not-allowed';
      img.title = obraz.name + ' · generating variations…';
    } else {
      img.title = obraz.name + ' · click — select / deselect';
      img.addEventListener('click', () => setActiveObraz(obraz.id, wrap));
    }

    // Restore active state if this образ was previously selected
    if (activeObrazIds.has(obraz.id)) wrap.classList.add('obraz-active');

    const name = document.createElement('div');
    name.className = 'scen-obraz-name';
    name.textContent = hasPending ? '⏳ ' + obraz.name : obraz.name;

    const delBtn = document.createElement('button');
    delBtn.className = 'scen-obraz-del';
    delBtn.textContent = '✕';
    delBtn.title = 'Remove from project';
    delBtn.addEventListener('click', e => {
      e.stopPropagation();
      hideObraz(obraz.id);
      wrap.remove();
      if (!row.querySelector('.scen-obraz-wrap')) {
        row.innerHTML = '<span style="color:#888;font-size:11px;">No outfits</span>';
      }
    });

    wrap.appendChild(img);
    wrap.appendChild(name);
    wrap.appendChild(delBtn);
    row.appendChild(wrap);
  });

  // Auto-select a random образ if none is currently selected
  if (activeObrazIds.size === 0) {
    const selectable = sorted.filter(o => o.char && !(Array.isArray(o.variations) && o.variations.some(v => v === null)));
    if (selectable.length) {
      const picked = selectable[Math.floor(Math.random() * selectable.length)];
      activeObrazIds.add(picked.id);
      row.querySelectorAll('.scen-obraz-wrap').forEach((w, wi) => {
        if (sorted[wi] && activeObrazIds.has(sorted[wi].id)) w.classList.add('obraz-active');
      });
      saveEditState();
    }
  }
}

// ── Upload scenario file ──────────────────────────────────────────────────────
const scenarioDropzone  = document.getElementById('scenario-dropzone');
const scenarioInput     = document.getElementById('scenario-input');
const scenarioFileLabel = document.getElementById('scenario-file-label');
const scenarioNameInput = document.getElementById('scenario-name');
const btnScenarioUpload = document.getElementById('btn-scenario-upload');
let scenarioBlob = null;

scenarioDropzone?.addEventListener('click', () => scenarioInput?.click());
scenarioDropzone?.addEventListener('dragover', e => { e.preventDefault(); scenarioDropzone.classList.add('drag-over'); });
scenarioDropzone?.addEventListener('dragleave', () => scenarioDropzone.classList.remove('drag-over'));
scenarioDropzone?.addEventListener('drop', e => {
  e.preventDefault(); scenarioDropzone.classList.remove('drag-over');
  const f = e.dataTransfer.files[0];
  if (!f || !f.name.endsWith('.txt')) { setStatus('Only .txt files.'); return; }
  scenarioBlob = f; scenarioFileLabel.textContent = f.name;
  scenarioDropzone.classList.add('has-file'); btnScenarioUpload.disabled = false;
});
scenarioInput?.addEventListener('change', () => {
  const f = scenarioInput.files[0]; if (!f) return;
  scenarioBlob = f; scenarioFileLabel.textContent = f.name;
  scenarioDropzone.classList.add('has-file'); btnScenarioUpload.disabled = false;
});

btnScenarioUpload?.addEventListener('click', async () => {
  if (!scenarioBlob) return;
  btnScenarioUpload.disabled = true; setStatus('Uploading scenario…');
  try {
    const base64 = await blobToBase64(scenarioBlob);
    const r = await fetch('/api/scenarios/upload', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ textBase64: base64, name: scenarioNameInput.value.trim() }),
    });
    const d = await r.json();
    if (!d.success) throw new Error(d.error);
    setStatus(`Scenario saved: ${d.name}`);
    scenarioBlob = null;
    scenarioFileLabel.textContent = 'Click or drag a .txt file';
    scenarioDropzone.classList.remove('has-file');
    scenarioNameInput.value = ''; scenarioInput.value = '';
    loadScenarios();
  } catch (e) { setStatus('Error: ' + e.message); }
  finally { btnScenarioUpload.disabled = false; }
});

// ── Manual text input ─────────────────────────────────────────────────────────
document.getElementById('btn-scenario-manual-upload')?.addEventListener('click', async () => {
  const text = document.getElementById('scenario-manual-text')?.value.trim();
  if (!text) { setStatus('Enter scenario text.'); return; }
  const btn = document.getElementById('btn-scenario-manual-upload');
  btn.disabled = true; setStatus('Saving scenario…');
  try {
    const base64 = btoa(unescape(encodeURIComponent(text)));
    const r = await fetch('/api/scenarios/upload', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ textBase64: base64, name: document.getElementById('scenario-manual-name')?.value.trim() }),
    });
    const d = await r.json();
    if (!d.success) throw new Error(d.error);
    setStatus(`Scenario saved: ${d.name}`);
    document.getElementById('scenario-manual-text').value = '';
    document.getElementById('scenario-manual-name').value = '';
    loadScenarios();
  } catch (e) { setStatus('Error: ' + e.message); }
  finally { btn.disabled = false; }
});

// ── Active detail selection ───────────────────────────────────────────────────
const activeDetailFiles = new Set(); // file names of selected details

function toggleDetailActive(file, cardEl) {
  if (activeDetailFiles.has(file)) {
    activeDetailFiles.delete(file);
    cardEl.classList.remove('detail-selected');
  } else {
    activeDetailFiles.add(file);
    cardEl.classList.add('detail-selected');
  }
  updateAutofillPanel();
}

function updateAutofillPanel() {
  const panel = document.getElementById('detail-autofill-panel');
  if (!panel) return;
  if (activeDetailFiles.size < 1) { panel.style.display = 'none'; return; }
  panel.style.display = 'block';
  // Populate scenario dropdown with current scenarioFiles list
  const sel = document.getElementById('detail-autofill-scenario');
  if (sel) {
    const prev = sel.value;
    sel.innerHTML = '';
    if (!scenarioFiles.length) {
      const opt = document.createElement('option'); opt.value = ''; opt.textContent = 'No scenarios'; sel.appendChild(opt);
    } else {
      scenarioFiles.forEach(f => {
        const opt = document.createElement('option'); opt.value = f.file; opt.textContent = f.name; sel.appendChild(opt);
      });
      if (prev && [...sel.options].some(o => o.value === prev)) sel.value = prev;
    }
  }
}

document.getElementById('btn-detail-autofill')?.addEventListener('click', async () => {
  const scenFile = document.getElementById('detail-autofill-scenario')?.value;
  const pct      = Math.max(1, Math.min(100, Number(document.getElementById('detail-autofill-pct')?.value) || 60));
  if (!scenFile) { setStatus('Select a scenario.'); return; }
  if (!activeDetailFiles.size) { setStatus('No active items.'); return; }

  // Get lines for the scenario (use cache or fetch)
  const lines = await getLinesForScenario(scenFile);
  if (!lines.length) { setStatus('Scenario is empty.'); return; }

  const detailArr = [...activeDetailFiles];
  const count     = Math.max(1, Math.round(lines.length * pct / 100));

  // Pick `count` random line indices (without repetition if count ≤ lines.length)
  const indices = [];
  const pool    = lines.map((_, i) => i);
  while (indices.length < count && pool.length) {
    const r = Math.floor(Math.random() * pool.length);
    indices.push(pool.splice(r, 1)[0]);
  }

  // Assign a random detail from the active set to each picked line
  indices.forEach(i => {
    const det = detailArr[Math.floor(Math.random() * detailArr.length)];
    scenarioAssignments[`${scenFile}__${i}`] = det;
  });

  await saveScenarioAssignments();
  updateActiveScenariosList();

  // Re-render the open scenario body if it's currently visible
  const allBodies = document.querySelectorAll('.scenario-item');
  allBodies.forEach(item => {
    const titleEl = item.querySelector('.scenario-title');
    const scenObj = scenarioFiles.find(f => f.name === titleEl?.textContent && f.file === scenFile);
    if (scenObj) {
      const body = item.querySelector('.scenario-body');
      if (body?.classList.contains('open')) body.dispatchEvent(new Event('rerender'));
    }
  });

  setStatus(`Filled: ${count} of ${lines.length} lines (${pct}%)`);

  // Collapse the Предметы dropdown after autofill
  const _dcBody  = document.getElementById('details-collapse-body');
  const _dcArrow = document.getElementById('details-collapse-arrow');
  if (_dcBody && _dcBody.style.display !== 'none') {
    _dcBody.style.display = 'none';
    if (_dcArrow) _dcArrow.textContent = '▶';
  }
});

// ── Details ───────────────────────────────────────────────────────────────────
const detailInput     = document.getElementById('detail-input');
const detailUrlInput  = document.getElementById('detail-url-input');
const btnDetailPick   = document.getElementById('btn-detail-file-pick');
const btnDetailUpload = document.getElementById('btn-detail-upload');
const detailNameInput = document.getElementById('detail-name');
const detailsGrid     = document.getElementById('details-grid');
let detailBlob = null;

function detailMarkReady(label) {
  if (detailUrlInput) detailUrlInput.value = label;
  if (btnDetailUpload) btnDetailUpload.disabled = false;
}
function detailClear() {
  if (detailUrlInput) detailUrlInput.value = '';
  if (detailInput)    detailInput.value = '';
  if (btnDetailUpload) btnDetailUpload.disabled = true;
  detailBlob = null;
}

// File picker button
btnDetailPick?.addEventListener('click', () => detailInput?.click());
detailInput?.addEventListener('change', () => {
  const f = detailInput.files[0]; if (!f) return;
  detailBlob = f;
  detailMarkReady(`📁 ${f.name}`);
});

// URL typed into the text field
detailUrlInput?.addEventListener('input', () => {
  const v = detailUrlInput.value.trim();
  if (v.startsWith('http')) {
    detailBlob = null;
    if (btnDetailUpload) btnDetailUpload.disabled = false;
  } else if (!detailBlob) {
    if (btnDetailUpload) btnDetailUpload.disabled = true;
  }
});

// Paste image from clipboard (Ctrl+V)
detailUrlInput?.addEventListener('paste', e => {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault();
      detailBlob = item.getAsFile();
      detailMarkReady('📋 Image pasted');
      return;
    }
  }
  // Plain text paste (URL) — handled by 'input' event
});

btnDetailUpload?.addEventListener('click', async () => {
  const urlVal  = detailUrlInput?.value.trim() || '';
  if (!detailBlob && !urlVal.startsWith('http')) {
    setStatus('Upload a file or enter an image URL.'); return;
  }
  btnDetailUpload.disabled = true; setStatus('Saving item…');
  try {
    const body = { name: detailNameInput?.value.trim() };
    let base64 = null;
    if (detailBlob) {
      base64 = await blobToBase64(detailBlob);
      body.imageBase64 = base64;
    } else {
      body.imageUrl = urlVal;
    }
    const r = await fetch('/api/details/upload', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (!d.success) throw new Error(d.error);
    setStatus('Analyzing item (AI)…');

    // ── Always save to Рефы и сохры (checkbox controls AI analysis) ──────────
    try {
      let refBase64 = base64;
      if (!refBase64 && urlVal.startsWith('http')) {
        const imgResp = await fetch(urlVal);
        const buf = await imgResp.arrayBuffer();
        refBase64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
      }
      if (refBase64) {
        const refRes = await fetch('/api/refs/save-detail', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageBase64: refBase64,
            name: detailNameInput?.value.trim() || d.name,
            analyze: true,
            detailFile: d.filename || '',
          }),
        });
        const refData = await refRes.json();
        if (refData.success) {
          setStatus(`Item analyzed and saved: ${refData.entry?.title || d.name}`);
          // Save AI analysis to details-meta.json so it's available during generation
          if (refData.entry && d.filename) {
            fetch(`/api/details/meta/${encodeURIComponent(d.filename)}`, {
              method: 'PATCH', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                displayName: refData.entry.title  || '',
                description: refData.entry.description || '',
                size:        refData.entry.size   || '',
              }),
            }).catch(() => {});
          }
        } else {
          setStatus(`Item saved. Refs error: ${refData.error}`);
        }
      }
    } catch (ae) {
      setStatus(`Item saved. Refs error: ${ae.message}`);
    }

    detailClear();
    if (detailNameInput) detailNameInput.value = '';
    loadDetails();
  } catch (e) { setStatus('Error: ' + e.message); }
  finally { btnDetailUpload.disabled = false; }
});

function openDetailEditModal(item) {
  const filename = item.file;
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.75);z-index:9999;display:flex;align-items:center;justify-content:center;';

  const box = document.createElement('div');
  box.style.cssText = 'background:#2a2a2a;border:1px solid #555;border-radius:4px;padding:14px;width:340px;max-height:90vh;overflow-y:auto;color:#ddd;font-size:12px;display:flex;flex-direction:column;gap:8px;';

  function makeField(labelText, value, multiline) {
    const wrap = document.createElement('div');
    const lbl = document.createElement('div');
    lbl.textContent = labelText;
    lbl.style.cssText = 'font-size:10px;color:#aaa;margin-bottom:2px;';
    let inp;
    if (multiline) {
      inp = document.createElement('textarea');
      inp.rows = 5;
      inp.style.cssText = 'width:100%;box-sizing:border-box;padding:4px 6px;background:#1a1a1a;color:#ddd;border:1px solid #555;border-radius:2px;font-size:11px;resize:vertical;';
    } else {
      inp = document.createElement('input');
      inp.type = 'text';
      inp.style.cssText = 'width:100%;box-sizing:border-box;padding:4px 6px;background:#1a1a1a;color:#ddd;border:1px solid #555;border-radius:2px;font-size:11px;';
    }
    inp.value = value || '';
    wrap.appendChild(lbl); wrap.appendChild(inp);
    return { wrap, inp };
  }

  function makeSaveBtn() {
    const btn = document.createElement('button');
    btn.textContent = '💾 Save';
    btn.style.cssText = 'width:100%;padding:5px;background:#1155cc;color:#fff;border:none;border-radius:3px;cursor:pointer;font-size:11px;';
    btn.addEventListener('click', doSave);
    return btn;
  }

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕ Close';
  closeBtn.style.cssText = 'align-self:flex-end;background:none;border:none;color:#aaa;cursor:pointer;font-size:11px;padding:0;';
  closeBtn.addEventListener('click', () => overlay.remove());

  const img = document.createElement('img');
  img.src = item.thumbPath || item.path;
  img.style.cssText = 'width:100%;max-height:180px;object-fit:contain;border:1px solid #555;border-radius:2px;';

  const { wrap: nameWrap, inp: nameInp } = makeField('Name', item.name);
  const { wrap: sizeWrap, inp: sizeInp } = makeField('Size (e.g. 250ml, 15×8cm)', item.size);
  const { wrap: descWrap, inp: descInp } = makeField('Description', item.description, true);

  async function doSave() {
    const newName = nameInp.value.trim();
    const newSize = sizeInp.value.trim();
    const newDesc = descInp.value.trim();
    try {
      const r = await fetch(`/api/details/meta/${encodeURIComponent(filename)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: newName, size: newSize, description: newDesc }),
      });
      const rd = await r.json();
      if (!rd.success) throw new Error(rd.error || 'Save error');
      item.name = newName; item.size = newSize; item.description = newDesc;
      const idx = cachedDetailFiles.findIndex(f => f.file === filename);
      if (idx !== -1) { cachedDetailFiles[idx].name = newName; cachedDetailFiles[idx].size = newSize; cachedDetailFiles[idx].description = newDesc; }
      setStatus('Item data saved.');
      overlay.remove();
      loadDetails();
    } catch (e) { setStatus('Error: ' + e.message); }
  }

  box.appendChild(closeBtn);
  box.appendChild(img);
  box.appendChild(makeSaveBtn());
  box.appendChild(nameWrap);
  box.appendChild(sizeWrap);
  box.appendChild(descWrap);
  box.appendChild(makeSaveBtn());
  overlay.appendChild(box);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

async function loadDetails() {
  if (!detailsGrid) return;
  try {
    const d = await fetch('/api/details').then(r => r.json());
    cachedDetailFiles = d.success ? d.files : [];
    detailsGrid.innerHTML = '';
    if (!d.files.length) { detailsGrid.innerHTML = '<div class="gallery-empty">No items</div>'; return; }
    d.files.forEach(item => {
      // onActivate is intentionally a no-op: clicking a detail card here used to call
      // activateAsset() which polluted Character's assets table with cross-tab items.
      // Scenario-specific selection happens in the imgWrap.click handler below
      // (toggleDetailActive). Character has its own click flow for adding assets.
      const card = buildGalleryCard(item, () => {}, async (it, cardEl) => {
        const filename = it.path.replace(/^\/details\//, '');
        try {
          const r = await fetch(`/api/details/${encodeURIComponent(filename)}`, { method: 'DELETE' });
          const rd = await r.json();
          if (!rd.success) throw new Error(rd.error);
          cardEl.remove();
          cachedDetailFiles = cachedDetailFiles.filter(f => f.file !== item.file);
          activeDetailFiles.delete(item.file);
          updateDetailsCount?.(cachedDetailFiles.length);
          updateAutofillPanel?.();
        } catch (err) { setStatus('Delete error: ' + err.message); }
      });
      // Restore selection state
      if (activeDetailFiles.has(item.file)) card.classList.add('detail-selected');
      // Click on image area toggles selection
      const imgWrap = card.querySelector('.g-img-wrap');
      imgWrap?.addEventListener('click', e => {
        e.stopPropagation();
        toggleDetailActive(item.file, card);
      });
      // Edit button on the name label
      const nameEl = card.querySelector('.g-name');
      if (nameEl) {
        nameEl.style.cssText += 'cursor:pointer;text-decoration:underline dotted;';
        nameEl.title = 'Edit item data';
        nameEl.addEventListener('click', e => { e.stopPropagation(); openDetailEditModal(item); });
      }
      detailsGrid.appendChild(card);
    });
    relinkActiveThumbs?.(detailsGrid, 'data-path');
    updateAutofillPanel();
    updateDetailsCount?.(d.files.length);
  } catch { detailsGrid.innerHTML = '<div class="gallery-empty">Load error</div>'; }
}

// ── Scenario collapsible toggle ───────────────────────────────────────────────
(function () {
  const toggle = document.getElementById('scenario-collapse-toggle');
  const body   = document.getElementById('scenario-collapse-body');
  const arrow  = document.getElementById('scenario-collapse-arrow');
  if (!toggle || !body) return;
  toggle.addEventListener('click', () => {
    const open = body.style.display === 'none';
    body.style.display = open ? '' : 'none';
    if (arrow) arrow.textContent = open ? '▼' : '▶';
  });
})();

// ── Details collapsible toggle ────────────────────────────────────────────────
(function () {
  const toggle = document.getElementById('details-collapse-toggle');
  const body   = document.getElementById('details-collapse-body');
  const arrow  = document.getElementById('details-collapse-arrow');
  if (!toggle || !body) return;
  toggle.addEventListener('click', () => {
    const open = body.style.display === 'none';
    body.style.display = open ? '' : 'none';
    arrow.textContent  = open ? '▼' : '▶';
  });
})();

// ── Образы проекта collapsible toggle (open by default) ───────────────────────
(function () {
  const toggle = document.getElementById('scenarii-obrazy-toggle');
  const body   = document.getElementById('scenarii-obrazy-body');
  const arrow  = document.getElementById('scenarii-obrazy-arrow');
  if (!toggle || !body) return;
  toggle.addEventListener('click', () => {
    const open = body.style.display === 'none';
    body.style.display = open ? '' : 'none';
    if (arrow) arrow.textContent = open ? '▼' : '▶';
  });
})();

// Update the count label in the collapsible header whenever details load
function updateDetailsCount(n) {
  const el = document.getElementById('details-count');
  if (el) el.textContent = n;
}

// ── Создание button ────────────────────────────────────────────────────────────
document.getElementById('btn-scen-create')?.addEventListener('click', () => {
  // Validate: at least one образ selected
  if (activeObrazIds.size === 0) {
    setStatus('Select at least one outfit before creating.');
    return;
  }
  // Validate: at least one scenario has an assigned предмет
  const activeScensForCreate = scenarioFiles.filter(f =>
    Object.entries(scenarioAssignments).some(([k, v]) => k.startsWith(f.file + '__') && v)
  );
  if (!activeScensForCreate.length) {
    setStatus('Add items to at least one scenario.');
    return;
  }
  // Create a new unique pending session for each образ × сценарий combo
  const now = Date.now();
  let idx = 0;
  const allObrazыForCreate = getObrazы?.() || [];
  // Track title counts within this batch to add #N suffix for duplicates
  const _batchTitleCount = {};
  for (const obrazId of activeObrazIds) {
    const obraz = allObrazыForCreate.find(o => String(o.id) === String(obrazId));
    for (const f of activeScensForCreate) {
      const key = `${obrazId}__${f.file}__${now + idx}`;
      idx++;
      const _sessionDate = new Date(now + idx);
      const _dd = String(_sessionDate.getDate()).padStart(2, '0');
      const _mm = String(_sessionDate.getMonth() + 1).padStart(2, '0');
      const _yy = _sessionDate.getFullYear();
      const _hh = String(_sessionDate.getHours()).padStart(2, '0');
      const _mn = String(_sessionDate.getMinutes()).padStart(2, '0');
      const _scenName = f.name || f.file.replace(/\.txt$/, '');
      const _obrazName = obraz?.name || String(obrazId);
      const _baseTitle = `${_dd}.${_mm}.${_yy} ${_hh}:${_mn} — ${_scenName} — ${_obrazName}`;
      _batchTitleCount[_baseTitle] = (_batchTitleCount[_baseTitle] || 0) + 1;
      const _n = _batchTitleCount[_baseTitle];
      const _title = _n > 1 ? `${_baseTitle} — #${_n}` : _baseTitle;
      // Assign a permanent sequential number for this scenFile (never changes after creation)
      const _existingNums = Object.values(editFrozenSessions)
        .filter(s => (s.scenFile || '') === f.file)
        .map(s => s.num || 0);
      const _nextNum = _existingNums.length > 0 ? Math.max(..._existingNums) + 1 : 1;
      // Snapshot current образ/предмет pairs for this scenario into the session body
      const _snapAssignments = {};
      Object.entries(scenarioAssignments).forEach(([k, v]) => {
        if (v && k.startsWith(f.file + '__')) _snapAssignments[k] = v;
      });
      editFrozenSessions[key] = {
        pending:            true,
        num:                _nextNum,
        title:              _title,
        assignments:        _snapAssignments,
        obrazId:            String(obrazId),
        scenFile:           f.file,
        obrazChar:          obraz?.char || null,
        templateSessionKey: null,
        date:               _sessionDate.toISOString(),
      };
    }
  }
  saveEditState();
  // Switch to Эдит sub-panel
  document.querySelectorAll('.scen-subtab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.scen-subpanel').forEach(p => p.classList.remove('active'));
  const editBtn = document.querySelector('.scen-subtab[data-panel="scen-panel-edit"]');
  const editPanel = document.getElementById('scen-panel-edit');
  if (editBtn)  editBtn.classList.add('active');
  if (editPanel) editPanel.classList.add('active');
  document.getElementById('l1-scenarii')?.classList.add('edit-active');
  renderEditPanel();
});


