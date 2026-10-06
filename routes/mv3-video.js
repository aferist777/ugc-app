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
//   POST  /api/mv3/video/card/:id/board     (phase V8) a two-step card's STORYBOARD: a picture of the pictures chat's
//                                           store (nano-banana-2, 4K) with its Alerts row, at the press
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
const GENS = require('../lib/mv3-gens');
const CHAT = require('../lib/mv3-chat');
const AGENT = require('../lib/mv3-agent');
const VR = require('../lib/mv3-video-rules');
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
  try { res.json(Object.assign({ success: true }, VM.matrix(), { board: _boardInfo() })); }
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
    // (phase V7) A clip or a sound goes as the part the person chose: its start and end come with it, and the part is
    // checked against the file itself when it is prepared - before the money (lib/video-prep.js).
    if (media[i].kind !== 'image') {
      const m = media[i];
      if (!(m.in >= 0 && m.out > m.in && m.out <= 3600)) {
        return { error: (m.kind === 'video' ? 'a clip' : 'a sound') + ' came without the part of it to send - attach it again' };
      }
    }
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
    // Kling motion control's box IS its prompt (phase V7.3): an empty one sends the standard prompt, said as the turn.
    const text = String(b.text || '').trim().slice(0, 30000) || (isMC ? VM.STANDARD_MC_PROMPT : '');
    if (!text) return res.status(400).json({ success: false, error: 'say what to make' });
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
      const picUrls = await _writerSees(o.media, 'send');
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

// ── The storyboard (phase V8, PLAN V-G; the owner 2026-10-06: 4K, and always a stop after it) ──────────────────
// A two-step recipe draws a STORYBOARD SHEET first - a picture of the pictures chat (lib/mv3-gens.js: its record, its
// Alerts row of type 'picture', filed on Images in the project's category) - and the video is made from it: the
// sheet chosen on the card goes as the LAST picture of the clip, after the card's own.
const BOARD_ENGINE = 'nano-banana-2';
const BOARD_QUALITY = '4K';
const BOARD_AT_ONCE = CHAT.BOARD_AT_ONCE;
function _boardInfo() {
  const MV = require('../lib/mv3-img');
  const e = MV.ENGINES[BOARD_ENGINE];
  if (!e) return null;
  return {
    engine: BOARD_ENGINE, label: e.label, quality: BOARD_QUALITY,
    providers: MV.PROVIDER_ORDER.filter(p => e.providers[p]).map(p => ({
      agg: p, label: MV.PROVIDER_LABELS[p], usable: VM.usable(p), why: VM.usable(p) ? '' : (KEYS.why(p) || ''),
      price: ((e.providers[p].price || {})[BOARD_QUALITY]) == null ? null : e.providers[p].price[BOARD_QUALITY],
      maxRefs: e.providers[p].maxRefs || 0,
    })),
  };
}
// Who draws it: the first aggregator in the pictures chat's order with a key that takes this many pictures.
function _boardProvider(refs) {
  const info = _boardInfo();
  if (!info) return { error: 'the storyboard engine is not in this program' };
  const ok = info.providers.find(p => p.usable && (refs ? (p.maxRefs || 1) >= refs : true));
  if (!ok) return { error: info.providers.find(p => p.usable) ? info.label + ' cannot take ' + refs + ' pictures' : (info.providers[0] && info.providers[0].why) || 'no aggregator can draw the storyboard' };
  return { provider: ok.agg, label: ok.label };
}
// The storyboard's SEAT among the video's pictures: it goes after the card's own, so the card's pictures and it must
// fit the model together - checked when the prompts are written and again before the sheet is paid for, never only
// when the video is made (nine pictures and a sheet are ten, and the sheet would be bought for a video that cannot be).
const BOARD_SEAT = { path: '(the storyboard)', kind: 'image', role: 'storyboard', label: 'storyboard', in: 0, out: 0 };
function _seatWrong(model, agg, params, media) {
  const list = media || [];
  // Only what the seat itself breaks: a route closed anyway (a key gone) is said where it matters - at the make.
  if (_routeOf(model, agg, params, list, 'xxx').error) return '';
  const rt = _routeOf(model, agg, params, list.filter(x => x.kind === 'image').concat([BOARD_SEAT], list.filter(x => x.kind !== 'image')), 'xxx');
  if (!rt.error) return '';
  const n = list.filter(x => x.kind === 'image').length;
  return 'the storyboard goes to the video as one more picture after your ' + n + ' - ' + rt.error;
}

