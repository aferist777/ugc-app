'use strict';

// ════════════════════════════════════════════════════════════════════════════
// MERGE'S GENERATIONS — one record per picture asked for, kept BY PROJECT.
//
// A picture made inside a Merge project belongs to that project. Close the popup, open it
// again from another lane, come back tomorrow: the strip on the right shows the same run of
// work, because the run is the project's and not the window's. That is the whole reason this
// store exists rather than a list in the page's memory.
//
// It is not a second library. The finished picture goes onto the images shelf like everything
// else and lives there for good; what is kept here is the ATTEMPT - what was asked for, of
// whom, whether it arrived, and why it did not. Those are the three states a strip has to be
// able to draw, and only one of them ever becomes a file.
//
// ── Who finishes the job ────────────────────────────────────────────────────
// The watcher is here rather than in the browser because the browser closes. A generation
// submitted and then abandoned would otherwise be paid for and never collected.
//
// lib/pending-tasks.js is the other net and is deliberately NOT used: it can download a file
// but it cannot file one on a shelf or mark this record done, so a task recovered by it would
// land in uploads/ with nothing pointing at it. resume() below does that job instead - every
// record still marked pending when the server starts gets its watcher back, because the record
// is on disk and the watcher never was.
//
// resolveTask is shared, and that is the part worth sharing: it already knows a kie task from
// a Replicate one from an OpenRouter one, and it is idempotent - asked twice about a file it
// has already fetched, it hands back the same path rather than paying again.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const { DATA_DIR, MEDIA } = require('./config');
const { resolveTask, uploadToPublicHost } = require('./helpers');
const { writeFileAtomic } = require('./atomic-write');
const { ROOT_DIR } = require('./config');
const IMG = require('./images-store');
const LC = require('./library-cats');
const MV = require('./mv3-img');
const FAKE = require('./fake-agg');

const FILE = path.join(DATA_DIR, 'mv3-gens.json');
const PREFIX = 'mgen';

// ── Which shelf-category a picture lands in ─────────────────────────────────
// The project's own name, so a library full of generations can be read back by the film they
// were made for. A category label is capped at 60 characters and a project title at 120, so the
// rule for shortening one into the other lives HERE and is exported - the rename route has to
// find the existing category by exactly the name this made, and two copies of a slicing rule
// are two rules waiting to disagree.
//
// Nothing belongs to no project - a generation made before a project exists - so those keep the
// old catch-all. It is also where every picture made before this existed already sits.
const LOOSE_CAT = 'Generated';
// Trimmed after the cut too: a title whose 60th character is a space would give a label LC.add stores without it,
// and a rename looking for the untrimmed one would find nothing (review V2r).
const catLabelFor = (title) => String(title || '').trim().slice(0, 60).trim() || LOOSE_CAT;

// The titles live in the timeline store, which belongs to routes/mergev3.js. Read rather than
// asked for: this runs in a watcher that may outlive the page by minutes, so the title cannot
// be handed in at submit time and trusted - it may have been renamed since.
function _titleOf(key) {
  if (!key) return '';
  try {
    const rec = require('./merge-store').read().timelines[key];
    return (rec && rec.title) || '';
  } catch (e) { return ''; }
}

// How long a picture is waited for: 40 minutes FROM THE MOMENT IT WAS ASKED (`askedAt`), judged by the
// watcher after a poll that says it is still running - so a start after hours away asks once before
// anything is given up, and a picture that finished meanwhile is fetched and filed (review V2r). The
// Alerts row's own limit (the `picture` type, below) is only a day's backstop: counted from the press, it
// went on counting while the app was closed and failed finished pictures at the first tick of the next
// start, before the watcher had asked once. When the row ends, the record ends with it (phase J review).
const EVERY_MS = 4000;
const LIMIT_MS = 40 * 60 * 1000;
const ROW_LIMIT_MS = 24 * 60 * 60 * 1000;

// When this process started: a record written since then is this process's own, whatever it says.
const BOOT = new Date().toISOString();

