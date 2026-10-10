'use strict';

// ════════════════════════════════════════════════════════════════════════
// PERSISTENT CHARACTERS (ACTORS) — REST API.
//   POST   /api/char-store/create            create a character + kick off its 4K sheet (a row in Alerts)
//   POST   /api/char-store/regen-ref         draw the sheet again (one at a time per character)
//   GET    /api/char-store/list              list all chars
//   PATCH  /api/char-store/:id               edit name/gender/voice/voices/notes
//   DELETE /api/char-store/:id               remove char + its folder (not while its sheet runs)
//   DELETE /api/char-store/:id/voice/:vid    unbind one voice, its slot freed
// ════════════════════════════════════════════════════════════════════════

const express = require('express');
const fs      = require('fs');
const { writeFileAtomic } = require('../lib/atomic-write');
const path    = require('path');
const router  = express.Router();

const { CHARACTERS_DIR, ROOT_DIR, DATA_DIR, PUBLIC_DIR, CACHE_DIR, BACKUPS_DIR } = require('../lib/config');
const { buildSheetPrompt } = require('../lib/char-sheet');
const {
  uploadToPublicHost, resolveTask, resolveLocalMedia,
} = require('../lib/helpers');
const { reasonOf, rehost, isFetchFailure, PROVIDER_LABELS } = require('../lib/img-providers');
const L = require('../lib/cv2-ladders');
const RUN = require('../lib/cv2-run');
const REFUSAL = require('../lib/gen-refusal');
const {
  charFolderName, charAbsFolderRec,
  loadChars, findChar, upsertChar, patchChar, deleteChar,
} = require('../lib/char-store');
const CHAR_DRAFTS = require('../lib/char-drafts');

// WHAT THE CHARACTER PAGE LEFT BEHIND (phase H8, the owner 2026-10-01). Its own logs - the attempt log
// (cv2-trace.jsonl and its rotations), the rescued list (cv2-recovered.json), the prompt edits
// (prompts.json) - which nothing reads any more, set aside ONCE per library (marked in cache/). And
// drafts, on EVERY start: one can come back with an archive made before H8 (lib/char-drafts.js - Import
// takes them out of the staged set too). Both into backups/<date> character page/.
function _tidyAfterTheCharacterPage() {
  try {
    const drafts = CHAR_DRAFTS.setAside(ROOT_DIR, BACKUPS_DIR);
    if (drafts.length) console.log('[char-store] ' + drafts.length + ' draft(s) set aside in ' + CHAR_DRAFTS.backupDir(BACKUPS_DIR));
  } catch (e) { console.warn('[char-store] drafts could not be set aside:', e.message); }
  const mark = path.join(CACHE_DIR, 'char-drafts-dropped.json');
  if (fs.existsSync(mark)) return;
  try {
    const dir = CHAR_DRAFTS.backupDir(BACKUPS_DIR);
    const logs = fs.existsSync(DATA_DIR) ? fs.readdirSync(DATA_DIR)
      .filter(f => /^cv2-trace\.jsonl(\.\d+)?$/.test(f) || f === 'cv2-recovered.json' || f === 'prompts.json') : [];
    const moved = [];
    for (const f of logs) {
      try { fs.mkdirSync(dir, { recursive: true }); fs.renameSync(path.join(DATA_DIR, f), path.join(dir, f)); moved.push(f); }
      catch (e) { console.warn('[char-store] ' + f + ' left where it was:', e.message); }
    }
    if (moved.length) console.log('[char-store] the Character page logs set aside in ' + dir + ': ' + moved.join(', '));
    // Not marked while one could not be moved (a Windows lock): the next start tries again.
    if (moved.length < logs.length) return;
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    writeFileAtomic(mark, JSON.stringify({ at: new Date().toISOString(), logs: moved }, null, 2));
  } catch (e) { console.warn('[char-store] the Character page logs could not be set aside:', e.message); }
}
_tidyAfterTheCharacterPage();

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
//
// PAID ONCE (phase V22, the owner 2026-10-09: "as in the chats"): the row is marked `asked` just
// before each create that costs money, and the mark is taken back when the aggregator ANSWERS no;
// a create with no answer stops the ladder (lib/cv2-run.js). There is no retry around it any more:
// the old one read a status off the ladder's own error, which has none, so it never fired - and on
// a 5xx it would have paid for the same sheet twice.
function _sheetTask(prompt, imageUrl, charId, alertId) {
  return RUN.runImageLadder('sheet', {
    prompt, imageUrls: [imageUrl], aspect: '16:9',
    onAsk: () => { if (alertId) ALERTS.update(alertId, { params: { asked: true } }); },
    onStep: ({ label, error, next }) => {
      if (alertId) ALERTS.update(alertId, { params: { asked: false } });
      if (!charId) return;
      const note = next
        ? (label + ' could not: ' + String(error).slice(0, 160) + ' — trying ' + next + '…')
        : (label + ' could not: ' + String(error).slice(0, 160));
      try { patchChar(charId, { sheetNote: note }); } catch (e) {}
    },
  });
}

