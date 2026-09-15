'use strict';

const express = require('express');
const router  = express.Router();
const { saveVersion, resetPrompt, getAllPrompts, renamePrompt, hidePrompt } = require('../lib/prompts');
const { callAI } = require('../lib/helpers');

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
  const { currentText, additions, fixedPhrases } = req.body;

  if (!currentText || !additions?.trim()) {
    return res.status(400).json({ success: false, error: 'Нет текста промпта или дополнений' });
  }

  // Extract all {placeholder} keys from the current prompt text
  const placeholders = [...new Set((currentText.match(/\{[^}]+\}/g) || []))];

  // Human-readable descriptions for the placeholders the live prompts use
  const PLACEHOLDER_DESCS = {
    '{USER_TEXT}': 'substituted with what the person typed about the character — do not remove or rename',
    '{BODY}':      'substituted with the body description read from the reference — do not remove or rename',
  };
  const placeholderLines = placeholders
    .map(ph => `  • ${ph} — ${PLACEHOLDER_DESCS[ph] || 'runtime substitution token, preserve exactly'}`)
    .join('\n');

  const metaPrompt =
    `You are a professional AI system prompt engineer.\n\n` +
    `TASK: Organically integrate the USER ADDITIONS into the ORIGINAL PROMPT without losing any important content.\n\n` +
    `ORIGINAL PROMPT:\n"""\n${currentText}\n"""\n\n` +
    `USER ADDITIONS (to integrate):\n"""\n${additions.trim()}\n"""\n\n` +
    `CRITICAL RULES — follow ALL without exception:\n` +
    (placeholders.length
      ? `1. These placeholder tokens are runtime substitution variables — preserve them EXACTLY as-is, do not paraphrase, split, or remove:\n${placeholderLines}\n`
      : '') +
    (fixedPhrases?.length
      ? `2. These sentences/phrases are load-bearing technical instructions — copy them VERBATIM, word for word, into the result (do not paraphrase or omit):\n${fixedPhrases.map(p => `  • "${p}"`).join('\n')}\n`
      : '') +
    `3. Do NOT remove or weaken the core instructions of the original prompt.\n` +
    `4. Weave the USER ADDITIONS naturally into the flow — no section headers, no bullets, no meta-commentary.\n` +
    `5. The final result must be a single coherent prompt in the same language and style as the original.\n` +
    `6. Return ONLY the final merged prompt text — no explanations, no labels, no preamble, no quotes.\n`;

  try {
    const merged = await callAI(
      [{ role: 'user', content: [{ type: 'text', text: metaPrompt }] }],
      { timeout: 45000, useOpenRouter: true }
    );
    res.json({ success: true, merged });
  } catch (err) {
    console.error('[prompts/merge]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// ── POST /api/prompts/:key/hide — soft-hide a default prompt from dropdowns ────
router.post('/prompts/:key/hide', (req, res) => {
  try {
    hidePrompt(req.params.key);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

module.exports = router;
