/* ═══════════════════════════════════════════════════════════════════════════
   THE AUDIO LAB - cutting a piece out of a sound (phase V34.D; the owner 2026-10-22, (з8): "вырезка тоже нужна"), as a
   video's piece is cut (js/cut.js): the sound drawn large, two handles, the piece played by itself, "save to" a category of
   My sounds - and the piece becomes a NEW sound there (POST /api/audio/cut, lib/audio-cut.js). The sound it was cut from -
   built-in, own, or a track of Music - is not touched.

   The window is on the layer stack (js/layers.js): Escape closes it. Space plays the piece.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as Layers from '../layers.js';
import { stop as stopTiles } from './audio-play.js';

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const fmt = (s, long) => (long ? Math.floor(s / 60) + ':' + (s % 60).toFixed(1).padStart(4, '0') : s.toFixed(2) + ' s');

// The sound's own peaks, read in the page (WebAudio) - 600 of them for a window this wide; the tile's 64 when it cannot be.
async function _peaks(path, fallback) {
  try {
    const buf = await (await fetch(path)).arrayBuffer();
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const audio = await ac.decodeAudioData(buf);
    ac.close();
    const ch = audio.getChannelData(0);
    const n = 600, out = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      const a = Math.floor(i * ch.length / n), b = Math.floor((i + 1) * ch.length / n);
      let m = 0;
      for (let j = a; j < b; j += 4) { const v = Math.abs(ch[j]); if (v > m) m = v; }
      out[i] = m;
    }
    const top = Math.max(1e-6, ...out);
    return { peaks: out.map(v => v / top), dur: audio.duration };
  } catch (e) {
    return { peaks: (fallback || []).map(v => (+v || 0) / 100), dur: 0 };
  }
}

/**
 * Open the window for `it` (a tile: { kind, id, name, path, dur, wave, categoryId }).
 * opts: { cats: [{ id, label }], cat: the category offered first, done(item) }
 */
