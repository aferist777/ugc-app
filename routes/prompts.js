'use strict';

const express = require('express');
const axios   = require('axios');
const router  = express.Router();
const { saveVersion, resetPrompt, getAllPrompts, renamePrompt, getPrompt } = require('../lib/prompts');
const { KIE_BASE } = require('../lib/config');
const { kieHeaders } = require('../lib/helpers');

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

router.post('/prompts/:key/rename', (req, res) => {
  const { key } = req.params;
  const { label } = req.body;
  try {
    renamePrompt(key, (label || '').trim() || null);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

// ── POST /api/prompts/:key/merge — AI-assisted merge of additions into prompt ──
router.post('/prompts/:key/merge', async (req, res) => {
  const { key } = req.params;
  const { currentText, additions, fixedPhrases } = req.body;

  if (!currentText || !additions?.trim()) {
    return res.status(400).json({ success: false, error: 'Нет текста промпта или дополнений' });
  }

  // Extract all {placeholder} keys from the current prompt text
  const placeholders = [...new Set((currentText.match(/\{[^}]+\}/g) || []))];

  const metaPrompt =
    `You are a professional AI system prompt engineer.\n\n` +
    `TASK: Organically integrate the USER ADDITIONS into the ORIGINAL PROMPT without losing any important content.\n\n` +
    `ORIGINAL PROMPT:\n"""\n${currentText}\n"""\n\n` +
    `USER ADDITIONS (to integrate):\n"""\n${additions.trim()}\n"""\n\n` +
    `CRITICAL RULES — follow ALL without exception:\n` +
    (placeholders.length
      ? `1. Preserve these placeholder tokens EXACTLY as written (do not alter, split, or remove): ${placeholders.join(', ')}\n`
      : '') +
    (fixedPhrases?.length
      ? `2. Preserve these phrases VERBATIM (do not paraphrase or remove): ${fixedPhrases.map(p => `"${p}"`).join('; ')}\n`
      : '') +
    `3. Do NOT remove or weaken the core instructions of the original prompt.\n` +
    `4. Weave the USER ADDITIONS naturally into the flow — no section headers, no bullets, no meta-commentary.\n` +
    `5. The final result must be a single coherent prompt in the same language and style as the original.\n` +
    `6. Return ONLY the final merged prompt text — no explanations, no labels, no preamble, no quotes.`;

  try {
    const gemRes = await axios.post(
      `${KIE_BASE}/gemini-3.1-pro/v1/chat/completions`,
      {
        stream: false,
        messages: [{ role: 'user', content: [{ type: 'text', text: metaPrompt }] }],
      },
      { headers: kieHeaders(), timeout: 45000 }
    );
    const merged = (gemRes.data?.choices?.[0]?.message?.content || '').trim();
    if (!merged) throw new Error('Gemini вернул пустой ответ');
    res.json({ success: true, merged });
  } catch (err) {
    console.error('[prompts/merge]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

module.exports = router;
