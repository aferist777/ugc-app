'use strict';

/* highlights-agent.js - the moments of a long video, found by the agent (phase V33.1, the owner's (х3), (х4), (х4а), (х14)).

   The words heard in the video (lib/captions-job.js hearLong) are cut into SENTENCES by the captions' own rule
   (public/js/captions/pages.js endsSentence) - a sentence that runs on for long is cut at a pause or a comma - and the agent
   reads them numbered, with their times. It answers ONE JSON: moments made of 1 to 3 PIECES, each a run of whole sentences
   by their numbers. Numbers, not times: a moment can only start and end where a sentence does.

   The agent is the agents' ladder (lib/agents.js, Admin -> AI settings - the writers' models, the owner's (х3)), asked ONCE:
   a step that got no answer stops the ladder ("paid once").

   What comes back is checked, not trusted: a piece out of range or upside down, more than three pieces, a moment that shares
   a sentence with a better one, or one outside the length asked for (a moment a little too long loses sentences from its end
   while it stays a whole thought) - dropped or mended here, and said in the count. Weak ones are not dropped: each carries its
   score, 0-100 - how complete its theme is (the owner's (х14)) - and the best come first. */

const PAGES = require('../public/js/captions/pages.js');
const TABLE = require('../public/js/highlights/kinds.js');

// (phase V69 P12, the owner's (хп74)) THE SENTENCE RULE - a stretch of speech with no full stop in it (Whisper does not always put
// them in) is cut at its best pause or comma once it is this long, and at 1.6 times that whatever it holds. Rule 1 - until P12:
// 30 s (48 s at most); rule 2 - since: 15 s (24 s at most), the words cleaned first (lib/highlights-job.js). The agent answers
// sentence NUMBERS, so an answer kept on a record is read again by the rule it was asked under (`agent.rule`), never by a newer one.
const SENT_RULES = { 1: 30, 2: 15 };
const SENT_RULE = 2;
const SENT_MAX_WORDS = 70;
const r1 = (t) => Math.round((+t || 0) * 10) / 10;
const r2 = (t) => Math.round((+t || 0) * 100) / 100;

/** [{ i (from 1), start, end, text }] - the words in sentences, cut by sentence rule `rule` (SENT_RULE when not said). */
function sentences(words, rule = SENT_RULE) {
  const SENT_MAX_S = SENT_RULES[rule] || SENT_RULES[SENT_RULE];
  const ws = (words || []).filter((w) => w && String(w.text || '').trim()).slice().sort((a, b) => a.start - b.start);
  const out = [];
  let cur = [];
  const close = () => {
    if (!cur.length) return;
    out.push({ i: out.length + 1, start: r2(cur[0].start), end: r2(cur[cur.length - 1].end), text: cur.map((w) => String(w.text).trim()).join(' ') });
    cur = [];
  };
  for (let k = 0; k < ws.length; k++) {
    const w = ws[k];
    const next = ws[k + 1] || null;
    cur.push(w);
    const gap = next ? next.start - w.end : 99;
    if (PAGES.endsSentence(w.text, next ? next.text : null, gap) || gap >= 2.0) { close(); continue; }
    // A run-on stretch of speech (Whisper does not always put the full stops in): cut at a pause or a comma once it is long.
    const len = w.end - cur[0].start;
    if ((len >= SENT_MAX_S || cur.length >= SENT_MAX_WORDS) && (gap >= 0.5 || /[,;:]$/.test(String(w.text)))) close();
    else if (len >= SENT_MAX_S * 1.6 || cur.length >= SENT_MAX_WORDS * 1.6) close();
  }
  close();
  return out;
}

const _clock = (s) => {
  s = Math.max(0, +s || 0);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = (s % 60).toFixed(1).padStart(4, '0');
  return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + x;
};

const SYSTEM = [
  'You are a video editor who cuts viral vertical shorts (TikTok, Reels, YouTube Shorts) out of long videos.',
  'You get the transcript of ONE video as numbered sentences, each with its start and end time and its length.',
  'Find the moments that would work best as shorts. Rules:',
  '1. A moment is 1 to 3 PIECES. A piece is a run of whole sentences, given by their numbers [first, last] (inclusive).',
  '2. The pieces of one moment TOGETHER last between MIN and MAX seconds (add up each piece from the start of its first sentence to the end of its last).',
  '3. A moment stands on its own: it opens with a strong hook (a bold claim, a question, a surprise, a conflict, a number) or the start of a complete thought, and its last sentence closes that thought. No dangling references to what came before ("as I said", "this one", "he") that leave a viewer lost.',
  'RULE4',
  'RULE5',
  // (phase V69 P12, (хп60), (хп64), (хп69), P8-P11) THE COUNT IS A TARGET - "return fewer rather than padding" made Sonnet 5.5 stop
  // at 2-7 of 20 where Haiku had given 20 of 20.
  '6. Return EXACTLY as many moments as asked. Search the WHOLE video, start to end - good moments are often in the middle and near the end. When the strong ones run out, add weaker ones with a lower score, last; return fewer only when no sentences are left that make a moment of this length.',
  '7. score (0-100): how COMPLETE the theme is inside the moment - opened and closed, a whole thought that needs nothing else (high), or cut off, half a thought (low).',
  '8. title: a short catchy title in English, at most 60 characters. headline: the same idea as a punchy on-screen headline for the top of the short, in the LANGUAGE THE VIDEO IS SPOKEN IN (not translated), at most 50 characters. hook: the opening line in English (translated when the video is in another language). why: one or two sentences in English on why it would work as a short.',
  'RULE9',
  'Answer with JSON only, best moment first, in exactly this shape:',
  'SHAPE',
].join('\n');
// (phase V69 P12, (хп37)) Rule 4 by the kind: a late hook heard twice (podcast, true crime - (хп62), (хп65)), or the pieces in the
// video's order (every other kind). Rule 5 goes with it.
const RULE4 = {
  twice: '4. A theme opened in one place and closed in another can be ONE moment of several pieces, in the video\'s order. THE HOOK: when the moment\'s strongest line (a punchline, a verdict, a confession, a shocking detail or number; 1-2 sentences, up to ~8 s) is not its first, it opens the moment as a FIRST piece of its own - and is heard again in its place: the pieces after it are the moment from its start, in the video\'s order, and one of them holds that line again. A moment whose strongest line is its first needs no hook.',
  order: '4. A theme opened in one place and closed in another can be ONE moment of several pieces. The pieces keep the video\'s order; a middle may be left out.',
};
const RULE5 = {
  twice: '5. Moments never share a sentence - only a moment\'s own hook piece repeats a line of that same moment.',
  order: '5. Moments never share a sentence.',
};
// (phase V69 P12, (хп63), (хп64), P9) The key lines - where the frame punches in (P12b) - for the kinds that have them.
const RULE9 = '9. keys: the moment\'s KEY LINES, where the camera punches in: 1 to 4 a minute of the moment, never two within 3 seconds - KEYS_WHAT. Each: "s" the sentence number (inside the moment) and "w" the key word in it, exactly as spoken.';
const KEYS_WHAT = {
  podcast: 'a punchline, a confession, a surprising number, a sharp opinion, a line the others laugh at',
  truecrime: 'a confession ("yes, I..."), a lie, the word of the arrest, a number, a sharp question',
  stream: 'a shout ("yes!"), swearing, a punchline, a donation\'s sum',
};
const SHAPE = '{"moments":[{"pieces":[[12,18]],"title":"...","headline":"...","hook":"...","why":"...","score":87}]}';
const SHAPE_KEYS = '{"moments":[{"pieces":[[12,18]],"title":"...","headline":"...","hook":"...","why":"...","score":87,"keys":[{"s":14,"w":"word"}]}]}';

