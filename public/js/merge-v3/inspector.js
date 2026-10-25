/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — the inspector: the settings of what is picked on the timeline, and the panel the
   build of a talking head lives in.

   TWO PLACES SINCE PHASE L (the owner, 2026-09-23). What is PICKED on the timeline
   (js/merge-v3/timeline-b.js) is painted into a strip that slides over the Library from the right:

     nothing        no strip - the Library, uncovered
     a lane         what applies to the whole lane
     a clip         that clip's own settings; several clips - removing them

   The panel that used to show them is Setup now: the build of a talking head
   (js/merge-v3/workshop.js). A project that is not a talking head has nothing in it and no spine
   for it - the scenarios a talking head is made from are a view of the Library (phase V28.3,
   js/merge-v3/scen-pick.js).

   Lane settings are a STAMP, not an inherited default: choosing a value on a lane writes it
   into every clip on it, overwriting whatever each clip had. The undo arrow is the way back.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as Store from './store.js';
import { multiCount as multiB, deleteMulti as deleteMultiB, isMounted as blankMounted,
         onSelChange as onSelB, selectedOne as oneB, setClipField as setB,
         removeClip as removeB, mateOf as mateB, selectedTrack as trackB,
         setClipFields as setManyB, setClipsFields as setClipsB, selectedClips as pickedB,
         removeTrack as removeTrackB, playhead as playheadB,
         stampTrack as stampB, resetTrack as resetTrackB,
         addCaption as addCapB, setCaptionText as setCapTextB,
         setSubsStyle as setSubsStyleB, setSubsListen as setListenB,
         setCaptionStyle as setCapStyleB, selectedCaptions as capsB, clearSelection as clearSelB,
         revealSelection as revealSelB, gesture as gestureB, recutLines as recutLinesB,
         selectTrackById as selectTrackB } from './timeline-b.js';
import * as CapView from './captions-view.js';
import * as MyPresets from './my-presets.js';
import { askName } from '../name-box.js';
import * as Views from './lib-views.js';
import { presetStyle, presetName, editedKeys, placed, keepMotion } from '../captions/preset-use.js';
import { shownEnter, PAGE_LEAVES, pairNow } from '../captions/page-fx.js';
import { isHeard } from '../captions/heard.js';
import { styleOf, autoSize, autoWordsPerLine } from './subs-b.js';
import { wordsOf, CUT_KEYS } from '../captions/pages.js';
import { listenOf } from '../captions/heard.js';
import * as Listen from './listen.js';
import { askDelete, note } from './ask.js';
import { spells, textOf, correctedCount, isCorrected } from '../captions/words.js';
import { overPage } from '../captions/pages.js';
import { markedColour, renderFrame, resolveStyle, PLATES, pairOf, mixOf, animsOf, LOOK_KEYS } from '../captions/style.js';
import { deal, newSeed, withoutRefs, refsOf } from '../captions/mix.js';
import { pageBox } from '../captions/place.js';
import * as Platforms from './platforms.js';
import * as WordEdit from './word-edit.js';
import { FONTS as CAP_FONTS, fontOf } from '../captions/fonts.js';
import * as WK from './workshop.js';
import { isStill } from './store.js';
import * as C from './controls.js';
import * as M from './music.js';
import { setOpenColumn, columnMax } from './layout.js';
// (phase V33.2) A filled clip's window: fixed, following the face, the middle, whole over its blur, two faces.
import * as FRAMING from './framing-ui.js';

function _host() { return document.querySelector('#mv3-inspector .mv3-panel-body'); }
function _overHost() { return document.querySelector('#mv3-over .mv3-over-body'); }
// The strip in or out. Out means nothing is picked - there is nothing for it to be about.
function _over(open) {
  const el = document.getElementById('mv3-over');
  if (el) el.classList.toggle('is-open', !!open);
}

function _el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// A read-only fact: a label and what it says.
function _fact(k, v) {
  const row = _el('div', 'mv3-ins-row');
  row.appendChild(_el('span', 'mv3-ins-k', k));
  row.appendChild(_el('span', 'mv3-ins-v', v));
  return row;
}

// THE THREE EFFECTS ARE NOT OFFERED (phase V49, point 5, the owner's (пр14) а: "убираем эти параметры (transition, animation
// и filter). эти штуки я добавлю в другой фазе"). After cut silence a lane is 20-30 pieces a minute, and a transition picked
// for the lane played at both ends of every piece and broke the render's runs. The pickers of the clip, the picture and the
// lane are gone; values already in a project stay in its file and nothing applies them (fx-b.js, lib/mv3b-render.js
// EFFECTS_ON) - the code that draws and renders them is kept for the phase that brings them back.

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
// NOR WHILE A FIELD IS BEING TYPED IN (K10b): a caption's text, a lane's name - set on focus, cleared when the
// field is left (render()). The words of a caption are not counted: they put their own field back.
let _typing = false;
let _typedPending = false;
const _isTextField = (el) => !!el && (el.tagName === 'TEXTAREA'
  || (el.tagName === 'INPUT' && /^(text|search|number|)$/.test(String(el.type || '')))) && !el.closest('[data-own-keys]');
// A caption's current text in the store, or null when it is gone.
function _captionName(trackId, clipId) {
  const tl = Store.timeline();
  const t = ((tl && tl.tracks) || []).find(x => x.id === trackId);
  const c = t && (t.clips || []).find(x => x.id === clipId);
  return c ? String(c.name || '') : null;
}
// THE BOX NOT TYPED IN YET FOLLOWS THE LINE (review K10): the paint waits while a field is focused, but a box
// focused and still holding what it was painted with has nothing of the person's in it - it takes the line's
// text now, in place, with the focus where it is (a word corrected just before the box was clicked).
function _freshenField() {
  const a = document.activeElement;
  if (!a || !a.__ids || a.value !== a.__painted) return;
  const cur = _captionName(a.__ids.track, a.__ids.clip);
  if (cur == null || cur === a.__painted) return;
  a.value = cur;
  a.__painted = cur;
}

// ── A clip ────────────────────────────────────────────────────────────────
// Built from the primitives in controls.js.
//
// CUT TO WHAT THE RENDERER ACTUALLY READS. Every control here has its filter in
// lib/mv3b-render.js and its arithmetic in preview-b.js - speed, reverse, how a clip meets
// the frame, level, the three effects. A control the export ignored would be worse than a
// missing one: the missing one is visible, and the ignored one is only discovered by watching
// the file.
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
    + ', so it is no longer fitted to it.'));
}

// ── A main clip as a picture in the picture (phase V49, point 3) ─────────────
// The owner's (пр8)-(пр11): main video has no Halfer but a PiP. Switched on, what the frame shows of the clip NOW becomes the
// picture - a filled clip's crop with its Keep side, a fitted clip's whole picture, a framed clip's window (still moving inside
// it) - where and as big as it already is; the yellow corners on the preview then size THAT picture about its middle, a drag
// moves it, and behind it the same clip is blurred over the whole frame (preview-b.js _pipRect, lib/mv3b-render.js). Off:
// the whole frame again. Written into EVERY main clip picked at once ((пр9): cut silence leaves 20-30 pieces a minute), one
// undo step. `items` - [{ track, clip }] of the main lane.
const isMainVideo = (track) => !!(track && track.kind === 'video' && track.main);

function _pipSection(host, items) {
  const clips = items.map(x => x.clip);
  const on = clips.every(c => !!c.pip);
  const write = (patch) => setClipsB(items.map(({ track, clip }) => ({ trackId: track.id, clipId: clip.id, patch })));
  const many = items.length > 1;
  const head = C.row('PiP', C.toggle(on, (v) => write(v ? { pip: true }
    : { pip: null, tx: null, ty: null, tw: null, angle: null })));
  head.title = on ? 'A picture in the picture over its own blur. Switch off for the whole frame again.'
                  : 'Make ' + (many ? 'these clips' : 'this clip') + ' a picture in the picture: what the frame shows now, '
                    + 'sized and moved on the preview, over a blurred copy of itself';
  host.appendChild(head);
  if (!on) {
    if (clips.some(c => c.pip)) host.appendChild(C.hint('Some of the picked clips are a PiP already - switching on makes all of them one.'));
    return;
  }
  const c0 = clips[0];
  host.appendChild(C.row('Soft edge', C.slider({
    min: 0, max: 0.4, step: 0.01, value: +c0.feather || 0,
    fmt: (v) => (v <= 0.005 ? 'hard' : Math.round(v * 100) + '%'),
    onChange: (v) => write({ feather: v }),
  })));
  // ((пр11)) Rounded corners - a share of the shorter side, half of it round ends - and an outline inside the edge, its
  // thickness a share of the frame's width (said in the pixels of a 1080-wide film) and its colour.
  host.appendChild(C.row('Corners', C.slider({
    min: 0, max: 0.5, step: 0.01, value: +c0.radius || 0,
    fmt: (v) => (v <= 0.005 ? 'square' : v >= 0.495 ? 'round' : Math.round(v * 200) + '%'),
    onChange: (v) => write({ radius: v }),
  })));
  const col = C.color(c0.outlineColor || '#ffffff', (v) => write({ outlineColor: v }));
  col.title = 'The outline’s colour';
  host.appendChild(C.row('Outline', C.pair(C.slider({
    min: 0, max: 0.03, step: 0.001, value: +c0.outline || 0,
    fmt: (v) => (v <= 0.0005 ? 'none' : Math.round(v * 1080) + ' px'),
    onChange: (v) => write({ outline: v }),
  }), col)));
  host.appendChild(C.row('', C.button('Full size', () => write({ tx: null, ty: null, tw: null, angle: null }),
    { title: 'Back to the size and place it had when it became a PiP - the whole frame it showed' })));
  host.appendChild(C.hint('Drag a corner on the preview to size it, drag it to move it, the knob to turn it'
    + (many ? ' - all ' + items.length + ' picked clips move together.' : '.')));
}

