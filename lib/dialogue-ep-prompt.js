// Version store for the dialogue episode-video system prompt template.
// One JSON file (data/, gitignored): { activeId:'original'|<id>, versions:[{id,ts,text}] }.
// The built-in "original" template lives in routes/generate.js and is passed into state().
const fs = require('fs');
const path = require('path');
const { ROOT_DIR } = require('./config');

const DIR = path.join(ROOT_DIR || process.cwd(), 'data');
const FILE = path.join(DIR, 'dialogue-ep-prompt.json');

function _read() { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) || {}; } catch (e) { return {}; } }
function _write(o) { try { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(o, null, 2)); } catch (e) {} }

// Resolve the active template text. `original` = the built-in template (used when activeId is
// 'original' or the active version is gone).
function state(original) {
  const s = _read();
  const versions = Array.isArray(s.versions) ? s.versions : [];
  const activeId = s.activeId || 'original';
  const active = (activeId === 'original') ? original : ((versions.find(v => v.id === activeId) || {}).text || original);
  return { activeId, active, versions, original };
}
// Save the edited text as a new version and make it active (keep the last 10).
function save(text) {
  const s = _read();
  const versions = Array.isArray(s.versions) ? s.versions : [];
  const id = 'v_' + Date.now();
  versions.unshift({ id, ts: Date.now(), text: String(text || '') });
  while (versions.length > 10) versions.pop();
  _write({ activeId: id, versions });
  return id;
}
function activate(id) { const s = _read(); _write({ activeId: String(id || 'original'), versions: Array.isArray(s.versions) ? s.versions : [] }); return id; }
function reset() { const s = _read(); _write({ activeId: 'original', versions: Array.isArray(s.versions) ? s.versions : [] }); }

module.exports = { state, save, activate, reset };
