'use strict';

// ════════════════════════════════════════════════════════════════════════════
// THE VIDEO CHAT'S RECORDS (phase V2, docs/local-app/PLAN.md "V-A", "V-E", "V-F") - data/mv3-video-gens.json.
//
// The same shape as the pictures chat's (lib/mv3-gens.js), because the same things are true of it:
//
//   AT THE PRESS (create)   the record, pending with no task, and its Alerts row (type 'video') with a `kick`
//                           and a stage in words - before anybody is asked for anything (CLAUDE.md V2). The
//                           route answers the page then; the rest goes on behind it.
//   BEHIND THE ANSWER       the references prepared and hosted, the prompt written (or the words as typed),
//   (submit)                the aggregator asked - down the record's ladder of aggregators that carry the model
//                           and have a key - each step checking the record is still ITS OWN (_ours: pending,
//                           not let go of, its row running on this kick with no task).
//   THE PAID MOMENT         `asked` is written just before the submit that costs money. A record found pending
//                           at boot with `asked` and no task may have been paid for: it is failed with words
//                           that say so, never silently asked again; one without `asked` was not paid for.
//   THE WATCHER             polls (lib/video-task.js), fetches the clip ONCE the moment it is done (results
//                           expire), makes it play in the browser, files it on the B-roll shelf in the project's
//                           category (lib/birols-store.js) with its poster, and writes what it really cost.
//   ENDS                    a moderation refusal is failed `refused` - Alerts offers no paid retry of a
//                           guaranteed "no" (lib/gen-refusal.js); a row that ends (timed out, let go of) takes
//                           its record with it (ALERTS.onEnd); a result that lands after a let-go is deleted.
//
// The Alerts row's job type 'video' only MIRRORS the record - polling it is free, and a clip cannot be
// waited for twice.
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
// ten minutes of silence (its 408); preparation and the writer come before that. The row waits 45 minutes.
const LIMIT_MS = 45 * 60 * 1000;
const BOOT = new Date().toISOString();
const KEEP_PER_PROJECT = 300;
const NOT_ASKED = 'the app was closed before the video was asked for - nothing was paid; send it again';
const MAYBE_PAID = 'the app was closed while the video was being asked for - it may have been paid for and not followed; look at the aggregator\'s own history before sending it again';

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

JOBS.register('video', {
  timeoutMs: LIMIT_MS,
  poll: async (rec) => {
    const p = (rec.job || {}).params || {};
    const g = get(p.genId);
    if (!g) return { state: 'failed', error: 'the record of this video is gone' };
    if (g.state === 'done') return { state: 'success', gen: g };
    if (g.state === 'failed') return { state: 'failed', error: g.error || 'the video was not made', refused: !!g.refused };
    if (!g.taskId && !(p.kick && _asking.has(p.kick))) {
      const why = g.asked ? MAYBE_PAID : NOT_ASKED;
      _patch(g.id, { state: 'failed', stage: '', error: why, doneAt: new Date().toISOString() });
      return { state: 'failed', error: why };
    }
    return { state: 'pending' };
  },
  file: async (_rec, out) => ({ path: out.gen.videoPath, media: 'video' }),
  busy: (rec) => _asking.has((((rec.job || {}).params || {}).kick) || ''),
  cancel: (rec) => cancel((((rec.job || {}).params || {}).genId) || ''),
  // "Try again" from Alerts: a new record from what the old one KEPT - the finished prompt and the library
  // paths (never the hosted links, which expire); the writer is not asked again.
  // The new record is asked for BEFORE it is tied to the row: during a retry the row is still failed (it is
  // restarted only with the new task), and a record tied to a failed row is not its asking's own (_ours).
  submit: async (request, row) => {
    const g = create(Object.assign({}, request || {}, { where: null }));
    const live = await submit(g.id, { prompt: g.prompt }, '');
    if (!live || !live.taskId) throw new Error((get(g.id) || {}).error || 'it could not be asked for');
    if (row && row.id) _patch(g.id, { alertId: row.id });
    return { taskId: live.taskId, params: { genId: g.id, kick: '' } };
  },
});

