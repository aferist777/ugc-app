'use strict';

// Music for the timeline: Suno tracks made through kie.ai, and the small library of the ones kept.
//
//   POST   /api/audio/suno/generate          { style, title, where, ... } -> { taskId, alertId }
//   GET    /api/audio/suno/library           { list }
//   DELETE /api/audio/suno/library/:id
//
// TWO TRACKS PER GENERATION (phase V23, the owner 2026-10-09): Suno makes two variants at once, and both are kept -
// two files, `suno_<task>_1.mp3` and `_2.mp3`, and two records side by side, "<title> · 1" and "<title> · 2", with
// the generation (`gen`) and the variant (`variant`) on them. Merge's music panel lays the other variant after the
// one chosen when that one is shorter than the video, crossing into it over three seconds (merge-v3/music.js).
// Only the server writes them: the panel follows the generation's Alerts row (lib/gen-jobs.js) and reads the list.
// Older generations were joined into one file; their variants were not kept apart, and they stay as they are.
//
// The addresses keep their /audio/ prefix: Merge's music lane and the Library's music shelf call
// them. Everything else the old routes/audio.js held - voices and voice design, TTS, avatars,
// speech-to-text, sound effects and the Birols pipeline - went with the pages that used it.

const express    = require('express');
const path       = require('path');
const fs         = require('fs');
const axios      = require('axios');
const { writeFileAtomic } = require('../lib/atomic-write');
const { KIE_BASE, MEDIA, DATA_DIR } = require('../lib/config');
const REFUSAL = require('../lib/gen-refusal');
const { kieHeaders } = require('../lib/helpers');

const router = express.Router();

// ── Suno music library ────────────────────────────────────────────────────────
const SUNO_LIB_FILE = path.join(DATA_DIR, 'suno-lib.json');
function _loadSunoLib() {
  try { return JSON.parse(fs.readFileSync(SUNO_LIB_FILE, 'utf8')); } catch { return []; }
}
function _saveSunoLib(list) {
  try { writeFileAtomic(SUNO_LIB_FILE, JSON.stringify(list, null, 2)); } catch {}
}

// ONE RECORD PER FILE (phase V23). Until then the music panel wrote a second record of every track the server had
// filed already (`suno_<time>` beside `suno_<task>`): the one named after its file stays, the others go. At start.
function _dedupeSunoLib() {
  const list = _loadSunoLib();
  if (!Array.isArray(list) || !list.length) return 0;
  const stem = (p) => String(p || '').split('/').pop().replace(/\.[^.]+$/, '');
  const best = new Map();
  for (const t of list) {
    if (!t || !t.audioPath) continue;
    const was = best.get(t.audioPath);
    if (!was || (t.id === stem(t.audioPath) && was.id !== stem(was.audioPath))) best.set(t.audioPath, t);
  }
  const keep = list.filter(t => !t || !t.audioPath || best.get(t.audioPath) === t);
  if (keep.length === list.length) return 0;
  _saveSunoLib(keep);
  console.log('[music] ' + (list.length - keep.length) + ' second record(s) of the same track removed');
  return list.length - keep.length;
}
try { _dedupeSunoLib(); } catch (e) { console.warn('[music] the music list was not tidied:', e.message); }

// POST /api/audio/suno/generate
// Body: { style, title, negativeTags, styleWeight, weirdnessConstraint, model, targetDuration }
// targetDuration (sec) is informational — Suno V4/V5 in customMode always generates two
// ~1:30-2:30 variants per request, kept as two tracks (above).
// WHERE kie IS TOLD TO REPORT. kie's Suno endpoint used here (/api/v1/generate, docs.kie.ai/old-model/suno-api/
// generate-music) REQUIRES a callback address, and kie POSTs every finished task to it - the track links, the
// title, the style. This app never reads a callback (the task is polled, the status route below and
// lib/gen-jobs.js), so the address must be one that can never be reached: the .invalid top-level domain is
// reserved for exactly that (RFC 2606, RFC 6761) and never resolves. It used to be https://example.com/callback,
// which handed each finished task to a server nobody here owns.
const NO_CALLBACK = 'https://callback.invalid/kie-suno';

// The asking itself, as a function: the server asks again when somebody presses retry in the
// Alerts list, and that has to be the same request.
async function _submitSuno(b) {
  const { style, title, negativeTags, styleWeight, weirdnessConstraint, model = 'V4_5PLUS', targetDuration } = b || {};
  if (!style) throw Object.assign(new Error('a style is needed'), { status: 400 });
  const BG_SUFFIX = ', background music for UGC short video, non-intrusive, subtle energy, no lyrics';
  const fullStyle = (style + BG_SUFFIX).slice(0, 1000);
  if (targetDuration) console.log(`[audio/suno/generate] target ${targetDuration}s - two variants come back, both kept`);
  const taskRes = await axios.post(
      `${KIE_BASE}/api/v1/generate`,
      {
        prompt: '',
        customMode: true,
        instrumental: true,
        model,
        style: fullStyle,
        title: (title || 'UGC Background').slice(0, 80),
        negativeTags: negativeTags || 'vocals, lyrics, metal, aggressive, heavy, noise',
        styleWeight:         styleWeight         ?? 0.7,
        weirdnessConstraint: weirdnessConstraint ?? 0.3,
        callBackUrl: NO_CALLBACK,
      },
      { headers: kieHeaders(), timeout: 30000 }
    );
  const taskId = taskRes.data?.data?.taskId || taskRes.data?.taskId;
  // kie refuses inside a 200 ({ code, msg }): its words, not a bare "no taskId" - so a refusal of the address
  // above, which costs nothing, says what it is about the moment it happens.
  if (!taskId) {
    const said = String(taskRes.data?.msg || '').slice(0, 200);
    throw Object.assign(new Error('kie.ai did not start the music' + (said ? ': ' + said : '')
      + (/call ?back/i.test(said) ? ' (the app gives kie an address that never resolves, so finished tracks are not reported to anybody)' : '')), { status: 502 });
  }
  return taskId;
}

