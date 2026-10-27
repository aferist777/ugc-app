/* ═══════════════════════════════════════════════════════════════════════════
   A SOUND'S WAVE WITH A RULER (phase V54, the owner 2026-10-27: "нужно во первых добавить линейку для того чтобы двигать
   плейхед, а то сейчас двигаются только рамки") - ONE module for the music player of the Library (js/sound/player.js) and
   the Cut window (js/sound/cut-window.js).

   A canvas of two bands: the RULER on top - its seconds; a press and a drag on it move the playhead - and the WAVE under it
   from the server's peaks (GET /api/track-peaks, lib/track-peaks.js: 200 a second, 0..255 of the file's loudest - nothing
   is decoded in the page; the tile's 64 points stand in while they come, or when they cannot). Over the wave: the piece
   between two gold handles, and the playhead, always shown - ▶ plays from it.

   On the wave a handle is grabbed within a few pixels of it; a press elsewhere does what the owner of the wave says:
   `press: 'seek'` moves the playhead (the player), `press: 'handle'` brings the nearer handle there (the Cut window).

     scrubber({ src, dur, wave, height, handles, press, range: [a, b], onSeek(t), onRange(a, b) })
       -> { el, setTime(t), time(), setRange(a, b), range(), dur(), redraw(), destroy() }
   ═══════════════════════════════════════════════════════════════════════════ */

const RULER = 16;          // the ruler's band, px
const GRAB = 7;            // how near a handle a press takes it, px
const MIN_PIECE = 0.1;     // the shortest piece, s - lib/audio-cut.js refuses less

// Seconds as a ruler says them: a sound under a minute in seconds ("0.5 s", "12 s"), a longer one as "1:30".
function _label(t, step, dur) {
  if (dur < 60) return (step < 1 ? t.toFixed(1) : String(Math.round(t))) + ' s';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  const ss = step < 1 ? s.toFixed(1) : String(Math.round(s));
  return m + ':' + (s < 10 ? '0' : '') + ss;
}

// A step between labelled ticks that leaves at least 56 px between labels.
function _step(dur, w) {
  const pps = w / Math.max(0.001, dur);
  for (const s of [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800]) if (s * pps >= 56) return s;
  return 3600;
}

