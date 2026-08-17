'use strict';

// ════════════════════════════════════════════════════════════════════════════
// THE TRACE — every API call the Character page causes, in and out.
//
// Three things live here, and they are one file because they are useless apart:
//
//   1. a CONTEXT that survives await, so an upload to imgbb buried three calls deep
//      inside a sheet generation still knows which button started it;
//   2. an INTERCEPTOR on axios, which records without a single call site being edited;
//   3. a STORE - a ring in memory for the live view, and a rotating file so the log
//      outlives a restart.
//
// Every outgoing call in this app goes through the DEFAULT axios instance - there is no
// axios.create() anywhere - so one interceptor sees kie, OpenRouter, Replicate,
// ElevenLabs, imgbb and every fallback host, with no per-vendor plumbing.
//
// SCOPE is the context, not the URL. A record is written only while an AsyncLocalStorage
// context is open, and only the Character page opens one (its fetch is patched to send
// X-CV2-Run). So this captures that page exactly, and stays silent for every other page
// until one asks for the same treatment.
//
// TWO RULES ABOUT WHAT IS WRITTEN, both applied at write time rather than at display time,
// because this file lands on disk and a log that leaks keys is worse than no log:
//
//   - Authorization and friends are replaced before the record is built. Never redacted
//     "on the way out" - by then it has already been written down.
//   - A base64 image is named, not stored. faceImageBase64 alone is megabytes, and 47
//     polls' worth of them would bury the log in the one thing nobody reads.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { AsyncLocalStorage } = require('async_hooks');
const { DATA_DIR } = require('./config');

const FILE = path.join(DATA_DIR, 'cv2-trace.jsonl');
const MAX_BYTES = 10 * 1024 * 1024;   // per file
const MAX_FILES = 10;                 // .1 … .9, so ten in all
const RING = 500;                     // calls kept in memory for the live view
// Generous on purpose. The cap was originally 32 KB and aimed at volume - but the thing
// that made bodies enormous was base64, and that is now named and dropped before this
// applies. What survives the scrub is PROSE, and prose is the entire point of the log.
//
// Measured against the real thing rather than guessed: the largest system prompt in the
// registry is 2.6 KB across all 74 of them, and the largest body observed in practice was
// 13.5 KB. So this is ~100x the biggest prompt that exists - a prompt can never be lost,
// and the cut only ever fires on something pathological.
//
// It matters that this is generous, because the cut happens at WRITE time: a "show more"
// in the popup can only reveal what was kept. Anything trimmed here is gone for good.
const MAX_BODY = 256 * 1024;          // per body, after scrubbing
const BIG_STRING = 1024;              // above this a string is examined for base64

const als = new AsyncLocalStorage();
const _ring = [];
let _n = 0;
let _wired = false;

// ── Who answered ────────────────────────────────────────────────────────────
// The host is the only thing every call has. Mapped to the name the popup shows, so the
// tree reads in the same words as the ladder that chose it.
const VENDORS = [
  [/(^|\.)api\.kie\.ai$/,        'kie.ai'],
  [/(^|\.)kie\.ai$/,             'kie.ai'],
  [/(^|\.)openrouter\.ai$/,      'openrouter'],
  [/(^|\.)api\.replicate\.com$/, 'replicate'],
  [/(^|\.)replicate\.(com|delivery)$/, 'replicate'],
  [/(^|\.)api\.elevenlabs\.io$/, 'elevenlabs'],
  [/(^|\.)api\.imgbb\.com$/,     'imgbb'],
  [/(^|\.)i\.ibb\.co$/,          'imgbb'],
  [/(^|\.)catbox\.moe$/,         'catbox'],
  [/(^|\.)litterbox\.catbox\.moe$/, 'catbox'],
  [/(^|\.)tmpfiles\.org$/,       'tmpfiles'],
  [/(^|\.)uguu\.se$/,            'uguu'],
  [/(^|\.)imgcdn\.dev$/,         'imgcdn'],
  [/(^|\.)0x0\.st$/,             '0x0'],
  [/(^|\.)api\.groq\.com$/,      'groq'],
  [/(^|\.)api\.openai\.com$/,    'openai'],
];

