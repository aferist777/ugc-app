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
   Step 7: 💾 Save clip to biroly library — lives INSIDE the lightbox so
           the user saves a specific clip (with its own captured promptUsed)
           into a chosen category. Sub-modal asks only for slot name +
           category (existing or "+ new" inline create). Prompt is ALWAYS
           expanded with spintax (gemini-3.5-flash) before being written
           into biroly_slots_v2; biroly.js's biroly-state-updated listener
           refreshes the Biroly tab's left column instantly. Per-clip
           savedVideoIds maps clipIdx → {slotId, slotName} so the lightbox
           shows "✓ saved as …" when flipping back to an already-stored clip.
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
      _state.sceneCount       = 0;
      return false;
    }
    _state.ideasByScene     = data.ideasByScene     || {};
    _state.activeIdxByScene = data.activeIdxByScene || {};
    _state.sceneIntensity   = data.sceneIntensity   || {};
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

  window.openBirolyIdeasPopup = function (opts) {
    opts = opts || {};
    if (_state) _close();   // re-clicking the button while open just re-renders fresh
    _state = {
      overlay:               null,
      escHandler:            null,
      scenarioBuckets:       _collectScenarioBuckets(),   // Map<scenFile, sessionKey[]>
      selectedScenarioFile:  null,
      lockScenFile:          opts.scenFile || null,        // when set: lock to this scenario, hide the selector
      intensity:             _readIntensity(),             // 1-10, default 6, persisted

      // Step 4 additions:
      // ideasByScene: { sceneNum: [idea1?, idea2?, idea3?] } — each idea slot
      //   is filled when its batch (1/2/3) returns. Cards render progressively.
      ideasByScene:          {},
      activeIdxByScene:      {},   // sceneNum → 0|1|2 — which batch's card is visible
      sceneIntensity:        {},   // sceneNum → 1-10 — per-scene intensity used by Remake
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
    _build();
    // After DOM is mounted, render any restored ideas straight into the grid.
    if (Object.keys(_state.ideasByScene).length) {
      _renderIdeaCards();
      _setStatus(`Restored ${_countIdeas()} ideas across ${_state.sceneCount} scenes from previous session. Click 🔍 Analyze to re-generate fresh.`);
    } else if (_state.lockScenFile && opts.autoAnalyze && _state.selectedScenarioFile && _state.analyzeBtn) {
      // Project context + no saved ideas yet → start generating immediately (no extra clicks).
      _handleAnalyzeClick(_state.analyzeBtn);
    }
  };

  // ── Intensity persistence + colour scale ──────────────────────────────────
  function _readIntensity() {
    const v = parseInt(localStorage.getItem(INTENSITY_LS_KEY), 10);
    return (v >= 1 && v <= 10) ? v : 6;
  }
  function _writeIntensity(v) {
    try { localStorage.setItem(INTENSITY_LS_KEY, String(v)); } catch {}
  }
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
      font-family: 'MS Sans Serif', Tahoma, sans-serif;
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
    if (!entries.length) {
      // No qualifying projects — friendly hint, full width, no grid.
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
      ctrlRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr auto auto auto;gap:6px;align-items:stretch;';

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
        label.textContent = 'Scenario: ' + String(_state.lockScenFile).replace(/\.txt$/i, '');
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
      ctrlRow.appendChild(leftCol);

      // ── COL 2 — intensity slider ────────────────────────────────────────
      ctrlRow.appendChild(_buildIntensitySection());

      // ── COL 3 — ↻ Refresh ──────────────────────────────────────────────
      // Re-collects starred-session buckets (in case the user starred a new
      // project in Edit while this popup was open) and reloads the persisted
      // ideas snapshot for the active scenario. Forces a debounce-flush of
      // any pending textarea edits before refreshing so they don't get lost.
      const refreshBtn = document.createElement('button');
      refreshBtn.textContent = '↻';
      refreshBtn.title = 'Refresh — re-detect starred projects and reload saved ideas from disk';
      refreshBtn.style.cssText = 'padding:0 8px;font-size:11px;cursor:pointer;align-self:stretch;';
      refreshBtn.addEventListener('click', _handleRefresh);
      ctrlRow.appendChild(refreshBtn);

      // ── COL 4 — Analyze button ──────────────────────────────────────────
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
  function _buildIntensitySection() {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:1px;padding:3px 6px;background:#c8c5be;border:1px solid #999;';

    // Top row: label + value + dot
    const top = document.createElement('div');
    top.style.cssText = 'display:flex;align-items:center;gap:5px;font-size:9px;';
    const labelTxt = document.createElement('span');
    labelTxt.style.cssText = 'font-weight:bold;color:#222;';
    labelTxt.textContent = 'Intensity:';
    top.appendChild(labelTxt);
    const numTxt = document.createElement('span');
    numTxt.style.cssText = 'font-weight:bold;font-size:11px;min-width:14px;text-align:center;';
    top.appendChild(numTxt);
    const dot = document.createElement('span');
    dot.style.cssText = 'display:inline-block;width:8px;height:8px;border-radius:4px;border:1px solid #555;';
    top.appendChild(dot);
    const tagTxt = document.createElement('span');
    tagTxt.style.cssText = 'font-weight:bold;font-size:9px;letter-spacing:0.03em;';
    top.appendChild(tagTxt);
    wrap.appendChild(top);

    // Slider
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min  = '1';
    slider.max  = '10';
    slider.step = '1';
    slider.value = String(_state.intensity);
    slider.style.cssText = 'width:100%;margin:0;height:14px;';
    wrap.appendChild(slider);

    // Descriptive label (changes on move)
    const desc = document.createElement('div');
    desc.style.cssText = 'font-size:9px;color:#444;font-style:italic;min-height:12px;line-height:1.2;';
    wrap.appendChild(desc);

    // Render-once + on-change handler in one closure
    function _applyIntensity(n) {
      const v = Math.max(1, Math.min(10, parseInt(n, 10) || 6));
      _state.intensity = v;
      const meta = _intensityMeta(v);
      numTxt.textContent  = String(v);
      numTxt.style.color  = meta.color;
      dot.style.background = meta.color;
      tagTxt.textContent  = meta.tag;
      tagTxt.style.color  = meta.color;
      desc.textContent    = meta.text;
      _writeIntensity(v);
    }
    _applyIntensity(_state.intensity);
    slider.addEventListener('input', () => _applyIntensity(slider.value));

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
    if (!scenarioFile) { _setStatus('Pick a project first', true); return; }

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
    const sceneNums = Object.keys(_state.ideasByScene).map(Number).sort((a, b) => a - b);
    for (const sc of sceneNums) {
      _state.ideasGridEl.appendChild(_buildSceneCard(sc));
    }
  }

  // One scene card: header (scene line) + active idea (editable PROMPT + meta)
  // + ◀ N/3 ▶ pagination + Remake / Discard buttons.
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
      'background:#e6e3dd;padding:3px 3px 3px 5px;display:flex;flex-direction:column;gap:2px;';

    // Header: scene number + source line
    const hdr = document.createElement('div');
    hdr.style.cssText = 'display:flex;align-items:baseline;gap:5px;font-size:9px;';
    hdr.innerHTML = `<b>S${sceneNum}</b>`;
    const lineTxt = document.createElement('span');
    lineTxt.style.cssText = 'color:#555;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    lineTxt.textContent = idea?.lineText || '';
    lineTxt.title = idea?.lineText || '';
    hdr.appendChild(lineTxt);
    card.appendChild(hdr);

    if (!idea) {
      // No batch has finished for this scene yet — show pending
      const pending = document.createElement('div');
      pending.style.cssText = 'color:#888;font-size:9px;font-style:italic;padding:3px;';
      pending.textContent = '⏳ waiting for batch…';
      card.appendChild(pending);
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
    card.appendChild(tagRow);

    // Editable PROMPT textarea (single source of truth for user edits)
    const promptArea = document.createElement('textarea');
    promptArea.value = idea.prompt;
    promptArea.title = 'Edit the prompt — your edits are sent to Grok t2v and to Remake when you click those buttons';
    promptArea.style.cssText = 'width:100%;min-height:38px;font-size:10px;padding:2px 4px;box-sizing:border-box;resize:vertical;font-family:inherit;line-height:1.3;';
    promptArea.addEventListener('input', () => {
      idea.prompt = promptArea.value;
      _persistState();   // debounced under the hood (300ms)
    });
    card.appendChild(promptArea);

    // Bottom controls: ◀ N/3 ▶ + Remake + Discard
    const bottom = document.createElement('div');
    bottom.style.cssText = 'display:flex;align-items:center;gap:3px;font-size:9px;';

    const prevBtn = document.createElement('button');
    prevBtn.textContent = '◀';
    prevBtn.title = 'Previous batch';
    prevBtn.style.cssText = 'padding:0 5px;cursor:pointer;font-size:9px;line-height:1.4;';
    prevBtn.addEventListener('click', () => _flipBatch(sceneNum, -1));
    bottom.appendChild(prevBtn);

    const pageLabel = document.createElement('span');
    const total = slot.filter(Boolean).length;
    pageLabel.style.cssText = 'min-width:22px;text-align:center;font-weight:bold;color:#333;';
    pageLabel.textContent = `${activeIdx + 1}/3`;
    pageLabel.title = `${total} of 3 batches finished`;
    bottom.appendChild(pageLabel);

    const nextBtn = document.createElement('button');
    nextBtn.textContent = '▶';
    nextBtn.title = 'Next batch';
    nextBtn.style.cssText = 'padding:0 5px;cursor:pointer;font-size:9px;line-height:1.4;';
    nextBtn.addEventListener('click', () => _flipBatch(sceneNum, +1));
    bottom.appendChild(nextBtn);

    const spacer = document.createElement('span');
    spacer.style.cssText = 'flex:1;';
    bottom.appendChild(spacer);

    // Per-scene intensity micro-slider — overrides the popup-global intensity
    // for the Remake button on THIS scene specifically. Default = whatever the
    // global intensity was when the card was first rendered. Lives across
    // re-renders via _state.sceneIntensity[sceneNum].
    if (_state.sceneIntensity[sceneNum] == null) {
      _state.sceneIntensity[sceneNum] = _state.intensity;
    }
    const sceneInt = _state.sceneIntensity[sceneNum];
    const meta = _intensityMeta(sceneInt);
    const intLbl = document.createElement('span');
    intLbl.style.cssText = 'font-size:9px;color:#555;';
    intLbl.textContent = 'int';
    bottom.appendChild(intLbl);
    const intSlider = document.createElement('input');
    intSlider.type = 'range';
    intSlider.min = '1'; intSlider.max = '10'; intSlider.step = '1';
    intSlider.value = String(sceneInt);
    intSlider.title = 'Intensity used when you click ↻ Remake for this scene';
    intSlider.style.cssText = 'width:62px;height:12px;margin:0;flex-shrink:0;';
    bottom.appendChild(intSlider);
    const intVal = document.createElement('span');
    intVal.style.cssText = `font-size:9px;font-weight:bold;min-width:12px;text-align:center;color:${meta.color};`;
    intVal.textContent = String(sceneInt);
    intVal.title = meta.tag + ' — ' + meta.text;
    bottom.appendChild(intVal);
    intSlider.addEventListener('input', () => {
      const v = parseInt(intSlider.value, 10) || 6;
      _state.sceneIntensity[sceneNum] = v;
      const m = _intensityMeta(v);
      intVal.textContent = String(v);
      intVal.style.color = m.color;
      intVal.title = m.tag + ' — ' + m.text;
      _persistState();
      // Card border colour intentionally NOT touched here — it reflects the
      // intensity of the displayed idea (from the LLM response), not the
      // slider target for the next Remake. The two are deliberately separate.
    });

    // ── 📹 View button (only when there are accumulated videos) ─────────
    // idea.generatedVideos[] grows on every successful t2v generation; the
    // lightbox shows them with ◀ M/N ▶ pagination + per-clip Save-to-library.
    // Videos SURVIVE Remake — they're tied to the slot, not to the current
    // idea prompt. Wipes only on full re-Analyse or per-slot 🗑.
    _normalizeVideoEntries(idea);
    const videos = idea.generatedVideos;
    const viewBtn = document.createElement('button');
    viewBtn.style.cssText = 'padding:0 6px;cursor:pointer;font-size:9px;line-height:1.4;margin-left:4px;display:none;background:#cfd;color:#363;';
    const clearHistBtn = document.createElement('button');
    clearHistBtn.textContent = '🗑';
    clearHistBtn.title = 'Discard all generated videos for this slot';
    clearHistBtn.style.cssText = 'padding:0 4px;cursor:pointer;font-size:9px;line-height:1.4;display:none;color:#a33;';

    // ── ▶ Gen t2v button (always appends a new clip to the history) ─────
    const genBtn = document.createElement('button');
    genBtn.style.cssText = 'padding:0 7px;cursor:pointer;font-size:9px;line-height:1.4;margin-left:4px;';
    function _paintButtons() {
      const v = Array.isArray(idea.generatedVideos) ? idea.generatedVideos : [];
      // View button visibility + count
      if (v.length > 0) {
        viewBtn.textContent = `📹 ${v.length}`;
        viewBtn.title = `Open lightbox — ${v.length} generated clip${v.length === 1 ? '' : 's'} for this slot. Use ◀ ▶ inside to flip between takes.`;
        viewBtn.style.display = '';
        clearHistBtn.style.display = '';
      } else {
        viewBtn.style.display = 'none';
        clearHistBtn.style.display = 'none';
      }
      // Gen button morph
      if (idea.generating) {
        genBtn.textContent = '⏳';
        genBtn.title = 'Grok t2v rendering in progress…';
        genBtn.disabled = true;
        genBtn.style.background = '';
        genBtn.style.color = '';
      } else if (idea.videoError) {
        genBtn.textContent = '⚠ retry';
        genBtn.title = 'Last gen failed: ' + idea.videoError + '\nClick to retry.';
        genBtn.disabled = false;
        genBtn.style.background = '#fdd';
        genBtn.style.color = '#a33';
      } else if (v.length > 0) {
        genBtn.textContent = '▶ Gen another';
        genBtn.title = `Generate one more clip (appends to the ${v.length}-clip history). Uses the CURRENT textarea prompt.`;
        genBtn.disabled = false;
        genBtn.style.background = '';
        genBtn.style.color = '';
      } else {
        genBtn.textContent = '▶ Gen t2v';
        genBtn.title = `Submit the current prompt to Grok text-to-video (${BIROLY_DURATION_SEC}s, 9:16, 480p)`;
        genBtn.disabled = false;
        genBtn.style.background = '';
        genBtn.style.color = '';
      }
    }
    _paintButtons();
    viewBtn.addEventListener('click', () => {
      _normalizeVideoEntries(idea);
      if (idea.generatedVideos.length) {
        _openVideoLightbox(idea, sceneNum, activeIdx);
      }
    });
    clearHistBtn.addEventListener('click', () => {
      if (!confirm(`Discard all ${idea.generatedVideos?.length || 0} generated videos for scene ${sceneNum}?`)) return;
      idea.generatedVideos = [];
      idea.videoError = null;
      // Per-clip saved-slot map points at video indices that no longer exist —
      // wipe it too. The slots themselves remain in the biroly library; this
      // only clears the popup's "✓ saved as …" indicators.
      idea.savedVideoIds = {};
      _persistState();
      _renderIdeaCards();
    });
    genBtn.addEventListener('click', () => {
      if (idea.generating) return;
      _handleGenT2V(sceneNum, activeIdx);
    });
    bottom.appendChild(viewBtn);
    bottom.appendChild(clearHistBtn);
    bottom.appendChild(genBtn);

    const remakeBtn = document.createElement('button');
    remakeBtn.textContent = '↻ Remake';
    remakeBtn.title = 'Send the CURRENT textarea content + scene line to LLM at the per-scene intensity. Get a fresh alternative replacing this batch slot.';
    remakeBtn.style.cssText = 'padding:0 7px;cursor:pointer;font-size:9px;line-height:1.4;margin-left:4px;';
    remakeBtn.addEventListener('click', () => _handleRemake(sceneNum, activeIdx, remakeBtn));
    bottom.appendChild(remakeBtn);

    const discardBtn = document.createElement('button');
    discardBtn.textContent = '✕';
    discardBtn.title = 'Discard this scene from the plan';
    discardBtn.style.cssText = 'padding:0 6px;cursor:pointer;font-size:9px;line-height:1.4;color:#a33;';
    discardBtn.addEventListener('click', () => _handleDiscard(sceneNum));
    bottom.appendChild(discardBtn);

    card.appendChild(bottom);
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
    saveBtn.style.cssText = 'padding:4px 14px;cursor:pointer;font-size:11px;font-weight:bold;background:#90c090;border:1px solid #5a8a5a;';
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
        saveBtn.title = `Already in library as "${saved.name}"`;
        savedTag.textContent = `as "${saved.name}"`;
        savedTag.style.display = '';
      } else {
        saveBtn.textContent = '💾 Save this clip to biroly library';
        saveBtn.disabled = false;
        saveBtn.style.background = '#90c090';
        saveBtn.style.color = '';
        saveBtn.style.borderColor = '#5a8a5a';
        saveBtn.title = 'Open the save dialog — spintax expansion will be applied automatically before storing.';
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
      _openSaveClipSubModal(idea, sceneNum, activeIdx, idx, () => {
        // Called after a successful save — refresh button to show ✓ saved
        _paintSave();
      });
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
      ? `Will save with spintax expansion of: "${clip.promptUsed.slice(0, 200)}${clip.promptUsed.length > 200 ? '…' : ''}"`
      : '(no prompt captured — legacy clip; spintax expansion may fail)';
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
    save.textContent = '💾 Save with spintax';
    save.style.cssText = 'font-size:10px;padding:2px 12px;cursor:pointer;background:#90c090;font-weight:bold;';
    footer.appendChild(save);
    box.appendChild(footer);

    save.addEventListener('click', async () => {
      const name = nameInput.value.trim();
      const categoryId = catSel.value;
      const promptRaw  = (clip.promptUsed || '').trim();
      if (!name) { _mini('Name required.', true); return; }
      if (!categoryId) { _mini('Pick or create a category.', true); return; }
      if (promptRaw.length < 20) { _mini('Captured prompt too short for spintax expansion (min 20 chars).', true); return; }

      save.disabled = true; cancel.disabled = true;
      const origText = save.textContent;
      save.textContent = '⏳ Expanding spintax…';
      _mini('Calling gemini-3.5-flash to add spintax variation groups…');
      let expanded = '';
      try {
        const r = await fetch('/api/biroly/idea-spintax-expand', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: promptRaw }),
        });
        const d = await r.json();
        if (!d.success || !d.prompt) throw new Error(d.error || 'spintax expand returned no prompt');
        expanded = d.prompt;
        _mini(`Spintax added (${d.groupNames?.length || '?'} groups) — writing slot…`);
      } catch (e) {
        _mini('Spintax error: ' + e.message + ' — slot NOT saved.', true);
        save.disabled = false; cancel.disabled = false;
        save.textContent = origText;
        return;
      }
      try {
        const slot = _saveBirolySlot({
          name,
          prompt:      expanded,
          categoryId,
          sourceVideo: clip.videoPath,
        });
        // Remember per-clip → slot link so the lightbox shows ✓ saved.
        if (!idea.savedVideoIds) idea.savedVideoIds = {};
        idea.savedVideoIds[clipIdx] = { slotId: slot.id, name: slot.name };
        _persistState();
        _setStatus(`Scene ${sceneNum} — clip ${clipIdx + 1} saved to biroly library as "${slot.name}".`);
        if (typeof onSaved === 'function') onSaved();
        ovr.remove();
      } catch (e) {
        _mini('Write error: ' + e.message, true);
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
    // Per-scene intensity overrides the popup-global one for THIS remake.
    const remakeIntensity = _state.sceneIntensity[sceneNum] ?? _state.intensity;
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
    const settings = _loadMetaphorSettings();
    // Working copy — lexicons mutated locally as user switches verticals;
    // only committed to localStorage on Save.
    const working = {
      vertical:  settings.vertical,
      applyMode: settings.applyMode,
      lexicons:  { ...settings.lexicons },
    };
    let editingVertical = working.vertical;   // which lexicon is currently in textarea

    const ovr = document.createElement('div');
    ovr.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:99995;display:flex;align-items:center;justify-content:center;';
    ovr.addEventListener('click', e => { if (e.target === ovr) ovr.remove(); });
    const box = document.createElement('div');
    box.style.cssText = 'background:#d4d0c8;border:1px solid #555;box-shadow:0 4px 20px rgba(0,0,0,0.45);width:560px;max-width:96vw;padding:6px;display:flex;flex-direction:column;gap:6px;';

    // ── Title bar ──────────────────────────────────────────────────────────
    const tb = document.createElement('div');
    tb.style.cssText = 'display:flex;align-items:center;gap:6px;background:#000080;color:#fff;padding:2px 6px;font-size:10px;font-weight:bold;';
    tb.innerHTML = '<span style="flex:1;">⚙ Ideas Settings — Metaphor Lexicons</span>';
    const xb = document.createElement('button');
    xb.textContent = '✕';
    xb.style.cssText = 'font-size:9px;padding:0 5px;cursor:pointer;line-height:1.4;';
    xb.addEventListener('click', () => ovr.remove());
    tb.appendChild(xb);
    box.appendChild(tb);

    // ── Body ───────────────────────────────────────────────────────────────
    const body = document.createElement('div');
    body.style.cssText = 'padding:12px 14px;font-size:11px;color:#222;display:flex;flex-direction:column;gap:12px;';

    // Section: Vertical picker
    const vertRow = document.createElement('div');
    vertRow.style.cssText = 'display:flex;align-items:center;gap:8px;';
    const vertLbl = document.createElement('label');
    vertLbl.textContent = 'Vertical:';
    vertLbl.style.cssText = 'font-weight:bold;min-width:80px;';
    const vertSel = document.createElement('select');
    vertSel.style.cssText = 'flex:1;padding:3px 4px;font-size:11px;';
    for (const v of METAPHOR_VERTICALS) {
      const opt = document.createElement('option');
      opt.value = v.id;
      opt.textContent = v.label;
      if (v.id === working.vertical) opt.selected = true;
      vertSel.appendChild(opt);
    }
    const vertHint = document.createElement('div');
    vertHint.style.cssText = 'font-size:10px;color:#666;font-style:italic;';
    vertHint.textContent = 'Which lexicon to inject into the METAPHOR batch.';
    vertRow.appendChild(vertLbl);
    vertRow.appendChild(vertSel);
    body.appendChild(vertRow);
    body.appendChild(vertHint);

    // Section: Lexicon textarea (one per line)
    const lexLbl = document.createElement('div');
    lexLbl.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-top:4px;';
    const lexLblText = document.createElement('span');
    lexLblText.style.cssText = 'font-weight:bold;';
    lexLblText.textContent = 'Metaphors (one per line):';
    const resetBtn = document.createElement('button');
    resetBtn.textContent = '↺ Reset defaults';
    resetBtn.title = 'Restore the built-in default metaphors for this vertical';
    resetBtn.style.cssText = 'font-size:10px;padding:2px 6px;cursor:pointer;';
    lexLbl.appendChild(lexLblText);
    lexLbl.appendChild(resetBtn);
    body.appendChild(lexLbl);

    const lexArea = document.createElement('textarea');
    lexArea.style.cssText = 'width:100%;min-height:220px;font-family:ui-monospace,monospace;font-size:11px;padding:6px 8px;border:1px solid #888;background:#fff;box-sizing:border-box;resize:vertical;';
    lexArea.value = working.lexicons[editingVertical] || '';
    body.appendChild(lexArea);

    // When user switches the dropdown: stash current textarea text into the
    // OLD vertical's lexicon, then load the NEW vertical's text. This way
    // per-vertical edits survive switching without a Save.
    vertSel.addEventListener('change', () => {
      working.lexicons[editingVertical] = lexArea.value;
      editingVertical = vertSel.value;
      working.vertical = vertSel.value;
      lexArea.value = working.lexicons[editingVertical] || '';
    });
    resetBtn.addEventListener('click', () => {
      lexArea.value = METAPHOR_DEFAULT_LEXICONS[editingVertical] || '';
      working.lexicons[editingVertical] = lexArea.value;
    });

    // Section: Apply mode toggle
    const modeWrap = document.createElement('div');
    modeWrap.style.cssText = 'display:flex;flex-direction:column;gap:4px;margin-top:4px;';
    const modeLbl = document.createElement('div');
    modeLbl.style.cssText = 'font-weight:bold;';
    modeLbl.textContent = 'Apply mode:';
    const modeRow = document.createElement('div');
    modeRow.style.cssText = 'display:flex;gap:14px;align-items:center;';
    const _mkRadio = (val, label, hint) => {
      const wrap = document.createElement('label');
      wrap.style.cssText = 'display:flex;align-items:center;gap:4px;cursor:pointer;font-size:11px;';
      const inp = document.createElement('input');
      inp.type = 'radio';
      inp.name = 'biroly-metaphor-mode';
      inp.value = val;
      if (working.applyMode === val) inp.checked = true;
      inp.addEventListener('change', () => { if (inp.checked) working.applyMode = val; });
      wrap.appendChild(inp);
      const txt = document.createElement('span');
      txt.innerHTML = `<b>${label}</b> <span style="color:#666;font-style:italic;">— ${hint}</span>`;
      wrap.appendChild(txt);
      return wrap;
    };
    modeRow.appendChild(_mkRadio('strict',   'Strict',   'LLM picks only from the list'));
    modeRow.appendChild(_mkRadio('inspired', 'Inspired', 'list as style; LLM invents similar'));
    modeWrap.appendChild(modeLbl);
    modeWrap.appendChild(modeRow);
    body.appendChild(modeWrap);

    box.appendChild(body);

    // ── Footer: Cancel / Save ──────────────────────────────────────────────
    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;padding:8px 14px 12px;border-top:1px solid #b8b3a4;';
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = 'padding:4px 14px;font-size:11px;cursor:pointer;';
    cancelBtn.addEventListener('click', () => ovr.remove());
    const saveBtn = document.createElement('button');
    saveBtn.textContent = '💾 Save';
    saveBtn.style.cssText = 'padding:4px 14px;font-size:11px;font-weight:bold;cursor:pointer;background:#90c090;border:1px solid #5a8a5a;';
    saveBtn.addEventListener('click', () => {
      // Commit the current textarea into the active vertical before saving.
      working.lexicons[editingVertical] = lexArea.value;
      _saveMetaphorSettings(working);
      ovr.remove();
    });
    footer.appendChild(cancelBtn);
    footer.appendChild(saveBtn);
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
