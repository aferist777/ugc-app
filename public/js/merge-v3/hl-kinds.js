/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — the KINDS OF VIDEO in the highlights popup: their icons, their words, their standards, and what each one
   remembers (phase V68 P3, the owner 2026-11-01, (хп19), (хп35), (хп46), (хп48)-(хп50)).

   ICONS - the owner's choice in P1 (docs/local-app/mockups/v68-icons/video-<kind>.svg): pixels on a 16×16 grid, drawn as SVG
   in the page (not <img>) so `currentColor` takes the button's gold.
   ABOUT - a short line for each (all four shown while no kind is chosen, only at the very first opening - (хп35)) and the
   chosen one's longer words, written from what each kind does today (lib/highlights-agent.js GUIDES, lib/highlights-store.js
   KINDS); the talks about the kinds (phase V69, P5-P11) will refine them.
   STANDARD - what a kind starts with the first time and after "reset to standard" ((хп50); phase V69 P12 makes the table of
   every kind's own standards).
   MEMORY - ONE key, `mv3_hl_kinds_v1` (localStorage, mirrored to the library by storage-sync.js - Merge and Home alike):
   { v: 1, kind, kinds: { <kind>: { length, count, moods, styles, anims } } } - the kind chosen last and each kind's last
   settings ((хп19), (хп46)). The popup's memory of before (mv3_hl_ask_v1, mv3_hl_caption_picks_v1, mv3_hl_kind_style_v1,
   mv3_hl_music_v1) is carried over once into every kind - but not the kind itself, so the first opening of this popup shows
   every kind's words ((хп49)); the old keys are left as they are.
   ═══════════════════════════════════════════════════════════════════════════ */

export const BY_VIDEO = '@by-video';     // the caption style "by the video" - auto's (phase V33.8, (в1))
export const YOURS = 'yours';            // the root of Music -> highlights as a "mood" (lib/highlights-music.js YOURS)

