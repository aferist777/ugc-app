/* ═══════════════════════════════════════════════════════════════════════════
   MERGE — music and sounds: MERGE'S HOST OF THE SOUND WINDOW.

   The window is ONE for both pages - js/sound/sound-window.js (Music: Simple, Custom, Lyrics, From a description, Video to
   Music; Sounds: Sounds, Sound effects) - and what is here is what is Merge's own, told to that window as its host:

     the project       the open one (the store's key; a highlights fragment's is its home's - lib-views.js chatKey): its
                       presses under the gold card ("this project · N"), the press is the project's, its kind tells Simple's
                       writer (talking head / blank / draft / highlights), "by the video" is its video lanes' length
     a clip            Video to Music from a clip of a video lane (its right button, timeline-b.js -> videoToMusicFromClip):
                       the clip as it is NOW on the open timeline, the timeline saved before the server reads it; the
                       server lays the track under it (lib/audio-gens.js _layUnder) and the store reads it at once
     a result dragged  onto an audio lane as a tile of the shelf is (refused on a highlights project's own timeline)
     the Alerts row    leads back here - the window, on whichever project is open (?open=audio, js/merge-v3/main.js)

   The ways in: AUDIO's "generate" in the tree and Music's "Generate music" (merge-v3/library.js - Music → Simple),
   ?open=audio, the lane's "Video to Music…", "use in custom" on a saved text (`ugc:lyric-use`). What the person set is
   remembered in the browser (`mv3_audio_v1`).
   ═══════════════════════════════════════════════════════════════════════════ */

import * as Store from './store.js';
import * as Views from './lib-views.js';
import { DRAG_TYPE, DRAG_MEDIA } from './store.js';
import { isTalking } from './workshop.js';
import { refuseHome } from './chat-shell.js';
import * as SW from '../sound/sound-window.js';
import { isHl } from '../highlights/keys.js';
import { laneName } from './timeline-b.js';

const WRITER_KIND = { 'talking head': 'talking-head', blank: 'blank', draft: 'draft', highlights: 'highlights' };
const _hl = isHl;
const _allowed = () => Store.isReady() && !!Store.key();
const _kind = () => (_hl(Store.key()) ? 'highlights' : isTalking() ? 'talking head' : Store.isDraft() ? 'draft' : 'blank');
const _key = () => Views.chatKey(Store.key() || '');

// The video's length: the video lanes' end (a talking head's lines, a blank project's clips).
function _videoSecs() {
  const t = Store.timeline();
  if (!t) return 0;
  let end = 0;
  for (const k of Object.keys(t.tracks || {})) {
    const tr = t.tracks[k];
    if (!tr || tr.kind !== 'video') continue;
    for (const c of (tr.clips || [])) { const e = (+c.start || 0) + (+c.dur || 0); if (e > end) end = e; }
  }
  return Math.round(end * 10) / 10;
}

// The clip in "The video" as it is NOW on the open timeline - moved, trimmed, sped up, its name; one taken off it says so; a
// clip of another fragment of the same highlights project as it was put in. `lane` - its lane's name as it is shown.
function _clipNow(c) {
  if (!c || Store.key() !== c.key) return null;
  for (const t of ((Store.timeline() || {}).tracks || [])) {
    const x = (t.clips || []).find(y => y.id === c.clipId);
    if (x && t.kind === 'video') {
      return { live: true, gone: false, name: x.name || c.name || 'clip', start: +x.start || 0, dur: Math.round((+x.dur || 0) * 10) / 10,
        thumb: x.thumb || c.thumb || '', lane: laneName(t.name || '') };
    }
  }
  return { live: false, gone: true, name: c.name || 'clip', start: +c.start || 0, dur: Math.round((+c.dur || 0) * 10) / 10, thumb: c.thumb || '', lane: '' };
}

const HOST = {
  page: 'merge', view: 'audio', store: 'mv3_audio_v1', made: true,
  key: _key,
  title: () => Store.title() || '',
  laneName,
  writerKind: () => WRITER_KIND[_kind()] || 'blank',
  videoSecs: _videoSecs,
  clipNow: _clipNow,
  // The server reads a clip from the SAVED timeline - what is not saved yet goes first.
  flush: async (clip) => (clip && clip.key === Store.key() ? Store.flush() : true),
  where: (dest, label) => ({
    page: 'merge', href: '/merge?p=' + encodeURIComponent(_key()) + '&open=audio',
    label: 'Merge · ' + (Store.title() || 'project') + ' · audio · ' + label,
    spot: { key: _key(), view: 'audio' },
  }),
  // "show": the window goes, the file is shown in the Library panel.
  showFile: async (path) => {
    const w = SW.shown();
    if (w) w.close();
    const L = await import('./library.js');
    L.reveal(path);
  },
  drag: { type: DRAG_TYPE, media: DRAG_MEDIA, refuse: (node, ev) => refuseHome(node, ev) },
  // A press landed: the panel's shelf read again; a track the server laid under its clip on THIS timeline is taken at once.
  onLanded: (g) => {
    window.dispatchEvent(new Event('mv3:lib-reload'));
    if (g && g.laid && g.laid.key === Store.key()) Store.refresh();
  },
};
SW.configure(HOST);

/** Every way in - AUDIO's "generate", ?open=audio (an Alerts row): the window, on Music → Simple unless `o` says more. */
export async function openAudio(o) {
  if (!_allowed()) return null;
  return SW.open(Object.assign({ anchor: document.getElementById('mv3-library') }, o || {}));
}

/** AUDIO's "generate" in the Library panel's tree, and Music's "Generate music": the window on Music → Simple. */
export const openMusicMaker = () => openAudio({ mode: 'simple' });

/**
 * THE RIGHT BUTTON ON A CLIP (timeline-b.js): the window on Video to Music with THAT clip in "The
 * video" - nothing is asked until "generate". `o` - { key, trackId, clipId } of the open timeline.
 */
export async function videoToMusicFromClip(o) {
  if (!_allowed() || !o || !o.clipId) return;
  const t = ((Store.timeline() || {}).tracks || []).find(x => x.id === o.trackId);
  const c = t && (t.clips || []).find(x => x.id === o.clipId);
  if (!c) return;
  await openAudio({ clip: { key: String(o.key || Store.key()), trackId: t.id, clipId: c.id, name: c.name || '', start: +c.start || 0, dur: +c.dur || 0, thumb: c.thumb || '' } });
}

export function initAudChat() {
  // The clip in "The video" as it is now; another project opened - its presses read again.
  Store.onChange(() => { if (!Store.isReady()) return; SW.clipChanged(); SW.projectChanged(); });
  // "use in custom" on a tile of Music -> Lyrics or in its text's viewer (the event `ugc:lyric-use` { id, title,
  // text }): the window on Suno's Custom with that text - the title only when it is empty.
  window.addEventListener('ugc:lyric-use', (e) => {
    const l = (e && e.detail) || {};
    if (!String(l.text || '').trim()) return;
    openAudio({ lyric: l });
  });
}
