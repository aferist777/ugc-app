/* ════════════════════════════════════════════════════════════════════════
   CHARACTER (ACTOR) POPUP — persistent reusable character.
   Opens automatically after "Save char" (references generating live) and from
   the "Edit" button next to the Char dropdown.

   LEFT  — the two neutral reference sheets (Portrait 3-views + Full-body T-pose),
           live-polled while they generate. Base-face thumb underneath.
   RIGHT — Info (name / gender / notes — characteristics stub),
           Voice (ElevenLabs voice-design flow, bound to char.voice),
           Личное дело / Portfolio (all obrazы whose charId == this char).

   Footer — 🗑 Delete character (two-click), Save, Close.
   Char records live server-side (data/characters.json) via /api/char-store/*.
   ════════════════════════════════════════════════════════════════════════ */

(function () {
  if (window.openCharacterActorPopup) return;

  const LLM_LS_KEY = 'voice_design_llm_v1';
  const DEFAULT_LLM = 'google/gemini-3.5-flash';
  function _llm() { return localStorage.getItem(LLM_LS_KEY) || DEFAULT_LLM; }

  let S = null; // active state, null when closed

  // ── Entry point ─────────────────────────────────────────────────────────
  window.openCharacterActorPopup = async function (charId) {
    let char = null;
    try {
      const d = await fetch('/api/char-store/list').then(r => r.json());
      char = (d.chars || []).find(c => String(c.id) === String(charId));
    } catch {}
    if (!char) { window.setStatus?.('Character not found.'); return; }
    if (S) _close();
    S = { char, previews: [], fourWord: '', refTimers: {}, pfTimer: null };
    _build();
    _pollRefsIfNeeded();
    _startPortfolioPoll();
  };

  // ── Shell ─────────────────────────────────────────────────────────────────
  function _build() {
    const ov = document.createElement('div');
    ov.id = 'actor-popup-overlay';
    ov.style.cssText = 'position:fixed;inset:0;z-index:99970;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;';
    ov.addEventListener('mousedown', e => { if (e.target === ov) _close(); });

    const box = document.createElement('div');
    box.className = 'actor-pop-box';
    box.innerHTML = `
      <div class="actor-pop-title">
        <span class="actor-pop-title-txt">🧑 Character — ${_esc(S.char.name || '')}</span>
        <button class="actor-pop-x" title="Close">✕</button>
      </div>
      <div class="actor-pop-body">
        <div class="actor-pop-left"></div>
        <div class="actor-pop-right"></div>
      </div>
      <div class="actor-pop-footer">
        <button class="actor-pop-del">🗑 Delete character</button>
        <span style="flex:1"></span>
        <button class="actor-pop-cancel">Close</button>
        <button class="actor-pop-save">💾 Save</button>
      </div>`;
    ov.appendChild(box);
    document.body.appendChild(ov);
    S.overlay = ov;
    S.box = box;

    box.querySelector('.actor-pop-x').addEventListener('click', _close);
    box.querySelector('.actor-pop-cancel').addEventListener('click', _close);
    box.querySelector('.actor-pop-save').addEventListener('click', _save);
    _wireDelete(box.querySelector('.actor-pop-del'));

    _buildLeft(box.querySelector('.actor-pop-left'));
    _buildRight(box.querySelector('.actor-pop-right'));
  }

  const REF_ENGINES = [
    { id: 'gptimage2',     label: 'GPT-Image-2 (default)' },
    { id: 'nano-banana-2', label: 'Nano-Banana 2 (4K)' },
    { id: 'seedream',      label: 'Seedream (3K)' },
    { id: 'seedream4.5',   label: 'Seedream 4.5' },
    { id: 'qwen2',         label: 'Qwen' },
  ];
  const REF_ENGINE_LS = 'char_ref_engine_v1';

  // ── LEFT: reference-sheet engine toolbar + the two sheets ───────────────────
  function _buildLeft(root) {
    const bar = document.createElement('div');
    bar.className = 'actor-ref-bar';
    const sel = document.createElement('select');
    sel.className = 'actor-ref-engine';
    const cur = localStorage.getItem(REF_ENGINE_LS) || S.char.imageEngine || 'gptimage2';
    REF_ENGINES.forEach(e => {
      const o = document.createElement('option'); o.value = e.id; o.textContent = e.label;
      if (e.id === cur) o.selected = true; sel.appendChild(o);
    });
    sel.addEventListener('change', () => localStorage.setItem(REF_ENGINE_LS, sel.value));
    const regen = document.createElement('button');
    regen.className = 'actor-ref-regen'; regen.textContent = '↻ Regen sheets';
    regen.title = 'Regenerate both reference sheets with the selected engine';
    regen.addEventListener('click', () => _regenBoth(sel.value, regen));
    bar.appendChild(sel); bar.appendChild(regen);
    root.appendChild(bar);
    S.engineSel = sel;

    root.appendChild(_refBlock('portrait', 'Portrait — 3 views', S.char.portrait, S.char.portraitTask));
    root.appendChild(_refBlock('tpose',    'Full body — T-pose', S.char.tpose,    S.char.tposeTask));

    if (S.char.baseFace) {
      const baseWrap = document.createElement('div');
      baseWrap.className = 'actor-base';
      baseWrap.innerHTML = '<div class="actor-ref-cap">Face source — click to start a photoshoot</div>';
      const img = document.createElement('img');
      img.src = (window.toThumbPath?.(S.char.baseFace) || S.char.baseFace) + '?t=' + Date.now();
      img.onerror = () => { img.onerror = null; img.src = S.char.baseFace; };
      img.style.cursor = 'pointer';
      img.title = 'Create a photoshoot (pose variations) from this face source';
      img.addEventListener('click', _startPhotoshootFromFaceSource);
      baseWrap.appendChild(img);
      root.appendChild(baseWrap);
      S.baseWrap = baseWrap;
      _refreshFaceSourceVisibility();   // hide it once this character already has a photoshoot
    }
  }

  // ── Face source -> start a photoshoot ───────────────────────────────────────
  // Once a character has at least one photoshoot, the face-source thumbnail is
  // hidden here (its baseFace stays on the record + remains the active image on
  // load); until then, clicking it seeds a new photoshoot (pose variations).
  function _charHasShoots() {
    return (window.getObrazы?.() || []).some(o => String(o.charId) === String(S.char.id));
  }
  function _refreshFaceSourceVisibility() {
    if (S && S.baseWrap) S.baseWrap.style.display = _charHasShoots() ? 'none' : '';
  }
  async function _startPhotoshootFromFaceSource() {
    const base = S.char.baseFace;
    if (!base) return;
    if (!confirm('Create a photoshoot (pose variations) from this face source?')) return;
    const _saveObraz = window.saveObraz || (typeof saveObraz === 'function' ? saveObraz : null);
    if (!_saveObraz) { _status('Photoshoot module not loaded.', true); return; }
    const name = (S.nameInput?.value || S.char.name || 'Photoshoot').trim();
    const gender = S.genderSel?.value || S.char.gender || 'female';
    const engine = S.engineSel?.value || S.char.imageEngine || 'gptimage2';
    const newId = Date.now();
    _status('Creating photoshoot…');
    try {
      const cr = await fetch('/api/obrazy/create', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: newId, name, charPath: base }),
      }).then(r => r.json());
      if (!cr.success || !cr.charPath) throw new Error(cr.error || 'folder create failed');
      _saveObraz(cr.charPath, null, null, name, gender, null, [null, null, null, null], engine, S.char.id);
      const list = window.getObrazы?.() || [];
      if (list[0]) { list[0].id = newId; localStorage.setItem('obrazy', JSON.stringify(list)); }
      window.loadObrazы?.(); window.loadScenarioObrazы?.(); window.loadCharCol3Obrazy?.();
      _status('');
      window.openPhotoshootPopup?.(newId, {
        charId: S.char.id, isNew: true,
        onSaved: () => { _renderPortfolio(); _refreshFaceSourceVisibility(); window.loadActorChars?.(); },
      });
      _renderPortfolio();
      _refreshFaceSourceVisibility();
      _startPortfolioPoll();
    } catch (e) { _status('Photoshoot error: ' + e.message, true); }
  }

  function _refBlock(kind, caption, pathVal, taskVal) {
    const wrap = document.createElement('div');
    wrap.className = 'actor-ref';
    wrap.dataset.kind = kind;
    const cap = document.createElement('div');
    cap.className = 'actor-ref-cap';
    cap.textContent = caption;
    const frame = document.createElement('div');
    frame.className = 'actor-ref-frame';
    wrap.appendChild(cap);
    wrap.appendChild(frame);
    _renderRef(frame, kind, pathVal, taskVal);
    S.refTimers[kind] = S.refTimers[kind] || null;
    wrap['_frame'] = frame;
    if (kind === 'portrait') S.portraitFrame = frame;
    else S.tposeFrame = frame;
    return wrap;
  }

  function _renderRef(frame, kind, pathVal, taskVal) {
    frame.innerHTML = '';
    if (pathVal) {
      const img = document.createElement('img');
      // Show the lightweight thumbnail; full-res opens in the lightbox on click.
      img.src = (window.toThumbPath?.(pathVal) || pathVal) + '?t=' + Date.now();
      img.onerror = () => { img.onerror = null; img.src = pathVal + '?t=' + Date.now(); };
      img.className = 'actor-ref-img';
      img.title = 'Click to enlarge';
      img.addEventListener('click', () => window.openLightbox?.(pathVal));
      frame.appendChild(img);
    } else if (taskVal) {
      frame.innerHTML = '<div class="actor-ref-pending"><span class="actor-spin">⏳</span><span>generating…</span></div>';
    } else {
      const retry = document.createElement('button');
      retry.className = 'actor-ref-retry';
      retry.textContent = '↻ Regenerate';
      retry.addEventListener('click', () => _regenRef(kind, frame));
      frame.innerHTML = '<div class="actor-ref-failed">not generated</div>';
      frame.appendChild(retry);
    }
  }

  // ── Live polling of portrait/tpose generation ──────────────────────────────
  function _pollRefsIfNeeded() {
    [['portrait', S.char.portraitTask], ['tpose', S.char.tposeTask]].forEach(([kind, task]) => {
      if (S.char[kind]) return;            // sheet already resolved
      if (task) { _pollRef(kind, task); return; }
      _waitForRefTask(kind);                // submitted in the background by create — wait for its taskId
    });
  }

  // /char-store/create now generates the sheets in the BACKGROUND, so a taskId
  // may not exist yet when the popup opens. Poll the char record until the task
  // appears (or the image already landed), then hand off to ref-status polling.
  function _waitForRefTask(kind) {
    if (S.refTimers[kind]) return;
    const frame = kind === 'portrait' ? S.portraitFrame : S.tposeFrame;
    if (frame) _renderRef(frame, kind, null, true);   // show "generating" while we wait
    let tries = 0;
    S.refTimers[kind] = setInterval(async () => {
      if (++tries > 60) { clearInterval(S.refTimers[kind]); S.refTimers[kind] = null; return; }
      try {
        const d = await fetch('/api/char-store/list').then(r => r.json());
        const fresh = (d.chars || []).find(c => String(c.id) === String(S.char.id));
        if (!fresh) return;
        if (fresh[kind]) {                              // already resolved server-side
          clearInterval(S.refTimers[kind]); S.refTimers[kind] = null;
          S.char[kind] = fresh[kind]; S.char[kind + 'Task'] = null;
          if (frame) _renderRef(frame, kind, fresh[kind], null);
          window.loadActorChars?.();
        } else if (fresh[kind + 'Task']) {              // background submitted it → poll ref-status
          clearInterval(S.refTimers[kind]); S.refTimers[kind] = null;
          S.char[kind + 'Task'] = fresh[kind + 'Task'];
          _pollRef(kind, fresh[kind + 'Task']);
        }
      } catch {}
    }, 3000);
  }
  function _pollRef(kind, taskId) {
    if (S.refTimers[kind]) return;
    const frame = kind === 'portrait' ? S.portraitFrame : S.tposeFrame;
    let tries = 0;
    S.refTimers[kind] = setInterval(async () => {
      if (++tries > 120) { clearInterval(S.refTimers[kind]); S.refTimers[kind] = null; return; }
      try {
        const r = await fetch(`/api/char-store/ref-status/${taskId}?charId=${encodeURIComponent(S.char.id)}&kind=${kind}`);
        const d = await r.json();
        if (d.state === 'success') {
          clearInterval(S.refTimers[kind]); S.refTimers[kind] = null;
          S.char[kind] = d.imagePath; S.char[kind + 'Task'] = null;
          if (frame) _renderRef(frame, kind, d.imagePath, null);
          window.loadActorChars?.();
        } else if (d.state === 'failed') {
          clearInterval(S.refTimers[kind]); S.refTimers[kind] = null;
          S.char[kind + 'Task'] = null;
          if (frame) _renderRef(frame, kind, null, null);
        }
      } catch {}
    }, 3000);
  }

  // Regenerate a single sheet (per-frame ↻ when a sheet failed).
  async function _regenRef(kind, frame) {
    const engine = S.engineSel?.value || S.char.imageEngine || 'gptimage2';
    await _submitRef(kind, engine, frame);
  }

  // Regenerate BOTH sheets with the chosen engine (toolbar button).
  async function _regenBoth(engine, btn) {
    if (!S.char.baseFace) { _status('No face source to regenerate from.', true); return; }
    localStorage.setItem(REF_ENGINE_LS, engine);
    btn.disabled = true; const orig = btn.textContent; btn.textContent = '⏳ Regenerating…';
    if (S.refTimers.portrait) { clearInterval(S.refTimers.portrait); S.refTimers.portrait = null; }
    if (S.refTimers.tpose)    { clearInterval(S.refTimers.tpose);    S.refTimers.tpose = null; }
    await Promise.all([
      _submitRef('portrait', engine, S.portraitFrame),
      _submitRef('tpose',    engine, S.tposeFrame),
    ]);
    btn.disabled = false; btn.textContent = orig;
    _status('Regenerating both reference sheets…');
  }

  async function _submitRef(kind, engine, frame) {
    if (!S.char.baseFace) { _status('No face source to regenerate from.', true); return; }
    if (frame) _renderRef(frame, kind, null, true);
    try {
      const r = await fetch('/api/char-store/regen-ref', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ charId: S.char.id, kind, imageEngine: engine, engineParams: window.getEngineParams?.(engine) || {} }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error || 'regen failed');
      S.char[kind + 'Task'] = d.taskId;
      S.char[kind] = null;
      _pollRef(kind, d.taskId);
    } catch (e) {
      if (frame) _renderRef(frame, kind, null, null);
      _status('Regen error: ' + e.message, true);
    }
  }

  // ── RIGHT: info + voice + portfolio ────────────────────────────────────────
  function _buildRight(root) {
    // Info
    const info = document.createElement('div');
    info.className = 'actor-sec';
    info.innerHTML = '<div class="actor-sec-h">Info</div>';
    const nameRow = document.createElement('div');
    nameRow.className = 'actor-field';
    nameRow.innerHTML = '<label>Name</label>';
    S.nameInput = document.createElement('input');
    S.nameInput.type = 'text'; S.nameInput.value = S.char.name || '';
    nameRow.appendChild(S.nameInput);
    info.appendChild(nameRow);

    const gRow = document.createElement('div');
    gRow.className = 'actor-field';
    gRow.innerHTML = '<label>Gender</label>';
    S.genderSel = document.createElement('select');
    ['', 'female', 'male'].forEach(v => {
      const o = document.createElement('option');
      o.value = v; o.textContent = v ? (v[0].toUpperCase() + v.slice(1)) : '—';
      if ((S.char.gender || '') === v) o.selected = true;
      S.genderSel.appendChild(o);
    });
    gRow.appendChild(S.genderSel);
    info.appendChild(gRow);

    const nRow = document.createElement('div');
    nRow.className = 'actor-field actor-field-col';
    nRow.innerHTML = '<label>Notes / characteristics <span class="actor-soon">(more soon)</span></label>';
    S.notesArea = document.createElement('textarea');
    S.notesArea.value = S.char.notes || '';
    S.notesArea.placeholder = 'Personality, backstory, niche… (free text)';
    nRow.appendChild(S.notesArea);
    info.appendChild(nRow);
    root.appendChild(info);

    // Voice
    root.appendChild(_buildVoiceSec());

    // Portfolio
    root.appendChild(_buildPortfolioSec());

    // Status line
    S.statusEl = document.createElement('div');
    S.statusEl.className = 'actor-status';
    root.appendChild(S.statusEl);
  }

  function _buildVoiceSec() {
    const sec = document.createElement('div');
    sec.className = 'actor-sec';
    sec.innerHTML = '<div class="actor-sec-h">Voice</div>';

    const row = document.createElement('div');
    row.className = 'actor-voice-row';
    S.voiceSel = document.createElement('select');
    window.buildVoiceSelect?.(S.voiceSel, S.char.voice || '');
    window.registerVoiceSelect?.(S.voiceSel, () => S.voiceSel.value || S.char.voice || '');
    const play = document.createElement('button');
    play.className = 'actor-voice-play'; play.textContent = '▷'; play.title = 'Preview selected voice';
    play.addEventListener('click', () => _previewSaved(play));
    row.appendChild(S.voiceSel); row.appendChild(play);
    sec.appendChild(row);

    const mk = document.createElement('button');
    mk.className = 'actor-voice-make';
    mk.textContent = '✨ Create a voice from the photo';
    mk.addEventListener('click', () => _toggleVoiceMaker(sec, mk));
    sec.appendChild(mk);

    S.voiceMaker = document.createElement('div');
    S.voiceMaker.className = 'actor-voice-maker';
    S.voiceMaker.style.display = 'none';
    sec.appendChild(S.voiceMaker);

    return sec;
  }

  function _toggleVoiceMaker(sec, btn) {
    if (S.voiceMaker.style.display === 'none') {
      S.voiceMaker.style.display = 'block';
      if (!S.voiceMakerBuilt) { _buildVoiceMaker(); S.voiceMakerBuilt = true; }
      btn.textContent = '▲ Hide voice creator';
    } else {
      S.voiceMaker.style.display = 'none';
      btn.textContent = '✨ Create a voice from the photo';
    }
  }

  function _buildVoiceMaker() {
    const m = S.voiceMaker;
    m.innerHTML = '<div class="actor-vm-step">1 · Character description</div>';
    S.charDescArea = document.createElement('textarea');
    S.charDescArea.placeholder = 'Hint or leave empty — click Analyze to fill from the portrait.';
    m.appendChild(S.charDescArea);
    const analyzeBtn = document.createElement('button');
    analyzeBtn.className = 'actor-vm-btn'; analyzeBtn.textContent = '🔍 Analyze';
    analyzeBtn.addEventListener('click', () => _analyze(analyzeBtn));
    m.appendChild(analyzeBtn);

    const s2 = document.createElement('div'); s2.className = 'actor-vm-step'; s2.textContent = '2 · Voice description';
    m.appendChild(s2);
    S.voiceDescArea = document.createElement('textarea');
    S.voiceDescArea.placeholder = '(auto-derived on Gen voice — editable)';
    m.appendChild(S.voiceDescArea);
    const genBtn = document.createElement('button');
    genBtn.className = 'actor-vm-btn'; genBtn.textContent = '🎤 Gen voice';
    genBtn.addEventListener('click', () => _genVoice(genBtn));
    m.appendChild(genBtn);

    S.previewWrap = document.createElement('div');
    S.previewWrap.className = 'actor-vm-previews';
    m.appendChild(S.previewWrap);
  }

  async function _analyze(btn) {
    const img = S.char.portrait || S.char.baseFace;
    if (!img) { _status('No image to analyze.', true); return; }
    btn.disabled = true; btn.textContent = '⏳';
    _status('Analyzing photo…');
    try {
      const d = await fetch('/api/audio/voice-design/analyze-character', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imagePath: img, userText: S.charDescArea.value.trim(), llmModel: _llm(), gender: (S.char.sourceObrazId == null ? (S.char.gender || '') : '') }),
      }).then(r => r.json());
      if (!d.success) throw new Error(d.error || 'analyze failed');
      S.charDescArea.value = d.characterDescription || '';
      _status('Description ready — click Gen voice.');
    } catch (e) { _status('Analyze error: ' + e.message, true); }
    finally { btn.disabled = false; btn.textContent = '🔍 Analyze'; }
  }

  async function _genVoice(btn) {
    btn.disabled = true; btn.textContent = '⏳';
    try {
      let desc = S.voiceDescArea.value.trim();
      if (desc.length < 20) {
        const cd = S.charDescArea.value.trim();
        if (cd.length < 20) { _status('Add/Analyze a character description first.', true); return; }
        _status('Deriving voice description…');
        const dd = await fetch('/api/audio/voice-design/derive-voice', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ characterDescription: cd, llmModel: _llm() }),
        }).then(r => r.json());
        if (!dd.success) throw new Error(dd.error || 'derive failed');
        S.voiceDescArea.value = dd.voiceDescription || '';
        S.fourWord = dd.fourWordSummary || '';
        desc = S.voiceDescArea.value.trim();
      }
      _status('Calling ElevenLabs (~30 s)…');
      const d = await fetch('/api/audio/voice-design/previews', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voiceDescription: desc }),
      }).then(r => r.json());
      if (!d.success) throw new Error(d.error || 'previews failed');
      S.previews = (d.previews || []).map(p => ({ ...p, savedVoiceId: null }));
      _renderPreviews();
      _status(`Got ${S.previews.length} previews — add the one you like.`);
    } catch (e) { _status('Gen voice error: ' + e.message, true); }
    finally { btn.disabled = false; btn.textContent = '🎤 Gen voice'; }
  }

  function _renderPreviews() {
    const w = S.previewWrap; w.innerHTML = '';
    let audio = null, activeBtn = null;
    S.previews.forEach((p, i) => {
      const row = document.createElement('div'); row.className = 'actor-vm-prow';
      const play = document.createElement('button'); play.textContent = '▷'; play.className = 'actor-vm-play';
      play.addEventListener('click', () => {
        if (audio) { audio.pause(); audio = null; if (activeBtn) activeBtn.textContent = '▷'; }
        if (activeBtn === play) { activeBtn = null; return; }
        audio = new Audio(p.audioPath); play.textContent = '■'; activeBtn = play;
        audio.play().catch(() => {});
        audio.addEventListener('ended', () => { play.textContent = '▷'; activeBtn = null; });
      });
      const lbl = document.createElement('span'); lbl.className = 'actor-vm-plbl';
      lbl.textContent = `Preview ${i + 1}${S.fourWord ? ' — ' + S.fourWord : ''}`;
      const add = document.createElement('button'); add.className = 'actor-vm-add';
      add.textContent = p.savedVoiceId ? '✓' : '+ Add';
      add.disabled = !!p.savedVoiceId;
      add.addEventListener('click', () => _addVoice(p, add));
      row.appendChild(play); row.appendChild(lbl); row.appendChild(add);
      w.appendChild(row);
    });
  }

  async function _addVoice(p, btn) {
    if (p.savedVoiceId) return;
    btn.disabled = true; btn.textContent = '⏳';
    const fw = (S.fourWord || '').trim();
    const last = fw.split(/\s+/).pop()?.toLowerCase() || '';
    const gender = last === 'male' ? 'm' : last === 'female' ? 'f' : (S.char.gender === 'male' ? 'm' : 'f');
    const baseName = fw || (S.voiceDescArea.value || '').split(/\s+/).slice(0, 6).join(' ') || 'voice';
    // Prefix the character name so the voice label says whom it was made for.
    const charName = (S.nameInput?.value || S.char.name || '').trim();
    const name = (charName ? charName + ' — ' : '') + baseName;
    try {
      const d = await fetch('/api/audio/voice-design/save', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selections: [{ generatedVoiceId: p.generatedVoiceId, name, gender, desc: fw, characterId: S.char.id }],
          voiceDescription: S.voiceDescArea.value.trim(),
        }),
      }).then(r => r.json());
      if (!d.success || !d.added?.length) throw new Error(d.error || 'save failed');
      p.savedVoiceId = d.added[0].voiceId;
      // Single-pick: keep only the chosen preview (the others were never converted
      // to permanent voices, so no ElevenLabs slots are used or need deleting).
      S.previews = S.previews.filter(x => x === p);
      await window.loadCustomVoices?.();
      window.buildVoiceSelect?.(S.voiceSel, p.savedVoiceId);
      S.voiceSel.value = p.savedVoiceId;
      _renderPreviews();
      _status(`Saved "${name}" and set it for ${charName || 'this character'}.`);
    } catch (e) { btn.disabled = false; btn.textContent = '+ Add'; _status('Add error: ' + e.message, true); }
  }

  let _savedAudio = null;
  async function _previewSaved(btn) {
    const v = S.voiceSel.value;
    if (!v) { _status('No voice selected.', true); return; }
    if (_savedAudio) { _savedAudio.pause(); _savedAudio = null; btn.textContent = '▷'; return; }
    btn.disabled = true; btn.textContent = '⏳';
    try {
      const d = await fetch('/api/audio/tts-preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voice: v }),
      }).then(r => r.json());
      if (!d.success) throw new Error(d.error);
      _savedAudio = new Audio(d.audioPath); btn.textContent = '■';
      _savedAudio.play().catch(() => {});
      _savedAudio.addEventListener('ended', () => { _savedAudio = null; btn.textContent = '▷'; });
    } catch (e) { _status('Preview error: ' + e.message, true); btn.textContent = '▷'; }
    finally { btn.disabled = false; }
  }

  // ── Portfolio (личное дело) ─────────────────────────────────────────────────
  function _buildPortfolioSec() {
    const sec = document.createElement('div');
    sec.className = 'actor-sec';
    sec.innerHTML = '<div class="actor-sec-h">Dossier — photoshoots <span class="actor-count">0</span></div>';
    const grid = document.createElement('div');
    grid.className = 'actor-portfolio';
    sec.appendChild(grid);
    S.portfolioSec = sec;
    S.portfolioGrid = grid;
    _renderPortfolio();
    return sec;
  }

  // (Re)build the portfolio grid from the latest obrazы — re-runs on the live
  // poll so a freshly-saved photoshoot shows its pose variations filling in.
  function _renderPortfolio() {
    const grid = S.portfolioGrid;
    if (!grid) return;
    const obrazy = (window.getObrazы?.() || []).filter(o => String(o.charId) === String(S.char.id));
    const cnt = S.portfolioSec?.querySelector('.actor-count');
    if (cnt) cnt.textContent = obrazy.length;
    _refreshFaceSourceVisibility();   // face source disappears once a photoshoot exists
    grid.innerHTML = '';
    if (!obrazy.length) {
      grid.innerHTML = '<div class="actor-portfolio-empty">No outfits yet. Dress this character on the main tab and press “Save obraz”.</div>';
      return;
    }
    obrazy.forEach(o => {
      const main = window.pickMainObrazImage?.(o) || o.char;
      const vars = Array.isArray(o.variations) ? o.variations : [];
      const pending = vars.some(v => v === null);
      const done = vars.filter(v => v && v !== 'error').length;

      const tile = document.createElement('div');
      tile.className = 'actor-pf-tile';
      tile.title = (o.name || '') + ' · click — view photoshoot · ✕✕ — delete';
      const img = document.createElement('img');
      loadThumb(img, main);
      const cap = document.createElement('div');
      cap.className = 'actor-pf-cap'; cap.textContent = o.name || '';
      tile.appendChild(img); tile.appendChild(cap);

      // Live "generating" overlay while pose variations are still coming in.
      if (pending) {
        const badge = document.createElement('div');
        badge.className = 'actor-pf-gen';
        badge.innerHTML = `<span class="actor-spin">⏳</span> ${done}/${vars.length}`;
        tile.appendChild(badge);
      }

      const del = document.createElement('button');
      del.className = 'actor-pf-del'; del.textContent = '✕';
      del.title = 'Double-click to delete this photoshoot';
      del.addEventListener('click', e => e.stopPropagation());
      del.addEventListener('dblclick', e => {
        e.stopPropagation();
        try { (window.deleteObraz || deleteObraz)(o.id); } catch {}
        _renderPortfolio();
        window.loadObrazы?.(); window.loadScenarioObrazы?.(); window.loadCharCol3Obrazy?.();
      });
      tile.appendChild(del);
      tile.addEventListener('click', () => _openPhotoshootViewer(o));
      grid.appendChild(tile);
    });
  }

  // Refresh the portfolio every 2s while any photoshoot still has pending
  // variations (the global pollPoseVariation writes results into LS; we just
  // re-render to reflect them). Stops itself once everything is resolved.
  function _startPortfolioPoll() {
    if (S.pfTimer) return;
    const anyPending = () => (window.getObrazы?.() || [])
      .filter(o => String(o.charId) === String(S.char.id))
      .some(o => Array.isArray(o.variations) && o.variations.some(v => v === null));
    if (!anyPending()) return;
    S.pfTimer = setInterval(() => {
      _renderPortfolio();
      if (!anyPending()) { clearInterval(S.pfTimer); S.pfTimer = null; }
    }, 2000);
  }

  // ── Photoshoot viewer — read-only gallery modal (main + pose variations) ─────
  // Exposed so other modules (Scenarios v2 role picker) can open the same viewer.
  window.openPhotoshootViewer = function (obraz) { _openPhotoshootViewer(obraz); };
  function _openPhotoshootViewer(obraz) {
    const main = window.pickMainObrazImage?.(obraz) || obraz.char;
    const photos = [];
    const push = p => { if (p && typeof p === 'string' && p !== 'error' && !photos.includes(p)) photos.push(p); };
    push(main); push(obraz.char);
    (obraz.variations || []).forEach(push);
    if (!photos.length) { window.setStatus?.('No photos in this photoshoot yet.'); return; }

    const ov = document.createElement('div');
    ov.className = 'psv-overlay';
    ov.addEventListener('mousedown', e => { if (e.target === ov) ov.remove(); });

    const box = document.createElement('div');
    box.className = 'psv-box';
    box.innerHTML = `
      <div class="psv-title"><span>📸 ${_esc(obraz.name || 'Photoshoot')}</span><button class="psv-x" title="Close">✕</button></div>
      <div class="psv-main"><img class="psv-main-img" alt=""></div>
      <div class="psv-strip"></div>`;
    ov.appendChild(box);
    document.body.appendChild(ov);

    const mainImg = box.querySelector('.psv-main-img');
    const strip   = box.querySelector('.psv-strip');
    const show = p => {
      mainImg.src = p + '?t=' + Date.now();
      strip.querySelectorAll('img').forEach(t => t.classList.toggle('sel', t.dataset.full === p));
    };
    mainImg.addEventListener('click', () => window.openLightbox?.(mainImg.src.split('?')[0]));
    photos.forEach((p, i) => {
      const t = document.createElement('img');
      loadThumb(t, p);
      t.dataset.full = p;
      t.title = i === 0 ? 'Main' : 'Variation ' + i;
      t.addEventListener('click', () => show(p));
      strip.appendChild(t);
    });
    box.querySelector('.psv-x').addEventListener('click', () => ov.remove());
    show(photos[0]);
  }

  // ── Delete ──────────────────────────────────────────────────────────────────
  function _wireDelete(btn) {
    let armed = false, t = null;
    btn.addEventListener('click', async () => {
      if (!armed) {
        armed = true; btn.classList.add('armed'); btn.textContent = '🗑 Click again to delete';
        t = setTimeout(() => { armed = false; btn.classList.remove('armed'); btn.textContent = '🗑 Delete character'; }, 2500);
        return;
      }
      clearTimeout(t);
      btn.disabled = true;
      try {
        // Cascade: delete every photoshoot (obraz) of this actor — files +
        // records — then the actor itself. The voice is intentionally KEPT in
        // the voice library (no prune here).
        const linked = (window.getObrazы?.() || []).filter(o => String(o.charId) === String(S.char.id));
        linked.forEach(o => { try { (window.deleteObraz || deleteObraz)(o.id); } catch {} });
        await fetch('/api/char-store/' + encodeURIComponent(S.char.id), { method: 'DELETE' });
        window.setStatus?.(`Character deleted (${linked.length} photoshoot(s) removed, voice kept).`);
        if (String(window._getCurrentCharId?.()) === String(S.char.id)) window._setCurrentCharId?.(null);
        window.loadActorChars?.();
        window.loadObrazы?.(); window.loadScenarioObrazы?.(); window.loadCharCol3Obrazy?.();
      } catch (e) { _status('Delete error: ' + e.message, true); btn.disabled = false; return; }
      _close();
    });
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  async function _save() {
    const patch = {
      name:   (S.nameInput.value || '').trim() || S.char.name,
      gender: S.genderSel.value || null,
      voice:  S.voiceSel?.value || S.char.voice || null,
      notes:  S.notesArea.value || '',
    };
    try {
      await fetch('/api/char-store/' + encodeURIComponent(S.char.id), {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
    } catch (e) { _status('Save error: ' + e.message, true); return; }
    Object.assign(S.char, patch);
    window.loadActorChars?.();
    _close();
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────
  function _status(t, err) { if (S?.statusEl) { S.statusEl.textContent = t || ''; S.statusEl.style.color = err ? '#c33' : '#567'; } }
  function _esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function _close() {
    if (!S) return;
    Object.values(S.refTimers || {}).forEach(t => t && clearInterval(t));
    if (S.pfTimer) { clearInterval(S.pfTimer); S.pfTimer = null; }
    if (_savedAudio) { try { _savedAudio.pause(); } catch {} _savedAudio = null; }
    S.overlay?.remove();
    S = null;
  }
})();
