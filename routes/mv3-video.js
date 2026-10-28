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
// The thread itself is GET /api/mv3/chat?kind=clip (routes/mv3-img.js) - 'clip', not 'video': old libraries
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
  try { res.json(Object.assign({ success: true }, VM.matrix(), { board: _boardInfo(), frame: _boardInfo(FRAME_QUALITY) })); }
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
    if (!abs || !fs.existsSync(abs)) return { error: 'attachment ' + (i + 1) + (media[i].label ? ' («' + media[i].label + '»)' : '') + ' is not in this library' };
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

router.post('/mv3/video/send', async (req, res) => {
  const b = req.body || {};
  let kick = '';
  try {
    const project = String(b.project || '').trim();
    if (!project) return res.status(400).json({ success: false, error: 'open a project first' });
    const model = String(b.model || '');
    if (!VM.MODELS.some(m => m.id === model)) return res.status(400).json({ success: false, error: 'no such model: ' + model });
    const isMC = /^kmc/.test(model);
    // Kling motion control's box IS its prompt (phase V7.3): an empty one sends the standard prompt, said as the turn.
    // (phase V17) With the writer on it holds the person's words for the first frame - empty is fine.
    const mcSteps = isMC && b.write !== false;
    const text = String(b.text || '').trim().slice(0, 30000) || (isMC && !mcSteps ? VM.STANDARD_MC_PROMPT : '');
    const review = !!b.review && !isMC && b.write !== false && !b.storyboard;
    const params = (b.params && typeof b.params === 'object') ? b.params : {};
    const n = COUNTS.includes(+b.n) ? +b.n : 1;
    // A catalog's skill is the writer's recipe: none with the pen off, nor for Kling motion control - its video has no
    // writer, and its first frame's writer (V17) follows the person's words, not a recipe.
    const skill = (isMC || b.write === false) ? null : _skill(b.skill);
    // (phase V29, the owner 2026-10-14) No 中文 any more: every prompt goes in English (the column's box of V15 went).

    // What is attached, each checked to be in the library; who can take it.
    const mm = _mediaOf(b.media);
    if (mm.error) return res.status(400).json({ success: false, error: mm.error });
    const media = mm.media;
    // (phase V16) Seedance's frames: every picture a frame, the first one there.
    const fr = isMC ? null : _framesOf(model, media);
    if (fr && fr.error) return res.status(400).json({ success: false, error: fr.error });
    // (phase V16, the owner's answer 3) The writer stopping for a look makes a clip from the attachments alone, and so does
    // the storyboard's; frames are written from even with the writer off.
    const fromAtts = media.length > 0 && (mcSteps || (!isMC && ((b.write !== false && (review || !!b.storyboard)) || !!fr)));
    if (!text && !fromAtts) return res.status(400).json({ success: false, error: 'say what to make' });
    // (phase V17, the owner 2026-10-08) Kling motion control STEP BY STEP: the person's pictures and a still of the clip go
    // to the writer, which writes the first frame's picture prompt into a message of its own; nothing is paid here - the
    // picture is drawn by its press, and the video made from it by another (the owner's answer 2).
    if (mcSteps) {
      const wrong = _frameWrong(model, b.agg, params, media);
      if (wrong) return res.status(400).json({ success: false, error: wrong });
      const clip = media.find(x => x.kind === 'video');
      const pics = media.filter(x => x.kind === 'image');
      const rt0 = _routeOf(model, b.agg, params, [pics[0], clip], 'xxx');
      const fw0 = await _filesWrong(rt0.fits[0], [clip]);
      if (fw0) return res.status(400).json({ success: false, error: fw0 });
      if (_writingIn(project) >= WRITE_AT_ONCE) return res.status(409).json({ success: false, error: WRITE_AT_ONCE + ' prompts are being written already - wait for one of them' });
      // The clip's whole length (the message's slider runs over it) and the shape it is seen in (the picture's).
      let clipDur = 0, shape = '9:16';
      try {
        const pr = await require('../lib/media-probe').probe(toDiskExisting(clip.path));
        clipDur = Math.round((+pr.duration || 0) * 100) / 100;
        const seen = require('../lib/video-prep').seen(pr);
        shape = _shapeOf(seen.w, seen.h);
      } catch (e) { /* the default shape; the slider stays within the part */ }
      const turn = CHAT.add({ project, kind: KIND, role: 'user', text, refs: media.map(m => m.path), media });
      const kickF = 'w' + crypto.randomBytes(8).toString('hex');
      CHAT.writing.add(kickF);
      let card;
      try {
        card = CHAT.add({ project, kind: KIND, role: 'agent', text: '', refs: media.map(m => m.path), media,
                          card: { type: 'prompt', plain: true, state: 'writing', writing: 'board', kick: kickF, startedAt: new Date().toISOString(),
                                  from: turn.id, text, model, agg: rt0.fits[0].agg, params, prompt: VM.STANDARD_MC_PROMPT, writer: '',
                                  board: { kind: 'frame', prompt: '', versions: [], at: clip.in || 0, dur: clipDur, len: Math.round(((+clip.out || 0) - (+clip.in || 0)) * 100) / 100,
                                           aspect: shape, genIds: [], chosen: '' } } });
      } catch (e) { CHAT.writing.delete(kickF); throw e; }
      res.json({ success: true, send: card.id, card: card.id, frame: true });
      _writeFrame(card.id, kickF, { text, media, at: clip.in || 0 });
      return;
    }
    const rt = _routeOf(model, b.agg, params, media, isMC ? text : 'xxx');
    if (rt.error) return res.status(400).json({ success: false, error: rt.error });
    const fits = rt.fits;
    // (review V7) What the first rung's preparation would refuse - before the writer is paid. Counted after this wait.
    const fw = await _filesWrong(fits[0], media);
    if (fw) return res.status(400).json({ success: false, error: fw });
    const sheet = media.some(m => m.kind === 'image' && m.role === 'storyboard');
    // (phase V15, the owner 2026-10-07) The column's storyboard: the writer writes the sheet's prompt from this message,
    // the sheet is drawn, and it stops there - the video is made from the storyboard's card. Seedance's and the writer's;
    // a recipe draws its own storyboard on its card.
    if (b.storyboard) {
      if (_family(model) !== 'seedance') return res.status(400).json({ success: false, error: 'a storyboard is drawn for Seedance - pick a Seedance model' });
      if (b.write === false) return res.status(400).json({ success: false, error: 'the storyboard is written by the writer - switch the writer on' });
      if (skill) return res.status(400).json({ success: false, error: 'a recipe decides its own steps - a two-step recipe draws its storyboard on its card' });
      if (sheet) return res.status(400).json({ success: false, error: 'a storyboard is among the pictures already - make the video from its card, or take it off to draw a new one' });
      const wrong = _twoStepWrong(model, b.agg, params, media);
      if (wrong) return res.status(400).json({ success: false, error: wrong });
      if (_writingIn(project) >= WRITE_AT_ONCE) return res.status(409).json({ success: false, error: WRITE_AT_ONCE + ' prompts are being written already - wait for one of them' });
      const turn = CHAT.add({ project, kind: KIND, role: 'user', text, refs: media.map(m => m.path), media });
      let st;
      try { st = _startBoard({ project, from: turn.id, text, model, agg: fits[0].agg, params, media }); }
      catch (e) { return res.status(e.status || 500).json({ success: false, error: e.message }); }
      res.json({ success: true, send: st.card.id, card: st.card.id, storyboard: true });
      _writeBoard(st.card.id, st.kick, { model, text, media, params });
      return;
    }
    // (phase V16, the owner 2026-10-07) THE WRITER STOPS FOR A LOOK: the person's turn and a prompt card, the writer behind
    // the answer, and the video made only from the card ("make the video" - /card/:id/make). With the writer off the
    // words still go as typed, one press; under Kling motion control the writer writes the first frame (above).
    if (review) {
      if (_writingIn(project) >= WRITE_AT_ONCE) return res.status(409).json({ success: false, error: WRITE_AT_ONCE + ' prompts are being written already - wait for one of them' });
      const before0 = CHAT.read(project, KIND).slice(-4).map(m => ({ role: m.role, text: m.text }));
      const turn = CHAT.add({ project, kind: KIND, role: 'user', text, refs: media.map(m => m.path), media });
      const kickW = 'w' + crypto.randomBytes(8).toString('hex');
      CHAT.writing.add(kickW);
      let card;
      try {
        card = CHAT.add({ project, kind: KIND, role: 'agent', text: '', refs: media.map(m => m.path), media,
                          card: { type: 'prompt', plain: true, state: 'writing', kick: kickW, startedAt: new Date().toISOString(),
                                  from: turn.id, text, model, agg: fits[0].agg, params, versions: [] } });
      } catch (e) { CHAT.writing.delete(kickW); throw e; }
      res.json({ success: true, send: card.id, card: card.id, review: true });
      _writePlain(card.id, kickW, { model, agg: fits[0].agg, text, media, params, max: fits[0].promptMax, before: before0 });
      return;
    }
    if (VGENS.runningSends(project) >= AT_ONCE) {
      return res.status(409).json({ success: false, error: AT_ONCE + ' messages are being made already - wait for one of them' });
    }

    const before = CHAT.read(project, KIND).slice(-4).map(m => ({ role: m.role, text: m.text }));
    const msgId = CHAT.newId();
    kick = 'k' + crypto.randomBytes(8).toString('hex');
    VGENS.asking.add(kick);
    CHAT.add({ project, kind: KIND, role: 'user', text, refs: media.map(m => m.path), media });
    // (phase V16) With the pen off the words go as typed - except beside frames, which the writer writes all the same.
    const asTyped = b.write === false && !fr;
    const first = (isMC || asTyped) ? (AGENT.english(text) ? 'asking ' + fits[0].aggLabel : 'translating the prompt') : 'writing the prompt';
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
    // (phase V18.3) The answer carries what was asked - the words and the attachments - and is drawn as the one message.
    CHAT.add({ id: msgId, project, kind: KIND, role: 'agent', text: '', genId: ids[0], genIds: ids, refs: media.map(m => m.path), asked: text, media });
    res.json({ success: true, send: msgId, genIds: ids, agg: fits[0].agg });
    // The page's pen off (b.write === false): the words go as typed - translated first when not English.
    _work({ project, text, model, isMC, asTyped, media, params, skill, ids, kick, before, pair: fits[0], frames: fr });
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
      const sees = await _writerSees(o.media, 'send');
      // (phase V16) Frames: the writer writes them with the words or without, and our opening goes before its prompt.
      const open = VR.framesOpening(o.frames);
      const t = await AGENT.thinkVideo({ model: o.model, text: o.text || (o.frames ? NO_WORDS_FRAMES : ''), media: o.media, picUrls: sees.urls, seen: sees.seen,
                                         thread: o.before, skill: o.skill, params: o.params, max: _roomFor(o.pair.promptMax, open), frames: o.frames || null });
      if (t.ask) {
        for (const id of o.ids) VGENS.refuse(id, 'the writer asked a question instead', o.kick);
        CHAT.add({ project: o.project, kind: KIND, role: 'agent', text: t.ask });
        return;
      }
      if (t.fail) { for (const id of o.ids) VGENS.refuse(id, t.fail, o.kick); return; }
      over = { prompt: o.frames ? _withOpening(t.prompt, o.frames) : t.prompt, fell: t.fell || '', writer: t.writer || '' };
      // (phase V15) A storyboard among the pictures is followed: a prompt that does not name it gets the sentence that does.
      const k = o.media.filter(m => m.kind === 'image').findIndex(m => m.role === 'storyboard') + 1;
      if (k && !_namesSheet(over.prompt, k)) over.prompt = (over.prompt + ' Follow the storyboard {{image:' + k + '}} panel by panel, from the first panel to the last.').trim();
    }
    over.lang = 'en';
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
// (phase V23) Counted on the raw thread - the whole read folded in every record just to count cards.
const _writingIn = (project) => CHAT.writingCount(project);

// ── The storyboard (phase V8, PLAN V-G; the owner 2026-10-06: 4K, and always a stop after it) ──────────────────
// A two-step recipe draws a STORYBOARD SHEET first - a picture of the pictures chat (lib/mv3-gens.js: its record, its
// Alerts row of type 'picture', filed on Images in the project's category) - and the video is made from it: the
// sheet chosen on the card goes as the LAST picture of the clip, after the card's own.
const BOARD_ENGINE = 'nano-banana-2';
const BOARD_QUALITY = '4K';
const BOARD_AT_ONCE = CHAT.BOARD_AT_ONCE;
function _boardInfo(quality) {
  const MV = require('../lib/mv3-img');
  const e = MV.ENGINES[BOARD_ENGINE];
  if (!e) return null;
  const q = quality || BOARD_QUALITY;
  return {
    engine: BOARD_ENGINE, label: e.label, quality: q,
    providers: MV.PROVIDER_ORDER.filter(p => e.providers[p]).map(p => ({
      agg: p, label: MV.PROVIDER_LABELS[p], usable: VM.usable(p), why: VM.usable(p) ? '' : (KEYS.why(p) || ''),
      price: ((e.providers[p].price || {})[q]) == null ? null : e.providers[p].price[q],
      maxRefs: e.providers[p].maxRefs || 0,
    })),
  };
}

// ── Kling motion control's FIRST FRAME (phase V7.6 as a recipe; the chat's own way since V17, the owner 2026-10-08) ──
// 1 · a PICTURE - a frame of the clip redrawn with the person's character in the pose there (nano-banana-2 at 2K - the
// owner's answer 2 of V7.6: Kling takes 3850 px, 4K would be scaled down anyway); 2 · the VIDEO - Kling moves that
// picture with the part of the clip. It rides on the storyboard's machinery (`board`, its records, its row, `boardsOf`,
// the retry's home) with `kind: 'frame'`, and the video takes the chosen picture IN PLACE OF the person's pictures.
const FRAME_QUALITY = '2K';
const FRAME_R2 = 'the picture goes to Kling from a public link - that needs R2 (Admin -> API keys)';
// The words the picture model reads: the still of the clip is Image 1, the person's picture k Image k+1; anything else
// named goes.
function _frameWords(prompt, n) {
  return String(prompt || '').replace(REF_ANY, (all, k, i) => {
    const kind = k.toLowerCase();
    if (kind === 'video' && +i === 1) return 'Image 1';
    if (kind === 'image' && +i >= 1 && +i <= (n || 1)) return 'Image ' + (+i + 1);
    return '';
  }).replace(/[ \t]{2,}/g, ' ').replace(/ +([.,;:])/g, '$1').trim();
}
// What Kling's first frame needs before its writer is asked, and again before its picture is paid for: Kling motion
// control, the person's pictures (one at least - the character) and ONE clip, a link for the picture (R2), a picture
// model that draws from them and the still, and Kling able to take [a picture, the clip] on the chosen aggregator.
function _frameWrong(model, agg, params, media) {
  const list = media || [];
  if (_family(model) !== 'kmc') return 'the first frame is Kling motion control\'s - pick it';
  const pics = list.filter(x => x.kind === 'image'), clips = list.filter(x => x.kind === 'video');
  if (!pics.length || clips.length !== 1) return 'it takes your character\'s picture and one clip of the moves';
  if (list.some(x => x.kind === 'audio')) return 'Kling motion control takes no sound';
  if (!KEYS.r2() && !FAKE.on()) return FRAME_R2;
  const pv = _boardProvider(pics.length + 1);
  if (pv.error) return 'the first frame cannot be drawn - ' + pv.error;
  const rt = _routeOf(model, agg, params, [pics[0], clips[0]], 'xxx');
  return rt.error || '';
}
// The still of the clip at a moment, cut once into media/work under the card's name - the writer reads it and the
// drawing sends it (review V7: whole or not at all - the same moment reuses the file). Its address; throws in words.
async function _stillOf(cardId, clip, at) {
  const name = 'vframe_' + String(cardId).replace(/[^a-z0-9]/gi, '').slice(-16) + '_' + Math.round(at * 100) + '.jpg';
  const abs = path.join(MEDIA.work, name);
  if (!fs.existsSync(abs)) {
    let buf;
    try { buf = await require('../lib/video-prep').still(toDiskExisting(clip.path), at); }
    catch (e) { throw new Error('the frame could not be taken from the clip - ' + e.message); }
    require('../lib/atomic-write').writeFileAtomic(abs, buf);
  }
  return '/media/work/' + name;
}
// (phase V17, the owner: "the pose is the most important") A first frame's prompt names the still - the pose comes from
// it; one that does not gets the sentence that does, at its head.
const _framePose = (p) => (/\{\{video:1\}\}/.test(p) ? p : ('Keep exactly the pose, the framing and the camera angle of {{video:1}}. ' + p).trim());
// (review V7) The stills of first frames (media/work/vframe_*) go once no picture record names them any more - a picture
// retried from Alerts sends its frame again, so one stays while its record does (the pictures chat trims its records);
// an hour's grace covers a frame cut a moment before its record was written. A while after the start, then daily.
function _sweepFrames() {
  try {
    const dir = MEDIA.work;
    const names = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => /^vframe_.*\.jpg$/i.test(f)) : [];
    if (!names.length) return;
    let recs = [];
    try { const l = JSON.parse(fs.readFileSync(GENS.FILE, 'utf8')); recs = Array.isArray(l) ? l : (l.items || []); } catch (e) { return; }
    const named = new Set();
    for (const g of recs) for (const r of (g && g.refs) || []) named.add(String(r).split('?')[0].split('/').pop());
    for (const f of names) {
      if (named.has(f)) continue;
      const p = path.join(dir, f);
      try { if (Date.now() - fs.statSync(p).mtimeMs > 3600000) fs.unlinkSync(p); } catch (e) { /* in use, or gone */ }
    }
  } catch (e) { console.warn('[mv3-video] frames sweep:', e.message); }
}
setTimeout(_sweepFrames, 60000).unref();
setInterval(_sweepFrames, 24 * 3600000).unref();
router._sweepFrames = _sweepFrames;          // for the stands

// (review V7) Each clip and sound as the first rung would prepare it - its part in the file, its shape in the rung's
// window, a sound that has one - asked BEFORE anything is paid: a writer, a storyboard or a first frame is not
// bought for a video that can never be made. '' or the words.
async function _filesWrong(pair, media) {
  const VP = require('../lib/video-prep');
  for (const m of media || []) {
    if (!m || (m.kind !== 'video' && m.kind !== 'audio')) continue;
    const abs = toDiskExisting(m.path);
    if (!abs || !fs.existsSync(abs)) return (m.kind === 'video' ? 'a clip' : 'a sound') + ' is not in the library any more';
    const why = await VP.dryCheck(abs, pair, m);
    if (why) return (m.kind === 'video' ? 'a clip' : 'a sound') + ' cannot go to ' + pair.label + ' - ' + why;
  }
  return '';
}

// The shape the picture is drawn in: the clip's own, snapped to one the picture model makes.
function _shapeOf(w, h) {
  if (!(w > 0 && h > 0)) return '9:16';
  const r = w / h;
  let best = '9:16', d = Infinity;
  for (const a of VR.BOARD_ASPECTS) {
    const [x, y] = a.split(':').map(Number);
    const dd = Math.abs(Math.log((x / y) / r));
    if (dd < d) { d = dd; best = a; }
  }
  return best;
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

// ── The column's storyboard (phase V15; a sub-project message since V16 - the owner 2026-10-07) ──────────────────
// A plain message with the storyboard box ticked: its card ('board') holds the whole way - the words and the pictures,
// the sheet's prompt (written behind the answer by the V8 sheet rules; its variants), the sheets, the video's prompt
// (its variants) and the clips. A STOP BEFORE EVERY PAID STEP (the owner, V16 answer 5): "draw the storyboard" (V8's
// /card/:id/board - the record and its row at that press), "write the video" (/card/:id/video: the video's prompt from the
// same words with the chosen sheet among the pictures), "make the video" (/card/:id/make - the sheet the last picture).
const _short = (t) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, 60);
// Its row, once drawn, leads back to the card - not to the picture on its shelf (js/alerts-bell.js reveals only 'pictures'
// and 'videos').
function _boardWhere(project, w) {
  const w0 = (w && typeof w === 'object') ? w : {
    page: 'merge', href: '/merge?p=' + encodeURIComponent(project) + '&open=videos',
    label: 'Merge · ' + (_titleOf(project) || 'project') + ' · videos', spot: { key: project, view: 'videos' },
  };
  return Object.assign({}, w0, { spot: Object.assign({}, w0.spot || {}, { view: 'storyboard' }) });
}
const _verId = () => 'v' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex');
// Where a card with something written stands when its writer is done: made, or ready - or failed with nothing at all.
const _restState = (x) => {
  if ((x.card.sends || []).length || (x.genIds || []).length) return 'sent';
  const B = x.card.board;
  // (phase V17) A frame card's own words are its picture's prompt - Kling's is put in at its start.
  if (B && B.kind === 'frame') return (B.versions || []).length || B.prompt ? 'ready' : 'failed';
  return (x.card.versions || []).length || x.card.prompt || (B && ((B.versions || []).length || B.prompt)) ? 'ready' : 'failed';
};
// (phase V16.6) A card written before its prompts had variants has its one prompt and no list: that prompt becomes
// variant 1 when the next writing lands, so nothing written is lost.
const _seedVers = (c) => (Array.isArray(c.versions) && c.versions.length ? c.versions
  : c.prompt ? [{ id: _verId(), at: c.startedAt || '', model: c.model, agg: c.agg, params: c.params, prompt: c.prompt, writer: c.writer || '', fell: c.fell || '', edited: !!c.edited }] : []);
const _seedBoardVers = (B) => (Array.isArray(B.versions) && B.versions.length ? B.versions
  : B.prompt ? [{ id: _verId(), at: '', prompt: B.prompt, aspect: B.aspect || '', writer: '', edited: !!B.edited }] : []);
// The card writing its sheet's prompt - a new one, or `o.card` written again. { card, kick }.
function _startBoard(o) {
  const kick = 'w' + crypto.randomBytes(8).toString('hex');
  // The kick is alive BEFORE the card exists: a read in between must not take it for a dead writer's.
  CHAT.writing.add(kick);
  try {
    let card;
    if (o.card) {
      card = CHAT.update(o.card.id, (x) => {
        if (!x.card || x.card.state === 'writing') return false;
        Object.assign(x.card, { state: 'writing', writing: 'board', kick, startedAt: new Date().toISOString(), error: '' });
      });
      if (!card || !card.card || card.card.kick !== kick) throw Object.assign(new Error('it changed meanwhile'), { status: 409 });
    } else {
      card = CHAT.add({ project: o.project, kind: KIND, role: 'agent', text: '', refs: o.media.map(m => m.path), media: o.media,
                        card: { type: 'board', state: 'writing', writing: 'board', kick, startedAt: new Date().toISOString(), from: o.from,
                                text: o.text, model: o.model, agg: o.agg, params: o.params, versions: [],
                                board: { prompt: '', aspect: '', genIds: [], chosen: '', versions: [] } } });
    }
    return { card, kick };
  } catch (e) {
    CHAT.writing.delete(kick);
    throw e;
  }
}
// Behind the answer: the sheet's prompt - another variant of it - filed while the card still waits for THIS writer.
// Nothing is paid here: the sheet is drawn by its own press.
async function _writeBoard(cardId, kick, o) {
  let out;
  try {
    const pics = o.media.filter(x => x.kind === 'image').length;
    const watched = await _watchFor(cardId, kick, o.model, o.media, o.text);
    const sees = await _writerSees(o.media, 'storyboard', watched);
    const t = await AGENT.thinkVideo({ model: o.model, text: o.text || NO_WORDS, media: o.media, picUrls: sees.urls, seen: sees.seen, thread: [],
                                       params: o.params, boardOnly: true, watched });
    const board = t.board ? _boardWords(t.board, pics) : '';
    out = board ? { board, writer: t.writer || '', aspect: t.boardAspect || (VR.BOARD_ASPECTS.includes((o.params || {}).aspect) ? o.params.aspect : '16:9') }
      : { error: t.fail || 'the writer answered nothing usable - write it again' };
  } catch (e) {
    out = { error: 'the writer broke off: ' + String(e.message || e).slice(0, 300) };
  }
  try {
    CHAT.update(cardId, (m) => {
      if (!m.card || m.card.kick !== kick || m.card.state !== 'writing') return false;
      const B = m.card.board || (m.card.board = { prompt: '', aspect: '', genIds: [], chosen: '' });
      if (out.board) {
        // A card written before V16 has its one prompt and no list: that one is the first variant.
        const was = (B.versions || []).length ? B.versions : (B.prompt ? [{ id: _verId(), at: '', prompt: B.prompt, aspect: B.aspect, writer: '', edited: !!B.edited }] : []);
        const v = { id: _verId(), at: new Date().toISOString(), prompt: out.board, aspect: out.aspect, writer: out.writer, edited: false };
        B.versions = was.concat([v]).slice(-10);
        Object.assign(B, { cur: v.id, prompt: v.prompt, aspect: v.aspect, edited: false });
        m.card.error = '';
      } else m.card.error = out.error;
      m.card.writing = '';
      m.card.state = _restState(m);
    });
  } finally { CHAT.writing.delete(kick); }
}

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
// (review V7) It answers { urls, seen } - what the writer is told it sees is what it gets: the pictures all or none,
// each clip's THREE frames or none of them (one short and the next clip's frames were read as this one's end).
// (phase V48) A clip WATCHED whole (`watched[i]` - its description) needs no frames: `seen.clips[i]` is 'watched'.
async function _writerSees(media, why, watched) {
  const list = Array.isArray(media) ? media : [];
  const pics = list.filter(m => m.kind === 'image').map(m => m.path);
  let urls = [];
  const seen = { pics: true, clips: [] };
  if (pics.length) {
    try { urls = await _hostForWriter(pics); }
    catch (e) { console.warn('[mv3-video] ' + why + ': the writer will not see the pictures -', e.message); urls = []; seen.pics = false; }
  }
  for (const [ci, m] of list.filter(x => x.kind === 'video').entries()) {
    if (watched && watched[ci]) { seen.clips.push('watched'); continue; }
    let three = [];
    try {
      if (FAKE.on()) three = [FAKE.host(m.path), FAKE.host(m.path), FAKE.host(m.path)];
      else {
        const abs = toDiskExisting(m.path);
        const bufs = await require('../lib/video-prep').frames(abs, { from: m.in, to: m.out });
        if (bufs.length === 3) for (const b of bufs) three.push(await require('../lib/helpers').uploadToPublicHost(b, { ext: 'jpg', verify: true }));
      }
    } catch (e) { console.warn('[mv3-video] ' + why + ': the writer will not see a clip -', e.message); three = []; }
    if (three.length === 3) { urls.push(...three); seen.clips.push(true); } else seen.clips.push(false);
  }
  return { urls, seen };
}

// (phase V48, the owner 2026-10-25: "нам нужно чтобы агент просматривал видео полностью и описывал его ... это нужно
// пока только для seedance") THE CLIPS WATCHED before Seedance's writer writes a card: each clip - the part of it that
// goes - described by an agent that watches video (lib/clip-watch.js: kept by the file and the part, never paid twice),
// the descriptions written onto the card as they come (`watch`, one entry per clip) - a step of the message the person
// reads and corrects (кл5). A description the card has already for the same part is used AS IT STANDS - corrected or
// not; a clip that was not watched is asked again. The clips' descriptions in their order ({ text } or null - the writer
// then sees its three frames, and the card says "clip not watched"), or null when this card watches nothing.
const _samePart = (w, i, c) => !!(w && w.n === i + 1 && w.path === c.path
  && Math.abs((+w.in || 0) - (+c.in || 0)) < 0.005 && Math.abs((+w.out || 0) - (+c.out || 0)) < 0.005);
// The card does not wait for this writer any more (written again, cleared): nothing more is watched or written for it.
const _cardLeft = () => Object.assign(new Error('the card changed meanwhile'), { left: true });
async function _watchFor(cardId, kick, model, media, words) {
  const clips = (Array.isArray(media) ? media : []).filter(x => x && x.kind === 'video');
  if (_family(model) !== 'seedance' || !clips.length) return null;
  const now = CHAT.get(cardId);
  const had = now && now.card && Array.isArray(now.card.watch) ? now.card.watch : [];
  const list = clips.map((c, i) => {
    const w = had.find(x => _samePart(x, i, c));
    if (w && w.state === 'done' && w.text) return Object.assign({}, w);
    return { n: i + 1, path: c.path, in: +c.in || 0, out: +c.out || 0, state: 'waiting', text: '', by: '', why: '', edited: false, cached: false, at: '' };
  });
  // Filed only while the card still waits for THIS writer; false when it does not any more.
  const put = () => {
    let ours = false;
    CHAT.update(cardId, (m) => {
      if (!m.card || m.card.kick !== kick || m.card.state !== 'writing') return false;
      ours = true;
      m.card.watch = list.map(w => Object.assign({}, w));
    });
    return ours;
  };
  if (!put()) throw _cardLeft();
  for (const w of list) {
    if (w.state === 'done') continue;
    // When it began: the page's bar counts from it.
    Object.assign(w, { state: 'watching', at: new Date().toISOString() });
    if (!put()) throw _cardLeft();
    let r;
    try { r = await require('../lib/clip-watch').describe(w, { fakeText: words }); }
    catch (e) { r = { fail: 'the watching broke off - ' + String(e.message || e).slice(0, 200) }; }
    Object.assign(w, r.text ? { state: 'done', text: r.text, by: r.by || '', cached: !!r.cached, why: '', edited: false, at: new Date().toISOString() }
      : { state: 'failed', text: '', why: r.fail || 'not watched' });
    if (!put()) throw _cardLeft();
  }
  return list.map(w => (w.state === 'done' && w.text ? { text: w.text } : null));
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

// The thread's own card, or why not. `type` - one, or a list (phase V15: a storyboard card draws as a two-step one).
function _cardOf(id, project, type) {
  const m = CHAT.get(id);
  const types = Array.isArray(type) ? type : [type || 'prompt'];
  // (phase V21) In the thread of the project asked from - the drafts' conversation for the draft, whatever draft wrote it.
  if (!m || String(m.project || '') !== CHAT.threadOf(project) || !m.card || !types.includes(m.card.type)) return null;
  return m;
}

// The writer for one card, behind the answer: what it wrote is filed into the card only while the card is still
// waiting for THIS writer (a card written again, made, or cleared meanwhile is left alone).
// (phase V16.6) Every writing is a VARIANT, as the plain chat's are (V16.3): of the video prompt, and of a two-step card's
// storyboard prompt with it - the newest chosen; one that fails leaves the variants there were, and says why.
async function _writeCard(cardId, kick, o) {
  let out;
  try {
    const watched = await _watchFor(cardId, kick, o.model, o.media, o.filled);
    const sees = await _writerSees(o.media, 'write', watched);
    const t = await AGENT.thinkVideo({ model: o.model, text: o.filled, media: o.media, picUrls: sees.urls, seen: sees.seen, thread: [],
                                       skill: { text: o.body }, params: o.params, max: o.max, recipe: true, twoStep: !!o.twoStep, watched });
    out = t.prompt ? { prompt: _strictRefs(t.prompt), writer: t.writer || '', fell: t.fell || '' }
      : { error: t.fail || 'the writer answered nothing usable - write it again' };
    if (t.prompt && o.twoStep) {
      const pics = o.media.filter(m => m.kind === 'image').length;
      const k = pics + 1;
      // The video follows its sheet (review V8): a prompt that does not name it gets the sentence that does, and one
      // that names a picture the video will not have fails here - before the sheet is paid for, not at the make.
      if (!_namesSheet(out.prompt, k)) out.prompt = (out.prompt + ' Follow the storyboard {{image:' + k + '}} panel by panel, from the first panel to the last.').trim();
      const wrong = _refsWrong(out.prompt, o.media.concat([BOARD_SEAT]));
      if (wrong) out = { error: 'the writer wrote a prompt that ' + wrong.replace(/^the prompt /, '') + ' (the storyboard is picture ' + k + ') - write it again' };
      else {
        out.boardPrompt = _boardWords(t.board, pics);
        out.boardAspect = t.boardAspect || (VR.BOARD_ASPECTS.includes((o.params || {}).aspect) ? o.params.aspect : '16:9');
      }
    }
  } catch (e) {
    out = { error: 'the writer broke off: ' + String(e.message || e).slice(0, 300) };
  }
  try {
    CHAT.update(cardId, (m) => {
      if (!m.card || m.card.kick !== kick || m.card.state !== 'writing') return false;
      if (out.prompt) {
        const at = new Date().toISOString();
        const v = { id: _verId(), at, model: o.model, agg: o.agg || m.card.agg, params: o.params, prompt: out.prompt,
                    writer: out.writer, fell: out.fell, edited: false };
        m.card.versions = _seedVers(m.card).concat([v]).slice(-10);
        Object.assign(m.card, { cur: v.id, prompt: v.prompt, model: v.model, agg: v.agg, params: v.params, writer: v.writer, fell: v.fell,
                                edited: false, error: '' });
        if (m.card.board && out.boardPrompt != null) {
          const B = m.card.board;
          const bv = { id: _verId(), at, prompt: out.boardPrompt, aspect: out.boardAspect, writer: out.writer, edited: false };
          B.versions = _seedBoardVers(B).concat([bv]).slice(-10);
          Object.assign(B, { cur: bv.id, prompt: bv.prompt, aspect: bv.aspect, edited: false });
        }
      } else m.card.error = out.error;
      m.card.state = _restState(m);
    });
  } finally { CHAT.writing.delete(kick); }
}

// (phase V16, the owner 2026-10-07) Seedance's FRAMES ("pictures are"): the first frame - and the last - by their roles,
// { kind: 'first' | 'fl', first, last, asRefs } with their numbers among the pictures; null when there are none, or
// { error } in words. With nothing beside them they are the model's own frames; beside a clip or a sound they go as
// references (Seedance takes frames OR references) - `asRefs` - and the prompt names them.
function _framesOf(model, media) {
  if (_family(model) !== 'seedance') return null;
  const pics = (media || []).filter(m => m.kind === 'image');
  const first = pics.findIndex(m => m.role === 'frame-first') + 1;
  const last = pics.findIndex(m => m.role === 'frame-last') + 1;
  if (!first && !last) return null;
  if (pics.some(m => m.role === 'storyboard')) return { error: 'a first or last frame cannot go with a storyboard - the video follows the sheet: attach that picture as a reference' };
  if (!first) return { error: 'a last frame goes with a first frame - attach the first one too' };
  if (pics.length > (last ? 2 : 1)) return { error: 'with frames only the frames go - take the other pictures off, or send the pictures as references' };
  return { kind: last ? 'fl' : 'first', first, last, asRefs: (media || []).some(m => m.kind !== 'image') };
}
// (phase V16, the owner: "it is important") A frames prompt OPENS with our sentence (lib/mv3-video-rules.js
// framesOpening) - the writer is told not to write one; a first sentence of its own about starting on the first frame
// goes all the same, so the model is not told twice.
function _withOpening(prompt, fr) {
  const open = VR.framesOpening(fr);
  let p = String(prompt || '').trim();
  if (!open) return p;
  const head = p.match(/^[^.!?]*[.!?]+\s*/);
  if (head && /\bfirst frame\b/i.test(head[0]) && /\b(?:start|starts|begin|begins|open|opens)\b/i.test(head[0])) p = p.slice(head[0].length).trim();
  return (open + ' ' + p).trim();
}
// What the writer may use of a model's prompt limit when our opening goes before its prompt.
const _roomFor = (max, open) => (max && open ? Math.max(200, max - open.length - 1) : max);

// (phase V17) The writer of Kling's first frame, behind the answer: the still cut at the moment (the file the drawing
// sends too), hosted with the person's pictures - the writer sees them in that order; every writing a VARIANT of the
// picture's prompt (`board.versions`), the newest chosen; one that fails leaves the variants there were, and says why.
async function _writeFrame(cardId, kick, o) {
  let out;
  try {
    const clip = o.media.find(x => x.kind === 'video');
    const pics = o.media.filter(x => x.kind === 'image');
    const still = await _stillOf(cardId, clip, o.at);
    let urls = [];
    let seen = { still: true, pics: true };
    try { urls = await _hostForWriter([still].concat(pics.map(p => p.path))); }
    catch (e) { console.warn('[mv3-video] first frame: the writer will not see the pictures -', e.message); urls = []; seen = { still: false, pics: false }; }
    const t = await AGENT.thinkFrame({ text: o.text, pictures: pics.length, picUrls: urls, seen });
    out = t.prompt ? { prompt: _framePose(_strictRefs(t.prompt)), writer: t.writer || '' } : { error: t.fail || 'the writer answered nothing usable - write it again' };
    if (out.prompt) {
      const wrong = _refsWrong(out.prompt, o.media);
      if (wrong) out = { error: 'the writer wrote a prompt that ' + wrong.replace(/^the prompt /, '') + ' - write it again' };
    }
  } catch (e) {
    out = { error: 'the writer broke off: ' + String(e.message || e).slice(0, 300) };
  }
  try {
    CHAT.update(cardId, (m) => {
      if (!m.card || m.card.kick !== kick || m.card.state !== 'writing' || !m.card.board) return false;
      const B = m.card.board;
      if (out.prompt) {
        const v = { id: _verId(), at: new Date().toISOString(), prompt: out.prompt, aspect: B.aspect || '', writer: out.writer, edited: false };
        B.versions = _seedBoardVers(B).concat([v]).slice(-10);
        Object.assign(B, { cur: v.id, prompt: v.prompt, edited: false });
        m.card.error = '';
      } else m.card.error = out.error;
      m.card.writing = '';
      m.card.state = _restState(m);
    });
  } finally { CHAT.writing.delete(kick); }
}

// (phase V16) The writer of a PLAIN card - the chat's message with the writer stopping for a look: each writing is a
// VARIANT of the prompt (`versions`, at most 10), the newest chosen; one that fails leaves the variants there were, and
// says why. Filed only while the card still waits for THIS writer.
const NO_WORDS = '(Nothing was written - decide what the clip shows from the attachments.)';
const NO_WORDS_FRAMES = '(Nothing was written - decide a natural motion from the frames.)';
async function _writePlain(cardId, kick, o) {
  let out;
  try {
    const watched = await _watchFor(cardId, kick, o.model, o.media, o.text);
    const sees = await _writerSees(o.media, 'review', watched);
    // (phase V16) Frames: the writer's frames rules, and our opening before its prompt.
    const fr = _framesOf(o.model, o.media);
    const frames = fr && !fr.error ? fr : null;
    const open = VR.framesOpening(frames);
    const t = await AGENT.thinkVideo({ model: o.model, text: o.text || (frames ? NO_WORDS_FRAMES : NO_WORDS), media: o.media, picUrls: sees.urls, seen: sees.seen,
                                       thread: o.before || [], params: o.params, max: _roomFor(o.max, open), review: true, frames, watched });
    out = t.prompt ? { prompt: _strictRefs(frames ? _withOpening(t.prompt, frames) : t.prompt), writer: t.writer || '', fell: t.fell || '' }
      : { error: t.fail || 'the writer answered nothing usable - write it again' };
    if (out.prompt) {
      // A storyboard among the pictures is followed (V15): a prompt that does not name it gets the sentence that does.
      const k = o.media.filter(m => m.kind === 'image').findIndex(m => m.role === 'storyboard') + 1;
      if (k && !_namesSheet(out.prompt, k)) out.prompt = (out.prompt + ' Follow the storyboard {{image:' + k + '}} panel by panel, from the first panel to the last.').trim();
      const wrong = _refsWrong(out.prompt, o.media);
      if (wrong) out = { error: 'the writer wrote a prompt that ' + wrong.replace(/^the prompt /, '') + ' - write it again' };
    }
  } catch (e) {
    out = { error: 'the writer broke off: ' + String(e.message || e).slice(0, 300) };
  }
  try {
    CHAT.update(cardId, (m) => {
      if (!m.card || m.card.kick !== kick || m.card.state !== 'writing') return false;
      const had = (m.card.versions || []).length;
      if (out.prompt) {
        // (phase V16) A storyboard card's video prompt remembers the sheet it was written with.
        const v = { id: _verId(), at: new Date().toISOString(), model: o.model, agg: o.agg, params: o.params, prompt: out.prompt,
                    writer: out.writer, fell: out.fell, edited: false, boardId: o.boardId || '' };
        m.card.versions = (m.card.versions || []).concat([v]).slice(-10);
        Object.assign(m.card, { cur: v.id, prompt: v.prompt, model: v.model, agg: v.agg, params: v.params, writer: v.writer, fell: v.fell, edited: false, error: '' });
      } else m.card.error = out.error;
      m.card.writing = '';
      m.card.state = out.prompt || had ? _restState(m) : 'failed';
    });
  } finally { CHAT.writing.delete(kick); }
}

// The settings a card is written for and made with: the model, its aggregator and parameters as the column has them.
function _settings(b) {
  const model = String(b.model || '');
  const params = (b.params && typeof b.params === 'object') ? b.params : {};
  return { model, params, agg: String(b.agg || '') };
}

router.post('/mv3/video/write', async (req, res) => {
  const b = req.body || {};
  let kick = '';
  try {
    const project = String(b.project || '').trim();
    if (!project) return res.status(400).json({ success: false, error: 'open a project first' });
    const s = _settings(b);
    if (!VM.MODELS.some(m => m.id === s.model)) return res.status(400).json({ success: false, error: 'no such model: ' + s.model });
    if (_family(s.model) === 'kmc') return res.status(400).json({ success: false, error: 'a recipe is not written for Kling motion control - send your pictures and the clip from the box' });
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
    // (review V7) The clips and sounds as the first rung would take them - before the writer (and a sheet) is paid.
    const fw = await _filesWrong(rt.fits[0], mm.media);
    if (fw) return res.status(400).json({ success: false, error: fw });
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
    _writeCard(pc.id, kick, { model: s.model, agg: rt.fits[0].agg, filled, body, media: mm.media, params: s.params, max: rt.fits[0].promptMax, twoStep });
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
    // (phase V16) A card's prompt variants: `ver` the one edited (the chosen one when none), `cur` the one chosen; `bver` and
    // `bcur` the same for a storyboard's prompt.
    const ver = b.ver == null ? null : String(b.ver);
    const cur = b.cur == null ? null : String(b.cur);
    const bver = b.bver == null ? null : String(b.bver);
    const bcur = b.bcur == null ? null : String(b.bcur);
    // A first frame's moment (V17: where the part starts; on a V7.6 card within the part).
    const at = b.at == null || !Number.isFinite(+b.at) ? null : +b.at;
    // (phase V48, кл5) The person's correction of what the agent saw in clip `n`: the next writing reads it as it stands.
    const wEdit = b.watch && typeof b.watch === 'object' && Number.isFinite(+b.watch.n)
      ? { n: Math.round(+b.watch.n), text: String(b.watch.text == null ? '' : b.watch.text).replace(/\r\n/g, '\n').slice(0, 40000) } : null;
    let why = null;
    const m = CHAT.update(req.params.id, (x) => {
      const story = !!(x.card && x.card.type === 'board');
      if (String(x.project || '') !== CHAT.threadOf(project) || !x.card || (x.card.type !== 'prompt' && !story)) { why = [404, 'no such card']; return false; }
      // A description is corrected on a card that is not being written - a failed one too: its prompt is written again from it.
      if (wEdit) {
        if (x.card.state === 'writing') { why = [409, 'the prompt is being written from it now - correct it when that is done']; return false; }
        const w = (x.card.watch || []).find(y => y && y.n === wEdit.n);
        if (!w || w.state !== 'done') { why = [404, 'clip ' + wEdit.n + ' has no description on this card']; return false; }
        if (!wEdit.text.trim()) { why = [400, 'the description is empty - say what the clip shows']; return false; }
        if (w.text === wEdit.text) return false;
        Object.assign(w, { text: wEdit.text, edited: true });
        return;
      }
      if (story && at != null) { why = [400, 'a storyboard card has no moment of a clip']; return false; }
      // Written - waiting, or made and edited for the next make (the owner, 2026-10-06).
      if (x.card.state !== 'ready' && x.card.state !== 'sent') { why = [409, 'it is not written yet']; return false; }
      let changed = false;
      // (phase V16) A storyboard's prompt by variant - the column's storyboard and (V16.6) a two-step recipe's.
      if (x.card.board && Array.isArray(x.card.board.versions) && x.card.board.versions.length) {
        const B = x.card.board;
        const pickB = (id) => B.versions.find(v => v.id === id);
        if (bcur != null) {
          const v = pickB(bcur);
          if (!v) { why = [404, 'no such variant of the storyboard prompt']; return false; }
          if (B.cur !== v.id) { Object.assign(B, { cur: v.id, prompt: v.prompt, aspect: v.aspect || B.aspect, edited: !!v.edited }); changed = true; }
        }
        if (board != null) {
          const v = pickB(bver || B.cur);
          if (v && v.prompt !== board) { Object.assign(v, { prompt: board, edited: true }); if (v.id === B.cur) Object.assign(B, { prompt: board, edited: true }); changed = true; }
        }
      } else if (x.card.board && board != null && x.card.board.prompt !== board) { x.card.board.prompt = board; x.card.board.edited = true; changed = true; }
      if (Array.isArray(x.card.versions) && x.card.versions.length) {
        const pick = (id) => x.card.versions.find(v => v.id === id);
        if (cur != null) {
          const v = pick(cur);
          if (!v) { why = [404, 'no such variant of the prompt']; return false; }
          if (x.card.cur !== v.id) {
            Object.assign(x.card, { cur: v.id, prompt: v.prompt, model: v.model || x.card.model, agg: v.agg || x.card.agg,
                                    params: v.params || x.card.params, writer: v.writer || '', fell: v.fell || '', edited: !!v.edited });
            changed = true;
          }
        }
        if (prompt != null) {
          const v = pick(ver || x.card.cur);
          if (v && v.prompt !== prompt) {
            Object.assign(v, { prompt, edited: true });
            if (v.id === x.card.cur) Object.assign(x.card, { prompt, edited: true });
            changed = true;
          }
        }
      } else if (prompt != null && x.card.prompt !== prompt) { x.card.prompt = prompt; x.card.edited = true; changed = true; }
      // Only a sheet of this card that has landed and is still on the shelf can be chosen (review V8).
      if (x.card.board && chosen != null && x.card.board.chosen !== chosen) {
        const W = x.card.board.kind === 'frame' ? 'picture' : 'storyboard';
        const g = CHAT.boardsOf(x).find(y => y.id === chosen);
        if (!g) { why = [404, 'no such ' + W + ' on this card']; return false; }
        if (!CHAT.boardReady(g)) { why = [409, g.gone ? 'that ' + W + ' is not on the Images shelf any more' : 'only a ' + W + ' that has landed can be chosen']; return false; }
        x.card.board.chosen = chosen;
        changed = true;
      }
      if (x.card.board && x.card.board.kind === 'frame' && at != null) {
        const clip = (x.media || []).find(y => y.kind === 'video') || {};
        const B = x.card.board;
        if (+B.dur > 0) {
          // (phase V17) The moment IS where the part starts: the part follows it with the length the person chose (`len`),
          // 3 s at least in the clip.
          const len = Math.max(3, +B.len || ((+clip.out || 0) - (+clip.in || 0)));
          const v = Math.round(Math.max(0, Math.min(B.dur - 3, at)) * 100) / 100;
          if (B.at !== v || +clip.in !== v) {
            B.at = v;
            clip.in = v;
            clip.out = Math.round(Math.min(B.dur, v + len) * 100) / 100;
            changed = true;
          }
        } else {
          // An older card (V7.6): its moment lies within the part that goes.
          const lo = +clip.in || 0, hi = +clip.out > lo ? +clip.out : lo;
          const v = Math.round(Math.max(lo, Math.min(hi, at)) * 100) / 100;
          if (B.at !== v) { B.at = v; changed = true; }
        }
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
    const m = _cardOf(req.params.id, project, ['prompt', 'board']);
    if (!m) return res.status(404).json({ success: false, error: 'no such card' });
    if (m.card.state === 'writing') return res.status(409).json({ success: false, error: 'it is being written' });
    // (phase V15) The column's storyboard whose prompt was not written: written again, with a sheet of its own at the press.
    if (m.card.type === 'board') {
      const s = _settings(b);
      if (_family(s.model) !== 'seedance') return res.status(400).json({ success: false, error: 'a storyboard is drawn for Seedance - pick a Seedance model' });
      const mm = _mediaOf(m.media);
      if (mm.error) return res.status(400).json({ success: false, error: mm.error });
      const wrong = _twoStepWrong(s.model, s.agg, s.params, mm.media);
      if (wrong) return res.status(400).json({ success: false, error: wrong });
      if (_writingIn(project) >= WRITE_AT_ONCE) return res.status(409).json({ success: false, error: WRITE_AT_ONCE + ' prompts are being written already - wait for one of them' });
      const rt = _routeOf(s.model, s.agg, s.params, mm.media, 'xxx');
      if (rt.error) return res.status(400).json({ success: false, error: rt.error });
      let st;
      try { st = _startBoard({ project, card: m, text: m.card.text, model: s.model, agg: rt.fits[0].agg, params: s.params, media: mm.media }); }
      catch (e) { return res.status(e.status || 500).json({ success: false, error: e.message }); }
      res.json({ success: true, card: m.id });
      _writeBoard(m.id, st.kick, { model: s.model, text: m.card.text, media: mm.media, params: s.params });
      return;
    }
    // (phase V17) Kling's first frame: its picture's prompt written again - another variant, from the same words and pictures.
    if (m.card.board && m.card.board.kind === 'frame') {
      const s = _settings(b);
      if (_family(s.model) !== 'kmc') return res.status(400).json({ success: false, error: 'the first frame is Kling motion control\'s - pick it on the left' });
      const mm = _mediaOf(m.media);
      if (mm.error) return res.status(400).json({ success: false, error: mm.error });
      const wrong = _frameWrong(s.model, s.agg, s.params, mm.media);
      if (wrong) return res.status(400).json({ success: false, error: wrong });
      if (_writingIn(project) >= WRITE_AT_ONCE) return res.status(409).json({ success: false, error: WRITE_AT_ONCE + ' prompts are being written already - wait for one of them' });
      kick = 'w' + crypto.randomBytes(8).toString('hex');
      CHAT.writing.add(kick);
      const ok = CHAT.update(m.id, (x) => {
        if (!x.card || x.card.state === 'writing') return false;
        Object.assign(x.card, { state: 'writing', writing: 'board', kick, startedAt: new Date().toISOString(), error: '' });
      });
      if (!ok || !ok.card || ok.card.kick !== kick) { CHAT.writing.delete(kick); return res.status(409).json({ success: false, error: 'it changed meanwhile' }); }
      res.json({ success: true, card: m.id });
      const clip = mm.media.find(x => x.kind === 'video') || {};
      _writeFrame(m.id, kick, { text: m.card.text || '', media: mm.media, at: +m.card.board.dur > 0 ? (+clip.in || 0) : (+m.card.board.at || +clip.in || 0) });
      return;
    }
    // (phase V16) A plain card written again: another variant of its prompt, from the person's words and its attachments.
    if (m.card.plain) {
      const s = _settings(b);
      if (!VM.MODELS.some(x => x.id === s.model)) return res.status(400).json({ success: false, error: 'no such model: ' + s.model });
      if (_family(s.model) === 'kmc') return res.status(400).json({ success: false, error: 'Kling motion control takes its own prompt - send your pictures and the clip from the box' });
      const mm = _mediaOf(m.media);
      if (mm.error) return res.status(400).json({ success: false, error: mm.error });
      const rt = _routeOf(s.model, s.agg, s.params, mm.media, 'xxx');
      if (rt.error) return res.status(400).json({ success: false, error: rt.error });
      if (_writingIn(project) >= WRITE_AT_ONCE) return res.status(409).json({ success: false, error: WRITE_AT_ONCE + ' prompts are being written already - wait for one of them' });
      kick = 'w' + crypto.randomBytes(8).toString('hex');
      CHAT.writing.add(kick);
      const ok = CHAT.update(m.id, (x) => {
        if (!x.card || x.card.state === 'writing') return false;
        Object.assign(x.card, { state: 'writing', kick, startedAt: new Date().toISOString(), error: '' });
      });
      if (!ok || !ok.card || ok.card.kick !== kick) { CHAT.writing.delete(kick); return res.status(409).json({ success: false, error: 'it changed meanwhile' }); }
      res.json({ success: true, card: m.id });
      _writePlain(m.id, kick, { model: s.model, agg: rt.fits[0].agg, text: m.card.text, media: mm.media, params: s.params, max: rt.fits[0].promptMax, before: [] });
      return;
    }
    const rc = m.card.from ? _cardOf(m.card.from, project, 'recipe') : null;
    if (!rc) return res.status(410).json({ success: false, error: 'the recipe it was written from is not in the thread any more - fill the recipe in again' });
    const s = _settings(b);
    if (!VM.MODELS.some(x => x.id === s.model)) return res.status(400).json({ success: false, error: 'no such model: ' + s.model });
    if (_family(s.model) === 'kmc') return res.status(400).json({ success: false, error: 'a recipe is not written for Kling motion control - send your pictures and the clip from the box' });
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
    // (phase V16.6) Another VARIANT: the ones there are stay, and the card shows the chosen one until the new one lands.
    const ok = CHAT.update(m.id, (x) => {
      if (!x.card || x.card.state === 'writing') return false;
      Object.assign(x.card, { state: 'writing', kick, startedAt: new Date().toISOString(), error: '' });
      // Its sheets stay on the card, none chosen: the new prompts may be for another sheet (review V8).
      if (x.card.board) x.card.board.chosen = '';
    });
    if (!ok || !ok.card || ok.card.kick !== kick) { CHAT.writing.delete(kick); return res.status(409).json({ success: false, error: 'it changed meanwhile' }); }
    res.json({ success: true, card: m.id });
    _writeCard(m.id, kick, { model: s.model, agg: rt.fits[0].agg, filled: rc.card.filled, body: rc.card.body, media: mm.media, params: s.params,
                             max: rt.fits[0].promptMax, twoStep: !!m.card.board });
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
    // (phase V16) A storyboard card of the column makes its video from its own message too.
    const m = _cardOf(req.params.id, project, ['prompt', 'board']);
    if (!m) return res.status(404).json({ success: false, error: 'no such card' });
    if (m.card.state === 'writing') return res.status(409).json({ success: false, error: 'the prompt is still being written' });
    // A made card is made again from its own field (the owner, 2026-10-06): another attempt of the same card.
    if (m.card.state !== 'ready' && m.card.state !== 'sent') return res.status(409).json({ success: false, error: 'the prompt was not written - write it again' });
    const prompt = _strictRefs(String(b.prompt == null ? m.card.prompt : b.prompt).replace(/\r\n/g, '\n')).trim().slice(0, 30000);
    if (!prompt) return res.status(400).json({ success: false, error: 'the prompt is empty' });
    const s = _settings(Object.assign({ model: m.card.model, params: m.card.params, agg: m.card.agg }, b));
    if (!VM.MODELS.some(x => x.id === s.model)) return res.status(400).json({ success: false, error: 'no such model: ' + s.model });
    const frame = !!(m.card.board && m.card.board.kind === 'frame');
    if (_family(s.model) !== _family(m.card.model)) {
      return res.status(400).json({ success: false, error: frame ? 'a first frame\'s video is made by Kling motion control - pick it on the left'
        : 'this prompt was written for ' + _labelOf(m.card.model) + ' - write it again for ' + _labelOf(s.model) });
    }
    // (review V7) A first frame's video takes the DRAWN picture in place of the person's: the person's own pictures are not
    // needed any more, and one gone from the Library must not stop a paid picture from being used.
    const mm = _mediaOf(frame ? (m.media || []).filter(x => x && x.kind !== 'image') : m.media);
    if (mm.error) return res.status(400).json({ success: false, error: mm.error });
    let boardId = '';
    // The pictures' records, read once for this press however many times the sheets are looked up (phase V23).
    let _pics = null;
    const picsAll = () => (_pics || (_pics = require('../lib/mv3-gens').listAll()));
    if (m.card.board) {
      // The sheet the video follows: the one the page sends, else the card's chosen one while it can be followed, else
      // the newest that landed and is still on the shelf (review V8). A first frame's picture the same way.
      const W = frame ? 'picture' : 'storyboard';
      const boards = CHAT.boardsOf(m, picsAll());
      const want = String(b.boardId || '');
      let g = null;
      if (want) {
        g = boards.find(x => x.id === want);
        if (!g) return res.status(409).json({ success: false, error: 'that ' + W + ' is not this card\'s - choose one of its own' });
        if (g.gone) return res.status(409).json({ success: false, error: 'that ' + W + ' is not on the Images shelf any more - choose another, or draw one' });
        if (!CHAT.boardReady(g)) return res.status(409).json({ success: false, error: 'that ' + W + ' is not ready' });
      } else {
        const ready = boards.filter(CHAT.boardReady);
        g = ready.find(x => x.id === m.card.board.chosen) || ready[ready.length - 1] || null;
        if (!g) {
          return res.status(409).json({ success: false, error: boards.some(x => x.state === 'pending')
            ? 'the ' + W + ' is still being drawn - the video follows it' : 'make the ' + W + ' first - the video follows it' });
        }
      }
      boardId = g.id;
    }
    if (frame) {
      // The chosen picture IN PLACE OF the person's: Kling takes one picture - the room with the person in it now -
      // and the same part of the clip.
      const g = CHAT.boardsOf(m, picsAll()).find(x => x.id === boardId);
      const sb = _mediaOf([{ path: g.imagePath, kind: 'image', role: 'person', label: 'picture' }]);
      if (sb.error) return res.status(400).json({ success: false, error: /R2/.test(sb.error) ? FRAME_R2 : 'the picture is not on the Images shelf any more - choose another, or draw one' });
      mm.media = sb.media.concat(mm.media.filter(x => x.kind !== 'image'));
    } else if (m.card.board) {
      const g = CHAT.boardsOf(m, picsAll()).find(x => x.id === boardId);
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
    const rc = m.card.from ? _cardOf(m.card.from, project, 'recipe') : null;
    const recipe = m.card.recipe || (rc && rc.card.recipe) || null;
    const skill = recipe ? Object.assign({}, recipe, { text: (rc && rc.card.body) || '' }) : null;
    // A card with no recipe card of its own (V7.6's frame-swap) is said by its recipe's title; a plain one (V16) by the
    // person's words.
    const said = frame && m.card.plain && !String(m.card.text || '').trim() ? 'motion control from its first frame'
      : m.card.plain || m.card.type === 'board' ? String(m.card.text || prompt).replace(/\s+/g, ' ').slice(0, 200)
      : rc ? _saidOf(rc, prompt) : String((recipe && recipe.title) || prompt).replace(/\s+/g, ' ').slice(0, 200);
    // (phase V16) The variant of the prompt the person made it from - chosen, and kept with the attempt.
    const ver = Array.isArray(m.card.versions) && m.card.versions.some(v => v.id === String(b.ver || '')) ? String(b.ver) : (m.card.cur || '');
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
        project, send: m.id, part, kick, where, stage: AGENT.english(prompt) ? 'asking ' + rt.fits[0].aggLabel : 'translating the prompt',
        model: s.model, agg: rt.fits[0].agg, prompt, said, params: s.params, media: mm.media, skill, ready: true,
      }).id);
    }
    CHAT.update(m.id, (x) => {
      const at = new Date().toISOString();
      Object.assign(x.card, { state: 'sent', prompt, model: s.model, agg: rt.fits[0].agg, params: s.params, sent: { at, n },
                              sends: _was(x).concat([{ at, n, boardId, genIds: ids, ver }]) });
      // (phase V16) The variant made from is the chosen one, as the person edited it.
      const v = ver && Array.isArray(x.card.versions) ? x.card.versions.find(y => y.id === ver) : null;
      if (v) { if (v.prompt !== prompt) Object.assign(v, { prompt, edited: true }); x.card.cur = v.id; }
      if (x.card.board && boardId) x.card.board.chosen = boardId;
      x.genIds = (x.genIds || []).concat(ids).slice(-40);
      x.genId = x.genIds[0];
    });
    res.json({ success: true, card: m.id, genIds: ids, agg: rt.fits[0].agg });
    _make({ ids, kick, prompt, writer: m.card.writer || '', max: Math.min(...rt.fits.map(p => p.promptMax || 30000)) });
  } catch (err) {
    // What was made before the break is failed in its own words - nothing of it was asked for.
    for (const id of ids) VGENS.abandon(id, kick, err);
    if (kick) VGENS.asking.delete(kick);
    console.error('[mv3-video/make]', err.message);
    if (!res.headersSent) res.status(500).json({ success: false, error: err.message });
  }
});

// Behind the answer: the prompt into English when it was edited in another language - once for every clip -, then every
// clip of the card asked for, each on its own.
async function _make(o) {
  try {
    const over = { prompt: o.prompt, writer: o.writer, lang: 'en' };
    // A card's prompt edited in another language is translated, as the plain send does - and refused in words when it
    // cannot be. Kling motion control's only before phase V29 (review V7); every model's since (the owner 2026-10-14).
    if (!AGENT.english(o.prompt)) {
      if (!o.ids.some(id => VGENS.ours(id, o.kick))) return;
      for (const id of o.ids) VGENS.stage(id, 'translating the prompt', o.kick);
      const t = await AGENT.toEnglish(o.prompt);
      if (t.fail) { for (const id of o.ids) VGENS.refuse(id, t.fail, o.kick); return; }
      if (t.text && t.text.length > o.max) { for (const id of o.ids) VGENS.refuse(id, 'the English is longer than the model takes (' + t.text.length + ' > ' + o.max + ')', o.kick); return; }
      Object.assign(over, { prompt: t.text, writer: t.translated ? 'translated' : over.writer });
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
router.post('/mv3/video/card/:id/board', async (req, res) => {
  const b = req.body || {};
  let kick = '';
  try {
    const project = String(b.project || '').trim();
    const m = _cardOf(req.params.id, project, ['prompt', 'board']);
    if (!m) return res.status(404).json({ success: false, error: 'no such card' });
    if (!m.card.board) return res.status(400).json({ success: false, error: 'this card has no storyboard' });
    if (m.card.state === 'writing') return res.status(409).json({ success: false, error: 'the prompts are still being written' });
    if (m.card.state === 'failed') return res.status(409).json({ success: false, error: 'the prompts were not written - write them again' });
    // (phases V7.6, V17) Kling's first frame is a PICTURE of the clip's frame with the person's character in it, not a sheet.
    const frame = m.card.board.kind === 'frame';
    const W = frame ? 'picture' : 'storyboard';
    // A made card draws too: it is made again from its field, and another sheet may be what the next attempt follows.
    const typed = String(b.board != null ? b.board : m.card.board.prompt).replace(/\r\n/g, '\n').trim().slice(0, 6000);
    if (!typed) return res.status(400).json({ success: false, error: 'the ' + W + ' prompt is empty' });
    const all = _mediaOf(m.media);
    if (all.error) return res.status(400).json({ success: false, error: all.error });
    const pics = all.media.filter(x => x.kind === 'image');
    // The video it is for must be able to take it, send it and follow it - before the sheet is paid for.
    const seat = frame ? _frameWrong(m.card.model, m.card.agg, m.card.params || {}, all.media)
      : _twoStepWrong(m.card.model, m.card.agg, m.card.params || {}, all.media);
    if (seat) return res.status(400).json({ success: false, error: seat });
    // What the picture model reads: the references in words (the card keeps what was typed).
    const prompt = frame ? _frameWords(_strictRefs(typed), pics.length) : _boardWords(typed, pics.length);
    if (!prompt) return res.status(400).json({ success: false, error: 'the ' + W + ' prompt is empty' });
    const pv = _boardProvider(frame ? pics.length + 1 : pics.length);
    if (pv.error) return res.status(400).json({ success: false, error: pv.error });
    const making = CHAT.boardsOf(m).filter(g => g.state === 'pending').length;
    if (making >= BOARD_AT_ONCE) return res.status(409).json({ success: false, error: BOARD_AT_ONCE + ' ' + W + 's are being drawn already - wait for one' });
    // (review V7) The video's clips and sounds as its rung would take them: no picture is bought for a video that cannot be.
    const vr = _routeOf(m.card.model, m.card.agg, m.card.params || {}, all.media, 'xxx');
    if (!vr.error) {
      const fw = await _filesWrong(vr.fits[0], all.media);
      if (fw) return res.status(400).json({ success: false, error: fw });
    }
    // The first frame's still: the clip's frame at the moment (cut once, `_stillOf`) - on a card that knows its clip's
    // length (phase V17) the moment is where the part starts; on an older one (V7.6) it lies within the part. The picture
    // model gets the still and then every picture of the person, in their numbers.
    let refs = pics.map(x => x.path);
    let at = null;
    if (frame) {
      const clip = all.media.find(x => x.kind === 'video');
      const lo = +clip.in || 0, hi = +clip.out > lo ? +clip.out : lo;
      at = +m.card.board.dur > 0 ? lo
        : Math.round(Math.max(lo, Math.min(hi, b.at != null && Number.isFinite(+b.at) ? +b.at : (+m.card.board.at || lo))) * 100) / 100;
      let still;
      try { still = await _stillOf(m.id, clip, at); }
      catch (e) { return res.status(400).json({ success: false, error: e.message }); }
      refs = [still].concat(pics.map(x => x.path));
    }
    // Its row, once drawn, leads back to the card - the video is chosen and made there.
    const where = _boardWhere(project, b.where);
    // (phase V15) A storyboard of the column is said by the words it was drawn for.
    // (phase V17) Kling's first frame is said by the person's words too, or as what it is.
    const title = m.card.type === 'board' ? _short(m.card.text)
      : frame && m.card.plain ? (_short(m.card.text) || 'first frame') : ((m.card.recipe && m.card.recipe.title) || 'video');
    // (review V7) The awaits above (the clip's checks, the frame cut) leave room for another press or a cleared thread:
    // the card is read again and the count asked again here, in the tick the record is written.
    const m2 = _cardOf(req.params.id, project, ['prompt', 'board']);
    if (!m2 || !m2.card.board) return res.status(409).json({ success: false, error: 'the card is not in the thread any more' });
    if (CHAT.boardsOf(m2).filter(x => x.state === 'pending').length >= BOARD_AT_ONCE) {
      return res.status(409).json({ success: false, error: BOARD_AT_ONCE + ' ' + W + 's are being drawn already - wait for one' });
    }
    kick = 'b' + crypto.randomBytes(8).toString('hex');
    GENS.asking.add(kick);
    const g = GENS.create({
      project, send: m.id, board: true, kick, where, stage: 'asking ' + pv.label, prompt, said: W + ' · ' + title,
      engine: BOARD_ENGINE, provider: pv.provider, quality: frame ? FRAME_QUALITY : BOARD_QUALITY,
      aspect: m.card.board.aspect || (frame ? '9:16' : '16:9'), refs,
    });
    CHAT.update(m.id, (x) => {
      if (!x.card || !x.card.board) return false;
      x.card.board.genIds = (x.card.board.genIds || []).concat([g.id]).slice(-20);
      if (x.card.board.prompt !== typed) {
        x.card.board.prompt = typed;
        x.card.board.edited = true;
        // (phase V16) The variant drawn from keeps the words it was drawn with.
        const v = Array.isArray(x.card.board.versions) ? x.card.board.versions.find(y => y.id === x.card.board.cur) : null;
        if (v) Object.assign(v, { prompt: typed, edited: true });
      }
      if (frame && at != null) x.card.board.at = at;
    });
    res.json({ success: true, genId: g.id, provider: pv.provider });
    (async () => {
      try { await GENS.submit(g.id, { prompt }, kick); }
      catch (e) { console.warn('[mv3-video] ' + W + ':', e.message); }
      finally { GENS.asking.delete(kick); }
    })();
  } catch (err) {
    if (kick) GENS.asking.delete(kick);
    console.error('[mv3-video/board]', err.message);
    if (!res.headersSent) res.status(500).json({ success: false, error: err.message });
  }
});

// (phase V16) A storyboard card's VIDEO prompt - "write the video": the writer writes it from the card's words and
// pictures with the chosen sheet among them (the last picture, `storyboard`); every writing is a variant, and the
// video is made from it by "make the video" (/card/:id/make). Nothing is paid here.
router.post('/mv3/video/card/:id/video', async (req, res) => {
  const b = req.body || {};
  let kick = '';
  try {
    const project = String(b.project || '').trim();
    const m = _cardOf(req.params.id, project, 'board');
    if (!m) return res.status(404).json({ success: false, error: 'no such card' });
    if (m.card.state === 'writing') return res.status(409).json({ success: false, error: 'it is being written' });
    const s = _settings(b);
    if (!VM.MODELS.some(x => x.id === s.model)) return res.status(400).json({ success: false, error: 'no such model: ' + s.model });
    if (_family(s.model) !== 'seedance') return res.status(400).json({ success: false, error: 'a video from a storyboard is made by Seedance - pick a Seedance model' });
    const boards = CHAT.boardsOf(m);
    const ready = boards.filter(CHAT.boardReady);
    const want = String(b.boardId || '');
    const g = (want && ready.find(x => x.id === want)) || ready.find(x => x.id === (m.card.board || {}).chosen) || ready[ready.length - 1] || null;
    if (!g) {
      return res.status(409).json({ success: false, error: boards.some(x => x.state === 'pending')
        ? 'the storyboard is still being drawn - the video follows it' : 'draw the storyboard first - the video follows it' });
    }
    const mm = _mediaOf(m.media);
    if (mm.error) return res.status(400).json({ success: false, error: mm.error });
    const sheet = _mediaOf([{ path: g.imagePath, kind: 'image', role: 'storyboard', label: 'storyboard' }]);
    if (sheet.error) return res.status(400).json({ success: false, error: /R2/.test(sheet.error) ? BOARD_R2 : 'the storyboard is not on the Images shelf any more - choose another, or draw one' });
    const media = mm.media.filter(x => x.kind === 'image').concat(sheet.media, mm.media.filter(x => x.kind !== 'image'));
    const rt = _routeOf(s.model, s.agg, s.params, media, 'xxx');
    if (rt.error) return res.status(400).json({ success: false, error: rt.error });
    if (_writingIn(project) >= WRITE_AT_ONCE) return res.status(409).json({ success: false, error: WRITE_AT_ONCE + ' prompts are being written already - wait for one of them' });
    kick = 'w' + crypto.randomBytes(8).toString('hex');
    CHAT.writing.add(kick);
    const ok = CHAT.update(m.id, (x) => {
      if (!x.card || x.card.state === 'writing') return false;
      Object.assign(x.card, { state: 'writing', writing: 'video', kick, startedAt: new Date().toISOString(), error: '' });
      if (x.card.board) x.card.board.chosen = g.id;
    });
    if (!ok || !ok.card || ok.card.kick !== kick) { CHAT.writing.delete(kick); return res.status(409).json({ success: false, error: 'it changed meanwhile' }); }
    res.json({ success: true, card: m.id, boardId: g.id });
    _writePlain(m.id, kick, { model: s.model, agg: rt.fits[0].agg, text: m.card.text, media, params: s.params, max: rt.fits[0].promptMax, boardId: g.id });
  } catch (err) {
    if (kick) CHAT.writing.delete(kick);
    console.error('[mv3-video/video]', err.message);
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
                                  // (phase V48) What the agent saw of its clips goes with it, as the person left it.
                                  watch: Array.isArray(m.card.watch) ? m.card.watch.filter(w => w && w.state === 'done') : undefined,
                                  // Its storyboards go with it - those asked for again from Alerts too.
                                  board: m.card.board ? Object.assign({}, m.card.board, { genIds: CHAT.boardsOf(m).map(g => g.id).slice(-20) }) : undefined } });
    res.json({ success: true, card: pc.id });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── A clip from this computer ───────────────────────────────────────────────
// Into VIDEO -> Uploads itself, no category (phase V56, (ги4): what is brought into a chat lies in the root of its kind;
// lib/birols-store.js places it, makes its poster, measures it).
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
// Onto the Sounds shelf (lib/sounds-store.js): from the Library into the folder open there (`categoryId`); from a chat
// into SFX -> My sounds itself, no category (phase V56, (ги4)).
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
    const { item } = await require('../lib/sounds-store').add('/media/work/' + req.file.filename, {
      name: String(b.name || '').trim().slice(0, 120) || path.basename(req.file.originalname).replace(/\.[^.]+$/, ''),
      categoryId: String(b.categoryId || ''),
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
