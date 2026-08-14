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

   The version is the FILE's, not per timeline: the file is written whole, so one
   counter is what a stale write has to be checked against. With one editor that is
   also enough - two tabs on two different projects will still refuse each other
   rather than interleave, which is the safe direction to be wrong in.

   Endpoints:
     GET    /api/mv3/timelines             -> { success, version, list } newest first
     GET    /api/mv3/timeline?key=…        -> { success, version, key, timeline }
     GET    /api/mv3/timeline/version      -> { success, version }
     PUT    /api/mv3/timeline              { version, key, timeline } -> { success, version }
                                           409 { success:false, version, timeline } on a
                                           stale version, so the caller can reconcile
                                           rather than guess.
   ═══════════════════════════════════════════════════════════════════════════ */

const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

const DATA_DIR = path.join(__dirname, '..', 'data');
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

function _emptyTimeline() {
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
      return { version: Number(raw.version) || 0, updatedAt: raw.updatedAt || null, timelines, hidden, snapshots };
    }
  } catch (e) { /* absent or unreadable: an empty store is the honest answer */ }
  return { version: 0, updatedAt: null, timelines: {}, hidden: [], snapshots: {} };
}

// The project the page should open when it has no preference: the most recently touched.
function _newestKey(timelines) {
  const keys = Object.keys(timelines || {});
  if (!keys.length) return null;
  return keys.sort((a, b) => String(timelines[b].updatedAt || '').localeCompare(String(timelines[a].updatedAt || '')))[0];
}

function _write(state) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmp, FILE);
}