function vendorOf(host) {
  const h = String(host || '').toLowerCase();
  for (const [re, name] of VENDORS) if (re.test(h)) return name;
  return h || 'unknown';
}

// Best effort, and honest about it: every vendor spells the model differently, and a
// missing name is better than a wrong one.
function modelOf(body) {
  if (!body || typeof body !== 'object') return '';
  for (const k of ['model', 'modelName', 'engine']) {
    if (typeof body[k] === 'string' && body[k]) return body[k];
  }
  if (body.input && typeof body.input.model === 'string') return body.input.model;
  if (typeof body.version === 'string') return body.version.slice(0, 24);
  return '';
}

// ── Redaction ───────────────────────────────────────────────────────────────
// A RULE, not a list. The first version of this enumerated the header names it knew -
// authorization, x-api-key, x-goog-api-key - and ElevenLabs promptly wrote its key into the
// trace through `xi-api-key`, one letter outside the list. A list of known secrets is always
// one vendor behind, and being behind here means the key is already on disk. So anything
// whose NAME sounds like a credential is masked, and the handful of harmless names that
// would also match are spelled out as exceptions instead.
const SECRET_HEADERS = /(key|token|auth|secret|password|passwd|cookie|credential|signature|session)/i;
const HEADER_EXCEPTIONS = /^(x-api-version|keep-alive|authorization-scheme)$/i;
const SECRET_PARAMS = /(^|_|-)(key|token|apikey|auth|secret|password|sig|signature)($|_|-)/i;
const MASK = '••••';
// URLs get an ASCII mask. Bullets survive a round trip through URL() as
// %E2%80%A2%E2%80%A2%E2%80%A2%E2%80%A2, which is both unreadable and easy to mistake for
// the key still being there.
const URL_MASK = 'REDACTED';

const isSecretHeader = (k) => !HEADER_EXCEPTIONS.test(k) && SECRET_HEADERS.test(k);

function redactHeaders(h) {
  const out = {};
  if (!h || typeof h !== 'object') return out;
  for (const [k, v] of Object.entries(h)) {
    if (typeof v === 'function' || v == null) continue;
    out[k] = isSecretHeader(k) ? MASK : String(v).slice(0, 300);
  }
  return out;
}

// imgbb puts the key in the QUERY STRING, so redacting headers alone would still write it
// down - in the one field the popup shows as the row's title.
function redactUrl(url) {
  const s = String(url || '');
  try {
    const u = new URL(s, 'http://x');
    let touched = false;
    for (const k of [...u.searchParams.keys()]) {
      if (SECRET_PARAMS.test(k)) { u.searchParams.set(k, URL_MASK); touched = true; }
    }
    if (!touched) return s;
    return s.startsWith('http') ? u.toString() : (u.pathname + u.search);
  } catch (e) {
    // A URL that will not parse still must not carry a key through.
    return s.replace(/([?&](?:key|token|api_key|apikey|access_token)=)[^&]*/gi, '$1' + URL_MASK);
  }
}

// ── Scrubbing bodies ────────────────────────────────────────────────────────
// Line breaks are allowed because PEM-style base64 wraps; SPACES are not, and that is the
// load-bearing part. A long prompt is prose, and prose has spaces - so it can never be
// mistaken for a picture and thrown away, which would delete the one field worth reading.
const B64ish = /^[A-Za-z0-9+/=\r\n]+$/;
const _size = (n) => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB'
  : n >= 1024 ? Math.round(n / 1024) + ' KB' : n + ' B';

// A long string is either a picture or prose. Prose is the point of this log; a picture is
// noise measured in megabytes, so it is named and dropped.
function scrubString(v) {
  if (v.length < BIG_STRING) return v;
  const m = /^data:([\w.+-]+\/[\w.+-]+);base64,/.exec(v);
  if (m) return '<' + m[1] + ', ' + _size(Math.floor(v.length * 0.75)) + '>';
  if (B64ish.test(v)) return '<base64, ' + _size(Math.floor(v.length * 0.75)) + '>';
  return v;
}

