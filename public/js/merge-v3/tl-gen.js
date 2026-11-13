/* ═══════════════════════════════════════════════════════════════════════════
   MERGE — THE TIMELINE'S MEDIA INTO THE GENERATION CHATS, AND WHAT THEY MAKE BACK.

   The right button on a clip of a video lane (js/merge-v3/timeline-b.js _clipMenu) and the two frame buttons right of
   "cut silence" (js/merge-v3/bar.js) open a chat's window WITH the thing in its zone - the zone emptied first, the thread
   and the words in the box left as they are:
     a picture   "animate"            the video chat, the picture as its FIRST FRAME
                 "change"             the pictures chat, the picture to change
     a film      "continue"           the video chat, the last frame the timeline plays as the first frame
                 "as a reference"     the video chat, the part of the file the timeline plays
                 "frame to pictures"  the pictures chat, the frame at the playhead (else the first one the clip shows)
     the frame buttons                the frame as the preview shows it, without words, to either chat
   A frame of a clip is a new picture in IMAGES -> Screenshots: the clip's own file at that moment (POST /api/images/frame),
   or the preview's frame (POST /api/images/shot) for the buttons. Nothing here costs anything - the chat's own press does.

   WHERE IT CAME FROM is kept in this browser by the PATH of what went into the zone (`mv3_tl_gen_v1`): the timeline, the
   clip, what was done, the moment of its file. A finished result whose message carries that path has a button under it
   that lays it back (timeline-b.js genBack, one step to undo), by what was done:
     change -> "In its place" (the picture's file)        animate, as a reference -> "In its place" (the clip's place)
     continue -> "After the clip" (inserted, the lane moves on)   a frame to the video chat -> "Into the cut" (the clip
     cut at the frame, the clip inserted, the lane moves on)      a frame to the pictures chat -> "Above it" (the lane above)
   No button on a talking head's lines (none is made from them) nor in the Library's chats (no timeline there).
   ═══════════════════════════════════════════════════════════════════════════ */

import * as Store from './store.js';
import * as Views from './lib-views.js';
import { unbound } from './chat-owner.js';
import { note } from '../ask.js';
import { showError } from '../notice.js';

const LS = 'mv3_tl_gen_v1';
const KEEP = 80;                            // origins remembered at most - the newest

// What each act makes and the button that lays it back.
const ACTS = {
  edit: { chat: 'pictures', makes: 'image', label: 'In its place', title: 'Put this picture in place of the picture on the timeline it was made from - its place, length and look stay' },
  animate: { chat: 'videos', makes: 'video', label: 'In its place', title: 'Put this clip in place of the picture on the timeline it was made from - from the same second, no longer than the picture was' },
  ref: { chat: 'videos', makes: 'video', label: 'In its place', title: 'Put this clip in place of the clip on the timeline it was made from - from the same second, no longer than that clip' },
  continue: { chat: 'videos', makes: 'video', label: 'After the clip', title: 'Insert this clip right after the clip it continues - what is after it on that lane moves on by this clip\'s length' },
  'frame-vid': { chat: 'videos', makes: 'video', label: 'Into the cut', title: 'Cut the clip on the timeline where its frame was taken and insert this clip there - what is after it on that lane moves on by this clip\'s length' },
  'frame-pic': { chat: 'pictures', makes: 'image', label: 'Above it', title: 'Put this picture on the lane above the clip its frame was taken from, at that moment' },
};

