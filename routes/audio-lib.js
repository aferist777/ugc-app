'use strict';

// ════════════════════════════════════════════════════════════════════════════
// SOUND ON THE SHELVES - what Merge's Library panel and the Library's Media shelf ask beside the Library's own routes
// (the media tree is routes/library.js):
//
//   POST /api/audio/cut { src, in, out }           a piece of any sound as a NEW one (lib/audio-cut.js): of a track of
//                                                  Music - a track in Music's root, of anything else - a sound in My
//                                                  sounds' root; the answer says which (`where`)
//   GET  /api/audio/online?q=&page=                CC0 only: Freesound with the person's key (lib/freesound.js),
//                                                  Openverse when there is no key or Freesound did not answer
//                                                  (lib/openverse.js) - the answer says which (`via`) and why (`note`)
//   POST /api/audio/online/add { id, cat, label }  a found sound into My sounds - `fs-<n>` is Freesound's, the rest Openverse's
//   "Save audio" of a video:
//   GET  /api/audio/tracks?src=                    the video's sound tracks [{ k, label }] - none: it has no sound
//   POST /api/audio/from-video { src, track?, in?, out?, name? }
//                                                  one track, whole or [in, out), as a sound in AUDIO's own root
//                                                  (lib/audio-cut.js fromVideo) -> { item }
// ════════════════════════════════════════════════════════════════════════════

const express = require('express');
const I18N = require('../lib/i18n');

const router = express.Router();

router.post('/audio/cut', async (req, res) => {
  const b = req.body || {};
  try {
    const r = await require('../lib/audio-cut').cut(String(b.src || ''), +b.in, +b.out);
    res.json({ success: true, item: r.item, where: r.where });
  } catch (e) { res.status(e.status || 500).json({ success: false, error: e.message }); }
});

router.get('/audio/tracks', async (req, res) => {
  const abs = require('../lib/media').toDiskExisting(String(req.query.src || '').split('?')[0]);
  if (!abs) return res.status(400).json({ success: false, error: I18N.t('src - a video of the library') });
  try {
    const TR = require('../lib/audio-tracks');
    const tracks = await TR.tracksOf(abs);
    res.json({ success: true, tracks: tracks.map((t) => ({ k: t.k, label: TR.label(t), def: !!t.def })) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/audio/from-video', async (req, res) => {
  const b = req.body || {};
  try {
    const r = await require('../lib/audio-cut').fromVideo(String(b.src || ''), {
      track: b.track, in: b.in, out: b.out, name: String(b.name || '').slice(0, 120) });
    res.json({ success: true, item: r.item });
  } catch (e) { res.status(e.status || 500).json({ success: false, error: e.message }); }
});

router.get('/audio/online', async (req, res) => {
  const FS = require('../lib/freesound');
  let note = '';
  if (FS.has()) {
    try { return res.json({ success: true, via: 'freesound', ...(await FS.search(req.query.q, req.query.page)) }); }
    catch (e) {
      if (e.status === 400) return res.status(400).json({ success: false, error: e.message });
      note = e.message;
    }
  }
  try { res.json({ success: true, via: 'openverse', note, ...(await require('../lib/openverse').search(req.query.q, req.query.page)) }); }
  catch (e) { res.status(e.status || 500).json({ success: false, error: (note ? note + '; ' : '') + e.message }); }
});

router.post('/audio/online/add', async (req, res) => {
  const b = req.body || {};
  const id = String(b.id || '');
  try {
    const r = await require(/^fs-/.test(id) ? '../lib/freesound' : '../lib/openverse').add(id, { cat: String(b.cat || ''), label: String(b.label || '') });
    res.json({ success: true, item: r.item, added: r.added });
  } catch (e) { res.status(e.status || 500).json({ success: false, error: e.message }); }
});

module.exports = router;
