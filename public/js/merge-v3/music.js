/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — the Music panels. Phase I5.

   The saved-tracks library is server-side already (routes/audio.js):

     GET    /api/audio/suno/library        -> { list: [{id, title, audioPath, style}] }
     DELETE /api/audio/suno/library/:id

   so this panel reads the same list every other page reads. Nothing about the music
   library lives in a browser.

   THE GENERATOR IS NOT HERE. Making a track is a kie.ai job that has to be polled for
   minutes, with progress, a locked panel and a timer - the treatment every generation
   in this app gets. Half of that would be worse than none, so the button is named as
   the next phase rather than wired to something that silently does nothing.

   One detail worth stating because it has bitten before: the play button's label
   follows the AUDIO's own play/pause/ended events, not the click. Toggling a label on
   click is how a button ends up reading "pause" over a track that stopped by itself.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as Store from './store.js';
import * as C from './controls.js';

let _audio = null;      // the one preview player; a second would be two tracks at once

function _el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export function stopPreview() {
  if (!_audio) return;
  try { _audio.pause(); } catch (e) {}
  _audio = null;
}

// How long an audio file is, asked of the browser. Resolves 0 rather than rejecting: a
// file that will not report its length still gets placed, just with a fallback length.
function _probeAudio(src) {
  return new Promise(resolve => {
    const a = new Audio();
    a.preload = 'metadata';
    a.addEventListener('loadedmetadata', () => resolve(a.duration || 0), { once: true });
    a.addEventListener('error', () => resolve(0), { once: true });
    a.src = src;
  });
}
const FALLBACK_DUR = 30;

// Music is placed AFTER whatever is already on the lane, never on top of it: two
// overlapping backing tracks is not a thing anyone wants, and the lane is the one place
// where "append" is the only sensible drop.
function _endOfLane(clips) {
  let end = 0;
  for (const c of (clips || [])) {
    const e = (+c.start || 0) + (+c.dur || 0);
    if (e > end) end = e;
  }
  return Math.round(end * 100) / 100;
}

async function _add(url, title) {
  const src = await _probeAudio(url);
  const dur = src > 0 ? src : FALLBACK_DUR;
  Store.mutate(tl => {
    const tr = tl.tracks.music;
    if (!tr) return;
    tr.clips.push({
      id: 'm' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36),
      src: url, thumb: null, name: title || 'music', libId: null,
      start: _endOfLane(tr.clips),
      dur: Math.round(dur * 100) / 100,
      srcDur: Math.round(src * 100) / 100,
      trimIn: 0, trimOut: 0, speed: 1,
      // Backing music under a voice: full volume would bury the talking head, so it
      // starts at half. The old editor used the same default.
      volume: 0.5, reversed: false,
      transition: null, animation: null, filter: null,
    });
  });
}

// ── The library list ────────────────────────────────────────────────────────
function _rows(box, list, onChanged) {
  box.textContent = '';
  if (!list.length) {
    box.appendChild(_el('div', 'mv3-c-hint', 'No saved tracks yet.'));
    return;
  }
  for (const t of list) {
    const row = _el('div', 'mv3-mus-row');
    const name = _el('span', 'mv3-mus-name', (t.title || 'track') + (t.style ? ' · ' + t.style : ''));
    name.title = name.textContent;
    row.appendChild(name);

    const play = _el('button', 'mv3-mus-btn', '▶');
    play.type = 'button';
    play.title = 'Preview';
    play.addEventListener('click', () => {
      // Same file playing -> this is a stop. Different file -> switch to it.
      if (_audio && _audio.dataset.src === t.audioPath) { stopPreview(); play.textContent = '▶'; return; }
      stopPreview();
      const a = new Audio(t.audioPath);
      a.dataset.src = t.audioPath;
      _audio = a;
      const mark = () => {
        const on = !a.paused;
        play.textContent = on ? '❚❚' : '▶';
        play.title = on ? 'Stop' : 'Preview';
      };
      for (const ev of ['play', 'pause', 'ended']) a.addEventListener(ev, mark);
      a.play().catch(() => { play.title = 'Could not play'; });
    });
    row.appendChild(play);

    const add = _el('button', 'mv3-mus-btn', '＋');
    add.type = 'button';
    add.title = 'Add to the Music track, after whatever is already there';
    add.addEventListener('click', async () => {
      add.disabled = true;
      try { await _add(t.audioPath, t.title); } finally { add.disabled = false; }
    });
    row.appendChild(add);

    const del = _el('button', 'mv3-mus-btn danger', '🗑');
    del.type = 'button';
    del.title = 'Delete from the library';
    del.addEventListener('click', async () => {
      // Removes the record from the shared music library, which every page reads - so
      // unlike taking a clip off the timeline, this one asks.
      if (!confirm('Delete "' + (t.title || 'track') + '" from the music library?')) return;
      del.disabled = true;
      try {
        await fetch('/api/audio/suno/library/' + encodeURIComponent(t.id), { method: 'DELETE' });
        if (onChanged) onChanged();
      } catch (e) { alert(e.message); del.disabled = false; }
    });
    row.appendChild(del);

    box.appendChild(row);
  }
}

