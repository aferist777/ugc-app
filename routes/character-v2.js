'use strict';

// CHARACTER v2 — generating from a reference.
//
// Two steps, deliberately two requests. The analyzer runs first and can REFUSE, and a refusal
// should cost nothing: no engine call, no image, no wait. It also lets the page say "Analyzing"
// and then "Generating" instead of one long silence.
//
//   POST /api/character-v2/analyze    reference + the user's text -> prompt material, or a refusal
//   POST /api/character-v2/generate   a ready prompt + the reference -> an i2i task
//   GET  /api/character-v2/engines    which engines, tiers and aggregators exist, from one place
//
// The page assembles the final prompt between the two calls. That is on purpose: the house
// template (framing, backdrop, wardrobe, realism) already lives in the page's presets.js and is
// what Create sends, so building the reference prompt from the same module keeps one definition
// of the house look instead of a server-side copy that drifts.
//
// Which engine draws it and which aggregator is asked are two separate choices, because they
// fail separately: the day google/nano-banana-2 answered ModelRateLimitError on Replicate, the
// same model answered with an image through OpenRouter. lib/img-providers.js holds that matrix.

const express = require('express');
const router = express.Router();
const fs = require('fs');

const { MEDIA } = require('../lib/config');
const {
  uploadToPublicHost, callAIVisionWithFallback, parseLooseJson, resolveLocalMedia,
} = require('../lib/helpers');
const { reasonOf } = require('../lib/img-providers');
const L = require('../lib/cv2-ladders');
const RUN = require('../lib/cv2-run');
const TRACE = require('../lib/cv2-trace');
const REC = require('../lib/cv2-recovered');
const WATCH = require('../lib/cv2-watch');
const { getPrompt } = require('../lib/prompts');
const { addPendingTask } = require('../lib/pending-tasks');

// Only the two the flow has a meaning for: 3:2 builds the house format, and match_input_image
// edits a photo where it stands. Anything else would be a request the design cannot honour, so
// it is refused rather than quietly mapped.
const ASPECTS = ['3:2', 'match_input_image'];

