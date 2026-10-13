/* ════════════════════════════════════════════════════════════════════════════
   MERGE — the script of a talking head, line by line: the READ, the FRAME and the CLIP of
   every line (docs/local-app/PLAN.md, "Fragments — полный план по фазам", and phase M of
   "Сцена, setup и таймлайн-зеркало").

   The hub of the setup step (js/merge-v3/wk-setup.js), painted into its panel. Two columns: on
   the left the whole script, one row per line with what it has - the read, the frame, the clip;
   on the right the line that is open, with everything made for it - or, with none open, the
   GENERAL ZONE: the one mood, and the three zones of the whole video in gold, voice, first
   frames, video, each a drawer with its own `generate` (phase W; open and shut, by hand or by
   itself when its work is done or cannot start - W2.5). Over the right column, whatever it shows,
   the counters - read, frames, clips - and `generate all` (_counters). The list never goes away
   while a line is open: the script is one thing, and judging a line means seeing the ones around
   it. Who and where are on the stage, not here.

   THE READ (V3, moved in here in M; v3 only since W1). A line is spoken from the open line's own
   button - tagged by the mood first - and its words can be changed there too, tags and all; a take
   made of other words is stale until the line is read again or the words are put back. The
   speaking itself is js/merge-v3/wk-voice.js.

   THE FIRST FRAMES (W2) are a SET for the whole video, not a frame per line: one shot size the
   person picks - selfie, half body, full body - and N variations of it, planned by an agent from
   the look, the place, the mood and the person's own words, drawn side by side on kie
   (routes/scen3.js, frames/plan). Every frame is a row in Alerts from the moment it is asked for,
   and the SERVER files it into the project's pool - this panel only follows the rows, so leaving
   loses nothing. THE LINES TAKE FROM THE POOL IN TURN (_frameFor): the first line the first frame,
   the second the second, round again - until a line is given a frame by hand, which it keeps.

   THE ANIMATION of a line - the prompt the video model hears - is written by the video stage (W3)
   and edited here; a prompt written by hand survives the next pass. The clips (F4) are still to
   come.

   WHAT IS READ, NOT OWNED. The lines, their reads and any frames and clips already made are the
   scenario project's, as they have always been (routes/scen3.js). Written from here: the video's
   settings - the tier, the mood, the set - on `project.video`, merged on the server; a line's
   animation prompt and its frame, through their own routes, which touch nothing else of the line;
   and a line's words.
   ════════════════════════════════════════════════════════════════════════════ */

import * as Store from './store.js';
import * as API from './scen-api.js';
import { takeOf, isRead, isLive, liveLines } from './scen-api.js';
import * as VOICE from './wk-voice.js';
import { derived } from '../chars-store.js';
import * as Layers from '../layers.js';
import { askDelete, askChoice } from './ask.js';
import { el, holdProgress, endProgress, onlyHere, showPicture, softScroll } from './wk-maker.js';
import * as FCHAT from './fchat.js';

// What a frame costs: nano-banana-2 at 2K on kie (lib/mv3-img.js, the price table). Said beside the
// button so nothing is spent on a surprise.
const FRAME_PRICE = 0.06;
// The one ceiling a read has for Kling avatar, from the tier (lib/motion-presets.js) - read from
// the kit when it has arrived, this only until then.
const CEILING_FALLBACK = 30;

const KEY = 'mv3_frag_open_v1';          // { <timeline key>: <open line> } - where you were, per project
const TIP_MS = 320;                      // hover before a row's whole text appears
// HOW WIDE THE SCRIPT COLUMN IS (phase R, the owner 2026-09-22). The two columns of this step are
// rebuilt on every repaint, so the width cannot live in the DOM; it lives here and is put back
// after each paint, the way the columns' scroll offsets are. 0 means "never dragged" - the CSS
// default then stands. Kept like the shell's two sashes, in a plain key the server mirrors.
const SPLIT_KEY = 'mv3_wk_split';
const SPLIT_MIN = 190;                   // narrower than this a line of script is unreadable
const SPLIT_PART = 0.62;                 // ...and the fields keep at least the rest
let _splitW = (() => { try { return parseInt(localStorage.getItem(SPLIT_KEY) || '', 10) || 0; } catch (e) { return 0; } })();

let _ctx = null;
let _api = null;                          // what the step lends: the character cast, the voice, the shelves
// The open line, 0-based. -1 is NONE open - the right column then speaks for every fragment at
// once (owner, 2026-09-18). null is "not decided yet", before the project is known.
let _open = null;
let _editWords = -1;                      // the line whose words are open for editing, in the right column
let _wordsDraft = '';
// (phase V26.8) A LINE BEING PUT IN: the line it goes under (-1 - none), the words typed for it, and the press on its way.
let _inserting = -1;
let _insDraft = '';
let _insSaving = false;
let _key = '';                            // the project it belongs to
let _asked = _urlLine();                  // ?line=N (1-based) - how the Alerts list comes back here
let _kit = null;                          // tiers, moods, the mannequins and the shot sizes of a set, read once
let _kitState = 'idle';
let _saving = false;
let _said = '';
let _listAt = 0;                          // where the list stood, put back after every repaint
let _readErr = '';
const _drafts = {};                       // text being typed, by "<line>:<field>" - a repaint keeps it
// Frames of the set being drawn, by journal row: { startedAt, n } - asked from here or found in the journal.
const _drawing = new Map();
// What is known about the places on the shelf, by address (routes/scen3.js, /scen3/env-meta): the
// description, and - phase W3a - how the place MOVES. Read once and again after it is written; the
// animation belongs to the place, so it is the same map for every project.
let _envMeta = null;
let _envWriting = false;
let _planning = false;                    // the agent is writing the moments of a set
let _planAt = 0;                          // ...since when (N3: the field's bar before any frame exists)
let _armedSet = false;                    // the set's `generate` pressed once and asking
let _armedVideo = false;                  // ...and the video zone's, which pays for the clips
let _dragging = '';                       // the frame being dragged along the strip
let _picking = false;                     // the open fragment's frame list is down
let _pickView = '';                       // ...and the frame being looked at in it, on the stage
let _lookedAt = '';                       // the project the journal was last asked about
let _setPick = '';                        // a frame of the pool pressed in the general zone: shown on the stage
// (phase V26.5) The frames chat: a frame of it pressed - on the stage - and whether the script is folded away beside it.
let _chatPick = null;                     // { path, name }
const FOLD_KEY = 'mv3_fc_fold_v1';
let _fold = (() => { try { return localStorage.getItem(FOLD_KEY) === '1'; } catch (e) { return false; } })();
// WHICH OF THE TWO THE OPEN FRAGMENT IS SHOWING (phase X4, the owner 2026-09-22): its clip, playing,
// or its frame. The clip when there is one, because that is the thing that was just made; pressing
// the frame moves the stage to it, and pressing the clip brings it back. Forgotten when another
// fragment is opened - each is looked at on its own terms.
let _stagePick = '';                      // '' | 'clip' | 'frame'
let _stageFor = -2;                       // the fragment _stagePick belongs to
const FRAME_ESTIMATE_MS = 75000;          // what the countdown starts from; it learns from real runs

// ── HOW LONG THIS USUALLY TAKES (phase N, the owner 2026-09-23) ─────────────
// Two of the four fields cannot count their own progress - the tagging is ONE call to an agent,
// and a single line being spoken is one call to ElevenLabs - so their border fills by an estimate.
// An estimate that never learns is a lie the second time, so every finished run leaves its length
// here and the next one is drawn from the last few. In this browser only: it is an observation of
// how fast the world is today, not a setting, and nothing else should read it.
const PACE_KEY = 'mv3_pace_v1';
const PACE_KEEP = 5;
// Read when they are asked for, not at load: a clip's estimate is declared with the clips, far
// below this, and naming it here would be reaching into its dead zone.
const _paceFirst = (kind) => (kind === 'tag' ? 20000 : kind === 'read' ? 9000
  : kind === 'frame' ? FRAME_ESTIMATE_MS : kind === 'clip' ? CLIP_ESTIMATE_MS : 30000);
function _paceAll() {
  try { return JSON.parse(localStorage.getItem(PACE_KEY) || '{}') || {}; } catch (e) { return {}; }
}
/** What one of these usually takes, in ms. */
function _pace(kind) {
  const seen = (_paceAll()[kind] || []).filter(n => n > 0);
  if (!seen.length) return _paceFirst(kind);
  return Math.round(seen.reduce((a, n) => a + n, 0) / seen.length);
}
/** One finished run, measured. */
function _paceSaw(kind, ms) {
  if (!(ms > 500) || ms > 30 * 60000) return;         // nonsense, or a tab that was asleep
  try {
    const all = _paceAll();
    all[kind] = (all[kind] || []).concat(Math.round(ms)).slice(-PACE_KEEP);
    localStorage.setItem(PACE_KEY, JSON.stringify(all));
  } catch (e) { /* a private window */ }
}
// How far a thing that cannot be counted has got: never past 95%, because the last five per cent
// belong to the answer actually arriving.
const _byTime = (at, kind) => (!at ? 0 : Math.min(0.95, (Date.now() - at) / Math.max(1, _pace(kind))));

// ── The bar along the bottom of a field ────────────────────────────────────
// Every field that is working registers the box and a function that says how far along it is,
// 0 to 1. One timer moves them all, and it moves the NUMBER ONLY - a repaint of the panel for a
// progress bar would be a repaint four times a second.
const _bars = [];
let _barTimer = 0;
function _barsMove() {
  let any = false;
  for (const b of _bars) {
    if (!b.box.isConnected) continue;
    any = true;
    const pc = Math.max(0, Math.min(1, b.at() || 0));
    b.box.style.setProperty('--wk-pc', Math.round(pc * 100) + '%');
  }
  if (!any && _barTimer) { clearInterval(_barTimer); _barTimer = 0; }
}
function _barWatch(box, at) {
  _bars.push({ box, at });
  _barsMove();
  if (!_barTimer) _barTimer = setInterval(_barsMove, 250);
}

function _urlLine() {
  try {
    const n = parseInt(new URLSearchParams(location.search).get('line'), 10);
    return n >= 1 ? n - 1 : -1;
  } catch (e) { return -1; }
}

function _remember() {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) || '{}');
    all[_key] = _open < 0 ? 'all' : _open;
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch (e) { /* a private window */ }
}
// What was open when this project was last left: a line, 'all', or - never been here - the
// general zone (the owner, 2026-09-21): a new talking head starts with the settings of the whole
// video, not with its first line.
function _remembered() {
  try {
    const v = (JSON.parse(localStorage.getItem(KEY) || '{}') || {})[_key];
    if (v === 'all') return -1;
    return Number.isInteger(v) && v >= 0 ? v : -1;
  } catch (e) { return -1; }
}

// ── What a line has ─────────────────────────────────────────────────────────
// The same rules the server applies when it builds the cut (routes/scen3.js, _cutClips): a read or a
// clip made from words that have since been edited is not this line's any more. The read is the
// take the line is read BY - tagged when the line has tags (js/merge-v3/scen-api.js, takeOf).
// The lines that are IN the video: a line taken off keeps its place in the script but nothing
// counts it, reads it or films it (phase Z; the rule itself is in scen-api.js).
const _live = (lines) => (Array.isArray(lines) ? lines : []).filter(isLive);
const _words = (l) => String((l && l.text) || '');
const _take = (l) => takeOf(l).take;
function _readState(l) {
  const { take, said } = takeOf(l);
  if (!take || !take.path) return 'none';
  return take.said === said ? 'ok' : 'stale';
}
// THE POOL, in the order the frames were asked for: the sets as they came, and inside a set by
// number - not by the moment each landed, which is whichever kie finished first. The server lists
// newest first; the rule reads oldest first, so the first line gets the first frame of the first set.
function _order(list, hand) {
  const start = {};
  for (const v of list) {
    if (!v.set) continue;
    if (!start[v.set] || String(v.at || '') < start[v.set]) start[v.set] = String(v.at || '');
  }
  // The order the strip was dragged into wins (routes/scen3.js, /scen3/frames/order); a frame made
  // after the dragging has no place in it and keeps its natural one, behind them.
  const at = (v) => (hand || []).indexOf(String(v.id));
  const key = (v) => (v.set ? start[v.set] : String(v.at || ''));
  return list.slice().sort((a, b) => {
    const ia = at(a), ib = at(b);
    if (ia >= 0 || ib >= 0) return (ia < 0 ? 1e6 : ia) - (ib < 0 ? 1e6 : ib);
    return key(a).localeCompare(key(b)) || (a.n || 0) - (b.n || 0) || String(a.at || '').localeCompare(String(b.at || ''));
  });
}
const _handOrder = (p) => ((((p || {}).mix) || {}).order || []).map(String);
// A frame switched OFF (the ✕ on its thumbnail, the owner 2026-09-21) is out of the rotation: it is
// still in the project and still on the strip, but no line takes it. `mix.banned` holds them - the
// list that already meant "hidden in this project" (routes/scen3.js, _frameState).
const _off = (p) => new Set(((((p || {}).mix) || {}).banned || []).map(String));
function _pool(p) {
  const hidden = _off(p);
  return _order((((p && p.mix) || {}).variants || []).filter(v => !hidden.has(String(v.id))), _handOrder(p));
}
// Everything the strip shows: the pool in its order, then the switched-off ones at the tail, out of
// the way (the owner, 2026-09-21).
function _poolAll(p) {
  const hidden = _off(p);
  const all = ((p && p.mix) || {}).variants || [];
  return _pool(p).concat(_order(all.filter(v => hidden.has(String(v.id))), _handOrder(p)));
}
// The frame a line opens on: the one picked by hand when there is one, else by the rule the person
// chose for the whole video (decided with the owner 2026-09-21) - the pool IN TURN (line 1 frame A,
// line 2 frame B, round again) or one DRAWN for the line. The draw is made from the line's number
// and the project's id, never from chance: the same line must open on the same frame every time it
// is looked at, or the video would reshuffle itself between two glances. The server draws the same
// way (routes/scen3.js, _frameOfLine).
// FNV-1a with a final avalanche, the same function the server draws with (routes/scen3.js, _seed).
// A rolling hash is no good here: these strings differ by one character at the end, so every modulo
// of it comes out as a shifted cycle - which is not a draw at all.
function _seed(s) {
  let h = 2166136261 >>> 0;
  for (let k = 0; k < s.length; k++) { h ^= s.charCodeAt(k); h = Math.imul(h, 16777619) >>> 0; }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995) >>> 0; h ^= h >>> 15;
  return h >>> 0;
}
function _frameFor(p, l, i) {
  const pool = _pool(p);
  const picked = l && l.frameId ? pool.find(v => v.id === String(l.frameId)) : null;
  if (picked) return { v: picked, auto: false };
  if (!pool.length) return { v: null, auto: true };
  const spread = String(((p || {}).video || {}).spread || 'cycle');
  // (phase V26.8) A MERGED FRAGMENT opens on one frame, by ITS number in the set (the owner's answer (л) - by the lines'
  // numbers some frames would go to no fragment at all), or picked by hand on its first line, which is what `i` is.
  const g = _groupOf(p, i);
  if (g) {
    const k = g.n - 1;
    return { v: pool[spread === 'random' ? _seed(String((p || {}).id || '') + ':g' + k) % pool.length : k % pool.length], auto: true };
  }
  // (phase V26.8) By the number the line KEEPS when one was put in above it (routes/scen3.js, /line/insert), else by its
  // place in the list.
  const n = l && Number.isInteger(l.slot) ? l.slot : i;
  const at = spread === 'random' ? _seed(String((p || {}).id || '') + ':' + n) % pool.length : n % pool.length;
  return { v: pool[at], auto: true };
}
// (phase V26.8, part 3) THE MERGED FRAGMENTS of a Seedance project with `merge fragments` ticked, as the server works
// them out (routes/scen3.js _mergeView, lib/sd-merge.js) - null when the lines are lines. A fragment is opened, picked
// and addressed by its FIRST line.
const _merged = (p) => {
  const m = p && p.merge;
  return m && m.on && m.can && Array.isArray(m.groups) && m.groups.length ? m.groups : null;
};
const _groupOf = (p, i) => { const gs = _merged(p); return gs ? (gs.find(g => g.lines[0] === i) || null) : null; };
const _groupWith = (p, i) => { const gs = _merged(p); return gs ? (gs.find(g => g.lines.includes(i)) || null) : null; };
// THE CLIP OF A LINE is the one made from the frame the line OPENS ON - which is the frame it was
// given by the rule as often as one picked by hand (phase F4; before the clips existed this read
// `frameId`, which is empty for every line the pool serves in turn, and would have called every
// such line clip-less for ever).
// WHICH VARIANT THIS PROJECT IS IN. A project read with tags (every Merge project since W1) keeps
// its clips under `tagged` and remembers the words WITH the tags in them; a project read before
// that keeps them under `plain`. The server files by this rule and the timeline mirror lays by it,
// and this panel used to read `plain` and compare against the untagged words - so a clip that had
// been made, filed, journalled and laid on the timeline was invisible in the fragment that paid
// for it (the owner, 2026-09-22). One rule now, in all three places.
const _variant = (p) => (((p || {}).voice || {}).variant === 'tagged' ? 'tagged' : 'plain');
const _saidOf = (p, l) => (_variant(p) === 'tagged' ? String((l && l.tagged) || '') : String((l && l.text) || ''));
// (phase V26.8) A Seedance project shows none of the Kling clips it may have - the timeline lays none of them either
// (lib/frag-mirror.js); they come back when the model is Kling again.
const _clipsOf = (p, l) => (_seedance() ? [] : (((l && l.video) || {})[_variant(p)] || []));

// (phase V23, the owner 2026-10-09) A clip CHOSEN BY HAND in the takes is the line's clip whatever it was made
// from - the timeline lays it too (lib/frag-mirror.js) - and the line counts as settled: `generate all` leaves it.
// A new clip or a new read clears the choice (routes/scen3.js).
const _chosenOf = (p, l) => {
  const id = String(((l && l.chosen) || {})[_variant(p)] || '');
  return id ? (_clipsOf(p, l).find(c => c.id === id) || null) : null;
};
function _clipOf(p, l, i) {
  const clips = _clipsOf(p, l);
  if (!clips.length) return null;
  const hand = _chosenOf(p, l);
  if (hand) return hand;
  const fr = String((_frameFor(p, l, i).v || {}).id || '');
  if (!fr) return null;
  const picked = clips.find(c => c.id === String(((l.pick || {})[_variant(p)]) || ''));
  if (picked && picked.fromFrame === fr) return picked;
  const mine = clips.filter(c => c.fromFrame === fr);
  return mine.length ? mine[mine.length - 1] : null;
}
// Fresh: made from the frame the line opens on, of the words it says now, lipsynced to the read it has now (V23 -
// a read again is another performance; a clip from before the read was recorded counts as fresh).
function _clipFresh(p, l, i, c) {
  if (!c) return false;
  const fr = String((_frameFor(p, l, i).v || {}).id || '');
  const take = _take(l);
  return !!fr && c.fromFrame === fr && c.said === _saidOf(p, l) && (!c.fromAudio || !take || c.fromAudio === take.path);
}
function _clipState(p, l, i) {
  const c = _clipOf(p, l, i);
  if (!c) return 'none';
  return _clipFresh(p, l, i, c) ? 'ok' : 'stale';
}
// The line has its clip: a fresh one, or one the person chose by hand.
const _clipSettled = (p, l, i) => _clipState(p, l, i) === 'ok' || !!_chosenOf(p, l);

// ── One player for the panel ────────────────────────────────────────────────
let _audio = null;
let _playing = '';
function _play(src) {
  if (!src) return;
  if (!_audio) {
    _audio = new Audio();
    for (const ev of ['play', 'pause', 'ended']) _audio.addEventListener(ev, () => { if (ev === 'ended') _playing = ''; _mark(); });
  }
  if (_playing === src && !_audio.paused) { _audio.pause(); return; }
  _playing = src;
  _audio.src = src;
  _audio.play().catch(() => { _playing = ''; _mark(); });
}
// Only the reads' buttons: the voice row's demo has a player of its own (js/merge-v3/wk-voice.js).
function _mark() {
  const on = _audio && !_audio.paused ? _playing : '';
  document.querySelectorAll('.mv3-wk-vplay.is-read').forEach((b) => {
    const is = b.dataset.src && b.dataset.src === on;
    b.textContent = is ? '❚❚' : '▶';
    b.classList.toggle('is-playing', !!is);
  });
}
// `then` is what the row hands over: the read it plays belongs to a fragment, and pressing play is
// a way of saying "this one" (Y5). The press does NOT reach the row - it would close an open
// fragment - so the opening is done here instead.
function _playBtn(src, what, then) {
  const b = el('button', 'mv3-wk-vplay is-read', '▶');
  b.type = 'button';
  b.disabled = !src;
  b.dataset.src = src || '';
  b.title = src ? 'Play ' + what : 'Not read yet';
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    _play(src);
    if (then) then();
  });
  return b;
}

