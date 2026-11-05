/* framing-ui.js - the clip's FRAME switch in the inspector (phase V33.2, the owner's (х9), 2026-10-21): how a filled
   clip's window moves - fixed (the old "Keep" anchor), following the face, the middle, the whole frame over its blur, two
   faces as two bands - and a shift left or right for the whole clip. Any filled clip in Merge, not only a highlights one.

   "Follow the face" and "two faces" need the clip's faces: they are counted by the app's hidden window (lib/faces.js -
   kept, so a film is counted once) and the path is worked out HERE, on the page, by the same module the render reads
   (public/js/framing/path.js plan). While they are counted the panel says how far; with no window to count (the app
   run as a bare server) it says so and nothing changes. The middle and the whole frame need only the film's size.

   (phase V40, the owner's (о7)) A frame that comes out split into two bands takes the subtitles with it: the record is
   written and the split frame's rule run over the subtitle lane IN ONE STEP (one Ctrl+Z) - a page that is on the bands for
   more than half its time goes to the middle, one the rule put there and no longer on them goes back
   (public/js/captions/split.js). */

import * as Store from './store.js';
import { SQUARE, plan, normalize } from '../framing/path.js';
import { placeBySplit } from '../captions/split.js';

// (phase V69 P12b, (хп82)) 'camera + game' - a stream's webcam on top, the game below (public/js/framing/cam.js); on any clip, so a
// stream's frame can be seen while the stream kind is in development.
export const FRAMINGS = [['fixed', 'fixed'], ['face', 'follow the face'], ['center', 'middle'],
                         ['whole', 'whole + blur'], ['bands', 'two faces'], ['cam', 'camera + game']];

// (phase V43, (ё13), (ё7а)) A part of fragmentation follows THE MOST ACTIVE (public/js/framing/active.js) - a 'face' record
// marked `active`, planned on the server from the counted source, the words and the key moments. The switch shows it as its
// own choice while the clip has it (another choice replaces it; Ctrl+Z brings it back); and its punch-ins have a switch of their
// own - on or off, nothing to edit by hand.
const ACTIVE = ['active', 'the most active'];
// (phase V69 P12b) A podcast's or a true crime fragment's clip follows THE SPEAKER - the same planner by its kind's rules
// (public/js/framing/active.js `speaker`): its switch says so.
const SPEAKER = ['active', 'the speaker'];
/** The switch's value for the clip: 'active' for a part of fragmentation, else its record's mode, or fixed. */
export const modeOf = (c) => (c && c.frame && c.frame.active ? 'active' : (c && c.frame && c.frame.mode) || 'fixed');
/** The choices the switch offers this clip - the most active only on a clip that has it. */
export const framingsOf = (c) => (c && c.frame && c.frame.active ? [c.frame.speaker ? SPEAKER : ACTIVE, ...FRAMINGS] : FRAMINGS);
/** (V43) The punch-ins' row - on / off - for a clip whose record has them, or null. `C` the inspector's controls. */
export function zoomRow(c, C) {
  const f = c && c.frame;
  if (!f || !f.active || !Array.isArray(f.zooms) || !f.zooms.length) return null;
  // (phase V73 block 5, 5b, the owner's (б5-11) а) on / off is the shared switch, as Crop, PiP and Halfer
  const sw = C.toggle(!f.noZoom, (on) => {
    const next = { ...f };
    if (!on) next.noZoom = true; else delete next.noZoom;
    _setFrame(c, next);
  });
  const row = C.row('Punch-ins', sw);
  row.title = f.zooms.length + (f.zooms.length === 1 ? ' punch-in' : ' punch-ins') + ' on its key moments, x' + f.zooms[0].z
    + ' - the program places them; off: none';
  return row;
}

const _wait = new Map();     // clip id -> { mode, frac, error }
let _tick = null;

/** The project's frame shape, w/h. */
function aspectOf() {
  const f = String((Store.timeline() || {}).format || '9:16').split(':');
  return (+f[0] > 0 && +f[1] > 0) ? (+f[0] / +f[1]) : 9 / 16;
}

const _json = (url, opt) => fetch(url, opt).then((r) => r.json()).catch(() => null);
const _say = () => { if (_tick) { try { _tick(); } catch (e) { /* the panel went */ } } };

