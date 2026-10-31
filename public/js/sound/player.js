/* ═══════════════════════════════════════════════════════════════════════════
   THE MUSIC PLAYER (phase V54, the owner 2026-10-27: "давай у музыки во всю ширину поля будет плеер, в котором пользователь
   сможет перематывать, обрезать и все то, что делает попап cut"; (зв12)-(зв16), (зв25): only on the Library's page, only
   with Music; "этот плеер я бы поместил перманентно в музыкальной вкладке библиотеки") - a bar under the gallery only
   (the owner 2026-10-28: "плеер не должен заходить под столбец дерева" - library.html #lib-field), outside the grid that
   is drawn again, there while Music is open (its root, highlights, its moods) - and (phase V64 fix (а)) while its track is picked
   on the Library's page: the page shows and hides it (js/library/main.js _paintPlayer); hidden, it stops.

   Until a track is pressed it says "choose a track"; then the last track stays on it where it was. Leaving Music stops the
   sound and hides the bar; coming back shows the same track at the same place (kept for the next visit of the page too).
   SFX and My sounds do not play in it - their tiles play as before, their "Cut…" is the Cut window.

   On the bar: ▶/⏸, "0:41 / 3:12", the name OVER the wave (phase V59, the owner 2026-10-29: "название было не справа от
   кнопки play - а сверху над волной"), the wave with its ruler (js/sound/scrub.js - the server's peaks, ~48 px; a press on
   the wave moves the playhead, playing goes on from there), the handles of a piece - dragged by their gold flags on the
   ruler -, "▶ the piece" and ✕, which takes the track off the bar. "Cut" is not in that row (phase V59): it stands on the
   ruler right of the right flag while a piece is marked (scrub.js `cut`) and makes the piece a new track in the root of
   Music (POST /api/audio/cut, lib/audio-cut.js) - with the flags at the very ends there is nothing to cut, and the whole
   track is never saved a second time. Space on the page plays and pauses (the page asks, js/library/main.js). "Cut…" in
   a track's menu opens it here with its middle marked - "Cut" there at once.

     createPlayer(host, { status(text, bad), changed() })
       -> { show(on), open(item, { cut, play }), toggle(), pause(), current(), forget(id), sync(items), mark(root) }
   ═══════════════════════════════════════════════════════════════════════════ */

import { scrubber, clock } from './scrub.js';

const LS = 'lib_player_v1';
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const _get = () => { try { return JSON.parse(localStorage.getItem(LS) || 'null'); } catch (e) { return null; } };
const _put = (v) => { try { if (v) localStorage.setItem(LS, JSON.stringify(v)); else localStorage.removeItem(LS); } catch (e) { /* a private window */ } };

