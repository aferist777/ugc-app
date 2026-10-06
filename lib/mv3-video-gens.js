'use strict';

// ════════════════════════════════════════════════════════════════════════════
// THE VIDEO CHAT'S RECORDS (phase V2, docs/local-app/PLAN.md "V-A", "V-E", "V-F") - data/mv3-video-gens.json.
//
// The same shape as the pictures chat's (lib/mv3-gens.js), because the same things are true of it:
//
//   AT THE PRESS (create)   the record, pending with no task, and its Alerts row (type 'video') with a `kick`
//                           and a stage in words - before anybody is asked for anything (CLAUDE.md V2). The
//                           route answers the page then; the rest goes on behind it.
//   BEHIND THE ANSWER       the prompt written (or the words as typed) - from then on the record is `ready`,
//   (submit)                and only a ready one can be tried again from Alerts: a retry sends what the
//                           record kept, and before that it kept the person's raw words -, the references
//                           prepared and hosted for each rung's own limits, the aggregator asked - down the
//                           record's ladder of aggregators that carry the model and have a key - each step
//                           checking the record is still ITS OWN (_ours: pending, not let go of, its row
//                           running on this kick with no task).
//   THE PAID MOMENT         `asked` is written just before the submit that costs money. A record found pending
//                           at boot with `asked` and no task may have been paid for: it is failed with words
//                           that say so, never silently asked again; one without `asked` was not paid for.
//                           A submit with NO ANSWER (lib/video-task.js `unsure`: a timeout, a 5xx) is the same
//                           case while the app runs: the ladder stops there - asking the next aggregator could
//                           be a second clip paid for - and the record fails in those words (review V2r).
//   THE WATCHER             polls (lib/video-task.js), fetches the clip ONCE the moment it is done (results
//                           expire) - a download that fails is tried again while the link may live -, makes it
//                           play in the browser, files it on the B-roll shelf in the project's category
//                           (lib/birols-store.js) with its poster, and writes what it really cost.
//   THE CLOCK               is the watcher's: 45 minutes from the moment the task was ASKED, judged only
//                           after a poll that says "still running". The Alerts row's own limit is a day's
//                           backstop: counted from the press, it went on counting while the app was closed or
//                           the computer asleep and failed - at the first tick of the next start, before the
//                           watcher had asked once - clips that had long been finished and paid for.
//   ENDS                    a moderation refusal is failed `refused` - Alerts offers no paid retry of a
//                           guaranteed "no" (lib/gen-refusal.js); a row that ends (let go of, the backstop)
//                           takes its record with it (ALERTS.onEnd); a result that lands after a let-go is
//                           deleted; a Replicate prediction let go of is cancelled.
//
// The Alerts row's job type 'video' only MIRRORS the record - polling it is free, and a clip cannot be
// waited for twice. It also gives a record with a task and no watcher its watcher back.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { DATA_DIR, MEDIA, ROOT_DIR } = require('./config');
const { writeFileAtomic } = require('./atomic-write');
const { uploadToPublicHost, normalizeVideoForBrowser } = require('./helpers');
const { toDiskExisting } = require('./media');
const FAKE = require('./fake-agg');
const VT = require('./video-task');
const REFUSAL = require('./gen-refusal');

const FILE = path.join(DATA_DIR, 'mv3-video-gens.json');
const PREFIX = 'mvid';
let EVERY_MS = 5000;
// Kling motion control took 7-13.5 minutes for 11-16 s clips on Replicate, and kie gives up on its own side at
// ten minutes of silence (its 408). The watcher waits 45 minutes from the ask.
let LIMIT_MS = 45 * 60 * 1000;
// The row's backstop: results expire in about a day, and a record nothing can watch must still end some time.
const ROW_LIMIT_MS = 24 * 60 * 60 * 1000;
// A finished clip whose download fails is fetched again, waiting longer each time: about five minutes in all.
const FETCH_TRIES = 10;
const BOOT = new Date().toISOString();
const KEEP_PER_PROJECT = 300;
const NOT_ASKED = 'the app was closed before the video was asked for - nothing was paid; send it again';
const NOT_WRITTEN = 'the app was closed before the prompt of this video was written - nothing was paid; send it again from the chat';
const MAYBE_PAID = 'the app was closed while the video was being asked for - it may have been paid for and not followed; look at the aggregator\'s own history before sending it again';
const NOT_READY = 'it stopped before its prompt was written - send it again from the chat';

const VM = () => require('./video-models');