/** Let go of one video: it is not waited for, fetched or filed any more. */
function cancel(id) {
  const g = get(String(id || ''));
  if (!g || g.state !== 'pending') return null;
  return _patch(g.id, { state: 'failed', cancelled: true, stage: '', error: 'you stopped waiting for it', doneAt: new Date().toISOString() });
}

/** How many sends of a project's video chat are still being made. */
function runningSends(project) {
  const p = String(project == null ? '' : project);
  const sends = new Set();
  for (const r of _read()) if (r && String(r.project || '') === p && r.state === 'pending') sends.add(r.send || r.id);
  return sends.size;
}

const _request = (rec) => ({
  project: rec.project, model: rec.model, agg: rec.agg, prompt: rec.prompt, said: rec.said, lang: rec.lang,
  params: rec.params, media: rec.media, skill: rec.skill,
});

/**
 * At the press: the record, pending with no task, and (with `where`) its Alerts row.
 * opts: { project, send, kick, where, stage, model, agg, prompt, said, lang, params, media:[{path, kind, role, in, out}], skill }
 */
function create(opts) {
  const o = opts || {};
  const rec = {
    id: _newId(),
    project: String(o.project == null ? '' : o.project),
    send: String(o.send || ''),
    prompt: String(o.prompt || '').trim().slice(0, 30000),
    said: String(o.said || '').trim().slice(0, 20000),
    lang: String(o.lang || 'en'),
    model: String(o.model || ''), agg: String(o.agg || ''),
    params: (o.params && typeof o.params === 'object') ? o.params : {},
    media: (Array.isArray(o.media) ? o.media : []).filter(m => m && m.path).slice(0, 30).map(m => ({
      path: String(m.path), kind: String(m.kind || 'image'), role: String(m.role || ''),
      in: +m.in || 0, out: +m.out || 0,
    })),
    skill: o.skill || null,
    state: 'pending', stage: String(o.stage || '').slice(0, 120),
    hosted: [], rescued: false, asked: false,
    taskId: '', tried: [], fell: '', writer: '',
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

// The references, made reachable: library paths -> public links (R2). Pictures now; clips from V7.
async function _host(rec, fresh) {
  const out = [];
  for (const m of rec.media || []) {
    const abs = toDiskExisting(m.path);
    if (!abs || !fs.existsSync(abs)) throw new Error('a reference is not in the library any more: ' + m.path);
    if (FAKE.on()) { out.push(Object.assign({}, m, { url: FAKE.host(m.path) })); continue; }
    if (m.kind !== 'image') throw new Error('video and sound references come in a later step');
    const prepped = await require('./video-prep').image(abs, VM().pair(rec.model, rec.agg));
    const url = await uploadToPublicHost(prepped.buf, { ext: prepped.ext, verify: true, forceFresh: !!fresh });
    out.push(Object.assign({}, m, { url }));
  }
  return out;
}

/**
 * Ask for the task of a record made by create(): the prompt (`over.prompt`), the references hosted, the
 * aggregators of the ladder in turn. Never throws - a failure fails the record and its row.
 */
async function submit(id, over, kick) {
  const o = over || {};
  if (!_ours(id, kick)) return null;
  const words = {};
  if (o.prompt) words.prompt = String(o.prompt).trim().slice(0, 30000);
  if (o.sent) words.sent = String(o.sent).slice(0, 30000);
  if (o.lang) words.lang = String(o.lang);
  if (o.fell) words.fell = String(o.fell).slice(0, 300);
  if (o.writer) words.writer = String(o.writer).slice(0, 120);
  let rec = _patch(id, words);
  _rowRequest(rec);
  let hosted;
  try {
    if ((rec.media || []).length) stage(id, 'sending the references', kick);
    hosted = await _host(rec, false);
  } catch (e) {
    if (_ours(id, kick)) _fail(id, e.message);
    return null;
  }
  if (!_ours(id, kick)) return null;
  _patch(id, { hosted: hosted.map(h => ({ path: h.path, kind: h.kind, url: h.url })) });
  rec = get(id);

  const ladder = VM().ladder(rec.model, rec.agg);
  if (!ladder.length) { _fail(id, VM().noRoute(rec.model)); return null; }
  const tried = [];
  let last = '';
  for (const pair of ladder) {
    if (!_ours(id, kick)) return null;
    stage(id, 'asking ' + pair.aggLabel, kick);
    tried.push(pair.agg);
    let sub;
    try {
      // The agent's neutral {{image:1}} become THIS rung's own names (lib/video-models.js render).
      const req = { prompt: VM().render(pair, rec.sent || rec.prompt), media: hosted, params: rec.params, aspect: rec.params.aspect };
      VM().check(pair, req);                    // what this rung cannot take is refused before the money
      _patch(id, { asked: true });              // THE PAID MOMENT
      sub = await VT.submit(pair, req);
    } catch (e) {
      last = String((e && e.message) || e).slice(0, 300);
      _patch(id, { asked: false, error: pair.aggLabel + ': ' + last });
      console.warn('[mv3-video]', rec.model + '@' + pair.agg, 'refused:', last);
      if (REFUSAL.isRefusal(last)) break;       // another aggregator would refuse the same content too
      continue;
    }
    if (!_ours(id, kick)) {
      console.warn('[mv3-video] ' + id + ' was let go of while its task was asked for - task ' + sub.taskId + ' is not followed');
      return null;
    }
    const live = _patch(id, { taskId: sub.taskId, agg: pair.agg, tried, error: '', stage: '' });
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
  if (_ours(id, kick)) _fail(id, last || 'no aggregator could take it');
  return null;
}

function _rowRequest(rec) {
  if (!rec || !rec.alertId) return;
  const row = ALERTS.get(rec.alertId);
  if (!row || !row.job || row.state !== 'running') return;
  ALERTS.update(rec.alertId, { job: { ...row.job, params: { ...(row.job.params || {}), request: _request(rec) } } });
}

// ── The watcher ─────────────────────────────────────────────────────────────
const _waited = (id) => { const g = get(id); return !!g && g.state === 'pending' && !g.cancelled; };
const _live = new Set();


async function _land(rec, out) {
  // Into media/work/ first, named by the task so a second landing finds the same file.
  const name = PREFIX + '_' + String(rec.taskId).replace(/[^a-z0-9_-]/gi, '').slice(-24) + '.mp4';
  let local = '';
  if (out.local) local = out.local;
  else {
    const abs = path.join(MEDIA.work, name);
    if (!fs.existsSync(abs)) await VT.fetchTo(out.url, abs);
    try { await normalizeVideoForBrowser(abs); } catch (e) { console.warn('[mv3-video] could not normalise', name, '-', e.message); }
    local = '/' + path.relative(ROOT_DIR, abs).split(path.sep).join('/');
  }
  if (!_waited(rec.id)) {
    // Let go of while it was being fetched: it belongs to nothing.
    try { fs.unlinkSync(path.join(ROOT_DIR, local.replace(/^\/+/, ''))); } catch (e) { /* gone */ }
    return null;
  }
  const cur = get(rec.id) || rec;
  const pair = VM().pair(cur.model, cur.agg);
  const { item } = await require('./birols-store').add(local, {
    kind: 'birols',
    name: String(cur.said || cur.prompt || '').replace(/\s+/g, ' ').trim().slice(0, 60) || VM().label(cur.model),
    categoryLabel: catLabelFor(_titleOf(cur.project)),
    prompt: cur.sent || cur.prompt,
    refImage: ((cur.media || []).find(m => m.kind === 'image') || {}).path || '',
    meta: {
      project: cur.project || null, model: cur.model, agg: cur.agg, aggModel: pair ? pair.modelId : '',
      params: cur.params, prompt: cur.prompt, sent: cur.sent || '', said: cur.said, lang: cur.lang,
      skill: cur.skill ? { id: cur.skill.id, v: cur.skill.v, edited: !!cur.skill.edited } : null,
      media: (cur.media || []).map(m => ({ path: m.path, kind: m.kind, role: m.role })),
      credits: out.credits || 0, fake: !!cur.fake,
    },
  });
  return item;
}

function _watch(rec) {
  if (!rec || !rec.taskId || _live.has(rec.id)) return;
  _live.add(rec.id);
  const started = Date.now();
  (async () => {
    while (Date.now() - started < LIMIT_MS) {
      await new Promise(r => setTimeout(r, EVERY_MS));
      if (!_waited(rec.id)) { _live.delete(rec.id); return; }
      const cur = get(rec.id) || rec;
      let out;
      try { out = await VT.poll(cur.taskId); } catch (e) { continue; }
      if (out.state === 'pending') continue;
      if (out.state === 'success') {
        let item = null;
        try { item = await _land(cur, out); }
        catch (e) {
          console.warn('[mv3-video] could not land', cur.id, '-', e.message);
          if (_waited(cur.id)) _fail(cur.id, 'it was made, but could not be fetched or filed: ' + e.message);
          _live.delete(rec.id);
          return;
        }
        if (item && _waited(cur.id)) {
          _patch(cur.id, {
            state: 'done', videoPath: item.videoPath, posterPath: item.thumbPath || '', birolId: item.id,
            duration: item.duration || 0, w: item.w || 0, h: item.h || 0, audio: !!item.audio,
            credits: out.credits || 0, doneAt: new Date().toISOString(), secs: Math.round((Date.now() - Date.parse(cur.at || 0)) / 1000),
          });
          _trim(cur.project);
          console.log('[mv3-video] done', cur.id, cur.model + '@' + cur.agg, '->', item.videoPath);
        }
        _live.delete(rec.id);
        return;
      }
      // failed: the one failure worth a second try is OUR host not being read - the same rung, links made again.
      if (!cur.rescued && (cur.media || []).length && REFUSAL.isFetch(out.error)) {
        console.warn('[mv3-video] rescue', cur.id, '- the references could not be read; hosting them again');
        try {
          const hosted = await _host(cur, true);
          if (!_waited(cur.id)) { _live.delete(rec.id); return; }
          const pair = VM().pair(cur.model, cur.agg);
          _patch(cur.id, { asked: true });
          const sub = await VT.submit(pair, { prompt: VM().render(pair, cur.sent || cur.prompt), media: hosted, params: cur.params, aspect: cur.params.aspect });
          const live = _patch(cur.id, { taskId: sub.taskId, hosted: hosted.map(h => ({ path: h.path, kind: h.kind, url: h.url })), rescued: true,
            error: 'the references could not be read - they were sent again' });
          if (live.alertId) ALERTS.update(live.alertId, { taskIds: [sub.taskId] });
          _live.delete(rec.id);
          _watch(live);
          return;
        } catch (e2) { console.warn('[mv3-video] rescue failed for', cur.id, '-', e2.message); }
      }
      if (_waited(cur.id)) _fail(cur.id, out.error || 'the video was not made');
      _live.delete(rec.id);
      return;
    }
    console.log('[mv3-video] gave up watching', rec.id, '- still pending, the row decides');
    _live.delete(rec.id);
  })().catch(e => { _live.delete(rec.id); console.warn('[mv3-video] watcher crashed for', rec.id, '-', e.message); });
}

// A record ends with its row: a row that timed out or was let go of takes its record with it.
ALERTS.onEnd((row) => {
  if (!row || row.state !== 'failed' || ((row.job || {}).type) !== 'video') return;
  const g = get((((row.job || {}).params || {}).genId) || '');
  if (!g || g.state !== 'pending') return;
  _patch(g.id, { state: 'failed', stage: '', error: String(row.error || 'it did not come').slice(0, 400), cancelled: !!row.cancelled, doneAt: new Date().toISOString() });
});

/** At boot: records from an earlier run that were never asked for fail at once; the rest are followed again. */
function resume() {
  for (const r of _read()) {
    if (r && r.state === 'pending' && !r.taskId && String(r.at || '') < BOOT) {
      _patch(r.id, { state: 'failed', stage: '', error: r.asked ? MAYBE_PAID : NOT_ASKED, doneAt: new Date().toISOString() });
    }
  }
  const pending = _read().filter(r => r && r.state === 'pending' && r.taskId);
  for (const r of pending) _watch(r);
  if (pending.length) console.log('[mv3-video] resuming', pending.length, 'video(s) left over from last run');
  return pending.length;
}

module.exports = { FILE, list, get, create, submit, stage, refuse, cancel, runningSends, resume, asking: _asking,
                   catLabelFor, NOT_ASKED, MAYBE_PAID,
                   // for the stands: a watcher that looks every few milliseconds rather than every five seconds
                   _setEvery: (ms) => { EVERY_MS = ms; } };
