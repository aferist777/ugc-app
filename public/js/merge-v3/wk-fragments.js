/* ════════════════════════════════════════════════════════════════════════════
   MERGE — the script of a talking head, line by line: the READ, the FRAME and the CLIP of
   every line (docs/local-app/PLAN.md, "Fragments — полный план по фазам", and phase M of
   "Сцена, setup и таймлайн-зеркало").

   The hub of the setup step (js/merge-v3/wk-setup.js), painted into its panel. Two columns: on
   the left the whole script, one row per line with what it has - the read, the frame, the clip;
   on the right the line that is open, with everything made for it - or, with none open, the
   GENERAL ZONE. Since phase V61 (the owner 2026-10-30: "нужно чтобы пошагово создавался проект") its fields OPEN ONE
   AFTER ANOTHER: until the character and the place are chosen on the stage they are blurred and take no press (the
   script is there to be read, its rows do nothing); then 1 "mood & voice" - one line, one `generate` that marks the
   script up and reads it -; 2 the frames - the set the lines take theirs from, and the door to the FRAMES CHAT, a window
   (js/merge-v3/fchat.js) - and 3 the video, red until every line is read (_voiceLock). No counters, no `generate all`: a
   project is made step by step, its frames asked for in words. The list never goes away while a line is open: the script is one
   thing, and judging a line means seeing the ones around it. Who and where are on the stage, not here.

   THE READ (V3, moved in here in M; v3 only since W1). A line is spoken from the open line's own
   button - tagged by the mood first - and its words can be changed there too, tags and all; a take
   made of other words is stale until the line is read again or the words are put back. The
   speaking itself is js/merge-v3/wk-voice.js.

   THE FRAMES are a SET for the whole video, not a frame per line - made in the frames chat, each with the edge it was
   asked with (`framing`); an older project's may be a set an agent planned before phase V61. THE LINES TAKE FROM THE POOL IN TURN
   (_frameFor): the first line the first frame, the second the second, round again - or, ticked "scattered", one drawn for
   each line - until a line is given a frame by hand, which it keeps.

   THE ANIMATION of a line - the prompt the video model hears - is written by the video stage (W3)
   and edited here; a prompt written by hand survives the next pass. The CLIPS are asked for here
   too - Kling avatar's, or a Seedance model's - and the server sees each through (routes/scen3.js).

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
import { askDelete, note as askNote } from '../ask.js';
import { hint } from '../bubble.js';
import { el, holdProgress, endProgress, onlyHere, showPicture, softScroll } from './wk-maker.js';
import * as FCHAT from './fchat.js';
// (phase V62) The voiceover draft's script, chosen in its script column.
import * as VOS from './vo-script.js';
// (phase V73 block 5, 5d) Lucide's icons in place of the signs, the figures in mono, "4,500".
import { icon, iconEl } from '../icons.js';
import { figures, int } from '../num.js';

// A word as a label shows it: sentence case ((к17)) - the words in the code stay as they are.
const _cap = (s) => { const t = String(s == null ? '' : s); return t.charAt(0).toUpperCase() + t.slice(1); };

// The one ceiling a read has for the chosen model, from its quality (lib/th-video.js: Kling avatar's
// tiers, Seedance's lengths) - read from the kit when it has arrived, this only until then.
const CEILING_FALLBACK = 30;

const KEY = 'mv3_frag_open_v1';          // { <timeline key>: <open line> } - where you were, per project
// HOW WIDE THE SCRIPT COLUMN IS (phase R, the owner 2026-09-22). The two columns of this step are
// rebuilt on every repaint, so the width cannot live in the DOM; it lives here and is put back
// after each paint, the way the columns' scroll offsets are. 0 means "never dragged" - the CSS
// default then stands. Kept like the shell's two sashes, in a plain key the server mirrors.
const SPLIT_KEY = 'mv3_wk_split';
const SPLIT_MIN = 190;                   // narrower than this a line of script is unreadable
const SPLIT_PART = 0.62;                 // ...and the fields keep at least the rest
let _splitW = (() => { try { return parseInt(localStorage.getItem(SPLIT_KEY) || '', 10) || 0; } catch (e) { return 0; } })();

let _ctx = null;
let _api = null;                          // what the step lends: the voice module's api
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
let _kit = null;                          // the models with their qualities, Seedance's sounds and the moods, read once
let _kitState = 'idle';
let _saving = false;
let _said = '';
let _listAt = 0;                          // where the list stood, put back after every repaint
let _readErr = '';
const _drafts = {};                       // text being typed, by "<line>:<field>" - a repaint keeps it
// What is known about the places on the shelf, by address (routes/scen3.js, /scen3/env-meta): the
// description, and - phase W3a - how the place MOVES. Read once; what is written is put into it from
// the answer. The animation belongs to the place, so it is the same map for every project.
let _envMeta = null;
let _envWriting = false;
let _armedVideo = false;                  // ...and the video zone's, which pays for the clips
let _dragging = '';                       // the frame being dragged along the strip
let _picking = false;                     // the open fragment's frame list is down
let _pickView = '';                       // ...and the frame being looked at in it, on the stage
let _setPick = '';                        // a frame of the pool pressed in the general zone: shown on the stage
// (phase V26.5) The frames chat: a frame of it pressed - on the stage - and whether the script is folded away beside it.
// WHICH OF THE TWO THE OPEN FRAGMENT IS SHOWING (phase X4, the owner 2026-09-22): its clip, playing,
// or its frame. The clip when there is one, because that is the thing that was just made; pressing
// the frame moves the stage to it, and pressing the clip brings it back. Forgotten when another
// fragment is opened - each is looked at on its own terms.
let _stagePick = '';                      // '' | 'clip' | 'frame'
let _stageFor = -2;                       // the fragment _stagePick belongs to

// ── HOW LONG THIS USUALLY TAKES (phase N, the owner 2026-09-23) ─────────────
// Two of the four fields cannot count their own progress - the tagging is ONE call to an agent,
// and a single line being spoken is one call to ElevenLabs - so their border fills by an estimate.
// An estimate that never learns is a lie the second time, so a finished clip leaves its
// length here and the next one is drawn from the last few; the tagging and a read keep their first
// guesses (_paceFirst). It is an observation of how fast the world is today, not a setting, and
// nothing else should read it (storage-sync.js mirrors it to the server like any other key).
const PACE_KEY = 'mv3_pace_v1';
const PACE_KEEP = 5;
// Read when they are asked for, not at load: a clip's estimate is declared with the clips, far
// below this, and naming it here would be reaching into its dead zone.
const _paceFirst = (kind) => (kind === 'tag' ? 20000 : kind === 'read' ? 9000
  : kind === 'clip' ? CLIP_ESTIMATE_MS : 30000);
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
// The same rules the server applies when it lays the timeline (lib/frag-mirror.js, _readOf): a read or a
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
// still in the project and still on the strip, but no line takes it. `mix.banned` holds them
// (routes/scen3.js, /scen3/frames/ban).
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
  // (phase V26.8) By the number the line KEEPS when one was put in above it (routes/scen3.js, /line/insert), else by its
  // place in the list.
  const n = l && Number.isInteger(l.slot) ? l.slot : i;
  const at = spread === 'random' ? _seed(String((p || {}).id || '') + ':' + n) % pool.length : n % pool.length;
  return { v: pool[at], auto: true };
}
// THE CLIP OF A LINE is the one made from the frame the line OPENS ON - which is the frame it was
// given by the rule as often as one picked by hand (phase F4; before the clips existed this read
// `frameId`, which is empty for every line the pool serves in turn, and would have called every
// such line clip-less for ever).
// WHICH VARIANT THIS PROJECT IS IN. A project read with tags (every Merge project since W1) keeps
// its clips under `tagged` and remembers the words WITH the tags in them; a project read before
// that keeps them under `plain`. The server files by this rule; the timeline mirror picks the variant
// by the LINE instead - tagged when the line has tags (lib/frag-mirror.js, _clipOf). This panel used
// to read `plain` and compare against the untagged words - so a clip that had been made, filed,
// journalled and laid on the timeline was invisible in the fragment that paid for it (the owner, 2026-09-22).
const _variant = (p) => (((p || {}).voice || {}).variant === 'tagged' ? 'tagged' : 'plain');
const _saidOf = (p, l) => (_variant(p) === 'tagged' ? String((l && l.tagged) || '') : String((l && l.text) || ''));
// (phase V26.8) A Seedance project shows none of the Kling clips it may have - the timeline lays none of them either
// (lib/frag-mirror.js); it shows the line's Seedance takes (part 5).
const _sdFragOfLine = (p, l) => _sdFragOf(p, ((p && p.lines) || []).indexOf(l));
const _clipsOf = (p, l) => (_seedance() ? ((_sdFragOfLine(p, l) || {}).clips || []) : (((l && l.video) || {})[_variant(p)] || []));

// (phase V23, the owner 2026-10-09) A clip CHOSEN BY HAND in the takes is the line's clip whatever it was made
// from - the timeline lays it too (lib/frag-mirror.js) - and the line counts as settled: making the project's clips
// leaves it (routes/scen3.js, _clipDone).
// A new clip or a new read clears the choice (routes/scen3.js).
const _chosenOf = (p, l) => {
  if (_seedance()) { const f = _sdFragOfLine(p, l); return f && f.chosen ? f.clip : null; }
  const id = String(((l && l.chosen) || {})[_variant(p)] || '');
  return id ? (_clipsOf(p, l).find(c => c.id === id) || null) : null;
};
function _clipOf(p, l, i) {
  if (_seedance()) return (_sdFragOf(p, i) || {}).clip || null;     // (V26.8) chosen by hand, else the newest fresh
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
  if (_seedance()) return !!c.fresh;      // (V26.8) of the frame, the words and the read the line has now (routes/scen3.js _sdFresh)
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
    b.innerHTML = icon(is ? 'pause' : 'play', 10);
    b.classList.toggle('is-playing', !!is);
  });
}
// `then` is what the row hands over: the read it plays belongs to a fragment, and pressing play is
// a way of saying "this one" (Y5). The press does NOT reach the row - it would close an open
// fragment - so the opening is done here instead.
function _playBtn(src, what, then) {
  const b = el('button', 'mv3-wk-vplay is-read u-btn is-s is-icon');
  b.innerHTML = icon('play', 10);
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

// ── The kit: the models and their qualities, the moods ──────────────────────
function _loadKit(repaint) {
  if (_kitState !== 'idle') return;
  _kitState = 'loading';
  const get = (u) => fetch(u).then(r => r.json()).catch(() => null);
  get('/api/scen3/motion-presets').then((m) => {
    _kit = {
      // (phase V26.8) The models of the clips, each with its qualities - Kling avatar and the Seedances - and
      // Seedance's ways of voicing a clip (lib/th-video.js). A server started before V26.8 answers Kling's qualities
      // alone: they are Kling's model, so the field still works until the app is restarted.
      models: (m && m.models) || (m && m.qualities ? [{ id: 'kling', label: 'Kling avatar', family: 'kling', qualities: m.qualities }] : []),
      sounds: (m && m.sounds) || [],
      moods: (m && m.moods) || [],
    };
    _kitState = 'done';
  }).finally(() => repaint());
}

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

// Written by the agent (the field to write it by hand went in V26.8). The answer is the entry the store now holds,
// and the map is put right without reading the whole shelf again.
async function _writeEnvMotion(p) {
  const path = _place(p);
  if (!path || _envWriting) return;
  _envWriting = true;
  _readErr = '';
  _ctx.repaint();
  try {
    const r = await _post('/api/scen3/env/motion', { path });
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
  // (phase V26.8, part 5) A line filmed by Seedance: billed by the whole seconds asked for, its read rounded up
  // (lib/sd-prompt.js clipSecs).
  if (_seedance()) {
    const f = _sdFragOf(p, i);
    if (!f || f.noRead || f.tooLong || !f.frameId || !((p.casting || {}).obrazImage)) return null;
    // By the voice sample the length is Seedance's (-1): no price (the owner's answer (я10)).
    return f.secs > 0 ? { dur: f.secs, cost: f.secs * ((tier && tier.pricePerSec) || 0) } : { dur: 0, cost: 0, auto: true };
  }
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
async function _makeClips(p) {
  try {
    const r = await _post('/api/scen3/fragments/clips', { projectId: p.id, key: (_ctx && _ctx.key) || '' });
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
  // (phase V26.8) The animation prompts and the clips here are Kling's; a Seedance project writes its fragments' own.
  if (_seedance()) return _writeSdVideo(p, opts);
  const withClips = !!(opts && opts.clips);
  _readErr = '';
  if (!_envMotion(p)) {
    _writing = 'place';
    _writeAt = Date.now();
    await _writeEnvMotion(p);
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
    const want = _clipWork(now, Array.isArray(now.lines) ? now.lines : lines);
    if (want.length) {
      _writing = 'clips';
      _ctx.repaint();
      await _makeClips(now);
    }
  }
  _writing = '';
  _writeAt = 0;
  _ctx.repaint();
}

// (phase V26.8) THE VIDEO FIELD'S `generate` FOR SEEDANCE: how the place moves, when nothing is written for it, then the
// prompt of every line that needs one - one request each, a few at once - then, asked with `clips`, the clips of the
// lines that have none (part 5).
async function _writeSdVideo(p, opts) {
  const withClips = !!(opts && opts.clips);
  _readErr = '';
  if (!_envMotion(p)) {
    _writing = 'place';
    _writeAt = Date.now();
    _ctx.repaint();
    await _writeEnvMotion(p);
    if (_readErr) { _writing = ''; return _ctx.repaint(); }
  }
  if (_sdNeeds(_ctx.project || p).length) {
    _writing = 'lines';
    if (!_writeAt) _writeAt = Date.now();
    _ctx.repaint();
    await _writeSd(_ctx.project || p, null);
  }
  if (withClips && !_readErr) {
    const now = _ctx.project || p;
    const want = _clipWork(now, Array.isArray(now.lines) ? now.lines : []);
    if (want.length) {
      _writing = 'clips';
      _ctx.repaint();
      await _makeClips(now);
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
  const b = el('button', 'mv3-wk-letgo u-onpic is-del u-x', '');
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

// (phase V67, second round (в), the owner 2026-11-01: "при просмотре кадра в превью, клик в любом другом месте должен снимать с
// кадра выделение и показывать Who/where"; (об10) "оба снимать", (об11) a crop under way goes as `cancel`) A PRESS AWAY lets go
// of what the stage shows - the set's frame pressed in field 2, and the open fragment - and the stage has its halves, who and
// where, again. Not a press on the stage itself (the frame, its crop, the clip that plays there), on a frame of the set (its own
// press shows it), on a row of the script (its own press opens or shuts it), in the open fragment, on the sash or a scrollbar,
// or with anything on top (a window, a menu, a question - Layers). On the click, after it has done its own work: a press that
// repainted at once would lose the button it was on. A talking head's only - a voiceover's stage has no halves.
const _isOpen = () => Number.isInteger(_open) && _open >= 0;
function _awayFromPick(e) {
  if (e.button !== 0 || !_ctx || !_ctx.project || _isVo(_ctx.project)) return;
  if (!_setPick && !_isOpen()) return;
  if (_cropBusy || Layers.blocked()) return;
  const t = e.target;
  const half = document.querySelector('.mv3-wk-half.is-frag');
  if (!(t instanceof Element) || !half || !half.getClientRects().length) return;   // setup is not on screen
  if (t.clientWidth && e.offsetX > t.clientWidth) return;            // the scrollbar of what was pressed
  if (t.closest('#mv3-stage, .mv3-wk-fsetfr, .mv3-wk-frow, .mv3-wk-sash')) return;
  if (_isOpen() && t.closest('.mv3-wk-half.is-frag')) return;
  const key = _key;
  setTimeout(() => {
    if (_key !== key || !_ctx) return;
    if (!_setPick && !_isOpen()) return;
    _setPick = '';
    _cropOn = '';
    if (_isOpen()) { _open = -1; _picking = false; _pickView = ''; _stagePick = ''; _remember(); }
    _ctx.repaint();
  }, 0);
}
try { document.addEventListener('click', _awayFromPick, true); } catch (e) { /* no document */ }

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

