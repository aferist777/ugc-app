'use strict';

const express      = require('express');
const path         = require('path');
const fs           = require('fs');
const multer       = require('multer');
const router       = express.Router();

const { HOOKS_DIR, HOOKS_THUMB_DIR, UPLOADS_DIR } = require('../lib/config');
const VT = require('../lib/video-thumb');
const HERMES = 'nousresearch/hermes-4-70b';   // all biroly idea generation runs on Hermes 4
const { callAI } = require('../lib/helpers');

// ── Fixed structural sections for biroly category prompts ────────────────────
const BIROLY_SPINTAX_BLOCK = `━━━ SPINTAX FORMAT ━━━
Use {option1|option2|option3|option4|option5} groups for variation.
• Each {group} = a point where the content varies on each generation.
• Options separated by |, exactly 5 alternatives per group.
• Total groups: 8 to 10 (5 mandatory + 3 to 5 optional).
• Group names must be short English nouns (e.g. "CameraAndOptics", "AngleAndShotType", "Location").
• FIRST option in every group must closely match what is actually seen in the video.
• Keep all variations in realistic, live-action style (no 3D render, CGI, animation, or non-photorealistic style).

━━━ MANDATORY GROUPS (always include all 5, in this order) ━━━
1. Camera & Optics — pick 5 fitting camera+lens combos based on the video's look. Examples to use as a starting point if the video matches: {Sony A7S III with 35mm lens|Canon EOS R5 with 50mm lens|ARRI Alexa Mini with 24mm lens|RED Komodo with 85mm lens|iPhone 15 Pro main lens}.
2. Angle & Shot Type — pick 5 different framing angles. Examples: {eye-level shot|low angle shot|high angle shot|dutch angle shot|over-the-shoulder shot}.
3. Camera Movement — pick 5 different camera motions. Examples: {static handheld|slow dolly in|smooth tracking shot|gimbal walk-through|locked-off tripod}.
4. Lighting & Atmosphere — pick 5 distinct lighting/mood states. Examples: {soft natural daylight|warm golden hour|moody low-key with practicals|cool overcast diffused light|hard directional studio lighting}.
5. Shot Scale — pick 5 different framing scales. Examples: {extreme close-up|medium close-up|medium shot|wide shot|extreme wide shot}.

For each mandatory group, regenerate fresh 5 options that match the actual subject and energy of the video — do not blindly copy the example list above. The first option must reflect what the video actually shows.

━━━ OPTIONAL GROUPS (add 3 to 5 more, picked by topic of the biroly) ━━━
Pick groups whose variation would meaningfully change the visual outcome for THIS specific biroly. Choose from (or invent equivalent): Location, Environment, ObjectDetails (the main object/subject described in user input), SubjectWardrobe, TimeOfDay, Mood, ColorGrading, DepthOfField, Composition, MotionTempo. Each chosen group must have exactly 5 alternatives. Do NOT add a group if it doesn't add meaningful visual variation.`;

const BIROLY_RETURN_BLOCK = `━━━ RETURN FORMAT ━━━
Return ONLY valid JSON — no markdown, no code blocks, no extra text:
{"prompt": "full prompt with {spintax} groups", "groupNames": ["EnglishGroupName1", "EnglishGroupName2", ...]}`;

// The metaphor-lexicon injector and the category system-prompt builder went with the Ideas
// popup that was their only caller.


const BIROLY_CAT_FIXED_PHRASES = [
  'Use {option1|option2|option3|option4|option5} groups for variation.',
  'FIRST option in every group must closely match what is actually seen in the video',
  'Total groups: 8 to 10 (5 mandatory + 3 to 5 optional).',
  'MANDATORY GROUPS (always include all 5, in this order)',
  'OPTIONAL GROUPS (add 3 to 5 more, picked by topic of the biroly)',
  'Return ONLY valid JSON — no markdown, no code blocks, no extra text:',
  '{"prompt": "full prompt with {spintax} groups"',
];