// ── The kit: tiers, moods, the mannequins and the shot sizes of a set ───────
function _loadKit(repaint) {
  if (_kitState !== 'idle') return;
  _kitState = 'loading';
  const get = (u) => fetch(u).then(r => r.json()).catch(() => null);
  Promise.all([get('/api/scen3/motion-presets'), get('/api/scen3/poses'), get('/api/scen3/frame-sets')]).then(([m, p, s]) => {
    _kit = {
      // (phase V26.8) The models of the clips, each with its qualities - Kling avatar and the Seedances - and
      // Seedance's ways of voicing a clip (lib/th-video.js). A server started before V26.8 answers Kling's qualities
      // alone: they are Kling's model, so the field still works until the app is restarted.
      models: (m && m.models) || (m && m.qualities ? [{ id: 'kling', label: 'kling avatar', family: 'kling', qualities: m.qualities }] : []),
      sounds: (m && m.sounds) || [],
      moods: (m && m.moods) || [],
      poses: (p && p.poses) || [],
      sets: (s && s.sets) || [],
      setMax: (s && s.max) || 5,
    };
    _kitState = 'done';
  }).finally(() => repaint());
}
const _poseById = (id) => ((_kit && _kit.poses) || []).find(x => x.id === id) || null;

// Take the project the server answered with INTO the record the workshop holds (js/merge-v3/
// workshop.js hands the same object to every paint), not over it.
function _adopt(r) {
  if (r && r.project && _ctx && _ctx.project) Object.assign(_ctx.project, r.project);
}
// A page NEWER than the running server is a real case here: the app serves these files from disk as
// they are now, but its routes are the ones it started with. Right after an update a button can call
// a route the running server does not have yet, and the answer is an HTML 404 page - which is said
// as what it is, not as a JSON parse error.
async function _post(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let r = null;
  try { r = await res.json(); } catch (e) { r = null; }
  if (!r) {
    throw new Error(res.status === 404 ? 'This is newer than the running app - close UGC Studio and open it again to finish the update.' : 'the server answered ' + res.status + ' ' + res.statusText);
  }
  if (!r.success) throw new Error(r.error || 'refused');
  return r;
}

// ── The set of first frames ─────────────────────────────────────────────────
// Where the set was asked from, for the Alerts list: the general zone of this project.
function _where() {
  const key = (_ctx && _ctx.key) || '';
  const p = (_ctx && _ctx.project) || {};
  return {
    page: 'merge',
    href: '/merge?p=' + encodeURIComponent(key) + '&step=setup',
    label: 'Merge · ' + String(p.title || p.name || 'talking head') + ' · setup › first frames',
    spot: { key, step: 'setup', view: 'frames' },
  };
}
const _format = () => { try { const t = Store.timeline(); return (t && t.format) || '9:16'; } catch (e) { return '9:16'; } };

// `generate` of the first frames field: the agent plans N moments of the chosen shot size, the
// server asks kie for every one, and this follows the rows. Pressed twice (owner): the first press
// says how many and how much.
async function _makeSet() {
  const p = _ctx && _ctx.project;
  if (!p || _planning) return;
  const v = _video();
  _readErr = '';
  _planning = true;
  _planAt = Date.now();
  _ctx.repaint();
  try {
    const r = await _post('/api/scen3/frames/plan', { projectId: p.id, set: v.framing, n: v.frames, wish: v.wish, format: _format(), where: _where() });
    for (const a of r.alerts || []) {
      _drawing.set(a.alertId, { startedAt: Date.now(), n: a.n });
      _follow(a.alertId);
    }
  } catch (e) {
    _readErr = 'The frames were not asked for: ' + e.message;
  }
  _planning = false;
  _ctx.repaint();
}

// The row is the truth: whatever happened to the page in between, it says done or failed.
async function _follow(alertId) {
  try {
    await API.follow(alertId);
    if (_ctx && _ctx.reloadProject) await _ctx.reloadProject();
  } catch (e) {
    if (!_dropped.has(alertId)) _readErr = 'A frame failed: ' + e.message;
  }
  _dropped.delete(alertId);
  const was = _drawing.get(alertId);
  if (was && was.startedAt) _paceSaw('frame', Date.now() - was.startedAt);   // the next estimate (N3)
  _drawing.delete(alertId);
  if (!_drawing.size) endProgress('frames', _readErr ? _readErr : undefined);
  if (_ctx) _ctx.repaint();
}

// Coming back to the step, or to the page: any frame of this project still drawing is found in the
// journal and followed again, with its real start time.
function _pickUpDrawing() {
  const key = (_ctx && _ctx.key) || '';
  if (!key || _lookedAt === key) return;
  _lookedAt = key;
  API.alerts().then((d) => {
    for (const r of (d && d.items) || []) {
      const spot = (r.where && r.where.spot) || {};
      if (r.state !== 'running' || r.what !== 'frame' || spot.key !== key || _drawing.has(r.id)) continue;
      _drawing.set(r.id, { startedAt: Date.parse(r.startedAt) || Date.now(), n: 0 });
      _follow(r.id);
    }
    if (_ctx) _ctx.repaint();
  }).catch(() => { /* without the list, nothing shows as drawing */ });
}

// Is the line's animation written, and written for the words it has now? The same shape as a read:
// a prompt made from other words is stale until it is written again (phase W3b).
const _animated = (l) => {
  const sh = (l && l.shot) || null;
  return !!(sh && sh.motion && String(sh.said || '') === String((l && l.text) || ''));
};

// ── How the place moves (phase W3a) ─────────────────────────────────────────
// One or two sentences about what is alive in the background - a curtain, steam, traffic far
// behind. It is the PLACE's, not the project's (the owner, 2026-09-21): every talking head filmed
// here animates the same way, so it is written beside the picture and read from there.
function _needEnvMeta() {
  if (_envMeta !== null) return;
  _envMeta = {};                                   // once, even if it fails: no retry storm
  API.envMeta().then((m) => { _envMeta = m || {}; if (_ctx) _ctx.repaint(); }).catch(() => { /* nothing known */ });
}
const _place = (p) => String(((p || {}).casting || {}).locationImage || '');
const _envMotion = (p) => String(((_envMeta || {})[_place(p)] || {}).motion || '');

// Written by hand, or by the agent when `motion` is not given. Either way the answer is the entry
// the store now holds, and the map is put right without reading the whole shelf again.
async function _saveEnvMotion(p, motion) {
  const path = _place(p);
  if (!path || _envWriting) return;
  _envWriting = true;
  _readErr = '';
  _ctx.repaint();
  try {
    const body = motion == null ? { path } : { path, motion };
    const r = await _post('/api/scen3/env/motion', body);
    _envMeta = { ...(_envMeta || {}), [path]: r.entry || {} };
  } catch (e) {
    _readErr = 'The animation of the place was not written: ' + e.message;
  }
  _envWriting = false;
  _ctx.repaint();
}

// The video zone's `generate`: the place, if it has nothing written yet (W3a), the animation of
// every line that needs one (W3b), and then the CLIPS of the lines that have none or whose clip is
// stale (F4). The first two are credits; the clips are dollars, which is why the zone asks a second
// press when there are any.
let _writing = '';                        // 'place' | 'lines' | 'clips' | ''
let _writeAt = 0;                         // ...since when (N3)
// How fast they leave is the SERVER's business now (phase X1): one a second, and it does not wait
// for any of them. The page only asks for the list and follows the rows.

// What a clip of a read this long costs (phase V10.2): kie bills Kling avatar by the WHOLE seconds, rounded down - a read
// of 7.97 s was billed 7 s (V10.1).
const _billSecs = (dur) => Math.max(1, Math.floor((+dur || 0) + 0.001));
const _clipCost = (dur, tier) => (tier ? _billSecs(dur) * tier.pricePerSec : 0);

// Can this line be clipped at all, and what would it cost? The same ladder the server refuses by
// (routes/scen3.js, _clipPlan), so the page never asks for what will be turned down.
function _clipReady(p, l, i) {
  const take = _take(l);
  const tier = _tier();
  if (!_video().quality) return null;       // the quality is the person's to choose (phase V24)
  if (_seedance()) return null;             // (phase V26.8) Seedance's clips are being built - the server refuses them too
  if (_readState(l) !== 'ok' || !take) return null;
  if (!_frameFor(p, l, i).v) return null;
  if (take.dur > _ceiling()) return null;
  return { dur: take.dur, cost: _clipCost(take.dur, tier) };
}
function _clipWork(p, lines) {
  const out = [];
  lines.forEach((l, i) => {
    if (!isLive(l)) return;                 // taken off the script (Z): not filmed
    if (_clipping.has(i)) return;
    if (_clipSettled(p, l, i)) return;
    const can = _clipReady(p, l, i);
    if (can) out.push({ i, cost: can.cost });
  });
  return out;
}

// EVERY FRAGMENT AT ONCE, ASKED FOR BY THE SERVER (phase X1, the owner 2026-09-22). This used to
// send five and then WAIT for all five to land before sending five more, which put the run inside
// the page: leaving it left the rest of the script unmade, and that is exactly what happened to the
// owner's ten-line project. Now one call hands the whole list over (routes/scen3.js,
// /scen3/fragments/clips), every fragment gets its journal row from the press, and the server sends
// them a second apart without waiting for any. The panel adopts the rows and shows each fragment
// waiting, the same way it does after a reload.
async function _makeClips(p, only) {
  try {
    const r = await _post('/api/scen3/fragments/clips', { projectId: p.id, key: (_ctx && _ctx.key) || '',
      ...(only ? { only: [...only] } : {}) });
    _lookedClips = '';                    // adopt the rows this call just made
    _pickUpClips();
    const queued = (r.queued || []).length;
    // Nothing went: say the first real reason rather than leaving a button that did nothing.
    const why = (r.skipped || []).find(x => !/already/.test(String(x.why || '')));
    if (!queued && why) _readErr = 'Fragment ' + why.line + ': ' + why.why;
  } catch (e) {
    _readErr = 'The clips were not asked for: ' + e.message;
  }
}

async function _writeVideo(p, opts) {
  if (_writing || _envWriting) return;
  // (phase V26.8) The animation prompts and the clips here are Kling's; a Seedance project's come with their part of
  // the phase, and until then nothing is written or asked for it.
  if (_seedance()) return;
  const withClips = !!(opts && opts.clips);
  // (phase V23) `generate all` names the lines its question priced; the zone's own button asks for every one.
  const only = (opts && opts.only) || null;
  _readErr = '';
  if (!_envMotion(p)) {
    _writing = 'place';
    _writeAt = Date.now();
    await _saveEnvMotion(p, null);
    if (_readErr) { _writing = ''; return _ctx.repaint(); }
  }
  const lines = Array.isArray(p.lines) ? p.lines : [];
  if (_live(lines).some(l => !_animated(l) && !((l.shot || {}).motionEdited && (l.shot || {}).motion))) {
    _writing = 'lines';
    if (!_writeAt) _writeAt = Date.now();
    _ctx.repaint();
    try {
      const r = await _post('/api/scen3/video/prompts', { projectId: p.id });
      _adopt(r);
      const skipped = ((r.report || {}).skipped || []).length;
      if (skipped) _readErr = 'The agent left ' + skipped + (skipped === 1 ? ' line' : ' lines') + ' without a prompt - press generate again.';
    } catch (e) {
      _readErr = 'The animation was not written: ' + e.message;
    }
  }
  if (withClips && !_readErr) {
    const now = _ctx.project || p;
    const want = _clipWork(now, Array.isArray(now.lines) ? now.lines : lines).filter(x => !only || only.has(x.i));
    if (want.length) {
      _writing = 'clips';
      _ctx.repaint();
      await _makeClips(now, only);
    }
  }
  _writing = '';
  _writeAt = 0;
  _ctx.repaint();
}

// The prompt a frame was drawn from, edited by hand: the picture does not change - it is drawn -
// but a redraw of this frame will be asked for what is written here.
async function _saveFramePrompt(p, frameId, prompt) {
  try { _adopt(await _post('/api/scen3/frames/prompt', { projectId: p.id, frameId, prompt })); }
  catch (e) { _readErr = 'The prompt was not saved: ' + e.message; }
  _ctx.repaint();
}

// ── LETTING GO OF SOMETHING THAT IS TAKING TOO LONG (phase N1) ──────────────
// The cross on a thing being made. It does NOT get the money back - the task was paid for when it
// was asked for and kie has no cancel - and the button says so: what it stops is the WAITING. The
// row fails with a word of its own, the server stops asking about it, and a picture that arrives
// afterwards is not filed.
let _dropping = '';
// The rows this panel let go of. The follower is still waiting on them and will see them fail;
// what it must not do is report that failure as news (N1).
const _dropped = new Set();
async function _dropRow(alertId, what) {
  if (!alertId || _dropping) return;
  _dropping = alertId;
  _readErr = '';
  if (_ctx) _ctx.repaint();
  try {
    _dropped.add(alertId);
    await _post('/api/alerts/' + encodeURIComponent(alertId) + '/cancel', {});
  } catch (e) {
    _dropped.delete(alertId);
    _readErr = 'Could not let go of ' + what + ': ' + e.message;
  }
  _dropping = '';
  // The follower is still waiting on this row; it sees the failure on its next look and tidies up.
  if (_ctx) _ctx.repaint();
}

// The cross itself, for the corner of whatever is being made.
function _dropX(alertId, what) {
  const b = el('button', 'mv3-wk-letgo', '✕');
  b.type = 'button';
  b.title = 'Stop waiting for ' + what + '. It was paid for when it was asked for - this does not'
    + ' get that back; it takes the row out of Alerts and stops the app expecting a picture.';
  b.disabled = !alertId || !!_dropping;
  b.addEventListener('click', (e) => { e.stopPropagation(); _dropRow(alertId, what); });
  return b;
}

// A frame of the pool for this line, by hand - or '' to hand the line back to the rule.
async function _pickFrame(i, frameId) {
  const p = _ctx && _ctx.project;
  if (!p) return;
  _picking = false;
  _pickView = '';
  try { _adopt(await _post('/api/scen3/fragments/pick-frame', { projectId: p.id, line: i, frameId })); }
  catch (e) { _readErr = 'Could not pick that frame: ' + e.message; }
  _ctx.repaint();
}

// The ✕ / ✓ in the corner of a frame in the general zone: out of the rotation, and back into it.
// ── Reframing a first frame (phase V9) ──────────────────────────────────────
// A first frame is what a clip is made of, so cutting in closer - or off to one side - is done
// where the frame is being looked at: on the stage (the owner, 2026-09-22). The selection is drawn
// on the preview canvas (js/merge-v3/preview-b.js, cropOn); this side only says which frame is
// being reframed, in what SHAPE, and sends the rectangle. The shape is the project's own format,
// locked: a frame of any other shape reaches the renderer with bars down its sides.
//
// The cut is filed by the SERVER, into the set and into the project's folder, because the page does
// not own the project - and a cut filed by the page would be lost by walking away from it.
let _cropOn = '';                         // the frame being reframed, by id
let _cropBusy = false;

function _formatAspect(p) {
  const f = String((((p || {}).mix || {}).settings || {}).format || '9:16');
  const m = f.match(/^(\d+)\s*:\s*(\d+)$/);
  return m && +m[2] ? (+m[1]) / (+m[2]) : 9 / 16;
}

async function _cropApply(p, fr, rect) {
  if (!rect || _cropBusy) return;
  _cropBusy = true;
  _said = '';
  _ctx.repaint();
  try {
    const r = await _post('/api/scen3/frames/crop', { projectId: p.id, frameId: fr.id, rect });
    _adopt(r);
    _cropOn = '';
    // The cut is what is on the stage now: it is what was just made, and its picture is a new
    // address, so the selection goes with the old one.
    if (r.frameId) _setPick = r.frameId;
  } catch (e) {
    _said = 'The frame was not cropped: ' + e.message;
  }
  _cropBusy = false;
  _ctx.repaint();
}

async function _banFrame(p, frameId, banned) {
  try { _adopt(await _post('/api/scen3/frames/ban', { projectId: p.id, frameId, banned })); }
  catch (e) { _readErr = 'Could not switch that frame: ' + e.message; }
  _ctx.repaint();
}

// The strip dragged into another order (the owner, 2026-09-21). What is sent is the WHOLE strip as
// it now reads, switched-off frames included: the order is the strip's, not the pool's, so turning
// a frame back on does not drop it somewhere unexpected.
async function _saveOrder(p, ids) {
  try { _adopt(await _post('/api/scen3/frames/order', { projectId: p.id, order: ids })); }
  catch (e) { _readErr = 'Could not move that frame: ' + e.message; }
  _ctx.repaint();
}

// A change by hand: shown at once, then the server's answer.
async function _saveShot(i, patch) {
  const p = _ctx && _ctx.project;
  if (!p || !p.lines[i]) return;
  p.lines[i].shot = { ...(p.lines[i].shot || {}), ...patch };
  _ctx.repaint();
  try {
    _adopt(await _post('/api/scen3/fragments/shot', { projectId: p.id, line: i, patch }));
  } catch (e) {
    _readErr = 'Could not save it: ' + e.message;
  }
  _ctx.repaint();
}
const _video = () => (_ctx && _ctx.project && _ctx.project.video) || {};
// (phase V26.8) What films the clips - Kling avatar or a Seedance, for the whole video - and the qualities it makes.
const _modelOf = () => ((_kit && _kit.models) || []).find(m => m.id === _video().model) || null;
// Seedance is the project's mode: asked of the model when the menus are read, else of the server's own word for it.
const _seedance = () => { const m = _modelOf(); return m ? m.family === 'seedance' : _video().mode === 'seedance'; };
const _qualities = () => ((_modelOf() || {}).qualities) || [];
const _tier = () => _qualities().find(q => q.id === _video().quality) || _qualities()[0] || null;
const _ceiling = () => ((_tier() || {}).maxAudioSec) || CEILING_FALLBACK;
const _money = (n) => '$' + (Math.round(n * 100) / 100).toFixed(2);

// The clip settings go up as the one field that changed; the server merges it into what it has.
async function _saveVideo(patch) {
  const p = _ctx && _ctx.project;
  if (!p) return;
  p.video = { ...(p.video || {}), ...patch };          // shown now, confirmed below
  _saving = true;
  _said = '';
  _ctx.repaint();
  try {
    const r = await fetch('/api/scen3/projects', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: p.id, video: patch }),
    }).then(x => x.json());
    if (!r || !r.success) throw new Error((r && r.error) || 'refused');
    p.video = r.project.video;
  } catch (e) {
    _said = 'Could not save it: ' + e.message;
  }
  _saving = false;
  _ctx.repaint();
}

