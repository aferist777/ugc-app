/* ═══════════════════════════════════════════════════════════════════════════
   character-redesign.js — SANDBOX-ONLY enhancement for /character-redesign.html
   ---------------------------------------------------------------------------
   Reorganizes the existing Character DOM at runtime (the shared character.js is
   NOT modified). Nodes are REPARENTED (appendChild), so every original id and
   its event listeners are preserved and character.js keeps working untouched.

   Layout after reorg (3 columns):
     LEFT   = "Character" creator (name, quick params, TPDNE / Advanced /
              Generate base, refine, Save char). Creation-only: clothing,
              environments, poses and photoshoots live on the Scenarios page.
     CENTRE = the face preview + history nav (unchanged Media column)
     RIGHT  = a saved-characters gallery (replaces the dropdown), Load/Edit/Delete
              on hover + a "+ New" card.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var booted = false;

  function $(id) { return document.getElementById(id); }
  function el(tag, cls) { var e = document.createElement(tag); if (cls) e.className = cls; return e; }
  function fn(name) { return (typeof window[name] === 'function') ? window[name] : null; }

  /* ── Character-creator schema + master-prompt (Phase 1: UI + template) ───── */
  var PARAM_SCHEMA = [
    { group: 'Basics', params: [
      { k: 'age',       label: 'Age',       opts: ['teen', '20s', '30s', '40s', '50s', '60+'] },
      { k: 'gender',    label: 'Gender',    opts: ['female', 'male', 'androgynous'] },
      { k: 'ethnicity', label: 'Ethnicity', opts: ['Caucasian', 'African', 'East Asian', 'South Asian', 'Hispanic', 'Middle Eastern', 'mixed'] },
      { k: 'body',      label: 'Body type', opts: ['slim', 'athletic', 'average', 'curvy', 'plus-size'] },
      { k: 'skin',      label: 'Skin tone', opts: ['very fair', 'fair', 'light', 'medium', 'olive', 'tan', 'brown', 'dark', 'deep'] }
    ]},
    { group: 'Hair', params: [
      { k: 'hairColor',  label: 'Hair color',  opts: ['black', 'dark brown', 'brown', 'light brown', 'blonde', 'platinum', 'red', 'auburn', 'grey', 'white', 'vivid dyed'] },
      { k: 'hairLength', label: 'Hair length', opts: ['bald', 'buzzcut', 'short', 'medium', 'long', 'very long'] },
      { k: 'hairStyle',  label: 'Hair style',  opts: ['straight', 'wavy', 'curly', 'coily', 'ponytail', 'bun', 'braids', 'undercut', 'slicked back'] }
    ]},
    { group: 'Eyes & face', params: [
      { k: 'eyeColor',   label: 'Eye color',   opts: ['brown', 'hazel', 'green', 'blue', 'grey', 'amber'] },
      { k: 'eyeShape',   label: 'Eye shape',   opts: ['almond', 'round', 'hooded', 'monolid', 'downturned', 'upturned'] },
      { k: 'faceShape',  label: 'Face shape',  opts: ['oval', 'round', 'square', 'heart', 'diamond', 'long'] },
      { k: 'eyebrows',   label: 'Eyebrows',    opts: ['natural', 'thick', 'thin', 'arched', 'straight', 'bushy'] },
      { k: 'facialHair', label: 'Facial hair', opts: ['none', 'stubble', 'short beard', 'full beard', 'goatee', 'moustache'] }
    ]},
    { group: 'Style', params: [
      { k: 'makeup',  label: 'Makeup',     opts: ['none', 'natural', 'glam', 'smoky', 'editorial', 'bold lip'] },
      { k: 'emotion', label: 'Expression', opts: ['neutral', 'smiling', 'serious', 'confident', 'playful', 'sad', 'angry'] }
    ]},
    { group: 'Marks', params: [
      { k: 'scars',     label: 'Scars',          opts: ['none', 'cheek scar', 'brow scar', 'lip scar', 'multiple scars'] },
      { k: 'tattoos',   label: 'Face tattoos',   opts: ['none', 'small teardrop', 'tribal', 'script', 'geometric'] },
      { k: 'piercings', label: 'Piercings',      opts: ['none', 'nose stud', 'septum', 'eyebrow', 'lip', 'multiple ear'] },
      { k: 'freckles',  label: 'Freckles/moles', opts: ['none', 'light freckles', 'heavy freckles', 'beauty mark'] }
    ]}
  ];
  var _NONE_DEFAULT = ['scars', 'tattoos', 'piercings', 'freckles', 'facialHair', 'makeup'];
  var _MARKS_KEYS = ['scars', 'tattoos', 'piercings', 'freckles'];   // excluded from rnd
  // Realism markers WITHOUT the iPhone-14 / home-video framing — that framing made
  // the model render a phone in the subject's hand. Phase 2 base-gen mirrors this.
  var REALISM = 'Photorealistic, natural detailed skin texture with visible pores, realistic soft studio lighting, sharp focus, high detail, no text, no watermark, no phone, no hands.';
  var NEUTRAL_BG = 'Plain neutral seamless studio backdrop, mid-tone grey, clearly contrasting with the subject for clean separation.';

  // Per-option visual descriptors appended to the EDIT instruction so a change
  // renders with concrete features (e.g. ethnicity East Asian -> almond eyes).
  var OPTION_DESC = {
    age: { 'teen': 'youthful teenage face, smooth skin, soft features', '20s': 'young adult, taut smooth skin, fresh complexion', '30s': 'early maturity, subtle expression lines', '40s': 'mature adult, light wrinkles, slight nasolabial folds', '50s': 'visible wrinkles, softer jawline, mature skin', '60+': 'elderly, deep wrinkles, age spots, thinner skin' },
    gender: { 'female': 'feminine facial structure, softer jaw, fuller lips', 'male': 'masculine facial structure, stronger jaw and brow', 'androgynous': 'gender-ambiguous, balanced soft and strong features' },
    ethnicity: { 'Caucasian': 'European features, narrower nose, varied eye colour', 'African': 'African features, broader nose, fuller lips, deep skin, coily hair', 'East Asian': 'East Asian features, monolid or lightly hooded almond eyes, softer nose bridge, straight dark hair', 'South Asian': 'South Asian features, warm brown skin, large dark eyes, thick dark hair', 'Hispanic': 'Latin features, warm olive skin, dark eyes and hair', 'Middle Eastern': 'Middle Eastern features, olive skin, strong brows, dark almond eyes', 'mixed': 'mixed-heritage blended ethnic features' },
    body: { 'slim': 'slender lean build, narrow frame, slim face with defined cheekbones, slender neck and shoulders', 'athletic': 'toned athletic build, defined muscle, lean toned face with a sharp jawline, firm neck and shoulders', 'average': 'average balanced build, natural proportions, balanced face, cheeks and neck', 'curvy': 'curvy build, fuller hips and bust, soft fuller face, rounded cheeks, smooth fuller neckline', 'plus-size': 'plus-size heavier build, fuller body, fuller rounder face, full cheeks, soft double chin, broader neck and shoulders' },
    skin: { 'very fair': 'very fair porcelain skin, cool undertone', 'fair': 'fair light skin, subtle warmth', 'light': 'light skin, neutral undertone', 'medium': 'medium beige skin, warm undertone', 'olive': 'olive-toned skin, warm-green undertone', 'tan': 'sun-tanned golden-brown skin', 'brown': 'rich brown skin', 'dark': 'deep brown skin', 'deep': 'very deep ebony skin' },
    hairColor: { 'black': 'black hair', 'dark brown': 'dark brown hair', 'brown': 'medium brown hair', 'light brown': 'light brown hair', 'blonde': 'blonde hair', 'platinum': 'platinum-blonde almost-white hair', 'red': 'natural red ginger hair', 'auburn': 'reddish-brown auburn hair', 'grey': 'grey hair', 'white': 'white hair', 'vivid dyed': 'vivid unnatural dyed colour' },
    hairLength: { 'bald': 'bald, no hair on the scalp', 'buzzcut': 'very short buzzcut', 'short': 'short hair above the ears', 'medium': 'medium-length hair to jaw or shoulders', 'long': 'long hair past the shoulders', 'very long': 'very long hair well past the chest' },
    hairStyle: { 'straight': 'straight smooth hair', 'wavy': 'loose wavy hair', 'curly': 'defined curls', 'coily': 'tight coily afro-textured hair', 'ponytail': 'hair tied back in a ponytail', 'bun': 'hair gathered in a bun', 'braids': 'braided hair', 'undercut': 'undercut, shaved sides with longer top', 'slicked back': 'slicked-back hair' },
    eyeColor: { 'brown': 'warm brown eyes', 'hazel': 'hazel green-brown eyes', 'green': 'green eyes', 'blue': 'blue eyes', 'grey': 'grey eyes', 'amber': 'amber golden eyes' },
    eyeShape: { 'almond': 'almond eyes with gently tapered corners', 'round': 'large round open eyes', 'hooded': 'hooded eyes with a covered lid crease', 'monolid': 'monolid eyes without a visible crease', 'downturned': 'downturned outer eye corners', 'upturned': 'upturned cat-eye corners' },
    faceShape: { 'oval': 'oval balanced face, gently rounded jaw', 'round': 'round full face, soft cheeks', 'square': 'square face, strong angular jaw', 'heart': 'heart face, wide forehead and pointed chin', 'diamond': 'diamond face, wide cheekbones, narrow forehead and chin', 'long': 'long oblong narrow face' },
    eyebrows: { 'natural': 'natural medium brows', 'thick': 'thick full brows', 'thin': 'thin sparse brows', 'arched': 'high arched brows', 'straight': 'flat straight brows', 'bushy': 'bushy untrimmed brows' },
    facialHair: { 'none': 'clean-shaven, no facial hair', 'stubble': 'light stubble', 'short beard': 'short trimmed beard', 'full beard': 'full thick beard', 'goatee': 'goatee on the chin', 'moustache': 'moustache above the lip' },
    scars: { 'none': 'smooth skin, no scars', 'cheek scar': 'a scar across one cheek', 'brow scar': 'a scar through one eyebrow', 'lip scar': 'a small scar near the lip', 'multiple scars': 'several visible facial scars' },
    tattoos: { 'none': 'no face tattoos', 'small teardrop': 'a small teardrop tattoo under one eye', 'tribal': 'a tribal-pattern face tattoo', 'script': 'a small script tattoo on the face', 'geometric': 'a geometric line tattoo on the face' },
    piercings: { 'none': 'no piercings', 'nose stud': 'a small nose stud', 'septum': 'a septum ring', 'eyebrow': 'an eyebrow piercing', 'lip': 'a lip piercing', 'multiple ear': 'multiple ear piercings' },
    freckles: { 'none': 'clear skin, no freckles', 'light freckles': 'a light scattering of freckles across the nose', 'heavy freckles': 'dense freckles across cheeks and nose', 'beauty mark': 'a single beauty mark on the face' },
    makeup: { 'none': 'bare natural skin, no makeup', 'natural': 'subtle natural makeup', 'glam': 'full glam makeup, defined eyes and lips', 'smoky': 'smoky eye makeup', 'editorial': 'bold editorial makeup', 'bold lip': 'bold bright lipstick' },
    emotion: { 'neutral': 'neutral relaxed expression', 'smiling': 'a warm genuine smile', 'serious': 'a serious composed expression', 'confident': 'a confident assured expression', 'playful': 'a playful cheeky expression', 'sad': 'a sad downcast expression', 'angry': 'an angry intense expression' }
  };
  var _mpDirty = false;
  var _advMode = false;   // when false, only the 4 basic params feed the prompt/generation
  var _optCache = {};      // AI-optimized prompts, keyed by the JSON spec text
  var _loaded = null;      // character loaded via a gallery card: { charId, restore } (load/unload toggle)
  var _galRender = null;   // boot assigns renderGallery here so toggleLoad can refresh the gallery
  // Advanced popup working image (separate from the main active image until "Save").
  var _advImg = '';
  var _advBusyState = { iv: null, start: 0, est: 12000, label: '' };
  function _allParamKeys() { var ks = []; PARAM_SCHEMA.forEach(function (g) { g.params.forEach(function (p) { ks.push(p.k); }); }); return ks; }

  // Sandbox-only English name generator: First "Nick" Last. Does NOT touch the shared randomName.
  var _GN_FIRST = ['Ava', 'Mia', 'Zoe', 'Lily', 'Ella', 'Nora', 'Ruby', 'Iris', 'Jake', 'Liam', 'Noah', 'Ethan', 'Mason', 'Leo', 'Kai', 'Max', 'Cole', 'Finn', 'Owen', 'Reed'];
  var _GN_NICK = ['Nova', 'Maverick', 'Ghost', 'Ace', 'Blaze', 'Echo', 'Frost', 'Raven', 'Pixel', 'Storm', 'Onyx', 'Lux', 'Sable', 'Riot', 'Hawk', 'Jet', 'Saint', 'Wren'];
  var _GN_LAST = ['Carter', 'Reed', 'Hayes', 'Brooks', 'Stone', 'Vance', 'Cruz', 'Wolfe', 'Quinn', 'Lane', 'Pierce', 'Knox', 'Rhodes', 'Blake', 'Mercer', 'Hale', 'Dane', 'Vale'];
  function genName() { function pk(a) { return a[Math.floor(Math.random() * a.length)]; } return pk(_GN_FIRST) + ' "' + pk(_GN_NICK) + '" ' + pk(_GN_LAST); }

  function crVal(k) { var s = document.getElementById('cr-p-' + k); return s ? s.value : ''; }

  // JSON spec (Phase 2 compiles it per engine: prose for diffusion, JSON for LLM-front).
  function assembleMasterPrompt() {
    var v = {}; PARAM_SCHEMA.forEach(function (g) { g.params.forEach(function (p) { v[p.k] = crVal(p.k); }); });
    var spec = { type: 'character portrait', framing: 'head-and-shoulders, looking at camera' };
    if (v.age) spec.age = v.age;
    if (v.gender) spec.gender = v.gender;
    if (v.ethnicity) spec.ethnicity = v.ethnicity;
    if (v.body) spec.body_type = v.body + ((OPTION_DESC.body && OPTION_DESC.body[v.body]) ? (' (' + OPTION_DESC.body[v.body] + ')') : '');
    if (v.emotion) spec.expression = v.emotion;
    {   // advanced params always feed the spec (the popup exposes them all)
      if (v.skin) spec.skin_tone = v.skin;
      var hair = {}; if (v.hairColor) hair.color = v.hairColor; if (v.hairLength) hair.length = v.hairLength; if (v.hairStyle) hair.style = v.hairStyle;
      if (Object.keys(hair).length) spec.hair = hair;
      var eyes = {}; if (v.eyeColor) eyes.color = v.eyeColor; if (v.eyeShape) eyes.shape = v.eyeShape;
      if (Object.keys(eyes).length) spec.eyes = eyes;
      if (v.faceShape) spec.face_shape = v.faceShape;
      if (v.eyebrows) spec.eyebrows = v.eyebrows;
      if (v.facialHair && v.facialHair !== 'none') spec.facial_hair = v.facialHair;
      var marks = [];
      if (v.scars && v.scars !== 'none') marks.push(v.scars);
      if (v.tattoos && v.tattoos !== 'none') marks.push('tattoo: ' + v.tattoos);
      if (v.piercings && v.piercings !== 'none') marks.push('piercing: ' + v.piercings);
      if (v.freckles && v.freckles !== 'none') marks.push(v.freckles);
      if (marks.length) spec.marks = marks;
      if (v.makeup && v.makeup !== 'none') spec.makeup = v.makeup;
    }
    spec.background = 'plain neutral mid-grey studio backdrop, contrasting with the subject';
    if (localStorage.getItem('char_create_realism_v1') !== '0') {   // Create-column realism toggle (default on)
      spec.realism = ['photorealistic', 'detailed skin texture with visible pores', 'soft studio lighting', 'sharp focus', 'high detail'];
    }
    spec.negative = ['text', 'watermark', 'phone', 'hands'];
    return JSON.stringify(spec, null, 2);
  }
  function crStatus(m) { var s = document.getElementById('cr-status'); if (s) s.textContent = m || ''; }
  function updatePrompt() { var ta = document.getElementById('cr-master-prompt'); if (ta && !_mpDirty) ta.value = assembleMasterPrompt(); }

  // Quick params shown in the left column; the rest live in the Advanced popup.
  var BASIC = ['age', 'gender', 'ethnicity', 'body', 'emotion'];

  function paramByKey(k) { var r = null; PARAM_SCHEMA.forEach(function (g) { g.params.forEach(function (p) { if (p.k === k) r = p; }); }); return r; }

  function crRow(p) {
    var row = el('div', 'cr-row');
    var lab = el('label', 'cr-row-lab'); lab.textContent = p.label; lab.htmlFor = 'cr-p-' + p.k;
    var sel = el('select', 'cr-row-sel'); sel.id = 'cr-p-' + p.k;
    var o0 = document.createElement('option'); o0.value = ''; o0.textContent = '—'; sel.appendChild(o0);
    p.opts.forEach(function (o) { var op = document.createElement('option'); op.value = o; op.textContent = o; sel.appendChild(op); });
    if (_NONE_DEFAULT.indexOf(p.k) >= 0) sel.value = 'none';
    sel.addEventListener('change', updatePrompt);
    var edit = el('button', 'cr-edit'); edit.type = 'button'; edit.textContent = '✎';
    edit.title = 'Apply just this parameter as an edit to the current image';
    edit.addEventListener('click', function () { paramEditClick(p, edit); });
    row.appendChild(lab); row.appendChild(sel); row.appendChild(edit);
    return row;
  }

  function _rnd(keys) {
    PARAM_SCHEMA.forEach(function (g) { g.params.forEach(function (p) {
      if (keys.indexOf(p.k) < 0) return;
      var sel = document.getElementById('cr-p-' + p.k); if (!sel) return;
      sel.value = p.opts[Math.floor(Math.random() * p.opts.length)];
    }); });
    _mpDirty = false; updatePrompt(); crStatus('');
  }
  function _advKeys() { var ks = []; PARAM_SCHEMA.forEach(function (g) { g.params.forEach(function (p) { if (BASIC.indexOf(p.k) < 0) ks.push(p.k); }); }); return ks; }
  // Left rnd: only the 4 basics + a fresh English name. Popup rnd: only the advanced params.
  function randomizeBasic() { _rnd(BASIC); var nm = $('char-name'); if (nm) nm.value = genName(); }
  function randomizeAdvanced() { _rnd(_advKeys()); }
  // Reset every parameter to nothing (both canonical and popup-mirror selects).
  function _rstParams() {
    PARAM_SCHEMA.forEach(function (g) { g.params.forEach(function (p) {
      var sel = document.getElementById('cr-p-' + p.k); if (sel) sel.value = '';
      var mir = document.getElementById('cr-ap-' + p.k); if (mir) mir.value = '';
    }); });
    _mpDirty = false; updatePrompt(); crStatus('');
  }
  // AI-optimize: rewrite the JSON spec into an engine-ideal portrait prompt via
  // Hermes 405B, drop it into the master-prompt textarea (cached per spec).
  function aiOptimizeClick(btn) {
    var specText = assembleMasterPrompt();
    var ta = document.getElementById('cr-master-prompt');
    if (_optCache[specText]) { if (ta) { ta.value = _optCache[specText]; _mpDirty = true; } crStatus('Optimized (cached).'); return; }
    crStatus('Optimizing prompt (Hermes 405B)...');
    if (btn) btn.disabled = true;
    fetch('/api/character-creator/optimize', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spec: specText })
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.success || !d.prompt) throw new Error((d && d.error) || 'no prompt');
        _optCache[specText] = d.prompt;
        if (ta) { ta.value = d.prompt; _mpDirty = true; }
        crStatus('Prompt optimized - Generate base will use it.');
      })
      .catch(function (e) { crStatus('Optimize failed: ' + ((e && e.message) || e)); })
      .then(function () { if (btn) btn.disabled = false; });
  }

  // Generate the base portrait from the JSON spec (text-to-image, no source
  // image) via the new /api/character-creator/generate endpoint, then show it.
  function genBaseClick() { _doGenBase({ busyMain: true, onResult: function (img) { _applyBase(img); } }); }

  // Generate base = ANALYZE then GENERATE: the spec is first composed into a detailed
  // portrait prompt via the LLM (optimize), then that prompt is generated. A manually
  // edited master prompt is used as-is. opts: { busyMain, onStart, onResult, onError }.
  function _doGenBase(opts) {
    opts = opts || {};
    var ta = document.getElementById('cr-master-prompt');
    var dirty = _mpDirty && ta && ta.value && ta.value.trim();
    var specText = assembleMasterPrompt();
    var createEngine = (typeof window.getCharCreateEngine === 'function') ? window.getCharCreateEngine() : (localStorage.getItem('char_create_engine_v1') || 'z-turbo');
    var btns = document.querySelectorAll('.cr-genbase');
    Array.prototype.forEach.call(btns, function (b) { b.disabled = true; });
    if (opts.busyMain) { crStatus('Analyzing + generating base...'); crShowBusy('Character base'); }
    else if (opts.onStart) opts.onStart('Analyzing + generating base...');
    var promptStep = dirty
      ? Promise.resolve(ta.value)
      : fetch('/api/character-creator/optimize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ spec: specText }) })
          .then(function (r) { return r.json(); }).then(function (d) { return (d && d.success && d.prompt) ? d.prompt : specText; }).catch(function () { return specText; });
    promptStep.then(function (prompt) {
      return fetch('/api/character-creator/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: prompt, imageEngine: createEngine }) })
        .then(function (r) { return r.json(); })
        .then(function (d) { if (!d || !d.success || !d.taskId) throw new Error((d && d.error) || 'No taskId'); var poll = fn('pollUntilDone'); return poll ? poll('/api/status/' + encodeURIComponent(d.taskId), 'Character base') : _manualPoll(d.taskId); });
    })
      .then(function (imagePath) { if (opts.busyMain) crHideBusy(true); if (opts.onResult) opts.onResult(imagePath); })
      .catch(function (e) { if (opts.busyMain) crHideBusy(false); (opts.onError || crStatus)('Generation failed: ' + ((e && e.message) || e)); })
      .then(function () { Array.prototype.forEach.call(btns, function (b) { b.disabled = false; }); });
  }
  // Show the freshly generated base in the centre preview and mark it a normal,
  // saveable image (origin 'normal' -> Save character + the Apply gate open).
  function _applyBase(imagePath, opts) {
    opts = opts || {};
    _loaded = null;   // a freshly generated image ends any card-load baseline
    if (!imagePath) { crStatus('No image returned'); return; }
    var sf = fn('showFace'); if (sf) sf(imagePath);
    try { generatedImagePath = imagePath; } catch (e) {}
    var ph = fn('pushToHistory'); if (ph) ph(imagePath);   // grow session history -> show the centre nav arrows
    var so = fn('setActiveImageOrigin'); if (so) so('normal');
    if (!opts.silent) crStatus('Base ready.');
    if (!opts.keepOpen) closeAdvPopup();
  }

  // Click a character card -> LOAD it (active image + currentCharId via the shared
  // _loadActorByItem, so you can apply lookbooks / save obrazy). Click the same
  // card again -> UNLOAD: restore the exact working state (image, history, origin,
  // currentCharId) that existed before loading, so a pre-load generated image is
  // never lost.
  function toggleLoad(card, c) {
    if (_loaded && String(_loaded.charId) === String(c.id)) {
      // UNLOAD -> restore the pre-load working image (canonical showFace) + state,
      // and clear the active character so the blue ring drops (no double-activation).
      var r = _loaded.restore;
      _loaded = null;
      var sc = fn('_setCurrentCharId'); if (sc) sc(null);
      var so = fn('setActiveImageOrigin'); if (so) so(r.origin);
      try { generationHistory = r.gh; } catch (e) {}
      try { historyIndex = r.gi; } catch (e) {}
      try { generatedImagePath = r.gen; } catch (e) {}
      var sf = fn('showFace');
      if (r.gen && sf) {
        sf(r.gen + (String(r.gen).indexOf('?') < 0 ? ('?t=' + Date.now()) : ''));
      } else {
        var fpv = $('face-preview'), ph = $('face-placeholder');
        if (fpv) { fpv.removeAttribute('src'); fpv.style.display = 'none'; }
        if (ph) ph.style.display = '';
      }
      var rh = fn('renderHistoryNav'); if (rh) rh();
      var sa = fn('saveAppState'); if (sa) sa();
      if (_galRender) _galRender();
      crStatus('Unloaded "' + (c.name || '') + '".');
      return;
    }
    // LOAD (or switch). Capture the canonical pre-load working state.
    if (!_loaded) {
      var gc = fn('_getCurrentCharId'); var go = fn('getActiveImageOrigin');
      _loaded = { charId: c.id, restore: {
        curId: gc ? gc() : null,
        origin: go ? go() : null,
        gen: (typeof generatedImagePath !== 'undefined' ? generatedImagePath : null),
        gh: (typeof generationHistory !== 'undefined' ? generationHistory.slice() : []),
        gi: (typeof historyIndex !== 'undefined' ? historyIndex : -1)
      }};
    } else {
      _loaded.charId = c.id;   // switch the load to another character; keep the saved baseline
    }
    // Load the frame the card is CURRENTLY showing (base on frame 1, or a flipped
    // photoshoot), not always the created-from base. History = just that frame.
    var frame = (card && card._curFull) || '';
    var f = fn('_loadActorByItemFrame');
    if (f) { try { f(c, frame); } catch (e) { console.warn('[cr] load failed', e); var f0 = fn('_loadActorByItem'); if (f0) f0(c); } }
    else { var f1 = fn('_loadActorByItem'); if (f1) f1(c); }
    if (_galRender) _galRender();
    crStatus('Loaded "' + (c.name || '') + '".');
  }

  // ── On-image generation overlay (shimmer + estimate progress bar + timer) ──────
  // Replaces the bottom-right activity widget on this page. Estimate comes from a
  // per-label EMA of past durations (localStorage); the bar eases toward ~95% and
  // only completes when the real task finishes.
  var _busy = { el: null, bar: null, time: null, iv: null, start: 0, est: 12000, label: '' };
  function _crAvgStore() { try { return JSON.parse(localStorage.getItem('cr_gen_avg_v1') || '{}'); } catch (e) { return {}; } }
  function _crEst(label) { var v = _crAvgStore()[label]; return (typeof v === 'number' && v > 1000) ? v : 12000; }
  function _crRecord(label, ms) {
    if (!(ms > 0)) return;
    var s = _crAvgStore(); var prev = s[label];
    s[label] = (typeof prev === 'number') ? Math.round(prev * 0.6 + ms * 0.4) : ms;   // EMA
    try { localStorage.setItem('cr_gen_avg_v1', JSON.stringify(s)); } catch (e) {}
  }
  function _ensureBusyEl() {
    if (_busy.el) return _busy.el;
    var dz = $('face-dropzone'); if (!dz) return null;
    var ov = el('div', 'cr-busy'); ov.id = 'cr-busy';
    ov.innerHTML = '<div class="cr-busy-shimmer"></div>' +
      '<div class="cr-busy-info"><div class="cr-busy-time">0s</div>' +
      '<div class="cr-busy-track"><div class="cr-busy-bar"></div></div></div>';
    dz.appendChild(ov);
    _busy.el = ov; _busy.bar = ov.querySelector('.cr-busy-bar'); _busy.time = ov.querySelector('.cr-busy-time');
    return ov;
  }
  function crShowBusy(label) {
    var ov = _ensureBusyEl(); if (!ov) return;
    if (_busy.iv) clearInterval(_busy.iv);
    _busy.label = label || 'Generation';
    _busy.start = Date.now();
    _busy.est = _crEst(_busy.label);
    ov.classList.add('cr-on');
    var tick = function () {
      var elapsed = Date.now() - _busy.start;
      var rem = Math.round((_busy.est - elapsed) / 1000);   // seconds left, from the EMA estimate
      if (_busy.time) _busy.time.textContent = rem > 0 ? ('~' + rem + 's') : 'finishing…';
      var frac = 1 - Math.exp(-elapsed / _busy.est);     // ease toward the estimate
      if (_busy.bar) _busy.bar.style.width = Math.min(95, Math.round(frac * 96)) + '%';
    };
    tick();
    _busy.iv = setInterval(tick, 250);
  }
  function crHideBusy(ok) {
    if (_busy.iv) { clearInterval(_busy.iv); _busy.iv = null; }
    if (ok && _busy.start) _crRecord(_busy.label, Date.now() - _busy.start);
    if (_busy.bar) _busy.bar.style.width = '100%';
    var ov = _busy.el;
    if (ov) setTimeout(function () { ov.classList.remove('cr-on'); if (_busy.bar) _busy.bar.style.width = '0%'; }, 240);
    _busy.start = 0;
  }
  // The shared apply path (_applyAssetToActive) toggles `.generating` on the
  // dropzone via setLoading() but doesn't call crShowBusy — bridge it here.
  function _watchBusy() {
    var dz = $('face-dropzone'); if (!dz || !window.MutationObserver) return;
    var mo = new MutationObserver(function () {
      var gen = dz.classList.contains('generating');
      if (gen && !_busy.iv) crShowBusy('Applying');
      else if (!gen && _busy.iv) crHideBusy(true);
    });
    mo.observe(dz, { attributes: true, attributeFilter: ['class'] });
  }

  // Per-parameter edit (✎): apply just this one detail to the CURRENT image via
  // img2img (/api/generate) using the selected Edit (i2i) engine. Identity / pose
  // / background are held by buildPrompt's hard "keep the same person..." lock.
  function paramEditClick(p, btn, opts) {
    opts = opts || {};
    var popup = !!opts.popup;   // popup mode targets its own image (opts.onResult), not the main active one
    var say = popup ? _advStatus : crStatus;
    var base = opts.base || ((typeof generatedImagePath !== 'undefined' && generatedImagePath) ? generatedImagePath : '');
    if (!base) { var fp = document.getElementById('face-preview'); var src = fp ? (fp.getAttribute('src') || '') : ''; base = src ? src.split('?')[0] : ''; }
    if (!base) { say('Generate a base first.'); return; }
    var val = crVal(p.k);
    if (!val) { say('Pick a value for ' + p.label + ' first.'); return; }
    var label = p.label.toLowerCase();
    var desc = (OPTION_DESC[p.k] && OPTION_DESC[p.k][val]) || '';
    var instr;
    if (p.k === 'body' && val !== 'none') {
      // Body type rarely fits a head-and-shoulders crop, so reflect the build in whatever
      // IS visible (face shape, cheeks, jawline, chin, neck, shoulders) without reframing.
      instr = 'Change the body type to ' + val + (desc ? ' — ' + desc : '') +
        '. Reflect this build wherever it is visible: if the body is in frame, adjust the whole figure; if the shot is head-and-shoulders or face-only, reflect it in the face shape, cheeks, jawline, chin, neck and shoulders. Keep the SAME framing and crop, the same person, identity, hair, pose and background, and change nothing else.';
    } else if (val === 'none') {
      instr = (desc ? (desc.charAt(0).toUpperCase() + desc.slice(1)) : 'Remove any ' + label + ', leave none') + '. Keep everything else identical.';
    } else {
      instr = 'Change the ' + label + ' to ' + val + (desc ? ' — ' + desc : '') + '. Keep everything else identical.';
    }
    var engine = (typeof window.getCharImageEngine === 'function')
      ? window.getCharImageEngine()
      : (localStorage.getItem('char_image_engine_v1') || 'firered-edit');
    say('Applying ' + label + (val === 'none' ? ' (remove)' : ' = ' + val) + '…');
    if (popup) _advBusy(true, 'Edit ' + label); else crShowBusy('Edit ' + label);
    if (btn) btn.disabled = true;
    var editBody = { imagePath: base, extraInstruction: instr, imageEngine: engine, skipTranslate: true };
    if (localStorage.getItem('char_edit_realism_v1') !== '0') {   // Edit-column realism toggle (default on)
      editBody.withRealism = true;
      var _rm = (window.getRealismMarkersState && window.getRealismMarkersState()) || {};
      editBody.enabledMarkers = Object.keys(_rm).filter(function (k) { return _rm[k] !== false; });
    }
    fetch('/api/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editBody)
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.success || !d.taskId) throw new Error((d && d.error) || 'No taskId');
        var poll = fn('pollUntilDone');
        return poll ? poll('/api/status/' + encodeURIComponent(d.taskId), 'Edit ' + p.label) : _manualPoll(d.taskId);
      })
      .then(function (imagePath) {
        if (popup) { _advBusy(false); (opts.onResult || function () {})(imagePath); }
        else { crHideBusy(true); _applyBase(imagePath, { keepOpen: true, silent: true }); }
        say('Applied: ' + label + '.');
      })
      .catch(function (e) { if (popup) _advBusy(false); else crHideBusy(false); say('Edit failed: ' + ((e && e.message) || e)); })
      .then(function () { if (btn) btn.disabled = false; });
  }
  function _manualPoll(taskId) {
    return new Promise(function (resolve, reject) {
      var tries = 0;
      (function step() {
        fetch('/api/status/' + encodeURIComponent(taskId))
          .then(function (r) { return r.json(); })
          .then(function (s) {
            if (s && s.state === 'success') return resolve(s.imagePath);
            if (s && s.state === 'failed') return reject(new Error(s.error || 'generation failed'));
            if (tries++ > 100) return reject(new Error('timeout'));
            setTimeout(step, 3000);
          })
          .catch(reject);
      })();
    });
  }

  // LEFT column: 4 quick params + rnd + [Advanced | Generate base].
  function buildCreator() {
    var wrap = el('div', 'cr-creator');
    var head = el('div', 'cr-creator-head');
    var nameSlot = el('div', 'cr-name-slot'); nameSlot.id = 'cr-name-slot';   // #char-name is moved here
    var rnd = el('button', 'cr-rnd'); rnd.type = 'button'; rnd.textContent = 'rnd'; rnd.title = 'Randomize basics + name';
    rnd.addEventListener('click', randomizeBasic);
    head.appendChild(nameSlot); head.appendChild(rnd); wrap.appendChild(head);

    BASIC.forEach(function (k) { var p = paramByKey(k); if (p) wrap.appendChild(crRow(p)); });

    var bar = el('div', 'cr-genrow');
    var adv = el('button', 'cr-adv-btn'); adv.type = 'button'; adv.textContent = '⚙ Advanced';
    adv.title = 'Full parameters + master prompt';
    adv.addEventListener('click', openAdvPopup);
    var gen = el('button', 'cr-genbase'); gen.type = 'button'; gen.textContent = '▶ Generate base';
    gen.addEventListener('click', genBaseClick);
    bar.appendChild(adv); bar.appendChild(gen); wrap.appendChild(bar);
    var st = el('div', 'cr-status'); st.id = 'cr-status'; wrap.appendChild(st);

    setTimeout(updatePrompt, 0);
    return wrap;
  }

  // Advanced popup: every non-basic param + the editable master prompt. Built
  // eagerly (hidden) so all selects exist for rnd / the master prompt from the start.
  // ── Advanced popup helpers (its own working image until "Save → active") ───────
  function _advStatus(m) { var s = document.getElementById('cr-adv-status'); if (s) s.textContent = m || ''; }
  function _advShow() {
    var im = document.getElementById('cr-adv-preview'), ph = document.getElementById('cr-adv-ph'); if (!im) return;
    if (_advImg) { if (window.loadThumb) window.loadThumb(im, _advImg); else im.src = _advImg + '?t=' + Date.now(); im.style.display = ''; if (ph) ph.style.display = 'none'; }
    else { im.removeAttribute('src'); im.style.display = 'none'; if (ph) ph.style.display = ''; }
  }
  function _advSetImg(img) { _advImg = img || ''; _advShow(); }
  function _advBusy(on, label) {
    var b = document.getElementById('cr-adv-busy'); if (!b) return;
    var t = b.querySelector('.cr-adv-busy-t');
    if (on) {
      b.classList.add('cr-on');
      if (_advBusyState.iv) clearInterval(_advBusyState.iv);
      _advBusyState.label = label || 'Working';
      _advBusyState.start = Date.now();
      _advBusyState.est = _crEst('adv:' + _advBusyState.label);
      var tick = function () {
        var rem = Math.round((_advBusyState.est - (Date.now() - _advBusyState.start)) / 1000);
        if (t) t.textContent = _advBusyState.label + ' · ' + (rem > 0 ? ('~' + rem + 's') : 'finishing…');
      };
      tick(); _advBusyState.iv = setInterval(tick, 250);
    } else {
      b.classList.remove('cr-on');
      if (_advBusyState.iv) { clearInterval(_advBusyState.iv); _advBusyState.iv = null; }
      if (_advBusyState.start) _crRecord('adv:' + _advBusyState.label, Date.now() - _advBusyState.start);
      _advBusyState.start = 0;
    }
  }
  function _advSyncBasics() { BASIC.forEach(function (k) { var m = document.getElementById('cr-ap-' + k), c = document.getElementById('cr-p-' + k); if (m && c) m.value = c.value; }); }
  function _advGenerate() { _doGenBase({ busyMain: false, onStart: function (m) { _advBusy(true, 'Base'); _advStatus(m); }, onResult: function (img) { _advBusy(false); _advSetImg(img); _advStatus('Base ready.'); }, onError: function (m) { _advBusy(false); _advStatus(m); } }); }
  function _advSave() { if (!_advImg) { _advStatus('Generate a base first.'); return; } _applyBase(_advImg, { keepOpen: false }); }
  function _advRow(p) {
    var isBasic = BASIC.indexOf(p.k) >= 0;
    var row = el('div', 'cr-row');
    var lab = el('label', 'cr-row-lab'); lab.textContent = p.label;
    var sel = el('select', 'cr-row-sel'); sel.id = isBasic ? ('cr-ap-' + p.k) : ('cr-p-' + p.k);
    var o0 = document.createElement('option'); o0.value = ''; o0.textContent = '—'; sel.appendChild(o0);
    p.opts.forEach(function (o) { var op = document.createElement('option'); op.value = o; op.textContent = o; sel.appendChild(op); });
    if (_NONE_DEFAULT.indexOf(p.k) >= 0) sel.value = 'none';
    if (isBasic) sel.addEventListener('change', function () { var c = document.getElementById('cr-p-' + p.k); if (c) { c.value = sel.value; try { c.dispatchEvent(new Event('change')); } catch (e) {} } });
    else sel.addEventListener('change', updatePrompt);
    var edit = el('button', 'cr-edit'); edit.type = 'button'; edit.textContent = '✎'; edit.title = 'Apply just this parameter to the popup image';
    edit.addEventListener('click', function () { paramEditClick(p, edit, { popup: true, base: _advImg, onResult: _advSetImg }); });
    row.appendChild(lab); row.appendChild(sel); row.appendChild(edit);
    return row;
  }
  function buildAdvPopup() {
    if (document.getElementById('cr-adv-popup')) return;
    var ov = el('div', 'cr-adv-ov'); ov.id = 'cr-adv-popup';
    var box = el('div', 'cr-adv-box');
    var tb = el('div', 'cr-adv-tb');
    var tt = el('div', 'cr-adv-title'); tt.textContent = 'Advanced character';
    var engBtn = el('button', 'cr-adv-eng'); engBtn.type = 'button'; engBtn.textContent = '⚙ Engines'; engBtn.title = 'Engine settings (Create / Edit)';
    engBtn.addEventListener('click', function () { var b = document.getElementById('btn-open-engine'); if (b) b.click(); });
    var x = el('button', 'cr-adv-x'); x.type = 'button'; x.textContent = '✕'; x.addEventListener('click', closeAdvPopup);
    tb.appendChild(tt); tb.appendChild(engBtn); tb.appendChild(x);

    var body = el('div', 'cr-adv-body2');

    // LEFT: pinned working image + pose + generate + save
    var left = el('div', 'cr-adv-left');
    var media = el('div', 'cr-adv-media');
    var prev = el('img'); prev.id = 'cr-adv-preview'; prev.style.display = 'none'; prev.addEventListener('click', function () { if (_advImg && window.openLightbox) window.openLightbox(_advImg); });
    var ph = el('div', 'cr-adv-ph'); ph.id = 'cr-adv-ph'; ph.textContent = 'Generate a base';
    var busy = el('div', 'cr-adv-busy'); busy.id = 'cr-adv-busy'; busy.innerHTML = '<div class="cr-adv-busy-shim"></div><div class="cr-adv-busy-t"></div>';
    media.appendChild(prev); media.appendChild(ph); media.appendChild(busy); left.appendChild(media);
    var lbtns = el('div', 'cr-adv-lbtns');
    var gen = el('button', 'cr-genbase'); gen.type = 'button'; gen.textContent = '▶ Generate base'; gen.addEventListener('click', _advGenerate);
    var save = el('button', 'cr-adv-save'); save.type = 'button'; save.textContent = '💾 Save → active'; save.addEventListener('click', _advSave);
    lbtns.appendChild(gen); lbtns.appendChild(save); left.appendChild(lbtns);
    var st = el('div', 'cr-adv-status'); st.id = 'cr-adv-status'; left.appendChild(st);
    body.appendChild(left);

    // RIGHT: all params in 3 columns + collapsible master prompt
    var right = el('div', 'cr-adv-right');
    var rhd = el('div', 'cr-adv-rhd');
    var rnd2 = el('button', 'cr-rnd'); rnd2.type = 'button'; rnd2.textContent = 'rnd'; rnd2.title = 'Randomize parameters (skips marks)';
    rnd2.addEventListener('click', function () { _rnd(_allParamKeys().filter(function (k) { return _MARKS_KEYS.indexOf(k) < 0; })); _advSyncBasics(); });
    var rst2 = el('button', 'cr-rnd'); rst2.type = 'button'; rst2.textContent = 'rst'; rst2.title = 'Reset all parameters to none';
    rst2.addEventListener('click', function () { _rstParams(); _advSyncBasics(); });
    rhd.appendChild(rnd2); rhd.appendChild(rst2); right.appendChild(rhd);
    var grid = el('div', 'cr-adv-grid3');
    PARAM_SCHEMA.forEach(function (g) {
      var gt = el('div', 'cr-grp-title'); gt.textContent = g.group; grid.appendChild(gt);
      g.params.forEach(function (p) { grid.appendChild(_advRow(p)); });
    });
    right.appendChild(grid);
    var mp = el('details', 'cr-adv-mp');
    var mpsum = el('summary', 'cr-adv-mp-sum'); mpsum.textContent = 'Master prompt';
    var mphd = el('div', 'cr-mp-hd');
    var optBtn = el('button', 'cr-mp-opt'); optBtn.type = 'button'; optBtn.textContent = '✨ AI-optimize'; optBtn.title = 'Rewrite the spec into an engine-ideal prompt (Hermes 405B)';
    optBtn.addEventListener('click', function () { aiOptimizeClick(optBtn); });
    var rstBtn = el('button', 'cr-mp-rst'); rstBtn.type = 'button'; rstBtn.textContent = '↺ JSON'; rstBtn.addEventListener('click', function () { _mpDirty = false; updatePrompt(); });
    mphd.appendChild(optBtn); mphd.appendChild(rstBtn);
    var ta = el('textarea', 'cr-mp-ta'); ta.id = 'cr-master-prompt'; ta.rows = 6; ta.addEventListener('input', function () { _mpDirty = true; });
    mp.appendChild(mpsum); mp.appendChild(mphd); mp.appendChild(ta); right.appendChild(mp);
    body.appendChild(right);

    box.appendChild(tb); box.appendChild(body); ov.appendChild(box);
    ov.addEventListener('mousedown', function (e) { if (e.target === ov) closeAdvPopup(); });
    document.body.appendChild(ov);
  }
  function openAdvPopup() {
    buildAdvPopup();
    var ov = document.getElementById('cr-adv-popup'); if (!ov) return;
    // load the current active image into the popup for point-editing
    _advImg = (typeof generatedImagePath !== 'undefined' && generatedImagePath) ? generatedImagePath : '';
    if (!_advImg) { var fp = document.getElementById('face-preview'); var s = fp ? (fp.getAttribute('src') || '') : ''; _advImg = s ? s.split('?')[0] : ''; }
    _advShow(); _advSyncBasics();
    ov.classList.add('cr-open'); updatePrompt();
  }
  function closeAdvPopup() {
    var ov = document.getElementById('cr-adv-popup');
    var active = (typeof generatedImagePath !== 'undefined' && generatedImagePath) ? generatedImagePath : '';
    if (ov && ov.classList.contains('cr-open') && _advImg && _advImg !== active) {
      if (window.confirm('Save the generated character to the active image?\nOK = save, Cancel = discard.')) { _advSave(); return; }
    }
    if (ov) ov.classList.remove('cr-open');
  }

  // Restructure the Create group: scrollable body (creator + legacy draft controls)
  // + a sticky footer holding refinements + Save character.
  function buildCreatePanel(grp) {
    var scroll = el('div', 'cr-scroll');
    while (grp.firstChild) scroll.appendChild(grp.firstChild);
    scroll.insertBefore(buildCreator(), scroll.firstChild);
    var footer = el('div', 'cr-footer');
    grp.appendChild(scroll);   // attach to the document BEFORE querying by id
    grp.appendChild(footer);
    ['refine-section', 'btn-save-persa-col2'].forEach(function (id) { var e = $(id); if (e) footer.appendChild(e); });
    buildAdvPopup();           // eager (hidden) so all params exist for rnd + master prompt
    // Remove the old draft interface (legacy param-gen rows + old character-select).
    var legacy = $('char-param-grid');
    if (legacy) legacy.querySelectorAll('.field-row-gen').forEach(function (e) { e.style.display = 'none'; });
    var oldSel = $('char-select-section'); if (oldSel) oldSel.style.display = 'none';
    // Name field -> top of the creator header (replacing the title); hide its old row.
    var nm = $('char-name'); var slot = $('cr-name-slot');
    if (nm && slot) { var oldRow = nm.closest('.field-row'); slot.appendChild(nm); if (oldRow) oldRow.style.display = 'none'; }
    // Move the TPDNE (random face) button into the gen row, left of Advanced.
    var tpdne = $('btn-random-face'); var genbar = grp.querySelector('.cr-genrow');
    if (tpdne && genbar) genbar.insertBefore(tpdne, genbar.firstChild);
  }

  function boot() {
    if (booted) return;
    var panel = $('l1-character');
    var rowEl = panel && panel.querySelector('.char-cols-row');
    var cols  = rowEl ? rowEl.querySelectorAll(':scope > .col-9-16') : [];
    if (!panel || !rowEl || cols.length < 3) { return setTimeout(boot, 150); }
    booted = true;
    document.documentElement.classList.add('cr-redesign');
    _watchBusy();

    var colTools = cols[0];   // LEFT   (was Draft)
    var colMedia = cols[1];   // CENTRE (preview)  — left as-is
    var colGal   = cols[2];   // RIGHT  (was Apply) — becomes the gallery
    // Marker classes (the row interleaves hidden .char-col-sash elements, so
    // :nth-child() can't reliably target the columns from CSS).
    colTools.classList.add('cr-col-tools');
    colMedia.classList.add('cr-col-preview');
    colGal.classList.add('cr-col-gallery');

    /* ── F1: the left column is Create-only (clothing/apply lives in Scenarios) ── */
    // Old character dropdown + thumb strip are replaced by the gallery.
    ['char-dd-row', 'char-thumb-row'].forEach(function (id) { var e = $(id); if (e) e.style.display = 'none'; });

    var leftHeader = colTools.querySelector('.col-header');
    if (leftHeader) leftHeader.textContent = 'Character';
    // Keep the WHOLE header row (the "Character" title + the #btn-open-engine
    // engine-picker button) pinned at the very TOP of the left column.
    var headRow = (leftHeader && leftHeader.closest('.col-head-row')) || leftHeader;

    var grpCreate = el('div', 'cr-group'); grpCreate.id = 'cr-group-create';

    // Everything currently in the left column (minus the header) is the creator.
    Array.prototype.slice.call(colTools.children).forEach(function (ch) {
      if (ch === headRow) return;
      grpCreate.appendChild(ch);
    });

    colTools.appendChild(grpCreate);

    // Build the character-creator UI + sticky Save/refinements footer.
    buildCreatePanel(grpCreate);

    // Face presence check (used by "+ New" to close the active image).
    var fp = $('face-preview');
    function hasFace() {
      if (!fp) return false;
      var src = fp.getAttribute('src') || '';
      if (!src) return false;
      try { if (getComputedStyle(fp).display === 'none') return false; } catch (e) {}
      return true;
    }

    /* ── F2: saved-characters gallery in the right column ────────────────── */
    var galHeader = colGal.querySelector('.col-header');
    if (galHeader) {
      galHeader.textContent = 'Characters';
      galHeader.classList.add('cr-gal-header');
    }
    // Hide whatever is left in the old Apply column (popup-managed sections like
    // #lookbook-apply-section / #env-select-section stay in the DOM, just hidden,
    // so the Looks&Env popup can still grab them by id).
    Array.prototype.slice.call(colGal.children).forEach(function (ch) {
      if (ch === galHeader) return;
      ch.style.display = 'none';
    });
    var gal = el('div', 'cr-gallery'); gal.id = 'cr-gallery';
    colGal.appendChild(gal);

    function curId() { var g = fn('_getCurrentCharId'); try { return g ? g() : null; } catch (e) { return null; } }
    // _actorCache is a top-level `let` in character.js (shared global lexical scope,
    // NOT a window property), so read it by bare name, not via window.
    function actors() { try { return (typeof _actorCache !== 'undefined' && Array.isArray(_actorCache)) ? _actorCache : []; } catch (e) { return []; } }

    // The flip-list for a card: the image the character was created FROM (baseFace)
    // first, then each of its photoshoots (obraz.char). De-duplicated.
    function shotsFor(c) {
      var gO = fn('getObrazы'); var list = (gO ? gO() : []) || [];
      var shots = list.filter(function (o) { return String(o.charId) === String(c.id) && o.char; })
                      .map(function (o) { return o.char; });
      var imgs = [];
      var base = c.baseFace || c.portrait || c.tpose || '';
      if (base) imgs.push(base);
      shots.forEach(function (s) { if (imgs.indexOf(s) < 0) imgs.push(s); });
      return { imgs: imgs, shootCount: shots.length };
    }
    function setCardImg(im, imgs, idx) {
      var src = imgs[idx] || '';
      if (!src) { im.removeAttribute('src'); return; }
      var lt = fn('loadThumb'); if (lt) lt(im, src); else im.src = src;
    }
    function renderGallery() {
      var chars = actors();
      var sel = curId();
      gal.innerHTML = '';

      var nw = el('button', 'cr-card cr-new'); nw.type = 'button';
      nw.innerHTML = '<span class="cr-new-plus">+</span><span class="cr-new-lbl">New</span>';
      nw.title = 'New character (clears selection)';
      nw.addEventListener('click', startNew);
      gal.appendChild(nw);

      chars.forEach(function (c) {
        var card = el('div', 'cr-card'); card.dataset.charId = c.id;
        if (sel != null && String(sel) === String(c.id)) card.classList.add('cr-selected');

        var info = shotsFor(c);
        var imgs = info.imgs;
        var idx = 0;

        var im = el('img', 'cr-card-img'); im.loading = 'lazy';
        setCardImg(im, imgs, idx);
        card._curFull = imgs[idx] || '';

        // Edit = pencil (top-left); Delete = cross (top-right). Load removed (click the card).
        var bE = el('button', 'cr-card-edit'); bE.type = 'button'; bE.textContent = '✎'; bE.title = 'Edit character';
        bE.addEventListener('click', function (e) { e.stopPropagation(); var f = fn('openCharacterActorPopup'); if (f) f(c.id); });
        var bD = el('button', 'cr-card-del'); bD.type = 'button'; bD.textContent = '✕'; bD.title = 'Delete character';
        bD.addEventListener('click', function (e) { e.stopPropagation(); delChar(c); });

        var nm = el('div', 'cr-card-name'); nm.textContent = c.name || 'Unnamed';

        card.appendChild(im); card.appendChild(bE); card.appendChild(bD); card.appendChild(nm);

        // Flip arrows only when there are SEVERAL (>=2) photoshoots; the carousel
        // still includes the created-from base as the first frame.
        if (info.shootCount >= 2) {
          var nav = el('div', 'cr-card-nav');
          var prev = el('button', 'cr-card-arrow'); prev.type = 'button'; prev.textContent = '‹';
          var cnt = el('span', 'cr-card-count'); cnt.textContent = (idx + 1) + '/' + imgs.length;
          var next = el('button', 'cr-card-arrow'); next.type = 'button'; next.textContent = '›';
          var flip = function (d) { idx = (idx + d + imgs.length) % imgs.length; setCardImg(im, imgs, idx); card._curFull = imgs[idx]; cnt.textContent = (idx + 1) + '/' + imgs.length; };
          prev.addEventListener('click', function (e) { e.stopPropagation(); flip(-1); });
          next.addEventListener('click', function (e) { e.stopPropagation(); flip(1); });
          nav.appendChild(prev); nav.appendChild(cnt); nav.appendChild(next);
          card.appendChild(nav);
        }

        card.addEventListener('click', function () { toggleLoad(card, c); });
        gal.appendChild(card);
      });
    }

    function loadChar(c) {
      var f = fn('_loadActorByItem');
      if (f) { try { f(c); } catch (e) { console.warn('[cr] load failed', e); } }
      renderGallery();
    }
    function startNew() {
      _loaded = null;
      var f = fn('_setCurrentCharId'); if (f) { try { f(null); } catch (e) {} }
      try { var df = $('btn-delete-face'); if (df && hasFace()) df.click(); } catch (e) {}   // close the active image
      renderGallery();
    }
    function delChar(c) {
      if (!confirm('Delete character "' + (c.name || '') + '"? Its photoshoots will be removed too.')) return;
      // Mirror character.js's cascade: drop this actor's photoshoots first.
      try {
        var getO = fn('getObrazы'); var delO = fn('deleteObraz');
        if (getO && delO) getO().filter(function (o) { return String(o.charId) === String(c.id); })
          .forEach(function (o) { try { delO(o.id); } catch (e) {} });
      } catch (e) {}
      fetch('/api/char-store/' + encodeURIComponent(c.id), { method: 'DELETE' })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d && d.success) {
            try { if (curId() != null && String(curId()) === String(c.id)) { var s = fn('_setCurrentCharId'); if (s) s(null); } } catch (e) {}
            var lct = fn('loadCharacterThumbs'); if (lct) lct();   // refreshes _actorCache -> wrapper re-renders
            var lo = fn('loadObrazы'); if (lo) lo();
            var ls = fn('loadScenarioObrazы'); if (ls) ls();
            var lc3 = fn('loadCharCol3Obrazy'); if (lc3) lc3();
          } else { alert('Delete failed: ' + ((d && d.error) || '')); }
        })
        .catch(function (e) { alert('Delete error: ' + e.message); });
    }

    // Re-render the gallery whenever the app refreshes the character list.
    var lct0 = fn('loadCharacterThumbs');
    if (lct0) {
      window.loadCharacterThumbs = function () {
        var r = lct0.apply(this, arguments);
        Promise.resolve(r).then(renderGallery, renderGallery);
        return r;
      };
    }

    // Initial render (+ short poll until the first /api/char-store/list resolves).
    _galRender = renderGallery;   // expose for toggleLoad (load/unload from a card)
    renderGallery();
    var tries = 0;
    (function poll() {
      renderGallery();
      if (!actors().length && tries++ < 12) setTimeout(poll, 300);
    })();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
