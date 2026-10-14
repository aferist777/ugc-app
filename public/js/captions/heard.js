/* ═══════════════════════════════════════════════════════════════════════════
   CAPTIONS FROM WHAT WAS SAID - the sound a timeline plays, and the words heard in it (phase K1).

   The server listens (lib/captions-job.js) and lays the lines; the page reads the same rules to say
   whether there is anything to listen to. How the words are cut into pages - at the lay and at every
   re-cut - is pages.js (phase K2). ONE module, as the style is (style.js): an ES module the page
   imports and the server require()s through lib/mv3b-subs.js.

   A HEARD line is a caption that carries the timings of its words (`words`); a TYPED one has none.
   Heard lines are the server's to lay again; typed ones are never touched - by the server, by a
   re-cut, by anything but the hand that typed them.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Languages by their ISO-639-1 codes, for naming the one a listener heard ("Heard as Russian", lib/whisper-words.js).
 *  Nobody TELLS the listener a language any more (phase V29, the owner 2026-10-14: the lane's menu went) - it detects. */
export const LANGS = [
  ['auto', 'detect'], ['ru', 'Russian'], ['en', 'English'], ['uk', 'Ukrainian'], ['es', 'Spanish'],
  ['de', 'German'], ['fr', 'French'], ['it', 'Italian'], ['pt', 'Portuguese'], ['pl', 'Polish'], ['tr', 'Turkish'],
];

/**
 * How the subtitle lane is listened to, as stored on it: `{ engine }`, or null when it is the default - ask Groq.
 * `engine: 'local'` is "this computer" (phase K1b). The language is always detected: a `lang` an older lane
 * carries is dropped here (phase V29 - the menu went; every lane of the owner's library was on "detect", so
 * nothing is heard again or paid twice).
 */
export function listenOf(lane) {
  const l = (lane && lane.listen) || {};
  return l.engine === 'local' ? { engine: 'local' } : null;
}

export const isHeard = (c) => !!c && Array.isArray(c.words) && c.words.length > 0;

