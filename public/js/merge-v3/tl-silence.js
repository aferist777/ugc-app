/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — CUT SILENCE (phase V44, the owner 2026-10-24).

   A button right of ⏩ in the timeline's header (and the key S - "Ы" in the Russian layout, by the key's place): live
   when there is something to cut in (ы1) - a stretch drawn over a wave, or picked clips (the time they take); dim with
   nothing picked. Pressed, a small window opens above it - TWO SLIDERS that work together ((ы12)):

     keep pauses up to  [0.01-1.00 s, 0.30 at first]        a pause longer than this is shortened to it (ы2)
     silent below       [−60 … −20 dB]  [auto]              quieter than this is silence; auto - the stretch's own noise
                                                            floor + 6 dB, never above −36 (V33.5), each clip its own
     14 pauses · −6.2 s                       [cut]

   The sound is heard in MAIN AUDIO only (ы3), ONCE, when the window opens: GET /api/track-pauses (lib/track-pauses.js)
   answers each clip's stretch with its auto threshold and the loudness itself (a byte a 10 ms window), and moving either
   slider only finds the pauses and plans again, here. Above −36 dB is allowed by hand ((ы13): under music the music
   counts as silence then). The length is kept while the page is open; the decibels start at auto every time ((ы14)).
   What will go glows red on the lanes before anything is cut (ы8). "cut" or Enter cuts - every lane at once, one step to
   undo (js/merge-v3/tl-cut.js silenceCut: music under the film stays put, sound effects move with the picture, the seams
   faded); Escape or a press anywhere else closes it and changes nothing. A talking head's lines are cut too ((ы5)): the
   save of the timeline writes their pieces into the lines (lib/line-cuts.js).

   timeline-b.js owns the pick and the lanes and hands this its accessors (wireSilence):
     span()      [[a, b], ...] timeline seconds to listen in, or null - nothing picked
     zoom()      px a second;  gutter - px left of second 0;  host() - the scroll box
     cut(cuts)   makes the cuts: { ok, why }
   ═══════════════════════════════════════════════════════════════════════════ */

import * as Store from './store.js';
import * as Layers from '../layers.js';
import { note } from './ask.js';
import { cutsOfPauses } from './tl-cut.js';

const KEEP_DEFAULT = 0.30;
const KEEP_MIN = 0.01, KEEP_MAX = 1.00;
const DB_MIN = -60, DB_MAX = -20;
// Pauses of two clips that meet are one pause.
const JOIN = 0.011;
// A piece of main audio shorter than this inside the pick is not listened to.
const MIN_PIECE = 0.1;

let _acc = null;
let _btn = null;
let _keep = KEEP_DEFAULT;     // the length slider's place, kept while the page is open
let _win = null;              // the window while it is open

const r2 = (v) => Math.round(v * 100) / 100;

/** Bound once by timeline-b.js (initTimelineB). */
export function wireSilence(acc) {
  _acc = acc;
  _btn = document.getElementById('mv3-silence');
  if (!_btn) return;
  // On mousedown, swallowed: the press must not reach the timeline's "away" handlers first, which let the pick go.
  _btn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
  _btn.addEventListener('click', () => { if (_win) closeSilence(); else openSilence(); });
  refreshSilence();
}

/** The button follows the pick: live with a stretch or clips picked, dim without. */
export function refreshSilence() {
  if (!_btn || !_acc) return;
  const span = _acc.span();
  _btn.classList.toggle('is-dim', !(span && span.length));
}

// The main audio lane's clips that sound, as [{ c, s, e }].
function _mainSounds(tl) {
  const t = ((tl && tl.tracks) || []).find((x) => x && x.kind === 'audio' && x.main);
  if (!t || (t.volume != null && !(+t.volume > 0))) return [];
  return (t.clips || []).filter((c) => c && c.src && !c.reversed && (c.volume == null || +c.volume > 0))
    .map((c) => ({ c, s: +c.start || 0, e: (+c.start || 0) + (+c.dur || 0) }));
}

