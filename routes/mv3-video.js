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
// The step-by-step builder (phase V6) - a recipe chosen, the writer and the video are two presses:
//   POST  /api/mv3/video/write              the recipe's request, its places filled: the recipe card and a prompt card
//                                           at the press, the writer behind the answer
//   PATCH /api/mv3/video/card/:id           the person's edit of a prompt card
//   POST  /api/mv3/video/card/:id/rewrite   the writer again for a card not made yet (a failed one, another model)
//   POST  /api/mv3/video/card/:id/make      the video from the card: a record and an Alerts row per clip, at the press
//   POST  /api/mv3/video/card/:id/again     a new card with a made card's prompt, to make it once more or change it
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
const SKILL_KINDS = ['template', 'case', 'example', 'preset'];

// The catalog's skill a send carries (phase V5): the recipe the writer follows, as the person left it - kept on the
// record with where it came from and whether it was edited.
function _skill(s) {
  if (!s || typeof s !== 'object') return null;
  const text = String(s.text || '').replace(/\r\n/g, '\n').trim().slice(0, 20000);
  if (!text) return null;
  return {
    id: String(s.id || '').slice(0, 120), kind: SKILL_KINDS.includes(s.kind) ? s.kind : 'template',
    title: String(s.title || '').slice(0, 160), v: String(s.v || '').slice(0, 40), edited: !!s.edited, text,
  };
}
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

// What is attached, each checked to be in the library: { media } or { error } in words.
function _mediaOf(list) {
  const media = (Array.isArray(list) ? list : []).slice(0, 30).map(m => ({
    path: String((m && m.path) || '').split('?')[0], kind: KINDS.includes(m && m.kind) ? m.kind : 'image',
    role: String((m && m.role) || '').slice(0, 20), label: String((m && m.label) || '').slice(0, 40),
    in: +(m && m.in) || 0, out: +(m && m.out) || 0,
  })).filter(m => m.path);
  for (let i = 0; i < media.length; i++) {
    const abs = toDiskExisting(media[i].path);
    if (!abs || !fs.existsSync(abs)) return { error: 'attachment ' + (i + 1) + ' is not in the library any more' };
    // Clips and sounds as references come with V7: their cutting and fitting is not here yet.
    if (media[i].kind !== 'image' && !FAKE.on()) return { error: 'clips and sounds as references are not ready yet - pictures only for now' };
  }
  if (media.length && !KEYS.r2() && !FAKE.on()) {
    return { error: 'attachments need R2 (Admin -> API keys) - the models read them from a public link' };
  }
  return { media };
}

