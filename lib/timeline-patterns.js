'use strict';

/* timeline-patterns.js - (phase V74, the owner 2026-11-03, (пт5): "по рекомендации"; docs/local-app/plan/, "Фаза V74") A PATTERN
   CLIP OF PHASE V65 BECOMES A PATTERN OF MAIN VIDEO.

   In V65 a pattern (an address under /patterns/) was a clip, let go on main video onto a lane of its own above it. Since V74 a
   pattern is a layer of main video - `patterns` on the main video lane, over every video lane, the whole of main video long
   (public/js/overlay/pattern.js) - and the clip's way is gone from the code. So at start (lib/library-upgrade.js `upgrade`), on
   every timeline in projects/<folder>/merge/:
     - every clip of a video lane whose address is a pattern goes into main video's `patterns` - its scale, colour, angle,
       movement, opacity and blend mode as they were (a clip ON main had no blend mode: under it was black); the top one first,
       as the lanes are listed and a later clip of a lane lies over an earlier one; one entry per pattern (the first kept);
       where it lay in time is not kept - a pattern now covers all of main video (the owner's (пт3); his two had it so);
     - a lane above main that held nothing but patterns, empty now, goes - with the sound lane paired with it when that is
       empty too (a pair goes as the page's removeTrack takes it); a paired sound lane that holds something stays, unpaired -,
       and the lanes are named again as the page names them (timeline-b.js _renumber: main video, video 2...; main audio,
       audio 2...);
     - nothing else is touched. A timeline it changes is copied first to backups/<date> V74 patterns/. Run again, it finds
       nothing. */

const fs = require('fs');
const path = require('path');
const { writeFileAtomic } = require('./atomic-write');
const PAT = require('../public/js/overlay/pattern.js');
const LOOK = require('../public/js/overlay/look.js');

const _isPat = (c) => !!c && LOOK.isPattern(c.src);

/** The timeline with its pattern clips made main video's patterns: { doc, moved, lanes } - moved 0 when there were none. */
function convert(doc) {
  const tracks = doc && Array.isArray(doc.tracks) ? doc.tracks : null;
  if (!tracks) return { doc, moved: 0, lanes: 0 };
  const vids = tracks.filter((t) => t && t.kind === 'video' && Array.isArray(t.clips));
  const main = vids.length ? vids[vids.length - 1] : null;
  // Top layer first: the lanes as listed (top first), and on a lane the later clip over the earlier.
  const found = [];
  for (const t of vids) for (const c of t.clips.slice().reverse()) if (_isPat(c)) found.push({ lane: t, clip: c });
  if (!found.length || !main) return { doc, moved: 0, lanes: 0 };
  const entries = found.map(({ lane, clip }) => ({
    src: clip.src,
    pattern: clip.pattern,
    opacity: clip.opacity,
    blend: lane === main ? null : clip.blend,
  }));
  const held = new Set(found.map((x) => x.lane.id));
  // A copy of every lane - the timeline it was given is left as it was.
  let out = tracks.map((t) => (!t ? t : t.kind === 'video' && held.has(t.id) ? { ...t, clips: t.clips.filter((c) => !_isPat(c)) } : { ...t }));
  const mainNow = out.find((t) => t && t.id === main.id);
  mainNow.patterns = PAT.normalizeLayers((Array.isArray(main.patterns) ? main.patterns : []).concat(entries));
  // The lanes emptied by it go, each with its paired sound lane when that is empty too.
  const gone = new Set();
  for (const t of out) {
    if (!t || t.kind !== 'video' || t.id === main.id || !held.has(t.id) || t.clips.length) continue;
    gone.add(t.id);
    const mate = t.linkId ? out.find((x) => x && x.id === t.linkId && x.kind === 'audio') : null;
    if (mate && !(mate.clips || []).length && !mate.main) gone.add(mate.id);
  }
  if (gone.size) {
    out = out.filter((t) => !(t && gone.has(t.id))).map((t) => (t && t.linkId && gone.has(t.linkId) ? { ...t, linkId: null } : t));
    const v = out.filter((t) => t && t.kind === 'video');
    v.slice().reverse().forEach((t, i) => { t.main = i === 0; t.name = i === 0 ? 'main video' : 'video ' + (i + 1); });
    out.filter((t) => t && t.kind === 'audio').forEach((t, i) => { t.main = i === 0; t.name = i === 0 ? 'main audio' : 'audio ' + (i + 1); });
  }
  return {
    doc: { ...doc, tracks: out, rev: (Number(doc.rev) || 0) + 1, updatedAt: new Date().toISOString() },
    moved: found.length,
    lanes: [...gone].length,
  };
}

