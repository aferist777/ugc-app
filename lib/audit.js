'use strict';

/* audit.js — who did what, when.

   One line of JSON per event, one file per day in logs/audit/, kept AUDIT_DAYS days (365).
   Three layers write here and the admin's Activity tab reads it back:

     action   every request that changes something - POST / PUT / PATCH / DELETE under /api -
              recorded by the middleware below with the person from the session, a phrase in
              the app's own words (lib/audit-map.js), the ids it touched, a bounded summary of
              the body, the status and how long it took;
     process  something that outlives a request - a generation, a render, an import - as a
              start row and a finish row (phase 5.2);
     click    what the person pressed in the browser, sent up in batches (phase 5.3);
     sign-in  sign-in, sign-out and own credentials, written by lib/access-gate.js.

   NEW ROUTES ARE COVERED THE MOMENT THEY EXIST. The middleware records every mutating request
   whether or not the map knows a phrase for it; an unknown one gets a phrase made from its
   path and the flag `unmapped`, which the Activity tab counts so the phrase gets written.

   NEVER IN THE FILE: passwords, API key values, session cookies, the bodies of uploads (a
   base64 string becomes its length), the UI-state autosave stream, status polling. Text the
   person wrote or generated - prompts, lines, instructions - IS kept, in full, because "what
   did they ask for" is the question this log exists to answer; the row shows a phrase and the
   text sits underneath it. */

const fs = require('fs');
const path = require('path');
const MAP = require('./audit-map');

const DIR = path.join(__dirname, '..', 'logs', 'audit');
const KEEP_DAYS = Math.max(1, parseInt(process.env.AUDIT_DAYS, 10) || 365);

// ── writing ─────────────────────────────────────────────────────────────────
// One append stream per day file, rotated when the (UTC) date changes. A stream rather than
// appendFile per record: records arrive from every request and the stream keeps their order.
let _stream = null;
let _day = null;

const dayOf = (d) => d.toISOString().slice(0, 10);

function _streamFor(day) {
  if (_stream && _day === day) return _stream;
  try { if (_stream) _stream.end(); } catch (e) {}
  fs.mkdirSync(DIR, { recursive: true });
  _stream = fs.createWriteStream(path.join(DIR, day + '.jsonl'), { flags: 'a' });
  _stream.on('error', (e) => console.warn('[audit] write failed:', e.message));
  _day = day;
  return _stream;
}

function write(rec) {
  try { _streamFor(dayOf(new Date())).write(JSON.stringify(rec) + '\n'); }
  catch (e) { console.warn('[audit] lost a record:', e.message); }
}

