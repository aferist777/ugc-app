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
  FINALS_DIR,
} = require('../lib/config');
const LC = require('../lib/library-cats');
const VS = require('../lib/voice-shelf');
const VT = require('../lib/video-thumb');
const IMG = require('../lib/images-store');

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

// Sort key for a date that may be missing. Not `Date.parse(d || 0)`: that coerces 0 to
// the string "0", which V8 reads as the year 2000 — a record with no date would sort
// into the middle of the shelf instead of the end.
const _ts = (d) => { const t = d ? Date.parse(d) : NaN; return isNaN(t) ? 0 : t; };

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

  // Drafts are not characters yet, so they belong on no shelf - not here and not in the Library.
  // They leaked in for two reasons at once: this is a SECOND reader of characters.json and knew
  // nothing about the flag, and the media fallback below accepts `baseFace` when there is no
  // sheet - which is exactly the shape a draft has, so it passed the on-disk check and looked
  // finished. char-store's own list has always filtered them; this one now agrees with it.
  const items = (Array.isArray(chars) ? chars : []).filter(Boolean).filter(c => !c.draft).map(c => {
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
  // By looks, most first: the characters you have actually dressed are the ones you come
  // back to, and a character with none is a card you scroll past. Date breaks the ties.
  items.sort((a, b) => (b.meta.looks - a.meta.looks) || (_ts(b.meta.date) - _ts(a.meta.date)));
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
    // The archive has known how long each clip is since it was generated. Sending it lets a
    // drop onto a Merge lane land at the right width straight away, instead of appearing at
    // a placeholder length and resizing a moment later once the browser has read the file.
    dur: +e.duration || 0,
    meta: { categoryId: e.categoryId || '', date: e.date || null, favorite: !!e.favorite },
  }));
  const fromHooks = (Array.isArray(hooks) ? hooks : []).filter(h => h && h.videoPath).map((h, i) => ({
    id: String(h.id || ('hook:' + i)),
    name: String(h.name || '').trim() || 'hook',
    kind: 'hooks',
    media: h.videoPath,
    thumb: h.thumbPath || null,
    // `favorite` and `categoryId` are read back here on purpose: the star and the category
    // dropdown write them, so leaving either out would let you set it and see no change.
    // Hook records already carried a category — public/js/scen-hooks.js has always written
    // categoryId/categoryLabel — so this reads existing data, it does not invent a field.
    // Hook records have never carried a duration; 0 means "ask the file", which is what
    // the timeline falls back to.
    dur: +h.duration || 0,
    meta: { categoryId: h.categoryId || '', date: h.date || null, favorite: !!h.favorite },
  }));

  const items = fromArchive.concat(fromHooks).filter(i => _onDisk(i.media));
  // Favourites first, newest first after that. A starred clip is one you keep reaching
  // for, so it belongs at the top left rather than wherever its date puts it.
  items.sort((a, b) => (Number(!!b.meta.favorite) - Number(!!a.meta.favorite))
    || (_ts(b.meta.date) - _ts(a.meta.date)));
  const n = (k) => items.filter(i => i.kind === k).length;

  // A record's own categoryLabel, for an id no list knows about — see listFor()'s orphan
  // note. Reading it from the record is the only way to name such a chip.
  const fromRecords = {};
  for (const e of arch.concat(Array.isArray(hooks) ? hooks : [])) {
    if (e && e.categoryId && e.categoryLabel && !fromRecords[e.categoryId]) fromRecords[e.categoryId] = String(e.categoryLabel);
  }

  return {
    items,
    filters: [
      { id: 'birols',  label: 'Birols · ' + n('birols') },
      { id: 'uploads', label: 'Uploads · ' + n('uploads') },
      { id: 'hooks',   label: 'Hooks · ' + n('hooks') },
    ],
    // The chips depend on WHICH kind is open, and only the route handler knows that, so the
    // shelf hands back the ingredients instead of a finished row.
    labelFor: (id) => fromRecords[id] || '',
  };
}

// The chip row for the media shelf. `kind` is the open kind filter, or '' for All.
//
// Counts are scoped to that kind, so the number on a chip is exactly what clicking it
// yields — and, since deleting a category acts on the same scope, exactly what a delete
// would affect. Uncategorized is pinned first (the page puts All to its left) because it is
// furniture rather than a category: it cannot be renamed, reordered or deleted.
function _mediaCats(items, kind, labelFor) {
  const scope = kind ? items.filter(i => i.kind === kind) : items;
  const counts = {};
  for (const i of scope) {
    const c = (i.meta || {}).categoryId;
    if (c && c !== UPLOADS_CAT) counts[c] = (counts[c] || 0) + 1;
  }
  const uncat = scope.filter(i => !(i.meta || {}).categoryId).length;
  const cats = LC.listFor(kind || null, counts, labelFor).map(c => ({
    id: c.id,
    label: c.label + ' · ' + c.count,
    name: c.label,          // the bare name, for the rename box and the dropdowns
    own: c.own,
    orphan: c.orphan,
    catKind: c.kind,        // which list owns it, so a rename knows what it is editing
    count: c.count,
  }));
  return [{ id: UNCAT, label: 'Uncategorized · ' + uncat, name: 'Uncategorized', pinned: true, count: uncat }].concat(cats);
}

