// CHARACTER v2 — the twenty presets, and the prompt they build.
//
// Every preset was checked against schema.js's own dependency rules before it was written
// down, so choosing one always leaves the dropdowns in a state they would allow you to reach
// by hand. Two consequences are visible in the data and are not mistakes:
//
//   • Lagos Steel has hairStyle: '' — a buzzcut has no style, and the rules return nothing
//     for that parameter.
//   • Levant Cedar is dark brown rather than grey, because the Middle Eastern hair table has
//     no grey in it. Baltic Grey gets the grey instead: he is Caucasian and 60+, the only
//     combination the age filter allows it for.
//
// Coverage is deliberate: all six ethnicities plus mixed, teen through 60+, both genders plus
// androgynous, and every one of the five body types.

export const PRESETS = [
  { id: 'nordic-frost',     name: 'Nordic Frost',     v: { age: '20s', gender: 'female', ethnicity: 'Caucasian', body: 'slim', skin: 'very fair', hairColor: 'platinum', hairLength: 'long', hairStyle: 'straight', eyeColor: 'blue', eyeShape: 'almond', faceShape: 'oval', eyebrows: 'thin', facialHair: 'none', makeup: 'natural', scars: 'none', tattoos: 'none', piercings: 'none', freckles: 'light freckles' } },
  { id: 'sahel-gold',       name: 'Sahel Gold',       v: { age: '30s', gender: 'female', ethnicity: 'African', body: 'athletic', skin: 'brown', hairColor: 'black', hairLength: 'medium', hairStyle: 'coily', eyeColor: 'amber', eyeShape: 'almond', faceShape: 'heart', eyebrows: 'thick', facialHair: 'none', makeup: 'natural', scars: 'none', tattoos: 'none', piercings: 'none', freckles: 'none' } },
  { id: 'kyoto-ink',        name: 'Kyoto Ink',        v: { age: '20s', gender: 'female', ethnicity: 'East Asian', body: 'slim', skin: 'fair', hairColor: 'black', hairLength: 'long', hairStyle: 'straight', eyeColor: 'brown', eyeShape: 'monolid', faceShape: 'oval', eyebrows: 'straight', facialHair: 'none', makeup: 'editorial', scars: 'none', tattoos: 'none', piercings: 'none', freckles: 'none' } },
  { id: 'marrakech-ember',  name: 'Marrakech Ember',  v: { age: '30s', gender: 'male', ethnicity: 'Middle Eastern', body: 'athletic', skin: 'olive', hairColor: 'black', hairLength: 'short', hairStyle: 'wavy', eyeColor: 'hazel', eyeShape: 'hooded', faceShape: 'square', eyebrows: 'bushy', facialHair: 'full beard', makeup: 'none', scars: 'none', tattoos: 'none', piercings: 'none', freckles: 'none' } },
  { id: 'havana-bloom',     name: 'Havana Bloom',     v: { age: '20s', gender: 'female', ethnicity: 'Hispanic', body: 'curvy', skin: 'tan', hairColor: 'dark brown', hairLength: 'very long', hairStyle: 'wavy', eyeColor: 'brown', eyeShape: 'almond', faceShape: 'round', eyebrows: 'arched', facialHair: 'none', makeup: 'bold lip', scars: 'none', tattoos: 'none', piercings: 'none', freckles: 'none' } },
  { id: 'kerala-dusk',      name: 'Kerala Dusk',      v: { age: '30s', gender: 'female', ethnicity: 'South Asian', body: 'average', skin: 'brown', hairColor: 'black', hairLength: 'long', hairStyle: 'straight', eyeColor: 'brown', eyeShape: 'almond', faceShape: 'oval', eyebrows: 'thick', facialHair: 'none', makeup: 'natural', scars: 'none', tattoos: 'none', piercings: 'none', freckles: 'none' } },
  { id: 'highland-rust',    name: 'Highland Rust',    v: { age: '40s', gender: 'male', ethnicity: 'Caucasian', body: 'average', skin: 'fair', hairColor: 'red', hairLength: 'short', hairStyle: 'wavy', eyeColor: 'green', eyeShape: 'round', faceShape: 'square', eyebrows: 'bushy', facialHair: 'short beard', makeup: 'none', scars: 'none', tattoos: 'none', piercings: 'none', freckles: 'heavy freckles' } },
  { id: 'lagos-steel',      name: 'Lagos Steel',      v: { age: '20s', gender: 'male', ethnicity: 'African', body: 'athletic', skin: 'dark', hairColor: 'black', hairLength: 'buzzcut', hairStyle: '', eyeColor: 'brown', eyeShape: 'almond', faceShape: 'oval', eyebrows: 'thick', facialHair: 'stubble', makeup: 'none', scars: 'none', tattoos: 'none', piercings: 'none', freckles: 'none' } },
  { id: 'seoul-neon',       name: 'Seoul Neon',       v: { age: '20s', gender: 'androgynous', ethnicity: 'East Asian', body: 'slim', skin: 'light', hairColor: 'vivid dyed', hairLength: 'short', hairStyle: 'undercut', eyeColor: 'brown', eyeShape: 'monolid', faceShape: 'heart', eyebrows: 'thin', facialHair: 'none', makeup: 'natural', scars: 'none', tattoos: 'none', piercings: 'multiple ear', freckles: 'none' } },
  { id: 'andalusian-smoke', name: 'Andalusian Smoke', v: { age: '40s', gender: 'female', ethnicity: 'Hispanic', body: 'average', skin: 'olive', hairColor: 'black', hairLength: 'medium', hairStyle: 'bun', eyeColor: 'hazel', eyeShape: 'hooded', faceShape: 'diamond', eyebrows: 'natural', facialHair: 'none', makeup: 'smoky', scars: 'none', tattoos: 'none', piercings: 'none', freckles: 'none' } },
  { id: 'baltic-grey',      name: 'Baltic Grey',      v: { age: '60+', gender: 'male', ethnicity: 'Caucasian', body: 'slim', skin: 'light', hairColor: 'grey', hairLength: 'short', hairStyle: 'slicked back', eyeColor: 'grey', eyeShape: 'hooded', faceShape: 'long', eyebrows: 'straight', facialHair: 'moustache', makeup: 'none', scars: 'none', tattoos: 'none', piercings: 'none', freckles: 'none' } },
  { id: 'nubian-crown',     name: 'Nubian Crown',     v: { age: '20s', gender: 'female', ethnicity: 'African', body: 'slim', skin: 'deep', hairColor: 'black', hairLength: 'long', hairStyle: 'braids', eyeColor: 'brown', eyeShape: 'upturned', faceShape: 'oval', eyebrows: 'arched', facialHair: 'none', makeup: 'glam', scars: 'none', tattoos: 'none', piercings: 'none', freckles: 'none' } },
  { id: 'anatolian-stone',  name: 'Anatolian Stone',  v: { age: '30s', gender: 'female', ethnicity: 'Middle Eastern', body: 'athletic', skin: 'tan', hairColor: 'dark brown', hairLength: 'long', hairStyle: 'straight', eyeColor: 'green', eyeShape: 'almond', faceShape: 'square', eyebrows: 'thick', facialHair: 'none', makeup: 'natural', scars: 'none', tattoos: 'none', piercings: 'none', freckles: 'none' } },
  { id: 'bengal-monsoon',   name: 'Bengal Monsoon',   v: { age: '20s', gender: 'male', ethnicity: 'South Asian', body: 'slim', skin: 'medium', hairColor: 'black', hairLength: 'medium', hairStyle: 'curly', eyeColor: 'brown', eyeShape: 'round', faceShape: 'oval', eyebrows: 'thick', facialHair: 'stubble', makeup: 'none', scars: 'none', tattoos: 'none', piercings: 'none', freckles: 'none' } },
  { id: 'provence-linen',   name: 'Provence Linen',   v: { age: '50s', gender: 'female', ethnicity: 'Caucasian', body: 'average', skin: 'light', hairColor: 'light brown', hairLength: 'short', hairStyle: 'wavy', eyeColor: 'blue', eyeShape: 'downturned', faceShape: 'heart', eyebrows: 'natural', facialHair: 'none', makeup: 'natural', scars: 'none', tattoos: 'none', piercings: 'none', freckles: 'beauty mark' } },
  { id: 'oaxaca-clay',      name: 'Oaxaca Clay',      v: { age: '30s', gender: 'male', ethnicity: 'Hispanic', body: 'average', skin: 'brown', hairColor: 'black', hairLength: 'short', hairStyle: 'straight', eyeColor: 'brown', eyeShape: 'hooded', faceShape: 'round', eyebrows: 'thick', facialHair: 'goatee', makeup: 'none', scars: 'none', tattoos: 'none', piercings: 'none', freckles: 'none' } },
  { id: 'hokkaido-snow',    name: 'Hokkaido Snow',    v: { age: '40s', gender: 'male', ethnicity: 'East Asian', body: 'average', skin: 'fair', hairColor: 'black', hairLength: 'short', hairStyle: 'slicked back', eyeColor: 'brown', eyeShape: 'monolid', faceShape: 'long', eyebrows: 'straight', facialHair: 'none', makeup: 'none', scars: 'none', tattoos: 'none', piercings: 'none', freckles: 'none' } },
  { id: 'levant-cedar',     name: 'Levant Cedar',     v: { age: '50s', gender: 'male', ethnicity: 'Middle Eastern', body: 'plus-size', skin: 'brown', hairColor: 'dark brown', hairLength: 'medium', hairStyle: 'wavy', eyeColor: 'amber', eyeShape: 'hooded', faceShape: 'square', eyebrows: 'bushy', facialHair: 'full beard', makeup: 'none', scars: 'none', tattoos: 'none', piercings: 'none', freckles: 'none' } },
  { id: 'tokyo-midnight',   name: 'Tokyo Midnight',   v: { age: '30s', gender: 'female', ethnicity: 'East Asian', body: 'slim', skin: 'medium', hairColor: 'black', hairLength: 'very long', hairStyle: 'straight', eyeColor: 'brown', eyeShape: 'almond', faceShape: 'diamond', eyebrows: 'arched', facialHair: 'none', makeup: 'smoky', scars: 'none', tattoos: 'none', piercings: 'none', freckles: 'none' } },
];