// Files older than the retention go. Run at boot and once a day after that.
function prune() {
  let n = 0;
  try {
    const cutoff = dayOf(new Date(Date.now() - KEEP_DAYS * 86400000));
    for (const f of fs.readdirSync(DIR)) {
      const m = /^(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(f);
      if (m && m[1] < cutoff) { fs.unlinkSync(path.join(DIR, f)); n++; }
    }
  } catch (e) { /* no directory yet */ }
  if (n) console.log(`[audit] pruned ${n} day file(s) older than ${KEEP_DAYS} days`);
}

function start() {
  fs.mkdirSync(DIR, { recursive: true });
  prune();
  const t = setInterval(prune, 24 * 3600 * 1000);
  if (t.unref) t.unref();
  console.log(`[audit] writing to ${path.relative(path.join(__dirname, '..'), DIR)}/, keeping ${KEEP_DAYS} days`);
}

// ── who, where, from what ───────────────────────────────────────────────────
// Which tab the request came from: the client says so in a header (phase 5.3); until then
// the referer's path is a fair reading, since every page lives at its own address.
const PAGES = [
  ['/character', 'Character'], ['/scenarios', 'Scenarios'], ['/merge', 'Merge'], ['/birols', 'Birols'],
  ['/library2', 'Library2'], ['/library', 'Library'], ['/admin', 'Admin'], ['/login', 'Sign-in'], ['/account', 'Sign-in'],
];
function pageOf(req) {
  const h = req.headers['x-audit-page'];
  if (h) return String(h).slice(0, 24);
  try {
    const p = new URL(req.headers.referer || '', 'http://x').pathname.replace(/\/+$/, '') || '/';
    for (const [pre, name] of PAGES) if (p === pre || p.startsWith(pre + '/') || p.startsWith(pre + '-')) return name;
  } catch (e) {}
  return null;
}

function who(user) {
  if (!user) return { uid: null, nick: null, role: null };
  return { uid: String(user.id), nick: user.nickname || user.login || String(user.id), role: user.role || 'user' };
}
const ipOf = (req) => String((req.headers['x-forwarded-for'] || '').split(',')[0].trim()
                        || (req.socket && req.socket.remoteAddress) || '').replace(/^::ffff:/, '');
const uaOf = (req) => String(req.headers['user-agent'] || '').slice(0, 160);

/** One event. `e.user` names the person when the request has no session yet (sign-in). */
function record(req, e) {
  write({
    t: new Date().toISOString(),
    ...who(e.user || (req && req.user)),
    layer: e.layer || 'action',
    page: e.page || (req ? pageOf(req) : null),
    kind: e.kind || 'unknown',
    label: e.label || '',
    marker: e.marker || null,
    route: e.route || null,
    ids: e.ids || null,
    params: e.params || null,
    text: e.text || null,
    body: e.body || null,
    status: e.status == null ? 'ok' : e.status,
    error: e.error || null,
    ms: e.ms == null ? null : e.ms,
    unmapped: e.unmapped ? true : undefined,
    ip: req ? ipOf(req) : null,
    ua: req ? uaOf(req) : null,
  });
}

// ── the body, bounded ───────────────────────────────────────────────────────
// What the request carried, small enough to keep on every row: scalars as they are, text the
// person wrote in full (see TEXT_KEYS), anything else long as its length, nesting cut off at
// three levels, arrays past forty entries as their count. Secrets never - by field name.
const HIDE = /password|secret|token|apikey|cookie|authorization/i;
const TEXT_KEYS = new Set(['prompt', 'text', 'instruction', 'note', 'brief', 'script', 'title', 'name', 'lines',
                           'tagged', 'message', 'motion', 'description', 'intent', 'direction', 'hook', 'hooks',
                           'topic', 'style', 'system', 'template', 'value', 'content', 'body', 'caption', 'reason']);
function summarize(v, key = '', depth = 0) {
  if (v == null || typeof v === 'boolean' || typeof v === 'number') return v;
  if (typeof v === 'string') {
    if (TEXT_KEYS.has(key)) return v.length > 20000 ? v.slice(0, 20000) + `… (${v.length} chars)` : v;
    return v.length > 300 ? `str(${v.length})` : v;
  }
  if (Array.isArray(v)) {
    if (depth >= 3 || v.length > 40) return `arr(${v.length})`;
    return v.map(x => summarize(x, key, depth + 1));
  }
  if (typeof v === 'object') {
    const keys = Object.keys(v);
    if (depth >= 3) return `obj(${keys.length})`;
    const o = {};
    keys.slice(0, 40).forEach(k => { o[k] = HIDE.test(k) ? '«hidden»' : summarize(v[k], k, depth + 1); });
    if (keys.length > 40) o['…'] = (keys.length - 40) + ' more';
    return o;
  }
  return String(v);
}

// ── processes: a start now, a finish later ──────────────────────────────────
// A request that hands back a task or job id has started something that outlives it. The id
// is remembered with who asked and what the row said; the first poll that reports a terminal
// state - from any status route, whatever it is called - writes the finish row with the time
// it took. The server's own watchers (Scenarios frames and clips, the render queue, exports)
// call processEnd themselves for the ends no page polls for. Either way, once per id.
const _tasks = new Map();
const _ended = new Set();
function trackStart(id, info) {
  if (!id) return;
  _tasks.set(String(id), { t0: Date.now(), ...info });
  if (_tasks.size > 3000) _tasks.delete(_tasks.keys().next().value);
}
const fmtMs = (ms) => ms < 60000
  ? (ms / 1000).toFixed(ms < 10000 ? 1 : 0) + ' s'
  : Math.floor(ms / 60000) + ':' + String(Math.round((ms % 60000) / 1000)).padStart(2, '0');

/** A process the server starts on its own (the queue): the start row, and the id remembered. */
function processStart(req, id, e) {
  trackStart(id, { kind: e.kind, label: e.label, user: e.user || (req && req.user), page: e.page || (req ? pageOf(req) : null), ids: e.ids, params: e.params });
  record(req, { ...e, layer: 'process', marker: 'process' });
}

/** The end of a tracked process. r: { ok, error?, cancelled?, result?, label?, ids? }. Ignored
 *  for an id this log never saw start - a poll of an old task after a restart, or somebody
 *  else's - unless a label is given. Once per id. */
function processEnd(req, id, r) {
  const key = String(id || '');
  if (!key || _ended.has(key)) return false;
  const s = _tasks.get(key);
  if (!s && !(r && r.label)) return false;
  _tasks.delete(key);
  _ended.add(key);
  if (_ended.size > 5000) _ended.delete(_ended.values().next().value);
  r = r || {};
  const ms = s ? Date.now() - s.t0 : null;
  const ok = !!r.ok;
  const base = s ? String(s.label).replace(/^(started|queued|asked for) (a |an |the )?/, '') : `task ${key}`;
  const label = r.label || (base
    + (ok ? ' finished' : (r.cancelled ? ' cancelled' : ' failed' + (r.error ? ': ' + String(r.error).slice(0, 200) : '')))
    + (ms != null ? ' in ' + fmtMs(ms) : '')
    + (r.result ? ' → ' + String(r.result).slice(0, 200) : ''));
  const kind = String(s ? s.kind : 'task').replace(/\.(request|start)$/, '') + (ok ? '.finish' : (r.cancelled ? '.cancel' : '.fail'));
  record(req, {
    user: s ? s.user : undefined, page: s ? s.page : undefined,
    layer: 'process', marker: ok ? 'process' : 'error', kind, label,
    ids: { ...(s && s.ids), ...(r.ids || {}), taskId: key }, params: s ? s.params : null,
    status: ok ? 'ok' : 'error', error: ok ? null : (r.error || (r.cancelled ? 'cancelled' : null)), ms,
  });
  return true;
}

// What a poll's answer says about a task: finished well, finished badly, or not yet.
const TERMINAL_OK  = new Set(['success', 'done', 'ready']);
const TERMINAL_BAD = new Set(['failed', 'error', 'cancelled']);
function terminalOf(out) {
  if (!out || typeof out !== 'object') return null;
  const v = String(out.state || out.status || '').toLowerCase();
  if (TERMINAL_OK.has(v)) return { ok: true };
  if (TERMINAL_BAD.has(v)) return { ok: false, cancelled: v === 'cancelled', error: out.error || null };
  return null;
}
const resultOf = (out) => out.url || out.imagePath || out.videoPath || out.audioPath || out.path
  || (Array.isArray(out.parts) && out.parts.length && out.parts.length + ' volume(s)') || null;

// ── the middleware ──────────────────────────────────────────────────────────
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
// Housekeeping, not activity: the UI-state mirror fires on every stored preference, the old
// editor's state autosave, timing samples, thumbnail bookkeeping, console relays, and the
// client-events sink itself (its events are recorded one by one, not as a request).
const SKIP = new Set(['/ui-state', '/_devlog', '/audit/events', '/log', '/log/entry', '/gen-timings/record',
                      '/media/thumbs/audit', '/media/thumb', '/edit-state', '/mv3/img/settings', '/biroly/state', '/hooks/state',
                      // the old pages' state mirrors, and the Character page's own take recovery on open
                      '/userdata/obrazy', '/userdata/projects', '/userdata/geni', '/character-v2/recover']);

/** The paths the middleware does not record - for the boot check, so they are not reported
 *  as unnamed. */
const isSkipped = (p) => SKIP.has(p) || p.startsWith('/edit-state/');

function errorOf(out, res) {
  if (out && typeof out === 'object' && out.error) return String(out.error).slice(0, 300);
  return res.statusCode >= 400 ? ('HTTP ' + res.statusCode) : null;
}

/** Records every mutating /api request when it finishes. Mount at /api, after the body parser
 *  and before the routers. */
function requests() {
  return (req, res, next) => {
    // The server talking to itself (the render queue's calls) is not a person's activity; the
    // queue writes its own rows with the owner's name on them.
    if (req.user && req.user.role === 'system') return next();
    if (req.method === 'GET') {
      // A poll that reports the end of a task this log saw start: the finish row, once. Any
      // route, any name - only the id in the path and a terminal word in the answer matter.
      if (!_tasks.size) return next();
      const json = res.json.bind(res);
      res.json = (payload) => {
        try {
          const id = req.params && (req.params.taskId || req.params.jobId || req.params.id);
          if (id && _tasks.has(String(id))) {
            const t = terminalOf(payload);
            if (t) processEnd(req, id, { ...t, result: resultOf(payload) });
          }
        } catch (e) { /* a poll is never the place to fail */ }
        return json(payload);
      };
      return next();
    }
    if (!MUTATING.has(req.method) || SKIP.has(req.path) || req.path.startsWith('/edit-state/')) return next();
    const t0 = Date.now();
    // What is about to be deleted or renamed has a name only until the handler runs.
    const before = MAP.snapshot(req.method, req.path);
    // The answer is where the ids and titles come back; caught here rather than asked for.
    let out = null;
    const json = res.json.bind(res);
    res.json = (payload) => { out = payload; return json(payload); };
    res.on('finish', () => {
      try {
        const route = req.route ? (req.baseUrl + req.route.path) : null;
        const ctx = {
          req, before, body: req.body || {}, params: req.params || {}, query: req.query || {},
          out: (out && typeof out === 'object') ? out : {}, status: res.statusCode,
        };
        const ph = MAP.phrase(req.method, route, req.path, ctx);
        const failed = res.statusCode >= 400 || (out && typeof out === 'object' && out.success === false);
        // Handed back a task or job id: something started that a later poll will finish.
        const tid = (ph.ids && (ph.ids.taskId || ph.ids.jobId)) || ctx.out.taskId || ctx.out.jobId || null;
        const tracked = !failed && tid ? String(tid) : null;
        if (tracked) trackStart(tracked, { kind: ph.kind, label: ph.label, user: req.user, page: pageOf(req), ids: ph.ids, params: ph.params });
        record(req, {
          ...ph,
          marker: failed ? 'error' : (tracked ? 'process' : (ph.marker || 'action')),
          route: req.method + ' ' + (route || req.path),
          body: summarize(req.body),
          status: failed ? res.statusCode : 'ok',
          error: failed ? errorOf(out, res) : null,
          ms: Date.now() - t0,
        });
      } catch (e) { console.warn('[audit] could not record', req.method, req.path, '-', e.message); }
    });
    next();
  };
}

module.exports = { start, prune, record, write, summarize, requests, isSkipped, pageOf,
                   processStart, processEnd, trackStart, fmtMs, DIR, KEEP_DAYS, dayOf };
