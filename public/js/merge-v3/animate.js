/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — animating a still into a clip.

   A picture on the timeline, a sentence about how it should move, and a length.
   The rest of the pipeline already existed and is reused rather than rebuilt:

     POST /api/video/p-video                 -> { taskId: 'repl:<id>' }
     GET  /api/video/p-video/status/:taskId  -> pending | success + videoPath
     POST /api/media/thumb                   -> a real poster frame
     POST /api/library/media/record          -> files it under Birols

   A POPUP rather than a panel section, for two reasons. The prompt is the main
   field here and the inspector's right-hand column is a quarter of the panel
   wide. And a popup survives the selection changing: click another clip while a
   generation runs and the job carries on in front of you instead of being
   replaced by that clip's settings.

   THE PICTURE IS NOT CONSUMED. The result is filed as a new birol in
   Uncategorized and the still stays in the library exactly as it was; the two are
   tied together by `refImage` on the birol record, which is what lets the viewer
   show a clip beside the frame it grew out of.

   One model for now - prunaai/p-video, i2v, 1 to 20 seconds. The picker and its
   gear come later; until then the panel says which model it will use rather than
   offering a list of one.
   ═══════════════════════════════════════════════════════════════════════════ */

import { startInlineProgress, lockControls } from '../progress.js';

// The engine, and the only thing here that knows about it. When the picker arrives this
// becomes a table and the duration bounds come off the chosen row.
const MODEL = {
  id: 'prunaai/p-video',
  label: 'p-video',
  min: 1,
  max: 20,
  dflt: 5,
  // 9:16 because the timeline is: a 16:9 result would arrive letterboxed into the frame.
  params: { aspect_ratio: '9:16', resolution: '720p' },
};

// What one usually costs, before anything here has been timed. The progress row counts up
// past it rather than freezing, so an underestimate is survivable and a stuck bar is not.
const ETA_MS = 150000;

const _sleep = (ms) => new Promise(r => setTimeout(r, ms));
const _el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

let _open = null;      // the live overlay, so a second click cannot stack two

export function closeAnimate() {
  if (!_open) return;
  // A generation that is running is deliberately NOT cancelled here: the job is already
  // paid for, and Replicate will finish it whether or not this window is watching. What is
  // lost by closing is only the filing, which is why the button says so.
  document.removeEventListener('keydown', _open.key, true);
  try { _open.ov.remove(); } catch (e) {}
  _open = null;
}

export function openAnimate(clip) {
  if (!clip || !clip.src) return;
  closeAnimate();

  const ov = _el('div', 'mv3-x-ov mv3-anim-ov');
  const box = _el('div', 'mv3-anim');

  // ── head ──
  const head = _el('div', 'mv3-anim-head');
  head.appendChild(_el('h3', null, 'Animate this picture'));
  head.appendChild(_el('span', 'sp'));
  const x = _el('button', 'mv3-x-close', '✕');
  x.type = 'button';
  x.title = 'Close (Esc)';
  head.appendChild(x);
  box.appendChild(head);

  // ── body: the picture on the left, everything about it on the right ──
  const body = _el('div', 'mv3-anim-body');

  const left = _el('div', 'mv3-anim-ref');
  const img = document.createElement('img');
  img.src = clip.thumb || clip.src;
  img.alt = clip.name || '';
  left.appendChild(img);
  const cap = _el('div', 'mv3-anim-refcap', clip.name || 'the picture');
  left.appendChild(cap);
  body.appendChild(left);

  const right = _el('div', 'mv3-anim-form');

  const modelRow = _el('div', 'mv3-anim-row');
  modelRow.appendChild(_el('span', 'mv3-anim-lbl', 'model'));
  modelRow.appendChild(_el('span', 'mv3-anim-val', MODEL.label + ' · image to video'));
  right.appendChild(modelRow);

  const durRow = _el('div', 'mv3-anim-row');
  durRow.appendChild(_el('span', 'mv3-anim-lbl', 'duration'));
  const dur = document.createElement('input');
  dur.type = 'range';
  dur.min = String(MODEL.min); dur.max = String(MODEL.max); dur.step = '1';
  // The clip's own length is the obvious starting point: the picture already occupies that
  // much of the timeline, so a clip of the same length drops straight in over it.
  dur.value = String(Math.max(MODEL.min, Math.min(MODEL.max, Math.round(+clip.dur || MODEL.dflt))));
  const durOut = _el('span', 'mv3-anim-val', dur.value + 's');
  dur.addEventListener('input', () => { durOut.textContent = dur.value + 's'; });
  durRow.appendChild(dur);
  durRow.appendChild(durOut);
  right.appendChild(durRow);

  const ta = document.createElement('textarea');
  ta.className = 'mv3-anim-prompt';
  ta.rows = 5;
  ta.placeholder = 'How should it move?\ne.g. slow push in, hair moves in the wind, she blinks once';
  right.appendChild(ta);

  body.appendChild(right);
  box.appendChild(body);

  // ── foot: where it lands, and the two buttons ──
  const foot = _el('div', 'mv3-anim-foot');
  const note = _el('span', 'mv3-anim-note', 'lands in Birols / Uncategorized');
  foot.appendChild(note);
  foot.appendChild(_el('span', 'sp'));
  const cancel = _el('button', 'mv3-c-btn', 'Cancel');
  cancel.type = 'button';
  const go = _el('button', 'mv3-c-btn mv3-anim-go', 'Animate');
  go.type = 'button';
  foot.appendChild(cancel);
  foot.appendChild(go);
  box.appendChild(foot);

  ov.appendChild(box);
  document.body.appendChild(ov);

  const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); closeAnimate(); } };
  document.addEventListener('keydown', key, true);
  _open = { ov, key };

  x.addEventListener('click', closeAnimate);
  cancel.addEventListener('click', closeAnimate);
  // Clicking the dimmed surround closes, clicking the panel does not.
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) closeAnimate(); });

  ta.focus();
  go.addEventListener('click', () => _run({ clip, box, body, foot, note, go, cancel, dur, ta }));
}