// ── Each kind's own rules (phase V33.8, the owner 2026-10-23, (у6): "под каждый video kind должен быть собственный
// промпт-инструкция для разбора на фрагменты"; the texts shown to the owner in Russian and approved the same day). Built from
// what clipping tools, editors and retention research say makes a moment strong in each kind (the session's notes,
// v33-8-research-moments.md). Added to the shared rules above, in the same call; MIN and MAX are the user message's.
// (phase V69 P5-P11) Each kind talked over with the owner in Russian - docs/local-app/plan/ "Фаза V69": podcast П5 (K1-K11 kept,
// K12 new), true crime П6 К1-К12, documentary П7 Д1-Д12, lecture П8 Л1-Л12, stream П9 С1-С12 - and put here in English; a kind's
// late hook and key lines are public/js/highlights/kinds.js's (`hook`, `keys`), worded by RULE4, RULE5, RULE9.
const GUIDES = {
  podcast: [
    'This video is a podcast or an interview: two or more people talking.',
    'K1. The transcript has no speaker names - tell the turns apart by questions, "you" said to someone, short replies ("right", "yeah") and changes of subject.',
    'K2. Look for moments where something HAPPENS: a strong or contrarian opinion with its reason, a personal story that reaches its point, a confession, a disagreement or pushback, a direct answer to a specific question, advice with the why behind it, a funny exchange, a surprising number. A laugh, an interruption, "wait, really?" or "honestly" often mark them.',
    'K3. Skip greetings, the guest\'s introduction, "thanks for having me", ad and sponsor reads, plugs, the outro, small talk, inside jokes, callbacks to earlier in the talk, and moments whose only point is the guest\'s credentials.',
    'K4. Start on the first sentence that carries meaning - usually the guest\'s strongest line - never on the run-up, "great question" or "so, yeah".',
    'K5. Keep the host\'s question only when the answer is unclear or unfair without it; a short, sharp question is itself a good hook. Otherwise start with the answer.',
    'K6. The first sentence must hook a stranger within 1-3 seconds: a claim, a tension or a number, with its subject named - never "he", "that" or "it" pointing outside the moment.',
    'K7. End right after the payoff - the punchline, the lesson, the verdict, the answer to the question the moment opened - before the talk turns to the next subject. Never stop before the answer.',
    'K8. Keep a qualification the speaker adds right after a claim ("but only if...", "in my case"), or drop the moment. Never join pieces so they say what the speaker did not mean.',
    'K9. Mostly the guest\'s voice; the host belongs in a moment with a question, a pushback or a real reaction. In a back-and-forth keep both sides and end on the line that settles or sharpens it.',
    'K10. Length: the shortest COMPLETE argument between MIN and MAX - never pad toward MAX. Up to 30 s: one opinion, answer or punchline. Up to 60 s: a claim with its reason and example, or a short exchange. Up to 90 s: a whole story or a real debate.',
    'K11. Mix the shapes - opinions, stories, answers, exchanges - not several moments of the same kind.',
    'K12. An answer the guest starts inside the moment is finished inside it - a long one by a part of it that holds a whole thought (a claim, its reason or example, its conclusion), never cut off. A moment never ends on a question whose answer is the next sentence.',
  ],
  truecrime: [
    'This video is true crime: bodycam, dashcam or interrogation-room footage - an arrest, an interrogation, a police call - often with a host who tells the case.',
    'K1. The transcript has no speaker names - tell them apart by their words: the officer asks, commands ("step out of the car", "hands behind your back"), reads the rights and radio codes; the suspect answers, denies and makes excuses ("I swear", "I didn\'t...", "am I in trouble?"); a victim or a witness complains ("my things"); the host speaks smoothly of the case in the third person, with names and dates ("according to police", "court documents").',
    'K2. Look for: a confession; a lie and the moment it falls apart; a turn (a new fact, a second version, another victim); the arrest announced; a shocking detail; a question from the suspect that gives them away ("can I bail myself out?"); a burst of the victim\'s feelings; a dry line from the officer that sums it up; a number that changes the scale (the damage, the sentence).',
    'K3. Skip the channel\'s intro and "I am your host", ads (merch, promo codes), the outro, a teaser at the start that repeats a later scene (take the scene itself, whole, in its place), routine - keys, a bag, a phone, radio codes, a search by the book - and stretches whose words cannot be made out.',
    'K4. Start on an officer\'s question that hooks by itself ("And the toaster?") or on the first sentence of an answer that carries meaning.',
    'K5. The host is the link: one or two sentences before a scene (who, where, why the police are there) or the outcome after it. A moment of the host alone only for the outcome of the case - a charge, a sum, a sentence, more victims -, never a retelling of what the footage shows.',
    'K6. End right after the answer lands: the confession said, the lie caught, the arrest announced, the reaction ("You what?"). Never on a question whose answer is the next sentence; never mid-answer - an answer started in the moment is finished in it.',
    'K7. A lie and its unmasking are ONE moment even when minutes lie between them: its pieces in the video\'s order (the denial ... the confession).',
    'K8. Lines whose meaning is in the picture or on a card ("here is her photo", "here is the list", "as you can see") never start a moment and never stand in it alone.',
    'K9. Bodycam transcripts are noisy: two people\'s lines are sometimes run into one sentence - judge by the meaning; where the words cannot be understood, do not take them.',
    'K10. Length: the shortest COMPLETE episode between MIN and MAX - never pad toward MAX. Up to 30 s: a question and its answer with the reaction. Up to 60 s: a lie and its unmasking, or an arrest. Up to 90 s: a whole conversation.',
    'K11. Mix the shapes - confessions, lies, turns, arrests, lines - not several moments of the same kind.',
  ],
  documentary: [
    'This video is a documentary: one narrator over footage, archive and graphics - off screen or on it -, with short bits of interviews and archive sound: a documentary, an explainer, a video essay, a history or lore video. The narrator often asks and answers himself ("A fair question: why did it work?") and reads documents and other people\'s words in his own voice. You see only the words, not the pictures.',
    'K1. Look for: a striking fact with its why; a question or a mystery and its answer; a common belief and its correction; a turn; a reveal ("what if I told you it was not like that at all"); a number that changes the sense of scale; the story of one person with a clear outcome; a quote of a document or a witness that settles it.',
    'K2. A chain - "but", "so", "and that is why" - is stronger than a list. But in a list video (lore, a top 10, one character after another) one item told whole is a moment too, with a lower score.',
    'K3. Skip the intro, "in this video", "hi, I am ..."; ads and sponsors with their lead-in ("by the way, I got hooked on ..."); requests to like and subscribe; chapter transitions; recaps of what was said; the outro; the promise of the video at its start ("today we will talk about ...") unless it is a whole thought; runs of dates and names that only set the scene.',
    'K4. Lines whose meaning is in the picture ("as you can see", "here is the map", "look") never open a moment and never carry its meaning; inside a moment they may stay - the short has the picture.',
    'K5. Start on a claim, a question or a contradiction, within the first 1-3 seconds: specific, promising only what the moment delivers. If the first sentence leans on something outside the moment ("this decision", "they"), start one or two sentences earlier, where it is named.',
    'K6. End on the payoff - the answer, the reveal, the why, the consequence - and stop. Never on "but more on that later", the start of a new chapter or "but the worst was still ahead"; close every question the moment opens.',
    'K7. An interview or archive bit only when it is itself the reveal or the peak of feeling - together with the narrator\'s line that says who it is, whole, not a scrap. Where the words cannot be made out (another language, noise, music), do not take them.',
    'K8. A pause of more than 4 seconds between sentences is a change of chapter or a picture without words: a moment does not run across it (its pieces may jump it).',
    'K9. Length: the shortest COMPLETE story between MIN and MAX - never pad toward MAX. Up to 30 s: a fact with its why, or a question and its answer. Up to 60 s: a mystery with its answer, a belief and its correction. Up to 90 s: a story with a build-up and a reveal.',
    'K10. Mix the shapes - facts, mysteries, corrections, stories - not several moments of the same kind.',
  ],
  lecture: [
    'This video is a lecture or a talk: one person explains a subject - a lecture at the board, a talk on stage, a lesson or a webinar with slides. Almost everything is their voice; the room is heard rarely (a question, laughter, applause). A lecturer dictates: headings and definitions slowly, repeated, for the notes.',
    'K1. Look for one idea told to its end: a definition with its example and its takeaway; a surprising fact or experiment with its why; a story from life or from a book that explains the idea; a paradox, or a common belief and its correction; a quote unpacked; the lecturer\'s question to the room and its answer; advice one can take away; a place where the room laughs.',
    'K2. The shape: claim -> example or story -> takeaway. A long example - its core (its setup and its payoff) as pieces in the video\'s order; the middle may be left out (up to 3 pieces).',
    'K3. Skip housekeeping (who I am, awards, the cameras, "write this down", "last time", "next time", the break, the exam), dictation of headings and of lists for the notes, recaps of earlier lectures, the greeting and the farewell, the music between parts.',
    'K4. Lines whose meaning is on the board or a slide ("right here", "this diagram", "as you see on the slide") never open a moment and never carry its meaning; inside one they may stay. A formula or a diagram is a moment only when the lecturer says it in words, whole.',
    'K5. A question from the room and its answer are one moment when the question is heard and makes sense; one that cannot be made out - start with the answer if the lecturer repeated the question; the answer to the end of its thought.',
    'K6. Start on a claim, a question or a paradox a stranger understands within 1-3 seconds, with its subject named ("Levi-Strauss said..."); never on "so", "well then", "let us go on". If the first sentence leans on something said before ("this type", "the second feature"), start earlier, where it is named.',
    'K7. End on the takeaway, the payoff of the example or the room\'s laughter, and stop. Never cut an explanation off: not on "first" without "second", not on an example begun, not on a question without its answer; a long one - its core as pieces (K2), not a cut in the middle.',
    'K8. While the lecturer writes on the board they speak in scraps ("so... right here...") - such lines never carry a moment\'s meaning.',
    'K9. Length: the shortest COMPLETE idea between MIN and MAX - never pad toward MAX. Up to 30 s: a definition with one example, a quote with its meaning, an answer to a question. Up to 60 s: a claim, an example, a takeaway. Up to 90 s: a story or an experiment, whole.',
    'K10. Mix the shapes - definitions, stories, paradoxes, quotes, answers - and the lecture\'s topics from its start to its end, not several moments of the same kind.',
  ],
  stream: [
    'This video is the recording of a live stream (Twitch, YouTube, Kick) - a game with the streamer\'s camera, just chatting, reactions to videos, IRL. Almost everything is the streamer\'s unscripted voice; around it - the game\'s sound (characters\' lines, cutscenes, music), a robot voice reading donations, guests, the sound of the video being reacted to. The transcript has no names.',
    'K1. Look for a PEAK: an epic moment of the game (a win, a clutch, a boss, a rare find) with a shout of joy; a fail or a death - and rage or laughing at oneself; a scare (horror - a scream); something funny - a joke, an absurdity, the streamer\'s laughter; a donation or a chat message read aloud - and the answer; an answer to a viewer - a story, an opinion, a confession (as in a podcast); an argument with the chat or a guest; the unexpected - "what?!", "no way". Its marks: shouting and swearing, repeats ("no-no-no", "yes-yes-yes"), "chat, did you see that?", "clip it", "clip that", laughter.',
    'K2. A peak\'s shape: the lead-up (what is going on and what is at stake - "last one, one against three, low health") -> the peak itself -> the reaction (laughter, swearing, "did you see that?"). Without the lead-up the peak makes no sense; without the reaction it is not a clip. A game peak is ONE piece, nothing cut out of its middle - the game\'s picture must not jump; stories and answers - up to 3 pieces, a middle may be left out.',
    'K3. Skip the start of the stream (waiting for people, "is the sound OK?", "chat, can you hear me?"), tech, ads and sponsors, lists of thanks ("thanks for the sub ..."), a donation with no answer, a break ("brb"), the end of the stream (the raid, "bye everyone"), cutscenes and characters\' lines, the stream\'s songs and music, the sound of another video with no reaction to it.',
    'K4. Silence: a game with no words is a gap between sentences. A pause of up to ~10 s inside a peak is fine when the words before it set the stakes and the peak comes after it (the streamer goes quiet before a clutch); otherwise a moment does not run across a pause of more than 6 s.',
    'K5. A donation or a chat message read aloud (the name, the sum - "donated 500 rubles" -, the text) and the streamer\'s answer are one moment: it starts with the donation\'s text and ends on the answer.',
    'K6. Start on the lead-up a stranger understands within 1-3 seconds ("OK, last round - if we win, ...") or on a viewer\'s question; never on "so", "well", "OK chat".',
    'K7. End right after the reaction: the laughter faded, the conclusion said. Never drag on into "OK, let\'s move on".',
    'K8. The transcript is noisy: the game\'s sound, music and other voices get into the words; nonsense and one phrase repeated are not speech. A line of a game character or of another video never starts a moment unless the streamer answers it.',
    'K9. Length: the shortest COMPLETE peak between MIN and MAX - never pad toward MAX. Up to 30 s: the lead-up, the peak, the reaction. Up to 60 s: a donation with its answer, a story, a whole game episode. Up to 90 s: an argument, a long story.',
    'K10. Take from the WHOLE stream, from its first hour to its last, and mix the shapes - game peaks, fails, funny bits, donations, answers.',
  ],
  // (phase V69 P11, (хп91), (хп92)) What auto cuts a video of NONE of the kinds by - a vlog, a tutorial, a reaction, a monologue to
  // camera, a cartoon or a film, and a stream while that kind is in development: the general rules with the target, the pieces in the
  // video's order, no key lines, and the hints that auto's one call had for them (its K3, K5-K7 until P12). auto no longer cuts by
  // rules of its own: its first call only names the kind (kindMessages), its second asks the moments by that kind's rules.
  other: [
    'This video is none of the usual kinds, or a mix of them - a vlog, a tutorial, a reaction to or a commentary on another video, a monologue to camera, or something else. The transcript has no speaker names - judge by the words.',
    'K1. Everywhere: skip intros, outros, greetings, ad reads and small talk; start on the first sentence that carries meaning, with its subject named; end right after the payoff; never pad toward MAX.',
    'K2. A vlog: the beat where something goes wrong or surprises - start in the action, end on the reaction or the result; skip the logistics.',
    'K3. A tutorial: one tip whose result is said first, then at most three steps; skip steps that only make sense on screen.',
    'K4. A reaction or a commentary: the sharpest take, with just enough of what it reacts to; end on the verdict or the punchline.',
    'K5. A monologue to camera: the strongest claim, its reason, an example, the conclusion.',
    'K6. Mix the shapes - not several moments of the same kind.',
  ],
};
// What auto may say the video is (phase V69 P11, (хп91)): public/js/highlights/kinds.js FOUND - podcast, truecrime, documentary, lecture,
// stream or other. Until P12 auto said it inside its one answer, with a longer list: those of it that are no kind of their own now are
// read as other (OLD_FOUND); sermon went ((хп38)).
const FOUND_KINDS = TABLE.FOUND;
const OLD_FOUND = ['vlog', 'tutorial', 'reaction', 'monologue', 'sermon'];
/** A kind auto said, as one of FOUND_KINDS ('' - none it may say). */
const foundKind = (k) => { const f = String(k || '').trim().toLowerCase(); return FOUND_KINDS.includes(f) ? f : OLD_FOUND.includes(f) ? 'other' : ''; };

