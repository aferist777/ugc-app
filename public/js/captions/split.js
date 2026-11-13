/* ═══════════════════════════════════════════════════════════════════════════
   CAPTIONS — A SPLIT FRAME PUTS THE SUBTITLES IN THE MIDDLE.

   A filled clip that follows its faces may show a shot as TWO BANDS, one over the other (framing/path.js: a 'bands' shot of
   a 'face' or 'bands' record - autoBands in highlights, "two faces" on any clip of any project). Their seam is the frame's
   middle, and a subtitle page at the bottom then covers the lower face. So a page of the SUBTITLE lane whose time lies on a
   split frame for MORE THAN HALF of it (a page has one place for its whole time: it never jumps mid-show) is put
   in the frame's middle, on the seam; a page no longer on one goes back to its lane's place. The text lanes - a title on
   top among them - stay where they are.

   It is written into the page's OWN style - pos 'center' - as a place put by hand is, so the preview and the render draw it
   with nothing new (style.js resolveStyle, ass.js), the inspector shows it, and a recut carries it on its words (pages.js
   lookOf). What tells the rule's place from a person's is the MARK: an offset of MARK down (0.0001 of the frame, a fifth of a
   pixel at 1920 - nothing anybody sees, and nothing a drag or a slider writes). A page placed by hand - its own pos, tx or
   ty, without the mark - is never touched; moved by hand after the rule placed it, it is the person's from then on.

   WHEN: at the cut of a highlights fragment and whenever its captions are restyled there (lib/highlights-cut.js), and
   whenever a clip's Framing switch changes on the page (merge-v3/framing-ui.js) - in the same step as the frame;
   and whenever its fit, frame, crop, PiP or size is written (merge-v3/timeline-b.js SPLIT_KEYS) - in that same step.

   CAMERA + GAME - a stream's webcam on top, a third of the frame, the game below (framing/path.js
   'cam' shots): a page on it for more than half its time goes onto THAT seam, a third down the frame (`ty` CAM_TY - the mark too).

   PURE, and shared: the page imports it, the server require()s it.
   ═══════════════════════════════════════════════════════════════════════════ */

import { isFramed, windowW } from '../framing/path.js';
import { ownPlace } from './place.js';
import { active as cropActive } from '../framing/crop.js';
import { isPlaced } from '../timeline/rules.js';

/** The rule's mark: a page in the middle with exactly this offset down was put there by the rule. */
export const MARK = 0.0001;
/** A page goes to the middle when more than this share of its time lies on a split frame. */
export const SHARE = 0.5;
/** The rule's place on the camera + game seam: a third down the frame (the middle less a sixth), marked as MARK is. */
export const CAM_TY = MARK - 1 / 6;

const _video = (tl) => ((tl && tl.tracks) || []).filter((t) => t && t.kind === 'video');
// An insert on the frame (PiP): covers nothing. Nor does a cropped clip, placed or not: it is drawn as its piece -
// never framed into bands (lib/mv3b-render.js isFramedClip) - a PiP of it on main, an insert of it on a lane above.
// A PiP NOT sized (no `tw`) is not on this list: it shows the frame's own picture - the bands too - as big as the frame.
const _placed = (c) => !!(c && (isPlaced(c) || cropActive(c)));

/** Is this clip one whose picture follows a framing record that can split it (as the render frames it: mv3b-render.js isFramedClip)? */
function _canSplit(c, aspect, kind = 'bands') {
  if (!c || String(c.fit || 'fit') !== 'fill' || _placed(c) || !isFramed(c.frame)) return false;
  const f = c.frame;
  if ((f.mode !== 'face' && f.mode !== 'bands' && f.mode !== 'cam') || !f.src) return false;
  if (!(+(kind === 'cam' ? f.cam : f.band) > 0)) return false;
  return windowW(+f.src.w, +f.src.h, aspect) < 0.999 && (f.shots || []).some((s) => s && s.kind === kind);
}

