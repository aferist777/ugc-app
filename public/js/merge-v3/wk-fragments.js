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
import { takeOf, isRead } from './scen-api.js';
import * as VOICE from './wk-voice.js';
import { derived } from '../chars-store.js';
import { el, holdProgress, endProgress, onlyHere, showPicture } from './wk-maker.js';

// What a frame costs: nano-banana-2 at 2K on kie (lib/mv3-img.js, the price table). Said beside the
// button so nothing is spent on a surprise.
const FRAME_PRICE = 0.06;
// The one ceiling a read has for Kling avatar, from the tier (lib/motion-presets.js) - read from
// the kit when it has arrived, this only until then.
const CEILING_FALLBACK = 30;

const KEY = 'mv3_frag_open_v1';          // { <timeline key>: <open line> } - where you were, per project
const ZKEY = 'mv3_zones_v1';             // { <timeline key>: { voice, frames, video } } - a zone opened or shut by hand
const TIP_MS = 320;                      // hover before a row's whole text appears

let _ctx = null;
let _api = null;                          // what the step lends: the character cast, the voice, the shelves
// The open line, 0-based. -1 is NONE open - the right column then speaks for every fragment at
// once (owner, 2026-09-18). null is "not decided yet", before the project is known.
let _open = null;
let _editWords = -1;                      // the line whose words are open for editing, in the right column
let _wordsDraft = '';
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
let _armedSet = false;                    // the set's `generate` pressed once and asking
let _dragging = '';                       // the frame being dragged along the strip
let _picking = false;                     // the open fragment's frame list is down
let _pickView = '';                       // ...and the frame being looked at in it, on the stage
let _lookedAt = '';                       // the project the journal was last asked about
let _setPick = '';                        // a frame of the pool pressed in the general zone: shown on the stage
const FRAME_ESTIMATE_MS = 75000;          // what the countdown starts from; it learns from real runs

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

// ── The zones of the general zone, open or shut ─────────────────────────────
// Each stage is a drawer (the owner, 2026-09-21): open while there is work in it, shut by itself
// once its work is done - every line read, the set drawn - or while it cannot be worked (no
// character in a look, no environment), and open or shut by hand, which is remembered per project.
// A zone that finishes lets go of the hand's choice: "done" shuts it whatever it was.
let _zoneWas = {};                        // { <zone>: done } as last painted, to catch the finish
function _zoneChoice() {
  try { return (JSON.parse(localStorage.getItem(ZKEY) || '{}') || {})[_key] || {}; } catch (e) { return {}; }
}
function _setZone(id, open) {
  try {
    const all = JSON.parse(localStorage.getItem(ZKEY) || '{}') || {};
    all[_key] = { ...(all[_key] || {}), [id]: !!open };
    localStorage.setItem(ZKEY, JSON.stringify(all));
  } catch (e) { /* a private window */ }
}
function _forgetZone(id) {
  try {
    const all = JSON.parse(localStorage.getItem(ZKEY) || '{}') || {};
    if (all[_key] && id in all[_key]) { delete all[_key][id]; localStorage.setItem(ZKEY, JSON.stringify(all)); }
  } catch (e) { /* a private window */ }
}
// Open or shut, for this paint. Blocked is shut, and not to be opened; done is shut unless opened
// by hand AFTER it was done; otherwise the hand's choice, else open.
function _zoneOpen(id, done, blocked) {
  if (blocked) return false;
  if (done && _zoneWas[id] === false) _forgetZone(id);    // just finished: it shuts, whatever the hand said
  _zoneWas[id] = !!done;
  const choice = _zoneChoice();
  if (typeof choice[id] === 'boolean') return choice[id];
  return !done;
}

// ── What a line has ─────────────────────────────────────────────────────────
// The same rules the server applies when it builds the cut (routes/scen3.js, _cutClips): a read or a
// clip made from words that have since been edited is not this line's any more. The read is the
// take the line is read BY - tagged when the line has tags (js/merge-v3/scen-api.js, takeOf).
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
  const at = spread === 'random' ? _seed(String((p || {}).id || '') + ':' + i) % pool.length : i % pool.length;
  return { v: pool[at], auto: true };
}
/** The rule, for a stand to check (the timeline mirror will read the same rule, phase T'). */
export const frameFor = _frameFor;
function _clipOf(l) {
  const clips = ((l && l.video) || {}).plain || [];
  if (!clips.length) return null;
  const fr = String(l.frameId || '');
  const picked = clips.find(c => c.id === String(((l.pick || {}).plain) || ''));
  if (picked && picked.fromFrame === fr) return picked;
  const mine = clips.filter(c => c.fromFrame === fr);
  return mine.length ? mine[mine.length - 1] : null;
}
function _clipState(l) {
  const c = _clipOf(l);
  if (!c) return 'none';
  return c.said === _words(l) ? 'ok' : 'stale';
}

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
function _playBtn(src, what) {
  const b = el('button', 'mv3-wk-vplay is-read', '▶');
  b.type = 'button';
  b.disabled = !src;
  b.dataset.src = src || '';
  b.title = src ? 'Play ' + what : 'Not read yet';
  b.addEventListener('click', (e) => { e.stopPropagation(); _play(src); });
  return b;
}

