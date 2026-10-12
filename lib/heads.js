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
//   list() -> [{ id, projectId, title, line, variant, path, thumb, dur, at, said }]
//
// A take belongs to its project: while the project lives it is neither deleted nor re-filed from the library.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { ROOT_DIR } = require('./config');

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
  return out;
}

module.exports = { list };