// What the pauses were heard from - when it changes under the window, they are stale.
const _print = (tl) => _mainSounds(tl).map(({ c }) => [c.id, c.src, c.start, c.dur, c.trimIn, c.speed].join('|')).join(';');

const _dbText = (v) => (v < 0 ? '−' : '') + Math.abs(Math.round(v)) + ' dB';

/** Open the window over the button (the button's press, the key S). */
export function openSilence() {
  if (!_acc || !_btn) return;
  if (_win) return;
  const span = _acc.span();
  if (!span || !span.length) {
    note(_btn, 'Pick what to cut silence in', 'Draw a stretch over a wave, or pick clips - the pauses of main audio inside it are shortened.');
    return;
  }
  const box = document.createElement('div');
  box.className = 'mv3-silence';
  box.innerHTML =
    '<div class="mv3-silence-h"><b>Cut silence</b><button type="button" class="mv3-silence-x" title="Close (Esc)">✕</button></div>' +
    '<label class="mv3-silence-row" title="A pause longer than this is shortened to it - half after the sound before, half before the sound after">' +
    '<span>keep pauses up to</span>' +
    `<input type="range" min="${KEEP_MIN}" max="${KEEP_MAX}" step="0.01" class="mv3-silence-k">` +
    '<span class="mv3-silence-v"></span></label>' +
    '<label class="mv3-silence-row" title="Quieter than this is silence. auto - this sound\'s own noise floor + 6 dB, never above −36 dB">' +
    '<span>silent below</span>' +
    `<input type="range" min="${DB_MIN}" max="${DB_MAX}" step="1" class="mv3-silence-d" disabled>` +
    '<span class="mv3-silence-v is-db"></span>' +
    '<button type="button" class="mv3-silence-auto is-on" title="Back to this sound\'s own threshold" disabled>auto</button></label>' +
    '<div class="mv3-silence-row is-foot"><span class="mv3-silence-n">listening to main audio…</span>' +
    '<button type="button" class="mv3-silence-cut" title="Cut them out of every lane (Enter)" disabled>cut</button></div>';
  const k = box.querySelector('.mv3-silence-k');
  const d = box.querySelector('.mv3-silence-d');
  k.value = String(_keep);
  box.querySelector('.mv3-silence-v').textContent = _keep.toFixed(2) + ' s';
  document.body.appendChild(box);
  const away = (e) => { if (!box.contains(e.target) && !_btn.contains(e.target)) closeSilence(); };
  const keys = (e) => {
    if (!_win || !Layers.topIs(_win.layer)) return;
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); _cut(); }
  };
  _win = { box, k, d, away, keys, key: Store.key(), print: _print(Store.timeline()), span, asks: null, pauses: null, walls: [],
    db: null, cuts: [], why: '', none: '', seq: 0, layer: Layers.open(box, { name: 'cut silence', onEsc: closeSilence }) };
  _place();
  k.addEventListener('input', () => {
    if (!_win) return;
    _win.why = '';
    _keep = Math.max(KEEP_MIN, Math.min(KEEP_MAX, r2(+k.value || KEEP_DEFAULT)));
    box.querySelector('.mv3-silence-v').textContent = _keep.toFixed(2) + ' s';
    _plan();
  });
  d.addEventListener('input', () => {
    if (!_win) return;
    _win.why = '';
    _win.db = Math.max(DB_MIN, Math.min(DB_MAX, Math.round(+d.value)));
    _find();
  });
  box.querySelector('.mv3-silence-auto').addEventListener('click', () => {
    if (!_win || _win.db == null) return;
    _win.why = '';
    _win.db = null;
    _find();
  });
  box.querySelector('.mv3-silence-x').addEventListener('click', closeSilence);
  box.querySelector('.mv3-silence-cut').addEventListener('click', _cut);
  document.addEventListener('mousedown', away, true);
  document.addEventListener('keydown', keys, true);
  window.addEventListener('resize', _place);
  _btn.classList.add('is-open');
  try { k.focus({ preventScroll: true }); } catch { /* the slider takes the arrows */ }
  _listen();
}

