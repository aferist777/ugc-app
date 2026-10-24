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
   ═══════════════════════════════════════════════════════════════════════════ */

import { presetOf } from './presets.js';
import { textPresetOf, TEXT_KEEP } from './presets-text.js';
import { normalizeStyle, DEF } from './style.js';

let _mine = [];
/** The person's own presets ({id, name, style}), as the page last heard them. */
export function setMine(list) { _mine = (Array.isArray(list) ? list : []).filter((p) => p && p.id && p.style); }
const _find = (id) => presetOf(id) || textPresetOf(id) || _mine.find((p) => p.id === id) || null;

/** Is it a text preset - the app's (presets-text.js) or the person's saved from text? */
export const isTextPreset = (id) => { const p = _find(id); return !!p && p.kind === 'text'; };

/** The whole style a preset gives, marked with its id - or null for an id that is neither the app's nor the person's. */
export function presetStyle(id) {
  const p = _find(id);
  return p ? normalizeStyle(Object.assign({}, p.style, { preset: p.id })) : null;
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

/** A preset's name, '' for none. */
export const presetName = (id) => { const p = _find(id); return p ? p.name : ''; };

/** The fields of a style that differ from the preset it was made from ([] when none, or no preset). */
export function editedKeys(style) {
  const s = normalizeStyle(style || {});
  const base = s.preset ? presetStyle(s.preset) : null;
  if (!base) return [];
  const keep = isTextPreset(s.preset) ? TEXT_KEEP : [];
  return Object.keys(DEF).filter((k) => k !== 'preset' && !keep.includes(k) && JSON.stringify(s[k]) !== JSON.stringify(base[k]));
}
