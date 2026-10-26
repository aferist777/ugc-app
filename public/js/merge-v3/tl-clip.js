/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — CTRL+C / CTRL+V ON THE TIMELINE (phase V51, points 2 and 4; the owner 2026-10-26, answers (пр45)-(пр50), (пр52)).

   Ctrl+C puts what is picked into THE APP'S OWN BUFFER, not the system's: clips of video, pictures and sound and lines of the
   text lanes. Lines of the subtitle lane are not copied ((пр45): they are heard words - a copy would say the speech twice);
   picked with clips, they are left out. A film with its sound goes as a PAIR: one half picked brings the other, and the copy
   is a pair of its own (a new pairId). A talking head's cell copied is THE PERSON'S clip: nothing ties it to its line any more
   (`frag`, `voice`, `merge` - lib/frag-mirror.js), so the mirror never touches it. A clip's framing (`frame`), its crop and
   every look go with it as they are.

   Ctrl+V lays a copy, ONE mutation - one step to undo -, and what it laid is picked:
     - in the timeline it was copied from: on THE SAME LANES, over what is there (later in the lane's list - drawn on top),
       a third of the copied stretch to the right - several clips together, as they lay, the third of the whole group's
       stretch, first start to last end ((пр46)); pressed again, a third further on from the copy laid last ((пр47), a ladder);
     - in ANOTHER timeline - another project, another fragment of highlights ((пр50), (пр52)): at the playhead, on the lanes of
       the same PLACE - main video to main video, main audio to main audio, "audio 2" to "audio 2", text to text, the upper
       video lanes by their number; a lane missing there is made as a drop makes one (timeline-b.js), in the same step. A
       pair's sound goes to the lane linked to its picture's lane. Pressed again with the playhead where it was, the ladder
       goes on there too;
     - a highlights project's own timeline takes nothing: "Open a fragment first." (lib-views.js noFragment).

   THE BUFFER LIVES while the app is open ((пр49)): in the window's session storage, so it outlives a walk to the Library and
   back and dies with the window - and in this page's memory, for a window where the storage cannot be written.

   timeline-b.js hands this its accessors (wireClip): ids() the picked clip ids, newId(), select(ids), playhead(), and the
   lane makers video(tracks) / audio(tracks) / text(tracks) - inside a mutation, null at the ceiling.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as Store from './store.js';
import * as Views from './lib-views.js';
import { placeBySplit } from '../captions/split.js';
import { showError, showToast } from '../notice.js';

const SS_KEY = 'mv3_clip_buffer';
let _acc = null;
let _mem = null;               // the buffer in this page, when the storage cannot hold it

export function wireClip(acc) { _acc = acc; }

const r2 = (v) => Math.round(v * 100) / 100;
const _clone = (o) => JSON.parse(JSON.stringify(o));
const _media = (t) => !!t && (t.kind === 'video' || t.kind === 'audio');

// ── The buffer ──────────────────────────────────────────────────────────────
function _read() {
  try {
    const s = sessionStorage.getItem(SS_KEY);
    if (s) { const b = JSON.parse(s); if (b && Array.isArray(b.items)) return b; }
  } catch { /* the storage is not there, or not ours */ }
  return _mem;
}
function _write(b) {
  _mem = b;
  try { sessionStorage.setItem(SS_KEY, JSON.stringify(b)); } catch { /* the page's memory keeps it */ }
}

// ── A lane's PLACE, the same in every timeline ──────────────────────────────
// Numbered from the seam, as timeline-b.js _renumber names them: the video lanes from the bottom one (main) up, the audio
// lanes from the top one (main) down, the text lanes in their order. So "video 2" is place 1 of the video lanes anywhere.
function _ofKind(tracks, kind) {
  const list = (tracks || []).filter((t) => t && t.kind === kind);
  return kind === 'video' ? list.reverse() : list;
}
const _placeOf = (tracks, t) => _ofKind(tracks, t.kind).indexOf(t);

// The lane at that place - made, with the lanes before it, when the timeline has fewer (a drop's way: timeline-b.js
// _newVideoLane brings its sound lane along). Inside a mutation. Null when the ceiling stops it.
function _laneAt(tracks, kind, n) {
  for (let guard = 0; guard < 8; guard++) {
    const list = _ofKind(tracks, kind);
    if (list[n]) return list[n];
    const make = _acc && _acc[kind];
    if (typeof make !== 'function' || !make(tracks)) return null;
  }
  return null;
}

/** What the buffer holds now: { n, key } or null - for the tests and anyone who asks. */
export function buffered() {
  const b = _read();
  return b && b.items.length ? { n: b.items.length, key: b.key } : null;
}

// ── Ctrl+C ──────────────────────────────────────────────────────────────────
/**
 * The picked clips and text lines into the buffer, with the other halves of their pairs. Subtitle lines are left out (said
 * when they were picked). Returns { ok, n, left } - n copied, left the subtitle lines left out.
 */
export function copyPicked() {
  const tl = Store.timeline();
  const ids = (_acc && _acc.ids ? _acc.ids() : []) || [];
  if (!tl || !Array.isArray(tl.tracks) || !ids.length) return { ok: false, n: 0, left: 0 };
  const want = new Set(ids);
  const pairs = new Set();
  for (const t of tl.tracks) if (_media(t)) for (const c of (t.clips || [])) if (want.has(c.id) && c.pairId) pairs.add(c.pairId);
  const items = [];
  let left = 0;
  for (const t of tl.tracks) {
    if (!t || !Array.isArray(t.clips)) continue;
    if (t.kind === 'subs') { left += t.clips.filter((c) => want.has(c.id)).length; continue; }
    if (!_media(t) && t.kind !== 'text') continue;
    const n = _placeOf(tl.tracks, t);
    for (const c of t.clips) {
      const picked = want.has(c.id);
      if (!picked && !(_media(t) && c.pairId && pairs.has(c.pairId))) continue;
      const clip = _clone(c);
      // A talking head's cell becomes the person's clip: what bound it to its line stays behind.
      delete clip.frag; delete clip.voice; delete clip.merge;
      items.push({ lane: { id: t.id, kind: t.kind, n }, clip, picked });
    }
  }
  if (!items.length) {
    if (left) showError('Subtitle lines are not copied', { detail: 'They are the words heard in the sound - a copy would say them twice. Clips and lines of the text lanes are copied.' });
    return { ok: false, n: 0, left };
  }
  const s0 = Math.min(...items.map((x) => +x.clip.start || 0));
  const s1 = Math.max(...items.map((x) => (+x.clip.start || 0) + (+x.clip.dur || 0)));
  _write({ v: 1, key: String(Store.key() || ''), span: [r2(s0), r2(s1)], items, laid: {} });
  // Counted as picked: a pair's other half came along by itself.
  const said = items.filter((x) => x.picked).length || items.length;
  if (left) showToast({ mark: '⧉', title: 'Copied ' + said + (said === 1 ? ' clip' : ' clips'),
    where: (left === 1 ? 'a subtitle line was' : left + ' subtitle lines were') + ' left out - they are not copied' });
  return { ok: true, n: items.length, left };
}

// ── Ctrl+V ──────────────────────────────────────────────────────────────────
// Where the group's first start goes. The ladder: the copy laid last in THIS timeline, if it is still there - from where it
// lies now; in another timeline only while the playhead has not moved since (the playhead is the place there).
function _startFor(b, key, tl, head) {
  const third = r2(Math.max(0, (b.span[1] - b.span[0]) / 3));
  const same = key === b.key;
  const last = (b.laid || {})[key];
  if (last && Array.isArray(last.ids) && last.ids.length && (same || Math.abs((+last.head || 0) - head) < 0.005)) {
    const ids = new Set(last.ids);
    const now = [];
    for (const t of tl.tracks || []) for (const c of (t.clips || [])) if (ids.has(c.id)) now.push(+c.start || 0);
    if (now.length) return r2(Math.min(...now) + third);
  }
  return same ? r2(b.span[0] + third) : r2(Math.max(0, head));
}

/**
 * Lay what the buffer holds - one step to undo - and pick it. Returns { ok, n } or { ok: false, why }. Nothing in the buffer:
 * { ok: false } and nothing said.
 */
export function paste() {
  const b = _read();
  if (!b || !b.items.length || !_acc) return { ok: false };
  const key = String(Store.key() || '');
  if (Views.isHlHome(key)) { Views.noFragment(); return { ok: false, why: 'Open a fragment first.' }; }
  const tl0 = Store.timeline();
  if (!tl0 || !Array.isArray(tl0.tracks)) return { ok: false, why: 'Nothing is open' };
  const head = +(_acc.playhead ? _acc.playhead() : 0) || 0;
  const at = _startFor(b, key, tl0, head);
  const shift = at - b.span[0];
  const same = key === b.key;
  const newId = _acc.newId;
  const laid = [], picked = [];
  let lost = 0;

  const ok = Store.mutate((tl) => {
    const tracks = tl.tracks;
    const pairOf = new Map();          // an old pairId -> its copy's
    const placed = new Map();          // a copy's pairId -> how many halves of it were laid
    const laneOf = new Map();          // a copy -> the lane it went on
    const lay = (lane, item) => {
      const c = _clone(item.clip);
      c.id = newId();
      c.start = r2(Math.max(0, (+item.clip.start || 0) + shift));
      if (item.clip.pairId) {
        if (!pairOf.has(item.clip.pairId)) pairOf.set(item.clip.pairId, 'p' + newId().slice(1));
        c.pairId = pairOf.get(item.clip.pairId);
        placed.set(c.pairId, (placed.get(c.pairId) || 0) + 1);
      } else c.pairId = null;
      // Later in the list - drawn over what is there. A sound lane and a text lane keep their order by start.
      lane.clips = (lane.clips || []).concat([c]);
      if (lane.kind !== 'video') lane.clips.sort((x, y) => (+x.start || 0) - (+y.start || 0));
      laid.push(c);
      laneOf.set(c, lane);
      if (item.picked) picked.push(c.id);
      return lane;
    };
    // The lane a clip goes on: in its own timeline the one it came from, while it is there; else the lane of its place.
    const own = (item) => {
      if (same) {
        const t = tracks.find((x) => x.id === item.lane.id && x.kind === item.lane.kind);
        if (t) return t;
      }
      return _laneAt(tracks, item.lane.kind, item.lane.n);
    };
    // The sounds on their own first - a lane they need is then made where it was (a bed under "audio 2"), not taken by the
    // sound lane a new picture lane brings with it; then the pictures, each pair's sound on the lane linked to its picture's;
    // then the text lines.
    const halves = new Map();          // an old pairId -> its sound half
    for (const it of b.items) if (it.lane.kind === 'audio' && it.clip.pairId) halves.set(it.clip.pairId, it);
    const paired = (it) => it.lane.kind === 'audio' && it.clip.pairId
      && b.items.some((x) => x !== it && x.lane.kind === 'video' && x.clip.pairId === it.clip.pairId);
    for (const it of b.items) {
      if (it.lane.kind !== 'audio' || paired(it)) continue;
      const lane = own(it);
      if (lane) lay(lane, it); else lost++;
    }
    for (const it of b.items) {
      if (it.lane.kind !== 'video') continue;
      const lane = own(it);
      const half = it.clip.pairId ? halves.get(it.clip.pairId) : null;
      if (!lane) { lost += half && paired(half) ? 2 : 1; continue; }
      lay(lane, it);
      if (!half || !paired(half)) continue;
      let to = null;
      if (same) to = tracks.find((x) => x.id === half.lane.id && x.kind === 'audio') || null;
      if (!to && lane.linkId) to = tracks.find((x) => x.id === lane.linkId && x.kind === 'audio') || null;
      if (!to) to = _laneAt(tracks, 'audio', half.lane.n);
      if (to) lay(to, half); else lost++;
    }
    for (const it of b.items) {
      if (it.lane.kind !== 'text') continue;
      const lane = own(it);
      if (lane) lay(lane, it); else lost++;
    }
    // A pair whose sound found no lane, or whose sound is not on the lane linked to its picture's: two clips, not a pair -
    // as a drag leaves them (timeline-b.js _endDrag).
    for (const c of laid) {
      if (!c.pairId) continue;
      const mates = laid.filter((x) => x.pairId === c.pairId);
      const v = mates.find((x) => laneOf.get(x).kind === 'video');
      const a = mates.find((x) => laneOf.get(x).kind === 'audio');
      const vl = v && laneOf.get(v), al = a && laneOf.get(a);
      const linked = !!(vl && al && (vl.linkId === al.id || al.linkId === vl.id));
      if (placed.get(c.pairId) < 2 || (!same && !linked)) for (const x of mates) x.pairId = null;
    }
    if (laid.some((c) => laneOf.get(c).kind === 'video')) placeBySplit(tl);
  });
  if (!ok || !laid.length) return { ok: false, why: Store.status() || 'Nothing was laid' };
  b.laid = Object.assign({}, b.laid || {}, { [key]: { ids: laid.map((c) => c.id), head } });
  _write(b);
  if (_acc.select) _acc.select(picked.length ? picked : laid.map((c) => c.id));
  if (lost) showToast({ mark: '⧉', title: 'Pasted ' + (laid.length) + ' of ' + (laid.length + lost),
    where: 'the rest found no lane - four lanes a side is the limit', failed: true });
  return { ok: true, n: laid.length };
}
