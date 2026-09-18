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
const STATES = ['running', 'done', 'failed'];
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
// Whether it can be tried again is all the page needs to know about it.
function view(r) {
  if (!r) return null;
  const { job, ...rest } = r;
  return { ...rest, retryable: !!(job && job.type) };
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

/** Fields that may change while it runs: the provider's task ids, the job's own notes. */
function update(id, patch) {
  const p = patch || {};
  return _change(id, (r) => {
    if (Array.isArray(p.taskIds)) r.taskIds = p.taskIds.map(t => _str(t, 200)).filter(Boolean);
    if (p.job && typeof p.job === 'object') r.job = p.job;
    if (p.title) r.title = _str(p.title, 200);
    if (p.engine) r.engine = _str(p.engine, 120);
  });
}

function finish(id, result) {
  return _change(id, (r) => {
    r.state = 'done';
    r.result = _result(result);
    r.error = '';
    r.doneAt = new Date().toISOString();
    r.seen = false;
    r.notified = false;
  });
}

function fail(id, error) {
  return _change(id, (r) => {
    r.state = 'failed';
    r.error = _str(error, 600) || 'it did not come';
    r.doneAt = new Date().toISOString();
    r.seen = false;
    r.notified = false;
  });
}

/** Back to running - a retry. The record keeps its place in the list and its way back. */
function restart(id, patch) {
  return _change(id, (r) => {
    const p = patch || {};
    r.state = 'running';
    r.result = null;
    r.error = '';
    r.startedAt = new Date().toISOString();
    r.doneAt = null;
    r.seen = false;
    r.notified = false;
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
  FILE, KEEP_FINISHED, KINDS, STATES,
  start, update, finish, fail, restart, get, list, counts, view, markSeen, markNotified, clearFinished,
};
