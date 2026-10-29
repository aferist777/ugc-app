/* ═══════════════════════════════════════════════════════════════════════════
   CUTTING A PIECE OUT OF A SOUND (phase V34.D-E; the owner 2026-10-22, (з8): "вырезка тоже нужна"; made over in phase V54,
   the owner 2026-10-27, (зв25), (зв26), (зв28), (зв29)) - the window for SFX and My sounds in the Library and for EVERY
   sound in Merge's Library panel (a track of Music in the Library is cut in its player instead, js/sound/player.js).

   The sound drawn large with a RULER over it (js/sound/scrub.js, the server's peaks - the same rule as the player's, the
   owner 2026-10-28): a press on the wave moves the playhead, ▶ plays from it; two gold handles mark the piece, each
   dragged by its flag on the ruler, "▶ the piece" plays it alone. "Cut" - on the ruler right of the right flag, only while
   a piece is marked (phase V59, (мг11): the player's rule, scrub.js `cut`; the window opens with the middle third marked,
   so it is there at once) - makes the piece a
   NEW sound (POST /api/audio/cut, lib/audio-cut.js) - and where it goes follows WHAT is cut, with no choice: a piece of a
   track of Music into the root of Music, a piece of SFX or My sounds into the root of My sounds. The sound it was cut from
   is not touched. In Merge "to timeline" lays the piece at the playhead - the same file, cut by the piece, no new file
   (js/merge-v3/timeline-b.js placeSoundPiece, given by the page as `toTimeline`); the window stays open for another piece
   and says in a line where it went, or why not.

     openCut({ kind, id, path, name, dur, wave }, { stop(), done(item, where), toTimeline(piece) })

   The window is on the layer stack (js/layers.js): Escape closes it. Space plays from the playhead and stops.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as Layers from '../layers.js';
import { scrubber, clock } from './scrub.js';

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const fmt = (s, long) => (long ? Math.floor(s / 60) + ':' + (s % 60).toFixed(1).padStart(4, '0') : s.toFixed(2) + ' s');

/**
 * Open the window for `it` (a tile: { kind, id, name, path, dur, wave }).
 * opts: { stop() - whatever plays on the page stops first, done(item, where), toTimeline(piece) - Merge only }
 */
