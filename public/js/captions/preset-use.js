/* ═══════════════════════════════════════════════════════════════════════════
   CAPTIONS — a preset as a project wears it (phase K6, 2026-10-03).

   presets.js is made by a tool and not edited by hand, so what the page and the server do WITH a preset
   lives here. A preset is a BASE (the owner, 2026-10-03): applying it copies its whole style into the
   project, marked with its id (`preset`); what is changed afterwards lives in the project only, and
   "back to the preset" takes it away.
   ═══════════════════════════════════════════════════════════════════════════ */

import { presetOf } from './presets.js';
import { normalizeStyle, DEF } from './style.js';

/** The whole style a preset gives, marked with its id - or null for an id the app does not ship. */
export function presetStyle(id) {
  const p = presetOf(id);
  return p ? normalizeStyle(Object.assign({}, p.style, { preset: p.id })) : null;
}

/** A preset's name, '' for none. */
export const presetName = (id) => { const p = presetOf(id); return p ? p.name : ''; };

/** The fields of a style that differ from the preset it was made from ([] when none, or no preset). */
export function editedKeys(style) {
  const s = normalizeStyle(style || {});
  const base = s.preset ? presetStyle(s.preset) : null;
  if (!base) return [];
  return Object.keys(DEF).filter((k) => k !== 'preset' && JSON.stringify(s[k]) !== JSON.stringify(base[k]));
}
