'use strict';

/* highlights-agent.js - the moments of a long video, found by the agent (phase V33.1, the owner's (х3), (х4), (х4а), (х14)).

   The words heard in the video (lib/captions-job.js hearLong) are cut into SENTENCES by the captions' own rule
   (public/js/captions/pages.js endsSentence) - a sentence that runs on for long is cut at a pause or a comma - and the agent
   reads them numbered, with their times. It answers ONE JSON: moments made of 1 to 3 PIECES, each a run of whole sentences
   by their numbers. Numbers, not times: a moment can only start and end where a sentence does.

   The agent is the agents' ladder (lib/agents.js, Admin -> AI settings - the writers' models, the owner's (х3)), asked ONCE:
   a step that got no answer stops the ladder ("paid once").

   What comes back is checked, not trusted: a piece out of range or upside down, more than three pieces, a moment that shares
   a sentence with a better one, or one outside the length asked for (a moment a little too long loses sentences from its end
   while it stays a whole thought) - dropped or mended here, and said in the count. Weak ones are not dropped: each carries its
   score, 0-100 - how complete its theme is (the owner's (х14)) - and the best come first. */

const PAGES = require('../public/js/captions/pages.js');

const SENT_MAX_S = 30;           // a sentence longer than this is cut at its best pause or comma
const SENT_MAX_WORDS = 70;
const r1 = (t) => Math.round((+t || 0) * 10) / 10;
const r2 = (t) => Math.round((+t || 0) * 100) / 100;

/** [{ i (from 1), start, end, text, words: [from, to) indices }] - the words in sentences. */
function sentences(words) {
  const ws = (words || []).filter((w) => w && String(w.text || '').trim()).slice().sort((a, b) => a.start - b.start);
  const out = [];
  let cur = [];
  const close = () => {
    if (!cur.length) return;
    out.push({ i: out.length + 1, start: r2(cur[0].start), end: r2(cur[cur.length - 1].end), text: cur.map((w) => String(w.text).trim()).join(' ') });
    cur = [];
  };
  for (let k = 0; k < ws.length; k++) {
    const w = ws[k];
    const next = ws[k + 1] || null;
    cur.push(w);
    const gap = next ? next.start - w.end : 99;
    if (PAGES.endsSentence(w.text, next ? next.text : null, gap) || gap >= 2.0) { close(); continue; }
    // A run-on stretch of speech (Whisper does not always put the full stops in): cut at a pause or a comma once it is long.
    const len = w.end - cur[0].start;
    if ((len >= SENT_MAX_S || cur.length >= SENT_MAX_WORDS) && (gap >= 0.5 || /[,;:]$/.test(String(w.text)))) close();
    else if (len >= SENT_MAX_S * 1.6 || cur.length >= SENT_MAX_WORDS * 1.6) close();
  }
  close();
  return out;
}

const _clock = (s) => {
  s = Math.max(0, +s || 0);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = (s % 60).toFixed(1).padStart(4, '0');
  return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + x;
};

const SYSTEM = [
  'You are a video editor who cuts viral vertical shorts (TikTok, Reels, YouTube Shorts) out of long videos.',
  'You get the transcript of ONE video as numbered sentences, each with its start and end time and its length.',
  'Find the moments that would work best as shorts. Rules:',
  '1. A moment is 1 to 3 PIECES. A piece is a run of whole sentences, given by their numbers [first, last] (inclusive).',
  '2. The pieces of one moment TOGETHER last between MIN and MAX seconds (add up each piece from the start of its first sentence to the end of its last).',
  '3. A moment stands on its own: it opens with a strong hook (a bold claim, a question, a surprise, a conflict, a number) or the start of a complete thought, and its last sentence closes that thought. No dangling references to what came before ("as I said", "this one", "he") that leave a viewer lost.',
  '4. A theme opened in one place and closed in another can be ONE moment of several pieces. Pieces after the first keep the video\'s order. The FIRST piece may come from LATER in the video when it is the strongest hook - a short punchy line first, then the story it belongs to.',
  '5. Moments never share a sentence.',
  '6. Search the WHOLE video, start to end - good moments are often in the middle and near the end. Return as many as asked when the video has them; when it has fewer good ones, return fewer rather than padding.',
  '7. score (0-100): how COMPLETE the theme is inside the moment - opened and closed, a whole thought that needs nothing else (high), or cut off, half a thought (low).',
  '8. title: a short catchy title in English, at most 60 characters. headline: the same idea as a punchy on-screen headline for the top of the short, in the LANGUAGE THE VIDEO IS SPOKEN IN (not translated), at most 50 characters. hook: the opening line in English (translated when the video is in another language). why: one or two sentences in English on why it would work as a short.',
  'Answer with JSON only, best moment first, in exactly this shape:',
  '{"moments":[{"pieces":[[12,18]],"title":"...","headline":"...","hook":"...","why":"...","score":87}]}',
].join('\n');

