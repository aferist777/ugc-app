'use strict';

// ════════════════════════════════════════════════════════════════════════════
// AUDIO IN THE LAB (phase V34.C-D, the owner 2026-10-22) - what the lab page's tree and gallery read (V34.E moves them into
// Merge's Library panel and the Library's Media shelf):
//
//   AUDIO -> Music                    the tracks (lib/music-store.js)
//            SFX -> Favorites         every starred sound - built-in (lib/sfx-favorites.js) and own (`favorite` on its record)
//                   Built-in (lock)   the program's set (lib/sfx-builtin.js, vendor/sfx/ at /sfx/) by its categories
//                   My sounds         the person's own (lib/sounds-store.js) by their categories - Generated (lock) first
//
//   GET  /api/audio/lib/tree                       the nodes, with counts
//   GET  /api/audio/lib/items?node=&q=             the tiles of a node; `q` - words in the name or the tags, SFX only
//   POST /api/audio/lib/fav { kind, id, path, on } the ★ - a built-in sound's in the favourites list, an own one's on its record
//   POST /api/audio/cut { src, in, out, cat }      a piece of any sound as a NEW sound in My sounds (lib/audio-cut.js)
//   GET  /api/audio/online?q=&page=                Openverse, CC0 only (lib/openverse.js)
//   POST /api/audio/online/add { id, cat, label }  a found sound into My sounds
//
// Everything else an own sound needs is the Library's already: a file brought in (POST /api/sounds/upload with its
// categoryId; a track - POST /api/audio/music/upload), renamed, starred, given another category, deleted
// (/api/library/item/sounds/:id), the categories made, renamed, deleted (/api/library/cats).
// ════════════════════════════════════════════════════════════════════════════

const express = require('express');
const fs = require('fs');
const LC = require('../lib/library-cats');
const SND = require('../lib/sounds-store');
const MUSIC = require('../lib/music-store');
const SFX = require('../lib/sfx-builtin');
const FAV = require('../lib/sfx-favorites');
const WAVE = require('../lib/audio-wave');
const { toDiskExisting } = require('../lib/media');

const router = express.Router();
const UNCAT = LC.UNCAT;
const _abc = (a, b) => String(a || '').localeCompare(String(b || ''), 'en', { numeric: true, sensitivity: 'base' });
const _on = (p) => { const abs = toDiskExisting(p); return !!(abs && fs.existsSync(abs)); };

// Every tile, in one shape: { kind: builtin | sounds | music, id, name, path, dur, wave, fav, tags, categoryId,
// categoryLabel, source, info, original, date }.
function _builtin() {
  const favs = new Set(FAV.list().map(f => f.path));
  return SFX.read().sounds.map(s => ({
    kind: 'builtin', id: s.id, name: s.name, path: s.path, dur: s.dur, wave: s.wave, fav: favs.has(s.path), tags: s.tags,
    categoryId: s.category, categoryLabel: s.categoryLabel, source: 'built-in', locked: true,
    info: { author: s.author, authorUrl: s.authorUrl, license: s.license, licenseUrl: s.licenseUrl, from: s.source, url: s.url },
    date: null,
  }));
}
function _mine() {
  return SND.read().filter(e => e && e.audioPath && _on(e.audioPath)).map(e => {
    const m = e.meta || {};
    const o = m.online || null;
    return {
      kind: 'sounds', id: String(e.id), name: String(e.name || 'sound'), path: e.audioPath, dur: +e.duration || 0,
      wave: Array.isArray(e.wave) ? e.wave : [], fav: !!e.favorite,
      tags: (Array.isArray(m.tags) ? m.tags : []).map(String),
      categoryId: String(e.categoryId || ''), categoryLabel: String(e.categoryLabel || ''), source: String(e.source || 'upload'),
      info: o ? { author: o.creator, authorUrl: o.creatorUrl, license: (o.license || '').toUpperCase() + (o.licenseVersion ? ' ' + o.licenseVersion : ''),
        licenseUrl: o.licenseUrl, from: (o.source === 'freesound' ? 'Freesound' : o.source === 'wikimedia' ? 'Wikimedia Commons' : o.source) + ' via Openverse',
        url: o.landing, attribution: o.attribution, preview: !!o.preview }
        : (m.prompt ? { prompt: m.prompt, engine: m.engine, mode: m.mode } : null),
      original: m.original || null,
      date: e.date || null,
    };
  });
}
function _music() {
  return MUSIC.read().filter(t => t && t.audioPath && _on(t.audioPath)).map(t => ({
    kind: 'music', id: String(t.id || t.audioPath), name: String(t.title || 'track'), path: String(t.audioPath), dur: +t.duration || 0,
    wave: Array.isArray(t.wave) ? t.wave : [], fav: !!t.favorite, tags: [], categoryId: '', categoryLabel: '',
    source: String(t.source || 'suno'), info: { style: String(t.style || ''), lyrics: t.lyrics ? String(t.lyrics) : '' },
    date: t.createdAt || null,
  }));
}

