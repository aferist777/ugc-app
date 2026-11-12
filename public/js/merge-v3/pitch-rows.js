/* THE PITCH ROWS of a sound (phase V76, the owner 2026-11-06; docs/local-app/plan/, "Фаза V76", (тн1)-(тн4), (тн10)) - one
   module for every strip that offers it: a sound clip, the sound of a film, several picked, a whole audio lane (inspector.js),
   and main audio of the ticked highlights (hl-group.js).

     Pitch        the slider: semitones, -12..+12, one at a time ((тн1) а) - no presets (the owner's (тн-п1), 2026-11-11)
     Keep timbre  on: the same voice, higher or lower; off: the timbre moves with the pitch ((тн3) а); nothing to keep at 0

   `pitches` - the pitch of each clip it stands for (null for none); `write(fn, part)` - give each clip fn(its pitch) -> its new
   pitch (null for none), ONE undo step for all of them; `part` - what changed, { st } or { shift }, for a writer that cannot
   run fn (the server's, hl-group.js). The slider and the switch keep what the other one says of each clip. */

import * as C from './controls.js';
import { PITCH_MIN, PITCH_MAX, pitchOf, stLabel, normalizePitch } from '../sound/pitch.js';

export function pitchRows(host, pitches, write) {
  const ps = (pitches && pitches.length ? pitches : [null]).map((v) => pitchOf({ pitch: v }));
  const first = ps[0];
  const mixedSt = ps.some((p) => p.st !== first.st);
  host.appendChild(C.row('Pitch', C.slider({
    min: PITCH_MIN, max: PITCH_MAX, step: 1, value: first.st, fmt: stLabel, mixed: mixedSt,
    onChange: (v) => write((was) => normalizePitch({ st: v, shift: pitchOf({ pitch: was }).shift }), { st: v }),
  })));
  const keep = C.toggle(!first.shift, (on) => write((was) => normalizePitch({ st: pitchOf({ pitch: was }).st, shift: !on }), { shift: !on }));
  const still = ps.every((p) => p.st === 0);
  if (still) { keep.disabled = true; keep.title = 'Nothing to keep at 0 st'; }
  else keep.title = 'On: the same voice, higher or lower. Off: the timbre moves with the pitch, as a tape sped up or slowed down';
  host.appendChild(C.row('Keep timbre', keep));
}