function scrub(v, depth) {
  if (depth > 8) return '<deep>';
  if (typeof v === 'string') return scrubString(v);
  if (!v || typeof v !== 'object') return v;
  if (Buffer.isBuffer(v)) return '<buffer, ' + _size(v.length) + '>';
  if (Array.isArray(v)) {
    const out = v.slice(0, 50).map(x => scrub(x, depth + 1));
    if (v.length > 50) out.push('<+' + (v.length - 50) + ' more>');
    return out;
  }
  // FormData, streams and the like have no useful JSON shape.
  if (typeof v.pipe === 'function' || typeof v.getBoundary === 'function') return '<stream>';
  const out = {};
  let n = 0;
  for (const [k, val] of Object.entries(v)) {
    if (++n > 80) { out['<+more>'] = Object.keys(v).length - 80; break; }
    out[k] = SECRET_PARAMS.test(k) ? MASK : scrub(val, depth + 1);
  }
  return out;
}

// `a=1&b=2`, with no stray characters that a form body could not contain. Deliberately
// strict: mistaking prose for a form would shred a prompt into nonsense keys.
function isFormEncoded(s) {
  if (!s || s.length < 3 || s.includes('\n') || s.includes(' ')) return false;
  return /^[\w.[\]%+-]+=[^&]*(&[\w.[\]%+-]+=[^&]*)*$/.test(s.slice(0, 4096)) && /^[\w.[\]%+-]+=/.test(s);
}

function fromForm(s) {
  const out = {};
  try {
    for (const [k, v] of new URLSearchParams(s)) out[k] = v;
  } catch (e) {
    return s;
  }
  return out;
}

// Returns { body, bytes } - bytes being the REAL size before anything was cut, because
// "the request was 2.4 MB" is often the whole explanation for a timeout.
function packBody(raw) {
  let bytes = 0;
  try {
    if (typeof raw === 'string') bytes = Buffer.byteLength(raw);
    else if (Buffer.isBuffer(raw)) bytes = raw.length;
    else if (raw != null) bytes = Buffer.byteLength(JSON.stringify(raw) || '');
  } catch (e) { bytes = 0; }

  let body = raw;
  try {
    if (typeof raw === 'string') {
      // Bodies arrive as strings on the way out; parse so the scrub can reach the fields.
      let parsed = null;
      try { parsed = JSON.parse(raw); } catch (e) {}
      if (parsed && typeof parsed === 'object') {
        body = scrub(parsed, 0);
      } else if (isFormEncoded(raw)) {
        // imgbb takes the image as a form field, so the picture arrives PERCENT-ENCODED and
        // slips past the base64 test - 141 KB of %2F%39 stored whole, and unreadable at that.
        // Decoding first turns it back into something the scrub recognises, and the inspector
        // shows named fields instead of a wall of escapes.
        body = scrub(fromForm(raw), 0);
      } else {
        body = scrubString(raw);
      }
    } else {
      body = scrub(raw, 0);
    }
    let s = typeof body === 'string' ? body : JSON.stringify(body);
    if (s && s.length > MAX_BODY) {
      body = s.slice(0, MAX_BODY) + '\n… cut at ' + _size(MAX_BODY) + ' of ' + _size(bytes);
    }
  } catch (e) {
    body = '<unreadable: ' + e.message + '>';
  }
  return { body, bytes };
}

// ── The last line of defence ────────────────────────────────────────────────
// Masking by header NAME is a guess about where credentials live, and the xi-api-key miss
// proved the guess is fallible. This checks the other way round: whatever this app holds as
// a key, in settings.json or the environment, must not appear in a record - no matter which
// field it arrived in, whether that is a header nobody anticipated, a redirect URL or a
// response body echoing the request back.
//
// Names can surprise us; our own key values cannot. So the rule above catches the common
// case cheaply, and this catches everything else.
let _secrets = [];
let _secretsAt = 0;