// ── The panel ───────────────────────────────────────────────────────────────
// `host` is the step's scroll box, under its title; `api` is what the step lends - the character
// cast (the voice row is theirs), the voice module's api, and the way to the shelves.
export function paint(host, ctx, api, head) {
  _ctx = ctx;
  _api = api;
  const p = ctx.project;
  if (!p) { host.appendChild(_note('Reading the project…')); return; }
  if (_kit === null) _loadKit(ctx.repaint);
  const lines = Array.isArray(p.lines) ? p.lines : [];

  // Which fragment is open: the address first (it is the newer instruction), then where this
  // project was left, then the general zone.
  if (_key !== ctx.key) { _key = ctx.key; _open = null; _listAt = 0; _editWords = -1; _inserting = -1; _insDraft = ''; _rightAt.clear(); _tipHide(); }
  _bars.length = 0;                       // the fields are built fresh; so is the list of bars (N3)
  // (phase V26.5) Arriving on the frames chat - its Alerts row, a reload there - is arriving on the chat, not on a fragment.
  if (_open === null) _open = _asked >= 0 ? _asked : api.view() === 'fchat' ? -1 : _remembered();
  _asked = -1;
  if (_open >= lines.length) _open = lines.length ? 0 : -1;
  // A line taken off (Z4) has no fragment to open: the general zone is where that press lands.
  if (_open >= 0 && !isLive(lines[_open])) _open = -1;
  // (phase V26.8) Merged, a line opens the fragment it is in - by that fragment's first line.
  if (_open >= 0 && _merged(p)) { const g = _groupWith(p, _open); _open = g ? g.lines[0] : -1; }
  if (_merged(p)) { _inserting = -1; _mergeMissing(p); }
  if (_stageFor !== _open) { _stageFor = _open; _stagePick = ''; }

  host.classList.add('is-split');
  // (phase V26.5) THE FRAMES CHAT stands where the fields stand (js/merge-v3/fchat.js lays itself over this column), and
  // the script beside it folds away to the right (the owner, 2026-10-10): a strip at its left edge folds it, the same
  // strip right of the chat brings it back. A line pressed in the script opens its fragment in the chat's place; the
  // fragment's cross comes back to the chat.
  const chat = api.view() === 'fchat' && _open < 0;
  if (!chat) _chatPick = null;
  const folded = chat && _fold;
  const left = el('div', 'mv3-wk-half is-frags');
  if (!folded) {
    host.appendChild(left);
    host.appendChild(_splitSash(host, left));
  }
  if (chat) host.appendChild(_foldStrip(folded));
  if (_inserting >= lines.length) _inserting = -1;
  const right = el('div', 'mv3-wk-half is-guide is-frag' + (chat ? ' is-fcslot' : (_open >= 0 || _inserting >= 0) ? ' has-close' : ''));
  host.appendChild(right);
  if (!folded) _applySplit(host, left);
  if (!chat) _keepScroll(right, 'r' + _open + ':' + api.view());

  _pickUpDrawing();
  _pickUpClips();
  VOICE.pickUpRead(api.voiceApi());       // a read the SERVER is doing, started before this paint (X2)
  // The list is the script and nothing else (owner, 2026-09-21): the voice stands in its own field
  // on the right, with everything else that is set once for the whole video.
  if (!folded) _list(left, p, lines);

  // Where the whole script stands goes in the panel's HEADER, beside the name of the step (the
  // owner, 2026-09-22): it is about the whole video, and so is the line it now shares.
  _counters(head, p, lines);
  if (api.view() === 'voice') { VOICE.paintPicker(right, api.voiceApi()); return; }
  if (chat) {
    FCHAT.show(right, p, {
      close: () => { _chatPick = null; api.go('hub'); },
      stage: (path, name) => { _chatPick = { path, name: name || '' }; _ctx.repaint(); },
      // A frame put into the set: the project as the server has it now - the shelf and the counters follow.
      added: (project) => { _adopt({ project }); _ctx.repaint(); },
    });
    _mark();
    onlyHere(null);
    return;
  }
  _notes(right);
  if (!lines.length) {
    right.appendChild(_note('This project has no lines. The script is written on the Scenarios page and comes with the project.'));
    return;
  }
  if (_inserting >= 0) _insertEditor(right, p, lines);
  else if (_open < 0) _all(right, p, lines);
  else _fragment(right, p, lines[_open], _open);
  // The countdown belongs to the set being drawn, on the stage of the general zone.
  // The countdown belongs to whatever is being made where you are looking: the clip of the open
  // fragment, or - with no fragment open - the set being drawn in the general zone.
  // The read that is playing keeps its ❚❚ (Y5). The buttons are built fresh by every paint and the
  // audio element is not, so without this a repaint - and pressing play is now one - draws every
  // button idle while the sound goes on.
  _mark();
  const mine = _open >= 0 ? _clipping.get(_open) : null;
  const place = mine ? 'clip' : (_open < 0 && _drawing.size ? 'frames' : null);
  onlyHere(place);
  if (place === 'clip') {
    holdProgress(place, { label: 'Making the clip', estimateMs: CLIP_ESTIMATE_MS, startedAt: mine.startedAt });
  } else if (place) {
    const first = [..._drawing.values()].reduce((a, d) => Math.min(a, d.startedAt), Date.now());
    holdProgress(place, { label: 'Drawing ' + _drawing.size + (_drawing.size === 1 ? ' frame' : ' frames'), estimateMs: FRAME_ESTIMATE_MS, startedAt: first });
  }
}

