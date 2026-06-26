// Learned render-time model for dialogue episode videos. Keyed by the fragment's target
// duration (seconds). Used to show a smart ETA countdown on the card during generation.
// One JSON file (data/, gitignored): { byDur: { "<dur>": {n, avg} }, all: {n, sumRate} }.
const fs = require('fs');
const path = require('path');
const { ROOT_DIR } = require('./config');

const DIR = path.join(ROOT_DIR || process.cwd(), 'data');
const FILE = path.join(DIR, 'dialogue-ep-timings.json');
const DEFAULT_RATE = 28;   // seconds of render per second of output, until we have data

function _read() { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) || {}; } catch (e) { return {}; } }
function _write(o) { try { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(o, null, 2)); } catch (e) {} }

// Record an actual render: dur = fragment seconds, sec = wall-clock seconds it took.
function record(dur, sec) {
  if (!(dur > 0) || !(sec > 0) || sec > 3600) return;
  const o = _read();
  o.byDur = o.byDur || {};
  const k = String(Math.round(dur));
  const b = o.byDur[k] || { n: 0, avg: 0 };
  b.avg = (b.avg * b.n + sec) / (b.n + 1); b.n++;
  o.byDur[k] = b;
  const g = o.all || { n: 0, sumRate: 0 };
  g.sumRate += sec / dur; g.n++; o.all = g;
  _write(o);
}
// Predict render seconds for a fragment of `dur` seconds: average for that exact duration if we
// have it, else the learned per-output-second rate * dur, else a sane default.
function predict(dur) {
  const o = _read();
  const k = String(Math.round(dur || 8));
  if (o.byDur && o.byDur[k] && o.byDur[k].n > 0) return Math.round(o.byDur[k].avg);
  const rate = (o.all && o.all.n > 0) ? (o.all.sumRate / o.all.n) : DEFAULT_RATE;
  return Math.round(rate * (dur || 8));
}
function averages() { const o = _read(); return { byDur: o.byDur || {}, rate: (o.all && o.all.n > 0) ? (o.all.sumRate / o.all.n) : DEFAULT_RATE }; }

module.exports = { record, predict, averages };
