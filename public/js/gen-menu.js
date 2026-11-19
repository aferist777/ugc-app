/* ═══════════════════════════════════════════════════════════════════════════
   THE RIGHT BUTTON ON ONE TILE OPENS A GENERATION CHAT WITH IT - one module for the Library's Media (js/library/main.js)
   and Merge's Library panel (js/merge-v3/library.js). The chat opens over the page in its window with the thing in its zone
   (js/merge-v3/vidchat.js, picchat.js `openVideos(o)` / `openPictures(o)`, the same way in as the timeline's, tl-gen.js):
   the zone emptied, the thread and the box left, a model that takes it, the page's word first. In the Library the chats talk in the draft's conversation, in Merge in the project's.

     a picture   "Animate…"         the video chat, the picture as the FIRST FRAME
                 "Change…"          the pictures chat
     a video     "Continue…"        its last frame (POST /api/images/frame, into IMAGES -> Screenshots) as the first frame
                 "As a reference…"  the video chat, the clip as a reference (its first seconds the model takes; its part is set
                                    on it in the zone)

   Which tiles: IMAGES (every folder, Environments / Lookbooks / Props too), VIDEO (B-rolls, Hooks, Uploads, Stock, Talking
   heads), a REFERENCES post of ONE file, a YouTube video that is downloaded. Several picked open no chat; a sound has
   its own menu. Nothing here costs anything - the chat's own press does.

     rowsFor(it, open)  -> [[label, sub, fn]] for js/tile-select.js menuAt; [] when the tile has none
       open(which, o)   the page's way to a chat - 'videos' | 'pictures', o = { attach, as, act, from: 'library' }

   A video has "Save audio" too - its sound (the file's first, or default, sound track) into the root of AUDIO
   (js/cut.js saveAudio; the viewer's right button offers every track of a file that has several).
   ═══════════════════════════════════════════════════════════════════════════ */

import { showError } from './notice.js';
import { saveAudio } from './cut.js';
import { t } from './i18n/t.js';

const PICTURES = new Set(['images', 'environments', 'lookbooks', 'props']);
const VIDEOS = new Set(['birols', 'uploads', 'hooks', 'heads', 'youtube']);

// The one file a tile stands for, as { path, kind: 'image' | 'video', thumb, dur } - or null.
function _fileOf(it) {
  if (!it) return null;
  if (it.kind === 'references') {
    const files = (it.meta && it.meta.items) || [];
    if (files.length !== 1 || (it.meta && it.meta.remote) || !files[0].path) return null;
    const f = files[0];
    return { path: f.path, kind: f.type === 'video' ? 'video' : 'image', thumb: f.thumb || '', dur: +f.dur || 0 };
  }
  const path = String(it.media || '').split('?')[0];
  if (!path) return null;
  if (PICTURES.has(it.kind)) return { path, kind: 'image', thumb: it.thumb || '', dur: 0 };
  if (VIDEOS.has(it.kind)) return { path, kind: 'video', thumb: it.thumb || '', dur: +it.dur || 0 };
  return null;
}

async function _lastFrame(f, name) {
  const d = await fetch('/api/images/frame', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    // Its end: the frame route takes the file's last frame at or past it (lib/video-thumb.js frameAt).
    body: JSON.stringify({ src: f.path, t: f.dur > 0 ? f.dur : 1e6, name: t('{name} · last frame', { name: name || t('clip') }) }),
  }).then(r => r.json()).catch(() => null);
  if (!d || !d.success || !d.item) throw new Error((d && d.error) || t('the frame could not be saved'));
  return d.item;
}

export function rowsFor(it, open) {
  const f = _fileOf(it);
  if (!f || typeof open !== 'function') return [];
  const name = it.name || '';
  const go = (which, o) => Promise.resolve(open(which, Object.assign({ from: 'library' }, o)))
    .catch(e => showError(t('The chat did not open'), { detail: (e && e.message) || String(e) }));
  if (f.kind === 'image') {
    return [
      [t('Animate…'), t('the video chat · this picture as the first frame'),
        () => go('videos', { attach: { path: f.path, name, kind: 'image' }, as: 'first', act: 'animate' })],
      [t('Change…'), t('the pictures chat · this picture to change'),
        () => go('pictures', { attach: { path: f.path, name, kind: 'image' }, as: 'change', act: 'edit' })],
    ];
  }
  return [
    [t('Continue…'), t('the video chat · its last frame as the first frame'), async () => {
      try {
        const item = await _lastFrame(f, name);
        await go('videos', { attach: { path: item.imagePath, name: item.name || '', kind: 'image' }, as: 'first', act: 'continue' });
      } catch (e) { showError(t('The last frame was not taken'), { detail: (e && e.message) || String(e) }); }
    }],
    [t('As a reference…'), t('the video chat · this clip as a reference'),
      () => go('videos', { attach: { path: f.path, name, kind: 'video', poster: f.thumb, dur: f.dur }, as: 'clip', act: 'ref' })],
    [t('Save audio'), t('its sound · into AUDIO'), () => saveAudio({ src: f.path, name })],
  ];
}
