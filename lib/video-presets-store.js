'use strict';

// ════════════════════════════════════════════════════════════════════════════
// THE PERSON'S VIDEO PRESETS (phase V4, docs/local-app/PLAN.md "V-D") - data/video-presets.json, a plain list, so
// an Import merges it by id (mergeLists below: the newer `updated` wins, versions are joined by their moment).
//
// There are no presets of the owner in the program and no tool for them (the owner, 2026-10-05). SAMPLES ship
// with the program as read-only data (presets-src/video/samples.json) and are SEEDED into this store ONE BY ONE:
// a ready sample whose id the store does not have - live or deleted - is copied in with `seed: {id, v}`, and from
// then on it is the person's.
//
//   save        a NEW VERSION: the state before goes into `versions` ({v, at, what, ...fields}, `what` in words);
//               nothing is wiped. At most 50 versions; the very first is never thrown away.
//   restore     any version made current again - as a new version, so a restore can be undone too
//   original    a sample back to what it came with (its first version)
//   duplicate   "<title> (copy)", the current state as its first version, `source {kind:'copy', from}` - the
//               recommended way to change a sample
//   remove      a sample leaves a mark `{id, deleted, seed}` so it does not come back by itself (bringBack brings
//               it back); a copy goes with its versions
//   takeNewer   a sample shipped in a newer version (`v` above `seed.v`) is offered, and taken as a new version
//   retired     a sample the program WITHDREW (RETIRED) goes from the store as it was seeded - its mark too; a copy the
//               person changed stays theirs, an ordinary preset
//
// Everything is read, changed and written in one tick (no await between): a request never writes a list it read
// before another one changed it.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { APP_DIR, DATA_DIR } = require('./config');
const { writeFileAtomic } = require('./atomic-write');

const FILE = path.join(DATA_DIR, 'video-presets.json');
let SAMPLES = path.join(APP_DIR, 'presets-src', 'video', 'samples.json');
const MAX_VERSIONS = 50;
// (phase V17) Samples the program withdrew: dancer-swap-room - the chat's own way for Kling motion control since V17.
const RETIRED = ['dancer-swap-room'];
const FIELDS = ['title', 'summary', 'category', 'tags', 'skill', 'slots', 'models', 'aspect', 'duration', 'audio', 'params', 'music', 'twoStep'];
const KINDS = ['image', 'frame-first', 'frame-last', 'video', 'audio'];
const ROLES = ['person', 'product', 'outfit', 'location', 'prop', 'style', 'motion', 'music', 'voice'];
const WORDS = { title: 'title', summary: 'description', category: 'category', tags: 'tags', skill: 'skill', slots: 'slots',
                models: 'models', aspect: 'shape', duration: 'length', audio: 'sound', params: 'settings', music: 'music', twoStep: 'two steps' };

// ── The file ────────────────────────────────────────────────────────────────
function _read() {
  try { const l = JSON.parse(fs.readFileSync(FILE, 'utf8')); return Array.isArray(l) ? l.filter(x => x && x.id) : []; }
  catch (e) { return []; }
}
function _write(list) { writeFileAtomic(FILE, JSON.stringify(list, null, 2)); }
const _now = () => new Date().toISOString();
const _newId = () => 'vp' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function samples() {
  try {
    const d = JSON.parse(fs.readFileSync(SAMPLES, 'utf8'));
    return (Array.isArray(d.samples) ? d.samples : []).filter(s => s && s.id);
  } catch (e) { return []; }
}
const _sample = (id) => samples().find(s => s.id === id) || null;

