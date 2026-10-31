/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — placing an insert by hand, on the preview.

   THE PREVIEW IS THE CONTROL. There is no button that turns a clip into an inset and no field
   that says where it goes: you click the picture and you move it. Putting a picture on a frame
   is a thing done by looking at it, and typing 0.31 into a box is guessing at something already
   on screen.

     click a picture      pick it, on the timeline too
     drag it              move it - and lift it off the frame, if it was still full-screen
     drag a corner        resize about its middle
     drag the knob        turn it

   A HALFER BAND IS PICKED, NOT PLACED. It spans the frame and where it sits is the numbers on its
   panel, so a click selects it and it has no grips - only an outline to say it is the one picked.

   LIFTING IS FREE. A clip that has never been placed is dragged from exactly where it is
   already drawn: the preview hands over the box it used, so the first pixel of the gesture
   moves the picture rather than jumping it somewhere else and then moving it.

   NOTHING IS WRITTEN UNTIL THE MOUSE COMES UP. A store write per mousemove would be a hundred
   snapshots of a picture sliding, and the one you wanted back would be buried under them. The
   gesture keeps itself visible through `liveOf`, which the preview reads while drawing, and
   commits once - one undo step for one thing the person did.
   ═══════════════════════════════════════════════════════════════════════════ */

import { selectedOne, selectClipById, setClipFields, setClipsFields, selectedClips, multiCount } from './timeline-b.js';

const HANDLE = 9;      // half-width of a corner grip, in canvas pixels
const KNOB = 22;       // how far above the top edge the turning knob sits
// Yellow, because it has to be found instantly over a photograph and nothing else in this
// editor is yellow. White was lost in a bright shot and the accent blue in a cold one.
const MARK = '#ffd400';

let _api = null;       // { rectOf, rects, pad, frame, repaint }
let _cv = null;
let _drag = null;
let _live = null;      // { id, patch } - the gesture in progress, not yet stored

// (phase V51, point 1) A gesture held OUTSIDE the preview - the crop's frame dragged in the clip's settings (crop-box.js): a
// patch per clip (several main clips picked are cropped by one frame, (пр44)), drawn by the preview, written on release.
let _ext = null;       // Map id -> patch, or null

/** The patch a gesture is holding for this clip, or null. The preview draws with it. */
export const liveOf = (id) => (_live && _live.id === id ? _live.patch : (_ext && _ext.get(id)) || null);

/** (phase V51) Patches held by a gesture elsewhere - a Map of id -> patch, or null when it is let go - and the preview drawn. */
export function setLive(patches) {
  _ext = patches && patches.size ? patches : null;
  if (_api && _api.repaint) _api.repaint();
}

const _isPlaced = (c) => !!(c && c.tw != null && +c.tw > 0);

// The selected clip, but only one that is a picture AND on screen right now: the grips belong
// to something you can see, not to something three seconds away.
function _target() {
  const one = selectedOne();
  if (!one) return _groupTarget();
  if (!one.clip || one.track.kind !== 'video') return null;
  const r = _api && _api.rectOf ? _api.rectOf(one.clip.id) : null;
  // (phase V49) A main clip that is not a PiP has no grips either (preview-b.js `nogrip`): it moves only as a PiP.
  return r && !r.band && !r.nogrip ? { track: one.track, clip: one.clip, r } : null;
}

// (phase V49, (пр9)) SEVERAL MAIN CLIPS PICKED - cut silence's pieces, by the band or Shift: the PiP'd ones among them move
// together. The grips are on the one on screen; what the gesture does to it - moved by so much, sized by so much, turned by
// so much - is done to each of them from where each was, in one step.
function _groupTarget() {
  if (multiCount() < 2 || !_api || !_api.rectOf) return null;
  const group = selectedClips().filter(x => x.track.kind === 'video' && x.track.main && x.clip.pip);
  for (const x of group) {
    const r = _api.rectOf(x.clip.id);
    if (r && r.pip) return { track: x.track, clip: x.clip, r, group };
  }
  return null;
}

