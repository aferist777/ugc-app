/* rules.js - WHAT THE PREVIEW AND THE RENDER MUST ANSWER THE SAME about a timeline (V91 cleanup block 6, the owner's
   (чк16): each was written two to four times, and a copy fixed alone made the preview show one thing and the render do
   another). The page imports it, the server require()s it (Node 24) - as js/sound/fades.js.

     isPlaced(clip)          an insert placed on the frame: `tw` has a value at all - not "smaller than the frame":
                             anchored by its middle, an insert as wide as the film can still be moved, turned and hung
                             over the edge. `tw: null` is the unplaced state, and the only one.
     isStillSrc(src)         a picture, by its file's extension - a still has no length of its own.
     endOf(timeline)         how long it runs: the end of its last clip, in seconds (each reader rounds as it did).
     gainOf(lane, clip, own) how loud a sound is heard: the clip's volume (`own` - one being dragged, not written yet)
                             times its lane's. 0 or less is not heard at all - left out of the mix, not played silent. */

export const isPlaced = (c) => !!(c && c.tw != null && +c.tw > 0);

const STILL_RE = /\.(jpe?g|png|webp|avif|bmp)$/i;
export const isStillSrc = (src) => STILL_RE.test(String(src || '').split('?')[0]);

export function endOf(timeline) {
  let end = 0;
  for (const tr of Object.values((timeline && timeline.tracks) || {})) {
    for (const c of ((tr && tr.clips) || [])) end = Math.max(end, (+c.start || 0) + (+c.dur || 0));
  }
  return end;
}

export function gainOf(lane, clip, own) {
  const master = (lane.volume == null) ? 1 : +lane.volume;
  if (!(master > 0)) return 0;
  const v = own != null ? own : (clip.volume == null) ? 1 : +clip.volume;
  return v * master;
}
