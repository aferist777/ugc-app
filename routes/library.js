'use strict';

// ════════════════════════════════════════════════════════════════════════════
// LIBRARY — one endpoint per shelf, one shape for every kind.
//
//   GET /api/library/shelf/:kind        kind: a key of SHELVES (below) - characters,
//                                             media, voices, renders, scenarios...
//   GET /api/library/info/:kind/:id     what the right column says about one tile
//   GET /api/library/counts             one number per shelf, for the switcher
//   GET /api/library/tree               the media tree: REFERENCES, VIDEO, IMAGES, AUDIO with their folders (V28.4)
//   -> { items: [{ id, name, kind, media, thumb, meta }], cats }
//
// `thumb` is what the grid draws and `media` is what the viewer opens. They are
// never the same file unless no thumbnail exists — the old shelf drew full frames
// and even whole videos into 72px cards, which is the mistake this shape prevents.
//
// `cats` are the categories of a Media kind with their counts, Uncategorized first (the
// 3D Studio's picture picker reads them). The server sends them because only the server
// knows what is actually in the data.
//
// Looks are not a shelf: they belong to a character and show beside it.
//
// Besides the shelves it renames, stars, files, moves and deletes their items and folders (below).
// ════════════════════════════════════════════════════════════════════════════

const express = require('express');
const fs      = require('fs');
const { writeFileAtomic } = require('../lib/atomic-write');
const path    = require('path');
const router  = express.Router();

const {
  LOOKBOOKS_DIR, ENVIRONMENTS_DIR, PROPS_DIR, OBRAZY_DIR, OBRAZY_FILE, DATA_DIR, ROOT_DIR,
  FINALS_DIR,
} = require('../lib/config');
const { toUrl, toDiskWithin, toDiskExisting } = require('../lib/media');
const { siblingsOf } = require('../lib/relocate');
const LC = require('../lib/library-cats');
// (phase V78) THIS PROJECT's folders of links to the library's media.
const PLINKS = require('../lib/project-links');
// Where a shelf item's files live - its kind and category's folder - and moving them there.
const SHELF = require('../lib/shelf-files');
const VS = require('../lib/voice-shelf');
const VT = require('../lib/video-thumb');
// What is known about a picture on a flat shelf - here, an environment's description and motion.
const SM = require('../lib/shelf-meta');
const IMG = require('../lib/images-store');
const SND = require('../lib/sounds-store');
const MUSIC = require('../lib/music-store');
// (phase V59.1, (мз6а)) AUDIO -> Music -> Lyrics: the saved texts - tiles with no file (_lyricItems).
const LY = require('../lib/lyrics-store');
// (phase V54 block 6) Folders in folders: renamed, moved, emptied with everything in them.
const FOLDERS = require('../lib/folders');

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
// (phase V60.2, the owner's (дг4а)) Every B-roll in the folder of the model that made it: the first time, the library is moved
// into the models' folders (its stores copied into backups/ first); after that a clip lying outside them goes into its
// model's. A library in order is left alone (lib/model-folders.js sweep).
try { require('../lib/model-folders').sweep(); }
catch (e) { console.warn('[models] the B-rolls were not all put into their models\' folders -', e.message); }
const MF = require('../lib/model-folders');

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
// What a query asks with for the records filed under no category - what lies directly in a node.
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
  return { items };
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

// ── Media (birols + uploads + hooks + images + sounds; the rest when asked) ──
// Birols and uploads live in one archive, split by a flag on the record (`source`); hooks
// have their own, and so do images and sounds. One shelf — they are all "something
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
  const m = { path: o.path, in: +o.in || 0, out: +o.out || 0, dur: +o.dur || 0, name: o.name || '' };
  const parts = _origParts(o);
  if (parts) m.parts = parts;
  return m;
}

// (phase V81) A JOINED piece names every fragment of its whole video it was joined from (lib/cuts.js cutMany).
function _origParts(o) {
  if (!o || !Array.isArray(o.parts) || !o.parts.length) return null;
  return o.parts.slice(0, 2000).map((p) => ({ in: Math.round((+p.in || 0) * 100) / 100, out: Math.round((+p.out || 0) * 100) / 100 }));
}

// A clip whose record lost its poster still has one beside it on disk (lib/video-thumb.js) - shown
// instead of "no thumb" (phase J4), the way the renders shelf finds its own.
function _posterOf(thumb, video) {
  if (thumb) return thumb;
  const t = VT.thumbUrlFor(video);
  return (t && _onDisk(t)) ? t : null;
}

