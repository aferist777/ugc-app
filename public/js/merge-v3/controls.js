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

// A labelled row. The label column is fixed so every control on the panel lines up
// down the left edge, which is what makes a stack of them readable at 240px.
export function row(label, control) {
  const r = document.createElement('div');
  r.className = 'mv3-c-row';
  const l = document.createElement('span');
  l.className = 'mv3-c-lbl';
  l.textContent = label || '';
  r.appendChild(l);
  const box = document.createElement('span');
  box.className = 'mv3-c-ctl';
  box.appendChild(control);
  r.appendChild(box);
  return r;
}

// A note under the controls, for a rule the UI cannot show by itself (what overrides
// what, what is not wired yet).
export function hint(text) {
  const h = document.createElement('div');
  h.className = 'mv3-c-hint';
  h.textContent = text;
  return h;
}

export function slider({ min, max, step, value, fmt, onChange }) {
  const wrap = document.createElement('span');
  wrap.className = 'mv3-c-slider';
  const inp = document.createElement('input');
  inp.type = 'range';
  inp.min = String(min); inp.max = String(max); inp.step = String(step);
  inp.value = String(value);
  const out = document.createElement('span');
  out.className = 'mv3-c-num';
  const show = (v) => { out.textContent = fmt ? fmt(v) : String(v); };
  show(+value);
  // Live readout, no write.
  inp.addEventListener('input', () => show(+inp.value));
  // One write, on release.
  inp.addEventListener('change', () => { if (onChange) onChange(+inp.value); });
  wrap.appendChild(inp);
  wrap.appendChild(out);
  return wrap;
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
const DB_MIN = -40, DB_MAX = 12;

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
  sel.className = 'mv3-c-sel';
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
  b.className = 'mv3-c-sw' + (on ? ' is-on' : '');
  b.setAttribute('aria-pressed', on ? 'true' : 'false');
  b.textContent = on ? 'on' : 'off';
  b.addEventListener('click', () => { if (onChange) onChange(!on); });
  return b;
}

// The same switch, wearing the name of the thing it switches. For when it sits beside
// another control instead of at the end of a labelled row, where "on / off" would be a
// question with no question.
export function toggleNamed(label, on, onChange, title) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'mv3-c-sw' + (on ? ' is-on' : '');
  b.setAttribute('aria-pressed', on ? 'true' : 'false');
  b.textContent = label;
  if (title) b.title = title;
  b.addEventListener('click', () => { if (onChange) onChange(!on); });
  return b;
}

// A typed number, for values a slider cannot land on exactly - the picture-in-picture
// position is the case: you want 50%, not 49 or 51. Commits on `change`, which fires on
// blur or Enter, so half-typed input is never written.
export function number({ value, min, max, step, suffix, onChange }) {
  const wrap = document.createElement('span');
  wrap.className = 'mv3-c-numrow';
  const inp = document.createElement('input');
  inp.type = 'number';
  if (min != null) inp.min = String(min);
  if (max != null) inp.max = String(max);
  inp.step = String(step == null ? 1 : step);
  inp.value = String(value);
  inp.className = 'mv3-c-inp';
  inp.addEventListener('change', () => {
    let v = parseFloat(inp.value);
    if (isNaN(v)) { inp.value = String(value); return; }
    if (min != null) v = Math.max(min, v);
    if (max != null) v = Math.min(max, v);
    inp.value = String(v);
    if (onChange) onChange(v);
  });
  wrap.appendChild(inp);
  if (suffix) {
    const s = document.createElement('span');
    s.className = 'mv3-c-suf';
    s.textContent = suffix;
    wrap.appendChild(s);
  }
  return wrap;
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
  t.className = 'mv3-c-area';
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
  b.className = 'mv3-c-btn' + (o.danger ? ' danger' : '');
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
