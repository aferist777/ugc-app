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
// Whether a failure is worth a second try - shared with the picture window.
import { canRetry } from './retry.js';
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
function _paramsOf(engine, provider) {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(LS_PARAMS(engine.id)) || '{}') || {}; } catch (e) {}
  const out = {};
  for (const spec of (engine.params || [])) {
    // Same filter as the painter: a value for a field this aggregator does not have would be
    // sent and ignored at best, refused at worst.
    if (spec.only && provider && !spec.only.includes(provider)) continue;
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
  // ── The motion reference ────────────────────────────────────────────────
  // Only for models that ask for one. It is a whole input rather than a setting: a picture
  // and a clip, and the person in the picture does what the person in the clip does.
  //
  // The segment is chosen BEFORE the video is shown. Two handles and a tick, then it plays -
  // and it goes on playing while a generation runs, because watching the movement you asked
  // for is the only useful thing to do during the two minutes it takes.
  const vidSlot = _el('figure', 'mv3-anim-slot is-vid');
  const vidBox = _el('div', 'mv3-anim-vid');
  vidSlot.appendChild(vidBox);
  const vidCap = _el('figcaption', null, 'motion');
  vidSlot.appendChild(vidCap);
  media.appendChild(vidSlot);

  const vidInput = document.createElement('input');
  vidInput.type = 'file';
  vidInput.accept = 'video/*';
  vidInput.hidden = true;
  box.appendChild(vidInput);

  // What has been brought in and what was cut out of it. `ok` is the tick: until it is
  // pressed there is a segment being chosen, not a segment chosen.
  let ref = null;   // { videoPath, thumbPath, duration, w, h, in, out, ok }

  const _segLen = () => (ref && ref.ok ? Math.max(0, ref.out - ref.in) : 0);

  const _paintVid = () => {
    vidBox.textContent = '';
    if (!ref) {
      const b = _el('button', 'mv3-anim-drop', '+ motion clip');
      b.type = 'button';
      b.title = 'A clip of someone moving. The person in your picture will do what they do.';
      b.addEventListener('click', () => vidInput.click());
      vidBox.appendChild(b);
      vidCap.textContent = 'motion';
      return;
    }
    if (ref.busy) {
      vidBox.appendChild(_el('span', 'mv3-anim-ph', ref.busy));
      return;
    }
    const v = document.createElement('video');
    v.src = ref.videoPath;
    v.playsInline = true; v.muted = true; v.loop = true;
    if (ref.thumbPath) v.poster = ref.thumbPath;
    vidBox.appendChild(v);

    if (ref.ok) {
      // Chosen: it plays, and keeps playing through a generation.
      v.controls = true;
      v.currentTime = ref.in;
      v.play().catch(() => {});
      // Hold it inside the segment, so what loops is what was chosen rather than the file.
      v.addEventListener('timeupdate', () => {
        if (v.currentTime >= ref.out - 0.05 || v.currentTime < ref.in - 0.05) {
          try { v.currentTime = ref.in; } catch (e) {}
        }
      });
      const re = _el('button', 'mv3-anim-redo', 'segment');
      re.type = 'button';
      re.title = 'Choose a different stretch of this clip';
      re.addEventListener('click', () => { ref.ok = false; _paintVid(); _paintCost(); });
      vidBox.appendChild(re);
      vidCap.textContent = 'motion \u00b7 ' + _segLen().toFixed(1) + 's';
      return;
    }

    // Choosing. A track with two handles over the clip's own length, and a tick that is only
    // pressable while the segment is one the models will take.
    v.currentTime = ref.in;
    const trim = _el('div', 'mv3-anim-trim');
    const track = _el('div', 'mv3-anim-track');
    const sel = _el('div', 'mv3-anim-seg');
    track.appendChild(sel);
    const hA = _el('i', 'mv3-anim-h a');
    const hB = _el('i', 'mv3-anim-h b');
    track.appendChild(hA); track.appendChild(hB);
    trim.appendChild(track);
    const row = _el('div', 'mv3-anim-trimrow');
    const say = _el('span', 'mv3-anim-triml', '');
    const okB = _el('button', 'mv3-anim-ok', '\u2713');
    okB.type = 'button';
    row.appendChild(say);
    row.appendChild(okB);
    trim.appendChild(row);
    vidBox.appendChild(trim);

    const lim = engine.clip || { min: 3, max: 30 };
    const paint = () => {
      const L = ref.duration || 1;
      sel.style.left = (ref.in / L * 100) + '%';
      sel.style.width = ((ref.out - ref.in) / L * 100) + '%';
      hA.style.left = (ref.in / L * 100) + '%';
      hB.style.left = (ref.out / L * 100) + '%';
      const len = ref.out - ref.in;
      const bad = len < lim.min || len > lim.max;
      say.textContent = len.toFixed(1) + 's' + (bad ? ' \u00b7 needs ' + lim.min + '-' + lim.max + 's' : '');
      say.classList.toggle('is-bad', bad);
      okB.disabled = bad;
      try { v.currentTime = ref.in; } catch (e) {}
    };
    paint();

    const grab = (h, which) => h.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const r = track.getBoundingClientRect();
      const move = (ev) => {
        const t = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) * (ref.duration || 1);
        if (which === 'a') ref.in = Math.min(t, ref.out - 0.2);
        else ref.out = Math.max(t, ref.in + 0.2);
        paint();
      };
      const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
    grab(hA, 'a'); grab(hB, 'b');

    okB.addEventListener('click', () => { ref.ok = true; _paintVid(); _paintCost(); });
    vidCap.textContent = 'motion \u00b7 choose a stretch';
  };

  const _takeVideo = async (file) => {
    if (!file) return;
    ref = { busy: 'reading the clip\u2026' };
    _paintVid();
    try {
      const fd = new FormData();
      fd.append('video', file);
      const d = await fetch('/api/video/reference', { method: 'POST', body: fd }).then(r => r.json());
      if (!d || !d.success) throw new Error((d && d.error) || 'that clip was refused');
      // It lands on the Uploads shelf as it arrives, so the local copy of that store has to
      // learn about it too - see the note on _lsUnshift.
      if (d.item && d.lsKey) _lsUnshift(d.lsKey, d.item);
      const lim = engine.clip || { min: 3, max: 30 };
      ref = {
        videoPath: d.videoPath, thumbPath: d.thumbPath, duration: d.duration, w: d.w, h: d.h,
        in: 0, out: Math.min(d.duration, lim.max), ok: false,
      };
    } catch (e) {
      ref = null;
      alert(e.message);
    }
    _paintVid();
    _paintCost();
  };
  vidInput.addEventListener('change', () => {
    const f = (vidInput.files || [])[0];
    vidInput.value = '';
    _takeVideo(f);
  });
  // Dropping onto the slot, which is the gesture the rest of the app trained for.
  vidBox.addEventListener('dragover', (e) => { e.preventDefault(); vidBox.classList.add('is-over'); });
  vidBox.addEventListener('dragleave', () => vidBox.classList.remove('is-over'));
  vidBox.addEventListener('drop', (e) => {
    e.preventDefault();
    vidBox.classList.remove('is-over');
    _takeVideo((e.dataTransfer.files || [])[0]);
  });

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

  // What this pairing wants and what it will cost. Shown only where there is something to
  // say - a plain image-to-video model needs no instructions and is not priced by the second.
  const guide = _el('div', 'mv3-anim-guide');
  right.appendChild(guide);

  const durRow = _el('div', 'mv3-anim-row');
  durRow.appendChild(_el('span', 'mv3-anim-lbl', 'duration'));
  const dur = document.createElement('input');
  dur.type = 'range';
  dur.step = '1';
  const durOut = _el('span', 'mv3-anim-val', '');
  dur.addEventListener('input', () => { durOut.textContent = dur.value + 's'; _paintCost(); });
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
    values = _paramsOf(engine, provSel.value);
    for (const spec of (engine.params || [])) {
      // A parameter only one aggregator has - background_source is kie's, keep_original_sound
      // is Replicate's - is dropped rather than greyed. Offering a field the chosen provider
      // has no idea about is worse than not offering it.
      if (spec.only && !spec.only.includes(provSel.value)) continue;
      const row = _el('div', 'mv3-anim-row');
      row.appendChild(_el('span', 'mv3-anim-lbl', spec.label || spec.key));
      const write = (v) => { values[spec.key] = v; _saveParams(engine, values); _paintCost(); };
      let ctl;
      if (spec.type === 'toggle') {
        // Rebuilt on change: the toggle reads its own state from the value it was made with,
        // so flipping it needs a new one rather than a mutation of the old.
        ctl = C.toggle(!!values[spec.key], (on) => { write(on); _paintParams(); });
      } else {
        // THE CHOICES CAN DIFFER BY AGGREGATOR, not just the parameter: kie serves a 1080p the
        // Replicate rows have never heard of, and offering it there would be a 422 after the
        // wait. The table says so in optionsBy; this reads it for whoever is chosen.
        const opts = (spec.optionsBy && spec.optionsBy[provSel.value]) || spec.options || [];
        if (!opts.includes(values[spec.key])) {
          values[spec.key] = opts.includes(spec.def) ? spec.def : opts[0];
          _saveParams(engine, values);
        }
        ctl = C.select(opts.map(o => [o, o]), values[spec.key], write);
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

    // A motion-control model has no length to choose - the result is as long as the segment -
    // so the slider is not disabled but absent, and the third slot appears instead.
    durRow.hidden = !engine.dur;
    vidSlot.hidden = !engine.needsVideo;
    if (engine.dur) {
      // THE BOUNDS BELONG TO THE PAIRING. kie takes 6 to 30 seconds for Grok Imagine Video and
      // Replicate takes 1 to 15 - and asking kie for five is answered "Value must be within the
      // specified range", which names no value and no field. The slider is what stops that
      // being possible, so it is refitted whenever the aggregator changes.
      const b = (engine.durBy && engine.durBy[provSel.value]) || engine.dur;
      dur.min = String(b.min);
      dur.max = String(b.max);
      const want = Math.round(+clip.dur || b.def);
      dur.value = String(Math.max(b.min, Math.min(b.max, want)));
      durOut.textContent = dur.value + 's';
    }
    // The exact wording the model's own schema uses for this field, and only for the models
    // that have it - it describes what a prompt does HERE, which is add elements rather than
    // describe the whole shot.
    promptHint.hidden = !engine.needsVideo;
    ta.placeholder = engine.needsVideo
      ? 'Optional'
      : 'How should it move? e.g. slow push in, hair moves in the wind, she blinks once';

    _paintParams();
    // The price depends on the engine as much as the parameters do - which provider serves
    // it, what a second costs there, whether it is sold by the second at all - so refitting
    // the engine reprices too. It was not, and switching to a motion model left the guide
    // blank and hidden. _paintCost is a function declaration, so it is reachable from here
    // even though it is written further down.
    _paintCost();
  };

  // THE PRICE, WHERE IT CAN BE KNOWN. Only the motion-control models are sold by the second,
  // and only once there is a segment to multiply by - so before a clip is chosen this says
  // what to bring rather than a number it would have to invent.
  const MOTION_HINT = 'Bring a clip of someone moving - a dance works well. '
    + 'The person in your picture will perform what they do, one character at a time.';

  // What a second costs on the chosen pairing. `quality` is the motion models' word for it and
  // `resolution` is grok's; both name the same thing, so both are read.
  function _rate() {
    const p = (engine.providers.find(x => x.id === provSel.value) || {}).price;
    if (!p) return null;
    const tier = values.resolution || values.quality;
    const v = (tier != null && p[tier] !== undefined) ? p[tier] : p['720p'];
    return v == null ? null : v;
  }

  // HOW MANY SECONDS ARE BEING PAID FOR: the slider's, for a model that takes a length, and the
  // trimmed segment's for one that takes a clip and matches it.
  function _price() {
    const rate = _rate();
    const len = engine.dur ? (parseInt(dur.value, 10) || engine.dur.def) : _segLen();
    return (rate == null || !len) ? null : rate * len;
  }

  function _paintCost() {
    // THE PRICE LIVES IN THE GUIDE, not on the button. The guide has room for the arithmetic -
    // rate times seconds equals total - and putting the total on the button as well is the
    // same number twice, the second one crowding the one control that has to stay readable at
    // a glance. Nothing about the price changes what pressing it does.
    //
    // EVERY model on this list is sold by the second, so the line is shown for all of them
    // rather than only for the ones that take a clip. A tier nobody has published a rate for
    // says so instead of showing a number it does not have.
    guide.hidden = false;
    guide.textContent = engine.needsVideo ? MOTION_HINT : '';
    const rate = _rate();
    const cost = _price();
    if (rate == null) {
      guide.appendChild(_el('b', null, (engine.needsVideo ? ' · ' : '')
        + 'no published price at this resolution'));
      return;
    }
    if (cost == null) return;
    const len = engine.dur ? (parseInt(dur.value, 10) || engine.dur.def) : _segLen();
    guide.appendChild(_el('b', null, (engine.needsVideo ? ' · ' : '')
      + len.toFixed(1) + 's × $' + rate + '/s = $' + cost.toFixed(2)));
  }


  modelSel.addEventListener('change', () => {
    engine = engines.find(e => e.id === modelSel.value) || engines[0];
    _put(LS_ENGINE, engine.id);
    _fitEngine();
  });
  provSel.addEventListener('change', () => {
    _put(LS_PROV(engine.id), provSel.value);
    // The length allowed is the aggregator's, so the slider is rebuilt with it.
    if (engine.dur) {
      const b = (engine.durBy && engine.durBy[provSel.value]) || engine.dur;
      dur.min = String(b.min);
      dur.max = String(b.max);
      dur.value = String(Math.max(b.min, Math.min(b.max, parseInt(dur.value, 10) || b.def)));
      durOut.textContent = dur.value + 's';
    }
    // Both depend on WHICH aggregator: it decides which parameters exist and what a second
    // costs - 2.6 is cheaper through kie, 3.0 through Replicate.
    _paintParams();
    _paintCost();
  });

  // Pushes the prompt to the bottom of the column: it is the last thing written before the
  // button is pressed, so it sits directly above it however much room the parameters take.
  right.appendChild(_el('div', 'mv3-anim-push'));

  const ta = document.createElement('textarea');
  ta.className = 'mv3-anim-prompt';
  ta.rows = 3;
  right.appendChild(ta);

  // Verbatim from the models' own schema. It says what a prompt is FOR on a motion-control
  // job, which is not what it is for anywhere else in this window.
  const promptHint = _el('div', 'mv3-anim-phint',
    'Text prompt for video generation. You can add elements to the screen and achieve motion '
    + 'effects through prompt words.');
  promptHint.hidden = true;
  right.appendChild(promptHint);

  // ── WHAT IS HAPPENING, STEP BY STEP ──────────────────────────────────────
  // A video is made in two places - the analyst writes the motion prompt, the aggregator draws
  // it - and each can be slow or can fail on its own. One spinner over the lot says only that
  // something is happening; when it stops there is nothing to point at, which is exactly what
  // "internal error and I do not know what died" looked like.
  const steps = _el('div', 'mv3-anim-steps');
  right.appendChild(steps);

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
  // LAST, not where they are defined: between them these two reach the prompt hint, the
  // duration row, the parameters and the Animate button, and the button is built with the
  // footer at the end. Called any earlier they would read a const that does not exist yet.
  _fitEngine();      // reprices on its way through
  _paintVid();

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
        // Remembered so the timeline can point at the shelf record, not only at the file.
        sh.libId = (rec.item && rec.item.id) || null;
        // WHERE IT WAS FILED. Filing moves the file out of media/work into the shelf's folder, and
        // the clip on the timeline belongs at the new address, not the one it was made at.
        if (rec.item && rec.item.videoPath) { sh.videoPath = rec.item.videoPath; sh.thumbPath = rec.item.thumbPath || sh.thumbPath; }
        done++;
      } catch (e) {
        save.textContent = was;
        save.disabled = false;
        alert('Could not save one of them: ' + e.message);
        return;
      }
    }
    // ── THE PICTURE BECOMES THE CLIP ─────────────────────────────────────
    // Animating a still is replacing it: the point was never a second copy somewhere in the
    // library, it was that picture, moving, where the picture was. So the clip opened from a
    // timeline is swapped in place for the FIRST one ticked - same lane, same start, the
    // video's own length - and it is in the library as well, as before.
    //
    // Only when the window was opened from a clip on a timeline; opened from the picture window
    // there is no clip to replace. Each timeline does its own swap, because each has its own
    // rules about what a change of length does to its neighbours - Main closes up behind a
    // shorter clip, a blank project's lanes do not. Imported here, at Save, rather than at the
    // top: the blank timeline imports this file, and a cycle at load is a cycle nobody needs.
    let swapped = '';
    if (clip.id && keep[0]) {
      try {
        const Store = await import('./store.js');
        const T = Store.isBlank() ? await import('./timeline-b.js') : await import('./timeline.js');
        // Its real length and whether it has sound, off the file: the length asked of the model is
        // not always the length it made, and a clip with sound arrives with its sound twin.
        const pr = await fetch('/api/media/probe?src=' + encodeURIComponent(keep[0].videoPath))
          .then(r => r.json()).catch(() => null);
        const ok = T.swapClipMedia(clip.id, {
          src: keep[0].videoPath, thumb: keep[0].thumbPath || null, libId: keep[0].libId || null,
          name: (clip.name || 'animated').slice(0, 90),
          dur: (pr && pr.success && pr.duration > 0) ? pr.duration : keep[0].duration,
          audio: !!(pr && pr.success && pr.audio),
        });
        swapped = ok ? ' — and it has replaced the picture on the timeline'
                     : ' — the timeline could not be changed (the project is not yours to edit)';
      } catch (e) {
        swapped = ' — the timeline could not be changed: ' + e.message;
      }
    }
    note.textContent = done + (done === 1 ? ' clip' : ' clips') + ' saved to Birols / ' + keep[0].engine + swapped;
    // Saved is saved: closing now has nothing to warn about. Unless the swap did not happen -
    // then the window stays open long enough for the sentence saying so to be read.
    if (!clip.id || swapped.startsWith(' — and')) closeAnimate(true);
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
    clip, outBox, note, steps, go, cancel, save, dur, ta, modelSel, provSel, params,
    engineOf: () => engine, valuesOf: () => values, refOf: () => ref,
    onShot: (sh) => { _shots.push(sh); _showShot(_shots.length - 1); _paintSave(); },
  }));
}