// How a clip meets a frame of another shape. The second row appears only when there is
// something to decide: a fitted clip loses nothing, so there is no side to pick.
// (phase V33.2, the owner's (х9)) A filled clip's window may MOVE: "Framing" - fixed (the side kept, as before), following
// the face, the middle, the whole frame over its blur, two faces as bands - and a shift for the whole clip
// (public/js/merge-v3/framing-ui.js; the path itself is public/js/framing/path.js, which the render reads too).
function _frameRows(host, c, set) {
  host.appendChild(C.row('Frame', C.select(FITS, c.fit === 'fill' ? 'fill' : 'fit',
    (v) => set('fit', v))));
  if (c.fit !== 'fill') return;
  // (phase V43) A part of fragmentation follows the most active - its own choice while it has it - with punch-ins on or off.
  const mode = FRAMING.modeOf(c);
  const pickFraming = C.select(FRAMING.framingsOf(c), mode, (v) => { FRAMING.choose(c, v, set); });
  host.appendChild(C.row('Framing', pickFraming));
  const zoomRow = FRAMING.zoomRow(c, C);
  if (zoomRow) host.appendChild(zoomRow);
  if (mode === 'fixed') {
    host.appendChild(C.row('Keep', C.select(CROPS, c.cropAlign || 'center',
      (v) => set('cropAlign', v))));
  } else if (mode !== 'whole') {
    host.appendChild(C.row('Shift', C.slider({
      min: -1, max: 1, step: 0.05, value: +c.frame.shift || 0,
      fmt: (v) => (Math.abs(v) < 0.01 ? 'none' : (v < 0 ? 'left ' : 'right ') + Math.round(Math.abs(v) * 100) + '%'),
      onChange: (v) => set('frame', { ...c.frame, shift: v }),
    })));
  }
  const note = C.hint(FRAMING.noteOf(c));
  note.id = 'mv3-framing-note';
  host.appendChild(note);
  FRAMING.onNote(() => {
    const el = document.getElementById('mv3-framing-note');
    if (el) el.textContent = FRAMING.noteOf(c);
    // Asked and not found: the switch says what the clip still has.
    if (FRAMING.failed(c) && pickFraming.isConnected) pickFraming.value = mode;
  });
}

// ── A halfer band ───────────────────────────────────────────────────────────
// The other editor's Halfers lane as a section on any picture: switched on, the clip is a band
// across the frame instead of a picture on it. Closed while it is off - its numbers mean nothing
// to a clip that is not a band - and open while it is on, in place of the framing, placement and
// effects that do not apply to one (lib/mv3b-render.js renders none of them on a band).
//
// The controls and their words are that editor's, so a band brought over from there reads the
// same here. The defaults are its defaults: against the top, two fifths of the frame, turned 90.
function _halferRows(host, c, set) {
  const on = !!c.halfer;
  const head = C.row('Halfer', C.toggle(on, (v) => set('halfer', v)));
  head.classList.add('mv3-c-fold');
  if (on) head.classList.add('is-open');
  head.title = on ? 'A band across the frame. Switch off to make it a picture again - the band keeps its settings.'
                  : 'Make this clip a band across the frame, like the Halfers lane in the other editor';
  host.appendChild(head);
  if (!on) return;

  const num = (v, dflt) => { const n = Number(v); return (v != null && Number.isFinite(n)) ? n : dflt; };
  const rot = [0, 90, 180, 270].includes(+c.rotation) && c.rotation != null ? +c.rotation : 90;
  const sideways = (rot === 90 || rot === 270);

  host.appendChild(C.row('Band', C.slider({
    min: 0, max: 100, step: 1, value: num(c.halferPos, 100),
    fmt: (v) => (v >= 99 ? 'top' : v <= 1 ? 'bottom' : v === 50 ? 'middle' : v + '%'),
    onChange: (v) => set('halferPos', v),
  })));
  host.appendChild(C.row('Thickness', C.slider({
    min: 5, max: 100, step: 1, value: num(c.halferThick, 40),
    fmt: (v) => (v >= 100 ? 'full frame' : v + '%'),
    onChange: (v) => set('halferThick', v),
  })));
  host.appendChild(C.row('Rotation', C.select([[0, '0\u00b0'], [90, '90\u00b0'], [180, '180\u00b0'], [270, '270\u00b0']],
    String(rot), (v) => set('rotation', +v))));
  // The band is covered, never stretched, so there is always a slice to choose - and WHICH WAY it
  // slides depends on the turn: upright, the spare is above and below; on its side, to the sides.
  host.appendChild(C.row('Keep', C.slider({
    min: 0, max: 100, step: 1, value: num(c.halferKeep, 100),
    fmt: (v) => (v >= 99 ? (sideways ? 'right' : 'top')
               : v <= 1 ? (sideways ? 'left' : 'bottom')
               : v === 50 ? 'middle' : v + '%'),
    onChange: (v) => set('halferKeep', v),
  })));
  // Only the edges facing INTO the frame, as a share of the band. Written as a number even at
  // zero: nothing written is the default softness, and hard has to be something else.
  host.appendChild(C.row('Soft edge', C.slider({
    min: 0, max: 40, step: 1, value: c.feather == null ? 3 : Math.round(+c.feather * 100),
    fmt: (v) => (v <= 0 ? 'hard' : v + '%'),
    onChange: (v) => set('feather', v / 100),
  })));
  host.appendChild(C.hint('A band across the frame: where it sits, how thick it is, and which slice of the '
    + 'picture survives the crop. ' + (sideways ? 'On its side, so the slice slides left to right.'
                                              : 'Upright, so the slice slides bottom to top.')
    + ' No framing, placement or effects while it is a band.'));
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

  // (phase V49, (пр8)) No Halfer on main video - one switched on before can still be switched off.
  const main = isMainVideo(track);
  if (!main || c.halfer) {
    _bsep(host);
    _halferRows(host, c, set);
  }

  if (!c.halfer) {
    _bsep(host);
    // PLACED OR FITTED, never both. A clip laid on the frame at a third of its width is not
    // being fitted to anything, so the fit controls would be two settings with nothing to act on.
    // (V49) A main clip is framed as ever - a PiP shows what the frame shows - and its PiP is below.
    if (main) { _frameRows(host, c, set); _bsep(host); _pipSection(host, [{ track, clip: c }]); }
    else if (_isPlaced(c)) _pipRows(host, track, c);
    else _frameRows(host, c, set);
  }

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
  // (phase V49) On main video a picture is framed as ever and may be a PiP (below); it has no Halfer.
  const main = isMainVideo(track);
  const placed = _isPlaced(c) && !main;

  if (c.halfer) {
    // A band takes none of these: its settings are the section under the picture. No placement or framing on a band.
    stack.appendChild(C.hint('A halfer band - its settings are below.'));
  } else if (placed) {
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

  if (main && !c.halfer) {
    _bsep(host);
    _pipSection(host, [{ track, clip: c }]);
  }
  if (!main || c.halfer) {
    _bsep(host);
    _halferRows(host, c, set);
  }
}

// A sound. Its level is the whole of it - and a birol lands here silent, which is what this
// panel is most often opened to undo.
function _blankSound(host, track, c, set, pair) {
  host.appendChild(C.row('Volume', C.volume(c.volume == null ? 1 : +c.volume,
    (v) => set('volume', v))));
  host.appendChild(C.hint((+c.volume || 0) > 0
    ? 'Muted is the bottom of the travel.'
    : 'Silent. Raise it to hear this clip in the preview and in the export.'));

  // (phase V23) Its own fades - the two variants of a Suno track cross into each other over three seconds.
  const secs = (v) => (v > 0 ? (+v).toFixed(1) + 's' : 'off');
  host.appendChild(C.row('Fade in', C.slider({
    min: 0, max: 5, step: 0.5, value: Math.max(0, +c.fadeIn || 0), fmt: secs, onChange: (v) => set('fadeIn', v),
  })));
  host.appendChild(C.row('Fade out', C.slider({
    min: 0, max: 5, step: 0.5, value: Math.max(0, +c.fadeOut || 0), fmt: secs, onChange: (v) => set('fadeOut', v),
  })));

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
      title: 'Puts the framing of this lane\u2019s clips back to Fit. Speed, trims, '
           + 'placement and levels are left alone.',
    })));
  }

  host.appendChild(_el('div', 'mv3-c-sep'));
  _laneRemove(host, track);
}

function _blankAudioTrack(host, track) {
  // THE MUSIC PANEL, on this lane: the lane's master volume and the generator (js/merge-v3/music.js). The tracks
  // themselves are in the Library panel, Audio -> Music, dragged onto a lane from there (phase V28.4).
  M.setMusicDest(track.id);
  M.renderMusicTrack(host, track);

  host.appendChild(_el('div', 'mv3-c-sep'));
  _laneRemove(host, track);
}

// ── Captions from what was said ─────────────────────────────────────────────
// The SERVER listens to the project and lays the lines (lib/captions-job.js, phase K1); the strip
// presses the button and says what the job of THIS project is doing (listen.js).
// The key decides (phase V30, the owner's (с22)): Groq when there is one, this computer when not - or this computer always.
const ENGINES = [['cloud', 'Groq when there is a key, else this computer'], ['local', 'this computer']];
// What the subtitle strip was last built for: while only the words of its status line change (a percent),
// the line is rewritten in place - rebuilding the strip every 1.5 s tore down an open menu (review K1b).
let _listenShape = null;

// The shipped fonts, all with the Russian alphabet (public/js/captions/fonts.js, phase K5).
const FONTS = CAP_FONTS.map(f => [f.family, f.label]);
const POS = [['top', 'top'], ['center', 'middle'], ['bottom', 'bottom']];
// How a heard lane is cut (phase V30, block 4): style.js CUTS.
const CUT_OPTS = [['pages', 'pages - a few words at a time'], ['sentences', 'sentences - classic subtitles']];
// What makes a line wider or narrower - or a page hold more - cuts the heard pages again, in the same
// step (K2, the owner's answer 3): a page cut for one font is not a page in another. The list is pages.js's.
const CUTS = CUT_KEYS;
const _cuts = (patch) => Object.keys(patch || {}).some(k => CUTS.includes(k));

