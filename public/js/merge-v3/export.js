/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — export. The dialog is the old editor's, the payload is built from the
   v3 store.

   THE PIPELINE IS UNCHANGED. POST /api/ffmpeg/render is the same endpoint the old
   Merge called, and the body it wants is exactly what js/mergev2-render.js used to
   assemble out of timeline_data_v2. This file assembles the same body out of the
   project store instead. Every field name below was read off that builder and off
   routes/ffmpeg.js - none of it is guessed, because a renamed field here would be a
   setting the render silently ignores.

   Three shapes matter:
     segmentClips  Main. The source in-point is `crop`, NOT trimIn (the backend turns
                   it into -ss). Carries the line as `name`, which is also what the
                   burned subtitles are made of.
     clips         Hooks then birols, in stacking order - see the comment at the list.
                   In-point is `trimIn`.
     halferClips   Same as clips plus halferAlign / rotation / valign.

   TWO HONEST GAPS, both stated here rather than discovered in a render:
     • `angle` - the free rotation you can drag on the preview - has no equivalent in
       the ffmpeg overlay path. It is previewed and NOT exported. The quarter-turn
       `rotation` on halfers is exported, because the pipeline has always known it.
     • reversed is exported (ffmpeg can do it) even though the preview cannot show it.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as Store from './store.js';
import * as Subs from './subtitles.js';

// Read off scen-birolys.js. Same values, so a project exported from either editor
// comes out the same.
const ADV_DEFAULTS = {
  resolution: '1080x1920',
  fps: 30,
  crf: 23,
  preset: 'fast',
  audioBitrate: '192k',
  eqBrightness: 0,
  eqContrast: 1,
  eqSaturation: 1,
  eqGamma: 1,
  // OFF. The scenario-line path burns with drawtext, which does not wrap: a 120-character
  // line at 48px is ~2800px wide on a 720px frame, so only its middle was visible - and
  // ten chained instances also left a band of overlapping text at the top of the frame.
  // Measured both, then measured them gone with this false. Subtitles get done properly
  // through libass, which wraps and styles, and that is its own step.
  subsEnabled: false,
  // Applied to the FINISHED video, after the captions are burned in, so the words speed up
  // with the picture they belong to instead of drifting off the mouth.
  playbackSpeed: 1,
  subsFontSize: 48,
  subsPosition: 'bottom',
  subsColor: '#ffffff',
  subsStyle: 'outline',
  extra1: 'none',
  extra2: 'none',
  extra3: 'none',
};

let _job = null;        // { id, started, poll }
let _modal = null;
let _adv = { ...ADV_DEFAULTS };

// ── The payload ─────────────────────────────────────────────────────────────
const _num = (v, d) => (v == null || isNaN(+v)) ? d : +v;

// Effective volume, the same cascade the inspector shows and the preview obeys.
const VOL_DEFAULT = { seg: 1, biro: 0, hook: 0, halfer: 0, music: 0.5 };
function _vol(c, track, scope) {
  if (c.volume != null) return +c.volume;
  if (track && track.volume != null) return +track.volume;
  return VOL_DEFAULT[scope];
}

// Only the keys that are actually set, so an untouched clip adds nothing to the body -
// exactly how the old builder behaved.
function _fx(c) {
  const o = {};
  if (c.transition && c.transition !== 'none') { o.transition = c.transition; o.transitionParams = {}; }
  if (c.animation && c.animation !== 'none') { o.animation = c.animation; o.animParams = {}; }
  if (c.filter && c.filter !== 'none') { o.filter = c.filter; o.filterParams = {}; }
  return o;
}
function _tf(c) {
  if (c.tw == null) return {};
  return {
    tx: Math.max(0, Math.min(1, _num(c.tx, 0))),
    ty: Math.max(0, Math.min(1, _num(c.ty, 0))),
    tw: Math.max(0.02, Math.min(1, _num(c.tw, 1))),
  };
}

function _overlay(c, track, scope) {
  const vol = _vol(c, track, scope);
  return {
    videoPath: c.src,
    name: c.name || (scope === 'hook' ? 'Hook' : scope === 'halfer' ? 'Halfer' : 'Birol'),
    start: _num(c.start, 0),
    end: _num(c.start, 0) + _num(c.dur, 0),
    trimIn: _num(c.trimIn, 0),
    crop: 0,
    speed: _num(c.speed, 1),
    cropAlign: c.cropAlign || 'center',
    reversed: !!c.reversed,
    // The levelling measured at import. Rides beside volume rather than inside it, so a
    // slider the user moves never erases a measurement and vice versa.
    gainDb: +c.gainDb || 0,
    // The pipeline still takes a boolean as well as a level. Silence is volume 0, so the
    // flag is derived from it rather than stored - one control, as in the inspector.
    audio: vol > 0,
    volume: vol,
    ..._fx(c), ..._tf(c),
  };
}

