/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — the Music panels. Phase I5.

   The saved-tracks library is server-side already (routes/audio.js):

     GET    /api/audio/suno/library        -> { list: [{id, title, audioPath, style}] }
     DELETE /api/audio/suno/library/:id

   so this panel reads the same list every other page reads. Nothing about the music
   library lives in a browser.

   THE GENERATOR asks Suno through kie.ai, which was already wired up server-side:

     POST /api/audio/suno/generate      { style, title, targetDuration } -> { taskId }
     GET  /api/audio/suno/status/:id    -> pending | success + audioPath | failed
     POST /api/audio/suno/library       saves the finished track for every page

   What reaches the model is one line of text. That is the whole API for taste: there is
   no BPM field, no instrument list, no mood enum - `style` is prose and Suno reads it.
   So the chips ARE the prompt, joined with commas, and the BPM slider writes "N BPM"
   into the same line. Worth knowing before trusting it: the tempo is a strong hint, not
   a setting, and a track can come back near it rather than on it.

   LENGTH IS NOT ASKED FOR EITHER. Suno returns two variants of a minute and a half to
   two and a half, which the status endpoint crossfades into one three-to-five minute
   track, and the `duration` parameter that would change that works on one model only.
   So the length is taken rather than requested: the library keeps the whole track and
   the clip on the lane is cut to the video. One generation can therefore bed a short
   ad and a long one without being made twice.

   One detail worth stating because it has bitten before: the play button's label
   follows the AUDIO's own play/pause/ended events, not the click. Toggling a label on
   click is how a button ends up reading "pause" over a track that stopped by itself.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as Store from './store.js';
import * as C from './controls.js';
import { startInlineProgress, lockControls } from '../progress.js';

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

// How long the video actually is: every track except this one. Measuring the music lane
// too would be circular - laying down a bed would make the video longer, which would make
// the next bed longer again, and a two-minute ad would grow a five-minute score.
function _videoLength() {
  const tl = Store.timeline();
  if (!tl) return 0;
  let end = 0;
  for (const k of Object.keys(tl.tracks || {})) {
    if (k === 'music') continue;
    for (const c of (tl.tracks[k].clips || [])) {
      const e = (+c.start || 0) + (+c.dur || 0);
      if (e > end) end = e;
    }
  }
  return Math.round(end * 100) / 100;
}

