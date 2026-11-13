/* ═══════════════════════════════════════════════════════════════════════════
   CAPTIONS — the `.srt` beside a render.

   A render with captions can leave `<name>.en_US.srt` beside its video (a box in Export, on by default): the
   subtitle lane as CLASSIC subtitles, whatever its pages look like on screen - the heard words (with every
   correction a person made) cut again by the `sentences` rule (pages.js SENT: a sentence or a part of one, two
   lines of at most 42 characters, 1-7 s), measured in characters only, since a player draws a .srt in its own
   font; a line typed on the lane is a cue of its own, as typed (its lines broken at 42 characters, never cut
   into two cues). A talking head's lines of the script never share a cue. Text lanes are titles and stay out.
   The text is as written - the lane's casing is a look. Times are the finished file's: divided by the
   export's playback speed, nothing after the film's end. `<name>.en_US` because Meta reads the language from a
   subtitle file's name.

   PURE: the server require()s it (lib/mv3b-job.js, through lib/mv3b-subs.js).
   ═══════════════════════════════════════════════════════════════════════════ */

import { wordsOf, paginate, breakLines, typedOf, joinsOf, tokensOf } from './pages.js';
import { isHeard, soundPieces } from './heard.js';

/** What follows a video's name in its subtitle file's: the language and the country Meta reads off it. */
export const SRT_TAIL = '.en_US.srt';

const two = (n) => String(n).padStart(2, '0');

/** A moment as a .srt says it: 00:01:02,345. */
export function srtTime(t) {
  const ms = Math.max(0, Math.round((+t || 0) * 1000));
  const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
  return two(h) + ':' + two(m) + ':' + two(s) + ',' + String(ms % 1000).padStart(3, '0');
}

// Words into lines of at most 42 characters, by the rule a page breaks by (pages.js breakLines with no style).
function _lines(tokens) {
  const out = [];
  let i = 0;
  for (const k of breakLines(tokens, null, 0)) { out.push(tokens.slice(i, i + k).join(' ')); i += k; }
  return out;
}

/**
 * The cues of a timeline's subtitle lane: [{ start, end, lines: [text] }] in the finished file's seconds.
 * @param o.speed  the export's playback speed (lib/render-finish.js) - 1 when none
 * @param o.end    the film's length on the timeline, in seconds - nothing is said after it
 */
export function srtCues(tl, o) {
  const opt = o || {};
  const lane = ((tl && tl.tracks) || []).find((t) => t && t.kind === 'subs');
  if (!lane) return [];
  const speed = +opt.speed > 0 ? +opt.speed : 1;
  const end = +opt.end > 0 ? +opt.end : Infinity;
  // The heard words, without the looks of their lines: a .srt has no look, so a change of one is no boundary.
  const words = wordsOf(lane).map((w) => { const x = { ...w }; delete x.look; return x; });
  const cues = [];
  for (const p of paginate(words, { srt: true, format: tl.format, typed: typedOf(lane), joins: joinsOf(soundPieces(tl)) })) {
    const lines = _lines(p.words.map((w) => String(w.w)));
    if (lines.length) cues.push({ start: p.start, end: p.start + p.dur, lines });
  }
  // A typed line, as typed: each paragraph broken at 42 characters, all of it one cue.
  for (const c of (lane.clips || [])) {
    if (!c || !c.name || isHeard(c)) continue;
    const lines = [];
    for (const para of String(c.name).split('\n')) { const t = tokensOf(para); if (t.length) lines.push(..._lines(t)); }
    if (lines.length) cues.push({ start: +c.start || 0, end: (+c.start || 0) + (+c.dur || 0), lines });
  }
  cues.sort((a, b) => a.start - b.start || a.end - b.end);
  const out = [];
  cues.forEach((c, i) => {
    const next = cues[i + 1];
    let b = Math.min(c.end, end, next ? next.start : Infinity);
    if (c.start >= end || b <= c.start) return;
    out.push({ start: c.start / speed, end: b / speed, lines: c.lines });
  });
  return out;
}

/** The `.srt` file's text ('' when the lane has nothing to say): numbered cues, CRLF, UTF-8 by whoever writes it. */
export function buildSrt(tl, o) {
  const cues = srtCues(tl, o);
  if (!cues.length) return '';
  return cues.map((c, i) => (i + 1) + '\r\n' + srtTime(c.start) + ' --> ' + srtTime(c.end) + '\r\n' + c.lines.join('\r\n') + '\r\n').join('\r\n');
}
