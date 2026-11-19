/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — exporting a project.

   The third piece of the editor, after its timeline and its preview. What the window is for:
   saying what is about to be made before it is made - shape, length, how many pieces - and the
   export settings: the size and quality of the file and a playback speed (the colour correction
   is each clip's, overlay/color.js). What each of them does is lib/render-finish.js.

   The settings belong to the PROJECT (POST /api/mv3/adv) and are saved when Render or Add to queue
   is pressed; the render is made from the numbers on screen, and a queued one keeps them.

   SEVERAL AT ONCE. Something else may own the button for a while -
   a highlights project, whose ticked fragments it renders (merge-v3/highlights.js, setRenderTarget): it says what the
   button reads ("Render 3", "✕ stop"), whether it can be pressed, and what a press does. Its window is THIS one, the same
   fields, for N fragments (openMany): "N fragments · 3:47 in all", no "Add to queue" - one Render, at once.

   RENDER IS AN ENTRY OF THE QUEUE: one entry, armed and started at
   once (routes/mv3q.js POST /mv3q/render); the window can be closed while it goes, Stop is in it and in Queue, and a render
   that finishes with the window closed says so in a popup with "open" (_run, _follow).

   NO RESULT WINDOW: a finished render closes this window if it is open, and
   says so in the corner - "Rendered · <its name>" with Open (the Library's viewer of it) and Show in folder
   (merge-v3/render-done.js).
   ═══════════════════════════════════════════════════════════════════════════ */

import * as Store from './store.js';
import * as Layers from '../layers.js';
import { renderDone } from './render-done.js';
import { addCurrent } from './queue.js';
import { showError } from '../notice.js';
import { wire as wireRange } from '../ui-range.js';
import { iconEl } from '../icons.js';
import { figures } from '../num.js';
import * as T from '../i18n/t.js';

let _busy = false;

// What a project that has never been exported starts from.
const DEFAULTS = {
  resolution: '', fps: 30, crf: 20, preset: 'veryfast', audioBitrate: '192k',
  playbackSpeed: 1, srt: true,
};

// The timeline's header line ("Added to the queue."); an error ("Not queued: …", "Rendered, but …") is a popup instead
// (js/notice.js).
function _say(msg, kind) {
  if (msg && kind === 'err') { showError(msg); return; }
  const el = document.getElementById('mv3-tl-status');
  if (!el) return;
  el.hidden = !msg;
  el.textContent = msg || '';
  // the one status line (`.u-status`): `info` quiet, anything else red
  el.className = 'mv3-tl-status u-status is-line' + (kind === 'info' ? '' : ' is-bad');
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
  s.className = 'u-in is-s';                         // the shared field, at the rows' 24
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
  wireRange(i);                                     // the shared slider; its value in mono (.u-range-v)
  const out = _el('span', 'mv3-x-slv u-range-v', fmt(+value));
  i.addEventListener('input', () => { out.textContent = fmt(+i.value); });
  wrap.appendChild(i); wrap.appendChild(out);
  wrap._input = i;
  return wrap;
}

// ── Running the job ─────────────────────────────────────────────────────────
// THE RENDER GOES THROUGH THE QUEUE: ONE entry, armed and started at once
// (POST /api/mv3q/render, routes/mv3q.js addArmed) - as a highlights project's Render. The window's body becomes the
// progress, phase by phase - in line, the film, then what is done to the finished file -, its foot the line that says it
// goes on and "Stop" (POST /api/mv3q/stop/:id - Queue has the same). The window may be closed while it goes (✕, Escape, a
// press beside it): the page follows the entry all the same (_follow, GET /api/mv3q). Done - the window closes if it is open
// and a popup says so, with Open and Show in folder (merge-v3/render-done.js). Failed with it closed - a popup.
const PHASES = {
  render: T.t('Rendering'),
  speeding: T.t('Changing the speed'),
  poster: T.t('Finishing'),
};
let _job = null;          // { id, key, title, ui: { head, fill, note, said, stop, foot, body } | null - the window is closed }

async function _run(body, foot, adv) {
  if (_busy) return;
  const tl = Store.timeline();
  if (!tl || !Array.isArray(tl.tracks)) return;

  _busy = true;
  paintExportButton();

  body.textContent = '';
  const head = _el('div', 'mv3-rhead', PHASES.render);
  const bar = _el('div', 'mv3-rbar');
  const fill = document.createElement('i');
  fill.style.width = '0%';
  bar.appendChild(fill);
  const note = _el('div', 'mv3-rsum', T.t('Starting…'));
  body.append(head, bar, note);
  foot.textContent = '';
  const said = _el('span', 'mv3-rsaid u-status is-line', T.t('It goes on in Queue if you close this window'));
  const stop = _el('button', 'mv3-c-btn mv3-rstop u-btn is-danger', T.t('Stop'));
  stop.type = 'button';
  stop.title = T.t('Stop this render - nothing of it is kept');
  foot.append(said, _el('span', 'sp'), stop);
  const ui = { body, foot, head, fill, note, said, stop };

  let d = null;
  try {
    // The timeline and the settings go up as they stand; the entry keeps them (routes/mv3q.js).
    d = await fetch('/api/mv3q/render', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timeline: tl, key: Store.key(), title: Store.title(), adv, dur: Store.duration() }),
    }).then(r => r.json());
  } catch (e) { d = { success: false, error: e.message }; }
  if (!d || !d.success) {
    _failed(ui, (d && d.error) || T.t('refused'));
    _busy = false;
    paintExportButton();
    return;
  }
  // Still open? It may have been closed while the entry was being made.
  _job = { id: d.id, key: Store.key(), title: Store.title(), ui: _ov && body.isConnected ? ui : null };
  stop.addEventListener('click', () => _stop(_job));
  _follow(_job);
}

