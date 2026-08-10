'use strict';

// ════════════════════════════════════════════════════════════════════════════
// LIBRARY — one endpoint per shelf, one shape for every kind.
//
//   GET /api/library/shelf/:kind        kind: characters | lookbooks |
//                                             environments | media
//   GET /api/library/looks/:charId      the looks of one character
//   GET /api/library/counts             one number per shelf, for the switcher
//   -> { items: [{ id, name, kind, media, thumb, meta }], total, filters, cats }
//
// `thumb` is what the grid draws and `media` is what the viewer opens. They are
// never the same file unless no thumbnail exists — the old shelf drew full frames
// and even whole videos into 72px cards, which is the mistake this shape prevents.
//
// `filters` and `cats` are what the page's filter rows offer for that shelf: for
// Media the kind (birols / uploads / hooks) and then the birol category. The server
// sends them because only the server knows what is actually in the data.
//
// Looks are not a shelf: they belong to a character and show beside it.
//
// Reads the same stores the popup read; it owns none of them and writes nothing.
// ════════════════════════════════════════════════════════════════════════════

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const router  = express.Router();

const {
  CHARACTERS_DIR, LOOKBOOKS_DIR, ENVIRONMENTS_DIR, OBRAZY_DIR, DATA_DIR, ROOT_DIR,
} = require('../lib/config');

const IMG_RE = /\.(jpg|jpeg|png|webp)$/i;
const _read = (f, fallback) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return fallback; } };

// Record stores can outlive their files (a clip deleted from disk, a look whose folder
// went). Such an entry would draw a broken card, so a shelf built from records checks
// the file first. The asset shelves are built FROM the directory, so they cannot drift.
const _onDisk = (webPath) => {
  if (!webPath) return false;
  try { return fs.existsSync(path.join(ROOT_DIR, String(webPath).split('?')[0].replace(/^\/+/, ''))); }
  catch (e) { return false; }
};
// The chip for birols that were never filed under a category.
const UNCAT = '__uncat__';

// ── Asset shelves (characters / lookbooks / environments) ───────────────────
// Flat image dirs with a thumbs/ subdir. Newest first, which is how the popup
// listed them and how you actually look for something you just made.
function _imageShelf(dir, urlPrefix, kind) {
  let files = [];
  try { files = fs.readdirSync(dir).filter(f => IMG_RE.test(f)); } catch (e) { return []; }
  if (kind === 'characters') files = files.filter(f => !f.startsWith('posevar'));   // pose variations are not saved characters
  return files
    .map(f => ({ f, m: (() => { try { return fs.statSync(path.join(dir, f)).mtimeMs; } catch (e) { return 0; } })() }))
    .sort((a, b) => b.m - a.m)
    .map(({ f, m }) => {
      const thumbName = f.replace(/\.[^.]+$/, '') + '.jpg';
      const hasThumb = fs.existsSync(path.join(dir, 'thumbs', thumbName));
      return {
        id: f,
        name: f.replace(/\.[^.]+$/, ''),
        kind,
        media: `${urlPrefix}/${f}`,
        thumb: hasThumb ? `${urlPrefix}/thumbs/${thumbName}` : null,
        meta: { date: m ? new Date(m).toISOString() : null },
      };
    });
}

// ── Characters ──────────────────────────────────────────────────────────────
// The shelf is the character RECORDS, not the loose files in characters/: a card has
// to be selectable so its looks can show beside it, and only a record knows its looks.
function _charactersShelf() {
  const chars = _read(path.join(DATA_DIR, 'characters.json'), []);
  const looks = _looks().items;
  const perChar = {};
  looks.forEach(l => { const k = l.meta.charId; perChar[k] = (perChar[k] || 0) + 1; });

  const items = (Array.isArray(chars) ? chars : []).filter(Boolean).map(c => {
    const sheet = String(c.sheet || c.baseFace || '');
    const thumb = sheet ? sheet.replace(/\/([^/]+)$/, '/thumbs/$1').replace(/\.[^.]+$/, '.jpg') : '';
    return {
      id: String(c.id),
      name: String(c.name || '').trim() || 'character',
      kind: 'characters',
      media: sheet || null,
      thumb: (thumb && _onDisk(thumb)) ? thumb : (sheet || null),
      meta: {
        gender: String(c.gender || ''),
        looks: perChar[String(c.id)] || 0,
        voices: Array.isArray(c.voices) ? c.voices.length : 0,
        date: c.date || null,
      },
    };
  }).filter(x => x.media && _onDisk(x.media));
  return { items, filters: [] };
}

// ── Looks ───────────────────────────────────────────────────────────────────
// Not a shelf of its own any more: looks belong to a character and show beside it.
function _looks() {
  const list = _read(path.join(DATA_DIR, 'obrazy.json'), []);
  const arr = Array.isArray(list) ? list : (list.obrazy || Object.values(list || {}));
  const chars = _read(path.join(DATA_DIR, 'characters.json'), []);
  const charName = {};
  (Array.isArray(chars) ? chars : []).forEach(c => { if (c && c.id != null) charName[String(c.id)] = String(c.name || ''); });

  const items = arr.filter(Boolean).map(o => {
    const main = String(o.char || '');
    // A look's folder holds the look image plus its pose variations; the look image is
    // small enough to draw directly, so thumb and media differ only when a thumb exists.
    const thumb = main ? main.replace(/\/([^/]+)$/, '/thumbs/$1').replace(/\.[^.]+$/, '.jpg') : '';
    const thumbAbs = thumb ? path.join(ROOT_DIR, thumb.replace(/^\/+/, '')) : '';
    const known = o.charId != null && charName[String(o.charId)];
    return {
      id: String(o.id),
      name: String(o.name || '').trim() || 'look',
      kind: 'obrazy',
      media: main || null,
      thumb: (thumbAbs && fs.existsSync(thumbAbs)) ? thumb : (main || null),
      meta: {
        charId: known ? String(o.charId) : '',
        character: known ? charName[String(o.charId)] : '',
        gender: String(o.gender || ''),
        variations: Array.isArray(o.variations) ? o.variations.length : 0,
        date: o.date || null,
      },
    };
  }).filter(x => x.media && _onDisk(x.media) && x.meta.charId);
  return { items };
}