// Generate the SINGLE combined reference sheet (large portrait + full-body
// turnaround on one 4K 16:9 image) in the BACKGROUND.
// The taskId is patched onto the char as soon as it is submitted; the runner (lib/gen-jobs.js)
// resolves it through the Alerts row. Fire-and-forget: a failed sheet stays null, with its reason.
// `alertId` is the row written at the press (_openSheetRow). The kickoff moves its stage as it goes,
// hands it the task once the ladder accepts, and stops at the next step if the row was let go of - a
// sheet cancelled while its face is still being uploaded is never asked for at all.
// `src` is what it is drawn from: `{ buf }` - a face, uploaded and read here - or `{ prompt, imageUrl }`
// a retry from Alerts still has from the last attempt.
async function _kickoffSheets(charId, src, sheetOpts, alertId, kick) {
  // The row as it was when this kickoff started: let go of since, or started again from Alerts (a new
  // startedAt - that run is the retry's, not this one's), and this kickoff stops at its next step.
  const born = alertId ? ((ALERTS.get(alertId) || {}).startedAt || '') : '';
  const gone = () => { if (!alertId) return false; const r = ALERTS.get(alertId); return !r || !!r.cancelled || (r.startedAt || '') !== born; };
  const stage = (s) => { if (alertId && !gone()) ALERTS.update(alertId, { stage: s }); };
  try {
    // Hosted here rather than in the request. Verified, because an engine handed a link it
    // cannot read fails ten seconds after being charged, and a presigned link has an expiry of
    // its own - so a cached one is not evidence that it still works.
    let imageUrl = src.imageUrl || '';
    if (!imageUrl) {
      stage('uploading the face');
      // In a format the engines take (phase V24, lib/image-in.js).
      const pic = await require('../lib/image-in').sendable(src.buf);
      imageUrl = await uploadToPublicHost(pic.buf, { verify: true, ext: pic.ext });
      if (gone()) return _sheetLetGo(charId, '');
    }
    // Built here too, so the framing agent's call happens on this background path and never
    // delays the save's own response.
    let prompt = src.prompt || '';
    if (!prompt) {
      stage('reading the body');
      prompt = await buildSheetPrompt(imageUrl, sheetOpts || {});
      if (gone()) return _sheetLetGo(charId, '');
    }
    stage('asking the engines');
    const sub = await _sheetTask(prompt, imageUrl, charId, alertId);
    // What actually drew it, not what the ladder hoped for: a step can be skipped or refuse,
    // and the record is what Regenerate later reads. sheetJob is what makes the SECOND half of
    // the walk possible - a task that is accepted and then fails resumes below the steps that
    // have already had their turn, without asking the framing agent anything again.
    patchChar(charId, _sheetPatch(sub, prompt, imageUrl));
    // Let go of while the ladder was answering: the task exists and was paid for, but nobody waits.
    if (gone()) return _sheetLetGo(charId, sub.taskId);
    // The row now has something to follow (lib/gen-jobs.js polls it from here).
    if (alertId) ALERTS.update(alertId, { taskIds: [sub.taskId], engine: sub.engine + ' @ ' + sub.provider, stage: 'drawing' });
    console.log('[char-store] sheet submitted', sub.engine, '@' + sub.provider, sub.quality, '->', sub.taskId);
  } catch (e) {
    // Written onto the character, not just into the log. This runs in the background, so the page
    // is left watching a record that will never grow a taskId - and watching turns into a
    // six-minute wait ending in "the sheet did not arrive", which says nothing about why. With
    // the reason on the record, the page can say it the moment it happens.
    //
    // Reached once EVERY aggregator has refused - the cascade above is what a single refusal now
    // costs - or when one gave no answer and may have taken the money (V22): then it says so.
    const why = reasonOf(e);
    console.warn('[char-store] sheet submit failed everywhere:', why);
    patchChar(charId, { sheetTask: null, sheetJob: null, sheetError: String(why || 'the sheet could not be submitted') });
    if (alertId && !gone()) ALERTS.fail(alertId, String(why || 'the sheet could not be submitted'), !(e && e.unsure) && _refusedEverywhere(e) ? { refused: true } : undefined);
  } finally {
    if (kick) _kicking.delete(kick);
  }
}