function knownSecrets() {
  if (Date.now() - _secretsAt < 60000) return _secrets;
  _secretsAt = Date.now();
  const found = [];
  try {
    const walk = (o, depth) => {
      if (!o || typeof o !== 'object' || depth > 4) return;
      for (const [k, v] of Object.entries(o)) {
        // Long enough to be a credential rather than a word that happens to collide.
        if (typeof v === 'string' && v.length >= 16 && /key|token|secret|api|auth|pass/i.test(k)) found.push(v);
        else if (v && typeof v === 'object') walk(v, depth + 1);
      }
    };
    walk(require('./settings-io').getSettings(), 0);
  } catch (e) {}
  for (const [k, v] of Object.entries(process.env)) {
    if (/KEY|TOKEN|SECRET|PASS/i.test(k) && String(v).length >= 16) found.push(String(v));
  }
  // Longest first, so a key that contains another is masked whole rather than in pieces.
  _secrets = [...new Set(found)].sort((a, b) => b.length - a.length);
  return _secrets;
}

function sweep(line) {
  let out = line;
  for (const s of knownSecrets()) {
    if (out.includes(s)) out = out.split(s).join(MASK);
  }
  return out;
}

// ── The store ───────────────────────────────────────────────────────────────
function rotate() {
  try {
    if (!fs.existsSync(FILE) || fs.statSync(FILE).size < MAX_BYTES) return;
    // Oldest first, or each rename would overwrite the file it is about to move.
    const last = FILE + '.' + (MAX_FILES - 1);
    if (fs.existsSync(last)) fs.unlinkSync(last);
    for (let i = MAX_FILES - 2; i >= 1; i--) {
      const from = FILE + '.' + i;
      if (fs.existsSync(from)) fs.renameSync(from, FILE + '.' + (i + 1));
    }
    fs.renameSync(FILE, FILE + '.1');
  } catch (e) {
    console.warn('[cv2-trace] rotation failed:', e.message);
  }
}

function write(rec) {
  let line;
  try {
    line = sweep(JSON.stringify(rec));
  } catch (e) {
    console.warn('[cv2-trace] record could not be serialised:', e.message);
    return;
  }
  // The ring holds the SWEPT record, parsed back, not the original object. The popup reads
  // the ring, so anything the file refused to keep cannot appear on screen either - one
  // rule, one result, whichever end you look from.
  try { _ring.push(JSON.parse(line)); } catch (e) { return; }
  if (_ring.length > RING) _ring.shift();
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    rotate();
    fs.appendFileSync(FILE, line + '\n', 'utf8');
  } catch (e) {
    // The log is diagnostics. It must never be the reason a generation fails.
    console.warn('[cv2-trace] write failed:', e.message);
  }
}

// Newest first, which is the order the popup reads them in.
function recent({ runId, limit = 200 } = {}) {
  const all = runId ? _ring.filter(r => r.runId === runId) : _ring;
  return all.slice(-limit).reverse();
}

function byId(id) {
  return _ring.find(r => r.id === id) || null;
}

// ── Things that happened without an HTTP call ───────────────────────────────
// A ladder step whose key is known to be dead is stepped over - no request is made, so the
// interceptor has nothing to see, and the log would show a ladder that silently began at
// step two. That skip is the most useful line in the whole trace on a bad day, so it is
// written explicitly.
//
// The alternative was reconciling cv2-run's own step list against the trace afterwards by
// runId. This is the same information with no matching to get wrong.
function note({ label, state, detail, vendor, ms }) {
  const c = ctx();
  if (!c) return;
  write({
    id: 'c' + (++_n),
    runId: c.runId, action: c.action, page: c.page, parent: c.rootId || null,
    kind: 'note',
    t: new Date().toISOString(),
    ms: ms || 0,
    method: '', url: String(label || ''), host: '', vendor: vendor || '',
    model: '',
    status: 0,
    ok: state === 'ok',
    state: state || 'skipped',
    error: state === 'ok' ? null : String(detail || ''),
    req: { headers: {}, body: null, bytes: 0 },
    res: { headers: {}, body: String(detail || ''), bytes: 0 },
  });
}

