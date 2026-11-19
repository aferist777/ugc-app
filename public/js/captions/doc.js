/* ═══════════════════════════════════════════════════════════════════════════
   CAPTIONS — the lanes of words as ONE DOCUMENT.

   The captions view's `text` tab shows the lines of the subtitle and text lanes as a document: a line of it is a
   caption, in time order. ONE model for every change made there: the lines changed are taken out
   and their new texts are put in their place - rewrite(track, from, to, texts). The words of those lines are matched
   to the new texts as a line rewritten in the strip is (words.js retextLines - retext over several lines at once): a
   word that stays keeps its moment whichever line it is on now, a new word shares the time of what it replaced by
   "letters + 2", a word taken out leaves a pause. So Enter (one line's text as two), Delete at a line's end (two as one)
   and a word carried across the end of a line need no operations of their own.

   - THE EDGES FOLLOW THE WORDS. The stretch rewritten keeps its outer edges. Inside it, a line keeps an old line's start
     where its first word was that line's first, and its end where its last word was that line's last; anywhere else it
     starts at its first word and ends at its last - staying up to the next line across a gap under 0.7 s, and 0.3 s
     longer before a longer one (pages.js PAGE, as a cut page does).
   - A TYPED line (no words) stays typed: its text as it is written; lines that are all typed share their stretch by
     "letters + 2". A typed line rewritten together with a heard one is timed by its letters (words.js typedWords) and
   becomes part of a corrected heard line.
   - A TALKING HEAD's line of the script (`voice`) never shares a caption with another line's words:
     a rewrite across two of them is refused, and says why.
   - The limits of a line: 200 words, 400 characters, 60 a word - refused in words before anything changes.
   - A line left with no text is taken off its lane.
   - What a line carries on: the own look (style, tx, ty) and `voice` of the old line most of its words came from (a
     typed one: the line it starts in). The FIRST new line keeps the first old line's id - the pick and the cursor stay
     on it; another keeps the id of the line it came from while that one is free, or gets a new one.

   Find and replace (matcher, matchesIn, replaceIn): over the text of each line; a replacement is a rewrite of its line.

   PURE: no page, no store.
   ═══════════════════════════════════════════════════════════════════════════ */

import { isHeard } from './heard.js';
import { timedWords, PAGE } from './pages.js';
import { retextLines, typedWords, textOf, tokensOf, LIMITS } from './words.js';
import * as T from '../i18n/t.js';

const cs = (t) => Math.round((+t || 0) * 100);
const MINC = Math.round(PAGE.minClip * 100);
const weight = (t) => (String(t).match(/[\p{L}\p{N}]/gu) || []).length + 2;
const _short = (t) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); return s.length > 40 ? s.slice(0, 39) + '…' : s; };

/** A lane the document shows: the subtitles, or a text lane. */
export const isWordsLane = (t) => !!t && (t.kind === 'subs' || t.kind === 'text');

/** The lane's lines in the document's order: by start - the lane's own order where two start together. */
export function linesOf(track) {
  return ((track && track.clips) || []).filter(Boolean).map((c, i) => [c, i])
    .sort((a, b) => ((+a[0].start || 0) - (+b[0].start || 0)) || (a[1] - b[1])).map((x) => x[0]);
}

/** What a line says in the document - its text, as on the timeline. */
export const textOfLine = (c) => String((c && c.name) || '');

// Said in the app's language at the moment of the refusal.
export const WHY = {
  get voice() { return T.t('Two lines of the script stay two captions - the words of one never join the other\'s'); },
  get words() { return T.tn(LIMITS.words, 'A line holds at most {n} word', 'A line holds at most {n} words'); },
  get text() { return T.tn(LIMITS.text, 'A line holds at most {n} character', 'A line holds at most {n} characters'); },
  get room() { return T.t('No room for that many lines here - each is on screen 0.1 s at least'); },
};

/**
 * Lines [from, to) of the lane (in linesOf's order) taken out and `texts` put in their place (see the header).
 * `makeId` gives a new caption id. @returns { clips: the lane's clips after it, ids: the new lines' ids in order } or
 * { why } - nothing is changed then.
 */
