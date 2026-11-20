'use strict';

// THE ASSISTANT - a chat with a model of the agents' ladder on every page (js/assistant/assistant.js), in two modes:
// Ideas (brainstorming videos, music and prompts for the app's generators) and Help (how to do things in the app).
//
//   GET    /api/assistant/models              the models that can be asked now, and the one a new chat takes
//   GET    /api/assistant/guide               the guide's table of contents - its chapters and their sections
//   GET    /api/assistant/chats?mode=ideas    the chats of a mode, the newest first; `running` - the ids answering now
//   POST   /api/assistant/chats               { mode, step } -> a new empty chat
//   GET    /api/assistant/chats/:id           the chat whole; `live` - the answer being written now, so far
//   PATCH  /api/assistant/chats/:id           { title } (renamed by hand) | { step } (another model for it)
//   DELETE /api/assistant/chats/:id           gone - its answer stopped first
//   POST   /api/assistant/chats/:id/send      { text, attach: [{ kind, ref }] } -> the answer AS IT IS WRITTEN: lines of
//                                             JSON (application/x-ndjson) - user, step, delta, replace, done | error
//   POST   /api/assistant/chats/:id/stop      the answer ends where it is
//
// HELP answers in two calls: the model picks 1-3 chapters of the guide by its table of contents, then answers by them
// alone (lib/assistant-know.js); the answer keeps the section it pointed at (`guide`) - "Guide: <section>" under it.
// The person's message is kept before anything is asked; the answer is kept when it ends - written whole, stopped or
// broken off with its reason. A page that goes away does not stop it: the answer is written to the end and kept, and the
// chat shows it again (`live` while it is being written). Not a generation: no journal row, no Alerts.
// With the fake aggregator on, the answer is "[fake] …" in pieces, nothing asked.

const express = require('express');
const STORE = require('../lib/assistant-store');
const KNOW = require('../lib/assistant-know');
const AGENTS = require('../lib/agents');
const FAKE = require('../lib/fake-agg');
const I18N = require('../lib/i18n');

const router = express.Router();
const TEXT_MAX = 20000;
// The answers being written: chat id -> { ctl, text, by, at }.
const _live = new Map();

const _bad = (res, code, error) => res.status(code).json({ success: false, error });

// The models a chat can be given: every model of an aggregator that can be asked now, the ladder's steps first.
function _models() {
  const st = AGENTS.state();
  const live = new Set(st.providers.filter(p => !p.off).map(p => p.id));
  const out = [];
  const seen = new Set();
  const add = (provider, model, inLadder) => {
    const k = provider + '|' + model;
    if (seen.has(k) || !live.has(provider)) return;
    seen.add(k);
    const p = st.providers.find(x => x.id === provider);
    out.push({ provider, model, label: AGENTS.labelOf({ provider, model }), group: p.label, ladder: inLadder, unproven: !!p.unproven });
  };
  st.ladder.forEach(s => add(s.provider, s.model, true));
  for (const p of st.providers) for (const m of p.models) add(p.id, m.id, false);
  const first = out[0] || null;
  return { models: out, def: first ? { provider: first.provider, model: first.model } : null,
           off: st.providers.filter(p => p.off).map(p => ({ id: p.id, label: p.label, why: p.off })) };
}

const _stepOk = (s) => !!(s && s.provider && s.model && AGENTS.PROVIDERS.some(p => p.id === s.provider && p.models.some(m => m.id === s.model)));

router.get('/assistant/models', (req, res) => {
  try { res.json({ success: true, ...(FAKE.on() ? Object.assign(_models(), { fake: true }) : _models()) }); }
  catch (e) { _bad(res, 500, e.message); }
});

router.get('/assistant/guide', (req, res) => {
  try { res.json({ success: true, chapters: KNOW.contents(), base: KNOW.guideBase() }); }
  catch (e) { _bad(res, 500, e.message); }
});

router.get('/assistant/chats', (req, res) => {
  try {
    const mode = STORE.MODES.includes(String(req.query.mode || '')) ? String(req.query.mode) : '';
    res.json({ success: true, chats: STORE.list(mode), running: [..._live.keys()] });
  } catch (e) { _bad(res, 500, e.message); }
});

router.post('/assistant/chats', (req, res) => {
  try {
    const b = req.body || {};
    const mode = STORE.MODES.includes(b.mode) ? b.mode : 'ideas';
    const step = _stepOk(b.step) ? { provider: b.step.provider, model: b.step.model } : null;
    const c = STORE.create(mode, step);
    res.json({ success: true, chat: c, summary: STORE.summary(c) });
  } catch (e) { _bad(res, 500, e.message); }
});

const _livePart = (id) => {
  const L = _live.get(id);
  return L ? { text: L.text, by: L.by, at: L.at } : null;
};