// ── The file ────────────────────────────────────────────────────────────────
function _read() {
  try { const l = JSON.parse(fs.readFileSync(FILE, 'utf8')); return Array.isArray(l) ? l : []; }
  catch (e) { return []; }
}
function _write(list) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  writeFileAtomic(FILE, JSON.stringify(list, null, 2));
}
const _newId = () => 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
function _patch(id, fields) {
  const l = _read();
  const i = l.findIndex(r => r && r.id === id);
  if (i < 0) return null;
  l[i] = Object.assign({}, l[i], fields);
  _write(l);
  return l[i];
}
function list(project) {
  const p = String(project == null ? '' : project);
  return _read().filter(r => r && String(r.project || '') === p);
}
const get = (id) => _read().find(r => r && r.id === id) || null;
function _trim(project) {
  const all = _read();
  const mine = all.filter(r => r && String(r.project || '') === String(project || ''));
  if (mine.length <= KEEP_PER_PROJECT) return;
  const doomed = new Set(mine.filter(r => r.state !== 'pending')
    .sort((a, b) => String(a.at).localeCompare(String(b.at)))
    .slice(0, mine.length - KEEP_PER_PROJECT).map(r => r.id));
  if (doomed.size) _write(all.filter(r => !doomed.has(r.id)));
}

// The project's title, read when the clip lands (it may have been renamed since the press).
function _titleOf(key) {
  if (!key) return '';
  try { const rec = require('./merge-store').read().timelines[key]; return (rec && rec.title) || ''; }
  catch (e) { return ''; }
}
const catLabelFor = (title) => require('./mv3-gens').catLabelFor(title);

// ── The journal ─────────────────────────────────────────────────────────────
const JOBS = require('./gen-jobs');
const ALERTS = require('./alerts');
const _asking = new Set();
const _live = new Set();

JOBS.register('video', {
  timeoutMs: ROW_LIMIT_MS,
  poll: async (rec) => {
    const p = (rec.job || {}).params || {};
    const g = get(p.genId);
    if (!g) return { state: 'failed', error: 'the record of this video is gone' };
    if (g.state === 'done') return { state: 'success', gen: g };
    if (g.state === 'failed') return { state: 'failed', error: g.error || 'the video was not made', refused: !!g.refused };
    if (!g.taskId && !(p.kick && _asking.has(p.kick))) {
      const why = g.asked ? MAYBE_PAID : g.ready ? NOT_ASKED : NOT_WRITTEN;
      _patch(g.id, { state: 'failed', stage: '', error: why, doneAt: new Date().toISOString() });
      return { state: 'failed', error: why };
    }
    // A task nobody is watching (its watcher crashed, or this is the first tick of a start): watched again.
    if (g.taskId && !_live.has(g.id)) _watch(g);
    return { state: 'pending' };
  },
  file: async (_rec, out) => ({ path: out.gen.videoPath, media: 'video' }),
  busy: (rec) => _asking.has((((rec.job || {}).params || {}).kick) || ''),
  // Only a row whose prompt was written has anything to send again (the request is kept on the row).
  canRetry: (rec) => !!((((rec.job || {}).params || {}).request || {}).ready),
  cancel: (rec) => cancel((((rec.job || {}).params || {}).genId) || ''),
  // "Try again" from Alerts: a new record from what the old one KEPT - the finished prompt and the library
  // paths (never the hosted links, which expire); the writer is not asked again. A record stopped before its
  // prompt was written kept only the person's words, and those are never sent as they are (V2r).
  // The new record is asked for BEFORE it is tied to the row: during a retry the row is still failed (it is
  // restarted only with the new task), and a record tied to a failed row is not its asking's own (_ours).
  submit: async (request, row) => {
    const rq = request || {};
    if (!rq.ready) throw new Error(NOT_READY);
    if (rq.fake && !FAKE.on()) throw new Error('this was a test clip of the fake aggregator - it is not sent to a real one');
    // (review V7) Clips or sounds are PREPARED before the asking - minutes of ffmpeg, a render waited out - so not inside
    // the press of "try again": the row restarts now on a kick of its own, tied to the new record, and the asking goes on
    // behind it with its stages and its cross, as on a first send (lib/gen-jobs.js `later`).
    if (row && row.id && (rq.media || []).some(m => m && (m.kind === 'video' || m.kind === 'audio'))) {
      const kick = 'r' + require('crypto').randomBytes(8).toString('hex');
      _asking.add(kick);
      let g;
      try { g = _patch(create(Object.assign({}, rq, { where: null })).id, { alertId: row.id }); }
      catch (e) { _asking.delete(kick); throw e; }
      const over = { prompt: g.prompt, sent: g.sent || '', lang: g.lang };
      return {
        params: { genId: g.id, kick }, stage: 'preparing the references',
        later: async () => {
          try {
            if (g.zh && !g.sent) {
              let tr;
              try { tr = await require('./mv3-agent').toChinese(g.prompt); } catch (e) { tr = { fail: e.message }; }
              if (tr.text) Object.assign(over, { sent: tr.text, lang: 'zh' });
              else Object.assign(over, { lang: 'en', fell: 'sent in English - ' + String(tr.fail || 'it was not translated').slice(0, 200) });
            }
            await submit(g.id, over, kick);
          } catch (e) { abandon(g.id, kick, e); }
          finally { _asking.delete(kick); }
        },
      };
    }
    const g = create(Object.assign({}, rq, { where: null }));
    const over = { prompt: g.prompt, sent: g.sent || '', lang: g.lang };
    // Asked for in Chinese but stopped before the translation (the app closed, the row let go of): translated now - or
    // the English goes, and the record says why (review V6).
    if (g.zh && !g.sent) {
      let tr;
      try { tr = await require('./mv3-agent').toChinese(g.prompt); } catch (e) { tr = { fail: e.message }; }
      if (tr.text) Object.assign(over, { sent: tr.text, lang: 'zh' });
      else Object.assign(over, { lang: 'en', fell: 'sent in English - ' + String(tr.fail || 'it was not translated').slice(0, 200) });
    }
    const live = await submit(g.id, over, '');
    if (!live || !live.taskId) throw new Error((get(g.id) || {}).error || 'it could not be asked for');
    if (row && row.id) _patch(g.id, { alertId: row.id });
    return { taskId: live.taskId, params: { genId: g.id, kick: '' } };
  },
});