/**
 * The messages for the ladder. `len` - { min, max } seconds; `count` - how many are wanted; `kind` (V33.8) - auto, podcast or
 * documentary: its own rules go into the system message after the shared ones.
 */
function messages({ title, seconds, sents, len, count, kind, language, clock }) {
  // (phase V69 P12b, (хп76), (хп99)) A lecture's times on the CLOCK OF THE SPEECH (lib/highlights-pauses.js clockOf): its pauses are
  // shortened when it is cut, so a moment is measured as it will play.
  const C = typeof clock === 'function' ? clock : (t) => t;
  const lines = sents.map((s) => `[${s.i}] ${_clock(C(s.start))}-${_clock(C(s.end))} (${r1(C(s.end) - C(s.start))}s) ${s.text}`);
  const k = GUIDES[kind] ? kind : 'other';
  const user = [
    `Video: "${String(title || 'untitled').slice(0, 200)}", ${_clock(seconds)} long, ${sents.length} sentences.`,
    ..._spoken(language),
    ...(clock ? [CLOCK_LINE.replace('TOTAL', _clock(C(seconds)))] : []),
    `Wanted: ${count} moments, each ${len.min}-${len.max} seconds (MIN ${len.min}, MAX ${len.max}).`,
    '',
    'Sentences:',
    ...lines,
    '',
    _last(sents),
  ].join('\n');
  const system = systemOf(k, len) + '\n\nTHIS VIDEO\'S KIND - its own rules, on top of the rules above:\n' + GUIDES[k].join('\n');
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

/** (phase V69 P12) The shared rules as kind `k` has them: its rule 4 and 5 (a late hook heard twice, or the video's order), rule 9 and
 *  the answer's shape with key lines for the kinds that punch in (public/js/highlights/kinds.js `hook`, `keys`). */
function systemOf(k, len) {
  const K = TABLE.kindOf(k) || {};
  const how = K.hook === 'twice' ? 'twice' : 'order';
  const keys = !!(K.keys && KEYS_WHAT[k]);
  return SYSTEM.split('\n').map((line) => {
    if (line === 'RULE4') return RULE4[how];
    if (line === 'RULE5') return RULE5[how];
    if (line === 'RULE9') return keys ? RULE9.replace('KEYS_WHAT', KEYS_WHAT[k]) : '';
    if (line === 'SHAPE') return keys ? SHAPE_KEYS : SHAPE;
    return line;
  }).filter(Boolean).join('\n').replace('MIN and MAX', `${len.min} and ${len.max}`);
}

// (phase V69 P12, (хп79) / P8) The last sentence's number at the end of the message - the agent answered numbers past it (two of
// lecture 01's three moments); and (P11) the language the video is spoken in, so the headline is in it (a French headline on an
// English video before - the language was never said).
const _last = (sents) => `The last sentence is [${sents.length}].`;
// (phase V69 P12b) What the times are, when they are the speech's.
const CLOCK_LINE = 'Times are on the CLOCK OF THE SPEECH (TOTAL in all): every pause longer than 0.8 s is counted as 0.3 s - it is shortened to that when the moment is cut. Measure the moments by these times.';
const _spoken = (language) => {
  const L = String(language || '').replace(/[^\p{L} -]/gu, '').trim().slice(0, 40);
  return L ? [`Spoken in: ${L} - the headline is in ${L}.`] : [];
};

// (phase V69 P12, (хп78) / P8) THE JSON IN AN ANSWER: the LAST whole one that holds what is asked (`want(doc)`). Sonnet 5.5 at times
// writes a stand-in first ("title":"x", a sentence past the end), then "Wait, I must give valid output; here is the correct answer"
// and a second JSON (lecture 22: a third) - the last one is its answer. Every balanced {...} or [...] of the text is tried, strings
// and their escapes respected, fenced or not; a cut-off answer is not mended.
// The end of the balanced {...} or [...] that starts at `from` (its last character's index), or -1 when it never closes.
function _closeOf(s, from) {
  const stack = [];
  let inStr = false, esc = false;
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[') stack.push(c === '{' ? '}' : ']');
    else if (c === '}' || c === ']') {
      if (stack.pop() !== c) return -1;
      if (!stack.length) return i;
    }
  }
  return -1;
}
function _json(raw, want) {
  const s = String(raw || '');
  let starts = 0, opened = 0, parsed = 0;
  // Every opening bracket, from the last back: of those that close, parse and hold what is asked, the one that ENDS last is the
  // last such JSON - and of those ending there the outermost (the answer, not its list of moments inside it).
  let best = null;
  for (let i = s.length - 1; i >= 0 && starts < 4000; i--) {
    const c = s[i];
    if (c !== '{' && c !== '[') continue;
    starts++;
    const end = _closeOf(s, i);
    if (end < 0) { opened++; continue; }
    if (best && end < best.end) continue;
    let doc;
    try { doc = JSON.parse(s.slice(i, end + 1)); } catch (e) { continue; }
    parsed++;
    if (!want || want(doc)) { if (!best || end > best.end || i < best.i) best = { i, end, doc }; }
  }
  if (best) return best.doc;
  if (opened || (starts && !parsed)) throw new Error('the agent\'s answer is not whole JSON - it may have been cut off');
  throw new Error('the agent answered without the moments (no JSON)');
}
// What a doc must hold to be the answer: `{ <key>: [...] }`, or a bare list of such items (an item has field `field`) - never a
// piece's [12, 18], which is a list too.
const _hasList = (key, field) => (doc) => (Array.isArray(doc)
  ? doc.some((x) => x && typeof x === 'object' && !Array.isArray(x) && field in x)
  : !!(doc && Array.isArray(doc[key])));

