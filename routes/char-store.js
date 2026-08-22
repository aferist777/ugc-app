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
  uploadToPublicHost, resolveTask, resolveLocalMedia,
  createMultiRefEditTask, callAIVisionWithFallback,
} = require('../lib/helpers');
const { reasonOf, rehost, isFetchFailure } = require('../lib/img-providers');
const L = require('../lib/cv2-ladders');
const RUN = require('../lib/cv2-run');
const { addPendingTask, removePendingTask } = require('../lib/pending-tasks');
const {
  charFolderName, charAbsFolderRec,
  loadChars, findChar, upsertChar, patchChar, deleteChar,
  findDraftByObraz, deleteDraftByObraz,
} = require('../lib/char-store');

// The reference sheet is a long-lived canonical asset, and which engine draws it, through
// whom, and at which tier is now the `sheet` ladder in lib/cv2-ladders.js - a setting, not
// a constant and not a request parameter.
//
// The three things that used to live here went with it: a default engine, a default
// aggregator, and a tier translator that turned "4K" into whatever the chosen model calls
// its best. The ladder stores each step's own tier already spelt the way its engine accepts,
// which is what made the translator unnecessary rather than merely relocated.
// One sheet, through every aggregator that carries the engine, starting with the chosen one.
// `charId` is how the attempt in progress reaches the page: each failure writes a line onto the
// record, and the page reads it while it waits - so a Replicate that cannot fetch the reference
// reads as "trying kie.ai" rather than as an error.
// The sheet's ladder, walked. Which engine, which aggregator and at which tier are no
// longer arguments: they are the `sheet` ladder in settings, so the page that used to
// send them and the record that used to remember them both stop being the authority.
//
// `skip` is the poll-time half: a task that was accepted and only then failed resumes
// below the aggregators that have already had their turn.
function _sheetTask(prompt, imageUrl, charId, skip) {
  return RUN.runImageLadder('sheet', {
    prompt, imageUrls: [imageUrl], aspect: '16:9',
    skip: skip || [],
    onStep: ({ label, error, next }) => {
      if (!charId) return;
      const note = next
        ? (label + ' could not: ' + String(error).slice(0, 160) + ' — trying ' + next + '…')
        : (label + ' could not: ' + String(error).slice(0, 160));
      try { patchChar(charId, { sheetNote: note }); } catch (e) {}
    },
  });
}

