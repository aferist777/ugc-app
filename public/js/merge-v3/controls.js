/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — the inspector's controls. Phase I2.

   One place for the four row types the panels need, because the old editor built
   them ad hoc at each call site and they drifted: sliders with different readouts,
   selects with and without labels, switches that were sometimes checkboxes.

   THE ONE RULE THAT MATTERS HERE. A slider fires `input` on every pixel of a drag
   and `change` once on release. The readout follows `input` so the number moves under
   your finger; the SAVE follows `change`, so dragging from 1.00x to 1.50x is one
   store write and one undo step. Committing per `input` would bury the state you
   wanted back under fifty near-identical snapshots - the same mistake avoided in the
   clip drag, for the same reason.

   Everything applies immediately. There are no Apply buttons: they exist for
   destructive or expensive actions, and none of these are either.
   ═══════════════════════════════════════════════════════════════════════════ */

import { wire as wireRange } from '../ui-range.js';
// (phase V73 block 5, part 5b) a pressed button may be a Lucide icon; a label's figures in mono (js/num.js)
import { icon } from '../icons.js';
import { setFigures } from '../num.js';

// A labelled row. The label column is fixed so every control on the panel lines up
// down the left edge, which is what makes a stack of them readable at 240px.
export function row(label, control) {
  const r = document.createElement('div');
  r.className = 'mv3-c-row';
  const l = document.createElement('span');
  l.className = 'mv3-c-lbl';
  setFigures(l, label || '');
  r.appendChild(l);
  const box = document.createElement('span');
  box.className = 'mv3-c-ctl';
  box.appendChild(control);
  r.appendChild(box);
  return r;
}

// A note under the controls, for a rule the UI cannot show by itself (what overrides
// what, what is not wired yet). `flush` - under a row of buttons with no label, so it starts
// at the edge rather than at the label column.
export function hint(text, flush) {
  const h = document.createElement('div');
  h.className = 'mv3-c-hint' + (flush ? ' is-flush' : '');
  h.textContent = text;
  return h;
}

// A row of buttons with no label (phase S2): the whole width of the strip is theirs, so three fit
// where a labelled row took two. Missing ones are skipped; a label too long for its share ends in "…"
// and is whole in its title.
export function acts(btns) {
  const r = document.createElement('div');
  r.className = 'mv3-c-acts';
  for (const b of btns || []) {
    if (!b) continue;
    if (!b.title) b.title = b.textContent;
    r.appendChild(b);
  }
  return r;
}

// (phase V54) `mixed` - several things picked disagree: the readout says "mixed" until the slider is moved, and the move gives
// them all one value. `onInput` - for a gesture heard while it is held (the shift of several levels); still nothing written.
export function slider({ min, max, step, value, fmt, onChange, onInput, mixed }) {
  const wrap = document.createElement('span');
  wrap.className = 'mv3-c-slider';
  const inp = document.createElement('input');
  inp.type = 'range';
  inp.min = String(min); inp.max = String(max); inp.step = String(step);
  inp.value = String(value);
  wireRange(inp);                                   // (phase V73 block 2) the shared slider, its track filled to the thumb
  const out = document.createElement('span');
  out.className = 'mv3-c-num';
  let moved = false;
  const show = (v) => { out.textContent = (mixed && !moved) ? 'mixed' : (fmt ? fmt(v) : String(v)); };
  show(+value);
  // Live readout, no write.
  inp.addEventListener('input', () => { moved = true; show(+inp.value); if (onInput) onInput(+inp.value); });
  // One write, on release.
  inp.addEventListener('change', () => { moved = true; if (onChange) onChange(+inp.value); });
  wrap.appendChild(inp);
  wrap.appendChild(out);
  return wrap;
}