// What a word does while it is spoken, how it is cased, what stands behind it (K0's fields, given controls in K6).
const EFFECTS = [['none', 'none'], ['color', 'colour'], ['box', 'a box'], ['pop', 'pop'], ['bounce', 'jump'],
  ['sweep', 'sweep'], ['karaoke', 'karaoke']];
// HOW A SUBTITLE PAGE COMES IN AND GOES OUT (phase V49, the owner's (пр16)-(пр18)): motions of the whole page, their lengths the
// app's (captions/page-fx.js). "Arrives" went: a preset's own way of arriving shows as its In until one is chosen ((пр17)).
const PAGE_IN = [['at-once', 'at once'], ['fade', 'fade'], ['pop', 'pop'], ['zoom', 'zoom'], ['grow', 'grow'], ['from-top', 'from the top'],
  ['rise', 'from below'], ['from-left', 'from the left'], ['from-right', 'from the right'], ['drop', 'drop'], ['blur', 'blur'],
  ['swing', 'swing']];
const PAGE_OUT = [['none', 'at once'], ['fade', 'fade'], ['pop', 'pop'], ['shrink', 'shrink'], ['zoom', 'zoom'], ['rise', 'up'],
  ['sink', 'down'], ['to-left', 'to the left'], ['to-right', 'to the right'], ['fall', 'fall'], ['blur', 'blur']];
const CASINGS = [['none', 'as typed'], ['upper', 'UPPER'], ['lower', 'lower'], ['title', 'Title']];
const BEHIND = [['outline', 'nothing'], ['box', 'a box'], ['boxline', 'box + outline']];
// A TEXT line's (phase V42; the owner's (ц4)): what stands behind it besides a box - a plate in the box's colour - and how it
// comes in and goes out (style.js ENTERS / LEAVES, drawn by captions/text-fx.js).
const BEHIND_TEXT = BEHIND.concat([['round', 'a rounded box'], ['pill', 'a pill'], ['marker', 'a marker stroke'],
  ['underline', 'an underline'], ['circle', 'a circle'], ['tag', 'a tag with a stripe'], ['sticker', 'a sticker']]);
const ENTER_OPTS = [['none', 'at once'], ['fade', 'fade'], ['pop', 'pop'], ['zoom', 'zoom'], ['grow', 'grow'], ['rise', 'rise'],
  ['from-left', 'from the left'], ['from-right', 'from the right'], ['drop', 'drop'], ['blur', 'blur'], ['stretch', 'stretch'],
  ['swing', 'swing'], ['wipe', 'wipe'], ['mask-rise', 'slot'], ['rows', 'line by line'], ['words', 'word by word'],
  ['words-pop', 'words pop'], ['letters', 'letter by letter'], ['letters-pop', 'letters pop'], ['letters-drop', 'letters drop'],
  ['typewriter', 'typewriter'], ['glitch', 'glitch'], ['flicker', 'flicker']];
const LEAVE_OPTS = [['none', 'at once'], ['fade', 'fade'], ['pop', 'pop'], ['zoom', 'zoom'], ['shrink', 'shrink'], ['rise', 'rise'],
  ['sink', 'sink'], ['to-left', 'to the left'], ['to-right', 'to the right'], ['fall', 'fall'], ['blur', 'blur'], ['stretch', 'stretch'],
  ['wipe', 'wipe'], ['mask-sink', 'slot'], ['rows', 'line by line'], ['words', 'word by word'], ['letters', 'letter by letter'],
  ['letters-fall', 'letters fall'], ['backspace', 'backspace'], ['glitch', 'glitch'], ['flicker', 'flicker']];
// The old way a text line arrived, shown as its entrance (text-fx.js reads it so).
const APPEAR_AS = { pop: 'pop', fade: 'fade', slide: 'rise' };
const _secs = (v) => (Math.round(v * 100) / 100) + ' s';

/** What choosing `v` in Behind writes, for a look that is `st` now: a box or a plate, never both; one that would be clear is given
 * an opacity - a plate solid, a box as before. */
function _behind(v, st) {
  const plate = PLATES.includes(v) && v !== 'none';
  const p = plate ? { plate: v, borderStyle: 'outline' } : { borderStyle: v, plate: 'none' };
  if (v !== 'outline' && !(+st.backAlpha)) p.backAlpha = plate ? 1 : 0.6;
  return p;
}

// What a press on a preset tile applies it to - set by whichever strip is painted (render) - and a press on an animation's tile
// (V49): its pair 'in|out'.
let _capApply = null;
let _capAnim = null;