export function buildPayload(adv) {
  const tl = Store.timeline();
  if (!tl) return null;
  const T = tl.tracks;

  // A Main clip with a POSTER is a read and a still, not a video: the source is the mp3 and
  // the picture is the fragment's first frame. The pipeline has always had a voiceOnly
  // segment - it used to mean "voice over black" - so this is the shape it already knows,
  // with the still handed to it as the video path.
  const segmentClips = (T.seg.clips || []).slice().sort((a, b) => a.start - b.start).map(c => ({
    name: c.name || '',
    videoPath: c.poster || c.src,
    audioPath: c.poster ? c.src : null,
    voiceOnly: !!c.poster,
    start: _num(c.start, 0),
    end: _num(c.start, 0) + _num(c.dur, 0),
    // Main's in-point is `crop`. Named that way in the pipeline since before this editor;
    // sending trimIn here would start every fragment from its own beginning.
    crop: _num(c.trimIn, 0),
    speed: _num(c.speed, 1),
    reversed: !!c.reversed,
    ..._fx(c),
  }));

  // THE ORDER HERE IS THE STACKING ORDER. The renderer overlays these one onto the last,
  // so whatever comes last in this list is what shows where two of them meet - and this
  // used to be sorted by start, which meant the later clip won regardless of track. The
  // preview has always drawn Hooks first and Birols over them, so a hook overlapping a
  // birol was composited one way on screen and the other way in the file.
  //
  // Hooks first, then Birols, each in the order the timeline holds them: the same rule the
  // preview draws by, so the render is what was watched. No sorting at all now - clips on
  // these lanes may cover one another, and their order is what says which one shows.
  const clips = [
    ...(T.hook.clips || []).map(c => _overlay(c, T.hook, 'hook')),
    ...(T.biro.clips || []).map(c => _overlay(c, T.biro, 'biro')),
  ];

  const halferClips = (T.halfer.clips || []).map(c => {
    const o = _overlay(c, T.halfer, 'halfer');
    o.halferAlign = c.halferAlign || 'top';
    o.rotation = (c.rotation != null) ? (parseInt(c.rotation, 10) || 0) : 90;
    o.valign = c.valign || 'top';
    // A halfer band takes no effects - the renderer ignores them, and the inspector does
    // not offer them either.
    delete o.transition; delete o.transitionParams;
    delete o.animation; delete o.animParams;
    delete o.filter; delete o.filterParams;
    delete o.tx; delete o.ty; delete o.tw;
    return o;
  });

  const musicClips = (T.music.clips || []).map(c => ({
    url: c.src,
    start: _num(c.start, 0),
    end: _num(c.start, 0) + _num(c.dur, 0),
    speed: _num(c.speed, 1),
    volume: _vol(c, T.music, 'music'),
  }));

  // Subtitles go through libass, built from the subs track in the render's own coordinates -
  // so they need the output size, not the preview's. subsEnabled stays false: that flag is
  // the OTHER path, the scenario-line drawtext chain, and it is the one that cannot wrap.
  const [pw, ph] = String(adv && adv.resolution || '1080x1920').split('x').map(v => parseInt(v, 10));
  const subs = Subs.renderPayload(pw || 1080, ph || 1920);

  return {
    segmentClips, clips, halferClips, musicClips,
    // Track-level defaults. The per-clip values above already carry whatever the stamp
    // wrote, so these are the fallback for anything that has none.
    segVolume: T.seg.volume != null ? +T.seg.volume : 1,
    segTransition: T.seg.transition || 'none', segTransitionParams: {},
    segAnimation: T.seg.animation || 'none', segAnimParams: {},
    segFilter: T.seg.filter || 'none', segFilterParams: {},
    segSfx: 'Нет', segSfxVolume: 0.8,
    biroTransition: T.biro.transition || 'none', biroTransitionParams: {},
    biroAnimation: T.biro.animation || 'none', biroAnimParams: {},
    biroFilter: T.biro.filter || 'none', biroFilterParams: {},
    biroSfx: 'Нет', biroSfxVolume: 0.8,
    outputLabel: Store.title() || 'merge',
    advSettings: adv,
    subtitles: [],
    srtSubtitles: subs.srtSubtitles,
    // Deliberately empty: raw words would make the builder re-group them into captions of
    // its own, discarding the ones on the timeline.
    srtWords: [],
    assSettings: subs.assSettings,
    prebuiltAssPath: null,
    smartCopy: false,
  };
}

