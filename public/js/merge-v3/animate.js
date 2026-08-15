/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — animating a still into a clip.

   A picture on the timeline, a sentence about how it should move, and a length.
   The rest of the pipeline already existed and is reused rather than rebuilt:

     GET  /api/video/engines?dir=i2v          the matrix, for the pickers
     POST /api/video/animate                  -> { taskId, engine, provider }
     GET  /api/video/animate/status/:taskId   -> pending | success + videoPath
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

   WHICH ENGINE AND WHICH AGGREGATOR ARE TWO CHOICES, as they are for pictures on the
   Character page. They fail separately - the day Replicate rate-limited one model, the
   same model answered fine through another aggregator - so the matrix that pairs them
   lives in lib/video-providers.js and this window only draws what it is handed. A pairing
   that would fail at submit time cannot be offered, because it is not in the table.
   ═══════════════════════════════════════════════════════════════════════════ */

import { startInlineProgress, lockControls } from '../progress.js';

// The matrix, fetched once per page and shared by every opening of this window. It changes
// only when the server does, and re-asking on each open would put a round trip in front of a
// window that should appear at once.
let _engines = null;
async function _matrix() {
  if (_engines) return _engines;
  const d = await fetch('/api/video/engines?dir=i2v').then(r => r.json()).catch(() => null);
  _engines = (d && d.success && d.engines.length) ? d.engines : [];
  return _engines;
}

// Which engine and aggregator were last used, so the window opens where it was left. Kept per
// engine for the aggregator: choosing kie for grok should not mean kie is preselected for an
// engine kie cannot serve.
const LS_ENGINE = 'mv3_anim_engine';
const LS_PROV = (id) => 'mv3_anim_prov_' + id;
const _get = (k) => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } };
const _put = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };

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

export async function openAnimate(clip) {
  if (!clip || !clip.src) return;
  closeAnimate();
  const engines = await _matrix();
  if (!engines.length) { alert('No image-to-video engine is available - check the API keys in Brain.'); return; }

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

  // -- body: the two frames on the left, everything that shapes them on the right --
  const body = _el('div', 'mv3-anim-body');

  const media = _el('div', 'mv3-anim-media');

  const refSlot = _el('figure', 'mv3-anim-slot is-ref');
  const refImg = document.createElement('img');
  refImg.src = clip.thumb || clip.src;
  refImg.alt = clip.name || '';
  refSlot.appendChild(refImg);
  refSlot.appendChild(_el('figcaption', null, clip.name || 'reference'));
  media.appendChild(refSlot);

  // THE RESULT SLOT IS THERE FROM THE START, empty. Two reasons. It says what this window is
  // going to do before it does it, so the outcome appears where you were already looking
  // instead of the panel rearranging itself around a new element. And it is where a MOTION
  // REFERENCE will be dropped later: models like Kling motion control take a picture AND a
  // clip whose movement is copied, and that second input belongs here rather than in a
  // window redesigned around it after the fact.
  const outSlot = _el('figure', 'mv3-anim-slot is-out');
  const outBox = _el('div', 'mv3-anim-out');
  outBox.appendChild(_el('span', 'mv3-anim-ph', 'the clip will appear here'));
  outSlot.appendChild(outBox);
  outSlot.appendChild(_el('figcaption', null, 'result'));
  media.appendChild(outSlot);

  body.appendChild(media);

  const right = _el('div', 'mv3-anim-form');

  // AGGREGATOR FIRST, THEN MODEL - the order the Character page asks them in, and the order
  // they matter in: the aggregator is who you are buying from, the model is what you are
  // buying. The engine list is the whole matrix; the aggregator list is only the ones that
  // can serve the chosen engine, so an impossible pairing cannot be assembled here.
  let engine = engines.find(e => e.id === _get(LS_ENGINE)) || engines[0];

  const pickRow = _el('div', 'mv3-anim-row');
  pickRow.appendChild(_el('span', 'mv3-anim-lbl', 'engine'));
  const provSel = document.createElement('select');
  provSel.className = 'mv3-anim-sel';
  provSel.title = 'Which aggregator is asked';
  const modelSel = document.createElement('select');
  modelSel.className = 'mv3-anim-sel';
  modelSel.title = 'Which model generates it';
  for (const e of engines) {
    const o = document.createElement('option');
    o.value = e.id; o.textContent = e.label;
    if (e.id === engine.id) o.selected = true;
    modelSel.appendChild(o);
  }
  pickRow.appendChild(provSel);
  pickRow.appendChild(modelSel);
  right.appendChild(pickRow);

  const durRow = _el('div', 'mv3-anim-row');
  durRow.appendChild(_el('span', 'mv3-anim-lbl', 'duration'));
  const dur = document.createElement('input');
  dur.type = 'range';
  dur.step = '1';
  const durOut = _el('span', 'mv3-anim-val', '');
  dur.addEventListener('input', () => { durOut.textContent = dur.value + 's'; });
  durRow.appendChild(dur);
  durRow.appendChild(durOut);
  right.appendChild(durRow);

  // The aggregators of the chosen engine, and its length bounds. Both are properties of the
  // engine, so both are redrawn together: a duration valid for p-video's 1-20 is not valid
  // for grok's 6-30, and leaving the old number would build a request the model refuses.
  const _fitEngine = () => {
    provSel.textContent = '';
    for (const p of engine.providers) {
      const o = document.createElement('option');
      o.value = p.id; o.textContent = p.label;
      provSel.appendChild(o);
    }
    const remembered = _get(LS_PROV(engine.id));
    provSel.value = engine.providers.some(p => p.id === remembered) ? remembered : engine.providers[0].id;
    // One aggregator is a statement, not a choice - shown, but not pretending to offer.
    provSel.disabled = engine.providers.length < 2;

    dur.min = String(engine.dur.min);
    dur.max = String(engine.dur.max);
    const want = Math.round(+clip.dur || engine.dur.def);
    dur.value = String(Math.max(engine.dur.min, Math.min(engine.dur.max, want)));
    durOut.textContent = dur.value + 's';
  };
  _fitEngine();

  modelSel.addEventListener('change', () => {
    engine = engines.find(e => e.id === modelSel.value) || engines[0];
    _put(LS_ENGINE, engine.id);
    _fitEngine();
  });
  provSel.addEventListener('change', () => _put(LS_PROV(engine.id), provSel.value));

  // Where the per-model parameters land, and where the aggregator and model pickers go above
  // them. Empty until the video provider matrix exists - an empty box rather than dropdowns
  // that would each offer exactly one thing.
  const params = _el('div', 'mv3-anim-params');
  right.appendChild(params);

  // Pushes the prompt to the bottom of the column: it is the last thing written before the
  // button is pressed, so it sits directly above it however much room the parameters take.
  right.appendChild(_el('div', 'mv3-anim-push'));

  const ta = document.createElement('textarea');
  ta.className = 'mv3-anim-prompt';
  ta.rows = 3;
  ta.placeholder = 'How should it move? e.g. slow push in, hair moves in the wind, she blinks once';
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
  go.addEventListener('click', () => _run({ clip, outBox, note, go, cancel, dur, ta, modelSel, provSel, engineOf: () => engine }));
}

