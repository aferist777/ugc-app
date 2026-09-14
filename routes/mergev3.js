'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — the timeline store. The server owns it.

   This exists instead of reusing timeline_data_v2, and the difference is the whole
   point. That key was ONE localStorage blob holding every session's layout, mirrored
   last-write-wins: any tab could push a snapshot built on a stale copy and revert
   every project at once. It did, repeatedly.

   So:
     • the data lives in data/merge-v3.json, not in a browser;
     • every read carries a `version`, every write must quote the version it is
       replacing, and a write quoting an old one is REFUSED with 409 rather than
       applied. A stale tab loses its write instead of everyone losing their work;
     • the file is written tmp + rename, so a crash mid-write cannot truncate it.

   MANY TIMELINES, one per project. A project here IS a Scenarios project - its cut is
   what fills the Main track - so the key is `sv3_<scenariosProjectId>` for anything
   that arrived by import. Timelines that predate this (there was one unnamed working
   timeline) keep their clips under `local`.

   THE VERSION IS THE PROJECT'S. It was the file's - one counter, written whole - which
   was enough for one editor and wrong for a team: two people on two different projects
   refused each other's every save, and each refusal was a merge against a timeline the
   other had never touched. Each timeline now carries its own `rev`, bumped by the save
   that changes its tracks, and that is the number a save has to quote. The file-level
   `version` still ticks on every write, as a cheap "did anything change" for whoever
   asks without naming a project.

   WHO MAY WRITE. Each timeline names its `owner` - the person who created it. Anyone can
   open anything; only the owner or the admin can change it, and everybody else copies
   it (POST .../copy) and works on the copy. Timelines that predate ownership carry
   `owner: null`: shared, and the admin's to edit. The rule lives in lib/ownership.js.

   Endpoints:
     GET    /api/mv3/timelines             -> { success, version, list, owners, me } newest first
     GET    /api/mv3/timeline?key=…        -> { success, version, key, timeline, owner, canEdit }
     GET    /api/mv3/timeline/version?key= -> { success, version }  this project's rev
     PUT    /api/mv3/timeline              { version, key, timeline } -> { success, version }
                                           409 { success:false, version, timeline } on a
                                           stale version, so the caller can reconcile
                                           rather than guess.
                                           403 when the project is somebody else's.
     POST   /api/mv3/timeline/:key/copy    -> { success, key, title } the caller's own copy
   ═══════════════════════════════════════════════════════════════════════════ */

const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const OWN = require('../lib/ownership');

const { DATA_DIR } = require('../lib/config');
const FILE = path.join(DATA_DIR, 'merge-v3.json');

// The tracks, and their order, are the previous editor's - see js/merge-v3/timeline.js.
// Named here too because the store must refuse a clip aimed at a track that does not
// exist: a typo'd scope would otherwise create a seventh track nothing ever draws.
const TRACKS = ['biro', 'hook', 'seg', 'halfer', 'music', 'subs'];

// The lanes that hold something laid OVER the cut, as opposed to the cut itself and the
// two audio-ish lanes. Two things follow from being one of these, and both are here rather
// than in two lists that could drift apart: an arrangement of them is what the overlay
// panel copies between projects, and their clips may cover one another - which makes their
// ORDER the stacking order, and so something the store must not tidy away. Must stay in
// step with OVERLAY_SCOPES in public/js/merge-v3/timeline.js.
const OVERLAY_TRACKS = ['biro', 'hook', 'halfer'];

// The two project types. A talking-head project comes from Scenarios and keeps the six fixed
// tracks; a blank one is made in Merge itself and grows its own. The talking-head kind is the
// ABSENT value on purpose: every project written before this existed is one, and none of them
// has to be migrated to stay itself.
const BLANK_KIND = 'blank';

// A blank project opens with two pairs and a subtitle lane. Top to bottom is the layer order
// and it is mirrored around the middle: video 2 over main video, then main audio under it and
// audio 2 under that - so a pair sits the same distance either side of the line, and being a
// pair needs no other marking.
function _emptyBlank() {
  const lane = (id, kind, name, linkId, main) => ({
    id, kind, name, linkId, main,
    volume: null, speed: null, clips: [],
  });
  return {
    kind: BLANK_KIND,
    // The shape of the finished video, and a property of the PROJECT rather than of the
    // browser looking at it. The preview composites into it and the renderer will cut to it;
    // holding it anywhere else is how the screen and the file come to disagree about frame.
    format: '9:16',
    tracks: [
      lane('v2', 'video', 'video 2',    'a2', false),
      lane('v1', 'video', 'main video', 'a1', true),
      lane('a1', 'audio', 'main audio', 'v1', true),
      lane('a2', 'audio', 'audio 2',    'v2', false),
      Object.assign(lane('subs', 'subs', 'Subtitles', null, true), { style: { ...SUBS_STYLE } }),
    ],
  };
}

function _emptyTimeline(kind) {
  if (String(kind || '') === BLANK_KIND) return _emptyBlank();
  const tracks = {};
  for (const t of TRACKS) {
    tracks[t] = {
      clips: [],
      // Track-level settings. null means "never set", which is not the same as 0 or
      // "none" - the inspector has to be able to tell an untouched track from one
      // explicitly set to nothing.
      //
      // `speed` is remembered even though choosing it writes the value into every clip:
      // without it the slider would read 1 after a reload while every clip sat at 1.5.
      //
      // There is NO separate audio on/off. It used to exist alongside volume and the two
      // fought: the flag defaulted to off for the overlay tracks, so raising the volume
      // slider changed a number and produced no sound. Volume is the single control now -
      // 0 is silent, and silence is the default for anything overlaid.
      volume: null, speed: null,
      transition: null, animation: null, filter: null,
    };
  }
  // Subtitle styling belongs to the TRACK: one look for the whole video, which is what a
  // caption style is. Vocabulary taken from the old libass popup, because libass is what
  // will burn them.
  //
  // tx/ty here is the BASE offset every subtitle gets, and each subtitle carries its own on
  // top. That is what makes "select the track, drag, they all move" and "select one, drag,
  // only it moves" the same gesture over two different values.
  tracks.subs.style = { ...SUBS_STYLE };
  return { tracks };
}

const SUBS_STYLE = {
  font: 'Arial', size: 60, bold: true, italic: false,
  // libass karaoke convention, kept because libass is what burns these: text starts in
  // `secondary` and flips to `primary` as each word is spoken. So primary = sung.
  primary: '#ffffff', secondary: '#8a9099',
  outlineColor: '#000000', shadowColor: '#000000',
  backColor: '#000000', backAlpha: 0,
  outline: 3, shadow: 0, blur: 0,
  borderStyle: 'outline',        // outline | box
  pos: 'bottom',                 // top | center | bottom - the anchor the offset is from
  tx: 0, ty: 0,                  // base offset, as fractions of the frame
  scaleX: 100, scaleY: 100,      // per-axis letter scale, percent - 100 is the font as drawn
  wrap: true, wordsPerLine: 0, karaoke: false,
};

const LOCAL_KEY = 'local';

// One project entry. `title` is what the picker shows; `createdAt` is what it sorts by,
// newest first, so an imported project appears at the top of the list.
function _wrap(tracksHolder, title, createdAt) {
  return {
    title: String(title || 'Untitled').slice(0, 120),
    createdAt: createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    tracks: (tracksHolder && tracksHolder.tracks) ? tracksHolder.tracks : _emptyTimeline().tracks,
    // Absent means talking-head - see BLANK_KIND. Never inferred from the shape of `tracks`:
    // a half-written save would then be able to change what a project IS.
    kind: (tracksHolder && tracksHolder.kind) || null,
    // Export settings, per project. The old editor kept these in the clobberable
    // last-write-wins blob; here they belong to the project like its title does.
    adv: null,
  };
}

// MIGRATION, and it is read-only: the single `timeline` this file used to hold becomes the
// `local` project, and nothing is written back until the next real save. A migration that
// rewrites on read would turn any accidental read - a version poll, a stray request - into
// a write, and there would be no un-migrated file left to compare against if it went wrong.
function _read() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (raw && typeof raw === 'object') {
      let timelines = (raw.timelines && typeof raw.timelines === 'object') ? raw.timelines : null;
      if (!timelines) {
        timelines = {};
        // The old shape. Carried across whole, clips and all.
        if (raw.timeline && typeof raw.timeline === 'object') {
          timelines[LOCAL_KEY] = _wrap(raw.timeline, 'Untitled', raw.updatedAt);
        }
      }
      const hidden = Array.isArray(raw.hidden) ? raw.hidden : [];
      // Frozen overlay arrangements, written only when a render is kept.
      const snapshots = (raw.snapshots && typeof raw.snapshots === 'object') ? raw.snapshots : {};
      // Which timelines have had their track volumes reset for the master rule. Read back
      // rather than rebuilt, or every open would look like the first one.
      const volRule = (raw.volRule && typeof raw.volRule === 'object') ? raw.volRule : {};
      return { version: Number(raw.version) || 0, updatedAt: raw.updatedAt || null, timelines, hidden, snapshots, volRule };
    }
  } catch (e) { /* absent or unreadable: an empty store is the honest answer */ }
  return { version: 0, updatedAt: null, timelines: {}, hidden: [], snapshots: {}, volRule: {} };
}