// (phase V34.E) A sound's tags for the search: its own (found online), else the words of its name.
function _soundTags(e) {
  const m = e.meta || {};
  if (Array.isArray(m.tags) && m.tags.length) return m.tags.map(String).slice(0, 20);
  return String(e.name || '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2).slice(0, 12);
}
// What the tile's "About" says: where a sound found online came from (author, licence, page), what a made one was asked.
function _soundInfo(e) {
  const m = e.meta || {};
  const o = m.online;
  if (o) {
    return {
      author: o.creator || '', authorUrl: o.creatorUrl || '',
      license: (String(o.license || '').toUpperCase() + (o.licenseVersion ? ' ' + o.licenseVersion : '')).trim(), licenseUrl: o.licenseUrl || '',
      // (phase V54) Found on Freesound directly, or through Openverse (Wikimedia's sounds are its `wikimedia_audio`).
      from: (o.source === 'freesound' ? 'Freesound' : /^wikimedia/.test(String(o.source || '')) ? 'Wikimedia Commons' : (o.source || ''))
        + (o.via === 'Freesound' ? '' : ' via Openverse'),
      url: o.landing || '', attribution: o.attribution || '', preview: !!o.preview,
    };
  }
  if (m.prompt) return { prompt: String(m.prompt), engine: m.engine || '', mode: m.mode || '' };
  return null;
}

// (phase V28.4) `opts.music`: Suno's tracks and the ones brought in (lib/music-store.js) as a sixth kind, `music` - only
// when asked for (Audio -> Music in the media tree): every other reader of this shelf - the video chat, the pictures
// chat, the Library's chats, the 3D Studio, Media's checks - reads it as it always was.
function _mediaShelf(opts) {
  const bir = _read(path.join(DATA_DIR, 'biroly.json'), { archive: [] });
  const arch = Array.isArray(bir.archive) ? bir.archive : [];
  const hooks = _read(path.join(DATA_DIR, 'hooks-archive.json'), []);
  const cstate = LC.read();

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
      // (phase V60.2) A B-roll: the model whose folder it lies in - a dropdown offers its own model's folders.
      ...(_isUpload(e) ? {} : { model: MF.modelOfCat(cstate, e.categoryId) }),
    },
  }));
  const fromHooks =(Array.isArray(hooks) ? hooks : []).filter(h => h && h.videoPath).map((h, i) => ({
    id: String(h.id || ('hook:' + i)),
    name: String(h.name || '').trim() || 'hook',
    kind: 'hooks',
    media: h.videoPath,
    thumb: _posterOf(h.thumbPath, h.videoPath),
    // `favorite` and `categoryId` are read back here on purpose: the star and the category
    // dropdown write them, so leaving either out would let you set it and see no change.
    // An older hook record carries no duration; 0 means "ask the file", which is what
    // the timeline falls back to.
    dur: +h.duration || 0,
    meta: { categoryId: h.categoryId || '', date: h.date || null, favorite: !!h.favorite,
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
  // (phase V34.E) With their waveform (lib/audio-wave.js), their tags, where they came from (a sound found online: its
  // author, licence and page; one made here: what was asked) and the sound a piece was cut from - the tile's "About".
  const fromSounds = SND.read().filter(e => e && e.audioPath).map(e => ({
    id: String(e.id),
    name: String(e.name || '').trim() || 'sound',
    kind: 'sounds',
    media: e.audioPath,
    thumb: null,
    dur: +e.duration || 0,
    meta: { categoryId: e.categoryId || '', categoryLabel: e.categoryLabel || '', date: e.date || null, favorite: !!e.favorite,
            source: e.source || 'upload', wave: Array.isArray(e.wave) ? e.wave : [], tags: _soundTags(e), info: _soundInfo(e),
            original: (e.meta && e.meta.original) || null,
            // (2026-11-09, the owner's (в19)) it lies in AUDIO itself, not in My sounds (lib/sounds-store.js)
            inAudio: !!e.inAudio },
  }));

  // (phase V28.4) Music - no picture; its length kept on the record (measured once for the older ones). (phase V54) Its own
  // folders: `categoryId`, as the other kinds.
  // (phase V35) Where it lies in Music (lib/music-store.js placeOf, V34.F): `folder` 'highlights' or '', `mood` - the mood
  // folder it is in, `moodMade` - the preset it was made by (the one mood it may go into).
  const placeOf = typeof MUSIC.placeOf === 'function' ? MUSIC.placeOf : () => ({ folder: '', mood: '', moodMade: '' });
  const fromMusic = !(opts && opts.music) ? [] : MUSIC.read().filter(t => t && t.audioPath).map(t => ({
    id: String(t.id || t.audioPath),
    name: String(t.title || '').trim() || 'track',
    kind: 'music',
    media: String(t.audioPath),
    thumb: null,
    dur: +t.duration || 0,
    meta: { categoryId: String(t.categoryId || ''), categoryLabel: String(t.categoryLabel || ''), date: t.createdAt || null,
            favorite: !!t.favorite, style: String(t.style || ''), ...placeOf(t),
            source: t.source || 'suno', gen: t.gen || '', variant: t.variant || 0, wave: Array.isArray(t.wave) ? t.wave : [],
            info: { style: String(t.style || ''), lyrics: t.lyrics ? String(t.lyrics) : '' },
            // (phase V54) a piece cut out of a track names the track and the stretch (lib/audio-cut.js)
            original: t.original || null },
  }));
  if (fromMusic.some(m => !(m.dur > 0))) MUSIC.fillLengths();
  // (phase V34.E) SFX -> Built-in: the program's set (lib/sfx-builtin.js, vendor/sfx/ at /sfx/) - read only, only when
  // asked; a built-in sound's star is kept by its address (lib/sfx-favorites.js).
  let fromSfx = [];
  if (opts && opts.sfx) {
    const favs = new Set(require('../lib/sfx-favorites').list().map(f => f.path));
    fromSfx = require('../lib/sfx-builtin').read().sounds.map(s => ({
      id: s.id, name: s.name, kind: 'sfx', media: s.path, thumb: null, dur: s.dur,
      meta: { categoryId: s.category, categoryLabel: s.categoryLabel, date: null, favorite: favs.has(s.path), source: 'built-in',
              wave: s.wave, tags: s.tags,
              info: { author: s.author, authorUrl: s.authorUrl, license: s.license, licenseUrl: s.licenseUrl, from: s.source, url: s.url } },
    }));
  }
  // The tiles still with no waveform are measured behind this answer.
  if (fromSounds.some(i => !i.meta.wave.length) || fromMusic.some(i => !i.meta.wave.length)) require('../lib/audio-wave').fill();

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
    .filter(i => _onDisk(i.media)).concat(fromSfx);
  // (phase V55) IMAGES -> Environments / Lookbooks: the pictures their generators made - only when asked (`filter`), read
  // from their folders (always on the disk).
  if (opts && opts.made && MADE_KINDS.has(opts.made)) items.push(..._madeItems(opts.made));
  // (phase V59.1, (мз6а)) AUDIO -> Music -> Lyrics: the saved texts - no file, only when asked.
  if (opts && opts.lyrics) items.push(..._lyricItems());
  // (phase TG, block 6; the owner: "в library на полке media можно смотреть видео скачаные с youtube ... все видео-источники
  // сценариев и highlights - только скачаные с ютуба") YOUTUBE - every source with its video on the disk that came from
  // YouTube, one tile each, only when asked. It is the Sources' (Scenarios -> sources): watched, laid on a lane, sent to
  // highlights - never deleted or moved from here.
  // (after block 8; the owner 2026-10-22: "в references папка youtube->videos будет источником для scenarios и для
  // highlights ... корневая youtube убираем") They are REFERENCES -> YouTube -> Videos now (`folder`), beside the videos
  // kept as tiles, and come with REFERENCES. `ytKeys` - their links' keys: a tile of the same video is not shown twice.
  const SRCS = require('../lib/sources-store');
  const ytKeys = new Set();
  if (opts && opts.refs) {
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
          // how it came: "telegram" (the bot), "cut" (a piece made here) - only the bot's are "new" in the tree
          from: p.from || '', handled: !!p.handled,
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

  // A record's own categoryLabel, for an id no list knows about — see listFor()'s orphan
  // note. Reading it from the record is the only way to name such a category.
  const fromRecords = {};
  for (const e of arch.concat(Array.isArray(hooks) ? hooks : []).concat(IMG.read()).concat(SND.read()).concat(MUSIC.read())) {
    if (e && e.categoryId && e.categoryLabel && !fromRecords[e.categoryId]) fromRecords[e.categoryId] = String(e.categoryLabel);
  }

  return {
    items,
    // The categories depend on WHICH kind is asked for, and only the route handler knows that, so
    // the shelf hands back the ingredients instead of a finished list.
    labelFor: (id) => fromRecords[id] || '',
  };
}

// The categories of the media shelf (`cats`). `kind` is the kind asked for, or '' for every kind.
//
// Counts are scoped to that kind. Uncategorized is pinned first because it is
// furniture rather than a category: it cannot be renamed, moved or deleted.
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
    // (phase V54) A folder in a folder reads as its path - the pictures chat's column offers these.
    label: (Array.isArray(c.trail) && c.trail.length ? c.trail.join(' / ') : c.label) + ' · ' + c.count,
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
//   REFERENCES -> the sources' folders, its own categories
//   VIDEO  -> Generated (B-rolls -> categories, Talking heads -> projects; a B-roll with no category in Generated itself),
//             Hooks, Uploads -> categories
//   IMAGES -> Environments, Lookbooks (what their generators made -> references; phase V55, _madeFolders), its categories
//   AUDIO  -> Music (-> highlights -> the moods), SFX -> Favorites, Built-in, My sounds
// Every node: { key, label, count, q?, loose?, direct?, children? } - since V35 the tree is FOLDERS: `q` is what the shelf is
// asked for what lies DIRECTLY in the node (`filter` and `cat`, `src`, `folder`/`mood`; none - it only holds folders),
// `children` its folders, `key` what a page remembers it by. In a branch (the owner): the locked first, then those with
// something in them, then the empty ones (`empty`, pale) - each part in alphabetical order (no case; "2026-08-23" before
// "2026-10-02"). Generated, Hooks and Uploads are locked; so are the required categories.
const KIND_LABEL = { birols: 'B-rolls', hooks: 'Hooks', uploads: 'Uploads', images: 'IMAGES', music: 'Music', sounds: 'SFX', heads: 'Talking heads' };
// (phase V34.E) AUDIO holds the built-in sounds too (`sfx`), and SFX is the own and the built-in together (`sfxall`).
const GROUPS = { video: ['birols', 'hooks', 'uploads', 'heads'], generated: ['birols', 'heads'], images: ['images'], audio: ['music', 'sounds', 'sfx'],
  sfxall: ['sounds', 'sfx'],
  // (phase TG, block 5) REFERENCES - the posts the Telegram bot brought in (lib/references-store.js); and (after block 8) the
  // sources of the scenarios and of highlights downloaded from YouTube, in its YouTube -> Videos.
  references: ['references', 'youtube'] };
// Where an item of REFERENCES lies: a post by its site and folder, a downloaded YouTube source in YouTube -> Videos.
const _siteOf = (i) => (i.kind === 'youtube' ? 'youtube' : (i.meta || {}).source);
const _inRefs = (i) => i.kind === 'references' || i.kind === 'youtube';
// A REFERENCES folder, as a node asks for it: "instagram" (all of the source's), "instagram/reels", or (phase V35)
// "instagram/__uncat__" - what lies in the source itself, in none of its folders. A post under an own category is in that
// category's folder, not its source's.
function _inSrc(i, src) {
  const [s, fo] = String(src || '').split('/');
  const m = i.meta || {};
  if (!_inRefs(i) || m.categoryId || _siteOf(i) !== s) return false;
  if (!fo) return true;
  if (fo === UNCAT) {
    const src0 = require('../lib/references-store').SOURCES.find(x => x.id === s);
    return !((src0 && src0.folders) || []).some(f => f.id === m.folder);
  }
  return m.folder === fo;
}
// (2026-11-09, the owner's (в19)) AUDIO's own root: `aroot` '1' - only what lies there, '0' - none of it (My sounds' root, ★).
const _aroot = (i, want) => (want === '1' ? !!(i.meta || {}).inAudio : want === '0' ? !(i.meta || {}).inAudio : true);
// (phase V35) A track's place in Music: `folder` / `mood` asked as a value, or UNCAT for none.
const _isIn = (v, want) => (want === UNCAT ? !v : String(v || '') === String(want));
const ANYCAT = '__cat__';          // a B-roll with some category (VIDEO -> Generated -> B-rolls)
const _abc = (a, b) => String(a || '').localeCompare(String(b || ''), 'en', { numeric: true, sensitivity: 'base' });

// (phase V35, the owner's (ф3): "появляется одна папка highlights, а в ней 10 настроений. добавлять можно, но только в
// корневую highlights") Music -> highlights -> a folder per mood of the highlights presets (lib/music-store.js `moods`,
// V34.F). highlights and its moods are the app's (locked: never renamed or deleted, no "+"); a mood takes only a track its
// preset made (`moodLock` - the rule is `place` in lib/music-store.js), a person's own track goes into highlights itself.
// Music's own tracks lie in Music. (phase V54 block 6, (зв22), (зв41)) Beside highlights - after it - Music's OWN folders, in
// one another as any kind's (lib/library-cats.js kind `music`); none inside highlights or its moods.
function _musicNode(list, folders) {
  const moods = typeof MUSIC.moods === 'function' ? MUSIC.moods() : [];
  // (phase V54) What lies in Music itself: in no own folder and not in highlights.
  const rootN = list.filter(i => !i.meta.categoryId && i.meta.folder !== 'highlights').length;
  // (phase V59.1, (мз6а)) Lyrics - beside highlights, after it: the app's (locked), only texts, no folders of its own.
  const lyrics = _lyricsNode();
  // (phase V59, the owner 2026-10-29: "сделать music в дереве золотым") `make`: its
  // "Generate music" in its menu opens the sound window on Music, on both pages (js/media-tree.js onMake).
  const node = { key: 'music', kind: 'music', label: 'Music', count: list.length + lyrics.count, q: { filter: 'music', folder: UNCAT, cat: UNCAT },
    loose: 'music', direct: rootN, make: 'music', makeLabel: 'Generate music' };
  const own = folders || [];
  if (!moods.length) { node.children = [lyrics, ...own]; return node; }
  const inHl = list.filter(i => i.meta.folder === 'highlights');
  const hlRootN = inHl.filter(i => !i.meta.mood).length;
  const hl = { key: 'music:highlights', kind: 'music', folder: 'highlights', label: 'highlights', locked: true, noAdd: true, count: inHl.length,
    tip: 'highlights - the highlights popup offers every track in it; your own tracks go here, its moods take only what their presets made',
    q: { filter: 'music', folder: 'highlights', mood: UNCAT }, loose: 'music', direct: hlRootN, empty: !inHl.length,
    children: moods.map(m => {
      const n = inHl.filter(i => i.meta.mood === m.id).length;
      return { key: 'music:highlights:' + m.id, kind: 'music', folder: 'highlights', mood: m.id, label: m.label, count: n, empty: !n,
        locked: true, noAdd: true, moodLock: true, tip: m.label + ' - only the tracks made by its preset' + (m.about ? ' (' + m.about + ')' : ''),
        q: { filter: 'music', folder: 'highlights', mood: m.id } };
    }) };
  return Object.assign(node, { children: [hl, lyrics, ...own] });
}

// (phase V59.1, the owner 2026-10-29: "текста песен ... давай в music будет своя папка еще для lyrics"; (мз6а)) Music ->
// Lyrics: the texts saved from Generate music (lib/lyrics-store.js) - its Lyrics' "save", Custom's "save" by the Lyrics
// field. The app's folder: never renamed, deleted or moved (`locked`), no folder of its own in it and nothing let go or
// moved into it by hand (`noAdd`, `lyrics` - js/media-tree.js refuses in words); its tiles open the text.
function _lyricsNode() {
  const n = LY.list().length;
  return { key: 'music:lyrics', kind: 'lyrics', label: 'Lyrics', locked: true, noAdd: true, lyrics: true, count: n, direct: n, empty: !n,
    tip: 'Lyrics - the texts saved from Generate music (its Lyrics, and "save" by Custom\'s Lyrics); a press on one opens it',
    q: { filter: 'lyrics' } };
}
// A saved text as a tile of the media shelf: its title, the text itself (the tile shows its first lines, the viewer all).
function _lyricItems() {
  return LY.list().map(l => ({
    id: l.id, name: l.title, kind: 'lyrics', media: '', thumb: null, dur: 0,
    meta: { categoryId: '', date: l.date || null, favorite: false, from: l.from, gen: l.gen, text: l.text },
  }));
}

// (phase V35, the owner 2026-10-23, (т2): "как будто папки в library ... при нажатии на корневую категорию показывать
// вложенные категории как папки. тогда нам uncategorized будет не нужна") THE TREE IS FOLDERS: a node's `q` is what lies
// DIRECTLY in it - what has no category of its kind (`loose`: that kind; `direct`: how many) - and its children are its
// folders, shown first as folder tiles (js/media-tree.js). There is no Uncategorized node any more; a node that only holds
// folders (VIDEO, AUDIO, SFX, Built-in, B-rolls, Talking heads, REFERENCES) has no `q`. `count` is still all under it.
// Nothing moves on the disk: what has no category stays in its `nocat/` folder.
function _tree(opts) {
  const { items, labelFor } = _mediaShelf({ music: true, heads: true, refs: true, sfx: true });
  const byKind = {};
  for (const i of items) (byKind[i.kind] = byKind[i.kind] || []).push(i);
  // A kind's categories, as folders: the locked first, then those with something in them, then the empty ones (pale) -
  // each part alphabetical. What has none is counted for the node that holds them (`uncat`).
  // (phase V54 block 6) FOLDERS IN FOLDERS: a folder's own folders are its `children`, in the same order at every level;
  // `count` is all under it, `direct` what lies in it itself (its `q`).
  const catsOf = (kind, list) => {
    const counts = {};
    let uncat = 0;
    for (const i of list) {
      const c = (i.meta || {}).categoryId;
      if (c && c !== UPLOADS_CAT) counts[c] = (counts[c] || 0) + 1;
      else uncat++;
    }
    const cats = LC.listFor(kind, counts, labelFor);
    const byParent = new Map();
    for (const c of cats) {
      const p = c.parent || '';
      if (!byParent.has(p)) byParent.set(p, []);
      byParent.get(p).push(c);
    }
    const by = (a, b) => _abc(a.label, b.label);
    const build = (parent) => {
      const here = (byParent.get(parent) || []).map(c => {
        const kids = build(c.id);
        const total = c.count + kids.reduce((n, k) => n + k.count, 0);
        const node = { key: kind + ':' + c.id, kind, cat: c.id, label: c.title || c.label, name: c.label, count: total, direct: c.count,
          locked: !!c.locked, own: !!c.own, orphan: !!c.orphan, empty: !(total > 0), q: { filter: kind, cat: c.id } };
        if (kids.length) node.children = kids;
        return node;
      });
      return [
        ...here.filter(n => n.locked).sort(by),
        ...here.filter(n => !n.locked && n.count > 0).sort(by),
        ...here.filter(n => !n.locked && !(n.count > 0)).sort(by),
      ];
    };
    return { out: build(''), uncat };
  };
  // A kind: its categories as folders, and what has none lies in it.
  const kindNode = (kind, key, label, extra) => {
    const list = byKind[kind] || [];
    const node = Object.assign({ key: key || kind, kind, label: label || KIND_LABEL[kind], count: list.length, q: { filter: kind },
      loose: kind, direct: list.length }, extra || {});
    if (!LC.KINDS.includes(kind)) return node;
    const { out, uncat } = catsOf(kind, list);
    node.q = { filter: kind, cat: UNCAT };
    node.direct = uncat;
    if (out.length) node.children = out;
    return node;
  };
  // VIDEO -> Generated: (phase V60.2, the owner's (дг4а)-(дг12а)) THE FOLDERS OF THE MODELS that made the B-rolls - Grok
  // classic, Seedance 2.5... with the groups inside them (lib/model-folders.js; no "B-rolls" folder any more) -, then Talking
  // heads (a project each). A model's folder shows only while something lies under it ((дг9б)), the folders by name, Other
  // last. A folder outside every model's (a library not swept yet) shows after them.
  const birols = byKind.birols || [];
  const inCat = birols.filter(i => (i.meta || {}).categoryId);
  const bTop = catsOf('birols', birols).out;
  const modelNodes = bTop.filter(n => MF.isModelCat(n.cat) && n.count > 0)
    .map(n => Object.assign(n, { model: String(n.cat).slice(LC.MODEL_PREFIX.length),
      tip: n.label + ' - the clips it made, and your folders of them; a clip of another model goes into its own' }))
    .sort((a, b) => ((a.model === MF.OTHER) - (b.model === MF.OTHER)) || _abc(a.label, b.label));
  const strayNodes = bTop.filter(n => !MF.isModelCat(n.cat));
  const heads = byKind.heads || [];
  const projects = new Map();
  for (const h of heads) {
    const id = String((h.meta || {}).categoryId || '');
    const p = projects.get(id) || { id, title: (h.meta || {}).project || id, n: 0 };
    p.n++;
    projects.set(id, p);
  }
  // Every take is its project's: the projects are its folders, nothing lies in Talking heads itself.
  const headsNode = { key: 'heads', kind: 'heads', label: 'Talking heads', count: heads.length,
    children: [...projects.values()].sort((a, b) => _abc(a.title, b.title)).map(p => ({
      key: 'heads:' + p.id, kind: 'heads', cat: p.id, label: p.title, count: p.n, project: true, q: { filter: 'heads', cat: p.id },
    })) };
  if (!headsNode.children.length) delete headsNode.children;
  const loose = birols.length - inCat.length;
  const generated = { key: 'generated', label: 'Generated', locked: true, count: birols.length + heads.length,
    q: { filter: 'birols', cat: UNCAT }, loose: 'birols', direct: loose, children: [...modelNodes, ...strayNodes, headsNode] };
  const video = { key: 'video', label: 'VIDEO',
    children: [generated, kindNode('hooks', null, null, { locked: true }), kindNode('uploads', null, null, { locked: true })] };
  video.count = video.children.reduce((n, c) => n + c.count, 0);
  // (phase V34.E, the owner 2026-10-22: "SFX -> Favorites, Built-in, My sounds") SFX: every starred sound first; the
  // program's set, read only, by its categories; the person's own - the kind `sounds` with its categories (Generated
  // locked) - under "My sounds", so a category made, renamed or a tile filed works as it always did.
  // (2026-11-09, the owner's (в19): "должно ложится в корень audio. там пользователь уже распределит по своим папкам") What
  // lies in AUDIO itself - "Save audio"'s sounds (`inAudio`) - is no sound of My sounds: My sounds, SFX and ★ Favorites count
  // without it, and My sounds' own root does not show it (`aroot: '0'`).
  const aroot = (byKind.sounds || []).filter(i => i.meta.inAudio);
  byKind.sounds = (byKind.sounds || []).filter(i => !i.meta.inAudio);
  const own = byKind.sounds;
  const built = byKind.sfx || [];
  const set = require('../lib/sfx-builtin').read();
  const mine = kindNode('sounds', 'sounds', 'My sounds');
  if (mine.q) mine.q.aroot = '0';
  const builtin = { key: 'sfx', kind: 'sfx', label: 'Built-in', locked: true, noAdd: true, builtin: true, count: built.length,
    children: set.categories.map(c => {
      const n = built.filter(i => i.meta.categoryId === c.id).length;
      return { key: 'sfx:' + c.id, kind: 'sfx', cat: c.id, label: c.label, count: n, locked: true, builtin: true, empty: !n,
        q: { filter: 'sfx', cat: c.id } };
    }) };
  if (!builtin.children.length) delete builtin.children;
  const favN = own.concat(built).filter(i => i.meta.favorite).length;
  const fav = { key: 'sfx-fav', label: '★ Favorites', count: favN, empty: !favN, q: { group: 'sfxall', fav: '1', aroot: '0' } };
  // SFX holds its three folders; its search looks through all of them (the owner's (у3), js/sound/shelf.js).
  const sfx = { key: 'sfx-all', label: 'SFX', count: own.length + built.length, children: [fav, builtin, mine] };
  // AUDIO is a folder too (the owner's (в19)): Music and SFX, then what lies in it itself - a sound to be filed from there into
  // Music or SFX (lib/audio-kind.js). `aroot` - the page's sign of that place (js/media-tree.js _target).
  const audio = { key: 'audio', label: 'AUDIO', loose: 'sounds', aroot: true, direct: aroot.length, q: { filter: 'sounds', aroot: '1' },
    tip: 'AUDIO - Music and SFX; what lies in it itself ("Save audio" of a video) waits to be dragged into Music or SFX',
    children: [_musicNode(byKind.music || [], catsOf('music', byKind.music || []).out), sfx] };
  audio.count = aroot.length + audio.children.reduce((n, c) => n + c.count, 0);
  // (phase TG, block 5; the owner: "давай над video - самой первой") REFERENCES - the posts the Telegram bot brought in, a
  // folder per source and its kind of post; the folders are the app's (locked).
  const refs = (byKind.references || []).concat(byKind.youtube || []);
  const nOf = (s, f) => refs.filter(i => !i.meta.categoryId && _siteOf(i) === s && (!f || i.meta.folder === f)).length;
  // `kind` on the root: its "+" makes an own category (block 5b); the sources' folders make none (`noAdd`).
  // (phase V35) Nothing lies in REFERENCES itself: a post is in its source's folder or in an own category. A source with
  // folders of its own (Instagram: Posts, Reels) holds in itself only a post of none of them.
  const references = { key: 'references', kind: 'references', label: 'REFERENCES', count: refs.length,
    children: require('../lib/references-store').SOURCES.map((s) => {
      const node = { key: 'references:' + s.id, kind: 'references', ref: s.id, label: s.label, locked: true, noAdd: true,
        count: nOf(s.id), empty: !nOf(s.id), q: { filter: 'references', src: s.folders.length ? s.id + '/' + UNCAT : s.id } };
      if (s.folders.length) {
        node.children = s.folders.map(f => ({ key: `references:${s.id}/${f.id}`, kind: 'references', ref: s.id + '/' + f.id,
          label: f.label, locked: true, noAdd: true, count: nOf(s.id, f.id), empty: !nOf(s.id, f.id), q: { filter: 'references', src: s.id + '/' + f.id },
          // (phase V35, the owner's (т3)) YouTube's videos are horizontal: their tiles are 16:9, in the Library and in Merge.
          ...(s.id === 'youtube' && f.id === 'videos' ? { tiles: 'wide' } : {}) }));
      }
      return node;
    }) };
  // The owner's own categories, after the sources' folders: the ones with posts, then the empty ones, each A-Z.
  references.children.push(...catsOf('references', refs, false).out);
  // (after block 8) No root YOUTUBE any more: its videos are REFERENCES -> YouTube -> Videos (the owner 2026-10-22).
  const images = kindNode('images', 'images', 'IMAGES');
  _madeFolders(images);
  const roots = [references, video, images, audio];
  _stampNewest(roots, items, (opts && opts.srcFrom) || 0);
  // (phase V78) Merge's tree for a project: THIS PROJECT first, above REFERENCES.
  // A draft has none (the owner 2026-11-07) - Merge's draft, the voiceover draft.
  if (opts && opts.plinks && !PLINKS.isDraft(opts.plinks)) { try { roots.unshift(_plinksNode(opts.plinks, items)); } catch (e) { console.warn('[library] THIS PROJECT:', e.message); } }
  return roots;
}

// ── THIS PROJECT (phase V78, part B, the owner's (лч10)-(лч17); lib/project-links.js) ──────────────────────────────────────
// Every item a link may name: the media shelf's whole set with what the generators of IMAGES made - a link is found by
// 'kind:id', else by its address. Anything not found is a file deleted from the library: its link goes ((лч14)).
function _linkables(items) {
  const all = (items || _mediaShelf({ music: true, heads: true, refs: true, sfx: true }).items).slice();
  for (const k of MADE_KINDS) { try { all.push(..._madeItems(k)); } catch (e) { /* that shelf did not read */ } }
  const byKey = new Map(), byMedia = new Map();
  for (const i of all) {
    if (!i || !i.kind) continue;
    byKey.set(i.kind + ':' + i.id, i);
    const m = String(i.media || '').split(/[?#]/)[0];
    if (m && !byMedia.has(m)) byMedia.set(m, i);
  }
  return { byKey, byMedia };
}
// The links of a project as the library's items - each with its `link` (the link's id) and the folder it lies in.
function _linkedItems(key, items) {
  const { byKey, byMedia } = _linkables(items);
  const r = PLINKS.resolve(key, byKey, byMedia);
  return { folders: r.folders, items: r.found.map(({ link, item }) => Object.assign({}, item, { link: link.id, meta: Object.assign({}, item.meta || {}, { linkFolder: link.folder }) })) };
}
// The node: THIS PROJECT and its folders - `kind` 'plinks', `cat` a folder's id, `q` what the shelf is asked for what lies
// directly in it (GET /api/library/shelf/media?plinks=<key>&plfolder=<id>).
function _plinksNode(key, items) {
  const k = PLINKS.homeKey(key);
  const { folders, items: linked } = _linkedItems(k, items);
  const direct = new Map();
  for (const i of linked) direct.set(i.meta.linkFolder || '', (direct.get(i.meta.linkFolder || '') || 0) + 1);
  const build = (parent) => folders.filter(f => f.parent === parent).sort((a, b) => _abc(a.name, b.name)).map(f => {
    const kids = build(f.id);
    const n = direct.get(f.id) || 0;
    const count = n + kids.reduce((s, c) => s + c.count, 0);
    return { key: 'plinks:' + f.id, kind: 'plinks', cat: f.id, label: f.name, name: f.name, own: true, count, direct: n, empty: !count,
      q: { plinks: k, plfolder: f.id }, children: kids, newest: 0 };
  });
  const kids = build('');
  const n = direct.get('') || 0;
  return { key: 'plinks', kind: 'plinks', label: 'THIS PROJECT', count: n + kids.reduce((s, c) => s + c.count, 0), direct: n,
    tip: 'This project\'s own folders - links to the library\'s media; the files stay where they are',
    q: { plinks: k, plfolder: '' }, children: kids, newest: 0 };
}

// (phase V55, the owner 2026-10-28, (гн8)-(гн9): "в images нужно сделать так папки Environment (references, а в корневой
// окружений - сгенерированые изображения); так же и с одеждой") IMAGES -> ENVIRONMENTS and LOOKBOOKS, locked, first among
// IMAGES' folders. In their root lie the pictures their generators made - the shelves' own files (media/locations/,
// media/lookbooks/; no records: the file IS the entry, `_imageShelf`), asked for as `filter=environments|lookbooks`; inside
// each, its `references` - the required category uploads_environments / uploads_lookbooks. That category stays where it is
// in the list - a TOP folder of IMAGES, found BY NAME (lib/library-cats.js REQUIRED) - and on the disk: the tree only SHOWS
// it here, under its key, so a remembered selection and the generators' filing work as before. A made
// picture is opened and deleted here as on its shelf, never moved (descriptions, 3D layouts and looks point at its
// address - _moveOne); nothing is moved into these two but their references' own (js/media-tree.js).
// (phase V57, the owner's (ок2)) And NOTHING GOES INTO THOSE REFERENCES BY HAND - only the photo a generator is given
// (lib/library-cats.js closedWhy): the node and every folder under it are `closed` - the page refuses a tile, a folder, a
// file and "New folder" there in words, "Move to…" leaves them out (js/media-targets.js) - and `noAdd`.
// (phase V26.6, the owner 2026-10-30, (п1) "a"): IMAGES -> PROPS, the third - the products a character holds in a frame,
// one picture each, added by the New prop window (lib/props.js) and described by an agent. No references: the photo IS the
// product. Its tiles show the product whole (`tiles: 'whole'`).
const MADE = [
  { kind: 'environments', label: 'Environments', refs: 'uploads_environments', make: 'New environment', noun: 'environment' },
  { kind: 'lookbooks', label: 'Lookbooks', refs: 'uploads_lookbooks', make: 'New lookbook', noun: 'lookbook' },
  { kind: 'props', label: 'Props', refs: '', make: 'New prop', noun: 'prop' },
];
const MADE_KINDS = new Set(MADE.map(m => m.kind));
const MADE_DIRS = { environments: ENVIRONMENTS_DIR, lookbooks: LOOKBOOKS_DIR, props: PROPS_DIR };
// Why a made picture does not move, in words (the batch's and the item route's refusal).
const MADE_STAYS = {
  environments: 'a made environment stays in Environments - its description, 3D layout and the videos filmed there point at it',
  lookbooks: 'a made lookbook stays in Lookbooks - its description and the looks dressed in it point at it',
  props: 'a prop stays in Props - its description is kept by its place there',
};
// ...and why nothing is moved INTO them.
const MADE_TAKES = {
  environments: 'only New environment puts pictures into Environments',
  lookbooks: 'only New lookbook puts pictures into Lookbooks',
  props: 'only New prop puts pictures into Props',
};
function _madeFolders(images) {
  const kids = images.children || [];
  const made = MADE.map((g) => {
    const n = _imageShelf(MADE_DIRS[g.kind], '', g.kind).length;
    const at = g.refs ? kids.findIndex(c => c.locked && String(c.name || '') === g.refs) : -1;
    const ref = at >= 0 ? kids.splice(at, 1)[0] : null;
    const all = n + (ref ? ref.count : 0);
    const node = { key: g.kind, kind: g.kind, label: g.label, locked: true, count: all, direct: n, empty: !all,
      q: { filter: g.kind }, make: g.kind, makeLabel: g.make,
      // An environment is a 3:2 picture: its tiles are wide, as YouTube's videos are (V35's `tiles: 'wide'`); a product is
      // shown whole, never cut to fill its square (phase V26.6).
      ...(g.kind === 'environments' ? { tiles: 'wide' } : g.kind === 'props' ? { tiles: 'whole' } : {}),
      tip: g.kind === 'props'
        ? 'Props - the products a character holds in a frame, each with what is known about it (+ adds one); the frames chat takes them'
        : g.label + ' - the ' + g.noun + 's its generator made (+ opens it); the photos it was given lie in its references' };
    if (ref) {
      const shut = (n) => { n.closed = true; n.noAdd = true; for (const c of n.children || []) shut(c); };
      shut(ref);
      node.children = [Object.assign(ref, { label: 'references',
        tip: 'references - the photos ' + g.make + ' was given; nothing is put here by hand. Required: it cannot be renamed, moved or deleted' })];
    }
    return node;
  });
  images.children = made.concat(kids);
  images.count += made.reduce((s, m) => s + m.direct, 0);
}
// (phase V74, the owner's (пт6)) The app's patterns (lib/patterns-builtin.js, vendor/patterns/ at /patterns/) are no folder of
// the media tree any more - IMAGES -> Patterns of phase V65 went, in Merge and in the Library: a pattern is picked only in the
// strip of main video in Merge (js/merge-v3/patterns-ui.js), from this list - where each is and its picture, the tiles to tick.
// Their authors and licences: Admin -> Thanks and vendor/patterns/LICENSE.txt.
// `GET /api/patterns` -> { patterns: [{ id, name, path, thumb, size }] }.
router.get('/patterns', (_req, res) => {
  try {
    const list = require('../lib/patterns-builtin').read().patterns.map((p) => ({ id: p.id, name: p.name, path: p.path, thumb: p.thumb, size: p.size }));
    res.json({ success: true, patterns: list });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
// What the media shelf gives for them (`filter=environments|lookbooks`) - a picture's shape, as Images' are: `thumb` a
// thumbnail door address (of the shelf's own 600px copy when there is one), and what is known about it for the viewer.
function _madeItems(kind) {
  const dir = MADE_DIRS[kind];
  const meta = SM.read(kind);
  return _imageShelf(dir, toUrl(dir), kind).map((it) => {
    const m = meta[it.media] || {};
    return Object.assign(it, {
      thumb: '/api/thumb?src=' + encodeURIComponent(it.thumb || it.media) + '&v=card',
      dur: 0,
      // (phase V26.6) A product goes by the name it was given, not its file's.
      ...(kind === 'props' && m.name ? { name: String(m.name) } : {}),
      meta: Object.assign(it.meta, {
        categoryId: '', favorite: false, made: true,
        description: String(m.description || ''), from: String(m.from || ''),
        ...(kind === 'environments' ? { motion: String(m.motion || '') }
          : kind === 'props' ? { words: String(m.words || ''), by: String(m.by || ''), fail: String(m.fail || ''), reading: _propReading(it.media) }
          : { gender: String(m.gender || '') }),
      }),
    });
  });
}
// (phase V26.6) Whether the agent is describing a product right now (lib/props.js) - the viewer says "describing…".
const _propReading = (media) => { try { return require('../lib/props').reading(media); } catch (e) { return false; } };

// (phase TG, the owner 2026-10-21: "выделять строку в дереве зеленым цветом ... куда добавилось что-то новое") Every node
// says when the newest thing under it came (`newest`, ms) - the page lights the nodes holding something newer than when they
// were last opened (js/media-tree.js). Read by the node's own query, as the shelf filters - and (2026-10-22) only posts the
// bot brought count (`_isNews`), so only REFERENCES ever lights.
function _inNode(i, q) {
  if (!q) return false;
  if (q.group) return !!(GROUPS[q.group] && GROUPS[q.group].includes(i.kind));
  if (q.filter && i.kind !== q.filter && !(q.filter === 'references' && i.kind === 'youtube')) return false;
  const m = i.meta || {};
  if (q.src && !_inSrc(i, q.src)) return false;
  if (q.folder && !_isIn(m.folder, q.folder)) return false;
  if (q.mood && !_isIn(m.mood, q.mood)) return false;
  if (q.aroot && !_aroot(i, q.aroot)) return false;
  if (q.cat) {
    const c = m.categoryId || '';
    if (q.cat === UNCAT) { if (c && c !== UPLOADS_CAT) return false; }
    else if (q.cat === ANYCAT) { if (!c || c === UPLOADS_CAT) return false; }
    else if (c !== q.cat) return false;
  }
  return true;
}
// (the owner 2026-10-22: "почему то подсвечиваются как то рандомно категории в дереве, когда перемещаю из uncategorized.
// давай подсвечивать новое только в references") Only what the Telegram bot BROUGHT counts: a clip or a picture moved
// (which stamps its date anew), a piece cut here, a source downloaded - none of them is news. Every other node says 0.
// A post moved by hand (`handled`) is seen - it does not light the place it was moved to.
// (phase V73 block 2, the owner's (н3) б, 2026-11-05) And a source downloaded by a link (REFERENCES -> YouTube -> Videos,
// kind `youtube`, its `date` the moment it landed) - but only one that came after `srcFrom`, the moment the page first ran
// this rule (js/references/news.js `since`, sent as ?srcFrom=): nothing already there lights. Without it - the other trees,
// which light nothing - a source is never news.
const _isNews = (i, srcFrom) => (i.kind === 'references' && (i.meta || {}).from === 'telegram' && !(i.meta || {}).handled)
  || (i.kind === 'youtube' && srcFrom > 0 && _ts(i.meta && i.meta.date) > srcFrom);
// (phase V73 block 2, the owner's (н1) а) `ownNews` - the newest news lying DIRECTLY in the node (its `q` matches only that);
// `newest` - in it or under it. The page lights a REFERENCES node while its own news is newer than when IT was opened, and
// a branch while any node under it is lit: the lit path leads down to the inner folder. Read-only, nothing kept.
function _stampNewest(nodes, items, srcFrom) {
  for (const n of nodes) {
    let best = 0;
    for (const i of items) { if (_isNews(i, srcFrom) && _inNode(i, n.q)) { const t = _ts(i.meta && i.meta.date); if (t > best) best = t; } }
    // (phase V78 fix) Its own field: `own` is a folder's "the person's" flag (catsOf) - stamped over, no folder of the person's
    // could be renamed, moved or deleted, nor hold a folder (js/media-tree.js holds, movable) since V73 block 2.
    n.ownNews = best;
    if (n.children) { _stampNewest(n.children, items, srcFrom); for (const c of n.children) if (c.newest > best) best = c.newest; }
    n.newest = best;
  }
}

router.get('/library/tree', (req, res) => {
  // ?srcFrom=<ms> - from when a source downloaded by a link counts as news (the page's moment; absent - never)
  // ?plinks=<timeline key> - (phase V78) Merge's tree for that project: THIS PROJECT first
  try { res.json({ success: true, nodes: _tree({ srcFrom: Math.max(0, Math.floor(+req.query.srcFrom || 0)), plinks: String(req.query.plinks || '') }) }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── THIS PROJECT's folders and links (phase V78, part B; lib/project-links.js) ─────────────────────────────────────────────
//   POST   /api/plinks/folder        { key, name, parent }   -> { folder }      a folder ('' parent - THIS PROJECT itself)
//   PATCH  /api/plinks/folder/:id    { key, name?, parent? } -> { folder }      renamed, moved
//   DELETE /api/plinks/folder/:id?key=                     -> { folders, links }  the folder and its links - files stay
//   POST   /api/plinks/put           { key, folder, items: [{ kind, id, media, link? }] } -> { added, moved, had }
//   POST   /api/plinks/unlink        { key, ids }            -> { removed }      links taken off - files stay
const _plErr = (res, e) => res.status(e.status || 500).json({ success: false, error: e.message });
const _plKey = (k) => { const key = String(k || ''); if (!key) { const e = new Error('Which project?'); e.status = 400; throw e; } return key; };
router.post('/plinks/folder', (req, res) => {
  try { const b = req.body || {}; const f = PLINKS.addFolder(_plKey(b.key), b.name, b.parent); res.json({ success: true, folder: f, cat: { id: f.id, label: f.name } }); }
  catch (e) { _plErr(res, e); }
});
router.patch('/plinks/folder/:id', (req, res) => {
  try { const b = req.body || {}; const f = PLINKS.changeFolder(_plKey(b.key), req.params.id, { name: b.name, parent: b.parent }); res.json({ success: true, folder: f, cat: { id: f.id, label: f.name } }); }
  catch (e) { _plErr(res, e); }
});
router.delete('/plinks/folder/:id', (req, res) => {
  try { res.json(Object.assign({ success: true }, PLINKS.deleteFolder(_plKey(req.query.key), req.params.id))); }
  catch (e) { _plErr(res, e); }
});
router.post('/plinks/put', (req, res) => {
  try { const b = req.body || {}; res.json(Object.assign({ success: true }, PLINKS.put(_plKey(b.key), b.folder, b.items))); }
  catch (e) { _plErr(res, e); }
});
router.post('/plinks/unlink', (req, res) => {
  try { const b = req.body || {}; res.json(Object.assign({ success: true }, PLINKS.unlink(_plKey(b.key), b.ids))); }
  catch (e) { _plErr(res, e); }
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
        // (phase V62) The shared library's id - what brings a released voice back into the account (/scen3/voices/take).
        sharedVoiceId: String(e.sharedVoiceId || ''),
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
  return { items, labelKeys: VS.LABEL_KEYS };
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
  return { items, running };
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
  const all = _read(SCEN3_FILE, []);
  const list = (Array.isArray(all) ? all : []).filter(Boolean)
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  // Archived ones are not among the shelf's items (phase D5): archiving is taking a scenario out of the list - its
  // count, its filters. (phase V60, the owner's (пп6а)) They come beside them as `archived`, newest first, for the
  // folded "Archive" at the bottom of the list; the archive is Merge's too (PATCH `archived`, routes/scen3.js).
  const items = list.filter(s => !s.archived).map(_scRow);
  const archived = list.filter(s => s.archived).map(_scRow);
  return { items, archived };
}

// One scenario as a row of the shelf.
function _scRow(s) {
  return {
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
      ...(s.archived ? { archived: true } : {}),
    },
  };
}

// How many environments are being made right now (phase I) - a chat's, or Merge's maker's.
// The page asks the shelf again while there are any, so what lands shows up on the grid by itself.
function _makingNow(type) {
  try {
    return require('../lib/alerts').list()
      .filter(r => r && r.state === 'running' && r.job && r.job.type === type).length;
  } catch (e) { return 0; }
}

const SHELVES = {
  characters:   _charactersShelf,
  environments: () => ({ items: _imageShelf(ENVIRONMENTS_DIR, toUrl(ENVIRONMENTS_DIR), 'environments'), running: _makingNow('environment') }),
  // Every character's looks in one list - read, not a shelf of the Library page: the video chat's right column offers
  // them for a "person" cell of a recipe (phase V6), each with its character (meta.charId) to group them by.
  looks:        () => ({ items: _looks().items.filter(x => x.media && _onDisk(x.media)) }),
  media:        _mediaShelf,
  voices:       _voicesShelf,
  renders:      _rendersShelf,
  scenarios:    _scenariosShelf,
};

router.get('/library/shelf/:kind', (req, res) => {
  try {
    const kind = String(req.params.kind || '');
    const build = SHELVES[kind];
    if (!build) return res.status(404).json({ success: false, error: `no shelf "${kind}"` });
    // (phase V78) THIS PROJECT: what lies directly in one of its folders (`plfolder`, '' - itself) - the library's items, each
    // with its `link`.
    if (kind === 'media' && req.query.plinks) {
      const folder = String(req.query.plfolder || '');
      const all = _linkedItems(String(req.query.plinks), null).items;
      const items = all.filter(i => req.query.plfolder == null || (i.meta.linkFolder || '') === folder);
      return res.json({ success: true, kind, items, cats: [], labelKeys: null, running: 0 });
    }
    // Filtering happens here rather than in the page, so the count the page shows is the
    // count it received. Media takes two: the kind, and the category within it - or (phase V28.4) a GROUP of kinds,
    // a top node of the media tree: video (B-rolls, Hooks, Uploads), images, audio (music, sounds).
    const f = String(req.query.filter || '');
    const cat = String(req.query.cat || '');
    const grp = GROUPS[String(req.query.group || '')] || null;
    const built = kind === 'media'
      ? _mediaShelf({ music: f === 'music' || !!(grp && grp.includes('music')), heads: f === 'heads' || !!(grp && grp.includes('heads')),
        refs: f === 'references' || !!(grp && grp.includes('references')),
        sfx: f === 'sfx' || !!(grp && grp.includes('sfx')), made: MADE_KINDS.has(f) ? f : '',
        lyrics: f === 'lyrics' })
      : build();
    const { items, labelFor, labelKeys, running } = built;
    // Built from the kind but BEFORE the category filter, so every category keeps its count
    // whichever one is asked for.
    const cats = (kind === 'media' && (!f || LC.KINDS.includes(f))) ? _mediaCats(items, f, labelFor) : [];
    let shown = items;
    if (grp) shown = shown.filter(i => grp.includes(i.kind));
    if (f) shown = shown.filter(i => i.kind === f || (f === 'references' && i.kind === 'youtube'));
    // (phase TG) A REFERENCES folder: "instagram", or "instagram/reels".
    const src = String(req.query.src || '');
    if (src) shown = shown.filter(i => _inSrc(i, src));
    // (phase V35) Music's folders: `folder=highlights`, `folder=__uncat__` (Music itself); `mood=<id>`, `mood=__uncat__`.
    const folder = String(req.query.folder || '');
    const mood = String(req.query.mood || '');
    if (folder) shown = shown.filter(i => _isIn((i.meta || {}).folder, folder));
    if (mood) shown = shown.filter(i => _isIn((i.meta || {}).mood, mood));
    // (2026-11-09) AUDIO's own root: `aroot=1` what lies there, `aroot=0` the rest.
    const aroot = String(req.query.aroot || '');
    if (aroot) shown = shown.filter(i => _aroot(i, aroot));
    if (cat) shown = shown.filter(i => cat === UNCAT
      ? !(i.meta || {}).categoryId
      : cat === ANYCAT ? !!(i.meta || {}).categoryId && (i.meta || {}).categoryId !== UPLOADS_CAT
      : (i.meta || {}).categoryId === cat);
    // (phase V34.E) SFX -> Favorites: the starred ones. And the search over a sound shelf: every word in the name, the
    // tags or the category.
    if (String(req.query.fav || '') === '1') shown = shown.filter(i => (i.meta || {}).favorite);
    const words = String(req.query.q || '').toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
    if (words.length) {
      shown = shown.filter(i => {
        const m = i.meta || {};
        const hay = [i.name, m.categoryLabel, ...(Array.isArray(m.tags) ? m.tags : [])].join(' ').toLowerCase();
        return words.every(w => hay.includes(w));
      });
    }
    res.json({ success: true, kind, items: shown,
      cats, labelKeys: labelKeys || null, running: running || 0,
      // (phase V60) Scenarios: the archived ones beside the live (_scenariosShelf).
      ...(Array.isArray(built.archived) ? { archived: built.archived } : {}) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── The right column: what one tile is (phase B, the owner 2026-09-29) ───────
// The Library page selects a tile on the Characters shelf and shows
// what it is beside the grid - read here in one go, on every selection, so a voice given or a look
// made elsewhere shows up the next time the tile is pressed.
//   characters    { media, voices: [{ voiceId, name, tags, demo, dur, main }], looks }
//   lookbooks     { media, looks }            - the looks dressed in it (a look's `lb`)
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
  // (phase V26.6) A product: its name, the person's own words and the agent's description - and whether it is being read.
  props: (id) => {
    const media = _flatEntry(PROPS_DIR, id);
    if (!media) return null;
    const m = SM.read('props')[media] || {};
    return { media, name: String(m.name || ''), words: String(m.words || ''), description: String(m.description || ''),
      by: String(m.by || ''), fail: String(m.fail || ''), reading: _propReading(media) };
  },
};

// WRITTEN BY HAND IN THE COLUMN (phase I, the owner: shown, and filling them is optional). One writer
// per field: a lookbook's gender and description, an environment's description here; how a place
// moves keeps its own route (/api/scen3/env/motion). An empty value takes the field away.
//   PATCH /api/library/meta/:kind/:id   { description?, gender? }
// A lookbook's gender decides which lookbooks Merge offers a character, and its description is what
// the dressing reads - which is the point of correcting them.
// (phase V26.6) A product's name, the person's words and the description, each written by hand in the viewer.
const META_FIELDS = { lookbooks: ['description', 'gender'], environments: ['description'], props: ['name', 'words', 'description'] };
const GENDERS = ['male', 'female', 'unisex'];
router.patch('/library/meta/:kind/:id', (req, res) => {
  try {
    const kind = String(req.params.kind || '');
    const fields = META_FIELDS[kind];
    if (!fields) return res.status(404).json({ success: false, error: `nothing to write on "${kind}"` });
    const media = _flatEntry(MADE_DIRS[kind], String(req.params.id || ''));
    if (!media) return res.status(404).json({ success: false, error: 'not on this shelf any more' });
    const b = req.body || {};
    if (b.gender != null && b.gender !== '' && !GENDERS.includes(String(b.gender))) {
      return res.status(400).json({ success: false, error: 'gender is male, female, unisex or nothing' });
    }
    const all = SM.read(kind);
    const m = { ...(all[media] || {}) };
    for (const f of fields) {
      if (b[f] == null) continue;
      const v = String(b[f]).trim().slice(0, f === 'name' ? 120 : 4000);
      if (v) m[f] = v; else delete m[f];
    }
    // (phase V26.6) A description written by hand is the person's now - "read again" is what gives it back to the agent.
    if (kind === 'props' && b.description != null) m.by = m.description ? 'you' : '';
    m.at = new Date().toISOString();
    all[media] = m;
    SM.write(kind, all);
    res.json({ success: true, kind, id: String(req.params.id), gender: String(m.gender || ''), description: String(m.description || ''),
      ...(kind === 'props' ? { name: String(m.name || ''), words: String(m.words || '') } : {}) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// (phase V26.6, the owner's (п3), (пр1)-(пр5)) NEW PROP - a product brought into IMAGES -> Props: a photo (its bytes from this
// computer, or a library address - a picture of IMAGES stays where it is) with a name and what the person knows about it.
// Answered once the picture lies in Props; the agent writes its description behind the answer (lib/props.js) - no Alerts
// row, nothing generated.
//   POST /api/props/add        { imageBase64 | imagePath, name, words } -> { id, media, name }
//   POST /api/props/:id/read   "read again": the description written anew from the picture and the words, replacing it
router.post('/props/add', async (req, res) => {
  try {
    const b = req.body || {};
    const raw = String(b.imageBase64 || '');
    const buf = raw ? Buffer.from(raw.replace(/^data:[^;,]*;base64,/i, ''), 'base64') : null;
    const out = await require('../lib/props').add({ buf, path: buf ? '' : String(b.imagePath || ''), name: b.name, words: b.words });
    res.json({ success: true, kind: 'props', ...out });
  } catch (e) {
    console.error('[props/add]', e.message);
    res.status(e.status || 500).json({ success: false, error: e.message });
  }
});
router.post('/props/:id/read', (req, res) => {
  try {
    const media = _flatEntry(PROPS_DIR, String(req.params.id || ''));
    if (!media) return res.status(404).json({ success: false, error: 'not in Props any more' });
    const P = require('../lib/props');
    if (P.reading(media)) return res.status(409).json({ success: false, error: 'it is being described already' });
    P.describe(media).catch((e) => console.warn('[props] ' + media + ' was not described: ' + e.message));
    res.json({ success: true, reading: true });
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
//   DELETE /api/library/item/:kind/:id   the media unlinked too, unless ?files=0
//
// The stores (data/biroly.json, hooks-archive.json, obrazy.json...) are written by the
// server only. A write here is read-modify-write inside ONE request, so it cannot
// interleave with itself.
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
// (phase V54) Never a file a record of Music names: a piece of a track keeps the track as its `original` (lib/audio-cut.js),
// and lib/cuts.js does not look into Music - so a track, or anything a track names, is taken out here, whatever it is.
function _musicFiles() {
  const keep = new Set();
  for (const t of MUSIC.read()) {
    if (t && t.audioPath) keep.add(String(t.audioPath).split('?')[0]);
    if (t && t.original && t.original.path) keep.add(String(t.original.path).split('?')[0]);
  }
  return keep;
}
const _originalsOf = (doomed) => {
  const all = (doomed || []).flatMap(e => [e && e.original && e.original.path,
    ...((e && Array.isArray(e.media)) ? e.media.map(m => m && m.original && m.original.path) : [])]).filter(Boolean);
  if (!all.length) return all;
  const music = _musicFiles();
  return all.filter(p => !music.has(String(p).split('?')[0]));
};

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
    // (phase V54) and its own folder
    fields: ['name', 'favorite', 'categoryId', 'categoryLabel'],
    files: (e) => [e.audioPath],
  },
};
// Uploads are birols with a flag, so they share the store.
RECORD_STORES.uploads = RECORD_STORES.birols;

// Lookbooks and environments are not records at all — the shelf IS the directory.
// Delete-only by design: these filenames are referenced by look records (a look can
// point at a lookbook image), so renaming the file would silently break them.
// (phase V26.6) And Props: a product deleted takes its picture, thumbnail and description; the frames drawn with it stay
// (the owner's (п8)) - they keep what they knew of it.
const FILE_SHELVES = {
  lookbooks:    { dir: LOOKBOOKS_DIR,    url: toUrl(LOOKBOOKS_DIR) },
  environments: { dir: ENVIRONMENTS_DIR, url: toUrl(ENVIRONMENTS_DIR) },
  props:        { dir: PROPS_DIR,        url: toUrl(PROPS_DIR) },
};

const _r = (status, body) => ({ status, body });

// (phase V54) A BATCH PLACES ITS FILES ONCE. Each item function moves a record's files to its folder (SHELF.placeRecords -
// one relocate, every store and project rewritten); a batch of hundreds would do that hundreds of times. While a batch
// runs, `_placeLater` collects what would have been placed, and `_placeAll` places the records as they are at the end,
// in ONE call.
let _placeLater = null;           // [{ kind, id }] while a batch runs
function _placeAll(list) {
  const last = new Map();         // id -> the kind it ended as
  for (const x of list || []) last.set(x.id, x.kind);
  const lists = {};
  const recOf = (kind, id) => {
    if (!lists[kind]) { try { lists[kind] = RECORD_STORES[kind].read(); } catch (e) { lists[kind] = []; } }
    return lists[kind].find(x => x && String(x.id) === id) || null;
  };
  const items = [];
  for (const [id, kind] of last) { const rec = recOf(kind, id); if (rec) items.push({ kind, rec }); }
  if (items.length) SHELF.placeRecords(items);
}

// (phase V54) The bodies of the three item routes are functions - { status, body } - so the batch routes below do to
// several items exactly what these do to one.
function _patchOne(kindIn, idIn, bodyIn) {
    const req = { params: { kind: kindIn, id: idIn }, body: bodyIn || {} };   // the route's own names, kept
    const kind = String(req.params.kind || '');
    // (phase V73, the owner's (rn-2) а) A render's Rename - its only change here: the file takes the name by the rule of
    // lib/render-files.js (its .srt, its poster, the queue's entry and a highlights fragment's record follow; " (2)" when
    // taken). The id is its path inside media/renders/ - a new id comes back.
    if (kind === 'renders') {
      const id = String(req.params.id || '').replace(/\\/g, '/');
      const base = path.basename(id);
      if (!base || !VID_RE.test(base)) return _r(400, { success: false, error: 'not a render' });
      const abs = toDiskWithin('/media/renders/' + id, [FINALS_DIR]);
      if (!abs || !fs.existsSync(abs)) return _r(404, { success: false, error: 'not found' });
      const b = req.body || {};
      if (Object.keys(b).some(k => k !== 'name')) return _r(409, { success: false, error: 'only a render\'s name changes here' });
      const name = String(b.name || '').trim();
      if (!name) return _r(400, { success: false, error: 'a name is needed' });
      const moved = require('../lib/render-files').rename(abs, name);
      const stem = path.basename(moved.abs).replace(VID_RE, '');
      // Its entry in Queue says the name too (the move rewrote its address already).
      try { const MVQ = require('./mv3q'); const e = MVQ.findByUrl(moved.url); if (e) MVQ.updateEntry(e.id, { title: stem }); }
      catch (e) { /* no queue: the file is renamed all the same */ }
      const turl = VT.thumbUrlFor(moved.url);
      const hasThumb = !!turl && fs.existsSync(path.join(ROOT_DIR, String(turl).replace(/^\/+/, '')));
      return _r(200, { success: true, kind, id: path.relative(FINALS_DIR, moved.abs).split(path.sep).join('/'), name: stem,
        url: moved.url, thumb: hasThumb ? turl : null });
    }
    // (phase V34.E) A built-in sound: only its star, kept by its address (lib/sfx-favorites.js).
    if (kind === 'sfx') {
      const s = require('../lib/sfx-builtin').read().sounds.find(x => x.id === String(req.params.id || ''));
      if (!s) return _r(404, { success: false, error: 'no such built-in sound' });
      const b = req.body || {};
      if (!('favorite' in b) || Object.keys(b).some(k => k !== 'favorite')) {
        return _r(409, { success: false, error: 'A built-in sound is part of the app - only its star can change. Cut a piece of it to have one of your own.' });
      }
      require('../lib/sfx-favorites').set(s.path, !!b.favorite);
      return _r(200, { success: true, kind, id: s.id, patch: { favorite: !!b.favorite }, item: { id: s.id, favorite: !!b.favorite } });
    }
    // (phase V55) A made environment or lookbook: written about on its shelf (PATCH /library/meta), never filed elsewhere.
    if (MADE_KINDS.has(kind)) return _r(409, { success: false, error: MADE_STAYS[kind] });
    const store = RECORD_STORES[kind];
    if (!store) return _r(400, { success: false, error: `"${kind}" cannot be edited here` });
    const id = String(req.params.id || '');
    const list = store.read();
    const it = list.find(x => x && String(x.id) === id);
    if (!it) return _r(404, { success: false, error: 'not found' });

    const patch = {};
    for (const k of store.fields) if (k in (req.body || {})) patch[k] = req.body[k];
    if (!Object.keys(patch).length) return _r(400, { success: false, error: 'nothing to set' });
    if ('name' in patch) {
      const n = String(patch.name || '').trim();
      if (!n) return _r(400, { success: false, error: 'name cannot be empty' });
      patch.name = n.slice(0, 120);
    }
    if ('favorite' in patch) patch.favorite = !!patch.favorite;
    if ('categoryId' in patch) patch.categoryId = String(patch.categoryId || '');
    // (phase V60.2, the owner's (дг10а)) A B-roll lies in its model's folder: "no folder" is that folder itself, a folder of
    // another model's is refused in words (lib/model-folders.js).
    if (kind === 'birols' && 'categoryId' in patch) {
      try {
        const t = MF.targetFor(it, patch.categoryId);
        patch.categoryId = t.id;
        patch.categoryLabel = t.label;
      } catch (e) { return _r(e.status || 409, { success: false, error: e.message }); }
    }
    // (phase V57, the owner's (ок2)) Into the references of Environments / Lookbooks - never by hand: only the photos their
    // generators are given lie there (lib/library-cats.js closedWhy). Out of them - as anywhere.
    if (patch.categoryId && patch.categoryId !== String(it.categoryId || '')) {
      const shut = LC.closedWhy(kind, patch.categoryId);
      if (shut) return _r(409, { success: false, error: shut });
    }
    // (phase V28.4) A track's name is its title: the music panel and the video chat read that.
    if (kind === 'music' && 'name' in patch) { patch.title = patch.name; delete patch.name; }
    // (phase V54 block 6) A category is a folder that is there - a nested one is chosen by its id, never guessed from a name.
    if (patch.categoryId && LC.KINDS.includes(kind)) {
      const cat = LC.find(kind, patch.categoryId);
      if (!cat && LC.isOwn(null, patch.categoryId)) return _r(400, { success: false, error: 'that folder is not one of ' + kind });
      if (cat) patch.categoryLabel = cat.label;
    }

    Object.assign(it, patch);
    // (2026-11-09) A sound filed into My sounds (or a folder of it) leaves AUDIO's own root - it lies in one place.
    if (kind === 'sounds' && 'categoryId' in patch) delete it.inAudio;
    // (phase V54) A track in an own folder of Music is out of highlights - it lies in one place.
    if (kind === 'music' && patch.categoryId) { delete it.folder; delete it.mood; }
    store.write(list);
    // Another category is another folder: the files move there, and every path to them with them.
    let item = it;
    if ('categoryId' in patch && SHELF.SHELF_KINDS.includes(kind)) {
      if (_placeLater) _placeLater.push({ kind, id });
      else {
        SHELF.placeRecords([{ kind, rec: it }]);
        item = store.read().find(x => x && String(x.id) === id) || it;
      }
    }
    // What was set and the record as it is now - its files may have moved with its category.
    return _r(200, { success: true, kind, id, patch, item });
}
router.patch('/library/item/:kind/:id', (req, res) => {
  try { const r = _patchOne(req.params.kind, req.params.id, req.body); res.status(r.status).json(r.body); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

/* ── Cutting a piece out of a video (phase TG, block 7) ──────────────────────
   A PIECE IS A NEW FILE AND A NEW TILE (the owner 2026-10-21, "вариант Б"): cut from `src` between `in` and `out` (its
   own seconds), filed where the person chose in the window after choosing the stretch - a kind of VIDEO (birols,
   uploads, hooks; a category by its label, made when new) or REFERENCES (a post of its own: an own category `cat`, or
   the folder of the site its whole video came from, Files when none). The video it was cut from is not touched.

   The piece keeps its whole video (`original`, lib/cuts.js): a piece of a piece names the first one, so its viewer's
   "original" always shows the whole video and cuts from it again. This replaces the old rule "an upload is trimmed
   ONCE and its file cut" - a clip trimmed that way keeps what it had (`trimmed`) and has no "original". */
const CUTS = require('../lib/cuts');
const CUT_KINDS = ['birols', 'uploads', 'hooks', 'references'];

// Where a piece goes, read from the request: { kind, cat, label } - refused in words before anything is cut.
function _cutTo(b) {
  const to = (b && b.to) || {};
  const kind = String(to.kind || '');
  const cat = String(to.cat || '');
  const label = String(to.label || '').trim().slice(0, 60);
  if (!CUT_KINDS.includes(kind)) { const e = new Error('a piece goes into VIDEO or REFERENCES'); e.status = 400; throw e; }
  if (kind === 'references' && cat && !LC.find('references', cat)) { const e = new Error('no such folder in REFERENCES'); e.status = 400; throw e; }
  return { kind, cat, label };
}

/**
 * A piece made by lib/cuts.js (cut, cutMany) filed where the person chose: its poster, then a clip of VIDEO or a post of its
 * own in REFERENCES. -> { kind, id, item, src, thumb, dur, name } (src..name - what a lane needs, phase V81's "Add to
 * timeline"). A piece that cannot be filed goes, with its poster.
 */
async function _filePiece(made, to) {
  let thumbPath = null;
  try {
    try { thumbPath = (await VT.makeThumb(made.videoPath)).thumb; } catch (e) { console.warn('[library/cut] poster failed:', e.message); }
    const lane = (src, item) => ({ src, thumb: thumbPath, dur: made.dur, name: made.name, item });
    if (to.kind === 'references') {
      const REFS = require('../lib/references-store');
      const from = made.root.post;
      const abs = _absInRoot(made.videoPath);
      let size = 0;
      try { size = fs.statSync(abs).size; } catch (e) { size = 0; }
      const post = REFS.add({
        source: from ? (from.source || 'other') : 'files', folder: from ? (from.folder || '') : '',
        categoryId: to.cat, categoryLabel: to.cat ? to.label : '',
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
      return { kind: 'references', id: item.id, ...lane(item.media[0].path, item) };
    }
    const { item } = _fileRecord({
      videoPath: made.videoPath, thumbPath, name: made.name, kind: to.kind, categoryId: to.cat,
      categoryLabel: to.kind === 'hooks' ? '' : to.label,
      original: made.original, duration: made.dur, w: made.w, h: made.h, link: made.root.link || '',
    });
    console.log('[library/cut]', made.original.path, made.original.in + 's..' + made.original.out + 's ->', to.kind, item.videoPath);
    return { kind: to.kind, id: item.id, ...lane(item.videoPath, item) };
  } catch (e) {
    // A file made and not filed is nobody's: it goes, with its poster.
    for (const u of [made.videoPath, thumbPath]) if (u) _unlink(u);
    throw e;
  }
}

/* ── Several pieces at once, and the scenes (phase V81) ───────────────────────
   POST   /api/library/cuts { src, parts: [{ in, out, label? }], join, to }   -> { job }
          the fragments drawn over a video (js/cuts/parts.js): `join` - ONE new clip of them all in the order of time, else
          each a new clip of its own, filed as it is made (lib/cuts.js cutMany, _filePiece) - all into the one place chosen
   GET    /api/library/cuts/:job      -> { state: working | done | stopped | failed, done, total, pieces: [{ kind, id, src,
                                         thumb, dur, name }], error }
   DELETE /api/library/cuts/:job      stop: the pieces made stay, the rest are not made (the owner's (в17))
   A job lives in the server's memory - it goes on while the viewer is closed; the app closed midway, the rest is simply not
   made (nothing is paid: no row in Alerts). Kept an hour after it ends.

   GET    /api/library/scenes?src=    the video's scenes (lib/scenes.js, rule js/cuts/parts.js scenesOf): begun when not
                                      known -> { state: working, pct } | { state: done, scenes: [{ in, out }], dur } | failed
   DELETE /api/library/scenes?src=    the search stopped */
const _cutJobs = new Map();
const CUT_JOB_KEEP_MS = 3600 * 1000;

router.post('/library/cuts', (req, res) => {
  const b = req.body || {};
  let to;
  try { to = _cutTo(b); } catch (e) { return res.status(e.status || 400).json({ success: false, error: e.message }); }
  const parts = Array.isArray(b.parts) ? b.parts.slice(0, 2000) : [];
  if (!parts.length) return res.status(400).json({ success: false, error: 'draw a fragment over the bar first' });
  for (const [k, j] of _cutJobs) if (j.endAt && Date.now() - j.endAt > CUT_JOB_KEEP_MS) _cutJobs.delete(k);
  const id = 'cj' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const job = { state: 'working', done: 0, total: 0, pieces: [], error: '', ctl: new AbortController(), endAt: 0 };
  _cutJobs.set(id, job);
  (async () => {
    try {
      await CUTS.cutMany(String(b.src || ''), parts, {
        join: !!b.join, signal: job.ctl.signal,
        onTotal: (n) => { job.total = n; },
        onPart: async (made) => {
          const r = await _filePiece(made, to);
          job.pieces.push({ kind: r.kind, id: r.id, src: r.src, thumb: r.thumb, dur: r.dur, name: r.name });
          job.done++;
        },
      });
      job.state = 'done';
    } catch (e) {
      job.state = (e && e.stopped) || job.ctl.signal.aborted ? 'stopped' : 'failed';
      if (job.state === 'failed') { job.error = e.message; console.warn('[library/cuts]', e.message); }
    }
    job.ctl = null;
    job.endAt = Date.now();
  })();
  res.json({ success: true, job: id });
});

router.get('/library/cuts/:job', (req, res) => {
  const j = _cutJobs.get(String(req.params.job || ''));
  if (!j) return res.status(404).json({ success: false, error: 'no such work' });
  res.json({ success: true, state: j.state, done: j.done, total: j.total, pieces: j.pieces, error: j.error });
});

router.delete('/library/cuts/:job', (req, res) => {
  const j = _cutJobs.get(String(req.params.job || ''));
  if (!j) return res.status(404).json({ success: false, error: 'no such work' });
  if (j.ctl) j.ctl.abort();
  res.json({ success: true });
});

const _scenesFile = (q) => toDiskExisting(String((q && q.src) || '').split('?')[0]);
router.get('/library/scenes', (req, res) => {
  const abs = _scenesFile(req.query);
  if (!abs || !fs.existsSync(abs)) return res.status(400).json({ success: false, error: 'src - a video of the library' });
  const SC = require('../lib/scenes');
  const st = SC.start(abs);
  if (st.state === 'done') {
    const { scenesOf } = require('../public/js/cuts/parts.js');
    return res.json({ success: true, state: 'done', dur: st.dur, scenes: scenesOf(st.changes, st.dur) });
  }
  res.json({ success: true, state: st.state, pct: st.pct || 0, error: st.error || '' });
});

router.delete('/library/scenes', (req, res) => {
  const abs = _scenesFile(req.query);
  if (!abs) return res.status(400).json({ success: false, error: 'src - a video of the library' });
  res.json({ success: true, stopped: require('../lib/scenes').cancel(abs) });
});

function _deleteOne(kindIn, idIn, filesIn) {
    const req = { params: { kind: kindIn, id: idIn }, query: { files: filesIn === false ? '0' : '1' } };
    const kind = String(req.params.kind || '');
    if (kind === 'sfx') return _r(409, { success: false, error: 'A built-in sound is part of the app - it is not deleted.' });
    const id = String(req.params.id || '');
    // (phase V59.1) A saved text of Music -> Lyrics: no file goes with it.
    if (kind === 'lyrics') {
      try { LY.remove(id); return _r(200, { success: true, kind, id, removed: [] }); }
      catch (e) { return _r(e.status || 500, { success: false, error: e.message }); }
    }
    const withFiles = req.query.files !== '0';
    const removed = [], spared = [];

    const shelf = FILE_SHELVES[kind];
    if (shelf) {
      // The id IS the filename. basename() it so nothing can walk out of the dir.
      const base = path.basename(id);
      if (!base || !IMG_RE.test(base)) return _r(400, { success: false, error: 'not an image on this shelf' });
      if (!fs.existsSync(path.join(shelf.dir, base))) return _r(404, { success: false, error: 'not found' });
      // (phase V58, (лк4)) An environment a talking head is set in, or a 3D scene was laid out from, stays - in words.
      if (kind === 'environments') {
        const why = require('../lib/casting-use').envRefusal(`${shelf.url}/${base}`);
        if (why) return _r(409, { success: false, error: why });
      }
      if (_unlink(`${shelf.url}/${base}`)) removed.push(base);
      _unlink(`${shelf.url}/thumbs/${base.replace(/\.[^.]+$/, '.jpg')}`);
      // And its preview, made for a large one when it was filed (routes/scen3.js _previewTarget) - it
      // was left behind before phase I, where every environment the chat makes has one.
      _unlink(`${shelf.url}/preview/${base.replace(/\.[^.]+$/, '.jpg')}`);
      // What the agent wrote about it goes with it (lib/shelf-meta.js) - an entry for a picture
      // that no longer exists is only something a later picture of the same name could inherit.
      try { require('../lib/shelf-meta').drop(kind, `${shelf.url}/${base}`); }
      catch (e) { console.warn('[library] could not drop the description of', base, e.message); }
      return _r(200, { success: true, kind, id, removed });
    }

    // Renders. No record to remove - the file IS the entry - so this unlinks the video, its
    // poster and what lies beside it (below).
    if (kind === 'renders') {
      const base = path.basename(id);
      if (!base || !VID_RE.test(base)) return _r(400, { success: false, error: 'not a render' });
      // The id is the render's path inside media/renders/ - its project folder and name.
      const abs = toDiskWithin('/media/renders/' + String(id).replace(/\\/g, '/'), [FINALS_DIR]);
      if (!abs || !fs.existsSync(abs)) return _r(404, { success: false, error: 'not found' });
      const url = toUrl(abs);
      if (_unlink(url)) removed.push(base);
      const turl = VT.thumbUrlFor(url);
      if (turl) _unlink(turl);
      // Its subtitles file beside it (phase V30, block 4).
      try { fs.rmSync(JOB.srtOf(abs), { force: true }); } catch (e) { /* held open */ }
      // (phase V73, the owner's (rn-4) а) and its entry in Queue, as /mv3/render/discard takes it - Queue -> open would open
      // a file that is gone
      try { require('./mv3q').removeByUrl(url); } catch (e) { /* no queue */ }
      return _r(200, { success: true, kind, id, removed });
    }

    const store = RECORD_STORES[kind];
    if (!store) return _r(400, { success: false, error: `"${kind}" cannot be deleted here` });
    const list = store.read();
    const it = list.find(x => x && String(x.id) === id);
    if (!it && kind === 'heads') return _r(409, { success: false, error: 'This talking head is its project\'s - it is deleted in the project, or kept when the project is deleted.' });
    if (!it) return _r(404, { success: false, error: 'not found' });
    // (phase V58, (лк3)) A look a talking head is cast in stays - in words, with the project's name.
    if (kind === 'obrazy') {
      let dir = '';
      try { const abs = store.folder(it); dir = abs ? toUrl(abs) : ''; } catch (e) { dir = ''; }
      const why = require('../lib/casting-use').lookRefusal(it, dir);
      if (why) return _r(409, { success: false, error: why });
    }

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
    // (phase V54) A piece of a track names the TRACK - never dropped as an orphan.
    if (withFiles && kind !== 'music') removed.push(...CUTS.dropOrphans(_originalsOf([it])));
    // `spared` is a file another record is still using, so it stayed put.
    return _r(200, { success: true, kind, id, removed, spared });
}
router.delete('/library/item/:kind/:id', (req, res) => {
  try { const r = _deleteOne(req.params.kind, req.params.id, req.query.files !== '0'); res.status(r.status).json(r.body); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
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
function _kindOne(fromIn, idIn, toIn) {
    const from = String(fromIn || '');
    const to = String(toIn || '');
    const id = String(idIn || '');
    const KINDS = ['birols', 'uploads', 'hooks'];
    if (!KINDS.includes(from) || !KINDS.includes(to)) return _r(400, { success: false, error: 'kind must be birols, uploads or hooks' });
    if (from === to) return _r(200, { success: true, kind: to, id, unchanged: true });

    const src = RECORD_STORES[from];
    const dst = RECORD_STORES[to];
    const srcList = src.read();
    const it = srcList.find(x => x && String(x.id) === id);
    if (!it) return _r(404, { success: false, error: 'not found' });

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
      // (phase V60.2) A B-roll lies in its model's folder (a clip of before told by its file's name); out of B-rolls, out of
      // it - a folder of B-rolls is no folder of Uploads.
      if (to === 'birols') {
        const f = MF.folderFor(MF.modelOf(Object.assign({}, it, { categoryId: '' }), { byName: true }));
        it.categoryId = f.id; it.categoryLabel = f.label;
      } else if (from === 'birols') { it.categoryId = ''; it.categoryLabel = ''; }
      stamp(it);
      src.write(srcList);
      // Another shelf is another folder.
      if (_placeLater) { _placeLater.push({ kind: to, id }); return _r(200, { success: true, kind: to, id, item: it }); }
      SHELF.placeRecords([{ kind: to, rec: it }]);
      const placed = src.read().find(x => x && String(x.id) === id) || it;
      return _r(200, { success: true, kind: to, id, item: placed });
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
      // (phase V60.2) A hook made a B-roll: into its model's folder - Other, unless its file's name says (a clip of before).
      if (to === 'birols') {
        const f = MF.folderFor(MF.modelOf(moved, { byName: true }));
        moved.categoryId = f.id; moved.categoryLabel = f.label;
      }
    }
    const dstList = dst.read();
    dstList.unshift(moved);
    dst.write(dstList);
    src.write(srcList.filter(x => x !== it));
    // Another shelf is another folder: the files move, the record and every other path follow.
    if (_placeLater) { _placeLater.push({ kind: to, id: String(moved.id) }); return _r(200, { success: true, kind: to, id, item: moved }); }
    SHELF.placeRecords([{ kind: to, rec: moved }]);
    Object.assign(moved, dst.read().find(x => x && String(x.id) === String(moved.id)) || {});
    return _r(200, { success: true, kind: to, id, item: moved });
}
router.post('/library/item/:kind/:id/kind', (req, res) => {
  try { const r = _kindOne(req.params.kind, req.params.id, (req.body || {}).kind); res.status(r.status).json(r.body); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ════════════════════════════════════════════════════════════════════════════
// SEVERAL TILES AT ONCE (phase V54 block 5, the owner 2026-10-27: "выделение нескольких файлов ... с зажатым shift
// (выделение от и до) и с зажатым ctrl"; (зв17)) - js/tile-select.js picks tiles in Library -> Media and in Merge's
// Library panel; these do to every one of them what the item routes above do to one, in ONE request and one tick (every
// step is synchronous).
//
//   POST /api/library/batch/move     { items: [{ kind, id }], to: { kind, cat, label, folder, mood } }
//   POST /api/library/batch/favorite { items, favorite }
//   POST /api/library/batch/delete   { items }
//     -> { success, done, skipped: [{ kind, id, name, why }], removed? }
//
// A move does what letting ONE tile go on that node does (js/media-tree.js _dropAction): within a kind - its category
// (the file moves with relocate, as for one); between the kinds of video - the kind, then the category; a track between
// Music, highlights and the mood its preset made (lib/music-store.js place); a whole post between REFERENCES' own
// categories and its source's folder. What cannot go there stays and says why: a picture never becomes a clip, a built-in
// sound is the app's, a talking head its project's, a post goes out of REFERENCES only by itself (its own window).
// ════════════════════════════════════════════════════════════════════════════
const BATCH_MAX = 2000;            // js/tile-select.js says the same; more is refused in words before anything is done
const _BVIDEO = new Set(['birols', 'uploads', 'hooks']);

function _batchItems(b) {
  const seen = new Set();
  const raw = Array.isArray(b && b.items) ? b.items : [];
  if (raw.length > BATCH_MAX) throw Object.assign(new Error('At most ' + BATCH_MAX + ' at once - ' + raw.length + ' were picked. Nothing was done.'), { status: 400 });
  return raw
    .map(x => ({ kind: String((x && x.kind) || ''), id: String((x && x.id) || '') }))
    .filter(x => x.kind && x.id && !seen.has(x.kind + ':' + x.id) && seen.add(x.kind + ':' + x.id));
}
const _whyOf = (r) => (r && r.body && r.body.error) || 'not done';
function _recOf(kind, id) {
  const st = RECORD_STORES[kind];
  if (!st) return null;
  try { return st.read().find(x => x && String(x.id) === String(id)) || null; } catch (e) { return null; }
}
const _nameOfRec = (kind, id) => {
  // (phase V55) A made environment or lookbook has no record: its id is its file's name.
  // (phase V26.6) A product goes by the name it was given.
  if (kind === 'props') { const m = SM.read('props')[toUrl(PROPS_DIR) + '/' + path.basename(String(id || ''))] || {}; if (m.name) return String(m.name); }
  if (MADE_KINDS.has(kind)) return String(id || '').replace(/\.[^.]+$/, '');
  if (kind === 'lyrics') { const l = LY.get(id); return l ? l.title : ''; }
  const r = _recOf(kind, id);
  return r ? String(r.name || r.title || '') : '';
};

// (phase V59.1) What Music -> Lyrics says to a move - the same words as js/media-tree.js.
const LYRICS_STAY = 'a text stays in Music → Lyrics';
const LYRICS_TAKE = 'only Generate music saves texts into Music → Lyrics';

// One item to `to`: '' when it went (or was there already), else why not.
function _moveOne(it, to) {
  const from = it.kind;
  if (from === 'sfx') return 'a built-in sound stays in Built-in';
  if (from === 'heads') return 'a talking head is its project\'s';
  if (from === 'youtube') return 'a YouTube source stays in REFERENCES';
  // (phase V55, (гн9)) A picture an environment's or a lookbook's generator made is never moved; and nothing is moved in.
  if (MADE_KINDS.has(from)) return MADE_STAYS[from];
  if (MADE_KINDS.has(to.kind)) return MADE_TAKES[to.kind];
  // (phase V59.1, (мз6а)) A saved text stays in Music -> Lyrics, and only Generate music saves into it.
  if (from === 'lyrics') return LYRICS_STAY;
  if (to.kind === 'lyrics') return LYRICS_TAKE;
  // (2026-11-09, the owner's (в20)) A sound and a track: between Music, SFX -> My sounds and AUDIO's root, either way.
  if (AUDIO_MOVES.has(from) && AUDIO_MOVES.has(to.kind) && (from !== to.kind || from === 'sounds')) return _audioMove(it, to);
  if (from === 'music' || to.kind === 'music') {
    if (from !== to.kind) return from === 'music' ? 'a track goes into Music, SFX or AUDIO' : 'only tracks and sounds go into Music';
    if (to.cat) {
      const rec = _recOf('music', it.id);
      if (!rec) return 'not found';
      if (String(rec.categoryId || '') === to.cat) return '';
      const r = _patchOne('music', it.id, { categoryId: to.cat, categoryLabel: to.label || '' });
      return r.status === 200 ? '' : _whyOf(r);
    }
    try {
      // Out of an own folder: its file is placed with the rest of the batch.
      const r = MUSIC.place(it.id, { folder: to.folder || '', mood: to.mood || '' }, { later: !!_placeLater });
      if (r && r.left && _placeLater) _placeLater.push({ kind: 'music', id: String(it.id) });
      return '';
    }
    catch (e) { return e.message; }
  }
  if (from === 'references' || to.kind === 'references') {
    return from === 'references' ? 'a post goes out of REFERENCES by itself - from its own window' : 'only posts go into REFERENCES';
  }
  const rec = _recOf(from, it.id);
  if (!rec) return 'not found';
  if (to.kind === from) {
    if (String(rec.categoryId || '') === String(to.cat || '')) return '';
    const r = _patchOne(from, it.id, { categoryId: to.cat || '', categoryLabel: to.cat ? (to.label || '') : '' });
    return r.status === 200 ? '' : _whyOf(r);
  }
  if (_BVIDEO.has(from) && _BVIDEO.has(to.kind)) {
    // Off its own kind's category first, as one tile let go does: a category is one kind's.
    if (rec.categoryId && rec.categoryId !== UPLOADS_CAT) {
      const r0 = _patchOne(from, it.id, { categoryId: '', categoryLabel: '' });
      if (r0.status !== 200) return _whyOf(r0);
    }
    const r1 = _kindOne(from, it.id, to.kind);
    if (r1.status !== 200) return _whyOf(r1);
    if (to.cat) {
      const r2 = _patchOne(to.kind, it.id, { categoryId: to.cat, categoryLabel: to.label || '' });
      if (r2.status !== 200) return _whyOf(r2);
    }
    return '';
  }
  if (from === 'images') return 'a picture never becomes a clip or a sound';
  if (to.kind === 'images') return 'only pictures go into IMAGES';
  return 'it cannot go there';
}

// (2026-11-09, the owner's (в19)-(в20): "должно ложится в корень audio. там пользователь уже распределит по своим папкам" -
// "разрешить переносить") A sound into My sounds, a folder of it or AUDIO's own root (`to.aroot`); a sound into Music, a
// track into SFX or AUDIO - the record changes store (lib/audio-kind.js swap). Its file is placed with the rest of a batch,
// or at once. '' when it went, else why not.
const AUDIO_MOVES = new Set(['sounds', 'music']);
const AK = require('../lib/audio-kind');
function _placeAudio(kind, id) {
  if (_placeLater) { _placeLater.push({ kind, id: String(id) }); return; }
  const rec = _recOf(kind, id);
  if (rec) SHELF.placeRecords([{ kind, rec }]);
}
function _audioMove(it, to) {
  const from = it.kind;
  const rec = _recOf(from, it.id);
  if (!rec) return 'not found';
  if (to.kind === 'music') {
    // A sound into Music: an own folder of it, or Music itself / highlights / the mood its preset made it for.
    let place;
    if (to.cat) {
      const c = LC.find('music', to.cat);
      if (!c) return 'that folder is not one of Music';
      place = { categoryId: c.id, categoryLabel: c.label };
    } else {
      if (to.folder && to.folder !== MUSIC.HIGHLIGHTS) return 'there is no folder "' + to.folder + '" in Music';
      if (to.mood) {
        const was = AK.carriedOf(rec);
        const made = was && was.kind === 'music' ? MUSIC.placeOf(was.rec).moodMade : '';
        if (made !== to.mood) {
          const m = MUSIC.moods().find(x => x.id === to.mood);
          return '"' + (m ? m.label : to.mood) + '" takes only the tracks made by its preset - yours go into highlights itself';
        }
      }
      place = { folder: to.folder || '', mood: to.folder ? (to.mood || '') : '' };
    }
    try { AK.swap('sounds', it.id, place); } catch (e) { return e.message; }
    _placeAudio('music', it.id);
    return '';
  }
  // Into SFX -> My sounds (a folder of it) or AUDIO's own root.
  const cat = to.aroot ? '' : String(to.cat || '');
  let label = '';
  if (cat) {
    const c = LC.find('sounds', cat);
    if (!c) return 'that folder is not one of My sounds';
    label = c.label;
  }
  if (from === 'music') {
    try { AK.swap('music', it.id, { categoryId: cat, categoryLabel: label, inAudio: !!to.aroot }); } catch (e) { return e.message; }
    _placeAudio('sounds', it.id);
    return '';
  }
  if (String(rec.categoryId || '') === cat && !!rec.inAudio === !!to.aroot) return '';
  if (!to.aroot) {
    const r = _patchOne('sounds', it.id, { categoryId: cat, categoryLabel: label });
    return r.status === 200 ? '' : _whyOf(r);
  }
  // Into AUDIO's root: out of its folder, its file into media/sounds/nocat/.
  const list = SND.read();
  const s = list.find(x => x && String(x.id) === String(it.id));
  if (!s) return 'not found';
  s.categoryId = ''; s.categoryLabel = ''; s.inAudio = true;
  SND.write(list);
  _placeAudio('sounds', it.id);
  return '';
}

// Whole posts within REFERENCES - an own category, or back to their sources' folders (`cat` ''), in one write.
function _postsTo(ids, to) {
  const REFS = require('../lib/references-store');
  const cat = String(to.cat || '');
  if (cat && !LC.find('references', cat)) return ids.map(id => ({ id, why: 'no such folder in REFERENCES' }));
  const moved = [];
  const found = new Set();
  REFS.apply((list) => {
    for (const p of list) {
      if (!p || !ids.includes(String(p.id))) continue;
      found.add(String(p.id));
      if (String(p.categoryId || '') === cat) continue;
      p.categoryId = cat;
      p.categoryLabel = cat ? String(to.label || '') : '';
      p.handled = true;            // moved by hand is seen - not news in the tree
      moved.push(String(p.id));
    }
  });
  if (moved.length) REFS.placePosts(REFS.read().filter(p => p && moved.includes(String(p.id))));
  return ids.filter(id => !found.has(id)).map(id => ({ id, why: 'no such post' }));
}

function _batchAnswer(res, items, skipped, extra) {
  res.json(Object.assign({ success: true, done: items.length - skipped.length,
    skipped: skipped.map(x => Object.assign({ name: x.name || _nameOfRec(x.kind, x.id) }, x)) }, extra || {}));
}

router.post('/library/batch/move', (req, res) => {
  try {
    const items = _batchItems(req.body);
    const t = (req.body || {}).to || {};
    const to = { kind: String(t.kind || ''), cat: String(t.cat || ''), label: String(t.label || ''),
      folder: String(t.folder || ''), mood: String(t.mood || ''), aroot: !!t.aroot && String(t.kind || '') === 'sounds' };
    if (!items.length || !to.kind) return res.status(400).json({ success: false, error: 'what, and where to' });
    if (to.cat === UNCAT) to.cat = '';
    // (phase V57) The references of Environments / Lookbooks take nothing by hand - said once, nothing moved.
    const shut = LC.closedWhy(to.kind, to.cat);
    if (shut) return res.status(409).json({ success: false, error: shut });
    const skipped = [];
    const posts = items.filter(x => x.kind === 'references');
    if (posts.length) {
      if (to.kind !== 'references') for (const x of posts) skipped.push({ kind: x.kind, id: x.id, why: _moveOne(x, to) });
      else for (const s of _postsTo(posts.map(x => x.id), to)) skipped.push({ kind: 'references', id: s.id, why: s.why });
    }
    // Every record changed first, the files placed ONCE at the end (`_placeAll`) - also when one fails midway.
    _placeLater = [];
    try {
      for (const x of items) {
        if (x.kind === 'references') continue;
        const why = _moveOne(x, to);
        if (why) skipped.push({ kind: x.kind, id: x.id, why });
      }
    } finally {
      const l = _placeLater;
      _placeLater = null;
      _placeAll(l);
    }
    _batchAnswer(res, items, skipped);
  } catch (e) { res.status(e.status || 500).json({ success: false, error: e.message }); }
});

router.post('/library/batch/favorite', (req, res) => {
  try {
    const items = _batchItems(req.body);
    if (!items.length) return res.status(400).json({ success: false, error: 'nothing chosen' });
    const favorite = !!(req.body || {}).favorite;
    const skipped = [];
    for (const x of items) {
      if (x.kind === 'references' || x.kind === 'heads' || x.kind === 'youtube' || x.kind === 'lyrics' || MADE_KINDS.has(x.kind)) { skipped.push({ kind: x.kind, id: x.id, why: 'it has no star' }); continue; }
      const r = _patchOne(x.kind, x.id, { favorite });
      if (r.status !== 200) skipped.push({ kind: x.kind, id: x.id, why: _whyOf(r) });
    }
    _batchAnswer(res, items, skipped, { favorite });
  } catch (e) { res.status(e.status || 500).json({ success: false, error: e.message }); }
});

router.post('/library/batch/delete', (req, res) => {
  try {
    const items = _batchItems(req.body);
    if (!items.length) return res.status(400).json({ success: false, error: 'nothing chosen' });
    const skipped = [];
    const removed = [];
    for (const x of items) {
      if (x.kind === 'youtube') { skipped.push({ kind: x.kind, id: x.id, why: 'a YouTube source is deleted on its own tile' }); continue; }
      const name = _nameOfRec(x.kind, x.id);
      const r = _deleteOne(x.kind, x.id, true);
      if (r.status !== 200) { skipped.push({ kind: x.kind, id: x.id, name, why: _whyOf(r) }); continue; }
      removed.push(...((r.body && r.body.removed) || []));
    }
    _batchAnswer(res, items, skipped, { removed });
  } catch (e) { res.status(e.status || 500).json({ success: false, error: e.message }); }
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
// POST /api/biroly/upload puts the file in media/work/ and makes its thumbnail, then this
// files it on the shelf. source:'upload' is what tells the shelf it is an upload rather
// than a generated birol — and unshift, so a clip you just added is the first card you see.
router.post('/library/media/record', (req, res) => {
  try {
    const { item, kind } = _fileRecord(req.body || {});
    res.json({ success: true, item, kind });
  } catch (e) { res.status(e.status || 500).json({ success: false, error: e.message }); }
});

// The filing itself, for the route above and for a clip that came in by a link (phase V27, lib/link-queue.js): the
// same record, the same place and the same proxy as a file brought in by hand. Throws with `status`.
function _fileRecord(b) {
  const _no = (status, msg) => { const e = new Error(msg); e.status = status; return e; };
  const { videoPath, thumbPath, name, refImage, prompt, categoryLabel, categoryId } = b;
  if (!videoPath || !_onDisk(videoPath)) throw _no(400, 'videoPath must be a file that exists');
  // Which kind the clip is filed as follows what the page had open, so uploading while
  // looking at Hooks puts it among the hooks. Uploads is the default: it is where a file
  // you brought in belongs when nothing says otherwise.
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
  // existing category rather than making a second one with the same name, so asking for it every
  // time is the same as asking whether it exists. A hook is filed by id only.
  // (phase V54 block 6) A folder chosen by its id - with folders in folders a name may be in several places.
  const byId = categoryId ? LC.find(kind, String(categoryId)) : null;
  if (byId) {
    rec.categoryId = byId.id;
    rec.categoryLabel = byId.label;
  } else if (categoryLabel && kind !== 'hooks' && kind !== 'birols') {
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
  // block 7: every video of the shelf may be cut into new pieces (POST /library/cuts).
  if (b.trimmable === true) rec.trimmable = true;
  // (phase V27) A clip that came in by a link keeps it - the viewer shows it - and what it is known by under every
  // spelling of it (lib/ytdlp.js info().key), so the same video is not fetched onto the shelf twice.
  if (b.link) rec.link = String(b.link).slice(0, 2000);
  if (b.linkKey) rec.linkKey = String(b.linkKey).slice(0, 200);
  // (phase TG, block 7) A piece cut out of a video: its whole video (lib/cuts.js), its length and frame.
  if (b.original && b.original.path) {
    const o = b.original;
    rec.original = { path: String(o.path), in: +o.in || 0, out: +o.out || 0, dur: +o.dur || 0, name: String(o.name || '').slice(0, 120) };
    const parts = _origParts(o);
    if (parts) rec.original.parts = parts;
  }
  if (+b.duration > 0) rec.duration = Math.round(+b.duration * 100) / 100;
  if (+b.w > 0 && +b.h > 0) { rec.w = +b.w; rec.h = +b.h; }
  // (phase V60.2, the owner's (дг4а), (дг10а)) A B-roll lies in the folder of the model that made it - a piece its clip's, a
  // file brought in Other's: a group asked for by name inside that folder, one of another model's refused in words.
  if (kind === 'birols') {
    const model = MF.modelOf(Object.assign({}, rec, { categoryId: '' }));
    if (!rec.categoryId && categoryLabel) {
      const g = MF.groupFor(model, String(categoryLabel));
      rec.categoryId = g.id; rec.categoryLabel = g.label;
    } else {
      const t = MF.targetFor(rec, rec.categoryId, { model });
      rec.categoryId = t.id; rec.categoryLabel = t.label;
    }
  }
  list.unshift(rec);
  store.write(list);
  // Filed means placed: the file leaves media/work/ (or wherever it was) for its kind and
  // category's folder, and anything already pointing at it - a take already on a timeline -
  // follows (lib/shelf-files.js).
  SHELF.placeRecords([{ kind, rec }]);
  const item = store.read().find(e => e && e.id === rec.id) || rec;
  // On the shelf means it can land on a lane: its preview proxy is queued now.
  try { require('./proxies').warmProxies([item.videoPath], 480); } catch (e) {}
  return { item, kind };
}

// ════════════════════════════════════════════════════════════════════════════
// CATEGORIES - FOLDERS - one list per kind, owned by lib/library-cats.js; moved with their files by lib/folders.js
//
//   GET    /api/library/cats?kind=          the lists, for the dropdowns: every folder with its `parent` and `trail` (its
//                                           names from the top), in the tree's order; `closed` (V57) - nothing goes there by hand
//   POST   /api/library/cats                { kind, label }           filed by name (the code's way: top first, then anywhere)
//                                           { kind, label, parent }   (phase V54) a new folder in `parent` ('' - the kind)
//   PATCH  /api/library/cats/:id            { kind, label }           rename (its folder on the disk with everything under it)
//   POST   /api/library/cats/:id/move       { kind, parent }          (phase V54) into another folder of its kind
//   DELETE /api/library/cats/:id            ?kind=&media=move|delete
//
// Records keep a DENORMALISED copy of the name in `categoryLabel` - lib/folders.js refreshes it on a rename.
// (phase V54 block 6, the owner 2026-10-27/28) Folders in folders, with no limit of depth - (зв19)-(зв22), (зв27), (зв33)-(зв46).
// ════════════════════════════════════════════════════════════════════════════

// The records that a category of this kind actually stands for. birols and uploads share one
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

// A folder and every folder under it - an orphan is only itself.
function _subtree(kind, id) {
  const ids = LC.subtreeOf(LC.read(), kind, id);
  return ids.length ? ids : [String(id)];
}

// Every list in one request, in the tree's order (the locked first, then A-Z, a folder's own after it), each folder
// with where it is: `parent`, `trail`. A card's dropdown offers its OWN kind's list, by path - "Товары / Обувь / Лето".
router.get('/library/cats', (_req, res) => {
  try {
    const byKind = {};
    const state = LC.read();
    // (phase V60.2) B-rolls: which model's folder each lies in (`model` - a dropdown offers a clip its own model's), and a
    // model's folder with nothing under it is not offered ((дг9б)).
    const bUsed = new Set();
    for (const e of RECORD_STORES.birols.read()) if (e && e.categoryId) bUsed.add(MF.modelOfCat(state, e.categoryId));
    for (const k of LC.KINDS) {
      // (phase V57) `closed` - the references of Environments / Lookbooks and what is under them: a dropdown offers them only
      // as where a picture already is (lib/library-cats.js closedWhy).
      const list = LC.listFor(k, {}, null).map(c => ({ id: c.id, label: c.label, own: c.own, locked: c.locked, title: c.title,
        parent: c.parent || '', trail: c.trail || [c.title], ...(LC.closedWhy(k, c.id, state) ? { closed: true } : {}),
        ...(k === 'birols' ? { model: MF.modelOfCat(state, c.id) } : {}) }))
        .filter(c => !(k === 'birols' && MF.isModelCat(c.id) && !bUsed.has(c.model)));
      const kids = (p) => list.filter(c => c.parent === p)
        .sort((a, b) => (Number(!!b.locked) - Number(!!a.locked)) || _abc(a.title || a.label, b.title || b.label));
      const out = [];
      const walk = (p) => { for (const c of kids(p)) { out.push(c); walk(c.id); } };
      walk('');
      byKind[k] = out;
    }
    res.json({ success: true, byKind });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/library/cats', (req, res) => {
  try {
    const b = req.body || {};
    const kind = String(b.kind || '');
    if (!LC.KINDS.includes(kind)) return res.status(400).json({ success: false, error: 'kind must be one of ' + LC.KINDS.join(', ') });
    // (phase V60.2) Filed by name at the top of B-rolls - there is no such place: the top is the models' folders.
    if (kind === 'birols' && !('parent' in b)) return res.status(409).json({ success: false, error: LC.MODELS_TOP });
    // (phase V54) A folder made where the person asked - in `parent`, or the kind itself.
    const { cat, created } = ('parent' in b) ? LC.make(kind, b.label, String(b.parent || '')) : LC.add(kind, b.label);
    res.json({ success: true, cat, created });
  } catch (e) { res.status(e.status || 400).json({ success: false, error: e.message }); }
});

router.patch('/library/cats/:id', (req, res) => {
  try {
    const id = String(req.params.id || '');
    const kind = String((req.body || {}).kind || '');
    const label = String((req.body || {}).label || '').trim();
    if (!LC.KINDS.includes(kind)) return res.status(400).json({ success: false, error: 'kind must be one of ' + LC.KINDS.join(', ') });
    if (id === LC.UNCAT) return res.status(400).json({ success: false, error: 'Uncategorized is not a category' });
    if (LC.isLocked(kind, id)) return res.status(409).json({ success: false, error: 'This folder is required - it cannot be renamed. Folders inside it can.' });
    if (!label) return res.status(400).json({ success: false, error: 'A folder needs a name.' });

    // An orphan becomes a real category first, under the name its records carry.
    if (!LC.isOwn(kind, id)) {
      const { list, inKind } = _kindRecords(kind);
      const one = list.find(e => inKind(e) && String(e.categoryId || '') === id);
      LC.adopt(kind, id, (one && one.categoryLabel) || label);
    }
    // The label changes, the folder moves with every path under it, and the copies of the label on the records follow.
    const cat = FOLDERS.rename(kind, id, label);
    res.json({ success: true, cat, renamed: true });
  } catch (e) { res.status(e.status || 400).json({ success: false, error: e.message }); }
});

// (phase V54 block 6) Into another folder of its kind - `parent` '' is the kind itself. A folder of the same name there is
// refused in words (зв35); so is a required one, and one into itself.
router.post('/library/cats/:id/move', (req, res) => {
  try {
    const id = String(req.params.id || '');
    const b = req.body || {};
    const kind = String(b.kind || '');
    if (!LC.KINDS.includes(kind)) return res.status(400).json({ success: false, error: 'kind must be one of ' + LC.KINDS.join(', ') });
    if (!LC.isOwn(kind, id)) return res.status(404).json({ success: false, error: 'That folder is not there any more.' });
    const cat = FOLDERS.move(kind, id, String(b.parent || ''));
    res.json({ success: true, cat });
  } catch (e) { res.status(e.status || 400).json({ success: false, error: e.message }); }
});

// media=move   (the default) what is in it goes ONE LEVEL UP (phase V54 block 6, (зв46)): its files into the folder it is
//              in - at the top, into the kind itself (their files into nocat; REFERENCES' posts back to their sources'
//              folders; Music's tracks into Music) - and its folders become that folder's. A folder there of a name one
//              of them has is refused in words before anything moves (зв35).
// media=delete REMOVES what is in it AND IN EVERY FOLDER UNDER IT: files unlinked, records dropped. Irreversible, and the
//              page names how many and the projects that use them before it can be chosen.
//
// Any folder can go but a required one. An orphan has nothing stored - it exists only because records point at it.
router.delete('/library/cats/:id', (req, res) => {
  try {
    const id = String(req.params.id || '');
    const kind = String(req.query.kind || '');
    const mode = String(req.query.media || 'move') === 'delete' ? 'delete' : 'move';
    if (!LC.KINDS.includes(kind)) return res.status(400).json({ success: false, error: 'kind must be one of ' + LC.KINDS.join(', ') });
    if (id === LC.UNCAT) return res.status(400).json({ success: false, error: 'Uncategorized is not a category' });
    // Refused BEFORE its media are moved or deleted below.
    if (LC.isLocked(kind, id)) return res.status(409).json({ success: false, error: 'This folder is required - it cannot be deleted. Folders inside it can.' });
    const own = LC.isOwn(kind, id);
    if (mode === 'move') {
      if (own) {
        const c = LC.find(kind, id);
        const r = FOLDERS.empty(kind, id, c.parent, { byHand: true });
        return res.json({ success: true, id, kind, mode, affected: r.records, folders: r.folders, removedFiles: [], sparedFiles: [], disposition: 'removed' });
      }
      // An orphan: its records to no category, their files placed.
      const { list, inKind } = _kindRecords(kind);
      const ids = new Set(list.filter(e => inKind(e) && String(e.categoryId || '') === id).map(e => String(e.id)));
      const r = _reassign(kind, id, '', '');
      if (kind === 'references') {
        require('../lib/references-store').apply((l) => { for (const e of l) if (e && ids.has(String(e.id))) e.handled = true; });
        require('../lib/references-store').placePosts(require('../lib/references-store').read().filter(e => e && ids.has(String(e.id))));
      } else SHELF.placeRecords(_kindRecords(kind).list.filter(e => e && ids.has(String(e.id))).map(rec => ({ kind, rec })));
      return res.json({ success: true, id, kind, mode, affected: r.moved, folders: 0, removedFiles: [], sparedFiles: [], disposition: 'orphan' });
    }
    // Delete: the folder and every folder under it, with what is in them.
    const state = LC.read();
    const ids = _subtree(kind, id);
    const paths = ids.map(x => (LC.byIdOf(state, kind, x) || {}).folder).filter(Boolean);
    const { store, list, inKind } = _kindRecords(kind);
    const want = new Set(ids);
    const doomed = list.filter(e => inKind(e) && want.has(String(e.categoryId || '')));
    const files = [];
    for (const e of doomed) for (const p of (store.files ? store.files(e) : [])) files.push(p);
    // One pass for the whole set: a file shared BETWEEN two doomed records must not be treated as still in use by the
    // second one.
    const r = _unlinkUnused(files, doomed.map(e => e.id));
    const removedFiles = r.removed.slice();
    if (doomed.length) store.write(list.filter(e => !doomed.includes(e)));
    if (kind !== 'music') removedFiles.push(...CUTS.dropOrphans(_originalsOf(doomed)));
    if (own) LC.remove(kind, id);
    // Their folders off the disk, the deepest first - each only once nothing is left in it.
    for (const p of paths.sort((a, b) => b.length - a.length)) SHELF.dropEmptyFolder(kind, p);
    res.json({ success: true, id, kind, mode, affected: doomed.length, folders: ids.length - 1, removedFiles, sparedFiles: r.kept,
      disposition: own ? 'removed' : 'orphan' });
  } catch (e) { res.status(e.status || 400).json({ success: false, error: e.message }); }
});

// ── WHERE A FILE IS USED (phase V28.4, the owner 2026-10-12) ───────────────────
// Asked before something is deleted from the library: the projects (the draft too) whose timelines hold it, and how
// many clips in each - the deleting question names them, and there the clips turn red (lib/timeline-media.js).
//   POST /api/library/usage { media: [address, ...] }       some files
//   POST /api/library/usage { kind, cat }                   everything in a category ('__uncat__': in none) - and (phase V54)
//                                                           in every folder under it
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
      const under = cat && cat !== UNCAT && LC.KINDS.includes(kind) ? new Set(_subtree(kind, cat)) : new Set([cat]);
      for (const e of store.read()) {
        if (!e || !inKind(e)) continue;
        const c = String(e.categoryId || '');
        if (cat === UNCAT ? (c && c !== UPLOADS_CAT) : !under.has(c)) continue;
        for (const p of (store.files ? store.files(e) : [])) if (p) media.push(String(p));
      }
    }
    // (phase V78, (лч14)) And the projects whose THIS PROJECT holds them - a link goes with its file.
    res.json({ success: true, projects: require('../lib/timeline-media').usage(media), linked: PLINKS.usage(media) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Counts for every shelf of the Library page at once, for the switcher — cheap enough to do on load and
// it means the page never shows a shelf without saying how much is in it. (Environments and looks are
// shelves only other pages read; no number of theirs is shown.)
const COUNTED = ['characters', 'media', 'voices', 'renders', 'scenarios'];
router.get('/library/counts', (_req, res) => {
  try {
    const out = {};
    for (const kind of COUNTED) {
      const build = SHELVES[kind];
      // (phase V28.4) Media counts its music too - the Music shelf is Audio -> Music there now.
      try { out[kind] = (kind === 'media' ? _mediaShelf({ music: true, heads: true, refs: true }) : build()).items.length; } catch (e) { out[kind] = 0; }
    }
    res.json({ success: true, counts: out });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// (phase V27) The filing of a clip brought in, for one that came by a link (lib/link-queue.js).
router.fileRecord = _fileRecord;

module.exports = router;
