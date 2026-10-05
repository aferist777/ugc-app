'use strict';

// ════════════════════════════════════════════════════════════════════════════
// ALERTS — the journal of every paid generation of a picture, a video or music.
//
// What the Alerts button on every page lists (docs/local-app/PLAN.md, "Alerts"). One record per
// generation, from the moment it is asked for until somebody clears it:
//
//   running  a provider is working on it
//   done     the result exists and has been filed where it belongs - `result.path` is it
//   failed   it did not come - `error` says why, in words for the person
//
// THE RULE THIS SERVES. A generation is finished by the SERVER, never by the page that asked for
// it: pages are separate addresses, and a result the page was going to file is lost the moment
// somebody leaves it. So the record carries what finishing needs (`job`), a runner on the server
// works through the running ones (lib/gen-jobs.js), and a page only follows the record. The
// record also carries where it was started (`where.href`), so the list can take you back there.
//
// Voices are not here: a read takes seconds, and a list of them would bury what is worth waiting
// for. The Scenarios page is not here either - it is being removed whole (PLAN, phase G).
//
// NOT THE PERSON'S WORK. The journal is a view of work in flight and of what came of it: an export
// leaves it out (lib/layout.js STORES_LEFT_OUT), and when files move, the paths in it are
// rewritten along with every other store (lib/relocate.js), so "open" still finds the result.
// Finished records are kept until cleared, but only the newest KEEP_FINISHED of them; a running
// one is never dropped.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { writeFileAtomic } = require('./atomic-write');
const { DATA_DIR } = require('./config');

const FILE = path.join(DATA_DIR, 'alerts.json');
const KEEP_FINISHED = 300;

const KINDS = ['image', 'video', 'music'];
const MEDIA = ['image', 'video', 'audio'];

const _str = (v, n) => String(v == null ? '' : v).trim().slice(0, n || 500);
const _finished = (r) => r && (r.state === 'done' || r.state === 'failed');

function _read() {
  try {
    const d = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return Array.isArray(d) ? d.filter(r => r && r.id) : [];
  } catch (e) {
    return [];
  }
}

// Every running record, and the newest finished ones up to the limit. Newest first throughout:
// the list is read from the top.
function _write(list) {
  const running = list.filter(r => !_finished(r));
  const finished = list.filter(_finished).slice(0, KEEP_FINISHED);
  const keep = new Set(running.concat(finished));
  fs.mkdirSync(DATA_DIR, { recursive: true });
  writeFileAtomic(FILE, JSON.stringify(list.filter(r => keep.has(r)), null, 2));
}

function _where(w) {
  const o = (w && typeof w === 'object') ? w : {};
  const spot = (o.spot && typeof o.spot === 'object') ? o.spot : {};
  return {
    page: _str(o.page, 40), href: _str(o.href, 1000), label: _str(o.label, 300),
    // The place inside the page, in that page's own words - the open project, the step, the level
    // within it. A panel asks "is one of these running records mine?" without taking an address
    // apart, and that is what puts the waiting animation back when somebody returns to it.
    // `line` is the fragment inside the fragments step: a frame or a clip is made for ONE line, and
    // the panel finds its own running rows by it.
    spot: {
      key: _str(spot.key, 200), step: _str(spot.step, 40), view: _str(spot.view, 40),
      ...(Number.isInteger(spot.line) && spot.line >= 0 ? { line: spot.line } : {}),
    },
  };
}

function _result(r) {
  if (!r || typeof r !== 'object') return null;
  const out = { ...r, path: _str(r.path, 1000) };
  out.media = MEDIA.includes(r.media) ? r.media : 'image';
  return out;
}

// What a page is shown: everything but the job, which is the server's business and may be large.
// Whether it can be tried again is all the page needs to know about it. A REFUSAL cannot (phase I):
// the agent said the request makes nothing, and the same request would get the same answer - for the
// price of asking again.
function view(r) {
  if (!r) return null;
  const { job, ...rest } = r;
  // Nor can one of a type the app no longer has (phase C4, lib/gen-jobs.js RETIRED). Required here, not at the
  // top: gen-jobs requires this file.
  const JOBS = require('./gen-jobs');
  const gone = !!(job && job.type) && JOBS.retired(job.type);
  // And a type may say a row has nothing a retry could send (review V2r: a clip stopped before its prompt was written).
  return { ...rest, retryable: !!(job && job.type) && !r.refused && !gone && JOBS.canRetry(r) };
}