const _str = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);

// (phase V69 P12, (хп62), (хп65)) A hook heard twice: the moment's strongest line, 1-2 sentences, ~8 s - a piece this long or shorter.
const HOOK_MAX_S = 12;

/**
 * The agent's answer as fragments, checked. `sents` from sentences(); `len` { min, max }; `count` how many were asked. `o`:
 *   kind   (phase V69 P12) the kind the moments were asked by - its late hook and its key lines (public/js/highlights/kinds.js)
 *   words  [{ text, start, end }] the words the sentences were made of - a key word's own moment
 *   rule   the sentence rule the answer was asked under: 1 (before P12) - the first piece may be a later line, heard once, as then
 *   clock  (phase V69 P12b) the video's second -> the speech's (lib/highlights-pauses.js clockOf): a lecture's moment is measured as
 *          it plays with its pauses shortened - the clock it was asked by
 * THE PIECES (phase V69 P12, (хп37)): a kind with a hook heard twice (podcast, true crime) may open a moment with a short piece
 * (HOOK_MAX_S) that lies inside another of its pieces - heard again there - or later than them; every other piece, and every piece of
 * the other kinds, in the video's order. The hook counts in the moment's length (it is heard).
 * @returns { fragments: [{ rank, title, score, hook, why, text, pieces: [{ start, end, from, to, hook? }], seconds, keys? }], dropped,
 *   asked, kind }
 */
