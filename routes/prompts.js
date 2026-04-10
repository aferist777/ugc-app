'use strict';

const express = require('express');
const router  = express.Router();
const { saveVersion, resetPrompt, getAllPrompts } = require('../lib/prompts');

router.get('/prompts', (_req, res) => {
  res.json({ success: true, prompts: getAllPrompts() });
});

router.post('/prompts/:key/save', (req, res) => {
  const { key } = req.params;
  const { text } = req.body;
  if (!text) return res.status(400).json({ success: false, error: 'Нет текста' });
  try {
    saveVersion(key, text);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

router.post('/prompts/:key/reset', (req, res) => {
  try {
    resetPrompt(req.params.key);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

module.exports = router;
