/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — HIGHLIGHTS: THE COMMON SETTINGS OF THE TICKED FRAGMENTS

   While two fragments or more are ticked (highlights.js), the TIMELINE'S PANEL IS COVERED BY ONE ROW OF BUTTONS under its top
   edge - Subtitles · Main video · Main audio · Music, for all N (no lanes, no transport). A button, like the NAME of such a lane
   on the timeline, opens its common settings in the strip on the right instead of the one lane's (lib-views.js laneAlt): at the
   top "for all N", under it each fragment. The captions crumb with fragments ticked leads to the same place as Subtitles.
     Subtitles    where (up / down, and «example» dragged on the preview), size (one number for all), words in a line,
                  lines, the title on top on / off; under them the tiles' tabs (highlights.js); each fragment its
                  preset and how many of its pages stand in a place of their own - never moved by the common place; a press on
                  one opens it with its own Subtitles picked, all of its settings. A place set for all is HELD over presets
                  (captions/style.js `hold`).
     Main video   its colour, its frame ("By the kind" back to the app's), its punch-ins and its patterns - the set with ticks
                  and the layers with their settings, as the one lane's strip has them (patterns-ui.js): each change puts the
                  WHOLE list on all of them; its EFFECTS: a tile puts the clip effect on every ticked fragment - a moment on
                  the clip at its start, one that goes on over the whole fragment (fx-ui.js laneEffects; the faces found here;
                  POST /fx). Each fragment its own; a press opens it with its main video picked.
     Main audio   the volume and the pitch for all; each fragment its own volume.
     Music        the volume for all - the lane's, in dB, so each keeps its own balance (the bed at -12 dB); "deal
                  again" from moods, or no music; each fragment its track and a choice of another one of its mood, one of a
                  mood, or none - the server measures and lays it (routes/highlights.js), only the app's clips replaced.
                  No music lane on the open fragment: "+ music" makes its "audio 2".
   The OPEN fragment among the ticked is the page's - its own undo step; the others are the server's. No undo for several:
   a slider brought back gives back the same pages and place. Nothing ticked open and a lane's name pressed on the project's own
   timeline: the first ticked opens. A fragment's row in the strip shows its own timeline until "‹ all N".

   THE SAMPLE: while the Subtitles block is in the strip, the preview draws a whole page of «example» - as many words in a
   line as the lanes have, in as many lines - in the open fragment's look, instead of its subtitles (captions/layer.js setLive),
   and it is dragged up and down there (cap-place.js setSample); let go, the place is written for all.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as Store from './store.js';
import * as Views from './lib-views.js';
import * as C from './controls.js';
import * as CapPlace from './cap-place.js';
import { fitTimeline } from './layout.js';
import { setSubsStyle, selectTrackById, onSelChange, newBedLane, mainVideo, patternsOf, setPatterns, setClipsFields } from './timeline-b.js';
// Main video's colour and frame, main audio's pitch - for all of them.
import { COLOR_KEYS, COLOR_RANGE, COLOR_LABEL, colorOf } from '../overlay/color.js';
import { FRAMINGS, modeOf } from './framing-ui.js';
import { pitchOf } from '../sound/pitch.js';
import { pitchRows } from './pitch-rows.js';
// Main video's patterns, picked by ticks - the one lane's block, for all of them.
import { renderPatterns, nameOf as patternName } from './patterns-ui.js';
// Main video's effects - the clip effects' panel, for all of them.
import { fxGroupRows, laneEffects, facesFor } from './fx-ui.js';
import { EFFECTS, SETS } from '../fx/effects.js';
import { normalizeFx } from '../fx/params.js';
import { normalizeStyle, autoWordsPerLine, autoSize, POSITIONS, rowsOn } from '../captions/style.js';
import { paginate } from '../captions/pages.js';
import { putTitle, dropTitle, titleLaneOf, topTitleOf } from '../captions/title.js';
// Being read, could not be read - the shared parts (rows of the strip); the reason a popup.
import { loadingEl, failedEl } from '../ui-state.js';
import { showError } from '../notice.js';
// The buttons over the timeline: "+" and "‹" as Lucide's icons, N in mono.
import { iconEl } from '../icons.js';
import { figures } from '../num.js';
import { moodName } from './hl-music.js';
import * as T from '../i18n/t.js';

let _A = null;             // what highlights.js lends: { pid, rec, ticked, openN, load, say, whole, tiles(host) }
let _own = '';              // a fragment opened from its row with its OWN Subtitles picked - its key
let _busy = '';             // 'subs' | 'speech' | 'music' | 'pattern' | 'video' while a write for all is under way
let _patWant = null;        // the patterns waiting to go to the rest while a write of them is under way: { list, ns }
let _moods = null;          // Music -> highlights: [{ id, label, n }] (the root as 'yours' when it has tracks)
let _moodsAsk = '';         // 'asking' while it is read, 'failed' when it could not be (the reason was a popup)
let _dealMoods = [];        // the moods "deal again" takes
let _sample = false;        // the «example» is on the preview

const _el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const _enc = encodeURIComponent;
async function _post(url, body) {
  let r = null, d = null;
  try { r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }); d = await r.json(); } catch (e) { d = null; }
  if (!r || !d || !d.success) throw new Error((d && d.error) || T.t('The app did not answer - try again in a moment.'));
  return d;
}

// ── Who is in the group ─────────────────────────────────────────────────────
/** Two fragments or more ticked (made) - the buttons over the timeline lead to the common settings. */
export const isGroup = () => !!(_A && _A.pid() && _A.ticked().length >= 2);
const _tl = () => Store.timeline() || {};
const _openSubs = () => ((_tl().tracks) || []).find((t) => t && t.kind === 'subs') || null;
const _openA1 = () => ((_tl().tracks) || []).find((t) => t && t.id === 'a1') || null;
/** The lane a fragment's music lies on (the one with the app's bed `hm…`, else "audio 2") - highlights-cut.js musicLaneOf. */
const _isBed = (c) => !!(c && /^hm/.test(String(c.id || '')));
function musicLaneOf(tl) {
  const auds = (((tl || {}).tracks) || []).filter((t) => t && t.kind === 'audio' && t.id !== 'a1');
  return auds.find((t) => (t.clips || []).some(_isBed)) || auds.find((t) => t.id === 'a2') || null;
}
export const openMusicLane = () => musicLaneOf(_tl());
const _split = () => {
  const list = _A.ticked();
  const n = _A.openN();
  const open = list.find((f) => f.n === n) || null;
  return { list, open, rest: list.filter((f) => f !== open) };
};