// The ✕ / ✓ in the corner of a frame of the set: out of the rotation, and back into it.
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
// (the sixth round) Filmed by Seedance FROM THE VOICE'S SAMPLE: nothing is read - the voice field only chooses the voice -
// and Seedance picks each clip's length, so no price is said beforehand (the owner's answer (я10)).
const _bySample = () => _seedance() && (_video().sound || 'read') === 'sample';

// THE VOICE'S DEMO, BY THE VOICE SAMPLE (the sixth round, the owner's answer (я7): "генерируем демку после выбора голоса.
// Кнопка генерации недоступна пока демка не готова ... всплывашку сделаем что демо голоса генерируется"). The server says
// whether the voice has one (`castVoice.demo`); one without is asked for at once (routes/scen3.js /scen3/voice/demo -
// ElevenLabs, about ten seconds), once per voice in this page - a failure says so in the voice field, with a way to ask
// again. While it is missing the voice field is red and the clips wait.
let _demoFor = '';                        // the voice whose demo is being made now
let _demoAsked = '';                      // ...the last one asked for (not asked again by itself)
let _demoErr = '';
const _demoMissing = (p) => {
  const cv = (p && p.castVoice) || {};
  return _bySample() && !!cv.has && !cv.demo;
};
function _demoWanted(p) {
  if (!_demoMissing(p) || _demoFor) return;
  const id = String(p.castVoice.id || '');
  if (!id || _demoAsked === id) return;
  _askDemo(p);
}
async function _askDemo(p) {
  const id = String(p.castVoice.id || '');
  _demoFor = id;
  _demoAsked = id;
  _demoErr = '';
  _demoPopup(true);
  _ctx.repaint();
  try { _adopt(await _post('/api/scen3/voice/demo', { projectId: p.id })); }
  catch (e) { _demoErr = 'The voice demo was not made: ' + e.message; }
  _demoFor = '';
  _demoPopup(false);
  _ctx.repaint();
}
// The popup: over the page's foot, gold, while the demo is being made. It takes no keys and no presses.
let _demoPop = null;
function _demoPopup(on) {
  if (!on) { if (_demoPop) { _demoPop.remove(); _demoPop = null; } return; }
  if (_demoPop) return;
  _demoPop = el('div', 'mv3-wk-popup', 'The voice demo is being made - about ten seconds. Seedance takes the voice from it; the clips wait for it.');
  _demoPop.setAttribute('role', 'status');
  document.body.appendChild(_demoPop);
}
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
    // (phase V26.8, the owner 2026-10-14) What the server works out from these settings comes with them: every line's
    // Seedance prompt - written for these settings or not - and how long the model takes. Taking only `video` left the
    // old state on screen until a reload.
    p.sdFrags = r.project.sdFrags;
  } catch (e) {
    _said = 'Could not save it: ' + e.message;
  }
  _saving = false;
  _ctx.repaint();
}