/** Let go of one video: it is not waited for, fetched or filed any more - and a Replicate task is stopped. */
function cancel(id) {
  const g = get(String(id || ''));
  if (!g || g.state !== 'pending') return null;
  const out = _patch(g.id, { state: 'failed', cancelled: true, stage: '', error: 'you stopped waiting for it', doneAt: new Date().toISOString() });
  if (g.taskId) VT.cancel(g.taskId);
  _letGo(g.id);
  return out;
}

// (phase V7) A clip or a sound being PREPARED for a record (ffmpeg, lib/video-prep.js) stops the moment the record is
// let go of - the cross does not wait for the end of a step that is minutes of work.
const _prepping = new Map();          // record id -> AbortController
function _prepCtl(id) {
  const c = new AbortController();
  _prepping.set(id, c);
  return c;
}
function _letGo(id) {
  const c = _prepping.get(id);
  if (c) { _prepping.delete(id); try { c.abort(); } catch (e) { /* gone */ } }
}

/** How many sends of a project's video chat are still being made - each make of a card its own (its `part`). */
function runningSends(project) {
  const p = String(project == null ? '' : project);
  const sends = new Set();
  for (const r of _read()) if (r && String(r.project || '') === p && r.state === 'pending') sends.add((r.send || r.id) + (r.part ? '#' + r.part : ''));
  return sends.size;
}

const _request = (rec) => ({
  project: rec.project, model: rec.model, agg: rec.agg, prompt: rec.prompt, said: rec.said, lang: rec.lang, sent: rec.sent || '', zh: !!rec.zh,
  params: rec.params, media: rec.media, skill: rec.skill, ready: !!rec.ready, fake: !!rec.fake, catLabel: rec.catLabel || '',
});

/**
 * At the press: the record, pending with no task, and (with `where`) its Alerts row.
 * opts: { project, send, kick, where, stage, model, agg, prompt, said, lang, params, media:[{path, kind, role, in, out}], skill, ready }
 */
