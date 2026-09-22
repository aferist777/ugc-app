// Voice-tag library.
//
// LIBRARY is a reference list kept verbatim, exactly as it was supplied, so it can
// back a help panel later. It is NOT the set the tagging pass is allowed to use.
//
// The distinction matters, because the list mixes three different kinds of request
// and only one of them belongs inside text sent to a TTS model:
//
//   'tts'     - a delivery instruction the model can act on: an emotion, a breath,
//               a volume, a pace, an emphasis. These are the only ones safe to put
//               in the spoken text.
//   'casting' - a description of WHOSE voice it is: an accent, an age, an archetype,
//               a genre read. That is chosen when the voice is chosen; as a tag it
//               mostly does nothing, because a given voice cannot change its accent
//               on request.
//   'motion'  - a VISUAL stage direction. It has no sound at all. Left in spoken
//               text a novel phrase like this is liable to be read out loud. These
//               are worth keeping for the Seedance motion prompt, not for TTS.
//
// Only `use: 'tts'` groups belong in spoken text; that is the rule the MOODS in
// lib/motion-presets.js were built by.
const LIBRARY = [
  { category: 'Emotional states', use: 'tts', groups: [
    { name: 'Core emotions', tags: ['happy', 'sad', 'angry', 'excited', 'nervous', 'confident', 'calm', 'serious', 'playful', 'worried', 'frustrated', 'hopeful', 'relieved', 'disappointed', 'embarrassed', 'lonely', 'grateful'] },
    { name: 'Complex shades', tags: ['nostalgic', 'wistful', 'bittersweet', 'melancholic', 'anxious', 'tense', 'uneasy', 'determined', 'triumphant', 'resigned', 'reflective', 'skeptical', 'suspicious', 'jealous', 'ashamed', 'yearning'] },
    // Long descriptive phrases: understood far less reliably than a single word, and
    // the more novel the wording the likelier it is spoken instead of performed.
    { name: 'Intensity variants', tags: ['slightly nervous', 'barely holding back anger', 'quietly emotional', 'overjoyed', 'deeply sorrowful', 'barely excited', 'visibly shaken'], risky: true },
  ] },
  { category: 'Reactions and human sounds', use: 'tts', groups: [
    { name: 'Breath and body', tags: ['gasp', 'sigh', 'deep breath', 'sharp inhale', 'exhale slowly', 'breath trembles', 'nervous breath', 'breath catches'] },
    { name: 'Speech reactions', tags: ['chuckles', 'laughs softly', 'laughs loudly', 'nervous laugh', 'snorts', 'giggles', 'scoffs', 'groans', 'mutters'] },
    { name: 'Shock and surprise', tags: ['gasps in disbelief', 'stunned silence', 'taken aback', 'whispers in shock'], risky: true },
    { name: 'Mouth sounds', tags: ['swallows', 'gulps', 'clears throat', 'lips smack', 'clicks tongue'] },
  ] },
  { category: 'Volume and energy', use: 'tts', groups: [
    { name: 'Low energy', tags: ['whispering', 'quietly', 'softly', 'hushed tone', 'murmuring'] },
    { name: 'Neutral', tags: ['natural tone', 'casual tone', 'conversational tone'] },
    { name: 'High energy', tags: ['loudly', 'shouting', 'calling out', 'energetically', 'bursting with excitement'] },
    { name: 'Intensity shifts', tags: ['voice rising', 'voice lowering', 'voice cracks', 'voice trembling'] },
  ] },
  { category: 'Pacing and rhythm', use: 'tts', groups: [
    { name: 'Speed control', tags: ['rushed', 'rapid-fire', 'slow and deliberate', 'slows down', 'picks up pace'] },
    { name: 'Conversation rhythm', tags: ['pauses', 'brief pause', 'long pause', 'hesitates', 'stammers'] },
    { name: 'Speech patterns', tags: ['drawn out', 'trails off', 'cuts sentence short', 'repeats for emphasis'] },
    { name: 'Breathing rhythm', tags: ['speaks between breaths', 'breathing heavily'] },
  ] },
  { category: 'Emphasis and delivery', use: 'tts', groups: [
    { name: 'Word emphasis', tags: ['emphasized', 'stress on next word', 'strong emphasis', 'soft emphasis'] },
    { name: 'Subtle styles', tags: ['understated', 'deadpan', 'dry tone'] },
    { name: 'Persuasive', tags: ['convincingly', 'earnestly', 'passionately'] },
    { name: 'Authority', tags: ['firmly', 'commanding tone', 'assertively'] },
  ] },
  { category: 'Conversational realism', use: 'tts', groups: [
    { name: 'Thinking sounds', tags: ['thinking', 'muttering to self', 'searching for words'] },
    { name: 'Awkward pauses', tags: ['awkward silence', 'hesitates nervously'] },
    { name: 'Interruptions', tags: ['interrupting', 'cuts in'] },
    // These two are body language, not sound.
    { name: 'Dialogue dynamics', tags: ['leans closer', 'steps back slightly'], use: 'motion' },
  ] },
  { category: 'Emotional shifts', use: 'tts', groups: [
    { name: 'Sudden changes', tags: ['suddenly serious', 'suddenly excited', 'tone darkens'] },
    { name: 'Gradual changes', tags: ['becoming emotional', 'voice softens', 'anger building'] },
    { name: 'Reveals', tags: ['realization dawning', 'whispers revelation'] },
  ] },
  { category: 'Narrative story beats', use: 'tts', groups: [
    { name: 'Scene transitions', tags: ['after a moment', 'after a long pause'] },
    { name: 'Memory and reflection', tags: ['softly remembering', 'nostalgic tone'] },
    { name: 'Suspense', tags: ['whispers', 'ominous tone'] },
    { name: 'Revelation', tags: ['dramatic reveal', 'whispers intensely'] },
    { name: 'Ending tones', tags: ['soft conclusion', 'hopeful ending', 'quiet reflection'] },
  ] },
  { category: 'Advanced performance cues', use: 'tts', groups: [
    { name: 'Psychological', tags: ['masking fear', 'forced calm'] },
    { name: 'Physical state', tags: ['out of breath', 'exhausted voice', 'in pain'] },
    { name: 'Social', tags: ['polite tone', 'awkward politeness'] },
  ] },
  // Carried over from the set the dialogue pipeline already ships with. These have
  // been placed by that flow in production, so they are kept rather than dropped for
  // not appearing in the newer list. Only entries with no equivalent above are here:
  // `sighs` and `gasps` are left out because the library already spells them `sigh`
  // and `gasp`, and one canonical spelling per sound is the whole point.
  { category: 'From the dialogue set', use: 'tts', groups: [
    { name: 'Tone', tags: ['cheerful', 'playfully', 'warmly', 'sarcastic', 'mischievously',
                           'seriously', 'calmly', 'hesitant', 'curious', 'flirtatious'] },
    { name: 'Sounds', tags: ['laughs', 'crying', 'exhales', 'yawns'] },
  ] },

  // ── voice casting, not delivery ──────────────────────────────────────────────
  // A chosen voice has one accent, one age and one character. A tag cannot give a
  // British voice a Russian accent; it is picked when the voice is picked.
  { category: 'Character performance', use: 'casting', groups: [
    { name: 'Age cues', tags: ['childlike tone', 'teenager tone', 'young adult voice', 'middle-aged tone', 'elderly voice'] },
    { name: 'Archetypes', tags: ['heroic voice', 'wise mentor voice', 'villain voice', 'evil scientist voice', 'news reporter voice', 'storyteller voice', 'radio host voice', 'teacher voice'] },
    { name: 'Fantasy', tags: ['pirate voice', 'knight voice', 'royal voice', 'dragon narrator'] },
    { name: 'Sci-fi', tags: ['robotic tone', 'sci-fi AI voice', 'hologram voice', 'cybernetic voice'] },
  ] },
  { category: 'Genre performance', use: 'casting', groups: [
    { name: 'Narrative styles', tags: ['fantasy narrator', 'epic narrator', 'documentary narrator', 'audiobook narrator'] },
    { name: 'Film styles', tags: ['classic film noir', 'thriller narrator', 'horror whisper', 'comedic narration'] },
    { name: 'Advertising styles', tags: ['commercial voice', 'enthusiastic ad voice', 'luxury brand voice', 'corporate presentation tone'] },
  ] },
  { category: 'Accents and dialects', use: 'casting', groups: [
    { name: 'English variants', tags: ['American accent', 'British accent', 'Australian accent', 'Indian English', 'Irish accent', 'Scottish accent', 'Canadian accent'] },
    { name: 'European accents', tags: ['French accent', 'German accent', 'Italian accent', 'Spanish accent', 'Russian accent'] },
    { name: 'Regional US', tags: ['Southern US accent', 'New York accent', 'Midwestern accent'] },
    { name: 'Character accents', tags: ['pirate accent', 'medieval accent'] },
  ] },
  // Microphone distance and cinematic scale are mixing decisions, not something a
  // text-to-speech model renders from a bracket.
  { category: 'Cinematic voice direction', use: 'casting', groups: [
    { name: 'Camera style acting', tags: ['intimate whisper', 'voice close to microphone'] },
    { name: 'Large scale', tags: ['epic cinematic tone', 'grand narration'] },
    { name: 'Emotional monologue', tags: ['breaking emotionally', 'voice trembling with emotion'] },
  ] },
];

// The role the tagging pass is given. A model told to "add tags" decorates; a model
// told it is casting a performance asks what each line is DOING first.
const CASTING_DIRECTOR_ROLE =
  'You are a casting director preparing a script for ElevenLabs v3 text-to-speech. '
  + 'You hear a performance in your head and you mark it up so a voice actor could hit it. '
  + 'You are not decorating the text: every tag you place must earn its place by changing '
  + 'how a specific phrase is delivered. Sentences that read fine plainly stay plain.';

// LIBRARY is exported for reading, not for logic: nothing branches on it. It is the list the
// tags in lib/motion-presets.js MOODS were drawn from, and the place to check a new one against
// before adding it - a tag ElevenLabs does not know is liable to be spoken out loud.
module.exports = { LIBRARY, CASTING_DIRECTOR_ROLE };
