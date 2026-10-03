/* ═══════════════════════════════════════════════════════════════════════════
   CAPTIONS — a heard line's WORDS, and the text a person writes over them (phase K10a, 2026-10-03).

   A heard caption carries its words: { w, s, e, k?, h? } - the word as shown, its start and end in
   seconds from the caption's start, `k` "make this word stand out", `h` a word a person changed,
   inserted, cut, joined or moved (the editor writes it; the server never does). The words are drawn
   only while they SPELL the caption's text (spells) - so every change writes the words and the text
   together, and a line whose words no longer spell its text (a line rewritten before K10) is timed
   again (retext) before anything cuts it.

   A line a person has touched is CORRECTED (isCorrected): Generate from the sound keeps it as it is,
   as it keeps a typed line, and "back to what was heard" takes it back to what was heard.

   retext() keeps the timing when the text is rewritten. The old words and the new ones are matched by
   their letters (Levenshtein over whole words; a word's key is its letters and digits in lower case,
   ё read as е):
     - a word that stays keeps its moment (a new spelling of it - case, a mark - too);
     - a word spelled differently in the same place keeps the moment of its place ("хера" -> "хрена");
     - new words share the stretch of the words they replace by "letters + 2" (measured on the owner's
       4200 heard words: closer than equal shares and than syllables, a median miss of 0.04-0.05 s);
     - a word put where nothing was said goes into the pause beside it, 0.04 s per "letter + 2";
     - a word taken out leaves a pause;
     - a mark with no letter put in ("—", "...") goes with the word before it: it takes no time to say. One
       that was a word of its own (Whisper hears dashes so) is matched to that word, as any word is.
   No word is shorter than 0.06 s: where a stretch is too short for what is put into it, the words
   beside it share theirs; where the whole line is too short, the change is refused in words.

   The word editor's operations (K10b) are here too, PURE: each returns { words, name } - the new words
   and the text they spell - or { why } when it cannot be done, decided before anything is changed, or
   { remove: true } when no word is left. Limits on every one: 200 words, 60 characters a word, 400 the
   text.

   Imports nothing: the server require()s the caption modules (lib/mv3b-subs.js), and this one is
   imported by pages.js and ass.js - an import back would close a loop.
   ═══════════════════════════════════════════════════════════════════════════ */

export const LIMITS = { words: 200, word: 60, text: 400 };
/** The shortest a word is made (seconds). */
export const WORD_MIN = 0.06;
// Seconds a word put into a pause takes per "letter + 2": a five-letter word is 0.28 s.
const PER = 0.04;

// Times are worked in hundredths (whole numbers) and handed back as seconds to 0.01 s.
const cs = (t) => Math.round((+t || 0) * 100);
const MINC = Math.round(WORD_MIN * 100);

/**
 * A typed text's words: split where a line MAY break - never at a no-break space ("50 000", "Иван
 * Петрович" typed with one), which stays inside its word, as libass keeps it (review K2).
 */
export const tokensOf = (text) => String(text == null ? '' : text).split(/[^\S   ]+/).filter(Boolean);

/** What a word is matched by: its letters and digits, lower case, ё as е ("Ещё," and "еще" are one word). */
export const keyOf = (t) => String(t == null ? '' : t).toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, '');

// What the drawing compares (unchanged since K0): lower case, anything but letters and digits a space.
const _norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Do these words spell this text? Only then are they drawn one by one (ass.js, subs-b.js). */
export function spells(words, text) {
  if (!Array.isArray(words) || !words.length) return false;
  return _norm(words.map((x) => (x && x.w != null ? x.w : '')).join(' ')) === _norm(text);
}

/** A heard line a person has touched: a word marked `h`, or words that no longer spell its text. */
export function isCorrected(c) {
  const w = c && c.words;
  if (!Array.isArray(w) || !w.length) return false;
  return w.some((x) => x && x.h) || !spells(w, c.name);
}

/** The text a line's words spell. */
export const textOf = (words) => (words || []).map((w) => w.w).join(' ');

