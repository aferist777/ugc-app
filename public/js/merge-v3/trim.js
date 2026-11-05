/* ════════════════════════════════════════════════════════════════════════════
   MERGE — choosing a stretch of a clip, with two handles.

   A bar the length of the clip, a handle at each end, and the stretch between them lit. The
   video it is attached to follows along: dragging a handle shows the frame under it - which is
   how anybody decides where a cut goes - and between drags the clip plays only the stretch that
   is chosen, round and round, so what will be kept is what is being watched.

   It chooses and nothing else. What the stretch is FOR - a trim saved to a new file, a segment
   sent to a model - is the caller's business, told through onChange and read through get().
   ════════════════════════════════════════════════════════════════════════════ */

import { loadingEl } from '../ui-state.js';

const MIN_LEN = 0.3;

const _fmt = (t) => {
  const s = Math.max(0, +t || 0);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return m + ':' + (r < 10 ? '0' : '') + r.toFixed(1);
};

/**
 * @param video     the <video> the handles scrub and the stretch loops in
 * @param opts.onChange  called with { in, out } whenever a handle is let go
 * @param opts.start     { in, out } - where the handles start (the whole clip when not given)
 * @returns { el, get, destroy }
 */
export function trimmer(video, opts) {
  const o = opts || {};
  const el = document.createElement('div');
  el.className = 'mv3-trim';

  const bar = document.createElement('div');
  bar.className = 'mv3-trim-bar';
  const lit = document.createElement('div');
  lit.className = 'mv3-trim-lit';
  const hIn = document.createElement('button');
  hIn.type = 'button'; hIn.className = 'mv3-trim-h is-in'; hIn.title = 'Where the clip starts';
  const hOut = document.createElement('button');
  hOut.type = 'button'; hOut.className = 'mv3-trim-h is-out'; hOut.title = 'Where the clip ends';
  const head = document.createElement('div');
  head.className = 'mv3-trim-now';
  bar.append(lit, head, hIn, hOut);

  const say = document.createElement('div');
  say.className = 'mv3-trim-say';
  el.append(bar, say);

  let dur = 0, a = 0, b = 0, dragging = null;

  const paint = () => {
    // (phase V73 block 2, step 2b) The turning icon with the line's words until the clip's length is known.
    if (!(dur > 0)) { say.replaceChildren(loadingEl('reading the clip…', { line: true })); return; }
    const pa = (a / dur) * 100, pb = (b / dur) * 100;
    hIn.style.left = pa + '%';
    hOut.style.left = pb + '%';
    lit.style.left = pa + '%';
    lit.style.width = Math.max(0, pb - pa) + '%';
    say.textContent = _fmt(a) + ' – ' + _fmt(b) + ' · ' + (b - a).toFixed(1) + ' s of ' + _fmt(dur);
  };

  const ready = () => {
    dur = +video.duration || 0;
    if (!(dur > 0)) return;
    if (!(b > 0)) {
      a = 0; b = dur;
      // Where the handles start, when the caller says (a piece's stretch in its whole video, phase TG block 7).
      const st = o.start;
      if (st && +st.out > +st.in) { a = Math.max(0, Math.min(+st.in, dur - MIN_LEN)); b = Math.min(dur, Math.max(+st.out, a + MIN_LEN)); }
    }
    paint();
  };
  if (video.readyState >= 1) ready();
  video.addEventListener('loadedmetadata', ready);

  // THE STRETCH IS WHAT PLAYS. Past the out-point it goes back to the in-point, and a play
  // started before the in-point starts at it - so the loop is the clip as it will be kept.
  const loop = () => {
    if (dragging || !(dur > 0)) return;
    if (video.currentTime < a - 0.05 || video.currentTime > b) {
      try { video.currentTime = a; } catch (e) {}
    }
    head.style.left = ((video.currentTime / dur) * 100) + '%';
  };
  video.addEventListener('timeupdate', loop);

  const at = (clientX) => {
    const r = bar.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / Math.max(1, r.width))) * dur;
  };

  const grab = (which) => (e) => {
    if (!(dur > 0)) return;
    e.preventDefault();
    dragging = which;
    const wasPlaying = !video.paused;
    try { video.pause(); } catch (err) {}
    const move = (ev) => {
      const t = Math.round(at(ev.clientX) * 10) / 10;
      if (which === 'in') a = Math.max(0, Math.min(t, b - MIN_LEN));
      else b = Math.min(dur, Math.max(t, a + MIN_LEN));
      // The frame under the handle - the only way to see where a cut actually lands.
      try { video.currentTime = which === 'in' ? a : b; } catch (err) {}
      paint();
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      dragging = null;
      try { video.currentTime = a; } catch (err) {}
      if (wasPlaying) video.play().catch(() => {});
      if (o.onChange) o.onChange({ in: a, out: b });
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  };
  hIn.addEventListener('mousedown', grab('in'));
  hOut.addEventListener('mousedown', grab('out'));

  paint();
  return {
    el,
    get: () => ({ in: Math.round(a * 100) / 100, out: Math.round(b * 100) / 100, dur }),
    destroy: () => {
      video.removeEventListener('loadedmetadata', ready);
      video.removeEventListener('timeupdate', loop);
    },
  };
}