export function scrubber(opts) {
  const o = Object.assign({ height: 48, handles: true, press: 'seek', onSeek: () => {}, onRange: () => {} }, opts || {});
  const el = document.createElement('div');
  el.className = 'snd-scrub';
  const cv = document.createElement('canvas');
  cv.className = 'snd-scrub-cv';
  cv.style.height = (RULER + o.height) + 'px';
  el.appendChild(cv);

  let dur = +o.dur || 0;
  let t = 0;
  let a = 0, b = dur;
  if (Array.isArray(o.range)) { a = +o.range[0] || 0; b = +o.range[1] || dur; }
  // The wave: the server's peaks once they come; until then (or when they cannot) the tile's 64 points.
  let peaks = null, rate = 200;
  const fallback = (Array.isArray(o.wave) ? o.wave : []).map(v => Math.max(0, Math.min(255, (+v || 0) * 2.55)));
  let alive = true;
  if (o.src) {
    fetch('/api/track-peaks?src=' + encodeURIComponent(String(o.src).split('?')[0]))
      .then(r => (r.ok ? Promise.all([r.arrayBuffer(), r.headers.get('X-Peaks-Rate')]) : null))
      .then(x => {
        if (!x || !alive) return;
        peaks = new Uint8Array(x[0]);
        rate = +x[1] || 200;
        if (!(dur > 0) && peaks.length) { dur = peaks.length / rate; if (!(b > 0)) b = dur; }
        draw();
      })
      .catch(() => { /* the tile's wave stays */ });
  }

  const W = () => cv.clientWidth || 600;
  const H = () => RULER + o.height;
  const xOf = (s) => (dur > 0 ? (s / dur) * W() : 0);
  const tOf = (x) => (dur > 0 ? Math.max(0, Math.min(dur, (x / W()) * dur)) : 0);

  // The loudest peak under each column of pixels.
  function _column(x0, x1) {
    if (peaks && peaks.length && dur > 0) {
      const i0 = Math.floor((x0 / W()) * dur * rate), i1 = Math.max(i0 + 1, Math.ceil((x1 / W()) * dur * rate));
      let m = 0;
      for (let i = i0; i < i1 && i < peaks.length; i++) if (peaks[i] > m) m = peaks[i];
      return m / 255;
    }
    if (fallback.length) {
      const i = Math.min(fallback.length - 1, Math.floor((x0 / W()) * fallback.length));
      return fallback[i] / 255;
    }
    return 0;
  }

  function draw() {
    if (!alive) return;
    const w = W(), h = H();
    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const css = getComputedStyle(el);
    const ink = css.getPropertyValue('--muted').trim() || '#999';
    const gold = css.getPropertyValue('--gold').trim() || '#d9b45a';
    const line = css.getPropertyValue('--border-soft').trim() || 'rgba(255,255,255,.12)';
    const head = css.getPropertyValue('--ink').trim() || '#fff';

    // The ruler: a tick every step, labelled; small ticks between.
    g.fillStyle = 'rgba(255,255,255,0.03)';
    g.fillRect(0, 0, w, RULER);
    g.fillStyle = line;
    g.fillRect(0, RULER - 1, w, 1);
    if (dur > 0) {
      const step = _step(dur, w);
      const minor = step / 5;
      g.font = '9px system-ui, sans-serif';
      g.textBaseline = 'top';
      for (let k = 0; k * minor <= dur + 1e-6; k++) {
        const s = k * minor;
        const x = Math.round(xOf(s)) + 0.5;
        const big = k % 5 === 0;
        g.fillStyle = big ? ink : line;
        g.fillRect(x, big ? RULER - 7 : RULER - 4, 1, big ? 6 : 3);
        if (big && x < w - 24) { g.fillStyle = ink; g.fillText(_label(s, step, dur), x + 3, 1); }
      }
    }

    // The wave, mirrored round its middle. A piece marked is gold; while the piece is the whole sound the wave is plain,
    // what has played lit (--primary).
    const top = RULER, hh = o.height;
    const xa = xOf(a), xb = xOf(b);
    const whole = !o.handles || (a <= 0.01 && b >= dur - 0.01);
    if (o.handles && !whole) {
      g.fillStyle = 'rgba(255,255,255,0.06)';
      g.fillRect(xa, top, Math.max(0, xb - xa), hh);
    }
    const lit = css.getPropertyValue('--primary').trim() || '#6d8cff';
    const xp0 = xOf(t);
    const bar = Math.max(1, Math.min(3, w / 300));
    for (let x = 0; x < w; x += bar + 1) {
      const v = _column(x, x + bar + 1);
      const bh = Math.max(1, v * (hh - 6));
      if (whole) { g.fillStyle = x < xp0 ? lit : ink; g.globalAlpha = x < xp0 ? 0.95 : 0.6; }
      else {
        const inside = x + bar >= xa && x <= xb;
        g.fillStyle = inside ? gold : ink;
        g.globalAlpha = inside ? 0.9 : 0.4;
      }
      g.fillRect(x, top + (hh - bh) / 2, bar, bh);
    }
    g.globalAlpha = 1;
    if (o.handles) {
      g.fillStyle = gold;
      g.fillRect(xa - 1, top, 2, hh); g.fillRect(xb - 1, top, 2, hh);
      g.fillRect(xa - 1, top, 7, 5); g.fillRect(xb - 6, top + hh - 5, 7, 5);
    }
    // The playhead: a line over both bands, a mark on the ruler.
    const xp = xOf(t);
    g.fillStyle = head;
    g.fillRect(Math.round(xp) - 0.5, 0, 1.5, h);
    g.beginPath();
    g.moveTo(xp - 5, 0); g.lineTo(xp + 5, 0); g.lineTo(xp, 7); g.closePath();
    g.fill();
  }

  // ── The pointer ──
  let drag = null;           // 'seek' | 'a' | 'b'
  const at = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  function _what(p) {
    if (p.y < RULER) return 'seek';
    if (o.handles) {
      const da = Math.abs(p.x - xOf(a)), db = Math.abs(p.x - xOf(b));
      if (Math.min(da, db) <= GRAB) return da <= db ? 'a' : 'b';
    }
    if (o.press === 'handle' && o.handles) { const s = tOf(p.x); return Math.abs(s - a) <= Math.abs(s - b) ? 'a' : 'b'; }
    return 'seek';
  }
  function _apply(p) {
    const s = tOf(p.x);
    if (drag === 'seek') { t = s; draw(); o.onSeek(t); return; }
    if (drag === 'a') a = Math.max(0, Math.min(s, b - MIN_PIECE));
    else b = Math.min(dur, Math.max(s, a + MIN_PIECE));
    draw();
    o.onRange(a, b);
  }
  cv.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !(dur > 0)) return;
    drag = _what(at(e));
    cv.setPointerCapture(e.pointerId);
    _apply(at(e));
  });
  cv.addEventListener('pointermove', (e) => {
    if (drag) { _apply(at(e)); return; }
    const w = _what(at(e));
    cv.style.cursor = w === 'seek' ? (at(e).y < RULER ? 'col-resize' : 'pointer') : 'ew-resize';
  });
  const up = () => { drag = null; };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);

  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => draw()) : null;
  if (ro) ro.observe(cv);
  requestAnimationFrame(draw);

  return {
    el,
    setTime(s) { t = Math.max(0, Math.min(dur || 0, +s || 0)); draw(); },
    time: () => t,
    setRange(x, y) {
      a = Math.max(0, +x || 0);
      b = Math.min(dur || +y || 0, +y || 0);
      if (b - a < MIN_PIECE) b = Math.min(dur, a + MIN_PIECE);
      draw();
    },
    range: () => [a, b],
    dur: () => dur,
    dragging: () => !!drag,
    redraw: draw,
    destroy() { alive = false; if (ro) ro.disconnect(); el.remove(); },
  };
}

/** "0:41" - a position or a length as the player and the Cut window say it; `tenths` for a short sound: "0:03.4". */
export function clock(s, tenths) {
  const v = Math.max(0, +s || 0);
  const m = Math.floor(v / 60);
  const r = v - m * 60;
  return m + ':' + String(Math.floor(r)).padStart(2, '0') + (tenths ? '.' + Math.floor((r % 1) * 10) : '');
}
