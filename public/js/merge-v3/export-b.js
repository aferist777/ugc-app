/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — exporting a BLANK project.

   The third piece of the second workflow, after its timeline and its preview, and separate
   for the same reason: nothing here touches js/merge-v3/export.js, and that file stands
   down while a blank project is open. Two handlers on one button would start two encodes of
   two different graphs.

   The window is not a settings panel. There is nothing here to set that is not already set
   somewhere truer - the frame is the project's, the levels are the clips'. What it is for is
   the choice between rendering NOW and leaving it for later, and for saying what is about to
   be made before it is made: shape, length, how many pieces. A render is the one action in
   this editor that takes minutes, and it deserves a sentence of warning.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as Store from './store.js';
import { showResult } from './render-result.js';
import { addCurrent } from './queue.js';

let _busy = false;

function _say(msg, kind) {
  const el = document.getElementById('mv3-tl-status');
  if (!el) return;
  el.hidden = !msg;
  el.textContent = msg || '';
  el.className = 'mv3-tl-status' + (kind ? ' is-' + kind : '');
}

function _mmss(v) {
  const m = Math.floor(v / 60), s = Math.round(v - m * 60);
  return m + ':' + (s < 10 ? '0' : '') + s;
}

// The window's body, replaced as the job moves through its states. One element that changes
// what it says, rather than three that take turns being hidden.
function _stage(box, build) {
  if (!box) return;
  box.textContent = '';
  build(box);
}

async function _run(box) {
  if (_busy) return;
  const tl = Store.timeline();
  if (!tl || !Array.isArray(tl.tracks)) return;

  _busy = true;
  const btn = document.getElementById('mv3-export');
  if (btn) btn.disabled = true;

  let bar = null, note = null;
  _stage(box, (b) => {
    const h = document.createElement('div');
    h.className = 'mv3-rhead'; h.textContent = 'Rendering';
    b.appendChild(h);
    bar = document.createElement('div');
    bar.className = 'mv3-rbar';
    const fill = document.createElement('i');
    fill.style.width = '0%';
    bar.appendChild(fill);
    b.appendChild(bar);
    note = document.createElement('div');
    note.className = 'mv3-rsum';
    note.textContent = 'Starting…';
    b.appendChild(note);
  });

  try {
    // The timeline goes up as it stands. The server builds the graph from it - the same
    // module, read the same way as the preview reads it - so there is nothing for this side
    // to assemble and nothing for it to get wrong.
    const start = await fetch('/api/mv3b/render', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timeline: tl, key: Store.key() }),
    }).then(r => r.json());
    if (!start || !start.success) throw new Error((start && start.error) || 'refused');


    // Polled rather than streamed: an encode of a few seconds answers in a couple of
    // requests, and a socket for that would be more moving parts than the job has.
    for (;;) {
      await new Promise(r => setTimeout(r, 1200));
      const st = await fetch('/api/mv3b/render/' + encodeURIComponent(start.jobId)).then(r => r.json());
      if (!st || !st.success) throw new Error((st && st.error) || 'lost the job');
      if (st.status === 'running') {
        if (bar && bar.firstElementChild) bar.firstElementChild.style.width = (st.percent || 0) + '%';
        if (note) {
          note.textContent = (st.percent || 0) + '%'
            + (st.remain != null ? ' · about ' + _mmss(st.remain) + ' left' : ' · measuring…');
        }
        continue;
      }
      if (st.status === 'failed') throw new Error(st.error || 'ffmpeg failed');

      // Done: the window every render shares - playable, named, kept, sent (render-result.js).
      _close();
      showResult({ url: st.url, title: Store.title(), key: Store.key(), fresh: true });
      return;
    }
  } catch (e) {
    _stage(box, (b2) => {
      const h = document.createElement('div');
      h.className = 'mv3-rhead'; h.textContent = 'Not rendered';
      b2.appendChild(h);
      const w = document.createElement('div');
      w.className = 'mv3-rwarn'; w.textContent = e.message;
      b2.appendChild(w);
      const row = document.createElement('div');
      row.className = 'mv3-rrow';
      const close = document.createElement('button');
      close.type = 'button'; close.className = 'mv3-btn sm'; close.textContent = 'Close';
      close.addEventListener('click', _close);
      row.appendChild(close);
      b2.appendChild(row);
    });
  } finally {
    _busy = false;
    const b = document.getElementById('mv3-export');
    if (b) b.disabled = !Store.hasProject();
  }
}

