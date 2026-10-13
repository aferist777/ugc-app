'use strict';

// ════════════════════════════════════════════════════════════════════════════
// MERGE — asking for a picture, and reading the strip of what was asked for.
//
// Merge's own routes against Merge's own table. Nothing here reaches into the Character page's
// matrix or its ladders, and nothing there has to change for a model to be added to this list.
//
//   GET    /api/mv3/img/matrix              what can be asked for: engines, aggregators, shapes
//   GET    /api/mv3/img/feed?project=…      that project's generations, newest first
//   POST   /api/mv3/img/send                { project, text, refs, engine, provider, quality, aspect,
//                                             n, write, where } - a message of the pictures chat
//
//   GET    /api/mv3/chat?project=…&kind=…   that thread, oldest first (no chat clears its thread since V25)
//
//   POST   /api/mv3/img/upload               multipart `image` + `project` - a reference from
//                                            the person's own disk, filed on the images shelf
//                                            under the project's category
//
// A MESSAGE IS SENT BY THE SERVER (phase J, the owner 2026-10-02 - the chat lives in the Library
// panel now and is left and come back to). The press writes the person's turn, a record and an Alerts
// row for every picture asked for, and the answering turn that points at them - and answers; the
// analyst, the hosting of the references and the asking happen behind it, the rows saying which in
// words. A page that goes away loses nothing, and a reload finds every countdown at its real age.
// Up to FIVE sends at once per project (the owner); each picture of a send is its own walk down the
// fallback, so one that dies takes one picture with it rather than the batch.
// ════════════════════════════════════════════════════════════════════════════

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const router = express.Router();

const MV = require('../lib/mv3-img');
const GENS = require('../lib/mv3-gens');
const CHAT = require('../lib/mv3-chat');
const AGENT = require('../lib/mv3-agent');
const IMG = require('../lib/images-store');
const LC = require('../lib/library-cats');
const { MEDIA } = require('../lib/config');
const { toDiskExisting } = require('../lib/media');

