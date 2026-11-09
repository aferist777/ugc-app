/* ═══════════════════════════════════════════════════════════════════════════
   FRAGMENTS OVER A VIDEO (phase V81, the owner 2026-11-09: "надо пользователю дать возможность на одном видео сделать сразу
   несколько выделений. то есть пользователь как в merge при выделении волны, может выделять фрагменты на видео и двигать рамки
   по нему"). The bar under every viewer's video (js/cut.js builds it; js/sound/scrub.js is its brother for a sound): a ruler,
   the film's sound as a wave (GET /api/track-peaks - a video's sound too; a flat line when it has none), the fragments as
   gold frames, the playhead.

   The hand, as over a wave in Merge:
     a sweep over empty wave        draws a new fragment (shorter than MIN_PART - a press: the playhead goes there); it stops
                                    at the fragments beside it - they never overlap
     an edge                        trims (the video shows the frame under it - where a cut lands)
     the middle                     moves the fragment between its neighbours
     a press on a fragment          picks it and puts the playhead at its start; Ctrl - adds it to the pick or takes it out,
                                    Shift - every fragment from the last one picked to it (the owner: "с зажатым ctrl можно
                                    выделять нужные сцены")
     a press on the ruler           moves the playhead (and a drag goes on moving it)
     the right button               `onMenu(e, { part, picked })` - on a fragment (picked first when it was not) or not
     Alt + wheel                    zooms toward the pointer; the wheel scrolls while zoomed in
   Keys - `key(e)`, called by the page while its viewer is on top and no field has the keyboard: Delete takes the picked
   fragments off, Escape lets the pick go (true - it was used: the viewer stays open, (в16)), Ctrl+Z / Ctrl+Y step back and on
   (every gesture, and a whole set laid by "Scenes", is one step).

   PLAYING: while there are fragments the video plays only them, one after another and round again (js/cuts/parts.js - the
   order the join will have, (в8)); with none, the whole video. The fragments and their steps live in `opts.state`, which the
   page keeps per video while the viewer is open ((в18)) - stepping to another video and back finds them where they were.

     rangesBar(video, { src, state, onChange(parts), onMenu(e, hit) })
       -> { el, parts(), picked(), setParts(list), setMarks(times), pick(ids), del(), key(e), redraw(), destroy() }
   ═══════════════════════════════════════════════════════════════════════════ */

import { normParts, MIN_PART } from './cuts/parts.js';

const RULER = 16;           // the ruler's band, px
const WAVE = 40;            // the wave's band, px
const EDGE = 6;             // an edge is taken this near, px
const SLOP = 3;             // the hand must travel this far before a press is a drag, px
const STEPS = 100;          // steps kept to go back

let _seq = 0;
const _id = () => 'f' + (++_seq).toString(36);
const r2 = (v) => Math.round(v * 100) / 100;

function _label(t, step) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  const ss = step < 1 ? s.toFixed(1) : String(Math.round(s));
  return m + ':' + (s < 10 ? '0' : '') + ss;
}
function _step(span, w) {
  const pps = w / Math.max(0.001, span);
  for (const s of [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800]) if (s * pps >= 56) return s;
  return 3600;
}

