/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — captions from the sound, as the page follows them.

   The SERVER listens and lays the lines (lib/captions-job.js); this only presses the button and says
   what is happening, for the project that is open:

     the press     everything unsaved is saved first - the server listens to the SAVED timeline - and
                   POST /api/mv3/captions/transcribe { key }
     the wait      GET /api/mv3/captions/state?key= every 1.5 s while that project's job runs and the
                   tab is looked at. Leaving the project, the page or the app stops only the asking: the
                   job goes on, and opening the project again picks it up by its key
     the end       the store reads the timeline the server laid (Store.refresh), which says "Captions
                   laid from the sound" rather than "another device", and is one Ctrl+Z
     again         "back to what was heard" is the same press with { stored: true }: the server lays
                   again from the answers it keeps, and stops before asking anybody when the sound
                   has changed since

   The state is per PROJECT: "listening..." on one project's lane says nothing on another's.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as Store from './store.js';
import { soundPieces } from '../captions/heard.js';
import { allow } from '../key-gate.js';
import { t, tn, lang } from '../i18n/t.js';

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
  const loc = lang() === 'ru' ? 'ru-RU' : 'en-US';
  return d.toLocaleDateString(loc, { day: 'numeric', month: 'short' }) + ' '
    + d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' });
};
const _cap = (s) => String(s || '').replace(/^./, (m) => m.toUpperCase());
const _mb = (b) => t('{n} MB', { n: Math.round((+b || 0) / 1e6) });
// "12 pages from 40 words": each count said whole in its own words.
const _pagesFrom = (pages, words) => tn(pages, '{n} page {from}', '{n} pages {from}', { from: tn(words, 'from {n} word', 'from {n} words') });

// Why a run went to this computer (lib/captions-job.js FELL - the server sends the code).
const _fell = (code) => ({ 'no-key': t('No Groq key'), network: t('Groq could not be reached'), down: t('Groq is not answering'),
  busy: t('Groq is busy'), limit: t("Groq's limit is used up"), 'bad-key': t('Groq did not accept the key'),
  refused: t('Groq refused this sound'), 'too-large': t('Groq refused this sound') })[code] || '';

// ── This computer's ear ─────────────────────────────────────────────────────
// Read once when a page asks, again after a model download: the program and the model.
let _local = null;
let _localAsked = null;
export function local() { return _local; }
export async function readLocal(force) {
  if (_localAsked && !force) return _localAsked;
  _localAsked = fetch('/api/speech/local').then(r => r.json()).then((d) => { _local = d && d.success ? d.state : null; _emit(); return _local; })
    .catch(() => { _local = null; _localAsked = null; return null; });      // asked again next time
  return _localAsked;
}

