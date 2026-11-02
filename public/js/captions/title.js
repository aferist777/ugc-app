/* ═══════════════════════════════════════════════════════════════════════════
   CAPTIONS — THE TITLE ON TOP of a highlights fragment (phase V33.3; the owner's (х10), (х35)-(х37), 2026-10-21).

   The moment's headline, on a TEXT lane of the fragment's timeline for its first three seconds - a line like any typed
   one: edited, drawn out, moved and deleted on the timeline, given another look by the caption tiles when it is picked.
   ONE module for the server (lib/highlights-cut.js lays it in a new fragment and adds it to a made one) and the page
   (merge-v3/highlights.js adds it to the fragment that is open - a server's write under an open timeline reads to the page
   as somebody else's edit).

   Its look by default ((х37)): large, bold, white on a dark plate, at the top - below the strip the platforms draw there
   (merge-v3/platforms.js: TikTok's tabs end at 235 px of 1920, Shorts' and Reels' buttons at 220), so it starts at
   about 270 px. Since phase V42 that look is the TEXT PRESET Dark Plate (presets-text.js; it pops in and fades out) worn
   from there: the lane says "based on Dark Plate", and a tile of the text gallery gives it another look, its place kept.
   ═══════════════════════════════════════════════════════════════════════════ */

import { normalizeStyle } from './style.js';
import { textPresetOf } from './presets-text.js';

export const TITLE_SECONDS = 3;
export const TITLE_MAX = 80;

export const TITLE_PRESET = 'tx-dark-plate';
// The preset's whole style, marked with its id, at the title's place (a text preset has none of its own, (ц3)).
export const TITLE_STYLE = normalizeStyle(Object.assign({}, textPresetOf(TITLE_PRESET).style, {
  preset: TITLE_PRESET, pos: 'top', tx: 0, ty: 0.045,
}));

/** The fragment's title lane, or null: a text lane holding a line that starts at its very beginning. */
export function titleLaneOf(tl) {
  return (((tl && tl.tracks) || []).find((t) => t && t.kind === 'text' && (t.clips || []).some((c) => c && (+c.start || 0) < 0.05))) || null;
}

/**
 * The title put on a timeline, inside its one mutation: a text lane right ABOVE the subtitles (where a new text lane goes,
 * timeline-b.js addTextTrack), one line from 0 for three seconds (or the whole fragment when shorter). False when there is
 * no room - a title there already, or two text lanes (timeline-b.js MAX_TEXT) - or no words to say.
 * @param tl        the timeline (changed in place)
 * @param text      the headline
 * @param seconds   how long the fragment is
 * @param makeId    a fresh id for the line
 */
export function putTitle(tl, text, seconds, makeId) {
  const words = String(text || '').replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX);
  const tracks = (tl && tl.tracks) || null;
  if (!words || !tracks || titleLaneOf(tl)) return false;
  const texts = tracks.filter((t) => t && t.kind === 'text');
  if (texts.length >= 2) return false;
  const ids = new Set(tracks.map((t) => t && t.id));
  let k = 1;
  while (ids.has('x' + k)) k++;
  const dur = Math.max(0.5, Math.min(TITLE_SECONDS, +seconds || TITLE_SECONDS));
  const lane = {
    id: 'x' + k, kind: 'text', name: 'text ' + (texts.length + 1), linkId: null, main: false, volume: null, speed: null,
    style: { ...TITLE_STYLE },
    clips: [{ id: makeId(), src: null, thumb: null, name: words, start: 0, dur: Math.round(dur * 100) / 100,
      srcDur: 0, trimIn: 0, trimOut: 0, speed: 1, reversed: false, transition: null, animation: null, filter: null, volume: null, pairId: null }],
  };
  let at = tracks.findIndex((t) => t && t.kind === 'subs');
  if (at < 0) at = tracks.length;
  tracks.splice(at, 0, lane);
  return true;
}

/**
 * (phase V69 P12, the owner's (хп90)) The title on top taken off a timeline, inside its one mutation: its line - the one at the very
 * beginning of the title lane - goes, and the lane with it when nothing else is on it. False when there is no title.
 */
export function dropTitle(tl) {
  const lane = titleLaneOf(tl);
  if (!lane) return false;
  lane.clips = (lane.clips || []).filter((c) => !(c && (+c.start || 0) < 0.05));
  if (!lane.clips.length) tl.tracks.splice(tl.tracks.indexOf(lane), 1);
  return true;
}
