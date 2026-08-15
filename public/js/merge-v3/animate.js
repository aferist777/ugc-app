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

   NOTHING IS FILED UNTIL SAVE. A run makes a clip and puts it in the strip along the
   bottom - the session's attempts, side by side - and the ones ticked there are the
   ones that reach the library. Generating four and keeping one is the normal shape of
   this work, and filing all four would make the library the place you go to delete
   things.

   THE PICTURE IS NOT CONSUMED. What is saved is a new birol; the still stays in the
   library exactly as it was, and `refImage` on the birol record ties the two together
   so the viewer can show a clip beside the frame it grew out of.

   Each engine gets a category of its own, by name. Which model made a clip is the one
   thing you cannot see by looking at it, and it is what you sort by when a model turns
   out to be the good one.

   WHICH ENGINE AND WHICH AGGREGATOR ARE TWO CHOICES, as they are for pictures on the
   Character page. They fail separately - the day Replicate rate-limited one model, the
   same model answered fine through another aggregator - so the matrix that pairs them
   lives in lib/video-providers.js and this window only draws what it is handed. A pairing
   that would fail at submit time cannot be offered, because it is not in the table.
   ═══════════════════════════════════════════════════════════════════════════ */

import { startInlineProgress, lockControls } from '../progress.js';
import * as C from './controls.js';

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

// PARAMETERS BELONG TO THE MODEL, not to the clip. Set grok's mode once and it is grok's mode
// everywhere; on a clip it would be state outliving the generation it described, and two
// clips made from one picture could disagree about what was sent.
//
// A namespace of its own rather than Birols' engine_params__v1__* : that store is keyed by
// kie model names (grok-imagine/image-to-video) where this one is keyed by matrix ids
// (grok-imagine), and its specs differ - duration is a parameter there and a slider here.
// Two writers with different vocabularies into one key is how a saved value comes back
// meaning something else.
const LS_PARAMS = (id) => 'mv3_anim_params__' + id;

// The stored values for an engine, filled in from its spec wherever nothing was saved. Reading
// through the spec rather than trusting the store means a parameter dropped from a model stops
// being sent the moment it leaves the table.
function _paramsOf(engine) {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(LS_PARAMS(engine.id)) || '{}') || {}; } catch (e) {}
  const out = {};
  for (const spec of (engine.params || [])) {
    const v = saved[spec.key];
    if (spec.type === 'toggle') out[spec.key] = (typeof v === 'boolean') ? v : !!spec.def;
    else out[spec.key] = (spec.options && spec.options.includes(v)) ? v : spec.def;
  }
  return out;
}

function _saveParams(engine, values) { _put(LS_PARAMS(engine.id), JSON.stringify(values)); }

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

// The session's attempts. Cleared when the window closes: it is a working set, not a
// history - what survives is whatever was ticked and saved into the library.
let _shots = [];
const _kept = () => _shots.filter(s => s.keep);

export async function closeAnimate(force) {
  if (!_open) return;
  // Leaving with attempts on the strip and none of them ticked throws away work that was
  // paid for, so it is worth one question. Only when nothing is ticked: having chosen some
  // is an answer, and asking again would be nagging.
  if (!force && _shots.length && !_kept().length) {
    const ok = confirm(_shots.length === 1
      ? 'Nothing is ticked, so this clip will not be saved to the library. Close anyway?'
      : 'Nothing is ticked, so none of these ' + _shots.length + ' clips will be saved. Close anyway?');
    if (!ok) return;
  }
  // A generation that is running is deliberately NOT cancelled here: the job is already
  // paid for, and Replicate will finish it whether or not this window is watching.
  document.removeEventListener('keydown', _open.key, true);
  try { _open.ov.remove(); } catch (e) {}
  _open = null;
  const had = _shots.length;
  _shots = [];
  // Straight to where the clips went. Even with nothing saved this is the right place to
  // land: it is the shelf this window feeds.
  if (had) {
    try { const L = await import('./library.js'); await L.showGroup('birols'); } catch (e) {}
  }
}