// What a ticked fragment's subtitles are now: the open one's from its timeline, the others' as the server read them (`lanes`).
function _subsOf(f) {
  if (f.n === _A.openN()) {
    const lane = _openSubs();
    const st = normalizeStyle((lane && lane.style) || {});
    const own = ((lane && lane.clips) || []).filter((c) => c && c.style && ['pos', 'tx', 'ty'].some((k) => c.style[k] != null)).length;
    return { pos: st.pos, ty: st.ty, size: st.size, sizeAuto: st.sizeAuto !== false, wordsPerLine: st.wordsPerLine, lines: st.lines, hold: !!st.hold, own,
      rows: rowsOn(st) ? 2 : 1 };
  }
  return (f.lanes && f.lanes.subs) || null;
}
const _same = (vals) => vals.length > 0 && vals.every((v) => JSON.stringify(v) === JSON.stringify(vals[0]));
const _titled = (f) => (f.n === _A.openN() ? !!titleLaneOf(_tl()) : !!(f.cap && f.cap.titled));

// ── Writes: the open one by the page, the rest by the server ────────────────
async function _forAll(kind, page, server, said) {
  if (_busy) return;
  const { open, rest } = _split();
  if (open) page();
  if (!rest.length) { Views.altChanged(); return; }
  _busy = kind;
  Views.altChanged();
  try { await server(rest.map((f) => f.n)); if (said) _A.say(said); } catch (e) { _A.say(e.message, true); }
  _busy = '';
  await _A.load();
  Views.altChanged();
}

/** Place, size, words, lines for all the ticked. */
function _subsPatch(patch, said) {
  const fmt = _tl().format || '9:16';
  _forAll('subs', () => {
    const lane = _openSubs();
    if (!lane) return;
    const p = {};
    if (patch.place) Object.assign(p, { pos: patch.place.pos, ty: patch.place.ty, hold: true });
    if (patch.size === 'auto') Object.assign(p, { sizeAuto: true, size: autoSize(fmt) });
    else if (patch.size != null) Object.assign(p, { size: patch.size, sizeAuto: false });
    if (patch.wordsPerLine != null) p.wordsPerLine = patch.wordsPerLine;
    if (patch.lines != null) p.lines = patch.lines;
    // Two rows, or one - no field.
    if (patch.rows != null) p.rows = +patch.rows === 2 ? 2 : undefined;
    setSubsStyle(lane.id, p, patch.size != null || patch.wordsPerLine != null || patch.lines != null);
  }, (ns) => _post('/api/highlights/' + _enc(_A.pid()) + '/style', { ns, ...patch }), said);
}

/**
 * Main video's patterns - the whole list - for all the ticked: the open one by the page (its own undo step), the
 * rest by the server, the latest list only while one is on its way (a tick after a tick sends both).
 */
async function _patternsAll(next) {
  if (_busy && _busy !== 'pattern') { _A.say(T.t('A moment - the last change is still being put on them.'), true); return; }
  const { open, rest } = _split();
  if (open) setPatterns(next);
  if (!rest.length) { Views.altChanged(); return; }
  _patWant = { list: next, ns: rest.map((f) => f.n) };
  if (_busy === 'pattern') return;
  _busy = 'pattern';
  Views.altChanged();
  while (_patWant) {
    const w = _patWant;
    _patWant = null;
    try { await _post('/api/highlights/' + _enc(_A.pid()) + '/patterns', { ns: w.ns, patterns: w.list }); } catch (e) { _A.say(e.message, true); }
  }
  _busy = '';
  await _A.load();
  Views.altChanged();
}

// ── MAIN VIDEO of the ticked ─────────────────────────────────────────────
// Its colour (one value of one slider), its punch-ins on / off - into every clip of main video of every ticked fragment, the open one
// by the page (one undo step), the rest by the server; its frame planned by the server for all of them, the open one's laid here.
const _mainOpen = () => { const m = mainVideo(); return ((m && m.clips) || []).filter((c) => c && c.src); };
const _uniq = (list) => { const seen = new Set(), out = []; for (const v of list) { const k = JSON.stringify(v); if (!seen.has(k)) { seen.add(k); out.push(v); } } return out; };
/** What a ticked fragment's main video is now: the open one's from its timeline, the others' as the server read them. */
function _videoOf(f) {
  if (f.n === _A.openN()) {
    const cs = _mainOpen();
    const z = cs.filter((c) => c.frame && Array.isArray(c.frame.zooms) && c.frame.zooms.length);
    return { modes: _uniq(cs.map(modeOf)), was: cs.some((c) => c.frameWas), colors: _uniq(cs.map((c) => colorOf(c))),
      zooms: z.length, zoomOff: z.filter((c) => c.frame.noZoom).length };
  }
  return (f.lanes && f.lanes.video) || { modes: [], was: false, colors: [], zooms: 0, zoomOff: 0 };
}
// A fragment's frame as the switch says it: 'kind' while it is the app's, its one mode, or 'mixed'.
const _frameState = (v) => (!v.was ? 'kind' : v.modes.length === 1 ? v.modes[0] : 'mixed');
// The words in the app's language (FRAMINGS says its own so).
const FRAME_WORDS = Object.fromEntries([['kind', T.t('By the kind')], ...FRAMINGS, ['mixed', T.t('Mixed')], ['active', T.t('By the kind')]]);
const _frameWord = (k) => FRAME_WORDS[k] || k;
function _videoAll(patch) {
  if (_busy) { _A.say(T.t('A moment - the last change is still being put on them.'), true); return; }
  _forAll('video', () => {
    const lane = mainVideo();
    if (!lane) return;
    const items = [];
    for (const c of _mainOpen()) {
      if (patch.color) items.push({ trackId: lane.id, clipId: c.id, patch: { color: { ...colorOf(c), [patch.color.key]: patch.color.value } } });
      else if (c.frame && Array.isArray(c.frame.zooms) && c.frame.zooms.length) {
        items.push({ trackId: lane.id, clipId: c.id, patch: { frame: { ...c.frame, noZoom: patch.zoom ? undefined : true } } });
      }
    }
    if (items.length) setClipsFields(items);
  }, (ns) => _post('/api/highlights/' + _enc(_A.pid()) + '/video', { ns, ...patch }));
}
async function _framingAll(mode) {
  if (_busy) { _A.say(T.t('A moment - the last change is still being put on them.'), true); return; }
  const { list, open } = _split();
  _busy = 'video';
  Views.altChanged();
  try {
    const d = await _post('/api/highlights/' + _enc(_A.pid()) + '/video', { ns: list.map((f) => f.n), open: open ? open.n : 0, framing: mode });
    const lane = mainVideo();
    if (open && d.open && lane) {
      const items = Object.entries(d.open).map(([id, ch]) => ({ trackId: lane.id, clipId: id, patch: { frame: ch.frame || null, frameWas: ch.frameWas || null } }));
      if (items.length) setClipsFields(items);
    }
    _A.say(d.missed ? T.tn(d.missed, '{n} fragment kept its frame: {why}', '{n} fragments kept their frame: {why}', { why: d.why })
      : T.t('framed: {how}', { how: _frameWord(mode).toLowerCase() }), !!d.missed);
  } catch (e) { _A.say(e.message, true); }
  _busy = '';
  await _A.load();
  Views.altChanged();
}

