/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — exporting a project.

   The third piece of the editor, after its timeline and its preview. What the window is for:
   saying what is about to be made before it is made - shape, length, how many pieces - and the
   export settings the owner renders with (docs/local-app/PLAN.md, phase 3; they came from the
   talking-head editor's Export): the size and quality of the file, a colour correction, a playback speed, and the two
   extras, minutes of black after the end and a quiet noise under the sound. What each of them does
   is lib/render-finish.js.

   The settings belong to the PROJECT (POST /api/mv3/adv) and are saved when Render or Add to queue
   is pressed; the render is made from the numbers on screen, and a queued one keeps them.

   SEVERAL AT ONCE (phase V33.4, the owner's (х38), (х39), (х43)). Something else may own the button for a while -
   a highlights project, whose ticked fragments it renders (merge-v3/highlights.js, setRenderTarget): it says what the
   button reads ("Render 3", "✕ stop"), whether it can be pressed, and what a press does. Its window is THIS one, the same
   fields, for N fragments (openMany): "N fragments · 3:47 in all", no "Add to queue" - one Render, at once.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as Store from './store.js';
import * as Layers from '../layers.js';
import { showResult } from './render-result.js';
import { addCurrent } from './queue.js';
import { showError } from '../notice.js';
import { wire as wireRange } from '../ui-range.js';

let _busy = false;

// What a project that has never been exported starts from - the numbers the render used before
// there were settings, so an old project renders as it did.
const DEFAULTS = {
  resolution: '', fps: 30, crf: 20, preset: 'veryfast', audioBitrate: '192k',
  eqBrightness: 0, eqContrast: 1, eqSaturation: 1, eqGamma: 1,
  playbackSpeed: 1, extra1: 'none', extra2: 'none', srt: true,
};

// The timeline's header line ("Added to the queue."); an error ("Not queued: …", "Rendered, but …") is a popup instead
// (phase V49.1, the owner's (пр28), (пр29); js/notice.js).
function _say(msg, kind) {
  if (msg && kind === 'err') { showError(msg); return; }
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

function _el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function _row(label, control) {
  const r = _el('div', 'mv3-x-row');
  r.appendChild(_el('label', null, label));
  r.appendChild(control);
  return r;
}

function _select(opts, value) {
  const s = document.createElement('select');
  s.className = 'u-in is-s';                         // (phase V73 block 2) the shared field, at the rows' 24
  for (const [v, l] of opts) {
    const o = document.createElement('option');
    o.value = String(v); o.textContent = l;
    s.appendChild(o);
  }
  s.value = String(value);
  if (s.selectedIndex < 0) s.selectedIndex = 0;
  return s;
}

function _slider(min, max, step, value, fmt) {
  const wrap = _el('span', 'mv3-x-sl');
  const i = document.createElement('input');
  i.type = 'range'; i.min = String(min); i.max = String(max); i.step = String(step); i.value = String(value);
  wireRange(i);                                     // (phase V73 block 2) the shared slider; its value in mono (.u-range-v)
  const out = _el('span', 'mv3-x-slv u-range-v', fmt(+value));
  i.addEventListener('input', () => { out.textContent = fmt(+i.value); });
  wrap.appendChild(i); wrap.appendChild(out);
  wrap._input = i;
  return wrap;
}

// ── Running the job ─────────────────────────────────────────────────────────
// The window's body becomes the progress, phase by phase - the film, then what is done to the
// finished file - and then the result window every render shares.
const PHASES = {
  render: 'Rendering',
  speeding: 'Changing the speed',
  tail: 'Adding the black tail',
  poster: 'Finishing',
};

async function _run(body, adv) {
  if (_busy) return;
  const tl = Store.timeline();
  if (!tl || !Array.isArray(tl.tracks)) return;

  _busy = true;
  const btn = document.getElementById('mv3-export');
  if (btn) btn.disabled = true;

  body.textContent = '';
  const head = _el('div', 'mv3-rhead', PHASES.render);
  const bar = _el('div', 'mv3-rbar');
  const fill = document.createElement('i');
  fill.style.width = '0%';
  bar.appendChild(fill);
  const note = _el('div', 'mv3-rsum', 'Starting…');
  body.append(head, bar, note);

  try {
    // The timeline and the settings go up as they stand. The server builds the graph from them -
    // the same module, read the same way as the preview reads it.
    const start = await fetch('/api/mv3b/render', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timeline: tl, key: Store.key(), adv }),
    }).then(r => r.json());
    if (!start || !start.success) throw new Error((start && start.error) || 'refused');

    for (;;) {
      await new Promise(r => setTimeout(r, 1200));
      const st = await fetch('/api/mv3b/render/' + encodeURIComponent(start.jobId)).then(r => r.json());
      if (!st || !st.success) throw new Error((st && st.error) || 'lost the job');
      if (st.status === 'running') {
        head.textContent = PHASES[st.phase] || PHASES.render;
        fill.style.width = (st.percent || 0) + '%';
        note.textContent = st.phase === 'poster' ? 'Almost done…'
          : (st.percent || 0) + '%' + (st.remain != null ? ' · about ' + _mmss(st.remain) + ' left' : ' · measuring…');
        continue;
      }
      if (st.status === 'failed') throw new Error(st.error || 'ffmpeg failed');

      // Done: the window every render shares - playable, named, kept, sent (render-result.js).
      _close();
      showResult({ url: st.url, title: Store.title(), key: Store.key(), fresh: true });
      if (st.warning) _say('Rendered, but ' + st.warning + '.', 'err');
      return;
    }
  } catch (e) {
    body.textContent = '';
    body.appendChild(_el('div', 'mv3-rhead', 'Not rendered'));
    body.appendChild(_el('div', 'mv3-rwarn', e.message));
  } finally {
    _busy = false;
    paintExportButton();
  }
}