router.get('/audio/lib/tree', (_req, res) => {
  try {
    const built = SFX.read();
    const mine = _mine();
    const music = _music();
    const favs = _builtin().filter(i => i.fav).length + mine.filter(i => i.fav).length;
    // My sounds: the locked first (Generated), those with something in them A-Z, Uncategorized, the empty ones.
    const counts = {};
    let uncat = 0;
    for (const i of mine) { if (i.categoryId) counts[i.categoryId] = (counts[i.categoryId] || 0) + 1; else uncat++; }
    const cats = LC.listFor('sounds', counts, (id) => (mine.find(i => i.categoryId === id) || {}).categoryLabel || '');
    const one = (c) => ({ key: 'mine:' + c.id, cat: c.id, label: c.title || c.label, name: c.label, count: c.count, locked: !!c.locked,
      own: !!c.own, empty: !(c.count > 0) });
    const by = (a, b) => _abc(a.title || a.label, b.title || b.label);
    const children = [
      ...cats.filter(c => c.locked).sort(by).map(one),
      ...cats.filter(c => !c.locked && c.count > 0).sort(by).map(one),
    ];
    const unc = { key: 'mine:' + UNCAT, cat: UNCAT, label: 'Uncategorized', count: uncat, uncat: true, empty: !uncat };
    if (uncat) children.push(unc);
    children.push(...cats.filter(c => !c.locked && !(c.count > 0)).sort(by).map(one));
    if (!uncat) children.push(unc);
    const nodes = [
      { key: 'music', label: 'Music', count: music.length },
      { key: 'sfx', label: 'SFX', count: built.sounds.length + mine.length, children: [
        { key: 'fav', label: 'Favorites', count: favs, fav: true },
        { key: 'builtin', label: 'Built-in', locked: true, count: built.sounds.length, version: built.version,
          children: built.categories.map(c => ({ key: 'builtin:' + c.id, label: c.label, count: c.count, locked: true, empty: !c.count })) },
        { key: 'mine', label: 'My sounds', kind: 'sounds', count: mine.length, children },
      ] },
    ];
    res.json({ success: true, nodes });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// The words of a search: every one must be in the name, the tags or the category.
function _match(i, q) {
  const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = [i.name, i.categoryLabel, ...(i.tags || [])].join(' ').toLowerCase();
  return words.every(w => hay.includes(w));
}

router.get('/audio/lib/items', (req, res) => {
  try {
    const node = String(req.query.node || 'sfx');
    const q = String(req.query.q || '').slice(0, 100);
    let items;
    if (node === 'music') items = _music();
    else {
      const built = _builtin();
      const mine = _mine();
      if (node === 'fav') items = mine.filter(i => i.fav).concat(built.filter(i => i.fav));
      else if (node === 'builtin') items = built;
      else if (node.startsWith('builtin:')) items = built.filter(i => i.categoryId === node.slice(8));
      else if (node === 'mine') items = mine;
      else if (node.startsWith('mine:')) {
        const cat = node.slice(5);
        items = mine.filter(i => (cat === UNCAT ? !i.categoryId : i.categoryId === cat));
      } else items = mine.concat(built);          // SFX: everything
      items = items.filter(i => _match(i, q));
    }
    // Own ones newest first, the set in its own order; a star first in any node.
    items.sort((a, b) => (Number(b.fav) - Number(a.fav)) || (Number(a.kind === 'builtin') - Number(b.kind === 'builtin'))
      || (a.kind === 'builtin' ? 0 : String(b.date || '').localeCompare(String(a.date || ''))));
    // The tiles still with no waveform are measured behind this answer.
    if (items.some(i => i.kind !== 'builtin' && !(i.wave && i.wave.length))) WAVE.fill();
    res.json({ success: true, items: items.slice(0, 1000), total: items.length });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/audio/lib/fav', (req, res) => {
  try {
    const b = req.body || {};
    const on = !!b.on;
    if (b.kind === 'builtin') {
      if (!SFX.byPath(b.path)) return res.status(404).json({ success: false, error: 'no such built-in sound' });
      FAV.set(b.path, on);
      return res.json({ success: true, on });
    }
    const store = b.kind === 'music' ? MUSIC : b.kind === 'sounds' ? SND : null;
    if (!store) return res.status(400).json({ success: false, error: 'a sound or a track' });
    // ── one tick ──
    const l = store.read();
    const r = l.find(x => x && String(x.id) === String(b.id || ''));
    if (!r) return res.status(404).json({ success: false, error: 'not found' });
    r.favorite = on;
    store.write(l);
    res.json({ success: true, on });
  } catch (e) { res.status(e.status || 500).json({ success: false, error: e.message }); }
});

router.post('/audio/cut', async (req, res) => {
  const b = req.body || {};
  try {
    const item = await require('../lib/audio-cut').cut(String(b.src || ''), +b.in, +b.out, { cat: String(b.cat || '') });
    res.json({ success: true, item });
  } catch (e) { res.status(e.status || 500).json({ success: false, error: e.message }); }
});

router.get('/audio/online', async (req, res) => {
  try { res.json({ success: true, ...(await require('../lib/openverse').search(req.query.q, req.query.page)) }); }
  catch (e) { res.status(e.status || 500).json({ success: false, error: e.message }); }
});

router.post('/audio/online/add', async (req, res) => {
  const b = req.body || {};
  try {
    const r = await require('../lib/openverse').add(String(b.id || ''), { cat: String(b.cat || ''), label: String(b.label || '') });
    res.json({ success: true, item: r.item, added: r.added });
  } catch (e) { res.status(e.status || 500).json({ success: false, error: e.message }); }
});

module.exports = router;
