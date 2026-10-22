/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — the music panel of an audio lane: the GENERATOR. Phase I5; since phase V28.4 (the owner 2026-10-12) the
   tracks themselves are in the Library panel - Audio -> Music in its tree (js/merge-v3/library.js) - and one is laid
   on a lane by dragging it there, as it is, from where it is let go (no cutting to the video any more); two of them
   overlapping cross into each other by themselves (js/sound/fades.js). The saved-tracks half of this panel went.

   THE GENERATOR asks Suno through kie.ai, and the SERVER sees it through (phase V23):

     POST /api/audio/suno/generate      { style, title, targetDuration, where } -> { genId, alertId }
     GET  /api/alerts/:alertId          the generation's row in Alerts - followed here until it ends

   The server files both variants Suno makes as two tracks, "<title> · 1" and "<title> · 2" (routes/music.js);
   this panel writes nothing to the list.

   What reaches the model is one line of text. That is the whole API for taste: there is
   no BPM field, no instrument list, no mood enum - `style` is prose and Suno reads it.
   So the chips ARE the prompt, joined with commas, and the BPM slider writes "N BPM"
   into the same line. Worth knowing before trusting it: the tempo is a strong hint, not
   a setting, and a track can come back near it rather than on it.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as Store from './store.js';
import * as C from './controls.js';
import { startInlineProgress, lockControls } from '../progress.js';

function _el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// WHERE MUSIC LANDS. A project has up to four audio lanes and this panel is opened on one of
// them, so the destination is TOLD rather than assumed.
let _dest = null;

export function setMusicDest(trackId) { _dest = trackId || null; }

function _lane(tl) {
  if (!tl || !Array.isArray(tl.tracks) || !_dest) return null;
  return tl.tracks.find(t => t && t.id === _dest) || null;
}

// How long the video actually is: every track except this one - said to Suno as the length wanted (it is a hint; Suno
// makes what it makes).
function _videoLength() {
  const tl = Store.timeline();
  if (!tl || !Array.isArray(tl.tracks)) return 0;
  let end = 0;
  for (const t of tl.tracks) {
    if (t.id === _dest) continue;
    for (const c of (t.clips || [])) {
      const e = (+c.start || 0) + (+c.dur || 0);
      if (e > end) end = e;
    }
  }
  return Math.round(end * 100) / 100;
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

async function _generate(panel, foot, redraw) {
  if (_busy) return;
  _busy = true;
  _said = '';
  _genNode = panel;
  const unlock = lockControls([...panel.querySelectorAll('button, input, select')]);
  // The timer stands where the button stood. A wait reported anywhere else leaves the
  // control that started it sitting there greyed out and unexplained.
  const go = foot.querySelector('.mv3-mus-go');
  foot.textContent = '';                 // and last attempt's row, if it failed
  if (go) foot.appendChild(go);
  if (go) go.style.display = 'none';
  // 2.5 minutes is what Suno takes for the pair when nothing here has been timed yet. It
  // is a hint, not a cap: the row counts up past it rather than freezing, because a
  // countdown stuck on zero is indistinguishable from a job that died.
  const prog = startInlineProgress(foot, {
    label: 'Writing the track…', key: 'mv3-suno', estimateMs: 150000,
  });
  const say = (t) => { _said = t; };
  try {
    const style = _styleOf();
    const title = _titleOf();
    const d = await fetch('/api/audio/suno/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        style, title, targetDuration: _videoLength(),
        // Where it was asked from, for the Alerts list (js/alerts-bell.js). Five minutes is long
        // enough to walk away from, and the server files the track either way.
        // The music lane is part of the timeline rather than a window of its own, so the address
        // is the project: opening it puts the track where it belongs in view.
        where: {
          page: 'merge',
          href: '/merge?p=' + encodeURIComponent(Store.key() || ''),
          label: 'Merge · ' + (Store.title() || 'project') + ' · music',
          spot: { key: String(Store.key() || ''), view: 'music' },
        },
      }),
    }).then(r => r.json());
    // (phase V34.C) The row is written at the press, before kie.ai is asked: there is no task number in the answer.
    if (!d || !d.success) throw new Error((d && d.error) || 'kie.ai refused the job');
    if (!d.alertId) throw new Error('it was asked for, but its row in Alerts was not written - it will not be filed');

    // THE SERVER SEES IT THROUGH (phase V23): the row in Alerts is followed until it ends - both variants are
    // downloaded and filed by then. Twenty minutes is the row's own limit; a blip in reading it is not a failure.
    // Gone is not failed: the row was cleared from Alerts, and what it made is on the list.
    for (;;) {
      await _sleep(4000);
      let it, status = 0;
      try { const r = await fetch('/api/alerts/' + encodeURIComponent(d.alertId)); status = r.status; it = ((await r.json()) || {}).item; }
      catch (e) { continue; }
      if (!it) { if (status === 404) break; continue; }
      if (it.state === 'done') break;
      if (it.state === 'failed') throw new Error(it.error || 'Suno could not make that one');
      prog.say(it.stage || 'writing the track…');
    }

    prog.finish();
    say('"' + title + '" is in the Library - Audio · Music, two variants, · 1 and · 2. Drag one onto the lane.');
    // Into the library and NOT onto the lane. A generated track is a candidate, not a decision: you listen to it first.
    // The Library panel shows it - Music selected in its tree, the new ones first.
    _busy = false;
    _genNode = null;
    if (redraw) redraw();
    try { (await import('./library.js')).showGroup('music'); } catch (e) { /* the panel is optional */ }
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
    if (go) go.style.display = '';        // back under whatever the row ended up saying
  }
}