// ── Warming the ring from the file ──────────────────────────────────────────
// Without this the tree would be empty after every restart while the file sat there full of
// history - and this app restarts often, since Node has to reload for any backend edit. The
// whole point of writing to disk was that the log outlives that.
function warm() {
  try {
    if (!fs.existsSync(FILE)) return;
    const lines = fs.readFileSync(FILE, 'utf8').split('\n').filter(Boolean).slice(-RING);
    for (const l of lines) {
      try {
        const r = JSON.parse(l);
        _ring.push(r);
        const n = parseInt(String(r.id).slice(1), 10);
        if (n > _n) _n = n;          // or new ids would collide with recovered ones
      } catch (e) {}
    }
    console.log('[cv2-trace] warmed ' + _ring.length + ' record(s) from disk');
  } catch (e) {
    console.warn('[cv2-trace] warm failed:', e.message);
  }
}

// ── The tree ────────────────────────────────────────────────────────────────
// Grouped by run - one user action - then by the inbound request, with the calls each one
// caused hanging beneath it. Bodies are deliberately absent: a list of forty calls should
// not carry a megabyte of prompts nobody has asked to read yet. GET /trace/:id fetches one.
//
// Repeats collapse. A four-minute generation is 160 identical polls, and left alone they
// bury the four lines that matter under a wall of the same line.
// Grouped by identity across the WHOLE list, not just against the row above.
//
// Adjacent-only matching looked sufficient while the only repeating thing was a generation
// poll hitting one URL over and over. Then the save wait turned up: _awaitSheet polls the
// finished list and the drafts list together, every two seconds for up to eight minutes, so
// the rows ALTERNATE - list, list?drafts=1, list, list?drafts=1 - and no two neighbours are
// ever equal. Nothing collapsed, and a save filled the panel with two hundred lines.
//
// Position comes from the first occurrence, so the order still reads chronologically.
function _collapse(list) {
  const out = [];
  const byKey = new Map();
  for (const r of list) {
    const key = r.kind + '|' + r.method + '|' + r.url + '|' + r.vendor;
    const prev = byKey.get(key);
    if (prev) {
      prev.repeat++;
      prev.ms += r.ms;                              // time actually spent in these calls
      // The LAST answer wins: what a poll finally said is the interesting part, and a run
      // of 200s ending in a 500 must not read as fine. The list arrives sorted by time, so
      // the final assignment is the latest one.
      prev.status = r.status;
      prev.ok = r.ok;
      prev.error = r.error;
      prev.lastId = r.id;
      // Where the row ENDS, kept apart from ms: a poll can spend four seconds of request
      // time spread over four minutes of waiting, and the bar should show the waiting.
      prev.t2 = new Date(Date.parse(r.t) + (r.ms || 0)).toISOString();
      // Every id that folded into this row. Without it, collapsing six polls would also
      // hide the five aggregator calls hanging off the five rows that disappeared - the
      // row would say "x6" over a single child, which is worse than not collapsing at all.
      prev.ids.push(r.id);
      continue;
    }
    const node = { ...r, repeat: 1, lastId: r.id, ids: [r.id],
      t2: new Date(Date.parse(r.t) + (r.ms || 0)).toISOString(),
      req: undefined, res: undefined,
      reqBytes: (r.req && r.req.bytes) || 0, resBytes: (r.res && r.res.bytes) || 0 };
    byKey.set(key, node);
    out.push(node);
  }
  return out;
}

// Merge nodes that have ALREADY been collapsed once. _collapse() takes raw records and turns
// them into rows; this takes rows and folds equal ones together, children included, which is
// what folding several runs into one group needs.
function _regroup(nodes) {
  const out = [];
  const byKey = new Map();
  for (const n of nodes) {
    const key = n.kind + '|' + n.method + '|' + n.url + '|' + n.vendor;
    const prev = byKey.get(key);
    if (prev) {
      prev.repeat += (n.repeat || 1);
      prev.ms += (n.ms || 0);
      prev.ids = (prev.ids || []).concat(n.ids || []);
      if (n.t2 > prev.t2) { prev.t2 = n.t2; prev.status = n.status; prev.ok = n.ok; prev.error = n.error; }
      if (n.children && n.children.length) {
        prev.children = _regroup((prev.children || []).concat(n.children));
      }
      continue;
    }
    const copy = { ...n, children: n.children ? n.children.slice() : n.children };
    byKey.set(key, copy);
    out.push(copy);
  }
  return out;
}

