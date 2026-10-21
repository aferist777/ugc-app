'use strict';

// ════════════════════════════════════════════════════════════════════════════
// THE TELEGRAM RECEIVER ON THE OWNER'S CLOUDFLARE (phase TG, block 2; the owner 2026-10-21: "если r2 уже привязан,
// пользователь добавляет api ключ бота и на r2 автоматически появляется то что необходимо").
//
// Telegram keeps what a bot was sent for 24 hours at most. With the one Cloudflare key working (lib/cloudflare.js), the
// app puts a small program on the owner's account - a Worker named after the bot, `ugc-tg-<bot id>` - that takes the
// bot's messages around the clock: Telegram POSTs each one to it (setWebhook, with a secret header only Telegram and the
// Worker know), and it writes the message as a file `telegram-inbox/<update id>.json` into the owner's bucket and at once
// answers the owner "received". Strangers get nothing and leave nothing (before the chat is paired only "/start <code>"
// is kept). The app takes the folder when it starts and every 15 seconds while it is open (lib/telegram.js).
//
// Installed with the Cloudflare key's own REST API:
//   GET  /accounts/{id}/workers/subdomain               the account's workers.dev name (PUT makes one when it has none)
//   PUT  /accounts/{id}/workers/scripts/{name}          the module and its bindings: the bucket (INBOX), the bot's key
//                                                       and the secret (secret_text), the owner's chat and Telegram's
//                                                       address (plain_text)
//   POST /accounts/{id}/workers/scripts/{name}/subdomain   { enabled: true } - its address on workers.dev
// then Telegram's setWebhook. Uploaded again whenever what it holds changed (the chat paired, another bucket, a new bot
// key, a newer program); taken down (deleteWebhook, DELETE the script) when the bot key or the Cloudflare key goes.
// ════════════════════════════════════════════════════════════════════════════

const crypto = require('crypto');
const CF = require('./cloudflare');
const R2 = require('./r2');

// 2: before the chat is paired the code alone is kept too (the owner pressed Start on the bot, not on the link with the
// code, and "/start" came without it).
const VERSION = 2;
const PREFIX = 'telegram-inbox/';

// The program itself - plain JavaScript as Cloudflare runs it. Bumping VERSION uploads it again everywhere.
const WORKER = `// UGC Studio - Telegram receiver v${VERSION}. Put here by the app (Admin -> API keys); it keeps what the bot is
// sent while the app is closed. Removing the bot's key in the app takes it down.
const say = (env, chat, text, reply) => fetch(env.TG_API + '/bot' + env.BOT_TOKEN + '/sendMessage', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ chat_id: chat, text, reply_to_message_id: reply, allow_sending_without_reply: true }),
}).then(r => r.json()).catch(() => null);

export default {
  async fetch(req, env) {
    if (req.method !== 'POST') return new Response('UGC Studio receiver');
    if (req.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.HOOK_SECRET) return new Response('forbidden', { status: 403 });
    let u = null;
    try { u = await req.json(); } catch (e) { return new Response('ok'); }
    const m = u && (u.message || u.edited_message);
    if (!m || !m.chat || m.chat.type !== 'private' || !u.update_id) return new Response('ok');
    const owner = String(env.OWNER_CHAT || '');
    // Before pairing: "/start <code>" or the code alone - nothing else of anybody's is kept.
    const start = /^(\\/start(@\\w+)?\\s+\\S+|\\d{4,8})$/.test(String(m.text || '').trim());
    if (owner ? String(m.chat.id) !== owner : !start) return new Response('ok');
    const key = '${PREFIX}' + String(u.update_id).padStart(12, '0') + '.json';
    const at = Date.now();
    // On the disk first: a failed write is answered 500, and Telegram sends the message again.
    await env.INBOX.put(key, JSON.stringify({ update: u, replyId: 0, at }));
    if (owner && !start) {
      const d = await say(env, m.chat.id, '⏳ Received - it goes into UGC Studio as soon as the app is open.', m.message_id);
      if (d && d.ok && d.result) await env.INBOX.put(key, JSON.stringify({ update: u, replyId: d.result.message_id, at }));
    }
    return new Response('ok');
  },
};
`;

// Where a Worker answers. A stand points it at its fake (_setWorkersUrl).
let _urlOf = (name, sub) => `https://${name}.${sub}.workers.dev`;

