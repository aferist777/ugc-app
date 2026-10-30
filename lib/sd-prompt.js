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
//                                it is and what to take from it (the owner's answer (э)); (phase V26.6, the owner's (пр4))
//                                @Image3 (and @Image4) - the product the frame was drawn with, by its own picture: what
//                                it is and that it stays as it is
//   2. the speech (ours)         by the sound (lib/th-video.js SOUNDS), as probe P7 settled it (the owner 2026-10-15:
//                                "Для read берём а - без подписей тона. Вариант в (sample, 15 с демо) годится"):
//                                `read` - the lips to @Audio1, the words of the line as they are, the tone being in
//                                the read; `sample` - @Audio1 only the timbre of the voice, said in words, and the
//                                line as CAPTIONED LINES, "Her line (tone): {words}", the tone from its [tags]
//                                (research (я2): Seedance knows no ElevenLabs tags, its way of a tone is the caption)
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

/** What a line's prompt was written FOR - another frame, mood, way of moving, sound, place, words, read or voice makes it stale.
 *  (phase V26.6) And the products that go with its frame (`props`, their addresses) - only when there are any, so a prompt
 *  of a frame with none keeps the fingerprint it had. */
function sigOf(o) {
  const base = [o.frameId || '', o.mood || '', o.gestures || '', o.sound || '', o.place || '', o.words || '', o.take || '', o.voice || ''];
  return _hash(o.props ? base.concat([o.props]) : base);
}

const _q = (s) => '"' + String(s || '').replace(/"/g, '”') + '"';

// THE PARTS THAT ARE OURS, with neutral references ({{image:N}}, {{audio:1}}) - rendered at the end.
function pictures(covered, products) {
  return '{{image:1}} is the instant the clip begins: the same person, the same clothes, the same place and the same framing -'
    + ' the person starts speaking from this very picture. {{image:2}} is a character sheet of the same person from several'
    + ' sides: take the face, the hair, the body and the clothes from it; never show the sheet itself, its panels or its'
    + ' white backdrop.' + (covered ? ' The face is covered exactly as on {{image:2}} - keep it covered.' : '')
    + _products(products);
}
// (phase V26.6, the owner's (пр4): "в seedance давай отправлять изображение продукта, чтобы лучше понимал с пояснением в
// промпте") The product in the person's hand in {{image:1}}, by its own picture - what it is, and that it stays as it is.
function _products(products) {
  const list = (Array.isArray(products) ? products : []).filter(p => p && p.name);
  return list.map((p, i) => ' {{image:' + (3 + i) + '}} is the product the person holds in {{image:1}}: ' + _q(p.name)
    + (p.what ? ' - ' + String(p.what).replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '') : '') + '. It stays exactly as on {{image:' + (3 + i) + '}} - its'
    + ' shape, its colours and every word of its label - in the same hand, its label to the camera; it never changes, never'
    + ' disappears, never doubles; only the product is taken from {{image:' + (3 + i) + '}}, never its background.').join('');
}
// WHO SPEAKS, for the words around the line: a woman, a man - or a person, when nothing says.
function who(gender) {
  const g = String(gender || '').toLowerCase();
  if (g === 'female' || g === 'woman') return { noun: 'woman', Pro: 'She', says: 'She says', pos: 'her', Pos: 'Her' };
  if (g === 'male' || g === 'man') return { noun: 'man', Pro: 'He', says: 'He says', pos: 'his', Pos: 'His' };
  return { noun: 'person', Pro: 'They', says: 'They say', pos: 'their', Pos: 'Their' };
}

// THE VOICE IN WORDS, from its labels on the Voices shelf - the research's advice for a sample: "a young American woman's
// voice, modulated". '' when nothing is known.
function voiceWords(labels, gender) {
  const l = labels || {};
  const w = who(l.gender || gender);
  const age = String(l.age || '').replace(/_/g, '-');
  const accent = String(l.accent || '').replace(/\b\w/g, c => c.toUpperCase());
  const kind = w.noun === 'person' ? '' : w.noun + '\'s';
  const head = [age, accent, kind].filter(Boolean).join(' ');
  if (!head) return '';
  return (/^[aeiou]/i.test(head) ? 'an ' : 'a ') + head + ' voice' + (l.descriptive ? ', ' + String(l.descriptive) : '');
}

