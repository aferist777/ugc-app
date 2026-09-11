/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — the inspector. Phase I1: the frame and the facts.

   Three states, and which one is showing is decided entirely by the selection:

     nothing        how to work the editor
     a track        what applies to the whole track, and to how many clips
     a clip         that clip's own numbers

   The controls themselves land in the next phases. What is here already is every
   read-only fact, because those are derivable today and a panel that shows real
   numbers is checkable in a way an empty box is not.

   ONE THING WORTH KNOWING BEFORE THE CONTROLS ARRIVE. Track settings will be a
   STAMP, not an inherited default: choosing a value on a track writes it into every
   clip on that track, overwriting whatever each clip had. That is what was asked
   for, it is what the old editor did, and it destroys per-clip work in one click -
   which is why the two history buttons in the timeline header were built first and
   why the count below says out loud how many clips a track setting would rewrite.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as Store from './store.js';
import { onSelect, selected, clearSelection, setClipDur, removeClip as cutClip,
         multiCount as multiA, deleteMulti as deleteMultiA } from './timeline.js';
import { multiCount as multiB, deleteMulti as deleteMultiB, isMounted as blankMounted,
         onSelChange as onSelB, selectedOne as oneB, setClipField as setB,
         removeClip as removeB, mateOf as mateB, selectedTrack as trackB,
         setClipFields as setManyB,
         setTrackField as setTB, removeTrack as removeTrackB, playhead as playheadB,
         stampTrack as stampB, resetTrack as resetTrackB,
         addCaption as addCapB, setCaptions as setCapsB, setCaptionText as setCapTextB,
         setSubsStyle as setSubsStyleB } from './timeline-b.js';
import { styleOf, subsTrack as subsTrackB, segmentsFor, groupWords, autoSize,
         autoWordsPerLine, regroup, wordsOf } from './subs-b.js';
import { askDelete } from './ask.js';
import { isStill } from './store.js';
import { openAnimate } from './animate.js';
import * as C from './controls.js';
import * as M from './music.js';
import * as Subs from './subtitles.js';

// Which tracks will take effects at all. Halfers is not an omission: the renderer
// ignores effects on halfer bands, so offering them would be a control that does
// nothing. Music and Subtitles get their own panels later.
const FX_TRACKS = new Set(['seg', 'biro', 'hook']);

function _host() { return document.querySelector('#mv3-inspector .mv3-panel-body'); }

function _el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// `right` is for a panel whose one action belongs beside the name rather than buried under
// the settings for it - the Subtitles track's Generate is the case.
function _title(text, sub, right) {
  const wrap = _el('div', 'mv3-ins-head');
  const txt = _el('div', 'mv3-ins-head-txt');
  txt.appendChild(_el('div', 'mv3-ins-title', text));
  if (sub) txt.appendChild(_el('div', 'mv3-ins-sub', sub));
  wrap.appendChild(txt);
  if (right) {
    const act = _el('div', 'mv3-ins-head-act');
    act.appendChild(right);
    wrap.appendChild(act);
  }
  return wrap;
}

// A read-only fact. The controls will replace some of these in the next phases; the
// ones that stay are the ones there is nothing to set.
function _fact(k, v) {
  const row = _el('div', 'mv3-ins-row');
  row.appendChild(_el('span', 'mv3-ins-k', k));
  row.appendChild(_el('span', 'mv3-ins-v', v));
  return row;
}

// The three effect pickers side by side rather than three labelled rows: they are one
// decision about how a clip looks, they are asked in the same words on every panel, and
// three full rows cost a third of the panel's height. The labels shrink to a caption over
// each one.
// `skipAnim` drops the middle one. A placed insert is not zoomed: zoompan re-bakes its output
// to the frame size, which would throw the insert back to full screen - so the graph skips it,
// and a select the file ignores is worse than one that is not there.
function _fxTriple(tr, an, fi, onTr, onAn, onFi, skipAnim) {
  const wrap = _el('div', 'mv3-ins-fx3');
  const cell = (label, opts, value, onChange) => {
    const box = _el('div', 'mv3-ins-fx3-cell');
    box.appendChild(_el('span', 'mv3-ins-fx3-lbl', label));
    const sel = C.select(opts, value, onChange);
    sel.title = label;
    box.appendChild(sel);
    return box;
  };
  wrap.appendChild(cell('transition', C.TRANSITIONS, tr, onTr));
  if (!skipAnim) wrap.appendChild(cell('animation', C.ANIMATIONS, an, onAn));
  wrap.appendChild(cell('filter', C.FILTERS, fi, onFi));
  return wrap;
}

function _todo(items) {
  const box = _el('div', 'mv3-ins-todo');
  box.appendChild(_el('div', 'mv3-ins-todo-h', 'Controls landing here'));
  const ul = _el('ul');
  for (const it of items) ul.appendChild(_el('li', null, it));
  box.appendChild(ul);
  return box;
}

const _sec = (t) => (Math.round(t * 100) / 100).toFixed(2) + 's';
const _r2 = (v) => Math.round(v * 100) / 100;
const MIN_DUR = 0.1;

// ── Writing a track setting ─────────────────────────────────────────────────
// THE STAMP. The value is remembered on the track AND written into every clip on it.
// Two things about this, both deliberate:
//
//   • it touches ONLY this track's clips. The old editor's stamp looped over birols
//     AND hooks together, so choosing a transition on Birols silently rewrote the
//     hook clips as well;
//   • it is irreversible per clip - whatever each clip had is gone. That is what the
//     stamp means, it is what was asked for, and it is why Store.mutate takes a history
//     snapshot first: the undo arrow is the way back.
function _stamp(scope, field, value) {
  Store.mutate(tl => {
    const tr = tl.tracks[scope];
    if (!tr) return;
    tr[field] = value;
    for (const c of tr.clips) c[field] = value;
  });
}

// A track-level value that is NOT stamped: the effective volume is clip ?? track ?? 1,
// so the track is a real fallback here and a per-clip volume keeps overriding it. That
// is how the old editor behaved for volume alone, and it is the better shape - kept
// rather than "fixed" into a stamp for consistency's sake.
function _setTrackOnly(scope, field, value) {
  Store.mutate(tl => {
    const tr = tl.tracks[scope];
    if (tr) tr[field] = value;
  });
}

// ── Speed ───────────────────────────────────────────────────────────────────
// "Same content, faster = shorter": the source segment in play is [trimIn, srcDur -
// trimOut] and speed only changes how long it takes. So dur is re-derived and the trims
// stay put.
//
// Unless the neighbour is in the way. Slowing a clip down needs more room on the
// timeline, and there may not be any - in that case the length stops at the gap and the
// tail is trimmed instead, because pushing the next clip along would move work the user
// placed by hand.
function _applySpeed(c, nextStart, speed) {
  const src = +c.srcDur || 0;
  const segLen = src > 0
    ? Math.max(0, src - (+c.trimIn || 0) - (+c.trimOut || 0))
    : (+c.dur || 0) * (+c.speed || 1);
  const natural = segLen > 0 ? (segLen / speed) : (+c.dur || 0);
  const room = (nextStart === Infinity) ? Infinity : (nextStart - c.start);
  const dur = Math.max(MIN_DUR, Math.min(natural, room));
  c.speed = speed;
  c.dur = _r2(dur);
  // Only a CLAMPED clip needs its out-point moved - it is showing less of the source than it
  // asked for. An unclamped one already spans exactly the slice it had, and recomputing the
  // trim from a duration that has just been rounded shaves a hundredth off the tail on every
  // single change, which accumulates into a visibly cut fragment.
  if (src > 0 && dur < natural - 0.001) {
    c.trimOut = Math.max(0, _r2(src - (+c.trimIn || 0) - c.dur * speed));
  }
}