/**
 * The words a person wrote: split as a line breaks - except that a run which was ONE word of the line before
 * (`old`: "than $2.", "хера —", a word holding a space) stays one word.
 */
export function wordsIn(text, old) {
  const toks = tokensOf(text);
  const runs = [];
  for (const w of (old || [])) {
    const parts = tokensOf(w && w.w);
    if (parts.length > 1 && !runs.some((r) => r.join(' ') === parts.join(' '))) runs.push(parts);
  }
  if (!runs.length) return toks;
  runs.sort((a, b) => b.length - a.length);
  const out = [];
  for (let i = 0; i < toks.length; i++) {
    const r = runs.find((p) => p.every((x, k) => toks[i + k] === x));
    if (r) { out.push(r.join(' ')); i += r.length - 1; } else out.push(toks[i]);
  }
  return out;
}

// A mark with no letter in it ("—", "...") put in by the person: it goes with the word before it (or, first,
// the word after) - a dash is not a word that takes time to say. A text of marks alone is one word.
function _glue(toks) {
  if (!toks.some((t) => keyOf(t))) return toks.length ? [toks.join(' ')] : [];
  const out = [];
  let lead = '';
  for (const t of toks) {
    if (keyOf(t)) { out.push(lead ? lead + ' ' + t : t); lead = ''; } else if (out.length) out[out.length - 1] += ' ' + t;
    else lead = lead ? lead + ' ' + t : t;
  }
  return out;
}

/**
 * How alike two texts are by their letters, 0..1 - one less the edit distance of their keys over the longer
 * one ("You get an erection" against what was heard, "you get an ER action": 0.88). What Generate asks of a
 * line a person corrected: below one half, it no longer matches the sound under it.
 */
export function likeness(a, b) {
  const x = keyOf(a).slice(0, 400), y = keyOf(b).slice(0, 400);
  if (!x.length && !y.length) return 1;
  let row = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const next = [i];
    for (let j = 1; j <= y.length; j++) {
      next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    row = next;
  }
  return 1 - row[y.length] / Math.max(x.length, y.length);
}

/** How many words of a line a person has corrected (those of a line rewritten before K10 counted as retext would). */
export function correctedCount(c) {
  const w = c && c.words;
  if (!Array.isArray(w) || !w.length) return 0;
  const list = spells(w, c.name) ? w : (retext(w, c.name, c.dur).words || []);
  return list.filter((x) => x && x.h).length;
}

// ── Internals ───────────────────────────────────────────────────────────────
const weight = (t) => (String(t).match(/[\p{L}\p{N}]/gu) || []).length + 2;

// A word as stored: the fields it may have and nothing else.
function _word(x) {
  const o = { w: String(x.w), s: +x.s || 0, e: +x.e || 0 };
  if (x.k) o.k = true;
  if (x.h) o.h = true;
  return o;
}
const _copy = (words) => (Array.isArray(words) ? words : []).filter((w) => w && w.w != null).map(_word);
const _done = (words) => ({ words, name: textOf(words) });

function _limits(toks, total) {
  if (total > LIMITS.words) return { why: 'A line holds at most ' + LIMITS.words + ' words' };
  const long = toks.find((t) => String(t).length > LIMITS.word);
  if (long) return { why: 'A word holds at most ' + LIMITS.word + ' characters' };
  return null;
}

/**
 * Words laid over [from, to] (hundredths) by "letters + 2", each at least WORD_MIN - by plain shares while
 * every share is long enough, otherwise WORD_MIN each and the rest by shares. Whole hundredths, the
 * remainders given to the largest fractions, so the stretch is filled exactly. `toks`: [{ w, k?, h? }].
 */