export const ICONS = {
  auto: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="M12 1h1v1h-1zM12 2h1v1h-1zM10 3h1v1h-1zM11 3h1v1h-1zM12 3h1v1h-1zM13 3h1v1h-1zM14 3h1v1h-1zM12 4h1v1h-1zM12 5h1v1h-1zM7 8h1v1h-1zM8 8h1v1h-1zM6 9h1v1h-1zM7 9h1v1h-1zM5 10h1v1h-1zM6 10h1v1h-1zM4 11h1v1h-1zM5 11h1v1h-1zM3 12h1v1h-1zM4 12h1v1h-1zM2 13h1v1h-1zM3 13h1v1h-1zM1 14h1v1h-1zM2 14h1v1h-1z"/><path fill="currentColor" fill-opacity=".45" d="M4 3h1v1h-1zM3 4h1v1h-1zM4 4h1v1h-1zM5 4h1v1h-1zM4 5h1v1h-1zM13 8h1v1h-1zM12 9h1v1h-1zM13 9h1v1h-1zM14 9h1v1h-1zM13 10h1v1h-1z"/><path fill="#f4f1e8" d="M9 6h1v1h-1zM10 6h1v1h-1zM8 7h1v1h-1zM9 7h1v1h-1z"/></svg>',
  podcast: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true"><path fill="#f4f1e8" d="M5 1h1v1h-1zM6 1h1v1h-1zM7 1h1v1h-1zM8 1h1v1h-1zM9 1h1v1h-1zM10 1h1v1h-1zM11 1h1v1h-1zM5 2h1v1h-1zM7 2h1v1h-1zM9 2h1v1h-1zM11 2h1v1h-1zM5 3h1v1h-1zM6 3h1v1h-1zM7 3h1v1h-1zM8 3h1v1h-1zM9 3h1v1h-1zM10 3h1v1h-1zM11 3h1v1h-1zM6 4h1v1h-1zM7 4h1v1h-1z"/><path fill="currentColor" d="M2 5h1v1h-1zM3 5h1v1h-1zM1 6h1v1h-1zM2 6h1v1h-1zM3 6h1v1h-1zM4 6h1v1h-1zM1 7h1v1h-1zM2 7h1v1h-1zM3 7h1v1h-1zM4 7h1v1h-1zM2 8h1v1h-1zM3 8h1v1h-1zM1 10h1v1h-1zM2 10h1v1h-1zM3 10h1v1h-1zM4 10h1v1h-1zM0 11h1v1h-1zM1 11h1v1h-1zM2 11h1v1h-1zM3 11h1v1h-1zM4 11h1v1h-1zM5 11h1v1h-1zM0 12h1v1h-1zM1 12h1v1h-1zM2 12h1v1h-1zM3 12h1v1h-1zM4 12h1v1h-1zM5 12h1v1h-1zM0 13h1v1h-1zM1 13h1v1h-1zM2 13h1v1h-1zM3 13h1v1h-1zM4 13h1v1h-1zM5 13h1v1h-1z"/><path fill="currentColor" fill-opacity=".45" d="M12 5h1v1h-1zM13 5h1v1h-1zM11 6h1v1h-1zM12 6h1v1h-1zM13 6h1v1h-1zM14 6h1v1h-1zM11 7h1v1h-1zM12 7h1v1h-1zM13 7h1v1h-1zM14 7h1v1h-1zM12 8h1v1h-1zM13 8h1v1h-1zM11 10h1v1h-1zM12 10h1v1h-1zM13 10h1v1h-1zM14 10h1v1h-1zM10 11h1v1h-1zM11 11h1v1h-1zM12 11h1v1h-1zM13 11h1v1h-1zM14 11h1v1h-1zM15 11h1v1h-1zM10 12h1v1h-1zM11 12h1v1h-1zM12 12h1v1h-1zM13 12h1v1h-1zM14 12h1v1h-1zM15 12h1v1h-1zM10 13h1v1h-1zM11 13h1v1h-1zM12 13h1v1h-1zM13 13h1v1h-1zM14 13h1v1h-1zM15 13h1v1h-1z"/></svg>',
  documentary: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="M5 1h1v1h-1zM6 1h1v1h-1zM7 1h1v1h-1zM8 1h1v1h-1zM9 1h1v1h-1zM10 1h1v1h-1zM4 2h1v1h-1zM5 2h1v1h-1zM6 2h1v1h-1zM7 2h1v1h-1zM8 2h1v1h-1zM9 2h1v1h-1zM10 2h1v1h-1zM11 2h1v1h-1zM3 3h1v1h-1zM4 3h1v1h-1zM5 3h1v1h-1zM6 3h1v1h-1zM9 3h1v1h-1zM10 3h1v1h-1zM11 3h1v1h-1zM12 3h1v1h-1zM2 4h1v1h-1zM3 4h1v1h-1zM4 4h1v1h-1zM5 4h1v1h-1zM10 4h1v1h-1zM11 4h1v1h-1zM12 4h1v1h-1zM13 4h1v1h-1zM1 5h1v1h-1zM2 5h1v1h-1zM3 5h1v1h-1zM4 5h1v1h-1zM5 5h1v1h-1zM6 5h1v1h-1zM9 5h1v1h-1zM10 5h1v1h-1zM11 5h1v1h-1zM12 5h1v1h-1zM13 5h1v1h-1zM14 5h1v1h-1zM1 6h1v1h-1zM2 6h1v1h-1zM3 6h1v1h-1zM5 6h1v1h-1zM6 6h1v1h-1zM7 6h1v1h-1zM8 6h1v1h-1zM9 6h1v1h-1zM10 6h1v1h-1zM12 6h1v1h-1zM13 6h1v1h-1zM14 6h1v1h-1zM1 7h1v1h-1zM2 7h1v1h-1zM6 7h1v1h-1zM9 7h1v1h-1zM13 7h1v1h-1zM14 7h1v1h-1zM1 8h1v1h-1zM2 8h1v1h-1zM6 8h1v1h-1zM9 8h1v1h-1zM13 8h1v1h-1zM14 8h1v1h-1zM1 9h1v1h-1zM2 9h1v1h-1zM3 9h1v1h-1zM5 9h1v1h-1zM6 9h1v1h-1zM7 9h1v1h-1zM8 9h1v1h-1zM9 9h1v1h-1zM10 9h1v1h-1zM12 9h1v1h-1zM13 9h1v1h-1zM14 9h1v1h-1zM1 10h1v1h-1zM2 10h1v1h-1zM3 10h1v1h-1zM4 10h1v1h-1zM5 10h1v1h-1zM6 10h1v1h-1zM9 10h1v1h-1zM10 10h1v1h-1zM11 10h1v1h-1zM12 10h1v1h-1zM13 10h1v1h-1zM14 10h1v1h-1zM2 11h1v1h-1zM3 11h1v1h-1zM4 11h1v1h-1zM5 11h1v1h-1zM10 11h1v1h-1zM11 11h1v1h-1zM12 11h1v1h-1zM13 11h1v1h-1zM3 12h1v1h-1zM4 12h1v1h-1zM5 12h1v1h-1zM6 12h1v1h-1zM9 12h1v1h-1zM10 12h1v1h-1zM11 12h1v1h-1zM12 12h1v1h-1zM4 13h1v1h-1zM5 13h1v1h-1zM6 13h1v1h-1zM7 13h1v1h-1zM8 13h1v1h-1zM9 13h1v1h-1zM10 13h1v1h-1zM11 13h1v1h-1zM5 14h1v1h-1zM6 14h1v1h-1zM7 14h1v1h-1zM8 14h1v1h-1zM9 14h1v1h-1zM10 14h1v1h-1z"/><path fill="#f4f1e8" d="M7 7h1v1h-1zM8 7h1v1h-1zM7 8h1v1h-1zM8 8h1v1h-1z"/><path fill="currentColor" fill-opacity=".45" d="M12 14h1v1h-1zM13 14h1v1h-1zM14 14h1v1h-1zM15 14h1v1h-1zM12 15h1v1h-1zM13 15h1v1h-1zM14 15h1v1h-1zM15 15h1v1h-1z"/></svg>',
  fragmentation: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="M2 2h1v1h-1zM13 2h1v1h-1zM2 3h1v1h-1zM3 3h1v1h-1zM12 3h1v1h-1zM13 3h1v1h-1zM3 4h1v1h-1zM4 4h1v1h-1zM11 4h1v1h-1zM12 4h1v1h-1zM4 5h1v1h-1zM5 5h1v1h-1zM10 5h1v1h-1zM11 5h1v1h-1zM5 6h1v1h-1zM6 6h1v1h-1zM9 6h1v1h-1zM10 6h1v1h-1zM6 7h1v1h-1zM9 7h1v1h-1zM6 8h1v1h-1zM7 8h1v1h-1zM8 8h1v1h-1zM9 8h1v1h-1zM5 9h1v1h-1zM6 9h1v1h-1zM9 9h1v1h-1zM10 9h1v1h-1zM3 10h1v1h-1zM4 10h1v1h-1zM5 10h1v1h-1zM10 10h1v1h-1zM11 10h1v1h-1zM12 10h1v1h-1zM2 11h1v1h-1zM3 11h1v1h-1zM5 11h1v1h-1zM6 11h1v1h-1zM9 11h1v1h-1zM10 11h1v1h-1zM12 11h1v1h-1zM13 11h1v1h-1zM2 12h1v1h-1zM6 12h1v1h-1zM9 12h1v1h-1zM13 12h1v1h-1zM2 13h1v1h-1zM3 13h1v1h-1zM5 13h1v1h-1zM6 13h1v1h-1zM9 13h1v1h-1zM10 13h1v1h-1zM12 13h1v1h-1zM13 13h1v1h-1zM3 14h1v1h-1zM4 14h1v1h-1zM5 14h1v1h-1zM10 14h1v1h-1zM11 14h1v1h-1zM12 14h1v1h-1z"/><path fill="#f4f1e8" d="M7 7h1v1h-1zM8 7h1v1h-1z"/></svg>',
};