function _all() {
  try { const v = JSON.parse(localStorage.getItem(LS) || '{}'); return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; }
}
function _keep(all) {
  const rows = Object.entries(all).sort((a, b) => (+b[1].t || 0) - (+a[1].t || 0)).slice(0, KEEP);
  try { localStorage.setItem(LS, JSON.stringify(Object.fromEntries(rows))); } catch (e) { /* a private window: no button later */ }
}
const _clean = (p) => String(p || '').split(/[?#]/)[0];

/** Where the thing at `path` came from - kept for the result's button. */
export function remember(path, o) {
  const all = _all();
  all[_clean(path)] = Object.assign({}, o, { t: Date.now() });
  _keep(all);
}

/** The newest origin among `paths` that is older than the result (made at `at`). */
export function originOf(paths, at) {
  const all = _all();
  const when = Date.parse(at || '') || Date.now();
  let best = null;
  for (const p of paths || []) {
    const o = all[_clean(p && typeof p === 'object' ? p.path : p)];
    if (o && (+o.t || 0) <= when + 5000 && (!best || o.t > best.t)) best = o;
  }
  return best;
}

// ── Into a chat ──────────────────────────────────────────────────────────────
const _r2 = (v) => Math.round((+v || 0) * 100) / 100;
function _find(trackId, clipId) {
  const tl = Store.timeline();
  for (const t of ((tl && tl.tracks) || [])) {
    if (trackId && t.id !== trackId) continue;
    const c = (t.clips || []).find(x => x.id === clipId);
    if (c) return { t, c };
  }
  return null;
}

async function _frameOf(src, fileT, name, at) {
  const d = await fetch('/api/images/frame', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ src, t: fileT, name, project: Store.title() || '', at }),
  }).then(r => r.json()).catch(() => null);
  if (!d || !d.success || !d.item) throw new Error((d && d.error) || 'the frame could not be saved');
  return d.item;
}

const _clock = (t) => {
  const s = Math.max(0, +t || 0), m = Math.floor(s / 60), r = s - m * 60;
  return m + ':' + (r < 10 ? '0' : '') + r.toFixed(1);
};

async function _open(chat, o) {
  if (chat === 'videos') { const V = await import('./vidchat.js'); await V.openVideos(o); }
  else { const P = await import('./picchat.js'); await P.openPictures(o); }
}

/**
 * The right button on a clip: `act` - animate | edit (a picture), continue | ref | frame-pic (a film). `at` - the playhead.
 */
export async function fromClip(act, { trackId, clipId, at }) {
  const key = Store.key();
  if (Views.isHlHome(key)) { Views.noFragment(); return; }
  const f = _find(trackId, clipId);
  if (!f) return;
  const { c } = f;
  const title = Store.title() || '';
  const origin = { key, title, trackId: f.t.id, clipId: c.id, act };
  const sp = +c.speed || 1;
  const from = Math.max(0, +c.trimIn || 0);
  const to = from + (+c.dur || 0) * sp;
  try {
    if (act === 'animate' || act === 'edit') {
      remember(c.src, origin);
      await _open(act === 'animate' ? 'videos' : 'pictures',
        { attach: { path: c.src, name: c.name || '', kind: 'image' }, as: act === 'animate' ? 'first' : 'change', act, back: ACTS[act].label });
      return;
    }
    if (act === 'ref') {
      remember(c.src, origin);
      await _open('videos', { attach: { path: c.src, name: c.name || '', kind: 'video', poster: c.thumb || '', dur: +c.srcDur || 0, in: _r2(from), out: _r2(to) }, as: 'clip', act, back: ACTS.ref.label });
      return;
    }
    // A frame of the clip's own file: its last one played ("continue"), or the one at the playhead (its first one shown).
    let fileT, tlAt;
    if (act === 'continue') { fileT = c.reversed ? from : to; tlAt = (+c.start || 0) + (+c.dur || 0); }
    else {
      const on = at != null && at >= (+c.start || 0) && at <= (+c.start || 0) + (+c.dur || 0);
      tlAt = on ? at : (+c.start || 0);
      const x = tlAt - (+c.start || 0);
      fileT = c.reversed ? from + ((+c.dur || 0) - x) * sp : from + x * sp;
    }
    const item = await _frameOf(c.src, fileT, (title || 'frame') + ' ' + _clock(tlAt) + (act === 'continue' ? ' · last frame' : ''), _r2(tlAt));
    origin.fileT = Math.round(fileT * 1000) / 1000;
    origin.at = _r2(tlAt);
    remember(item.imagePath, origin);
    await _open(act === 'continue' ? 'videos' : 'pictures',
      { attach: { path: item.imagePath, name: item.name || '', kind: 'image' }, as: act === 'continue' ? 'first' : 'frame', act, back: ACTS[act].label });
  } catch (e) {
    showError('The chat did not open', { detail: (e && e.message) || String(e) });
  }
}