// ── The window ──────────────────────────────────────────────────────────────
let _ov = null;

function _close() { if (_ov) { _ov.remove(); _ov = null; } }

function _summary(tl) {
  let end = 0, pieces = 0, sounds = 0;
  for (const t of (tl.tracks || [])) {
    for (const c of (t.clips || [])) {
      end = Math.max(end, (+c.start) + (+c.dur));
      if (t.kind === 'video') pieces++;
      if (t.kind === 'audio' && (+c.volume || 0) > 0) sounds++;
    }
  }
  return { end: Math.round(end * 10) / 10, pieces, sounds };
}

function _open() {
  _close();
  const tl = Store.timeline();
  if (!tl || !Array.isArray(tl.tracks)) return;
  const s = _summary(tl);

  _ov = document.createElement('div');
  _ov.className = 'mv3-rov';
  const box = document.createElement('div');
  box.className = 'mv3-rbox';

  const h = document.createElement('div');
  h.className = 'mv3-rhead';
  h.textContent = 'Render';
  box.appendChild(h);

  const p = document.createElement('div');
  p.className = 'mv3-rsum';
  p.textContent = (tl.format || '9:16') + ' · ' + s.end.toFixed(1) + 's · '
                + s.pieces + (s.pieces === 1 ? ' piece of picture' : ' pieces of picture') + ' · '
                + (s.sounds ? s.sounds + (s.sounds === 1 ? ' sound' : ' sounds') : 'no sound');
  box.appendChild(p);

  if (!s.end) {
    const w = document.createElement('div');
    w.className = 'mv3-rwarn';
    w.textContent = 'There is nothing on the timeline to render.';
    box.appendChild(w);
  }

  const row = document.createElement('div');
  row.className = 'mv3-rrow';

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'mv3-btn sm';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', _close);

  // Left of Render, because it is the calmer of the two and the one to reach for when several
  // projects are being set up in a row.
  const queue = document.createElement('button');
  queue.type = 'button';
  queue.className = 'mv3-btn sm';
  queue.textContent = 'Add to queue';
  queue.disabled = !s.end;
  queue.title = 'Leave it for later - the queue renders them one after another';
  queue.addEventListener('click', async () => {
    queue.disabled = true;
    const d = await addCurrent();
    _close();
    _say(d && d.success ? 'Added to the queue.' : 'Not queued: ' + ((d && d.error) || 'refused'),
         d && d.success ? '' : 'err');
  });

  const go = document.createElement('button');
  go.type = 'button';
  go.className = 'mv3-btn sm primary';
  go.textContent = 'Render';
  go.disabled = !s.end;
  // The window STAYS. It becomes the progress and then the result: throwing the file at a new
  // tab leaves nothing behind to say what was made, and the tab is the wrong place to find it
  // again five minutes later.
  go.addEventListener('click', () => _run(box));

  row.append(cancel, queue, go);
  box.appendChild(row);
  _ov.appendChild(box);
  _ov.addEventListener('mousedown', (e) => { if (e.target === _ov) _close(); });
  document.body.appendChild(_ov);
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') { _close(); document.removeEventListener('keydown', esc); }
  });
}

export function initExportB() {
  const b = document.getElementById('mv3-export');
  if (b) b.addEventListener('click', () => { if (Store.isBlank()) _open(); });
}
