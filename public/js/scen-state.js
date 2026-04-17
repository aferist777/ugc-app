/* scen-state.js — Global state, constants, analysis/assignment caches, lazy-load
   IMPORTANT: loadEditState() is called in scen-init.js after all files are loaded */

/* ═══════════════════════════════════════
   SCENARIOS & DETAILS tabs
   ═══════════════════════════════════════ */

// ── ElevenLabs voice list ─────────────────────────────────────────────────────
// id: null → use name as API value; id: string → use id as API value + preview available
window.ELEVENLABS_VOICES = [
  // Named presets (no preview URL available)
  { name: 'Rachel',   id: null, desc: 'Default female' },
  { name: 'Aria',     id: null, desc: '' },
  { name: 'Roger',    id: null, desc: '' },
  { name: 'Sarah',    id: null, desc: '' },
  { name: 'Charlie',  id: null, desc: '' },
  { name: 'George',   id: null, desc: '' },
  { name: 'River',    id: null, desc: '' },
  { name: 'Alice',    id: null, desc: '' },
  { name: 'Matilda',  id: null, desc: '' },
  { name: 'Will',     id: null, desc: '' },
  { name: 'Eric',     id: null, desc: '' },
  { name: 'Daniel',   id: null, desc: '' },
  { name: 'Lily',     id: null, desc: '' },
  { name: 'Bill',     id: null, desc: '' },
  // Extended voices with IDs (preview available)
  { name: 'Adam',        id: 'pNInz6obpgDQGcFmaJgB', desc: 'Dominant, Firm' },
  { name: 'Brian',       id: 'nPczCjzI2devNBz1zQrb', desc: 'Deep, Resonant, Comforting' },
  { name: 'Callum',      id: 'N2lVS1w4EtoT3dr4eOWO', desc: 'Husky Trickster' },
  { name: 'Charlotte',   id: 'XB0fDUnXU5powFXDhCwa', desc: '' },
  { name: 'Chris',       id: 'iP95p4xoKVk53GoZ742B', desc: 'Charming, Down-to-Earth' },
  { name: 'Jessica',     id: 'cgSgspJ2msm6clMCkdW9', desc: 'Playful, Bright, Warm' },
  { name: 'Laura',       id: 'FGY2WhTYpPnrIDTdsKH5', desc: 'Enthusiast, Quirky Attitude' },
  { name: 'Liam',        id: 'TX3LPaxmHKxFdv7VOQHJ', desc: 'Energetic, Social Media Creator' },
  { name: 'Ellen',       id: 'BIvP0GN1cAtSRTxNHnWS', desc: 'Serious, Direct, Confident' },
  { name: 'James',       id: 'EkK5I93UQWFDigLMpZcX', desc: 'Husky, Engaging, Bold' },
  { name: 'Hope',        id: 'tnSpp4vdxKPjI9w0GnoV', desc: 'Upbeat, Clear' },
  { name: 'Austin',      id: 'Bj9UqZbhQsanLzgalpEG', desc: 'Deep, Raspy, Authentic' },
  { name: 'Harry',       id: 'SOYHLrjzK2X1ezoPC6cr', desc: 'Fierce Warrior' },
  { name: 'Amelia',      id: 'ZF6FPAbjXT4488VcRRnw', desc: 'Enthusiastic, Expressive' },
  { name: 'Olivia',      id: '1hlpeD1ydbI2ow0Tt3EW', desc: 'Smooth, Warm, Engaging' },
  { name: 'Emily',       id: '1cxc5c3E9K6F1wlqOJGV', desc: 'Gentle, Soft, Meditative' },
  { name: 'Bella',       id: 'hpp4J3VqNfWAUOO0d1Us', desc: 'Professional, Bright, Warm' },
  { name: 'Heather Rey', id: 'MnUw1cSnpiLoLhpd3Hqp', desc: 'Rushed, Friendly' },
  { name: 'Sam',         id: 'scOwDtmlUjD3prqpp97I', desc: 'Support Agent' },
  { name: 'Tom',         id: 'DYkrAHD8iwork3YSUBbs', desc: 'Conversations, Books' },
  { name: 'Matthew',     id: 'IjnA9kwZJHJ20Fp7Vmy6', desc: 'Casual, Friendly, Smooth' },
  { name: 'Mark',        id: '1SM7GgM6IMuvQlz2BwM3', desc: 'Casual, Relaxed, Light' },
  { name: 'Felix',       id: 'Sq93GQT4X1lKDXsQcixO', desc: 'Warm, Positive' },
  { name: 'Sven',        id: 'Tsns2HvNFKfGiNjllgqo', desc: 'Emotional, Nice' },
  { name: 'Nathaniel',   id: 'AeRdCCKzvd23BpJoofzx', desc: 'Engaging, British, Calm' },
  { name: 'Benjamin',    id: 'LruHrtVF6PSyGItzMNHS', desc: 'Deep, Warm, Calming' },
  { name: 'Theodore',    id: 'hqfrgApggtO1785R4Fsn', desc: 'Serene, Grounded' },
];