function create(opts) {
  const o = opts || {};
  const project = String(o.project == null ? '' : o.project);
  const rec = {
    id: _newId(),
    project,
    send: String(o.send || ''),
    // Which make of its card it is (the owner, 2026-10-06: a made card is made again from its field) - each one a send.
    part: String(o.part || '').slice(0, 12),
    prompt: String(o.prompt || '').trim().slice(0, 30000),
    said: String(o.said || '').trim().slice(0, 20000),
    lang: String(o.lang || 'en'),
    // What went to the model when it is not the prompt - the builder's 中文 (phase V6); a retry sends it again.
    sent: String(o.sent || '').trim().slice(0, 30000),
    // The 中文 box was ticked: a retry of a record that never got as far as its translation translates it then.
    zh: !!o.zh,
    model: String(o.model || ''), agg: String(o.agg || ''),
    params: (o.params && typeof o.params === 'object') ? o.params : {},
    media: (Array.isArray(o.media) ? o.media : []).filter(m => m && m.path).slice(0, 30).map(m => ({
      path: String(m.path), kind: String(m.kind || 'image'), role: String(m.role || ''),
      in: +m.in || 0, out: +m.out || 0,
    })),
    skill: o.skill || null,
    // The shelf category it will be filed under, as it is at the press - what it lands under if the project is
    // gone by then (the title is read again at the landing, for a rename).
    catLabel: _titleOf(project) ? catLabelFor(_titleOf(project)) : (String(o.catLabel || '') || catLabelFor('')),
    state: 'pending', stage: String(o.stage || '').slice(0, 120),
    hosted: [], rescued: false, asked: false, ready: !!o.ready,
    taskId: '', askedAt: '', tried: [], fell: '', writer: '',
    videoPath: '', posterPath: '', birolId: '', duration: 0, w: 0, h: 0, audio: false, credits: 0,
    error: '', refused: false, alertId: '',
    at: new Date().toISOString(), doneAt: '', secs: 0,
  };
  if (FAKE.on()) rec.fake = true;
  if (!rec.model) throw new Error('a model is needed');
  const l = _read();
  l.unshift(rec);
  _write(l);
  if (o.where) {
    try {
      const row = JOBS.submitted({
        kind: 'video', what: 'video',
        title: 'Video · ' + (rec.fake ? 'FAKE · ' : '') + (rec.said || rec.prompt || VM().label(rec.model)).replace(/\s+/g, ' ').slice(0, 60),
        where: o.where, engine: rec.model, taskIds: [], stage: rec.stage,
        job: { type: 'video', params: { genId: rec.id, kick: o.kick || '', request: _request(rec) } },
      });
      return _patch(rec.id, { alertId: row.id });
    } catch (e) { console.warn('[mv3-video] could not write the alert:', e.message); }
  }
  return rec;
}

// Still this asking's: pending, not let go of, and its row - when it has one - running on this kick with no task.
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

function _fail(id, why, extra) {
  const refused = !!(extra && extra.refused) || REFUSAL.isRefusal(why);
  const g = _patch(id, { state: 'failed', stage: '', error: String(why || 'it was not made').slice(0, 400), refused, doneAt: new Date().toISOString() });
  if (g && g.alertId) ALERTS.fail(g.alertId, g.error, refused ? { refused: true } : undefined);
  return g;
}

/** Fail a record that will not be asked for - the writer asked a question instead, a check refused it. */
function refuse(id, why, kick) {
  if (!_ours(id, kick)) return;
  _fail(id, why, { refused: true });
}

/** The work behind the answer broke off (an error nobody expected): a record that may have been paid for says so. */
function abandon(id, kick, err) {
  if (!_ours(id, kick)) return;
  const g = get(id);
  const why = String((err && err.message) || err || 'an error');
  if (g && g.asked) _fail(id, 'it broke off while the video was being asked for (' + why + ') - it may have been paid for and not followed; look at the aggregator\'s own history before sending it again');
  else _fail(id, 'it stopped before it was asked for: ' + why);
}

// The references, made reachable for ONE rung: library paths -> public links (R2), each fitted to that rung's own
// limits - a picture's format, megabytes and sides (Grok 1.5 takes 20 MB on kie and 10 MB on Replicate); a clip's or a
// sound's chosen part cut and made to measure (phase V7, lib/video-prep.js), said in the record's stage as it goes and
// stopped by `ctl.signal` (the cross). A part that cannot be made - too long, a shape the model refuses - is `gone`:
// another rung would not do better with the same file.
async function _host(rec, pair, fresh, ctl) {
  const VP = require('./video-prep');
  const c = ctl || {};
  const out = [];
  const media = rec.media || [];
  const clips = media.filter(m => m.kind === 'video');
  const sounds = media.filter(m => m.kind === 'audio');
  for (const m of media) {
    const abs = toDiskExisting(m.path);
    if (!abs || !fs.existsSync(abs)) throw Object.assign(new Error('a reference is not in the library any more: ' + m.path), { gone: true });
    if (FAKE.on()) { out.push(Object.assign({}, m, { url: FAKE.host(m.path) })); continue; }
    let prepped;
    // (review V7) Looked up again after a wait for a render: a project renamed meanwhile has moved the file.
    const here = () => toDiskExisting(m.path) || abs;
    try {
      if (m.kind === 'video') {
        if (c.say) c.say('preparing clip ' + (clips.indexOf(m) + 1) + ' of ' + clips.length);
        prepped = await VP.clip(here, pair, { from: m.in, to: m.out, signal: c.signal, onWait: c.say });
      } else if (m.kind === 'audio') {
        if (c.say) c.say('preparing sound ' + (sounds.indexOf(m) + 1) + ' of ' + sounds.length);
        prepped = await VP.sound(here, pair, { from: m.in, to: m.out, signal: c.signal, onWait: c.say });
      } else prepped = await VP.image(abs, pair);
    } catch (e) {
      if (e && e.aborted) throw e;
      throw Object.assign(e instanceof Error ? e : new Error(String(e)), { gone: m.kind !== 'image' });
    }
    if (c.say && m.kind !== 'image') c.say('sending the references');
    const url = await uploadToPublicHost(prepped.buf, { ext: prepped.ext, verify: true, forceFresh: !!fresh });
    out.push(Object.assign({}, m, { url }));
  }
  return out;
}
// What a rung's references are made to: the same for two rungs with the same limits, which then share the links.
const _hostKey = (pair) => JSON.stringify([(pair.limits || {}).image || {}, (pair.limits || {}).video || {}, (pair.limits || {}).audio || {}]);
const _hostedOf = (hosted) => hosted.map(h => ({ path: h.path, kind: h.kind, url: h.url }));