// ── MAIN VIDEO'S EFFECTS for all the ticked ───────────────────────────────────────
// A tile pressed puts the effect on each ticked fragment's main video taken as one film (fx-ui.js laneEffects - the page's one rule):
// a moment on the clip at the fragment's start, one that goes on over the whole fragment, a set's at their own moments. The faces of
// the effects by the face are found here for every fragment (fx-ui.js facesFor - counted when they were cut, so at once), the other
// fragments' main video read for it; the open one written by the page (one undo step), the rest by the server (POST /fx, `add`). ✕ on
// a kind takes it off all of them.
let _fxWait = null;         // { k, i, n, frac } while the faces of the ticked are found
// The effects' names are the table's, in the app's language already.
const _fxName = (k) => (String(k).startsWith('set:') ? ((SETS[String(k).slice(4)] || {}).name || T.t('The set')) : ((EFFECTS[k] || {}).name || T.t('The effect')));
/** The kinds of effects a ticked fragment's main video has: the open one's from its timeline, the others' as the server read them. */
function _fxKindsOf(f) {
  if (f.n === _A.openN()) { const set = new Set(); for (const c of _mainOpen()) for (const e of (c.fx || [])) set.add(e.k); return [...set]; }
  return (f.lanes && f.lanes.video && f.lanes.video.fx) || [];
}
async function _mainOf(f, open) {
  if (open && f === open) return mainVideo();
  let d = null;
  try { d = await (await fetch('/api/mv3/timeline?peek=1&key=' + _enc(f.key))).json(); } catch (e) { d = null; }
  return d && d.success && d.found !== false && d.timeline ? ((d.timeline.tracks || []).find((t) => t && t.kind === 'video' && t.main) || null) : null;
}
async function _fxAll(k) {
  if (_busy) { _A.say(T.t('A moment - the last change is still being put on them.'), true); return; }
  const { list, open } = _split();
  _busy = 'fx';
  _fxWait = null;
  Views.altChanged();
  try {
    const work = [];
    for (const f of list) {
      const lane = await _mainOf(f, open);
      if (lane) for (const w of laneEffects(lane.clips, k)) work.push({ f, track: lane, clip: w.clip, made: w.made });
    }
    if (!work.length) throw new Error(T.t('Their main video has nothing to put it on.'));
    await facesFor(work, (i, n, frac) => { _fxWait = { k: work[0].made[0].k, i, n, frac }; Views.altChanged(); });
    _fxWait = null;
    // The open one by the page (one undo step) - its clips as they are now.
    const lane = open ? mainVideo() : null;
    const items = [];
    for (const w of work) {
      if (w.f !== open || !lane) continue;
      const now = (lane.clips || []).find((c) => c.id === w.clip.id);
      if (now) items.push({ trackId: lane.id, clipId: now.id, patch: { fx: normalizeFx([...(now.fx || []), ...w.made]) || [] } });
    }
    if (items.length) setClipsFields(items);
    // The rest by the server.
    const add = {};
    for (const w of work) { if (w.f === open) continue; (add[w.f.n] = add[w.f.n] || {})[w.clip.id] = w.made; }
    if (Object.keys(add).length) await _post('/api/highlights/' + _enc(_A.pid()) + '/fx', { add });
    const nf = new Set(work.map((w) => w.f.n)).size;
    _A.say(T.tn(nf, '{name} is on {n} fragment', '{name} is on {n} fragments', { name: _fxName(k) }));
  } catch (e) { _A.say(e.message, true); } finally { _busy = ''; _fxWait = null; }
  await _A.load();
  Views.altChanged();
}
function _fxOff(k) {
  if (_busy) { _A.say(T.t('A moment - the last change is still being put on them.'), true); return; }
  _forAll('fx', () => {
    const lane = mainVideo();
    if (!lane) return;
    const items = _mainOpen().filter((c) => (c.fx || []).some((e) => e.k === k)).map((c) => {
      const left = (c.fx || []).filter((e) => e.k !== k);
      return { trackId: lane.id, clipId: c.id, patch: { fx: left.length ? left : null } };
    });
    if (items.length) setClipsFields(items);
  }, (ns) => _post('/api/highlights/' + _enc(_A.pid()) + '/fx', { ns, remove: k }), T.t('{name} is off them', { name: _fxName(k) }));
}

// ── Main audio's pitch for all the ticked - the open one by the page, the rest by the server (the part changed).
function _pitchAll(fn, part) {
  if (_busy) { _A.say(T.t('A moment - the last change is still being put on them.'), true); return; }
  _forAll('speech', () => {
    const a1 = _openA1();
    if (!a1) return;
    const items = (a1.clips || []).filter((c) => c && c.src).map((c) => ({ trackId: a1.id, clipId: c.id, patch: { pitch: fn(c.pitch) } }));
    if (items.length) setClipsFields(items);
  }, (ns) => _post('/api/highlights/' + _enc(_A.pid()) + '/pitch', { ns, pitch: part }));
}

/** The title on top on / off for all the ticked. */
function _titleAll(on) {
  const rec = _A.rec();
  _forAll('subs', () => {
    const { open } = _split();
    if (!open) return;
    if (on) {
      const text = topTitleOf(open, { whole: _A.whole(), language: (rec && rec.agent && rec.agent.language) || '' });
      Store.mutate((tl) => { putTitle(tl, text, open.length || open.seconds, () => 'ht' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)); });
    } else Store.mutate((tl) => { dropTitle(tl); });
  }, (ns) => _post('/api/highlights/' + _enc(_A.pid()) + '/title-on-top', { ns, on: !!on }), on ? T.t('the title is on top of them') : T.t('the title is off them'));
}

