'use strict';

// ════════════════════════════════════════════════════════════════════════════
// THE LIBRARY'S MAKING CHATS (phase I, the owner 2026-10-01) - what was said in New environment and
// New lookbook, and what came of it.
//
// One file per chat - data/makechat-environments.json, data/makechat-lookbooks.json. A file is a
// plain list of sends, oldest first. A SEND is one
// message and its answer, because a message makes one picture:
//
//   { id, at, text, ref: { path, from: 'base' | 'photo' } | null,
//     alertId, state: running | done | failed | refused | cancelled | lost,
//     stage, startedAt, mode, result: { path, preview, from, description, prompt, gender }, error }
//
// THE CHAT KEEPS WHAT CAME OF A SEND. The Alerts row is where a running send is followed, but the
// journal is pruned to its newest finished rows and cleared by hand, and the chat is never cleared
// by itself (the owner): so the moment a row ends, its result, its error or the agent's refusal is
// copied into the send (lib/alerts.js onEnd), and every read of the chat checks the running ones
// against their rows again - a row tried again from Alerts opens its send once more, and a running
// send whose row has vanished is "lost", not waited for for ever.
//
// THIRTY SENDS per chat (the owner: "до 30 сообщений"): the oldest go first, and a running one never
// goes. Only bare library addresses are kept (/media/...), never a thumbnail URL or a data URL: a
// file that moves is followed by lib/relocate.js like in every other store.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { writeFileAtomic } = require('./atomic-write');
const { DATA_DIR } = require('./config');
const ALERTS = require('./alerts');

const KEEP = 30;
const FILES = {
  environments: path.join(DATA_DIR, 'makechat-environments.json'),
  lookbooks: path.join(DATA_DIR, 'makechat-lookbooks.json'),
};
const KINDS = Object.keys(FILES);

const _str = (v, n) => String(v == null ? '' : v).slice(0, n || 500);

function _file(kind) {
  const f = FILES[kind];
  if (!f) throw Object.assign(new Error('no chat for "' + kind + '"'), { status: 404 });
  return f;
}

// Oldest first, whatever order the file holds them in.
function _read(kind) {
  let d = null;
  try { d = JSON.parse(fs.readFileSync(_file(kind), 'utf8')); } catch (e) { d = null; }
  // A list; { sends } is what the first version wrote, and is read the same.
  const raw = Array.isArray(d) ? d : (d && Array.isArray(d.sends)) ? d.sends : [];
  const list = raw.filter(s => s && s.id);
  return list.sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));
}

// The newest KEEP, and every running one besides.
function _write(kind, list) {
  let over = list.length - KEEP;
  const out = [];
  for (const s of list) {
    if (over > 0 && s.state !== 'running') { over--; continue; }
    out.push(s);
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  writeFileAtomic(_file(kind), JSON.stringify(out, null, 2));
}

// What a row says about its send. A row that is running is the truth about it; one that ended is
// copied in for good.
function _fromRow(row) {
  if (row.state === 'running') {
    return { state: 'running', stage: _str(row.stage, 120), startedAt: row.startedAt || '', error: '', result: null };
  }
  if (row.state === 'done') {
    const f = ((row.job || {}).params || {}).file || {};
    const r = row.result || {};
    return {
      state: 'done', stage: '', error: '',
      result: {
        path: _str(r.path, 1000), preview: _str(r.preview, 1000), from: _str(r.from || f.from, 1000),
        description: _str(f.description, 4000), prompt: _str(f.prompt, 4000), gender: _str(f.gender, 20),
      },
    };
  }
  return {
    state: row.refused ? 'refused' : row.cancelled ? 'cancelled' : 'failed',
    stage: '', result: null, error: _str(row.error, 600),
  };
}

// Copy `patch` into `s`, saying whether anything changed.
function _apply(s, patch) {
  let changed = false;
  for (const [k, v] of Object.entries(patch)) {
    if (JSON.stringify(s[k]) !== JSON.stringify(v)) { s[k] = v; changed = true; }
  }
  return changed;
}

/** The chat, its running sends checked against their rows first. */
function read(kind) {
  const list = _read(kind);
  if (!list.some(s => s.alertId)) return list;
  const rows = new Map(ALERTS.list().map(r => [r.id, r]));
  let changed = false;
  for (const s of list) {
    if (!s.alertId) continue;
    const row = rows.get(s.alertId);
    if (row) {
      // A send that ended keeps what it said unless its row runs again (a retry from Alerts) or ended
      // differently since - the row is the truth while it exists.
      changed = _apply(s, _fromRow(row)) || changed;
    } else if (s.state === 'running') {
      changed = _apply(s, { state: 'lost', stage: '', error: 'its row is gone from Alerts - if it was made, it is on the shelf' }) || changed;
    }
  }
  if (changed) _write(kind, list);
  return list;
}

/** A new send, running from the moment its row exists. */
function add(kind, fields) {
  const f = fields || {};
  const s = {
    id: f.id || ('mc' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex')),
    at: new Date().toISOString(),
    text: _str(f.text, 4000),
    ref: (f.ref && f.ref.path) ? { path: _str(f.ref.path, 1000), from: f.ref.from === 'base' ? 'base' : 'photo' } : null,
    alertId: _str(f.alertId, 80),
    state: 'running', stage: _str(f.stage, 120), startedAt: f.startedAt || new Date().toISOString(),
    mode: '', result: null, error: '',
  };
  const list = _read(kind);
  list.push(s);
  _write(kind, list);
  return s;
}

/** Change one send, synchronously from read to write. */
function change(kind, id, fn) {
  const list = _read(kind);
  const s = list.find(x => x.id === String(id));
  if (!s) return null;
  fn(s);
  _write(kind, list);
  return s;
}

const running = (kind) => read(kind).filter(s => s.state === 'running').length;

// The moment a row ends, its send keeps what came of it - even if nobody reads the chat before the row
// is cleared from Alerts.
ALERTS.onEnd((row) => {
  const chat = ((row.job || {}).params || {}).chat;
  if (!chat || !FILES[chat.kind] || !chat.id) return;
  change(chat.kind, chat.id, (s) => { if (s.alertId === row.id) _apply(s, _fromRow(row)); });
});

module.exports = { KINDS, KEEP, FILES, read, add, change, running };
