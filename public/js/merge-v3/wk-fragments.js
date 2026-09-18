/* ════════════════════════════════════════════════════════════════════════════
   MERGE — the workshop's second step: the FRAME and the CLIP of every line
   (docs/local-app/PLAN.md, "Fragments — полный план по фазам").

   Loaded when the step is opened (js/merge-v3/workshop.js). Two columns, the way the setting step
   is laid out: on the left the whole script, one row per line with what it has - the read, the
   frame, the clip; on the right the line that is open, with the three things made for it - how it
   is shot, the frame, the clip. The list never goes away while a fragment is open: the script is
   one thing, and judging a line means seeing the ones around it.

   PHASE F1 - THE SHELL. Nothing here generates yet. The controls stand where they will work, so the
   step can be judged as it will look; each says which phase brings it (F2 the agent's reading of
   the script, F3 the frames, F4 the clips).

   WHAT IS READ, NOT OWNED. The lines, their reads and any frames and clips already made are the
   scenario project's, as they have always been (routes/scen3.js). The only things written from here
   are the clip settings - the tier, the motion, the mode - on `project.video`, merged on the server.
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
  fetch('/api/scen3/motion-presets').then(r => r.json()).then((d) => {
    _kit = (d && d.success) ? d : { presets: [], qualities: [] };
    _kitState = 'done';
  }).catch(() => { _kit = { presets: [], qualities: [] }; _kitState = 'done'; })
    .finally(() => repaint());
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

  // The motion, for every clip of the project - its own row, so its name can be read.
  const moves = el('div', 'mv3-wk-fsets');
  const motion = el('select', 'mv3-wk-vsel is-small is-wide');
  const preset = ((_kit && _kit.presets) || []).find(x => x.id === v.preset);
  motion.title = preset ? preset.note : 'How the person moves while speaking - one for the whole script';
  for (const m of (_kit && _kit.presets) || []) {
    const o = el('option', '', 'motion: ' + m.label);
    o.value = m.id;
    if (m.id === v.preset) o.selected = true;
    motion.appendChild(o);
  }
  motion.disabled = _saving || !_kit;
  motion.addEventListener('change', () => _saveVideo({ preset: motion.value }));
  moves.appendChild(motion);
  host.appendChild(moves);

  // What is done to all of them at once - here so its place is known; they come with their phases.
  const acts = el('div', 'mv3-wk-facts');
  const read = el('button', 'mv3-wk-vmore is-small', 'read the script');
  read.type = 'button';
  read.disabled = true;
  read.title = blocked ? 'Needs the setting first' : 'The agent reads every line - comes in the next phase (F2)';
  const noFrame = lines.filter(l => !_frameOf(_ctx.project, l)).length;
  const frames = el('button', 'mv3-wk-vmore is-small', noFrame ? 'make ' + noFrame + ' frame' + (noFrame === 1 ? '' : 's') : 'every line has a frame');
  frames.type = 'button';
  frames.disabled = true;
  frames.title = blocked ? 'Needs the setting first' : 'Every missing frame at once, ' + _money(noFrame * FRAME_PRICE) + ' - comes with the frames (F3)';
  acts.append(read, frames);
  host.appendChild(acts);
  if (_said) host.appendChild(_note(_said, true));
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
    d.title = what + ': ' + (state === 'ok' ? 'done' : state === 'stale' ? 'the words changed since' : 'not yet');
    dots.appendChild(d);
  };
  dot(_readState(l), 'read');
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

  // SHOT - how the line is filmed. The agent's reading fills these (F2); they stand here now.
  host.appendChild(el('div', 'mv3-wk-vhead is-lib', 'Shot'));
  const shot = el('div', 'mv3-wk-fsets is-shot');
  for (const label of ['shot size', 'pose', 'camera']) {
    const s = el('select', 'mv3-wk-vsel is-small');
    s.disabled = true;
    s.appendChild(el('option', '', label));
    shot.appendChild(s);
  }
  host.appendChild(shot);
  host.appendChild(el('div', 'mv3-wk-fsoon', 'The agent reads the script and fills these - shot size, the pose for it, the camera and what the person does on this line. Next phase (F2).'));

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

  // CLIP - the frame speaking the read. Why it cannot be made yet is said on the button itself.
  host.appendChild(el('div', 'mv3-wk-vhead is-lib', 'Clip'));
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