async function _add(url, title) {
  const src = await _probeAudio(url);
  const full = src > 0 ? src : FALLBACK_DUR;
  // Cut to the video rather than laid out at its own length. A backing track that runs on
  // past the last frame is not a longer film, it is a tail nobody hears - and Suno returns
  // three to five minutes whatever it was asked for. Trimmed, not re-encoded: the library
  // keeps one full-length track and every project takes the piece it needs.
  const want = _videoLength();
  const dur = (want > 0) ? Math.min(want, full) : full;
  Store.mutate(tl => {
    const tr = tl.tracks.music;
    if (!tr) return;
    tr.clips.push({
      id: 'm' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36),
      src: url, thumb: null, name: title || 'music', libId: null,
      start: _endOfLane(tr.clips),
      dur: Math.round(dur * 100) / 100,
      srcDur: Math.round(src * 100) / 100,
      trimIn: 0, trimOut: Math.round(Math.max(0, full - dur) * 100) / 100, speed: 1,
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

// ── The generator ───────────────────────────────────────────────────────────
// Three groups, because a backing track is chosen along three axes and mixing them into
// one list of forty makes every one of them harder to find: what KIND of music it is,
// how it should FEEL, and what it is PLAYED ON. Every chip is a phrase Suno already
// understands, so the prompt is assembled rather than written.
const CHIP_GROUPS = [
  { label: 'Genre',   chips: ['Lo-fi', 'Ambient', 'Chillhop', 'Indie pop', 'Synthwave',
                              'Corporate', 'Acoustic folk', 'Deep house', 'Hip-hop', 'Cinematic'] },
  { label: 'Mood',    chips: ['Uplifting', 'Calm', 'Dreamy', 'Confident', 'Playful',
                              'Warm', 'Nostalgic', 'Energetic', 'Mysterious', 'Focused'] },
  { label: 'Texture', chips: ['Soft piano', 'Warm pads', 'Muted guitar', '808 bass', 'Vinyl crackle',
                              'Light percussion', 'Marimba', 'Rhodes', 'Strings', 'Claps'] },
];

// Kept outside the render so a rebuilt panel does not forget a half-made choice - the
// inspector redraws on every store change, which includes the one this panel causes.
const _picked = new Set();
let _bpm = 90;
let _view = 'saved';
let _busy = false;
let _said = '';
// The panel that is mid-generation, kept so a rebuild can put the SAME node back rather
// than a fresh copy of it. The inspector redraws on every store change and a generation
// runs for minutes, so building a new panel each time would throw away the progress row
// - its bar, its learned countdown and the stage it is reporting - several times over.
let _genNode = null;

const _styleOf = () => [...CHIP_GROUPS.flatMap(g => g.chips).filter(c => _picked.has(c)), _bpm + ' BPM'].join(', ');
const _titleOf = () => {
  const p = CHIP_GROUPS.flatMap(g => g.chips).filter(c => _picked.has(c)).slice(0, 3);
  return (p.join(' ') || 'UGC Background') + ' @ ' + _bpm + 'BPM';
};
const _sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function _generate(panel, statusHost) {
  if (_busy) return;
  _busy = true;
  _said = '';
  _genNode = panel;
  const unlock = lockControls([...panel.querySelectorAll('button, input, select')]);
  // A failed row stays put wearing its reason, which is right until the next attempt -
  // then it is last time's answer sitting above this time's spinner.
  statusHost.textContent = '';
  // 2.5 minutes is what Suno takes for the pair when nothing here has been timed yet. It
  // is a hint, not a cap: the row counts up past it rather than freezing, because a
  // countdown stuck on zero is indistinguishable from a job that died.
  const prog = startInlineProgress(statusHost, {
    label: 'Writing the track…', key: 'mv3-suno', estimateMs: 150000,
  });
  const say = (t) => { _said = t; };
  try {
    const style = _styleOf();
    const title = _titleOf();
    const d = await fetch('/api/audio/suno/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ style, title, targetDuration: _videoLength() }),
    }).then(r => r.json());
    if (!d || !d.success || !d.taskId) throw new Error((d && d.error) || 'kie.ai refused the job');

    let audioPath = null;
    // Every four seconds for twenty minutes. Suno usually answers inside three, but the
    // second variant is what the status endpoint waits for and it can lag well behind the
    // first - giving up early is how a paid job gets thrown away a few seconds short.
    for (let i = 0; i < 300; i++) {
      await _sleep(4000);
      const s = await fetch('/api/audio/suno/status/' + encodeURIComponent(d.taskId)).then(r => r.json());
      if (!s || !s.success) continue;                     // a blip in polling is not a failure
      if (s.state === 'failed') throw new Error(s.error || 'Suno could not make that one');
      if (s.state === 'success' && s.audioPath) { audioPath = s.audioPath; break; }
      prog.say(s.stage === 'FIRST_SUCCESS' ? 'first half is in, waiting for the second…' : 'writing the track…');
    }
    if (!audioPath) throw new Error('gave up waiting for Suno');

    const id = 'suno_' + Date.now();
    await fetch('/api/audio/suno/library', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, title, audioPath, style }),
    });
    await _add(audioPath, title);            // straight onto the lane, cut to the video
    prog.finish();
    say('"' + title + '" is on the Music track and in the library.');
    _view = 'saved';
  } catch (e) {
    // The row stays where it is, wearing the reason. Nothing redraws this panel on a
    // failure - the store did not change - so the message has to survive in place, and
    // unlocking below is what makes Generate pressable again.
    prog.fail(e.message);
    say(e.message);
  } finally {
    _busy = false;
    _genNode = null;
    unlock();
  }
}

