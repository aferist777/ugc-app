/* ═══════════════════════════════════════════════════════════════════════════
   CAPTIONS — heard words cut into PAGES, and a page broken into LINES (phase K2, 2026-10-03).

   A page is what is on screen at once. It ENDS where a thought ends - a full stop, a question, a pause
   of 0.4 s, a comma once the phrase has two words - and never runs across a line somebody typed, the
   seam between two reads, or a change of a caption's own look. Inside those, a phrase is cut into the
   FEWEST pages that each hold at most N words (the style's `wordsPerLine`, or the format's), fit in the
   style's `lines` lines of at most 0.78 of the frame (measure.js), last no more than 3.2 s and - two
   words or more - no less than 0.3 s; among the cuts into that many pages (or one more, when that is
   what it takes), the most even one that does not leave a preposition or a conjunction at a page's end
   ("что если на | тебя"), start a page on an enclitic ("| же"), or tear a pair apart ("5000 | лайков",
   "потому | что"). That is how Subtitle Edit
   and stable-ts cut; a greedy cut, even with the rules, left 7-15% of pages on a weak word.

   A word alone on a page shorter than 0.3 s joins its neighbour when nothing hard lies between. A page
   stays on screen across a short gap to the next one (no blank flashes), and a little longer before a
   long one; it never runs onto a typed line.

   The SAME words always give the same pages: times are rounded to 0.01 s first, so cutting what was cut
   gives it back byte for byte - a slider moved there and back changes nothing.

   breakLines() is the one rule for where a page breaks into lines - the cut asks it whether a page fits,
   the .ass builder asks it where to put the breaks.

   A LANE WITH SEVERAL PRESETS (phase V49, mix.js): what a deal put on a page (its references) is no look of its own - it is no
   boundary, a page cut from words of two pages takes its first word's; a page must fit in EVERY look it may be dealt; and the
   pages cut again are dealt again (mix.js deal) - the lines typed by hand too.

   PURE, and shared: the page imports it, the server require()s it (lib/mv3b-subs.js).
   ═══════════════════════════════════════════════════════════════════════════ */

import { resolveStyle, withAuto, renderFrame, autoWordsPerLine } from './style.js';
import { meter, LINE_MAX } from './measure.js';
import { isHeard, soundPieces } from './heard.js';
import { tokensOf, spells, retext } from './words.js';
import { mixOf } from './style.js';
import { withoutRefs, deal, needsDeal } from './mix.js';

export { tokensOf };

/** The cut's constants - not settings: the strip offers Words and Lines, nothing else. */
export const PAGE = {
  pause: 0.4,        // a pause this long always ends a page
  maxDur: 3.2,       // a page of two words or more is on screen no longer than this...
  minDur: 0.3,       // ...and no shorter
  short: 0.5,        // a page shorter than this costs a little
  closeGap: 0.7,     // a gap shorter than this to the next page is not shown: the page stays up
  hold: 0.3,         // before a longer one the page stays this much longer
  joinReach: 0.6,    // how far past the seam of two reads a stretched word can push the next one
  minClip: 0.1,      // the shortest a page is on screen: the shortest clip a lane keeps
};

// What a cut of a phrase costs, besides being uneven ((words - n/k)^2 a page). The research's simulator
// settled on 4 / 6 / 1 for the fewest pages alone; with one more page allowed (at `page`), 5 and 8 keep
// the weak ends at 0-1% of pages on the recorded words, against 7-15% cut greedily (K2 stand).
const COST = { weak: 5, enclitic: 8, pair: 10, short: 1, page: 3, flash: 4, clause: 4 };

// ── The words ───────────────────────────────────────────────────────────────
const r2 = (t) => Math.round((+t || 0) * 100) / 100;
const up2 = (t) => Math.ceil((+t || 0) * 100 - 1e-6) / 100;
const down2 = (t) => Math.floor((+t || 0) * 100 + 1e-6) / 100;

