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
         setLiveVolumes as setLiveVolumesB,
         removeTrack as removeTrackB, playhead as playheadB,
         stampTrack as stampB, resetTrack as resetTrackB,
         addCaption as addCapB, setCaptionText as setCapTextB,
         setSubsStyle as setSubsStyleB, setSubsListen as setListenB,
         setCaptionStyle as setCapStyleB, selectedCaptions as capsB, clearSelection as clearSelB,
         revealSelection as revealSelB, gesture as gestureB, recutLines as recutLinesB,
         selectTrackById as selectTrackB, patternsOf as patternsB, setPatterns as setPatternsB } from './timeline-b.js';
import * as CapView from './captions-view.js';
// (phase V76) A sound's pitch - presets, semitones, keep timbre.
import { pitchRows } from './pitch-rows.js';
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
import { markedColour, renderFrame, resolveStyle, PLATES, pairOf, mixOf, animsOf, fontsOf, LOOK_KEYS, rowsOn } from '../captions/style.js';
import { deal, needsDeal, redealFonts, newSeed, withoutRefs, refsOf } from '../captions/mix.js';
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
// (phase V51, point 1) A clip's crop: the switch and its field.
import { cropRows, pipOffCrop } from './crop-box.js';
import { active as cropActive } from '../framing/crop.js';
// (phase V65) How much of a clip is seen and how it mixes; held on the preview while the slider moves or the pointer rests
// on a mode (place-b.js setLive).
import { opacityOf, blendOf } from '../overlay/look.js';
// (phase V75) A clip's colour correction - one rule with the preview and the render.
import { COLOR_KEYS, COLOR_RANGE, COLOR_LABEL, colorOf } from '../overlay/color.js';
import { setLive as setLivePlace } from './place-b.js';
// (phase V74) The blend mode's list, and the patterns of main video - picked by ticks, their settings.
import { blendButton } from './blend-menu.js';
// (phase V84) A clip's effects - the group after Color (fx-ui.js).
import { fxRows, onFocus as onFxFocus, takeOpenAsk as takeFxOpenAsk } from './fx-ui.js';
import { renderPatterns } from './patterns-ui.js';
// (phase V73 block 2, step 2b) A lane with nothing on it - the shared "nothing here", a row of the strip.
import { emptyEl } from '../ui-state.js';
// (phase V73 block 5, part 5b) The groups' chevrons, and the strip's figures in mono (js/num.js).
import { iconEl } from '../icons.js';
import { setFigures } from '../num.js';

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
  row.appendChild(setFigures(_el('span', 'mv3-ins-v'), v));
  return row;
}