// The whole table, shaped for the panel. Built from the same rows that submit, so the panel
// cannot offer a pairing that fails at submit time.
router.get('/mv3/img/matrix', (_req, res) => {
  try {
    res.json({ success: true, ...MV.matrix() });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/mv3/img/feed', (req, res) => {
  try {
    // A storyboard of the video chat (phase V8, PLAN V-A) is its card's, not this chat's: it is on the Images shelf.
    res.json({ success: true, items: GENS.list(String(req.query.project || '')).filter(g => !g.board && !g.frame) });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── A message ───────────────────────────────────────────────────────────────
const AT_ONCE = 5;
const COUNTS = [1, 2, 4];

router.post('/mv3/img/send', (req, res) => {
  const b = req.body || {};
  let kick = '';
  try {
    const project = String(b.project || '').trim();
    if (!project) return res.status(400).json({ success: false, error: 'open a project first' });
    const text = String(b.text || '').trim().slice(0, 20000);
    if (!text) return res.status(400).json({ success: false, error: 'say what to make' });
    const engine = String(b.engine || '');
    const e = MV.ENGINES[engine];
    if (!e) return res.status(400).json({ success: false, error: 'no such model: ' + engine });
    const refs = (Array.isArray(b.refs) ? b.refs : []).map(x => String(x || '').split('?')[0]).filter(Boolean).slice(0, 5);
    for (let i = 0; i < refs.length; i++) {
      const abs = toDiskExisting(refs[i]);
      if (!abs || !fs.existsSync(abs)) return res.status(400).json({ success: false, error: 'picture ' + (i + 1) + ' is not in the library any more' });
    }
    const n = COUNTS.includes(+b.n) ? +b.n : 1;
    const write = b.write !== false;

    // THE NUMBERS RULE is arithmetic (lib/mv3-agent.js): with two or more pictures and a message that
    // does not say which is which, the question is the answer - at once, and nothing is asked for.
    if (write && AGENT.needsNumbers(text, refs.length)) {
      CHAT.add({ project, kind: 'image', role: 'user', text, refs });
      CHAT.add({ project, kind: 'image', role: 'agent', text: AGENT.numbersQuestion(text, refs.length) });
      return res.json({ success: true, asked: true });
    }
    if (GENS.runningSends(project) >= AT_ONCE) {
      return res.status(409).json({ success: false, error: AT_ONCE + ' messages are being drawn already - wait for one of them' });
    }

    // What was said before this message, for "the same but at night" - read before this turn is written,
    // so neither this message nor a send pressed meanwhile is taken for the previous one.
    const before = CHAT.read(project, 'image').slice(-4).map(m => ({ role: m.role, text: m.text }));
    const msgId = CHAT.newId();
    kick = 'k' + crypto.randomBytes(8).toString('hex');
    GENS.asking.add(kick);                 // before the rows: the runner asks about them at once
    CHAT.add({ project, kind: 'image', role: 'user', text, refs });
    const first = write ? 'reading your message' : (refs.length ? 'sending the pictures' : 'asking ' + (b.provider || 'the model'));
    const ids = [];
    for (let i = 0; i < n; i++) {
      ids.push(GENS.create({
        project, send: msgId, kick, where: b.where, stage: first,
        engine, provider: b.provider, prompt: text, said: text,
        aspect: b.aspect, quality: b.quality, refs,
      }).id);
    }
    CHAT.add({ id: msgId, project, kind: 'image', role: 'agent', text: '', genId: ids[0], genIds: ids, refs });
    res.json({ success: true, send: msgId, genIds: ids });
    _work({ project, text, refs, engine, write, ids, kick, before });
  } catch (err) {
    if (kick) GENS.asking.delete(kick);
    console.error('[mv3-img/send]', err.message);
    if (!res.headersSent) res.status(500).json({ success: false, error: err.message });
  }
});

// Behind the answer: the analyst reads the message and LOOKS at the references (hosted once - the
// same bytes are one upload, lib/helpers.js), then every picture is asked for. The analyst never stops
// the work: unreachable, or answering nothing usable, the words go as typed and `fell` says why.
async function _work(o) {
  try {
    let over = { prompt: o.text };
    if (o.write) {
      let refUrls = [];
      if (o.refs.length) {
        try { refUrls = await GENS.hostRefs(o.refs); }
        catch (err) { console.warn('[mv3-img] send: could not host references -', err.message); }
      }
      try {
        const e = MV.ENGINES[o.engine];
        const t = await AGENT.think({
          engine: o.engine, text: o.text, refs: o.refs.length, refUrls,
          // Only so "the same but at night" has something to be the same AS.
          thread: o.before,
          aspects: MV.ASPECTS, tiers: e ? e.tiers : [],
        });
        if (t && t.ask) {
          for (const id of o.ids) GENS.refuse(id, 'the analyst asked a question instead', o.kick);
          CHAT.add({ project: o.project, kind: 'image', role: 'agent', text: t.ask });
          return;
        }
        over = { prompt: (t && t.prompt) || o.text, aspect: t && t.aspect, quality: t && t.quality,
                 fell: (t && t.fell) || '', writer: (t && t.writer) || '' };
      } catch (err) {
        over = { prompt: o.text, fell: 'the analyst could not be reached' };
      }
    }
    await Promise.all(o.ids.map(id => GENS.submit(id, over, o.kick)));
  } catch (err) {
    console.warn('[mv3-img] send:', err.message);
  } finally {
    GENS.asking.delete(o.kick);
  }
}

// ── The thread ──────────────────────────────────────────────────────────────
// Read whole rather than paged. A project's conversation is bounded by what one person typed
// into it, and the pictures inside it are thumbnails on demand - so the whole of it costs less
// than the paging would.
// (phase V23) An attachment of the video chat that is not in this library - a card brought by Import without its
// character or place - is marked `gone`: the card says what is missing before anything is pressed.
function _markGone(items) {
  const seen = new Map();
  const here = (p) => {
    if (!seen.has(p)) { let abs = null; try { abs = toDiskExisting(p); } catch (e) { abs = null; } seen.set(p, !!(abs && fs.existsSync(abs))); }
    return seen.get(p);
  };
  return items.map(m => (!m || !Array.isArray(m.media) || !m.media.some(a => a && a.path && !here(String(a.path).split('?')[0]))) ? m
    : Object.assign({}, m, { media: m.media.map(a => (a && a.path && !here(String(a.path).split('?')[0])) ? Object.assign({}, a, { gone: true }) : a) }));
}

router.get('/mv3/chat', (req, res) => {
  try {
    const items = CHAT.read(String(req.query.project || ''), req.query.kind);
    res.json({ success: true, items: req.query.kind === 'clip' ? _markGone(items) : items });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── A reference from the disk ───────────────────────────────────────────────
// Its own door rather than /api/images/upload, and the difference is where it lands: this one
// files the picture under the PROJECT's category - the same shelf that project's generations go
// to - so a reference brought in by hand is findable tomorrow beside the pictures made from it.
//
// The extension is KEPT rather than normalised: a PNG with the background erased is one of the
// things people attach, and rewriting it to .jpg would flatten the transparency onto black. A picture
// in a format the aggregators refuse - AVIF, GIF, TIFF, a phone's HEIC - is turned into a JPEG once it
// is down (phase V24, lib/image-in.js); before, it was only renamed .png and failed after the press.
const IMGIN = require('../lib/image-in');
const _upload = multer({
  storage: multer.diskStorage({
    destination: (_q, _f, cb) => { try { fs.mkdirSync(MEDIA.work, { recursive: true }); } catch (e) {} cb(null, MEDIA.work); },
    filename: (_q, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, 'mref_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6)
        + (IMGIN.IN_EXTS.includes(ext) ? ext : '.png'));
    },
  }),
  limits: { fileSize: 64 * 1024 * 1024 },
  fileFilter: (_q, file, cb) => cb(null, /^image\//.test(file.mimetype) || IMGIN.IN_EXTS.includes(path.extname(file.originalname).toLowerCase())),
});

router.post('/mv3/img/upload', _upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: 'no file' });
  let abs = req.file.path;
  try { abs = await IMGIN.sendableFile(abs); }
  catch (e) {
    try { fs.rmSync(req.file.path, { force: true }); } catch (x) { /* it is going anyway */ }
    return res.status(e.status || 400).json({ success: false, error: e.message });
  }
  const imagePath = '/media/work/' + path.basename(abs);    // IMG.add moves it to the project's category
  const b = req.body || {};
  try {
    // The same category the project's generations use, by the same rule - see catLabelFor.
    let cat = { id: '', label: '' };
    try { cat = LC.add('images', GENS.catLabelFor(_titleOf(String(b.project || '')))).cat || cat; } catch (e) {}
    const { item } = await IMG.add(imagePath, {
      name: String(b.name || '').trim().slice(0, 120) || path.basename(req.file.originalname),
      source: 'upload',
      categoryId: cat.id,
      categoryLabel: cat.label,
      meta: { project: String(b.project || '') || null, attached: true },
    });
    res.json({ success: true, item });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.use('/mv3/img/upload', (err, _req, res, _next) => {
  res.status(400).json({ success: false, error: (err && err.message) || 'upload failed' });
});

// The project's own name, read from the timeline store. Same read mv3-gens does, and for the
// same reason: the title can change between the upload and anything else that looks at it.
function _titleOf(key) {
  if (!key) return '';
  try {
    const rec = require('../lib/merge-store').read().timelines[key];
    return (rec && rec.title) || '';
  } catch (e) { return ''; }
}

module.exports = router;