// SOMEBODY WANTS TO KNOW WHEN A ROW ENDS (phase I): the Library's chats keep what came of a send in the
// message itself, because this journal is pruned and cleared and the chat is not. Called with the
// record after it became done or failed - by the runner, by a route, by the cross - and never for a
// change that did not happen (a cancelled row the late step leaves alone). A listener's own failure
// is its own.
const _enders = [];
function onEnd(fn) { if (typeof fn === 'function') _enders.push(fn); }
function _ended(rec) {
  if (!rec) return;
  for (const fn of _enders) {
    try { fn(rec); } catch (e) { console.warn('[alerts] a listener failed on ' + rec.id + ':', e.message); }
  }
}

/**
 * A generation has been asked for.
 * @param spec { kind, what, title, where: { page, href, label }, engine, taskIds, job }
 * @returns the record
 */
function start(spec) {
  const s = spec || {};
  if (!KINDS.includes(s.kind)) throw new Error('an alert needs a kind: ' + KINDS.join(' | '));
  const now = new Date().toISOString();
  const rec = {
    id: 'al' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex'),
    kind: s.kind,
    what: _str(s.what, 40),
    title: _str(s.title, 200) || s.kind,
    where: _where(s.where),
    engine: _str(s.engine, 120),
    taskIds: (Array.isArray(s.taskIds) ? s.taskIds : []).map(t => _str(t, 200)).filter(Boolean),
    // WHAT IT IS DOING RIGHT NOW, in words for the person. Some generations are not one call: a
    // clip first has an agent look at the place, then at the fragment, and only then goes to the
    // renderer (the owner, 2026-09-22 - "a row from the first press, and let it say it is still
    // analysing"). A record is written BEFORE any of that, with no task number yet, and the stage
    // moves as the work does. Empty for a generation that is a single call, and cleared when it
    // finishes - a finished row is about its result, not its way there.
    stage: _str(s.stage, 120),
    state: 'running',
    result: null,
    error: '',
    startedAt: now,
    doneAt: null,
    seen: false,
    notified: false,
    job: s.job && typeof s.job === 'object' ? s.job : null,
  };
  const list = _read();
  list.unshift(rec);
  _write(list);
  return rec;
}

// Read, change one record, write. Synchronous from end to end, so two changes in this process
// can never interleave and lose each other.
function _change(id, fn) {
  const list = _read();
  const rec = list.find(r => r.id === String(id));
  if (!rec) return null;
  fn(rec);
  _write(list);
  return rec;
}

/** Fields that may change while it runs: the provider's task ids, the stage, the job's own notes. */
function update(id, patch) {
  const p = patch || {};
  return _change(id, (r) => {
    if (r.cancelled) return;              // nothing moves a row that was let go of (N1)
    if (Array.isArray(p.taskIds)) r.taskIds = p.taskIds.map(t => _str(t, 200)).filter(Boolean);
    if (p.job && typeof p.job === 'object') r.job = p.job;
    if (p.title) r.title = _str(p.title, 200);
    if (p.engine) r.engine = _str(p.engine, 120);
    if (typeof p.stage === 'string') r.stage = _str(p.stage, 120);
  });
}

// GIVEN UP ON (phase N, the owner 2026-09-23). A generation that takes too long can be let go of
// from the panel it was started in. It is a FAILURE with a word of its own, not a fourth state:
// every reader of this journal already knows two endings, and a third would have to be taught to
// each of them for no gain. What the flag adds is that nothing may revive the row - the step that
// was already in flight when the cross was pressed must not file its picture - while "try again"
// still works, because that is a new start and says so.
//
// It does not get the money back, and the button that calls it says so: the task was paid for when
// it was asked for, and kie has no cancel. What this stops is the WAITING.
function cancel(id, why) {
  let did = false;
  const rec = _change(id, (r) => {
    if (r.state !== 'running') return;
    r.cancelled = true;
    r.state = 'failed';
    r.error = _str(why, 600) || 'you stopped waiting for it';
    r.stage = '';
    r.doneAt = new Date().toISOString();
    r.seen = true;                        // you did it on purpose: it is not news
    r.notified = true;
    did = true;
  });
  if (did) _ended(rec);
  return rec;
}