// ── Re-timing the spine: GONE WITH MAIN'S SPEED ─────────────────────────────
// _stampSpeed, _retimeSpine, _repack, _timeMapper and _remapPinned lived here. All five
// existed to keep the spine end to end after a Main fragment changed length, and to drag
// every pinned overlay, caption and word timing along with it. Nothing changes a Main
// fragment's length that way any more, so all five were unreachable.
//
// Deleted rather than left dormant: what they did was rewrite five tracks and every word
// timing in one go, and code that destructive should not be sitting one call away from
// being used again by accident. Git has it if Main ever gets a speed back.

// ── Writing one clip ────────────────────────────────────────────────────────
function _patchClip(scope, id, patch) {
  Store.mutate(tl => {
    const tr = tl.tracks[scope];
    const c = tr && tr.clips.find(x => x.id === id);
    if (c) Object.assign(c, patch);
  });
}

// The nearest clip start after this one, which is how far it may grow.
function _nextStartFor(clips, c) {
  let next = Infinity;
  const ce = (+c.start) + (+c.dur);
  for (const o of clips) {
    if (o.id === c.id) continue;
    const s = +o.start;
    if (s >= ce - 0.001 && s < next) next = s;
  }
  return next;
}

// Overlay lanes only - Main has no speed control any more. There is no spine to close up
// here: a clip sits at the moment it was put, and its neighbour is the limit on how far it
// may grow.
function _setClipSpeed(scope, id, speed) {
  Store.mutate(tl => {
    const tr = tl.tracks[scope];
    const c = tr && tr.clips.find(x => x.id === id);
    if (!c) return;
    _applySpeed(c, _nextStartFor(tr.clips, c), speed);
  });
}

function _removeClip(scope, id) {
  // Deselect first: leaving the selection pointing at a clip that no longer exists would
  // leave the panel on its "clip is gone" state instead of returning to the help.
  clearSelection();
  // The timeline owns what removing a clip MEANS - on Main that includes closing the gap
  // behind it and everything pinned to the picture sliding with it.
  cutClip(scope, id);
}

// Clears the track's OWN settings and the fields the stamp writes. It deliberately does
// NOT touch speed, trims or positions: those are edits made by hand with the mouse, and
// wiping them from a button called "reset track" would be exactly the kind of surprise
// the stamp warning above exists to prevent.
function _resetTrack(scope) {
  Store.mutate(tl => {
    const tr = tl.tracks[scope];
    if (!tr) return;
    for (const f of ['volume', 'transition', 'animation', 'filter']) tr[f] = null;
    for (const c of tr.clips) {
      for (const f of ['transition', 'animation', 'filter']) c[f] = null;
    }
  });
}

// ── Nothing selected ────────────────────────────────────────────────────────
// Not a manual. Dragging, trimming, zooming and undo are what every editor does and what
// anyone opening this already knows - listing them spent the panel on the reader's existing
// knowledge. What is here instead is the handful of things this editor does that another
// one does not, and the parts of those that cannot be guessed by looking: what a run costs,
// what is kept, what is only a hint.
function _renderIdle(host) {
  host.appendChild(_title('Nothing selected', 'What this editor can do'));
  const help = _el('div', 'mv3-ins-help');

  const block = (heading, lines) => {
    help.appendChild(_el('div', 'mv3-ins-todo-h', heading));
    const ul = _el('ul');
    for (const s of lines) ul.appendChild(_el('li', null, s));
    help.appendChild(ul);
  };

  block('Turn a picture into a clip', [
    'Drop a still on a track, write a sentence about how it should move, choose a length.',
    'Runs collect in a strip along the bottom. Only the ones you tick reach the library - '
      + 'making four and keeping one is the normal shape of this.',
    'The picture is not used up. You get a new birol beside it, tied to the frame it grew from.',
  ]);

  block('Motion control', [
    'Some models take a second input: a clip whose movement is copied. The person in your '
      + 'picture does what the person in the clip does.',
    'Pick the stretch first, with the two handles. It keeps playing while the generation runs.',
    'These are the only models sold by the second, so the price appears once there is a '
      + 'stretch to multiply by.',
  ]);

  block('Subtitles from what was said', [
    'Generated from the Main track, word by word - the karaoke uses the times the words were '
      + 'actually spoken, not a guess from how long each line is.',
    'Drag the track to move them all; drag one caption to move only that one.',
  ]);

  block('Music to a length', [
    'The style is prose, not a form: the chips are the prompt.',
    'BPM is a strong hint rather than a setting - a track can come back near it, not on it.',
  ]);

  // One line of the ordinary kept, because it is the only ordinary thing here that destroys
  // work: a track setting is not a default that clips inherit.
  const note = _el('div', 'mv3-ins-note',
    'Track settings are a stamp: choosing one overwrites that value on every clip in the track.');
  help.appendChild(note);

  host.appendChild(help);
}

// Soft edges. Only ever offered to a PLACED insert: a clip covering the whole frame has no
// edge of its own to dissolve - the only edges it has are the frame's, and fading those
// would be a vignette, which is a different control that already exists as a filter.
//
// A fraction of the insert's shorter side rather than pixels, so the number means the same
// thing on the preview canvas and in the render, which are different sizes.
function _featherRow(c, set) {
  return C.row('Soft edge', C.slider({
    min: 0, max: 0.4, step: 0.01, value: +c.feather || 0,
    fmt: (v) => (v <= 0.005 ? 'hard' : Math.round(v * 100) + '%'),
    onChange: (v) => set({ feather: v <= 0.005 ? null : v }),
  }));
}

// ── A track ─────────────────────────────────────────────────────────────────
function _renderTrack(host, scope) {
  const t = Store.timeline();
  const track = t && t.tracks && t.tracks[scope];

  // Music has its own panel and never had a header. The destination is stated rather than
  // assumed: a blank project's panel points the same module at one of ITS lanes, and a stale
  // pointer would put this project's music somewhere else entirely.
  if (scope === 'music') { M.setMusicDest(null); M.renderMusicTrack(host, track); return; }

  // No header. It restated the track you had just clicked and the length you can read off
  // the timeline, over the one column that is short of room.
  const sep = () => host.appendChild(_el('div', 'mv3-c-sep'));

  // Everything about how captions look belongs to this track, so this is where it lives.
  // Generate used to ride in the header; with that gone it takes a row of its own.
  if (scope === 'subs') {
    host.appendChild(Subs.genRow());
    sep();
    Subs.renderSubsTrack(host);
    return;
  }

  // Main: one speed for every segment. Not offered on the insert tracks, where speed is
  // a per-clip decision (an insert is placed at a moment, not part of a spine).
  // NO SPEED ON MAIN, neither here nor on its clips. Retiming the spine stretches the read
  // away from the voice it was transcribed against, so the subtitles come out against
  // timings that no longer exist - and Main is the one track that carries the voice.
  //
  // The whole video's pace is set at the other end instead: Export has a playback speed
  // that runs over the finished file, after the captions are burnt in. Same result, and it
  // cannot desynchronise anything.

  // There is no audio on/off beside this. It used to be here and it fought the slider:
  // the flag defaulted to off for every overlay track, so raising the volume produced a
  // stored number and no sound. Volume alone now - 0 is silent.
  const volDflt = scope === 'seg' ? 1 : 0;
  host.appendChild(C.row('Volume', C.volume(
    track.volume != null ? track.volume : volDflt,
    (v) => _setTrackOnly(scope, 'volume', v),
  )));
  host.appendChild(C.hint('Master for this track: every clip on it is multiplied by this. '
    + '0 dB leaves them exactly as each one is set.'));

  if (FX_TRACKS.has(scope)) {
    sep();
    host.appendChild(_fxTriple(
      track.transition || 'none', track.animation || 'none', track.filter || 'none',
      (v) => _stamp(scope, 'transition', v), (v) => _stamp(scope, 'animation', v), (v) => _stamp(scope, 'filter', v),
    ));
    host.appendChild(C.hint('Choosing one of these writes it into every clip on the track.'));
  } else if (scope === 'halfer') {
    host.appendChild(C.hint('No transition, animation or filter: the renderer ignores effects on halfer bands.'));
  }

  sep();
  host.appendChild(C.row('', C.button('Reset track', () => _resetTrack(scope), {
    title: 'Clears this track\'s volume and effects, and the same fields on its clips. Speed, trims and positions are left alone.',
  })));

  // Named rather than quietly missing, so the gap is visible.
  host.appendChild(_todo([
    'SFX and its volume - its list comes from the old editor\'s audio library, and it only sounds at export',
    'Nothing renders these settings yet: there is no preview and no export in merge-v3',
  ]));
}