// ── THE STRIP'S HEAD AND ITS GROUPS (phase V73 block 5, part 5b; the owner's (к24-4), (б5-8) а, (б5-9) а) ─────────────────
// THE HEAD says what is picked - "Clip · <name>", "Main video", "Subtitles", "3 lines" - and its ✕ lets it go, as Escape does
// (merge-v3.html #mv3-over-x). The branch that paints sets `_title`; a block that paints its own title - the highlights
// group's "· for all N" (hl-group.js) - marks it `data-strip-title`, and the head takes it from there (_paintHead).
let _title = '';
// THE GROUPS: the rows of a pick under titles that fold - a clip Picture · Color · Effects · Sound (since phase V84, the owner
// 2026-11-10 (эф17): Frame's rows are Picture's, under a line), a sound clip Sound, words Text · Look · Motion · Place, a lane its
// own. ONE GROUP OPEN (phase V84, the owner's (эф18)): a group opened shuts the others of the strip, the open one pressed shuts
// (all may be shut); which one is open is kept for that KIND of pick (`_kind`, set by the branch) in localStorage
// (`mv3_ins_open_v1` - the viewer's own convenience) - outside the strip, which every paint rebuilds; never chosen, or not in this
// strip - the first. The group Effects opens by itself when fx-ui.js asks (an effect opened, an effect
// added, the clip's "Add effect…" - the owner's (эф19); takeOpenAsk).
let _kind = '';
const OPEN_KEY = 'mv3_ins_open_v1';
let _opens = null;
function _opensNow() {
  if (!_opens) {
    try { _opens = JSON.parse(localStorage.getItem(OPEN_KEY) || '{}') || {}; } catch (e) { _opens = {}; }
  }
  return _opens;
}
function _opensSave() { try { localStorage.setItem(OPEN_KEY, JSON.stringify(_opensNow())); } catch (e) { /* a private window: kept for this page only */ } }
let _painted = [];             // the groups of this paint: { id, g, h }
let _forceOpen = null;         // the group this paint must open ('effects' when fx-ui.js asked)
/** Which group of the painted strip is open - set once it is all there (render). */
function _settleGroups() {
  if (!_painted.length) return;
  const o = _opensNow();
  const has = (id) => _painted.some((p) => p.id === id);
  let id;
  if (_forceOpen && has(_forceOpen)) { id = _forceOpen; o[_kind] = id; _opensSave(); }
  else if (Object.prototype.hasOwnProperty.call(o, _kind) && (o[_kind] === '' || has(o[_kind]))) id = o[_kind];
  else id = _painted[0].id;
  for (const p of _painted) {
    const on = p.id === id;
    p.g.classList.toggle('is-shut', !on);
    p.h.setAttribute('aria-expanded', on ? 'true' : 'false');
  }
}
/** A group of the strip: its title (a press opens it and shuts the others, or shuts it) and the box its rows go into - returned. */
function _group(host, id, title) {
  const kind = _kind;
  const g = _el('section', 'mv3-ins-grp is-shut');
  const h = _el('button', 'mv3-ins-grp-h');
  h.type = 'button';
  h.setAttribute('aria-expanded', 'false');
  h.appendChild(iconEl('chevron-down', 14));
  h.appendChild(setFigures(_el('span'), title));
  const all = _painted;
  h.addEventListener('click', () => {
    const opening = g.classList.contains('is-shut');
    for (const p of all) { p.g.classList.add('is-shut'); p.h.setAttribute('aria-expanded', 'false'); }
    if (opening) { g.classList.remove('is-shut'); h.setAttribute('aria-expanded', 'true'); }
    _opensNow()[kind] = opening ? id : '';
    _opensSave();
  });
  _painted.push({ id, g, h });
  g.appendChild(h);
  const body = _el('div', 'mv3-ins-grp-b');
  g.appendChild(body);
  host.appendChild(g);
  return body;
}
// A ROW UNDER THE GROUPS: what puts lines back on their lane's style.
function _actRow(host, btn) {
  const r = _el('div', 'mv3-ins-act');
  r.appendChild(btn);
  host.appendChild(r);
}
// THE STRIP'S LAST ROW - Remove, Delete N: at the bottom, its own width, the part's quiet red (`is-danger`).
function _removeRow(host, btn) {
  const r = _el('div', 'mv3-ins-remove');
  r.appendChild(btn);
  host.appendChild(r);
}
const _cap1 = (s) => { const t = String(s || ''); return t.charAt(0).toUpperCase() + t.slice(1); };
function _paintHead(over) {
  let t = _title;
  const own = over && over.querySelector('[data-strip-title]');
  if (own) { if (!t) t = own.textContent; own.remove(); }
  const el = document.getElementById('mv3-over-title');
  if (!el) return;
  setFigures(el, t);
  el.title = t;
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
const CROPS = [['left', 'Left'], ['center', 'Center'], ['right', 'Right'],
               ['top', 'Top'], ['bottom', 'Bottom']];

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

// (phase V65, the owner's (пз5), (пз6)) OPACITY - how much of a clip of any video lane is seen, 0-100 %; one slider for
// every video clip picked ((пз5) a: several picked, one value for all). Held on the preview while it moves - nothing written
// (place-b.js setLive, as the crop's frame) - and written into all of them on release, ONE undo step. On main video the
// clip is over black, so less of it is darker. `items` - [{ track, clip }] of video lanes.
function _opacityRow(host, items) {
  host.appendChild(C.row(items.length > 1 ? 'Opacity · ' + items.length : 'Opacity', _opacitySlider(items)));
}
function _opacitySlider(items) {
  const vals = items.map(x => opacityOf(x.clip));
  const mixed = vals.some(v => Math.abs(v - vals[0]) > 0.004);
  const live = (v) => new Map(items.map(x => [x.clip.id, { opacity: v / 100 }]));
  const sl = C.slider({
    min: 0, max: 100, step: 1, value: Math.round(vals[0] * 100), fmt: (v) => Math.round(v) + '%', mixed,
    onInput: (v) => setLivePlace(live(v)),
    onChange: (v) => {
      setLivePlace(null);
      setClipsB(items.map(({ track, clip }) => ({ trackId: track.id, clipId: clip.id, patch: { opacity: v / 100 } })));
    },
  });
  sl.title = 'How much of ' + (items.length > 1 ? 'these clips' : 'this clip') + ' is seen - 100% all of it'
    + (items.some(x => isMainVideo(x.track)) ? '; on main video, under it is black' : '');
  return sl;
}

// (phase V65, the owner's (пз7), (пз10)) THE BLEND MODE of the clips of lanes ABOVE main - a list of its own, not a <select>
// (which never says which option the pointer is over): the pointer resting on a mode shows it on the preview at once
// (place-b.js setLive - nothing written), a press chooses it - written into every one picked, ONE undo step -, Escape, a
// press away or the pointer leaving the list puts the preview back as it was. `items` - [{ track, clip }] off main.
function _blendRow(host, items) {
  host.appendChild(C.row(items.length > 1 ? 'Blend · ' + items.length : 'Blend', _blendButton(items)));
}
// (phase V74) The list itself is js/merge-v3/blend-menu.js - the patterns of main video take it too.
function _blendButton(items) {
  const ids = items.map(x => blendOf(x.clip).id);
  const mixed = ids.some(v => v !== ids[0]);
  return blendButton({
    current: mixed ? '' : ids[0],
    title: 'How ' + (items.length > 1 ? 'these clips mix' : 'this clip mixes') + ' with what is under it'
      + ' - rest the pointer on a mode to see it',
    live: (id) => setLivePlace(id ? new Map(items.map(x => [x.clip.id, { blend: id }])) : null),
    write: (id) => setClipsB(items.map(({ track, clip }) => ({ trackId: track.id, clipId: clip.id, patch: { blend: id } }))),
  });
}

// (phase V75, the owner's (кп2)) NO PiP SWITCH: a main clip becomes a PiP by its Crop (crop-box.js), and its Crop switched off
// makes it the whole frame again. What is left here are a PiP's edges and the way back to its first size - shown while the
// clip IS a PiP; an old one made by the switch with no crop has "Full frame" too. Returns whether anything was shown.
function _pipSection(host, items) {
  const on = items.filter(x => !!x.clip.pip);
  if (!on.length) return false;
  const write = (patch) => setClipsB(on.map(({ track, clip }) => ({ trackId: track.id, clipId: clip.id, patch })));
  const many = on.length > 1;
  if (on.length < items.length) host.appendChild(C.hint('The edges below are for the ' + on.length + ' picked clips that are a PiP.'));
  _edgeRows(host, on[0].clip, write);
  const size = C.button('Full size', () => write({ tx: null, ty: null, tw: null, angle: null }),
    { title: 'Back to the size and place it had when it became a PiP - the whole frame it showed' });
  const uncut = on.filter(x => !cropActive(x.clip));
  host.appendChild(C.row('', uncut.length
    ? C.pair(size, C.button('Full frame', () => setClipsB(uncut.map(({ track, clip }) => ({ trackId: track.id, clipId: clip.id,
      patch: { pip: null, tx: null, ty: null, tw: null, angle: null } }))),
      { title: 'Not a picture in the picture any more - the whole frame again' }))
    : size));
  host.appendChild(C.hint('Drag a corner on the preview to size it, drag it to move it, the knob to turn it'
    + (many ? ' - all ' + on.length + ' picked clips move together.' : '.')));
  return true;
}

// (phase V75, the owner's (кп5)) THE COLOUR CORRECTION - Brightness, Contrast, Saturation, Gamma (overlay/color.js) - of every
// video clip of `items` at once: one slider a value, "mixed" while they differ. Held, the preview shows it (place-b.js setLive -
// nothing written); let go, it is written into each clip, its other values its own - ONE undo step. A lane gives all its clips
// (as its Fit does); a clip added later comes as it is.
function _colorGroup(host, items) {
  if (!items.length) return;
  const g = _group(host, 'color', 'Color');
  for (const k of COLOR_KEYS) {
    const [min, max, , step] = COLOR_RANGE[k];
    const vals = items.map(x => colorOf(x.clip)[k]);
    const mixed = vals.some(v => Math.abs(v - vals[0]) > 1e-6);
    const patchOf = (clip, v) => ({ color: { ...colorOf(clip), [k]: v } });
    g.appendChild(C.row(COLOR_LABEL[k], C.slider({
      min, max, step, value: vals[0], fmt: (v) => (+v).toFixed(2), mixed,
      onInput: (v) => setLivePlace(new Map(items.map(x => [x.clip.id, patchOf(x.clip, v)]))),
      onChange: (v) => {
        setLivePlace(null);
        setClipsB(items.map(({ track, clip }) => ({ trackId: track.id, clipId: clip.id, patch: patchOf(clip, v) })));
      },
    })));
  }
}

// A PiP's edges - and (phase V51, (пр42)) a cropped clip's of a lane above, by the same rule: its soft edge, its rounded
// corners, its outline. `write(patch)` writes them into what is picked.
function _edgeRows(host, c0, write) {
  host.appendChild(C.row('Soft edge', C.slider({
    min: 0, max: 0.4, step: 0.01, value: +c0.feather || 0,
    fmt: (v) => (v <= 0.005 ? 'hard' : Math.round(v * 100) + '%'),
    onChange: (v) => write({ feather: v }),
  })));
  // ((пр11)) Rounded corners - a share of the shorter side, half of it round ends - and an outline inside the edge, its
  // thickness a share of the frame's width (said in the pixels of a 1080-wide film) and its color.
  host.appendChild(C.row('Corners', C.slider({
    min: 0, max: 0.5, step: 0.01, value: +c0.radius || 0,
    fmt: (v) => (v <= 0.005 ? 'square' : v >= 0.495 ? 'round' : Math.round(v * 200) + '%'),
    onChange: (v) => write({ radius: v }),
  })));
  const col = C.color(c0.outlineColor || '#ffffff', (v) => write({ outlineColor: v }));
  col.title = 'The outline’s color';
  host.appendChild(C.row('Outline', C.pair(C.slider({
    min: 0, max: 0.03, step: 0.001, value: +c0.outline || 0,
    fmt: (v) => (v <= 0.0005 ? 'none' : Math.round(v * 1080) + ' px'),
    onChange: (v) => write({ outline: v }),
  }), col)));
}

// (phase V51, (пр42)) A CROPPED clip of a lane above main: its piece over the lanes under it, no blur behind it - the PiP's
// edges, and the way back to the whole frame (the crop remembered).
function _cutRows(host, track, c) {
  _edgeRows(host, c, (patch) => setManyB(track.id, c.id, patch));
  host.appendChild(C.row('', C.button('Full frame', () => setManyB(track.id, c.id, {
    tx: null, ty: null, tw: null, angle: null, feather: null, ...pipOffCrop(c),
  }), { title: 'Drop the crop and the placement and cover the whole frame again - the crop is remembered' })));
  host.appendChild(C.hint('Drag it on the preview to move it, a corner to size it, the knob to turn it.'));
}

// How a clip meets a frame of another shape. The second row appears only when there is
// something to decide: a fitted clip loses nothing, so there is no side to pick.
// (phase V33.2, the owner's (х9)) A filled clip's window may MOVE: "Framing" - fixed (the side kept, as before), following
// the face, the middle, the whole frame over its blur, two faces as bands - and a shift for the whole clip
// (public/js/merge-v3/framing-ui.js; the path itself is public/js/framing/path.js, which the render reads too).
function _frameRows(host, c, set) {
  host.appendChild(C.row('Fit', C.select(FITS, c.fit === 'fill' ? 'fill' : 'fit',
    (v) => set('fit', v))));
  if (c.fit !== 'fill') return;
  // (phase V43) A part of fragmentation follows the most active - its own choice while it has it - with punch-ins on or off.
  const mode = FRAMING.modeOf(c);
  const pickFraming = C.select(FRAMING.framingsOf(c), mode, (v) => { FRAMING.choose(c, v, set); });
  host.appendChild(C.row('Tracking', pickFraming));
  const zoomRow = FRAMING.zoomRow(c, C);
  if (zoomRow) host.appendChild(zoomRow);
  if (mode === 'fixed') {
    host.appendChild(C.row('Align', C.select(CROPS, c.cropAlign || 'center',
      (v) => set('cropAlign', v))));
  } else if (mode !== 'whole') {
    host.appendChild(C.row('Offset', C.slider({
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
  host.appendChild(C.row('Slice', C.slider({
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
  // (phase V73 block 5, 5b, (б5-8) а) THE GROUPS: Picture - how it runs, how much of it is seen, how it mixes, the band, and under a
  // line (phase V84, the owner's (эф17): Frame's rows joined it) the crop, how it meets the frame, the PiP; Color; Effects; Sound -
  // its sound's level. The rows in each as they were.
  const main = isMainVideo(track);
  const pic = _group(host, 'picture', 'Picture');
  // Reverse rides beside the speed slider rather than taking a row of its own: the two are
  // one question about how the clip runs, and a row apiece spent a fifth of the panel saying
  // it twice.
  pic.appendChild(C.row('Speed', C.pair(
    C.slider({
      min: 0.25, max: 2, step: 0.05, value: +c.speed || 1, fmt: C.times,
      onChange: (v) => set('speed', v),
    }),
    C.toggleNamed('\u21ba', !!c.reversed, (on) => set('reversed', on), 'Play it backwards', 'rotate-ccw'),
  )));
  _opacityRow(pic, [{ track, clip: c }]);
  if (!main) _blendRow(pic, [{ track, clip: c }]);
  // (phase V49, (пр8)) No Halfer on main video - one switched on before can still be switched off.
  if (!main || c.halfer) _halferRows(pic, c, set);
  if (!c.halfer) {
    const fr = pic;
    _bsep(fr);
    // (phase V51, point 1) The crop first: while it is on, the piece is the picture - no Fit / Fill, Framing or Keep.
    const cropped = cropRows(fr, [{ track, clip: c }]);
    _bsep(fr);
    // PLACED OR FITTED, never both. A clip laid on the frame at a third of its width is not
    // being fitted to anything, so the fit controls would be two settings with nothing to act on.
    // (V49) A main clip is framed as ever - a PiP shows what the frame shows - and its PiP is below.
    if (main) { if (!cropped) { _frameRows(fr, c, set); if (c.pip) _bsep(fr); } _pipSection(fr, [{ track, clip: c }]); }
    else if (cropped) _cutRows(fr, track, c);
    else if (_isPlaced(c)) _pipRows(fr, track, c);
    else _frameRows(fr, c, set);
  }
  _colorGroup(host, [{ track, clip: c }]);
  if (!c.halfer) fxRows(_group(host, 'effects', 'Effects'), track, c);

  const snd = _group(host, 'sound', 'Sound');
  if (pair) {
    // THE LEVEL LIVES ON THE OTHER HALF. A video clip's own volume is read by nothing - the
    // graph mixes audio lanes - so a slider writing it here would be a dial connected to
    // nothing. It writes to the sound instead, which is what "turn this clip up" means.
    const vol = C.volume(pair.clip.volume == null ? 1 : +pair.clip.volume,
      (v) => setB(pair.track.id, pair.clip.id, 'volume', v));
    vol.title = 'This clip\u2019s own sound, on ' + pair.track.name;
    snd.appendChild(C.row('Volume', vol));
    // (phase V76, (тн4) а) Its pitch, on the sound as its level is.
    pitchRows(snd, [pair.clip.pitch], (fn) => setB(pair.track.id, pair.clip.id, 'pitch', fn(pair.clip.pitch)));
  } else {
    snd.appendChild(C.hint('No sound attached to this clip.'));
  }

  _removeRow(host, C.button('Remove from timeline', () => removeB(track.id, c.id), {
    danger: true,
    title: pair ? 'Takes the clip off the timeline, and its sound with it. The library keeps the file.'
                : 'Takes the clip off the timeline. The library keeps the file.',
  }));
}

// A picture: one frame and a length the timeline gave it. No speed, no reverse, no level -
// it has none of those, and offering them would be three controls that quietly do nothing.
// Laid out like the other workflow's still panel, because it answers the same question
// first: which picture is this.
function _blankStill(host, track, c, set) {
  // (phase V73 block 5, 5b, the owner's (б5-10) а) THE CLIP'S FORM: the groups Picture (with Frame's rows since V84, (эф17)) · Color ·
  // Effects, Remove at the bottom - no columns of
  // its own any more. (phase V75, the owner's (кп3)) The picture itself is not shown at the top of Picture any more: it is on the
  // preview.
  // (phase V49) On main video a picture is framed as ever and may be a PiP; it has no Halfer.
  const main = isMainVideo(track);
  const placed = _isPlaced(c) && !main;
  // (phase V51) A cropped picture: the piece is the picture - its settings are the crop's.
  const cropped = !c.halfer && !!cropActive(c);

  const pic = _group(host, 'picture', 'Picture');
  _opacityRow(pic, [{ track, clip: c }]);
  if (!main) _blendRow(pic, [{ track, clip: c }]);
  if (!main || c.halfer) _halferRows(pic, c, set);

  // A band takes none of these: no crop, placement or framing on a band. (phase V84, (эф17)) Frame's rows are Picture's, under a line.
  if (!c.halfer) {
    const fr = pic;
    _bsep(fr);
    cropRows(fr, [{ track, clip: c }]);
    if (cropped) {
      if (!main) { _bsep(fr); _cutRows(fr, track, c); }
    } else if (placed) {
      _bsep(fr);
      _pipRows(fr, track, c);
    } else {
      _bsep(fr);
      fr.appendChild(C.row('Fit', C.select(FITS, c.fit === 'fill' ? 'fill' : 'fit', (v) => set('fit', v))));
      if (c.fit === 'fill') fr.appendChild(C.row('Align', C.select(CROPS, c.cropAlign || 'center', (v) => set('cropAlign', v))));
    }
    if (main && c.pip) { _bsep(fr); _pipSection(fr, [{ track, clip: c }]); }
  }
  _colorGroup(host, [{ track, clip: c }]);
  if (!c.halfer) fxRows(_group(host, 'effects', 'Effects'), track, c);

  _removeRow(host, C.button('Remove', () => removeB(track.id, c.id), {
    danger: true, title: 'Takes the picture off the timeline. The library keeps the file.',
  }));
}

// A fade's length: seconds, the 15 ms of a seam (cut silence) in milliseconds, none "off".
const _fadeLbl = (v) => (v >= 0.05 ? (+v).toFixed(1) + 's' : v > 0 ? Math.round(v * 1000) + ' ms' : 'off');
// (phase V54, the owner's (зв10)) A talking head's line on its project's timeline (a mirror's cell, lib/frag-mirror.js): its level
// can be changed, and the mirror evens the lines' levels again when it lays the line anew.
const _isLine = (c) => Number(c && c.frag) > 0;
const LINE_HINT = 'A line of the talking head: a new take or a change of the line puts the mirror’s level back on it.';

// ── The sound of several clips (phase V54, block 3; the owner's (зв8)-(зв11)) ────────────────────────────────────────────────
// What of the pick is HEARD: the clips of the audio lanes and (зв9) the sound half of a picked film - each once, a pair picked
// whole counted once. A red clip's too: its level waits for the file that replaces it.
function _soundsOf(items) {
  const out = [], seen = new Set();
  const add = (track, clip) => { if (!clip || seen.has(clip.id)) return; seen.add(clip.id); out.push({ track, clip }); };
  for (const { track, clip } of items) {
    if (track.kind === 'audio') add(track, clip);
    else if (track.kind === 'video' && !isStill(clip)) {
      const m = mateB(clip.id);
      if (m && m.track.kind === 'audio') add(m.track, m.clip);
    }
  }
  return out;
}

// CLIPS IN A ROW ON ONE LANE - the pieces cut silence leaves - fade as one: in at the first of the row, out at its last; the
// 15 ms at the seams between them stay. A row is picked clips each starting where the one before it ends.
function _runsOf(sounds) {
  const byLane = new Map();
  for (const s of sounds) {
    if (!byLane.has(s.track.id)) byLane.set(s.track.id, []);
    byLane.get(s.track.id).push(s);
  }
  const runs = [];
  for (const list of byLane.values()) {
    list.sort((a, b) => (+a.clip.start || 0) - (+b.clip.start || 0));
    let cur = null;
    for (const s of list) {
      const last = cur && cur[cur.length - 1];
      const end = last ? (+last.clip.start || 0) + (+last.clip.dur || 0) : -1;
      if (last && Math.abs((+s.clip.start || 0) - end) <= 0.02) cur.push(s);
      else { cur = [s]; runs.push(cur); }
    }
  }
  return runs;
}

// (зв8) THE LEVEL OF SEVERAL IS A SHIFT: every clip moved by the same dB, so the differences between them stay. A level held at
// the dial's ends - +12 dB at the top, the quietest step above muted at the bottom: a shift never mutes a clip, nor wakes a muted
// one; one past an end already is not pulled to it.
const SHIFT_DB = 24;
const FLOOR_DB = C.DB_MIN + 0.5;
const _shiftLbl = (db) => (Math.abs(db) < 0.05 ? '0 dB' : (db > 0 ? '+' : '−') + Math.abs(db).toFixed(1) + ' dB');
function _shifted(vol, db) {
  const v = vol == null ? 1 : +vol;
  if (!(v > 0)) return 0;
  const cur = 20 * Math.log10(v);
  const want = Math.min(Math.max(cur, C.DB_MAX), Math.max(Math.min(cur, FLOOR_DB), cur + db));
  return Math.pow(10, want / 20);
}

// The strip's rows for the sound of several: the shift of the level (live while it is held, one step when let go, back to 0),
// Fade in and Fade out (one value for all, "mixed" while they differ). No Speed: lengths would change without moving the
// neighbours - overlaps and holes. `alone` - every clip picked is a sound, so the rows need no "for N".
function _soundSection(box, sounds, alone) {
  // (phase V73 block 5, 5b) its title is its group's
  const host = _group(box, 'sound', alone ? 'Sound'
    : 'Sound · for ' + sounds.length + (sounds.length === 1 ? ' sound clip' : ' sound clips'));
  const base = sounds.map(s => ({ s, v: s.clip.volume == null ? 1 : +s.clip.volume }));
  const levelsAt = (db) => base.map(({ s, v }) => ({ trackId: s.track.id, clipId: s.clip.id, volume: _shifted(v, db) }));
  const vol = C.slider({
    min: -SHIFT_DB, max: SHIFT_DB, step: 0.5, value: 0, fmt: _shiftLbl,
    onInput: (db) => setLiveVolumesB(levelsAt(db)),
    onChange: (db) => {
      setLiveVolumesB(null);
      if (Math.abs(db) >= 0.05) setClipsB(levelsAt(db).map(x => ({ trackId: x.trackId, clipId: x.clipId, patch: { volume: x.volume } })));
      // Back to 0 for the next move - a write that changed nothing (every level at an end) repaints nothing by itself.
      render();
    },
  });
  vol.title = 'Moves every level by the same number of dB - the differences between them stay';
  host.appendChild(C.row('Volume', vol));
  const muted = base.filter(x => !(x.v > 0)).length;
  host.appendChild(C.hint('Moves them all by the same dB, the differences kept. One at +12 dB stays there'
    + (muted ? '; ' + (muted === 1 ? 'the muted one stays' : muted + ' muted ones stay') + ' muted.' : '.')));

  const runs = _runsOf(sounds);
  const fadeRow = (label, key, ends) => {
    const vals = ends.map(s => Math.max(0, +s.clip[key] || 0));
    const mixed = vals.some(v => Math.abs(v - vals[0]) > 0.0005);
    host.appendChild(C.row(label, C.slider({
      min: 0, max: 5, step: 0.5, value: vals[0], fmt: _fadeLbl, mixed,
      onChange: (v) => setClipsB(ends.map(s => ({ trackId: s.track.id, clipId: s.clip.id, patch: { [key]: v } }))),
    })));
  };
  fadeRow('Fade in', 'fadeIn', runs.map(r => r[0]));
  fadeRow('Fade out', 'fadeOut', runs.map(r => r[r.length - 1]));
  if (runs.some(r => r.length > 1)) {
    host.appendChild(C.hint('Clips in a row on one lane fade as one - in at the first, out at the last; the seams between them keep their 15 ms.'));
  }
  // (phase V76, (тн4) а) One pitch for all of them - "Mixed" while they disagree.
  pitchRows(host, sounds.map(s => s.clip.pitch),
    (fn) => setClipsB(sounds.map(s => ({ trackId: s.track.id, clipId: s.clip.id, patch: { pitch: fn(s.clip.pitch) } }))));
  if (sounds.some(s => _isLine(s.clip))) host.appendChild(C.hint(LINE_HINT));
}

// A sound. Its level is the whole of it - and a birol lands here silent, which is what this
// panel is most often opened to undo.
function _blankSound(host, track, c, set, pair) {
  // (phase V66.1) The music the app laid on a highlights fragment: its track and the choice of another on top.
  const ex = Views.laneExtraFor(track, c);
  if (ex) ex.render(host, track, c);
  // (phase V73 block 5, 5b, (б5-8) а) ONE GROUP, Sound.
  const g = _group(host, 'sound', 'Sound');
  g.appendChild(C.row('Volume', C.volume(c.volume == null ? 1 : +c.volume,
    (v) => set('volume', v))));
  g.appendChild(C.hint((+c.volume || 0) > 0
    ? 'Muted is the bottom of the travel.'
    : 'Silent. Raise it to hear this clip in the preview and in the export.'));

  // (phase V23) Its own fades - the two variants of a Suno track cross into each other over three seconds. (phase V54, (зв11) а)
  // Written since V54: they were not on the timeline's list of fields, and nothing was.
  g.appendChild(C.row('Fade in', C.slider({
    min: 0, max: 5, step: 0.5, value: Math.max(0, +c.fadeIn || 0), fmt: _fadeLbl, onChange: (v) => set('fadeIn', v),
  })));
  g.appendChild(C.row('Fade out', C.slider({
    min: 0, max: 5, step: 0.5, value: Math.max(0, +c.fadeOut || 0), fmt: _fadeLbl, onChange: (v) => set('fadeOut', v),
  })));

  g.appendChild(C.row('Speed', C.pair(
    C.slider({
      min: 0.25, max: 2, step: 0.05, value: +c.speed || 1, fmt: C.times,
      onChange: (v) => set('speed', v),
    }),
    C.toggleNamed('\u21ba', !!c.reversed, (on) => set('reversed', on), 'Play it backwards', 'rotate-ccw'),
  )));
  // (phase V76) Its pitch - the speed above keeps it.
  pitchRows(g, [c.pitch], (fn) => set('pitch', fn(c.pitch)));

  if (pair) {
    g.appendChild(C.hint('Half of a pair: length, speed and direction are shared with the '
      + 'picture on ' + pair.track.name + '. The level is not.'));
  }
  if (_isLine(c)) g.appendChild(C.hint(LINE_HINT));

  _removeRow(host, C.button('Remove from timeline', () => removeB(track.id, c.id), {
    danger: true,
    title: pair ? 'The picture stays where it is, and goes silent.'
                : 'Takes the sound off the timeline. The library keeps the file.',
  }));
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
  _removeRow(host, btn);
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
    host.appendChild(emptyEl('Nothing on this lane yet. A setting for the whole lane is written '
      + 'into the clips on it, so there is nothing here to write it into.', { line: true }));
  } else {
    // (phase V73 block 5, 5b, (б5-8) а) The lane's rows - its one group.
    const g = _group(host, 'lane', 'Frame');
    g.appendChild(C.row('Fit', C.select(FITS, _commonOf(track, 'fit') === 'fill' ? 'fill' : 'fit',
      (v) => stampB(track.id, { fit: v }))));
    if (_commonOf(track, 'fit') === 'fill') {
      g.appendChild(C.row('Align', C.select(CROPS, _commonOf(track, 'cropAlign') || 'center',
        (v) => stampB(track.id, { cropAlign: v }))));
    }
    // THE WARNING IS GONE FROM THE PANEL, and the behaviour is not: choosing one of these
    // still writes it into every clip on the lane, over whatever each had. It lives in the
    // tooltip of the control that does it, and the undo arrow is still the way back.
    g.appendChild(C.row('', C.button('Reset lane', () => resetTrackB(track.id), {
      title: 'Puts the framing of this lane\u2019s clips back to Fit. Speed, trims, '
           + 'placement and levels are left alone.',
    })));
    // (phase V75, the owner's (\u043a\u043f5) \u0430) The lane's colour: written into every clip on it, as its Fit is.
    _colorGroup(host, (track.clips || []).filter(c => c && c.src).map(clip => ({ track, clip })));
  }
  // (phase V74, the owner's (\u043f\u04421)-(\u043f\u04429)) MAIN VIDEO'S PATTERNS - the set with ticks, the layers ticked with their settings
  // (patterns-ui.js): over the whole of main video and every lane above it, under the words; each change one undo step.
  if (isMainVideo(track)) {
    renderPatterns(host, { list: () => patternsB(), write: (next) => setPatternsB(next), repaint: () => render(), empty: !clips });
  }

  _laneRemove(host, track);
}

function _blankAudioTrack(host, track) {
  // (phase V66.1) A highlights fragment's music lane: its track and the choice of another on top (lib-views.js laneExtra).
  const ex = Views.laneExtraFor(track);
  if (ex) ex.render(host, track, null);
  // THE MUSIC PANEL, on this lane: the lane's master volume and the generator (js/merge-v3/music.js). The tracks
  // themselves are in the Library panel, Audio -> Music, dragged onto a lane from there (phase V28.4).
  M.setMusicDest(track.id);
  // (phase V73 block 5, 5b) its rows - one group, Sound
  // (phase V76, (тн4) а) The lane's pitch under its volume: written into every clip on it, one undo step, as a video lane's
  // colour is.
  const clips = (track.clips || []).filter(c => c && c.src);
  M.renderMusicTrack(_group(host, 'lane', 'Sound'), track, clips.length ? (g) => pitchRows(g, clips.map(c => c.pitch),
    (fn) => setClipsB(clips.map(c => ({ trackId: track.id, clipId: c.id, patch: { pitch: fn(c.pitch) } })))) : null);

  _laneRemove(host, track);
}

// ── Captions from what was said ─────────────────────────────────────────────
// The SERVER listens to the project and lays the lines (lib/captions-job.js, phase K1); the strip
// presses the button and says what the job of THIS project is doing (listen.js).
// The key decides (phase V30, the owner's (с22)): Groq when there is one, this computer when not - or this computer always.
const ENGINES = [['cloud', 'Groq when there is a key, else this computer'], ['local', 'This computer']];
// What the subtitle strip was last built for: while only the words of its status line change (a percent),
// the line is rewritten in place - rebuilding the strip every 1.5 s tore down an open menu (review K1b).
let _listenShape = null;

// The shipped fonts, all with the Russian alphabet (public/js/captions/fonts.js, phase K5).
const FONTS = CAP_FONTS.map(f => [f.family, f.label]);
const POS = [['top', 'Top'], ['center', 'Middle'], ['bottom', 'Bottom']];
// How a heard lane is cut (phase V30, block 4): style.js CUTS.
const CUT_OPTS = [['pages', 'Pages - a few words at a time'], ['sentences', 'Sentences - classic subtitles']];
// What makes a line wider or narrower - or a page hold more - cuts the heard pages again, in the same
// step (K2, the owner's answer 3): a page cut for one font is not a page in another. The list is pages.js's.
const CUTS = CUT_KEYS;
const _cuts = (patch) => Object.keys(patch || {}).some(k => CUTS.includes(k));

// What a word does while it is spoken, how it is cased, what stands behind it (K0's fields, given controls in K6).
const EFFECTS = [['none', 'None'], ['color', 'Color'], ['box', 'A box'], ['pop', 'Pop'], ['bounce', 'Jump'],
  ['sweep', 'Sweep'], ['karaoke', 'Karaoke']];
// HOW A SUBTITLE PAGE COMES IN AND GOES OUT (phase V49, the owner's (пр16)-(пр18)): motions of the whole page, their lengths the
// app's (captions/page-fx.js). "Arrives" went: a preset's own way of arriving shows as its In until one is chosen ((пр17)).
const PAGE_IN = [['at-once', 'At once'], ['fade', 'Fade'], ['pop', 'Pop'], ['zoom', 'Zoom'], ['grow', 'Grow'], ['from-top', 'From the top'],
  ['rise', 'From below'], ['from-left', 'From the left'], ['from-right', 'From the right'], ['drop', 'Drop'], ['blur', 'Blur'],
  ['swing', 'Swing']];
const PAGE_OUT = [['none', 'At once'], ['fade', 'Fade'], ['pop', 'Pop'], ['shrink', 'Shrink'], ['zoom', 'Zoom'], ['rise', 'Up'],
  ['sink', 'Down'], ['to-left', 'To the left'], ['to-right', 'To the right'], ['fall', 'Fall'], ['blur', 'Blur']];
const CASINGS = [['none', 'As typed'], ['upper', 'UPPER'], ['lower', 'lower'], ['title', 'Title']];
const BEHIND = [['outline', 'Nothing'], ['box', 'A box'], ['boxline', 'Box + outline']];
// A TEXT line's (phase V42; the owner's (ц4)): what stands behind it besides a box - a plate in the box's color - and how it
// comes in and goes out (style.js ENTERS / LEAVES, drawn by captions/text-fx.js).
const BEHIND_TEXT = BEHIND.concat([['round', 'A rounded box'], ['pill', 'A pill'], ['marker', 'A marker stroke'],
  ['underline', 'An underline'], ['circle', 'A circle'], ['tag', 'A tag with a stripe'], ['sticker', 'A sticker']]);
const ENTER_OPTS = [['none', 'At once'], ['fade', 'Fade'], ['pop', 'Pop'], ['zoom', 'Zoom'], ['grow', 'Grow'], ['rise', 'Rise'],
  ['from-left', 'From the left'], ['from-right', 'From the right'], ['drop', 'Drop'], ['blur', 'Blur'], ['stretch', 'Stretch'],
  ['swing', 'Swing'], ['wipe', 'Wipe'], ['mask-rise', 'Slot'], ['rows', 'Line by line'], ['words', 'Word by word'],
  ['words-pop', 'Words pop'], ['letters', 'Letter by letter'], ['letters-pop', 'Letters pop'], ['letters-drop', 'Letters drop'],
  ['typewriter', 'Typewriter'], ['glitch', 'Glitch'], ['flicker', 'Flicker']];
const LEAVE_OPTS = [['none', 'At once'], ['fade', 'Fade'], ['pop', 'Pop'], ['zoom', 'Zoom'], ['shrink', 'Shrink'], ['rise', 'Rise'],
  ['sink', 'Sink'], ['to-left', 'To the left'], ['to-right', 'To the right'], ['fall', 'Fall'], ['blur', 'Blur'], ['stretch', 'Stretch'],
  ['wipe', 'Wipe'], ['mask-sink', 'Slot'], ['rows', 'Line by line'], ['words', 'Word by word'], ['letters', 'Letter by letter'],
  ['letters-fall', 'Letters fall'], ['backspace', 'Backspace'], ['glitch', 'Glitch'], ['flicker', 'Flicker']];
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
let _capFont = null;

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
  // (phase V73 block 5, 5b) the lane's name in the strip's head, what it holds under it
  _capHead(host, _cap1(track.name || (isSubs ? 'Subtitles' : 'Text')), 'the whole lane' + (isSubs && pagesNow ? ' · ' + pagesNow + ' pages' : '')
    + (mix ? ' · ' + mix.length + ' presets' : ''));
  // Saved as the lane's style is stored - an automatic size stays automatic. Several presets are no one look (пр23): no saving.
  if (mix) _mixLine(host, mix);
  else _presetLine(host, raw, () => apply(raw.preset), undefined, () => raw, isSubs ? '' : 'text');

  // (phase V73 block 5, 5b, (б5-8) а) FOUR GROUPS: Text - where the lines come from and how they are cut; Look; Motion - In and
  // Out; Place - where and how big. The rows in each as they were.
  const tx = _group(host, 'text', 'Text');
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
    tx.appendChild(C.acts([gen, add, back]));
    if (fixed) tx.appendChild(C.hint('Your ' + fixed + ' corrected ' + (fixed === 1 ? 'word goes' : 'words go') + ' with "back to what was heard".', true));
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
    tx.appendChild(C.row('Listen on', on));
    if (L && !can) {
      tx.appendChild(C.hint('Recognition on this computer is not installed in this copy of the app - '
        + (engine === 'local' ? 'switch Listen on to cloud (Groq).' : 'Groq only.')));
    } else if (engine === 'local' && L && !L.model.present) {
      tx.appendChild(C.hint('The first time downloads the speech model (' + Math.round(L.model.bytes / 1e6)
        + ' MB) into the library\'s cache - after that it needs no internet.'));
    }
    // The line is marked, so a percent that moves rewrites it in place instead of rebuilding the strip.
    const ln = C.hint(v.line || '');
    ln.dataset.listenLine = '1';
    ln.hidden = !v.line;
    tx.appendChild(ln);
    _listenShape = { key: Store.key(), busy: v.busy, ask: v.ask, again: v.again, heard: v.heard, local: L };
    // A run that fell over here with no model asks once (the owner, K1b answer 4).
    if (v.ask && L) {
      tx.appendChild(C.row('', C.button('Download the model (' + Math.round(L.model.bytes / 1e6)
        + ' MB)', () => Listen.start({ download: true }), { title: 'Download the speech model and listen on this computer' })));
    }
  } else {
    tx.appendChild(C.acts([add]));
    tx.appendChild(C.hint('Typed, not heard: a transcription writes to the Subtitles lane '
      + 'and never touches this one.', true));
  }

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
    tx.appendChild(C.row('Cut', C.pair(C.select(CUT_OPTS, sent ? 'sentences' : 'pages', (v) => set({ cut: v })), sent ? recut : null)));
    const pages = (track.clips || []).filter(c => Array.isArray(c.words) && c.words.length).length;
    const counted = heard + ' heard words on ' + pages + (pages === 1 ? ' page' : ' pages')
      + '; changing this cuts them again straight away, lines you typed stay as they are.';
    if (sent) {
      // One rule, no Words or Lines (с42); Rows under Cut (V71); In and Out in the group Motion (V73 block 5).
      _rowsRow(tx, raw, set);
      tx.appendChild(C.hint(heard
        ? 'Classic subtitles: a page is a sentence, or part of one cut at a comma - two lines of up to 42 characters (and '
          + '78% of the frame), 1-7 s on screen; a pause of a second ends it. ' + counted
        : 'Classic subtitles, a sentence at a time. Nothing has been transcribed yet, so this waits for the first Generate.'));
    } else {
      tx.appendChild(C.row('Words', C.pair(C.slider({
        min: 0, max: 12, step: 1, value: +raw.wordsPerLine || 0,
        fmt: (v) => (v > 0 ? 'up to ' + v : 'auto (up to ' + autoWordsPerLine(fmt) + ')'),
        onChange: (v) => set({ wordsPerLine: v }),
      }), recut)));
      // Two lines at most to choose from; a style that says three (a preset, a hand) is shown as it is.
      const lines = Math.max(1, Math.min(3, Math.round(+st.lines || 2)));
      const LINES = [['1', 'One'], ['2', 'Two']].concat(lines === 3 ? [['3', 'Three']] : []);
      tx.appendChild(C.row('Lines', C.select(LINES, String(lines), (v) => set({ lines: +v }))));
      // Rows under Lines (V71); In and Out in the group Motion (V73 block 5).
      _rowsRow(tx, raw, set);
    }
  }

  const marks = (track.clips || []).some(c => Array.isArray(c && c.words) && c.words.some(w => w && w.k));
  const rowsO = { fmt, autoS: raw.sizeAuto !== false, textLane: !isSubs, marks,
    pages: () => (track.clips || []).map(c => ({ track, clip: c })), laneFonts: fontsOf(raw) };
  const lk = _group(host, 'look', 'Look');
  // (V68 P4) The fonts chosen in the fonts tab, said with a ✕ that takes them all away - the preset's own font again.
  if (fontsOf(raw)) _fontsRow(lk, track, raw);
  // Several presets (пр22): a section per preset, closed until opened; the common rows - Where, Nudge, Size - are Place's.
  if (mix) _mixSections(lk, track, raw, mix, fmt, marks);
  else _lookRows(lk, st, set, rowsO);
  // A subtitle lane's In and Out - with several animations dealt, "mixed" where they differ (V49).
  _motionRows(_group(host, 'motion', 'Motion'), st, set, rowsO, anims);
  _placeRows(_group(host, 'place', 'Place'), st, set, rowsO);

  // Lines that wear a style of their own keep it when the lane's changes (the owner's answer 2). What a mix dealt them is no
  // style of their own, and stays (V49).
  const own = (track.clips || []).filter(c => c && withoutRefs(c.style));
  if (own.length) {
    _actRow(host, C.button(own.length + (own.length === 1 ? ' line has its' : ' lines have their') + ' own style - reset',
      () => setCapStyleB(own.map(c => c.id), (c) => refsOf(c.style), { replace: true, cut: isSubs }),
      { title: 'Puts those lines back on the lane\'s style' }));
  }
  _presetsHint(host);
  _laneRemove(host, track);
  // A press on an animation's tile: the pair on the lane - one pair again; with Shift on the subtitle lane, one more dealt (_shiftAnim).
  const anim = (pair, o) => {
    if (isSubs && o && o.shift) return _shiftAnim(track, raw, st, pair);
    set(Object.assign(pairOf(pair), anims ? { anims: [] } : {}));
  };
  return { preset: mix ? '' : (raw.preset || ''), edited: !mix && !!raw.preset && editedKeys(raw).length > 0, apply, readOnly: !Store.canEdit(),
    presets: mix ? mix.map(e => e.preset).filter(Boolean) : null, editedIds: mix ? mix.filter(_entryEdited).map(e => e.preset) : null,
    kind: isSubs ? 'subs' : 'text', anims: anims ? anims.slice() : [pairNow(st)], anim,
    fonts: fontsOf(raw) ? fontsOf(raw).slice() : [], font: (list) => _laneFonts(track, raw, list) };
}

// ── The fonts of a lane (phase V68 P4, the owner's (хп8), (хп12), (хп47)) ──
// The fonts tab's choice on the lane - subtitles or text: one font, every page's; several (Shift), dealt - each page one of them,
// two in a row never the same (captions/mix.js), its seed the lane's (a new one only when it has none); none, the preset's own.
// The lane is not cut again: a page keeps the width it has in its preset's font (captions/place.js). One step to undo.
// The row that says them: their names, the tab named, ✕ - none again.
function _fontsRow(host, track, raw) {
  const list = fontsOf(raw);
  const names = list.map(f => (CAP_FONTS.find(x => x.family === f) || { label: f }).label);
  const said = _el('span', 'mv3-c-fonts', names.join(', '));
  said.title = list.length > 1 ? 'Each page one of them, two in a row never the same - the fonts tab; each page as wide as in the preset\'s font'
    : 'Every page in it - the fonts tab; each page as wide as in the preset\'s font';
  const x = C.button('', () => _laneFonts(track, raw, []), { title: 'Takes the fonts away - the preset\'s own font again' });
  x.classList.add('is-icon', 'is-quiet', 'is-del', 'u-x');   // (phase V73 block 5, 5b) the one ✕
  x.setAttribute('aria-label', 'Take the fonts away');
  x.disabled = !Store.canEdit();
  host.appendChild(C.row(list.length > 1 ? list.length + ' fonts' : 'Font tab', C.pair(said, x)));
}
function _laneFonts(track, raw, list) {
  const fonts = Array.isArray(list) ? list.slice() : [];
  const patch = { fonts };
  if (fonts.length >= 2 && !Number.isInteger(raw.mixSeed)) patch.mixSeed = newSeed();
  setSubsStyleB(track.id, patch, false, (t) => { if (needsDeal(t)) redealFonts(t.clips, t.style); });
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
    head.title = open ? 'Fold it' : 'The look of these pages - font, colors, the spoken word, outline, shadow, box';
    const c = _el('span', 'mv3-cap-sec-c');
    c.appendChild(iconEl(open ? 'chevron-down' : 'chevron-right', 14));   // (phase V73 block 5, 5b) Lucide's, not ▾ ▸
    head.appendChild(c);
    head.appendChild(_el('span', 'mv3-cap-sec-n', presetName(e.preset) || 'a look'));
    head.appendChild(setFigures(_el('span', 'mv3-cap-sec-k'), n + (n === 1 ? ' page' : ' pages') + (edited ? ' · edited' : '')));
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
      const b = C.button('Back to the preset', () => put(_lookEntry(base), true), { title: 'Takes away what was changed in this look' });
      b.disabled = !Store.canEdit();
      body.appendChild(C.row('', b));
    }
    _lookRows(body, stK, setK, { fmt, textLane: false, motion: false, marks, setBehind: (v) => setK(_behind(v, stK)) });
    host.appendChild(body);
  });
}

// ── The settings of words, shared by a lane, one caption and several (K6) ────
// The head: what the settings below apply to - the owner's addition: a lane, this line, or several.
// (phase V73 block 5, 5b) The title goes into the strip's head; what it applies to stays at the top of the strip, its figures in mono.
function _capHead(host, title, sub) {
  _title = title;
  if (sub) host.appendChild(setFigures(_el('div', 'mv3-cap-sub'), sub));
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
      const b = C.button('Back to the preset', back, { title: 'Takes away what was changed since ' + name + ' was applied' });
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
  const b = C.button('Save as my preset', () => {
    askName({
      anchor: b.isConnected ? b : null, title: 'Save as my preset', value: MyPresets.freeName(), okLabel: 'Save', maxLength: 60,
      submit: (name) => MyPresets.save(name, lookOf(), kind),
    }).then((p) => { if (p && p.id) CapView.showMine(p.id); });
  }, { title: 'Keeps this look - font, colors, place, effects - as a preset of your own: its tile goes into Mine, to put on any lane or line' });
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
// (phase V73 block 5, 5b, (б5-8) а) In groups since V73: Look · Motion · Place - after a line's own Text.
function _styleRows(host, st, set, o) {
  _lookRows(_group(host, 'look', 'Look'), st, set, o);
  _motionRows(_group(host, 'motion', 'Motion'), st, set, o);
  _placeRows(_group(host, 'place', 'Place'), st, set, o);
}

function _placeRows(host, st, set, o) {
  host.appendChild(C.row('Where', C.select(POS, st.pos, (v) => set({ pos: v }))));
  // Nudged up or down from that anchor, as a fraction of the frame - so it means the same
  // thing after the format changes, which a number of pixels would not. ±80% (phase V30, block 3): a page dragged
  // on the preview anywhere on the frame is still on the slider.
  const side = +st.tx || 0;
  const across = Math.abs(side) < 0.005 ? '' : (side < 0 ? 'left ' : 'right ') + Math.abs(Math.round(side * 100)) + '%';
  // Across, it is moved on the preview only; here it is said, and taken back to the middle.
  const centre = C.button('Center', () => set({ tx: 0 }), {
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
    C.toggleNamed('Auto', autoS, (on) => set(on ? { sizeAuto: true, size: autoSize(o.fmt) } : { sizeAuto: false }),
      'Let the format choose the size'))));
}

function _lookRows(host, st, set, o) {
  // Bold is a choice only where the family ships both weights; a Black or a Bold file is what it is.
  // (V68 P4) Under the fonts of the fonts tab the row shows the preset's own font (the one a page keeps the width of); a font
  // chosen here is the lane's one font again - the tab's go.
  const dealt = !!o.laneFonts;
  const fontSel = C.select(FONTS, dealt ? (st.fitTo || st.font) : st.font, (v) => set(dealt ? { font: v, fonts: [] } : { font: v }));
  const marks = [];
  if (fontOf(st.font).bold === 'style') marks.push(C.toggleNamed('B', !!st.bold, (on) => set({ bold: on }), 'Bold', 'bold'));
  marks.push(C.toggleNamed('I', !!st.italic, (on) => set({ italic: on }), 'Italic', 'italic'));
  const markBox = _el('span', 'mv3-c-marks');
  for (const m of marks) markBox.appendChild(m);
  host.appendChild(C.row('Font', C.pair(fontSel, markBox)));
  const twin = fontOf(st.font).twin;
  if (twin) host.appendChild(C.hint(fontOf(st.font).label + ' has no Russian letters - a line with them is drawn in ' + twin + '.'));
  host.appendChild(C.row('Casing', C.select(CASINGS, st.casing, (v) => set({ casing: v }))));
  host.appendChild(C.row('Color', C.color(st.primary, (v) => set({ primary: v }))));
  // What the spoken word does - and the color it is done in.
  host.appendChild(C.row('Spoken', C.select(EFFECTS, st.effect, (v) => set({ effect: v }))));
  if (['color', 'box', 'pop', 'bounce'].includes(st.effect)) {
    host.appendChild(C.row('Its color', C.color(st.highlight, (v) => set({ highlight: v }))));
  } else if (st.effect === 'karaoke' || st.effect === 'sweep') {
    host.appendChild(C.row('Not yet', C.color(st.secondary, (v) => set({ secondary: v }))));
  }
  // A WORD MADE TO STAND OUT (K10b) wears this color for its whole page. Shown where a line has one, or once
  // it was set by hand; "auto" is the spoken word's color - or, where that is the text's own (23 presets),
  // yellow, red or blue, whichever stands out (style.js markedColour).
  if (o.marks || st.marked) {
    host.appendChild(C.row('Marked', C.pair(
      C.color(markedColour(st), (v) => set({ marked: v })),
      C.toggleNamed('Auto', !st.marked, (on) => set({ marked: on ? '' : markedColour(st) }),
        'The color that stands out from this style: the spoken word\'s, or yellow, red or blue'))));
  }
  // A typed line of the subtitle lane plays the spoken word by its letters (phase V30, block 1); a text lane holds titles.
  if (o.textLane && st.effect !== 'none') {
    host.appendChild(C.hint('A text lane has no spoken word - it plays on the Subtitles lane.'));
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

// IN AND OUT (phase V73 block 5, 5b: the group Motion): a text lane's or line's entrance and exit, each with its length (V42, (о15),
// (ц4)) - on a lane for all its lines, on a line for itself; a subtitle page's In and Out (V49) - `anims`, a lane's dealt pairs.
function _motionRows(host, st, set, o, anims) {
  if (!o.textLane) { _pageMotionRows(host, st, set, anims); return; }
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
}

// A SUBTITLE PAGE'S IN AND OUT (phase V49, (пр16)-(пр18)): the In shown is the one chosen, or the preset's own way of arriving
// while none is (style.js `appear`, (пр20)); "at once" chosen takes that away too. Their lengths are the app's.
// With several animations dealt (`anims`, V49): a side the pairs do not share says "mixed", and choosing one puts it on every pair -
// the other side stays dealt.
// TWO ROWS (phase V71, the owner's (хо21), (хо29), (хо34)): the lane's (captions/style.js `rows`) - one undo step; one row is no field.
const ROWS_OPTS = [['1', 'One'], ['2', 'Two']];
function _rowsRow(host, raw, set) {
  const sel = C.select(ROWS_OPTS, rowsOn(raw) ? '2' : '1', (v) => set({ rows: v === '2' ? 2 : undefined }));
  sel.title = 'Two: a page is whole while its words are spoken - its In before the first word, its Out after its end, '
    + 'at least 0.8 s - and every other page stands in a second row, so the next one does not flash in its place';
  sel.disabled = !Store.canEdit();
  host.appendChild(C.row('Rows', sel));
}

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
    // (phase V71) Where its row draws it.
    const b = pageBox(x.clip, x.track.style, x.track.kind === 'subs', F.w, F.h, x.track);
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
  _kind = 'lines';
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
  _styleRows(host, st, set, { fmt, textLane: items.every(x => x.track.kind !== 'subs'), setBehind, marks: (items.map(x => x.clip)).some(c => Array.isArray(c && c.words) && c.words.some(w => w && w.k)),
    pages: () => items });
  if (items.some(x => x.clip.style)) {
    _actRow(host, C.button('Back to the lane\'s style', () => setCapStyleB(ids, null, { cut: true }),
      { title: 'These lines wear their lane\'s style again' }));
  }
  _presetsHint(host);
  _removeRow(host, C.button('Delete ' + items.length + ' lines', () => deleteMultiB(),
    { danger: true, title: 'Also on the Delete key' }));
  // The pair they all wear is lit (V49); a press puts one on each.
  const pairs = new Set(items.map(x => pairNow(styleOf(x.track, fmt, x.clip))));
  return { preset: common, edited: anyEdited, apply: wear, readOnly: !Store.canEdit(),
    kind: items.every(x => x.track.kind === 'text') ? 'text' : 'subs',
    anims: pairs.size === 1 ? [...pairs] : [], anim: (pair) => setCapStyleB(ids, pairOf(pair), { cut: false }),
    // (V68 P4) The fonts tab on lines: the font pressed is each line's own, as the Font row above puts it.
    fonts: _ownFonts(items.map(x => x.clip)), font: (list, o) => { if (o && o.family) set({ font: o.family }); } };
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
  // (phase V73 block 5, 5b) "Line · Subtitles" in the strip's head
  _capHead(host, 'Line · ' + _cap1(track.name || track.kind), own ? 'its own style' : dealt);
  // What is saved is the look the line is drawn with: its lane's style with its own on top (the cut is the lane's).
  // A text preset keeps where the line is now (V42, (ц3)).
  const wear = (id, cut) => {
    const p = placed(id, styleOf(track, fmt, clip));
    if (p) setCapStyleB([clip.id], track.kind === 'subs' ? keepMotion(p, clip.style || {}, true) : p, { replace: true, cut });
  };
  _presetLine(host, own ? clip.style : null, () => wear(clip.style.preset, true),
    undefined, () => resolveStyle(track.style, clip.style), track.kind === 'text' ? 'text' : '');
  const heardLine = isHeard(clip);
  // (phase V73 block 5, 5b, (б5-8) а) its words - the group Text; then Look · Motion · Place
  const tx = _group(host, 'text', 'Text');
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
  tx.appendChild(area);
  tx.appendChild(C.hint('Drag the caption to move it, and its edges to change how long it '
    + 'stays up.'));

  if (heardLine) {
    // A HEARD LINE KEEPS ITS TIMING WHEN IT IS REWRITTEN (K10): the words that stay keep their moments, new
    // ones share the time of what they replace (words.js) - and each word can be changed by itself (K10b).
    const fixed = correctedCount(clip);
    tx.appendChild(_fact('Timed', clip.words.length + ' words' + (fixed ? ' · ' + fixed + ' corrected' : '')));
    if (spells(clip.words, clip.name)) {
      WordEdit.paint(tx, track, clip, { mark: markedColour(styleOf(track, fmt, clip)) });
      // Corrections can make a line more than a page of its lane holds; a correction never cuts by itself.
      const over = isCorrected(clip) ? overPage(clip, track.style, fmt) : null;
      if (over) {
        tx.appendChild(C.hint('Longer than a page of this lane: ' + over + '.'));
        tx.appendChild(C.row('', C.button('Re-cut this line', () => recutLinesB(track.id, [clip.id]),
          { title: 'Cuts this line into pages by the lane\'s rules, keeping its words and corrections' })));
      }
    } else {
      // Rewritten before K10: its words still say what was heard, and it is drawn as one piece until timed.
      tx.appendChild(C.hint('The text was changed by hand; its words still say: ' + textOf(clip.words)));
      tx.appendChild(C.row('', C.button('Time the text', () => {
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
  const heard = isHeard(clip);
  _styleRows(host, styleOf(track, fmt, clip), (patch) => setCapStyleB([clip.id], patch, { cut: heard && _cuts(patch) }),
    { fmt, textLane: track.kind !== 'subs', marks: ([clip]).some(c => Array.isArray(c && c.words) && c.words.some(w => w && w.k)),
      pages: () => [{ track, clip }] });
  if (own) {
    _actRow(host, C.button('Back to the lane\'s style', () => setCapStyleB([clip.id], refsOf(clip.style), { replace: true, cut: heard }),
      { title: 'This line wears its lane\'s style again' }));
  }
  _presetsHint(host);
  _removeRow(host, C.button('Remove this line', () => removeB(track.id, clip.id), {
    danger: true, title: 'Takes the caption off the lane',
  }));
  // ITS tiles lit (V49, (пр17)): the preset it is drawn with - its own, the one its lane's mix dealt it, or its lane's.
  const s = own ? clip.style : null;
  return { preset: s ? (s.preset || '') : (drawn.preset || ''), edited: !!(s && s.preset) && editedKeys(withoutRefs(s)).length > 0,
    apply: (id) => wear(id, heard), readOnly: !Store.canEdit(), kind: track.kind === 'text' ? 'text' : 'subs',
    anims: [pairNow(styleOf(track, fmt, clip))], anim: (pair) => setCapStyleB([clip.id], pairOf(pair), { cut: false }),
    fonts: _ownFonts([clip]),
    font: (list, o) => { if (o && o.family) setCapStyleB([clip.id], { font: o.family }, { cut: heard }); } };
}

// (V68 P4) The font lines wear by their own style - lit on the fonts tab when they all wear the same one.
function _ownFonts(clips) {
  const f = new Set(clips.map(c => (c && c.style && c.style.font) || ''));
  return f.size === 1 && !f.has('') ? [...f] : [];
}

// NO DESCRIPTION of the lane under its name: what is on it is the lane itself, drawn full width two inches away. (Since phase
// V73 block 5 the strip has a head - the lane's name and a ✕, the owner's (к24-4).)
function _renderBlankTrack(host, track) {
  // (phase V73 block 5, 5b) Its name in the strip's head ("Main video"); its folded groups kept per kind of lane.
  _kind = 'lane-' + track.kind + (track.main ? '-main' : '');
  _title = _cap1(track.name || track.kind);
  if (track.kind === 'video') return _blankVideoTrack(host, track);
  if (track.kind === 'audio') return _blankAudioTrack(host, track);
  if (track.kind === 'subs' || track.kind === 'text') return _blankWordsTrack(host, track);
}

// Which clip is selected is visible on the timeline and outlined on the preview; since phase V73 block 5 the strip's head says it
// too - "Clip · <name>" - with the ✕ that lets it go (the owner's (к24-4)).
function _renderBlankClip(host, { track, clip }) {
  const set = (k, v) => setB(track.id, clip.id, k, v);
  const still = isStill(clip);
  const pair = mateB(clip.id);
  // (phase V73 block 5, 5b, (к24-4)) What it is and its name in the strip's head; its folded groups kept per kind of clip.
  const words = track.kind === 'subs' || track.kind === 'text';
  _kind = words ? 'line' : track.kind === 'audio' ? 'sound' : still ? 'picture' : 'clip';
  _title = (track.kind === 'audio' ? 'Sound' : still ? 'Picture' : 'Clip') + ' · ' + (clip.name || 'untitled');

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
  // (phase V73 block 5, 5b) "5 clips" in the strip's head; their rows in the groups Sound · Picture (Frame's rows in it since V84)
  _kind = 'many';
  _title = n + ' clips';

  const picked = pickedB();
  // (phase V54, block 3) Their sound - the audio lanes' clips and the sound of the films among them - shifted and faded at once.
  const sounds = _soundsOf(picked);
  if (sounds.length) _soundSection(host, sounds, picked.every(x => x.track.kind === 'audio'));
  // (phase V65, (пз5)) The video clips among them - every video lane - seen as much as one another: one slider, one step.
  const videos = picked.filter(x => x.track.kind === 'video');
  if (videos.length) {
    const pic = _group(host, 'picture', 'Picture');
    _opacityRow(pic, videos);
    if (videos.length < n) pic.appendChild(C.hint('Opacity is for the ' + videos.length + ' picked clips of the video lanes.'));
    // (phase V65, (пз10)) The blend mode - for those of lanes above main.
    const above = videos.filter(x => !isMainVideo(x.track));
    if (above.length) {
      _blendRow(pic, above);
      if (above.length < videos.length) pic.appendChild(C.hint('Blend is for the ' + above.length + ' picked clips above main video.'));
    }
    // (phase V49, (пр9)) Main clips among them - cut silence's pieces - are made a PiP, and sized and moved, all at once. (phase
    // V84, (эф17)) In Picture, under a line.
    const mains = picked.filter(x => isMainVideo(x.track));
    if (mains.length) {
      const fr = pic;
      _bsep(fr);
      if (mains.length < n) fr.appendChild(C.hint('The crop and the PiP below are for the ' + mains.length + ' picked clips of main video.'));
      // (phase V51, (пр44)) One crop frame for all of them.
      cropRows(fr, mains);
      if (mains.some(x => x.clip.pip)) { _bsep(fr); _pipSection(fr, mains); }
    }
    // (phase V75) Their colour - one set of sliders for all the picked video clips.
    _colorGroup(host, videos);
  } else if (!sounds.length) {
    const p = document.createElement('div');
    p.className = 'mv3-ins-note';
    p.textContent = 'Settings are per clip, so there is nothing here to set for several at once. '
                  + 'What can be done to all of them is remove them.';
    host.appendChild(p);
  }

  _removeRow(host, C.button('Delete ' + n + ' clips', () => deleteMultiB(),
    { danger: true, title: 'Also on the Delete key' }));
}

// What the strip is about, as a key: the clip, the lane, the clips picked together - or nothing.
let _paintedPick = null;
function _pickKey() {
  const many = multiB();
  if (many > 1) return 'm:' + pickedB().map(x => x.clip.id).join(',');
  const one = oneB();
  if (one) return 'c:' + one.clip.id;
  const tr = trackB();
  if (tr) return 't:' + tr.id;
  return Views.altCaptions() ? 'alt' : '';
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
  // (phase V75, the owner 2026-11-06: "чтобы не скакало по вертикали поле настроек") THE STRIP KEEPS ITS SCROLL while it is
  // painted again for the same pick - a slider let go, a list changed: the strip is rebuilt whole, and emptied for a moment it
  // lost its place. Another pick starts at the top.
  const scroller = _overHost();
  const pick = _pickKey();
  const top = scroller && pick === _paintedPick ? scroller.scrollTop : 0;
  let cap;
  WordEdit.beforeRepaint();
  // (phase V84) The groups of this paint, and the one to open if fx-ui.js asked.
  _painted = [];
  _forceOpen = takeFxOpenAsk() ? 'effects' : null;
  try { cap = _render(); } finally { WordEdit.afterRepaint(); }
  _settleGroups();
  if (scroller) scroller.scrollTop = top;
  _paintedPick = pick;
  _paintHead(_overHost());
  const was = Views.isCaptions();
  // While a band is swept the view stays as it was - it follows the pick when the band is let go.
  const on = gestureB() ? was : (!!cap && !_narrow());
  _capApply = cap ? cap.apply : null;
  _capAnim = cap && cap.anim ? cap.anim : null;
  _capFont = cap && cap.font ? cap.font : null;
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
  _title = '';
  _kind = '';
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
  if (tr) {
    _over(true);
    // (phase V66) A highlights project's ticked fragments: the lane's name gives their common settings (lib-views.js laneAlt).
    const la = Views.laneAltFor(tr);
    if (la) return la.render(over, tr) || undefined;
    return _renderBlankTrack(over, tr);
  }
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
  CapView.onFonts((list, o) => { if (_capFont) _capFont(list, o); });
  // The person's own presets (phase V30, block 5): read once, and a change paints the strip - "based on" a preset of theirs
  // is said once the list is known, and goes when the preset is deleted.
  MyPresets.onChange(() => render());
  MyPresets.load();
  Views.onBack('captions', () => { const alt = !!Views.altCaptions(); Views.altRelease(); clearSelB(); if (alt) render(true); });
  // (phase V73 block 5, 5b, the owner's (к24-4)) THE HEAD'S ✕ does what Escape does - the pick let go; and with nothing picked,
  // a view's own captions (a highlights project's ticked fragments) let go, as "Library" in the captions view lets them.
  const x = document.getElementById('mv3-over-x');
  if (x) {
    x.addEventListener('click', () => {
      const alt = !oneB() && !trackB() && multiB() <= 1 && !!Views.altCaptions();
      clearSelB();
      if (alt) { Views.altRelease(); render(true); }
    });
  }
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
  // (phase V84) An effect opened by its frame on the timeline.
  onFxFocus(() => render());
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
    // (phase V54) A level shift heard while it was held goes back to what is stored - its `change`, if any, writes the new one.
    setLiveVolumesB(null);
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