// A clip's stretches of the TIMELINE on which its picture is split, [[a, b], ...]: its 'bands' shots (FILE seconds) put
// where the clip lies - its trim, speed and direction as the preview reads them (preview-b.js _srcTime). Before its first
// shot and after its last the nearest shot holds, as windowAt holds it.
function _clipSplit(c, aspect, kind = 'bands') {
  if (!_canSplit(c, aspect, kind)) return [];
  const shots = c.frame.shots;
  const start = +c.start || 0, dur = Math.max(0, +c.dur || 0), sp = +c.speed || 1, tin = +c.trimIn || 0;
  const rev = !!c.reversed;
  const toTl = (f) => (rev ? start + dur - (f - tin) / sp : start + (f - tin) / sp);
  const out = [];
  shots.forEach((s, k) => {
    if (!s || s.kind !== kind) return;
    const f0 = k === 0 ? -Infinity : +s.t0, f1 = k === shots.length - 1 ? Infinity : +s.t1;
    let a = toTl(f0), b = toTl(f1);
    if (a > b) [a, b] = [b, a];
    a = Math.max(start, a); b = Math.min(start + dur, b);
    if (b > a) out.push([a, b]);
  });
  return out;
}

const _merge = (xs) => {
  const s = xs.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const [a, b] of s) { const z = out[out.length - 1]; if (z && a <= z[1]) z[1] = Math.max(z[1], b); else out.push([a, b]); }
  return out;
};
const _minus = (xs, cut) => {
  let left = xs;
  for (const [c0, c1] of cut) {
    const next = [];
    for (const [a, b] of left) {
      if (c1 <= a || c0 >= b) { next.push([a, b]); continue; }
      if (a < c0) next.push([a, c0]);
      if (c1 < b) next.push([c1, b]);
    }
    left = next;
  }
  return left;
};

/**
 * The stretches of the timeline whose frame is SPLIT, [[a, b], ...] in seconds, merged: what shows at each moment is the
 * topmost video lane's clip there (the lanes are held top first) - an insert placed on the frame covers nothing; a lane's
 * clip that is not framed covers the lanes under it.
 */
export function splitSpans(tl, kind = 'bands') {
  const fmt = String((tl && tl.format) || '9:16').split(':');
  const aspect = +fmt[0] > 0 && +fmt[1] > 0 ? +fmt[0] / +fmt[1] : 9 / 16;
  let cover = [];
  let split = [];
  for (const t of _video(tl)) {
    const clips = (t.clips || []).filter((c) => c && !_placed(c) && !c.halfer && (+c.dur || 0) > 0);
    split = split.concat(_minus(_merge(clips.flatMap((c) => _clipSplit(c, aspect, kind))), cover));
    cover = _merge(cover.concat(clips.map((c) => [+c.start || 0, (+c.start || 0) + (+c.dur || 0)])));
  }
  return _merge(split);
}

/** How much of [a, b] the stretches cover, in seconds. */
const _over = (spans, a, b) => spans.reduce((n, [x, y]) => n + Math.max(0, Math.min(b, y) - Math.max(a, x)), 0);

/** Was this page put in the middle by the rule (its own style: the middle, offset by the MARK)? */
export const isRulePlaced = (c) => !!(c && c.style && c.style.pos === 'center' && (+c.style.ty === MARK || +c.style.ty === CAM_TY));

/**
 * THE RULE, on a timeline in hand (changed in place): each page of the subtitle lane in the middle when more than SHARE of
 * its time is on a split frame, back to its lane's place when the rule put it there and that is no longer so; a page placed
 * by hand untouched. Returns how many pages it moved.
 */
export function placeBySplit(tl) {
  const spans = splitSpans(tl);
  const cams = splitSpans(tl, 'cam');
  let moved = 0;
  for (const t of ((tl && tl.tracks) || [])) {
    if (!t || t.kind !== 'subs') continue;
    for (const c of (t.clips || [])) {
      if (!c || !c.name) continue;
      const mine = isRulePlaced(c);
      if (!mine && ownPlace(c)) continue;                    // the person's place
      const a = +c.start || 0, d = Math.max(0, +c.dur || 0);
      // The middle of two bands, or the seam of camera + game - none when neither holds the page for more than SHARE.
      const ty = d > 0 && spans.length > 0 && _over(spans, a, a + d) > SHARE * d ? MARK
        : d > 0 && cams.length > 0 && _over(cams, a, a + d) > SHARE * d ? CAM_TY : null;
      const want = ty != null;
      if (want && (!mine || +c.style.ty !== ty)) {
        c.style = Object.assign({}, c.style || {}, { pos: 'center', tx: 0, ty });
        moved++;
      } else if (!want && mine) {
        const st = Object.assign({}, c.style);
        delete st.pos; delete st.tx; delete st.ty;
        if (Object.keys(st).length) c.style = st; else delete c.style;
        moved++;
      }
    }
  }
  return moved;
}