// ── The sound, as the listener wants it ─────────────────────────────────────
// One flat run of audio laid end to end, silence where the timeline is silent, so the words come
// back already in timeline coordinates and need no shifting.
//
// MUSIC IS NOT LISTENED TO. A bed runs under the whole video, and heard as sound it took the ground
// from every voice on top of it - the captions came out of the song. A bed says so on the clip
// (`bed`, music.js); a bed laid before that was said is known by what it is: a music-panel clip
// (id m...), no picture half, a track of the music (Media -> Audio -> Music).
//
// OVERLAPS ARE NOT REPRESENTABLE in a flat run, and two people talking at once is not something a
// transcript can hold either. The main audio lane - where the voice is - keeps its ground; every
// other lane is only heard where the main one is silent. Among those, the earlier clip keeps the
// ground and a later one is taken from where the first leaves off.
//
// A REVERSED clip is played backwards by the render (lib/mv3b-render.js), and speech backwards is
// noise to a listener: it is left out, as silence.
export const isBed = (c) => !!c && (c.bed === true
  || (/^m[0-9a-z]/.test(String(c.id || '')) && !c.pairId && /^\/media\/audio\//.test(String(c.src || ''))));

/**
 * The stretches of sound the timeline plays, in order and never overlapping:
 * [{ src, name, at, end, crop, speed }] - `at`/`end` in timeline seconds, `crop` where in the
 * source it starts (source seconds). Gaps between them are silence.
 */
export function soundPieces(tl) {
  const main = [], rest = [];
  for (const tr of ((tl && tl.tracks) || [])) {
    if (!tr || tr.kind !== 'audio') continue;
    const master = (tr.volume == null) ? 1 : +tr.volume;
    if (!(master > 0)) continue;
    for (const c of (tr.clips || [])) {
      const v = ((c.volume == null) ? 1 : +c.volume) * master;
      if (!(v > 0) || !c.src || c.reversed || isBed(c)) continue;
      (tr.main ? main : rest).push(c);
    }
  }
  // Pieces of sound, each a stretch of one clip: [start, end, clip].
  const lay = (clips, blocked) => {
    const took = [];
    let at = 0;
    for (const c of clips.slice().sort((a, b) => (+a.start) - (+b.start))) {
      let s = Math.max(+c.start || 0, at);
      const e = (+c.start || 0) + (+c.dur || 0);
      if (e <= s + 0.01) continue;                          // wholly under something earlier
      // Cut around what an earlier layer already holds.
      for (const [bs, be] of blocked) {
        if (be <= s || bs >= e) continue;
        if (bs > s + 0.01) took.push([s, bs, c]);
        s = Math.max(s, be);
      }
      if (e > s + 0.01) took.push([s, e, c]);
      at = e;
    }
    return took;
  };
  const held = lay(main, []);
  const pieces = held.concat(lay(rest, held.map(([s, e]) => [s, e]).sort((a, b) => a[0] - b[0])));
  pieces.sort((a, b) => a[0] - b[0]);

  const out = [];
  let at = 0;
  for (const [s0, e, c] of pieces) {
    const s = Math.max(s0, at);
    if (e <= s + 0.01) continue;
    const speed = +c.speed > 0 ? +c.speed : 1;
    out.push({ src: String(c.src), name: String(c.name || c.src).slice(0, 80), at: s, end: e,
      crop: (+c.trimIn || 0) + (s - (+c.start || 0)) * speed, speed });
    at = e;
  }
  return out;
}

/** Where the timeline plays nothing, between 0 and the end of its last sound: [[from, to], ...]. */
export function silencesOf(pieces) {
  const out = [];
  let at = 0;
  for (const p of (pieces || [])) {
    if (p.at > at + 0.01) out.push([at, p.at]);
    at = Math.max(at, p.end);
  }
  return out;
}

// ── What was heard, made fit to lay ─────────────────────────────────────────
// Whisper hears things that were not said: in silence it is known to write a whole sentence ("thank
// you for watching", "Субтитры сделал DimaTorzok"), and it loops on a phrase. Its own segments say
// when that happened, and the timeline says where nothing plays at all. These rules run only when a
// lane is laid; what Groq answered is kept whole in the project's subs/ file, so they can change
// without paying again.
const NOISE = (g) => (+g.no_speech_prob > 0.6 && +g.avg_logprob < -1) || +g.compression_ratio > 2.4;
const WORD_MAX = 1.5;                   // a word held longer than this is a timing gone wrong
const WORD_CHARS = 60;                  // the longest a stored word is (style.js normalizeWords, words.js LIMITS)

/**
 * @param words     [{ text, start, end }] in timeline seconds
 * @param segments  [{ start, end, no_speech_prob, avg_logprob, compression_ratio }] in timeline seconds
 * @param opts.gaps   [[from, to]] where the timeline plays nothing (silencesOf)
 * @param opts.typed  [[from, to]] the lines typed by hand - they own their stretch
 * @param opts.fixed  [[from, to]] the heard lines a person corrected (K10) - they own theirs too
 * @returns { words, dropped: { noise, silence, typed, fixed } }
 */
export function cleanWords(words, segments, opts) {
  const gaps = (opts && opts.gaps) || [];
  const typed = (opts && opts.typed) || [];
  const fixed = (opts && opts.fixed) || [];
  const noisy = (segments || []).filter(NOISE).map(g => [+g.start || 0, +g.end || 0]);
  const inside = (spans, t) => spans.some(([a, b]) => t >= a && t < b);
  const dropped = { noise: 0, silence: 0, typed: 0, fixed: 0 };
  const kept = [];
  for (const w0 of (words || [])) {
    // No word longer than a stored word may be (60 - normalizeWords): a page built from a longer one (a web
    // address heard as one word) spelled what its stored words no longer did, and an untouched line counted as
    // corrected for good (review K10). Cut here, before the pages are, the text and the words say the same.
    let text = String((w0 && (w0.text != null ? w0.text : w0.word)) || '').trim();
    if (text.length > WORD_CHARS) text = text.slice(0, /[\uD800-\uDBFF]/.test(text[WORD_CHARS - 1]) ? WORD_CHARS - 1 : WORD_CHARS);
    if (!text) continue;
    let start = +w0.start || 0;
    let end = Math.max(start, +w0.end || start);
    const mid = (start + end) / 2;
    if (inside(noisy, mid)) { dropped.noise++; continue; }
    // Wholly inside pure silence: invented, whatever it says. Starting in silence and running into
    // sound: Whisper starts a word early after a pause - it starts where the sound does.
    const gap = gaps.find(([a, b]) => start >= a - 0.05 && start < b);
    if (gap && end <= gap[1] + 0.05) { dropped.silence++; continue; }
    if (gap) start = gap[1];
    // ...and a word that runs on into a silence ends where the sound does: Whisper stretches the last word
    // before a silence by ~0.4 s, which hid the pause from the cut (review K2).
    const into = gaps.find(([a]) => start < a && end > a + 0.05);
    if (into) end = into[0];
    if (inside(typed, (start + end) / 2)) { dropped.typed++; continue; }
    if (inside(fixed, (start + end) / 2)) { dropped.fixed++; continue; }
    kept.push({ text, start, end });
  }
  kept.sort((a, b) => a.start - b.start);
  let prevEnd = 0;
  for (const w of kept) {
    w.start = Math.max(w.start, prevEnd);
    w.end = Math.min(Math.max(w.end, w.start + 0.05), w.start + WORD_MAX);
    prevEnd = w.end;
  }
  return { words: kept, dropped };
}