/** A lane's volume - 'speech' (main audio) or 'music' - for all the ticked, or for one (`only`). */
function _volume(lane, volume, only) {
  const v = Math.round(volume * 10000) / 10000;
  const pageSide = () => Store.mutate((tl) => {
    const t = lane === 'music' ? musicLaneOf(tl) : (tl.tracks || []).find((x) => x && x.id === 'a1');
    if (t) t.volume = v;
  });
  if (only) {
    if (only.n === _A.openN()) { pageSide(); return; }
    _busy = lane;
    _post('/api/highlights/' + _enc(_A.pid()) + '/volume', { ns: [only.n], lane, volume: v })
      .catch((e) => _A.say(e.message, true)).then(async () => { _busy = ''; await _A.load(); Views.altChanged(); });
    return;
  }
  _forAll(lane, pageSide, (ns) => _post('/api/highlights/' + _enc(_A.pid()) + '/volume', { ns, lane, volume: v }));
}

// The music the server handed back for the open fragment, laid by the page: the app's clips replaced on its music lane - "audio 2"
// made when it has none - one undo step.
function _layOpenMusic(clips) {
  Store.mutate((tl) => {
    for (const t of (tl.tracks || [])) if (t && t.kind === 'audio') t.clips = (t.clips || []).filter((c) => !_isBed(c));
    if (!clips || !clips.length) return;
    const lane = musicLaneOf(tl) || newBedLane(tl.tracks);
    if (lane) for (const c of clips) lane.clips.push(c);
  });
}

/** One fragment's music: 'another', a mood id, or 'none'. */
async function _musicOne(f, how) {
  if (_busy) return;
  const taken = _A.ticked().filter((x) => x !== f && x.music).map((x) => x.music.id);
  const open = f.n === _A.openN();
  _busy = 'music';
  Views.altChanged();
  try {
    const d = await _post('/api/highlights/' + _enc(_A.pid()) + '/fragments/' + f.n + '/music', { how, taken, open });
    if (open) _layOpenMusic(d.clips || []);
    _A.say(d.music ? '«' + f.title + '»: ' + d.music.title : T.t('«{name}»: no music', { name: f.title }));
  } catch (e) { _A.say(e.message, true); }
  _busy = '';
  await _A.load();
  Views.altChanged();
}

/** The music of all the ticked dealt again from `_dealMoods`, or taken off (`none`). */
async function _musicAll(none) {
  if (_busy) return;
  const { list, open } = _split();
  if (!none && !_dealMoods.length) { _A.say(T.t('choose a mood or more first'), true); return; }
  _busy = 'music';
  Views.altChanged();
  try {
    const d = await _post('/api/highlights/' + _enc(_A.pid()) + '/music', { ns: list.map((f) => f.n), ...(none ? { none: true } : { moods: _dealMoods.slice() }), open: open ? open.n : 0 });
    if (d.open) _layOpenMusic(d.open.clips || []);
    const what = none ? T.tn(d.n, 'no music on {n} fragment', 'no music on {n} fragments') : T.tn(d.n, 'music dealt again to {n} fragment', 'music dealt again to {n} fragments');
    _A.say(d.missed ? T.t('{what} - {n} could not be laid', { what, n: d.missed }) : what, !!d.missed);
  } catch (e) { _A.say(e.message, true); }
  _busy = '';
  await _A.load();
  Views.altChanged();
}

async function _readMoods() {
  if (_moodsAsk) return;
  _moodsAsk = 'asking';
  try {
    const r = await fetch('/api/audio/music/highlights');
    const d = await r.json();
    if (!d || !d.success) throw new Error((d && d.error) || '');
    _moods = (d.moods || []).map((m) => ({ id: m.id, label: m.label, n: (m.tracks || []).length }));
    if ((d.root || []).length) _moods.push({ id: 'yours', label: 'yours', n: d.root.length });
    _moodsAsk = '';
  } catch (e) {
    // Not read is not "no moods": the strip says "did not load" with Try again.
    _moodsAsk = 'failed';
    showError(T.t('Music → highlights could not be read'), { detail: (e && e.message) || '' });
  }
  Views.altChanged();
}

// ── Painting ────────────────────────────────────────────────────────────────
// The strip's head takes this title (inspector.js _paintHead, `data-strip-title`).
function _head(host, what, n) {
  const h = _el('div', 'mv3-ins-title', T.t('{what} · for all {n}', { what, n }));
  h.dataset.stripTitle = '1';
  host.appendChild(h);
}
// a section title in sentence case
function _each(host) { host.appendChild(_el('div', 'mv3-c-sep')); host.appendChild(_el('div', 'mv3-hlg-each', T.t('Each fragment'))); }
const _wordsSaid = (v) => (v > 0 ? T.t('up to {n}', { n: v }) : T.t('auto (up to {n})', { n: autoWordsPerLine('9:16') }));
// Where a page stands, as the Where slider says it: its anchor alone, or up / down from it.
function _whereSaid(v, pos) {
  if (Math.abs(v) < 0.005) return T.tc('pos', pos);
  const o = { pct: Math.abs(Math.round(v * 100)), pos: T.tc('from', pos) };
  return v > 0 ? T.t('down {pct}% from {pos}', o) : T.t('up {pct}% from {pos}', o);
}

/**
 * The Subtitles block - the top of the captions of several (highlights.js captionsAlt) and of the Subtitles lane's name pressed.
 * `target(host)` paints the tiles' part and returns their target.
 */