// ── The run ─────────────────────────────────────────────────────────────────
async function _run(ui) {
  const { clip, body, foot, note, go, cancel, dur, ta } = ui;
  const prompt = ta.value.trim();
  if (!prompt) { ta.focus(); ta.classList.add('is-bad'); setTimeout(() => ta.classList.remove('is-bad'), 900); return; }

  // Everything that shaped the job is locked while it runs: the request is already sent, so
  // a slider moved now would describe something other than what is being made.
  const unlock = lockControls([go, dur, ta]);
  body.classList.add('is-busy');
  note.textContent = '';
  const prog = startInlineProgress(foot, { label: 'Animating…', key: 'mv3-animate', estimateMs: ETA_MS });

  try {
    const start = await fetch('/api/video/p-video', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        imagePath: clip.src,
        params: { ...MODEL.params, duration: parseInt(dur.value, 10) },
      }),
    }).then(r => r.json());
    if (!start || !start.success || !start.taskId) throw new Error((start && start.error) || 'the model refused the job');

    // Every four seconds for twenty minutes. A blip in polling is not a failure - only an
    // explicit `failed` is - because giving up early throws away a job already paid for.
    let videoPath = null;
    for (let i = 0; i < 300; i++) {
      await _sleep(4000);
      const s = await fetch('/api/video/p-video/status/' + encodeURIComponent(start.taskId)).then(r => r.json()).catch(() => null);
      if (!s || !s.success) continue;
      if (s.state === 'failed') throw new Error(s.error || 'the model could not make that one');
      if (s.state === 'success' && s.videoPath) { videoPath = s.videoPath; break; }
    }
    if (!videoPath) throw new Error('gave up waiting for the model');

    // A real poster frame before it is filed, so the shelf never has to load the video to
    // draw a 72px card. A failure here costs a thumbnail, not the clip.
    prog.say('making its thumbnail…');
    let thumbPath = null;
    try {
      const t = await fetch('/api/media/thumb', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video: videoPath }),
      }).then(r => r.json());
      if (t && t.success) thumbPath = t.thumbPath || null;
    } catch (e) { /* the sweep will pick it up */ }

    prog.say('filing it…');
    const rec = await fetch('/api/library/media/record', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoPath, thumbPath, kind: 'birols',
        name: (clip.name || 'animated').slice(0, 90),
        refImage: clip.src,       // the path back to the picture this grew out of
        prompt,
      }),
    }).then(r => r.json());
    if (!rec || !rec.success) throw new Error((rec && rec.error) || 'could not file it in the library');
    // The birol archive is browser-owned - biroly-server-sync pushes localStorage up every
    // couple of seconds - so the local copy has to learn about this too, or the next push
    // would erase the record the server just wrote.
    _lsUnshift(rec.lsKey, rec.item);

    prog.finish();
    _showResult(ui, videoPath, thumbPath);
  } catch (e) {
    prog.fail(e.message);
    body.classList.remove('is-busy');
    unlock();
    cancel.textContent = 'Close';
  }
}

// The birol archive lives in localStorage as well as on the server; see the note above.
function _lsUnshift(key, item) {
  if (!key || !item) return;
  try {
    const raw = localStorage.getItem(key);
    const list = raw ? JSON.parse(raw) : [];
    if (Array.isArray(list)) { list.unshift(item); localStorage.setItem(key, JSON.stringify(list)); }
  } catch (e) {}
}

// ── The result ──────────────────────────────────────────────────────────────
// Side by side with the picture it came from, because the only question worth asking now is
// whether the movement is the movement that was asked for - and that is answered by looking
// at the two together.
function _showResult(ui, videoPath, thumbPath) {
  const { body, foot, note, go, cancel, clip } = ui;
  body.classList.remove('is-busy');
  body.textContent = '';
  body.classList.add('is-done');

  const pair = _el('div', 'mv3-anim-pair');
  const a = _el('figure', 'mv3-anim-half');
  const ai = document.createElement('img');
  ai.src = clip.thumb || clip.src;
  a.appendChild(ai);
  a.appendChild(_el('figcaption', null, 'reference'));
  const b = _el('figure', 'mv3-anim-half');
  const v = document.createElement('video');
  v.src = videoPath;
  v.controls = true; v.autoplay = true; v.loop = true; v.playsInline = true; v.muted = true;
  if (thumbPath) v.poster = thumbPath;
  b.appendChild(v);
  b.appendChild(_el('figcaption', null, 'result'));
  pair.append(a, b);
  body.appendChild(pair);

  note.textContent = 'saved to Birols / Uncategorized';
  go.textContent = 'Again';
  go.disabled = false;
  go.onclick = () => { closeAnimate(); openAnimate(clip); };
  cancel.textContent = 'Close';
}