// Where a clip of the group starts from: its own placement, or - not sized yet - the size it shows at: the whole frame for a
// filled one, and for a fitted one the box the one on screen has (pieces of one file are one shape).
function _baseOf(c, t, at0) {
  if (c.id === t.clip.id) return at0;
  if (_isPlaced(c)) return { tw: +c.tw, tx: c.tx == null ? 0.5 : +c.tx, ty: c.ty == null ? 0.5 : +c.ty, angle: +c.angle || 0 };
  if (String(c.fit || 'fit') === 'fill') return { tw: 1, tx: 0.5, ty: 0.5, angle: 0 };
  const conv = t.r.conv || {};
  return { tw: conv.tw != null ? conv.tw : 1, tx: 0.5, ty: 0.5, angle: 0 };
}

// Canvas pixels, then FRAME pixels: the canvas is drawn at a fixed size and shown at whatever
// the layout gives it, and the frame sits inset in it by the margin.
function _at(e) {
  const b = _cv.getBoundingClientRect();
  const pad = _api && _api.pad ? _api.pad() : 0;
  return { x: (e.clientX - b.left) * (_cv.width / b.width) - pad,
           y: (e.clientY - b.top) * (_cv.height / b.height) - pad };
}

// The pointer in a clip's OWN space: origin at its middle, axes turned with it. Every hit test
// is a rectangle test once the turn has been undone.
function _local(p, r) {
  const dx = p.x - r.cx, dy = p.y - r.cy;
  const a = -(r.angle || 0) * Math.PI / 180;
  return { x: dx * Math.cos(a) - dy * Math.sin(a), y: dx * Math.sin(a) + dy * Math.cos(a) };
}

function _partAt(p, r) {
  const l = _local(p, r);
  const hw = r.dw / 2, hh = r.dh / 2;
  if (Math.abs(l.x) <= HANDLE + 2 && Math.abs(l.y + hh + KNOB) <= HANDLE + 2) return 'turn';
  if (Math.abs(Math.abs(l.x) - hw) <= HANDLE && Math.abs(Math.abs(l.y) - hh) <= HANDLE) return 'size';
  if (Math.abs(l.x) <= hw && Math.abs(l.y) <= hh) return 'move';
  return '';
}

// Which picture is under the pointer. Last one wins: the rectangles are recorded bottom layer
// first, so walking them backwards answers with the one actually on top.
function _pick(p) {
  const rects = _api && _api.rects ? _api.rects() : null;
  if (!rects) return null;
  const all = [...rects.entries()];
  for (let i = all.length - 1; i >= 0; i--) {
    const [id, r] = all[i];
    // (phase V65) A pattern covers the whole frame: a press goes through it to what is under it (it is picked on the lane).
    if (r.nopick) continue;
    const l = _local(p, r);
    if (Math.abs(l.x) <= r.dw / 2 && Math.abs(l.y) <= r.dh / 2) return id;
  }
  return null;
}

// Where a gesture starts from - the clip's own placement when it has one, and otherwise the
// box the preview just drew it in, said in placement numbers.
function _from(c, r) {
  const f = _api.frame();
  if (_isPlaced(c)) {
    return { tw: +c.tw,
             tx: (c.tx == null ? 0.5 : +c.tx),
             ty: (c.ty == null ? 0.5 : +c.ty),
             angle: +c.angle || 0 };
  }
  const conv = r.conv || {};
  return { tw: conv.tw != null ? conv.tw : r.dw / f.w,
           tx: conv.tx != null ? conv.tx : r.cx / f.w,
           ty: conv.ty != null ? conv.ty : r.cy / f.h,
           angle: 0 };
}

function _begin(t, p, part, e) {
  const c = t.clip;
  const at0 = _from(c, t.r);
  _drag = {
    part, p0: p, id: c.id, track: t.track.id, cx: t.r.cx, cy: t.r.cy, base: at0, moved: false,
    // The starting point in PAGE pixels as well. Whether this is a click or a drag is a
    // question about the hand, and the canvas is shown at a third of its own size - three
    // pixels of frame is less than one of movement, which made every click a placement.
    pg0: { x: e.clientX, y: e.clientY },
    // How far the grabbed corner is from the middle, which is what a resize is measured
    // against: dragging to twice that distance is twice the width.
    grip: Math.max(4, Math.hypot(t.r.dw / 2, t.r.dh / 2)),
    aim0: Math.atan2(p.y - t.r.cy, p.x - t.r.cx),
    // (V49) The other PiP'd main clips picked with it, each from where it was.
    group: t.group ? t.group.map(x => ({ track: x.track.id, id: x.clip.id, base: _baseOf(x.clip, t, at0) })) : null,
  };
  // Every gesture carries the whole placement, so the one that lifts a clip off the frame
  // writes all of it at once rather than leaving half a placement behind.
  _live = { id: c.id, patch: { tx: at0.tx, ty: at0.ty, tw: at0.tw } };
}