function tree({ limit = 40 } = {}) {
  const byRun = new Map();
  for (const r of _ring) {
    if (!byRun.has(r.runId)) byRun.set(r.runId, []);
    byRun.get(r.runId).push(r);
  }

  const runs = [];
  for (const [runId, all] of byRun) {
    const sorted = all.slice().sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
    const roots = sorted.filter(r => r.kind === 'inbound');
    const kids = new Map();
    const orphans = [];
    for (const r of sorted) {
      if (r.kind === 'inbound') continue;
      if (r.parent && roots.some(x => x.id === r.parent)) {
        if (!kids.has(r.parent)) kids.set(r.parent, []);
        kids.get(r.parent).push(r);
      } else {
        // Background work outliving its request - the sheet kickoff is deliberately
        // detached - keeps the run but has no root to sit under.
        orphans.push(r);
      }
    }

    // Children are gathered from every id that folded into the row, then collapsed in turn -
    // so six polls read as one line with one aggregator call under it, also marked x6.
    const nodes = _collapse(roots).map(n => ({
      ...n,
      children: _collapse(
        n.ids.flatMap(id => kids.get(id) || [])
          .sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0)),
      ),
    }));
    if (orphans.length) {
      nodes.push({ id: runId + '-bg', kind: 'detached', method: '', url: 'after the response',
        vendor: '', status: 0, ok: orphans.every(o => o.ok !== false), ms: 0, repeat: 1,
        t: orphans[0].t, children: _collapse(orphans) });
    }

    const t0 = sorted[0] ? Date.parse(sorted[0].t) : 0;
    const tEnd = sorted.reduce((m, r) => Math.max(m, Date.parse(r.t) + (r.ms || 0)), t0);
    runs.push({
      runId,
      action: (sorted.find(r => r.action && r.action !== 'background') || sorted[0] || {}).action || 'background',
      t: sorted[0] && sorted[0].t,
      ms: Math.max(0, tEnd - t0),
      calls: sorted.length,
      // Notes are excluded on purpose. A skipped step is not a failure - a ladder that
      // stepped over a dead key and drew on step two did exactly what it was built to do,
      // and calling that run "2 failed" would train you to ignore the word.
      failed: sorted.filter(r => r.ok === false && r.kind !== 'note').length,
      ok: !sorted.some(r => r.ok === false && r.kind !== 'note'),
      nodes,
    });
  }

  runs.sort((a, b) => (a.t < b.t ? 1 : a.t > b.t ? -1 : 0));

  // Adjacent background runs fold into one. Loading the page fires half a dozen unrelated
  // fetches - the character list, the looks, the balance - each its own run of one call, and
  // left alone they push the generation you came to look at off the bottom of the list.
  //
  // Folded, not hidden: every call is still there, one click down. Hiding them behind a
  // filter would mean the log quietly stopped showing everything, which is the opposite of
  // what it is for.
  const out = [];
  for (const r of runs) {
    const prev = out[out.length - 1];
    if (prev && prev.action === 'background' && r.action === 'background') {
      // Prefixed once, not once per merge, or the id grows a "bg:" on every fold and the
      // expanded/collapsed state resets each time the group gains a member.
      if (!prev.merged) prev.runId = 'bg:' + prev.runId;
      prev.merged = (prev.merged || 1) + 1;
      prev.calls += r.calls;
      prev.failed += r.failed;
      prev.ok = prev.ok && r.ok;
      prev.ms = Math.max(prev.ms, r.ms);
      // Regrouped, not just concatenated. Each run was collapsed on its own, so folding
      // thirty balance checks together produced thirty identical rows - the fold made the
      // list shorter by one line and no clearer at all.
      prev.nodes = _regroup(prev.nodes.concat(r.nodes));
      prev.t = r.t;                                  // the group reads from its oldest entry
      continue;
    }
    out.push({ ...r });
  }
  return out.slice(0, limit);
}

// ── The context ─────────────────────────────────────────────────────────────
const ctx = () => als.getStore() || null;

