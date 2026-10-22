'use strict';

// ════════════════════════════════════════════════════════════════════════════
// THE AUDIO WRITER'S RULES - the SIMPLE mode of the "generate audio" chat (phase V34.A; the owner 2026-10-22, (м1),
// (н3): "в режиме talking head нам нужен простой генератор музыки для фона без слов ... можно из чипсов составлять что
// нужно, писатель переписывает в промпт для suno и генерируется музыка"). ONE press: the chips and the person's words go
// to the writer (the agents' ladder, lib/agents.js), and its answer goes to the engine as it is - no stop for a look.
//
// What it makes is a BED: instrumental music under a person speaking in a short vertical video, played at a fifth to a
// half of full volume. Every rule below comes from the research - docs/local-app/audio-almanac.md, sections "Фон под
// речь", "Ручки V6" and "Правила писателя", where each has its sources:
//   - the style is 4-7 concrete descriptors, the genre first, then tempo, two or three named instruments, the mood, the
//     production - a role word ("background music") helps only beside them; mood words alone come back bland;
//   - Suno's style field takes POSITIVE words only: a "no drums" there still says "drums". What must not happen goes into
//     `negative_tags` (Exclude), and the bed's own excludes are always there - voices of every kind, drops, build-ups;
//   - nothing that builds, leads or sings: epic, anthem, climax, drop, hook, solo, ballad, choir... stay out of the style;
//   - instruments in the low and high registers, not the voice's middle (1-4 kHz); a man's voice is masked by acoustic
//     guitar, tenor sax and the piano's middle, a woman's by flute, solo violin and alto sax;
//   - `variety: 0` - at kie's default 1 Suno V6 REWRITES the style before making it (Suno's v6 FAQ), and a rewrite can
//     bring back the builds and leads the writer left out; Style Influence high, Weirdness low (the safe recipe);
//   - ElevenLabs Music is told in sentences, the use first, and DOES honour "no melody", "no drums" in its prompt;
//     `force_instrumental` guarantees no voice; never "with voiceover" as an instruction - it can speak one itself.
//
// Two engines, one input:
//   Suno V6 through kie.ai - custom mode, instrumental: title, style, negative_tags, the three knobs, duration;
//   ElevenLabs Music by description - prompt, music_length_ms, force_instrumental (model_id is the caller's: music_v2_5;
//   the API's default is still music_v1).
// The vocabulary - the chips and the highlights presets - is the almanac's (public/js/audio/almanac-data.js): the page
// draws the same chips the writer reads.
//
//   input  { engine: 'suno' | 'eleven', chips: { genre: [id], mood: [id], sound: [id] }, words, seconds, kind, bpm, voice }
//          words - the person's own, any language; seconds - how long the video is (0 - unknown); kind - the project's
//          kind ('talking-head', 'blank', 'highlights', 'draft'); bpm - a tempo the person set, else the chips' own;
//          voice - 'male' | 'female' | '' - who speaks over it, when the project knows.
//   out    { engine: 'suno', by, input: { custom_mode, instrumental, title, style, negative_tags, style_weight,
//            weirdness_constraint, variety, duration } }
//          { engine: 'eleven', by, title, input: { prompt, music_length_ms, force_instrumental } }
//          by - 'writer' (finish), 'chips' (compose), 'preset' (fromPreset). The caller adds the model (V6, music_v2_5) and
//          sends. `duration` is left out when the length is unknown (the model chooses).
//
//   systemFor(engine)        the writer's system prompt, the JSON envelope included
//   messageFor(input)        the user message
//   finish(answer, input)    the writer's JSON (or its text) -> out, clamped, with the bed's guards; a broken answer -> compose
//   compose(input)           out with NO writer - the ladder down, or the fake aggregator: the chips' phrases in order
//   fromPreset(id, input)    a highlights preset (the popup's second list, the owner's (п1)) -> out; null for an unknown id;
//                            input.n - the request's number in the run, which picks the preset's `vary` in turn
// ════════════════════════════════════════════════════════════════════════════

const A = require('../public/js/audio/almanac-data.js');

// The limits are kie's and ElevenLabs' (docs.kie.ai/suno-api/generate-music, elevenlabs.io/docs/api-reference/music/compose),
// read 2026-10-22. ElevenLabs publishes no maximum for the music prompt; 4100 is its video-to-music description's.
const LIMIT = {
  title: 80, style: 1000, negative: 1000,
  sunoMin: 10, sunoMax: 360,            // `duration`, seconds - custom mode, V6 family only
  elevenMin: 3, elevenMax: 600,         // `music_length_ms` / 1000
  elevenPrompt: 4100,
};

