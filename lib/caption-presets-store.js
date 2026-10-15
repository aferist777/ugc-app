'use strict';

// ════════════════════════════════════════════════════════════════════════════
// THE PERSON'S OWN CAPTION PRESETS (phase V30, block 5; the owner's (с13), (с45)-(с52), docs/local-app/PLAN.md "Фаза V30")
// - data/caption-presets.json, a plain list, newest first:
//
//   { id: 'my-…', name, style, created, updated }     a preset: a whole caption style (style.js normalizeStyle), as the
//                                                     strip showed it when "save as my preset" was pressed
//   { id, deleted: true, updated }                    a deleted one's mark: an Import never brings it back (с52)
//
//   add(name, style)   a new one. A name is one preset's (case aside) and never the name of a preset the app ships -
//                      "based on Red Pop" must say which; a taken name is REFUSED, never replaced (с45). At most 200.
//   rename(id, name)   the name only: a preset's look never changes once saved (с45), so its tile is made once
//   remove(id)         at once (с47). The projects that wear it keep their look: a style holds the whole look and only
//                      the id of the preset it came from - "based on" simply stops being said
//   mergeLists         an Import (lib/library-merge.js): the same preset (one id) once - the newer, which may be
//                      renamed; one deleted here stays deleted; another preset whose name is taken here comes as
//                      "Name (2)" (с52); a preset here is never deleted by an Import (a mark in the archive leaves it)
//
// Read, changed and written in one tick (no await between), atomically.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./config');
const { writeFileAtomic } = require('./atomic-write');
const { normalizeStyle } = require('./mv3b-subs');
const { PRESETS } = require('../public/js/captions/presets.js');

const FILE = path.join(DATA_DIR, 'caption-presets.json');
const MAX = 200;            // the person's presets
const MAX_MARKS = 1000;     // deletion marks kept; the oldest go first
const NAME_MAX = 60;

const _err = (status, message) => Object.assign(new Error(message), { status });
const _now = () => new Date().toISOString();
const _newId = () => 'my-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/** A name as it is kept: one line, no control characters, spaces squeezed, at most 60 characters. */
function cleanName(v) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX).trim();
}

/** The style a preset keeps: every field, each valid, and no `preset` of its own (applying it marks the id). */
const cleanStyle = (st) => normalizeStyle(Object.assign({}, st && typeof st === 'object' ? st : {}, { preset: '' }));

// One entry, as the file may hold it - an archive or a hand may have written anything.
function _entry(x) {
  if (!x || typeof x !== 'object' || typeof x.id !== 'string' || !/^[\w-]{1,60}$/.test(x.id)) return null;
  if (x.deleted) return { id: x.id, deleted: true, updated: String(x.updated || '') };
  const name = cleanName(x.name);
  if (!name || !x.style || typeof x.style !== 'object') return null;
  return { id: x.id, name, style: cleanStyle(x.style), created: String(x.created || x.updated || ''), updated: String(x.updated || x.created || '') };
}
function _clean(list) {
  const seen = new Set();
  const out = [];
  for (const x of (Array.isArray(list) ? list : [])) {
    const e = _entry(x);
    if (!e || seen.has(e.id)) continue;
    seen.add(e.id);
    out.push(e);
  }
  return out;
}

function _read() {
  try { return _clean(JSON.parse(fs.readFileSync(FILE, 'utf8'))); } catch (e) { return []; }
}
function _write(list) {
  // The live ones newest first, the marks after them - the newest marks kept.
  const live = list.filter((x) => !x.deleted).sort((a, b) => String(b.created).localeCompare(String(a.created)));
  const marks = list.filter((x) => x.deleted).sort((a, b) => String(b.updated).localeCompare(String(a.updated))).slice(0, MAX_MARKS);
  writeFileAtomic(FILE, JSON.stringify(live.concat(marks), null, 2));
}

const _shipped = () => new Map(PRESETS.map((p) => [String(p.name).toLowerCase(), p.name]));

// Why a name cannot be this preset's - '' when it can.
function _whyNot(list, name, exceptId) {
  if (!name) return 'Give it a name.';
  const low = name.toLowerCase();
  const mine = list.find((x) => !x.deleted && x.id !== exceptId && x.name.toLowerCase() === low);
  if (mine) return 'You already have a preset called "' + mine.name + '" - give this one another name, or delete that one first.';
  const app = _shipped().get(low);
  if (app) return '"' + app + '" is one of the app\'s presets - give yours another name.';
  return '';
}

