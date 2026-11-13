'use strict';

// ════════════════════════════════════════════════════════════════════════════
// THE REQUIRED CATEGORIES ARE ALWAYS THERE - lib/library-cats.js REQUIRED: made
// when missing, and a second one of the same name (an older library has two "Generated" in Images - two folders,
// `Generated` and `Generated (2)`) folded into the first with its files (lib/project-cats.js merge), the first being
// the one LC.add files into. (The media tree orders them itself: the locked first, the rest alphabetical.)
//
//   ensure() -> { made: ['images/Screenshots', ...], merged: [{ kind, label, records }] }
//
// Run when the server starts (routes/library.js). Only the TOP of a kind counts: a folder named
// "Generated" inside another is the person's own, never folded.
// ════════════════════════════════════════════════════════════════════════════

const LC = require('./library-cats');

const _lc = (s) => String(s || '').trim().toLowerCase();

function ensure() {
  const out = { made: [], merged: [] };
  for (const kind of Object.keys(LC.REQUIRED)) {
    for (const label of LC.REQUIRED[kind]) {
      try {
        const same = ((LC.read()[kind] || {}).own || []).filter(c => !c.parent && _lc(c.label) === _lc(label));
        if (!same.length) {
          LC.make(kind, label, '');
          out.made.push(kind + '/' + label);
          continue;
        }
        for (const extra of same.slice(1)) {
          const records = require('./project-cats').merge(kind, extra, same[0]);
          out.merged.push({ kind, label, records });
        }
      } catch (e) {
        console.warn('[library] the required category ' + kind + '/' + label + ' was not made ready -', e.message);
      }
    }
  }
  return out;
}

module.exports = { ensure };
