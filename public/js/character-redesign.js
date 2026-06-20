/* ═══════════════════════════════════════════════════════════════════════════
   character-redesign.js — SANDBOX-ONLY enhancement for /character-redesign.html
   ---------------------------------------------------------------------------
   Reorganizes the existing Character DOM at runtime (the shared character.js is
   NOT modified). Nodes are REPARENTED (appendChild), so every original id and
   its event listeners are preserved and character.js keeps working untouched.

   Layout after reorg (3 columns):
     LEFT   = "Character" tools, with a [Создание | Применение] segment toggle:
                Создание  = the old Draft controls (name, params, refine, Save char)
                Применение = the old Apply-to-image panel (Looks&Env + slots) + Save obraz
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
    { group: 'Marks', params: [
      { k: 'scars',     label: 'Scars',          opts: ['none', 'cheek scar', 'brow scar', 'lip scar', 'multiple scars'] },
      { k: 'tattoos',   label: 'Face tattoos',   opts: ['none', 'small teardrop', 'tribal', 'script', 'geometric'] },
      { k: 'piercings', label: 'Piercings',      opts: ['none', 'nose stud', 'septum', 'eyebrow', 'lip', 'multiple ear'] },
      { k: 'freckles',  label: 'Freckles/moles', opts: ['none', 'light freckles', 'heavy freckles', 'beauty mark'] }
    ]},
    { group: 'Style', params: [
      { k: 'makeup',  label: 'Makeup',     opts: ['none', 'natural', 'glam', 'smoky', 'editorial', 'bold lip'] },
      { k: 'emotion', label: 'Expression', opts: ['neutral', 'smiling', 'serious', 'confident', 'playful', 'sad', 'angry'] }
    ]}
  ];
  var _NONE_DEFAULT = ['scars', 'tattoos', 'piercings', 'freckles', 'facialHair', 'makeup'];
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
    if (v.emotion) spec.expression = v.emotion;
    if (_advMode) {
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
  var BASIC = ['age', 'gender', 'ethnicity', 'emotion'];

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
  function genBaseClick() {
    var ta = document.getElementById('cr-master-prompt');
    var specText = (ta && ta.value && ta.value.trim()) ? ta.value : assembleMasterPrompt();
    var createEngine = (typeof window.getCharCreateEngine === 'function')
      ? window.getCharCreateEngine()
      : (localStorage.getItem('char_create_engine_v1') || 'z-turbo');
    crStatus('Generating base...');
    var btns = document.querySelectorAll('.cr-genbase');
    Array.prototype.forEach.call(btns, function (b) { b.disabled = true; });
    fetch('/api/character-creator/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spec: specText, imageEngine: createEngine })
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.success || !d.taskId) throw new Error((d && d.error) || 'No taskId');
        var poll = fn('pollUntilDone');
        return poll
          ? poll('/api/status/' + encodeURIComponent(d.taskId), 'Character base')
          : _manualPoll(d.taskId);
      })
      .then(function (imagePath) { _applyBase(imagePath); })
      .catch(function (e) { crStatus('Generation failed: ' + ((e && e.message) || e)); })
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
      // UNLOAD -> restore the pre-load working image (canonical showFace) + state.
      var r = _loaded.restore;
      _loaded = null;
      var sc = fn('_setCurrentCharId'); if (sc) sc(r.curId);
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
    var f = fn('_loadActorByItem'); if (f) { try { f(c); } catch (e) { console.warn('[cr] load failed', e); } }
    if (_galRender) _galRender();
    crStatus('Loaded "' + (c.name || '') + '".');
  }

  // Hover-zoom for lookbook / environment thumbnails: hovering a thumb shows the
  // full image enlarged in a floating popup near it. Delegated, so it covers
  // dynamically-built thumbs (apply slots, catalog rows, picker, Looks&Env modal).
  var _zoomSel = '.apply-slot-thumb img, .lb-thumb, .env-thumb, .apply-picker-thumb, #le-lb-grid img, #le-env-grid img';
  function _initHoverZoom() {
    if (document.getElementById('cr-zoom')) return;
    var z = el('div', 'cr-zoom'); z.id = 'cr-zoom';
    var zi = el('img'); z.appendChild(zi); document.body.appendChild(z);
    var rect = null;
    function fullPath(t) {
      var dp = t.getAttribute('data-path'); if (dp) return dp;
      var slot = t.closest('.apply-slot-thumb');
      if (slot) { var k = slot.getAttribute('data-kind'); var s = (window._applySlots && window._applySlots[k]); if (s && (s.path || s.thumbPath)) return s.path || s.thumbPath; }
      var src = t.getAttribute('src'); return src ? src.split('?')[0] : '';
    }
    function place() {
      if (!rect) return;
      var zw = z.offsetWidth || 348, zh = z.offsetHeight || 320;
      var left = rect.left - zw - 12; if (left < 8) left = rect.right + 12;
      if (left + zw > window.innerWidth - 8) left = Math.max(8, window.innerWidth - zw - 8);
      var top = Math.min(Math.max(8, rect.top + rect.height / 2 - zh / 2), window.innerHeight - zh - 8);
      z.style.left = left + 'px'; z.style.top = Math.max(8, top) + 'px';
    }
    document.addEventListener('mouseover', function (e) {
      var t = e.target; if (!t || !t.matches || !t.matches(_zoomSel)) return;
      var full = fullPath(t); if (!full) return;
      rect = t.getBoundingClientRect();
      zi.onload = function () { if (z.classList.contains('cr-on')) place(); };
      zi.src = full; z.classList.add('cr-on'); place();
    });
    document.addEventListener('mouseout', function (e) {
      var t = e.target; if (t && t.matches && t.matches(_zoomSel)) z.classList.remove('cr-on');
    });
    // A click on a thumbnail (e.g. selecting a lookbook) re-renders the grid and
    // replaces the hovered node, so its mouseout never fires -> the zoom would get
    // stuck open. Force-hide on any click / scroll while the zoom is showing.
    document.addEventListener('click', function () { z.classList.remove('cr-on'); }, true);
    document.addEventListener('scroll', function () { z.classList.remove('cr-on'); }, true);
  }
  // Per-parameter edit (✎): apply just this one detail to the CURRENT image via
  // img2img (/api/generate) using the selected Edit (i2i) engine. Identity / pose
  // / background are held by buildPrompt's hard "keep the same person..." lock.
  function paramEditClick(p, btn) {
    var base = (typeof generatedImagePath !== 'undefined' && generatedImagePath) ? generatedImagePath : '';
    if (!base) { var fp = document.getElementById('face-preview'); var src = fp ? (fp.getAttribute('src') || '') : ''; base = src ? src.split('?')[0] : ''; }
    if (!base) { crStatus('Generate a base first.'); return; }
    var val = crVal(p.k);
    if (!val) { crStatus('Pick a value for ' + p.label + ' first.'); return; }
    var label = p.label.toLowerCase();
    var desc = (OPTION_DESC[p.k] && OPTION_DESC[p.k][val]) || '';
    var instr;
    if (val === 'none') {
      instr = (desc ? (desc.charAt(0).toUpperCase() + desc.slice(1)) : 'Remove any ' + label + ', leave none') + '. Keep everything else identical.';
    } else {
      instr = 'Change the ' + label + ' to ' + val + (desc ? ' — ' + desc : '') + '. Keep everything else identical.';
    }
    var engine = (typeof window.getCharImageEngine === 'function')
      ? window.getCharImageEngine()
      : (localStorage.getItem('char_image_engine_v1') || 'firered-edit');
    crStatus('Applying ' + label + (val === 'none' ? ' (remove)' : ' = ' + val) + '…');
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
      .then(function (imagePath) { _applyBase(imagePath, { keepOpen: true, silent: true }); crStatus('Applied: ' + label + '.'); })
      .catch(function (e) { crStatus('Edit failed: ' + ((e && e.message) || e)); })
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
  function buildAdvPopup() {
    if (document.getElementById('cr-adv-popup')) return;
    var ov = el('div', 'cr-adv-ov'); ov.id = 'cr-adv-popup';
    var box = el('div', 'cr-adv-box');
    var tb = el('div', 'cr-adv-tb');
    var tt = el('div', 'cr-adv-title'); tt.textContent = 'Advanced character';
    var x = el('button', 'cr-adv-x'); x.type = 'button'; x.textContent = '✕'; x.addEventListener('click', closeAdvPopup);
    tb.appendChild(tt); tb.appendChild(x);

    var body = el('div', 'cr-adv-body');
    // Master prompt on TOP, with AI-optimize (Hermes) + reset-to-JSON.
    var mp = el('div', 'cr-mp');
    var mphd = el('div', 'cr-mp-hd');
    var mlbl = el('div', 'cr-mp-lbl'); mlbl.textContent = 'Master prompt';
    var optBtn = el('button', 'cr-mp-opt'); optBtn.type = 'button'; optBtn.textContent = '✨ AI-optimize';
    optBtn.title = 'Rewrite the spec into an engine-ideal portrait prompt (Hermes 405B)';
    optBtn.addEventListener('click', function () { aiOptimizeClick(optBtn); });
    var rstBtn = el('button', 'cr-mp-rst'); rstBtn.type = 'button'; rstBtn.textContent = '↺ JSON';
    rstBtn.title = 'Reset the prompt back to the JSON spec';
    rstBtn.addEventListener('click', function () { _mpDirty = false; updatePrompt(); crStatus('Prompt reset to the JSON spec.'); });
    mphd.appendChild(mlbl); mphd.appendChild(optBtn); mphd.appendChild(rstBtn);
    var ta = el('textarea', 'cr-mp-ta'); ta.id = 'cr-master-prompt'; ta.rows = 6;
    ta.addEventListener('input', function () { _mpDirty = true; });
    mp.appendChild(mphd); mp.appendChild(ta); body.appendChild(mp);
    // Toggle: only when ON do the params below feed the prompt / generation.
    var tog = el('label', 'cr-adv-toggle');
    var cb = el('input'); cb.type = 'checkbox'; cb.id = 'cr-adv-on';
    cb.addEventListener('change', function () { _advMode = cb.checked; updatePrompt(); });
    var tspan = document.createElement('span'); tspan.textContent = 'Advanced generation — apply the parameters below';
    tog.appendChild(cb); tog.appendChild(tspan); body.appendChild(tog);
    // Parameters below the master prompt, in a 2-column grid (group titles span both columns).
    var grid = el('div', 'cr-adv-grid');
    PARAM_SCHEMA.forEach(function (g) {
      var advs = g.params.filter(function (p) { return BASIC.indexOf(p.k) < 0; });
      if (!advs.length) return;
      var gt = el('div', 'cr-grp-title'); gt.textContent = g.group; grid.appendChild(gt);
      advs.forEach(function (p) { grid.appendChild(crRow(p)); });
    });
    body.appendChild(grid);

    var ft = el('div', 'cr-adv-ft');
    var rnd2 = el('button', 'cr-rnd'); rnd2.type = 'button'; rnd2.textContent = 'rnd'; rnd2.addEventListener('click', randomizeAdvanced);
    var gen2 = el('button', 'cr-genbase'); gen2.type = 'button'; gen2.textContent = '▶ Generate base'; gen2.addEventListener('click', genBaseClick);
    ft.appendChild(rnd2); ft.appendChild(gen2);

    box.appendChild(tb); box.appendChild(body); box.appendChild(ft); ov.appendChild(box);
    ov.addEventListener('mousedown', function (e) { if (e.target === ov) closeAdvPopup(); });
    document.body.appendChild(ov);
  }
  function openAdvPopup() { buildAdvPopup(); var ov = document.getElementById('cr-adv-popup'); if (ov) { ov.classList.add('cr-open'); updatePrompt(); } }
  function closeAdvPopup() { var ov = document.getElementById('cr-adv-popup'); if (ov) ov.classList.remove('cr-open'); }

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
    _initHoverZoom();

    var colTools = cols[0];   // LEFT   (was Draft)
    var colMedia = cols[1];   // CENTRE (preview)  — left as-is
    var colGal   = cols[2];   // RIGHT  (was Apply) — becomes the gallery
    // Marker classes (the row interleaves hidden .char-col-sash elements, so
    // :nth-child() can't reliably target the columns from CSS).
    colTools.classList.add('cr-col-tools');
    colMedia.classList.add('cr-col-preview');
    colGal.classList.add('cr-col-gallery');

    /* ── F1: segment toggle + move Apply-to-image into the left column ───── */
    // Old character dropdown + thumb strip are replaced by the gallery.
    ['char-dd-row', 'char-thumb-row'].forEach(function (id) { var e = $(id); if (e) e.style.display = 'none'; });

    var leftHeader = colTools.querySelector('.col-header');
    if (leftHeader) leftHeader.textContent = 'Character';
    // Keep the WHOLE header row (the "Character" title + the #btn-open-engine
    // engine-picker button) pinned at the very TOP of the left column.
    var headRow = (leftHeader && leftHeader.closest('.col-head-row')) || leftHeader;

    var toggle    = el('div', 'cr-toggle');
    var segCreate = el('button', 'cr-seg cr-active'); segCreate.type = 'button'; segCreate.textContent = 'Create';
    var segApply  = el('button', 'cr-seg');           segApply.type  = 'button'; segApply.textContent  = 'Apply';
    toggle.appendChild(segCreate); toggle.appendChild(segApply);

    var grpCreate = el('div', 'cr-group'); grpCreate.id = 'cr-group-create';
    var grpApply  = el('div', 'cr-group'); grpApply.id  = 'cr-group-apply';

    // Everything currently in the left column (minus the header) is "Создание".
    Array.prototype.slice.call(colTools.children).forEach(function (ch) {
      if (ch === headRow) return;
      grpCreate.appendChild(ch);
    });

    // The Apply-to-image controls (Looks&Env button + slots) -> "Применение".
    ['btn-looks-env', 'apply-panel'].forEach(function (id) { var e = $(id); if (e) grpApply.appendChild(e); });
    // Save obraz lives with Применение (save the styled image).
    var saveObraz = $('btn-save-obraz-col2'); if (saveObraz) grpApply.appendChild(saveObraz);

    colTools.appendChild(toggle);
    colTools.appendChild(grpCreate);
    colTools.appendChild(grpApply);

    // Build the character-creator UI + sticky Save/refinements footer in "Create".
    buildCreatePanel(grpCreate);

    function setMode(m) {
      var apply = (m === 'apply');
      segApply.classList.toggle('cr-active', apply);
      segCreate.classList.toggle('cr-active', !apply);
      grpCreate.classList.toggle('cr-hide', apply);
      grpApply.classList.toggle('cr-hide', !apply);
    }
    segCreate.addEventListener('click', function () { setMode('create'); });
    segApply.addEventListener('click', function () { if (!segApply.disabled) setMode('apply'); });
    setMode('create');

    // Gate "Применение" until a face exists (nothing to style otherwise).
    var fp = $('face-preview');
    function hasFace() {
      if (!fp) return false;
      var src = fp.getAttribute('src') || '';
      if (!src) return false;
      try { if (getComputedStyle(fp).display === 'none') return false; } catch (e) {}
      return true;
    }
    function refreshApplyGate() {
      var ok = hasFace();
      segApply.disabled = !ok;
      segApply.title = ok ? '' : 'Create or upload a face first';
      if (!ok && !grpApply.classList.contains('cr-hide')) setMode('create');
    }
    if (fp) {
      try { new MutationObserver(refreshApplyGate).observe(fp, { attributes: true, attributeFilter: ['src', 'style'] }); } catch (e) {}
    }
    var fph = $('face-placeholder');
    if (fph) { try { new MutationObserver(refreshApplyGate).observe(fph, { attributes: true, attributeFilter: ['style'] }); } catch (e) {} }
    refreshApplyGate();

    /* ── F2: saved-characters gallery in the right column ────────────────── */
    var galHeader = colGal.querySelector('.col-header');
    if (galHeader) galHeader.textContent = 'Characters';
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
      setMode('create');
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
