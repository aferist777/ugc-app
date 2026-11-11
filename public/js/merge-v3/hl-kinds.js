/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — the KINDS OF VIDEO in the highlights popup: their icons, their words, their standards, and what each one
   remembers (phase V68 P3, the owner 2026-11-01, (хп19), (хп35), (хп46), (хп48)-(хп50)).

   ICONS - the owner's choice in P1 (docs/local-app/mockups/v68-icons/video-<kind>.svg): pixels on a 16×16 grid, drawn as SVG
   in the page (not <img>) so `currentColor` takes the button's gold.
   ABOUT and STANDARD (phase V69 P12) - public/js/highlights/kinds.js, the ONE table of the kinds for the server and the popup: each
   kind's short line (every kind's shown while none is chosen, only at the very first opening - (хп35)) and its long words, and what
   it starts with the first time and after "reset to standard" - its length, count, moods, presets, animations, fonts and title (the
   owner's tables of P5-P11).
   MEMORY - ONE key, `mv3_hl_kinds_v1` (localStorage, mirrored to the library by storage-sync.js - Merge and Home alike):
   { v: 1, kind, kinds: { <kind>: { length, count, moods, styles, anims, fonts, title, fx } } } - the kind chosen last and each kind's last
   settings ((хп19), (хп46); `fonts` since V68 P4, `title` since V69 P12, `fx` - the agent's effects, 'none' | 'auto' | 1-5, since V90,
   'auto' by the owner's (аэ13) - a kind that has none yet takes its standard).
   The popup's memory of before (mv3_hl_ask_v1, mv3_hl_caption_picks_v1, mv3_hl_kind_style_v1, mv3_hl_music_v1) is carried over once into every kind - but not the kind itself, so the first opening of this popup shows
   every kind's words ((хп49)); the old keys are left as they are.
   ═══════════════════════════════════════════════════════════════════════════ */

import { KINDS as TABLE, BY_VIDEO as BYV, FOUND, acting } from '../highlights/kinds.js';

export const BY_VIDEO = BYV;              // "by the video" - auto's captions, music and title: the kind it finds gives its own (V69 P12)
export const YOURS = 'yours';            // the root of Music -> highlights as a "mood" (lib/highlights-music.js YOURS)

export const ICONS = {
  auto: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="M12 1h1v1h-1zM12 2h1v1h-1zM10 3h1v1h-1zM11 3h1v1h-1zM12 3h1v1h-1zM13 3h1v1h-1zM14 3h1v1h-1zM12 4h1v1h-1zM12 5h1v1h-1zM7 8h1v1h-1zM8 8h1v1h-1zM6 9h1v1h-1zM7 9h1v1h-1zM5 10h1v1h-1zM6 10h1v1h-1zM4 11h1v1h-1zM5 11h1v1h-1zM3 12h1v1h-1zM4 12h1v1h-1zM2 13h1v1h-1zM3 13h1v1h-1zM1 14h1v1h-1zM2 14h1v1h-1z"/><path fill="currentColor" fill-opacity=".45" d="M4 3h1v1h-1zM3 4h1v1h-1zM4 4h1v1h-1zM5 4h1v1h-1zM4 5h1v1h-1zM13 8h1v1h-1zM12 9h1v1h-1zM13 9h1v1h-1zM14 9h1v1h-1zM13 10h1v1h-1z"/><path fill="#f4f1e8" d="M9 6h1v1h-1zM10 6h1v1h-1zM8 7h1v1h-1zM9 7h1v1h-1z"/></svg>',
  podcast: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true"><path fill="#f4f1e8" d="M5 1h1v1h-1zM6 1h1v1h-1zM7 1h1v1h-1zM8 1h1v1h-1zM9 1h1v1h-1zM10 1h1v1h-1zM11 1h1v1h-1zM5 2h1v1h-1zM7 2h1v1h-1zM9 2h1v1h-1zM11 2h1v1h-1zM5 3h1v1h-1zM6 3h1v1h-1zM7 3h1v1h-1zM8 3h1v1h-1zM9 3h1v1h-1zM10 3h1v1h-1zM11 3h1v1h-1zM6 4h1v1h-1zM7 4h1v1h-1z"/><path fill="currentColor" d="M2 5h1v1h-1zM3 5h1v1h-1zM1 6h1v1h-1zM2 6h1v1h-1zM3 6h1v1h-1zM4 6h1v1h-1zM1 7h1v1h-1zM2 7h1v1h-1zM3 7h1v1h-1zM4 7h1v1h-1zM2 8h1v1h-1zM3 8h1v1h-1zM1 10h1v1h-1zM2 10h1v1h-1zM3 10h1v1h-1zM4 10h1v1h-1zM0 11h1v1h-1zM1 11h1v1h-1zM2 11h1v1h-1zM3 11h1v1h-1zM4 11h1v1h-1zM5 11h1v1h-1zM0 12h1v1h-1zM1 12h1v1h-1zM2 12h1v1h-1zM3 12h1v1h-1zM4 12h1v1h-1zM5 12h1v1h-1zM0 13h1v1h-1zM1 13h1v1h-1zM2 13h1v1h-1zM3 13h1v1h-1zM4 13h1v1h-1zM5 13h1v1h-1z"/><path fill="currentColor" fill-opacity=".45" d="M12 5h1v1h-1zM13 5h1v1h-1zM11 6h1v1h-1zM12 6h1v1h-1zM13 6h1v1h-1zM14 6h1v1h-1zM11 7h1v1h-1zM12 7h1v1h-1zM13 7h1v1h-1zM14 7h1v1h-1zM12 8h1v1h-1zM13 8h1v1h-1zM11 10h1v1h-1zM12 10h1v1h-1zM13 10h1v1h-1zM14 10h1v1h-1zM10 11h1v1h-1zM11 11h1v1h-1zM12 11h1v1h-1zM13 11h1v1h-1zM14 11h1v1h-1zM15 11h1v1h-1zM10 12h1v1h-1zM11 12h1v1h-1zM12 12h1v1h-1zM13 12h1v1h-1zM14 12h1v1h-1zM15 12h1v1h-1zM10 13h1v1h-1zM11 13h1v1h-1zM12 13h1v1h-1zM13 13h1v1h-1zM14 13h1v1h-1zM15 13h1v1h-1z"/></svg>',
  documentary: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="M5 1h1v1h-1zM6 1h1v1h-1zM7 1h1v1h-1zM8 1h1v1h-1zM9 1h1v1h-1zM10 1h1v1h-1zM4 2h1v1h-1zM5 2h1v1h-1zM6 2h1v1h-1zM7 2h1v1h-1zM8 2h1v1h-1zM9 2h1v1h-1zM10 2h1v1h-1zM11 2h1v1h-1zM3 3h1v1h-1zM4 3h1v1h-1zM5 3h1v1h-1zM6 3h1v1h-1zM9 3h1v1h-1zM10 3h1v1h-1zM11 3h1v1h-1zM12 3h1v1h-1zM2 4h1v1h-1zM3 4h1v1h-1zM4 4h1v1h-1zM5 4h1v1h-1zM10 4h1v1h-1zM11 4h1v1h-1zM12 4h1v1h-1zM13 4h1v1h-1zM1 5h1v1h-1zM2 5h1v1h-1zM3 5h1v1h-1zM4 5h1v1h-1zM5 5h1v1h-1zM6 5h1v1h-1zM9 5h1v1h-1zM10 5h1v1h-1zM11 5h1v1h-1zM12 5h1v1h-1zM13 5h1v1h-1zM14 5h1v1h-1zM1 6h1v1h-1zM2 6h1v1h-1zM3 6h1v1h-1zM5 6h1v1h-1zM6 6h1v1h-1zM7 6h1v1h-1zM8 6h1v1h-1zM9 6h1v1h-1zM10 6h1v1h-1zM12 6h1v1h-1zM13 6h1v1h-1zM14 6h1v1h-1zM1 7h1v1h-1zM2 7h1v1h-1zM6 7h1v1h-1zM9 7h1v1h-1zM13 7h1v1h-1zM14 7h1v1h-1zM1 8h1v1h-1zM2 8h1v1h-1zM6 8h1v1h-1zM9 8h1v1h-1zM13 8h1v1h-1zM14 8h1v1h-1zM1 9h1v1h-1zM2 9h1v1h-1zM3 9h1v1h-1zM5 9h1v1h-1zM6 9h1v1h-1zM7 9h1v1h-1zM8 9h1v1h-1zM9 9h1v1h-1zM10 9h1v1h-1zM12 9h1v1h-1zM13 9h1v1h-1zM14 9h1v1h-1zM1 10h1v1h-1zM2 10h1v1h-1zM3 10h1v1h-1zM4 10h1v1h-1zM5 10h1v1h-1zM6 10h1v1h-1zM9 10h1v1h-1zM10 10h1v1h-1zM11 10h1v1h-1zM12 10h1v1h-1zM13 10h1v1h-1zM14 10h1v1h-1zM2 11h1v1h-1zM3 11h1v1h-1zM4 11h1v1h-1zM5 11h1v1h-1zM10 11h1v1h-1zM11 11h1v1h-1zM12 11h1v1h-1zM13 11h1v1h-1zM3 12h1v1h-1zM4 12h1v1h-1zM5 12h1v1h-1zM6 12h1v1h-1zM9 12h1v1h-1zM10 12h1v1h-1zM11 12h1v1h-1zM12 12h1v1h-1zM4 13h1v1h-1zM5 13h1v1h-1zM6 13h1v1h-1zM7 13h1v1h-1zM8 13h1v1h-1zM9 13h1v1h-1zM10 13h1v1h-1zM11 13h1v1h-1zM5 14h1v1h-1zM6 14h1v1h-1zM7 14h1v1h-1zM8 14h1v1h-1zM9 14h1v1h-1zM10 14h1v1h-1z"/><path fill="#f4f1e8" d="M7 7h1v1h-1zM8 7h1v1h-1zM7 8h1v1h-1zM8 8h1v1h-1z"/><path fill="currentColor" fill-opacity=".45" d="M12 14h1v1h-1zM13 14h1v1h-1zM14 14h1v1h-1zM15 14h1v1h-1zM12 15h1v1h-1zM13 15h1v1h-1zM14 15h1v1h-1zM15 15h1v1h-1z"/></svg>',
  truecrime: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" fill-opacity=".45" d="M7 3h1v1h-1zM8 3h1v1h-1zM5 4h1v1h-1zM6 4h1v1h-1zM9 4h1v1h-1zM10 4h1v1h-1zM4 5h1v1h-1zM11 5h1v1h-1zM3 6h1v1h-1zM12 6h1v1h-1z"/><path fill="currentColor" d="M2 7h1v1h-1zM3 7h1v1h-1zM4 7h1v1h-1zM11 7h1v1h-1zM12 7h1v1h-1zM13 7h1v1h-1zM1 8h1v1h-1zM3 8h1v1h-1zM4 8h1v1h-1zM5 8h1v1h-1zM10 8h1v1h-1zM12 8h1v1h-1zM13 8h1v1h-1zM14 8h1v1h-1zM0 9h1v1h-1zM1 9h1v1h-1zM5 9h1v1h-1zM6 9h1v1h-1zM9 9h1v1h-1zM10 9h1v1h-1zM14 9h1v1h-1zM15 9h1v1h-1zM0 10h1v1h-1zM1 10h1v1h-1zM5 10h1v1h-1zM6 10h1v1h-1zM9 10h1v1h-1zM10 10h1v1h-1zM14 10h1v1h-1zM15 10h1v1h-1zM0 11h1v1h-1zM1 11h1v1h-1zM5 11h1v1h-1zM6 11h1v1h-1zM9 11h1v1h-1zM10 11h1v1h-1zM14 11h1v1h-1zM15 11h1v1h-1zM1 12h1v1h-1zM2 12h1v1h-1zM3 12h1v1h-1zM4 12h1v1h-1zM5 12h1v1h-1zM10 12h1v1h-1zM11 12h1v1h-1zM12 12h1v1h-1zM13 12h1v1h-1zM14 12h1v1h-1zM2 13h1v1h-1zM3 13h1v1h-1zM4 13h1v1h-1zM11 13h1v1h-1zM12 13h1v1h-1zM13 13h1v1h-1z"/><path fill="#f4f1e8" d="M2 8h1v1h-1zM11 8h1v1h-1z"/></svg>',
  lecture: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="M7 2h1v1h-1zM8 2h1v1h-1zM5 3h1v1h-1zM6 3h1v1h-1zM7 3h1v1h-1zM8 3h1v1h-1zM9 3h1v1h-1zM10 3h1v1h-1zM3 4h1v1h-1zM4 4h1v1h-1zM5 4h1v1h-1zM6 4h1v1h-1zM7 4h1v1h-1zM8 4h1v1h-1zM9 4h1v1h-1zM10 4h1v1h-1zM11 4h1v1h-1zM12 4h1v1h-1zM0 5h1v1h-1zM1 5h1v1h-1zM2 5h1v1h-1zM3 5h1v1h-1zM4 5h1v1h-1zM5 5h1v1h-1zM6 5h1v1h-1zM7 5h1v1h-1zM8 5h1v1h-1zM9 5h1v1h-1zM10 5h1v1h-1zM11 5h1v1h-1zM12 5h1v1h-1zM13 5h1v1h-1zM14 5h1v1h-1zM3 6h1v1h-1zM4 6h1v1h-1zM5 6h1v1h-1zM6 6h1v1h-1zM7 6h1v1h-1zM8 6h1v1h-1zM9 6h1v1h-1zM10 6h1v1h-1zM11 6h1v1h-1zM12 6h1v1h-1zM5 7h1v1h-1zM6 7h1v1h-1zM7 7h1v1h-1zM8 7h1v1h-1zM9 7h1v1h-1zM10 7h1v1h-1zM7 8h1v1h-1zM8 8h1v1h-1z"/><path fill="#f4f1e8" d="M13 6h1v1h-1zM13 7h1v1h-1zM13 8h1v1h-1zM13 9h1v1h-1zM12 10h1v1h-1zM13 10h1v1h-1zM12 11h1v1h-1zM13 11h1v1h-1z"/><path fill="currentColor" fill-opacity=".45" d="M4 7h1v1h-1zM11 7h1v1h-1zM4 8h1v1h-1zM5 8h1v1h-1zM6 8h1v1h-1zM9 8h1v1h-1zM10 8h1v1h-1zM11 8h1v1h-1zM4 9h1v1h-1zM5 9h1v1h-1zM6 9h1v1h-1zM7 9h1v1h-1zM8 9h1v1h-1zM9 9h1v1h-1zM10 9h1v1h-1zM11 9h1v1h-1zM4 10h1v1h-1zM5 10h1v1h-1zM6 10h1v1h-1zM7 10h1v1h-1zM8 10h1v1h-1zM9 10h1v1h-1zM10 10h1v1h-1zM11 10h1v1h-1z"/></svg>',
  stream: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="M1 2h1v1h-1zM2 2h1v1h-1zM3 2h1v1h-1zM4 2h1v1h-1zM5 2h1v1h-1zM6 2h1v1h-1zM7 2h1v1h-1zM8 2h1v1h-1zM9 2h1v1h-1zM10 2h1v1h-1zM11 2h1v1h-1zM12 2h1v1h-1zM13 2h1v1h-1zM14 2h1v1h-1zM1 3h1v1h-1zM14 3h1v1h-1zM1 4h1v1h-1zM14 4h1v1h-1zM1 5h1v1h-1zM14 5h1v1h-1zM1 6h1v1h-1zM14 6h1v1h-1zM1 7h1v1h-1zM14 7h1v1h-1zM1 8h1v1h-1zM14 8h1v1h-1zM1 9h1v1h-1zM14 9h1v1h-1zM1 10h1v1h-1zM14 10h1v1h-1zM1 11h1v1h-1zM2 11h1v1h-1zM3 11h1v1h-1zM4 11h1v1h-1zM5 11h1v1h-1zM6 11h1v1h-1zM7 11h1v1h-1zM8 11h1v1h-1zM9 11h1v1h-1zM10 11h1v1h-1zM11 11h1v1h-1zM12 11h1v1h-1zM13 11h1v1h-1zM14 11h1v1h-1z"/><path fill="#e5534b" d="M3 4h1v1h-1zM4 4h1v1h-1zM3 5h1v1h-1zM4 5h1v1h-1z"/><path fill="#f4f1e8" d="M6 5h1v1h-1zM7 5h1v1h-1zM6 6h1v1h-1zM7 6h1v1h-1zM8 6h1v1h-1zM9 6h1v1h-1zM6 7h1v1h-1zM7 7h1v1h-1zM8 7h1v1h-1zM9 7h1v1h-1zM6 8h1v1h-1zM7 8h1v1h-1z"/><path fill="currentColor" fill-opacity=".45" d="M7 12h1v1h-1zM8 12h1v1h-1zM7 13h1v1h-1zM8 13h1v1h-1zM4 14h1v1h-1zM5 14h1v1h-1zM6 14h1v1h-1zM7 14h1v1h-1zM8 14h1v1h-1zM9 14h1v1h-1zM10 14h1v1h-1zM11 14h1v1h-1z"/></svg>',
  fragmentation: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="M2 2h1v1h-1zM13 2h1v1h-1zM2 3h1v1h-1zM3 3h1v1h-1zM12 3h1v1h-1zM13 3h1v1h-1zM3 4h1v1h-1zM4 4h1v1h-1zM11 4h1v1h-1zM12 4h1v1h-1zM4 5h1v1h-1zM5 5h1v1h-1zM10 5h1v1h-1zM11 5h1v1h-1zM5 6h1v1h-1zM6 6h1v1h-1zM9 6h1v1h-1zM10 6h1v1h-1zM6 7h1v1h-1zM9 7h1v1h-1zM6 8h1v1h-1zM7 8h1v1h-1zM8 8h1v1h-1zM9 8h1v1h-1zM5 9h1v1h-1zM6 9h1v1h-1zM9 9h1v1h-1zM10 9h1v1h-1zM3 10h1v1h-1zM4 10h1v1h-1zM5 10h1v1h-1zM10 10h1v1h-1zM11 10h1v1h-1zM12 10h1v1h-1zM2 11h1v1h-1zM3 11h1v1h-1zM5 11h1v1h-1zM6 11h1v1h-1zM9 11h1v1h-1zM10 11h1v1h-1zM12 11h1v1h-1zM13 11h1v1h-1zM2 12h1v1h-1zM6 12h1v1h-1zM9 12h1v1h-1zM13 12h1v1h-1zM2 13h1v1h-1zM3 13h1v1h-1zM5 13h1v1h-1zM6 13h1v1h-1zM9 13h1v1h-1zM10 13h1v1h-1zM12 13h1v1h-1zM13 13h1v1h-1zM3 14h1v1h-1zM4 14h1v1h-1zM5 14h1v1h-1zM10 14h1v1h-1zM11 14h1v1h-1zM12 14h1v1h-1z"/><path fill="#f4f1e8" d="M7 7h1v1h-1zM8 7h1v1h-1z"/></svg>',
};

/** (V69 P12) Every kind's words - the table's. */
export const ABOUT = Object.fromEntries(Object.entries(TABLE).map(([k, v]) => [k, { short: v.short, long: v.long }]));

/** (phase V90, the owner's (аэ13)) The agent's effects at the cut: 'none', 'auto' or how many - 'auto' unless the kind remembers another. */
export const FX_STD = 'auto';
export const okFx = (v) => v === 'none' || v === 'auto' || [1, 2, 3, 4, 5].includes(v);
/** (V69 P12) Every kind's standard - the table's (the owner's "Итог Пn" of each kind). */
export const STANDARD = Object.fromEntries(Object.entries(TABLE).map(([k, v]) => [k, {
  length: v.length, count: v.count || 5, moods: v.moods.std.slice(), styles: v.presets.std.slice(), anims: v.anims.std.slice(),
  fonts: v.fonts.std.slice(), title: v.title, fx: FX_STD,
}]));
const FIRST_STYLE = Object.fromEntries(Object.entries(TABLE).map(([k, v]) => [k, v.presets.std.find((x) => x !== BY_VIDEO) || 'cp-podcast-viral']));
/** A kind's recommended moods, preset groups, animation pairs and font groups - the table's ({ moods, presets, anims, fonts }). */
export function recommendedOf(kind) {
  const v = TABLE[kind];
  return v ? { moods: v.moods.rec.slice(), presets: v.presets.rec.slice(), anims: v.anims.rec.slice(), fonts: v.fonts.rec.slice() }
    : { moods: [], presets: [], anims: [], fonts: [] };
}
/** A kind's standard settings - a kind with none (not in the table) the first length, 5, nothing else. */
export function standardOf(kind, lengths) {
  const s = STANDARD[kind];
  if (s) return { ...s, moods: s.moods.slice(), styles: s.styles.slice(), anims: s.anims.slice(), fonts: s.fonts.slice() };
  return { length: Object.keys(lengths || {})[0] || '', count: 5, moods: [], styles: [], anims: [], fonts: [], title: false, fx: FX_STD };
}

// ── The memory ──────────────────────────────────────────────────────────────
const LS = 'mv3_hl_kinds_v1';
const OLD = { ask: 'mv3_hl_ask_v1', picks: 'mv3_hl_caption_picks_v1', kindStyle: 'mv3_hl_kind_style_v1', music: 'mv3_hl_music_v1' };
const _read = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);

// The popup's memory of before, carried into every kind once (хп49): the lengths, the count, the caption picks (a style kept for
// a kind where "by the video" was the pick), the ticked tracks - their moods once Music -> highlights is read (`oldMusic`).
function _migrate() {
  const ask = _obj(_read(OLD.ask)) || {};
  const picks = _obj(_read(OLD.picks)) || {};
  const kindStyle = _obj(_read(OLD.kindStyle)) || {};
  const music = Array.isArray(_read(OLD.music)) ? _read(OLD.music).map(String) : [];
  const out = { v: 1, kind: '', kinds: {} };
  const styles = Array.isArray(picks.styles) ? picks.styles.map(String).filter(Boolean) : [];
  const anims = Array.isArray(picks.anims) ? picks.anims.map(String).filter(Boolean) : [];
  if (!Object.keys(ask).length && !styles.length && !anims.length && !music.length && !Object.keys(kindStyle).length) return out;
  for (const k of Object.keys(STANDARD)) {
    const r = {};
    const len = k === 'fragmentation' ? ask.flength : ask.length;
    if (len) r.length = String(len);
    if (+ask.count) r.count = +ask.count;
    if (styles.length) r.styles = styles.includes(BY_VIDEO) && k !== 'auto' ? [kindStyle[k] || FIRST_STYLE[k]] : styles.slice();
    else if (kindStyle[k]) r.styles = [String(kindStyle[k])];
    if (anims.length) r.anims = anims.slice();
    out.kinds[k] = r;
  }
  if (music.length) out.oldMusic = music;
  return out;
}

let _mem = null;
/** The memory - read once a page, carried over from the old keys when it is not there yet. */
export function memory() {
  if (_mem) return _mem;
  const m = _obj(_read(LS));
  if (m && m.v === 1 && _obj(m.kinds)) _mem = m;
  else { _mem = _migrate(); _write(); }
  return _mem;
}
function _write() { try { localStorage.setItem(LS, JSON.stringify(_mem)); } catch (e) { /* a private window */ } }

/**
 * What kind `kind` remembers, over its standards: { length, count, moods, styles, anims, fonts, title }. A length the kind no longer
 * offers (fragmentation's 2-4 min, V69 P12) or a count it has not takes its standard. (V69 P12) A kind of before kept no title: its
 * standard; and its moods "by the video" only for auto.
 */
export function settingsOf(kind, lengths, counts) {
  const std = standardOf(kind, lengths);
  const r = _obj(memory().kinds[kind]) || {};
  const okTitle = (t) => t === true || t === false || (kind === 'auto' && t === BY_VIDEO);
  return {
    length: lengths && lengths[r.length] ? String(r.length) : std.length,
    count: (counts || []).includes(+r.count) ? +r.count : std.count,
    moods: Array.isArray(r.moods) ? r.moods.map(String).filter((m) => m !== BY_VIDEO || kind === 'auto') : std.moods,
    styles: Array.isArray(r.styles) ? r.styles.map(String) : std.styles,
    anims: Array.isArray(r.anims) ? r.anims.map(String) : std.anims,
    fonts: Array.isArray(r.fonts) ? r.fonts.map(String) : std.fonts,
    title: okTitle(r.title) ? r.title : std.title,
    fx: okFx(r.fx) ? r.fx : std.fx,
  };
}
/** Keep `kind` as the one chosen last, with its settings `s`. */
export function keep(kind, s) {
  const m = memory();
  m.kind = String(kind || '');
  if (kind && s) m.kinds[kind] = { length: s.length, count: s.count, moods: (s.moods || []).slice(), styles: (s.styles || []).slice(), anims: (s.anims || []).slice(),
    fonts: (s.fonts || []).slice(), title: s.title, fx: okFx(s.fx) ? s.fx : FX_STD };
  _write();
}
/** The kind chosen last ('' - none yet: the very first opening, (хп35), (хп49)). */
export const lastKind = () => String(memory().kind || '');

/**
 * The old ticked tracks as moods, once Music -> highlights is read: `moodOf(id)` -> a mood id, YOURS, or '' (gone). Every kind
 * that has no moods of its own yet takes them. Returns true when the memory changed.
 */
export function settleOldMusic(moodOf) {
  const m = memory();
  if (!Array.isArray(m.oldMusic)) return false;
  const moods = [...new Set(m.oldMusic.map(moodOf).filter(Boolean))];
  for (const k of Object.keys(m.kinds)) {
    const r = _obj(m.kinds[k]);
    if (r && !Array.isArray(r.moods)) r.moods = moods.slice();
  }
  delete m.oldMusic;
  _write();
  return true;
}

/**
 * (phase V33.8, (в1)) The first style a kind remembers, else the one kept before V68 (mv3_hl_kind_style_v1), else its standard's
 * first. `known(id)` - is it a preset.
 */
export function styleFor(kind, known) {
  const r = _obj(memory().kinds[kind]);
  const mine = r && Array.isArray(r.styles) ? r.styles.find((id) => id !== BY_VIDEO && known(id)) : '';
  if (mine) return mine;
  const old = _obj(_read(OLD.kindStyle)) || {};
  return old[kind] && known(old[kind]) ? String(old[kind]) : (FIRST_STYLE[kind] || FIRST_STYLE.podcast);
}

/** (phase V69 P12) The kinds auto may find, as their sets "by the video" go: a kind in development (stream) cuts as other. */
export const BY_VIDEO_KINDS = FOUND.filter((k) => acting(k) === k);

/**
 * (phase V69 P12, (хп93)) What auto's "by the video" sends for each kind it may find - as each remembers it in this popup (other: its
 * standard - not a button): { byKind: { <kind>: { preset, name, mix, anims, fonts } }, moodsByKind, titleByKind }. `name(id)` - a
 * preset's name, `known(id)` - is it a preset.
 */
export function byVideoSets(name, known, lengths, counts) {
  const byKind = {}, moodsByKind = {}, titleByKind = {};
  for (const k of BY_VIDEO_KINDS) {
    const s = k === 'other' ? standardOf('other', lengths) : settingsOf(k, lengths, counts);
    const ids = (s.styles || []).filter((id) => id !== BY_VIDEO && known(id));
    if (ids.length) {
      byKind[k] = { preset: ids[0], name: name(ids[0]), ...(ids.length > 1 ? { mix: ids.map((id) => ({ preset: id, name: name(id) })) } : {}),
        anims: (s.anims || []).slice(), fonts: (s.fonts || []).slice() };
    }
    moodsByKind[k] = (s.moods || []).filter((m) => m !== BY_VIDEO);
    titleByKind[k] = s.title === true;
  }
  return { byKind, moodsByKind, titleByKind };
}