router.get('/assistant/chats/:id', (req, res) => {
  const c = STORE.get(req.params.id);
  if (!c) return _bad(res, 404, I18N.t('no such chat'));
  res.json({ success: true, chat: c, summary: STORE.summary(c), live: _livePart(c.id) });
});

router.patch('/assistant/chats/:id', (req, res) => {
  const b = req.body || {};
  let bad = '';
  const c = STORE.apply(req.params.id, (x) => {
    if (b.title != null) {
      const t = String(b.title).replace(/\s+/g, ' ').trim().slice(0, STORE.TITLE_MAX);
      if (!t) { bad = I18N.t('a name is needed'); return false; }
      x.title = t;
      x.named = true;
    }
    if (b.step !== undefined) {
      if (b.step && !_stepOk(b.step)) { bad = I18N.t('not a model of this app'); return false; }
      x.step = b.step ? { provider: b.step.provider, model: b.step.model } : null;
    }
    return true;
  });
  if (bad) return _bad(res, 400, bad);
  if (!c) return _bad(res, 404, I18N.t('no such chat'));
  res.json({ success: true, chat: c, summary: STORE.summary(c) });
});

router.delete('/assistant/chats/:id', (req, res) => {
  const id = String(req.params.id || '');
  if (!STORE.get(id)) return _bad(res, 404, I18N.t('no such chat'));
  const L = _live.get(id);
  if (L) { L.gone = true; L.ctl.abort(); }
  STORE.remove(id);
  res.json({ success: true });
});

router.post('/assistant/chats/:id/stop', (req, res) => {
  const L = _live.get(String(req.params.id || ''));
  if (L) L.ctl.abort();
  res.json({ success: true, stopped: !!L });
});

// The conversation as the model reads it: the system text, then every turn - a message with what was attached to it in
// words before its own text.
function _messages(c, system) {
  const out = [{ role: 'system', content: system }];
  for (const m of c.messages) {
    if (m.role === 'user') out.push({ role: 'user', content: (m.context ? m.context + '\n\n' : '') + String(m.text || '') });
    else if (String(m.text || '').trim()) out.push({ role: 'assistant', content: String(m.text) });
  }
  // Two answers or two messages in a row (one stopped before a word) are joined by the aggregators; nothing to mend.
  return out;
}

// The fake model: a stock answer in pieces, a prompt block in Ideas. `?fail` - no word at all; `?cut` - broken off midway.
async function _fake(c, text, o) {
  const first = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (/\?fail\b/.test(text)) { await new Promise(r => setTimeout(r, 600)); return { text: '', by: null, tried: ['fake - refused'], error: 'the fake model refused' }; }
  const answer = c.mode === 'help'
    ? '[fake] How to do it - "' + first + '":\n\n1. Open **Merge** in the top strip.\n2. Press `+ new project` and choose the kind.\n3. Follow the steps on the left.\n\nThe guide says more under *Merge*.'
    : '[fake] Three ideas for "' + first + '":\n\n## Hooks\n- **The stress test** - the cup upside down over a laptop.\n- **The receipt** - a year of paper cups in one pile.\n- *The morning race* - one hand, one cup, no lid.\n\n```prompt Seedance 2.5 · video chat\nA woman shakes a closed coffee cup upside down over a white sofa, handheld close-up, morning light, not a drop falls.\n```\n\nWant music for it as well?';
  const step = { provider: 'fake', model: 'fake' };
  if (o.onStep) o.onStep(step);
  const cutAt = /\?cut\b/.test(text) ? Math.floor(answer.length / 2) : -1;
  let out = '';
  for (let i = 0; i < answer.length; i += 14) {
    if (o.signal.aborted) return { text: out, by: step, tried: ['fake'], stopped: true, usage: null, usd: 0 };
    if (cutAt >= 0 && i >= cutAt) return { text: out, by: step, tried: ['fake'], error: 'the fake model broke off', usage: null, usd: 0 };
    await new Promise(r => setTimeout(r, 70));
    const piece = answer.slice(i, i + 14);
    out += piece;
    o.onDelta(piece);
  }
  return { text: out, by: step, tried: ['fake'], usage: { in: 0, out: 0 }, usd: 0 };
}

// The fake model's pick: the book's first chapter and its first section.
function _fakePick() {
  const ch = KNOW.book()[0];
  if (!ch) return { chapters: [], at: null, usage: null, usd: 0 };
  const s = ch.sections[0];
  return { chapters: [ch.id], at: { chapter: ch.id, section: s ? s.id : '', title: ch.title + (s ? ' › ' + s.title : '') }, usage: null, usd: 0 };
}