function run(meta, fn) {
  return als.run({ ...meta, seq: 0 }, fn);
}

// ── The interceptor ─────────────────────────────────────────────────────────
function record(cfg, res, err) {
  const c = ctx();
  if (!c) return;                       // not the Character page: nothing is written
  try {
    const t0 = (cfg && cfg.__cv2t) || Date.now();
    const url = redactUrl((cfg && (cfg.url || '')) || '');
    let host = '';
    try { host = new URL(url, (cfg && cfg.baseURL) || 'http://x').host; } catch (e) {}
    const reqBody = packBody(cfg && cfg.data);
    const resBody = packBody(res && res.data);
    write({
      id: 'c' + (++_n),
      runId: c.runId, action: c.action, page: c.page, parent: c.rootId || null,
      kind: 'outbound',
      t: new Date(t0).toISOString(),
      ms: Date.now() - t0,
      method: String((cfg && cfg.method) || 'get').toUpperCase(),
      url, host, vendor: vendorOf(host),
      model: modelOf(cfg && cfg.data && (typeof cfg.data === 'string' ? _tryParse(cfg.data) : cfg.data)),
      status: (res && res.status) || 0,
      ok: !err && !!res && res.status < 400,
      error: err ? String(err.message || err).slice(0, 300) : null,
      req: { headers: redactHeaders(cfg && cfg.headers), body: reqBody.body, bytes: reqBody.bytes },
      res: { headers: redactHeaders(res && res.headers), body: resBody.body, bytes: resBody.bytes },
    });
  } catch (e) {
    console.warn('[cv2-trace] record failed:', e.message);
  }
}

function _tryParse(s) { try { return JSON.parse(s); } catch (e) { return null; } }

function install() {
  if (_wired) return;
  _wired = true;
  warm();
  axios.interceptors.request.use((cfg) => {
    try { if (ctx()) cfg.__cv2t = Date.now(); } catch (e) {}
    return cfg;
  });
  axios.interceptors.response.use(
    (res) => { record(res.config, res, null); return res; },
    (err) => { record(err.config, err.response, err); return Promise.reject(err); },
  );
}

// ── The inbound call, which is the root of every tree ────────────────────────
// Express middleware. The page tags its own requests, so this opens a context only for
// those - and everything the route then does downstream inherits it.
//
// res.json is wrapped rather than res.end: every route here answers with res.json, and the
// object is still an object at that point, so it can be scrubbed instead of re-parsed.
function middleware(req, res, next) {
  const runId = req.get('X-CV2-Run');
  if (!runId) return next();

  const rootId = 'c' + (++_n);
  const t0 = Date.now();
  const meta = {
    runId,
    action: req.get('X-CV2-Action') || 'background',
    page: req.get('X-CV2-Page') || 'character',
    rootId,
  };

  const reqBody = packBody(req.body);
  const json = res.json.bind(res);
  let done = false;
  const finish = (payload) => {
    if (done) return;
    done = true;
    const resBody = packBody(payload);
    write({
      id: rootId, runId: meta.runId, action: meta.action, page: meta.page, parent: null,
      kind: 'inbound',
      t: new Date(t0).toISOString(),
      ms: Date.now() - t0,
      method: req.method,
      url: redactUrl(req.originalUrl), host: 'self', vendor: 'self', model: '',
      status: res.statusCode,
      ok: res.statusCode < 400,
      error: null,
      req: { headers: redactHeaders(req.headers), body: reqBody.body, bytes: reqBody.bytes },
      res: { headers: {}, body: resBody.body, bytes: resBody.bytes },
    });
  };
  res.json = (payload) => { finish(payload); return json(payload); };
  // A route that ends without res.json - a redirect, a stream, a thrown error - still gets
  // its root written, or its branches would hang off nothing.
  res.on('finish', () => finish(null));

  run(meta, () => next());
}

module.exports = {
  install, middleware, run, ctx, note,
  recent, byId, tree, warm,
  redactUrl, redactHeaders, packBody, vendorOf,
  FILE, MAX_BODY, MAX_FILES, MAX_BYTES, RING,
};