export function rangesBar(video, opts) {
  const o = opts || {};
  const st = o.state || {};
  if (!Array.isArray(st.parts)) st.parts = [];
  if (!Array.isArray(st.undo)) st.undo = [];
  if (!Array.isArray(st.redo)) st.redo = [];
  for (const p of st.parts) if (!p.id) p.id = _id();

  const el = document.createElement('div');
  el.className = 'rg';
  const cv = document.createElement('canvas');
  cv.className = 'rg-cv';
  cv.style.height = (RULER + WAVE) + 'px';
  el.appendChild(cv);

  let dur = +video.duration || 0;
  let v0 = 0, v1 = 0;                 // the seconds in view; v1 0 - the whole video
  const sel = new Set();
  let anchor = '';                    // the last fragment picked - Shift's start
  let marks = Array.isArray(st.marks) ? st.marks : [];
  let peaks = null, rate = 200, mute = false;
  let alive = true;
  let g = null;                       // the gesture
  let drawing = null;                 // { in, out } while a new fragment is swept

  if (o.src) {
    fetch('/api/track-peaks?src=' + encodeURIComponent(String(o.src).split('?')[0]))
      .then((r) => (r.ok ? Promise.all([r.arrayBuffer(), r.headers.get('X-Peaks-Rate')]) : null))
      .then((x) => {
        if (!alive) return;
        if (!x) { mute = true; draw(); return; }
        peaks = new Uint8Array(x[0]);
        rate = +x[1] || 200;
        if (!peaks.length) mute = true;
        draw();
      })
      .catch(() => { mute = true; if (alive) draw(); });
  }

  const W = () => cv.clientWidth || 600;
  const span = () => Math.max(0.001, (v1 > v0 ? v1 : dur) - v0);
  const xOf = (s) => (dur > 0 ? ((s - v0) / span()) * W() : 0);
  const tOf = (x) => (dur > 0 ? Math.max(0, Math.min(dur, v0 + (x / W()) * span())) : 0);
  const sorted = () => st.parts.slice().sort((a, b) => a.in - b.in);
  const snap = () => JSON.stringify(st.parts.map((p) => ({ id: p.id, in: p.in, out: p.out, label: p.label || '' })));

  function _changed() {
    st.marks = marks;
    if (typeof o.onChange === 'function') { try { o.onChange(api.parts()); } catch (e) { /* the page's */ } }
  }
  // One step back: what the fragments were before a gesture that changed them.
  function _commit(before) {
    if (before === snap()) return;
    st.undo.push(before);
    if (st.undo.length > STEPS) st.undo.shift();
    st.redo.length = 0;
    _changed();
  }
  function _restore(json) {
    st.parts = JSON.parse(json).map((p) => ({ id: p.id || _id(), in: +p.in, out: +p.out, ...(p.label ? { label: p.label } : {}) }));
    for (const id of [...sel]) if (!st.parts.some((p) => p.id === id)) sel.delete(id);
    draw();
    _changed();
  }

  // ── Drawing ──
  function _column(x0, x1) {
    if (!peaks || !peaks.length) return 0;
    const i0 = Math.floor(tOf(x0) * rate), i1 = Math.max(i0 + 1, Math.ceil(tOf(x1) * rate));
    let m = 0;
    for (let i = i0; i < i1 && i < peaks.length; i++) if (peaks[i] > m) m = peaks[i];
    return m / 255;
  }

  function draw() {
    if (!alive) return;
    const w = W(), h = RULER + WAVE;
    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    const css = getComputedStyle(el);
    const ink = css.getPropertyValue('--muted').trim() || '#999';
    const gold = css.getPropertyValue('--gold').trim() || '#d9b45a';
    const line = css.getPropertyValue('--border-soft').trim() || 'rgba(255,255,255,.12)';
    const head = css.getPropertyValue('--ink').trim() || '#fff';
    const ring = css.getPropertyValue('--sel-ring').trim() || '#ededed';

    c.fillStyle = 'rgba(255,255,255,0.03)';
    c.fillRect(0, 0, w, RULER);
    c.fillStyle = line;
    c.fillRect(0, RULER - 1, w, 1);
    if (dur > 0) {
      const step = _step(span(), w);
      const minor = step / 5;
      c.font = '9px system-ui, sans-serif';
      c.textBaseline = 'top';
      for (let k = Math.floor(v0 / minor); k * minor <= v0 + span() + 1e-6; k++) {
        const s = k * minor;
        if (s < v0 - 1e-6) continue;
        const x = Math.round(xOf(s)) + 0.5;
        const big = k % 5 === 0;
        c.fillStyle = big ? ink : line;
        c.fillRect(x, big ? RULER - 7 : RULER - 4, 1, big ? 6 : 3);
        if (big && x < w - 28) { c.fillStyle = ink; c.fillText(_label(s, step), x + 3, 1); }
      }
      // Where the scenes found begin: small gold marks on the ruler.
      c.fillStyle = gold;
      for (const m of marks) { const x = xOf(m); if (x >= 0 && x <= w) c.fillRect(Math.round(x), RULER - 5, 1, 5); }
    }

    // The wave - or a flat line, and the words, for a video with no sound.
    const top = RULER;
    const bar = Math.max(1, Math.min(3, w / 300));
    c.fillStyle = ink;
    c.globalAlpha = 0.5;
    if (peaks && peaks.length) {
      for (let x = 0; x < w; x += bar + 1) {
        const bh = Math.max(1, _column(x, x + bar + 1) * (WAVE - 6));
        c.fillRect(x, top + (WAVE - bh) / 2, bar, bh);
      }
    } else {
      c.fillRect(0, top + WAVE / 2, w, 1);
      if (mute) { c.globalAlpha = 0.7; c.font = '10px system-ui, sans-serif'; c.textBaseline = 'middle'; c.fillText('no sound', 6, top + WAVE / 2 - 8); }
    }
    c.globalAlpha = 1;

    // The fragments: a gold frame each, picked ones filled and ringed; their numbers when there is room.
    const list = sorted();
    list.forEach((p, i) => {
      const xa = xOf(p.in), xb = xOf(p.out);
      if (xb < 0 || xa > w) return;
      const on = sel.has(p.id);
      c.fillStyle = gold;
      c.globalAlpha = on ? 0.32 : 0.14;
      c.fillRect(xa, top, Math.max(1, xb - xa), WAVE);
      c.globalAlpha = 1;
      c.strokeStyle = on ? ring : gold;
      c.lineWidth = on ? 2 : 1;
      c.strokeRect(Math.round(xa) + 0.5, top + 0.5, Math.max(1, Math.round(xb - xa) - 1), WAVE - 1);
      c.fillStyle = gold;
      c.fillRect(Math.round(xa) - 1, top, 2, WAVE);
      c.fillRect(Math.round(xb) - 1, top, 2, WAVE);
      if (xb - xa >= 16) {
        c.fillStyle = on ? ring : gold;
        c.font = '600 9px system-ui, sans-serif';
        c.textBaseline = 'top';
        c.fillText(String(i + 1), xa + 4, top + 3);
      }
    });
    if (drawing) {
      const xa = xOf(drawing.in), xb = xOf(drawing.out);
      c.fillStyle = gold;
      c.globalAlpha = 0.25;
      c.fillRect(xa, top, Math.max(1, xb - xa), WAVE);
      c.globalAlpha = 1;
      c.fillRect(Math.round(xa) - 1, top, 2, WAVE);
      c.fillRect(Math.round(xb) - 1, top, 2, WAVE);
    }

    // The playhead: a line over both bands, a mark on the ruler.
    const xp = xOf(+video.currentTime || 0);
    if (xp >= -1 && xp <= w + 1) {
      c.fillStyle = head;
      c.fillRect(Math.round(xp) - 0.5, 0, 1.5, h);
      c.beginPath();
      c.moveTo(xp - 5, 0); c.lineTo(xp + 5, 0); c.lineTo(xp, 7); c.closePath();
      c.fill();
    }
  }

  // ── What the pointer is over ──
  const at = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  function _hit(p) {
    if (p.y < RULER) return { zone: 'ruler' };
    const list = sorted();
    let best = null, bd = Infinity;
    for (const part of list) {
      for (const side of ['in', 'out']) {
        const d = Math.abs(p.x - xOf(part[side]));
        // Two fragments edge to edge: the side the pointer is on decides whose edge it is.
        const tie = d === bd && best && ((side === 'in' && p.x >= xOf(part.in)) || (side === 'out' && p.x < xOf(part.out)));
        if (d <= EDGE && (d < bd || tie)) { bd = d; best = { zone: 'edge', part, side }; }
      }
    }
    if (best && xOf(best.part.out) - xOf(best.part.in) > EDGE * 3) return best;
    const inside = list.find((part) => p.x > xOf(part.in) && p.x < xOf(part.out));
    if (inside) return { zone: 'part', part: inside };
    if (best) return best;
    return { zone: 'empty' };
  }
  // The room a fragment has: from the end of the one before it to the start of the one after.
  function _room(part, t) {
    const list = sorted().filter((p) => p !== part);
    const ref = part ? part.in : t;
    let lo = 0, hi = dur;
    for (const p of list) {
      if (p.out <= ref + 1e-6) lo = Math.max(lo, p.out);
      if (p.in >= (part ? part.out : t) - 1e-6) hi = Math.min(hi, p.in);
    }
    return { lo, hi };
  }

  const seek = (t) => { try { video.currentTime = Math.max(0, Math.min(dur, t)); } catch (e) { /* not ready */ } draw(); };

  // ── The pointer ──
  cv.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !(dur > 0)) return;
    const p = at(e);
    const h = _hit(p);
    try { cv.setPointerCapture(e.pointerId); } catch (err) { /* a pointer already gone */ }
    e.preventDefault();
    const wasPlaying = !video.paused;
    if (h.zone === 'ruler') { g = { kind: 'seek' }; seek(tOf(p.x)); return; }
    if (h.zone === 'edge') {
      try { video.pause(); } catch (err) { /* fine */ }
      g = { kind: 'edge', part: h.part, side: h.side, before: snap(), room: _room(h.part), wasPlaying };
      return;
    }
    if (h.zone === 'part') {
      g = { kind: 'press-part', part: h.part, x0: p.x, in0: h.part.in, out0: h.part.out, before: snap(), room: _room(h.part),
        ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey, wasPlaying };
      return;
    }
    const t0 = tOf(p.x);
    g = { kind: 'press-empty', x0: p.x, t0, room: _room(null, t0), ctrl: e.ctrlKey || e.metaKey, wasPlaying };
  });

  cv.addEventListener('pointermove', (e) => {
    const p = at(e);
    if (!g) {
      const h = _hit(p);
      cv.style.cursor = h.zone === 'ruler' ? 'pointer' : h.zone === 'edge' ? 'ew-resize' : h.zone === 'part' ? 'grab' : 'text';
      return;
    }
    const t = tOf(p.x);
    if (g.kind === 'seek') { seek(t); return; }
    if (g.kind === 'edge') {
      const part = g.part;
      if (g.side === 'in') part.in = r2(Math.max(g.room.lo, Math.min(part.out - MIN_PART, t)));
      else part.out = r2(Math.min(g.room.hi, Math.max(part.in + MIN_PART, t)));
      seek(g.side === 'in' ? part.in : part.out);
      return;
    }
    if (g.kind === 'press-part' || g.kind === 'move') {
      if (g.kind === 'press-part') {
        if (Math.abs(p.x - g.x0) < SLOP) return;
        g.kind = 'move';
        try { video.pause(); } catch (err) { /* fine */ }
      }
      const len = g.out0 - g.in0;
      const d = t - tOf(g.x0);
      const nin = Math.max(g.room.lo, Math.min(g.room.hi - len, g.in0 + d));
      g.part.in = r2(nin);
      g.part.out = r2(nin + len);
      seek(g.part.in);
      return;
    }
    if (g.kind === 'press-empty' || g.kind === 'draw') {
      if (g.kind === 'press-empty') {
        if (Math.abs(p.x - g.x0) < SLOP) return;
        g.kind = 'draw';
        try { video.pause(); } catch (err) { /* fine */ }
      }
      const a = Math.max(g.room.lo, Math.min(g.t0, t)), b = Math.min(g.room.hi, Math.max(g.t0, t));
      drawing = { in: r2(a), out: r2(b) };
      seek(t < g.t0 ? drawing.in : drawing.out);
    }
  });

  const up = (e) => {
    const gg = g;
    g = null;
    if (!gg) return;
    if (gg.kind === 'seek') return;
    if (gg.kind === 'edge' || gg.kind === 'move') {
      seek(gg.part.in);
      _commit(gg.before);
      if (gg.wasPlaying) video.play().catch(() => {});
      draw();
      return;
    }
    if (gg.kind === 'press-part') {
      // A press on a fragment picks it (Ctrl - one more, Shift - a run from the last picked).
      if (gg.ctrl) { if (sel.has(gg.part.id)) sel.delete(gg.part.id); else sel.add(gg.part.id); anchor = gg.part.id; }
      else if (gg.shift && anchor && st.parts.some((x) => x.id === anchor)) {
        const list = sorted();
        const i0 = list.findIndex((x) => x.id === anchor), i1 = list.findIndex((x) => x.id === gg.part.id);
        for (let i = Math.min(i0, i1); i <= Math.max(i0, i1); i++) sel.add(list[i].id);
      } else { sel.clear(); sel.add(gg.part.id); anchor = gg.part.id; }
      seek(gg.part.in);
      return;
    }
    if (gg.kind === 'draw') {
      const d = drawing;
      drawing = null;
      if (d && d.out - d.in >= MIN_PART - 1e-6) {
        const before = snap();
        const part = { id: _id(), in: d.in, out: d.out };
        st.parts.push(part);
        sel.clear(); sel.add(part.id); anchor = part.id;
        seek(part.in);
        _commit(before);
        return;
      }
      draw();
      return;
    }
    // A press on empty wave: the playhead goes there; the pick is let go (not with Ctrl).
    if (!gg.ctrl) sel.clear();
    seek(gg.t0);
    if (e && gg.wasPlaying) video.play().catch(() => {});
  };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', () => { if (g && g.before) _restore(g.before); g = null; drawing = null; draw(); });

  cv.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const h = _hit(at(e));
    const part = h.part || null;
    if (part && !sel.has(part.id)) { sel.clear(); sel.add(part.id); anchor = part.id; draw(); }
    if (typeof o.onMenu === 'function') o.onMenu(e, { part: part ? { in: part.in, out: part.out, label: part.label || '' } : null });
  });

  // Alt + wheel - nearer or further, toward the pointer; the wheel alone scrolls while zoomed in.
  cv.addEventListener('wheel', (e) => {
    if (!(dur > 0)) return;
    const zoomed = v1 > v0 && (v1 - v0) < dur - 1e-6;
    if (!e.altKey && !zoomed) return;
    e.preventDefault();
    const s0 = span();
    if (e.altKey) {
      const t = tOf(at(e).x);
      const k = e.deltaY > 0 ? 1.25 : 0.8;
      const ns = Math.max(Math.min(1, dur), Math.min(dur, s0 * k));
      const f = (t - v0) / s0;
      v0 = Math.max(0, Math.min(dur - ns, t - f * ns));
      v1 = v0 + ns;
      if (ns >= dur - 1e-6) { v0 = 0; v1 = 0; }
    } else {
      const dx = (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) / W() * s0;
      v0 = Math.max(0, Math.min(dur - s0, v0 + dx));
      v1 = v0 + s0;
    }
    draw();
  }, { passive: false });

  // ── Playing only the fragments, one after another and round again ──
  let raf = 0;
  function _tick() {
    raf = 0;
    if (!alive || video.paused) { draw(); return; }
    if (!g && st.parts.length) {
      const list = normParts(sorted(), dur);
      const t = +video.currentTime || 0;
      const inside = list.some((p) => t >= p.in - 0.04 && t < p.out);
      if (!inside && list.length) {
        const next = list.find((p) => p.in > t) || list[0];
        try { video.currentTime = next.in; } catch (e) { /* not ready */ }
      }
    }
    draw();
    raf = requestAnimationFrame(_tick);
  }
  const onPlay = () => { if (!raf) raf = requestAnimationFrame(_tick); };
  const onTime = () => { if (video.paused) draw(); };
  const ready = () => { dur = +video.duration || 0; draw(); };
  video.addEventListener('play', onPlay);
  video.addEventListener('seeked', onTime);
  video.addEventListener('timeupdate', onTime);
  video.addEventListener('loadedmetadata', ready);
  if (!video.paused) onPlay();

  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => draw()) : null;
  if (ro) ro.observe(cv);
  requestAnimationFrame(draw);

  const api = {
    el,
    /** The fragments in the order of time - js/cuts/parts.js normParts. */
    parts: () => normParts(sorted().map((p) => ({ in: p.in, out: p.out, label: p.label })), dur),
    /** The picked ones, in the order of time. */
    picked: () => normParts(sorted().filter((p) => sel.has(p.id)).map((p) => ({ in: p.in, out: p.out, label: p.label })), dur),
    count: () => st.parts.length,
    dur: () => dur,
    /** Lay a whole set (the scenes): what was drawn goes - one step back brings it again ((в9)). */
    setParts(list) {
      const before = snap();
      st.parts = (list || []).map((p) => ({ id: _id(), in: r2(+p.in), out: r2(+p.out), ...(p.label ? { label: String(p.label) } : {}) }));
      sel.clear();
      anchor = '';
      _commit(before);
      draw();
    },
    setMarks(times) { marks = Array.isArray(times) ? times.slice() : []; st.marks = marks; draw(); },
    /** Take the picked fragments off (all of them when `all`). */
    del(all) {
      const before = snap();
      st.parts = all ? [] : st.parts.filter((p) => !sel.has(p.id));
      sel.clear();
      _commit(before);
      draw();
    },
    /** A key of the viewer's: true when it was the bar's. */
    key(e) {
      const k = String(e.key || '');
      const mod = e.ctrlKey || e.metaKey;
      if ((k === 'Delete' || k === 'Backspace') && sel.size && !mod) { api.del(); return true; }
      if (k === 'Escape' && sel.size) { sel.clear(); draw(); return true; }
      if (mod && !e.shiftKey && (k === 'z' || k === 'Z' || e.code === 'KeyZ')) {
        if (st.undo.length) { const cur = snap(); const prev = st.undo.pop(); st.redo.push(cur); _restore(prev); }
        return true;
      }
      if (mod && ((k === 'y' || k === 'Y' || e.code === 'KeyY') || (e.shiftKey && e.code === 'KeyZ'))) {
        if (st.redo.length) { const cur = snap(); const next = st.redo.pop(); st.undo.push(cur); _restore(next); }
        return true;
      }
      return false;
    },
    hasPick: () => sel.size > 0,
    redraw: draw,
    destroy() {
      alive = false;
      if (raf) cancelAnimationFrame(raf);
      if (ro) ro.disconnect();
      video.removeEventListener('play', onPlay);
      video.removeEventListener('seeked', onTime);
      video.removeEventListener('timeupdate', onTime);
      video.removeEventListener('loadedmetadata', ready);
      el.remove();
    },
  };
  return api;
}