// Every film a timeline plays, for the proxy warm-up. Both shapes of `tracks`: the
// talking-head object of lanes and the blank project's array of them.
function _clipSrcs(t) {
  const out = [];
  const tracks = (t && t.tracks) || {};
  const lanes = Array.isArray(tracks) ? tracks : Object.values(tracks);
  for (const lane of lanes) for (const c of ((lane && lane.clips) || [])) if (c && c.src) out.push(String(c.src));
  return out;
}
// Lazily, and never fatal: the proxy maker lives in routes/ffmpeg.js, and an open or an
// import must not fail because a warm-up could not start.
function _warmProxies(t) {
  try { require('./ffmpeg').warmProxies(_clipSrcs(t), 480); } catch (e) {}
}

// The project the page should open when it has no preference: the most recently touched.
function _newestKey(timelines) {
  const keys = Object.keys(timelines || {});
  if (!keys.length) return null;
  return keys.sort((a, b) => String(timelines[b].updatedAt || '').localeCompare(String(timelines[a].updatedAt || '')))[0];
}

// A timeline's own version. Absent on anything written before there was one, and 0 is the
// right reading: the first save after that bumps it to 1, and any number quoted from the
// file-counter days is stale against it - one 409, one merge, and the tab is on the new rule.
const _revOf = (t) => Number(t && t.rev) || 0;

function _write(state) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmp, FILE);
}

// Drop anything not in the shape. The page is the only writer today, but a store that
// takes whatever it is handed is a store that will one day be full of half-shapes, and
// the reader is the wrong place to discover that.
// The loudest a clip or a track may be stored at. 4x is +12 dB, which is where the panel's
// slider ends; the ceiling used to be 1.5 because the panel used to be a 0-150% control, and
// after that control became decibels this quietly threw away everything above +3.5 dB on
// save. The dial said +12, the store wrote 1.5, and the preview dutifully played 1.5 - which
// read as "the control does nothing".
const VOL_MAX = 4;

const num = (v, d) => (v == null || isNaN(+v)) ? d : +v;
const orNull = (v) => (v == null ? null : v);

// The subtitle look, clamped field by field. Anything unknown is dropped and anything
// missing falls back to the default, so a half-written style can never reach the renderer.
//
// Lifted out of _sanitize because BOTH timeline shapes carry it. A caption style that
// clamped differently depending on the project type would be a fault nobody would think
// to look for.
function _subsStyle(st) {
  st = st || {};
  const pick = (v, allowed, dflt) => (allowed.includes(v) ? v : dflt);
  const clamp = (v, lo, hi, dflt) => (v == null || isNaN(+v)) ? dflt : Math.max(lo, Math.min(hi, +v));
  const hex = (v, dflt) => (/^#[0-9a-fA-F]{6}$/.test(String(v)) ? String(v) : dflt);
  return {

    font: String(st.font || SUBS_STYLE.font).slice(0, 60),
    size: clamp(st.size, 20, 120, SUBS_STYLE.size),
    bold: st.bold == null ? SUBS_STYLE.bold : !!st.bold,
    italic: !!st.italic,
    primary: hex(st.primary, SUBS_STYLE.primary),
    secondary: hex(st.secondary, SUBS_STYLE.secondary),
    outlineColor: hex(st.outlineColor, SUBS_STYLE.outlineColor),
    shadowColor: hex(st.shadowColor, SUBS_STYLE.shadowColor),
    backColor: hex(st.backColor, SUBS_STYLE.backColor),
    backAlpha: clamp(st.backAlpha, 0, 1, SUBS_STYLE.backAlpha),
    outline: clamp(st.outline, 0, 10, SUBS_STYLE.outline),
    shadow: clamp(st.shadow, 0, 10, SUBS_STYLE.shadow),
    blur: clamp(st.blur, 0, 10, SUBS_STYLE.blur),
    // Percent, and wider than the slider offers: the panel stops at 200, but a project
    // written by hand or by a later build should not have its captions silently reshaped.
    scaleX: clamp(st.scaleX, 25, 400, SUBS_STYLE.scaleX),
    scaleY: clamp(st.scaleY, 25, 400, SUBS_STYLE.scaleY),
    borderStyle: pick(st.borderStyle, ['outline', 'box'], SUBS_STYLE.borderStyle),
    pos: pick(st.pos, ['top', 'center', 'bottom'], SUBS_STYLE.pos),
    // The base offset every subtitle is moved by. Wider bounds than a PiP rect: a caption
    // nudged off the frame is a legitimate thing to do while composing.
    tx: clamp(st.tx, -1, 1, 0),
    ty: clamp(st.ty, -1, 1, 0),
    wrap: st.wrap == null ? SUBS_STYLE.wrap : !!st.wrap,
    wordsPerLine: Math.round(clamp(st.wordsPerLine, 0, 12, 0)),
    karaoke: !!st.karaoke,
  };
}

// One clip, rebuilt from a fixed shape. A field missing from this list is DROPPED on the next
// save, so anything that has to survive a reload is named here. `isSubs` is passed in rather
// than worked out: a subtitle is a clip with no source, whose text is its content and whose
// tx/ty are signed offsets from the style's anchor instead of a rectangle on the frame.
// A band percentage: a real number inside its range, or the default when there is none. Null
// is not a legal answer here the way it is for a PiP rect - a band always has a position, a
// thickness and a slice, even when nobody has touched them.
const _band = (v, dflt, lo = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(100, n)) : dflt;
};

function _clipOf(c, isSubs) {
  return {
      id:      String(c.id),
      src:     c.src ? String(c.src) : null,
      thumb:   c.thumb ? String(c.thumb) : null,
      // The picture, when the source is not one. A Main clip imported before its lipsync
      // exists is a READ plus the fragment's first frame, and this is the frame; the
      // preview draws it and the renderer holds it for the length of the read. Null on
      // everything else, where the source carries its own picture.
      poster:  c.poster ? String(c.poster) : null,
      name:    String(c.name || '').slice(0, 200),
      libId:   c.libId ? String(c.libId) : null,
      start:   Math.max(0, num(c.start, 0)),
      dur:     Math.max(0.1, num(c.dur, 1)),
      srcDur:  Math.max(0, num(c.srcDur, 0)),
      trimIn:  Math.max(0, num(c.trimIn, 0)),
      trimOut: Math.max(0, num(c.trimOut, 0)),
      speed:   Math.max(0.25, Math.min(2, num(c.speed, 1))),
      volume:  c.volume == null ? null : Math.max(0, Math.min(VOL_MAX, +c.volume || 0)),
      reversed: !!c.reversed,
      transition: orNull(c.transition),
      animation:  orNull(c.animation),
      filter:     orNull(c.filter),

      // How a clip that is not the full frame is placed. Vocabulary and value ranges are
      // the previous editor's, because its ffmpeg side is what will render them - a
      // prettier name here would be a setting nothing acts on.
      cropAlign: ['left', 'center', 'right'].includes(c.cropAlign) ? c.cropAlign : null,
      // Picture-in-picture, as fractions of the frame. tw == null means full frame, which
      // is why these are null rather than 0/1 defaults: "not placed" is a real state.
      // A PiP rect has to stay MOSTLY on the frame to be findable - not entirely on it. The
      // floor matches the canvas: a little off the edge is a composition, all the way off is
      // an insert nobody can drag back. It read 0 before, which quietly undid every drag past
      // the left or top edge on save, while the right and bottom worked. A SUBTITLE's tx/ty is an
      // offset from the style's anchor, so it is signed and may take the caption off the
      // edge - which is a real thing to want while composing.
      tx: c.tx == null ? null : (isSubs ? Math.max(-1, Math.min(1, +c.tx || 0)) : Math.max(-0.9, Math.min(0.98, +c.tx || 0))),
      ty: c.ty == null ? null : (isSubs ? Math.max(-1, Math.min(1, +c.ty || 0)) : Math.max(-0.9, Math.min(0.98, +c.ty || 0))),
      // Up to four times the frame, not one: an insert anchored by its middle may be bigger
      // than the film it sits on, and the blank preview has a margin around the frame so that
      // the overhang is visible while it is being placed. Nothing in the talking-head editor
      // writes above 1, so no project changes shape because the ceiling moved.
      tw: c.tw == null ? null : Math.max(0.04, Math.min(4, +c.tw || 1)),
      // Free rotation, set by dragging the handle on the preview. Separate from the
      // halfer's `rotation` on purpose: that one is quarter turns with band semantics,
      // this one is any angle applied to the placed rectangle.
      angle: c.angle == null ? null : Math.max(-180, Math.min(180, +c.angle || 0)),
      // How far the insert's edges dissolve, as a fraction of its shorter side. Listed here
      // because this rebuilds a clip from a fixed shape: a field missing from this list is
      // dropped on the next save, and the setting would come back undone on reload.
      feather: c.feather == null ? null : Math.max(0, Math.min(0.45, +c.feather || 0)),
      // Halfer bands only. Three numbers: where the band sits (100 top, 0 bottom), how thick
      // it is as a share of the frame, and which slice of the source survives the crop. They
      // replace halferAlign and valign, which are read once here as defaults and then not
      // written back - so an old project converts the first time it is saved, and looks
      // identical on the way through.
      halferPos: _band(c.halferPos, c.halferAlign === 'bottom' ? 0 : 100),
      halferThick: _band(c.halferThick, 40, 5),
      halferKeep: _band(c.halferKeep, c.valign === 'bottom' ? 0 : 100),
      rotation: [0, 90, 180, 270].includes(+c.rotation) ? +c.rotation : null,
      // Per-word timings for karaoke, RELATIVE to the clip's own start. Relative and not
      // absolute so that dragging a caption along the lane keeps its highlight in step -
      // absolute offsets would need rewriting on every move, and one missed rewrite is a
      // caption whose highlight runs ahead of the voice.
      words: (isSubs && Array.isArray(c.words))
        ? c.words.slice(0, 200)
            .filter(w => w && w.w != null)
            .map(w => ({ w: String(w.w).slice(0, 60), s: Math.max(0, num(w.s, 0)), e: Math.max(0, num(w.e, 0)) }))
        : null,
  };
}

