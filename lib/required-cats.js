'use strict';

// ════════════════════════════════════════════════════════════════════════════
// THE REQUIRED CATEGORIES ARE ALWAYS THERE (phase V28.4, the owner 2026-10-12) - lib/library-cats.js REQUIRED: made
// when missing, and a second one of the same name (an older library has two "Generated" in Images - two folders,
// `Generated` and `Generated (2)`) folded into the first with its files (lib/project-cats.js merge), the first being
// the one LC.add files into. They are put first in their kind's order, as the media tree shows them.
//
//   ensure() -> { made: ['images/Screenshots', ...], merged: [{ kind, label, records }] }
//
// Run when the server starts (routes/library.js) and after an Import (routes/data-io.js) - one may bring its own.
// ════════════════════════════════════════════════════════════════════════════

const LC = require('./library-cats');

const _lc = (s) => String(s || '').trim().toLowerCase();

function ensure() {
  const out = { made: [], merged: [] };
  for (const kind of Object.keys(LC.REQUIRED)) {
    const firsts = [];
    for (const label of LC.REQUIRED[kind]) {
      try {
        const same = ((LC.read()[kind] || {}).own || []).filter(c => _lc(c.label) === _lc(label));
        if (!same.length) {
          firsts.push(LC.add(kind, label).cat.id);
          out.made.push(kind + '/' + label);
          continue;
        }
        firsts.push(same[0].id);
        for (const extra of same.slice(1)) {
          const records = require('./project-cats').merge(kind, extra, same[0]);
          out.merged.push({ kind, label, records });
        }
      } catch (e) {
        console.warn('[library] the required category ' + kind + '/' + label + ' was not made ready -', e.message);
      }
    }
    // First in the kind's order, in the order they are listed.
    try {
      const order = (LC.read()[kind] || {}).order || [];
      const want = firsts.concat(order.filter(id => !firsts.includes(id)));
      if (want.join() !== order.join()) LC.setOrder(kind, want);
    } catch (e) { /* the order is a display concern */ }
  }
  return out;
}

module.exports = { ensure };