// TWO LANES, ONE PANEL. Subtitles and a text lane hold the same thing - words with a look and
// a place - and differ in exactly one way: where the words come from. So the style half is
// shared and only the top of the panel changes, rather than two panels drifting apart over a
// dozen identical controls.
function _blankWordsTrack(host, track) {
  const tl = Store.timeline();
  const fmt = (tl && tl.format) || '9:16';
  const raw = (track && track.style) || {};
  const st = styleOf(track, fmt);
  const isSubs = track.kind === 'subs';
  const set = (patch) => setSubsStyleB(track.id, patch, isSubs && _cuts(patch));
  // SEVERAL PRESETS AND ANIMATIONS (V49, the owner's (пр17), (пр21)-(пр24)): the subtitle lane's only.
  const mix = isSubs ? mixOf(raw) : null;
  const anims = isSubs ? animsOf(raw) : null;
  // A preset REPLACES the lane's style (every field - the owner's answer 1); a subtitle lane is cut again. A text preset keeps
  // where the lane's lines are (V42, (ц3) - preset-use.js placed); a subtitle lane its In and Out (V49, (пр20)), and a press
  // without Shift is one preset again. Shift on the subtitle lane adds the preset to those dealt, or takes it away (_shiftPreset).
  const apply = (id, o) => {
    if (isSubs && o && o.shift) return _shiftPreset(track, raw, id);
    const s = placed(id, raw);
    if (s) setSubsStyleB(track.id, isSubs ? Object.assign(keepMotion(s, raw), mix ? { mix: [] } : {}) : s, isSubs);
  };
  const pagesNow = (track.clips || []).filter(isHeard).length;
  _capHead(host, track.name || (isSubs ? 'Subtitles' : 'Text'), 'the whole lane' + (isSubs && pagesNow ? ' · ' + pagesNow + ' pages' : '')
    + (mix ? ' · ' + mix.length + ' presets' : ''));
  // Saved as the lane's style is stored - an automatic size stays automatic. Several presets are no one look (пр23): no saving.
  if (mix) _mixLine(host, mix);
  else _presetLine(host, raw, () => apply(raw.preset), undefined, () => raw, isSubs ? '' : 'text');

  const add = C.button('Add a line', () => addCapB(track.id, playheadB(), 'New line'),
    { title: 'One line at the playhead, to type yourself' });
  if (isSubs) {
    // The two ways a line gets onto this lane, side by side: heard, or typed.
    const v = Listen.view(Store.key());
    const gen = C.button(v.busy && !v.again ? 'Listening...' : 'Generate from the sound', () => Listen.start(), {
      title: 'Listens to the audible sound - the main audio lane first, music beds and reversed clips left '
        + 'out - and lays the words on this lane. Lines you typed or corrected stay as they are. In a talking head '
        + 'every line is heard by itself, its words taken from the script, and a line with a new take is heard by itself.',
    });
    gen.disabled = v.busy || !Store.key() || !Store.canEdit();
    // BACK TO WHAT WAS HEARD (K2): the pages laid again from the answers this project keeps - the hand
    // cuts, trims and word edits of the heard lines go, the typed lines stay; nothing is asked or paid.
    let back = null, fixed = 0;
    if (v.heard) {
      // The words corrected by hand go with it (K10, the owner's answer 1) - said before the press.
      fixed = (track.clips || []).reduce((n, c) => n + correctedCount(c), 0);
      back = C.button(v.again ? 'Re-laying...' : 'back to what was heard', () => Listen.start({ stored: true }), {
        title: 'Lays the heard lines again exactly as they were first heard and cut - your cuts, trims and '
          + 'corrections of them go, lines you typed stay. Nothing is asked and nothing is paid; if the sound '
          + 'has changed since, Generate from the sound hears the new part.',
      });
      back.disabled = v.busy || !Store.canEdit();
    }
    // The ways a line gets onto this lane - heard, typed, heard again - in ONE row (phase S2, the owner
    // 2026-10-05; a labelled row held only two).
    host.appendChild(C.acts([gen, add, back]));
    if (fixed) host.appendChild(C.hint('Your ' + fixed + ' corrected ' + (fixed === 1 ? 'word goes' : 'words go') + ' with "back to what was heard".', true));
    // No Language row (phase V29, the owner 2026-10-14): the listener detects the language by itself.
    const how = listenOf(track) || {};
    // WHO LISTENS (phase K1b): Groq, or this computer - which is also where a run goes by itself when Groq
    // cannot be asked. Off when this copy of the app has no recognition of its own.
    const L = Listen.local();
    const can = !!(L && L.platform && (L.program.present || L.cuda.present));
    // What is STORED is shown: a lane set to this computer in a copy without the program can still be put
    // back on Groq here - nothing else writes the field, and every press would be refused (review K1b).
    const engine = how.engine === 'local' ? 'local' : 'cloud';
    const on = C.select(ENGINES, engine, (val) => setListenB(track.id, { engine: val }));
    on.disabled = !can && engine !== 'local';
    host.appendChild(C.row('Listen on', on));
    if (L && !can) {
      host.appendChild(C.hint('Recognition on this computer is not installed in this copy of the app - '
        + (engine === 'local' ? 'switch Listen on to cloud (Groq).' : 'Groq only.')));
    } else if (engine === 'local' && L && !L.model.present) {
      host.appendChild(C.hint('The first time downloads the speech model (' + Math.round(L.model.bytes / 1e6)
        + ' MB) into the library\'s cache - after that it needs no internet.'));
    }
    // The line is marked, so a percent that moves rewrites it in place instead of rebuilding the strip.
    const ln = C.hint(v.line || '');
    ln.dataset.listenLine = '1';
    ln.hidden = !v.line;
    host.appendChild(ln);
    _listenShape = { key: Store.key(), busy: v.busy, ask: v.ask, again: v.again, heard: v.heard, local: L };
    // A run that fell over here with no model asks once (the owner, K1b answer 4).
    if (v.ask && L) {
      host.appendChild(C.row('', C.button('Download the speech model (' + Math.round(L.model.bytes / 1e6)
        + ' MB) and listen on this computer', () => Listen.start({ download: true }))));
    }
  } else {
    host.appendChild(C.acts([add]));
    host.appendChild(C.hint('Typed, not heard: a transcription writes to the Subtitles lane '
      + 'and never touches this one.', true));
  }

  host.appendChild(_el('div', 'mv3-c-sep'));
  // AT ONCE, not at the next transcription. The words and their timings are on the lane
  // already, so a new page length is a re-cut of what is here - and a slider that only took
  // effect the next time you paid to listen would be a slider you could not judge. The rules
  // themselves (pages.js) are not settings: Words and Lines are what a person chooses.
  const heard = wordsOf(track).length;
  if (isSubs) {
    const recut = C.button('re-cut', () => setSubsStyleB(track.id, {}, true), {
      title: 'Cuts the heard words into pages again by the rules, without changing anything else - for a '
        + 'lane cut before, or after cuts of your own',
    });
    recut.disabled = !heard || !Store.canEdit();
    // HOW THE LANE IS CUT (phase V30, block 4, (с12), (с42)): a few words a page, or classic subtitles - a sentence or a
    // part of one in two lines of up to 42 characters. Changing it cuts the heard words again in the same step.
    const sent = raw.cut === 'sentences';
    host.appendChild(C.row('Cut', C.pair(C.select(CUT_OPTS, sent ? 'sentences' : 'pages', (v) => set({ cut: v })), sent ? recut : null)));
    const pages = (track.clips || []).filter(c => Array.isArray(c.words) && c.words.length).length;
    const counted = heard + ' heard words on ' + pages + (pages === 1 ? ' page' : ' pages')
      + '; changing this cuts them again straight away, lines you typed stay as they are.';
    if (sent) {
      // One rule, no Words or Lines (с42); In and Out under Cut (V49, (пр17)).
      _pageMotionRows(host, st, set, anims);
      host.appendChild(C.hint(heard
        ? 'Classic subtitles: a page is a sentence, or part of one cut at a comma - two lines of up to 42 characters (and '
          + '78% of the frame), 1-7 s on screen; a pause of a second ends it. ' + counted
        : 'Classic subtitles, a sentence at a time. Nothing has been transcribed yet, so this waits for the first Generate.'));
    } else {
      host.appendChild(C.row('Words', C.pair(C.slider({
        min: 0, max: 12, step: 1, value: +raw.wordsPerLine || 0,
        fmt: (v) => (v > 0 ? 'up to ' + v : 'auto (up to ' + autoWordsPerLine(fmt) + ')'),
        onChange: (v) => set({ wordsPerLine: v }),
      }), recut)));
      // Two lines at most to choose from; a style that says three (a preset, a hand) is shown as it is.
      const lines = Math.max(1, Math.min(3, Math.round(+st.lines || 2)));
      const LINES = [['1', 'one'], ['2', 'two']].concat(lines === 3 ? [['3', 'three']] : []);
      host.appendChild(C.row('Lines', C.select(LINES, String(lines), (v) => set({ lines: +v }))));
      // In and Out right under Lines; the hint that stood here went (V49, the owner's (пр17)).
      _pageMotionRows(host, st, set, anims);
    }
  }

  host.appendChild(_el('div', 'mv3-c-sep'));
  // A subtitle lane's In and Out are above, under Lines.
  const marks = (track.clips || []).some(c => Array.isArray(c && c.words) && c.words.some(w => w && w.k));
  const rowsO = { fmt, autoS: raw.sizeAuto !== false, textLane: !isSubs, motion: false, marks,
    pages: () => (track.clips || []).map(c => ({ track, clip: c })) };
  if (mix) {
    // Several presets (пр22): the common rows - Where, Nudge, Size - and a section per preset, closed until opened.
    _placeRows(host, st, set, rowsO);
    host.appendChild(_el('div', 'mv3-c-sep'));
    _mixSections(host, track, raw, mix, fmt, marks);
  } else _styleRows(host, st, set, rowsO);

  // Lines that wear a style of their own keep it when the lane's changes (the owner's answer 2). What a mix dealt them is no
  // style of their own, and stays (V49).
  const own = (track.clips || []).filter(c => c && withoutRefs(c.style));
  if (own.length) {
    host.appendChild(_el('div', 'mv3-c-sep'));
    host.appendChild(C.row('', C.button(own.length + (own.length === 1 ? ' line has its' : ' lines have their') + ' own style - reset',
      () => setCapStyleB(own.map(c => c.id), (c) => refsOf(c.style), { replace: true, cut: isSubs }),
      { title: 'Puts those lines back on the lane\'s style' })));
  }
  host.appendChild(_el('div', 'mv3-c-sep'));
  _presetsHint(host);
  _laneRemove(host, track);
  // A press on an animation's tile: the pair on the lane - one pair again; with Shift on the subtitle lane, one more dealt (_shiftAnim).
  const anim = (pair, o) => {
    if (isSubs && o && o.shift) return _shiftAnim(track, raw, st, pair);
    set(Object.assign(pairOf(pair), anims ? { anims: [] } : {}));
  };
  return { preset: mix ? '' : (raw.preset || ''), edited: !mix && !!raw.preset && editedKeys(raw).length > 0, apply, readOnly: !Store.canEdit(),
    presets: mix ? mix.map(e => e.preset).filter(Boolean) : null, editedIds: mix ? mix.filter(_entryEdited).map(e => e.preset) : null,
    kind: isSubs ? 'subs' : 'text', anims: anims ? anims.slice() : [pairNow(st)], anim };
}

// ── Several presets and animations on the subtitle lane (phase V49, point 8c; the owner's (пр17), (пр21)-(пр24)) ──
// A preset as an entry of the lane's mix: its id and its look (style.js LOOK_KEYS) - what its section changes.
function _lookEntry(st) {
  const o = { preset: (st && st.preset) || '' };
  for (const k of LOOK_KEYS) if (st && st[k] !== undefined) o[k] = st[k];
  return o;
}
// An entry changed since its preset was picked.
function _entryEdited(e) {
  const base = e && e.preset ? presetStyle(e.preset) : null;
  return !!base && LOOK_KEYS.some(k => e[k] !== undefined && JSON.stringify(e[k]) !== JSON.stringify(base[k]));
}

// SHIFT ON A PRESET TILE (пр21): the preset joins those dealt - the lane's own look (edits and all) is the first of them - or, picked
// already, leaves them. Two or more: dealt again at random, each page one of them, two in a row never the same (a new seed; the
// lane cut again in the same step - captions/mix.js deals as it cuts). One left: the lane wears it, as a press without Shift.
function _shiftPreset(track, raw, id) {
  const mix = mixOf(raw);
  const cur = mix ? mix.slice() : (raw.preset ? [_lookEntry(raw)] : []);
  const at = cur.findIndex(e => e.preset === id);
  let next;
  if (at >= 0) next = cur.filter((_, i) => i !== at);
  else { const p = presetStyle(id); if (!p) return; next = cur.concat([_lookEntry(p)]); }
  if (next.length >= 2) { setSubsStyleB(track.id, { mix: next, mixSeed: newSeed() }, true); return; }
  // One preset again: its look as it was among them, the lane's common rows as they are.
  if (next.length === 1) setSubsStyleB(track.id, Object.assign({}, raw, next[0], { mix: [] }), true);
}

// SHIFT ON AN ANIMATION'S TILE (пр17): the pair joins those dealt - the lane's own In and Out are the first - or leaves them. Two or more:
// each page one of them at random (dealt without cutting the lane again); one left: the lane's In and Out again.
function _shiftAnim(track, raw, st, pair) {
  const an = animsOf(raw);
  const now = pairNow(st);
  const cur = an ? an.slice() : (now !== 'at-once|none' ? [now] : []);
  const at = cur.indexOf(pair);
  const next = at >= 0 ? cur.filter((_, i) => i !== at) : cur.concat([pair]);
  if (next.length >= 2) {
    // Dealt in the same step as the lane is told (timeline-b.js setSubsStyle's `after`): one step to undo, the lane not cut again.
    setSubsStyleB(track.id, { anims: next, mixSeed: newSeed() }, false, (t) => deal(t.clips, t.style));
    return;
  }
  setSubsStyleB(track.id, Object.assign(pairOf(next[0] || 'at-once|none'), { anims: [] }), false);
}

// The row of a mixed lane where "based on" stands: which presets, and that their mix is saved as no preset of its own (пр23).
function _mixLine(host, mix) {
  const row = _el('div', 'mv3-cap-preset');
  row.appendChild(_el('span', 'mv3-cap-based', 'mixed: ' + mix.map(e => presetName(e.preset) || 'a look').join(', ')));
  row.title = 'Every page wears one of these, at random - Shift on a tile adds a preset or takes it away, a tile without Shift is one preset again';
  host.appendChild(row);
}

// Which sections of a mixed lane are open - closed until opened (пр22), kept across the strip's rebuilds: lane id | preset id.
const _openSec = new Set();

