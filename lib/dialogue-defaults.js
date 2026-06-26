// Global defaults for the Scenarios/dialogues Video setup (last chosen values become the
// defaults that new dialogue projects inherit). One JSON file (data/, gitignored).
const fs = require('fs');
const path = require('path');
const { ROOT_DIR } = require('./config');

const DIR = path.join(ROOT_DIR || process.cwd(), 'data');
const FILE = path.join(DIR, 'dialogue-defaults.json');
const DEF = { engine: 'nano-banana-2', engineParams: {}, camera: 'iphone-wide', seedTiming: 'words', seedImprove: true, bothTwoStep: false, resolution: '480p', nsfw: false };

function get() { try { return Object.assign({}, DEF, JSON.parse(fs.readFileSync(FILE, 'utf8')) || {}); } catch (e) { return Object.assign({}, DEF); } }
function save(patch) { try { fs.mkdirSync(DIR, { recursive: true }); const out = Object.assign({}, get(), patch || {}); fs.writeFileSync(FILE, JSON.stringify(out, null, 2)); return out; } catch (e) { return get(); } }

module.exports = { get, save, DEF };
