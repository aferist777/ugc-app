'use strict';

// ════════════════════════════════════════════════════════════════════════════
// MERGE — THE FRAMES CHAT of a talking head.
//
// A first frame asked for in words, in Setup (public/js/merge-v3/fchat.js). It is the pictures chat's way of asking -
// the person's turn, a record and an Alerts row for every picture AT THE PRESS, the asking behind the answer
// (lib/mv3-gens.js, paid once, its cross, its retry from Alerts) - with three differences:
//   - what it is told: every attached picture is named by the field it was put in - the base (character and place, or
//     the frame being changed) and the extra ones, said in words (lib/mv3-agent.js FRAME_ROLES) -, the frame is drawn in
//     the project's shape, and a `shot` is where its edge is;
//   - the writer OFF is not "as typed": a light pass puts the words into English and names the
//     pictures, and the frame is drawn at once;
//   - what it makes is the PROJECT's: the picture lands in the project's frames folder (`frame`, `scen` on the record),
//     and `to frames` puts it into the set (routes/scen3.js addChatFrame).
//
//   POST /api/scen3/fchat/send     { project, projectId, text, refs, roles, engine, provider, quality, shot, n, write,
//                                    where } - a message
//   PATCH /api/scen3/fchat/card/:id          { project, ver?, prompt?, cur? } - a written prompt edited, or chosen
//   POST /api/scen3/fchat/card/:id/rewrite   { project, engine } - another variant of the prompt
//   POST /api/scen3/fchat/card/:id/draw      { project, ver, prompt, engine, provider, quality, n, where } - the money
//   POST /api/scen3/fchat/to-set   { genId } - a frame of the chat into the project's set
//   GET  /api/scen3/fchat/feed?project=<key>   the frames this chat made, newest first
// ════════════════════════════════════════════════════════════════════════════

const express = require('express');
const fs = require('fs');
const crypto = require('crypto');
const router = express.Router();

const MV = require('../lib/mv3-img');
const GENS = require('../lib/mv3-gens');
const CHAT = require('../lib/mv3-chat');
const AGENT = require('../lib/mv3-agent');
const { toDiskExisting } = require('../lib/media');
// The interface's words (lib/i18n.js): what is said to the person; every prompt stays English.
const I18N = require('../lib/i18n');

const KIND = 'fchat';
const AT_ONCE = 5;
const COUNTS = [1, 2, 4];
const ROLES = ['character', 'place', 'frame', 'extra', 'product'];
// A picture's role as the page says it; anything else is an extra one.
const _roleOf = (r) => (ROLES.includes(String(r || '')) ? String(r) : 'extra');
const SCEN = () => require('./scen3');
const PROPS = require('../lib/props');

// THE PRODUCTS of a message: a picture in the product place that is a product of IMAGES ->
// Props goes with its name and description (lib/props.js) - anything else there is an extra picture. -> { roles, notes
// (aligned with the pictures: { name, description } of a product, else null), props: [{ path, name, description }] - what the
// frame remembers }.
function _products(refs, roles) {
  const out = { roles: roles.slice(), notes: refs.map(() => null), props: [] };
  refs.forEach((p, i) => {
    if (out.roles[i] !== 'product') return;
    if (!PROPS.isProp(p)) { out.roles[i] = 'extra'; return; }
    const n = PROPS.facts(p);
    out.notes[i] = n;
    out.props.push({ path: String(p).split('?')[0], name: n.name, description: n.description });
  });
  return out;
}

// The talking head a message is for: its timeline key (`sv3_<id>`) and its project, which must be there.
function _projectOf(b) {
  const key = String(b.project || '').trim();
  const m = /^sv3_([^_]+)(?:_\d+)?$/.exec(key);
  const id = String(b.projectId || (m ? m[1] : '')).trim();
  const proj = id ? SCEN().loadProjects().find(p => String(p.id) === id) : null;
  return { key, id, proj };
}

