/* ═══════════════════════════════════════════════════════════════
   PROJECTS — per-character session management
   ═══════════════════════════════════════════════════════════════ */

const PROJECTS_KEY    = 'projects_v1';
const CUR_PROJECT_KEY = 'current_project_id';

// ── Storage helpers ───────────────────────────────────────────────────────────
function getAllProjects() {
  try { return JSON.parse(localStorage.getItem(PROJECTS_KEY) || '[]'); } catch { return []; }
}
let _projSyncTimer = null;
function _saveAllProjects(list) {
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(list));
  clearTimeout(_projSyncTimer);
  _projSyncTimer = setTimeout(() => {
    fetch('/api/userdata/projects', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ list }),
    }).catch(() => {});
  }, 1000);
}

function getCurrentProjectId() {
  return localStorage.getItem(CUR_PROJECT_KEY) || null;
}
function setCurrentProjectId(id) {
  if (id) localStorage.setItem(CUR_PROJECT_KEY, id);
  else    localStorage.removeItem(CUR_PROJECT_KEY);
}

function getProjectById(id) {
  return getAllProjects().find(p => p.id === id) || null;
}

// ── Create / update project ───────────────────────────────────────────────────
function createProject(charImagePath, charName) {
  const id = 'proj_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const project = {
    id,
    name:        charName || ('Project ' + new Date().toLocaleString('en-GB', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })),
    charImage:   charImagePath || null,
    thumbnail:   charImagePath || null,
    createdAt:   new Date().toISOString(),
    updatedAt:   new Date().toISOString(),
    state:       null,   // full saveAppState snapshot will go here
  };
  const list = getAllProjects();
  list.unshift(project);
  _saveAllProjects(list);
  setCurrentProjectId(id);
  _renderProjectsDropdown();
  return project;
}

function updateCurrentProject(stateSnapshot) {
  const id = getCurrentProjectId();
  if (!id) return;
  const list = getAllProjects();
  const idx  = list.findIndex(p => p.id === id);
  if (idx === -1) return;
  list[idx].state     = stateSnapshot;
  list[idx].updatedAt = new Date().toISOString();
  // Keep thumbnail up-to-date (last generated image)
  if (stateSnapshot?.generatedImagePath) {
    list[idx].thumbnail = stateSnapshot.generatedImagePath;
  }
  _saveAllProjects(list);
}

function deleteProject(id) {
  const list = getAllProjects().filter(p => p.id !== id);
  _saveAllProjects(list);
  if (getCurrentProjectId() === id) setCurrentProjectId(null);
  _renderProjectsDropdown();
}

function renameProject(id, newName) {
  const list = getAllProjects();
  const proj = list.find(p => p.id === id);
  if (!proj) return;
  proj.name = newName.trim() || proj.name;
  _saveAllProjects(list);
  _renderProjectsDropdown();
}

// ── Load a saved project into the UI ─────────────────────────────────────────
function loadProject(id) {
  const project = getProjectById(id);
  if (!project) return;
  setCurrentProjectId(id);
  if (project.state) {
    // Restore full app state
    try {
      localStorage.setItem('char_state_v1', JSON.stringify(project.state));
    } catch {}
    restoreAppState?.();
  }
  _renderProjectsDropdown();
  setStatus?.(`Project loaded: "${project.name}"`);
}

// ── Snapshot the current app state and persist it into the active project ────
function snapshotCurrentProject() {
  const id = getCurrentProjectId();
  if (!id) return;
  try {
    const raw = localStorage.getItem('char_state_v1');
    if (raw) updateCurrentProject(JSON.parse(raw));
  } catch {}
}

// ── Projects dropdown (in the tab bar) ───────────────────────────────────────
function _renderProjectsDropdown() {
  const sel = document.getElementById('projects-select');
  if (!sel) return;
  const curId  = getCurrentProjectId();
  const list   = getAllProjects();
  sel.innerHTML = '';

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = list.length ? '📁 Projects' : '📁 Projects (empty)';
  placeholder.disabled = true;
  placeholder.selected = true;
  sel.appendChild(placeholder);

  list.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    const ts  = new Date(p.updatedAt).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    opt.textContent = (p.id === curId ? '▶ ' : '') + p.name + '  [' + ts + ']';
    sel.appendChild(opt);
  });
}

// ── Init: render dropdown on page load ───────────────────────────────────────
// Scripts are at end of body so DOM is ready; use timeout to ensure other
// scripts (character.js etc.) have initialized before we call restoreAppState
_renderProjectsDropdown();

