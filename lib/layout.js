'use strict';

/* layout.js - the shape of the library, and where a server-era address lives in it now.

   Next to data/ (the stores), two folders hold every file the app keeps:
     media/   what was made or brought in, one folder per kind - KINDS below;
     cache/   what is derived and made again when missing: the thumbnails /api/thumb serves,
              pose previews, voice samples, the window's browser profile, an updated yt-dlp.
   An address mirrors its folder: /media/clips/x.mp4 is <library>/media/clips/x.mp4, and /cache/
   the same. lib/media.js turns one into the other.

   A SERVER-ERA ADDRESS - /uploads/x.mp4, /characters/<folder>/x.jpg, /obrazy/... - is what a
   library from before the desktop app holds, and what its exports carry. fromLegacy() says where
   each one lives now, and it is the whole story: checked against a real server-era library, every
   one of its 13,600 media files and 9,000 stored paths lands somewhere, no two files land on the
   same name, and no server-era path is left in its stores. tools/migrate-library.js and Import
   use it; the running app never makes one.

   No config and no disk here, on purpose: the migration tool runs against a library the app has
   not opened. */

// One folder per kind of thing, under media/.
const KINDS = ['characters', 'looks', 'lookbooks', 'locations', 'references', 'images', 'clips',
  'voice', 'audio', 'hooks', 'sources', 'renders', 'projects'];

const IMAGE = /\.(jpe?g|png|webp|gif|avif|bmp)$/i;
// A video, or the loudness mark lib/loudness.js keeps beside one (x.mp4.norm).
const VIDEO = /\.(mp4|webm|mov|m4v|mkv|avi)(\.norm)?$/i;
const AUDIO = /\.(mp3|wav|m4a|aac|ogg|flac)$/i;
// Music and sound effects; every other loose sound is speech - a TTS line, or the voice track
// taken out of an avatar clip (<clip>_av.mp3).
const MUSIC = /^(suno|sfx|audio|music)[_-]/i;

// The server-era folders under uploads/ and where each went. Anything else under uploads/ is a
// loose file, placed by what it is.
const UPLOADS_SUB = {
  sources: '/media/sources/',
  clips: '/media/clips/',
  voice: '/media/voice/',
  'voice-demos': '/media/voice/demos/',
  audio: '/media/audio/',
  edit: '/media/projects/',
  faces: '/media/images/faces/',
  preview: '/media/images/preview/',
  _thumbs: '/cache/thumbs/',
  _poses: '/cache/poses/',
};

const TOP = {
  characters: '/media/characters/',
  obrazy: '/media/looks/',
  lookbooks: '/media/lookbooks/',
  environments: '/media/locations/',
  refs: '/media/references/',
  details: '/media/references/details/',
  finals: '/media/renders/',
  hooks: '/media/hooks/',
  scenes: '/media/images/scenes/',
  'voice-previews': '/cache/voice-previews/',
};

const ARCHIVE = { character: 'characters', lookbook: 'lookbooks', environment: 'locations' };

// A server-era address -> its address now, query string kept. null when it is not one.
function fromLegacy(url) {
  const m = String(url || '').match(/^\/([^/?#]+)\/([^?#]+)(.*)$/);
  if (!m) return null;
  const [, top, rest, tail] = m;
  if (TOP[top]) return TOP[top] + rest + tail;
  if (top === 'archive') {
    const [sub, ...more] = rest.split('/');
    return ARCHIVE[sub] && more.length ? `/media/${ARCHIVE[sub]}/archive/${more.join('/')}${tail}` : null;
  }
  if (top !== 'uploads') return null;

  const slash = rest.indexOf('/');
  if (slash > 0) {
    const sub = rest.slice(0, slash);
    const after = rest.slice(slash + 1);
    // uploads/thumbs/ held the thumbnails of the loose files. A video's is named <clip>_thumb.jpg
    // (lib/video-thumb.js); a picture's has the picture's own name.
    if (sub === 'thumbs') return (/_thumb\.jpe?g$/i.test(after) ? '/media/clips/thumbs/' : '/media/images/thumbs/') + after + tail;
    return UPLOADS_SUB[sub] ? UPLOADS_SUB[sub] + after + tail : null;
  }
  // A few video thumbnails sat loose beside their clip rather than in thumbs/; they stay beside it.
  if (/_thumb\.jpe?g$/i.test(rest) || VIDEO.test(rest)) return '/media/clips/' + rest + tail;
  if (IMAGE.test(rest)) return '/media/images/' + rest + tail;
  if (AUDIO.test(rest)) return (MUSIC.test(rest) ? '/media/audio/' : '/media/voice/') + rest + tail;
  return null;
}

// Server-era files that have no place in a desktop library, and why. The migration tool and Import
// both leave them out.
const LEGACY_LEFT_OUT = [
  [/^\/uploads\/_thumbs\//, 'thumbnail cache - keyed by the old absolute paths, never read again'],
  [/^\/uploads\/_poses\//, 'pose previews - made again on demand'],
  [/^\/uploads\/suno_tmp_/, 'half-finished music merge'],
  [/\.(part|tmp)$/i, 'unfinished write'],
];

// Every server-era address inside a piece of text - a stored path, or one inside a longer string. It
// ends where a query string's next parameter begins: "/api/thumb?src=/uploads/x.jpg&v=card".
const LEGACY_IN_TEXT = /\/(?:uploads|characters|obrazy|lookbooks|environments|refs|details|finals|hooks|models|scenes|archive|voice-previews)\/[^"'\s)\\<>?#&]+/g;

// Only a path that starts a string or follows a separator counts: "/api/thumb?src=/uploads/x" yes,
// "https://example.com/uploads/x" no.
const startsPath = (whole, offset) => offset === 0 || /[\s"'(=,:;[{]/.test(whole[offset - 1]);

// The text with every server-era address in it replaced by its address now. Addresses the map does
// not know are left as they were.
function rewriteLegacy(text) {
  return String(text).replace(LEGACY_IN_TEXT, (hit, offset, whole) => (startsPath(whole, offset) ? fromLegacy(hit) || hit : hit));
}

// The server-era addresses a piece of text still holds - what a check after rewriting looks for.
function legacyPathsIn(text) {
  const s = String(text);
  return [...s.matchAll(LEGACY_IN_TEXT)].filter((m) => startsPath(s, m.index)).map((m) => m[0]);
}

// Every server-era address inside a parsed store, replaced - in values and in keys alike: some
// stores are indexed by path (hook-ids.json's byPath, scen3-lookbook-meta.json). A string that IS a
// path is mapped whole, so a file name with a space in it survives; anything else is searched.
// `counter.n` counts the strings that changed.
function rewriteLegacyString(s, counter) {
  const whole = fromLegacy(s);
  if (whole) { counter.n++; return whole; }
  const next = rewriteLegacy(s);
  if (next !== s) counter.n++;
  return next;
}

function rewriteLegacyValue(v, counter = { n: 0 }) {
  if (typeof v === 'string') return rewriteLegacyString(v, counter);
  if (Array.isArray(v)) return v.map((x) => rewriteLegacyValue(x, counter));
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, x] of Object.entries(v)) out[rewriteLegacyString(k, counter)] = rewriteLegacyValue(x, counter);
    return out;
  }
  return v;
}

module.exports = { KINDS, fromLegacy, rewriteLegacy, rewriteLegacyValue, legacyPathsIn, LEGACY_LEFT_OUT };
