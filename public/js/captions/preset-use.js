/* ═══════════════════════════════════════════════════════════════════════════
   CAPTIONS — a preset as a project wears it (phase K6, 2026-10-03).

   presets.js is made by a tool and not edited by hand, so what the page and the server do WITH a preset
   lives here. A preset is a BASE (the owner, 2026-10-03): applying it copies its whole style into the
   project, marked with its id (`preset`); what is changed afterwards lives in the project only, and
   "back to the preset" takes it away.

   The person's OWN presets (phase V30, block 5) are bases the same way: the page is told the list
   (merge-v3/my-presets.js -> setMine) and a preset is looked for among the app's first, then among them. One
   deleted is simply not found: "based on" stops being said, and the project keeps the look it copied.

   THE TEXT PRESETS (phase V42, presets-text.js) and the person's own saved from a text lane or line (`kind: 'text'`) are
   bases the same way - but they carry no place (the owner's (ц3)): applied, the line or lane keeps where it is (placed), and
   where it is never counts as an edit of the preset (editedKeys).

   A SUBTITLE'S IN AND OUT ARE NOT ITS PRESET'S (phase V49, the owner's (пр20)): a preset put on the subtitle lane or on its
   lines leaves their In and Out as they were (keepMotion), and an In or Out chosen is never an edit of the preset. A text
   preset's entrance and exit are its own, as before.
   ═══════════════════════════════════════════════════════════════════════════ */

import { presetOf } from './presets.js';
import { textPresetOf, TEXT_KEEP } from './presets-text.js';
import { normalizeStyle, DEF, PLACE_KEYS } from './style.js';

let _mine = [];
/** The person's own presets ({id, name, style}), as the page last heard them. */
export function setMine(list) { _mine = (Array.isArray(list) ? list : []).filter((p) => p && p.id && p.style); }
const _find = (id) => presetOf(id) || textPresetOf(id) || _mine.find((p) => p.id === id) || null;

/** Is it a text preset - the app's (presets-text.js) or the person's saved from text? */
export const isTextPreset = (id) => { const p = _find(id); return !!p && p.kind === 'text'; };

/** The whole style a preset gives, marked with its id - or null for an id that is neither the app's nor the person's. */
export function presetStyle(id) {
  const p = _find(id);
  if (!p) return null;
  const st = normalizeStyle(Object.assign({}, p.style, { preset: p.id }));
  // (V66) A held place is a lane's (style.js `hold`), never a preset's.
  delete st.hold;
  return st;
}

/**
 * The style a preset gives to something that wears `current` now: the whole preset - and for a text preset, the place of
 * `current` kept (ц3). Null for an unknown id.
 */
export function placed(id, current) {
  const st = presetStyle(id);
  if (!st || !isTextPreset(id)) return st;
  const cur = current || {};
  for (const k of TEXT_KEEP) if (cur[k] !== undefined) st[k] = cur[k];
  return normalizeStyle(st);
}

/** What of a style is its animation, not its look (phase V49, (пр20)). */
export const MOTION_KEYS = ['enter', 'enterDur', 'leave', 'leaveDur'];

/**
 * A subtitle preset's whole style `st` as worn by what wears `cur` now, its In and Out kept: a LANE keeps its own (`cur` its
 * style); a LINE (`line`) keeps only what its own style sets - the rest stays its lane's, whatever that becomes - and the
 * animation its lane's mix dealt it (`mixA`, captions/mix.js).
 */
export function keepMotion(st, cur, line) {
  if (!st) return st;
  const out = Object.assign({}, st);
  for (const k of MOTION_KEYS) {
    if (cur && cur[k] !== undefined) out[k] = cur[k];
    else if (line) delete out[k];
  }
  if (line && cur) for (const k of ['mixA', 'mixS']) if (cur[k] !== undefined) out[k] = cur[k];
  // (phase V66, the owner's (хо13)) A LANE whose place was set for several highlights fragments at once keeps it, and the mark.
  if (!line && cur && cur.hold) { for (const k of PLACE_KEYS) if (cur[k] !== undefined) out[k] = cur[k]; out.hold = true; }
  return out;
}

/** A preset's name, '' for none. */
export const presetName = (id) => { const p = _find(id); return p ? p.name : ''; };

/** The fields of a style that differ from the preset it was made from ([] when none, or no preset). */
export function editedKeys(style) {
  const s = normalizeStyle(style || {});
  const base = s.preset ? presetStyle(s.preset) : null;
  if (!base) return [];
  // (V66) A held place is no edit of the preset either.
  const keep = (isTextPreset(s.preset) ? TEXT_KEEP : MOTION_KEYS).concat(s.hold ? PLACE_KEYS : []);
  return Object.keys(DEF).filter((k) => k !== 'preset' && !keep.includes(k) && JSON.stringify(s[k]) !== JSON.stringify(base[k]));
}