// Drop anything not in the shape. The page is the only writer today, but a store that
// takes whatever it is handed is a store that will one day be full of half-shapes, and
// the reader is the wrong place to discover that.
function _sanitize(timeline) {
  const out = _emptyTimeline();
  const src = (timeline && timeline.tracks) || {};
  const num = (v, d) => (v == null || isNaN(+v)) ? d : +v;
  const orNull = (v) => (v == null ? null : v);

  // The subtitle look, clamped field by field. Anything unknown is dropped and anything
  // missing falls back to the default, so a half-written style can never reach the renderer.
  const st = (src.subs && src.subs.style) || {};
  const pick = (v, allowed, dflt) => (allowed.includes(v) ? v : dflt);
  const clamp = (v, lo, hi, dflt) => (v == null || isNaN(+v)) ? dflt : Math.max(lo, Math.min(hi, +v));
  const hex = (v, dflt) => (/^#[0-9a-fA-F]{6}$/.test(String(v)) ? String(v) : dflt);
  out.tracks.subs.style = {
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

  for (const t of TRACKS) {
    const from = src[t] || {};
    const to = out.tracks[t];
    to.volume     = from.volume == null ? null : Math.max(0, Math.min(1.5, +from.volume || 0));
    to.speed      = from.speed == null ? null : Math.max(0.25, Math.min(2, +from.speed || 1));
    to.transition = orNull(from.transition);
    to.animation  = orNull(from.animation);
    to.filter     = orNull(from.filter);

    // Subtitles are clips too, and they have no video: their content IS their text, which
    // lives in `name` like every other clip's caption. So the "must have a source" rule
    // that keeps junk off the video tracks has to make room for them.
    const clips = Array.isArray(from.clips) ? from.clips : [];
    to.clips = clips.filter(c => c && c.id && (c.src || (t === 'subs' && c.name))).map(c => ({
      id:      String(c.id),
      src:     c.src ? String(c.src) : null,
      thumb:   c.thumb ? String(c.thumb) : null,
      name:    String(c.name || '').slice(0, 200),
      libId:   c.libId ? String(c.libId) : null,
      start:   Math.max(0, num(c.start, 0)),
      dur:     Math.max(0.1, num(c.dur, 1)),
      srcDur:  Math.max(0, num(c.srcDur, 0)),
      trimIn:  Math.max(0, num(c.trimIn, 0)),
      trimOut: Math.max(0, num(c.trimOut, 0)),
      speed:   Math.max(0.25, Math.min(2, num(c.speed, 1))),
      volume:  c.volume == null ? null : Math.max(0, Math.min(1.5, +c.volume || 0)),
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
      // A PiP rect has to stay mostly on the frame to be findable. A SUBTITLE's tx/ty is an
      // offset from the style's anchor, so it is signed and may take the caption off the
      // edge - which is a real thing to want while composing.
      tx: c.tx == null ? null : (t === 'subs' ? Math.max(-1, Math.min(1, +c.tx || 0)) : Math.max(0, Math.min(0.98, +c.tx || 0))),
      ty: c.ty == null ? null : (t === 'subs' ? Math.max(-1, Math.min(1, +c.ty || 0)) : Math.max(0, Math.min(0.98, +c.ty || 0))),
      tw: c.tw == null ? null : Math.max(0.04, Math.min(1, +c.tw || 1)),
      // Free rotation, set by dragging the handle on the preview. Separate from the
      // halfer's `rotation` on purpose: that one is quarter turns with band semantics,
      // this one is any angle applied to the placed rectangle.
      angle: c.angle == null ? null : Math.max(-180, Math.min(180, +c.angle || 0)),
      // Halfer bands only.
      halferAlign: ['top', 'bottom'].includes(c.halferAlign) ? c.halferAlign : null,
      rotation: [0, 90, 180, 270].includes(+c.rotation) ? +c.rotation : null,
      valign: ['top', 'bottom'].includes(c.valign) ? c.valign : null,
      // Per-word timings for karaoke, RELATIVE to the clip's own start. Relative and not
      // absolute so that dragging a caption along the lane keeps its highlight in step -
      // absolute offsets would need rewriting on every move, and one missed rewrite is a
      // caption whose highlight runs ahead of the voice.
      words: (t === 'subs' && Array.isArray(c.words))
        ? c.words.slice(0, 200)
            .filter(w => w && w.w != null)
            .map(w => ({ w: String(w.w).slice(0, 60), s: Math.max(0, num(w.s, 0)), e: Math.max(0, num(w.e, 0)) }))
        : null,
    }));

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

// The picker's list. Newest first, so an imported project is at the top.
router.get('/mv3/timelines', (_req, res) => {
  try {
    const s = _read();
    const list = Object.keys(s.timelines).map(key => {
      const t = s.timelines[key];
      let clips = 0;
      for (const k of TRACKS) clips += ((t.tracks && t.tracks[k] && t.tracks[k].clips) || []).length;
      return { key, title: t.title || 'Untitled', createdAt: t.createdAt || null, updatedAt: t.updatedAt || null, clips };
    }).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    res.json({ success: true, version: s.version, list, open: _newestKey(s.timelines) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/mv3/timeline', (req, res) => {
  try {
    const s = _read();
    // No key, or one that is not there: hand back the most recently touched project. A 404
    // would make the page's first load depend on it already knowing what exists.
    let key = String(req.query.key || '');
    if (!key || !s.timelines[key]) key = _newestKey(s.timelines) || LOCAL_KEY;
    const t = s.timelines[key];
    res.json({
      success: true, version: s.version, key,
      title: t ? t.title : 'Untitled',
      adv: t ? (t.adv || null) : null,
      timeline: t ? { tracks: t.tracks } : _emptyTimeline(),
    });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// The shape of nothing. Entering Merge without a project shows an empty timeline and waits
// for one to be chosen, and the page needs the same track shape the real ones have - built
// here rather than client-side so there is one definition of it.
router.get('/mv3/blank', (_req, res) => {
  try { res.json({ success: true, timeline: _emptyTimeline() }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Cheap enough to poll. Kept separate so watching for someone else's change does not
// pull the whole timeline every few seconds.
router.get('/mv3/timeline/version', (_req, res) => {
  try { res.json({ success: true, version: _read().version }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.put('/mv3/timeline', (req, res) => {
  try {
    const cur = _read();
    const claimed = Number((req.body || {}).version);
    if (!Number.isFinite(claimed)) {
      return res.status(400).json({ success: false, error: 'version is required - a write that does not say what it replaces cannot be checked' });
    }
    const key = String((req.body || {}).key || '').trim() || _newestKey(cur.timelines) || LOCAL_KEY;
    // The refusal that makes this store different. Sending back the current state of the
    // SAME project as well, so the caller can reconcile in one round trip instead of two.
    if (claimed !== cur.version) {
      const t = cur.timelines[key];
      return res.status(409).json({
        success: false, error: 'stale version', expected: cur.version, got: claimed,
        version: cur.version, key,
        timeline: t ? { tracks: t.tracks } : _emptyTimeline(),
      });
    }
    const now = new Date().toISOString();
    const prev = cur.timelines[key];
    cur.timelines[key] = {
      title: prev ? prev.title : 'Untitled',
      createdAt: prev ? (prev.createdAt || now) : now,
      updatedAt: now,
      adv: prev ? (prev.adv || null) : null,
      tracks: _sanitize((req.body || {}).timeline).tracks,
    };
    const next = { version: cur.version + 1, updatedAt: now, timelines: cur.timelines, hidden: cur.hidden, snapshots: cur.snapshots };
    _write(next);
    // The STORED tracks go back, not just the version. _sanitize normalises as it writes -
    // a missing field becomes an explicit null, rotation null becomes 0 - so what the caller
    // sent and what is now here are not byte-identical. The caller needs the stored shape to
    // compare against later: a merge that measures "what did I change" against the version it
    // sent would count the normalising itself as a change.
    res.json({ success: true, version: next.version, updatedAt: now, key, tracks: cur.timelines[key].tracks });
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
    t.adv = (b.adv && typeof b.adv === 'object') ? b.adv : null;
    t.updatedAt = new Date().toISOString();
    _write({ version: cur.version + 1, updatedAt: t.updatedAt, timelines: cur.timelines, hidden: cur.hidden, snapshots: cur.snapshots });
    res.json({ success: true, version: cur.version + 1 });
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

router.get('/mv3/overlays', (_req, res) => {
  try {
    const cur = _read();
    const hidden = new Set(Array.isArray(cur.hidden) ? cur.hidden : []);
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
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    res.json({ success: true, list });
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

router.post('/mv3/render/keep', async (req, res) => {
  try {
    const b = req.body || {};
    const abs = _finalPath(b.url);
    if (!abs || !fs.existsSync(abs)) return res.status(404).json({ success: false, error: 'no such render' });

    // A poster frame, so the renders shelf shows cards rather than grey boxes.
    let thumb = null;
    try { thumb = await makeThumb('/finals/' + path.basename(abs)); }
    catch (e) { /* a missing poster is not a reason to lose the render */ }

    // Keeping a render used to freeze the overlay arrangement as a side effect. A snapshot
    // OUTRANKS the live timeline, so every render quietly pinned what other projects would
    // pull from this one, and later edits stopped reaching them - a decision nobody made,
    // discovered long afterwards. Pinning is now an explicit act: the Overlays panel has a
    // Save. Keeping a render keeps a render.
    res.json({ success: true, thumb: thumb || null, frozen: false });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/mv3/render/discard', (req, res) => {
  try {
    const abs = _finalPath((req.body || {}).url);
    if (!abs) return res.status(400).json({ success: false, error: 'not a render path' });
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
    // Its poster too, if one was made.
    try {
      const turl = thumbUrlFor('/finals/' + path.basename(abs));
      const tabs = path.join(__dirname, '..', String(turl).replace(/^\/+/, ''));
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
    if (!title) return res.status(400).json({ success: false, error: 'a title is required - projects cannot be renamed later' });
    if (title.length > 120) return res.status(400).json({ success: false, error: 'title is too long (120 max)' });

    const cur = _read();
    // The stamp is unique in practice; the loop is for the case it is not (two clicks inside one
    // millisecond, or a clock that went backwards) so a new project can never land on top of an
    // existing timeline.
    let key = 'mv3_' + Date.now();
    for (let n = 1; cur.timelines[key]; n++) key = 'mv3_' + Date.now() + '_' + n;

    const now = new Date().toISOString();
    cur.timelines[key] = {
      title,
      createdAt: now,
      updatedAt: now,
      adv: null,
      tracks: _emptyTimeline().tracks,
    };
    const version = cur.version + 1;
    _write({ version, updatedAt: now, timelines: cur.timelines, hidden: cur.hidden, snapshots: cur.snapshots });
    res.json({ success: true, key, version, title });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.delete('/mv3/timeline/:key', (req, res) => {
  try {
    const key = String(req.params.key || '');
    const cur = _read();
    if (!cur.timelines[key]) return res.status(404).json({ success: false, error: `no project "${key}"` });
    delete cur.timelines[key];
    const now = new Date().toISOString();
    _write({ version: cur.version + 1, updatedAt: now, timelines: cur.timelines, hidden: cur.hidden, snapshots: cur.snapshots });
    res.json({ success: true, version: cur.version + 1, open: _newestKey(cur.timelines) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

/* ── Import a Scenarios cut into the Main track ──────────────────────────────
   POST /api/mv3/import/scen3 { projectId } -> { success, key, fragments }

   THE LENGTH COMES FROM THE AUDIO, not the video. A generated fragment's video runs past
   the end of the speech and what it does there is hallucination - a face still moving
   with nothing to say. So each clip is as long as its voice track and the tail of the
   video is trimmed off. Measured on real data: a line with 6.53s of audio had a 7.20s
   clip, so 0.67s of it was invention.

   Only the Main track is written. Everything already on Birols, Hooks, Halfers and Music
   stays exactly where it is, at the same seconds - a re-import after regenerating one
   fragment must not throw away the overlays placed by hand. On a first import there is
   nothing on those tracks anyway, so a fresh project arrives with Main alone.
   ──────────────────────────────────────────────────────────────────────────── */
const SCEN3 = require('./scen3');

router.post('/mv3/import/scen3', (req, res) => {
  try {
    const id = String((req.body || {}).projectId || '').trim();
    if (!id) return res.status(400).json({ success: false, error: 'projectId is required' });
    const p = (SCEN3.loadProjects() || []).find(x => String(x.id) === id);
    if (!p) return res.status(404).json({ success: false, error: `no scenarios project "${id}"` });

    const { variant, cut } = SCEN3.cutClips(p);
    if (!cut.length) return res.status(400).json({ success: false, error: 'nothing to import - no fresh clips in that project' });

    const clips = [];
    let at = 0;
    for (const it of cut) {
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
        reversed: false,
        transition: null, animation: null, filter: null,
        cropAlign: null, tx: null, ty: null, tw: null, angle: null,
        halferAlign: null, rotation: null, valign: null,
      });
      at += dur;
    }

    const cur = _read();
    const key = 'sv3_' + id;
    const now = new Date().toISOString();
    const prev = cur.timelines[key];
    const tracks = prev ? prev.tracks : _emptyTimeline().tracks;
    tracks.seg = Object.assign(_emptyTimeline().tracks.seg, prev ? prev.tracks.seg : {}, { clips });
    cur.timelines[key] = {
      title: `${now.slice(0, 10)} - ${String(p.title || '').trim() || 'talking head'}`,
      createdAt: prev ? (prev.createdAt || now) : now,
      updatedAt: now,
      adv: prev ? (prev.adv || null) : null,
      tracks,
    };
    _write({ version: cur.version + 1, updatedAt: now, timelines: cur.timelines, hidden: cur.hidden, snapshots: cur.snapshots });
    res.json({ success: true, key, fragments: clips.length, variant });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

module.exports = router;
