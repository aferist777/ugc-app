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
         setClipFields as setManyB,
         removeTrack as removeTrackB, playhead as playheadB,
         stampTrack as stampB, resetTrack as resetTrackB,
         addCaption as addCapB, setCaptionText as setCapTextB,
         setSubsStyle as setSubsStyleB, setSubsListen as setListenB,
         setCaptionStyle as setCapStyleB, selectedCaptions as capsB, clearSelection as clearSelB,
         revealSelection as revealSelB, gesture as gestureB, recutLines as recutLinesB,
         selectTrackById as selectTrackB } from './timeline-b.js';
import * as CapView from './captions-view.js';
import * as Views from './lib-views.js';
import { presetStyle, presetName, editedKeys } from '../captions/preset-use.js';
import { isHeard } from '../captions/heard.js';
import { styleOf, autoSize, autoWordsPerLine } from './subs-b.js';
import { wordsOf, CUT_KEYS } from '../captions/pages.js';
import { listenOf } from '../captions/heard.js';
import * as Listen from './listen.js';
import { askDelete, note } from './ask.js';
import { spells, textOf, correctedCount, isCorrected } from '../captions/words.js';
import { overPage } from '../captions/pages.js';
import { markedColour } from '../captions/style.js';
import * as WordEdit from './word-edit.js';
import { FONTS as CAP_FONTS, fontOf } from '../captions/fonts.js';
import * as WK from './workshop.js';
import { isStill } from './store.js';
import * as C from './controls.js';
import * as M from './music.js';
import { setOpenColumn, columnMax } from './layout.js';

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

