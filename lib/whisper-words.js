'use strict';

// ════════════════════════════════════════════════════════════════════════════
// WHAT WHISPER.CPP HEARD, in Groq's shape (phase K1b, 2026-10-03).
//
// whisper-cli -ojf writes tokens, not words. This turns them into what lib/captions-job.js already lays
// from Groq - { words: [{ word, start, end }], segments: [...], language } - so the lay, the re-cut and the
// editor never know which engine heard the sound. The rules were settled by the benchmark on this
// computer (docs/local-app/PLAN.md, K1b "Замер"):
//
//   a word      a token whose text starts with a space starts one; everything else - punctuation, "-",
//               "%", the second half of a letter BPE split - is glued on, as Groq writes them ("решил,",
//               "какое-то", "99%"); a word of punctuation only is glued to the one before
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

const NORM_V = 1;                     // bump when the words are built differently from the same raw
const EOT = 50257;                    // tokens from here up are special: [_BEG_], [_TT_n], ...

/** The -ojf file, read safely: the CLI escapes only " and \, so a control character in a token would break the JSON. */
function readOjf(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  return JSON.parse(raw);
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

// Words with their tokens, in order; `win` counts 30 s windows (a segment opening with a timestamp token).
function _wordsOf(raw) {
  const out = [];
  let win = 0;
  raw.forEach((s, si) => {
    if (s.t.length && s.t[0][1] >= EOT && /^\[_(BEG|TT_)/.test(s.t[0][0])) win++;
    let cur = null;
    for (const k of s.t) {
      if (!(k[1] < EOT)) continue;
      if (/^\s/.test(k[0]) || !cur) {
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
    if (prev && prev.seg === w.seg && !/[\p{L}\p{N}]/u.test(text)) { prev.text += text; prev.toks = prev.toks.concat(w.toks); continue; }
    glued.push({ ...w, text });
  }
  return glued;
}

/**
 * The words in Groq's shape, seconds from the start of the piece that was heard.
 * @returns { words, timing: 'dtw' | 'approximate' }
 */
function wordsOf(raw) {
  const ws = _wordsOf(raw);
  const dtw = ws.length > 0 && ws.every((w) => w.toks[w.toks.length - 1][5] >= 0);
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

/** Segments as Groq gives them; no_speech_prob is not in -ojf (whisper.cpp drops silent windows itself). */
function segmentsOf(raw) {
  return raw.map((s) => {
    const toks = s.t.filter((k) => k[1] < EOT && k[2] > 0);
    const bytes = Buffer.byteLength(s.text, 'utf8');
    return { start: (s.from || 0) / 1000, end: (s.to || 0) / 1000, text: s.text,
      avg_logprob: toks.length ? toks.reduce((a, k) => a + Math.log(k[2]), 0) / (toks.length + 1) : null,
      compression_ratio: bytes ? bytes / zlib.deflateSync(Buffer.from(s.text, 'utf8')).length : null, no_speech_prob: null };
  });
}

const _LANG = new Map(HEARD.LANGS.map(([k, label]) => [k, label]));
/** "ru" -> "Russian", the way Groq names it; a code we do not list stays a code. */
const languageOf = (code) => _LANG.get(String(code || '')) || (code ? String(code) : null);

/** The whole answer from a -ojf document: Groq's shape plus what it came from. */
function answerOf(doc, seconds) {
  const raw = compact(doc);
  const { words, timing } = wordsOf(raw);
  return { answer: { text: raw.map((s) => s.text).join('').trim(), language: languageOf(doc && doc.result && doc.result.language),
    duration: seconds, words, segments: segmentsOf(raw) }, raw, norm: NORM_V, timing };
}

module.exports = { readOjf, compact, wordsOf, segmentsOf, languageOf, answerOf, NORM_V };