// -- The run ----------------------------------------------------------------
// One line per thing happening somewhere else: turning while it runs, ticked when it is done
// with what it actually did, red with the reason when it is not. A failed line keeps a Retry
// beside it only when trying again could end differently - see retry.js.
function _steps(host) {
  host.textContent = '';
  return {
    add(text) {
      const row = _el('div', 'mv3-anim-step is-run');
      const mark = _el('i');
      const label = _el('span', null, text);
      row.appendChild(mark);
      row.appendChild(label);
      host.appendChild(row);
      const h = {
        say(t) { label.textContent = t; return h; },
        done(t) { row.className = 'mv3-anim-step is-done'; if (t) label.textContent = t; return h; },
        fail(t, again) {
          row.className = 'mv3-anim-step is-bad';
          label.textContent = t;
          if (again) {
            const b = _el('button', 'mv3-anim-retry', 'Retry');
            b.type = 'button';
            b.title = 'Try this step again. The prompt that was already written is kept.';
            b.addEventListener('click', () => { b.disabled = true; again(); });
            row.appendChild(b);
          }
          return h;
        },
      };
      return h;
    },
  };
}

/**
 * @param opts.prompt  a motion prompt already written, for a Retry: the analyst is not asked
 *                     again, because what it wrote is not what failed and it is not free.
 */
