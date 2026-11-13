/* ═══════════════════════════════════════════════════════════════════════════
   A SOUND'S WAVEFORM ON ITS TILE - 64 points, 0..100 of the sound's own loudest (lib/audio-wave.js, the
   built-in set's own measure), drawn as bars mirrored round the middle. Merge's Library panel, the Library's Media shelf,
   the online search and the sound window draw the same.

     waveEl(wave, cls)    an SVG; a flat line while a sound has no waveform yet (it is measured in the background)
   ═══════════════════════════════════════════════════════════════════════════ */

const NS = 'http://www.w3.org/2000/svg';

export function waveEl(wave, cls) {
  const w = Array.isArray(wave) ? wave : [];
  const n = w.length || 64;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'snd-wave' + (cls ? ' ' + cls : ''));
  svg.setAttribute('viewBox', `0 0 ${n * 3} 40`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  if (!w.length) {
    const l = document.createElementNS(NS, 'rect');
    l.setAttribute('x', '0'); l.setAttribute('y', '19'); l.setAttribute('width', String(n * 3)); l.setAttribute('height', '2');
    l.setAttribute('class', 'snd-wave-flat');
    svg.appendChild(l);
    return svg;
  }
  for (let i = 0; i < n; i++) {
    const h = Math.max(1.5, (Math.max(0, Math.min(100, +w[i] || 0)) / 100) * 38);
    const r = document.createElementNS(NS, 'rect');
    r.setAttribute('x', String(i * 3 + 0.5)); r.setAttribute('width', '2');
    r.setAttribute('y', String(20 - h / 2)); r.setAttribute('height', String(h));
    svg.appendChild(r);
  }
  return svg;
}

/** Seconds as a tile says them. */
export function secs(s) {
  const t = +s || 0;
  if (t <= 0) return '';
  if (t < 10) return t.toFixed(1) + ' s';
  if (t < 60) return Math.round(t) + ' s';
  return Math.floor(t / 60) + ':' + String(Math.round(t % 60)).padStart(2, '0');
}