// Submit one sheet, retrying the answers that mean "not now" rather than "no".
//
//   429  Replicate throttles predictions to a burst of 1 while the account has < $5 credit, and
//        Google answers the same code when it is out of capacity - measured on the SECOND of two
//        OpenRouter calls twenty seconds apart, where the first had just succeeded.
//   5xx  the aggregator itself stumbling; the request was never seen by the model.
//
// A failed submit costs nothing, so retrying is only a question of patience. Honors retry_after.
const _RETRY_AT = new Set([429, 500, 502, 503, 504]);
async function _sheetTaskRetry(prompt, imageUrl, label, charId) {
  const MAX = 4;
  for (let attempt = 1; ; attempt++) {
    try {
      // Each round walks the WHOLE ladder; the wait below is only for the case where every
      // step said "not now", which is a reason to be patient rather than to give up.
      return await _sheetTask(prompt, imageUrl, charId);
    } catch (e) {
      const status     = e.response && e.response.status;
      const retryAfter = parseInt(e.response && e.response.data && e.response.data.retry_after, 10);
      if (_RETRY_AT.has(status) && attempt < MAX) {
        const waitMs = (retryAfter > 0 ? retryAfter : (status === 429 ? 12 : 4)) * 1000;
        console.warn(`[char-store] ${label} got ${status} — retry ${attempt}/${MAX - 1} in ${waitMs / 1000}s`);
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
async function _kickoffSheets(charId, faceBuffer, sheetOpts) {
  try {
    // Hosted here rather than in the request. Verified, because an engine handed a link it
    // cannot read fails ten seconds after being charged - and because imgbb's links last an
    // hour, so a cached one is not evidence of anything.
    const imageUrl = await uploadToPublicHost(faceBuffer, { verify: true });
    // Built here too, so the framing agent's call happens on this background path and never
    // delays the save's own response.
    const prompt = await buildSheetPrompt(imageUrl, sheetOpts || {});
    const sub = await _sheetTaskRetry(prompt, imageUrl, 'sheet', charId);
    addPendingTask(sub.taskId, 'characters', 'sheet', 'char-sheet', { charId });
    // What actually drew it, not what the ladder hoped for: a step can be skipped or refuse,
    // and the record is what Regenerate later reads. sheetJob is what makes the SECOND half of
    // the walk possible - a task that is accepted and then fails resumes below the steps that
    // have already had their turn, without asking the framing agent anything again.
    patchChar(charId, _sheetPatch(sub, prompt, imageUrl));
    console.log('[char-store] sheet submitted', sub.engine, '@' + sub.provider, sub.quality, '->', sub.taskId);
  } catch (e) {
    // Written onto the character, not just into the log. This runs in the background, so the page
    // is left watching a record that will never grow a taskId - and watching turns into a
    // six-minute wait ending in "the sheet did not arrive", which says nothing about why. With
    // the reason on the record, the page can say it the moment it happens.
    //
    // Reached only once EVERY aggregator has refused: the cascade above is what a single refusal
    // now costs.
    const why = reasonOf(e);
    console.warn('[char-store] sheet submit failed everywhere:', why);
    patchChar(charId, { sheetTask: null, sheetJob: null, sheetError: String(why || 'the sheet could not be submitted') });
  }
}

// The fields a fresh submit writes. Kept in one place because the two callers - the background
// kickoff and Regenerate - must leave the record in exactly the same shape, or the poll-time
// fallback works after one of them and not the other.
function _sheetPatch(sub, prompt, imageUrl) {
  // Every aggregator this run has finished with - the ones that refused AND the one that
  // accepted. The poll-time half resumes below them: the step that took the job is not a
  // step to hand the same job to again.
  const done = (sub.steps || []).filter(s => s.state !== 'skipped')
    .map(s => String(s.label).split(' / ')[0]);
  return {
    sheetTask: sub.taskId,
    imageEngine: sub.engine,
    imageProvider: sub.provider,
    sheetQuality: sub.quality,
    sheetError: null,
    sheetNote: null,
    sheetJob: { engine: sub.engine, quality: sub.quality, prompt, imageUrl, tried: done.length ? done : [sub.provider] },
  };
}

// The sheet prompt is assembled in lib/char-sheet.js: it asks the framing agent whether the
// reference actually contains a body, and says either "preserve it" or "build it like this",
// then appends the user's Create realism chips as it always did. Both callers here go through
// it, so there is one assembly.

// The identity source, written into the character's own folder.
//
// It used to be kept for DRAFTS only, on the reasoning that a finished character has its sheet
// and needs nothing else. That reasoning had one hole, and it is the hole people fall into: if
// the sheet generation fails, the character has NEITHER - and regen-ref, whose entire job is to
// try again, had nothing to try FROM. "no identity source to regenerate from" was that hole
// speaking. A face is one small jpg and the sheet is the asset it exists to produce, so the
// source that produced it stays.
//
// Returns the public path. `previous` is the record's current baseFace, if any: finishing a
// draft writes a new one, and the old file would otherwise sit in the folder forever.
// ── The preset shortcut ──────────────────────────────────────────────────────
// A preset ships with its 4K sheet already drawn, so taking one unchanged costs nothing and
// waits for nothing.
//
// The TEST is the path, not a flag. The page sends /presets/<id>.jpg only while the picture on
// the bench IS that file; the first edit returns a new file somewhere else, and the shortcut
// stops applying by itself. A "was it touched" flag would have to be set by every path that can
// change the picture and cleared by every path that restores it - and the one that got missed
// would attach one person's sheet to another person's character.
//
// Returns the absolute path of the ready sheet, or '' when there is not one to take.
function _presetSheetFor(faceImagePath) {
  const m = String(faceImagePath || '').match(/^\/presets\/([a-z0-9._-]+)\.jpg$/i);
  if (!m) return '';
  const abs = path.join(ROOT_DIR, 'public', 'presets', 'sheets', m[1] + '.jpg');
  return fs.existsSync(abs) ? abs : '';
}

function _keepFace(folder, folderNm, buf, previous) {
  const ext  = /^\x89PNG/.test(buf.slice(0, 4).toString('latin1')) ? 'png' : 'jpg';
  const file = 'base_' + Date.now() + '.' + ext;
  fs.writeFileSync(path.join(folder, file), buf);
  const rel = '/characters/' + folderNm + '/' + file;
  if (previous && previous !== rel) {
    // Only ever the file this record itself pointed at, and only once its replacement is
    // safely on disk.
    try {
      const old = path.join(ROOT_DIR, String(previous).replace(/^\//, '').split('?')[0]);
      if (fs.existsSync(old)) fs.unlinkSync(old);
    } catch (e) { console.warn('[char-store] old face left behind:', e.message); }
  }
  return rel;
}

// ── POST /api/char-store/create ──────────────────────────────────────────
// Body: { id?, name, gender, faceImagePath, imageEngine }
// The active appearance image is the identity source for the combined
// reference-sheet generation. The sheet is the character's canonical asset;
// the face is kept beside it as `baseFace` so a failed sheet can always be
// regenerated from what made it.
router.post('/char-store/create', async (req, res) => {
  try {
    const { id, name, gender, faceImagePath, faceImageBase64, imageEngine, imageProvider, sheetQuality, sourceObrazId, realismMarkers, figure } = req.body || {};
    const asDraft = !!(req.body && req.body.draft);
    if (!faceImagePath && !faceImageBase64) return res.status(400).json({ success: false, error: 'faceImagePath or faceImageBase64 is required' });

    // Identity source: a server file path, OR an ephemeral base64 face (TPDNE) that
    // is uploaded straight to the public host and never touches our disk.
    let faceBuffer = null;
    if (faceImageBase64) {
      faceBuffer = Buffer.from(String(faceImageBase64).replace(/^data:image\/\w+;base64,/, ''), 'base64');
      if (!faceBuffer.length) return res.status(400).json({ success: false, error: 'faceImageBase64 is empty' });
    } else {
      // Both roots: a preset is served out of public/, everything else lives at the top.
      const srcAbs = resolveLocalMedia(faceImagePath);
      if (!srcAbs) return res.status(404).json({ success: false, error: 'face image not found: ' + faceImagePath });
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
    // What is already under this id, if anything - starring a take then finishing it, or saving
    // the same draft twice, both land here with a face this record has already got one of.
    const existing = findChar(charId);

    // engine / provider / tier used to be computed here from what the page sent. They are
    // the `sheet` ladder's business now, and the ladder is not a request parameter - so the
    // three fields the page still sends are read by nobody, and the gear that sends them is
    // on its way out with the popup that replaces it.

    // ── Kept as a draft: an unfinished character, saved to be come back to ──
    // No sheet, so no upload and no engine call at all - a draft costs nothing. But the face
    // MUST be kept: the sheet is normally the character's only asset, and a draft has no sheet
    // yet, so without the face there would be nothing to finish it from. It goes into the
    // character's own folder rather than staying in uploads/, which is swept.
    //
    // baseFace is where regen-ref already looks when there is no sheet, so finishing a draft
    // needs no new path through that code.
    if (asDraft) {
      const rec = {
        id: charId,
        name: charName,
        gender: gender || null,
        folder: folderNm,
        sheet: null,
        sheetTask: null,
        sheetError: null,
        baseFace: _keepFace(folder, folderNm, faceBuffer, existing && existing.baseFace),
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

    // An untouched preset already has its sheet. Copied into the character's own folder rather
    // than pointed at: from here on it belongs to this character, and deleting the character
    // must not reach back into the preset library.
    const readyAbs = _presetSheetFor(faceImagePath);
    let readySheet = null;
    if (readyAbs) {
      const file = 'sheet_' + Date.now() + '.jpg';
      fs.copyFileSync(readyAbs, path.join(folder, file));
      readySheet = '/characters/' + folderNm + '/' + file;
    }

    // The upload is NOT done here. It exists to give an engine a URL to fetch, the engine is
    // asked in the background, and verifying the link costs a read-back that turned this
    // request into thirty seconds of nothing on a bad host rotation. It moved into the
    // kickoff, where the waiting was always meant to happen.

    // Save the character immediately (sheet pending) so "Save char" opens the
    // actor popup right away. The combined reference sheet is generated in the
    // BACKGROUND below -- retrying throttle -- so a low-credit Replicate 429
    // (burst limit) never blocks the save / popup.
    const rec = {
      id:           charId,
      name:         charName,
      gender:       gender || (draft && draft.gender) || null,
      folder:       folderNm,
      sheet:        readySheet,
      sheetTask:    null,
      // The face that is about to become the sheet, kept. If the sheet never arrives - a dead
      // engine, a throttle that outlasts the retries - this is what Regenerate works from, and
      // without it that button can only apologise.
      baseFace:     _keepFace(folder, folderNm, faceBuffer, existing && existing.baseFace),
      // imageEngine / imageProvider / sheetQuality are written by _sheetPatch when the ladder
      // actually lands on a step. Guessing them here would put the step we HOPED for on the
      // record next to the taskId of the one that took it.
      // Cleared explicitly: upsert MERGES onto whatever is under this id, so a failure recorded
      // on the last attempt would otherwise still be sitting there while this one is in flight -
      // and the page reads that field to decide a wait is hopeless.
      sheetError:   null,
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

    if (readySheet) {
      // Nothing to kick off, nothing to poll, nothing to pay for. The page's wait loop ends on
      // the record having a sheet, and it already has one.
      console.log('[char-store/create] took the preset sheet for', faceImagePath, '->', readySheet);
      return;
    }

    // Background: the combined sheet, retrying throttle. The taskId is patched
    // onto the record so the actor popup picks it up and polls ref-status to
    // resolve it into the char folder.
    _kickoffSheets(charId, faceBuffer, { realismMarkers, figure })
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

// Read a stored path as a buffer, or null if it is not there. Records outlive files.
function _readRel(rel) {
  if (!rel) return null;
  const abs = path.join(ROOT_DIR, String(rel).replace(/^\//, '').split('?')[0]);
  if (!fs.existsSync(abs)) return null;
  try { return fs.readFileSync(abs); } catch (e) { return null; }
}

// Where a regeneration gets its identity from, best answer first.
//
// The sheet leads: regenerating from it preserves the build the character already has. But a
// missing sheet is precisely the case this exists for - a sheet that never generated is WHY
// anyone presses Regenerate - so below it come the face the page is still holding, then whatever
// the record kept, then anything at all in the character's own folder. The old code stopped at
// the first four and answered "no identity source to regenerate from", which is a true statement
// about a character nobody could rescue.
function _identitySource(c, body) {
  const b = body || {};
  const stored = (rel, from) => { const buf = _readRel(rel); return buf ? { buf, from } : null; };

  let hit = stored(c.sheet, 'the current sheet');
  if (hit) return hit;

  // What the page has in the middle column right now: after a failed sheet that is the only
  // picture of this person that definitely exists.
  if (b.faceImageBase64) {
    const buf = Buffer.from(String(b.faceImageBase64).replace(/^data:image\/[\w+.-]+;base64,/, ''), 'base64');
    if (buf.length) return { buf, from: 'the page' };
  }
  hit = stored(b.faceImagePath, 'the page');
  if (hit) return hit;

  for (const [rel, from] of [[c.baseFace, 'the saved face'], [c.portrait, 'the legacy portrait'], [c.tpose, 'the legacy t-pose']]) {
    hit = stored(rel, from);
    if (hit) return hit;
  }

  // Last resort: any picture in the character's folder. A record can point at files an older
  // version of this route renamed, and one of those is still a picture of this person - which
  // beats refusing to regenerate.
  try {
    const folder = charAbsFolderRec(c);
    const rank = (n) => n.startsWith('sheet') ? 0 : n.startsWith('base') ? 1 : 2;
    const files = fs.readdirSync(folder)
      .filter(n => /\.(jpe?g|png|webp)$/i.test(n))
      .sort((a, b2) => rank(a) - rank(b2) || a.localeCompare(b2));
    if (files.length) return { buf: fs.readFileSync(path.join(folder, files[0])), from: 'the folder (' + files[0] + ')' };
  } catch (e) {}
  return null;
}

// ── POST /api/char-store/regen-ref ───────────────────────────────────────
// Body: { charId, imageEngine?, imageProvider?, sheetQuality?, faceImageBase64?, faceImagePath? }
// Re-submits the combined reference sheet. The identity source is the current
// sheet when there is one, and otherwise everything else that could be one —
// see _identitySource. Unstated engine/aggregator/tier fall back to whatever the
// character was last made with. Returns taskId; the frontend polls ref-status.
router.post('/char-store/regen-ref', async (req, res) => {
  try {
    const { charId, imageEngine, imageProvider, sheetQuality } = req.body || {};
    const c = findChar(charId);
    if (!c) return res.status(404).json({ success: false, error: 'char not found' });
    const src = _identitySource(c, req.body);
    if (!src) {
      return res.status(404).json({ success: false,
        error: 'nothing to regenerate from - this character has no sheet, no saved face and no files. Open it in Create and save it again.' });
    }
    console.log('[char-store/regen-ref]', charId, 'from', src.from);

    const imageUrl = await uploadToPublicHost(src.buf, { verify: true });
    // Regenerate walks the ladder AS IT STANDS NOW, not the pairing this character was
    // originally made with - decided deliberately: the reason to press it is usually that
    // the old pairing disappointed, so repeating it would be the one thing it must not do.
    const ladder = L.getLadder('sheet');
    const first = ladder[0] || {};

    // ANSWERED FIRST, generated after — the same shape create has always had, and for the same
    // reason, only more so now that there is a cascade. The work behind this call is a vision
    // call for the prompt plus a submit that may walk three aggregators, and OpenRouter's submit
    // IS the generation: at 4K it can hold the socket for minutes. Doing all of that inside the
    // request is how "Regenerate" becomes a page waiting on one fetch with nothing to show.
    //
    // Everything the page needs to follow it lives on the record: sheetNote while it hops,
    // sheetTask once something is accepted, sheetError only when nowhere is left. `was` is this
    // character's CURRENT sheet, so the page knows which picture means "still the old one".
    patchChar(charId, { sheetTask: null, sheetError: null, sheetNote: 'Preparing the sheet…' });
    res.json({
      success: true, pending: true, was: c.sheet || null,
      engine: first.engine || '', provider: first.provider || '', quality: first.quality || '',
      steps: ladder.length, from: src.from,
    });

    // With a sheet as the source the framing agent sees a whole body and says "preserve it",
    // which is exactly right: a regeneration should not reinvent the build the character already
    // has. From a face it says "build it like this" instead, the same as the first attempt did -
    // also right, because that IS a first attempt, just a second time.
    (async () => {
      try {
        const prompt = await buildSheetPrompt(imageUrl, {
          realismMarkers: req.body && req.body.realismMarkers,
          figure: req.body && req.body.figure,
        });
        // Through the retrying wrapper, exactly like the create path. Two sheets asked of Google
        // within a minute is enough to be told "Resource exhausted" - measured, on the second of
        // two OpenRouter calls twenty seconds apart - and a Regenerate that gives up on the first
        // 429 is a Regenerate that fails for a reason that would have cleared by itself.
        const sub = await _sheetTaskRetry(prompt, imageUrl, 'regen', charId);
        addPendingTask(sub.taskId, 'characters', 'sheet', 'char-sheet', { charId });
        patchChar(charId, _sheetPatch(sub, prompt, imageUrl));   // supersedes the last attempt
        console.log('[char-store/regen-ref]', sub.engine, '@' + sub.provider, sub.quality, '->', sub.taskId);
      } catch (e) {
        const why = reasonOf(e);
        console.warn('[char-store/regen-ref] nowhere left:', why);
        patchChar(charId, { sheetTask: null, sheetJob: null, sheetError: String(why) });
      }
    })();
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

// A sheet task that was accepted and then failed, handed to the next aggregator that has not been
// asked yet. Returns { taskId, note } if there was somewhere to go, or null once there is not.
//
// Nothing is recomputed: the prompt cost a call to the framing agent and the reference is already
// hosted, so sheetJob carries both. `tried` grows with each hop, which is what stops this from
// walking in a circle.
async function _retrySheetElsewhere(c, why) {
  const job = c && c.sheetJob;
  if (!job || !job.prompt || !job.imageUrl) return null;
  const tried = Array.isArray(job.tried) ? job.tried : [];
  try {
    // Replicate takes the job and only discovers a minute later that it cannot read the
    // reference - "HTTPSConnectionPool(host='i.ibb.co') Read timed out" arrives as a FAILED
    // prediction, not as a refused submit. So the same rescue the submit path has belongs here:
    // move the picture somewhere else before handing it to the next aggregator, or the next one
    // is being set up to fail the same way.
    let imageUrl = job.imageUrl;
    if (isFetchFailure({ message: String(why || '') })) {
      try { imageUrl = (await rehost([imageUrl]))[0] || imageUrl; }
      catch (e) { console.warn('[char-store] could not rehost the reference:', e.message); }
    }
    // The same ladder, resumed below the steps that have already had their turn. The prompt is
    // NOT rebuilt: it cost a call to the framing agent, and it describes the same person.
    const sub = await RUN.runImageLadder('sheet', {
      prompt: job.prompt, imageUrls: [imageUrl], aspect: '16:9', skip: tried,
      onStep: ({ label, error, next }) => {
        try {
          patchChar(c.id, { sheetNote: label + ' could not: ' + String(error).slice(0, 160)
            + (next ? ' — trying ' + next + '…' : '') });
        } catch (e) {}
      },
    });
    const note = (tried[tried.length - 1] || 'the last step') + ' failed: ' + String(why).slice(0, 120)
      + ' — retrying on ' + sub.provider + '…';
    const done = (sub.steps || []).filter(s => s.state !== 'skipped')
      .map(s => String(s.label).split(' / ')[0]);
    patchChar(c.id, {
      sheetTask: sub.taskId, imageProvider: sub.provider, imageEngine: sub.engine, sheetNote: note,
      // imageUrl too: it may have moved host on the way here, and the NEXT hop should start from
      // where this one actually got to.
      sheetJob: { ...job, imageUrl, tried: tried.concat(done.length ? done : [sub.provider]) },
    });
    addPendingTask(sub.taskId, 'characters', 'sheet', 'char-sheet', { charId });
    console.log('[char-store] sheet failed on', tried.join(', '), '- retrying on', sub.provider);
    return { taskId: sub.taskId, note };
  } catch (e) {
    console.warn('[char-store] nowhere left to retry the sheet:', reasonOf(e));
    return null;
  }
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
      patchChar(charId, {
        [field]: result.imagePath, [field + 'Task']: null, sheetError: null, sheetNote: null, sheetJob: null,
      });
      removePendingTask(req.params.taskId);
    } else if (result.state === 'failed') {
      removePendingTask(req.params.taskId);

      // A task can be accepted and fail LATER - ModelRateLimitError arrives a minute after the
      // submit was taken happily. That failure is exactly as recoverable as one at submit time,
      // and the caller is still sitting here waiting, so it is retried on the next aggregator
      // rather than reported. sheetJob carries everything needed for that: the same prompt, the
      // same reference, and who has already been asked.
      const next = (field === 'sheet') ? await _retrySheetElsewhere(c, result.error) : null;
      if (next) return res.json({ success: true, state: 'pending', taskId: next.taskId, note: next.note });

      // Kept on the record as well as answered here: whoever opens this character next deserves
      // to know why it has no sheet, not just that it has none.
      patchChar(charId, {
        [field + 'Task']: null, sheetJob: null,
        sheetError: String(result.error || 'the generation failed'),
      });
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