// (phase V84, the owner 2026-11-10) A stretch on ONE track - its start and its end, two thumbs, one readout. `fit(a, b, which)` is
// the caller's rule for the thumb moved ('a' or 'b'): it returns [a, b] as they may be, and the other thumb follows while the hand
// moves. Nothing is written until the release - one write, one undo step, as a slider's.
// (the owner 2026-11-10) `label` - its name OVER it and the track the strip's whole width, `ends` - the two numbers under its ends;
// `onInput(a, b)` - told while a thumb is held (nothing written).
export function span({ min, max, step, a, b, fmt, fit, onChange, onInput, label, ends }) {
  const wrap = document.createElement('span');
  wrap.className = 'mv3-c-span';
  const track = document.createElement('span');
  track.className = 'mv3-c-span-track';
  const mk = (v) => {
    const i = document.createElement('input');
    i.type = 'range';
    i.className = 'u-range';
    i.min = String(min); i.max = String(max); i.step = String(step);
    i.value = String(v);
    return i;
  };
  const ia = mk(a), ib = mk(b);
  track.append(ia, ib);
  const out = document.createElement('span');
  out.className = 'mv3-c-num';
  let cur = [+a, +b];
  const pc = (v) => (max > min ? Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100)) : 0);
  const paint = () => {
    track.style.setProperty('--a', pc(cur[0]).toFixed(2) + '%');
    track.style.setProperty('--b', pc(cur[1]).toFixed(2) + '%');
    // Two thumbs in one place: the start's on top in the right half, so the one that can still move is the one under the hand.
    ia.classList.toggle('is-top', cur[0] > (min + max) / 2);
    out.textContent = fmt ? fmt(cur[0], cur[1]) : cur[0] + '–' + cur[1];
  };
  const move = (which) => {
    const na = +ia.value, nb = +ib.value;
    cur = fit ? fit(na, nb, which) : [Math.min(na, nb), Math.max(na, nb)];
    if (which === 'a') ib.value = String(cur[1]); else ia.value = String(cur[0]);
    paint();
    if (onInput) onInput(cur[0], cur[1]);
  };
  ia.addEventListener('input', () => move('a'));
  ib.addEventListener('input', () => move('b'));
  const done = () => { if (onChange) onChange(cur[0], cur[1]); };
  ia.addEventListener('change', done);
  ib.addEventListener('change', done);
  paint();
  if (!label) { wrap.append(track, out); return wrap; }
  // The stacked form: the name and the numbers on one line over the track, the ends under it.
  const box = document.createElement('div');
  box.className = 'mv3-c-spanbox';
  const head = document.createElement('div');
  head.className = 'mv3-c-spanhead';
  const l = document.createElement('span');
  l.className = 'mv3-c-lbl';
  setFigures(l, label);
  head.append(l, out);
  box.appendChild(head);
  box.appendChild(track);
  if (Array.isArray(ends) && ends.length === 2) {
    const sc = document.createElement('div');
    sc.className = 'mv3-c-spanends';
    const e0 = document.createElement('span'), e1 = document.createElement('span');
    e0.textContent = ends[0];
    e1.textContent = ends[1];
    sc.append(e0, e1);
    box.appendChild(sc);
  }
  return box;
}

// ── Volume, in decibels ─────────────────────────────────────────────────────
// The number stored stays LINEAR - a multiplier, which is what the renderer and the preview
// both want - and only the control speaks dB. Migrating the stored unit would have meant
// touching every consumer to gain nothing; what was actually wrong was the dial, not the
// value behind it.
//
// A percentage is the wrong unit for audio. 150% says nothing about how much louder that is,
// and the useful half of the range is squeezed into the bottom: half volume is -6 dB, a
// quarter is -12, and both live between 0 and 50% where a slider has the least room. In dB
// the scale is even, and "bring this one up 4 dB" is a thing you can actually aim at.
//
// The bottom of the travel is MUTED rather than -40 dB, because silence is a state people
// want and 0.01 of a multiplier is not silence, it is a whisper you cannot hear but ffmpeg
// still mixes.
export const DB_MIN = -40, DB_MAX = 12;

export const toDb = (lin) => ((+lin > 0) ? Math.max(DB_MIN, 20 * Math.log10(+lin)) : DB_MIN);
export const fromDb = (db) => ((+db <= DB_MIN) ? 0 : Math.pow(10, +db / 20));
export const dbLabel = (db) => (+db <= DB_MIN ? 'muted' : (+db > 0 ? '+' : '') + (+db).toFixed(1) + ' dB');

export function volume(value, onChange) {
  return slider({
    min: DB_MIN, max: DB_MAX, step: 0.5,
    value: Math.round(toDb(value) * 2) / 2,
    fmt: dbLabel,
    onChange: (db) => onChange(fromDb(db)),
  });
}

// opts: [[value, label], ...]
export function select(opts, value, onChange) {
  const sel = document.createElement('select');
  sel.className = 'mv3-c-sel u-in is-s';
  for (const [v, l] of opts) {
    const o = document.createElement('option');
    o.value = v; o.textContent = l;
    sel.appendChild(o);
  }
  sel.value = value == null ? opts[0][0] : value;
  sel.addEventListener('change', () => { if (onChange) onChange(sel.value); });
  return sel;
}

