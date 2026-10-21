'use strict';

// ════════════════════════════════════════════════════════════════════════════
// REFERENCES (phase TG, the owner 2026-10-21) - what the owner sends their Telegram bot: posts, links and media, kept for
// use as references. ONE RECORD IS ONE POST ("одна плитка один пост"): a carousel of five pictures and two videos is one
// record with seven files.
//
//   data/references.json   [ post ]   (Export: the group "References", with media/references/)
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
    const p = { id: newId(), cat: '', from: 'telegram', receivedAt: new Date().toISOString(), ...post };
    list.unshift(p);
    return p;
  });
}

module.exports = { FILE, SOURCES, read, apply, add, byLinkKey, dirOf, labelOf, newId };
