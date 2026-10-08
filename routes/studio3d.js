'use strict';

/* studio3d.js - the 3D Studio's scenes over HTTP (docs/local-app/PLAN.md "3D Studio - план по этапам", 3D1).

     GET    /api/3d/scenes               the gallery: every scene, the newest change first
     POST   /api/3d/scenes   {name}      a new scene
     GET    /api/3d/scenes/:id           one scene
     PUT    /api/3d/scenes/:id {scene, rev}   save; 409 with the scene as it is now when rev is not the current one
     PATCH  /api/3d/scenes/:id {name}    rename (its folder follows)
     POST   /api/3d/scenes/:id/copy {name}    a copy
     DELETE /api/3d/scenes/:id           delete (what something else uses moves to media/work)
     POST   /api/3d/scenes/:id/thumb     image/jpeg - the gallery's picture of it */

const express = require('express');
const STORE = require('../lib/studio3d-store');

const router = express.Router();

const nope = (res) => res.status(404).json({ success: false, error: 'There is no such scene - it may have been deleted.' });

router.get('/3d/scenes', (_req, res) => {
  res.json({ success: true, scenes: STORE.list() });
});

router.post('/3d/scenes', (req, res) => {
  try {
    res.json({ success: true, scene: STORE.create((req.body || {}).name) });
  } catch (e) {
    console.error('[3d] create:', e.message);
    res.status(500).json({ success: false, error: 'The scene could not be made: ' + e.message });
  }
});

router.get('/3d/scenes/:id', (req, res) => {
  const scene = STORE.get(req.params.id);
  if (!scene) return nope(res);
  res.json({ success: true, scene });
});

router.put('/3d/scenes/:id', (req, res) => {
  const b = req.body || {};
  if (!b.scene || typeof b.scene !== 'object') return res.status(400).json({ success: false, error: 'No scene in the request.' });
  const r = STORE.save(req.params.id, b.scene, b.rev);
  if (!r) return nope(res);
  if (r.conflict) return res.status(409).json({ success: false, error: 'The scene was saved from somewhere else meanwhile.', scene: r.conflict });
  res.json({ success: true, scene: r.scene });
});

router.patch('/3d/scenes/:id', (req, res) => {
  const name = String((req.body || {}).name || '').trim();
  if (!name) return res.status(400).json({ success: false, error: 'A scene needs a name.' });
  try {
    const scene = STORE.rename(req.params.id, name);
    if (!scene) return nope(res);
    res.json({ success: true, scene });
  } catch (e) {
    console.error('[3d] rename:', e.message);
    res.status(500).json({ success: false, error: 'The scene could not be renamed: ' + e.message });
  }
});

router.post('/3d/scenes/:id/copy', (req, res) => {
  try {
    const scene = STORE.copy(req.params.id, (req.body || {}).name);
    if (!scene) return nope(res);
    res.json({ success: true, scene });
  } catch (e) {
    console.error('[3d] copy:', e.message);
    res.status(500).json({ success: false, error: 'The scene could not be copied: ' + e.message });
  }
});

router.delete('/3d/scenes/:id', (req, res) => {
  try {
    const r = STORE.remove(req.params.id);
    if (!r) return nope(res);
    res.json({ success: true, moved: r.moved || 0 });
  } catch (e) {
    console.error('[3d] delete:', e.message);
    res.status(500).json({ success: false, error: 'The scene could not be deleted: ' + e.message });
  }
});

// An environment of the Library as a blockout (lib/studio3d-env.js): its description - written by the agent and
// kept in the Library when it had none - and its room, openings, large furniture and camera. Kept with the
// environment, so asking again is free; `force` asks the agent anew. Paid only when not kept: cents.
router.post('/3d/env', async (req, res) => {
  const b = req.body || {};
  const url = String(b.path || '').trim();
  if (!url) return res.status(400).json({ success: false, error: 'Which environment?' });
  try {
    const r = await require('../lib/studio3d-env').layout(url, { force: !!b.force });
    res.json(Object.assign({ success: true }, r));
  } catch (e) {
    console.warn('[3d env]', url.split('/').pop(), e.message);
    res.status(e.status || 502).json({ success: false, error: e.message });
  }
});

router.post('/3d/scenes/:id/thumb', express.raw({ type: 'image/jpeg', limit: '4mb' }), (req, res) => {
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || buf.length < 100 || buf[0] !== 0xff || buf[1] !== 0xd8) {
    return res.status(400).json({ success: false, error: 'Not a JPEG.' });
  }
  const url = STORE.thumb(req.params.id, buf);
  if (!url) return nope(res);
  res.json({ success: true, thumb: url });
});

module.exports = router;
