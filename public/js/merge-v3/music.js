/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — the music panel of an audio lane: the lane's master volume and where its music comes from. Phase I5; since
   phase V28.4 (the owner 2026-10-12) the tracks themselves are in the Library panel - AUDIO -> Music in its tree
   (js/merge-v3/library.js) - and one is laid on a lane by dragging it there, as it is, from where it is let go; two of
   them overlapping cross into each other by themselves (js/sound/fades.js).

   (phase V34.E, the owner's (м10)) The generator went from here: music and sounds are made in the Library panel's
   "/ generate audio" (js/merge-v3/audchat.js) - Suno and ElevenLabs, for the open project. A clip's fades stay in its
   own settings.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as Store from './store.js';
import * as C from './controls.js';

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

/** Kept for the inspector: the panel has nothing of its own to forget. */
export function resetView() {}

export function renderMusicTrack(host, track) {
  // The lane's master volume first: a setting for the music already down. A lane never set plays at its full level (null is 1
  // in the render and the preview) - so it shows 0 dB (phase V54, the owner's (зв11) в: it showed -6 dB and played at 0).
  host.appendChild(C.row('Volume', C.volume(
    track.volume != null ? track.volume : 1,
    (v) => Store.mutate(tl => { const t = _lane(tl); if (t) t.volume = v; }),
  )));
  host.appendChild(_el('div', 'mv3-c-sep'));
  const hint = C.hint('The tracks and sounds are in the Library panel - AUDIO: a press on a tile plays it, drag it onto this lane. '
    + 'Two tracks overlapping cross into each other by themselves. New music and sounds: "generate audio" at the top of the Library panel.');
  host.appendChild(hint);
}
