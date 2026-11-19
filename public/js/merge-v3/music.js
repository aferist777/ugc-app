/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — the music panel of an audio lane: the lane's master volume and where its music comes from. The
   tracks themselves are in the Library panel - AUDIO -> Music in its tree
   (js/merge-v3/library.js) - and one is laid on a lane by dragging it there, as it is, from where it is let go; two of
   them overlapping cross into each other by themselves (js/sound/fades.js).

   Music and sounds are made in the sound window, not here
   (js/sound/sound-window.js, Merge's host js/merge-v3/sound-host.js) - Suno and ElevenLabs, for the open project. A clip's
   fades are in its own settings.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as Store from './store.js';
import * as C from './controls.js';
// The interface's words (`t` is a lane here, so the module's words are T.t).
import * as T from '../i18n/t.js';

function _el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// WHICH LANE. A project has up to four audio lanes and this panel is opened on one of them, so the lane is TOLD rather
// than assumed.
let _dest = null;

export function setMusicDest(trackId) { _dest = trackId || null; }

function _lane(tl) {
  if (!tl || !Array.isArray(tl.tracks) || !_dest) return null;
  return tl.tracks.find(t => t && t.id === _dest) || null;
}

// `more(host)` - rows of the lane's own under its volume (its pitch, inspector.js).
export function renderMusicTrack(host, track, more) {
  // The lane's master volume first: a setting for the music already down. A lane never set plays at its full level (null is 1
  // in the render and the preview) - so it shows 0 dB.
  host.appendChild(C.row(T.t('Volume'), C.volume(
    track.volume != null ? track.volume : 1,
    (v) => Store.mutate(tl => { const t = _lane(tl); if (t) t.volume = v; }),
  )));
  if (more) more(host);
  host.appendChild(_el('div', 'mv3-c-sep'));
  const hint = C.hint(T.t('The tracks and sounds are in the Library panel - AUDIO: a press on a tile plays it, drag it onto this lane. Two tracks overlapping cross into each other by themselves. New music and sounds: "generate" by AUDIO in the Library panel\'s tree opens the sound window.'));
  host.appendChild(hint);
}