// Transition, animation and filter - the values lib/mv3b-render.js builds them from.
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

  _bsep(host);
  _halferRows(host, c, set);

  if (!c.halfer) {
    _bsep(host);
    // PLACED OR FITTED, never both. A clip laid on the frame at a third of its width is not
    // being fitted to anything, so the fit controls would be two settings with nothing to act on.
    if (_isPlaced(c)) _pipRows(host, track, c);
    else _frameRows(host, c, set);

    _bsep(host);
    _blankFx(host, c, set);
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
  const placed = _isPlaced(c);

  if (c.halfer) {
    // A band takes none of these: its settings are the section under the picture.
    stack.appendChild(C.hint('A halfer band - its settings are below.'));
  } else {
    cell('transition', C.select(C.TRANSITIONS, c.transition || 'none', (v) => set('transition', v)));
    // No zoom on a placed insert - see the note on _fxTriple.
    if (!placed) cell('animation', C.select(C.ANIMATIONS, c.animation || 'none', (v) => set('animation', v)));
    cell('filter', C.select(C.FILTERS, c.filter || 'none', (v) => set('filter', v)));
  }

  if (c.halfer) {
    // nothing: no placement or framing on a band
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

  _bsep(host);
  _halferRows(host, c, set);
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
// What makes a line wider or narrower - or a page hold more - cuts the heard pages again, in the same
// step (K2, the owner's answer 3): a page cut for one font is not a page in another. The list is pages.js's.
const CUTS = CUT_KEYS;
const _cuts = (patch) => Object.keys(patch || {}).some(k => CUTS.includes(k));

// What a word does while it is spoken, how a page arrives, how it is cased, what stands behind it (K0's
// fields, given controls in K6).
const EFFECTS = [['none', 'none'], ['color', 'colour'], ['box', 'a box'], ['pop', 'pop'], ['bounce', 'jump'],
  ['sweep', 'sweep'], ['karaoke', 'karaoke']];
const APPEARS = [['none', 'at once'], ['pop', 'pops in'], ['fade', 'fades in'], ['slide', 'slides up']];
const CASINGS = [['none', 'as typed'], ['upper', 'UPPER'], ['lower', 'lower'], ['title', 'Title']];
const BEHIND = [['outline', 'nothing'], ['box', 'a box'], ['boxline', 'box + outline']];

// What a press on a preset tile applies it to - set by whichever strip is painted (render).
let _capApply = null;

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
  // A preset REPLACES the lane's style (every field - the owner's answer 1); a subtitle lane is cut again.
  const apply = (id) => { const s = presetStyle(id); if (s) setSubsStyleB(track.id, s, isSubs); };
  const pagesNow = (track.clips || []).filter(isHeard).length;
  _capHead(host, track.name || (isSubs ? 'Subtitles' : 'Text'), 'the whole lane' + (isSubs && pagesNow ? ' · ' + pagesNow + ' pages' : ''));
  _presetLine(host, raw, () => apply(raw.preset));

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
    host.appendChild(C.row('Words', C.pair(C.slider({
      min: 0, max: 12, step: 1, value: +raw.wordsPerLine || 0,
      fmt: (v) => (v > 0 ? 'up to ' + v : 'auto (up to ' + autoWordsPerLine(fmt) + ')'),
      onChange: (v) => set({ wordsPerLine: v }),
    }), recut)));
    // Two lines at most to choose from; a style that says three (a preset, a hand) is shown as it is.
    const lines = Math.max(1, Math.min(3, Math.round(+st.lines || 2)));
    const LINES = [['1', 'one'], ['2', 'two']].concat(lines === 3 ? [['3', 'three']] : []);
    host.appendChild(C.row('Lines', C.select(LINES, String(lines), (v) => set({ lines: +v }))));
    const pages = (track.clips || []).filter(c => Array.isArray(c.words) && c.words.length).length;
    const most = +raw.wordsPerLine > 0 ? +raw.wordsPerLine : autoWordsPerLine(fmt);
    host.appendChild(C.hint(heard
      ? 'A page ends at a sentence, at a pause, at a comma after two words, and before a line would run '
        + 'wider than 78% of the frame - with at most ' + most + (most === 1 ? ' word' : ' words') + '. '
        + heard + ' heard words on ' + pages + (pages === 1 ? ' page' : ' pages')
        + '; changing these cuts them again straight away, lines you typed stay as they are.'
      : 'How the transcript gets cut into pages. Nothing has been transcribed yet, so this waits '
        + 'for the first Generate.'));
  }

  host.appendChild(_el('div', 'mv3-c-sep'));
  _styleRows(host, st, set, { fmt, autoS: raw.sizeAuto !== false, textLane: !isSubs, marks: (track.clips || []).some(c => Array.isArray(c && c.words) && c.words.some(w => w && w.k)) });

  // Lines that wear a style of their own keep it when the lane's changes (the owner's answer 2).
  const own = (track.clips || []).filter(c => c && c.style && Object.keys(c.style).length);
  if (own.length) {
    host.appendChild(_el('div', 'mv3-c-sep'));
    host.appendChild(C.row('', C.button(own.length + (own.length === 1 ? ' line has its' : ' lines have their') + ' own style - reset',
      () => setCapStyleB(own.map(c => c.id), null, { cut: isSubs }),
      { title: 'Puts those lines back on the lane\'s style' })));
  }
  host.appendChild(_el('div', 'mv3-c-sep'));
  _presetsHint(host);
  _laneRemove(host, track);
  return { preset: raw.preset || '', edited: !!raw.preset && editedKeys(raw).length > 0, apply, readOnly: !Store.canEdit() };
}

// ── The settings of words, shared by a lane, one caption and several (K6) ────
// The head: what the settings below apply to - the owner's addition: a lane, this line, or several.
function _capHead(host, title, sub) {
  const h = _el('div', 'mv3-cap-head');
  h.appendChild(_el('span', 'mv3-cap-what', title));
  if (sub) h.appendChild(_el('span', 'mv3-cap-sub', sub));
  host.appendChild(h);
}

// "based on Red Pop · edited" and the way back to it - a style made from a preset says which.
function _presetLine(host, style, back, editedAny) {
  const id = style && style.preset;
  const name = id ? presetName(id) : '';
  if (!name) return;
  const edited = editedAny != null ? !!editedAny : editedKeys(style).length > 0;
  const row = _el('div', 'mv3-cap-preset');
  row.appendChild(_el('span', 'mv3-cap-based', 'based on ' + name + (edited ? ' · edited' : '')));
  if (edited) {
    const b = C.button('back to the preset', back, { title: 'Takes away what was changed since ' + name + ' was applied' });
    b.disabled = !Store.canEdit();
    row.appendChild(b);
  }
  host.appendChild(row);
}