// ── A clip ──────────────────────────────────────────────────────────────────
// Where a picture lands when it is placed by one click rather than dragged: a little in
// from the top-left corner, at just over a third of the width. Small enough to read as an
// inset over the frame, big enough to see - and the drag handles take over from there.
const PIP_DROP = { tx: 0.05, ty: 0.05, tw: 0.38 };

function _renderStillClip(host, scope, id, c, set) {
  // TWO COLUMNS ACROSS THE TOP. The picture takes half the panel - enough to recognise
  // what this clip is, which is the question a still's inspector mostly answers - and the
  // settings that belong to it sit in the other half rather than under it, where the
  // picture would have pushed them off the fold.
  const top = _el('div', 'mv3-c-still-top');
  const left = _el('div', 'mv3-c-still-left');
  const fig = _el('div', 'mv3-c-still');
  if (c.thumb) {
    const img = document.createElement('img');
    img.src = c.thumb;
    img.alt = c.name || '';
    fig.appendChild(img);
  }
  left.appendChild(fig);
  // Directly under the picture it acts on, and centred: this is the one thing here that
  // makes something NEW rather than adjusting the clip, so it stands apart from the grid of
  // settings instead of queueing at the bottom of it.
  const animate = C.button('Animate', () => openAnimate(c), {
    title: 'Generate a video from this picture. It lands in Birols; the picture stays where it is.',
  });
  animate.classList.add('mv3-c-animate');
  left.appendChild(animate);
  top.appendChild(left);

  // Two across, filled row by row:
  //
  //     transition | animation
  //     filter     | placement          (Place as inset, or Full frame once it is placed)
  //     duration   | crop
  //     remove     |
  //
  // A labelled cell rather than a label-and-control row, because at a quarter of the
  // panel's width a label beside its control leaves no room for the control.
  const grid = _el('div', 'mv3-c-still-grid');
  const cell = (label, control) => {
    const box = _el('div', 'mv3-ins-fx3-cell');
    box.appendChild(_el('span', 'mv3-ins-fx3-lbl', label));
    if (control) { control.title = control.title || label; box.appendChild(control); }
    grid.appendChild(box);
    return box;
  };
  // An empty cell rather than none, so the grid keeps its shape when a control does not
  // apply: Duration stays bottom-left whether or not this clip can be cropped, and the eye
  // learns where things are on a panel it opens all day.
  const gap = () => grid.appendChild(_el('div', 'mv3-ins-fx3-cell'));

  const placed = (c.tw != null || c.angle);
  const canCrop = scope !== 'seg' && scope !== 'halfer' && !placed;

  if (FX_TRACKS.has(scope)) {
    cell('transition', C.select(C.TRANSITIONS, c.transition || 'none', (v) => set({ transition: v })));
    cell('animation', C.select(C.ANIMATIONS, c.animation || 'none', (v) => set({ animation: v })));
    cell('filter', C.select(C.FILTERS, c.filter || 'none', (v) => set({ filter: v })));
  } else { gap(); gap(); gap(); }

  // Placement, beside filter. Only the overlay lanes can place a picture on the frame: in
  // the sequence it IS the frame, and in a band the geometry is the band's.
  if (scope === 'seg' || scope === 'halfer') { gap(); }
  else if (placed) {
    cell('placement', C.button('Full frame', () => set({ tx: null, ty: null, tw: null, angle: null }), {
      title: 'Drop the placement and cover the whole frame again' }));
  } else {
    // One click, because a picture laid over a shot is usually WANTED as an inset, and
    // dragging one out of a full-frame cover is a fiddly way to ask for that. Dragging
    // still works and still wins - this only sets a starting point.
    cell('placement', C.button('Place as inset', () => set(PIP_DROP), {
      title: 'Put the picture in the corner at about a third of the width, then drag it on the preview' }));
  }

  // The one number a still really has. It cannot be trimmed against a source - there is
  // none - so on Main this ripples the rest of the sequence exactly as dragging its edge
  // does; setClipDur owns that rule so the two cannot drift apart.
  cell('duration', C.number({
    value: +c.dur || 0, min: 0.1, max: 600, step: 0.5, suffix: 's',
    onChange: (v) => setClipDur(scope, id, v),
  }));

  // Under the placement it belongs to, because the two are one question: covering the frame
  // means a picture that is not 9:16 is cover-cropped, and which side survives is a choice.
  // Placed, the whole picture is on screen and there is nothing to crop away - so this cell
  // empties the moment the one above it says "Full frame".
  if (canCrop) {
    cell('crop', C.select([['left', 'left'], ['center', 'center'], ['right', 'right']],
      c.cropAlign || 'center', (v) => set({ cropAlign: v })));
  } else { gap(); }

  // Its own row, left column. Destructive, so it does not sit shoulder to shoulder with a
  // setting you might be reaching for. Just "Remove": the cell is a quarter of the panel
  // wide, and the tooltip carries what the long label used to say. The full-width button on
  // the video panel keeps its longer wording - it has the room.
  cell('', C.button('Remove', () => _removeClip(scope, id), {
    danger: true, title: 'Takes the picture off the timeline. The library keeps the file.',
  }));
  gap();

  const side = _el('div', 'mv3-c-still-side');
  side.appendChild(grid);
  top.appendChild(side);
  host.appendChild(top);

  // NOTHING BELOW THE TWO COLUMNS. Four hints used to sit here - what the effects apply to,
  // where the picture sits on the frame, what happens to a cut-out's transparency. Every one
  // of them described a state the panel already shows: the placement cell says "Full frame"
  // or "Place as inset", the transparency is visible through the chequerboard behind the
  // picture. They were paragraphs restating the controls above them, and on a panel this
  // small that is the difference between fitting and scrolling.
}

