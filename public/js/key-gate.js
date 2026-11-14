/* ═══════════════════════════════════════════════════════════════════════════
   A PLACE THAT NEEDS A KEY THE LIBRARY DOES NOT HAVE - ONE module for every page.

   The server says which places are open (GET /api/keys/gates, lib/key-gates.js): a generator's window, a talking
   head's setup, REFERENCES... A closed place is closed BEFORE anything is chosen or written: its window does not
   open, its area is blurred under a lock, and a press says what is missing - ONE popup for every place, with the way
   to Admin -> API keys and back.

     allow(place, anchor?, o?) -> true when the place is open; else the popup, and false. Read before the state is
                                  known it says true - the routes refuse in words all the same.
     lock(el, place, o?)       -> keeps `el` blurred under a lock while the place is closed; a press on the lock - the
                                  popup. o.small - a row's lock (no words); o.line - its words on one line (a
                                  row); o.bare - the blur alone (another lock
                                  beside it says the words); o.keep - kept while the element is off the page;
                                  o.back - the address "← Back" leads to.
     isOpen(place)             -> whether it is open now (true while unknown)
     ready()                   -> Promise of the state
     onChange(fn)              -> fn() after every read that changed something

   The state is read when the page loads and again when the window comes back to the front - a key saved on Admin
   counts as soon as the page is looked at again.
   `o.back` - where "← Back" on Admin leads (default: this page as it is); `o.open` - the window to open there again
   (`open=` of Merge and the Library).
   ═══════════════════════════════════════════════════════════════════════════ */

import { askChoice } from './ask.js';
import { iconEl } from './icons.js';

let _state = null;          // { all, places: { id: { open, label, why, missing: [[{ id, label, why }]] } } }
let _reading = null;
const _subs = new Set();
const _locks = new Set();   // { el, place, cover, small }

function _read() {
  if (_reading) return _reading;
  _reading = fetch('/api/keys/gates')
    .then(r => r.json())
    .then((d) => {
      if (!d || !d.places) return _state;
      const before = JSON.stringify(_state && _state.places);
      _state = d;
      if (JSON.stringify(d.places) !== before) {
        _paintLocks();
        for (const fn of _subs) { try { fn(); } catch (e) { console.warn('[key-gate]', e); } }
      }
      return _state;
    })
    .catch(() => _state)
    .finally(() => { _reading = null; });
  return _reading;
}

export const ready = () => (_state ? Promise.resolve(_state) : _read());
export const refresh = () => _read();
export function onChange(fn) { _subs.add(fn); return () => _subs.delete(fn); }

export function isOpen(place) {
  const p = _state && _state.places && _state.places[place];
  return !p || !!p.open;
}

// ── The words ────────────────────────────────────────────────────────────────
const _or = (labels) => labels.length < 2 ? labels[0] : labels.slice(0, -1).join(', ') + ' or ' + labels[labels.length - 1];
const _and = (parts) => parts.length < 2 ? parts[0] : parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];

// The keys' fields on Admin -> API keys, to light the ones that are missing.
const FIELDS = { kie: 'kieApiKey', replicate: 'replicateApiKey', elevenlabs: 'elevenLabsApiKey', groq: 'groqApiKey',
  pixabay: 'pixabayApiKey', cloudflare: 'cloudflareApiToken', telegram: 'telegramBotToken', freesound: 'freesoundApiKey' };
const LADDER_KEYS = ['kieApiKey', 'replicateApiKey', 'anthropicApiKey', 'openRouterApiKey'];

