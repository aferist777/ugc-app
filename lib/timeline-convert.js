'use strict';

/* timeline-convert.js - a talking-head timeline becomes a blank one (docs/local-app/PLAN.md, phase 3).

   Merge keeps one editor. The projects made in the other one - six fixed lanes (seg, biro, hook,
   halfer, music, subs) - are rewritten once, in the shape of a project made in Merge: an ordered list
   of lanes, pictures paired with their sound. What they looked like is kept, and the reference is
   what the talking-head editor showed and rendered (its renderer, routes/ffmpeg.js _buildAndRun, and
   public/js/merge-v3/export.js - both removed after this was written; see git history):

     Main (seg)   laid end to end on main video from 0, in start order - that renderer joined the
                  fragments one after another, gaps and all closed up. Fitted to the frame. Each
                  film's sound is the other half of a pair on main audio, at the level the old
                  preview played it: the clip's volume, the lane's, and the import's levelling
                  (gainDb). A read with its still (poster) is the still paired with the read.
     Hooks,       a lane each above main: hooks, then birols over them, then the halfers on top -
     Birols,      the order the old render laid them down in. Full frame is filled and cut by
     Halfers      cropAlign; a picture-in-picture keeps its size and moves its anchor from the
                  corner to the middle; a halfer is a band (lib/mv3b-render.js bandGeom) with the
                  same numbers. An insert whose sound was turned up gets it as a pair.
     Music        a lane of its own, the clips marked as beds, at their level.
     Subtitles    the subtitle lane, the style carried over with its size fixed (sizeAuto false) and
                  its anchor moved to where the old layout put the words: 91% of the frame for a
                  caption at the bottom and 7% at the top, where this editor anchors at 88% and 10%.
     adv          the export settings, the ones lib/render-finish.js reads.

   Whatever ran past the end of Main is cut there, as that render cut it. The pinned overlay
   arrangements (snapshot), the volume-rule stamp and the overlay panel's hidden list belonged to
   that editor alone and are not carried.

   convert(doc, { root }) -> the blank document, or null when it already is one. `root` is the
     library, for the size of a picture-in-picture's source.
   convertLibrary(root, { log }) -> { converted, failed, backup }: every timeline file under
     projects/ that is still talking-head, each one copied to backups/<date> timelines/ first. Run
     at every start (lib/library-upgrade.js), on staged imports and on migrations; a blank file is
     left alone, so running it twice changes nothing. */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { writeFileAtomic } = require('./atomic-write');

const r2 = (v) => Math.round((+v || 0) * 100) / 100;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const named = (v) => (v && v !== 'none' ? String(v) : null);
const isStill = (src) => /\.(jpe?g|png|webp|avif|bmp)$/i.test(String(src || '').split('?')[0]);
const VOL_MAX = 4;
const ADV_KEYS = ['resolution', 'fps', 'crf', 'preset', 'audioBitrate', 'eqBrightness', 'eqContrast',
                  'eqSaturation', 'eqGamma', 'playbackSpeed', 'extra1', 'extra2'];

// The size of a picture-in-picture's source, which its middle depends on. Asked of ffmpeg, which
// reports pictures and films alike. Null when it cannot be read.
function _dims(root, url) {
  if (!root || !url) return null;
  try {
    const abs = path.join(root, decodeURIComponent(String(url).split('?')[0]).replace(/^\/+/, ''));
    if (!fs.existsSync(abs)) return null;
    const r = spawnSync(require('ffmpeg-static'), ['-hide_banner', '-i', abs], { windowsHide: true, encoding: 'utf8' });
    const m = /Stream #\d+:\d+.*Video:.*?,\s*(\d{2,5})x(\d{2,5})[\s,]/.exec(String(r.stderr || ''));
    return m ? { w: +m[1], h: +m[2] } : null;
  } catch (e) { return null; }
}

// The clip's own effect, or its lane's when it has none - which is how that renderer read them.
function _fx(c, lane) {
  const pick = (k) => named(c[k]) || named(lane && lane[k]);
  return { transition: pick('transition'), animation: pick('animation'), filter: pick('filter') };
}

const _base = (c) => ({
  id: String(c.id),
  src: c.src ? String(c.src) : null,
  thumb: c.thumb ? String(c.thumb) : null,
  name: String(c.name || '').slice(0, 200),
  libId: c.libId ? String(c.libId) : null,
  start: r2(c.start),
  dur: r2(c.dur),
  srcDur: Math.max(0, r2(c.srcDur)),
  trimIn: Math.max(0, r2(c.trimIn)),
  trimOut: Math.max(0, r2(c.trimOut)),
  speed: clamp(+c.speed || 1, 0.25, 2),
  reversed: !!c.reversed && !isStill(c.src),
  transition: null, animation: null, filter: null,
  volume: 0,
  pairId: null,
});

