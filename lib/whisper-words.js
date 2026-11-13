'use strict';

// ════════════════════════════════════════════════════════════════════════════
// WHAT WHISPER.CPP HEARD, in Groq's shape.
//
// whisper-cli -ojf writes tokens, not words. This turns them into what lib/captions-job.js already lays
// from Groq - { words: [{ word, start, end }], segments: [...], language } - so the lay, the re-cut and the
// editor never know which engine heard the sound. The rules were settled by a
// benchmark:
//
//   a word      a token whose text starts with a space starts one; everything else - punctuation, "-",
//               "%", the second half of a letter BPE split - is glued on, as Groq writes them ("well,",
//               "so-called", "99%"); a word of punctuation only is glued to the one before
//   its END     the t_dtw of its last token (DTW - whisper.cpp's moment is where the alignment path LEAVES
//               the token, OpenAI's own reading; read as a start it was 0.18 s late on every word)
//   its START   the end of the word before it in the same 30 s window; the first word of a window starts
//               at its segment. One point per token cannot tell where speech resumes after a pause - the
//               lay trims starts by the energy of the sound (lib/captions-job.js)
//   no DTW      (t_dtw -1: the run was repeated without it) the tokens' own offsets, marked approximate
//
// The raw tokens are kept beside the answer (`raw`, compact), so these rules can change without the
// program running again - the way Groq's answer is kept whole (lib/subs-store.js).
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const zlib = require('zlib');
const { HEARD } = require('./mv3b-subs');

const NORM_V = 2;                     // bump when the words are built differently from the same raw (it is in the signature)
const EOT = 50257;                    // tokens from here up are special: [_BEG_], [_TT_n], ...

/**
 * The -ojf file, read safely. The CLI escapes only " and \ (cli.cpp:521), so a control character inside a
 * token's text - a tab, a line break: BPE has tokens for both - would break the JSON. They are escaped
 * INSIDE string literals only; the file's own line breaks between values stay as they are.
 */
//
// READ AS BYTES. whisper.cpp writes a token's bytes as they are, and a letter of two or more bytes can be
// split between two tokens - and between two SEGMENTS, which it does not glue back. Decoded as UTF-8
// at once, both halves become U+FFFD. So the file is read one byte to one character (latin1), parsed, the bytes a
// token's last letter still needs are taken from the tokens after it - across the segment - and only then is every
// string decoded; a byte that belongs to no letter is dropped. A segment whose own text was split is written again
// from its tokens.
function readOjf(file) {
  const esc = (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0');
  const raw = fs.readFileSync(file).toString('latin1').replace(/"(?:[^"\\]|\\[\s\S])*"/g, (m) => m.replace(/[\u0000-\u001F]/g, esc));
  return _mend(JSON.parse(raw));
}

// How many continuation bytes the last letter of `b` still needs (0 when it is whole).
function _wants(b) {
  for (let i = b.length - 1, back = 0; i >= 0 && back < 4; i--, back++) {
    const x = b[i];
    if ((x & 0xC0) === 0x80) continue;                       // a continuation byte: look further back
    const len = x >= 0xF0 ? 4 : x >= 0xE0 ? 3 : x >= 0xC0 ? 2 : 1;
    return Math.max(0, len - 1 - back);
  }
  return 0;
}
const _utf8 = (s) => Buffer.from(String(s), 'latin1').toString('utf8').replace(/\uFFFD/g, '');
function _mend(doc) {
  const segs = Array.isArray(doc && doc.transcription) ? doc.transcription : [];
  const toks = [];
  for (const s of segs) for (const k of (s.tokens || [])) if (k && typeof k.text === 'string') toks.push(k);
  let fixed = 0;
  for (let i = 0; i < toks.length; i++) {
    let b = Buffer.from(toks[i].text, 'latin1');
    let need = _wants(b);
    for (let j = i + 1; need > 0 && j < toks.length; j++) {
      const nb = Buffer.from(toks[j].text, 'latin1');
      let take = 0;
      while (take < nb.length && take < need && (nb[take] & 0xC0) === 0x80) take++;
      if (!take) break;
      b = Buffer.concat([b, nb.subarray(0, take)]);
      toks[j].text = nb.subarray(take).toString('latin1');
      need -= take;
      fixed++;
      if (toks[j].text.length) break;
    }
    toks[i].text = b.toString('latin1');
  }
  for (const s of segs) {
    const whole = _utf8(s.text || '');
    const broken = Buffer.from(String(s.text || ''), 'latin1').toString('utf8').includes('\uFFFD');
    for (const k of (s.tokens || [])) if (k && typeof k.text === 'string') k.text = _utf8(k.text);
    s.text = (broken && (s.tokens || []).length)
      ? (s.tokens || []).filter(k => k && k.id < EOT).map(k => k.text).join('') : whole;
  }
  if (doc && doc.result && typeof doc.result.language === 'string') doc.result.language = _utf8(doc.result.language);
  if (fixed) console.log('[whisper] mended ' + fixed + ' letter(s) split between tokens');
  return doc;
}