// The tiles are always beside the settings when there is room (phase S3, the owner 2026-10-05 - the
// `presets` switch went: the presets are what the view is for). Only a window too narrow for them says so.
function _presetsHint(host) {
  if (_narrow()) host.appendChild(C.hint('The window is too narrow for the presets beside these settings - make it wider.', true));
}

// Every field of a look - Where to Behind. `set(patch)` writes it where it belongs; `autoS` - the lane's
// size is still the format's (a caption has no "auto" of its own); `textLane` - a text lane's: no spoken word there.
function _styleRows(host, st, set, o) {
  host.appendChild(C.row('Where', C.select(POS, st.pos, (v) => set({ pos: v }))));
  // Nudged up or down from that anchor, as a fraction of the frame - so it means the same
  // thing after the format changes, which a number of pixels would not.
  host.appendChild(C.row('Nudge', C.slider({
    min: -0.30, max: 0.30, step: 0.01, value: +st.ty || 0,
    fmt: (v) => (Math.abs(v) < 0.005 ? 'none' : (v > 0 ? 'down ' : 'up ') + Math.abs(Math.round(v * 100)) + '%'),
    onChange: (v) => set({ ty: v }),
  })));
  // SIZE IS THE FORMAT'S until it is touched (a lane's): "auto" while nobody has chosen. Up to 200, as a
  // style allows - presets go to 170, and a slider stopping at 120 wrote 120 over them.
  const autoS = !!o.autoS;
  const size = C.slider({ min: 20, max: 200, step: 1, value: st.size, fmt: (v) => v + (autoS ? ' (auto)' : ''),
    onChange: (v) => set({ size: v, sizeAuto: false }) });
  host.appendChild(C.row('Size', o.autoS === undefined ? size : C.pair(size,
    C.toggleNamed('auto', autoS, (on) => set(on ? { sizeAuto: true, size: autoSize(o.fmt) } : { sizeAuto: false }),
      'Let the format choose the size'))));

  host.appendChild(_el('div', 'mv3-c-sep'));
  // Bold is a choice only where the family ships both weights; a Black or a Bold file is what it is.
  const fontSel = C.select(FONTS, st.font, (v) => set({ font: v }));
  const marks = [];
  if (fontOf(st.font).bold === 'style') marks.push(C.toggleNamed('B', !!st.bold, (on) => set({ bold: on }), 'Bold'));
  marks.push(C.toggleNamed('I', !!st.italic, (on) => set({ italic: on }), 'Italic'));
  const markBox = _el('span', 'mv3-c-marks');
  for (const m of marks) markBox.appendChild(m);
  host.appendChild(C.row('Font', C.pair(fontSel, markBox)));
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
  host.appendChild(C.row('Arrives', C.select(APPEARS, st.appear, (v) => set({ appear: v }))));

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
  host.appendChild(C.row('Behind', C.select(BEHIND, st.borderStyle,
    (v) => (o.setBehind ? o.setBehind(v) : set(v !== 'outline' && !(+st.backAlpha) ? { borderStyle: v, backAlpha: 0.6 } : { borderStyle: v })))));
  if (st.borderStyle === 'box' || st.borderStyle === 'boxline') {
    host.appendChild(C.row('Box', C.pair(
      C.slider({ min: 0, max: 1, step: 0.05, value: +st.backAlpha || 0, fmt: C.pct,
                 onChange: (v) => set({ backAlpha: v }) }),
      C.color(st.backColor, (v) => set({ backColor: v })),
    )));
  }
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
  if (common) _presetLine(host, first.clip.style,
    () => setCapStyleB(ids, presetStyle(common), { replace: true, cut: true }), anyEdited);
  const st = styleOf(first.track, fmt, first.clip);
  const set = (patch) => setCapStyleB(ids, patch, { cut: _cuts(patch) });
  const setBehind = (v) => setCapStyleB(ids, (c, t) => (v !== 'outline' && !(+styleOf(t, fmt, c).backAlpha)
    ? { borderStyle: v, backAlpha: 0.6 } : { borderStyle: v }), { cut: true });
  host.appendChild(_el('div', 'mv3-c-sep'));
  _styleRows(host, st, set, { fmt, textLane: items.every(x => x.track.kind !== 'subs'), setBehind, marks: (items.map(x => x.clip)).some(c => Array.isArray(c && c.words) && c.words.some(w => w && w.k)) });
  if (items.some(x => x.clip.style)) {
    host.appendChild(_el('div', 'mv3-c-sep'));
    host.appendChild(C.row('', C.button('back to the lane\'s style', () => setCapStyleB(ids, null, { cut: true }),
      { title: 'These lines wear their lane\'s style again' })));
  }
  host.appendChild(_el('div', 'mv3-c-sep'));
  _presetsHint(host);
  host.appendChild(C.row('', C.button('Delete ' + items.length + ' lines', () => deleteMultiB(),
    { danger: true, title: 'Also on the Delete key' })));
  return { preset: common, edited: anyEdited,
    apply: (id) => { const p = presetStyle(id); if (p) setCapStyleB(ids, p, { replace: true, cut: true }); }, readOnly: !Store.canEdit() };
}

