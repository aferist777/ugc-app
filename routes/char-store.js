'use strict';

// ════════════════════════════════════════════════════════════════════════
// PERSISTENT CHARACTERS (ACTORS) — REST API.
//   POST   /api/char-store/create            create char + kick off 2 sheets
//   GET    /api/char-store/list              list all chars
//   GET    /api/char-store/ref-status/:tid   poll portrait/tpose generation
//   PATCH  /api/char-store/:id               edit name/gender/voice/notes
//   DELETE /api/char-store/:id               remove char + its folder
// ════════════════════════════════════════════════════════════════════════

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const axios   = require('axios');
const router  = express.Router();

const { CHARACTERS_DIR, ROOT_DIR, CHAR_PORTRAIT_SHEET_PROMPT, CHAR_TPOSE_SHEET_PROMPT } = require('../lib/config');
const {
  uploadToPublicHost, resolveTask, createThumbnail,
  createNanoBananaProTask, createQwen2Task, createGptImage2Task, createSeedream5LiteTask, createSeedream45Task,
} = require('../lib/helpers');
const { addPendingTask, removePendingTask } = require('../lib/pending-tasks');
const {
  charFolderName, charAbsFolderRec,
  loadChars, findChar, upsertChar, patchChar, deleteChar,
  findDraftByObraz, deleteDraftByObraz,
} = require('../lib/char-store');

// Reference sheets default to gpt-image-2 and are always generated at the
// highest quality / resolution each engine offers — these are long-lived
// canonical assets, so quality matters more than speed/cost.
//   gpt-image-2 → quality 'high'      nano-banana-2 → resolution '4K'
//   seedream     → 'high' (3K)         qwen2 → output_quality 100
// `params` (from the popup's engine settings) layer on top of these defaults.
function _normalizeEngine(e) {
  return ['qwen2', 'seedream', 'seedream4.5', 'gptimage2', 'nano-banana-2'].includes(e) ? e : 'gptimage2';
}
function _sheetTask(engine, prompt, imageUrl, params = {}) {
  if (engine === 'qwen2')     return createQwen2Task(prompt, imageUrl, '16:9', undefined, { output_quality: 100, ...params });
  if (engine === 'seedream')  return createSeedream5LiteTask(prompt, [imageUrl], '16:9', 'high', params);
  if (engine === 'seedream4.5')  return createSeedream45Task(prompt, [imageUrl], '16:9', 'high', params);
  if (engine === 'nano-banana-2') return createNanoBananaProTask(prompt, imageUrl, '16:9', { resolution: '4K', ...params });
  return createGptImage2Task(prompt, [imageUrl], '16:9', { quality: 'high', ...params });
}

// Submit one sheet, retrying on Replicate 429 (predictions are throttled to a
// burst of 1 while the account has < $5 credit). Honors retry_after.
async function _sheetTaskRetry(engine, prompt, imageUrl, params, label) {
  const MAX = 4;
  for (let attempt = 1; ; attempt++) {
    try {
      return await _sheetTask(engine, prompt, imageUrl, params);
    } catch (e) {
      const status     = e.response && e.response.status;
      const retryAfter = parseInt(e.response && e.response.data && e.response.data.retry_after, 10);
      if (status === 429 && attempt < MAX) {
        const waitMs = (retryAfter > 0 ? retryAfter : 12) * 1000;
        console.warn(`[char-store] ${label} throttled (429) — retry ${attempt}/${MAX - 1} in ${waitMs / 1000}s`);
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }
      throw e;
    }
  }
}