function _renderClip(host, scope, id) {
  const t = Store.timeline();
  const track = t && t.tracks && t.tracks[scope];
  const c = track && (track.clips || []).find(x => x.id === id);
  if (!c) {
    // The clip went away - deleted here, or by another tab whose version won.
    host.appendChild(_title('Clip is gone', 'It was removed from the timeline.'));
    return;
  }
  // No header. Which clip is selected is visible on the timeline, and its start, end and
  // length are readable off the ruler - two rows spent restating the thing you just clicked,
  // in the one column that is short of room.
  const sep = () => host.appendChild(_el('div', 'mv3-c-sep'));
  const set = (patch) => _patchClip(scope, id, patch);
  sep();

  // A caption is words: its own text and where it sits, nothing else. Speed, volume and
  // effects would all be settings with nothing to act on.
  if (scope === 'subs') { Subs.renderSubClip(host, c); return; }

  // A music clip is sound: no crop, no picture-in-picture, no visual effects.
  if (scope === 'music') {
    M.renderMusicClip(host, id, c,
      (v) => _setClipSpeed(scope, id, v),
      set,
      () => _removeClip(scope, id));
    return;
  }

  // A PICTURE, and the panel is chosen by WHAT THE CLIP IS rather than which lane it sits
  // on. Everything below this line assumes a film: speed retimes a source, volume is its
  // sound, reversed plays it backwards, and a trim picks a stretch out of it. A still has
  // none of those - it has one frame and a length the timeline gave it - so offering them
  // would be four controls that quietly do nothing.
  if (isStill(c)) { _renderStillClip(host, scope, id, c, set); return; }

  // Overlay lanes only - see the note on the track panel. A fragment of the read keeps the
  // length its voice gave it.
  if (scope !== 'seg') {
    host.appendChild(C.row('Speed', C.slider({
      min: 0.25, max: 2, step: 0.05, value: c.speed || 1, fmt: C.times,
      onChange: (v) => _setClipSpeed(scope, id, v),
    })));
  }

  // Volume is the whole of this clip's audio: muted is silent, and a clip dropped onto an
  // overlay track arrives muted. The track value is only a fallback for a clip that somehow
  // has none - every clip is created carrying its own.
  const volDflt = scope === 'seg' ? 1 : 0;
  const trackVol = track.volume != null ? track.volume : volDflt;
  // The clip's own level, in dB. Following the track was tried and taken out again: what it
  // bought was a master slider, and what it cost was reading a clip's level off its own
  // panel. Levels are set here, by hand, one clip at a time.
  host.appendChild(C.row('Volume', C.volume(
    c.volume != null ? c.volume : trackVol,
    (v) => set({ volume: v }),
  )));

  host.appendChild(C.row('Reversed', C.toggle(!!c.reversed, (on) => set({ reversed: on }))));

  sep();
  // A halfer is a BAND until it is dragged on the preview, and a rectangle afterwards. The
  // two have nothing in common: a band has an edge to stick to, a width it cannot choose and
  // a feather; a placed insert has none of those. So the panel shows one set or the other,
  // never both, and there is a way back.
  if (scope === 'halfer') {
    // Three numbers and a quarter turn. There is no second shape to switch into any more: a
    // halfer used to become a free-floating rectangle the moment it was dragged, which meant
    // every setting here had to be hidden while it wore the other form, and the two shapes
    // shared nothing but the clip they were made from.
    const num = (v, dflt) => { const n = Number(v); return Number.isFinite(n) ? n : dflt; };
    // The old words are the defaults, so a band saved before this opens exactly where it sat.
    const pos   = num(c.halferPos,   c.halferAlign === 'bottom' ? 0 : 100);
    const thick = num(c.halferThick, 40);
    const keep  = num(c.halferKeep,  c.valign === 'bottom' ? 0 : 100);
    const rot   = c.rotation == null ? 90 : +c.rotation;
    const sideways = (rot === 90 || rot === 270);

    host.appendChild(C.row('Band', C.slider({
      min: 0, max: 100, step: 1, value: pos,
      // The three positions worth naming say their name; everything between is a number.
      fmt: (v) => (v >= 99 ? 'top' : v <= 1 ? 'bottom' : v === 50 ? 'middle' : v + '%'),
      onChange: (v) => set({ halferPos: v }),
    })));
    host.appendChild(C.row('Thickness', C.slider({
      min: 5, max: 100, step: 1, value: thick,
      fmt: (v) => (v >= 100 ? 'full frame' : v + '%'),
      onChange: (v) => set({ halferThick: v }),
    })));
    host.appendChild(C.row('Rotation', C.select([[0, '0°'], [90, '90°'], [180, '180°'], [270, '270°']],
      String(rot), (v) => set({ rotation: +v }))));
    // The band is covered, not stretched, at every angle now, so there is always a slice to
    // choose. WHICH WAY it slides depends on the turn: at 0 and 180 the source stands upright
    // and the spare height is above and below it; at 90 and 270 it lies across the band and
    // the spare width is to the left and right.
    host.appendChild(C.row('Keep', C.slider({
      min: 0, max: 100, step: 1, value: keep,
      fmt: (v) => (v >= 99 ? (sideways ? 'right' : 'top')
                 : v <= 1 ? (sideways ? 'left' : 'bottom')
                 : v === 50 ? 'middle' : v + '%'),
      onChange: (v) => set({ halferKeep: v }),
    })));
    // Back where it belongs. A band's soft edge is not the all-round fade a placed insert
    // gets - it softens the edges facing INTO the frame, which is why it lives here and not
    // in _featherRow with the other one. Written as a number even at zero: null means
    // 'never set' and that is the one value which has to keep meaning the default.
    host.appendChild(C.row('Soft edge', C.slider({
      min: 0, max: 40, step: 1, value: c.feather == null ? 3 : Math.round(c.feather * 100),
      fmt: (v) => (v <= 0 ? 'hard' : v + '%'),
      onChange: (v) => set({ feather: v / 100 }),
    })));
    host.appendChild(C.hint('A band across the frame: where it sits, how thick it is, and which'
      + ' slice of the picture survives the crop. '
      + (sideways ? 'Turned on its side, so the slice slides left to right.'
                  : 'Upright, so the slice slides bottom to top.')));
  } else {
    // No crop on a Main fragment: it IS the frame, generated at 9:16 already, so there is
    // no wider source to choose a slice of. The control only means something for an
    // overlay laid over that frame.
    if (scope !== 'seg') {
      host.appendChild(C.row('Crop', C.select([['left', 'left'], ['center', 'center'], ['right', 'right']],
        c.cropAlign || 'center', (v) => set({ cropAlign: v }))));
    }

    // NO PiP FIELDS. Position, size and rotation are dragged on the preview: click the
    // element, then move it, pull a corner, or turn the handle above it. Typing
    // percentages to place a picture-in-picture was guessing at a thing already on screen.
    // "Full frame" stays here, because dragging back to exactly full is the one move the
    // mouse cannot make.
    if (c.tw != null || c.angle) {
      host.appendChild(_featherRow(c, set));
      host.appendChild(C.row('', C.button('Full frame', () => set({ tx: null, ty: null, tw: null, angle: null }), {
        title: 'Drop the placement and cover the whole frame again',
      })));
      host.appendChild(C.hint('Placed by hand on the preview' + (c.angle ? ' · turned ' + c.angle + '°' : '') + '.'));
    }
  }

  if (FX_TRACKS.has(scope)) {
    sep();
    host.appendChild(_fxTriple(
      c.transition || 'none', c.animation || 'none', c.filter || 'none',
      (v) => set({ transition: v }), (v) => set({ animation: v }), (v) => set({ filter: v }),
    ));
  }

  sep();
  host.appendChild(C.row('', C.button('Remove from timeline', () => _removeClip(scope, id), {
    danger: true, title: 'Takes the clip off the timeline. The library keeps the file.',
  })));
}

// NOT WHILE A CONTROL IS BEING HELD. The panel is rebuilt wholesale, so a repaint that
// lands mid-gesture replaces the very slider under the pointer with a new element - the
// drag then continues against a detached node. Observed, not theorised: a repaint
// triggered by a store change did exactly that during testing.
//
// Normally the sequence is safe (a slider writes on release, so the repaint follows the
// gesture), but a repaint can also come from outside - another tab's write being adopted,
// or a save status changing. So a held control defers the repaint until it is let go.
let _held = false;
let _pending = false;