// ── The kit: tiers, moods, the mannequins and the shot sizes of a set ───────
function _loadKit(repaint) {
  if (_kitState !== 'idle') return;
  _kitState = 'loading';
  const get = (u) => fetch(u).then(r => r.json()).catch(() => null);
  Promise.all([get('/api/scen3/motion-presets'), get('/api/scen3/poses'), get('/api/scen3/frame-sets')]).then(([m, p, s]) => {
    _kit = {
      qualities: (m && m.qualities) || [],
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
    _readErr = 'A frame failed: ' + e.message;
  }
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

// The video zone's `generate` (phase W3b): the place, if it has nothing written yet, and then the
// animation of every line that needs one - one call for the whole script, so the movement carries
// the arc of it. Credits, not dollars: no second press.
let _writing = '';                        // 'place' | 'lines' | ''
async function _writeVideo(p) {
  if (_writing || _envWriting) return;
  _readErr = '';
  if (!_envMotion(p)) {
    _writing = 'place';
    await _saveEnvMotion(p, null);
    if (_readErr) { _writing = ''; return _ctx.repaint(); }
  }
  _writing = 'lines';
  _ctx.repaint();
  try {
    const r = await _post('/api/scen3/video/prompts', { projectId: p.id });
    _adopt(r);
    const skipped = ((r.report || {}).skipped || []).length;
    if (skipped) _readErr = 'The agent left ' + skipped + (skipped === 1 ? ' line' : ' lines') + ' without a prompt - press generate again.';
  } catch (e) {
    _readErr = 'The animation was not written: ' + e.message;
  }
  _writing = '';
  _ctx.repaint();
}

// The prompt a frame was drawn from, edited by hand: the picture does not change - it is drawn -
// but a redraw of this frame will be asked for what is written here.
async function _saveFramePrompt(p, frameId, prompt) {
  try { _adopt(await _post('/api/scen3/frames/prompt', { projectId: p.id, frameId, prompt })); }
  catch (e) { _readErr = 'The prompt was not saved: ' + e.message; }
  _ctx.repaint();
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
const _tier = () => ((_kit && _kit.qualities) || []).find(q => q.id === _video().quality) || ((_kit && _kit.qualities) || [])[0] || null;
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
export function paint(host, ctx, api) {
  _ctx = ctx;
  _api = api;
  const p = ctx.project;
  if (!p) { host.appendChild(_note('Reading the project…')); return; }
  if (_kit === null) _loadKit(ctx.repaint);
  const lines = Array.isArray(p.lines) ? p.lines : [];

  // Which fragment is open: the address first (it is the newer instruction), then where this
  // project was left, then the general zone.
  if (_key !== ctx.key) { _key = ctx.key; _open = null; _listAt = 0; _editWords = -1; _zoneWas = {}; _tipHide(); }
  if (_open === null) _open = _asked >= 0 ? _asked : _remembered();
  _asked = -1;
  if (_open >= lines.length) _open = lines.length ? 0 : -1;

  host.classList.add('is-split');
  const left = el('div', 'mv3-wk-half is-frags');
  host.appendChild(left);
  const right = el('div', 'mv3-wk-half is-guide is-frag');
  host.appendChild(right);

  _pickUpDrawing();
  // The list is the script and nothing else (owner, 2026-09-21): the voice stands in its own field
  // on the right, with everything else that is set once for the whole video.
  _list(left, p, lines);

  // The right column: the voices being chosen, the open line, or the whole video. Where the whole
  // script stands is over it in every case (the owner, 2026-09-21) - it is the one thing that is
  // about all of them at once.
  _counters(right, p, lines);
  if (api.view() === 'voice') { VOICE.paintPicker(right, api.voiceApi()); return; }
  _notes(right);
  if (!lines.length) {
    right.appendChild(_note('This project has no lines. The script is written on the Scenarios page and comes with the project.'));
    return;
  }
  if (_open < 0) _all(right, p, lines);
  else _fragment(right, p, lines[_open], _open);
  // The countdown belongs to the set being drawn, on the stage of the general zone.
  const place = _open < 0 && _drawing.size ? 'frames' : null;
  onlyHere(place);
  if (place) {
    const first = [..._drawing.values()].reduce((a, d) => Math.min(a, d.startedAt), Date.now());
    holdProgress(place, { label: 'Drawing ' + _drawing.size + (_drawing.size === 1 ? ' frame' : ' frames'), estimateMs: FRAME_ESTIMATE_MS, startedAt: first });
  }
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

// ── The general zone: the whole video, in three stages ──────────────────────
// (Decided with the owner 2026-09-21, docs/local-app/PLAN.md, phase W.) The one mood every stage
// reads from, in gold; then three zones in gold, one above the other - voice, first frames, video -
// each a drawer with its own `generate` at the foot. The counters and `generate all` stand in the
// panel's header, whatever the panel shows (W2.5).
function _all(host, p, lines) {
  _mood(host);
  _stageVoice(host, p, lines);
  _stageFrames(host, p);
  _stageVideo(host, p, lines);
  host.appendChild(el('div', 'mv3-wk-fsoon', 'Pick a fragment on the left to work on it; press it again to come back here.'));
}

// One zone: a gold frame, a head that opens and shuts it, and - open - a body and a foot with the
// zone's own `generate`. `spec`: name, sub (what it is, while open), summary (where it stands, while
// shut), done, blocked with its why, soon (under development: dashed).
function _stage(host, id, spec) {
  // `keepOpen`: a zone that is finished but still the thing being looked at (the frames). It gets
  // its tick, and it stays open until somebody shuts it.
  const open = _zoneOpen(id, !!spec.done && !spec.keepOpen, !!spec.blocked);
  // Blocked outranks done: a pool made before the character was taken off is not a zone at rest.
  const done = !!spec.done && !spec.blocked;
  const box = el('div', 'mv3-wk-stage' + (spec.soon ? ' is-soon' : '') + (open ? '' : ' is-closed')
    + (spec.blocked ? ' is-blocked' : '') + (done ? ' is-done' : ''));
  const head = el('div', 'mv3-wk-stage-head');
  head.appendChild(el('span', '', spec.name));
  if (done) head.appendChild(el('span', 'mv3-wk-zdone', '✓'));
  const sub = spec.blocked ? 'needs ' + spec.why : (open ? spec.sub : spec.summary) || '';
  if (sub) head.appendChild(el('span', 'mv3-wk-vsub', sub));
  const chev = el('span', 'mv3-wk-zchev', spec.blocked ? '' : open ? '▾' : '▸');
  head.appendChild(chev);
  head.title = spec.blocked ? 'Still missing: ' + spec.why : open ? 'Shut this zone' : 'Open this zone';
  if (!spec.blocked) head.addEventListener('click', () => { _setZone(id, !open); _ctx.repaint(); });
  box.appendChild(head);
  host.appendChild(box);
  if (!open) return { open, body: null, foot: null };
  const body = el('div', 'mv3-wk-stage-body');
  box.appendChild(body);
  const foot = el('div', 'mv3-wk-stage-foot');
  box.appendChild(foot);
  return { open, body, foot };
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

// Where the script stands. The frames are a set, not a line each: what the pool holds over what
// was asked for - the dropdown's number, or more once the pool has grown past it (owner,
// 2026-09-21); "done" is a pool at least that big with nothing still drawing.
function _standing(p) {
  const lines = Array.isArray(p.lines) ? p.lines : [];
  const have = _pool(p).length;
  const asked = Math.max(have + _drawing.size, ((p.video || {}).frames) || 0);
  return {
    n: lines.length,
    read: lines.filter(isRead).length,
    frames: have, framesAsked: asked, framesDone: have >= asked && !_drawing.size && have > 0,
    clips: lines.filter(l => _clipState(l) === 'ok').length,
  };
}

// The counters, over the right column whatever it shows (the owner, 2026-09-21): three boxes -
// read, frames, clips - with the count and its name side by side, and `generate all` at the right
// of the row. Over the column and not in the step's title line, because the title line says what
// the step is.
function _counters(host, p, lines) {
  const s = _standing(p);
  const top = el('div', 'mv3-wk-ftop');
  const stat = el('div', 'mv3-wk-fstats');
  const cell = (num, label, done, title) => {
    const c = el('div', 'mv3-wk-fstat' + (done ? ' is-done' : ''));
    c.appendChild(el('div', 'mv3-wk-fstat-n', num));
    c.appendChild(el('div', 'mv3-wk-fstat-l', label));
    c.title = title;
    stat.appendChild(c);
  };
  const n = lines.length;
  cell(s.read + '/' + n, 'read', n > 0 && s.read === n, 'Lines read, of all the lines');
  cell(s.frames + '/' + s.framesAsked, 'frames', s.framesDone, 'Frames in the pool, of the set asked for');
  cell(s.clips + '/' + n, 'clips', n > 0 && s.clips === n, 'Lines with a clip, of all the lines');
  top.appendChild(stat);
  _chainButton(top, p, lines);
  host.appendChild(top);
}

// ── `generate all`: every stage in one press (phase W3c) ────────────────────
// The voice and the frames do not depend on each other and go TOGETHER; the video waits for both,
// because an animation prompt is written from the frames the lines open on. What the chain will
// spend is said before it starts and confirmed by a second press - the frames are dollars (the
// reads and the prompts are credits), and a set is only drawn when there is none.
let _chain = '';                          // '' | 'voice+frames' | 'video'
let _chainArmed = false;

function _chainWork(p, lines) {
  const missing = _missing(p);
  const pool = _pool(p).length;
  const v = _video();
  const voice = _canRead() ? lines.filter(l => !String(l.tagged || '').trim() || !isRead(l)).length : 0;
  const frames = (!missing.length && !pool && !_drawing.size) ? (v.frames || 4) : 0;
  // The video stage needs a frame to write from: with none in the pool, only a set being drawn now
  // (frames above) can give it one.
  const video = (!missing.length && (pool || frames)) ? lines.filter(l => !_animated(l) && !((l.shot || {}).motionEdited && (l.shot || {}).motion)).length : 0;
  return { missing, voice, frames, video, pool, anything: voice + frames + video > 0 };
}

function _chainButton(host, p, lines) {
  const w = _chainWork(p, lines);
  const busy = !!_chain || VOICE.reading().busy || _planning || _drawing.size > 0 || _envWriting || !!_writing;
  const price = w.frames ? _money(w.frames * FRAME_PRICE) : '';
  const b = el('button', 'mv3-wk-gen mv3-wk-genall',
    _chain === 'voice+frames' ? 'voice, frames…' : _chain === 'video' ? 'video…'
      : _chainArmed ? (price ? price + ' · go?' : 'go?') : 'generate all');
  b.type = 'button';
  b.disabled = busy || !lines.length || (!w.anything && !_chainArmed);
  b.title = w.missing.length
    ? 'The frames and the video need ' + w.missing.join(' and ') + ' - the voice can be read without them'
    : !w.anything ? 'Everything that can be made is made'
      : 'In one press: ' + [
        w.voice ? w.voice + (w.voice === 1 ? ' line read' : ' lines read') : '',
        w.frames ? w.frames + ' frames drawn · ' + price : '',
        w.video ? w.video + (w.video === 1 ? ' animation prompt' : ' animation prompts') : '',
      ].filter(Boolean).join(', ') + '. The voice and the frames together, the video after both.'
      + (price ? ' Press again to confirm - the frames cost money.' : '');
  b.addEventListener('click', () => {
    if (price && !_chainArmed) { _chainArmed = true; _ctx.repaint(); return; }
    _chainArmed = false;
    _generateAll(p, lines);
  });
  host.appendChild(b);
}

// Waiting for the frames to LAND, not just to be asked for: the video stage writes from them.
async function _untilDrawn() {
  for (let k = 0; k < 1200 && _drawing.size; k++) await new Promise(r => setTimeout(r, 500));
}

async function _generateAll(p, lines) {
  if (_chain) return;
  const w = _chainWork(p, lines);
  if (!w.anything) return;
  _readErr = '';
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
    const now = _ctx.project;
    const after = _chainWork(now, Array.isArray(now.lines) ? now.lines : lines);
    if (after.video) await _writeVideo(now);
  } catch (e) {
    _readErr = 'The chain stopped: ' + e.message;
  }
  _chain = '';
  _ctx.repaint();
}

// THE MOOD OF THE VIDEO - the emotion of the whole thing, the one choice the person makes here
// (owner, 2026-09-18) and the one vocabulary every stage reads from (2026-09-21): the tags of the
// read, the expression in the frames, the movement in the clips. Its one line under the menu says
// what the choice means. In a gold frame like the zones (W2.5): it is a setting of the whole video.
function _mood(host) {
  const v = _video();
  const box = el('div', 'mv3-wk-mood');
  const row = el('div', 'mv3-wk-fsets');
  const mood = el('select', 'mv3-wk-vsel is-small is-wide');
  mood.title = 'The emotion of the whole video: the read, the frames and the clips all follow it';
  let now = null;
  for (const m of (_kit && _kit.moods) || []) {
    const o = el('option', '', 'mood: ' + m.label);
    o.value = m.id;
    if (m.id === v.mood) { o.selected = true; now = m; }
    mood.appendChild(o);
  }
  mood.disabled = _saving || !_kit;
  mood.addEventListener('change', () => _saveVideo({ mood: mood.value }));
  row.appendChild(mood);
  box.appendChild(row);
  if (now && now.about) box.appendChild(el('div', 'mv3-wk-mood-about', now.about));
  host.appendChild(box);
}

// VOICE - the first zone, the one the timeline waits for: the voice the script is read in - the
// character's, or the project's own before there is a character - and `generate`, which tags the
// script by the mood and reads every line that needs it, three at a time (ElevenLabs v3). Shut by
// itself once every line is read.
function _stageVoice(host, p, lines) {
  const g = VOICE.reading();
  const read = lines.filter(isRead).length;
  const done = lines.length > 0 && read === lines.length && !g.busy;
  const { open, body, foot } = _stage(host, 'voice', {
    name: 'voice', sub: 'ElevenLabs v3 · tags by the mood', done,
    summary: read + '/' + lines.length + ' read',
  });
  if (!open) return;
  VOICE.paintRow(body, _api.voiceApi());
  const has = _canRead();
  // What the button will do: the lines still to tag, and the lines still to read.
  const untagged = lines.filter(l => !String(l.tagged || '').trim()).length;
  const unread = lines.filter(l => !isRead(l)).length;
  const will = lines.filter(l => !String(l.tagged || '').trim() || !isRead(l)).length;
  const label = g.tagging ? 'tagging…'
    : g.batch ? 'reading ' + g.batch.done + ' of ' + g.batch.total + '…'
      : g.lines.length ? 'reading…' : 'generate';
  _genButton(foot, {
    label,
    cap: !has || !lines.length ? '' : g.busy ? '' : will ? will + (will === 1 ? ' line' : ' lines') + (untagged ? ' · tags first' : '') + ' · three at a time' : 'every line is read',
    disabled: !has || g.busy || !lines.length || !will,
    title: !has ? 'Choose a voice first - a character with one, or one for the project' : !will ? 'Every line is tagged and read'
      : 'Tags by the mood where they are missing (' + untagged + '), then every line that needs reading (' + unread + '), three at a time - ElevenLabs v3',
    on: () => VOICE.generate(_api.voiceApi()),
  });
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
  // The frames zone does NOT shut itself when a set finishes (the owner, 2026-09-21): the frames
  // are what is looked at the moment they arrive. It opens and shuts by hand like the others.
  const { open, body, foot } = _stage(host, 'frames', {
    name: 'first frames', sub: 'a set for the whole video', done: s.framesDone, keepOpen: true,
    blocked, why: missing.join(' and '),
    summary: s.frames + (s.frames === 1 ? ' frame' : ' frames') + ' in the pool' + (_drawing.size ? ' · drawing ' + _drawing.size : ''),
  });
  if (!open) return;
  const set = ((_kit && _kit.sets) || []).find(x => x.id === v.framing) || null;

  // The shot size, its mannequin beside it - as tall as the menus and the wishes together - and
  // how many.
  // The menus on the LEFT and the mannequin on the RIGHT (the owner, 2026-09-21), and the menus
  // wear short names so three of them fit a narrow column: the shot size with how many beside it,
  // the spread rule under them.
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
  for (const id of ['cycle', 'random']) {
    const o = el('option', '', id);
    o.value = id;
    if ((v.spread || 'cycle') === id) o.selected = true;
    spread.appendChild(o);
  }
  spread.disabled = _saving || _planning;
  spread.addEventListener('change', () => _saveVideo({ spread: spread.value }));
  const count = el('select', 'mv3-wk-vsel is-small is-tier');
  count.title = 'How many variations of the shot the set holds';
  for (let k = 1; k <= ((_kit && _kit.setMax) || 5); k++) {
    const o = el('option', '', '× ' + k);
    o.value = String(k);
    if (k === v.frames) o.selected = true;
    count.appendChild(o);
  }
  count.disabled = _saving || !_kit || _planning;
  count.addEventListener('change', () => _saveVideo({ frames: parseInt(count.value, 10) }));
  // The shot size with how many of it beside it; the spread rule under them.
  sets.append(framing, count);
  const rule = el('div', 'mv3-wk-fsets');
  rule.appendChild(spread);
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
  col.appendChild(wish);
  row.append(col, pic);
  body.appendChild(row);

  // The pool, the full width under the block: `+` for a frame of one's own (its window comes
  // later), then every frame as it came. A frame pressed goes on the stage; pressed again, the
  // stage shows the casting pair.
  const strip = el('div', 'mv3-wk-fset');
  const add = el('button', 'mv3-wk-fsetfr is-add', '+');
  add.type = 'button';
  add.disabled = true;
  add.title = 'A frame of your own, from the picture window - under development';
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
    b.title = (fr.framing ? fr.framing + ' ' : '') + (fr.n ? fr.n + ' · ' : '')
      + (gone ? 'switched off - no fragment takes it' : 'press to see it on the stage; right-click to open it large');
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
  for (let k = 0; k < _drawing.size; k++) strip.appendChild(el('div', 'mv3-wk-fsetfr is-busy', 'drawing…'));
  body.appendChild(strip);

  // `generate`: the price first, the set on the second press.
  const n = v.frames || 4;
  const busy = _planning || _drawing.size > 0;
  _genButton(foot, {
    label: _planning ? 'planning…' : _drawing.size ? 'drawing ' + _drawing.size + '…' : _armedSet ? n + (n === 1 ? ' frame' : ' frames') + ' · ' + _money(n * FRAME_PRICE) + '?' : 'generate',
    cap: busy ? '' : n + (n === 1 ? ' frame' : ' frames') + ' · ' + _money(n * FRAME_PRICE),
    disabled: busy || !_kit,
    title: 'The agent plans ' + n + ' moments of this shot from the look, the place, the mood and your words; every one is drawn at once - nano-banana-2, 2K, '
      + _money(FRAME_PRICE) + ' each. Press again to confirm.',
    on: () => {
      if (!_armedSet) { _armedSet = true; _ctx.repaint(); return; }
      _armedSet = false;
      _makeSet();
    },
  });
}

// VIDEO - the model and the tier, how the PLACE moves (W3a) and the animation of the PERSON, line
// by line (W3b); the clips themselves come with F4. Shut until there is a FIRST FRAME to animate
// (the owner, 2026-09-21): a clip is made from a frame, so before the set exists this zone has
// nothing to be about.
function _stageVideo(host, p, lines) {
  const missing = _missing(p);
  const why = missing.length ? missing.join(' and ') : !_pool(p).length ? 'a first frame' : '';
  const motion = _envMotion(p);
  const written = lines.filter(_animated).length;
  const done = !!motion && lines.length > 0 && written === lines.length;
  const { open, body, foot } = _stage(host, 'video', {
    name: 'video', sub: 'the place, then the person', soon: true, done,
    blocked: !!why, why,
    summary: written + '/' + lines.length + ' animated' + (motion ? '' : ' · the place is not written'),
  });
  if (!open) return;
  _needEnvMeta();
  const v = _video();
  // How the clips are made, one row: the tier on the left, the model beside it (owner). Seedance is
  // in the list so it is known to be coming, and cannot be picked yet.
  const sets = el('div', 'mv3-wk-fsets');
  const tier = el('select', 'mv3-wk-vsel is-small is-tier');
  tier.title = 'How sharp the clips are, and what a second of them costs';
  for (const q of (_kit && _kit.qualities) || []) {
    const o = el('option', '', q.label + ' · $' + q.pricePerSec + '/s');
    o.value = q.id;
    if (q.id === v.quality) o.selected = true;
    tier.appendChild(o);
  }
  tier.disabled = _saving || !_kit;
  tier.addEventListener('change', () => _saveVideo({ quality: tier.value }));
  const model = el('select', 'mv3-wk-vsel is-small is-model');
  model.title = 'How clips are made';
  const kling = el('option', '', 'kling avatar');
  kling.value = 'kling';
  kling.title = 'One clip per line: the frame speaks the read';
  const seed = el('option', '', 'seedance 2.0 mini · soon');
  seed.value = 'seedance';
  seed.disabled = true;
  seed.title = 'In development: one wide shot over several lines, as one clip';
  model.append(kling, seed);
  model.value = 'kling';
  model.disabled = _saving;
  sets.append(tier, model);
  body.appendChild(sets);

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
  const willWrite = lines.filter(l => !_animated(l) && !((l.shot || {}).motionEdited && (l.shot || {}).motion)).length;
  const busy = !!_writing || _envWriting;
  _genButton(foot, {
    label: _writing === 'place' || (_envWriting && !_writing) ? 'the place…' : _writing === 'lines' ? 'writing…' : done ? 'write it again' : 'generate',
    cap: busy ? '' : !motion ? 'the place, then ' + lines.length + (lines.length === 1 ? ' line' : ' lines')
      : willWrite ? willWrite + (willWrite === 1 ? ' line' : ' lines') : 'every line is animated',
    disabled: busy || !_place(p) || !lines.length || (!!motion && !willWrite),
    title: (motion ? 'The agent looks at the frames' : 'The agent looks at the place and writes what moves in it by itself, then at the frames')
      + ' and writes how the person moves while they say each line - the expression, the head, the hands, the gaze.'
      + ' A prompt edited by hand is left alone. The clips themselves come with F4.',
    on: () => _writeVideo(p),
  });
}

function _list(host, p, lines) {
  const list = el('div', 'mv3-wk-flist');
  host.appendChild(list);
  lines.forEach((l, i) => list.appendChild(_row(p, l, i)));
  // Where it stood before this paint - a repaint rebuilds the column, and a rebuilt column starts
  // at the top. The column is in the panel by now, so the offset takes.
  list.addEventListener('scroll', () => { _listAt = list.scrollTop; }, { passive: true });
  if (_listAt) list.scrollTop = _listAt;
}

function _row(p, l, i) {
  const row = el('button', 'mv3-wk-frow' + (i === _open ? ' is-open' : ''));
  row.type = 'button';
  const take = _take(l);

  const meta = el('div', 'mv3-wk-lmeta');
  meta.appendChild(el('span', 'mv3-wk-lnum', String(i + 1)));
  meta.appendChild(el('span', 'mv3-wk-ldur', take && take.dur ? take.dur.toFixed(1) + 's' : ''));
  row.appendChild(meta);
  // The read, playable from the row (owner, 2026-09-21): hearing a line is how it is judged, and
  // the row is where the eye already is.
  row.appendChild(_playBtn(take && take.path ? take.path : '', 'the read'));

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
  dot(_clipState(l), 'clip');
  row.appendChild(dots);

  // The whole text under the pointer (the owner, 2026-09-21): the row clips it to two lines, and a
  // line is judged by all of its words. Beside the row, 200px wide, gone when the pointer goes.
  row.addEventListener('mouseenter', () => { _tipT = setTimeout(() => _tipShow(row, l, i), TIP_MS); });
  row.addEventListener('mouseleave', _tipHide);
  // Pressing the open one again closes it: the right column then speaks for the whole script.
  row.addEventListener('click', () => {
    _tipHide();
    _open = _open === i ? -1 : i;
    _picking = false;
    _pickView = '';
    _remember();
    _ctx.repaint();
  });
  return row;
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
function _tipShow(row, l, i) {
  _tipHide();
  if (!row.isConnected) return;
  const tip = el('div', 'mv3-wk-ftip');
  tip.appendChild(el('div', 'mv3-wk-ftip-t', _words(l) || '(no words)'));
  tip.appendChild(el('div', 'mv3-wk-ftip-n', 'fragment ' + (i + 1) + (i === _open ? ' · press again for the whole video' : ' · press to open')));
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
  const take = _take(l);
  const rs = _readState(l);
  const va = _api.voiceApi();
  const speaking = VOICE.reading();
  const busyRead = speaking.busy;
  const canRead = _canRead();

  const top = el('div', 'mv3-wk-fhead');
  top.appendChild(el('span', 'mv3-wk-ftitle', 'fragment ' + (i + 1)));
  top.appendChild(_playBtn(take && take.path ? take.path : '', 'the read'));
  top.appendChild(el('span', 'mv3-wk-vsub', take && take.dur ? take.dur.toFixed(1) + ' s' : 'not read'));
  // The read of this line, from here (V3's list, folded in): spoken now, or again in place of the
  // take it has - tagged by the mood first when it has no tags yet (ElevenLabs v3).
  const read = el('button', 'mv3-wk-vuse is-right', speaking.lines.includes(i) ? '…' : rs === 'none' ? 'read' : 'read again');
  read.type = 'button';
  read.title = !canRead ? 'Choose a voice first - a character with one, or one for the project'
    : rs === 'none' ? 'Read this line' : 'Read it again, in place of the take it has';
  read.disabled = busyRead || !canRead;
  read.addEventListener('click', () => VOICE.readLine(va, i));
  top.appendChild(read);
  host.appendChild(top);

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
    const words = el('div', 'mv3-wk-fwords is-edit', '“' + (shown || '…') + '”');
    words.title = 'Change the words' + (shown !== _words(l) ? ' - and the [tags] between them' : '');
    words.addEventListener('click', () => { _editWords = i; _wordsDraft = shown; _ctx.repaint(); });
    host.appendChild(words);
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

  // Every take the line has, under the grid - projects made on the old page can carry some.
  const clips = ((l.video || {}).plain || []);
  if (clips.length) {
    host.appendChild(el('div', 'mv3-wk-flabel', 'takes'));
    const now = _clipOf(l);
    for (const c of clips.slice().reverse()) {
      const r = el('div', 'mv3-wk-vrow' + (now && c.id === now.id ? ' is-on' : ''));
      r.appendChild(el('span', 'mv3-wk-vname', 'take · ' + (c.dur ? c.dur.toFixed(1) + ' s' : '')));
      if (c.said !== _words(l)) r.appendChild(el('span', 'mv3-wk-fstale', 'stale'));
      if (now && c.id === now.id) r.appendChild(el('span', 'mv3-wk-vtag', 'the clip'));
      host.appendChild(r);
    }
  }
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
  const { v: fr, auto } = _frameFor(p, l, i);
  const box = el('div', 'mv3-wk-fmedia' + (fr ? '' : ' is-empty'));
  if (fr) {
    const img = el('img');
    img.alt = '';
    img.src = derived(fr.preview || fr.path, 'card');
    box.appendChild(img);
    box.title = 'Open it large';
    box.addEventListener('click', () => showPicture({ src: fr.path, name: 'frame ' + (fr.n || ''), rows: fr.prompt ? [['prompt', fr.prompt]] : [] }));
  } else {
    box.appendChild(el('span', '', _drawing.size ? 'drawing…' : 'no frames yet'));
  }
  col.appendChild(box);
  col.appendChild(el('div', 'mv3-wk-fcap', fr ? (auto ? 'from the set, in turn' : 'picked by hand') : 'the set is made in the general zone'));
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

// CLIP - the frame speaking the read, in the frame's column. What stops it, or what it costs, is
// said under the button.
function _clipCol(p, l, i, rs, take) {
  const col = el('div', 'mv3-wk-fcol is-media');
  col.appendChild(_colHead('clip'));
  const c = _clipOf(l);
  const box = el('div', 'mv3-wk-fmedia' + (c && c.thumb ? '' : ' is-empty'));
  if (c && c.thumb) {
    const img = el('img');
    img.alt = '';
    img.src = c.thumb;
    box.appendChild(img);
  } else {
    box.appendChild(el('span', '', 'no clip'));
  }
  col.appendChild(box);
  const fr = _frameFor(p, l, i).v;
  const tier = _tier();
  let cap;
  let ready = false;
  if (rs !== 'ok') cap = 'read this line first';
  else if (!fr) cap = 'make the frames first';
  else if (take.dur > _ceiling()) cap = 'too long for Kling (' + take.dur.toFixed(1) + ' s) - split the line';
  else { ready = true; cap = take.dur.toFixed(1) + ' s · ' + (tier ? _money(take.dur * tier.pricePerSec) : '…'); }
  const make = el('button', 'mv3-wk-vmore is-small is-media' + (ready ? ' is-go' : ''), c ? 'again' : 'make clip');
  make.type = 'button';
  make.disabled = true;
  make.title = 'Kling avatar - comes with the clips (F4)';
  col.appendChild(make);
  col.appendChild(el('div', 'mv3-wk-fcap' + (ready ? '' : ' is-why'), cap));
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
  if (!l) {
    // No line open: a frame of the pool pressed in the general zone, if one is.
    const fr = _setPick ? _pool(p).find(v => v.id === _setPick) : null;
    return fr ? { src: derived(fr.preview || fr.path, 'main'), caption: 'frame' + (fr.n ? ' ' + fr.n : '') } : null;
  }
  const c = _clipOf(l);
  if (c && c.thumb) return { src: c.thumb, caption: 'fragment ' + (_open + 1) + ' · clip' };
  const fr = _frameFor(p, l, _open).v;
  if (fr) return { src: derived(fr.preview || fr.path, 'main'), caption: 'fragment ' + (_open + 1) };
  return null;
}

/** Leaving the step stops the read that was playing, and drops the text under the pointer. */
export function leave() {
  if (_audio) { _audio.pause(); _playing = ''; }
  _tipHide();
}
