/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — the controls on the timeline's bar and the preview's bar.

   Undo and redo, the save status, the zoom, FIT and split above the timeline; the quality,
   the enlarged preview and the screenshot under the picture. The transport beside split is the
   preview's own (js/merge-v3/preview-b.js _wireTransport). One module owns
   them; what depends on the timeline is asked of js/merge-v3/timeline-b.js and
   js/merge-v3/preview-b.js.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as Store from './store.js';
import * as Layers from '../layers.js';
import * as History from './history.js';
import { fit, splitAtPlayhead, canSplit, onSelChange, onPlayhead } from './timeline-b.js';
import { grabFrame } from './preview-b.js';
import { showError } from '../notice.js';
import { icon } from '../icons.js';
import { wire as wireRange } from '../ui-range.js';
// The interface's words (`t` is a target and a time here, so the module's words are T.t).
import * as T from '../i18n/t.js';

const $ = (id) => document.getElementById(id);

// ── Undo and redo ───────────────────────────────────────────────────────────
// The buttons paint themselves from the stack, so they can never claim there is something to
// undo when there is not. The keys are a shortcut for the buttons, and stand down while a field
// has the focus - Ctrl+Z in a caption's text box means that text.
function _history() {
  const u = $('mv3-undo'), r = $('mv3-redo');
  if (u) u.addEventListener('click', () => History.undo());
  if (r) r.addEventListener('click', () => History.redo());
  History.onChange(() => {
    const d = History.depth();
    if (u) { u.disabled = !History.canUndo(); u.title = d.undo ? T.t('Undo (Ctrl+Z) - {n}', { n: d.undo }) : T.t('Undo (Ctrl+Z) - nothing yet'); }
    if (r) { r.disabled = !History.canRedo(); r.title = d.redo ? T.t('Redo (Ctrl+Y) - {n}', { n: d.redo }) : T.t('Redo (Ctrl+Y) - nothing yet'); }
  });
  document.addEventListener('keydown', (e) => {
    if (Layers.blocked()) return;          // a window on top owns the keyboard (js/layers.js)
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const t = e.target;
    if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
    // The printed letter when it is a Latin one - on a German keyboard Z and Y trade places, and the key's place
    // would swap undo and redo; the key's PLACE only for another alphabet (in the Russian layout e.key is a Cyrillic
    // letter, and undo would do nothing).
    const key = String(e.key || '').toLowerCase();
    const k = /^[a-z]$/.test(key) ? key : (e.code === 'KeyZ' ? 'z' : e.code === 'KeyY' ? 'y' : key);
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); if (History.canUndo()) History.undo(); }
    else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); if (History.canRedo()) History.redo(); }
  });
}

// ── The save status ─────────────────────────────────────────────────────────
// Shown only when a save was refused or failed, or when something came in from elsewhere -
// silence about a lost edit makes data loss hard to notice.
// A refusal or a failure is also a popup (js/notice.js) - ONCE: the same status staying
// on through the next changes is not said again; it is again when it comes back after it went.
let _popped = '';
function _status() {
  const el = $('mv3-tl-status');
  if (!el) return;
  Store.onChange(() => {
    const s = Store.status();
    if (s && Store.statusIsError()) { if (s !== _popped) { _popped = s; showError(s); } }
    else _popped = '';
    if (!s && !el.textContent) return;
    // the one status line (`.u-status`): quiet for news, red for a refusal or a failure
    el.className = 'mv3-tl-status u-status is-line' + (s && !Store.statusIsInfo() ? ' is-bad' : '');
    el.textContent = s || '';
    el.hidden = !s;
  });
}

// ── Zoom, FIT and split ─────────────────────────────────────────────────────
const LS_ZOOM = 'mv3_tl_zoom';