// WHERE THE RIGHT COLUMN STOOD (the owner, 2026-09-22). Every repaint rebuilds the column, and a
// rebuilt column starts at the top - so picking a frame variant near the bottom threw the person
// back to the heading. The offset is remembered per FACE (the general zone, each fragment, the
// voice picker): moving to another fragment should start at its top, coming back to the same one
// should not. Put back after the paint, which is a microtask away and before anything is drawn.
const _rightAt = new Map();
// ── The sash between the fields and the script (R2) ─────────────────────────
// The script column is the one with a size: the fields take what is left. Dragging LEFT makes it
// wider, because it stands on the right of them; a double-click gives it back to the stylesheet.
function _clampSplit(host, px) {
  const all = host.getBoundingClientRect().width || 600;
  const hi = Math.max(SPLIT_MIN, Math.round(all * SPLIT_PART));
  return Math.round(Math.max(SPLIT_MIN, Math.min(px, hi)));
}
function _applySplit(host, col) {
  if (!_splitW) return;
  col.style.flex = '0 0 ' + _clampSplit(host, _splitW) + 'px';
}
function _splitSash(host, col) {
  const s = el('div', 'mv3-wk-sash');
  s.title = 'Drag to give the script more room · double-click to put it back';
  s.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const x0 = e.clientX;
    const base = col.getBoundingClientRect().width;
    document.body.classList.add('mv3-resize-v');
    const move = (ev) => {
      _splitW = _clampSplit(host, base + (x0 - ev.clientX));
      col.style.flex = '0 0 ' + _splitW + 'px';
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.body.classList.remove('mv3-resize-v');
      try { localStorage.setItem(SPLIT_KEY, String(_splitW)); } catch (err) { /* a private window */ }
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
  s.addEventListener('dblclick', () => {
    _splitW = 0;
    try { localStorage.removeItem(SPLIT_KEY); } catch (e) { /* a private window */ }
    _ctx.repaint();
  });
  return s;
}

// The strip that folds the script away beside the frames chat, and brings it back (the owner, 2026-10-10): five pixels
// wide, the whole height, in gold, its arrow saying which way it goes.
function _foldStrip(folded) {
  const b = el('button', 'mv3-wk-fold' + (folded ? ' is-folded' : ''));
  b.type = 'button';
  b.title = folded ? 'Show the script' : 'Fold the script away to the right';
  b.setAttribute('aria-label', b.title);
  b.addEventListener('click', () => {
    _fold = !folded;
    try { localStorage.setItem(FOLD_KEY, _fold ? '1' : '0'); } catch (e) { /* a private window */ }
    _ctx.repaint();
  });
  return b;
}

function _keepScroll(box, key) {
  softScroll(box);                          // a gentler wheel in setup (V5)
  box.addEventListener('scroll', () => { _rightAt.set(key, box.scrollTop); }, { passive: true });
  const was = _rightAt.get(key) || 0;
  if (was) queueMicrotask(() => { if (box.isConnected) box.scrollTop = was; });
}

function _note(text, bad) {
  const d = el('div', 'mv3-ins-note' + (bad ? ' is-err' : ''));
  d.textContent = text;
  return d;
}

// What the panel has to say - a save that failed, an agent that could not read a line - at the top
// of the right column, whichever face it wears.
function _notes(host) {
  if (_said) host.appendChild(_note(_said, true));
  if (_readErr) host.appendChild(_note(_readErr, true));
}

// What the frames and the clips cannot be made without: the person in a look and the place. Named
// on the zones that wait for them.
function _missing(p) {
  const cast = p.casting || {};
  const out = [];
  if (!cast.obrazImage) out.push('a character in a look');
  if (!cast.locationImage) out.push('an environment');
  return out;
}
// Is there a voice to read in - the character's, or the project's own pick? The same rule the
// server applies (routes/scen3.js, _castVoice), read here from what the panel holds, because a
// voice just taken is on the character record and the project copy before either is read again.
const _canRead = () => !!(_api && VOICE.canRead(_api.voiceApi()));

// WHAT IS NOT CHOSEN YET (phase V24, the owner 2026-10-09): a field with a choice still to make wears
// a RED dashed frame instead of the gold one, and `generate all` waits for every one of them. A project
// made since starts at none - the mood, the shot, the amount, the spread, the quality (routes/scen3.js
// _normVideo) - and the voice is missing while neither the character nor the project has one. Read from
// the project alone, because the header's `generate all` is painted before the fields and also while a
// fragment is open, when the fields are not painted at all.
function _needs(p) {
  const v = (p && p.video) || {};
  const out = {};
  if (!v.mood) out.mood = 'a mood';
  if (!_canRead()) out.voice = 'a voice';
  // (phase V26.5, the owner 2026-10-10) THE FIRST FRAMES ARE THERE ONCE THE SET HAS A FRAME - from the frames chat or a
  // set drawn here: the field's menus are needed only to draw a set, so they are red only while there is none.
  const f = [!v.framing && 'the shot', !v.frames && 'the amount', !v.spread && 'the spread'].filter(Boolean);
  if (f.length && !_pool(p).length) out.frames = f.join(', ');
  // (phase V26.8) The model first - Kling avatar or a Seedance - then the quality it makes.
  if (!v.model) out.video = 'the model';
  else if (!v.quality) out.video = 'the quality';
  return out;
}
// The "none" a menu shows while nothing is chosen in it: the first line, and it cannot be chosen back.
function _noneOption(sel, word) {
  const o = el('option', '', word || 'none');
  o.value = '';
  o.disabled = true;
  o.selected = true;
  sel.appendChild(o);
}

// ── The general zone: the whole video, in three stages ──────────────────────
// (Decided with the owner 2026-09-21, docs/local-app/PLAN.md, phase W.) The one mood every stage
// reads from, in gold; then three zones in gold, one above the other - voice, first frames, video -
// each a drawer with its own `generate` at the foot. The counters and `generate all` stand in the
// panel's header, whatever the panel shows (W2.5).
function _all(host, p, lines) {
  // FOUR FIELDS, TWO BY TWO, NUMBERED THE WAY THEY RUN (the owner, 2026-09-22): mark up, read,
  // draw, film. The number sits on the corner of each gold frame, and the FRAME says where the
  // field stands - dashed while there is work in it, solid when there is none. They do not open
  // and shut any more: four fields side by side hold what four drawers held, and a drawer that
  // shuts itself is one more thing to reopen.
  //
  // TWO COLUMNS, NOT TWO ROWS (phase V26.1, the owner 2026-10-10): the voice field grew a row of its
  // own settings and the video field below it had room to spare. In rows a field is as tall as its
  // neighbour, so the voice could not grow without the mood growing with it; in columns each field
  // is as tall as what it holds, and the lower field of a column takes what is left.
  const cols = el('div', 'mv3-wk-zcols');
  const left = el('div', 'mv3-wk-zcol');
  const right = el('div', 'mv3-wk-zcol');
  cols.append(left, right);
  host.appendChild(cols);
  _stageMood(left, p, lines);
  _stageFrames(left, p);
  _stageVoice(right, p, lines);
  _stageVideo(right, p, lines);
  // (phase V26.8, the owner 2026-10-13) SEEDANCE HAS MORE TO SET: the video field runs down to the foot of the zone and
  // the frames shelf, under the four fields at full width otherwise, is as wide as the first-frames field, under it.
  if (_seedance()) left.classList.add('is-shelved');
  _shelfFrames(_seedance() ? left : host, p);
}

// ONE FIELD: a gold frame with its number on the corner, a head, a body and a foot with the
// field's own `generate`. `spec`: step (the number), name, sub (what it is), summary (where it
// stands - said in the head beside the name, always, because the field never shuts), done, blocked
// with its why.
//
// THE FRAME IS THE STATE (the owner, 2026-09-22): dashed gold while there is work left in this
// field, solid gold when there is none. It replaces both the drawer that shut itself and the tick
// beside the name - a border says it without a word, and four of them say the whole thing at a
// glance.
function _stage(host, id, spec) {
  // Blocked outranks done: a pool made before the character was taken off is not a field at rest. And
  // a choice not made (`need`, phase V24) outranks both: the frame is red and dashed until it is made.
  const done = !!spec.done && !spec.blocked && !spec.need;
  const box = el('div', 'mv3-wk-stage' + (done ? ' is-done' : ' is-open')
    + (spec.blocked ? ' is-blocked' : '') + (spec.need ? ' is-need' : '') + (spec.half ? ' is-half' : '')
    + (spec.work ? ' is-working' : ''));
  // The field's number, on the corner of its own frame (the owner, 2026-09-22): 1 mark up, 2 read,
  // 3 draw, 4 film - the order they actually work in, said once and visibly.
  if (spec.step) box.appendChild(el('span', 'mv3-wk-znum', String(spec.step)));
  // DONE, beside the number, and it stays (the owner, 2026-09-23 - a mark that flashes for two
  // seconds is a mark you miss). The border says the same thing without a word; the word is for
  // the moment you look up and want to be told.
  if (done && spec.step) box.appendChild(el('span', 'mv3-wk-zdone', 'done'));
  // ...and while there IS work in it, the bottom line of the frame fills up (N3).
  if (spec.work) _barWatch(box, spec.work);
  // A shelf has no number and no button: it is not a step, it is where what was made lands.
  const head = el('div', 'mv3-wk-stage-head');
  head.appendChild(el('span', '', spec.name));
  // What the field IS, and then where it stands. The second used to appear only when the drawer
  // was shut; with nothing to shut, it belongs in the head all the time.
  const sub = spec.need ? 'choose ' + spec.need
    : spec.blocked ? 'needs ' + spec.why
      : [spec.sub, spec.summary].filter(Boolean).join(' · ');
  if (sub) head.appendChild(el('span', 'mv3-wk-vsub' + (spec.need ? ' is-need' : ''), sub));
  if (spec.need) head.title = 'Choose ' + spec.need + ' - nothing in this field is made until it is chosen';
  else if (spec.blocked) head.title = 'Still missing: ' + spec.why;
  box.appendChild(head);
  host.appendChild(box);
  const body = el('div', 'mv3-wk-stage-body');
  box.appendChild(body);
  if (spec.bare) return { open: true, body, foot: null };   // a shelf has nothing to press
  const foot = el('div', 'mv3-wk-stage-foot');
  box.appendChild(foot);
  return { open: true, body, foot };
}

function _genButton(foot, spec) {
  if (spec.cap) foot.appendChild(el('span', 'mv3-wk-vsub', spec.cap));
  const b = el('button', 'mv3-wk-gen', spec.label || 'generate');
  b.type = 'button';
  b.title = spec.title || '';
  b.disabled = !!spec.disabled;
  if (spec.on) b.addEventListener('click', spec.on);
  foot.appendChild(b);
  return b;
}

// HOW FAR THE SET HAS GOT: the frames that have landed, and for each one still being drawn, its
// own share by the estimate. The whole is what was asked for.
function _framesPart(p) {
  const s = _standing(p);
  const asked = Math.max(1, s.framesAsked);
  let got = s.frames;
  for (const d of _drawing.values()) got += _byTime(d.startedAt, 'frame');
  // The planner is thinking: it is one call before any frame exists, and it is a tenth of the wait.
  if (_planning && !_drawing.size) return Math.min(0.1, _byTime(_planAt, 'tag') * 0.1);
  return Math.min(1, got / asked);
}
// ...and the same for the clips. The place and the prompts happen before any clip is asked for,
// and they are short: they hold the first tenth.
function _clipsPart(p, lines) {
  const live = _live(lines);
  const want = live.length || 1;
  if (!_clipping.size) return Math.min(0.1, _byTime(_writeAt, 'tag') * 0.1);
  let got = live.filter((l, i) => _clipState(p, l, i) === 'ok').length;
  for (const c of _clipping.values()) got += _byTime(c.startedAt, 'clip');
  return Math.min(1, got / want);
}

// Where the script stands. The frames are a set, not a line each: what the pool holds over what
// was asked for - the dropdown's number, or more once the pool has grown past it (owner,
// 2026-09-21); "done" is a pool at least that big with nothing still drawing.
function _standing(p) {
  // The lines of the VIDEO, each still knowing its real place in the script (phase Z) - `i` is what
  // the frames, the clips and the journal are addressed by, and it must not become the position in
  // a filtered list.
  const live = liveLines(p.lines);
  const have = _pool(p).length;
  const asked = Math.max(have + _drawing.size, ((p.video || {}).frames) || 0);
  // (phase V26.8) Merged, the video is its fragments: every line is read (that is when they merge), and their clips are
  // Seedance's, which come with the later parts of the phase.
  const gs = _merged(p);
  if (gs) return { n: gs.length, read: gs.length, frames: have, framesAsked: asked, framesDone: have > 0 && !_drawing.size, clips: 0 };
  return {
    n: live.length,
    read: live.filter(x => isRead(x.l)).length,
    // (phase V26.5, the owner 2026-10-10) Done as soon as the set has a frame and nothing is being drawn - how many were
    // asked for is the field's business while it draws, not a debt the frames chat leaves.
    frames: have, framesAsked: asked, framesDone: have > 0 && !_drawing.size,
    clips: live.filter(x => _clipSettled(p, x.l, x.i)).length,
  };
}

// The counters, in THE PANEL'S HEADER (the owner, 2026-09-22): three boxes - read, frames, clips -
// with the count and its name side by side. Since phase V24 (the owner, 2026-10-09) `generate all`
// comes FIRST, the boxes after it, and the step's title stands on the right of the row
// (`.is-tabs-left`, the shelves' heads do the same - js/merge-v3/wk-maker.js shelfHead).
function _counters(host, p, lines) {
  if (!host) return;
  const s = _standing(p);
  const top = el('div', 'mv3-ins-head-act is-counters');
  _chainButton(top, p, lines);
  const stat = el('div', 'mv3-wk-fstats');
  const cell = (num, label, done, title) => {
    const c = el('div', 'mv3-wk-fstat' + (done ? ' is-done' : ''));
    c.appendChild(el('div', 'mv3-wk-fstat-n', num));
    c.appendChild(el('div', 'mv3-wk-fstat-l', label));
    c.title = title;
    stat.appendChild(c);
  };
  const n = s.n;
  cell(s.read + '/' + n, 'read', n > 0 && s.read === n, 'Lines read, of all the lines');
  cell(_drawing.size ? s.frames + '/' + s.framesAsked : String(s.frames), 'frames', s.framesDone,
    _drawing.size ? 'Frames in the pool, of the set being drawn' : 'Frames in the pool - the fragments take theirs from it');
  cell(s.clips + '/' + n, 'clips', n > 0 && s.clips === n, 'Lines with a clip, of all the lines');
  top.appendChild(stat);
  host.classList.add('is-tabs-left');
  host.prepend(top);
}

// ── `generate all`: every stage in one press (phase W3c) ────────────────────
// The voice and the frames do not depend on each other and go TOGETHER; the video waits for both,
// because an animation prompt is written from the frames the lines open on. What the chain will
// spend is said before it starts and confirmed by a second press - the frames are dollars (the
// reads and the prompts are credits), and a set is only drawn when there is none.
let _chain = '';                          // '' | 'voice+frames' | 'video'

// WHAT THE WHOLE RUN WILL DO, AND COST (phase V23, the owner 2026-10-09: it always asks, in a window). The clips
// of the lines this very run reads cannot be priced exactly - their reads do not exist yet - so they are estimated:
// the line's earlier read when it has one, else its characters at about fifteen a second. `only` is every line the
// question priced, and the clips stage asks for no other.
const CHARS_PER_SEC = 15;
const _readChars = (l) => String((l && (l.tagged || l.text)) || '').replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim().length;
function _chainEstimate(p, lines, w) {
  const tier = _tier();
  const ceiling = _ceiling();
  const can = !w.missing.length && !!_video().quality && !_seedance() && (w.pool > 0 || w.frames > 0);
  const now = (can && w.pool) ? _clipWork(p, lines) : [];
  const only = new Set(now.map(x => x.i));
  let chars = 0, later = 0, laterCost = 0, tooLong = 0;
  for (const { l, i } of liveLines(lines)) {
    const willRead = _canRead() && !isRead(l);
    if (willRead) chars += _readChars(l);
    if (!can || only.has(i) || _clipping.has(i) || _clipSettled(p, l, i)) continue;
    const take = _take(l);
    const readNow = _readState(l) === 'ok' && !!take;
    if (!readNow && !willRead) continue;
    if (!_frameFor(p, l, i).v && !w.frames) continue;
    const dur = readNow ? take.dur : ((take && take.dur) || _readChars(l) / CHARS_PER_SEC);
    if (dur > ceiling) { tooLong++; continue; }
    later++;
    laterCost += _clipCost(dur, tier);
    only.add(i);
  }
  return { now: now.length, nowCost: now.reduce((a, x) => a + x.cost, 0), later, laterCost, tooLong, chars, only };
}

function _chainWork(p, lines) {
  const missing = _missing(p);
  const pool = _pool(p).length;
  const v = _video();
  const live = _live(lines);
  // Stage one is its own step now (Z2): the chain does it first, and the read waits for it.
  const tags = VOICE.untagged(p).length;
  const voice = _canRead() ? live.filter(l => !isRead(l)).length : 0;
  const frames = (!missing.length && !pool && !_drawing.size) ? (v.frames || 0) : 0;
  // The video stage needs a frame to write from: with none in the pool, only a set being drawn now
  // (frames above) can give it one.
  // (phase V26.8) Kling's animation prompts only: a Seedance project's are written by its own part of the phase.
  const video = (!missing.length && (pool || frames) && !_seedance()) ? live.filter(l => !_animated(l) && !((l.shot || {}).motionEdited && (l.shot || {}).motion)).length : 0;
  // The clips of the lines that can be clipped NOW. Lines that only become clippable during the
  // chain - read in this very run, or opening on a frame drawn in it - are counted when the video
  // stage is reached, not here: their price cannot be known before they exist.
  const clips = (!missing.length && pool) ? _clipWork(p, lines) : [];
  const clipCost = clips.reduce((a, x) => a + x.cost, 0);
  return {
    missing, tags, voice, frames, video, pool, clips: clips.length, clipCost,
    anything: tags + voice + frames + video + clips.length > 0,
  };
}

function _chainButton(host, p, lines) {
  const w = _chainWork(p, lines);
  // A clip already running does NOT hold this shut (V4, the owner 2026-09-22): clips are per
  // fragment and the planner steps over the ones in flight, so the rest can be started while one
  // renders. What does hold it shut is work that is one-at-a-time - a chain, the reads, the
  // planner, a set being drawn, the writer.
  const busy = !!_chain || VOICE.reading().busy || _planning || _drawing.size > 0 || _envWriting || !!_writing;
  // What the whole run costs, as far as it can be known before it starts: the frames of a set that
  // is not there yet, and the clips of the fragments that could be clipped this moment. The clips
  // of lines this run will read are paid for when the video stage gets to them and are named then.
  const b = el('button', 'mv3-wk-gen mv3-wk-genall',
    _chain === 'tags' ? 'tags…' : _chain === 'voice+frames' ? 'voice, frames…' : _chain === 'video' ? 'video, clips…'
      : 'generate all');
  b.type = 'button';
  // NOT WHILE A FRAME IS RED (phase V24, the owner 2026-10-09): every choice is made first - the chain
  // would otherwise run on choices nobody made, or skip the read for want of a voice without a word.
  const needs = Object.values(_needs(p));
  b.disabled = busy || !lines.length || needs.length > 0 || !w.anything;
  b.title = needs.length ? 'Choose first: ' + needs.join(', ')
    : w.missing.length
    ? 'The frames and the video need ' + w.missing.join(' and ') + ' - the voice can be read without them'
    : !w.anything ? 'Everything that can be made is made'
      : 'In one press: ' + [
        w.tags ? w.tags + (w.tags === 1 ? ' line marked up' : ' lines marked up') : '',
        w.voice ? w.voice + (w.voice === 1 ? ' line read' : ' lines read') : '',
        w.frames ? w.frames + ' frames drawn · ' + _money(w.frames * FRAME_PRICE) : '',
        w.video ? w.video + (w.video === 1 ? ' animation prompt' : ' animation prompts') : '',
        w.clips ? w.clips + (w.clips === 1 ? ' clip' : ' clips') + ' · ' + _money(w.clipCost) : '',
      ].filter(Boolean).join(', ') + '. The voice and the frames together, then the video and the clips. It asks first.';
  b.addEventListener('click', () => _askChain(b, p, lines));
  host.appendChild(b);
}

// Waiting for the frames to LAND, not just to be asked for: the video stage writes from them.
async function _untilDrawn() {
  for (let k = 0; k < 1200 && _drawing.size; k++) await new Promise(r => setTimeout(r, 500));
}

// The question (phase V23): every stage of the run with what it spends - credits for the mark-up, the reads and the
// prompts, dollars for the frames and the clips - and the clips of this run's own reads as an estimate.
function _askChain(anchor, p, lines) {
  if (_chain) return;
  const w = _chainWork(p, lines);
  if (!w.anything) return;
  const e = _chainEstimate(p, lines, w);
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
  const rows = [];
  if (w.tags) rows.push('mark-up: ' + plural(w.tags, 'line', 'lines') + ' (credits)');
  if (w.voice) rows.push('read: ' + plural(w.voice, 'line', 'lines') + ' · about ' + e.chars + ' characters (ElevenLabs credits)');
  if (w.frames) rows.push('frames: ' + w.frames + ' × ' + _money(FRAME_PRICE) + ' = ' + _money(w.frames * FRAME_PRICE));
  if (w.video) rows.push('animation prompts: ' + w.video + ' (credits)');
  if (e.now) rows.push('clips now: ' + e.now + ' · ' + _money(e.nowCost));
  if (e.later) rows.push('clips of the lines this run reads: about ' + e.later + ' · about ' + _money(e.laterCost));
  if (e.tooLong) rows.push('left out - longer than ' + _ceiling() + ' s: ' + plural(e.tooLong, 'line', 'lines'));
  const dollars = (w.frames ? w.frames * FRAME_PRICE : 0) + e.nowCost + e.laterCost;
  if (dollars) rows.push('in all: ' + (e.later ? 'about ' : '') + _money(dollars) + ' and the credits');
  askChoice(anchor, 'Generate all?', rows, [
    { label: 'Run it', kind: 'yes', on: () => _generateAll(p, lines, e.only) },
    { label: 'Cancel' },
  ], { stay: true });
}

async function _generateAll(p, lines, only) {
  if (_chain) return;
  if (Object.keys(_needs(p)).length) return;   // a red frame first (phase V24)
  const w = _chainWork(p, lines);
  if (!w.anything) return;
  _readErr = '';
  // STAGE ONE FIRST, and alone: the read is spoken from the tags, so nothing can start beside it.
  if (w.tags) {
    _chain = 'tags';
    _ctx.repaint();
    await VOICE.tagAll(_api.voiceApi());
    if (!VOICE.canSpeak(_ctx.project || p)) { _chain = ''; return _ctx.repaint(); }
  }
  _chain = 'voice+frames';
  _ctx.repaint();
  try {
    await Promise.all([
      w.voice ? VOICE.generate(_api.voiceApi()) : Promise.resolve(),
      w.frames ? _makeSet().then(_untilDrawn) : Promise.resolve(),
    ]);
    // A stage that failed says so in its own field; the chain stops rather than writing prompts for
    // frames that never arrived.
    if (_readErr || !_pool(_ctx.project).length) { _chain = ''; return _ctx.repaint(); }
    _chain = 'video';
    _ctx.repaint();
    // The last stage is the whole video zone: the place, the animation prompts, and then the clips
    // of every fragment that can have one - including the lines this very run has just read.
    const now = _ctx.project;
    await _writeVideo(now, { clips: true, only: only || null });
  } catch (e) {
    _readErr = 'The chain stopped: ' + e.message;
  }
  _chain = '';
  _ctx.repaint();
}

// MOOD - stage one. The emotion of the whole thing, the one choice the person makes here (owner,
// 2026-09-18) and the one vocabulary every stage reads from (2026-09-21): the tags of the read, the
// expression in the frames, the movement in the clips. Its one line under the menu says what the
// choice means.
//
// AND IT IS WHERE THE SCRIPT IS MARKED UP (the owner, 2026-09-22). The tagging used to be the first
// half of the voice field's button, which meant the markup happened on the way to being spoken and
// nobody saw it before the read was paid for. It belongs to the mood - the mood is what it marks up
// by - so it is this field's own `generate`, and the read is stage two. There is no silent pass
// left anywhere: with a line still unmarked, the voice will not start at all.
function _stageMood(host, p, lines) {
  const v = _video();
  const g = VOICE.reading();
  const live = _live(lines);
  const want = VOICE.untagged(p);
  const done = live.length > 0 && !want.length;
  const now = ((_kit && _kit.moods) || []).find(m => m.id === v.mood) || null;
  const need = _needs(p).mood;
  const { body } = _stage(host, 'mood', {
    step: 1, half: true, bare: true,     // its button stands on the mood's own line, not in a foot
    // One call to an agent has no halfway point, so this fills by an estimate that learns (N3).
    work: g.tagging ? () => _byTime(g.tagAt, 'tag') : null,
    name: 'mood', sub: 'and the tags of the read', done, need,
    summary: want.length ? want.length + (want.length === 1 ? ' line to mark up' : ' lines to mark up') : 'marked up',
  });
  const row = el('div', 'mv3-wk-fsets');
  const mood = el('select', 'mv3-wk-vsel is-small is-wide');
  mood.title = 'The emotion of the whole video: the read, the frames and the clips all follow it';
  if (!now) _noneOption(mood, 'mood: none');
  for (const m of (_kit && _kit.moods) || []) {
    const o = el('option', '', 'mood: ' + m.label);
    o.value = m.id;
    if (m.id === v.mood) o.selected = true;
    mood.appendChild(o);
  }
  mood.disabled = _saving || !_kit || g.tagging;
  mood.addEventListener('change', () => _saveVideo({ mood: mood.value }));
  row.appendChild(mood);
  body.appendChild(row);
  // The mood's own sentence and the button that acts on it share a line (the owner, 2026-09-22):
  // the words say what this mood IS, the button marks the script up by it, and a count of the
  // lines still to mark was a third thing said where two were enough - the frame already says
  // whether there is work left in this field.
  const under = el('div', 'mv3-wk-fwishrow is-mood');
  if (now && now.about) under.appendChild(el('div', 'mv3-wk-mood-about', now.about));
  body.appendChild(under);
  _genButton(under, {
    label: g.tagging ? 'tagging…' : 'generate',
    disabled: g.busy || !_kit || !live.length || !want.length || !!need,
    title: need ? 'Choose a mood first - the script is marked up by it'
      : !want.length ? 'Every line has its tags. Change the words of one and it comes back here.'
      : 'Read the script and put the [tags] of this mood between the words - '
        + want.length + (want.length === 1 ? ' line' : ' lines') + '. Costs credits, not dollars.',
    on: () => VOICE.tagAll(_api.voiceApi()),
  });
}

// VOICE - the first zone, the one the timeline waits for: the voice the script is read in - the
// character's, or the project's own before there is a character - and `generate`, which tags the
// script by the mood and reads every line that needs it, three at a time (ElevenLabs v3). Shut by
// itself once every line is read.
function _stageVoice(host, p, lines) {
  const g = VOICE.reading();
  const live = _live(lines);
  const read = live.filter(isRead).length;
  // Read with other settings than the project's now (V26.1): still read, but work left in this field.
  const redo = live.map(l => VOICE.unsettledBy(p, l)).filter(Boolean);
  const done = live.length > 0 && read === live.length && !redo.length && !g.busy;
  const untagged = VOICE.untagged(p).length;
  const { body, foot } = _stage(host, 'voice', {
    step: 2, half: true,
    // Counted, when there is a batch: every line that lands moves it. One line read by hand has
    // nothing to count, so that one goes by the estimate (N3).
    work: g.batch ? () => (g.batch.done || 0) / Math.max(1, g.batch.total)
      : g.lines.length ? () => _byTime(g.readAt, 'read') : null,
    // Red while there is no voice to read in at all - the character has none and the project has
    // chosen none (phase V24, the owner 2026-10-09).
    name: 'voice', sub: 'ElevenLabs v3', done, need: _needs(p).voice,
    summary: read + '/' + live.length + ' read' + (redo.length ? ' · ' + redo.length + ' to redo' : ''),
  });
  VOICE.paintRow(body, _api.voiceApi());
  const has = _canRead();
  const will = live.filter(l => !isRead(l)).length;
  const again = redo.filter(w => w === 'stability').length;
  const retime = redo.length - again;
  // HOW IT IS SPOKEN, in one row with the button (the owner, 2026-10-10): the stability on the left,
  // the speed beside it, `generate` on the right. What the press will do is said on the button
  // itself, under the pointer - a line of it under the row was one thing said twice (the owner).
  foot.classList.add('is-voice');
  const ctl = el('div', 'mv3-wk-vctl');
  foot.appendChild(ctl);
  _voiceSettings(ctl, p, g.busy);
  const label = g.batch ? 'reading ' + g.batch.done + ' of ' + g.batch.total + '…'
    : g.lines.length ? 'reading…' : 'generate';
  _genButton(ctl, {
    label,
    disabled: !has || g.busy || !live.length || !(will + redo.length) || !!untagged,
    title: !has ? 'Choose a voice first - a character with one, or one for the project'
      : untagged ? 'The script is not marked up yet: ' + untagged + (untagged === 1 ? ' line has' : ' lines have')
        + ' no tags. Stage 1 - the mood field - does that, and the read follows the tags.'
        : !(will + redo.length) ? 'Every line is read, with these settings'
          : [will && 'Read every line that needs it (' + will + '), one a second - ElevenLabs v3, by the tags the mood put in.',
            again && 'Read again the ' + again + (again === 1 ? ' line' : ' lines') + ' read with another stability - ElevenLabs, credits.',
            retime && 'Retime the ' + retime + (retime === 1 ? ' line' : ' lines') + ' read at another speed - here, free.',
            redo.length && 'A line with a clip keeps it on the timeline until a new one is made.'].filter(Boolean).join(' '),
    on: () => VOICE.generate(_api.voiceApi()),
  });
}

// THE STABILITY AND THE SPEED of the read (phase V26.1, the owner 2026-10-10) - one each for the
// whole video, kept on the project. Changing either touches no read: the lines read before stay read,
// and the field's `generate` redoes them - a read again for the stability, a retiming for the speed.
const STABILITY = [
  { v: 0, label: 'creative', tip: 'More emotional and expressive - and more likely to stray from the words' },
  { v: 0.5, label: 'natural', tip: 'Balanced - the closest to the voice as it was recorded' },
  { v: 1, label: 'robust', tip: 'Very even - follows the tags less' },
];
const SPEED = { min: 0.7, max: 1.2, step: 0.05 };
function _voiceSettings(foot, p, busy) {
  const now = VOICE.params(p);
  const stab = el('select', 'mv3-wk-vsel is-small is-stab');
  for (const s of STABILITY) {
    const o = el('option', '', s.label);
    o.value = String(s.v);
    o.title = s.tip;
    if (s.v === now.stability) o.selected = true;
    stab.appendChild(o);
  }
  stab.disabled = busy || _saving;
  stab.addEventListener('change', () => _saveVoice({ stability: +stab.value, speed: VOICE.params(p).speed }));
  const sw = el('label', 'mv3-wk-vlab');
  sw.title = 'How steady the voice is. ElevenLabs v3 knows three: creative, natural, robust. A line read before keeps its read until generate reads it again.';
  sw.append(el('span', '', 'stability'), stab);
  const speed = el('input', 'mv3-wk-vnum');
  speed.type = 'number';
  speed.min = String(SPEED.min);
  speed.max = String(SPEED.max);
  speed.step = String(SPEED.step);
  speed.value = String(now.speed);
  speed.disabled = busy || _saving;
  _speedLater(speed, 'project', () => VOICE.params(_ctx.project).speed, v => ({ speed: v }));
  const pw = el('label', 'mv3-wk-vlab');
  pw.title = 'How fast the reads play: 1 is as ElevenLabs speaks, ' + SPEED.min + ' to ' + SPEED.max
    + '. Applied at once - the reads already made are retimed here, free, with the voice at its own pitch,'
    + ' and the timeline follows. A line given its own speed in its fragment keeps it.';
  pw.append(el('span', '', 'speed'), speed);
  foot.append(sw, pw);
}

// A SPEED IS APPLIED AFTER A PAUSE (the owner, 2026-10-10): the arrows of the field can be pressed several
// times in a row, and only where they stop is retimed - each press used to save, repaint and shut the field
// for the length of a retiming. What is typed waits here, so a repaint in between (a read landing, the
// watcher) shows it rather than the old speed; Enter does not wait.
const SPEED_PAUSE_MS = 700;
let _speedDraft = null;                   // { key, raw } - the field being changed, as typed
let _speedT = 0;
function _speedLater(inp, key, now, body) {
  if (_speedDraft && _speedDraft.key === key) inp.value = _speedDraft.raw;
  const apply = () => {
    clearTimeout(_speedT);
    const d = _speedDraft;
    _speedDraft = null;
    if (!d || d.key !== key) return;
    const v = _speedVal(d.raw);
    if (v !== now()) _saveSpeed(body(v));
    else if (_ctx) _ctx.repaint();       // typed back to what it was: show it on the scale
  };
  inp.addEventListener('input', () => {
    clearTimeout(_speedT);
    _speedDraft = { key, raw: inp.value };
    _speedT = setTimeout(apply, SPEED_PAUSE_MS);
  });
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); apply(); } });
}

// A speed typed in, put on the scale the server keeps: 0.7-1.2 in steps of 0.05.
const _speedVal = (raw) => Math.round(Math.round(Math.min(SPEED.max, Math.max(SPEED.min, parseFloat(raw) || 1)) / SPEED.step) * SPEED.step * 100) / 100;

// THE SPEED, the project's or a line's (phase V26.1, the owner 2026-10-10): saved and applied in one call
// (routes/scen3.js, /scen3/voice/speed) - the reads are retimed before the answer, the timeline follows.
async function _saveSpeed(body) {
  const p = _ctx && _ctx.project;
  if (!p) return;
  _saving = true;
  _readErr = '';
  _ctx.repaint();
  try {
    const r = await _post('/api/scen3/voice/speed', { projectId: p.id, ...body });
    _adopt(r);
    if ((r.failed || []).length) _readErr = 'Not retimed: line ' + r.failed.map(x => x.line).join(', ') + ' - ' + r.failed[0].error;
    Store.refresh().catch(() => {});
  } catch (e) {
    _readErr = 'The speed was not changed: ' + e.message;
  }
  _saving = false;
  _ctx.repaint();
}

// The read's settings, onto the project - shown at once, confirmed by the answer.
async function _saveVoice(ttsParams) {
  const p = _ctx && _ctx.project;
  if (!p) return;
  p.voice = { ...(p.voice || {}), ttsParams };
  _saving = true;
  _said = '';
  _ctx.repaint();
  try {
    const r = await fetch('/api/scen3/projects', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: p.id, voice: { ttsParams } }),
    }).then(x => x.json());
    if (!r || !r.success) throw new Error((r && r.error) || 'refused');
    p.voice = r.project.voice;
  } catch (e) {
    _said = 'Could not save it: ' + e.message;
  }
  _saving = false;
  _ctx.repaint();
}

// A menu with its name to the left of it, and the name carries the explanation. A `label` rather
// than a `span`, so pressing the word opens the menu.
function _labelled(word, sel, tip, tight) {
  const box = el('label', 'mv3-wk-fsetlab' + (tight ? ' is-tight' : ''));
  box.title = tip;
  box.appendChild(el('span', 'mv3-wk-fsetlabw', word));
  box.appendChild(sel);
  return box;
}