export async function openAnimate(clip) {
  if (!clip || !clip.src) return;
  await closeAnimate(true);
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

  const mediaCol = _el('div', 'mv3-anim-mediacol');
  mediaCol.appendChild(media);

  // THE SESSION'S ATTEMPTS, under the frames and exactly as wide as the pair of them: the
  // strip belongs to the media half of the window, not to the form, so it lines up with the
  // reference on the left and the result on the right.
  const strip = _el('div', 'mv3-anim-strip');
  mediaCol.appendChild(strip);
  body.appendChild(mediaCol);

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

  // The chosen model's own parameters, drawn from the spec the matrix ships with it. A model
  // that has no such control cannot have it drawn, which is the whole point of the parameters
  // travelling with the engine rather than being a fixed list here.
  const params = _el('div', 'mv3-anim-params');
  right.appendChild(params);

  let values = {};
  const _paintParams = () => {
    params.textContent = '';
    values = _paramsOf(engine);
    for (const spec of (engine.params || [])) {
      const row = _el('div', 'mv3-anim-row');
      row.appendChild(_el('span', 'mv3-anim-lbl', spec.label || spec.key));
      const write = (v) => { values[spec.key] = v; _saveParams(engine, values); };
      let ctl;
      if (spec.type === 'toggle') {
        // Rebuilt on change: the toggle reads its own state from the value it was made with,
        // so flipping it needs a new one rather than a mutation of the old.
        ctl = C.toggle(!!values[spec.key], (on) => { write(on); _paintParams(); });
      } else {
        ctl = C.select((spec.options || []).map(o => [o, o]), values[spec.key], write);
      }
      ctl.title = spec.hint || spec.label || spec.key;
      ctl.classList.add('mv3-anim-pctl');
      row.appendChild(ctl);
      params.appendChild(row);
    }
  };

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

    _paintParams();
  };

  _fitEngine();

  modelSel.addEventListener('change', () => {
    engine = engines.find(e => e.id === modelSel.value) || engines[0];
    _put(LS_ENGINE, engine.id);
    _fitEngine();
  });
  provSel.addEventListener('change', () => _put(LS_PROV(engine.id), provSel.value));

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
  // Between the two on purpose: it is the middle of the three in meaning as well - throw
  // away, keep, make another.
  const save = _el('button', 'mv3-c-btn mv3-anim-save', 'Save');
  save.type = 'button';
  save.disabled = true;
  const go = _el('button', 'mv3-c-btn mv3-anim-go', 'Animate');
  go.type = 'button';
  foot.appendChild(cancel);
  foot.appendChild(save);
  foot.appendChild(go);
  box.appendChild(foot);

  // Which attempt the result slot is showing. -1 while nothing has been made.
  let shown = -1;

  const _showShot = (i) => {
    const sh = _shots[i];
    if (!sh) return;
    shown = i;
    outBox.classList.remove('is-busy');
    outBox.textContent = '';
    const v = document.createElement('video');
    v.src = sh.videoPath;
    v.controls = true; v.autoplay = true; v.loop = true; v.playsInline = true; v.muted = true;
    if (sh.thumbPath) v.poster = sh.thumbPath;
    outBox.appendChild(v);
    _paintStrip();
  };

  const _paintSave = () => {
    const n = _kept().length;
    save.textContent = n ? 'Save ' + n : 'Save';
    save.disabled = !n;
  };

  function _paintStrip() {
    strip.textContent = '';
    strip.hidden = !_shots.length;
    _shots.forEach((sh, i) => {
      const cell = _el('button', 'mv3-anim-cell' + (i === shown ? ' is-on' : '') + (sh.keep ? ' is-keep' : ''));
      cell.type = 'button';
      cell.title = sh.engine + ' \u00b7 ' + sh.duration + 's\n' + (sh.prompt || '');
      if (sh.thumbPath) {
        const im = document.createElement('img');
        im.src = sh.thumbPath;
        cell.appendChild(im);
      } else {
        cell.appendChild(_el('span', 'mv3-anim-cell-n', String(i + 1)));
      }
      // The tick, top right. A button inside a button is not allowed, so it is a span that
      // stops the click from reaching the cell underneath.
      const tick = _el('span', 'mv3-anim-tick', sh.keep ? '\u2713' : '');
      tick.title = sh.keep ? 'Ticked to save' : 'Tick to save this one';
      tick.addEventListener('click', (e) => {
        e.stopPropagation();
        sh.keep = !sh.keep;
        _paintStrip();
        _paintSave();
      });
      cell.appendChild(tick);
      cell.addEventListener('click', () => _showShot(i));
      strip.appendChild(cell);
    });
  }
  _paintStrip();
  _paintSave();

  // Files the ticked ones, each under a category named after the model that made it. The
  // record endpoint takes the NAME and resolves it - LC.add hands back the existing chip
  // rather than making a second one - so this does not have to know whether it exists.
  const _save = async () => {
    const keep = _kept();
    if (!keep.length) return;
    save.disabled = true;
    const was = save.textContent;
    let done = 0;
    for (const sh of keep) {
      if (sh.saved) { done++; continue; }
      save.textContent = 'Saving ' + (done + 1) + '/' + keep.length + '\u2026';
      try {
        const rec = await fetch('/api/library/media/record', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            videoPath: sh.videoPath, thumbPath: sh.thumbPath, kind: 'birols',
            name: (clip.name || 'animated').slice(0, 90),
            categoryLabel: sh.engine,
            refImage: clip.src,
            prompt: sh.prompt,
          }),
        }).then(r => r.json());
        if (!rec || !rec.success) throw new Error((rec && rec.error) || 'refused');
        // The birol archive is browser-owned - biroly-server-sync pushes localStorage up
        // every couple of seconds - so the local copy has to learn about this too, or the
        // next push would erase the record the server just wrote.
        _lsUnshift(rec.lsKey, rec.item);
        sh.saved = true;
        done++;
      } catch (e) {
        save.textContent = was;
        save.disabled = false;
        alert('Could not save one of them: ' + e.message);
        return;
      }
    }
    note.textContent = done + (done === 1 ? ' clip' : ' clips') + ' saved to Birols / ' + keep[0].engine;
    // Saved is saved: closing now has nothing to warn about.
    closeAnimate(true);
  };
  save.addEventListener('click', _save);

  ov.appendChild(box);
  document.body.appendChild(ov);

  const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); closeAnimate(); } };
  document.addEventListener('keydown', key, true);
  _open = { ov, key };

  x.addEventListener('click', () => closeAnimate());
  cancel.addEventListener('click', () => closeAnimate());
  // Clicking the dimmed surround closes, clicking the panel does not.
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) closeAnimate(); });

  ta.focus();
  go.addEventListener('click', () => _run({
    clip, outBox, note, go, cancel, save, dur, ta, modelSel, provSel, params,
    engineOf: () => engine, valuesOf: () => values,
    onShot: (sh) => { _shots.push(sh); _showShot(_shots.length - 1); _paintSave(); },
  }));
}

