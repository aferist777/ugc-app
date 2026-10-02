/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — the inspector: the settings of what is picked on the timeline, and the panel the
   build of a talking head lives in.

   TWO PLACES SINCE PHASE L (the owner, 2026-09-23). What is PICKED on the timeline
   (js/merge-v3/timeline-b.js) is painted into a strip that slides over the Library from the right:

     nothing        no strip - the Library, uncovered
     a lane         what applies to the whole lane
     a clip         that clip's own settings; several clips - removing them

   The panel that used to show them is Setup now: the scenario picker that starts a talking head,
   and the build itself (js/merge-v3/workshop.js). A project that is not a talking head has
   nothing in it and no spine for it.

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
         addCaption as addCapB, setCaptions as setCapsB, setCaptionText as setCapTextB,
         setSubsStyle as setSubsStyleB } from './timeline-b.js';
import { styleOf, subsTrack as subsTrackB, segmentsFor, groupWords, autoSize,
         autoWordsPerLine, regroup, wordsOf } from './subs-b.js';
import { askDelete } from './ask.js';
import { FONTS as CAP_FONTS, fontOf } from '../captions/fonts.js';
import * as ScenPick from './scen-pick.js';
import * as WK from './workshop.js';
import { isStill } from './store.js';
import * as C from './controls.js';
import * as M from './music.js';
import { setOpenColumn } from './layout.js';

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
  // NO ANIMATE BUTTON HERE (decided with the owner): a double click on the picture on the timeline
  // opens it, and so does animate in the picture window. A right-click menu is where it goes next.
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

// The shipped fonts, all with the Russian alphabet (public/js/captions/fonts.js, phase K5).
const FONTS = CAP_FONTS.map(f => [f.family, f.label]);
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
      title: 'Transcribes the audible sound - the main audio lane first, music beds left out - and writes the words onto this lane',
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

  // Bold is a choice only where the family ships both weights; a Black or a Bold file is what it is.
  const fontSel = C.select(FONTS, st.font, (v) => set({ font: v }));
  host.appendChild(C.row('Font', fontOf(st.font).bold === 'style'
    ? C.pair(fontSel, C.toggleNamed('B', !!st.bold, (on) => set({ bold: on }), 'Bold'))
    : fontSel));
  host.appendChild(C.row('Colour', isSubs ? C.pair(
    C.color(st.primary, (v) => set({ primary: v })),
    C.toggleNamed('karaoke', st.effect === 'karaoke', (on) => set({ effect: on ? 'karaoke' : 'none' }),
                  'Colour each word as it is spoken'),
  ) : C.color(st.primary, (v) => set({ primary: v }))));
  if (isSubs && st.effect === 'karaoke') {
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

function render() {
  if (_held) { _pending = true; return; }
  const host = _host();
  const over = _overHost();
  // Both are rebuilt wholesale, so a music preview would keep playing with its stop button
  // thrown away. Stop it before the rebuild rather than orphan it.
  M.stopPreview();
  if (host) {
    host.textContent = '';
    // A step may lay the panel out itself (js/merge-v3/wk-setup.js); this is where that
    // arrangement ends, so the next thing to paint gets the ordinary scroll box back.
    host.className = 'mv3-panel-body';
  }
  if (over) over.textContent = '';
  // A PROJECT THAT IS NOT A TALKING HEAD HAS NO SETUP (phase L): the panel is there for the picker
  // that makes one and for nothing else, and its spine is hidden. Whatever left it open - a blank
  // project, or nothing, opened after a talking head's setup - the Library is the open panel.
  if (!ScenPick.active() && !WK.isTalking()) {
    const ins = document.getElementById('mv3-inspector');
    if (ins && !ins.classList.contains('is-collapsed')) setOpenColumn('library');
  }
  // Making a talking-head project takes the Setup panel over: there is nothing selected yet, and
  // the scenario library is what the person is choosing from (js/merge-v3/scen-pick.js).
  if (ScenPick.active()) { _over(false); return host && ScenPick.paint(host); }
  // A talking-head project is built in a fixed order, and while it is being built the Setup
  // panel belongs to it - the timeline is locked, so nothing on it can be picked anyway.
  if (WK.active()) { _over(false); return host && WK.paint(host); }
  if (!over || !blankMounted()) return _over(false);
  // A BAND SELECTION OUTRANKS the single one. It is the more deliberate of the two - the
  // single selection is usually just whatever the pointer passed over on the way to drawing
  // the band - and settings for four clips at once have no honest meaning, so what the strip
  // offers is the one thing that does: getting rid of them.
  const many = multiB();
  if (many > 1) { _over(true); return _renderMany(over, many); }
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
    // Touching the timeline is leaving the picker: what is selected is what the panel is for.
    if (ScenPick.active() && (oneB() || trackB() || multiB() > 1)) ScenPick.stop();
    // A build step is NOT left that way: selecting a clip while composing frames is a slip of
    // the pointer far more often than it is a decision to go and edit the cut.
    if (WK.active()) return;
    M.resetView();
    render();
  });
  ScenPick.onChange(render);
  WK.onChange(render);
  // Also on every store change: trimming a clip changes the numbers on show, and an
  // undo can remove the very clip being inspected.
  Store.onChange(render);

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
}