// ── Lazy image loader (IntersectionObserver) ──────────────────────────────────
const _lazyObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    const img = entry.target;
    if (img.dataset.src) { img.src = img.dataset.src; delete img.dataset.src; }
    _lazyObserver.unobserve(img);
  });
}, { rootMargin: '100px' });
function lazyLoad(img) { _lazyObserver.observe(img); }

// ── Sub-tab switching ─────────────────────────────────────────────────────────
document.querySelectorAll('.scen-subtab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.scen-subtab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.scen-subpanel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    const target = btn.dataset.panel;
    document.getElementById(target)?.classList.add('active');
    // Toggle edit-active on the tab panel (hides образы/upload/предметы in right col)
    document.getElementById('l1-scenarii')?.classList.toggle('edit-active', target === 'scen-panel-edit');
    if (target === 'scen-panel-db')   loadArchivedScenarios();
    if (target === 'scen-panel-edit') {
      window._editPanelNeedsRender = false;
      // Sync starred status: sessions that finished avatar videos since startup get starred=true
      _migrateStarredSessions?.();
      renderEditPanel();
    }
    if (target === 'scen-panel-active') {
      // If any generation is done, clear those scenario assignments for a fresh start
      const doneSessions = Object.entries(editFrozenSessions).filter(([, s]) => s.done);
      if (doneSessions.length) {
        const doneScens = new Set(doneSessions.map(([k]) => k.split('__').slice(1).join('__')));
        doneScens.forEach(scenFile => {
          Object.keys(scenarioAssignments).forEach(k => {
            if (k.startsWith(scenFile + '__')) delete scenarioAssignments[k];
          });
        });
        _saveAssignmentsToLS();
        saveScenarioAssignments();
        updateActiveScenariosList();
        loadScenarios();
      }
    }
  });
});

// ── Active образ selection (multi, up to 10) ──────────────────────────────────
const activeObrazIds = new Set();
const MAX_ACTIVE_OBRAZY = 10;

function getActiveObrazы() {
  const all = getObrazы?.() || [];
  return [...activeObrazIds].map(id => all.find(o => o.id === id)).filter(Boolean);
}

function setActiveObraz(id, wrapEl) {
  if (activeObrazIds.has(id)) {
    activeObrazIds.delete(id);
    wrapEl?.classList.remove('obraz-active');
  } else {
    if (activeObrazIds.size >= MAX_ACTIVE_OBRAZY) {
      setStatus(`Максимум ${MAX_ACTIVE_OBRAZY} образов`);
      return;
    }
    activeObrazIds.add(id);
    wrapEl?.classList.add('obraz-active');
  }
  saveEditState();
  renderEditPanel();
}

// ── Scenario assignments ──────────────────────────────────────────────────────
// Persisted in localStorage (primary) + server (backup) so assignments survive
// page refresh, tab switches and any action that calls loadScenarioAssignments().
const LS_SCENARIO_ASSIGNMENTS = 'scenario_assignments_v1';
function _saveAssignmentsToLS() {
  try { localStorage.setItem(LS_SCENARIO_ASSIGNMENTS, JSON.stringify(scenarioAssignments)); } catch {}
}
let scenarioAssignments = (() => {
  try { return JSON.parse(localStorage.getItem(LS_SCENARIO_ASSIGNMENTS) || '{}'); } catch { return {}; }
})();
let scenarioFiles      = []; // cache of {file, name} for active-scenarios panel
let cachedDetailFiles  = []; // cache of detail {file, name, path, thumbPath}
const scenarioLinesCache = {}; // filename → lines[]

