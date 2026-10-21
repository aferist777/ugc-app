'use strict';

// ════════════════════════════════════════════════════════════════════════════
// WHAT THE TELEGRAM BOT WAS SENT, WAITING ON THE DISK (phase TG) - data/tg-inbox.json.
//
// "First on the disk, then accepted": a message is turned into items here - one per link, one per photo or video sent as
// a file - and written in ONE tick, and only then is Telegram told it was received (the next getUpdates' offset) or the
// receiver's file in R2 taken away. A message seen before (the receiver's retry, a crash between the write and the
// confirmation) is known by its update id and not added twice.
//
//   { items: [{ id, updateId, chatId, messageId, replyId, kind: 'link'|'file', url, fileId, fileName, mime, size,
//               media: 'photo'|'video', note, at, state: 'waiting'|'error', error }],
//     seen: [update ids, the last 2000] }
//
// Unfinished work: in STORES_LEFT_OUT (lib/layout.js) - another library would only hold jobs nobody sent it. Block 3
// works the items through.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR } = require('./config');
const { writeFileAtomic } = require('./atomic-write');

const FILE = path.join(DATA_DIR, 'tg-inbox.json');
const SEEN_MAX = 2000;

function read() {
  try {
    const d = JSON.parse(fs.readFileSync(FILE, 'utf8')) || {};
    return { items: Array.isArray(d.items) ? d.items : [], seen: Array.isArray(d.seen) ? d.seen : [] };
  } catch (e) { return { items: [], seen: [] }; }
}

// Read, change, write in one tick: `fn` is synchronous.
function apply(fn) {
  const d = read();
  const out = fn(d);
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  writeFileAtomic(FILE, JSON.stringify(d, null, 2));
  return out;
}

const seen = (updateId) => read().seen.includes(Number(updateId));

/** The items of one message, added unless its update was seen. Answers the items added ([] for a message seen). */
function add(updateId, items) {
  return apply((d) => {
    const u = Number(updateId);
    if (d.seen.includes(u)) return [];
    d.seen.push(u);
    if (d.seen.length > SEEN_MAX) d.seen.splice(0, d.seen.length - SEEN_MAX);
    const added = items.map((it) => ({
      id: 'tg_' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex'),
      updateId: u, state: it.error ? 'error' : 'waiting', at: new Date().toISOString(), ...it,
    }));
    d.items.push(...added);
    return added;
  });
}

/** One item changed in place (block 3: its reply's id, its state). */
function update(id, fn) {
  return apply((d) => {
    const it = d.items.find(x => x.id === id);
    if (it) fn(it);
    return it || null;
  });
}

const counts = () => {
  const d = read();
  return { waiting: d.items.filter(i => i.state === 'waiting').length, error: d.items.filter(i => i.state === 'error').length };
};

module.exports = { FILE, read, add, update, seen, counts };
