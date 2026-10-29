/* ═══════════════════════════════════════════════════════════════════════════
   A SOUND'S WAVE WITH A RULER (phase V54, the owner 2026-10-27: "нужно во первых добавить линейку для того чтобы двигать
   плейхед, а то сейчас двигаются только рамки") - ONE module for the music player of the Library (js/sound/player.js) and
   the Cut window (js/sound/cut-window.js).

   A canvas of two bands: the RULER on top - its seconds - and the WAVE under it from the server's peaks (GET
   /api/track-peaks, lib/track-peaks.js: 200 a second, 0..255 of the file's loudest - nothing is decoded in the page; the
   tile's 64 points stand in while they come, or when they cannot). The piece lies between two gold handles - a line
   through the wave and a FLAG on the ruler, drawn over its ticks so it is always seen; and the playhead, always shown -
   ▶ plays from it.

   One rule for the player and the Cut window (the owner 2026-10-28: "желтые флажки должны перекрывать линейку, чтобы их
   видно было и перетаскивание флажков строго по линейке, а проигрывание и перестановка плейхеда по клику на волну"):
   a handle is taken and dragged ONLY by its flag on the ruler; a press on the wave moves the playhead there (and a drag
   on it goes on moving it); a press on the ruler away from the flags does nothing. Cursors: ew-resize over a flag,
   pointer over the wave, the plain arrow over the rest of the ruler.

   "CUT" BY THE RIGHT FLAG (phase V59, the owner 2026-10-29: "кнопка cut должна быть активной, когда выбран фрагмент на
   волне, сейчас cut при флажках по самым краям, оригинал трека, сохраняет трек еще раз ... кнопка cut будет появляться
   справа от правого флажка, когда выбран фрагмент трека"; (мг11) the Cut window the same): with `cut` given, a button on
   the ruler right of the right flag - only while a PIECE is marked (the flags not at the very ends; the whole sound is
   not cut into a second copy of itself). It follows the flag as it is dragged; when the flag is at the very end it stands
   inside the wave, left of the flags. Its press is `cut.onCut(a, b)`; the button waits while what it answers goes.

     scrubber({ src, dur, wave, height, handles, range: [a, b], onSeek(t), onRange(a, b), cut: { title, onCut(a, b) } })
       -> { el, setTime(t), time(), setRange(a, b), range(), piece(), dur(), dragging(), redraw(), destroy() }
   ═══════════════════════════════════════════════════════════════════════════ */

