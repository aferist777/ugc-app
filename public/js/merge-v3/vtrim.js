/* ════════════════════════════════════════════════════════════════════════════
   MERGE — THE PART OF A CLIP OR A SOUND that goes to the video model (phase V7, PLAN V-H; the owner 2026-10-07).

   Pressed in the attachment zone, a clip (or a sound) opens this panel over the zone: the clip itself and, under it,
   a bar of its whole length with a WINDOW on it - the part that goes. The window is dragged to move it and its edges
   to shorten or lengthen it, never past what the model takes nor under what it needs; the picture follows the edge
   being moved, and "play the part" plays just that. Every change is the attachment's own (in/out) - kept with the
   draft, and the price follows it.

   openTrim({ anchor, kind, src, poster, dur, from, to, min, max, title, why, still, onChange(from, to), onStill(url), onClose })
   closeTrim()

   (phase V17, the owner 2026-10-08) `still`: Kling motion control's FIRST FRAME. A slider over the clip picks the moment
   the character is seen best; the part goes FROM there (the window's start follows it, its length kept within what the
   model takes), and the frame at that moment is handed to `onStill` as a small JPEG - the zone shows it on the clip.
   ════════════════════════════════════════════════════════════════════════════ */

import * as Layers from '../layers.js';
import { wire as wireRange, fill as fillRange } from '../ui-range.js';

let _open = null;

const _el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const _t = (s) => { const v = Math.max(0, +s || 0); const m = Math.floor(v / 60); return m + ':' + (v - m * 60).toFixed(1).padStart(4, '0'); };

export function closeTrim() {
  const o = _open;
  if (!o) return;
  _open = null;
  try { o.media.pause(); } catch (e) { /* gone */ }
  o.media.removeAttribute('src');
  try { o.media.load(); } catch (e) { /* nothing to let go of */ }
  o.box.remove();
  Layers.close(o.layer);
  document.removeEventListener('pointerdown', o.away, true);
  window.removeEventListener('resize', o.place);
  if (typeof o.onClose === 'function') o.onClose();
}