// A reference has to become a URL: the vision model and the image engines both fetch one, and
// this machine is unreachable to their fetchers - so every reference goes up to R2 first
// (uploadToPublicHost), whether it arrived as base64 or is a file in the library.
async function _refUrl(body) {
  if (body.imageUrl && /^https?:\/\//i.test(String(body.imageUrl))) return String(body.imageUrl);
  let buf = null;
  if (body.imageBase64) {
    buf = Buffer.from(String(body.imageBase64).replace(/^data:image\/[\w+.-]+;base64,/, ''), 'base64');
    if (!buf.length) throw new Error('imageBase64 is empty');
  } else if (body.imagePath) {
    // Both roots: presets are static assets under public/, everything else is at the top.
    const abs = resolveLocalMedia(body.imagePath);
    if (!abs) throw new Error('reference image not found: ' + body.imagePath);
    buf = fs.readFileSync(abs);
  } else {
    throw new Error('no reference image was sent');
  }
  // verify reads the link back before it is handed to an engine. One round trip against a
  // generation that fails ten seconds after being paid for.
  return await uploadToPublicHost(buf, { verify: true });
}

// ── The ladders ──────────────────────────────────────────────────────────────
// GET  /api/character-v2/ladders        what is stored, repaired against what exists,
//                                       plus the options a picker can offer
// POST /api/character-v2/ladders        { op, steps } - one operation at a time
//
// Repaired on the way OUT rather than validated on the way in, because the matrix can
// change under a stored ladder: an engine dropped from an aggregator turns a saved
// choice into a 422 nobody caused. Reading is where that gets noticed.
router.get('/character-v2/ladders', (_req, res) => {
  try {
    const options = {};
    const pairs = {};
    for (const op of Object.keys(L.OPS)) { options[op] = L.optionsFor(op); pairs[op] = L.pairCount(op); }
    res.json({ success: true, ladders: L.getLadders(), options, pairs, max: L.MAX_STEPS });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/character-v2/ladders', (req, res) => {
  try {
    const op = String((req.body && req.body.op) || '');
    if (!L.OPS[op]) return res.status(400).json({ success: false, error: 'unknown operation: ' + op });
    // What comes back is what was STORED, not what was sent: a step that could not be
    // repaired is gone, and the page should redraw from the truth rather than from its
    // own optimism.
    const saved = L.setLadder(op, (req.body && req.body.steps) || []);
    console.log('[cv2/ladders]', op, '->', saved.map(s => s.provider + '/' + (s.engine || s.model)).join(' > '));
    res.json({ success: true, op, steps: saved });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ── Recovery ─────────────────────────────────────────────────────────────────
// POST /api/character-v2/recover      run the net, file anything this page can place
// GET  /api/character-v2/recovered    what is waiting to be put on screen
// POST /api/character-v2/recovered/:id/done   it has been placed, forget it
//
// The page calls recover on load. It used to be that nothing on Character ever did - the
// recovery endpoint is called by tabs.js, which belongs to the older pages - so a generation
// abandoned by closing the tab waited for the next SERVER restart to be collected.
router.post('/character-v2/recover', async (_req, res) => {
  try {
    const { resolveAll } = require('../lib/pending-tasks');
    const items = await resolveAll();
    const added = REC.note(items, new Date().toISOString());
    if (added.length) console.log('[cv2/recover] rescued', added.length, 'item(s) for this page');
    res.json({ success: true, checked: items.length, added: added.length, waiting: REC.list() });
  } catch (err) {
    // Never fatal: recovery is a bonus on top of a page that works without it.
    res.status(200).json({ success: false, error: err.message, waiting: REC.list() });
  }
});

router.get('/character-v2/recovered', (_req, res) => {
  res.json({ success: true, waiting: REC.list() });
});

router.post('/character-v2/recovered/:id/done', (req, res) => {
  const n = REC.drop(String(req.params.id || ''));
  res.json({ success: true, dropped: n });
});

// ── GET /api/character-v2/trace ──────────────────────────────────────────────
// The tree: runs newest first, each grouped by the button that started it, with the calls
// under it and repeats collapsed. NO bodies - a list of forty calls should not carry a
// megabyte of prompts nobody has asked to read. One call's payload comes from /trace/:id.
router.get('/character-v2/trace', (req, res) => {
  try {
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 40));
    res.json({ success: true, runs: TRACE.tree({ limit }), ring: TRACE.RING });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/character-v2/trace/:id ──────────────────────────────────────────
// One call, whole: request and response, headers and body, exactly as they were written -
// which is to say already redacted and already scrubbed, because that happened before this
// ever reached the disk.
router.get('/character-v2/trace/:id', (req, res) => {
  const rec = TRACE.byId(String(req.params.id || ''));
  if (!rec) {
    // Named rather than a bare 404: the ring is finite, and "it scrolled off" is a
    // different problem from "that id never existed".
    return res.status(404).json({ success: false,
      error: 'that call is no longer in memory - only the last ' + TRACE.RING + ' are kept' });
  }
  res.json({ success: true, call: rec });
});

// ── POST /api/character-v2/analyze ───────────────────────────────────────────
// Body: { imageUrl | imageBase64 | imagePath, text }
// -> { ok: true,  who, change, imageUrl }   prompt material, the change folded into `who`
// -> { ok: false, reason, imageUrl }        the request was outside what this step may do
//
// imageUrl comes back either way so the generate call reuses the upload instead of paying for
// it twice. The user's text never reaches the generator: only what the analyzer made of it.
router.post('/character-v2/analyze', async (req, res) => {
  try {
    const b = req.body || {};
    const text = String(b.text || '').trim();
    const imageUrl = await _refUrl(b);

    const prompt = String(getPrompt('CV2_APPEARANCE_PROMPT') || '').replace(/\{USER_TEXT\}/g, text);
    const raw = await callAIVisionWithFallback([{
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: imageUrl } },
      ],
    }], { timeout: 45000, ladder: L.getLadder('vision') });

    const j = parseLooseJson(raw);
    if (!j || typeof j !== 'object') {
      console.warn('[cv2/analyze] unparsable answer:', String(raw || '').slice(0, 200));
      throw new Error('the analyzer did not answer with JSON');
    }
    if (j.ok === false) {
      const reason = String(j.reason || '').trim() || 'That change cannot be applied to this image.';
      console.log('[cv2/analyze] refused:', reason);
      return res.json({ success: true, ok: false, reason, imageUrl });
    }
    const who = String(j.who || '').trim();
    if (!who) throw new Error('the analyzer returned no description');
    const change = String(j.change || '').trim();
    console.log('[cv2/analyze] who:', who.slice(0, 120), change ? ('| change: ' + change) : '| no change asked');
    res.json({ success: true, ok: true, who, change, imageUrl });
  } catch (err) {
    console.error('[cv2/analyze]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: reasonOf(err) });
  }
});

// ── POST /api/character-v2/generate ──────────────────────────────────────────
// Body: { prompt, engine?, quality?, aspect?, and optionally imageUrl | imageBase64 | imagePath }
// -> { taskId }, which the page polls through the shared GET /api/status/:taskId
//
// One route for both directions of the page: a reference makes it an edit, no reference makes it
// a text-to-image. Both live here rather than in the older character-creator route because that
// one hands every engine a fixed 9:16 - correct for the page it was written for, and the exact
// opposite of what this one needs.
router.post('/character-v2/generate', async (req, res) => {
  try {
    const b = req.body || {};
    const prompt = String(b.prompt || '').trim();
    if (!prompt) return res.status(400).json({ success: false, error: 'prompt is required' });

    const hasRef = !!(b.imageUrl || b.imageBase64 || b.imagePath);
    const dir = hasRef ? 'i2i' : 't2i';
    // With no reference there is nothing to match, so the only aspect that means anything is the
    // house 3:2.
    const aspect = (hasRef && ASPECTS.includes(b.aspect)) ? b.aspect : '3:2';

    // The ladder decides, not the request. Which pairing to try, in what order, and what
    // to do when one refuses is this page's own setting now - the body's engine/provider
    // are ignored on purpose, and the gear that used to send them goes with the popup
    // that replaces it.
    const sub = await RUN.runImageLadder(hasRef ? 'reference' : 'create', {
      prompt,
      imageUrls: hasRef ? [await _refUrl(b)] : [],
      aspect,
    });

    // Same bucket either way, so the page's one polling path resolves both.
    addPendingTask(sub.taskId, 'work', 'generated', hasRef ? 'cv2-reference' : 'cv2-create');
    // And the server watches it to the end itself. The page's poll used to be the only thing
    // driving this to a conclusion, which meant closing the tab abandoned a paid-for
    // generation. Now the page's poll only READS what the watcher already found.
    WATCH.watch(sub.taskId, MEDIA.work, 'generated');
    console.log('[cv2/generate]', dir, sub.engine, '@' + sub.provider, sub.quality, aspect, '| prompt:', prompt.slice(0, 120));
    res.json({
      success: true, taskId: sub.taskId, engine: sub.engine, provider: sub.provider,
      quality: sub.quality, aspect,
      // Which step answered, so the page can say "Replicate refused, OpenRouter drew it"
      // rather than reporting a result with no history.
      steps: sub.steps,
    });
  } catch (err) {
    // reasonOf digs the provider's own wording out of whichever envelope it used -
    // Replicate puts it in data.detail, kie in data.msg, OpenRouter in data.error.message.
    // Without it the page showed axios's "Request failed with status code 400", which
    // names the status and nothing else, and a 400 you cannot read is a 400 you cannot fix.
    console.error('[cv2/generate]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: reasonOf(err) });
  }
});

module.exports = router;
