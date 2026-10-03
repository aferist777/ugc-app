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

   PURE, and shared: the page imports it, the server require()s it (lib/mv3b-subs.js).
   ═══════════════════════════════════════════════════════════════════════════ */

import { resolveStyle, withAuto, renderFrame, autoWordsPerLine } from './style.js';
import { meter, LINE_MAX } from './measure.js';
import { isHeard, soundPieces } from './heard.js';

/** The cut's constants - not settings: the strip offers Words and Lines, nothing else. */
export const PAGE = {
  pause: 0.4,        // a pause this long always ends a page
  maxDur: 3.2,       // a page of two words or more is on screen no longer than this...
  minDur: 0.3,       // ...and no shorter
  short: 0.5,        // a page shorter than this costs a little
  closeGap: 0.7,     // a gap shorter than this to the next page is not shown: the page stays up
  hold: 0.3,         // before a longer one the page stays this much longer
  joinReach: 0.6,    // how far past the seam of two reads a stretched word can push the next one
};

// What a cut of a phrase costs, besides being uneven ((words - n/k)^2 a page). The research's simulator
// settled on 4 / 6 / 1 for the fewest pages alone; with one more page allowed (at `page`), 5 and 8 keep
// the weak ends at 0-1% of pages on the recorded words, against 7-15% cut greedily (K2 stand).
const COST = { weak: 5, enclitic: 8, pair: 10, short: 1, page: 3 };

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
const ABBR = new Set(['т.', 'т.е.', 'т.к.', 'е.', 'к.', 'им.', 'ул.', 'стр.', 'см.', 'проф.', 'акад.', 'гл.', 'рис.', 'табл.',
  'г-н.', 'г-жа.', 'д-р.', 'mr.', 'mrs.', 'ms.', 'dr.', 'vs.', 'e.g.', 'i.e.', 'st.']);
// ...and one that ends it only when the next word starts with a capital ("и др. Потом", "100 руб. за штуку").
const MAYBE = new Set(['т.д.', 'т.п.', 'д.', 'п.', 'г.', 'гг.', 'в.', 'вв.', 'руб.', 'коп.', 'тыс.', 'млн.', 'млрд.', 'др.', 'etc.']);

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
  return true;
}
// A comma, a semicolon, a colon, a dash - or an ellipsis that did not end the sentence.
const endsClause = (t) => /[,;:—–…-]$|\.\.\.$/u.test(bare(t));

// ── Lines ───────────────────────────────────────────────────────────────────
/**
 * Where a page of `tokens` (its words as stored - casing is the style's) breaks into lines in style
 * `st` (resolved, size filled in) on a frame `W` wide: the line counts, top first ([2, 3] = two words,
 * then three). The fewest lines no wider than 0.78 of the frame each; among those, the most even, with
 * no weak word at a line's end and no short word alone on a line of a page of three or more; when it is
 * a tie, the lower line the wider. A word wider than the limit alone is a line of its own.
 */
