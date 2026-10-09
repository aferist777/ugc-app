'use strict';

// ════════════════════════════════════════════════════════════════════════════
// THE LIBRARY'S MAKING CHATS (phase I, the owner 2026-10-01): New environment and New lookbook.
//
//   GET  /api/makechat/:kind             the chat - its sends, the running ones checked against Alerts
//   POST /api/makechat/:kind/send        { text, ref: { path, from: 'base'|'photo' } | null } -> { send }
//   POST /api/makechat/:kind/photo       { dataUrl, name } -> { path }   a photo from this computer, into Images
//
// `kind` is the shelf: environments | lookbooks.
//
// THE ROW IS WRITTEN AT THE PRESS (CLAUDE.md V2, the owner's answer 10). A send writes its Alerts row
// and its message in one go and answers; the picture is then sent up, the agent reads it, and the task
// is asked for behind the answer, the row saying which of those it is doing. The agent may decline -
// that is the agent's answer to the person, it fails the row with its own words and is not offered
// again - and a row let go of before the task is asked for costs nothing. The work itself is the same
// _submitEnv / _submitLookbook that Merge's makers and "try again" use (routes/scen3.js), so a send
// from here and one from Merge are filed the same way. What is kept of a send is lib/makechat.js.
//
// UP TO THREE AT ONCE per chat (the owner): a fourth send waits for one of them.
//
// ONE PICTURE PER MESSAGE for now (the owner): the base from the shelf on the left - an environment to
// change, a lookbook to build on - or a picture to read as a photo, from this computer or from Images.
// A photo from this computer goes into Images the moment it is added (the owner's answer 3), under
// uploads_environments / uploads_lookbooks, the same bytes once: a chat that is kept for good needs an
// address for it that does not expire.
// ════════════════════════════════════════════════════════════════════════════

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const CFG = require('../lib/config');
const { toUrl } = require('../lib/media');
const ALERTS = require('../lib/alerts');
const JOBS = require('../lib/gen-jobs');
const CHAT = require('../lib/makechat');
const M = require('./scen3').makers;

const router = express.Router();

const AT_ONCE = 3;
const MIN_ALONE = 20;                  // a sentence with no picture: the makers' own rule (js/merge-v3/wk-maker.js)
const PHOTO_MAX = 30 * 1024 * 1024;

const SPEC = {
  environments: {
    type: 'environment', title: 'Environment', shelf: () => CFG.ENVIRONMENTS_DIR, cat: 'uploads_environments',
    where: { page: 'library', href: '/library?shelf=environments&make=1', label: 'Library · New environment', spot: { view: 'envmake' } },
  },
  lookbooks: {
    type: 'lookbook', title: 'Lookbook', shelf: () => CFG.LOOKBOOKS_DIR, cat: 'uploads_lookbooks',
    where: { page: 'library', href: '/library?shelf=lookbooks&make=1', label: 'Library · New lookbook', spot: { view: 'lbmake' } },
  },
};

function _spec(req) {
  const s = SPEC[String(req.params.kind || '')];
  if (!s) throw Object.assign(new Error('no such chat'), { status: 404 });
  return s;
}

const _within = (abs, dir) => abs.startsWith(path.resolve(dir) + path.sep);

// BOTH UPLOAD CATEGORIES EXIST FROM THE FIRST LOOK AT EITHER CHAT (phase I4, the owner): the right
// column's dropdown shows where a photo from this computer will go before the first one is added.
// Once per run of the server - a category deleted by hand is not put back under the person's hands
// every four seconds.
let _catsMade = false;
function _makeCats() {
  if (_catsMade) return;
  _catsMade = true;
  try {
    const LC = require('../lib/library-cats');
    for (const k of Object.keys(SPEC)) LC.add('images', SPEC[k].cat);
  } catch (e) {
    _catsMade = false;
    console.warn('[makechat] the upload categories could not be made:', e.message);
  }
}

router.get('/makechat/:kind', (req, res) => {
  try {
    _spec(req);
    _makeCats();
    const sends = CHAT.read(req.params.kind);
    res.json({ success: true, sends, keep: CHAT.KEEP, atOnce: AT_ONCE });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, error: e.message });
  }
});

