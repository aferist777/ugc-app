/* ═══════════════════════════════════════════════════════════════════════════
   THE AUDIO LAB - one player for every tile and every result (phase V34.D, the owner 2026-10-22: "плитки с формой волны,
   нажатие - играет и останавливает"). One <audio> for the page: a press on a tile plays it from the start, a second press
   (or a press on another tile) stops it. The playing tile's waveform carries a running line. Nothing on hover.

     waveEl(wave, opts)          an SVG of the 64 points (0..100) - bars, or a flat line when there is none yet
     playToggle(path, host)      play `path`, its progress drawn on `host` (an element with a .la-wave inside); again - stop
     stop()                      stop whatever plays
     playing()                   the path playing now, or ''
   ═══════════════════════════════════════════════════════════════════════════ */

const NS = 'http://www.w3.org/2000/svg';
let _audio = null;
let _path = '';
let _host = null;
let _raf = 0;
const _listeners = new Set();

export function onChange(fn) { _listeners.add(fn); return () => _listeners.delete(fn); }
function _tell() { for (const fn of _listeners) { try { fn(_path); } catch (e) { /* a listener's own */ } } }

/** The waveform: 64 bars, mirrored around the middle. */
export function waveEl(wave, opts) {
  const o = opts || {};
  const w = Array.isArray(wave) ? wave : [];
  const n = w.length || 64;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'la-wave' + (o.cls ? ' ' + o.cls : ''));
  svg.setAttribute('viewBox', `0 0 ${n * 3} 40`);
  svg.setAttribute('preserveAspectRatio', 'none');
  if (!w.length) {
    const l = document.createElementNS(NS, 'rect');
    l.setAttribute('x', '0'); l.setAttribute('y', '19'); l.setAttribute('width', String(n * 3)); l.setAttribute('height', '2');
    l.setAttribute('class', 'la-wave-flat');
    svg.appendChild(l);
  } else {
    for (let i = 0; i < n; i++) {
      const h = Math.max(1.5, (Math.max(0, Math.min(100, +w[i] || 0)) / 100) * 38);
      const r = document.createElementNS(NS, 'rect');
      r.setAttribute('x', String(i * 3 + 0.5)); r.setAttribute('width', '2');
      r.setAttribute('y', String(20 - h / 2)); r.setAttribute('height', String(h));
      svg.appendChild(r);
    }
  }
  const head = document.createElementNS(NS, 'rect');
  head.setAttribute('class', 'la-wave-head');
  head.setAttribute('x', '0'); head.setAttribute('y', '0'); head.setAttribute('width', '1.5'); head.setAttribute('height', '40');
  head.style.display = 'none';
  svg.appendChild(head);
  return svg;
}

function _paint() {
  _raf = 0;
  if (!_audio || !_host) return;
  const svg = _host.querySelector('.la-wave');
  const head = svg && svg.querySelector('.la-wave-head');
  if (head) {
    const d = _audio.duration || 0;
    const f = d > 0 ? Math.min(1, _audio.currentTime / d) : 0;
    const vb = svg.viewBox.baseVal;
    head.setAttribute('x', String(f * (vb ? vb.width : 192)));
    head.style.display = '';
  }
  if (!_audio.paused) _raf = requestAnimationFrame(_paint);
}

function _clear() {
  if (_raf) cancelAnimationFrame(_raf);
  _raf = 0;
  if (_host) {
    _host.classList.remove('is-playing');
    const head = _host.querySelector('.la-wave-head');
    if (head) head.style.display = 'none';
  }
  _host = null;
  _path = '';
  _tell();
}

export function stop() {
  if (_audio) { try { _audio.pause(); } catch (e) { /* gone */ } }
  _clear();
}

export function playing() { return _path; }

/** Play `path` with its progress on `host`; the same path again stops it. Resolves once it starts (or fails). */
export async function playToggle(path, host) {
  if (_path && _path === path) { stop(); return false; }
  stop();
  if (!_audio) {
    _audio = new Audio();
    _audio.preload = 'auto';
    _audio.addEventListener('ended', () => _clear());
    _audio.addEventListener('error', () => _clear());
  }
  _path = path;
  _host = host || null;
  if (_host) _host.classList.add('is-playing');
  _audio.src = path;
  _tell();
  try {
    await _audio.play();
    _raf = requestAnimationFrame(_paint);
    return true;
  } catch (e) {
    _clear();
    return false;
  }
}

/** Seconds as a tile says them. */
export function secs(s) {
  const t = +s || 0;
  if (t <= 0) return '';
  if (t < 10) return t.toFixed(1) + ' s';
  if (t < 60) return Math.round(t) + ' s';
  return Math.floor(t / 60) + ':' + String(Math.round(t % 60)).padStart(2, '0');
}
