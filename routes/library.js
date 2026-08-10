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
  CHARACTERS_DIR, LOOKBOOKS_DIR, ENVIRONMENTS_DIR, OBRAZY_DIR, OBRAZY_FILE, DATA_DIR, ROOT_DIR,
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

// ════════════════════════════════════════════════════════════════════════════
// MUTATIONS — rename, favourite, category, delete
//
//   PATCH  /api/library/item/:kind/:id   { name?, favorite?, categoryId? }
//   DELETE /api/library/item/:kind/:id   ?files=1 to unlink the media too
//
// Ownership is the whole problem here. data/biroly.json, hooks-archive.json and
// obrazy.json are written by the BROWSER: biroly-server-sync.js and friends push
// a whole-localStorage snapshot every 2s, so a naive server-side write gets
// overwritten by the next push from any open tab.
//
// Two things make this safe:
//   - the write here is read-modify-write inside ONE request, so it cannot
//     interleave with itself;
//   - the page patches the SAME localStorage keys after a successful call, and
//     localStorage is shared by every tab of this origin. The sync loops hash
//     localStorage each tick and push only on change, so a stale tab either
//     agrees already or pushes what this endpoint just wrote. Either way nothing
//     is resurrected.
//
// `characters` is absent on purpose: the page calls /api/char-store/:id, which
// already knows to clean up the character's ElevenLabs voice on delete. Two paths
// into characters.json is exactly how a store starts drifting.
// ════════════════════════════════════════════════════════════════════════════

const { obrazAbsFolder } = require('../lib/obrazy-store');
const BIROLY_FILE = path.join(DATA_DIR, 'biroly.json');
const HOOKS_FILE  = path.join(DATA_DIR, 'hooks-archive.json');

const _write = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 2), 'utf8');

// Every path that reaches unlink() comes from a record, and a record is only as
// trustworthy as whatever wrote it. Resolve, then refuse anything that climbs out
// of the project — one '../' in a name field should not be able to delete a file.
function _absInRoot(webPath) {
  if (!webPath || typeof webPath !== 'string') return null;
  const rel = webPath.split('?')[0].replace(/^\/+/, '');
  if (!rel) return null;
  const abs = path.resolve(ROOT_DIR, rel);
  const root = path.resolve(ROOT_DIR);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  return abs;
}
function _unlink(webPath) {
  const abs = _absInRoot(webPath);
  if (!abs) return false;
  try { if (fs.existsSync(abs) && fs.statSync(abs).isFile()) { fs.unlinkSync(abs); return true; } }
  catch (e) {}
  return false;
}

