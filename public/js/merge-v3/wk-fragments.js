/* ════════════════════════════════════════════════════════════════════════════
   MERGE — the workshop's second step: the FRAME and the CLIP of every line
   (docs/local-app/PLAN.md, "Fragments — полный план по фазам").

   Loaded when the step is opened (js/merge-v3/workshop.js). Two columns, the way the setting step
   is laid out: on the left the whole script, one row per line with what it has - the read, the
   frame, the clip; on the right the line that is open, with the three things made for it - how it
   is shot, the frame, the clip. The list never goes away while a fragment is open: the script is
   one thing, and judging a line means seeing the ones around it.

   PHASE F1 - THE SHELL, and F2 - THE READING. The directing agent (routes/scen3.js, _readScript)
   reads the script five lines at a time against the MOOD of the video - the emotion the person
   picks once - and gives every line its shot size, pose, camera, the direction of its first frame
   and its animation prompt for Kling. All of it can be changed by hand; an animation prompt
   written by hand survives the next reading. Frames (F3) and clips (F4) are still to come; their
   controls stand where they will work and say which phase brings them.

   WHAT IS READ, NOT OWNED. The lines, their reads and any frames and clips already made are the
   scenario project's, as they have always been (routes/scen3.js). Written from here: the clip
   settings - the tier, the mood, the mode - on `project.video`, merged on the server; and each
   line's `shot`, through its own two routes, which touch nothing else of the line.
   ════════════════════════════════════════════════════════════════════════════ */

import * as PV from './preview-b.js';
import { derived } from '../chars-store.js';
import { el } from './wk-maker.js';

// What a frame costs: nano-banana-2 at 2K on kie (lib/mv3-img.js, the price table). Said beside the
// button so nothing is spent on a surprise; the frame route will answer with the real price (F3).
const FRAME_PRICE = 0.06;
// The one ceiling a read has for Kling avatar, from the tier (lib/motion-presets.js) - read from
// the kit when it has arrived, this only until then.
const CEILING_FALLBACK = 30;

const KEY = 'mv3_frag_open_v1';          // { <timeline key>: <open line> } - where you were, per project

