'use strict';

// ════════════════════════════════════════════════════════════════════════════
// MERGE — the video chat's server (phase V2, docs/local-app/PLAN.md "V-A", "V-E"). The page is phase V3.
//
//   GET  /api/mv3/video/matrix          every model, its records on kie.ai and Replicate, parameters, prices and why
//                                       one cannot be used - no network (smoke reads it with no key)
//   GET  /api/mv3/video/feed?project=   the project's video records, newest first
//   POST /api/mv3/video/send            a message: its turn, a record and an Alerts row per clip, the answering
//                                       turn - at the press - and the work behind the answer
//   POST /api/mv3/video/upload          a clip from this computer onto Uploads, under the project's category
//
// The thread itself is GET/DELETE /api/mv3/chat?kind=clip (routes/mv3-img.js) - 'clip', not 'video': old libraries
// hold 'video' messages of a strip that was removed, and a live 'video' would bring them back.
// Not /api/video/* (gone with Animate) and not /api/mv3/vid/* (smoke expects those to stay 404).
// ════════════════════════════════════════════════════════════════════════════

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const router = express.Router();

const VM = require('../lib/video-models');
const VGENS = require('../lib/mv3-video-gens');
const CHAT = require('../lib/mv3-chat');
const AGENT = require('../lib/mv3-agent');
const KEYS = require('../lib/agg-keys');
const FAKE = require('../lib/fake-agg');
const { MEDIA } = require('../lib/config');
const { toDiskExisting } = require('../lib/media');

const KIND = 'clip';
const AT_ONCE = 3;                 // sends per project at once - a clip can take ten minutes
const COUNTS = [1, 2];
const KINDS = ['image', 'video', 'audio'];