// A record store: how to read its list, where the list lives inside the file, which
// fields the page may set, and which files belong to one entry.
const RECORD_STORES = {
  birols: {
    file: BIROLY_FILE, lsKey: 'biroly_archive_v1',
    read: () => { const s = _read(BIROLY_FILE, {}); return Array.isArray(s.archive) ? s.archive : []; },
    write: (list) => { const s = _read(BIROLY_FILE, {}); s.archive = list; _write(BIROLY_FILE, s); },
    fields: ['name', 'favorite', 'categoryId'],
    files: (e) => [e.videoPath, e.thumbPath],
  },
  hooks: {
    file: HOOKS_FILE, lsKey: 'hooks_archive_v1',
    read: () => { const l = _read(HOOKS_FILE, []); return Array.isArray(l) ? l : []; },
    write: (list) => _write(HOOKS_FILE, list),
    fields: ['name', 'favorite'],
    files: (e) => [e.videoPath, e.thumbPath],
  },
  obrazy: {
    file: OBRAZY_FILE, lsKey: 'obrazy',
    read: () => { const l = _read(OBRAZY_FILE, []); return Array.isArray(l) ? l : []; },
    write: (list) => _write(OBRAZY_FILE, list),
    fields: ['name'],
    // A look is a FOLDER: the look image plus its pose variations. Removing the
    // record alone would leave the folder behind, and it is the heavy part.
    //
    // The folder comes from the STORED image url first. obrazAbsFolder() rebuilds it as
    // slug(name)_shortId(id), which is only right while the record's name still matches
    // the folder it was created under — a look renamed anywhere would survive its own
    // deletion with the folder intact. The url is what the images actually load from.
    folder: (o) => {
      const url = String(o.char || '');
      const m = url.match(/^\/?obrazy\/([^/]+)\//);
      if (m) return path.join(OBRAZY_DIR, m[1]);
      try { return obrazAbsFolder(o.name || '', o.id); } catch (e) { return null; }
    },
  },
};
// Uploads are birols with a flag, so they share the store.
RECORD_STORES.uploads = RECORD_STORES.birols;

// Lookbooks and environments are not records at all — the shelf IS the directory.
// Delete-only by design: these filenames are referenced by look records (a look can
// point at a lookbook image), so renaming the file would silently break them.
const FILE_SHELVES = {
  lookbooks:    { dir: LOOKBOOKS_DIR,    url: '/lookbooks' },
  environments: { dir: ENVIRONMENTS_DIR, url: '/environments' },
};

router.patch('/library/item/:kind/:id', (req, res) => {
  try {
    const kind = String(req.params.kind || '');
    const store = RECORD_STORES[kind];
    if (!store) return res.status(400).json({ success: false, error: `"${kind}" cannot be edited here` });
    const id = String(req.params.id || '');
    const list = store.read();
    const it = list.find(x => x && String(x.id) === id);
    if (!it) return res.status(404).json({ success: false, error: 'not found' });

    const patch = {};
    for (const k of store.fields) if (k in (req.body || {})) patch[k] = req.body[k];
    if (!Object.keys(patch).length) return res.status(400).json({ success: false, error: 'nothing to set' });
    if ('name' in patch) {
      const n = String(patch.name || '').trim();
      if (!n) return res.status(400).json({ success: false, error: 'name cannot be empty' });
      patch.name = n.slice(0, 120);
    }
    if ('favorite' in patch) patch.favorite = !!patch.favorite;
    if ('categoryId' in patch) patch.categoryId = String(patch.categoryId || '');

    Object.assign(it, patch);
    store.write(list);
    // The page needs this to patch localStorage, so send back what to look for.
    res.json({ success: true, kind, id, patch, lsKey: store.lsKey });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.delete('/library/item/:kind/:id', (req, res) => {
  try {
    const kind = String(req.params.kind || '');
    const id = String(req.params.id || '');
    const withFiles = req.query.files !== '0';
    const removed = [];

    const shelf = FILE_SHELVES[kind];
    if (shelf) {
      // The id IS the filename. basename() it so nothing can walk out of the dir.
      const base = path.basename(id);
      if (!base || !IMG_RE.test(base)) return res.status(400).json({ success: false, error: 'not an image on this shelf' });
      if (!fs.existsSync(path.join(shelf.dir, base))) return res.status(404).json({ success: false, error: 'not found' });
      if (_unlink(`${shelf.url}/${base}`)) removed.push(base);
      _unlink(`${shelf.url}/thumbs/${base.replace(/\.[^.]+$/, '.jpg')}`);
      return res.json({ success: true, kind, id, removed });
    }

    const store = RECORD_STORES[kind];
    if (!store) return res.status(400).json({ success: false, error: `"${kind}" cannot be deleted here` });
    const list = store.read();
    const it = list.find(x => x && String(x.id) === id);
    if (!it) return res.status(404).json({ success: false, error: 'not found' });

    if (withFiles) {
      if (store.folder) {
        const dir = store.folder(it);
        // Same escape guard as the files: a folder outside the project is never ours.
        const root = path.resolve(ROOT_DIR);
        if (dir && path.resolve(dir).startsWith(root + path.sep) && fs.existsSync(dir)) {
          fs.rmSync(dir, { recursive: true, force: true });
          removed.push(path.basename(dir) + '/');
        }
      }
      if (store.files) for (const f of store.files(it)) if (_unlink(f)) removed.push(String(f).split('/').pop());
    }
    store.write(list.filter(x => x !== it));
    res.json({ success: true, kind, id, removed, lsKey: store.lsKey });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// A clip that is on disk but in no store is invisible, so an upload is two steps:
// POST /api/biroly/upload puts the file in uploads/ and makes its thumbnail, then this
// files it on the shelf. Same record shape the Merge uploads tab wrote — source:'upload'
// is what tells the shelf it is an upload rather than a generated birol — and unshift,
// so a clip you just added is the first card you see.
router.post('/library/media/record', (req, res) => {
  try {
    const { videoPath, thumbPath, name } = req.body || {};
    if (!videoPath || !_onDisk(videoPath)) return res.status(400).json({ success: false, error: 'videoPath must be a file that exists' });
    const store = RECORD_STORES.uploads;
    const list = store.read();
    if (list.some(e => e && e.videoPath === videoPath)) return res.status(409).json({ success: false, error: 'already on the shelf' });
    const rec = {
      id: 'lib' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: String(name || '').trim().slice(0, 120) || String(videoPath).split('/').pop(),
      prompt: '',
      source: 'upload',
      categoryId: '', categoryLabel: '',
      imagePath: thumbPath || null,
      videoPath,
      thumbPath: thumbPath || null,
      status: 'done',
      date: new Date().toISOString(),
    };
    list.unshift(rec);
    store.write(list);
    res.json({ success: true, item: rec, lsKey: store.lsKey });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// The birol categories, so the page can offer them when filing a clip. Same store
// the chips are built from, so the two lists cannot disagree.
router.get('/library/cats', (_req, res) => {
  try {
    const bir = _read(BIROLY_FILE, {});
    const cats = (Array.isArray(bir.cats) ? bir.cats : [])
      .filter(c => c && c.id)
      .map(c => ({ id: String(c.id), label: String(c.label || c.name || c.id) }));
    res.json({ success: true, cats });
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