function finish(id, result) {
  let did = false;
  const rec = _change(id, (r) => {
    if (r.cancelled) return;              // it was let go of while this was in flight (N1)
    r.state = 'done';
    r.result = _result(result);
    r.error = '';
    r.stage = '';
    r.doneAt = new Date().toISOString();
    r.seen = false;
    r.notified = false;
    did = true;
  });
  if (did) _ended(rec);
  return rec;
}

// `extra.refused`: the agent declined to make anything of what it was given (phase I) - an answer to
// the person rather than a fault, so it is not offered again (view).
function fail(id, error, extra) {
  let did = false;
  const rec = _change(id, (r) => {
    // Let go of already (N1): a step that was in flight when the cross was pressed must not turn the
    // person's own cancel into a failure with a toast. A retry clears the mark first (restart).
    if (r.cancelled) return;
    r.state = 'failed';
    r.error = _str(error, 600) || 'it did not come';
    r.stage = '';
    r.doneAt = new Date().toISOString();
    r.seen = false;
    r.notified = false;
    if (extra && extra.refused) r.refused = true;
    did = true;
  });
  if (did) _ended(rec);
  return rec;
}

/** Back to running - a retry. The record keeps its place in the list and its way back. */
function restart(id, patch) {
  return _change(id, (r) => {
    const p = patch || {};
    r.state = 'running';
    r.result = null;
    r.error = '';
    // Not cleared unless asked: a type that says what it is doing (a clip) reports its stages while
    // it is being submitted again, and this runs after that.
    if (typeof p.stage === 'string') r.stage = _str(p.stage, 120);
    r.startedAt = new Date().toISOString();
    r.doneAt = null;
    r.seen = false;
    r.notified = false;
    r.cancelled = false;                  // a retry is a new start, whatever ended the old one
    r.refused = false;
    if (Array.isArray(p.taskIds)) r.taskIds = p.taskIds.map(t => _str(t, 200)).filter(Boolean);
    if (p.job && typeof p.job === 'object') r.job = p.job;
  });
}

const get = (id) => _read().find(r => r.id === String(id)) || null;
const list = () => _read();

function counts(all) {
  const l = all || _read();
  return {
    running: l.filter(r => r.state === 'running').length,
    unseen: l.filter(r => _finished(r) && !r.seen).length,
  };
}

// Looked at: the list was opened. Without ids, everything finished so far.
function markSeen(ids) {
  const want = Array.isArray(ids) ? new Set(ids.map(String)) : null;
  const l = _read();
  let n = 0;
  for (const r of l) {
    if (_finished(r) && !r.seen && (!want || want.has(r.id))) { r.seen = true; n++; }
  }
  if (n) _write(l);
  return n;
}

// Announced: its toast has been shown, on whichever page was open - so it is not shown again on
// the next one.
function markNotified(ids) {
  const want = new Set((Array.isArray(ids) ? ids : []).map(String));
  const l = _read();
  let n = 0;
  for (const r of l) {
    if (_finished(r) && !r.notified && want.has(r.id)) { r.notified = true; n++; }
  }
  if (n) _write(l);
  return n;
}

/** The finished ones go; what is still running stays, whatever is asked. */
function clearFinished() {
  const l = _read();
  const keep = l.filter(r => !_finished(r));
  if (keep.length !== l.length) _write(keep);
  return l.length - keep.length;
}

module.exports = {
  FILE, KEEP_FINISHED, KINDS,
  start, update, finish, fail, cancel, restart, get, list, counts, view, markSeen, markNotified, clearFinished, onEnd,
};