function _down(e) {
  if (e.button !== 0 || !_cv || !_api) return;
  const p = _at(e);

  const id = _pick(p);
  const top = id && _api.rectOf ? _api.rectOf(id) : null;

  const t = _target();
  const part = t ? _partAt(p, t.r) : '';
  // The selected picture's grips come first...
  if (t && (part === 'size' || part === 'turn')) { _begin(t, p, part, e); e.preventDefault(); return; }
  // ...then the captions, drawn over every picture (phase V30, block 3: cap-place.js picks and moves them)...
  if (_api.caption && _api.caption(e, p)) return;
  if (t) {
    // A BAND ON TOP IS PICKED BY CLICKING IT, even over the selected picture: it covers that part
    // of the frame, so that is what the click is on.
    const bandOver = part === 'move' && top && top.band && id !== t.clip.id;
    if (part && !bandOver) { _begin(t, p, part, e); e.preventDefault(); return; }
  }

  // Not on the selected one - so pick whatever IS under the pointer, and start moving it in
  // the same motion. Two separate actions to move a picture you can already see is one too
  // many.
  if (!id) return;
  selectClipById(id);
  const t2 = _target();
  if (t2 && t2.clip.id === id) { _begin(t2, p, 'move', e); e.preventDefault(); }
  if (_api.repaint) _api.repaint();
}

function _move(e) {
  if (!_drag) {
    if (!_cv || !_api) return;
    const p = _at(e);
    const t = _target();
    const part = t ? _partAt(p, t.r) : '';
    const id = _pick(p);
    const top = id && _api.rectOf ? _api.rectOf(id) : null;
    const bandOver = part === 'move' && top && top.band && id !== t.clip.id;
    // A caption under the pointer is what a press takes, but for the grips (cap-place.js).
    const cap = (part === 'size' || part === 'turn') ? '' : (_api.capHover ? _api.capHover(p) : '');
    _cv.style.cursor = cap ? cap : bandOver ? 'pointer' : part === 'move' ? 'move' : part === 'size' ? 'nwse-resize'
                     : part === 'turn' ? 'grab' : (id ? 'pointer' : '');
    return;
  }
  const p = _at(e);
  const f = _api.frame();
  const b = _drag.base;
  // A CLICK IS NOT A PLACEMENT. Picking a picture must leave it exactly as it was - so until
  // the pointer has actually travelled, this writes nothing and the release below has nothing
  // to commit. Without it, selecting a full-frame clip quietly turned it into an insert and
  // spent an undo step doing it.
  if (!_drag.moved && Math.hypot(e.clientX - _drag.pg0.x, e.clientY - _drag.pg0.y) < 3) return;
  _drag.moved = true;

  if (_drag.part === 'move') {
    _live.patch = {
      tw: b.tw,
      tx: Math.max(0, Math.min(1, b.tx + (p.x - _drag.p0.x) / f.w)),
      ty: Math.max(0, Math.min(1, b.ty + (p.y - _drag.p0.y) / f.h)),
    };
  } else if (_drag.part === 'size') {
    const now = Math.max(4, Math.hypot(p.x - _drag.cx, p.y - _drag.cy));
    _live.patch = { tx: b.tx, ty: b.ty,
                    tw: Math.max(0.04, Math.min(4, b.tw * (now / _drag.grip))) };
  } else {
    const aim = Math.atan2(p.y - _drag.cy, p.x - _drag.cx);
    let deg = b.angle + (aim - _drag.aim0) * 180 / Math.PI;
    while (deg > 180) deg -= 360;
    while (deg < -180) deg += 360;
    // Straight is worth landing on, and a mouse cannot hit zero.
    if (Math.abs(deg) < 3) deg = 0;
    _live.patch = { tx: b.tx, ty: b.ty, tw: b.tw, angle: Math.round(deg) };
  }
  if (_api.repaint) _api.repaint();
}

