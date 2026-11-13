// A READ-ONLY view of characters and their looks (obrazy), shared by every page that casts one: the
// talking-head workshop in Merge and the Library.
//
// Characters are written by the Library's Characters shelf and environments by their own backend; nothing
// here writes. What a page does with a choice is store an id on its project. The joins are the
// ones v2 did in _ugcLoadModels, in one place, so two pages cannot disagree about what a
// character's looks are.

const _get = (url) => fetch(url).then(r => r.json()).catch(() => null);

let _chars = null;

// The on-demand derivative: /api/thumb makes one the first time it is asked for and caches
// it, so it cannot be missing. Its key carries the
// source's mtime, so a regenerated image gets a fresh derivative rather than a stale picture.
// See lib/thumbs.js for the sizes.
export const derived = (path, v) => path
  ? '/api/thumb?src=' + encodeURIComponent(String(path).split('?')[0]) + '&v=' + (v || 'frame')
  : path;

// Which image represents an obraz: the one chosen for it (`char`) - the picture the Library shows, by the Library's own
// answer (`looks`: routes/library.js _looks - the chosen picture, on disk). A look the Library does not show is not
// offered either. Fails OPEN like the characters below: without that answer, the chosen picture as the record says.
function _obrazMain(o, looks) {
  if (looks) return looks.get(String(o.id)) || '';
  return (typeof o.char === 'string' && o.char) ? o.char : '';
}

export async function loadCharacters(force) {
  if (_chars && !force) return _chars;

  const [cd, od, ld, sd] = await Promise.all([
    _get('/api/char-store/list'),
    _get('/api/userdata/obrazy'),
    _get('/api/library/shelf/looks'),
    // WHO IS ACTUALLY ON THE SHELF. The character store answers with every record that is
    // not a draft, including ones whose reference sheet was never made or has since been
    // deleted - on real data, four of forty-six. The Library shows none of those, because it
    // checks the file is on disk, and a character you cannot see in the Library is not one
    // anybody can cast. This list is the same question, asked of the same place.
    _get('/api/library/shelf/characters'),
  ]);
  const chars   = (cd && cd.chars) || [];
  const obrazy  = (od && od.list)  || [];
  const looks = (ld && Array.isArray(ld.items)) ? new Map(ld.items.map(x => [String(x.id), String(x.media || '')])) : null;
  // Fails OPEN: if the shelf cannot be read, everybody is shown rather than nobody. A column
  // that empties itself because one request failed is worse than one that shows too much.
  const shelf = (sd && Array.isArray(sd.items)) ? new Set(sd.items.map(x => String(x.id))) : null;

  // group obrazy under their character, newest first (ids are timestamps)
  const byChar = {};
  obrazy.forEach(o => {
    const cid = String(o.charId || '');
    if (!cid || cid === 'null') return;          // orphans belong to no character
    const main = _obrazMain(o, looks);
    if (!main) return;
    const photos = Array.from(new Set([]
      .concat((Array.isArray(o.pool) ? o.pool : []).map(p => p && p.file).filter(Boolean))
      .concat(Array.isArray(o.variations) ? o.variations.filter(v => v && v !== 'error') : [])
      .concat(o.char ? [o.char] : [])));
    (byChar[cid] || (byChar[cid] = [])).push({
      id: String(o.id), name: String(o.name || ''), image: main, photos, ts: Number(o.id) || 0,
    });
  });
  Object.keys(byChar).forEach(cid => byChar[cid].sort((a, b) => b.ts - a.ts));

  _chars = chars.filter(c => !shelf || shelf.has(String(c.id))).map(c => ({
    id:     String(c.id),
    name:   String(c.name || 'unnamed'),
    gender: String(c.gender || '').toLowerCase(),
    // the combined 4K reference sheet — the base image dressing targets
    sheet:  c.sheet || '',
    // The PORTRAIT this character was built from. A sheet is three full bodies side by side
    // in 16:9, so at thumbnail size it is a strip of three tiny people and no face at all -
    // which is the one thing you are looking for when picking who to cast. Not everyone has
    // one, so the sheet remains the fallback.
    face:   c.baseFace || '',
    // THE VOICE they are read in, and every voice they have. Kept here because the workshop's
    // voice level (js/merge-v3/wk-voice.js) asks the same question this store already answers for
    // looks: what does this character come with. Read-only like the rest - it is the Character
    // page's endpoint that writes them, and this copy is updated from what that endpoint returns.
    voice:  c.voice || '',
    voices: Array.isArray(c.voices) ? c.voices : [],
    obrazy: byChar[String(c.id)] || [],
  }));
  return _chars;
}

// Most looks first, which is the order the Library already uses and the one that matches
// what each row says about itself. A character you have dressed twenty times is the one you
// are casting again; a character with none cannot be cast at all and belongs at the bottom.
// Ids are timestamps, so the newer of two equals comes first.
export function byLooks(chars) {
  return chars.slice().sort((a, b) =>
    (b.obrazy.length - a.obrazy.length)
    || ((Number(b.id) || 0) - (Number(a.id) || 0))
    || String(a.name).localeCompare(String(b.name)));
}

// Gender lock: filter when the project states a gender, show everyone when it
// does not (legacy scenarios saved before gender became mandatory).
export function filterByGender(chars, gender) {
  const g = String(gender || '').toLowerCase();
  if (!g) return chars;
  return chars.filter(c => c.gender === g);
}
