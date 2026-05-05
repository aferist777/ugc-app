'use strict';

const express      = require('express');
const path         = require('path');
const fs           = require('fs');
const { execFile } = require('child_process');
const ffmpegPath   = require('ffmpeg-static');
const multer       = require('multer');
const router       = express.Router();

const { HOOKS_DIR, HOOKS_THUMB_DIR } = require('../lib/config');
const { callAIBase64, callAI, callAIVideo } = require('../lib/helpers');

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
    const newPrompt = await callAI([{ role: 'user', content: aiPrompt }], { timeout: 60000, maxAttempts: 2, useOpenRouter: true });
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
    ], { timeout: 35000, maxAttempts: 2, useOpenRouter: true });
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
    const raw = await callAI([{ role: 'user', content: aiPrompt }], { timeout: 40000, maxAttempts: 2, useOpenRouter: true });
    const taskAndInstructions = raw.trim();
    const systemPrompt = buildCategorySystemPrompt(name.trim(), description.trim(), taskAndInstructions);
    res.json({ success: true, systemPrompt, protectedPhrases: BIROLY_CAT_FIXED_PHRASES });
  } catch (err) {
    console.error('[biroly generate-category-prompt]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/biroly/analyze-video — analyze video + generate spintax ────────
// Body: { videoBase64, videoMimeType, existingExamples, slotName, categorySystemPrompt? }
//       frameBase64 accepted for backward compat (treated as image/jpeg)
router.post('/biroly/analyze-video', async (req, res) => {
  const { videoBase64, videoMimeType, frameBase64, existingExamples = [], slotName = '', categorySystemPrompt = null } = req.body;
  const mediaBase64 = videoBase64 || frameBase64;
  const mediaMime   = videoBase64 ? (videoMimeType || 'video/mp4') : 'image/jpeg';
  const isVideo     = !!videoBase64;
  if (!mediaBase64) return res.status(400).json({ success: false, error: 'Нет данных для анализа' });

  const examplesBlock = existingExamples.length
    ? existingExamples.slice(0, 6).map((e, i) => {
        const names = (e.groupNames || []).join(', ');
        return `[Example ${i + 1}] prompt: "${e.prompt}"${names ? `\n  group names: ${names}` : ''}`;
      }).join('\n\n')
    : '(нет примеров — создай в стандартном стиле)';

  // The category's system-prompt field (cat.systemPrompt) is treated as
  // OPTIONAL CATEGORY CONTEXT and injected as a flavor block — it does NOT
  // replace the structural skeleton. The mandatory + optional spintax groups
  // from BIROLY_SPINTAX_BLOCK are always enforced regardless of what the user
  // wrote in the category prompt field.
  const categoryContextBlock = (categorySystemPrompt && categorySystemPrompt.trim())
    ? `━━━ CATEGORY CONTEXT (treat as additional guidance, but do NOT override the SPINTAX FORMAT rules below) ━━━\n${categorySystemPrompt.trim()}\n\n`
    : '';

  const prompt = `You are an expert UGC content creator and prompt engineer specializing in biroly video hooks.

A biroly is a short (2–8 sec) video clip used as a hook in UGC content — a visually engaging action, experiment, or moment that grabs attention.

${categoryContextBlock}TASK: Analyze the ${isVideo ? 'full video' : 'video frame'} and generate a prompt with spintax variations for recreating similar biroly content.
${isVideo ? 'Watch the entire video carefully — observe the action, motion, timing, subject behaviour, camera work, and atmosphere across all frames.' : ''}

${BIROLY_SPINTAX_BLOCK}

━━━ EXISTING BIROLY PROMPTS — MATCH THIS STYLE EXACTLY ━━━
${examplesBlock}

━━━ INSTRUCTIONS ━━━
1. Analyze the ${isVideo ? 'video fully' : 'frame'}: identify subject, action, motion, setting, props, lighting, camera angle, visual style.
2. Write a rich English prompt (2–4 sentences) for generating similar biroly images/videos.
3. Insert {spintax} groups following the SPINTAX FORMAT block above — 5 mandatory groups (Camera & Optics, Angle & Shot Type, Camera Movement, Lighting & Atmosphere, Shot Scale) plus 3 to 5 optional groups picked for THIS biroly's topic.
4. FIRST option in every spintax group must closely match what is actually seen in the video — use it to recreate the original as accurately as possible.
5. Subsequent options must NOT be synonyms or minor rewrites of the first. They should be tangentially related alternatives — same category of thing, but meaningfully different in visual result, context, or energy. Think: "same slot, different universe."
6. Keep all variations grounded in realistic, live-action style. Do NOT include 3D render, CGI, animation, cartoon, digital art, or any non-photorealistic style.
7. Name each group in English (short PascalCase or single noun).
8. The prompt must be production-ready for AI image/video generation (Kie.ai, Flux, Sora).
9. Slot context: "${slotName || 'biroly hook'}"

${BIROLY_RETURN_BLOCK}`;

  try {
    let raw;
    if (isVideo) {
      // Save video to temp file, extract 5 evenly-spaced frames with ffmpeg, send as multi-image
      const os  = require('os');
      const tmp = path.join(os.tmpdir(), `bv_${Date.now()}`);
      const vidPath = tmp + '.' + (mediaMime.split('/')[1] || 'mp4');
      fs.writeFileSync(vidPath, Buffer.from(mediaBase64, 'base64'));

      // Extract 5 frames: 1 at 5%, 25%, 50%, 75%, 95% of duration
      const frameBase64s = await new Promise((resolve, reject) => {
        // First get duration
        const { execFile: ef } = require('child_process');
        ef(ffmpegPath, ['-i', vidPath, '-f', 'null', '-'], (err, stdout, stderr) => {
          const durMatch = (stderr || '').match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
          const dur = durMatch
            ? parseInt(durMatch[1]) * 3600 + parseInt(durMatch[2]) * 60 + parseFloat(durMatch[3])
            : 5;
          const times = [0.05, 0.25, 0.5, 0.75, 0.95].map(p => Math.max(0, (dur * p)).toFixed(2));
          const frames = [];
          let done = 0;
          times.forEach((t, i) => {
            const fp = `${tmp}_f${i}.jpg`;
            ef(ffmpegPath, ['-ss', t, '-i', vidPath, '-frames:v', '1', '-q:v', '3', fp], () => {
              try { if (fs.existsSync(fp)) frames[i] = fs.readFileSync(fp).toString('base64'); } catch {}
              if (++done === times.length) resolve(frames.filter(Boolean));
            });
          });
        });
      });

      // Cleanup temp files
      try { fs.unlinkSync(vidPath); } catch {}
      for (let i = 0; i < 5; i++) { try { fs.unlinkSync(`${tmp}_f${i}.jpg`); } catch {} }

      if (!frameBase64s.length) throw new Error('Не удалось извлечь кадры из видео');
      console.log(`[analyze-video] extracted ${frameBase64s.length} frames`);
      raw = await callAIVideo(prompt, frameBase64s, { timeout: 90000, maxAttempts: 2, useOpenRouter: true });
    } else {
      raw = await callAIBase64(prompt, mediaBase64, 'image/jpeg', { timeout: 45000, maxAttempts: 2, useOpenRouter: true });
    }

    // ── Robust JSON extraction ─────────────────────────────────────────────────
    // 1. Strip markdown code fences if present
    let jsonStr = raw.replace(/^```(?:json)?\s*/m, '').replace(/```\s*$/m, '').trim();

    // 2. Extract outermost JSON object via brace-counting (handles extra text around it)
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

    // 3. Try direct parse
    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (parseErr) {
      // 4. Sanitize: fix unescaped control characters inside string values
      //    Walk char-by-char, replacing bare \n \r \t with their JSON escape sequences
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
        } else {
          fixed += c;
        }
      }
      try {
        parsed = JSON.parse(fixed);
      } catch (e2) {
        throw new Error(`Не удалось разобрать ответ AI (${parseErr.message}). Сырой ответ: ${raw.slice(0, 300)}`);
      }
    }

    if (!parsed.prompt) throw new Error('В ответе нет поля prompt');
    res.json({ success: true, prompt: parsed.prompt, groupNames: parsed.groupNames || [] });
  } catch (err) {
    console.error('[biroly analyze-video]', err.message);
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
    ], { timeout: 30000, maxAttempts: 2, useOpenRouter: true });
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
    ], { timeout: 30000, maxAttempts: 2, useOpenRouter: true });
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

module.exports = router;