// The window says the render did not come: its line, and a way out.
function _failed(ui, msg) {
  if (!ui || !ui.body.isConnected) { showError(T.t('Not rendered: {why}', { why: msg })); return; }
  ui.body.textContent = '';
  ui.body.appendChild(_el('div', 'mv3-rhead', T.t('Not rendered')));
  ui.body.appendChild(_el('div', 'mv3-rwarn', msg));
  ui.foot.textContent = '';
  const close = _el('button', 'mv3-c-btn u-btn', T.t('Close'));
  close.type = 'button';
  close.addEventListener('click', _close);
  ui.foot.append(_el('span', 'sp'), close);
}

// Stop, in the window: the entry is taken out or its encode cut off - or, in its finishing passes, kept.
async function _stop(job) {
  if (!job || !job.ui) return;
  const { stop, said } = job.ui;
  stop.disabled = true;
  let r = null;
  try { r = await fetch('/api/mv3q/stop/' + encodeURIComponent(job.id), { method: 'POST' }).then(x => x.json()); }
  catch (e) { r = { success: false, error: e.message }; }
  if (!r || !r.success) { stop.disabled = false; showError(T.t('Not stopped: {why}', { why: (r && r.error) || T.t('the app did not answer') })); return; }
  said.textContent = r.finishing ? T.t('Finishing its file - it is kept') : r.finished ? T.t('It has already finished') : T.t('Stopping…');
}

