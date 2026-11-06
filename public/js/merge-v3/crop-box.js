/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — a clip's CROP, in its settings (phase V51, point 1, the owner 2026-10-26; answers (пр38)-(пр44); phase V75, the
   owner 2026-11-06, (кп1)-(кп4)).

   "Crop" in the settings of a video or a picture of any video lane (inspector.js): the switch and, while it is on, the
   forms - Free / 9:16 / 1:1 / 16:9 / 4:5 put the largest frame of that form about the middle of the one there is, and keep
   it until Free is pressed ((пр39)). THE FRAME ITSELF IS CUT ON THE PREVIEW since V75 (place-b.js: a side cuts the piece's
   edge where it is, Alt + its middle slides the picture inside the frame) - the field that showed the clip's whole file in
   the strip is gone ((кп1) б, (кп4) а); its rule is framing/crop.js dragFrame.

   THE PIECE STAYS WHERE IT WAS ((пр40)): the crop is scissors over a still picture - the piece keeps its place and its scale
   on the screen, its edges follow the frame (framing/crop.js placeFor; what a clip shows and where is the preview's own
   answer, preview-b.js mapsOf). Switched on, a main clip becomes a PiP (`pip`), a clip of a lane above an insert of its piece
   (`tw` / `tx` / `ty`). Switched off, the frame is remembered (`off`): a clip of a lane above has its whole picture back
   around the piece, the same pixels where they were ((пр43)); a MAIN clip is the whole frame again, no PiP ((кп2), V75).
   Several main clips picked are cut by ONE frame ((пр44)).
   ═══════════════════════════════════════════════════════════════════════════ */

import * as Store from './store.js';
import { isStill } from './store.js';
import * as C from './controls.js';
import { playhead, setClipsFields } from './timeline-b.js';
import { mapsOf, mediaDims, frameSrc } from './preview-b.js';
import { setLive } from './place-b.js';
import { normalize, active, SHAPES, largest, pickMap, placeFor } from '../framing/crop.js';
import { showError } from '../notice.js';

const isMain = (track) => !!(track && track.kind === 'video' && track.main);
const _under = (c, t) => t >= +c.start - 1e-4 && t < +c.start + (+c.dur || 0);
// The moment the field and the scissors read a clip at: the playhead on it, else its first frame ((пр38)).
const _moment = (c) => { const t = playhead(); return _under(c, t) ? t : +c.start || 0; };
const _rect = (k) => ({ x: +k.x, y: +k.y, w: +k.w, h: +k.h });

// The clips as the store has them now - what was painted may be a step old by the time a press lands.
function _fresh(items) {
  const tl = Store.timeline() || {};
  const out = [];
  for (const it of items) {
    const t = (tl.tracks || []).find((x) => x.id === it.track.id);
    const c = t && (t.clips || []).find((x) => x.id === it.clip.id);
    if (c) out.push({ track: t, clip: c });
  }
  return out;
}

// ── The shape of a clip's file ───────────────────────────────────────────────
// Only its shape is used (the crop is in shares of it). KEPT ONCE KNOWN, per file. (phase V75 fix, the owner 2026-11-06: after the
// format was switched there and back the Crop switch said "has not loaded yet" again and again) It came only from the element the
// preview was DRAWING (ready, not being sought), else from the preview's copy loaded anew - which a long film may not have made
// yet: 15 s, then nothing. Now: what was known, any element of the preview that knows its size (preview-b.js mediaDims), the
// server's reading of the file's header for a film (GET /api/media/probe - turned by its `rotate`), the picture or the copy last.
const _dims = new Map();          // src -> { w, h } | Promise
function _dimsNow(c) {
  const d = _dims.get(c.src);
  if (d && !d.then) return d;
  const m = mediaDims(c);
  if (m) { _dims.set(c.src, m); return m; }
  return null;
}
async function _probe(c) {
  try {
    const r = await fetch('/api/media/probe?src=' + encodeURIComponent(c.src));
    const j = r.ok ? await r.json() : null;
    if (!j || !(+j.w > 0 && +j.h > 0)) return null;
    const turned = Math.abs(Math.round(+j.rotate || 0)) % 180 === 90;
    return turned ? { w: +j.h, h: +j.w } : { w: +j.w, h: +j.h };
  } catch (e) { return null; }
}
function _dimsOf(c) {
  const now = _dimsNow(c);
  if (now) return Promise.resolve(now);
  const was = _dims.get(c.src);
  if (was && was.then) return was;
  const p = (async () => {
    // A picture is read by the page itself (its orientation as the page shows it); a film by the server first.
    let d = isStill(c) ? null : await _probe(c);
    if (!d) d = await _loadDims(c);
    if (!d && isStill(c)) d = await _probe(c);
    if (d) _dims.set(c.src, d); else _dims.delete(c.src);
    return d;
  })();
  _dims.set(c.src, p);
  return p;
}
function _loadDims(c) {
  return new Promise((res) => {
    let tm = 0;
    const done = (d) => {
      clearTimeout(tm);
      res(d && d.w > 0 && d.h > 0 ? d : null);
    };
    tm = setTimeout(() => done(null), 15000);
    const src = frameSrc(c);
    if (isStill(c)) {
      const im = new Image();
      im.onload = () => done({ w: im.naturalWidth, h: im.naturalHeight });
      im.onerror = () => done(null);
      im.src = src;
    } else {
      const v = document.createElement('video');
      v.muted = true;
      v.preload = 'metadata';
      v.onloadedmetadata = () => { done({ w: v.videoWidth, h: v.videoHeight }); v.removeAttribute('src'); v.load(); };
      v.onerror = () => done(null);
      v.src = src;
    }
  });
}