// ── A clip in a blank project ─────────────────────────────────────────
// The same controls as the other workflow's panel, built from the same primitives in
// controls.js, so the two cannot drift into looking like different programs.
//
// CUT TO WHAT THIS RENDERER ACTUALLY READS. Every control here has its filter in
// lib/mv3b-render.js and its arithmetic in preview-b.js - speed, reverse, how a clip meets
// the frame, level. A control the export ignored would be worse than a missing one: the
// missing one is visible, and the ignored one is only discovered by watching the file.
//
// Deliberately NOT here yet: the transition/animation/filter triple. That is a whole effect
// engine, it lives in routes/ffmpeg.js for the other workflow, and this one has no copy of
// it. Next phase.
const _bsep = (host) => host.appendChild(_el('div', 'mv3-c-sep'));

const FITS = [['fit', 'Fit'], ['fill', 'Fill']];
// WHICH PART SURVIVES when a filled clip is cropped. Only ONE axis is ever cut - a source
// wider than the frame loses its sides, a taller one loses its top and bottom - so the five
// answers are one list rather than two controls, and whichever axis is not being cut ignores
// its own answer and stays centred.
const CROPS = [['left', 'left'], ['center', 'center'], ['right', 'right'],
               ['top', 'top'], ['bottom', 'bottom']];

// ── An insert on the frame ──────────────────────────────────────────────────
// PLACED BY HAND, ON THE PREVIEW. There is nothing here for where it sits, how big it is or
// which way up it is, and that is the point: putting a picture on a frame is a thing you do by
// looking at it, and typing 0.31 into a box is guessing at something already on screen. Click
// it, drag it, pull a corner, turn the knob.
//
// Two things are left to the panel. A soft edge, because it is a look rather than a place and
// the mouse has nothing to grab for it. And the way back to full frame, because dragging to
// EXACTLY the whole frame is the one move a mouse cannot make.
// PLACED IS `tw` HAVING A VALUE AT ALL, and not "smaller than the frame": anchored by its
// middle, an insert as wide as the film is still a placement - it can be moved off centre,
// turned, and hung over the edge. `tw: null` is the unplaced state, and the only one.
const _isPlaced = (c) => !!(c && c.tw != null && +c.tw > 0);

function _pipRows(host, track, c) {
  const set = (k, v) => setB(track.id, c.id, k, v);

  // A fraction of the insert's shorter side rather than pixels, so the number means the same
  // thing on the preview canvas and in the render, which are different sizes.
  host.appendChild(C.row('Soft edge', C.slider({
    min: 0, max: 0.4, step: 0.01, value: +c.feather || 0,
    fmt: (v) => (v <= 0.005 ? 'hard' : Math.round(v * 100) + '%'),
    onChange: (v) => set('feather', v),
  })));
  host.appendChild(C.row('', C.button('Full frame', () => setManyB(track.id, c.id, {
    tx: null, ty: null, tw: null, angle: null, feather: null,
  }), { title: 'Drop the placement and cover the whole frame again' })));
  host.appendChild(C.hint('Placed on the frame'
    + ((+c.angle) ? ' and turned ' + Math.round(+c.angle) + '\u00b0' : '')
    + ', so it is no longer fitted to it - and the two zooms do not apply while it floats: '
    + 'they re-bake the picture to the frame size.'));
}

// How a clip meets a frame of another shape. The second row appears only when there is
// something to decide: a fitted clip loses nothing, so there is no side to pick.
function _frameRows(host, c, set) {
  host.appendChild(C.row('Frame', C.select(FITS, c.fit === 'fill' ? 'fill' : 'fit',
    (v) => set('fit', v))));
  if (c.fit === 'fill') {
    host.appendChild(C.row('Keep', C.select(CROPS, c.cropAlign || 'center',
      (v) => set('cropAlign', v))));
  }
}

// Transition, animation and filter - the same three, in the same words, as the other panel,
// because they are the same three effects: lib/mv3b-render.js builds them from the values
// routes/ffmpeg.js already knew how to build.
//
// Two of the twenty cannot be drawn on a canvas - glitch's noise and sharpen's convolution -
// and the preview says so on itself while they are chosen rather than letting them turn up
// for the first time in the export.
function _blankFx(host, c, set) {
  host.appendChild(_fxTriple(
    c.transition || 'none', c.animation || 'none', c.filter || 'none',
    (v) => set('transition', v), (v) => set('animation', v), (v) => set('filter', v),
    _isPlaced(c),
  ));
}

// A film. Speed retimes it, reverse runs it backwards, and the level belongs to the sound
// half rather than to this clip - so that is where the slider writes.
function _blankFilm(host, track, c, set, pair) {
  // Reverse rides beside the speed slider rather than taking a row of its own: the two are
  // one question about how the clip runs, and a row apiece spent a fifth of the panel saying
  // it twice.
  host.appendChild(C.row('Speed', C.pair(
    C.slider({
      min: 0.25, max: 2, step: 0.05, value: +c.speed || 1, fmt: C.times,
      onChange: (v) => set('speed', v),
    }),
    C.toggleNamed('\u21ba', !!c.reversed, (on) => set('reversed', on), 'Play it backwards'),
  )));

  if (pair) {
    // THE LEVEL LIVES ON THE OTHER HALF. A video clip's own volume is read by nothing - the
    // graph mixes audio lanes - so a slider writing it here would be a dial connected to
    // nothing. It writes to the sound instead, which is what "turn this clip up" means.
    const vol = C.volume(pair.clip.volume == null ? 1 : +pair.clip.volume,
      (v) => setB(pair.track.id, pair.clip.id, 'volume', v));
    vol.title = 'This clip\u2019s own sound, on ' + pair.track.name;
    host.appendChild(C.row('Sound', vol));
  } else {
    host.appendChild(C.hint('No sound attached to this clip.'));
  }

  _bsep(host);
  // PLACED OR FITTED, never both. A clip laid on the frame at a third of its width is not
  // being fitted to anything, so the fit controls would be two settings with nothing to act on.
  if (_isPlaced(c)) _pipRows(host, track, c);
  else _frameRows(host, c, set);

  _bsep(host);
  _blankFx(host, c, set);

  _bsep(host);
  host.appendChild(C.row('', C.button('Remove from timeline', () => removeB(track.id, c.id), {
    danger: true,
    title: pair ? 'Takes the clip off the timeline, and its sound with it. The library keeps the file.'
                : 'Takes the clip off the timeline. The library keeps the file.',
  })));
}