function _up() {
  if (!_drag) return;
  const d = _drag, patch = (_live && _live.patch) || {};
  _drag = null;
  _live = null;
  if (d.moved && Object.keys(patch).length && d.group) {
    // (V49) Every PiP'd main clip picked: moved, sized and turned by as much as the one on screen - one step.
    const b = d.base;
    const dx = (patch.tx != null ? patch.tx : b.tx) - b.tx, dy = (patch.ty != null ? patch.ty : b.ty) - b.ty;
    const k = (patch.tw != null ? patch.tw : b.tw) / (b.tw || 1);
    const da = (patch.angle != null ? patch.angle : b.angle) - (b.angle || 0);
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    setClipsFields(d.group.map(g => {
      let a = (g.base.angle || 0) + da;
      while (a > 180) a -= 360;
      while (a < -180) a += 360;
      return { trackId: g.track, clipId: g.id, patch: {
        tx: clamp(g.base.tx + dx, 0, 1), ty: clamp(g.base.ty + dy, 0, 1), tw: clamp(g.base.tw * k, 0.04, 4),
        ...(d.part === 'turn' || g.base.angle ? { angle: Math.round(a) } : {}),
      } };
    }));
  } else if (d.moved && Object.keys(patch).length) setClipFields(d.track, d.id, patch);
  else if (_api && _api.repaint) _api.repaint();
}

/** The outline and its grips, over whatever has just been drawn. */
export function paintHandles(ctx) {
  const one = selectedOne();
  const br = one && one.track.kind === 'video' && _api && _api.rectOf ? _api.rectOf(one.clip.id) : null;
  if (br && (br.band || br.nogrip)) {
    ctx.save();
    ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(0,0,0,.55)';
    ctx.strokeRect(br.dx + 1, br.dy + 1, br.dw - 2, br.dh - 2);
    ctx.lineWidth = 1.75; ctx.strokeStyle = MARK; ctx.setLineDash([7, 5]);
    ctx.strokeRect(br.dx + 1, br.dy + 1, br.dw - 2, br.dh - 2);
    ctx.restore();
    return;
  }
  const t = _target();
  if (!t) return;
  const r = t.r;
  const live = liveOf(t.clip.id);
  // Mid-gesture the rectangle in hand is the one the preview has just drawn from the live
  // patch, so nothing special is needed here - `rectOf` already returns it.
  const hw = r.dw / 2, hh = r.dh / 2;

  ctx.save();
  ctx.translate(r.cx, r.cy);
  if (r.angle) ctx.rotate(r.angle * Math.PI / 180);

  // A dark line under the yellow one, so the outline holds against a bright picture as well as
  // a dark one without borrowing a colour from either.
  ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(0,0,0,.55)';
  ctx.strokeRect(-hw, -hh, r.dw, r.dh);
  ctx.lineWidth = 1.75; ctx.strokeStyle = MARK;
  ctx.strokeRect(-hw, -hh, r.dw, r.dh);

  ctx.beginPath();
  ctx.moveTo(0, -hh);
  ctx.lineTo(0, -hh - KNOB);
  ctx.stroke();

  const grip = (x, y, round) => {
    ctx.beginPath();
    if (round) ctx.arc(x, y, HANDLE * 0.62, 0, Math.PI * 2);
    else ctx.rect(x - HANDLE / 2, y - HANDLE / 2, HANDLE, HANDLE);
    ctx.fillStyle = MARK;
    ctx.fill();
    ctx.lineWidth = 1.25; ctx.strokeStyle = 'rgba(0,0,0,.6)';
    ctx.stroke();
  };
  grip(-hw, -hh); grip(hw, -hh); grip(-hw, hh); grip(hw, hh);
  grip(0, -hh - KNOB, true);
  ctx.restore();
  void live;
}

/**
 * @param canvas the preview's canvas
 * @param api    { rectOf(id), rects(), pad(), frame(), repaint(), caption(e, p), capHover(p) } - all in FRAME
 *               coordinates; `caption` takes a press on a page of captions (true when it did), `capHover` says the
 *               cursor over one (phase V30, block 3).
 */
export function wirePlace(canvas, api) {
  _cv = canvas;
  _api = api;
  canvas.addEventListener('mousedown', _down);
  // On the document, not the canvas: a drag routinely leaves the stage and a listener on the
  // canvas would drop the gesture at its edge.
  document.addEventListener('mousemove', _move);
  document.addEventListener('mouseup', _up);
}