function parse(raw, sents, len, count, o) {
  const opt = o || {};
  const doc = _json(raw, _hasList('moments', 'pieces'));
  const list = Array.isArray(doc) ? doc : (Array.isArray(doc && doc.moments) ? doc.moments : []);
  // An answer with none is an answer, not a fault: asking again would pay for the same (a refusal - no paid retry).
  if (!list.length) throw Object.assign(new Error(`The agent found no moments of ${len.min}-${len.max} s in this video.`), { refused: true });
  const K = TABLE.kindOf(opt.kind) || {};
  const twice = K.hook === 'twice';
  const legacy = +opt.rule === 1;
  const ws = (Array.isArray(opt.words) ? opt.words : []).filter((w) => w && w.text);
  const N = sents.length;
  const used = new Set();
  const out = [];
  let dropped = 0;
  const C = typeof opt.clock === 'function' ? opt.clock : (t) => t;
  const span = (p) => C(sents[p[1] - 1].end) - C(sents[p[0] - 1].start);
  const total = (ps) => ps.reduce((n, p) => n + span(p), 0);
  for (const m of list) {
    let ps = (Array.isArray(m && m.pieces) ? m.pieces : []).map((p) => (Array.isArray(p) ? p : [p && p.from, p && p.to]))
      .map(([a, b]) => [Math.round(+a), Math.round(+b)])
      .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && a >= 1 && b <= N && a <= b)
      .slice(0, 3);
    if (!ps.length) { dropped++; continue; }
    let hook = null;
    if (legacy) {
      // Before P12: the first piece may be a later hook (heard once), the rest in the video's order - read exactly as then.
      ps = [ps[0], ...ps.slice(1).sort((x, y) => x[0] - y[0])];
    } else {
      if (twice && ps.length > 1 && span(ps[0]) <= HOOK_MAX_S) {
        const [h, ...rest] = ps;
        const inside = rest.some((q) => h[0] >= q[0] && h[1] <= q[1]);
        const apart = rest.every((q) => h[1] < q[0] || h[0] > q[1]);
        if (inside || (apart && h[0] > Math.min(...rest.map((q) => q[0])))) { hook = h; ps = rest; }
      }
      ps = ps.slice().sort((x, y) => x[0] - y[0]);
    }
    // None over another - a hook that repeats a line of its own moment aside.
    const overlap = ps.some((p, k) => ps.some((q, l) => l !== k && p[0] <= q[1] && q[0] <= p[1]));
    if (overlap) { dropped++; continue; }
    const all = () => (hook ? [hook, ...ps] : ps);
    // A little too long: sentences off the end of its last piece while it stays long enough.
    let guard = 0;
    while (total(all()) > len.max + 2 && guard++ < 200) {
      const last = ps[ps.length - 1];
      if (last[1] > last[0] && total(all()) - (C(sents[last[1] - 1].end) - C(sents[last[1] - 2].end)) >= len.min) last[1]--;
      else if (ps.length > 1 && total(all().slice(0, -1)) >= len.min) ps = ps.slice(0, -1);
      else break;
    }
    // A hook trimmed away with the piece it repeated is not heard twice any more: it goes too.
    if (hook && !ps.some((q) => hook[0] >= q[0] && hook[1] <= q[1]) && !ps.every((q) => hook[1] < q[0] || hook[0] > q[1])) hook = null;
    const pieces = all();
    const secs = total(pieces);
    if (secs > len.max + 5 || secs < len.min - 5) { dropped++; continue; }
    const mine = new Set();
    for (const [a, b] of pieces) for (let i = a; i <= b; i++) mine.add(i);
    if ([...mine].some((i) => used.has(i))) { dropped++; continue; }
    for (const i of mine) used.add(i);
    const text = pieces.map(([a, b]) => sents.slice(a - 1, b).map((s) => s.text).join(' ')).join(' … ');
    const f = {
      title: _str(m.title, 80) || _str(sents[pieces[0][0] - 1].text, 60),
      // (phase V33.3) The title on top, in the video's own language (the owner's (х36)); the English title when it gave none.
      headline: _str(m.headline, 80),
      score: Math.max(0, Math.min(100, Math.round(+m.score || 0))),
      hook: _str(m.hook, 300) || _str(sents[pieces[0][0] - 1].text, 300),
      why: _str(m.why, 600),
      text: text.slice(0, 6000),
      pieces: pieces.map(([a, b], k) => ({ from: a, to: b, start: sents[a - 1].start, end: sents[b - 1].end, ...(hook && k === 0 ? { hook: true } : {}) })),
      seconds: r1(secs),
    };
    // (phase V69 P12) The key lines - where the frame will punch in (P12b): on their word's own moment, the video's seconds.
    if (K.keys && Array.isArray(m && m.keys)) {
      const raws = m.keys.map((x) => ({ s: Math.round(+(x && x.s)), w: _str(x && x.w, 60) })).filter((x) => mine.has(x.s));
      f.keys = _timedKeys(raws, sents, ws);
    }
    out.push(f);
  }
  out.sort((a, b) => b.score - a.score);
  const kept = out.slice(0, Math.max(1, +count || out.length));
  kept.forEach((f, k) => { f.rank = k + 1; });
  // (V33.8) What auto found the video to be, when its one answer said it (before V69 P12) - '' when it said nothing it may say.
  const found = foundKind(doc && !Array.isArray(doc) && doc.kind);
  return { fragments: kept, dropped: dropped + Math.max(0, out.length - kept.length), asked: list.length, kind: found };
}

// ── The price on the button (the owner's (х13)) ────────────────────────────
// (phase V69 P12, (хп79), (хп89)) By the FIRST step of the agents' ladder - the one that answers unless it fails - and with its
// thinking at effort high: dollars a million tokens in and out (Anthropic's list for Claude; a flash model's for the rest). Measured
// on the owner's videos with Sonnet 5.5 at high: lecture 20 (2.5 h, 20 moments) $0.22, the gold podcast in parts (73 min, 30 parts)
// $0.29, Lego E01 (32 min, 18 parts) $0.10; words in ~2.2 characters a token (Russian with times; English is cheaper).
const PRICES = [
  [/opus-5/, 4, 20], [/sonnet-5/, 2, 10], [/haiku-5/, 0.1, 0.5],
];
const FLASH = [0.5, 3];
function _rates(model) {
  const m = String(model || '');
  const hit = PRICES.find(([re]) => re.test(m));
  return hit ? [hit[1], hit[2]] : FLASH;
}
const _usd = (tokIn, tokOut, model) => { const [a, b] = _rates(model); return Math.round((tokIn * a / 1e6 + tokOut * b / 1e6) * 10000) / 10000; };
const CHARS_PER_TOKEN = 2.2;