// "Name (2)", "(3)" … within the length a name may have.
function _unique(name, taken) {
  if (!taken.has(name.toLowerCase())) return name;
  for (let n = 2; ; n++) {
    const suffix = ' (' + n + ')';
    const cand = name.slice(0, NAME_MAX - suffix.length).trim() + suffix;
    if (!taken.has(cand.toLowerCase())) return cand;
  }
}

const _view = (x) => ({ id: x.id, name: x.name, style: x.style, created: x.created, updated: x.updated });

/** The person's presets, newest first. */
function list() {
  return _read().filter((x) => !x.deleted).map(_view);
}

function get(id) {
  const x = _read().find((p) => p.id === String(id || '') && !p.deleted);
  return x ? _view(x) : null;
}

/** A new preset from a style. Refused: no name, a taken one (с45), the 201st. */
function add(name, style) {
  const l = _read();
  const n = cleanName(name);
  const why = _whyNot(l, n, null);
  if (why) throw _err(n ? 409 : 400, why);
  if (!style || typeof style !== 'object') throw _err(400, 'No style to save.');
  if (l.filter((x) => !x.deleted).length >= MAX) throw _err(409, 'You have ' + MAX + ' presets of your own - delete one to save another.');
  const ids = new Set(l.map((x) => x.id));
  let id = _newId();
  while (ids.has(id)) id = _newId();
  const at = _now();
  const p = { id, name: n, style: cleanStyle(style), created: at, updated: at };
  l.unshift(p);
  _write(l);
  return _view(p);
}

/** Its name only. */
function rename(id, name) {
  const l = _read();
  const p = l.find((x) => x.id === String(id || '') && !x.deleted);
  if (!p) throw _err(404, 'That preset is not there any more.');
  const n = cleanName(name);
  if (n === p.name) return _view(p);
  const why = _whyNot(l, n, p.id);
  if (why) throw _err(n ? 409 : 400, why);
  p.name = n;
  p.updated = _now();
  _write(l);
  return _view(p);
}

/** Gone at once (с47) - its mark stays, so an Import does not bring it back (с52). */
function remove(id) {
  const l = _read();
  const i = l.findIndex((x) => x.id === String(id || '') && !x.deleted);
  if (i < 0) throw _err(404, 'That preset is not there any more.');
  l[i] = { id: l[i].id, deleted: true, updated: _now() };
  _write(l);
  return { id: l[i].id };
}

/**
 * Two lists of this store, merged for an Import (lib/library-merge.js) - whatever "overwrite" says, as the video presets:
 * one id is one preset (its look never changes), so the newer copy is kept - a rename travels; a preset deleted here stays
 * deleted; a new one whose name is taken here - by a preset of the person's or of the app's - comes as "Name (2)" (с52).
 * Nothing here is deleted by what the archive says.
 */
function mergeLists(local, incoming) {
  const out = _clean(local);
  const at = new Map(out.map((x, i) => [x.id, i]));
  const taken = (exceptId) => {
    const t = new Set(_shipped().keys());
    for (const x of out) if (!x.deleted && x.id !== exceptId) t.add(x.name.toLowerCase());
    return t;
  };
  for (const inc of _clean(incoming)) {
    if (inc.deleted) continue;
    const i = at.get(inc.id);
    if (i == null) {
      at.set(inc.id, out.length);
      out.push(Object.assign({}, inc, { name: _unique(inc.name, taken(null)) }));
      continue;
    }
    const here = out[i];
    if (here.deleted) continue;
    if (String(inc.updated) > String(here.updated)) {
      out[i] = Object.assign({}, inc, { name: _unique(inc.name, taken(inc.id)) });
    }
  }
  const live = out.filter((x) => !x.deleted).sort((a, b) => String(b.created).localeCompare(String(a.created)));
  return live.concat(out.filter((x) => x.deleted));
}

module.exports = { FILE, MAX, NAME_MAX, list, get, add, rename, remove, mergeLists, cleanName, cleanStyle };