export function renderSubs(host, target) {
  const list = _A.ticked();
  const box = _el('div', 'mv3-hlg' + (_busy ? ' is-busy' : ''));
  box.dataset.hlGroup = 'subs';
  host.appendChild(box);
  _head(box, T.t('Subtitles'), list.length);
  const subs = list.map(_subsOf).filter(Boolean);
  const ref = (list.find((f) => f.n === _A.openN()) && _subsOf(list.find((f) => f.n === _A.openN()))) || subs[0] || {};
  const mixed = (k) => !_same(subs.map((s) => s[k]));
  // Where: up and down from its anchor, as the one lane's Nudge - and «example» dragged on the preview.
  const pos = POSITIONS.includes(ref.pos) ? ref.pos : 'bottom';
  box.appendChild(C.row(T.t('Where'), C.slider({
    min: -0.80, max: 0.80, step: 0.01, value: +ref.ty || 0, mixed: mixed('ty') || mixed('pos'),
    fmt: (v) => _whereSaid(v, pos),
    onChange: (v) => _subsPatch({ place: { pos, ty: v } }),
  })));
  // Size: one number for all, or the format's.
  const autoS = subs.length > 0 && subs.every((s) => s.sizeAuto);
  const size = C.slider({ min: 20, max: 200, step: 1, value: +ref.size || 60, mixed: mixed('size') || mixed('sizeAuto'),
    fmt: (v) => (autoS ? T.t('{n} (auto)', { n: v }) : String(v)), onChange: (v) => _subsPatch({ size: v }) });
  box.appendChild(C.row(T.t('Size'), C.pair(size, C.toggleNamed(T.t('Auto'), autoS, (on) => _subsPatch({ size: on ? 'auto' : (+ref.size || 60) }),
    T.t('Let the format choose the size')))));
  box.appendChild(C.row(T.t('Words'), C.slider({ min: 0, max: 12, step: 1, value: +ref.wordsPerLine || 0, mixed: mixed('wordsPerLine'),
    fmt: _wordsSaid, onChange: (v) => _subsPatch({ wordsPerLine: v }) })));
  const lines = Math.max(1, Math.min(3, Math.round(+ref.lines || 2)));
  const LINES = [['1', T.t('One')], ['2', T.t('Two')]].concat(subs.some((s) => +s.lines === 3) ? [['3', T.t('Three')]] : []);
  const ls = C.select(LINES, String(lines), (v) => _subsPatch({ lines: +v }));
  if (mixed('lines')) ls.title = T.t('Not the same on all of them now - a choice gives them one');
  box.appendChild(C.row(T.tc('page', 'Lines'), ls));
  // Two rows for all of them - each page whole while it is spoken, every other one in a second row.
  const rows = C.select([['1', T.tc('rows', 'One')], ['2', T.tc('rows', 'Two')]], String(ref.rows === 2 ? 2 : 1), (v) => _subsPatch({ rows: +v }));
  if (mixed('rows')) rows.title = T.t('Not the same on all of them now - a choice gives them one');
  box.appendChild(C.row(T.t('Rows'), rows));
  // The title on top.
  const titled = list.filter(_titled).length;
  const tOn = C.button(T.tc('title', 'On'), () => _titleAll(true), { title: T.t('Its headline at the top for the first three seconds - on every ticked fragment') });
  const tOff = C.button(T.tc('title', 'Off'), () => _titleAll(false), { title: T.t('The title on top taken off every ticked fragment') });
  tOn.classList.toggle('is-on', titled === list.length);
  tOff.classList.toggle('is-on', titled === 0);
  box.appendChild(C.row(T.t('Title on top'), C.pair(tOn, C.pair(tOff, titled && titled < list.length ? _el('span', 'mv3-c-num', T.t('{k} of {n}', { k: titled, n: list.length })) : null))));
  box.appendChild(_el('p', 'mv3-ins-note', _busy === 'subs' ? T.t('Putting it on them…')
    : T.t('Drag «example» on the preview up or down - let go, and all of them are there. A place set here stays when a preset is pressed; the size, the words and the lines are the preset\'s. Lines with a place of their own stay where they are.')));
  // The tiles' tabs, as the captions of several have them (highlights.js).
  const out = target(box);
  // Each fragment.
  _each(box);
  const ul = _el('ul', 'mv3-hlg-list');
  for (const f of list) {
    const s = _subsOf(f) || {};
    const c = f.n === _A.openN() ? _A.capOpen() : f.cap;
    const li = _el('li', 'mv3-hlg-item');
    li.appendChild(_el('span', 'mv3-hlg-name', f.title));
    // A preset's name (the server says the others' in English) shown in the app's language.
    const style = c && c.name ? (c.edited ? T.t('{name} (edited)', { name: T.t(c.name) }) : T.t(c.name)) : T.t('a style of its own');
    li.appendChild(_el('span', 'mv3-hlg-what', style
      + (s.own ? ' · ' + T.tn(s.own, '{n} line in its own place', '{n} lines in their own place') : '')));
    li.title = T.t('Open «{name}» with its own Subtitles - all of its settings', { name: f.title });
    li.addEventListener('click', () => _openOwn(f, 'subs'));
    ul.appendChild(li);
  }
  box.appendChild(ul);
  _checkSample();
  return out;
}

// MAIN VIDEO for all the ticked: its colour, its frame, its punch-ins and its patterns - the open
// one's list shown, a change puts the whole list on all.
function renderVideo(host) {
  const list = _A.ticked();
  const box = _el('div', 'mv3-hlg' + (_busy ? ' is-busy' : ''));
  box.dataset.hlGroup = 'video';
  host.appendChild(box);
  _head(box, T.t('Main video'), list.length);
  const vids = list.map(_videoOf);
  // Colour - each slider one value for all of them, "mixed" while they differ; the other sliders stay each clip's.
  for (const k of COLOR_KEYS) {
    const [min, max, mid, step] = COLOR_RANGE[k];
    const vals = vids.flatMap((v) => v.colors.map((c) => c[k]));
    const mixed = vals.some((x) => Math.abs(x - vals[0]) > 1e-6);
    box.appendChild(C.row(COLOR_LABEL[k], C.slider({
      min, max, step, value: vals.length ? vals[0] : mid, fmt: (x) => (+x).toFixed(2), mixed,
      onChange: (x) => _videoAll({ color: { key: k, value: x } }),
    })));
  }
  box.appendChild(_el('div', 'mv3-c-sep'));
  // The frame - "By the kind" while it is the app's, back to it from any other.
  const states = vids.map(_frameState);
  const now = states.every((s) => s === states[0]) ? states[0] : 'mixed';
  const opts = [['kind', T.t('By the kind')], ...FRAMINGS];
  if (now === 'mixed') opts.unshift(['mixed', T.t('Mixed')]);
  const sel = C.select(opts, now, (v) => { if (v !== 'mixed' && v !== now) _framingAll(v); });
  sel.disabled = !!_busy;
  sel.title = T.t('Every clip of main video of every ticked fragment. By the kind - the frame the app gave it (the speaker, the most active, a lecture\u2019s shots)');
  box.appendChild(C.row(T.t('Framing'), sel));
  const zooms = vids.reduce((s, v) => s + v.zooms, 0);
  if (zooms) {
    const off = vids.reduce((s, v) => s + v.zoomOff, 0);
    const sw = C.toggle(off === 0, (on) => _videoAll({ zoom: on }));
    sw.title = off && off < zooms ? T.t('Mixed - on for some of them') : T.t('The punch-ins on the key lines');
    box.appendChild(C.row(T.t('Punch-ins'), sw));
  }
  box.appendChild(_el('p', 'mv3-ins-note', _busy === 'video' ? T.t('Putting it on them…')
    : T.t('Into every clip of main video of every ticked fragment. Following a face uses the faces counted when they were cut.')));
  box.appendChild(_el('div', 'mv3-c-sep'));
  renderPatterns(box, {
    list: () => patternsOf(), write: (next) => { _patternsAll(next); }, repaint: () => Views.altChanged(),
    note: _busy === 'pattern' ? T.t('Putting them on them…') : T.t('Over the whole of main video, under the words. A change puts this list - every pattern and its settings - on every ticked fragment.'),
  });
  // Its effects - a tile on all of them.
  box.appendChild(_el('div', 'mv3-c-sep'));
  box.appendChild(_el('div', 'mv3-hlg-each', T.t('Effects')));
  const counts = new Map();
  for (const f of list) for (const k of _fxKindsOf(f)) counts.set(k, (counts.get(k) || 0) + 1);
  fxGroupRows(box, {
    n: list.length, kinds: [...counts], off: (k) => _fxOff(k), wait: _fxWait,
    press: (k) => _fxAll(k),
    note: _busy === 'fx' ? (_fxWait ? '' : T.t('Putting it on them…'))
      : T.t('A tile puts the effect on every ticked fragment: a moment at its start, one that goes on over the whole fragment. Its settings are each fragment\u2019s own - open one to change them.'),
  });
  _each(box);
  const ul = _el('ul', 'mv3-hlg-list');
  list.forEach((f, i) => {
    const mine = f.n === _A.openN() ? patternsOf() : ((f.lanes && f.lanes.patterns) || []);
    const li = _el('li', 'mv3-hlg-item');
    li.appendChild(_el('span', 'mv3-hlg-name', f.title));
    const fxs = _fxKindsOf(f).map((k) => (EFFECTS[k] || {}).name).filter(Boolean);
    li.appendChild(_el('span', 'mv3-hlg-what', _frameWord(states[i]).toLowerCase()
      + ' · ' + (mine.length ? mine.map((p) => patternName(p.src)).join(', ') : T.t('no pattern'))
      + (fxs.length ? ' · ' + fxs.join(', ') : '')));
    li.title = T.t('Open «{name}» with its own main video', { name: f.title });
    li.addEventListener('click', () => _openOwn(f, 'main'));
    ul.appendChild(li);
  });
  box.appendChild(ul);
}

