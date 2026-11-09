/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — a sound's waveform on its clip (phase V36, T4).

   The owner, 2026-10-23: "чтобы аудио дорожка показывала пики звука, чтобы можно было подрезать пользователю вручную
   тишину со смещением". Every clip on an audio lane - a sound, a track of music, a film's own sound - draws the peaks of
   its file (GET /api/track-peaks, lib/track-peaks.js: RATE a second, 0..255 of the file's loudest) for the part of the
   file the clip plays: from trimIn, at its speed, backwards when reversed. At any zoom: each pixel column is the loudest
   peak of the stretch of file under it.

   Only what can be seen is drawn - a canvas over the visible part of the clip and a margin either side, moved and drawn
   again as the lanes scroll (an hour of sound at the widest zoom would be a canvas 860 000 pixels wide). The timeline
   (js/merge-v3/timeline-b.js) builds the clips; this paints them: after every build, on scroll, and when a file's peaks
   arrive.

     paintWaves(host, zoom, gutter)   every .mv3b-wave under `host` (its clip on the element as __clip)
     paintWaveAs(host, cv, c, zoom, gutter)
                                      (phase V82) ONE canvas for the clip `c` as it is now - an edge being dragged (its
                                      start, length and trimIn not stored yet), or the ghost of what it was: so the wave
                                      stays where its sound is while an edge moves, and only what is trimmed goes
     onPeaks(cb)                      cb() when some file's peaks have just arrived - the timeline paints again
   ═══════════════════════════════════════════════════════════════════════════ */

const MARGIN = 300;               // px drawn beyond the visible edge either side, so a short scroll shows no blank
const FAINT = 0.4;                // (V49) a clip's own wave where it lies over an earlier sound of its lane
const _peaks = new Map();         // src -> { data: Uint8Array|null, rate, failed }
const _subs = [];

export function onPeaks(cb) { if (typeof cb === 'function') _subs.push(cb); }

function _want(src) {
  const key = String(src || '');
  if (!key) return null;
  let p = _peaks.get(key);
  if (p) return p;
  p = { data: null, rate: 200, failed: false };
  _peaks.set(key, p);
  fetch('/api/track-peaks?src=' + encodeURIComponent(key))
    .then(async (r) => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      p.rate = +(r.headers.get('X-Peaks-Rate') || 200) || 200;
      p.data = new Uint8Array(await r.arrayBuffer());
      for (const cb of _subs) { try { cb(key); } catch (e) { /* a listener's own trouble */ } }
    })
    // A file gone or with no sound: the clip shows no wave, and is not asked again until the page is opened again.
    .catch(() => { p.failed = true; });
  return p;
}

function _draw(cv, c, z, x0, x1) {
  const p = _want(c.src);
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const cssW = Math.max(1, x1 - x0);
  const cssH = Math.max(4, cv.clientHeight || 20);
  const W = Math.round(cssW * dpr), H = Math.round(cssH * dpr);
  cv.style.left = x0 + 'px';
  cv.style.width = cssW + 'px';
  if (cv.width !== W) cv.width = W;
  if (cv.height !== H) cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  if (!p || !p.data || !p.data.length) return;
  const data = p.data, rate = p.rate, n = data.length;
  const sp = Math.max(0.25, Math.min(4, +c.speed || 1));
  const tin = Math.max(0, +c.trimIn || 0);
  const dur = Math.max(0, +c.dur || 0);
  const rev = !!c.reversed;
  const mid = H / 2;
  // (phase V73 block 5, 5c) the wave's colour is the sheet's (--muted, --ink picked); with none, the same quiet grey - not the
  // old green
  ctx.fillStyle = getComputedStyle(cv).color || '#a1a1a6';
  // (phase V49, (пр2) а) Where the clip lies over an earlier sound of its lane (timeline-b.js _overlaps: seconds from its
  // start) it is see-through, and its own wave is drawn faint there, so the wave under it reads.
  const over = (cv.parentElement && cv.parentElement.__over) || null;
  const faint = (x) => !!over && over.some(([a, b]) => x / z >= a && x / z < b);
  let dim = false;
  ctx.globalAlpha = 1;
  // The file's time at a pixel of the clip (in css px from the clip's left edge).
  const fileAt = (x) => {
    const t = Math.max(0, Math.min(dur, x / z));
    return tin + (rev ? (dur - t) : t) * sp;
  };
  for (let px = 0; px < W; px++) {
    const xa = x0 + px / dpr, xb = x0 + (px + 1) / dpr;
    if (over) { const f = faint(xa); if (f !== dim) { dim = f; ctx.globalAlpha = f ? FAINT : 1; } }
    let a = fileAt(xa), b = fileAt(xb);
    if (a > b) { const s = a; a = b; b = s; }
    let i0 = Math.floor(a * rate), i1 = Math.max(i0 + 1, Math.ceil(b * rate));
    if (i0 >= n) break;
    i1 = Math.min(n, i1);
    let m = 0;
    for (let i = i0; i < i1; i++) if (data[i] > m) m = data[i];
    // At least a hair at the middle: silence is a flat line, not nothing.
    const h = Math.max(1, (m / 255) * (H - 2));
    ctx.fillRect(px, mid - h / 2, 1, h);
  }
}

// One canvas: the part of the clip `c` that can be seen (and a margin), laid from the clip's own left edge.
function _paint(host, cv, c, z, gutter) {
  const visL = host.scrollLeft, visR = host.scrollLeft + Math.max(0, host.clientWidth - (+gutter || 0));
  const L = (+c.start || 0) * z, R = L + (+c.dur || 0) * z;
  const a = Math.max(L, visL - MARGIN), b = Math.min(R, visR + MARGIN);
  if (b <= a) { cv.style.display = 'none'; return; }
  cv.style.display = '';
  _draw(cv, c, z, a - L, b - L);
}

/** Draw the waves of every audio clip under `host` for the part of each that can be seen. */
export function paintWaves(host, zoom, gutter) {
  if (!host) return;
  const z = +zoom || 60;
  for (const cv of host.querySelectorAll('canvas.mv3b-wave')) {
    const el = cv.parentElement;
    const c = el && el.__clip;
    if (!c || !c.src) continue;
    _paint(host, cv, c, z, gutter);
  }
}

/** (phase V82) One canvas for the clip `c` as it is now (an edge being dragged) or was (its ghost) - see the head. */
export function paintWaveAs(host, cv, c, zoom, gutter) {
  if (!host || !cv || !c || !c.src) return;
  _paint(host, cv, c, +zoom || 60, gutter);
}
