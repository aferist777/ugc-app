// CHARACTER v2 — the creation schema.
//
// Copied VERBATIM out of public/js/character-redesign.js so the options a user sees are the
// same ones the old creator offered: the same 18 parameters, the same values, the same
// dependency rules and the same randomiser order. Only the wrapping changed - the source
// lives inside an IIFE and reaches for DOM ids, this is a module that takes and returns data.
//
// The dependency rules are the valuable part and the reason this is data rather than a
// rewrite: they are what stops the randomiser producing a female with a full beard, grey
// hair on a twenty-year-old, or a wavy hairstyle on a bald head.
//
// Nothing here touches the DOM. allowedOpts(param, picked) answers "given what is chosen so
// far, which values may this parameter take", and that is all the panel needs.

// ── The 18 parameters, in five groups ───────────────────────────────────────
const PARAM_SCHEMA = [
  { group: 'Basics', params: [
    { k: 'age',       label: 'Age',       opts: ['20s', '30s', '40s', '50s', '60+'] },
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

// Marks default to none and are excluded from the randomiser: a scar or a tattoo is a
// deliberate choice, not something to be handed out at random.
const _NONE_DEFAULT = ['scars', 'tattoos', 'piercings', 'freckles', 'facialHair', 'makeup'];
const _MARKS_KEYS = ['scars', 'tattoos', 'piercings', 'freckles'];   // excluded from rnd

// Simple mode shows only these; advanced shows every group.
const BASIC = ['age', 'gender', 'ethnicity', 'body'];

// Randomised in this order, so a later parameter can react to an earlier one.
const _RND_ORDER = ['gender', 'age', 'ethnicity', 'skin', 'body', 'hairLength', 'hairColor', 'hairStyle', 'eyeColor', 'eyeShape', 'faceShape', 'eyebrows', 'facialHair', 'makeup'];

// ── Ethnicity-aware option tables ───────────────────────────────────────────
const _GREY = ['grey', 'white'];
const _ETH_SKIN = {
  'African': ['tan', 'brown', 'dark', 'deep'],
  'East Asian': ['fair', 'light', 'medium'],
  'South Asian': ['medium', 'olive', 'tan', 'brown'],
  'Middle Eastern': ['olive', 'tan', 'brown'],
  'Hispanic': ['light', 'medium', 'olive', 'tan', 'brown'],
  'Caucasian': ['very fair', 'fair', 'light', 'medium', 'olive', 'tan']
};
const _ETH_HAIR = {
  'African': ['black', 'dark brown', 'vivid dyed'],
  'East Asian': ['black', 'dark brown', 'vivid dyed'],
  'South Asian': ['black', 'dark brown', 'vivid dyed'],
  'Middle Eastern': ['black', 'dark brown', 'brown', 'vivid dyed'],
  'Hispanic': ['black', 'dark brown', 'brown', 'auburn', 'vivid dyed']
};
const _ETH_EYES = {
  'African': ['brown', 'hazel', 'amber'],
  'East Asian': ['brown', 'hazel', 'amber'],
  'South Asian': ['brown', 'hazel', 'amber'],
  'Middle Eastern': ['brown', 'hazel', 'amber', 'green'],
  'Hispanic': ['brown', 'hazel', 'green']
};
const _LONG_STYLES = ['braids', 'ponytail', 'bun'];   // need medium+ hair

// ── Which values a parameter may take, given what is already chosen ─────────
function _allowedOpts(p, v) {
  var opts = p.opts.slice(), k = p.k;
  var g = v.gender, a = v.age, e = v.ethnicity, len = v.hairLength;
  if (k === 'facialHair') {
    if (g === 'female' || g === 'androgynous') return ['none'];
  }
  if (k === 'makeup' && g === 'male') return ['none', 'natural'];
  if (k === 'hairLength' && g === 'female') opts = opts.filter(function (o) { return o !== 'bald' && o !== 'buzzcut'; });
  if (k === 'hairColor') {
    if (len === 'bald') return [''];
    if (a === '20s' || a === '30s' || a === '40s') opts = opts.filter(function (o) { return _GREY.indexOf(o) < 0; });
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

// ── Name generator ──────────────────────────────────────────────────────────
const _GN_FIRST = ['Ava', 'Mia', 'Zoe', 'Lily', 'Ella', 'Nora', 'Ruby', 'Iris', 'Jake', 'Liam', 'Noah', 'Ethan', 'Mason', 'Leo', 'Kai', 'Max', 'Cole', 'Finn', 'Owen', 'Reed'];
const _GN_NICK = ['Nova', 'Maverick', 'Ghost', 'Ace', 'Blaze', 'Echo', 'Frost', 'Raven', 'Pixel', 'Storm', 'Onyx', 'Lux', 'Sable', 'Riot', 'Hawk', 'Jet', 'Saint', 'Wren'];
const _GN_LAST = ['Carter', 'Reed', 'Hayes', 'Brooks', 'Stone', 'Vance', 'Cruz', 'Wolfe', 'Quinn', 'Lane', 'Pierce', 'Knox', 'Rhodes', 'Blake', 'Mercer', 'Hale', 'Dane', 'Vale'];
export function genName() {
  const pk = (a) => a[Math.floor(Math.random() * a.length)];
  return pk(_GN_FIRST) + ' "' + pk(_GN_NICK) + '" ' + pk(_GN_LAST);
}

export function paramByKey(k) {
  let r = null;
  PARAM_SCHEMA.forEach(g => g.params.forEach(p => { if (p.k === k) r = p; }));
  return r;
}
export const allParamKeys = () => PARAM_SCHEMA.flatMap(g => g.params.map(p => p.k));
export const allowedOpts = _allowedOpts;
export { PARAM_SCHEMA, BASIC, _MARKS_KEYS as MARKS_KEYS, _NONE_DEFAULT as NONE_DEFAULT, _RND_ORDER as RND_ORDER };