// Per project, oldest done records fall off past this. A strip nobody has cleared for a month
// is not a reason for a file that grows forever.
const KEEP_PER_PROJECT = 300;

// ── The file ────────────────────────────────────────────────────────────────
// Read-modify-write, synchronously, on every change: several watchers finish at once and each
// one is a whole-file write, so the read and the write have to happen without an await between
// them. In one node process that is enough to make them atomic with respect to each other.
function _read() {
  try { const l = JSON.parse(fs.readFileSync(FILE, 'utf8')); return Array.isArray(l) ? l : []; }
  catch (e) { return []; }
}

function _write(list) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  writeFileAtomic(FILE, JSON.stringify(list, null, 2));
}

const _newId = () => 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function _patch(id, fields) {
  const list = _read();
  const i = list.findIndex(r => r && r.id === id);
  if (i < 0) return null;
  list[i] = Object.assign({}, list[i], fields);
  _write(list);
  return list[i];
}

// Newest first, which is the order the strip draws in - the thing just asked for should be at
// the top rather than at the end of a scroll.
function list(project) {
  const p = String(project == null ? '' : project);
  return _read().filter(r => r && String(r.project || '') === p);
}

function get(id) {
  return _read().find(r => r && r.id === id) || null;
}

function _trim(project) {
  const all = _read();
  const mine = all.filter(r => r && String(r.project || '') === String(project || ''));
  // Only settled records are dropped, and the oldest first. A pending one is still owed an
  // answer, however far down the list it has sunk. The video chat's storyboards are counted apart
  // (review V8): three hundred pictures of the chat must not push out the sheets a card follows.
  const doomed = new Set();
  for (const group of [mine.filter(r => !r.board), mine.filter(r => r.board)]) {
    if (group.length <= KEEP_PER_PROJECT) continue;
    group.filter(r => r.state !== 'pending')
      .sort((a, b) => String(a.at).localeCompare(String(b.at)))
      .slice(0, group.length - KEEP_PER_PROJECT).forEach(r => doomed.add(r.id));
  }
  if (!doomed.size) return;
  _write(all.filter(r => !doomed.has(r.id)));
}

// ── The watcher ─────────────────────────────────────────────────────────────
// Still owed an answer: pending, and not let go of.
const _waited = (id) => { const g = get(id); return !!g && g.state === 'pending' && !g.cancelled; };
const _live = new Set();      // ids being watched right now, so resume() cannot double up

async function _file(rec, imagePath) {
  // The shelf gets a category so these are findable among uploads and screenshots. LC.add is
  // idempotent by label - it hands back the existing chip rather than making a second one,
  // which is what makes one category per project cost nothing to maintain.
  let cat = { id: '', label: '' };
  try { cat = LC.add('images', catLabelFor(_titleOf(rec.project))).cat || cat; } catch (e) {}
  // A storyboard of the video chat (phase V8) is named by what it is for - its prompt starts with panel after panel.
  const name = String((rec.board && rec.said) || rec.prompt || '').replace(/\s+/g, ' ').trim().slice(0, 60) || rec.engine;
  return IMG.add(imagePath, {
    name,
    source: 'gen',
    categoryId: cat.id,
    categoryLabel: cat.label,
    // What made it. The project is the reason the strip can be rebuilt from the shelf alone if
    // this store is ever lost, and the rest is what makes one apple tellable from another.
    meta: {
      project: rec.project || null, engine: rec.engine, provider: rec.provider,
      model: rec.model || '', quality: rec.quality, aspect: rec.aspect, prompt: rec.prompt,
      said: rec.said || '', refs: (rec.refs || []).slice(0, 14),
    },
    // Let go of while it was being filed (review V8): IMG.add asks in the tick it writes, and files nothing then.
    wanted: () => _waited(rec.id),
  });
}