let _ctx = null;
// The open line, 0-based. -1 is NONE open - the right column then speaks for every fragment at
// once (owner, 2026-09-18). null is "not decided yet", before the project is known.
let _open = null;
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
// clip made from words that have since been edited is not this line's any more.
const _words = (l) => String((l && l.text) || '');
const _take = (l) => ((l && l.audio) || {}).plain || null;
function _readState(l) {
  const t = _take(l);
  if (!t || !t.path) return 'none';
  return t.said === _words(l) ? 'ok' : 'stale';
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
function _mark() {
  const on = _audio && !_audio.paused ? _playing : '';
  document.querySelectorAll('.mv3-wk-frags .mv3-wk-vplay').forEach((b) => {
    const is = b.dataset.src && b.dataset.src === on;
    b.textContent = is ? '❚❚' : '▶';
    b.classList.toggle('is-playing', !!is);
  });
}
function _playBtn(src, what) {
  const b = el('button', 'mv3-wk-vplay', '▶');
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
async function _post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(x => x.json());
  if (!r || !r.success) throw new Error((r && r.error) || 'refused');
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
export function paint(host, ctx) {
  _ctx = ctx;
  host.classList.add('is-wk');
  const root = el('div', 'mv3-wk-frags');
  host.appendChild(root);

  const head = el('div', 'mv3-ins-head is-wk');
  const txt = el('div', 'mv3-ins-head-txt');
  txt.appendChild(el('div', 'mv3-ins-title', 'fragments'));
  txt.appendChild(el('div', 'mv3-ins-sub', _saving ? 'saving…' : 'The frame and the clip of each fragment'));
  head.appendChild(txt);

  const p = ctx.project;
  if (!p) { root.appendChild(head); root.appendChild(_note('Reading the project…')); return; }
  if (_kit === null) _loadKit(ctx.repaint);
  const lines = Array.isArray(p.lines) ? p.lines : [];

  // Which fragment is open: the address first (it is the newer instruction), then where this
  // project was left, then the first.
  if (_key !== ctx.key) { _key = ctx.key; _open = null; _listAt = 0; }
  if (_open === null) _open = _asked >= 0 ? _asked : _remembered();
  _asked = -1;
  if (_open >= lines.length) _open = lines.length ? 0 : -1;

  const scroll = el('div', 'mv3-wk-scroll is-split');
  root.appendChild(scroll);
  const left = el('div', 'mv3-wk-half is-frags');
  scroll.appendChild(left);
  left.appendChild(head);
  const right = el('div', 'mv3-wk-half is-guide is-frag');
  scroll.appendChild(right);

  const missing = _missing(p);
  _controls(left, lines, missing);
  _list(left, p, lines);

  if (!lines.length) {
    right.appendChild(_note('This project has no lines. The script is written on the Scenarios page and comes with the project.'));
    PV.showStill('', '');
    return;
  }
  if (missing.length) _gate(right, missing);
  else if (_open < 0) _all(right, p, lines);
  else _fragment(right, p, lines[_open], _open);
  _stage(p, _open < 0 ? null : lines[_open], _open);
}

function _note(text, bad) {
  const d = el('div', 'mv3-ins-note' + (bad ? ' is-err' : ''));
  d.textContent = text;
  return d;
}

// What the step cannot work without: the person in a look, the place, and the voice they are read
// in. Anything missing is named, and the way back is one button.
function _missing(p) {
  const cast = p.casting || {};
  const out = [];
  if (!cast.obrazImage) out.push('a character in a look');
  if (!cast.locationImage) out.push('an environment');
  if (!(p.castVoice && p.castVoice.has)) out.push('a voice');
  return out;
}

function _gate(host, missing) {
  host.appendChild(el('div', 'mv3-wk-guide-h', 'Not yet'));
  host.appendChild(el('p', 'mv3-wk-guide-p',
    'Frames and clips are made from the person in their look, standing in the place, speaking in their voice. Still missing: '
    + missing.join(', ') + '.'));
  const b = el('button', 'mv3-wk-vmore', 'setting & voice');
  b.type = 'button';
  b.title = 'Back to the step where these are chosen';
  b.addEventListener('click', () => _ctx.goStep('setting'));
  const row = el('div', 'mv3-wk-vfoot');
  row.appendChild(b);
  host.appendChild(row);
}

// ── The left column: the settings of the whole project, and the script ─────
function _controls(host, lines, missing) {
  const blocked = missing.length > 0;
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
  host.appendChild(sets);

  // THE MOOD OF THE VIDEO - the emotion of the whole thing, the one choice the person makes here
  // (owner, 2026-09-18). The agent reads every shot and animation prompt from it; changing it makes
  // every reading stale.
  const moods = el('div', 'mv3-wk-fsets');
  const mood = el('select', 'mv3-wk-vsel is-small is-wide');
  mood.title = 'The emotion of the whole video: the agent shoots and animates every line from it';
  for (const m of (_kit && _kit.moods) || []) {
    const o = el('option', '', 'mood: ' + m.label);
    o.value = m.id;
    if (m.id === v.mood) o.selected = true;
    mood.appendChild(o);
  }
  mood.disabled = _saving || !_kit || !!_reading;
  mood.addEventListener('change', () => _saveVideo({ mood: mood.value }));
  moods.appendChild(mood);
  host.appendChild(moods);

  // What is done to all of them at once - here so its place is known; they come with their phases.
  const acts = el('div', 'mv3-wk-facts');
  const r = _reading;
  const read = el('button', 'mv3-wk-vmore is-small' + (r && r.total ? ' is-busy' : ''),
    r && r.total ? 'reading lines ' + r.from + '–' + r.to + ' of ' + r.total + '…' : 'read the script');
  read.type = 'button';
  read.disabled = blocked || !!r || !lines.length;
  read.title = blocked ? 'Needs the setting first'
    : 'The agent plans every line - shot, pose, camera, direction, animation - five lines at a time';
  read.addEventListener('click', () => _readScript());
  const noFrame = lines.filter(l => !_frameOf(_ctx.project, l)).length;
  const frames = el('button', 'mv3-wk-vmore is-small', noFrame ? 'make ' + noFrame + ' frame' + (noFrame === 1 ? '' : 's') : 'every line has a frame');
  frames.type = 'button';
  frames.disabled = true;
  frames.title = blocked ? 'Needs the setting first' : 'Every missing frame at once, ' + _money(noFrame * FRAME_PRICE) + ' - comes with the frames (F3)';
  acts.append(read, frames);
  host.appendChild(acts);
  if (_said) host.appendChild(_note(_said, true));
  if (_readErr) host.appendChild(_note(_readErr, true));
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

  const fr = _frameOf(p, l);
  const thumb = el('div', 'mv3-wk-fthumb' + (fr ? '' : ' is-empty'));
  if (fr) {
    const img = el('img');
    img.alt = '';
    img.loading = 'lazy';
    img.src = derived(fr.preview || fr.path, 'card');
    thumb.appendChild(img);
  }
  row.appendChild(thumb);

  row.appendChild(el('div', 'mv3-wk-ftext', _words(l) || '(no words)'));

  const dots = el('div', 'mv3-wk-fdots');
  const dot = (state, what) => {
    const d = el('span', 'mv3-wk-fdot is-' + state);
    d.title = what + ': ' + (state === 'ok' ? 'done' : state === 'stale' ? (what === 'shot' ? 'the words or the mood changed since' : 'the words changed since') : 'not yet');
    dots.appendChild(d);
  };
  dot(_readState(l), 'read');
  dot(_shotState(l), 'shot');
  dot(fr ? 'ok' : 'none', 'frame');
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

// ── The right column with no fragment open: all of them ─────────────────────
// What is shared by every clip will live here (owner, 2026-09-18) - which settings exactly is still
// to be decided, and one idea is drawing first frames by hand, once, for several lines at a time
// instead of one per fragment. For now it says where the script stands.
function _all(host, p, lines) {
  const n = lines.length;
  const read = lines.filter(l => _readState(l) === 'ok').length;
  const shots = lines.filter(l => _shotState(l) === 'ok').length;
  const framed = lines.filter(l => _frameOf(p, l)).length;
  const clipped = lines.filter(l => _clipState(l) === 'ok').length;
  const secs = lines.reduce((a, l) => a + (((_take(l) || {}).dur) || 0), 0);

  const top = el('div', 'mv3-wk-fhead');
  top.appendChild(el('span', 'mv3-wk-ftitle', 'all fragments'));
  top.appendChild(el('span', 'mv3-wk-vsub', n + (n === 1 ? ' line' : ' lines') + (secs ? ' · ' + secs.toFixed(1) + ' s read' : '')));
  host.appendChild(top);

  const stat = el('div', 'mv3-wk-fstats');
  const cell = (label, done) => {
    const c = el('div', 'mv3-wk-fstat' + (done === n ? ' is-done' : ''));
    c.appendChild(el('div', 'mv3-wk-fstat-n', done + '/' + n));
    c.appendChild(el('div', 'mv3-wk-fstat-l', label));
    stat.appendChild(c);
  };
  cell('read', read);
  cell('shots', shots);
  cell('frames', framed);
  cell('clips', clipped);
  host.appendChild(stat);

  host.appendChild(el('div', 'mv3-wk-vhead is-lib', 'For every clip'));
  host.appendChild(el('div', 'mv3-wk-fsoon', 'Settings shared by every fragment will be here - which ones is still to be decided. One idea: drawing first frames by hand, once, for several lines at a time instead of one per fragment.'));
  host.appendChild(el('div', 'mv3-wk-fsoon', 'Pick a fragment on the left to work on it; press it again to come back here.'));
}

// ── The right column: the open fragment ─────────────────────────────────────
function _fragment(host, p, l, i) {
  const take = _take(l);
  const rs = _readState(l);

  const top = el('div', 'mv3-wk-fhead');
  top.appendChild(el('span', 'mv3-wk-ftitle', 'fragment ' + (i + 1)));
  top.appendChild(_playBtn(take && take.path ? take.path : '', 'the read'));
  top.appendChild(el('span', 'mv3-wk-vsub', take && take.dur ? take.dur.toFixed(1) + ' s' : 'not read'));
  const edit = el('button', 'mv3-wk-flink', 'edit words →');
  edit.type = 'button';
  edit.title = 'The words are edited beside the voice, in setting & voice';
  edit.addEventListener('click', () => _ctx.goStep('setting'));
  top.appendChild(edit);
  host.appendChild(top);
  host.appendChild(el('div', 'mv3-wk-fwords', '“' + (_words(l) || '…') + '”'));
  if (rs === 'stale') host.appendChild(_note('The words changed after this line was read - read it again in setting & voice.', true));

  _shotBlock(host, l, i);

  // FRAME - the picture the line opens on.
  host.appendChild(el('div', 'mv3-wk-vhead is-lib', 'Frame'));
  const fr = _frameOf(p, l);
  const fbox = el('div', 'mv3-wk-fframe-row');
  const frame = el('div', 'mv3-wk-fframe' + (fr ? '' : ' is-empty'));
  if (fr) {
    const img = el('img');
    img.alt = '';
    img.src = derived(fr.preview || fr.path, 'card');
    frame.appendChild(img);
  } else {
    frame.appendChild(el('span', '', 'no frame'));
  }
  fbox.appendChild(frame);
  const fside = el('div', 'mv3-wk-fside');
  const make = el('button', 'mv3-wk-vmore', (fr ? 'again' : 'make frame') + ' · ' + _money(FRAME_PRICE));
  make.type = 'button';
  make.disabled = true;
  make.title = 'nano-banana-2, 2K - comes with the frames (F3)';
  fside.appendChild(make);
  fside.appendChild(el('div', 'mv3-wk-fsoon', fr ? 'A frame this line already had.' : 'Drawn from the pose, the person in their look and the place. Phase F3.'));
  fbox.appendChild(fside);
  host.appendChild(fbox);

  // CLIP - the frame speaking the read. The animation prompt first: it is what Kling is told.
  host.appendChild(el('div', 'mv3-wk-vhead is-lib', 'Clip'));
  _motionField(host, l, i);
  const tier = _tier();
  let label;
  let why = '';
  if (rs !== 'ok') { label = 'read this line first'; why = 'A clip is as long as its read: make or refresh the read in setting & voice.'; }
  else if (!fr) { label = 'make a frame first'; why = 'The clip is the frame speaking.'; }
  else if (take.dur > _ceiling()) { label = 'too long for Kling (' + take.dur.toFixed(1) + ' s)'; why = 'Kling avatar takes up to ' + _ceiling() + ' s: split the line.'; }
  else label = 'make clip · ' + take.dur.toFixed(1) + ' s · ' + (tier ? _money(take.dur * tier.pricePerSec) : '…');
  const clipBtn = el('button', 'mv3-wk-vmore' + (rs === 'ok' && fr ? ' is-go' : ''), label);
  clipBtn.type = 'button';
  clipBtn.disabled = true;
  clipBtn.title = 'Kling avatar - comes with the clips (F4)';
  const crow = el('div', 'mv3-wk-vfoot');
  crow.appendChild(clipBtn);
  if (rs !== 'ok') {
    const back = el('button', 'mv3-wk-flink', 'setting & voice →');
    back.type = 'button';
    back.addEventListener('click', () => _ctx.goStep('setting'));
    crow.appendChild(back);
  }
  host.appendChild(crow);
  if (why) host.appendChild(el('div', 'mv3-wk-fsoon', why));

  // The takes a line already has - projects made on the old page can carry some.
  const clips = ((l.video || {}).plain || []);
  if (clips.length) {
    const now = _clipOf(l);
    for (const c of clips.slice().reverse()) {
      const r = el('div', 'mv3-wk-vrow' + (now && c.id === now.id ? ' is-on' : ''));
      r.appendChild(el('span', 'mv3-wk-vname', 'take · ' + (c.dur ? c.dur.toFixed(1) + ' s' : '')));
      if (c.said !== _words(l)) r.appendChild(el('span', 'mv3-wk-fstale', 'stale'));
      if (now && c.id === now.id) r.appendChild(el('span', 'mv3-wk-vtag', 'the clip'));
      host.appendChild(r);
    }
  } else {
    host.appendChild(el('div', 'mv3-wk-fsoon', 'No clips yet. Made with Kling avatar in phase F4; the clip then plays on the stage.'));
  }
}

// SHOT - how the line is filmed: the agent's choice, every part of it changeable by hand.
function _shotBlock(host, l, i) {
  const sh = l.shot || null;
  const st = _shotState(l);
  const busy = !!_reading;
  const mine = _reading && _reading.line === i;

  const headRow = el('div', 'mv3-wk-vhead is-lib is-row', 'Shot');
  const acts = el('div', 'mv3-wk-vheadacts');
  const again = el('button', 'mv3-wk-vmore is-small', mine ? 'reading…' : (sh ? 'read again' : 'read this line'));
  again.type = 'button';
  again.disabled = busy || !!_missing(_ctx.project).length;
  again.title = 'The agent plans this line again, keeping the rhythm with the others';
  again.addEventListener('click', () => _readLine(i));
  acts.appendChild(again);
  headRow.appendChild(acts);
  host.appendChild(headRow);

  const cat = _kit || { framings: [], poses: [], cameras: [] };
  const pick = (cls, title, items, value, label, onChange) => {
    const sel = el('select', 'mv3-wk-vsel is-small ' + cls);
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
  const row1 = el('div', 'mv3-wk-fsets is-shot');
  row1.appendChild(pick('is-framing', 'How much of the person is in the frame', cat.framings, framing, 'shot size',
    (v) => _saveShot(i, { framing: v })));
  // Only the poses of this shot size: each mannequin belongs to exactly one.
  const poses = cat.poses.filter(p => !framing || p.group === framing).map(p => ({ id: p.id, label: p.label, title: p.desc }));
  row1.appendChild(pick('is-pose', 'The body position - one of the mannequins of this shot size', poses, (sh && sh.poseId) || '', 'pose',
    (v) => _saveShot(i, { poseId: v })));
  const pose = sh ? _poseById(sh.poseId) : null;
  const man = el('div', 'mv3-wk-fman' + (pose ? '' : ' is-empty'));
  if (pose && pose.thumb) {
    const img = el('img');
    img.alt = '';
    img.src = pose.thumb;
    man.title = pose.label + ' - ' + pose.desc;
    man.appendChild(img);
  }
  row1.appendChild(man);
  host.appendChild(row1);
  const row2 = el('div', 'mv3-wk-fsets is-shot');
  row2.appendChild(pick('is-camera', 'The lens and how it renders', cat.cameras.map(c => ({ id: c.id, label: c.label, title: c.summary })),
    (sh && sh.camera) || '', 'camera', (v) => _saveShot(i, { camera: v })));
  host.appendChild(row2);

  host.appendChild(el('div', 'mv3-wk-flabel', 'direction'));
  host.appendChild(_textField(i, 'direction', (sh && sh.direction) || '', 2,
    'The first frame, frozen: where the body, the hands and the head are, and the expression as the line begins',
    (v) => _saveShot(i, { direction: v })));
  if (sh && sh.why) host.appendChild(el('div', 'mv3-wk-fwhy', sh.why));
  if (st === 'stale') host.appendChild(_note('The words or the mood of the video changed since this line was read - read it again.', true));
  if (!sh) host.appendChild(el('div', 'mv3-wk-fsoon', 'Not read yet: "read the script" plans every line, or read this one alone. Anything here can also be set by hand.'));
}

// The animation prompt: what Kling is told about the expression, the head, the hands and the gaze.
// Written by the agent; a version written by hand stays through the next reading, and the agent's
// own is one press away.
function _motionField(host, l, i) {
  const sh = l.shot || null;
  const lab = el('div', 'mv3-wk-flabel is-row');
  lab.appendChild(el('span', '', 'animation prompt'));
  if (sh && sh.motionEdited) {
    lab.appendChild(el('span', 'mv3-wk-fedited', 'edited by hand'));
    if (sh.motionAgent) {
      const back = el('button', 'mv3-wk-flink', 'use the agent’s');
      back.type = 'button';
      back.title = sh.motionAgent;
      back.disabled = !!_reading;
      back.addEventListener('click', () => { delete _drafts[i + ':motion']; _saveShot(i, { useAgentMotion: true }); });
      lab.appendChild(back);
    }
  }
  host.appendChild(lab);
  host.appendChild(_textField(i, 'motion', (sh && sh.motion) || '', 3,
    'How the person moves while speaking - the expression, the head, the hands, the gaze. Kling hears nothing else.',
    (v) => _saveShot(i, { motion: v })));
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

// ── The stage ───────────────────────────────────────────────────────────────
// The open fragment: its clip when it has one (the poster, until the clips phase plays it), else
// its frame; with neither, what the frame will be made of - the person in their look over the place.
function _stage(p, l, i) {
  const cast = p.casting || {};
  const pair = () => (cast.obrazImage || cast.locationImage
    ? PV.showPair(cast.obrazImage ? derived(cast.obrazImage, 'main') : '', cast.locationImage ? derived(cast.locationImage, 'main') : '')
    : PV.showStill('', ''));
  if (!l) { pair(); return; }
  const c = _clipOf(l);
  if (c && c.thumb) { PV.showStill(c.thumb, 'fragment ' + (i + 1) + ' · clip'); return; }
  const fr = _frameOf(p, l);
  if (fr) { PV.showStill(derived(fr.preview || fr.path, 'main'), 'fragment ' + (i + 1)); return; }
  pair();
}

/** Leaving the step stops the read that was playing. */
export function leave() {
  if (_audio) { _audio.pause(); _playing = ''; }
}
