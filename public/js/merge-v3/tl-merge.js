/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — CLIPS IN A ROW MERGED INTO ONE (phase V45, the owner 2026-10-24, answers (ю1)-(ю4)).

   Clips picked on the timeline (the band, or Shift + a click one at a time - timeline-b.js) that follow one another on ONE
   lane - with their sound halves on the lane linked to it, or a sound lane alone (a talking head's reads) - are offered to
   be merged: a small window over the last of them, "Merge 5 clips into one?". "merge" asks the server for one file of them
   (POST /api/mv3/merge, lib/merge-clips.js: the picture as it is in the frame and its sound, burnt in, into the project's
   folder), shows how far it got, and lays the file in their place - ONE pair over their whole stretch, one step to undo
   (ю2: the file stays in the project's folder). Captions and every other lane are not touched. Not offered for clips that
   do not follow one another, or for a pick across other lanes (music, a second picture lane). Escape, its cross or a press
   elsewhere close it; while the file is being made it waits (its "cancel" stops it).

   A TALKING HEAD's lines merged (ю3): the merged pair is still the mirror's - it carries the first line's number (`frag`)
   and what it holds (`merge`: each line's take, place and pieces) - so the save writes the merge into the project and the
   mirror lays it as one cell for as long as its lines keep their takes (lib/line-cuts.js, lib/frag-mirror.js). Lines that
   cannot be merged so - laid before they knew their takes, a picture picked without its sound - are refused in words, never
   merged into the person's cell (phase V72: the mirror laid such lines again over it, and the voice sounded twice).

   timeline-b.js hands this its accessors (wireMerge): ids() the picked clip ids, newId(), select(id).
   ═══════════════════════════════════════════════════════════════════════════ */

import * as Store from './store.js';
import * as Layers from '../layers.js';
import { setFigures } from '../num.js';

const SEAM = 0.011;
let _acc = null;
let _win = null;
const r3 = (v) => Math.round(v * 1000) / 1000;

export function wireMerge(acc) { _acc = acc; }

const _end = (c) => (+c.start || 0) + (+c.dur || 0);
const _media = (t) => t && (t.kind === 'video' || t.kind === 'audio');

/**
 * What the pick can be merged as: { video: { lane, clips }, audio: { lane, clips }, n, s0, s1 } - or null. The picked
 * clips and their pair halves; captions and text lines in the pick are not media and are left out.
 */
export function mergeable(tl, ids) {
  if (!tl || !Array.isArray(tl.tracks) || !ids || ids.length < 2) return null;
  const want = new Set(ids);
  const pairs = new Set();
  for (const t of tl.tracks) if (_media(t)) for (const c of (t.clips || [])) if (want.has(c.id) && c.pairId) pairs.add(c.pairId);
  const lanes = new Map();
  for (const t of tl.tracks) {
    if (!_media(t)) continue;
    const cs = (t.clips || []).filter((c) => want.has(c.id) || (c.pairId && pairs.has(c.pairId)));
    if (cs.length) lanes.set(t, cs.slice().sort((a, b) => (+a.start || 0) - (+b.start || 0)));
  }
  const vids = [...lanes.keys()].filter((t) => t.kind === 'video');
  const auds = [...lanes.keys()].filter((t) => t.kind === 'audio');
  if (vids.length > 1 || auds.length > 1) return null;
  const v = vids[0] || null, a = auds[0] || null;
  // The sound of a picture lane is the lane linked to it; a sound alone is any sound lane.
  if (v && a && v.linkId !== a.id && a.linkId !== v.id) return null;
  const row = (cs) => cs.every((c, i) => !i || Math.abs(_end(cs[i - 1]) - (+c.start || 0)) <= SEAM);
  const vc = v ? lanes.get(v) : [], ac = a ? lanes.get(a) : [];
  const main = vc.length ? vc : ac;
  if (main.length < 2 || !row(vc) || !row(ac)) return null;
  const s0 = +main[0].start || 0, s1 = _end(main[main.length - 1]);
  if (vc.length && ac.length && (Math.abs((+ac[0].start || 0) - s0) > SEAM || Math.abs(_end(ac[ac.length - 1]) - s1) > SEAM)) return null;
  // A clip that cannot be read (its file gone, red on the timeline) is no part of a merge.
  if (main.some((c) => Store.isGone && Store.isGone(c.id))) return null;
  // (ю3) A TALKING HEAD's lines (`frag`) merge as whole lines - every piece of each - and never with the person's own clips.
  const all = vc.concat(ac);
  const lines = all.filter((c) => Number(c.frag) > 0);
  if (lines.length) {
    if (lines.length !== all.length) return null;
    for (const t of [v, a].filter(Boolean)) {
      const inRun = new Set(lanes.get(t).map((c) => c.id));
      const ns = new Set(lanes.get(t).map((c) => +c.frag));
      if ((t.clips || []).some((c) => ns.has(+c.frag) && !inRun.has(c.id))) return null;
    }
  }
  return { video: v ? { lane: v.id, clips: vc } : null, audio: a ? { lane: a.id, clips: ac } : null, n: main.length, s0, s1 };
}

// (ю3) What a talking head's merged cell holds, line by line - each line's take and its pieces: where in the line's own file,
// how long, where in the merged file (lib/line-cuts.js). A merged cell merged again passes its lines on. Null - no lines.
// (phase V72, the owner's (э2)) `why` - lines that cannot be merged AS LINES, in words: a merge of them would be laid as the
// person's cell, the mirror would lay the same lines again over it and the voice would sound twice - so it is refused. A
// sound cell laid before the voices were written (phase V30) does not say which take it speaks (opening the project tells
// it - lib/frag-mirror.js catchUp); a line's picture without its sound is not a line.
const OLD_CELLS = 'These lines were laid before they knew their takes - open the project again, then merge.';
function _linesOf(m) {
  const ac = m.audio ? m.audio.clips : [];
  const vc = m.video ? m.video.clips : [];
  if (!ac.concat(vc).some((c) => Number(c.frag) > 0)) return null;
  if (!ac.some((c) => Number(c.frag) > 0)) return { why: 'A talking head\'s lines merge with their sound - pick them on main audio too.' };
  const lines = [];
  const byVoice = new Map();
  for (const c of ac) {
    const at = (+c.start || 0) - m.s0;
    if (Array.isArray(c.merge) && c.merge.length) {
      for (const e of c.merge) lines.push({ n: e.n, voice: e.voice, pieces: e.pieces.map(([tin, d, o]) => [tin, d, r3(o + at)]) });
      continue;
    }
    if (!c.voice) return { why: OLD_CELLS };
    let L = byVoice.get(c.voice);
    if (!L) { L = { n: +c.frag, voice: c.voice, pieces: [] }; byVoice.set(c.voice, L); lines.push(L); }
    L.pieces.push([r3(+c.trimIn || 0), r3(+c.dur || 0), r3(at)]);
  }
  const frag = Math.min(...ac.map((c) => +c.frag));
  return { cell: (kind) => ({ frag, ...(kind === 'audio' ? { merge: lines } : {}) }) };
}

/** After a pick gesture: clips in a row are offered to be merged; anything else closes the offer. */
export function offerMerge() {
  if (!_acc) return;
  if (_win && _win.job) return;                 // a merge is being made: its window stays
  closeMerge();
  const m = mergeable(Store.timeline(), _acc.ids());
  if (!m || !Store.canEdit()) return;
  const last = (m.video || m.audio).clips[m.n - 1];
  const anchor = document.querySelector(`.mv3b-clip[data-clip="${CSS.escape(last.id)}"]`);
  if (!anchor) return;
  const box = document.createElement('div');
  // (phase V73 block 5, 5c; the owner's (б5-16) б) one line as it was - only its edges and its ✕: the frame of the panels at their
  // button (`u-win is-float`) holding its head row alone (`u-win-head`), the 28-px ✕ at its right end
  box.className = 'mv3-mergeask u-win is-float';
  box.innerHTML = '<div class="mv3-mergeask-r u-win-head"><span class="mv3-mergeask-t"></span>'
    + '<button type="button" class="mv3-mergeask-go u-btn is-s is-main">Merge</button>'
    + '<button type="button" class="mv3-mergeask-x u-btn is-icon is-quiet u-x" title="Close (Esc)"></button></div>';
  setFigures(box.querySelector('.mv3-mergeask-t'), 'Merge ' + m.n + ' clips into one?');
  // (phase V72) Lines that cannot be merged as lines: the words in place of the offer, nothing to press.
  const why = (_linesOf(m) || {}).why;
  if (why) {
    box.querySelector('.mv3-mergeask-t').textContent = why;
    box.querySelector('.mv3-mergeask-t').classList.add('is-bad');
    box.querySelector('.mv3-mergeask-go').remove();
  }
  document.body.appendChild(box);
  const r = anchor.getBoundingClientRect();
  const w = box.offsetWidth, h = box.offsetHeight;
  box.style.left = Math.round(Math.max(6, Math.min(window.innerWidth - w - 6, r.right - w))) + 'px';
  box.style.top = Math.round(r.top - h - 6 >= 6 ? r.top - h - 6 : r.bottom + 6) + 'px';
  const away = (e) => { if (_win && !_win.job && !box.contains(e.target)) closeMerge(); };
  _win = { box, m, ids: _acc.ids().slice().sort().join(','), away, job: null, timer: 0,
    layer: Layers.open(box, { modal: false, name: 'merge clips', onEsc: () => { if (!_win || !_win.job) closeMerge(); } }) };
  const goBtn = box.querySelector('.mv3-mergeask-go');
  if (goBtn) goBtn.addEventListener('click', _go);
  box.querySelector('.mv3-mergeask-x').addEventListener('click', () => { if (_win && _win.job) _cancel(); else closeMerge(); });
  // On the next turn: the press that made the pick is not "elsewhere".
  setTimeout(() => { if (_win && _win.box === box) document.addEventListener('mousedown', away, true); }, 0);
}

/** The pick changed: an offer made for another pick goes (a merge being made stays). */
export function refreshMerge() {
  if (!_win || _win.job || !_acc) return;
  if (_acc.ids().slice().sort().join(',') !== _win.ids) closeMerge();
}

export function closeMerge() {
  if (!_win) return;
  const w = _win;
  _win = null;
  clearTimeout(w.timer);
  document.removeEventListener('mousedown', w.away, true);
  Layers.close(w.layer);
  w.box.remove();
}

function _say(text, bad) {
  if (!_win) return;
  const t = _win.box.querySelector('.mv3-mergeask-t');
  setFigures(t, text);                               // (phase V73 block 5, 5c) "merging… 42%" - its figures in mono
  t.classList.toggle('is-bad', !!bad);
}

async function _go() {
  const w = _win;
  if (!w || w.job) return;
  const go = w.box.querySelector('.mv3-mergeask-go');
  if (!go) return;
  const why = (_linesOf(w.m) || {}).why;           // (phase V72) never merged into the person's cell
  if (why) { go.remove(); _say(why, true); return; }
  go.disabled = true;
  go.style.display = 'none';
  w.box.querySelector('.mv3-mergeask-x').title = 'Stop merging';
  _say('merging…');
  const tl = Store.timeline();
  try {
    const r = await fetch('/api/mv3/merge', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: Store.key(), format: tl && tl.format,
        video: w.m.video ? w.m.video.clips : [], audio: w.m.audio ? w.m.audio.clips : [] }) }).then((x) => x.json());
    if (!r.success) throw new Error(r.error || 'not merged');
    w.job = r.job;
    _follow(w);
  } catch (e) {
    if (_win !== w) return;
    go.style.display = '';
    go.disabled = false;
    _say(e.message, true);
  }
}