// Two usages, two prices: added up; a price is unknown only when neither call said one.
const _sumUsage = (a, b) => (!a && !b ? null : ['in', 'out', 'cacheRead', 'cacheWrite'].reduce((o, k) => {
  const v = (+((a || {})[k]) || 0) + (+((b || {})[k]) || 0);
  if (v) o[k] = v;
  return o;
}, { in: 0, out: 0 }));
const _sumUsd = (a, b) => (a == null && b == null ? null : (+a || 0) + (+b || 0));

router.post('/assistant/chats/:id/send', async (req, res) => {
  const id = String(req.params.id || '');
  const b = req.body || {};
  const text = String(b.text || '').trim();
  if (!text) return _bad(res, 400, I18N.t('nothing to send'));
  if (text.length > TEXT_MAX) return _bad(res, 400, I18N.tn(text.length, 'the message is {n} characters - up to {max}', 'the message is {n} characters - up to {max}', { max: TEXT_MAX }));
  if (_live.has(id)) return _bad(res, 409, I18N.t('this chat is answering - stop it first'));
  const was = STORE.get(id);
  if (!was) return _bad(res, 404, I18N.t('no such chat'));
  if (was.mode !== 'ideas' && Array.isArray(b.attach) && b.attach.length) return _bad(res, 400, I18N.t('nothing is attached in Help'));
  const items = was.mode === 'ideas' ? KNOW.attached(b.attach) : [];
  const userMsg = { id: STORE.newId('m'), role: 'user', text, at: new Date().toISOString(),
                    attached: items.map(a => ({ kind: a.kind, ref: a.ref, name: a.name })), context: KNOW.contextOf(items) };
  const c = STORE.apply(id, (x) => {
    x.messages.push(userMsg);
    if (!x.named && x.messages.filter(m => m.role === 'user').length === 1) x.title = STORE.titleOf(text);
    return true;
  });
  if (!c) return _bad(res, 404, I18N.t('no such chat'));

  const ctl = new AbortController();
  const L = { ctl, text: '', by: null, at: Date.now(), gone: false };
  _live.set(id, L);
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.flushHeaders();
  let open = true;
  res.on('close', () => { open = false; });
  const say = (o) => { if (open && !res.writableEnded) res.write(JSON.stringify(o) + '\n'); };
  say({ t: 'user', message: userMsg, summary: STORE.summary(c) });

  const by = (s) => (s ? { provider: s.provider, model: s.model, label: s.provider === 'fake' ? 'fake model' : AGENTS.labelOf(s) } : null);
  const o = {
    step: c.step, signal: ctl.signal,
    onStep: (s) => { L.by = by(s); L.text = ''; say({ t: 'step', by: L.by }); },
    onDelta: (piece) => { L.text += piece; say({ t: 'delta', text: piece }); },
    onReplace: (all) => { L.text = all; say({ t: 'replace', text: all }); },
  };
  let r;
  let pick = null;
  try {
    // Help: first the chapters that answer it.
    if (c.mode === 'help') {
      say({ t: 'stage', text: I18N.t('looking in the guide…') });
      if (FAKE.on()) pick = _fakePick();
      else {
        const p = await AGENTS.stream(KNOW.pickMessages(c), { step: c.step, signal: ctl.signal, maxTokens: 2000 });
        pick = Object.assign(KNOW.pickOf(p.text), { usage: p.usage, usd: p.usd });
      }
    }
    if (ctl.signal.aborted) r = { text: '', by: null, tried: [], stopped: true };
    else if (FAKE.on()) r = await _fake(c, text, o);
    else r = await AGENTS.stream(_messages(c, c.mode === 'help' ? KNOW.helpSystem(pick.chapters) : KNOW.system(c.mode)), o);
  } catch (e) {
    r = { text: L.text, by: null, tried: [], error: String((e && e.message) || e) };
  }
  _live.delete(id);
  if (L.gone) { if (open) res.end(); return; }
  const answer = { id: STORE.newId('m'), role: 'assistant', text: String(r.text || ''), at: new Date().toISOString(),
                   by: by(r.by), usage: _sumUsage(r.usage, pick && pick.usage), usd: _sumUsd(r.usd, pick && pick.usd) };
  if (pick && pick.at && answer.text) answer.guide = pick.at;
  if (r.cut) answer.cut = true;
  if (r.stopped) answer.stopped = true;
  if (r.error) answer.error = r.error;
  if (r.error && !answer.text && r.tried && r.tried.length) answer.tried = require('../lib/agents').saidTrail(r.tried.slice(0, 8));
  const after = STORE.apply(id, (x) => { x.messages.push(answer); return true; });
  say({ t: 'done', message: answer, summary: after ? STORE.summary(after) : null });
  if (open) res.end();
});

module.exports = router;
