'use strict';

// ════════════════════════════════════════════════════════════════════════════
// MERGE — asking for a clip, and reading the strip of what was asked for.
//
//   POST   /api/mv3/vid/gen           { project, engine, provider, prompt, said, refs[],
//                                       params, videoIn, videoOut } -> the RECORD
//   GET    /api/mv3/vid/feed?project= that project's clips, newest first
//   DELETE /api/mv3/vid/item/:id      off the strip; the library keeps the clip
//
// The matrix is NOT here: /api/video/engines?dir=i2v already answers it, and it is the same
// table this route submits against. A second door onto one table is a second thing to keep
// in step with it.
//
// The reply to a submit is the record rather than the clip, for the same reason the picture
// route answers that way: the clip is minutes off and the strip has something to draw in the
// meantime. The window then polls the feed - which is also what a second tab reads, and what
// the page finds waiting after a reload.
// ════════════════════════════════════════════════════════════════════════════

const express = require('express');
const router = express.Router();

const VG = require('../lib/mv3-vgens');

router.post('/mv3/vid/gen', async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.engine) return res.status(400).json({ success: false, error: 'an engine is needed' });
    const refs = (Array.isArray(b.refs) ? b.refs : []).filter(Boolean);
    if (!refs.length) return res.status(400).json({ success: false, error: 'a picture is needed' });
    const item = await VG.start({
      project: b.project, engine: b.engine, provider: b.provider,
      prompt: b.prompt, said: b.said, aspect: b.aspect,
      refs, params: b.params, videoIn: b.videoIn, videoOut: b.videoOut,
    });
    // A record that came back already failed is still a 200: it exists, the strip will draw it
    // wearing its reason, and the window has one shape of answer to read rather than two.
    res.json({ success: true, item });
  } catch (e) {
    res.status(502).json({ success: false, error: e.message });
  }
});

router.get('/mv3/vid/feed', (req, res) => {
  try {
    res.json({ success: true, items: VG.list(String(req.query.project || '')) });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.delete('/mv3/vid/item/:id', (req, res) => {
  try {
    const ok = VG.remove(String(req.params.id || ''));
    if (!ok) return res.status(404).json({ success: false, error: 'no such clip' });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
