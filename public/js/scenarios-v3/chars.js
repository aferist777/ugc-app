// Scenarios v3 — READ-ONLY view of characters, their obrazy and the lookbook
// library. Characters stay owned by the Character tab and environments by their
// own backend; v3 never writes here, it only reads and stores chosen ids on the
// project. Mirrors the joins v2 did in _ugcLoadModels so both pages agree on
// what a character's looks are.

const _get = (url) => fetch(url).then(r => r.json()).catch(() => null);

let _chars     = null;
let _lookbooks = null;

// Thumbnail rule. The server's generateMissingThumbs writes every thumb to a
// sibling `thumbs/` folder with the extension normalised to .jpg, for EVERY media
// dir (characters, lookbooks, environments, uploads, details…). v2 only rewrote
// /uploads/ paths and therefore served full-size images for character sheets —
// a 4K sheet is megabytes against a fraction of that for its thumb, so this generalises it.
export function thumb(path) {
  if (!path) return path;
  const s = String(path);

  const hit = (_lookbooks || []).find(x => String(x && (x.path || x)) === s);
  if (hit && hit.thumbPath) return hit.thumbPath;

  const m = s.match(/^(\/[^?#]*\/)([^/?#]+)\.(jpg|jpeg|png|webp)(\?.*)?$/i);
  if (!m) return s;
  if (/\/thumbs\/$/i.test(m[1])) return s;            // already a thumb
  return `${m[1]}thumbs/${m[2]}.jpg${m[4] || ''}`;    // thumbs are always .jpg
}

// The on-demand derivative: /api/thumb makes one the first time it is asked for and caches
// it, so unlike the neighbouring-file rule above it cannot be missing. Its key carries the
// source's mtime, so a regenerated image gets a fresh derivative rather than a stale picture.
// See lib/thumbs.js for the sizes.
export const derived = (path, v) => path
  ? '/api/thumb?src=' + encodeURIComponent(String(path).split('?')[0]) + '&v=' + (v || 'frame')
  : path;

// An <img> showing the thumbnail, in three steps, each cheaper than the one it replaces:
//
//   1. the neighbouring thumbs/ file, when it is there - a plain static file, already cached
//   2. /api/thumb, which MAKES one for anything that has none
//   3. the full asset, so a picture always appears even if both of those fail
//
// Step 2 is the point of this. The rule used to be "neighbour, else the original", and the
// original is where a 4 MB frame comes from: a cropped frame, a look, a location - anything
// whose neighbour was never written - was quietly downloaded whole into a 52-pixel cell.
// Nothing announces that; it just feels slow.
//
// opts.noFit — skip the landscape letterboxing, for slots that crop on purpose
// (the character column deliberately crops the sheet to just the face).
// opts.v     — which derivative to ask for; `frame` (440px) suits every strip here.
export function thumbImg(fullPath, className, opts) {
  const img = document.createElement('img');
  if (className) img.className = className;
  img.alt = '';
  img.loading = 'lazy';

  // The slots are 3:4 portrait, but a character's 4K reference sheet is 16:9
  // (portrait + full-body turnaround side by side). Cropping that to 3:4 would
  // leave a useless sliver, so a landscape image is letterboxed instead of
  // cropped. Decided per image once it reports its real dimensions.
  if (!(opts && opts.noFit)) {
    img.addEventListener('load', () => {
      if (img.naturalWidth > img.naturalHeight) img.classList.add('sv3-fit');
    });
  }

  const v = (opts && opts.v) || 'frame';
  const chain = [thumb(fullPath), derived(fullPath, v), fullPath]
    .filter((x, i, a) => x && a.indexOf(x) === i);
  let step = 0;
  img.src = chain[step];
  img.addEventListener('error', function next() {
    if (++step >= chain.length) return;
    img.dataset.fellBack = String(step);
    img.src = chain[step];
    if (step < chain.length - 1) img.addEventListener('error', next, { once: true });
  }, { once: true });
  return img;
}

// Which image represents an obraz. v2 prefers a server-computed earliest-mtime
// map, then obraz.char, then the first usable variation / pool file.
function _obrazMain(o, mainMap) {
  const cached = mainMap && mainMap[String(o.id)];
  if (cached) return cached;
  if (typeof o.char === 'string' && o.char) return o.char;
  const v = (Array.isArray(o.variations) ? o.variations : []).find(x => typeof x === 'string' && x && x !== 'error');
  if (v) return v;
  const p = (Array.isArray(o.pool) ? o.pool : []).map(x => x && x.file).find(Boolean);
  return p || '';
}

export async function loadCharacters(force) {
  if (_chars && !force) return _chars;

  const [cd, od, md, sd] = await Promise.all([
    _get('/api/char-store/list'),
    _get('/api/userdata/obrazy'),
    _get('/api/obrazy/main-images'),
    // WHO IS ACTUALLY ON THE SHELF. The character store answers with every record that is
    // not a draft, including ones whose reference sheet was never made or has since been
    // deleted - on real data, four of forty-six. The Library shows none of those, because it
    // checks the file is on disk, and a character you cannot see in the Library is not one
    // anybody can cast. This list is the same question, asked of the same place.
    _get('/api/library/shelf/characters'),
  ]);
  const chars   = (cd && cd.chars) || [];
  const obrazy  = (od && od.list)  || [];
  const mainMap = (md && md.mainImages) || {};
  // Fails OPEN: if the shelf cannot be read, everybody is shown rather than nobody. A column
  // that empties itself because one request failed is worse than one that shows too much.
  const shelf = (sd && Array.isArray(sd.items)) ? new Set(sd.items.map(x => String(x.id))) : null;

  // group obrazy under their character, newest first (ids are timestamps)
  const byChar = {};
  obrazy.forEach(o => {
    const cid = String(o.charId || '');
    if (!cid || cid === 'null') return;          // orphans belong to no character
    const main = _obrazMain(o, mainMap);
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
    sheet:  c.sheet || c.tpose || '',
    // The PORTRAIT this character was built from. A sheet is three full bodies side by side
    // in 16:9, so at thumbnail size it is a strip of three tiny people and no face at all -
    // which is the one thing you are looking for when picking who to cast. Not everyone has
    // one, so the sheet remains the fallback.
    face:   c.baseFace || '',
    obrazy: byChar[String(c.id)] || [],
  }));
  return _chars;
}

export async function loadLookbooks(force) {
  if (_lookbooks && !force) return _lookbooks;
  const d = await _get('/api/gallery/lookbooks');
  _lookbooks = (d && d.files) || [];
  return _lookbooks;
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