// ── The panel ───────────────────────────────────────────────────────────────
// `host` is the step's scroll box, under its title; `api` is what the step lends - the voice
// module's api.
export function paint(host, ctx, api) {
  _ctx = ctx;
  _api = api;
  const p = ctx.project;
  if (!p) { host.appendChild(_note('Reading the project…')); return; }
  if (_kit === null) _loadKit(ctx.repaint);
  _demoWanted(p);
  const lines = Array.isArray(p.lines) ? p.lines : [];

  // Which fragment is open: the address first (it is the newer instruction), then where this
  // project was left, then the general zone.
  if (_key !== ctx.key) { _key = ctx.key; _open = null; _listAt = 0; _editWords = -1; _inserting = -1; _insDraft = ''; _rightAt.clear(); FCHAT.close(); }
  _bars.length = 0;                       // the fields are built fresh; so is the list of bars (N3)
  if (_open === null) _open = _asked >= 0 ? _asked : _remembered();
  _asked = -1;
  if (_open >= lines.length) _open = lines.length ? 0 : -1;
  // A line taken off (Z4) has no fragment to open: the general zone is where that press lands.
  if (_open >= 0 && !isLive(lines[_open])) _open = -1;
  if (_stageFor !== _open) { _stageFor = _open; _stagePick = ''; }

  host.classList.add('is-split');
  // (phase V61) The frames chat is a WINDOW over the page now (js/merge-v3/fchat.js) - it no longer stands where the fields
  // stand, and the script beside them never folds away.
  const left = el('div', 'mv3-wk-half is-frags');
  host.appendChild(left);
  host.appendChild(_splitSash(host, left));
  if (_inserting >= lines.length) _inserting = -1;
  // (phase V62, the owner 2026-10-31: "давай добавим центральному полю такую же золотую обводку как и столбце со сценариями")
  // A voiceover's fields stand in a gold frame, as its script does, once there is a script to read - before, they are blurred.
  const right = el('div', 'mv3-wk-half is-guide is-frag' + ((_open >= 0 || _inserting >= 0) ? ' has-close' : '')
    + (_isVo(p) ? ' is-vo' + (_live(lines).length ? ' is-lit' : '') : ''));
  host.appendChild(right);
  _applySplit(host, left);
  _keepScroll(right, 'r' + _open);

  _pickUpClips();
  VOICE.pickUpRead(api.voiceApi());       // a read the SERVER is doing, started before this paint (X2)
  // The list is the script and nothing else (owner, 2026-09-21): the voice stands in its own field
  // on the right, with everything else that is set once for the whole video.
  // (phase V61, (т2)) Until the character and the place are chosen the script is there to be read - every word of it - and
  // its rows do nothing: no fragment opens, nothing is read or put in.
  _list(left, p, lines);
  if (_missing(p).length) left.classList.add('is-locked');
  // The frames chat's window, when open, takes the project as it is now (the casting may have changed).
  FCHAT.update(p);
  // (phase V61, (т9)) No counters and no `generate all` in a header any more - the setup has no header of its own; the
  // fields go one after another, each opening when the one before it has done its work.
  _notes(right);
  // (phase V62) A voiceover draft with no script yet still has its fields - blurred until there is one (_all; the owner 2026-10-31).
  if (!lines.length && !_isVo(p)) {
    right.appendChild(_note('This project has no lines. A talking head takes its script when it is made - a scenario or your own text.'));
    return;
  }
  if (_inserting >= 0) _insertEditor(right, p, lines);
  else if (_open < 0) _all(right, p, lines);
  else _fragment(right, p, lines[_open], _open);
  // The countdown belongs to whatever is being made where you are looking: the clip of the open
  // fragment.
  // The read that is playing keeps its ❚❚ (Y5). The buttons are built fresh by every paint and the
  // audio element is not, so without this a repaint - and pressing play is now one - draws every
  // button idle while the sound goes on.
  _mark();
  const mine = _open >= 0 ? _clipping.get(_open) : null;
  const place = mine ? 'clip' : null;
  onlyHere(place);
  if (place) holdProgress(place, { label: 'Making the clip', estimateMs: CLIP_ESTIMATE_MS, startedAt: mine.startedAt });
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

// (phase V61, the owner 2026-10-30: "кнопка с открытием чата для создания frames давай будет открывать попап с чатом для
// создания фреймов"; (т7) - as New Character) THE FRAMES CHAT, A WINDOW over the page for this project (js/merge-v3/fchat.js).
// A frame's ⤢ there opens it large (V91 block 3); a frame put into the set lands on the frames field.
export function openChat() {
  const p = _ctx && _ctx.project;
  if (!p) return;
  FCHAT.open(p, {
    added: (project) => { _adopt({ project }); _ctx.repaint(); },
  });
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
  if (_isVo(p)) return out;                          // (phase V62) a voiceover has nobody and nowhere to choose
  if (!cast.obrazImage) out.push('a character in a look');
  if (!cast.locationImage) out.push('an environment');
  return out;
}
// Is there a voice to read in - the character's, or the project's own pick? The same rule the
// server applies (routes/scen3.js, _castVoice), read here from what the panel holds, because a
// voice just taken is on the character record and the project copy before either is read again.
const _canRead = () => !!(_api && VOICE.canRead(_api.voiceApi()));

// WHAT IS NOT CHOSEN YET (phase V24, the owner 2026-10-09): a field with a choice still to make wears
// a RED dashed frame instead of the gold one, and nothing is paid for until it is made. A project
// made since starts at none - the mood, the model, the quality (routes/scen3.js _normVideo) - and the
// voice is missing while neither the character nor the project has one. Read from the project alone.
function _needs(p) {
  const v = (p && p.video) || {};
  const out = {};
  if (!v.mood) out.mood = 'a mood';
  if (!_canRead()) out.voice = 'a voice';
  // (the sixth round) By the voice sample the voice is there once its demo is (the owner's answer (я7)).
  else if (_demoMissing(p)) out.voice = 'a voice with its demo';
  // (phase V26.8) The model first - Kling avatar or a Seedance - then the quality it makes. (phase V62) A voiceover makes no clips.
  if (_isVo(p)) return out;
  if (!v.model) out.video = 'the model';
  else if (!v.quality) out.video = 'the quality';
  return out;
}
// (phase V62) A VOICEOVER: the script in a voice - field 1 and the B-roll, no who / where, frames or clips.
const _isVo = (p) => !!(p && p.type === 'voiceover');
// (phase V61, the owner 2026-10-30, (т5): "Кадры и видео открываются, когда прочитаны все строки, а позже переписанная
// строка их обратно не закрывает") THE FRAMES AND THE VIDEO WAIT FOR THE VOICE: red, and a press on them says why, until
// every line of the video has been read once - a line rewritten later keeps its old take and opens nothing again; only
// its own clip waits for the new read. A project already past it - a frame in its pool, a clip made - is never shut again.
// By Seedance's voice sample nothing is read: they wait for a voice with its demo. '' - open.
const _everRead = (l) => { const a = (l && l.audio) || {}; return !!((a.tagged && a.tagged.path) || (a.plain && a.plain.path)); };
function _voiceLock(p) {
  if (_missing(p).length) return '';                // the whole zone waits for who and where first
  if (_bySample()) return _needs(p).voice ? 'Choose a voice with its demo first - field 1, mood & voice.' : '';
  const live = liveLines(p.lines);
  if (!live.length || _pool(p).length || live.some(x => _clipsOf(p, x.l).length)) return '';
  return live.every(x => _everRead(x.l)) ? '' : 'Voice the lines first - field 1, mood & voice.';
}

// The "none" a menu shows while nothing is chosen in it: the first line, and it cannot be chosen back.
function _noneOption(sel, word) {
  const o = el('option', '', word || 'none');
  o.value = '';
  o.disabled = true;
  o.selected = true;
  sel.appendChild(o);
}

// ── The general zone: the whole video, step by step ─────────────────────────
// (Decided with the owner 2026-09-21, docs/local-app/PLAN.md, phase W; laid out again in phase V61, the owner 2026-10-30,
// (т13): "давай пока по рекомендации. там посмотрим".) FIELD 1, "mood & voice", across the whole width on top - one line;
// under it two columns: 2 the frames on the left, 3 the video on the right, as tall as each other.
//
// UNTIL WHO AND WHERE ARE CHOSEN (the owner: "давай заблеривать все поля, кроме поля превью где пользователь должен выбрать
// персонажа и окружение") the fields are blurred and take no press, with one line over them saying what to do first.
//
// (phase V62, the owner 2026-10-31: "нужно заблерить поле с настройками, а активным показывать поле с выбором или созданием
// текста [...] затем когда пользователь выбирает сценарий или добавляет свой текст нужно подсветить золотой обводкой центральное
// поле с таким же облачком инструкции по этому шагу") A VOICEOVER with no script has its fields blurred the same way - the
// script column beside them is where to begin. What to do at each step is said by the tips over the page (js/merge-v3/vo-tips.js),
// over the anchors marked `data-tip`.
function _all(host, p, lines) {
  const missing = _missing(p);
  if (missing.length) host.appendChild(_note('Choose ' + missing.join(' and ') + ' first - on the preview. Then the fields open.'));
  const noText = _isVo(p) && !_live(lines).length;
  const zone = el('div', 'mv3-wk-zone' + ((missing.length || noText) ? ' is-locked' : ''));
  host.appendChild(zone);
  _stageMoodVoice(zone, p, lines);
  if (_isVo(p)) { _stageBroll(zone, p, lines); _markWait(zone); return; }
  const cols = el('div', 'mv3-wk-zcols');
  const left = el('div', 'mv3-wk-zcol');
  const right = el('div', 'mv3-wk-zcol');
  cols.append(left, right);
  zone.appendChild(cols);
  _stageFrames(left, p);
  _stageVideo(right, p, lines);
  _markWait(zone);
}

// (phase V73 block 5, 5d; the owner's (б5-6) а) THE FIELD THAT WAITS - the one gold dashed frame ("your move"): the first field in
// order that is not done and not locked (waiting for the voice); while that one is working, the next that needs a choice; none
// while the zone is locked (who / where, or a voiceover's script, wait first - on the stage, in the script column). The others
// stand in a quiet hairline.
function _markWait(zone) {
  if (!zone || zone.classList.contains('is-locked')) return;
  const open = [...zone.querySelectorAll('.mv3-wk-stage')]
    .filter((b) => !b.classList.contains('is-done') && !b.classList.contains('is-voicelock'));
  let w = open[0];
  if (w && w.classList.contains('is-working')) w = open.slice(1).find((b) => b.classList.contains('is-need'));
  if (w) w.classList.add('is-wait');
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
  const done = !!spec.done && !spec.blocked && !spec.need && !spec.lock;
  const box = el('div', 'mv3-wk-stage' + (done ? ' is-done' : ' is-open')
    + (spec.blocked ? ' is-blocked' : '') + ((spec.need || spec.lock) ? ' is-need' : '') + (spec.half ? ' is-half' : '')
    + (spec.work ? ' is-working' : '') + (spec.lock ? ' is-voicelock' : '') + (spec.wide ? ' is-wide' : ''));
  box.dataset.stage = id;                 // (phase V62) what a voiceover's tips point at (js/merge-v3/vo-tips.js)
  // (phase V61, (т5)) WAITING FOR THE VOICE: red, what is in it dimmed and dead - but for what is marked `is-free` - and a
  // press on it says what to do first (the owner: "при попытке выбрать что то во first frames и video будет говорить что
  // сначала озвучить нужно строки").
  if (spec.lock) {
    box.addEventListener('click', (e) => {
      if (e.target.closest && e.target.closest('.is-free')) return;
      e.preventDefault();
      askNote(box, spec.lock);
    });
  }
  // ...while there IS work in it, the bottom line of the frame fills up (N3) - a thin grey line since V73 block 5.
  if (spec.work) _barWatch(box, spec.work);
  // (phase V73 block 5, 5d; the owner's (б5-7) а) THE HEAD: the field's number before its name - in mono, quiet (it was a circle
  // on the corner) -, the name 12 / 500 in sentence case (gold capitals before), and DONE - a green tick and "Done" - at its
  // right, staying (the owner, 2026-09-23: a mark that flashes for two seconds is a mark you miss). What the field is and where
  // it stands is the second line, and it wraps (б1-24: the VIDEO row is whole).
  const head = el('div', 'mv3-wk-stage-head');
  if (spec.step) head.appendChild(el('span', 'mv3-wk-snum u-mono', String(spec.step)));
  head.appendChild(el('span', 'mv3-wk-sname', _cap(spec.name)));
  if (done && spec.step) {
    const d = el('span', 'mv3-wk-sdone');
    d.append(iconEl('circle-check', 14), document.createTextNode('Done'));
    head.appendChild(d);
  }
  // What the field IS, and then where it stands. The second used to appear only when the drawer
  // was shut; with nothing to shut, it belongs in the head all the time.
  const sub = spec.lock ? spec.lock.replace(/ - field 1.*$/, '').replace(/\.$/, '').toLowerCase()
    : spec.need ? 'choose ' + spec.need
    : spec.blocked ? 'needs ' + spec.why
      : [spec.sub, spec.summary].filter(Boolean).join(' · ');
  if (spec.need) head.title = 'Choose ' + spec.need + ' - nothing in this field is made until it is chosen';
  else if (spec.blocked) head.title = 'Still missing: ' + spec.why;
  box.appendChild(head);
  if (sub) {
    const s = el('div', 'mv3-wk-vsub mv3-wk-ssub' + (spec.need ? ' is-need' : '') + (spec.lock ? ' is-lock' : ''));
    s.appendChild(figures(_cap(sub)));
    if (spec.need) s.title = head.title;
    box.appendChild(s);
  }
  host.appendChild(box);
  const body = el('div', 'mv3-wk-stage-body');
  box.appendChild(body);
  if (spec.bare) return { open: true, body, foot: null };   // a shelf has nothing to press
  const foot = el('div', 'mv3-wk-stage-foot');
  box.appendChild(foot);
  return { open: true, body, foot };
}

function _genButton(foot, spec) {
  // (phase V73 block 5, 5d) what the press is about - a line of its own over the button, wrapping, its prices and counts in mono
  if (spec.cap) foot.appendChild(el('span', 'mv3-wk-vsub mv3-wk-gcap')).appendChild(figures(spec.cap));
  const b = el('button', 'mv3-wk-gen u-btn is-s is-main', spec.label || 'generate');
  b.type = 'button';
  b.title = spec.title || '';
  b.disabled = !!spec.disabled;
  // (phase V73 block 2) a paid press armed for its second press: the light step (б2-10) - no time limit here, as before
  if (spec.armed) b.classList.add('is-armed');
  if (spec.on) b.addEventListener('click', spec.on);
  foot.appendChild(b);
  return b;
}

// HOW FAR THE CLIPS HAVE GOT: the clips that have landed, and for each one still being made, its own share by the
// estimate. The place and the prompts happen before any clip is asked for, and they are short: they hold the first tenth.
function _clipsPart(p, lines) {
  const live = _live(lines);
  const want = live.length || 1;
  if (!_clipping.size) return Math.min(0.1, _byTime(_writeAt, 'tag') * 0.1);
  let got = live.filter((l, i) => _clipState(p, l, i) === 'ok').length;
  for (const c of _clipping.values()) got += _byTime(c.startedAt, 'clip');
  return Math.min(1, got / want);
}

// Where the script stands. The frames are a set, not a line each: how many the pool holds.
function _standing(p) {
  // The lines of the VIDEO, each still knowing its real place in the script (phase Z) - `i` is what
  // the frames, the clips and the journal are addressed by, and it must not become the position in
  // a filtered list.
  const live = liveLines(p.lines);
  const have = _pool(p).length;
  return {
    n: live.length,
    read: live.filter(x => isRead(x.l)).length,
    // (phase V26.5, the owner 2026-10-10) Done as soon as the set has a frame - how many there are is not a debt the frames
    // chat leaves.
    frames: have, framesDone: have > 0,
    clips: live.filter(x => _clipSettled(p, x.l, x.i)).length,
  };
}

// FIELD 1 - MOOD & VOICE (phase V61, the owner 2026-10-30: "пользователь должен выбрать сначала mood и voice - давай объединим
// 2 поля в одно горизонтальное. кнопка change должна быть справа от выбранного голоса и никогда не переносится на следующую
// строку"; (т3) one `generate`; (т12) the mood's own sentence in a bubble over its menu). ONE LINE: the mood ▾ | ▶ the voice
// · change | stability, speed | generate. The mood is the one vocabulary every stage reads from (the tags of the read, the
// face in the frames, the movement in the clips), and the script is marked up by it; the voice reads the marked-up words,
// ElevenLabs v3. The one `generate` does both, one after the other (VOICE.markAndRead): the mark-up when a line of the video
// has no [tags], then every line that needs a read - and says on itself which it is doing. A mark-up that fails stops there
// and says so under the line. By Seedance's voice sample nothing is read: `generate` marks up, and the voice needs its demo.
function _stageMoodVoice(host, p, lines) {
  const v = _video();
  const g = VOICE.reading();
  const live = _live(lines);
  const sample = _bySample();
  const untagged = VOICE.untagged(p).length;
  const read = live.filter(isRead).length;
  // Read with other settings than the project's now (V26.1): still read, but work left in this field.
  const redo = sample ? [] : live.map(l => VOICE.unsettledBy(p, l)).filter(Boolean);
  const will = sample ? 0 : live.filter(l => !isRead(l)).length;
  const has = _canRead();
  const needs = _needs(p);
  const need = [needs.mood, needs.voice].filter(Boolean).join(' and ');
  const done = live.length > 0 && !untagged && !will && !redo.length && !g.busy && !need;
  const now = ((_kit && _kit.moods) || []).find(m => m.id === v.mood) || null;
  const { body } = _stage(host, 'moodvoice', {
    step: 1, bare: true, wide: true,
    // The mark-up is one call to an agent and goes by an estimate that learns (N3); the reads are counted.
    work: g.tagging ? () => _byTime(g.tagAt, 'tag')
      : g.batch ? () => (g.batch.done || 0) / Math.max(1, g.batch.total)
        : g.lines.length ? () => _byTime(g.readAt, 'read') : null,
    name: 'mood & voice', sub: sample ? 'the voice\'s sample, for Seedance' : 'ElevenLabs v3', done, need,
    summary: [untagged ? untagged + (untagged === 1 ? ' line to mark up' : ' lines to mark up') : 'marked up',
      sample ? (!has ? 'no voice yet' : _demoFor ? 'making its demo…' : _demoMissing(p) ? 'its demo is missing' : 'the voice is chosen')
        : read + '/' + live.length + ' read' + (redo.length ? ' · ' + redo.length + ' to redo' : '')].join(' · '),
  });
  // TWO LINES (the owner 2026-10-30, after block 1: "давай в поле mood и voice добавим сверху строку с пояснениями что это за
  // поля: дропдаун mood - сверху mood со всплывашкой при наведении, голос - voice со всплывашкой подсказкой при наведении,
  // stability и speed аналогично. кнопка generate во второй строке"): the names of the controls on top, each with its bubble,
  // the controls under them - `generate` at the end of that second line. One grid, so a name stands over its control.
  const row = el('div', 'mv3-wk-mvrow' + (sample ? ' is-sample' : ''));
  body.appendChild(row);
  const name = (word, tip) => hint(el('span', 'mv3-wk-mvname', _cap(word)), tip);
  // The mood. What it means is said in the bubble of its name (the owner's (т12)).
  const mood = el('select', 'u-in is-s mv3-wk-vsel is-small is-mood');
  if (!now) _noneOption(mood, 'none');
  for (const m of (_kit && _kit.moods) || []) {
    const o = el('option', '', m.label);
    o.value = m.id;
    if (m.id === v.mood) o.selected = true;
    mood.appendChild(o);
  }
  mood.disabled = _saving || !_kit || g.busy;
  mood.addEventListener('change', () => _saveVideo({ mood: mood.value }));
  // The voice - ▶, its name, `change` right of it (js/merge-v3/wk-voice.js); what it has to say goes under the lines.
  const voice = el('div', 'mv3-wk-mvvoice');
  const notes = el('div', 'mv3-wk-mvnotes');
  VOICE.paintRow(voice, _api.voiceApi(), { notes });
  // How it is spoken (V26.1) - not by the voice sample, where nothing is read.
  const how = sample ? null : _voiceSettings(p, g.busy);
  row.append(
    name('mood', () => {
      const m = ((_kit && _kit.moods) || []).find(x => x.id === mood.value) || null;
      return (m ? m.label + (m.about ? ' - ' + m.about : '') + '\n' : '')
        + 'The emotion of the whole video: the script is marked up by it, and the read, the frames and the clips all follow it.';
    }),
    name('voice', sample
      ? 'The voice Seedance takes its timbre from - its demo. Nothing is read: Seedance says the lines itself.'
      : 'The voice every line is read in - ElevenLabs v3. The character’s own when they have one, else the one chosen here for the project. "change" opens the saved voices and the ElevenLabs library.'),
    ...(how ? [name('stability', STAB_TIP), name('speed', SPEED_TIP)] : []),
    el('span', 'mv3-wk-mvname'),
    mood, voice, ...(how ? [how.stab, how.speed] : []),
  );
  const ctl = el('div', 'mv3-wk-mvgo');
  row.appendChild(ctl);
  const label = g.tagging ? 'marking up…'
    : g.batch ? 'reading ' + g.batch.done + ' of ' + g.batch.total + '…'
      : g.lines.length ? 'reading…' : 'generate';
  const wait = !live.length ? 'This script has no lines'
    : !v.mood ? 'Choose the mood first - the script is marked up by it'
      : !has ? 'Choose a voice first - a character with one, or one for the project'
        : (!untagged && !will && !redo.length) ? (sample ? 'Marked up - nothing is read by the voice sample' : 'Every line is marked up and read, with these settings')
          : '';
  const again = redo.filter(w => w === 'stability').length;
  const retime = redo.length - again;
  _genButton(ctl, {
    label,
    disabled: g.busy || !!wait || !_kit,
    title: wait || [
      untagged && 'Mark the script up by the mood - the [tags] go between the words of ' + untagged + (untagged === 1 ? ' line' : ' lines') + '. Credits.',
      will && 'Then read every line that needs it (' + will + '), one a second - ElevenLabs v3, by those tags. Credits.',
      again && 'Read again the ' + again + (again === 1 ? ' line' : ' lines') + ' read with another stability - ElevenLabs, credits.',
      retime && 'Retime the ' + retime + (retime === 1 ? ' line' : ' lines') + ' read at another speed - here, free.',
      redo.length && 'A line with a clip keeps it on the timeline until a new one is made.',
    ].filter(Boolean).join(' '),
    on: () => VOICE.markAndRead(_api.voiceApi(), { read: !sample }),
  });
  body.appendChild(notes);
  // By the voice sample: the voice's demo, made once (the sixth round of V26.8).
  if (sample && has) {
    if (_demoFor) notes.appendChild(_note('Making the voice’s demo…'));
    else if (_demoMissing(p)) {
      notes.appendChild(_note(_demoErr || 'This voice has no demo yet - Seedance takes its timbre from it.', !!_demoErr));
      const mk = el('button', 'mv3-wk-vuse u-btn is-s', 'Make the demo');
      mk.type = 'button';
      mk.title = 'Read the demo phrase in this voice - ElevenLabs, credits, about ten seconds';
      mk.addEventListener('click', () => _askDemo(p));
      notes.appendChild(mk);
    }
  }
}

// THE STABILITY AND THE SPEED of the read (phase V26.1, the owner 2026-10-10) - one each for the
// whole video, kept on the project. Changing either touches no read: the lines read before stay read,
// and the field's `generate` redoes them - a read again for the stability, a retiming for the speed.
const STABILITY = [
  { v: 0, label: 'Creative', tip: 'More emotional and expressive - and more likely to stray from the words' },
  { v: 0.5, label: 'Natural', tip: 'Balanced - the closest to the voice as it was recorded' },
  { v: 1, label: 'Robust', tip: 'Very even - follows the tags less' },
];
const SPEED = { min: 0.7, max: 1.2, step: 0.05 };
// What the two are, said in the bubbles of their names in field 1 (phase V61).
const STAB_TIP = 'How steady the voice is. ElevenLabs v3 knows three: creative - more emotional, and more likely to stray from the words; natural - the closest to the voice as recorded; robust - very even, follows the tags less. A line read before keeps its read until generate reads it again.';
const SPEED_TIP = 'How fast the reads play: 1 is as ElevenLabs speaks, ' + SPEED.min + ' to ' + SPEED.max
  + '. Applied at once - the reads already made are retimed here, free, with the voice at its own pitch, and the timeline follows. A line given its own speed in its fragment keeps it.';
// The two controls, for the second line of field 1 (their names stand over them, with STAB_TIP and SPEED_TIP).
function _voiceSettings(p, busy) {
  const now = VOICE.params(p);
  const stab = el('select', 'u-in is-s mv3-wk-vsel is-small is-stab');
  for (const s of STABILITY) {
    const o = el('option', '', s.label);
    o.value = String(s.v);
    o.title = s.tip;
    if (s.v === now.stability) o.selected = true;
    stab.appendChild(o);
  }
  stab.disabled = busy || _saving;
  stab.addEventListener('change', () => _saveVoice({ stability: +stab.value, speed: VOICE.params(p).speed }));
  const speed = el('input', 'mv3-wk-vnum u-in is-s');
  speed.type = 'number';
  speed.min = String(SPEED.min);
  speed.max = String(SPEED.max);
  speed.step = String(SPEED.step);
  speed.value = String(now.speed);
  speed.disabled = busy || _saving;
  _speedLater(speed, 'project', () => VOICE.params(_ctx.project).speed, v => ({ speed: v }));
  return { stab, speed };
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
  box.appendChild(el('span', 'mv3-wk-fsetlabw', _cap(word)));
  box.appendChild(sel);
  return box;
}

// ── A VOICEOVER'S LINE, AT MOST VO_MAX CHARACTERS (phase V62, (во27), (во28)) ──
// The field of a line's words - edited or put in - stops at the limit (ElevenLabs reads 5 000 at a time, the mood's tags
// included) and says under it how many are in. Nothing for a talking head. Returns the counter's repaint, or null.
function _voCount(p, box) {
  if (!_isVo(p)) return null;
  box.maxLength = API.VO_MAX;
  const c = el('div', 'mv3-wk-fwhy mv3-vo-count');
  const paint = () => {
    c.textContent = int(box.value.length) + ' / ' + int(API.VO_MAX);   // (phase V73 block 5, 5d; (б5-21) а) "4,500 / 4,500"
    c.classList.toggle('is-full', box.value.length >= API.VO_MAX);
  };
  paint();
  queueMicrotask(() => { if (box.isConnected) box.after(c); });
  return paint;
}

// ── FIELD 2 OF A VOICEOVER - B-ROLL (phase V62) ──
// The picture of a voiceover: videos and pictures from the stock, laid over the voice by its sentences. Red until every
// line is read (the same rule as a talking head's frames and video, _voiceLock); its "find B-roll" comes with V62's block 1.
// (phase V62, block 1) "find B-roll" - the SERVER finds it (routes/broll.js, lib/broll.js): the sentences from the captions, the
// agent's English keywords for each, a batch of videos and pictures from the stock per sentence, the pieces laid on main video
// edge to edge through the voice - and this field follows it ("finding 3 of 14…"). The menu beside it says what is laid -
// videos and pictures mixed, videos only, pictures only - and lays it again when changed (the pieces chosen by hand stay).
let _broll = null;            // { key, state } - the server's word on this project's B-roll
let _brollT = 0;
const BROLL_MODES = [['mixed', 'Videos and pictures'], ['video', 'Only videos'], ['image', 'Only pictures']];
function _brollWatch(p, now) {
  clearTimeout(_brollT);
  const id = String(p.id);
  const ask = async () => {
    try {
      const r = await fetch('/api/broll/' + encodeURIComponent(id) + '/state').then(x => x.json());
      if (!_ctx || !_ctx.project || String(_ctx.project.id) !== id) return;
      const was = _broll && _broll.state;
      _broll = { key: id, state: (r && r.state) || null };
      const st = _broll.state || {};
      // The work ended: the timeline has the pieces now.
      if (was && was.running && !st.running) Store.refresh().catch(() => {});
      if (JSON.stringify(was) !== JSON.stringify(st)) _ctx.repaint();
      if (st.running) _brollT = setTimeout(ask, 1200);
    } catch (e) { _brollT = setTimeout(ask, 3000); }
  };
  if (now) ask(); else _brollT = setTimeout(ask, 1200);
}
async function _brollPost(p, what, body) {
  try {
    const r = await _post('/api/broll/' + encodeURIComponent(p.id) + '/' + what, body || {});
    _broll = { key: String(p.id), state: r.state || null };
  } catch (e) {
    _broll = { key: String(p.id), state: Object.assign({}, (_broll && _broll.state) || {}, { running: false, error: e.message }) };
  }
  _ctx.repaint();
  _brollWatch(p, false);
}

function _stageBroll(host, p, lines) {
  const live = liveLines(lines);
  const lock = !live.length ? 'Choose the script first - a scenario or your own text, on the right.' : _voiceLock(p);
  if (!_broll || _broll.key !== String(p.id)) { _broll = { key: String(p.id), state: null }; _brollWatch(p, true); }
  const st = (_broll && _broll.state) || {};
  const total = +st.total || 0, done = +st.done || 0;
  const { body, foot } = _stage(host, 'broll', {
    step: 2, wide: true, lock, done: !!st.laid && !st.running && !st.error && !st.left,
    work: st.running ? () => (total ? done / total : 0) : null,
    name: 'B-roll', sub: 'videos and pictures from the stock, by the sentences',
    summary: st.running ? (st.step || 'finding…') : st.sentences ? st.laid + ' pieces · ' + st.sentences + ' sentences' + (st.left ? ' · ' + st.left + ' without B-roll' : '') : '',
  });
  if (!live.length) { body.appendChild(_note('The script first, then the voice. Then the B-roll is found for it.')); return; }
  if (lock) { body.appendChild(_note('The voice first - every line read, then its captions heard. Then the B-roll is found for it.')); return; }
  if (st.error) body.appendChild(_note(st.error, true));
  else if (!st.sentences && !st.running) {
    body.appendChild(_note('Videos and pictures from the stock for every sentence of the voice, laid over it edge to edge - '
      + 'free; the keywords are written by the agent (a fraction of a cent).'));
  }
  // What is laid, and laid again when changed.
  const mode = el('select', 'u-in is-s mv3-wk-vsel is-small mv3-wk-bmode');
  for (const [v, label] of BROLL_MODES) {
    const o = el('option', '', label);
    o.value = v;
    if ((st.mode || 'mixed') === v) o.selected = true;
    mode.appendChild(o);
  }
  mode.title = 'What is laid: videos and pictures mixed at random, only videos, or only pictures. Changed, every piece is laid again - but the ones you chose yourself.';
  mode.disabled = !!st.running;
  mode.addEventListener('change', () => _brollPost(p, 'mode', { mode: mode.value }));
  foot.appendChild(mode);
  const find = _genButton(foot, {
    label: st.running ? (st.step || 'finding…') : st.sentences && !st.left ? 'find again' : 'find B-roll',
    disabled: !!st.running,
    title: st.running ? 'The B-roll is being found' : st.sentences && !st.left
      ? 'Every sentence has its B-roll - this finds it for sentences new since (a line read again, put in)'
      : 'Find the B-roll of every sentence that has none yet and lay it over the voice',
    on: () => _brollPost(p, 'find'),
  });
  find.dataset.tip = 'broll-find';        // the tip of step 3 stands under it (js/merge-v3/vo-tips.js)
}

// ── FIELD 2 - FRAMES (phase V61, the owner 2026-10-30, (т6): "поле first frames удаляем, а набор фреймов нужно показывать.
// это поле нужно, чтобы было видно набор фреймов которые есть и кнопка открытия чата"; (т6а) "scattered" a tick here) ──
// The set the lines take their frames from - the shelf of phase R, everything it could do came with it: press a frame to put
// it on the stage, ✕ to take it out of the rotation, drag to reorder, right-click to see it large - and at its foot the tick
// "scattered" (off: the lines take the frames in turn, in this order; on: one drawn for each line by its number, never
// reshuffled) and "frames chat", the window where frames are asked for in words. Red, like the video, until the lines are
// read; done once the set has a frame.
function _stageFrames(host, p) {
  const s = _standing(p);
  const v = _video();
  const { body, foot } = _stage(host, 'frames', {
    step: 2, half: true, lock: _voiceLock(p),
    name: 'frames', sub: 'the set the lines take theirs from', done: s.framesDone,
    summary: s.frames ? s.frames + (s.frames === 1 ? ' frame' : ' frames')
      : 'none yet - ask for one in the frames chat',
  });
  const strip = el('div', 'mv3-wk-fset');
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
    // (phase V26.6) ...and the products it was drawn with.
    const prods = (Array.isArray(fr.props) ? fr.props : []).map(x => x && x.name).filter(Boolean);
    b.title = (fr.made === 'chat' ? 'from the frames chat · ' : '') + (fr.framing ? fr.framing + ' ' : '') + (fr.n ? fr.n + ' · ' : '')
      + (prods.length ? 'product ' + prods.join(', ') + ' · ' : '')
      + (gone ? 'switched off - no fragment takes it' : 'press to see it on the stage; right-click to open it large');
    // (phase V26.5) A frame made to order in the frames chat says so on its tile.
    if (fr.made === 'chat') b.appendChild(el('span', 'mv3-wk-fsetmade', 'Chat'));
    const img = el('img');
    img.alt = '';
    img.loading = 'lazy';
    img.src = derived(fr.preview || fr.path, 'card');
    b.appendChild(img);
    // The ✕ in the corner takes a frame out of the rotation; the ✓ in the same corner brings it
    // back (the owner, 2026-09-21). A switched-off frame is dimmed and stands first, out of the way.
    // (phase V73 block 5, 5d) Lucide's ✕ (the shared mask) and ✓; taking a frame out is not a deletion, so the ✕ is not red
    const sw = el('button', 'mv3-wk-fsetx u-onpic' + (gone ? ' is-back' : ' u-x'));
    if (gone) sw.innerHTML = icon('check', 12);
    sw.type = 'button';
    sw.title = gone ? 'Use this frame again' : 'Do not use this frame in any fragment';
    sw.addEventListener('click', (e) => { e.stopPropagation(); _banFrame(p, fr.id, !gone); });
    b.appendChild(sw);
    b.addEventListener('click', () => { _setPick = _setPick === fr.id ? '' : fr.id; _ctx.repaint(); });
    b.addEventListener('contextmenu', (e) => { e.preventDefault(); showPicture({ src: fr.path, name: 'frame ' + (fr.n || ''), rows: fr.prompt ? [['prompt', fr.prompt]] : [] }); });
    strip.appendChild(b);
  }
  if (shown.length) body.appendChild(strip);
  // The tick and the door, along the foot.
  foot.classList.add('is-frames');
  const tick = el('label', 'mv3-wk-ftick');
  const box = el('input');
  box.type = 'checkbox'; box.classList.add('u-check');
  box.checked = v.spread === 'random';
  box.disabled = _saving;
  box.addEventListener('change', () => _saveVideo({ spread: box.checked ? 'random' : 'cycle' }));
  tick.append(box, el('span', '', 'scattered'));
  hint(tick, 'Off - the lines take the frames in turn, in the order of this shelf (drag a frame to move it).\n'
    + 'On - each line gets one of them drawn for it by its number, never reshuffled.\n'
    + 'A frame picked by hand in a fragment stays that line\'s either way.');
  foot.appendChild(tick);
  _genButton(foot, {
    label: 'Frames chat',
    disabled: _missing(p).length > 0,
    title: 'Ask for a frame in words - the person and the place go with it; a frame you like goes into this set with "to frames"',
    on: () => { _setPick = ''; openChat(); },
  });
}