router.post('/audio/suno/generate', async (req, res) => {
  const b = req.body || {};
  try {
    const taskId = await _submitSuno(b);
    // FROM MERGE: a row in the journal, and the server sees it through and files the track.
    let alertId = '';
    if (b.where) {
      try {
        alertId = JOBS.submitted({
          kind: 'music', what: 'music',
          title: 'Music · ' + String(b.title || b.style || '').replace(/\s+/g, ' ').trim().slice(0, 60),
          where: b.where, engine: String(b.model || 'V4_5PLUS'), taskIds: [taskId],
          job: { type: 'music', params: { request: { ...b, where: null } } },
        }).id;
      } catch (e) { console.warn('[audio/suno/generate] could not write the alert:', e.message); }
    }
    res.json({ success: true, taskId, alertId });
  } catch (err) {
    console.error('[audio/suno/generate]', err.response?.data || err.message);
    res.status(err.status || 502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// WHERE THE ANSWER ABOUT ONE GENERATION COMES FROM: the server's runner (lib/gen-jobs.js) asks every few seconds.
// Each variant is downloaded once, under the task's name - asked again, the files already there are the answer.
async function _fetchVariant(url, name) {
  const dest = path.join(MEDIA.audio, name);
  if (!fs.existsSync(dest)) {
    const r = await axios({ url, method: 'GET', responseType: 'arraybuffer', timeout: 90000 });
    // Written beside and renamed: a download cut off half way must not look like a track.
    const part = dest + '.part';
    fs.writeFileSync(part, Buffer.from(r.data));
    fs.renameSync(part, dest);
  }
  return '/media/audio/' + name;
}

async function _pollSuno(taskId) {
  const statusRes = await axios.get(
    `${KIE_BASE}/api/v1/generate/record-info`,
    { params: { taskId }, headers: kieHeaders(), timeout: 15000 }
  );
  const data   = statusRes.data?.data;
  const status = data?.status;  // PENDING | TEXT_SUCCESS | FIRST_SUCCESS | SUCCESS | *_FAILED
  const FAILED = ['CREATE_TASK_FAILED', 'GENERATE_AUDIO_FAILED', 'SENSITIVE_WORD_ERROR', 'CALLBACK_EXCEPTION'];

  // Only once BOTH variants are ready: Suno fills sunoData[0] at FIRST_SUCCESS and sunoData[1] later, at SUCCESS.
  if (status === 'SUCCESS') {
    const urls = (data?.response?.sunoData || []).map(x => x && x.audioUrl).filter(Boolean).slice(0, 2);
    if (!urls.length) return { state: 'pending' };
    // One variant alone (rare) is kept alone.
    const variants = [];
    for (let i = 0; i < urls.length; i++) variants.push(await _fetchVariant(urls[i], `suno_${taskId}_${i + 1}.mp3`));
    return { state: 'success', audioPath: variants[0], variants };
  }
  // A refusal of the words (SENSITIVE_WORD_ERROR) is answered the same every time: no paid retry (lib/gen-refusal.js).
  if (FAILED.includes(status)) {
    const error = data?.errorMessage || status;
    return { state: 'failed', error, refused: REFUSAL.isRefusal(status + ' ' + error) };
  }
  // FIRST_SUCCESS = first variant ready, second still cooking — keep polling
  return { state: 'pending', stage: status === 'FIRST_SUCCESS' ? 'the first variant is in, waiting for the second' : '' };
}

// ── Alerts ──────────────────────────────────────────────────────────────────
// A track asked for in Merge is a row in the journal, and the server sees it through: five
// minutes is long enough to walk away from, and the link Suno hands back does not wait
// (docs/local-app/PLAN.md, "Alerts"). Unlike a clip, a finished track IS filed - the music shelf
// is where it belongs, and there is nothing to choose between.
const JOBS = require('../lib/gen-jobs');

JOBS.register('music', {
  timeoutMs: 30 * 60 * 1000,
  poll: (rec) => _pollSuno(rec.taskIds[0]),
  file: async (rec, out) => {
    const r = ((rec.job || {}).params || {}).request || {};
    const gen = String(rec.taskIds[0]);
    const title = String(r.title || 'UGC Background').slice(0, 80);
    const variants = (out.variants && out.variants.length) ? out.variants : [out.audioPath];
    const lib = _loadSunoLib();
    const now = new Date().toISOString();
    // The two side by side, the first on top - the list is newest first.
    const add = variants.map((audioPath, i) => ({
      id: 'suno_' + gen + '_' + (i + 1), title: variants.length > 1 ? title + ' · ' + (i + 1) : title, audioPath,
      style: String(r.style || ''), createdAt: now, gen, variant: i + 1,
    })).filter(t => !lib.some(x => x && (x.id === t.id || x.audioPath === t.audioPath)));
    if (add.length) { lib.unshift(...add); _saveSunoLib(lib); }
    return { path: variants[0], media: 'audio', title, variants };
  },
  submit: async (request) => ({ taskId: await _submitSuno(request || {}) }),
});


// GET /api/audio/suno/library
router.get('/audio/suno/library', (_req, res) => res.json({ success: true, list: _loadSunoLib() }));

// DELETE /api/audio/suno/library/:id
router.delete('/audio/suno/library/:id', (req, res) => {
  _saveSunoLib(_loadSunoLib().filter(t => t.id !== req.params.id));
  res.json({ success: true });
});

module.exports = router;