// What a submit with no answer leaves behind, in the person's words.
const _unsureWords = (pair, e) => String((e && e.message) || 'no answer') + ' - it may have been paid for and not followed; look at ' + pair.aggLabel + '\'s own history before sending it again';

/**
 * Ask for the task of a record made by create(): the prompt (`over.prompt`), the references hosted, the
 * aggregators of the ladder in turn. Never throws - a failure fails the record and its row.
 */
async function submit(id, over, kick) {
  const o = over || {};
  if (!_ours(id, kick)) return null;
  const words = {};
  if (o.prompt) { words.prompt = String(o.prompt).trim().slice(0, 30000); words.ready = true; }
  if (o.sent) words.sent = String(o.sent).slice(0, 30000);
  if (o.lang) words.lang = String(o.lang);
  if (o.fell) words.fell = String(o.fell).slice(0, 300);
  if (o.writer) words.writer = String(o.writer).slice(0, 120);
  let rec = _patch(id, words);
  _rowRequest(rec);

  const ladder = VM().ladder(rec.model, rec.agg);
  if (!ladder.length) { _fail(id, VM().noRoute(rec.model)); return null; }
  // A rung with the same limits as one before it takes the same links: uploaded once.
  const hostedFor = new Map();
  const tried = [];
  const reasons = [];
  const ctl = { signal: _prepCtl(id).signal, say: (w) => stage(id, w, kick) };
  try {
    for (const pair of ladder) {
      if (!_ours(id, kick)) return null;
      let hosted;
      try {
        const k = _hostKey(pair);
        if (!hostedFor.has(k)) {
          if ((rec.media || []).length) stage(id, 'sending the references', kick);
          hostedFor.set(k, await _host(rec, pair, false, ctl));
        }
        hosted = hostedFor.get(k);
      } catch (e) {
        if (!_ours(id, kick)) return null;
        if (e.gone) { _fail(id, e.message); return null; }
        reasons.push(pair.aggLabel + ': ' + String(e.message || e).slice(0, 300));
        continue;
      }
      if (!_ours(id, kick)) return null;
      // The agent's neutral {{image:1}} become THIS rung's own names (lib/video-models.js render).
      const req = { prompt: VM().render(pair, rec.sent || rec.prompt, { media: hosted }), media: hosted, params: rec.params, aspect: rec.params.aspect };
      try { VM().check(pair, req); }                // what this rung cannot take is skipped before the money
      catch (e) { reasons.push(pair.aggLabel + ': ' + e.message); continue; }
      stage(id, 'asking ' + pair.aggLabel, kick);
      tried.push(pair.agg);
      _patch(id, { asked: true });                  // THE PAID MOMENT
      let sub;
      try {
        sub = await VT.submit(pair, req);
      } catch (e) {
        const why = String((e && e.message) || e).slice(0, 300);
        console.warn('[mv3-video]', rec.model + '@' + pair.agg, e.unsure ? 'no answer:' : 'refused:', why);
        if (e.unsure) {
          // No answer is no "no": the task may exist. Not the next aggregator - that could be a second clip paid for.
          _patch(id, { tried });
          if (_ours(id, kick)) _fail(id, _unsureWords(pair, e));
          return null;
        }
        _patch(id, { asked: false, tried, error: pair.aggLabel + ': ' + why });
        reasons.push(why);
        if (REFUSAL.isRefusal(why)) break;          // another aggregator would refuse the same content too
        continue;
      }
      if (!_ours(id, kick)) {
        console.warn('[mv3-video] ' + id + ' was let go of while its task was asked for - task ' + sub.taskId + ' is not followed');
        VT.cancel(sub.taskId);
        return null;
      }
      const live = _patch(id, { taskId: sub.taskId, agg: pair.agg, tried, hosted: _hostedOf(hosted), askedAt: new Date().toISOString(), error: '', stage: '' });
      if (live.alertId) {
        const row = ALERTS.get(live.alertId);
        ALERTS.update(live.alertId, {
          taskIds: [sub.taskId], engine: live.model, stage: '',
          job: { type: 'video', params: { ...(((row || {}).job || {}).params || {}), genId: id, request: _request(live) } },
        });
      }
      _watch(live);
      return live;
    }
    if (_ours(id, kick)) _fail(id, reasons.join(' · ') || 'no aggregator could take it');
    return null;
  } finally {
    // Its preparation is over, one way or another: the cross has nothing to stop any more.
    if (_prepping.get(id) && _prepping.get(id).signal === ctl.signal) _prepping.delete(id);
  }
}