export const ABOUT = {
  auto: {
    short: 'finds out what the video is, then cuts it by that kind\'s rules',
    long: 'Reads the words first and decides what the video is - a podcast, a documentary, a vlog, a lecture, a tutorial, a reaction, '
      + 'a monologue, a stream - then finds the moments by that kind\'s rules: it starts on the line that carries the meaning and ends '
      + 'on the payoff; intros, ads and the outro are skipped. The frame follows the faces; a shot with no face follows a whole person '
      + 'when there is one, else shows the whole frame over its blur. Captions "by the video": a talk wears your podcast style, a story '
      + 'told your documentary style. Moments up to 30 s, 30-60 s or 60-90 s; 3 to 20 of them.',
  },
  podcast: {
    short: 'people talking: opinions, stories, answers, exchanges',
    long: 'Two or more people talking. The agent looks for moments where something happens: a strong opinion with its reason, a story '
      + 'that reaches its point, a confession, a disagreement, a direct answer, a funny exchange. It starts on the strongest line - the '
      + 'host\'s question only when the answer needs it - and ends right after the punchline or the verdict; greetings, ads, plugs and '
      + 'the outro are skipped. The frame follows the faces; a shot with no face shows the whole frame. Moments up to 30 s, 30-60 s or '
      + '60-90 s; 3 to 20 of them.',
  },
  documentary: {
    short: 'a narrator over footage: facts, mysteries, reveals',
    long: 'One narrator over footage, graphics or archive, with short interview bites. The agent looks for a striking fact with its '
      + 'why, a mystery and its answer, a belief and its correction, a turn, a reveal - a chain with stakes, never a list of facts. It '
      + 'may open on a later line when that is the question, never on the answer; lines that need the picture ("as you can see") are '
      + 'skipped. The frame follows the faces; a shot with no face shows a 3:2 window from the middle over its blur, so text and charts '
      + 'stay nearly whole. Moments up to 30 s, 30-60 s or 60-90 s; 3 to 20 of them.',
  },
  fragmentation: {
    short: 'the whole video, start to end, in parts by meaning',
    long: 'Not the best moments but the WHOLE video, start to end, cut into parts by meaning - a scene or a topic each; the intro, '
      + 'ads, the outro and recaps are cut out. As many parts as the video comes to, in its order. The frame follows the most active '
      + 'one - who acts, who speaks, who reacts - with no blur, and punches in ×1.2 on the key phrases. Parts of 30-60 s, 1-2 min or '
      + '2-4 min.',
  },
};