// ── The window ──────────────────────────────────────────────────────────────
let _ov = null;
let _layer = null;

function _close() {
  if (_ov) { _ov.remove(); _ov = null; }
  if (_layer) { Layers.close(_layer); _layer = null; }
}

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
  const tl = Store.timeline();
  if (!tl || !Array.isArray(tl.tracks)) return;
  const s = _summary(tl);
  const subs = (tl.tracks || []).find(t => t.kind === 'subs');
  _window({
    sum: (tl.format || '9:16') + ' · ' + s.end.toFixed(1) + 's · '
      + s.pieces + (s.pieces === 1 ? ' piece of picture' : ' pieces of picture') + ' · '
      + (s.sounds ? s.sounds + (s.sounds === 1 ? ' sound' : ' sounds') : 'no sound'),
    end: s.end, wide: tl.format === '16:9', adv: Store.adv(),
    said: !!(subs && (subs.clips || []).some(c => c && c.name)),
  });
}

/**
 * (phase V33.4) The same window for SEVERAL timelines at once - a highlights project's ticked fragments: one set of
 * settings on all, one Render, no "Add to queue" (the owner's (х39)). `go(adv)` puts them in line and resolves with a
 * word for the status line; the window closes on the press.
 * @param {{ count: number, seconds: number, adv: object|null, wide?: boolean, go: (adv: object) => Promise<{ text: string, err?: boolean }> }} o
 */
export function openMany(o) {
  const n = Math.max(0, o.count | 0);
  _window({
    sum: n + (n === 1 ? ' fragment' : ' fragments') + ' · ' + _mmss(o.seconds || 0) + ' in all',
    end: o.seconds || 0, wide: !!o.wide, adv: o.adv, said: true, many: { count: n, go: o.go },
  });
}

