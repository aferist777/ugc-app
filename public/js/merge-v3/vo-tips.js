/* ════════════════════════════════════════════════════════════════════════════
   MERGE — A VOICEOVER'S TIPS, step by step.

   One tip at a time, over the page (js/bubble.js tipBox - the bubble with a red ✕ and "don't show again"), pointing at its thing:
     1 the script     - over the script column, while the voiceover has no script;
     2 mood & voice   - over field 1, while a line is still to read;
     3 B-roll         - UNDER "find B-roll" (field 2), once every line is read and the B-roll is not laid yet;
     4 your clip      - over the timeline, once the B-roll is laid on it - once for each project.
   A press anywhere but on the tip closes it - the person began to choose, or went on with something else; so does its ✕. Closed,
   it stays closed until its step is opened again: another project and back, or the app started again.
   "don't show again", ticked on any tip: THIS cycle still goes to its end - the steps after it, in this project, each once - and
   then no voiceover shows a tip any more. Kept in the window's memory, which the library mirrors (js/storage-sync.js).
   Hidden under a window (js/layers.js - a modal one open), and while its thing is not on the screen.
   ════════════════════════════════════════════════════════════════════════════ */

import * as Store from './store.js';
import * as WK from './workshop.js';
import * as Layers from '../layers.js';
import { isRead, isLive } from './scen-api.js';
import { tipBox, placeBubble } from '../bubble.js';
// The app's words as T.t: this module's own `t`s are tracks and a tip.
import * as T from '../i18n/t.js';

const LS = 'mv3_vo_tips_v1';
const TICK_MS = 250;

const TIPS = {
  1: { title: T.t('Step 1 · the script'), side: 'above',
    text: T.t('Choose a scenario here - "use" on it - or press "+ your text" to paste your own.') },
  2: { title: T.t('Step 2 · mood & voice'), side: 'above',
    text: T.t('Choose the mood and the voice, then press "generate" - every line is read in it.') },
  3: { title: T.t('Step 3 · B-roll'), side: 'below',
    text: T.t('Press "find B-roll": videos and pictures from the stock are found for every sentence and laid over the voice on the timeline.') },
  4: { title: T.t('Step 4 · your clip'), side: 'above',
    text: T.t('The B-roll is laid - play the timeline to watch the clip.') + '\n'
      + T.t('Press a piece on main video to swap it: the "b-roll" crumb shows what else was found. Or bring B-roll from the Library, or generate your own, and lay it on the timeline.') },
};

// ── What is remembered ──────────────────────────────────────────────────────
// { off, tour, left: [steps], seen4: [project ids] } - off: "don't show again" was ticked, in the project `tour`, whose steps
// `left` are still shown, each once; seen4: the projects whose step 4 has been shown.
function _mem() {
  try { const m = JSON.parse(localStorage.getItem(LS) || '{}'); return m && typeof m === 'object' ? m : {}; } catch (e) { return {}; }
}
function _save(m) {
  try { localStorage.setItem(LS, JSON.stringify(m)); } catch (e) { /* a private window: shown again next time */ }
}
function _allowed(k, pid) {
  const m = _mem();
  if (k === 4 && (m.seen4 || []).includes(pid)) return false;
  if (!m.off) return true;
  return m.tour === pid && (m.left || []).includes(k);
}
// Shown: step 4 is this project's for good; under "don't show again" each step left is shown once.
function _shown(k, pid) {
  const m = _mem();
  let changed = false;
  if (k === 4 && !(m.seen4 || []).includes(pid)) { m.seen4 = (m.seen4 || []).concat(pid).slice(-300); changed = true; }
  if (m.off && m.tour === pid && (m.left || []).includes(k)) { m.left = m.left.filter(x => x !== k); changed = true; }
  if (changed) _save(m);
}
// Ticked: this cycle goes on to its end - the steps after this one, in this project. Unticked: shown again as before.
function _never(on, k, pid) {
  const m = _mem();
  if (on && !m.off) { m.off = true; m.tour = pid; m.left = [1, 2, 3, 4].filter(x => x > k); }
  if (!on) { delete m.off; delete m.tour; delete m.left; }
  _save(m);
}

// ── Which step, pointing at what ────────────────────────────────────────────
const _isBroll = (c) => /^br_\d/.test(String((c && c.id) || ''));
function _laid() {
  const tl = Store.timeline();
  const v1 = ((tl && tl.tracks) || []).find(t => t.id === 'v1');
  return !!(v1 && (v1.clips || []).some(_isBroll));
}
const _shownEl = (sel) => {
  const e = document.querySelector(sel);
  if (!e) return null;
  const r = e.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? e : null;
};
function _want() {
  const p = WK.project();
  if (!p || p.type !== 'voiceover' || !WK.isTalking()) return null;
  const pid = String(p.id);
  const live = (Array.isArray(p.lines) ? p.lines : []).filter(isLive);
  const setup = WK.step() === 'setup';
  let k = 0, sel = '';
  if (_laid()) { k = 4; sel = '#mv3-timeline'; }
  else if (!setup) return null;
  else if (!live.length) { k = 1; sel = '#mv3-inspector .mv3-wk-half.is-frags'; }
  else if (live.some(l => !isRead(l))) { k = 2; sel = '#mv3-inspector .mv3-wk-stage[data-stage="moodvoice"]'; }
  else { k = 3; sel = '#mv3-inspector [data-tip="broll-find"]'; }
  // The tip on the screen stays until it is closed or its step is over - its own tick, or its being shown once, ends nothing.
  const showing = !!_tip && _tip.k === k && _tip.pid === pid;
  if (_closed.has(pid + ':' + k) || (!showing && !_allowed(k, pid))) return null;
  const anchor = _shownEl(sel);
  return anchor ? { k, pid, anchor } : null;
}

// ── The tip on the screen ───────────────────────────────────────────────────
let _tip = null;               // { k, pid, box, anchor }
const _closed = new Set();     // 'pid:k' closed in this opening
let _key = null;

function _hide() {
  if (!_tip) return;
  _tip.box.remove();
  _tip = null;
}
function _close() {
  if (!_tip) return;
  _closed.add(_tip.pid + ':' + _tip.k);
  _hide();
}

function _tick() {
  // Another project: what was closed in the last one may be shown again when it is opened again.
  const key = Store.key() || '';
  if (key !== _key) { _key = key; _closed.clear(); _hide(); }
  // Under a window it only hides - it is there again when the window goes.
  if (Layers.blocked() || document.visibilityState === 'hidden') { if (_tip) _tip.box.style.visibility = 'hidden'; return; }
  const w = _want();
  if (!w) { _hide(); return; }
  if (!_tip || _tip.k !== w.k || _tip.pid !== w.pid) {
    _hide();
    const t = TIPS[w.k];
    const box = tipBox({ title: t.title, text: t.text, never: !!_mem().off,
      onClose: _close, onNever: (on) => _never(on, w.k, w.pid) });
    document.body.appendChild(box);
    _tip = { k: w.k, pid: w.pid, box };
    _shown(w.k, w.pid);
  }
  _tip.box.style.visibility = '';
  placeBubble(_tip.box, w.anchor, TIPS[w.k].side);
}

// A press anywhere but on the tip: the person began to choose, or went on with something else - it goes.
function _onDown(e) {
  if (!_tip || _tip.box.style.visibility === 'hidden') return;
  if (_tip.box.contains(e.target)) return;
  _close();
}

export function initVoTips() {
  document.addEventListener('mousedown', _onDown, true);
  window.addEventListener('resize', _tick);
  setInterval(_tick, TICK_MS);
}