const nameOf = (botId) => 'ugc-tg-' + String(botId).replace(/[^0-9a-z]/gi, '').toLowerCase();

async function _subdomain(account) {
  try {
    const r = await CF.api('GET', `/accounts/${encodeURIComponent(account)}/workers/subdomain`);
    if (r && r.subdomain) return r.subdomain;
  } catch (e) { /* none yet - made below */ }
  const r = await CF.api('PUT', `/accounts/${encodeURIComponent(account)}/workers/subdomain`,
    { subdomain: 'ugc-' + crypto.randomBytes(4).toString('hex') });
  if (!r || !r.subdomain) throw new Error('Cloudflare made no workers.dev name for the account');
  return r.subdomain;
}

/**
 * The receiver up to date for `want` = { botId, botToken, chatId, account, bucket, tgApi, secret }, uploading it only
 * when something it holds changed (`had` - the hook kept last time). Answers the hook to keep:
 * { v, script, url, account, bucket, chat, tokenTail, api, secret, at }. Telegram is pointed at it by the caller.
 */
async function ensure(want, had) {
  const script = nameOf(want.botId);
  const secret = (had && had.secret) || crypto.randomBytes(24).toString('hex');
  const same = had && had.v === VERSION && had.script === script && had.account === want.account
    && had.bucket === want.bucket && String(had.chat || '') === String(want.chatId || '')
    && had.tokenTail === String(want.botToken).slice(-6) && had.api === want.tgApi && had.url;
  const acc = encodeURIComponent(want.account);
  if (same) {
    // Still there, and still answering on workers.dev? (Deleted by hand in the dashboard, it is put up again.)
    try {
      const r = await CF.api('GET', `/accounts/${acc}/workers/scripts/${script}/subdomain`);
      if (r && r.enabled) return { ...had, fresh: false };
    } catch (e) { /* gone - uploaded below */ }
  }

  const sub = await _subdomain(want.account);
  const meta = {
    main_module: 'worker.js',
    compatibility_date: '2025-01-01',
    bindings: [
      { type: 'r2_bucket', name: 'INBOX', bucket_name: want.bucket },
      { type: 'secret_text', name: 'BOT_TOKEN', text: want.botToken },
      { type: 'secret_text', name: 'HOOK_SECRET', text: secret },
      { type: 'plain_text', name: 'OWNER_CHAT', text: String(want.chatId || '') },
      { type: 'plain_text', name: 'TG_API', text: want.tgApi },
    ],
  };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
  form.append('worker.js', new Blob([WORKER], { type: 'application/javascript+module' }), 'worker.js');
  await CF.api('PUT', `/accounts/${acc}/workers/scripts/${script}`, form);
  await CF.api('POST', `/accounts/${acc}/workers/scripts/${script}/subdomain`, { enabled: true });
  return {
    v: VERSION, script, url: _urlOf(script, sub), account: want.account, bucket: want.bucket, chat: String(want.chatId || ''),
    tokenTail: String(want.botToken).slice(-6), api: want.tgApi, secret, at: new Date().toISOString(), fresh: true,
  };
}

/** The Worker taken down. The Cloudflare key may be gone already - then it stays, harmless, and that is said. */
async function remove(hook) {
  if (!hook || !hook.script || !hook.account) return '';
  try { await CF.api('DELETE', `/accounts/${encodeURIComponent(hook.account)}/workers/scripts/${hook.script}`); return ''; }
  catch (e) { return e.status === 404 ? '' : ('the receiver ' + hook.script + ' could not be taken down: ' + e.message); }
}

/**
 * What the receiver left in the bucket, oldest first: `take(entry)` is called for each ({ update, replyId }) and must
 * have written it to the disk when it returns; the file is then taken away. A file that cannot be read is skipped.
 */
async function drain(take) {
  const keys = (await R2.listObjects(PREFIX)).filter(k => k.endsWith('.json')).sort();
  let n = 0;
  for (const k of keys) {
    let entry = null;
    try { entry = JSON.parse((await R2.getObject(k)).toString('utf8')); } catch (e) { continue; }
    if (entry && entry.update) await take(entry);
    try { await R2.deleteObject(k); } catch (e) { /* taken again next time - the update id says it was seen */ }
    n++;
  }
  return n;
}

function _setWorkersUrl(fn) { _urlOf = fn; }

module.exports = { VERSION, PREFIX, WORKER, nameOf, ensure, remove, drain, _setWorkersUrl };