export function toggle(on, onChange) {
  const b = document.createElement('button');
  b.type = 'button';
  // (phase V73 block 2) The shared switch (.u-switch): on is green (б1-7) - no "on / off" words in a pill any more.
  b.className = 'mv3-c-sw u-switch' + (on ? ' is-on' : '');
  b.setAttribute('role', 'switch');
  b.setAttribute('aria-checked', on ? 'true' : 'false');
  b.title = on ? 'On' : 'Off';
  b.addEventListener('click', () => { if (onChange) onChange(!on); });
  return b;
}

// The same switch, wearing the name of the thing it switches. For when it sits beside
// another control instead of at the end of a labelled row, where "on / off" would be a
// question with no question.
export function toggleNamed(label, on, onChange, title, ico) {
  const b = document.createElement('button');
  b.type = 'button';
  // (phase V73 block 2) a pressed button - the selected look (б2-13), never the switch's green
  b.className = 'mv3-c-sw u-btn is-s' + (ico ? ' is-icon' : '') + (on ? ' is-on' : '');
  b.setAttribute('aria-pressed', on ? 'true' : 'false');
  // (phase V73 block 5, 5b) `ico` - a Lucide icon in place of the label's glyph (↺, B, I, ↻); the label then names it
  if (ico) { b.innerHTML = icon(ico, 14); b.setAttribute('aria-label', title || label); } else b.textContent = label;
  if (title) b.title = title;
  b.addEventListener('click', () => { if (onChange) onChange(!on); });
  return b;
}

// A colour. The browser's own input is a fat grey button with a stripe, which looks like
// nothing else on this panel, so it is styled down to a swatch. Commits on `change` - the
// picker fires `input` on every drag through the wheel.
export function color(value, onChange) {
  const i = document.createElement('input');
  i.type = 'color';
  i.className = 'mv3-c-color';
  i.value = /^#[0-9a-fA-F]{6}$/.test(String(value || '')) ? value : '#ffffff';
  i.addEventListener('change', () => { if (onChange) onChange(i.value); });
  return i;
}

// A paragraph, for the one thing here that is prose: what a caption says. Commits on blur
// rather than per keystroke - a store write per letter would bury the undo history.
export function textarea(value, onChange, rows) {
  const t = document.createElement('textarea');
  t.className = 'mv3-c-area u-area is-s';
  t.rows = rows || 2;
  t.value = String(value == null ? '' : value);
  t.addEventListener('change', () => { if (onChange) onChange(t.value); });
  return t;
}

// Two controls on one row: the thing, and a small button beside it (clear an override,
// reset a transform). Kept here so every panel spaces them the same way.
export function pair(main, extra) {
  const w = document.createElement('span');
  w.className = 'mv3-c-pair';
  w.appendChild(main);
  if (extra) w.appendChild(extra);
  return w;
}

export function button(label, onClick, opts) {
  const o = opts || {};
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'mv3-c-btn u-btn is-s' + (o.danger ? ' danger is-danger' : '');
  b.textContent = label;
  if (o.title) b.title = o.title;
  b.addEventListener('click', onClick);
  return b;
}

// ── The effect lists ────────────────────────────────────────────────────────
// Copied verbatim from js/mergev2-tab.js rather than reinvented: these values are what
// the ffmpeg side already knows how to render, so a prettier name here would be a
// setting that silently does nothing.
export const TRANSITIONS = [
  ['none', 'None'], ['fade', 'Fade (black)'], ['fadewhite', 'Fade (white)'],
  ['blur', 'Blur In/Out'], ['whip-pan-h', 'Whip Pan ↔'], ['whip-pan-v', 'Whip Pan ↕'],
  ['zoom-punch-in', 'Zoom Punch In'], ['zoom-punch-out', 'Zoom Punch Out'],
  ['flash-white', 'Flash (white)'], ['glitch', 'Glitch'],
];
export const ANIMATIONS = [
  ['none', 'None'], ['zoom_in', 'Zoom In (slow)'], ['zoom_out', 'Zoom Out (slow)'],
];
export const FILTERS = [
  ['none', 'None'], ['vignette', 'Vignette'], ['sharpen', 'Sharpen'],
  ['warm', 'Warm tone'], ['cool', 'Cool tone'], ['glitch', 'Glitch'],
  ['bw', 'B&W'], ['vhs', 'VHS / Vintage'], ['cinematic', 'Cinematic'], ['sepia', 'Sepia'],
];

export const pct = (v) => Math.round(v * 100) + '%';
export const times = (v) => v.toFixed(2) + 'x';