// THE KICKOFFS ALIVE IN THIS PROCESS, by the token their row carries (job.params.kick). A row written at
// the press has no task until its kickoff hands it one; the kickoff lives in memory, so after the app
// was closed in the middle of it nothing ever will - and the row would wait out its thirty minutes,
// holding the character's tile and the save form. A row with no task whose kickoff is not alive here
// is failed at once, with a reason; "try again" starts it from the saved face.
// The token is registered BEFORE the row is written: JOBS.submitted polls straight away.
const _kicking = new Set();
const _kickToken = () => 'k' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// The running sheet row of a character, if any - one sheet at a time per character: a second one
// would be paid for, and whichever landed second would overwrite the first.
function _runningSheet(charId, exceptId) {
  return ALERTS.list().find(r => r && r.state === 'running' && r.job && r.job.type === 'sheet'
    && String(((r.job.params || {}).charId) || '') === String(charId) && r.id !== exceptId) || null;
}

// THE ROW FOR A SHEET, written at the press (V2) - before the face is uploaded or anybody is asked. The
// page follows it by its id (the Library's creation, phase H); the runner (lib/gen-jobs.js) waits for
// the task once the kickoff hands it one. Without `where` nothing is journalled, as before.
// Answers { id, kick } - the row, and the token its kickoff registers under (see _kicking). Always a
// row: it is the only thing that resolves a sheet now (the Character page's own poll went in H8), so a
// request without a place to lead back to gets the Characters shelf.
const SHELF_WHERE = { page: 'library', href: '/library?shelf=characters', label: 'Library · Characters' };
function _openSheetRow(charId, where, name) {
  if (!where || typeof where !== 'object') where = SHELF_WHERE;
  const kick = _kickToken();
  _kicking.add(kick);
  try {
    // The character in the row's own spot: a finished sheet leads to it (js/alerts-bell.js).
    const spot = { ...((where && where.spot) || {}), key: String(charId) };
    const id = JOBS.submitted({
      kind: 'image', what: 'sheet',
      title: 'Sheet · ' + String(name || 'character').slice(0, 60),
      where: { ...where, spot }, stage: 'starting', taskIds: [],
      job: { type: 'sheet', params: { charId: String(charId), kick, request: { charId: String(charId) } } },
    }).id;
    return { id, kick };
  } catch (e) {
    _kicking.delete(kick);
    console.warn('[char-store] could not write the alert:', e.message);
    return { id: '', kick: '' };
  }
}