// A SECTION PER PRESET OF THE MIX (пр22): its name and how many pages wear it; opened - its look (Font to Box), for its pages only.
function _mixSections(host, track, raw, mix, fmt, marks) {
  const pages = (track.clips || []).filter(c => c && c.name);
  mix.forEach((e, k) => {
    const n = pages.filter(c => c.style && c.style.mixP === k).length;
    const key = track.id + '|' + (e.preset || '#' + k);
    const open = _openSec.has(key);
    const edited = _entryEdited(e);
    const head = _el('button', 'mv3-cap-sec' + (open ? ' is-open' : ''));
    head.type = 'button';
    head.title = open ? 'Fold it' : 'The look of these pages - font, colours, the spoken word, outline, shadow, box';
    head.appendChild(_el('span', 'mv3-cap-sec-c', open ? '▾' : '▸'));
    head.appendChild(_el('span', 'mv3-cap-sec-n', presetName(e.preset) || 'a look'));
    head.appendChild(_el('span', 'mv3-cap-sec-k', n + (n === 1 ? ' page' : ' pages') + (edited ? ' · edited' : '')));
    head.addEventListener('click', () => { if (_openSec.has(key)) _openSec.delete(key); else _openSec.add(key); render(); });
    host.appendChild(head);
    if (!open) return;
    const body = _el('div', 'mv3-cap-sec-body');
    // Its pages' look: the lane's with this entry dealt on top - what those pages are drawn with.
    const stK = styleOf(track, fmt, { style: { mixP: k } });
    const put = (entry, cut) => setSubsStyleB(track.id, { mix: (raw.mix || []).map((x, i) => (i === k ? entry : x)) }, cut);
    const setK = (patch) => {
      const look = {};
      for (const f of Object.keys(patch || {})) if (LOOK_KEYS.includes(f)) look[f] = patch[f];
      if (Object.keys(look).length) put(Object.assign({}, e, look), _cuts(look));
    };
    if (edited) {
      const base = presetStyle(e.preset);
      const b = C.button('back to the preset', () => put(_lookEntry(base), true), { title: 'Takes away what was changed in this look' });
      b.disabled = !Store.canEdit();
      body.appendChild(C.row('', b));
    }
    _lookRows(body, stK, setK, { fmt, textLane: false, motion: false, marks, setBehind: (v) => setK(_behind(v, stK)) });
    host.appendChild(body);
  });
}

// ── The settings of words, shared by a lane, one caption and several (K6) ────
// The head: what the settings below apply to - the owner's addition: a lane, this line, or several.
function _capHead(host, title, sub) {
  const h = _el('div', 'mv3-cap-head');
  h.appendChild(_el('span', 'mv3-cap-what', title));
  if (sub) h.appendChild(_el('span', 'mv3-cap-sub', sub));
  host.appendChild(h);
}

// "based on Red Pop · edited" and the way back to it - a style made from a preset says which. Where ONE look is shown (a
// lane, a line), `save` - what that look is - puts "save as my preset" in the same row, at the top of the strip where it is
// seen without scrolling (phase V30, block 5, (с49)); a look made from no preset has the row for that button alone.
// `kind` 'text': saved into the text gallery's Mine (V42).
function _presetLine(host, style, back, editedAny, save, kind) {
  const id = style && style.preset;
  const name = id ? presetName(id) : '';
  if (!name && !save) return;
  const row = _el('div', 'mv3-cap-preset' + (name ? '' : ' is-plain'));
  if (name) {
    const edited = editedAny != null ? !!editedAny : editedKeys(style).length > 0;
    row.appendChild(_el('span', 'mv3-cap-based', 'based on ' + name + (edited ? ' · edited' : '')));
    if (edited) {
      const b = C.button('back to the preset', back, { title: 'Takes away what was changed since ' + name + ' was applied' });
      b.disabled = !Store.canEdit();
      row.appendChild(b);
    }
  }
  if (save) row.appendChild(_saveMine(save, kind));
  host.appendChild(row);
}

// SAVE AS MY PRESET (phase V30, block 5; the owner's (с13): with a window for the name). The window offers "My preset" (or
// "My preset 2"…, (с48)); a taken name - one of the person's or of the app's - is refused in it, in the server's words, and
// it stays open (с45). The lane or line it is saved from stays as it was (с46); the new tile is shown in `Mine`.
function _saveMine(lookOf, kind) {
  const b = C.button('save as my preset', () => {
    askName({
      anchor: b.isConnected ? b : null, title: 'Save as my preset', value: MyPresets.freeName(), okLabel: 'Save', maxLength: 60,
      submit: (name) => MyPresets.save(name, lookOf(), kind),
    }).then((p) => { if (p && p.id) CapView.showMine(p.id); });
  }, { title: 'Keeps this look - font, colours, place, effects - as a preset of your own: its tile goes into Mine, to put on any lane or line' });
  b.classList.add('mv3-cap-save');
  return b;
}

// The tiles are always beside the settings when there is room (phase S3, the owner 2026-10-05 - the
// `presets` switch went: the presets are what the view is for). Only a window too narrow for them says so.
function _presetsHint(host) {
  if (_narrow()) host.appendChild(C.hint('The window is too narrow for the presets and the text beside these settings - make it wider.', true));
}

// Every field of a look - Where to Behind. `set(patch)` writes it where it belongs; `autoS` - the lane's
// size is still the format's (a caption has no "auto" of its own); `textLane` - a text lane's: no spoken word there.
// Two halves since V49: where and how big (_placeRows) - common to every page of a lane with several presets - and the look
// (_lookRows), which each of them has its own of.
function _styleRows(host, st, set, o) {
  _placeRows(host, st, set, o);
  _lookRows(host, st, set, o);
}

function _placeRows(host, st, set, o) {
  host.appendChild(C.row('Where', C.select(POS, st.pos, (v) => set({ pos: v }))));
  // Nudged up or down from that anchor, as a fraction of the frame - so it means the same
  // thing after the format changes, which a number of pixels would not. ±80% (phase V30, block 3): a page dragged
  // on the preview anywhere on the frame is still on the slider.
  const side = +st.tx || 0;
  const across = Math.abs(side) < 0.005 ? '' : (side < 0 ? 'left ' : 'right ') + Math.abs(Math.round(side * 100)) + '%';
  // Across, it is moved on the preview only; here it is said, and taken back to the middle.
  const centre = C.button('centre', () => set({ tx: 0 }), {
    title: across ? 'Moved ' + across + ' on the preview - back to the middle across' : 'In the middle across - drag it on the preview to move it sideways',
  });
  centre.disabled = !across || !Store.canEdit();
  const sideBox = _el('span', 'mv3-c-marks');
  if (across) sideBox.appendChild(_el('span', 'mv3-c-num', across));
  sideBox.appendChild(centre);
  host.appendChild(C.row('Nudge', C.pair(C.slider({
    min: -0.80, max: 0.80, step: 0.01, value: +st.ty || 0,
    fmt: (v) => (Math.abs(v) < 0.005 ? 'none' : (v > 0 ? 'down ' : 'up ') + Math.abs(Math.round(v * 100)) + '%'),
    onChange: (v) => set({ ty: v }),
  }), sideBox)));
  // Under a platform's buttons or text (phase V30, block 3, (с36)): said, never refused - on the preview in red.
  if (o.pages) _crossHint(host, o.pages());
  // SIZE IS THE FORMAT'S until it is touched (a lane's): "auto" while nobody has chosen. Up to 200, as a
  // style allows - presets go to 170, and a slider stopping at 120 wrote 120 over them.
  const autoS = !!o.autoS;
  const size = C.slider({ min: 20, max: 200, step: 1, value: st.size, fmt: (v) => v + (autoS ? ' (auto)' : ''),
    onChange: (v) => set({ size: v, sizeAuto: false }) });
  host.appendChild(C.row('Size', o.autoS === undefined ? size : C.pair(size,
    C.toggleNamed('auto', autoS, (on) => set(on ? { sizeAuto: true, size: autoSize(o.fmt) } : { sizeAuto: false }),
      'Let the format choose the size'))));
}