function _zoom() {
  const z = $('mv3-zoom');
  if (!z) return;
  let saved = null;
  try { saved = parseInt(localStorage.getItem(LS_ZOOM) || '', 10); } catch (e) { /* no storage */ }
  if (saved && !isNaN(saved)) z.value = String(Math.max(+z.min || 1, Math.min(+z.max || 240, saved)));
  // the shared slider: its fill follows every move - the wheel and the fit set the value and fire input
  wireRange(z);
  const pill = $('mv3-tl-pps');
  const paint = () => { if (pill) pill.textContent = String(parseInt(z.value, 10) || 60); };
  paint();
  // input, not change: the number follows the slider while it is being dragged.
  z.addEventListener('input', () => {
    paint();
    try { localStorage.setItem(LS_ZOOM, String(parseInt(z.value, 10) || 60)); } catch (e) { /* no storage */ }
  });
  const f = $('mv3-fit');
  if (f) f.addEventListener('click', () => fit());
}

function _split() {
  const b = $('mv3-split');
  if (!b) return;
  b.addEventListener('click', () => {
    const r = splitAtPlayhead();
    // A refusal is a "not now", said in the tooltip rather than an alert.
    if (!r.ok) b.title = r.why;
  });
  // Enabled only when there is something to cut, so the button reports the state instead of
  // accepting a click and doing nothing. The playhead moves far more often than the selection.
  const paint = () => {
    const r = Store.hasProject() ? canSplit() : { ok: false, why: T.t('Open a project to edit it') };
    b.disabled = !r.ok;
    b.title = r.ok ? T.t('Cut the selected clip at the playhead') : r.why;
  };
  Store.onChange(paint);
  onSelChange(paint);
  onPlayhead(paint);
}

// ── The preview's quality ───────────────────────────────────────────────────
// How tall the proxies the preview plays are - never the render. Every project opens at 480:
// a 720 left on from yesterday makes the next project open slow for no reason anybody can see.
const QUALITIES = ['360', '480', '720'];
const DEFAULT_Q = '480';

function _quality() {
  const q = $('mv3-pv-q');
  if (!q) return;
  if (!q.options.length) {
    for (const v of QUALITIES) {
      const o = document.createElement('option');
      o.value = v; o.textContent = v;
      q.appendChild(o);
    }
  }
  q.value = DEFAULT_Q;
  let key = null;
  Store.onChange(() => {
    const k = Store.key();
    if (k === key) return;
    key = k;
    if (q.value !== DEFAULT_Q) { q.value = DEFAULT_Q; q.dispatchEvent(new Event('change')); }
  });
}

// ── The enlarged preview ────────────────────────────────────────────────────
// The SAME stage moved into an overlay and moved back on close - not a second canvas, which would
// need its own clock and media and drift from this one the first time either stuttered.
let _bigWrap = null;
let _bigLayer = null;
let _stageHome = null;

function _closeBig() {
  if (!_bigWrap) return;
  const stage = $('mv3-stage');
  if (stage && _stageHome) _stageHome.insertBefore(stage, _stageHome.firstChild);
  _bigWrap.remove();
  _bigWrap = null;
  if (_bigLayer) { Layers.close(_bigLayer); _bigLayer = null; }
}

function _openBig() {
  if (_bigWrap) return _closeBig();
  const stage = $('mv3-stage');
  if (!stage) return;
  _stageHome = stage.parentElement;
  const ov = document.createElement('div');
  ov.className = 'mv3-big';
  const box = document.createElement('div');
  box.className = 'mv3-big-box';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'mv3-big-x u-btn is-icon is-quiet u-x';
  close.title = T.t('Close (Esc)');
  close.addEventListener('click', _closeBig);
  ov.append(box, close);
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) _closeBig(); });
  document.body.appendChild(ov);
  box.appendChild(stage);
  _bigWrap = ov;
  // Not modal: Escape closes this before anything underneath it, but the transport keys
  // still work - Space over an enlarged preview means play (js/layers.js).
  _bigLayer = Layers.open(ov, { modal: false, name: 'big preview', onEsc: _closeBig });
}