const DEFAULT_BIROLY_SYSTEM_PROMPT_TEMPLATE = `You are an expert UGC content creator and prompt engineer specializing in biroly video hooks.

A biroly is a short (2–8 sec) video clip used as a hook in UGC content — a visually engaging action, experiment, or moment that grabs attention.

TASK: Analyze the video/frame and generate a prompt with spintax variations for recreating similar biroly content.

${BIROLY_SPINTAX_BLOCK}

━━━ EXISTING BIROLY PROMPTS — MATCH THIS STYLE EXACTLY ━━━
{{EXAMPLES}}

━━━ INSTRUCTIONS ━━━
1. Analyze the video/frame: identify subject, action, motion, setting, props, lighting, camera angle, visual style.
2. Write a rich English prompt (2–4 sentences) for generating similar biroly images/videos.
3. Insert {spintax} groups following the SPINTAX FORMAT block above — 5 mandatory groups (Camera & Optics, Angle & Shot Type, Camera Movement, Lighting & Atmosphere, Shot Scale) plus 3 to 5 optional groups picked for THIS biroly's topic.
4. FIRST option in every spintax group must closely match what is actually seen in the video — use it to recreate the original as accurately as possible.
5. Subsequent options must NOT be synonyms or minor rewrites of the first. They should be tangentially related alternatives — same category of thing, but meaningfully different in visual result, context, or energy. Think: "same slot, different universe."
6. Keep all variations grounded in realistic, live-action style. Do NOT include 3D render, CGI, animation, cartoon, digital art, or any non-photorealistic style.
7. Name each group in English (short PascalCase or single noun).
8. The prompt must be production-ready for AI image/video generation (Kie.ai, Flux, Sora).
9. Slot context: "{{SLOT}}"

${BIROLY_RETURN_BLOCK}`;

// ── GET /api/biroly/default-system-prompt ─────────────────────────────────────
router.get('/biroly/default-system-prompt', (req, res) => {
  res.json({ success: true, prompt: DEFAULT_BIROLY_SYSTEM_PROMPT_TEMPLATE });
});

// ── POST /api/biroly/edit-system-prompt — AI rewrites prompt based on user request
router.post('/biroly/edit-system-prompt', async (req, res) => {
  const { currentPrompt, userRequest } = req.body || {};
  if (!currentPrompt?.trim()) return res.json({ success: false, error: 'currentPrompt required' });
  if (!userRequest?.trim())   return res.json({ success: false, error: 'userRequest required' });

  const aiPrompt = `You are a prompt engineer. Below is a system prompt used for AI video analysis that generates biroly content spintax. Modify it according to the user's request.

CURRENT SYSTEM PROMPT:
${currentPrompt}

USER'S MODIFICATION REQUEST:
${userRequest}

━━━ STRICT RULES ━━━
• Keep the {{EXAMPLES}} placeholder EXACTLY as-is (replaced with real examples at runtime)
• Keep the {{SLOT}} placeholder EXACTLY as-is (replaced with slot name at runtime)
• Keep the ━━━ RETURN FORMAT ━━━ section and the JSON instruction line EXACTLY as-is
• Keep the spintax format rules block EXACTLY as-is (the ━━━ SPINTAX FORMAT ━━━ section)
• Only modify: the TASK description, the INSTRUCTIONS numbered list, category-specific guidance, and style instructions

Return ONLY the full updated system prompt text. No explanations, no code blocks, no markdown.`;

  try {
    const newPrompt = await callAI([{ role: 'user', content: aiPrompt }], { timeout: 60000, maxAttempts: 2, useOpenRouter: true, openRouterModel: HERMES });
    res.json({ success: true, newPrompt: newPrompt.trim() });
  } catch (e) {
    console.error('[biroly edit-system-prompt]', e.message);
    res.json({ success: false, error: e.message });
  }
});

