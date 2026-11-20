'use strict';

// ════════════════════════════════════════════════════════════════════════════
// THE AUDIO WRITER'S RULES - the SIMPLE mode of the sound window (js/sound/sound-window.js): background music with no
// words, made from chips that the writer turns into Suno's style. ONE press: the chips and the person's words go
// to the writer (the agents' ladder, lib/agents.js), and its answer goes to Suno as it is - no stop for a look.
//
// What it makes is a BED: instrumental music under a person speaking in a short vertical video, played at a fifth to a
// half of full volume. Every rule below comes from research:
//   - the style is 4-7 concrete descriptors, the genre first, then tempo, two or three named instruments, the mood, the
//     production - a role word ("background music") helps only beside them; mood words alone come back bland;
//   - Suno's style field takes POSITIVE words only: a "no drums" there still says "drums". What must not happen goes into
//     `negative_tags` (Exclude), and the bed's own excludes are always there - voices of every kind, drops, build-ups;
//   - nothing that builds, leads or sings: epic, anthem, climax, drop, hook, solo, ballad, choir... stay out of the style;
//   - instruments in the low and high registers, not the voice's middle (1-4 kHz); a man's voice is masked by acoustic
//     guitar, tenor sax and the piano's middle, a woman's by flute, solo violin and alto sax;
//   - `variety: 0` - at kie's default 1 Suno V6 REWRITES the style before making it (Suno's v6 FAQ), and a rewrite can
//     bring back the builds and leads the writer left out; Style Influence high, Weirdness low (the safe recipe).
//
// The engine: Suno V6 through kie.ai - custom mode, instrumental: title, style, negative_tags, the three knobs, duration.
// The vocabulary - the chips and the highlights presets - is the almanac's (public/js/audio/almanac-data.js): the page
// draws the same chips the writer reads.
//
//   input  { chips: { genre: [id], mood: [id], sound: [id] }, words, seconds, kind, bpm, voice }
//          words - the person's own, any language; seconds - how long the video is (0 - unknown); kind - the project's
//          kind ('talking-head', 'blank', 'highlights', 'draft'); bpm - a tempo the person set, else the chips' own;
//          voice - 'male' | 'female' | '' - who speaks over it, when the project knows.
//   out    { by, input: { custom_mode, instrumental, title, style, negative_tags, style_weight, weirdness_constraint,
//            variety, duration } }
//          by - 'writer' (finish), 'chips' (compose), 'preset' (fromPreset). The caller adds the model (V6) and sends.
//          `duration` is left out when the length is unknown (the model chooses).
//
//   systemFor()              the writer's system prompt, the JSON envelope included
//   messageFor(input)        the user message
//   finish(answer, input)    the writer's JSON (or its text) -> out, clamped, with the bed's guards; a broken answer -> compose
//   compose(input)           out with NO writer - the ladder down, or the fake aggregator: the chips' phrases in order
//   fromPreset(id, input)    a highlights mood -> out; null for an unknown id; input.n - which
//                            press of the mood this is: it takes the mood's styles[n % 4], whose name
//                            ends the title ("Calm Ground · Felt Piano"; a second round of four adds " 2");
//                            input.edit { style, negative } - that style as the person changed it for this press:
//                            it takes the place of the style's own words and excludes; the bed's
//                            tail, its excludes and its word filter stay, the title the style's
//   presetOf(id, n)          the n-th style of a mood - { name, style, negative } - or null
// ════════════════════════════════════════════════════════════════════════════

const A = require('../public/js/audio/almanac-data.js');
const I18N = require('./i18n');

// The limits are kie's (docs.kie.ai/suno-api/generate-music).
const LIMIT = {
  title: 80, style: 1000, negative: 1000,
  sunoMin: 10, sunoMax: 360,            // `duration`, seconds - custom mode, V6 family only
};

// The safe recipe for a bed: the style held firmly, little strangeness, no rewriting.
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
// Artist and song names fail (Suno refuses the song): "in the style of X",
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
  'NEVER name an artist, a band, a song, a film or a label - describe the sound instead (its genre, era, instruments, production). The model refuses names.',
];
// The TITLE is the track's name the person reads in Music: it is written in the interface's language; the rest of the
// answer goes to Suno and stays English. Built at the call - the language is known only after the start.
const _common = (lang) => COMMON.concat(lang === 'English' ? 'Everything you write is in English.'
  : 'Everything you write is in English, except the TITLE, which is in ' + lang + '.').join('\n');