// -- The run ----------------------------------------------------------------
async function _run(ui) {
  const { clip, outBox, note, go, cancel, save, dur, ta, modelSel, provSel, params, engineOf, valuesOf, onShot } = ui;
  const prompt = ta.value.trim();
  if (!prompt) { ta.focus(); ta.classList.add('is-bad'); setTimeout(() => ta.classList.remove('is-bad'), 900); return; }

  // Everything that shaped the job is locked while it runs: the request is already sent, so
  // a slider moved now would describe something other than what is being made.
  const unlock = lockControls([go, save, dur, ta, modelSel, provSel, ...params.querySelectorAll('select, button')]);
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
        params: { ...valuesOf(), duration: parseInt(dur.value, 10) },
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

    prog.finish();
    // ONTO THE STRIP, NOT INTO THE LIBRARY. Which of the session's attempts are worth keeping
    // is a judgement made after seeing them, and filing every one would turn the library into
    // the place you go to delete things.
    onShot({
      videoPath, thumbPath, prompt,
      engine: engineOf().id, provider: provSel.value,
      duration: parseInt(dur.value, 10),
      keep: false, saved: false,
    });
    unlock();
    // Another attempt is the usual next move once you have looked at one - the same prompt
    // with a word changed - so everything goes straight back to being pressable.
    note.textContent = 'tick the ones to keep, then Save';
  } catch (e) {
    prog.fail(e.message);
    unlock();
  }
}

// The birol archive lives in localStorage as well as on the server: biroly-server-sync pushes
// the local copy up every couple of seconds, so a record written only on the server would be
// erased by the next push.
function _lsUnshift(key, item) {
  if (!key || !item) return;
  try {
    const raw = localStorage.getItem(key);
    const list = raw ? JSON.parse(raw) : [];
    if (Array.isArray(list)) { list.unshift(item); localStorage.setItem(key, JSON.stringify(list)); }
  } catch (e) {}
}