// Who can take it, before anything is written: the chosen aggregator (or the cheapest with a key) first. A CHOSEN one
// that cannot take it is an error, never swapped for the other at the other's price (review V2r): the page showed
// what the chosen one costs. Only a refusal at the ask itself goes down the ladder. { fits } or { error }.
function _routeOf(model, agg, params, media, prompt) {
  const chosen = KEYS.AGGS.includes(agg) ? agg : '';
  if (chosen && !VM.usable(chosen)) return { error: KEYS.why(chosen) || (KEYS.LABEL[chosen] + ' cannot be asked now') };
  const probe = { media, params, prompt };
  const a = chosen || VM.defaultAgg(model, params, probe);
  const ladder = VM.ladder(model, a);
  if (!ladder.length) return { error: VM.noRoute(model) };
  const why = [];
  const fits = ladder.filter(p => { try { VM.check(p, probe); return true; } catch (e) { why.push(e.message); return false; } });
  if (!fits.length) return { error: why[0] || 'no aggregator can take this' };
  if (chosen && fits[0].agg !== chosen) return { error: why[0] || (KEYS.LABEL[chosen] + ' cannot take this') };
  return { fits };
}

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
    // A catalog's skill is the writer's recipe: none for Kling motion control (no writer) or with the pen off.
    const skill = (isMC || b.write === false) ? null : _skill(b.skill);

    // What is attached, each checked to be in the library; who can take it.
    const mm = _mediaOf(b.media);
    if (mm.error) return res.status(400).json({ success: false, error: mm.error });
    const media = mm.media;
    const rt = _routeOf(model, b.agg, params, media, isMC ? text : 'xxx');
    if (rt.error) return res.status(400).json({ success: false, error: rt.error });
    const fits = rt.fits;
    if (VGENS.runningSends(project) >= AT_ONCE) {
      return res.status(409).json({ success: false, error: AT_ONCE + ' messages are being made already - wait for one of them' });
    }

    const before = CHAT.read(project, KIND).slice(-4).map(m => ({ role: m.role, text: m.text }));
    const msgId = CHAT.newId();
    kick = 'k' + crypto.randomBytes(8).toString('hex');
    VGENS.asking.add(kick);
    CHAT.add({ project, kind: KIND, role: 'user', text, refs: media.map(m => m.path), media });
    const first = (isMC || b.write === false) ? (AGENT.english(text) ? 'asking ' + fits[0].aggLabel : 'translating the prompt') : 'writing the prompt';
    // Every record has its row: one without would never be ended, and would count against the three at once.
    const where = (b.where && typeof b.where === 'object') ? b.where : {
      page: 'merge', href: '/merge?p=' + encodeURIComponent(project) + '&open=videos',
      label: 'Merge · ' + (_titleOf(project) || 'project') + ' · videos', spot: { key: project, view: 'videos' },
    };
    const ids = [];
    for (let i = 0; i < n; i++) {
      ids.push(VGENS.create({
        project, send: msgId, kick, where, stage: first,
        model, agg: fits[0].agg, prompt: text, said: text, params, media, skill,
      }).id);
    }
    CHAT.add({ id: msgId, project, kind: KIND, role: 'agent', text: '', genId: ids[0], genIds: ids, refs: media.map(m => m.path) });
    res.json({ success: true, send: msgId, genIds: ids, agg: fits[0].agg });
    // The page's pen off (b.write === false): the words go as typed - translated first when not English.
    _work({ project, text, model, isMC, asTyped: b.write === false, media, params, skill, ids, kick, before, pair: fits[0] });
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
    // Every clip of the send let go of before the writer was asked: nothing to write for.
    if (!o.ids.some(id => VGENS.ours(id, o.kick))) return;
    let over;
    if (o.isMC || o.asTyped) {
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
    // Each on its own: one that breaks off (a store write that failed after its paid ask) is not every one's end.
    const done = await Promise.allSettled(o.ids.map(id => VGENS.submit(id, over, o.kick)));
    done.forEach((r, i) => { if (r.status === 'rejected') { console.warn('[mv3-video] send:', r.reason && r.reason.message); VGENS.abandon(o.ids[i], o.kick, r.reason); } });
  } catch (err) {
    console.warn('[mv3-video] send:', err.message);
    for (const id of o.ids) VGENS.abandon(id, o.kick, err);
  } finally {
    VGENS.asking.delete(o.kick);
  }
}