async function getLinesForScenario(filename) {
  if (scenarioLinesCache[filename]) return scenarioLinesCache[filename];
  const stored = getModifiedLines(filename);
  if (stored) { scenarioLinesCache[filename] = stored; return stored; }
  try {
    const d = await fetch(`/api/scenarios/${encodeURIComponent(filename)}`).then(r => r.json());
    scenarioLinesCache[filename] = d.lines || [];
    return scenarioLinesCache[filename];
  } catch { return []; }
}

// ── Default interaction options (label shown in dropdown, prompt used for generation) ──
const DEFAULT_INTERACTIONS = [
  { label: 'Рандом',            prompt: '' },
  { label: 'В левой руке',      prompt: 'The character holds the item naturally in their left hand, arm relaxed at side, item clearly visible. Natural grip, correct proportional scale.' },
  { label: 'В правой руке',     prompt: 'The character holds the item in their right hand raised slightly toward camera at a comfortable angle, item prominent and fully visible.' },
  { label: 'Двумя руками',      prompt: 'The character holds the item with both hands, centered in front of the body at natural chest height, secure and comfortable grip, item fully visible.' },
  { label: 'Над головой',       prompt: 'The character lifts the item above their head with both arms extended upward, item clearly visible at the top of the frame, triumphant pose.' },
];

// Analysis cache: detailFile → [{label, prompt}, ...] (3 Gemini variants per asset)
// Persisted to localStorage so results survive tab switches and re-renders
const LS_ANALYSIS_CACHE = 'edit_analysis_cache_v1';
function _loadAnalysisCache() { try { return JSON.parse(localStorage.getItem(LS_ANALYSIS_CACHE) || '{}'); } catch { return {}; } }
function _saveAnalysisCache() { try { localStorage.setItem(LS_ANALYSIS_CACHE, JSON.stringify(analysisCache)); } catch {} }
const analysisCache = _loadAnalysisCache();

// Per-card selected interaction: `${scenFile}__${lineIndex}` → optionIndex (into merged options)
const cardInteractionSel = {};
// Per-scenario merged options (default + cached): scenFile → [{label,prompt}]
const scenarioMergedOptions = {};

// ── Эдит panel render guard ───────────────────────────────────────────────────
// Prevents destructive re-renders while panel is hidden (tab switch away).
// When panel becomes visible again, renderEditPanel() is called normally.
// Exposed on window so tabs.js can trigger deferred render on Склейка tab return.
window._editPanelNeedsRender = false;

// ── Frozen edit sessions ──────────────────────────────────────────────────────
// key: `${obrazId}__${scenFile}` → { lines, cells:[{imagePath,detInfo,line}], generating, done }
const editFrozenSessions = {};

// ── Per-card result cache — survives renderEditPanel re-renders (tab switches) ─
// key: `${scenFile}__${lineIdx}` (interaction) or `${scenFile}__${lineIdx}__pose` (pose gen)
const editCardCache = {};

// Each "Создание" click gets a unique instance key so sessions never overwrite each other
function editSessionKey(obrazId, scenFile) { return `${obrazId}__${scenFile}__${Date.now()}`; }

// ── Edit state persistence (localStorage) ────────────────────────────────────
const LS_ACTIVE_OBRAZY    = 'edit_active_obrazy_v1';
const LS_FROZEN_SESSIONS  = 'edit_frozen_sessions_v1';
const LS_CARD_CACHE       = 'edit_card_cache_v1';
// Last-visible sets: record exactly what was shown last time each panel rendered.
// On reload, anything NOT in these sets is auto-hidden/closed so the UI looks
// the same as when the user left.
const LS_EDIT_LAST_VISIBLE   = 'edit_last_visible_v1';   // Эдит  — session keys
const LS_SKLEYKA_LAST_SHOWN  = 'skleyka_last_shown_v1';  // Склейка — session keys
function _saveEditLastVisible(keyIterable) {
  try { localStorage.setItem(LS_EDIT_LAST_VISIBLE, JSON.stringify([...keyIterable])); } catch {}
}
function _loadEditLastVisible() {
  try {
    const raw = localStorage.getItem(LS_EDIT_LAST_VISIBLE);
    return raw ? new Set(JSON.parse(raw)) : null; // null = first run ever
  } catch { return null; }
}
function _saveSkleykaLastShown(keyIterable) {
  try { localStorage.setItem(LS_SKLEYKA_LAST_SHOWN, JSON.stringify([...keyIterable])); } catch {}
}
function _loadSkleykaLastShown() {
  try {
    const raw = localStorage.getItem(LS_SKLEYKA_LAST_SHOWN);
    return raw ? new Set(JSON.parse(raw)) : null;
  } catch { return null; }
}