// ── What a switch writes ─────────────────────────────────────────────────────
// ON: the frame remembered, or what the clip shows now (nothing moves at the press) - cut where the piece is ((пр40)); a main
// clip becomes a PiP. `k` - the one frame for every clip picked ((пр44)).
function _onPatch(it, k, d) {
  const main = isMain(it.track);
  const m = mapsOf(it.clip, main, d.w, d.h, _moment(it.clip));
  const crop = { ..._rect(k) };
  if (k.shape) crop.shape = k.shape;
  return { crop, ...placeFor(pickMap(m.maps, k), k, m.W, m.H), ...(main ? { pip: true } : {}) };
}

// OFF: the frame remembered, and the clip's whole picture back around the piece - the same pixels where they were ((пр43)); a
// main clip the whole frame (V75).
function _offPatch(it, d) {
  const k = active(it.clip);
  if (!k) return null;
  const main = isMain(it.track);
  // (phase V75, the owner's (кп2)) A main clip: the whole frame again, no PiP - its look (edges) kept for the next time.
  if (main) return { crop: { ...k, off: true }, pip: null, tx: null, ty: null, tw: null, angle: null };
  const t = _moment(it.clip);
  const m = mapsOf(it.clip, main, d.w, d.h, t);
  const to = pickMap(mapsOf({ ...it.clip, crop: null }, main, d.w, d.h, t).maps, k);
  const pl = placeFor(m.maps[0], to.view, m.W, m.H, to.whole);
  const crop = { ...k, off: true };
  // A PiP back at exactly the size and place it has unsized (its crop taken off where it was put on) is unsized again: the
  // same picture, and its unplaced state - the subtitles' rule for a split frame reads it so (captions/split.js).
  if (main && it.clip.pip && !pl.angle) {
    const nt = pickMap(mapsOf({ ...it.clip, crop: null, tw: null, tx: null, ty: null, angle: null }, main, d.w, d.h, t).maps, k);
    const ntw = (nt.whole && nt.whole.f > 0 ? nt.box.dw / nt.whole.f : nt.box.dw) / m.W;
    if (Math.abs(pl.tw - ntw) < 0.003 && Math.abs(pl.tx - 0.5) < 0.002 && Math.abs(pl.ty - 0.5) < 0.002) {
      return { crop, tw: null, tx: null, ty: null };
    }
  }
  return { crop, ...pl };
}

/** The crop's patch when a main clip's PiP goes off: the frame remembered, not applied ((пр43)) - or nothing to add. */
export const pipOffCrop = (c) => (active(c) ? { crop: { ...active(c), off: true } } : {});

/** Crop on or off for every clip of `items` ([{ track, clip }]), one undo step. */
export async function setCrop(items, want) {
  const ds = await Promise.all(items.map((x) => _dimsOf(x.clip)));
  if (ds.some((d) => !d)) { showError('The picture of this clip has not loaded yet - try again in a moment.'); return; }
  const now = _fresh(items);
  if (!now.length) return;
  const dOf = (it) => ds[items.findIndex((x) => x.clip.id === it.clip.id)];
  setLive(null);
  let list;
  if (want) {
    const first = now[0];
    const kept = first.clip.crop ? normalize({ ...first.clip.crop, off: false }) : null;
    let k = kept;
    if (!k) {
      const d = dOf(first);
      const m = mapsOf(first.clip, isMain(first.track), d.w, d.h, _moment(first.clip));
      k = normalize(m.maps[0].view) || { x: 0, y: 0, w: 1, h: 1 };
    }
    list = now.map((it) => ({ trackId: it.track.id, clipId: it.clip.id, patch: _onPatch(it, k, dOf(it)) }));
  } else {
    list = now.map((it) => ({ trackId: it.track.id, clipId: it.clip.id, patch: _offPatch(it, dOf(it)) })).filter((x) => x.patch);
  }
  if (list.length) setClipsFields(list);
}