function _words(p) {
  const groups = p.missing || [];
  const title = p.label + ' needs ' + _and(groups.map(g => _or(g.map(a => a.label))));
  const lines = [];
  if (p.why) lines.push(p.why.charAt(0).toUpperCase() + p.why.slice(1) + '.');
  const atoms = groups.flat();
  for (const a of atoms) {
    if (/^refused/.test(a.why)) lines.push(a.label + ' refused its key' + (a.why.length > 8 ? ' (' + a.why.slice(9) + ')' : '') + '.');
    if (a.id === 'cloudflare' && a.why === 'not checked') lines.push('The Cloudflare key is there but has not passed its check yet - press its check on API keys.');
    if (a.id === 'ladder' && a.why === 'not in the ladder') lines.push('A key is there, but the ladder on AI settings has no step with it - add one there.');
    if (a.id === 'whisper') lines.push(a.why === 'not installed'
      ? 'Hearing on this computer is not installed with this copy of the app.'
      : 'Or hear the words on this computer, for free: download the speech model (574 MB) on Admin → This computer.');
  }
  return { title, lines, atoms };
}

function _href(tab, need, o) {
  let back = (o && o.back) || (location.pathname + location.search);
  if (o && o.open && /^\/(merge|library)(\/|$)/.test(location.pathname)) {
    try {
      const u = new URL(back, location.origin);
      u.searchParams.set('open', o.open);
      back = u.pathname + u.search;
    } catch (e) { /* the page as it is */ }
  }
  const q = new URLSearchParams();
  q.set('back', back);
  if (need.length) q.set('need', need.join(','));
  return '/admin?' + q.toString() + '#' + tab;
}

/** The one popup: what the place lacks, why, and the way to where it is set. */
export function explain(place, anchor, o) {
  const p = _state && _state.places && _state.places[place];
  if (!p || p.open) return;
  const { title, lines, atoms } = _words(p);
  const keys = [...new Set(atoms.map(a => FIELDS[a.id]).filter(Boolean))];
  const ladder = atoms.find(a => a.id === 'ladder');
  if (ladder && ladder.why === 'no key') keys.push(...LADDER_KEYS);
  const choices = [{ label: 'Cancel' }];
  if (atoms.some(a => a.id === 'whisper' && a.why === 'not downloaded')) {
    choices.push({ label: 'This computer', on: () => { location.href = _href('local', [], o); } });
  }
  if (ladder && ladder.why === 'not in the ladder') {
    choices.push({ label: 'AI settings', on: () => { location.href = _href('ai', [], o); } });
  }
  if (keys.length) choices.push({ label: 'Open API keys', kind: 'yes', on: () => { location.href = _href('keys', keys, o); } });
  askChoice(anchor || null, title, lines.length > 1 ? lines : (lines[0] || ''), choices, { stay: true });
  _toCorner();
}

// The popup in the top right corner, where the app's notices come (js/notice.js): the same place whatever was pressed -
// a button at the window's foot or a page with no button at all - below the page's own top bars.
const BARS = ['.sv3-nav', '.mv3-bar', '.lib-bar', '.hm-sub', '.s3-bar'];
function _toCorner() {
  const all = document.querySelectorAll('.u-ask.is-float');
  const el = all[all.length - 1];
  if (!el) return;
  let top = 0;
  for (const sel of BARS) {
    const b = document.querySelector(sel);
    if (!b) continue;
    const r = b.getBoundingClientRect();
    if (r.height > 0 && r.top < 160) top = Math.max(top, r.bottom);
  }
  el.classList.add('kg-ask');
  el.style.left = 'auto';
  el.style.right = '12px';
  el.style.top = Math.round((top || 40) + 6) + 'px';
}

/** Whether the place can be used now; when it cannot - the popup, and false. */
export function allow(place, anchor, o) {
  if (isOpen(place)) return true;
  explain(place, anchor, o);
  return false;
}

