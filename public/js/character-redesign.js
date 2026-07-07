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
      { k: 'makeup',  label: 'Makeup',     opts: ['none', 'natural', 'glam', 'smoky', 'editorial', 'bold lip'] }
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
    makeup: { 'none': 'bare natural skin, no makeup', 'natural': 'subtle natural makeup', 'glam': 'full glam makeup, defined eyes and lips', 'smoky': 'smoky eye makeup', 'editorial': 'bold editorial makeup', 'bold lip': 'bold bright lipstick' }
  };
  // ── Create realism markers (chips in the Create-gear Prompt tab) ────────────
  // Stored as an ordered [text, on] list; the DEFAULTS match the old hardcoded
  // spec.realism set. Active markers feed assembleMasterPrompt AND the 4K sheet
  // (Save character sends them; the server appends them to the sheet prompt).
  var REALISM_LS = 'cr_realism_markers_v1';
  var REALISM_DEFAULTS = ['photorealistic', 'detailed skin texture with visible pores', 'soft studio lighting', 'sharp focus', 'high detail'];
  function _realismChips() {
    try {
      var raw = JSON.parse(localStorage.getItem(REALISM_LS) || 'null');
      if (Array.isArray(raw) && raw.length) return raw.filter(function (p) { return Array.isArray(p) && typeof p[0] === 'string'; });
    } catch (e) {}
    return REALISM_DEFAULTS.map(function (t) { return [t, true]; });
  }
  function _realismSave(chips) { try { localStorage.setItem(REALISM_LS, JSON.stringify(chips)); } catch (e) {} }
  function _realismActive() { return _realismChips().filter(function (p) { return p[1]; }).map(function (p) { return p[0]; }); }
  window.getCreateRealismMarkers = _realismActive;

  var _mpDirty = false;
  var _loaded = null;      // character loaded via a gallery card: { charId, restore } (load/unload toggle)
  var _galRender = null;   // boot assigns renderGallery here so toggleLoad can refresh the gallery
  // Creator mode: 'simple' (5 quick params) | 'advanced' (all params in 2 columns + master prompt).
  var MODE_LS = 'cr_creator_mode_v1';
  function _creatorMode() { return localStorage.getItem(MODE_LS) === 'advanced' ? 'advanced' : 'simple'; }
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
      var rm = _realismActive();
      if (rm.length) spec.realism = rm;
    }
    spec.negative = ['text', 'watermark', 'phone', 'hands'];
    return JSON.stringify(spec, null, 2);
  }
  function crStatus(m) { var s = document.getElementById('cr-status'); if (s) s.textContent = m || ''; }
  function updatePrompt() { var ta = document.getElementById('cr-master-prompt'); if (ta && !_mpDirty) ta.value = assembleMasterPrompt(); }

  // ── ⚙ Character-generation popup: [Models | Prompt] iOS-pill tabs ────────────
  function _crGearCss() {
    if (document.getElementById('cr-gear-css')) return;
    var s = document.createElement('style'); s.id = 'cr-gear-css';
    s.textContent = [
      '#l1-character button.cr-gear{margin-left:6px;background:transparent !important;border:none !important;box-shadow:none !important;color:var(--muted,#9a9a9a) !important;cursor:pointer;font-size:15px;line-height:1;padding:2px 4px !important;min-width:0 !important}',
      '#l1-character button.cr-gear:hover{background:transparent !important;color:var(--ink,#eee) !important;filter:none !important}',
      '#l1-character img.cr-card-img{object-position:left center !important}',
      '#cr-gear-overlay{position:fixed;inset:0;z-index:99000;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center}',
      '#cr-gear-pop{width:min(700px,94vw);max-height:88vh;display:flex;flex-direction:column;background:var(--surface,#1a1a1a);color:var(--ink,#ddd);border:1px solid var(--border,#555);border-radius:10px;box-shadow:0 12px 48px rgba(0,0,0,.5);overflow:hidden}',
      '#cr-gear-pop .crg-head{display:flex;align-items:center;justify-content:space-between;padding:9px 13px;font-weight:700;background:var(--surface-2,#222);border-bottom:1px solid var(--border-soft,#3a3a3a)}',
      '#cr-gear-pop .crg-x{cursor:pointer;opacity:.7}#cr-gear-pop .crg-x:hover{opacity:1}',
      '#cr-gear-pop .crg-tabs{display:flex;gap:5px;padding:9px 12px;justify-content:center;background:var(--surface-2,#222);border-bottom:1px solid var(--border-soft,#3a3a3a)}',
      '#cr-gear-pop .crg-tab{min-width:130px;text-align:center;font-size:12px;font-weight:600;padding:6px 16px;cursor:pointer;background:var(--surface,#1a1a1a);border:1px solid var(--border,#555);color:var(--muted,#9a9a9a);border-radius:999px}',
      '#cr-gear-pop .crg-tab.on{background:var(--primary,#5b6fd6);color:var(--primary-ink,#fff);border-color:var(--primary,#5b6fd6)}',
      '#cr-gear-pop .crg-body{flex:1;overflow:auto;padding:10px 14px;min-height:0}',
      '#cr-gear-pop .crg-foot{display:flex;align-items:center;gap:8px;padding:8px 14px;border-top:1px solid var(--border-soft,#3a3a3a)}',
      '#cr-gear-pop .crg-save{font-size:12px;font-weight:700;padding:6px 18px;cursor:pointer;background:var(--primary,#5b6fd6);color:var(--primary-ink,#fff);border:1px solid var(--primary,#5b6fd6);border-radius:7px}',
      '#cr-gear-pop .crg-reset{font-size:11px;padding:5px 12px;cursor:pointer;background:transparent;border:1px solid var(--border,#555);color:var(--muted,#9a9a9a);border-radius:6px}',
      '#cr-gear-pop .crg-status{font-size:10px;color:var(--muted,#9a9a9a)}',
      '#cr-gear-pop .crg-meta{font-size:11px;color:var(--muted,#9a9a9a);margin-bottom:8px}',
      '#cr-gear-pop .crg-fld-lbl{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--muted,#9a9a9a);margin:8px 0 3px}',
      '#cr-gear-pop textarea{width:100%;box-sizing:border-box;font:11px/1.5 ui-monospace,Consolas,monospace;padding:7px 9px;border:1px solid var(--border,#555);border-radius:6px;background:var(--surface,#141414);color:var(--ink,#ddd);resize:vertical}',
      /* Models tab: a tidy two-column grid; every control in the app design language */
      '#cr-gear-pop .es-cols{display:grid;grid-template-columns:1fr 1fr;gap:14px}',
      '#cr-gear-pop .es-col{border:1px solid var(--border-soft,#3a3a3a);border-radius:8px;padding:10px;background:var(--surface-2,#202020);min-width:0}',
      '#cr-gear-pop .es-col-h{font-size:11px;font-weight:700;color:var(--ink,#ddd);margin-bottom:8px}',
      '#cr-gear-pop select,#cr-gear-pop .es-col input[type=text],#cr-gear-pop .es-col input[type=number]{width:100%;box-sizing:border-box;appearance:auto;font:12px var(--font,sans-serif);padding:6px 8px;min-height:30px;background:var(--surface,#141414);color:var(--ink,#ddd);border:1px solid var(--border,#555);border-radius:8px}',
      '#cr-gear-pop select:focus{outline:none;border-color:var(--primary,#5b6fd6)}',
      '#cr-gear-pop .es-col-sel{margin-bottom:8px}',
      '#cr-gear-pop .es-col-realism{display:flex;align-items:center;gap:8px;font-size:11px;color:var(--ink,#ddd);margin:2px 0 8px}',
      '#cr-gear-pop .es-desc{font-size:10px;color:var(--muted,#9a9a9a);line-height:1.4;margin:2px 0 6px}',
      '#cr-gear-pop .es-col-params label,#cr-gear-pop .es-col-params .es-lbl{font-size:10px;color:var(--muted,#9a9a9a)}',
      /* Prompt tab: sub-pill (create/edit/save) + realism chips */
      '#cr-gear-pop .crg-subtabs{display:flex;gap:5px;margin:2px 0 10px}',
      '#cr-gear-pop .crg-subtab{flex:0 0 auto;min-width:92px;text-align:center;font-size:11px;font-weight:600;padding:4px 14px;cursor:pointer;background:var(--surface,#1a1a1a);border:1px solid var(--border,#555);color:var(--muted,#9a9a9a);border-radius:999px}',
      '#cr-gear-pop .crg-subtab.on{background:var(--primary-soft,rgba(91,111,214,.18));color:var(--ink,#eee);border-color:var(--primary,#5b6fd6)}',
      '#cr-gear-pop .crg-chip-add{display:flex;gap:6px;margin-bottom:7px}',
      '#cr-gear-pop .crg-chip-add input{flex:1;box-sizing:border-box;font:11px var(--font,sans-serif);padding:5px 9px;background:var(--surface,#141414);color:var(--ink,#ddd);border:1px solid var(--border,#555);border-radius:8px}',
      '#cr-gear-pop .crg-chip-add button{font-size:11px;font-weight:600;padding:5px 12px;cursor:pointer;background:var(--surface-2,#222);border:1px solid var(--border,#555);color:var(--ink,#ddd);border-radius:8px}',
      '#cr-gear-pop .crg-chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}',
      '#cr-gear-pop .crg-chip{display:inline-flex;align-items:center;gap:6px;font-size:11px;padding:4px 10px;cursor:pointer;border-radius:999px;border:1px solid var(--border,#555);background:var(--surface,#1a1a1a);color:var(--muted,#9a9a9a);user-select:none}',
      '#cr-gear-pop .crg-chip.on{background:var(--primary-soft,rgba(91,111,214,.18));border-color:var(--primary,#5b6fd6);color:var(--ink,#eee)}',
      '#cr-gear-pop .crg-chip .crg-chip-dot{width:7px;height:7px;border-radius:50%;background:var(--border,#555)}',
      '#cr-gear-pop .crg-chip.on .crg-chip-dot{background:var(--primary,#5b6fd6)}',
      '#cr-gear-pop .crg-chip .crg-chip-x{opacity:.55;font-size:10px;margin-left:2px}',
      '#cr-gear-pop .crg-chip .crg-chip-x:hover{opacity:1}'
    ].join('\n');
    document.head.appendChild(s);
  }

  function _crGearPop() {
    var ex = document.getElementById('cr-gear-overlay'); if (ex) { ex.remove(); return; }
    _crGearCss();
    var ov = el('div'); ov.id = 'cr-gear-overlay';
    var pop = el('div'); pop.id = 'cr-gear-pop';
    var head = el('div', 'crg-head'); var ht = el('span'); ht.textContent = '⚙ Character generation';
    var hx = el('span', 'crg-x'); hx.textContent = '✕'; head.appendChild(ht); head.appendChild(hx);
    var tabs = el('div', 'crg-tabs');
    var tModels = el('button', 'crg-tab on'); tModels.type = 'button'; tModels.textContent = 'Models';
    var tPrompt = el('button', 'crg-tab'); tPrompt.type = 'button'; tPrompt.textContent = 'Prompt';
    tabs.appendChild(tModels); tabs.appendChild(tPrompt);
    var body = el('div', 'crg-body'); var foot = el('div', 'crg-foot');
    pop.appendChild(head); pop.appendChild(tabs); pop.appendChild(body); pop.appendChild(foot);
    ov.appendChild(pop); document.body.appendChild(ov);
    function close() { ov.remove(); }
    ov.addEventListener('mousedown', function (e) { if (e.target === ov) close(); });
    hx.addEventListener('click', close);
    var cur = 'models';
    async function render() {
      body.innerHTML = ''; foot.innerHTML = '';
      tModels.classList.toggle('on', cur === 'models'); tPrompt.classList.toggle('on', cur === 'prompt');
      if (cur === 'models') await renderModels(); else await renderPrompt();
    }
    tModels.addEventListener('click', function () { cur = 'models'; render(); });
    tPrompt.addEventListener('click', function () { cur = 'prompt'; render(); });
    async function renderModels() {
      var host = el('div'); body.appendChild(host);
      if (window.renderCharEngineModels) { host.textContent = 'Loading…'; try { await window.renderCharEngineModels(host); } catch (e) { host.textContent = 'Error: ' + e.message; } }
      else host.textContent = 'engine-settings.js not loaded';
      var reset = el('button', 'crg-reset'); reset.type = 'button'; reset.textContent = '↺ Reset';
      var sp = el('div'); sp.style.flex = '1';
      var st = el('span', 'crg-status');
      var save = el('button', 'crg-save'); save.type = 'button'; save.textContent = '💾 Save';
      save.addEventListener('click', async function () { st.textContent = 'Saving…'; try { if (window.saveCharEngineModels) await window.saveCharEngineModels(); st.textContent = '✅ Saved'; setTimeout(function () { st.textContent = ''; }, 1600); } catch (e) { st.textContent = '⚠ ' + e.message; } });
      reset.addEventListener('click', async function () { if (!confirm('Reset params for both selected engines to model defaults?')) return; try { if (window.resetCharEngineModels) await window.resetCharEngineModels(); } catch (e) {} render(); });
      foot.appendChild(reset); foot.appendChild(sp); foot.appendChild(st); foot.appendChild(save);
    }
    var promptSub = 'create';   // 'create' | 'edit' | 'save' — survives tab switches while the popup is open
    async function renderPrompt() {
      var eng = (typeof window.getCharCreateEngine === 'function') ? window.getCharCreateEngine() : (localStorage.getItem('char_create_engine_v1') || 'z-turbo');
      var realism = localStorage.getItem('char_create_realism_v1') !== '0';
      var meta = el('div', 'crg-meta'); meta.textContent = 'Engine: ' + eng + '  ·  Realism: ' + (realism ? 'on' : 'off'); body.appendChild(meta);

      // Custom-chip field ABOVE the chips, chips above the prompt fields.
      var addRow = el('div', 'crg-chip-add');
      var addInp = document.createElement('input'); addInp.type = 'text'; addInp.placeholder = 'Add a custom realism marker…';
      var addBtn = el('button'); addBtn.type = 'button'; addBtn.textContent = '+ Add';
      addRow.appendChild(addInp); addRow.appendChild(addBtn); body.appendChild(addRow);
      var chipsBox = el('div', 'crg-chips'); body.appendChild(chipsBox);
      function renderChips() {
        chipsBox.innerHTML = '';
        var chips = _realismChips();
        chips.forEach(function (pair, i) {
          var chip = el('span', 'crg-chip' + (pair[1] ? ' on' : '')); chip.title = pair[1] ? 'In the prompt — click to exclude' : 'Excluded — click to include';
          var dot = el('span', 'crg-chip-dot'); chip.appendChild(dot);
          var tx = el('span'); tx.textContent = pair[0]; chip.appendChild(tx);
          if (REALISM_DEFAULTS.indexOf(pair[0]) < 0) {   // custom chips can be removed entirely
            var x = el('span', 'crg-chip-x'); x.textContent = '✕'; x.title = 'Remove this custom marker';
            x.addEventListener('click', function (ev) { ev.stopPropagation(); var c = _realismChips(); c.splice(i, 1); _realismSave(c); renderChips(); refreshBody(); });
            chip.appendChild(x);
          }
          chip.addEventListener('click', function () { var c = _realismChips(); c[i][1] = !c[i][1]; _realismSave(c); renderChips(); refreshBody(); });
          chipsBox.appendChild(chip);
        });
      }
      function addCustom() {
        var t = (addInp.value || '').trim(); if (!t) return;
        var c = _realismChips();
        if (c.some(function (p) { return p[0].toLowerCase() === t.toLowerCase(); })) { addInp.value = ''; return; }
        c.push([t, true]); _realismSave(c); addInp.value = '';
        renderChips(); refreshBody();
      }
      addBtn.addEventListener('click', addCustom);
      addInp.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); addCustom(); } });
      renderChips();

      // Sub-pill: which prompt to preview.
      var subs = el('div', 'crg-subtabs');
      var defs = [['create', 'Create'], ['edit', 'Edit'], ['save', 'Save']];
      var subBtns = {};
      defs.forEach(function (d) {
        var b = el('button', 'crg-subtab' + (promptSub === d[0] ? ' on' : '')); b.type = 'button'; b.textContent = d[1];
        b.addEventListener('click', function () { promptSub = d[0]; defs.forEach(function (x) { subBtns[x[0]].classList.toggle('on', x[0] === promptSub); }); refreshBody(); });
        subBtns[d[0]] = b; subs.appendChild(b);
      });
      body.appendChild(subs);

      var slot = el('div'); body.appendChild(slot);
      async function refreshBody() {
        slot.innerHTML = '';
        var markers = realism ? _realismActive() : [];
        if (promptSub === 'create') {
          var l1 = el('div', 'crg-fld-lbl'); l1.textContent = 'Base prompt (parameters substituted)'; slot.appendChild(l1);
          var pta = el('textarea'); pta.readOnly = true; pta.rows = 8; pta.value = 'Composing…'; slot.appendChild(pta);
          var l2 = el('div', 'crg-fld-lbl'); l2.textContent = 'Parameters (spec)'; slot.appendChild(l2);
          var specStr = assembleMasterPrompt();
          var sta = el('textarea'); sta.readOnly = true; sta.rows = 7; sta.value = specStr; slot.appendChild(sta);
          try {
            var r = await fetch('/api/character-creator/compose', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ spec: specStr }) }).then(function (x) { return x.json(); });
            pta.value = (r && r.success) ? (r.prompt || '(empty)') : ('Error: ' + ((r && r.error) || 'compose failed'));
          } catch (e) { pta.value = 'Error: ' + e.message; }
        } else if (promptSub === 'edit') {
          var le = el('div', 'crg-fld-lbl'); le.textContent = 'Edit / refinement prompt (your instruction slots in)'; slot.appendChild(le);
          var eta = el('textarea'); eta.readOnly = true; eta.rows = 12; eta.value = 'Composing…'; slot.appendChild(eta);
          try {
            var re = await fetch('/api/character-creator/compose', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'edit', age: crVal('age') || '25-34', gender: crVal('gender') || 'female', realismMarkers: markers }) }).then(function (x) { return x.json(); });
            eta.value = (re && re.success) ? (re.prompt || '(empty)') : ('Error: ' + ((re && re.error) || 'compose failed'));
          } catch (e) { eta.value = 'Error: ' + e.message; }
        } else {
          var ls = el('div', 'crg-fld-lbl'); ls.textContent = '4K reference-sheet prompt (Save character)'; slot.appendChild(ls);
          var sta2 = el('textarea'); sta2.readOnly = true; sta2.rows = 14; sta2.value = 'Composing…'; slot.appendChild(sta2);
          try {
            var rs = await fetch('/api/character-creator/compose', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'save', realismMarkers: markers }) }).then(function (x) { return x.json(); });
            sta2.value = (rs && rs.success) ? (rs.prompt || '(empty)') : ('Error: ' + ((rs && rs.error) || 'compose failed'));
          } catch (e) { sta2.value = 'Error: ' + e.message; }
        }
      }
      await refreshBody();
    }
    render();
  }

  // Quick params shown in the left column; the rest live in the Advanced popup.
  var BASIC = ['age', 'gender', 'ethnicity', 'body'];

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

  // ── Constraint-aware randomizer ──────────────────────────────────────────────
  // rnd never produces incompatible combos (manual dropdown picks stay unrestricted):
  //   female/androgynous -> no facial hair; female -> no bald/buzzcut
  //   male               -> makeup only none/natural
  //   teen               -> facial hair at most stubble; teen..40s -> no grey/white hair
  //   ethnicity gates skin tone, hair colour, eye colour; monolid only East Asian/mixed;
  //   coily only African/mixed; bald clears hair colour+style; buzzcut clears style;
  //   braids/ponytail/bun need medium+ hair. Marks never randomize (stay none).
  var _GREY = ['grey', 'white'];
  var _ETH_SKIN = {
    'African': ['tan', 'brown', 'dark', 'deep'],
    'East Asian': ['fair', 'light', 'medium'],
    'South Asian': ['medium', 'olive', 'tan', 'brown'],
    'Middle Eastern': ['olive', 'tan', 'brown'],
    'Hispanic': ['light', 'medium', 'olive', 'tan', 'brown'],
    'Caucasian': ['very fair', 'fair', 'light', 'medium', 'olive', 'tan']
  };
  var _ETH_HAIR = {
    'African': ['black', 'dark brown', 'vivid dyed'],
    'East Asian': ['black', 'dark brown', 'vivid dyed'],
    'South Asian': ['black', 'dark brown', 'vivid dyed'],
    'Middle Eastern': ['black', 'dark brown', 'brown', 'vivid dyed'],
    'Hispanic': ['black', 'dark brown', 'brown', 'auburn', 'vivid dyed']
  };
  var _ETH_EYES = {
    'African': ['brown', 'hazel', 'amber'],
    'East Asian': ['brown', 'hazel', 'amber'],
    'South Asian': ['brown', 'hazel', 'amber'],
    'Middle Eastern': ['brown', 'hazel', 'amber', 'green'],
    'Hispanic': ['brown', 'hazel', 'green']
  };
  var _LONG_STYLES = ['braids', 'ponytail', 'bun'];   // need medium+ hair
  function _allowedOpts(p, v) {
    var opts = p.opts.slice(), k = p.k;
    var g = v.gender, a = v.age, e = v.ethnicity, len = v.hairLength;
    if (k === 'facialHair') {
      if (g === 'female' || g === 'androgynous') return ['none'];
      if (a === 'teen') return ['none', 'stubble'];
    }
    if (k === 'makeup' && g === 'male') return ['none', 'natural'];
    if (k === 'hairLength' && g === 'female') opts = opts.filter(function (o) { return o !== 'bald' && o !== 'buzzcut'; });
    if (k === 'hairColor') {
      if (len === 'bald') return [''];
      if (a === 'teen' || a === '20s' || a === '30s' || a === '40s') opts = opts.filter(function (o) { return _GREY.indexOf(o) < 0; });
      if (_ETH_HAIR[e]) opts = opts.filter(function (o) { return _ETH_HAIR[e].indexOf(o) >= 0; });
    }
    if (k === 'skin' && _ETH_SKIN[e]) opts = _ETH_SKIN[e].slice();
    if (k === 'eyeColor' && _ETH_EYES[e]) opts = _ETH_EYES[e].slice();
    if (k === 'eyeShape' && e && e !== 'East Asian' && e !== 'mixed') opts = opts.filter(function (o) { return o !== 'monolid'; });
    if (k === 'hairStyle') {
      if (len === 'bald' || len === 'buzzcut') return [''];
      if (e && e !== 'African' && e !== 'mixed') opts = opts.filter(function (o) { return o !== 'coily'; });
      if (len === 'short') opts = opts.filter(function (o) { return _LONG_STYLES.indexOf(o) < 0; });
    }
    return opts.length ? opts : [''];
  }
  // Fixed pick order so dependents (skin/hair/eyes/…) see gender/age/ethnicity/length first.
  var _RND_ORDER = ['gender', 'age', 'ethnicity', 'skin', 'body', 'hairLength', 'hairColor', 'hairStyle', 'eyeColor', 'eyeShape', 'faceShape', 'eyebrows', 'facialHair', 'makeup'];
  function _rnd(keys) {
    var picked = {};
    // Seed the context with CURRENT dropdown values, so a simple-mode rnd still
    // respects a manually chosen gender/ethnicity for the params it does touch.
    _allParamKeys().forEach(function (k) { picked[k] = crVal(k); });
    _RND_ORDER.forEach(function (k) {
      if (keys.indexOf(k) < 0) return;
      var p = paramByKey(k); var sel = document.getElementById('cr-p-' + k);
      if (!p || !sel) return;
      var opts = _allowedOpts(p, picked);
      var val = opts[Math.floor(Math.random() * opts.length)];
      sel.value = val; picked[k] = val;
    });
    _mpDirty = false; updatePrompt(); crStatus('');
  }
  // rnd follows the creator mode: simple randomizes the 5 quick params, advanced
  // randomizes everything except marks. Both refresh the name.
  function randomizeVisible() {
    _rnd(_creatorMode() === 'advanced'
      ? _allParamKeys().filter(function (k) { return _MARKS_KEYS.indexOf(k) < 0; })
      : BASIC);
    var nm = $('char-name'); if (nm) nm.value = genName();
  }
  // Reset every parameter to nothing.
  function _rstParams() {
    PARAM_SCHEMA.forEach(function (g) { g.params.forEach(function (p) {
      var sel = document.getElementById('cr-p-' + p.k); if (sel) sel.value = '';
    }); });
    _mpDirty = false; updatePrompt(); crStatus('');
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
  // Show the freshly generated base in the centre preview and enable Save character
  // (a generated face on screen is exactly what makes the character saveable).
  function _applyBase(imagePath, opts) {
    opts = opts || {};
    _loaded = null;   // a freshly generated image ends any card-load baseline
    if (!imagePath) { crStatus('No image returned'); return; }
    var sf = fn('showFace'); if (sf) sf(imagePath);
    try { generatedImagePath = imagePath; } catch (e) {}
    var ph = fn('pushToHistory'); if (ph) ph(imagePath);   // grow session history -> show the centre nav arrows
    var sv = fn('showSaveChar'); if (sv) sv(true);
    var sa = fn('saveAppState'); if (sa) sa();
    if (!opts.silent) crStatus('Base ready.');
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
      var sv2 = fn('showSaveChar'); if (sv2) sv2(!!r.gen);   // Save char follows the restored image
      var sa = fn('saveAppState'); if (sa) sa();
      if (_galRender) _galRender();
      crStatus('Unloaded "' + (c.name || '') + '".');
      return;
    }
    // LOAD (or switch). Capture the canonical pre-load working state.
    if (!_loaded) {
      var gc = fn('_getCurrentCharId');
      _loaded = { charId: c.id, restore: {
        curId: gc ? gc() : null,
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
  function paramEditClick(p, btn) {
    var say = crStatus;
    var base = (typeof generatedImagePath !== 'undefined' && generatedImagePath) ? generatedImagePath : '';
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
    crShowBusy('Edit ' + label);
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
        crHideBusy(true); _applyBase(imagePath, { silent: true });
        say('Applied: ' + label + '.');
      })
      .catch(function (e) { crHideBusy(false); say('Edit failed: ' + ((e && e.message) || e)); })
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

  // Apply the Simple/Advanced mode to the creator: toggles the params container
  // class (1-col basics vs 2-col full grid + master prompt) and re-syncs the
  // master prompt. Called by the header iOS switch + once at boot.
  function applyCreatorMode() {
    var adv = _creatorMode() === 'advanced';
    var box = $('cr-params'); if (box) box.classList.toggle('cr-mode-adv', adv);
    var cr = document.querySelector('.cr-creator'); if (cr) cr.classList.toggle('cr-adv', adv);
    var sw = $('cr-mode-switch'); if (sw) sw.checked = adv;
    var rnd = $('cr-rnd-btn'); if (rnd) rnd.title = adv ? 'Randomize ALL parameters (skips marks) + name' : 'Randomize basics + name';
    updatePrompt();
  }

  // LEFT column: sticky [name | rnd | Create] header + the params grid.
  // Simple mode shows the 5 quick params in one column; Advanced shows EVERY
  // parameter group in a two-column grid + the editable master prompt.
  function buildCreator() {
    var wrap = el('div', 'cr-creator');

    // Sticky action row: name + rnd + Create (always visible above the scroll).
    var head = el('div', 'cr-creator-head');
    var nameSlot = el('div', 'cr-name-slot'); nameSlot.id = 'cr-name-slot';   // #char-name is moved here
    var rnd = el('button', 'cr-rnd'); rnd.type = 'button'; rnd.id = 'cr-rnd-btn'; rnd.textContent = 'rnd'; rnd.title = 'Randomize basics + name';
    rnd.addEventListener('click', randomizeVisible);
    var gen = el('button', 'cr-genbase'); gen.type = 'button'; gen.textContent = '▶ Create';
    gen.title = 'Generate the character from the parameters below';
    gen.addEventListener('click', genBaseClick);
    head.appendChild(nameSlot); head.appendChild(rnd); head.appendChild(gen);
    wrap.appendChild(head);

    // All parameter rows live in ONE container; CSS switches 1-col/2-col and
    // hides advanced-only rows (group titles + non-basic params) in simple mode.
    var box = el('div', 'cr-params'); box.id = 'cr-params';
    PARAM_SCHEMA.forEach(function (g) {
      var gt = el('div', 'cr-grp-title'); gt.textContent = g.group; gt.dataset.adv = '1';
      box.appendChild(gt);
      g.params.forEach(function (p) {
        var row = crRow(p);
        if (BASIC.indexOf(p.k) < 0) row.dataset.adv = '1';
        box.appendChild(row);
      });
    });
    wrap.appendChild(box);

    // Master prompt (advanced only). The ↺ reset-to-JSON button floats in the
    // textarea's top-right corner; edits mark the prompt dirty (used as-is).
    var mp = el('details', 'cr-mp'); mp.dataset.adv = '1';
    var mpsum = el('summary', 'cr-mp-sum'); mpsum.textContent = 'Master prompt';
    var mpbody = el('div', 'cr-mp-body');
    var rstBtn = el('button', 'cr-mp-rst'); rstBtn.type = 'button'; rstBtn.textContent = '↺'; rstBtn.title = 'Rebuild the JSON spec from the dropdowns (discard manual edits)';
    rstBtn.addEventListener('click', function () { _mpDirty = false; updatePrompt(); });
    var ta = el('textarea', 'cr-mp-ta'); ta.id = 'cr-master-prompt'; ta.rows = 6; ta.addEventListener('input', function () { _mpDirty = true; });
    mpbody.appendChild(ta); mpbody.appendChild(rstBtn);
    mp.appendChild(mpsum); mp.appendChild(mpbody);
    wrap.appendChild(mp);

    var st = el('div', 'cr-status'); st.id = 'cr-status'; wrap.appendChild(st);

    setTimeout(function () { applyCreatorMode(); }, 0);
    return wrap;
  }

  // Restructure the Create group: scrollable body (creator) + a draggable sash +
  // a sticky footer holding the refinements box (always visible under the params).
  var REFINE_H_LS = 'cr_refine_h_v1';
  function buildCreatePanel(grp) {
    var scroll = el('div', 'cr-scroll');
    while (grp.firstChild) scroll.appendChild(grp.firstChild);
    scroll.insertBefore(buildCreator(), scroll.firstChild);
    var sash = el('div', 'cr-vsash'); sash.title = 'Drag to resize the refinements box';
    var footer = el('div', 'cr-footer');
    grp.appendChild(scroll);   // attach to the document BEFORE querying by id
    grp.appendChild(sash);
    grp.appendChild(footer);
    var rs = $('refine-section'); if (rs) footer.appendChild(rs);
    // Name field -> top of the creator header (replacing the title); hide its old row.
    var nm = $('char-name'); var slot = $('cr-name-slot');
    if (nm && slot) { var oldRow = nm.closest('.field-row'); slot.appendChild(nm); if (oldRow) oldRow.style.display = 'none'; }
    // Picking a gender regenerates the name to match it.
    var gsel = $('cr-p-gender');
    if (gsel && nm) gsel.addEventListener('change', function () { nm.value = genName(); });
    // Sash: dragging up grows the refinements textarea (params shrink), and the
    // chosen height persists across reloads.
    var ta = $('refine-extra');
    if (ta) {
      var saved = parseInt(localStorage.getItem(REFINE_H_LS), 10);
      if (Number.isFinite(saved)) ta.style.height = Math.max(32, Math.min(400, saved)) + 'px';
      sash.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        var startY = e.clientY;
        var startH = ta.getBoundingClientRect().height;
        sash.setPointerCapture(e.pointerId);
        sash.classList.add('cr-dragging');
        function move(ev) {
          var h = Math.max(32, Math.min(400, Math.round(startH + (startY - ev.clientY))));
          ta.style.height = h + 'px';
        }
        function up() {
          sash.classList.remove('cr-dragging');
          sash.removeEventListener('pointermove', move);
          sash.removeEventListener('pointerup', up);
          try { localStorage.setItem(REFINE_H_LS, parseInt(ta.style.height, 10) || 52); } catch (err) {}
        }
        sash.addEventListener('pointermove', move);
        sash.addEventListener('pointerup', up);
      });
    }
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
    var leftHeader = colTools.querySelector('.col-header');
    if (leftHeader) leftHeader.textContent = 'Create';
    // Keep the WHOLE header row (the "Character" title + the #btn-open-engine
    // engine-picker button) pinned at the very TOP of the left column.
    var headRow = (leftHeader && leftHeader.closest('.col-head-row')) || leftHeader;

    // iOS-style Simple | Advanced switch next to the "Character" title.
    if (headRow) {
      var modeWrap = el('label', 'cr-mode');
      modeWrap.title = 'Simple: 5 quick parameters. Advanced: every parameter + the master prompt.';
      var lblS = el('span', 'cr-mode-lbl'); lblS.textContent = 'Simple';
      var sw = el('span', 'cr-ios');
      var inp = document.createElement('input'); inp.type = 'checkbox'; inp.id = 'cr-mode-switch';
      inp.checked = _creatorMode() === 'advanced';
      inp.addEventListener('change', function () {
        localStorage.setItem(MODE_LS, inp.checked ? 'advanced' : 'simple');
        applyCreatorMode();
      });
      var knob = el('span', 'cr-ios-track'); knob.innerHTML = '<span class="cr-ios-knob"></span>';
      sw.appendChild(inp); sw.appendChild(knob);
      var lblA = el('span', 'cr-mode-lbl'); lblA.textContent = 'Advanced';
      modeWrap.appendChild(lblS); modeWrap.appendChild(sw); modeWrap.appendChild(lblA);
      if (headRow !== leftHeader) headRow.insertBefore(modeWrap, leftHeader.nextSibling);
      else colTools.insertBefore(modeWrap, colTools.firstChild);

      // ⚙ gear next to the "Create" title -> Character-generation popup (Models | Prompt).
      _crGearCss();   // inject at boot: the gear + gallery align-left styles must not wait for the popup
      var crGear = el('button', 'cr-gear'); crGear.type = 'button'; crGear.textContent = '⚙';
      crGear.title = 'Character generation settings (models + prompt)';
      crGear.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); _crGearPop(); });
      if (headRow !== leftHeader) headRow.appendChild(crGear);
      else colTools.insertBefore(crGear, colTools.firstChild);
    }

    var grpCreate = el('div', 'cr-group'); grpCreate.id = 'cr-group-create';

    // Everything currently in the left column (minus the header) is the creator.
    Array.prototype.slice.call(colTools.children).forEach(function (ch) {
      if (ch === headRow) return;
      grpCreate.appendChild(ch);
    });

    colTools.appendChild(grpCreate);

    // Build the character-creator UI + sticky refinements footer.
    buildCreatePanel(grpCreate);

    // Save character -> the media button row: Delete keeps 1/4 on the left,
    // Save character takes the remaining 3/4 (sizes via CSS flex).
    var saveBtn = $('btn-save-persa-col2');
    var imgBtns = document.querySelector('.img-buttons');
    if (saveBtn && imgBtns) imgBtns.appendChild(saveBtn);

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
      var base = c.baseFace || c.sheet || c.portrait || c.tpose || '';
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

        // Load-to-preview = top-left; Delete = top-right. Clicking the CARD opens
        // the character view popup (see the card click handler below).
        var bE = el('button', 'cr-card-load'); bE.type = 'button'; bE.textContent = '⬅'; bE.title = 'Load into the centre preview (click again to unload)';
        bE.addEventListener('click', function (e) { e.stopPropagation(); toggleLoad(card, c); });
        var bD = el('button', 'cr-card-del'); bD.type = 'button'; bD.textContent = '✕'; bD.title = 'Delete character';
        bD.addEventListener('click', function (e) { e.stopPropagation(); delChar(c); });

        var nm = el('div', 'cr-card-name'); nm.textContent = c.name || 'Unnamed';

        card.appendChild(im); card.appendChild(bE); card.appendChild(bD); card.appendChild(nm);

        // 4K reference sheet still generating -> spinner badge in the corner.
        if (c.sheetTask && !c.sheet) {
          var gen = el('div', 'cr-card-gen'); gen.title = 'Generating the 4K reference sheet…';
          card.appendChild(gen);
        }

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

        card.addEventListener('click', function () { var f = fn('openCharacterActorPopup'); if (f) f(c.id); });
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
        Promise.resolve(r).then(function () { renderGallery(); _sheetPoll(); }, renderGallery);
        return r;
      };
    }

    // While any character's 4K sheet is still generating, re-fetch the list every
    // few seconds so the card spinner clears the moment the sheet lands.
    var _sheetPollT = null;
    function _sheetPoll() {
      var pending = actors().some(function (c) { return c.sheetTask && !c.sheet; });
      if (!pending || _sheetPollT) return;
      _sheetPollT = setTimeout(function () {
        _sheetPollT = null;
        var lct = fn('loadCharacterThumbs');   // wrapped above -> re-renders + re-arms
        if (lct) lct();
      }, 4000);
    }

    // Initial render (+ short poll until the first /api/char-store/list resolves).
    _galRender = renderGallery;   // expose for toggleLoad (load/unload from a card)
    renderGallery();
    var tries = 0;
    (function poll() {
      renderGallery();
      if (!actors().length && tries++ < 12) { setTimeout(poll, 300); return; }
      _sheetPoll();
    })();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
