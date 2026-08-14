/* ═══════════════════════════════════════════════════════════════════════════
   LIBRARY — the Music shelf.

   The same list the Merge music panel reads: one file, data/suno-lib.json, served
   through /api/library/shelf/music. A track is MADE in Merge and listened to here,
   which is the whole reason this shelf exists - judging a backing track means playing
   it next to the others, and the panel in Merge is a 190px column beside a timeline.

   Rows rather than cards, for the same reason Voices are rows: there is no picture. A
   grid of music would be thirty identical grey squares distinguished only by their
   captions, which is a list drawn expensively.

   How long each one runs is asked of the browser, not of the server. The record does not
   store a duration - the ones written months ago never had one - and six <audio> elements
   reading their own metadata costs nothing next to six ffprobes on the server.
   ═══════════════════════════════════════════════════════════════════════════ */

let _audio = null;      // the one player; a second would be two tracks at once
let _playing = '';      // whose row is lit

export function stopPreview() {
  if (!_audio) return;
  try { _audio.pause(); } catch (e) {}
  _audio = null;
  _playing = '';
}

function _el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

const _mmss = (s) => {
  if (!(s > 0)) return '';
  const m = Math.floor(s / 60);
  return m + ':' + String(Math.round(s - m * 60)).padStart(2, '0');
};

const _when = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toISOString().slice(0, 10);
};

// Resolves 0 rather than rejecting: a file that will not report its length is still a row
// worth showing, just without a number on it.
function _probe(src) {
  return new Promise(resolve => {
    const a = new Audio();
    a.preload = 'metadata';
    a.addEventListener('loadedmetadata', () => resolve(a.duration || 0), { once: true });
    a.addEventListener('error', () => resolve(0), { once: true });
    a.src = src;
  });
}

export function render(items, { status, reload } = {}) {
  const grid = document.getElementById('lib-grid');
  if (!grid) return;
  stopPreview();
  grid.className = 'lib-rows is-music';
  grid.textContent = '';

  if (!items.length) {
    grid.appendChild(_el('div', 'lib-empty', 'No music yet. Generate a track in Merge, on the Music track.'));
    return;
  }

  for (const it of items) {
    const row = _el('div', 'lib-mus-row');
    row.dataset.id = it.id;

    const play = _el('button', 'lib-mus-play', '▶');
    play.type = 'button';
    play.title = 'Play';
    // The label follows the AUDIO's own events, not the click: a button toggled on click
    // ends up reading "pause" over a track that stopped by itself at the end.
    play.addEventListener('click', () => {
      if (_playing === it.id) { stopPreview(); _paint(); return; }
      stopPreview();
      const a = new Audio(it.media);
      _audio = a; _playing = it.id;
      for (const ev of ['play', 'pause', 'ended']) a.addEventListener(ev, () => {
        if (ev !== 'play' && _playing === it.id && a.paused) _playing = '';
        _paint();
      });
      a.play().catch(() => { if (status) status('That file will not play', 'err'); stopPreview(); _paint(); });
      _paint();
    });
    row.appendChild(play);

    const main = _el('div', 'lib-mus-main');
    main.appendChild(_el('div', 'lib-mus-name', it.name));
    const sub = (it.meta && it.meta.style) || '';
    if (sub) main.appendChild(_el('div', 'lib-mus-style', sub));
    row.appendChild(main);

    const len = _el('span', 'lib-mus-len', '');
    row.appendChild(len);
    // Missing file, said on the row rather than discovered on play. These records outlive
    // the files they point at: uploads/ is not in git and a track made on another machine
    // is a name here and nothing else.
    if (it.meta && it.meta.onDisk === false) {
      len.textContent = 'missing';
      len.classList.add('is-gone');
      play.disabled = true;
    } else {
      _probe(it.media).then(d => { len.textContent = _mmss(d); });
    }

    row.appendChild(_el('span', 'lib-mus-date', _when(it.meta && it.meta.date)));

    const del = _el('button', 'lib-mus-del', '🗑');
    del.type = 'button';
    del.title = 'Delete from the music library';
    del.addEventListener('click', async () => {
      // The list is shared with Merge, so this is not "hide it from my view" - it is gone
      // for every page. That is why it asks, and the Media shelf's ✕ does not.
      if (!confirm('Delete "' + it.name + '" from the music library?')) return;
      del.disabled = true;
      try {
        const r = await fetch('/api/audio/suno/library/' + encodeURIComponent(it.id), { method: 'DELETE' });
        if (!r.ok) throw new Error('the server refused');
        if (_playing === it.id) stopPreview();
        if (reload) reload();
      } catch (e) {
        del.disabled = false;
        if (status) status(e.message, 'err');
      }
    });
    row.appendChild(del);

    grid.appendChild(row);
  }
  _paint();

  function _paint() {
    for (const r of grid.querySelectorAll('.lib-mus-row')) {
      const on = r.dataset.id === _playing;
      r.classList.toggle('is-playing', on);
      const b = r.querySelector('.lib-mus-play');
      if (b && !b.disabled) { b.textContent = on ? '❚❚' : '▶'; b.title = on ? 'Stop' : 'Play'; }
    }
  }
}
