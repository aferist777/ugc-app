'use strict';

// ════════════════════════════════════════════════════════════════════════════
// THE PERSON'S OWN CAPTION PRESETS (phase V30, block 5; the owner's (с13), (с45)-(с52), docs/local-app/PLAN.md "Фаза V30")
// - data/caption-presets.json, a plain list, newest first:
//
//   { id: 'my-…', name, style, created, updated }     a preset: a whole caption style (style.js normalizeStyle), as the
//                                                     strip showed it when "save as my preset" was pressed
//   …, kind: 'text'                                   one saved from a text lane or line (phase V42): it is in the TEXT
//                                                     gallery's Mine and carries no place (presets-text.js TEXT_KEEP);
//                                                     no `kind` - a subtitle one, as every preset saved before V42
//
//   add(name, style)   a new one. A name is one preset's (case aside) and never the name of a preset the app ships -
//                      "based on Red Pop" must say which; a taken name is REFUSED, never replaced (с45). At most 200.
//   rename(id, name)   the name only: a preset's look never changes once saved (с45), so its tile is made once
//   remove(id)         at once (с47). The projects that wear it keep their look: a style holds the whole look and only
//                      the id of the preset it came from - "based on" simply stops being said. (The mark a deleted one
//                      left for Import (с52) went with Import, phase V54: an older file's marks are dropped when read.)
//
// Read, changed and written in one tick (no await between), atomically.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./config');
const { writeFileAtomic } = require('./atomic-write');
const { normalizeStyle } = require('./mv3b-subs');
const { PRESETS } = require('../public/js/captions/presets.js');
const { TEXT_PRESETS } = require('../public/js/captions/presets-text.js');

const FILE = path.join(DATA_DIR, 'caption-presets.json');
const MAX = 200;            // the person's presets
const NAME_MAX = 60;

const _err = (status, message) => Object.assign(new Error(message), { status });
const _now = () => new Date().toISOString();
const _newId = () => 'my-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/** A name as it is kept: one line, no control characters, spaces squeezed, at most 60 characters. */
function cleanName(v) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX).trim();
}

/** The style a preset keeps: every field, each valid, and no `preset` of its own (applying it marks the id). */
// (phase V66) A lane's held place (`hold`) is the lane's, not a look: a preset saved from it does not carry it.
const cleanStyle = (st) => { const o = normalizeStyle(Object.assign({}, st && typeof st === 'object' ? st : {}, { preset: '' })); delete o.hold; return o; };

// One entry, as the file may hold it - a hand may have written anything; an older file's deletion mark is none.
function _entry(x) {
  if (!x || typeof x !== 'object' || typeof x.id !== 'string' || !/^[\w-]{1,60}$/.test(x.id)) return null;
  if (x.deleted) return null;
  const name = cleanName(x.name);
  if (!name || !x.style || typeof x.style !== 'object') return null;
  const e = { id: x.id, name, style: cleanStyle(x.style), created: String(x.created || x.updated || ''), updated: String(x.updated || x.created || '') };
  if (x.kind === 'text') e.kind = 'text';
  return e;
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
  // Newest first.
  writeFileAtomic(FILE, JSON.stringify(list.slice().sort((a, b) => String(b.created).localeCompare(String(a.created))), null, 2));
}

// The app's presets, both galleries: a name of one of them is never a name of the person's.
const _shipped = () => new Map(PRESETS.concat(TEXT_PRESETS).map((p) => [String(p.name).toLowerCase(), p.name]));

// Why a name cannot be this preset's - '' when it can.
function _whyNot(list, name, exceptId) {
  if (!name) return 'Give it a name.';
  const low = name.toLowerCase();
  const mine = list.find((x) => x.id !== exceptId && x.name.toLowerCase() === low);
  if (mine) return 'You already have a preset called "' + mine.name + '" - give this one another name, or delete that one first.';
  const app = _shipped().get(low);
  if (app) return '"' + app + '" is one of the app\'s presets - give yours another name.';
  return '';
}

const _view = (x) => Object.assign({ id: x.id, name: x.name, style: x.style, created: x.created, updated: x.updated }, x.kind ? { kind: x.kind } : {});

/** The person's presets, newest first. */
function list() {
  return _read().map(_view);
}

function get(id) {
  const x = _read().find((p) => p.id === String(id || ''));
  return x ? _view(x) : null;
}

/** A new preset from a style - `kind` 'text' for one of the text gallery (V42). Refused: no name, a taken one (с45), the 201st. */
function add(name, style, kind) {
  const l = _read();
  const n = cleanName(name);
  const why = _whyNot(l, n, null);
  if (why) throw _err(n ? 409 : 400, why);
  if (!style || typeof style !== 'object') throw _err(400, 'No style to save.');
  if (l.length >= MAX) throw _err(409, 'You have ' + MAX + ' presets of your own - delete one to save another.');
  const ids = new Set(l.map((x) => x.id));
  let id = _newId();
  while (ids.has(id)) id = _newId();
  const at = _now();
  const p = { id, name: n, style: cleanStyle(style), created: at, updated: at };
  if (kind === 'text') p.kind = 'text';
  l.unshift(p);
  _write(l);
  return _view(p);
}

/** Its name only. */
function rename(id, name) {
  const l = _read();
  const p = l.find((x) => x.id === String(id || ''));
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

/** Gone at once (с47). */
function remove(id) {
  const l = _read();
  const i = l.findIndex((x) => x.id === String(id || ''));
  if (i < 0) throw _err(404, 'That preset is not there any more.');
  const [gone] = l.splice(i, 1);
  _write(l);
  return { id: gone.id };
}

module.exports = { FILE, MAX, NAME_MAX, list, get, add, rename, remove, cleanName, cleanStyle };