// Generate the portrait + T-pose reference sheets in the BACKGROUND, one at a
// time (so we never exceed Replicate's burst-1 limit when credit is low), each
// retrying on throttle. The taskId is patched onto the char as soon as it is
// submitted, so the actor popup can pick it up and poll ref-status to resolve
// it. Fire-and-forget: a failed sheet stays null and can be regenerated from
// the popup's per-sheet button.
async function _kickoffSheets(charId, engine, imageUrl, engineParams) {
  const jobs = [
    { field: 'portraitTask', kind: 'portrait', prompt: CHAR_PORTRAIT_SHEET_PROMPT, tag: 'char-portrait' },
    { field: 'tposeTask',    kind: 'tpose',    prompt: CHAR_TPOSE_SHEET_PROMPT,    tag: 'char-tpose' },
  ];
  for (const j of jobs) {
    try {
      const taskId = await _sheetTaskRetry(engine, j.prompt, imageUrl, engineParams, j.kind);
      addPendingTask(taskId, 'characters', j.kind, j.tag);
      patchChar(charId, { [j.field]: taskId });
    } catch (e) {
      console.warn(`[char-store] ${j.kind} sheet submit failed:`, (e.response && e.response.data && e.response.data.detail) || e.message);
    }
  }
}

// ── POST /api/char-store/create ──────────────────────────────────────────
// Body: { id?, name, gender, faceImagePath, imageEngine }
// Snapshots the active image into characters/<folder>/base.jpg, then submits
// the portrait + tpose reference-sheet generations (face is identity only —
// clothing/background discarded by the prompts). Returns the new char record
// (portrait/tpose null until ref-status resolves them).
router.post('/char-store/create', async (req, res) => {
  try {
    const { id, name, gender, faceImagePath, imageEngine, engineParams = {}, genParams, sourceObrazId } = req.body || {};
    if (!faceImagePath) return res.status(400).json({ success: false, error: 'faceImagePath is required' });

    const srcAbs = path.join(ROOT_DIR, String(faceImagePath).replace(/^\//, ''));
    if (!fs.existsSync(srcAbs)) return res.status(404).json({ success: false, error: 'face image not found: ' + faceImagePath });

    // Promotion path: if the active image's obraz has a draft (voice designed in
    // the Save-obraz popup), reuse that draft's id + voice + description instead
    // of starting fresh — then flip draft → real. upsertChar(same id) overwrites.
    const draft = sourceObrazId ? findDraftByObraz(sourceObrazId) : null;
    const charId   = id || (draft && draft.id) || Date.now();
    const charName = (name && String(name).trim()) || 'Character';
    const folderNm = charFolderName(charName, charId);
    const folder   = path.join(CHARACTERS_DIR, folderNm);
    if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
    const folderRel = `/characters/${folderNm}`;

    // Snapshot the source face as base.jpg (copy, never move — the active
    // image may still be referenced elsewhere, e.g. an open obraz).
    const baseAbs = path.join(folder, 'base.jpg');
    fs.copyFileSync(srcAbs, baseAbs);
    try {
      fs.mkdirSync(path.join(folder, 'thumbs'), { recursive: true });
      await createThumbnail(baseAbs, path.join(folder, 'thumbs', 'base.jpg'));
    } catch {}

    // Upload base once; both sheets reference the same uploaded URL.
    const imageUrl = await uploadToPublicHost(fs.readFileSync(baseAbs));
    const engine = _normalizeEngine(imageEngine);

    // Save the character immediately (sheets pending) so "Save char" opens the
    // actor popup right away. The two reference sheets are generated in the
    // BACKGROUND below -- sequentially and retrying throttle -- so a low-credit
    // Replicate 429 (burst limit) never blocks the save / popup.
    const rec = {
      id:           charId,
      name:         charName,
      gender:       gender || (draft && draft.gender) || null,
      folder:       folderNm,
      baseFace:     `${folderRel}/base.jpg`,
      portrait:     null,
      tpose:        null,
      portraitTask: null,
      tposeTask:    null,
      imageEngine:  engine,
      // Inherit voice + description from the draft (designed in Save-obraz popup).
      voice:        (draft && draft.voice) || null,
      notes:        (draft && draft.notes) || '',
      voiceDescription: (draft && draft.voiceDescription) || '',
      draft:        false,
      sourceObrazId: sourceObrazId || (draft && draft.sourceObrazId) || null,
      // Generator settings the character was created with (gender/age/pose/etc.),
      // shown read-only in the actor popup. Null for non-generator origins.
      genParams:    (genParams && typeof genParams === 'object' && Object.keys(genParams).length) ? genParams : null,
      date:         new Date().toISOString(),
    };
    upsertChar(rec);   // same id as draft → overwrites it (draft promoted)
    res.json({ success: true, char: rec, promotedFromDraft: !!draft });

    // Background: portrait then T-pose, one at a time, retrying throttle. Each
    // taskId is patched onto the record so the actor popup picks it up and polls
    // ref-status to resolve it into the char folder.
    _kickoffSheets(charId, engine, imageUrl, engineParams)
      .catch(e => console.warn('[char-store/create] sheet kickoff failed:', e.message));
  } catch (err) {
    console.error('[char-store/create]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// ── GET /api/char-store/list ─────────────────────────────────────────────
// Drafts are hidden — they only surface once promoted via Save char.
router.get('/char-store/list', (_req, res) => {
  res.json({ success: true, chars: loadChars().filter(c => !c.draft) });
});

// ── POST /api/char-store/draft ───────────────────────────────────────────
// Upsert the provisional "character session" attached to an obraz. Called from
// the Save-obraz popup once a voice has been designed. Holds voice +
// descriptions so a later "Save char" promotes it without re-generating.
// Body: { obrazId, name, gender, baseFace, voice, charDescription, voiceDescription }
router.post('/char-store/draft', (req, res) => {
  try {
    const { obrazId, name, gender, baseFace, voice, charDescription, voiceDescription } = req.body || {};
    if (!obrazId) return res.status(400).json({ success: false, error: 'obrazId is required' });
    const existing = findDraftByObraz(obrazId);
    const rec = {
      id:               existing ? existing.id : Date.now(),
      draft:            true,
      sourceObrazId:    obrazId,
      name:             name   || (existing && existing.name) || 'Character',
      gender:           gender || (existing && existing.gender) || null,
      baseFace:         baseFace || (existing && existing.baseFace) || null,
      voice:            voice != null ? voice : (existing && existing.voice) || null,
      notes:            charDescription != null ? charDescription : (existing && existing.notes) || '',
      voiceDescription: voiceDescription != null ? voiceDescription : (existing && existing.voiceDescription) || '',
      portrait:         null,
      tpose:            null,
      date:             new Date().toISOString(),
    };
    upsertChar(rec);
    res.json({ success: true, draft: rec });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── POST /api/char-store/regen-ref ───────────────────────────────────────
// Body: { charId, kind: 'portrait'|'tpose', imageEngine }
// Re-submits a single reference sheet from the stored base.jpg. Returns taskId;
// the frontend polls ref-status as usual.
router.post('/char-store/regen-ref', async (req, res) => {
  try {
    const { charId, kind, imageEngine, engineParams = {} } = req.body || {};
    const field = (kind === 'tpose') ? 'tpose' : 'portrait';
    const c = findChar(charId);
    if (!c) return res.status(404).json({ success: false, error: 'char not found' });
    const baseAbs = path.join(ROOT_DIR, String(c.baseFace || '').replace(/^\//, ''));
    if (!fs.existsSync(baseAbs)) return res.status(404).json({ success: false, error: 'base face missing' });

    const imageUrl = await uploadToPublicHost(fs.readFileSync(baseAbs));
    const engine = _normalizeEngine(imageEngine || c.imageEngine);
    const prompt = field === 'tpose' ? CHAR_TPOSE_SHEET_PROMPT : CHAR_PORTRAIT_SHEET_PROMPT;
    const taskId = await _sheetTask(engine, prompt, imageUrl, engineParams);
    addPendingTask(taskId, 'characters', field, 'char-' + field);
    patchChar(charId, { [field + 'Task']: taskId, imageEngine: engine });
    res.json({ success: true, taskId });
  } catch (err) {
    console.error('[char-store/regen-ref]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// ── GET /api/char-store/ref-status/:taskId?charId=&kind=portrait|tpose ────
// Resolves a reference-sheet task into the char's folder and patches the
// matching field on success.
router.get('/char-store/ref-status/:taskId', async (req, res) => {
  try {
    const { charId, kind } = req.query;
    const field = (kind === 'tpose') ? 'tpose' : 'portrait';
    const c = charId ? findChar(charId) : null;
    if (!c) return res.status(404).json({ success: false, error: 'char not found' });

    const folder = charAbsFolderRec(c);
    if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });

    const result = await resolveTask(req.params.taskId, folder, field);
    if (result.state === 'success') {
      patchChar(charId, { [field]: result.imagePath, [field + 'Task']: null });
      removePendingTask(req.params.taskId);
    } else if (result.state === 'failed') {
      patchChar(charId, { [field + 'Task']: null });
      removePendingTask(req.params.taskId);
    }
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
  }
});

// ── PATCH /api/char-store/:id ────────────────────────────────────────────
// Body may contain { name, gender, voice, notes }. Folder is NOT renamed on a
// name change — the stored `folder` field keeps every file path stable.
router.patch('/char-store/:id', (req, res) => {
  const allowed = {};
  for (const k of ['name', 'gender', 'voice', 'notes']) {
    if (k in (req.body || {})) allowed[k] = req.body[k];
  }
  const c = patchChar(req.params.id, allowed);
  if (!c) return res.status(404).json({ success: false, error: 'char not found' });
  res.json({ success: true, char: c });
});

// ── Delete a deleted character's ElevenLabs voice + its catalog entry ────────
// Guard: keep the voice if another EXISTING character — or another character's
// obraz — still references it (only the deleted character's own obrazy are
// ignored, since they go away with the character). The API key now has voice
// delete permission.
const _DATA_DIR        = path.join(__dirname, '..', 'data');
const _SETTINGS_FILE   = path.join(_DATA_DIR, 'settings.json');
const _CUSTOM_VOICES   = path.join(_DATA_DIR, 'custom-voices.json');
const _OBRAZY_FILE     = path.join(_DATA_DIR, 'obrazy.json');
const _EL_API_BASE     = 'https://api.elevenlabs.io/v1';
function _readJson(f, fallback) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; } }

async function _deleteCharVoice(char) {
  const ref = char && char.voice;
  if (!ref) return { deleted: false, reason: 'no voice' };
  const voices = _readJson(_CUSTOM_VOICES, []);
  const entry  = voices.find(x => x.name === ref || x.voiceId === ref || x.id === ref);
  const voiceId = (entry && entry.voiceId) || String(ref);
  const matches = (v) => v && (v === ref || (entry && (v === entry.name || v === entry.voiceId || v === entry.id)));

  // Shared-voice guard.
  const otherCharUses = loadChars().filter(c => String(c.id) !== String(char.id)).some(c => matches(c.voice));
  const otherObrazUses = _readJson(_OBRAZY_FILE, []).some(o => o && String(o.charId) !== String(char.id) && matches(o.voice));
  if (otherCharUses || otherObrazUses) return { deleted: false, reason: 'shared' };

  // Delete from ElevenLabs.
  const apiKey = (_readJson(_SETTINGS_FILE, {}).elevenLabsApiKey || '').trim();
  if (apiKey && voiceId) {
    try {
      await axios.delete(`${_EL_API_BASE}/voices/${encodeURIComponent(voiceId)}`, { headers: { 'xi-api-key': apiKey }, timeout: 20000 });
      console.log('[char-store/delete] ElevenLabs voice deleted:', voiceId);
    } catch (e) {
      console.warn('[char-store/delete] EL voice delete failed:', e.response?.status, (e.response?.data?.detail?.message || e.message));
    }
  }
  // Remove from the local catalog.
  if (entry) {
    try { fs.writeFileSync(_CUSTOM_VOICES, JSON.stringify(voices.filter(x => x !== entry), null, 2), 'utf8'); } catch {}
  }
  return { deleted: true, voiceId };
}

// ── DELETE /api/char-store/:id ───────────────────────────────────────────
router.delete('/char-store/:id', async (req, res) => {
  const char = findChar(req.params.id);   // capture the voice before the record is removed
  const ok = deleteChar(req.params.id);
  let voice = null;
  if (ok && char) { try { voice = await _deleteCharVoice(char); } catch (e) { console.warn('[char-store/delete] voice cleanup error:', e.message); } }
  res.json({ success: true, removed: ok, voice });
});

module.exports = router;