function _lookRows(host, st, set, o) {
  host.appendChild(_el('div', 'mv3-c-sep'));
  // Bold is a choice only where the family ships both weights; a Black or a Bold file is what it is.
  const fontSel = C.select(FONTS, st.font, (v) => set({ font: v }));
  const marks = [];
  if (fontOf(st.font).bold === 'style') marks.push(C.toggleNamed('B', !!st.bold, (on) => set({ bold: on }), 'Bold'));
  marks.push(C.toggleNamed('I', !!st.italic, (on) => set({ italic: on }), 'Italic'));
  const markBox = _el('span', 'mv3-c-marks');
  for (const m of marks) markBox.appendChild(m);
  host.appendChild(C.row('Font', C.pair(fontSel, markBox)));
  const twin = fontOf(st.font).twin;
  if (twin) host.appendChild(C.hint(fontOf(st.font).label + ' has no Russian letters - a line with them is drawn in ' + twin + '.'));
  host.appendChild(C.row('Casing', C.select(CASINGS, st.casing, (v) => set({ casing: v }))));
  host.appendChild(C.row('Colour', C.color(st.primary, (v) => set({ primary: v }))));
  // What the spoken word does - and the colour it is done in.
  host.appendChild(C.row('Spoken', C.select(EFFECTS, st.effect, (v) => set({ effect: v }))));
  if (['color', 'box', 'pop', 'bounce'].includes(st.effect)) {
    host.appendChild(C.row('Its colour', C.color(st.highlight, (v) => set({ highlight: v }))));
  } else if (st.effect === 'karaoke' || st.effect === 'sweep') {
    host.appendChild(C.row('Not yet', C.color(st.secondary, (v) => set({ secondary: v }))));
  }
  // A WORD MADE TO STAND OUT (K10b) wears this colour for its whole page. Shown where a line has one, or once
  // it was set by hand; "auto" is the spoken word's colour - or, where that is the text's own (23 presets),
  // yellow, red or blue, whichever stands out (style.js markedColour).
  if (o.marks || st.marked) {
    host.appendChild(C.row('Marked', C.pair(
      C.color(markedColour(st), (v) => set({ marked: v })),
      C.toggleNamed('auto', !st.marked, (on) => set({ marked: on ? '' : markedColour(st) }),
        'The colour that stands out from this style: the spoken word\'s, or yellow, red or blue'))));
  }
  // A typed line of the subtitle lane plays the spoken word by its letters (phase V30, block 1); a text lane holds titles.
  if (o.textLane && st.effect !== 'none') {
    host.appendChild(C.hint('A text lane has no spoken word - it plays on the Subtitles lane.'));
  }
  if (o.textLane) {
    // IN AND OUT (V42, (о15), (ц4)): each with its length - on a lane for all its lines, on a line for itself.
    const enter = st.enter && st.enter !== 'none' ? st.enter : (APPEAR_AS[st.appear] || 'none');
    host.appendChild(C.row('In', C.select(ENTER_OPTS, enter, (v) => set({ enter: v, appear: 'none' }))));
    if (enter !== 'none') {
      host.appendChild(C.row('Its length', C.slider({ min: 0.1, max: 2, step: 0.05, value: +st.enterDur || 0.5, fmt: _secs,
        onChange: (v) => set({ enterDur: v }) })));
    }
    const leave = st.leave || 'none';
    host.appendChild(C.row('Out', C.select(LEAVE_OPTS, leave, (v) => set({ leave: v }))));
    if (leave !== 'none') {
      host.appendChild(C.row('Its length', C.slider({ min: 0.1, max: 2, step: 0.05, value: +st.leaveDur || 0.4, fmt: _secs,
        onChange: (v) => set({ leaveDur: v }) })));
    }
  } else if (o.motion !== false) {
    // One line's, or several lines': where "Arrives" was (V49, (пр17)).
    _pageMotionRows(host, st, set);
  }

  host.appendChild(_el('div', 'mv3-c-sep'));
  host.appendChild(C.row('Outline', C.pair(
    C.slider({ min: 0, max: 10, step: 0.5, value: +st.outline || 0,
               fmt: (v) => (v > 0 ? v + ' px' : 'none'), onChange: (v) => set({ outline: v }) }),
    C.color(st.outlineColor, (v) => set({ outlineColor: v })),
  )));
  host.appendChild(C.row('Shadow', C.pair(
    C.slider({ min: 0, max: 10, step: 0.5, value: +st.shadow || 0,
               fmt: (v) => (v > 0 ? v + ' px' : 'none'), onChange: (v) => set({ shadow: v }) }),
    C.color(st.shadowColor, (v) => set({ shadowColor: v })),
  )));
  if ((+st.shadow || 0) > 0) {
    host.appendChild(C.row('Its opacity', C.slider({ min: 0, max: 1, step: 0.05, value: st.shadowAlpha == null ? 0.75 : +st.shadowAlpha,
      fmt: C.pct, onChange: (v) => set({ shadowAlpha: v }) })));
  }
  // A box given an opacity only where it would be invisible - never the shown one's copied over another's
  // (review K6: a band wrote the first line's opacity into every line).
  const plate = o.textLane && st.plate && st.plate !== 'none' ? st.plate : '';
  host.appendChild(C.row('Behind', C.select(o.textLane ? BEHIND_TEXT : BEHIND, plate || st.borderStyle,
    (v) => (o.setBehind ? o.setBehind(v) : set(_behind(v, st))))));
  if (plate || st.borderStyle === 'box' || st.borderStyle === 'boxline') {
    host.appendChild(C.row('Box', C.pair(
      C.slider({ min: 0, max: 1, step: 0.05, value: +st.backAlpha || 0, fmt: C.pct,
                 onChange: (v) => set({ backAlpha: v }) }),
      C.color(st.backColor, (v) => set({ backColor: v })),
    )));
  }
  if (!o.textLane) return;
  // A tag's stripe and a typewriter's cursor are the accent (V42; `highlight` - a text lane has no spoken word).
  if (plate === 'tag' || st.enter === 'typewriter' || st.leave === 'backspace') {
    host.appendChild(C.row('Accent', C.color(st.highlight, (v) => set({ highlight: v }))));
  }
  host.appendChild(C.row('Tilt', C.slider({ min: -15, max: 15, step: 0.5, value: +st.tilt || 0,
    // Counter-clockwise is positive, as libass turns.
    fmt: (v) => (Math.abs(v) < 0.05 ? 'none' : (v > 0 ? '↺ ' : '↻ ') + Math.abs(v) + '°'), onChange: (v) => set({ tilt: v }) })));
  host.appendChild(C.row('Glow', C.pair(
    C.slider({ min: 0, max: 10, step: 0.5, value: +st.glow || 0, fmt: (v) => (v > 0 ? String(v) : 'none'), onChange: (v) => set({ glow: v }) }),
    C.color(st.glowColor || st.primary, (v) => set({ glowColor: v })),
  )));
}

// A SUBTITLE PAGE'S IN AND OUT (phase V49, (пр16)-(пр18)): the In shown is the one chosen, or the preset's own way of arriving
// while none is (style.js `appear`, (пр20)); "at once" chosen takes that away too. Their lengths are the app's.
// With several animations dealt (`anims`, V49): a side the pairs do not share says "mixed", and choosing one puts it on every pair -
// the other side stays dealt.
function _pageMotionRows(host, st, set, anims) {
  if (anims) {
    const side = (k) => [...new Set(anims.map(p => pairOf(p)[k]))];
    const ins = side('enter'), outs = side('leave');
    const mixed = (n) => [['', 'mixed · ' + n]];
    host.appendChild(C.row('In', C.select(ins.length > 1 ? mixed(ins.length).concat(PAGE_IN) : PAGE_IN, ins.length > 1 ? '' : ins[0],
      (v) => { if (v) set({ anims: anims.map(p => v + '|' + pairOf(p).leave) }); })));
    host.appendChild(C.row('Out', C.select(outs.length > 1 ? mixed(outs.length).concat(PAGE_OUT) : PAGE_OUT, outs.length > 1 ? '' : outs[0],
      (v) => { if (v) set({ anims: anims.map(p => pairOf(p).enter + '|' + v) }); })));
    return;
  }
  host.appendChild(C.row('In', C.select(PAGE_IN, shownEnter(st) || 'at-once', (v) => set({ enter: v }))));
  host.appendChild(C.row('Out', C.select(PAGE_OUT, PAGE_LEAVES.includes(st.leave) ? st.leave : 'none', (v) => set({ leave: v }))));
}

// WHAT A PLATFORM'S SCREEN COVERS (phase V30, block 3; the owner's (с36): a mark, nothing refused or moved): with
// TikTok, Shorts or Instagram over the preview, how many of these pages lie under which of its elements - every page
// of the lane, not only the one on screen.
function _crossHint(host, items) {
  const id = Platforms.current();
  if (!id || !items || !items.length) return;
  const F = renderFrame('9:16');
  let n = 0;
  const groups = new Set();
  for (const x of items) {
    if (!x.clip || !x.clip.name || !((+x.clip.dur) > 0)) continue;
    const b = pageBox(x.clip, x.track.style, x.track.kind === 'subs', F.w, F.h);
    const hit = Platforms.crossed(b.lines, F.w, F.h);
    if (!hit.length) continue;
    n++;
    for (const h of hit) groups.add(h.g);
  }
  if (!n) return;
  const many = items.length > 1;
  const h = C.hint((many ? n + (n === 1 ? ' page crosses' : ' pages cross') : 'This page crosses') + ' the '
    + Platforms.nameOf(id) + ' ' + [...groups].join(' / ') + ' - outlined in red on the preview; drag it clear, or leave it.');
  h.classList.add('is-warn');
  host.appendChild(h);
}

// SEVERAL CAPTIONS (K6): picked by a band, on one lane of words or two - one look for them all, as
// their own style; anything else picked with them and this is not shown (_renderMany is).
function _renderCaptions(host, items) {
  const tl = Store.timeline();
  const fmt = (tl && tl.format) || '9:16';
  const ids = items.map(x => x.clip.id);
  const lanes = [...new Set(items.map(x => x.track.name || x.track.kind))];
  _capHead(host, items.length + ' lines', 'on ' + lanes.join(' and '));
  const first = items[0];
  // "based on" only when EVERY picked line wears the same preset - one line's preset put on the others by
  // "back to the preset" replaced theirs (review K6); edited when any of them is.
  const presetOfItem = (x) => (x.clip.style && x.clip.style.preset) || '';
  const common = items.every(x => presetOfItem(x) === presetOfItem(first)) ? presetOfItem(first) : '';
  const anyEdited = !!common && items.some(x => editedKeys(x.clip.style).length > 0);
  // Each line given the whole preset - a text preset where that line is now (V42, (ц3)).
  // A subtitle line keeps its In and Out (V49, (пр20)): what it set itself, the rest its lane's.
  const wear = (id) => {
    if (presetStyle(id)) {
      setCapStyleB(ids, (c, t) => { const p = placed(id, styleOf(t, fmt, c)); return t.kind === 'subs' ? keepMotion(p, c.style || {}, true) : p; },
        { replace: true, cut: true });
    }
  };
  if (common) _presetLine(host, first.clip.style, () => wear(common), anyEdited);
  const st = styleOf(first.track, fmt, first.clip);
  const set = (patch) => setCapStyleB(ids, patch, { cut: _cuts(patch) });
  const setBehind = (v) => setCapStyleB(ids, (c, t) => _behind(v, styleOf(t, fmt, c)), { cut: true });
  host.appendChild(_el('div', 'mv3-c-sep'));
  _styleRows(host, st, set, { fmt, textLane: items.every(x => x.track.kind !== 'subs'), setBehind, marks: (items.map(x => x.clip)).some(c => Array.isArray(c && c.words) && c.words.some(w => w && w.k)),
    pages: () => items });
  if (items.some(x => x.clip.style)) {
    host.appendChild(_el('div', 'mv3-c-sep'));
    host.appendChild(C.row('', C.button('back to the lane\'s style', () => setCapStyleB(ids, null, { cut: true }),
      { title: 'These lines wear their lane\'s style again' })));
  }
  host.appendChild(_el('div', 'mv3-c-sep'));
  _presetsHint(host);
  host.appendChild(C.row('', C.button('Delete ' + items.length + ' lines', () => deleteMultiB(),
    { danger: true, title: 'Also on the Delete key' })));
  // The pair they all wear is lit (V49); a press puts one on each.
  const pairs = new Set(items.map(x => pairNow(styleOf(x.track, fmt, x.clip))));
  return { preset: common, edited: anyEdited, apply: wear, readOnly: !Store.canEdit(),
    kind: items.every(x => x.track.kind === 'text') ? 'text' : 'subs',
    anims: pairs.size === 1 ? [...pairs] : [], anim: (pair) => setCapStyleB(ids, pairOf(pair), { cut: false }) };
}