export function openTrim(opts) {
  closeTrim();
  const o = opts || {};
  const dur = Math.max(0.1, +o.dur || 0);
  const min = Math.max(0.1, Math.min(+o.min || 0.5, dur));
  const max = Math.max(min, Math.min(+o.max || dur, dur));
  let from = Math.max(0, Math.min(+o.from || 0, dur - min));
  let to = Math.max(from + min, Math.min(+o.to || (from + max), from + max, dur));

  // (phase V73 block 4, (б4-6) а) a panel at its place: the frame's edges, its head row with the 28 px ✕, no backdrop; what it
  // holds under the head in its own padded column (`body`)
  const box = _el('div', 'vtrim u-win is-float');
  const head = _el('div', 'vtrim-h u-win-head');
  head.append(_el('b', 'u-win-title', o.title || (o.kind === 'audio' ? 'the sound' : 'the clip')), _el('span', 'u-win-sub', _t(dur) + ' in all'));
  const x = _el('button', 'vtrim-x u-btn is-icon is-quiet u-x', '');
  x.type = 'button';
  x.title = 'Close (Esc)';
  head.appendChild(x);
  box.appendChild(head);
  const body = _el('div', 'vtrim-body');
  box.appendChild(body);
  if (o.why) body.appendChild(_el('div', 'vtrim-why', o.why));

  const media = document.createElement(o.kind === 'audio' ? 'audio' : 'video');
  media.className = 'vtrim-media';
  media.preload = 'metadata';
  media.src = o.src;
  if (o.kind !== 'audio') { media.muted = false; media.playsInline = true; if (o.poster) media.poster = o.poster; }
  body.appendChild(media);
  // (phase V17) The first frame: its moment on a slider of its own - the part starts there.
  let still = null;
  if (o.still && o.kind !== 'audio') {
    still = _el('div', 'vtrim-still');
    const range = document.createElement('input');
    range.type = 'range';
    range.min = '0';
    range.max = String(Math.max(0, dur - min));
    range.step = '0.04';
    range.title = 'The first frame: the moment the character is seen best - the moves go from here';
    wireRange(range);                               // (phase V73 block 2) the shared slider, in the trimmer's gold
    const at = _el('span', 'vtrim-still-at u-range-v');
    still.append(_el('span', 'k', 'First frame'), range, at);
    body.appendChild(still);
    still.range = range;
    still.at = at;
  }

  const bar = _el('div', 'vtrim-bar' + (o.kind === 'audio' ? '' : ' is-film'));
  // A clip's bar is a strip of its frames (the owner, 2026-10-07: "a strip of frames with the window on it"); a
  // sound's is a plain strip.
  const film = o.kind === 'audio' ? null : document.createElement('canvas');
  if (film) { film.className = 'vtrim-film'; bar.appendChild(film); }
  const win = _el('div', 'vtrim-win');
  const l = _el('span', 'vtrim-edge is-l');
  const r = _el('span', 'vtrim-edge is-r');
  win.append(l, r);
  const head2 = _el('span', 'vtrim-at');
  bar.append(win, head2);
  body.appendChild(bar);

  const foot = _el('div', 'vtrim-foot');
  const span = _el('span', 'vtrim-span');
  const play = _el('button', 'mv3-c-btn u-btn is-s', '▶ play the part');
  play.type = 'button';
  const done = _el('button', 'mv3-c-btn vtrim-done u-btn is-s is-main', 'done');
  done.type = 'button';
  foot.append(span, play, done);
  body.appendChild(foot);

  const paint = () => {
    win.style.left = (from / dur * 100) + '%';
    win.style.width = ((to - from) / dur * 100) + '%';
    span.textContent = _t(from) + ' – ' + _t(to) + ' · ' + (to - from).toFixed(1) + ' s go';
    if (still) { still.range.value = String(from); fillRange(still.range); still.at.textContent = _t(from); }
  };
  const show = (t) => { try { media.currentTime = Math.max(0, Math.min(dur - 0.05, t)); } catch (e) { /* not loaded yet */ } };
  // (phase V17) The first frame, taken once the clip stands on it: a small JPEG for the zone's cell.
  let want = still ? from : null;
  const shot = () => {
    if (!still || want == null || Math.abs(media.currentTime - want) > 0.08 || !media.videoWidth) return;
    want = null;
    try {
      const w = 160, h = Math.max(1, Math.round(w * media.videoHeight / media.videoWidth));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(media, 0, 0, w, h);
      if (typeof o.onStill === 'function') o.onStill(c.toDataURL('image/jpeg', 0.82));
    } catch (e) { /* the frame cannot be taken - the poster stays */ }
  };
  if (still) media.addEventListener('seeked', shot);
  const changed = () => {
    if (still) { want = from; if (Math.abs(media.currentTime - from) <= 0.08) shot(); }
    if (typeof o.onChange === 'function') o.onChange(+from.toFixed(2), +to.toFixed(2));
  };
  // (phase V17) The slider moves the part's start; its end follows the length the person chose (`wantLen` - the window's
  // own edges set it), so a start pushed to the clip's end and back gets its whole part again.
  let wantLen = to - from;
  if (still) {
    still.range.addEventListener('input', () => {
      media.pause();
      from = Math.max(0, Math.min(dur - min, +still.range.value || 0));
      to = Math.min(dur, from + Math.max(min, Math.min(max, wantLen)));
      show(from);
      paint();
    });
    still.range.addEventListener('change', changed);
  }

  // The window: its body moves it, its edges change its length - within [min, max] and the clip.
  let drag = null;
  const down = (mode) => (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    media.pause();
    drag = { mode, x0: ev.clientX, f0: from, t0: to, w: bar.getBoundingClientRect().width || 1 };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up, { once: true });
  };
  const move = (ev) => {
    if (!drag) return;
    const d = (ev.clientX - drag.x0) / drag.w * dur;
    if (drag.mode === 'move') {
      const len = drag.t0 - drag.f0;
      from = Math.max(0, Math.min(dur - len, drag.f0 + d));
      to = from + len;
      show(from);
    } else if (drag.mode === 'l') {
      from = Math.max(0, Math.max(drag.t0 - max, Math.min(drag.t0 - min, drag.f0 + d)));
      show(from);
    } else {
      to = Math.min(dur, Math.min(drag.f0 + max, Math.max(drag.f0 + min, drag.t0 + d)));
      show(to);
    }
    paint();
  };
  const up = () => {
    document.removeEventListener('pointermove', move);
    drag = null;
    wantLen = to - from;
    changed();
  };
  win.addEventListener('pointerdown', down('move'));
  l.addEventListener('pointerdown', down('l'));
  r.addEventListener('pointerdown', down('r'));
  // A press on the bar outside the window shows that moment.
  bar.addEventListener('pointerdown', (ev) => {
    if (ev.target !== bar) return;
    const b = bar.getBoundingClientRect();
    show((ev.clientX - b.left) / (b.width || 1) * dur);
  });
  media.addEventListener('timeupdate', () => {
    head2.style.left = (media.currentTime / dur * 100) + '%';
    if (!media.paused && media.currentTime >= to) { media.pause(); play.textContent = '▶ play the part'; }
  });
  media.addEventListener('pause', () => { play.textContent = '▶ play the part'; });
  play.addEventListener('click', () => {
    if (!media.paused) { media.pause(); return; }
    show(from);
    media.play().then(() => { play.textContent = '■ stop'; }).catch(() => { /* it could not play */ });
  });
  media.addEventListener('loadedmetadata', () => show(from), { once: true });

  // Over the zone, beside the place that opened it, inside the window.
  // The zone is drawn again under it (its cell replaced), so the place it was first opened beside is kept (review V7).
  let at0 = null;
  const place = () => {
    if (o.anchor && o.anchor.isConnected) { const rr = o.anchor.getBoundingClientRect(); at0 = { left: rr.left, top: rr.top, width: rr.width }; }
    const a = at0 || { left: 16, top: window.innerHeight - 16, width: 0 };
    const w = Math.min(420, window.innerWidth - 24);
    box.style.width = w + 'px';
    box.style.left = Math.round(Math.max(12, Math.min(window.innerWidth - w - 12, a.left + a.width / 2 - w / 2))) + 'px';
    box.style.bottom = Math.round(Math.max(12, window.innerHeight - a.top + 8)) + 'px';
  };
  document.body.appendChild(box);
  place();
  paint();

  const away = (ev) => { if (!box.contains(ev.target) && !(o.anchor && o.anchor.contains(ev.target))) closeTrim(); };
  x.addEventListener('click', closeTrim);
  done.addEventListener('click', closeTrim);
  const layer = Layers.open(box, { name: 'clip part', modal: false, onEsc: closeTrim });
  _open = { box, media, layer, away, place, onClose: o.onClose };
  setTimeout(() => { if (_open && _open.box === box) document.addEventListener('pointerdown', away, true); }, 0);
  window.addEventListener('resize', place);
  if (film) _filmstrip(film, o.src, dur, () => !!_open && _open.box === box);
  // A part the model does not take as it was (another model, another orientation) is brought within it as the window
  // opens - what the window shows is what goes.
  if (Math.abs(from - (+o.from || 0)) > 0.005 || (o.to != null && Math.abs(to - +o.to) > 0.005)) changed();
}