export function breakLines(tokens, st, W) {
  const n = tokens.length;
  if (n < 2) return n ? [n] : [];
  const m = meter(st);
  const lim = LINE_MAX * W;
  const runs = tokens.map((t) => m.run(t));
  const widthOf = (a, b) => {
    let adv = 0, chars = 0;
    for (let i = a; i < b; i++) { adv += runs[i].a; chars += runs[i].n; }
    adv += (b - a - 1) * m.space;
    chars += b - a - 1;
    return m.width(adv, chars);
  };
  // The fewest lines: fill each as far as it goes.
  let k = 0;
  for (let a = 0; a < n;) {
    let b = a + 1;
    while (b < n && widthOf(a, b + 1) <= lim) b++;
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
        const w = widthOf(a, b);
        if (b - a > 1 && w > lim) continue;
        let c = 10 * (w / lim) * (w / lim);
        if (b < n && weakEnd(tokens[b - 1])) c += 3;
        if (b - a === 1 && n >= 3 && w < lim / 2) c += 4;    // a short word alone on a line
        c += 0.02 * (w / lim) * (k - p);         // a tie goes to the wider lower line
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
  const lim = LINE_MAX * W;
  let size = +st.size || 60;
  let s = st;
  const widest = (x) => tokens.reduce((m, t) => Math.max(m, meter(x).text(t)), 0);
  const w0 = widest(st);
  if (w0 > lim) {
    size = Math.max(8, Math.floor(size * lim / w0));
    s = Object.assign({}, st, { size });
    for (let guard = 0; guard < 40 && size > 8 && widest(s) > lim; guard++) s = Object.assign({}, st, { size: --size });
  }
  return { lines: breakLines(tokens, s, W), size };
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
    if (q.at - p.end > PAGE.pause) continue;             // a silence between: the pause rule has it
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
const lookKey = (l) => (l ? JSON.stringify(l) : '');

/**
 * @param words   [{ text, start, end, k?, look? }] in timeline seconds; `look` is the own look of the
 *                caption the word came from: { style?, tx?, ty? }
 * @param opts.lane    the lane's style as stored
 * @param opts.format  the timeline's format ('9:16' | '16:9')
 * @param opts.typed   [[from, to]] the lines typed by hand on the lane
 * @param opts.joins   [t] the seams between reads (joinsOf)
 * @returns [{ name, start, dur, words: [{ w, s, e, k? }], style?, tx?, ty? }] - captions, heard
 */
export function paginate(words, opts) {
  const o = opts || {};
  const typed = (o.typed || []).map(([a, b]) => [+a || 0, +b || 0]).filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
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
    const inT = typed.find(([a, b]) => start >= a && start < b);
    if (inT) start = up2(inT[1]);
    const nextT = typed.find(([a]) => a >= mid);
    if (nextT && end > nextT[0]) end = down2(nextT[0]);
    if (end < start) end = start;
    const w = { text, start, end };
    if (w0.k) w.k = true;
    if (w0.look && Object.keys(w0.look).length) w.look = w0.look;
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
    if (b.start - a.end >= PAGE.pause - 1e-9) return 'hard';
    const am = midOf(a), bm = midOf(b);
    if (typed.some(([s, e]) => s < bm && e > am)) return 'hard';
    if (joins.some((j) => j > am && j <= bm)) return 'hard';
    if (lookKey(a.look) !== lookKey(b.look)) return 'hard';
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
    if (!end && cur.length >= 2 && endsClause(w.text)) end = 'clause';
    if (end) { phrases.push({ idx: cur, end }); cur = []; }
  }

  // Each phrase's style: the lane's, with the own look of its words on top.
  const styleCache = new Map();
  const styleOf = (look) => {
    const key = lookKey(look);
    if (!styleCache.has(key)) {
      const st = withAuto(resolveStyle(o.lane, look && look.style), F.w, F.h);
      const N = +st.wordsPerLine > 0 ? +st.wordsPerLine : autoWordsPerLine(o.format);
      const lines = Math.max(1, Math.min(3, Math.round(+st.lines || 2)));
      const m = meter(st);
      const lim = LINE_MAX * F.w;
      styleCache.set(key, { st, N, lines, m, lim });
    }
    return styleCache.get(key);
  };

  // Does words[a..b) make a page?
  const makes = (S, a, b) => {
    const n = b - a;
    if (n === 1) return true;
    if (n > S.N) return false;
    const dur = list[b - 1].end - list[a].start;
    if (dur > PAGE.maxDur + 1e-9 || dur < PAGE.minDur - 1e-9) return false;
    const toks = [];
    for (let i = a; i < b; i++) {
      if (S.m.text(list[i].text) > S.lim) return false;       // a word wider than a line stands alone
      toks.push(list[i].text);
    }
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
            }
            if (list[a0 + b - 1].end - list[a0 + a].start < PAGE.short) c += COST.short;
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
      if (side === 'prev' && makes(S, prev.a, p.b)) { prev.b = p.b; prev.end = p.end; pages.splice(i, 1); i -= 2; break; }
      if (side === 'next' && makes(S, p.a, next.b)) { next.a = p.a; pages.splice(i, 1); i -= 1; break; }
    }
    if (i < -1) i = -1;
  }

  // 5. Time on screen, and 6. the page's own look.
  const out = [];
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    const first = list[p.a], last = list[p.b - 1];
    const start = first.start;
    let end = last.end;
    const nextStart = pages[i + 1] ? list[pages[i + 1].a].start : Infinity;
    const wall = typed.find(([a]) => a >= end - 1e-9);
    const limit = Math.min(nextStart, wall ? wall[0] : Infinity);
    end = (nextStart - end < PAGE.closeGap) ? Math.min(nextStart, limit) : Math.min(end + PAGE.hold, limit);
    end = Math.max(end, last.end);
    const c = {
      name: list.slice(p.a, p.b).map((w) => w.text).join(' '),
      start,
      dur: Math.max(0.05, down2(end - start)),
      words: list.slice(p.a, p.b).map((w) => {
        const x = { w: w.text, s: r2(w.start - start), e: r2(w.end - start) };
        if (w.k) x.k = true;
        return x;
      }),
    };
    const look = first.look;
    if (look) {
      if (look.style) c.style = JSON.parse(JSON.stringify(look.style));
      if (look.tx != null) c.tx = look.tx;
      if (look.ty != null) c.ty = look.ty;
    }
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

/** Every heard word on the lane, back in timeline seconds, with its mark and its caption's look. */
export function wordsOf(track) {
  const out = [];
  for (const c of ((track && track.clips) || [])) {
    if (!isHeard(c)) continue;
    const base = +c.start || 0;
    const look = lookOf(c);
    for (const w of c.words) {
      if (!w || !String(w.w || '').trim()) continue;
      const x = { text: String(w.w), start: base + (+w.s || 0), end: base + (+w.e || 0) };
      if (w.k) x.k = true;
      if (look) x.look = look;
      out.push(x);
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** The typed lines of a lane, as spans [[from, to]]. */
export const typedOf = (track) => ((track && track.clips) || [])
  .filter((c) => c && c.name && !isHeard(c))
  .map((c) => [+c.start || 0, (+c.start || 0) + (+c.dur || 0)]);

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