// ── (phase V69 P11-P12, (хп92), (хп94)) AUTO'S FIRST CALL: what kind of video it is, from a SAMPLE of its words ──
// The title and the first 5 minutes, and 2 minutes around a quarter, the middle and three quarters of it - a video shorter than 20
// minutes whole; answered at once (effort low): 12 of 12 of the owner's videos named right in 1-6 s for 1-2 cents. The text is the one
// the check (хп94) tried, "why" asked in English.
const KIND_SYSTEM = [
  'You get ONE video\'s title and a SAMPLE of its transcript - its first minutes and a few stretches from later on, each sentence with its time. Say what kind of video it is. Answer at once, with JSON only: {"kind":"...","why":"one short sentence in English"}. kind is exactly one of:',
  '- "podcast": two or more people talking - a podcast, an interview, a talk show. Questions followed by long answers, again and again; "you" said to a person; "welcome to the show", "my guest", "thanks for having me"; short replies ("right", "yeah"); ad reads.',
  '- "truecrime": bodycam, dashcam or interrogation-room footage - an arrest, an interrogation, a police call - often with a host telling the case. An officer\'s questions and commands ("step out of the car", "hands behind your back", rights read, radio codes); a suspect\'s denials and excuses; a victim\'s complaints; a host speaking of the case in the third person ("according to police", "court documents").',
  '- "documentary": one polished narrator over footage, archive and graphics - a documentary, an explainer, a video essay, a history or lore video, sometimes with short interview bites. Few fillers; dates, places, names and numbers; questions the narrator asks and answers himself; "in this video"; references to what is on screen.',
  '- "lecture": one person explains a subject - a lecture at the board, a talk on stage, a lesson or a webinar with slides. Definitions, examples, "today we will talk about", "write this down", "next slide", slow dictation with repetitions, rare questions, laughter or applause from the room.',
  '- "stream": the recording of a live stream - a game with the streamer\'s camera, just chatting, reactions, IRL. Unscripted talk about what is happening on screen, "chat", donations and chat messages read aloud, game talk, shouting, swearing, laughter.',
  '- "other": none of these, or clearly mixed - a vlog, a tutorial, a reaction to or a commentary on another video, a monologue to camera, a cartoon, a film or a series episode, a music video.',
  'The transcript has no speaker names and you do not see the picture - judge by the words.',
].join('\n');
const KIND_WHOLE_S = 20 * 60;
const KIND_HEAD_S = 5 * 60;
const KIND_STRETCH_S = 2 * 60;

/** The stretches of the sample: [{ label, sents }] - one with no label for a video shorter than 20 minutes. */
function kindSample(sents, seconds) {
  const total = +seconds > 0 ? +seconds : (sents.length ? sents[sents.length - 1].end : 0);
  if (total < KIND_WHOLE_S) return [{ label: '', sents }];
  const spans = [[0, KIND_HEAD_S]].concat([0.25, 0.5, 0.75].map((f) => [total * f - KIND_STRETCH_S / 2, total * f + KIND_STRETCH_S / 2]));
  return spans.map(([a, b]) => ({ label: _clock(a).replace(/\.\d$/, '') + '-' + _clock(b).replace(/\.\d$/, ''),
    sents: sents.filter((x) => x.start >= a && x.start < b) })).filter((x) => x.sents.length);
}

/** The messages of auto's first call. */
function kindMessages({ title, seconds, sents }) {
  const parts = kindSample(sents, seconds);
  const k = parts.reduce((n, x) => n + x.sents.length, 0);
  const lines = [];
  for (const part of parts) {
    if (part.label) lines.push('--- ' + part.label + ' ---');
    for (const x of part.sents) lines.push(`[${x.i}] ${_clock(x.start)} ${x.text}`);
  }
  const user = [
    `Video: "${String(title || 'untitled').slice(0, 200)}", ${_clock(seconds)} long, ${sents.length} sentences; the sample below has ${k} of them.`,
    '',
    'Sample:',
    ...lines,
  ].join('\n');
  return [{ role: 'system', content: KIND_SYSTEM }, { role: 'user', content: user }];
}

/** Auto's first answer: { kind (one of FOUND_KINDS - other when it named none of them), why }. Throws when there is no JSON in it. */
function kindParse(raw) {
  const doc = _json(raw, (d) => !!(d && !Array.isArray(d) && typeof d.kind === 'string'));
  return { kind: foundKind(doc.kind) || 'other', why: _str(doc.why, 240) };
}

/** Auto's first call's price, roughly: the sample in (at most ~25 minutes of words), a line out. */
function kindPrice(chars, model) {
  return _usd(Math.min(+chars || 0, 26000) / CHARS_PER_TOKEN + 900, 120, model);
}

/** The moments' price, roughly: the words in, the moments and the thinking out (~450 tokens a moment), at `model`'s price. */
function priceOf(chars, count, model) {
  // The shared rules and the kind's own besides the words.
  const tokensIn = (+chars || 0) / CHARS_PER_TOKEN + 3000;
  const tokensOut = 450 * (+count || 5) + 1500;
  return _usd(tokensIn, tokensOut, model);
}

/**
 * Key lines `keys` ([{ s, w }] - a sentence number and its key word) on their word's own moment in `sents` (the word found among
 * `ws`, else the sentence's start), the video's seconds: [{ s, w, start, end }] - at most KEYS_PER_MIN a minute, KEY_GAP_S apart.
 * fragmentation's parts (V43) and, since V69 P12, the moments of the kinds that punch in.
 */
function _timedKeys(keys, sents, ws) {
  const out = [];
  const seen = new Set();
  for (const x of keys.slice().sort((p, q) => p.s - q.s)) {
    if (seen.has(x.s)) continue;
    seen.add(x.s);
    const s = sents[x.s - 1];
    if (!s) continue;
    let start = s.start;
    const want = _norm(x.w);
    if (want) {
      const hit = ws.find((w) => w.start >= s.start - 0.05 && w.end <= s.end + 0.05 && _norm(w.text) === want)
        || ws.find((w) => w.start >= s.start - 0.05 && w.end <= s.end + 0.05 && want.length >= 3 && _norm(w.text).includes(want));
      if (hit) start = hit.start;
    }
    if (out.length && start - out[out.length - 1].start < KEY_GAP_S) continue;
    if (out.filter((o) => o.start > start - 60).length >= KEYS_PER_MIN) continue;
    out.push({ s: x.s, w: x.w, start: r2(start), end: r2(Math.max(start + 0.3, s.end)) });
  }
  return out;
}

// ════════════════════════════════════════════════════════════════════════════
// FRAGMENTATION (phase V43, the owner 2026-10-24/25, answers (ё1)-(ё19); docs/local-app/PLAN.md "Фазы V39–V44", V43).
// Not the best moments: the WHOLE video, start to end, cut into parts by meaning, one after another - an episode of a series
// published as a run of shorts. The agent reads the same numbered sentences and answers the parts as [first, last] sentence
// numbers, the ones to cut out marked (the channel's intro, an ad, the outro, a recap - (ё4)), and each part's KEY MOMENTS -
// a punchline, a reveal, a strong line - where the frame punches in (ё5)-(ё7а). No score, no order but the video's ((ё9)).
// What comes back is CHECKED and mended here (fragParse), never trusted: every sentence in exactly one part, the parts
// contiguous from the first sentence to the last; the time with no speech between two sentences goes to the part before it,
// the very start to the first part ((ё3)); a part too short joins a neighbour, one too long is split at the sentence end
// nearest its middle ((ё1): the length asked for, 20 % either way for the sake of the meaning).
// ════════════════════════════════════════════════════════════════════════════

