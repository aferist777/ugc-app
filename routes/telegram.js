'use strict';

// ════════════════════════════════════════════════════════════════════════════
// THE OWNER'S TELEGRAM BOT (phase TG) - Admin -> API keys, the row "Telegram bot" (lib/telegram.js).
//
//   GET  /api/telegram           -> { tokenSet, bot, chat, code, mode: receiver|poll|off, receiver, connecting, error,
//                                     conflict, receiverError, lastAt, queue: { waiting, error } }   - never the key
//   POST /api/telegram/connect   -> the same, after the keys were looked at again (a key saved, or "connect")
//   POST /api/telegram/unpair    -> the same, the chat forgotten and a new code made
// ════════════════════════════════════════════════════════════════════════════

const express = require('express');
const TG = require('../lib/telegram');

const router = express.Router();

router.get('/telegram', (_req, res) => {
  try { res.json({ success: true, ...TG.view() }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/telegram/connect', async (_req, res) => {
  try { res.json({ success: true, ...(await TG.connect()) }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/telegram/unpair', async (_req, res) => {
  try { res.json({ success: true, ...(await TG.unpair()) }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

module.exports = router;