// A caption: words and when. No length field, the same as every other clip here - the edges
// set the timing, and they also say which part of the sound the line belongs to, which a
// number typed into a box cannot.
function _blankCaption(host, track, clip) {
  const tl = Store.timeline();
  const fmt = (tl && tl.format) || '9:16';
  // What a lane's mix dealt it is not a style of its own (V49): its own is what is left.
  const own = !!withoutRefs(clip.style);
  const drawn = styleOf(track, fmt, clip);
  const dealt = track.kind === 'subs' && !!mixOf(track.style) && !own && drawn.preset ? presetName(drawn.preset) : '';
  _capHead(host, 'This line', 'on ' + (track.name || track.kind) + (own ? ' · its own style' : dealt ? ' · ' + dealt : ''));
  // What is saved is the look the line is drawn with: its lane's style with its own on top (the cut is the lane's).
  // A text preset keeps where the line is now (V42, (ц3)).
  const wear = (id, cut) => {
    const p = placed(id, styleOf(track, fmt, clip));
    if (p) setCapStyleB([clip.id], track.kind === 'subs' ? keepMotion(p, clip.style || {}, true) : p, { replace: true, cut });
  };
  _presetLine(host, own ? clip.style : null, () => wear(clip.style.preset, true),
    undefined, () => resolveStyle(track.style, clip.style), track.kind === 'text' ? 'text' : '');
  const heardLine = isHeard(clip);
  const area = C.textarea(clip.name || '', (v) => {
    // NEVER THE OLD TEXT OVER A NEWER ONE (review K10): the box writes the WHOLE text, and the line may have
    // changed after the box was painted - a word corrected just before the box was clicked, a lay. Then what
    // was typed is not written over it, and is said in the note to be put in again.
    const cur = _captionName(track.id, clip.id);
    if (cur == null) {
      if (v !== area.__painted) note(area, 'That line is not on the lane any more - your text was not written.', 'You typed: «' + v + '»');
      return;
    }
    if (cur !== area.__painted) {
      if (v !== area.__painted) note(area, 'The line changed meanwhile - your text was not written over it.', 'It reads now: «' + cur + '». You typed: «' + v + '»');
      return;
    }
    const r = setCapTextB(track.id, clip.id, v);
    if (r && r.why) note(area, 'The text was not changed.', r.why);
  }, 3);
  area.maxLength = 400;
  area.__painted = clip.name || '';
  area.__ids = { track: track.id, clip: clip.id };
  // Escape takes back what was typed and keeps the line picked (K10b - it let go of the line, and of the
  // typing with it). Enter keeps a heard line's text and goes on to its words; a typed line may hold line
  // breaks, so there Enter is one.
  area.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      area.value = clip.name || '';
      area.blur();
    } else if (e.key === 'Enter' && !e.shiftKey && heardLine) {
      e.preventDefault(); e.stopPropagation();
      const changed = area.value !== area.__painted;
      area.blur();
      // No words of this line on screen and none coming (rewritten before K10 and not timed - its text did not
      // change now): the focus stays in its text, in the box painted now if the blur repainted the strip (review
      // K10) - left on nothing, the next Delete would be the timeline's, and it takes the whole line. A changed
      // text is timed by its change and painted with its words, which then take the focus.
      if (!WordEdit.focusList(clip.id, changed)) {
        const box = [...document.querySelectorAll('#mv3-over textarea.mv3-c-area')].find(t => t.__ids && t.__ids.clip === clip.id) || area;
        if (box.isConnected) box.focus({ preventScroll: true });
      }
    }
  });
  host.appendChild(area);
  host.appendChild(C.hint('Drag the caption to move it, and its edges to change how long it '
    + 'stays up.'));

  if (heardLine) {
    // A HEARD LINE KEEPS ITS TIMING WHEN IT IS REWRITTEN (K10): the words that stay keep their moments, new
    // ones share the time of what they replace (words.js) - and each word can be changed by itself (K10b).
    host.appendChild(_el('div', 'mv3-c-sep'));
    const fixed = correctedCount(clip);
    host.appendChild(_fact('Timed', clip.words.length + ' words' + (fixed ? ' · ' + fixed + ' corrected' : '')));
    if (spells(clip.words, clip.name)) {
      WordEdit.paint(host, track, clip, { mark: markedColour(styleOf(track, fmt, clip)) });
      // Corrections can make a line more than a page of its lane holds; a correction never cuts by itself.
      const over = isCorrected(clip) ? overPage(clip, track.style, fmt) : null;
      if (over) {
        host.appendChild(C.hint('Longer than a page of this lane: ' + over + '.'));
        host.appendChild(C.row('', C.button('re-cut this line', () => recutLinesB(track.id, [clip.id]),
          { title: 'Cuts this line into pages by the lane\'s rules, keeping its words and corrections' })));
      }
    } else {
      // Rewritten before K10: its words still say what was heard, and it is drawn as one piece until timed.
      host.appendChild(C.hint('The text was changed by hand; its words still say: ' + textOf(clip.words)));
      host.appendChild(C.row('', C.button('time the text', () => {
        const r = setCapTextB(track.id, clip.id, clip.name || '');
        if (r && r.why) note(area, 'Not timed.', r.why);
      }, { title: 'Gives the words of the text the moments of the words heard there' })));
    }
  }
  // Arrived by Tab from the last word of the line before, on a line with no chips (typed, or rewritten before
  // K10): it is read on in its text - the focus must land somewhere, or the next Delete is the timeline's.
  if (WordEdit.wantsText(clip.id)) {
    area.focus({ preventScroll: true });
    area.select();
  }

  // ITS OWN LOOK (the owner's addition, 2026-10-03): what is changed here is this line's, over its lane's.
  host.appendChild(_el('div', 'mv3-c-sep'));
  const heard = isHeard(clip);
  _styleRows(host, styleOf(track, fmt, clip), (patch) => setCapStyleB([clip.id], patch, { cut: heard && _cuts(patch) }),
    { fmt, textLane: track.kind !== 'subs', marks: ([clip]).some(c => Array.isArray(c && c.words) && c.words.some(w => w && w.k)),
      pages: () => [{ track, clip }] });
  if (own) {
    host.appendChild(_el('div', 'mv3-c-sep'));
    host.appendChild(C.row('', C.button('back to the lane\'s style', () => setCapStyleB([clip.id], refsOf(clip.style), { replace: true, cut: heard }),
      { title: 'This line wears its lane\'s style again' })));
  }
  host.appendChild(_el('div', 'mv3-c-sep'));
  _presetsHint(host);
  host.appendChild(C.row('', C.button('Remove this line', () => removeB(track.id, clip.id), {
    danger: true, title: 'Takes the caption off the lane',
  })));
  // ITS tiles lit (V49, (пр17)): the preset it is drawn with - its own, the one its lane's mix dealt it, or its lane's.
  const s = own ? clip.style : null;
  return { preset: s ? (s.preset || '') : (drawn.preset || ''), edited: !!(s && s.preset) && editedKeys(withoutRefs(s)).length > 0,
    apply: (id) => wear(id, heard), readOnly: !Store.canEdit(), kind: track.kind === 'text' ? 'text' : 'subs',
    anims: [pairNow(styleOf(track, fmt, clip))], anim: (pair) => setCapStyleB([clip.id], pairOf(pair), { cut: false }) };
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

  // (phase V28.4) Its file was deleted from the library: said first, with the way to be rid of it - and the way to
  // replace it, which is a tile from the Library let go on the clip.
  if (Store.isGone(clip)) {
    const g = _el('div', 'mv3-ins-gone');
    g.appendChild(_el('b', null, 'The file of this clip was deleted from the library'));
    g.appendChild(_el('span', null, 'Let a tile from the Library go on the red clip to replace it - from the same second, at its own length - or remove it.'));
    host.appendChild(g);
    host.appendChild(C.row('', C.button('Remove', () => removeB(track.id, clip.id),
      { danger: true, title: track.kind === 'video' && pair ? 'Its sound goes with it' : 'Take it off the timeline' })));
    host.appendChild(_el('div', 'mv3-c-sep'));
  }

  if (track.kind === 'subs' || track.kind === 'text') return _blankCaption(host, track, clip);
  if (track.kind === 'audio') return _blankSound(host, track, clip, set, pair);
  if (still) return _blankStill(host, track, clip, set);
  return _blankFilm(host, track, clip, set, pair);
}

function _renderMany(host, n) {
  const h = document.createElement('div');
  h.className = 'mv3-ins-title';
  h.textContent = n + ' clips selected';
  host.appendChild(h);

  // (phase V49, (пр9)) Main clips among them - cut silence's pieces - are made a PiP, and sized and moved, all at once.
  const mains = pickedB().filter(x => isMainVideo(x.track));
  if (mains.length) {
    if (mains.length < n) host.appendChild(C.hint('The PiP below is for the ' + mains.length + ' picked clips of main video.'));
    _pipSection(host, mains);
    _bsep(host);
  } else {
    const p = document.createElement('div');
    p.className = 'mv3-ins-note';
    p.textContent = 'Settings are per clip, so there is nothing here to set for several at once. '
                  + 'What can be done to all of them is remove them.';
    host.appendChild(p);
  }

  host.appendChild(C.row('', C.button('Delete ' + n + ' clips', () => deleteMultiB(),
    { danger: true, title: 'Also on the Delete key' })));
}