function _rowRequest(rec) {
  if (!rec || !rec.alertId) return;
  const row = ALERTS.get(rec.alertId);
  if (!row || !row.job || row.state !== 'running') return;
  ALERTS.update(rec.alertId, { job: { ...row.job, params: { ...(row.job.params || {}), request: _request(rec) } } });
}

// ── The watcher ─────────────────────────────────────────────────────────────
const _waited = (id) => { const g = get(id); return !!g && g.state === 'pending' && !g.cancelled; };
const _sleep = (ms) => new Promise(r => setTimeout(r, ms));
const _unlink = (url) => { try { fs.unlinkSync(path.join(ROOT_DIR, String(url || '').replace(/^\/+/, ''))); } catch (e) { /* gone */ } };

// The clip into media/work/, named by the task so a second landing finds the same file.
async function _fetch(rec, out) {
  if (out.local) return out.local;
  const name = PREFIX + '_' + String(rec.taskId).replace(/[^a-z0-9_-]/gi, '').slice(-24) + '.mp4';
  const abs = path.join(MEDIA.work, name);
  if (!fs.existsSync(abs)) await VT.fetchTo(out.url, abs);
  try { await normalizeVideoForBrowser(abs); } catch (e) { console.warn('[mv3-video] could not normalise', name, '-', e.message); }
  return '/' + path.relative(ROOT_DIR, abs).split(path.sep).join('/');
}

// (phase V7.4) THE CLIP'S SOUND UNDER THE RESULT, where the model did not keep it itself (decided 2026-10-05: the cheap
// aggregator stays cheap): Kling motion control on kie - Replicate keeps it through its own field - when the person
// kept the clip's sound, and Seedance asked for the clip's sound rather than its own (`sound: 'clip'`, its own switched
// off). The part of the FIRST clip that went. Decided by the rung that made it, so a ladder that fell from one
// aggregator to the other lays it only where it is needed.
function _underlayOf(rec) {
  const p = rec.params || {};
  const vid = (rec.media || []).find(m => m && m.kind === 'video');
  const pair = vid ? VM().pair(rec.model, rec.agg) : null;
  if (!pair) return null;
  if (pair.family === 'kmc') return (p.keepSound !== false && !pair.keepSound) ? vid : null;
  if (pair.family === 'seedance') return p.sound === 'clip' ? vid : null;
  return null;
}
// Laid under the fetched clip in media/work: 'laid', or why not in words - the clip stays as it came either way.
async function _layUnder(local, under, signal) {
  const abs = path.join(ROOT_DIR, String(local || '').replace(/^\/+/, ''));
  const src = toDiskExisting(under.path);
  if (!src || !fs.existsSync(src)) return 'not laid under - the clip is not in the library any more';
  try {
    // The source looked up when it is copied (a rename meanwhile has moved it); the cross stops it (review V7).
    const r = await require('./video-prep').layUnder(abs, () => toDiskExisting(under.path) || src, { from: under.in, to: under.out, signal });
    return r.laid ? 'laid' : 'not laid under - ' + r.why;
  } catch (e) {
    if (e && e.aborted) return 'let go of';
    return 'not laid under - ' + e.message;
  }
}

