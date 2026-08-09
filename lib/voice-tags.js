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
// Only `use: 'tts'` groups feed the mood presets below.
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

// ── moods for an ad read ─────────────────────────────────────────────────────
// A mood is what the user picks. It carries three things:
//
//   note   one line for the interface
//   brief  the direction the model reads. This is what makes the difference between
//          tags sprinkled evenly and tags that mean something: it says what the arc
//          of the read is, where a tag earns its place, and what to leave alone.
//   tags   the ONLY tags the pass may insert. Anything else is stripped, because a
//          tag the model does not know is liable to be SPOKEN rather than performed.
//
// The sets are wide on purpose — around two dozen each. A narrow list forces the same
// four tags onto every line; discipline comes from the brief, not from scarcity.
const AD_MOODS = [
  { id: 'hyped', label: 'Enthusiastic',
    note: 'Loud, fast, delighted. The classic discovery read.',
    brief: 'Someone who has just found something that works and cannot keep it to themselves. '
         + 'Energy climbs across the script: the opening is a hook, the middle is the discovery, '
         + 'the end is the recommendation. Put the loudest tags where the good news actually '
         + 'lands, not on the setup. A laugh belongs where something is genuinely funny, never '
         + 'as decoration. Do not stack two energy tags on one sentence — it reads as shouting.',
    tags: ['excited', 'happy', 'overjoyed', 'energetically', 'bursting with excitement',
           'loudly', 'voice rising', 'picks up pace', 'rapid-fire', 'strong emphasis',
           'emphasized', 'stress on next word', 'laughs softly', 'chuckles', 'giggles',
           'sharp inhale', 'gasp', 'suddenly excited', 'triumphant', 'grateful', 'hopeful',
           'playful', 'confident', 'determined', 'relieved'] },

  { id: 'trusted', label: 'Calm and trustworthy',
    note: 'Unhurried and grounded. For claims that need to sound true.',
    brief: 'Someone explaining something they know well, with nothing to prove. The voice stays '
         + 'level throughout; persuasion comes from pacing, not volume. Use pauses before the '
         + 'claims that matter so they have room to land, and soft emphasis on the single word '
         + 'that carries each sentence. No laughter, no rising energy, nothing performed — the '
         + 'moment it sounds like selling, the read has failed.',
    tags: ['calm', 'natural tone', 'conversational tone', 'slow and deliberate', 'slows down',
           'softly', 'quietly', 'earnestly', 'convincingly', 'passionately', 'firmly',
           'brief pause', 'pauses', 'long pause', 'after a moment', 'soft emphasis',
           'emphasized', 'deep breath', 'exhale slowly', 'serious', 'confident', 'reflective',
           'grateful', 'polite tone', 'understated'] },

  { id: 'friendly', label: 'Friendly chat',
    note: 'Talking to one person, not an audience.',
    brief: 'A message to a friend, recorded in one take. The delivery wanders slightly: a small '
         + 'laugh, a beat while a word is found, a thought that trails off. Those imperfections '
         + 'are the point — they are what makes it not an advertisement. Keep the tags small and '
         + 'ordinary; nothing dramatic, nothing loud. Leave whole sentences untagged so the ones '
         + 'you do mark feel like real reactions.',
    tags: ['conversational tone', 'casual tone', 'natural tone', 'warmly', 'playful', 'happy',
           'chuckles', 'giggles', 'laughs softly', 'snorts', 'thinking', 'searching for words',
           'brief pause', 'pauses', 'hesitates', 'trails off', 'drawn out', 'sigh', 'exhales',
           'clears throat', 'soft emphasis', 'curious', 'relieved', 'grateful'] },

  { id: 'convinced', label: 'Sceptic convinced',
    note: 'Doubt first, then it lands. Needs both halves of the arc.',
    brief: 'The read is a turn, and the turn is the whole point. The first part is guarded — '
         + 'flat, slow, unimpressed, with the doubt audible. Somewhere in the middle something '
         + 'gives, and from there the voice opens up: warmer, quicker, willing. Mark the moment '
         + 'the doubt breaks with a single tag and nothing else, so the change is heard rather '
         + 'than announced. Never put an enthusiastic tag before the turn, or there is no arc.',
    // no `flat`: it is on neither list, and `deadpan` already says it
    tags: ['skeptical', 'suspicious', 'uneasy', 'hesitant', 'deadpan', 'dry tone', 'scoffs',
           'slow and deliberate', 'hesitates', 'pauses', 'long pause', 'thinking',
           'realization dawning', 'suddenly serious', 'suddenly excited', 'voice softens',
           'becoming emotional', 'relieved', 'convincingly', 'earnestly', 'confident',
           'picks up pace', 'emphasized', 'sharp inhale'] },

  { id: 'urgent', label: 'Urgency',
    note: 'Running out of time. Short sentences carry this best.',
    brief: 'Something is about to be missed. The read is tight and forward-leaning, with almost '
         + 'no pauses — where a breath does appear it should feel like a snatched one, not a '
         + 'rest. Push the pace on the consequence and hit the deadline words hard. Avoid '
         + 'anything warm or amused: this read has no time to be charming.',
    tags: ['rushed', 'rapid-fire', 'picks up pace', 'voice rising', 'loudly', 'calling out',
           'firmly', 'assertively', 'commanding tone', 'determined', 'tense', 'anxious',
           'strong emphasis', 'emphasized', 'stress on next word', 'repeats for emphasis',
           'sharp inhale', 'speaks between breaths', 'breathing heavily', 'cuts sentence short',
           'brief pause', 'serious', 'worried'] },

  { id: 'selfirony', label: 'Self-deprecating',
    note: 'Admitting the mess before selling the fix.',
    brief: 'Someone laughing at their own situation, and the humour has to be at their own '
         + 'expense — never at the audience. The confession half is dry and a little tired; the '
         + 'solution half lightens without becoming a sales pitch. Keep the funny tags on the '
         + 'admissions, not on the product. One dry aside lands better than three.',
    // `sigh`, not `sighs`: the library spells it singular and the app's older set spells it
    // plural. One canonical spelling per sound, or the same breath reaches the model under two
    // names and lands inconsistently.
    tags: ['deadpan', 'dry tone', 'understated', 'sarcastic', 'scoffs', 'chuckles',
           'nervous laugh', 'laughs softly', 'snorts', 'sigh', 'exhales', 'groans',
           'embarrassed', 'ashamed', 'resigned', 'disappointed', 'frustrated', 'lonely',
           'muttering to self', 'mutters', 'trails off', 'pauses', 'brief pause',
           'hopeful', 'relieved', 'warmly'] },
];

// The role the tagging pass is given. A model told to "add tags" decorates; a model
// told it is casting a performance asks what each line is DOING first.
const CASTING_DIRECTOR_ROLE =
  'You are a casting director preparing a script for ElevenLabs v3 text-to-speech. '
  + 'You hear a performance in your head and you mark it up so a voice actor could hit it. '
  + 'You are not decorating the text: every tag you place must earn its place by changing '
  + 'how a specific phrase is delivered. Sentences that read fine plainly stay plain.';

// Everything the tagging pass may ever emit, whatever the mood.
const TTS_SAFE_TAGS = LIBRARY
  .filter(c => c.use === 'tts')
  .flatMap(c => c.groups.filter(g => (g.use || c.use) === 'tts').flatMap(g => g.tags));

// Body language worth handing to the video motion prompt instead.
const MOTION_TAGS = LIBRARY
  .flatMap(c => c.groups.filter(g => g.use === 'motion').flatMap(g => g.tags));

const moodById = (id) => AD_MOODS.find(m => m.id === id) || null;

module.exports = { LIBRARY, AD_MOODS, TTS_SAFE_TAGS, MOTION_TAGS, CASTING_DIRECTOR_ROLE, moodById };
