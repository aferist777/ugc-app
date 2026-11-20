'use strict';

// THE ASSISTANT'S CHATS - one file a chat in data/assistant/<id>.json, written atomically; the list is the folder read.
//
//   { id, mode: 'ideas' | 'help', title, named (renamed by hand), step: { provider, model } | null - the model chosen
//     for it, createdAt, updatedAt,
//     messages: [ { id, role: 'user', text, at, attached: [{ kind, ref, name }], context },
//                 { id, role: 'assistant', text, at, by: { provider, model, label }, usage, usd, cut, stopped, error } ] }
//
// `context` is what was attached, in words, as the model read it - kept, so every later turn reads the same text even
// when the look, the product or the scenario changed since. A chat's title is the first words of its first message
// until it is renamed. Nothing here asks a model.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR } = require('./config');
const I18N = require('./i18n');
const { writeFileAtomic } = require('./atomic-write');

const DIR = path.join(DATA_DIR, 'assistant');
const MODES = ['ideas', 'help'];
const TITLE_MAX = 80;

const okId = (id) => /^c[a-z0-9]{6,24}$/.test(String(id || ''));
const _file = (id) => path.join(DIR, id + '.json');
const _now = () => new Date().toISOString();
const newId = (p) => (p || 'c') + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');

function _norm(c) {
  if (!c || typeof c !== 'object' || !okId(c.id)) return null;
  return {
    id: c.id,
    mode: MODES.includes(c.mode) ? c.mode : 'ideas',
    title: String(c.title || '').slice(0, TITLE_MAX),
    named: !!c.named,
    step: c.step && c.step.provider && c.step.model ? { provider: String(c.step.provider), model: String(c.step.model) } : null,
    createdAt: c.createdAt || _now(),
    updatedAt: c.updatedAt || c.createdAt || _now(),
    messages: Array.isArray(c.messages) ? c.messages.filter(m => m && (m.role === 'user' || m.role === 'assistant')) : [],
  };
}

/** One chat whole, or null. */
function get(id) {
  if (!okId(id)) return null;
  try { return _norm(JSON.parse(fs.readFileSync(_file(id), 'utf8'))); } catch (e) { return null; }
}

function _write(c) {
  fs.mkdirSync(DIR, { recursive: true });
  writeFileAtomic(_file(c.id), JSON.stringify(c, null, 1));
}

/** What a chat cost and read: { usd, tokens, priced } - `priced` false when some answer came with no price. */
function totals(c) {
  let usd = 0, tokens = 0, priced = true;
  for (const m of (c && c.messages) || []) {
    if (m.role !== 'assistant') continue;
    if (m.usd != null) usd += +m.usd || 0; else if (m.by) priced = false;
    const u = m.usage || {};
    tokens += (+u.in || 0) + (+u.out || 0) + (+u.cacheRead || 0) + (+u.cacheWrite || 0);
  }
  return { usd, tokens, priced };
}

/** A chat for the list: no messages. */
function summary(c) {
  return { id: c.id, mode: c.mode, title: c.title || I18N.t('New chat'), named: c.named, step: c.step, createdAt: c.createdAt,
           updatedAt: c.updatedAt, n: c.messages.length, ...totals(c) };
}

/** The chats of one mode, the newest first. */
function list(mode) {
  let names = [];
  try { names = fs.readdirSync(DIR).filter(n => /\.json$/i.test(n)); } catch (e) { return []; }
  const out = [];
  for (const n of names) {
    const c = get(n.replace(/\.json$/i, ''));
    if (c && (!mode || c.mode === mode)) out.push(summary(c));
  }
  return out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

/** A new empty chat. */
function create(mode, step) {
  const c = _norm({ id: newId('c'), mode, step, title: '', createdAt: _now(), messages: [] });
  _write(c);
  return c;
}

/**
 * Read, change and write one chat in one tick - `fn(chat)` synchronous. -> the chat as written, or null when there is
 * none (or `fn` answered false: nothing written).
 */
function apply(id, fn) {
  const c = get(id);
  if (!c) return null;
  if (fn(c) === false) return null;
  c.updatedAt = _now();
  _write(c);
  return c;
}

/** The first words of a message as a title. */
function titleOf(text) {
  const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ');
  let t = '';
  for (const w of words) { if ((t + ' ' + w).trim().length > 48) break; t = (t + ' ' + w).trim(); }
  return (t || String(text || '').trim().slice(0, 48)) + (t.length < String(text || '').replace(/\s+/g, ' ').trim().length ? '…' : '');
}

function remove(id) {
  if (!okId(id)) return false;
  try { fs.unlinkSync(_file(id)); return true; } catch (e) { return false; }
}

module.exports = { DIR, MODES, TITLE_MAX, okId, newId, get, list, create, apply, remove, summary, totals, titleOf };