// Onto the B-roll shelf. Null when it was let go of meanwhile - then the clip is gone, never filed.
async function _file(rec, local, out) {
  const pair = VM().pair(rec.model, rec.agg);
  // The project's title now (a rename since the press), or the label of the press when the project is gone.
  const title = _titleOf(rec.project);
  const { item } = await require('./birols-store').add(local, {
    kind: 'birols',
    name: String(rec.said || rec.prompt || '').replace(/\s+/g, ' ').trim().slice(0, 60) || VM().label(rec.model),
    categoryLabel: title ? catLabelFor(title) : (rec.catLabel || catLabelFor('')),
    prompt: rec.sent || rec.prompt,
    refImage: ((rec.media || []).find(m => m.kind === 'image') || {}).path || '',
    meta: {
      project: rec.project || null, model: rec.model, agg: rec.agg, aggModel: pair ? pair.modelId : '',
      params: rec.params, prompt: rec.prompt, sent: rec.sent || '', said: rec.said, lang: rec.lang,
      skill: rec.skill ? { id: rec.skill.id, v: rec.skill.v, edited: !!rec.skill.edited } : null,
      media: (rec.media || []).map(m => ({ path: m.path, kind: m.kind, role: m.role })),
      credits: out.credits || 0, fake: !!rec.fake,
      underlay: out.under || '',
    },
    // Asked in the same tick as the record is written: a cross pressed while the poster was made drops the clip.
    wanted: () => _waited(rec.id),
  });
  return item;
}

// One watcher per record. Answers the record to watch next (a rescue's new task) or null.
async function _watchLoop(rec) {
  const askedAt = Date.parse(rec.askedAt || rec.at || '') || Date.now();
  let fetchFails = 0;
  for (;;) {
    await _sleep(EVERY_MS * Math.max(1, fetchFails));
    if (!_waited(rec.id)) return null;
    const cur = get(rec.id) || rec;
    if (cur.taskId !== rec.taskId) return null;
    let out;
    try { out = await VT.poll(cur.taskId); } catch (e) { continue; }
    if (out.state === 'pending') {
      // The clock, judged after a poll: a start after hours away asks once before anything is given up.
      if (Date.now() - askedAt > LIMIT_MS) {
        if (_waited(cur.id)) {
          _fail(cur.id, 'it did not come in ' + Math.round(LIMIT_MS / 60000) + ' minutes');
          VT.cancel(cur.taskId);
        }
        return null;
      }
      continue;
    }
    if (out.state === 'success') {
      let local;
      try { local = await _fetch(cur, out); }
      catch (e) {
        if (!_waited(cur.id)) return null;
        fetchFails++;
        if (e.permanent || fetchFails >= FETCH_TRIES) {
          _fail(cur.id, 'it was made, but could not be fetched: ' + e.message);
          return null;
        }
        console.warn('[mv3-video] could not fetch', cur.id, '(' + fetchFails + ') -', e.message, '- trying again');
        continue;
      }
      if (!_waited(cur.id)) { _unlink(local); return null; }   // let go of while it was being fetched
      // (phase V7.4) The clip's sound under it, where the model did not keep it itself - said as the record's stage.
      const under = _underlayOf(cur);
      if (under) {
        const g = _patch(cur.id, { stage: 'laying the clip\'s sound under it' });
        if (g && g.alertId) ALERTS.update(g.alertId, { stage: g.stage });
        const ctl = _prepCtl(cur.id);
        try { out.under = await _layUnder(local, under, ctl.signal); }
        finally { if (_prepping.get(cur.id) === ctl) _prepping.delete(cur.id); }
        if (out.under !== 'laid') console.warn('[mv3-video]', cur.id, out.under);
        if (!_waited(cur.id)) { _unlink(local); return null; }
      }
      let item = null;
      let why = '';
      try { item = await _file(get(cur.id) || cur, local, out); }
      catch (e) { why = e.message; console.warn('[mv3-video] could not file', cur.id, '-', e.message); }
      if (!_waited(cur.id)) return null;
      const now = { doneAt: new Date().toISOString(), secs: Math.round((Date.now() - Date.parse(cur.at || 0)) / 1000), credits: out.credits || 0 };
      if (item) {
        _patch(cur.id, Object.assign({
          state: 'done', stage: '', videoPath: item.videoPath, posterPath: item.thumbPath || '', birolId: item.id,
          duration: item.duration || 0, w: item.w || 0, h: item.h || 0, audio: !!item.audio,
        }, out.under ? { underlay: out.under } : {}, now));
        console.log('[mv3-video] done', cur.id, cur.model + '@' + cur.agg, '->', item.videoPath);
      } else if (why) {
        // Made and fetched, not filed: it is kept where it is, and the chat and Alerts still lead to it.
        _patch(cur.id, Object.assign({ state: 'done', stage: '', videoPath: local, error: 'it is not on the B-roll shelf: ' + why },
          out.under ? { underlay: out.under } : {}, now));
        console.log('[mv3-video] done but not filed', cur.id, '->', local);
      }
      _trim(cur.project);
      return null;
    }
    // failed: the one failure worth a second try is OUR host not being read - the same rung, links made again.
    if (!cur.rescued && (cur.media || []).length && REFUSAL.isFetch(out.error)) {
      console.warn('[mv3-video] rescue', cur.id, '- the references could not be read; hosting them again');
      const pair = VM().pair(cur.model, cur.agg);
      let hosted;
      // A clip made again for the new links can be let go of too, like the first preparation.
      const ctl = { signal: _prepCtl(cur.id).signal };
      try { hosted = await _host(cur, pair, true, ctl); }
      catch (e2) { console.warn('[mv3-video] rescue failed for', cur.id, '-', e2.message); hosted = null; }
      finally { if (_prepping.get(cur.id) && _prepping.get(cur.id).signal === ctl.signal) _prepping.delete(cur.id); }
      if (!_waited(cur.id)) return null;
      if (hosted) {
        // Written before the money, together: a start that finds it half-done never rescues it a second time.
        _patch(cur.id, { asked: true, rescued: true });
        try {
          const req = { prompt: VM().render(pair, cur.sent || cur.prompt, { media: hosted }), media: hosted, params: cur.params, aspect: cur.params.aspect };
          const sub = await VT.submit(pair, req);
          if (!_waited(cur.id)) { VT.cancel(sub.taskId); return null; }
          const live = _patch(cur.id, { taskId: sub.taskId, hosted: _hostedOf(hosted), askedAt: new Date().toISOString(),
            error: 'the references could not be read - they were sent again' });
          if (live.alertId) ALERTS.update(live.alertId, { taskIds: [sub.taskId] });
          return live;
        } catch (e3) {
          console.warn('[mv3-video] rescue failed for', cur.id, '-', e3.message);
          if (e3.unsure && _waited(cur.id)) { _fail(cur.id, _unsureWords(pair, e3)); return null; }
        }
      }
    }
    if (_waited(cur.id)) {
      // kie's own ten minutes: a long motion control clip is the usual case, and Replicate has no such limit.
      const why = out.late && VM().pair(cur.model, cur.agg) && VM().pair(cur.model, cur.agg).family === 'kmc'
        ? out.error + ' - long motion control clips go better on Replicate' : out.error;
      _fail(cur.id, why || 'the video was not made');
    }
    return null;
  }
}