// THE CAPTIONS VIEW FOLLOWS THE PICK (K6): up while captions are picked and the tiles are open, gone
// with the pick - lib-views.js puts the shelf or the chat back, and the room with it.
function render(force) {
  if (_held) { _pending = true; return; }
  // NOT UNDER THE CURSOR (K10b): a store change - the save landing half a second after an edit, the watcher, a
  // lay - waits while a text field in the strip is being typed in, and paints when it is left. A change of the
  // pick (`force`) writes the field into its own line first (onSelB) and paints at once. The words of a caption
  // keep their own field across a paint (word-edit.js), so they do not hold it.
  if (!force && _typing) { _typedPending = true; _freshenField(); return; }
  let cap;
  WordEdit.beforeRepaint();
  try { cap = _render(); } finally { WordEdit.afterRepaint(); }
  const was = Views.isCaptions();
  // While a band is swept the view stays as it was - it follows the pick when the band is let go.
  const on = gestureB() ? was : (!!cap && !_narrow());
  _capApply = cap ? cap.apply : null;
  _capAnim = cap && cap.anim ? cap.anim : null;
  if (on && cap) CapView.show(cap); else if (!on) CapView.hide();
  Views.setCaptions(on);
  // The timeline has just shrunk under the pick: the picked lane back in view, the lit tile too.
  if (on && !was) requestAnimationFrame(() => requestAnimationFrame(() => { revealSelB(); CapView.revealLit(); }));
}

// ROOM FOR THE TILES (K6): the strip keeps its 350px and the tiles want one column beside it - a 96px tile and
// the grid's padding (phase S1 made them squares of 88-96px; K6's 9:16 ones wanted 170). Decided on every
// paint from what the panel holds with the corner moved - not latched from one reading, which a sash dragged
// narrow in the chat turned off for the session (review K6). A window that cannot give it shows the strip
// alone, as before K6, and says so.
const CAP_ROOM = 350 + 116;
function _narrow() {
  const col = document.getElementById('mv3-left');
  const lib = document.getElementById('mv3-library');
  if (!col || !lib || lib.classList.contains('is-collapsed')) return false;
  // What of the column is not the Library (a folded Setup's spine) stays not the Library.
  const other = Math.max(0, col.getBoundingClientRect().width - lib.getBoundingClientRect().width);
  return columnMax() - other < CAP_ROOM;
}
window.addEventListener('resize', () => { if (oneB() || trackB() || multiB() > 1) render(); });

function _render() {
  const host = _host();
  const over = _overHost();
  if (host) {
    host.textContent = '';
    // A step may lay the panel out itself (js/merge-v3/wk-setup.js); this is where that
    // arrangement ends, so the next thing to paint gets the ordinary scroll box back.
    host.className = 'mv3-panel-body';
  }
  if (over) over.textContent = '';
  // A PROJECT THAT IS NOT A TALKING HEAD HAS NO SETUP (phase L), and its spine is hidden. Whatever left
  // it open - a blank project, or the draft, opened after a talking head's setup - the Library is the
  // open panel.
  if (!WK.isTalking()) {
    const ins = document.getElementById('mv3-inspector');
    if (ins && !ins.classList.contains('is-collapsed')) setOpenColumn('library');
  }
  // A talking-head project is built in a fixed order, and while it is being built the Setup
  // panel belongs to it - the timeline is locked, so nothing on it can be picked anyway.
  if (WK.active()) { _over(false); return host && WK.paint(host); }
  if (!over || !blankMounted()) return _over(false);
  // A BAND SELECTION OUTRANKS the single one. It is the more deliberate of the two - the
  // single selection is usually just whatever the pointer passed over on the way to drawing
  // the band - and settings for four clips at once have no honest meaning, so what the strip
  // offers is the one thing that does: getting rid of them.
  const many = multiB();
  if (many > 1) {
    _over(true);
    const caps = capsB();
    if (caps && caps.length === many) return _renderCaptions(over, caps);
    return _renderMany(over, many);
  }
  const one = oneB();
  if (one) { _over(true); return _renderBlankClip(over, one); }
  const tr = trackB();
  if (tr) { _over(true); return _renderBlankTrack(over, tr); }
  // (phase V33.3) Nothing picked, and a view's own captions up (a highlights project's ticked fragments): its strip and target.
  const alt = Views.altCaptions();
  if (alt) { _over(true); return alt.render(over); }
  // Nothing picked: the strip goes, and the Library under it is what is left (phase L).
  _over(false);
}

export function initInspector() {
  // Selecting something is what OPENS a panel, as opposed to the store change below which
  // only refreshes the one already open. The Music panel remembers which of its two halves
  // was last in front, and this is where that memory is allowed to expire. The band changes
  // nothing in the store, so the timeline says so itself.
  onSelB(() => {
    // A build step is NOT left that way: selecting a clip while composing frames is a slip of
    // the pointer far more often than it is a decision to go and edit the cut.
    if (WK.active()) return;
    // WHAT WAS BEING TYPED GOES INTO ITS OWN LINE FIRST (K10b). A press on the timeline never takes the focus
    // (its mousedown is prevented), so the field is still open on the line picked before: the words' field is
    // written by the ids it was opened with, a text field by its own change on the blur.
    WordEdit.leave();
    const a = document.activeElement;
    if (a && a.closest && a.closest('#mv3-over') && _isTextField(a)) a.blur();
    M.resetView();
    render(true);
  });
  WK.onChange(() => render());
  // A tile pressed applies its preset to what is picked; "Library" in the captions view lets the pick go.
  CapView.onApply((id, o) => { if (_capApply) _capApply(id, o); });
  // A pair of In and Out pressed (V49) - on what is picked; with Shift, one more dealt.
  CapView.onAnim((pair, o) => { if (_capAnim) _capAnim(pair, o); });
  // The person's own presets (phase V30, block 5): read once, and a change paints the strip - "based on" a preset of theirs
  // is said once the list is known, and goes when the preset is deleted.
  MyPresets.onChange(() => render());
  MyPresets.load();
  Views.onBack('captions', () => { const alt = !!Views.altCaptions(); Views.altRelease(); clearSelB(); if (alt) render(true); });
  // (phase V18.2) The "captions" crumb from another view: the subtitle lane picked - every timeline has one, and it
  // cannot be removed - and the captions view follows the pick as it always has. (phase V33.3) Unless a view offers a
  // target of its own (a highlights project's ticked fragments, lib-views.js captionsAlt): then that, with nothing picked.
  Views.onOpen('captions', () => {
    if (Views.altWants()) { clearSelB(); Views.altOpen(); return; }
    const subs = (((Store.timeline() || {}).tracks) || []).find(t => t.kind === 'subs');
    if (subs) selectTrackB(subs.id);
  });
  Views.onAltChange(() => render(true));
  // The job of the open project, as it goes. Repainted only while the subtitle lane itself is what
  // the strip shows: the strip is rebuilt whole, and a caption being typed would lose its cursor.
  Listen.init();
  Listen.readLocal();
  Listen.onChange(() => {
    // Not over a talking head's Setup: render() would rebuild it whole.
    if (WK.active()) return;
    const tr = trackB();
    if (!(tr && tr.kind === 'subs' && !oneB() && multiB() <= 1)) return;
    const v = Listen.view(Store.key());
    const el = document.querySelector('#mv3-over [data-listen-line]');
    if (el && _listenShape && _listenShape.key === Store.key() && _listenShape.busy === v.busy
      && _listenShape.ask === v.ask && _listenShape.again === v.again && _listenShape.heard === v.heard
      && _listenShape.local === Listen.local()) {
      el.textContent = v.line;
      el.hidden = !v.line;
      return;
    }
    render();
  });
  // Also on every store change: trimming a clip changes the numbers on show, and an
  // undo can remove the very clip being inspected.
  Store.onChange(() => render());
  // A platform's screen over the preview, or none: the strip says which pages lie under it (phase V30, block 3).
  Platforms.onChange(() => render());

  // pointerdown/up on the document rather than on the panel: a drag that starts on a
  // slider often ends with the pointer somewhere else entirely, and a listener on the
  // panel would never see the release.
  document.addEventListener('pointerdown', (e) => {
    if (e.target && e.target.closest && e.target.closest('#mv3-inspector, #mv3-over')) _held = true;
  });
  document.addEventListener('pointerup', () => {
    if (!_held) return;
    _held = false;
    if (_pending) { _pending = false; render(); }
  });
  // The field being typed in (see _typing). On the strip itself, which is never rebuilt - only its insides.
  const over = document.getElementById('mv3-over');
  if (over) {
    // A field of the strip that holds typing not written yet - a caption's text, a word - keeps a newer copy of
    // the project from being adopted under it (store.js setTyping; review K10). Fields that know what they were
    // painted with say so (`__painted`); the rest are not typing a line. A line of the captions view's document
    // (caption-doc.js, phase V30 block 2) is one of them.
    Store.setTyping(() => {
      const a = document.activeElement;
      return !!(a && a.__painted != null && a.closest && a.closest('#mv3-over, #mv3-cap') && a.value !== a.__painted);
    });
    over.addEventListener('focusin', (e) => { _typing = _isTextField(e.target); });
    over.addEventListener('focusout', (e) => {
      // Left: whatever it wrote is written now (its change came first), and a copy held back for it comes in.
      setTimeout(() => Store.typingDone(), 0);
      if (!_isTextField(e.target)) return;
      _typing = false;
      if (_typedPending) { _typedPending = false; setTimeout(() => render(), 0); }
    });
  }
}