export async function openCut(it, opts) {
  const o = opts || {};
  if (typeof o.stop === 'function') o.stop();
  const music = it.kind === 'music';
  const back = el('div', 'snd-back');
  const win = el('div', 'snd-win snd-cut');
  const head = el('div', 'snd-win-head');
  head.appendChild(el('b', null, 'Cut a piece'));
  head.appendChild(el('span', 'snd-muted', it.name));
  const x = el('button', 'hp-x', '✕');
  x.type = 'button';
  head.appendChild(x);
  win.appendChild(head);

  const audio = new Audio(it.path);
  let dur = +it.dur || 0;
  let a = 0, b = dur;
  // A piece offered at first: the middle third, at most 10 s - (phase V59) of a short sound too, so "Cut" by the right
  // flag is there at once (the whole sound is not cut).
  if (dur > 0.3) { a = dur / 3; b = Math.min(dur, a + Math.min(10, dur / 3)); }
  let playEnd = 0;          // where playing stops: the piece's end, or the sound's
  let raf = 0;

  const stage = el('div', 'snd-cut-stage');
  const sc = scrubber({
    src: it.path, dur, wave: it.wave, height: 120, handles: true, range: [a, b],
    onSeek: (t) => { audio.currentTime = t; if (!audio.paused) playEnd = sc.dur() || dur; paintClock(); },
    onRange: (x0, x1) => { a = x0; b = x1; paintInfo(); },
    // (phase V59, (мг11)) "Cut" by the right flag, only while a piece is marked.
    cut: { title: music ? 'The piece becomes a new track in Music' : 'The piece becomes a new sound in My sounds', onCut: (x0, x1) => _cut(x0, x1) },
  });
  stage.appendChild(sc.el);
  win.appendChild(stage);
  // The playhead starts at the piece: ▶ plays it from its beginning.
  if (a > 0) { audio.currentTime = a; sc.setTime(a); }
  const info = el('div', 'snd-cut-info');
  win.appendChild(info);

  const row = el('div', 'snd-cut-row');
  const play = el('button', 'snd-btn snd-cut-play', '▶');
  play.title = 'Play from the playhead (Space) - a press on the wave moves it';
  const piece = el('button', 'snd-btn', '▶ the piece');
  piece.title = 'Play only the piece between the gold handles';
  play.type = piece.type = 'button';
  const time = el('span', 'snd-clock', '');
  row.append(play, piece, time);
  row.appendChild(el('span', 'sp'));
  let lay = null;
  if (typeof o.toTimeline === 'function') {
    lay = el('button', 'snd-btn', 'to timeline');
    lay.type = 'button';
    lay.title = 'Lay the piece at the playhead of the timeline - the same file, cut to the piece';
    row.appendChild(lay);
  }
  win.appendChild(row);
  const said = el('div', 'snd-cut-said snd-muted', 'Cut by the right flag makes the piece a new ' + (music ? 'track in Music' : 'sound in My sounds')
    + ' - the sound itself stays as it is.');
  win.appendChild(said);
  const err = el('div', 'snd-err');
  win.appendChild(err);

  document.body.append(back, win);
  const layer = Layers.open(win, { modal: true, onEsc: () => close() });
  const close = () => {
    try { audio.pause(); } catch (e) { /* gone */ }
    if (raf) cancelAnimationFrame(raf);
    document.removeEventListener('keydown', onKey, true);
    sc.destroy();
    back.remove(); win.remove(); Layers.close(layer);
  };
  x.addEventListener('click', close);
  back.addEventListener('click', close);

  const D = () => sc.dur() || dur || 1;
  const paintInfo = () => {
    const long = D() >= 60;
    info.textContent = 'from ' + fmt(a, long) + ' to ' + fmt(b, long) + ' · ' + (b - a).toFixed(2) + ' s of ' + fmt(D(), long)
      + ' - drag the gold flags on the ruler; a press on the wave moves the playhead';
  };
  const paintClock = () => {
    const short = D() < 10;
    time.textContent = clock(audio.paused ? sc.time() : audio.currentTime, short) + ' / ' + clock(D(), short);
    play.textContent = audio.paused ? '▶' : '⏸';
  };
  const tick = () => {
    raf = 0;
    if (!audio.paused && audio.currentTime >= playEnd) audio.pause();
    if (!sc.dragging()) sc.setTime(audio.currentTime);
    paintClock();
    if (!audio.paused) raf = requestAnimationFrame(tick);
  };
  const startAt = (from, to) => {
    audio.currentTime = from;
    playEnd = to;
    audio.play().then(() => { if (!raf) raf = requestAnimationFrame(tick); }).catch(() => { err.textContent = 'That file will not play'; });
  };
  audio.addEventListener('pause', paintClock);
  audio.addEventListener('ended', () => { sc.setTime(audio.currentTime); paintClock(); });
  const fromHead = () => {
    if (!audio.paused) { audio.pause(); return; }
    const t = sc.time();
    startAt(t >= D() - 0.05 ? 0 : t, D());
  };
  play.addEventListener('click', fromHead);
  piece.addEventListener('click', () => { if (!audio.paused) audio.pause(); else startAt(a, b); });
  const onKey = (e) => {
    if (!Layers.topIs(layer) || e.key !== ' ') return;
    e.preventDefault();
    fromHead();
  };
  document.addEventListener('keydown', onKey, true);
  paintInfo();
  paintClock();

  // ── "to timeline" (Merge): the piece at the playhead; the window stays ──
  if (lay) {
    lay.addEventListener('click', () => {
      err.textContent = '';
      let r = null;
      try {
        r = o.toTimeline({ src: it.path, name: it.name, libId: it.id || null, kind: it.kind || '',
          trimIn: +a.toFixed(3), dur: +(b - a).toFixed(3), srcDur: +D().toFixed(3) });
      } catch (e) { r = { ok: false, why: e.message }; }
      if (r && r.ok) {
        said.textContent = 'Laid on ' + (r.lane || 'an audio lane') + ' at ' + clock(r.at || 0, true) + ' - Ctrl+Z on the timeline takes it off.';
        said.classList.remove('is-bad');
      } else {
        said.textContent = (r && r.why) || 'The piece could not be laid.';
        said.classList.add('is-bad');
      }
    });
  }

  // "Cut" by the right flag (scrub.js waits on its button while this goes).
  async function _cut(x0, x1) {
    err.textContent = '';
    said.textContent = 'cutting…';
    said.classList.remove('is-bad');
    try {
      const r = await fetch('/api/audio/cut', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ src: it.path, in: +x0.toFixed(3), out: +x1.toFixed(3) }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error || 'it could not be cut');
      close();
      if (o.done) o.done(d.item, d.where);
    } catch (e) {
      said.textContent = '';
      err.textContent = e.message;
    }
  }
}