// FIRST FRAMES - a set for the whole video (owner, 2026-09-21): the shot size with its mannequin
// beside its menus and the wishes, how many, and the pool as it stands under them, the full width -
// every frame a door to the stage. `generate` plans the moments and asks for every frame at once;
// the lines take from the pool in turn. Shut while there is no one in a look and no place to draw
// them in, and by itself once the set is drawn.
function _stageFrames(host, p) {
  const v = _video();
  const missing = _missing(p);
  const blocked = missing.length > 0;
  const s = _standing(p);
  const { body, foot } = _stage(host, 'frames', {
    step: 3, half: true,
    // The frames that have landed, plus how far the ones still drawing have got (N3).
    work: (_planning || _drawing.size) ? () => _framesPart(p) : null,
    name: 'first frames', sub: 'a set for the video', done: s.framesDone,
    blocked, why: missing.join(' and '),
    // Red until the shot, the amount and the spread are chosen (phase V24) - and that outranks the
    // dimming: the menus are the way out of it, so the field must not look shut.
    need: _needs(p).frames,
    summary: (_drawing.size ? s.frames + '/' + s.framesAsked + ' drawn · drawing ' + _drawing.size : s.frames + (s.frames === 1 ? ' frame' : ' frames') + ' in the set'),
  });
  const set = ((_kit && _kit.sets) || []).find(x => x.id === v.framing) || null;

  // The three menus down the left, each on its line with its name over it, and the mannequin of
  // the chosen shot size beside them - as wide as the `generate` button under it, so the field
  // has one right-hand edge (the owner, 2026-09-22). The wishes take the full width beneath both.
  const row = el('div', 'mv3-wk-fsetrow');
  const pose = set ? _poseById(set.poseId) : null;
  const pic = el('div', 'mv3-wk-fpose' + (pose ? '' : ' is-empty'));
  if (pose && (pose.thumb || pose.file)) {
    const img = el('img');
    img.alt = '';
    img.src = pose.thumb || pose.file;
    pic.title = pose.label + ' - ' + pose.desc;
    pic.appendChild(img);
  }
  const col = el('div', 'mv3-wk-fsetcol');
  const sets = el('div', 'mv3-wk-fsets');
  const framing = el('select', 'mv3-wk-vsel is-small is-model');
  framing.title = 'The shot size every frame of the set is made in';
  if (!set) _noneOption(framing);
  for (const s of (_kit && _kit.sets) || []) {
    const o = el('option', '', s.label);
    o.value = s.id;
    if (s.id === v.framing) o.selected = true;
    framing.appendChild(o);
  }
  framing.disabled = _saving || !_kit || _planning;
  framing.addEventListener('change', () => _saveVideo({ framing: framing.value }));
  // HOW THE LINES TAKE FROM THE SET (the owner, 2026-09-21): the pool in turn, or one drawn for
  // each line. The options are named by the rule itself - `cycle` and `random` - because that is
  // what they are called everywhere else, including in the project's own field.
  const spread = el('select', 'mv3-wk-vsel is-small is-model');
  spread.title = 'How the fragments take their frames from the set: cycle - the pool in turn; random - one drawn for each fragment';
  if (!v.spread) _noneOption(spread);
  for (const id of ['cycle', 'random']) {
    const o = el('option', '', id);
    o.value = id;
    if (v.spread === id) o.selected = true;
    spread.appendChild(o);
  }
  spread.disabled = _saving || _planning;
  spread.addEventListener('change', () => _saveVideo({ spread: spread.value }));
  const count = el('select', 'mv3-wk-vsel is-small is-tier');
  count.title = 'How many variations of the shot the set holds';
  if (!v.frames) _noneOption(count);
  for (let k = 1; k <= ((_kit && _kit.setMax) || 5); k++) {
    const o = el('option', '', '× ' + k);
    o.value = String(k);
    if (k === v.frames) o.selected = true;
    count.appendChild(o);
  }
  count.disabled = _saving || !_kit || _planning;
  count.addEventListener('change', () => _saveVideo({ frames: parseInt(count.value, 10) }));
  // EACH MENU WEARS ITS NAME (the owner, 2026-09-22): three short menus side by side said nothing
  // about themselves, and one of them - how the fragments take their frames - had no name anywhere.
  // One word to the left of each, and the word carries the explanation on hover.
  sets.append(
    _labelled('shot', framing, 'Shot size - how much of the person is in frame. Every frame of the set is made in it.'),
    _labelled('amount', count, 'How many variations of that shot the set holds. The fragments share them.', true),
  );
  const rule = el('div', 'mv3-wk-fsets');
  rule.appendChild(_labelled('spread', spread,
    'How the fragments take their frames from the set: cycle - the pool in turn; random - one drawn for each fragment.'));
  col.append(sets, rule);
  // What the person asks for, in words - kept on the project, so it is still there tomorrow. Its
  // foot is the mannequin's foot: the two are one block (the owner, 2026-09-21).
  const wish = el('textarea', 'mv3-wk-ftext-in is-wish');
  wish.rows = 3;
  wish.placeholder = 'Anything the frames should have - "arms crossed", "looking off to the left", "holding the mug"…';
  wish.value = 'wish' in _drafts ? _drafts.wish : (v.wish || '');
  wish.disabled = _planning;
  wish.addEventListener('input', () => { _drafts.wish = wish.value; });
  wish.addEventListener('change', () => { const w = wish.value; delete _drafts.wish; if (w.trim() !== String(v.wish || '').trim()) _saveVideo({ wish: w }); });
  row.append(col, pic);
  body.appendChild(row);
  body.appendChild(wish);

  // `generate`: the price first, the set on the second press. What was drawn is not here: it is
  // on the shelf under the four fields (_shelfFrames), where there is width for it.
  _framesButton(foot, p);
}

// ── FRAMES: the shelf of what has been drawn (phase R, the owner 2026-09-22) ──
// A field of its own under the four, the full width of the column: in the first-frames field,
// which is half a row wide, the strip showed about three frames of a set. Everything it can do
// came with it - press a frame to put it on the stage, ✕ to take it out of the rotation, drag to
// reorder, right-click to see it large. Its frame is dashed until the set is drawn, like the
// others. No number: a shelf is not a step.
//
// AT ITS HEAD, a frame that is not a frame: an empty tile with a `+`, in gold dashes. It is the
// door to asking for a frame in words - a chat that will open over THESE fields and leave the
// script beside them alone - and until that door exists it says so on hover. (One stood here
// before and was taken away in phase V for promising exactly this with nothing behind it; it
// comes back with the promise written on it.)
function _shelfFrames(host, p) {
  const s = _standing(p);
  const { body } = _stage(host, 'shelf', {
    bare: true,
    name: 'frames', sub: 'what has been drawn', done: s.framesDone,
    summary: s.frames ? s.frames + (s.frames === 1 ? ' frame' : ' frames') + (_drawing.size ? ' · drawing ' + _drawing.size : '') : '',
  });
  const strip = el('div', 'mv3-wk-fset');
  // (phase V26.5) THE DOOR TO THE FRAMES CHAT: a frame asked for in words, in place of these fields. It waits, as the
  // first frames do, for the person in a look and the place.
  const add = el('button', 'mv3-wk-fsetfr is-add', '+');
  add.type = 'button';
  const want = _missing(p);
  add.disabled = want.length > 0;
  add.title = want.length ? 'The frames chat needs ' + want.join(' and ') + ' first'
    : 'The frames chat: describe a frame in words - the person and the place go with it';
  add.addEventListener('click', () => { if (add.disabled) return; _setPick = ''; _open = -1; _remember(); _api.go('fchat'); });
  strip.appendChild(add);
  const hidden = _off(p);
  const shown = _poolAll(p);
  for (const fr of shown) {
    const gone = hidden.has(String(fr.id));
    const b = el('button', 'mv3-wk-fsetfr' + (fr.id === _setPick ? ' is-on' : '') + (gone ? ' is-off' : ''));
    b.type = 'button';
    // DRAGGED INTO ORDER (the owner, 2026-09-21): pick a frame up and drop it where it belongs.
    // What the strip reads when the drag ends is the order that is saved, and "the pool in turn"
    // then means this order.
    b.draggable = true;
    b.dataset.frame = fr.id;
    b.addEventListener('dragstart', (e) => {
      _dragging = fr.id;
      b.classList.add('is-dragging');
      try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', fr.id); } catch (err) { /* older engines */ }
    });
    b.addEventListener('dragend', () => { _dragging = ''; b.classList.remove('is-dragging'); strip.querySelectorAll('.is-over').forEach(x => x.classList.remove('is-over')); });
    b.addEventListener('dragover', (e) => {
      if (!_dragging || _dragging === fr.id) return;
      e.preventDefault();
      b.classList.add('is-over');
    });
    b.addEventListener('dragleave', () => b.classList.remove('is-over'));
    b.addEventListener('drop', (e) => {
      e.preventDefault();
      b.classList.remove('is-over');
      const from = _dragging;
      _dragging = '';
      if (!from || from === fr.id) return;
      const ids = shown.map(x => String(x.id)).filter(id => id !== from);
      const at = ids.indexOf(String(fr.id));
      ids.splice(at < 0 ? ids.length : at, 0, from);
      _saveOrder(p, ids);
    });
    b.title = (fr.made === 'chat' ? 'from the frames chat · ' : '') + (fr.framing ? fr.framing + ' ' : '') + (fr.n ? fr.n + ' · ' : '')
      + (gone ? 'switched off - no fragment takes it' : 'press to see it on the stage; right-click to open it large');
    // (phase V26.5) A frame made to order in the frames chat says so on its tile.
    if (fr.made === 'chat') b.appendChild(el('span', 'mv3-wk-fsetmade', 'chat'));
    const img = el('img');
    img.alt = '';
    img.loading = 'lazy';
    img.src = derived(fr.preview || fr.path, 'card');
    b.appendChild(img);
    // The ✕ in the corner takes a frame out of the rotation; the ✓ in the same corner brings it
    // back (the owner, 2026-09-21). A switched-off frame is dimmed and stands first, out of the way.
    const sw = el('button', 'mv3-wk-fsetx' + (gone ? ' is-back' : ''), gone ? '✓' : '✕');
    sw.type = 'button';
    sw.title = gone ? 'Use this frame again' : 'Do not use this frame in any fragment';
    sw.addEventListener('click', (e) => { e.stopPropagation(); _banFrame(p, fr.id, !gone); });
    b.appendChild(sw);
    b.addEventListener('click', () => { _setPick = _setPick === fr.id ? '' : fr.id; _ctx.repaint(); });
    b.addEventListener('contextmenu', (e) => { e.preventDefault(); showPicture({ src: fr.path, name: 'frame ' + (fr.n || ''), rows: fr.prompt ? [['prompt', fr.prompt]] : [] }); });
    strip.appendChild(b);
  }
  // One tile per frame in flight - and each one knows its own row, so it can be let go of (N1).
  for (const [alertId] of _drawing) {
    const tile = el('div', 'mv3-wk-fsetfr is-busy', 'drawing…');
    tile.appendChild(_dropX(alertId, 'this frame'));
    strip.appendChild(tile);
  }
  body.appendChild(strip);
}

// The one button of the first-frames field, kept apart from the field itself so the shelf could
// move out from between them.
function _framesButton(foot, p) {
  const n = _video().frames || 0;
  const busy = _planning || _drawing.size > 0;
  // What it waits for, in words (phase V24): the character in a look and the place, the three choices
  // of this field, and the mood the frames are drawn in.
  const needs = _needs(p);
  // (phase V26.5) The menus are not red once the set has a frame, but a set drawn here still needs them.
  const v = _video();
  const menus = [!v.framing && 'the shot', !v.frames && 'the amount', !v.spread && 'the spread'].filter(Boolean).join(', ');
  const wait = [..._missing(p), menus, needs.mood].filter(Boolean);
  _genButton(foot, {
    label: _planning ? 'planning…' : _drawing.size ? 'drawing ' + _drawing.size + '…' : _armedSet ? n + (n === 1 ? ' frame' : ' frames') + ' · ' + _money(n * FRAME_PRICE) + '?' : 'generate',
    cap: busy ? '' : wait.length ? 'needs ' + wait.join(', ') : n + (n === 1 ? ' frame' : ' frames') + ' · ' + _money(n * FRAME_PRICE),
    disabled: busy || !_kit || wait.length > 0,
    title: wait.length ? 'First: ' + wait.join(', ')
      : 'The agent plans ' + n + ' moments of this shot from the look, the place, the mood and your words; every one is drawn at once - nano-banana-2, 2K, '
        + _money(FRAME_PRICE) + ' each. Press again to confirm.',
    on: () => {
      if (!_armedSet) { _armedSet = true; _ctx.repaint(); return; }
      _armedSet = false;
      _makeSet();
    },
  });
}

// VIDEO - the model and the tier, how the PLACE moves (W3a) and the animation of the PERSON, line
// by line (W3b); the clips themselves come with F4. OPEN FROM THE START (phase V24, the owner
// 2026-10-09): the model and the quality are chosen at the beginning, and the field is red until the
// quality is; what it still waits for - the character, the place, a first frame to animate - is said
// on its `generate`, which stays shut until they are there.
function _stageVideo(host, p, lines) {
  const missing = _missing(p);
  const why = missing.length ? missing.join(' and ') : !_pool(p).length ? 'a first frame' : '';
  const motion = _envMotion(p);
  const live = _live(lines);
  const written = live.filter(_animated).length;
  // (phase V23, the owner: "так") Done when every line of the video HAS ITS CLIP - fresh, or chosen by hand - and
  // nothing is being made; the prompts are only the way there.
  const s = _standing(p);
  // (phase V26.8) Seedance's clips are still being built: the field holds its settings and makes nothing yet - and the
  // Kling clips a project may already have are not Seedance's, so they do not make it done.
  const soon = _seedance() ? 'Seedance clips are still being built (phase V26.8) - the settings are kept' : '';
  const done = !soon && s.n > 0 && s.clips === s.n && !_clipping.size && !why;
  const need = _needs(p).video;
  const { body, foot } = _stage(host, 'video', {
    step: 4, half: true,
    // The clips that have landed, plus the ones in flight; the place and the prompts, which come
    // first and are quick, go by the estimate of a clip (N3).
    work: (_writing || _envWriting || _clipping.size) ? () => _clipsPart(p, lines) : null,
    name: 'video', sub: 'the place, then the person', done, need,
    summary: soon ? 'Seedance' + (motion ? '' : ' · the place is not written')
      : 'clips ' + s.clips + '/' + s.n + ' · ' + written + '/' + live.length + ' animated' + (motion ? '' : ' · the place is not written'),
  });
  _needEnvMeta();
  const v = _video();
  // WHAT FILMS IT AND HOW SHARP, one row (phase V26.8, the owner 2026-10-13): the model of the whole video - Kling avatar,
  // a clip per line, or one of the three Seedances - and the qualities that model makes, each with its price a second.
  // Neither is chosen for a new project (V24): both say none, and the field is red until they are.
  const models = (_kit && _kit.models) || [];
  const sets = el('div', 'mv3-wk-fsets');
  const model = el('select', 'mv3-wk-vsel is-small is-model');
  model.title = 'What films the clips - for the whole video';
  if (!v.model) _noneOption(model);
  for (const m of models) {
    const o = el('option', '', m.label);
    o.value = m.id;
    o.title = m.about;
    if (m.id === v.model) o.selected = true;
    model.appendChild(o);
  }
  model.disabled = _saving || !_kit;
  model.addEventListener('change', () => {
    // The quality stays when the new model makes it too; otherwise it is chosen again.
    const next = models.find(m => m.id === model.value);
    const keep = !!(next && (next.qualities || []).some(q => q.id === v.quality));
    _saveVideo({ model: model.value, quality: keep ? v.quality : '' });
  });
  const tier = el('select', 'mv3-wk-vsel is-small is-tier');
  tier.title = 'How sharp the clips are, and what a second of them costs';
  if (!v.quality || !v.model) _noneOption(tier);
  for (const q of v.model ? _qualities() : []) {
    const o = el('option', '', q.label + ' · $' + q.pricePerSec + '/s');
    o.value = q.id;
    if (q.id === v.quality) o.selected = true;
    tier.appendChild(o);
  }
  tier.disabled = _saving || !_kit || !v.model;
  tier.addEventListener('change', () => _saveVideo({ quality: tier.value }));
  // The model first and the quality after it (the owner, 2026-09-22): what makes the clip, then
  // how good it is - the second only means anything once the first is read.
  sets.append(model, tier);
  body.appendChild(sets);
  const about = (_modelOf() || {}).about;
  if (about) body.appendChild(el('div', 'mv3-wk-fwhy', about));
  if (_seedance()) _seedanceSettings(body, p);

  // HOW THE PLACE MOVES. One field, because it is one sentence about one picture - and it is the
  // picture's, not this project's: what is written here is what every talking head filmed in this
  // place will animate by.
  body.appendChild(el('div', 'mv3-wk-flabel', 'environment animation'));
  const env = el('textarea', 'mv3-wk-ftext-in');
  env.rows = 2;
  env.placeholder = _envWriting ? 'the agent is looking at the place…'
    : 'What moves in the background by itself - a curtain, steam, leaves, traffic far behind. Write it, or press generate.';
  env.value = 'env' in _drafts ? _drafts.env : motion;
  env.disabled = _envWriting;
  env.addEventListener('input', () => { _drafts.env = env.value; });
  env.addEventListener('change', () => {
    const w = env.value;
    delete _drafts.env;
    if (w.trim() !== motion.trim()) _saveEnvMotion(p, w.trim());
  });
  body.appendChild(env);
  body.appendChild(el('div', 'mv3-wk-fwhy', 'It belongs to the place: every video filmed here animates the same way.'));

  // `generate`: the place first when it has nothing written, then the animation of every line that
  // needs one. Both are the agent thinking about pictures - credits, not dollars - so there is no
  // second press to confirm, as with the reads.
  const willWrite = live.filter(l => !_animated(l) && !((l.shot || {}).motionEdited && (l.shot || {}).motion)).length;
  const clips = _clipWork(p, lines);
  const clipCost = clips.reduce((a, x) => a + x.cost, 0);
  // HOW LONG THE VIDEO IS, beside what is left to make (the owner, 2026-09-22): the reads of the
  // lines that are in it, added up - which is exactly the length the cut comes to, because a clip
  // is trimmed to its read (lib/frag-mirror.js). A line not read yet has no length to add.
  const secs = live.reduce((a, l) => a + (isRead(l) ? (_take(l) || {}).dur || 0 : 0), 0);
  const whole = secs ? (Math.round(secs * 10) / 10).toFixed(1) + 's in all' : '';
  // A clip in flight does not shut this button (V4): the planner skips the fragments that are
  // already being made, so `generate` here starts the others.
  const busy = !!_writing || _envWriting;
  // The clips are the dollars in this zone, so the button shows the price and waits for a second
  // press when there are any - the words before them are credits and go on the first.
  const armed = _armedVideo && clips.length > 0;
  // What the press still waits for (phase V24): the field is open, its `generate` is not - the
  // character and the place, a first frame to animate, the quality, and the mood the person moves in.
  const wait = [why, need, _needs(p).mood].filter(Boolean);
  _genButton(foot, {
    label: _writing === 'place' || (_envWriting && !_writing) ? 'the place…'
      : _writing === 'lines' ? 'writing…'
        : _writing === 'clips' ? 'clips ' + _standing(p).clips + '/' + live.length + '…'
          : armed ? _money(clipCost) + ' · go?' : done ? 'again' : 'generate',
    // What this press will SPEND and how long the video is - and nothing else (the owner,
    // 2026-09-22). The chores it also does - looking at the place, writing the prompts - used to
    // be listed here; they cost credits, not dollars, and the button's own tooltip still says them.
    cap: soon ? 'being built' : busy ? whole : wait.length ? 'needs ' + wait.join(', ') : [
      _clipping.size ? _clipping.size + (_clipping.size === 1 ? ' clip running' : ' clips running') : '',
      clips.length ? clips.length + (clips.length === 1 ? ' clip · ' : ' clips · ') + _money(clipCost) : '',
      whole,
    ].filter(Boolean).join(' · '),
    disabled: !!soon || busy || wait.length > 0 || !_place(p) || !live.length || (!!motion && !willWrite && !clips.length),
    title: soon ? soon : wait.length ? 'First: ' + wait.join(', ')
      : 'The place, then how the person moves on every line, then the clips of the fragments that'
        + ' have none - Kling avatar, ' + (clips.length ? clips.length + ' of them for ' + _money(clipCost) : 'none to make')
        + '. A prompt edited by hand is left alone; a fragment that is already clipped is not paid for twice.'
        + (clips.length ? ' Press again to confirm.' : ''),
    on: () => {
      if (clips.length && !_armedVideo) { _armedVideo = true; _ctx.repaint(); return; }
      _armedVideo = false;
      _writeVideo(p, { clips: true });
    },
  });
}

