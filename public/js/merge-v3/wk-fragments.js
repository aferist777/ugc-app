/* ════════════════════════════════════════════════════════════════════════════
   MERGE — the script of a talking head, line by line: the READ, the FRAME and the CLIP of
   every line (docs/local-app/PLAN.md, "Fragments — полный план по фазам", and phase M of
   "Сцена, setup и таймлайн-зеркало").

   The hub of the setup step (js/merge-v3/wk-setup.js), painted into its panel. Two columns: on
   the left the voice the script is read in and the whole script, one row per line with what it
   has - the read, the shot, the frame, the clip; on the right the line that is open, with
   everything made for it - or, with none open, the settings of the whole video and where the
   script stands. The list never goes away while a line is open: the script is one thing, and
   judging a line means seeing the ones around it. Who and where are on the stage, not here.

   THE READ (V3, moved in here in M). A line is spoken from the open line's own button; its words
   can be changed there too, and a take made of other words is stale until the line is read again
   or the words are put back. The speaking itself is js/merge-v3/wk-voice.js.

   THE READING (F2). The directing agent (routes/scen3.js, _readScript) reads the script five
   lines at a time against the MOOD of the video - the emotion the person picks once - and gives
   every line its shot size, pose, camera, the direction of its first frame and its animation
   prompt for Kling. All of it can be changed by hand; an animation prompt written by hand
   survives the next reading.

   THE FRAMES (F3). A frame is drawn for one line from its shot (routes/scen3.js, fragments/frame):
   nano-banana-2 at 2K in the timeline's shape. It is a row in Alerts from the moment it is asked
   for, and the SERVER files it into the project and makes it the line's - this panel only follows
   the row, so leaving loses nothing and coming back finds it still drawing or done. "again" adds
   a frame beside the one the line has; the line opens on whichever is picked. The clips (F4) are
   still to come.

   WHAT IS READ, NOT OWNED. The lines, their reads and any frames and clips already made are the
   scenario project's, as they have always been (routes/scen3.js). Written from here: the clip
   settings - the tier, the mood, the mode - on `project.video`, merged on the server; each line's
   `shot`, through its own two routes, which touch nothing else of the line; and a line's words.
   ════════════════════════════════════════════════════════════════════════════ */

import * as Store from './store.js';
import * as API from './scen-api.js';
import { takeOf, isRead } from './scen-api.js';
import * as VOICE from './wk-voice.js';
import { derived } from '../chars-store.js';
import { el, holdProgress, endProgress, onlyHere, showPicture } from './wk-maker.js';

// What a frame costs: nano-banana-2 at 2K on kie (lib/mv3-img.js, the price table). Said beside the
// button so nothing is spent on a surprise; the frame route will answer with the real price (F3).
const FRAME_PRICE = 0.06;
// The one ceiling a read has for Kling avatar, from the tier (lib/motion-presets.js) - read from
// the kit when it has arrived, this only until then.
const CEILING_FALLBACK = 30;

const KEY = 'mv3_frag_open_v1';          // { <timeline key>: <open line> } - where you were, per project

