'use strict';

// ════════════════════════════════════════════════════════════════════════════
// LIBRARY — one endpoint per shelf, one shape for every kind.
//
//   GET /api/library/shelf/:kind        kind: characters | lookbooks |
//                                             environments | media
//   GET /api/library/info/:kind/:id     what the right column says about one tile
//   GET /api/library/counts             one number per shelf, for the switcher
//   GET /api/library/tree               the media tree: Video, Images, Audio with their kinds and categories (V28.4)
//   -> { items: [{ id, name, kind, media, thumb, meta }], total, filters, cats }
//
// `thumb` is what the grid draws and `media` is what the viewer opens. They are
// never the same file unless no thumbnail exists — the old shelf drew full frames
// and even whole videos into 72px cards, which is the mistake this shape prevents.
//
// `filters` and `cats` are what the page's filter rows offer for that shelf: for
// Media the kind (birols / uploads / hooks / images) and then the category within it.
// The server sends them because only the server knows what is actually in the data.
//
// Looks are not a shelf: they belong to a character and show beside it.
//
// Reads the same stores the popup read; it owns none of them and writes nothing.
// ════════════════════════════════════════════════════════════════════════════

const express = require('express');
const fs      = require('fs');
const { writeFileAtomic } = require('../lib/atomic-write');
const path    = require('path');
const router  = express.Router();

const {
  LOOKBOOKS_DIR, ENVIRONMENTS_DIR, OBRAZY_DIR, OBRAZY_FILE, DATA_DIR, ROOT_DIR,
  FINALS_DIR,
} = require('../lib/config');
const { toUrl, toDiskWithin } = require('../lib/media');
const { siblingsOf } = require('../lib/relocate');
const LC = require('../lib/library-cats');
// Where a shelf item's files live - its kind and category's folder - and moving them there.
const SHELF = require('../lib/shelf-files');
const VS = require('../lib/voice-shelf');
const VT = require('../lib/video-thumb');
// What is known about a picture on a flat shelf - here, an environment's description and motion.
const SM = require('../lib/shelf-meta');
const IMG = require('../lib/images-store');
const SND = require('../lib/sounds-store');
const MUSIC = require('../lib/music-store');

// (phase V28.4) The required categories ("Generated", "Screenshots"...) are there, and a second one of the same name is
// folded into the first - before anything reads a category. The library has been upgraded by now (server.js).
try {
  const RC = require('../lib/required-cats');
  const r = RC.ensure();
  if (r.made.length || r.merged.length) {
    console.log('[library] required categories:' + (r.made.length ? ' made ' + r.made.join(', ') + ';' : '')
      + r.merged.map(m => ' folded a second ' + m.kind + '/' + m.label + ' into the first (' + m.records + ' records)').join(';'));
  }
  // And, once per library, what the chats made before V28.4 into "Generated" (pictures) or no category (clips).
  const g = RC.moveChatMade();
  if (g && (g.images || g.birols)) console.log('[library] made by the chats: ' + g.images + ' picture(s) into Generated, ' + g.birols + ' clip(s) to no category');
  // (second round) B-roll's "Generated" of the first round let go of, once.
  const rb = RC.releaseBrollGenerated();
  if (rb && rb.had) console.log('[library] B-roll\'s "Generated" let go of: ' + rb.records + ' clip(s) to no category');
} catch (e) { console.warn('[library] required categories were not made ready:', e.message); }

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
// The characters whose 4K sheet is being made right now - a running sheet row in the journal (phase H6).
// The shelf marks their tiles, and the tile's rename and delete wait for it: a character deleted under
// its sheet leaves the wait with nothing to file into, and a name changed there is overwritten from the
// save form that is still open on the old one.
function _sheetsRunning() {
  try {
    return new Set(require('../lib/alerts').list()
      .filter(r => r && r.state === 'running' && r.job && r.job.type === 'sheet')
      .map(r => String(((r.job.params || {}).charId) || '')).filter(Boolean));
  } catch (e) { return new Set(); }
}

function _charactersShelf() {
  const chars = _read(path.join(DATA_DIR, 'characters.json'), []);
  const running = _sheetsRunning();
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
        sheetRunning: running.has(String(c.id)),
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
        // The lookbook it was dressed in, when it was (the right column of a lookbook lists them).
        lookbook: String(o.lb || '').split('?')[0],
        date: o.date || null,
      },
    };
  }).filter(x => x.media && _onDisk(x.media) && x.meta.charId);
  return { items };
}

// ── Media (birols + uploads + hooks + images) ───────────────────────────────
// Birols and uploads live in one archive, split by a flag the client sets; hooks
// have their own, and so do images. One shelf, four filters — they are all "something
// on a shelf that a timeline can take".
//
// Images are stills rather than clips, and two fields say so. `thumb` goes through
// /api/thumb instead of naming a stored file: an original can be a 4K screenshot, and no
// grid should ever load one. `dur` is 0, because a picture has no length of its own — the
// 10s a dropped image gets is the timeline's decision, not the shelf's.
const UPLOADS_CAT = '__uploads__';
const _isUpload = (it) => !!(it && (it.source === 'upload' || it.categoryId === UPLOADS_CAT));

// (phase TG, block 7) A PIECE CUT OUT OF A VIDEO keeps its whole video (lib/cuts.js) - shown to the viewer only while
// that file is on disk: its "original" tick shows it and cuts from it again.
function _origMeta(o) {
  if (!o || !o.path || !_onDisk(o.path)) return null;
  return { path: o.path, in: +o.in || 0, out: +o.out || 0, dur: +o.dur || 0, name: o.name || '' };
}

// The hook numbers, read once per shelf build rather than once per tile.
function _hookIds() {
  try { return require('../lib/hook-ids').map(); } catch (e) { return {}; }
}

// A clip whose record lost its poster still has one beside it on disk (lib/video-thumb.js) - shown
// instead of "no thumb" (phase J4), the way the renders shelf finds its own.
function _posterOf(thumb, video) {
  if (thumb) return thumb;
  const t = VT.thumbUrlFor(video);
  return (t && _onDisk(t)) ? t : null;
}

