/* ═══════════════════════════════════════════════════════════════════════
   BIROLY IDEAS POPUP — steps 1-5
   ───────────────────────────────────────────────────────────────────────
   Public entry: window.openBirolyIdeasPopup()
   Step 1: minimal shell — backdrop, compact title bar, ✕/ESC/backdrop close.
   Step 2: scenario dropdown — ⭐ starred + open-in-Edit projects, deduped
           by scenarioFile, with "used by N projects" count.
   Step 3: intensity slider 1-10 (default 6, persisted).
   Step 4: 🔍 Analyze + ↻ Refresh + ⚙ Settings in the controls row.
           Click Analyze → fires 3 parallel batched LLM calls (LITERAL /
           METAPHOR / ENERGY angles) — each batch = 1 idea per scene.
           Ideas render progressively into scene cards with editable PROMPT
           textarea + ◀ N/3 ▶ batch nav + per-scene intensity slider for
           Remake + Remake + Discard. 4px coloured left stripe shows the
           displayed idea's intensity. Per-scenario persistence in LS.
   Step 5: ▶ Gen t2v per card — Grok t2v (6s, 480p, 9:16) with server-side
           biroll visual boost (birolMode=true). Generated clips accumulate
           in idea.generatedVideos[] as {videoPath, promptUsed, intensity,
           generatedAt} objects so each clip remembers the exact prompt
           used to make it (user may have edited the textarea between
           generations). Paginated lightbox flips through every clip;
           Remake KEEPS the history, per-slot 🗑 wipes just that slot.
   Step 7: 💾 Save clip to the biroly GALLERY — lives INSIDE the lightbox so
           the user saves a specific generated clip into a chosen category.
           Sub-modal asks only for a name + category (existing or "+ new"
           inline create). The clip's mp4 is written straight into the biroly
           archive (addPendingBirolyEntry + updateBirolyEntry) so it shows in
           the birols grid and can be dragged onto the timeline. No spintax,
           no prompt slot. Per-clip savedVideoIds maps clipIdx → {slotId(entry
           id), name} so the lightbox shows "✓ saved as …" on revisit.
   Step 8: ⚙ Settings — per-vertical metaphor lexicons. Dropdown picks active
           vertical (потенция / простата / память / похудение). Textarea
           shows that vertical's lexicon (one metaphor per line); switching
           verticals preserves in-flight edits. Apply mode toggle Strict
           (LLM picks only from list) vs Inspired (LLM invents similar).
           Saved to biroly_metaphor_settings_v1. The active vertical's
           lexicon is sent with EVERY /ideas-from-scenario batch (1/2/3)
           and with every /idea-remake — backend
           (_buildMetaphorLexiconBlock in routes/hooks.js) splices it into
           the system prompt so literal, metaphoric, and kinetic shots all
           stay inside the niche's visual world.
   Step 6 (bulk gen + auto-fill timeline) still pending.
   ═══════════════════════════════════════════════════════════════════════ */

