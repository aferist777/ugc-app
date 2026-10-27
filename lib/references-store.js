'use strict';

// ════════════════════════════════════════════════════════════════════════════
// REFERENCES (phase TG, the owner 2026-10-21) - what the owner sends their Telegram bot: posts, links and media, kept for
// use as references. ONE RECORD IS ONE POST ("одна плитка один пост"): a carousel of five pictures and two videos is one
// record with seven files.
//
//   data/references.json   [ post ]
//   post: { id, source, folder, cat, title, author, link, linkKey, caption, note, origin, postedAt, receivedAt,
//           media: [{ id, type: 'video'|'photo', path, thumb, w, h, dur, size }],
//           remote: null | { site, id, url, title, dur, w, h }   - a long video kept as a tile, not downloaded
//           poster, from: 'telegram' }
//
// WHERE: media/references/<source>/<folder>/ - the owner's tree (answer (в)): Files; Instagram -> Posts, Reels; YouTube
// -> Shorts, Videos; TikTok -> Posts, Videos; Other. The folders are the app's (locked in the tree, block 5); the owner's
// own categories come in block 5 too (`cat`).
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR, MEDIA } = require('./config');
const { writeFileAtomic } = require('./atomic-write');

const FILE = path.join(DATA_DIR, 'references.json');

// The sources and their folders, in the tree's order.
const SOURCES = [
  { id: 'files', label: 'Files', folders: [] },
  { id: 'instagram', label: 'Instagram', folders: [{ id: 'posts', label: 'Posts' }, { id: 'reels', label: 'Reels' }] },
  { id: 'youtube', label: 'YouTube', folders: [{ id: 'shorts', label: 'Shorts' }, { id: 'videos', label: 'Videos' }] },
  { id: 'tiktok', label: 'TikTok', folders: [{ id: 'posts', label: 'Posts' }, { id: 'videos', label: 'Videos' }] },
  { id: 'other', label: 'Other', folders: [] },
];

function read() {
  try { const d = JSON.parse(fs.readFileSync(FILE, 'utf8')); return Array.isArray(d) ? d : []; }
  catch (e) { return []; }
}

// Read, change, write in one tick: `fn` is synchronous.
function apply(fn) {
  const list = read();
  const out = fn(list);
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  writeFileAtomic(FILE, JSON.stringify(list, null, 2));
  return out;
}

const newId = () => 'ref_' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');

/** Where a source's folder lives on the disk (made when missing). */
function dirOf(source, folder) {
  const d = folder ? path.join(MEDIA.references, source, folder) : path.join(MEDIA.references, source);
  fs.mkdirSync(path.join(d, 'thumbs'), { recursive: true });
  return d;
}

const labelOf = (source, folder) => {
  const s = SOURCES.find(x => x.id === source);
  if (!s) return source;
  const f = s.folders.find(x => x.id === folder);
  return s.label + (f ? ' · ' + f.label : '');
};

/** A post already here under the same link (any spelling of it: the site and its id). */
function byLinkKey(key) {
  if (!key) return null;
  return read().find(p => p && p.linkKey === key) || null;
}

function add(post) {
  return apply((list) => {
    const p = { id: newId(), categoryId: '', categoryLabel: '', from: 'telegram', receivedAt: new Date().toISOString(), ...post };
    list.unshift(p);
    return p;
  });
}

// ── where a post's files belong (block 5b) ───────────────────────────────────
// An own category (lib/library-cats.js, kind 'references') is a folder of its own, media/references/<folder>/; a post with
// none is in its source's folder. A post filed or let go of moves its files there - each with what is derived from it,
// and every store rewritten (lib/relocate.js): the poster of a tile-only video, which is no sibling of a file, explicitly.
function folderUrlOf(p) {
  if (p.categoryId) return require('./shelf-files').categoryDir('references', p.categoryId, p.categoryLabel).url;
  dirOf(p.source || 'other', p.folder || '');
  return '/media/references/' + (p.source || 'other') + '/' + (p.folder ? p.folder + '/' : '');
}

function placePosts(posts) {
  const pairs = [];
  const taken = new Set();
  const free = (dirUrl, name) => {
    const { toDisk } = require('./media');
    const stem = name.replace(/\.[^.]+$/, '');
    const ext = name.slice(stem.length);
    for (let n = 1; ; n++) {
      const cand = dirUrl + (n === 1 ? name : `${stem} (${n})${ext}`);
      const abs = toDisk(cand);
      if (!taken.has(cand.toLowerCase()) && abs && !fs.existsSync(abs)) { taken.add(cand.toLowerCase()); return cand; }
    }
  };
  // Directly in that folder (or its thumbs/), not anywhere under it: an own folder's own folders are under it (V54).
  const inside = (u, d) => { const at = path.posix.dirname(String(u || '')) + '/'; return at === d || at === d + 'thumbs/'; };
  for (const p of posts || []) {
    if (!p) continue;
    const dir = folderUrlOf(p);
    const sibs = new Set();
    for (const m of p.media || []) {
      if (!m.path || inside(m.path, dir)) continue;
      const base = path.posix.basename(m.path);
      pairs.push([m.path, free(dir, base)]);
      const stem = base.replace(/\.[^.]+$/, '');
      const from = path.posix.dirname(m.path);
      sibs.add(`${from}/thumbs/${stem}.jpg`); sibs.add(`${from}/thumbs/${stem}_thumb.jpg`);
    }
    if (p.poster && !sibs.has(p.poster) && !inside(p.poster, dir)) {
      fs.mkdirSync(path.join(require('./media').toDisk(dir), 'thumbs'), { recursive: true });
      pairs.push([p.poster, free(dir + 'thumbs/', path.posix.basename(p.poster))]);
    }
  }
  if (!pairs.length) return [];
  return require('./relocate').relocate({ files: pairs }).pairs;
}

// (phase TG, after block 8) A video kept as a tile (`remote`) whose video is now a downloaded source (lib/sources-store.js
// update): the tile goes, its poster with it - the source's tile is in its place, REFERENCES -> YouTube -> Videos.
function dropRemote(key) {
  if (!key) return 0;
  const gone = apply((list) => {
    const out = list.filter(p => p && p.remote && p.linkKey === key);
    if (out.length) for (const p of out) list.splice(list.indexOf(p), 1);
    return out;
  }) || [];
  for (const p of gone) {
    const abs = p.poster ? require('./media').toDiskWithin(p.poster, [MEDIA.references]) : null;
    if (abs) { try { fs.rmSync(abs, { force: true }); } catch (e) { /* held */ } }
  }
  return gone.length;
}

module.exports = { FILE, SOURCES, read, apply, add, byLinkKey, dirOf, labelOf, newId, folderUrlOf, placePosts, dropRemote };
