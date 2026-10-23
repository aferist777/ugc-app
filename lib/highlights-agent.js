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
  'SHAPE',
].join('\n');
const SHAPE = '{"moments":[{"pieces":[[12,18]],"title":"...","headline":"...","hook":"...","why":"...","score":87}]}';
const SHAPE_AUTO = '{"kind":"podcast","moments":[{"pieces":[[12,18]],"title":"...","headline":"...","hook":"...","why":"...","score":87}]}';

// ── Each kind's own rules (phase V33.8, the owner 2026-10-23, (у6): "под каждый video kind должен быть собственный
// промпт-инструкция для разбора на фрагменты"; the texts shown to the owner in Russian and approved the same day). Built from
// what clipping tools, editors and retention research say makes a moment strong in each kind (the session's notes,
// v33-8-research-moments.md). Added to the shared rules above, in the same call; MIN and MAX are the user message's.
const GUIDES = {
  podcast: [
    'This video is a podcast or an interview: two or more people talking.',
    'K1. The transcript has no speaker names - tell the turns apart by questions, "you" said to someone, short replies ("right", "yeah") and changes of subject.',
    'K2. Look for moments where something HAPPENS: a strong or contrarian opinion with its reason, a personal story that reaches its point, a confession, a disagreement or pushback, a direct answer to a specific question, advice with the why behind it, a funny exchange, a surprising number. A laugh, an interruption, "wait, really?" or "honestly" often mark them.',
    'K3. Skip greetings, the guest\'s introduction, "thanks for having me", ad and sponsor reads, plugs, the outro, small talk, inside jokes, callbacks to earlier in the talk, and moments whose only point is the guest\'s credentials.',
    'K4. Start on the first sentence that carries meaning - usually the guest\'s strongest line - never on the run-up, "great question" or "so, yeah".',
    'K5. Keep the host\'s question only when the answer is unclear or unfair without it; a short, sharp question is itself a good hook. Otherwise start with the answer.',
    'K6. The first sentence must hook a stranger within 1-3 seconds: a claim, a tension or a number, with its subject named - never "he", "that" or "it" pointing outside the moment.',
    'K7. End right after the payoff - the punchline, the lesson, the verdict, the answer to the question the moment opened - before the talk turns to the next subject. Never stop before the answer.',
    'K8. Keep a qualification the speaker adds right after a claim ("but only if...", "in my case"), or drop the moment. Never join pieces so they say what the speaker did not mean.',
    'K9. Mostly the guest\'s voice; the host belongs in a moment with a question, a pushback or a real reaction. In a back-and-forth keep both sides and end on the line that settles or sharpens it.',
    'K10. Length: the shortest COMPLETE argument between MIN and MAX - never pad toward MAX. Up to 30 s: one opinion, answer or punchline. Up to 60 s: a claim with its reason and example, or a short exchange. Up to 90 s: a whole story or a real debate.',
    'K11. Mix the shapes - opinions, stories, answers, exchanges - not several moments of the same kind.',
  ],
  documentary: [
    'This video is a documentary or an explainer: mostly one narrator over footage, graphics or archive, with short interview soundbites. You see only the words, not the pictures.',
    'K1. Look for: a striking fact with its why; a question or mystery and its answer; a common belief and its correction; a turn in the story; a reveal or twist; a number that changes the sense of scale; a short story about one person with a clear outcome.',
    'K2. Every sentence of a moment must follow from the one before ("but", "so", "which is why") - a chain with stakes, not a list of facts ("and then").',
    'K3. Skip the channel\'s intro and outro ("in this video", "welcome back", "subscribe"), sponsor segments, chapter transitions ("now let\'s look at"), recaps, and runs of dates and names that only set the scene.',
    'K4. Skip sentences whose meaning lives in the picture - "as you can see", "look at this", "this map", "here". A moment must make full sense as sound alone.',
    'K5. Start on the claim, the question or the contradiction - the reason to keep watching - not on background. A scene may open a moment only when its first sentence already carries the stakes.',
    'K6. The first 1-3 seconds: a specific, surprising claim or number, or a question the viewer feels they should know the answer to. Be specific, and promise only what the moment delivers.',
    'K7. You may open with a LATER line as the first piece when it is the question or the striking claim - never with the answer itself, which must stay the payoff.',
    'K8. Narration points back a lot ("this decision", "they"): if the first sentence leans on something outside the moment, start one or two sentences earlier, where the subject is named.',
    'K9. End on the payoff - the answer, the reveal, the why, the consequence - then stop. Never end on "but more on that later" or the opening of the next chapter; close every question the moment opens.',
    'K10. Keep an interview soundbite when it is the reveal or the emotional peak, with the narration line that says who is speaking.',
    'K11. Length between MIN and MAX, set by the shape, never padded: one fact with its why is short; a mystery with its answer, or a belief with its correction, takes more; a story with a build and a reveal takes the most.',
    'K12. Mix the shapes - facts, mysteries, corrections, stories - not several moments of the same kind.',
  ],
  auto: [
    'First decide from the transcript what kind of video this is, then cut it by that kind\'s rules. Say what you decided: put "kind" at the top of the JSON - one of podcast, documentary, vlog, lecture, tutorial, reaction, monologue, sermon, stream, other.',
    '- PODCAST / INTERVIEW: questions followed by long answers, again and again; "you" said to a person; "welcome to the show", "my guest", "thanks for having me"; short replies ("right", "yeah"); ad reads ("brought to you by").',
    '- DOCUMENTARY / EXPLAINER: one polished narrator with few fillers; dates, places and numbers; questions the narrator answers himself; "in this video"; references to what is on screen.',
    '- OTHER: a vlog ("today we\'re...", things happening as they are said), a lecture or talk ("today I\'ll talk about", "next slide", audience questions), a tutorial (steps and imperatives: "first, click..."), a reaction or commentary (talk about another clip: "watch this", "did he just"), a monologue to camera (one voice, opinions and stories, "you guys"), a sermon (scripture, "amen"), a stream ("chat", donations, game talk).',
    'The transcript has no speaker names - judge by these signals. Everywhere: skip intros, outros, greetings, ad reads and small talk; start on the first sentence that carries meaning, with its subject named; end right after the payoff; never pad toward MAX.',
    'K1. Podcast / interview: a strong opinion with its reason, a story that reaches its point, a confession, a disagreement, a direct answer, a funny exchange. Start on the guest\'s strongest line; keep the host\'s question only when the answer needs it; keep a qualification the speaker adds; end on the punchline, lesson or verdict.',
    'K2. Documentary / explainer: a striking fact with its why, a mystery and its answer, a belief and its correction, a turn, a reveal. Start on the claim or the question, end on the answer; skip lines that depend on the picture ("as you can see", "this map"); never open with the answer.',
    'K3. Vlog: the beat where something goes wrong or surprises - start in the action, end on the reaction or the result; skip the logistics.',
    'K4. Lecture or talk: one idea as claim, example, takeaway; cut the audience questions like an interview; skip housekeeping and slide references.',
    'K5. Tutorial: one tip whose result is said first, then at most three steps; skip steps that only make sense on screen.',
    'K6. Reaction or commentary: the sharpest take, with just enough of what it reacts to; end on the verdict or the punchline.',
    'K7. Monologue to camera: the strongest claim, its reason, an example, the conclusion.',
    'K8. Sermon: a contrast statement, a scripture reveal, a story turn, a quotable definition or a challenge - one idea, ended when the thought lands.',
    'K9. Stream: a peak - a laugh, rage, a win or a fail - with its lead-up and payoff.',
    'K10. If the kind is unclear or mixed, say "other" and cut by the general rules alone.',
  ],
};
// What auto may say the video is (its answer's `kind`).
const FOUND_KINDS = ['podcast', 'documentary', 'vlog', 'lecture', 'tutorial', 'reaction', 'monologue', 'sermon', 'stream', 'other'];