/** The messages for the ladder. `len` - { min, max } seconds; `count` - how many are wanted. */
function messages({ title, seconds, sents, len, count }) {
  const lines = sents.map((s) => `[${s.i}] ${_clock(s.start)}-${_clock(s.end)} (${r1(s.end - s.start)}s) ${s.text}`);
  const user = [
    `Video: "${String(title || 'untitled').slice(0, 200)}", ${_clock(seconds)} long, ${sents.length} sentences.`,
    `Wanted: ${count} moments, each ${len.min}-${len.max} seconds (MIN ${len.min}, MAX ${len.max}).`,
    '',
    'Sentences:',
    ...lines,
  ].join('\n');
  return [{ role: 'system', content: SYSTEM.replace('MIN and MAX', `${len.min} and ${len.max}`) }, { role: 'user', content: user }];
}

// The JSON in an answer: fenced or not, with words around it or not. A cut-off answer is not mended.
function _json(raw) {
  const s = String(raw || '');
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  const body = fence ? fence[1] : s;
  const a = body.indexOf('{'), b = body.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('the agent answered without the moments (no JSON)');
  try { return JSON.parse(body.slice(a, b + 1)); }
  catch (e) { throw new Error('the agent\'s answer is not whole JSON - it may have been cut off'); }
}

const _str = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);

/**
 * The agent's answer as fragments, checked. `sents` from sentences(); `len` { min, max }; `count` how many were asked.
 * @returns { fragments: [{ rank, title, score, hook, why, text, pieces: [{ start, end, from, to }], seconds }], dropped, asked }
 */
function parse(raw, sents, len, count) {
  const doc = _json(raw);
  const list = Array.isArray(doc) ? doc : (Array.isArray(doc && doc.moments) ? doc.moments : []);
  // An answer with none is an answer, not a fault: asking again would pay for the same (a refusal - no paid retry).
  if (!list.length) throw Object.assign(new Error(`The agent found no moments of ${len.min}-${len.max} s in this video.`), { refused: true });
  const N = sents.length;
  const used = new Set();
  const out = [];
  let dropped = 0;
  const span = (p) => sents[p[1] - 1].end - sents[p[0] - 1].start;
  const total = (ps) => ps.reduce((n, p) => n + span(p), 0);
  for (const m of list) {
    let ps = (Array.isArray(m && m.pieces) ? m.pieces : []).map((p) => (Array.isArray(p) ? p : [p && p.from, p && p.to]))
      .map(([a, b]) => [Math.round(+a), Math.round(+b)])
      .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && a >= 1 && b <= N && a <= b)
      .slice(0, 3);
    if (!ps.length) { dropped++; continue; }
    // Pieces after the first in the video's order, none over another; the first may be a later hook.
    const rest = ps.slice(1).sort((x, y) => x[0] - y[0]);
    ps = [ps[0], ...rest];
    const overlap = ps.some((p, k) => ps.some((q, l) => l !== k && p[0] <= q[1] && q[0] <= p[1]));
    if (overlap) { dropped++; continue; }
    // A little too long: sentences off the end of its last piece while it stays long enough.
    let guard = 0;
    while (total(ps) > len.max + 2 && guard++ < 200) {
      const last = ps[ps.length - 1];
      if (last[1] > last[0] && total(ps) - (sents[last[1] - 1].end - sents[last[1] - 2].end) >= len.min) last[1]--;
      else if (ps.length > 1 && total(ps.slice(0, -1)) >= len.min) ps = ps.slice(0, -1);
      else break;
    }
    const secs = total(ps);
    if (secs > len.max + 5 || secs < len.min - 5) { dropped++; continue; }
    const mine = [];
    for (const [a, b] of ps) for (let i = a; i <= b; i++) mine.push(i);
    if (mine.some((i) => used.has(i))) { dropped++; continue; }
    for (const i of mine) used.add(i);
    const text = ps.map(([a, b]) => sents.slice(a - 1, b).map((s) => s.text).join(' ')).join(' … ');
    out.push({
      title: _str(m.title, 80) || _str(sents[ps[0][0] - 1].text, 60),
      // (phase V33.3) The title on top, in the video's own language (the owner's (х36)); the English title when it gave none.
      headline: _str(m.headline, 80),
      score: Math.max(0, Math.min(100, Math.round(+m.score || 0))),
      hook: _str(m.hook, 300) || _str(sents[ps[0][0] - 1].text, 300),
      why: _str(m.why, 600),
      text: text.slice(0, 6000),
      pieces: ps.map(([a, b]) => ({ from: a, to: b, start: sents[a - 1].start, end: sents[b - 1].end })),
      seconds: r1(secs),
    });
  }
  out.sort((a, b) => b.score - a.score);
  const kept = out.slice(0, Math.max(1, +count || out.length));
  kept.forEach((f, k) => { f.rank = k + 1; });
  return { fragments: kept, dropped: dropped + Math.max(0, out.length - kept.length), asked: list.length };
}

/** The agent's price, roughly, for the button (the owner's (х13)): its words in and its answer out, at a flash model's price. */
function priceOf(chars, count) {
  const tokensIn = (+chars || 0) / 3.5 + 1500;
  const tokensOut = 250 * (+count || 5) + 2000;
  return Math.round((tokensIn * 0.5 / 1e6 + tokensOut * 3 / 1e6) * 10000) / 10000;
}

module.exports = { sentences, messages, parse, priceOf, SYSTEM };
