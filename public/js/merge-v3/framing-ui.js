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
import { plan, normalize } from '../framing/path.js';
import { placeBySplit } from '../captions/split.js';

export const FRAMINGS = [['fixed', 'fixed'], ['face', 'follow the face'], ['center', 'middle'],
                         ['whole', 'whole + blur'], ['bands', 'two faces']];

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
  if (f.mode === 'face' || f.mode === 'bands') {
    const shots = (f.shots || []).length;
    const none = (f.shots || []).filter((s) => s.kind === 'whole').length;
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
  if (mode === 'fixed') { _setFrame(c, null); _say(); return; }
  if (mode === 'center' || mode === 'whole') {
    const p = await _json('/api/media/probe?src=' + encodeURIComponent(c.src));
    if (!p || !(p.w > 0)) { _wait.set(c.id, { mode, error: 'the film could not be read' }); _say(); return; }
    const side = p.rotate === 90 || p.rotate === 270;
    _setFrame(c, { v: 1, mode, shift, src: { w: side ? p.h : p.w, h: side ? p.w : p.h }, shots: [] });
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
      _setFrame(c, plan(st.faces, { aspect: aspectOf(), mode, shift }));
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