function _watch(rec) {
  if (!rec || !rec.taskId || _live.has(rec.id)) return;
  _live.add(rec.id);
  _watchLoop(rec)
    .catch(e => { console.warn('[mv3-video] watcher crashed for', rec.id, '-', e.message); return null; })
    .then((next) => { _live.delete(rec.id); if (next) _watch(next); });
}

// A record ends with its row: a row let go of (or past its backstop) takes its record with it.
ALERTS.onEnd((row) => {
  if (!row || row.state !== 'failed' || ((row.job || {}).type) !== 'video') return;
  const g = get((((row.job || {}).params || {}).genId) || '');
  if (!g || g.state !== 'pending') return;
  _patch(g.id, { state: 'failed', stage: '', error: String(row.error || 'it did not come').slice(0, 400), cancelled: !!row.cancelled, doneAt: new Date().toISOString() });
  if (g.taskId) VT.cancel(g.taskId);
  _letGo(g.id);
});

/** At boot: records from an earlier run that were never asked for fail at once; the rest are followed again. */
function resume() {
  for (const r of _read()) {
    if (r && r.state === 'pending' && !r.taskId && String(r.at || '') < BOOT) {
      _patch(r.id, { state: 'failed', stage: '', error: r.asked ? MAYBE_PAID : r.ready ? NOT_ASKED : NOT_WRITTEN, doneAt: new Date().toISOString() });
    }
  }
  const pending = _read().filter(r => r && r.state === 'pending' && r.taskId);
  for (const r of pending) _watch(r);
  if (pending.length) console.log('[mv3-video] resuming', pending.length, 'video(s) left over from last run');
  return pending.length;
}

module.exports = { FILE, list, get, create, submit, stage, refuse, abandon, cancel, runningSends, resume, asking: _asking,
                   ours: _ours, catLabelFor, NOT_ASKED, NOT_WRITTEN, MAYBE_PAID,
                   // for the stands: a watcher that looks every few milliseconds, and a shorter clock
                   _setEvery: (ms) => { EVERY_MS = ms; }, _setLimit: (ms) => { LIMIT_MS = ms; } };
