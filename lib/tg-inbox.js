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
//     seen: [update ids, the last 2000],
//     early: [{ update, replyId, at }] - what came before the chat was paired, held for an hour (hold / takeHeld) }
//
// Unfinished work: in STORES_LEFT_OUT (lib/layout.js). Block 3
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
    return { items: Array.isArray(d.items) ? d.items : [], seen: Array.isArray(d.seen) ? d.seen : [],
      early: Array.isArray(d.early) ? d.early : [] };
  } catch (e) { return { items: [], seen: [], early: [] }; }
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

// ── before the chat is paired ──────────────────────────────────────────────
// What arrives before the code is HELD here, not answered (the owner 2026-10-21: two posts sent, one in the queue - the
// first went before the code): the code's chat has its held messages queued, everybody else's are dropped. An hour at
// most, fifty at most.
const EARLY_MS = 60 * 60 * 1000;
const EARLY_MAX = 50;

function hold(update, replyId) {
  return apply((d) => {
    const now = Date.now();
    d.early = (Array.isArray(d.early) ? d.early : []).filter(e => now - e.at < EARLY_MS);
    if (d.seen.includes(Number(update.update_id)) || d.early.some(e => e.update.update_id === update.update_id)) return false;
    d.early.push({ update, replyId: replyId || 0, at: now });
    if (d.early.length > EARLY_MAX) d.early.splice(0, d.early.length - EARLY_MAX);
    return true;
  });
}

/** The held messages of `chatId` (oldest first), the rest dropped. */
function takeHeld(chatId) {
  return apply((d) => {
    const now = Date.now();
    const mine = (Array.isArray(d.early) ? d.early : [])
      .filter(e => now - e.at < EARLY_MS && e.update && e.update.message && String(e.update.message.chat.id) === String(chatId))
      .sort((a, b) => a.update.update_id - b.update.update_id);
    d.early = [];
    return mine;
  });
}

// At the server's start (lib/references-intake.js): what was being taken when the app closed waits again; what is done
// is let go after a day (its answer was edited long ago), what failed after three.
function reset() {
  apply((d) => {
    const now = Date.now();
    const age = (i) => now - (Date.parse(i.endAt || i.at) || now);
    d.items = d.items.filter(i => !(i.state === 'done' && age(i) > 24 * 3600e3) && !(i.state === 'error' && age(i) > 3 * 24 * 3600e3));
    for (const i of d.items) if (i.state === 'running') i.state = 'waiting';
  });
}

const counts = () => {
  const d = read();
  return { waiting: d.items.filter(i => i.state === 'waiting' || i.state === 'running').length,
    error: d.items.filter(i => i.state === 'error').length, done: d.items.filter(i => i.state === 'done').length };
};

module.exports = { FILE, read, add, update, seen, counts, hold, takeHeld, reset };
