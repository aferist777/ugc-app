// Persistent store for Scenarios/dialogues projects.
// One JSON file (data/dialogue-projects.json, gitignored). Each project keeps the
// generation params, the cast (host/guest model id + frame + role name) and the
// generated clean+colored tagged scenario, so a project fully restores on load.
const fs = require('fs');
const path = require('path');
const { ROOT_DIR } = require('./config');

const DIR = path.join(ROOT_DIR || process.cwd(), 'data');
const FILE = path.join(DIR, 'dialogue-projects.json');

function _read() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) || []; } catch (e) { return []; }
}
function _write(arr) {
  try { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(arr, null, 2)); } catch (e) {}
}

// Light list for the dropdown (newest first).
function list() {
  return _read()
    .map(p => ({ id: p.id, name: p.name, createdAt: p.createdAt || 0 }))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}
function get(id) { return _read().find(p => String(p.id) === String(id)) || null; }

// Upsert. Pass an id to update; omit it to create. Returns the stored record.
function save(proj) {
  proj = proj || {};
  const arr = _read();
  const id = proj.id || ('dlg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7));
  const createdAt = proj.createdAt || Date.now();
  const rec = { id, name: String(proj.name || ('project ' + id)), createdAt, updatedAt: Date.now(), data: proj.data || {} };
  const i = arr.findIndex(p => String(p.id) === String(id));
  if (i >= 0) rec.createdAt = arr[i].createdAt || createdAt, arr[i] = rec; else arr.push(rec);
  _write(arr);
  return rec;
}
function remove(id) { _write(_read().filter(p => String(p.id) !== String(id))); return true; }

module.exports = { list, get, save, remove };
