/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — captions from the sound, as the page follows them (phase K1, 2026-10-03).

   The SERVER listens and lays the lines (lib/captions-job.js); this only presses the button and says
   what is happening, for the project that is open:

     the press     everything unsaved is saved first - the server listens to the SAVED timeline - and
                   POST /api/mv3/captions/transcribe { key }
     the wait      GET /api/mv3/captions/state?key= every 1.5 s while that project's job runs and the
                   tab is looked at. Leaving the project, the page or the app stops only the asking: the
                   job goes on, and opening the project again picks it up by its key
     the end       the store reads the timeline the server laid (Store.refresh), which says "Captions
                   laid from the sound" rather than "another device", and is one Ctrl+Z

   The state is per PROJECT: "listening..." on one project's lane says nothing on another's.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as Store from './store.js';
import { soundPieces } from '../captions/heard.js';

const POLL_MS = 1500;

const _by = new Map();         // key -> { job, last, refused }
let _subs = [];
let _timer = null;
let _key = null;

function _emit() { for (const cb of _subs) { try { cb(); } catch (e) { /* a listener's own trouble */ } } }
export function onChange(cb) { if (typeof cb === 'function') _subs.push(cb); }

const _get = (k) => { let s = _by.get(k); if (!s) { s = { job: null, last: null, refused: '', read: false }; _by.set(k, s); } return s; };

const _when = (iso) => {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ' '
    + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
};
const _cap = (s) => String(s || '').replace(/^./, (m) => m.toUpperCase());
const _n = (n, one, many) => n + ' ' + (n === 1 ? one : many);

// What the line under the button says.
function _line(s) {
  if (s.refused) return s.refused;
  const j = s.job;
  if (j && j.state === 'listening') {
    const step = String(j.step || 'starting');
    if (step === 'collecting the sound' && j.part) return 'Listening - collecting the sound (' + j.part.i + ' of ' + j.part.n + ')';
    return 'Listening - ' + step;
  }
  if (j && j.state === 'failed') return j.error || 'It did not finish.';
  if (j && j.state === 'done') {
    const r = j.result || {};
    const out = [];
    out.push(r.lines ? _n(r.lines, 'line', 'lines') + ' from ' + _n(r.words, 'word', 'words') + '.'
      : 'Nothing was said on those tracks - the lane was left as it was.');
    if (r.lines && !r.paid) out.push('Nothing paid - heard before.');
    if (r.lines && !r.asked && r.language) out.push('Heard as ' + _cap(r.language) + '.');
    const typed = r.dropped && r.dropped.typed;
    if (typed) out.push(_n(typed, 'word', 'words') + ' under your typed lines ' + (typed === 1 ? 'was' : 'were') + ' left out.');
    if (r.missing && r.missing.length) out.push('Not found, heard as silence: ' + r.missing.slice(0, 4).join(', ') + (r.missing.length > 4 ? '...' : '') + '.');
    if (r.moved) out.push('The sound changed while listening - press again to match it.');
    if (r.suspect) out.push('Groq may have heard only part of it - press again to ask once more.');
    return out.join(' ');
  }
  if (s.last && s.last.at) {
    return 'Last listened ' + _when(s.last.at) + ' - ' + _n(+s.last.lines || 0, 'line', 'lines') + ' from '
      + _n(+s.last.words || 0, 'word', 'words') + '.';
  }
  return '';
}

/** What the subtitle lane's strip shows for a project. */
export function view(key) {
  const k = key || Store.key();
  if (!k) return { busy: false, line: '' };
  const s = _get(k);
  return { busy: !!(s.job && s.job.state === 'listening'), line: _line(s) };
}

async function _read(k) {
  try {
    const d = await fetch('/api/mv3/captions/state?key=' + encodeURIComponent(k)).then(r => r.json());
    if (!d || !d.success) return null;
    return d;
  } catch (e) { return null; }
}

// The server's lay arrives through the store, which knows it from a person's edit (store.js,
// _serverOnly). The watcher would find it within twenty seconds; this is now.
async function _landed(rev) {
  for (let i = 0; i < 10; i++) {
    await Store.refresh();
    if (!(rev > Store.version())) return;
    await new Promise(r => setTimeout(r, 400));
  }
}

// The first read of a project happens whatever the tab is doing; only the asking AGAIN waits for the
// tab to be looked at.
async function _poll(first) {
  _timer = null;
  const k = _key;
  if (!k || (!first && document.visibilityState === 'hidden')) return;
  const d = await _read(k);
  if (k !== _key) return;                            // another project opened meanwhile
  const s = _get(k);
  const was = s.job;
  if (d) { s.job = d.job || null; s.last = d.last || s.last; s.read = true; }
  const now = s.job;
  if (now && now.state === 'listening') { _schedule(); _emit(); return; }
  _emit();
  if (now && now.state === 'done' && (!was || was.state === 'listening') && now.result && now.result.rev) {
    await _landed(now.result.rev);
  }
}
function _schedule() {
  if (_timer) clearTimeout(_timer);
  _timer = setTimeout(_poll, POLL_MS);
}

/** Press: save, then ask the server to listen to the open project. */
export async function start() {
  const k = Store.key();
  if (!k || !Store.canEdit()) return;
  const s = _get(k);
  s.refused = '';
  if (!soundPieces(Store.timeline()).length) {
    s.refused = 'There is no sound on the timeline to listen to.';
    _emit();
    return;
  }
  s.job = { state: 'listening', step: 'saving the timeline' };
  _emit();
  if (!(await Store.flush())) {
    s.job = null;
    s.refused = 'Not saved yet - the sound is taken from the saved timeline. Try again in a moment.';
    _emit();
    return;
  }
  let d = null;
  try {
    const r = await fetch('/api/mv3/captions/transcribe', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: k }),
    });
    d = await r.json();
  } catch (e) { d = { success: false, error: 'The app did not answer - ' + e.message }; }
  if (d && (d.success || d.job)) {
    s.job = d.job || null;
  } else {
    s.job = null;
    s.refused = (d && d.error) || 'Refused.';
  }
  _emit();
  if (k === _key && s.job && s.job.state === 'listening') _schedule();
}

// A project opened: what is its job doing? Once, and then every 1.5 s while it listens.
function _opened() {
  const k = Store.key() || null;
  if (k === _key) return;
  _key = k;
  if (_timer) { clearTimeout(_timer); _timer = null; }
  if (k) _poll(true);
}

export function init() {
  Store.onChange(_opened);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !_key) return;
    const s = _get(_key);
    if (!_timer && (!s.read || (s.job && s.job.state === 'listening'))) _poll(true);
  });
}