// ── Images ──────────────────────────────────────────────────────────────────
// Still pictures: brought in, screenshotted off the preview, or generated. Its own shelf
// rather than a fourth kind on the media shelf - a picture is not a clip, and the two answer
// different questions ("what can I lay on the timeline" vs "what can I animate").
//
// The item shape is the media shelf's, field for field, so the card, the star, the category
// dropdown and the delete path are the same code. Two things differ, both because it is a
// picture: `thumb` goes through /api/thumb rather than a stored path - the original can be a
// 4K screenshot and no grid should ever load one - and `dur` is 0, since a still has no length
// of its own. The 10s a dropped image gets on the timeline is the timeline's decision.
function _imagesShelf() {
  const items = IMG.read().filter(e => e && e.imagePath && _onDisk(e.imagePath)).map(e => ({
    id: String(e.id),
    name: String(e.name || '').trim() || 'image',
    kind: 'images',
    media: e.imagePath,
    thumb: '/api/thumb?src=' + encodeURIComponent(e.imagePath) + '&v=card',
    dur: 0,
    // w/h/alpha ride along for Ф4: a cutout is placed over the frame, a solid picture fills it.
    meta: {
      categoryId: e.categoryId || '', date: e.date || null, favorite: !!e.favorite,
      w: +e.w || 0, h: +e.h || 0, alpha: !!e.alpha, source: e.source || 'upload',
    },
  }));
  items.sort((a, b) => (Number(!!b.meta.favorite) - Number(!!a.meta.favorite))
    || (_ts(b.meta.date) - _ts(a.meta.date)));

  const fromRecords = {};
  for (const e of IMG.read()) {
    if (e && e.categoryId && e.categoryLabel && !fromRecords[e.categoryId]) fromRecords[e.categoryId] = String(e.categoryLabel);
  }
  // No kind filters: the shelf is one kind. Categories do the dividing here.
  return { items, filters: [], labelFor: (id) => fromRecords[id] || '' };
}

// ── Voices ──────────────────────────────────────────────────────────────────
// Every voice we have taken that has our own demo on disk. The demo is the point: a
// voice can be released from the ElevenLabs account to free a slot, and after that the
// mp3 here is the only way left to hear it.
//
// WHO USES A VOICE IS COMPUTED, never stored. The shelf entry knows nothing about
// characters; this reads characters.json and turns it inside out. A stored copy would be
// a second answer to the same question and would go stale the first time a voice was
// unbound - the same mistake the drafts leak was.
//
// `thumb` is null on purpose. A voice has no picture, so the page draws rows for this
// shelf instead of cards; the pictures in the info column are the CHARACTERS' sheets,
// through the 20kB card variant of the thumbnail door.
function _voicesShelf() {
  const shelf = VS.read();
  const chars = _read(path.join(DATA_DIR, 'characters.json'), []);
  const arr = (Array.isArray(chars) ? chars : []).filter(Boolean).filter(c => !c.draft);

  const users = {};
  for (const c of arr) {
    // `voice` is the one id every read uses and `voices` is the set they were taken from,
    // so a character counts as a user of either. A voice listed twice is still one use.
    const ids = new Set();
    if (c.voice) ids.add(String(c.voice));
    for (const v of (Array.isArray(c.voices) ? c.voices : [])) if (v && v.voiceId) ids.add(String(v.voiceId));
    if (!ids.size) continue;
    const sheet = String(c.sheet || c.baseFace || '');
    const who = {
      id: String(c.id),
      name: String(c.name || '').trim() || 'character',
      gender: String(c.gender || ''),
      sheet: (sheet && _onDisk(sheet)) ? sheet : null,
      thumb: (sheet && _onDisk(sheet)) ? '/api/thumb?src=' + encodeURIComponent(sheet) + '&v=card' : null,
    };
    for (const id of ids) {
      (users[id] = users[id] || []).push({ ...who, gold: String(c.voice || '') === id });
    }
  }

  const items = shelf.filter(e => e && e.voiceId && e.demo && _onDisk(e.demo)).map(e => {
    const id = String(e.voiceId);
    return {
      id,
      name: String(e.name || '').trim() || id,
      kind: 'voices',
      media: e.demo,                 // our own demo - what the play button plays
      thumb: null,
      meta: {
        voiceId: id,
        category: String(e.category || ''),
        description: String(e.description || ''),
        labels: e.labels || {},
        verifiedLanguages: e.verifiedLanguages || 0,
        dur: e.dur || 0,
        publicOwnerId: String(e.publicOwnerId || ''),
        // Whether the slot is still ours. `accountRemoved` is written when one is released.
        accountRemoved: !!e.accountRemoved,
        characters: users[id] || [],
        fromCharName: String(e.fromCharName || ''),
        date: e.date || null,
      },
    };
  });
  // In use first: a voice somebody speaks with is the one you came here to find. Then by
  // name, so the free ones underneath read as a catalogue rather than an arrival order.
  items.sort((a, b) => (b.meta.characters.length ? 1 : 0) - (a.meta.characters.length ? 1 : 0)
    || a.name.localeCompare(b.name));
  return { items, filters: [], labelKeys: VS.LABEL_KEYS };
}

// ── Renders ─────────────────────────────────────────────────────────────────
// The shelf IS the finals/ directory. No record store behind it, and that is deliberate:
// a render is kept by its file existing. The export flow deletes the file when you press
// Cancel on the preview, so "kept" and "on the shelf" cannot drift apart.
const VID_RE = /\.(mp4|mov|webm|mkv)$/i;