/** The frame buttons: the frame at the playhead as the preview shows it, without words, into `chat` ('pictures' | 'videos'). */
export async function fromFrame(chat, btn) {
  const key = Store.key();
  if (!key || !Store.isReady()) return;
  if (Views.isHlHome(key)) { Views.noFragment(); return; }
  const Tl = await import('./timeline-b.js');
  const P = await import('./preview-b.js');
  const target = Tl.frameTarget();
  if (btn) btn.disabled = true;
  try {
    const r = await P.grabFrame();
    if (!r || !r.ok) throw new Error('the frame could not be read');
    const title = Store.title() || '';
    const fd = new FormData();
    fd.append('image', r.blob, 'shot.png');
    fd.append('name', (title || 'frame') + ' ' + _clock(r.at));
    fd.append('project', title);
    fd.append('at', String(r.at));
    const d = await fetch('/api/images/shot', { method: 'POST', body: fd }).then(x => x.json()).catch(() => null);
    if (!d || !d.success || !d.item) throw new Error((d && d.error) || 'the frame could not be saved');
    // The clip it is a frame of - for "Into the cut" / "Above it" under the result; none (a talking head's line, an empty
    // moment) - the result is dragged.
    if (target) {
      remember(d.item.imagePath, { key, title, trackId: target.trackId, clipId: target.clipId,
        act: chat === 'videos' ? 'frame-vid' : 'frame-pic', fileT: Math.round(target.fileT * 1000) / 1000, at: _r2(target.at) });
    }
    await _open(chat, { attach: { path: d.item.imagePath, name: d.item.name || '', kind: 'image' }, as: chat === 'videos' ? 'first' : 'frame',
      act: chat === 'videos' ? 'frame-vid' : 'frame-pic', back: target ? ACTS[chat === 'videos' ? 'frame-vid' : 'frame-pic'].label : '' });
  } catch (e) {
    showError('The frame did not go to the chat', { detail: (e && e.message) || String(e) });
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ── Back onto the timeline ───────────────────────────────────────────────────
/**
 * The button under a finished result whose message carries a thing that came from the timeline - or null. `g` - the result's
 * record; `paths` - what its message was sent with; `item` - the result as a lane takes it ({ src, thumb, libId, name, dur,
 * w, h }); `makes` - 'image' | 'video'.
 */
export function backButton(g, paths, item, makes) {
  if (unbound()) return null;
  const o = originOf(paths, g && g.at);
  const a = o && ACTS[o.act];
  if (!a || a.makes !== makes) return null;
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'mv3-c-btn u-btn is-s mv3-ig-back';
  b.textContent = a.label;
  b.title = a.title + (o.title ? ' (' + o.title + ')' : '');
  b.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    if (Store.key() !== o.key) { note(b, 'Not laid.', 'Open "' + (o.title || 'its project') + '" first - the clip is on its timeline.'); return; }
    b.disabled = true;
    try {
      const Tl = await import('./timeline-b.js');
      const r = await Tl.genBack(o, Object.assign({ kind: makes }, item));
      if (!r || !r.ok) note(b, 'Not laid.', (r && r.why) || 'the timeline did not take it');
      else note(b, 'Laid on ' + (r.lane || 'the timeline') + '.', 'At ' + _clock(r.at) + ' - one step to undo.');
    } catch (e) {
      note(b, 'Not laid.', (e && e.message) || String(e));
    } finally {
      b.disabled = false;
    }
  });
  return b;
}
