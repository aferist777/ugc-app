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
  var _mpDirty = false;
  var _advMode = false;   // when false, only the 4 basic params feed the prompt/generation

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
    spec.realism = ['photorealistic', 'detailed skin texture with visible pores', 'soft studio lighting', 'sharp focus', 'high detail'];
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
    edit.title = 'Apply just this change to the current image (Phase 2)';
    edit.addEventListener('click', function () { crStatus('Per-parameter edit is wired in Phase 2.'); });
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
  // Generate the base portrait from the JSON spec (text-to-image, no source
  // image) via the new /api/character-creator/generate endpoint, then show it.
  function genBaseClick() {
    var ta = document.getElementById('cr-master-prompt');
    var specText = (ta && ta.value && ta.value.trim()) ? ta.value : assembleMasterPrompt();
    crStatus('Generating base...');
    var btns = document.querySelectorAll('.cr-genbase');
    Array.prototype.forEach.call(btns, function (b) { b.disabled = true; });
    fetch('/api/character-creator/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spec: specText })
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
  function _applyBase(imagePath) {
    if (!imagePath) { crStatus('No image returned'); return; }
    var sf = fn('showFace'); if (sf) sf(imagePath);
    try { generatedImagePath = imagePath; } catch (e) {}
    var so = fn('setActiveImageOrigin'); if (so) so('normal');
    crStatus('Base ready.');
    closeAdvPopup();
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
    // Master prompt on TOP.
    var mp = el('div', 'cr-mp');
    var mlbl = el('div', 'cr-mp-lbl'); mlbl.textContent = 'Master prompt';
    var ta = el('textarea', 'cr-mp-ta'); ta.id = 'cr-master-prompt'; ta.rows = 6;
    ta.addEventListener('input', function () { _mpDirty = true; });
    mp.appendChild(mlbl); mp.appendChild(ta); body.appendChild(mp);
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
  }

  function boot() {
    if (booted) return;
    var panel = $('l1-character');
    var rowEl = panel && panel.querySelector('.char-cols-row');
    var cols  = rowEl ? rowEl.querySelectorAll(':scope > .col-9-16') : [];
    if (!panel || !rowEl || cols.length < 3) { return setTimeout(boot, 150); }
    booted = true;
    document.documentElement.classList.add('cr-redesign');

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

        var im = el('img', 'cr-card-img'); im.loading = 'lazy';
        var full = c.portrait || c.baseFace || c.tpose || '';
        if (full) { var lt = fn('loadThumb'); if (lt) lt(im, full); else im.src = full; }

        var nm = el('div', 'cr-card-name'); nm.textContent = c.name || 'Unnamed';

        var acts = el('div', 'cr-card-acts');
        var bL = el('button', 'cr-act');        bL.type = 'button'; bL.textContent = 'Load';
        var bE = el('button', 'cr-act');        bE.type = 'button'; bE.textContent = 'Edit';
        var bD = el('button', 'cr-act cr-act-del'); bD.type = 'button'; bD.textContent = 'Delete';
        bL.addEventListener('click', function (e) { e.stopPropagation(); loadChar(c); });
        bE.addEventListener('click', function (e) { e.stopPropagation(); var f = fn('openCharacterActorPopup'); if (f) f(c.id); });
        bD.addEventListener('click', function (e) { e.stopPropagation(); delChar(c); });
        acts.appendChild(bL); acts.appendChild(bE); acts.appendChild(bD);

        card.appendChild(im); card.appendChild(nm); card.appendChild(acts);
        card.addEventListener('click', function () { loadChar(c); });
        gal.appendChild(card);
      });
    }

    function loadChar(c) {
      var f = fn('_loadActorByItem');
      if (f) { try { f(c); } catch (e) { console.warn('[cr] load failed', e); } }
      renderGallery();
    }
    function startNew() {
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