function _window(o) {
  _close();
  const s = { end: o.end || 0 };
  const adv = { ...DEFAULTS, ...(o.adv || {}) };
  const wide = !!o.wide;
  const full = wide ? '1920x1080' : '1080x1920';
  const compact = wide ? '1280x720' : '720x1280';
  const many = o.many || null;

  _ov = _el('div', 'mv3-x-ov');
  // (phase V73 block 4) the one window frame: its head of 40 px, the 28 px ✕, the foot of 52 px (css/app-shell.css .u-win)
  const box = _el('div', 'mv3-x u-win is-float');
  const head = _el('div', 'mv3-x-head u-win-head');
  head.appendChild(_el('h3', 'u-win-title', many ? 'Render ' + many.count + (many.count === 1 ? ' fragment' : ' fragments') : 'Render'));
  const x = _el('button', 'mv3-x-close u-btn is-icon is-quiet u-x', '');
  x.type = 'button';
  x.title = 'Close (Esc)';
  x.addEventListener('click', () => { if (!_busy) _close(); });
  head.appendChild(x);
  box.appendChild(head);

  const body = _el('div', 'mv3-x-body');
  body.appendChild(_el('div', 'mv3-x-sum', o.sum));
  if (!s.end) body.appendChild(_el('div', 'mv3-rwarn', many ? 'None of them has anything to render.' : 'There is nothing on the timeline to render.'));

  body.appendChild(_el('div', 'mv3-x-hdr', 'Video'));
  // The frame is the project's; the file may be written smaller, in the same shape.
  const res = _select([[full, full.replace('x', '×') + ' (the frame)'], [compact, compact.replace('x', '×') + ' (compact)']],
    adv.resolution === compact ? compact : full);
  body.appendChild(_row('Size', res));
  const fps = _select([[24, '24 fps'], [30, '30 fps'], [60, '60 fps']], [24, 30, 60].includes(+adv.fps) ? +adv.fps : 30);
  body.appendChild(_row('FPS', fps));
  const crf = _slider(14, 35, 1, adv.crf, v => v.toFixed(0) + (v <= 18 ? ' · large' : v >= 28 ? ' · small' : ''));
  body.appendChild(_row('Quality (CRF)', crf));
  const preset = _select([['ultrafast', 'ultrafast (fast, large file)'], ['veryfast', 'veryfast'], ['fast', 'fast (balanced)'],
    ['medium', 'medium'], ['slow', 'slow (slow, small file)']], adv.preset);
  body.appendChild(_row('Encoding preset', preset));

  // A LAST pass over the finished file: by then the captions are part of the picture and keep pace
  // with it. The voice keeps its pitch.
  const spd = _slider(0.5, 2, 0.05, adv.playbackSpeed, v => v.toFixed(2) + 'x');
  body.appendChild(_row('Playback speed', spd));
  const spdNote = _el('div', 'mv3-x-note');
  const showSpd = () => {
    const v = parseFloat(spd._input.value) || 1;
    spdNote.textContent = Math.abs(v - 1) < 0.001 ? 'Rendered as edited.'
      : `The whole film and its captions at ${v.toFixed(2)}x - ${s.end.toFixed(1)}s becomes ${(Math.round(s.end / v * 10) / 10).toFixed(1)}s. The voice keeps its pitch.`;
  };
  showSpd();
  spd._input.addEventListener('input', showSpd);
  body.appendChild(spdNote);

  body.appendChild(_el('div', 'mv3-x-hdr', 'Audio'));
  const ab = _select([['128k', '128 kbps'], ['192k', '192 kbps'], ['320k', '320 kbps']], adv.audioBitrate);
  body.appendChild(_row('Audio bitrate', ab));

  body.appendChild(_el('div', 'mv3-x-hdr', 'Colour correction'));
  const br = _slider(-0.5, 0.5, 0.02, adv.eqBrightness, v => v.toFixed(2));
  body.appendChild(_row('Brightness', br));
  const ct = _slider(0.5, 1.5, 0.05, adv.eqContrast, v => v.toFixed(2));
  body.appendChild(_row('Contrast', ct));
  const sa = _slider(0, 2, 0.05, adv.eqSaturation, v => v.toFixed(2));
  body.appendChild(_row('Saturation', sa));
  const ga = _slider(0.5, 2, 0.05, adv.eqGamma, v => v.toFixed(2));
  body.appendChild(_row('Gamma (exposure)', ga));

  // THE SUBTITLES FILE (phase V30, block 4, the owner's (с11)): on unless turned off - the Subtitles lane as classic
  // subtitles beside the video (lib/mv3b-job.js, public/js/captions/srt.js).
  body.appendChild(_el('div', 'mv3-x-hdr', 'Subtitles'));
  const srt = document.createElement('input');
  srt.type = 'checkbox'; srt.classList.add('u-check');
  srt.checked = adv.srt !== false;
  // A label inside a span: a row's own direct label is its name column (dialog.css).
  const srtBox = _el('span', 'mv3-x-check');
  const srtLbl = document.createElement('label');
  srtLbl.append(srt, _el('span', null, '.srt file beside the video'));
  srtBox.appendChild(srtLbl);
  body.appendChild(_row('Subtitles file', srtBox));
  body.appendChild(_el('div', 'mv3-x-note', many
    ? 'Each one\'s Subtitles lane as classic subtitles - two lines of up to 42 characters, 1-7 s each - in <name>.en_US.srt next to '
      + 'its video (Meta reads the language from that name). The text lanes are not in it.'
    : o.said
    ? 'The Subtitles lane as classic subtitles - two lines of up to 42 characters, 1-7 s each - in <name>.en_US.srt next to the video '
      + '(Meta reads the language from that name). The text lanes are not in it.'
    : 'The Subtitles lane is empty - no file will be written.'));

  body.appendChild(_el('div', 'mv3-x-hdr', 'Extras'));
  const e1 = _select([['none', 'None'], ['black5', '+ Black tail 5 min'], ['black10', '+ Black tail 10 min'],
    ['black20', '+ Black tail 20 min'], ['black30', '+ Black tail 30 min']], adv.extra1);
  body.appendChild(_row('After the end', e1));
  const noises = [['none', 'None']];
  for (const kind of ['white', 'pink', 'brown']) {
    for (let i = 1; i <= 5; i++) noises.push(['wn_' + kind + '_' + i, '+ ' + kind[0].toUpperCase() + kind.slice(1) + ' noise ' + i + '%']);
  }
  const e2 = _select(noises, adv.extra2);
  body.appendChild(_row('Under the sound', e2));
  box.appendChild(body);

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
    extra1: e1.value,
    extra2: e2.value,
    srt: !!srt.checked,
  });
  const save = async () => {
    const a = collect();
    Store.setAdv(a);
    try {
      await fetch('/api/mv3/adv', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: Store.key(), adv: a }),
      });
    } catch (e) { /* the render still uses what is on screen */ }
    return a;
  };

  // the buttons at the right: Cancel, then Add to queue, the gold Render last
  const foot = _el('div', 'mv3-x-foot u-win-foot');
  foot.appendChild(_el('span', 'sp'));
  const cancel = _el('button', 'mv3-c-btn u-btn', 'Cancel');
  cancel.type = 'button';
  cancel.addEventListener('click', () => { if (!_busy) _close(); });
  // (phase V33.4) Several fragments: one Render, at once - the settings go up with them (the server keeps them on each
  // one and on the project), and the window closes; their tiles show the way along.
  if (many) {
    const all = _el('button', 'mv3-c-btn mv3-x-go u-btn is-main', 'Render ' + many.count);
    all.type = 'button';
    all.disabled = !s.end || !many.count;
    all.title = 'Into the render queue at once, one after another, with these settings';
    all.addEventListener('click', async () => {
      all.disabled = true;
      let said = null;
      try { said = await many.go(collect()); } catch (e) { said = { text: e.message, err: true }; }
      _close();
      if (said && said.text) _say(said.text, said.err ? 'err' : '');
    });
    foot.append(cancel, all);
    box.appendChild(foot);
    _ov.appendChild(box);
    _ov.addEventListener('mousedown', (e) => { if (e.target === _ov) _close(); });
    document.body.appendChild(_ov);
    _layer = Layers.open(_ov, { name: 'render', onEsc: _close });
    return;
  }
  // Left of Render, because it is the calmer of the two and the one to reach for when several
  // projects are being set up in a row.
  const queue = _el('button', 'mv3-c-btn u-btn', 'Add to queue');
  queue.type = 'button';
  queue.disabled = !s.end;
  queue.title = 'Leave it for later - the queue renders them one after another, with these settings';
  queue.addEventListener('click', async () => {
    queue.disabled = true;
    const a = await save();
    const d = await addCurrent(a);
    _close();
    // (phase V73 block 0) News in the line's calm colour (is-info): with no kind the line is red, the colour of a refused save.
    _say(d && d.success ? 'Added to the queue.' : 'Not queued: ' + ((d && d.error) || 'refused'),
         d && d.success ? 'info' : 'err');
  });
  const go = _el('button', 'mv3-c-btn mv3-x-go u-btn is-main', 'Render');
  go.type = 'button';
  go.disabled = !s.end;
  // The window STAYS. It becomes the progress and then the result: throwing the file at a new
  // tab leaves nothing behind to say what was made.
  go.addEventListener('click', async () => {
    go.disabled = true; queue.disabled = true;
    const a = await save();
    foot.remove();
    _run(body, a);
  });
  foot.append(cancel, queue, go);
  box.appendChild(foot);

  _ov.appendChild(box);
  _ov.addEventListener('mousedown', (e) => { if (e.target === _ov && !_busy) _close(); });
  document.body.appendChild(_ov);
  // Escape closes it - unless a render is in flight, when the window stays and the key is
  // simply eaten: what is on top decides, including deciding to do nothing (js/layers.js).
  _layer = Layers.open(_ov, { name: 'render', onEsc: () => { if (!_busy) _close(); } });
}

