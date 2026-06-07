'use strict';

// ── Prompt compiler ───────────────────────────────────────────────────────────
// Turns a raw scene/intent prompt into a realism-enhanced prompt for the image
// engines. A text LLM (Hermes 4) structures the scene into a STRICT JSON spec
// (so nothing is dropped) and weaves in the iPhone-14 home-video realism markers;
// the JSON is then serialized into one rich prompt string the engines consume.
//
// Used by every "character in a scene" generation (photoshoot poses, lookbook /
// environment apply, tpdne dressing). Reference sheets are intentionally NOT
// compiled — they stay neutral studio identity sheets.

const { callAI } = require('./helpers');
const { getPrompt } = require('./prompts');
const { IMG_COMPILE_MODEL } = require('./config');

// Serialize the strict JSON spec into one prompt string for the image engine.
// Negatives are folded into the positive prompt as "Avoid: …" because our
// Replicate engines (nano-banana-2 / qwen-edit / gpt-image-2 / seedream) take a
// single text prompt and do not expose a negative_prompt parameter.
function _serialize(json) {
  const parts = [json.scene, json.camera, json.lighting, json.texture, json.color]
    .map(s => String(s == null ? '' : s).trim())
    .filter(Boolean);
  let p = parts.join(' ');
  const neg = String(json.negative == null ? '' : json.negative).trim();
  if (neg) p += ' Avoid: ' + neg + '.';
  return p.trim();
}

// Compile a raw scene/intent prompt → realism-enhanced prompt.
//   opts.lockToReference: keep background / camera / clothing identical (variations)
// Returns { prompt, json }. Never throws — on any failure it falls back to the
// raw prompt plus the realism spec so generation still receives the markers.
async function compileImagePrompt(rawPrompt, opts = {}) {
  const raw = String(rawPrompt == null ? '' : rawPrompt).trim();
  if (!raw) return { prompt: '', json: null };

  const realism = getPrompt('REALISM_SPEC') || '';
  const lock = opts.lockToReference
    ? 'HARD LOCK: the background, environment, camera angle, framing and clothing must stay EXACTLY as in SCENE — only the pose / gaze may differ.\n\n'
    : '';
  const tpl = (getPrompt('IMAGE_PROMPT_COMPILE_PROMPT') || '')
    .replace('{RAW}', raw)
    .replace('{REALISM}', realism)
    .replace('{LOCK}', lock);

  const _attempt = async () => {
    const out = await callAI([{ role: 'user', content: tpl }], {
      useOpenRouter: true, openRouterModel: IMG_COMPILE_MODEL, timeout: 40000,
    });
    const m = String(out || '').match(/\{[\s\S]*\}/);
    if (!m) return null;
    let j; try { j = JSON.parse(m[0]); } catch { return null; }
    return (j && typeof j === 'object' && j.scene) ? j : null;
  };

  try {
    let j = await _attempt();
    if (!j) j = await _attempt();               // one retry on bad/empty JSON
    if (j) {
      const prompt = _serialize(j);
      if (prompt) return { prompt, json: j };
    }
  } catch (e) {
    console.warn('[prompt-compiler]', e.message);
  }
  // Fallback — still inject the realism markers so the image is not "plastic".
  return { prompt: raw + '\n\n' + realism, json: null };
}

module.exports = { compileImagePrompt };
