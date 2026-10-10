'use strict';

// MAKING A CHARACTER'S PORTRAIT - behind New Character on the Library's Characters shelf
// (public/js/library/chmake.js; the Character page that used these went in phase H8).
//
// Two steps, deliberately two requests. The analyzer runs first and can REFUSE, and a refusal
// should cost nothing: no engine call, no image, no wait. It also lets the page say "Reading"
// and then "Drawing" instead of one long silence.
//
//   POST /api/character-v2/analyze    reference + the user's text -> prompt material, or a refusal
//   POST /api/character-v2/generate   a ready prompt (+ the reference) -> a task, and its Alerts row
//
// The page assembles the final prompt between the two calls. That is on purpose: the house
// template (framing, backdrop, wardrobe, realism) already lives in public/js/library/character/
// presets.js and is what Create sends, so building the reference prompt from the same module keeps
// one definition of the house look instead of a server-side copy that drifts.
//
// Which engine draws it and which aggregator is asked are two separate choices, because they
// fail separately: the day google/nano-banana-2 answered ModelRateLimitError on Replicate, the
// same model answered with an image through OpenRouter. lib/img-providers.js holds that matrix.

const express = require('express');
const router = express.Router();
const fs = require('fs');

const { MEDIA, CV2_APPEARANCE_PROMPT } = require('../lib/config');
const {
  uploadToPublicHost, callAIVisionWithFallback, parseLooseJson, resolveLocalMedia, resolveTask,
} = require('../lib/helpers');
const { reasonOf } = require('../lib/img-providers');
const L = require('../lib/cv2-ladders');
const RUN = require('../lib/cv2-run');
const WATCH = require('../lib/cv2-watch');

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
  // In a format the engines take (phase V24, lib/image-in.js): a photo brought in as AVIF, GIF or a
  // phone's HEIC went up as it was. verify reads the link back before it is handed to an engine -
  // one round trip against a generation that fails ten seconds after being paid for.
  const pic = await require('../lib/image-in').sendable(buf);
  return await uploadToPublicHost(pic.buf, { verify: true, ext: pic.ext });
}

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

    const prompt = String(CV2_APPEARANCE_PROMPT || '').replace(/\{USER_TEXT\}/g, text);
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

// ── Alerts ──────────────────────────────────────────────────────────────────
// A portrait is watched by the server already (lib/cv2-watch.js). The job reads that answer, and
// falls back to resolving the task itself - which is what the watcher cannot do after a restart,
// because its loop lives in memory and the row does not.
const JOBS = require('../lib/gen-jobs');
const ALERTS = require('../lib/alerts');
const REFUSAL = require('../lib/gen-refusal');

// PAID ONCE (phase V22, the owner 2026-10-09: "as in the chats"). The row is marked `asked` just before each
// create that costs money and the mark is taken back when the aggregator ANSWERS no (lib/cv2-run.js `onAsk` /
// `onStep`); a create with no answer stops the ladder. A row found with no task, `asked`, and its asking not alive
// here - the app was closed in the middle of it - may have been paid for: it says so, and nothing asks again by itself.
const NOT_ASKED = 'the app was closed before the portrait was asked for - try again';
const MAYBE_PAID = 'the app was closed while the portrait was being asked for - it may have been paid for and not followed; look at the aggregator\'s own history before asking again';

JOBS.register('portrait', {
  timeoutMs: 20 * 60 * 1000,
  poll: async (rec) => {
    // Written at the press, before the ladder has answered: no task yet is "not started" - while the
    // asking is alive in this process. A row the app was closed on in the middle of it gets no task ever.
    if (!rec.taskIds[0]) {
      const p = (rec.job || {}).params || {};
      if (_asking.has(p.kick)) return { state: 'pending' };
      return { state: 'failed', error: p.asked ? MAYBE_PAID : NOT_ASKED };
    }
    const seen = WATCH.peek(rec.taskIds[0]);
    if (seen && seen.state === 'success') return { state: 'success', imagePath: seen.imagePath };
    if (seen && (seen.state === 'failed' || seen.state === 'gaveup')) {
      return { state: 'failed', error: seen.error || 'it did not come' };
    }
    return await resolveTask(rec.taskIds[0], MEDIA.work, 'generated');
  },
  file: async (_rec, out) => ({ path: out.imagePath, media: 'image' }),
  // Its asking is still going on (a row let go of while the ladder was answering): asked again now, two
  // tasks would race for one row.
  busy: (rec) => _asking.has((((rec.job || {}).params || {}).kick) || ''),
  // Asked for again from Alerts: the row runs again at once with no task, on a kick of its own, and the asking
  // goes on behind it as on the first press - marked `asked` and stopped on no answer the same way.
  submit: async (request, row) => {
    const b = { ...(request || {}) };
    if (!String(b.prompt || '').trim()) throw new Error('prompt is required');
    const kick = _kickToken();
    _asking.add(kick);
    return { stage: 'asking the engine', params: { kick, asked: false }, later: () => _askBehind(row.id, kick, b) };
  },
});