// ── The fields, as a preset keeps them ──────────────────────────────────────
const _str = (v, n) => String(v == null ? '' : v).replace(/\r\n/g, '\n').slice(0, n);
function _slot(s) {
  const min = Math.max(0, Math.min(30, Math.round(+s.min || 0)));
  return {
    key: _str(s.key, 30).replace(/[^a-z0-9_-]/gi, '').toLowerCase() || 'slot',
    kind: KINDS.includes(s.kind) ? s.kind : 'image',
    role: ROLES.includes(s.role) ? s.role : 'person',
    min, max: Math.max(min, Math.min(50, Math.round(+s.max || min || 1))),
    required: !!s.required, hint: _str(s.hint, 200),
  };
}
/** What a preset may hold, cleaned: only the known fields, each in its shape. */
function clean(fields) {
  const f = fields || {};
  const out = {};
  if ('title' in f) out.title = _str(f.title, 120).trim() || 'Untitled preset';
  if ('summary' in f) out.summary = _str(f.summary, 400);
  if ('category' in f) out.category = _str(f.category, 40);
  if ('tags' in f) out.tags = (Array.isArray(f.tags) ? f.tags : []).map(t => _str(t, 40).trim()).filter(Boolean).slice(0, 12);
  if ('skill' in f) out.skill = _str(f.skill, 20000);
  if ('slots' in f) out.slots = (Array.isArray(f.slots) ? f.slots : []).filter(s => s && typeof s === 'object').slice(0, 12).map(_slot);
  if ('models' in f) {
    let known = null;
    try { known = new Set(require('./video-models').MODELS.map(m => m.id)); } catch (e) { known = null; }
    out.models = (Array.isArray(f.models) ? f.models : []).map(String).filter(m => !known || known.has(m)).slice(0, 7);
  }
  if ('aspect' in f) out.aspect = _str(f.aspect, 10);
  if ('duration' in f) out.duration = f.duration == null || f.duration === '' ? null : Math.max(0, Math.min(60, +f.duration || 0));
  if ('audio' in f) out.audio = f.audio == null ? null : !!f.audio;
  if ('params' in f) {
    const p = {};
    for (const [k, v] of Object.entries((f.params && typeof f.params === 'object') ? f.params : {}).slice(0, 20)) {
      if (['string', 'number', 'boolean'].includes(typeof v)) p[_str(k, 30)] = typeof v === 'string' ? _str(v, 60) : v;
    }
    out.params = p;
  }
  if ('music' in f) out.music = ['keep', 'none'].includes(f.music) ? f.music : '';
  if ('twoStep' in f) out.twoStep = f.twoStep && typeof f.twoStep === 'object' ? JSON.parse(JSON.stringify(f.twoStep)) : null;
  return out;
}
const _state = (p) => { const s = {}; for (const k of FIELDS) if (k in p) s[k] = p[k]; return s; };
const _same = (a, b) => JSON.stringify(a == null ? null : a) === JSON.stringify(b == null ? null : b);

// ── Seeding ─────────────────────────────────────────────────────────────────
function _fromSample(s) {
  const at = _now();
  return Object.assign({ id: s.id, v: 1 }, clean(s), {
    source: { kind: 'sample' }, seed: { id: s.id, v: +s.v || 1 }, what: 'as it came with the program',
    versions: [], created: at, updated: at,
  });
}
// Each ready sample the store does not have, live or deleted - one by one, never the set over the person's. A withdrawn
// sample's copy that is as it was seeded - never changed - and its mark go.
function _seed(list) {
  let changed = false;
  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i];
    if (p.seed && RETIRED.includes(p.seed.id) && (p.deleted || !(p.versions || []).length)) { list.splice(i, 1); changed = true; }
  }
  const have = new Set(list.map(p => p.id));
  for (const s of samples()) {
    if (!s.ready || have.has(s.id)) continue;
    list.push(_fromSample(s));
    changed = true;
  }
  return changed;
}

function _view(p) {
  if (!p || p.deleted) return null;
  const s = p.seed ? _sample(p.seed.id) : null;
  return Object.assign({}, p, {
    versions: undefined, versionCount: (p.versions || []).length,
    newer: !!(s && s.ready && (+s.v || 1) > (+p.seed.v || 1)),
  });
}

/** Every live preset (without its versions), and the deleted samples that can be brought back. */
function list() {
  const l = _read();
  if (_seed(l)) _write(l);
  return {
    presets: l.filter(p => !p.deleted).map(_view),
    deleted: l.filter(p => p.deleted && p.seed).map(p => ({ id: p.id, title: (_sample(p.seed.id) || {}).title || p.id, at: p.updated || '' })),
  };
}

function get(id) {
  const p = _read().find(x => x.id === String(id || '') && !x.deleted);
  return p || null;
}

// ── Changing one ────────────────────────────────────────────────────────────
function _change(id, fn) {
  const l = _read();
  const i = l.findIndex(x => x.id === String(id || '') && !x.deleted);
  if (i < 0) throw Object.assign(new Error('no such preset'), { status: 404 });
  const out = fn(l[i], l, i);
  _write(l);
  return out;
}

// The current state into the versions, the new one in its place. The very first version is never dropped.
function _newVersion(p, next, what) {
  const changed = FIELDS.filter(k => k in next && !_same(p[k], next[k]));
  if (!changed.length) return false;
  const versions = (p.versions || []).slice();
  versions.push(Object.assign({ v: p.v || 1, at: p.updated || p.created || _now(), what: p.what || '' }, _state(p)));
  while (versions.length > MAX_VERSIONS) versions.splice(1, 1);
  Object.assign(p, next, { v: (p.v || 1) + 1, versions, updated: _now(), what: what || changed.map(k => WORDS[k] || k).join(', ') });
  return true;
}

/** Save the fields as a new version. Answers the preset as it is now. */
function save(id, fields) {
  return _change(id, (p) => { _newVersion(p, clean(fields)); return _view(p); });
}