export function closeSilence() {
  if (!_win) return;
  const w = _win;
  _win = null;
  w.box.remove();
  document.removeEventListener('mousedown', w.away, true);
  document.removeEventListener('keydown', w.keys, true);
  window.removeEventListener('resize', _place);
  Layers.close(w.layer);
  if (_btn) _btn.classList.remove('is-open');
  _paintGlow();
}

// Above the button, kept inside the window.
function _place() {
  if (!_win || !_btn) return;
  const r = _btn.getBoundingClientRect();
  const b = _win.box;
  const w = b.offsetWidth, h = b.offsetHeight;
  b.style.left = Math.round(Math.max(6, Math.min(window.innerWidth - w - 6, r.left + r.width / 2 - w / 2))) + 'px';
  const above = r.top - h - 6;
  b.style.top = Math.round(above >= 6 ? above : r.bottom + 6) + 'px';
}

function _say(text, bad) {
  if (!_win) return;
  const n = _win.box.querySelector('.mv3-silence-n');
  n.textContent = text;
  n.classList.toggle('is-bad', !!bad);
}

// The loudness a stretch was answered with, ready to look through: { t0, step, edge, minPause, db: Float32Array } or null.
function _loudOf(j) {
  const L = j && j.loud;
  if (!L || !L.db) return null;
  const s = atob(L.db);
  const db = new Float32Array(s.length);
  for (let i = 0; i < s.length; i++) db[i] = s.charCodeAt(i) / 2 - 100;
  return { t0: +L.t0 || 0, step: +L.step || 0.01, edge: +L.edge || 0.005, minPause: +L.minPause || 0.1, db };
}

// Hear main audio inside the pick - each of its clips over the file's own stretch - once.
async function _listen() {
  const w = _win;
  const seq = ++w.seq;
  const asks = [];
  const walls = [];
  for (const { c, s, e } of _mainSounds(Store.timeline())) {
    walls.push(s, e);
    const sp = Math.max(0.25, Math.min(4, +c.speed || 1));
    const tin = +c.trimIn || 0;
    for (const [a, b] of w.span) {
      const x0 = Math.max(s, a), x1 = Math.min(e, b);
      if (x1 - x0 < MIN_PIECE) continue;
      asks.push({ c, s, e, sp, tin, x0, x1, from: tin + (x0 - s) * sp, to: tin + (x1 - s) * sp });
    }
  }
  w.walls = walls;
  if (!asks.length) { w.asks = []; w.none = 'main audio has no sound here - nothing to listen to'; _find(); return; }
  try {
    const got = await Promise.all(asks.map((q) => fetch('/api/track-pauses?src=' + encodeURIComponent(q.c.src)
      + '&from=' + q.from.toFixed(3) + '&to=' + q.to.toFixed(3)).then((r) => r.json()).then((j) => ({ q, j }))));
    if (_win !== w || w.seq !== seq) return;
    for (const { j } of got) if (!j || !j.success) throw new Error((j && j.error) || 'the sound could not be read');
    w.asks = got.map(({ q, j }) => ({ ...q, thr: +j.thr, loud: _loudOf(j), pauses: j.pauses || [] }));
    _find();
  } catch (e) {
    if (_win !== w) return;
    w.asks = [];
    w.none = 'Not heard: ' + e.message;
    _find();
  }
}