// THE TONE OF A [tag], as a caption says it (Seedance reads "Her line (whispering): {...}" - it knows no ElevenLabs tag).
// A word that is already a tone stays as it is; a sound is said as the way the line goes; a PAUSE gives no tone - it
// only starts the next captioned line, which is the pause (probe P7: 0.5 s between two captioned lines).
const PAUSES = new Set(['pause', 'pauses', 'brief pause', 'long pause', 'after a moment', 'after a long pause', 'awkward silence', 'stunned silence']);
const TONE_OF = {
  whispers: 'whispering', laughs: 'laughing', 'laughs softly': 'laughing softly', 'laughs loudly': 'laughing loudly',
  chuckles: 'chuckling', giggles: 'giggling', scoffs: 'scoffing', groans: 'groaning', mutters: 'muttering',
  sigh: 'with a sigh', sighs: 'with a sigh', gasp: 'with a gasp', gasps: 'with a gasp', 'gasps in disbelief': 'gasping in disbelief',
  'deep breath': 'after a deep breath', 'sharp inhale': 'after a sharp inhale', 'exhale slowly': 'exhaling slowly', exhales: 'exhaling',
  'clears throat': 'clearing the throat first', swallows: 'with a swallow', gulps: 'with a gulp', snorts: 'with a snort', yawns: 'with a yawn',
  'nervous laugh': 'with a nervous laugh', 'whispers in shock': 'whispering in shock', 'whispers revelation': 'whispering, revealing',
  'whispers intensely': 'whispering intensely', stammers: 'stammering', hesitates: 'hesitating', 'hesitates nervously': 'hesitating nervously',
  'trails off': 'trailing off', 'slows down': 'slowing down', 'picks up pace': 'picking up pace', 'cuts sentence short': 'cutting off',
  'voice cracks': 'the voice cracking', 'voice rising': 'the voice rising', 'voice lowering': 'the voice lowering',
  'voice softens': 'the voice softening', 'voice trembling': 'the voice trembling', 'tone darkens': 'the tone darkening',
  emphasized: 'with emphasis', 'stress on next word': 'stressing the first word', 'strong emphasis': 'with strong emphasis',
  'soft emphasis': 'with soft emphasis', 'repeats for emphasis': 'with emphasis', 'breath catches': 'the breath catching',
};
const _tone = (tag) => TONE_OF[tag] || tag;

/**
 * A line as CAPTIONED LINES: its tagged words cut at the tags, each piece with the tone of the tags before it - a piece
 * with none takes the tone before it, the first one the mood's (`fallback`). [{ tone, words }]
 */
function captioned(tagged, plain, fallback) {
  const text = String(tagged || plain || '').replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
  const out = [];
  let tones = [];
  let last = String(fallback || '').trim();
  let cut = true;
  const re = /\[([^\]]+)\]|([^[]+)/g;
  let x;
  while ((x = re.exec(text))) {
    if (x[1] != null) {
      const tag = x[1].trim().toLowerCase();
      if (PAUSES.has(tag)) { cut = true; continue; }
      tones.push(_tone(tag));
      cut = true;
      continue;
    }
    const words = x[2].trim();
    if (!words) continue;
    if (tones.length) last = tones.join(', ');
    if (cut || !out.length) out.push({ tone: last, words });
    else out[out.length - 1].words += ' ' + words;
    tones = [];
    cut = false;
  }
  // [tags] after the last words - a laugh at the end - go with the last line.
  if (tones.length && out.length) out[out.length - 1].tone = [out[out.length - 1].tone, ...tones].filter(Boolean).join(', ');
  return out.length ? out : [{ tone: last, words: String(plain || '').trim() }];
}

// Every script is English (phase V29, the owner 2026-10-14) - "in Russian" and a guess at the language went.
function speech(o) {
  const w = who(o.gender);
  const row = (o.rows || [])[0] || { words: '', tagged: '' };
  if (o.sound === 'sample') {
    const lines = captioned(row.tagged, row.words, o.moodTone)
      .map(c => w.Pos + ' line' + (c.tone ? ' (' + c.tone + ')' : '') + ': {' + c.words + '}').join('\n');
    return 'The ' + w.noun + ' speaks to the camera in the voice of {{audio:1}} - {{audio:1}} is only a SAMPLE of how ' + w.pos
      + ' voice sounds: take only its timbre' + (o.voiceWords ? ' - ' + o.voiceWords : '') + ' - never its words, its language'
      + ' or any sound in it. ' + w.says + ', in English, exactly these words and nothing else:\n' + lines;
  }
  return 'The ' + w.noun + ' speaks to the camera, and the speech IS the voice recording {{audio:1}}: the lips and the jaw move'
    + ' in sync with {{audio:1}} word for word, from its first second to its last. ' + w.says + ', in English:\n' + _q(row.words);
}
function soundTail(o) {
  if (o.sound === 'sample') {
    return 'Generate the speech strictly according to these lines; do not add or remove any words. Audio: only ' + who(o.gender).pos
      + ' voice. No music, no BGM. No subtitles, no captions, no on-screen text.';
  }
  return 'The only voice is the one in {{audio:1}}. No music, no BGM. No subtitles, no captions, no on-screen text.';
}

/**
 * The prompt as it goes: the five parts, rendered into the names kie gives Seedance's references.
 * `o`: { model, covered, sound, rows, body, place, gender, voiceWords, moodTone }.
 */
function assemble(o) {
  const products = (Array.isArray(o.products) ? o.products : []).filter(p => p && p.name);
  const text = [pictures(o.covered, products), speech(o), String(o.body || '').trim(), String(o.place || '').trim(), soundTail(o)]
    .filter(Boolean).join('\n\n');
  const pair = VM.pair(o.model, 'kie') || VM.pair('sd2', 'kie');
  // (phase V26.6) The products' pictures come after the sheet: the clip's request sends them in this order (routes/scen3.js
  // _submitSdClip).
  const req = { media: [{ kind: 'image' }, { kind: 'image' }].concat(products.map(() => ({ kind: 'image' })), [{ kind: 'audio' }]), params: {} };
  return VM.render(pair, text, req);
}

/** The way the body moves for this project: the gestures chosen, else the mood's. */
function gesturesOf(video) {
  const g = MP.moodById(String((video || {}).gestures || '')) || MP.moodById(String((video || {}).mood || ''));
  return g ? { id: g.id, label: g.label, head: g.motion.head, hands: g.motion.hands, body: g.motion.body } : null;
}

module.exports = { rows, clipSecs, wordsSig, sigOf, assemble, gesturesOf, captioned, voiceWords, who };