function _watch(rec) {
  if (!rec || !rec.taskId || _live.has(rec.id)) return;
  _live.add(rec.id);
  const started = Date.now();
  const askedAt = Date.parse(rec.askedAt || rec.at || '') || started;

  (async () => {
    for (;;) {
      await new Promise(r => setTimeout(r, EVERY_MS));
      // LET GO OF, or ended with its row (phase J): the cross on its countdown or in Alerts, the row's
      // own time limit. Nothing is fetched or filed.
      if (!_waited(rec.id)) { _live.delete(rec.id); return; }
      let out;
      try {
        out = await resolveTask(rec.taskId, MEDIA.work, PREFIX);
      } catch (e) {
        // A refused poll is not a refused generation - the network hiccups, kie rate-limits.
        continue;
      }
      if (out && out.state === 'success' && !_waited(rec.id)) {
        // Let go of while this poll was in the air: the file it fetched, and its thumbnail, belong to nothing.
        const abs = path.join(ROOT_DIR, String(out.imagePath || '').replace(/^\/+/, ''));
        for (const p of [abs, path.join(path.dirname(abs), 'thumbs', path.basename(abs))]) {
          try { fs.unlinkSync(p); } catch (e) { /* not there */ }
        }
        _live.delete(rec.id);
        return;
      }
      if (out && out.state === 'success') {
        let item = null;
        try {
          const filed = await _file(rec, out.imagePath);
          // Let go of while it was being filed: nothing was filed, and the record stays as the cross left it.
          if (filed && filed.unwanted) { _live.delete(rec.id); return; }
          item = (filed && filed.item) || null;
        } catch (e) { console.warn('[mv3-gens] could not file', out.imagePath, '-', e.message); }
        // Filing moved the picture from media/work/ to the project's image category.
        _patch(rec.id, {
          state: 'done', imagePath: (item && item.imagePath) || out.imagePath, imageId: (item && item.id) || '',
          w: (item && item.w) || 0, h: (item && item.h) || 0,
          doneAt: new Date().toISOString(), secs: Math.round((Date.now() - started) / 1000),
        });
        _trim(rec.project);
        console.log('[mv3-gens] done', rec.id, rec.engine + '@' + rec.provider, '->', out.imagePath);
        _live.delete(rec.id);
        return;
      }
      if (out && out.state === 'failed') {
        // THE ONE FAILURE WORTH A SECOND TRY, and the reason the ladder never caught it: this
        // happens at POLL time. The aggregator accepted the job, took a minute, and only then
        // discovered it could not read the reference - by which point submitWithFallback has
        // long returned and there is nobody left to fall through to.
        //
        // So the rescue lives here. Same model, same aggregator - the choice was deliberate and
        // nothing was wrong with it - but the pictures are uploaded again first, under new keys.
        const cur = get(rec.id) || rec;
        if (!_waited(rec.id)) { _live.delete(rec.id); return; }
        if (!cur.rescued && (cur.refs || []).length && _isFetchFailure(out.error)) {
          console.warn('[mv3-gens] rescue', rec.id, '- could not read the references -',
            'uploading them again');
          try {
            const fresh = await _hostRefs(cur.refs, true);
            if (!_waited(rec.id)) { _live.delete(rec.id); return; }
            const sub = await MV.submitImage({
              engine: cur.engine, provider: cur.provider, prompt: cur.prompt,
              aspect: cur.aspect, quality: cur.quality, imageUrls: fresh,
            });
            const live = _patch(rec.id, {
              taskId: sub.taskId, hosted: fresh, rescued: true, askedAt: new Date().toISOString(),
              error: 'the references could not be read - they were uploaded again',
            });
            _live.delete(rec.id);
            _watch(live);
            return;
          } catch (e2) {
            console.warn('[mv3-gens] rescue failed for', rec.id, '-', e2.message);
          }
        }
        _patch(rec.id, {
          state: 'failed', error: String(out.error || 'the generation failed').slice(0, 400),
          doneAt: new Date().toISOString(), secs: Math.round((Date.now() - started) / 1000),
        });
        console.log('[mv3-gens] failed', rec.id, '-', out.error);
        _live.delete(rec.id);
        return;
      }
      // Still running: the clock (see LIMIT_MS). The row follows the record at its next tick.
      if (Date.now() - askedAt > LIMIT_MS) {
        if (_waited(rec.id)) {
          _patch(rec.id, { state: 'failed', stage: '', error: 'it did not come in ' + Math.round(LIMIT_MS / 60000) + ' minutes',
                           doneAt: new Date().toISOString(), secs: Math.round((Date.now() - started) / 1000) });
        }
        _live.delete(rec.id);
        return;
      }
    }
  })().catch(e => {
    _live.delete(rec.id);
    console.warn('[mv3-gens] watcher crashed for', rec.id, '-', e.message);
  });
}