// The pauses for the threshold now - each clip's own (auto) or the one set by hand - on the timeline, then the plan.
function _find() {
  const w = _win;
  if (!w || !w.asks) return;
  const auto = w.db == null;
  // The slider shows the threshold in use: by hand its own, auto that of the longest piece listened to.
  const longest = w.asks.slice().sort((a, b) => (b.x1 - b.x0) - (a.x1 - a.x0))[0];
  const shown = auto ? (longest && Number.isFinite(longest.thr) ? longest.thr : null) : w.db;
  const d = w.d, btn = w.box.querySelector('.mv3-silence-auto');
  d.disabled = !w.asks.length;
  btn.disabled = auto;
  btn.classList.toggle('is-on', auto);
  if (shown != null) d.value = String(Math.max(DB_MIN, Math.min(DB_MAX, Math.round(shown))));
  w.box.querySelector('.mv3-silence-v.is-db').textContent = shown == null ? '—' : _dbText(shown);
  const all = [];
  for (const q of w.asks) {
    const thr = auto ? q.thr : w.db;
    const L = q.loud;
    const filePauses = [];
    if (L && Number.isFinite(thr)) {
      // Runs of windows below the threshold, as lib/track-pauses.js finds them: from MIN_PAUSE, widened by its edge.
      const n = L.db.length;
      for (let i = 0; i < n;) {
        if (!(L.db[i] < thr)) { i++; continue; }
        let j = i;
        while (j + 1 < n && L.db[j + 1] < thr) j++;
        const a = Math.max(q.from, L.t0 + i * L.step - L.edge), b = Math.min(q.to, L.t0 + j * L.step + L.edge);
        if (b - a >= L.minPause - 1e-9) filePauses.push([a, b]);
        i = j + 1;
      }
    } else if (auto) filePauses.push(...q.pauses);
    for (const [fa, fb] of filePauses) {
      // File seconds -> the timeline's, kept inside this piece of the pick.
      const a = Math.max(q.x0, q.s + (fa - q.tin) / q.sp), b = Math.min(q.x1, q.s + (fb - q.tin) / q.sp);
      if (b > a) all.push([a, b]);
    }
  }
  all.sort((x, y) => x[0] - y[0]);
  const joined = [];
  for (const p of all) {
    const last = joined[joined.length - 1];
    if (last && p[0] <= last[1] + JOIN) last[1] = Math.max(last[1], p[1]); else joined.push(p.slice());
  }
  w.pauses = joined;
  _plan();
}

// The cuts for the length now: the count, the seconds, the glow.
function _plan() {
  const w = _win;
  if (!w || !w.pauses) return;
  w.cuts = cutsOfPauses(w.pauses, _keep, w.walls);
  const sec = w.cuts.reduce((s, c) => s + (c.b - c.a), 0);
  const btn = w.box.querySelector('.mv3-silence-cut');
  btn.disabled = !w.cuts.length;
  if (w.why || w.none) _say(w.why || w.none, true);
  else if (!w.cuts.length) _say('no pause here is longer than ' + _keep.toFixed(2) + ' s');
  else _say(w.cuts.length + (w.cuts.length === 1 ? ' pause' : ' pauses') + ' · −' + sec.toFixed(1) + ' s');
  _paintGlow();
}

function _cut() {
  const w = _win;
  if (!w || !w.cuts.length) return;
  const r = _acc.cut(w.cuts) || {};
  if (!r.ok) {
    w.why = r.why || 'Not cut';
    _say(w.why, true);
    return;
  }
  closeSilence();
}

/**
 * The glow of what will go, over every lane - and a copy in the words block while it sticks to the floor (as the stretch
 * drawn over a wave is laid, timeline-b.js _paintRange). Called by timeline-b.js after every build of the lanes: a window
 * whose project or main audio changed under it closes - its pauses belong to what was there.
 */
export function paintSilence() {
  if (_win && (Store.key() !== _win.key || _print(Store.timeline()) !== _win.print)) { closeSilence(); return; }
  _paintGlow();
}

function _paintGlow() {
  const host = _acc && _acc.host();
  const inner = host && host.querySelector('.mv3b-inner');
  if (!inner) return;
  inner.querySelectorAll('.mv3b-quiet').forEach((el) => el.remove());
  if (!_win || !_win.cuts.length) return;
  const z = _acc.zoom();
  const words = inner.querySelector(':scope > .mv3b-zone.is-subs.has-words');
  for (const p of [inner, words]) {
    if (!p) continue;
    const frag = document.createDocumentFragment();
    for (const c of _win.cuts) {
      const el = document.createElement('div');
      el.className = 'mv3b-quiet';
      el.style.left = (_acc.gutter + c.a * z) + 'px';
      el.style.width = Math.max(1, (c.b - c.a) * z) + 'px';
      frag.appendChild(el);
    }
    p.appendChild(frag);
  }
}

/** Is the window open (tests). */
export const isOpen = () => !!_win;