const RULER = 16;          // the ruler's band, px
const FLAG = 10;           // a handle's flag on the ruler: its width from the pole, px
const FLAG_H = 12;         // ... and its height from the ruler's top
const GRAB = 3;            // a flag is taken this much past its edges, px
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
  const o = Object.assign({ height: 48, handles: true, onSeek: () => {}, onRange: () => {} }, opts || {});
  const el = document.createElement('div');
  el.className = 'snd-scrub';
  const cv = document.createElement('canvas');
  cv.className = 'snd-scrub-cv';
  cv.style.height = (RULER + o.height) + 'px';
  el.appendChild(cv);
  // (phase V59) "Cut" by the right flag - on the ruler, shown only while a piece is marked (css/sound.css .snd-scrub-cut).
  let cutBtn = null, cutW = 0;
  if (o.handles && o.cut && typeof o.cut.onCut === 'function') {
    cutBtn = document.createElement('button');
    cutBtn.type = 'button';
    cutBtn.className = 'snd-scrub-cut';
    cutBtn.textContent = 'Cut';
    cutBtn.title = o.cut.title || 'The piece between the gold flags becomes a new sound - this one stays as it is';
    cutBtn.style.height = RULER + 'px';
    cutBtn.hidden = true;
    cutBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    cutBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (cutBtn.disabled || _whole()) return;
      cutBtn.disabled = true;
      Promise.resolve().then(() => o.cut.onCut(a, b)).catch(() => {}).then(() => { if (cutBtn) cutBtn.disabled = false; });
    });
    el.appendChild(cutBtn);
  }

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
  // The piece is the whole sound - its flags at the very ends: drawn plain, nothing to cut.
  const _whole = () => !o.handles || !(dur > 0) || (a <= 0.01 && b >= dur - 0.01);

  // A handle's flag: its pole at the handle, the cloth towards the inside of the piece ('a' to the right, 'b' to the
  // left) - turned the other way when that side has no room at the edge of the canvas. The drawing and the press read it.
  function _flag(which) {
    const x = Math.round(xOf(which === 'a' ? a : b));
    let dir = which === 'a' ? 1 : -1;
    if (dir > 0 && x + FLAG > W()) dir = -1;
    else if (dir < 0 && x - FLAG < 0) dir = 1;
    return { x, dir, x0: Math.min(x, x + dir * FLAG), x1: Math.max(x, x + dir * FLAG) };
  }

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
    const whole = _whole();
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
    // The handles' lines through the wave.
    if (o.handles) {
      g.fillStyle = gold;
      g.fillRect(Math.round(xa) - 1, top, 2, hh); g.fillRect(Math.round(xb) - 1, top, 2, hh);
    }
    // The playhead: a line over both bands, a mark on the ruler.
    const xp = xOf(t);
    g.fillStyle = head;
    g.fillRect(Math.round(xp) - 0.5, 0, 1.5, h);
    g.beginPath();
    g.moveTo(xp - 5, 0); g.lineTo(xp + 5, 0); g.lineTo(xp, 7); g.closePath();
    g.fill();
    // The flags last, over the ruler's ticks and labels and the playhead's mark: a pole down the ruler and a cloth with
    // a notch - what is taken to move a handle.
    if (o.handles) {
      g.fillStyle = gold;
      for (const k of ['a', 'b']) {
        const f = _flag(k);
        const tip = f.x + f.dir * FLAG;
        g.fillRect(f.x - 1, 0, 2, RULER);
        g.beginPath();
        g.moveTo(f.x, 0); g.lineTo(tip, 0); g.lineTo(tip - f.dir * 3, FLAG_H / 2); g.lineTo(tip, FLAG_H); g.lineTo(f.x, FLAG_H);
        g.closePath();
        g.fill();
      }
    }
    _placeCut(w, whole);
  }

  // (phase V59) "Cut" right of the right flag's pole; with no room there (the flag at the very end) inside the wave, left
  // of the right flag - and left of the left one too when the piece is too short for it between them.
  function _placeCut(w, whole) {
    if (!cutBtn) return;
    cutBtn.hidden = whole;
    if (whole) return;
    cutW = cutBtn.offsetWidth || cutW || 32;
    const fb = _flag('b'), fa = _flag('a');
    let left = fb.x1 + 4;
    if (left + cutW > w - 1) {
      left = fb.x0 - 4 - cutW;
      if (left + cutW > fa.x0 - GRAB && left < fa.x1 + GRAB) left = fa.x0 - GRAB - 2 - cutW;
    }
    cutBtn.style.left = Math.round(Math.max(0, left)) + 'px';
  }

  // ── The pointer ──
  let drag = null;           // 'seek' | 'a' | 'b'
  const at = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  // What a press at p takes: on the ruler a flag (the one whose pole is nearer when two overlap) or nothing; on the
  // wave the playhead.
  function _what(p) {
    if (p.y >= RULER) return 'seek';
    if (!o.handles) return null;
    let best = null, bd = Infinity;
    for (const k of ['a', 'b']) {
      const f = _flag(k);
      if (p.x < f.x0 - GRAB || p.x > f.x1 + GRAB) continue;
      const d = Math.abs(p.x - f.x);
      if (d < bd) { bd = d; best = k; }
    }
    return best;
  }
  let off = 0;               // where in its flag a handle was taken, px - kept while it is dragged
  function _apply(p) {
    if (drag === 'seek') { t = tOf(p.x); draw(); o.onSeek(t); return; }
    const s = tOf(p.x - off);
    if (drag === 'a') a = Math.max(0, Math.min(s, b - MIN_PIECE));
    else b = Math.min(dur, Math.max(s, a + MIN_PIECE));
    draw();
    o.onRange(a, b);
  }
  cv.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !(dur > 0)) return;
    drag = _what(at(e));
    if (!drag) return;
    cv.setPointerCapture(e.pointerId);
    // A flag taken keeps where in it the press was - it does not jump to the pointer; the wave moves the playhead at once.
    if (drag === 'seek') { off = 0; _apply(at(e)); } else off = at(e).x - xOf(drag === 'a' ? a : b);
  });
  cv.addEventListener('pointermove', (e) => {
    if (drag) { _apply(at(e)); return; }
    const w = _what(at(e));
    cv.style.cursor = w === 'seek' ? 'pointer' : (w ? 'ew-resize' : 'default');
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
    // (phase V59) a piece is marked - the flags are not at the very ends
    piece: () => !_whole(),
    dur: () => dur,
    dragging: () => !!drag,
    redraw: draw,
    destroy() { alive = false; if (ro) ro.disconnect(); el.remove(); cutBtn = null; },
  };
}

/** "0:41" - a position or a length as the player and the Cut window say it; `tenths` for a short sound: "0:03.4". */
export function clock(s, tenths) {
  const v = Math.max(0, +s || 0);
  const m = Math.floor(v / 60);
  const r = v - m * 60;
  return m + ':' + String(Math.floor(r)).padStart(2, '0') + (tenths ? '.' + Math.floor((r % 1) * 10) : '');
}