// The sound half of a film: the same window of the same file, and nothing of the picture's.
const _sound = (v, src, volume, pairId) => ({
  id: v.id + '_a', src, thumb: null, name: v.name, libId: v.libId,
  start: v.start, dur: v.dur, srcDur: v.srcDur, trimIn: v.trimIn, trimOut: v.trimOut,
  speed: v.speed, reversed: v.reversed,
  transition: null, animation: null, filter: null,
  volume: Math.round(clamp(volume, 0, VOL_MAX) * 1000) / 1000, pairId,
});

function convert(doc, { root } = {}) {
  if (!doc || typeof doc !== 'object' || doc.kind === 'blank' || !doc.tracks || Array.isArray(doc.tracks)) return null;
  const T = doc.tracks;
  const lane = (k) => (T[k] && typeof T[k] === 'object' ? T[k] : { clips: [] });
  const clipsOf = (k) => (Array.isArray(lane(k).clips) ? lane(k).clips : []).filter((c) => c && c.id);
  const adv = doc.adv && typeof doc.adv === 'object' ? doc.adv : null;
  const wide = adv && /^(\d+)x(\d+)$/.test(String(adv.resolution || ''))
    && (+String(adv.resolution).split('x')[0] > +String(adv.resolution).split('x')[1]);
  const W = wide ? 1920 : 1080, H = wide ? 1080 : 1920;

  // ── Main ────────────────────────────────────────────────────────────────
  const seg = lane('seg');
  const segVol = seg.volume != null ? +seg.volume : 1;
  const mainV = [], mainA = [];
  let at = 0;
  const mainClips = clipsOf('seg').filter((c) => (c.src || c.poster) && +c.dur > 0).sort((a, b) => (+a.start || 0) - (+b.start || 0));
  for (const c of mainClips) {
    const v = { ..._base(c), start: r2(at), ..._fx(c, seg) };
    at += +c.dur;
    const gain = Math.pow(10, clamp(+c.gainDb || 0, 0, 15) / 20);
    const level = (c.volume != null ? +c.volume : 1) * segVol * gain;
    const pairId = 'p' + c.id;
    if (c.poster) {
      // A read and its still: the still on the picture lane, the read as its sound.
      v.src = String(c.poster); v.thumb = c.thumb ? String(c.thumb) : String(c.poster);
      v.srcDur = 0; v.trimIn = 0; v.trimOut = 0; v.speed = 1; v.reversed = false; v.pairId = pairId;
      mainV.push(v);
      mainA.push(_sound({ ..._base(c), start: v.start }, String(c.src), level, pairId));
    } else if (isStill(c.src)) {
      v.speed = 1;
      mainV.push(v);
    } else {
      v.pairId = pairId;
      mainV.push(v);
      mainA.push(_sound(v, v.src, level, pairId));
    }
  }
  const mainEnd = at;
  // Past the end of Main nothing was rendered: dropped when it starts there, shortened when it runs into it.
  const cut = (c) => {
    if (!(mainEnd > 0)) return c;
    if (c.start >= mainEnd - 0.01) return null;
    if (c.start + c.dur > mainEnd) c.dur = r2(mainEnd - c.start);
    return c.dur >= 0.05 ? c : null;
  };

  // ── Hooks, Birols, Halfers ──────────────────────────────────────────────
  const biro = lane('biro');
  const overlay = (k, c) => {
    const L = lane(k);
    const v = { ..._base(c), ...(k === 'halfer' ? {} : _fx(c, biro)) };   // hooks read the Birols lane's effects too
    const level = (c.volume != null ? +c.volume : 0) * (L.volume != null ? +L.volume : 1);
    if (k === 'halfer') {
      const pct = (x, dflt) => { const n = Number(x); return Number.isFinite(n) ? clamp(n, 0, 100) : dflt; };
      v.halfer = true;
      v.halferPos = pct(c.halferPos, c.halferAlign === 'bottom' ? 0 : 100);
      v.halferThick = Math.max(5, pct(c.halferThick, 40));
      v.halferKeep = pct(c.halferKeep, c.valign === 'bottom' ? 0 : 100);
      const rot = c.rotation == null ? 90 : ((parseInt(c.rotation, 10) || 0) % 360 + 360) % 360;
      v.rotation = [0, 90, 180, 270].includes(rot) ? rot : 0;
      v.feather = c.feather == null ? null : clamp(+c.feather || 0, 0, 0.4);
    } else {
      const tw = c.tw != null ? +c.tw : null;
      if (tw != null && tw > 0 && tw < 0.999) {
        // A picture-in-picture: the same width, anchored by its middle rather than its corner.
        const twc = clamp(tw, 0.02, 1);
        const pw = Math.max(2, Math.round(W * twc / 2) * 2);
        const d = _dims(root, c.src);
        const ph = d && d.w > 0 ? pw * (d.h / d.w) : pw * (H / W);
        v.tw = twc;
        v.tx = clamp(clamp(+c.tx || 0, 0, 1) + (pw / 2) / W, 0, 1);
        v.ty = clamp(clamp(+c.ty || 0, 0, 1) + (ph / 2) / H, 0, 1);
        v.angle = null;
        v.feather = (+c.feather || 0) > 0 ? clamp(+c.feather, 0, 0.45) : null;
      } else {
        v.fit = 'fill';
        v.cropAlign = ['left', 'center', 'right'].includes(c.cropAlign) ? c.cropAlign : 'center';
      }
    }
    return { v: cut(v), level };
  };
  const overlayLanes = [];            // nearest to main first
  for (const k of ['hook', 'biro', 'halfer']) {
    const got = clipsOf(k).filter((c) => c.src && +c.dur > 0).map((c) => overlay(k, c)).filter((x) => x.v);
    if (got.length) overlayLanes.push({ k, got });
  }

  // ── Music and subtitles ─────────────────────────────────────────────────
  const music = lane('music');
  const beds = clipsOf('music').filter((c) => c.src && +c.dur > 0).map((c) => cut({
    ..._base(c), reversed: false,
    volume: Math.round(clamp((c.volume != null ? +c.volume : 0.5) * (music.volume != null ? +music.volume : 1), 0, VOL_MAX) * 1000) / 1000,
    bed: true,
  })).filter(Boolean);

  const subs = lane('subs');
  const st = Object.assign({}, subs.style || {});
  const k = H / 1920;
  const style = {
    font: String(st.font || 'Arial'), size: Math.max(8, Math.round((+st.size || 60) * k)),
    bold: st.bold == null ? true : !!st.bold, italic: !!st.italic,
    primary: st.primary || '#ffffff', secondary: st.secondary || '#8a9099',
    outlineColor: st.outlineColor || '#000000', shadowColor: st.shadowColor || '#000000',
    // The box that editor's render drew was the OUTLINE colour, opaque, whatever its panel said -
    // so that is the box carried over (lib/mv3b-subs.js now draws the panel's box colour).
    backColor: st.borderStyle === 'box' ? (st.outlineColor || '#000000') : (st.backColor || '#000000'),
    backAlpha: st.borderStyle === 'box' ? 1 : (+st.backAlpha || 0),
    outline: +((+st.outline || 0) * k).toFixed(1), shadow: +((+st.shadow || 0) * k).toFixed(1), blur: +st.blur || 0,
    borderStyle: st.borderStyle === 'box' ? 'box' : 'outline',
    pos: ['top', 'center', 'bottom'].includes(st.pos) ? st.pos : 'bottom',
    tx: +st.tx || 0,
    ty: Math.round(((+st.ty || 0) + (st.pos === 'top' ? -0.03 : st.pos === 'center' ? 0 : 0.03)) * 10000) / 10000,
    wrap: st.wrap == null ? true : !!st.wrap,
    wordsPerLine: Math.max(0, Math.min(12, Math.round(+st.wordsPerLine || 0))),
    karaoke: !!st.karaoke,
    sizeAuto: false,
  };
  const captions = clipsOf('subs').filter((c) => c.name && +c.dur > 0).map((c) => cut({
    id: String(c.id), src: null, thumb: null, name: String(c.name).slice(0, 200), libId: null,
    start: r2(c.start), dur: r2(c.dur), srcDur: 0, trimIn: 0, trimOut: 0, speed: 1, reversed: false,
    transition: null, animation: null, filter: null, volume: null, pairId: null,
    words: Array.isArray(c.words) ? c.words.filter((w) => w && w.w != null).slice(0, 200)
      .map((w) => ({ w: String(w.w).slice(0, 60), s: Math.max(0, r2(w.s)), e: Math.max(0, r2(w.e)) })) : null,
  })).filter(Boolean);

  // ── The lanes, top to bottom ────────────────────────────────────────────
  // Video from the top layer down to main; audio from main outwards, a sound lane beside each video
  // lane while there is room (four at most, one kept for the music).
  const mk = (id, kind, linkId, main) => ({ id, kind, name: '', linkId, main, volume: null, speed: null, clips: [] });
  const v1 = mk('v1', 'video', 'a1', true);
  const a1 = mk('a1', 'audio', 'v1', true);
  v1.clips = mainV;
  a1.clips = mainA;
  const room = 4 - 1 - (beds.length ? 1 : 0);
  const vids = [], auds = [];
  overlayLanes.forEach((o, i) => {
    const n = i + 2;
    const v = mk('v' + n, 'video', null, false);
    const a = i < room ? mk('a' + n, 'audio', 'v' + n, false) : null;
    if (a) v.linkId = a.id;
    for (const { v: clip, level } of o.got) {
      v.clips.push(clip);
      if (level > 0 && !isStill(clip.src)) {
        clip.pairId = 'p' + clip.id;
        (a || a1).clips.push(_sound(clip, clip.src, level, clip.pairId));
      }
    }
    vids.push(v);
    if (a) auds.push(a);
  });
  const tracks = [...vids.slice().reverse(), v1, a1, ...auds];
  if (beds.length) {
    const m = mk('a' + (auds.length + 2), 'audio', null, false);
    m.clips = beds;
    tracks.push(m);
  }
  const s = mk('subs', 'subs', null, true);
  s.name = 'Subtitles';
  s.style = style;
  s.clips = captions;
  tracks.push(s);

  // Names by position, as the editor gives them.
  tracks.filter((t) => t.kind === 'video').reverse().forEach((t, i) => { t.name = i === 0 ? 'main video' : 'video ' + (i + 1); });
  tracks.filter((t) => t.kind === 'audio').forEach((t, i) => { t.name = i === 0 ? 'main audio' : 'audio ' + (i + 1); });
  for (const t of tracks) if (t.kind === 'audio') t.clips.sort((a, b) => a.start - b.start);

  const out = { ...doc };
  delete out.snapshot; delete out.volRule; delete out.hidden;
  out.kind = 'blank';
  out.format = wide ? '16:9' : '9:16';
  out.tracks = tracks;
  out.adv = adv ? Object.fromEntries(ADV_KEYS.filter((key) => adv[key] != null).map((key) => [key, adv[key]])) : null;
  out.rev = (Number(doc.rev) || 0) + 1;
  return out;
}