// What a talking head's lines need: the ones no caption lies over, and why nobody heard them by
// themselves - or that they are about to be. '' when every line has its captions.
function _linesNote(s) {
  const L = s.lines;
  const j = s.job;
  if (!L || !L.lane || !(L.bare > 0) || (j && j.state === 'listening')) return '';
  if (L.pending) return t('New lines are heard in a moment.');
  if (L.why) {
    return j && j.state === 'failed' && j.auto ? ''
      : tn(L.bare, '{n} line has no captions - {why}', '{n} lines have no captions - {why}', { why: L.why.replace(/^./, (m) => m.toLowerCase()) });
  }
  return tn(L.bare, '{n} line has no captions yet - Generate from the sound lays them.', '{n} lines have no captions yet - Generate from the sound lays them.');
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
    // The step is the server's words (compared here as it sends them); 'starting' until it says one.
    if (j.auto && !j.part && !j.dl && !j.wait && j.where !== 'local') return t('Hearing the new lines - {step}', { step: String(j.step || t('starting')) });
    const step = String(j.step || t('starting'));
    if (step === 'collecting the sound' && j.part) return t('Listening - collecting the sound ({i} of {n})', { i: j.part.i, n: j.part.n });
    if (j.dl) return t('Listening - downloading the speech model {pct}% of {size}', { pct: Math.floor(100 * j.dl.got / Math.max(1, j.dl.total)), size: _mb(j.dl.total) });
    if (j.wait) return t('Listening - {step}', { step: j.wait });
    if (j.where === 'local') {
      const here = (j.part ? t('part {i} of {n}, on this computer', { i: j.part.i, n: j.part.n }) : t('on this computer'))
        + (j.pct != null ? ' ' + j.pct + '%' : '');
      return t('Listening - {step}', { step: j.fell ? _fell(j.fell) + '; ' + here : here });
    }
    if (j.where === 'cloud' && j.part) return t('Listening - part {i} of {n}', { i: j.part.i, n: j.part.n });
    return j.stored ? t('Laying again - {step}', { step }) : t('Listening - {step}', { step });
  }
  if (j && j.state === 'failed') return j.error || t('It did not finish.');
  if (j && j.state === 'done') {
    const r = j.result || {};
    const out = [];
    // Every word heard lies under lines the person corrected or typed: something WAS said, and the lane is left
    // as it is on purpose - so it does not say "Nothing was said", and the kept and stale counts are shown.
    const under = !r.lines && r.dropped && ((+r.dropped.fixed || 0) + (+r.dropped.typed || 0)) > 0;
    // A talking head's new lines, heard by themselves.
    const pages = r.lines ? _pagesFrom(r.lines, r.words) : '';
    out.push(!r.lines ? (under ? t('Every word heard lies under lines you corrected or typed - the lane was left as it was.')
      : t('Nothing was said on those tracks - the lane was left as it was.'))
      : r.auto ? (r.heardLines === 1 ? t('The new line was heard by itself: {pages}.', { pages }) : t('The new lines were heard by themselves: {pages}.', { pages }))
        : r.stored ? t('Laid again from what was heard: {pages}.', { pages }) : pages + '.');
    // A line heard as other words than the script's (a clip that added its own) is laid as heard; a line never heard is
    // not laid again from nothing ("back to what was heard").
    const off = r.offScript || [];
    if (off.length) {
      out.push(tn(off.length, 'A line says other words than the script, laid as heard: {list}.', '{n} lines say other words than the script, laid as heard: {list}.',
        { list: off.slice(0, 3).join(', ') + (off.length > 3 ? '...' : '') }));
    }
    const never = r.unheard || [];
    if (never.length) {
      const list = never.slice(0, 3).join(', ') + (never.length > 3 ? '...' : '');
      out.push(never.length === 1 ? t('Not heard yet: {list} - Generate from the sound hears it.', { list })
        : t('Not heard yet: {list} - Generate from the sound hears them.', { list }));
    }
    if (r.restLost) out.push(t('The other sound on the timeline was not laid again - it has changed since it was heard.'));
    if (r.stored) {
      if (r.lines) out.push(t('Nothing asked, nothing paid.'));
    } else if (r.local) {
      const secs = Math.round(+r.took || 0);
      out.push(!r.fell ? t('Heard on this computer in {secs} s.', { secs })
        : r.fell !== 'no-key' ? t('Heard on this computer in {secs} s - {why}; press again to ask Groq.', { secs, why: _fell(r.fell) })
          : t('Heard on this computer in {secs} s - {why}.', { secs, why: _fell(r.fell) }));
    } else if (r.lines && !r.paid) out.push(t('Nothing paid - heard before.'));
    if (r.timing === 'approximate') out.push(t('Some words are timed approximately.'));
    // The language is the listener's own name for it (the server's words).
    if (r.lines && !r.asked && r.language) out.push(t('Heard as {language}.', { language: _cap(r.language) }));
    const typed = r.dropped && r.dropped.typed;
    if (typed) out.push(tn(typed, '{n} word under your typed lines was left out.', '{n} words under your typed lines were left out.'));
    // The heard lines a person corrected stay as they are - and one that no longer looks like what is
    // heard under it is pointed out, for the person to look at: nothing takes it away by itself.
    if (r.kept) out.push(tn(r.kept, '{n} corrected line kept.', '{n} corrected lines kept.'));
    if (r.stale) {
      out.push(tn(r.stale, '{n} corrected line no longer matches the sound under it - have a look.',
        '{n} corrected lines no longer match the sound under them - have a look.'));
    }
    if (r.missing && r.missing.length) out.push(t('Not found, heard as silence: {list}.', { list: r.missing.slice(0, 4).join(', ') + (r.missing.length > 4 ? '...' : '') }));
    if (r.moved) out.push(t('The sound changed while listening - press again to match it.'));
    if (r.suspect) out.push(t('Groq may have heard only part of it - press again to ask once more.'));
    else if (r.partial) out.push(t('Groq may have heard only part of it - it was asked twice, and this is its answer.'));
    return out.join(' ');
  }
  if (s.last && s.last.at) {
    return t('Last listened {when} - {pages}.', { when: _when(s.last.at), pages: _pagesFrom(+s.last.lines || 0, +s.last.words || 0) });
  }
  return '';
}

/**
 * What the subtitle lane's strip shows for a project. `ask` - the run fell over to this computer and the
 * speech model is not there yet: the strip offers to download it, once.
 */
export function view(key) {
  const k = key || Store.key();
  if (!k) return { busy: false, line: '', ask: false, again: false, heard: false };
  const s = _get(k);
  const busy = !!(s.job && s.job.state === 'listening');
  // Something was heard and laid for this project (its subs/ file says so): it can be laid again.
  const heard = !!(s.last && s.last.at) || !!(s.job && s.job.state === 'done' && s.job.result && s.job.result.lines);
  // The model is offered too where a talking head's lines wait for it: no Groq key, no model.
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
  // Told only when what the strip SAYS changes: the strip is rebuilt whole, and an open
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
  if (!k) return;
  // Nobody to hear the words - no Groq key and no speech model on this computer: the popup says so (js/key-gate.js).
  // Laying again from the answers kept, or downloading the model, needs neither.
  if (!(opts && (opts.stored || opts.download)) && !allow('hearing')) return;
  const s = _get(k);
  s.refused = '';
  if (!soundPieces(Store.timeline()).length) {
    s.refused = t('There is no sound on the timeline to listen to.');
    _emit();
    return;
  }
  s.job = { state: 'listening', step: t('saving the timeline'), stored: !!(opts && opts.stored) };
  _emit();
  if (!(await Store.flush())) {
    s.job = null;
    s.refused = t('Not saved yet - the sound is taken from the saved timeline. Try again in a moment.');
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
  } catch (e) { d = { success: false, error: t('The app did not answer - {why}', { why: e.message }) }; }
  if (d && (d.success || d.job)) {
    s.job = d.job || null;
  } else {
    s.job = null;
    s.refused = (d && d.error) || t('Refused.');
  }
  _emit();
  if (k === _key && s.job && s.job.state === 'listening') _schedule();
}

// A project opened: what is its job doing? Once, and then every 1.5 s while it listens. And again whenever the server
// laid something of its own on it: a talking head's cut laid again is when its new lines start to be heard.
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