function renderSpeech(host) {
  const list = _A.ticked();
  const box = _el('div', 'mv3-hlg' + (_busy ? ' is-busy' : ''));
  box.dataset.hlGroup = 'speech';
  host.appendChild(box);
  _head(box, T.t('Main audio'), list.length);
  const vol = (f) => (f.n === _A.openN() ? ((_openA1() || {}).volume != null ? +_openA1().volume : 1) : ((f.lanes && f.lanes.speech && f.lanes.speech.volume) != null ? +f.lanes.speech.volume : 1));
  const vols = list.map(vol);
  box.appendChild(C.row(T.t('Volume'), _mixedVolume(vols, (v) => _volume('speech', v))));
  // One pitch of the speech for all of them - "Mixed" while it differs; the music stays as it is.
  const pitches = list.flatMap((f) => (f.n === _A.openN()
    ? (((_openA1() || {}).clips) || []).filter((c) => c && c.src).map((c) => pitchOf(c))
    : ((f.lanes && f.lanes.speech && f.lanes.speech.pitches) || [])));
  pitchRows(box, pitches, _pitchAll);
  box.appendChild(_el('p', 'mv3-ins-note', _busy === 'speech' ? T.t('Putting it on them…') : T.t('The speech of every ticked fragment - its music stays as it is.')));
  _each(box);
  for (const f of list) box.appendChild(C.row(f.title, C.volume(vol(f), (v) => _volume('speech', v, f))));
}

function renderMusic(host) {
  const list = _A.ticked();
  const box = _el('div', 'mv3-hlg' + (_busy ? ' is-busy' : ''));
  box.dataset.hlGroup = 'music';
  host.appendChild(box);
  _head(box, T.t('Music'), list.length);
  const lane = (f) => (f.n === _A.openN() ? openMusicLane() : null);
  const vol = (f) => {
    if (f.n === _A.openN()) { const l = lane(f); return l && l.volume != null ? +l.volume : 1; }
    return f.lanes && f.lanes.music && f.lanes.music.volume != null ? +f.lanes.music.volume : 1;
  };
  box.appendChild(C.row(T.t('Volume'), _mixedVolume(list.map(vol), (v) => _volume('music', v))));
  // Deal again: the moods as chips, then the press.
  if (!_moods && _moodsAsk === 'failed') {
    box.appendChild(failedEl(T.t('Music → highlights'), () => { _moodsAsk = ''; _readMoods(); Views.altChanged(); }, { line: true }));
  } else if (!_moods) { _readMoods(); box.appendChild(loadingEl(T.t('reading Music → highlights…'), { line: true })); }
  else {
    const chips = _el('div', 'mv3-hlp-chips mv3-hlg-moods');
    for (const m of _moods) {
      const b = _el('button', 'mv3-hlp-chip u-chip' + (_dealMoods.includes(m.id) ? ' is-on' : ''), moodName(m.id, m.label));
      b.type = 'button';
      b.appendChild(_el('span', 'mv3-cap-n', ' ' + m.n));
      b.disabled = !m.n;
      b.addEventListener('click', () => {
        _dealMoods = _dealMoods.includes(m.id) ? _dealMoods.filter((x) => x !== m.id) : _dealMoods.concat([m.id]);
        Views.altChanged();
      });
      chips.appendChild(b);
    }
    box.appendChild(_el('div', 'mv3-hlg-sub', T.t('Moods')));
    box.appendChild(chips);
    const deal = C.button(_busy === 'music' ? T.t('dealing…') : T.t('deal again'), () => _musicAll(false),
      { title: T.t('Each ticked fragment a new track of these moods - none twice while there are tracks') });
    deal.disabled = !!_busy || !_dealMoods.length;
    const none = C.button(T.t('no music'), () => _musicAll(true), { title: T.t('The music taken off every ticked fragment - what you put there yourself stays') });
    none.disabled = !!_busy;
    box.appendChild(C.row('', C.pair(deal, none)));
  }
  _each(box);
  for (const f of list) box.appendChild(C.row(f.title, _trackChoice(f)));
}