// What a two-step card must be able to do before its writer is asked, and again before its sheet is paid for (review
// V8): no frame among its pictures (beside the sheet the model reads every picture as a reference), a link for the sheet
// (it always goes to the video as a picture - R2), a sheet that can be drawn with its pictures (nano-banana-2 takes 14),
// and the seat. '' when it can, else why in words.
const BOARD_R2 = 'the storyboard goes to the video model as a picture, from a public link - that needs R2 (Admin -> API keys)';
function _twoStepWrong(model, agg, params, media) {
  const list = media || [];
  if (list.some(x => x.kind === 'image' && /^frame-/.test(String(x.role || '')))) {
    return 'a first or last frame cannot go with a storyboard - the video follows the sheet: attach that picture as a reference';
  }
  if (!KEYS.r2() && !FAKE.on()) return BOARD_R2;
  const pv = _boardProvider(list.filter(x => x.kind === 'image').length);
  if (pv.error) return 'the storyboard cannot be drawn - ' + pv.error;
  return _seatWrong(model, agg, params, list);
}

// Whether a recipe is a two-step one is the CATALOG's to say (review V8): a draft saved before V8 carries no flag, and a
// recipe whose first step is not a storyboard - a character sheet made first - is one step here (lib/cookbook-lib.js
// twoStepOf). The page's word stands only where the catalog cannot answer.
function _twoStepOf(recipe, claimed) {
  const r = recipe || {};
  const story = (ts) => !!(ts && (ts.kind || 'storyboard') === 'storyboard');
  try {
    if (r.kind === 'example') return false;
    const VC = require('../lib/video-catalog');
    if (r.kind === 'template') {
      const t = ((VC.vendor() || {}).templates || []).find(x => x && x.id === r.id);
      if (t) return story(t.twoStep);
    }
    if (r.kind === 'case') {
      const c = (VC.index().cases || []).find(x => x && x.s === r.id);
      if (c) return !!c.ts;
    }
    if (r.kind === 'preset') {
      const p = require('../lib/video-presets-store').get(r.id);
      if (p) return story(p.twoStep);
    }
  } catch (e) { /* the catalog cannot answer */ }
  return !!claimed;
}