const README = `This folder was made when the pattern clips of the timelines below became patterns of their main video
(phase V74): a pattern is no clip on a lane of its own any more - it lies over the whole of main video, chosen by
ticks in the strip of the main video lane. The lane the clip lay on went with it.

projects/<folder>/merge/<title>.json   each timeline as it was before

Эта папка появилась, когда паттерн-клипы этих таймлайнов стали паттернами их основного видео (фаза V74): паттерн
больше не клип на своей дорожке - он лежит на всём основном видео и выбирается галочками в полосе дорожки main
video. Его дорожка ушла вместе с ним. projects/<папка>/merge/<название>.json - каждый таймлайн в прежнем виде.
`;

// The folder of today's copies, made once with its README - a folder of that name made by something else is left alone.
function _backupDir(root) {
  const now = new Date();
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  let rel = `backups/${day} V74 patterns`;
  for (let i = 2; fs.existsSync(path.join(root, rel)) && !fs.existsSync(path.join(root, rel, 'README.txt')); i++) rel = `backups/${day} V74 patterns (${i})`;
  fs.mkdirSync(path.join(root, rel), { recursive: true });
  if (!fs.existsSync(path.join(root, rel, 'README.txt'))) fs.writeFileSync(path.join(root, rel, 'README.txt'), README);
  return rel;
}

// Every timeline of the library. `dry` counts and writes nothing.
function convertLibrary(root, { log = () => {}, dry = false } = {}) {
  const projects = path.join(root, 'projects');
  const result = { timelines: 0, moved: 0, lanes: 0, failed: 0, backup: null, which: [] };
  let dirs = [];
  try { dirs = fs.readdirSync(projects, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch (e) { return result; }
  for (const folder of dirs) {
    const mergeDir = path.join(projects, folder, 'merge');
    let files = [];
    try { files = fs.readdirSync(mergeDir).filter((f) => f.toLowerCase().endsWith('.json')); } catch (e) { continue; }
    for (const file of files) {
      const abs = path.join(mergeDir, file);
      let raw;
      // A quick look first: most timelines have no pattern at all, and are not parsed.
      try { raw = fs.readFileSync(abs, 'utf8'); } catch (e) { continue; }
      if (!raw.includes('"/patterns/')) continue;
      let doc;
      try { doc = JSON.parse(raw); } catch (e) { continue; }
      const r = convert(doc);
      if (!r.moved) continue;
      result.which.push(`${folder}/merge/${file} - ${r.moved} pattern(s)` + (r.lanes ? `, ${r.lanes} lane(s) gone` : ''));
      if (dry) { result.timelines++; result.moved += r.moved; result.lanes += r.lanes; continue; }
      try {
        if (!result.backup) result.backup = _backupDir(root);
        // The original first, and never over an earlier copy.
        const copy = path.join(root, result.backup, 'projects', folder, 'merge', file);
        if (!fs.existsSync(copy)) {
          fs.mkdirSync(path.dirname(copy), { recursive: true });
          fs.copyFileSync(abs, copy);
        }
        writeFileAtomic(abs, JSON.stringify(r.doc, null, 2));
        result.timelines++;
        result.moved += r.moved;
        result.lanes += r.lanes;
      } catch (e) {
        result.failed++;
        log(`[timelines] could not make the pattern clips of ${folder}/merge/${file} patterns of its main video: ${e.message}`);
      }
    }
  }
  if (result.moved && !dry) {
    log(`[timelines] ${result.moved} pattern clip(s) made patterns of main video in ${result.timelines} timeline(s), ${result.lanes} lane(s) gone; the originals are in ${result.backup}`);
  }
  return result;
}

module.exports = { convert, convertLibrary };