// The frame's edge, said at the end of the prompt as the set says it - a name is a suggestion, an edge is a rule.
const _edgeOf = (facts) => (facts && facts.edge ? 'FRAMING: ' + facts.edge.rule + (facts.edge.cut ? ' ' + facts.edge.cut : '') : '');

router.post('/scen3/fchat/send', (req, res) => {
  const b = req.body || {};
  let kick = '';
  try {
    const { key, id, proj } = _projectOf(b);
    if (!key || !proj) return res.status(400).json({ success: false, error: I18N.t('open a talking head first') });
    const text = String(b.text || '').trim().slice(0, 20000);
    if (!text) return res.status(400).json({ success: false, error: I18N.t('say what the frame is') });
    const engine = String(b.engine || '');
    if (!MV.ENGINES[engine]) return res.status(400).json({ success: false, error: I18N.t('no such model: {engine}', { engine }) });
    const refs = (Array.isArray(b.refs) ? b.refs : []).map(x => String(x || '').split('?')[0]).filter(Boolean).slice(0, 6);
    for (let i = 0; i < refs.length; i++) {
      const abs = toDiskExisting(refs[i]);
      if (!abs || !fs.existsSync(abs)) return res.status(400).json({ success: false, error: I18N.t('picture {n} is not in the library any more', { n: i + 1 }) });
    }
    const pr = _products(refs, refs.map((x, i) => _roleOf((b.roles || [])[i])));
    const roles = pr.roles;
    const n = COUNTS.includes(+b.n) ? +b.n : 1;
    const write = b.write !== false;
    const facts = SCEN().fchatFacts(id, String(b.shot || ''));
    const media = refs.map((p, i) => ({ path: p, kind: 'image', role: roles[i], label: roles[i] }));
    // THE WRITER STOPS FOR A LOOK (as in the video chat): the person's turn and a prompt card, the writer behind the
    // answer, and the frame drawn only from the card (`draw`).
    if (write) {
      if (_writingIn(key) >= WRITE_AT_ONCE) return res.status(409).json({ success: false, error: I18N.tn(WRITE_AT_ONCE, '{n} prompt is being written already - wait for it', '{n} prompts are being written already - wait for one of them') });
      const before = CHAT.read(key, KIND).slice(-4).map(m => ({ role: m.role, text: m.text }));
      const turn = CHAT.add({ project: key, kind: KIND, role: 'user', text, refs, media });
      const kickW = 'w' + crypto.randomBytes(8).toString('hex');
      CHAT.writing.add(kickW);
      let card;
      try {
        card = CHAT.add({ project: key, kind: KIND, role: 'agent', text: '', refs, media,
                          card: { type: 'prompt', plain: true, state: 'writing', kick: kickW, startedAt: new Date().toISOString(),
                                  from: turn.id, text, model: engine, params: { shot: String(b.shot || '') }, versions: [] } });
      } catch (e) { CHAT.writing.delete(kickW); throw e; }
      // The idea the words came from is used now.
      _ideaUsed(b.idea, key);
      res.json({ success: true, send: card.id, card: card.id, review: true });
      _writeCard(card.id, kickW, { id, engine, text, refs, roles, notes: pr.notes, facts, before });
      return;
    }
    if (GENS.runningSends(key, true) >= AT_ONCE) {
      return res.status(409).json({ success: false, error: I18N.tn(AT_ONCE, '{n} message is being drawn already - wait for it', '{n} messages are being drawn already - wait for one of them') });
    }
    const aspect = (facts && facts.format) || '9:16';
    const msgId = CHAT.newId();
    kick = 'k' + crypto.randomBytes(8).toString('hex');
    GENS.asking.add(kick);
    CHAT.add({ project: key, kind: KIND, role: 'user', text, refs, media });
    const ids = [];
    for (let i = 0; i < n; i++) {
      ids.push(GENS.create({
        project: key, send: msgId, kick, where: b.where, stage: I18N.t('reading your message'),
        engine, provider: b.provider, prompt: text, said: text, aspect, quality: b.quality, refs,
        frame: true, scen: id, shot: String(b.shot || ''), props: pr.props,
      }).id);
    }
    // The words on the answer itself: the message is drawn whole - what was asked over what came of it.
    CHAT.add({ id: msgId, project: key, kind: KIND, role: 'agent', text: '', genId: ids[0], genIds: ids, refs, media, asked: text });
    _ideaUsed(b.idea, key);
    res.json({ success: true, send: msgId, genIds: ids });
    _light({ text, roles, notes: pr.notes, edge: _edgeOf(facts), ids, kick });
  } catch (err) {
    if (kick) GENS.asking.delete(kick);
    console.error('[fchat/send]', err.message);
    if (!res.headersSent) res.status(500).json({ success: false, error: err.message });
  }
});