// The entry followed to its end, the window open or not.
async function _follow(job) {
  let misses = 0;
  try {
    for (;;) {
      await new Promise(r => setTimeout(r, 1200));
      let q = null;
      try { q = await fetch('/api/mv3q').then(r => r.json()); } catch (e) { q = null; }
      if (!q || !q.success) {
        if (++misses >= 5) throw new Error(T.t('the app did not answer about the render'));
        continue;
      }
      misses = 0;
      const it = (q.items || []).find(x => x.id === job.id);
      const ui = job.ui;
      // Gone from the list: stopped (here or in Queue), or cleared away.
      if (!it) {
        if (ui) _close();
        _say(T.t('Render stopped.'), 'info');
        return;
      }
      if (it.status === 'queued') {
        if (ui) {
          ui.head.textContent = T.t('Waiting in Queue');
          ui.fill.style.width = '0%';
          ui.note.textContent = it.ahead ? T.tn(it.ahead, '{n} render ahead of it', '{n} renders ahead of it') : T.t('next');
        }
        continue;
      }
      if (it.status === 'running') {
        if (ui) {
          ui.head.textContent = PHASES[it.phase] || PHASES.render;
          ui.fill.style.width = (it.percent || 0) + '%';
          ui.note.textContent = it.phase === 'poster' ? T.t('Almost done…')
            : (it.percent || 0) + '%' + ' · ' + (it.remain != null ? T.t('about {time} left', { time: _mmss(it.remain) }) : T.t('measuring…'));
        }
        continue;
      }
      if (it.status === 'failed') { _failed(ui, it.error || T.t('ffmpeg failed')); return; }
      if (it.status === 'done' && it.url) {
        // The window closes if it is open; the popup either way - the render is on the Renders shelf and in Queue too
        if (ui && ui.body.isConnected) _close();
        renderDone(it.url);
        if (it.warning) _say(T.t('Rendered, but {why}.', { why: it.warning }), 'err');
        return;
      }
    }
  } catch (e) {
    _failed(job.ui, e.message);
  } finally {
    if (_job === job) _job = null;
    _busy = false;
    paintExportButton();
  }
}

// ── The window ──────────────────────────────────────────────────────────────
let _ov = null;
let _layer = null;

function _close() {
  // a render going on stays followed - its window is only not there to say it
  if (_job) _job.ui = null;
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
    sum: (tl.format || '9:16') + ' · ' + T.t('{s}s', { s: s.end.toFixed(1) }) + ' · '
      + T.tn(s.pieces, '{n} piece of picture', '{n} pieces of picture') + ' · '
      + (s.sounds ? T.tn(s.sounds, '{n} sound', '{n} sounds') : T.t('no sound')),
    end: s.end, wide: tl.format === '16:9', adv: Store.adv(),
    said: !!(subs && (subs.clips || []).some(c => c && c.name)),
  });
}

/**
 * The same window for SEVERAL timelines at once - a highlights project's ticked fragments: one set of
 * settings on all, one Render, no "Add to queue". `go(adv)` puts them in line and resolves with a
 * word for the status line; the window closes on the press.
 * @param {{ count: number, seconds: number, adv: object|null, wide?: boolean, go: (adv: object) => Promise<{ text: string, err?: boolean }> }} o
 */