/**
 * The messages for the ladder. `len` - { min, max } seconds; `count` - how many are wanted; `kind` (V33.8) - auto, podcast or
 * documentary: its own rules go into the system message after the shared ones.
 */
function messages({ title, seconds, sents, len, count, kind }) {
  const lines = sents.map((s) => `[${s.i}] ${_clock(s.start)}-${_clock(s.end)} (${r1(s.end - s.start)}s) ${s.text}`);
  const k = GUIDES[kind] ? kind : 'auto';
  const user = [
    `Video: "${String(title || 'untitled').slice(0, 200)}", ${_clock(seconds)} long, ${sents.length} sentences.`,
    `Wanted: ${count} moments, each ${len.min}-${len.max} seconds (MIN ${len.min}, MAX ${len.max}).`,
    '',
    'Sentences:',
    ...lines,
  ].join('\n');
  const system = SYSTEM.replace('MIN and MAX', `${len.min} and ${len.max}`).replace('SHAPE', k === 'auto' ? SHAPE_AUTO : SHAPE)
    + '\n\nTHIS VIDEO\'S KIND - its own rules, on top of the rules above:\n' + GUIDES[k].join('\n');
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
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
  // (V33.8) What auto found the video to be - '' when it said nothing it may say.
  const found = String((doc && !Array.isArray(doc) && doc.kind) || '').trim().toLowerCase();
  return { fragments: kept, dropped: dropped + Math.max(0, out.length - kept.length), asked: list.length, kind: FOUND_KINDS.includes(found) ? found : '' };
}

/** The agent's price, roughly, for the button (the owner's (х13)): its words in and its answer out, at a flash model's price. */
function priceOf(chars, count) {
  // The shared rules and the kind's own (V33.8: ~1 000 tokens more) besides the words.
  const tokensIn = (+chars || 0) / 3.5 + 2500;
  const tokensOut = 250 * (+count || 5) + 2000;
  return Math.round((tokensIn * 0.5 / 1e6 + tokensOut * 3 / 1e6) * 10000) / 10000;
}

module.exports = { sentences, messages, parse, priceOf, SYSTEM, GUIDES, FOUND_KINDS };