// What a word says without its quotes and brackets; lower case.
const CLOSERS = /[»"'”’)\]]+$/u;
const OPENERS = /^[«"'“„‘([]+/u;
const bare = (t) => String(t || '').toLowerCase().replace(OPENERS, '').replace(CLOSERS, '');
const hasMark = (t) => /[.,!?;:…—–-]$/u.test(bare(t));
const capital = (t) => /^\p{Lu}/u.test(String(t || '').replace(OPENERS, ''));

// Prepositions, conjunctions, particles and determiners that belong to the NEXT word: a page or a line
// does not end on them (unless they carry a mark - "Что?" may).
const WEAK = new Set((
  'в во на с со к ко у о об обо от ото до из изо за по под подо над при про для без безо через перед передо '
  + 'между около после кроме ради среди сквозь вместо мимо против вокруг из-за из-под '
  + 'и а но да или либо ни что чтобы чтоб как если то когда пока хотя будто словно чем ибо зато не где куда '
  + 'который которая которое которые которого которой которому которым которых которую '
  + 'мой моя моё мое мои твой твоя твоё твое твои наш наша наше наши ваш ваша ваше ваши свой своя своё свое свои '
  + 'этот эта эти этого этой этих эту тот того той тех '
  + 'a an the to of in on at for with from by into about and or but if that so as '
  + 'my your his her our their its this these those'
).split(' '));
// Particles that belong to the word BEFORE: a page does not start with them.
const ENCLITIC = new Set(['же', 'ж', 'ли', 'ль', 'бы', 'б']);
// Two words read as one.
const PAIRS = new Set(['потому|что', 'так|как', 'так|что', 'несмотря|на', 'в|течение', 'по|крайней', 'крайней|мере',
  'как|будто']);
// A full stop that never ends a sentence...
const ABBR = new Set(['т.', 'т.е.', 'т.к.', 'е.', 'к.', 'ул.', 'стр.', 'проф.', 'акад.', 'гл.', 'табл.',
  'г-н.', 'г-жа.', 'д-р.', 'mr.', 'mrs.', 'ms.', 'dr.', 'vs.', 'e.g.', 'i.e.', 'st.']);
// ...and one that ends it only when the next word starts with a capital ("и др. Потом", "100 руб. за штуку").
// "им.", "рис.", "см." are words as often as abbreviations - "Я верю им. Они..." ends a sentence (review K2).
const MAYBE = new Set(['т.д.', 'т.п.', 'д.', 'п.', 'г.', 'гг.', 'в.', 'вв.', 'руб.', 'коп.', 'тыс.', 'млн.', 'млрд.', 'др.', 'etc.',
  'им.', 'рис.', 'см.']);

/** A word a page (or a line) should not end on. */
export const weakEnd = (t) => !hasMark(t) && WEAK.has(bare(t));
/** A word a page should not start with. */
export const enclitic = (t) => ENCLITIC.has(bare(t));

/** Do the two words belong together ("5000 лайков", "50 000", "т. е.", "потому что", "А. Пушкин")? */
export function pair(a, b) {
  const A = String(a || ''), B = String(b || '');
  if (/^[№$€£]?\d+([.,]\d+)*%?$/u.test(A) && /^[«"(]*\p{L}/u.test(B)) return true;     // 5000 лайков, 99% людей
  if (/^\d{1,3}$/.test(A) && /^\d{3}(?!\d)/.test(B)) return true;                        // 50 000
  if (/^\p{Lu}\.$/u.test(A) && capital(B)) return true;                                  // А. Пушкин
  const x = bare(A), y = bare(B);
  if (x === 'т.') return /^[едпк]\./u.test(y);                                           // т. е., и т. д.
  if (hasMark(A)) return false;
  return PAIRS.has(x + '|' + y.replace(/[,.!?;:…]+$/u, ''));
}

/** Does the word end a sentence? `next` is the word after it (or null), `gap` the pause before it. */
export function endsSentence(t, next, gap) {
  const s = bare(t);
  if (/[!?]+[.…]*$/u.test(s)) return true;
  if (/(…|\.\.\.)$/u.test(s)) return !next || capital(next) || gap >= 0.2;
  if (!/\.$/u.test(s)) return false;
  if (ABBR.has(s)) return false;
  if (MAYBE.has(s)) return !next || capital(next);
  if (/^\p{Lu}\.$/u.test(String(t).replace(OPENERS, ''))) return false;      // an initial
  if (/^\d+\.$/u.test(s)) return !next || capital(next);                     // "3. в" is not an end
  if (/^(\p{L}\.){2,}$/u.test(s)) return !next || capital(next);              // U.S., p.m.
  return true;
}
// A comma, a semicolon, a colon, a dash - or an ellipsis that did not end the sentence.
const endsClause = (t) => /[,;:—–…-]$|\.\.\.$/u.test(bare(t));

// ── Lines ───────────────────────────────────────────────────────────────────
/** Classic subtitles (phase V30, block 4, (с12), (с42)): the `sentences` cut of a lane, and the `.srt` beside a render. */
export const SENT = {
  chars: 42,         // a line holds at most this many characters...
  lines: 2,          // ...and a page at most this many lines
  pause: 1.0,        // a pause this long ends a page (a shorter one inside a sentence does not)
  maxDur: 7,         // a page is on screen no longer than this...
  minDur: 1,         // ...and at least this long when the next one leaves room
};

/**
 * Where a page of `tokens` (its words as stored - casing is the style's) breaks into lines in style
 * `st` (resolved, size filled in) on a frame `W` wide: the line counts, top first ([2, 3] = two words,
 * then three). The fewest lines no wider than 0.78 of the frame each; among those, the most even, with
 * no weak word at a line's end and no short word alone on a line of a page of three or more; when it is
 * a tie, the lower line the wider. A word wider than the limit alone is a line of its own.
 * A lane cut in `sentences` (phase V30, block 4) also holds a line to 42 characters; with no style at all
 * (`st` null - the `.srt`, which a player draws in its own font) the characters are the only measure.
 */
export function breakLines(tokens, st, W) {
  const n = tokens.length;
  if (n < 2) return n ? [n] : [];
  const m = st ? meter(st) : null;
  const lim = LINE_MAX * W;
  const maxC = !st || st.cut === 'sentences' ? SENT.chars : Infinity;
  const runs = m ? tokens.map((t) => m.run(t)) : null;
  const lens = tokens.map((t) => [...String(t)].length);
  const widthOf = (a, b) => {
    if (!m) return 0;
    let adv = 0, chars = 0;
    for (let i = a; i < b; i++) { adv += runs[i].a; chars += runs[i].n; }
    adv += (b - a - 1) * m.space;
    chars += b - a - 1;
    return m.width(adv, chars);
  };
  const charsOf = (a, b) => { let c = b - a - 1; for (let i = a; i < b; i++) c += lens[i]; return c; };
  const fits = (a, b) => (!m || widthOf(a, b) <= lim) && charsOf(a, b) <= maxC;
  // How full a line is (1 = full): its width against the limit - or its characters, where they are what is measured.
  const full = (w, c) => Math.max(m ? w / lim : 0, maxC < Infinity ? c / maxC : 0);
  // The fewest lines: fill each as far as it goes.
  let k = 0;
  for (let a = 0; a < n;) {
    let b = a + 1;
    while (b < n && fits(a, b + 1)) b++;
    a = b;
    k++;
  }
  if (k === 1) return [n];
  // Exactly k lines, the least cost.
  const INF = Infinity;
  const cost = Array.from({ length: k + 1 }, () => new Array(n + 1).fill(INF));
  const from = Array.from({ length: k + 1 }, () => new Array(n + 1).fill(-1));
  cost[0][0] = 0;
  for (let p = 1; p <= k; p++) {
    for (let b = p; b <= n; b++) {
      for (let a = p - 1; a < b; a++) {
        if (cost[p - 1][a] === INF) continue;
        const w = widthOf(a, b), ch = charsOf(a, b);
        if (b - a > 1 && !fits(a, b)) continue;
        const f = full(w, ch);
        let c = 10 * f * f;
        if (b < n && weakEnd(tokens[b - 1])) c += 3;
        if (b - a === 1 && n >= 3 && f < 0.5) c += 4;    // a short word alone on a line
        c += 0.02 * f * (k - p);         // a tie goes to the wider lower line
        if (cost[p - 1][a] + c < cost[p][b]) { cost[p][b] = cost[p - 1][a] + c; from[p][b] = a; }
      }
    }
  }
  if (cost[k][n] === INF) return [n];
  const out = [];
  for (let p = k, b = n; p > 0; p--) { const a = from[p][b]; out.unshift(b - a); b = a; }
  return out;
}

/**
 * How a page is DRAWN: its lines (breakLines) and the size it is drawn at. A word wider than a line
 * cannot be broken, so a page holding one is drawn smaller - just enough for it to fit 0.78 of the
 * frame ("сельскохозяйственные" in Rubik Mono One is 1.24 of it) - rather than run off the edges.
 * @returns { lines: [counts], size } - `size` the style's own when nothing had to shrink
 */
export function fitPage(tokens, st, W) {
  const f = fitText([tokens], st, W);
  return { lines: f.lines[0], size: f.size };
}

/**
 * The same for a text typed in PARAGRAPHS (its own line breaks): each paragraph broken by the rule, all
 * at the one size the widest word of any of them allows. @returns { lines: [[counts] per paragraph], size }
 */
export function fitText(paras, st, W) {
  const lim = LINE_MAX * W;
  let size = +st.size || 60;
  let s = st;
  const widest = (x) => { const m = meter(x); return paras.reduce((w, p) => p.reduce((v, t) => Math.max(v, m.text(t)), w), 0); };
  const w0 = widest(st);
  if (w0 > lim) {
    size = Math.max(8, Math.floor(size * lim / w0));
    s = Object.assign({}, st, { size });
    for (let guard = 0; guard < 40 && size > 8 && widest(s) > lim; guard++) s = Object.assign({}, st, { size: --size });
  }
  return { lines: paras.map((p) => breakLines(p, s, W)), size };
}

// ── The seams between reads ─────────────────────────────────────────────────
/**
 * Where one read meets the next, in timeline seconds: two pieces of sound one after the other that come
 * from different files, or from the same file but not continuing it (a clip cut and laid apart).
 */
export function joinsOf(pieces) {
  const out = [];
  const list = (pieces || []).slice().sort((a, b) => a.at - b.at);
  for (let i = 1; i < list.length; i++) {
    const p = list[i - 1], q = list[i];
    // A silence between them is a seam too: the listener stretches the last word of a read into it, so
    // the pause rule, measured between WORDS, can miss it (review K2).
    const goesOn = q.src === p.src && Math.abs(q.crop - (p.crop + (p.end - p.at) * (p.speed || 1))) < 0.05;
    if (!goesOn) out.push(q.at);
  }
  return out;
}

/**
 * Words put back on their own side of a seam. Whisper stretches the last word of a read ~0.4 s into the
 * next one and starts the next word where it stopped: that word ends at the seam now, and the next one
 * starts there (the start trim then moves it on to where its sound begins). Changes `words` in place.
 */
export function fixJoins(words, joins) {
  for (const j of (joins || [])) {
    const i = words.findIndex((w) => (w.start + w.end) / 2 < j && w.end > j);
    if (i < 0) continue;
    const was = words[i].end;
    words[i].end = j;
    const n = words[i + 1];
    if (n && n.start > j && n.start <= j + PAGE.joinReach && Math.abs(n.start - was) < 0.06) n.start = j;
  }
  return words;
}

// ── The cut ─────────────────────────────────────────────────────────────────
// What a deal put on a page is not a look of its own (V49): a look of references only is no look.
const lookKey = (l) => {
  if (!l) return '';
  if (!l.style) return JSON.stringify(l);
  const s = withoutRefs(l.style);
  if (s === l.style) return JSON.stringify(l);
  const o = Object.assign({}, l);
  if (s) o.style = s; else delete o.style;
  return Object.keys(o).length ? JSON.stringify(o) : '';
};

/**
 * @param words   [{ text, start, end, k?, h?, look?, voice? }] in timeline seconds; `look` is the own look of the
 *                caption the word came from: { style?, tx?, ty? }; `h` a word a person corrected (K10); `voice` the
 *                talking-head line it was heard from (phase V30, block 1) - a page never holds words of two lines, and
 *                carries its line's voice
 * @param opts.lane    the lane's style as stored
 * @param opts.format  the timeline's format ('9:16' | '16:9')
 * @param opts.typed   [[from, to]] the lines typed by hand on the lane
 * @param opts.joins   [t] the seams between reads (joinsOf)
 * @param opts.walls   [[from, to]] spans a page does not run into or across - heard captions NOT being cut
 *                     again (recutSome). Unlike a typed line, a wall takes no word away (review K6).
 * @param opts.srt     cut for the `.srt` beside a render (srt.js): the `sentences` rule by characters only
 * @returns [{ name, start, dur, words: [{ w, s, e, k?, h? }], style?, tx?, ty? }] - captions, heard
 *
 * A lane cut in `sentences` (its style's `cut`, phase V30 block 4) - and the `.srt` - is cut as classic subtitles: a
 * phrase ends only at a hard boundary (a pause of 1 s, not 0.4) or a sentence's end, and a comma is where it is cut
 * best when it must be; a page holds any number of words in two lines of at most 42 characters (and of 0.78 of the
 * frame in the lane's font), 7 s at most, and stays up a second when the next page leaves room (SENT).
 */
export function paginate(words, opts) {
  const o = opts || {};
  const srt = !!o.srt;
  const sent = srt || (o.lane && o.lane.cut) === 'sentences';
  const spans = (list) => (list || []).map(([a, b]) => [+a || 0, +b || 0]).filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const typed = spans(o.typed);
  const walls = spans(o.typed).concat(spans(o.walls)).sort((x, y) => x[0] - y[0]);
  const joins = (o.joins || []).map(Number).filter((t) => t >= 0).sort((a, b) => a - b);
  const F = renderFrame(o.format);

  // 0. The words as the cut takes them: rounded, in order, none twice, none under a typed line.
  const ws = [];
  for (const w0 of (words || [])) {
    const text = String((w0 && w0.text) || '').trim();
    if (!text) continue;
    let start = r2(w0.start), end = Math.max(start, r2(w0.end));
    const mid = (start + end) / 2;
    if (typed.some(([a, b]) => mid >= a && mid < b)) continue;
    // Out from under EVERY typed line before its middle - they may overlap, and a short one may sit
    // inside the word's first half (review K2). The spans are in start order: one pass follows a chain.
    for (const [a, b] of typed) if (a < mid && b > start) start = Math.max(start, up2(b));
    const nextT = typed.find(([a]) => a >= mid);
    if (nextT && end > nextT[0]) end = down2(nextT[0]);
    if (end < start) end = start;
    const w = { text, start, end };
    if (w0.k) w.k = true;
    if (w0.h) w.h = true;
    if (w0.look && Object.keys(w0.look).length) w.look = w0.look;
    if (w0.voice) w.voice = String(w0.voice);
    ws.push(w);
  }
  ws.sort((a, b) => a.start - b.start || a.end - b.end);
  const list = [];
  for (const w of ws) {
    const prev = list[list.length - 1];
    if (prev && w.start < prev.end - 0.05 && list.slice(-4).some((p) => bare(p.text) === bare(w.text) && w.start < p.end - 0.05)) continue;
    if (prev && w.start < prev.end) { w.start = prev.end; if (w.end < w.start) w.end = w.start; }
    list.push(w);
  }
  if (!list.length) return [];

  // 1-2. Boundaries: after each word, what lies between it and the next.
  const midOf = (w) => (w.start + w.end) / 2;
  const between = (a, b) => {
    if (b.start - a.end >= (sent ? SENT.pause : PAGE.pause) - 1e-9) return 'hard';
    const am = midOf(a), bm = midOf(b);
    if (walls.some(([s, e]) => s < bm && e > am)) return 'hard';
    if (joins.some((j) => j > am && j <= bm)) return 'hard';
    if (lookKey(a.look) !== lookKey(b.look)) return 'hard';
    if ((a.voice || '') !== (b.voice || '')) return 'hard';
    return '';
  };
  const phrases = [];
  let cur = [];
  for (let i = 0; i < list.length; i++) {
    const w = list[i], next = list[i + 1] || null;
    cur.push(i);
    const hard = next ? between(w, next) : 'hard';
    const gap = next ? next.start - w.end : Infinity;
    let end = hard;
    if (!end && endsSentence(w.text, next && next.text, gap)) end = 'sentence';
    if (!end && !sent && cur.length >= 2 && endsClause(w.text)) end = 'clause';
    if (end) { phrases.push({ idx: cur, end }); cur = []; }
  }

  // Each phrase's style: the lane's, with the own look of its words on top. On a lane with several presets (V49) a page may be
  // dealt any of them: `alts` - each look it must fit in too.
  const mixL = srt ? null : mixOf(o.lane);
  const styleCache = new Map();
  const styleOf = (look) => {
    const key = lookKey(look);
    if (!styleCache.has(key)) {
      // The `.srt` has no look: a player draws it in its own font, so its lines are measured in characters.
      const st = srt ? null : withAuto(resolveStyle(o.lane, look && look.style), F.w, F.h);
      const N = sent ? Infinity : +st.wordsPerLine > 0 ? +st.wordsPerLine : autoWordsPerLine(o.format);
      const lines = sent ? SENT.lines : Math.max(1, Math.min(3, Math.round(+st.lines || 2)));
      const m = st ? meter(st) : null;
      const lim = LINE_MAX * F.w;
      const own = look && look.style ? withoutRefs(look.style) : null;
      const alts = mixL ? mixL.map((_, k) => {
        const a = withAuto(resolveStyle(o.lane, Object.assign({}, own || {}, { mixP: k })), F.w, F.h);
        return { st: a, m: meter(a) };
      }) : null;
      styleCache.set(key, { st, N, lines, m, lim, alts });
    }
    return styleCache.get(key);
  };

  // Does words[a..b) make a page? Joining a flash single to a neighbour (`merging`) is never refused for
  // being short: the joined page is longer than the single it takes in (review K2: with two words a page,
  // the rule against flashes made single-word ones).
  const maxDur = sent ? SENT.maxDur : PAGE.maxDur;
  const makes = (S, a, b, merging) => {
    const n = b - a;
    if (n === 1) return true;
    if (n > S.N) return false;
    const dur = list[b - 1].end - list[a].start;
    if (dur > maxDur + 1e-9 || (!merging && dur < PAGE.minDur - 1e-9)) return false;
    const toks = [];
    // On a lane with several presets a page is drawn in one of THEIR looks, never the lane's own: those are what it must fit in.
    const looks = S.alts || (S.m ? [{ st: S.st, m: S.m }] : null);
    for (let i = a; i < b; i++) {
      if (looks && looks.some((x) => x.m.text(list[i].text) > S.lim)) return false;       // a word wider than a line stands alone
      toks.push(list[i].text);
    }
    if (S.alts) return S.alts.every((x) => breakLines(toks, x.st, F.w).length <= S.lines);
    return breakLines(toks, S.st, F.w).length <= S.lines;
  };

  // 3. Each phrase into the fewest pages, the least cost.
  const pages = [];              // { a, b, end } - word indices [a, b), what follows the page
  for (const ph of phrases) {
    const a0 = ph.idx[0], L = ph.idx.length;
    const S = styleOf(list[a0].look);
    const memo = new Map();
    const ok = (a, b) => {
      const key = a * 4096 + b;
      if (!memo.has(key)) memo.set(key, makes(S, a0 + a, a0 + b));
      return memo.get(key);
    };
    const minP = new Array(L + 1).fill(Infinity);
    minP[0] = 0;
    for (let b = 1; b <= L; b++) {
      for (let a = Math.max(0, b - S.N); a < b; a++) if (minP[a] + 1 < minP[b] && ok(a, b)) minP[b] = minP[a] + 1;
    }
    // Exactly k pages, the least cost: [cost, cuts].
    const cutInto = (k) => {
      const target = L / k;
      const cost = Array.from({ length: k + 1 }, () => new Array(L + 1).fill(Infinity));
      const from = Array.from({ length: k + 1 }, () => new Array(L + 1).fill(-1));
      cost[0][0] = 0;
      for (let p = 1; p <= k; p++) {
        for (let b = p; b <= L; b++) {
          for (let a = Math.max(p - 1, b - S.N); a < b; a++) {
            if (cost[p - 1][a] === Infinity || !ok(a, b)) continue;
            let c = ((b - a) - target) * ((b - a) - target);
            if (b < L) {
              const last = list[a0 + b - 1].text, next = list[a0 + b].text;
              if (weakEnd(last)) c += COST.weak;
              if (enclitic(next)) c += COST.enclitic;
              if (pair(last, next)) c += COST.pair;
              // Inside a sentence (the `sentences` cut), a comma is where a page is best cut.
              if (sent && !endsClause(last)) c += COST.clause;
            }
            if (list[a0 + b - 1].end - list[a0 + a].start < PAGE.short) c += COST.short;
            if (b - a === 1 && L > 1 && list[a0 + a].end - list[a0 + a].start < PAGE.minDur) c += COST.flash;
            if (cost[p - 1][a] + c < cost[p][b] - 1e-9) { cost[p][b] = cost[p - 1][a] + c; from[p][b] = a; }
          }
        }
      }
      if (cost[k][L] === Infinity) return null;
      const cuts = [];
      for (let p = k, b = L; p > 0; p--) { const a = from[p][b]; cuts.unshift([a, b]); b = a; }
      return [cost[k][L], cuts];
    };
    // The fewest pages - or one more, when that is what keeps a preposition off a page's end, an
    // enclitic off its start or a pair together (an extra page costs less than any of those).
    const k = minP[L];
    let best = cutInto(k);
    if (k < L && best[0] >= COST.page) {
      const more = cutInto(k + 1);
      if (more && more[0] + COST.page < best[0] - 1e-9) best = more;
    }
    const cuts = best[1];
    cuts.forEach(([a, b], i) => pages.push({ a: a0 + a, b: a0 + b, end: i === cuts.length - 1 ? ph.end : '' }));
  }

  // 4. A word alone on a page shorter than 0.3 s joins a neighbour - across the smaller gap, where
  //    nothing hard and no sentence end lies between, and only when the result is a page.
  const durOf = (p) => list[p.b - 1].end - list[p.a].start;
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    if (p.b - p.a !== 1 || durOf(p) >= PAGE.minDur) continue;
    const prev = pages[i - 1], next = pages[i + 1];
    const S = styleOf(list[p.a].look);
    const opts2 = [];
    if (prev && prev.end !== 'hard' && prev.end !== 'sentence') opts2.push(['prev', list[p.a].start - list[prev.b - 1].end]);
    if (next && p.end !== 'hard' && p.end !== 'sentence') opts2.push(['next', list[next.a].start - list[p.a].end]);
    opts2.sort((x, y) => x[1] - y[1]);
    for (const [side] of opts2) {
      if (side === 'prev' && makes(S, prev.a, p.b, true)) { prev.b = p.b; prev.end = p.end; pages.splice(i, 1); i -= 2; break; }
      if (side === 'next' && makes(S, p.a, next.b, true)) { next.a = p.a; pages.splice(i, 1); i -= 1; break; }
    }
    if (i < -1) i = -1;
  }

  // 5. Time on screen.
  const timing = () => {
    const span = pages.map((p, i) => {
      const last = list[p.b - 1];
      const start = list[p.a].start;
      let end = last.end;
      const nextStart = pages[i + 1] ? list[pages[i + 1].a].start : Infinity;
      const wall = walls.find(([a]) => a >= end - 1e-9);
      const limit = Math.min(nextStart, wall ? wall[0] : Infinity);
      end = (nextStart - end < PAGE.closeGap) ? Math.min(nextStart, limit) : Math.min(end + PAGE.hold, limit);
      // A classic subtitle stays up a second, where the next one leaves room.
      if (sent) end = Math.max(end, Math.min(start + SENT.minDur, limit));
      return { start, end: Math.max(end, last.end) };
    });
    // NO PAGE IS ON SCREEN UNDER 0.1 s - the shortest clip a lane keeps; a shorter one was stretched by
    // the lane and drawn over the next page (review K2). It starts earlier instead, in the page before's
    // tail (which keeps its own 0.1 s) and never before a typed line: its words keep their moments, so a
    // re-cut gives the same pages back.
    for (let i = 0; i < span.length; i++) {
      const x = span[i];
      if (x.end - x.start >= PAGE.minClip - 1e-9) continue;
      const prev = span[i - 1];
      const wallEnd = walls.reduce((m, [a, b]) => (b <= x.start + 1e-9 && b > m ? b : m), 0);
      const want = Math.max(up2(Math.max(prev ? prev.start + PAGE.minClip : 0, wallEnd)), down2(x.end - PAGE.minClip));
      if (want < x.start) {
        x.start = want;
        if (prev && prev.end > want) prev.end = want;
      }
    }
    return span;
  };
  let span = timing();
  // ...and where there is no room for that (a run of words each shorter than 0.1 s, one to a page), the
  // page joins a neighbour across anything but a hard boundary, past N if it must: a word on screen for
  // a twentieth of a second cannot be read anyway.
  const stuck = new Set();
  for (let guard = 0; guard <= pages.length; guard++) {
    const i = span.findIndex((x, j) => x.end - x.start < PAGE.minClip - 1e-9 && !stuck.has(pages[j]));
    if (i < 0) break;
    const p = pages[i], prev = pages[i - 1], next = pages[i + 1];
    if (prev && prev.end !== 'hard') { prev.b = p.b; prev.end = p.end; pages.splice(i, 1); }
    else if (next && p.end !== 'hard') { next.a = p.a; pages.splice(i, 1); }
    else { stuck.add(p); continue; }
    span = timing();
  }

  // 6. The pages, with their own look.
  const out = [];
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    const first = list[p.a];
    const { start, end } = span[i];
    const c = {
      name: list.slice(p.a, p.b).map((w) => w.text).join(' '),
      start,
      dur: Math.max(0.05, down2(end - start)),
      words: list.slice(p.a, p.b).map((w) => {
        const x = { w: w.text, s: r2(w.start - start), e: r2(w.end - start) };
        if (w.k) x.k = true;
        if (w.h) x.h = true;
        return x;
      }),
    };
    const look = first.look;
    if (look) {
      if (look.style) c.style = JSON.parse(JSON.stringify(look.style));
      if (look.tx != null) c.tx = look.tx;
      if (look.ty != null) c.ty = look.ty;
    }
    if (first.voice) c.voice = first.voice;
    out.push(c);
  }
  return out;
}

// ── The lane, cut again ─────────────────────────────────────────────────────
/** A heard caption's own look: what of it a page cut from its words carries on. */
export function lookOf(c) {
  const l = {};
  if (c && c.style && typeof c.style === 'object' && Object.keys(c.style).length) l.style = c.style;
  if (c && c.tx != null && +c.tx) l.tx = +c.tx;
  if (c && c.ty != null && +c.ty) l.ty = +c.ty;
  return Object.keys(l).length ? l : null;
}

/**
 * Every heard word on the lane, back in timeline seconds, with its marks and its caption's look. A caption
 * whose words no longer spell its text (rewritten by hand before K10) is timed for its text first - the
 * person's text is what is cut, never the words it replaced. A talking head's word keeps its line (`voice`,
 * phase V30, block 1): the pages cut again are still that line's.
 */
export function wordsOf(track) {
  const out = [];
  for (const c of ((track && track.clips) || [])) {
    if (!isHeard(c)) continue;
    const base = +c.start || 0;
    const look = lookOf(c);
    for (const w of timedWords(c)) {
      if (!w || !String(w.w || '').trim()) continue;
      // Rounded as the cut rounds them: two words at one moment then tie exactly and keep their caption's
      // order, instead of being reordered by float noise on every re-cut (review K2).
      const x = { text: String(w.w), start: r2(base + (+w.s || 0)), end: r2(base + (+w.e || 0)) };
      if (w.k) x.k = true;
      if (w.h) x.h = true;
      if (look) x.look = look;
      if (c.voice) x.voice = String(c.voice);
      out.push(x);
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * A heard caption's words as they spell its text: its own, or - rewritten by hand before K10 - its text timed
 * over them (retext). When even that cannot be done (no room), its words as they are.
 */
export function timedWords(c) {
  const w = (c && Array.isArray(c.words)) ? c.words : [];
  if (!w.length || spells(w, c.name)) return w;
  const r = retext(w, c.name, c.dur);
  return r.words || w;
}

/**
 * Is this heard caption more than ONE page of its lane - by the limits the cut keeps (K10b: a line grown by
 * corrections; a correction never cuts by itself)? More words than a page holds, wider than its lines, or
 * on screen longer than PAGE.maxDur. @returns what it is more than, in words, or null when it fits.
 */
export function overPage(c, laneStyle, format) {
  const words = timedWords(c).filter((w) => w && String(w.w || '').trim());
  if (words.length < 2) return null;
  const F = renderFrame(format);
  const st = withAuto(resolveStyle(laneStyle, c && c.style), F.w, F.h);
  // A lane cut in `sentences` (phase V30, block 4): any number of words, two lines, up to 7 s.
  const sent = st.cut === 'sentences';
  const N = sent ? Infinity : +st.wordsPerLine > 0 ? +st.wordsPerLine : autoWordsPerLine(format);
  const lines = sent ? SENT.lines : Math.max(1, Math.min(3, Math.round(+st.lines || 2)));
  const maxDur = sent ? SENT.maxDur : PAGE.maxDur;
  if (words.length > N) return words.length + ' words, a page holds ' + N;
  const end = Math.max(...words.map((w) => r2(w.e)));
  const dur = end - r2(words[0].s);
  if (dur > maxDur + 1e-9) return dur.toFixed(1) + ' s of words, a page is up to ' + maxDur + ' s';
  const tokens = words.map((w) => String(w.w).trim());
  const m = meter(st);
  if (tokens.some((t) => m.text(t) > LINE_MAX * F.w)) return 'a word wider than a line, which gets a page of its own';
  const got = breakLines(tokens, st, F.w).length;
  if (got > lines) return got + ' lines, a page has ' + lines;
  return null;
}

/** The typed lines of a lane, as spans [[from, to]]. */
export const typedOf = (track) => ((track && track.clips) || [])
  .filter((c) => c && c.name && !isHeard(c))
  .map((c) => [+c.start || 0, (+c.start || 0) + (+c.dur || 0)]);

/** The style fields a heard lane is cut again for: what makes a line wider or narrower, or a page longer. */
export const CUT_KEYS = ['font', 'bold', 'size', 'sizeAuto', 'casing', 'scaleX', 'spacing', 'outline', 'shadow', 'borderStyle',
  'effect', 'wordsPerLine', 'lines', 'cut'];

/**
 * The lane's HEARD captions cut again by these rules, from the words it holds - or null when it holds
 * none. `style` is the lane's style to cut for (a change not saved yet); typed lines are boundaries
 * and are not returned: they stay as they are.
 */
export function recut(track, tl, style) {
  const words = wordsOf(track);
  if (!words.length) return null;
  return paginate(words, {
    lane: style || (track && track.style),
    format: tl && tl.format,
    typed: typedOf(track),
    joins: joinsOf(soundPieces(tl)),
  });
}

/**
 * The lane's clips with its heard captions cut again (recut) - the typed ones the very same objects - or
 * null. A page that comes out as it was keeps its caption's id, any other the id of the caption its first
 * word came from while that one is free (review K2): a re-cut that changes nothing changes nothing - no
 * undo step, no save - and a merge with another save still knows the captions. `makeId` gives a new id.
 */
export function recutClips(track, tl, makeId) {
  const pages = recut(track, tl);
  // A lane with no heard words is still dealt its mix (V49) - its typed lines.
  if (!pages) {
    if (!needsDeal(track)) return null;
    const list = ((track && track.clips) || []).slice();
    deal(list, track.style);
    return list;
  }
  const old = ((track && track.clips) || []).filter(isHeard);
  const typed = ((track && track.clips) || []).filter((c) => c && !isHeard(c));
  const out = typed.concat(_asClips(pages, old, makeId, track.clips)).sort((a, b) => (+a.start || 0) - (+b.start || 0));
  if (needsDeal({ style: track.style, clips: out })) deal(out, track.style);
  return out;
}

/**
 * Only SOME heard captions cut again - those picked (K6: a caption given a style of its own is cut by
 * it, and the rest of the lane stays the very same objects, its hand cuts included). Every other
 * caption is a wall the new pages do not cross. @returns { clips, made: [ids of the new pages] } or null
 */
export function recutSome(track, tl, ids, makeId) {
  const want = ids instanceof Set ? ids : new Set(ids || []);
  const all = (track && track.clips) || [];
  const mine = all.filter((c) => isHeard(c) && want.has(c.id));
  if (!mine.length) return null;
  const others = all.filter((c) => !mine.includes(c));
  // Typed lines take the words under them away, as in every cut; the other HEARD captions are only walls -
  // a picked word that touches a neighbour (a zero-length word at a page's end, an edge pulled over it)
  // used to be taken away, and a whole caption could vanish (review K6).
  const pages = paginate(wordsOf({ clips: mine }), {
    lane: track.style, format: tl && tl.format,
    typed: typedOf({ clips: others }),
    walls: others.filter(isHeard).map((c) => [+c.start || 0, (+c.start || 0) + (+c.dur || 0)]),
    joins: joinsOf(soundPieces(tl)),
  });
  const made = _asClips(pages, mine, makeId, all);
  const clips = others.concat(made).sort((a, b) => (+a.start || 0) - (+b.start || 0));
  if (needsDeal({ style: track.style, clips })) deal(clips, track.style);
  return { clips, made: made.map((c) => c.id) };
}

/**
 * The lane's heard captions cut again with LOOKS laid over them by time: `looks` [[from, to, look]] - a word
 * whose middle falls in a span wears that look. What a save merge uses when the server laid the lane
 * again while a caption was given a style of its own (review K6): the server's words, my looks.
 *
 * `keep` (a Set of ids): heard captions left exactly as they are - lines I corrected that the server's lay
 * never saw (K10). They stand as typed lines do: the server's words under them go, ONE BY ONE (a page of
 * its that only touches one keeps the rest of its words), and no page runs across them.
 */
export function recutWithLooks(track, tl, looks, makeId, keep) {
  const all = (track && track.clips) || [];
  const held = all.filter((c) => isHeard(c) && keep && keep.has(c.id));
  const cut = all.filter((c) => isHeard(c) && !held.includes(c));
  const typed = all.filter((c) => c && !isHeard(c));
  const byStart = (a, b) => (+a.start || 0) - (+b.start || 0);
  const words = wordsOf({ clips: cut });
  if (!words.length) return held.length ? typed.concat(held).sort(byStart) : null;
  for (const w of words) {
    const mid = (w.start + w.end) / 2;
    const hit = (looks || []).find(([a, b]) => mid >= a && mid < b);
    if (hit) { if (hit[2]) w.look = hit[2]; else delete w.look; }
  }
  const spans = typedOf(track).concat(held.map((c) => [+c.start || 0, (+c.start || 0) + (+c.dur || 0)]));
  const pages = paginate(words, { lane: track.style, format: tl && tl.format, typed: spans, joins: joinsOf(soundPieces(tl)) });
  const out = typed.concat(held, _asClips(pages, cut, makeId, all)).sort(byStart);
  if (needsDeal({ style: track.style, clips: out })) deal(out, track.style);
  return out;
}

// Pages as lane clips, keeping the ids of the captions they came from (see recutClips). A new id is never
// one the lane already holds - two captions under one id are deleted, picked and merged as one (review K6).
function _asClips(pages, old, makeId, lane) {
  const taken = new Set((lane || old).map((c) => c && c.id));
  const fresh = () => { let id; do { id = makeId(); } while (taken.has(id)); taken.add(id); return id; };
  const key = (c) => JSON.stringify([r2(c.start), r2(c.dur), c.name, c.words, c.style || null,
    c.tx == null ? null : c.tx, c.ty == null ? null : c.ty, c.voice || null]);
  const byKey = new Map(old.map((c) => [key(c), c.id]));
  const used = new Set();
  const made = pages.map((p) => {
    const c = {
      id: null, src: null, thumb: null,
      name: p.name, start: p.start, dur: Math.max(PAGE.minClip, +p.dur || 0), words: p.words,
      srcDur: 0, trimIn: 0, trimOut: 0, speed: 1, reversed: false,
      transition: null, animation: null, filter: null, volume: null, pairId: null,
    };
    if (p.style) c.style = p.style;
    if (p.tx != null) c.tx = p.tx;
    if (p.ty != null) c.ty = p.ty;
    if (p.voice) c.voice = p.voice;
    let id = byKey.get(key(c));
    if (!id || used.has(id)) {
      const at = c.start + ((c.words[0] && +c.words[0].s) || 0);
      const o = old.find((x) => !used.has(x.id) && at >= (+x.start || 0) - 1e-6 && at < (+x.start || 0) + (+x.dur || 0));
      id = o ? o.id : fresh();
    }
    used.add(id);
    c.id = id;
    return c;
  });
  return made;
}
