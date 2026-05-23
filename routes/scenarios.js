'use strict';

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const axios   = require('axios');
const router  = express.Router();

const { SCENARIOS_DIR, SCENARIOS_ARCHIVE_DIR, DETAILS_DIR,
        CHARACTERS_DIR, LOOKBOOKS_DIR, ENVIRONMENTS_DIR, SCENES_DIR, TEMP_DIR, UPLOADS_DIR, OBRAZY_DIR,
      } = require('../lib/config');
const { createThumbnail, callAI, uploadToPublicHost,
        createNanoBananaProTextTask, createImagen4UltraTask, resolveTask, downloadImage, compressBelow9MB,
      } = require('../lib/helpers');
const { getPrompt } = require('../lib/prompts');

const ASSIGNMENTS_FILE       = path.join(SCENARIOS_DIR, '_assignments.json');
const DATA_DIR               = path.join(__dirname, '..', 'data');
const DETAILS_META_FILE      = path.join(DATA_DIR, 'details-meta.json');
const SCENARIOS_META_FILE    = path.join(DATA_DIR, 'scenarios-meta.json');

function loadScenariosMeta() {
  if (!fs.existsSync(SCENARIOS_META_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(SCENARIOS_META_FILE, 'utf8')); } catch { return {}; }
}
function saveScenariosMeta(meta) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SCENARIOS_META_FILE, JSON.stringify(meta, null, 2), 'utf8');
}

// Build a 1-sentence avatar motion clause for a given gender+emotion+style.
// One LLM call per scenario, result cached in scenarios-meta.json. Re-used by
// every per-scene avatar-prompt call as the `motionHint` so all scenes share a
// consistent narrator persona while still getting their own per-scene motion
// prompt from the existing per-scene LLM analysis.
async function buildScenarioMotionPrompt({ gender, emotion, style }) {
  const emo = _emotionsFor(gender).find(e => e.id === emotion);
  const sty = _stylesFor(gender).find(s => s.id === style);
  const emoDesc = emo ? `${emo.label.replace(/^\S+\s/, '')} — ${emo.desc}` : '';
  const styDesc = sty ? `${sty.label.replace(/^\S+\s/, '')} — ${sty.desc}` : '';

  const systemMsg =
    'You are crafting a 1-sentence MOTION CLAUSE for an AI talking-head avatar (e.g. Kling Avatar, p-video-avatar).\n' +
    'You receive the narrator GENDER, the dominant EMOTION, and the STYLE the video adopts.\n' +
    'OUTPUT RULES:\n' +
    '- Return ONLY the final motion clause text — single English sentence, ~15-25 words.\n' +
    '- Describe ONLY facial expression, posture, eye contact, head movement, pacing of delivery.\n' +
    '- Do NOT describe environment, hands grabbing objects, or walking — the per-scene analyzer adds those.\n' +
    '- Do NOT add quotation marks, markdown, preamble, or explanation.\n' +
    '- Use the gender to pick gender-consistent body language (e.g. masculine posture cues for men).\n' +
    '- Avoid generic "Natural speaking motion with subtle head movement" boilerplate — be specific.';
  const userMsg =
    `GENDER: ${gender === 'men' ? 'male' : 'female'}\n` +
    `EMOTION: ${emoDesc || emotion || '(none)'}\n` +
    `STYLE: ${styDesc || style || '(none)'}\n\n` +
    `Write the motion clause now.`;
  const text = await callAI(
    [{ role: 'system', content: systemMsg }, { role: 'user', content: userMsg }],
    {
      useOpenRouter:   true,
      openRouterModel: 'nousresearch/hermes-3-llama-3.1-70b',
      timeout:         25000,
    }
  );
  return String(text || '').replace(/```[\s\S]*?```/g, '').replace(/^["'`]+|["'`]+$/g, '').trim();
}

function loadAssignments() {
  if (!fs.existsSync(ASSIGNMENTS_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(ASSIGNMENTS_FILE, 'utf8')); } catch { return {}; }
}

function loadDetailsMeta() {
  if (!fs.existsSync(DETAILS_META_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(DETAILS_META_FILE, 'utf8')); } catch { return {}; }
}

function saveDetailsMeta(meta) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DETAILS_META_FILE, JSON.stringify(meta, null, 2), 'utf8');
}

// ── Details ───────────────────────────────────────────────────────────────────
router.post('/details/upload', async (req, res) => {
  const { imageBase64, imageUrl, name } = req.body;
  if (!imageBase64 && !imageUrl) return res.status(400).json({ success: false, error: 'Нет данных' });
  const safeName = (name || '').trim().replace(/[^a-zA-Zа-яА-ЯёЁ0-9_\- ]/g, '').trim() || `detail_${Date.now()}`;
  const filename = `${safeName}.jpg`;
  const destPath = path.join(DETAILS_DIR, filename);
  try {
    if (imageBase64) {
      fs.writeFileSync(destPath, Buffer.from(imageBase64, 'base64'));
    } else {
      const resp = await axios({ method: 'GET', url: imageUrl, responseType: 'arraybuffer', timeout: 15000 });
      fs.writeFileSync(destPath, Buffer.from(resp.data));
    }
    const tp = path.join(DETAILS_DIR, 'thumbs', filename);
    createThumbnail(destPath, tp).catch(e => console.warn('[thumb]', e.message));
    res.json({ success: true, filename, name: safeName });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
  }
});

router.get('/details', (_req, res) => {
  const meta = loadDetailsMeta();
  const files = fs.readdirSync(DETAILS_DIR)
    .filter(f => /\.(jpg|jpeg|png)$/i.test(f))
    .map(f => {
      const thumbName = f.replace(/\.[^.]+$/, '') + '.jpg';
      const tp = path.join(DETAILS_DIR, 'thumbs', thumbName);
      const m  = meta[f] || {};
      return {
        file:        f,
        name:        m.displayName || f.replace(/\.[^.]+$/, ''),
        size:        m.size        || '',
        description: m.description || '',
        path:        `/details/${f}`,
        thumbPath:   fs.existsSync(tp) ? `/details/thumbs/${thumbName}` : `/details/${f}`,
        mtime:       fs.statSync(path.join(DETAILS_DIR, f)).mtimeMs,
      };
    })
    .sort((a, b) => b.mtime - a.mtime);
  res.json({ success: true, files });
});