// The safe recipe for a bed (research "Ручки V6"): the style held firmly, little strangeness, no rewriting.
const KNOBS = { style_weight: 0.75, weirdness_constraint: 0.3, variety: 0 };

// Said in every bed's style, last - positive words that keep it under a voice.
const BED_TAIL = 'instrumental, background music, sparse arrangement, steady energy throughout, low dynamic range';
// Excluded in every bed: voices of every kind, and what jumps out from under one.
const BED_EXCLUDE = ['vocals', 'singing', 'vocal chops', 'vocal samples', 'choir', 'humming', 'rap', 'spoken word',
  'drop', 'build-up', 'riser', 'guitar solo'];

// Seconds of a bed for a video of `s` seconds: a few more, so the music does not end before the last word (the length
// is a target, not a timer - the app trims and fades). 0 - unknown: the model chooses (null - not sent).
function sunoSeconds(s) {
  s = +s || 0;
  if (s <= 0) return null;
  return Math.max(LIMIT.sunoMin, Math.min(LIMIT.sunoMax, Math.ceil(s) + 5));
}
function elevenMs(s) {
  s = +s || 0;
  const sec = s > 0 ? Math.ceil(s) + 3 : 30;
  return Math.max(LIMIT.elevenMin, Math.min(LIMIT.elevenMax, sec)) * 1000;
}

// ── The chips ───────────────────────────────────────────────────────────────
const GROUPS = ['genre', 'mood', 'sound'];
const _chip = (group, id) => (A.CHIPS[group] || []).find(c => c.id === id || c.label === id) || null;
function chipsOf(chips) {
  const c = chips || {};
  const out = {};
  for (const g of GROUPS) out[g] = (Array.isArray(c[g]) ? c[g] : []).map(id => _chip(g, id)).filter(Boolean);
  return out;
}

// The tempo: the person's, else where the genre's and the mood's ranges meet, else the middle of whichever is there;
// rounded to 5. 0 - none.
function bpmOf(input, ch) {
  const own = Math.round(+(input && input.bpm) || 0);
  if (own >= 40 && own <= 220) return own;
  const mid = (r) => Math.round((r[0] + r[1]) / 2 / 5) * 5;
  const g = ch.genre.find(c => c.bpm), m = ch.mood.find(c => c.bpm);
  if (g && m) {
    const lo = Math.max(g.bpm[0], m.bpm[0]), hi = Math.min(g.bpm[1], m.bpm[1]);
    return lo <= hi ? mid([lo, hi]) : mid(g.bpm);  // they disagree: the genre's
  }
  const one = g || m;
  return one ? mid(one.bpm) : 0;
}