function _rendersShelf() {
  const dir = FINALS_DIR;
  let files = [];
  try { files = fs.readdirSync(dir).filter(f => VID_RE.test(f)); } catch (e) { return { items: [], filters: [] }; }
  const items = files
    .map(f => ({ f, m: (() => { try { return fs.statSync(path.join(dir, f)).mtimeMs; } catch (e) { return 0; } })() }))
    .sort((a, b) => b.m - a.m)
    .map(({ f, m }) => {
      const turl = VT.thumbUrlFor('/finals/' + f);
      const tabs = path.join(ROOT_DIR, String(turl).replace(/^\/+/, ''));
      const hasThumb = fs.existsSync(tabs);
      return {
        id: f,
        // The output name is `local_<stamp>_<project title>.mp4`; the stamp is noise on a
        // card, and the date is already a column.
        name: f.replace(/\.[^.]+$/, '').replace(/^local_\d+_/, ''),
        kind: 'renders',
        media: '/finals/' + f,
        thumb: hasThumb ? turl : null,
        meta: { date: m ? new Date(m).toISOString() : null, sizeMb: (() => {
          try { return Math.round(fs.statSync(path.join(dir, f)).size / 1048576); } catch (e) { return null; }
        })(),
        // A MISSING POSTER MEANS THE FILE IS UNREADABLE, and it is worth saying so. Every
        // render that ffmpeg can open has a poster: the export flow makes one when the render
        // is kept, and the backlog was filled in. What is left without one is a truncated mp4 -
        // a render interrupted before its moov index was written - which no player can open.
        // Cheap on purpose: proving it by reading 56 files on every shelf read would not be.
        unreadable: !hasThumb },
      };
    });
  return { items, filters: [] };
}

// ── Scenarios ───────────────────────────────────────────────────────────────
// The one shelf whose contents are TEXT. A scenario is a title, a handful of fields and a line
// count - there is nothing to make a thumbnail of - so it is drawn as rows (see
// js/library/scenarios.js), the same choice the voices shelf made for the same reason.
//
// Read straight from the store rather than through /api/scen3: the shelf needs the summaries
// the list endpoint already builds, and going out through HTTP to reach our own process to read
// a file we can read here would only add a way for it to fail.
const SCEN3_FILE = path.join(DATA_DIR, 'scen3-scenarios.json');

function _scenariosShelf() {
  const list = _read(SCEN3_FILE, []);
  const items = (Array.isArray(list) ? list : [])
    .slice()
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    .map(s => ({
      id: String(s.id),
      name: s.title || 'untitled',
      kind: 'scenarios',
      media: null,
      thumb: null,
      meta: {
        type: s.type || '', vertical: s.vertical || '', product: s.product || '',
        // roles are records - {id, name, gender} - so the row reads their names, with the
        // gender in brackets because "doctor" and "doctor" are two different castings.
        roles: (Array.isArray(s.roles) ? s.roles : [])
          .map(r => (r && r.name ? r.name + (r.gender ? ' (' + String(r.gender)[0] + ')' : '') : ''))
          .filter(Boolean).join(', '),
        lines: Array.isArray(s.lines) ? s.lines.length : 0,
        date: s.updatedAt || s.createdAt || null,
        createdAt: s.createdAt || null,
      },
    }));
  return { items, filters: [] };
}

// The Suno tracks, the same file the Merge music panel reads and writes - not a copy of
// it. A track is made in one place and listened to in another, and two lists would be two
// answers to "what music is there".
function _musicShelf() {
  const list = _read(path.join(DATA_DIR, 'suno-lib.json'), []);
  const items = (Array.isArray(list) ? list : [])
    .filter(t => t && t.audioPath)
    .map(t => ({
      id: String(t.id || t.audioPath),
      name: String(t.title || 'track'),
      kind: 'music',
      media: String(t.audioPath),
      // No picture to show. The row draws its own, and a card grid would be thirty
      // identical grey squares.
      thumb: null,
      meta: {
        style: String(t.style || ''),
        date: t.createdAt || null,
        onDisk: _onDisk(String(t.audioPath)),
      },
    }));
  return { items, filters: [] };
}

const SHELVES = {
  characters:   _charactersShelf,
  lookbooks:    () => ({ items: _imageShelf(LOOKBOOKS_DIR, '/lookbooks', 'lookbooks'), filters: [] }),
  environments: () => ({ items: _imageShelf(ENVIRONMENTS_DIR, '/environments', 'environments'), filters: [] }),
  media:        _mediaShelf,
  images:       _imagesShelf,
  voices:       _voicesShelf,
  music:        _musicShelf,
  renders:      _rendersShelf,
  scenarios:    _scenariosShelf,
};