export const presetById = (id) => PRESETS.find(p => p.id === id) || null;
// 3:2, so an example fills the column's width without letterboxing.
export const exampleUrl = (id) => '/presets/' + id + '.jpg';

// ── The prompt, as segments ─────────────────────────────────────────────────
// The panel needs the prompt as parts so each value can be a clickable token; the generator
// needs it as a string. One definition, so the words a user reads are the words that get sent.
//
// Every parameter appears, even at 'none', because a token you cannot see is a token you
// cannot click - and clicking is the point of the field. The flattened form drops them.
//
// The framing names shoulders and upper chest deliberately: body type is one of the eighteen
// parameters, and a tight face crop would throw that information away. It matters downstream
// too - the 4K reference sheet is built from the same values.
const SEGMENTS = [
  { text: 'Studio portrait with head, shoulders and upper chest in frame, of a ' },
  { k: 'age' }, { text: ' ' }, { k: 'gender' },
  { text: ', ' }, { k: 'ethnicity' },
  { text: ', ' }, { k: 'body' }, { text: ' build' },
  { text: ', ' }, { k: 'skin' }, { text: ' skin.' },
  { text: ' Hair: ' }, { k: 'hairColor' }, { text: ', ' }, { k: 'hairLength' }, { text: ', ' }, { k: 'hairStyle' }, { text: '.' },
  { text: ' Eyes: ' }, { k: 'eyeColor' }, { text: ', ' }, { k: 'eyeShape' }, { text: '.' },
  { text: ' Face: ' }, { k: 'faceShape' }, { text: ', ' }, { k: 'eyebrows' }, { text: ' eyebrows' },
  { text: ', facial hair ' }, { k: 'facialHair' },
  { text: ', makeup ' }, { k: 'makeup' }, { text: '.' },
  { text: ' Marks: ' }, { k: 'scars' }, { text: ', ' }, { k: 'tattoos' }, { text: ', ' }, { k: 'piercings' }, { text: ', ' }, { k: 'freckles' }, { text: '.' },
  { text: ' Plain neutral mid-grey studio backdrop, clearly contrasting with the subject.' },
];