// ── What a frame does to the clips picked ─────────────────────────────────────
// (phase V75) For the preview's gesture (place-b.js) and the forms below.

/** Where each clip picked starts from: what it shows now and where (the scissors' still picture) - or null, a file not loaded. */
export function cropBases(items) {
  const now = _fresh(items);
  const out = [];
  for (const it of now) {
    const d = _dimsNow(it.clip);
    if (!d) return null;
    out.push({ it, d, m: mapsOf(it.clip, isMain(it.track), d.w, d.h, _moment(it.clip)) });
  }
  return out.length ? out : null;
}

/** The patches a frame makes, one per clip - its piece where it was ((пр40)). */
export function cropPatches(base, k, shape) {
  const crop = { ..._rect(k) };
  if (shape) crop.shape = shape;
  return base.map((b) => ({ trackId: b.it.track.id, clipId: b.it.clip.id,
    patch: { crop, ...placeFor(pickMap(b.m.maps, k), k, b.m.W, b.m.H) } }));
}

// A form pressed: the largest frame of it about the middle of the one there is, kept until Free ((пр39)). Free: the frame as
// it is, its shape no longer kept. One step.
async function _shape(items, name) {
  const now = _fresh(items);
  if (!now.length) return;
  const k = active(now[0].clip);
  if (!k) return;
  if (!name) {
    if (!k.shape) return;
    setClipsFields(now.map((it) => ({ trackId: it.track.id, clipId: it.clip.id,
      patch: { crop: { ..._rect(active(it.clip) || k) } } })));
    return;
  }
  const ds = await Promise.all(now.map((it) => _dimsOf(it.clip)));
  const d = ds[0];
  const base = ds.every(Boolean) ? cropBases(items) : null;
  if (!base) { showError('The picture of this clip has not loaded yet - try again in a moment.'); return; }
  setLive(null);
  const nk = normalize(largest(SHAPES[name], d.w / d.h, k.x + k.w / 2, k.y + k.h / 2));
  if (nk) setClipsFields(cropPatches(base, nk, name));
}

/**
 * The Crop switch and, while it is on, its forms - for `items` ([{ track, clip }], the first one's frame said). Returns whether
 * the crop is on (the inspector hides what does not act on a cropped clip). The frame is cut on the preview (place-b.js).
 */
export function cropRows(host, items) {
  const clips = items.map((x) => x.clip);
  const on = clips.every((c) => !!active(c));
  const many = items.length > 1;
  const head = C.row('Crop', C.toggle(on, (v) => { setCrop(items, v); }));
  head.title = on ? 'Cut a piece out of the picture - switch off for the whole picture again (the frame is remembered).'
    : 'Cut a piece out of ' + (many ? 'these clips' : 'this clip') + ' - it stays where it is on the frame'
      + (items.some((x) => isMain(x.track)) ? ' and becomes a picture in the picture' : '');
  host.appendChild(head);
  if (!on) {
    if (clips.some((c) => active(c))) host.appendChild(C.hint('Some of the picked clips are cropped - switching on crops all of them by one frame.'));
    return false;
  }
  const k = active(clips[0]);
  const shapes = document.createElement('div');
  shapes.className = 'mv3-crop-shapes';
  for (const [name, label] of [['', 'Free'], ...Object.keys(SHAPES).map((x) => [x, x])]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mv3-crop-shape u-chip' + ((k.shape || '') === name ? ' is-on' : '');
    b.textContent = label;
    b.title = name ? 'The largest ' + name + ' frame about the middle of this one - kept ' + name + ' until Free'
      : 'Any shape - Shift while dragging a side on the preview keeps the one it has';
    b.addEventListener('click', () => _shape(items, name));
    shapes.appendChild(b);
  }
  host.appendChild(shapes);
  host.appendChild(C.hint('On the preview: drag a side of the picked piece to cut it'
    + (k.shape ? '' : ' (Shift keeps its shape)') + ', Alt + drag it to move the picture inside the frame.'
    + (many ? ' One frame for all ' + items.length + ' picked clips.' : ''), true));
  // Every clip's shape ready before the first gesture.
  for (const it of items) _dimsOf(it.clip);
  return true;
}