async function _run(ui, opts) {
  const { clip, outBox, note, steps: stepHost, go, cancel, save, dur, ta, modelSel, provSel, params,
          engineOf, valuesOf, refOf, onShot } = ui;
  const said = ta.value.trim();
  const eng = engineOf();
  if (!said && !eng.promptOptional) {
    ta.focus(); ta.classList.add('is-bad'); setTimeout(() => ta.classList.remove('is-bad'), 900);
    return;
  }
  // The clip is an input, not a setting: without it there is nothing for these models to copy.
  const refNow = refOf();
  if (eng.needsVideo && !(refNow && refNow.ok)) {
    alert('Add a motion clip and choose a stretch of it first.');
    return;
  }

  // Everything that shaped the job is locked while it runs: the request is already sent, so
  // a slider moved now would describe something other than what is being made.
  // Cancel among them now. It used to stay live as the way out, but the way out of a running
  // job is not a button: the job finishes whether or not this window watches it, and pressing
  // Cancel mid-flight only loses the filing of a clip already paid for. Nothing here is
  // pressable until it lands or fails.
  const unlock = lockControls([go, save, cancel, dur, ta, modelSel, provSel,
    ...params.querySelectorAll('select, button')]);
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

  // ── 1. the analyst ─────────────────────────────────────────────────
  // The picture and the sentence go for reading, translating and tidying BEFORE anything is
  // spent on a video: these models read English, and a Russian sentence sent as typed is a
  // video of something adjacent. A Retry arrives with the prompt already written and skips
  // this - what it wrote is not what failed, and it is not free.
  const log = _steps(stepHost);
  let prompt = (opts && opts.prompt) || '';
  let writer = (opts && opts.writer) || '';
  if (!prompt) {
    const st = log.add('Sent to the analyst — your words and the picture…');
    prog.say('reading your words and the picture…');
    try {
      const d = await fetch('/api/video/think', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: said, imagePath: clip.src }),
      }).then(r => r.json());
      if (d && d.success && d.prompt) {
        prompt = d.prompt;
        writer = d.writer || '';
        if (d.fell) st.fail('The analyst did not answer — sending your words as typed. ' + d.fell, null);
        else st.done('Motion prompt written' + (writer ? ' by ' + writer : '') + '.');
      } else {
        prompt = said;
        st.fail('The analyst refused — sending your words as typed. '
          + String((d && d.error) || '').slice(0, 140), null);
      }
    } catch (err) {
      prompt = said;
      st.fail('The analyst could not be reached — sending your words as typed.', null);
    }
  } else {
    log.add('Motion prompt kept from the last attempt.').done();
  }

  // ── 2. the asking, then 3. the drawing ───────────────────────────────
  const again = () => _run(ui, { prompt, writer });
  const asking = log.add('Asking ' + ((provSel.options[provSel.selectedIndex] || {}).text || 'the model')
    + ' for ' + (eng.dur ? parseInt(dur.value, 10) + ' seconds' : 'a clip') + '…');
  prog.say('asking ' + ((provSel.options[provSel.selectedIndex] || {}).text || 'the model') + '…');

  try {
    const start = await fetch('/api/video/animate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        engine: eng.id,
        provider: provSel.value,
        // The WRITTEN prompt, not what was typed: the analyst's answer is the thing these
        // models were meant to read. What was typed is kept beside it on the record.
        prompt,
        said,
        imagePath: clip.src,
        ...(refNow ? { videoPath: refNow.videoPath, videoIn: refNow.in, videoOut: refNow.out } : {}),
        params: { ...valuesOf(), duration: parseInt(dur.value, 10) },
      }),
    }).then(r => r.json());
    if (!start || !start.success || !start.taskId) throw new Error((start && start.error) || 'the model refused the job');
    asking.done('Sent — the model is drawing it.');
    const drawing = log.add('Drawing…');

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
    drawing.done('The clip is back.');

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
      duration: eng.dur ? parseInt(dur.value, 10) : Math.round((refNow.out - refNow.in) * 10) / 10,
      keep: false, saved: false,
    });
    unlock();
    // Another attempt is the usual next move once you have looked at one - the same prompt
    // with a word changed - so everything goes straight back to being pressable.
    note.textContent = 'tick the ones to keep, then Save';
  } catch (e) {
    // THE AGGREGATOR'S OWN WORDS, not ours. "Internal Error, Please try again later." is kie
    // saying its upstream fell over, and that is exactly the sentence worth showing - along
    // with a Retry, because that one genuinely can end differently. A refusal gets no button.
    const why = String((e && e.message) || e).slice(0, 300);
    const last = stepHost.lastElementChild;
    const line = 'Could not be made: ' + why;
    if (last && last.classList.contains('is-run')) {
      // whichever step was still running is the one that died
      last.className = 'mv3-anim-step is-bad';
      const label = last.querySelector('span');
      if (label) label.textContent = line;
      if (canRetry(why)) {
        const b = _el('button', 'mv3-anim-retry', 'Retry');
        b.type = 'button';
        b.title = 'Try again with the same prompt. The analyst is not asked a second time.';
        b.addEventListener('click', () => { b.disabled = true; again(); });
        last.appendChild(b);
      }
    } else {
      log.add('').fail(line, canRetry(why) ? again : null);
    }
    prog.fail(why.slice(0, 160));
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