// ── The dialog ──────────────────────────────────────────────────────────────
function _el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function _hdr(t) { return _el('div', 'mv3-x-hdr', t); }

function _row(label, control) {
  const r = _el('div', 'mv3-x-row');
  r.appendChild(_el('label', null, label));
  r.appendChild(control);
  return r;
}
function _select(opts, value) {
  const s = document.createElement('select');
  for (const [v, l] of opts) {
    const o = document.createElement('option');
    o.value = String(v); o.textContent = l;
    s.appendChild(o);
  }
  s.value = String(value);
  return s;
}
function _slider(min, max, step, value, fmt) {
  const wrap = _el('span', 'mv3-x-sl');
  const i = document.createElement('input');
  i.type = 'range'; i.min = String(min); i.max = String(max); i.step = String(step); i.value = String(value);
  const out = _el('span', 'mv3-x-slv', fmt(+value));
  i.addEventListener('input', () => { out.textContent = fmt(+i.value); });
  wrap.appendChild(i); wrap.appendChild(out);
  wrap._input = i;
  return wrap;
}

function _close() {
  if (!_modal) return;
  _modal.remove();
  _modal = null;
  document.removeEventListener('keydown', _key);
}
function _key(e) { if (e.key === 'Escape' && !_job) { e.preventDefault(); _close(); } }