router.post('/makechat/:kind/send', (req, res) => {
  let kick = '';
  try {
    const sp = _spec(req);
    const kind = req.params.kind;
    const b = req.body || {};
    const text = String(b.text || '').trim().slice(0, 4000);
    const want = (b.ref && typeof b.ref === 'object' && b.ref.path) ? b.ref : null;

    // Everything that can be said before anything is asked of anybody is said here, as a refusal of
    // the send - not as a row that fails a second later.
    let ref = null;
    if (want) {
      const hit = M.resolveMedia(String(want.path));
      if (!hit || hit.shipped || !fs.existsSync(hit.abs)) {
        return res.status(400).json({ success: false, error: 'that picture is not in the library any more' });
      }
      const from = want.from === 'base' ? 'base' : 'photo';
      if (from === 'base' && !_within(hit.abs, sp.shelf())) {
        return res.status(400).json({ success: false, error: 'a base is picked from the shelf on the left' });
      }
      ref = { path: String(want.path).split('?')[0], from };
    }
    if (!ref && text.length < MIN_ALONE) {
      return res.status(400).json({ success: false, error: text ? (MIN_ALONE - text.length) + ' more characters, or add a picture' : 'say what to make, or add a picture' });
    }
    if (sp.type === 'environment' && ref && ref.from === 'base' && !text) {
      return res.status(400).json({ success: false, error: 'say what to change in this environment' });
    }
    if (CHAT.running(kind) >= AT_ONCE) {
      return res.status(409).json({ success: false, error: AT_ONCE + ' are being made already - wait for one of them' });
    }

    // What the maker is asked: the same request Merge sends, and what "try again" will send again.
    const request = { prompt: text, title: sp.title, where: sp.where, refName: ref ? path.basename(ref.path) : '' };
    if (ref && sp.type === 'environment') {
      if (ref.from === 'base') request.imagePath = ref.path; else request.photoPath = ref.path;
    } else if (ref) {
      request.imagePath = ref.path;
    }

    const sendId = 'mc' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
    kick = 'k' + crypto.randomBytes(8).toString('hex');
    M.asking.add(kick);                  // before the row: the runner asks about it at once
    const row = JOBS.submitted({
      kind: 'image', what: sp.type,
      title: sp.title + (text ? ' · ' + text.replace(/\s+/g, ' ').slice(0, 60) : ''),
      where: sp.where, engine: M.engine, taskIds: [],
      stage: ref ? 'sending the picture' : 'reading your words',
      job: { type: sp.type, params: { kick, chat: { kind, id: sendId }, request, file: {} } },
    });
    const send = CHAT.add(kind, { id: sendId, text, ref, alertId: row.id, stage: row.stage, startedAt: row.startedAt });
    res.json({ success: true, send });
    _work(kind, sp.type, row.id, kick, sendId, request);
  } catch (e) {
    if (kick) M.asking.delete(kick);
    console.error('[makechat/send]', e.message);
    if (!res.headersSent) res.status(e.status || 500).json({ success: false, error: e.message });
  }
});