// VIDEO - the model and the tier, then `generate`: how the PLACE moves (W3a), the animation of the PERSON, line
// by line (W3b), and the clips (F4). OPEN FROM THE START (phase V24, the owner
// 2026-10-09): the model and the quality are chosen at the beginning, and the field is red until the
// quality is; what it still waits for - the character, the place, a first frame to animate - is said
// on its `generate`, which stays shut until they are there.
function _stageVideo(host, p, lines) {
  const missing = _missing(p);
  const why = missing.length ? missing.join(' and ') : !_pool(p).length ? 'a frame - the frames chat' : '';
  const motion = _envMotion(p);
  const live = _live(lines);
  const written = live.filter(_animated).length;
  // (phase V23, the owner: "так") Done when every line of the video HAS ITS CLIP - fresh, or chosen by hand - and
  // nothing is being made; the prompts are only the way there.
  const s = _standing(p);
  // (phase V26.8) Seedance's clips are still being built: the field holds its settings and makes nothing yet - and the
  // Kling clips a project may already have are not Seedance's, so they do not make it done.
  const soon = _seedance();
  const done = s.n > 0 && s.clips === s.n && !_clipping.size && !why;
  const need = _needs(p).video;
  const lock = _voiceLock(p);
  const { body, foot } = _stage(host, 'video', {
    step: 3, half: true, lock,
    // The clips that have landed, plus the ones in flight; the place and the prompts, which come
    // first and are quick, go by the estimate of a clip (N3).
    work: (_writing || _envWriting || _clipping.size) ? () => _clipsPart(p, lines) : null,
    name: 'video', sub: 'the place, then the person', done, need,
    summary: soon ? 'clips ' + s.clips + '/' + s.n + ' · prompts ' + _sdFrags(p).filter(f => f.prompt && (!f.stale || f.edited)).length + '/' + _sdFrags(p).length
      : 'clips ' + s.clips + '/' + s.n + ' · ' + written + '/' + live.length + ' animated',
  });
  _needEnvMeta();
  const v = _video();
  // WHAT FILMS IT AND HOW SHARP, one row (phase V26.8, the owner 2026-10-13): the model of the whole video - Kling avatar,
  // a clip per line, or one of the three Seedances - and the qualities that model makes, each with its price a second.
  // Neither is chosen for a new project (V24): both say none, and the field is red until they are.
  const models = (_kit && _kit.models) || [];
  const sets = el('div', 'mv3-wk-fsets');
  const model = el('select', 'u-in is-s mv3-wk-vsel is-small is-model');
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
  const tier = el('select', 'u-in is-s mv3-wk-vsel is-small is-tier');
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
  if (_seedance()) _seedanceSettings(body);
  // (phase V61) WAITING FOR THE VOICE, the field's choices stay free: what films the video - and by Seedance's voice
  // sample nothing is read at all, so that choice cannot wait for a read. What makes waits.
  if (lock) body.querySelectorAll('.mv3-wk-fsets').forEach(r => r.classList.add('is-free'));
  // How the PLACE moves has no field here (phase V26.8, the owner 2026-10-14: "поле точно не нужно"): `generate` and
  // a clip have the agent write it first, and its sentence goes into every prompt word for word. It is put right in the
  // Library's environment column, "how it moves" (public/js/library/info.js) - or in the prompt of a line or a fragment.

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
  // (the sixth round) By the voice sample the length is Seedance's, clip by clip: not known beforehand.
  const whole = secs && !_bySample() ? (Math.round(secs * 10) / 10).toFixed(1) + 's in all' : '';
  // A clip in flight does not shut this button (V4): the planner skips the fragments that are
  // already being made, so `generate` here starts the others.
  const busy = !!_writing || _envWriting;
  // The clips are the dollars in this zone, so the button shows the price and waits for a second
  // press when there are any - the words before them are credits and go on the first.
  const armed = _armedVideo && clips.length > 0;
  // What the press still waits for (phase V24): the field is open, its `generate` is not - the
  // character and the place, a first frame to animate, the quality, and the mood the person moves in.
  const wait = [lock && lock.replace(/\.$/, ''), why, need, _needs(p).mood].filter(Boolean);
  // (phase V26.8, parts 4-5) SEEDANCE: the place, then the prompt of every fragment that has none - one request each,
  // credits - then the clips of the fragments that have none, priced, on a second press.
  if (soon) {
    // (the sixth round) By the voice sample the clips wait for the voice and its demo too.
    if (_bySample() && _needs(p).voice) wait.push(_needs(p).voice);
    const sdWant = _sdNeeds(p).length;
    const sample = _bySample();
    const many = (n) => n + (n === 1 ? ' clip' : ' clips');
    _genButton(foot, {
      label: _writing === 'place' || (_envWriting && !_writing) ? 'the place…' : _writing === 'lines' ? 'writing…'
        : _writing === 'clips' ? 'clips ' + _standing(p).clips + '/' + _standing(p).n + '…'
          : armed ? (sample ? 'go?' : _money(clipCost) + ' · go?') : done ? 'again' : 'generate',
        armed,
      cap: busy ? whole : wait.length ? 'needs ' + wait.join(', ') : [
        sdWant ? sdWant + (sdWant === 1 ? ' prompt' : ' prompts') : '',
        _clipping.size ? _clipping.size + (_clipping.size === 1 ? ' clip running' : ' clips running') : '',
        clips.length ? many(clips.length) + (sample ? '' : ' · ' + _money(clipCost)) : '',
        whole,
      ].filter(Boolean).join(' · '),
      disabled: busy || wait.length > 0 || !_place(p) || !_sdFrags(p).length || (!!motion && !sdWant && !clips.length),
      title: wait.length ? 'First: ' + wait.join(', ')
        : !_sdFrags(p).length ? (sample ? 'Write the lines first' : 'Read the lines first - Seedance hears a line\'s read')
          : 'The place, then the Seedance prompt of every line that has none (one request each, credits), then the clips of'
            + ' the lines that have none - ' + (clips.length ? many(clips.length) + (sample ? ', each as long as Seedance makes it' : ' for ' + _money(clipCost)) : 'none to make')
            + '. A prompt edited by hand is left alone; a line that has its clip is not paid for twice.'
            + (clips.length ? ' Press again to confirm.' : ''),
      on: () => {
        if (clips.length && !_armedVideo) { _armedVideo = true; _ctx.repaint(); return; }
        _armedVideo = false;
        _writeVideo(p, { clips: true });
      },
    });
    return;
  }
  _genButton(foot, {
    label: _writing === 'place' || (_envWriting && !_writing) ? 'the place…'
      : _writing === 'lines' ? 'writing…'
        : _writing === 'clips' ? 'clips ' + _standing(p).clips + '/' + live.length + '…'
          : armed ? _money(clipCost) + ' · go?' : done ? 'again' : 'generate',
        armed,
    // What this press will SPEND and how long the video is - and nothing else (the owner,
    // 2026-09-22). The chores it also does - looking at the place, writing the prompts - used to
    // be listed here; they cost credits, not dollars, and the button's own tooltip still says them.
    cap: busy ? whole : wait.length ? 'needs ' + wait.join(', ') : [
      _clipping.size ? _clipping.size + (_clipping.size === 1 ? ' clip running' : ' clips running') : '',
      clips.length ? clips.length + (clips.length === 1 ? ' clip · ' : ' clips · ') + _money(clipCost) : '',
      whole,
    ].filter(Boolean).join(' · '),
    disabled: busy || wait.length > 0 || !_place(p) || !live.length || (!!motion && !willWrite && !clips.length),
    title: wait.length ? 'First: ' + wait.join(', ')
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

// SEEDANCE'S OWN SETTINGS (phase V26.8, the owner 2026-10-13), under the model: how the clip is voiced, how the body
// moves, the camera. Each says what it does on the line under it (the owner's answer (ш):
// "пояснение нужно, что это за параметры"). They are kept on the project as they are chosen; the clips that use them
// come with the later parts of the phase.
function _seedanceSettings(body) {
  const v = _video();
  const row = (node) => { const r = el('div', 'mv3-wk-fsets'); r.appendChild(node); body.appendChild(r); };
  const why = (text) => body.appendChild(el('div', 'mv3-wk-fwhy', text));

  // THE SOUND - what Seedance hears to voice the line itself (lib/th-video.js SOUNDS): the line's read, or the voice's
  // sample. Not chosen, it is the read (the owner's answer (я13)).
  const sounds = (_kit && _kit.sounds) || [];
  const cur = v.sound || 'read';
  const sound = el('select', 'u-in is-s mv3-wk-vsel is-small is-model');
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
  if (said) why(said.about);

  // GESTURES - how the head, the hands and the body move (the owner's answer (ц)): one way per mood, the project's mood
  // until another is picked; the face follows the mood always (answer (щ)). Picking the mood itself follows it again.
  const moods = (_kit && _kit.moods) || [];
  const gest = el('select', 'u-in is-s mv3-wk-vsel is-small is-model');
  const curG = v.gestures || v.mood || '';
  if (!curG) _noneOption(gest, 'as the mood');
  for (const md of moods) {
    const o = el('option', '', md.label + (md.gloss ? ' - ' + md.gloss : '') + (md.id === v.mood ? ' (the mood)' : ''));
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
  const cam = el('select', 'u-in is-s mv3-wk-vsel is-small is-model');
  const one = el('option', '', 'One continuous shot');
  one.value = 'one';
  const more = el('option', '', 'Several shots · soon');
  more.value = 'more';
  more.disabled = true;
  cam.append(one, more);
  cam.value = 'one';
  row(_labelled('camera', cam, 'How the clip is shot'));
  why('One shot from the first word to the last, the camera moving a little.');
}

function _list(host, p, lines) {
  // (phase V62, the owner after block 0) THE VOICEOVER DRAFT'S SCRIPT is chosen in this column: with no lines, the scenarios
  // and "+ your text" stand where its lines will (js/merge-v3/vo-script.js); with them, "other script" over them takes them
  // off again - while it is the draft.
  if (_isVo(p) && p.draft) {
    const adopt = (project) => { _adopt({ project }); _open = -1; Store.refresh().catch(() => {}); _ctx.repaint(); };
    adopt.repaint = () => _ctx.repaint();
    if (!lines.length) { VOS.paintChooser(host, p, adopt); return; }
    const bar = el('div', 'mv3-vos-bar');
    bar.appendChild(el('span', 'mv3-wk-vsub is-grow', p.scenarioId ? 'the scenario «' + (p.title || 'untitled') + '»' : 'your own text'));
    const other = el('button', 'mv3-wk-vmore u-btn is-s', 'Other script');
    other.type = 'button';
    other.title = 'Take this script off - back to the scenarios and your own text. Once a line is read it is this voiceover\'s for good.';
    other.disabled = VOICE.reading().busy;
    other.addEventListener('click', () => VOS.clearScript(p, adopt));
    bar.appendChild(other);
    host.appendChild(bar);
  }
  // HOW THE TWO COLUMNS WORK, said over the list they are about (the owner, 2026-09-22). It used to
  // sit in grey italics at the foot of the general zone, where somebody scrolling the stages never
  // reached it; here it is the first thing above the script, and it changes with where you are.
  const hint = el('div', 'mv3-wk-fhint', _open < 0
    ? 'Pick a fragment to work on it. Right-click one for more.'
    : 'Press fragment ' + _no(lines, _open) + ' again to come back to the whole video.');
  host.appendChild(hint);
  const list = el('div', 'mv3-wk-flist');
  host.appendChild(list);
  // The video first, numbered 1..N with no gaps; then, at the foot, the lines taken off it - dim,
  // out of the way, each with the one act it has (the owner, 2026-09-22). They keep their real
  // places in the script underneath, which is why nothing above them moved when they went.
  const live = liveLines(lines);
  live.forEach((x, pos) => list.appendChild(_row(p, x.l, x.i, pos + 1)));
  const off = lines.map((l, i) => ({ l, i })).filter(x => !isLive(x.l));
  if (off.length) {
    list.appendChild(el('div', 'mv3-wk-flabel is-off', 'Taken off the script'));
    off.forEach(x => list.appendChild(_offRow(x.l, x.i)));
  }
  // Where it stood before this paint - a repaint rebuilds the column, and a rebuilt column starts
  // at the top. The column is in the panel by now, so the offset takes.
  softScroll(list);                         // a gentler wheel in setup (V5)
  list.addEventListener('scroll', () => { _listAt = list.scrollTop; }, { passive: true });
  if (_listAt) list.scrollTop = _listAt;
}

// ── SEEDANCE'S PROMPTS (phase V26.8, part 4) ────────────────────────────────
// The lines Seedance films, as the server works them out (routes/scen3.js _sdView): every read line - by the voice
// sample, every line with words - a line is a fragment of its own (the sixth round) - each with its frame, the seconds
// of its clip, its prompt and its takes.
const _sdFrags = (p) => (Array.isArray(p && p.sdFrags) ? p.sdFrags : []);
const _sdFragOf = (p, i) => _sdFrags(p).find(f => f.line === i) || null;
// The ones whose prompt is to be written: none yet, or written for other settings and not edited by hand. A line too long
// for the model's clip is not filmed at all.
const _sdNeeds = (p) => _sdFrags(p).filter(f => !f.tooLong && !f.noRead && (!f.prompt || (f.stale && !f.edited)));
const _sdWriting = new Set();             // the lines being written now ('*' - the field's whole run)

async function _writeSd(p, only) {
  const tag = only ? only.join(',') : '*';
  if (_sdWriting.has(tag)) return;
  _sdWriting.add(tag);
  _readErr = '';
  _ctx.repaint();
  try {
    const r = await _post('/api/scen3/sd/prompts', only ? { projectId: p.id, lines: only } : { projectId: p.id });
    _adopt(r);
    const bad = ((r.report || {}).failed || [])[0];
    if (bad) _readErr = 'The prompt of fragment ' + bad.n + ' was not written: ' + bad.error;
  } catch (e) {
    _readErr = 'The prompts were not written: ' + e.message;
  }
  _sdWriting.delete(tag);
  _ctx.repaint();
}
async function _saveSdPrompt(p, line, body) {
  try { _adopt(await _post('/api/scen3/sd/prompt', { projectId: p.id, line, ...body })); }
  catch (e) { _readErr = 'The prompt was not saved: ' + e.message; }
  _ctx.repaint();
}
const _sdBusy = (f) => _sdWriting.has('*') || _sdWriting.has(String(f.line));

// THE SEEDANCE PROMPT of a line, beside its clip: the whole prompt as it goes to Seedance - the pictures named
// (@Image1 the frame, @Image2 the sheet, @Audio1 the sound), the words with their seconds, the performance, the camera,
// the place - editable; one edited by hand is never written over; `write` asks the writer for this fragment alone.
function _sdPromptCol(p, f) {
  const col = el('div', 'mv3-wk-fcol is-motion');
  if (!f) {
    col.appendChild(_colHead('seedance prompt'));
    const dead = _dead(9, _bySample() ? 'This line has no words yet.' : 'Read this line first - Seedance hears its read, and the clip is as long as it.');
    dead.classList.add('is-tall');
    col.appendChild(dead);
    return col;
  }
  const busy = _sdBusy(f);
  const act = el('span', 'mv3-wk-fedited-row');
  if (f.edited) act.appendChild(el('span', 'mv3-wk-fedited', 'Edited by hand'));
  if (f.stale) {
    const s = el('span', 'mv3-wk-fstale', 'Written for other settings');
    s.title = 'The frame, the mood, the gestures, the sound, the place, the words, the read or the voice changed since it was written';
    act.appendChild(s);
  }
  if (f.edited && f.hasAgent) {
    const back = el('button', 'mv3-wk-flink', 'Use the writer’s');
    back.type = 'button';
    back.addEventListener('click', () => { delete _drafts['sd:' + f.line]; _saveSdPrompt(p, f.line, { useAgent: true }); });
    act.appendChild(back);
  }
  const w = el('button', 'mv3-wk-flink', busy ? 'writing…' : f.prompt ? 'write again' : 'write');
  w.type = 'button';
  w.disabled = busy || f.tooLong || f.noRead || !_video().mood;
  w.title = f.tooLong ? 'This line is longer than the model takes - it is not filmed'
    : f.noRead ? 'Read this line first - Seedance hears its read'
      : !_video().mood ? 'Choose the mood first (field 1)'
        : 'The writer looks at the frame and the character’s sheet and writes this line’s prompt - credits, seconds'
        + (f.edited ? '. It replaces what was edited by hand.' : '');
  w.addEventListener('click', () => { delete _drafts['sd:' + f.line]; _writeSd(p, [f.line]); });
  act.appendChild(w);
  col.appendChild(_colHead('seedance prompt', act));
  const box = _textField('sd', f.line, f.prompt || '', 9,
    busy ? 'The writer is writing this fragment’s prompt…'
      : 'Not written yet. Press write - or generate in the video field writes every line’s. '
        + (f.secs > 0 ? 'Its clip is ' + f.secs + ' s. ' : 'Seedance picks its length. ')
        + 'It is written from the line, the frame it opens on, the character’s sheet, the mood and the gestures.',
    (v) => _saveSdPrompt(p, f.line, { prompt: v }));
  box.classList.add('is-tall');
  box.disabled = busy;
  col.appendChild(box);
  return col;
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
  meta.appendChild(el('span', 'mv3-wk-ldur', !_bySample() && take && take.dur ? take.dur.toFixed(1) + 's' : ''));
  row.appendChild(meta);
  // The read, playable from the row (owner, 2026-09-21): hearing a line is how it is judged, and
  // the row is where the eye already is. It PLAYS AND NOTHING ELSE (the owner, 2026-10-10): the
  // fragment does not open and the stage does not change - it used to bring the fragment forward
  // (Y5), which turned listening down the script into opening every line of it.
  // (the sixth round) By the voice sample a line is not read: no play, no read.
  if (!_bySample()) {
    row.appendChild(_playBtn(take && take.path ? take.path : '', 'the read'));
    // ...and READ IT, beside its play (the owner, 2026-10-10).
    row.appendChild(_rowRead(p, l, i));
  }

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
  if (!_bySample()) dot(VOICE.reading().lines.includes(i) ? 'busy' : _readState(l), 'read');
  dot(fr ? 'ok' : 'none', 'frame');
  dot(_clipping.has(i) ? 'busy' : _clipState(p, l, i), 'clip');
  row.appendChild(dots);

  // (phase V61, the owner 2026-10-30: "в правом столбце давай отображать полностью текста реплик. при наведении не
  // показываем всплывашку с полным текстом") The row shows every word of the line; nothing opens on the pointer.
  // What a line can have DONE to it, out of the way of the list (the owner, 2026-09-22): read it
  // again, or take it off the script. The press OPENS this fragment first - a menu about a line you
  // are not looking at is a menu applied to the wrong one - and opening is all it does: a second
  // right-click on the open line does not shut it, unlike a left one.
  row.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (row.closest('.is-locked')) return;           // (phase V61, (т2)) no who / where yet - the rows do nothing
    if (_open !== i || _inserting >= 0) { _open = i; _inserting = -1; _picking = false; _pickView = ''; _setPick = ''; _stagePick = ''; _stageFor = i; _remember(); _ctx.repaint(); }
    _rowMenu(e, row, p, l, i, n);
  });
  // (phase V26.8, the owner 2026-10-13) A LINE PUT IN under this one: a "+" in a square on the middle of the row's bottom
  // border - half on the row, half over the one below, nothing moved - while the pointer is on the row.
  row.appendChild(_insPlus(i));
  // Pressing the open one again closes it: the right column then speaks for the whole script.
  row.addEventListener('click', () => {
    if (row.closest('.is-locked')) return;           // (phase V61, (т2))
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
const _insBusy = () => (VOICE.reading().busy ? 'the voice is busy' : _clipping.size ? 'a clip is being made'
  : _writing ? 'the video is being written for' : '');
function _insPlus(i) {
  const why = _insBusy();
  const plus = el('span', 'mv3-wk-fins u-btn is-icon' + (why ? ' is-off' : ''));   // (V73 block 5, 5d) not gold
  plus.innerHTML = icon('plus', 12);
  plus.setAttribute('role', 'button');
  plus.title = why ? 'Not now: ' + why : 'Put a new line in under this one';
  plus.addEventListener('click', (e) => {
    e.stopPropagation();
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
  host.appendChild(el('div', 'mv3-wk-flabel', 'A new line after fragment ' + _no(lines, after)));
  host.appendChild(el('div', 'mv3-wk-fwhy', 'After: “' + (_words(lines[after]) || '').slice(0, 160) + '”'));
  const box = el('textarea', 'mv3-wk-ledit is-frag u-area is-s');
  box.rows = 3;
  box.placeholder = 'The words of the new line';
  box.value = _insDraft;
  box.disabled = _insSaving;
  const count = _voCount(p, box);
  box.addEventListener('input', () => { _insDraft = box.value; save.disabled = _insSaving || !box.value.trim(); if (count) count(); });
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); cancel(); }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); _insertLine(p, after); }
  });
  host.appendChild(box);
  const acts = el('div', 'mv3-wk-vfoot is-tight');
  const save = el('button', 'mv3-wk-vuse u-btn is-s', _insSaving ? 'putting it in…' : 'put it in');
  save.type = 'button';
  save.title = 'Put the line in (Ctrl+Enter)';
  save.disabled = _insSaving || !_insDraft.trim();
  save.addEventListener('click', () => _insertLine(p, after));
  const drop = el('button', 'mv3-wk-vuse u-btn is-s', 'Cancel');
  drop.type = 'button';
  drop.disabled = _insSaving;
  drop.addEventListener('click', cancel);
  acts.append(save, drop);
  host.appendChild(acts);
  host.appendChild(el('div', 'mv3-wk-fwhy', _isVo(p) ? 'Then, in its line: mood - its [tags] - and read.'
    : 'It takes the next frame of the set. Then, in its fragment: mood - its [tags] - and read.'));
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
  const back = el('button', 'mv3-wk-vuse u-btn is-s', 'Restore');
  back.type = 'button';
  back.title = 'Put this line back where it was in the script';
  back.disabled = _offing;
  back.addEventListener('click', () => _setOff(i, false));
  row.appendChild(back);
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
  const b = el('button', 'mv3-wk-vplay is-send u-btn is-s is-icon' + (reading ? ' is-busy' : ''));
  b.innerHTML = icon(reading ? 'loader-circle' : has ? 'rotate-cw' : 'mic', 10);   // (V73 block 5, 5d) in place of … ↻ ➤
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
  const inp = el('input', 'mv3-wk-vnum u-in is-s');
  inp.type = 'number';
  inp.min = String(SPEED.min);
  inp.max = String(SPEED.max);
  inp.step = String(SPEED.step);
  inp.value = String(VOICE.speedOf(p, l));
  inp.disabled = _saving || VOICE.reading().busy;
  _speedLater(inp, 'line' + i, () => VOICE.speedOf(_ctx.project, (_ctx.project.lines || [])[i]), v => ({ line: i, lineSpeed: v }));
  box.append(el('span', '', 'Speed'), inp);
  if (own) {
    const back = el('button', 'mv3-wk-vback u-btn is-s is-icon is-quiet');
    back.innerHTML = icon('rotate-ccw', 12);
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
  // (phase V73 block 4) the one window frame (css/app-shell.css .u-win): its head - "Fragment N · its clips", the 28 px ✕
  const box = el('div', 'mv3-wk-cwin-box u-win is-float');
  const head = el('div', 'mv3-wk-cwin-head u-win-head');
  head.appendChild(el('span', 'u-win-title', 'Fragment ' + n + ' · its clips'));
  const x = el('button', 'mv3-wk-cwin-x u-btn is-icon is-quiet u-x', '');
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
    if (stale) meta.appendChild(el('span', 'mv3-wk-fstale', 'Stale'));
    if (on) meta.appendChild(el('span', 'mv3-wk-vtag', 'The clip'));
    else {
      const use = el('button', 'mv3-wk-vuse u-btn is-s', 'Use');
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
// page keeps its own shortcuts. It holds what a line can have DONE to it: read (again), choose a
// clip, remove - the read is also on the row itself and in the open fragment (_readAct).
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
    : !VOICE.canSpeak(p) ? 'mark the script up first - field 1'
      : busy ? 'the voice is busy' : '';
  const va = _api.voiceApi();
  return { label: rs === 'none' ? 'Read' : 'Read again', why, on: why ? null : () => VOICE.readLine(va, i) };
}

function _rowMenu(ev, row, p, l, i, n) {
  _closeMenu();
  const box = el('div', 'mv3-plus-menu u-menu is-float');
  const item = (label, sub, on, danger) => {
    const b = el('button', 'mv3-plus-item u-mi' + (danger ? ' is-danger' : ''));
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
  if (!_isVo(p)) {
    item('choose a clip', clips.length ? clips.length + (clips.length === 1 ? ' take' : ' takes') + ' · watch and pick' : 'no clips yet',
      clips.length ? () => _clipWindow(p, l, i, n) : null);
  }

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

// ── The right column: the open fragment ─────────────────────────────────────
// Its words and its read on top, then two grids - the pictures of a fragment, what it opens on and
// what it becomes, on the left, each with its prompt beside it - and the pick of frames between them:
//
//   | frame  (from the pool, or picked)  |  frame prompt                         |
//   | the frames to pick from                                                   |
//   | clip   + make clip                 |  animation prompt (or Seedance's)    |
//
// and every take the line has under them.
function _fragment(host, p, l, i) {
  const take = _take(l);
  // (phase V26.5, the owner 2026-10-10) ITS CROSS, top right in gold: the fragment closes - to the whole video. A second press
  // on its row does the same, as before.
  const shut = el('button', 'mv3-wk-fclose', '✕');
  shut.type = 'button';
  shut.title = 'Close this fragment - back to the whole video';
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
    const box = el('textarea', 'mv3-wk-ledit is-frag u-area is-s');
    box.value = _wordsDraft;
    box.rows = _isVo(p) ? 12 : 3;
    const count = _voCount(p, box);
    box.addEventListener('input', () => { _wordsDraft = box.value; if (count) count(); });
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); _editWords = -1; _ctx.repaint(); }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); _saveWords(va, i); }
    });
    host.appendChild(box);
    const acts = el('div', 'mv3-wk-vfoot is-tight');
    const save = el('button', 'mv3-wk-vuse u-btn is-s', 'Save');
    save.type = 'button';
    save.title = 'Save the words (Ctrl+Enter)';
    save.addEventListener('click', () => _saveWords(va, i));
    const drop = el('button', 'mv3-wk-vuse u-btn is-s', 'Cancel');
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
    const mb = el('button', 'mv3-wk-fread u-btn is-s' + (marked ? '' : ' is-need'), g.tagging ? 'mood…' : 'mood');
    mb.type = 'button';
    mb.disabled = g.busy || !_video().mood;
    mb.title = !_video().mood ? 'Choose the mood first (field 1)' : g.busy ? 'The voice is busy'
      : marked ? 'Mark this line up again by the mood of the video - its [tags], keeping the arc of the lines around it'
        : 'This line has no [tags] yet: mark it up by the mood of the video - it is read from them';
    mb.addEventListener('click', () => { if (!mb.disabled) { mb.disabled = true; VOICE.tagLine(va, i); } });
    row.appendChild(mb);
    // (the sixth round) By the voice sample a line is not read: its read, its speed and its play are not here.
    if (!_bySample()) {
      const ra = _readAct(p, l, i);
      const reading = (VOICE.reading().lines || []).includes(i);
      const rb = el('button', 'mv3-wk-fread u-btn is-s' + (ra.on ? '' : ' is-off'), reading ? 'reading…' : ra.label);
      rb.type = 'button';
      rb.disabled = !ra.on || reading;
      rb.title = reading ? 'This line is being read' : ra.why ? 'Cannot read now: ' + ra.why
        : (ra.label === 'Read' ? 'Read this line in the chosen voice' : 'Read this line again - in place of the take it has');
      if (ra.on) rb.addEventListener('click', () => { if (!rb.disabled) { rb.disabled = true; ra.on(); } });
      row.appendChild(rb);
      // THE LINE'S OWN SPEED and its play, between the read and the words (the owner, 2026-10-10): a new
      // speed retimes this read at once - the timeline and the play follow.
      row.appendChild(_lineSpeed(p, l, i));
      row.appendChild(_playBtn(take && take.path ? take.path : '', 'the read'));
    }
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
  // (the owner's answer (я17)) A long line by the voice sample: a word, no refusal - its length is not estimated.
  const sdl = _seedance() ? _sdFragOf(p, i) : null;
  if (sdl && sdl.long) {
    host.appendChild(_note('A long line - Seedance may not say all of it in one clip of ' + _ceiling() + ' s'
      + (_ceiling() < 30 ? ' (seedance 2.5 takes up to 30 s)' : '') + '. It goes as it is.', true));
  }
  if (rs === 'stale' && !_bySample()) {
    host.appendChild(_note('The words changed after this line was read - read it again, or put the words back.', true));
    const back = el('button', 'mv3-wk-lback is-frag u-btn is-s', 'Put the words back');
    back.type = 'button';
    back.title = 'Restore the line to what the take says';
    back.disabled = busyRead;
    back.addEventListener('click', () => VOICE.saveText(va, i, take.said));
    host.appendChild(back);
  }
  // (phase V62) A voiceover's line is its words and its read - no frame, no clip, no takes.
  if (_isVo(p)) return;

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
  // (phase V26.8) Filmed by Seedance, a line is a fragment of its own: its Seedance prompt in place of Kling's.
  grid2.appendChild(_seedance() ? _sdPromptCol(p, _sdFragOf(p, i)) : _motionCol(l, i, hasFrame));

  _takes(host, p, l, i);
}