// ONE fragment's music, on top of its music lane's strip or of the app's clip on it: its track, and the choice of
// another of the standard ones - of its mood, of a mood, or none (the same as its row among the ticked).
const _openFrag = () => {
  const rec = _A && _A.rec();
  const n = _A ? _A.openN() : 0;
  return n > 0 ? ((rec && rec.fragments) || []).find((x) => x.n === n && x.state === 'ready' && !x.deletedAt && x.key) || null : null;
};
// A track's mood as the record names it (its id), in the app's language.
const _moodShown = (id) => moodName(id, id);
function _trackChoice(f) {
  const m = f.music;
  const opts = [['', m ? m.title + (m.mood ? ' · ' + _moodShown(m.mood) : '') : T.t('no music')]];
  if (m) opts.push(['another', m.mood === 'yours' ? T.t('another track of yours') : m.mood ? T.t('another track of {mood}', { mood: _moodShown(m.mood) }) : T.t('another track of its tracks')]);
  for (const x of (_moods || [])) if (x.n) opts.push(['mood:' + x.id, x.id === 'yours' ? T.t('a track of yours') : T.t('a track of {mood}', { mood: moodName(x.id, x.label) })]);
  if (m) opts.push(['none', T.t('no music')]);
  const sel = C.select(opts, '', (v) => {
    sel.value = '';
    if (!v) return;
    _musicOne(f, v === 'another' ? 'another' : v === 'none' ? 'none' : v.slice(5));
  });
  sel.disabled = !!_busy;
  sel.classList.add('mv3-hlg-track');
  return sel;
}
function renderOneMusic(host) {
  const f = _openFrag();
  if (!f) return;
  if (!_moods) _readMoods();
  const box = _el('div', 'mv3-hlg' + (_busy ? ' is-busy' : ''));
  box.appendChild(_el('div', 'mv3-ins-title', T.t('Music of this fragment')));
  box.appendChild(C.row(T.t('Track'), _trackChoice(f)));
  box.appendChild(_el('p', 'mv3-ins-note', _busy === 'music' ? T.t('Laying the track…')
    : T.t('Another of the standard tracks of Music → highlights - it goes in place of this one, at -12 dB. What you put on this lane yourself stays.')));
  box.appendChild(_el('div', 'mv3-c-sep'));
  host.appendChild(box);
}

// A volume control for several: "mixed" until moved.
function _mixedVolume(vols, onChange) {
  const db = (v) => (v > 0 ? Math.max(C.DB_MIN, 20 * Math.log10(v)) : C.DB_MIN);
  return C.slider({ min: C.DB_MIN, max: C.DB_MAX, step: 0.5, value: Math.round(db(vols[0] == null ? 1 : vols[0]) * 2) / 2,
    mixed: !_same(vols.map((v) => Math.round(db(v) * 2) / 2)), fmt: C.dbLabel, onChange: (d) => onChange(C.fromDb(d)) });
}

// ── A lane's name pressed ───────────────────────────────────────────────────
// A fragment opened from its row with its own lane picked - its timeline shown, lanes and all, the one lane's
// strip - until "‹ all N" in the timeline's head (or another fragment opened, or the group gone).
async function _openOwn(f, lane) {
  if (!f.key) return;
  if (Store.key() !== f.key) { try { await Store.open(f.key); } catch (e) { _A.say(e.message, true); return; } }
  _own = f.key;
  // 'main' - its main video lane, whatever its id.
  selectTrackById(lane === 'main' ? ((mainVideo() || {}).id || 'v1') : lane);
  _sync();
}

// Nothing ticked is open: the first ticked opens, and the same lane is picked there (the music's - its lane, made when missing).
async function _openFirst(laneKind) {
  const f = _A.ticked()[0];
  if (!f || !f.key) return;
  try { await Store.open(f.key); } catch (e) { _A.say(e.message, true); return; }
  if (laneKind === 'music') { pickMusic(); return; }
  if (laneKind === 'video') { selectTrackById((mainVideo() || {}).id || 'v1'); return; }
  selectTrackById(laneKind === 'subs' ? 'subs' : 'a1');
}

/** "+ music": the open fragment's music lane picked - "audio 2" made when it has none. */
export function pickMusic() {
  if (!isGroup()) return;
  const openIn = _A.ticked().some((f) => f.n === _A.openN()) || _A.openN() > 0;
  if (!openIn) { _openFirst('music'); return; }
  let lane = openMusicLane();
  if (!lane) {
    let id = '';
    Store.mutate((tl) => { const l = newBedLane(tl.tracks); id = l ? l.id : ''; });
    if (!id) { _A.say(T.t('four audio lanes is the limit'), true); return; }
    lane = { id };
  }
  selectTrackById(lane.id);
}
/** A button over the timeline: that lane's common settings (the first ticked opened when none is). */
export function pickLane(kind) {
  if (!isGroup()) return;
  if (kind === 'music') { pickMusic(); return; }
  if (_A.openN() <= 0) { _openFirst(kind); return; }
  if (kind === 'video') { selectTrackById((mainVideo() || {}).id || 'v1'); return; }
  selectTrackById(kind === 'subs' ? 'subs' : 'a1');
}

const _kindOf = (track) => {
  if (!track) return '';
  if (track.kind === 'subs') return 'subs';
  if (track.id === 'a1') return 'speech';
  // The main video lane - its colour, frame, punch-ins and patterns.
  if (track.kind === 'video') { const m = mainVideo(); return m && m.id === track.id ? 'video' : ''; }
  if (track.kind === 'audio') { const m = openMusicLane(); return m && m.id === track.id ? 'music' : ''; }
  return '';
};

// ── «example» on the preview ────────────────────────────────────────
// A whole page: as many «example» in a line as the lane's words, in as many lines - the open fragment's look, standing still.
function _sampleTl(over) {
  const tl = _tl();
  const lane = _openSubs();
  if (!tl || !lane) return null;
  const st = Object.assign({}, lane.style || {}, over || {});
  for (const k of ['mix', 'anims', 'mixSeed', 'fonts']) delete st[k];
  Object.assign(st, { enter: 'none', leave: 'none', appear: 'none' });
  const fmt = tl.format || '9:16';
  const style = normalizeStyle(st);
  const per = +style.wordsPerLine > 0 ? +style.wordsPerLine : autoWordsPerLine(fmt);
  const n = per * Math.max(1, Math.min(3, Math.round(+style.lines || 2)));
  // Cut by the very rule a page is cut by (pages.js): as many as fit in its lines at its size - the page a real one can be.
  // Only the preview draws it - the word is the app's language.
  const word = T.t('example');
  const said = Array.from({ length: n }, (_, i) => ({ text: word, start: i * 0.3, end: i * 0.3 + 0.25 }));
  const first = (paginate(said, { lane: style, format: fmt })[0] || {}).words || [];
  const words = (first.length ? first : said.slice(0, 1).map(() => ({ w: word }))).map((w) => ({ w: w.w || word, s: 0, e: 0 }));
  const clips = [{ id: 'hlg-sample', start: 0, dur: 36000, name: words.map((w) => w.w).join(' '), words, src: null }];
  // In two rows: a second page of the sample, where the second row stands - the two move together.
  if (rowsOn(style)) clips.push({ ...clips[0], id: 'hlg-sample2' });
  return { format: fmt, tracks: [{ id: 'subs', kind: 'subs', name: 'Subtitles', style, clips }] };
}
function _checkSampleNow() {
  const want = _shownBlock() === 'subs' && !!_openSubs();
  if (want) {
    _sample = true;
    CapPlace.setSample({ tl: _sampleTl(), onDrop: (place) => _subsPatch({ place }) });
  } else if (_sample) {
    _sample = false;
    CapPlace.setSample(null);
  }
}
const _checkSample = () => _sync();

