/* ═══════════════════════════════════════════════════════════════════════════
   CAPTIONS — a preset as a project wears it (phase K6, 2026-10-03).

   presets.js is made by a tool and not edited by hand, so what the page and the server do WITH a preset
   lives here. A preset is a BASE (the owner, 2026-10-03): applying it copies its whole style into the
   project, marked with its id (`preset`); what is changed afterwards lives in the project only, and
   "back to the preset" takes it away.

   The person's OWN presets (phase V30, block 5) are bases the same way: the page is told the list
   (merge-v3/my-presets.js -> setMine) and a preset is looked for among the app's first, then among them. One
   deleted is simply not found: "based on" stops being said, and the project keeps the look it copied.
   ═══════════════════════════════════════════════════════════════════════════ */

import { presetOf } from './presets.js';
import { normalizeStyle, DEF } from './style.js';

let _mine = [];
/** The person's own presets ({id, name, style}), as the page last heard them. */
export function setMine(list) { _mine = (Array.isArray(list) ? list : []).filter((p) => p && p.id && p.style); }
const _find = (id) => presetOf(id) || _mine.find((p) => p.id === id) || null;

/** The whole style a preset gives, marked with its id - or null for an id that is neither the app's nor the person's. */
export function presetStyle(id) {
  const p = _find(id);
  return p ? normalizeStyle(Object.assign({}, p.style, { preset: p.id })) : null;
}

/** A preset's name, '' for none. */
export const presetName = (id) => { const p = _find(id); return p ? p.name : ''; };

/** The fields of a style that differ from the preset it was made from ([] when none, or no preset). */
export function editedKeys(style) {
  const s = normalizeStyle(style || {});
  const base = s.preset ? presetStyle(s.preset) : null;
  if (!base) return [];
  return Object.keys(DEF).filter((k) => k !== 'preset' && JSON.stringify(s[k]) !== JSON.stringify(base[k]));
}