// ── POST /api/biroly/apply-edit — AI applies user changes to an existing spintax prompt ──
// Body: { currentPrompt, userRequest }
// Returns { success, newPrompt }
router.post('/biroly/apply-edit', async (req, res) => {
  const { currentPrompt, userRequest } = req.body || {};
  if (!currentPrompt?.trim()) return res.json({ success: false, error: 'currentPrompt required' });
  if (!userRequest?.trim())   return res.json({ success: false, error: 'userRequest required' });

  const systemMsg = `You are an expert editor for AI video/image generation prompt templates written in SPINTAX format.

SPINTAX FORMAT:
Prompts containing variation groups in curly braces: {option1|option2|option3}
At runtime one option is chosen randomly. Groups can be nested in plain prose.
Example: "A {young woman|girl} {walking|strolling} through {a park|a city street|a sunlit garden}"

YOUR TASK:
Apply the user's requested changes to the existing spintax template. Return the improved version.

STRICT RULES:
1. Preserve the exact {option1|option2|option3} syntax — curly braces and pipe separators only
2. Keep every group the user did NOT ask to change, including its exact wording
3. When adding variety: insert new pipe-separated options inside the relevant group
4. When changing tone/style/topic: update the option text while keeping the group count and position
5. Prose text between groups may be changed only if the user explicitly requests it
6. All text must remain in English (prompts are fed to English-language AI generation models)
7. Return ONLY the raw spintax template text — no explanations, no markdown, no code blocks, no quotes`;

  const userMsg = `CURRENT TEMPLATE:\n${currentPrompt}\n\nUSER'S CHANGE REQUEST:\n${userRequest}\n\nReturn the modified template:`;

  try {
    const newPrompt = await callAI([
      { role: 'system', content: systemMsg },
      { role: 'user',   content: userMsg },
    ], { timeout: 35000, maxAttempts: 2, useOpenRouter: true, openRouterModel: HERMES });
    res.json({ success: true, newPrompt: newPrompt.trim() });
  } catch (e) {
    console.error('[biroly/apply-edit]', e.message);
    res.json({ success: false, error: e.message });
  }
});

const MAX_FILE_SIZE    = 20 * 1024 * 1024; // 20 MB
const ALLOWED_EXTS     = ['.mp4', '.webm', '.mov', '.avi', '.mkv'];
const ALLOWED_MIMES    = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo', 'video/avi', 'video/x-matroska'];

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, HOOKS_DIR),
  filename:    (req, file, cb) => {
    const ext    = path.extname(file.originalname).toLowerCase();
    const safeExt = ALLOWED_EXTS.includes(ext) ? ext : '.mp4';
    const ts     = Date.now();
    const rnd    = Math.random().toString(36).slice(2, 6);
    cb(null, `hook_${ts}_${rnd}${safeExt}`);
  },
});
const upload = multer({
  storage,
  limits:     { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_MIMES.includes(file.mimetype) || ALLOWED_EXTS.includes(ext)) cb(null, true);
    else cb(new Error(`Неподдерживаемый формат: ${ext}`), false);
  },
});

// Thumbnails come from lib/video-thumb.js: one frame at 0.5s resized to 160px wide.
// The old local helper here wrote the frame at FULL resolution, which is how the media
// shelf ended up loading megabytes to paint 72px cards.

// ── POST /api/hooks/upload — multipart; field "video" + text field "name" ────
router.post('/hooks/upload', upload.single('video'), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: 'Нет файла' });
  const { filename, path: filePath } = req.file;
  const rawName  = (req.body.name || '').trim();
  const safeName = rawName.replace(/[^a-zA-Zа-яА-ЯёЁ0-9_\- ]/g, '').trim()
    || path.basename(filename, path.extname(filename));

  let thumbUrl = null;
  try { thumbUrl = (await VT.makeThumb('/hooks/' + filename)).thumb; }
  catch (e) { console.warn('[hooks/upload] thumb failed:', e.message); }

  return res.json({
    success:   true,
    filename,
    name:      safeName,
    videoPath: `/hooks/${filename}`,
    thumbPath: thumbUrl,
  });
});

// Handle multer errors (e.g. file too large, bad mime type)
router.use('/hooks/upload', (err, req, res, next) => {
  if (err) return res.status(400).json({ success: false, error: err.message });
  next(err);
});

// ── DELETE /api/hooks/delete ──────────────────────────────────────────────────
router.delete('/hooks/delete', (req, res) => {
  const { filename } = req.body;
  if (!filename) return res.status(400).json({ success: false, error: 'Нет имени' });
  const safe = path.basename(filename);
  const fp   = path.join(HOOKS_DIR, safe);
  if (!fs.existsSync(fp)) return res.status(404).json({ success: false, error: 'Не найден' });
  fs.unlinkSync(fp);
  const thumbFp = path.join(HOOKS_THUMB_DIR, path.basename(safe, path.extname(safe)) + '_thumb.jpg');
  if (fs.existsSync(thumbFp)) fs.unlinkSync(thumbFp);
  res.json({ success: true });
});

