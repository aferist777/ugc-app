'use strict';

// ════════════════════════════════════════════════════════════════════════════
// THE PROMPT OF A SEEDANCE TALKING-HEAD LINE (phase V26.8, part 4, the owner 2026-10-13; docs/local-app/PLAN.md,
// "Фаза V26", block 8).
//
// One request to the writer PER LINE - a line is a fragment of its own, never merged (the sixth round, the owner
// 2026-10-15: "Всегда по одной строке") - never one for the whole script. The prompt is ONE text in five parts, and
// three of them are OURS, word for word, so that what cannot be left to a writer is never left to one (as Kling's
// articulation and place sentences, phase X6 / Y3):
//
//   1. the pictures (ours)       @Image1 - the instant the clip begins; @Image2 - the character's 4K sheet, said what
//                                it is and what to take from it (the owner's answer (э))
//   2. the speech (ours)         by the sound (lib/th-video.js SOUNDS): the lips to @Audio1, or @Audio1 a sample of the
//                                voice - then the words of the line, in English (phase V29)
//   3. the performance and       the writer's: the pose of @Image1 at the start, then beat by beat - the face by the
//      the camera                mood, the head / the hands / the body by the gestures chosen, the gaze - and one
//                                continuous shot with a light movement (the owner's answer (е))
//   4. the place (ours)          how it moves, as it stands on the place
//   5. the sound (ours)
//
// Rendered into kie's names (@Image1, @Image2, @Audio1): what the line shows is what goes to Seedance.
// ════════════════════════════════════════════════════════════════════════════

const crypto = require('crypto');
const VM = require('./video-models');
const MP = require('./motion-presets');

const _hash = (v) => crypto.createHash('sha1').update(JSON.stringify(v)).digest('hex').slice(0, 10);
const _flat = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/** The line as the rows the writer and the speech part read: [{ words, tagged }] - no seconds (the owner's answer (я9)). */
function rows(line) {
  const l = line || {};
  return [{ words: _flat(l.text), tagged: _flat(l.tagged) }];
}

/** How long the clip of a line is asked for: its read, rounded up to the whole second Seedance makes - 4 at least. */
const clipSecs = (dur) => Math.max(4, Math.ceil((+dur || 0) - 0.001));

/** The fingerprint of what a line says - with its [tags], which are how it is said. */
const wordsSig = (line) => _hash([_flat(line && (line.tagged || line.text))]);

/** What a line's prompt was written FOR - another frame, mood, way of moving, sound, place, words, read or voice makes it stale. */
function sigOf(o) {
  return _hash([o.frameId || '', o.mood || '', o.gestures || '', o.sound || '', o.place || '', o.words || '', o.take || '', o.voice || '']);
}

const _q = (s) => '"' + String(s || '').replace(/"/g, '”') + '"';

// THE PARTS THAT ARE OURS, with neutral references ({{image:N}}, {{audio:1}}) - rendered at the end.
function pictures(covered) {
  return '{{image:1}} is the instant the clip begins: the same person, the same clothes, the same place and the same framing -'
    + ' the person starts speaking from this very picture. {{image:2}} is a character sheet of the same person from several'
    + ' sides: take the face, the hair, the body and the clothes from it; never show the sheet itself, its panels or its'
    + ' white backdrop.' + (covered ? ' The face is covered exactly as on {{image:2}} - keep it covered.' : '');
}
// Every script is English (phase V29, the owner 2026-10-14) - "in Russian" and a guess at the language went.
function speech(sound, rows) {
  const say = ', in English';
  const words = rows.map(r => _q(r.words)).join('\n');
  if (sound === 'sample') {
    return 'The person speaks to the camera in the voice of {{audio:1}} - {{audio:1}} is only a SAMPLE of how the voice'
      + ' sounds, not words for this clip. They say' + say + ', exactly these words and nothing else:\n' + words;
  }
  return 'The person speaks to the camera, and the speech IS the voice recording {{audio:1}}: the lips and the jaw move in'
    + ' sync with {{audio:1}} word for word, from its first second to its last. They say' + say + ':\n' + words;
}
const soundTail = () => 'The only voice is the one in {{audio:1}}; no music, no other sounds.';

/** The prompt as it goes: the five parts, rendered into the names kie gives Seedance's references. */
function assemble(o) {
  const text = [pictures(o.covered), speech(o.sound, o.rows), String(o.body || '').trim(), String(o.place || '').trim(), soundTail()]
    .filter(Boolean).join('\n\n');
  const pair = VM.pair(o.model, 'kie') || VM.pair('sd2', 'kie');
  const req = { media: [{ kind: 'image' }, { kind: 'image' }, { kind: 'audio' }], params: {} };
  return VM.render(pair, text, req);
}

/** The way the body moves for this project: the gestures chosen, else the mood's. */
function gesturesOf(video) {
  const g = MP.moodById(String((video || {}).gestures || '')) || MP.moodById(String((video || {}).mood || ''));
  return g ? { id: g.id, label: g.label, head: g.motion.head, hands: g.motion.hands, body: g.motion.body } : null;
}

module.exports = { rows, clipSecs, wordsSig, sigOf, assemble, gesturesOf };
