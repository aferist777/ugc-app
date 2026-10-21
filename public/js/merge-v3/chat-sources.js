/* ════════════════════════════════════════════════════════════════════════════
   MERGE — where a chat's picker takes pictures from (phase V13 in the video chat; shared since phase V26.5 with the
   frames chat). Each loader answers { items, cats?, why? } - an item is { path, name, sub, cat, thumb, big, aspect }.
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

/** A media shelf with its categories: Images, B-roll, Uploads, Sounds - read whole, its categories chosen in the window. */
export async function mediaShelf(filter, map) {
  const d = await json('/api/library/shelf/media?filter=' + filter);
  if (!d || !d.success) return gone(d);
  const cats = (d.cats || []).filter(c => c && c.id);
  const nameOf = new Map(cats.map(c => [c.id, c.name || '']));
  return { cats, items: (d.items || []).filter(i => i && i.media).map(i => {
    const m = i.meta || {};
    return Object.assign(map(i, m), { cat: m.categoryId || '', sub: nameOf.get(m.categoryId || '__uncat__') || '' });
  }) };
}

// (phase TG, block 5d) REFERENCES' pictures come as one more category of Images (`refs=1`).
export const images = () => mediaShelf('images&refs=1', (i, m) => pic(i.media, i.name, '', { aspect: shape(m.w, m.h) }));

/** Where a picture is on the shelves, by its folder - the picker opens there, on it. */
export function pictureSourceOf(path) {
  const at = (dir) => String(path || '').startsWith('/media/' + dir + '/');
  return at('characters') || at('looks') ? ['people'] : at('locations') ? ['environments'] : at('lookbooks') ? ['lookbooks']
    : at('images') || at('references') ? ['images'] : [];
}