// (phase V28.4) `opts.music`: Suno's tracks and the ones brought in (lib/music-store.js) as a sixth kind, `music` - only
// when asked for (Audio -> Music in the media tree): every other reader of this shelf - the video chat, the pictures
// chat, the Library's chats, the 3D Studio, Media's checks - reads it as it always was.
function _mediaShelf(opts) {
  const bir = _read(path.join(DATA_DIR, 'biroly.json'), { archive: [] });
  const arch = Array.isArray(bir.archive) ? bir.archive : [];
  const hooks = _read(path.join(DATA_DIR, 'hooks-archive.json'), []);
  // The hook numbers, read once for the whole build: it used to be once per hook, off the disk
  // each time, on every read of Media and on every count of the shelves (phase D3).
  const hookIds = _hookIds();

  const fromArchive = arch.filter(e => e && e.videoPath).map(e => ({
    id: String(e.id),
    name: String(e.name || '').trim() || 'clip',
    kind: _isUpload(e) ? 'uploads' : 'birols',
    media: e.videoPath,
    thumb: _posterOf(e.thumbPath, e.videoPath),
    // The archive has known how long each clip is since it was generated. Sending it lets a
    // drop onto a Merge lane land at the right width straight away, instead of appearing at
    // a placeholder length and resizing a moment later once the browser has read the file.
    dur: +e.duration || 0,
    meta: {
      categoryId: e.categoryId || '', date: e.date || null, favorite: !!e.favorite,
      // Present only on clips animated out of a picture; the viewer draws it beside them.
      refImage: (e.refImage && _onDisk(e.refImage)) ? e.refImage : null,
      prompt: e.prompt || '',
      // What an old one-time trim cut it to (before phase TG); a piece cut since keeps its whole video instead.
      trimmed: e.trimmed || null, original: _origMeta(e.original),
      // (phase V7) The video chat's column lays a clip out at its own shape.
      w: +e.w || 0, h: +e.h || 0,
      // (phase V27) Where it came from, when it came by a link; the viewer shows it.
      link: e.link || '',
    },
  }));
  const fromHooks = (Array.isArray(hooks) ? hooks : []).filter(h => h && h.videoPath).map((h, i) => ({
    id: String(h.id || ('hook:' + i)),
    name: String(h.name || '').trim() || 'hook',
    kind: 'hooks',
    media: h.videoPath,
    thumb: _posterOf(h.thumbPath, h.videoPath),
    // `favorite` and `categoryId` are read back here on purpose: the star and the category
    // dropdown write them, so leaving either out would let you set it and see no change.
    // Hook records already carried a category — public/js/scen-hooks.js has always written
    // categoryId/categoryLabel — so this reads existing data, it does not invent a field.
    // Hook records have never carried a duration; 0 means "ask the file", which is what
    // the timeline falls back to.
    dur: +h.duration || 0,
    // The hook's permanent number, which the grid shows on the tile and the render window
    // puts in the creative's name. Read from the registry rather than the record: the
    // record belongs to the browser and is overwritten wholesale on every push.
    meta: { categoryId: h.categoryId || '', date: h.date || null, favorite: !!h.favorite,
            hookId: hookIds[String(h.videoPath || '').split('?')[0]] || null,
            trimmed: h.trimmed || null, original: _origMeta(h.original), link: h.link || '' },
  }));

  const fromImages = IMG.read().filter(e => e && e.imagePath).map(e => ({
    id: String(e.id),
    name: String(e.name || '').trim() || 'image',
    kind: 'images',
    media: e.imagePath,
    thumb: '/api/thumb?src=' + encodeURIComponent(e.imagePath) + '&v=card',
    dur: 0,
    meta: {
      categoryId: e.categoryId || '', date: e.date || null, favorite: !!e.favorite,
      // w/h/alpha ride along for the inspector: a cutout is laid over the frame, a solid
      // picture fills it, and knowing which is which saves re-measuring the file.
      w: +e.w || 0, h: +e.h || 0, alpha: !!e.alpha, source: e.source || 'upload',
    },
  }));

  // (phase V7) Sounds - no picture: the page draws a row of its own for them.
  const fromSounds = SND.read().filter(e => e && e.audioPath).map(e => ({
    id: String(e.id),
    name: String(e.name || '').trim() || 'sound',
    kind: 'sounds',
    media: e.audioPath,
    thumb: null,
    dur: +e.duration || 0,
    meta: { categoryId: e.categoryId || '', date: e.date || null, favorite: !!e.favorite, source: e.source || 'upload' },
  }));

  // (phase V28.4) Music - no categories, no picture; its length kept on the record (measured once for the older ones).
  const fromMusic = !(opts && opts.music) ? [] : MUSIC.read().filter(t => t && t.audioPath).map(t => ({
    id: String(t.id || t.audioPath),
    name: String(t.title || '').trim() || 'track',
    kind: 'music',
    media: String(t.audioPath),
    thumb: null,
    dur: +t.duration || 0,
    meta: { categoryId: '', date: t.createdAt || null, favorite: !!t.favorite, style: String(t.style || ''),
            source: t.source || 'suno', gen: t.gen || '', variant: t.variant || 0 },
  }));
  if (fromMusic.some(m => !(m.dur > 0))) MUSIC.fillLengths();

  // (phase V28.4, second round) The talking heads - every take of every line of every talking-head project (lib/heads.js),
  // only when asked (VIDEO -> Generated -> Talking heads); the project is its category. A take on a timeline is `used`.
  // Not the library's to delete or re-file while its project lives.
  let fromHeads = [];
  if (opts && opts.heads) {
    const used = require('../lib/timeline-media').allSrcs();
    fromHeads = require('../lib/heads').list().map(h => ({
      id: h.id,
      name: 'Line ' + h.line + ' · ' + String(h.said || '').replace(/\s+/g, ' ').trim().slice(0, 70),
      kind: 'heads',
      media: h.path,
      thumb: h.thumb,
      dur: h.dur,
      meta: { categoryId: h.projectId, project: h.title, line: h.line, variant: h.variant, used: used.has(h.path),
              date: h.at || null, favorite: false, said: h.said, kept: !!h.kept },
    }));
  }

  const items = fromArchive.concat(fromHooks).concat(fromImages).concat(fromSounds).concat(fromMusic).concat(fromHeads)
    .filter(i => _onDisk(i.media));
  // (phase TG, block 6; the owner: "в library на полке media можно смотреть видео скачаные с youtube ... все видео-источники
  // сценариев и highlights - только скачаные с ютуба") YOUTUBE - every source with its video on the disk that came from
  // YouTube, one tile each, only when asked. It is the Sources' (Scenarios -> sources): watched, laid on a lane, sent to
  // highlights - never deleted or moved from here.
  // (after block 8; the owner 2026-10-22: "в references папка youtube->videos будет источником для scenarios и для
  // highlights ... корневая youtube убираем") They are REFERENCES -> YouTube -> Videos now (`folder`), beside the videos
  // kept as tiles, and come with REFERENCES. `ytKeys` - their links' keys: a tile of the same video is not shown twice.
  const SRCS = require('../lib/sources-store');
  const ytKeys = new Set();
  if (opts && (opts.youtube || opts.refs)) {
    for (const s of SRCS.list()) {
      if (!s || !s.videoPath || !_onDisk(s.videoPath) || !SRCS.fromYouTube(s)) continue;
      if (s.linkKey) ytKeys.add(s.linkKey);
      items.push({
        id: String(s.id), name: String(s.title || '').trim() || 'video', kind: 'youtube', media: s.videoPath,
        thumb: s.thumbPath && _onDisk(s.thumbPath) ? s.thumbPath : null, dur: +s.seconds || 0,
        meta: { categoryId: '', date: s.addedAt || null, favorite: false, link: s.url || '', channel: s.channel || '',
          words: !!(s.words || (s.transcript && s.transcript.length)), source: s.id, folder: 'videos',
          // its own `source` names the record; where it lies is told by `site`
          site: 'youtube' },
      });
    }
  }
  // (phase TG, block 5) REFERENCES - one tile per POST, only when asked (the tree's REFERENCES): newest first, after the
  // rest. A post's files ride along in `meta.items` (the hover's miniatures, the post viewer's strip); a long video kept
  // as a tile (`meta.remote`) has its poster for `media`.
  if (opts && opts.refs) {
    for (const p of require('../lib/references-store').read()) {
      if (!p || !p.id) continue;
      // A video kept as a tile whose video is a downloaded source already: the source's tile is the one (after block 8).
      if (p.remote && p.linkKey && ytKeys.has(p.linkKey)) continue;
      const files = (Array.isArray(p.media) ? p.media : []).filter(m => m && m.path);
      const first = files[0];
      const one = files.length === 1 && first.type === 'video';
      items.push({
        id: String(p.id),
        name: String(p.title || '').trim() || 'post',
        kind: 'references',
        media: first ? first.path : (p.poster || ''),
        thumb: p.poster || (first && first.thumb) || null,
        dur: one ? (+first.dur || 0) : (p.remote ? (+p.remote.dur || 0) : 0),
        meta: {
          categoryId: p.categoryId || '', categoryLabel: p.categoryLabel || '', date: p.receivedAt || null, favorite: false,
          source: p.source || '', folder: p.folder || '', author: p.author || '', link: p.link || '',
          caption: p.caption || '', note: p.note || '', origin: p.origin || '', postedAt: p.postedAt || '',
          remote: p.remote || null, poster: p.poster || null,
          items: files.map(m => ({ id: m.id, type: m.type, path: m.path, thumb: m.thumb || null, w: m.w || 0, h: m.h || 0, dur: m.dur || 0,
            original: _origMeta(m.original) })),
          w: (first && first.w) || (p.remote && p.remote.w) || 0, h: (first && first.h) || (p.remote && p.remote.h) || 0,
        },
      });
    }
  }
  // Favourites first, newest first after that. A starred clip is one you keep reaching
  // for, so it belongs at the top left rather than wherever its date puts it.
  items.sort((a, b) => (Number(!!b.meta.favorite) - Number(!!a.meta.favorite))
    // (second round) Talking heads after the rest, and read as their projects do: by project, then line by line, the
    // newest take first.
    || (Number(a.kind === 'heads') - Number(b.kind === 'heads'))
    || ((a.kind === 'heads' && b.kind === 'heads')
      ? (_abc(a.meta.project, b.meta.project) || (a.meta.line - b.meta.line) || (_ts(b.meta.date) - _ts(a.meta.date))) : 0)
    // REFERENCES after the rest - its posts and its downloaded YouTube videos as one, by date.
    || (Number(a.kind === 'references' || a.kind === 'youtube') - Number(b.kind === 'references' || b.kind === 'youtube'))
    || (_ts(b.meta.date) - _ts(a.meta.date)));
  const n = (k) => items.filter(i => i.kind === k).length;

  // A record's own categoryLabel, for an id no list knows about — see listFor()'s orphan
  // note. Reading it from the record is the only way to name such a chip.
  const fromRecords = {};
  for (const e of arch.concat(Array.isArray(hooks) ? hooks : []).concat(IMG.read()).concat(SND.read())) {
    if (e && e.categoryId && e.categoryLabel && !fromRecords[e.categoryId]) fromRecords[e.categoryId] = String(e.categoryLabel);
  }

  return {
    items,
    filters: [
      { id: 'birols',  label: 'Birols · ' + n('birols') },
      { id: 'uploads', label: 'Uploads · ' + n('uploads') },
      { id: 'hooks',   label: 'Hooks · ' + n('hooks') },
      { id: 'images',  label: 'Images · ' + n('images') },
      { id: 'sounds',  label: 'Sounds · ' + n('sounds') },
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

// ── The media tree (phase V28.4 + V28.5, the owner 2026-10-12; the second round) ──
// One answer for both places that draw it - Merge's Library panel and the Library's Media shelf (js/media-tree.js):
//   VIDEO  -> Generated (B-rolls -> categories, Talking heads -> projects, Uncategorized), Hooks, Uploads -> categories
//   IMAGES -> its categories          AUDIO -> Music, SFX -> categories
// Every node: { key, label, count, q, children? } - `q` is what the shelf is asked for it (`group`, or `filter` and `cat`),
// `key` what a page remembers it by. In a branch (the owner): the locked first, then those with something in them, then
// Uncategorized, then the empty ones (`empty`, pale) - each part in alphabetical order (no case; "2026-08-23" before
// "2026-10-02"). Generated, Hooks and Uploads are locked; so are the required categories.
// B-rolls has no Uncategorized of its own: a B-roll with no category is Generated's Uncategorized (the owner).
const KIND_LABEL = { birols: 'B-rolls', hooks: 'Hooks', uploads: 'Uploads', images: 'IMAGES', music: 'Music', sounds: 'SFX', heads: 'Talking heads' };
const GROUPS = { video: ['birols', 'hooks', 'uploads', 'heads'], generated: ['birols', 'heads'], images: ['images'], audio: ['music', 'sounds'],
  // (phase TG, block 5) REFERENCES - the posts the Telegram bot brought in (lib/references-store.js); and (after block 8) the
  // sources of the scenarios and of highlights downloaded from YouTube, in its YouTube -> Videos.
  references: ['references', 'youtube'] };
// Where an item of REFERENCES lies: a post by its site and folder, a downloaded YouTube source in YouTube -> Videos.
const _siteOf = (i) => (i.kind === 'youtube' ? 'youtube' : (i.meta || {}).source);
const _inRefs = (i) => i.kind === 'references' || i.kind === 'youtube';
const ANYCAT = '__cat__';          // a B-roll with some category (VIDEO -> Generated -> B-rolls)
const _abc = (a, b) => String(a || '').localeCompare(String(b || ''), 'en', { numeric: true, sensitivity: 'base' });

function _tree() {
  const { items, labelFor } = _mediaShelf({ music: true, heads: true, refs: true, youtube: true });
  const byKind = {};
  for (const i of items) (byKind[i.kind] = byKind[i.kind] || []).push(i);
  const catsOf = (kind, list, withUncat) => {
    const counts = {};
    let uncat = 0;
    for (const i of list) {
      const c = (i.meta || {}).categoryId;
      if (c && c !== UPLOADS_CAT) counts[c] = (counts[c] || 0) + 1;
      else uncat++;
    }
    const cats = LC.listFor(kind, counts, labelFor);
    const one = (c) => ({
      key: kind + ':' + c.id, kind, cat: c.id, label: c.title || c.label, name: c.label, count: c.count,
      locked: !!c.locked, own: !!c.own, orphan: !!c.orphan, empty: !(c.count > 0), q: { filter: kind, cat: c.id },
    });
    const by = (a, b) => _abc(a.title || a.label, b.title || b.label);
    const out = [
      ...cats.filter(c => c.locked).sort(by).map(one),
      ...cats.filter(c => !c.locked && c.count > 0).sort(by).map(one),
    ];
    const unc = { key: kind + ':' + UNCAT, kind, cat: UNCAT, label: 'Uncategorized', count: uncat, uncat: true, empty: !uncat,
      q: { filter: kind, cat: UNCAT } };
    if (withUncat && uncat) out.push(unc);
    out.push(...cats.filter(c => !c.locked && !(c.count > 0)).sort(by).map(one));
    if (withUncat && !uncat) out.push(unc);
    return { out, uncat };
  };
  const kindNode = (kind, key, label, extra) => {
    const list = byKind[kind] || [];
    const node = Object.assign({ key: key || kind, kind, label: label || KIND_LABEL[kind], count: list.length, q: { filter: kind } }, extra || {});
    if (!LC.KINDS.includes(kind)) return node;
    const { out } = catsOf(kind, list, true);
    if (LC.listFor(kind, {}, labelFor).length || out.some(c => !c.uncat)) node.children = out;
    return node;
  };
  // VIDEO -> Generated: B-rolls (its categories, no Uncategorized), Talking heads (a project each), Uncategorized.
  const birols = byKind.birols || [];
  const inCat = birols.filter(i => (i.meta || {}).categoryId);
  const brolls = { key: 'birols', kind: 'birols', label: 'B-rolls', count: inCat.length, q: { filter: 'birols', cat: ANYCAT },
    children: catsOf('birols', birols, false).out };
  const heads = byKind.heads || [];
  const projects = new Map();
  for (const h of heads) {
    const id = String((h.meta || {}).categoryId || '');
    const p = projects.get(id) || { id, title: (h.meta || {}).project || id, n: 0 };
    p.n++;
    projects.set(id, p);
  }
  const headsNode = { key: 'heads', kind: 'heads', label: 'Talking heads', count: heads.length, q: { filter: 'heads' },
    children: [...projects.values()].sort((a, b) => _abc(a.title, b.title)).map(p => ({
      key: 'heads:' + p.id, kind: 'heads', cat: p.id, label: p.title, count: p.n, project: true, q: { filter: 'heads', cat: p.id },
    })) };
  if (!headsNode.children.length) delete headsNode.children;
  const loose = birols.length - inCat.length;
  const generated = { key: 'generated', label: 'Generated', locked: true, count: birols.length + heads.length, q: { group: 'generated' },
    children: [brolls, headsNode, { key: 'birols:' + UNCAT, kind: 'birols', cat: UNCAT, label: 'Uncategorized', count: loose,
      uncat: true, empty: !loose, q: { filter: 'birols', cat: UNCAT } }] };
  const video = { key: 'video', label: 'VIDEO', q: { group: 'video' },
    children: [generated, kindNode('hooks', null, null, { locked: true }), kindNode('uploads', null, null, { locked: true })] };
  video.count = video.children.reduce((n, c) => n + c.count, 0);
  const audio = { key: 'audio', label: 'AUDIO', q: { group: 'audio' }, children: [kindNode('music'), kindNode('sounds')] };
  audio.count = audio.children.reduce((n, c) => n + c.count, 0);
  // (phase TG, block 5; the owner: "давай над video - самой первой") REFERENCES - the posts the Telegram bot brought in, a
  // folder per source and its kind of post; the folders are the app's (locked).
  const refs = (byKind.references || []).concat(byKind.youtube || []);
  const nOf = (s, f) => refs.filter(i => !i.meta.categoryId && _siteOf(i) === s && (!f || i.meta.folder === f)).length;
  // `kind` on the root: its "+" makes an own category (block 5b); the sources' folders make none (`noAdd`).
  const references = { key: 'references', kind: 'references', label: 'REFERENCES', q: { group: 'references' }, count: refs.length,
    children: require('../lib/references-store').SOURCES.map((s) => {
      const node = { key: 'references:' + s.id, kind: 'references', ref: s.id, label: s.label, locked: true, noAdd: true,
        count: nOf(s.id), empty: !nOf(s.id), q: { filter: 'references', src: s.id } };
      if (s.folders.length) {
        node.children = s.folders.map(f => ({ key: `references:${s.id}/${f.id}`, kind: 'references', ref: s.id + '/' + f.id,
          label: f.label, locked: true, noAdd: true, count: nOf(s.id, f.id), empty: !nOf(s.id, f.id), q: { filter: 'references', src: s.id + '/' + f.id } }));
      }
      return node;
    }) };
  // The owner's own categories, after the sources' folders: the ones with posts, then the empty ones, each A-Z.
  references.children.push(...catsOf('references', refs, false).out);
  // (after block 8) No root YOUTUBE any more: its videos are REFERENCES -> YouTube -> Videos (the owner 2026-10-22).
  const roots = [references, video, kindNode('images', 'images', 'IMAGES'), audio];
  _stampNewest(roots, items);
  return roots;
}

// (phase TG, the owner 2026-10-21: "выделять строку в дереве зеленым цветом ... куда добавилось что-то новое") Every node
// says when the newest thing under it came (`newest`, ms) - the page lights the nodes holding something newer than when they
// were last opened (js/media-tree.js). Read by the node's own query, as the shelf filters.
function _inNode(i, q) {
  if (!q) return false;
  if (q.group) return !!(GROUPS[q.group] && GROUPS[q.group].includes(i.kind));
  if (q.filter && i.kind !== q.filter && !(q.filter === 'references' && i.kind === 'youtube')) return false;
  const m = i.meta || {};
  if (q.src) {
    const [s, fo] = String(q.src).split('/');
    if (m.categoryId || _siteOf(i) !== s || (fo && m.folder !== fo)) return false;
  }
  if (q.cat) {
    const c = m.categoryId || '';
    if (q.cat === UNCAT) { if (c && c !== UPLOADS_CAT) return false; }
    else if (q.cat === ANYCAT) { if (!c || c === UPLOADS_CAT) return false; }
    else if (c !== q.cat) return false;
  }
  return true;
}
function _stampNewest(nodes, items) {
  for (const n of nodes) {
    let best = 0;
    for (const i of items) { if (_inNode(i, n.q)) { const t = _ts(i.meta && i.meta.date); if (t > best) best = t; } }
    if (n.children) { _stampNewest(n.children, items); for (const c of n.children) if (c.newest > best) best = c.newest; }
    n.newest = best;
  }
}

router.get('/library/tree', (_req, res) => {
  try { res.json({ success: true, nodes: _tree() }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

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
// through the card variant of the thumbnail door.
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
// The shelf IS the renders folder: media/renders/<project folder>/ (and any render still loose at
// the top). No record store behind it, and that is deliberate: a render is kept by its file
// existing. The export flow deletes the file when you press Cancel on the preview, so "kept" and
// "on the shelf" cannot drift apart. An item's id is its path inside the renders folder.
const VID_RE = /\.(mp4|mov|webm|mkv)$/i;
const JOB = require('../lib/mv3b-job');

function _renderFiles() {
  const dir = FINALS_DIR;
  const out = [];
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const d of ents) {
    // A render still in the works (its draft name, lib/mv3b-job.js) is not on the shelf yet.
    if (d.isFile() && VID_RE.test(d.name) && !JOB.isDraft(d.name)) out.push(d.name);
    else if (d.isDirectory() && d.name !== 'thumbs') {
      try { for (const f of fs.readdirSync(path.join(dir, d.name))) if (VID_RE.test(f) && !JOB.isDraft(f)) out.push(`${d.name}/${f}`); } catch (e) { /* unreadable */ }
    }
  }
  return out;
}

// BY PROJECT (phase V23, the owner 2026-10-09): every render says which project's folder it is in and that project's
// title - a project deleted since keeps its folder's name, `nocat` and a loose file are no project - and how long it
// runs. The page draws a row per project (js/library/renders.js).
//
// A POSTER IS MADE, NOT MISSED (V23): a render with none gets one in the background (lib/render-posters.js), which
// also measures its length; `unreadable` is only a file ffmpeg could not open, `posterPending` one still waiting.
// `running` is how many are still to be looked at - the page asks again while there are any.
function _rendersShelf() {
  const dir = FINALS_DIR;
  const files = _renderFiles();
  const RP = require('../lib/render-posters');
  const titles = new Map();
  try {
    for (const e of require('../lib/projects-store').entries()) {
      if (e && e.folder) titles.set(String(e.folder).toLowerCase(), String(e.name || e.folder));
    }
  } catch (e) { /* no list: folder names */ }
  const work = [];
  const items = files
    .map(f => { let st = null; try { st = fs.statSync(path.join(dir, f)); } catch (e) { st = null; } return { f, st, m: st ? st.mtimeMs : 0 }; })
    .sort((a, b) => b.m - a.m)
    .map(({ f, st, m }) => {
      const url = toUrl(path.join(dir, f));
      const turl = VT.thumbUrlFor(url);
      const tabs = path.join(ROOT_DIR, String(turl).replace(/^\/+/, ''));
      const hasThumb = fs.existsSync(tabs);
      const top = f.includes('/') ? f.split('/')[0] : '';
      const folder = (!top || top.toLowerCase() === 'nocat') ? '' : top;
      const known = RP.info(f, st);
      if (st) work.push({ rel: f, abs: path.join(dir, f), url, hasThumb, st });
      return {
        id: f,
        // The output name is `local_<stamp>_<project title>.mp4`; the stamp is noise on a
        // card, and the date is already a column.
        name: path.posix.basename(f).replace(/\.[^.]+$/, '').replace(/^local_\d+_/, ''),
        kind: 'renders',
        media: url,
        thumb: hasThumb ? turl : null,
        meta: {
          date: m ? new Date(m).toISOString() : null,
          sizeMb: st ? Math.round(st.size / 1048576) : null,
          folder, project: folder ? (titles.get(folder.toLowerCase()) || folder) : null,
          dur: known.dur || 0,
          unreadable: !hasThumb && !!known.failed, posterPending: !hasThumb && !known.failed,
          why: known.failed || '',
        },
      };
    });
  const running = RP.want(work);
  RP.tidy(files);
  return { items, filters: [], running };
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

// The scenario store's own answer to "what narrator is this" (routes/scen3.js).
function _labels(s) {
  try { return require('./scen3').effectiveLabels(s); } catch (e) { return { narrator: null }; }
}

function _scenariosShelf() {
  const list = _read(SCEN3_FILE, []);
  // Archived ones are not on the shelf (phase D5): archiving is taking a scenario out of the list,
  // and Merge's picker, which has an archive of its own to restore from, already reads it that way.
  const items = (Array.isArray(list) ? list : [])
    .filter(s => s && !s.archived)
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    .map(s => ({
      id: String(s.id),
      name: s.title || 'untitled',
      kind: 'scenarios',
      media: null,
      thumb: null,
      meta: {
        type: s.type || '', vertical: s.vertical || '', product: s.product || '',
        // Every field the shelf filters by (phase F7): the role's name and gender apart, and the
        // narrator the scenario IS (its own, or the generator's when not set). No language (phase V29).
        role: ((Array.isArray(s.roles) ? s.roles : [])[0] || {}).name || '',
        gender: ((Array.isArray(s.roles) ? s.roles : [])[0] || {}).gender || '',
        narrator: (_labels(s).narrator || {}).name || '',
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

// How many lookbooks or environments are being made right now (phase I) - a chat's, or Merge's maker's.
// The page asks the shelf again while there are any, so what lands shows up on the grid by itself.
function _makingNow(type) {
  try {
    return require('../lib/alerts').list()
      .filter(r => r && r.state === 'running' && r.job && r.job.type === type).length;
  } catch (e) { return 0; }
}

const SHELVES = {
  characters:   _charactersShelf,
  lookbooks:    () => ({ items: _imageShelf(LOOKBOOKS_DIR, toUrl(LOOKBOOKS_DIR), 'lookbooks'), filters: [], running: _makingNow('lookbook') }),
  environments: () => ({ items: _imageShelf(ENVIRONMENTS_DIR, toUrl(ENVIRONMENTS_DIR), 'environments'), filters: [], running: _makingNow('environment') }),
  // Every character's looks in one list - read, not a shelf of the Library page: the video chat's right column offers
  // them for a "person" cell of a recipe (phase V6), each with its character (meta.charId) to group them by.
  looks:        () => ({ items: _looks().items.filter(x => x.media && _onDisk(x.media)), filters: [] }),
  media:        _mediaShelf,
  voices:       _voicesShelf,
  renders:      _rendersShelf,
  scenarios:    _scenariosShelf,
};

// The one category REFERENCES' pictures are under among Images, in the pickers.
const REF_CAT = '__references__';

// (phase TG, block 5d) THE FILES OF REFERENCES' POSTS, one item each, for what takes a file - the chats' pickers and the
// pictures chat's column: `type` 'video' or 'photo'; a post's folder (or own category) is the item's category. A long
// video kept as a tile has no file and is not here.
function _refFiles(type) {
  const REFS = require('../lib/references-store');
  const items = [];
  const cats = new Map();
  for (const p of REFS.read()) {
    if (!p || !Array.isArray(p.media)) continue;
    const files = p.media.filter(m => m && m.path && m.type === type && _onDisk(m.path));
    const catId = p.categoryId ? p.categoryId : 'ref:' + p.source + (p.folder ? '/' + p.folder : '');
    const catName = p.categoryId ? (p.categoryLabel || 'REFERENCES') : REFS.labelOf(p.source, p.folder);
    files.forEach((m, i) => {
      if (!cats.has(catId)) cats.set(catId, { id: catId, name: catName, label: catName, count: 0 });
      cats.get(catId).count++;
      items.push({
        id: p.id + ':' + m.id, name: String(p.title || 'post') + (files.length > 1 ? ` · ${i + 1} of ${files.length}` : ''),
        kind: 'references', media: m.path, thumb: m.thumb || null, dur: +m.dur || 0,
        meta: { categoryId: catId, date: p.receivedAt || null, w: m.w || 0, h: m.h || 0, post: p.id, author: p.author || '' },
      });
    });
  }
  return { items, cats: [...cats.values()] };
}

router.get('/library/shelf/:kind', (req, res) => {
  try {
    const kind = String(req.params.kind || '');
    const build = SHELVES[kind];
    if (!build) return res.status(404).json({ success: false, error: `no shelf "${kind}"` });
    // (phase TG, block 5d) REFERENCES' videos for the video chat's picker, by its folders and categories.
    if (kind === 'media' && String(req.query.filter || '') === 'refvideos') {
      const { items, cats } = _refFiles('video');
      return res.json({ success: true, kind, items, total: items.length, shown: items.length, filters: [], cats, labelKeys: null, running: 0 });
    }
    // Filtering happens here rather than in the page, so the count the page shows is the
    // count it received. Media takes two: the kind, and the category within it - or (phase V28.4) a GROUP of kinds,
    // a top node of the media tree: video (B-rolls, Hooks, Uploads), images, audio (music, sounds).
    const f = String(req.query.filter || '');
    const cat = String(req.query.cat || '');
    const grp = GROUPS[String(req.query.group || '')] || null;
    const { items, filters, labelFor, labelKeys, running } = kind === 'media'
      ? _mediaShelf({ music: f === 'music' || !!(grp && grp.includes('music')), heads: f === 'heads' || !!(grp && grp.includes('heads')),
        refs: f === 'references' || !!(grp && grp.includes('references')),
        youtube: f === 'youtube' })
      : build();
    // Built from the kind but BEFORE the category filter, so choosing a category does not
    // make every other chip read 0.
    const cats = (kind === 'media' && (!f || LC.KINDS.includes(f))) ? _mediaCats(items, f, labelFor) : [];
    let shown = items;
    if (grp) shown = shown.filter(i => grp.includes(i.kind));
    if (f) shown = shown.filter(i => i.kind === f || (f === 'references' && i.kind === 'youtube'));
    // (phase TG) A REFERENCES folder: "instagram", or "instagram/reels".
    const src = String(req.query.src || '');
    if (src) {
      const [s, fo] = src.split('/');
      // A post filed under an own category is in that category's folder, not its source's.
      shown = shown.filter(i => _inRefs(i) && !i.meta.categoryId && _siteOf(i) === s && (!fo || i.meta.folder === fo));
    }
    if (cat) shown = shown.filter(i => cat === UNCAT
      ? !(i.meta || {}).categoryId
      : cat === ANYCAT ? !!(i.meta || {}).categoryId && (i.meta || {}).categoryId !== UPLOADS_CAT
      : (i.meta || {}).categoryId === cat);
    // (phase TG, block 5d) Images, and REFERENCES' pictures as one more category - for the pictures' pickers and the
    // pictures chat's column (`refs=1`); the media tree's IMAGES never asks for them.
    let cats2 = cats;
    if (kind === 'media' && f === 'images' && String(req.query.refs || '') === '1' && (!cat || cat === REF_CAT)) {
      const r = _refFiles('photo');
      for (const i of r.items) i.meta.categoryId = REF_CAT;
      // The column of the pictures chat asks for one category at a time (`cat`); the pickers read the whole shelf.
      shown = cat === REF_CAT ? r.items : shown.concat(r.items);
      if (r.items.length) cats2 = cats.concat([{ id: REF_CAT, name: 'REFERENCES', label: 'REFERENCES · ' + r.items.length, count: r.items.length }]);
    }
    res.json({ success: true, kind, items: shown, total: items.length, shown: shown.length,
      filters: filters || [], cats: cats2, labelKeys: labelKeys || null, running: running || 0 });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── The right column: what one tile is (phase B, the owner 2026-09-29) ───────
// The Library page selects a tile on the Characters, Lookbooks and Environments shelves and shows
// what it is beside the grid - read here in one go, on every selection, so a voice given or a look
// made elsewhere shows up the next time the tile is pressed.
//   characters    { media, voices: [{ voiceId, name, tags, demo, dur, main }], looks }
//   lookbooks     { media, looks }            - the looks dressed in it (a look's `lb`)
//   environments  { media, description, motion } - what the place is and how it moves
//                                              (lib/shelf-meta.js; the video field animates by it)
function _voicesOf(c) {
  // The one every read uses first, then the rest of those saved for the character. The voice shelf
  // fills in what the character's own copy lacks: a character that only ever had `voice` carries no
  // name or demo for it.
  const shelf = new Map(VS.read().filter(e => e && e.voiceId).map(e => [String(e.voiceId), e]));
  const out = [];
  const seen = new Set();
  const add = (v, main) => {
    const id = String((v && v.voiceId) || '');
    if (!id || seen.has(id)) return;
    seen.add(id);
    const s = shelf.get(id) || {};
    const l = s.labels || {};
    const demo = [v.sample, s.demo].find(p => p && _onDisk(p)) || '';
    out.push({
      voiceId: id,
      // Empty when neither the character nor the shelf knows it - a voice taken before the shelf
      // existed; the page says so instead of printing its id as a name.
      name: String(v.name || s.name || '').trim(),
      tags: [v.gender || l.gender, v.age || l.age, v.accent || l.accent, v.descriptive || l.descriptive]
        .filter(Boolean).map(String),
      demo,
      dur: +v.dur || +s.dur || 0,
      main,
    });
  };
  const saved = (Array.isArray(c.voices) ? c.voices : []).filter(v => v && v.voiceId);
  if (c.voice) add(saved.find(v => String(v.voiceId) === String(c.voice)) || { voiceId: c.voice }, true);
  for (const v of saved) add(v, false);
  return out;
}

// A flat shelf's entry is its file: the id is the file name, and nothing else is accepted - a
// name with a separator in it is not a file on this shelf.
function _flatEntry(dir, id) {
  const f = String(id || '');
  if (!f || f !== path.basename(f) || !IMG_RE.test(f)) return null;
  if (!fs.existsSync(path.join(dir, f))) return null;
  return toUrl(dir) + '/' + f;
}

const INFO = {
  characters: (id) => {
    const chars = _read(path.join(DATA_DIR, 'characters.json'), []);
    const c = (Array.isArray(chars) ? chars : []).find(x => x && !x.draft && String(x.id) === id);
    if (!c) return null;
    const sheet = String(c.sheet || c.baseFace || '');
    return {
      media: (sheet && _onDisk(sheet)) ? sheet : null,
      voices: _voicesOf(c),
      looks: _looks().items.filter(l => l.meta.charId === id),
    };
  },
  // What is known about a lookbook (phase I): its gender and description - either may be empty, and
  // both can be written by hand in the column - and the picture it was made from.
  lookbooks: (id) => {
    const media = _flatEntry(LOOKBOOKS_DIR, id);
    if (!media) return null;
    const m = SM.read('lookbooks')[media] || {};
    return {
      media, looks: _looks().items.filter(l => l.meta.lookbook === media),
      gender: String(m.gender || ''), description: String(m.description || ''), from: String(m.from || ''),
    };
  },
  environments: (id) => {
    const media = _flatEntry(ENVIRONMENTS_DIR, id);
    if (!media) return null;
    const m = SM.read('environments')[media] || {};
    return { media, description: String(m.description || ''), motion: String(m.motion || ''), from: String(m.from || '') };
  },
};

// WRITTEN BY HAND IN THE COLUMN (phase I, the owner: shown, and filling them is optional). One writer
// per field: a lookbook's gender and description, an environment's description here; how a place
// moves keeps its own route (/api/scen3/env/motion). An empty value takes the field away.
//   PATCH /api/library/meta/:kind/:id   { description?, gender? }
// A lookbook's gender decides which lookbooks Merge offers a character, and its description is what
// the dressing reads - which is the point of correcting them.
const META_FIELDS = { lookbooks: ['description', 'gender'], environments: ['description'] };
const GENDERS = ['male', 'female', 'unisex'];
router.patch('/library/meta/:kind/:id', (req, res) => {
  try {
    const kind = String(req.params.kind || '');
    const fields = META_FIELDS[kind];
    if (!fields) return res.status(404).json({ success: false, error: `nothing to write on "${kind}"` });
    const media = _flatEntry(kind === 'lookbooks' ? LOOKBOOKS_DIR : ENVIRONMENTS_DIR, String(req.params.id || ''));
    if (!media) return res.status(404).json({ success: false, error: 'not on this shelf any more' });
    const b = req.body || {};
    if (b.gender != null && b.gender !== '' && !GENDERS.includes(String(b.gender))) {
      return res.status(400).json({ success: false, error: 'gender is male, female, unisex or nothing' });
    }
    const all = SM.read(kind);
    const m = { ...(all[media] || {}) };
    for (const f of fields) {
      if (b[f] == null) continue;
      const v = String(b[f]).trim().slice(0, 4000);
      if (v) m[f] = v; else delete m[f];
    }
    m.at = new Date().toISOString();
    all[media] = m;
    SM.write(kind, all);
    res.json({ success: true, kind, id: String(req.params.id), gender: String(m.gender || ''), description: String(m.description || '') });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/library/info/:kind/:id', (req, res) => {
  try {
    const kind = String(req.params.kind || '');
    const id = String(req.params.id || '');
    const build = INFO[kind];
    if (!build) return res.status(404).json({ success: false, error: `no right column for "${kind}"` });
    const out = build(id);
    if (!out) return res.status(404).json({ success: false, error: 'not on this shelf any more' });
    res.json({ success: true, kind, id, ...out });
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

const _write = (f, v) => writeFileAtomic(f, JSON.stringify(v, null, 2));

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

// Every path any SURVIVING record points at, across the media stores and the pictures. `doomed` is the set of
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
  // birols and uploads are one file; the pictures too, since a picture's own copy beside it now goes with it.
  for (const kind of ['birols', 'hooks', 'images', 'sounds', 'music']) {
    let list = [];
    try { list = RECORD_STORES[kind].read(); } catch (e) { continue; }
    for (const e of list) {
      if (!e || skip.has(String(e.id))) continue;
      for (const p of [e.videoPath, e.thumbPath, e.imagePath, e.audioPath]) if (p) used.add(String(p).split('?')[0]);
    }
  }
  // (phase TG, block 7) And what a clip delete must never take: the whole video a piece names (lib/cuts.js), a REFERENCES
  // post's file, a scenario source's video.
  for (const r of CUTS.records()) {
    if (skip.has(r.id)) continue;
    used.add(r.path);
    if (r.original && r.original.path) used.add(String(r.original.path).split('?')[0]);
  }
  return used;
}

// The whole videos the pieces of `doomed` named - for lib/cuts.js dropOrphans once those records are gone.
const _originalsOf = (doomed) => (doomed || []).flatMap(e => [e && e.original && e.original.path,
  ...((e && Array.isArray(e.media)) ? e.media.map(m => m && m.original && m.original.path) : [])]).filter(Boolean);

// What belongs to a file and goes with it: the derivatives a move carries along (lib/relocate.js siblingsOf) -
// its thumbs/ copy, a clip's poster, a preview, a clip's loudness mark. A picture made by an engine has a 600px
// copy in thumbs/ beside it (lib/helpers.js createThumbnail), and deleting the picture used to leave that copy
// behind with nothing pointing at it.
//
// A thumbs/ or preview/ copy is known only by the file's STEM, so while another file of that stem stays in the
// folder (x.png beside x.jpg) the copy is left: it may be the other one's. The loudness mark is named after the
// whole file name and always goes.
function _derivativesOf(abs) {
  let out = [];
  try { out = siblingsOf(abs, path.basename(abs)).map(([a]) => a); } catch (e) { return []; }
  const name = path.basename(abs);
  const stem = name.replace(/\.[^.]+$/, '');
  let twin = false;
  try { twin = fs.readdirSync(path.dirname(abs)).some(f => f !== name && !/\.norm$/i.test(f) && f.replace(/\.[^.]+$/, '') === stem); }
  catch (e) { twin = false; }
  return twin ? out.filter(a => /\.norm$/i.test(a)) : out;
}

// Unlink only what nothing else needs - and with each file that goes, what is derived from it. Reports what
// actually went and what was spared, so the page can say "the clip is gone" without claiming a file was removed
// when it was not.
function _unlinkUnused(paths, doomed) {
  const used = _pathsInUse(doomed);
  const removed = [], kept = [];
  const gone = new Set();          // taken already as a derivative of a file before it in the list
  for (const p of (paths || [])) {
    if (!p) continue;
    const clean = String(p).split('?')[0];
    if (used.has(clean)) { kept.push(clean.split('/').pop()); continue; }
    if (gone.has(clean)) { removed.push(clean.split('/').pop()); continue; }
    const abs = _absInRoot(clean);
    const derived = abs ? _derivativesOf(abs) : [];        // read while the file is still there
    if (!_unlink(p)) continue;
    removed.push(clean.split('/').pop());
    for (const d of derived) {
      const url = toUrl(d);
      if (!url || used.has(url)) continue;
      if (_unlink(url)) gone.add(url);
    }
  }
  return { removed, kept };
}

// A record store: how to read its list, where the list lives inside the file, which
// fields the page may set, and which files belong to one entry.
// `thumbPath` is patchable because the media shelf reads `thumb` from the RECORD, not from disk, so the thumbnail
// repair in the Library writes the new path back through PATCH. (These stores were once the browser's, kept in step
// through localStorage - `lsKey` - by the Birols page's sync; that page is gone, and the key with it, phase V23.)
const RECORD_STORES = {
  // (phase TG, block 5b) REFERENCES' posts - here for their own categories (renamed, deleted with their posts or with
  // the posts let go to their sources' folders). A post's name is `title`, its files several.
  references: {
    file: path.join(DATA_DIR, 'references.json'),
    read: () => require('../lib/references-store').read(),
    write: (list) => _write(path.join(DATA_DIR, 'references.json'), list),
    fields: [],
    files: (e) => [e.poster, ...(Array.isArray(e.media) ? e.media : []).flatMap(m => [m && m.path, m && m.thumb])].filter(Boolean),
  },
  birols: {
    file: BIROLY_FILE,
    read: () => { const s = _read(BIROLY_FILE, {}); return Array.isArray(s.archive) ? s.archive : []; },
    write: (list) => { const s = _read(BIROLY_FILE, {}); s.archive = list; _write(BIROLY_FILE, s); },
    fields: ['name', 'favorite', 'categoryId', 'categoryLabel', 'thumbPath'],
    files: (e) => [e.videoPath, e.thumbPath],
  },
  hooks: {
    file: HOOKS_FILE,
    read: () => { const l = _read(HOOKS_FILE, []); return Array.isArray(l) ? l : []; },
    write: (list) => _write(HOOKS_FILE, list),
    fields: ['name', 'favorite', 'categoryId', 'categoryLabel', 'thumbPath'],
    files: (e) => [e.videoPath, e.thumbPath],
  },
  obrazy: {
    file: OBRAZY_FILE,
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
      const m = url.match(/^\/media\/looks\/([^/]+)\//);
      if (m) return path.join(OBRAZY_DIR, m[1]);
      try { return obrazAbsFolder(o.name || '', o.id); } catch (e) { return null; }
    },
  },
  // thumbPath is not patchable here - the shelf builds its thumb URL through /api/thumb, so there is no stored path
  // that could go stale.
  images: {
    file: IMG.FILE,
    read: IMG.read,
    write: IMG.write,
    fields: ['name', 'favorite', 'categoryId', 'categoryLabel'],
    files: (e) => [e.imagePath],
  },
  // (phase V7) The Sounds shelf - server-owned like images (lib/sounds-store.js).
  sounds: {
    file: SND.FILE,
    read: SND.read,
    write: SND.write,
    fields: ['name', 'favorite', 'categoryId', 'categoryLabel'],
    files: (e) => [e.audioPath],
  },
  // (phase V28.4, second round) The talking heads KEPT from deleted projects (lib/heads.js, data/heads.json): deleted one
  // by one, with the file. A take of a project that is still there is not here - it is the project's.
  heads: {
    file: require('../lib/heads').FILE,
    read: () => require('../lib/heads').readKept(),
    write: (list) => require('../lib/heads').writeKept(list),
    fields: [],
    files: (e) => [e.path],
  },
  // (phase V28.4) The music (lib/music-store.js): no categories; a track goes with its file, as everything on Media
  // (the owner); its name is the record's `title`.
  music: {
    file: MUSIC.FILE,
    read: MUSIC.read,
    write: MUSIC.write,
    fields: ['name', 'favorite'],
    files: (e) => [e.audioPath],
  },
};
// Uploads are birols with a flag, so they share the store.
RECORD_STORES.uploads = RECORD_STORES.birols;

// Lookbooks and environments are not records at all — the shelf IS the directory.
// Delete-only by design: these filenames are referenced by look records (a look can
// point at a lookbook image), so renaming the file would silently break them.
const FILE_SHELVES = {
  lookbooks:    { dir: LOOKBOOKS_DIR,    url: toUrl(LOOKBOOKS_DIR) },
  environments: { dir: ENVIRONMENTS_DIR, url: toUrl(ENVIRONMENTS_DIR) },
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
    // (phase V28.4) A track's name is its title: the music panel and the video chat read that.
    if (kind === 'music' && 'name' in patch) { patch.title = patch.name; delete patch.name; }

    Object.assign(it, patch);
    store.write(list);
    // Another category is another folder: the files move there, and every path to them with them.
    let item = it;
    if ('categoryId' in patch && SHELF.SHELF_KINDS.includes(kind)) {
      SHELF.placeRecords([{ kind, rec: it }]);
      item = store.read().find(x => x && String(x.id) === id) || it;
    }
    // The page needs this to patch localStorage, so send back what to look for.
    res.json({ success: true, kind, id, patch, item });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

/* ── Cutting a piece out of a video (phase TG, block 7) ──────────────────────
   POST /api/library/cut { src, in, out, to: { kind, cat, label } } -> { success, kind, id, item }

   A PIECE IS A NEW FILE AND A NEW TILE (the owner 2026-10-21, "вариант Б"): cut from `src` between `in` and `out` (its
   own seconds), filed where the person chose in the window after choosing the stretch - a kind of VIDEO (birols,
   uploads, hooks; a category by its label, made when new) or REFERENCES (a post of its own: an own category `cat`, or
   the folder of the site its whole video came from, Files when none). The video it was cut from is not touched.

   The piece keeps its whole video (`original`, lib/cuts.js): a piece of a piece names the first one, so its viewer's
   "original" always shows the whole video and cuts from it again. This replaces the old rule "an upload is trimmed
   ONCE and its file cut" - a clip trimmed that way keeps what it had (`trimmed`) and has no "original". */
const CUTS = require('../lib/cuts');
const CUT_KINDS = ['birols', 'uploads', 'hooks', 'references'];

router.post('/library/cut', async (req, res) => {
  const b = req.body || {};
  const to = b.to || {};
  const kind = String(to.kind || '');
  const cat = String(to.cat || '');
  const label = String(to.label || '').trim().slice(0, 60);
  let made = null, thumbPath = null;
  try {
    if (!CUT_KINDS.includes(kind)) return res.status(400).json({ success: false, error: 'a piece goes into VIDEO or REFERENCES' });
    if (kind === 'references' && cat && !LC.find('references', cat)) return res.status(400).json({ success: false, error: 'no such category in REFERENCES' });
    made = await CUTS.cut(String(b.src || ''), +b.in, +b.out);
    try { thumbPath = (await VT.makeThumb(made.videoPath)).thumb; } catch (e) { console.warn('[library/cut] poster failed:', e.message); }

    if (kind === 'references') {
      const REFS = require('../lib/references-store');
      const from = made.root.post;
      const abs = _absInRoot(made.videoPath);
      let size = 0;
      try { size = fs.statSync(abs).size; } catch (e) { size = 0; }
      const post = REFS.add({
        source: from ? (from.source || 'other') : 'files', folder: from ? (from.folder || '') : '',
        categoryId: cat, categoryLabel: cat ? label : '',
        title: made.name, author: from ? (from.author || '') : '', link: from ? (from.link || '') : (made.root.link || ''),
        linkKey: '', caption: '', note: '', origin: from ? (from.origin || '') : '', postedAt: from ? (from.postedAt || '') : '',
        from: 'cut', poster: thumbPath, remote: null,
        media: [{ id: require('crypto').randomBytes(4).toString('hex'), type: 'video', path: made.videoPath, thumb: thumbPath,
          w: made.w, h: made.h, dur: Math.round(made.dur * 10) / 10, size, original: made.original }],
      });
      REFS.placePosts([REFS.read().find(p => p && p.id === post.id)]);
      const item = REFS.read().find(p => p && p.id === post.id) || post;
      try { require('./proxies').warmProxies([item.media[0].path], 480); } catch (e) { /* made when laid */ }
      console.log('[library/cut]', made.original.path, made.original.in + 's..' + made.original.out + 's -> references', item.media[0].path);
      return res.json({ success: true, kind, id: item.id, item });
    }

    const { item } = _fileRecord({
      videoPath: made.videoPath, thumbPath, name: made.name, kind, categoryLabel: kind === 'hooks' ? '' : label,
      original: made.original, duration: made.dur, w: made.w, h: made.h, link: made.root.link || '',
    });
    console.log('[library/cut]', made.original.path, made.original.in + 's..' + made.original.out + 's ->', kind, item.videoPath);
    res.json({ success: true, kind, id: item.id, item });
  } catch (e) {
    // A file made and not filed is nobody's: it goes, with its poster.
    if (made && made.videoPath) for (const u of [made.videoPath, thumbPath]) if (u) _unlink(u);
    res.status(e.status || 500).json({ success: false, error: e.message });
  }
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
      // And its preview, made for a large one when it was filed (routes/scen3.js _previewTarget) - it
      // was left behind before phase I, where every environment the chat makes has one.
      _unlink(`${shelf.url}/preview/${base.replace(/\.[^.]+$/, '.jpg')}`);
      // What the agent wrote about it goes with it (lib/shelf-meta.js) - an entry for a picture
      // that no longer exists is only something a later picture of the same name could inherit.
      try { require('../lib/shelf-meta').drop(kind, `${shelf.url}/${base}`); }
      catch (e) { console.warn('[library] could not drop the description of', base, e.message); }
      return res.json({ success: true, kind, id, removed });
    }

    // Renders. No record to remove - the file IS the entry - so this unlinks the video and its
    // poster and nothing else. The finals archive (data/finals-meta.json) is left alone on purpose:
    // GET /api/finals/list already drops entries whose file has gone, so it heals itself rather
    // than needing a second writer here.
    if (kind === 'renders') {
      const base = path.basename(id);
      if (!base || !VID_RE.test(base)) return res.status(400).json({ success: false, error: 'not a render' });
      // The id is the render's path inside media/renders/ - its project folder and name.
      const abs = toDiskWithin('/media/renders/' + String(id).replace(/\\/g, '/'), [FINALS_DIR]);
      if (!abs || !fs.existsSync(abs)) return res.status(404).json({ success: false, error: 'not found' });
      const url = toUrl(abs);
      if (_unlink(url)) removed.push(base);
      const turl = VT.thumbUrlFor(url);
      if (turl) _unlink(turl);
      // Its subtitles file beside it (phase V30, block 4).
      try { fs.rmSync(JOB.srtOf(abs), { force: true }); } catch (e) { /* held open */ }
      return res.json({ success: true, kind, id, removed });
    }

    const store = RECORD_STORES[kind];
    if (!store) return res.status(400).json({ success: false, error: `"${kind}" cannot be deleted here` });
    const list = store.read();
    const it = list.find(x => x && String(x.id) === id);
    if (!it && kind === 'heads') return res.status(409).json({ success: false, error: 'This talking head is its project\'s - it is deleted in the project, or kept when the project is deleted.' });
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
    // A piece's whole video, when nothing holds it any more (phase TG, block 7).
    if (withFiles) removed.push(...CUTS.dropOrphans(_originalsOf([it])));
    // `spared` is a file another record is still using, so it stayed put.
    res.json({ success: true, kind, id, removed, spared });
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
    // A MOVED CLIP ARRIVES AS THE NEWEST THING ON ITS NEW SHELF. The shelf is ordered by `date`
    // (favourites first), and a clip that kept the date it was uploaded landed wherever that old
    // date put it - in the middle of the grid, looking as if the move had not happened. The
    // original date is kept beside it as `uploadedAt`, so nothing about when it came in is lost.
    const now = new Date().toISOString();
    const stamp = (rec) => { if (!rec.uploadedAt) rec.uploadedAt = it.date || now; rec.date = now; };

    if (src.file === dst.file) {
      if (to === 'uploads') it.source = 'upload';
      else delete it.source;
      if (it.categoryId === UPLOADS_CAT) it.categoryId = '';       // the legacy marker is not a category
      stamp(it);
      src.write(srcList);
      // Another shelf is another folder.
      SHELF.placeRecords([{ kind: to, rec: it }]);
      const placed = src.read().find(x => x && String(x.id) === id) || it;
      return res.json({ success: true, kind: to, id, item: placed });
    }

    // Different stores: build the record the destination expects, then write the
    // destination FIRST. If the second write fails the clip is listed twice, which is
    // visible and fixable; the other order would make it disappear.
    const moved = {
      id: it.id,
      name: it.name,
      videoPath: it.videoPath,
      thumbPath: it.thumbPath || null,
      date: now,
      uploadedAt: it.uploadedAt || it.date || now,
    };
    // The one-time trim travels with the clip. Rebuilding the record for the other store used
    // to drop it: an upload moved to Hooks before it was trimmed lost the trim it was owed, and
    // one moved after lost the note of what it was cut to. Its length goes too, so a drop onto a
    // lane lands at the right width instead of reading the file first.
    if (it.trimmable) moved.trimmable = true;
    if (it.trimmed) moved.trimmed = it.trimmed;
    if (it.duration) moved.duration = it.duration;
    // (phase TG, block 7) A piece keeps its whole video wherever it is filed - and where it came from by a link.
    if (it.original) moved.original = it.original;
    if (it.w) { moved.w = it.w; moved.h = it.h; }
    if (it.link) moved.link = it.link;
    if (it.linkKey) moved.linkKey = it.linkKey;
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
    // Another shelf is another folder: the files move, the record and every other path follow.
    SHELF.placeRecords([{ kind: to, rec: moved }]);
    Object.assign(moved, dst.read().find(x => x && String(x.id) === String(moved.id)) || {});
    // BECOMING A HOOK IS WHEN A HOOK GETS ITS NUMBER. A file uploaded straight onto Hooks is
    // numbered as it is filed (POST /library/media/record); one moved here from Uploads used to
    // wait for the next time a browser pushed the hooks archive - which the Merge page never
    // does - so it sat on the shelf with no number at all.
    if (to === 'hooks') { try { require('../lib/hook-ids').assign([moved.videoPath]); } catch (e) {} }
    res.json({ success: true, kind: to, id, item: moved });
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
      for (const id of doomed) dropped.push({ id, store: kind });
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
        store: kind, videoPath,
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
      for (const id of doomed) dropped.push({ id, store: kind });
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
    const { item, kind } = _fileRecord(req.body || {});
    res.json({ success: true, item, kind });
  } catch (e) { res.status(e.status || 500).json({ success: false, error: e.message }); }
});

// The filing itself, for the route above and for a clip that came in by a link (phase V27, lib/link-queue.js): the
// same record, the same place, the same proxy and hook number as a file brought in by hand. Throws with `status`.
function _fileRecord(b) {
  const _no = (status, msg) => { const e = new Error(msg); e.status = status; return e; };
  const { videoPath, thumbPath, name, refImage, prompt, categoryLabel } = b;
  if (!videoPath || !_onDisk(videoPath)) throw _no(400, 'videoPath must be a file that exists');
  // Which kind the clip is filed as follows what the page had open, so uploading while
  // looking at Hooks puts it among the hooks. Uploads is the default: it is what "All"
  // means, and it is where a file you brought in belongs when nothing says otherwise.
  const kind = ['birols', 'uploads', 'hooks'].includes(String(b.kind)) ? String(b.kind) : 'uploads';
  const store = RECORD_STORES[kind];
  const list = store.read();
  if (list.some(e => e && e.videoPath === videoPath)) throw _no(409, 'already on the shelf');
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
  // FILED UNDER A NAME, not an id. The caller knows it wants "grok-imagine" and has no way
  // to know which id that resolved to - and LC.add is idempotent by label, handing back the
  // existing chip rather than making a second one with the same name, so asking for it every
  // time is the same as asking whether it exists. Hooks have no category machinery.
  if (categoryLabel && kind !== 'hooks') {
    try {
      const { cat } = LC.add(kind === 'uploads' ? 'uploads' : kind, String(categoryLabel));
      rec.categoryId = cat.id;
      rec.categoryLabel = cat.label;
    } catch (e) { console.warn('[media/record] category', categoryLabel, 'failed:', e.message); }
  }
  // WHERE IT CAME FROM. A clip animated out of a still keeps a path back to that picture,
  // so the viewer can show what it was made from - a generated 6 seconds is very hard to
  // place months later, and the reference frame is the one thing that identifies it.
  // Only set when given: every other way of filing a record leaves it absent.
  if (refImage && _onDisk(refImage)) rec.refImage = String(refImage);
  if (prompt) rec.prompt = String(prompt).slice(0, 2000);
  // `trimmable` - a file brought in by hand - is still written by the ways in, and read by nobody since phase TG
  // block 7: every video of the shelf may be cut into new pieces (POST /library/cut).
  if (b.trimmable === true) rec.trimmable = true;
  // (phase V27) A clip that came in by a link keeps it - the viewer shows it - and what it is known by under every
  // spelling of it (lib/ytdlp.js info().key), so the same video is not fetched onto the shelf twice.
  if (b.link) rec.link = String(b.link).slice(0, 2000);
  if (b.linkKey) rec.linkKey = String(b.linkKey).slice(0, 200);
  // (phase TG, block 7) A piece cut out of a video: its whole video (lib/cuts.js), its length and frame.
  if (b.original && b.original.path) {
    const o = b.original;
    rec.original = { path: String(o.path), in: +o.in || 0, out: +o.out || 0, dur: +o.dur || 0, name: String(o.name || '').slice(0, 120) };
  }
  if (+b.duration > 0) rec.duration = Math.round(+b.duration * 100) / 100;
  if (+b.w > 0 && +b.h > 0) { rec.w = +b.w; rec.h = +b.h; }
  list.unshift(rec);
  store.write(list);
  // Filed means placed: the file leaves media/work/ (or wherever it was) for its kind and
  // category's folder, and anything already pointing at it - a take already on a timeline -
  // follows (lib/shelf-files.js).
  SHELF.placeRecords([{ kind, rec }]);
  const item = store.read().find(e => e && e.id === rec.id) || rec;
  // On the shelf means it can land on a lane: its preview proxy is queued now, and a
  // hook also gets its permanent number (H01, H02 - see lib/hook-ids.js).
  try { require('./proxies').warmProxies([item.videoPath], 480); } catch (e) {}
  if (kind === 'hooks') { try { require('../lib/hook-ids').assign([item.videoPath]); } catch (e) {} }
  return { item, kind };
}

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
  return { moved: n };
}

// All three lists in one request. The dropdown on a card has to offer the list belonging to
// THAT card's kind, and a grid on the All filter shows all three kinds at once, so the page
// needs every list up front rather than one per card.
router.get('/library/cats', (_req, res) => {
  try {
    const byKind = {};
    for (const k of LC.KINDS) {
      // (second round) In the tree's order: the locked first, the rest alphabetical.
      byKind[k] = LC.listFor(k, {}, null).map(c => ({ id: c.id, label: c.label, own: c.own, locked: c.locked, title: c.title }))
        .sort((a, b) => (Number(!!b.locked) - Number(!!a.locked)) || _abc(a.title || a.label, b.title || b.label));
    }
    res.json({ success: true, byKind });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/library/cats', (req, res) => {
  try {
    const { kind, label } = req.body || {};
    if (!LC.KINDS.includes(String(kind))) return res.status(400).json({ success: false, error: 'kind must be one of ' + LC.KINDS.join(', ') });
    const { cat, created } = LC.add(String(kind), label);
    res.json({ success: true, cat, created });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

router.patch('/library/cats/:id', (req, res) => {
  try {
    const id = String(req.params.id || '');
    const kind = String((req.body || {}).kind || '');
    const label = String((req.body || {}).label || '').trim();
    if (!LC.KINDS.includes(kind)) return res.status(400).json({ success: false, error: 'kind must be one of ' + LC.KINDS.join(', ') });
    if (id === LC.UNCAT) return res.status(400).json({ success: false, error: 'Uncategorized is not a category' });
    if (LC.isLocked(kind, id)) return res.status(409).json({ success: false, error: 'This category is required - it cannot be renamed.' });
    if (!label) return res.status(400).json({ success: false, error: 'a category needs a name' });

    // An orphan becomes a real category first, under the name its records carry.
    if (!LC.isOwn(kind, id)) {
      const { list, inKind } = _kindRecords(kind);
      const one = list.find(e => inKind(e) && String(e.categoryId || '') === id);
      LC.adopt(kind, id, (one && one.categoryLabel) || label);
    }
    // The label changes, the folder moves with every path under it, and the copies of the
    // label on the records are refreshed.
    const cat = SHELF.renameCategory(kind, id, label);
    const { moved } = _reassign(kind, id, cat.id, cat.label);
    res.json({ success: true, cat, renamed: true, moved });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

// media=move   (the default) clears the category off its clips, so they land in Uncategorized -
//              and their files in the kind's nocat/ folder
// media=delete REMOVES those clips: files unlinked, records dropped. Irreversible, and the
//              page states the count in the confirmation before it can be chosen.
//
// Any chip can go except All and Uncategorized. A category is removed from the store and its
// emptied folder goes; an orphan has nothing stored - it exists only because records point at it.
router.delete('/library/cats/:id', (req, res) => {
  try {
    const id = String(req.params.id || '');
    const kind = String(req.query.kind || '');
    const mode = String(req.query.media || 'move') === 'delete' ? 'delete' : 'move';
    if (!LC.KINDS.includes(kind)) return res.status(400).json({ success: false, error: 'kind must be one of ' + LC.KINDS.join(', ') });
    if (id === LC.UNCAT) return res.status(400).json({ success: false, error: 'Uncategorized is not a category' });
    // Refused BEFORE its media are moved or deleted below.
    if (LC.isLocked(kind, id)) return res.status(409).json({ success: false, error: 'This category is required - it cannot be deleted.' });
    let affected = 0, removedFiles = [], sparedFiles = [];
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
      removedFiles.push(...CUTS.dropOrphans(_originalsOf(doomed)));
      affected = doomed.length;
    } else {
      const { list, inKind } = _kindRecords(kind);
      const ids = new Set(list.filter(e => inKind(e) && String(e.categoryId || '') === id).map(e => String(e.id)));
      const r = _reassign(kind, id, '', '');
      affected = r.moved;
      // Uncategorized is a folder too: the files go to nocat, and every path to them follows.
      const { list: now } = _kindRecords(kind);
      // (phase TG) A post let go of goes back to its source's folder - its files several.
      if (kind === 'references') require('../lib/references-store').placePosts(now.filter(e => e && ids.has(String(e.id))));
      else SHELF.placeRecords(now.filter(e => e && ids.has(String(e.id))).map(rec => ({ kind, rec })));
    }
    // The clips are resolved; now the chip itself, and its folder.
    let disposition;
    const folder = (LC.find(kind, id) || {}).folder;
    if (LC.isOwn(kind, id)) { LC.remove(kind, id); disposition = 'removed'; }
    else { disposition = 'orphan'; }          // nothing to store: it lived on its records alone
    SHELF.dropEmptyFolder(kind, folder);
    res.json({ success: true, id, kind, mode, affected, removedFiles, sparedFiles, disposition });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

// ── WHERE A FILE IS USED (phase V28.4, the owner 2026-10-12) ───────────────────
// Asked before something is deleted from the library: the projects (the draft too) whose timelines hold it, and how
// many clips in each - the deleting question names them, and there the clips turn red (lib/timeline-media.js).
//   POST /api/library/usage { media: [address, ...] }       some files
//   POST /api/library/usage { kind, cat }                   everything in a category ('__uncat__': in none)
//   -> { projects: [{ key, title, draft, clips }] }
router.post('/library/usage', (req, res) => {
  try {
    const b = req.body || {};
    let media = (Array.isArray(b.media) ? b.media : []).map(String).filter(Boolean).slice(0, 5000);
    if (!media.length && b.kind && RECORD_STORES[String(b.kind)]) {
      const kind = String(b.kind);
      const cat = String(b.cat || '');
      const store = RECORD_STORES[kind];
      const inKind = LC.KINDS.includes(kind) ? _kindRecords(kind).inKind : () => true;
      for (const e of store.read()) {
        if (!e || !inKind(e)) continue;
        const c = String(e.categoryId || '');
        if (cat === UNCAT ? (c && c !== UPLOADS_CAT) : c !== cat) continue;
        for (const p of (store.files ? store.files(e) : [])) if (p) media.push(String(p));
      }
    }
    res.json({ success: true, projects: require('../lib/timeline-media').usage(media) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Counts for every shelf at once, for the switcher — cheap enough to do on load and
// it means the page never shows a shelf without saying how much is in it.
router.get('/library/counts', (_req, res) => {
  try {
    const out = {};
    for (const [kind, build] of Object.entries(SHELVES)) {
      // (phase V28.4) Media counts its music too - the Music shelf is Audio -> Music there now.
      try { out[kind] = (kind === 'media' ? _mediaShelf({ music: true, heads: true, refs: true, youtube: true }) : build()).items.length; } catch (e) { out[kind] = 0; }
    }
    res.json({ success: true, counts: out });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// (phase V27) The filing of a clip brought in, for one that came by a link (lib/link-queue.js).
router.fileRecord = _fileRecord;

module.exports = router;
