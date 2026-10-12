'use strict';

// ════════════════════════════════════════════════════════════════════════════
// THE REQUIRED CATEGORIES ARE ALWAYS THERE (phase V28.4, the owner 2026-10-12) - lib/library-cats.js REQUIRED: made
// when missing, and a second one of the same name (an older library has two "Generated" in Images - two folders,
// `Generated` and `Generated (2)`) folded into the first with its files (lib/project-cats.js merge), the first being
// the one LC.add files into. (The media tree orders them itself: the locked first, the rest alphabetical.)
//
//   ensure() -> { made: ['images/Screenshots', ...], merged: [{ kind, label, records }] }
//   moveChatMade() -> { images, birols } | null    what the chats made before V28.4 into "Generated" - once (below)
//
//   releaseBrollGenerated() -> records | null   B-roll's "Generated" of the first round let go of - once (below)
//
// Run when the server starts (routes/library.js); ensure() after an Import too (routes/data-io.js) - one may bring its own.
// ════════════════════════════════════════════════════════════════════════════

const LC = require('./library-cats');

const _lc = (s) => String(s || '').trim().toLowerCase();

function ensure() {
  const out = { made: [], merged: [] };
  for (const kind of Object.keys(LC.REQUIRED)) {
    for (const label of LC.REQUIRED[kind]) {
      try {
        const same = ((LC.read()[kind] || {}).own || []).filter(c => _lc(c.label) === _lc(label));
        if (!same.length) {
          LC.add(kind, label);
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

// ── What the chats made before V28.4 goes into "Generated", ONCE (the owner, 2026-10-12: "перенести") ─────────────
// Until then a chat filed what it made under the project's name (and a draft not saved under none). A picture the chats
// made says so (`source: 'gen'` - the pictures chat, a storyboard, a first frame): into Images' "Generated". A clip the
// video chat made carries its model (`meta.model`): since the second round it goes to NO category - VIDEO -> Generated
// -> Uncategorized. With its files (lib/shelf-files.js placeRecords, every path following). Once per library -
// data/library.json remembers it - so what the person files elsewhere later is never brought back.
const MARK = 'v28.4 chat-made into Generated';

function _marker() {
  const f = require('path').join(require('./config').DATA_DIR, 'library.json');
  let m = {};
  try { m = JSON.parse(require('fs').readFileSync(f, 'utf8')) || {}; } catch (e) { m = {}; }
  return { f, m };
}

function moveChatMade() {
  const { f, m } = _marker();
  if (Array.isArray(m.done) && m.done.includes(MARK)) return null;
  const SHELF = require('./shelf-files');
  const out = { images: 0, birols: 0 };
  const into = (kind) => ((LC.read()[kind] || {}).own || []).find(c => _lc(c.label) === _lc('Generated')) || null;

  const gi = into('images');
  if (gi) {
    const IMG = require('./images-store');
    const list = IMG.read();
    const ids = new Set();
    for (const e of list) {
      if (!e || e.source !== 'gen' || String(e.categoryId || '') === gi.id) continue;
      e.categoryId = gi.id; e.categoryLabel = gi.label; ids.add(String(e.id));
    }
    if (ids.size) {
      IMG.write(list);
      SHELF.placeRecords(IMG.read().filter(e => e && ids.has(String(e.id))).map(rec => ({ kind: 'images', rec })));
    }
    out.images = ids.size;
  }
  {
    const B = require('./birols-store');
    const list = B.read();
    const ids = new Set();
    for (const e of list) {
      if (!e || e.source === 'upload' || e.categoryId === LC.UPLOADS_CAT || !(e.meta && e.meta.model)) continue;
      if (!e.categoryId) continue;
      e.categoryId = ''; e.categoryLabel = ''; ids.add(String(e.id));
    }
    if (ids.size) {
      B.write(list);
      SHELF.placeRecords(B.read().filter(e => e && ids.has(String(e.id))).map(rec => ({ kind: 'birols', rec })));
    }
    out.birols = ids.size;
  }
  if (!gi) return out;                     // asked again next start, once it is there
  m.done = (Array.isArray(m.done) ? m.done : []).concat(MARK);
  require('./atomic-write').writeFileAtomic(f, JSON.stringify(m, null, 2));
  return out;
}

// ── B-roll's "Generated" of the first round goes, ONCE (the owner, second round) ──────────────────────────────
// The first round filed the video chat's clips under a required B-roll category "Generated"; the second makes VIDEO ->
// Generated a group of its own and those clips B-rolls with no category (its Uncategorized). What is in that category
// goes to none, with its files, and the category goes. Once per library: a B-roll category the person names "Generated"
// later is theirs.
const MARK_B = 'v28.4 b-rolls Generated released';

function releaseBrollGenerated() {
  const { f, m } = _marker();
  if (Array.isArray(m.done) && m.done.includes(MARK_B)) return null;
  let n = 0;
  const cat = ((LC.read().birols || {}).own || []).find(c => _lc(c.label) === _lc('Generated'));
  if (cat) {
    const B = require('./birols-store');
    n = B.read().filter(e => e && String(e.categoryId || '') === cat.id).length;
    require('./project-cats').releaseIn('birols', cat.label);
  }
  m.done = (Array.isArray(m.done) ? m.done : []).concat(MARK_B);
  require('./atomic-write').writeFileAtomic(f, JSON.stringify(m, null, 2));
  return { records: n, had: !!cat };
}

module.exports = { ensure, moveChatMade, releaseBrollGenerated };
