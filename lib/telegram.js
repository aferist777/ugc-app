'use strict';

// ════════════════════════════════════════════════════════════════════════════
// THE TELEGRAM BOT (phase TG, the owner 2026-10-11/21): posts, links and media sent to the owner's own bot go into
// REFERENCES. Block 2: the bot's key, who the bot listens to, how its messages reach the app, and the queue on the disk.
//
// THE KEY - `telegramBotToken` on Admin -> API keys (a secret), made at @BotFather. getMe says it is alive and the bot's
// name. One bot, one app: two copies of the app reading one bot take its messages from each other (Telegram answers 409,
// or the bot is pointed at another receiver) - Admin says so.
//
// WHO IT LISTENS TO - Telegram does not tell a bot who made it, so the maker is known by a CODE shown on Admin beside the
// key: the first "/start <code>" from a private chat pairs that chat; from then on the bot hears that chat only. Everybody
// else gets nothing - "/start" without the code included (the owner: "ничего не отвечать"). The code alone, typed as a
// message, pairs too. What arrives before the code is held for an hour, unanswered (lib/tg-inbox.js hold): the code's
// chat has its earlier posts queued, everybody else's are dropped. "unpair" forgets the chat and makes a new code. Kept
// in data/telegram.json (the server writes it; Export carries it with the keys).
//
// HOW MESSAGES COME IN - two ways, chosen by itself:
//   receiver   the one Cloudflare key works for R2 (lib/cloudflare.js): a Worker on the owner's Cloudflare takes the bot's
//              messages around the clock and leaves them in the bucket (lib/tg-receiver.js); the app takes them at start
//              and every 15 s while open. No 24-hour limit.
//   polling    no Cloudflare key: the app asks Telegram itself while it is open (getUpdates, long polling - only outgoing
//              requests, nothing listens). Telegram keeps what was sent for 24 hours at most; the app closed longer than
//              that, the bot says so when it is back.
// Either way a message is written to the disk FIRST (lib/tg-inbox.js), and only then confirmed - the next getUpdates'
// offset, or the receiver's file taken away.
//
// THE ANSWERS are the bot's, in English like the whole app (phase V29): one per message of the owner, and that one
// edited as things go (block 3: "saved", "could not"). Never faster than one a second (Telegram's rule for a chat).
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const { DATA_DIR } = require('./config');
const { getSettings } = require('./settings-io');
const { writeFileAtomic } = require('./atomic-write');
const INBOX = require('./tg-inbox');

let API = 'https://api.telegram.org';
const STATE = path.join(DATA_DIR, 'telegram.json');
const MAX_FILE = 20 * 1024 * 1024;          // what a bot may fetch (Bot API getFile)
const DRAIN_MS = 15000;
const DAY_MS = 24 * 60 * 60 * 1000;
// A message edited after it was sent is not a new one: only messages come.
const ALLOWED = ['message'];

const token = () => String(getSettings().telegramBotToken || '').trim();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── the state on the disk ──────────────────────────────────────────────────
function readState() {
  try { return JSON.parse(fs.readFileSync(STATE, 'utf8')) || {}; } catch (e) { return {}; }
}
function writeState(fn) {
  const s = readState();
  fn(s);
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  writeFileAtomic(STATE, JSON.stringify(s, null, 2));
  return s;
}
const newCode = () => String(crypto.randomInt(1000, 10000));

// ── Bot API ────────────────────────────────────────────────────────────────
async function call(method, params, timeout = 30000, tok = token()) {
  try {
    const r = await axios.post(`${API}/bot${tok}/${method}`, params || {}, { timeout });
    if (!r.data || !r.data.ok) throw Object.assign(new Error((r.data && r.data.description) || 'no answer'), { code: r.data && r.data.error_code });
    return r.data.result;
  } catch (e) {
    if (e.response && e.response.data) {
      const d = e.response.data;
      throw Object.assign(new Error(d.description || ('HTTP ' + e.response.status)), { code: d.error_code || e.response.status });
    }
    throw e;
  }
}