// (хп50) Until phase V69 P12: every kind 30-60 s (fragmentation 1-2 min), 5 fragments, no music, no animations; the style the
// app gives the kind today (hl-style.js FIRST) - podcast and fragmentation Podcast Viral, documentary Classic White, auto
// "by the video".
export const STANDARD = {
  auto: { length: '30-60', count: 5, moods: [], styles: [BY_VIDEO], anims: [] },
  podcast: { length: '30-60', count: 5, moods: [], styles: ['cp-podcast-viral'], anims: [] },
  documentary: { length: '30-60', count: 5, moods: [], styles: ['cl-white'], anims: [] },
  fragmentation: { length: 'p1-2', count: 5, moods: [], styles: ['cp-podcast-viral'], anims: [] },
};
const FIRST_STYLE = { podcast: 'cp-podcast-viral', documentary: 'cl-white', fragmentation: 'cp-podcast-viral' };
/** A kind's standard settings - a kind with none here (a new one before P12) the first length, 5, nothing else. */
export function standardOf(kind, lengths) {
  const s = STANDARD[kind];
  if (s) return { ...s, moods: s.moods.slice(), styles: s.styles.slice(), anims: s.anims.slice() };
  return { length: Object.keys(lengths || {})[0] || '', count: 5, moods: [], styles: [], anims: [] };
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

/** What kind `kind` remembers, over its standards: { length, count, moods, styles, anims }. */
export function settingsOf(kind, lengths, counts) {
  const std = standardOf(kind, lengths);
  const r = _obj(memory().kinds[kind]) || {};
  return {
    length: lengths && lengths[r.length] ? String(r.length) : std.length,
    count: (counts || []).includes(+r.count) ? +r.count : std.count,
    moods: Array.isArray(r.moods) ? r.moods.map(String) : std.moods,
    styles: Array.isArray(r.styles) ? r.styles.map(String) : std.styles,
    anims: Array.isArray(r.anims) ? r.anims.map(String) : std.anims,
  };
}
/** Keep `kind` as the one chosen last, with its settings `s`. */
export function keep(kind, s) {
  const m = memory();
  m.kind = String(kind || '');
  if (kind && s) m.kinds[kind] = { length: s.length, count: s.count, moods: (s.moods || []).slice(), styles: (s.styles || []).slice(), anims: (s.anims || []).slice() };
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
 * (phase V33.8, (в1)) The style "by the video" gives a talk (`podcast`) or a story told (`documentary`): the first style that kind
 * remembers, else the one kept before V68 (mv3_hl_kind_style_v1), else the app's first answer. `known(id)` - is it a preset.
 */
export function styleFor(kind, known) {
  const r = _obj(memory().kinds[kind]);
  const mine = r && Array.isArray(r.styles) ? r.styles.find((id) => id !== BY_VIDEO && known(id)) : '';
  if (mine) return mine;
  const old = _obj(_read(OLD.kindStyle)) || {};
  return old[kind] && known(old[kind]) ? String(old[kind]) : (FIRST_STYLE[kind] || FIRST_STYLE.podcast);
}
