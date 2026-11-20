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
//   GET    /api/mv3/chat?project=…&kind=…   that thread, oldest first (no chat clears its thread)
//   POST   /api/mv3/chat/delete              { id } - one message taken away, with what goes with it
//
//   POST   /api/mv3/img/upload               multipart `image` + `project` (+ `categoryId`) - a reference
//                                            from the person's own disk, filed into IMAGES itself or
//                                            the person's folder open in the window
//   POST   /api/mv3/img/link                 { url, project, categoryId } - a picture's link from a
//                                            browser, downloaded and filed the same way
//
// A MESSAGE IS SENT BY THE SERVER: the chat is left and come back to. The press writes the person's turn, a record and an Alerts
// row for every picture asked for, and the answering turn that points at them - and answers; the
// analyst, the hosting of the references and the asking happen behind it, the rows saying which in
// words. A page that goes away loses nothing, and a reload finds every countdown at its real age.
// Up to FIVE sends at once per project; each picture of a send is its own walk down the
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
const I18N = require('../lib/i18n');
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
    // A storyboard of the video chat is its card's, not this chat's: it is on the Images shelf.
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
    if (!project) return res.status(400).json({ success: false, error: I18N.t('open a project first') });
    const text = String(b.text || '').trim().slice(0, 20000);
    if (!text) return res.status(400).json({ success: false, error: I18N.t('say what to make') });
    const engine = String(b.engine || '');
    const e = MV.ENGINES[engine];
    if (!e) return res.status(400).json({ success: false, error: I18N.t('no such model: {model}', { model: engine }) });
    const refs = (Array.isArray(b.refs) ? b.refs : []).map(x => String(x || '').split('?')[0]).filter(Boolean).slice(0, 5);
    for (let i = 0; i < refs.length; i++) {
      const abs = toDiskExisting(refs[i]);
      if (!abs || !fs.existsSync(abs)) return res.status(400).json({ success: false, error: I18N.t('picture {n} is not in the library any more', { n: i + 1 }) });
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
      return res.status(409).json({ success: false, error: I18N.tn(AT_ONCE, '{n} message is being drawn already - wait for it', '{n} messages are being drawn already - wait for one of them') });
    }

    // What was said before this message, for "the same but at night" - read before this turn is written,
    // so neither this message nor a send pressed meanwhile is taken for the previous one.
    const before = CHAT.read(project, 'image').slice(-4).map(m => ({ role: m.role, text: m.text }));
    const msgId = CHAT.newId();
    kick = 'k' + crypto.randomBytes(8).toString('hex');
    GENS.asking.add(kick);                 // before the rows: the runner asks about them at once
    CHAT.add({ project, kind: 'image', role: 'user', text, refs });
    const first = write ? I18N.t('reading your message') : (refs.length ? I18N.t('sending the pictures') : I18N.t('asking {who}', { who: b.provider || I18N.t('the model') }));
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
          for (const id of o.ids) GENS.refuse(id, I18N.t('the analyst asked a question instead'), o.kick, { question: true });
          CHAT.add({ project: o.project, kind: 'image', role: 'agent', text: t.ask });
          return;
        }
        over = { prompt: (t && t.prompt) || o.text, aspect: t && t.aspect, quality: t && t.quality,
                 fell: (t && t.fell) || '', writer: (t && t.writer) || '' };
      } catch (err) {
        over = { prompt: o.text, fell: I18N.t('the analyst could not be reached') };
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
// An attachment of the video chat that is not in this library - a card whose character or place was
// deleted since - is marked `gone`: the card says what is missing before anything is pressed.
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

// One message taken away - the cross in its corner, pressed twice - with what goes with it
// (lib/mv3-chat.js remove): any of the three chats, the drafts' conversation too. 409 while something in it is being made.
router.post('/mv3/chat/delete', (req, res) => {
  try {
    const r = CHAT.remove(String((req.body || {}).id || ''));
    if (r.error) return res.status(r.code || 400).json({ success: false, error: r.error });
    res.json({ success: true, messages: r.messages, records: r.records });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── A reference from the disk ───────────────────────────────────────────────
// Its own door rather than /api/images/upload. It files the picture into IMAGES itself, or into the folder open
// in the attachment window or the pictures column when that is a folder of the person's own (`_folderFor`).
//
// The extension is KEPT rather than normalised: a PNG with the background erased is one of the
// things people attach, and rewriting it to .jpg would flatten the transparency onto black. A picture
// in a format the aggregators refuse - AVIF, GIF, TIFF, a phone's HEIC - is turned into a JPEG once it
// is down (lib/image-in.js), so it does not fail after the press.
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
  if (!req.file) return res.status(400).json({ success: false, error: I18N.t('no file') });
  let abs = req.file.path;
  try { abs = await IMGIN.sendableFile(abs); }
  catch (e) {
    try { fs.rmSync(req.file.path, { force: true }); } catch (x) { /* it is going anyway */ }
    return res.status(e.status || 400).json({ success: false, error: e.message });
  }
  const imagePath = '/media/work/' + path.basename(abs);    // IMG.add moves it into its folder
  const b = req.body || {};
  try {
    // A picture brought into a chat lies in IMAGES itself, so it is easy to find; through the window or the column,
    // in the person's folder open there. The project is only remembered.
    const cat = _folderFor('images', b.categoryId);
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
  res.status(400).json({ success: false, error: (err && err.message) || I18N.t('upload failed') });
});

/**
 * The folder a picture brought into a chat goes into: the one asked for (`id` - the folder open in the attachment
 * window or the pictures column) when it is a folder of the person's own of this kind - not a required one (Generated,
 * Screenshots, the references of Environments / Lookbooks: lib/library-cats.js isLocked) and nothing under those
 * references (`closedWhy` - nothing goes into them by hand); else the kind's root.
 * -> { id, label } ('' for the root).
 */
function _folderFor(kind, id) {
  const none = { id: '', label: '' };
  const cid = String(id || '').trim();
  if (!cid) return none;
  const LC = require('../lib/library-cats');
  const c = LC.find(kind, cid);
  if (!c) return none;
  if (LC.isLocked(kind, c.id)) return none;
  if (typeof LC.closedWhy === 'function' && LC.closedWhy(kind, c.id)) return none;
  return { id: c.id, label: c.label };
}

// ── A picture by its link ─────
// A picture dragged from a browser onto a chat or its attachment window. Only a picture's OWN address is taken: the
// answer must be a picture (its bytes read by lib/image-in.js, made sendable as a file from this computer is); a page's
// address - an Instagram post, an article - is refused in words, and nothing is pulled out of the page. Filed as an upload
// is: into IMAGES itself from the chat, into the person's folder open from the window or the column.
const LINK_MAX = 64 * 1024 * 1024;           // the upload's own limit
const LINK_MS = 45000;
const PAGE_WORDS = () => I18N.t('This is a page, not a picture - drag the picture itself, or open it and drag it from there (a post goes to the Telegram bot).');

async function _fetchPicture(url) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), LINK_MS);
  try {
    let r;
    try {
      r = await fetch(url, { signal: ac.signal, redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' } });
    } catch (e) {
      throw Object.assign(new Error(ac.signal.aborted ? I18N.t('the site did not answer in time') : I18N.t('the site could not be reached')), { status: 502 });
    }
    if (!r.ok) throw Object.assign(new Error(I18N.t('the site answered {status}', { status: r.status })), { status: 502 });
    const type = String(r.headers.get('content-type') || '').toLowerCase();
    if (/^text\/|html|json|xml/.test(type) && !/svg/.test(type)) {
      try { await r.body.cancel(); } catch (e) { /* let it go */ }
      throw Object.assign(new Error(PAGE_WORDS()), { status: 400 });
    }
    const len = +r.headers.get('content-length') || 0;
    if (len > LINK_MAX) throw Object.assign(new Error(I18N.t('the picture is over 64 MB')), { status: 400 });
    const parts = [];
    let got = 0;
    for await (const chunk of r.body) {
      got += chunk.length;
      if (got > LINK_MAX) { ac.abort(); throw Object.assign(new Error(I18N.t('the picture is over 64 MB')), { status: 400 }); }
      parts.push(Buffer.from(chunk));
    }
    return Buffer.concat(parts);
  } finally {
    clearTimeout(timer);
  }
}

// Bytes with something in them that sharp names no format of - what lib/image-in.js refuses as "not a picture".
async function _notPicture(buf) {
  if (!buf || !buf.length) return false;
  let meta = null;
  try { meta = await require('sharp')(buf).metadata(); } catch (e) { meta = null; }
  return !(meta && meta.format);
}

router.post('/mv3/img/link', async (req, res) => {
  const b = req.body || {};
  const url = String(b.url || '').trim();
  if (!/^https?:\/\/\S+$/i.test(url) || url.length > 4000) return res.status(400).json({ success: false, error: I18N.t('that is not a link') });
  let buf;
  try { buf = await _fetchPicture(url); }
  catch (e) { return res.status(e.status || 502).json({ success: false, error: e.message }); }
  let pic;
  try { pic = await IMGIN.sendable(buf); }
  catch (e) {
    // Bytes that are no picture - a page that did not say it was one - are the page's words too: told by the bytes
    // themselves (no format sharp can name), never by the words of the error.
    return res.status(400).json({ success: false, error: e.status === 400 && await _notPicture(buf) ? PAGE_WORDS() : e.message });
  }
  try {
    fs.mkdirSync(MEDIA.work, { recursive: true });
    const file = 'mref_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex') + '.' + pic.ext;
    fs.writeFileSync(path.join(MEDIA.work, file), pic.buf);
    // Its name: the link's last part, without its query - else "picture".
    let name = '';
    try { name = decodeURIComponent(new URL(url).pathname.split('/').pop() || '').replace(/\.[^.]+$/, ''); } catch (e) { name = ''; }
    name = name.replace(/[^\p{L}\p{N} ._-]+/gu, ' ').trim().slice(0, 120) || I18N.t('picture');
    const cat = _folderFor('images', b.categoryId);
    const { item } = await IMG.add('/media/work/' + file, {
      name, source: 'upload', categoryId: cat.id, categoryLabel: cat.label,
      meta: { project: String(b.project || '') || null, attached: true, link: url.slice(0, 2000) },
    });
    res.json({ success: true, item });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