// ── Server-side persistence bootstrap ────────────────────────────────────────
(async () => {
  try {
    const r = await fetch('/api/userdata/projects');
    const d = await r.json();
    if (!d.success) return;
    if (d.list?.length) {
      localStorage.setItem(PROJECTS_KEY, JSON.stringify(d.list));
      _renderProjectsDropdown();
    } else {
      const local = getAllProjects();
      if (local.length) {
        fetch('/api/userdata/projects', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ list: local }),
        }).catch(() => {});
      }
    }
  } catch {}
})();

document.getElementById('projects-select')?.addEventListener('change', function() {
  const id = this.value;
  if (!id) return;
  this.value = ''; // reset to placeholder
  if (id === getCurrentProjectId()) {
    setStatus?.('This project is already active.');
    return;
  }
  // Save current before switching
  snapshotCurrentProject();
  loadProject(id);
});

// ── Auto-save on page unload ──────────────────────────────────────────────────
window.addEventListener('beforeunload', () => {
  snapshotCurrentProject();
});

// ── Projects archive tab ──────────────────────────────────────────────────────
function loadProjectsArchive() {
  const grid = document.getElementById('archive-projects-grid');
  if (!grid) return;
  const list = getAllProjects();
  grid.innerHTML = '';
  if (!list.length) {
    grid.innerHTML = '<div class="gallery-empty">No saved projects</div>';
    return;
  }
  const curId = getCurrentProjectId();

  list.forEach(project => {
    const card = document.createElement('div');
    card.className = 'proj-card' + (project.id === curId ? ' proj-card-active' : '');

    // Thumbnail
    if (project.thumbnail) {
      const img = document.createElement('img');
      img.src = project.thumbnail + '?t=' + Date.now();
      img.className = 'proj-thumb';
      img.addEventListener('click', () => openLightbox?.(project.thumbnail));
      card.appendChild(img);
    } else {
      const ph = document.createElement('div');
      ph.className = 'proj-thumb proj-thumb-empty';
      ph.textContent = '?';
      card.appendChild(ph);
    }

    // Meta
    const meta = document.createElement('div');
    meta.className = 'proj-meta';

    const nameEl = document.createElement('div');
    nameEl.className = 'proj-name';
    nameEl.textContent = (project.id === curId ? '▶ ' : '') + project.name;
    nameEl.title = 'Double-click to rename';
    nameEl.style.cursor = 'text';
    nameEl.addEventListener('dblclick', e => {
      e.stopPropagation();
      const prefix = project.id === curId ? '▶ ' : '';
      const input = document.createElement('input');
      input.type = 'text';
      input.value = project.name;
      input.style.cssText = 'width:100%;font-size:10px;font-weight:bold;box-sizing:border-box;';
      nameEl.replaceWith(input);
      input.focus();
      input.select();
      const commit = () => {
        const val = input.value.trim() || project.name;
        renameProject(project.id, val);
        project.name = val;
        nameEl.textContent = prefix + val;
        input.replaceWith(nameEl);
      };
      input.addEventListener('blur', commit);
      input.addEventListener('keydown', ev => {
        if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
        if (ev.key === 'Escape') { input.replaceWith(nameEl); }
      });
    });
    meta.appendChild(nameEl);

    const dateEl = document.createElement('div');
    dateEl.className = 'proj-date';
    const updated = new Date(project.updatedAt).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    dateEl.textContent = 'updated: ' + updated;
    meta.appendChild(dateEl);

    // Load button
    if (project.id !== curId) {
      const loadBtn = document.createElement('button');
      loadBtn.className = 'proj-load-btn';
      loadBtn.textContent = 'Load';
      loadBtn.addEventListener('click', () => {
        snapshotCurrentProject();
        loadProject(project.id);
        loadProjectsArchive(); // re-render
      });
      meta.appendChild(loadBtn);
    }

    // Delete button
    const delBtn = document.createElement('button');
    delBtn.className = 'g-delete proj-del-btn';
    delBtn.textContent = '✕';
    delBtn.title = 'Delete project';
    delBtn.addEventListener('click', e => {
      e.stopPropagation();
      deleteProject(project.id);
      card.remove();
      if (!document.querySelector('.proj-card')) {
        grid.innerHTML = '<div class="gallery-empty">No saved projects</div>';
      }
    });

    card.appendChild(meta);
    card.appendChild(delBtn);
    grid.appendChild(card);
  });
}