// -- The run ----------------------------------------------------------------
async function _run(ui) {
  const { clip, outBox, note, go, cancel, dur, ta, modelSel, provSel, engineOf } = ui;
  const prompt = ta.value.trim();
  if (!prompt) { ta.focus(); ta.classList.add('is-bad'); setTimeout(() => ta.classList.remove('is-bad'), 900); return; }

  // Everything that shaped the job is locked while it runs: the request is already sent, so
  // a slider moved now would describe something other than what is being made.
  const unlock = lockControls([go, dur, ta, modelSel, provSel]);
  note.textContent = '';

  // THE TARGET, BLURRED, WITH THE PROGRESS OVER IT. The result slot fills with the picture
  // being animated rather than a spinner on grey: what is coming is a moving version of
  // exactly that, and showing it says so without a caption.
  outBox.textContent = '';
  outBox.classList.add('is-busy');
  const ghost = document.createElement('img');
  ghost.src = clip.thumb || clip.src;
  ghost.className = 'mv3-anim-ghost';
  outBox.appendChild(ghost);
  const prog = startInlineProgress(outBox, { label: 'Animating\u2026', key: 'mv3-animate', estimateMs: ETA_MS });

  try {
    const start = await fetch('/api/video/animate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        engine: engineOf().id,
        provider: provSel.value,
        prompt,
        imagePath: clip.src,
        params: { duration: parseInt(dur.value, 10) },
      }),
    }).then(r => r.json());
    if (!start || !start.success || !start.taskId) throw new Error((start && start.error) || 'the model refused the job');

    // Every four seconds for twenty minutes. A blip in polling is not a failure - only an
    // explicit `failed` is - because giving up early throws away a job already paid for.
    let videoPath = null;
    for (let i = 0; i < 300; i++) {
      await _sleep(4000);
      const st = await fetch('/api/video/animate/status/' + encodeURIComponent(start.taskId)).then(r => r.json()).catch(() => null);
      if (!st || !st.success) continue;
      if (st.state === 'failed') throw new Error(st.error || 'the model could not make that one');
      if (st.state === 'success' && st.videoPath) { videoPath = st.videoPath; break; }
    }
    if (!videoPath) throw new Error('gave up waiting for the model');

    // A real poster frame before it is filed, so the shelf never has to load the video to
    // draw a 72px card. A failure here costs a thumbnail, not the clip.
    prog.say('making its thumbnail\u2026');
    let thumbPath = null;
    try {
      const t = await fetch('/api/media/thumb', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video: videoPath }),
      }).then(r => r.json());
      if (t && t.success) thumbPath = t.thumbPath || null;
    } catch (e) { /* the sweep will pick it up */ }

    prog.say('filing it\u2026');
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

// -- The result --------------------------------------------------------------
// Into the slot that has been standing there since the window opened, beside the picture it
// came from. The only question worth asking now is whether the movement is the movement that
// was asked for, and that is answered by looking at the two together.
function _showResult(ui, videoPath, thumbPath) {
  const { outBox, note, go, cancel, clip } = ui;
  outBox.classList.remove('is-busy');
  outBox.textContent = '';
  const v = document.createElement('video');
  v.src = videoPath;
  v.controls = true; v.autoplay = true; v.loop = true; v.playsInline = true; v.muted = true;
  if (thumbPath) v.poster = thumbPath;
  outBox.appendChild(v);

  note.textContent = 'saved to Birols / Uncategorized';
  go.textContent = 'Again';
  go.disabled = false;
  go.onclick = () => { closeAnimate(); openAnimate(clip); };
  cancel.textContent = 'Close';
}