// One answer a second, at most (Telegram: no more than one message per second in a chat).
let _sendChain = Promise.resolve();
let _lastSend = 0;
function _paced(fn) {
  const run = _sendChain.then(async () => {
    const wait = _lastSend + 1100 - Date.now();
    if (wait > 0) await sleep(wait);
    _lastSend = Date.now();
    return fn();
  });
  _sendChain = run.catch(() => {});
  return run;
}
function say(chatId, text, replyTo) {
  return _paced(() => call('sendMessage', { chat_id: chatId, text, reply_to_message_id: replyTo, allow_sending_without_reply: true }))
    .catch((e) => { console.warn('[telegram] could not answer:', e.message); return null; });
}
function edit(chatId, messageId, text) {
  return _paced(() => call('editMessageText', { chat_id: chatId, message_id: messageId, text }))
    .catch((e) => { console.warn('[telegram] could not edit an answer:', e.message); return null; });
}
// The answer to a message: the receiver's "received" edited when there is one, else a new one. Its id, for block 3.
async function answer(chatId, messageId, replyId, text) {
  if (replyId) { const r = await edit(chatId, replyId, text); if (r) return replyId; }
  const r = await say(chatId, text, messageId);
  return r ? r.message_id : 0;
}

// ── what a message holds ───────────────────────────────────────────────────
// Every link: the entities Telegram marked (a link typed, a word linked), and anything that still looks like one.
function linksOf(m) {
  const text = String(m.text || m.caption || '');
  const ents = m.entities || m.caption_entities || [];
  const out = [];
  for (const e of ents) {
    if (e.type === 'text_link' && e.url) out.push(e.url);
    else if (e.type === 'url') out.push(text.substr(e.offset, e.length));
  }
  for (const u of text.match(/https?:\/\/[^\s<>"']+/gi) || []) out.push(u);
  const clean = out.map(u => String(u).trim().replace(/[)\].,;:!?»"']+$/, ''))
    .map(u => (/^https?:\/\//i.test(u) ? u : 'https://' + u))
    .filter(u => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) && x.hostname.includes('.'); } catch (e) { return false; } });
  return [...new Set(clean)];
}

// A photo (its largest size), a video, an animation, or a document that is a picture or a video.
function fileOf(m) {
  if (Array.isArray(m.photo) && m.photo.length) {
    const p = m.photo.slice().sort((a, b) => (b.file_size || b.width * b.height || 0) - (a.file_size || a.width * a.height || 0))[0];
    return { fileId: p.file_id, size: p.file_size || 0, media: 'photo', mime: 'image/jpeg', fileName: '' };
  }
  const v = m.video || m.animation;
  if (v) return { fileId: v.file_id, size: v.file_size || 0, media: 'video', mime: v.mime_type || 'video/mp4', fileName: v.file_name || '' };
  const d = m.document;
  if (d && /^(image|video)\//.test(String(d.mime_type || ''))) {
    return { fileId: d.file_id, size: d.file_size || 0, media: /^image\//.test(d.mime_type) ? 'photo' : 'video', mime: d.mime_type, fileName: d.file_name || '' };
  }
  return null;
}

const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');

// ── one update ─────────────────────────────────────────────────────────────
// Written to the disk before it returns (the pairing too); the answers go out after, paced.
function handle(update, replyId = 0) {
  const m = update && (update.message || update.edited_message);
  if (!m || !m.chat || m.chat.type !== 'private' || !update.update_id) return;
  const st = readState();
  const text = String(m.text || '').trim();
  const start = /^\/start(?:@\w+)?(?:\s+(\S+))?$/.exec(text);

  if (!st.chat) {
    // "/start <code>" (the link's Start), or the code typed alone (Start pressed on the bot itself sends "/start" bare).
    const given = start ? start[1] : (/^\d{4,8}$/.test(text) ? text : '');
    if (!given || !st.code || given !== st.code) {
      // Not the code: held, unanswered - the owner's own posts sent before the code are queued once it comes (the owner
      // 2026-10-21), a stranger's are dropped then.
      if (!start) INBOX.hold(update, replyId);
      return;
    }
    const who = [m.from && m.from.first_name, m.from && m.from.last_name].filter(Boolean).join(' ')
      || (m.from && m.from.username ? '@' + m.from.username : 'you');
    writeState((s) => { s.chat = { id: m.chat.id, name: who, at: new Date().toISOString() }; s.code = ''; });
    INBOX.add(update.update_id, []);
    console.log('[telegram] paired with a chat');
    say(m.chat.id, '✅ Connected to UGC Studio. Send me links to posts (Instagram, TikTok, YouTube…) or photos and videos '
      + 'up to 20 MB - they go into REFERENCES.', m.message_id);
    // What this chat sent before the code - now the owner's.
    for (const e of INBOX.takeHeld(m.chat.id)) {
      try { handle(e.update, e.replyId || 0); } catch (err) { console.warn('[telegram] a held message could not be taken:', err.message); }
    }
    _onPaired();
    return;
  }
  if (String(m.chat.id) !== String(st.chat.id)) return;                        // not the owner - nothing
  if (INBOX.seen(update.update_id)) return;

  if (start) {
    INBOX.add(update.update_id, []);
    answer(m.chat.id, m.message_id, replyId, 'Connected already. Send me links, photos or videos.');
    return;
  }
  const links = linksOf(m);
  const file = fileOf(m);
  const note = String(m.text || m.caption || '').replace(/https?:\/\/[^\s<>"']+/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 500);
  // An album (several photos or videos sent at once) comes as several messages with one media_group_id - kept, so
  // block 3 can make one post of it.
  const group = String(m.media_group_id || '');
  const items = links.map(url => ({ kind: 'link', url, chatId: m.chat.id, messageId: m.message_id, replyId, note, group }));
  if (file) {
    const big = file.size > MAX_FILE;
    items.push({ kind: 'file', ...file, chatId: m.chat.id, messageId: m.message_id, replyId, note, group,
      error: big ? 'too big for a bot - Telegram lets bots fetch 20 MB at most; add it as a file in the app' : '' });
  }
  const added = INBOX.add(update.update_id, items);
  if (!items.length) {
    answer(m.chat.id, m.message_id, replyId, 'Send me a link to a post, or a photo or a video (up to 20 MB).');
    return;
  }
  const ok = added.filter(i => i.state === 'waiting');
  const bad = added.filter(i => i.state === 'error');
  const nLinks = ok.filter(i => i.kind === 'link').length;
  const nFiles = ok.filter(i => i.kind === 'file').length;
  const parts = [nLinks ? plural(nLinks, 'link') : '', nFiles ? plural(nFiles, ok.find(i => i.kind === 'file').media) : ''].filter(Boolean);
  const words = (parts.length ? '⏳ In the queue: ' + parts.join(', ') + '.' : '')
    + (bad.length ? (parts.length ? '\n' : '') + '❌ ' + bad[0].error : '');
  answer(m.chat.id, m.message_id, replyId, words).then((id) => {
    if (id && id !== replyId) for (const it of added) INBOX.update(it.id, (x) => { x.replyId = id; });
  });
}

// ── running ────────────────────────────────────────────────────────────────
let _gen = 0;                 // a newer connect() stops the loops of an older one
const _st = { mode: 'off', error: '', conflict: '', lastAt: '', receiverError: '', delivery: '', connecting: false };

async function _pollLoop(gen) {
  let offset = 0;
  let wait = 0;
  // A webhook left behind (an earlier receiver, the server version's bot) would refuse getUpdates.
  try { await call('deleteWebhook', { drop_pending_updates: false }); } catch (e) { /* said by getUpdates below */ }
  while (gen === _gen) {
    try {
      const ups = await call('getUpdates', { offset, timeout: 50, allowed_updates: ALLOWED }, 65000);
      if (gen !== _gen) return;
      _st.lastAt = new Date().toISOString();
      _st.error = ''; _st.conflict = '';
      _noteSeen();
      for (const u of ups || []) {
        try { handle(u, 0); } catch (e) { console.warn('[telegram] a message could not be taken:', e.message); }
        offset = u.update_id + 1;
      }
      wait = 0;
    } catch (e) {
      if (gen !== _gen) return;
      if (e.code === 409) { _st.conflict = 'another copy of the app reads this bot (Telegram: ' + e.message + ')'; wait = 30000; }
      else if (e.code === 401 || e.code === 404) { _st.error = 'Telegram refused this bot key'; _st.mode = 'off'; return; }
      else { _st.error = 'Telegram could not be reached: ' + e.message; wait = Math.min(60000, Math.max(5000, wait * 2)); }
      await sleep(wait);
    }
  }
}

async function _drainLoop(gen) {
  const RX = require('./tg-receiver');
  let n = 0;
  while (gen === _gen) {
    try {
      await RX.drain(async (entry) => { handle(entry.update, entry.replyId || 0); });
      _st.lastAt = new Date().toISOString();
      _st.error = '';
      _noteSeen();
      // Is the bot still pointed at our receiver, and can Telegram deliver to it? Every drain while the chat is not
      // paired yet (that is when the owner is looking), every few minutes after.
      if (n++ % 20 === 0 || !readState().chat) {
        const info = await call('getWebhookInfo');
        const hook = readState().hook;
        _st.conflict = hook && info && info.url && info.url !== hook.url
          ? 'the bot\'s messages go somewhere else now - another copy of the app may use this bot' : '';
        const errAt = info && info.last_error_date ? info.last_error_date * 1000 : 0;
        _st.delivery = errAt && Date.now() - errAt < 15 * 60 * 1000
          ? 'Telegram could not hand a message to the receiver (' + new Date(errAt).toLocaleTimeString('en-GB') + '): '
            + String(info.last_error_message || 'no reason given') + (info.pending_update_count ? ` - ${info.pending_update_count} waiting` : '')
          : '';
      }
    } catch (e) {
      if (gen !== _gen) return;
      _st.error = 'the receiver\'s folder could not be read: ' + e.message;
    }
    await sleep(DRAIN_MS);
  }
}

// When the app was last reading the bot - for "closed longer than a day" (polling only).
function _noteSeen() {
  const now = Date.now();
  const st = readState();
  if (st.mode === 'poll' && st.chat && st.lastSeenAt && now - Date.parse(st.lastSeenAt) > DAY_MS && !st.toldGap) {
    const days = Math.floor((now - Date.parse(st.lastSeenAt)) / DAY_MS);
    say(st.chat.id, `The app was closed for ${days} day${days === 1 ? '' : 's'}. Telegram keeps what a bot is sent for 24 hours `
      + 'only - anything sent more than a day before the app opened is lost; send it again. (A Cloudflare key on Admin keeps '
      + 'it for good.)');
    writeState((s) => { s.toldGap = true; });
  }
  if (!st.lastSeenAt || now - Date.parse(st.lastSeenAt) > 60000) writeState((s) => { s.lastSeenAt = new Date(now).toISOString(); s.toldGap = false; });
}

// The chat just paired: the receiver learns it (it keeps only the owner's messages from now on).
function _onPaired() {
  if (_st.mode === 'receiver') connect().catch(() => {});
}

/**
 * Looks at the keys and takes the right way in: the receiver when the Cloudflare key is R2's, else polling; nothing
 * without a bot key (and a receiver left behind is taken down). Answers view().
 */
async function connect() {
  const gen = ++_gen;
  _st.connecting = true;
  _st.error = ''; _st.conflict = ''; _st.receiverError = '';
  try {
    const tok = token();
    const st = readState();
    if (!tok) {
      if (st.hook) {
        const RX = require('./tg-receiver');
        const left = await RX.remove(st.hook);
        writeState((s) => { s.hook = null; s.bot = null; });
        if (left) _st.receiverError = left;
      }
      _st.mode = 'off';
      return view();
    }
    let me;
    try { me = await call('getMe', {}, 20000, tok); }
    catch (e) { _st.mode = 'off'; _st.error = e.code === 401 || e.code === 404 ? 'Telegram refused this bot key' : 'Telegram could not be reached: ' + e.message; return view(); }
    writeState((s) => {
      // Another bot: its chat and its receiver are not this one's.
      if (s.bot && s.bot.id !== me.id) { s.chat = null; s.code = ''; }
      s.bot = { id: me.id, username: me.username || '', name: me.first_name || '' };
      if (!s.chat && !s.code) s.code = newCode();
    });
    const CF = require('./cloudflare');
    if (CF.view().inUse) {
      try {
        await _receiver(tok, me);
        _st.mode = 'receiver';
        writeState((s) => { s.mode = 'receiver'; });
        if (gen === _gen) _drainLoop(gen);
        return view();
      } catch (e) {
        _st.receiverError = 'the receiver on Cloudflare could not be set up: ' + e.message + ' - the app reads the bot itself meanwhile';
      }
    } else if (readState().hook) {
      const RX = require('./tg-receiver');
      const left = await RX.remove(readState().hook);
      writeState((s) => { s.hook = null; });
      if (left) _st.receiverError = left;
    }
    _st.mode = 'poll';
    writeState((s) => { s.mode = 'poll'; });
    if (gen === _gen) _pollLoop(gen);
    return view();
  } finally {
    _st.connecting = false;
  }
}

async function _receiver(tok, me) {
  const RX = require('./tg-receiver');
  const R2 = require('./r2');
  const c = R2.cfg();
  const st = readState();
  const hook = await RX.ensure({ botId: me.id, botToken: tok, chatId: st.chat ? st.chat.id : '', account: c.account,
    bucket: c.bucket, tgApi: API }, st.hook);
  // Pointed at it - a new workers.dev address may take a minute before Telegram can find it.
  let last = null;
  for (let i = 0; i < 8; i++) {
    try {
      await call('setWebhook', { url: hook.url, secret_token: hook.secret, allowed_updates: ALLOWED, drop_pending_updates: false, max_connections: 5 });
      last = null;
      break;
    } catch (e) { last = e; if (e.code === 401 || e.code === 404) break; await sleep(i < 2 ? 5000 : 15000); }
  }
  if (last) throw new Error('Telegram could not reach the receiver: ' + last.message);
  const { fresh, ...keep } = hook;
  writeState((s) => { s.hook = keep; });
  if (fresh) console.log('[telegram] the receiver is up:', hook.script);
}

/**
 * The receiver taken down while the keys that put it up are still there - called by routes/settings.js BEFORE a bot key
 * or a Cloudflare key is removed or replaced (deleteWebhook needs the old bot key, deleting the Worker the old Cloudflare
 * key). The loops stop; connect() after the save takes the new way in.
 */
async function dropReceiver() {
  const st = readState();
  if (!st.hook) return '';
  ++_gen;
  try { await call('deleteWebhook', { drop_pending_updates: false }); } catch (e) { /* a dead key: nothing points anywhere */ }
  const left = await require('./tg-receiver').remove(st.hook);
  writeState((s) => { s.hook = null; });
  _st.mode = 'off';
  if (left) _st.receiverError = left;
  return left;
}

/** Forget the paired chat; a new code. */
async function unpair() {
  writeState((s) => { s.chat = null; s.code = newCode(); });
  if (_st.mode === 'receiver') await connect();
  return view();
}

/** At the server's start (server.js, with the other deferred work). */
function start() {
  if (!token() && !readState().hook) return;
  connect().catch(e => console.warn('[telegram] could not connect:', e.message));
}

/** Admin's view - never the key. */
function view() {
  const st = readState();
  const c = INBOX.counts();
  return {
    tokenSet: !!token(),
    bot: st.bot || null,
    chat: st.chat ? { name: st.chat.name, at: st.chat.at } : null,
    code: st.chat ? '' : (st.code || ''),
    mode: token() ? _st.mode : 'off',
    receiver: st.hook ? { script: st.hook.script, at: st.hook.at } : null,
    connecting: _st.connecting,
    error: _st.error, conflict: _st.conflict, receiverError: _st.receiverError, delivery: _st.delivery,
    lastAt: _st.lastAt,
    queue: c,
  };
}

// keys-health's probe: getMe, free.
async function probe(tok) {
  const me = await call('getMe', {}, 15000, tok);
  return '@' + (me.username || me.first_name || 'bot');
}

function _setApi(base) { API = String(base).replace(/\/+$/, ''); }

module.exports = { connect, start, unpair, dropReceiver, view, probe, handle, linksOf, fileOf, readState, _setApi };
