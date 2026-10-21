'use strict';

// ════════════════════════════════════════════════════════════════════════════
// REFERENCES (phase TG) - what the Telegram bot brought in (lib/references-store.js, lib/references-intake.js).
//
//   GET /api/references   -> { sources: [{ id, label, folders }], posts: [post] }   newest first
//
// The page (the media tree's REFERENCES branch, the post viewer, moving and trimming) is block 5.
// ════════════════════════════════════════════════════════════════════════════

const express = require('express');
const REFS = require('../lib/references-store');

const router = express.Router();

// GET /api/references/stamp -> { n, latest, latestId, title, where }
// What every page asks every few seconds (js/alerts-bell.js): a post landed while the app was open - a sound of its own,
// a toast, and the Library and Merge read their tree and gallery again (the owner 2026-10-21: "счетчик не обновился";
// "добавим новый звук при добавлении медиа через телеграм").
router.get('/references/stamp', (_req, res) => {
  try {
    const list = REFS.read();
    let top = null;
    for (const p of list) if (p && (!top || String(p.receivedAt || '') > String(top.receivedAt || ''))) top = p;
    res.json({ success: true, n: list.length, latest: top ? top.receivedAt || '' : '', latestId: top ? top.id : '',
      title: top ? top.title || '' : '', where: top ? REFS.labelOf(top.source, top.folder) : '' });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/references', (_req, res) => {
  try { res.json({ success: true, sources: REFS.SOURCES, posts: REFS.read() }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// POST /api/references/:id/move { files: [media ids] | 'all', to: { kind, cat, label } }
//   -> { moved, skipped: [{ id, why }], post: the post left (null when it went), made: a new post's id }
// (block 5b; the owner: "если пользователь переносит по одному медиа из поста то из референсов удаляется только тот
// который перенесли")
//   kind 'references'  the post - or the files chosen, as a NEW post with the same author, caption and link - filed under
//                      an own category (`cat`), or let go back to its source's folder ('')
//   birols | uploads | hooks   each VIDEO chosen becomes a clip of that kind and category (routes/library.js fileRecord)
//   images             each PICTURE chosen becomes a picture of that category (lib/images-store.js add)
// A file goes WITH its derivatives and every store follows (lib/relocate.js). What cannot go there (a picture into VIDEO)
// stays in the post and is said. A post left with nothing goes.
const VIDEO_KINDS = ['birols', 'uploads', 'hooks'];
router.post('/references/:id/move', async (req, res) => {
  try {
    const id = String(req.params.id);
    const b = req.body || {};
    const to = b.to || {};
    const kind = String(to.kind || '');
    const cat = String(to.cat || '');
    const label = String(to.label || '');
    const post = REFS.read().find(p => p && String(p.id) === id);
    if (!post) return res.status(404).json({ success: false, error: 'no such post' });
    const all = b.files === 'all';
    const want = all ? (post.media || []).map(m => m.id) : (Array.isArray(b.files) ? b.files.map(String) : []);
    const chosen = (post.media || []).filter(m => want.includes(String(m.id)));
    if (!chosen.length && !(all && post.remote && kind === 'references')) return res.status(400).json({ success: false, error: 'nothing chosen' });

    // ── within REFERENCES ──
    if (kind === 'references') {
      if (cat) {
        const LC = require('../lib/library-cats');
        if (!LC.find('references', cat)) return res.status(400).json({ success: false, error: 'no such category in REFERENCES' });
      }
      const whole = all || chosen.length === (post.media || []).length;
      let target = null;
      let made = '';
      REFS.apply((list) => {
        const p = list.find(x => x && String(x.id) === id);
        if (!p) return;
        if (whole) { p.categoryId = cat; p.categoryLabel = cat ? label : ''; target = p; return; }
        // A part: a new post of its own, the rest stays.
        const ids = new Set(chosen.map(m => String(m.id)));
        const np = { ...p, id: REFS.newId(), categoryId: cat, categoryLabel: cat ? label : '',
          media: p.media.filter(m => ids.has(String(m.id))), receivedAt: new Date().toISOString() };
        np.poster = (np.media[0] && np.media[0].thumb) || null;
        p.media = p.media.filter(m => !ids.has(String(m.id)));
        if (ids.has(String((p.media[0] || {}).id)) || !p.media.some(m => m.thumb === p.poster)) p.poster = (p.media[0] && p.media[0].thumb) || null;
        const at = list.indexOf(p);
        list.splice(at, 0, np);
        target = np;
        made = np.id;
      });
      if (target) REFS.placePosts([REFS.read().find(x => x && x.id === target.id)]);
      const left = REFS.read().find(x => x && x.id === id) || null;
      return res.json({ success: true, moved: whole ? (post.media || []).length : chosen.length, skipped: [], post: left, made });
    }

    // ── out of REFERENCES, into VIDEO or IMAGES ──
    if (!VIDEO_KINDS.includes(kind) && kind !== 'images') return res.status(400).json({ success: false, error: 'it goes to REFERENCES, VIDEO or IMAGES' });
    const fileRecord = require('./library').fileRecord;
    const IMG = require('../lib/images-store');
    const moved = [];
    const skipped = [];
    let n = 0;
    for (const m of chosen) {
      n++;
      const name = (post.title || 'post') + (chosen.length > 1 || (post.media || []).length > 1 ? ' · ' + n : '');
      try {
        if (m.type === 'video') {
          if (!VIDEO_KINDS.includes(kind)) { skipped.push({ id: m.id, why: 'a video does not go into IMAGES' }); continue; }
          fileRecord({ videoPath: m.path, thumbPath: m.thumb || null, name, kind, categoryLabel: kind === 'hooks' ? '' : label,
            trimmable: true, link: post.link || '' });
        } else {
          if (kind !== 'images') { skipped.push({ id: m.id, why: 'a picture does not go into VIDEO' }); continue; }
          await IMG.add(m.path, { categoryId: cat, categoryLabel: label, name, source: 'upload',
            meta: { from: 'references', link: post.link || '', author: post.author || '' } });
        }
        moved.push(String(m.id));
      } catch (e) { skipped.push({ id: m.id, why: e.message }); }
    }
    // The post lets go of what went; with nothing left, it goes - its poster too.
    let gonePoster = null;
    REFS.apply((list) => {
      const i = list.findIndex(x => x && String(x.id) === id);
      if (i < 0) return;
      const p = list[i];
      p.media = (p.media || []).filter(m => !moved.includes(String(m.id)));
      if (!p.media.length && !p.remote) { gonePoster = p.poster; list.splice(i, 1); return; }
      if (!p.media.some(m => m.thumb === p.poster)) p.poster = (p.media[0] && p.media[0].thumb) || null;
    });
    if (gonePoster) {
      const abs = require('../lib/media').toDiskWithin(gonePoster, [require('../lib/config').MEDIA.references]);
      if (abs) { try { require('fs').rmSync(abs, { force: true }); } catch (e) { /* held */ } }
    }
    const left = REFS.read().find(x => x && x.id === id) || null;
    res.json({ success: true, moved: moved.length, skipped, post: left, made: '' });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// GET /api/references/:id/watch -> { url }   (block 5c) a long video kept as a tile, watched from its site: the address of
// a stream with picture and sound (lib/ytdlp.js streamUrl). Not YouTube's - that one plays in its own player.
router.get('/references/:id/watch', async (req, res) => {
  try {
    const p = REFS.read().find(x => x && String(x.id) === String(req.params.id));
    if (!p) return res.status(404).json({ success: false, error: 'no such post' });
    if (!p.link) return res.status(400).json({ success: false, error: 'this post has no link' });
    res.json({ success: true, url: await require('../lib/ytdlp').streamUrl(p.link) });
  } catch (e) { res.status(502).json({ success: false, error: e.message }); }
});

// DELETE /api/references/:id   -> { removed: [file names] }
// The post and its files go - each file with what is derived from it (its thumbnail, a preview copy: lib/relocate.js
// siblingsOf) - the record first, in one tick, then the files.
router.delete('/references/:id', (req, res) => {
  try {
    const id = String(req.params.id);
    const gone = REFS.apply((list) => {
      const i = list.findIndex(p => p && String(p.id) === id);
      return i < 0 ? null : list.splice(i, 1)[0];
    });
    if (!gone) return res.status(404).json({ success: false, error: 'no such post' });
    const fs = require('fs');
    const path = require('path');
    const { toDiskWithin } = require('../lib/media');
    const { MEDIA } = require('../lib/config');
    const { siblingsOf } = require('../lib/relocate');
    // Only what another post does not point at (a file is one post's - this is a guard, not a rule in use).
    const used = new Set();
    for (const p of REFS.read()) for (const m of (p.media || [])) { if (m.path) used.add(m.path); if (m.thumb) used.add(m.thumb); }
    const urls = [gone.poster, ...(gone.media || []).flatMap(m => [m.path, m.thumb])].filter(u => u && !used.has(u));
    const removed = [];
    for (const u of urls) {
      const abs = toDiskWithin(u, [MEDIA.references]);
      if (!abs) continue;
      let derived = [];
      try { derived = siblingsOf(abs, path.basename(abs)).map(([a]) => a); } catch (e) { derived = []; }
      try { fs.rmSync(abs, { force: true }); removed.push(path.basename(abs)); } catch (e) { /* held: left */ }
      for (const d of derived) { try { fs.rmSync(d, { force: true }); } catch (e) { /* held */ } }
    }
    res.json({ success: true, removed });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

module.exports = router;