/** The versions, oldest first, and the current one last - each with its whole state. */
function versions(id) {
  const p = get(id);
  if (!p) return null;
  const cur = Object.assign({ v: p.v || 1, at: p.updated || p.created, what: p.what || '', current: true }, _state(p));
  return (p.versions || []).map((x, i) => Object.assign({}, x, { current: false, first: i === 0 })).concat([Object.assign(cur, { first: !(p.versions || []).length })]);
}

/** Make an earlier version current again - as a new version. */
function restore(id, v) {
  return _change(id, (p) => {
    const old = (p.versions || []).find(x => x.v === +v);
    if (!old) throw Object.assign(new Error('no such version'), { status: 404 });
    _newVersion(p, clean(_state(old)), 'back to version ' + old.v + (old.v === 1 && p.seed ? ' (the original)' : ''));
    return _view(p);
  });
}

/** A sample back to what it came with: its first version. */
function original(id) {
  const p = get(id);
  if (!p) throw Object.assign(new Error('no such preset'), { status: 404 });
  const first = (p.versions || [])[0];
  if (!first) return _view(p);
  return restore(id, first.v);
}

/** A copy "<title> (copy)" right after it, its own history starting from what it is now. */
function duplicate(id) {
  return _change(id, (p, l, i) => {
    const at = _now();
    const copy = Object.assign({ id: _newId(), v: 1 }, _state(p), {
      title: _str((p.title || 'Preset') + ' (copy)', 120), source: { kind: 'copy', from: p.id }, seed: null,
      what: 'copied from "' + (p.title || p.id) + '"', versions: [], created: at, updated: at,
    });
    l.splice(i + 1, 0, copy);
    return _view(copy);
  });
}

/** Delete: a sample leaves its mark (it does not come back by itself), anything else goes with its versions. */
function remove(id) {
  return _change(id, (p, l, i) => {
    if (p.seed) l[i] = { id: p.id, deleted: true, seed: p.seed, updated: _now() };
    else l.splice(i, 1);
    return { id: p.id, mark: !!p.seed };
  });
}

/** A deleted sample, seeded again as it ships now. */
function bringBack(id) {
  const l = _read();
  const i = l.findIndex(x => x.id === String(id || '') && x.deleted);
  if (i < 0) throw Object.assign(new Error('nothing to bring back'), { status: 404 });
  const s = _sample(l[i].seed && l[i].seed.id);
  if (!s || !s.ready) throw Object.assign(new Error('this sample is not in the program any more'), { status: 410 });
  l[i] = _fromSample(s);
  _write(l);
  return _view(l[i]);
}

/** The newer version of a sample, taken as a new version of the person's copy (their edits stay in its versions). */
function takeNewer(id) {
  return _change(id, (p) => {
    const s = p.seed ? _sample(p.seed.id) : null;
    if (!s || !s.ready || (+s.v || 1) <= (+p.seed.v || 1)) throw Object.assign(new Error('there is no newer sample'), { status: 409 });
    _newVersion(p, clean(s), 'the newer sample (v' + s.v + ')');
    p.seed = { id: s.id, v: +s.v || 1 };
    return _view(p);
  });
}

// ── Import ──────────────────────────────────────────────────────────────────
/**
 * Two lists of one store, merged (lib/library-merge.js): one id, the newer `updated` wins - a deletion mark too -
 * and the versions of both are joined by their moment.
 */
function mergeLists(local, incoming) {
  const out = (Array.isArray(local) ? local : []).filter(x => x && x.id).map(x => Object.assign({}, x));
  const at = new Map(out.map((x, i) => [x.id, i]));
  for (const inc of (Array.isArray(incoming) ? incoming : [])) {
    if (!inc || !inc.id) continue;
    const i = at.get(inc.id);
    if (i == null) { at.set(inc.id, out.length); out.push(inc); continue; }
    const mine = out[i];
    const win = String(inc.updated || '') > String(mine.updated || '') ? inc : mine;
    if (win.deleted) { out[i] = win; continue; }
    const seen = new Set();
    const versions = [...(mine.versions || []), ...(inc.versions || [])]
      .filter(v => { const k = (v && v.at) + '|' + (v && v.v); if (!v || seen.has(k)) return false; seen.add(k); return true; })
      .sort((a, b) => String(a.at).localeCompare(String(b.at)));
    out[i] = Object.assign({}, win, { versions: versions.filter(v => !(v.at === win.updated && v.v === win.v)) });
  }
  return out;
}

module.exports = { FILE, list, get, save, versions, restore, original, duplicate, remove, bringBack, takeNewer,
                   samples, clean, mergeLists, KINDS, ROLES, MAX_VERSIONS,
                   // for the stands: samples from another file
                   _setSamplesFile: (abs) => { SAMPLES = abs; } };
