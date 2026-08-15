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
import { onSelect, selected, clearSelection, setClipDur } from './timeline.js';
import { isStill } from './store.js';
import { openAnimate } from './animate.js';
import * as C from './controls.js';
import * as M from './music.js';
import * as Subs from './subtitles.js';

const TRACK_NAME = {
  biro: 'Birols', hook: 'Hooks', seg: 'Main',
  halfer: 'Halfers', music: 'Music', subs: 'Subtitles',
};

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
function _fxTriple(tr, an, fi, onTr, onAn, onFi) {
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
  wrap.appendChild(cell('animation', C.ANIMATIONS, an, onAn));
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
  Store.mutate(tl => {
    const tr = tl.tracks[scope];
    if (tr) tr.clips = tr.clips.filter(c => c.id !== id);
  });
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
function _renderIdle(host) {
  host.appendChild(_title('Nothing selected'));
  const help = _el('div', 'mv3-ins-help');
  const ol = _el('ol');
  for (const s of [
    'Drag a clip from the library onto a track. The track you drop on decides what it is.',
    'Click a clip to edit just that clip. Drag its edges to trim it.',
    'Click a track NAME on the left for settings that apply to the whole track.',
  ]) ol.appendChild(_el('li', null, s));
  help.appendChild(ol);
  const keys = _el('div', 'mv3-ins-keys');
  keys.appendChild(_el('div', 'mv3-ins-todo-h', 'Keys'));
  const kl = _el('ul');
  kl.appendChild(_el('li', null, 'Esc — deselect'));
  kl.appendChild(_el('li', null, 'Delete — remove the selected clip from the timeline'));
  kl.appendChild(_el('li', null, 'Undo / redo are the two arrows in the Timeline header.'));
  keys.appendChild(kl);
  help.appendChild(keys);
  host.appendChild(help);
}

// ── A track ─────────────────────────────────────────────────────────────────
function _renderTrack(host, scope) {
  const t = Store.timeline();
  const track = t && t.tracks && t.tracks[scope];
  const n = track ? (track.clips || []).length : 0;
  const name = TRACK_NAME[scope] || scope;

  const total = track ? (track.clips || []).reduce((a, c) => a + (+c.dur || 0), 0) : 0;
  // TWO LINES. The header was six rows of facts, which is a third of the panel spent on
  // the least important thing in it. Line one says what is selected, line two carries the
  // numbers - including the count, because a setting here rewrites every one of them and
  // knowing it is 14 before touching a dropdown is the difference between an edit and an
  // accident.
  // Music has its own panel and no header at all. The line exists to warn that a setting
  // below rewrites every clip on the track, and nothing in the music panel does that -
  // it is a library and a generator, so the header was two rows saying "empty" over the
  // only part of the inspector that is short of room.
  if (scope === 'music') { M.renderMusicTrack(host, track); return; }

  host.appendChild(_title(name + ' track',
    n ? (n + (n === 1 ? ' clip' : ' clips') + ' · ' + _sec(total) + ' · a setting here rewrites all ' + n)
      : 'empty',
    scope === 'subs' ? Subs.genButton() : null));

  const sep = () => host.appendChild(_el('div', 'mv3-c-sep'));

  // Everything about how captions look belongs to this track, so this is where it lives.
  if (scope === 'subs') { sep(); Subs.renderSubsTrack(host); return; }

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
  host.appendChild(C.row('Volume', C.slider({
    min: 0, max: 1.5, step: 0.05, value: track.volume != null ? track.volume : volDflt,
    fmt: C.pct, onChange: (v) => _setTrackOnly(scope, 'volume', v),
  })));
  host.appendChild(C.hint(scope === 'seg'
    ? 'Master for this track. A clip with its own volume keeps overriding it.'
    : 'Master for this track, silent by default because it lies over the voice. A clip with its own volume overrides it.'));

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

function _renderStillClip(host, scope, id, c, set, sep) {
  // TWO COLUMNS ACROSS THE TOP. The picture takes half the panel - enough to recognise
  // what this clip is, which is the question a still's inspector mostly answers - and the
  // settings that belong to it sit in the other half rather than under it, where the
  // picture would have pushed them off the fold.
  const top = _el('div', 'mv3-c-still-top');
  const fig = _el('div', 'mv3-c-still');
  if (c.thumb) {
    const img = document.createElement('img');
    img.src = c.thumb;
    img.alt = c.name || '';
    fig.appendChild(img);
  }
  top.appendChild(fig);

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
  if (FX_TRACKS.has(scope)) {
    host.appendChild(C.hint('Effects are set here for this clip alone. Choosing a value on the track name overwrites it again.'));
  }

  sep();
  if (scope === 'halfer') {
    host.appendChild(C.hint('In the band. Its geometry is the band’s, not the picture’s.'));
  } else if (scope === 'seg') {
    host.appendChild(C.hint('In the sequence, so it fills the frame.'));
  } else {
    host.appendChild(C.hint(placed
      ? 'Placed by hand on the preview' + (c.angle ? ' · turned ' + c.angle + '°' : '') + '.'
      : 'Covers the whole frame. Drag it on the preview to place it.'));
  }

  // Only where it can matter. Over another lane a cutout shows what is beneath it; in the
  // sequence there is nothing beneath, so the transparent parts are simply black.
  if (/\.(png|webp)$/i.test(String(c.src || '').split('?')[0])) {
    host.appendChild(C.hint(scope === 'seg'
      ? 'A cut-out PNG has nothing behind it here - transparency reads as black.'
      : 'Transparency is kept: a cut-out shows the lane beneath it.'));
  }

  // Turning the picture into a clip. A popup rather than more rows here: the prompt is the
  // main field and this column is a quarter of the panel wide - and a popup outlives the
  // selection, so clicking another clip mid-generation does not replace the job with that
  // clip's settings.
  sep();
  host.appendChild(C.row('', C.button('Animate this picture', () => openAnimate(c), {
    title: 'Generate a video from this picture. It lands in Birols; the picture stays where it is.',
  })));
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
  const name = TRACK_NAME[scope] || scope;
  // TWO LINES, same reason as the track header. Line one: what, and when. Line two: the
  // clip's own name plus the numbers that move as you work - trims appear only once
  // something has actually been cut, because a row reading "0.00s" is noise. The file name
  // and the source length move into the tooltip: long, and they identify nothing you
  // cannot already see.
  const bits = [c.name || null, _sec(c.dur), (c.speed || 1).toFixed(2) + 'x'];
  if (c.trimIn) bits.push('in +' + _sec(c.trimIn));
  if (c.trimOut) bits.push('out -' + _sec(c.trimOut));
  const head = _title(
    name.replace(/s$/, '') + ' clip · ' + _sec(c.start) + ' → ' + _sec(c.start + c.dur),
    bits.filter(Boolean).join(' · '));
  head.title = (c.name ? c.name + '\n' : '') + String(c.src || '').split('/').pop()
    + (c.srcDur ? '\nsource ' + _sec(c.srcDur) : '');
  host.appendChild(head);
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
  if (isStill(c)) { _renderStillClip(host, scope, id, c, set, sep); return; }

  // Overlay lanes only - see the note on the track panel. A fragment of the read keeps the
  // length its voice gave it.
  if (scope !== 'seg') {
    host.appendChild(C.row('Speed', C.slider({
      min: 0.25, max: 2, step: 0.05, value: c.speed || 1, fmt: C.times,
      onChange: (v) => _setClipSpeed(scope, id, v),
    })));
  }

  // Volume is the whole of this clip's audio: 0 is silent, and a clip dropped onto an
  // overlay track arrives at 0. The track is a real fallback, so the slider still needs a
  // way back to it - a slider alone can only set a value, never un-set one.
  const volDflt = scope === 'seg' ? 1 : 0;
  const trackVol = track.volume != null ? track.volume : volDflt;
  const ownVol = c.volume != null;
  host.appendChild(C.row('Volume', C.pair(
    C.slider({
      min: 0, max: 1.5, step: 0.05, value: ownVol ? c.volume : trackVol, fmt: C.pct,
      onChange: (v) => set({ volume: v }),
    }),
    ownVol ? C.button('track', () => set({ volume: null }), { title: 'Drop this clip\'s own volume and follow the track again' }) : null,
  )));
  host.appendChild(C.hint(ownVol
    ? (c.volume > 0 ? 'Audible at ' + C.pct(c.volume) + '. The track is at ' + C.pct(trackVol) + '.'
                    : 'Silent. Raise this to hear it.')
    : 'Following the track (' + C.pct(trackVol) + ').'));

  host.appendChild(C.row('Reversed', C.toggle(!!c.reversed, (on) => set({ reversed: on }))));

  sep();
  if (scope === 'halfer') {
    host.appendChild(C.row('Band', C.select([['top', 'top'], ['bottom', 'bottom']],
      c.halferAlign || 'top', (v) => set({ halferAlign: v }))));
    const rot = c.rotation == null ? 90 : c.rotation;
    host.appendChild(C.row('Rotation', C.select([[0, '0°'], [90, '90°'], [180, '180°'], [270, '270°']],
      String(rot), (v) => set({ rotation: +v }))));
    // At 0 and 180 the content is not stretched to fill the band - it covers it keeping
    // aspect, so which part is kept becomes a choice. At 90/270 there is nothing to pick.
    if (rot === 0 || rot === 180) {
      host.appendChild(C.row('Keep', C.select([['top', 'top'], ['bottom', 'bottom']],
        c.valign || 'top', (v) => set({ valign: v }))));
    }
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
      host.appendChild(C.row('', C.button('Full frame', () => set({ tx: null, ty: null, tw: null, angle: null }), {
        title: 'Drop the placement and cover the whole frame again',
      })));
      host.appendChild(C.hint('Placed by hand on the preview' + (c.angle ? ' · turned ' + c.angle + '°' : '') + '.'));
    } else {
      host.appendChild(C.hint('Covers the whole frame. Drag it on the preview to place it.'));
    }
  }

  if (FX_TRACKS.has(scope)) {
    sep();
    host.appendChild(_fxTriple(
      c.transition || 'none', c.animation || 'none', c.filter || 'none',
      (v) => set({ transition: v }), (v) => set({ animation: v }), (v) => set({ filter: v }),
    ));
    host.appendChild(C.hint('Set here for this clip alone. Choosing a value on the track name overwrites it again.'));
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

function render() {
  if (_held) { _pending = true; return; }
  const host = _host();
  if (!host) return;
  // The panel is rebuilt wholesale, so a music preview would keep playing with its stop
  // button thrown away. Stop it before the rebuild rather than orphan it.
  M.stopPreview();
  host.textContent = '';
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