const FRAG_SLACK = 0.2;          // (ё1) a part may be this much shorter or longer than asked
const SKIPS = ['intro', 'ad', 'outro', 'recap'];
const SKIP_MAX_S = 180;          // a part marked to be cut out in the MIDDLE of the video longer than this is kept (an agent's slip)
const SKIP_EDGE_MAX_S = 300;     // ... at the start or the end of the video
const KEYS_PER_MIN = 4;          // (ё6) 1-4 punch-ins a minute
const KEY_GAP_S = 3;             // and never closer than this
// (V43, the paid check) A tail with NO SPEECH past the last sentence longer than this - an episode's closing credits (4 min on the
// owner's) - is cut out as the outro; the last part keeps TAIL_KEEP_S of it (the cut's own margin). The start is left alone: a
// series often opens on action with no words.
const TAIL_MAX_S = 10;
const TAIL_KEEP_S = 3;

// (phase V69 P10, (хп87)-(хп89)) The text the paid check of P10 tried (Sonnet 5.5 at effort high: the gold podcast in 30 parts, none
// longer than 3 min, Lego's duel whole) - docs/local-app/plan/ "Фаза V69", П10 "Текст правил, проверенный (хп89)". MIN, MAX and CEIL
// are put in (fragCeil).
const FRAG_SYSTEM = [
  'You are a video editor. You get the transcript of ONE long video (an episode of a series or a cartoon, a show, a long talk, a lecture, a stream) as numbered sentences, each with its start and end time. The video will be published WHOLE, as a run of vertical shorts one after another - a series in parts.',
  'Split the WHOLE video, start to end, into consecutive PARTS by meaning. Rules:',
  '1. Every sentence belongs to exactly one part. The parts follow one another with no gap and no overlap: the first starts at sentence 1, each next one starts right after the previous one ends, the last ends at the LAST sentence (its number is given at the end of the message). A part is its first and last sentence numbers (inclusive).',
  '2. A boundary goes where a new scene, topic or exchange begins: each part opens so that someone who has not seen the previous part understands who, where and what it is about, and ends when its scene, thought or exchange is over - never in the middle of one, never on a question whose answer opens the next part.',
  '3. A part lasts between MIN and MAX seconds (from the start of its first sentence to the start of the next part). It may be up to 20% shorter or longer when the meaning asks for it, but never longer than CEIL seconds. A scene or topic longer than that: split it YOURSELF where it turns - a new beat, a change of place, a line that changes the subject - and give the pieces the same title with " · 1", " · 2". Never leave a part so long that it has to be cut in the middle.',
  '4. Mark what is to be cut out with "skip": "intro" (the channel\'s intro, greetings, "in this video", a cold-open teaser that repeats a later scene), "ad" (a sponsor or ad read), "outro" ("subscribe", "see you next time", credits read aloud) or "recap" (a recap of earlier episodes). Everything else is a part with "skip": "". Never mark the story or the talk itself as skip.',
  '5. title: a short catchy title in English, at most 60 characters. headline: the same idea for the top of the short, in the LANGUAGE THE VIDEO IS SPOKEN IN (not translated), at most 50 characters.',
  '6. keys: the part\'s KEY MOMENTS, where the camera punches in: 2 to 3 a minute of the part (never more than 4 a minute, never two within 3 seconds; fewer only in a part with almost no words) - a punchline, a reveal, a strong or surprising claim, a key number, a confession, a threat, a joke landing, a line the next one reacts to. Each: "s" the sentence number (inside its part) and "w" the key word in it, exactly as spoken.',
  'Answer with JSON only, the parts in the video\'s order, in exactly this shape:',
  '{"parts":[{"from":1,"to":14,"skip":"","title":"...","headline":"...","keys":[{"s":5,"w":"word"}]}]}',
].join('\n');

// (phase V69 P10, (хп87)) No part longer than 3:00 - YouTube Shorts' limit, and Reels past it are not shown to those who do not
// follow: the 20 % of slack only up to it.
const FRAG_CEIL_S = 180;
const fragCeil = (len) => Math.round(Math.min(len.max * (1 + FRAG_SLACK), FRAG_CEIL_S));

/** How many parts a video of `seconds` comes to at the length `len` - for the budget of the answer and the price. */
const fragParts = (seconds, len) => Math.max(1, Math.round((+seconds || 0) / (((len.min + len.max) / 2) || 60)));

/** The messages for the ladder: the rules with the length put in, and the video's sentences. */
function fragMessages({ title, seconds, sents, len, language }) {
  const lines = sents.map((s) => `[${s.i}] ${_clock(s.start)}-${_clock(s.end)} (${r1(s.end - s.start)}s) ${s.text}`);
  const user = [
    `Video: "${String(title || 'untitled').slice(0, 200)}", ${_clock(seconds)} long, ${sents.length} sentences.`,
    ..._spoken(language),
    `Wanted: the whole video in parts of ${len.min}-${len.max} seconds (MIN ${len.min}, MAX ${len.max}), never longer than ${fragCeil(len)} seconds - about ${fragParts(seconds, len)} parts.`,
    '',
    'Sentences:',
    ...lines,
    '',
    _last(sents),
  ].join('\n');
  return [{ role: 'system', content: FRAG_SYSTEM.replace('MIN and MAX', `${len.min} and ${len.max}`).replace('CEIL', String(fragCeil(len))) }, { role: 'user', content: user }];
}