// ── Gone with the Ideas popup ────────────────────────────────────────────────
// generate-category-prompt, ideas-from-scenario, the idea-examples library, the
// per-vertical config, idea-remake and idea-spintax-expand: nine endpoints that only the
// b-roll Ideas popup called, and that popup was deleted in an earlier pass. Verified
// against every surviving script before cutting.

// Body: { text }
// Returns: { success, prompt, groupNames }
// Used by the slot popup's "Extract" button when the user-pasted text contains
// NO spintax groups: AI takes that text and injects ONLY the 5 mandatory groups
// (Camera & Optics, Angle & Shot Type, Camera Movement, Lighting & Atmosphere,
// Shot Scale) — no optional groups, no rewriting of user's content beyond
// inserting the 5 spintax anchors.
router.post('/biroly/extract-mandatory', async (req, res) => {
  const { text } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ success: false, error: 'Нет текста' });

  const SYSTEM = `You will receive a user-written prompt for a biroly hook video. The user's text has NO spintax variation. Your task: keep the user's text exactly as it is in meaning, content, and structure — and inject EXACTLY 5 spintax groups, one for each mandatory category below. Do NOT add any other groups. Do NOT rewrite or paraphrase the user's content; only weave in the spintax anchors at the most natural points.

Mandatory groups (in this fixed order, English PascalCase names):
1. CameraAndOptics — camera body + lens combos. Examples: {Sony A7S III with 35mm lens|Canon EOS R5 with 50mm lens|ARRI Alexa Mini with 24mm lens|RED Komodo with 85mm lens|iPhone 15 Pro main lens}
2. AngleAndShotType — framing angles. Examples: {eye-level shot|low angle shot|high angle shot|dutch angle shot|over-the-shoulder shot}
3. CameraMovement — camera motion. Examples: {static handheld|slow dolly in|smooth tracking shot|gimbal walk-through|locked-off tripod}
4. LightingAndAtmosphere — lighting/mood. Examples: {soft natural daylight|warm golden hour|moody low-key with practicals|cool overcast diffused light|hard directional studio lighting}
5. ShotScale — framing scale. Examples: {extreme close-up|medium close-up|medium shot|wide shot|extreme wide shot}

Hard rules:
- Each group MUST have EXACTLY 5 options separated by |.
- FIRST option in every group must closely match what the user's text most strongly implies (so generation can recreate the user's intent).
- Other 4 options must be tangentially related alternatives in the same category — meaningfully different visual outcomes, not synonyms.
- Generate fresh 5 options per group based on the user's actual subject and context — do not blindly copy the example list above.
- All options realistic, live-action. No CGI / animation / cartoon styles.
- Keep all user-original wording intact between the spintax anchors.

User's text:
"""
${text.trim()}
"""

Return ONLY valid JSON, no markdown, no extra text:
{"prompt": "user text with the 5 inline {spintax|groups} woven in", "groupNames": ["CameraAndOptics", "AngleAndShotType", "CameraMovement", "LightingAndAtmosphere", "ShotScale"]}`;

  try {
    const raw = await callAI([
      { role: 'system', content: SYSTEM },
      { role: 'user',   content: text.trim() },
    ], { timeout: 30000, maxAttempts: 2, useOpenRouter: true, openRouterModel: HERMES });
    let jsonStr = raw.replace(/^```(?:json)?\s*/m, '').replace(/```\s*$/m, '').trim();
    const start = jsonStr.indexOf('{');
    if (start === -1) throw new Error(`AI ответил без JSON: ${raw.slice(0, 200)}`);
    let depth = 0, end = -1, inStr = false, escape = false;
    for (let i = start; i < jsonStr.length; i++) {
      const c = jsonStr[i];
      if (escape) { escape = false; continue; }
      if (c === '\\' && inStr) { escape = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    jsonStr = jsonStr.slice(start, end !== -1 ? end + 1 : undefined);
    let parsed;
    try { parsed = JSON.parse(jsonStr); } catch {
      let fixed = '', inside = false, esc = false;
      for (let i = 0; i < jsonStr.length; i++) {
        const c = jsonStr[i];
        if (esc) { fixed += c; esc = false; continue; }
        if (c === '\\') { fixed += c; esc = true; continue; }
        if (c === '"') { inside = !inside; fixed += c; continue; }
        if (inside) {
          if      (c === '\n') fixed += '\\n';
          else if (c === '\r') fixed += '\\r';
          else if (c === '\t') fixed += '\\t';
          else                 fixed += c;
        } else { fixed += c; }
      }
      parsed = JSON.parse(fixed);
    }
    if (!parsed.prompt) throw new Error('AI не вернул поле prompt');
    res.json({ success: true, prompt: parsed.prompt, groupNames: parsed.groupNames || [] });
  } catch (err) {
    console.error('[biroly extract-mandatory]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/biroly/gen-broll-prompt — generate one B-roll prompt from idea ──
// Body: { idea }
// Returns: { success, prompt, groupNames }
router.post('/biroly/gen-broll-prompt', async (req, res) => {
  const { idea } = req.body;
  if (!idea) return res.status(400).json({ success: false, error: 'Нет идеи' });

  const SYSTEM = `You are an elite cinematographer and prompt engineer specializing in AI video generation (Veo 3, Sora, Kling, Runway, Pika). Your output is a single richly-detailed, beautifully-written b-roll prompt packed with cinematic specificity and spintax variation syntax {option1|option2|option5} for maximum creative range.

TASK: Generate EXACTLY ONE b-roll prompt for the given idea. Make it lush, visual, and production-ready.

--- PROMPT STRUCTURE ---
Write a single dense English paragraph. No headers, no line breaks, no markdown inside the prompt. Follow this order:

1. SHOT OPENING: shot type + cinematic aesthetic label (e.g. "Extreme close-up macro shot", "Slow-motion hyperrealistic wide angle", "Intimate handheld documentary close-up")

2. SUBJECT + ACTION: what is happening with rich tactile and visual texture — surface detail, material quality, color temperature, scale, physical behavior, micro-details

3. CAMERA MOVEMENT: precise named technique (e.g. "slow push-in dolly", "smooth orbital tracking", "rack focus pull", "subtle handheld drift", "120fps crash zoom", "crane descent", "parallax shift")

4. ENVIRONMENT + DEPTH: foreground, midground, background with specific details — props, architectural elements, natural textures, atmospheric particles (steam, dust motes, bokeh circles, lens flare)

5. LIGHTING: precise setup with direction and quality (e.g. "rim light catching moisture servers mid-air", "low-angle golden hour raking light", "single-source chiaroscuro", "volumetric shafts through fog")

6. MOOD + AESTHETIC REFERENCE: cinematic genre tone (National Geographic, A24 film, ASMR editorial, Wes Anderson symmetry, Blade Runner neon-noir, high-fashion editorial, BBC nature documentary)

7. TECHNICAL SPECS: specific and precise (e.g. "8K resolution 120fps slow motion f/1.4 aperture 85mm macro lens ultra-shallow depth of field")

8. NEGATIVE TAGS: always end with "no text, no logos, no watermark, no CGI, no animation"

--- SPINTAX RULES ---
MANDATORY: include EXACTLY 6 to 8 spintax groups in the prompt.
MANDATORY: each group must contain EXACTLY 5 to 8 options separated by |.
Place spintax at points that genuinely transform the shot: subject identity, action nuance, surface/material, camera movement, lighting setup, mood/aesthetic, lens/format, environment detail.
Options within one group MUST be grammatically interchangeable (nouns with nouns, verb phrases with verb phrases).
Make options meaningfully different — not synonyms. Each option should produce a visually distinct result.
Span a range from grounded/realistic to stylized/dramatic.
BAD spintax: {beautiful|gorgeous|stunning} — vague adjective synonyms.
GOOD spintax: {rain-slicked cobblestone|polished white marble|cracked desert earth|weathered oak planks|frosted tempered glass|brushed steel surface} — specific surfaces with distinct visual texture.
All options must be realistic and live-action. No CGI, cartoon, animation or render styles anywhere.

--- QUALITY BAR ---
Every phrase must be visually specific and sensory. No empty filler words.
GOOD: "rim light catching micro-servers suspended mid-air against deep-focus shadow"
BAD: "nice lighting effect"
GOOD: "f/1.2 extreme bokeh dissolving city lights into warm abstract halos"
BAD: "blurry background"
The prompt should read like a cinematographer's precise shot note — actionable, atmospheric, beautiful.
One coherent scene only. No unrelated cuts. No platform flags (no --ar, no --v).

--- SPINTAX GROUP NAMES ---
Name each group in short Russian nouns labeling WHAT varies (e.g. "Субъект", "Поверхность", "Камера", "Движение", "Свет", "Атмосфера", "Стилистика", "Формат", "Детали", "Фон").

--- RETURN FORMAT ---
Valid JSON only. No markdown fences, no extra text, no explanation before or after:
{"prompt": "full richly-detailed English b-roll prompt with exactly 6 to 8 inline {spintax|groups} each having 5 to 8 options", "groupNames": ["РусскоеНазвание1", "РусскоеНазвание2", "РусскоеНазвание3", "РусскоеНазвание4", "РусскоеНазвание5", "РусскоеНазвание6"]}`;

  try {
    const raw = await callAI([
      { role: 'system', content: SYSTEM },
      { role: 'user',   content: idea },
    ], { timeout: 30000, maxAttempts: 2, useOpenRouter: true, openRouterModel: HERMES });
    let jsonStr = raw.replace(/^```(?:json)?\s*/m, '').replace(/```\s*$/m, '').trim();
    const start = jsonStr.indexOf('{');
    if (start === -1) throw new Error(`AI ответил без JSON: ${raw.slice(0, 200)}`);
    let depth = 0, end = -1, inStr = false, escape = false;
    for (let i = start; i < jsonStr.length; i++) {
      const c = jsonStr[i];
      if (escape) { escape = false; continue; }
      if (c === '\\' && inStr) { escape = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    jsonStr = jsonStr.slice(start, end !== -1 ? end + 1 : undefined);
    let parsed;
    try { parsed = JSON.parse(jsonStr); } catch {
      let fixed = '', inside = false, esc = false;
      for (let i = 0; i < jsonStr.length; i++) {
        const c = jsonStr[i];
        if (esc) { fixed += c; esc = false; continue; }
        if (c === '\\') { fixed += c; esc = true; continue; }
        if (c === '"') { inside = !inside; fixed += c; continue; }
        if (inside) {
          if      (c === '\n') fixed += '\\n';
          else if (c === '\r') fixed += '\\r';
          else if (c === '\t') fixed += '\\t';
          else                 fixed += c;
        } else { fixed += c; }
      }
      parsed = JSON.parse(fixed);
    }
    if (!parsed.prompt) throw new Error('AI не вернул поле prompt');
    res.json({ success: true, prompt: parsed.prompt, groupNames: parsed.groupNames || [] });
  } catch (err) {
    console.error('[biroly gen-broll-prompt]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Gone with the Ideas popup ────────────────────────────────────────────────
// generate-category-prompt, ideas-from-scenario, the idea-examples library, the
// per-vertical config, idea-remake and idea-spintax-expand: nine endpoints that only the
// b-roll Ideas popup called, and that popup was deleted in an earlier pass. Verified
// against every surviving script before cutting.

// Body: { videoPath: '/uploads/grok_txt_xxx.mp4' }
// Permanently removes a generated biroll mp4 from disk. Used by the Ideas
// popup's lightbox "🗑 delete" button. Strict path safety: only files inside
// UPLOADS_DIR can be touched, no directory traversal.
router.post('/biroly/delete-video', (req, res) => {
  const { videoPath } = req.body || {};
  if (!videoPath || typeof videoPath !== 'string') {
    return res.status(400).json({ success: false, error: 'videoPath required' });
  }
  if (!videoPath.startsWith('/uploads/')) {
    return res.status(400).json({ success: false, error: 'only /uploads/ paths allowed' });
  }
  const rel = videoPath.slice('/uploads/'.length).replace(/\\/g, '/');
  if (rel.includes('..')) {
    return res.status(400).json({ success: false, error: 'invalid path (traversal)' });
  }
  const abs = path.join(UPLOADS_DIR, rel);
  // Final guard: resolved path must live inside UPLOADS_DIR
  const absNorm = path.resolve(abs);
  const upNorm  = path.resolve(UPLOADS_DIR);
  if (!absNorm.startsWith(upNorm + path.sep) && absNorm !== upNorm) {
    return res.status(400).json({ success: false, error: 'path outside uploads dir' });
  }
  try {
    if (fs.existsSync(absNorm)) {
      fs.unlinkSync(absNorm);
      return res.json({ success: true, deleted: true });
    }
    res.json({ success: true, deleted: false, note: 'file not on disk' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