// Behind the answer, with the writer off: the light pass, then every picture asked for. The pass never stops the work -
// unanswered, the words go as typed with the pictures named, and `fell` says so.
async function _light(o) {
  try {
    let over;
    try {
      const t = await AGENT.frameLight({ text: o.text, roles: o.roles, notes: o.notes, edge: o.edge });
      over = { prompt: t.prompt, fell: t.fell || '', writer: t.writer || '' };
    } catch (err) {
      over = { prompt: [o.text, AGENT.frameListing(o.roles, o.notes), o.edge].filter(Boolean).join('\n\n'), fell: I18N.t('the writer could not be reached') };
    }
    await Promise.all(o.ids.map(id => GENS.submit(id, over, o.kick)));
  } catch (err) {
    console.warn('[fchat] send:', err.message);
  } finally {
    GENS.asking.delete(o.kick);
  }
}

// ── The writer's card ───────────────────────────────────────────────────────
const WRITE_AT_ONCE = 3;
const _verId = () => 'v' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex');
const _writingIn = (key) => CHAT.read(key, KIND).filter(m => m.card && m.card.state === 'writing').length;
// Where a card stands when its writer is done: drawn from, written, or failed with nothing at all.
const _rest = (x) => ((x.card.sends || []).length || (x.genIds || []).length ? 'sent' : (x.card.versions || []).length ? 'ready' : 'failed');

// Every writing is a VARIANT of the prompt (at most 10), the newest chosen; one that fails leaves the variants there
// were and says why. Filed only while the card still waits for THIS writer. The writer LOOKS at the pictures (hosted
// once - the same bytes are one upload); pictures it cannot see, it writes without.
// What the writer and the ideas must know of the look - a covered face, the clothes - read now if it never was
// (routes/scen3.js _fchatRead). Unanswered, the chat goes on without it.
async function _factsRead(id, shot) {
  try { await SCEN().fchatRead(id); } catch (e) { console.warn('[fchat] the look and the place were not read: ' + e.message); }
  return SCEN().fchatFacts(id, shot);
}

async function _writeCard(cardId, kick, o) {
  let out;
  try {
    o.facts = await _factsRead(o.id, ((o.facts || {}).edge || {}).id || '');
    let picUrls = [];
    try { picUrls = await GENS.hostRefs(o.refs); } catch (e) { picUrls = []; }
    const t = await AGENT.thinkShot({ engine: o.engine, text: o.text, roles: o.roles, notes: o.notes, facts: o.facts, picUrls, thread: o.before || [] });
    out = t.prompt ? { prompt: t.prompt, writer: t.writer || '' } : { error: t.fail || I18N.t('the writer answered nothing usable - write it again') };
  } catch (e) {
    out = { error: I18N.t('the writer broke off: {why}', { why: String(e.message || e).slice(0, 300) }) };
  }
  try {
    CHAT.update(cardId, (m) => {
      if (!m.card || m.card.kick !== kick || m.card.state !== 'writing') return false;
      if (out.prompt) {
        const v = { id: _verId(), at: new Date().toISOString(), model: o.engine, prompt: out.prompt, writer: out.writer, edited: false };
        m.card.versions = (m.card.versions || []).concat([v]).slice(-10);
        Object.assign(m.card, { cur: v.id, prompt: v.prompt, model: v.model, writer: v.writer, edited: false, error: '' });
      } else m.card.error = out.error;
      m.card.writing = '';
      m.card.state = _rest(m);
    });
  } finally { CHAT.writing.delete(kick); }
}

