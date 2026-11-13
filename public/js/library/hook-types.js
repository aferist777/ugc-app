// ════════════════════════════════════════════════════════════════════════════
// THE HOOK TYPES - forty kinds of hook, each with a name and a description. The person chooses how many hooks a press
// writes; that many types are picked at random and one hook is written per type.
//
// ONE module for the page and the server (routes/scriptgen.js require()s it, like the captions' presets): the page shows
// a hook's type by its name, its description on hover; the server picks the types at random and gives the writer their
// names and descriptions - one hook per type - and tells the script's writer how the chosen hook works.
//
// An id never changes: drafts keep it. The first five are also the hook kinds older drafts name, under the same ids, so
// such a draft finds its hooks' names here too.
// ════════════════════════════════════════════════════════════════════════════

export const HOOK_TYPES = [
  { id: 'number', name: 'Shocking number', about: 'One striking figure from the story that makes the scale real.' },
  { id: 'contradiction', name: 'Contradiction', about: 'Two things that cannot both be true - and both are.' },
  { id: 'question', name: 'Burning question', about: 'The question the whole video answers.' },
  { id: 'scene', name: 'Mid-scene', about: 'Drops the viewer into one vivid moment, mid-action, with no setup.' },
  { id: 'challenge', name: 'Challenge', about: 'Dares the viewer to guess, try or believe something.' },
  { id: 'curiosity_gap', name: 'Curiosity gap', about: 'Hints at a surprising fact but holds the key part back.' },
  { id: 'bold_claim', name: 'Bold claim', about: 'One confident statement that sounds too strong to be true.' },
  { id: 'myth', name: 'Myth buster', about: 'Names what everyone believes and says it is wrong.' },
  { id: 'unpopular', name: 'Unpopular opinion', about: 'Takes the side most people would argue against.' },
  { id: 'end_first', name: 'The end first', about: 'Starts with how it all ended, then goes back to how it began.' },
  { id: 'secret', name: 'The secret', about: 'Promises something hidden, unknown or kept quiet.' },
  { id: 'untold', name: 'What nobody talks about', about: 'Points at the part of the story usually left out.' },
  { id: 'warning', name: 'Warning', about: 'Opens on a danger or a mistake the viewer could make.' },
  { id: 'mistake', name: 'The mistake', about: 'One wrong decision and what it cost.' },
  { id: 'confession', name: 'Confession', about: 'The narrator admits something personal about the topic.' },
  { id: 'you', name: 'Talking to you', about: 'Puts the viewer inside the story: "you" are there.' },
  { id: 'call_out', name: 'Call-out', about: 'Names exactly who this is for ("If you have ever...").' },
  { id: 'imagine', name: 'Imagine', about: 'Asks the viewer to picture a situation, then says it is real.' },
  { id: 'what_if', name: 'What if', about: 'A hypothetical that turns the topic upside down.' },
  { id: 'prediction', name: 'Prediction', about: 'What will happen next, and why it matters now.' },
  { id: 'comparison', name: 'Comparison', about: 'Two things side by side, so the difference shocks.' },
  { id: 'before_after', name: 'Before and after', about: 'How it was and how it is now, in one breath.' },
  { id: 'irony', name: 'Irony', about: 'The outcome is the opposite of what was intended.' },
  { id: 'date', name: 'Date stamp', about: 'An exact date, time or place, like a news report.' },
  { id: 'quote', name: 'Quote', about: 'Opens with words someone actually said.' },
  { id: 'analogy', name: 'Analogy', about: 'The topic through something everyday and familiar.' },
  { id: 'sensory', name: 'Sensory detail', about: 'A sound, smell or texture that makes the moment physical.' },
  { id: 'cliffhanger', name: 'Cliffhanger', about: 'Stops right before the key moment and promises it.' },
  { id: 'list', name: 'List promise', about: 'A set number of things the viewer is about to learn.' },
  { id: 'how_it_works', name: 'How it really works', about: 'Promises the mechanism behind something familiar.' },
  { id: 'stakes', name: 'High stakes', about: 'What could be lost: a life, a fortune, a name.' },
  { id: 'underdog', name: 'The underdog', about: 'Someone with no chance, up against something huge.' },
  { id: 'villain', name: 'The villain', about: 'Starts with the person or thing behind the trouble.' },
  { id: 'turning_point', name: 'Turning point', about: 'The one moment after which nothing was the same.' },
  { id: 'hidden_cause', name: 'Hidden cause', about: 'An unexpected cause behind a well-known effect.' },
  { id: 'experiment', name: 'The experiment', about: 'Someone tried something for a while - the test and its result.' },
  { id: 'relatable', name: 'Relatable moment', about: 'An everyday situation the viewer has surely lived through.' },
  { id: 'pattern_break', name: 'Pattern break', about: 'An odd, unexpected first line that stops the scroll.' },
  { id: 'price', name: 'Price tag', about: 'What it all cost, in money or in time.' },
  { id: 'definition', name: 'Broken definition', about: 'The dictionary meaning of a word - and then it breaks.' },
];

// How many hooks one press writes: 1-10 in a dropdown, five unless chosen otherwise, the last choice remembered.
export const HOOK_COUNT = { min: 1, max: 10, default: 5 };

const _BY = new Map(HOOK_TYPES.map(t => [t.id, t]));

/** A type by its id (an older draft may say "Number" or "a number": read loosely), or null. */
export function hookType(id) {
  const k = String(id || '').trim().toLowerCase();
  if (_BY.has(k)) return _BY.get(k);
  const word = k.replace(/^(a|an|the)\s+/, '').split(/\s+/)[0];
  return _BY.get(word) || null;
}

/** A count within 1-10; anything else is the default. */
export function hookCount(n) {
  const v = parseInt(n, 10);
  return Number.isInteger(v) && v >= HOOK_COUNT.min && v <= HOOK_COUNT.max ? v : HOOK_COUNT.default;
}

/** `n` different types, at random. */
export function pickTypes(n, rnd = Math.random) {
  const all = HOOK_TYPES.slice();
  const want = Math.min(hookCount(n), all.length);
  for (let i = 0; i < want; i++) {
    const j = i + Math.floor(rnd() * (all.length - i));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all.slice(0, want);
}