// SEEDANCE'S OWN SETTINGS (phase V26.8, the owner 2026-10-13), under the model: whether the lines are merged, how the
// clip is voiced, how the body moves, the camera. Each says what it does on the line under it (the owner's answer (ш):
// "пояснение нужно, что это за параметры"). They are kept on the project as they are chosen; the clips that use them
// come with the later parts of the phase.
function _seedanceSettings(body, p) {
  const v = _video();
  const longest = ((_qualities()[0] || {}).maxAudioSec) || 15;
  const row = (node) => { const r = el('div', 'mv3-wk-fsets'); r.appendChild(node); body.appendChild(r); };
  const why = (text) => body.appendChild(el('div', 'mv3-wk-fwhy', text));

  // MERGE - by the person's tick, never by itself (the owner): neighbouring lines joined into one clip each, once every
  // line is read (part 3, lib/sd-merge.js). Unticked to change a line, ticked again to merge again.
  const m = p.merge || {};
  const gs = _merged(p);
  const merge = el('label', 'mv3-wk-fcheck' + ((m.can || m.on) && !_merging ? '' : ' is-off'));
  const tick = el('input');
  tick.type = 'checkbox';
  tick.checked = !!m.on;
  tick.disabled = _merging || (!m.can && !m.on) || VOICE.reading().busy;
  tick.addEventListener('change', () => _setMerge(p, tick.checked));
  merge.append(tick, el('span', '', _merging ? 'merge fragments · joining the sound…' : 'merge fragments'));
  merge.title = !m.can && !m.on ? 'Not yet: ' + (m.why || 'read every line first') : 'Neighbouring lines as one clip each';
  body.appendChild(merge);
  const live = liveLines(p.lines || []).length;
  why(gs ? gs.length + ' fragments from ' + live + ' lines, up to ' + longest + ' s each. A merged fragment is not edited:'
    + ' untick, change the lines, tick again.'
    : m.on ? 'Ticked - the lines merge again once every line is read (' + (m.why || '') + ').'
      : 'Joins neighbouring lines into one clip each, up to ' + longest + ' s - the fewest fragments, of the most even'
        + ' lengths. ' + (m.can ? 'Every line is read: it can be ticked.' : (m.why || 'Read every line first') + '.'));

  // THE SOUND - how Seedance voices the clip (lib/th-video.js SOUNDS). Not chosen, it goes by the script's language
  // (the owner's answer (ь)): English - Seedance from the read; anything else - the read as it is.
  const sounds = (_kit && _kit.sounds) || [];
  const auto = v.soundAuto || 'read';
  const cur = v.sound || auto;
  const sound = el('select', 'mv3-wk-vsel is-small is-model');
  for (const s of sounds) {
    const o = el('option', '', s.label);
    o.value = s.id;
    o.title = s.about;
    if (s.id === cur) o.selected = true;
    sound.appendChild(o);
  }
  sound.disabled = _saving || !_kit;
  sound.addEventListener('change', () => _saveVideo({ sound: sound.value }));
  row(_labelled('sound', sound, 'How the clip is voiced'));
  const said = sounds.find(s => s.id === cur);
  if (said) why(said.about + (v.sound ? '' : ' Chosen by the script’s language - ' + (auto === 'read' ? 'English.' : 'not English.')));

  // GESTURES - how the head, the hands and the body move (the owner's answer (ц)): one way per mood, the project's mood
  // until another is picked; the face follows the mood always (answer (щ)). Picking the mood itself follows it again.
  const moods = (_kit && _kit.moods) || [];
  const gest = el('select', 'mv3-wk-vsel is-small is-model');
  const curG = v.gestures || v.mood || '';
  if (!curG) _noneOption(gest, 'as the mood');
  for (const md of moods) {
    const o = el('option', '', md.label + (md.gloss ? ' — ' + md.gloss : '') + (md.id === v.mood ? ' (the mood)' : ''));
    o.value = md.id;
    if (md.id === curG) o.selected = true;
    gest.appendChild(o);
  }
  gest.disabled = _saving || !_kit;
  gest.addEventListener('change', () => _saveVideo({ gestures: gest.value === v.mood ? '' : gest.value }));
  row(_labelled('gestures', gest, 'How the head, the hands and the body move'));
  why('How the head, the hands and the body move while speaking. It follows the mood (field 1) until you pick another;'
    + ' the face always follows the mood.');

  // THE CAMERA - one continuous shot (the owner's answer (е)); several shots in one clip are in development.
  const cam = el('select', 'mv3-wk-vsel is-small is-model');
  const one = el('option', '', 'one continuous shot');
  one.value = 'one';
  const more = el('option', '', 'several shots · soon');
  more.value = 'more';
  more.disabled = true;
  cam.append(one, more);
  cam.value = 'one';
  row(_labelled('camera', cam, 'How the clip is shot'));
  why('One shot from the first word to the last, the camera moving a little.');
}

function _list(host, p, lines) {
  // HOW THE TWO COLUMNS WORK, said over the list they are about (the owner, 2026-09-22). It used to
  // sit in grey italics at the foot of the general zone, where somebody scrolling the stages never
  // reached it; here it is the first thing above the script, and it changes with where you are.
  const hint = el('div', 'mv3-wk-fhint', _open < 0
    ? (_merged(p) ? 'Pick a fragment to look at it. Merged fragments are not edited.' : 'Pick a fragment to work on it. Right-click one for more.')
    : 'Press fragment ' + _fragNo(p, lines, _open) + ' again to come back to the whole video.');
  host.appendChild(hint);
  const list = el('div', 'mv3-wk-flist');
  host.appendChild(list);
  // The video first, numbered 1..N with no gaps; then, at the foot, the lines taken off it - dim,
  // out of the way, each with the one act it has (the owner, 2026-09-22). They keep their real
  // places in the script underneath, which is why nothing above them moved when they went.
  const live = liveLines(lines);
  // (phase V26.8) Merged: the fragments in place of the lines, fewer of them, each in a gold frame.
  const gs = _merged(p);
  if (gs) gs.forEach(g => list.appendChild(_mrow(p, g, lines)));
  else live.forEach((x, pos) => list.appendChild(_row(p, x.l, x.i, pos + 1)));
  const off = lines.map((l, i) => ({ l, i })).filter(x => !isLive(x.l));
  if (off.length) {
    list.appendChild(el('div', 'mv3-wk-flabel is-off', 'taken off the script'));
    off.forEach(x => list.appendChild(_offRow(x.l, x.i)));
  }
  // Where it stood before this paint - a repaint rebuilds the column, and a rebuilt column starts
  // at the top. The column is in the panel by now, so the offset takes.
  softScroll(list);                         // a gentler wheel in setup (V5)
  list.addEventListener('scroll', () => { _listAt = list.scrollTop; }, { passive: true });
  if (_listAt) list.scrollTop = _listAt;
}

// ── MERGED FRAGMENTS (phase V26.8, part 3, the owner 2026-10-13) ─────────────
// A MERGED FRAGMENT IN THE LIST: its number, its length, its whole sound, the words of its lines - in a gold frame. It
// opens like a line does; it has no read, no "+" and no menu - a merged fragment is not edited (the owner's answer (п)).
function _mrow(p, g, lines) {
  const head = g.lines[0];
  const row = el('button', 'mv3-wk-frow is-merged' + (head === _open ? ' is-open' : '') + (g.tooLong ? ' is-long' : ''));
  row.type = 'button';
  const meta = el('div', 'mv3-wk-lmeta');
  meta.appendChild(el('span', 'mv3-wk-lnum', String(g.n)));
  meta.appendChild(el('span', 'mv3-wk-ldur', g.dur.toFixed(1) + 's'));
  row.appendChild(meta);
  row.appendChild(_playBtn(g.ready ? g.audio : '', 'the fragment'));
  const words = g.lines.map(i => _words(lines[i])).join(' ');
  row.appendChild(el('div', 'mv3-wk-ftext', words || '(no words)'));
  const dots = el('div', 'mv3-wk-fdots');
  const dot = (state, what) => {
    const d = el('span', 'mv3-wk-fdot is-' + state);
    d.title = what + ': ' + (state === 'ok' ? 'done' : 'not yet');
    dots.appendChild(d);
  };
  dot('ok', 'read');
  dot(_frameFor(p, lines[head], head).v ? 'ok' : 'none', 'frame');
  dot('none', 'clip');
  row.appendChild(dots);
  row.addEventListener('mouseenter', () => { _tipT = setTimeout(() => _tipShow(row, { text: words }, head, g.n), TIP_MS); });
  row.addEventListener('mouseleave', _tipHide);
  row.addEventListener('contextmenu', (e) => e.preventDefault());
  row.addEventListener('click', () => {
    _tipHide();
    _open = _open === head ? -1 : head;
    _picking = false;
    _pickView = '';
    _remember();
    _ctx.repaint();
  });
  return row;
}

// What a fragment is called: a merged one by its own number, a line by its place in the video (_no).
const _fragNo = (p, lines, i) => { const g = _groupOf(p, i); return g ? g.n : _no(lines, i); };
// Which lines a merged fragment is, as a person reads them: "3–4" - their places in the video.
const _span = (lines, g) => _no(lines, g.lines[0]) + (g.lines.length > 1 ? '–' + _no(lines, g.lines[g.lines.length - 1]) : '');

// A MERGED FRAGMENT, OPEN: its words line by line, read-only; its whole sound (the owner's answer (п) - "проигрываем
// полное аудио"); the frame it opens on with its prompt and the picker, by its first line; and the clip and the Seedance
// prompt, which come with the later parts of the phase.
function _mfragment(host, p, g) {
  const lines = Array.isArray(p.lines) ? p.lines : [];
  const head = g.lines[0];
  const l = lines[head];
  const shut = el('button', 'mv3-wk-fclose', '✕');
  shut.type = 'button';
  shut.title = 'Close this fragment - back to the whole video';
  shut.addEventListener('click', () => { _open = -1; _remember(); _ctx.repaint(); });
  host.appendChild(shut);
  const top = el('div', 'mv3-wk-fwrow');
  top.appendChild(_playBtn(g.ready ? g.audio : '', 'the fragment'));
  top.appendChild(el('div', 'mv3-wk-fmhead', (g.lines.length > 1 ? 'lines ' : 'line ') + _span(lines, g) + ' · ' + g.dur.toFixed(1) + ' s'));
  host.appendChild(top);
  const words = el('div', 'mv3-wk-fmwords');
  for (const i of g.lines) {
    const d = el('div', 'mv3-wk-fwords');
    _sayWords(d, String((lines[i] || {}).tagged || '').trim() || _words(lines[i]));
    words.appendChild(d);
  }
  host.appendChild(words);
  if (!g.ready) host.appendChild(_note('Joining the sound of these lines…'));
  if (g.tooLong) {
    const m = _modelOf();
    host.appendChild(_note('This line is ' + g.dur.toFixed(1) + ' s - longer than ' + ((m && m.label) || 'the model') + ' takes ('
      + ((p.merge || {}).cap || 15) + ' s): untick merge fragments and shorten it, or choose seedance 2.5.', true));
  }
  host.appendChild(el('div', 'mv3-wk-fwhy', 'A merged fragment is not edited: untick merge fragments (field 4) to change, read or put in a line - then tick it again.'));
  const grid = el('div', 'mv3-wk-fgrid');
  host.appendChild(grid);
  grid.appendChild(_frameCol(p, l, head));
  grid.appendChild(_framePromptCol(p, l, head));
  const pickHost = el('div', 'mv3-wk-fpickwrap');
  host.appendChild(pickHost);
  _pickRow(pickHost, p, l, head);
  const grid2 = el('div', 'mv3-wk-fgrid');
  host.appendChild(grid2);
  const clip = el('div', 'mv3-wk-fcol is-media');
  clip.appendChild(_colHead('clip'));
  const box = el('div', 'mv3-wk-fmedia is-empty');
  box.appendChild(el('span', '', 'no clip'));
  clip.appendChild(box);
  clip.appendChild(el('div', 'mv3-wk-fcap is-why', 'Seedance clips are still being built (phase V26.8)'));
  grid2.appendChild(clip);
  const prompt = el('div', 'mv3-wk-fcol is-motion');
  prompt.appendChild(_colHead('seedance prompt'));
  const dead = _dead(7, 'Written for this fragment in a later part of the phase: its words with their seconds, the frame, the mood and the gestures.');
  dead.classList.add('is-tall');
  prompt.appendChild(dead);
  grid2.appendChild(prompt);
}

// The tick (field 4) and what follows it: merged - the sound of every fragment is joined before the answer; unticked -
// the lines are lines again. Asked once more, ticked, when a fragment's sound is missing (a read retimed since).
let _merging = false;
let _mergeAsked = '';
async function _setMerge(p, on) {
  if (_merging) return;
  _merging = true;
  _readErr = '';
  _ctx.repaint();
  try {
    const r = await _post('/api/scen3/fragments/merge', { projectId: p.id, on: !!on });
    _adopt(r);
    const bad = (r.failed || [])[0];
    if (bad) _readErr = 'The sound of fragment ' + bad.n + ' was not joined: ' + bad.error;
  } catch (e) {
    _readErr = (on ? 'The fragments were not merged: ' : 'The lines were not unmerged: ') + e.message;
  }
  _merging = false;
  _ctx.repaint();
}
function _mergeMissing(p) {
  const miss = (_merged(p) || []).filter(g => g.lines.length > 1 && !g.ready).map(g => g.key).join(',');
  if (!miss || _merging || _mergeAsked === p.id + ':' + miss) return;
  _mergeAsked = p.id + ':' + miss;
  setTimeout(() => _setMerge(p, true), 0);
}

// WHAT A LINE IS CALLED. Its place among the lines of the VIDEO, counted from one with no gaps -
// not its place in the script, which still holds the lines that were taken off (Z4). Everything
// under the panel - the frames, the clips, the journal, ?line=N - is addressed by the real index;
// this is only what the person reads.
function _no(lines, i) {
  let n = 0;
  for (let k = 0; k <= i && k < lines.length; k++) if (isLive(lines[k])) n++;
  return n;
}

function _row(p, l, i, n) {
  const row = el('button', 'mv3-wk-frow' + (i === _open ? ' is-open' : ''));
  row.type = 'button';
  const take = _take(l);

  const meta = el('div', 'mv3-wk-lmeta');
  meta.appendChild(el('span', 'mv3-wk-lnum', String(n)));
  meta.appendChild(el('span', 'mv3-wk-ldur', take && take.dur ? take.dur.toFixed(1) + 's' : ''));
  row.appendChild(meta);
  // The read, playable from the row (owner, 2026-09-21): hearing a line is how it is judged, and
  // the row is where the eye already is. It PLAYS AND NOTHING ELSE (the owner, 2026-10-10): the
  // fragment does not open and the stage does not change - it used to bring the fragment forward
  // (Y5), which turned listening down the script into opening every line of it.
  row.appendChild(_playBtn(take && take.path ? take.path : '', 'the read'));
  // ...and READ IT, beside its play (the owner, 2026-10-10).
  row.appendChild(_rowRead(p, l, i));

  // No thumbnail between the number and the words (owner): the frame is judged in the fragment,
  // and the row is read for its words.
  const fr = _frameFor(p, l, i).v;
  row.appendChild(el('div', 'mv3-wk-ftext', _words(l) || '(no words)'));

  const dots = el('div', 'mv3-wk-fdots');
  const dot = (state, what) => {
    const d = el('span', 'mv3-wk-fdot is-' + state);
    d.title = what + ': ' + (state === 'ok' ? 'done' : state === 'busy' ? 'being made' : state === 'stale' ? (what === 'shot' ? 'the words or the mood changed since' : 'the words changed since') : 'not yet');
    dots.appendChild(d);
  };
  dot(VOICE.reading().lines.includes(i) ? 'busy' : _readState(l), 'read');
  dot(fr ? 'ok' : 'none', 'frame');
  dot(_clipping.has(i) ? 'busy' : _clipState(p, l, i), 'clip');
  row.appendChild(dots);

  // The whole text under the pointer (the owner, 2026-09-21): the row clips it to two lines, and a
  // line is judged by all of its words. Beside the row, 200px wide, gone when the pointer goes.
  row.addEventListener('mouseenter', () => { _tipT = setTimeout(() => _tipShow(row, l, i, n), TIP_MS); });
  row.addEventListener('mouseleave', _tipHide);
  // What a line can have DONE to it, out of the way of the list (the owner, 2026-09-22): read it
  // again, or take it off the script. The press OPENS this fragment first - a menu about a line you
  // are not looking at is a menu applied to the wrong one - and opening is all it does: a second
  // right-click on the open line does not shut it, unlike a left one.
  row.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    _tipHide();
    if (_open !== i || _inserting >= 0) { _open = i; _inserting = -1; _picking = false; _pickView = ''; _setPick = ''; _stagePick = ''; _stageFor = i; _remember(); _ctx.repaint(); }
    _rowMenu(e, row, p, l, i, n);
  });
  // (phase V26.8, the owner 2026-10-13) A LINE PUT IN under this one: a "+" in a square on the middle of the row's bottom
  // border - half on the row, half over the one below, nothing moved - while the pointer is on the row.
  row.appendChild(_insPlus(i));
  // Pressing the open one again closes it: the right column then speaks for the whole script.
  row.addEventListener('click', () => {
    _tipHide();
    _inserting = -1;
    _open = _open === i ? -1 : i;
    _picking = false;
    _pickView = '';
    _remember();
    _ctx.repaint();
  });
  return row;
}

// THE "+" UNDER A ROW (phase V26.8). Not while anything is being made in the project: a read, a clip or a prompt lands
// on its line by number, and a line put in above it would move it (the server refuses too - /line/insert).
const _insBusy = () => (VOICE.reading().busy ? 'the voice is busy' : _clipping.size ? 'a clip is being made' : _merging ? 'the lines are being merged'
  : (_writing || _chain) ? 'the video is being written for' : '');
function _insPlus(i) {
  const why = _insBusy();
  const plus = el('span', 'mv3-wk-fins' + (why ? ' is-off' : ''), '+');
  plus.setAttribute('role', 'button');
  plus.title = why ? 'Not now: ' + why : 'Put a new line in under this one';
  plus.addEventListener('click', (e) => {
    e.stopPropagation();
    _tipHide();
    if (why) return;
    _inserting = i;
    _insDraft = '';
    _open = -1;
    _picking = false;
    _pickView = '';
    _remember();
    _ctx.repaint();
  });
  return plus;
}

// THE NEW LINE'S WORDS, in the right column (phase V26.8): typed and saved, then it is a fragment like any other - it
// takes the next frame of the set, and is marked up (`mood`) and read in its fragment.
function _insertEditor(host, p, lines) {
  const after = _inserting;
  const cancel = () => { _inserting = -1; _insDraft = ''; _ctx.repaint(); };
  const shut = el('button', 'mv3-wk-fclose', '✕');
  shut.type = 'button';
  shut.title = 'Do not put a line in - back to the whole video';
  shut.addEventListener('click', cancel);
  host.appendChild(shut);
  host.appendChild(el('div', 'mv3-wk-flabel', 'a new line after fragment ' + _no(lines, after)));
  host.appendChild(el('div', 'mv3-wk-fwhy', 'After: “' + (_words(lines[after]) || '').slice(0, 160) + '”'));
  const box = el('textarea', 'mv3-wk-ledit is-frag');
  box.rows = 3;
  box.placeholder = 'The words of the new line';
  box.value = _insDraft;
  box.disabled = _insSaving;
  box.addEventListener('input', () => { _insDraft = box.value; save.disabled = _insSaving || !box.value.trim(); });
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); cancel(); }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); _insertLine(p, after); }
  });
  host.appendChild(box);
  const acts = el('div', 'mv3-wk-vfoot is-tight');
  const save = el('button', 'mv3-wk-vuse', _insSaving ? 'putting it in…' : 'put it in');
  save.type = 'button';
  save.title = 'Put the line in (Ctrl+Enter)';
  save.disabled = _insSaving || !_insDraft.trim();
  save.addEventListener('click', () => _insertLine(p, after));
  const drop = el('button', 'mv3-wk-vuse', 'cancel');
  drop.type = 'button';
  drop.disabled = _insSaving;
  drop.addEventListener('click', cancel);
  acts.append(save, drop);
  host.appendChild(acts);
  host.appendChild(el('div', 'mv3-wk-fwhy', 'It takes the next frame of the set. Then, in its fragment: mood - its [tags] - and read.'));
  if (!_insSaving) setTimeout(() => { if (box.isConnected) { box.focus(); box.setSelectionRange(box.value.length, box.value.length); } }, 0);
}
async function _insertLine(p, after) {
  const text = _insDraft.trim();
  if (!text || _insSaving) return;
  _insSaving = true;
  _readErr = '';
  _ctx.repaint();
  try {
    const r = await _post('/api/scen3/projects/' + encodeURIComponent(p.id) + '/line/insert', { after, text });
    _adopt(r);
    _inserting = -1;
    _insDraft = '';
    _open = r.index;
    _remember();
    // The route re-laid the timeline before it answered - the cells are numbered by the lines.
    await Store.refresh();
  } catch (e) {
    _readErr = 'The line was not put in: ' + e.message;
  }
  _insSaving = false;
  _ctx.repaint();
}