// A picture: one frame and a length the timeline gave it. No speed, no reverse, no level -
// it has none of those, and offering them would be three controls that quietly do nothing.
// Laid out like the other workflow's still panel, because it answers the same question
// first: which picture is this.
function _blankStill(host, track, c, set) {
  const top = _el('div', 'mv3-c-still-top');
  const left = _el('div', 'mv3-c-still-left');
  const fig = _el('div', 'mv3-c-still');
  if (c.thumb || c.src) {
    const img = document.createElement('img');
    img.src = c.thumb || c.src;
    img.alt = c.name || '';
    fig.appendChild(img);
  }
  left.appendChild(fig);
  // THE SAME WINDOW THE OTHER PANEL OPENS, and it is safe to open from here because of what
  // it does not do: it writes nothing to any timeline. What it makes goes to the Birols shelf
  // of the library - which both workflows already share - and getting it onto the montage is
  // a drag, the same as for anything else on that shelf.
  //
  // Directly under the picture it acts on, and centred: this is the one thing on this panel
  // that makes something NEW rather than adjusting the clip, so it stands apart from the
  // settings instead of queueing among them.
  const animate = C.button('Animate', () => openAnimate(c), {
    title: 'Generate a video from this picture. It lands in the library, in Birols; '
         + 'the picture stays where it is. Double-clicking the clip opens this too.',
  });
  animate.classList.add('mv3-c-animate');
  left.appendChild(animate);
  top.appendChild(left);

  // EVERYTHING ELSE BESIDE THE PICTURE, in one column. Half the panel is not wide enough for
  // two settings side by side once the labels are on them, and stacked under the picture they
  // fell off the fold on any portrait still.
  const side = _el('div', 'mv3-c-still-side');
  const stack = _el('div', 'mv3-c-still-stack');
  const cell = (label, control) => {
    const box = _el('div', 'mv3-ins-fx3-cell');
    if (label) box.appendChild(_el('span', 'mv3-ins-fx3-lbl', label));
    if (control) { control.title = control.title || label; box.appendChild(control); }
    stack.appendChild(box);
  };
  const placed = _isPlaced(c);

  cell('transition', C.select(C.TRANSITIONS, c.transition || 'none', (v) => set('transition', v)));
  // No zoom on a placed insert - see the note on _fxTriple.
  if (!placed) cell('animation', C.select(C.ANIMATIONS, c.animation || 'none', (v) => set('animation', v)));
  cell('filter', C.select(C.FILTERS, c.filter || 'none', (v) => set('filter', v)));

  if (placed) {
    cell('soft edge', C.slider({
      min: 0, max: 0.4, step: 0.01, value: +c.feather || 0,
      fmt: (v) => (v <= 0.005 ? 'hard' : Math.round(v * 100) + '%'),
      onChange: (v) => set('feather', v),
    }));
    cell('', C.button('Full frame', () => setManyB(track.id, c.id, {
      tx: null, ty: null, tw: null, angle: null, feather: null,
    }), { title: 'Drop the placement and cover the whole frame again' }));
  } else {
    cell('frame', C.select(FITS, c.fit === 'fill' ? 'fill' : 'fit', (v) => set('fit', v)));
    if (c.fit === 'fill') {
      cell('keep', C.select(CROPS, c.cropAlign || 'center', (v) => set('cropAlign', v)));
    }
  }

  cell('', C.button('Remove', () => removeB(track.id, c.id), {
    danger: true, title: 'Takes the picture off the timeline. The library keeps the file.',
  }));

  side.appendChild(stack);
  top.appendChild(side);
  host.appendChild(top);
}

// A sound. Its level is the whole of it - and a birol lands here silent, which is what this
// panel is most often opened to undo.
function _blankSound(host, track, c, set, pair) {
  host.appendChild(C.row('Volume', C.volume(c.volume == null ? 1 : +c.volume,
    (v) => set('volume', v))));
  host.appendChild(C.hint((+c.volume || 0) > 0
    ? 'Muted is the bottom of the travel.'
    : 'Silent. Raise it to hear this clip in the preview and in the export.'));

  host.appendChild(C.row('Speed', C.pair(
    C.slider({
      min: 0.25, max: 2, step: 0.05, value: +c.speed || 1, fmt: C.times,
      onChange: (v) => set('speed', v),
    }),
    C.toggleNamed('\u21ba', !!c.reversed, (on) => set('reversed', on), 'Play it backwards'),
  )));

  _bsep(host);
  if (pair) {
    host.appendChild(C.hint('Half of a pair: length, speed and direction are shared with the '
      + 'picture on ' + pair.track.name + '. The level is not.'));
  }

  _bsep(host);
  host.appendChild(C.row('', C.button('Remove from timeline', () => removeB(track.id, c.id), {
    danger: true,
    title: pair ? 'The picture stays where it is, and goes silent.'
                : 'Takes the sound off the timeline. The library keeps the file.',
  })));
}

// ── A whole lane in a blank project ─────────────────────────────────────────
// Four shapes, because the four kinds of lane are asked different things - and none of them is
// asked to describe itself. What is on a lane is the lane, drawn full width two inches away.

// Removing the lane, offered here as well as on the square beside it - and asking the same
// question in the same words, because it is the same act.
function _laneRemove(host, track) {
  // A main lane has no remove button and says nothing about why. There is no minus beside it
  // on the timeline either, and a sentence explaining an absence is an absence with a paragraph
  // attached to it.
  if (track.main) return;
  const btn = C.button('Remove this track', null, {
    danger: true,
    title: track.kind === 'video'
      ? 'Takes the track off the project, and the audio track paired with it'
      : 'Takes the track off the project. Any video paired with it stays, and goes silent',
  });
  btn.addEventListener('click', () => {
    askDelete(btn, 'Delete ' + track.name + '?',
      track.kind === 'video' && track.linkId ? 'Its audio track goes with it.'
        : (track.kind === 'audio' ? 'Any picture paired with it stays, and goes silent.' : ''),
      () => removeTrackB(track.id));
  });
  host.appendChild(C.row('', btn));
}

// WHAT THE WHOLE LANE IS SET TO, which is only answerable when its clips agree. Rather than
// remember a lane-level value nothing renders - the graph reads effects off clips and nothing
// else - the panel reads back what is actually there. Clips that disagree show as none, and
// choosing anything makes them agree.
function _commonOf(track, field) {
  const clips = (track.clips || []).filter(c => c && c.src);
  if (!clips.length) return 'none';
  const first = clips[0][field] || 'none';
  for (const c of clips) if ((c[field] || 'none') !== first) return 'none';
  return first;
}

function _blankVideoTrack(host, track) {
  const clips = (track.clips || []).filter(c => c && c.src).length;

  if (!clips) {
    host.appendChild(C.hint('Nothing on this lane yet. A setting for the whole lane is written '
      + 'into the clips on it, so there is nothing here to write it into.'));
  } else {
    host.appendChild(_fxTriple(
      _commonOf(track, 'transition'), _commonOf(track, 'animation'), _commonOf(track, 'filter'),
      (v) => stampB(track.id, { transition: v }),
      (v) => stampB(track.id, { animation: v }),
      (v) => stampB(track.id, { filter: v }),
    ));
    host.appendChild(C.row('Frame', C.select(FITS, _commonOf(track, 'fit') === 'fill' ? 'fill' : 'fit',
      (v) => stampB(track.id, { fit: v }))));
    if (_commonOf(track, 'fit') === 'fill') {
      host.appendChild(C.row('Keep', C.select(CROPS, _commonOf(track, 'cropAlign') || 'center',
        (v) => stampB(track.id, { cropAlign: v }))));
    }
    // THE WARNING IS GONE FROM THE PANEL, and the behaviour is not: choosing one of these
    // still writes it into every clip on the lane, over whatever each had. It lives in the
    // tooltip of the control that does it, and the undo arrow is still the way back.
    host.appendChild(C.row('', C.button('Reset lane', () => resetTrackB(track.id), {
      title: 'Clears the effects and the framing on this lane\u2019s clips. Speed, trims, '
           + 'placement and levels are left alone.',
    })));
  }

  host.appendChild(_el('div', 'mv3-c-sep'));
  _laneRemove(host, track);
}

function _blankAudioTrack(host, track) {
  // THE OTHER EDITOR'S MUSIC PANEL, on this lane. It is the same two questions - make one, or
  // take one already made - and the same thirty chips answer them, so it is the same module
  // told which lane to write to rather than a second copy of it drifting away from the first.
  //
  // The lane's master volume lives inside it, on the library half, where it was put for a
  // reason worth keeping: under a form for music that does not exist yet it is one more
  // control between the chips and the button that makes them into something.
  M.setMusicDest(track.id);
  M.renderMusicTrack(host, track);

  host.appendChild(_el('div', 'mv3-c-sep'));
  _laneRemove(host, track);
}