export function renderMusicTrack(host, track) {
  const n = (track.clips || []).length;

  host.appendChild(C.row('Volume', C.slider({
    // 0.5 by default, the same number the compositor falls back to for this lane.
    min: 0, max: 1.5, step: 0.05, value: track.volume != null ? track.volume : 0.5, fmt: C.pct,
    onChange: (v) => Store.mutate(tl => { if (tl.tracks.music) tl.tracks.music.volume = v; }),
  })));
  host.appendChild(C.hint('Master for the lane. Each music clip has its own volume on top of it.'));

  host.appendChild(_el('div', 'mv3-c-sep'));
  const head = _el('div', 'mv3-ins-todo-h', 'Saved tracks');
  host.appendChild(head);
  const box = _el('div', 'mv3-mus-list');
  host.appendChild(box);
  const load = () => {
    box.textContent = '';
    box.appendChild(_el('div', 'mv3-c-hint', 'Loading…'));
    fetch('/api/audio/suno/library')
      .then(r => r.json())
      .then(d => _rows(box, (d && d.list) || [], load))
      .catch(e => { box.textContent = ''; box.appendChild(_el('div', 'mv3-c-hint', e.message)); });
  };
  load();
  host.appendChild(C.hint('＋ appends to the lane · ▶ previews · 🗑 removes it from the library for every page.'));

  host.appendChild(_el('div', 'mv3-c-sep'));
  const todo = _el('div', 'mv3-ins-todo');
  todo.appendChild(_el('div', 'mv3-ins-todo-h', 'Next phase'));
  const ul = _el('ul');
  ul.appendChild(_el('li', null, 'Generate music (Suno via kie.ai) - a polled job, so it needs progress, a timer and a locked panel'));
  ul.appendChild(_el('li', null, n ? 'Nothing plays these ' + n + ' clips yet: no preview, no export' : 'Nothing plays the lane yet: no preview, no export'));
  todo.appendChild(ul);
  host.appendChild(todo);
}

// A music clip. No crop, no picture-in-picture, no effects - it is sound.
export function renderMusicClip(host, id, clip, applySpeed, patch, remove) {
  host.appendChild(C.row('Speed', C.slider({
    min: 0.25, max: 2, step: 0.05, value: clip.speed || 1, fmt: C.times,
    onChange: (v) => applySpeed(v),
  })));
  host.appendChild(C.row('Volume', C.slider({
    min: 0, max: 1.5, step: 0.05, value: clip.volume != null ? clip.volume : 0.5, fmt: C.pct,
    onChange: (v) => patch({ volume: v }),
  })));

  host.appendChild(_el('div', 'mv3-c-sep'));
  host.appendChild(C.row('', C.button('Repeat after', async () => {
    await _add(clip.src, clip.name);
  }, { title: 'Add another copy of this track after the end of the lane' })));
  host.appendChild(C.row('', C.button('Remove from timeline', remove, {
    danger: true, title: 'Takes the clip off the lane. The music library keeps the file.',
  })));
}