// A caption: words and when. No length field, the same as every other clip here - the edges
// set the timing, and they also say which part of the sound the line belongs to, which a
// number typed into a box cannot.
function _blankCaption(host, track, clip) {
  const tl = Store.timeline();
  const fmt = (tl && tl.format) || '9:16';
  const own = !!(clip.style && Object.keys(clip.style).length);
  _capHead(host, 'This line', 'on ' + (track.name || track.kind) + (own ? ' · its own style' : ''));
  if (own) _presetLine(host, clip.style, () => setCapStyleB([clip.id], presetStyle(clip.style.preset), { replace: true, cut: true }));
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
    { fmt, textLane: track.kind !== 'subs', marks: ([clip]).some(c => Array.isArray(c && c.words) && c.words.some(w => w && w.k)) });
  if (own) {
    host.appendChild(_el('div', 'mv3-c-sep'));
    host.appendChild(C.row('', C.button('back to the lane\'s style', () => setCapStyleB([clip.id], null, { cut: heard }),
      { title: 'This line wears its lane\'s style again' })));
  }
  host.appendChild(_el('div', 'mv3-c-sep'));
  _presetsHint(host);
  host.appendChild(C.row('', C.button('Remove this line', () => removeB(track.id, clip.id), {
    danger: true, title: 'Takes the caption off the lane',
  })));
  const s = own ? clip.style : null;
  return { preset: s ? (s.preset || '') : '', edited: !!(s && s.preset) && editedKeys(s).length > 0,
    apply: (id) => { const p = presetStyle(id); if (p) setCapStyleB([clip.id], p, { replace: true, cut: heard }); },
    readOnly: !Store.canEdit() };
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

  const p = document.createElement('div');
  p.className = 'mv3-ins-note';
  p.textContent = 'Settings are per clip, so there is nothing here to set for several at once. '
                + 'What can be done to all of them is remove them.';
  host.appendChild(p);

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
  CapView.onApply((id) => { if (_capApply) _capApply(id); });
  Views.onBack('captions', () => clearSelB());
  // (phase V18.2) The "captions" crumb from another view: the subtitle lane picked - every timeline has one, and it
  // cannot be removed - and the captions view follows the pick as it always has.
  Views.onOpen('captions', () => {
    const subs = (((Store.timeline() || {}).tracks) || []).find(t => t.kind === 'subs');
    if (subs) selectTrackB(subs.id);
  });
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
    // painted with say so (`__painted`); the rest are not typing a line.
    Store.setTyping(() => {
      const a = document.activeElement;
      return !!(a && a.__painted != null && a.closest && a.closest('#mv3-over') && a.value !== a.__painted);
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