export function openExport() {
  if (_modal) return;
  const tl = Store.timeline();
  if (!tl) return;
  const adv = { ...ADV_DEFAULTS, ..._adv };

  const ov = _el('div', 'mv3-x-ov');
  const box = _el('div', 'mv3-x');
  const head = _el('div', 'mv3-x-head');
  head.appendChild(_el('h3', null, 'FFmpeg settings'));
  const x = _el('button', 'mv3-x-close', '✕');
  x.type = 'button';
  x.addEventListener('click', _close);
  head.appendChild(x);
  box.appendChild(head);

  const body = _el('div', 'mv3-x-body');

  // What is actually about to be rendered. The old dialog did not say, and "why is my
  // export 12 seconds" is a question worth answering before the render, not after.
  const n = {
    main: (tl.tracks.seg.clips || []).length,
    over: (tl.tracks.biro.clips || []).length + (tl.tracks.hook.clips || []).length,
    half: (tl.tracks.halfer.clips || []).length,
    music: (tl.tracks.music.clips || []).length,
  };
  const sum = _el('div', 'mv3-x-sum');
  sum.textContent = `${n.main} main · ${n.over} overlays · ${n.half} halfers · ${n.music} music · `
    + (Math.round(Store.duration() * 10) / 10) + 's';
  body.appendChild(sum);

  body.appendChild(_hdr('Video'));
  const res = _select([['1080x1920', '1080×1920 (vertical 9:16)'], ['720x1280', '720×1280 (compact 9:16)'], ['1920x1080', '1920×1080 (horizontal 16:9)']], adv.resolution);
  body.appendChild(_row('Resolution', res));
  const fps = _select([[24, '24 fps'], [30, '30 fps'], [60, '60 fps']], adv.fps);
  body.appendChild(_row('FPS', fps));
  const crf = _slider(14, 35, 1, adv.crf, v => v.toFixed(0));
  body.appendChild(_row('Quality (CRF)', crf));
  const preset = _select([['ultrafast', 'ultrafast (fast, large file)'], ['veryfast', 'veryfast'], ['fast', 'fast (balanced)'], ['medium', 'medium'], ['slow', 'slow (slow, small file)']], adv.preset);
  body.appendChild(_row('Encoding preset', preset));

  // Speed is a LAST pass over the finished file, which is why it lives here and not on the
  // timeline: by then the captions are part of the picture and stretch with it. The voice
  // keeps its pitch.
  const spd = _slider(0.5, 2, 0.05, adv.playbackSpeed, v => v.toFixed(2) + 'x');
  body.appendChild(_row('Playback speed', spd));
  const spdNote = _el('div', 'mv3-x-note');
  const _showSpd = () => {
    const v = parseFloat(spd._input.value) || 1;
    const out = Store.duration() / v;
    spdNote.textContent = Math.abs(v - 1) < 0.001
      ? 'Rendered as edited.'
      : `Whole video and its subtitles at ${v.toFixed(2)}x - `
        + `${(Math.round(Store.duration() * 10) / 10)}s becomes ${(Math.round(out * 10) / 10)}s. Voice keeps its pitch.`;
  };
  _showSpd();
  spd._input.addEventListener('input', _showSpd);
  body.appendChild(spdNote);

  body.appendChild(_hdr('Audio'));
  const ab = _select([['128k', '128 kbps'], ['192k', '192 kbps'], ['320k', '320 kbps']], adv.audioBitrate);
  body.appendChild(_row('Audio bitrate', ab));

  body.appendChild(_hdr('Colour correction'));
  const br = _slider(-0.5, 0.5, 0.02, adv.eqBrightness, v => v.toFixed(2));
  body.appendChild(_row('Brightness', br));
  const ct = _slider(0.5, 1.5, 0.05, adv.eqContrast, v => v.toFixed(2));
  body.appendChild(_row('Contrast', ct));
  const sa = _slider(0, 2, 0.05, adv.eqSaturation, v => v.toFixed(2));
  body.appendChild(_row('Saturation', sa));
  const ga = _slider(0.5, 2, 0.05, adv.eqGamma, v => v.toFixed(2));
  body.appendChild(_row('Gamma (exposure)', ga));

  body.appendChild(_hdr('Extras'));
  const e1 = _select([['none', '— none —'], ['black5', '+ Black tail 5 min'], ['black10', '+ Black tail 10 min'], ['black20', '+ Black tail 20 min'], ['black30', '+ Black tail 30 min']], adv.extra1);
  body.appendChild(_row('Extras 1', e1));
  const noises = [['none', '— none —']];
  for (const kind of ['white', 'pink', 'brown']) for (let i = 1; i <= 5; i++) noises.push(['wn_' + kind + '_' + i, '+ ' + kind[0].toUpperCase() + kind.slice(1) + ' noise ' + i + '%']);
  const e2 = _select(noises, adv.extra2);
  body.appendChild(_row('Extras 2', e2));

  box.appendChild(body);

  const foot = _el('div', 'mv3-x-foot');
  const prog = _el('div', 'mv3-x-prog');
  foot.appendChild(prog);
  const apply = _el('button', 'mv3-c-btn', 'Apply');
  apply.type = 'button';
  const cancel = _el('button', 'mv3-c-btn', 'Cancel');
  cancel.type = 'button';
  cancel.addEventListener('click', _close);
  const render = _el('button', 'mv3-c-btn mv3-x-go', 'Render');
  render.type = 'button';
  foot.appendChild(apply); foot.appendChild(cancel); foot.appendChild(render);
  box.appendChild(foot);

  const collect = () => ({
    resolution: res.value,
    fps: parseInt(fps.value, 10),
    crf: parseInt(crf._input.value, 10),
    preset: preset.value,
    audioBitrate: ab.value,
    eqBrightness: parseFloat(br._input.value),
    eqContrast: parseFloat(ct._input.value),
    eqSaturation: parseFloat(sa._input.value),
    eqGamma: parseFloat(ga._input.value),
    playbackSpeed: parseFloat(spd._input.value) || 1,
    // Kept in the object because routes/ffmpeg.js destructures them, but not settable here:
    // this flag is the scenario-line drawtext chain, not the libass path the subs track uses.
    subsEnabled: false,
    subsFontSize: ADV_DEFAULTS.subsFontSize,
    subsPosition: ADV_DEFAULTS.subsPosition,
    subsColor: ADV_DEFAULTS.subsColor,
    subsStyle: ADV_DEFAULTS.subsStyle,
    extra1: e1.value,
    extra2: e2.value,
    extra3: 'none',
  });

  const save = async () => {
    _adv = collect();
    try {
      await fetch('/api/mv3/adv', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: Store.key(), adv: _adv }),
      });
    } catch (e) {}
  };
  apply.addEventListener('click', async () => { apply.disabled = true; await save(); apply.disabled = false; apply.textContent = 'Applied'; setTimeout(() => { apply.textContent = 'Apply'; }, 1200); });
  render.addEventListener('click', async () => { await save(); _close(); _run(collect()); });

  ov.appendChild(box);
  ov.addEventListener('mousedown', (e) => { if (e.target === ov && !_job) _close(); });
  document.body.appendChild(ov);
  _modal = ov;
  document.addEventListener('keydown', _key);
}

