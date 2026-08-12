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

const { CHARACTERS_DIR, ROOT_DIR } = require('../lib/config');
const { buildSheetPrompt } = require('../lib/char-sheet');
const {
  uploadToPublicHost, resolveTask,
  createNanoBananaProTask, createQwen2Task, createGptImage2Task, createSeedream5LiteTask, createSeedream45Task,
  createMultiRefEditTask, callAIVisionWithFallback,
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
async function _kickoffSheets(charId, engine, imageUrl, engineParams, sheetOpts) {
  try {
    // Built here rather than passed in, so the framing agent's call happens on this background
    // path and never delays the save's own response.
    const prompt = await buildSheetPrompt(imageUrl, sheetOpts || {});
    const taskId = await _sheetTaskRetry(engine, prompt, imageUrl, engineParams, 'sheet');
    addPendingTask(taskId, 'characters', 'sheet', 'char-sheet');
    patchChar(charId, { sheetTask: taskId });
  } catch (e) {
    console.warn('[char-store] sheet submit failed:', (e.response && e.response.data && e.response.data.detail) || e.message);
  }
}

// The sheet prompt is assembled in lib/char-sheet.js: it asks the framing agent whether the
// reference actually contains a body, and says either "preserve it" or "build it like this",
// then appends the user's Create realism chips as it always did. Both callers here go through
// it, so there is one assembly.

// ── POST /api/char-store/create ──────────────────────────────────────────
// Body: { id?, name, gender, faceImagePath, imageEngine }
// The active appearance image is used ONLY as the identity source for the
// combined reference-sheet generation — it is NOT copied or stored on the
// character (no face source). The sheet is the character's canonical asset.
router.post('/char-store/create', async (req, res) => {
  try {
    const { id, name, gender, faceImagePath, faceImageBase64, imageEngine, engineParams = {}, sourceObrazId, realismMarkers, figure } = req.body || {};
    const asDraft = !!(req.body && req.body.draft);
    if (!faceImagePath && !faceImageBase64) return res.status(400).json({ success: false, error: 'faceImagePath or faceImageBase64 is required' });

    // Identity source: a server file path, OR an ephemeral base64 face (TPDNE) that
    // is uploaded straight to the public host and never touches our disk.
    let faceBuffer = null;
    if (faceImageBase64) {
      faceBuffer = Buffer.from(String(faceImageBase64).replace(/^data:image\/\w+;base64,/, ''), 'base64');
      if (!faceBuffer.length) return res.status(400).json({ success: false, error: 'faceImageBase64 is empty' });
    } else {
      const srcAbs = path.join(ROOT_DIR, String(faceImagePath).replace(/^\//, ''));
      if (!fs.existsSync(srcAbs)) return res.status(404).json({ success: false, error: 'face image not found: ' + faceImagePath });
      faceBuffer = fs.readFileSync(srcAbs);
    }

    // Promotion path: if the active image's obraz has a draft (voice designed in
    // the Save-obraz popup), reuse that draft's id + voice + description instead
    // of starting fresh — then flip draft → real. upsertChar(same id) overwrites.
    const draft = sourceObrazId ? findDraftByObraz(sourceObrazId) : null;
    const charId   = id || (draft && draft.id) || Date.now();
    const charName = (name && String(name).trim()) || 'Character';
    const folderNm = charFolderName(charName, charId);
    const folder   = path.join(CHARACTERS_DIR, folderNm);
    if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });   // the sheet lands here

    const engine = _normalizeEngine(imageEngine);

    // ── Kept as a draft: an unfinished character, saved to be come back to ──
    // No sheet, so no upload and no engine call at all - a draft costs nothing. But the face
    // MUST be kept: the sheet is normally the character's only asset, and a draft has no sheet
    // yet, so without the face there would be nothing to finish it from. It goes into the
    // character's own folder rather than staying in uploads/, which is swept.
    //
    // baseFace is where regen-ref already looks when there is no sheet, so finishing a draft
    // needs no new path through that code.
    if (asDraft) {
      const ext = /^\x89PNG/.test(faceBuffer.slice(0, 4).toString('latin1')) ? 'png' : 'jpg';
      const file = 'base_' + Date.now() + '.' + ext;
      fs.writeFileSync(path.join(folder, file), faceBuffer);
      const rec = {
        id: charId,
        name: charName,
        gender: gender || null,
        folder: folderNm,
        sheet: null,
        sheetTask: null,
        baseFace: '/characters/' + folderNm + '/' + file,
        imageEngine: engine,
        voice: null,
        notes: '',
        voiceDescription: '',
        draft: true,
        figure: figure || '',
        sourceObrazId: sourceObrazId || null,
        date: new Date().toISOString(),
      };
      upsertChar(rec);
      console.log('[char-store/create] draft', charId, charName, '->', rec.baseFace);
      return res.json({ success: true, char: rec, draft: true });
    }

    // Upload the appearance image once for the sheet generation (transient use only).
    const imageUrl = await uploadToPublicHost(faceBuffer, { skipOwnHost: true });

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
    _kickoffSheets(charId, engine, imageUrl, engineParams, { realismMarkers, figure })
      .catch(e => console.warn('[char-store/create] sheet kickoff failed:', e.message));
  } catch (err) {
    console.error('[char-store/create]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// ── GET /api/char-store/list ─────────────────────────────────────────────
// Drafts are hidden — they only surface once promoted via Save char.
// ?drafts=1 asks for the unfinished ones INSTEAD - the ones kept with a star while a character
// was being made. Every existing caller sends nothing and still gets only finished characters,
// which is what they have always assumed.
router.get('/char-store/list', (req, res) => {
  const only = String((req.query && req.query.drafts) || '') === '1';
  res.json({ success: true, drafts: only, chars: loadChars().filter(c => only ? !!c.draft : !c.draft) });
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

    const imageUrl = await uploadToPublicHost(fs.readFileSync(baseAbs), { skipOwnHost: true });
    const engine = _normalizeEngine(imageEngine || c.imageEngine);
    // Regenerating uses the current sheet as the identity source, so the framing agent sees a
    // whole body and says "preserve it" - which is exactly right: a regeneration should not
    // reinvent the build the character already has.
    const prompt = await buildSheetPrompt(imageUrl, {
      realismMarkers: req.body && req.body.realismMarkers,
      figure: req.body && req.body.figure,
    });
    const taskId = await _sheetTask(engine, prompt, imageUrl, engineParams);
    addPendingTask(taskId, 'characters', 'sheet', 'char-sheet');
    patchChar(charId, { sheetTask: taskId, imageEngine: engine });
    res.json({ success: true, taskId });
  } catch (err) {
    console.error('[char-store/regen-ref]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// ── POST /api/char-store/dress-sheet ──────────────────────────────────────
// Body: { charId, lookbookPath }
// Dress the character's combined 4K reference sheet in the chosen lookbook via
// nano-banana-2: the sheet's layout/composition (portrait close-up + full-body
// front/side/back on white) stays EXACTLY the same — only the neutral bodysuit
// is replaced by the outfit in every figure. Returns { taskId } (repl:) — the
// client polls the shared GET /api/status.
const _DRESS_SHEET_PROMPT =
  `IMAGE 1 is a character reference sheet: a large head-and-shoulders portrait close-up plus the same person ` +
  `standing full-body from several angles (front, side, back) in a plain neutral skin-tight bodysuit on a white background. ` +
  `The LAST image shows an outfit (a lookbook of clothing items). ` +
  `Redraw the EXACT SAME reference sheet - identical layout, figure placement, poses, camera angles, framing, crop, ` +
  `white background and the same single person in every figure - but dress the person in the outfit from the LAST image ` +
  `in EVERY figure (the portrait AND every full-body view), replacing the neutral bodysuit entirely. ` +
  `Faithfully reproduce each garment (type, colours, prints, patterns, details); do NOT invent or substitute clothing. ` +
  `Do NOT change the composition, do NOT add/remove/move figures, keep the face, hair, skin tone, body proportions ` +
  `and height identical to IMAGE 1. Photorealistic, sharp focus, high detail, no text, no labels, no watermarks.`;
// Best-effort JSON extraction from an LLM reply (handles ```json fences / prose).
function _looseJson(s) {
  if (!s) return null;
  const m = String(s).match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}
// Analyze a user's refine request against the sheet + lookbook and return a
// CLOTHING-ONLY edit clause, dropping anything that touches pose/composition
// (the reference layout must never change). { clothing, pose_ignored }.
async function _analyzeDressRefine(refine, sheetUrl, lbUrl) {
  const content = [
    { type: 'text', text:
      `Image 1 is a character reference sheet (a portrait close-up plus the same person full-body from several angles, in a neutral bodysuit). Image 2 is a clothing lookbook. `
      + `The person will be dressed in the lookbook outfit. The user asked for these extra adjustments: "${String(refine).slice(0, 500)}". `
      + `Rewrite the user's request as a concise CLOTHING-ONLY instruction (e.g. add jeans, change a colour, swap a jacket). `
      + `You MUST IGNORE and DROP anything that changes pose, body position, stance, camera angle, framing, crop, number of figures or the sheet composition - that layout is locked and cannot change. `
      + `Return strict JSON only: {"clothing":"<clothing-only edits, empty string if the request had none>","pose_ignored":<true if the request mentioned any pose/composition change, else false>}.` },
    { type: 'image_url', image_url: { url: sheetUrl } },
    { type: 'image_url', image_url: { url: lbUrl } },
  ];
  try {
    const raw = await callAIVisionWithFallback([{ role: 'user', content }], { timeout: 45000 });
    const j = _looseJson(raw) || {};
    return { clothing: String(j.clothing || '').trim(), pose_ignored: !!j.pose_ignored };
  } catch (e) {
    console.warn('[dress-sheet] refine analysis failed:', e.message);
    return { clothing: '', pose_ignored: false };
  }
}
// Apply-and-refine variant: the CURRENT (possibly already dressed) sheet is the target
// and the MAIN clean sheet rides along as a face anchor — if anything covers or distorts
// the face on the current image, it is restored from the main one.
const _DRESS_CURRENT_PROMPT =
  `IMAGE 1 is the CURRENT character reference sheet: a large head-and-shoulders portrait close-up plus the same person ` +
  `standing full-body from several angles. IMAGE 2 is the MAIN reference of the SAME person with a clean, unobstructed face - ` +
  `keep the face IDENTICAL to IMAGE 2, and if anything covers, shadows or distorts the face in IMAGE 1, restore it from IMAGE 2. ` +
  `The LAST image shows an outfit (a lookbook of clothing items). ` +
  `Redraw the EXACT SAME reference sheet as IMAGE 1 - identical layout, figure placement, poses, camera angles, framing, crop ` +
  `and background - but dress the person in the outfit from the LAST image in EVERY figure, replacing the current clothing entirely. ` +
  `Faithfully reproduce each garment (type, colours, prints, patterns, details); do NOT invent or substitute clothing. ` +
  `Do NOT change the composition, do NOT add/remove/move figures, keep the hair, skin tone, body proportions ` +
  `and height identical to IMAGE 1. Photorealistic, sharp focus, high detail, no text, no labels, no watermarks.`;

// ── POST /api/char-store/redress ──────────────────────────────────────────
// Body: { charId, imagePath, text }
// Re-dress the character ON THE GIVEN IMAGE from a free-form user note (any
// language). A vision LLM reads the image + note, decides what outfit change is
// meant and writes ONE English instruction; the image then goes to nano-banana-2
// with the composition AND pose hard-locked — only the clothing changes.
// A note that ONLY asks to change pose/composition is REJECTED (no generation):
// returns { rejected:true, notice } for the bold-yellow message under the preview.
const _REDRESS_LOCK =
  `Redraw the EXACT SAME image - identical layout, figure placement, poses, body positions, camera angles, framing, ` +
  `crop, background and the same single person in every figure. Do NOT change the composition, do NOT add/remove/move ` +
  `figures, do NOT change pose or camera. Keep the face, hair, skin tone, body proportions and height identical. ` +
  `ONLY the clothing/outfit changes described below are allowed, applied consistently to EVERY figure in the image. ` +
  `Photorealistic, sharp focus, high detail, no text, no labels, no watermarks. OUTFIT CHANGE: `;
async function _analyzeRedress(text, imageUrl) {
  const content = [
    { type: 'text', text:
      `You are a wardrobe assistant. The image shows a character (possibly several views of the same person). `
      + `The user wrote this request (it may be in ANY language): "${String(text).slice(0, 500)}". `
      + `Classify the request and translate it into ONE concise ENGLISH clothing instruction: `
      + `clothing = garments, outfits, shoes, hats, accessories, colours/prints/materials of clothes. `
      + `pose = body position, stance, gesture, camera angle, framing, crop, composition, figure count, background layout. `
      + `Return strict JSON only: {"clothing":"<English clothing-only instruction, empty string if none>","pose_requested":<true if any pose/composition change was asked>}` },
    { type: 'image_url', image_url: { url: imageUrl } },
  ];
  const raw = await callAIVisionWithFallback([{ role: 'user', content }], { timeout: 45000 });
  const j = _looseJson(raw) || {};
  return { clothing: String(j.clothing || '').trim(), pose_requested: !!j.pose_requested };
}

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
  // `voices` is the list the voice studio keeps for a character: every voice taken for them,
  // with its labels, description and our own sample. `voice` stays what it always was — the
  // ONE id every read uses — so the starred entry and that field are the same fact.
  for (const k of ['name', 'gender', 'voice', 'voices', 'notes']) {
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

// EVERY voice the character had, not just the starred one. This function predates
// `voices[]`: it read `char.voice` alone, so a character with two saved voices gave one
// slot back and silently kept the other - and worse, the shared-voice guard only compared
// against other characters' `voice` field, so deleting one character could take away a slot
// another character was still using through their list.
//
// Each one is put on the shelf before its slot goes, and the shelf is told the slot went.
// Without that, the info column would go on claiming a released voice was still in the
// account - it has no other way to know.
//
// A legacy `voice` may be a NAME from data/custom-voices.json rather than an id, so that
// alias lookup stays.
async function _releaseCharVoices(char) {
  if (!char) return [];
  const catalog = _readJson(_CUSTOM_VOICES, []);
  const refs = [];
  if (char.voice) refs.push(String(char.voice));
  for (const v of (Array.isArray(char.voices) ? char.voices : [])) {
    if (v && v.voiceId && !refs.includes(String(v.voiceId))) refs.push(String(v.voiceId));
  }
  if (!refs.length) return [];

  const others = loadChars().filter(c => String(c.id) !== String(char.id));
  const looks = _readJson(_OBRAZY_FILE, []);
  const out = [];

  for (const ref of refs) {
    const entry = catalog.find(x => x && (x.name === ref || x.voiceId === ref || x.id === ref));
    const voiceId = (entry && entry.voiceId) || ref;
    const matches = (v) => v && (String(v) === ref || String(v) === voiceId
      || (entry && (String(v) === entry.name || String(v) === entry.id)));

    // Both fields on every surviving character, which is what was missing.
    const heldBy = others.filter(c => matches(c.voice)
      || (Array.isArray(c.voices) ? c.voices : []).some(v => v && matches(v.voiceId)));
    const heldByLook = looks.some(o => o && String(o.charId) !== String(char.id) && matches(o.voice));

    if (heldBy.length || heldByLook) {
      out.push({ voiceId, released: false,
        reason: 'still used by ' + (heldBy.map(c => c.name).join(', ') || 'a look') });
      continue;
    }

    // On the shelf first. The demo lives in uploads/, not in the character's folder, so it
    // outlives the character and the entry stays playable.
    const saved = (Array.isArray(char.voices) ? char.voices : []).find(v => v && String(v.voiceId) === voiceId);
    if (saved && saved.sample) {
      try {
        await VSHELF.register({ voiceId, name: saved.name || '', demo: saved.sample, dur: saved.dur,
          publicOwnerId: saved.ownerId, fromCharId: String(char.id), fromCharName: char.name || '' });
      } catch (e) { console.warn('[char-store/delete] shelf register failed:', e.message); }
    }

    const slot = await VSHELF.releaseSlot(voiceId);
    if (slot.released) {
      try { VSHELF.upsert({ voiceId, accountRemoved: true }); } catch (e) {}
    }
    console.log('[char-store/delete] voice', voiceId, slot.released ? 'released' : ('kept: ' + slot.reason));
    out.push({ voiceId, released: !!slot.released, reason: slot.reason || '' });

    // The legacy catalog entry goes with it.
    if (entry) {
      try {
        fs.writeFileSync(_CUSTOM_VOICES, JSON.stringify(catalog.filter(x => x !== entry), null, 2), 'utf8');
      } catch (e) {}
    }
  }
  return out;
}

// ── DELETE /api/char-store/:id/voice/:voiceId ────────────────────────────
// Unbind ONE voice from ONE character, and free its ElevenLabs slot.
//
// The order is the whole design. The account is where a voice's tags and its shared-library
// owner live, and the slot is exactly what we are about to delete - so everything worth
// keeping is read and written to the shelf BEFORE anything is destroyed. Fail anywhere and
// the voice is still on the shelf with its demo; fail in the other order and it is gone.
//
//   1. read the account's facts, if the shelf is missing any
//   2. put them on the shelf - the demo file stays exactly where it is
//   3. unbind: out of `voices`, and `voice` moves to the newest one left
//   4. release the slot, but only if nothing else references the voice
//
// Step 4's guard covers other characters (both `voice` and `voices`) and looks. Scenario
// projects need no guard: they store the voice SETTINGS, not an id, and read the id off the
// character at render time.
const VSHELF = require('../lib/voice-shelf');

router.delete('/char-store/:id/voice/:voiceId', async (req, res) => {
  try {
    const voiceId = String(req.params.voiceId || '');
    const char = findChar(req.params.id);
    if (!char) return res.status(404).json({ success: false, error: 'char not found' });

    const voices = Array.isArray(char.voices) ? char.voices : [];
    const entry = voices.find(v => v && String(v.voiceId) === voiceId);
    if (!entry && String(char.voice || '') !== voiceId) {
      return res.status(404).json({ success: false, error: 'this character does not have that voice' });
    }

    // 1 + 2. On the shelf with everything the account still knows. Whatever the entry itself
    // carries is the fallback: the Scenarios studio saves the owner id and the labels it saw.
    const shelved = VSHELF.get(voiceId);
    let facts = null;
    if (!shelved || !shelved.publicOwnerId || !shelved.labels) facts = await VSHELF.readFacts(voiceId);
    const kept = {};
    if (entry && entry.labels) for (const k of VSHELF.LABEL_KEYS) if (entry.labels[k]) kept[k] = String(entry.labels[k]);
    VSHELF.upsert({
      voiceId,
      name: (facts && facts.name) || (entry && entry.name) || (shelved && shelved.name) || voiceId,
      demo: (entry && entry.sample) || undefined,
      dur: (entry && entry.dur) || undefined,
      description: (entry && entry.description) || undefined,
      category: (facts && facts.category) || (entry && entry.labels && entry.labels.category) || undefined,
      labels: (facts && Object.keys(facts.labels).length) ? facts.labels
            : (Object.keys(kept).length ? kept : undefined),
      verifiedLanguages: facts ? facts.verifiedLanguages : undefined,
      previewUrl: facts ? facts.previewUrl : undefined,
      publicOwnerId: (facts && facts.publicOwnerId) || (entry && entry.ownerId) || undefined,
      sharedVoiceId: facts ? facts.sharedVoiceId : undefined,
      fromCharId: String(char.id),
      fromCharName: char.name || '',
    });

    // 3. Unbind. The star follows the convention it has always had - the newest saved voice
    // is the character's voice - so losing the gold one promotes the last of the rest rather
    // than leaving a character that had two voices with none.
    const left = voices.filter(v => v && String(v.voiceId) !== voiceId);
    let voice = String(char.voice || '');
    if (voice === voiceId) voice = left.length ? String(left[left.length - 1].voiceId) : '';
    patchChar(char.id, { voices: left, voice: voice || null });

    // 4. The slot, and only if nobody else is speaking with it.
    const others = loadChars().filter(c => String(c.id) !== String(char.id)).filter(c => {
      if (String(c.voice || '') === voiceId) return true;
      return (Array.isArray(c.voices) ? c.voices : []).some(v => v && String(v.voiceId) === voiceId);
    });
    const obrazUses = _readJson(_OBRAZY_FILE, []).some(o => o && String(o.voice || '') === voiceId);
    let slot = { released: false, reason: '' };
    if (others.length || obrazUses) {
      slot.reason = 'kept - still used by ' + (others.map(c => c.name).join(', ') || 'a look');
    } else {
      slot = await VSHELF.releaseSlot(voiceId);
      // Not on `released` alone: a premade default answers the same refusal as a voice that is
      // already gone, and it is neither removed nor removable. releaseSlot tells them apart.
      if (slot.released && !slot.premade) VSHELF.upsert({ voiceId, accountRemoved: true });
    }

    console.log('[char-store] voice', voiceId, 'unbound from', char.name,
      '| slot', slot.released ? 'released' : ('kept: ' + slot.reason));
    res.json({ success: true, voiceId, char: findChar(char.id), shelved: true, slot,
      voice: voice || null, left: left.length });
  } catch (e) {
    console.error('[char-store] voice unbind failed:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── DELETE /api/char-store/:id ───────────────────────────────────────────
router.delete('/char-store/:id', async (req, res) => {
  const char = findChar(req.params.id);   // capture the voices before the record is removed
  const ok = deleteChar(req.params.id);
  let voices = [];
  if (ok && char) {
    try { voices = await _releaseCharVoices(char); }
    catch (e) { console.warn('[char-store/delete] voice cleanup error:', e.message); }
  }
  // `voice` stays in the answer for the callers that were written against it - the first
  // result, which for a character with one voice is the same fact it always was.
  res.json({ success: true, removed: ok, voices, voice: voices[0] || null });
});

module.exports = router;