// Both shapes are sanitised here, and which one is used is decided by the project's KIND,
// never by guessing at the data. A talking-head project keeps the six fixed tracks it has
// always had; a blank project carries an ordered LIST, because its tracks are created and
// deleted and their order is the layer order.
function _sanitize(timeline, kind) {
  return String(kind || '') === BLANK_KIND ? _sanitizeBlank(timeline) : _sanitizeTalking(timeline);
}

function _sanitizeTalking(timeline) {
  const out = _emptyTimeline();
  const src = (timeline && timeline.tracks) || {};
  out.tracks.subs.style = _subsStyle(src.subs && src.subs.style);
  // Raised when a fragment is cut out of Main under captions that already existed: they have
  // been slid along with the picture, but the sentences no longer match the audio. It is
  // kept because the warning has to outlive the tab - it is the project that is out of date,
  // not the session looking at it. Set in public/js/merge-v3/timeline.js, cleared when the
  // captions are generated again. Everything else on a track is rebuilt from the whitelist
  // below, which is exactly why this needs a line of its own.
  out.tracks.subs.stale = !!(src.subs && src.subs.stale);

  for (const t of TRACKS) {
    const from = src[t] || {};
    const to = out.tracks[t];
    to.volume     = from.volume == null ? null : Math.max(0, Math.min(VOL_MAX, +from.volume || 0));
    to.speed      = from.speed == null ? null : Math.max(0.25, Math.min(2, +from.speed || 1));
    to.transition = orNull(from.transition);
    to.animation  = orNull(from.animation);
    to.filter     = orNull(from.filter);

    // Subtitles are clips too, and they have no video: their content IS their text, which
    // lives in `name` like every other clip's caption. So the "must have a source" rule
    // that keeps junk off the video tracks has to make room for them.
    const clips = Array.isArray(from.clips) ? from.clips : [];
    to.clips = clips.filter(c => c && c.id && (c.src || (t === 'subs' && c.name)))
                    .map(c => _clipOf(c, t === 'subs'));

    // Start order, so every reader sees the same sequence without sorting it again. Except
    // on the lanes whose clips may cover one another, where the order IS the stacking order
    // - the preview draws a track's clips in it and the renderer chains its overlays in it
    // (OVERLAY_SCOPES in public/js/merge-v3/timeline.js). Sorting those by start would
    // restack the picture on every save, and silently: the clips would all still be there,
    // in the right places, showing the wrong one on top.
    if (!OVERLAY_TRACKS.includes(t)) to.clips.sort((a, b) => a.start - b.start);
  }
  return out;
}

// A blank project's tracks are a LIST and their order is the layer order, so this must not
// sort, reorder or dedupe by name. What it does enforce: known kinds only, one subtitle lane,
// the ceilings, and ids that actually exist - a link pointing at a track that was deleted is
// cleared here rather than left to be chased at render time.
function _sanitizeBlank(timeline) {
  const src = Array.isArray(timeline && timeline.tracks) ? timeline.tracks : [];
  const fmt = String((timeline && timeline.format) || '');
  const out = { kind: BLANK_KIND, format: ['9:16', '16:9'].includes(fmt) ? fmt : '9:16', tracks: [] };
  const seen = new Set();
  let video = 0, audio = 0, subs = 0, text = 0;

  for (const t of src) {
    if (!t || !t.id) continue;
    const id = String(t.id).slice(0, 40);
    if (seen.has(id)) continue;
    const kind = ['video', 'audio', 'subs', 'text'].includes(t.kind) ? t.kind : null;
    if (!kind) continue;
    // MAIN VIDEO + 3, MAIN AUDIO + 3, and exactly one subtitle lane. Enforced on the way in
    // as well as in the interface: the ceiling is a property of the project, not of a button.
    if (kind === 'video' && ++video > 4) continue;
    if (kind === 'audio' && ++audio > 4) continue;
    if (kind === 'subs'  && ++subs  > 1) continue;
    // TWO TEXT LANES. Subtitles are one lane because they are one transcript; text is typed,
    // and a title and a caption are two different things somebody may want at once - but a
    // third lane is a stack nobody can read past.
    if (kind === 'text'  && ++text  > 2) continue;
    seen.add(id);

    const isSubs = kind === 'subs';
    // Both kinds hold words rather than media: no source, a style of their own, and offsets
    // that may take a line off the edge of the frame while it is being placed.
    const isWords = isSubs || kind === 'text';
    const clips = Array.isArray(t.clips) ? t.clips : [];
    const row = {
      id,
      kind,
      name: String(t.name || id).slice(0, 40),
      // Which track this one's other half is. An explicit link and not the number, because
      // numbers are renumbered when a track is deleted and a standalone music track has no
      // counterpart above it at all.
      linkId: t.linkId ? String(t.linkId).slice(0, 40) : null,
      main: !!t.main,
      volume: t.volume == null ? null : Math.max(0, Math.min(VOL_MAX, +t.volume || 0)),
      speed:  t.speed  == null ? null : Math.max(0.25, Math.min(2, +t.speed || 1)),
      // pairId is added HERE and not inside _clipOf, which talking-head projects also go
      // through: a field appended there would change the shape of every clip in every
      // existing project for the sake of something only blank ones have.
      //
      // It is what makes a picture and its sound ONE piece of media rather than two clips
      // that happen to line up - so moving or deleting either half can find the other.
      clips: clips.filter(c => c && c.id && (c.src || (isWords && c.name)))
                  .map(c => ({ ..._clipOf(c, isWords),
                               pairId: c.pairId ? String(c.pairId).slice(0, 40) : null,
                               // How the clip meets a frame of another shape, and here for the
                               // same reason as pairId: only a blank project asks the question.
                               // A talking-head Main fragment IS the frame, and its overlays
                               // have cropAlign, which _clipOf already keeps.
                               fit: c.fit === 'fill' ? 'fill' : null })),
    };
    // `sizeAuto` is added HERE and not inside _subsStyle, which talking-head projects also go
    // through: it is the flag that says the caption size is still the format's suggestion
    // rather than a number somebody chose, and only a blank project can change format.
    if (isWords) {
      row.style = _subsStyle(t.style);
      row.style.sizeAuto = (t.style && t.style.sizeAuto === false) ? false : true;
    }
    // A video lane is a layer: clips on it may cover one another and the order they are in
    // is which one shows. Only the audio lanes are sorted, where overlap is a mix and the
    // order means nothing.
    if (kind === 'audio') row.clips.sort((a, b) => a.start - b.start);
    out.tracks.push(row);
  }

  // A link is only a link if both ends are still here.
  for (const t of out.tracks) if (t.linkId && !seen.has(t.linkId)) t.linkId = null;
  return out;
}