// The strip of frames under the window: a second, silent copy of the clip is sought frame after frame and each drawn
// into its place - as many as fit the bar at the clip's own shape. A file this browser cannot decode leaves the strip
// plain; nothing else depends on it.
async function _filmstrip(canvas, src, dur, alive) {
  const W = canvas.clientWidth || 396, H = canvas.clientHeight || 40;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  const g = canvas.getContext('2d');
  if (!g) return;
  const v = document.createElement('video');
  v.muted = true;
  v.preload = 'auto';
  v.playsInline = true;
  v.src = src;
  const once = (ev, ms) => new Promise((res) => {
    let t = 0;
    const done = (ok) => { clearTimeout(t); v.removeEventListener(ev, on); v.removeEventListener('error', bad); res(ok); };
    const on = () => done(true);
    const bad = () => done(false);
    v.addEventListener(ev, on, { once: true });
    v.addEventListener('error', bad, { once: true });
    t = setTimeout(() => done(false), ms);
  });
  try {
    if (!(v.readyState >= 1) && !(await once('loadedmetadata', 8000))) return;
    const ar = (v.videoWidth && v.videoHeight) ? v.videoWidth / v.videoHeight : 9 / 16;
    const n = Math.max(3, Math.min(24, Math.ceil(W / Math.max(8, H * ar))));
    const fw = canvas.width / n;
    for (let i = 0; i < n; i++) {
      if (!alive()) return;
      v.currentTime = Math.min(Math.max(0, dur - 0.05), (i + 0.5) * dur / n);
      if (!(await once('seeked', 4000)) || !alive()) return;
      // Cut to fill its place, the middle of the frame kept.
      const sw = v.videoWidth, sh = v.videoHeight;
      const want = fw / canvas.height;
      let cw = sw, ch = sh;
      if (sw / sh > want) cw = sh * want; else ch = sw / want;
      g.drawImage(v, (sw - cw) / 2, (sh - ch) / 2, cw, ch, Math.round(i * fw), 0, Math.ceil(fw), canvas.height);
    }
  } catch (e) {
    /* a strip is a nicety */
  } finally {
    v.removeAttribute('src');
    try { v.load(); } catch (e) { /* nothing to let go of */ }
  }
}