// ── Captions from what was said ─────────────────────────────────────────────
// The transcript comes back in TIMELINE coordinates - the endpoint lays the sound out end to
// end, silence and all, before it listens - so the words need no shifting afterwards. It is
// the same endpoint the other workflow uses; nothing about it knows which timeline asked.
let _stt = { busy: false, said: '' };

async function _generateCaptions() {
  const tl = Store.timeline();
  const segs = segmentsFor(tl);
  if (!segs.some(x => x.src)) {
    _stt = { busy: false, said: 'There is no sound on the timeline to read.' };
    return render();
  }
  _stt = { busy: true, said: 'Listening...' };
  render();
  try {
    const start = await fetch('/api/stt/timeline', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ segments: segs }),
    }).then(r => r.json());
    if (!start || !start.success) throw new Error((start && start.error) || 'refused');

    for (;;) {
      await new Promise(r => setTimeout(r, 1200));
      const st = await fetch('/api/stt/timeline/' + encodeURIComponent(start.jobId)).then(r => r.json());
      if (!st || !st.success) throw new Error((st && st.error) || 'lost the job');
      if (st.state === 'running') {
        const p = +st.progress || 0;
        const pc = Math.max(0, Math.min(100, p > 1 ? Math.round(p) : Math.round(p * 100)));
        _stt.said = 'Listening... ' + pc + '%';
        render();
        continue;
      }
      if (st.state !== 'done') throw new Error(st.error || 'it did not finish');

      const fmt = (tl && tl.format) || '9:16';
      const per = styleOf(subsTrackB(tl), fmt).wordsPerLine;
      const caps = groupWords(st.words || [], per);
      const lane = subsTrackB(tl);
      if (lane) setCapsB(lane.id, caps);
      _stt = { busy: false, said: caps.length
        ? caps.length + (caps.length === 1 ? ' line' : ' lines') + ' from ' + (st.words || []).length + ' words'
        : 'Nothing was said on those tracks.' };
      render();
      return;
    }
  } catch (e) {
    _stt = { busy: false, said: e.message };
    render();
  }
}

const FONTS = [['Arial', 'Arial'], ['Impact', 'Impact'], ['Verdana', 'Verdana'],
               ['Georgia', 'Georgia'], ['Times New Roman', 'Times'], ['Courier New', 'Courier']];
const POS = [['top', 'top'], ['center', 'middle'], ['bottom', 'bottom']];

// TWO LANES, ONE PANEL. Subtitles and a text lane hold the same thing - words with a look and
// a place - and differ in exactly one way: where the words come from. So the style half is
// shared and only the top of the panel changes, rather than two panels drifting apart over a
// dozen identical controls.
function _blankWordsTrack(host, track) {
  const tl = Store.timeline();
  const fmt = (tl && tl.format) || '9:16';
  const raw = (track && track.style) || {};
  const st = styleOf(track, fmt);
  const set = (patch) => setSubsStyleB(track.id, patch);
  const isSubs = track.kind === 'subs';

  const add = C.button('Add a line', () => addCapB(track.id, playheadB(), 'New line'),
    { title: 'One line at the playhead, to type yourself' });
  if (isSubs) {
    // The two ways a line gets onto this lane, side by side: heard, or typed.
    const gen = C.button(_stt.busy ? 'Listening...' : 'Generate from the sound', _generateCaptions, {
      title: 'Transcribes every audible audio track and writes the words onto this lane',
    });
    gen.disabled = _stt.busy;
    host.appendChild(C.row('', C.pair(gen, add)));
    if (_stt.said) host.appendChild(C.hint(_stt.said));
  } else {
    host.appendChild(C.row('', add));
    host.appendChild(C.hint('Typed, not heard: a transcription writes to the Subtitles lane '
      + 'and never touches this one.'));
  }

  host.appendChild(_el('div', 'mv3-c-sep'));

  host.appendChild(C.row('Where', C.select(POS, st.pos, (v) => set({ pos: v }))));
  // Nudged up or down from that anchor, as a fraction of the frame - so it means the same
  // thing after the format changes, which a number of pixels would not.
  host.appendChild(C.row('Nudge', C.slider({
    min: -0.30, max: 0.30, step: 0.01, value: +st.ty || 0,
    fmt: (v) => (Math.abs(v) < 0.005 ? 'none' : (v > 0 ? 'down ' : 'up ') + Math.abs(Math.round(v * 100)) + '%'),
    onChange: (v) => set({ ty: v }),
  })));

  // SIZE AND WORDS PER LINE ARE THE FORMAT'S until they are touched. A tall frame is a column:
  // eight words across it is a paragraph in a shoe box. Both controls say "auto" while nobody
  // has chosen, and stop following the format the moment somebody does.
  const autoS = raw.sizeAuto !== false;
  host.appendChild(C.row('Size', C.pair(
    C.slider({ min: 20, max: 120, step: 1, value: st.size,
               fmt: (v) => v + (autoS ? ' (auto)' : ''),
               onChange: (v) => set({ size: v, sizeAuto: false }) }),
    C.toggleNamed('auto', autoS, (on) => set(on ? { sizeAuto: true, size: autoSize(fmt) } : { sizeAuto: false }),
                  'Let the format choose the size'),
  )));
  // AT ONCE, not at the next transcription. The words and their timings are on the lane
  // already, so a new line length is a re-cut of what is here - and a slider that only took
  // effect the next time you paid to listen would be a slider you could not judge.
  const heard = wordsOf(track).length;
  if (isSubs) {
    host.appendChild(C.row('Per line', C.slider({
      min: 0, max: 12, step: 1, value: +raw.wordsPerLine || 0,
      fmt: (v) => (v > 0 ? v + ' words' : 'auto (' + autoWordsPerLine(fmt) + ')'),
      onChange: (v) => {
        const per = v > 0 ? v : autoWordsPerLine(fmt);
        setSubsStyleB(track.id, { wordsPerLine: v }, regroup(track, per) || undefined);
      },
    })));
    host.appendChild(C.hint(heard
      ? 'Re-cuts the ' + heard + ' words on this lane straight away. Lines you typed yourself are '
        + 'left as they are - there is nothing to cut them by.'
      : 'How the transcript gets cut into lines. Nothing has been transcribed yet, so this waits '
        + 'for the first Generate.'));
  }

  host.appendChild(_el('div', 'mv3-c-sep'));

  host.appendChild(C.row('Font', C.pair(
    C.select(FONTS, st.font, (v) => set({ font: v })),
    C.toggleNamed('B', !!st.bold, (on) => set({ bold: on }), 'Bold'),
  )));
  host.appendChild(C.row('Colour', isSubs ? C.pair(
    C.color(st.primary, (v) => set({ primary: v })),
    C.toggleNamed('karaoke', !!st.karaoke, (on) => set({ karaoke: on }),
                  'Colour each word as it is spoken'),
  ) : C.color(st.primary, (v) => set({ primary: v }))));
  if (isSubs && st.karaoke) {
    host.appendChild(C.row('Not yet', C.color(st.secondary, (v) => set({ secondary: v }))));
    host.appendChild(C.hint('The colour a word wears before it is spoken. Only lines made by '
      + 'transcription carry word timings - a line you type flips as one piece.'));
  }
  host.appendChild(C.row('Outline', C.pair(
    C.slider({ min: 0, max: 8, step: 0.5, value: +st.outline || 0,
               fmt: (v) => (v > 0 ? v + ' px' : 'none'), onChange: (v) => set({ outline: v }) }),
    C.color(st.outlineColor, (v) => set({ outlineColor: v })),
  )));
  host.appendChild(C.row('Behind', C.select([['outline', 'nothing'], ['box', 'a box']],
    st.borderStyle, (v) => set({ borderStyle: v, backAlpha: v === 'box' && !(+st.backAlpha) ? 0.6 : st.backAlpha }))));
  if (st.borderStyle === 'box') {
    host.appendChild(C.row('Box', C.pair(
      C.slider({ min: 0, max: 1, step: 0.05, value: +st.backAlpha || 0, fmt: C.pct,
                 onChange: (v) => set({ backAlpha: v }) }),
      C.color(st.backColor, (v) => set({ backColor: v })),
    )));
  }

  host.appendChild(_el('div', 'mv3-c-sep'));
  host.appendChild(C.hint(isSubs
    ? 'One style for the lane: these are one set of subtitles, and a caption that looked '
      + 'different from the rest would read as a mistake.'
    : 'One style for the lane. A second look - a title over a caption - is what the other text '
      + 'lane is for.'));
  _laneRemove(host, track);
}

