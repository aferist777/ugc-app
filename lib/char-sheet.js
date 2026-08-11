'use strict';

// The character reference sheet's prompt, assembled per reference.
//
// The sheet shows the whole body from three angles, so what the prompt should say about that body
// depends on whether the reference actually contains one. A full-body photo wants "preserve what
// you see". A head crop makes that instruction meaningless, and the model quietly fills the gap
// with an average build - which is how a very heavy or very thin character became neither. So the
// framing agent looks first, and the prompt either preserves or constructs.
//
// Non-fatal by design: if the agent cannot be reached the sheet still generates, with the
// preserve wording it always had. A sheet is better than no sheet.

const { callAIVisionWithFallback, getImgVisionModel, parseLooseJson } = require('./helpers');
const { getPrompt } = require('./prompts');

// What the prompt said before this existed, and what it falls back to.
const FALLBACK_BODY = 'Faithfully preserve the body proportions and height from the reference.';

async function readFraming(imageUrl) {
  const raw = await callAIVisionWithFallback([{
    role: 'user',
    content: [
      { type: 'text', text: String(getPrompt('CV2_FRAMING_PROMPT') || '') },
      { type: 'image_url', image_url: { url: imageUrl } },
    ],
  }], { timeout: 45000, useOpenRouter: true, openRouterModel: getImgVisionModel() });
  const j = parseLooseJson(raw);
  if (!j || typeof j !== 'object') throw new Error('the framing agent did not answer with JSON');
  return {
    full: j.full === true,
    visible: String(j.visible || '').trim(),
    figure: String(j.figure || '').trim(),
  };
}

function bodyClause(framing, figureOverride) {
  // What the page KNOWS beats what the agent guessed: a build the user chose from a dropdown is
  // a fact, while a build read off a face is an inference.
  const figure = String(figureOverride || '').trim() || framing.figure;
  if (framing.full) {
    return 'The reference shows the whole body, so preserve its build, proportions and height exactly'
      + (figure ? ' - ' + figure : '') + '.';
  }
  return 'The reference shows ' + (framing.visible || 'only the head and shoulders')
    + ', so the body is not visible in it. Build the body as: '
    + (figure || 'average build, average height')
    + '. Use that same build, unchanged, in all three full-body views.';
}

// realismMarkers: the Create chips, appended as they always were.
// figure: what the page knows about the build, if anything.
async function buildSheetPrompt(imageUrl, { realismMarkers = [], figure = '' } = {}) {
  let body = FALLBACK_BODY;
  try {
    const framing = await readFraming(imageUrl);
    body = bodyClause(framing, figure);
    console.log('[char-sheet] framing:', framing.full ? 'whole body' : (framing.visible || 'partial'),
      '| build:', figure ? (figure + ' (from the page)') : (framing.figure + ' (read from the image)'));
  } catch (e) {
    console.warn('[char-sheet] framing agent failed, keeping the preserve wording:', e.message);
  }
  const base = String(getPrompt('CHAR_SHEET_PROMPT') || '').replace(/\{BODY\}/g, body);
  const m = Array.isArray(realismMarkers) ? realismMarkers.map(s => String(s).trim()).filter(Boolean) : [];
  return m.length ? (base + ' Realism: ' + m.join(', ') + '.') : base;
}

module.exports = { buildSheetPrompt, readFraming, bodyClause, FALLBACK_BODY };
