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

const { CHARACTERS_DIR, ROOT_DIR, CHAR_SHEET_PROMPT } = require('../lib/config');
const {
  uploadToPublicHost, resolveTask,
  createNanoBananaProTask, createQwen2Task, createGptImage2Task, createSeedream5LiteTask, createSeedream45Task,
} = require('../lib/helpers');
const { addPendingTask, removePendingTask } = require('../lib/pending-tasks');
const {
  charFolderName, charAbsFolderRec,
  loadChars, findChar, upsertChar, patchChar, deleteChar,
  findDraftByObraz, deleteDraftByObraz,
} = require('../lib/char-store');

// The reference sheet defaults to nano-banana-2 at 4K and is always generated
// at the highest quality / resolution each engine offers — it is a long-lived
// canonical asset, so quality matters more than speed/cost.
//   nano-banana-2 → resolution '4K'   gpt-image-2 → quality 'high'
//   seedream      → 'high' (3K)        qwen2 → output_quality 100
// `params` (from the popup's engine settings) layer on top of these defaults.
function _normalizeEngine(e) {
  return ['qwen2', 'seedream', 'seedream4.5', 'gptimage2', 'nano-banana-2'].includes(e) ? e : 'nano-banana-2';
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

// Generate the SINGLE combined reference sheet (large portrait + full-body
// turnaround on one 4K 16:9 image) in the BACKGROUND, retrying on throttle.
// The taskId is patched onto the char as soon as it is submitted, so the actor
// popup can pick it up and poll ref-status to resolve it. Fire-and-forget: a
// failed sheet stays null and can be regenerated from the popup.
async function _kickoffSheets(charId, engine, imageUrl, engineParams) {
  try {
    const taskId = await _sheetTaskRetry(engine, CHAR_SHEET_PROMPT, imageUrl, engineParams, 'sheet');
    addPendingTask(taskId, 'characters', 'sheet', 'char-sheet');
    patchChar(charId, { sheetTask: taskId });
  } catch (e) {
    console.warn('[char-store] sheet submit failed:', (e.response && e.response.data && e.response.data.detail) || e.message);
  }
}

// ── POST /api/char-store/create ──────────────────────────────────────────
// Body: { id?, name, gender, faceImagePath, imageEngine }
// The active appearance image is used ONLY as the identity source for the
// combined reference-sheet generation — it is NOT copied or stored on the
// character (no face source). The sheet is the character's canonical asset.
router.post('/char-store/create', async (req, res) => {
  try {
    const { id, name, gender, faceImagePath, imageEngine, engineParams = {}, sourceObrazId } = req.body || {};
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
    if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });   // the sheet lands here

    // Upload the appearance image once for the sheet generation (transient use only).
    const imageUrl = await uploadToPublicHost(fs.readFileSync(srcAbs));
    const engine = _normalizeEngine(imageEngine);

    // Save the character immediately (sheet pending) so "Save char" opens the
    // actor popup right away. The combined reference sheet is generated in the
    // BACKGROUND below -- retrying throttle -- so a low-credit Replicate 429
    // (burst limit) never blocks the save / popup.
    const rec = {
      id:           charId,
      name:         charName,
      gender:       gender || (draft && draft.gender) || null,
      folder:       folderNm,
      sheet:        null,
      sheetTask:    null,
      imageEngine:  engine,
      // Inherit voice + description from the draft (designed in Save-obraz popup).
      voice:        (draft && draft.voice) || null,
      notes:        (draft && draft.notes) || '',
      voiceDescription: (draft && draft.voiceDescription) || '',
      draft:        false,
      sourceObrazId: sourceObrazId || (draft && draft.sourceObrazId) || null,
      date:         new Date().toISOString(),
    };
    upsertChar(rec);   // same id as draft → overwrites it (draft promoted)
    res.json({ success: true, char: rec, promotedFromDraft: !!draft });

    // Background: the combined sheet, retrying throttle. The taskId is patched
    // onto the record so the actor popup picks it up and polls ref-status to
    // resolve it into the char folder.
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
      sheet:            null,
      date:             new Date().toISOString(),
    };
    upsertChar(rec);
    res.json({ success: true, draft: rec });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── POST /api/char-store/regen-ref ───────────────────────────────────────
// Body: { charId, imageEngine }
// Re-submits the combined reference sheet. The identity source is the current
// sheet itself (the face source is no longer stored); legacy chars fall back
// to their old baseFace/portrait/tpose files. Returns taskId; the frontend
// polls ref-status as usual.
router.post('/char-store/regen-ref', async (req, res) => {
  try {
    const { charId, imageEngine, engineParams = {} } = req.body || {};
    const c = findChar(charId);
    if (!c) return res.status(404).json({ success: false, error: 'char not found' });
    const srcRel = c.sheet || c.baseFace || c.portrait || c.tpose || '';
    const baseAbs = path.join(ROOT_DIR, String(srcRel).replace(/^\//, '').split('?')[0]);
    if (!srcRel || !fs.existsSync(baseAbs)) return res.status(404).json({ success: false, error: 'no identity source to regenerate from' });

    const imageUrl = await uploadToPublicHost(fs.readFileSync(baseAbs));
    const engine = _normalizeEngine(imageEngine || c.imageEngine);
    const taskId = await _sheetTask(engine, CHAR_SHEET_PROMPT, imageUrl, engineParams);
    addPendingTask(taskId, 'characters', 'sheet', 'char-sheet');
    patchChar(charId, { sheetTask: taskId, imageEngine: engine });
    res.json({ success: true, taskId });
  } catch (err) {
    console.error('[char-store/regen-ref]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// ── GET /api/char-store/ref-status/:taskId?charId=&kind=sheet ─────────────
// Resolves a reference-sheet task into the char's folder and patches the
// matching field on success. Legacy kinds portrait|tpose stay resolvable so
// pre-rebuild polls / records don't break.
router.get('/char-store/ref-status/:taskId', async (req, res) => {
  try {
    const { charId, kind } = req.query;
    const field = (kind === 'tpose') ? 'tpose' : (kind === 'portrait') ? 'portrait' : 'sheet';
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