export function openMany(o) {
  const n = Math.max(0, o.count | 0);
  _window({
    sum: T.tn(n, '{n} fragment · {time} in all', '{n} fragments · {time} in all', { time: _mmss(o.seconds || 0) }),
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
  // the one window frame: its head of 40 px, the 28 px ✕, the foot of 52 px (css/app-shell.css .u-win)
  const box = _el('div', 'mv3-x u-win is-float');
  const head = _el('div', 'mv3-x-head u-win-head');
  head.appendChild(_el('h3', 'u-win-title', many ? T.tn(many.count, 'Render {n} fragment', 'Render {n} fragments') : T.tc('window', 'Render')));
  const x = _el('button', 'mv3-x-close u-btn is-icon is-quiet u-x', '');
  x.type = 'button';
  x.title = T.t('Close (Esc)');
  x.addEventListener('click', _close);     // a render going on goes on in Queue
  head.appendChild(x);
  box.appendChild(head);

  const body = _el('div', 'mv3-x-body');
  body.appendChild(_el('div', 'mv3-x-sum', o.sum));
  if (!s.end) body.appendChild(_el('div', 'mv3-rwarn', many ? T.t('None of them has anything to render.') : T.t('There is nothing on the timeline to render.')));

  body.appendChild(_el('div', 'mv3-x-hdr', T.t('Video')));
  // The frame is the project's; the file may be written smaller, in the same shape.
  const res = _select([[full, T.t('{size} (the frame)', { size: full.replace('x', '×') })], [compact, T.t('{size} (compact)', { size: compact.replace('x', '×') })]],
    adv.resolution === compact ? compact : full);
  body.appendChild(_row(T.t('Size'), res));
  const fps = _select([[24, '24 fps'], [30, '30 fps'], [60, '60 fps']], [24, 30, 60].includes(+adv.fps) ? +adv.fps : 30);
  body.appendChild(_row('FPS', fps));
  const crf = _slider(14, 35, 1, adv.crf, v => v.toFixed(0) + (v <= 18 ? ' · ' + T.t('large') : v >= 28 ? ' · ' + T.t('small') : ''));
  body.appendChild(_row(T.t('Quality (CRF)'), crf));
  const preset = _select([['ultrafast', T.t('Ultrafast (fast, large file)')], ['veryfast', 'Veryfast'], ['fast', T.t('Fast (balanced)')],
    ['medium', 'Medium'], ['slow', T.t('Slow (slow, small file)')]], adv.preset);
  body.appendChild(_row(T.t('Encoding preset'), preset));

  // A LAST pass over the finished file: by then the captions are part of the picture and keep pace
  // with it. The voice keeps its pitch.
  const spd = _slider(0.5, 2, 0.05, adv.playbackSpeed, v => v.toFixed(2) + 'x');
  body.appendChild(_row(T.t('Playback speed'), spd));
  const spdNote = _el('div', 'mv3-x-note');
  const showSpd = () => {
    const v = parseFloat(spd._input.value) || 1;
    spdNote.textContent = Math.abs(v - 1) < 0.001 ? T.t('Rendered as edited.')
      : T.t('The whole film and its captions at {speed}x - {from}s becomes {to}s. The voice keeps its pitch.',
        { speed: v.toFixed(2), from: s.end.toFixed(1), to: (Math.round(s.end / v * 10) / 10).toFixed(1) });
  };
  showSpd();
  spd._input.addEventListener('input', showSpd);
  body.appendChild(spdNote);

  body.appendChild(_el('div', 'mv3-x-hdr', T.t('Audio')));
  const ab = _select([['128k', '128 kbps'], ['192k', '192 kbps'], ['320k', '320 kbps']], adv.audioBitrate);
  body.appendChild(_row(T.t('Audio bitrate'), ab));

  // THE SUBTITLES FILE: on unless turned off - the Subtitles lane as classic
  // subtitles beside the video (lib/mv3b-job.js, public/js/captions/srt.js).
  body.appendChild(_el('div', 'mv3-x-hdr', T.t('Subtitles')));
  const srt = document.createElement('input');
  srt.type = 'checkbox'; srt.classList.add('u-check');
  srt.checked = adv.srt !== false;
  // A label inside a span: a row's own direct label is its name column (dialog.css).
  const srtBox = _el('span', 'mv3-x-check');
  const srtLbl = document.createElement('label');
  srtLbl.append(srt, _el('span', null, T.t('.srt file beside the video')));
  srtBox.appendChild(srtLbl);
  body.appendChild(_row(T.t('Subtitles file'), srtBox));
  body.appendChild(_el('div', 'mv3-x-note', many
    ? T.t('Each one\'s Subtitles lane as classic subtitles - two lines of up to 42 characters, 1-7 s each - in <name>.en_US.srt next to its video (Meta reads the language from that name). The text lanes are not in it.')
    : o.said
    ? T.t('The Subtitles lane as classic subtitles - two lines of up to 42 characters, 1-7 s each - in <name>.en_US.srt next to the video (Meta reads the language from that name). The text lanes are not in it.')
    : T.t('The Subtitles lane is empty - no file will be written.')));

  box.appendChild(body);

  const collect = () => ({
    resolution: res.value,
    fps: parseInt(fps.value, 10),
    crf: parseInt(crf._input.value, 10),
    preset: preset.value,
    audioBitrate: ab.value,
    playbackSpeed: parseFloat(spd._input.value) || 1,
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
  const cancel = _el('button', 'mv3-c-btn u-btn', T.t('Cancel'));
  cancel.type = 'button';
  cancel.addEventListener('click', () => { if (!_busy) _close(); });
  // Several fragments: one Render, at once - the settings go up with them (the server keeps them on each
  // one and on the project), and the window closes; their tiles show the way along.
  if (many) {
    const all = _el('button', 'mv3-c-btn mv3-x-go u-btn is-main', T.t('Render {n}', { n: many.count }));
    all.type = 'button';
    all.disabled = !s.end || !many.count;
    all.title = T.t('Into the render queue at once, one after another, with these settings');
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
  const queue = _el('button', 'mv3-c-btn u-btn', T.t('Add to queue'));
  queue.type = 'button';
  queue.disabled = !s.end;
  queue.title = T.t('Leave it for later - the queue renders them one after another, with these settings');
  queue.addEventListener('click', async () => {
    queue.disabled = true;
    const a = await save();
    const d = await addCurrent(a);
    _close();
    // News in the line's calm color (is-info): with no kind the line is red, the color of a refused save.
    _say(d && d.success ? T.t('Added to the queue.') : T.t('Not queued: {why}', { why: (d && d.error) || T.t('refused') }),
         d && d.success ? 'info' : 'err');
  });
  const go = _el('button', 'mv3-c-btn mv3-x-go u-btn is-main', T.t('Render'));
  go.type = 'button';
  go.disabled = !s.end;
  // The window becomes the progress, closed by the render's popup when it is done - and may be closed meanwhile: the render
  // is an entry of the queue.
  go.addEventListener('click', async () => {
    go.disabled = true; queue.disabled = true;
    const a = await save();
    _run(body, foot, a);
  });
  foot.append(cancel, queue, go);
  box.appendChild(foot);

  _ov.appendChild(box);
  // Escape, the ✕ and a press beside it close it - a render in flight too: it goes on in Queue.
  _ov.addEventListener('mousedown', (e) => { if (e.target === _ov) _close(); });
  document.body.appendChild(_ov);
  _layer = Layers.open(_ov, { name: 'render', onEsc: _close });
}

// ── Who owns the button ─────────────────────────────────────────────────────
// null: it is Export, for the open timeline. Otherwise { state() -> { label, title, enabled, stop, armed }, click() }.
let _target = null;

/** Someone else's button for a while (a highlights project's ticked fragments), or Export again (null). */
export function setRenderTarget(t) {
  _target = t || null;
  paintExportButton();
}

// The button's words: a figure in mono ("Render 3" - js/num.js), a leading "✕ " as Lucide's x.
function _label(b, text) {
  b.textContent = '';
  let t = String(text || '');
  if (t.startsWith('✕ ')) { b.appendChild(iconEl('x', 14)); t = t.slice(2); }
  b.appendChild(figures(t));
}

/** The button as it should read now: Export for the open timeline, or what the target says. */
export function paintExportButton() {
  const b = document.getElementById('mv3-export');
  if (!b) return;
  const can = Store.hasProject();
  const st = _target ? _target.state() : null;
  _label(b, st ? st.label : T.t('Export'));
  b.title = st ? st.title : _busy ? T.t('Rendering - it is in Queue, where it can be stopped') : T.t('Render this timeline with FFmpeg');
  b.disabled = !can || (st ? !st.enabled : _busy);
  b.classList.toggle('is-stop', !!(st && st.stop));
  // "✕ stop" is the part's danger button; Export / Render N its gold one
  b.classList.toggle('is-danger', !!(st && st.stop));
  b.classList.toggle('is-main', !(st && st.stop));
  b.classList.toggle('is-armed', !!(st && st.armed));
}

export function initExportB() {
  const b = document.getElementById('mv3-export');
  if (b) b.addEventListener('click', () => { if (_target) _target.click(); else _open(); });
}