function _share(toks, from, to) {
  const n = toks.length;
  const wt = toks.map((t) => weight(t.w));
  const W = wt.reduce((a, b) => a + b, 0);
  const deal = (room) => {
    const raw = wt.map((x) => room * x / W);
    const got = raw.map(Math.floor);
    const left = room - got.reduce((a, b) => a + b, 0);
    const order = raw.map((r, i) => [r - got[i], i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
    for (let k = 0; k < left; k++) got[order[k][1]]++;
    return got;
  };
  let len = deal(to - from);
  if (len.some((x) => x < MINC)) len = deal(to - from - MINC * n).map((x) => x + MINC);
  let at = from;
  return toks.map((t, i) => {
    const o = { w: String(t.w), s: at / 100, e: (at + len[i]) / 100 };
    at += len[i];
    if (t.k) o.k = true;
    if (t.h) o.h = true;
    return o;
  });
}

/**
 * The line's words, some of them still to be timed. `seq`: words (timed) and groups { group: true, toks,
 * mode, a, b } - 'span': the new words of a stretch [a, b] (hundredths) they replace, 'gap': words put where
 * nothing was. A group takes its own stretch, or that and the pauses beside it; with no room there, the
 * words beside it share theirs - their own time first, then the pauses past them - one more on each side
 * at a time. @returns the timed words, or null: no room in the line.
 */
function _place(seq, end) {
  const out = [];
  let i = 0;
  while (i < seq.length) {
    const x = seq[i];
    if (!x.group) { out.push(x); i++; continue; }
    let toks = x.toks.slice();
    let j = i + 1;
    let gap = x.mode === 'gap';
    // The group's own stretch; null on a side where it has none (a word put into a pause).
    let lo = gap ? null : x.a, hi = gap ? null : x.b;
    for (;;) {
      // Two groups side by side are one (the callers keep a word between them; this is the safety).
      while (j < seq.length && seq[j].group) { toks = toks.concat(seq[j].toks); j++; gap = false; hi = null; }
      const prev = out.length ? out[out.length - 1] : null;
      const next = j < seq.length ? seq[j] : null;
      const L = prev ? cs(prev.e) : 0;
      const R = next ? cs(next.s) : Math.max(end, L);
      const need = MINC * toks.length;
      let win = null;
      if (gap) {
        if (R - L >= need) {
          const want = Math.max(need, Math.round(toks.reduce((s, t) => s + weight(t.w), 0) * PER * 100));
          win = prev ? [L, Math.min(R, L + want)] : [Math.max(L, R - want), R];
        }
      } else {
        const a = lo == null ? L : Math.max(L, lo), b = hi == null ? R : Math.min(R, hi);
        if (b - a >= need) win = [a, b];
        else if (R - L >= need) win = [L, R];
      }
      if (win) { out.push(..._share(toks, win[0], win[1])); i = j; break; }
      // No room: the words beside it share their time with the new ones (and keep their own text and marks).
      let took = false;
      if (prev) { out.pop(); toks.unshift(prev); lo = cs(prev.s); took = true; }
      if (next) { toks.push(next); j++; hi = Math.max(cs(next.s), cs(next.e)); took = true; }
      if (!took) return null;
      gap = false;
    }
  }
  return out;
}

const _noRoom = (words, end) => ({ why: 'No room for that many words: they need ' + (MINC * words / 100).toFixed(2)
  + ' s at least, the line is ' + (end / 100).toFixed(2) + ' s - make it longer first' });

// Where a line ends for the words in it: its length, or its last word's end when that runs past it.
const _endOf = (ws, dur) => Math.max(cs(dur), ...ws.map((w) => cs(w.e)), 0);

// Levenshtein over the keys, walked back from the end with an equal pair taken first: matched words stay
// together. [op, old index, new index] in order - '=' the same word, '~' another in its place, '-' gone, '+' new.
function _align(a, b) {
  const n = a.length, m = b.length;
  const D = Array.from({ length: n + 1 }, (_, i) => {
    const row = new Array(m + 1).fill(0);
    row[0] = i;
    return row;
  });
  for (let j = 0; j <= m; j++) D[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      D[i][j] = Math.min(D[i - 1][j] + 1, D[i][j - 1] + 1, D[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  const ops = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1] && D[i][j] === D[i - 1][j - 1]) { ops.push(['=', i - 1, j - 1]); i--; j--; continue; }
    if (i > 0 && D[i][j] === D[i - 1][j] + 1) { ops.push(['-', i - 1, -1]); i--; continue; }
    if (j > 0 && D[i][j] === D[i][j - 1] + 1) { ops.push(['+', -1, j - 1]); j--; continue; }
    ops.push(['~', i - 1, j - 1]);
    i--;
    j--;
  }
  return ops.reverse();
}

// ── Rewriting the text ──────────────────────────────────────────────────────
/**
 * The line's words for a new text (see the header). `dur` is the line's length (seconds).
 * @returns { words, name } | { why } | { remove: true } (the text is empty)
 */
export function retext(words, text, dur) {
  const t = String(text == null ? '' : text);
  if (t.length > LIMITS.text) return { why: 'A line holds at most ' + LIMITS.text + ' characters' };
  const ws = _copy(words);
  const nt = wordsIn(t, ws);
  if (!nt.length) return { remove: true };
  const bad = _limits(nt, nt.length);
  if (bad) return bad;
  const end = _endOf(ws, dur);
  if (!ws.length) {
    const g = _glue(nt);
    if (end < MINC * g.length) return _noRoom(g.length, end);
    return _done(_share(g.map((w) => ({ w, h: true })), 0, end));
  }
  // A text of marks alone ("...") is a word; otherwise a mark put in goes with a word (_glue's rule). A mark
  // that was a word of its own before ("—" as Whisper heard it) is matched to that word and keeps its time.
  const marksOnly = !nt.some((x) => keyOf(x));
  const timed = (x) => marksOnly || !!keyOf(x);

  const ops = _align(ws.map((w) => keyOf(w.w)), nt.map(keyOf));
  const seq = [];
  let lead = '';                                             // marks before any word: they go on the next one
  // An old word with new text is touched when its text is not what it was (case, a mark - any touch).
  const touch = (x) => { if (x.o != null) x.h = !!(x.hh || ws[x.o].h || x.w !== ws[x.o].w); };
  const withLead = (w) => { if (!lead) return w; const x = lead + ' ' + w; lead = ''; return x; };
  const glue = (mark) => {
    const last = seq[seq.length - 1];
    if (!last) { lead = lead ? lead + ' ' + mark : mark; return; }
    if (last.group) { last.toks[last.toks.length - 1].w += ' ' + mark; return; }
    last.w += ' ' + mark;
    touch(last);
  };
  let blk = { o: [], n: [] };
  const flush = () => {
    const { o, n } = blk;
    blk = { o: [], n: [] };
    const real = [];
    for (const j of n) {
      if (!timed(nt[j])) { if (real.length) real[real.length - 1] += ' ' + nt[j]; else glue(nt[j]); continue; }
      real.push(real.length ? nt[j] : withLead(nt[j]));
    }
    if (!real.length) return;                                // taken out: a pause
    if (o.length === real.length) {                          // another word in each place: its moment
      o.forEach((i, x) => { const e = { ...ws[i], w: real[x], o: i, hh: true }; touch(e); seq.push(e); });
      return;
    }
    if (!o.length) {                                         // put where nothing was said
      seq.push({ group: true, mode: 'gap', toks: real.map((w) => ({ w, h: true })) });
      return;
    }
    // Other words for these: their stretch, shared; a marked word's mark goes to the new word at its place.
    const a = cs(ws[o[0]].s), b = Math.max(a, cs(ws[o[o.length - 1]].e));
    const W = real.reduce((sum, w) => sum + weight(w), 0);
    const marks = o.filter((i) => ws[i].k).map((i) => (b > a ? ((cs(ws[i].s) + cs(ws[i].e)) / 2 - a) / (b - a) : 0));
    let acc = 0;
    const toks = real.map((w) => {
      const lo = acc / W;
      acc += weight(w);
      const hi = acc / W;
      const tk = { w, h: true };
      if (marks.some((f) => f >= lo && (f < hi || hi >= 1))) tk.k = true;
      return tk;
    });
    seq.push({ group: true, mode: 'span', a, b, toks });
  };
  for (const [op, i, j] of ops) {
    if (op !== '=') {
      if (i >= 0) blk.o.push(i);
      if (j >= 0) blk.n.push(j);
      continue;
    }
    flush();
    const e = { ...ws[i], w: withLead(nt[j]), o: i };       // the same word: its moment
    touch(e);
    seq.push(e);
  }
  flush();
  const out = _place(seq, end);
  if (!out) return _noRoom(seq.reduce((n, x) => n + (x.group ? x.toks.length : 1), 0), end);
  return _done(out.map(_word));
}

// ── The word editor's operations (K10b) ─────────────────────────────────────
const _at = (ws, i) => (Number.isInteger(i) && i >= 0 && i < ws.length ? ws[i] : null);
const NO_WORD = { why: 'There is no such word in this line' };

/** Word `i` written as `text` - two words when it has a space (a mark goes with a word); nothing removes it. */
export function replaceAt(words, i, text, dur) {
  const ws = _copy(words);
  const w = _at(ws, i);
  if (!w) return NO_WORD;
  const nt = _glue(wordsIn(text));
  if (!nt.length) return removeAt(words, i);
  const bad = _limits(nt, ws.length - 1 + nt.length);
  if (bad) return bad;
  if (nt.length === 1) {
    if (nt[0] === w.w) return _done(ws);
    ws[i] = { ...w, w: nt[0], h: true };
    return _done(ws);
  }
  const seq = ws.slice();
  seq.splice(i, 1, { group: true, mode: 'span', a: cs(w.s), b: Math.max(cs(w.s), cs(w.e)),
    toks: nt.map((x) => (w.k ? { w: x, h: true, k: true } : { w: x, h: true })) });
  const end = _endOf(ws, dur);
  const out = _place(seq, end);
  return out ? _done(out.map(_word)) : _noRoom(ws.length - 1 + nt.length, end);
}

/**
 * Words put before word `i` (`i` = the number of words: after the last), into the pause there. Marks alone
 * ("—") are not a word: they go on the word before (or, first, the word after).
 */
export function insertAt(words, i, text, dur) {
  const ws = _copy(words);
  if (!(Number.isInteger(i) && i >= 0 && i <= ws.length)) return NO_WORD;
  const raw = wordsIn(text);
  if (!raw.length) return { why: 'Nothing to put in' };
  if (ws.length && !raw.some((x) => keyOf(x))) {
    const m = raw.join(' ');
    const at = i > 0 ? i - 1 : 0;
    const w = ws[at].w + ' ' + m;
    const next = i > 0 ? w : m + ' ' + ws[0].w;
    if (next.length > LIMITS.word) return { why: 'A word holds at most ' + LIMITS.word + ' characters' };
    ws[at] = { ...ws[at], w: next, h: true };
    return _done(ws);
  }
  const nt = _glue(raw);
  const bad = _limits(nt, ws.length + nt.length);
  if (bad) return bad;
  const seq = ws.slice();
  seq.splice(i, 0, { group: true, mode: 'gap', toks: nt.map((x) => ({ w: x, h: true })) });
  const end = _endOf(ws, dur);
  const out = _place(seq, end);
  return out ? _done(out.map(_word)) : _noRoom(ws.length + nt.length, end);
}

/** Word `i` taken out; its time becomes a pause. The last word of a line takes the line with it. */
export function removeAt(words, i) {
  const ws = _copy(words);
  if (!_at(ws, i)) return NO_WORD;
  if (ws.length === 1) return { remove: true };
  ws.splice(i, 1);
  return _done(ws);
}

/** Word `i` and the next one made one word ("эфо" + "ризм"), over the time of both. */
export function joinAt(words, i) {
  const ws = _copy(words);
  const a = _at(ws, i), b = _at(ws, i + 1);
  if (!a) return NO_WORD;
  if (!b) return { why: 'The last word has no next word to join' };
  const w = a.w + b.w;
  if (w.length > LIMITS.word) return { why: 'A word holds at most ' + LIMITS.word + ' characters' };
  const o = { w, s: a.s, e: Math.max(a.e, b.e), h: true };
  if (a.k || b.k) o.k = true;
  ws.splice(i, 2, o);
  return _done(ws);
}

/**
 * Word `i` cut in two at the moment `at` (seconds from the line's start), its letters at `pos` - or, not
 * given, where its time is cut (at a space inside it, when it has one). Without `at`, the time is cut where
 * its letters are. Each half keeps at least WORD_MIN.
 */
export function cutAt(words, i, at, pos) {
  const ws = _copy(words);
  const w = _at(ws, i);
  if (!w) return NO_WORD;
  const txt = w.w;
  if (txt.length < 2) return { why: 'A word of one letter cannot be cut' };
  const S = cs(w.s), E = Math.max(cs(w.s), cs(w.e));
  let p = Number.isInteger(pos) ? pos : null;
  let T = at == null ? null : cs(at);
  if (p == null) {
    const f = T == null ? 0.5 : (E > S ? (T - S) / (E - S) : 0.5);
    p = Math.round(txt.length * f);
    const sp = [...txt.matchAll(/\s+/g)].map((m) => m.index);
    if (sp.length) p = sp.reduce((best, x) => (Math.abs(x - p) < Math.abs(best - p) ? x : best), sp[0]);
  }
  p = Math.max(1, Math.min(txt.length - 1, p));
  const left = txt.slice(0, p).trim(), right = txt.slice(p).trim();
  if (!left || !right) return { why: 'Nothing would be left on one side of the cut' };
  if (T == null) T = S + Math.round((E - S) * weight(left) / (weight(left) + weight(right)));
  if (T - S < MINC || E - T < MINC) return { why: 'Too close to the edge of the word - each half needs ' + WORD_MIN + ' s' };
  const bad = _limits([left, right], ws.length + 1);
  if (bad) return bad;
  const a = { w: left, s: w.s, e: T / 100, h: true }, b = { w: right, s: T / 100, e: w.e, h: true };
  if (w.k) { a.k = true; b.k = true; }
  ws.splice(i, 1, a, b);
  return _done(ws);
}

/** Word `i` made to stand out (`on`), or not - a look, not a correction. */
export function markAt(words, i, on) {
  const ws = _copy(words);
  const w = _at(ws, i);
  if (!w) return NO_WORD;
  if (on) w.k = true; else delete w.k;
  return _done(ws);
}

/**
 * Word `i`'s start ('s') or end ('e') moved to `t` (seconds from the line's start). A boundary the word
 * shares with its neighbour (touching, or overlapping) moves both - unless `alone` (Alt): then only this
 * word's edge moves, never over its neighbour. Nothing goes past the line's edges; no word is left shorter
 * than WORD_MIN. `dur` is the line's length.
 */
export function edgeAt(words, i, side, t, dur, alone) {
  const ws = _copy(words);
  const w = _at(ws, i);
  if (!w) return NO_WORD;
  const end = _endOf(ws, dur);
  const S = cs(w.s), E = Math.max(cs(w.s), cs(w.e));
  let T = cs(t);
  if (side === 's') {
    const p = _at(ws, i - 1);
    const shared = !!p && !alone && cs(p.e) >= S - 1;
    const lo = p ? (shared ? cs(p.s) + MINC : Math.min(cs(p.e), S)) : 0;
    const hi = E - MINC;
    if (lo > hi) return _done(ws);                          // two words too short to move between
    T = Math.max(lo, Math.min(hi, T));
    if (T === S && !(shared && cs(p.e) !== S)) return _done(ws);
    w.s = T / 100;
    w.h = true;
    if (shared) { p.e = T / 100; p.h = true; }
  } else if (side === 'e') {
    const n = _at(ws, i + 1);
    const shared = !!n && !alone && cs(n.s) <= E + 1;
    const lo = S + MINC;
    const hi = n ? (shared ? Math.max(cs(n.s), cs(n.e)) - MINC : Math.max(cs(n.s), E)) : Math.max(end, E);
    if (lo > hi) return _done(ws);
    T = Math.min(hi, Math.max(lo, T));
    if (T === E && !(shared && cs(n.s) !== E)) return _done(ws);
    w.e = T / 100;
    w.h = true;
    if (shared) { n.s = T / 100; n.h = true; }
  } else return { why: 'A word has a start and an end' };
  return _done(ws);
}
