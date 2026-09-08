/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — the preview cut: the whole timeline rendered small, for playback.

   WHY. The preview composites up to four <video> elements per frame - Main, a birol, a
   hook, a halfer - each with its own buffer, clock and download. Four separate streams do
   not start an overlay on the same frame, whatever is primed: the picture froze at every
   cut while the playhead ran on, and the Main lane fell silent while an overlay's sound
   played, because the Main element had run out of buffer behind the others' downloads.

   WHAT. The server renders the timeline with the export pipeline at 480 wide and its
   fastest settings (routes/ffmpeg.js, /ffmpeg/preview-cut) - one file, one stream, every
   lane's picture and sound in step by construction - and the preview PLAYS that file
   instead of compositing. Scrubbing while paused, and dragging overlays, still use the
   live compositor: it answers instantly, and a placement has to be seen as it is made.

   WHEN. On open, if there is no cut for this version of the project; after edits, once
   the save has landed and they have rested for a couple of seconds. A cut is named by the
   project's version and the export settings, so it is either right or not there. An
   unsaved edit makes the cut stale at once - playback falls back to the compositor - and
   the chip in the preview's head says what is going on.

   BOTH KINDS OF PROJECT. A talking-head project's cut is asked of /ffmpeg/preview-cut with
   the export payload; a blank project's of /mv3b/preview-cut with the timeline itself, the
   way its own export goes. The file lands in the same place under the same name either way,
   and the check for one is the same.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as Store from './store.js';
import { buildPayload, ADV_DEFAULTS } from './export.js';
import { setCut as setCutA } from './preview.js';
import { setCut as setCutB } from './preview-b.js';

// Whichever preview holds the stage gets the cut; both are told when there is none.
const setCut = (url) => { if (!url) { setCutA(null); setCutB(null); return; } if (Store.isBlank()) setCutB(url); else setCutA(url); };

const SETTLE_MS = 2500;      // how long the edits rest before a render is asked for
const POLL_MS = 1000;
const BUSY = /^(queued|running|normalizing|speeding)$/;

let _st = { key: null, rev: null, status: 'none', url: null, jobId: null, error: null, progress: 0, queuePos: null };
let _settle = null, _poll = null, _seq = 0;

// A short hash of the export settings: an EQ or captions change is a different cut without
// being a different version of the timeline.
function _hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
const _rev = () => Store.version() + '-' + _hash(JSON.stringify(Store.adv() || {}));

// ── the chip ────────────────────────────────────────────────────────────────
function _paint() {
  const el = document.getElementById('mv3-pv-cut');
  const go = document.getElementById('mv3-pv-cut-go');
  if (!el) return;
  const on = _st.status !== 'none';
  el.hidden = !on;
  if (!on) return;
  const text = el.querySelector('span');
  const total = Store.duration() || 0;
  let cls = '', msg = '';
  switch (_st.status) {
    case 'stale':     cls = 'is-stale'; msg = 'preview cut · waiting for the edits to settle'; break;
    case 'queued':    cls = 'is-busy';  msg = 'preview cut · queued' + (_st.queuePos ? ' · ' + _st.queuePos + ' ahead' : ''); break;
    case 'rendering': cls = 'is-busy';  msg = 'preview cut · rendering' + (total ? ' ' + Math.min(total, _st.progress || 0).toFixed(0) + ' / ' + total.toFixed(0) + ' s' : '…'); break;
    case 'ready':     cls = 'is-ready'; msg = 'preview cut · ready · Play shows the real render'; break;
    case 'failed':    cls = 'is-bad';   msg = 'preview cut failed' + (_st.error ? ' · ' + String(_st.error).slice(0, 80) : ''); break;
    default:          break;
  }
  el.className = 'mv3-pv-cut ' + cls;
  if (text) text.textContent = msg;
  if (go) { go.disabled = _st.status === 'queued' || _st.status === 'rendering'; go.title = _st.status === 'ready' ? 'Render the preview cut again' : 'Render the preview cut now'; }
}

function _set(patch) { Object.assign(_st, patch); _paint(); }

// ── asking for it ────────────────────────────────────────────────────────────
function _stopPolling() { if (_poll) { clearTimeout(_poll); _poll = null; } }
function _stopSettle() { if (_settle) { clearTimeout(_settle); _settle = null; } }

// Is there a cut for this version already, or one on its way? Otherwise ask for one.
async function _check(seq) {
  const key = _st.key, rev = _st.rev;
  let d = null;
  try { d = await fetch('/api/ffmpeg/preview-cut?key=' + encodeURIComponent(key) + '&rev=' + encodeURIComponent(rev)).then(r => r.json()); } catch (e) { d = null; }
  if (seq !== _seq) return;
  if (d && d.success && d.ready) { _set({ status: 'ready', url: d.url, jobId: null }); setCut(d.url); return; }
  if (d && d.success && d.job && d.job.rev === rev && BUSY.test(d.job.status)) {
    _set({ status: d.job.status === 'queued' ? 'queued' : 'rendering', jobId: d.job.id, progress: d.job.progressSecs || 0, queuePos: d.job.queuePos || null });
    _pollJob(seq, 'ffmpeg');
    return;
  }
  _render(seq);
}