// ── Running the job ─────────────────────────────────────────────────────────
// Three states, three windows, and only ever one of them on screen:
//
//   settings   the dialog above. It closes the moment Render is pressed.
//   progress   a SMALL window showing the time REMAINING. A render is minutes of ffmpeg,
//              and "3:40 elapsed" answers a question nobody asked - what you want to know
//              is whether to wait.
//   result     the render itself, playable, with the two things there are to do with it.
//
// Nothing is on a shelf when the result appears. The file is in finals/ and the Library's
// renders shelf IS that directory, so Save keeps it and Cancel deletes it. That is also
// why there is no third "just close" button: leaving would decide by accident.
let _small = null;

const _mmss = (sec) => {
  const s = Math.max(0, Math.round(sec));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
};

function _closeSmall() {
  if (!_small) return;
  _small.remove();
  _small = null;
}

function _run(adv) {
  const payload = buildPayload(adv);
  if (!payload) return;
  if (!payload.segmentClips.length && !payload.clips.length && !payload.halferClips.length) {
    _openResult(null, 'Nothing to render - the timeline is empty.');
    return;
  }

  const ov = _el('div', 'mv3-x-ov');
  const box = _el('div', 'mv3-sm');
  box.appendChild(_el('div', 'mv3-sm-t', 'Rendering'));
  const bar = _el('div', 'mv3-sm-bar');
  const fill = document.createElement('i');
  bar.appendChild(fill);
  box.appendChild(bar);
  const line = _el('div', 'mv3-sm-line', 'starting…');
  box.appendChild(line);
  const stop = _el('button', 'mv3-c-btn danger', 'Cancel render');
  stop.type = 'button';
  box.appendChild(stop);
  ov.appendChild(box);
  document.body.appendChild(ov);
  _small = ov;

  const total = Store.duration() || 0;
  const t0 = Date.now();
  stop.addEventListener('click', async () => {
    stop.disabled = true;
    stop.textContent = 'cancelling…';
    if (_job) { try { await fetch('/api/ffmpeg/cancel/' + _job.id, { method: 'DELETE' }); } catch (e) {} }
  });

  fetch('/api/ffmpeg/render', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then(r => r.json()).then(d => {
    if (!d || !d.success) throw new Error((d && d.error) || 'render refused');
    _job = { id: d.jobId };
    _poll(line, fill, total, t0);
  }).catch(e => {
    _closeSmall();
    _openResult(null, e.message);
  });
}

function _poll(line, fill, total, t0) {
  const tick = async () => {
    if (!_job) return;
    let d = null;
    try { d = await fetch('/api/ffmpeg/status/' + _job.id).then(r => r.json()); } catch (e) {}
    if (!_job) return;
    if (!d || !d.success) { line.textContent = 'lost track of the job'; setTimeout(tick, 2000); return; }

    if (d.status === 'queued') {
      line.textContent = 'queued' + (d.queuePos ? ' · ' + d.queuePos + ' ahead' : '');
    } else if (d.status === 'normalizing') {
      // A real phase, and one I missed the first time: every source clip is transcoded to a
      // common format before anything is assembled. It reports no progress seconds, so
      // there is nothing to put in the bar - but saying which phase it is beats "0%".
      line.textContent = 'preparing clips…';
    } else if (d.status === 'speeding') {
      // A second full pass over the finished file. Its progress seconds count a different
      // total, so the bar is left where it is rather than made to fall back to 0%.
      line.textContent = 'speeding up the finished video…';
    } else if (d.status === 'running') {
      // progressSecs is how much OUTPUT ffmpeg has written, so against the timeline length
      // it is a real fraction rather than a spinner.
      const frac = total > 0 ? Math.min(0.99, (+d.progressSecs || 0) / total) : 0;
      fill.style.width = Math.round(frac * 100) + '%';
      // Remaining, measured from the rate THIS render is going at rather than guessed from
      // how fast ffmpeg usually is. Only once there is enough progress to divide by.
      const spent = (Date.now() - t0) / 1000;
      const left = (frac > 0.02) ? (spent / frac - spent) : null;
      line.textContent = Math.round(frac * 100) + '%'
        + (left != null ? ' · ' + _mmss(left) + ' left' : ' · estimating…');
    } else if (d.status === 'done') {
      _job = null;
      fill.style.width = '100%';
      _closeSmall();
      _openResult(d.url, null);
      return;
    } else if (d.status === 'cancelled' || d.status === 'failed') {
      _job = null;
      _closeSmall();
      _openResult(null, d.status === 'cancelled'
        ? 'Render cancelled.'
        : ('Render failed: ' + (d.error || 'no reason given')));
      return;
    } else {
      // An UNRECOGNISED status is not evidence of failure - it is a phase this page has not
      // been told about. Treating the unknown as a failure is exactly how a render that the
      // server finished perfectly well got reported as broken, and the file it produced was
      // left on disk with nobody to keep or discard it.
      line.textContent = String(d.status || 'working') + '…';
    }
    setTimeout(tick, 1200);
  };
  tick();
}

// ── The result ──────────────────────────────────────────────────────────────
function _openResult(url, error) {
  _close();
  const ov = _el('div', 'mv3-x-ov');
  const box = _el('div', 'mv3-x is-result');
  const head = _el('div', 'mv3-x-head');
  head.appendChild(_el('h3', null, error ? 'Render' : 'Render finished'));
  box.appendChild(head);

  if (error) {
    const b = _el('div', 'mv3-x-body');
    b.appendChild(_el('div', 'mv3-x-err', error));
    box.appendChild(b);
    const f = _el('div', 'mv3-x-foot');
    f.appendChild(_el('span', 'mv3-x-prog', ''));
    const ok = _el('button', 'mv3-c-btn', 'Close');
    ok.type = 'button';
    ok.addEventListener('click', _close);
    f.appendChild(ok);
    box.appendChild(f);
  } else {
    const b = _el('div', 'mv3-x-body is-video');
    const v = document.createElement('video');
    v.src = url;
    v.controls = true; v.autoplay = true; v.playsInline = true;
    v.className = 'mv3-x-video';
    b.appendChild(v);
    box.appendChild(b);

    const f = _el('div', 'mv3-x-foot');
    const note = _el('span', 'mv3-x-prog', '');
    f.appendChild(note);
    const cancel = _el('button', 'mv3-c-btn danger', 'Cancel');
    cancel.type = 'button';
    const save = _el('button', 'mv3-c-btn mv3-x-go', 'Save & download');
    save.type = 'button';

    cancel.addEventListener('click', async () => {
      cancel.disabled = true; save.disabled = true;
      // Release the file first: Windows will not unlink something a <video> still holds.
      try { v.pause(); v.removeAttribute('src'); v.load(); } catch (e) {}
      try {
        await fetch('/api/mv3/render/discard', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
        });
      } catch (e) {}
      _close();
    });

    save.addEventListener('click', async () => {
      save.disabled = true; cancel.disabled = true;
      note.className = 'mv3-x-prog';
      note.textContent = 'saving…';
      try {
        const d = await fetch('/api/mv3/render/keep', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, key: Store.key() }),
        }).then(r => r.json());
        if (!d || !d.success) throw new Error((d && d.error) || 'could not save');
        // The browser's own save, not a second copy made server-side.
        const a = document.createElement('a');
        a.href = url;
        a.download = String(url).split('/').pop();
        document.body.appendChild(a);
        a.click();
        a.remove();
        note.className = 'mv3-x-prog is-good';
        note.textContent = 'On the Library renders shelf'
          + (d.frozen ? ' · overlay arrangement saved' : '');
        setTimeout(_close, 1800);
      } catch (e) {
        note.className = 'mv3-x-prog is-bad';
        note.textContent = e.message;
        save.disabled = false; cancel.disabled = false;
      }
    });

    f.appendChild(cancel); f.appendChild(save);
    box.appendChild(f);
  }

  ov.appendChild(box);
  document.body.appendChild(ov);
  _modal = ov;
  document.addEventListener('keydown', _key);
}

export function initExport() {
  const b = document.getElementById('mv3-export');
  if (b) b.addEventListener('click', openExport);
  // Settings follow the project, so they are re-read whenever one is opened.
  let last = null;
  Store.onChange(() => {
    const k = Store.key();
    if (k === last) return;
    last = k;
    _adv = { ...ADV_DEFAULTS, ...(Store.adv() || {}) };
  });
}
