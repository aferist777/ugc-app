'use strict';

/* timeline-twins.js - the old send's cells that the mirror lays a second time (found 2026-10-14 in V26.8;
   docs/local-app/PLAN.md section 6, "Двойные ячейки в старых таймлайнах talking head").

   Before the timeline mirror (phase T', lib/frag-mirror.js) a talking head was SENT into Merge from the Scenarios
   page: its cells went on the main lanes with ids `sg<tag>_<n>` (`_a` or `sga` on the sound lane, `sa` for a read
   with no clip, a piece cut off one keeping the id with a suffix) and no `frag`. The mirror takes a cell without
   `frag` for the person's and never touches it - and when it caught up with such a project (U1) it laid its own
   cells over the same lines. The editor draws the two one over the other, and the render sounds both voices.

   twinsOf: a cell of the old send on main video (v1) or main audio (a1) goes when the mirror has a cell of the SAME FILE
   on the same lane overlapping it in time - its twin. A pair goes whole or not at all: every half of it on a main lane,
   every half with a twin. Nothing else is touched - other lanes, the person's own cells, an old cell with no twin.

   (phase V72, the owner 2026-11-03, (э2)) The mirror takes them off in the lay that puts its cells over them
   (lib/frag-mirror.js _plan, against the cells it is laying), the timeline copied first to backups/<date> doubled cells/
   (keep). */

const fs = require('fs');
const path = require('path');

const OLD_SEND = /^s(?:g|ga|a)\d{6}_\d+(?:_|$)/;
const MAIN = new Set(['v1', 'a1']);
const _mirror = (c) => Number(c && c.frag) > 0;
const _src = (c) => String((c && c.src) || '').split(/[?#]/)[0];
const _overlap = (a, b) => (+a.start) < (+b.start) + (+b.dur) - 0.01 && (+b.start) < (+a.start) + (+a.dur) - 0.01;

// The ids of the old send's cells that go, by lane: Map(lane id -> Set(cell id)).
function twinsOf(doc) {
  const out = new Map();
  const tracks = (doc && Array.isArray(doc.tracks)) ? doc.tracks.filter(t => t && Array.isArray(t.clips)) : [];
  // Every half of every pair, on whatever lane it lies - a half the person moved off the main lanes keeps its pair.
  const pairs = new Map();
  for (const t of tracks) {
    for (const c of t.clips) if (c && c.pairId) (pairs.get(c.pairId) || pairs.set(c.pairId, []).get(c.pairId)).push({ lane: t, cell: c });
  }
  const goes = ({ lane, cell }) => MAIN.has(lane.id) && !_mirror(cell) && OLD_SEND.test(String(cell.id || ''))
    && !!_src(cell) && lane.clips.some(m => _mirror(m) && _src(m) === _src(cell) && _overlap(m, cell));
  for (const t of tracks) {
    if (!MAIN.has(t.id)) continue;
    for (const c of t.clips) {
      if (!c || _mirror(c) || !OLD_SEND.test(String(c.id || ''))) continue;
      const group = c.pairId ? pairs.get(c.pairId) : [{ lane: t, cell: c }];
      if (!group.every(goes)) continue;
      for (const g of group) (out.get(g.lane.id) || out.set(g.lane.id, new Set()).get(g.lane.id)).add(g.cell.id);
    }
  }
  return out;
}

const README = `This folder was made when the cells an old send from Scenarios had put on a talking head's
timeline were taken off it: the timeline mirror lays the same clips again, and both sounded.

projects/<folder>/merge/<title>.json   each timeline as it was before

Эта папка появилась, когда с таймлайнов talking head убрали ячейки старой отправки из Scenarios: зеркало
кладёт те же клипы заново, и звучали обе. projects/<папка>/merge/<название>.json - каждый таймлайн в
прежнем виде.
`;

// The folder of today's copies, made once with its README - a folder of that name made by something else is left alone.
function _backupDir(root) {
  const now = new Date();
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  let rel = `backups/${day} doubled cells`;
  for (let i = 2; fs.existsSync(path.join(root, rel)) && !fs.existsSync(path.join(root, rel, 'README.txt')); i++) rel = `backups/${day} doubled cells (${i})`;
  fs.mkdirSync(path.join(root, rel), { recursive: true });
  if (!fs.existsSync(path.join(root, rel, 'README.txt'))) fs.writeFileSync(path.join(root, rel, 'README.txt'), README);
  return rel;
}

// (phase V72) One timeline's file copied there before the mirror changes it - never over an earlier copy. `at` - { folder,
// file } of lib/merge-store.js locate. Returns the copy's folder, or null (nothing to copy, or the copy could not be made).
function keep(at, { root = require('./config').ROOT_DIR, log = () => {} } = {}) {
  if (!at || !at.folder || !at.file) return null;
  try {
    const abs = path.join(root, 'projects', at.folder, 'merge', at.file);
    if (!fs.existsSync(abs)) return null;
    const rel = _backupDir(root);
    const copy = path.join(root, rel, 'projects', at.folder, 'merge', at.file);
    if (!fs.existsSync(copy)) {
      fs.mkdirSync(path.dirname(copy), { recursive: true });
      fs.copyFileSync(abs, copy);
    }
    log(`[timelines] ${at.folder}/merge/${at.file} copied to ${rel} before the doubled cells of an old send are taken off`);
    return rel;
  } catch (e) {
    log(`[timelines] could not copy ${at.folder}/merge/${at.file} before taking the doubled cells off: ${e.message}`);
    return null;
  }
}

module.exports = { twinsOf, keep };
