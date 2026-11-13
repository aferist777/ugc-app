/* ════════════════════════════════════════════════════════════════════════════
   MERGE — a clip that plays in its tile while the pointer rests there, in the picker of attachments (chat-pick.js) - and,
   without sound, on the chats' clips: a result in the thread, a message's attachment, a tile of the right column and the
   zone's enlarged view (chat-shell.js hoverClip, peekShow).

   One at a time per window, nothing fetched before it starts (350 ms on the tile), and it plays ON: left and come
   back to within a moment, it goes on where it was; come back later, and it starts from where it was left rather
   than from the beginning again - the moment is remembered for the last hundred clips, whichever window showed them.
   ▶ on a tile (the picker's) plays it at once WITH its sound, and leaving the tile does not stop that one.
   `grace: 0` (the chats) - the pointer leaving lets go at once: the tile shows its poster again.
   ════════════════════════════════════════════════════════════════════════════ */

const HOVER_MS = 350;
const GRACE_MS = 1500;
const _at = new Map();          // clip -> the moment it was left at

function _keepAt(h) {
  try { if (h.video && h.video.currentTime > 0) _at.set(h.src, h.video.currentTime); } catch (e) { /* gone */ }
  while (_at.size > 100) _at.delete(_at.keys().next().value);
}

/** A player for one window; `cls` is the class of the <video> it lays over the tile's box. `o.grace` - how long a clip
 *  left stays paused in its tile before it goes (ms; 1.5 s by default). */
export function hoverPlayer(cls, o) {
  const grace = o && o.grace != null ? Math.max(0, +o.grace || 0) : GRACE_MS;
  let _h = null;               // { tile, src, video, timer, gone, loud }

  function _start(h, box, loud) {
    const v = document.createElement('video');
    v.className = cls;
    v.muted = !loud; v.loop = true; v.playsInline = true; v.preload = 'none';
    const from = _at.get(h.src) || 0;
    if (from) v.addEventListener('loadedmetadata', () => { try { if (from < v.duration - 0.25) v.currentTime = from; } catch (e) { /* a stream */ } }, { once: true });
    v.src = h.src;
    box.appendChild(v);
    v.play().catch(() => { /* the pointer left first, or the clip is gone */ });
    h.video = v;
    h.loud = !!loud;
  }

  /** The pointer came onto `tile`: its clip plays in `box` after a moment. `o.loud`: at once, with its sound - and
   *  while one plays with its sound, the pointer passing over the others leaves it alone. */
  function on(tile, box, src, o) {
    const loud = !!(o && o.loud);
    if (_h && _h.loud && !loud && _h.tile !== tile) return;
    if (_h && _h.tile === tile && !(loud && !_h.loud)) {
      clearTimeout(_h.gone);
      _h.gone = 0;
      if (_h.video) _h.video.play().catch(() => { /* the clip is gone */ });
      return;
    }
    stop();
    const h = { tile, src, video: null, timer: 0, gone: 0, loud: false };
    _h = h;
    if (loud) _start(h, box, true);
    else h.timer = setTimeout(() => { if (_h === h) _start(h, box, false); }, HOVER_MS);
  }

  /** The pointer left `tile`: it pauses, and lets go a moment later - unless it was asked for with its sound. */
  function off(tile) {
    const h = _h;
    if (!h || h.tile !== tile || h.loud) return;
    clearTimeout(h.timer);
    h.timer = 0;
    if (!h.video) { _h = null; return; }          // left before it started
    if (!grace) { stop(); return; }
    try { h.video.pause(); } catch (e) { /* gone */ }
    _keepAt(h);
    h.gone = setTimeout(() => { if (_h === h) stop(); }, grace);
  }

  function stop() {
    const h = _h;
    if (!h) return;
    clearTimeout(h.timer);
    clearTimeout(h.gone);
    if (h.video) {
      _keepAt(h);
      try { h.video.pause(); } catch (e) { /* gone */ }
      h.video.removeAttribute('src');
      try { h.video.load(); } catch (e) { /* gone */ }
      h.video.remove();
    }
    _h = null;
  }

  return { on, off, stop, loud: (tile) => !!(_h && _h.tile === tile && _h.loud) };
}
