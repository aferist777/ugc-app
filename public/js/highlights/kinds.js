/* ═══════════════════════════════════════════════════════════════════════════
   HIGHLIGHTS — THE KINDS OF VIDEO, ONE TABLE. ONE module for the server (lib/highlights-store.js KINDS, lib/highlights-agent.js,
   lib/highlights-job.js require() it) and the popup (merge-v3/hl-kinds.js STANDARD and ABOUT, hl-style.js RECOMMENDED,
   hl-popup.js): what a kind is called and said to be, its lengths and counts, the agent's ways (a late hook, key lines), how its
   frame and title go, and its standard and recommended music, presets, animations and fonts.

   A kind (label, short, long and presets.said are only ever shown - said in the app's language, t()):
     label            the button's name
     short, long      the words under the buttons - every kind's short line at the very first opening, the chosen one's long words
     lengths          'moments' (up to 30 / 30-60 / 60-90 s) or 'parts' (fragmentation's own, lib/highlights-store.js)
     length           the standard length
     counts, count    the count buttons and the standard one - a TARGET (the agent returns that many); [] - no count (fragmentation)
     hook             'twice' - the moment's strongest line opens it and is heard again in its place (podcast, true crime);
                      '' - the pieces in the video's order
     keys             the agent answers each moment's key lines (where the frame punches in)
     pauses           its pauses longer than 0.8 s shortened to 0.3 s when it is cut - and the agent measures a moment
                      on the clock of the speech (lib/highlights-pauses.js); lecture's only
     title            the title on top by default: true / false / 'by-video' (auto - the kind it finds)
     moods            { std, rec } - Music -> highlights moods (lib/highlights-music.js): the standard ticked, the recommended marked
     presets          { std, rec, said } - caption presets' ids the standard, their groups (presets.js CATEGORIES) recommended
     anims            { std, rec } - In -> Out pairs (captions/page-fx.js PAIRS)
     fonts            { std, rec } - families (captions/fonts.js) the standard, their groups recommended
     inDev            in development: its button grey, not pressed (stream)
     button           false - not a button of the popup (other: what auto cuts a video of none of the kinds by)
   ═══════════════════════════════════════════════════════════════════════════ */

import { t } from '../i18n/t.js';

export const BY_VIDEO = '@by-video';

const STD_COUNTS = [3, 5, 10, 15, 20, 30];