// ── The step-by-step builder (phase V6, the owner 2026-10-06) ───────────────
// A recipe chosen, the chat is a builder and the person writes in its cards, not in a box. The recipe's REQUEST - the
// first paragraph of its text - has PLACES, [like this], the person fills in; the press sends it to the WRITER alone:
// the frozen recipe card and a prompt card are written at once, and the writer works behind the answer - the request
// is its message, the rest of the recipe its template, and it never asks back. The prompt it makes is the person's to
// edit, and only then is the video made from it (make: the records and their Alerts rows at the press, their prompt
// READY - a retry from Alerts sends it as it is). No Alerts row for the writer: it is a text, seconds - the card is its
// record, and a card left 'writing' by an app that closed fails when the thread is read (lib/mv3-chat.js).
const WRITE_AT_ONCE = 3;
const GAP = /\[([^\[\]\n]{1,600})\]/g;
// A reference however it was written - {{image:1}}, {{ Image : 1 }} - is rendered for the model the same
// (lib/video-models.js render): every check and the translator read it in ONE form, so it is put in that form first.
const REF_ANY = /\{\{\s*(image|video|audio)\s*:\s*(\d+)\s*\}\}/gi;
const _strictRefs = (p) => String(p || '').replace(REF_ANY, (all, k, n) => '{{' + k.toLowerCase() + ':' + (+n) + '}}');
// A place that only says how long and what shape the clip is (the page fills it from the column) - not a name.
const SIZE_WORDS = /\b(total|length|duration|long|about|around|in|of|a|the|and|sec|secs|second|seconds|s|vertical|horizontal|square|portrait|landscape|aspect|ratio|format|frame|clip)\b/gi;
const _isSize = (g) => /\d/.test(g) && !String(g).replace(/\d+(\.\d+)?\s*:\s*\d+/g, ' ').replace(/\d+(\.\d+)?/g, ' ')
  .replace(SIZE_WORDS, ' ').replace(/[\s.,;:!?()'"\-–—]+/g, '');
const _writingIn = (project) => CHAT.read(project, KIND).filter(m => m.card && m.card.type === 'prompt' && m.card.state === 'writing').length;

// The pictures the WRITER looks at, made small first (review V6): a character's sheet is 4K, and the writer only has
// to see what is in it - the aggregator gets each picture fitted to its own limits when the clip is asked for.
async function _hostForWriter(paths) {
  const { toDiskExisting: abs } = require('../lib/media');
  return Promise.all(paths.map(async (p) => {
    if (FAKE.on()) return FAKE.host(p);
    const file = abs(p);
    if (!file || !fs.existsSync(file)) throw new Error('no such picture: ' + p);
    const buf = await require('sharp')(file, { failOn: 'none' }).rotate()
      .resize({ width: 1536, height: 1536, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
    return require('../lib/helpers').uploadToPublicHost(buf, { ext: 'jpg', verify: true });
  }));
}
const _family = (id) => ((VM.MODELS.find(m => m.id === id) || {}).family || '');
const _labelOf = (id) => ((VM.MODELS.find(m => m.id === id) || {}).label || id);

// The request with its places: each one the person changed in its words, each one left as it came - the example - as
// it stands (a request too); the brackets go.
function _fill(head, values) {
  let i = 0;
  return String(head || '').replace(GAP, (all, ex) => {
    const v = values[i++];
    return (v == null || !String(v).trim()) ? ex : String(v).trim();
  });
}

// The recipe as a send carries it: what it is, and whether the person edited it.
function _recipeOf(r) {
  const o = (r && typeof r === 'object') ? r : {};
  return { id: String(o.id || '').slice(0, 120), kind: SKILL_KINDS.includes(o.kind) ? o.kind : 'template',
           title: String(o.title || '').slice(0, 160), v: String(o.v || '').slice(0, 40), edited: !!o.edited };
}

// The thread's own card, or why not.
function _cardOf(id, project, type) {
  const m = CHAT.get(id);
  if (!m || String(m.project || '') !== String(project || '') || !m.card || m.card.type !== (type || 'prompt')) return null;
  return m;
}

// The writer for one card, behind the answer: what it wrote is filed into the card only while the card is still
// waiting for THIS writer (a card written again, made, or cleared meanwhile is left alone).
async function _writeCard(cardId, kick, o) {
  let out;
  try {
    let picUrls = [];
    const pics = o.media.filter(m => m.kind === 'image').map(m => m.path);
    if (pics.length) {
      try { picUrls = await _hostForWriter(pics); }
      catch (e) { console.warn('[mv3-video] write: the writer will not see the pictures -', e.message); }
    }
    const t = await AGENT.thinkVideo({ model: o.model, text: o.filled, media: o.media, picUrls, thread: [],
                                       skill: { text: o.body }, params: o.params, max: o.max, recipe: true });
    out = t.prompt ? { state: 'ready', prompt: _strictRefs(t.prompt), writer: t.writer || '', fell: t.fell || '', error: '', edited: false }
      : { state: 'failed', error: t.fail || 'the writer answered nothing usable - write it again' };
  } catch (e) {
    out = { state: 'failed', error: 'the writer broke off: ' + String(e.message || e).slice(0, 300) };
  }
  try {
    CHAT.update(cardId, (m) => {
      if (!m.card || m.card.kick !== kick || m.card.state !== 'writing') return false;
      Object.assign(m.card, out);
    });
  } finally { CHAT.writing.delete(kick); }
}

// The settings a card is written for and made with: the model, its aggregator and parameters as the column has them.
function _settings(b) {
  const model = String(b.model || '');
  const params = (b.params && typeof b.params === 'object') ? b.params : {};
  return { model, params, agg: String(b.agg || '') };
}

router.post('/mv3/video/write', (req, res) => {
  const b = req.body || {};
  let kick = '';
  try {
    const project = String(b.project || '').trim();
    if (!project) return res.status(400).json({ success: false, error: 'open a project first' });
    const s = _settings(b);
    if (!VM.MODELS.some(m => m.id === s.model)) return res.status(400).json({ success: false, error: 'no such model: ' + s.model });
    if (_family(s.model) === 'kmc') return res.status(400).json({ success: false, error: 'Kling motion control has no writer - its box is the prompt' });
    const head = String(b.head || '').replace(/\r\n/g, '\n').trim().slice(0, 4000);
    if (!head) return res.status(400).json({ success: false, error: 'the recipe has no request to fill in' });
    const body = String(b.body || '').replace(/\r\n/g, '\n').trim().slice(0, 20000);
    const values = (Array.isArray(b.values) ? b.values : []).slice(0, 24).map(v => (v == null ? null : String(v).slice(0, 2000)));
    const filled = _fill(head, values).slice(0, 8000);
    const mm = _mediaOf(b.media);
    if (mm.error) return res.status(400).json({ success: false, error: mm.error });
    const rt = _routeOf(s.model, s.agg, s.params, mm.media, 'xxx');
    if (rt.error) return res.status(400).json({ success: false, error: rt.error });
    if (_writingIn(project) >= WRITE_AT_ONCE) return res.status(409).json({ success: false, error: WRITE_AT_ONCE + ' prompts are being written already - wait for one of them' });

    const recipe = _recipeOf(b.recipe);
    kick = 'w' + crypto.randomBytes(8).toString('hex');
    // The kick is alive BEFORE its card exists: a read in between must not take the card for a dead writer's.
    CHAT.writing.add(kick);
    const refs = mm.media.map(m => m.path);
    const rc = CHAT.add({ project, kind: KIND, role: 'agent', text: '', refs, media: mm.media,
                          card: { type: 'recipe', recipe, head, values, filled, body } });
    const pc = CHAT.add({ project, kind: KIND, role: 'agent', text: '', refs, media: mm.media,
                          card: { type: 'prompt', state: 'writing', kick, startedAt: new Date().toISOString(), from: rc.id, recipe,
                                  model: s.model, agg: rt.fits[0].agg, params: s.params } });
    res.json({ success: true, recipe: rc.id, card: pc.id });
    _writeCard(pc.id, kick, { model: s.model, filled, body, media: mm.media, params: s.params, max: rt.fits[0].promptMax });
  } catch (err) {
    if (kick) CHAT.writing.delete(kick);
    console.error('[mv3-video/write]', err.message);
    if (!res.headersSent) res.status(500).json({ success: false, error: err.message });
  }
});

// The person's edit of a prompt card - while it is not made yet.
router.patch('/mv3/video/card/:id', (req, res) => {
  const b = req.body || {};
  try {
    const project = String(b.project || '').trim();
    const prompt = _strictRefs(String(b.prompt == null ? '' : b.prompt).replace(/\r\n/g, '\n')).slice(0, 30000);
    let why = null;
    const m = CHAT.update(req.params.id, (x) => {
      if (String(x.project || '') !== project || !x.card || x.card.type !== 'prompt') { why = [404, 'no such card']; return false; }
      if (x.card.state !== 'ready') { why = [409, x.card.state === 'sent' ? 'it was made already' : 'it is not written yet']; return false; }
      if (x.card.prompt === prompt) return false;
      x.card.prompt = prompt;
      x.card.edited = true;
    });
    if (!m) return res.status(404).json({ success: false, error: 'no such card' });
    if (why) return res.status(why[0]).json({ success: false, error: why[1] });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// The writer again, for a card not made yet: a failed one, or one written for another kind of model.
router.post('/mv3/video/card/:id/rewrite', (req, res) => {
  const b = req.body || {};
  let kick = '';
  try {
    const project = String(b.project || '').trim();
    const m = _cardOf(req.params.id, project, 'prompt');
    if (!m) return res.status(404).json({ success: false, error: 'no such card' });
    if (m.card.state === 'writing') return res.status(409).json({ success: false, error: 'it is being written' });
    if (m.card.state === 'sent') return res.status(409).json({ success: false, error: 'it was made - "again" makes a copy to change' });
    const rc = m.card.from ? _cardOf(m.card.from, project, 'recipe') : null;
    if (!rc) return res.status(410).json({ success: false, error: 'the recipe it was written from is not in the thread any more - fill the recipe in again' });
    const s = _settings(b);
    if (!VM.MODELS.some(x => x.id === s.model)) return res.status(400).json({ success: false, error: 'no such model: ' + s.model });
    if (_family(s.model) === 'kmc') return res.status(400).json({ success: false, error: 'Kling motion control has no writer - its box is the prompt' });
    const mm = _mediaOf(m.media);
    if (mm.error) return res.status(400).json({ success: false, error: mm.error });
    const rt = _routeOf(s.model, s.agg, s.params, mm.media, 'xxx');
    if (rt.error) return res.status(400).json({ success: false, error: rt.error });
    if (_writingIn(project) >= WRITE_AT_ONCE) return res.status(409).json({ success: false, error: WRITE_AT_ONCE + ' prompts are being written already - wait for one of them' });
    kick = 'w' + crypto.randomBytes(8).toString('hex');
    CHAT.writing.add(kick);
    const ok = CHAT.update(m.id, (x) => {
      if (!x.card || x.card.state === 'writing' || x.card.state === 'sent') return false;
      Object.assign(x.card, { state: 'writing', kick, startedAt: new Date().toISOString(), model: s.model, agg: rt.fits[0].agg, params: s.params,
                              prompt: '', error: '', edited: false, writer: '', fell: '' });
    });
    if (!ok || !ok.card || ok.card.kick !== kick) { CHAT.writing.delete(kick); return res.status(409).json({ success: false, error: 'it changed meanwhile' }); }
    res.json({ success: true, card: m.id });
    _writeCard(m.id, kick, { model: s.model, filled: rc.card.filled, body: rc.card.body, media: mm.media, params: s.params, max: rt.fits[0].promptMax });
  } catch (err) {
    if (kick) CHAT.writing.delete(kick);
    console.error('[mv3-video/rewrite]', err.message);
    if (!res.headersSent) res.status(500).json({ success: false, error: err.message });
  }
});

// The references a prompt names must be attached: "{{image:3}}" with two pictures is refused before the money.
function _refsWrong(prompt, media) {
  const have = { image: 0, video: 0, audio: 0 };
  for (const m of media) if (have[m.kind] != null) have[m.kind]++;
  const word = { image: 'picture', video: 'clip', audio: 'sound' };
  for (const [, k, n] of _strictRefs(prompt).matchAll(/\{\{(image|video|audio):(\d+)\}\}/g)) {
    if (+n < 1 || +n > have[k]) return 'the prompt names ' + word[k] + ' ' + n + ', and ' + (have[k] ? 'only ' + have[k] + (have[k] === 1 ? ' is' : ' are') : 'none is') + ' attached';
  }
  return '';
}

// A short name for what a card makes - the Alerts row and the shelf say it: the first place the person changed,
// else the recipe's title.
function _saidOf(rc, prompt) {
  const gaps = [...String((rc && rc.card && rc.card.head) || '').matchAll(GAP)].map(g => g[1]);
  const vals = ((rc && rc.card && rc.card.values) || []).map((v, i) => (gaps[i] != null && _isSize(gaps[i]) ? '' : String(v || '').trim())).filter(Boolean);
  const title = rc && rc.card && rc.card.recipe ? rc.card.recipe.title : '';
  return (vals[0] || title || String(prompt || '')).replace(/\s+/g, ' ').slice(0, 200);
}

// The video from a card: what it says now (the person's edit), the settings of the column, the attachments it was
// written with. The records and their rows at the press - the card is made, in the same tick - and the asking behind.
router.post('/mv3/video/card/:id/make', (req, res) => {
  const b = req.body || {};
  let kick = '';
  const ids = [];
  try {
    const project = String(b.project || '').trim();
    const m = _cardOf(req.params.id, project, 'prompt');
    if (!m) return res.status(404).json({ success: false, error: 'no such card' });
    if (m.card.state === 'writing') return res.status(409).json({ success: false, error: 'the prompt is still being written' });
    if (m.card.state === 'sent') return res.status(409).json({ success: false, error: 'it was made already - "again" makes another' });
    if (m.card.state !== 'ready') return res.status(409).json({ success: false, error: 'the prompt was not written - write it again' });
    const prompt = _strictRefs(String(b.prompt == null ? m.card.prompt : b.prompt).replace(/\r\n/g, '\n')).trim().slice(0, 30000);
    if (!prompt) return res.status(400).json({ success: false, error: 'the prompt is empty' });
    const s = _settings(Object.assign({ model: m.card.model, params: m.card.params, agg: m.card.agg }, b));
    if (!VM.MODELS.some(x => x.id === s.model)) return res.status(400).json({ success: false, error: 'no such model: ' + s.model });
    if (_family(s.model) !== _family(m.card.model)) {
      return res.status(400).json({ success: false, error: 'this prompt was written for ' + _labelOf(m.card.model) + ' - write it again for ' + _labelOf(s.model) });
    }
    const mm = _mediaOf(m.media);
    if (mm.error) return res.status(400).json({ success: false, error: mm.error });
    const wrong = _refsWrong(prompt, mm.media);
    if (wrong) return res.status(400).json({ success: false, error: wrong });
    const rt = _routeOf(s.model, s.agg, s.params, mm.media, prompt);
    if (rt.error) return res.status(400).json({ success: false, error: rt.error });
    if (VGENS.runningSends(project) >= AT_ONCE) {
      return res.status(409).json({ success: false, error: AT_ONCE + ' messages are being made already - wait for one of them' });
    }
    const n = COUNTS.includes(+b.n) ? +b.n : 1;
    // The 中文 box (phase V6, PLAN V-I): only where the model reads Chinese - Seedance; Grok and Kling read English.
    const zh = !!b.zh && ((VM.MODELS.find(x => x.id === s.model) || {}).langs || []).includes('zh');
    const rc = m.card.from ? _cardOf(m.card.from, project, 'recipe') : null;
    const recipe = m.card.recipe || (rc && rc.card.recipe) || null;
    const skill = recipe ? Object.assign({}, recipe, { text: (rc && rc.card.body) || '' }) : null;
    const said = _saidOf(rc, prompt);
    const where = (b.where && typeof b.where === 'object') ? b.where : {
      page: 'merge', href: '/merge?p=' + encodeURIComponent(project) + '&open=videos',
      label: 'Merge · ' + (_titleOf(project) || 'project') + ' · videos', spot: { key: project, view: 'videos' },
    };
    kick = 'k' + crypto.randomBytes(8).toString('hex');
    VGENS.asking.add(kick);
    for (let i = 0; i < n; i++) {
      ids.push(VGENS.create({
        project, send: m.id, kick, where, stage: zh ? 'translating the prompt to Chinese' : 'asking ' + rt.fits[0].aggLabel,
        model: s.model, agg: rt.fits[0].agg, prompt, said, params: s.params, media: mm.media, skill, ready: true, zh,
      }).id);
    }
    CHAT.update(m.id, (x) => {
      Object.assign(x.card, { state: 'sent', prompt, model: s.model, agg: rt.fits[0].agg, params: s.params,
                              sent: { at: new Date().toISOString(), n, zh } });
      x.genId = ids[0];
      x.genIds = ids;
    });
    res.json({ success: true, card: m.id, genIds: ids, agg: rt.fits[0].agg });
    _make({ ids, kick, prompt, writer: m.card.writer || '', zh, max: Math.min(...rt.fits.map(p => p.promptMax || 30000)) });
  } catch (err) {
    // What was made before the break is failed in its own words - nothing of it was asked for.
    for (const id of ids) VGENS.abandon(id, kick, err);
    if (kick) VGENS.asking.delete(kick);
    console.error('[mv3-video/make]', err.message);
    if (!res.headersSent) res.status(500).json({ success: false, error: err.message });
  }
});

// Behind the answer: the prompt into Chinese when the box was ticked - once for every clip; what is not translated
// whole goes in English, and the record says why -, then every clip of the card asked for, each on its own.
async function _make(o) {
  try {
    const over = { prompt: o.prompt, writer: o.writer, lang: 'en' };
    if (o.zh) {
      if (!o.ids.some(id => VGENS.ours(id, o.kick))) return;
      let tr;
      try { tr = await AGENT.toChinese(o.prompt); } catch (e) { tr = { fail: e.message }; }
      if (tr.text && tr.text.length > o.max) tr = { fail: 'the Chinese is longer than the model takes (' + tr.text.length + ' > ' + o.max + ')' };
      if (tr.text) Object.assign(over, { sent: tr.text, lang: 'zh' });
      else over.fell = 'sent in English - ' + String(tr.fail || 'it was not translated').slice(0, 200);
    }
    const done = await Promise.allSettled(o.ids.map(id => VGENS.submit(id, over, o.kick)));
    done.forEach((r, i) => { if (r.status === 'rejected') { console.warn('[mv3-video] make:', r.reason && r.reason.message); VGENS.abandon(o.ids[i], o.kick, r.reason); } });
  } catch (err) {
    console.warn('[mv3-video] make:', err.message);
    for (const id of o.ids) VGENS.abandon(id, o.kick, err);
  } finally {
    VGENS.asking.delete(o.kick);
  }
}

// A made card's prompt in a new card, ready to change and make again - the made one stays what was sent.
router.post('/mv3/video/card/:id/again', (req, res) => {
  const b = req.body || {};
  try {
    const project = String(b.project || '').trim();
    const m = _cardOf(req.params.id, project, 'prompt');
    if (!m) return res.status(404).json({ success: false, error: 'no such card' });
    if (m.card.state !== 'sent') return res.status(409).json({ success: false, error: 'it is not made yet - make it, or edit it as it is' });
    const pc = CHAT.add({ project, kind: KIND, role: 'agent', text: '', refs: m.refs || [], media: m.media || [],
                          card: { type: 'prompt', state: 'ready', from: m.card.from || '', copyOf: m.id, recipe: m.card.recipe,
                                  model: m.card.model, agg: m.card.agg, params: m.card.params, prompt: m.card.prompt,
                                  writer: m.card.writer || '', edited: !!m.card.edited } });
    res.json({ success: true, card: pc.id });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

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