function saveEditState() {
  try {
    localStorage.setItem(LS_ACTIVE_OBRAZY,   JSON.stringify([...activeObrazIds]));
    // Save ALL sessions — including generating ones (cells may have taskIds for recovery)
    localStorage.setItem(LS_FROZEN_SESSIONS, JSON.stringify(editFrozenSessions));
    localStorage.setItem(LS_CARD_CACHE,      JSON.stringify(editCardCache));
  } catch {}
}

function loadEditState() {
  try {
    const ids = JSON.parse(localStorage.getItem(LS_ACTIVE_OBRAZY) || '[]');
    ids.forEach(id => activeObrazIds.add(id));
    const sessions = JSON.parse(localStorage.getItem(LS_FROZEN_SESSIONS) || '{}');
    // Migrate old keys (format: "obrazId__scenFile") — inject scenFile/obrazId metadata
    for (const [key, sess] of Object.entries(sessions)) {
      if (!sess.scenFile) {
        const parts = key.split('__');
        sess.obrazId  = parts[0];
        sess.scenFile = parts.slice(1).join('__');
      }
    }
    Object.assign(editFrozenSessions, sessions);
    const cache = JSON.parse(localStorage.getItem(LS_CARD_CACHE) || '{}');
    Object.assign(editCardCache, cache);

    // ── Restore Эдит visible set ─────────────────────────────────────────────
    // Any session that was not shown during the last Эдит view gets auto-hidden,
    // so the tab looks exactly the same as when the user left.
    const lastVisible = _loadEditLastVisible();
    if (lastVisible !== null) {
      for (const [key, sess] of Object.entries(editFrozenSessions)) {
        if (!lastVisible.has(key) && !sess.hiddenFromEdit) {
          sess.hiddenFromEdit = true;
        }
      }
    }

    // ── Restore Склейка closed set ───────────────────────────────────────────
    // Completed sessions that were not shown last time → auto-close so the
    // timeline panel looks identical to what the user left. Runs after
    // editFrozenSessions is populated so getCompletedSessions() is accurate.
    const lastShown = _loadSkleykaLastShown();
    if (lastShown !== null) {
      const closed = getSkleykaClosed();
      let changed = false;
      getCompletedSessions().forEach(([key]) => {
        if (!closed.has(key) && !lastShown.has(key)) {
          closed.add(key);
          changed = true;
        }
      });
      if (changed) saveSkleykaClosed(closed);
    }
  } catch {}
}

function removeEditProject(sessionKey) {
  delete editFrozenSessions[sessionKey];
  // Remove all card cache entries for this session (keyed by sessionKey prefix)
  Object.keys(editCardCache).forEach(k => {
    if (k.startsWith(sessionKey + '__')) delete editCardCache[k];
  });
  saveEditState();
}

// ── Edit project archive (deleted projects) ───────────────────────────────────
const LS_EDIT_ARCHIVE        = 'edit_archived_projects_v1';
const LS_EDIT_ACTIVE_PROJECT = 'edit_active_project_key_v1';

function loadEditArchive() {
  try { return JSON.parse(localStorage.getItem(LS_EDIT_ARCHIVE) || '[]'); } catch { return []; }
}
function saveEditArchive(list) {
  try { localStorage.setItem(LS_EDIT_ARCHIVE, JSON.stringify(list)); } catch {}
}
function getActiveProjectKey() {
  return localStorage.getItem(LS_EDIT_ACTIVE_PROJECT) || '';
}
function setActiveProjectKey(key) {
  if (key) localStorage.setItem(LS_EDIT_ACTIVE_PROJECT, key);
  else localStorage.removeItem(LS_EDIT_ACTIVE_PROJECT);
}

