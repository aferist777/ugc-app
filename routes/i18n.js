'use strict';

/* The app's language (lib/i18n.js):
     GET  /api/i18n            { lang, chosen, langs, open, forced } - running, saved for the next start, the switch open
     GET  /api/i18n/dict.js    the classic script every page loads first: the running language and its dictionary
     POST /api/i18n/lang       { lang } - saved for the next start (Admin -> This computer); the page restarts the app */

const express = require('express');
const I18N = require('../lib/i18n');
const { ROOT_DIR } = require('../lib/config');

const router = express.Router();

router.get('/i18n', (_req, res) => {
  res.json({ success: true, ...I18N.state(ROOT_DIR) });
});

router.get('/i18n/dict.js', (_req, res) => {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.send(I18N.dictScript());
});

router.post('/i18n/lang', (req, res) => {
  const lang = String((req.body && req.body.lang) || '');
  try {
    if (!I18N.choose(lang)) return res.status(400).json({ success: false, error: I18N.t('The language switch is closed') });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
  res.json({ success: true, ...I18N.state(ROOT_DIR) });
});

module.exports = router;