// ── References, made reachable ──────────────────────────────────────────────
// A picture in this app lives at /media/images/x.jpg, which means nothing to a renderer in another
// datacentre. So anything attached is put on a public host first and the aggregator is handed
// that link instead. What is stored on the record is the LOCAL path: the public link expires,
// the local one does not, and the strip has to be able to draw the attachment tomorrow.
//
// `verify` reads the link back before it is used. It cannot prove the AGGREGATOR can read it -
// only that it is there and is an image - but an upload that half-failed is the cheap half of
// the problem and this catches it before a task is paid for.
//
// ALL OF THEM AT ONCE. They were uploaded one after another, so five references meant five
// round trips end to end before the model was even asked - and the whole of that sits in front
// of the person waiting. They are independent files going to the same bucket; nothing about
// them needs an order. The ORDER OF THE ANSWER still matters, and Promise.all keeps it: the
// numbers in the message point at positions in this list.
// `fresh` is the rescue asking for new keys: the same bytes under the same cache would hand the
// aggregator back the link it has just said it cannot read.
async function _hostRefs(paths, fresh) {
  const list = (paths || []).map(x => String(x || '').trim()).filter(Boolean);
  return Promise.all(list.map(async (clean) => {
    if (/^https?:\/\//i.test(clean)) return clean;
    const abs = path.join(ROOT_DIR, clean.replace(/^\/+/, ''));
    if (!fs.existsSync(abs)) throw new Error('no such picture: ' + clean);
    if (FAKE.on()) return FAKE.host(clean);
    return uploadToPublicHost(fs.readFileSync(abs), {
      ext: (clean.split('.').pop() || 'jpg'), verify: true, forceFresh: !!fresh,
    });
  }));
}

// ── When the failure is about OUR host, not their model ─────────────────────
// These two sentences mean the same thing and neither says so:
//
//   kie        "Timeout while downloading url: https://files.catbox.moe/zp8tdr.jpg"
//   Replicate  "Input validation error: ('Connection aborted.', RemoteDisconnected(...))"
//
// Nothing is wrong with the picture, the prompt or the model. The renderer simply could not pull
// the file off our bucket - and the only useful retry is one that uploads it again under a key
// with its whole life ahead of it.
const FETCH_FAIL = new RegExp([
  'timeout while downloading', 'read timed out', 'connectionpool', 'failed to fetch',
  'could not (download|fetch)', 'unable to (download|fetch)', 'image fetch failed',
  'error downloading', 'connection aborted', 'remotedisconnected', 'remote end closed',
].join('|'));

function _isFetchFailure(msg) {
  return FETCH_FAIL.test(String(msg || '').toLowerCase());
}

// ── Asking for a picture ────────────────────────────────────────────────────
// The record is written BEFORE the submit answers, so a strip can show the attempt while it is
// still being made and a crash between the two leaves something to explain rather than silence.
// ── The journal ─────────────────────────────────────────────────────────────
// A picture asked for here is an Alert like every other generation (docs/local-app/PLAN.md), and
// the row says what this record already knows. Nothing is asked of a provider for it: this file
// has its own watcher, and the job below only mirrors what that watcher decided - which is why
// polling it is free and why a picture cannot end up being waited for twice.
const JOBS = require('./gen-jobs');
const ALERTS = require('./alerts');

// A PICTURE ASKED FOR FROM THE CHAT HAS ITS ROW FROM THE PRESS (phase J, CLAUDE.md V2): the record and
// the row exist before the analyst has read the message and before there is a task. Until the task
// exists the record is "not started" for as long as its asking goes on in this process - its `kick`
// is in here; one that is not died with the app, and the row says so at once.
const _asking = new Set();

const NOT_ASKED = 'the app was closed before the picture was asked for - try again';

JOBS.register('picture', {
  timeoutMs: ROW_LIMIT_MS,
  poll: async (rec) => {
    const p = (rec.job || {}).params || {};
    const g = get(p.genId);
    if (!g) return { state: 'failed', error: 'the record of this picture is gone' };
    if (g.state === 'done') return { state: 'success', gen: g };
    if (g.state === 'failed') return { state: 'failed', error: g.error || 'the generation failed' };
    if (!g.taskId && !(p.kick && _asking.has(p.kick))) {
      _patch(g.id, { state: 'failed', stage: '', error: NOT_ASKED, doneAt: new Date().toISOString() });
      return { state: 'failed', error: NOT_ASKED };
    }
    // A task nobody is watching (its watcher crashed, or this is the first tick of a start): watched again.
    if (g.taskId && !_live.has(g.id)) _watch(g);
    return { state: 'pending' };
  },
  file: async (_rec, out) => ({ path: out.gen.imagePath, media: 'image' }),
  // Its first asking is still going on: asked again now, two tasks would race for one row.
  busy: (rec) => _asking.has((((rec.job || {}).params || {}).kick) || ''),
  // Let go of from Alerts or from the chat: the record stops being waited for too.
  cancel: (rec) => cancel((((rec.job || {}).params || {}).genId) || ''),
  // Asked for again: a new record, a new watcher, and the same row in the list.
  submit: async (request, row) => {
    const req = { ...(request || {}), where: null };
    // A storyboard of the video chat (review V8): only for a card still to be made - a made card's video was made, and
    // its copies ("again") carry its sheets - and it lands on that card, with the card's own limit. Refused in words
    // before anything is asked.
    if (req.board) {
      const home = require('./mv3-chat').boardHome((((row || {}).job || {}).params || {}).genId || '', req.project);
      if (home.error) throw new Error(home.error);
      req.send = home.card.id;
    }
    const g = await start(req);
    if (row && row.id) _patch(g.id, { alertId: row.id });
    return { taskId: g.taskId, params: { genId: g.id } };
  },
});

/** Let go of one picture: it is not waited for, fetched or filed any more. */
function cancel(id) {
  const g = get(String(id || ''));
  if (!g || g.state !== 'pending') return null;
  return _patch(g.id, {
    state: 'failed', cancelled: true, stage: '', error: 'you stopped waiting for it',
    doneAt: new Date().toISOString(),
  });
}

// How many sends of a project's chat are still being made - a send is one message, whatever number
// of pictures it asked for; a picture asked for again from Alerts counts on its own. A storyboard of the
// video chat (phase V8) is not the pictures chat's: its card has a limit of its own.
function runningSends(project) {
  const p = String(project == null ? '' : project);
  const sends = new Set();
  for (const r of _read()) if (r && !r.board && String(r.project || '') === p && r.state === 'pending') sends.add(r.send || r.id);
  return sends.size;
}

/**
 * A picture asked for from the chat, AT THE PRESS: the record, pending with no task, and its Alerts
 * row. `submit` asks for the task later, behind the answer.
 */
function create(opts) {
  const o = opts || {};
  const rec = {
    id: _newId(),
    project: String(o.project == null ? '' : o.project),
    send: String(o.send || ''),
    prompt: String(o.prompt || '').trim().slice(0, 20000),
    said: String(o.said || '').trim().slice(0, 20000),
    engine: String(o.engine || ''), provider: String(o.provider || ''), model: '',
    quality: String(o.quality || ''), aspect: String(o.aspect || ''),
    state: 'pending',
    // What it is doing before its task exists, in the person's words.
    stage: String(o.stage || '').slice(0, 120),
    refs: (Array.isArray(o.refs) ? o.refs : []).map(String).filter(Boolean).slice(0, 14),
    hosted: [], rescued: false,
    taskId: '', imagePath: '', imageId: '', w: 0, h: 0,
    error: '', tried: [], fell: '', writer: '', alertId: '',
    at: new Date().toISOString(), doneAt: '', secs: 0,
  };
  // Made by the fake aggregator (phase V0): said on the record and in its row's title.
  if (FAKE.on()) rec.fake = true;
  // A storyboard of a two-step card of the video chat (phase V8): `send` is that card, and its retries say so too.
  if (o.board) rec.board = true;
  if (!rec.prompt) throw new Error('a prompt is needed');
  const list0 = _read();
  list0.unshift(rec);
  _write(list0);
  if (o.where) {
    try {
      const row = JOBS.submitted({
        kind: 'image', what: 'picture',
        title: 'Picture · ' + (rec.fake ? 'FAKE · ' : '') + rec.said.replace(/\s+/g, ' ').slice(0, 60),
        where: o.where, engine: rec.engine, taskIds: [], stage: rec.stage,
        job: { type: 'picture', params: { genId: rec.id, kick: o.kick || '', request: _request(rec) } },
      });
      return _patch(rec.id, { alertId: row.id });
    } catch (e) { console.warn('[mv3-gens] could not write the alert:', e.message); }
  }
  return rec;
}

// What "try again" sends: the record's own words and settings, as they are now - and a storyboard's card, so the
// picture asked for again lands on the card it was drawn for (phase V8).
const _request = (rec) => Object.assign({
  project: rec.project, engine: rec.engine, provider: rec.provider, prompt: rec.prompt, said: rec.said,
  aspect: rec.aspect, quality: rec.quality, refs: rec.refs,
}, rec.board ? { send: rec.send, board: true } : {});

// Still this asking's: pending, not let go of, and its row - when it has one - running on this kick
// with no task yet.
function _ours(id, kick) {
  const g = get(id);
  if (!g || g.state !== 'pending' || g.cancelled || g.taskId) return false;
  if (!g.alertId) return true;
  const row = ALERTS.get(g.alertId);
  if (!row || row.state !== 'running' || (row.taskIds || []).length) return false;
  return ((((row.job || {}).params || {}).kick) || '') === String(kick || '');
}

function stage(id, words, kick) {
  if (!_ours(id, kick)) return;
  const g = _patch(id, { stage: String(words || '').slice(0, 120) });
  if (g && g.alertId) ALERTS.update(g.alertId, { stage: g.stage });
}

/**
 * Ask for the task of a record made by create(): the prompt the analyst wrote (or the words as typed),
 * the references hosted, the aggregator asked. Never throws - a failure fails the record and its row.
 */
async function submit(id, over, kick) {
  const o = over || {};
  if (!_ours(id, kick)) return null;
  const words = { prompt: String(o.prompt || '').trim().slice(0, 20000) };
  if (o.aspect) words.aspect = String(o.aspect);
  if (o.quality) words.quality = String(o.quality);
  if (o.fell) words.fell = String(o.fell).slice(0, 300);
  if (o.writer) words.writer = String(o.writer).slice(0, 120);
  if (!words.prompt) delete words.prompt;
  let rec = _patch(id, words);
  // What "try again" sends from here on is what the analyst wrote, whatever fails next.
  _rowRequest(rec);
  stage(id, 'asking ' + (rec.provider || 'the model'), kick);
  let sub;
  try {
    const urls = await _hostRefs(rec.refs);
    if (!_ours(id, kick)) return null;
    if (urls.length) _patch(id, { hosted: urls });
    rec = get(id);
    sub = await MV.submitWithFallback({
      engine: rec.engine, provider: rec.provider, prompt: rec.prompt,
      aspect: rec.aspect, quality: rec.quality, imageUrls: urls,
      onAttempt: (a) => { if (_ours(id, kick)) _patch(id, { error: a.label + ': ' + String(a.error).slice(0, 200) }); },
      // Let go of while one aggregator was refusing: the next one is not asked.
      stop: () => !_ours(id, kick),
    });
  } catch (e) {
    if (e && e.stopped) return null;
    const why = String(MV.reasonOf(e)).slice(0, 400);
    if (_ours(id, kick)) {
      const g = _patch(id, { state: 'failed', stage: '', error: why, doneAt: new Date().toISOString() });
      if (g && g.alertId) ALERTS.fail(g.alertId, why);
    }
    return null;
  }
  if (!_ours(id, kick)) {
    // Let go of while it was being asked for: paid, and not followed.
    console.warn('[mv3-gens] ' + id + ' was let go of while its task was asked for - task ' + sub.taskId + ' is not followed');
    return null;
  }
  const live = _patch(id, {
    taskId: sub.taskId, provider: sub.provider, quality: sub.quality, aspect: sub.aspect,
    model: sub.model || '', tried: sub.tried || [], error: '', stage: '', askedAt: new Date().toISOString(),
  });
  if (live.alertId) {
    const row = ALERTS.get(live.alertId);
    ALERTS.update(live.alertId, {
      taskIds: [sub.taskId], engine: live.engine, stage: '',
      job: { type: 'picture', params: { ...(((row || {}).job || {}).params || {}), genId: id, request: _request(live) } },
    });
  }
  _watch(live);
  return live;
}

// The row's retry request, rewritten from the record as it is now.
function _rowRequest(rec) {
  if (!rec || !rec.alertId) return;
  const row = ALERTS.get(rec.alertId);
  if (!row || !row.job || row.state !== 'running') return;
  ALERTS.update(rec.alertId, { job: { ...row.job, params: { ...(row.job.params || {}), request: _request(rec) } } });
}

// A RECORD ENDS WITH ITS ROW (phase J review): a row that timed out, or was let go of, takes its record
// with it - one left pending would hold one of the project's five places and keep its countdown for ever.
ALERTS.onEnd((row) => {
  if (!row || row.state !== 'failed' || ((row.job || {}).type) !== 'picture') return;
  const g = get((((row.job || {}).params || {}).genId) || '');
  if (!g || g.state !== 'pending') return;
  _patch(g.id, {
    state: 'failed', stage: '', error: String(row.error || 'it did not come').slice(0, 400),
    cancelled: !!row.cancelled, doneAt: new Date().toISOString(),
  });
});

/** Fail a record made by create() that will not be asked for - the analyst asked a question instead. */
function refuse(id, why, kick) {
  if (!_ours(id, kick)) return;
  const g = _patch(id, { state: 'failed', stage: '', error: String(why || '').slice(0, 400), doneAt: new Date().toISOString() });
  if (g && g.alertId) ALERTS.fail(g.alertId, g.error, { refused: true });
}

async function start(opts) {
  const o = opts || {};
  const rec = {
    id: _newId(),
    project: String(o.project == null ? '' : o.project),
    prompt: String(o.prompt || '').trim().slice(0, 20000),
    // What the person actually typed, when the prompt above was written for them. Kept beside
    // it rather than instead of it: a picture that came out wrong has to be arguable, and that
    // needs both halves - what was asked for and what was sent.
    said: String(o.said || '').trim().slice(0, 20000),
    engine: String(o.engine || ''),
    provider: String(o.provider || ''),
    model: '',
    quality: String(o.quality || ''),
    aspect: String(o.aspect || ''),
    state: 'pending',
    // The LOCAL paths of what was attached, in the order they were attached - which is the order
    // the numbers on them refer to. Kept so the strip can draw the attachment long after the
    // public link it was uploaded to has expired.
    refs: (Array.isArray(o.refs) ? o.refs : []).map(String).filter(Boolean).slice(0, 14),
    // Where those references were PUT for the aggregator to read. Kept because a job that dies
    // fetching them has to be able to name the host that failed and pick a different one.
    hosted: [],
    rescued: false,
    taskId: '', imagePath: '', imageId: '', w: 0, h: 0,
    error: '', tried: [],
    at: new Date().toISOString(), doneAt: '', secs: 0,
  };
  if (FAKE.on()) rec.fake = true;
  // A storyboard asked for again from Alerts stays its card's (phase V8, `_request` above).
  if (o.board) { rec.board = true; rec.send = String(o.send || ''); }
  if (!rec.prompt) throw new Error('a prompt is needed');

  const list0 = _read();
  list0.unshift(rec);
  _write(list0);

  // The row goes up before the submit, for the same reason the record does: a submit that fails
  // has to leave something that says so.
  let alertId = '';
  if (o.where) {
    try {
      alertId = JOBS.submitted({
        kind: 'image', what: 'picture',
        title: 'Picture · ' + (rec.fake ? 'FAKE · ' : '') + (rec.said || rec.prompt || '').replace(/\s+/g, ' ').trim().slice(0, 60),
        where: o.where, engine: rec.engine,
        job: { type: 'picture', params: { genId: rec.id, request: { ...o, where: null } } },
      }).id;
    } catch (e) { console.warn('[mv3-gens] could not write the alert:', e.message); }
  }

  let sub;
  try {
    // Hosting happens INSIDE the try, so a picture that cannot be uploaded fails the record with
    // a reason rather than throwing past it and leaving a row stuck on pending forever.
    const urls = await _hostRefs(rec.refs);
    if (urls.length) _patch(rec.id, { hosted: urls });
    sub = await MV.submitWithFallback({
      engine: rec.engine, provider: rec.provider, prompt: rec.prompt,
      aspect: rec.aspect, quality: rec.quality, imageUrls: urls,
      // Written down as it happens: "kie could not, trying Replicate" is worth showing while it
      // is true, not only in the log afterwards.
      onAttempt: (a) => { _patch(rec.id, { error: a.label + ': ' + String(a.error).slice(0, 200) }); },
    });
  } catch (e) {
    const why = String(MV.reasonOf(e)).slice(0, 400);
    _patch(rec.id, { state: 'failed', error: why, doneAt: new Date().toISOString() });
    throw e;
  }

  const live = _patch(rec.id, {
    taskId: sub.taskId, provider: sub.provider, quality: sub.quality, aspect: sub.aspect,
    model: sub.model || '', tried: sub.tried || [], error: '', askedAt: new Date().toISOString(),
  });
  if (alertId) {
    try { require('./alerts').update(alertId, { taskIds: [sub.taskId], engine: live.engine }); }
    catch (e) { /* the row is a view of the record, not the record */ }
  }
  _watch(live);
  return live;
}

// Every record still marked pending when the server starts gets its watcher back. The record
// survived the restart; the loop did not.
function resume() {
  // A record from the chat whose task was never asked for: its asking died with the last run.
  // Only what an earlier run left: a record of this run is still being asked for.
  for (const r of _read()) {
    if (r && r.state === 'pending' && !r.taskId && String(r.at || '') < BOOT) _patch(r.id, { state: 'failed', stage: '', error: NOT_ASKED, doneAt: new Date().toISOString() });
  }
  const pending = _read().filter(r => r && r.state === 'pending' && r.taskId);
  if (!pending.length) return 0;
  console.log('[mv3-gens] resuming', pending.length, 'generation(s) left over from last run');
  for (const r of pending) _watch(r);
  return pending.length;
}

module.exports = { FILE, LOOSE_CAT, catLabelFor, list, get, start, resume,
                   // The chat's way (phase J): the record and its row at the press, the task behind it.
                   create, submit, stage, refuse, cancel, runningSends, asking: _asking,
                   // The analyst needs the same public links the engines get, and for the same
                   // reason: a model cannot read a path on this disk. uploadToPublicHost caches by
                   // the bytes, so hosting one reference twice in a minute costs one upload.
                   hostRefs: _hostRefs };