// Behind the answer: the picture up, the agent, the task - the row told each step, and told the task
// the moment it exists.
//
// THE ROW IS THIS ASKING'S ONLY WHILE NOTHING ELSE HAS TAKEN IT (review I): let go of and asked for
// again from Alerts, it runs again with another task - and this asking, still waiting on the agent,
// must then neither pay for a second task nor write its own over the retry's. So every step checks
// that the row is still running on THIS kick with no task but the one this asking got. (Alerts' retry
// also waits while the kick is alive - lib/gen-jobs.js `busy` - so this is the second guard.)
const MOVES = require('../lib/moves');
async function _work(kind, type, alertId, kick, sendId, request) {
  let mine = '';                                   // the task this asking got, once it has one
  const ours = () => {
    const r = ALERTS.get(alertId);
    if (!r || r.state !== 'running') return false;
    if ((((r.job || {}).params || {}).kick) !== kick) return false;
    return ((r.taskIds || [])[0] || '') === mine;
  };
  // A picture moved while the agent was reading (another category, say): lib/relocate.js rewrote the
  // row, and what is written back now follows it instead of restoring the old address.
  const now = (p) => (p ? MOVES.resolve(p) : p);
  const fresh = (req) => {
    const out = { ...req };
    for (const k of ['imagePath', 'photoPath']) if (out[k]) out[k] = now(out[k]);
    return out;
  };
  const freshFile = (f) => (f && f.from ? { ...f, from: now(f.from) } : (f || {}));
  const params = (more) => ({ kick, chat: { kind, id: sendId }, request: fresh(request), ...(more || {}) });
  const hooks = {
    stage: (w) => { if (ours()) ALERTS.update(alertId, { stage: w }); },
    stop: () => !ours(),
    asked: (a) => {
      if (!ours()) return;
      ALERTS.update(alertId, { taskIds: [a.taskId], engine: a.engine, stage: '', job: { type, params: params({ file: freshFile(a.file) }) } });
      mine = a.taskId;
    },
  };
  try {
    const out = type === 'environment' ? await M.submitEnv(request, hooks) : await M.submitLookbook(request, hooks);
    // A choice of places is offered only to a page that can show one, and this one does not ask.
    if (out.choose) throw new Error('the agent could not decide what place to make - say which place');
    if (!ours()) {
      console.warn('[makechat] ' + type + ' ' + alertId + ': the row was taken over while its task was asked for - task ' + out.taskId + ' is not followed');
      return;
    }
    ALERTS.update(alertId, {
      taskIds: [out.taskId], engine: out.engine, stage: '',
      job: { type, params: params({ request: M.retryRequest(fresh(request), out), file: freshFile(out.file) }) },
    });
    mine = out.taskId;
    // Only words for the chat: a store that cannot be written now must not fail a row whose task is paid.
    try { CHAT.change(kind, sendId, (s) => { s.mode = String(out.mode || ''); }); }
    catch (e) { console.warn('[makechat] the chat could not take the mode of ' + sendId + ':', e.message); }
  } catch (e) {
    if (e && e.stopped) return;                    // let go of before the money: nothing to say
    console.warn('[makechat] ' + type + ':', e.message);
    if (ours()) ALERTS.fail(alertId, e.message, e.refused ? { refused: true } : undefined);
  } finally {
    M.asking.delete(kick);
  }
}

// A photo from this computer, into Images - in a format the shelf and the aggregators take (AVIF, GIF,
// TIFF become JPEG; lib/image-in.js, shared with every other door since phase V24), and recognised by
// its bytes so the same photo twice is one picture.
router.post('/makechat/:kind/photo', async (req, res) => {
  try {
    const sp = _spec(req);
    const b = req.body || {};
    const raw = String(b.dataUrl || '').replace(/^data:[^;,]*;base64,/i, '');
    const got = Buffer.from(raw, 'base64');
    if (!got.length) return res.status(400).json({ success: false, error: 'unreadable picture' });
    if (got.length > PHOTO_MAX) return res.status(400).json({ success: false, error: 'that picture is over 30 MB' });
    const pic = await require('../lib/image-in').sendable(got);
    const buf = pic.buf, ext = pic.ext;

    const IMG = require('../lib/images-store');
    const LC = require('../lib/library-cats');
    const sha1 = crypto.createHash('sha1').update(buf).digest('hex');
    const { cat } = LC.add('images', sp.cat);
    const same = IMG.read().find(e => e && e.categoryId === cat.id && e.meta && e.meta.sha1 === sha1);
    const sameHit = same && M.resolveMedia(same.imagePath);
    if (sameHit && fs.existsSync(sameHit.abs)) return res.json({ success: true, path: same.imagePath, name: same.name, catId: cat.id, again: true });

    const file = 'ref_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex') + '.' + ext;
    fs.mkdirSync(CFG.MEDIA.work, { recursive: true });
    const abs = path.join(CFG.MEDIA.work, file);
    fs.writeFileSync(abs, buf);
    const clean = String(b.name || '').replace(/\.[^.]+$/, '').replace(/[^\wа-яА-ЯёЁ\- .]/g, '').trim().slice(0, 120);
    const { item } = await IMG.add(toUrl(abs), {
      name: clean || sp.cat, source: 'upload', categoryId: cat.id, categoryLabel: cat.label,
      meta: { sha1, made: sp.type },
    });
    // The category too: the page's dropdown goes to it, so the picture just added is in view.
    res.json({ success: true, path: item.imagePath, name: item.name, catId: cat.id });
  } catch (e) {
    console.error('[makechat/photo]', e.message);
    res.status(e.status || 500).json({ success: false, error: e.message });
  }
});

module.exports = router;