let _ctx = null;
let _api = null;                          // what the step lends: the character cast, the voice, the shelves
// The open line, 0-based. -1 is NONE open - the right column then speaks for every fragment at
// once (owner, 2026-09-18). null is "not decided yet", before the project is known.
let _open = null;
let _editWords = -1;                      // the line whose words are open for editing, in the right column
let _wordsDraft = '';
let _key = '';                            // the project it belongs to
let _asked = _urlLine();                  // ?line=N (1-based) - how the Alerts list comes back here
let _kit = null;                          // tiers and motion presets, read once
let _kitState = 'idle';
let _saving = false;
let _said = '';
let _listAt = 0;                          // where the list stood, put back after every repaint
// The reading. The server takes at most five lines a call (the owner); the page walks the script in
// those steps and says how far it has got.
const BATCH = 5;
let _reading = null;                      // { from, to, total } for the script, { line } for one
let _readErr = '';
const _drafts = {};                       // text being typed, by "<line>:<field>" - a repaint keeps it
// Frames being drawn, by line: { alertId, startedAt } - from this panel or found in the journal.
const _drawing = new Map();
let _armedFrames = false;                 // "make N frames" pressed once and asking
let _submitting = null;                   // { done, total } while a batch of frames is being asked for
let _lookedAt = '';                       // the project the journal was last asked about
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
// What was open when this project was last left: a line, 'all', or - never been here - the first.
function _remembered() {
  try {
    const v = (JSON.parse(localStorage.getItem(KEY) || '{}') || {})[_key];
    if (v === 'all') return -1;
    return Number.isInteger(v) && v >= 0 ? v : 0;
  } catch (e) { return 0; }
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
const _frameOf = (p, l) => (((p && p.mix) || {}).variants || []).find(v => v.id === String((l && l.frameId) || '')) || null;
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

// ── The kit: tiers and motion presets ───────────────────────────────────────
function _loadKit(repaint) {
  if (_kitState !== 'idle') return;
  _kitState = 'loading';
  const get = (u) => fetch(u).then(r => r.json()).catch(() => null);
  Promise.all([get('/api/scen3/motion-presets'), get('/api/scen3/poses'), get('/api/scen3/frame-options')]).then(([m, p, f]) => {
    const opts = (f && f.options) || {};
    _kit = {
      qualities: (m && m.qualities) || [],
      moods: (m && m.moods) || [],
      poses: (p && p.poses) || [],
      framings: opts.framings || [],
      cameras: opts.cameras || [],
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

// ── The reading ─────────────────────────────────────────────────────────────
// A shot is stale when it was read for other words or for another mood of the video.
function _shotState(l) {
  const sh = l && l.shot;
  if (!sh || !sh.framing) return 'none';
  return (sh.said === _words(l) && sh.mood === (_video().mood || '')) ? 'ok' : 'stale';
}

async function _readScript() {
  const p = _ctx && _ctx.project;
  const n = ((p && p.lines) || []).length;
  if (!p || !n || _reading) return;
  _readErr = '';
  for (let k = 0; k < n; k += BATCH) {
    const only = [];
    for (let j = k; j < Math.min(n, k + BATCH); j++) only.push(j);
    _reading = { from: k + 1, to: k + only.length, total: n };
    _ctx.repaint();
    try {
      _adopt(await _post('/api/scen3/fragments/read', { projectId: p.id, only }));
    } catch (e) {
      _readErr = 'The agent could not read lines ' + (k + 1) + '–' + (k + only.length) + ': ' + e.message;
      break;
    }
  }
  _reading = null;
  _ctx.repaint();
}

async function _readLine(i) {
  const p = _ctx && _ctx.project;
  if (!p || _reading) return;
  _readErr = '';
  _reading = { line: i };
  _ctx.repaint();
  try {
    _adopt(await _post('/api/scen3/fragments/read', { projectId: p.id, only: [i] }));
  } catch (e) {
    _readErr = 'The agent could not read line ' + (i + 1) + ': ' + e.message;
  }
  _reading = null;
  _ctx.repaint();
}

// ── The frames ──────────────────────────────────────────────────────────────
// Where a frame was asked from, for the Alerts list: the address that opens this very fragment.
function _where(i) {
  const key = (_ctx && _ctx.key) || '';
  const p = (_ctx && _ctx.project) || {};
  return {
    page: 'merge',
    href: '/merge?p=' + encodeURIComponent(key) + '&step=setup&line=' + (i + 1),
    label: 'Merge · ' + String(p.title || p.name || 'talking head') + ' · setup › line ' + (i + 1),
    spot: { key, step: 'setup', view: 'frag', line: i },
  };
}
const _format = () => { try { const t = Store.timeline(); return (t && t.format) || '9:16'; } catch (e) { return '9:16'; } };

async function _makeFrame(i) {
  const p = _ctx && _ctx.project;
  if (!p || _drawing.has(i)) return;
  _readErr = '';
  _drawing.set(i, { alertId: '', startedAt: Date.now() });
  _ctx.repaint();
  try {
    const r = await _post('/api/scen3/fragments/frame', { projectId: p.id, line: i, format: _format(), where: _where(i) });
    _drawing.set(i, { alertId: r.alertId, startedAt: Date.now() });
    _follow(i, r.alertId);
  } catch (e) {
    _drawing.delete(i);
    _readErr = 'Line ' + (i + 1) + ': the frame was not asked for - ' + e.message;
    if (_open === i) endProgress('frame:' + i, e.message);
  }
  _ctx.repaint();
}

// The row is the truth: whatever happened to the page in between, it says done or failed.
async function _follow(i, alertId) {
  try {
    await API.follow(alertId);
    if (_ctx && _ctx.reloadProject) await _ctx.reloadProject();
    if (_open === i) endProgress('frame:' + i);
  } catch (e) {
    _readErr = 'Line ' + (i + 1) + ': ' + e.message;
    if (_open === i) endProgress('frame:' + i, e.message);
  }
  _drawing.delete(i);
  if (_ctx) _ctx.repaint();
}

// Every line that has a shot and no frame, asked for one after another; the drawing itself happens
// on the server, in parallel. Pressed twice (owner): the first press says how many and how much.
async function _makeMissing(lines) {
  const want = lines.map((l, i) => (_shotState(l) !== 'none' && !_frameOf(_ctx.project, l) && !_drawing.has(i)) ? i : -1).filter(i => i >= 0);
  if (!want.length) return;
  _submitting = { done: 0, total: want.length };
  _ctx.repaint();
  for (const i of want) {
    await _makeFrame(i);
    _submitting.done++;
    _ctx.repaint();
  }
  _submitting = null;
  _ctx.repaint();
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
      if (r.state !== 'running' || r.what !== 'frame' || spot.key !== key) continue;
      const i = Number(spot.line);
      if (!Number.isInteger(i) || _drawing.has(i)) continue;
      _drawing.set(i, { alertId: r.id, startedAt: Date.parse(r.startedAt) || Date.now() });
      _follow(i, r.id);
    }
    if (_ctx) _ctx.repaint();
  }).catch(() => { /* without the list, nothing shows as drawing */ });
}

async function _pickFrame(i, frameId) {
  const p = _ctx && _ctx.project;
  if (!p) return;
  try { _adopt(await _post('/api/scen3/fragments/pick-frame', { projectId: p.id, line: i, frameId })); }
  catch (e) { _readErr = 'Could not pick that frame: ' + e.message; }
  _ctx.repaint();
}

// A change by hand: shown at once, then the server's answer - which is also where a pose that does
// not belong to a new shot size is replaced by one that does.
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
  // project was left, then the first.
  if (_key !== ctx.key) { _key = ctx.key; _open = null; _listAt = 0; _editWords = -1; }
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

  // The right column: the voices being chosen, the open line, or the whole video.
  if (api.view() === 'voice') { VOICE.paintPicker(right, api.voiceApi()); return; }
  _notes(right);
  if (!lines.length) {
    right.appendChild(_note('This project has no lines. The script is written on the Scenarios page and comes with the project.'));
    return;
  }
  if (_open < 0) _all(right, p, lines);
  else _fragment(right, p, lines[_open], _open);
  // The countdown belongs to the fragment being drawn, and only while it is the one open.
  const place = _open >= 0 && _drawing.has(_open) ? 'frame:' + _open : null;
  onlyHere(place);
  if (place) {
    holdProgress(place, { label: 'Drawing the frame of line ' + (_open + 1), estimateMs: FRAME_ESTIMATE_MS, startedAt: _drawing.get(_open).startedAt });
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

// What the frames and the clips cannot be made without: the person in a look, the place, and the
// voice they are read in. Named on the buttons that need them.
function _missing(p) {
  const cast = p.casting || {};
  const out = [];
  if (!cast.obrazImage) out.push('a character in a look');
  if (!cast.locationImage) out.push('an environment');
  if (!(p.castVoice && p.castVoice.has)) out.push('a voice');
  return out;
}

// ── The general zone: the whole video, in three stages ──────────────────────
// (Decided with the owner 2026-09-21, docs/local-app/PLAN.md, phase W.) Over everything the counters
// and the one mood every stage reads from; then three fields in gold, one above the other - voice,
// first frames, video - each with its own `generate` at the foot, and `generate all` to run them in
// turn. In W1 the voice field is whole; the other two hold what F2 and F3 built until their own
// stages come (W2, W3).
function _all(host, p, lines) {
  _counters(host, p, lines);
  _mood(host);
  _stageVoice(host, p, lines);
  _stageFrames(host, p, lines);
  _stageVideo(host);
  host.appendChild(el('div', 'mv3-wk-fsoon', 'Pick a fragment on the left to work on it; press it again to come back here.'));
}

// One field: a gold frame, a head, a body and a foot with the stage's own `generate`.
function _stage(host, name, sub, soon) {
  const box = el('div', 'mv3-wk-stage' + (soon ? ' is-soon' : ''));
  const head = el('div', 'mv3-wk-stage-head');
  head.appendChild(el('span', '', name));
  if (sub) head.appendChild(el('span', 'mv3-wk-vsub', sub));
  box.appendChild(head);
  const body = el('div', 'mv3-wk-stage-body');
  box.appendChild(body);
  const foot = el('div', 'mv3-wk-stage-foot');
  box.appendChild(foot);
  host.appendChild(box);
  return { body, foot };
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

// Where the script stands: read, frames, clips - and the chain that runs every stage in turn.
function _counters(host, p, lines) {
  const n = lines.length;
  const top = el('div', 'mv3-wk-ftop');
  const stat = el('div', 'mv3-wk-fstats');
  const cell = (label, done) => {
    const c = el('div', 'mv3-wk-fstat' + (done === n ? ' is-done' : ''));
    c.appendChild(el('div', 'mv3-wk-fstat-n', done + '/' + n));
    c.appendChild(el('div', 'mv3-wk-fstat-l', label));
    stat.appendChild(c);
  };
  cell('read', lines.filter(isRead).length);
  cell('frames', lines.filter(l => _frameOf(p, l)).length);
  cell('clips', lines.filter(l => _clipState(l) === 'ok').length);
  top.appendChild(stat);
  const all = el('button', 'mv3-wk-gen mv3-wk-genall', 'generate all');
  all.type = 'button';
  all.disabled = true;
  all.title = 'Every stage in turn - the voice and the frames together, the video after both. Comes with the video stage (W3).';
  top.appendChild(all);
  host.appendChild(top);
}

// THE MOOD OF THE VIDEO - the emotion of the whole thing, the one choice the person makes here
// (owner, 2026-09-18) and the one vocabulary every stage reads from (2026-09-21): the tags of the
// read, the expression in the frames, the movement in the clips. Its one line under the menu says
// what the choice means.
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
  mood.disabled = _saving || !_kit || !!_reading;
  mood.addEventListener('change', () => _saveVideo({ mood: mood.value }));
  row.appendChild(mood);
  box.appendChild(row);
  if (now && now.about) box.appendChild(el('div', 'mv3-wk-mood-about', now.about));
  host.appendChild(box);
}

// VOICE - the first stage, the one the timeline waits for: the character's voice, and `generate`,
// which tags the script by the mood and reads every line that needs it (ElevenLabs v3).
function _stageVoice(host, p, lines) {
  const { body, foot } = _stage(host, 'voice', 'ElevenLabs v3 · tags by the mood');
  const rec = _api.char();
  if (!rec) {
    body.appendChild(_note('Choose who is speaking: press the upper half of the stage.'));
  } else {
    VOICE.paintRow(body, _api.voiceApi());
  }
  const g = VOICE.reading();
  const busy = g.tagging || g.line >= 0 || !!g.batch;
  const has = !!(rec && VOICE.hasVoice(rec));
  // What the button will do: the lines still to tag, and the lines still to read.
  const untagged = lines.filter(l => !String(l.tagged || '').trim()).length;
  const unread = lines.filter(l => !isRead(l)).length;
  const will = lines.filter(l => !String(l.tagged || '').trim() || !isRead(l)).length;
  const label = g.tagging ? 'tagging…'
    : g.batch ? 'reading ' + g.batch.done + ' of ' + g.batch.total + '…'
      : g.line >= 0 ? 'reading…' : 'generate';
  _genButton(foot, {
    label,
    cap: !rec || !has || !lines.length ? '' : busy ? '' : will ? will + (will === 1 ? ' line' : ' lines') + (untagged ? ' · tags first' : '') : 'every line is read',
    disabled: !rec || !has || busy || !lines.length || !will,
    title: !rec ? 'Choose who is speaking first' : !has ? 'Give the character a voice first' : !will ? 'Every line is tagged and read'
      : 'Tags by the mood where they are missing (' + untagged + '), then every line that needs reading (' + unread + ') - ElevenLabs v3',
    on: () => VOICE.generate(_api.voiceApi()),
  });
}

// FIRST FRAMES - its own stage comes in W2 (a set of frames for the whole video, chosen by shot
// size). Until then the field holds what F2 and F3 built: the reading of the script and a frame
// per line.
function _stageFrames(host, p, lines) {
  const { body, foot } = _stage(host, 'first frames', 'under development', true);
  const missing = _missing(p);
  const blocked = missing.length > 0;
  const acts = el('div', 'mv3-wk-facts');
  const r = _reading;
  const read = el('button', 'mv3-wk-vmore is-small' + (r && r.total ? ' is-busy' : ''),
    r && r.total ? 'reading lines ' + r.from + '–' + r.to + ' of ' + r.total + '…' : 'read the script');
  read.type = 'button';
  read.disabled = blocked || !!r || !lines.length;
  read.title = blocked ? 'Still missing: ' + missing.join(', ')
    : 'The agent plans every line - shot, pose, camera, direction, animation - five lines at a time';
  read.addEventListener('click', () => _readScript());
  // Only lines that have a shot can be drawn; the others are counted apart so the number is honest.
  const ready = lines.filter((l, i) => _shotState(l) !== 'none' && !_frameOf(p, l) && !_drawing.has(i)).length;
  const sub = _submitting;
  const frames = el('button', 'mv3-wk-vmore is-small' + (_armedFrames ? ' is-armed' : '') + (sub ? ' is-busy' : ''),
    sub ? 'asking ' + sub.done + ' of ' + sub.total + '…'
      : _armedFrames ? ready + ' frame' + (ready === 1 ? '' : 's') + ' · ' + _money(ready * FRAME_PRICE) + '?'
        : ready ? 'make ' + ready + ' frame' + (ready === 1 ? '' : 's') : (_drawing.size ? 'drawing ' + _drawing.size + '…' : 'no frames to make'));
  frames.type = 'button';
  frames.disabled = blocked || !ready || !!sub || !!_reading;
  frames.title = blocked ? 'Still missing: ' + missing.join(', ')
    : 'Every line that has a shot and no frame - nano-banana-2, 2K, ' + _money(FRAME_PRICE) + ' each. Press again to confirm.';
  frames.addEventListener('click', () => {
    if (!_armedFrames) { _armedFrames = true; _ctx.repaint(); return; }
    _armedFrames = false;
    _makeMissing(lines);
  });
  acts.append(read, frames);
  body.appendChild(acts);
  _genButton(foot, { disabled: true, title: 'Comes with the first frames stage (W2): a set of frames for the whole video, by shot size' });
}

// VIDEO - the model and the tier now; the animation prompts and the clips come with their stages
// (W3, F4).
function _stageVideo(host) {
  const { body, foot } = _stage(host, 'video', 'under development', true);
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
  _genButton(foot, { disabled: true, title: 'Comes with the video stage (W3): the animation of the person and of the place, then the clips (F4)' });
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
  const fr = _frameOf(p, l);
  row.appendChild(el('div', 'mv3-wk-ftext', _words(l) || '(no words)'));

  const dots = el('div', 'mv3-wk-fdots');
  const dot = (state, what) => {
    const d = el('span', 'mv3-wk-fdot is-' + state);
    d.title = what + ': ' + (state === 'ok' ? 'done' : state === 'busy' ? 'being made' : state === 'stale' ? (what === 'shot' ? 'the words or the mood changed since' : 'the words changed since') : 'not yet');
    dots.appendChild(d);
  };
  dot(VOICE.reading().line === i ? 'busy' : _readState(l), 'read');
  dot(_shotState(l), 'shot');
  dot(_drawing.has(i) ? 'busy' : fr ? 'ok' : 'none', 'frame');
  dot(_clipState(l), 'clip');
  row.appendChild(dots);

  row.title = i === _open ? 'Fragment ' + (i + 1) + ' - press again to see all fragments' : 'Fragment ' + (i + 1);
  // Pressing the open one again closes it: the right column then speaks for the whole script.
  row.addEventListener('click', () => {
    _open = _open === i ? -1 : i;
    _remember();
    _ctx.repaint();
  });
  return row;
}

// ── The right column: the open fragment ─────────────────────────────────────
// Laid out the way the owner drew it (2026-09-19), as a grid of two rows:
//
//   | shot: size, pose, camera, direction |  mannequin  |  frame  + make frame |
//   | animation prompt                                  |  clip   + make clip  |
//
// The frame and the clip share a column, so the two pictures of a fragment - what it opens on and
// what it becomes - stand one above the other.
function _fragment(host, p, l, i) {
  const take = _take(l);
  const rs = _readState(l);
  const va = _api.voiceApi();
  const speaking = VOICE.reading();
  const busyRead = speaking.tagging || speaking.line >= 0 || !!speaking.batch;
  const rec = _api.char();
  const canRead = !!(rec && VOICE.hasVoice(rec));

  const top = el('div', 'mv3-wk-fhead');
  top.appendChild(el('span', 'mv3-wk-ftitle', 'fragment ' + (i + 1)));
  top.appendChild(_playBtn(take && take.path ? take.path : '', 'the read'));
  top.appendChild(el('span', 'mv3-wk-vsub', take && take.dur ? take.dur.toFixed(1) + ' s' : 'not read'));
  // The read of this line, from here (V3's list, folded in): spoken now, or again in place of the
  // take it has - tagged by the mood first when it has no tags yet (ElevenLabs v3).
  const read = el('button', 'mv3-wk-vuse is-right', speaking.line === i ? '…' : rs === 'none' ? 'read' : 'read again');
  read.type = 'button';
  read.title = !rec ? 'Choose who is speaking first' : !canRead ? 'Give the character a voice first'
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

  const grid = el('div', 'mv3-wk-fgrid');
  host.appendChild(grid);
  grid.appendChild(_shotCol(l, i));
  grid.appendChild(_poseCol(l));
  grid.appendChild(_frameCol(p, l, i));
  grid.appendChild(_motionCol(l, i));
  grid.appendChild(_clipCol(p, l, rs, take));

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

// A column's heading: a small label, and - on the shot - the one action it has.
function _colHead(label, action) {
  const h = el('div', 'mv3-wk-flabel is-row');
  h.appendChild(el('span', '', label));
  if (action) h.appendChild(action);
  return h;
}

// SHOT - how the line is filmed, in one column: the three choices, then the direction.
function _shotCol(l, i) {
  const col = el('div', 'mv3-wk-fcol is-shot');
  const sh = l.shot || null;
  const st = _shotState(l);
  const busy = !!_reading;
  const mine = _reading && _reading.line === i;

  const again = el('button', 'mv3-wk-vmore is-small', mine ? 'reading…' : (sh ? 'read again' : 'read this line'));
  again.type = 'button';
  again.disabled = busy || !!_missing(_ctx.project).length;
  again.title = 'The agent plans this line again, keeping the rhythm with the others';
  again.addEventListener('click', () => _readLine(i));
  col.appendChild(_colHead('shot', again));

  const cat = _kit || { framings: [], poses: [], cameras: [] };
  const pick = (title, items, value, label, onChange) => {
    const sel = el('select', 'mv3-wk-vsel is-small is-col');
    sel.title = title;
    if (!value) { const o = el('option', '', label); o.value = ''; o.disabled = true; o.selected = true; sel.appendChild(o); }
    for (const it of items) {
      const o = el('option', '', it.label);
      o.value = it.id;
      if (it.title) o.title = it.title;
      if (it.id === value) o.selected = true;
      sel.appendChild(o);
    }
    sel.disabled = busy || !_kit;
    sel.addEventListener('change', () => onChange(sel.value));
    return sel;
  };
  const framing = (sh && sh.framing) || '';
  col.appendChild(pick('How much of the person is in the frame', cat.framings, framing, 'shot size',
    (v) => _saveShot(i, { framing: v })));
  // Only the poses of this shot size: each mannequin belongs to exactly one.
  const poses = cat.poses.filter(p => !framing || p.group === framing).map(p => ({ id: p.id, label: p.label, title: p.desc }));
  col.appendChild(pick('The body position - one of the mannequins of this shot size', poses, (sh && sh.poseId) || '', 'pose',
    (v) => _saveShot(i, { poseId: v })));
  col.appendChild(pick('The lens and how it renders', cat.cameras.map(c => ({ id: c.id, label: c.label, title: c.summary })),
    (sh && sh.camera) || '', 'camera', (v) => _saveShot(i, { camera: v })));

  col.appendChild(el('div', 'mv3-wk-flabel', 'direction'));
  col.appendChild(_textField(i, 'direction', (sh && sh.direction) || '', 3,
    'The first frame, frozen: where the body, the hands and the head are, and the expression as the line begins',
    (v) => _saveShot(i, { direction: v })));
  if (sh && sh.why) col.appendChild(el('div', 'mv3-wk-fwhy', sh.why));
  if (st === 'stale') col.appendChild(_note('The words or the mood of the video changed since this line was read - read it again.', true));
  if (!sh) col.appendChild(el('div', 'mv3-wk-fsoon', 'Not read yet: "read the script" plans every line, or read this one alone. Anything here can also be set by hand.'));
  return col;
}

// The mannequin of the chosen pose, as tall as the frame beside it: the body the frame will copy.
function _poseCol(l) {
  const col = el('div', 'mv3-wk-fcol is-media');
  col.appendChild(_colHead('pose'));
  const sh = l.shot || null;
  const pose = sh ? _poseById(sh.poseId) : null;
  const box = el('div', 'mv3-wk-fmedia is-pose' + (pose ? '' : ' is-empty'));
  if (pose && (pose.thumb || pose.file)) {
    const img = el('img');
    img.alt = '';
    img.src = pose.thumb || pose.file;
    box.title = pose.label + ' - ' + pose.desc;
    box.appendChild(img);
  } else {
    box.appendChild(el('span', '', 'no pose'));
  }
  col.appendChild(box);
  if (pose) col.appendChild(el('div', 'mv3-wk-fcap', pose.label));
  return col;
}

// FRAME - the picture the line opens on, the button that makes it, and the line's other frames.
function _frameCol(p, l, i) {
  const col = el('div', 'mv3-wk-fcol is-media');
  col.appendChild(_colHead('frame'));
  const fr = _frameOf(p, l);
  const busy = _drawing.has(i);
  const box = el('div', 'mv3-wk-fmedia' + (fr ? '' : ' is-empty') + (busy ? ' is-busy' : ''));
  if (fr) {
    const img = el('img');
    img.alt = '';
    img.src = derived(fr.preview || fr.path, 'card');
    box.appendChild(img);
    box.title = 'Open it large';
    box.addEventListener('click', () => showPicture({ src: fr.path, name: 'frame of line ' + (i + 1), rows: fr.from ? [['drawn from', _fromText(fr.from)]] : [] }));
  } else {
    box.appendChild(el('span', '', busy ? 'drawing…' : 'no frame'));
  }
  col.appendChild(box);
  const noShot = _shotState(l) === 'none';
  const make = el('button', 'mv3-wk-vmore is-small is-media' + (busy ? ' is-busy' : ''), busy ? 'drawing…' : fr ? 'again' : 'make frame');
  make.type = 'button';
  make.disabled = busy || noShot || !!_missing(_ctx.project).length || !!_reading;
  make.title = noShot ? 'Read the line first: the frame is drawn from its shot'
    : 'nano-banana-2, 2K - ' + (fr ? 'another frame beside this one' : 'the frame this line opens on');
  make.addEventListener('click', () => {
    if (_open === i) holdProgress('frame:' + i, { label: 'Drawing the frame of line ' + (i + 1), estimateMs: FRAME_ESTIMATE_MS });
    _makeFrame(i);
  });
  col.appendChild(make);
  col.appendChild(el('div', 'mv3-wk-fcap' + (noShot ? ' is-why' : ''), noShot ? 'read the line first' : _money(FRAME_PRICE)));
  // The frames this line has had: pick the one it opens on.
  const mine = (((p.mix || {}).variants) || []).filter(v => v.line === i);
  if (mine.length > 1) {
    const strip = el('div', 'mv3-wk-fstrip');
    for (const v of mine.slice(0, 6)) {
      const t = el('button', 'mv3-wk-fvar' + (fr && v.id === fr.id ? ' is-on' : ''));
      t.type = 'button';
      t.title = v.from ? _fromText(v.from) : 'a frame of this line';
      const img = el('img');
      img.alt = '';
      img.src = derived(v.preview || v.path, 'card');
      t.appendChild(img);
      if (!(fr && v.id === fr.id)) t.addEventListener('click', () => _pickFrame(i, v.id));
      strip.appendChild(t);
    }
    col.appendChild(strip);
  }
  return col;
}

// What a frame was drawn from, in words.
function _fromText(from) {
  const cat = _kit || { framings: [], cameras: [] };
  const f = (cat.framings.find(x => x.id === from.framing) || {}).label || from.framing;
  const pz = (_poseById(from.poseId) || {}).label || from.poseId;
  const c = (cat.cameras.find(x => x.id === from.camera) || {}).label || from.camera;
  return [f, pz, c].filter(Boolean).join(' · ');
}

// The animation prompt: what Kling is told about the expression, the head, the hands and the gaze.
// Written by the agent; a version written by hand stays through the next reading, and the agent's
// own is one press away.
function _motionCol(l, i) {
  const col = el('div', 'mv3-wk-fcol is-motion');
  const sh = l.shot || null;
  let action = null;
  if (sh && sh.motionEdited) {
    action = el('span', 'mv3-wk-fedited-row');
    action.appendChild(el('span', 'mv3-wk-fedited', 'edited by hand'));
    if (sh.motionAgent) {
      const back = el('button', 'mv3-wk-flink', 'use the agent’s');
      back.type = 'button';
      back.title = sh.motionAgent;
      back.disabled = !!_reading;
      back.addEventListener('click', () => { delete _drafts[i + ':motion']; _saveShot(i, { useAgentMotion: true }); });
      action.appendChild(back);
    }
  }
  col.appendChild(_colHead('animation prompt', action));
  const box = _textField(i, 'motion', (sh && sh.motion) || '', 7,
    'How the person moves while speaking - the expression, the head, the hands, the gaze. Kling hears nothing else.',
    (v) => _saveShot(i, { motion: v }));
  box.classList.add('is-tall');
  col.appendChild(box);
  return col;
}

// CLIP - the frame speaking the read, in the frame's column. What stops it, or what it costs, is
// said under the button.
function _clipCol(p, l, rs, take) {
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
  const fr = _frameOf(p, l);
  const tier = _tier();
  let cap;
  let ready = false;
  if (rs !== 'ok') cap = 'read this line first';
  else if (!fr) cap = 'make a frame first';
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
  box.disabled = !!_reading;
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
  if (!l) return null;
  const c = _clipOf(l);
  if (c && c.thumb) return { src: c.thumb, caption: 'fragment ' + (_open + 1) + ' · clip' };
  const fr = _frameOf(p, l);
  if (fr) return { src: derived(fr.preview || fr.path, 'main'), caption: 'fragment ' + (_open + 1) };
  return null;
}

/** Leaving the step stops the read that was playing. */
export function leave() {
  if (_audio) { _audio.pause(); _playing = ''; }
}
