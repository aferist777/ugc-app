'use strict';

/* broll-plan.js - THE B-ROLL ENGINE'S ARITHMETIC. Pure functions: no files,
   no requests - the engine (lib/broll.js) hands them the words and lays what they answer.

   SENTENCES (each gets its own keywords from the agent and its own batch of media, laid on the timeline at random): a line's
   words - with their moments on the timeline, from its caption pages -
   are cut where a word ends a sentence (. ? ! …, a closing quote or bracket after them allowed). Each sentence holds the time from
   its first word to the next sentence's first word, so the B-roll runs edge to edge: the first one from the start of the voice,
   the last one to its end.

   PIECES: a sentence shorter than PIECE_ONE seconds is one
   piece; a longer one is cut into round(length / PIECE) pieces, each cut moved to the start of the nearest word - to one right
   after a comma when there is one within COMMA_REACH of the even cut. */

const PIECE = 2.5;           // the length aimed at, seconds
const PIECE_ONE = 3.5;       // under this a sentence is one piece
const PIECE_MIN = 1.2;       // no piece shorter than this - a cut that would make one is dropped
const COMMA_REACH = 0.7;     // how far from the even cut a comma may pull it, seconds

const r3 = (x) => Math.round(x * 1000) / 1000;
// A word that ends a sentence: its last letters followed by . ? ! or … (and maybe a closing quote / bracket).
const ENDS = /[.?!…]["'»”’)\]]*$/;
const COMMA = /[,;:—–-]["'»”’)\]]*$/;

/**
 * The script's sentences, in order.
 * @param lines [{ line, from, to, words: [{ text, start, end }] }] - each spoken line's span on the timeline (its cell) and its
 *   words with timeline moments, in order; lines without words are left out (nothing to say about them)
 * @returns [{ line, k, text, from, to, words }] - `k` the sentence's number within its line, `from`/`to` its span, edge to edge
 */
function sentencesOf(lines) {
  const out = [];
  for (const L of (lines || [])) {
    const words = (L.words || []).filter(w => w && String(w.text || '').trim() && Number.isFinite(+w.start));
    if (!words.length) continue;
    let cur = [];
    let k = 0;
    const flush = () => {
      if (!cur.length) return;
      out.push({ line: L.line, k: k++, text: cur.map(w => String(w.text).trim()).join(' '), from: +cur[0].start, to: +cur[cur.length - 1].end || +cur[cur.length - 1].start, words: cur, lineFrom: +L.from, lineTo: +L.to });
      cur = [];
    };
    for (const w of words) {
      cur.push(w);
      if (ENDS.test(String(w.text).trim())) flush();
    }
    flush();
  }
  // Edge to edge: each sentence runs to the next one's first word; the first starts with its line's cell, the last ends with
  // its line's cell - so the voice is covered from its first moment to its last.
  for (let i = 0; i < out.length; i++) {
    const s = out[i];
    if (i === 0) s.from = Math.min(s.from, s.lineFrom);
    const next = out[i + 1];
    s.to = next ? Math.max(s.from + 0.1, next.from) : Math.max(s.to, s.lineTo);
    s.from = r3(s.from);
    s.to = r3(s.to);
  }
  return out;
}

/**
 * The pieces of one sentence - where the cuts fall.
 * @returns [{ from, to }] covering the sentence's span exactly
 */
function piecesOf(s) {
  const from = +s.from, to = +s.to, len = to - from;
  if (!(len > 0)) return [];
  if (len < PIECE_ONE) return [{ from: r3(from), to: r3(to) }];
  const n = Math.max(1, Math.round(len / PIECE));
  // The moments a cut may go: the start of every word but the first, and whether the word before it ends on a comma.
  const words = s.words || [];
  const at = [];
  for (let i = 1; i < words.length; i++) {
    const t = +words[i].start;
    if (t > from + PIECE_MIN && t < to - PIECE_MIN) at.push({ t, comma: COMMA.test(String(words[i - 1].text).trim()) });
  }
  const cuts = [];
  for (let j = 1; j < n; j++) {
    const even = from + (len * j) / n;
    const near = at.filter(c => Math.abs(c.t - even) <= COMMA_REACH && c.comma);
    const pick = near.length ? near : at;
    let best = pick.length ? pick.reduce((a, c) => (Math.abs(c.t - even) < Math.abs(a.t - even) ? c : a)).t : even;
    const prev = cuts.length ? cuts[cuts.length - 1] : from;
    if (best - prev < PIECE_MIN || to - best < PIECE_MIN) best = even;
    if (best - prev >= PIECE_MIN && to - best >= PIECE_MIN) cuts.push(best);
  }
  const edges = [from, ...cuts, to];
  const out = [];
  for (let i = 0; i < edges.length - 1; i++) out.push({ from: r3(edges[i]), to: r3(edges[i + 1]) });
  return out;
}

/**
 * Which of a sentence's batch stands in each piece: at random, none twice in the sentence while the batch lasts, and the first
 * not the one the sentence before ended on. Pieces already filled (`keep`, by index) stay.
 * @param batch [{ id, kind }]  @param mode 'mixed' | 'video' | 'image'  @param n pieces  @param keep [id|null]  @param before id
 * @param rnd () => [0, 1)
 */
function dealOf(batch, mode, n, keep, before, rnd) {
  const R = rnd || Math.random;
  const pool = (batch || []).filter(b => b && (mode === 'video' ? b.kind === 'video' : mode === 'image' ? b.kind === 'image' : true));
  const out = [];
  const used = new Set((keep || []).filter(Boolean));
  for (let i = 0; i < n; i++) {
    const k = keep && keep[i];
    if (k) { out.push(k); continue; }
    let free = pool.filter(b => !used.has(b.id) && b.id !== (i ? out[i - 1] : before));
    if (!free.length) free = pool.filter(b => b.id !== (i ? out[i - 1] : before));
    if (!free.length) free = pool;
    if (!free.length) { out.push(null); continue; }
    const b = free[Math.floor(R() * free.length)];
    out.push(b.id);
    used.add(b.id);
  }
  return out;
}

module.exports = { PIECE, PIECE_ONE, PIECE_MIN, sentencesOf, piecesOf, dealOf };