// ── Who owns the button (phase V33.4) ───────────────────────────────────────
// null: it is Export, for the open timeline. Otherwise { state() -> { label, title, enabled, stop, armed }, click() }.
let _target = null;

/** Someone else's button for a while (a highlights project's ticked fragments), or Export again (null). */
export function setRenderTarget(t) {
  _target = t || null;
  paintExportButton();
}

/** The button as it should read now: Export for the open timeline, or what the target says. */
export function paintExportButton() {
  const b = document.getElementById('mv3-export');
  if (!b) return;
  // Somebody else's project counts as none: rendering writes export settings (js/merge-v3/main.js).
  const can = Store.hasProject() && Store.canEdit();
  const st = _target ? _target.state() : null;
  b.textContent = st ? st.label : 'Export';
  b.title = st ? st.title : 'Render this timeline with FFmpeg';
  b.disabled = !can || (st ? !st.enabled : _busy);
  b.classList.toggle('is-stop', !!(st && st.stop));
  // (phase V73 block 2) "✕ stop" is the part's danger button; Export / Render N its gold one
  b.classList.toggle('is-danger', !!(st && st.stop));
  b.classList.toggle('is-main', !(st && st.stop));
  b.classList.toggle('is-armed', !!(st && st.armed));
}

export function initExportB() {
  const b = document.getElementById('mv3-export');
  if (b) b.addEventListener('click', () => { if (_target) _target.click(); else _open(); });
}