// ── The buttons in place of the timeline ───────────────────────────────
// While a group is ticked the timeline's panel - its head with the transport and its lanes - is covered by the buttons
// of the common settings: ONE ROW under its top edge - Subtitles, Main video, Main audio, Music ("+ music" while the open
// fragment has none); the one whose block is in the strip is lit. Under them the open fragment stays open - the preview shows its
// frame and «example» (a group with none open opens the first ticked, quietly). A fragment's row in the strip shows ITS
// timeline, lanes and all, with "‹ all N" in the timeline's head back to the buttons; fewer than two ticked - the ordinary
// timeline. No bubbles, no gold names.
let _panel = null;             // the buttons over the timeline
let _back = null;              // "‹ all N" in the timeline's head while a fragment is shown on its own
let _opening = false;          // the first ticked being opened under the buttons
const _ownNow = () => !!(_own && _own === Store.key());

function _shownBlock() {
  const over = document.getElementById('mv3-over');
  const b = over && over.classList.contains('is-open') && over.querySelector('[data-hl-group]');
  return b ? b.dataset.hlGroup : '';
}
function _panelPaint(tl) {
  if (!_panel || !tl.contains(_panel)) {
    _panel = _el('div', 'mv3-hlg-panel');
    tl.appendChild(_panel);
  }
  const n = _A.ticked().length;
  const on = _shownBlock();
  const music = openMusicLane();
  const sig = [n, on, !!music, _busy].join('|');
  if (_panel.dataset.sig === sig) return;
  _panel.dataset.sig = sig;
  _panel.textContent = '';
  // ONE FORM: the four as wide as the widest, their words from the left, "+" of music Lucide's plus, N in mono
  for (const [k, label, plus] of [['subs', T.t('Subtitles')], ['video', T.t('Main video')], ['speech', T.t('Main audio')], ['music', T.t('Music'), !music]]) {
    const b = _el('button', 'mv3-hlg-pbtn u-btn is-s' + (on === k ? ' is-on' : ''));
    if (plus) b.appendChild(iconEl('plus', 14));
    b.appendChild(_el('span')).appendChild(figures(T.t('{what} · for all {n}', { what: label, n })));
    b.type = 'button';
    b.disabled = !!_busy;
    b.addEventListener('click', () => pickLane(k));
    _panel.appendChild(b);
  }
}
function _backPaint() {
  const head = document.querySelector('#mv3-timeline > .mv3-panel-head');
  const want = isGroup() && _ownNow() && !!head;
  if (!want) { if (_back) { _back.remove(); _back = null; } return; }
  if (!_back || !head.contains(_back)) {
    _back = _el('button', 'u-btn is-s is-quiet mv3-hlg-back');
    _back.type = 'button';
    _back.title = T.t('Back to the buttons of the ticked fragments');
    _back.addEventListener('click', () => { _own = ''; pickLane('subs'); _sync(); });
    const title = head.querySelector('.mv3-panel-title');
    if (title && title.nextSibling) head.insertBefore(_back, title.nextSibling); else head.appendChild(_back);
  }
  // Lucide's chevron in place of "‹", N in mono; 24 px in the head's 35, which does not grow
  _back.replaceChildren(iconEl('chevron-left', 14), _el('span'));
  _back.lastChild.appendChild(figures(T.t('all {n}', { n: _A.ticked().length })));
}
let _panelWas = false;
function _panelSync() {
  const tl = document.getElementById('mv3-timeline');
  const want = !!tl && isGroup() && !_ownNow();
  if (tl) tl.classList.toggle('is-hlg', want);
  if (!want) { if (_panel) { _panel.remove(); _panel = null; } }
  else _panelPaint(tl);
  // The buttons come: the panel as tall as they are; they go: as its lanes.
  if (want !== _panelWas) { _panelWas = want; fitTimeline(); }
  if (want) {
    // A group with no fragment open: the first ticked opens under the buttons - its frame on the preview.
    if (_A.openN() <= 0 && !_opening) {
      const f = _A.ticked()[0];
      if (f && f.key) { _opening = true; Store.open(f.key).catch((e) => _A.say(e.message, true)).finally(() => { _opening = false; }); }
    }
  }
  _backPaint();
}

// What shows follows the ticks, the pick, the store and the strip - once the strip has been drawn (a timer, not a frame: a
// window that paints nothing still follows).
let _syncT = 0;
function _sync() {
  if (_syncT) clearTimeout(_syncT);
  _syncT = setTimeout(() => { _syncT = 0; _panelSync(); _checkSampleNow(); }, 0);
}

// ── Wiring ──────────────────────────────────────────────────────────────────
/** highlights.js lends what it knows of the project; the lanes' names are taken over while a group is ticked. */
export function initGroup(api) {
  _A = api;
  Views.laneAlt({
    // A lane's name - a button of the panel - while a group is ticked; not on a fragment shown on its own from its row.
    wants: (track) => {
      if (!isGroup() || _ownNow()) return false;
      return !!_kindOf(track);
    },
    render: (host, track) => {
      const k = _kindOf(track);
      // The project's own timeline: the first ticked opens, the lane picked there.
      if (_A.openN() <= 0) { host.appendChild(_el('p', 'mv3-ins-note', T.t('Opening the first ticked fragment…'))); _openFirst(k); return null; }
      let out = null;
      if (k === 'subs') out = renderSubs(host, (box) => _A.tiles(box));
      else if (k === 'speech') renderSpeech(host);
      else if (k === 'video') renderVideo(host);
      else renderMusic(host);
      _sync();
      return out;
    },
  });
  // One fragment's music lane - not while the group's buttons stand for the lanes.
  Views.laneExtra({
    wants: (track, clip) => {
      if (!_A.pid() || (isGroup() && !_ownNow()) || !_openFrag()) return false;
      const m = openMusicLane();
      return !!(m && track && track.id === m.id && (!clip || _isBed(clip)));
    },
    render: (host) => renderOneMusic(host),
  });
  onSelChange(() => _sync());
  Store.onChange(() => { if (_own && Store.key() !== _own) _own = ''; _sync(); });
  Views.onAltShown(() => _sync());
}

/** The group's state changed (ticks, a read of the record): what shows follows. */
export function changed() {
  if (_own && !isGroup()) _own = '';
  _sync();
}