const _norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * The agent's parts, checked and mended. `sents` from sentences(); `len` { min, max }; `seconds` the video's length; `words`
 * (optional, [{ text, start, end }]) - a key word's own moment. `o.rule` (V69 P12) - the sentence rule the answer was asked under.
 * Returns { fragments: [{ rank, title, headline, text, pieces: [{ start, end, from, to }], seconds, keys: [{ s, w, start, end }] }],
 *           skipped: [{ from, to, start, end, skip }], asked, mended: { gaps, overlaps, merged, split, keptSkips } }.
 * Times: a part runs from its first sentence's start (the video's start for the first) to the next part's first sentence's start
 * (the video's end for the last) - the stretch with no speech after a sentence goes with it; but a speechless tail of more than
 * TAIL_MAX_S past the last sentence is cut out as the outro (`skipped`, from = to = the last sentence).
 */
function fragParse(raw, sents, len, seconds, words, o) {
  const doc = _json(raw, _hasList('parts', 'from'));
  const list = Array.isArray(doc) ? doc : (Array.isArray(doc && doc.parts) ? doc.parts : []);
  if (!list.length) throw Object.assign(new Error('The agent split the video into no parts.'), { refused: true });
  const N = sents.length;
  const total = +seconds > 0 ? +seconds : sents[N - 1].end;
  const mended = { gaps: 0, overlaps: 0, merged: 0, split: 0, keptSkips: 0 };
  // Every sentence's part, the first claim winning; then the gaps.
  const asked = list.map((p, k) => ({
    k, from: Math.round(+(p && p.from)), to: Math.round(+(p && p.to)),
    skip: SKIPS.includes(String((p && p.skip) || '').toLowerCase()) ? String(p.skip).toLowerCase() : '',
    title: _str(p && p.title, 80), headline: _str(p && p.headline, 80),
    keys: (Array.isArray(p && p.keys) ? p.keys : []).map((x) => ({ s: Math.round(+(x && x.s)), w: _str(x && x.w, 60) })).filter((x) => x.s >= 1 && x.s <= N),
  })).filter((p) => Number.isFinite(p.from) && Number.isFinite(p.to) && p.from >= 1 && p.to <= N && p.from <= p.to)
    .sort((a, b) => a.from - b.from || a.k - b.k);
  if (!asked.length) throw Object.assign(new Error('None of the agent\'s parts names sentences of this video.'), { refused: true });
  const owner = new Array(N + 1).fill(-1);
  for (const p of asked) for (let i = p.from; i <= p.to; i++) { if (owner[i] < 0) owner[i] = p.k; else mended.overlaps++; }
  // A sentence nobody took goes with the part before it (the very first ones - with the part after them).
  for (let i = 1; i <= N; i++) if (owner[i] < 0) { mended.gaps++; owner[i] = i > 1 ? owner[i - 1] : -2; }
  for (let i = N; i >= 1; i--) if (owner[i] === -2) owner[i] = i < N ? owner[i + 1] : asked[0].k;
  // Runs of one owner are the parts (a part split in two by another's overlap becomes two).
  const byK = new Map(asked.map((p) => [p.k, p]));
  let runs = [];
  for (let i = 1; i <= N; i++) {
    const last = runs[runs.length - 1];
    if (last && last.k === owner[i]) last.to = i;
    else runs.push({ k: owner[i], from: i, to: i });
  }
  runs = runs.map((r) => { const p = byK.get(r.k); return { ...r, skip: p.skip, title: p.title, headline: p.headline, keys: p.keys }; });
  const startOf = (r, idx) => (idx === 0 ? 0 : sents[r.from - 1].start);
  const span = () => runs.forEach((r, idx) => { r.start = startOf(r, idx); r.end = idx + 1 < runs.length ? sents[runs[idx + 1].from - 1].start : total; });
  span();
  // The speechless tail - the credits - out as the outro, FIRST (phase V69 P12, the paid check of P10): a last part the agent
  // marked "outro" with four minutes of credits in it was longer than an outro may be, and the rule below kept it as a part.
  const lastRun = runs[runs.length - 1];
  const speechEnd = sents[N - 1].end;
  let tail = null;
  if (total - speechEnd > TAIL_MAX_S) {
    const at = Math.min(total, speechEnd + TAIL_KEEP_S);
    tail = { from: N, to: N, start: r2(at), end: r2(total), skip: 'outro' };
    lastRun.end = at;
  }
  // A part marked to be cut out that is too long to be an intro, an ad or an outro is kept: the story is never dropped by a slip.
  runs.forEach((r, idx) => {
    if (!r.skip) return;
    const edge = idx === 0 || idx === runs.length - 1;
    if (r.end - r.start > (edge ? SKIP_EDGE_MAX_S : SKIP_MAX_S)) { r.skip = ''; mended.keptSkips++; }
  });
  // Two neighbours both cut out are one stretch; two kept ones stay apart.
  // (V69 P12) No part past 3:00 - an answer asked before P12 (sentence rule 1) is read with the slack it was asked with.
  const lo = len.min * (1 - FRAG_SLACK), hi = o && +o.rule === 1 ? len.max * (1 + FRAG_SLACK) : fragCeil(len);
  const dur = (r) => r.end - r.start;
  // Too short: joined to a kept neighbour with no cut between them - the one before, else the one after.
  for (let guard = 0; guard < 2000; guard++) {
    const idx = runs.findIndex((r) => !r.skip && dur(r) < lo && ((runs[runs.indexOf(r) - 1] && !runs[runs.indexOf(r) - 1].skip) || (runs[runs.indexOf(r) + 1] && !runs[runs.indexOf(r) + 1].skip)));
    if (idx < 0) break;
    const r = runs[idx];
    const prev = runs[idx - 1] && !runs[idx - 1].skip ? runs[idx - 1] : null;
    const next = runs[idx + 1] && !runs[idx + 1].skip ? runs[idx + 1] : null;
    // The shorter neighbour takes it, so the parts stay even.
    const into = prev && next ? (dur(prev) <= dur(next) ? prev : next) : (prev || next);
    const a = into === prev ? prev : r, b = into === prev ? r : next;
    const keep = dur(a) >= dur(b) ? a : b;
    const joined = { ...a, k: keep.k, to: b.to, end: b.end, keys: [...a.keys, ...b.keys], title: keep.title, headline: keep.headline };
    runs.splice(runs.indexOf(a), 2, joined);
    mended.merged++;
  }
  // Too long: split at the sentence end nearest the middle (again while too long), where there is one.
  for (let guard = 0; guard < 2000; guard++) {
    const idx = runs.findIndex((r) => !r.skip && dur(r) > hi && r.to > r.from && !r.noSplit);
    if (idx < 0) break;
    const r = runs[idx];
    const mid = r.start + dur(r) / 2;
    let best = -1, bd = Infinity;
    // A cut after sentence i: the second part starts at sentence i+1.
    for (let i = r.from; i < r.to; i++) {
      const at = sents[i].start;     // sentence i+1 (1-based) starts here
      const d = Math.abs(at - mid);
      if (at - r.start >= lo && r.end - at >= lo && d < bd) { bd = d; best = i; }
    }
    if (best < 0) { r.noSplit = true; continue; }
    const at = sents[best].start;
    const a = { ...r, to: best, end: at, keys: r.keys.filter((x) => x.s <= best) };
    const b = { ...r, from: best + 1, start: at, keys: r.keys.filter((x) => x.s > best) };
    runs.splice(idx, 1, a, b);
    mended.split++;
  }
  // The pieces of one part split in two or more are told apart: "Title · 1", "Title · 2".
  const ofK = new Map();
  for (const r of runs) if (!r.skip) ofK.set(r.k, (ofK.get(r.k) || 0) + 1);
  const nth = new Map();
  for (const r of runs) {
    if (r.skip || ofK.get(r.k) < 2) continue;
    nth.set(r.k, (nth.get(r.k) || 0) + 1);
    r.part = nth.get(r.k);
  }
  // Keys: inside their part, a word's own moment when it is found, at most KEYS_PER_MIN a minute and KEY_GAP_S apart.
  const ws = (Array.isArray(words) ? words : []).filter((w) => w && w.text);
  const keysOf = (r) => _timedKeys(r.keys.filter((y) => y.s >= r.from && y.s <= r.to), sents, ws);
  const kept = runs.filter((r) => !r.skip);
  if (!kept.length) throw Object.assign(new Error('The agent marked the whole video to be cut out.'), { refused: true });
  const fragments = kept.map((r, k) => ({
    rank: k + 1,
    title: (r.title || _str(sents[r.from - 1].text, 60)) + (r.part ? ' · ' + r.part : ''),
    headline: r.headline,
    text: sents.slice(r.from - 1, r.to).map((s) => s.text).join(' ').slice(0, 6000),
    pieces: [{ from: r.from, to: r.to, start: r2(r.start), end: r2(r.end) }],
    seconds: r1(r.end - r.start),
    keys: keysOf(r),
  }));
  const skipped = runs.filter((r) => r.skip).map((r) => ({ from: r.from, to: r.to, start: r2(r.start), end: r2(r.end), skip: r.skip }));
  if (tail) skipped.push(tail);
  return { fragments, skipped, asked: list.length, mended };
}

/** fragmentation's price, roughly: the words in, the parts and the thinking out (~550 tokens a part), at `model`'s price. */
function fragPrice(chars, seconds, len, model) {
  const tokensIn = (+chars || 0) / CHARS_PER_TOKEN + 2000;
  const tokensOut = 550 * fragParts(seconds, len) + 2000;
  return _usd(tokensIn, tokensOut, model);
}

module.exports = { SENT_RULE, sentences, messages, parse, priceOf, SYSTEM, GUIDES, FOUND_KINDS, foundKind,
  kindMessages, kindParse, kindPrice, kindSample,
  FRAG_SYSTEM, fragMessages, fragParse, fragPrice, fragParts, fragCeil,
  // (phase V90) the price of a call by its tokens - lib/fx-auto.js priceOf
  usdOf: _usd };
