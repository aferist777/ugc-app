// Scenarios v3 — what the ElevenLabs shared-voice library can be filtered by.
//
// The API has no endpoint that lists its own filter vocabularies, so this is a SNAPSHOT:
// measured on 2026-08-10 from 681 voices (three pages per gender). To refresh it, page
// /v1/shared-voices and collect the distinct values of each field.
//
// One upstream quirk worth knowing: the age field comes back as both `middle_aged` and
// `middle-aged` depending on the record, but the FILTER accepts the underscore form. So the
// value sent is always `middle_aged` and the hyphenated records are matched by it.

const GENDERS = ['male', 'female', 'neutral'];

const AGES = [
  { id: 'young',       label: 'young' },
  { id: 'middle_aged', label: 'middle aged' },
  { id: 'old',         label: 'old' },
];

// How the owner describes the voice. The most useful filter of the lot for ad reads.
const DESCRIPTIVES = [
  'anxious', 'calm', 'casual', 'childish', 'chill', 'classy', 'confident', 'crisp', 'cute',
  'deep', 'excited', 'formal', 'gentle', 'grumpy', 'husky', 'hyped', 'intense', 'mature',
  'meditative', 'modulated', 'neutral', 'pleasant', 'professional', 'raspy', 'relaxed',
  'robotic', 'rough', 'sassy', 'serious', 'soft', 'upbeat', 'whispery', 'wise',
];

const USE_CASES = [
  { id: 'advertisement',           label: 'advertisement' },
  { id: 'social_media',            label: 'social media' },
  { id: 'conversational',          label: 'conversational' },
  { id: 'narrative_story',         label: 'narration' },
  { id: 'informative_educational', label: 'informative' },
  { id: 'characters_animation',    label: 'characters' },
  { id: 'entertainment_tv',        label: 'entertainment' },
];

// 74 of them, so alphabetical and left long: a native dropdown handles a list this size,
// and cutting it to "the popular ones" would hide exactly the accent someone is after.
const ACCENTS = [
  'african american', 'american', 'arabic', 'argentine', 'australian', 'beijing mandarin',
  'bengali', 'bhojpuri', 'bihari', 'boston', 'brazilian', 'british', 'budapest', 'canadian',
  'caribbean', 'central', 'chennai', 'chilean', 'chinese', 'colombian', 'copenhagen', 'cuban',
  'danish', 'dutch', 'ecuadorian', 'en-british', 'filipino', 'finnish', 'flemish', 'german',
  'gujarati', 'gyeongsang', 'indian', 'irish', 'istanbul', 'italian', 'jamaican', 'japanese',
  'jordanian', 'kansai', 'kanto', 'kiev', 'latin american', 'malaysian', 'marathi', 'marwadi',
  'mazovian', 'mexican', 'modern standard', 'moravian', 'moscow', 'new zealand', 'nigerian',
  'northern', 'oslo', 'parisian', 'peninsular', 'polish', 'portuguese', 'punjabi',
  'received pronunciation', 'romanian', 'saudi', 'scottish', 'seoul', 'sofia', 'south african',
  'southern', 'spanish', 'standard', 'turkish', 'us northeast', 'us southern', 'venezuelan',
];

// English first because that is what the ads are read in; the rest alphabetical.
const LANGUAGES = [
  'en', 'ar', 'bg', 'cs', 'da', 'de', 'el', 'es', 'fi', 'fil', 'fr', 'hi', 'hr', 'hu', 'id',
  'it', 'ja', 'ko', 'ms', 'nl', 'no', 'pl', 'pt', 'ro', 'ru', 'sk', 'sv', 'ta', 'tr', 'uk',
  'vi', 'zh',
];

const CATEGORIES = [
  { id: 'professional', label: 'professional' },
  { id: 'high_quality', label: 'high quality' },
];

// The query keys the API takes. Two of them are PLURAL and the rest are not — measured, not
// assumed, because the singular forms are accepted and then silently ignored:
//
//   descriptive=deep   -> 8 results, descriptives: deep, confident, calm, crisp   (no filter)
//   descriptives=deep  -> 8 results, descriptives: deep                           (filtered)
//   use_case=advert…   -> conversational, narrative_story                         (no filter)
//   use_cases=advert…  -> advertisement                                           (filtered)
//
// while accent, language, age, gender and category filter correctly in the singular. Getting
// this wrong costs nothing visible: the search just quietly returns the wrong voices.
const QUERY_KEYS = ['search', 'gender', 'age', 'accent', 'descriptives', 'use_cases',
                    'language', 'category', 'featured', 'page', 'page_size'];

// A shared voice comes back with thirty-odd fields, including social handles and a year of
// usage counters. These are the ones a picker actually shows.
const CARD_FIELDS = ['voice_id', 'public_owner_id', 'name', 'gender', 'age', 'accent',
                     'descriptive', 'use_case', 'language', 'category', 'description',
                     'preview_url', 'image_url', 'cloned_by_count', 'featured',
                     'free_users_allowed', 'is_added_by_user'];

module.exports = {
  GENDERS, AGES, DESCRIPTIVES, USE_CASES, ACCENTS, LANGUAGES, CATEGORIES,
  QUERY_KEYS, CARD_FIELDS,
};