// A LINE TAKEN OFF THE SCRIPT (Z4, the owner 2026-09-22), at the foot of the list: dim, unopenable
// - there is no fragment to work on - and carrying the one act it has. Its read and its clips are
// still in the project folder and come back with it.
function _offRow(l, i) {
  const row = el('div', 'mv3-wk-frow is-off');
  row.appendChild(el('div', 'mv3-wk-ftext', _words(l) || '(no words)'));
  const back = el('button', 'mv3-wk-vuse', 'restore');
  back.type = 'button';
  // (phase V26.8) Merged fragments are not edited: the lines are put back once they are lines again.
  const merged = !!_merged(_ctx && _ctx.project);
  back.title = merged ? 'Untick merge fragments (field 4) to put a line back' : 'Put this line back where it was in the script';
  back.disabled = _offing || merged;
  back.addEventListener('click', () => _setOff(i, false));
  row.appendChild(back);
  row.addEventListener('mouseenter', () => { _tipT = setTimeout(() => _tipShow(row, l, i, 0), TIP_MS); });
  row.addEventListener('mouseleave', _tipHide);
  return row;
}

// Taking a line off, or putting it back. The server decides whether it may (a line being read or
// filmed right now may not) and re-lays the timeline either way, so the cut closes over the line
// that went and opens again when it comes back.
let _offing = false;
async function _setOff(i, want) {
  if (_offing) return;
  _offing = true;
  _readErr = '';
  _ctx.repaint();
  try {
    const p = _ctx.project;
    _adopt(await _post('/api/scen3/projects/' + encodeURIComponent(p.id) + '/line/state', { index: i, removed: !!want }));
    if (want && _open === i) _open = -1;
    _remember();
    // The route has already re-laid the cut by the time it answers, so the timeline under the blur
    // can be brought up to date on the spot rather than on the watcher's next round (Z'3).
    await Store.refresh();
  } catch (e) {
    _readErr = (want ? 'The line was not taken off: ' : 'The line was not restored: ') + e.message;
  }
  _offing = false;
  _ctx.repaint();
}

// READ, on a row of the list (the owner, 2026-10-10): a send mark while the line has no read of the words it
// has, a read-again mark once it has. Pressed, it reads at once - credits, the voice field's settings, no
// question - and does not open or shut the fragment.
function _rowRead(p, l, i) {
  const ra = _readAct(p, l, i);
  const reading = (VOICE.reading().lines || []).includes(i);
  const has = isRead(l);
  const b = el('button', 'mv3-wk-vplay is-send' + (reading ? ' is-busy' : ''), reading ? '…' : has ? '↻' : '➤');
  b.type = 'button';
  b.disabled = !ra.on || reading;
  b.title = reading ? 'This line is being read' : ra.why ? 'Cannot read now: ' + ra.why
    : has ? "Read this line again - ElevenLabs, with the voice field's settings, in place of the take it has"
      : "Read this line - ElevenLabs, with the voice field's settings";
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    if (b.disabled || !ra.on) return;
    b.disabled = true;
    ra.on();
  });
  return b;
}

// THE LINE'S SPEED, in its fragment (the owner, 2026-10-10): the project's until it is changed here, then
// the line's own - the project's speed does not touch it - with a way back.
function _lineSpeed(p, l, i) {
  const own = +l.speed > 0;
  const proj = VOICE.params(p).speed;
  const box = el('label', 'mv3-wk-vlab is-line' + (own ? ' is-own' : ''));
  box.title = own ? "This line's own speed - the project's (" + proj + ') does not touch it. The read is retimed at once, free.'
    : "The speed of this line's read - the project's, " + proj + ". Changed here, it becomes this line's own; the read is retimed at once, free.";
  const inp = el('input', 'mv3-wk-vnum');
  inp.type = 'number';
  inp.min = String(SPEED.min);
  inp.max = String(SPEED.max);
  inp.step = String(SPEED.step);
  inp.value = String(VOICE.speedOf(p, l));
  inp.disabled = _saving || VOICE.reading().busy;
  _speedLater(inp, 'line' + i, () => VOICE.speedOf(_ctx.project, (_ctx.project.lines || [])[i]), v => ({ line: i, lineSpeed: v }));
  box.append(el('span', '', 'speed'), inp);
  if (own) {
    const back = el('button', 'mv3-wk-vback', '↺');
    back.type = 'button';
    back.title = "Back to the project's speed (" + proj + ')';
    back.disabled = inp.disabled;
    back.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); _saveSpeed({ line: i, lineSpeed: null }); });
    box.appendChild(back);
  }
  return box;
}

// THE CLIPS OF A LINE, in a window (the owner, 2026-10-10): each one plays there, and `use` makes it the line's -
// on the timeline too, stale or not (`/scen3/fragments/pick-clip`, V23). A layer (js/layers.js): Escape closes it.
let _cwin = null;
function _closeClipWindow() {
  if (!_cwin) return;
  _cwin.el.querySelectorAll('video').forEach(v => { try { v.pause(); } catch (e) { /* gone */ } });
  _cwin.el.remove();
  Layers.close(_cwin.layer);
  _cwin = null;
}
function _clipWindow(p, l, i, n) {
  _closeClipWindow();
  const shade = el('div', 'mv3-wk-cwin');
  const box = el('div', 'mv3-wk-cwin-box');
  const head = el('div', 'mv3-wk-cwin-head');
  head.appendChild(el('span', '', 'fragment ' + n + ' · its clips'));
  const x = el('button', 'mv3-wk-cwin-x', '✕');
  x.type = 'button';
  x.title = 'Close (Esc)';
  x.addEventListener('click', _closeClipWindow);
  head.appendChild(x);
  box.appendChild(head);
  const grid = el('div', 'mv3-wk-cwin-grid');
  const now = _clipOf(p, l, i);
  for (const c of _clipsOf(p, l).filter(c => c && c.path).slice().reverse()) {
    const on = !!(now && now.id === c.id);
    const stale = !_clipFresh(p, l, i, c);
    const card = el('div', 'mv3-wk-cwin-card' + (on ? ' is-on' : ''));
    const v = document.createElement('video');
    v.src = c.path;
    if (c.thumb) v.poster = c.thumb;
    v.controls = true;
    v.preload = 'metadata';
    v.playsInline = true;
    // One at a time: a second clip started stops the first.
    v.addEventListener('play', () => { grid.querySelectorAll('video').forEach(o => { if (o !== v) o.pause(); }); });
    card.appendChild(v);
    const meta = el('div', 'mv3-wk-cwin-meta');
    meta.appendChild(el('span', 'mv3-wk-vname', c.dur ? c.dur.toFixed(1) + ' s' : 'take'));
    if (stale) meta.appendChild(el('span', 'mv3-wk-fstale', 'stale'));
    if (on) meta.appendChild(el('span', 'mv3-wk-vtag', 'the clip'));
    else {
      const use = el('button', 'mv3-wk-vuse', 'use');
      use.type = 'button';
      use.title = "Make this the fragment's clip - on the timeline too" + (stale ? ', stale as it is' : '');
      use.addEventListener('click', async () => { use.disabled = true; await _pickClip(i, c.id); _closeClipWindow(); });
      meta.appendChild(use);
    }
    card.appendChild(meta);
    grid.appendChild(card);
  }
  box.appendChild(grid);
  shade.appendChild(box);
  shade.addEventListener('mousedown', (e) => { if (e.target === shade) _closeClipWindow(); });
  document.body.appendChild(shade);
  _cwin = { el: shade, layer: Layers.open(shade, { modal: true, name: 'clips of a fragment', onEsc: _closeClipWindow }) };
}

// ── The right-click menu of a row ───────────────────────────────────────────
// A menu layer (js/layers.js), the same shape the scenarios list uses: Escape closes it and the
// page keeps its own shortcuts. It holds what a line can have DONE to it - which is why `read
// again` lives here now and not in the fragment's own column (Z3).
let _menu = null;
function _closeMenu() {
  if (!_menu) return;
  _menu.el.remove();
  document.removeEventListener('mousedown', _menu.away, true);
  Layers.close(_menu.layer);
  _menu = null;
}

// READ / READ AGAIN (phase V23, the owner 2026-10-09): the line's menu and the button beside its words ask the same
// questions - a voice chosen, the script marked up, the voice free. { label, why, on } - `on` is null when it cannot.
function _readAct(p, l, i) {
  const rs = _readState(l);
  const busy = VOICE.reading().busy;
  const why = !_canRead() ? 'choose a voice first'
    : !VOICE.canSpeak(p) ? 'mark the script up first - stage 1'
      : busy ? 'the voice is busy' : '';
  const va = _api.voiceApi();
  return { label: rs === 'none' ? 'read' : 'read again', why, on: why ? null : () => VOICE.readLine(va, i) };
}

function _rowMenu(ev, row, p, l, i, n) {
  _closeMenu();
  const box = el('div', 'mv3-plus-menu');
  const item = (label, sub, on, danger) => {
    const b = el('button', 'mv3-plus-item' + (danger ? ' is-danger' : ''));
    b.type = 'button';
    b.appendChild(el('span', '', label));
    if (sub) b.appendChild(el('small', '', sub));
    b.disabled = !on;
    if (on) b.addEventListener('click', (e) => { e.stopPropagation(); _closeMenu(); on(); });
    box.appendChild(b);
  };

  const ra = _readAct(p, l, i);
  item(ra.label, ra.why || 'in place of the take it has', ra.on);

  // CHOOSE A CLIP (the owner, 2026-10-10): every clip the line has, in a window, each to be watched there
  // and picked - a line keeps the clip it had when its read is redone, and this is the way to another.
  const clips = _clipsOf(p, l).filter(c => c && c.path);
  item('choose a clip', clips.length ? clips.length + (clips.length === 1 ? ' take' : ' takes') + ' · watch and pick' : 'no clips yet',
    clips.length ? () => _clipWindow(p, l, i, n) : null);

  item('remove line', 'out of the video, kept in the project', () => {
    askDelete(row, 'Take fragment ' + n + ' out of the video?',
      'It moves to the foot of the script, dimmed, with a restore on it. Its read and its clips stay in the project folder, and the timeline closes over it.',
      () => _setOff(i, true));
  }, true);

  document.body.appendChild(box);
  const w = box.offsetWidth, h = box.offsetHeight;
  box.style.left = Math.round(Math.max(6, Math.min(window.innerWidth - w - 6, ev.clientX))) + 'px';
  box.style.top = Math.round(Math.max(6, Math.min(window.innerHeight - h - 6, ev.clientY))) + 'px';
  const away = (e) => { if (!box.contains(e.target)) _closeMenu(); };
  const layer = Layers.open(box, { modal: false, name: 'fragment menu', onEsc: _closeMenu });
  _menu = { el: box, away, layer };
  document.addEventListener('mousedown', away, true);
}

// ── The whole text of a row, under the pointer ──────────────────────────────
// Not a layer (js/layers.js): it takes no keyboard and answers no question. Parked on the body,
// because the list scrolls and clips its children; beside the row on the side with room.
let _tip = null;
let _tipT = 0;
function _tipHide() {
  clearTimeout(_tipT);
  if (!_tip) return;
  _tip.remove();
  window.removeEventListener('scroll', _tipHide, true);
  _tip = null;
}
function _tipShow(row, l, i, n) {
  _tipHide();
  if (!row.isConnected) return;
  const tip = el('div', 'mv3-wk-ftip');
  tip.appendChild(el('div', 'mv3-wk-ftip-t', _words(l) || '(no words)'));
  tip.appendChild(el('div', 'mv3-wk-ftip-n', n
    ? 'fragment ' + n + (i === _open ? ' · press again for the whole video' : ' · press to open')
    : 'taken off the script'));
  document.body.appendChild(tip);
  const r = row.getBoundingClientRect();
  const w = tip.offsetWidth, h = tip.offsetHeight;
  const left = r.right + 8 + w <= window.innerWidth - 6 ? r.right + 8 : Math.max(6, r.left - w - 8);
  tip.style.left = Math.round(left) + 'px';
  tip.style.top = Math.round(Math.max(6, Math.min(window.innerHeight - h - 6, r.top - 4))) + 'px';
  _tip = tip;
  window.addEventListener('scroll', _tipHide, true);
}

// ── The right column: the open fragment ─────────────────────────────────────
// A grid of two rows, the animation prompt down the left, the two pictures of a fragment - what it
// opens on and what it becomes - one above the other on the right:
//
//   | animation prompt  |  frame  (from the pool, or picked) |
//   |                   |  clip   + make clip                |
function _fragment(host, p, l, i) {
  const merged = _groupOf(p, i);
  if (merged) return _mfragment(host, p, merged);
  const take = _take(l);
  // (phase V26.5, the owner 2026-10-10) ITS CROSS, top right in gold: the fragment closes - to the whole video, or back to
  // the frames chat when it was opened from there. A second press on its row does the same, as before.
  const shut = el('button', 'mv3-wk-fclose', '✕');
  shut.type = 'button';
  shut.title = _api.view() === 'fchat' ? 'Close this fragment - back to the frames chat' : 'Close this fragment - back to the whole video';
  shut.addEventListener('click', () => { _open = -1; _remember(); _ctx.repaint(); });
  host.appendChild(shut);
  const rs = _readState(l);
  const va = _api.voiceApi();
  const busyRead = VOICE.reading().busy;

  // NO TITLE ROW (the owner, 2026-09-22). The number and the length of the take stand in this
  // line's row on the left, where the eye already is, and `read again` moved into that row's
  // right-click menu - so the column starts with the thing it is about: the words.

  // The words - with their [tags] once the line has them - pressed, open for editing. A take made
  // of other words is stale until the line is read again - or the words are put back, which is
  // the cheap way.
  const shown = String(l.tagged || '').trim() || _words(l);
  if (_editWords === i) {
    const box = el('textarea', 'mv3-wk-ledit is-frag');
    box.value = _wordsDraft;
    box.rows = 3;
    box.addEventListener('input', () => { _wordsDraft = box.value; });
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); _editWords = -1; _ctx.repaint(); }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); _saveWords(va, i); }
    });
    host.appendChild(box);
    const acts = el('div', 'mv3-wk-vfoot is-tight');
    const save = el('button', 'mv3-wk-vuse', 'save');
    save.type = 'button';
    save.title = 'Save the words (Ctrl+Enter)';
    save.addEventListener('click', () => _saveWords(va, i));
    const drop = el('button', 'mv3-wk-vuse', 'cancel');
    drop.type = 'button';
    drop.addEventListener('click', () => { _editWords = -1; _ctx.repaint(); });
    acts.append(save, drop);
    host.appendChild(acts);
    setTimeout(() => { box.focus(); box.setSelectionRange(box.value.length, box.value.length); }, 0);
  } else {
    // The read beside the words (phase V23): not while they are being edited - the words are saved first.
    const row = el('div', 'mv3-wk-fwrow');
    // (phase V26.8, the owner 2026-10-13) MOOD - this line alone marked up by the mood of the video: a line put in
    // between two, or one whose words were changed (a change drops its tags). Red while it has no [tags]: the read is
    // spoken from them, and the voice will not start without them.
    const g = VOICE.reading();
    const marked = !!String(l.tagged || '').trim();
    const mb = el('button', 'mv3-wk-fread' + (marked ? '' : ' is-need'), g.tagging ? 'mood…' : 'mood');
    mb.type = 'button';
    mb.disabled = g.busy || !_video().mood;
    mb.title = !_video().mood ? 'Choose the mood first (field 1)' : g.busy ? 'The voice is busy'
      : marked ? 'Mark this line up again by the mood of the video - its [tags], keeping the arc of the lines around it'
        : 'This line has no [tags] yet: mark it up by the mood of the video - it is read from them';
    mb.addEventListener('click', () => { if (!mb.disabled) { mb.disabled = true; VOICE.tagLine(va, i); } });
    row.appendChild(mb);
    const ra = _readAct(p, l, i);
    const reading = (VOICE.reading().lines || []).includes(i);
    const rb = el('button', 'mv3-wk-fread' + (ra.on ? '' : ' is-off'), reading ? 'reading…' : ra.label);
    rb.type = 'button';
    rb.disabled = !ra.on || reading;
    rb.title = reading ? 'This line is being read' : ra.why ? 'Cannot read now: ' + ra.why
      : (ra.label === 'read' ? 'Read this line in the chosen voice' : 'Read this line again - in place of the take it has');
    if (ra.on) rb.addEventListener('click', () => { if (!rb.disabled) { rb.disabled = true; ra.on(); } });
    row.appendChild(rb);
    // THE LINE'S OWN SPEED and its play, between the read and the words (the owner, 2026-10-10): a new
    // speed retimes this read at once - the timeline and the play follow.
    row.appendChild(_lineSpeed(p, l, i));
    row.appendChild(_playBtn(take && take.path ? take.path : '', 'the read'));
    const words = el('div', 'mv3-wk-fwords is-edit');
    _sayWords(words, shown || '…');
    words.title = 'Change the words' + (shown !== _words(l) ? ' - and the [tags] between them' : '');
    words.addEventListener('click', () => { _editWords = i; _wordsDraft = shown; _ctx.repaint(); });
    row.appendChild(words);
    host.appendChild(row);
    // (phase V26.8) A `mood` or a `read` pressed here that failed says so here, not only in the fields of the whole video.
    const fail = VOICE.failed();
    if (fail) host.appendChild(_note(fail, true));
  }
  if (rs === 'stale') {
    host.appendChild(_note('The words changed after this line was read - read it again, or put the words back.', true));
    const back = el('button', 'mv3-wk-lback is-frag', 'put the words back');
    back.type = 'button';
    back.title = 'Restore the line to what the take says';
    back.disabled = busyRead;
    back.addEventListener('click', () => VOICE.saveText(va, i, take.said));
    host.appendChild(back);
  }

  // Two rows, and each is a picture with the words it is made of beside it (the owner, 2026-09-21):
  // the frame with the prompt it was drawn from, the clip with the animation prompt it will be made
  // from. The pictures on the left, the words to their right (the owner's second look at it).
  const hasFrame = !!_frameFor(p, l, i).v;
  const grid = el('div', 'mv3-wk-fgrid');
  host.appendChild(grid);
  grid.appendChild(_frameCol(p, l, i));
  grid.appendChild(_framePromptCol(p, l, i));
  // The frame picker stands between the two rows: it is about the frame above it.
  const pickHost = el('div', 'mv3-wk-fpickwrap');
  host.appendChild(pickHost);
  _pickRow(pickHost, p, l, i);
  const grid2 = el('div', 'mv3-wk-fgrid');
  host.appendChild(grid2);
  grid2.appendChild(_clipCol(p, l, i, rs, take));
  grid2.appendChild(_motionCol(l, i, hasFrame));

  // Every take the line has, under the grid: a fragment can have a clip per frame it was tried on,
  // and one of them is the fragment's (F4). Pressing a row makes it that one.
  const clips = _clipsOf(p, l);
  if (clips.length) {
    host.appendChild(el('div', 'mv3-wk-flabel', 'takes'));
    const now = _clipOf(p, l, i);
    for (const c of clips.slice().reverse()) {
      const on = !!(now && c.id === now.id);
      const r = el('button', 'mv3-wk-vrow is-take' + (on ? ' is-on' : ''));
      r.type = 'button';
      const stale = !_clipFresh(p, l, i, c);
      r.title = on ? 'This is the fragment\'s clip' + (stale ? ' - stale, chosen by hand' : '')
        : 'Make this the fragment\'s clip - on the timeline too' + (stale ? ', stale as it is' : '');
      if (c.thumb) {
        const img = el('img', 'mv3-wk-vshot');
        img.alt = '';
        img.loading = 'lazy';
        img.src = c.thumb;
        r.appendChild(img);
      }
      r.appendChild(el('span', 'mv3-wk-vname', 'take · ' + (c.dur ? c.dur.toFixed(1) + ' s' : '')));
      if (stale) r.appendChild(el('span', 'mv3-wk-fstale', 'stale'));
      if (on) r.appendChild(el('span', 'mv3-wk-vtag', 'the clip'));
      if (!on) r.addEventListener('click', () => _pickClip(i, c.id));
      host.appendChild(r);
    }
  }
}

// THE WORDS OF A LINE, with the [tags] the mood put between them in GOLD (the owner, 2026-09-22):
// what the line says is what the person wrote, and what is gold is what the tagger added - the
// difference is worth seeing at a glance. Only where the words are READ: the editor is a textarea,
// and a textarea has no coloured pieces.
function _sayWords(host, text) {
  host.appendChild(document.createTextNode('\u201c'));
  const parts = String(text).split(/(\[[^\]]*\])/);
  for (const part of parts) {
    if (!part) continue;
    if (part[0] === '[') host.appendChild(el('span', 'mv3-wk-wtag', part));
    else host.appendChild(document.createTextNode(part));
  }
  host.appendChild(document.createTextNode('\u201d'));
}