// ── Media (birols + uploads + hooks) ────────────────────────────────────────
// Birols and uploads live in one archive, split by a flag the client sets; hooks
// have their own. One shelf, three filters — they are all "a clip on a shelf".
const UPLOADS_CAT = '__uploads__';
const _isUpload = (it) => !!(it && (it.source === 'upload' || it.categoryId === UPLOADS_CAT));

function _mediaShelf() {
  const bir = _read(path.join(DATA_DIR, 'biroly.json'), { archive: [] });
  const arch = Array.isArray(bir.archive) ? bir.archive : [];
  const hooks = _read(path.join(DATA_DIR, 'hooks-archive.json'), []);

  const fromArchive = arch.filter(e => e && e.videoPath).map(e => ({
    id: String(e.id),
    name: String(e.name || '').trim() || 'clip',
    kind: _isUpload(e) ? 'uploads' : 'birols',
    media: e.videoPath,
    thumb: e.thumbPath || null,
    meta: { categoryId: e.categoryId || '', date: e.date || null, favorite: !!e.favorite },
  }));
  const fromHooks = (Array.isArray(hooks) ? hooks : []).filter(h => h && h.videoPath).map((h, i) => ({
    id: String(h.id || ('hook:' + i)),
    name: String(h.name || '').trim() || 'hook',
    kind: 'hooks',
    media: h.videoPath,
    thumb: h.thumbPath || null,
    meta: { date: h.date || null },
  }));

  const items = fromArchive.concat(fromHooks).filter(i => _onDisk(i.media));
  const n = (k) => items.filter(i => i.kind === k).length;
  // Birols were always organised by category, so the categories come along as a second
  // row of chips — the kind chips say WHAT a clip is, these say what it is about. Only
  // categories that actually hold something are offered.
  const catLabel = {};
  (Array.isArray(bir.cats) ? bir.cats : []).forEach(c => { if (c && c.id) catLabel[String(c.id)] = String(c.label || c.name || c.id); });
  const catCount = {};
  items.forEach(i => { const c = (i.meta || {}).categoryId; if (c && c !== UPLOADS_CAT) catCount[c] = (catCount[c] || 0) + 1; });
  const cats = Object.keys(catCount)
    .sort((a, b) => catCount[b] - catCount[a])
    .map(id => ({ id, label: (catLabel[id] || id) + ' · ' + catCount[id] }));
  const uncat = items.filter(i => i.kind === 'birols' && !(i.meta || {}).categoryId).length;
  if (uncat) cats.push({ id: UNCAT, label: 'Uncategorized · ' + uncat });

  return {
    items,
    filters: [
      { id: 'birols',  label: 'Birols · ' + n('birols') },
      { id: 'uploads', label: 'Uploads · ' + n('uploads') },
      { id: 'hooks',   label: 'Hooks · ' + n('hooks') },
    ],
    cats,
  };
}

const SHELVES = {
  characters:   _charactersShelf,
  lookbooks:    () => ({ items: _imageShelf(LOOKBOOKS_DIR, '/lookbooks', 'lookbooks'), filters: [] }),
  environments: () => ({ items: _imageShelf(ENVIRONMENTS_DIR, '/environments', 'environments'), filters: [] }),
  media:        _mediaShelf,
};

router.get('/library/shelf/:kind', (req, res) => {
  try {
    const kind = String(req.params.kind || '');
    const build = SHELVES[kind];
    if (!build) return res.status(404).json({ success: false, error: `no shelf "${kind}"` });
    const { items, filters, cats } = build();
    // Filtering happens here rather than in the page, so the count the page shows is the
    // count it received. Media takes two: the kind, and the category within it.
    const f = String(req.query.filter || '');
    const cat = String(req.query.cat || '');
    let shown = items;
    if (f) shown = shown.filter(i => i.kind === f);
    if (cat) shown = shown.filter(i => cat === UNCAT
      ? !(i.meta || {}).categoryId
      : (i.meta || {}).categoryId === cat);
    res.json({ success: true, kind, items: shown, total: items.length, shown: shown.length,
      filters: filters || [], cats: cats || [] });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// A character's looks, for the pane beside the Characters grid.
router.get('/library/looks/:charId', (req, res) => {
  try {
    const id = String(req.params.charId || '');
    const items = _looks().items.filter(l => l.meta.charId === id);
    res.json({ success: true, charId: id, items, total: items.length });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Counts for every shelf at once, for the switcher — cheap enough to do on load and
// it means the page never shows a shelf without saying how much is in it.
router.get('/library/counts', (_req, res) => {
  try {
    const out = {};
    for (const [kind, build] of Object.entries(SHELVES)) {
      try { out[kind] = build().items.length; } catch (e) { out[kind] = 0; }
    }
    res.json({ success: true, counts: out });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

module.exports = router;
