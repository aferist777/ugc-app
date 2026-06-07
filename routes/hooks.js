'use strict';

const express      = require('express');
const path         = require('path');
const fs           = require('fs');
const { execFile } = require('child_process');
const ffmpegPath   = require('ffmpeg-static');
const multer       = require('multer');
const router       = express.Router();

const { HOOKS_DIR, HOOKS_THUMB_DIR, SCENARIOS_DIR, UPLOADS_DIR, DATA_DIR } = require('../lib/config');
const HERMES = 'nousresearch/hermes-4-70b';   // all biroly idea generation runs on Hermes 4
const { callAIBase64, callAI } = require('../lib/helpers');

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

// ── Per-vertical niche-visual-vocabulary injector ───────────────────────────
// Called from /ideas-from-scenario (every batch — LITERAL / METAPHOR / ENERGY)
// and from /idea-remake. The payload comes from the popup's ⚙ Settings panel
// (localStorage: biroly_metaphor_settings_v1). Frontend always sends it when
// the user has a non-empty lexicon for the active vertical; backend just
// renders it. Empty / malformed → returns ''.
function _buildMetaphorLexiconBlock(metaphor) {
  if (!metaphor || typeof metaphor !== 'object') return '';
  const lexicon = String(metaphor.lexicon || '').trim();
  if (!lexicon) return '';
  const verticalLabels = {
    potency: 'потенция', prostate: 'простата', memory: 'память', weight_loss: 'похудение',
  };
  const verticalKey = verticalLabels[metaphor.vertical] ? metaphor.vertical : 'potency';
  const verticalNameRu = verticalLabels[verticalKey];
  const items = lexicon
    .split(/\r?\n/).map(s => s.trim()).filter(Boolean).slice(0, 40);
  if (!items.length) return '';
  const strict = metaphor.applyMode === 'strict';
  const header = strict
    ? `━━━ NICHE VISUAL LEXICON — STRICT (vertical: ${verticalNameRu}) ━━━\n` +
      `Every idea in this response must be built around one item from the curated list below — the main visual subject, prop, setting, or symbolic element of each shot must come from this list. Do NOT invent subjects outside it. Pick the item that best fits the scene's beat (literal, metaphoric, or kinetic — whichever this batch calls for) and construct the prompt around it:`
    : `━━━ NICHE VISUAL LEXICON — INSPIRED (vertical: ${verticalNameRu}) ━━━\n` +
      `These curated items define the visual vocabulary, props, and settings of this niche. Use them as inspiration for every idea — you may invent new visuals in the same spirit and tone, but they must feel like they belong to this list. Avoid generic "oil and water / ice melting" filler that drifts away from the niche:`;
  return `\n${header}\n${items.map(s => `- ${s}`).join('\n')}\n`;
}

const BIROLY_CAT_FIXED_PHRASES = [
  'Use {option1|option2|option3|option4|option5} groups for variation.',
  'FIRST option in every group must closely match what is actually seen in the video',
  'Total groups: 8 to 10 (5 mandatory + 3 to 5 optional).',
  'MANDATORY GROUPS (always include all 5, in this order)',
  'OPTIONAL GROUPS (add 3 to 5 more, picked by topic of the biroly)',
  'Return ONLY valid JSON — no markdown, no code blocks, no extra text:',
  '{"prompt": "full prompt with {spintax} groups"',
];

function buildCategorySystemPrompt(name, description, taskAndInstructions) {
  const descLine = description ? `${description}\n\n` : '';
  return `You are an expert UGC content creator and prompt engineer specializing in biroly video hooks.

A biroly is a short (2–8 sec) video clip used as a hook in UGC content — a visually engaging action, experiment, or moment that grabs attention.

━━━ CATEGORY: ${name} ━━━
${descLine}${taskAndInstructions}

${BIROLY_SPINTAX_BLOCK}

━━━ EXISTING EXAMPLES — MATCH THIS STYLE EXACTLY ━━━
{{EXAMPLES}}

Slot context: "{{SLOT}}"

${BIROLY_RETURN_BLOCK}`;
}

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

// Extract frame at 0.5 s → save as JPEG thumbnail
function extractThumb(videoPath, thumbPath) {
  return new Promise(resolve => {
    const args = ['-ss', '0.5', '-i', videoPath, '-frames:v', '1', '-q:v', '3', '-y', thumbPath];
    execFile(ffmpegPath, args, { timeout: 15000 }, err => {
      resolve(!err && fs.existsSync(thumbPath));
    });
  });
}

