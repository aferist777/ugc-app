'use strict';

// ════════════════════════════════════════════════════════════════════════════
// A SOUND BECOMES A TRACK, A TRACK A SOUND. Any sound of SFX -> My sounds or of AUDIO's root
// goes into Music (its root, its own folders, highlights - a mood only the track its preset made), any track into My sounds
// or AUDIO's root: the record leaves one store for the other - data/sounds.json <-> data/suno-lib.json - keeping its id,
// name, file, length, star and waveform. What the other store has no field for rides along in `carried` ({ kind, rec }) and
// comes back when it returns, so a trip loses nothing (a Suno track's style, lyrics and the preset that made it; a sound
// found online - its author and licence; a piece - what it was cut from).
//
// The destination is written FIRST, then the source: a failure between them lists it twice, never loses it (the rule of
// routes/library.js _kindOne). It arrives as the newest thing there (its date now - the earlier one kept in `carried`).
// The FILE does not move here: the caller places it by its new kind and folder (lib/shelf-files.js placeRecords ->
// lib/relocate.js - every store and project file follows, a timeline's clip included) - at once, or with the rest of a batch.
//
//   swap(from, id, place) -> the new record      from 'sounds' | 'music'; `place` - where it lies in the other store:
//        into Music   { categoryId, categoryLabel } | { folder: 'highlights' | '', mood }   (the caller checked the mood)
//        into sounds  { categoryId, categoryLabel, inAudio }
//   carriedOf(rec) -> { kind, rec } - what it was in the other store - or null
// ════════════════════════════════════════════════════════════════════════════

const SND = require('./sounds-store');
const MUSIC = require('./music-store');
const I18N = require('./i18n');

// Where a record lies - never carried back: the move says where it goes.
const PLACE = ['categoryId', 'categoryLabel', 'folder', 'mood', 'inAudio'];
const _omit = (o, keys) => { const r = {}; for (const k of Object.keys(o || {})) if (!keys.includes(k)) r[k] = o[k]; return r; };
const _store = (k) => (k === 'music' ? MUSIC : k === 'sounds' ? SND : null);
const _no = (msg, status) => Object.assign(new Error(msg), { status: status || 409 });

function carriedOf(rec) {
  const c = rec && rec.carried;
  return c && (c.kind === 'music' || c.kind === 'sounds') && c.rec && typeof c.rec === 'object' ? c : null;
}

function swap(from, id, place) {
  const to = from === 'music' ? 'sounds' : from === 'sounds' ? 'music' : '';
  if (!to) throw _no(I18N.t('only a sound or a track goes between Music and SFX'), 400);
  const src = _store(from);
  const dst = _store(to);
  const p = place || {};
  // ── Read, change, write: one tick. ──
  const list = src.read();
  const it = list.find(x => x && String(x.id) === String(id || ''));
  if (!it) throw _no(I18N.t('not found'), 404);
  const there = dst.read();
  if (there.some(x => x && String(x.id) === String(it.id))) throw _no(to === 'music' ? I18N.t('it is in Music already') : I18N.t('it is in SFX already'));
  const back = carriedOf(it);
  const rec = back && back.kind === to ? _omit(back.rec, PLACE.concat(['carried'])) : {};
  const now = new Date().toISOString();
  Object.assign(rec, { id: it.id, audioPath: it.audioPath, duration: +it.duration || 0, favorite: !!it.favorite });
  if (Array.isArray(it.wave) && it.wave.length) rec.wave = it.wave;
  if (to === 'music') {
    rec.title = String(it.name || '').trim() || String(rec.title || I18N.t('track'));
    rec.createdAt = now;
    if (typeof rec.style !== 'string') rec.style = '';
    if (!rec.source) rec.source = it.source || 'upload';
    // A piece names what it was cut from - a sound keeps it in its `meta`, a track on itself.
    if (!rec.original && it.meta && it.meta.original) rec.original = it.meta.original;
    if (p.categoryId) { rec.categoryId = String(p.categoryId); rec.categoryLabel = String(p.categoryLabel || ''); }
    else {
      if (p.folder === MUSIC.HIGHLIGHTS) rec.folder = MUSIC.HIGHLIGHTS;
      if (p.folder === MUSIC.HIGHLIGHTS && p.mood) rec.mood = String(p.mood);
    }
  } else {
    rec.name = String(it.title || '').trim() || String(rec.name || I18N.t('sound'));
    rec.date = now;
    if (!rec.source) rec.source = it.source || 'upload';
    if (it.original && !(rec.meta && rec.meta.original)) rec.meta = Object.assign({}, rec.meta || {}, { original: it.original });
    rec.categoryId = String(p.categoryId || '');
    rec.categoryLabel = rec.categoryId ? String(p.categoryLabel || '') : '';
    if (p.inAudio && !rec.categoryId) rec.inAudio = true;
  }
  rec.carried = { kind: from, rec: _omit(it, PLACE.concat(['carried'])) };
  there.unshift(rec);
  dst.write(there);
  src.write(list.filter(x => x !== it));
  return rec;
}

module.exports = { swap, carriedOf };