// A SHEET LET GO OF (the cross in Alerts): the character stops waiting - no task on the record, so no
// page reads it as still coming - and a picture that arrives for that task afterwards is not filed
// (_resolveSheet reads `sheetLetGo`). What was already asked for is paid for.
function _sheetLetGo(charId, taskId) {
  try {
    patchChar(charId, { sheetTask: null, sheetJob: null, sheetNote: null,
      sheetError: 'the sheet was let go of', sheetLetGo: taskId ? String(taskId) : null });
  } catch (e) { /* the character is gone */ }
}

// The fields a fresh submit writes. Kept in one place because the two callers - the background
// kickoff and Regenerate - must leave the record in exactly the same shape, or the poll-time
// fallback works after one of them and not the other.
function _sheetPatch(sub, prompt, imageUrl) {
  // Every STEP this run has finished with - the ones that refused AND the one that accepted
  // (phase V10.2: steps, not aggregators - two steps on one aggregator are two chances). The
  // poll-time half resumes at the step below them: the step that took the job is not a step to
  // hand the same job to again.
  const done = (sub.steps || []).filter(s => s.state !== 'skipped').map(s => String(s.label));
  return {
    sheetTask: sub.taskId,
    imageEngine: sub.engine,
    imageProvider: sub.provider,
    sheetQuality: sub.quality,
    sheetError: null,
    sheetNote: null,
    sheetJob: { engine: sub.engine, quality: sub.quality, prompt, imageUrl, tried: done.length ? done : [RUN.stepLabel(sub)] },
    sheetLetGo: null,
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
  const abs = path.join(PUBLIC_DIR, 'presets', 'sheets', m[1] + '.jpg');
  return fs.existsSync(abs) ? abs : '';
}

function _keepFace(folder, folderNm, buf, previous) {
  const ext  = /^\x89PNG/.test(buf.slice(0, 4).toString('latin1')) ? 'png' : 'jpg';
  const file = 'base_' + Date.now() + '.' + ext;
  fs.writeFileSync(path.join(folder, file), buf);
  const rel = '/media/characters/' + folderNm + '/' + file;
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
// Body: { name, gender, faceImagePath | faceImageBase64, figure, where }
// The active appearance image is the identity source for the combined
// reference-sheet generation. The sheet is the character's canonical asset;
// the face is kept beside it as `baseFace` so a failed sheet can always be
// regenerated from what made it.
router.post('/char-store/create', async (req, res) => {
  try {
    const { name, gender, faceImagePath, faceImageBase64, realismMarkers, figure } = req.body || {};
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

    const charId   = Date.now();
    const charName = (name && String(name).trim()) || 'Character';
    const folderNm = charFolderName(charName, charId);
    const folder   = path.join(CHARACTERS_DIR, folderNm);
    if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });   // the sheet lands here

    // An untouched preset already has its sheet. Copied into the character's own folder rather
    // than pointed at: from here on it belongs to this character, and deleting the character
    // must not reach back into the preset library.
    const readyAbs = _presetSheetFor(faceImagePath);
    let readySheet = null;
    if (readyAbs) {
      const file = 'sheet_' + Date.now() + '.jpg';
      fs.copyFileSync(readyAbs, path.join(folder, file));
      readySheet = '/media/characters/' + folderNm + '/' + file;
    }

    // The upload is NOT done here. It exists to give an engine a URL to fetch, the engine is
    // asked in the background, and verifying the link costs a read-back that turned this
    // request into thirty seconds of nothing on a bad host rotation. It moved into the
    // kickoff, where the waiting was always meant to happen.

    // Save the character immediately (sheet pending), and generate the combined reference sheet in
    // the BACKGROUND below, so a slow upload or a busy aggregator never blocks the save.
    const rec = {
      id:           charId,
      name:         charName,
      gender:       gender || null,
      folder:       folderNm,
      sheet:        readySheet,
      sheetTask:    null,
      // The face that is about to become the sheet, kept. If the sheet never arrives - a dead
      // engine, a throttle that outlasts the retries - this is what Regenerate works from, and
      // without it that button can only apologise.
      baseFace:     _keepFace(folder, folderNm, faceBuffer, null),
      // imageEngine / imageProvider / sheetQuality are written by _sheetPatch when the ladder
      // actually lands on a step. Guessing them here would put the step we HOPED for on the
      // record next to the taskId of the one that took it.
      // Cleared explicitly: upsert MERGES onto whatever is under this id, so a failure recorded
      // on the last attempt would otherwise still be sitting there while this one is in flight -
      // and the page reads that field to decide a wait is hopeless.
      sheetError:   null,
      voice:        null,
      notes:        '',
      voiceDescription: '',
      date:         new Date().toISOString(),
    };
    upsertChar(rec);
    // The row before the answer, so the page has it to follow from the first moment (V2).
    const row = readySheet ? { id: '', kick: '' } : _openSheetRow(charId, req.body && req.body.where, charName);
    const alertId = row.id;
    res.json({ success: true, char: rec, alertId });

    if (readySheet) {
      // Nothing to kick off, nothing to poll, nothing to pay for. The page's wait loop ends on
      // the record having a sheet, and it already has one.
      console.log('[char-store/create] took the preset sheet for', faceImagePath, '->', readySheet);
      return;
    }

    // Background: the combined sheet. Its Alerts row (opened above) is what the page follows;
    // lib/gen-jobs.js resolves the task into the character's folder.
    _kickoffSheets(charId, { buf: faceBuffer }, { realismMarkers, figure }, alertId, row.kick)
      .catch(e => console.warn('[char-store/create] sheet kickoff failed:', e.message));
  } catch (err) {
    console.error('[char-store/create]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// ── GET /api/char-store/list ─────────────────────────────────────────────
// Every character. A draft left in a library the one-time tidy-up has not reached yet is not one.
router.get('/char-store/list', (_req, res) => {
  res.json({ success: true, chars: loadChars().filter(c => !c.draft) });
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
// character was last made with. Answers the Alerts row the page follows.
router.post('/char-store/regen-ref', async (req, res) => {
  try {
    const { charId } = req.body || {};
    const c = findChar(charId);
    if (!c) return res.status(404).json({ success: false, error: 'char not found' });
    // One sheet at a time per character (review H): the one running is answered, for the page to follow.
    const busy = _runningSheet(charId);
    if (busy) return res.status(409).json({ success: false, running: true, alertId: busy.id, error: 'its 4K sheet is already being made' });
    const src = _identitySource(c, req.body);
    if (!src) {
      return res.status(404).json({ success: false,
        error: 'nothing to draw it from - this character has no sheet, no saved face and no files. Make it again with New Character on the Characters shelf.' });
    }
    console.log('[char-store/regen-ref]', charId, 'from', src.from);

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
    patchChar(charId, { sheetTask: null, sheetError: null, sheetNote: 'Preparing the sheet…', sheetLetGo: null });
    const row = _openSheetRow(charId, req.body && req.body.where, c.name);
    const alertId = row.id;
    res.json({
      success: true, pending: true, was: c.sheet || null, alertId,
      engine: first.engine || '', provider: first.provider || '', quality: first.quality || '',
      steps: ladder.length, from: src.from,
    });

    // With a sheet as the source the framing agent sees a whole body and says "preserve it",
    // which is exactly right: a regeneration should not reinvent the build the character already
    // has. From a face it says "build it like this" instead, the same as the first attempt did -
    // also right, because that IS a first attempt, just a second time.
    // The same kickoff the first attempt used - the same stages, the same row - so a regeneration and a
    // first sheet cannot drift apart.
    _kickoffSheets(charId, { buf: src.buf }, {
      realismMarkers: req.body && req.body.realismMarkers,
      figure: req.body && req.body.figure,
    }, alertId, row.kick).catch(e => console.warn('[char-store/regen-ref] sheet kickoff failed:', e.message));
  } catch (err) {
    console.error('[char-store/regen-ref]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// A sheet task that was accepted and then failed, handed to the next aggregator that has not been
// asked yet. Returns { taskId, note } if there was somewhere to go, { unsure } when the next one gave
// no answer and may have taken the money, or null once there is nowhere left.
//
// Nothing is recomputed: the prompt cost a call to the framing agent and the reference is already
// hosted, so sheetJob carries both. `tried` grows with each hop, which is what stops this from
// walking in a circle.
//
// PAID ONCE (V22): the aggregator being asked is written onto the record (`sheetJob.asking`) just
// before its create and taken off when it answers. Found there - the app was closed in the middle of
// it - the hop may have been paid for, and it is not asked for again.
// REFUSED ONLY WHEN EVERY STEP REFUSED (phase V10.2, the owner's answer 5a): a step whose model refuses the content hands
// the sheet on like any failure - another model is another moderation, and the refused task cost nothing - and the row
// is `refused` (no paid retry from Alerts) only when nothing is left and every step that answered said no to the
// content. `refusedAll` rides on sheetJob from hop to hop; the answer carries `refused` when nothing is left.
async function _retrySheetElsewhere(c, why) {
  const job = c && c.sheetJob;
  if (!job || !job.prompt || !job.imageUrl) return null;
  const refusedAll = job.refusedAll !== false && REFUSAL.isRefusal(why);
  const aggName = (a) => PROVIDER_LABELS[L.AGG_TO_MATRIX[a] || a] || String(a);
  if (job.asking) {
    const who = aggName(job.asking);
    return { unsure: 'the app was closed while the sheet was being asked for on ' + who
      + ' - it may have been paid for and not followed; look at ' + who + '\'s own history before asking again' };
  }
  const tried = Array.isArray(job.tried) ? job.tried : [];
  try {
    // Replicate takes the job and only discovers a minute later that it cannot read the
    // reference - "HTTPSConnectionPool(host='i.ibb.co') Read timed out" arrives as a FAILED
    // prediction, not as a refused submit. So the same rescue the submit path has belongs here:
    // upload the picture again, under a new key, before handing it to the next aggregator, or
    // the next one is being set up to fail the same way.
    let imageUrl = job.imageUrl;
    if (isFetchFailure({ message: String(why || '') })) {
      try { imageUrl = (await rehost([imageUrl]))[0] || imageUrl; }
      catch (e) { console.warn('[char-store] could not rehost the reference:', e.message); }
    }
    // The same ladder, resumed below the steps that have already had their turn. The prompt is
    // NOT rebuilt: it cost a call to the framing agent, and it describes the same person.
    const sub = await RUN.runImageLadder('sheet', {
      prompt: job.prompt, imageUrls: [imageUrl], aspect: '16:9', skip: tried,
      onAsk: (agg) => { try { patchChar(c.id, { sheetJob: { ...job, imageUrl, asking: agg } }); } catch (e) {} },
      onStep: ({ label, error, next }) => {
        try {
          patchChar(c.id, { sheetJob: { ...job, imageUrl, asking: null }, sheetNote: label + ' could not: '
            + String(error).slice(0, 160) + (next ? ' — trying ' + next + '…' : '') });
        } catch (e) {}
      },
    });
    const note = (tried[tried.length - 1] || 'the last step') + ' failed: ' + String(why).slice(0, 120)
      + ' — retrying on ' + sub.provider + '…';
    const done = (sub.steps || []).filter(s => s.state !== 'skipped').map(s => String(s.label));
    patchChar(c.id, {
      sheetTask: sub.taskId, imageProvider: sub.provider, imageEngine: sub.engine, sheetNote: note,
      // imageUrl too: it may have moved host on the way here, and the NEXT hop should start from
      // where this one actually got to.
      sheetJob: { ...job, imageUrl, tried: tried.concat(done.length ? done : [RUN.stepLabel(sub)]),
        refusedAll: refusedAll && _allRefused(sub) },
    });
    console.log('[char-store] sheet failed on', tried.join(', '), '- retrying on', sub.provider);
    return { taskId: sub.taskId, note };
  } catch (e) {
    if (e && e.unsure) return { unsure: reasonOf(e) };
    console.warn('[char-store] nowhere left to retry the sheet:', reasonOf(e));
    return { refused: refusedAll && _allRefused(e) };
  }
}

// Every step that ANSWERED in a walk of the ladder refused the content (a step skipped for a dead key did not answer). A
// walk with no failed step - the one that took the job - says nothing against it.
function _allRefused(walk) {
  const failed = ((walk && walk.steps) || []).filter(s => s.state === 'failed');
  return failed.every(s => REFUSAL.isRefusal(s.detail));
}
// The first walk failed: `refused` only when some step answered and every one that did refused the content.
function _refusedEverywhere(e) {
  const failed = ((e && e.steps) || []).filter(s => s.state === 'failed');
  return failed.length > 0 && failed.every(s => REFUSAL.isRefusal(s.detail));
}

// RESOLVING ONE SHEET, whoever is asking: the page that is watching it, or the server's own
// runner (lib/gen-jobs.js) for somebody who has closed it. Everything that used to happen only
// while the page polled - filing the picture into the character's folder, patching the record, and
// the walk to the next aggregator when a task is accepted and then fails - happens here, so it
// happens either way.
async function _resolveSheet(taskId, charId, kind) {
  const field = (kind === 'tpose') ? 'tpose' : (kind === 'portrait') ? 'portrait' : 'sheet';
  const c = charId ? findChar(charId) : null;
  if (!c) throw Object.assign(new Error('char not found'), { status: 404 });

  // Let go of (the cross in Alerts): whatever this task brings is not filed onto the character.
  const letGo = (rec) => field === 'sheet' && rec && rec.sheetLetGo && String(rec.sheetLetGo) === String(taskId);
  if (letGo(c)) return { state: 'failed', error: 'the sheet was let go of' };

  const folder = charAbsFolderRec(c);
  if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });

  const result = await resolveTask(taskId, folder, field);
  // Read again after the wait: a cancel that landed meanwhile, or a character deleted meanwhile.
  const now = findChar(charId);
  if (!now) return { state: 'failed', error: 'the character was deleted' };
  if (letGo(now)) return { state: 'failed', error: 'the sheet was let go of' };
  if (result.state === 'success') {
    patchChar(charId, {
      [field]: result.imagePath, [field + 'Task']: null, sheetError: null, sheetNote: null, sheetJob: null,
    });
  } else if (result.state === 'failed') {
    // A task can be accepted and fail LATER - ModelRateLimitError arrives a minute after the
    // submit was taken happily. That failure is exactly as recoverable as one at submit time,
    // and the caller is still sitting here waiting, so it is retried on the next aggregator
    // rather than reported. sheetJob carries everything needed for that: the same prompt, the
    // same reference, and who has already been asked.
    const next = (field === 'sheet') ? await _retrySheetElsewhere(c, result.error) : null;
    if (next && next.taskId) return { state: 'pending', taskId: next.taskId, note: next.note };
    // Refused: every step said no to the content (a sheet asked for before V10.2, or a T-pose, by its own words).
    const refused = next && !next.unsure && next.refused !== undefined ? !!next.refused : REFUSAL.isRefusal(result.error);
    // The next aggregator gave no answer (V22): it may have started the sheet - said so, not the
    // first task's error.
    const why = (next && next.unsure) || result.error || 'the generation failed';

    // Kept on the record as well as answered here: whoever opens this character next deserves
    // to know why it has no sheet, not just that it has none.
    patchChar(charId, {
      [field + 'Task']: null, sheetJob: null,
      sheetError: String(why),
    });
    if (next && next.unsure) return { state: 'failed', error: next.unsure, refused: false };
    return { ...result, refused };
  }
  return result;
}

// ── Alerts ──────────────────────────────────────────────────────────────────
// A sheet is the picture every frame of every ad is later built from, and it takes minutes. The
// row in the journal is what makes it safe to walk away from (docs/local-app/PLAN.md, "Alerts").
const JOBS = require('../lib/gen-jobs');
const ALERTS = require('../lib/alerts');

// PAID ONCE (V22): a row with no task whose kickoff is not alive here and that is marked `asked` was
// closed on in the middle of a create - it may have been paid for, and it says so instead of "try again".
const SHEET_MAYBE_PAID = 'the app was closed while the sheet was being asked for - it may have been paid for and not followed; look at the aggregator\'s own history before asking again';

JOBS.register('sheet', {
  timeoutMs: 30 * 60 * 1000,
  // The row is written at the press, before anything is uploaded (_openSheetRow): until the kickoff
  // hands it a task it is "not started", not a failure.
  poll: (rec) => {
    const p = (rec.job || {}).params || {};
    if (rec.taskIds[0]) return _resolveSheet(rec.taskIds[0], p.charId, 'sheet');
    if (_kicking.has(p.kick)) return { state: 'pending' };
    return { state: 'failed', error: p.asked ? SHEET_MAYBE_PAID : 'the app was closed before the sheet was asked for - try again' };
  },
  file: async (_rec, out) => ({ path: out.imagePath, media: 'image' }),
  // Let go of in Alerts: the character stops waiting for this sheet (lib/gen-jobs.js cancelled).
  cancel: (rec) => _sheetLetGo(((rec.job || {}).params || {}).charId, rec.taskIds[0] || ''),
  // Its kickoff is still going on (a row let go of while the face was uploading or the ladder was
  // answering): asked again now, two sheets would be paid for and race for one row.
  busy: (rec) => _kicking.has((((rec.job || {}).params || {}).kick) || ''),
  // Asked for again from Alerts. A row written at the press carries the character in `request`; an
  // older one only in `params`, which retry() does not hand over - so both are read. The same prompt and
  // reference when the record still has them; otherwise from the character's own picture, the way a
  // regeneration starts, because a sheet that failed has had its job cleared. What can refuse is checked
  // here; then the row runs again at once with no task, on a kick of its own, and the kickoff goes on
  // behind it as on the first press - the same stages, the same `asked` mark (V22).
  submit: async (request, rec) => {
    const id = String((request || {}).charId || ((rec && rec.job && rec.job.params) || {}).charId || '');
    const c = findChar(id);
    if (!c) throw new Error('that character is gone');
    if (_runningSheet(id, rec && rec.id)) throw new Error('another 4K sheet for this character is being made - wait for it, or let it go first');
    const job = c.sheetJob;
    const src = (job && job.prompt && job.imageUrl) ? { prompt: job.prompt, imageUrl: job.imageUrl } : _identitySource(c, {});
    if (!src) throw new Error('nothing to draw it from - this character has no sheet, no saved face and no files');
    const kick = _kickToken();
    _kicking.add(kick);
    patchChar(c.id, { sheetError: null, sheetNote: 'Preparing the sheet…', sheetLetGo: null });
    return {
      stage: 'starting',
      params: { charId: String(c.id), kick, asked: false, request: { charId: String(c.id) } },
      later: () => _kickoffSheets(c.id, src, { figure: c.figure || '' }, rec.id, kick),
    };
  },
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
const _DATA_DIR        = DATA_DIR;
const _OBRAZY_FILE     = path.join(_DATA_DIR, 'obrazy.json');
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
async function _releaseCharVoices(char) {
  if (!char) return [];
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
    const voiceId = ref;
    const matches = (v) => v && String(v) === ref;

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
  // Not while its 4K sheet is being made (phase H6): the wait would be left with nothing to file into.
  // Let the sheet go in Alerts first, or wait for it.
  const busy = _runningSheet(req.params.id);
  if (busy) return res.status(409).json({ success: false, error: 'its 4K sheet is being made - wait for it, or let it go in Alerts first' });
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