router.get('/mv3/video/matrix', (_req, res) => {
  try { res.json(Object.assign({ success: true }, VM.matrix())); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/mv3/video/feed', (req, res) => {
  try {
    const p = String(req.query.project || '');
    res.json({ success: true, items: p ? VGENS.list(p) : [] });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

function _titleOf(key) {
  if (!key) return '';
  try { const rec = require('../lib/merge-store').read().timelines[key]; return (rec && rec.title) || ''; }
  catch (e) { return ''; }
}

router.post('/mv3/video/send', (req, res) => {
  const b = req.body || {};
  let kick = '';
  try {
    const project = String(b.project || '').trim();
    if (!project) return res.status(400).json({ success: false, error: 'open a project first' });
    const model = String(b.model || '');
    if (!VM.MODELS.some(m => m.id === model)) return res.status(400).json({ success: false, error: 'no such model: ' + model });
    const isMC = /^kmc/.test(model);
    const text = String(b.text || '').trim().slice(0, 30000);
    if (!text && !isMC) return res.status(400).json({ success: false, error: 'say what to make' });
    const params = (b.params && typeof b.params === 'object') ? b.params : {};
    const n = COUNTS.includes(+b.n) ? +b.n : 1;

    // What is attached, each checked to be in the library.
    const media = (Array.isArray(b.media) ? b.media : []).slice(0, 30).map(m => ({
      path: String((m && m.path) || '').split('?')[0], kind: KINDS.includes(m && m.kind) ? m.kind : 'image',
      role: String((m && m.role) || '').slice(0, 20), in: +(m && m.in) || 0, out: +(m && m.out) || 0,
    })).filter(m => m.path);
    for (let i = 0; i < media.length; i++) {
      const abs = toDiskExisting(media[i].path);
      if (!abs || !fs.existsSync(abs)) return res.status(400).json({ success: false, error: 'attachment ' + (i + 1) + ' is not in the library any more' });
      // Clips and sounds as references come with V7: their cutting and fitting is not here yet.
      if (media[i].kind !== 'image' && !FAKE.on()) return res.status(400).json({ success: false, error: 'clips and sounds as references are not ready yet - pictures only for now' });
    }
    if (media.length && !KEYS.r2() && !FAKE.on()) {
      return res.status(400).json({ success: false, error: 'attachments need R2 (Admin -> API keys) - the models read them from a public link' });
    }

    // Who can take it, before anything is written: the chosen aggregator (or the cheapest with a key) first.
    const agg = KEYS.AGGS.includes(b.agg) ? b.agg : VM.defaultAgg(model, params);
    const ladder = VM.ladder(model, agg);
    if (!ladder.length) return res.status(400).json({ success: false, error: VM.noRoute(model) });
    const why = [];
    const fits = ladder.filter(p => { try { VM.check(p, { media, prompt: isMC ? text : 'x' }); return true; } catch (e) { why.push(e.message); return false; } });
    if (!fits.length) return res.status(400).json({ success: false, error: why[0] || 'no aggregator can take this' });
    if (VGENS.runningSends(project) >= AT_ONCE) {
      return res.status(409).json({ success: false, error: AT_ONCE + ' messages are being made already - wait for one of them' });
    }

    const before = CHAT.read(project, KIND).slice(-4).map(m => ({ role: m.role, text: m.text }));
    const msgId = CHAT.newId();
    kick = 'k' + crypto.randomBytes(8).toString('hex');
    VGENS.asking.add(kick);
    CHAT.add({ project, kind: KIND, role: 'user', text, refs: media.map(m => m.path), media });
    const first = isMC ? (AGENT.english(text) ? 'asking ' + fits[0].aggLabel : 'translating the prompt') : 'writing the prompt';
    const ids = [];
    for (let i = 0; i < n; i++) {
      ids.push(VGENS.create({
        project, send: msgId, kick, where: b.where, stage: first,
        model, agg: fits[0].agg, prompt: text, said: text, params, media, skill: b.skill || null,
      }).id);
    }
    CHAT.add({ id: msgId, project, kind: KIND, role: 'agent', text: '', genId: ids[0], genIds: ids, refs: media.map(m => m.path) });
    res.json({ success: true, send: msgId, genIds: ids, agg: fits[0].agg });
    _work({ project, text, model, isMC, media, params, skill: b.skill || null, ids, kick, before, pair: fits[0] });
  } catch (err) {
    if (kick) VGENS.asking.delete(kick);
    console.error('[mv3-video/send]', err.message);
    if (!res.headersSent) res.status(500).json({ success: false, error: err.message });
  }
});

// Behind the answer: the prompt (the writer, or for motion control the words - translated when not English),
// then every clip asked for. Each step of the record checks it is still its own.
async function _work(o) {
  try {
    let over;
    if (o.isMC) {
      const t = await AGENT.toEnglish(o.text);
      if (t.fail) { for (const id of o.ids) VGENS.refuse(id, t.fail, o.kick); return; }
      over = { prompt: t.text, lang: 'en', writer: t.translated ? 'translated' : '' };
    } else {
      let picUrls = [];
      const pics = o.media.filter(m => m.kind === 'image').map(m => m.path);
      if (pics.length) {
        try { picUrls = await require('../lib/mv3-gens').hostRefs(pics); }
        catch (e) { console.warn('[mv3-video] send: the writer will not see the pictures -', e.message); }
      }
      const t = await AGENT.thinkVideo({ model: o.model, text: o.text, media: o.media, picUrls, thread: o.before,
                                         skill: o.skill, params: o.params, max: o.pair.promptMax });
      if (t.ask) {
        for (const id of o.ids) VGENS.refuse(id, 'the writer asked a question instead', o.kick);
        CHAT.add({ project: o.project, kind: KIND, role: 'agent', text: t.ask });
        return;
      }
      if (t.fail) { for (const id of o.ids) VGENS.refuse(id, t.fail, o.kick); return; }
      over = { prompt: t.prompt, fell: t.fell || '', writer: t.writer || '' };
    }
    await Promise.all(o.ids.map(id => VGENS.submit(id, over, o.kick)));
  } catch (err) {
    console.warn('[mv3-video] send:', err.message);
    for (const id of o.ids) {
      const g = VGENS.get(id);
      if (g && g.state === 'pending' && !g.taskId) VGENS.refuse(id, 'it stopped before it was asked for: ' + err.message, o.kick);
    }
  } finally {
    VGENS.asking.delete(o.kick);
  }
}

// ── A clip from this computer ───────────────────────────────────────────────
// Onto Uploads under the project's category (lib/birols-store.js places it, makes its poster, measures it).
const EXTS = ['.mp4', '.mov', '.webm', '.m4v', '.mkv', '.avi'];
const _upload = multer({
  storage: multer.diskStorage({
    destination: (_q, _f, cb) => { try { fs.mkdirSync(MEDIA.work, { recursive: true }); } catch (e) { /* exists */ } cb(null, MEDIA.work); },
    filename: (_q, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, 'vref_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex') + (EXTS.includes(ext) ? ext : '.mp4'));
    },
  }),
  limits: { fileSize: 512 * 1024 * 1024 },
  fileFilter: (_q, file, cb) => cb(null, /^video\//.test(file.mimetype) || EXTS.includes(path.extname(file.originalname).toLowerCase())),
});

router.post('/mv3/video/upload', _upload.single('video'), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: 'no clip' });
  const b = req.body || {};
  try {
    const { item } = await require('../lib/birols-store').add('/media/work/' + req.file.filename, {
      kind: 'uploads',
      name: String(b.name || '').trim().slice(0, 120) || path.basename(req.file.originalname),
      categoryLabel: VGENS.catLabelFor(_titleOf(String(b.project || ''))),
    });
    res.json({ success: true, item });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.use('/mv3/video/upload', (err, _req, res, _next) => {
  res.status(400).json({ success: false, error: (err && err.message) || 'upload failed' });
});

module.exports = router;
