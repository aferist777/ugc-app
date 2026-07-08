// Learned render-time model for the UGC "first frame" composite (a single Replicate
// nano-banana-2 image gen). One JSON file (data/, gitignored): { n, avg }. Powers the
// adaptive ETA countdown on the "gen ff" button. Mirrors dialogue-ep-timings but the
// first frame has no output duration, so it is just a running average of wall-clock time.
const fs = require('fs');
const path = require('path');
const { ROOT_DIR } = require('./config');

const DIR = path.join(ROOT_DIR || process.cwd(), 'data');
const FILE = path.join(DIR, 'ugc-ff-timings.json');
const DEFAULT_SEC = 30;   // sane first guess until we have real data

function _read() { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) || {}; } catch (e) { return {}; } }
function _write(o) { try { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(o, null, 2)); } catch (e) {} }

// Record an actual render: sec = wall-clock seconds it took.
function record(sec) {
  if (!(sec > 0) || sec > 1800) return;
  const o = _read();
  const n = o.n || 0, avg = o.avg || 0;
  o.avg = (avg * n + sec) / (n + 1); o.n = n + 1;
  _write(o);
}
// Predict render seconds: the learned average once we have data, else a default.
function predict() {
  const o = _read();
  return Math.round((o.n > 0 && o.avg > 0) ? o.avg : DEFAULT_SEC);
}

module.exports = { record, predict };
