'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   THE SHAPE OF A TIMELINE - what a project's lanes and clips may hold, and the empty project.

   Moved here from routes/mergev3.js (phase K1, 2026-10-03) unchanged: the save route stores what
   _sanitizeBlank returns, and the server now lays captions itself (lib/captions-job.js) - what it
   lays has to be stored in the same shape as what a page saves, and a lib does not require a route.
   ═══════════════════════════════════════════════════════════════════════════ */

// The caption style - its fields, defaults and limits - is ONE module the page shares (phase K0):
// public/js/captions/style.js, through lib/mv3b-subs.js.
const CAP = require('./mv3b-subs');
const FRAMING = require('../public/js/framing/path.js');

// The kind every project has. Stored on each so a library from before the one editor - whose
// projects had none - is told apart by lib/timeline-convert.js, which is what rewrites them.
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
      Object.assign(lane('subs', 'subs', 'Subtitles', null, true), { style: CAP.normalizeStyle({}) }),
    ],
  };
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


// One clip, rebuilt from a fixed shape. A field missing from this list is DROPPED on the next
// save, so anything that has to survive a reload is named here. `isSubs` is passed in rather
// than worked out: a subtitle is a clip with no source, whose text is its content and whose
// tx/ty are signed offsets from the style's anchor instead of a rectangle on the frame.
// A band percentage: a real number inside its range, or the default when there is none. Null
// is not a legal answer here the way it is for a PiP rect - a band always has a position, a
// thickness and a slice, even when nobody has touched them.
// NULL IS MISSING, not zero: Number(null) is 0, which read an explicit null as "against the bottom".
const _band = (v, dflt, lo = 0) => {
  const n = Number(v);
  return (v != null && Number.isFinite(n)) ? Math.max(lo, Math.min(100, n)) : dflt;
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
      // WHOSE CELL THIS IS (phase T'). A number is the line of the scenario project this cell
      // mirrors: the workshop lays those itself and takes them away again (lib/frag-mirror.js).
      // null is the person's own - dropped from the library, trimmed, moved - and nothing but
      // their own hand ever touches it. Without this field surviving the normaliser the mirror
      // could not tell the two apart, and would either overwrite somebody's work or grow a
      // second copy of the script every time it ran.
      frag:    Number.isFinite(+c.frag) && +c.frag > 0 ? Math.round(+c.frag) : null,
      // 400, the panel's own limit for a caption's text - at 200 the rest was lost on save.
      name:    String(c.name || '').slice(0, 400),
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
      // Null stays null - the band's default turn. +null is 0, which is on the list, so every
      // clip that came back with no rotation left its second save turned upright.
      rotation: (c.rotation != null && [0, 90, 180, 270].includes(+c.rotation)) ? +c.rotation : null,
      // Per-word timings, RELATIVE to the clip's own start, so dragging a caption along the lane keeps
      // its words in step. {w, s, e} and `k` for a word marked to stand out (public/js/captions/style.js).
      words: isSubs ? CAP.normalizeWords(c.words) : null,
  };
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
                               fit: c.fit === 'fill' ? 'fill' : null,
                               // Music laid under the rest (public/js/merge-v3/music.js): what
                               // captions made from the sound leave out.
                               bed: c.bed ? true : null,
                               // (phase V34.E) A sound effect from SFX: never transcribed either (the owner's (з7)).
                               sfx: c.sfx ? true : null,
                               // (phase V23) A sound's own fades in seconds - the two variants of one
                               // Suno generation cross into each other with them (lib/mv3b-render.js).
                               fadeIn: (+c.fadeIn > 0) ? Math.min(30, +c.fadeIn) : null,
                               fadeOut: (+c.fadeOut > 0) ? Math.min(30, +c.fadeOut) : null,
                               // A halfer band (lib/mv3b-render.js). Its numbers - halferPos,
                               // halferThick, halferKeep, rotation - are _clipOf's already; the
                               // switch is here because every clip carries those numbers.
                               halfer: c.halfer ? true : null,
                               // The five answers the blank panel offers for a filled clip.
                               // _clipOf keeps the talking-head editor's three, and top and
                               // bottom came back from a save as nothing.
                               cropAlign: ['left', 'center', 'right', 'top', 'bottom'].includes(c.cropAlign) ? c.cropAlign : null,
                               // (phase V33.2) A filled clip's window over time - following the face, the whole frame over its
                               // blur, two bands (public/js/framing/path.js). Kept whatever the fit, so a clip put back to
                               // `fill` frames as it did; absent on a clip that has none.
                               ...(kind === 'video' && FRAMING.normalize(c.frame) ? { frame: FRAMING.normalize(c.frame) } : {}),
                               // A caption's OWN style (phase K0, the owner 2026-10-03): only what it
                               // sets over its lane's; absent when it sets nothing.
                               ...(isWords ? { style: CAP.normalizeOverride(c.style) || undefined } : {}),
                               // (phase V30, block 1) What a talking head's line SAYS - the address of its sound - on the
                               // mirror's sound cell and on the captions heard from it (lib/frag-mirror.js cellsOf): how a
                               // page finds its line when the cut is laid again. Absent everywhere else.
                               ...((kind === 'audio' || isSubs) && c.voice ? { voice: String(c.voice).slice(0, 600) } : {}) })),
    };
    // The words lanes' look, every field valid and nothing unknown (public/js/captions/style.js).
    if (isWords) row.style = CAP.normalizeStyle(t.style);
    // How the subtitle lane is listened to (phase K1): on Groq or on this computer - the language is always detected
    // (phase V29). On the lane and not in its style, which a preset copies wholesale.
    if (isSubs) row.listen = CAP.HEARD.listenOf(t);
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

module.exports = { BLANK_KIND, VOL_MAX, emptyBlank: _emptyBlank, sanitizeBlank: _sanitizeBlank };