export function promptSegments(values) {
  return SEGMENTS.map(s => (s.k ? { k: s.k, value: values[s.k] || '' } : s));
}

// What actually gets sent. 'none' and blank say nothing useful to an image model, so they are
// dropped here rather than shown as noise; realism markers and negatives are appended by the
// caller, because they are generation policy rather than something the user is editing.
export function promptText(values) {
  const has = (k) => values[k] && values[k] !== 'none';
  const bits = [];
  bits.push('Studio portrait with head, shoulders and upper chest in frame, of a '
    + [values.age, values.gender].filter(Boolean).join(' ')
    + (has('ethnicity') ? ', ' + values.ethnicity : '')
    + (has('body') ? ', ' + values.body + ' build' : '')
    + (has('skin') ? ', ' + values.skin + ' skin' : '') + '.');
  const hair = ['hairColor', 'hairLength', 'hairStyle'].filter(has).map(k => values[k]);
  if (hair.length) bits.push('Hair: ' + hair.join(', ') + '.');
  const eyes = ['eyeColor', 'eyeShape'].filter(has).map(k => values[k]);
  if (eyes.length) bits.push('Eyes: ' + eyes.join(', ') + '.');
  const face = [];
  if (has('faceShape')) face.push(values.faceShape + ' face');
  if (has('eyebrows')) face.push(values.eyebrows + ' eyebrows');
  if (has('facialHair')) face.push(values.facialHair);
  if (has('makeup')) face.push(values.makeup + ' makeup');
  if (face.length) bits.push(face.join(', ') + '.');
  const marks = ['scars', 'tattoos', 'piercings', 'freckles'].filter(has).map(k => values[k]);
  if (marks.length) bits.push('Marks: ' + marks.join(', ') + '.');
  bits.push('Plain neutral mid-grey studio backdrop, clearly contrasting with the subject.');
  return bits.join(' ');
}
