'use strict';

// ════════════════════════════════════════════════════════════════════════════
// WHAT A TIMELINE'S CLIPS POINT AT (phase V28.4 + V28.5, the owner 2026-10-12: "при удалении файла обязательно уведомление,
// что файл используется в проектах и список проектов"; "на таймлайне закрашивать это медиа, чтобы типа под замену или
// удаление").
//
//   missingOf(timeline) -> [{ id, track, name, src }]   the clips whose file is not on the disk (red on the timeline;
//                                                       a render is refused while there are any - lib/mv3b-job.js)
//   usage(addresses)    -> [{ key, title, draft, clips }]   the projects (the draft too) whose timelines hold any of them
//
// A clip's address may be one a file had before it moved: lib/moves.js knows where it went (lib/media.js
// toDiskExisting) - that clip is not missing, and it counts as using the file where it is now.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const { toDiskExisting } = require('./media');
const MOVES = require('./moves');

const _clean = (u) => String(u || '').split(/[?#]/)[0];
const _now = (u) => _clean(MOVES.resolve(_clean(u)));

function _clips(timeline) {
  const out = [];
  for (const t of ((timeline && timeline.tracks) || [])) {
    if (!t || t.kind === 'subs' || t.kind === 'text') continue;
    for (const c of (t.clips || [])) if (c && c.src) out.push({ c, t });
  }
  return out;
}

function missingOf(timeline) {
  const out = [];
  for (const { c, t } of _clips(timeline)) {
    const abs = toDiskExisting(c.src);
    if (abs && fs.existsSync(abs)) continue;
    out.push({ id: String(c.id || ''), track: String(t.id || ''), name: String(c.name || '') || _clean(c.src).split('/').pop(), src: _clean(c.src) });
  }
  return out;
}

function usage(addresses) {
  const want = new Set((addresses || []).filter(Boolean).map(_now));
  if (!want.size) return [];
  const { timelines } = require('./merge-store').read();
  const out = [];
  for (const [key, t] of Object.entries(timelines || {})) {
    // A clip and its sound on the lane below are one piece of media (their pairId): counted once.
    const seen = new Set();
    for (const { c } of _clips(t)) if (want.has(_now(c.src))) seen.add(String(c.pairId || c.id || seen.size));
    if (seen.size) out.push({ key, title: String((t && t.title) || 'Untitled'), draft: !!(t && t.draft), clips: seen.size });
  }
  return out.sort((a, b) => (b.draft - a.draft) || a.title.localeCompare(b.title));
}

// (phase V28.4, second round) Every address any timeline's clips point at (where the file is now) - which takes of the
// talking heads are on a timeline.
function allSrcs() {
  const out = new Set();
  const { timelines } = require('./merge-store').read();
  for (const t of Object.values(timelines || {})) for (const { c } of _clips(t)) out.add(_now(c.src));
  return out;
}

module.exports = { missingOf, usage, allSrcs };