// ── POST /api/character-v2/generate ──────────────────────────────────────────
// Body: { prompt, aspect?, where, and optionally imageUrl | imageBase64 | imagePath }
// -> { taskId, alertId }: the page follows the Alerts row (lib/gen-jobs.js files the portrait)
//
// One route for both directions of the page: a reference makes it an edit, no reference makes it
// a text-to-image. Both live here rather than in the older character-creator route because that
// one hands every engine a fixed 9:16 - correct for the page it was written for, and the exact
// opposite of what this one needs.
// The asking itself, as a function: the server asks again when somebody presses retry in the
// Alerts list, and that has to be the same request. `hooks` are the ladder's onAsk / onStep.
async function _submitPortrait(b, hooks) {
  {
    const prompt = String(b.prompt || '').trim();
    if (!prompt) throw Object.assign(new Error('prompt is required'), { status: 400 });

    const hasRef = !!(b.imageUrl || b.imageBase64 || b.imagePath);
    const dir = hasRef ? 'i2i' : 't2i';
    // With no reference there is nothing to match, so the only aspect that means anything is the
    // house 3:2.
    const aspect = (hasRef && ASPECTS.includes(b.aspect)) ? b.aspect : '3:2';

    // The ladder decides, not the request (lib/cv2-ladders.js): which pairing to try, in what
    // order, and what to do when one refuses. An engine or provider in the body is ignored.
    const sub = await RUN.runImageLadder(hasRef ? 'reference' : 'create', {
      prompt,
      imageUrls: hasRef ? [await _refUrl(b)] : [],
      aspect,
      onAsk: hooks && hooks.onAsk,
      onStep: hooks && hooks.onStep,
    });

    // The server watches it to the end itself. The page's poll used to be the only thing
    // driving this to a conclusion, which meant closing the tab abandoned a paid-for
    // generation. Now the page's poll only READS what the watcher already found.
    WATCH.watch(sub.taskId, MEDIA.work, 'generated');
    console.log('[cv2/generate]', dir, sub.engine, '@' + sub.provider, sub.quality, aspect, '| prompt:', prompt.slice(0, 120));
    return { taskId: sub.taskId, engine: sub.engine, provider: sub.provider, quality: sub.quality, aspect, steps: sub.steps };
  }
}

// The askings alive in this process, by the token their row carries (job.params.kick) - see the poll.
const _asking = new Set();
const _kickToken = () => 'k' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// The asking behind a row's answer - the first press's and a retry's: it hands the row its task, or fails it
// with the reason. The row is marked `asked` just before each create that costs money, and the mark is taken
// back on an answered no (PAID ONCE, above).
async function _askBehind(alertId, kick, b) {
  try {
    const sub = await _submitPortrait(b, {
      onAsk: () => ALERTS.update(alertId, { params: { asked: true } }),
      onStep: () => ALERTS.update(alertId, { params: { asked: false } }),
    });
    // A row let go of meanwhile stays let go of (update leaves it alone): the task was paid for when
    // the ladder accepted it, the watcher still files it into media/work, and nothing follows it.
    ALERTS.update(alertId, { taskIds: [sub.taskId], engine: sub.engine, stage: '' });
  } catch (err) {
    console.error('[cv2/generate]', err.response?.data || err.message);
    // A refusal of the content is `refused` - no paid "try again" (phase V10.2, lib/gen-refusal.js).
    const why = reasonOf(err);
    ALERTS.fail(alertId, why, REFUSAL.isRefusal(why) ? { refused: true } : undefined);       // a row let go of is left as it is (lib/alerts.js)
  } finally {
    _asking.delete(kick);
  }
}

router.post('/character-v2/generate', async (req, res) => {
  const b = req.body || {};
  // THE ROW COMES FIRST (V2) AND IS THE ANSWER: written at the press and answered at once, before the
  // ladder is asked, so the page that follows it (New Character, phase H) holds it from the first
  // moment - a reload, or the overlay's Cancel, while the ladder is still deciding has a row to act on.
  // The asking goes on behind the answer: it hands the row its task, or fails it with the reason. The
  // server watches the task to the end (WATCH.watch in _submitPortrait).
  // Always a row: it is what resolves the portrait now - a request with no place gets the Characters shelf.
  if (!b.where || typeof b.where !== 'object') b.where = { page: 'library', href: '/library?shelf=characters&make=1', label: 'Library · New Character · portrait' };
  {
    if (!String(b.prompt || '').trim()) return res.status(400).json({ success: false, error: 'prompt is required' });
    const kick = _kickToken();
    _asking.add(kick);                           // before the row: JOBS.submitted polls straight away
    let alertId = '';
    try {
      alertId = JOBS.submitted({
        kind: 'image', what: 'portrait',
        title: 'Portrait · ' + String(b.said || b.prompt || '').replace(/\s+/g, ' ').trim().slice(0, 60),
        where: b.where, stage: 'asking the engine', taskIds: [],
        job: { type: 'portrait', params: { kick, request: { ...b, where: null } } },
      }).id;
    } catch (e) {
      _asking.delete(kick);
      return res.status(500).json({ success: false, error: 'the Alerts row could not be written: ' + e.message });
    }
    res.json({ success: true, alertId });
    await _askBehind(alertId, kick, b);
    return;
  }
});

module.exports = router;