/** Compact raw form: [{ from, to, text, t: [[text, id, p, t0, t1, dtw], ...] }] (ms, ms, cs). */
function compact(doc) {
  return (Array.isArray(doc && doc.transcription) ? doc.transcription : []).map((s) => ({
    from: s.offsets ? s.offsets.from : null, to: s.offsets ? s.offsets.to : null, text: String(s.text || ''),
    t: (s.tokens || []).map((k) => [String(k.text || ''), k.id, k.p, k.offsets ? k.offsets.from : null, k.offsets ? k.offsets.to : null,
      typeof k.t_dtw === 'number' ? k.t_dtw : -1]),
  }));
}

const r2 = (v) => Math.round(v * 100) / 100;

// THE 30 s WINDOW each segment was decoded in. A segment opening with a timestamp token starts one - but
// not always: a window whose first timestamp is not zero closes an empty segment of its own and its first
// segment opens with text (whisper.cpp ~7768). So the window is also told by its SEEK: a segment ending
// with [_TT_n] at `to` ms was decoded in the window that starts at to/10 - 2n centiseconds.
function _windows(raw) {
  const out = [];
  let win = 0, seek = null;
  raw.forEach((s, si) => {
    const last = s.t[s.t.length - 1];
    const m = last && last[1] >= EOT && /^\[_TT_(\d+)\]$/.exec(last[0]);
    const sk = m && s.to != null ? Math.round(s.to / 10) - 2 * +m[1] : null;
    const opens = s.t.length && s.t[0][1] >= EOT && /^\[_(BEG|TT_)/.test(s.t[0][0]);
    if (si > 0 && (opens || (sk != null && seek != null && sk !== seek))) win++;
    if (sk != null) seek = sk;
    out.push(win);
  });
  return out;
}

// Languages written without spaces: a word per token, as OpenAI's word timestamps split them.
const NO_SPACES = new Set(['zh', 'ja', 'th', 'lo', 'my', 'yue']);

// Words with their tokens, in order, and the window each was heard in.
function _wordsOf(raw, lang) {
  const out = [];
  const wins = _windows(raw);
  const perToken = NO_SPACES.has(String(lang || ''));
  raw.forEach((s, si) => {
    const win = wins[si];
    let cur = null;
    for (const k of s.t) {
      if (!(k[1] < EOT)) continue;
      if (perToken || /^\s/.test(k[0]) || !cur) {
        if (cur) out.push(cur);
        cur = { text: '', toks: [], seg: si, win, from: s.from, to: s.to };
      }
      cur.text += k[0];
      cur.toks.push(k);
    }
    if (cur) out.push(cur);
  });
  const glued = [];
  for (const w of out) {
    const text = w.text.trim();
    if (!text) continue;
    const prev = glued[glued.length - 1];
    // Punctuation alone is never a word: glued to the word before - its timing only within one segment,
    // a segment opening with "..." or "-" does not stretch the word before it over the gap.
    if (prev && !/[\p{L}\p{N}]/u.test(text)) { prev.text += text; if (prev.seg === w.seg) prev.toks = prev.toks.concat(w.toks); continue; }
    glued.push({ ...w, text });
  }
  return glued;
}

/**
 * The words in Groq's shape, seconds from the start of the piece that was heard.
 * @returns { words, timing: 'dtw' | 'approximate' }
 */
function wordsOf(raw, lang) {
  const ws = _wordsOf(raw, lang);
  // No words is not "approximate": nothing was timed at all.
  const dtw = ws.every((w) => w.toks[w.toks.length - 1][5] >= 0);
  const words = [];
  ws.forEach((w, i) => {
    let start, end;
    if (dtw) {
      end = w.toks[w.toks.length - 1][5] / 100;
      const prev = words[words.length - 1];
      start = (prev && ws[i - 1].win === w.win) ? prev.end : (w.from != null ? w.from / 1000 : end);
    } else {
      const a = w.toks.find((k) => k[3] != null), b = [...w.toks].reverse().find((k) => k[4] != null);
      start = a ? a[3] / 1000 : (w.from || 0) / 1000;
      end = b ? b[4] / 1000 : (w.to || 0) / 1000;
    }
    words.push({ word: w.text, start, end: Math.max(end, start) });
  });
  // OpenAI's length caps: a word longer than twice the median (the median at most 0.7 s) started too
  // early - it swallowed a pause - and starts at end - max instead.
  const lens = words.map((w) => w.end - w.start).filter((d) => d > 0).sort((a, b) => a - b);
  const max = 2 * Math.min(0.7, lens.length ? lens[Math.floor(lens.length / 2)] : 0.3);
  for (const w of words) if (w.end - w.start > max) w.start = w.end - max;
  return { words: words.map((w) => ({ word: w.word, start: r2(w.start), end: r2(w.end) })), timing: dtw ? 'dtw' : 'approximate' };
}

/**
 * Segments as Groq gives them; no_speech_prob is not in -ojf (whisper.cpp drops silent windows itself).
 * compression_ratio is the WINDOW's, as OpenAI and Groq give it: whisper.cpp ends a segment at every
 * timestamp, so a loop comes out one repeat per segment, and a short segment never compresses past 2.4.
 */
function segmentsOf(raw) {
  const wins = _windows(raw);
  const ratio = new Map();
  wins.forEach((w, i) => ratio.set(w, (ratio.get(w) || '') + raw[i].text));
  for (const [w, text] of ratio) {
    const bytes = Buffer.byteLength(text, 'utf8');
    ratio.set(w, bytes ? bytes / zlib.deflateSync(Buffer.from(text, 'utf8')).length : null);
  }
  return raw.map((s, i) => {
    const toks = s.t.filter((k) => k[1] < EOT && k[2] > 0);
    return { start: (s.from || 0) / 1000, end: (s.to || 0) / 1000, text: s.text,
      avg_logprob: toks.length ? toks.reduce((a, k) => a + Math.log(k[2]), 0) / (toks.length + 1) : null,
      compression_ratio: ratio.get(wins[i]), no_speech_prob: null };
  });
}

const _LANG = new Map(HEARD.LANGS.map(([k, label]) => [k, label]));
/** "ru" -> "Russian", the way Groq names it; a code we do not list stays a code. */
const languageOf = (code) => _LANG.get(String(code || '')) || (code ? String(code) : null);

/** The whole answer from a -ojf document: Groq's shape plus what it came from. */
function answerOf(doc, seconds) {
  const raw = compact(doc);
  const { words, timing } = wordsOf(raw, doc && doc.result && doc.result.language);
  return { answer: { text: raw.map((s) => s.text).join('').trim(), language: languageOf(doc && doc.result && doc.result.language),
    duration: seconds, words, segments: segmentsOf(raw) }, raw, norm: NORM_V, timing };
}

module.exports = { readOjf, compact, wordsOf, segmentsOf, languageOf, answerOf, NORM_V };