const SUNO = [
  'MODEL: Suno V6, custom mode, instrumental. You write three fields.',
  'STYLE: 5-8 comma-separated descriptors, the most important first (Suno weighs the start most): the genre and sub-genre -> the tempo as a feel and a number ("relaxed, around 80 BPM") -> two or three named instruments with their part ("dusty Rhodes chords", "rounded sub bass", "soft brushed percussion") -> the mood (one direction, never two that fight, like "aggressive" and "gentle") -> the production ("warm lo-fi mix", "clean modern production"). 120-320 characters.',
  'Only POSITIVE words in the style: never "no ...", "without ..." - a word in the style pulls its sound in even with "no" before it; what must not be there goes to NEGATIVE_TAGS. Leave out words that invite a song or a build: epic, anthem, trailer, climax, rising, explosive, festival, hook, catchy, lead, solo, soaring, song, ballad, gospel, choir, chant, rap, vocal. For a cinematic colour write "cinematic underscore" and "steady from the first bar". Do not write "instrumental", "background music" or the other bed words - they are added after yours.',
  'NEGATIVE_TAGS: 2-6 bare comma-separated tags for what THIS track must not have, beyond voices, drops and build-ups (those are excluded anyway): the instruments or styles that would clash with their choice or crowd the voice (e.g. "crescendo, big drums" for a calm piano bed; "trailer hits, cymbal crash" for a tense one). Never a tag of something you want.',
];
const _sunoRules = (lang) => SUNO.concat('TITLE: 2-5 words in ' + lang + ', a name for the track, no quotes, no names of people.').join('\n');

const ENVELOPE = 'Answer as ONE json object and nothing else: {"title": "<title>", "style": "<style>", "negative_tags": "<tags>"}. Never ask: where the words leave something open, decide it. The track is made from your answer at once.';

function systemFor() {
  const lang = I18N.langName();
  return [_common(lang), _sunoRules(lang), ENVELOPE].join('\n\n');
}

const KIND_SAYS = {
  'talking-head': 'a talking head: one person speaking to the camera',
  highlights: 'a highlight cut from a podcast or an interview',
  blank: 'a short vertical video with a voice over it',
  draft: 'a short vertical video with a voice over it',
};
// Who speaks decides which instruments mask the voice (research: ProSoundWeb via Audio Network).
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
  // What the style WANTS is never excluded too: Exclude against the style pulls both ways.
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
  return { by, input: out };
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
  return _suno(keep, _tags([...avoid, ...neg]), title, i, 'chips');
}

// ── The highlights presets ─────────────────────────────────────────────────
// A mood is four styles sharply apart - genre, instruments, key, tempo - so its tracks are not alike; `input.n` - which
// press of the mood this is (0, 1, 2...) - takes styles[n % 4], so four presses bring eight tracks of four kinds. Variety
// stays 0: it would rewrite the style. A record keeps what it was sent - a retry carries its `written`, fromPreset is not
// asked again.
const _pressNo = (n) => Math.abs(Math.floor(+n || 0));
function _styleAt(p, n) {
  const l = Array.isArray(p.styles) ? p.styles.filter(s => s && String(s.style || '').trim()) : [];
  if (!l.length) return { name: '', style: String(p.style || ''), negative: String(p.negative || ''), round: 0 };
  const k = _pressNo(n);
  const s = l[k % l.length];
  return { name: String(s.name || ''), style: String(s.style), negative: String(s.negative || ''), round: Math.floor(k / l.length) };
}
function fromPreset(id, input) {
  const i = input || {};
  const p = (A.HIGHLIGHT_PRESETS || []).find(x => x.id === id);
  if (!p) return null;
  const s = _styleAt(p, i.n);
  // "Calm Ground · Felt Piano", and " 2" from the second round of four on - lib/audio-gens.js adds " · 1" / " · 2".
  const title = _title((s.name ? p.title + ' · ' + s.name : p.title) + (s.round ? ' ' + (s.round + 1) : ''), p.title);
  // The person's edit of this style - Suno's style and excludes - for this one press; the rest as the style's.
  const e = i.edit && typeof i.edit === 'object' ? i.edit : null;
  const style = e && String(e.style || '').trim() ? String(e.style) : s.style;
  const negative = e && e.negative != null ? String(e.negative) : s.negative;
  return Object.assign(_suno(_tags([style]).filter(t => !_isBedWord(t)), _tags([negative]), title, i, 'preset'), { named: true });
}

/** The n-th style of a highlights mood - { name, style, negative } - or null (an edit equal to it is no edit). */
function presetOf(id, n) {
  const p = (A.HIGHLIGHT_PRESETS || []).find(x => x.id === id);
  if (!p) return null;
  const s = _styleAt(p, n);
  return { name: s.name, style: s.style, negative: s.negative };
}

module.exports = {
  LIMIT, KNOBS, BED_TAIL, BED_EXCLUDE,
  systemFor, messageFor, finish, compose, fromPreset, presetOf,
  chipsOf, bpmOf, sunoSeconds,
};
