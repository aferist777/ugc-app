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
     again         "back to what was heard" (K2) is the same press with { stored: true }: the server lays
                   again from the answers it keeps, and stops before asking anybody when the sound
                   has changed since

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
const _mb = (b) => Math.round((+b || 0) / 1e6) + ' MB';

// Why a run went to this computer (lib/captions-job.js FELL - the server sends the code).
const FELL = { 'no-key': 'No Groq key', network: 'Groq could not be reached', down: 'Groq is not answering',
  busy: 'Groq is busy', limit: "Groq's limit is used up", 'bad-key': 'Groq did not accept the key',
  refused: 'Groq refused this sound', 'too-large': 'Groq refused this sound' };

// ── This computer's ear (phase K1b) ─────────────────────────────────────────
// Read once when a page asks, again after a model download: the program, the model, the NVIDIA build.
let _local = null;
let _localAsked = null;
export function local() { return _local; }
export async function readLocal(force) {
  if (_localAsked && !force) return _localAsked;
  _localAsked = fetch('/api/speech/local').then(r => r.json()).then((d) => { _local = d && d.success ? d.state : null; _emit(); return _local; })
    .catch(() => { _local = null; _localAsked = null; return null; });      // asked again next time
  return _localAsked;
}

// (phase V30, block 1) What a talking head's lines need: the ones no caption lies over, and why nobody heard them by
// themselves - or that they are about to be. '' when every line has its captions.
function _linesNote(s) {
  const L = s.lines;
  const j = s.job;
  if (!L || !L.lane || !(L.bare > 0) || (j && j.state === 'listening')) return '';
  if (L.pending) return 'New lines are heard in a moment.';
  const n = L.bare === 1 ? '1 line has' : L.bare + ' lines have';
  if (L.why) return j && j.state === 'failed' && j.auto ? '' : n + ' no captions - ' + L.why.replace(/^./, (m) => m.toLowerCase());
  return n + ' no captions yet - Generate from the sound lays them.';
}

// What the line under the button says.
function _line(s) {
  const note = _linesNote(s);
  const said = _said(s);
  return [said, note].filter(Boolean).join(' ');
}
function _said(s) {
  if (s.refused) return s.refused;
  const j = s.job;
  if (j && j.state === 'listening') {
    if (j.auto && !j.part && !j.dl && !j.wait && j.where !== 'local') return 'Hearing the new lines - ' + String(j.step || 'starting');
    const step = String(j.step || 'starting');
    if (step === 'collecting the sound' && j.part) return 'Listening - collecting the sound (' + j.part.i + ' of ' + j.part.n + ')';
    if (j.dl) return 'Listening - downloading the speech model ' + Math.floor(100 * j.dl.got / Math.max(1, j.dl.total)) + '% of ' + _mb(j.dl.total);
    if (j.wait) return 'Listening - ' + j.wait;
    const part = j.part ? 'part ' + j.part.i + ' of ' + j.part.n + ', ' : '';
    if (j.where === 'local') {
      return 'Listening - ' + (j.fell ? FELL[j.fell] + '; ' : '') + part + 'on this computer' + (j.pct != null ? ' ' + j.pct + '%' : '');
    }
    if (j.where === 'cloud' && j.part) return 'Listening - part ' + j.part.i + ' of ' + j.part.n;
    return (j.stored ? 'Laying again - ' : 'Listening - ') + step;
  }
  if (j && j.state === 'failed') return j.error || 'It did not finish.';
  if (j && j.state === 'done') {
    const r = j.result || {};
    const out = [];
    // Every word heard lies under lines the person corrected or typed: something WAS said, and the lane is left
    // as it is on purpose (review K10 - it said "Nothing was said" and hid the kept and stale counts).
    const under = !r.lines && r.dropped && ((+r.dropped.fixed || 0) + (+r.dropped.typed || 0)) > 0;
    // A talking head's new lines, heard by themselves (phase V30, block 1).
    const lead = r.auto ? 'The new ' + (r.heardLines === 1 ? 'line was' : 'lines were') + ' heard by ' + (r.heardLines === 1 ? 'itself' : 'themselves') + ': '
      : r.stored ? 'Laid again from what was heard: ' : '';
    out.push(r.lines ? lead + _n(r.lines, 'page', 'pages') + ' from ' + _n(r.words, 'word', 'words') + '.'
      : under ? 'Every word heard lies under lines you corrected or typed - the lane was left as it was.'
        : 'Nothing was said on those tracks - the lane was left as it was.');
    // A line heard as other words than the script's (a clip that added its own) is laid as heard; a line never heard is
    // not laid again from nothing (the owner's (с20), "back to what was heard").
    const off = r.offScript || [];
    if (off.length) out.push((off.length === 1 ? 'A line says' : off.length + ' lines say') + ' other words than the script, laid as heard: '
      + off.slice(0, 3).join(', ') + (off.length > 3 ? '...' : '') + '.');
    const never = r.unheard || [];
    if (never.length) out.push('Not heard yet: ' + never.slice(0, 3).join(', ') + (never.length > 3 ? '...' : '') + ' - Generate from the sound hears '
      + (never.length === 1 ? 'it.' : 'them.'));
    if (r.restLost) out.push('The other sound on the timeline was not laid again - it has changed since it was heard.');
    if (r.stored) {
      if (r.lines) out.push('Nothing asked, nothing paid.');
    } else if (r.local) {
      out.push('Heard on this computer in ' + Math.round(+r.took || 0) + ' s' + (r.fell ? ' - ' + FELL[r.fell]
        + (r.fell !== 'no-key' ? '; press again to ask Groq.' : '.') : '.'));
    } else if (r.lines && !r.paid) out.push('Nothing paid - heard before.');
    if (r.timing === 'approximate') out.push('Some words are timed approximately.');
    if (r.lines && !r.asked && r.language) out.push('Heard as ' + _cap(r.language) + '.');
    const typed = r.dropped && r.dropped.typed;
    if (typed) out.push(_n(typed, 'word', 'words') + ' under your typed lines ' + (typed === 1 ? 'was' : 'were') + ' left out.');
    // The heard lines a person corrected stay as they are (K10) - and one that no longer looks like what is
    // heard under it is pointed out, for the person to look at: nothing takes it away by itself.
    if (r.kept) out.push(_n(r.kept, 'corrected line', 'corrected lines') + ' kept.');
    if (r.stale) out.push(_n(r.stale, 'corrected line', 'corrected lines') + ' no longer ' + (r.stale === 1 ? 'matches' : 'match')
      + ' the sound under ' + (r.stale === 1 ? 'it' : 'them') + ' - have a look.');
    if (r.missing && r.missing.length) out.push('Not found, heard as silence: ' + r.missing.slice(0, 4).join(', ') + (r.missing.length > 4 ? '...' : '') + '.');
    if (r.moved) out.push('The sound changed while listening - press again to match it.');
    if (r.suspect) out.push('Groq may have heard only part of it - press again to ask once more.');
    else if (r.partial) out.push('Groq may have heard only part of it - it was asked twice, and this is its answer.');
    return out.join(' ');
  }
  if (s.last && s.last.at) {
    return 'Last listened ' + _when(s.last.at) + ' - ' + _n(+s.last.lines || 0, 'page', 'pages') + ' from '
      + _n(+s.last.words || 0, 'word', 'words') + '.';
  }
  return '';
}