// ── POST /api/hooks/upload — multipart; field "video" + text field "name" ────
router.post('/hooks/upload', upload.single('video'), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: 'Нет файла' });
  const { filename, path: filePath } = req.file;
  const rawName  = (req.body.name || '').trim();
  const safeName = rawName.replace(/[^a-zA-Zа-яА-ЯёЁ0-9_\- ]/g, '').trim()
    || path.basename(filename, path.extname(filename));

  const thumbFilename = path.basename(filename, path.extname(filename)) + '_thumb.jpg';
  const thumbAbsPath  = path.join(HOOKS_THUMB_DIR, thumbFilename);
  const thumbOk       = await extractThumb(filePath, thumbAbsPath);

  return res.json({
    success:   true,
    filename,
    name:      safeName,
    videoPath: `/hooks/${filename}`,
    thumbPath: thumbOk ? `/hooks/thumbs/${thumbFilename}` : null,
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

// ── POST /api/biroly/generate-category-prompt — generate AI system prompt for a category ──
// Body: { name, description?, markers? }
router.post('/biroly/generate-category-prompt', async (req, res) => {
  const { name = '', description = '', markers = '' } = req.body;
  if (!name.trim()) return res.status(400).json({ success: false, error: 'Нет названия категории' });

  const markersLine = markers.trim()
    ? `\n   - Naturally incorporate these markers/keywords where relevant: ${markers.trim()}`
    : '';

  const descLine = description.trim()
    ? `- Description: ${description.trim()}`
    : '(no additional description)';

  const aiPrompt = `You are a prompt engineer for UGC biroly video content analysis.

A biroly is a short (2–8 sec) video clip — a visually engaging action, experiment, or moment that grabs attention in UGC content.

Write a TASK section and an INSTRUCTIONS section for an AI video-frame analysis prompt tailored to the "${name.trim()}" category.

CATEGORY DETAILS:
- Name: ${name.trim()}
- ${descLine}${markers.trim() ? `\n- Preferred markers/keywords: ${markers.trim()}` : ''}

Requirements:
1. TASK: 1–2 sentences describing what the AI should do when analyzing a frame in this specific category
2. INSTRUCTIONS: numbered list of 7–9 specific analysis steps for the "${name.trim()}" category:
   - What visual elements to identify (subject, action, environment, lighting, camera angle, visual style)
   - What makes a strong "${name.trim()}" biroly vs generic content
   - What style and atmosphere variations make sense (realistic live-action only — no 3D/CGI/animation)
   - Relevant camera angle and composition variations for this content type
   - Mood and energy variations fitting for this category${markersLine}
   - Final step: slot context line (use the text: Slot context: "{{SLOT}}")

Return ONLY the two sections as plain text in this exact format:
TASK: [your 1–2 sentence task]

━━━ INSTRUCTIONS ━━━
1. ...
2. ...
...`;

  try {
    const raw = await callAI([{ role: 'user', content: aiPrompt }], { timeout: 40000, maxAttempts: 2, useOpenRouter: true, openRouterModel: HERMES });
    const taskAndInstructions = raw.trim();
    const systemPrompt = buildCategorySystemPrompt(name.trim(), description.trim(), taskAndInstructions);
    res.json({ success: true, systemPrompt, protectedPhrases: BIROLY_CAT_FIXED_PHRASES });
  } catch (err) {
    console.error('[biroly generate-category-prompt]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});


// ── POST /api/biroly/extract-mandatory ──────────────────────────────────────
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

// ── POST /api/biroly/ideas-from-scenario ─────────────────────────────────────
// Body: { scenarioFile, intensity?: 1-10, batch?: 1|2|3 }
// Reads the scenario from scenarios/<file>.txt (one scene per line) and asks
// Hermes 3 Llama (uncensored — needed for edgy material) to produce
// EXACTLY ONE b-roll idea per scene. The frontend calls this endpoint THREE
// times in parallel with different `batch` numbers (1/2/3) to get 3 visually
// distinct takes per scene without overloading a single LLM call.
//
// Each batch has its own creative angle so the three takes per scene differ:
//   batch 1 — LITERAL  (scene-direct, depicts what the line literally describes)
//   batch 2 — METAPHOR (abstract / atmospheric / object-driven symbol)
//   batch 3 — ENERGY   (motion-heavy, cinematic punch, dynamic camera)
//
// Output shape per idea:
//   { scene, lineText, title, prompt, intensity, category_hint, reusable, batch }
router.post('/biroly/ideas-from-scenario', async (req, res) => {
  const { scenarioFile, scenarioText: rawText, intensity, batch, metaphor, hints, vertical } = req.body || {};
  let scenarioText;
  if (rawText && String(rawText).trim()) {
    // Raw monologue text — used by sv2 Merge projects whose scenario isn't a .txt file.
    scenarioText = String(rawText).trim();
  } else {
    if (!scenarioFile) return res.status(400).json({ success: false, error: 'scenarioFile or scenarioText required' });
    const safe = path.basename(String(scenarioFile));
    if (!safe.endsWith('.txt')) return res.status(400).json({ success: false, error: 'expected .txt' });
    const fp = path.join(SCENARIOS_DIR, safe);
    if (!fs.existsSync(fp)) return res.status(404).json({ success: false, error: 'scenario not found' });
    try { scenarioText = fs.readFileSync(fp, 'utf8').trim(); }
    catch (e) { return res.status(500).json({ success: false, error: 'read failed: ' + e.message }); }
  }
  if (!scenarioText) return res.status(400).json({ success: false, error: 'scenario is empty' });

  const lines = scenarioText.split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) return res.status(400).json({ success: false, error: 'no usable lines' });

  const intensityNum = Math.max(1, Math.min(10, Number(intensity) || 6));
  const intensityLabel =
    intensityNum <= 3 ? 'CLEAN (museum-safe metaphors only)' :
    intensityNum <= 5 ? 'MILD (kitchen, hands, bottles, daily-life close-ups)' :
    intensityNum <= 7 ? 'EDGY (intimate-adjacent, nighttime, bathroom-silhouette, sweat, anxiety; never vulgar)' :
                        'HARD (heavy taboo-adjacent staging, bedroom silhouettes, mess metaphors — still NO nudity, NO sex, NO genitals, NO bodily fluids)';

  const batchNum = (batch === 2 || batch === 3) ? batch : 1;
  const batchAngle =
    batchNum === 1 ? 'LITERAL — depict what the line directly describes (the person, place, object, action stated in the script). Camera close to the subject, real environment, no abstract substitutions.' :
    batchNum === 2 ? 'METAPHORIC — abstract / atmospheric / object-driven symbol that REPRESENTS the emotional beat of the line without showing the literal subject. Use textures, surfaces, materials, light, weather, props as stand-ins.' :
                     'ENERGY — motion-heavy, cinematic, dynamic camera work. Whip pans, tracking shots, slow-mo bursts, fast handheld, focus pulls. The same line beat but pumped through kinetic visual rhythm.';

  // Lexicon injection — applies to ALL three batches. The user's niche
  // vocabulary should colour the whole response (literal, metaphoric, and
  // energetic shots alike all stay inside the vertical's visual world).
  const metaphorBlock = _buildMetaphorLexiconBlock(metaphor);

  const sys =
    `You are a visual director for a blackhat-affiliate UGC video ad. The scenario below is a short-form sales script (one scene per numbered line). ` +
    `Your job: for EACH line of the scenario, output EXACTLY ONE short b-roll clip idea (≤6 seconds, text-to-video) that visually punctuates that line.\n\n` +
    `CREATIVE ANGLE FOR THIS BATCH (${batchNum}/3): ${batchAngle}\n` +
    `Stay strictly within this angle for every idea you produce in this batch.\n` +
    metaphorBlock +
    `\nINTENSITY LEVEL: ${intensityNum}/10 — ${intensityLabel}\n\n` +
    `HARD RULES (NON-NEGOTIABLE):\n` +
    `- ≤6 seconds runtime. Phone-camera realism, 9:16 vertical, handheld feel.\n` +
    `- ALLOWED: silhouettes, shadows, close-ups of hands/face/profile, bottles, pills, food ingredients, kitchen, bathroom doors, bedrooms (dressed), beds (made), wallets, receipts, clocks, calendars, phone screens, nature metaphors (oil and water, ice melting), low-light atmosphere, sweat, anxious body language, slow-mo metaphors.\n` +
    `- FORBIDDEN: nudity, genitals, sex acts, explicit medical imagery, anatomical diagrams, real bodily fluids (urine, blood, semen, vomit), graphic violence, minors of any kind, anyone looking under 25, identifiable real brand logos.\n` +
    `- Must be filmable with REAL footage. No CGI, no cartoon, no diagram.\n` +
    `- Each idea is ONE coherent shot. No multi-cut montages within one idea.\n` +
    `- The PROMPT line is a single English t2v prompt, MAX 130 words, short and visually specific (camera, lens, angle, lighting, action). Sent directly to Grok text-to-video — every word must matter.\n` +
    `- Category is 2-3 lowercase words describing the bucket (kitchen ingredient, bathroom nighttime, pills metaphor, authority doctor, money receipt, intimate domestic).\n` +
    `- Reusable = yes if this clip would work across multiple scenarios in the same niche; no if it is tied to a specific line.\n\n` +
    `OUTPUT FORMAT — DELIMITED PLAIN TEXT (NO JSON, NO MARKDOWN, NO CODE FENCES):\n` +
    `For each idea, output a block in this EXACT shape, separated by a line of three equals signs (===):\n\n` +
    `SCENE: <line number 1-${lines.length}>\n` +
    `TITLE: <2-4 word slug, no quotes>\n` +
    `PROMPT: <single line, MAX 130 words, no line breaks, no quote characters inside>\n` +
    `CATEGORY: <2-3 lowercase words>\n` +
    `INTENSITY: <integer 1-10>\n` +
    `REUSABLE: <yes|no>\n` +
    `===\n\n` +
    `Produce EXACTLY ${lines.length} blocks — one per scene, in scene order. Do not use quotation marks anywhere; use single quotes or asterisks if you need emphasis.`;

  // Per-scene user directions (seed ideas the human typed in the popup before
  // generating). When present for a scene, the LLM must build that scene's idea
  // around the direction instead of inventing freely.
  const userHints = (hints && typeof hints === 'object') ? hints : {};
  const hintLines = lines.map((l, i) => {
    const h = (userHints[i + 1] != null) ? userHints[i + 1] : userHints[String(i + 1)];
    return (h && String(h).trim()) ? `Scene ${i + 1}: ${String(h).trim().slice(0, 300)}` : null;
  }).filter(Boolean);
  const hintsBlock = hintLines.length
    ? `\n\nUSER DIRECTIONS — for the scenes listed below the human supplied a specific idea/seed. Build that scene's b-roll idea AROUND the direction (honor its intent; refine it into a filmable t2v prompt that still fits this batch's angle and the rules). Scenes not listed: invent freely.\n` + hintLines.join('\n')
    : '';
  const userMsg =
    `SCENARIO (one scene per line, numbered):\n` +
    lines.map((l, i) => `${i + 1}. ${l}`).join('\n') +
    hintsBlock +
    `\n\nWrite the ${lines.length} delimited blocks now (batch ${batchNum}/3 — ${batchNum === 1 ? 'LITERAL' : batchNum === 2 ? 'METAPHORIC' : 'ENERGY'} angle).`;

  // Per-vertical augmentation (user-editable in the popup ⚙): the vertical's system
  // prompt + the active intensity-level prompt + few-shot from this vertical's saved
  // examples. Augments the built-in prompt (safety rules + format stay intact).
  let sysFinal = sys;
  const _vid = String(vertical || '').trim();
  if (_vid) {
    const vcfg = _loadVerticalConfig()[_vid];
    const lvlTag = intensityNum <= 3 ? 'CLEAN' : intensityNum <= 5 ? 'MILD' : intensityNum <= 7 ? 'EDGY' : 'HARD';
    if (vcfg) {
      if (vcfg.systemPrompt && String(vcfg.systemPrompt).trim()) {
        sysFinal += `\n\nVERTICAL DIRECTION (${vcfg.label || _vid}):\n` + String(vcfg.systemPrompt).trim();
      }
      const ip = vcfg.intensityPrompts && vcfg.intensityPrompts[lvlTag];
      if (ip && String(ip).trim()) {
        sysFinal += `\n\nINTENSITY DIRECTION (${lvlTag}):\n` + String(ip).trim();
      }
    }
    const exs = _loadIdeaExamples().filter(e => !e._marker && (e.vertical || 'general') === _vid).slice(0, 6);
    if (exs.length) {
      sysFinal += `\n\nSTYLE EXAMPLES for this niche — emulate the SPIRIT and visual style of these double-entendre b-roll ideas; do NOT copy verbatim, adapt to each scene:\n`
        + exs.map(e => '- ' + String(e.prompt || '').replace(/\s+/g, ' ').trim()).join('\n');
    }
  }

  try {
    const raw = await callAI(
      [
        { role: 'system', content: sysFinal },
        { role: 'user',   content: userMsg },
      ],
      {
        useOpenRouter:   true,
        openRouterModel: HERMES,
        timeout:         90000,
      }
    );
    // Parse the delimited-block plain-text format. Robust against quote drift,
    // trailing commas, and other JSON-fragility issues Hermes routinely
    // introduces when asked to produce long structured responses.
    const cleaned = String(raw || '')
      .replace(/```[\s\S]*?\n|\s*```/g, '')   // strip stray code fences
      .trim();
    // Split on === lines (with possible surrounding whitespace).
    const blocks = cleaned.split(/^\s*={3,}\s*$/m).map(b => b.trim()).filter(Boolean);
    if (!blocks.length) {
      return res.status(502).json({ success: false, error: 'LLM returned no blocks', raw: cleaned.slice(0, 400) });
    }
    const ideas = [];
    const _field = (text, name) => {
      const re = new RegExp(`^${name}\\s*:\\s*(.+?)\\s*$`, 'mi');
      const m = text.match(re);
      return m ? m[1].trim() : '';
    };
    for (const block of blocks) {
      // Skip blocks that don't look like a proper idea block (no PROMPT key).
      if (!/PROMPT\s*:/i.test(block)) continue;
      const sceneRaw    = _field(block, 'SCENE');
      const title       = _field(block, 'TITLE');
      const prompt      = _field(block, 'PROMPT');
      const category    = _field(block, 'CATEGORY');
      const intensityF  = _field(block, 'INTENSITY');
      const reusableRaw = _field(block, 'REUSABLE');
      if (!prompt || prompt.length < 20) continue;
      const scene = Math.max(1, Math.min(lines.length, parseInt(sceneRaw, 10) || ideas.length + 1));
      ideas.push({
        scene,
        lineText:      lines[scene - 1] || '',
        title:         (title || `Scene ${scene}`).slice(0, 60),
        prompt:        prompt.slice(0, 1500),
        intensity:     Math.max(1, Math.min(10, parseInt(intensityF, 10) || intensityNum)),
        category_hint: category.toLowerCase().slice(0, 40),
        reusable:      /^(yes|true|1)$/i.test(reusableRaw),
        batch:         batchNum,
      });
    }
    if (!ideas.length) {
      return res.status(502).json({ success: false, error: 'no usable blocks parsed', raw: cleaned.slice(0, 400) });
    }
    ideas.sort((a, b) => a.scene - b.scene);
    res.json({ success: true, ideas, sceneCount: lines.length, intensity: intensityNum, batch: batchNum });
  } catch (e) {
    console.error('[biroly/ideas-from-scenario]', e.message);
    res.status(502).json({ success: false, error: e.message });
  }
});

// ── Biroly idea examples — a per-vertical library of good b-roll idea prompts ──
const IDEA_EXAMPLES_FILE = path.join(DATA_DIR, 'biroly-idea-examples.json');
// Starter double-entendre examples for the male-enhancement vertical (English, t2v-ready).
const _ME_SEED = [
  'a plump sausage being slowly pushed into a soft open bun, extreme close-up, glistening',
  'a huge industrial pump rhythmically pumping thick golden oil, slow motion',
  'a beaver eagerly licking a glistening juicy oyster on the half-shell, macro',
  'rich cream being pumped into an eclair through the hole in its end until it swells, close-up',
  'timelapse of a cucumber rapidly growing longer and thicker on the vine',
  'a brass spyglass telescope extending and enlarging section by section',
  "a fire hydrant suddenly bursting with foamy water splashing onto a girl's delighted face, slow motion",
  'a parking barrier gate slowly rising up and appearing to grow larger, low angle',
];
function _loadIdeaExamples() {
  let list; try { list = JSON.parse(fs.readFileSync(IDEA_EXAMPLES_FILE, 'utf8')); } catch { list = []; }
  if (!Array.isArray(list)) list = [];
  // One-time seed of the male-enhancement starter set (marker prevents re-seed after deletes).
  if (!list.some(e => e && e._marker && e.seed === 'me_v1')) {
    const seeded = _ME_SEED.map((p, i) => ({
      id: 'ex_seed_me_' + i, vertical: 'male_enhancement',
      title: 'Innuendo ' + (i + 1), prompt: p, category: 'innuendo', intensity: 8,
      date: new Date(0).toISOString(),
    }));
    list = list.concat(seeded, [{ id: '__me_seed_marker', _marker: true, seed: 'me_v1' }]);
    try { fs.writeFileSync(IDEA_EXAMPLES_FILE, JSON.stringify(list, null, 2), 'utf8'); } catch {}
  }
  return list;
}
function _saveIdeaExamples(list) {
  try { fs.writeFileSync(IDEA_EXAMPLES_FILE, JSON.stringify(list, null, 2), 'utf8'); } catch {}
}
// GET /api/biroly/idea-examples?vertical=<id>  — filtered to a vertical (all if omitted)
router.get('/biroly/idea-examples', (req, res) => {
  const v = String(req.query.vertical || '').trim();
  let list = _loadIdeaExamples().filter(e => !e._marker);
  if (v) list = list.filter(e => (e.vertical || 'general') === v);
  res.json({ success: true, list });
});
// POST /api/biroly/idea-examples — save an interesting idea as a reusable example
router.post('/biroly/idea-examples', (req, res) => {
  const { title, prompt, category, intensity, vertical } = req.body || {};
  if (!prompt || !String(prompt).trim()) return res.status(400).json({ success: false, error: 'prompt required' });
  const list = _loadIdeaExamples();
  const id = 'ex_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  list.unshift({
    id,
    vertical:  String(vertical || 'general').slice(0, 60),
    title:     (title || 'Example').slice(0, 80),
    prompt:    String(prompt).slice(0, 1500),
    category:  String(category || '').slice(0, 40),
    intensity: parseInt(intensity, 10) || null,
    date:      new Date().toISOString(),
  });
  _saveIdeaExamples(list);
  res.json({ success: true, id, count: list.length });
});
// DELETE /api/biroly/idea-examples/:id
router.delete('/biroly/idea-examples/:id', (req, res) => {
  _saveIdeaExamples(_loadIdeaExamples().filter(e => e.id !== req.params.id));
  res.json({ success: true });
});

// ── Per-vertical generation config — system prompt + per-intensity prompts ────
const VERTICAL_CONFIG_FILE = path.join(DATA_DIR, 'biroly-vertical-config.json');
// Strong starter prompts for the male-enhancement vertical (seeded once if absent).
const _ME_VCFG = {
  label: 'home office',
  systemPrompt: 'You are a bold, witty creative director for male-enhancement (potency) short-form b-roll. For each line invent ONE fresh, surprising, cinematic single-shot visual that implies male virility / size / performance / confidence through PLAYFUL DOUBLE-ENTENDRE and object metaphor — never literal anatomy. Treat this niche\'s example ideas as INSPIRATION for tone and wit (do NOT copy them); push for clever, meme-worthy, scroll-stopping imagery. Real, filmable footage only.',
  intensityPrompts: {
    CLEAN: 'Keep the innuendo very subtle and tasteful — suggestive only on a second look; safe for any feed.',
    MILD:  'Light, cheeky innuendo — clearly playful object metaphors (a cucumber growing, a balloon inflating); nothing crude.',
    EDGY:  'Bold, obvious double-entendres (pumps gushing, hydrants bursting, a sausage into a bun) — confidently suggestive, still no explicit anatomy or acts.',
    HARD:  'Maximum cheeky innuendo — the most blatant, over-the-top suggestive object metaphors you can invent while staying inside the hard rules (no nudity, no sex acts, no genitals). Lean into the absurd and the meme-worthy.',
  },
};
function _loadVerticalConfig() {
  let o; try { o = JSON.parse(fs.readFileSync(VERTICAL_CONFIG_FILE, 'utf8')); } catch { o = {}; }
  if (!o || typeof o !== 'object') o = {};
  if (!o.male_enhancement) { o.male_enhancement = _ME_VCFG; try { fs.writeFileSync(VERTICAL_CONFIG_FILE, JSON.stringify(o, null, 2), 'utf8'); } catch {} }
  return o;
}
function _saveVerticalConfig(obj) {
  try { fs.writeFileSync(VERTICAL_CONFIG_FILE, JSON.stringify(obj, null, 2), 'utf8'); } catch {}
}
// GET /api/biroly/vertical-config?vertical=<id>
router.get('/biroly/vertical-config', (req, res) => {
  const v = String(req.query.vertical || '').trim();
  const all = _loadVerticalConfig();
  const config = (v && all[v]) ? all[v] : { label: '', systemPrompt: '', intensityPrompts: {} };
  res.json({ success: true, vertical: v, config });
});
// POST /api/biroly/vertical-config  { vertical, label?, systemPrompt?, intensityPrompts? }
router.post('/biroly/vertical-config', (req, res) => {
  const { vertical, label, systemPrompt, intensityPrompts } = req.body || {};
  const v = String(vertical || '').trim();
  if (!v) return res.status(400).json({ success: false, error: 'vertical required' });
  const ip = (intensityPrompts && typeof intensityPrompts === 'object') ? intensityPrompts : {};
  const all = _loadVerticalConfig();
  all[v] = {
    label:        String(label || '').slice(0, 80),
    systemPrompt: String(systemPrompt || '').slice(0, 4000),
    intensityPrompts: {
      CLEAN: String(ip.CLEAN || '').slice(0, 2000),
      MILD:  String(ip.MILD  || '').slice(0, 2000),
      EDGY:  String(ip.EDGY  || '').slice(0, 2000),
      HARD:  String(ip.HARD  || '').slice(0, 2000),
    },
  };
  _saveVerticalConfig(all);
  res.json({ success: true });
});

// ── POST /api/biroly/idea-remake ─────────────────────────────────────────────
// Body: { sceneText, currentPrompt, intensity?: 1-10 }
// Takes the user-edited prompt text from the popup textarea + the source
// scenario line, and asks Hermes to produce ONE alternative idea that pivots
// off the current one (different angle, same scene intent). Used by the
// per-idea Remake button.
//
// The output is the same SCENE/TITLE/PROMPT/CATEGORY/INTENSITY/REUSABLE block
// shape as /ideas-from-scenario, but only one block.
router.post('/biroly/idea-remake', async (req, res) => {
  const { sceneText = '', currentPrompt = '', intensity, metaphor } = req.body || {};
  const sceneTxt = String(sceneText).trim();
  const curPrompt = String(currentPrompt).trim();
  if (!sceneTxt) return res.status(400).json({ success: false, error: 'sceneText required' });
  if (curPrompt.length < 10) return res.status(400).json({ success: false, error: 'currentPrompt too short' });

  const intensityNum = Math.max(1, Math.min(10, Number(intensity) || 6));
  const intensityLabel =
    intensityNum <= 3 ? 'CLEAN (museum-safe metaphors only)' :
    intensityNum <= 5 ? 'MILD (kitchen, hands, bottles, daily-life close-ups)' :
    intensityNum <= 7 ? 'EDGY (intimate-adjacent, nighttime, bathroom-silhouette, sweat, anxiety; never vulgar)' :
                        'HARD (heavy taboo-adjacent staging, bedroom silhouettes, mess metaphors — still NO nudity, NO sex, NO genitals, NO bodily fluids)';

  // Frontend sends `metaphor` for every remake regardless of source batch —
  // remake should stay within the user's selected niche vocabulary too.
  const metaphorBlock = _buildMetaphorLexiconBlock(metaphor);

  const sys =
    `You are a visual director for a blackhat-affiliate UGC video ad. The user has an existing b-roll idea for a scene and wants ONE alternative — different angle / framing / metaphor — but matching the same scene intent.\n\n` +
    metaphorBlock +
    `\nINTENSITY LEVEL: ${intensityNum}/10 — ${intensityLabel}\n\n` +
    `HARD RULES (NON-NEGOTIABLE):\n` +
    `- ≤6 seconds runtime. Phone-camera realism, 9:16 vertical, handheld feel.\n` +
    `- ALLOWED: silhouettes, shadows, close-ups of hands/face/profile, bottles, pills, food ingredients, kitchen, bathroom doors, bedrooms (dressed), beds (made), wallets, receipts, clocks, calendars, phone screens, nature metaphors, low-light atmosphere, sweat, anxious body language, slow-mo metaphors.\n` +
    `- FORBIDDEN: nudity, genitals, sex acts, explicit medical imagery, anatomical diagrams, real bodily fluids, graphic violence, minors of any kind, anyone looking under 25, identifiable real brand logos.\n` +
    `- Filmable with REAL footage. No CGI, no cartoon, no diagram.\n` +
    `- ONE coherent shot. No multi-cut montages.\n` +
    `- PROMPT MAX 130 words. Short, visually specific.\n` +
    `- The new idea must MEANINGFULLY DIFFER from the current one — different framing, different metaphor, different camera angle, or different subject within the same intent. Do not return a near-duplicate.\n\n` +
    `OUTPUT FORMAT — DELIMITED PLAIN TEXT (NO JSON, NO MARKDOWN):\n` +
    `SCENE: 1\n` +
    `TITLE: <2-4 word slug>\n` +
    `PROMPT: <single line, MAX 130 words, no line breaks, no quotes>\n` +
    `CATEGORY: <2-3 lowercase words>\n` +
    `INTENSITY: <integer 1-10>\n` +
    `REUSABLE: <yes|no>\n\n` +
    `Do not use === separator (only one block). Do not use quotation marks anywhere.`;

  const userMsg =
    `SCENE TEXT:\n${sceneTxt}\n\n` +
    `CURRENT IDEA (the one to pivot from):\n${curPrompt}\n\n` +
    `Now write ONE alternative idea block.`;

  try {
    const raw = await callAI(
      [
        { role: 'system', content: sys },
        { role: 'user',   content: userMsg },
      ],
      {
        useOpenRouter:   true,
        openRouterModel: HERMES,
        timeout:         60000,
      }
    );
    const cleaned = String(raw || '').replace(/```[\s\S]*?\n|\s*```/g, '').trim();
    const _field = (text, name) => {
      const re = new RegExp(`^${name}\\s*:\\s*(.+?)\\s*$`, 'mi');
      const m = text.match(re);
      return m ? m[1].trim() : '';
    };
    const title       = _field(cleaned, 'TITLE');
    const prompt      = _field(cleaned, 'PROMPT');
    const category    = _field(cleaned, 'CATEGORY');
    const intensityF  = _field(cleaned, 'INTENSITY');
    const reusableRaw = _field(cleaned, 'REUSABLE');
    if (!prompt || prompt.length < 20) {
      return res.status(502).json({ success: false, error: 'no usable PROMPT in response', raw: cleaned.slice(0, 400) });
    }
    res.json({
      success: true,
      idea: {
        title:         (title || 'remade').slice(0, 60),
        prompt:        prompt.slice(0, 1500),
        intensity:     Math.max(1, Math.min(10, parseInt(intensityF, 10) || intensityNum)),
        category_hint: category.toLowerCase().slice(0, 40),
        reusable:      /^(yes|true|1)$/i.test(reusableRaw),
      },
    });
  } catch (e) {
    console.error('[biroly/idea-remake]', e.message);
    res.status(502).json({ success: false, error: e.message });
  }
});

// ── POST /api/biroly/idea-spintax-expand ─────────────────────────────────────
// Body: { prompt }
// Takes a single t2v prompt (the "raw" one from /ideas-from-scenario) and
// expands it with spintax groups so subsequent generations vary across the
// 5-mandatory + 3-5 optional dimensions defined in BIROLY_SPINTAX_BLOCK.
// Reuses the existing biroly spintax convention exactly. Runs on Hermes 4 like
// the rest of the biroly text pipeline.
router.post('/biroly/idea-spintax-expand', async (req, res) => {
  const { prompt } = req.body || {};
  const raw = String(prompt || '').trim();
  if (raw.length < 20) {
    return res.status(400).json({ success: false, error: 'prompt too short (min 20 chars)' });
  }

  const sys =
    `You take an existing English b-roll prompt and re-write it with spintax variation groups so each render produces a meaningfully different shot of the same scene.\n\n` +
    BIROLY_SPINTAX_BLOCK +
    `\n\nRULES:\n` +
    `- Preserve the core SUBJECT and ACTION of the original prompt exactly.\n` +
    `- Add 5 MANDATORY spintax groups (Camera & Optics, Angle & Shot Type, Camera Movement, Lighting & Atmosphere, Shot Scale) plus 3 to 5 OPTIONAL groups picked for this specific shot.\n` +
    `- Each group has exactly 5 alternatives, |-separated, grammatically interchangeable.\n` +
    `- FIRST option in every group must match the original prompt's intent — so the first render reproduces the original feeling closely.\n` +
    `- Primarily live-action realism. Light CGI overlays (text, motion graphics, subtle particle FX) and stylised colour grading are OK for emphasis, but the SUBJECT must remain photo-real. No cartoon, no animation, no fully 3D-rendered subject.\n\n` +
    `NUTRA-SPECIFIC OPTIONAL GROUPS (use any that fit the shot — these are common to potency / weight-loss / prostate / memory verticals):\n` +
    `- IngredientCloseup — pumpkin seeds, garlic clove, lemon, honey jar, baking soda, Vick VapoRub, fresh herbs, etc.\n` +
    `- PrescriptionBottle — orange amber bottle, white pharmacy label, scattered pills, blister pack, capsule jar.\n` +
    `- KitchenSurface — wooden cutting board, white marble counter, stainless steel bench, rustic stone slab, ceramic tile.\n` +
    `- BathroomMoment — fogged mirror, running shower water, medicine cabinet, towel rack, white porcelain sink.\n` +
    `- DiscreetGesture — hand sliding bottle into drawer, hidden behind kitchen tin, tucked into bathroom shelf, pocket transfer, casual pour into mug.\n` +
    `- AnxietyTell — hand at temple, fingers drumming, slow exhale, tired profile, pacing silhouette, sweat beading.\n` +
    `- HouseholdProp — kettle whistle, alarm clock 5am, calendar, receipts, wallet, phone screen, kitchen timer.\n` +
    `- BeforeAfterContrast — split-frame compositions, side-by-side textures, time-lapse mood shift.\n` +
    `- BodyLanguage — slumped vs upright, slow vs quick step, dim vs alert eyes, defeated vs energised posture.\n` +
    `Pick groups that meaningfully change THIS shot. Don't add a group just to hit a count.\n\n` +
    `OUTPUT FORMAT — DELIMITED PLAIN TEXT (NO JSON, NO MARKDOWN, NO CODE FENCES):\n` +
    `Return exactly two labelled lines separated by a line of three equals signs:\n\n` +
    `PROMPT: <single line — expanded English prompt with all inline {a|b|c|d|e} groups, no line breaks, no quote characters>\n` +
    `===\n` +
    `GROUPS: <comma-separated short English group names in the order they appear in the prompt>\n\n` +
    `Do not use quotation marks anywhere. Do not wrap output in any extra prose.\n\n` +
    `━━━ CRITICAL SYNTAX RULES — READ CAREFULLY ━━━\n` +
    `Each variation point in the PROMPT line MUST be written as a literal brace group with 5 pipe-separated options. NEVER write the group NAME alone — always EXPAND it inline.\n\n` +
    `GOOD OUTPUT EXAMPLE (correct spintax — exactly this shape):\n` +
    `PROMPT: An {extreme close-up|macro detail shot|tight detail framing|crisp close-up|sharp focus shot} of a {fresh garlic clove|peeled garlic bulb|whole raw garlic|cracked garlic head|sliced garlic clove} resting on a {wooden cutting board|white marble counter|stainless steel bench|rustic stone slab|ceramic tile surface}, captured with a {Sony A7S III with 35mm lens|Canon EOS R5 with 50mm lens|ARRI Alexa Mini with 24mm lens|RED Komodo with 85mm lens|iPhone 15 Pro main lens} in {soft natural daylight|warm golden hour|moody low-key with practicals|cool overcast diffused light|hard directional studio lighting}, shot from {eye-level|low angle|high angle|dutch angle|over-the-shoulder} with a {static handheld|slow dolly in|smooth tracking|gimbal walk-through|locked-off tripod} movement.\n` +
    `===\n` +
    `GROUPS: ShotScale, IngredientCloseup, KitchenSurface, CameraAndOptics, LightingAndAtmosphere, AngleAndShotType, CameraMovement\n\n` +
    `BAD OUTPUT EXAMPLE — DO NOT EVER DO THIS — INVALID, WILL BE REJECTED BY VALIDATOR:\n` +
    `PROMPT: A ShotScale of an IngredientCloseup on a KitchenSurface, captured with CameraAndOptics in LightingAndAtmosphere, shot from AngleAndShotType with CameraMovement.\n` +
    `(↑ This is broken: bare group names with NO braces and NO pipe-separated options. The PROMPT line must contain real {a|b|c|d|e} brace groups, NOT placeholder words.)\n\n` +
    `Every group name listed in GROUPS must correspond to a real {...|...|...|...|...} brace block in the PROMPT line. If you cannot expand a group inline, OMIT it from both lines.`;

  const userMsg = `ORIGINAL PROMPT:\n${raw}\n\nWrite the two-line delimited output now.`;

  try {
    const raw2 = await callAI(
      [
        { role: 'system', content: sys },
        { role: 'user',   content: userMsg },
      ],
      {
        useOpenRouter:   true,
        openRouterModel: HERMES,
        timeout:         45000,
      }
    );
    // Parse delimited plain-text format (NO JSON). Same approach as ideas-from-scenario:
    // strip stray code fences, then extract PROMPT and GROUPS by simple regex.
    const cleaned = String(raw2 || '')
      .replace(/```[\s\S]*?\n|\s*```/g, '')
      .trim();
    const _field = (text, name) => {
      const re = new RegExp(`^${name}\\s*:\\s*(.+?)\\s*$`, 'mi');
      const m = text.match(re);
      return m ? m[1].trim() : '';
    };
    const expandedPrompt = _field(cleaned, 'PROMPT');
    const groupsCsv      = _field(cleaned, 'GROUPS');
    if (!expandedPrompt || expandedPrompt.length < 20) {
      return res.status(502).json({ success: false, error: 'LLM did not return a usable PROMPT line', raw: cleaned.slice(0, 400) });
    }

    // ── Auto-fix: strip CamelCase group-name anchors from first option ───────
    // gemini-flash often puts the group name itself as the first option inside
    // a {} block, e.g. {ShotScale|extreme close-up|macro|tight|sharp focus}.
    // The first option is supposed to be a concrete visual, NOT the label.
    // We detect anchor-shaped tokens (PascalCase ≥2 chunks, or a known single
    // anchor word) and silently drop them so option #2 promotes to first.
    const ANCHOR_WORDS = new Set([
      'Location','Environment','Mood','Composition','Lighting','Atmosphere',
      'Setting','Wardrobe','Background','Action','Subject','Object','Surface',
      'Texture','Movement','Tempo','Grading','Scale','Angle','Frame','Time',
      'Camera','Optics','Lens','Light','Shot','Style',
    ]);
    const _looksLikeAnchor = s => {
      const t = String(s || '').trim();
      if (!t || t.length > 32) return false;
      if (/[\s\d\-_./]/.test(t)) return false;                // any space, digit, hyphen, underscore, slash, dot disqualifies
      if (/^([A-Z][a-z]+){2,}$/.test(t)) return true;         // PascalCase ≥2 chunks (ShotScale, CameraAndOptics)
      if (/^[A-Z][a-zA-Z]*$/.test(t) && ANCHOR_WORDS.has(t)) return true;  // single capitalized known anchor word
      return false;
    };
    let strippedCount = 0;
    const fixedPrompt = expandedPrompt.replace(/\{([^{}]+)\}/g, (_full, inside) => {
      const opts = inside.split('|').map(s => s.trim()).filter(Boolean);
      if (opts.length >= 2 && _looksLikeAnchor(opts[0])) {
        strippedCount++;
        return '{' + opts.slice(1).join('|') + '}';
      }
      return '{' + opts.join('|') + '}';
    });
    if (strippedCount) {
      console.log(`[idea-spintax-expand] stripped ${strippedCount} CamelCase anchor option(s) from first position`);
    }

    // ── Structural validation on the FIXED prompt ────────────────────────────
    // Still require ≥5 brace groups overall. Per-block option count is relaxed
    // to ≥3 (i.e. ≥2 pipes) since stripping an anchor can leave a 4-option
    // block, which is still perfectly usable spintax.
    const braceBlocks = fixedPrompt.match(/\{[^{}]*\}/g) || [];
    if (braceBlocks.length < 5) {
      return res.status(502).json({
        success: false,
        error: `LLM returned only ${braceBlocks.length} spintax brace group(s) — expected at least 5. Output looks malformed. Click Save again to retry.`,
        raw: fixedPrompt.slice(0, 400),
      });
    }
    const badBlocks = braceBlocks.filter(b => (b.match(/\|/g) || []).length < 2);
    if (badBlocks.length) {
      return res.status(502).json({
        success: false,
        error: `LLM returned ${badBlocks.length} spintax group(s) with fewer than 3 options. Each {} block must contain at least 3 alternatives. Click Save again to retry.`,
        raw: fixedPrompt.slice(0, 400),
        badBlocks: badBlocks.slice(0, 3),
      });
    }

    const groupNames = groupsCsv
      ? groupsCsv.split(',').map(s => s.trim()).filter(Boolean).slice(0, 14)
      : [];
    res.json({
      success:    true,
      prompt:     fixedPrompt,
      groupNames,
      stripped:   strippedCount,   // surfaces in dev/debug; frontend ignores
    });
  } catch (e) {
    console.error('[biroly/idea-spintax-expand]', e.message);
    res.status(502).json({ success: false, error: e.message });
  }
});

// ── POST /api/biroly/delete-video ────────────────────────────────────────────
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