/** What the panel says under the switch for this clip - its work in progress, or what its path is made of. */
export function noteOf(c) {
  const w = _wait.get(c.id);
  if (w && w.error) return w.error;
  if (w) return w.frac > 0 ? `finding the faces... ${Math.round(w.frac * 100)}%` : 'finding the faces...';
  const f = c && c.frame;
  if (!f) return '';
  if (f.active) {
    // (V43) The most active: what it follows, and its punch-ins.
    const shots = (f.shots || []).length;
    const bands = (f.shots || []).filter((s) => s.kind === 'bands').length;
    const z = (f.zooms || []).length;
    // (V69 P12b) The speaker's: its shots with no face shown as the square.
    const none = (f.shots || []).filter((s) => s.kind === 'whole').length;
    const cams = (f.shots || []).filter((s) => s.kind === 'cam').length;
    return `${f.speaker ? 'the speaker' : 'the most active'} · ${shots} shot${shots === 1 ? '' : 's'}` + (bands ? ` · ${bands} as two bands` : '')
      + (none ? ` · ${none} with no face as a square` : '') + (cams ? ` · ${cams} camera + game` : '')
      + (z ? ` · ${z} punch-in${z === 1 ? '' : 's'}${f.noZoom ? ' (off)' : ''}` : '');
  }
  if (f.mode === 'face' || f.mode === 'bands' || f.mode === 'cam') {
    const shots = (f.shots || []).length;
    const none = (f.shots || []).filter((s) => s.kind === 'whole').length;
    // (V69 P12b) camera + game: how many shots show the streamer's webcam.
    const cams = (f.shots || []).filter((s) => s.kind === 'cam').length;
    if (f.mode === 'cam') return `camera + game in ${cams} of ${shots} shot${shots === 1 ? '' : 's'}` + (none ? ` · ${none} with no face as a square` : '');
    return `a face in ${Math.round((+f.found || 0) * 100)}% of the frames · ${shots} shot${shots === 1 ? '' : 's'}`
      + (none ? ` · ${none} with no face shown whole` : '');
  }
  return '';
}

/** The clip's last ask for its faces came to nothing - the switch goes back to what the clip has. */
export const failed = (c) => !!(_wait.get(c.id) && _wait.get(c.id).error);

/** Called by the panel each time it is drawn: how to tell it the note changed. */
export function onNote(fn) { _tick = fn; }

// The clip's frame written - or taken off (null) - and the subtitles placed for it, as ONE step to undo (phase V40).
function _setFrame(c, value) {
  const f = value ? normalize(value) : null;
  Store.mutate((tl) => {
    for (const t of (tl.tracks || [])) {
      for (const x of (t.clips || [])) {
        if (!x || x.id !== c.id) continue;
        if (f) x.frame = f; else delete x.frame;
      }
    }
    placeBySplit(tl);
  });
}

/**
 * The switch moved to `mode` on clip `c` - written as one Ctrl+Z step with the subtitles' places (_setFrame). Faces counted
 * if they are needed - the panel follows through noteOf(). (Since V40 the inspector's writer of the clip, its third
 * argument, is not used: the frame and the subtitles go in one step.)
 */
export async function choose(c, mode) {
  _wait.delete(c.id);
  const shift = c.frame ? (+c.frame.shift || 0) : 0;
  // (V43) The most active is planned on the server; chosen while the clip has it, nothing changes.
  if (mode === 'active') { _say(); return; }
  if (mode === 'fixed') { _setFrame(c, null); _say(); return; }
  if (mode === 'center' || mode === 'whole') {
    const p = await _json('/api/media/probe?src=' + encodeURIComponent(c.src));
    if (!p || !(p.w > 0)) { _wait.set(c.id, { mode, error: 'the film could not be read' }); _say(); return; }
    const side = p.rotate === 90 || p.rotate === 270;
    // (phase V69 P12, (хп36)) "whole + blur" is the square from the middle over the blur.
    _setFrame(c, { v: 1, mode, shift, src: { w: side ? p.h : p.w, h: side ? p.w : p.h }, shots: [], ...(mode === 'whole' ? { wide: SQUARE } : {}) });
    _say();
    return;
  }
  const mine = { mode, frac: 0, error: '' };
  _wait.set(c.id, mine);
  _say();
  const src = encodeURIComponent(c.src);
  const start = await _json('/api/faces/find', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ src: c.src }) });
  if (!start || !start.success) { mine.error = (start && start.error) || 'the faces could not be asked for'; _say(); return; }
  for (let k = 0; k < 1800; k++) {
    if (_wait.get(c.id) !== mine) return;                 // the switch moved again meanwhile
    const st = await _json('/api/faces/of?full=1&src=' + src);
    if (_wait.get(c.id) !== mine) return;
    if (st && st.state === 'ready' && st.faces) {
      _wait.delete(c.id);
      // (V69 P12) A shot with no face - the square from the middle over the blur.
      _setFrame(c, plan(st.faces, { aspect: aspectOf(), mode, shift, wide: SQUARE }));
      _say();
      return;
    }
    if (!st || st.state === 'failed' || st.state === 'none') {
      mine.error = st && st.noWorker ? 'faces are found in the app window - it is not running here'
        : 'the faces could not be found' + (st && st.error ? ': ' + st.error : '');
      _say();
      return;
    }
    mine.frac = +st.frac || 0;
    _say();
    await new Promise((r) => setTimeout(r, 1000));
  }
}