// ── A lock over an area ──────────────────────────────────────────────────────
function _paintLock(L) {
  const closed = !isOpen(L.place);
  L.el.classList.toggle('kg-locked', closed);
  L.el.classList.toggle('kg-small', closed && !!L.small);
  L.el.classList.toggle('kg-line', closed && !!L.line);
  // The cover lies over the element: one placed by the flow gets a place of its own while locked; one placed already
  // (absolute, fixed) keeps its own.
  if (closed && !L.moved && getComputedStyle(L.el).position === 'static') { L.el.style.position = 'relative'; L.moved = true; }
  if (!closed && L.moved) { L.el.style.position = ''; L.moved = false; }
  if (closed && !L.cover.isConnected) L.el.appendChild(L.cover);
  if (!closed && L.cover.isConnected) L.cover.remove();
  if (closed) {
    const p = _state.places[L.place];
    L.text.textContent = _words(p).title;
    L.cover.title = L.small ? _words(p).title : '';
  }
}
function _paintLocks() {
  for (const L of [..._locks]) {
    if (!L.el.isConnected && !L.keep) { _locks.delete(L); continue; }
    _paintLock(L);
  }
}

/** `el` blurred under a lock while `place` is closed. -> a function that takes the lock away for good. */
export function lock(el, place, o) {
  if (!el) return () => {};
  for (const L of _locks) if (L.el === el) { L.place = place; _paintLock(L); return () => _drop(L); }
  const cover = document.createElement('div');
  cover.className = 'kg-cover';
  const box = document.createElement('div');
  box.className = 'kg-box';
  box.appendChild(iconEl('lock', o && o.small ? 14 : 22));
  const text = document.createElement('span');
  text.className = 'kg-text';
  box.appendChild(text);
  if (!(o && o.small)) {
    const go = document.createElement('span');
    go.className = 'kg-go';
    go.textContent = 'Add the key';
    box.appendChild(go);
  }
  // `bare` - the blur alone, no words: an area beside another lock that says them.
  if (!(o && o.bare)) cover.appendChild(box);
  // The press is the cover's alone: nothing under it is reached, not even by a drag starting on it.
  const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
  cover.addEventListener('mousedown', stop);
  cover.addEventListener('dblclick', stop);
  const L = { el, place, cover, text, small: !!(o && o.small), line: !!(o && o.line), keep: !!(o && o.keep), moved: false };
  cover.addEventListener('click', (e) => { stop(e); explain(L.place, box, o); });
  _locks.add(L);
  if (_state) _paintLock(L);
  return () => _drop(L);
}
function _drop(L) {
  _locks.delete(L);
  L.el.classList.remove('kg-locked', 'kg-small', 'kg-line');
  if (L.moved) { L.el.style.position = ''; L.moved = false; }
  L.cover.remove();
}

// ── Its look - one rule, in the page, so every page has it without a sheet of its own ──
(function css() {
  if (document.getElementById('kg-css')) return;
  const s = document.createElement('style');
  s.id = 'kg-css';
  s.textContent = [
    '.kg-locked>:not(.kg-cover){filter:var(--ov-blur, blur(3px));pointer-events:none;user-select:none}',
    '.kg-cover{position:absolute;inset:0;z-index:30;display:flex;align-items:center;justify-content:center;cursor:pointer;',
    '  background:color-mix(in oklch, var(--bg) 35%, transparent)}',
    '.kg-box{display:flex;flex-direction:column;align-items:center;gap:6px;max-width:min(420px,90%);padding:14px 18px;',
    '  border:1px solid var(--border);border-radius:var(--r);background:var(--surface-2);color:var(--ink);',
    '  text-align:center;font-size:13px;line-height:1.35}',
    '.kg-cover:hover .kg-box{border-color:var(--gold)}',
    '.kg-go{color:var(--gold);font-size:12px}',
    '.kg-small>.kg-cover{background:none;justify-content:flex-end;padding-right:6px}',
    '.kg-small .kg-box{flex-direction:row;padding:0;border:0;background:none;gap:0}',
    '.kg-small .kg-text{display:none}',
    '.kg-line .kg-box{flex-direction:row;padding:4px 10px;gap:8px;max-width:95%}',
    '.kg-line .kg-go{display:none}',
    '.is-keyshut{opacity:.5}',
    '.u-ask.kg-ask{width:320px;border-color:var(--gold)}',
  ].join('\n');
  document.head.appendChild(s);
})();

_read();
window.addEventListener('focus', () => { _read(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) _read(); });