// THE PROMPT THIS FRAME WAS DRAWN FROM, beside the picture it made (the owner, 2026-09-21): what
// the engine was actually told - the shot size, the mannequin, the look and the place, and the one
// moment that makes this frame different from the others in the set. Editable, for now: the picture
// is already drawn and does not change, but a redraw of this frame is asked for what is written
// here (routes/scen3.js, /scen3/frames/prompt).
function _framePromptCol(p, l, i) {
  const col = el('div', 'mv3-wk-fcol is-prompt');
  const { v: fr } = _frameFor(p, l, i);
  col.appendChild(_colHead('frame prompt'));
  // The field stands there whether or not there is a frame (the owner, 2026-09-21), so the fragment
  // has the same shape from the first look; with no picture beside it there is nothing to edit, and
  // it says what is missing instead of pretending to take words.
  const box = fr
    ? _textField('f', fr.id, fr.prompt || '', 7,
      'This frame was drawn before the prompt was kept with it.',
      (v) => _saveFramePrompt(p, fr.id, v))
    : _dead(7, _drawing.size
      ? 'The set is being drawn - the prompt of this line’s frame appears with the picture.'
      : 'No frame yet. The set of first frames is made in the general zone - press this fragment again to get there.');
  box.classList.add('is-tall');
  col.appendChild(box);
  return col;
}

// A field that is only there to say what will be in it: same box, same height, no typing.
function _dead(rows, placeholder) {
  const box = el('textarea', 'mv3-wk-ftext-in');
  box.rows = rows;
  box.placeholder = placeholder;
  box.value = '';
  box.disabled = true;
  return box;
}

// A column's heading: a small label, and - on the shot - the one action it has.
function _colHead(label, action) {
  const h = el('div', 'mv3-wk-flabel is-row');
  h.appendChild(el('span', '', label));
  if (action) h.appendChild(action);
  return h;
}

// FRAME - the picture the line opens on: the pool's, in turn, or the one picked by hand; and the
// pool under it to pick from. Pressing the picked one again hands the line back to the rule.
function _frameCol(p, l, i) {
  const col = el('div', 'mv3-wk-fcol is-media');
  col.appendChild(_colHead('frame'));
  const { v: fr } = _frameFor(p, l, i);
  const box = el('div', 'mv3-wk-fmedia' + (fr ? '' : ' is-empty'));
  if (fr) {
    const img = el('img');
    img.alt = '';
    img.src = derived(fr.preview || fr.path, 'card');
    box.appendChild(img);
    box.title = 'Show it on the stage; right-click to open it large';
    box.addEventListener('click', () => { _stagePick = 'frame'; _ctx.repaint(); });
    box.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showPicture({ src: fr.path, name: 'frame ' + (fr.n || ''), rows: fr.prompt ? [['prompt', fr.prompt]] : [] });
    });
  } else {
    box.appendChild(el('span', '', _drawing.size ? 'drawing…' : 'no frames yet'));
  }
  col.appendChild(box);
  // No caption under the picture (the owner, 2026-09-22): whether the frame came from the rule or
  // was picked by hand is already said on the picker bar right below it, and said twice it was just
  // noise. With no frames at all there is nothing to say either - the empty box says it.
  return col;
}

// WHICH FRAME THIS LINE OPENS ON (the owner, 2026-09-21): a thin bar the width of the fragment,
// under the frame and its prompt. Pressed, it drops a list of the frames of the set, one under the
// other; a frame pressed in the list goes onto the stage, and `select` appears in the middle of it -
// that press is what writes it onto the line. The rule (the pool in turn) is the first row.
function _pickRow(host, p, l, i) {
  const pool = _pool(p);
  if (!pool.length) return;
  const { v: fr, auto } = _frameFor(p, l, i);
  const bar = el('button', 'mv3-wk-fpick' + (_picking ? ' is-open' : ''));
  bar.type = 'button';
  bar.title = 'Which frame this fragment opens on';
  bar.appendChild(el('span', 'mv3-wk-fpick-t', fr
    ? (auto ? 'frame ' + (pool.findIndex(v => v.id === fr.id) + 1) + ' of ' + pool.length + ' · from the set, in turn' : 'frame picked by hand')
    : 'no frame yet'));
  bar.appendChild(el('span', 'mv3-wk-fpick-c', _picking ? '▴' : '▾'));
  bar.addEventListener('click', () => { _picking = !_picking; _pickView = ''; _ctx.repaint(); });
  host.appendChild(bar);
  if (!_picking) return;

  const list = el('div', 'mv3-wk-fpicklist');
  // The rule itself, as the first choice: hand the line back to "the pool in turn".
  if (!auto) {
    const back = el('button', 'mv3-wk-fpickrule');
    back.type = 'button';
    back.textContent = 'back to the rule - the set in turn';
    back.addEventListener('click', () => _pickFrame(i, ''));
    list.appendChild(back);
  }
  for (const v of pool) {
    const row = el('div', 'mv3-wk-fpickrow' + (fr && v.id === fr.id ? ' is-on' : '') + (v.id === _pickView ? ' is-seen' : ''));
    const shot = el('button', 'mv3-wk-fpickshot');
    shot.type = 'button';
    shot.title = 'Look at it on the stage';
    const img = el('img');
    img.alt = '';
    img.loading = 'lazy';
    img.src = derived(v.preview || v.path, 'card');
    shot.appendChild(img);
    shot.addEventListener('click', () => { _pickView = _pickView === v.id ? '' : v.id; _ctx.repaint(); });
    row.appendChild(shot);
    if (v.id === _pickView) {
      const sel = el('button', 'mv3-wk-tileact is-pick', fr && v.id === fr.id ? 'this one' : 'select');
      sel.type = 'button';
      sel.title = 'Open this fragment on this frame';
      sel.disabled = !!(fr && v.id === fr.id && !auto);
      sel.addEventListener('click', (e) => { e.stopPropagation(); _pickFrame(i, v.id); });
      row.appendChild(sel);
    }
    list.appendChild(row);
  }
  host.appendChild(list);
}

// The animation prompt: what Kling is told about the expression, the head, the hands and the gaze.
// Written by the agent; a version written by hand stays through the next reading, and the agent's
// own is one press away.
function _motionCol(l, i, hasFrame) {
  const col = el('div', 'mv3-wk-fcol is-motion');
  const sh = l.shot || null;
  let action = null;
  // Nothing to animate until the line has a frame to animate FROM (the owner, 2026-09-21): the
  // field is there, says so, and takes no words yet.
  if (!hasFrame) {
    col.appendChild(_colHead('animation prompt'));
    const dead = _dead(7, 'The clip is made from the frame: this fills in once this line has one.');
    dead.classList.add('is-tall');
    col.appendChild(dead);
    return col;
  }
  // What is worth knowing about this prompt before it is read: written by hand, or written for
  // words the line no longer says (phase W3b - the same staleness the read has).
  const staleWords = !!(sh && sh.motion && !_animated(l));
  if ((sh && sh.motionEdited) || staleWords) {
    action = el('span', 'mv3-wk-fedited-row');
    if (sh && sh.motionEdited) action.appendChild(el('span', 'mv3-wk-fedited', 'edited by hand'));
    if (staleWords) {
      const s = el('span', 'mv3-wk-fstale', 'the words changed');
      s.title = 'It was written for: “' + String(sh.said || '').slice(0, 120) + '”';
      action.appendChild(s);
    }
    if (sh && sh.motionEdited && sh.motionAgent) {
      const back = el('button', 'mv3-wk-flink', 'use the agent’s');
      back.type = 'button';
      back.title = sh.motionAgent;
      back.addEventListener('click', () => { delete _drafts[i + ':motion']; _saveShot(i, { useAgentMotion: true }); });
      action.appendChild(back);
    }
  }
  col.appendChild(_colHead('animation prompt', action));
  const box = _textField(i, 'motion', (sh && sh.motion) || '', 7,
    'How the person moves while speaking - the expression, the head, the hands, the gaze. Written for every'
    + ' line by the video zone; Kling hears nothing else.',
    (v) => _saveShot(i, { motion: v }));
  box.classList.add('is-tall');
  col.appendChild(box);
  return col;
}

// ── The clip of a fragment (phase F4) ───────────────────────────────────────
// The frame speaks the read: the picture, the take and the line's animation prompt go to Kling and
// the SERVER sees it through (routes/scen3.js, /scen3/fragments/clip). This panel only asks and
// follows the row, which is why walking away loses nothing.
const _clipping = new Map();              // line -> { alertId, startedAt }
let _armedClip = -1;                      // the line whose `make clip` was pressed once
const CLIP_ESTIMATE_MS = 150000;

async function _makeClip(p, i) {
  if (_clipping.has(i)) return;
  _readErr = '';
  _clipping.set(i, { alertId: '', startedAt: Date.now() });
  _ctx.repaint();
  try {
    const r = await _post('/api/scen3/fragments/clip', { projectId: p.id, line: i, where: _whereLine(i) });
    if (r.skipped) {
      _readErr = 'Fragment ' + (i + 1) + ': ' + r.skipped;
      _clipping.delete(i);
      return _ctx.repaint();
    }
    _clipping.set(i, { alertId: r.alertId, startedAt: Date.now() });
    await _followClip(i, r.alertId);
  } catch (e) {
    _readErr = 'The clip was not asked for: ' + e.message;
    _clipping.delete(i);
    _ctx.repaint();
  }
}

async function _followClip(i, alertId) {
  try {
    // The row says what it is doing (V2): the two analyses before the render, then the render. The
    // fragment repeats it under its button rather than sitting on "making…" for half a minute.
    await API.follow(alertId, (rec) => {
      const at = _clipping.get(i);
      if (!at || at.stage === (rec.stage || '')) return;
      _clipping.set(i, { ...at, stage: rec.stage || '' });
      if (_ctx) _ctx.repaint();
    });
    if (_ctx && _ctx.reloadProject) await _ctx.reloadProject();
  } catch (e) {
    if (!_dropped.has(alertId)) _readErr = 'Fragment ' + _no(((_ctx && _ctx.project && _ctx.project.lines) || []), i) + ': the clip failed - ' + e.message;
  }
  _dropped.delete(alertId);
  const was = _clipping.get(i);
  if (was && was.startedAt) _paceSaw('clip', Date.now() - was.startedAt);    // the next estimate (N3)
  _clipping.delete(i);
  if (!_clipping.size) endProgress('clip', _readErr ? _readErr : undefined);
  if (_ctx) _ctx.repaint();
}

// Where a clip was asked from, for the Alerts list: this fragment of this project.
function _whereLine(i) {
  const key = (_ctx && _ctx.key) || '';
  const p = (_ctx && _ctx.project) || {};
  return {
    page: 'merge',
    href: '/merge?p=' + encodeURIComponent(key) + '&step=setup&line=' + (i + 1),
    // The label is what a person reads in the journal, so it says the fragment's place in the
    // VIDEO; the address and `spot` keep the real index, which is what the panel opens by.
    label: 'Merge · ' + String(p.title || p.name || 'talking head') + ' · fragment ' + _no(p.lines || [], i),
    spot: { key, step: 'setup', line: i + 1 },
  };
}

// A clip of this project already running - started before a reload, or from another tab.
function _pickUpClips() {
  const key = (_ctx && _ctx.key) || '';
  if (!key || _lookedClips === key) return;
  _lookedClips = key;
  API.alerts().then((d) => {
    for (const r of (d && d.items) || []) {
      const spot = (r.where && r.where.spot) || {};
      const i = (Number(spot.line) || 0) - 1;
      if (r.state !== 'running' || r.what !== 'clip' || spot.key !== key || i < 0 || _clipping.has(i)) continue;
      _clipping.set(i, { alertId: r.id, startedAt: Date.parse(r.startedAt) || Date.now(), stage: r.stage || '' });
      _followClip(i, r.id);
    }
    if (_ctx) _ctx.repaint();
  }).catch(() => { /* without the list, nothing shows as running */ });
}
let _lookedClips = '';

async function _pickClip(i, clipId) {
  const p = _ctx && _ctx.project;
  if (!p) return;
  try { _adopt(await _post('/api/scen3/fragments/pick-clip', { projectId: p.id, line: i, clipId })); }
  catch (e) { _readErr = 'Could not pick that clip: ' + e.message; }
  _ctx.repaint();
}

// CLIP - the frame speaking the read, in the frame's column. What stops it, or what it costs, is
// said under the button.
function _clipCol(p, l, i, rs, take) {
  const col = el('div', 'mv3-wk-fcol is-media');
  col.appendChild(_colHead('clip'));
  const c = _clipOf(p, l, i);
  const box = el('div', 'mv3-wk-fmedia' + (c && c.thumb ? '' : ' is-empty'));
  if (c && c.thumb) {
    const img = el('img');
    img.alt = '';
    img.src = c.thumb;
    box.appendChild(img);
  } else {
    box.appendChild(el('span', '', _clipping.has(i) ? 'making…' : 'no clip'));
  }
  // The cross, while this fragment's clip is being made (N1): the longest wait in the workshop,
  // and the one most worth being able to walk away from.
  if (_clipping.has(i)) box.appendChild(_dropX((_clipping.get(i) || {}).alertId, 'this clip'));
  if (c && c.thumb) {
    // Pressed, it goes ON the stage - it does not start (the owner, 2026-09-22). A thumbnail picks
    // which of the two the stage shows, the frame or the clip, and nothing else; PLAYING is a press
    // on the stage itself, where the film actually is. It used to be both, so switching frame and
    // clip re-started the video every time. The window is still on the right button, for looking at
    // one frame of it closely.
    box.title = 'Show it on the stage; press the stage to play it. Right-click to open it large';
    box.addEventListener('click', () => { _stagePick = 'clip'; _ctx.repaint(); });
    box.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showPicture({ src: c.thumb, name: 'clip of fragment ' + _no((p.lines || []), i), rows: [['seconds', c.dur ? c.dur.toFixed(1) : ''], ['said', c.said || '']] });
    });
  }
  col.appendChild(box);
  const fr = _frameFor(p, l, i).v;
  const tier = _tier();
  const busy = _clipping.has(i);
  let cap;
  let ready = false;
  if (rs !== 'ok') cap = 'read this line first';
  else if (!fr) cap = 'make the frames first';
  else if (!_video().model) cap = 'choose the model of the clips first (field 4)';
  else if (!_video().quality) cap = 'choose the quality of the clips first (field 4)';
  else if (_seedance()) cap = 'Seedance clips are still being built - choose kling avatar to film now';
  else if (take.dur > _ceiling()) cap = 'too long for Kling (' + take.dur.toFixed(1) + ' s) - split the line';
  else { ready = true; cap = take.dur.toFixed(1) + ' s · ' + (tier ? _money(_clipCost(take.dur, tier)) : '…'); }
  const price = ready && tier ? _money(_clipCost(take.dur, tier)) : '';
  // The one paid press in a fragment: the price first, the clip on the second press.
  const make = el('button', 'mv3-wk-vmore is-small is-media' + (ready ? ' is-go' : ''),
    busy ? 'making…' : _armedClip === i ? price + '?' : c ? 'again' : 'make clip');
  make.type = 'button';
  make.disabled = !ready || busy;
  // What the press will actually do: with nothing written yet it is two analyses and then the
  // clip, and that is worth saying before it takes half a minute (phase U4).
  const needsWords = !_animated(l) || !_envMotion(p);
  make.title = !ready ? cap
    : (needsWords ? 'First the analysis - how this place moves and how the person moves on this line - then the clip. ' : '')
      + 'Kling avatar: this frame speaks this read, moving as the animation prompt says. '
      + take.dur.toFixed(1) + ' s - billed ' + _billSecs(take.dur) + ' whole s at ' + (tier ? '$' + tier.pricePerSec + '/s' : '?') + '. Press again to confirm.';
  make.addEventListener('click', () => {
    if (_armedClip !== i) { _armedClip = i; _ctx.repaint(); return; }
    _armedClip = -1;
    _makeClip(p, i);
  });
  col.appendChild(make);
  // While it runs, the caption is the journal's own stage - "analysis 1/2 - the place", then
  // "rendering" - so the half-minute before anything is sent to Kling is not silence (V2).
  const stage = busy ? String((_clipping.get(i) || {}).stage || '') : '';
  col.appendChild(el('div', 'mv3-wk-fcap' + (ready ? '' : ' is-why'),
    busy ? (stage || 'making the clip…') : (ready && needsWords) ? 'analysis, then ' + cap : cap));
  return col;
}

// The words of the open line, saved from the editor above the grid.
async function _saveWords(va, i) {
  const text = _wordsDraft;
  _editWords = -1;
  await VOICE.saveText(va, i, text);
}

// A text field that survives a repaint (what is typed is kept by line and field) and saves when the
// person leaves it, not on every key.
function _textField(i, field, value, rows, placeholder, save) {
  const k = i + ':' + field;
  const box = el('textarea', 'mv3-wk-ftext-in');
  box.rows = rows;
  box.placeholder = placeholder;
  box.value = k in _drafts ? _drafts[k] : value;
  box.addEventListener('input', () => { _drafts[k] = box.value; });
  box.addEventListener('change', () => {
    const v = box.value;
    delete _drafts[k];
    if (v.trim() !== String(value || '').trim()) save(v);
  });
  return box;
}

// ── The stage's picture ─────────────────────────────────────────────────────
// The open fragment: its clip when it has one (the poster, until the clips phase plays it), else
// its frame. With neither - or with no fragment open - nothing: the step then shows the casting
// pair with its doors (js/merge-v3/wk-setup.js, _stage).
export function openPicture(p) {
  const lines = (p && Array.isArray(p.lines)) ? p.lines : [];
  const l = _open >= 0 ? lines[_open] : null;
  // A frame being looked at in the picker wins while the list is down: that is the question on
  // screen (the owner, 2026-09-21).
  if (l && _picking && _pickView) {
    const fr = _pool(p).find(v => v.id === _pickView);
    if (fr) return { src: derived(fr.preview || fr.path, 'main'), caption: 'frame ' + (fr.n || '') + ' · press select to keep it' };
  }
  // (phase V26.5) A frame of the frames chat pressed: on the stage while the chat shows.
  if (!l && _chatPick) return { src: derived(_chatPick.path, 'main'), caption: _chatPick.name || 'frame from the chat' };
  if (!l) {
    // No line open: a frame of the pool pressed in the general zone, if one is. The WHOLE strip is
    // searched, switched-off frames included - a dimmed frame pressed is still a frame being looked
    // at, and it can be reframed like any other.
    const fr = _setPick ? _poolAll(p).find(v => v.id === _setPick) : null;
    if (!fr) return null;
    // Being reframed: the selection on the picture, and `apply` / `cancel` along its foot. Otherwise
    // the one act a frame has on the stage - `crop`.
    const cut = _cropOn === fr.id;
    return {
      src: derived(fr.preview || fr.path, 'main'),
      caption: cut ? '' : 'frame' + (fr.n ? ' ' + fr.n : ''),
      crop: cut ? { aspect: _formatAspect(p) } : null,
      actions: cut
        ? [
          { label: _cropBusy ? 'cutting…' : 'apply', go: true, busy: _cropBusy,
            title: 'Cut the picture to the selection. The cut joins the set, beside this frame, and is saved in the project.',
            on: (rect) => _cropApply(p, fr, rect) },
          { label: 'cancel', busy: _cropBusy, title: 'Leave the frame as it is', on: () => { _cropOn = ''; _ctx.repaint(); } },
        ]
        : [{ label: 'crop', title: 'Reframe this picture - drag a selection, and the cut joins the set as a frame of its own. It keeps the format of the project.',
          on: () => { _cropOn = fr.id; _ctx.repaint(); } }],
    };
  }
  const c = _clipOf(p, l, _open);
  const fr = _frameFor(p, l, _open).v;
  const name = 'fragment ' + _fragNo(p, lines, _open);
  // The clip, as a film with its own sound, unless the frame was asked for (X4).
  if (c && c.path && _stagePick !== 'frame') {
    // What stands on the stage while the video opens (Z5): the clip's own poster, or - a clip
    // filed before posters - the frame it was made from.
    const poster = c.thumb || (fr ? derived(fr.preview || fr.path, 'main') : '');
    return { film: c.path, caption: name + ' · clip', poster };
  }
  if (fr) return { src: derived(fr.preview || fr.path, 'main'), caption: name + (c ? ' · frame' : '') };
  if (c && c.thumb) return { src: c.thumb, caption: name + ' · clip' };
  return null;
}

/** Leaving the step stops the read that was playing, and drops what was hanging over the list. */
export function leave() {
  if (_audio) { _audio.pause(); _playing = ''; }
  _tipHide();
  _closeMenu();
}
