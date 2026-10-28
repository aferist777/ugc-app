/* ════════════════════════════════════════════════════════════════════════════
   MERGE — where a chat's picker takes pictures from (phase V13 in the video chat; shared since phase V26.5 with the
   frames chat, since V55 with the pictures chat). Each loader answers { items, cats?, why? } - an item is { path, name,
   sub, cat, thumb, big, aspect }. Since V55 the shelves of folders are the window's tree (TREE below); the loaders here
   are its rows - what is not a folder.
   ════════════════════════════════════════════════════════════════════════════ */

import { thumbOf, json } from './chat-shell.js';

export const gone = (d) => ({ items: [], cats: [], why: (d && d.error) || 'the shelf could not be read' });
export const shape = (w, h) => (w > 0 && h > 0 ? w + ':' + h : '');
export const pic = (path, name, sub, x) => Object.assign({ path, name: name || '', sub: sub || '',
  thumb: thumbOf(path, 'strip'), big: thumbOf(path, 'main') }, x || {});

/** A character's sheet, then its looks, one character after another. */
export async function people() {
  const [c, l] = await Promise.all([json('/api/library/shelf/characters'), json('/api/library/shelf/looks')]);
  if (!c || !c.success) return gone(c);
  const chars = c.items || [];
  const looks = (l && l.success) ? l.items || [] : [];
  const out = [];
  for (const ch of chars) {
    out.push(pic(ch.media, ch.name, 'character', { aspect: '16:9' }));
    for (const lk of looks.filter(x => (x.meta || {}).charId === ch.id)) out.push(pic(lk.media, lk.name, ch.name + ' · look'));
  }
  for (const lk of looks.filter(x => !chars.some(ch => ch.id === (x.meta || {}).charId))) out.push(pic(lk.media, lk.name, 'look'));
  return { items: out.filter(x => x.path) };
}

/** A shelf of one shape - environments, lookbooks. */
export async function flat(kind, aspect) {
  const d = await json('/api/library/shelf/' + kind);
  if (!d || !d.success) return gone(d);
  return { items: (d.items || []).filter(i => i && i.media).map(i => pic(i.media, i.name, '', { aspect })) };
}

/** Where a picture is on the shelves, by its folder - the picker opens there, on it (with the tree: the rows that may
 *  hold it; a picture of IMAGES or REFERENCES is found in the tree by the window itself). */
export function pictureSourceOf(path) {
  const at = (dir) => String(path || '').startsWith('/media/' + dir + '/');
  return at('characters') || at('looks') ? ['people'] : at('locations') ? ['environments'] : at('lookbooks') ? ['lookbooks']
    : at('images') || at('references') ? ['images'] : [];
}

// ── The attachment window with the tree (phase V55, chat-pick.js `tree`) ─────
// What of the media tree each kind shows (its top nodes), the key the tree remembers its branches under, the folder opened
// the first time, and how a file of a folder (js/folder-column.js filesOf) becomes the window's item.
const _treeClip = (f) => ({ path: f.path, src: f.path, poster: f.thumb || '', name: f.name || '', thumb: f.thumb ? thumbOf(f.thumb, 'strip') : '',
  aspect: f.aspect || '', dur: +f.dur || 0 });
export const TREE = {
  image: { roots: ['references', 'images'], page: 'pk_image', fallback: 'images', type: 'photo', map: (f) => pic(f.path, f.name, '', { aspect: f.aspect || '' }) },
  video: { roots: ['references', 'video'], page: 'pk_video', fallback: 'uploads', type: 'video', map: _treeClip },
  audio: { roots: ['audio'], page: 'pk_audio', fallback: 'sounds', type: 'audio', map: (f) => ({ path: f.path, src: f.path, name: f.name || '', dur: +f.dur || 0 }) },
};

// (phase V55) Environments and lookbooks become folders of IMAGES (sub-session Q, (гн8)); until the tree has them, they
// stay rows - a row says the path that makes it needless (`unless`).
export const ENV_ROW = { id: 'environments', label: 'environments', load: () => flat('environments', '3:2'), unless: 'images/Environments' };
export const LOOKBOOK_ROW = { id: 'lookbooks', label: 'lookbooks', load: () => flat('lookbooks', '1:1'), unless: 'images/Lookbooks' };

/** Where the window opens for a picture's slot by what it is for: a person on characters & looks, a place on Environments,
 *  clothes on Lookbooks (their rows while the tree has no such folder), anything else on IMAGES. */
export function pictureStart(role) {
  if (role === 'person') return ['row:people'];
  if (role === 'location') return ['node:images/Environments', 'row:environments', 'node:images'];
  if (role === 'outfit') return ['node:images/Lookbooks', 'row:lookbooks', 'node:images'];
  return ['node:images'];
}
