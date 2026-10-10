'use strict';

// ════════════════════════════════════════════════════════════════════════════
// MERGE — THE FRAMES CHAT of a talking head (phase V26.5, the owner 2026-10-10; docs/local-app/PLAN.md "V26.5").
//
// A first frame asked for in words, in Setup (public/js/merge-v3/fchat.js). It is the pictures chat's way of asking -
// the person's turn, a record and an Alerts row for every picture AT THE PRESS, the asking behind the answer
// (lib/mv3-gens.js, paid once, its cross, its retry from Alerts) - with three differences:
//   - what it is told: every attached picture is named by the place it was put in (character, place, frame, prop,
//     other - lib/mv3-agent.js FRAME_ROLES), the frame is drawn in the project's shape, and a `shot` is where its edge is;
//   - the writer OFF is not "as typed" (the owner's answer (g)): a light pass puts the words into English and names the
//     pictures, and the frame is drawn at once;
//   - what it makes is the PROJECT's: the picture lands in the project's frames folder (`frame`, `scen` on the record),
//     and `to frames` puts it into the set (routes/scen3.js addChatFrame).
//
//   POST /api/scen3/fchat/send     { project, projectId, text, refs, roles, engine, provider, quality, shot, n, write,
//                                    where } - a message
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
const OWN = require('../lib/ownership');
const { toDiskExisting } = require('../lib/media');

const KIND = 'fchat';
const AT_ONCE = 5;
const COUNTS = [1, 2, 4];
const ROLES = ['character', 'place', 'frame', 'prop', ''];
const SCEN = () => require('./scen3');

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
    if (!key || !proj) return res.status(400).json({ success: false, error: 'open a talking head first' });
    if (!OWN.canEdit(proj, req.user)) return OWN.refuse(res, proj);
    const text = String(b.text || '').trim().slice(0, 20000);
    if (!text) return res.status(400).json({ success: false, error: 'say what the frame is' });
    const engine = String(b.engine || '');
    if (!MV.ENGINES[engine]) return res.status(400).json({ success: false, error: 'no such model: ' + engine });
    const refs = (Array.isArray(b.refs) ? b.refs : []).map(x => String(x || '').split('?')[0]).filter(Boolean).slice(0, 8);
    for (let i = 0; i < refs.length; i++) {
      const abs = toDiskExisting(refs[i]);
      if (!abs || !fs.existsSync(abs)) return res.status(400).json({ success: false, error: 'picture ' + (i + 1) + ' is not in the library any more' });
    }
    const roles = refs.map((x, i) => (ROLES.includes(String((b.roles || [])[i] || '')) ? String(b.roles[i] || '') : ''));
    const n = COUNTS.includes(+b.n) ? +b.n : 1;
    const write = b.write !== false;
    // (block C) The writer that stops for a look.
    if (write) return res.status(400).json({ success: false, error: 'the writer is not ready yet - untick it to send' });
    if (GENS.runningSends(key, true) >= AT_ONCE) {
      return res.status(409).json({ success: false, error: AT_ONCE + ' messages are being drawn already - wait for one of them' });
    }
    const facts = SCEN().fchatFacts(id, String(b.shot || ''));
    const aspect = (facts && facts.format) || '9:16';
    const msgId = CHAT.newId();
    kick = 'k' + crypto.randomBytes(8).toString('hex');
    GENS.asking.add(kick);
    const media = refs.map((p, i) => ({ path: p, kind: 'image', role: roles[i], label: roles[i] }));
    CHAT.add({ project: key, kind: KIND, role: 'user', text, refs, media });
    const ids = [];
    for (let i = 0; i < n; i++) {
      ids.push(GENS.create({
        project: key, send: msgId, kick, where: b.where, stage: 'reading your message',
        engine, provider: b.provider, prompt: text, said: text, aspect, quality: b.quality, refs,
        frame: true, scen: id,
      }).id);
    }
    CHAT.add({ id: msgId, project: key, kind: KIND, role: 'agent', text: '', genId: ids[0], genIds: ids, refs, media });
    res.json({ success: true, send: msgId, genIds: ids });
    _light({ text, roles, edge: _edgeOf(facts), ids, kick });
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
      const t = await AGENT.frameLight({ text: o.text, roles: o.roles, edge: o.edge });
      over = { prompt: t.prompt, fell: t.fell || '', writer: t.writer || '' };
    } catch (err) {
      over = { prompt: [o.text, AGENT.frameListing(o.roles), o.edge].filter(Boolean).join('\n\n'), fell: 'the writer could not be reached' };
    }
    await Promise.all(o.ids.map(id => GENS.submit(id, over, o.kick)));
  } catch (err) {
    console.warn('[fchat] send:', err.message);
  } finally {
    GENS.asking.delete(o.kick);
  }
}

// `to frames`: a frame of this chat into the project's set - it joins the pool like any frame.
router.post('/scen3/fchat/to-set', async (req, res) => {
  try {
    const g = GENS.get(String((req.body || {}).genId || ''));
    if (!g || !g.frame || g.state !== 'done' || !g.imagePath) return res.status(400).json({ success: false, error: 'this frame is not ready' });
    const proj = SCEN().loadProjects().find(p => String(p.id) === String(g.scen || ''));
    if (!proj) return res.status(404).json({ success: false, error: 'the project of this frame is gone' });
    if (!OWN.canEdit(proj, req.user)) return OWN.refuse(res, proj);
    const abs = toDiskExisting(g.imagePath);
    if (!abs || !fs.existsSync(abs)) return res.status(400).json({ success: false, error: 'the frame is not on the disk any more' });
    const out = await SCEN().addChatFrame(proj.id, { path: g.imagePath, prompt: g.prompt, genId: g.id });
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