// ── The screenshot ──────────────────────────────────────────────────────────
// The frame under the playhead, at the film's own size, filed in Images / Screenshots. Locked
// while it runs: the capture loads the original files, and a second press would fight the first.
const _clock = (t) => {
  const s = Math.max(0, +t || 0), m = Math.floor(s / 60), r = s - m * 60;
  return m + ':' + (r < 10 ? '0' : '') + r.toFixed(1);
};

async function _shoot() {
  const btn = $('mv3-pv-shot');
  if (!btn || btn.disabled) return;
  const was = btn.innerHTML;
  btn.disabled = true;
  // its states as Lucide's icons: turning while it saves, a tick, a cross
  btn.innerHTML = icon('loader-circle');
  btn.classList.add('is-busy');
  try {
    const r = await grabFrame();
    if (!r || !r.ok) throw new Error(T.t('the frame could not be read'));
    const fd = new FormData();
    fd.append('image', r.blob, 'shot.png');
    const title = Store.title() || '';
    fd.append('name', (title || 'shot') + ' ' + _clock(r.at));
    fd.append('project', title);
    fd.append('at', String(r.at));
    // No words on it: the frame is the picture alone (the captions are libass's own layer).
    const d = await fetch('/api/images/shot', { method: 'POST', body: fd }).then(x => x.json());
    if (!d || !d.success) throw new Error((d && d.error) || T.t('the server would not take it'));
    btn.classList.remove('is-busy');
    btn.innerHTML = icon('check');
    // Show where it landed rather than saying it.
    try { const L = await import('./library.js'); await L.showGroup('images', 'Screenshots'); } catch (e) { /* the shelf is optional */ }
    if (!r.full) btn.title = T.t('Saved at preview size ({w}×{h}) - the original files did not load in time', { w: r.w, h: r.h });
  } catch (e) {
    btn.classList.remove('is-busy');
    btn.innerHTML = icon('x');
    btn.title = T.t('Could not save the frame: {why}', { why: e.message });
  } finally {
    setTimeout(() => {
      btn.classList.remove('is-busy');
      btn.innerHTML = was;
      btn.title = T.t('Save this frame to the library (Images / Screenshots)');
      btn.disabled = false;
    }, 1400);
  }
}

// The timeline head's icons - Lucide's, 14 px in its 20-px buttons.
// Play turns into pause and back in the preview, which knows which of the two it is (preview-b.js _syncPlayBtn, the same 14).
const HEAD_ICONS = [['mv3-undo', 'undo-2'], ['mv3-redo', 'redo-2'], ['mv3-pv-start', 'skip-back'], ['mv3-pv-back', 'rewind'],
  ['mv3-pv-play', 'play'], ['mv3-pv-fwd', 'fast-forward'], ['mv3-frame-pic', 'image'], ['mv3-frame-vid', 'film']];

// The frame at the playhead into a chat - as the preview shows it, without words (js/merge-v3/tl-gen.js).
function _frames() {
  for (const [id, chat] of [['mv3-frame-pic', 'pictures'], ['mv3-frame-vid', 'videos']]) {
    const b = $(id);
    if (b) b.addEventListener('click', () => {
      if (b.disabled) return;
      import('./tl-gen.js').then(G => G.fromFrame(chat, b))
        .catch(err => showError(T.t('The frame did not go to the chat'), { detail: (err && err.message) || String(err) }));
    });
  }
}

export function initBar() {
  for (const [id, name] of HEAD_ICONS) { const b = $(id); if (b && !b.firstChild) b.innerHTML = icon(name, 14); }
  _history();
  _status();
  _zoom();
  _split();
  _frames();
  _quality();
  // the shared part's icon button, Lucide's icons
  const big = $('mv3-pv-big');
  if (big) { big.innerHTML = icon('maximize'); big.addEventListener('click', _openBig); }
  const shot = $('mv3-pv-shot');
  if (shot) { shot.innerHTML = icon('camera'); shot.addEventListener('click', _shoot); }
}
