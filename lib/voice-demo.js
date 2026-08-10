// Scenarios v3 — the phrase every taken voice reads once, so we own a sample of it.
//
// Why a sample of our own at all: the library's `preview_url` is the owner's neutral demo of
// a voice. What matters here is how the voice behaves in OUR manner — v3, with emotion tags
// performed — and that answer cannot be read off someone else's recording. So a voice, once
// taken, reads this once and the file is kept. Nothing goes back to the library afterwards.
//
// On the length: 40 words is 15-20 seconds at a normal pace, not 30. This is 73 words in 456
// characters, and the tags add pauses of their own, which should land it near half a minute.
// The exact duration is measured off the produced file rather than assumed.
//
// The tags are chosen to SWING: warm, then hard, then quiet, then bright. A voice that holds
// together across that range will hold together across an ad; one that flattens out shows it
// here instead of three fragments into a paid batch.
//
// Every tag is checked against lib/voice-tags.js TTS_SAFE_TAGS — the ones v3 actually
// performs. Two obvious-sounding words were not in it: `warm` (the performed form is
// `warmly`) and `sincere` (absent entirely, so `earnestly` stands in). An unknown tag is not
// an error anywhere; it is simply read as words or ignored, which is why it is checked here.
const DEMO_TEXT = [
  '[warmly] Look, I know exactly what you are thinking right now.',
  '[confident] I thought the same thing, and I was wrong about it.',
  '[serious] Here is the part nobody tells you, and it matters.',
  '[whispers] It took me months to figure this out on my own.',
  '[excited] Then everything changed, and it changed fast!',
  '[laughs] I could not believe it either.',
  '[calm] So take your time with this. Listen once more,',
  '[earnestly] and decide for yourself whether it is worth it.',
].join(' ');

// The word count is asserted rather than trusted: an edit that quietly halves the phrase
// would quietly halve the sample, and nobody would notice until a voice sounded fine on
// three words and wrong on thirty.
const DEMO_WORDS = DEMO_TEXT.replace(/\[[^\]]*\]/g, ' ').trim().split(/\s+/).length;

// Tags are only performed by v3; v2 would read the brackets out loud as words.
const DEMO_MODEL = 'eleven_v3';

module.exports = { DEMO_TEXT, DEMO_WORDS, DEMO_MODEL };