/**
 * What the subtitle lane's strip shows for a project. `ask` - the run fell over to this computer and the
 * speech model is not there yet: the strip offers to download it, once (the owner, K1b answer 4).
 */
export function view(key) {
  const k = key || Store.key();
  if (!k) return { busy: false, line: '', ask: false, again: false, heard: false };
  const s = _get(k);
  const busy = !!(s.job && s.job.state === 'listening');
  // Something was heard and laid for this project (its subs/ file says so): it can be laid again (K2).
  const heard = !!(s.last && s.last.at) || !!(s.job && s.job.state === 'done' && s.job.result && s.job.result.lines);
  // The model is offered too where a talking head's lines wait for it (phase V30): no Groq key, no model.
  const wantsModel = !!(s.lines && s.lines.bare > 0 && s.lines.missing === 'need-model');
  return { busy, line: _line(s), ask: !busy && (!!(s.job && s.job.state === 'failed' && s.job.code === 'need-model') || wantsModel),
    again: busy && !!s.job.stored, heard };
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
  // Told only when what the strip SAYS changes (review K1): the strip is rebuilt whole, and an open
  // colour or a menu in it would be torn down every second and a half for the same words.
  const before = JSON.stringify(view(k));
  if (d) { s.job = d.job || null; s.last = d.last || s.last; s.lines = d.lines || null; s.read = true; }
  const now = s.job;
  const changed = JSON.stringify(view(k)) !== before;
  // Asked again while it listens - and while a talking head's new lines are about to be heard by themselves.
  if ((now && now.state === 'listening') || (s.lines && s.lines.pending)) { _schedule(); if (changed) _emit(); return; }
  if (changed) _emit();
  if (now && now.state === 'done' && (!was || was.state === 'listening') && now.result && now.result.rev) {
    await _landed(now.result.rev);
  }
  // A model downloaded on the way: the lane's choices read it again.
  if (now && now.state !== 'listening' && was && was.state === 'listening' && now.result && now.result.local) readLocal(true);
}
function _schedule() {
  if (_timer) clearTimeout(_timer);
  _timer = setTimeout(_poll, POLL_MS);
}

/** Press: save, then ask the server to listen to the open project. `opts.download` - yes to the model. */
export async function start(opts) {
  const k = Store.key();
  if (!k || !Store.canEdit()) return;
  const s = _get(k);
  s.refused = '';
  if (!soundPieces(Store.timeline()).length) {
    s.refused = 'There is no sound on the timeline to listen to.';
    _emit();
    return;
  }
  s.job = { state: 'listening', step: 'saving the timeline', stored: !!(opts && opts.stored) };
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
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: k, download: !!(opts && opts.download), stored: !!(opts && opts.stored) }),
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

// A project opened: what is its job doing? Once, and then every 1.5 s while it listens. And again whenever the server
// laid something of its own on it (phase V30): a talking head's cut laid again is when its new lines start to be heard.
let _seen = 0;
function _opened() {
  const k = Store.key() || null;
  const v = Store.version();
  if (k === _key) {
    if (k && v > _seen && Store.statusIsInfo() && !_timer) { _seen = v; _poll(true); }
    return;
  }
  _key = k;
  _seen = v;
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