export function rewrite(track, from, to, texts, makeId) {
  const lines = linesOf(track);
  if (!(from >= 0 && to <= lines.length && from < to)) return { why: T.t('There is no such line') };
  const old = lines.slice(from, to);
  const tx = (texts || []).map((t) => String(t == null ? '' : t));
  if (new Set(old.map((c) => String(c.voice || ''))).size > 1) return { why: WHY.voice };
  const S = cs(old[0].start);
  const E = Math.max(S, ...old.map((c) => cs((+c.start || 0) + (+c.dur || 0))));
  const res = old.some(isHeard) ? _heard(old, tx, S, E) : _typed(old, tx, S, E);
  if (res.why) return res;

  // Ids and what each new line carries on.
  const used = new Set();
  const taken = new Set(((track && track.clips) || []).map((c) => c && c.id));
  const fresh = () => { let id; do { id = makeId(); } while (taken.has(id)); taken.add(id); return id; };
  const made = res.lines.map((l, k) => {
    const src = l.from || old[0];
    const c = JSON.parse(JSON.stringify(src));
    let id = k === 0 ? old[0].id : (used.has(src.id) ? null : src.id);
    if (!id || used.has(id)) id = fresh();
    used.add(id);
    c.id = id;
    c.name = l.name;
    c.start = l.start / 100;
    c.dur = (l.end - l.start) / 100;
    if (l.words) c.words = l.words; else delete c.words;
    return c;
  });
  // The lane as it was, the rewritten lines where the first of the old ones stood.
  const all = (track && track.clips) || [];
  const at = Math.min(...old.map((c) => all.indexOf(c)));
  const before = all.slice(0, at).filter((c) => !old.includes(c));
  const after = all.slice(at).filter((c) => !old.includes(c));
  return { clips: before.concat(made, after), ids: made.map((c) => c.id) };
}

// ── Typed lines only: text as written, the stretch shared by "letters + 2" ──
function _typed(old, tx, S, E) {
  const keep = tx.filter((t) => t.trim());
  if (!keep.length) return { lines: [] };
  for (const t of keep) if (t.length > LIMITS.text) return { why: WHY.text };
  const room = E - S;
  if (room < MINC * keep.length) return { why: WHY.room };
  const wt = keep.map((t) => tokensOf(t).reduce((n, w) => n + weight(w), 0) || 1);
  // Whole hundredths, the remainders to the largest fractions - by plain shares while each is long enough, otherwise
  // the shortest each and the rest by shares (as words.js shares a stretch among words).
  const W = wt.reduce((a, b) => a + b, 0);
  const deal = (r) => {
    const raw = wt.map((x) => r * x / W);
    const got = raw.map(Math.floor);
    const left = r - got.reduce((a, b) => a + b, 0);
    raw.map((x, i) => [x - got[i], i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]).slice(0, left).forEach(([, i]) => { got[i]++; });
    return got;
  };
  let len = deal(room);
  if (len.some((x) => x < MINC)) len = deal(room - MINC * keep.length).map((x) => x + MINC);
  let t = S;
  return { lines: keep.map((name, i) => {
    const l = { start: t, end: t + len[i], name };
    l.from = _fromAt(old, t);
    t += len[i];
    return l;
  }) };
}

// The old line a new one carries on from: the last that starts at or before `t` (hundredths), else the first.
function _fromAt(old, t) {
  let o = old[0];
  for (const c of old) if (cs(c.start) <= t) o = c;
  return o;
}

// ── With heard words: retextLines over the words of every old line ──────────
function _heard(old, tx, S, E) {
  const words = [];
  const edges = [];                 // per old line with words: its edges and its first and last word's (hundredths)
  for (const c of old) {
    const base = cs(c.start) - S;
    let ws;
    if (isHeard(c)) ws = timedWords(c);
    else {
      if (!String(c.name || '').trim()) continue;
      const t = typedWords(c.name, c.dur);
      if (!t) return { why: T.t('The typed line «{line}» is too short to time its words by their letters', { line: _short(c.name) }) };
      ws = t.words.map((w) => ({ ...w, h: true }));
    }
    const list = ws.filter((w) => w && String(w.w || '').trim()).map((w) => ({ ...w, s: (base + cs(w.s)) / 100, e: (base + cs(w.e)) / 100 }));
    if (!list.length) continue;
    words.push(...list);
    edges.push({ c, start: base, end: base + cs(c.dur), first: cs(list[0].s), last: cs(list[list.length - 1].e) });
  }
  const r = retextLines(words, tx, (E - S) / 100);
  if (r.why) return r;
  if (r.remove) return { lines: [] };
  const groups = [];
  for (const w of r.words) {
    const g = groups.length && groups[groups.length - 1].ln === w.ln ? groups[groups.length - 1] : null;
    const x = { w: w.w, s: cs(w.s), e: cs(w.e) };
    if (w.k) x.k = true;
    if (w.h) x.h = true;
    if (g) g.ws.push(x); else groups.push({ ln: w.ln, ws: [x] });
  }
  for (const g of groups) {
    if (g.ws.length > LIMITS.words) return { why: WHY.words };
    if (textOf(g.ws).length > LIMITS.text) return { why: WHY.text };
  }
  const n = groups.length;
  const room = E - S;
  // Starts, then ends (an end that is not an old one waits for the next start).
  const st = groups.map((g, k) => {
    if (k === 0) return 0;
    const o = edges.find((x) => x.first === g.ws[0].s);
    return o ? o.start : g.ws[0].s;
  });
  for (let k = 1; k < n; k++) st[k] = Math.max(st[k], st[k - 1] + MINC);
  const en = groups.map((g, k) => {
    if (k === n - 1) return room;
    const last = g.ws[g.ws.length - 1].e;
    const o = edges.find((x) => x.last === last);
    const end = o ? o.end : (st[k + 1] - last < cs(PAGE.closeGap) ? st[k + 1] : last + cs(PAGE.hold));
    return Math.min(end, st[k + 1]);
  });
  for (let k = 0; k < n; k++) {
    if (en[k] - st[k] < MINC) en[k] = Math.min(k === n - 1 ? room : st[k + 1], st[k] + MINC);
    if (en[k] - st[k] < MINC || st[k] > room - MINC * (n - k)) return { why: WHY.room };
  }
  return { lines: groups.map((g, k) => {
    const dur = en[k] - st[k];
    const ws = g.ws.map((w) => {
      const o = { w: w.w, s: Math.max(0, w.s - st[k]) / 100, e: Math.max(0, w.e - st[k]) / 100 };
      // A word ends where its line does - except on the last line, whose words keep what they had (as retext keeps them).
      if (k < n - 1) { o.s = Math.min(o.s, dur / 100); o.e = Math.min(o.e, dur / 100); }
      if (w.k) o.k = true;
      if (w.h) o.h = true;
      return o;
    });
    return { start: S + st[k], end: S + en[k], name: textOf(ws), words: ws, from: _fromHeard(edges, old, g.ws) };
  }) };
}