// The storyboard prompt goes to a PICTURE model, which reads references as words (review V8): the card's pictures,
// {{image:N}}, become "Image N" (the way lib/mv3-prompt-rules.js has them named); what a picture model cannot see - the
// sheet itself, a clip, a sound - goes.
function _boardWords(prompt, pics) {
  return String(prompt || '').replace(REF_ANY, (all, k, n) => (k.toLowerCase() === 'image' && +n >= 1 && +n <= pics ? 'Image ' + (+n) : ''))
    .replace(/[ \t]{2,}/g, ' ').replace(/ +([.,;:])/g, '$1').trim();
}
// The video prompt of a two-step card names its sheet - the picture after the card's own.
const _namesSheet = (prompt, k) => _strictRefs(prompt).includes('{{image:' + k + '}}');

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
// What the WRITER sees: the pictures, made small (review V6), then THREE FRAMES of every clip - the start, the middle
// and the end of its part - in the order the clips are listed (phase V7; lib/mv3-video-rules.js listing says so). What
// cannot be hosted is left out with a warning: the writer works from the words then, as before.
async function _writerSees(media, why) {
  const list = Array.isArray(media) ? media : [];
  const pics = list.filter(m => m.kind === 'image').map(m => m.path);
  let urls = [];
  if (pics.length) {
    try { urls = await _hostForWriter(pics); }
    catch (e) { console.warn('[mv3-video] ' + why + ': the writer will not see the pictures -', e.message); return []; }
  }
  for (const m of list.filter(x => x.kind === 'video')) {
    try {
      if (FAKE.on()) { urls.push(FAKE.host(m.path), FAKE.host(m.path), FAKE.host(m.path)); continue; }
      const abs = toDiskExisting(m.path);
      const bufs = await require('../lib/video-prep').frames(abs, { from: m.in, to: m.out });
      for (const b of bufs) urls.push(await require('../lib/helpers').uploadToPublicHost(b, { ext: 'jpg', verify: true }));
    } catch (e) { console.warn('[mv3-video] ' + why + ': the writer will not see a clip -', e.message); }
  }
  return urls;
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
    const picUrls = await _writerSees(o.media, 'write');
    const t = await AGENT.thinkVideo({ model: o.model, text: o.filled, media: o.media, picUrls, thread: [],
                                       skill: { text: o.body }, params: o.params, max: o.max, recipe: true, twoStep: !!o.twoStep });
    out = t.prompt ? { state: 'ready', prompt: _strictRefs(t.prompt), writer: t.writer || '', fell: t.fell || '', error: '', edited: false }
      : { state: 'failed', error: t.fail || 'the writer answered nothing usable - write it again' };
    if (t.prompt && o.twoStep) {
      const pics = o.media.filter(m => m.kind === 'image').length;
      const k = pics + 1;
      // The video follows its sheet (review V8): a prompt that does not name it gets the sentence that does, and one
      // that names a picture the video will not have fails here - before the sheet is paid for, not at the make.
      if (!_namesSheet(out.prompt, k)) out.prompt = (out.prompt + ' Follow the storyboard {{image:' + k + '}} panel by panel, from the first panel to the last.').trim();
      const wrong = _refsWrong(out.prompt, o.media.concat([BOARD_SEAT]));
      if (wrong) out = { state: 'failed', error: 'the writer wrote a prompt that ' + wrong.replace(/^the prompt /, '') + ' (the storyboard is picture ' + k + ') - write it again' };
      else {
        out.boardPrompt = _boardWords(t.board, pics);
        out.boardAspect = t.boardAspect || (VR.BOARD_ASPECTS.includes((o.params || {}).aspect) ? o.params.aspect : '16:9');
      }
    }
  } catch (e) {
    out = { state: 'failed', error: 'the writer broke off: ' + String(e.message || e).slice(0, 300) };
  }
  try {
    CHAT.update(cardId, (m) => {
      if (!m.card || m.card.kick !== kick || m.card.state !== 'writing') return false;
      const { boardPrompt, boardAspect, ...rest } = out;
      Object.assign(m.card, rest);
      if (m.card.board && boardPrompt != null) Object.assign(m.card.board, { prompt: boardPrompt, aspect: boardAspect, edited: false });
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
    const twoStep = _twoStepOf(b.recipe, b.twoStep);
    if (twoStep && _family(s.model) !== 'seedance') return res.status(400).json({ success: false, error: 'a two-step recipe is made by Seedance - its video takes the storyboard with your pictures' });
    const head = String(b.head || '').replace(/\r\n/g, '\n').trim().slice(0, 4000);
    if (!head) return res.status(400).json({ success: false, error: 'the recipe has no request to fill in' });
    const body = String(b.body || '').replace(/\r\n/g, '\n').trim().slice(0, 20000);
    const values = (Array.isArray(b.values) ? b.values : []).slice(0, 24).map(v => (v == null ? null : String(v).slice(0, 2000)));
    const filled = _fill(head, values).slice(0, 8000);
    const mm = _mediaOf(b.media);
    if (mm.error) return res.status(400).json({ success: false, error: mm.error });
    const rt = _routeOf(s.model, s.agg, s.params, mm.media, 'xxx');
    if (rt.error) return res.status(400).json({ success: false, error: rt.error });
    const seat = twoStep ? _twoStepWrong(s.model, s.agg, s.params, mm.media) : '';
    if (seat) return res.status(400).json({ success: false, error: seat });
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
                                  model: s.model, agg: rt.fits[0].agg, params: s.params,
                                  board: twoStep ? { prompt: '', aspect: '', genIds: [], chosen: '' } : undefined } });
    res.json({ success: true, recipe: rc.id, card: pc.id });
    _writeCard(pc.id, kick, { model: s.model, filled, body, media: mm.media, params: s.params, max: rt.fits[0].promptMax, twoStep });
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
    const prompt = b.prompt == null ? null : _strictRefs(String(b.prompt).replace(/\r\n/g, '\n')).slice(0, 30000);
    const board = b.board == null ? null : String(b.board).replace(/\r\n/g, '\n').slice(0, 6000);
    const chosen = b.chosen == null ? null : String(b.chosen);
    let why = null;
    const m = CHAT.update(req.params.id, (x) => {
      if (String(x.project || '') !== project || !x.card || x.card.type !== 'prompt') { why = [404, 'no such card']; return false; }
      // Written - waiting, or made and edited for the next make (the owner, 2026-10-06).
      if (x.card.state !== 'ready' && x.card.state !== 'sent') { why = [409, 'it is not written yet']; return false; }
      let changed = false;
      if (prompt != null && x.card.prompt !== prompt) { x.card.prompt = prompt; x.card.edited = true; changed = true; }
      if (x.card.board && board != null && x.card.board.prompt !== board) { x.card.board.prompt = board; x.card.board.edited = true; changed = true; }
      // Only a sheet of this card that has landed and is still on the shelf can be chosen (review V8).
      if (x.card.board && chosen != null && x.card.board.chosen !== chosen) {
        const g = CHAT.boardsOf(x).find(y => y.id === chosen);
        if (!g) { why = [404, 'no such storyboard on this card']; return false; }
        if (!CHAT.boardReady(g)) { why = [409, g.gone ? 'that storyboard is not on the Images shelf any more' : 'only a storyboard that has landed can be chosen']; return false; }
        x.card.board.chosen = chosen;
        changed = true;
      }
      if (!changed) return false;
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
    const rc = m.card.from ? _cardOf(m.card.from, project, 'recipe') : null;
    if (!rc) return res.status(410).json({ success: false, error: 'the recipe it was written from is not in the thread any more - fill the recipe in again' });
    const s = _settings(b);
    if (!VM.MODELS.some(x => x.id === s.model)) return res.status(400).json({ success: false, error: 'no such model: ' + s.model });
    if (_family(s.model) === 'kmc') return res.status(400).json({ success: false, error: 'Kling motion control has no writer - its box is the prompt' });
    if (m.card.board && _family(s.model) !== 'seedance') return res.status(400).json({ success: false, error: 'a two-step recipe is made by Seedance - pick a Seedance model' });
    const mm = _mediaOf(m.media);
    if (mm.error) return res.status(400).json({ success: false, error: mm.error });
    const rt = _routeOf(s.model, s.agg, s.params, mm.media, 'xxx');
    if (rt.error) return res.status(400).json({ success: false, error: rt.error });
    const seat = m.card.board ? _twoStepWrong(s.model, s.agg, s.params, mm.media) : '';
    if (seat) return res.status(400).json({ success: false, error: seat });
    if (_writingIn(project) >= WRITE_AT_ONCE) return res.status(409).json({ success: false, error: WRITE_AT_ONCE + ' prompts are being written already - wait for one of them' });
    kick = 'w' + crypto.randomBytes(8).toString('hex');
    CHAT.writing.add(kick);
    const ok = CHAT.update(m.id, (x) => {
      if (!x.card || x.card.state === 'writing') return false;
      Object.assign(x.card, { state: 'writing', kick, startedAt: new Date().toISOString(), model: s.model, agg: rt.fits[0].agg, params: s.params,
                              prompt: '', error: '', edited: false, writer: '', fell: '' });
      // Its sheets stay on the card, none chosen: the new prompts may be for another sheet (review V8).
      if (x.card.board) x.card.board.chosen = '';
    });
    if (!ok || !ok.card || ok.card.kick !== kick) { CHAT.writing.delete(kick); return res.status(409).json({ success: false, error: 'it changed meanwhile' }); }
    res.json({ success: true, card: m.id });
    _writeCard(m.id, kick, { model: s.model, filled: rc.card.filled, body: rc.card.body, media: mm.media, params: s.params, max: rt.fits[0].promptMax,
                             twoStep: !!m.card.board });
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
    // A made card is made again from its own field (the owner, 2026-10-06): another attempt of the same card.
    if (m.card.state !== 'ready' && m.card.state !== 'sent') return res.status(409).json({ success: false, error: 'the prompt was not written - write it again' });
    const prompt = _strictRefs(String(b.prompt == null ? m.card.prompt : b.prompt).replace(/\r\n/g, '\n')).trim().slice(0, 30000);
    if (!prompt) return res.status(400).json({ success: false, error: 'the prompt is empty' });
    const s = _settings(Object.assign({ model: m.card.model, params: m.card.params, agg: m.card.agg }, b));
    if (!VM.MODELS.some(x => x.id === s.model)) return res.status(400).json({ success: false, error: 'no such model: ' + s.model });
    if (_family(s.model) !== _family(m.card.model)) {
      return res.status(400).json({ success: false, error: 'this prompt was written for ' + _labelOf(m.card.model) + ' - write it again for ' + _labelOf(s.model) });
    }
    const mm = _mediaOf(m.media);
    if (mm.error) return res.status(400).json({ success: false, error: mm.error });
    let boardId = '';
    if (m.card.board) {
      // The sheet the video follows: the one the page sends, else the card's chosen one while it can be followed, else
      // the newest that landed and is still on the shelf (review V8).
      const boards = CHAT.boardsOf(m);
      const want = String(b.boardId || '');
      let g = null;
      if (want) {
        g = boards.find(x => x.id === want);
        if (!g) return res.status(409).json({ success: false, error: 'that storyboard is not this card\'s - choose one of its own' });
        if (g.gone) return res.status(409).json({ success: false, error: 'that storyboard is not on the Images shelf any more - choose another, or draw one' });
        if (!CHAT.boardReady(g)) return res.status(409).json({ success: false, error: 'that storyboard is not ready' });
      } else {
        const ready = boards.filter(CHAT.boardReady);
        g = ready.find(x => x.id === m.card.board.chosen) || ready[ready.length - 1] || null;
        if (!g) {
          return res.status(409).json({ success: false, error: boards.some(x => x.state === 'pending')
            ? 'the storyboard is still being drawn - the video follows it' : 'make the storyboard first - the video follows it' });
        }
      }
      boardId = g.id;
      // The sheet is one more picture - said as such when the column's model takes fewer than the card was written for.
      const seat = _seatWrong(s.model, s.agg, s.params, mm.media);
      if (seat) return res.status(400).json({ success: false, error: seat });
      const pics = mm.media.filter(x => x.kind === 'image');
      if (!_namesSheet(prompt, pics.length + 1)) {
        return res.status(400).json({ success: false, error: 'the video prompt does not name the storyboard - it is [picture ' + (pics.length + 1) + ']: put it where the clip should follow the sheet' });
      }
      // In its own words: a sheet gone from the shelf, or no R2 to send it by.
      const sb = _mediaOf([{ path: g.imagePath, kind: 'image', role: 'storyboard', label: 'storyboard' }]);
      if (sb.error) return res.status(400).json({ success: false, error: /R2/.test(sb.error) ? BOARD_R2 : 'the storyboard is not on the Images shelf any more - choose another, or draw one' });
      mm.media = pics.concat(sb.media, mm.media.filter(x => x.kind !== 'image'));
    }
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
    // The attempts the card had - an old card made before attempts were kept counts its clips as the first.
    const _was = (x) => (Array.isArray(x.card.sends) ? x.card.sends : ((x.genIds || []).length
      ? [{ at: (x.card.sent && x.card.sent.at) || '', n: (x.card.sent && x.card.sent.n) || x.genIds.length, zh: !!(x.card.sent && x.card.sent.zh),
           boardId: (x.card.board && x.card.board.chosen) || '', genIds: x.genIds.slice(0, 4) }] : []));
    const part = String(_was(m).length + 1);
    kick = 'k' + crypto.randomBytes(8).toString('hex');
    VGENS.asking.add(kick);
    for (let i = 0; i < n; i++) {
      ids.push(VGENS.create({
        project, send: m.id, part, kick, where, stage: zh ? 'translating the prompt to Chinese' : 'asking ' + rt.fits[0].aggLabel,
        model: s.model, agg: rt.fits[0].agg, prompt, said, params: s.params, media: mm.media, skill, ready: true, zh,
      }).id);
    }
    CHAT.update(m.id, (x) => {
      const at = new Date().toISOString();
      Object.assign(x.card, { state: 'sent', prompt, model: s.model, agg: rt.fits[0].agg, params: s.params, sent: { at, n, zh },
                              sends: _was(x).concat([{ at, n, zh, boardId, genIds: ids }]) });
      if (x.card.board && boardId) x.card.board.chosen = boardId;
      x.genIds = (x.genIds || []).concat(ids).slice(-40);
      x.genId = x.genIds[0];
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

// A two-step card's storyboard: a picture record and its row at the press (no writer - its prompt is on the card),
// the drawing behind the answer. Another press draws another; the card chooses which one the video follows.
router.post('/mv3/video/card/:id/board', (req, res) => {
  const b = req.body || {};
  let kick = '';
  try {
    const project = String(b.project || '').trim();
    const m = _cardOf(req.params.id, project, 'prompt');
    if (!m) return res.status(404).json({ success: false, error: 'no such card' });
    if (!m.card.board) return res.status(400).json({ success: false, error: 'this card has no storyboard' });
    if (m.card.state === 'writing') return res.status(409).json({ success: false, error: 'the prompts are still being written' });
    if (m.card.state === 'failed') return res.status(409).json({ success: false, error: 'the prompts were not written - write them again' });
    // A made card draws too: it is made again from its field, and another sheet may be what the next attempt follows.
    const typed = String(b.board != null ? b.board : m.card.board.prompt).replace(/\r\n/g, '\n').trim().slice(0, 6000);
    if (!typed) return res.status(400).json({ success: false, error: 'the storyboard prompt is empty' });
    const all = _mediaOf(m.media);
    if (all.error) return res.status(400).json({ success: false, error: all.error });
    const pics = all.media.filter(x => x.kind === 'image');
    // The video it is for must be able to take it, send it and follow it - before the sheet is paid for.
    const seat = _twoStepWrong(m.card.model, m.card.agg, m.card.params || {}, all.media);
    if (seat) return res.status(400).json({ success: false, error: seat });
    // What the picture model reads: the references in words (the card keeps what was typed).
    const prompt = _boardWords(typed, pics.length);
    if (!prompt) return res.status(400).json({ success: false, error: 'the storyboard prompt is empty' });
    const pv = _boardProvider(pics.length);
    if (pv.error) return res.status(400).json({ success: false, error: pv.error });
    const making = CHAT.boardsOf(m).filter(g => g.state === 'pending').length;
    if (making >= BOARD_AT_ONCE) return res.status(409).json({ success: false, error: BOARD_AT_ONCE + ' storyboards are being drawn already - wait for one' });
    const w0 = (b.where && typeof b.where === 'object') ? b.where : {
      page: 'merge', href: '/merge?p=' + encodeURIComponent(project) + '&open=videos',
      label: 'Merge · ' + (_titleOf(project) || 'project') + ' · videos', spot: { key: project, view: 'videos' },
    };
    // Its row, once drawn, leads back to the card - the video is chosen and made there - not to the picture on its
    // shelf, where a picture of the chats is shown (js/alerts-bell.js reveals only 'pictures' and 'videos').
    const where = Object.assign({}, w0, { spot: Object.assign({}, w0.spot || {}, { view: 'storyboard' }) });
    const title = (m.card.recipe && m.card.recipe.title) || 'video';
    kick = 'b' + crypto.randomBytes(8).toString('hex');
    GENS.asking.add(kick);
    const g = GENS.create({
      project, send: m.id, board: true, kick, where, stage: 'asking ' + pv.label, prompt, said: 'storyboard · ' + title,
      engine: BOARD_ENGINE, provider: pv.provider, quality: BOARD_QUALITY, aspect: m.card.board.aspect || '16:9',
      refs: pics.map(x => x.path),
    });
    CHAT.update(m.id, (x) => {
      if (!x.card || !x.card.board) return false;
      x.card.board.genIds = (x.card.board.genIds || []).concat([g.id]).slice(-20);
      if (x.card.board.prompt !== typed) { x.card.board.prompt = typed; x.card.board.edited = true; }
    });
    res.json({ success: true, genId: g.id, provider: pv.provider });
    (async () => {
      try { await GENS.submit(g.id, { prompt }, kick); }
      catch (e) { console.warn('[mv3-video] storyboard:', e.message); }
      finally { GENS.asking.delete(kick); }
    })();
  } catch (err) {
    if (kick) GENS.asking.delete(kick);
    console.error('[mv3-video/board]', err.message);
    if (!res.headersSent) res.status(500).json({ success: false, error: err.message });
  }
});

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
                                  writer: m.card.writer || '', edited: !!m.card.edited,
                                  // Its storyboards go with it - those asked for again from Alerts too.
                                  board: m.card.board ? Object.assign({}, m.card.board, { genIds: CHAT.boardsOf(m).map(g => g.id).slice(-20) }) : undefined } });
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
    // A file with no picture is no clip (phase V7: a sound has its own door, onto Sounds).
    const dim = await require('../lib/media-probe').probe(req.file.path).catch(() => ({}));
    if (!(dim.w > 0)) {
      try { fs.unlinkSync(req.file.path); } catch (er) { /* gone */ }
      return res.status(400).json({ success: false, error: 'it has no picture in it' + (dim.audio ? ' - a sound goes in among the sounds' : '') });
    }
    const { item } = await require('../lib/birols-store').add('/media/work/' + req.file.filename, {
      kind: 'uploads',
      name: String(b.name || '').trim().slice(0, 120) || path.basename(req.file.originalname),
      categoryLabel: VGENS.catLabelFor(_titleOf(String(b.project || ''))),
    });
    res.json({ success: true, item });
  } catch (e) {
    // Not filed: nothing of it stays in media/work (a file that was placed already has moved - ENOENT here).
    try { fs.unlinkSync(req.file.path); } catch (er) { /* gone or moved */ }
    res.status(500).json({ success: false, error: e.message });
  }
});