export function createPlayer(host, opts) {
  const o = Object.assign({ status: () => {}, changed: () => {} }, opts || {});
  host.classList.add('snd-player');
  host.hidden = true;
  const audio = new Audio();
  audio.preload = 'metadata';
  let cur = null;            // { id, path, name, dur, wave }
  let sc = null;
  let raf = 0;
  let playEnd = 0;           // where playing stops: the piece's end, or the track's
  let shown = false;
  let marked = null;         // the grid the cards are marked in

  // ── The bar ──
  const play = el('button', 'snd-btn snd-pl-play', '▶');
  play.type = 'button';
  play.title = 'Play / pause (Space)';
  const time = el('span', 'snd-clock', '');
  // (phase V59) The name over the wave, in one column with it.
  const mid = el('div', 'snd-pl-mid');
  const name = el('span', 'snd-pl-name', 'choose a track');
  const wave = el('div', 'snd-pl-wave');
  mid.append(name, wave);
  const piece = el('button', 'snd-btn snd-pl-tool', '▶ the piece');
  piece.type = 'button';
  piece.title = 'Play only the piece between the gold handles';
  const x = el('button', 'snd-btn snd-pl-x snd-pl-tool', '✕');
  x.type = 'button';
  x.title = 'Take the track off the player';
  host.append(play, time, mid, piece, x);

  const D = () => (sc && sc.dur()) || (cur && cur.dur) || 0;
  const save = () => {
    if (!cur) { _put(null); return; }
    const [a, b] = sc ? sc.range() : [0, cur.dur];
    _put(Object.assign({}, cur, { at: Math.round((audio.currentTime || (sc && sc.time()) || 0) * 100) / 100, a, b }));
  };
  const paint = () => {
    const on = !!cur;
    for (const b of [play, piece, x]) b.disabled = !on;
    host.classList.toggle('is-empty', !on);
    name.textContent = on ? cur.name : 'choose a track - press one in Music';
    name.title = on ? cur.name : '';
    const short = D() < 10;
    time.textContent = on ? clock(audio.paused && sc ? sc.time() : audio.currentTime, short) + ' / ' + clock(D(), short) : '';
    play.textContent = audio.paused ? '▶' : '⏸';
    _markCards();
  };
  const tick = () => {
    raf = 0;
    if (!audio.paused && playEnd && audio.currentTime >= playEnd) { audio.pause(); playEnd = 0; }
    if (sc && !sc.dragging()) sc.setTime(audio.currentTime);
    paint();
    if (!audio.paused) raf = requestAnimationFrame(tick);
  };
  audio.addEventListener('play', () => { if (!raf) raf = requestAnimationFrame(tick); paint(); });
  audio.addEventListener('pause', () => { paint(); save(); });
  audio.addEventListener('ended', () => { if (sc) sc.setTime(D()); paint(); save(); });

  // The track's card is lit while it plays (css/sound.css .lib-card.is-playing).
  function _markCards() {
    if (!marked) return;
    const id = cur && !audio.paused ? String(cur.id) : '';
    for (const c of marked.querySelectorAll('.lib-card[data-id]')) c.classList.toggle('is-playing', !!id && c.dataset.id === id);
  }

  // A track on the bar: its wave, the piece, the place.
  function _load(it, at, range) {
    if (sc) { sc.destroy(); sc = null; }
    cur = { id: String(it.id), path: String(it.path || it.media), name: String(it.name || 'track'), dur: +it.dur || 0,
      wave: Array.isArray(it.wave) ? it.wave : ((it.meta && it.meta.wave) || []) };
    audio.src = cur.path;
    playEnd = 0;
    const d = cur.dur;
    sc = scrubber({
      src: cur.path, dur: d, wave: cur.wave, height: 48, handles: true,
      range: range || [0, d],
      onSeek: (t) => { audio.currentTime = t; if (!audio.paused) playEnd = 0; paint(); },
      onRange: () => save(),
      // (phase V59) "Cut" by the right flag, only while a piece is marked.
      cut: { title: 'The piece between the gold flags becomes a new track in Music - the track itself stays as it is', onCut: _cut },
    });
    wave.textContent = '';
    wave.appendChild(sc.el);
    const t = Math.max(0, Math.min(d || Infinity, +at || 0));
    if (t) { audio.currentTime = t; sc.setTime(t); }
    paint();
  }

  // What the bar showed last time - back, paused, where it was.
  const was = _get();
  if (was && was.path) _load(was, was.at, [+was.a || 0, +was.b || +was.dur || 0]);
  paint();

  function open(it, how) {
    const h = how || {};
    if (!it) return;
    const same = cur && cur.id === String(it.id) && cur.path === String(it.media || it.path);
    if (h.cut) {
      // "Cut…": the track here with a piece marked - its middle third, at most 30 s (phase V59: a short one too, so "Cut"
      // by the right flag is there at once) - and nothing playing.
      if (!same) _load(it, 0, null);
      const d = D();
      const a = d > 0.3 ? d / 3 : 0, b = d > 0.3 ? Math.min(d, a + Math.min(30, d / 3)) : d;
      sc.setRange(a, b);
      audio.pause();
      audio.currentTime = a; sc.setTime(a);
      host.classList.remove('is-flash'); void host.offsetWidth; host.classList.add('is-flash');
      o.status('Drag the gold flags on the ruler round the piece, then Cut by the right flag - the piece becomes a new track in Music.');
      save(); paint();
      return;
    }
    if (same) { toggle(); return; }
    _load(it, 0, null);
    if (h.play !== false) audio.play().catch(() => o.status('That file will not play', true));
    save();
  }

  function toggle() {
    if (!cur) return;
    if (!audio.paused) { audio.pause(); return; }
    playEnd = 0;
    const t = sc ? sc.time() : 0;
    if (t >= D() - 0.05) { audio.currentTime = 0; if (sc) sc.setTime(0); }
    else audio.currentTime = t;
    audio.play().catch(() => o.status('That file will not play', true));
  }
  play.addEventListener('click', toggle);
  piece.addEventListener('click', () => {
    if (!cur || !sc) return;
    if (!audio.paused && playEnd) { audio.pause(); return; }
    const [a, b] = sc.range();
    audio.currentTime = a;
    playEnd = b;
    audio.play().catch(() => o.status('That file will not play', true));
  });
  x.addEventListener('click', () => forget(cur && cur.id));
  // (phase V59) The piece a new track - only a piece: with the flags at the very ends the wave shows no "Cut".
  async function _cut(a, b) {
    if (!cur || !sc || !sc.piece()) return;
    o.status('Cutting…');
    try {
      const r = await fetch('/api/audio/cut', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ src: cur.path, in: +a.toFixed(3), out: +b.toFixed(3) }) });
      const d = await r.json();
      if (!d.success) throw new Error(d.error || 'it could not be cut');
      await o.changed();
      const made = d.item || {};
      o.status('"' + (made.title || made.name || 'The piece') + '" is a new ' + (d.where === 'music' ? 'track in Music' : 'sound in My sounds'));
    } catch (e) { o.status(e.message, true); }
  }

  /** The bar shown (Music is open) or hidden - the sound stops; the track and its place are kept. */
  function show(on) {
    const v = !!on;
    if (!v && !audio.paused) audio.pause();
    if (v === shown) return;
    shown = v;
    host.hidden = !v;
    if (v && sc) requestAnimationFrame(() => sc.redraw());
  }

  /** A track deleted, or ✕: off the bar - "choose a track" again. */
  function forget(id) {
    if (!cur || (id != null && String(id) !== cur.id)) return;
    audio.pause();
    audio.removeAttribute('src');
    try { audio.load(); } catch (e) { /* nothing loaded */ }
    if (sc) { sc.destroy(); sc = null; }
    wave.textContent = '';
    cur = null;
    _put(null);
    paint();
  }

  /** The shelf read again: a renamed track says its new name. */
  function sync(items) {
    if (!cur) return;
    const it = (items || []).find(i => String(i.id) === cur.id);
    if (it && it.name !== cur.name) { cur.name = it.name; save(); paint(); }
  }

  return {
    show, open, toggle, forget, sync,
    pause: () => audio.pause(),
    current: () => (cur ? Object.assign({}, cur) : null),
    shown: () => shown,
    mark(root) { marked = root || marked; _markCards(); },
  };
}