// The picker's list. Newest first, so an imported project is at the top.
router.get('/mv3/timelines', (req, res) => {
  try {
    const s = _read();
    const list = Object.keys(s.timelines).map(key => {
      const t = s.timelines[key];
      let clips = 0;
      if (Array.isArray(t.tracks)) for (const tr of t.tracks) clips += ((tr && tr.clips) || []).length;
      else for (const k of TRACKS) clips += ((t.tracks && t.tracks[k] && t.tracks[k].clips) || []).length;
      return { key, title: t.title || 'Untitled', createdAt: t.createdAt || null, updatedAt: t.updatedAt || null,
               kind: t.kind || null, clips, rev: _revOf(t), ...OWN.ownerView(t) };
    }).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    // Everyone sees every owner. The picker groups by them; which entries the caller may
    // change is answered per project, from its `owner` against `me`.
    res.json({ success: true, version: s.version, list, open: _newestKey(s.timelines),
               owners: OWN.ownersOf(Object.values(s.timelines), req.user), me: OWN.meView(req.user) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── One-time: neutralise the track volumes written under the old rule ───────
// A track's volume used to be a FALLBACK - it applied only to clips that carried none - and
// since every clip is created carrying one, it applied to nothing. Values were dialled into
// it and did nothing, which is the fault this change fixes.
//
// It is now a MASTER and multiplies, so those same dead values would come alive on the next
// open: one project holds seg=0.079, which is -22 dB, and it would drop that whole cut to a
// whisper without anyone touching it. Cleared once per timeline, stamped so it happens once,
// and safe to clear precisely because they were doing nothing.
const VOL_RULE = 2;

// The stamp lives on the STATE, not on the timeline. _sanitize rebuilds a timeline from a
// fixed shape every time the page saves, so a marker written inside one is dropped on the
// next write - and a migration that forgets it has run would clear the master volume the
// user had just set, every time they reopened the project.
function _migrateVolumes(state, key) {
  const t = state.timelines[key];
  if (!t) return false;
  // Blank projects were born after the master-volume rule and have nothing to undo.
  if (Array.isArray(t.tracks)) return false;
  state.volRule = state.volRule || {};
  if (state.volRule[key] === VOL_RULE) return false;
  let touched = false;
  for (const k of TRACKS) {
    const tr = t.tracks && t.tracks[k];
    if (tr && tr.volume != null) { tr.volume = null; touched = true; }
  }
  state.volRule[key] = VOL_RULE;
  return true;                 // always write: the stamp itself has to persist
}

router.get('/mv3/timeline', (req, res) => {
  try {
    const s = _read();
    // No key, or one that is not there: hand back the most recently touched project. A 404
    // would make the page's first load depend on it already knowing what exists.
    let key = String(req.query.key || '');
    if (!key || !s.timelines[key]) key = _newestKey(s.timelines) || LOCAL_KEY;
    const t = s.timelines[key];
    // Done on the way OUT, so a project is only touched when it is actually opened.
    if (t && _migrateVolumes(s, key)) {
      try { _write(s); console.log('[mv3] track volumes on', key, 'reset to unity for the new master rule'); } catch (e) {}
    }
    // The proxies this project's preview will ask for, started now - before the page has even
    // drawn its lanes - one ffmpeg at a time, so the first play is not the first transcode.
    if (t) _warmProxies(t);
    res.json({
      success: true, version: _revOf(t), key,
      title: t ? t.title : 'Untitled',
      ...OWN.ownerView(t), canEdit: OWN.canEdit(t, req.user),
      adv: t ? (t.adv || null) : null,
      timeline: t ? { kind: t.kind || null, format: t.format || null, tracks: t.tracks } : _emptyTimeline(),
    });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// The shape of nothing. Entering Merge without a project shows an empty timeline and waits
// for one to be chosen, and the page needs the same track shape the real ones have - built
// here rather than client-side so there is one definition of it.
router.get('/mv3/blank', (req, res) => {
  try { res.json({ success: true, timeline: _emptyTimeline(req.query.kind) }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Cheap enough to poll. Kept separate so watching for someone else's change does not
// pull the whole timeline every few seconds. With a key it answers for that one project;
// without one, the file's counter, which moves on every write to anything.
router.get('/mv3/timeline/version', (req, res) => {
  try {
    const s = _read();
    const key = String(req.query.key || '');
    if (!key) return res.json({ success: true, version: s.version });
    const t = s.timelines[key];
    if (!t) return res.status(404).json({ success: false, error: `no project "${key}"` });
    res.json({ success: true, version: _revOf(t), key });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// What a timeline says it is, for the one case where nothing else can say: a write that has to
// create the record it is writing to. Anything unrecognised is a talking-head project, which is
// what every project was before blank ones existed.
const _kindOf = (tl) => ((tl && tl.kind === BLANK_KIND) ? BLANK_KIND : null);

router.put('/mv3/timeline', (req, res) => {
  try {
    const cur = _read();
    const claimed = Number((req.body || {}).version);
    if (!Number.isFinite(claimed)) {
      return res.status(400).json({ success: false, error: 'version is required - a write that does not say what it replaces cannot be checked' });
    }
    const key = String((req.body || {}).key || '').trim() || _newestKey(cur.timelines) || LOCAL_KEY;
    const prev = cur.timelines[key];
    // Somebody else's project: refused before the version is even looked at. The page shows
    // it read-only and should never send this; this is for the page that did not know.
    if (prev && !OWN.canEdit(prev, req.user)) return OWN.refuse(res, prev);
    // The refusal that makes this store different, checked against THIS project's rev - see
    // the top of the file. The current state goes back with it, so the caller can reconcile
    // in one round trip instead of two. Nothing stored means nothing to protect, so a number
    // is not held against a project that no longer exists.
    if (prev && claimed !== _revOf(prev)) {
      return res.status(409).json({
        success: false, error: 'stale version', expected: _revOf(prev), got: claimed,
        version: _revOf(prev), key,
        timeline: { kind: prev.kind || null, tracks: prev.tracks },
      });
    }
    const now = new Date().toISOString();
    cur.timelines[key] = {
      title: prev ? prev.title : 'Untitled',
      createdAt: prev ? (prev.createdAt || now) : now,
      updatedAt: now,
      adv: prev ? (prev.adv || null) : null,
      from: prev ? (prev.from || null) : null,
      // Whose it is, set once at creation and carried across every save after; and how many
      // saves there have been, which is the number the next one must quote.
      owner: prev ? (prev.owner || null) : OWN.uidOf(req),
      rev: _revOf(prev) + 1,
      // Read off what is already stored, NOT off the request. A project's type is decided
      // when it is created and never again: a client able to send its own kind could turn a
      // talking-head project into a blank one and drop every track in it on one bad save.
      //
      // WITH NOTHING STORED there is nothing to protect, and the old rule did harm instead:
      // a write for a key that no longer exists - a project deleted while it was still open,
      // with one save left in the air - recreated it as a talking-head project whatever it had
      // been, so a blank timeline came back with somebody else's six lanes and none of its own.
      // Creating is the one moment the request is allowed to say what this is.
      kind: prev ? (prev.kind || null) : (_kindOf((req.body || {}).timeline) || null),
      format: _sanitize((req.body || {}).timeline, prev ? prev.kind : _kindOf((req.body || {}).timeline)).format || null,
      tracks: _sanitize((req.body || {}).timeline, prev ? prev.kind : _kindOf((req.body || {}).timeline)).tracks,
    };
    const next = { version: cur.version + 1, updatedAt: now, timelines: cur.timelines, hidden: cur.hidden, snapshots: cur.snapshots };
    _write(next);
    // The STORED tracks go back, not just the version. _sanitize normalises as it writes -
    // a missing field becomes an explicit null, rotation null becomes 0 - so what the caller
    // sent and what is now here are not byte-identical. The caller needs the stored shape to
    // compare against later: a merge that measures "what did I change" against the version it
    // sent would count the normalising itself as a change.
    // The kind goes back with the tracks. The client rebuilds its copy from this answer, and
    // a reply that named only the tracks left it holding a timeline with no type - which
    // silently handed the project to the other editor on the very first save.
    res.json({ success: true, version: cur.timelines[key].rev, updatedAt: now, key,
               kind: cur.timelines[key].kind || null, format: cur.timelines[key].format || null,
               tracks: cur.timelines[key].tracks });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Export settings for one project. Their own endpoint on purpose: pressing Apply in the
// export dialog must not rewrite the timeline, and a timeline save must not rewrite them.
router.post('/mv3/adv', (req, res) => {
  try {
    const b = req.body || {};
    const key = String(b.key || '');
    const cur = _read();
    const t = cur.timelines[key];
    if (!t) return res.status(404).json({ success: false, error: `no project "${key}"` });
    if (!OWN.canEdit(t, req.user)) return OWN.refuse(res, t);
    t.adv = (b.adv && typeof b.adv === 'object') ? b.adv : null;
    t.updatedAt = new Date().toISOString();
    _write({ version: cur.version + 1, updatedAt: t.updatedAt, timelines: cur.timelines, hidden: cur.hidden, snapshots: cur.snapshots });
    res.json({ success: true, version: _revOf(t) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

/* ── Reusing an overlay arrangement ──────────────────────────────────────────
   The set of Birols / Hooks / Halfers you placed over one project, offered as something to
   pull into another. Same clips, same order, same seconds.

   READ FROM THE PROJECTS THEMSELVES, not from a separate snapshot store. The snapshot was
   asked for as something written "after the project is rendered" - and there is no render
   yet, so a store fed only by export would leave this dropdown empty and the feature dead
   on arrival. Pulling live from a project's own tracks needs no new storage and answers the
   same question today. A project can additionally PIN its arrangement - Save in the panel -
   and a pinned set takes precedence for that project, so it stops drifting as editing goes
   on. Pinning was once done automatically whenever a render was kept, which pinned
   arrangements nobody chose and then outranked their own later edits; it is a deliberate
   act now.

   The ✕ hides a project from the list rather than deleting anything: the project itself is
   still there, it just stops being offered as a source.
   ──────────────────────────────────────────────────────────────────────────── */

// What a project offers as a source: its FROZEN snapshot if a render of it was kept,
// otherwise its live tracks. A rendered arrangement should stop drifting as you carry on
// editing the project - that is the whole point of freezing it at the render.
function _sourceTracks(cur, key) {
  const snap = cur.snapshots && cur.snapshots[key];
  if (snap && snap.tracks) return { tracks: snap.tracks, frozen: true, at: snap.at || null };
  const t = cur.timelines[key];
  return { tracks: (t && t.tracks) || {}, frozen: false, at: t ? t.updatedAt : null };
}

/* WHICH SCENARIO EACH ARRANGEMENT BELONGS TO.
   A birol is cut against a particular script, so an arrangement built for another scenario
   is timed against speech this project never says. The menu therefore opens on the projects
   that came from the SAME scenario - usually the earlier sends of this very cut, sv3_<id>_2
   and _3 - and keeps the rest behind a tick. Everything is still offered; it is the default
   that changes.

   `?for=<key>` names the project the menu was opened from, and the answer says which
   scenario that is, so the browser has something to filter by without knowing any of the
   rules below. _scenBehind is the same resolver the render window uses (key, then the copy
   chain, then the title), and it is given the scenarios ONCE: left to itself it reads them
   off disk per call, which over a list this size is one file read per row. */
router.get('/mv3/overlays', (req, res) => {
  try {
    const cur = _read();
    const hidden = new Set(Array.isArray(cur.hidden) ? cur.hidden : []);
    const scens = SCEN3.loadProjects() || [];
    const scenOf = (key) => {
      const hit = _scenBehind(cur.timelines, key, scens);
      return hit ? { id: String(hit.p.id), name: String(hit.p.name || hit.p.title || '') } : null;
    };
    const list = Object.keys(cur.timelines).map(key => {
      const t = cur.timelines[key];
      const src = _sourceTracks(cur, key);
      const per = {};
      let total = 0;
      for (const k of OVERLAY_TRACKS) {
        const n = ((src.tracks[k] && src.tracks[k].clips) || []).length;
        per[k] = n; total += n;
      }
      return { key, title: t.title || 'Untitled', per, total, frozen: src.frozen, updatedAt: t.updatedAt || null };
    })
      // Only projects that actually have an arrangement to give, and only ones not hidden.
      .filter(x => x.total > 0 && !hidden.has(x.key))
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
      // Resolved AFTER the filter, so nothing is worked out for a row nobody will see.
      .map(x => Object.assign(x, { scen: scenOf(x.key) }));
    const forKey = String(req.query.for || '');
    const on = forKey ? scenOf(forKey) : null;
    res.json({ success: true, list, for: on ? { key: forKey, id: on.id, name: on.name } : null });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/mv3/overlays/hide', (req, res) => {
  try {
    const key = String((req.body || {}).key || '');
    if (!key) return res.status(400).json({ success: false, error: 'key is required' });
    const cur = _read();
    const hidden = new Set(Array.isArray(cur.hidden) ? cur.hidden : []);
    hidden.add(key);
    const now = new Date().toISOString();
    _write({ version: cur.version + 1, updatedAt: now, timelines: cur.timelines, hidden: [...hidden], snapshots: cur.snapshots });
    res.json({ success: true, version: cur.version + 1 });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// The tracks to apply when a source is picked. Resolved here rather than by fetching the
// other project's timeline, so the client cannot accidentally pull live tracks from a
// project that has pinned an arrangement.
// Pin THIS project's arrangement, on purpose. A snapshot outranks the live timeline in
// _sourceTracks, which is the whole point: after saving, editing the timeline no longer
// changes what other projects pull from it. Saving again overwrites - there is one pinned
// arrangement per project, not a history, because "which of the six" is a question the
// panel would then have to answer on every row.
router.post('/mv3/overlays/save', (req, res) => {
  try {
    const key = String((req.body || {}).key || '');
    const cur = _read();
    const t = cur.timelines[key];
    if (!t) return res.status(404).json({ success: false, error: `no project "${key}"` });
    if (!OWN.canEdit(t, req.user)) return OWN.refuse(res, t);

    const tracks = {};
    let total = 0;
    for (const k of OVERLAY_TRACKS) {
      tracks[k] = JSON.parse(JSON.stringify(t.tracks[k] || _emptyTimeline().tracks[k]));
      total += ((tracks[k] && tracks[k].clips) || []).length;
    }
    // Saving an empty arrangement would pin "nothing" over a timeline that may later have
    // something, which reads as the feature being broken rather than as a choice.
    if (!total) return res.status(400).json({ success: false, error: 'there are no overlays on this timeline to save' });

    cur.snapshots = cur.snapshots || {};
    cur.snapshots[key] = { title: t.title || 'Untitled', at: new Date().toISOString(), tracks };
    const now = new Date().toISOString();
    _write({ version: cur.version + 1, updatedAt: now, timelines: cur.timelines, hidden: cur.hidden, snapshots: cur.snapshots });
    res.json({ success: true, key, total, at: cur.snapshots[key].at });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/mv3/overlays/:key', (req, res) => {
  try {
    const cur = _read();
    const key = String(req.params.key || '');
    if (!cur.timelines[key] && !(cur.snapshots || {})[key]) {
      return res.status(404).json({ success: false, error: `no project "${key}"` });
    }
    const src = _sourceTracks(cur, key);
    const tracks = {};
    for (const k of OVERLAY_TRACKS) tracks[k] = src.tracks[k] || _emptyTimeline().tracks[k];
    res.json({ success: true, key, frozen: src.frozen, at: src.at, tracks });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

/* ── Keeping or discarding a render ──────────────────────────────────────────
   The render lands in finals/ the moment ffmpeg finishes, which is BEFORE you have
   looked at it. So:

     keep     makes its thumbnail and FREEZES this project's overlay arrangement, which
              is the moment the user chose to treat this cut as finished;
     discard  deletes the file.

   The renders shelf in the Library is the finals/ directory itself, so discarding really
   does have to remove the file - there is no record to leave out.
   ──────────────────────────────────────────────────────────────────────────── */
const { FINALS_DIR } = require('../lib/config');
// The video poster maker, not lib/helpers' createThumbnail - that one is sharp, which
// reads images and cannot open an mp4. This is the same one-frame-at-0.5s grab the media
// library already uses, so a render's card looks like every other clip's.
const { makeThumb, thumbUrlFor } = require('../lib/video-thumb');

// A url like /finals/<name>.mp4 -> the absolute path, with nothing able to walk out of
// the directory.
function _finalPath(url) {
  const name = path.basename(String(url || '').split('?')[0]);
  if (!name || !/\.(mp4|mov|webm|mkv)$/i.test(name)) return null;
  return path.join(FINALS_DIR, name);
}

// ── A finished render: filed, named, kept, sent ──────────────────────────────
// Three doors in the order the result window uses them.
//
//   finish   the moment a render exists: filed into the person's queue as ready, so it can be
//            found again after the window closes;
//   save     Save & download: the file takes the name typed (renamed in finals/, with its
//            poster), gets a poster if it has none, and - when asked - goes to Partner.
//            A refusal there is reported, never fatal: the file is saved either way;
//   send     the same upload on its own, for "send again".
const MVQ = require('./mv3q');
const MP = require('../lib/partner');
const _ROOT_DIR = require('../lib/config').ROOT_DIR;
const _safeName = (s) => String(s || '').replace(/[\\\/:*?"<>|]/g, '-').replace(/[#?&%]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120);
const _thumbAbs = (url) => { try { return path.join(_ROOT_DIR, String(thumbUrlFor(url)).replace(/^\/+/, '')); } catch (e) { return null; } };

router.post('/mv3/render/finish', (req, res) => {
  try {
    const b = req.body || {};
    const abs = _finalPath(b.url);
    if (!abs || !fs.existsSync(abs)) return res.status(404).json({ success: false, error: 'no such render' });
    const item = MVQ.fileFinished({ url: b.url, title: b.title, key: b.key, kind: b.kind, dur: b.dur,
                                    owner: OWN.uidOf(req), ownerNick: req.user ? req.user.nickname : null });
    res.json({ success: true, queueId: item.id });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Renames the file (and its poster) to `name` inside finals/, uniquified. Returns the new url.
function _renameFinal(abs, url, name) {
  const want = _safeName(name);
  if (!want || want + '.mp4' === path.basename(abs)) return { abs, url };
  let target = path.join(FINALS_DIR, want + '.mp4');
  for (let n = 2; fs.existsSync(target); n++) target = path.join(FINALS_DIR, `${want} (${n}).mp4`);
  fs.renameSync(abs, target);
  const nextUrl = '/finals/' + path.basename(target);
  try {
    const oldT = _thumbAbs(url), newT = _thumbAbs(nextUrl);
    if (oldT && newT && fs.existsSync(oldT)) fs.renameSync(oldT, newT);
  } catch (e) { /* a poster is remade on demand */ }
  return { abs: target, url: nextUrl };
}

async function _sendOne({ abs, name, key }) {
  const m = /^([^_]+)_[^_]+_([^_]+)_[^_]+_([^_]+)_/.exec(String(name || ''));
  return MP.send({
    filePath: abs, name,
    // What the pattern says, when the name follows it; nothing when it does not.
    angle: m ? m[2] : null, hook: m ? m[3] : null,
    notes: key ? 'ugc-app project ' + key : null,
  });
}

router.post('/mv3/render/save', async (req, res) => {
  try {
    const b = req.body || {};
    const abs = _finalPath(b.url);
    if (!abs || !fs.existsSync(abs)) return res.status(404).json({ success: false, error: 'no such render' });
    const name = String(b.name || '').trim().slice(0, 160) || path.basename(abs, '.mp4');
    const moved = _renameFinal(abs, b.url, name);
    let thumb = null;
    try { thumb = await makeThumb(moved.url); } catch (e) { /* a missing poster is not a reason to lose the render */ }
    const patch = { url: moved.url, title: name };
    let sent = null, sendError = null;
    if (b.send) {
      try { sent = await _sendOne({ abs: moved.abs, name, key: b.key }); patch.sent = sent; }
      catch (e) { sendError = e.message; patch.sendError = sendError; }
    }
    const entry = (b.queueId && MVQ.updateEntry(String(b.queueId), patch)) || (MVQ.findByUrl(b.url) && MVQ.updateEntry(MVQ.findByUrl(b.url).id, patch)) || null;
    res.json({ success: true, url: moved.url, name, thumb: thumb || null, sent, sendError, queueId: entry ? entry.id : null });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/mv3/render/send', async (req, res) => {
  try {
    const b = req.body || {};
    const abs = _finalPath(b.url);
    if (!abs || !fs.existsSync(abs)) return res.status(404).json({ success: false, error: 'no such render' });
    const name = String(b.name || '').trim().slice(0, 160) || path.basename(abs, '.mp4');
    const sent = await _sendOne({ abs, name, key: b.key });
    if (b.queueId) MVQ.updateEntry(String(b.queueId), { sent, sendError: null });
    res.json({ success: true, sent });
  } catch (e) { res.status(502).json({ success: false, error: e.message }); }
});

router.post('/mv3/render/discard', (req, res) => {
  try {
    const abs = _finalPath((req.body || {}).url);
    if (!abs) return res.status(400).json({ success: false, error: 'not a render path' });
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
    // The queue entry filed at finish goes with the file.
    try { MVQ.removeByUrl(String((req.body || {}).url || '')); } catch (e) {}
    // Its poster too, if one was made.
    try {
      const turl = thumbUrlFor('/finals/' + path.basename(abs));
      const tabs = path.join(_ROOT_DIR, String(turl).replace(/^\/+/, ''));
      if (fs.existsSync(tabs)) fs.unlinkSync(tabs);
    } catch (e) {}
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Delete one project's timeline. The confirmation is the page's job (the button turns into
// "really?"), so this just does it - a second confirmation here would be theatre.
/* ── A project that did not come from Scenarios ──────────────────────────────
   POST /api/mv3/timeline/new { title } -> { success, key, version }

   Every project until now arrived with a cut behind it: Scenarios writes sv3_<projectId> and
   fills the Main track. This makes an empty one, keyed mv3_<stamp> so the origin is readable
   from the key alone, and the caller opens it and builds the timeline by hand.

   THE TITLE IS TAKEN, NOT DEFAULTED, and the reason is that nothing in this app can rename a
   project. An "Untitled" made here would stay Untitled forever, so a blank title is refused
   rather than quietly accepted. */
router.post('/mv3/timeline/new', (req, res) => {
  try {
    const title = String((req.body || {}).title || '').trim();
    if (!title) return res.status(400).json({ success: false, error: 'a title is required' });
    if (title.length > 120) return res.status(400).json({ success: false, error: 'title is too long (120 max)' });

    const cur = _read();
    // Two projects with one name are two shelves with one label in the library. The rename
    // route refuses it; creation has to as well, or the rule only holds half the time.
    if (_titleTaken(cur.timelines, title, null)) {
      return res.status(409).json({ success: false, error: 'a project called "' + title + '" already exists' });
    }
    // The stamp is unique in practice; the loop is for the case it is not (two clicks inside one
    // millisecond, or a clock that went backwards) so a new project can never land on top of an
    // existing timeline.
    let key = 'mv3_' + Date.now();
    for (let n = 1; cur.timelines[key]; n++) key = 'mv3_' + Date.now() + '_' + n;

    // Made in Merge means blank-type, unless the caller asks for the other. This is the one
    // place a kind is chosen.
    const kind = String((req.body || {}).kind || BLANK_KIND) === BLANK_KIND ? BLANK_KIND : null;
    const now = new Date().toISOString();
    cur.timelines[key] = {
      title,
      createdAt: now,
      updatedAt: now,
      adv: null,
      owner: OWN.uidOf(req),
      rev: 1,
      kind,
      format: _emptyTimeline(kind).format || null,
      tracks: _emptyTimeline(kind).tracks,
    };
    const version = cur.version + 1;
    _write({ version, updatedAt: now, timelines: cur.timelines, hidden: cur.hidden, snapshots: cur.snapshots });
    res.json({ success: true, key, version, title });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Case-insensitive, because two projects called "Rome" and "rome" are two projects nobody can
// tell apart in a picker - and they would share a library category exactly.
function _titleTaken(timelines, title, exceptKey) {
  const want = String(title || '').trim().toLowerCase();
  return Object.keys(timelines || {}).some(k =>
    k !== exceptKey && String((timelines[k] || {}).title || '').trim().toLowerCase() === want);
}

/**
 * PATCH /api/mv3/timeline/:key/title   { title } -> { success, title }
 *
 * Projects could not be renamed, and the picker said so in its own error message. They can now,
 * and the reason it is worth the route is the library: a project's generations are filed under a
 * category named after it, so a project stuck with a bad name is a shelf stuck with one too.
 *
 * THE CATEGORY MOVES WITH IT. Renaming only the project would leave the pictures filed under a
 * name that no longer exists anywhere - which is worse than not renaming at all, because the
 * shelf would still look right until somebody went looking for the project it names.
 */
router.patch('/mv3/timeline/:key/title', (req, res) => {
  try {
    const key = String(req.params.key || '');
    const title = String((req.body || {}).title || '').trim();
    if (!title) return res.status(400).json({ success: false, error: 'a name is needed' });
    if (title.length > 120) return res.status(400).json({ success: false, error: 'title is too long (120 max)' });

    const cur = _read();
    const rec = cur.timelines[key];
    if (!rec) return res.status(404).json({ success: false, error: `no project "${key}"` });
    if (!OWN.canEdit(rec, req.user)) return OWN.refuse(res, rec);
    if (String(rec.title || '') === title) return res.json({ success: true, title, version: _revOf(rec) });
    if (_titleTaken(cur.timelines, title, key)) {
      return res.status(409).json({ success: false, error: 'a project called "' + title + '" already exists' });
    }

    const was = String(rec.title || '');
    rec.title = title;
    const now = new Date().toISOString();
    _write({ version: cur.version + 1, updatedAt: now, timelines: cur.timelines, hidden: cur.hidden, snapshots: cur.snapshots });

    // Found by the name the filing used, and shortened by the same rule - see catLabelFor.
    // A failure here is not a failure to rename: the project has the name asked for, and a
    // category left behind is a tidying problem rather than lost work.
    let moved = false;
    try {
      const GENS = require('../lib/mv3-gens');
      const LC = require('../lib/library-cats');
      const oldLabel = GENS.catLabelFor(was);
      const newLabel = GENS.catLabelFor(title);
      if (oldLabel !== newLabel && oldLabel !== GENS.LOOSE_CAT) {
        const own = ((LC.read().images || {}).own) || [];
        const cat = own.find(c => c.label === oldLabel);
        if (cat) { LC.rename('images', cat.id, newLabel); moved = true; }
      }
    } catch (e) { console.warn('[mv3] could not move the library category:', e.message); }

    res.json({ success: true, key, title, was, version: _revOf(rec), categoryMoved: moved });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.delete('/mv3/timeline/:key', (req, res) => {
  try {
    const key = String(req.params.key || '');
    const cur = _read();
    if (!cur.timelines[key]) return res.status(404).json({ success: false, error: `no project "${key}"` });
    // Deleting is the one write nobody but the owner should be able to undo their way out of,
    // so it is held to the same line as the rest - and the admin's on anything.
    if (!OWN.canEdit(cur.timelines[key], req.user)) return OWN.refuse(res, cur.timelines[key]);
    delete cur.timelines[key];
    const now = new Date().toISOString();
    _write({ version: cur.version + 1, updatedAt: now, timelines: cur.timelines, hidden: cur.hidden, snapshots: cur.snapshots });
    res.json({ success: true, version: cur.version + 1, open: _newestKey(cur.timelines) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

/* ── A copy of somebody's project, owned by whoever asked ────────────────────
   POST /api/mv3/timeline/:key/copy -> { success, key, title }

   The one way to work on a project that is not yours. Everything the project is comes
   across - tracks, export settings, kind and format, the pinned overlay arrangement if it
   has one - and the copy is the caller's from its first second: their name on it, rev 1,
   nothing shared with the original but the media files, which neither project writes to.
   ──────────────────────────────────────────────────────────────────────────── */
router.post('/mv3/timeline/:key/copy', (req, res) => {
  try {
    const src = String(req.params.key || '');
    const cur = _read();
    const from = cur.timelines[src];
    if (!from) return res.status(404).json({ success: false, error: `no project "${src}"` });

    // "(copy)", then "(copy 2)" and on until the name is free: the rule rename and creation
    // refuse on, applied here instead, because there is nobody in the loop to ask.
    const base = String(from.title || 'Untitled').replace(/\s*\(copy(?: \d+)?\)$/i, '').slice(0, 100);
    let title = base + ' (copy)';
    for (let n = 2; _titleTaken(cur.timelines, title, null); n++) title = `${base} (copy ${n})`;

    let key = 'mv3_' + Date.now();
    for (let n = 1; cur.timelines[key]; n++) key = 'mv3_' + Date.now() + '_' + n;

    const now = new Date().toISOString();
    const deep = (x) => (x == null ? null : JSON.parse(JSON.stringify(x)));
    cur.timelines[key] = {
      title,
      createdAt: now,
      updatedAt: now,
      adv: deep(from.adv),
      owner: OWN.uidOf(req),
      rev: 1,
      kind: from.kind || null,
      format: from.format || null,
      // Where it came from. The result window walks this back to the Scenarios record the
      // import was made from - see /mv3/timeline/:key/source below.
      from: src,
      tracks: deep(from.tracks) || _emptyTimeline(from.kind).tracks,
    };
    // The pinned arrangement follows, or the copy would offer a live one where the original
    // offers a frozen one. The volume-rule stamp follows for the opposite reason: without it
    // the copy's first open would "migrate" it and quietly reset its track volumes.
    cur.snapshots = cur.snapshots || {};
    if (cur.snapshots[src]) cur.snapshots[key] = { ...deep(cur.snapshots[src]), title };
    cur.volRule = cur.volRule || {};
    if (cur.volRule[src] != null) cur.volRule[key] = cur.volRule[src];
    _write({ version: cur.version + 1, updatedAt: now, timelines: cur.timelines, hidden: cur.hidden,
             snapshots: cur.snapshots, volRule: cur.volRule });
    res.json({ success: true, key, title });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

/* ── The Scenarios project behind a Merge key ────────────────────────────────
   GET /api/mv3/timeline/:key/source -> { success, project | null, via }

   The result window fills the parts of a creative's name from the Scenarios record - the
   vertical, the product, the cast character, the gender. A project imported from Scenarios
   carries that record's id in its key (sv3_<id>); a COPY does not - it gets a key of its own,
   and until now it kept nothing about where it came from, so a render out of a copy was named
   from its title alone. A copy now remembers its source (`from`), and this walks that chain
   back to the import. Copies made before the field existed are matched by TITLE instead: the
   import names a project after the record, date first, and a copy adds "(copy)"; both are
   taken off before comparing, and so is the "(2)" a second import gets.
   ──────────────────────────────────────────────────────────────────────────── */
const _titleBase = (s) => String(s || '')
  .replace(/^local_\d+_/, '')
  .replace(/^(\d{4}-\d{2}-\d{2}\s*[-—–]\s*)+/, '')
  .replace(/\s*\(copy(?: \d+)?\)$/i, '')
  .replace(/\s*\(\d+\)$/, '')
  .replace(/\s*·\s*stills$/i, '')
  .trim().toLowerCase();

// `loaded` is the scenarios, for a caller resolving a whole list at once: without it every
// call reads them off disk again.
function _scenBehind(timelines, key, loaded) {
  const all = loaded || SCEN3.loadProjects() || [];
  const byId = (id) => all.find(x => String(x.id) === String(id)) || null;
  const seen = new Set();
  let k = String(key || '');
  while (k && !seen.has(k)) {
    seen.add(k);
    const m = /^sv3_(\d+)/.exec(k);
    if (m) { const p = byId(m[1]); if (p) return { p, via: 'key' }; break; }
    const t = timelines[k];
    if (!t || !t.from) break;
    k = String(t.from);
  }
  const t = timelines[String(key || '')];
  const base = t ? _titleBase(t.title) : '';
  const p = base ? all.find(x => _titleBase(x.name) === base) : null;
  return p ? { p, via: 'title' } : null;
}

// THE HOOK THAT NAMES THE RENDER. The Meta pattern carries a hook id (…_AUTH_H03_…) and
// it is the hook the video OPENS with: the clip on the Hooks lane pinned to the very start
// of the timeline. One that begins a moment later is an insert, not the hook the creative
// is built on, so only the first frames count - anything within a frame of zero at 30 fps.
// No such clip, or a hook with no number, and the field keeps its Hxx placeholder.
const HOOK_AT_START = 0.04;
function _openingHookId(t) {
  const tracks = (t && t.tracks) || {};
  const lane = Array.isArray(tracks) ? tracks.find(x => x && x.kind === 'hook') : tracks.hook;
  const clips = (lane && lane.clips) || [];
  let first = null;
  for (const c of clips) {
    if (!c || !c.src) continue;
    const at = +c.start || 0;
    if (at > HOOK_AT_START) continue;
    if (!first || at < ((+first.start) || 0)) first = c;
  }
  if (!first) return null;
  try { return require('../lib/hook-ids').idFor(first.src); } catch (e) { return null; }
}

router.get('/mv3/timeline/:key/source', (req, res) => {
  try {
    const cur = _read();
    const key = String(req.params.key || '');
    const rec = cur.timelines[key];
    if (!rec) return res.status(404).json({ success: false, error: `no project "${key}"` });
    const hookId = _openingHookId(rec);
    const hit = _scenBehind(cur.timelines, key);
    if (!hit) return res.json({ success: true, project: null, via: null, hookId });
    const p = hit.p;
    const cast = (p.casting && typeof p.casting === 'object') ? p.casting : {};
    res.json({ success: true, via: hit.via, hookId, project: {
      id: String(p.id), name: String(p.name || ''), title: String(p.title || ''),
      vertical: String(p.vertical || ''), product: String(p.product || ''),
      gender: String(p.gender || ''), characterName: String(cast.characterName || ''),
    } });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

/* ── Import a Scenarios cut into the Main track ──────────────────────────────
   POST /api/mv3/import/scen3 { projectId } -> { success, key, fragments }

   THE LENGTH COMES FROM THE AUDIO, not the video. A generated fragment's video runs past
   the end of the speech and what it does there is hallucination - a face still moving
   with nothing to say. So each clip is as long as its voice track and the tail of the
   video is trimmed off. Measured on real data: a line with 6.53s of audio had a 7.20s
   clip, so 0.67s of it was invention.

   EVERY SEND MAKES A NEW PROJECT, numbered. It used to write to one key per scenario and
   so replaced the Main track of whatever was there - which was right for the case it was
   written for (regenerate one fragment, send again, keep your overlays) and quietly
   destructive for the other one: a Main track that had been trimmed, rippled or had
   library inserts dropped into it was rebuilt from the reel with none of that. Nothing
   warned, because from the store's point of view an import is an import.

   So: sv3_<id>, then sv3_<id>_2, _3, and the overlays are COPIED FORWARD from the newest
   sibling. The old project stays exactly as it was, and the new one does not start with an
   empty Birols lane - which is what made replacing in place attractive in the first place.
   ──────────────────────────────────────────────────────────────────────────── */
const SCEN3 = require('./scen3');
const LOUD = require('../lib/loudness');
const { ROOT_DIR: _ROOT } = require('../lib/config');

// ── Bringing the quiet reads up to the loudest ──────────────────────────────
// ElevenLabs hands fragments back at inconsistent levels. On one real cut the spread was
// 10.9 dB between the loudest and quietest read, and every fragment the author picked out
// by ear as "too quiet" was among the bottom five by measurement.
//
// Levelled UP, to the loudest fragment, never down. These are voice reads: the loudest is
// itself a normal read - on that cut, -25.9 LUFS, quiet by any platform's reckoning - so
// there is nothing up there to protect anyone from. Aiming at the middle instead pulled half
// the project down and handed back a video quieter than its own best part, which is what the
// first attempt at this did.
//
// Measured on the READ rather than the rendered clip: the mp3 is what was generated and what
// the fault lives in. Once per fragment at import, so what the preview plays is what the
// render writes.
//
// Stored as `gainDb`, deliberately beside `volume` and not inside it: volume is the user's
// control, and a measurement written into it would be erased the first time they touched the
// slider - or mistaken for something they had set themselves.
async function _levelReads(items) {
  // Four at a time: sequentially this is about half a second each, and a seventeen fragment
  // project would have added eight seconds to an import that is otherwise instant.
  const measured = new Array(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      const it = items[i];
      const fp = it.audioPath ? path.join(_ROOT, String(it.audioPath).replace(/^\/+/, '')) : null;
      let m = null;
      if (fp && fs.existsSync(fp)) { try { m = await LOUD.measure(fp); } catch (e) { m = null; } }
      measured[i] = { it, m };
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, worker));

  const tgt = LOUD.target(measured.filter(x => x && x.m).map(x => x.m.lufs));
  if (tgt == null) return;                    // nothing readable: every gain stays at 0
  for (const x of measured) { if (x) x.it.gainDb = x.m ? LOUD.gainFor(x.m, tgt) : 0; }
  const lifted = measured.filter(x => x && x.it.gainDb >= 0.5);
  const most = lifted.reduce((a, x) => Math.max(a, x.it.gainDb), 0);
  console.log('[mv3/import] levelled to the loudest read (' + tgt.toFixed(1) + ' LUFS); '
    + lifted.length + ' of ' + measured.length + ' lifted, the most by ' + most.toFixed(1) + ' dB');
}

router.post('/mv3/import/scen3', async (req, res) => {
  try {
    const id = String((req.body || {}).projectId || '').trim();
    if (!id) return res.status(400).json({ success: false, error: 'projectId is required' });
    const p = (SCEN3.loadProjects() || []).find(x => String(x.id) === id);
    if (!p) return res.status(404).json({ success: false, error: `no scenarios project "${id}"` });

    // Two ways in, and the difference is only what the picture is.
    //
    // 'video' is the finished cut: rendered lipsync clips, trimmed to their voice.
    // 'stills' is the same cut BEFORE any of it has been paid for - each fragment's first
    // frame held for the length of its read. It exists so the overlays can be built against
    // the real timing while the lipsync is still an intention: birols land on the words they
    // are meant to land on, and sending the video afterwards replaces Main and carries every
    // one of them forward (see the numbering above).
    const mode = String((req.body || {}).mode || 'video') === 'stills' ? 'stills' : 'video';
    const { variant, cut } = mode === 'stills' ? SCEN3.audioCut(p) : SCEN3.cutClips(p);
    if (!cut.length) {
      return res.status(400).json({ success: false, error: mode === 'stills'
        ? 'nothing to import - no fragment has both a read and a first frame yet'
        : 'nothing to import - no fresh clips in that project' });
    }

    // Measured on the read itself. Both modes carry one, in different places - a video
    // fragment keeps it on the line, a still IS one.
    const levels = cut.map(it => ({
      audioPath: mode === 'stills'
        ? ((it.audio || {}).path || null)
        : ((((it.line || {}).audio || {})[variant] || {}).path || null),
      gainDb: 0,
    }));
    await _levelReads(levels);
    const gainOf = (i) => (levels[i] && levels[i].gainDb) || 0;

    const clips = [];
    let at = 0;
    for (const [_i, it] of (mode === 'stills' ? [] : cut).entries()) {
      const vidDur = Math.max(0, +(it.clip || {}).dur || 0);
      const aud = ((it.line || {}).audio || {})[variant] || {};
      const audDur = Math.max(0, +aud.dur || 0);
      // The speech decides. Falling back to the video only when there is no audio length
      // to trust, and never claiming more than the video actually holds.
      const dur = (audDur > 0) ? Math.min(audDur, vidDur || audDur) : vidDur;
      if (!(dur > 0)) continue;
      const said = String((variant === 'tagged' ? it.line.tagged : it.line.text) || it.line.text || '');
      clips.push({
        id: 'sg' + id.slice(-6) + '_' + it.n,
        src: it.clip.path,
        thumb: it.clip.thumb || null,
        // The line itself, without the performance tags - they are directions, not words.
        name: said.replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || ('fragment ' + it.n),
        libId: null,
        start: Math.round(at * 100) / 100,
        dur: Math.round(dur * 100) / 100,
        srcDur: Math.round((vidDur || dur) * 100) / 100,
        trimIn: 0,
        // The hallucinated tail.
        trimOut: Math.round(Math.max(0, (vidDur || dur) - dur) * 100) / 100,
        speed: 1,
        // The fragment's video carries the voice, so Main arrives audible.
        volume: 1,
        // What bringing this read up to the loudest one asks for, in dB. Separate from
        // volume so the slider stays the user's and this stays the measurement's.
        gainDb: gainOf(_i),
        reversed: false,
        transition: null, animation: null, filter: null,
        cropAlign: null, tx: null, ty: null, tw: null, angle: null,
        halferPos: null, halferThick: null, halferKeep: null, rotation: null,
      });
      at += dur;
    }

    // The stills pass. Same shape of clip, same order, same names - what changes is that
    // `src` is the READ and `poster` is the picture, where a video clip is both at once.
    // The renderer already knew how to put a voice under a video it does not have; it now
    // holds the still instead of black (routes/ffmpeg.js, the voiceOnly branch).
    if (mode === 'stills') {
      for (const [_i, it] of cut.entries()) {
        const dur = Math.max(0, +it.audio.dur || 0);
        if (!(dur > 0)) continue;
        const said = String((variant === 'tagged' ? it.line.tagged : it.line.text) || it.line.text || '');
        clips.push({
          id: 'sa' + id.slice(-6) + '_' + it.n,
          src: it.audio.path,
          poster: it.frame || null,
          thumb: it.frame || null,
          name: said.replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || ('fragment ' + it.n),
          libId: null,
          start: Math.round(at * 100) / 100,
          dur: Math.round(dur * 100) / 100,
          // The read IS the clip - there is no tail to trim, which is the whole difference
          // from a generated video.
          srcDur: Math.round(dur * 100) / 100,
          trimIn: 0, trimOut: 0,
          speed: 1,
          volume: 1,
          gainDb: gainOf(_i),
          reversed: false,
          transition: null, animation: null, filter: null,
          cropAlign: null, tx: null, ty: null, tw: null, angle: null,
          halferPos: null, halferThick: null, halferKeep: null, rotation: null,
        });
        at += dur;
      }
    }

    // The cut's own films, made into proxies while the project is still being written, so it
    // opens in Merge with its preview already prepared.
    _warmProxies({ tracks: { seg: { clips } } });

    const cur = _read();
    const now = new Date().toISOString();
    const base = 'sv3_' + id;

    // The next free number, taken from the HIGHEST one in use rather than from how many
    // there are: delete the second of three and counting would hand out a key that is
    // already taken.
    const mine = Object.keys(cur.timelines).filter(k => k === base || k.startsWith(base + '_'));
    let top = 0;
    for (const k of mine) {
      if (k === base) { top = Math.max(top, 1); continue; }
      const m = /_(\d+)$/.exec(k);
      if (m) top = Math.max(top, +m[1]);
    }
    const n = top + 1;
    const key = n === 1 ? base : `${base}_${n}`;

    // The one to copy the overlays from: the most recently touched of this scenario's
    // projects, which is the one that was being worked on.
    const prevKey = mine.sort((a, b) =>
      String(cur.timelines[b].updatedAt || '').localeCompare(String(cur.timelines[a].updatedAt || '')))[0];
    const prev = prevKey ? cur.timelines[prevKey] : null;

    // A DEEP copy, or the two projects would share the same clip objects and editing one
    // would edit the other - which is a worse version of the bug this numbering fixes.
    const tracks = _emptyTimeline().tracks;
    if (prev) {
      for (const t of OVERLAY_TRACKS.concat(['music', 'subs'])) {
        if (prev.tracks[t]) tracks[t] = JSON.parse(JSON.stringify(prev.tracks[t]));
      }
    }
    // Main comes from the reel every time. The track's own settings are carried over -
    // a speed or a volume set on the spine is a preference, not part of the cut.
    tracks.seg = Object.assign(_emptyTimeline().tracks.seg, prev ? { ...prev.tracks.seg, clips: [] } : {}, { clips });

    cur.timelines[key] = {
      // Said in the title because the picker is where the two are told apart: a stills cut
      // and the video cut of the same script are otherwise the same name on the same day.
      title: `${now.slice(0, 10)} - ${String(p.title || '').trim() || 'talking head'}`
           + (mode === 'stills' ? ' · stills' : '')
           + (n > 1 ? ` (${n})` : ''),
      createdAt: now,
      updatedAt: now,
      adv: prev ? (prev.adv || null) : null,
      owner: OWN.uidOf(req),
      rev: 1,
      tracks,
    };
    _write({ version: cur.version + 1, updatedAt: now, timelines: cur.timelines, hidden: cur.hidden, snapshots: cur.snapshots });
    res.json({ success: true, key, fragments: clips.length, variant });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

module.exports = router;