async function _render(seq) {
  if (seq !== _seq) return;
  // The save has to land first: the cut is named by the version, and the version the server
  // gives this edit is not known yet. onChange comes back here when it is.
  if (!Store.hasProject() || Store.dirty()) return;
  const key = _st.key, rev = _st.rev;
  const blank = Store.isBlank();
  let url, body;
  if (blank) {
    const tl = Store.timeline();
    const any = ((tl && tl.tracks) || []).some(t => ((t && t.clips) || []).length);
    if (!any) { _set({ status: 'none' }); setCut(null); return; }
    url = '/api/mv3b/preview-cut';
    body = { timeline: tl, preview: { key, rev } };
  } else {
    let payload = null;
    try { payload = buildPayload(Object.assign({}, ADV_DEFAULTS, Store.adv() || {})); } catch (e) { payload = null; }
    if (!payload || (!payload.segmentClips.length && !payload.clips.length && !payload.halferClips.length)) { _set({ status: 'none' }); setCut(null); return; }
    url = '/api/ffmpeg/preview-cut';
    body = { key, rev, payload };
  }
  let d = null;
  try {
    d = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
  } catch (e) { d = { success: false, error: e.message }; }
  if (seq !== _seq) return;
  if (!d || !d.success) { _set({ status: 'failed', error: (d && d.error) || 'no answer' }); return; }
  if (d.ready) { _set({ status: 'ready', url: d.url, jobId: null }); setCut(d.url); return; }
  _set({ status: blank ? 'rendering' : 'queued', jobId: d.jobId, progress: 0 });
  _pollJob(seq, blank ? 'mv3b' : 'ffmpeg');
}

// The two renderers report differently: the scenario one queues and counts seconds, the
// blank one starts at once and reports the position it has encoded to.
function _pollJob(seq, kind) {
  _stopPolling();
  const statusUrl = kind === 'mv3b' ? '/api/mv3b/render/' : '/api/ffmpeg/status/';
  const tick = async () => {
    if (seq !== _seq || !_st.jobId) return;
    let d = null;
    try { d = await fetch(statusUrl + encodeURIComponent(_st.jobId)).then(r => r.json()); } catch (e) { d = null; }
    if (seq !== _seq) return;
    if (!d || !d.success) { _poll = setTimeout(tick, POLL_MS * 2); return; }
    if (d.status === 'done') { _check(seq); return; }
    if (d.status === 'failed') { _set({ status: 'failed', error: d.error || 'render failed', jobId: null }); return; }
    if (d.status === 'cancelled') { _set({ status: 'stale', jobId: null }); return; }    // superseded; the newer version is on its way
    _set({ status: d.status === 'queued' ? 'queued' : 'rendering', progress: (kind === 'mv3b' ? d.at : d.progressSecs) || 0, queuePos: d.queuePos || null });
    _poll = setTimeout(tick, POLL_MS);
  };
  _poll = setTimeout(tick, POLL_MS);
}

// Everything in flight is dropped and the cut is taken off the preview: what is playing
// goes back to the compositor on the next frame.
function _reset(key, rev) {
  _seq++;
  _stopPolling();
  _stopSettle();
  setCut(null);
  _st = { key, rev, status: key ? 'stale' : 'none', url: null, jobId: null, error: null, progress: 0, queuePos: null };
  _paint();
}

// ── following the project ───────────────────────────────────────────────────
function _onChange() {
  const key = Store.hasProject() ? Store.key() : null;
  const rev = key ? _rev() : null;
  const opened = key !== _st.key;
  if (opened || rev !== _st.rev) {
    _reset(key, rev);
    if (!key) return;
    const seq = _seq;
    if (opened) _check(seq);                                   // on open: is there one already?
    else _settle = setTimeout(() => _check(seq), SETTLE_MS);   // after a save: let the edits rest
    return;
  }
  // Same version, an edit not saved yet: the cut no longer shows the timeline. The version
  // moves on when the save lands, and that comes back through the branch above.
  if (key && Store.dirty() && _st.status !== 'stale') _reset(key, rev);
}

export function initPreviewCut() {
  const go = document.getElementById('mv3-pv-cut-go');
  if (go) go.addEventListener('click', () => {
    if (!_st.key) return;
    _reset(_st.key, _st.rev);
    _render(_seq);
  });
  Store.onChange(_onChange);
  _paint();
}
