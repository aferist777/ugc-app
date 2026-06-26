// Persistent store for Scenarios/dialogues interview-pose anchors.
// One JSON file (data/dialogue-poses.json, gitignored). Each record is ONE two-figure
// interview anchor (host = blue / left, guest = red / right) for a given format, holding
// both the normal and the horizontally-mirrored variant (file + thumbnail). The anchors
// are a reusable library shared across all dialogue projects.
const fs = require('fs');
const path = require('path');
const { ROOT_DIR } = require('./config');

const DIR = path.join(ROOT_DIR || process.cwd(), 'data');
const FILE = path.join(DIR, 'dialogue-poses.json');

function _read() { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) || []; } catch (e) { return []; } }
function _write(arr) { try { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(arr, null, 2)); } catch (e) {} }

// List, optionally filtered by format ('9:16' | '16:9'), newest first.
function list(format) {
  let arr = _read();
  if (format) arr = arr.filter(p => p.format === format);
  return arr.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}
function get(id) { return _read().find(p => String(p.id) === String(id)) || null; }

// Upsert. Pass an id to update; omit it to create. Returns the stored record.
function save(rec) {
  rec = rec || {};
  const arr = _read();
  const id = rec.id || ('dpose_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7));
  const createdAt = rec.createdAt || Date.now();
  const out = Object.assign({}, rec, { id, createdAt });
  const i = arr.findIndex(p => String(p.id) === String(id));
  if (i >= 0) arr[i] = out; else arr.push(out);
  _write(arr);
  return out;
}
function remove(id) { _write(_read().filter(p => String(p.id) !== String(id))); return true; }

module.exports = { list, get, save, remove };