function _follow(w) {
  w.timer = setTimeout(async () => {
    if (_win !== w || !w.job) return;
    let j = null;
    try { j = (await fetch('/api/mv3/merge/' + encodeURIComponent(w.job.id)).then((x) => x.json())).job; } catch (e) { j = null; }
    if (_win !== w) return;
    if (!j) { _follow(w); return; }
    w.job = j;
    if (j.state === 'running') { _say('merging… ' + (j.pct || 0) + '%'); _follow(w); return; }
    if (j.state === 'done') { _lay(w, j); return; }
    w.job = null;
    if (j.state === 'cancelled') { closeMerge(); return; }
    _say('Not merged: ' + (j.error || 'ffmpeg stopped'), true);
  }, 400);
}

async function _cancel() {
  const w = _win;
  if (!w || !w.job) return;
  try { await fetch('/api/mv3/merge/' + encodeURIComponent(w.job.id) + '/cancel', { method: 'POST' }); } catch (e) { /* it stops anyway */ }
  w.job = null;
  closeMerge();
}

// The file in place of the clips - ONE mutation, one step to undo. Laid only if the clips are still what was merged.
function _lay(w, j) {
  const m = w.m;
  const same = (a, b) => b && a.src === b.src && Math.abs((+a.start || 0) - (+b.start || 0)) < 0.001
    && Math.abs((+a.dur || 0) - (+b.dur || 0)) < 0.001 && Math.abs((+a.trimIn || 0) - (+b.trimIn || 0)) < 0.001;
  const sets = [m.video, m.audio].filter(Boolean);
  const pairId = m.video && m.audio ? 'p' + _acc.newId().replace(/^c/, '') : null;
  const dur = r3(m.s1 - m.s0);
  const name = 'merged · ' + m.n + ' clips';
  const mergeOf = _linesOf(m);                                // a talking head's lines inside (ю3)
  // (phase V72) Lines that cannot be merged as lines are never laid as the person's cell.
  if (mergeOf && mergeOf.why) { w.job = null; _say(mergeOf.why + ' The file is in the project\'s folder, nothing was laid.', true); return; }
  let newVideo = null, newAudio = null;
  const ok = Store.mutate((tl) => {
    for (const set of sets) {
      const lane = tl.tracks.find((t) => t.id === set.lane);
      if (!lane || !set.clips.every((c) => same(c, (lane.clips || []).find((x) => x.id === c.id)))) {
        throw new Error('The clips changed while they were being merged - the file is in the project\'s folder, nothing was laid.');
      }
    }
    for (const set of sets) {
      const lane = tl.tracks.find((t) => t.id === set.lane);
      const gone = new Set(set.clips.map((c) => c.id));
      const at = lane.clips.findIndex((c) => gone.has(c.id));
      const first = set.clips[0];
      const cell = {
        id: _acc.newId(), src: j.src, name, thumb: null, poster: null, libId: null,
        start: r3(m.s0), dur, srcDur: dur, trimIn: 0, trimOut: 0, speed: 1, reversed: false,
        transition: null, animation: null, filter: null, volume: null, pairId,
        ...(mergeOf ? mergeOf.cell(lane.kind, first) : {}),
      };
      lane.clips = lane.clips.filter((c) => !gone.has(c.id));
      lane.clips.splice(Math.max(0, at), 0, cell);
      if (lane.kind === 'audio') { lane.clips.sort((x, y) => x.start - y.start); newAudio = cell.id; } else newVideo = cell.id;
    }
  });
  if (!ok) { w.job = null; _say(Store.status() || 'Not laid', true); return; }
  w.job = null;
  closeMerge();
  if (_acc.select) _acc.select(newVideo || newAudio);
}