// The old line a heard line carries on from: the one most of its words came from (a word belongs to the old line it
// lies in, by its start), the earlier on a tie - "three." carried onto the next line leaves that line the next line.
function _fromHeard(edges, old, ws) {
  const count = new Map();
  for (const w of ws) {
    let o = null;
    for (const x of edges) if (x.start <= w.s) o = x;
    if (o) count.set(o, (count.get(o) || 0) + 1);
  }
  let best = null;
  for (const x of edges) if (count.get(x) && (!best || count.get(x) > count.get(best))) best = x;
  return best ? best.c : old[0];
}

// ── The three gestures of the document ──────────────────────────────────────
/** Line `i` written as `text`. */
export const editLine = (track, i, text, makeId) => rewrite(track, i, i + 1, [text], makeId);

/**
 * Line `i` cut in two at character `at` of `text` - its text as it reads in the document now, typing and all (Enter).
 * The blanks at the cut go. A side with nothing on it is no cut: the line is only written.
 */
export function splitLine(track, i, text, at, makeId) {
  const t = String(text == null ? '' : text);
  const a = Math.max(0, Math.min(t.length, Math.round(+at || 0)));
  return rewrite(track, i, i + 1, [t.slice(0, a).replace(/\s+$/u, ''), t.slice(a).replace(/^\s+/u, '')], makeId);
}

/**
 * Line `i` and the next one as one (Delete at a line's end, Backspace at the next one's start). `text`: line i's text as
 * it reads now, typing and all; the next one's is its own.
 */
export function joinLines(track, i, text, makeId) {
  const lines = linesOf(track);
  if (i < 0 || i + 1 >= lines.length) return { why: T.t('The last line has no next line to join') };
  const a = String(text == null ? '' : text).replace(/\s+$/u, '');
  const b = textOfLine(lines[i + 1]).replace(/^\s+/u, '');
  return rewrite(track, i, i + 2, [a && b ? a + ' ' + b : a + b], makeId);
}

// ── Find and replace ────────────────────────────────────────────────────────
/**
 * What is looked for, as a pattern: the text as typed (nothing in it is special), `cased` - its case too, `whole` -
 * only where it is a word of its own (no letter, digit or _ touching it). Null for an empty search.
 */
export function matcher(query, opts) {
  const q = String(query == null ? '' : query);
  if (!q) return null;
  const o = opts || {};
  const esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const src = o.whole ? '(?<![\\p{L}\\p{N}_])' + esc + '(?![\\p{L}\\p{N}_])' : esc;
  return new RegExp(src, 'gu' + (o.cased ? '' : 'i'));
}

/** Where a pattern is found in a text: [[from, to], ...]. */
export function matchesIn(text, re) {
  if (!re) return [];
  const t = String(text == null ? '' : text);
  const out = [];
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(t))) {
    if (!m[0].length) { re.lastIndex++; continue; }
    out.push([m.index, m.index + m[0].length]);
  }
  return out;
}

/** The text with its matches replaced by `rep`, as typed - every one, or only match number `nth`. */
export function replaceIn(text, re, rep, nth) {
  const t = String(text == null ? '' : text);
  const hits = matchesIn(t, re);
  const pick = nth == null ? hits : hits.filter((_, i) => i === nth);
  let out = '', at = 0;
  for (const [a, b] of pick) { out += t.slice(at, a) + String(rep == null ? '' : rep); at = b; }
  return out + t.slice(at);
}