// A caption: words and when. No length field, the same as every other clip here - the edges
// set the timing, and they also say which part of the sound the line belongs to, which a
// number typed into a box cannot.
function _blankCaption(host, track, clip) {
  host.appendChild(C.textarea(clip.name || '', (v) => setCapTextB(track.id, clip.id, v), 3));
  host.appendChild(C.hint('Drag the caption to move it, and its edges to change how long it '
    + 'stays up.'));

  if (Array.isArray(clip.words) && clip.words.length) {
    host.appendChild(_el('div', 'mv3-c-sep'));
    host.appendChild(_fact('Timed', clip.words.length + ' words, from the transcription'));
    host.appendChild(C.hint('Rewriting the line drops those timings, and it colours as one '
      + 'piece from then on.'));
  }

  host.appendChild(_el('div', 'mv3-c-sep'));
  host.appendChild(C.row('', C.button('Remove this line', () => removeB(track.id, clip.id), {
    danger: true, title: 'Takes the caption off the lane',
  })));
}

// NO HEADER, and no description of the lane under it. Which lane is open is visible on the
// timeline - it is the one marked - and what is on it is the lane itself, drawn full width two
// inches away. A panel that restates the thing you just clicked spends the one column that is
// short of room on what you already know.
function _renderBlankTrack(host, track) {
  if (track.kind === 'video') return _blankVideoTrack(host, track);
  if (track.kind === 'audio') return _blankAudioTrack(host, track);
  if (track.kind === 'subs' || track.kind === 'text') return _blankWordsTrack(host, track);
}

// NO HEADER HERE EITHER. Which clip is selected is visible on the timeline, it is outlined on
// the preview, and its name is on the clip itself - three places already saying it, none of
// which cost a row of the panel.
function _renderBlankClip(host, { track, clip }) {
  const set = (k, v) => setB(track.id, clip.id, k, v);
  const still = isStill(clip);
  const pair = mateB(clip.id);

  if (track.kind === 'subs' || track.kind === 'text') return _blankCaption(host, track, clip);
  if (track.kind === 'audio') return _blankSound(host, track, clip, set, pair);
  if (still) return _blankStill(host, track, clip, set);
  return _blankFilm(host, track, clip, set, pair);
}

// Nothing selected, in a blank project. The other workflow's help is about birols, motion
// control and subtitles generated from a read - none of which this one has - so it gets its
// own, and it is the few rules here that cannot be guessed by looking.
function _renderBlankIdle(host) {
  host.appendChild(_title('Nothing selected', 'How this timeline works'));
  const help = _el('div', 'mv3-ins-help');
  const block = (heading, lines) => {
    help.appendChild(_el('div', 'mv3-ins-todo-h', heading));
    const ul = _el('ul');
    for (const line of lines) ul.appendChild(_el('li', null, line));
    help.appendChild(ul);
  };

  block('Picture and sound travel together', [
    'A film dropped on a video lane lands on the mirrored audio lane too, and the two halves '
      + 'keep the same length, speed and direction from then on.',
    'Their levels are separate: a birol arrives silent, and is turned up on its sound half.',
    'A picture has no sound, so it lands alone.',
    'A film lands at its full length. Pull either edge to shorten it - which also chooses '
      + 'which part of it stays.',
  ]);

  block('Nothing moves on its own', [
    'A clip stays exactly where it is dropped. Nothing to the right of it shifts when '
      + 'something else changes length.',
    'Clips on one lane may overlap - the later one in the lane is the one you see.',
  ]);

  block('Removing', [
    'Removing a picture takes its sound with it. Removing the sound leaves the picture, silent.',
    'Drag across empty lane to take several at once, then Delete.',
  ]);

  const note = _el('div', 'mv3-ins-note',
    'The top video lane is the top layer: the stack is painted from the bottom up.');
  help.appendChild(note);
  host.appendChild(help);
}

function _renderMany(host, n) {
  const h = document.createElement('div');
  h.className = 'mv3-ins-title';
  h.textContent = n + ' clips selected';
  host.appendChild(h);

  const p = document.createElement('div');
  p.className = 'mv3-ins-note';
  p.textContent = 'Settings are per clip, so there is nothing here to set for several at once. '
                + 'What can be done to all of them is remove them.';
  host.appendChild(p);

  host.appendChild(C.row('', C.button('Delete ' + n + ' clips', () => {
    if (blankMounted()) deleteMultiB(); else deleteMultiA();
  }, { danger: true, title: 'Also on the Delete key' })));
}

function render() {
  if (_held) { _pending = true; return; }
  const host = _host();
  if (!host) return;
  // The panel is rebuilt wholesale, so a music preview would keep playing with its stop
  // button thrown away. Stop it before the rebuild rather than orphan it.
  M.stopPreview();
  host.textContent = '';
  // A BAND SELECTION OUTRANKS the single one. It is the more deliberate of the two - the
  // single selection is usually just whatever the pointer passed over on the way to drawing
  // the band - and a panel of settings for four clips at once has no honest meaning, so what
  // it offers is the one thing that does: getting rid of them.
  const many = blankMounted() ? multiB() : multiA();
  if (many > 1) return _renderMany(host, many);
  // A blank project keeps its own selection, because it keeps its own timeline. Asking the
  // talking-head module what is selected would always answer nothing here.
  if (blankMounted()) {
    const one = oneB();
    if (one) return _renderBlankClip(host, one);
    const tr = trackB();
    return tr ? _renderBlankTrack(host, tr) : _renderBlankIdle(host);
  }

  const sel = selected();
  if (!sel) return _renderIdle(host);
  if (sel.kind === 'track') return _renderTrack(host, sel.scope);
  return _renderClip(host, sel.scope, sel.id);
}

export function initInspector() {
  // Selecting something is what OPENS a panel, as opposed to the store change below which
  // only refreshes the one already open. The Music panel remembers which of its two halves
  // was last in front, and this is where that memory is allowed to expire.
  onSelect(() => { M.resetView(); render(); });
  // The blank timeline's band changes nothing in the store, so it has to say so itself.
  onSelB(() => render());
  // Also on every store change: trimming a clip changes the numbers on show, and an
  // undo can remove the very clip being inspected.
  Store.onChange(render);

  // pointerdown/up on the document rather than on the panel: a drag that starts on a
  // slider often ends with the pointer somewhere else entirely, and a listener on the
  // panel would never see the release.
  document.addEventListener('pointerdown', (e) => {
    if (e.target && e.target.closest && e.target.closest('#mv3-inspector')) _held = true;
  });
  document.addEventListener('pointerup', () => {
    if (!_held) return;
    _held = false;
    if (_pending) { _pending = false; render(); }
  });
}