// ── Cleaning ────────────────────────────────────────────────────────────────
const _one = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
// A list of tags, each once (case aside), in its first place.
function _tags(list) {
  const seen = new Set(), out = [];
  for (const raw of list) {
    for (const t of String(raw || '').split(',')) {
      const w = _one(t).replace(/^[-–—•.\s]+|[.\s]+$/g, '');
      const k = w.toLowerCase();
      if (!w || seen.has(k)) continue;
      seen.add(k);
      out.push(w);
    }
  }
  return out;
}
// Cut at a comma, never in the middle of a tag.
function _fit(tags, max) {
  let s = '';
  for (const t of tags) {
    const next = s ? s + ', ' + t : t;
    if (next.length > max) break;
    s = next;
  }
  return s;
}
// Artist and song names fail both engines (Suno refuses the song, ElevenLabs answers `bad_prompt`): "in the style of X",
// "inspired by X", "sounds like X", "similar to X" are dropped with their name. The writer is told the same; this is the
// net under it.
function _noNames(s) {
  return String(s || '').replace(/\b(in the style of|inspired by|sounds like|similar to|reminiscent of|à la|a la)\s+[^,.;]+/gi, '');
}
// "no drums" in Suno's style still says "drums": such a tag moves to the excludes as "drums".
function _splitNegatives(tags) {
  const keep = [], neg = [];
  for (const t of tags) {
    const m = /^(?:no|without|zero|avoid)\s+(.+)$/i.exec(t);
    if (m) neg.push(m[1]); else keep.push(t);
  }
  return { keep, neg };
}
function _title(t, fallback) {
  const s = _one(t).replace(/^["'«“]+|["'»”]+$/g, '').slice(0, LIMIT.title).trim();
  return s || fallback || 'Background';
}

// ── The writer ──────────────────────────────────────────────────────────────
const COMMON = [
  'You are a music producer who writes prompts for AI music models. You write the prompt for ONE background track: instrumental music that plays quietly UNDER a person speaking in a short vertical video (a talking head, a product review, a highlight from a podcast). The voice is what people listen to; the music only sets the mood.',
  'You get the person\'s CHIPS (genre, mood, sound - each is their choice) and their own WORDS, in any language, a word or a paragraph. Their words come first; the chips fill what the words leave open; never go against either. With no words, build the track from the chips; with no chips, from the words; with neither, a calm modern lo-fi bed.',
  'Keep their facts - a genre, an instrument, a tempo, a mood, the kind of video. Decide what they left open as a producer would, CONCRETELY: the sub-genre, two or three named instruments and how they play, the tempo, the production. Mood words alone come back bland; named instruments make the sound.',
  'WHAT MAKES A BED: no voice of any kind; no lead melody, hook or solo competing with the speaker - a sparse arrangement, texture over melody, a simple repeating motif at most; steady energy from the first bar to the last - no intro that takes its time, no build-up, drop, climax or sudden stop; even, soft dynamics; instruments in the low and high registers (sub or rounded bass, soft pads, airy textures, sparse high plucks or bells, felt piano in a low register) rather than busy mids, where a voice lives. If their words ask for something loud or busy (metal, a festival drop, a guitar solo), keep the genre but make a restrained instrumental version that sits under a voice.',
  'NEVER name an artist, a band, a song, a film or a label - describe the sound instead (its genre, era, instruments, production). Both models refuse names.',
  'Everything you write is in English.',
].join('\n');

const SUNO = [
  'MODEL: Suno V6, custom mode, instrumental. You write three fields.',
  'STYLE: 5-8 comma-separated descriptors, the most important first (Suno weighs the start most): the genre and sub-genre -> the tempo as a feel and a number ("relaxed, around 80 BPM") -> two or three named instruments with their part ("dusty Rhodes chords", "rounded sub bass", "soft brushed percussion") -> the mood (one direction, never two that fight, like "aggressive" and "gentle") -> the production ("warm lo-fi mix", "clean modern production"). 120-320 characters.',
  'Only POSITIVE words in the style: never "no ...", "without ..." - a word in the style pulls its sound in even with "no" before it; what must not be there goes to NEGATIVE_TAGS. Leave out words that invite a song or a build: epic, anthem, trailer, climax, rising, explosive, festival, hook, catchy, lead, solo, soaring, song, ballad, gospel, choir, chant, rap, vocal. For a cinematic colour write "cinematic underscore" and "steady from the first bar". Do not write "instrumental", "background music" or the other bed words - they are added after yours.',
  'NEGATIVE_TAGS: 2-6 bare comma-separated tags for what THIS track must not have, beyond voices, drops and build-ups (those are excluded anyway): the instruments or styles that would clash with their choice or crowd the voice (e.g. "crescendo, big drums" for a calm piano bed; "trailer hits, cymbal crash" for a tense one). Never a tag of something you want.',
  'TITLE: 2-5 words in English, a name for the track, no quotes, no names of people.',
].join('\n');

const ELEVEN = [
  'MODEL: ElevenLabs Music, by description, instrumental. You write a prompt and a title.',
  'PROMPT: 2-4 plain sentences in English, 250-700 characters. First what it is for: "Instrumental background bed that sits under a separate spoken narration in a short vertical video". Then decide everything the model would otherwise fill with the most average choice: the genre and the mood; the instruments and how they play; the tempo as a number ("80 BPM") and a key ("in D minor"); the production. Then the shape: it starts immediately with the full groove, keeps steady energy to the end and ends softly. Say what must not be there - this model honours it: "no lead melody", "no vocals", "no build-up or drop", "no drums" when it should be beatless. Never write "with voiceover" or a line to be spoken: the model can speak one itself.',
  'TITLE: 2-5 words in English, a name for the track, no quotes, no names of people.',
].join('\n');

const ENVELOPE_SUNO = 'Answer as ONE json object and nothing else: {"title": "<title>", "style": "<style>", "negative_tags": "<tags>"}. Never ask: where the words leave something open, decide it. The track is made from your answer at once.';
const ENVELOPE_ELEVEN = 'Answer as ONE json object and nothing else: {"title": "<title>", "prompt": "<prompt>"}. Never ask: where the words leave something open, decide it. The track is made from your answer at once.';

function systemFor(engine) {
  return engine === 'eleven'
    ? [COMMON, ELEVEN, ENVELOPE_ELEVEN].join('\n\n')
    : [COMMON, SUNO, ENVELOPE_SUNO].join('\n\n');
}

const KIND_SAYS = {
  'talking-head': 'a talking head: one person speaking to the camera',
  highlights: 'a highlight cut from a podcast or an interview',
  blank: 'a short vertical video with a voice over it',
  draft: 'a short vertical video with a voice over it',
};
// Who speaks decides which instruments mask the voice (research, "Фон под речь": ProSoundWeb via Audio Network).
const VOICE_SAYS = {
  male: 'The speaker is a man: keep acoustic guitar, tenor sax and the middle of the piano out or low and sparse.',
  female: 'The speaker is a woman: keep flute, solo violin, alto sax and high lead lines out or soft and sparse.',
};

function messageFor(input) {
  const i = input || {};
  const ch = chipsOf(i.chips);
  const line = (label, list) => label + ': ' + (list.length ? list.map(c => c.label + ' (' + c.style + ')').join('; ') : 'none');
  const bpm = bpmOf(i, ch);
  const s = +i.seconds || 0;
  return [
    'The video: ' + (KIND_SAYS[i.kind] || KIND_SAYS.blank) + (s > 0 ? ', ' + Math.round(s) + ' seconds long.' : '.'),
    VOICE_SAYS[i.voice] || '',
    line('Genre chips', ch.genre),
    line('Mood chips', ch.mood),
    line('Sound chips', ch.sound),
    bpm ? 'Tempo: ' + bpm + ' BPM' + (+i.bpm ? ' (set by the person - keep it).' : ' (from the chips - change it if their words ask for another pace).') : 'Tempo: not set - choose one that fits (calm talk 65-85, conversational 90-110, energetic 115-128).',
    'Their words: ' + (_one(i.words) || '(none)'),
  ].filter(Boolean).join('\n');
}

// The writer's answer -> the request. `answer`: the parsed JSON, or its text.
function finish(answer, input) {
  const i = input || {};
  let j = answer;
  if (typeof j === 'string') {
    try { j = JSON.parse(j.slice(j.indexOf('{'), j.lastIndexOf('}') + 1)); } catch { j = null; }
  }
  if (!j || typeof j !== 'object') return compose(i);
  if (i.engine === 'eleven') {
    const said = _one(_noNames(j.prompt));
    if (!said) return compose(i);
    const tail = /instrumental/i.test(said) ? '' : ' Instrumental only.';
    return {
      engine: 'eleven', by: 'writer', title: _title(j.title, _titleFromChips(i)),
      input: { prompt: (said + tail).slice(0, LIMIT.elevenPrompt), music_length_ms: elevenMs(i.seconds), force_instrumental: true },
    };
  }
  const { keep, neg } = _splitNegatives(_tags([_noNames(j.style)]));
  const own = keep.filter(t => !_isBedWord(t));
  if (!own.length) return compose(i);
  return _suno(own, _tags([j.negative_tags || j.negativeTags || '', neg.join(', ')]), _title(j.title, _titleFromChips(i)), i, 'writer');
}

// Words the bed adds itself: the writer's copies are dropped, so the tail says them once, last.
const _BED_WORDS = new Set(_tags([BED_TAIL]).map(t => t.toLowerCase())
  .concat(['instrumental only', 'background', 'background bed', 'steady energy', 'low dynamics']));
const _isBedWord = (t) => _BED_WORDS.has(String(t).toLowerCase());

function _suno(styleTags, negTags, title, i, by) {
  const tail = _tags([BED_TAIL]);
  // The style first, the bed's words after - cut at a tag so the tail always fits.
  const room = LIMIT.style - tail.join(', ').length - 2;
  const style = [_fit(styleTags, room), tail.join(', ')].filter(Boolean).join(', ');
  // What the style WANTS is never excluded too: Exclude against the style pulls both ways (research, "Запрещённые стили").
  // Whole words: "trap" in the style keeps "rap" excluded.
  const want = ' ' + styleTags.join(' ').toLowerCase().replace(/[^a-z0-9#-]+/g, ' ') + ' ';
  const wanted = (t) => want.includes(' ' + t.toLowerCase().replace(/[^a-z0-9#-]+/g, ' ').trim() + ' ');
  const neg = _tags([BED_EXCLUDE.join(', '), negTags.join(', ')]).filter(t => !wanted(t));
  const out = {
    custom_mode: true, instrumental: true,
    title, style, negative_tags: _fit(neg, LIMIT.negative),
    style_weight: KNOBS.style_weight, weirdness_constraint: KNOBS.weirdness_constraint, variety: KNOBS.variety,
  };
  const d = sunoSeconds(i.seconds);
  if (d) out.duration = d;
  return { engine: 'suno', by, input: out };
}

function _titleFromChips(i) {
  const ch = chipsOf(i && i.chips);
  const w = [...ch.mood.slice(0, 1), ...ch.genre.slice(0, 1)].map(c => c.label);
  return (w.join(' ') || 'Calm Lo-fi') + ' Bed';
}

// ── No writer ───────────────────────────────────────────────────────────────
// The chips' own phrases, in the writer's order. The person's words go in only when they are already plain English
// (the writer is what translates them): another alphabet would reach the model as it is.
function compose(input) {
  const i = input || {};
  const picked = chipsOf(i.chips);
  const any = GROUPS.some(g => picked[g].length);
  const chips = any ? i.chips : A.CHIPS_DEFAULT;
  const ch = any ? picked : chipsOf(A.CHIPS_DEFAULT);
  const bpm = bpmOf(i, ch);
  const words = /^[\x20-\x7E]*$/.test(_one(i.words)) ? _one(_noNames(i.words)) : '';
  const { keep, neg } = _splitNegatives(_tags([
    ...ch.genre.map(c => c.style), bpm ? 'around ' + bpm + ' BPM' : '',
    ...ch.sound.map(c => c.style), ...ch.mood.map(c => c.style), words,
  ]));
  const title = _titleFromChips({ chips });
  const avoid = [...ch.genre, ...ch.mood, ...ch.sound].flatMap(c => c.avoid || []);
  if (i.engine === 'eleven') {
    const no = _tags([...avoid, ...neg]).slice(0, 6);
    return {
      engine: 'eleven', by: 'chips', title,
      input: {
        prompt: ('Instrumental background bed that sits under a separate spoken narration in a short vertical video: '
          + keep.join(', ') + '. It starts immediately with the full groove, keeps steady energy to the end and ends softly; '
          + 'sparse, with no lead melody, no vocals, no build-up or drop' + (no.length ? ', no ' + no.join(', no ') : '') + '.').slice(0, LIMIT.elevenPrompt),
        music_length_ms: elevenMs(i.seconds), force_instrumental: true,
      },
    };
  }
  return _suno(keep, _tags([...avoid, ...neg]), title, i, 'chips');
}

// ── The highlights presets ─────────────────────────────────────────────────
// `input.n` - which request of the run this is (0, 1, 2...): it takes the preset's `vary` descriptor in turn, so the
// fragments of one video get different tracks of one mood - one lead colour swapped, the rest held (research, "Заготовки
// highlights": keep the core, rotate a slot). Each request already brings two new tracks; this widens the spread
// without Variety, which would rewrite the style.
function fromPreset(id, input) {
  const i = input || {};
  const p = (A.HIGHLIGHT_PRESETS || []).find(x => x.id === id);
  if (!p) return null;
  const vary = Array.isArray(p.vary) && p.vary.length ? p.vary[Math.abs(Math.floor(+i.n || 0)) % p.vary.length] : '';
  if (i.engine === 'eleven') {
    const touch = vary ? ' A touch of ' + vary + '.' : '';
    return {
      engine: 'eleven', by: 'preset', title: p.title,
      input: { prompt: (p.eleven + touch).slice(0, LIMIT.elevenPrompt), music_length_ms: elevenMs(i.seconds), force_instrumental: true },
    };
  }
  return _suno(_tags([p.style, vary]).filter(t => !_isBedWord(t)), _tags([p.negative]), p.title, i, 'preset');
}

module.exports = {
  LIMIT, KNOBS, BED_TAIL, BED_EXCLUDE,
  systemFor, messageFor, finish, compose, fromPreset,
  chipsOf, bpmOf, sunoSeconds, elevenMs,
};
