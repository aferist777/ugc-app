'use strict';

const express      = require('express');
const path         = require('path');
const fs           = require('fs');
const { execFile } = require('child_process');
const ffmpegPath   = require('ffmpeg-static');
const multer       = require('multer');
const router       = express.Router();

const { HOOKS_DIR, HOOKS_THUMB_DIR } = require('../lib/config');
const { callAIBase64, callAI }       = require('../lib/helpers');

// ── Fixed structural sections for biroly category prompts ────────────────────
const BIROLY_SPINTAX_BLOCK = `━━━ SPINTAX FORMAT ━━━
Use {option1|option2|option3} groups for variation.
• Each {group} = a point where the content varies on each generation
• Options separated by |, e.g.: {young woman|teenage boy|middle-aged man}
• Aim for 3–6 groups, each with 3–5 meaningful options
• Group names must be short Russian nouns (e.g. "Персонаж", "Действие", "Локация", "Детали", "Угол")
• FIRST option in every group must closely match what is seen in the video
• Keep all variations in realistic, live-action style (no 3D render, CGI, animation, or non-photorealistic style)`;

const BIROLY_RETURN_BLOCK = `━━━ RETURN FORMAT ━━━
Return ONLY valid JSON — no markdown, no code blocks, no extra text:
{"prompt": "full prompt with {spintax} groups", "groupNames": ["РусскоеНазвание1", "РусскоеНазвание2", ...]}`;

const BIROLY_CAT_FIXED_PHRASES = [
  'Use {option1|option2|option3} groups for variation.',
  'FIRST option in every group must closely match what is seen in the video',
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
    const raw = await callAI([{ role: 'user', content: aiPrompt }], { timeout: 40000, maxAttempts: 2 });
    const taskAndInstructions = raw.trim();
    const systemPrompt = buildCategorySystemPrompt(name.trim(), description.trim(), taskAndInstructions);
    res.json({ success: true, systemPrompt, protectedPhrases: BIROLY_CAT_FIXED_PHRASES });
  } catch (err) {
    console.error('[biroly generate-category-prompt]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/biroly/analyze-video — analyze video frame + generate spintax ──
// Body: { frameBase64, existingExamples: [{prompt, groupNames}], slotName, categorySystemPrompt? }
router.post('/biroly/analyze-video', async (req, res) => {
  const { frameBase64, existingExamples = [], slotName = '', categorySystemPrompt = null } = req.body;
  if (!frameBase64) return res.status(400).json({ success: false, error: 'Нет кадра для анализа' });

  const examplesBlock = existingExamples.length
    ? existingExamples.slice(0, 6).map((e, i) => {
        const names = (e.groupNames || []).join(', ');
        return `[Example ${i + 1}] prompt: "${e.prompt}"${names ? `\n  group names: ${names}` : ''}`;
      }).join('\n\n')
    : '(нет примеров — создай в стандартном стиле)';

  // If a category-specific system prompt is provided, use it with placeholder substitution
  let prompt;
  if (categorySystemPrompt && categorySystemPrompt.trim()) {
    prompt = categorySystemPrompt
      .replace('{{EXAMPLES}}', examplesBlock)
      .replace('{{SLOT}}', slotName || 'biroly hook');
  } else {
    prompt = `You are an expert UGC content creator and prompt engineer specializing in biroly video hooks.

A biroly is a short (2–8 sec) video clip used as a hook in UGC content — a visually engaging action, experiment, or moment that grabs attention.

TASK: Analyze the video frame and generate a prompt with spintax variations for recreating similar biroly content.

━━━ SPINTAX FORMAT ━━━
Use {option1|option2|option3} groups for variation.
• Each {group} = a point where the content varies on each generation
• Options separated by |, e.g.: {young woman|teenage boy|middle-aged man}
• Aim for 3–6 groups, each with 3–5 meaningful options
• Group names must be short Russian nouns (e.g. "Персонаж", "Действие", "Локация", "Детали", "Угол")

━━━ EXISTING BIROLY PROMPTS — MATCH THIS STYLE EXACTLY ━━━
${examplesBlock}

━━━ INSTRUCTIONS ━━━
1. Analyze the video frame: identify subject, action, setting, props, lighting, camera angle, visual style
2. Write a concise English prompt (1–3 sentences) for generating similar biroly images/videos
3. Insert {spintax} at every natural variation point (who, what, where, how, camera, mood)
4. FIRST option in every spintax group must closely match what is actually seen in the video — use it to recreate the original as accurately as possible. Subsequent options are creative variations.
5. Keep all variations grounded in realistic, live-action style. Do NOT include 3D render, CGI, animation, cartoon, digital art, or any non-photorealistic style — not in the first option, not in the variations.
6. Name each group in Russian
7. The prompt must be production-ready for AI image/video generation (Kie.ai, Flux, Sora)
8. Slot context: "${slotName || 'biroly hook'}"

━━━ RETURN FORMAT ━━━
Return ONLY valid JSON — no markdown, no code blocks, no extra text:
{"prompt": "full prompt with {spintax} groups", "groupNames": ["РусскоеНазвание1", "РусскоеНазвание2", ...]}`;
  }

  try {
    const raw = await callAIBase64(prompt, frameBase64, 'image/jpeg', { timeout: 45000, maxAttempts: 2 });

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

module.exports = router;