// The card of this chat, by its id, in this project: { m } or { status, error }.
function _cardOf(req) {
  const b = req.body || {};
  const m = CHAT.get(String(req.params.id || ''));
  if (!m || !m.card || m.card.type !== 'prompt' || String(m.kind || '') !== KIND) return { status: 404, error: I18N.t('no such card') };
  if (String(b.project || '') && String(m.project || '') !== String(b.project)) return { status: 400, error: I18N.t('the card is not this project\'s') };
  return { m };
}

router.patch('/scen3/fchat/card/:id', (req, res) => {
  try {
    const b = req.body || {};
    const c = _cardOf(req);
    if (c.error) return res.status(c.status).json({ success: false, error: c.error });
    const m = CHAT.update(c.m.id, (x) => {
      const vs = x.card.versions || [];
      if (b.cur != null) {
        const v = vs.find(y => y.id === String(b.cur));
        if (!v) return false;
        Object.assign(x.card, { cur: v.id, prompt: v.prompt, model: v.model, writer: v.writer, edited: !!v.edited });
        return undefined;
      }
      if (b.prompt == null) return false;
      const v = vs.find(y => y.id === String(b.ver || x.card.cur || ''));
      if (!v) return false;
      const p = String(b.prompt).slice(0, 20000);
      if (p === v.prompt) return false;
      Object.assign(v, { prompt: p, edited: true });
      if (x.card.cur === v.id) Object.assign(x.card, { prompt: p, edited: true });
      return undefined;
    });
    res.json({ success: true, card: m && m.card });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/scen3/fchat/card/:id/rewrite', (req, res) => {
  try {
    const b = req.body || {};
    const c = _cardOf(req);
    if (c.error) return res.status(c.status).json({ success: false, error: c.error });
    const m = c.m;
    if (m.card.state === 'writing') return res.status(409).json({ success: false, error: I18N.t('it is being written') });
    const engine = MV.ENGINES[String(b.engine || '')] ? String(b.engine) : (m.card.model || '');
    const key = String(m.project || '');
    if (_writingIn(key) >= WRITE_AT_ONCE) return res.status(409).json({ success: false, error: I18N.tn(WRITE_AT_ONCE, '{n} prompt is being written already - wait for it', '{n} prompts are being written already - wait for one of them') });
    const media = Array.isArray(m.media) ? m.media : [];
    const refs = media.map(a => String(a.path || '')).filter(Boolean);
    for (let i = 0; i < refs.length; i++) {
      const abs = toDiskExisting(refs[i]);
      if (!abs || !fs.existsSync(abs)) return res.status(400).json({ success: false, error: I18N.t('picture {n} is not in the library any more', { n: i + 1 }) });
    }
    const pr = _products(refs, media.map(a => _roleOf(a.role)));
    const roles = pr.roles;
    const { id } = _projectOf({ project: key });
    const facts = SCEN().fchatFacts(id, String((m.card.params || {}).shot || ''));
    const kickW = 'w' + crypto.randomBytes(8).toString('hex');
    CHAT.writing.add(kickW);
    CHAT.update(m.id, (x) => { Object.assign(x.card, { state: 'writing', kick: kickW, startedAt: new Date().toISOString(), error: '' }); });
    res.json({ success: true, card: m.id });
    _writeCard(m.id, kickW, { id, engine, text: m.card.text || '', refs, roles, notes: pr.notes, facts, before: [] });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// The money: the prompt as it stands in the card (edited or not) to the model of the column, n pictures, each its own
// record and Alerts row at the press - the asking behind the answer, with no pass of any writer.
router.post('/scen3/fchat/card/:id/draw', (req, res) => {
  const b = req.body || {};
  let kick = '';
  try {
    const c = _cardOf(req);
    if (c.error) return res.status(c.status).json({ success: false, error: c.error });
    const m = c.m;
    if (m.card.state === 'writing') return res.status(409).json({ success: false, error: I18N.t('the prompt is being written') });
    const vs = m.card.versions || [];
    const ver = vs.some(v => v.id === String(b.ver || '')) ? String(b.ver) : (m.card.cur || '');
    const v = vs.find(y => y.id === ver);
    const prompt = String(b.prompt != null ? b.prompt : (v ? v.prompt : '')).trim().slice(0, 20000);
    if (!prompt) return res.status(400).json({ success: false, error: I18N.t('the prompt is empty') });
    const engine = String(b.engine || '');
    if (!MV.ENGINES[engine]) return res.status(400).json({ success: false, error: I18N.t('no such model: {engine}', { engine }) });
    const key = String(m.project || '');
    const { id, proj } = _projectOf({ project: key });
    if (!proj) return res.status(400).json({ success: false, error: I18N.t('the project of this card is gone') });
    const refs = (Array.isArray(m.media) ? m.media : []).map(a => String(a.path || '')).filter(Boolean);
    for (let i = 0; i < refs.length; i++) {
      const abs = toDiskExisting(refs[i]);
      if (!abs || !fs.existsSync(abs)) return res.status(400).json({ success: false, error: I18N.t('picture {n} is not in the library any more', { n: i + 1 }) });
    }
    if (GENS.runningSends(key, true) >= AT_ONCE) {
      return res.status(409).json({ success: false, error: I18N.tn(AT_ONCE, '{n} message is being drawn already - wait for it', '{n} messages are being drawn already - wait for one of them') });
    }
    const n = COUNTS.includes(+b.n) ? +b.n : 1;
    const facts = SCEN().fchatFacts(id, String((m.card.params || {}).shot || ''));
    const aspect = (facts && facts.format) || '9:16';
    // The frame remembers its products.
    const pr = _products(refs, (Array.isArray(m.media) ? m.media : []).filter(a => a && a.path).map(a => _roleOf(a.role)));
    kick = 'k' + crypto.randomBytes(8).toString('hex');
    GENS.asking.add(kick);
    const ids = [];
    for (let i = 0; i < n; i++) {
      ids.push(GENS.create({
        project: key, send: m.id, kick, where: b.where, stage: I18N.t('asking {who}', { who: b.provider || I18N.t('the model') }),
        engine, provider: b.provider, prompt, said: m.card.text || prompt, aspect, quality: b.quality, refs,
        frame: true, scen: id, shot: String((m.card.params || {}).shot || ''), props: pr.props,
      }).id);
    }
    CHAT.update(m.id, (x) => {
      const at = new Date().toISOString();
      x.card.sends = (x.card.sends || []).concat([{ at, n, genIds: ids, ver }]);
      x.card.state = 'sent';
      const y = ver ? (x.card.versions || []).find(z => z.id === ver) : null;
      if (y) { if (y.prompt !== prompt) Object.assign(y, { prompt, edited: true }); Object.assign(x.card, { cur: y.id, prompt, edited: !!y.edited }); }
      x.genIds = (x.genIds || []).concat(ids).slice(-40);
      x.genId = x.genIds[0];
    });
    res.json({ success: true, card: m.id, genIds: ids });
    (async () => {
      try { await Promise.all(ids.map(gid => GENS.submit(gid, { prompt, writer: m.card.writer || '' }, kick))); }
      catch (e) { console.warn('[fchat/draw]', e.message); }
      finally { GENS.asking.delete(kick); }
    })();
  } catch (err) {
    if (kick) GENS.asking.delete(kick);
    console.error('[fchat/draw]', err.message);
    if (!res.headersSent) res.status(500).json({ success: false, error: err.message });
  }
});

// ── `ideas`: a button to analyse the pictures and offer variants ──
// The agent looks at what is in the zone - the person's sheet and the place (or the frame being changed) and the extra
// pictures - and answers six frames in words, as a message of the thread; each is a press away from the message box, and
// one a message went from is marked used. Asked again, it looks again. Seconds and fractions of a cent: no Alerts row.
function _ideaUsed(idea, key) {
  if (!idea || typeof idea !== 'object' || !idea.id) return;
  const i = parseInt(idea.i, 10);
  if (!(i >= 0)) return;
  try {
    CHAT.update(String(idea.id), (m) => {
      if (!Array.isArray(m.ideas) || String(m.project || '') !== String(key) || i >= m.ideas.length) return false;
      const used = Array.isArray(m.used) ? m.used.map(Number) : [];
      if (used.includes(i)) return false;
      m.used = used.concat([i]);
      return undefined;
    });
  } catch (e) { /* a mark, not the send */ }
}
router.post('/scen3/fchat/ideas', async (req, res) => {
  try {
    const b = req.body || {};
    const { key, id, proj } = _projectOf(b);
    if (!key || !proj) return res.status(400).json({ success: false, error: I18N.t('open a talking head first') });
    const refs = (Array.isArray(b.refs) ? b.refs : []).map(x => String(x || '').split('?')[0]).filter(Boolean).slice(0, 8);
    const pr = _products(refs, refs.map((x, i) => _roleOf((b.roles || [])[i])));
    const roles = pr.roles;
    if (!roles.includes('character') && !roles.includes('place') && !roles.includes('frame')) return res.status(400).json({ success: false, error: I18N.t('put the person or the place above the box first') });
    for (let i = 0; i < refs.length; i++) {
      const abs = toDiskExisting(refs[i]);
      if (!abs || !fs.existsSync(abs)) return res.status(400).json({ success: false, error: I18N.t('picture {n} is not in the library any more', { n: i + 1 }) });
    }
    // Everything in the zone: the base and the extra pictures.
    const keep = refs.map((p, i) => i);
    const facts = await _factsRead(id, String(b.shot || ''));
    let picUrls = [];
    try { picUrls = await GENS.hostRefs(keep.map(i => refs[i])); } catch (e) { picUrls = []; }
    const t = await AGENT.frameIdeas({ roles: keep.map(i => roles[i]), notes: keep.map(i => pr.notes[i]), facts, picUrls });
    if (!t.ideas) return res.status(502).json({ success: false, error: t.fail || I18N.t('no ideas came back') });
    const media = keep.map(i => ({ path: refs[i], kind: 'image', role: roles[i], label: roles[i] }));
    const m = CHAT.add({ project: key, kind: KIND, role: 'agent', text: I18N.t('Ideas for a frame - press one to put it into the box.'), refs: media.map(a => a.path), media, ideas: t.ideas });
    res.json({ success: true, id: m.id, ideas: t.ideas });
  } catch (e) {
    console.error('[fchat/ideas]', e.message);
    if (!res.headersSent) res.status(500).json({ success: false, error: e.message });
  }
});

// ONE idea of an ideas message asked again: a VARIATION of it in its place - the agent shown the
// pictures the ideas were made with (their numbers stay true), the other ideas so it repeats none. Its "used" goes.
// { project, projectId, id, i, shot } -> { idea }. Fractions of a cent: no Alerts row; one at a time per idea (409).
const _againNow = new Set();
router.post('/scen3/fchat/ideas/again', async (req, res) => {
  const b = req.body || {};
  const i = parseInt(b.i, 10);
  const lock = String(b.id || '') + ':' + i;
  let mine = false;
  try {
    const { key, id, proj } = _projectOf(b);
    if (!key || !proj) return res.status(400).json({ success: false, error: I18N.t('open a talking head first') });
    const m = CHAT.get(b.id);
    if (!m || !Array.isArray(m.ideas) || String(m.project || '') !== String(key)) return res.status(404).json({ success: false, error: I18N.t('those ideas are gone') });
    if (!(i >= 0 && i < m.ideas.length)) return res.status(400).json({ success: false, error: I18N.t('no such idea') });
    if (_againNow.has(lock)) return res.status(409).json({ success: false, error: I18N.t('this idea is being written again already') });
    const media = (Array.isArray(m.media) ? m.media : []).filter(a => a && a.path);
    const refs = media.map(a => String(a.path).split('?')[0]);
    for (let k = 0; k < refs.length; k++) {
      const abs = toDiskExisting(refs[k]);
      if (!abs || !fs.existsSync(abs)) return res.status(400).json({ success: false, error: I18N.t('picture {n} of these ideas is not in the library any more - ask for new ideas', { n: k + 1 }) });
    }
    _againNow.add(lock);
    mine = true;
    const pr = _products(refs, media.map(a => _roleOf(a.role)));
    const facts = await _factsRead(id, String(b.shot || ''));
    let picUrls = [];
    try { picUrls = await GENS.hostRefs(refs); } catch (e) { picUrls = []; }
    const t = await AGENT.frameIdeas({ roles: pr.roles, notes: pr.notes, facts, picUrls,
      again: { idea: m.ideas[i], others: m.ideas.filter((x, k) => k !== i) } });
    if (!t.ideas || !t.ideas[0]) return res.status(502).json({ success: false, error: t.fail || I18N.t('no idea came back') });
    const idea = String(t.ideas[0]).trim().slice(0, 600);
    const now = CHAT.update(m.id, (x) => {
      if (!Array.isArray(x.ideas) || i >= x.ideas.length) return false;
      x.ideas[i] = idea;
      x.used = (Array.isArray(x.used) ? x.used.map(Number) : []).filter(k => k !== i);
      return undefined;
    });
    if (!now) return res.status(404).json({ success: false, error: I18N.t('those ideas are gone') });
    res.json({ success: true, idea });
  } catch (e) {
    console.error('[fchat/ideas/again]', e.message);
    if (!res.headersSent) res.status(500).json({ success: false, error: e.message });
  } finally {
    if (mine) _againNow.delete(lock);
  }
});

// `to frames`: a frame of this chat into the project's set - it joins the pool like any frame.
router.post('/scen3/fchat/to-set', async (req, res) => {
  try {
    const g = GENS.get(String((req.body || {}).genId || ''));
    if (!g || !g.frame || g.state !== 'done' || !g.imagePath) return res.status(400).json({ success: false, error: I18N.t('this frame is not ready') });
    const proj = SCEN().loadProjects().find(p => String(p.id) === String(g.scen || ''));
    if (!proj) return res.status(404).json({ success: false, error: I18N.t('the project of this frame is gone') });
    const abs = toDiskExisting(g.imagePath);
    if (!abs || !fs.existsSync(abs)) return res.status(400).json({ success: false, error: I18N.t('the frame is not on the disk any more') });
    // The frame keeps the edge it was asked with - the clip's writer reads its shot from it.
    // ...and the products it was drawn with - the clip's writers read them.
    const out = await SCEN().addChatFrame(proj.id, { path: g.imagePath, prompt: g.prompt, genId: g.id, shot: g.shot || '', props: g.props || [] });
    res.json(Object.assign({ success: true }, out));
  } catch (e) {
    console.error('[fchat/to-set]', e.message);
    res.status(e.status || 500).json({ success: false, error: e.message });
  }
});

// The frames this chat made in a project, newest first - for the picker's "this project's frames".
router.get('/scen3/fchat/feed', (req, res) => {
  try {
    const key = String(req.query.project || '');
    const items = key ? GENS.list(key).filter(g => g && g.frame && g.state === 'done' && g.imagePath)
      .map(g => ({ id: g.id, imagePath: g.imagePath, prompt: g.said || g.prompt || '', at: g.at, aspect: g.aspect })) : [];
    res.json({ success: true, items });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