(function () {
  if (window.openBirolyIdeasPopup) return;   // single-load guard

  const INTENSITY_LS_KEY    = 'biroly_ideas_intensity_v1';
  const STATE_LS_KEY        = 'biroly_ideas_state_v1';   // popup ideas snapshot, keyed by scenarioFile
  const BIROLY_DURATION_SEC = 6;   // Grok t2v default — biroll length in shotlist text

  // ── Metaphor settings (per-vertical lexicons + apply mode) ───────────────
  // Drives the METAPHOR batch (batch=2) of /ideas-from-scenario. Stored as
  //   { vertical, applyMode, lexicons: { potency, prostate, memory, weight_loss } }
  // - vertical    — which lexicon to inject for THIS scenario (4 fixed niches)
  // - applyMode   — 'strict'   → LLM must pick metaphors only from the list
  //                 'inspired' → LLM uses list as style inspiration, may invent similar
  // - lexicons    — multi-line text, one metaphor per line; defaults below are
  //                 hand-curated for each nutra vertical. User edits per vertical
  //                 are preserved across vertical switches.
  const METAPHOR_LS_KEY = 'biroly_metaphor_settings_v1';
  const METAPHOR_VERTICALS = [
    { id: 'potency',      label: 'Потенция'  },
    { id: 'prostate',     label: 'Простата'  },
    { id: 'memory',       label: 'Память'    },
    { id: 'weight_loss',  label: 'Похудение' },
  ];
  const METAPHOR_DEFAULT_LEXICONS = {
    potency: [
      'oil filling vs draining glass',
      'candle flame strength rising',
      'deflated to inflated balloon',
      'snapped pencil becoming whole',
      'drooping to ripening fruit',
      'dripping faucet vs steady stream',
      'wilted to fresh plant',
      'dim to bright bulb',
      'faded to saturated color',
      'cold ash to glowing ember',
    ].join('\n'),
    prostate: [
      'midnight bathroom light',
      'faucet drip rhythm',
      'hourglass sand stuck mid-flow',
      'alarm clock 3am',
      'water glass filling slowly',
      'ice cracking',
      'clenched fist to relaxed hand',
      'blocked pipe vs clear flow',
      'knot to untied rope',
      'locked valve to open tap',
    ].join('\n'),
    memory: [
      'foggy window clearing',
      'scattered puzzle pieces assembling',
      'dim bulb to bright',
      'blurred photo to sharp',
      'dust cloud settling',
      'tangled wires straightening',
      'faded ink to fresh',
      'broken thread reconnected',
      'locked drawer opening',
      'static TV to clear image',
    ].join('\n'),
    weight_loss: [
      'tightening belt notch by notch',
      'jeans button gap closing',
      'scale numbers dropping',
      'melting wax block',
      'mirror silhouette shrinking',
      'loose clothes draping',
      'ice cube shrinking in glass',
      'balloon deflating slowly',
      'candle wax pooling',
      'sand timer emptying',
    ].join('\n'),
  };
  function _defaultMetaphorSettings() {
    return {
      vertical:  'potency',
      applyMode: 'inspired',
      lexicons:  { ...METAPHOR_DEFAULT_LEXICONS },
    };
  }
  function _loadMetaphorSettings() {
    try {
      const raw = localStorage.getItem(METAPHOR_LS_KEY);
      if (!raw) return _defaultMetaphorSettings();
      const obj = JSON.parse(raw);
      const def = _defaultMetaphorSettings();
      return {
        vertical:  METAPHOR_VERTICALS.some(v => v.id === obj.vertical) ? obj.vertical : def.vertical,
        applyMode: obj.applyMode === 'strict' ? 'strict' : 'inspired',
        lexicons:  { ...def.lexicons, ...(obj.lexicons && typeof obj.lexicons === 'object' ? obj.lexicons : {}) },
      };
    } catch { return _defaultMetaphorSettings(); }
  }
  function _saveMetaphorSettings(s) {
    try { localStorage.setItem(METAPHOR_LS_KEY, JSON.stringify(s)); } catch {}
  }
  // Build the request payload field consumed by /ideas-from-scenario (batch=2)
  // and /idea-remake. Returns null when the active lexicon is empty — caller
  // omits the field entirely so the backend treats it as "no override".
  function _metaphorPayload() {
    const s = _loadMetaphorSettings();
    const lex = String((s.lexicons && s.lexicons[s.vertical]) || '').trim();
    if (!lex) return null;
    return { vertical: s.vertical, applyMode: s.applyMode, lexicon: lex };
  }

  // ── Persistence: { lastScenario, byScenario: { scenFile: snapshot, ... } } ─
  // Snapshot per scenario carries everything needed to reproduce the popup
  // grid exactly: ideasByScene, activeIdxByScene, sceneIntensity, sceneCount.
  // Saved with debounce on every meaningful state change (batch ingest, prompt
  // edit, intensity move, batch flip, remake, discard).
  function _readPersistedState() {
    try {
      const raw = localStorage.getItem(STATE_LS_KEY);
      const obj = raw ? JSON.parse(raw) : null;
      if (!obj || typeof obj !== 'object') return { lastScenario: null, byScenario: {} };
      if (!obj.byScenario || typeof obj.byScenario !== 'object') obj.byScenario = {};
      return obj;
    } catch { return { lastScenario: null, byScenario: {} }; }
  }
  let _persistTimer = null;
  function _persistState() {
    if (_persistTimer) clearTimeout(_persistTimer);
    _persistTimer = setTimeout(_doPersist, 300);
  }
  function _doPersist() {
    if (!_state || !_state.selectedScenarioFile) return;
    const persisted = _readPersistedState();
    persisted.lastScenario = _state.selectedScenarioFile;
    persisted.byScenario[_state.selectedScenarioFile] = {
      ideasByScene:     _state.ideasByScene,
      activeIdxByScene: _state.activeIdxByScene,
      sceneIntensity:   _state.sceneIntensity,
      hintsByScene:     _state.hintsByScene,
      sceneCount:       _state.sceneCount,
      savedAt:          Date.now(),
    };
    try { localStorage.setItem(STATE_LS_KEY, JSON.stringify(persisted)); }
    catch (e) { console.warn('[biroly-ideas] persist failed:', e.message); }
  }
  // Load a scenario's snapshot into _state, OR clear if nothing stored.
  function _loadScenarioSnapshot(scenarioFile) {
    const persisted = _readPersistedState();
    const data = persisted.byScenario[scenarioFile];
    if (!data) {
      _state.ideasByScene     = {};
      _state.activeIdxByScene = {};
      _state.sceneIntensity   = {};
      _state.hintsByScene     = {};
      _state.sceneCount       = 0;
      return false;
    }
    _state.ideasByScene     = data.ideasByScene     || {};
    _state.activeIdxByScene = data.activeIdxByScene || {};
    _state.sceneIntensity   = data.sceneIntensity   || {};
    _state.hintsByScene     = data.hintsByScene     || {};
    _state.sceneCount       = data.sceneCount       || 0;
    return true;
  }

  // ── idea.generatedVideos normalisation ────────────────────────────────────
  // Legacy shape: idea.generatedVideo  = '/uploads/foo.mp4'        (single string)
  //               idea.generatedVideos = ['/uploads/foo.mp4', ...] (array of strings)
  // New shape:    idea.generatedVideos = [{ videoPath, promptUsed, intensity, generatedAt }, ...]
  // The promptUsed snapshot lets the lightbox + save-to-library know the
  // exact prompt that produced each clip, even if the user has edited the
  // textarea since (so saving an old clip writes the OLD prompt to library,
  // not whatever's currently typed in the card).
  function _normalizeVideoEntries(idea) {
    if (!idea) return;
    // Migrate legacy single-string field into an array
    if (idea.generatedVideo && !idea.generatedVideos) {
      idea.generatedVideos = [idea.generatedVideo];
      delete idea.generatedVideo;
    }
    if (!Array.isArray(idea.generatedVideos)) {
      idea.generatedVideos = [];
      return;
    }
    // Wrap any legacy string entries as objects with best-effort fallbacks.
    idea.generatedVideos = idea.generatedVideos.map(v => {
      if (typeof v === 'string') {
        return {
          videoPath:   v,
          promptUsed:  idea.prompt || '',
          intensity:   idea.intensity || 6,
          generatedAt: 0,
        };
      }
      return v;
    });
  }

  // ── Biroly library helpers (same LS keys the Biroly tab uses) ─────────────
  // We read & write biroly_cats + biroly_slots_v2 directly, then dispatch
  // biroly-state-updated so the Biroly tab's left column (biroly.js listener
  // wired up earlier) re-reads LS and re-renders. Server sync mirrors what
  // biroly.js does on its own state changes.
  function _readBirolyLibrary() {
    let cats = [], slots = {};
    try { cats  = JSON.parse(localStorage.getItem('biroly_cats') || '[]'); } catch {}
    try { slots = JSON.parse(localStorage.getItem('biroly_slots_v2') || '{}'); } catch {}
    if (!Array.isArray(cats)) cats = [];
    if (!slots || typeof slots !== 'object') slots = {};
    return { cats, slots };
  }
  function _writeBirolyLibrary(cats, slots) {
    try { localStorage.setItem('biroly_cats',     JSON.stringify(cats)); }  catch {}
    try { localStorage.setItem('biroly_slots_v2', JSON.stringify(slots)); } catch {}
    try { window.dispatchEvent(new CustomEvent('biroly-state-updated')); } catch {}
    fetch('/api/biroly/state', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cats, slots }),
    }).catch(() => {});
  }
  function _createBirolyCategory(label) {
    const { cats, slots } = _readBirolyLibrary();
    const id = 'cat_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    const cat = { id, label: String(label).slice(0, 60), systemPrompt: '' };
    cats.unshift(cat);
    _writeBirolyLibrary(cats, slots);
    return cat;
  }
  // Creates the slot in biroly_slots_v2. Returns {id, name} for the caller
  // to remember (so the lightbox can show "✓ saved as <name>").
  function _saveBirolySlot({ name, prompt, categoryId, sourceVideo }) {
    const { cats, slots } = _readBirolyLibrary();
    const id = 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    const slotName = String(name || 'untitled').slice(0, 80);
    slots[id] = {
      id, categoryId,
      emoji:       '🎬',
      name:        slotName,
      prompt,
      selections:  [],
      createdAt:   Date.now(),
      sourceVideo: sourceVideo || null,
    };
    _writeBirolyLibrary(cats, slots);
    return { id, name: slotName };
  }

  // Active popup state — single-instance modal. null when closed.
  let _state = null;

  // Examples library viewer — browse / copy / delete saved b-roll idea prompts.
  async function _openExamplesViewer() {
    document.getElementById('biroly-ex-overlay')?.remove();
    const ov = document.createElement('div');
    ov.id = 'biroly-ex-overlay';
    ov.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;font-family:Tahoma,sans-serif;';
    ov.addEventListener('mousedown', e => { if (e.target === ov) ov.remove(); });
    const box = document.createElement('div');
    box.style.cssText = 'background:#f0f0f0;border:1.5px solid #888;border-radius:6px;width:min(92vw,520px);max-height:84vh;display:flex;flex-direction:column;box-shadow:0 8px 40px rgba(0,0,0,.5);';
    box.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;padding:7px 11px;background:#e0e0e0;border-bottom:1.5px solid #bbb;border-radius:6px 6px 0 0;"><b style="font-size:12px;">📚 Examples — ' + _escapeHtml((_state && _state.verticalLabel) || 'all') + '</b></div>';
    const listWrap = document.createElement('div');
    listWrap.style.cssText = 'padding:8px 10px;overflow-y:auto;display:flex;flex-direction:column;gap:6px;';
    box.appendChild(listWrap);
    const foot = document.createElement('div'); foot.style.cssText = 'padding:6px 10px;border-top:1px solid #ccc;display:flex;';
    const closeB = document.createElement('button'); closeB.textContent = 'Close'; closeB.style.cssText = 'margin-left:auto;font-size:10px;padding:3px 12px;cursor:pointer;';
    closeB.onclick = () => ov.remove(); foot.appendChild(closeB); box.appendChild(foot);
    ov.appendChild(box); document.body.appendChild(ov);

    listWrap.textContent = 'Loading…';
    let list = [];
    const vq = (_state && _state.vertical) ? ('?vertical=' + encodeURIComponent(_state.vertical)) : '';
    try { const d = await (await fetch('/api/biroly/idea-examples' + vq)).json(); list = (d && d.list) || []; } catch {}
    listWrap.innerHTML = '';
    if (!list.length) {
      const e = document.createElement('div');
      e.style.cssText = 'color:#777;font-size:10px;font-style:italic;padding:14px;text-align:center;';
      e.textContent = 'No saved examples yet. Click “＋ example” on any generated idea to add one.';
      listWrap.appendChild(e); return;
    }
    list.forEach(ex => {
      const c = document.createElement('div');
      c.style.cssText = 'border:1px solid #ccc;background:#fff;border-radius:4px;padding:5px 7px;display:flex;flex-direction:column;gap:3px;';
      const top = document.createElement('div'); top.style.cssText = 'display:flex;align-items:baseline;gap:6px;font-size:10px;';
      top.innerHTML = `<b style="flex:1;">${_escapeHtml(ex.title || 'Example')}</b><span style="color:#888;font-size:9px;">${_escapeHtml(ex.category || '')}${ex.intensity ? ' · int ' + ex.intensity : ''}</span>`;
      c.appendChild(top);
      const p = document.createElement('div'); p.style.cssText = 'font-size:9px;color:#333;line-height:1.35;white-space:pre-wrap;'; p.textContent = ex.prompt || ''; c.appendChild(p);
      const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:6px;';
      const copyB = document.createElement('button'); copyB.textContent = '📋 copy'; copyB.style.cssText = 'font-size:9px;padding:1px 7px;cursor:pointer;';
      copyB.onclick = () => { try { navigator.clipboard.writeText(ex.prompt || ''); copyB.textContent = '✓'; setTimeout(() => { copyB.textContent = '📋 copy'; }, 1000); } catch {} };
      const delB = document.createElement('button'); delB.textContent = '🗑'; delB.title = 'Delete example'; delB.style.cssText = 'font-size:9px;padding:1px 7px;cursor:pointer;color:#a33;margin-left:auto;';
      delB.onclick = async () => { delB.disabled = true; try { await fetch('/api/biroly/idea-examples/' + encodeURIComponent(ex.id), { method: 'DELETE' }); c.remove(); } catch { delB.disabled = false; } };
      row.appendChild(copyB); row.appendChild(delB); c.appendChild(row);
      listWrap.appendChild(c);
    });
  }

  window.openBirolyIdeasPopup = function (opts) {
    opts = opts || {};
    if (_state) _close();   // re-clicking the button while open just re-renders fresh
    _state = {
      overlay:               null,
      escHandler:            null,
      scenarioBuckets:       _collectScenarioBuckets(),   // Map<scenFile, sessionKey[]>
      selectedScenarioFile:  null,
      lockScenFile:          opts.scenFile || null,        // when set: lock to this scenario, hide the selector
      lockText:              opts.scenarioText || null,    // raw monologue text (sv2 projects have no .txt file)
      lockProjectName:       opts.projectName || null,     // display name for the locked project
      intensity:             _readIntensity(),             // 1-10, default 6, persisted

      // Step 4 additions:
      // ideasByScene: { sceneNum: [idea1?, idea2?, idea3?] } — each idea slot
      //   is filled when its batch (1/2/3) returns. Cards render progressively.
      ideasByScene:          {},
      activeIdxByScene:      {},   // sceneNum → 0|1|2 — which batch's card is visible
      sceneIntensity:        {},   // sceneNum → 1-10 — per-scene intensity used by Remake
      hintsByScene:          {},   // sceneNum → user's seed idea/hint (steers generation)
      lineByScene:           {},   // sceneNum → scenario line text (review view, before ideas)
      vertical:              '',   // active vertical id (slug) — keys examples + (later) prompts
      verticalLabel:         '',   // active vertical label (from the scenario)
      sceneCount:            0,
      analysing:             false,
      analyseConfirmArmed:   false, // twice-click confirm for re-analyse
      batchesDone:           0,     // counter for progress in status line

      // Refs filled during _build:
      analyzeBtn:            null,
      statusEl:              null,
      ideasGridEl:           null,
    };
    // Pick selected scenario. When opened from a project (lockScenFile), use that
    // scenario directly. Otherwise: persisted lastScenario if still present, else first.
    const persisted = _readPersistedState();
    const bucketKeys = [..._state.scenarioBuckets.keys()];
    if (_state.lockScenFile) {
      _state.selectedScenarioFile = _state.lockScenFile;
    } else if (persisted.lastScenario && bucketKeys.includes(persisted.lastScenario)) {
      _state.selectedScenarioFile = persisted.lastScenario;
    } else {
      _state.selectedScenarioFile = bucketKeys[0] || null;
    }
    // Load that scenario's previously-generated ideas (if any) so the grid
    // appears immediately on open without re-running Analyze.
    if (_state.selectedScenarioFile) {
      _loadScenarioSnapshot(_state.selectedScenarioFile);
    }
    // Locked from a project → pre-populate the scene list from the live monologue so
    // the user can read the lines + add per-fragment hints BEFORE generating.
    if (_state.lockText) {
      const tl = String(_state.lockText).split('\n').map(l => l.trim()).filter(Boolean);
      _state.lineByScene = {};
      tl.forEach((t, i) => { _state.lineByScene[i + 1] = t; });
      if (tl.length > _state.sceneCount) _state.sceneCount = tl.length;
    }
    // Active vertical — from the scenario (caller) or the last-used one; persisted.
    _state.verticalLabel = (opts.vertical && String(opts.vertical).trim()) || _readVerticalLabel() || 'General';
    _state.vertical = _slug(_state.verticalLabel);
    _writeVerticalLabel(_state.verticalLabel);
    _build();
    // After DOM is mounted, render restored ideas OR the settings-first review view.
    if (Object.keys(_state.ideasByScene).length) {
      _renderIdeaCards();
      _setStatus(`Restored ${_countIdeas()} ideas across ${_state.sceneCount} scenes. Edit hints + click 🔍 Analyze to regenerate.`);
    } else if (_state.lockText) {
      // Settings-first: lines + empty hint fields. The user reads them, optionally
      // writes a seed idea per fragment, then clicks Analyze (no auto-generate).
      _renderIdeaCards();
      _setStatus('Read the lines below. Optionally add your own idea per fragment (💡), then click 🔍 Analyze.');
    }
  };

  // ── Intensity persistence + colour scale ──────────────────────────────────
  function _readIntensity() {
    const v = parseInt(localStorage.getItem(INTENSITY_LS_KEY), 10);
    return (v >= 1 && v <= 10) ? v : 9;   // default → HARD (top of the 4-level scale)
  }
  function _writeIntensity(v) {
    try { localStorage.setItem(INTENSITY_LS_KEY, String(v)); } catch {}
  }

  // ── Active vertical (free-form, taken from the scenario) ──────────────────────
  const VERTICAL_LS_KEY = 'biroly_ideas_vertical_v1';
  function _slug(label) {
    return String(label || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'general';
  }
  function _readVerticalLabel() { try { return localStorage.getItem(VERTICAL_LS_KEY) || ''; } catch { return ''; } }
  function _writeVerticalLabel(label) { try { localStorage.setItem(VERTICAL_LS_KEY, String(label || '')); } catch {} }
  function _intensityMeta(n) {
    const v = Math.max(1, Math.min(10, Number(n) || 6));
    if (v <= 3) return { color: '#5a9c5a', tag: 'CLEAN', text: 'museum-safe metaphors, no edge at all' };
    if (v <= 5) return { color: '#b5b146', tag: 'MILD',  text: 'kitchen close-ups, hands, ingredients, daily life' };
    if (v <= 7) return { color: '#cc8a3a', tag: 'EDGY',  text: 'bathroom silhouettes, sweat, anxiety — no vulgarity' };
    return                         { color: '#c54a4a', tag: 'HARD',  text: 'heavy taboo-adjacent staging (still no nudity / explicit)' };
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  // Collect ⭐ starred AND currently-open-in-Edit sessions, group by scenarioFile.
  // - starred === true             → all talking-head fragments generated (auto-set in scen-edit-panel)
  // - hiddenFromEdit !== true      → user hasn't closed the project card
  // Returned Map preserves insertion order; we insert in newest-first order
  // (by latest session.date within each bucket).
  function _collectScenarioBuckets() {
    const sessions = (typeof editFrozenSessions !== 'undefined')
      ? editFrozenSessions
      : (window.editFrozenSessions || {});
    // Pass 1 — accumulate per scenFile
    const raw = new Map();   // scenFile → { sessionKeys: [], latestDate: number }
    for (const [key, sess] of Object.entries(sessions)) {
      if (!sess) continue;
      if (sess.starred !== true) continue;
      if (sess.hiddenFromEdit === true) continue;
      if (!sess.scenFile) continue;
      if (!raw.has(sess.scenFile)) raw.set(sess.scenFile, { sessionKeys: [], latestDate: 0 });
      const b = raw.get(sess.scenFile);
      b.sessionKeys.push(key);
      const t = new Date(sess.date || 0).getTime();
      if (t > b.latestDate) b.latestDate = t;
    }
    // Pass 2 — sort by latestDate desc, flatten to Map<scenFile, sessionKeys[]>
    const sorted = [...raw.entries()]
      .sort(([, a], [, b]) => b.latestDate - a.latestDate)
      .map(([scenFile, b]) => [scenFile, b.sessionKeys]);
    return new Map(sorted);
  }

  function _build() {
    // ── Backdrop overlay ───────────────────────────────────────────────────
    const ovr = document.createElement('div');
    ovr.id = 'biroly-ideas-overlay';
    ovr.style.cssText = `
      position: fixed; inset: 0; z-index: 99990;
      background: rgba(0, 0, 0, 0.6);
      display: flex; align-items: center; justify-content: center;
      font-family: system-ui, Segoe UI, Roboto, Tahoma, sans-serif;
    `;
    ovr.addEventListener('click', e => { if (e.target === ovr) _close(); });

    // ── Centered popup box (compact) ───────────────────────────────────────
    const box = document.createElement('div');
    box.style.cssText = `
      background: #d4d0c8; color: #111;
      border: 1px solid #555;
      box-shadow: 0 4px 18px rgba(0, 0, 0, 0.45);
      width: 980px; max-width: 96vw; max-height: 92vh; overflow-y: auto;
      padding: 4px; display: flex; flex-direction: column; gap: 4px;
    `;

    // ── Title bar (tiny) ───────────────────────────────────────────────────
    const tb = document.createElement('div');
    tb.style.cssText = `
      display: flex; align-items: center; gap: 4px;
      background: #000080; color: #fff;
      padding: 1px 5px; font-size: 9px; font-weight: bold;
    `;
    tb.innerHTML = '<span style="flex:1;">💡 Ideas — biroly shotlist from a starred scenario</span>';

    const xBtn = document.createElement('button');
    xBtn.textContent = '✕';
    xBtn.title = 'Close';
    xBtn.style.cssText = 'font-size:8px;padding:0 4px;cursor:pointer;line-height:1.3;';
    xBtn.addEventListener('click', _close);
    tb.appendChild(xBtn);
    box.appendChild(tb);

    // ── Body — empty-state OR 2-column row (dropdown left / slider right) ──
    const body = document.createElement('div');
    body.id = 'biroly-ideas-body';

    const entries = [..._state.scenarioBuckets.entries()];
    if (!entries.length && !_state.lockText) {
      // No qualifying projects — friendly hint, full width, no grid.
      // (When opened from a Merge project, lockText carries the monologue → skip this.)
      body.style.cssText = 'padding: 8px 10px;';
      const empty = document.createElement('div');
      empty.style.cssText = 'color:#666;font-size:10px;font-style:italic;text-align:center;padding:20px 10px;line-height:1.4;';
      empty.innerHTML =
        '<div style="font-size:20px;margin-bottom:4px;">📭</div>' +
        'No finished open projects yet.<br>' +
        'Open the <b>Edit</b> tab, generate all talking-head fragments for a project, keep the card open, then come back here.';
      body.appendChild(empty);
    } else {
      // 4-cell control row: dropdown (1fr) | slider (1fr) | Analyze (auto) | ⚙ (auto)
      body.style.cssText = 'padding: 5px 6px; display: flex; flex-direction: column; gap: 4px;';

      const ctrlRow = document.createElement('div');
      ctrlRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr auto auto;gap:6px;align-items:stretch;';

      // ── COL 1 — project dropdown + hint ─────────────────────────────────
      const leftCol = document.createElement('div');
      leftCol.style.cssText = 'display:flex;flex-direction:column;gap:2px;min-width:0;';
      const label = document.createElement('label');
      label.htmlFor = 'biroly-ideas-scenario-select';
      label.style.cssText = 'font-size:9px;font-weight:bold;color:#222;';
      label.textContent = 'Project (⭐ finished + open in Edit, deduped by scenario):';
      leftCol.appendChild(label);
      const sel = document.createElement('select');
      sel.id = 'biroly-ideas-scenario-select';
      sel.style.cssText = 'width:100%;font-size:10px;padding:1px 3px;';
      entries.forEach(([scenFile, sessionKeys]) => {
        const opt = document.createElement('option');
        opt.value = scenFile;
        const niceName = scenFile.replace(/\.txt$/i, '');
        const n = sessionKeys.length;
        opt.textContent = `⭐ ${niceName} (used by ${n} project${n === 1 ? '' : 's'})`;
        sel.appendChild(opt);
      });
      sel.value = _state.selectedScenarioFile;
      // Locked to the open project's scenario → hide the selector, show it as static text.
      if (_state.lockScenFile) {
        sel.style.display = 'none';
        label.textContent = 'Project: ' + String(_state.lockProjectName || _state.lockScenFile).replace(/\.txt$/i, '');
      }
      sel.addEventListener('change', () => {
        // Save the OLD scenario's current snapshot before swapping in case the
        // user just made edits there and wants to come back to them.
        _doPersist();
        _state.selectedScenarioFile = sel.value;
        // Load the NEW scenario's stored snapshot (empty if never analysed).
        _loadScenarioSnapshot(sel.value);
        _renderIdeaCards();
        const n = _countIdeas();
        _setStatus(n
          ? `Restored ${n} ideas across ${_state.sceneCount} scenes for this scenario.`
          : `No saved ideas for this scenario yet — click 🔍 Analyze to generate.`);
        _doPersist();   // bump lastScenario
      });
      leftCol.appendChild(sel);
      const hint = document.createElement('div');
      hint.style.cssText = 'font-size:9px;color:#666;line-height:1.3;';
      hint.textContent = 'A biroll plan generated for a scenario can later be applied to all projects in its bucket.';
      leftCol.appendChild(hint);

      // Active vertical (free-form, auto-filled from the scenario) — examples + (later)
      // prompts are stored per vertical.
      const vRow = document.createElement('div');
      vRow.style.cssText = 'display:flex;align-items:center;gap:4px;margin-top:2px;';
      const vLbl = document.createElement('span'); vLbl.textContent = 'Vertical:'; vLbl.style.cssText = 'font-size:9px;font-weight:bold;color:#222;flex-shrink:0;';
      const vInp = document.createElement('input'); vInp.type = 'text'; vInp.value = _state.verticalLabel || '';
      vInp.title = 'Niche/vertical — examples (and prompts) are stored per vertical. Auto-filled from the scenario.';
      vInp.style.cssText = 'flex:1;min-width:0;font-size:10px;padding:1px 4px;';
      vInp.addEventListener('change', () => {
        _state.verticalLabel = vInp.value.trim() || 'General';
        _state.vertical = _slug(_state.verticalLabel);
        _writeVerticalLabel(_state.verticalLabel);
        vInp.value = _state.verticalLabel;
      });
      vRow.appendChild(vLbl); vRow.appendChild(vInp);
      leftCol.appendChild(vRow);

      ctrlRow.appendChild(leftCol);

      // ── COL 2 — intensity slider ────────────────────────────────────────
      ctrlRow.appendChild(_buildIntensitySection());

      // ── Analyze button ──────────────────────────────────────────────────
      const analyzeBtn = document.createElement('button');
      analyzeBtn.id = 'biroly-ideas-analyze-btn';
      analyzeBtn.textContent = '🔍 Analyze';
      analyzeBtn.title = 'LLM analyses the scenario and produces 3 b-roll ideas per scene (3 parallel batches)';
      analyzeBtn.style.cssText = 'padding:0 10px;font-size:10px;font-weight:bold;cursor:pointer;background:#90c090;border:1px solid #5a8a5a;align-self:stretch;min-width:80px;';
      analyzeBtn.addEventListener('click', () => _handleAnalyzeClick(analyzeBtn));
      _state.analyzeBtn = analyzeBtn;
      ctrlRow.appendChild(analyzeBtn);

      // ── COL 4 — ⚙ Settings button ────────────────────────────────────────
      const gearBtn = document.createElement('button');
      gearBtn.textContent = '⚙';
      gearBtn.title = 'Settings — per-vertical metaphor lexicons for the METAPHOR batch';
      gearBtn.style.cssText = 'padding:0 6px;font-size:11px;cursor:pointer;align-self:stretch;';
      gearBtn.addEventListener('click', _openSettings);
      ctrlRow.appendChild(gearBtn);

      body.appendChild(ctrlRow);

      // ── Status line (full width, under controls) ────────────────────────
      const status = document.createElement('div');
      status.id = 'biroly-ideas-status';
      status.style.cssText = 'font-size:9px;color:#555;min-height:12px;padding:1px 3px;';
      _state.statusEl = status;
      body.appendChild(status);

      // ── Ideas grid container (filled progressively as batches return) ───
      const ideasGrid = document.createElement('div');
      ideasGrid.id = 'biroly-ideas-grid';
      ideasGrid.style.cssText = 'display:flex;flex-direction:column;gap:3px;';
      _state.ideasGridEl = ideasGrid;
      body.appendChild(ideasGrid);
    }
    box.appendChild(body);

    ovr.appendChild(box);
    document.body.appendChild(ovr);
    _state.overlay = ovr;

    // ── ESC closes ─────────────────────────────────────────────────────────
    _state.escHandler = (e) => { if (e.key === 'Escape') _close(); };
    document.addEventListener('keydown', _state.escHandler);
  }

  // ── Intensity slider section ──────────────────────────────────────────────
  // Top row: "Intensity:" label + big colored number + colored dot.
  // Middle: the <input type="range">.
  // Bottom: dynamic descriptive label that updates on every input event.
  // Writes back into _state.intensity + localStorage on every move so the
  // value survives popup close/reopen.
  // 4-level intensity scale (mirrors the scenario taboo ladder). Each button maps
  // to a representative 1-10 value the /ideas-from-scenario endpoint already bands.
  const _INTENSITY_LEVELS = [
    { tag: 'CLEAN', val: 2, color: '#5a9c5a' },
    { tag: 'MILD',  val: 5, color: '#b5b146' },
    { tag: 'EDGY',  val: 7, color: '#cc8a3a' },
    { tag: 'HARD',  val: 9, color: '#c54a4a' },
  ];
  function _buildIntensitySection() {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:3px;padding:3px 6px;background:#c8c5be;border:1px solid #999;';

    const top = document.createElement('div');
    top.style.cssText = 'display:flex;align-items:center;gap:5px;font-size:9px;';
    const labelTxt = document.createElement('span');
    labelTxt.style.cssText = 'font-weight:bold;color:#222;';
    labelTxt.textContent = 'Intensity:';
    top.appendChild(labelTxt);
    wrap.appendChild(top);

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:grid;grid-template-columns:repeat(4,1fr);gap:3px;';
    const desc = document.createElement('div');
    desc.style.cssText = 'font-size:9px;color:#444;font-style:italic;min-height:12px;line-height:1.2;';

    const btns = [];
    function _paint() {
      const curTag = _intensityMeta(_state.intensity).tag;
      btns.forEach(({ b, lvl }) => {
        const on = lvl.tag === curTag;
        b.style.background  = on ? lvl.color : '#e8e6e0';
        b.style.color       = on ? '#fff' : '#555';
        b.style.fontWeight  = on ? 'bold' : 'normal';
        b.style.borderColor = on ? lvl.color : '#999';
      });
      desc.textContent = _intensityMeta(_state.intensity).text;
    }
    _INTENSITY_LEVELS.forEach(lvl => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = lvl.tag;
      b.style.cssText = 'font-size:9px;padding:3px 2px;cursor:pointer;border:1px solid #999;border-radius:3px;letter-spacing:0.03em;';
      b.addEventListener('click', () => { _state.intensity = lvl.val; _writeIntensity(lvl.val); _paint(); });
      btnRow.appendChild(b);
      btns.push({ b, lvl });
    });
    wrap.appendChild(btnRow);
    wrap.appendChild(desc);
    _paint();
    return wrap;
  }

  // ── Status helper ──────────────────────────────────────────────────────────
  function _setStatus(text, isError) {
    if (!_state?.statusEl) return;
    _state.statusEl.textContent = text || '';
    _state.statusEl.style.color = isError ? '#a33' : '#555';
  }

  // ── ↻ Refresh — re-detect starred sessions + reload persisted snapshot ───
  // Cleanest implementation: force-flush any pending debounced persist (so
  // unsaved textarea edits don't die), then close & reopen the popup. The
  // open path already restores the active scenario's snapshot from LS.
  function _handleRefresh() {
    if (_persistTimer) {
      clearTimeout(_persistTimer);
      _persistTimer = null;
      _doPersist();
    }
    _close();
    window.openBirolyIdeasPopup();
  }

  // ── Analyze click: twice-click confirm when ideas already exist ───────────
  // First click on a fresh popup → runs analyse.
  // First click when ideas already loaded → button arms red ("Click again to
  // re-analyse"), 3-second self-disarm timer.
  // Second click while armed → confirms, wipes state, runs analyse.
  let _confirmTimer = null;
  function _handleAnalyzeClick(btn) {
    if (_state.analysing) return;   // mid-flight, ignore
    const hasData = Object.keys(_state.ideasByScene).length > 0;
    if (hasData && !_state.analyseConfirmArmed) {
      _state.analyseConfirmArmed = true;
      btn.textContent = '⚠ Click again to re-analyse';
      btn.style.background = '#d96a6a';
      btn.style.borderColor = '#9a4040';
      _confirmTimer = setTimeout(() => {
        _state.analyseConfirmArmed = false;
        btn.textContent = '🔍 Analyze';
        btn.style.background = '#90c090';
        btn.style.borderColor = '#5a8a5a';
      }, 3000);
      return;
    }
    if (_confirmTimer) { clearTimeout(_confirmTimer); _confirmTimer = null; }
    _state.analyseConfirmArmed = false;
    btn.style.background = '#90c090';
    btn.style.borderColor = '#5a8a5a';
    _runAnalyse(btn);
  }

  // ── 3 parallel batched LLM calls — render as each returns ──────────────────
  async function _runAnalyse(btn) {
    const scenarioFile = _state.selectedScenarioFile;
    if (!scenarioFile && !_state.lockText) { _setStatus('Pick a project first', true); return; }

    // Reset state for fresh run
    _state.analysing = true;
    _state.ideasByScene = {};
    _state.activeIdxByScene = {};
    _state.sceneIntensity = {};
    _state.batchesDone = 0;
    _state.ideasGridEl.innerHTML = '';
    _persistState();   // wipe the persisted snapshot for this scenario too
    btn.disabled = true;
    btn.textContent = '⏳ Analysing…';
    _setStatus(`LLM analysing (Hermes 3 Llama) — 3 parallel batches, 1 idea/scene each. Ideas appear as batches finish (~30-60s each)…`);

    const intensity = _state.intensity;
    // Niche lexicon applies to ALL three batches — the vertical's visual
    // vocabulary colours literal, metaphoric, and kinetic shots alike.
    const metaphor = _metaphorPayload();
    // Each batch — independent fetch, immediate render on completion.
    const batches = [1, 2, 3].map(batchNum => {
      const payload = { scenarioFile, intensity, batch: batchNum };
      if (_state.lockText) payload.scenarioText = _state.lockText;   // sv2: analyze the live monologue
      if (_state.hintsByScene && Object.values(_state.hintsByScene).some(h => h && String(h).trim())) payload.hints = _state.hintsByScene;
      if (_state.vertical) payload.vertical = _state.vertical;       // per-vertical prompt + few-shot examples
      if (metaphor) payload.metaphor = metaphor;
      return fetch('/api/biroly/ideas-from-scenario', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
        .then(r => r.json())
        .then(d => {
          if (!d.success) throw new Error(d.error || `batch ${batchNum} failed`);
          _ingestBatch(batchNum, d.ideas || [], d.sceneCount || 0);
          _state.batchesDone++;
          const total = _countIdeas();
          _setStatus(`Batch ${batchNum}/3 done · ${total} ideas across ${_state.sceneCount} scenes so far…`);
        })
        .catch(e => {
          _state.batchesDone++;
          _setStatus(`Batch ${batchNum}/3 failed: ${e.message}. Other batches still running.`, true);
        });
    });
    await Promise.allSettled(batches);
    _state.analysing = false;
    btn.disabled = false;
    btn.textContent = '🔍 Analyze';
    const total = _countIdeas();
    if (total === 0) {
      _setStatus(`All 3 batches failed. Check the .env keys (OPENROUTER / KIE / REPLICATE) and try again.`, true);
    } else {
      _setStatus(`Done — ${total} ideas across ${_state.sceneCount} scenes. Edit any prompt below, use ◀ N/3 ▶ to flip between batches, click ↻ Remake for a fresh alternative.`);
    }
  }

  function _ingestBatch(batchNum, ideas, sceneCount) {
    if (sceneCount > _state.sceneCount) _state.sceneCount = sceneCount;
    ideas.forEach(idea => {
      const sc = idea.scene;
      if (!_state.ideasByScene[sc]) _state.ideasByScene[sc] = [null, null, null];
      _state.ideasByScene[sc][batchNum - 1] = idea;
      // Default visible card = first finished batch
      if (_state.activeIdxByScene[sc] == null) _state.activeIdxByScene[sc] = batchNum - 1;
    });
    _renderIdeaCards();
    _persistState();
  }
  function _countIdeas() {
    return Object.values(_state.ideasByScene)
      .reduce((acc, arr) => acc + arr.filter(Boolean).length, 0);
  }

  // ── Render one card per scene, content = active idea index for that scene ─
  function _renderIdeaCards() {
    if (!_state.ideasGridEl) return;
    _state.ideasGridEl.innerHTML = '';
    const set = new Set();
    Object.keys(_state.ideasByScene).forEach(k => set.add(Number(k)));
    Object.keys(_state.lineByScene || {}).forEach(k => set.add(Number(k)));
    const sceneNums = [...set].filter(n => n > 0).sort((a, b) => a - b);
    for (const sc of sceneNums) {
      _state.ideasGridEl.appendChild(_buildSceneCard(sc));
    }
  }

  let _spinCssDone = false;
  function _ensureSpinCss() {
    if (_spinCssDone) return; _spinCssDone = true;
    try { const st = document.createElement('style'); st.textContent = '@keyframes biroly-ideas-spin{to{transform:rotate(360deg)}}'; document.head.appendChild(st); } catch {}
  }

  // One scene card: LEFT column (line + your-idea · prompt · controls) + RIGHT
  // thumbnail of the latest generated b-roll (spinner while generating; click → lightbox).
  function _buildSceneCard(sceneNum) {
    const slot = _state.ideasByScene[sceneNum] || [null, null, null];
    const activeIdx = _state.activeIdxByScene[sceneNum] ?? slot.findIndex(Boolean);
    const idea = slot[activeIdx] || slot.find(Boolean) || null;

    // 4px coloured left stripe shows the intensity the LLM actually GAVE
    // this idea (from idea.intensity in the response), not the per-scene
    // slider value. So flipping ◀ ▶ between batches recolours the stripe to
    // match what's displayed; Remake recolours too once the new idea lands.
    // Pending cards (no idea yet) use a neutral grey.
    const borderColor = idea ? _intensityMeta(idea.intensity).color : '#999';
    const card = document.createElement('div');
    card.dataset.scene = String(sceneNum);
    card.style.cssText =
      `border:1px solid #888;border-left:4px solid ${borderColor};` +
      'background:#e6e3dd;padding:4px;display:flex;flex-direction:row;gap:6px;align-items:stretch;';

    // LEFT column (row 1: line + your-idea · row 2: prompt · row 3: controls)
    const left = document.createElement('div');
    left.style.cssText = 'flex:1;min-width:0;display:flex;flex-direction:column;gap:3px;';

    // RIGHT thumbnail — latest generated b-roll; spinner while generating; click → lightbox.
    const thumb = document.createElement('div');
    thumb.title = 'Latest generated b-roll — click to open';
    thumb.style.cssText = 'flex:0 0 100px;width:100px;align-self:stretch;min-height:92px;border:1px solid #999;border-radius:4px;background:#141414;position:relative;overflow:hidden;cursor:pointer;display:flex;align-items:center;justify-content:center;';
    function _paintThumb() {
      thumb.innerHTML = '';
      if (idea && idea.generating) {
        _ensureSpinCss();
        const sp = document.createElement('div');
        sp.style.cssText = 'width:26px;height:26px;border:3px solid #555;border-top-color:#7fd1ff;border-radius:50%;animation:biroly-ideas-spin .8s linear infinite;';
        thumb.appendChild(sp); return;
      }
      try { _normalizeVideoEntries(idea || {}); } catch {}
      const vids = (idea && idea.generatedVideos) || [];
      const last = vids.length ? vids[vids.length - 1] : null;
      if (last && last.videoPath) {
        const v = document.createElement('video');
        v.src = last.videoPath; v.muted = true; v.playsInline = true; v.preload = 'metadata'; v.loop = true;
        v.style.cssText = 'width:100%;height:100%;object-fit:cover;';
        v.addEventListener('mouseenter', () => { try { v.play(); } catch {} });
        v.addEventListener('mouseleave', () => { try { v.pause(); } catch {} });
        thumb.appendChild(v);
        const badge = document.createElement('div'); badge.textContent = '▶ ' + vids.length;
        badge.style.cssText = 'position:absolute;left:3px;bottom:3px;background:rgba(0,0,0,0.6);color:#fff;font-size:9px;padding:0 4px;border-radius:3px;';
        thumb.appendChild(badge);
      } else {
        const e = document.createElement('div'); e.style.cssText = 'color:#777;font-size:9px;text-align:center;padding:4px;'; e.textContent = idea ? 'no clip yet' : '—';
        thumb.appendChild(e);
      }
    }
    thumb.addEventListener('click', () => { if (!idea) return; try { _normalizeVideoEntries(idea); } catch {} if ((idea.generatedVideos || []).length) _openVideoLightbox(idea, sceneNum, activeIdx); });

    // Header: scene number + source line
    const hdr = document.createElement('div');
    hdr.style.cssText = 'display:flex;align-items:baseline;gap:5px;font-size:9px;';
    hdr.innerHTML = `<b>S${sceneNum}</b>`;
    const lineTxt = document.createElement('span');
    lineTxt.style.cssText = 'color:#444;flex:1;min-width:0;white-space:normal;line-height:1.25;';
    const _lineSrc = (_state.lineByScene && _state.lineByScene[sceneNum]) || (idea && idea.lineText) || '';
    lineTxt.textContent = _lineSrc;
    lineTxt.title = _lineSrc;
    hdr.appendChild(lineTxt);
    left.appendChild(hdr);

    // Per-fragment seed hint — the analyzer builds THIS scene's idea around it.
    const hintTa = document.createElement('textarea');
    hintTa.value = (_state.hintsByScene && _state.hintsByScene[sceneNum]) || '';
    hintTa.placeholder = '💡 your idea / hint (optional)';
    hintTa.style.cssText = 'width:100%;min-height:22px;font-size:9px;padding:2px 4px;box-sizing:border-box;resize:vertical;font-family:inherit;line-height:1.3;background:#fffdf3;border:1px solid #cdbb6a;';
    hintTa.addEventListener('input', () => {
      if (!_state.hintsByScene) _state.hintsByScene = {};
      _state.hintsByScene[sceneNum] = hintTa.value;
      _persistState();
    });
    left.appendChild(hintTa);

    if (!idea) {
      const pending = document.createElement('div');
      pending.style.cssText = 'color:#888;font-size:9px;font-style:italic;padding:3px;';
      pending.textContent = _state.analysing ? '⏳ waiting for batch…' : '— no idea yet — add a hint above (optional), then Analyze';
      left.appendChild(pending);
      card.appendChild(left); _paintThumb(); card.appendChild(thumb);
      return card;
    }

    // Title + intensity tag + batch tag
    const tagRow = document.createElement('div');
    tagRow.style.cssText = 'display:flex;align-items:baseline;gap:5px;font-size:9px;color:#555;flex-wrap:wrap;';
    const batchTag = idea.batch === 1 ? 'LITERAL' : idea.batch === 2 ? 'METAPHOR' : 'ENERGY';
    tagRow.innerHTML =
      `<b style="color:#222;font-size:10px;">${_escapeHtml(idea.title)}</b>` +
      ` · <span>int ${idea.intensity}</span>` +
      ` · <span style="font-weight:bold;color:#444;">b${idea.batch} ${batchTag}</span>` +
      ` · <span>${_escapeHtml(idea.category_hint || '—')}</span>` +
      ` · <span>${idea.reusable ? '♻' : 'tied'}</span>` +
      ` · <span>${BIROLY_DURATION_SEC}s</span>`;
    left.appendChild(tagRow);

    // Editable PROMPT textarea (single source of truth for user edits)
    const promptArea = document.createElement('textarea');
    promptArea.value = idea.prompt;
    promptArea.title = 'Edit the prompt — your edits are sent to Grok t2v and to Remake when you click those buttons';
    promptArea.style.cssText = 'width:100%;min-height:38px;font-size:10px;padding:2px 4px;box-sizing:border-box;resize:vertical;font-family:inherit;line-height:1.3;';
    promptArea.addEventListener('input', () => {
      idea.prompt = promptArea.value;
      _persistState();   // debounced under the hood (300ms)
    });
    left.appendChild(promptArea);

    // Row 3 — controls: ▶ Gen t2v · ↻ Remake · ＋ example · ✕ discard
    const bottom = document.createElement('div');
    bottom.style.cssText = 'display:flex;align-items:center;gap:4px;font-size:9px;flex-wrap:wrap;';

    _normalizeVideoEntries(idea);
    const vN = (idea.generatedVideos || []).length;
    const genBtn = document.createElement('button');
    genBtn.style.cssText = 'padding:0 7px;cursor:pointer;font-size:9px;line-height:1.4;';
    if (idea.generating) { genBtn.textContent = '⏳'; genBtn.disabled = true; }
    else if (idea.videoError) { genBtn.textContent = '⚠ retry'; genBtn.style.background = '#fdd'; genBtn.style.color = '#a33'; genBtn.title = 'Last gen failed: ' + idea.videoError; }
    else if (vN > 0) { genBtn.textContent = '▶ Gen another'; genBtn.title = `Generate one more take (appends to the ${vN}-clip history); the preview shows the newest.`; }
    else { genBtn.textContent = '▶ Gen t2v'; genBtn.title = `Submit the current prompt to Grok t2v (${BIROLY_DURATION_SEC}s, 9:16, 480p)`; }
    genBtn.addEventListener('click', () => { if (idea.generating) return; _handleGenT2V(sceneNum, activeIdx); });
    bottom.appendChild(genBtn);

    const remakeBtn = document.createElement('button');
    remakeBtn.textContent = '↻ Remake';
    remakeBtn.title = 'Regenerate THIS scene’s idea from the current text at the current (global) intensity';
    remakeBtn.style.cssText = 'padding:0 7px;cursor:pointer;font-size:9px;line-height:1.4;';
    remakeBtn.addEventListener('click', () => _handleRemake(sceneNum, activeIdx, remakeBtn));
    bottom.appendChild(remakeBtn);

    const exBtn = document.createElement('button');
    exBtn.textContent = '＋ example';
    exBtn.title = 'Save this idea to the b-roll examples library (this vertical)';
    exBtn.style.cssText = 'padding:0 6px;cursor:pointer;font-size:9px;line-height:1.4;';
    exBtn.addEventListener('click', async () => {
      const old = exBtn.textContent; exBtn.disabled = true; exBtn.textContent = '…';
      try {
        const r = await fetch('/api/biroly/idea-examples', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: idea.title, prompt: promptArea.value, category: idea.category_hint, intensity: idea.intensity, vertical: _state.vertical }),
        });
        const d = await r.json();
        exBtn.textContent = (d && d.success) ? '✓ saved' : '✗';
      } catch { exBtn.textContent = '✗'; }
      setTimeout(() => { exBtn.textContent = old; exBtn.disabled = false; }, 1400);
    });
    bottom.appendChild(exBtn);

    const spacer = document.createElement('span'); spacer.style.cssText = 'flex:1;'; bottom.appendChild(spacer);

    const discardBtn = document.createElement('button');
    discardBtn.textContent = '✕';
    discardBtn.title = 'Discard this scene from the plan';
    discardBtn.style.cssText = 'padding:0 6px;cursor:pointer;font-size:9px;line-height:1.4;color:#a33;';
    discardBtn.addEventListener('click', () => _handleDiscard(sceneNum));
    bottom.appendChild(discardBtn);

    left.appendChild(bottom);
    card.appendChild(left);
    _paintThumb();
    card.appendChild(thumb);
    return card;
  }

  function _flipBatch(sceneNum, delta) {
    const slot = _state.ideasByScene[sceneNum] || [];
    const cur = _state.activeIdxByScene[sceneNum] ?? 0;
    // Wrap 0..2; skip empty slots (batch not done yet)
    let next = cur;
    for (let i = 0; i < 3; i++) {
      next = (next + delta + 3) % 3;
      if (slot[next]) break;
    }
    if (next === cur) return;
    _state.activeIdxByScene[sceneNum] = next;
    _renderIdeaCards();
    _persistState();
  }

  function _handleDiscard(sceneNum) {
    delete _state.ideasByScene[sceneNum];
    delete _state.activeIdxByScene[sceneNum];
    delete _state.sceneIntensity[sceneNum];
    _renderIdeaCards();
    _persistState();
  }

  // Remake: send the CURRENT textarea text (idea.prompt is kept in-sync on
  // input) + scene line + intensity to /idea-remake. Replace the active slot
  // with the returned fresh idea.
  // ── T2V generation per idea (Grok text-to-video, 6s, 480p, 9:16) ─────────
  // Reads the CURRENT prompt out of the idea object (kept in sync with the
  // textarea via its input listener), submits to /api/video/grok-text, polls
  // /status/<taskId> until success/failure/timeout. The result mp4 path lives
  // on idea.generatedVideo and persists across reloads through ideasByScene.
  async function _handleGenT2V(sceneNum, activeIdx) {
    const slot = _state.ideasByScene[sceneNum];
    const idea = slot?.[activeIdx];
    if (!idea) return;
    if (idea.generating) return;
    if (!idea.prompt || idea.prompt.trim().length < 20) {
      _setStatus(`Scene ${sceneNum} prompt too short — write something first`, true);
      return;
    }
    idea.generating = true;
    idea.videoError = null;
    _renderIdeaCards();
    _setStatus(`Scene ${sceneNum} — submitting to Grok t2v (${BIROLY_DURATION_SEC}s)…`);
    try {
      const r = await fetch('/api/video/grok-text', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt:      idea.prompt.trim(),
          duration:    String(BIROLY_DURATION_SEC),
          resolution:  '480p',
          aspectRatio: '9:16',
          mode:        'normal',
          birolMode:   true,   // append "bright punchy contrast …" visual-boost clause server-side
        }),
      });
      const d = await r.json();
      if (!d.success || !d.taskId) throw new Error(d.error || 'no taskId returned');
      _setStatus(`Scene ${sceneNum} — Grok rendering (~30-90s)…`);
      // Capture the exact prompt being sent to Grok so the lightbox + save
      // dialog later can show / store the prompt that produced THIS clip,
      // not whatever the user has typed in the textarea since.
      const promptSnapshot = idea.prompt.trim();
      const intensitySnapshot = idea.intensity;
      const videoPath = await _pollGrokText(d.taskId);
      // Append a structured entry to the history — DON'T replace.
      _normalizeVideoEntries(idea);
      idea.generatedVideos.push({
        videoPath,
        promptUsed:  promptSnapshot,
        intensity:   intensitySnapshot,
        generatedAt: Date.now(),
      });
      delete idea.generatedVideo;
      idea.generating = false;
      _renderIdeaCards();
      _persistState();
      _setStatus(`Scene ${sceneNum} ✓ ${videoPath.split('/').pop()} (${idea.generatedVideos.length} total)`);
    } catch (e) {
      idea.generating = false;
      idea.videoError = e.message || 'gen failed';
      _renderIdeaCards();
      _persistState();
      _setStatus(`Scene ${sceneNum} gen error: ${e.message}`, true);
    }
  }
  function _pollGrokText(taskId) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const iv = setInterval(async () => {
        if (Date.now() - start > 5 * 60 * 1000) {
          clearInterval(iv); return reject(new Error('Grok poll timeout (5 min)'));
        }
        try {
          const r = await fetch(`/api/video/grok-text/status/${taskId}`);
          const d = await r.json();
          if (d.success && d.state === 'success' && d.videoPath) {
            clearInterval(iv); return resolve(d.videoPath);
          }
          if (d.state === 'failed' || (d.success === false && d.error)) {
            clearInterval(iv); return reject(new Error(d.error || d.failMsg || 'Grok failed'));
          }
        } catch {
          // Tolerate one-off poll errors — the next tick retries.
        }
      }, 3000);
    });
  }
  // Lightbox now takes (idea, sceneNum, activeIdx) so it can:
  //  • show each clip's captured promptUsed under the video
  //  • host a 💾 Save-to-library button per clip
  //  • show "✓ saved as <name>" for clips already in the library
  // Opens on the LAST (newest) clip. ◀ M/N ▶ + ← → keys flip; ESC/backdrop close.
  function _openVideoLightbox(idea, sceneNum, activeIdx) {
    _normalizeVideoEntries(idea);
    const list = idea.generatedVideos;
    if (!list.length) return;
    if (!idea.savedVideoIds) idea.savedVideoIds = {};
    let idx = list.length - 1;   // start at newest

    const ovr = document.createElement('div');
    ovr.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,0.88);z-index:99996;' +
      'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;cursor:zoom-out;';
    ovr.addEventListener('click', e => { if (e.target === ovr) _closeLb(); });

    const v = document.createElement('video');
    v.controls = true; v.autoplay = true; v.playsInline = true; v.loop = true;
    v.style.cssText = 'max-width:90vw;max-height:62vh;background:#000;cursor:default;';
    ovr.appendChild(v);

    // ── Nav row: ◀ N/M ▶ + hint ────────────────────────────────────────
    const nav = document.createElement('div');
    nav.style.cssText = 'display:flex;align-items:center;gap:10px;color:#fff;font-size:11px;background:rgba(0,0,0,0.55);padding:3px 10px;border-radius:4px;cursor:default;';
    nav.addEventListener('click', e => e.stopPropagation());
    const prev = document.createElement('button');
    prev.textContent = '◀';
    prev.title = 'Previous clip (← arrow)';
    prev.style.cssText = 'padding:2px 10px;cursor:pointer;font-size:11px;';
    const counter = document.createElement('span');
    counter.style.cssText = 'min-width:50px;text-align:center;font-weight:bold;';
    const next = document.createElement('button');
    next.textContent = '▶';
    next.title = 'Next clip (→ arrow)';
    next.style.cssText = 'padding:2px 10px;cursor:pointer;font-size:11px;';
    const hint = document.createElement('span');
    hint.style.cssText = 'opacity:0.7;font-size:10px;font-style:italic;';
    hint.textContent = 'showing newest first · ←/→ to flip · ESC to close';
    nav.appendChild(prev);
    nav.appendChild(counter);
    nav.appendChild(next);
    nav.appendChild(hint);
    ovr.appendChild(nav);

    // ── Prompt preview block (read-only) ──────────────────────────────
    const pBlock = document.createElement('div');
    pBlock.style.cssText = 'color:#fff;background:rgba(0,0,0,0.5);padding:6px 12px;border-radius:4px;max-width:780px;width:90vw;cursor:default;';
    pBlock.addEventListener('click', e => e.stopPropagation());
    const pLbl = document.createElement('div');
    pLbl.style.cssText = 'font-size:10px;font-weight:bold;color:#aaa;margin-bottom:3px;letter-spacing:0.02em;';
    pLbl.textContent = 'PROMPT USED FOR THIS CLIP';
    pBlock.appendChild(pLbl);
    const pTxt = document.createElement('div');
    pTxt.style.cssText = 'font-size:11px;line-height:1.4;max-height:72px;overflow-y:auto;color:#eee;';
    pBlock.appendChild(pTxt);
    ovr.appendChild(pBlock);

    // ── Save row + per-clip Delete ───────────────────────────────────
    const saveRow = document.createElement('div');
    saveRow.style.cssText = 'display:flex;align-items:center;gap:10px;color:#fff;background:rgba(0,0,0,0.55);padding:5px 12px;border-radius:4px;font-size:11px;cursor:default;';
    saveRow.addEventListener('click', e => e.stopPropagation());
    const saveBtn = document.createElement('button');
    saveBtn.style.cssText = 'padding:4px 12px;cursor:pointer;font-size:11px;font-weight:bold;background:#90c090;border:1px solid #5a8a5a;';
    saveRow.appendChild(saveBtn);
    const savedTag = document.createElement('span');
    savedTag.style.cssText = 'opacity:0.85;font-size:10px;font-style:italic;color:#cfd;flex:1;';
    saveRow.appendChild(savedTag);
    const delBtn = document.createElement('button');
    delBtn.textContent = '🗑 Delete clip';
    delBtn.title = 'Permanently delete this clip — removes the mp4 file from disk and drops it from the history';
    delBtn.style.cssText = 'padding:4px 10px;cursor:pointer;font-size:10px;background:#d96a6a;color:#fff;border:1px solid #9a4040;';
    saveRow.appendChild(delBtn);
    ovr.appendChild(saveRow);

    function _show(i) {
      idx = (i + list.length) % list.length;
      const entry = list[idx];
      v.src = entry.videoPath;
      counter.textContent = `${idx + 1} / ${list.length}`;
      pTxt.textContent = entry.promptUsed || '(prompt not captured — legacy clip)';
      prev.disabled = list.length < 2;
      next.disabled = list.length < 2;
      _paintSave();
    }
    function _paintSave() {
      const saved = idea.savedVideoIds && idea.savedVideoIds[idx];
      if (saved) {
        saveBtn.textContent = '✓ saved';
        saveBtn.disabled = true;
        saveBtn.style.background = '#cfd';
        saveBtn.style.color = '#363';
        saveBtn.style.borderColor = '#7a9a7a';
        saveBtn.title = `Already in the gallery as "${saved.name}"`;
        savedTag.textContent = `as "${saved.name}"`;
        savedTag.style.display = '';
      } else {
        saveBtn.textContent = '💾 Save to gallery';
        saveBtn.disabled = false;
        saveBtn.style.background = '#90c090';
        saveBtn.style.color = '';
        saveBtn.style.borderColor = '#5a8a5a';
        saveBtn.title = 'Save this clip to the biroly gallery (pick a category).';
        savedTag.textContent = '';
        savedTag.style.display = 'none';
      }
      // Delete + nav buttons always re-enabled when arriving at a clip
      delBtn.disabled = false;
      prev.disabled = list.length < 2;
      next.disabled = list.length < 2;
    }
    saveBtn.addEventListener('click', () => {
      if (saveBtn.disabled) return;
      _openSaveClipSubModal(idea, sceneNum, activeIdx, idx, () => { _paintSave(); });
    });
    delBtn.addEventListener('click', async () => {
      if (delBtn.disabled) return;
      const clip = list[idx];
      if (!clip) return;
      if (!confirm(`Delete clip ${idx + 1}/${list.length} permanently?\n\n${clip.videoPath}\n\nThe mp4 file is removed from disk too. Saved library slots that reference this clip keep their prompt but lose the source-video link.`)) return;
      delBtn.disabled = true; saveBtn.disabled = true; prev.disabled = true; next.disabled = true;
      try { v.pause(); } catch {}
      try {
        await fetch('/api/biroly/delete-video', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ videoPath: clip.videoPath }),
        });
      } catch (e) {
        // Best-effort delete — even if server-side fails we still drop the
        // clip from popup state so the user can move on. Log + continue.
        console.warn('[biroly-ideas] delete-video request failed:', e.message);
      }
      // Drop the clip from idea.generatedVideos
      list.splice(idx, 1);
      // Re-index savedVideoIds: shift down keys > deleted index, drop deleted.
      if (idea.savedVideoIds) {
        const next = {};
        Object.entries(idea.savedVideoIds).forEach(([k, val]) => {
          const ki = parseInt(k, 10);
          if (ki < idx)       next[ki] = val;
          else if (ki > idx)  next[ki - 1] = val;
          // ki === idx → drop
        });
        idea.savedVideoIds = next;
      }
      _persistState();
      _renderIdeaCards();   // updates the 📹 N counter on the card
      if (list.length === 0) {
        _setStatus(`Scene ${sceneNum} — all clips deleted.`);
        _closeLb();
        return;
      }
      // Stay on the same index (next clip slides in), or wrap to last if we
      // deleted the very last entry.
      idx = Math.min(idx, list.length - 1);
      _show(idx);
      _setStatus(`Scene ${sceneNum} — clip deleted (${list.length} remaining).`);
    });
    prev.addEventListener('click', () => _show(idx - 1));
    next.addEventListener('click', () => _show(idx + 1));

    function _key(e) {
      if (e.key === 'Escape') _closeLb();
      else if (e.key === 'ArrowLeft')  _show(idx - 1);
      else if (e.key === 'ArrowRight') _show(idx + 1);
    }
    function _closeLb() {
      ovr.remove();
      document.removeEventListener('keydown', _key);
    }
    document.addEventListener('keydown', _key);
    document.body.appendChild(ovr);
    _show(idx);   // start at last (newest)
  }

  // ── Save-clip sub-modal (over the lightbox, z 99997) ─────────────────────
  // Asks ONLY for slot name + category. The prompt is taken from the clip's
  // captured promptUsed and ALWAYS expanded with spintax (gemini-3.5-flash)
  // before being written to biroly_slots_v2.
  function _openSaveClipSubModal(idea, sceneNum, activeIdx, clipIdx, onSaved) {
    const list = idea.generatedVideos || [];
    const clip = list[clipIdx];
    if (!clip) return;

    const ovr = document.createElement('div');
    ovr.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:99997;display:flex;align-items:center;justify-content:center;font-family:inherit;';
    ovr.addEventListener('click', e => { if (e.target === ovr) ovr.remove(); });

    const box = document.createElement('div');
    box.style.cssText = 'background:#d4d0c8;color:#111;border:1px solid #555;box-shadow:0 4px 20px rgba(0,0,0,0.55);width:460px;max-width:96vw;padding:4px;display:flex;flex-direction:column;gap:4px;cursor:default;';
    box.addEventListener('click', e => e.stopPropagation());

    // Title bar
    const tb = document.createElement('div');
    tb.style.cssText = 'display:flex;align-items:center;gap:4px;background:#000080;color:#fff;padding:2px 6px;font-size:9px;font-weight:bold;';
    tb.innerHTML = `<span style="flex:1;">💾 Save clip ${clipIdx + 1}/${list.length} — scene ${sceneNum}</span>`;
    const xb = document.createElement('button');
    xb.textContent = '✕';
    xb.style.cssText = 'font-size:8px;padding:0 4px;cursor:pointer;line-height:1.3;';
    xb.addEventListener('click', () => ovr.remove());
    tb.appendChild(xb);
    box.appendChild(tb);

    // Body
    const body = document.createElement('div');
    body.style.cssText = 'padding:8px 10px;display:flex;flex-direction:column;gap:5px;font-size:10px;';

    // Slot name
    const nameLbl = document.createElement('div');
    nameLbl.style.cssText = 'font-weight:bold;color:#222;';
    nameLbl.textContent = 'Slot name:';
    body.appendChild(nameLbl);
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.maxLength = 80;
    nameInput.value = `${idea.title || 'untitled'} #${clipIdx + 1}`;
    nameInput.style.cssText = 'width:100%;font-size:10px;padding:2px 4px;box-sizing:border-box;';
    body.appendChild(nameInput);

    // Category
    const catLbl = document.createElement('div');
    catLbl.style.cssText = 'font-weight:bold;color:#222;margin-top:2px;';
    catLbl.textContent = 'Category:';
    body.appendChild(catLbl);
    const catRow = document.createElement('div');
    catRow.style.cssText = 'display:flex;gap:6px;align-items:center;';
    const catSel = document.createElement('select');
    catSel.style.cssText = 'flex:1;font-size:10px;padding:1px 4px;';
    const newCatBtn = document.createElement('button');
    newCatBtn.textContent = '+ new';
    newCatBtn.style.cssText = 'font-size:9px;padding:1px 6px;cursor:pointer;flex-shrink:0;';
    catRow.appendChild(catSel);
    catRow.appendChild(newCatBtn);
    body.appendChild(catRow);

    // Inline new-cat row (hidden by default)
    const newCatRow = document.createElement('div');
    newCatRow.style.cssText = 'display:none;gap:6px;align-items:center;';
    const newCatInput = document.createElement('input');
    newCatInput.type = 'text';
    newCatInput.placeholder = 'New category name';
    newCatInput.maxLength = 60;
    newCatInput.style.cssText = 'flex:1;font-size:10px;padding:2px 4px;';
    const newCatAddBtn = document.createElement('button');
    newCatAddBtn.textContent = 'Add';
    newCatAddBtn.style.cssText = 'font-size:9px;padding:1px 8px;cursor:pointer;';
    const newCatCancelBtn = document.createElement('button');
    newCatCancelBtn.textContent = '✕';
    newCatCancelBtn.style.cssText = 'font-size:9px;padding:1px 6px;cursor:pointer;';
    newCatRow.appendChild(newCatInput);
    newCatRow.appendChild(newCatAddBtn);
    newCatRow.appendChild(newCatCancelBtn);
    body.appendChild(newCatRow);

    // Refill category dropdown, preselect by category_hint substring match.
    function _refillCats(selectId) {
      const { cats } = _readBirolyLibrary();
      catSel.innerHTML = '';
      if (!cats.length) {
        const opt = document.createElement('option');
        opt.value = ''; opt.textContent = '(no categories — click + new)';
        opt.disabled = true; opt.selected = true;
        catSel.appendChild(opt);
        return;
      }
      cats.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.label || c.id;
        catSel.appendChild(opt);
      });
      const hint = (idea.category_hint || '').toLowerCase().trim();
      if (selectId) {
        catSel.value = selectId;
      } else if (hint) {
        const match = cats.find(c => (c.label || '').toLowerCase().includes(hint));
        if (match) catSel.value = match.id;
      }
    }
    _refillCats();

    newCatBtn.addEventListener('click', () => {
      catRow.style.display = 'none';
      newCatRow.style.display = 'flex';
      newCatInput.focus();
    });
    newCatCancelBtn.addEventListener('click', () => {
      catRow.style.display = 'flex';
      newCatRow.style.display = 'none';
      newCatInput.value = '';
    });
    newCatAddBtn.addEventListener('click', () => {
      const label = newCatInput.value.trim();
      if (!label) { newCatInput.focus(); return; }
      const created = _createBirolyCategory(label);
      catRow.style.display = 'flex';
      newCatRow.style.display = 'none';
      newCatInput.value = '';
      _refillCats(created.id);
    });

    // Mini-status
    const mini = document.createElement('div');
    mini.style.cssText = 'font-size:9px;color:#555;min-height:12px;padding:1px 0;';
    body.appendChild(mini);
    function _mini(t, err) {
      mini.textContent = t || '';
      mini.style.color = err ? '#a33' : '#555';
    }

    // Captured prompt — show small preview so the user sees what's being saved
    const promptHint = document.createElement('div');
    promptHint.style.cssText = 'font-size:9px;color:#666;font-style:italic;max-height:44px;overflow-y:auto;border:1px dashed #bbb;padding:3px 5px;background:#f5f3ec;';
    promptHint.textContent = clip.promptUsed
      ? `Prompt: "${clip.promptUsed.slice(0, 200)}${clip.promptUsed.length > 200 ? '…' : ''}"`
      : '(no prompt captured — legacy clip)';
    body.appendChild(promptHint);
    box.appendChild(body);

    // Footer
    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex;justify-content:flex-end;gap:6px;padding:4px 10px;border-top:1px solid #888;';
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    cancel.style.cssText = 'font-size:10px;padding:2px 10px;cursor:pointer;';
    cancel.addEventListener('click', () => ovr.remove());
    footer.appendChild(cancel);
    const save = document.createElement('button');
    save.textContent = '💾 Save to gallery';
    save.style.cssText = 'font-size:10px;padding:2px 12px;cursor:pointer;background:#90c090;font-weight:bold;';
    footer.appendChild(save);
    box.appendChild(footer);

    save.addEventListener('click', async () => {
      const name = nameInput.value.trim();
      const categoryId = catSel.value;
      const catLabel   = (catSel.selectedOptions[0] && catSel.selectedOptions[0].textContent) || '';
      if (!name) { _mini('Name required.', true); return; }
      if (!categoryId) { _mini('Pick or create a category.', true); return; }
      if (typeof addPendingBirolyEntry !== 'function' || typeof updateBirolyEntry !== 'function') {
        _mini('Gallery API unavailable on this page.', true); return;
      }
      if (!clip.videoPath) { _mini('This clip has no video to save.', true); return; }

      save.disabled = true; cancel.disabled = true;
      const origText = save.textContent;
      save.textContent = '⏳ Saving…';
      try {
        // Save the generated clip straight into the biroly gallery (archive) under the
        // chosen category — no spintax, no prompt slot. It then shows in the birols grid
        // and can be dragged onto the timeline.
        const entryId = addPendingBirolyEntry(name, clip.promptUsed || '', { categoryId, categoryLabel: catLabel, source: 'ideas' });
        updateBirolyEntry(entryId, {
          videoPath: clip.videoPath,
          thumbPath: clip.thumbPath || null,
          imagePath: clip.thumbPath || null,
          status:    'done',
        });
        // Remember per-clip → gallery entry so the lightbox shows ✓ saved.
        if (!idea.savedVideoIds) idea.savedVideoIds = {};
        idea.savedVideoIds[clipIdx] = { slotId: entryId, name };
        _persistState();
        _setStatus(`Scene ${sceneNum} — clip ${clipIdx + 1} saved to the biroly gallery (${catLabel || 'category'}).`);
        if (typeof onSaved === 'function') onSaved();
        ovr.remove();
      } catch (e) {
        _mini('Save error: ' + e.message, true);
        save.disabled = false; cancel.disabled = false;
        save.textContent = origText;
      }
    });

    ovr.appendChild(box);
    document.body.appendChild(ovr);
    nameInput.focus(); nameInput.select();

    const esc = e => {
      if (e.key === 'Escape') { ovr.remove(); document.removeEventListener('keydown', esc); }
    };
    document.addEventListener('keydown', esc);
  }

  async function _handleRemake(sceneNum, activeIdx, btn) {
    const slot = _state.ideasByScene[sceneNum];
    const idea = slot?.[activeIdx];
    if (!idea) return;
    // Per-scene sliders are gone — remake uses the current global intensity.
    const remakeIntensity = _state.intensity;
    btn.disabled = true; const orig = btn.textContent; btn.textContent = '⏳';
    _setStatus(`Scene ${sceneNum} — remaking idea (batch ${idea.batch}/3) at intensity ${remakeIntensity}/10 from current text…`);
    try {
      // Lexicon applies to every remake — the alternative idea should stay
      // inside the user's selected niche vocabulary regardless of batch.
      const remakePayload = {
        sceneText:     idea.lineText,
        currentPrompt: idea.prompt,
        intensity:     remakeIntensity,
      };
      const mp = _metaphorPayload();
      if (mp) remakePayload.metaphor = mp;
      if (_state.vertical) remakePayload.vertical = _state.vertical;
      const r = await fetch('/api/biroly/idea-remake', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(remakePayload),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error || 'remake failed');
      // Keep scene/lineText/batch + generatedVideos — overwrite only the
      // creative fields. The accumulated video history STAYS available in
      // the lightbox even after Remake; user can keep flipping through old
      // takes from previous prompts alongside future generations.
      slot[activeIdx] = {
        ...idea,
        title:         d.idea.title,
        prompt:        d.idea.prompt,
        intensity:     d.idea.intensity,
        category_hint: d.idea.category_hint,
        reusable:      d.idea.reusable,
        videoError:    null,
        generating:    false,
        // generatedVideos preserved via spread above
      };
      _renderIdeaCards();
      _persistState();
      _setStatus(`Scene ${sceneNum} remade ✓`);
    } catch (e) {
      btn.disabled = false; btn.textContent = orig;
      _setStatus(`Scene ${sceneNum} remake error: ${e.message}`, true);
    }
  }

  // ── ⚙ Settings — per-vertical metaphor lexicons + apply mode ──────────────
  // Modal panel. One dropdown chooses the active vertical (also drives which
  // lexicon textarea is shown). Apply mode toggles Strict vs Inspired.
  // Save commits to METAPHOR_LS_KEY; Cancel discards in-memory edits.
  function _openSettings() {
    const ovr = document.createElement('div');
    ovr.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:99995;display:flex;align-items:center;justify-content:center;';
    ovr.addEventListener('click', e => { if (e.target === ovr) ovr.remove(); });
    const box = document.createElement('div');
    box.style.cssText = 'background:#d4d0c8;border:1px solid #555;box-shadow:0 4px 20px rgba(0,0,0,0.45);width:560px;max-width:96vw;padding:6px;display:flex;flex-direction:column;gap:6px;';

    // ── Title bar ──────────────────────────────────────────────────────────
    const tb = document.createElement('div');
    tb.style.cssText = 'display:flex;align-items:center;gap:6px;background:#000080;color:#fff;padding:2px 6px;font-size:10px;font-weight:bold;';
    tb.innerHTML = '<span style="flex:1;">⚙ Ideas Settings — per-vertical prompts + examples</span>';
    const xb = document.createElement('button');
    xb.textContent = '✕';
    xb.style.cssText = 'font-size:9px;padding:0 5px;cursor:pointer;line-height:1.4;';
    xb.addEventListener('click', () => ovr.remove());
    tb.appendChild(xb);
    box.appendChild(tb);

    // ── Body ───────────────────────────────────────────────────────────────
    const body = document.createElement('div');
    body.style.cssText = 'padding:12px 14px;font-size:11px;color:#222;display:flex;flex-direction:column;gap:12px;max-height:74vh;overflow-y:auto;';

    // ── Currently-edited vertical (drives both panels) ──────────────────────
    let _setVert = (_state && _state.vertical) || '';
    let _setVertLabel = (_state && _state.verticalLabel) || '';

    // ── Vertical picker (scenario verticals) ────────────────────────────────
    const pickRow = document.createElement('div');
    pickRow.style.cssText = 'display:flex;align-items:center;gap:8px;';
    const pickLbl = document.createElement('label'); pickLbl.textContent = 'Vertical:'; pickLbl.style.cssText = 'font-weight:bold;min-width:60px;';
    const pickSel = document.createElement('select'); pickSel.style.cssText = 'flex:1;padding:3px 4px;font-size:11px;';
    pickRow.appendChild(pickLbl); pickRow.appendChild(pickSel);
    body.appendChild(pickRow);
    const pickHint = document.createElement('div');
    pickHint.style.cssText = 'font-size:10px;color:#666;font-style:italic;';
    pickHint.textContent = 'Pick which vertical to edit. The active project vertical is selected by default; other verticals are pre-filled but only apply when a project of that vertical is open.';
    body.appendChild(pickHint);

    // ── Two-button switcher: System+intensity | Examples ────────────────────
    const swRow = document.createElement('div');
    swRow.style.cssText = 'display:flex;gap:6px;margin-top:2px;';
    const tabPrompts = document.createElement('button');
    const tabExamples = document.createElement('button');
    const _tabCss = on => `flex:1;padding:5px 8px;font-size:11px;font-weight:bold;cursor:pointer;border:1px solid #555;background:${on ? '#000080' : '#cfccc4'};color:${on ? '#fff' : '#222'};`;
    tabPrompts.textContent = '⚙ System + intensity';
    tabExamples.textContent = '📚 Birol examples';
    swRow.appendChild(tabPrompts); swRow.appendChild(tabExamples);
    body.appendChild(swRow);

    // ── Panel A: System + intensity prompts (free-form vertical) ────────────
    const vcWrap = document.createElement('div');
    vcWrap.style.cssText = 'display:flex;flex-direction:column;gap:5px;border:1px solid #aaa;background:#cfccc4;padding:8px;';
    const vcHint = document.createElement('div');
    vcHint.style.cssText = 'font-size:10px;color:#555;font-style:italic;';
    vcHint.textContent = 'System prompt = always applied; it sets the base direction (weave in this vertical style). Each intensity prompt is applied when that level is active and regulates how bold the comparisons / metaphors are. These ADD to the built-in safety-ruled prompt; few-shot examples come from the Birol examples tab.';
    vcWrap.appendChild(vcHint);
    const _mkVcField = (labelText, rows) => {
      const l = document.createElement('div'); l.style.cssText = 'font-weight:bold;font-size:10px;margin-top:3px;'; l.textContent = labelText;
      const ta = document.createElement('textarea'); ta.rows = rows; ta.style.cssText = 'width:100%;box-sizing:border-box;font-size:10px;padding:3px 5px;resize:vertical;font-family:inherit;line-height:1.3;';
      vcWrap.appendChild(l); vcWrap.appendChild(ta); return ta;
    };
    const vcSys   = _mkVcField('System prompt (always applied):', 3);
    const vcClean = _mkVcField('CLEAN level prompt:', 2);
    const vcMild  = _mkVcField('MILD level prompt:', 2);
    const vcEdgy  = _mkVcField('EDGY level prompt:', 2);
    const vcHard  = _mkVcField('HARD level prompt:', 2);
    const vcFoot = document.createElement('div'); vcFoot.style.cssText = 'display:flex;align-items:center;gap:8px;margin-top:4px;';
    const vcSave = document.createElement('button'); vcSave.textContent = '💾 Save vertical prompts'; vcSave.style.cssText = 'font-size:10px;padding:3px 10px;cursor:pointer;font-weight:bold;';
    const vcStatus = document.createElement('span'); vcStatus.style.cssText = 'font-size:10px;color:#555;';
    vcFoot.appendChild(vcSave); vcFoot.appendChild(vcStatus); vcWrap.appendChild(vcFoot);
    body.appendChild(vcWrap);
    const _loadVcFields = async (vid) => {
      vcSys.value = vcClean.value = vcMild.value = vcEdgy.value = vcHard.value = '';
      if (!vid) { vcStatus.textContent = 'No vertical selected.'; return; }
      vcStatus.textContent = 'Loading…';
      try {
        const d = await (await fetch('/api/biroly/vertical-config?vertical=' + encodeURIComponent(vid))).json();
        const c = (d && d.config) || {}; const ip = c.intensityPrompts || {};
        vcSys.value = c.systemPrompt || ''; vcClean.value = ip.CLEAN || ''; vcMild.value = ip.MILD || ''; vcEdgy.value = ip.EDGY || ''; vcHard.value = ip.HARD || '';
        vcStatus.textContent = '';
      } catch { vcStatus.textContent = 'load error'; }
    };
    vcSave.addEventListener('click', async () => {
      if (!_setVert) { vcStatus.textContent = 'No vertical selected.'; return; }
      vcSave.disabled = true; vcStatus.textContent = 'Saving…';
      try {
        const r = await fetch('/api/biroly/vertical-config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          vertical: _setVert, label: _setVertLabel || _setVert,
          systemPrompt: vcSys.value,
          intensityPrompts: { CLEAN: vcClean.value, MILD: vcMild.value, EDGY: vcEdgy.value, HARD: vcHard.value },
        }) });
        const d = await r.json();
        vcStatus.textContent = (d && d.success) ? '✓ saved' : ('✗ ' + (d.error || 'error'));
      } catch (e) { vcStatus.textContent = '✗ ' + (e.message || 'error'); }
      vcSave.disabled = false;
    });

    // ── Panel B: Birol examples (inspiration few-shot for this vertical) ─────
    const exWrap = document.createElement('div');
    exWrap.style.cssText = 'display:none;flex-direction:column;gap:6px;border:1px solid #aaa;background:#cfccc4;padding:8px;';
    const exHint = document.createElement('div');
    exHint.style.cssText = 'font-size:10px;color:#555;font-style:italic;';
    exHint.textContent = 'These reference ideas INSPIRE generation for this vertical (never pasted verbatim). The intensity level controls how strongly they influence the result — higher = bolder. Add your best birol ideas here.';
    exWrap.appendChild(exHint);
    const exList = document.createElement('div'); exList.style.cssText = 'display:flex;flex-direction:column;gap:5px;max-height:200px;overflow-y:auto;';
    exWrap.appendChild(exList);
    const exAdd = document.createElement('div'); exAdd.style.cssText = 'display:flex;flex-direction:column;gap:4px;border-top:1px solid #b8b3a4;padding-top:6px;';
    const exTitle = document.createElement('input'); exTitle.placeholder = 'Title (optional)'; exTitle.style.cssText = 'font-size:10px;padding:3px 5px;box-sizing:border-box;width:100%;';
    const exPrompt = document.createElement('textarea'); exPrompt.rows = 2; exPrompt.placeholder = 'Example birol idea / prompt…'; exPrompt.style.cssText = 'font-size:10px;padding:3px 5px;box-sizing:border-box;width:100%;resize:vertical;font-family:inherit;';
    const exAddRow = document.createElement('div'); exAddRow.style.cssText = 'display:flex;align-items:center;gap:6px;';
    const exInt = document.createElement('select'); exInt.style.cssText = 'font-size:10px;padding:2px 4px;';
    ['', 'CLEAN', 'MILD', 'EDGY', 'HARD'].forEach(v => { const o = document.createElement('option'); o.value = v; o.textContent = v ? ('intensity: ' + v) : 'intensity: —'; exInt.appendChild(o); });
    const exAddBtn = document.createElement('button'); exAddBtn.textContent = '＋ Add example'; exAddBtn.style.cssText = 'font-size:10px;padding:3px 10px;cursor:pointer;font-weight:bold;';
    const exAddStatus = document.createElement('span'); exAddStatus.style.cssText = 'font-size:10px;color:#555;';
    exAddRow.appendChild(exInt); exAddRow.appendChild(exAddBtn); exAddRow.appendChild(exAddStatus);
    exAdd.appendChild(exTitle); exAdd.appendChild(exPrompt); exAdd.appendChild(exAddRow);
    exWrap.appendChild(exAdd);
    body.appendChild(exWrap);

    const _loadExamples = async (vid) => {
      exList.textContent = 'Loading…';
      let list = [];
      try { const d = await (await fetch('/api/biroly/idea-examples' + (vid ? '?vertical=' + encodeURIComponent(vid) : ''))).json(); list = (d && d.list) || []; } catch {}
      exList.innerHTML = '';
      if (!list.length) { const e = document.createElement('div'); e.style.cssText = 'color:#777;font-size:10px;font-style:italic;padding:8px;text-align:center;'; e.textContent = 'No examples for this vertical yet.'; exList.appendChild(e); return; }
      list.forEach(ex => {
        const c = document.createElement('div'); c.style.cssText = 'border:1px solid #b8b3a4;background:#fff;padding:4px 6px;display:flex;flex-direction:column;gap:2px;';
        const top = document.createElement('div'); top.style.cssText = 'display:flex;align-items:baseline;gap:6px;font-size:10px;';
        top.innerHTML = `<b style="flex:1;">${_escapeHtml(ex.title || 'Example')}</b><span style="color:#888;font-size:9px;">${_escapeHtml(ex.category || '')}${ex.intensity ? ' · ' + _escapeHtml(ex.intensity) : ''}</span>`;
        const delB = document.createElement('button'); delB.textContent = '🗑'; delB.title = 'Delete'; delB.style.cssText = 'font-size:9px;padding:0 5px;cursor:pointer;color:#a33;';
        delB.onclick = async () => { delB.disabled = true; try { await fetch('/api/biroly/idea-examples/' + encodeURIComponent(ex.id), { method: 'DELETE' }); c.remove(); if (!exList.children.length) _loadExamples(vid); } catch { delB.disabled = false; } };
        top.appendChild(delB); c.appendChild(top);
        const p = document.createElement('div'); p.style.cssText = 'font-size:9px;color:#333;line-height:1.35;white-space:pre-wrap;'; p.textContent = ex.prompt || ''; c.appendChild(p);
        exList.appendChild(c);
      });
    };
    exAddBtn.addEventListener('click', async () => {
      const prompt = exPrompt.value.trim();
      if (!prompt) { exAddStatus.textContent = 'enter a prompt'; return; }
      exAddBtn.disabled = true; exAddStatus.textContent = 'Adding…';
      try {
        const r = await fetch('/api/biroly/idea-examples', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          title: exTitle.value.trim() || 'Example', prompt, intensity: exInt.value || undefined, vertical: _setVert,
        }) });
        const d = await r.json();
        if (d && d.success) { exTitle.value = ''; exPrompt.value = ''; exAddStatus.textContent = '✓'; _loadExamples(_setVert); }
        else exAddStatus.textContent = '✗ ' + ((d && d.error) || 'error');
      } catch (e) { exAddStatus.textContent = '✗ ' + (e.message || 'error'); }
      exAddBtn.disabled = false;
      setTimeout(() => { exAddStatus.textContent = ''; }, 1500);
    });

    // ── Switcher behaviour ──────────────────────────────────────────────────
    const _showTab = which => {
      const p = which === 'prompts';
      vcWrap.style.display = p ? 'flex' : 'none';
      exWrap.style.display = p ? 'none' : 'flex';
      tabPrompts.style.cssText = _tabCss(p);
      tabExamples.style.cssText = _tabCss(!p);
    };
    tabPrompts.addEventListener('click', () => _showTab('prompts'));
    tabExamples.addEventListener('click', () => { _showTab('examples'); _loadExamples(_setVert); });
    _showTab('prompts');

    // ── Populate the vertical dropdown, then load panel A ───────────────────
    (async () => {
      const seen = new Set();
      const add = (id, label) => { if (!id || seen.has(id)) return; seen.add(id); const o = document.createElement('option'); o.value = id; o.textContent = label || id; if (id === _setVert) o.selected = true; pickSel.appendChild(o); };
      if (_setVert) add(_setVert, _setVertLabel || _setVert);
      try { const d = await (await fetch('/api/scenarios-v2/list')).json(); const list = (d && d.success && d.scenarios) || []; for (const s of list) { if (s.vertical && s.vertical.id) add(s.vertical.id, s.vertical.label); } } catch {}
      if (!pickSel.options.length) add('general', 'General');
      if (!_setVert) { _setVert = pickSel.value; _setVertLabel = (pickSel.options[pickSel.selectedIndex] || {}).textContent || _setVert; }
      _loadVcFields(_setVert);
    })();
    pickSel.addEventListener('change', () => {
      _setVert = pickSel.value;
      _setVertLabel = (pickSel.options[pickSel.selectedIndex] || {}).textContent || _setVert;
      _loadVcFields(_setVert);
      if (exWrap.style.display !== 'none') _loadExamples(_setVert);
    });

    box.appendChild(body);

    // ── Footer: Close ───────────────────────────────────────────────────────
    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;padding:8px 14px 12px;border-top:1px solid #b8b3a4;';
    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.style.cssText = 'padding:4px 14px;font-size:11px;cursor:pointer;';
    closeBtn.addEventListener('click', () => ovr.remove());
    footer.appendChild(closeBtn);
    box.appendChild(footer);

    ovr.appendChild(box);
    document.body.appendChild(ovr);
  }

  // Tiny HTML-escape used inside innerHTML strings (title / category labels).
  function _escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function _close() {
    if (!_state) return;
    if (_state.escHandler) document.removeEventListener('keydown', _state.escHandler);
    _state.overlay?.remove();
    _state = null;
  }
})();