router.get('/library/shelf/:kind', (req, res) => {
  try {
    const kind = String(req.params.kind || '');
    const build = SHELVES[kind];
    if (!build) return res.status(404).json({ success: false, error: `no shelf "${kind}"` });
    const { items, filters, labelFor, labelKeys } = build();
    // Filtering happens here rather than in the page, so the count the page shows is the
    // count it received. Media takes two: the kind, and the category within it.
    const f = String(req.query.filter || '');
    const cat = String(req.query.cat || '');
    // Built from the kind but BEFORE the category filter, so choosing a category does not
    // make every other chip read 0.
    // Images take the same chip row. The kind passed in is the shelf's own, not the filter:
    // that shelf has no kind filters, so its categories are always scoped to images.
    const cats = kind === 'media' ? _mediaCats(items, f, labelFor)
      : kind === 'images' ? _mediaCats(items, 'images', labelFor) : [];
    let shown = items;
    if (f) shown = shown.filter(i => i.kind === f);
    if (cat) shown = shown.filter(i => cat === UNCAT
      ? !(i.meta || {}).categoryId
      : (i.meta || {}).categoryId === cat);
    res.json({ success: true, kind, items: shown, total: items.length, shown: shown.length,
      filters: filters || [], cats, labelKeys: labelKeys || null });
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

// Every path any SURVIVING record points at, across both media stores. `doomed` is the set of
// record ids about to go, so their own paths do not count as keeping a file alive.
//
// This exists because a file can be shared. Real data has 81 pairs of archive records — the
// residue of a restore that ran twice — pointing at one video and one thumbnail each, so
// deleting one card unlinked the file the OTHER card was still showing: its video vanished
// and the card dropped out on the next load as broken. Deleting a record is a statement about
// the record, not about a file someone else is using.
function _pathsInUse(doomed) {
  const skip = new Set((doomed || []).map(String));
  const used = new Set();
  for (const kind of ['birols', 'hooks']) {           // birols and uploads are one file
    let list = [];
    try { list = RECORD_STORES[kind].read(); } catch (e) { continue; }
    for (const e of list) {
      if (!e || skip.has(String(e.id))) continue;
      for (const p of [e.videoPath, e.thumbPath, e.imagePath]) if (p) used.add(String(p).split('?')[0]);
    }
  }
  return used;
}

// Unlink only what nothing else needs. Reports what actually went and what was spared, so the
// page can say "the clip is gone" without claiming a file was removed when it was not.
function _unlinkUnused(paths, doomed) {
  const used = _pathsInUse(doomed);
  const removed = [], kept = [];
  for (const p of (paths || [])) {
    if (!p) continue;
    const clean = String(p).split('?')[0];
    if (used.has(clean)) { kept.push(clean.split('/').pop()); continue; }
    if (_unlink(p)) removed.push(clean.split('/').pop());
  }
  return { removed, kept };
}

// A record store: how to read its list, where the list lives inside the file, which
// fields the page may set, and which files belong to one entry.
// `thumbPath` is patchable for the same reason the rest of this goes through PATCH at all:
// the media shelf reads `thumb` from the RECORD, not from disk, so the thumbnail repair in
// the Library has to write the new path back. It cannot write biroly.json server-side - that
// store is browser-owned and biroly-server-sync would overwrite it within two seconds - so
// the repair takes the established route: PATCH here, then the page patches localStorage.
const RECORD_STORES = {
  birols: {
    file: BIROLY_FILE, lsKey: 'biroly_archive_v1',
    read: () => { const s = _read(BIROLY_FILE, {}); return Array.isArray(s.archive) ? s.archive : []; },
    write: (list) => { const s = _read(BIROLY_FILE, {}); s.archive = list; _write(BIROLY_FILE, s); },
    fields: ['name', 'favorite', 'categoryId', 'categoryLabel', 'thumbPath'],
    files: (e) => [e.videoPath, e.thumbPath],
  },
  hooks: {
    file: HOOKS_FILE, lsKey: 'hooks_archive_v1',
    read: () => { const l = _read(HOOKS_FILE, []); return Array.isArray(l) ? l : []; },
    write: (list) => _write(HOOKS_FILE, list),
    fields: ['name', 'favorite', 'categoryId', 'categoryLabel', 'thumbPath'],
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
  // The one server-owned store here, so lsKey is null: there is no browser copy to patch
  // after a write, and a page that treats null as "nothing to do" is already the behaviour
  // everywhere lsKey is read. thumbPath is not patchable either - the shelf builds its
  // thumb URL through /api/thumb, so there is no stored path that could go stale.
  images: {
    file: IMG.FILE, lsKey: null,
    read: IMG.read,
    write: IMG.write,
    fields: ['name', 'favorite', 'categoryId', 'categoryLabel'],
    files: (e) => [e.imagePath],
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
    const removed = [], spared = [];

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

    // Renders. No record to remove - the file IS the entry - so this unlinks the video and its
    // poster and nothing else. The finals archive (finals/_meta.json) is left alone on purpose:
    // GET /api/finals/list already drops entries whose file has gone, so it heals itself rather
    // than needing a second writer here.
    if (kind === 'renders') {
      const base = path.basename(id);
      if (!base || !VID_RE.test(base)) return res.status(400).json({ success: false, error: 'not a render' });
      const abs = path.join(FINALS_DIR, base);
      if (!fs.existsSync(abs)) return res.status(404).json({ success: false, error: 'not found' });
      if (_unlink('/finals/' + base)) removed.push(base);
      const turl = VT.thumbUrlFor('/finals/' + base);
      if (turl) _unlink(turl);
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
      if (store.files) {
        const r = _unlinkUnused(store.files(it), [it.id]);
        removed.push(...r.removed);
        spared.push(...r.kept);
      }
    }
    store.write(list.filter(x => x !== it));
    // `spared` is a file another record is still using, so it stayed put.
    res.json({ success: true, kind, id, removed, spared, lsKey: store.lsKey });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── Take a voice off the shelf ──────────────────────────────────────────────
// Its own route rather than a RECORD_STORES entry, because of the refusal. A character's
// voice entry points at the SAME demo file this record does, so unlinking it while somebody
// still speaks with the voice would silently break their row - the shared-file problem the
// media shelf already learned the hard way, except here the guard can be exact.
//
// So: in use is undeletable, like a green frame. Free means the record goes and the demo
// with it, since nothing else can be pointing at a demo nobody uses.
//
// The ElevenLabs slot is NOT touched here. Freeing a slot belongs to unbinding a voice from
// a character; this is the catalogue, and forgetting a voice is not the same act as
// releasing it.
router.delete('/library/voices/:voiceId', (req, res) => {
  try {
    const voiceId = String(req.params.voiceId || '');
    const entry = VS.get(voiceId);
    if (!entry) return res.status(404).json({ success: false, error: 'not on the shelf' });

    const { items } = _voicesShelf();
    const shown = items.find(i => i.meta.voiceId === voiceId);
    const users = (shown && shown.meta.characters) || [];
    if (users.length) {
      return res.status(409).json({ success: false,
        error: 'still in use by ' + users.map(u => u.name).join(', ') + ' - unbind it there first',
        characters: users.map(u => ({ id: u.id, name: u.name })) });
    }

    VS.remove(voiceId);
    const removed = [];
    if (entry.demo && _unlink(entry.demo)) removed.push(String(entry.demo).split('/').pop());
    res.json({ success: true, voiceId, removed });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── Move a clip between kinds ───────────────────────────────────────────────
// The three kinds are not three shelves, they are two stores plus a flag:
//   birols  <-> uploads   the same archive record, `source` says which
//   hooks                 a different file, data/hooks-archive.json
// So a move is sometimes one field and sometimes a record leaving one store for
// another. Both cases are done here rather than in the page, because a half-applied
// move — gone from one store, not yet in the other — loses the clip.
//
// The FILE never moves. Its url is stored on the record, not derived from the kind, so
// carrying it across is what keeps the clip playable; only the record changes home.
router.post('/library/item/:kind/:id/kind', (req, res) => {
  try {
    const from = String(req.params.kind || '');
    const to = String((req.body || {}).kind || '');
    const id = String(req.params.id || '');
    const KINDS = ['birols', 'uploads', 'hooks'];
    if (!KINDS.includes(from) || !KINDS.includes(to)) return res.status(400).json({ success: false, error: 'kind must be birols, uploads or hooks' });
    if (from === to) return res.json({ success: true, kind: to, id, unchanged: true });

    const src = RECORD_STORES[from];
    const dst = RECORD_STORES[to];
    const srcList = src.read();
    const it = srcList.find(x => x && String(x.id) === id);
    if (!it) return res.status(404).json({ success: false, error: 'not found' });

    // Same store: flip the flag that decides which kind it reads as. `categoryId` is
    // kept — moving a birol to uploads and back should not lose which category it was in.
    if (src.file === dst.file) {
      if (to === 'uploads') it.source = 'upload';
      else delete it.source;
      if (it.categoryId === UPLOADS_CAT) it.categoryId = '';       // the legacy marker is not a category
      src.write(srcList);
      return res.json({ success: true, kind: to, id, item: it, lsKey: src.lsKey });
    }

    // Different stores: build the record the destination expects, then write the
    // destination FIRST. If the second write fails the clip is listed twice, which is
    // visible and fixable; the other order would make it disappear.
    const moved = {
      id: it.id,
      name: it.name,
      videoPath: it.videoPath,
      thumbPath: it.thumbPath || null,
      date: it.date || new Date().toISOString(),
    };
    if (to === 'hooks') {
      moved.prompt = it.prompt || '';
    } else {
      Object.assign(moved, {
        prompt: it.prompt || '',
        imagePath: it.thumbPath || null,
        categoryId: '', categoryLabel: '',
        status: 'done',
      });
      if (to === 'uploads') moved.source = 'upload';
    }
    const dstList = dst.read();
    dstList.unshift(moved);
    dst.write(dstList);
    src.write(srcList.filter(x => x !== it));
    res.json({ success: true, kind: to, id, item: moved, lsKey: dst.lsKey, fromLsKey: src.lsKey });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ════════════════════════════════════════════════════════════════════════════
// BROKEN RECORDS — a record whose file is not there
//
//   GET  /api/library/broken          what would go, changing nothing
//   POST /api/library/broken/clean    drop those records
//
// The shelf already hides them (every shelf checks _onDisk), which is why they are easy to
// miss: they are invisible but still counted, which is the "128 total, 127 shown" gap.
//
// Two shapes, kept apart because they mean different things:
//   missingFile - it had a video and the file is gone
//   noFile      - it never produced one, a generation that failed
//
// A record still GENERATING is deliberately spared: it legitimately has no file yet, and
// sweeping it would delete a job in flight.
// ════════════════════════════════════════════════════════════════════════════

const _IN_FLIGHT = new Set(['generating', 'pending', 'queued', 'running']);

function _brokenIn(kind) {
  const store = RECORD_STORES[kind];
  let list = [];
  try { list = store.read(); } catch (e) { return { missingFile: [], noFile: [] }; }
  const inKind = (e) => (kind === 'hooks' ? true : _isUpload(e) === (kind === 'uploads'));
  const brief = (e, why) => ({
    id: String(e.id), kind, why,
    name: String(e.name || '').trim() || '(unnamed)',
    videoPath: e.videoPath || null,
    status: e.status || '',
    date: e.date || null,
    categoryLabel: e.categoryLabel || '',
  });
  const missingFile = [], noFile = [];
  for (const e of list) {
    if (!e || !inKind(e)) continue;
    if (_IN_FLIGHT.has(String(e.status || '').toLowerCase())) continue;   // a job in flight
    if (!e.videoPath) noFile.push(brief(e, 'never produced a file'));
    else if (!_onDisk(e.videoPath)) missingFile.push(brief(e, 'file is gone from disk'));
  }
  return { missingFile, noFile };
}

// Looks are counted here but cleaned by POST /api/obrazy/prune-missing, which already does it
// (and sweeps geni.json alongside). Counting them in one place lets the page show one number.
function _brokenLooks() {
  const list = _read(OBRAZY_FILE, []);
  const arr = Array.isArray(list) ? list : [];
  const urls = (o) => [o && o.char].concat(Array.isArray(o && o.variations) ? o.variations : [])
    .filter(u => u && u !== 'error');
  return arr.filter(o => { const u = urls(o); return u.length && !u.some(_onDisk); })
    .map(o => ({ id: String(o.id), name: String(o.name || '').trim() || '(unnamed)' }));
}

router.get('/library/broken', (_req, res) => {
  try {
    const media = {};
    let total = 0;
    for (const kind of ['birols', 'uploads', 'hooks']) {
      media[kind] = _brokenIn(kind);
      total += media[kind].missingFile.length + media[kind].noFile.length;
    }
    const looks = _brokenLooks();
    res.json({ success: true, media, looks, total: total + looks.length, mediaTotal: total, looksTotal: looks.length });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/library/broken/clean', (_req, res) => {
  try {
    const dropped = [];
    for (const kind of ['birols', 'hooks']) {          // birols and uploads share one store
      const store = RECORD_STORES[kind];
      const doomed = new Set();
      for (const k of (kind === 'birols' ? ['birols', 'uploads'] : ['hooks'])) {
        const b = _brokenIn(k);
        for (const e of b.missingFile.concat(b.noFile)) doomed.add(e.id);
      }
      if (!doomed.size) continue;
      const list = store.read();
      const next = list.filter(e => !(e && doomed.has(String(e.id))));
      // Refuse rather than half-apply: if the count does not match, the store moved.
      if (list.length - next.length !== doomed.size) {
        return res.status(409).json({ success: false, error: 'the archive changed while this ran - nothing was written' });
      }
      store.write(next);
      for (const id of doomed) dropped.push({ id, store: kind, lsKey: store.lsKey });
    }
    // Nothing is unlinked: the whole point is that these records have no file.
    res.json({ success: true, dropped, count: dropped.length });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ════════════════════════════════════════════════════════════════════════════
// DUPLICATES — two records, one file
//
//   GET  /api/library/dupes          what would go, changing nothing
//   POST /api/library/dupes/clean    drop the redundant records. FILES ARE NEVER TOUCHED.
//
// These are records pointing at the SAME videoPath, not clips that merely look alike — so
// nothing here compares pixels. Real data has 81 such pairs in the archive, the residue of a
// restore that ran twice: 55 pairs differ only in `id` and `date`, and the copies all carry
// one batch timestamp.
//
// Which copy stays is decided by how much it knows, because a restored copy knows less: a
// `prompt` is the strongest sign this is the record the generator itself wrote, then an
// `imagePath`, then a favourite, and finally the EARLIER date — the original rather than the
// copy made later.
// ════════════════════════════════════════════════════════════════════════════

const _dupScore = (e) => [e.prompt ? 1 : 0, e.imagePath ? 1 : 0, e.favorite ? 1 : 0];
function _dupRank(a, b) {
  const sa = _dupScore(a), sb = _dupScore(b);
  for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return sb[i] - sa[i];
  return _ts(a.date) - _ts(b.date);            // earlier first
}

// Groups are found WITHIN a store, never across: birols and uploads share one file and one
// localStorage key, hooks are their own, and a record cannot be deduplicated into a different
// store without changing what kind of thing it is.
function _dupeGroups() {
  const out = [];
  for (const kind of ['birols', 'hooks']) {
    const store = RECORD_STORES[kind];
    let list = [];
    try { list = store.read(); } catch (e) { continue; }
    const by = new Map();
    for (const e of list) {
      if (!e || !e.videoPath) continue;
      const k = String(e.videoPath).split('?')[0];
      if (!by.has(k)) by.set(k, []);
      by.get(k).push(e);
    }
    for (const [videoPath, recs] of by) {
      if (recs.length < 2) continue;
      const sorted = [...recs].sort(_dupRank);
      const brief = (e) => ({ id: String(e.id), name: String(e.name || ''), categoryId: e.categoryId || '',
        categoryLabel: e.categoryLabel || '', date: e.date || null, hasPrompt: !!e.prompt });
      out.push({
        store: kind, lsKey: store.lsKey, videoPath,
        file: videoPath.split('/').pop(),
        keep: brief(sorted[0]),
        drop: sorted.slice(1).map(brief),
        // Worth surfacing: the copies disagreed on category, so the clip will appear under the
        // kept record's one from now on.
        categoryChanges: new Set(recs.map(e => e.categoryId || '')).size > 1,
      });
    }
  }
  return out;
}

router.get('/library/dupes', (_req, res) => {
  try {
    const groups = _dupeGroups();
    res.json({
      success: true,
      groups,
      total: groups.reduce((n, g) => n + g.drop.length, 0),
      categoryChanges: groups.filter(g => g.categoryChanges).length,
    });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/library/dupes/clean', (_req, res) => {
  try {
    const groups = _dupeGroups();
    const dropped = [];
    for (const kind of ['birols', 'hooks']) {
      const mine = groups.filter(g => g.store === kind);
      if (!mine.length) continue;
      const doomed = new Set();
      for (const g of mine) for (const d of g.drop) doomed.add(d.id);
      const store = RECORD_STORES[kind];
      const list = store.read();
      const next = list.filter(e => !(e && doomed.has(String(e.id))));
      // Refuse rather than half-apply: the count has to match what was planned, or the store
      // changed underneath us and the plan is stale.
      if (list.length - next.length !== doomed.size) {
        return res.status(409).json({ success: false, error: 'the archive changed while this ran - nothing was written' });
      }
      store.write(next);
      for (const id of doomed) dropped.push({ id, store: kind, lsKey: store.lsKey });
    }
    // No file is unlinked here, by design: every dropped record shares its video and its
    // thumbnail with the copy that stays.
    res.json({ success: true, dropped, count: dropped.length });
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
    // Which kind the clip is filed as follows what the page had open, so uploading while
    // looking at Hooks puts it among the hooks. Uploads is the default: it is what "All"
    // means, and it is where a file you brought in belongs when nothing says otherwise.
    const kind = ['birols', 'uploads', 'hooks'].includes(String((req.body || {}).kind)) ? String(req.body.kind) : 'uploads';
    const store = RECORD_STORES[kind];
    const list = store.read();
    if (list.some(e => e && e.videoPath === videoPath)) return res.status(409).json({ success: false, error: 'already on the shelf' });
    const rec = {
      id: 'lib' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: String(name || '').trim().slice(0, 120) || String(videoPath).split('/').pop(),
      prompt: '',
      videoPath,
      thumbPath: thumbPath || null,
      date: new Date().toISOString(),
    };
    // Hooks records carry only the basics; an archive record has the generator's fields
    // too, and `source` is what makes it read as an upload rather than a birol.
    if (kind !== 'hooks') {
      Object.assign(rec, { imagePath: thumbPath || null, categoryId: '', categoryLabel: '', status: 'done' });
      if (kind === 'uploads') rec.source = 'upload';
    }
    list.unshift(rec);
    store.write(list);
    res.json({ success: true, item: rec, kind, lsKey: store.lsKey });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ════════════════════════════════════════════════════════════════════════════
// CATEGORIES — one list per kind, owned by lib/library-cats.js
//
//   GET    /api/library/cats?kind=          the list, for the dropdowns
//   POST   /api/library/cats                { kind, label }        create
//   PATCH  /api/library/cats/:id            { kind, label }        rename, or fork
//   POST   /api/library/cats/order          { kind, order:[id] }   the chip order
//   DELETE /api/library/cats/:id            ?kind=&media=move|delete
//
// Records keep a DENORMALISED copy of the name in `categoryLabel` — every lookup in the app
// goes by id, but public/js/biroly-archive.js reads that copy to draw a heading. So every
// operation that changes a name has to rewrite it on the records too, or the old name lives
// on in the UI. That is the "files take the new name" part.
// ════════════════════════════════════════════════════════════════════════════

// The records that a chip of this kind actually stands for. birols and uploads share one
// file and are told apart by a flag, so "the records of this kind" is a filter, not a store.
function _kindRecords(kind) {
  const store = RECORD_STORES[kind];
  if (!store) throw new Error(`no such kind "${kind}"`);
  const list = store.read();
  const inKind = (e) => {
    if (!e) return false;
    // birols and uploads are the only two kinds that share a file, so they are the only two
    // that need telling apart; everything else owns its store outright. Written as "which
    // kinds need the split" rather than "which kind does not" because the old form asked
    // _isUpload about records it was never meant to judge: an image is filed with
    // source:'upload', which that predicate reads as true, so every image would have been
    // excluded from its own kind and no category delete could ever have reached one.
    if (kind !== 'birols' && kind !== 'uploads') return true;
    return _isUpload(e) === (kind === 'uploads');
  };
  return { store, list, inKind };
}

// Point every record of `kind` that sits in `fromId` at `toId`/`toLabel`. Passing '' for
// both is what "move to Uncategorized" means: a record with no categoryId IS uncategorized.
function _reassign(kind, fromId, toId, toLabel) {
  const { store, list, inKind } = _kindRecords(kind);
  let n = 0;
  for (const e of list) {
    if (!inKind(e) || String(e.categoryId || '') !== String(fromId)) continue;
    e.categoryId = toId || '';
    e.categoryLabel = toLabel || '';
    // An upload used to be recognisable by categoryId === '__uploads__' alone. Clearing the
    // category would turn such a record back into a birol, so make the flag explicit.
    if (kind === 'uploads') e.source = 'upload';
    n++;
  }
  if (n) store.write(list);
  return { moved: n, lsKey: store.lsKey };
}

// All three lists in one request. The dropdown on a card has to offer the list belonging to
// THAT card's kind, and a grid on the All filter shows all three kinds at once, so the page
// needs every list up front rather than one per card.
router.get('/library/cats', (_req, res) => {
  try {
    const byKind = {};
    for (const k of LC.KINDS) {
      byKind[k] = LC.listFor(k, {}, null).map(c => ({ id: c.id, label: c.label, own: c.own }));
    }
    res.json({ success: true, byKind });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/library/cats', (req, res) => {
  try {
    const { kind, label } = req.body || {};
    if (!LC.KINDS.includes(String(kind))) return res.status(400).json({ success: false, error: 'kind must be birols, uploads or hooks' });
    const { cat, created } = LC.add(String(kind), label);
    res.json({ success: true, cat, created });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

router.patch('/library/cats/:id', (req, res) => {
  try {
    const id = String(req.params.id || '');
    const kind = String((req.body || {}).kind || '');
    const label = String((req.body || {}).label || '').trim();
    if (!LC.KINDS.includes(kind)) return res.status(400).json({ success: false, error: 'kind must be birols, uploads or hooks' });
    if (id === LC.UNCAT) return res.status(400).json({ success: false, error: 'Uncategorized is not a category' });
    if (!label) return res.status(400).json({ success: false, error: 'a category needs a name' });

    // A Library category renames in place.
    if (LC.isOwn(kind, id)) {
      const cat = LC.rename(kind, id, label);
      const { moved, lsKey } = _reassign(kind, id, cat.id, cat.label);   // refresh the copies
      return res.json({ success: true, cat, renamed: true, moved, lsKey });
    }

    // A Birols-tab category is not ours to rename: its entry carries the generator's
    // systemPrompt and promptVersions, and the Scenarios birols column reads that list's
    // order. So the rename FORKS — a Library category takes the new name and the clips move
    // into it, while the Birols tab keeps its category exactly as it was.
    const { cat, created } = LC.add(kind, label);
    const { moved, lsKey } = _reassign(kind, id, cat.id, cat.label);
    // Its clips have left, so it is empty. Hide it until a generation fills it again — at
    // which point it returns under the generator's own name.
    let hidden = false;
    if (LC.isGen(id)) { LC.hide(kind, id); hidden = true; }
    res.json({ success: true, cat, forked: true, created, moved, hidden, lsKey });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

router.post('/library/cats/order', (req, res) => {
  try {
    const { kind, order } = req.body || {};
    if (!LC.KINDS.includes(String(kind))) return res.status(400).json({ success: false, error: 'kind must be birols, uploads or hooks' });
    res.json({ success: true, order: LC.setOrder(String(kind), order) });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

// media=move   (the default) clears the category off its clips, so they land in Uncategorized
// media=delete REMOVES those clips: files unlinked, records dropped. Irreversible, and the
//              page states the count in the confirmation before it can be chosen.
//
// Any chip can go except All and Uncategorized. What "going" means depends on who owns it:
//   a Library category   is removed from the store
//   a generator category is HIDDEN — it is not ours to remove, and the Birols generator keeps
//                        it. Once its clips are resolved it holds nothing, so it drops out of
//                        the row, and a later generation into it brings it back by itself.
//   an orphan            needs neither: it exists only because records point at it.
router.delete('/library/cats/:id', (req, res) => {
  try {
    const id = String(req.params.id || '');
    const kind = String(req.query.kind || '');
    const mode = String(req.query.media || 'move') === 'delete' ? 'delete' : 'move';
    if (!LC.KINDS.includes(kind)) return res.status(400).json({ success: false, error: 'kind must be birols, uploads or hooks' });
    if (id === LC.UNCAT) return res.status(400).json({ success: false, error: 'Uncategorized is not a category' });
    let affected = 0, removedFiles = [], sparedFiles = [], lsKey = null;
    if (mode === 'delete') {
      const { store, list, inKind } = _kindRecords(kind);
      const doomed = list.filter(e => inKind(e) && String(e.categoryId || '') === id);
      const paths = [];
      for (const e of doomed) for (const p of (store.files ? store.files(e) : [])) paths.push(p);
      // One pass for the whole set: a file shared BETWEEN two doomed records must not be
      // treated as still in use by the second one.
      const r = _unlinkUnused(paths, doomed.map(e => e.id));
      removedFiles.push(...r.removed);
      sparedFiles.push(...r.kept);
      if (doomed.length) store.write(list.filter(e => !doomed.includes(e)));
      affected = doomed.length;
      lsKey = store.lsKey;
    } else {
      const r = _reassign(kind, id, '', '');
      affected = r.moved;
      lsKey = r.lsKey;
    }
    // The clips are resolved; now the chip itself.
    let disposition;
    if (LC.isOwn(kind, id)) { LC.remove(kind, id); disposition = 'removed'; }
    else if (LC.isGen(id)) { LC.hide(kind, id); disposition = 'hidden'; }
    else { disposition = 'orphan'; }          // nothing to store: it lived on its records alone
    res.json({ success: true, id, kind, mode, affected, removedFiles, sparedFiles, disposition, lsKey });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
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