// Every take the line has, under the grid: a fragment can have a clip per frame it was tried on,
// and one of them is the fragment's (F4). Pressing a row makes it that one. (phase V26.8) A Seedance line's takes too.
function _takes(host, p, l, i) {
  const clips = _clipsOf(p, l);
  if (clips.length) {
    host.appendChild(el('div', 'mv3-wk-flabel', 'Takes'));
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
      r.appendChild(el('span', 'mv3-wk-vname')).appendChild(figures('Take · ' + (c.dur ? c.dur.toFixed(1) + ' s' : '')));
      if (stale) r.appendChild(el('span', 'mv3-wk-fstale', 'Stale'));
      if (on) r.appendChild(el('span', 'mv3-wk-vtag', 'The clip'));
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
// the engine was actually told. Editable: the picture is already drawn and does not change; the
// words are kept with the frame (routes/scen3.js, /scen3/frames/prompt).
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
    : _dead(7, 'No frame yet. Frames are asked for in the frames chat, in the general zone - press this fragment again to get there.');
  box.classList.add('is-tall');
  col.appendChild(box);
  return col;
}

// A field that is only there to say what will be in it: same box, same height, no typing.
function _dead(rows, placeholder) {
  const box = el('textarea', 'mv3-wk-ftext-in u-area is-s');
  box.rows = rows;
  box.placeholder = placeholder;
  box.value = '';
  box.disabled = true;
  return box;
}

// A column's heading: a small label, and - on a prompt's column - the one action it has.
function _colHead(label, action) {
  const h = el('div', 'mv3-wk-flabel is-row');
  h.appendChild(el('span', '', _cap(label)));
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
    box.appendChild(el('span', '', 'no frames yet'));
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
  bar.appendChild(el('span', 'mv3-wk-fpick-t')).appendChild(figures(fr
    ? (auto ? 'Frame ' + (pool.findIndex(v => v.id === fr.id) + 1) + ' of ' + pool.length + ' · from the set, in turn' : 'Frame picked by hand')
    : 'No frame yet'));
  bar.appendChild(el('span', 'mv3-wk-fpick-c')).appendChild(iconEl(_picking ? 'chevron-up' : 'chevron-down', 12));
  bar.addEventListener('click', () => { _picking = !_picking; _pickView = ''; _ctx.repaint(); });
  host.appendChild(bar);
  if (!_picking) return;

  const list = el('div', 'mv3-wk-fpicklist');
  // The rule itself, as the first choice: hand the line back to "the pool in turn".
  if (!auto) {
    const back = el('button', 'mv3-wk-fpickrule');
    back.type = 'button';
    back.textContent = 'Back to the rule - the set in turn';
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
      const sel = el('button', 'mv3-wk-tileact is-pick u-btn is-s is-main', fr && v.id === fr.id ? 'this one' : 'select');
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
    if (sh && sh.motionEdited) action.appendChild(el('span', 'mv3-wk-fedited', 'Edited by hand'));
    if (staleWords) {
      const s = el('span', 'mv3-wk-fstale', 'The words changed');
      s.title = 'It was written for: “' + String(sh.said || '').slice(0, 120) + '”';
      action.appendChild(s);
    }
    if (sh && sh.motionEdited && sh.motionAgent) {
      const back = el('button', 'mv3-wk-flink', 'Use the agent’s');
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
// The frame speaks the read: the picture, the take and the line's animation prompt go to Kling avatar
// (a Seedance project's line goes with its Seedance prompt) and the SERVER sees it through
// (routes/scen3.js, /scen3/fragments/clip). This panel only asks and
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
  // (phase V26.8) A Seedance take is chosen among the line's Seedance takes (/scen3/sd/pick).
  const route = _seedance() ? '/api/scen3/sd/pick' : '/api/scen3/fragments/pick-clip';
  try { _adopt(await _post(route, { projectId: p.id, line: i, clipId })); }
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
  let price = '';
  // (phase V26.8, part 5) A line filmed by Seedance: its own reasons, its seconds and its price.
  const sf = _seedance() ? _sdFragOf(p, i) : null;
  const vlock = _voiceLock(p);
  if (vlock) cap = vlock.replace(/\.$/, '').toLowerCase();      // (phase V61, (т5))
  else if (_seedance()) {
    if (!sf || sf.noRead) cap = _bySample() ? 'this line has no words' : 'read this line first';
    else if (_bySample() && _needs(p).voice) cap = _demoFor ? 'the voice demo is being made…' : 'choose ' + _needs(p).voice + ' first (field 1)';
    else if (sf.tooLong) cap = sf.dur.toFixed(1) + ' s - longer than ' + (((_modelOf() || {}).label) || 'the model') + ' takes';
    else if (!fr) cap = 'make a frame in the frames chat first';
    else if (!_video().quality) cap = 'choose the quality of the clips first (field 3)';
    else if (!((p.casting || {}).obrazImage)) cap = 'choose the character in a look first';
    else if (sf.secs > 0) { ready = true; price = tier ? _money(sf.secs * tier.pricePerSec) : ''; cap = sf.secs + ' s · ' + (price || '…'); }
    else { ready = true; cap = 'Seedance picks the length'; }   // by the voice sample: no price (the owner's answer (я10))
  } else if (rs !== 'ok') cap = 'read this line first';
  else if (!fr) cap = 'make a frame in the frames chat first';
  else if (!_video().model) cap = 'choose the model of the clips first (field 3)';
  else if (!_video().quality) cap = 'choose the quality of the clips first (field 3)';
  else if (take.dur > _ceiling()) cap = 'too long for Kling (' + take.dur.toFixed(1) + ' s) - split the line';
  else { ready = true; cap = take.dur.toFixed(1) + ' s · ' + (tier ? _money(_clipCost(take.dur, tier)) : '…'); }
  if (!sf && ready && tier) price = _money(_clipCost(take.dur, tier));
  // The one paid press in a fragment: the price first, the clip on the second press.
  const make = el('button', 'mv3-wk-vmore is-small is-media u-btn is-s' + (ready ? ' is-go' : ''),
    busy ? 'making…' : _armedClip === i ? (price ? price + '?' : 'go?') : c ? 'again' : 'make clip');
  make.type = 'button';
  make.disabled = !ready || busy;
  if (_armedClip === i && !busy) make.classList.add('is-armed');   // (phase V73 block 2) paid, armed: the light step
  // What the press will actually do: with nothing written yet it is two analyses and then the
  // clip, and that is worth saying before it takes half a minute (phase U4).
  const needsWords = sf ? (!sf.prompt || (sf.stale && !sf.edited) || !_envMotion(p)) : (!_animated(l) || !_envMotion(p));
  make.title = !ready ? cap
    : sf ? (needsWords ? 'First the place and this line’s prompt are written (credits), then the clip. ' : '')
      + 'Seedance: the frame this line opens on, the character’s sheet and its sound go with its prompt. '
      + (sf.secs > 0 ? sf.secs + ' s at ' + (tier ? '$' + tier.pricePerSec + '/s' : '?') + ' = ' + price + '.'
        : 'Seedance picks the length and bills the seconds it makes.') + ' Press again to confirm.'
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
  col.appendChild(el('div', 'mv3-wk-fcap' + (ready ? '' : ' is-why'))).appendChild(figures(
    busy ? (stage || 'making the clip…') : (ready && needsWords) ? (sf ? 'the prompt, then ' : 'analysis, then ') + cap : cap));
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
  const box = el('textarea', 'mv3-wk-ftext-in u-area is-s');
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
// The open fragment: its clip when it has one (played on the stage, its poster while it opens), else
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
          { label: _cropBusy ? 'Cutting…' : 'Apply', go: true, busy: _cropBusy,
            title: 'Cut the picture to the selection. The cut joins the set, beside this frame, and is saved in the project.',
            on: (rect) => _cropApply(p, fr, rect) },
          { label: 'Cancel', busy: _cropBusy, title: 'Leave the frame as it is', on: () => { _cropOn = ''; _ctx.repaint(); } },
        ]
        : [{ label: 'Crop', title: 'Reframe this picture - drag a selection, and the cut joins the set as a frame of its own. It keeps the format of the project.',
          on: () => { _cropOn = fr.id; _ctx.repaint(); } }],
    };
  }
  const c = _clipOf(p, l, _open);
  const fr = _frameFor(p, l, _open).v;
  const name = 'fragment ' + _no(lines, _open);
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
  _closeMenu();
  FCHAT.close();                          // (phase V61) the frames chat's window goes with the step; what is written stays
}
