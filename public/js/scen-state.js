/* scen-state.js — Global state, constants, analysis/assignment caches, lazy-load
   IMPORTANT: loadEditState() is called in scen-init.js after all files are loaded */

/* ═══════════════════════════════════════
   SCENARIOS & DETAILS tabs
   ═══════════════════════════════════════ */

// ── ElevenLabs voices ─────────────────────────────────────────────────────────
// Catalog source of truth = data/custom-voices.json (server-side). All voices
// are user-generated via ElevenLabs Voice Design — there's no hardcoded base
// list any more. Voices created via the Character Edit popup land in the
// catalog and are appended to window.ELEVENLABS_VOICES on the next reload.
window.ELEVENLABS_VOICES = [];
window._elVoicePreviews  = {};   // { voiceId: '/voice-previews/<voiceId>.mp3' }

// ── Voices-ready gate ────────────────────────────────────────────────────────
// Boot-time race condition: loadObrazы / loadScenarioObrazы render plates
// synchronously, but isOrphanVoiceRef(obraz.voice) needs the catalog. If render
// happens before the catalog fetch resolves, every obraz with a valid voice
// looks orphan → red + click-opens-popup instead of click-selects, which kills
// the Создание flow (activeObrazIds stays empty).
//
// Fix: window.elVoicesReady is a Promise resolved by the FIRST successful
// loadCustomVoices(). loadObrazы / loadScenarioObrazы await it before their
// first render, so they always see a populated catalog. After the first
// resolve, the Promise stays resolved → subsequent awaits are zero-cost.
let _voicesReadyResolve = null;
window.elVoicesReady = new Promise(resolve => { _voicesReadyResolve = resolve; });

// Rebuild voice list from server. Called on boot and after Voice Design "Save".
// Fires 'el-voices-updated' so every registered <select> repopulates.
window.loadCustomVoices = async function() {
  try {
    const r = await fetch('/api/audio/custom-voices');
    const d = await r.json();
    if (d?.success && Array.isArray(d.voices)) {
      // Server catalog entries shape: { id, voiceId, name, gender, desc, ... }
      // Mark every entry custom:true so buildVoiceSelect uses voiceId as the
      // <option value> rather than the (potentially non-unique) name.
      window.ELEVENLABS_VOICES = d.voices.map(v => ({
        id:     v.voiceId,        // raw ElevenLabs voice_id — the lookup key
        name:   v.name,
        gender: v.gender === 'm' ? 'm' : 'f',
        desc:   v.desc || '',
        custom: true,
      }));
    } else {
      window.ELEVENLABS_VOICES = [];
    }
  } catch {
    window.ELEVENLABS_VOICES = [];
  }
  window.dispatchEvent(new CustomEvent('el-voices-updated'));
  // Resolve the gate exactly once — subsequent reloads after a Voice Design
  // save also call this function but the gate is already open.
  if (_voicesReadyResolve) { _voicesReadyResolve(); _voicesReadyResolve = null; }
};
// Kick off initial load. Callers awaiting window.elVoicesReady unblock when
// this resolves.
window.loadCustomVoices();

// Legacy stub — kept callable so any old code paths calling initElVoices()
// don't throw. Catalog comes exclusively from /api/audio/custom-voices now.
window.initElVoices = function() { /* no-op: see loadCustomVoices */ };

// Register a live <select> element so it gets rebuilt on loadCustomVoices().
// getSavedValue() should return the current "restore to" value (usually sel.value || defaultName).
window.registerVoiceSelect = function(sel, getSavedValue) {
  const handler = () => {
    if (!document.contains(sel)) { window.removeEventListener('el-voices-updated', handler); return; }
    window.buildVoiceSelect(sel, getSavedValue());
  };
  window.addEventListener('el-voices-updated', handler);
};

// ── Helper: get voice object by option value (name or id) ─────────────────────
// All voices are custom now; value = v.id (raw ElevenLabs voice_id). The name
// fallback survives so legacy obrazy entries storing voice="Chris" can still
// be matched if a custom voice happens to have the same display name.
window.findVoiceByValue = function(val) {
  return (window.ELEVENLABS_VOICES || []).find(v => v.id === val || v.name === val) || null;
};

// True if `savedValue` (an obraz.voice field) doesn't resolve to any voice in
// the current catalog — caller decides how to render the orphan state (red
// border in Library grid, disabled state in Scenarios row, etc.).
window.isOrphanVoiceRef = function(savedValue) {
  if (!savedValue) return true; // null/empty voice → also orphan (needs setup)
  return !window.findVoiceByValue(savedValue);
};

// ── Helper: get preview URL — local cached file first, fallback to null ──────
window.getVoicePreviewUrl = function(v) {
  if (!v || !v.id) return null;
  return (window._elVoicePreviews && window._elVoicePreviews[v.id]) || null;
};

// ── Helper: populate a <select> with optgroups (♀ Female / ♂ Male) ───────────
// All voices are custom-generated → value = v.id (raw ElevenLabs voice_id).
// The TTS backend resolves either name or id to the same voice_id (see
// _resolveVoiceId in routes/audio.js), so legacy obrazy entries that stored
// the name continue to match by name if any catalog entry has that name.
window.buildVoiceSelect = function(sel, savedValue) {
  sel.innerHTML = '';
  const all = window.ELEVENLABS_VOICES || [];
  if (!all.length) {
    const o = document.createElement('option');
    o.value = '';
    o.textContent = '(no voices — generate via Edit popup)';
    o.disabled = true;
    o.selected = true;
    sel.appendChild(o);
    return;
  }
  const sections = [
    { label: '♀ Female', filter: v => v.gender === 'f' },
    { label: '♂ Male',   filter: v => v.gender === 'm' },
  ];
  sections.forEach(({ label, filter }) => {
    const voices = all.filter(filter);
    if (!voices.length) return;
    const group = document.createElement('optgroup');
    group.label = label;
    voices.forEach(v => {
      const o = document.createElement('option');
      o.value = v.id;
      o.textContent = v.name + (v.desc ? ` — ${v.desc}` : '');
      if (v.name === savedValue || v.id === savedValue) o.selected = true;
      group.appendChild(o);
    });
    sel.appendChild(group);
  });
  if (!sel.value) sel.selectedIndex = 0;
};

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
      setStatus(`Maximum ${MAX_ACTIVE_OBRAZY} outfits`);
      return;
    }
    activeObrazIds.add(id);
    wrapEl?.classList.add('obraz-active');
  }
  saveEditState();
  renderEditPanel();
  window.refreshScenStateUI?.();
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
  { label: 'Random',            prompt: '' },
  { label: 'In left hand',      prompt: 'The character holds the item naturally in their left hand, arm relaxed at side, item clearly visible. Natural grip, correct proportional scale.' },
  { label: 'In right hand',     prompt: 'The character holds the item in their right hand raised slightly toward camera at a comfortable angle, item prominent and fully visible.' },
  { label: 'With both hands',   prompt: 'The character holds the item with both hands, centered in front of the body at natural chest height, secure and comfortable grip, item fully visible.' },
  { label: 'Over head',         prompt: 'The character lifts the item above their head with both arms extended upward, item clearly visible at the top of the frame, triumphant pose.' },
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