const README = `This folder was made when Merge's talking-head timelines were rewritten as projects of
the one editor Merge keeps.

projects/<folder>/merge/<title>.json   each timeline as it was before

Эта папка появилась, когда таймлайны старого редактора Merge (talking-head) были переписаны в проекты
редактора, который остался. projects/<папка>/merge/<название>.json - каждый таймлайн в прежнем виде.
`;

function convertLibrary(root, { log = () => {} } = {}) {
  const projects = path.join(root, 'projects');
  const result = { converted: 0, failed: 0, backup: null };
  let dirs = [];
  try { dirs = fs.readdirSync(projects, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch (e) { return result; }
  for (const folder of dirs) {
    const mergeDir = path.join(projects, folder, 'merge');
    let files = [];
    try { files = fs.readdirSync(mergeDir).filter((f) => f.toLowerCase().endsWith('.json')); } catch (e) { continue; }
    for (const file of files) {
      const abs = path.join(mergeDir, file);
      let doc;
      try { doc = JSON.parse(fs.readFileSync(abs, 'utf8')); } catch (e) { continue; }
      if (!doc || doc.kind === 'blank' || !doc.tracks || Array.isArray(doc.tracks)) continue;
      try {
        if (!result.backup) {
          const now = new Date();
          const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
          let rel = `backups/${day} timelines`;
          for (let i = 2; fs.existsSync(path.join(root, rel)) && !fs.existsSync(path.join(root, rel, 'README.txt')); i++) rel = `backups/${day} timelines (${i})`;
          fs.mkdirSync(path.join(root, rel), { recursive: true });
          fs.writeFileSync(path.join(root, rel, 'README.txt'), README);
          result.backup = rel;
        }
        // The original first, and never over an earlier copy: a run stopped halfway leaves the copy
        // of the file as it was before ANY run touched it.
        const copy = path.join(root, result.backup, 'projects', folder, 'merge', file);
        if (!fs.existsSync(copy)) {
          fs.mkdirSync(path.dirname(copy), { recursive: true });
          fs.copyFileSync(abs, copy);
        }
        writeFileAtomic(abs, JSON.stringify(convert(doc, { root }), null, 2));
        result.converted++;
      } catch (e) {
        result.failed++;
        log(`[timelines] could not rewrite ${folder}/merge/${file}: ${e.message}`);
      }
    }
  }
  if (result.converted) log(`[timelines] ${result.converted} talking-head timeline(s) rewritten for the one editor; the originals are in ${result.backup}`);
  return result;
}

module.exports = { convert, convertLibrary };