function _renderGenerator(host) {
  // Mid-generation the panel is MOVED here, not rebuilt: see _genNode.
  if (_busy && _genNode) { host.appendChild(_genNode); return; }
  const panel = _el('div', 'mv3-mus-gen');
  host.appendChild(panel);

  for (const g of CHIP_GROUPS) {
    panel.appendChild(_el('div', 'mv3-mus-gh', g.label));
    const wrap = _el('div', 'mv3-chips');
    for (const c of g.chips) {
      const b = _el('button', 'mv3-chip' + (_picked.has(c) ? ' on' : ''), c);
      b.type = 'button';
      b.addEventListener('click', () => {
        if (_picked.has(c)) _picked.delete(c); else _picked.add(c);
        b.classList.toggle('on', _picked.has(c));
        const go = panel.querySelector('.mv3-mus-go');
        if (go) go.disabled = !_picked.size || _busy;
      });
      wrap.appendChild(b);
    }
    panel.appendChild(wrap);
  }

  panel.appendChild(_el('div', 'mv3-c-sep'));
  panel.appendChild(C.row('Tempo', C.slider({
    min: 60, max: 140, step: 5, value: _bpm, fmt: (v) => Math.round(v) + ' BPM',
    onChange: (v) => { _bpm = Math.round(v); },
  })));
  panel.appendChild(C.hint('Written into the prompt as text - Suno has no tempo setting, so this leans the track rather than fixing it.'));

  const len = _videoLength();
  panel.appendChild(C.hint(len > 0
    ? 'The track is cut to the timeline: ' + len.toFixed(1) + 's. Generation itself always returns 3-5 minutes, and the library keeps all of it.'
    : 'Nothing on the timeline yet - a bed with nothing to sit under has no length to be cut to.'));

  const status = _el('div', 'mv3-mus-status');
  const go = C.button('Generate', () => _generate(panel, status));
  go.classList.add('mv3-mus-go');
  go.disabled = !_picked.size || !len || _busy;
  go.title = !len ? 'Put something on the timeline first'
           : !_picked.size ? 'Pick at least one chip'
           : 'Ask Suno for a backing track built from these words';
  panel.appendChild(C.row('', go));
  panel.appendChild(status);
  if (_said) panel.appendChild(_el('div', 'mv3-c-hint', _said));
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

  // The two ways to get music onto the lane, side by side at the top: make one, or take
  // one already made. A tab rather than both stacked - the library is a scrolling list and
  // the generator is thirty chips, and either one buries the other underneath it.
  const tabs = _el('div', 'mv3-mus-tabs');
  for (const [id, label] of [['gen', 'Generate'], ['saved', 'Saved']]) {
    const t = _el('button', 'mv3-mus-tab' + (_view === id ? ' on' : ''), label);
    t.type = 'button';
    t.dataset.view = id;
    // Free to switch mid-generation: the panel is held by _genNode rather than rebuilt, so
    // going to look at the library and coming back finds the same spinner still counting.
    t.addEventListener('click', () => { _view = id; _said = ''; render(); });
    tabs.appendChild(t);
  }
  host.appendChild(tabs);

  // Redrawn in place rather than through the inspector: this switch is a view, not an
  // edit, and there is nothing in the store for it to change.
  const body = _el('div');
  host.appendChild(body);
  const render = () => {
    body.textContent = '';
    for (const t of tabs.children) t.classList.toggle('on', t.dataset.view === _view);
    if (_view === 'gen') { _renderGenerator(body); return; }
    const box = _el('div', 'mv3-mus-list');
    body.appendChild(box);
    const load = () => {
      box.textContent = '';
      box.appendChild(_el('div', 'mv3-c-hint', 'Loading…'));
      fetch('/api/audio/suno/library')
        .then(r => r.json())
        .then(d => _rows(box, (d && d.list) || [], load))
        .catch(e => { box.textContent = ''; box.appendChild(_el('div', 'mv3-c-hint', e.message)); });
    };
    load();
    body.appendChild(C.hint('＋ adds it to the lane, cut to the timeline · ▶ previews · 🗑 removes it from the library for every page.'));
  };
  render();

  host.appendChild(_el('div', 'mv3-c-sep'));
  const todo = _el('div', 'mv3-ins-todo');
  todo.appendChild(_el('div', 'mv3-ins-todo-h', 'Next phase'));
  const ul = _el('ul');
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