router.use('/mv3/video/upload', (err, _req, res, _next) => {
  res.status(400).json({ success: false, error: (err && err.message) || 'upload failed' });
});

// ── A sound from this computer (phase V7) ───────────────────────────────────
// Onto the Sounds shelf (lib/sounds-store.js): from the video chat into the project's category, from the Library into
// the category open there (`categoryId`), else none.
const SOUND_EXTS = ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.oga', '.flac', '.opus', '.webm'];
const _uploadSound = multer({
  storage: multer.diskStorage({
    destination: (_q, _f, cb) => { try { fs.mkdirSync(MEDIA.work, { recursive: true }); } catch (e) { /* exists */ } cb(null, MEDIA.work); },
    filename: (_q, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, 'snd_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex') + (SOUND_EXTS.includes(ext) ? ext : '.mp3'));
    },
  }),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (_q, file, cb) => cb(null, /^audio\//.test(file.mimetype) || SOUND_EXTS.includes(path.extname(file.originalname).toLowerCase())),
});

router.post('/sounds/upload', _uploadSound.single('sound'), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: 'no sound - mp3, wav, m4a, aac, ogg, flac or opus' });
  const b = req.body || {};
  try {
    const project = String(b.project || '');
    const { item } = await require('../lib/sounds-store').add('/media/work/' + req.file.filename, {
      name: String(b.name || '').trim().slice(0, 120) || path.basename(req.file.originalname).replace(/\.[^.]+$/, ''),
      categoryId: String(b.categoryId || ''),
      categoryLabel: project ? VGENS.catLabelFor(_titleOf(project)) : '',
      source: 'upload',
    });
    res.json({ success: true, item });
  } catch (e) {
    // Not filed: nothing of it stays in media/work (a file that was placed already has moved - ENOENT here).
    try { fs.unlinkSync(req.file.path); } catch (er) { /* gone or moved */ }
    res.status(400).json({ success: false, error: e.message });
  }
});

router.use('/sounds/upload', (err, _req, res, _next) => {
  res.status(400).json({ success: false, error: (err && err.message) || 'upload failed' });
});

module.exports = router;