function _renderGenerator(host, redraw) {
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
  // No hint under it. Everything worth saying about the tempo - that Suno has no such
  // setting and reads the number as words - fits in the row's own tooltip, and a paragraph
  // of it was pushing the button that does the work below the fold.
  const tempo = C.row('Tempo', C.slider({
    min: 60, max: 140, step: 5, value: _bpm, fmt: (v) => Math.round(v) + ' BPM',
    onChange: (v) => { _bpm = Math.round(v); },
  }));
  tempo.title = 'Written into the prompt as text - Suno has no tempo setting, so this leans the track rather than fixing it';
  panel.appendChild(tempo);

  // The button, and the place the timer takes while it runs. One row, so the wait appears
  // exactly where the press was rather than somewhere else on the page.
  const len = _videoLength();
  const foot = _el('div', 'mv3-mus-foot');
  const go = C.button('Generate', () => _generate(panel, foot, redraw));
  go.classList.add('mv3-mus-go');
  go.disabled = !_picked.size || _busy;
  go.title = !_picked.size ? 'Pick at least one chip'
           : 'Two variants come back, kept as two tracks in the Library panel (Audio · Music)' + (len ? ' - asked for about ' + len.toFixed(1) + ' s' : '');
  foot.appendChild(go);
  panel.appendChild(foot);
  if (_said) panel.appendChild(_el('div', 'mv3-c-hint', _said));
}

/** Kept for the inspector: the panel has one view now. */
export function resetView() { if (!_busy) _said = ''; }

export function renderMusicTrack(host, track) {
  // The lane's master volume first: a setting for the music already down.
  host.appendChild(C.row('Volume', C.volume(
    track.volume != null ? track.volume : 0.5,
    (v) => Store.mutate(tl => { const t = _lane(tl); if (t) t.volume = v; }),
  )));
  host.appendChild(_el('div', 'mv3-c-sep'));
  const body = _el('div');
  host.appendChild(body);
  const render = () => {
    body.textContent = '';
    _renderGenerator(body, render);
  };
  render();
  body.appendChild(C.hint('The tracks are in the Library panel - Audio · Music: a press on a tile plays it, drag it onto this lane. Two overlapping cross into each other by themselves.'));
}