router.delete('/details/:filename', (req, res) => {
  const { filename } = req.params;
  const filePath = path.join(DETAILS_DIR, filename);
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    const thumbName = filename.replace(/\.[^.]+$/, '') + '.jpg';
    const thumbPath = path.join(DETAILS_DIR, 'thumbs', thumbName);
    if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
    const meta = loadDetailsMeta();
    delete meta[filename];
    saveDetailsMeta(meta);

    // Cascade: remove matching entries from refs.json
    try {
      const { REFS_FILE } = require('../lib/config');
      if (fs.existsSync(REFS_FILE)) {
        const refs = JSON.parse(fs.readFileSync(REFS_FILE, 'utf8'));
        const filtered = refs.filter(r => r.detailFile !== filename);
        if (filtered.length !== refs.length)
          fs.writeFileSync(REFS_FILE, JSON.stringify(filtered, null, 2), 'utf8');
      }
    } catch (e) { console.warn('[details/delete cascade]', e.message); }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.patch('/details/meta/:filename', (req, res) => {
  const { filename } = req.params;
  const { displayName, size, description } = req.body;
  const meta = loadDetailsMeta();
  if (!meta[filename]) meta[filename] = {};
  if (displayName  !== undefined) meta[filename].displayName  = displayName;
  if (size         !== undefined) meta[filename].size         = size;
  if (description  !== undefined) meta[filename].description  = description;
  saveDetailsMeta(meta);
  res.json({ success: true });
});

// ── Scenario assignments (must be before /:filename) ─────────────────────────
router.get('/scenarios/assignments', (_req, res) => {
  res.json({ success: true, assignments: loadAssignments() });
});

router.post('/scenarios/assignments', (req, res) => {
  const { assignments } = req.body;
  if (!assignments || typeof assignments !== 'object')
    return res.status(400).json({ success: false, error: 'Неверные данные' });
  fs.writeFileSync(ASSIGNMENTS_FILE, JSON.stringify(assignments, null, 2), 'utf8');
  res.json({ success: true });
});

// ── Rename scenario (renames file on disk, updates assignments keys) ──────────
router.patch('/scenarios/rename', (req, res) => {
  const { filename, newName } = req.body;
  if (!filename || !newName) return res.status(400).json({ success: false, error: 'Нет данных' });
  const safe = path.basename(filename);
  if (!safe.endsWith('.txt')) return res.status(400).json({ success: false, error: 'Неверный файл' });
  const src = path.join(SCENARIOS_DIR, safe);
  if (!fs.existsSync(src)) return res.status(404).json({ success: false, error: 'Не найден' });
  const safeName = newName.trim().replace(/[^a-zA-Zа-яА-ЯёЁ0-9_\- ]/g, '').trim();
  if (!safeName) return res.status(400).json({ success: false, error: 'Некорректное название' });
  let destName = `${safeName}.txt`;
  let dest = path.join(SCENARIOS_DIR, destName);
  if (path.resolve(dest) !== path.resolve(src) && fs.existsSync(dest)) {
    destName = `${safeName}_${Date.now()}.txt`;
    dest = path.join(SCENARIOS_DIR, destName);
  }
  fs.renameSync(src, dest);
  // Rekey assignments: replace all keys starting with old filename prefix
  try {
    const a = loadAssignments();
    const rekeyed = {};
    Object.entries(a).forEach(([k, v]) => {
      if (k.startsWith(safe + '__')) rekeyed[destName + '__' + k.slice(safe.length + 2)] = v;
      else rekeyed[k] = v;
    });
    fs.writeFileSync(ASSIGNMENTS_FILE, JSON.stringify(rekeyed, null, 2), 'utf8');
  } catch {}
  res.json({ success: true, filename: destName, name: safeName });
});

// ── Scenarios ─────────────────────────────────────────────────────────────────
router.post('/scenarios/upload', (req, res) => {
  const { textBase64, name } = req.body;
  if (!textBase64) return res.status(400).json({ success: false, error: 'Нет данных' });
  const text      = Buffer.from(textBase64, 'base64').toString('utf8');
  const safeName  = (name || '').trim().replace(/[^a-zA-Zа-яА-ЯёЁ0-9_\- ]/g, '').trim() || `Сценарий_${Date.now()}`;
  const filename  = `${safeName}.txt`;
  fs.writeFileSync(path.join(SCENARIOS_DIR, filename), text, 'utf8');
  res.json({ success: true, filename, name: safeName });
});

// Move scenario to archive (replaces hard-delete)
router.delete('/scenarios/delete', (req, res) => {
  const { filename } = req.body;
  if (!filename) return res.status(400).json({ success: false, error: 'Нет имени файла' });
  const safe = path.basename(filename);
  if (!safe.endsWith('.txt')) return res.status(400).json({ success: false, error: 'Неверный файл' });
  const src = path.join(SCENARIOS_DIR, safe);
  if (!fs.existsSync(src)) return res.status(404).json({ success: false, error: 'Не найден' });
  // Avoid overwriting existing archive entry — append timestamp if collision
  let destName = safe;
  let dest = path.join(SCENARIOS_ARCHIVE_DIR, destName);
  if (fs.existsSync(dest)) {
    destName = safe.replace(/\.txt$/, '') + '_' + Date.now() + '.txt';
    dest = path.join(SCENARIOS_ARCHIVE_DIR, destName);
  }
  fs.renameSync(src, dest);
  res.json({ success: true, archived: destName });
});

// List archived scenarios
router.get('/scenarios/archive', (_req, res) => {
  const files = fs.readdirSync(SCENARIOS_ARCHIVE_DIR)
    .filter(f => f.endsWith('.txt'))
    .map(f => ({ file: f, name: f.replace(/(_\d+)?\.txt$/, ''), mtime: fs.statSync(path.join(SCENARIOS_ARCHIVE_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  res.json({ success: true, files });
});

// Restore scenario from archive
router.post('/scenarios/restore', (req, res) => {
  const { filename } = req.body;
  if (!filename) return res.status(400).json({ success: false, error: 'Нет имени файла' });
  const safe = path.basename(filename);
  const src = path.join(SCENARIOS_ARCHIVE_DIR, safe);
  if (!fs.existsSync(src)) return res.status(404).json({ success: false, error: 'Не найден в архиве' });
  // Strip timestamp suffix added on conflict
  const origName = safe.replace(/_\d+\.txt$/, '.txt');
  let destName = origName;
  let dest = path.join(SCENARIOS_DIR, destName);
  if (fs.existsSync(dest)) {
    destName = origName.replace(/\.txt$/, '') + '_restored_' + Date.now() + '.txt';
    dest = path.join(SCENARIOS_DIR, destName);
  }
  fs.renameSync(src, dest);
  res.json({ success: true, restored: destName });
});

// Permanently delete from archive
router.delete('/scenarios/archive/purge', (req, res) => {
  const { filename } = req.body;
  if (!filename) return res.status(400).json({ success: false, error: 'Нет имени файла' });
  const safe = path.basename(filename);
  const fp = path.join(SCENARIOS_ARCHIVE_DIR, safe);
  if (!fs.existsSync(fp)) return res.status(404).json({ success: false, error: 'Не найден' });
  fs.unlinkSync(fp);
  res.json({ success: true });
});

router.get('/scenarios', (_req, res) => {
  const files = fs.readdirSync(SCENARIOS_DIR)
    .filter(f => f.endsWith('.txt') && f !== '_assignments.json')
    .map(f => ({ file: f, name: f.replace(/\.txt$/, ''), mtime: fs.statSync(path.join(SCENARIOS_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  res.json({ success: true, files });
});

router.get('/scenarios/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  if (!filename.endsWith('.txt')) return res.status(400).json({ success: false, error: 'Неверный файл' });
  const fp = path.join(SCENARIOS_DIR, filename);
  if (!fs.existsSync(fp)) return res.status(404).json({ success: false, error: 'Не найден' });
  const lines = fs.readFileSync(fp, 'utf8').split('\n').filter(l => l.trim());
  res.json({ success: true, lines });
});

// ── Analyze образ + asset interaction (Gemini → 3 variants) ──────────────────
// Must include /obrazy/ since character + pose-variation images live in
// per-obraz folders after the storage refactor.
function urlToFilePath(urlPath) {
  if (!urlPath) return null;
  const s = urlPath.split('?')[0];
  const map = [
    ['/characters/',   CHARACTERS_DIR],
    ['/lookbooks/',    LOOKBOOKS_DIR],
    ['/environments/', ENVIRONMENTS_DIR],
    ['/details/',      DETAILS_DIR],
    ['/scenes/',       SCENES_DIR],
    ['/temp_files/',   TEMP_DIR],
    ['/uploads/',      UPLOADS_DIR],
    ['/obrazy/',       OBRAZY_DIR],
  ];
  for (const [prefix, dir] of map) {
    if (s.startsWith(prefix)) return path.join(dir, s.slice(prefix.length));
  }
  return null;
}

router.post('/scenarios/analyze', async (req, res) => {
  const { activePath, assetPath, assetSize } = req.body;
  if (!activePath || !assetPath)
    return res.status(400).json({ success: false, error: 'Нет путей к изображениям' });

  const activeFile = urlToFilePath(activePath);
  const assetFile  = urlToFilePath(assetPath);
  if (!activeFile || !fs.existsSync(activeFile))
    return res.status(400).json({ success: false, error: 'Активное изображение не найдено' });
  if (!assetFile || !fs.existsSync(assetFile))
    return res.status(400).json({ success: false, error: 'Изображение предмета не найдено' });

  try {
    const [activeUrl, assetUrl] = await Promise.all([
      uploadToPublicHost(fs.readFileSync(activeFile)),
      uploadToPublicHost(fs.readFileSync(assetFile)),
    ]);

    const sizeClause   = (assetSize || '').trim() ? ` — real dimensions: ${assetSize.trim()} (use for accurate scale in each generated prompt; include the dimension figure in prompt text)` : '';
    const systemPrompt = getPrompt('SCENARIO_ANALYZE_PROMPT')
      .replace(/\{assetSizeClause\}/g, sizeClause);

    const rawText = await callAI([{
      role: 'user',
      content: [
        { type: 'text',      text: systemPrompt },
        { type: 'image_url', image_url: { url: activeUrl } },
        { type: 'image_url', image_url: { url: assetUrl  } },
      ],
    }], { timeout: 45000, useOpenRouter: true });
    console.log('[scenarios/analyze] rawText:', rawText.slice(0, 400));
    const match   = rawText.match(/\[[\s\S]*\]/);
    let variants  = [];
    if (match) {
      try { variants = JSON.parse(match[0]); } catch (e) { console.warn('[scenarios/analyze] JSON parse error:', e.message, '| raw match:', match[0].slice(0, 200)); }
    } else {
      console.warn('[scenarios/analyze] no JSON array found in rawText');
    }
    variants = variants.filter(v => v?.label && v?.prompt).slice(0, 3);
    console.log('[scenarios/analyze] variants count:', variants.length);
    if (!variants.length) throw new Error('Gemini не вернул варианты');

    res.json({ success: true, variants });
  } catch (err) {
    console.error('[scenarios/analyze]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// AI scenario generation
// Powered by OpenRouter. The frontend "🤖 Generate with AI" section in the
// New scenario popup calls these two endpoints:
//   GET  /api/scenarios/ai-options   — emotion + style catalogs (with the
//        sales-tinted descriptions that get spliced into the prompt).
//   POST /api/scenarios/ai-generate  — runs the model, returns text.
// ═════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// Gender-specific emotion + style catalogs.
// Items with the same `id` may appear in BOTH lists with reframed `desc` for
// the respective voice. Each list also has 5+ exclusive items unique to that
// gender's narrator persona.
// ═══════════════════════════════════════════════════════════════════════════

const AI_EMOTIONS_WOMEN = [
  { id: 'curiosity',    label: '🔍 Curiosity',        desc: 'Sparks instant "I need to know what\'s next" tension. Opening withholds the answer; viewer leans in within 1-2 seconds. Soft, intriguing tone — "wait, what is she doing?"' },
  { id: 'urgency',      label: '⚡ Urgency',          desc: 'FOMO with a personal angle — "every woman I know is already using this". Time pressure framed as a friendly nudge, not aggressive sales.' },
  { id: 'surprise',     label: '💥 Surprise / Shock', desc: 'Pattern interrupt. Counter-intuitive reveal: "I always thought X was the answer, turns out Y." Emotional whiplash leading to a satisfying explanation.' },
  { id: 'aspiration',   label: '✨ Aspiration',       desc: 'Sells the transformed self. Viewer sees the polished, confident, put-together version of herself. Quiet envy of the result — beauty, ease, mastery.' },
  { id: 'relatability', label: '🤝 Relatability',     desc: '"Oh, that\'s exactly me" moment. The everyday struggle (frizzy hair, dry skin, messy mornings) framed without judgment. Viewer feels seen.' },
  { id: 'excitement',   label: '🔥 Excitement',       desc: 'High-energy "you have to try this" hype. Contagious enthusiasm, want-to-share-with-girlfriends energy. Fast cuts, big reveals.' },
  { id: 'authority',    label: '🧠 Authority',        desc: 'Quiet expertise — "I\'ve been doing this for 10 years and here\'s what actually works". Calm confidence, data-backed but warmly delivered.' },
  { id: 'mystery',      label: '🌫️ Mystery',         desc: 'Withhold the final reveal. "Watch what happens at the end" framing. Viewer must watch through to see the transformation / before-and-after.' },
];

const AI_EMOTIONS_MEN = [
  // ── Shared with women, men-framed ──────────────────────────────────────────
  { id: 'curiosity',    label: '🔍 Curiosity',        desc: '"Wait, what is this thing?" Investigative angle — viewer sees something unusual and needs to know what it is and how it works. No emotional teasing, just a clear puzzle to solve.' },
  { id: 'urgency',      label: '⚡ Urgency',          desc: 'Limited supply, expiring deal, last batch — framed factually, not pleadingly. "This won\'t be around long" stated as a fact, viewer decides.' },
  { id: 'surprise',     label: '💥 Surprise / Shock', desc: 'Counter-intuitive reveal that breaks an assumption. "Everyone thinks X is the way — actually Y outperforms it." Numbers, comparisons, demo proof.' },
  { id: 'excitement',   label: '🔥 Excitement',       desc: 'Performance hype — "this thing absolutely rips". Energy comes from RESULTS, not from gushing. Quick, punchy, confident delivery.' },
  { id: 'authority',    label: '🧠 Authority',        desc: 'Direct expertise — "I\'ve worked with these for years, here\'s the truth". No softening, no caveats, statement-of-fact delivery. Viewer trusts because there\'s no hedging.' },
  // ── Men-exclusive (5) ──────────────────────────────────────────────────────
  { id: 'competitive_drive',  label: '🏆 Competitive drive',  desc: '"This beats my old setup." Comparison-and-upgrade energy. Viewer feels their current solution is suddenly outclassed and wants to win the upgrade.' },
  { id: 'pride_in_skill',     label: '🛠 Pride in skill',     desc: '"I figured this out myself." Self-reliance flex. Viewer respects the cleverness, wants the same independence — no dependency on experts.' },
  { id: 'confidence',         label: '💪 Confidence',         desc: 'Direct, unhedged certainty. "This works. Period." No "maybe", no "I think", no "in my opinion". Authoritative statement that leaves no room for doubt.' },
  { id: 'discovery_thrill',   label: '🚀 Discovery thrill',   desc: '"I didn\'t know this even existed until last month." Finding the underground / off-radar tool. Viewer wants to be the one who knows about it first.' },
  { id: 'problem_solver',     label: '🔧 Problem solver',     desc: '"Tired of this BS — here\'s the fix." Frustration named bluntly first, sharp clean resolution second. Viewer feels their daily annoyance is being addressed head-on.' },
];

const AI_STYLES_WOMEN = [
  { id: 'housewife',             label: '👩‍🍳 Советы домохозяйки',       desc: 'Casual, like chatting with a friend over coffee. Real kitchen / bathroom setting, warm light, problem-solving voice. "I tried this and it actually worked" framing.' },
  { id: 'tv_shopping',           label: '📺 Магазин на диване',          desc: 'Late-night infomercial energy. BIG promises, BEFORE/AFTER reveals, "BUT WAIT, THERE\'S MORE!" beats, bright studio lighting, exaggerated host enthusiasm.' },
  { id: 'tiktok_hook',           label: '📱 TikTok hook-bait',           desc: 'Mystery first frame, fast cuts every 0.5-1 sec, captions overlay, "I tried this and you won\'t believe..." opening. Energetic, urgent, attention-snapping.' },
  { id: 'expert_investigation',  label: '🔬 Эксперт-расследование',      desc: 'Investigative journalist tone with warm framing. "I tested 12 products so you don\'t have to — here\'s what works." B-roll, data overlays, confident voice.' },
  { id: 'lifehack',              label: '💡 Лайф-хак',                   desc: 'Quick 15-30 sec tip with a clever twist. Satisfying ASMR sounds. "Before you throw this away, watch this" — punchline reveal at the end.' },
  { id: 'story_mode',            label: '📖 Story-mode',                 desc: 'Personal anecdote. "I was struggling with X for years, then I tried this…" Vulnerable opening, transformation arc, sincere tone, eye-contact close-ups.' },
  { id: 'science_glamour',       label: '🧪 Science-glamour',            desc: 'Lab-aesthetic + beauty-shoot. Ingredient close-ups, gentle authority voice, "molecularly bonded" / "clinically proven" claims, clean white visuals.' },
];

const AI_STYLES_MEN = [
  // ── Shared with women, men-framed ──────────────────────────────────────────
  { id: 'tv_shopping',          label: '📺 Магазин на диване',         desc: 'Infomercial energy — but with a deadpan male host. BIG promises stated as facts. BEFORE/AFTER comparisons emphasized with measurements / data, not emotional reactions.' },
  { id: 'tiktok_hook',          label: '📱 TikTok hook-bait',          desc: 'Pattern-interrupt first frame, fast cuts, captions. Opening pivots on a concrete claim — "this $5 thing replaced my $300 tool" — not vague intrigue.' },
  { id: 'expert_investigation', label: '🔬 Expert investigation',      desc: '"I tested 8 of these — here\'s the only one that didn\'t fail." Investigative, slightly skeptical tone. Specs, comparison tables, measured verdict at the end.' },
  { id: 'lifehack',             label: '💡 Lifehack',                  desc: 'Quick 15-30 sec utility tip. "If you\'re still doing X, you\'re wasting your time — try this." Practical, no fluff, clean demo with visible result.' },
  { id: 'story_mode',           label: '📖 Story-mode',                desc: 'Personal anecdote. "Was stuck with X for two years until I found this." Brief setup, problem, fix. No excessive vulnerability — get to the resolution fast.' },
  // ── Men-exclusive (5) ──────────────────────────────────────────────────────
  { id: 'garage_tinkerer',      label: '🔩 Garage tinkerer',           desc: 'Workbench setting, tools visible, "let me show you something" energy. Hands-on demo, no marketing speak. Quiet competence — "this is how it actually works".' },
  { id: 'workplace_pro',        label: '👔 Workplace pro',             desc: '"In my 10 years working in X, this is the only one that holds up." Expert-from-the-field framing. Specific examples from real jobs. Zero fluff.' },
  { id: 'gym_bro',              label: '💪 Gym bro / results-mode',    desc: 'Performance-focused, slightly intense. "This actually works — here\'s the proof." No sugarcoating, metrics over feelings, gym/garage/range setting.' },
  { id: 'dad_review',           label: '📦 Dad review',                desc: 'Calm honest assessment. "Is it worth it?" framing. Camera-on-shelf shots, practical use cases. "I bought this for X — here\'s how it held up after six months."' },
  { id: 'tech_breakdown',       label: '⚙️ Tech breakdown',            desc: 'Disassembly aesthetic. "What\'s actually inside" energy. Specs, materials, how-it-works callouts. Satisfying engineering reveal — viewer learns something concrete.' },
];

function _emotionsFor(gender) { return gender === 'men' ? AI_EMOTIONS_MEN : AI_EMOTIONS_WOMEN; }
function _stylesFor(gender)   { return gender === 'men' ? AI_STYLES_MEN   : AI_STYLES_WOMEN;   }

// ═══════════════════════════════════════════════════════════════════════════
// Two parallel system prompts — one per narrator gender. Kept separate (not a
// branched single prompt) so each can evolve independently without bleeding
// into the other.
// ═══════════════════════════════════════════════════════════════════════════
const SYSTEM_PROMPT_WOMEN =
`You are a creative UGC video scenario writer for a FEMALE narrator/protagonist.

LANGUAGE RULES (NON-NEGOTIABLE):
- Output language is ENGLISH ONLY. Regardless of the input language (the user may type Russian or any other language in the brief), the final scenario MUST be entirely in English. Translate any non-English brief content into natural English when you use it.
- Do NOT mix Cyrillic or any other non-Latin script into the output.

FORMAT RULES (NON-NEGOTIABLE):
- One scene per line. Each line is a single visual cut / scene beat.
- NO blank lines between scenes — they MUST be consecutive lines.
- No numbering, no bullets, no dashes, no markdown — plain text lines only.

VOICE RULES (FEMALE NARRATOR):
- First-person from a woman's lived experience ("I tried…", "I found…", "I couldn't believe…")
- Warm, conversational, emotionally connected tone — like a friend sharing a discovery
- "Friend giving advice" framing, not expert-lecturing
- Comfortable with feelings, transformation language, before/after emotional arcs
- Sells the dream AND the connection — viewer feels seen and inspired
- OK to use beauty/lifestyle vocabulary (soft, glowy, weightless, dewy) where it fits
- Opens often with a relatable problem ("Tired of…" / "For years I struggled with…") before pivoting to the solution
- AVOID: technical-spec dumps, aggressive comparison hype, dismissive male-coded humor.`;

const SYSTEM_PROMPT_MEN =
`You are a creative UGC video scenario writer for a MALE narrator/protagonist.

LANGUAGE RULES (NON-NEGOTIABLE):
- Output language is ENGLISH ONLY. Regardless of the input language (the user may type Russian or any other language in the brief), the final scenario MUST be entirely in English. Translate any non-English brief content into natural English when you use it.
- Do NOT mix Cyrillic or any other non-Latin script into the output.

FORMAT RULES (NON-NEGOTIABLE):
- One scene per line. Each line is a single visual cut / scene beat.
- NO blank lines between scenes — they MUST be consecutive lines.
- No numbering, no bullets, no dashes, no markdown — plain text lines only.

VOICE RULES (MALE NARRATOR):
- First-person from a man's lived experience ("I tried…", "I figured this out…", "I switched to…")
- Direct, confident, functional tone — get to the point fast
- "Sharing what works" framing — no excessive enthusiasm, no apologetic softening
- Focus on RESULTS, FUNCTION, MECHANICS — what does it do, how does it work, why is it better
- Comfortable with specs, numbers, comparisons, durability claims
- Sells competence and capability — viewer feels like upgrading their setup / game
- Opens often with the punchline OR a problem stated bluntly ("Tired of putting up with X…", "10 years in the field and…"), not with warmup
- Light dry humor is OK; gushing emotional / beauty-vocabulary language is not
- AVOID: words like "dreamy/glowy/silky", excessive exclamation, "ohmygod" energy, hedging ("I guess", "maybe").`;

function _systemPromptFor(gender) {
  return gender === 'men' ? SYSTEM_PROMPT_MEN : SYSTEM_PROMPT_WOMEN;
}

router.get('/scenarios/ai/options', (req, res) => {
  const gender = (req.query.gender === 'men') ? 'men' : 'women';
  res.json({
    success: true,
    gender,
    emotions: _emotionsFor(gender),
    styles:   _stylesFor(gender),
  });
});

// Curated model list shown in the popup dropdown. Server doesn't enforce it —
// the frontend just renders these as the choices. Any OpenRouter slug works.
const AI_MODELS = [
  { id: 'nousresearch/hermes-3-llama-3.1-70b', label: 'Hermes 3 Llama 70B (uncensored, cheap)' },
  { id: 'cognitivecomputations/dolphin-3.0-mistral-24b', label: 'Dolphin 3.0 Mistral 24B (uncensored, cheapest)' },
  { id: 'anthropic/claude-sonnet-4.6',         label: 'Claude Sonnet 4.6 (best quality, moderated)' },
  { id: 'openai/gpt-4o',                       label: 'GPT-4o (balanced)' },
  { id: 'google/gemini-pro-1.5',               label: 'Gemini Pro 1.5 (cheap)' },
];

// Read example .txt files referenced by their basenames. Skips missing /
// bad-extension entries silently so a stale check from the UI doesn't 500
// the whole call.
function _readExampleScenarios(filenames) {
  const out = [];
  for (const f of (filenames || []).slice(0, 5)) {
    if (typeof f !== 'string') continue;
    const safe = path.basename(f);
    if (!safe.endsWith('.txt')) continue;
    const abs = path.join(SCENARIOS_DIR, safe);
    if (!fs.existsSync(abs)) continue;
    try {
      const content = fs.readFileSync(abs, 'utf8').trim();
      if (content) out.push({ name: safe.replace(/\.txt$/, ''), content });
    } catch {}
  }
  return out;
}

function _emotionDescFor(gender, id) { return _emotionsFor(gender).find(e => e.id === id); }
function _styleDescFor(gender, id)   { return _stylesFor(gender).find(s => s.id === id);   }

function _buildPrompt({ gender, structured, notes, examples, opMode, prevText }) {
  const blocks = [];

  // Gender-specific narrator persona + voice rules.
  blocks.push(_systemPromptFor(gender));
  blocks.push('Style examples — each line is ONE scene cut. Match the format, verbosity, tone, and structure of these examples. (Ignore the gender of the narrator in the examples themselves — adapt their structure to your gender persona above.)');

  examples.forEach((ex, i) => {
    blocks.push(`--- EXAMPLE ${i + 1} (${ex.name}) ---\n${ex.content}`);
  });

  const ctx = [];
  if (structured?.product)    ctx.push(`- Product / asset: ${structured.product}`);
  if (structured?.audience)   ctx.push(`- Target audience: ${structured.audience}`);
  if (structured?.emotion) {
    const e = _emotionDescFor(gender, structured.emotion);
    if (e) ctx.push(`- Core emotion / hook: ${e.label.replace(/^\S+\s/, '')} — ${e.desc}`);
  }
  if (structured?.style) {
    const s = _styleDescFor(gender, structured.style);
    if (s) ctx.push(`- Style: ${s.label.replace(/^\S+\s/, '')} — ${s.desc}`);
  }
  if (structured?.ingredients) {
    ctx.push(`- Must reference these specific items naturally in the scenes: ${structured.ingredients}`);
  }
  if (ctx.length) {
    blocks.push('CONTEXT FOR THE NEW SCENARIO (use whatever is relevant, ignore empty fields):\n' + ctx.join('\n'));
  }
  if (notes && notes.trim()) {
    blocks.push('Additional freeform notes from user:\n' + notes.trim());
  }

  // Mode-specific instructions
  if (opMode === 'tighten' && prevText) {
    blocks.push(`PREVIOUS DRAFT (you produced this earlier — make it ~30% shorter while keeping all key beats):\n${prevText}`);
  } else if (opMode === 'expand' && prevText) {
    blocks.push(`PREVIOUS DRAFT (you produced this earlier — add 2-3 more scenes that elaborate on the existing ones; keep all existing scenes):\n${prevText}`);
  } else if (opMode === 'regenerate') {
    blocks.push('Note: this is a regeneration request — produce a fresh distinct take, do not repeat the previous draft.');
  }

  blocks.push(
    'OUTPUT RULES:\n' +
    '- ONLY scenario text. No preamble, no explanation, no markdown headers, no quotes around the output.\n' +
    '- ENGLISH ONLY. Translate any non-English brief content into natural English when you use it. No Cyrillic in the output.\n' +
    '- One scene per line. Each line is exactly one scene/cut.\n' +
    '- NO blank lines between scenes — every line must be a scene, no separators.\n' +
    '- No numbering, no bullets, no leading dashes — plain text lines only.\n' +
    '- The OPENING line(s) MUST be a powerful hook in the same flavour as the opening lines of the provided examples — pattern-interrupt, instant attention grab, no warmup or throat-clearing.\n' +
    '- Match the AVERAGE scene count and AVERAGE per-scene length you see in the provided examples — derive these naturally by looking at them. Do not be wordier or sparser per scene than the examples.\n' +
    '- Match the tone implied by the chosen Style.\n' +
    '- If "Must reference these specific items" was provided, all of them must appear naturally in the scenes — not forced or listed, woven into the action.'
  );

  return blocks.join('\n\n');
}

// Post-process the LLM output: strip wrapping quotes/code-fences, collapse
// runs of blank lines (1 scene = 1 line, no blank separators), trim each line.
function _postprocessScenarioText(raw) {
  let txt = String(raw || '').trim();
  // Strip any wrapping code-fence (```...```) the model might have added.
  txt = txt.replace(/^```[a-zA-Z]*\s*/, '').replace(/\s*```$/, '');
  // Strip a wrapping pair of " or ' if the whole thing is quoted.
  if (/^["']/.test(txt) && /["']$/.test(txt)) txt = txt.slice(1, -1).trim();
  // Collapse 2+ consecutive newlines (with possible whitespace) into a single newline.
  txt = txt.replace(/\n\s*\n+/g, '\n');
  // Per-line trim + drop empties.
  txt = txt.split('\n').map(l => l.trim()).filter(Boolean).join('\n');
  return txt;
}

router.post('/scenarios/ai/generate', async (req, res) => {
  try {
    const {
      structured = {},
      notes = '',
      exampleFiles = [],
      model = 'nousresearch/hermes-3-llama-3.1-70b',
      opMode = 'fresh',
      prevText = '',
      gender: genderRaw = 'women',
    } = req.body || {};

    const gender = (genderRaw === 'men') ? 'men' : 'women';

    if (!Array.isArray(exampleFiles) || exampleFiles.length < 2) {
      return res.status(400).json({ success: false, error: 'Need at least 2 example scenarios to anchor the style' });
    }

    const examples = _readExampleScenarios(exampleFiles);
    if (examples.length < 2) {
      return res.status(400).json({ success: false, error: 'Selected example files not found on disk' });
    }

    // Stats returned to UI (informational — NOT passed into the prompt;
    // the model derives length from the examples themselves).
    const sceneCounts = examples.map(e => e.content.split(/\r?\n/).filter(l => l.trim()).length);
    const totalChars  = examples.map(e => e.content.length);
    const avgScenes      = Math.round(sceneCounts.reduce((a, b) => a + b, 0) / sceneCounts.length);
    const avgTotalChars  = Math.round(totalChars.reduce((a, b) => a + b, 0) / totalChars.length);

    const prompt = _buildPrompt({ gender, structured, notes, examples, opMode, prevText });

    // Tiny system message — full persona/rules live inside the user-message
    // prompt body so they sit right next to the examples and brief.
    const sysMsg = (gender === 'men')
      ? 'You output scenario text only — no preamble, no markdown, no quoting. The narrator is MALE; obey the voice rules in the brief.'
      : 'You output scenario text only — no preamble, no markdown, no quoting. The narrator is FEMALE; obey the voice rules in the brief.';

    const messages = [
      { role: 'system', content: sysMsg },
      { role: 'user',   content: prompt },
    ];

    const text = await callAI(messages, {
      useOpenRouter:   true,
      openRouterModel: model,
      timeout:         60000,
    });

    if (!text || !text.trim()) {
      return res.status(502).json({ success: false, error: 'Empty response from model' });
    }

    // 1 scene = 1 line, no blanks. Post-process locks this even if model
    // ignored the rule.
    const cleaned = _postprocessScenarioText(text);

    res.json({
      success: true,
      text: cleaned,
      meta: { avgScenes, avgTotalChars, modelUsed: model, exampleCount: examples.length, gender },
    });
  } catch (err) {
    console.error('[scenarios/ai-generate]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// Props (details) AI generation
//   POST /api/details/extract-items-from-scenario
//   POST /api/details/ai/generate
// Used by the "New prop" popup's "🤖 Generate with AI" section to (1) extract
// up to 7 prop items from a chosen scenario .txt and (2) generate each item
// image on a clean white background via Replicate (nano-banana-2 with
// image_search=true by default, or imagen-4-ultra as alternative).
// ═════════════════════════════════════════════════════════════════════════════

router.post('/details/extract-items-from-scenario', async (req, res) => {
  try {
    const { filename } = req.body || {};
    if (!filename) return res.status(400).json({ success: false, error: 'Нет filename' });
    const safe = path.basename(filename);
    if (!safe.endsWith('.txt')) return res.status(400).json({ success: false, error: 'Неверный файл' });
    const fp = path.join(SCENARIOS_DIR, safe);
    if (!fs.existsSync(fp)) return res.status(404).json({ success: false, error: 'Сценарий не найден' });

    const scenarioText = fs.readFileSync(fp, 'utf8').trim();
    if (!scenarioText) return res.status(400).json({ success: false, error: 'Сценарий пуст' });

    const systemMsg =
      'You extract a prop/shopping list from a UGC video scenario.\n' +
      'Return STRICT JSON only — no markdown, no commentary, no explanation, no preamble.\n' +
      'Schema: a JSON array of 3 to 5 objects (NEVER more than 5, NEVER fewer than 3) with this exact shape:\n' +
      '  { "name": string, "hint": string }\n' +
      '- `name` MUST be in ENGLISH, STRICTLY ONE WORD, nominative singular, no articles, no punctuation, no hyphens, no compound multi-word phrases.\n' +
      '   Good: "cream", "jar", "oil", "cucumber", "honey", "spoon", "bottle".\n' +
      '   Bad:  "hand cream" (two words), "the jar" (article + two words), "linseed-oil" (hyphen), "cream!" (punctuation).\n' +
      '   If a prop has no good single-word name, pick the most specific single noun (e.g. "linseed oil" → "oil"). The user will add the rest in a separate field.\n' +
      '- `hint` MUST be in ENGLISH, max ~6 words, describing the qualifier the user might want — material, brand, color, container, type — so they can edit it further.\n' +
      '   Good: "linseed, glass bottle", "ceramic beige minimalist", "fresh green whole".\n' +
      'Extract ONLY items explicitly mentioned in the scenario text. Do NOT invent. Pick the 3-5 most visually prominent props the camera would show.';

    const userMsg = `SCENARIO TEXT:\n${scenarioText}\n\nReturn the JSON array now.`;

    const raw = await callAI(
      [
        { role: 'system', content: systemMsg },
        { role: 'user',   content: userMsg },
      ],
      {
        useOpenRouter:   true,
        openRouterModel: 'nousresearch/hermes-3-llama-3.1-70b',
        timeout:         45000,
      }
    );

    // Strip code-fences if the model added them despite instructions, then
    // grab the first [...] block.
    const cleaned = String(raw || '').replace(/```(?:json)?\s*|\s*```/g, '').trim();
    const match   = cleaned.match(/\[[\s\S]*\]/);
    let items = [];
    if (match) {
      try { items = JSON.parse(match[0]); } catch (e) { console.warn('[extract-items] JSON parse error:', e.message, '| raw:', match[0].slice(0, 200)); }
    }
    // Defensive normalization: keep ONLY the first word, strip punctuation/
    // hyphens, lowercase. The user adds the rest in the editable details field.
    // Cap at 5 items overall.
    const _trimName = (s) => {
      const cleaned = String(s)
        .replace(/[«»"„""''!.,;:?\-_/\\]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
      return cleaned.split(' ')[0] || '';
    };
    items = (Array.isArray(items) ? items : [])
      .filter(it => it && typeof it.name === 'string' && it.name.trim())
      .slice(0, 5)
      .map(it => ({
        name: _trimName(it.name),
        hint: String(it.hint || '').trim(),
      }))
      .filter(it => it.name);

    if (!items.length) {
      return res.status(502).json({ success: false, error: 'Модель не вернула список предметов' });
    }
    res.json({ success: true, items });
  } catch (err) {
    console.error('[details/extract-items]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// ── Beautify pass for prop generation ────────────────────────────────────────
// Sends {itemName, extras} to an uncensored OpenRouter model with strict
// system rules about the white-background product shot. The LLM returns a
// single English image-generation prompt which then goes to Replicate.
//
// IMPORTANT: the LLM is instructed to use ONLY the user's input (name +
// extras). It must NOT add details the user did not provide. This fixes the
// bug where the original analyzer hint ("sliced") leaked back in after the
// user cleared it from the editable text field.
const _PROP_BEAUTIFY_SYSTEM =
  'You craft a single English image-generation prompt for a product photo.\n' +
  'You receive: an ITEM name and optional DETAILS from the user.\n' +
  'OUTPUT RULES:\n' +
  '- Return ONLY the final prompt — no quotes, no preamble, no markdown, no explanations.\n' +
  '- Single paragraph, ~50-80 words.\n' +
  '- ALWAYS include these scene rules verbatim in spirit: pure white seamless background; professional product photography; soft diffused studio lighting; centered composition; sharp focus; no props, no hands, no people, no logos, no text, no decorative elements; minimal contact shadow only (no harsh shadow projection on background); photo-realistic, high detail, commercial-grade; 1:1 square framing.\n' +
  '- Use ONLY the information the user gave you. Do NOT invent extra adjectives, materials, colors, brands, or states (e.g. do not add "sliced", "open", "new" unless the user wrote it).\n' +
  '- If the user did not provide DETAILS, generate a generic clean version of the item.';

async function _beautifyPropPrompt(itemName, extras) {
  const userMsg =
    `ITEM: ${itemName}\n` +
    `DETAILS: ${(extras || '').trim() || '(none — generic clean version)'}\n\n` +
    `Write the prompt now.`;
  const text = await callAI(
    [
      { role: 'system', content: _PROP_BEAUTIFY_SYSTEM },
      { role: 'user',   content: userMsg },
    ],
    {
      useOpenRouter:   true,
      openRouterModel: 'nousresearch/hermes-3-llama-3.1-70b',
      timeout:         30000,
    }
  );
  // Strip surrounding quotes/markdown if the model added them.
  return String(text || '').replace(/```[\s\S]*?```/g, '').replace(/^["'`]+|["'`]+$/g, '').trim();
}

// ── Staging vs commit ────────────────────────────────────────────────────────
// Generated prop images first go to UPLOADS_DIR with a `staged_prop_` prefix.
// The popup shows them as thumbnails; double-click on a thumb hits
// /details/ai/discard-staged to unlink the file from disk. On Save the popup
// hits /details/ai/commit which moves all remaining staged files into
// DETAILS_DIR with their analysis names + writes meta entries.

const STAGED_PROP_PREFIX = 'staged_prop_';

function _safeBaseName(name) {
  return String(name || '')
    .replace(/[^a-zA-Zа-яА-ЯёЁ0-9_\- ]/g, '')
    .trim()
    .slice(0, 60) || `prop_${Date.now()}`;
}

router.post('/details/ai/generate', async (req, res) => {
  try {
    const { itemName, extras = '', engine: engineRaw = 'nano-banana-2' } = req.body || {};
    if (!itemName || !itemName.trim()) {
      return res.status(400).json({ success: false, error: 'Нет itemName' });
    }
    const engine = (engineRaw === 'imagen-4-ultra') ? 'imagen-4-ultra' : 'nano-banana-2';

    // ── Step 1: beautify (LLM crafts the final image-gen prompt) ──────────────
    let prompt;
    try {
      prompt = await _beautifyPropPrompt(itemName.trim(), extras);
      if (!prompt) throw new Error('beautify returned empty');
    } catch (e) {
      console.warn('[details/ai/generate] beautify failed, falling back to bare template:', e.message);
      // Fallback prompt if LLM beautify fails — bare, no inferred extras.
      const subject = extras && extras.trim() ? `${itemName.trim()}, ${extras.trim()}` : itemName.trim();
      prompt =
        `A single ${subject}, photographed in isolation on a pure white seamless background. ` +
        `Professional product photography, soft diffused studio lighting, centered composition, ` +
        `sharp focus. No props, no hands, no people, no logos, no text, no decorative elements. ` +
        `Minimal contact shadow only. Photo-realistic, high detail, 1:1 square framing.`;
    }
    console.log('[details/ai/generate] beautified prompt:', prompt.slice(0, 200));

    // ── Step 2: submit to Replicate ───────────────────────────────────────────
    let taskId;
    if (engine === 'imagen-4-ultra') {
      taskId = await createImagen4UltraTask(prompt, '1:1', {});
    } else {
      // nano-banana-2 with image_search hard-coded ON — Google Image Search
      // grounding produces a much better reference for real-world products.
      taskId = await createNanoBananaProTextTask(prompt, '1:1', { image_search: true });
    }
    if (!taskId) return res.status(502).json({ success: false, error: 'Replicate не вернул taskId' });

    // ── Step 3: poll until done (cap 90s) ─────────────────────────────────────
    const pollUntil = Date.now() + 90_000;
    let result = null;
    while (Date.now() < pollUntil) {
      result = await resolveTask(taskId, UPLOADS_DIR, STAGED_PROP_PREFIX.slice(0, -1));
      if (result.state === 'success' || result.state === 'failed') break;
      await new Promise(r => setTimeout(r, 2500));
    }
    if (!result || result.state !== 'success') {
      return res.status(502).json({ success: false, error: result?.error || 'Replicate timeout' });
    }

    const stagedAbs = path.join(__dirname, '..', result.imagePath.replace(/^\//, ''));
    const stagedName = path.basename(stagedAbs);
    res.json({
      success:    true,
      stagedFile: stagedName,
      imagePath:  `/uploads/${stagedName}`,
      thumbPath:  `/uploads/thumbs/${stagedName}`,
      name:       itemName.trim(),
      extras,
      engine,
      prompt,    // for debugging — frontend can ignore
    });
  } catch (err) {
    console.error('[details/ai/generate]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// ── POST /api/details/ai/discard-staged ──────────────────────────────────────
// Body: { stagedFile } — basename of a file in UPLOADS_DIR with the
// `staged_prop_` prefix. Unlinks file + thumb. Returns 200 even if missing.
router.post('/details/ai/discard-staged', (req, res) => {
  try {
    const stagedFile = String(req.body?.stagedFile || '');
    if (!stagedFile.startsWith(STAGED_PROP_PREFIX)) {
      return res.status(400).json({ success: false, error: 'invalid staged filename' });
    }
    const abs = path.join(UPLOADS_DIR, path.basename(stagedFile));
    if (fs.existsSync(abs)) { try { fs.unlinkSync(abs); } catch {} }
    const thumb = path.join(UPLOADS_DIR, 'thumbs', path.basename(stagedFile));
    if (fs.existsSync(thumb)) { try { fs.unlinkSync(thumb); } catch {} }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/details/ai/commit ──────────────────────────────────────────────
// Body: { items: [{stagedFile, name, hint?, extras?, engine?}] }
// Moves each staged file from UPLOADS_DIR into DETAILS_DIR under a safe name
// derived ONLY from `name` (the analysis name — user-typed `extras` do NOT
// affect the filename). Writes meta. Returns the saved item list so the
// popup can refresh.
router.post('/details/ai/commit', async (req, res) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) return res.status(400).json({ success: false, error: 'нет items' });

    const meta  = loadDetailsMeta();
    const saved = [];

    for (const it of items) {
      const stagedFile = String(it?.stagedFile || '');
      const name       = String(it?.name || '').trim();
      if (!stagedFile.startsWith(STAGED_PROP_PREFIX) || !name) continue;
      const stagedAbs = path.join(UPLOADS_DIR, path.basename(stagedFile));
      if (!fs.existsSync(stagedAbs)) continue;

      const safe = _safeBaseName(name);
      let destName = `${safe}.jpg`;
      let destAbs  = path.join(DETAILS_DIR, destName);
      if (fs.existsSync(destAbs)) {
        destName = `${safe}_${Date.now()}.jpg`;
        destAbs  = path.join(DETAILS_DIR, destName);
      }
      try { fs.renameSync(stagedAbs, destAbs); }
      catch { fs.copyFileSync(stagedAbs, destAbs); try { fs.unlinkSync(stagedAbs); } catch {} }

      // Move/create thumb in DETAILS_DIR/thumbs/.
      const stagedThumb = path.join(UPLOADS_DIR, 'thumbs', path.basename(stagedFile));
      const destThumb   = path.join(DETAILS_DIR, 'thumbs', destName);
      try {
        if (!fs.existsSync(path.dirname(destThumb))) fs.mkdirSync(path.dirname(destThumb), { recursive: true });
        if (fs.existsSync(stagedThumb)) {
          try { fs.renameSync(stagedThumb, destThumb); } catch {}
        }
        if (!fs.existsSync(destThumb)) await createThumbnail(destAbs, destThumb);
      } catch (e) { console.warn('[details/ai/commit thumb]', e.message); }

      // Meta: displayName = original analysis name (extras are NOT saved into
      // the filename; they live in description so the user can see what was
      // used as generation context).
      const description = String(it.extras || '').trim();
      meta[destName] = {
        displayName: name,
        size:        '',
        description: description || `Generated via ${it.engine || 'replicate'}`,
      };
      saved.push({ filename: destName, name, imagePath: `/details/${destName}`, thumbPath: `/details/thumbs/${destName}` });
    }

    saveDetailsMeta(meta);
    res.json({ success: true, savedCount: saved.length, items: saved });
  } catch (err) {
    console.error('[details/ai/commit]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// Scenarios meta (gender + emotion + style + motionPrompt) per filename.
//   POST /api/scenarios/ai/save-with-meta — used by scenario-ai.js when the
//     user clicks Save on an AI-generated scenario; writes the .txt AND the
//     meta entry with an LLM-built motionPrompt.
//   GET  /api/scenarios/meta/:filename — fetched by edit-tab when a session
//     loads, to pull motionPrompt for avatar prompts.
//   PATCH /api/scenarios/meta/:filename — user override of motionPrompt from
//     the gen-settings popup; persists and skips re-generation.
// ═════════════════════════════════════════════════════════════════════════════

router.post('/scenarios/ai/save-with-meta', async (req, res) => {
  try {
    const {
      textBase64, name, product = '',
      gender: genderRaw = 'women',
      emotion = '', style = '', model = '',
    } = req.body || {};
    if (!textBase64) return res.status(400).json({ success: false, error: 'Нет данных' });
    const gender = (genderRaw === 'men') ? 'men' : 'women';

    const text     = Buffer.from(textBase64, 'base64').toString('utf8');
    // Run the same post-process as /generate — guarantees the persisted .txt
    // also follows the 1-line-per-scene rule even if the user pasted custom
    // content with blank lines into the output textarea before clicking Save.
    const cleaned = _postprocessScenarioText(text);
    const safeName = (name || '').trim().replace(/[^a-zA-Zа-яА-ЯёЁ0-9_\- #]/g, '').trim() || `AI_${Date.now()}`;
    const filename = `${safeName}.txt`;
    fs.writeFileSync(path.join(SCENARIOS_DIR, filename), cleaned, 'utf8');

    // Build the per-scenario motion clause via LLM (hybrid approach — single
    // call, cached forever in meta). If anything goes wrong, save meta with an
    // empty motionPrompt — the edit-tab will fall back to default behaviour.
    let motionPrompt = '';
    try { motionPrompt = await buildScenarioMotionPrompt({ gender, emotion, style }); }
    catch (e) { console.warn('[scenarios/ai/save-with-meta] motionPrompt LLM failed:', e.message); }

    const allMeta = loadScenariosMeta();
    allMeta[filename] = {
      gender, emotion, style, motionPrompt,
      product:     (product || '').trim(),
      model:       model || '',
      generatedAt: new Date().toISOString(),
      userOverrideMotionPrompt: false,
    };
    saveScenariosMeta(allMeta);

    res.json({ success: true, filename, name: safeName, meta: allMeta[filename] });
  } catch (err) {
    console.error('[scenarios/ai/save-with-meta]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// List all scenario metas (used by scenario-ai.js to compute "#N" counter
// keyed by product name when building the auto-suggested filename).
// Path lives at /scenarios-all-meta (with a hyphen, no second `/scenarios/`
// segment) so the catch-all `GET /scenarios/:filename` declared earlier
// can't intercept it as filename="meta" / "all-meta".
router.get('/scenarios-all-meta', (_req, res) => {
  res.json({ success: true, meta: loadScenariosMeta() });
});

router.get('/scenarios/meta/:filename', (req, res) => {
  const filename = path.basename(req.params.filename || '');
  if (!filename.endsWith('.txt')) return res.status(400).json({ success: false, error: 'Неверный файл' });
  const meta = loadScenariosMeta();
  res.json({ success: true, meta: meta[filename] || null });
});

router.patch('/scenarios/meta/:filename', (req, res) => {
  try {
    const filename = path.basename(req.params.filename || '');
    if (!filename.endsWith('.txt')) return res.status(400).json({ success: false, error: 'Неверный файл' });
    const all = loadScenariosMeta();
    if (!all[filename]) all[filename] = { gender: 'women', emotion: '', style: '', motionPrompt: '', generatedAt: new Date().toISOString() };
    if (typeof req.body?.motionPrompt === 'string') {
      all[filename].motionPrompt = req.body.motionPrompt;
      all[filename].userOverrideMotionPrompt = true;
    }
    saveScenariosMeta(all);
    res.json({ success: true, meta: all[filename] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
