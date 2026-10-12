'use strict';

// ════════════════════════════════════════════════════════════════════════════
// THE TALKING HEADS (phase V28.4, second round, the owner 2026-10-12: "в этой категории будут создаваться категории с
// названием проекта и в ней можно смотреть по каждому проекту сгенерированные говорящие головы ... тогда мы сможем и эти
// генерации использовать повторно в других проектах") - Media -> VIDEO -> Generated -> Talking heads -> <project>.
//
// EVERY TAKE of every line of every talking-head project (the owner: "все дубли"), read where it lives: the project's
// lines (`lines[i].video.plain|tagged[]`, routes/scen3.js) and its clips folder. The file is the model's whole clip -
// only the timeline cuts it to the read (lib/frag-mirror.js `trimOut`) - so what is shown is the original.
//
//   list() -> [{ id, projectId, title, line, variant, path, thumb, dur, at, said, kept? }]
//   keep(projectId) -> n            before a project is deleted: its takes into the library (below)
//   readKept() / writeKept(list)    data/heads.json - the kept ones
//
// A take belongs to its project: while the project lives it is neither deleted nor re-filed from the library.
// KEPT (the owner, second round: "удалить можно, только когда проект удален. при удалении проекта спрашивать про удаление
// исходников с головами"): a project deleted with its files asks about its talking heads; kept, they move out of the
// project's folder into media/heads/<the project's folder>/ (lib/relocate.js - a timeline of another project that uses one
// follows), each a record in data/heads.json, and they stay Generated -> Talking heads -> <the project> until deleted one
// by one there.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { ROOT_DIR, DATA_DIR, MEDIA } = require('./config');
const { writeFileAtomic } = require('./atomic-write');

const FILE = path.join(DATA_DIR, 'heads.json');
function readKept() {
  try { const l = JSON.parse(fs.readFileSync(FILE, 'utf8')); return Array.isArray(l) ? l : []; }
  catch (e) { return []; }
}
function writeKept(list) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  writeFileAtomic(FILE, JSON.stringify(list, null, 2));
}

const _abs = (u) => path.join(ROOT_DIR, String(u || '').split('?')[0].replace(/^\/+/, ''));
const _on = (u) => { try { return !!u && fs.existsSync(_abs(u)); } catch (e) { return false; } };

// A take's poster: its own, or the one beside it in clips/thumbs/ (routes/scen3.js _fetchClip), or the shared rule.
function _poster(take) {
  if (take.thumb && _on(take.thumb)) return String(take.thumb).split('?')[0];
  const p = String(take.path || '').split('?')[0];
  const beside = p.replace(/\/([^/]+)\.[^./]+$/, '/thumbs/$1.jpg');
  if (beside !== p && _on(beside)) return beside;
  try {
    const t = require('./video-thumb').thumbUrlFor(p);
    if (t && _on(t)) return t;
  } catch (e) { /* none */ }
  return null;
}

function list() {
  const P = require('./projects-store');
  const out = [];
  for (const e of P.entries()) {
    if (!e || e.kind !== 'scenarios') continue;
    let rec = null;
    try { rec = P.get(e.id); } catch (err) { rec = null; }
    if (!rec || !Array.isArray(rec.lines)) continue;
    rec.lines.forEach((ln, i) => {
      for (const variant of ['plain', 'tagged']) {
        for (const t of (((ln && ln.video) || {})[variant] || [])) {
          if (!t || !t.path || !_on(t.path)) continue;
          out.push({
            id: String(e.id) + ':' + String(t.id || path.basename(String(t.path))),
            projectId: String(e.id), title: String(e.name || rec.title || e.folder || 'project'),
            line: i + 1, variant, path: String(t.path).split('?')[0], thumb: _poster(t),
            dur: +t.dur || 0, at: String(t.at || ''),
            said: String(t.said || (ln && (ln.tagged || ln.text)) || ''),
          });
        }
      }
    });
  }
  // The kept ones: their project is gone, its name stays their folder in the tree.
  for (const r of readKept()) {
    if (!r || !r.path || !_on(r.path)) continue;
    out.push({
      id: String(r.id), projectId: 'kept:' + String(r.folder || ''), title: String(r.title || r.folder || 'project'),
      line: +r.line || 0, variant: String(r.variant || ''), path: String(r.path), thumb: (r.thumb && _on(r.thumb)) ? String(r.thumb) : null,
      dur: +r.dur || 0, at: String(r.at || ''), said: String(r.said || ''), kept: true,
    });
  }
  return out;
}

// Before a project is deleted (routes/mergev3.js): every take of its lines moves into media/heads/<its folder>/ with its
// poster and loudness mark, every stored path following (another project's timeline too), and is written down. A folder
// of that name there already (a project of the same name deleted before) gets a number. Returns how many were kept.
function keep(projectId) {
  const P = require('./projects-store');
  const e = P.entry(projectId);
  if (!e) return 0;
  const takes = list().filter(h => !h.kept && h.projectId === String(projectId));
  if (!takes.length) return 0;
  fs.mkdirSync(MEDIA.heads, { recursive: true });
  let taken = [];
  try { taken = fs.readdirSync(MEDIA.heads); } catch (err) { /* empty */ }
  const dir = require('./names').uniqueName(String(e.folder || e.name || 'project'), taken);
  const seen = new Set();
  const pairs = [];
  for (const h of takes) {
    if (seen.has(h.path)) continue;
    seen.add(h.path);
    pairs.push([h.path, '/media/heads/' + dir + '/' + path.posix.basename(h.path)]);
  }
  const R = require('./relocate');
  const done = R.relocate({ files: pairs });
  const now = R.mapper(done.pairs);
  const at = new Date().toISOString();
  const kept = takes.filter(h => _on(now(h.path))).map(h => ({
    id: 'kept:' + dir + ':' + path.posix.basename(h.path), title: h.title, folder: dir, path: now(h.path),
    thumb: h.thumb ? now(h.thumb) : null, line: h.line, variant: h.variant, said: h.said, dur: h.dur, at: h.at, keptAt: at,
  }));
  const ids = new Set(kept.map(k => k.id));
  const list0 = readKept().filter(r => r && !ids.has(String(r.id)));
  writeKept(list0.concat(kept));
  return kept.length;
}

module.exports = { FILE, list, keep, readKept, writeKept };
