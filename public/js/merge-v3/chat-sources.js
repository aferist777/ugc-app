/* ════════════════════════════════════════════════════════════════════════════
   MERGE — where a chat's picker takes pictures from (the video chat, the frames chat and the pictures chat). Each loader
   answers { items, cats?, why? } - an item is { path, name, sub, cat, thumb, big, aspect }. The shelves of folders are the
   window's tree (TREE below); the loaders here are its rows - what is not a folder.
   ════════════════════════════════════════════════════════════════════════════ */

import { thumbOf, json } from './chat-shell.js';

// A shelf that could not be read: `failed` - the attachment window says "did not load" with Try again.
export const gone = (d) => ({ items: [], cats: [], why: (d && d.error) || 'the shelf could not be read', failed: true });
export const shape = (w, h) => (w > 0 && h > 0 ? w + ':' + h : '');
export const pic = (path, name, sub, x) => Object.assign({ path, name: name || '', sub: sub || '',
  thumb: thumbOf(path, 'strip'), big: thumbOf(path, 'main') }, x || {});

/** A character's sheet, then its looks, one character after another (`items`) - and the same
 *  as GROUPS, one per character, the ones with the most looks first: the attachment window shows them in place of
 *  its tree (chat-pick.js). Looks of no character are a group of their own, last. */
export async function people() {
  const [c, l] = await Promise.all([json('/api/library/shelf/characters'), json('/api/library/shelf/looks')]);
  if (!c || !c.success) return gone(c);
  const chars = c.items || [];
  const looks = (l && l.success) ? l.items || [] : [];
  const nLooks = (n) => (n === 1 ? '1 look' : n + ' looks');
  const groups = chars.map((ch) => {
    const mine = looks.filter(x => (x.meta || {}).charId === ch.id);
    const items = [pic(ch.media, ch.name, 'character', { aspect: '16:9' })]
      .concat(mine.map(lk => pic(lk.media, lk.name, ch.name + ' · look'))).filter(x => x.path);
    return { key: 'c:' + ch.id, label: ch.name || 'character', n: mine.length, sub: nLooks(mine.length), items };
  }).filter(g => g.items.length);
  // The most looks first; one count keeps the shelf's order.
  groups.sort((a, b) => b.n - a.n);
  const loose = looks.filter(x => !chars.some(ch => ch.id === (x.meta || {}).charId)).map(lk => pic(lk.media, lk.name, 'look')).filter(x => x.path);
  if (loose.length) groups.push({ key: 'loose', label: 'Looks of no character', n: loose.length, sub: nLooks(loose.length), items: loose });
  return { items: groups.flatMap(g => g.items), groups };
}

// ── The attachment window with the tree (chat-pick.js `tree`) ─────
// What of the media tree each kind shows (its top nodes), the key the tree remembers its branches under, the folder opened
// the first time, how a file of a folder (js/folder-column.js filesOf) becomes the window's item, and
// `home` - the root a file brought into a chat lies in: IMAGES, VIDEO -> Uploads, AUDIO -> SFX -> My sounds.
const _treeClip = (f) => ({ path: f.path, src: f.path, poster: f.thumb || '', name: f.name || '', thumb: f.thumb ? thumbOf(f.thumb, 'strip') : '',
  aspect: f.aspect || '', dur: +f.dur || 0 });
export const TREE = {
  // THIS PROJECT first - in Merge, the project's own folders of links.
  image: { roots: ['plinks', 'references', 'images'], page: 'pk_image', fallback: 'images', home: 'images', type: 'photo',
    map: (f) => pic(f.path, f.name, '', { aspect: f.aspect || '' }) },
  video: { roots: ['plinks', 'references', 'video'], page: 'pk_video', fallback: 'uploads', home: 'uploads', type: 'video', map: _treeClip },
  audio: { roots: ['plinks', 'audio'], page: 'pk_audio', fallback: 'sounds', home: 'sounds', type: 'audio',
    map: (f) => ({ path: f.path, src: f.path, name: f.name || '', dur: +f.dur || 0 }) },
};

/** The row of the characters and their looks - in every chat that attaches pictures. */
export const PEOPLE_ROW = { id: 'people', label: 'Characters & looks', load: people, empty: 'No characters yet - New Character makes one in the Library.' };

/** Where the window opens for a picture's slot by what it is for: a person on characters & looks, a place on IMAGES ->
 *  Environments, clothes on IMAGES -> Lookbooks (IMAGES when that folder holds no pictures), anything else on IMAGES. */
export function pictureStart(role) {
  if (role === 'person') return ['row:people'];
  if (role === 'location') return ['node:images/Environments', 'node:images'];
  if (role === 'outfit') return ['node:images/Lookbooks', 'node:images'];
  return ['node:images'];
}