export async function openCut(it, opts) {
  const o = opts || {};
  stopTiles();
  const back = el('div', 'la-back');
  const win = el('div', 'la-win la-cut');
  const head = el('div', 'la-win-head');
  head.appendChild(el('b', null, 'Cut a piece'));
  head.appendChild(el('span', 'la-muted', it.name));
  const x = el('button', 'hp-x', '✕');
  x.type = 'button';
  head.appendChild(x);
  win.appendChild(head);

  const stage = el('div', 'la-cut-stage');
  const cv = el('canvas', 'la-cut-cv');
  stage.appendChild(cv);
  win.appendChild(stage);
  const info = el('div', 'la-cut-info', 'reading the sound…');
  win.appendChild(info);

  const row = el('div', 'la-cut-row');
  const play = el('button', 'la-btn', '▶ the piece');
  const whole = el('button', 'la-btn', '▶ the whole sound');
  play.type = whole.type = 'button';
  row.append(play, whole);
  row.appendChild(el('span', 'sp'));
  row.appendChild(el('span', 'la-muted', 'save to'));
  const sel = el('select', 'la-sel');
  for (const c of [{ id: '', label: 'Uncategorized' }].concat(o.cats || [])) {
    const op = el('option', null, c.label);
    op.value = c.id;
    sel.appendChild(op);
  }
  sel.value = (o.cats || []).some(c => c.id === o.cat) ? o.cat : '';
  row.appendChild(sel);
  const go = el('button', 'la-btn is-primary', 'Cut');
  go.type = 'button';
  row.appendChild(go);
  win.appendChild(row);
  const err = el('div', 'la-err');
  win.appendChild(err);

  document.body.append(back, win);
  const layer = Layers.open(win, { modal: true, onEsc: () => close() });
  const audio = new Audio(it.path);
  let raf = 0;
  let onResize = () => {};
  const close = () => {
    try { audio.pause(); } catch (e) { /* gone */ }
    if (raf) cancelAnimationFrame(raf);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', onResize);
    back.remove(); win.remove(); Layers.close(layer);
  };
  x.addEventListener('click', close);
  back.addEventListener('click', close);

  const { peaks, dur: d0 } = await _peaks(it.path, it.wave);
  const dur = d0 || +it.dur || 1;
  const long = dur >= 60;
  let a = 0, b = dur;
  // A piece offered at first: the middle third of a long sound, the whole of a short one.
  if (dur > 8) { a = dur / 3; b = Math.min(dur, a + Math.min(10, dur / 3)); }
  let playEnd = 0;          // where playing stops: the piece's end, or the sound's

  const W = () => cv.clientWidth || 640;
  const H = 120;
  const draw = () => {
    const w = W();
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(w * dpr); cv.height = Math.round(H * dpr);
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, H);
    const css = getComputedStyle(win);
    const ink = css.getPropertyValue('--muted').trim() || '#999';
    const gold = css.getPropertyValue('--gold').trim() || '#d9b45a';
    const xa = (a / dur) * w, xb = (b / dur) * w;
    g.fillStyle = 'rgba(255,255,255,0.06)';
    g.fillRect(xa, 0, xb - xa, H);
    const n = peaks.length || 1;
    for (let i = 0; i < n; i++) {
      const x0 = (i / n) * w;
      const h = Math.max(1, peaks[i] * (H - 10));
      const inside = x0 >= xa && x0 <= xb;
      g.fillStyle = inside ? gold : ink;
      g.globalAlpha = inside ? 0.95 : 0.45;
      g.fillRect(x0, (H - h) / 2, Math.max(1, w / n - 0.6), h);
    }
    g.globalAlpha = 1;
    g.fillStyle = gold;
    g.fillRect(xa - 1, 0, 2, H); g.fillRect(xb - 1, 0, 2, H);
    g.fillRect(xa - 5, 0, 10, 6); g.fillRect(xb - 5, H - 6, 10, 6);
    if (!audio.paused) {
      g.fillStyle = '#fff';
      g.fillRect((audio.currentTime / dur) * w - 0.5, 0, 1.5, H);
    }
    info.textContent = 'from ' + fmt(a, long) + ' to ' + fmt(b, long) + ' · ' + (b - a).toFixed(2) + ' s of ' + fmt(dur, long)
      + ' - drag the gold handles; a press elsewhere moves the nearer one';
  };
  const tick = () => {
    raf = 0;
    if (!audio.paused && audio.currentTime >= playEnd) audio.pause();
    draw();
    if (!audio.paused) raf = requestAnimationFrame(tick);
  };
  const startAt = (from, to) => {
    audio.currentTime = from;
    playEnd = to;
    audio.play().then(() => { if (!raf) raf = requestAnimationFrame(tick); }).catch(() => {});
  };
  play.addEventListener('click', () => { if (!audio.paused) { audio.pause(); draw(); } else startAt(a, b); });
  whole.addEventListener('click', () => { if (!audio.paused) { audio.pause(); draw(); } else startAt(0, dur); });
  const onKey = (e) => {
    if (!Layers.topIs(layer) || e.key !== ' ' || e.target === sel) return;
    e.preventDefault();
    play.click();
  };
  document.addEventListener('keydown', onKey, true);

  // The handles: the nearer one follows the pointer.
  let drag = null;
  const tAt = (e) => { const r = cv.getBoundingClientRect(); return Math.max(0, Math.min(dur, ((e.clientX - r.left) / r.width) * dur)); };
  cv.addEventListener('pointerdown', (e) => {
    const t = tAt(e);
    drag = Math.abs(t - a) <= Math.abs(t - b) ? 'a' : 'b';
    cv.setPointerCapture(e.pointerId);
    move(e);
  });
  const move = (e) => {
    if (!drag) return;
    const t = tAt(e);
    if (drag === 'a') a = Math.min(t, b - 0.1); else b = Math.max(t, a + 0.1);
    a = Math.max(0, a); b = Math.min(dur, b);
    draw();
  };
  cv.addEventListener('pointermove', move);
  cv.addEventListener('pointerup', () => { drag = null; });
  onResize = () => draw();
  window.addEventListener('resize', onResize);
  draw();

  go.addEventListener('click', async () => {
    go.disabled = true;
    err.textContent = '';
    info.textContent = 'cutting…';
    try {
      const r = await fetch('/api/audio/cut', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ src: it.path, in: +a.toFixed(3), out: +b.toFixed(3), cat: sel.value }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error || 'it could not be cut');
      close();
      if (o.done) o.done(d.item);
    } catch (e) {
      go.disabled = false;
      err.textContent = e.message;
      draw();
    }
  });
}