export const KINDS = {
  auto: {
    label: t('Auto'),
    short: t('finds out what the video is, then cuts it by that kind\'s rules'),
    long: t('Reads the words first and decides what the video is - a podcast or an interview, true crime, a documentary, a lecture - then cuts it exactly as that kind does: its rules, its frame, its punch-ins, its pauses; "by the video" gives it that kind\'s captions, music and title too. The length and the count are yours. A video of none of these kinds is cut by the general rules: it starts on the line that carries the meaning and ends on the payoff; the frame follows the faces, else a whole person, else a square from the middle over its blur. Moments up to 30 s, 30-60 s or 60-90 s; 3 to 30 of them.'),
    lengths: 'moments', length: '30-60', counts: STD_COUNTS, count: 20, hook: '', keys: false, title: BY_VIDEO,
    moods: { std: [BY_VIDEO], rec: [] },
    presets: { std: [BY_VIDEO], rec: [], said: t('by the video - the kind it finds gives its own captions') },
    anims: { std: [], rec: [] },
    fonts: { std: [], rec: [] },
  },
  podcast: {
    label: t('Podcast · interview'),
    short: t('people talking: opinions, stories, answers, exchanges'),
    long: t('Two or more people talking - a podcast, an interview, a talk show. The agent finds as many moments as you ask for: a strong opinion with its reason, a story that reaches its point, a confession, a disagreement, a direct answer, a funny exchange. Each opens on its strongest line - a punchline from later in it goes first - and ends right after the payoff, never mid-answer; greetings, ads and the outro are skipped. The frame follows whoever speaks and punches in ×1.2 on key phrases; no face - a square from the middle over its blur. Moments up to 30 s, 30-60 s or 60-90 s; 3 to 30 of them.'),
    lengths: 'moments', length: '30-60', counts: STD_COUNTS, count: 20, hook: 'twice', keys: true, title: false,
    moods: { std: ['lofi', 'calm'], rec: ['lofi', 'calm', 'inspiring', 'confident'] },
    presets: { std: ['cp-podcast-viral', 'cp-creator-pop', 'cs-golden-glow-sweep'], rec: ['viral', 'karaoke', 'pop'], said: t('bright, word by word - for people talking') },
    anims: { std: ['pop|shrink'], rec: ['pop|shrink', 'pop|pop', 'zoom|fade', 'rise|rise'] },
    fonts: { std: ['Rubik Black', 'Unbounded Black', 'Sofia Sans Extra Condensed Black'], rec: ['basic', 'condensed', 'heavy', 'comic'] },
  },
  truecrime: {
    label: t('True crime · bodycam'),
    short: t('bodycam, interrogations, arrests: confessions, lies, turns'),
    long: t('Bodycam footage of an interrogation or an arrest, often with a host. The agent finds as many moments as you ask for: a confession, a lie and the moment it falls apart, a turn, the arrest, a shocking detail, the officer\'s verdict. Each opens on its strongest line - heard again in its place - and ends once the answer lands, never mid-answer; the host only sets the scene or tells the outcome; intro, ads and outro are skipped. The frame follows who speaks or reacts and punches in ×1.2 on key lines; no face - a square from the middle over its blur. Moments up to 30 s, 30-60 s or 60-90 s; 3 to 30.'),
    lengths: 'moments', length: '30-60', counts: STD_COUNTS, count: 20, hook: 'twice', keys: true, title: true,
    moods: { std: ['tense', 'mysterious'], rec: ['tense', 'mysterious', 'emotional'] },
    presets: { std: ['cp-dark-psychology', 'cp-red-box', 'cs-crimson-pop'], rec: ['viral', 'pop', 'cinema'], said: t('white and red, hard - for true crime') },
    anims: { std: ['zoom|fade'], rec: ['zoom|fade', 'drop|fall', 'blur|blur', 'fade|fade'] },
    fonts: { std: ['Russo One', 'Sofia Sans Extra Condensed Black', 'Special Elite'], rec: ['stencil', 'condensed', 'heavy', 'basic'] },
  },
  documentary: {
    label: t('Documentary'),
    short: t('a narrator over footage: facts, mysteries, reveals'),
    long: t('One narrator over footage, archive and graphics - a documentary, an explainer, a video essay, a history or lore video. The agent finds as many moments as you ask for: a striking fact with its why, a question and its answer, a belief and its correction, a turn, a reveal, one story told whole. Each starts on the claim or the question and ends on the answer, never on "more on that later"; intros, sponsor reads and the outro are skipped. The frame is a square from the middle over its blur, with a title on top for 3 s. Moments up to 30 s, 30-60 s or 60-90 s; 3 to 30.'),
    lengths: 'moments', length: '30-60', counts: STD_COUNTS, count: 20, hook: '', keys: false, title: true,
    moods: { std: ['mysterious', 'emotional'], rec: ['mysterious', 'emotional', 'tense', 'inspiring'] },
    presets: { std: ['cs-serif-cream-highlight', 'cs-indie-film-1-85-clean', 'cp-serif-amber-highlight'], rec: ['clean', 'cinema'], said: t('calm - for a story told') },
    anims: { std: ['fade|fade'], rec: ['fade|fade', 'rise|rise', 'blur|blur', 'fade|sink'] },
    fonts: { std: ['PT Serif', 'Oswald', 'Inter ExtraBold'], rec: ['basic', 'condensed', 'hand'] },
  },
  lecture: {
    label: t('Lecture'),
    short: t('one speaker explains: ideas, examples, stories'),
    long: t('One person explains a subject - a lecture at the board, a talk on stage, a lesson with slides. The agent finds as many moments as you ask for: one idea told whole - a definition with its example and takeaway, a surprising fact with its why, a story that explains it, a paradox, a quote unpacked, an answer to a question from the room. Each starts on the claim or the question and ends on the takeaway, never mid-explanation; housekeeping, dictation and recaps are skipped, pauses are shortened. The speaker in a square from the middle, a slide whole, over the blur, with a title on top for 3 s. Moments up to 30 s, 30-60 s or 60-90 s; 3 to 30.'),
    lengths: 'moments', length: '30-60', counts: STD_COUNTS, count: 20, hook: '', keys: false, title: true, pauses: true,
    moods: { std: ['calm', 'inspiring'], rec: ['calm', 'inspiring', 'lofi', 'confident'] },
    presets: { std: ['cs-yellow-highlight', 'cs-red-highlight', 'cs-highlighter-yellow-sweep'], rec: ['clean', 'karaoke', 'viral'], said: t('clear, a word marked - for a lecture') },
    anims: { std: ['rise|rise'], rec: ['rise|rise', 'fade|fade', 'grow|fade', 'pop|shrink'] },
    fonts: { std: ['Montserrat ExtraBold', 'Caveat', 'Yanone Kaffeesatz'], rec: ['basic', 'hand', 'condensed', 'marker'] },
  },
  stream: {
    label: t('Stream'),
    short: t('a live stream: game peaks, reactions, donations, chat'),
    long: t('A live stream recording - a game with the streamer\'s camera, just chatting, reactions, IRL. The agent finds as many moments as you ask for across the whole stream: an epic play or a fail with its lead-up and the streamer\'s reaction, a scare, a laugh, rage, a donation or a chat message read aloud and the answer, a story told to a viewer. Each runs in the stream\'s order and ends on the reaction; the start, tech checks, ads, thank-you lists and the game\'s cutscenes are skipped. The camera on top, the game below; a full-screen camera follows whoever speaks. Moments up to 30 s, 30-60 s or 60-90 s; 3 to 50.'),
    lengths: 'moments', length: 'up30', counts: [3, 5, 10, 15, 20, 30, 50], count: 30, hook: '', keys: true, title: false, inDev: true,
    moods: { std: [], rec: ['energetic', 'playful', 'tense'] },
    presets: { std: ['cs-arcade-pulse-retro', 'cs-hyper-blue-laser', 'cs-chunky-yellow-pop'], rec: ['neon', 'viral', 'pop'], said: t('loud, neon - for a stream') },
    anims: { std: ['pop|pop'], rec: ['pop|pop', 'zoom|zoom', 'drop|fall', 'swing|shrink'] },
    fonts: { std: ['Russo One', 'Press Start 2P', 'Rubik Glitch'], rec: ['pixel', 'techno', 'comic', 'heavy'] },
  },
  fragmentation: {
    label: t('Fragmentation'),
    short: t('the whole video, start to end, in parts by meaning'),
    long: t('The whole video, start to end, cut into parts by meaning - an episode of a series, a show or a long talk published as a run of shorts. Each part is a scene, a topic or a whole exchange: it opens where one begins and ends where it ends, never mid-scene; the intro, ads, the outro and recaps are cut out. As many parts as the video comes to, in its order, each with its number and title on top for 3 s. The frame follows the most active one - who acts, who speaks, who reacts - with no blur, and punches in ×1.2 on key phrases. Parts of 30-60 s, 1-2 min or 2-3 min.'),
    lengths: 'parts', length: 'p1-2', counts: [], count: 0, hook: '', keys: true, title: true,
    moods: { std: [], rec: ['lofi', 'calm', 'inspiring', 'confident'] },
    presets: { std: ['cp-podcast-viral', 'cs-lower-third-classic', 'cs-modern-crisp-sans'], rec: ['viral', 'clean', 'karaoke'], said: t('clear, calmer - a part runs for minutes') },
    anims: { std: ['fade|fade'], rec: ['fade|fade', 'pop|shrink', 'rise|rise', 'zoom|fade'] },
    fonts: { std: [], rec: ['basic', 'condensed', 'heavy'] },
  },
  // What auto cuts a video of none of the kinds by - not a button: the general rules with the target, the pieces in order, no
  // key lines; "by the video" gives it podcast's captions, no music, no title.
  other: {
    label: t('Other'), button: false,
    short: t('none of the kinds - the general rules'),
    long: '',
    lengths: 'moments', length: '30-60', counts: STD_COUNTS, count: 20, hook: '', keys: false, title: false,
    moods: { std: [], rec: [] },
    presets: { std: ['cp-podcast-viral', 'cp-creator-pop', 'cs-golden-glow-sweep'], rec: ['viral', 'karaoke', 'pop'], said: '' },
    anims: { std: ['pop|shrink'], rec: [] },
    fonts: { std: [], rec: [] },
  },
};

/** The kinds the popup shows as buttons, in order. */
export const BUTTONS = Object.keys(KINDS).filter((k) => KINDS[k].button !== false);
/** The kinds auto may find a video to be - never fragmentation; other for none of them. */
export const FOUND = ['podcast', 'truecrime', 'documentary', 'lecture', 'stream', 'other'];

/** A kind's row, or null. */
export const kindOf = (k) => (Object.prototype.hasOwnProperty.call(KINDS, k) ? KINDS[k] : null);
/** Is this kind in development (its button grey, not pressed). */
export const inDev = (k) => !!(kindOf(k) && kindOf(k).inDev);
/** The kind a found kind ACTS as while it is in development: other (auto names it, cuts it by the general rules). */
export const acting = (k) => (kindOf(k) ? (inDev(k) ? 'other' : k) : 'other');
