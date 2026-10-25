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

// ════════════════════════════════════════════════════════════════════════════
// FRAGMENTATION (phase V43, the owner 2026-10-24/25, answers (ё1)-(ё19); docs/local-app/PLAN.md "Фазы V39–V44", V43).
// Not the best moments: the WHOLE video, start to end, cut into parts by meaning, one after another - an episode of a series
// published as a run of shorts. The agent reads the same numbered sentences and answers the parts as [first, last] sentence
// numbers, the ones to cut out marked (the channel's intro, an ad, the outro, a recap - (ё4)), and each part's KEY MOMENTS -
// a punchline, a reveal, a strong line - where the frame punches in (ё5)-(ё7а). No score, no order but the video's ((ё9)).
// What comes back is CHECKED and mended here (fragParse), never trusted: every sentence in exactly one part, the parts
// contiguous from the first sentence to the last; the time with no speech between two sentences goes to the part before it,
// the very start to the first part ((ё3)); a part too short joins a neighbour, one too long is split at the sentence end
// nearest its middle ((ё1): the length asked for, 20 % either way for the sake of the meaning).
// ════════════════════════════════════════════════════════════════════════════

const FRAG_SLACK = 0.2;          // (ё1) a part may be this much shorter or longer than asked
const SKIPS = ['intro', 'ad', 'outro', 'recap'];
const SKIP_MAX_S = 180;          // a part marked to be cut out in the MIDDLE of the video longer than this is kept (an agent's slip)
const SKIP_EDGE_MAX_S = 300;     // ... at the start or the end of the video
const KEYS_PER_MIN = 4;          // (ё6) 1-4 punch-ins a minute
const KEY_GAP_S = 3;             // and never closer than this
// (V43, the paid check) A tail with NO SPEECH past the last sentence longer than this - an episode's closing credits (4 min on the
// owner's) - is cut out as the outro; the last part keeps TAIL_KEEP_S of it (the cut's own margin). The start is left alone: a
// series often opens on action with no words.
const TAIL_MAX_S = 10;
const TAIL_KEEP_S = 3;

const FRAG_SYSTEM = [
  'You are a video editor. You get the transcript of ONE long video (an episode of a series, a show, a talk, a stream) as numbered sentences, each with its start and end time.',
  'Split the WHOLE video, start to end, into consecutive PARTS by meaning - a scene, a topic, a complete exchange or a story - to be published one after another as vertical shorts. Rules:',
  '1. Every sentence belongs to exactly one part. The parts follow one another with no gap and no overlap: the first starts at sentence 1, each next one starts right after the previous one ends, the last ends at the last sentence. A part is its first and last sentence numbers (inclusive).',
  '2. A part lasts between MIN and MAX seconds (from the start of its first sentence to the start of the next part). It may be up to 20% shorter or longer when the meaning asks for it: a part ends where a scene, a thought or an exchange ends - never in the middle of one, never on a question whose answer opens the next part.',
  '3. Mark what is to be cut out with "skip": "intro" (the channel\'s intro, greetings, "in this video", a cold-open teaser that repeats a later scene), "ad" (a sponsor or ad read), "outro" ("subscribe", "see you next time", credits read aloud) or "recap" (a recap of earlier episodes). Everything else is a part with "skip": "". Never mark the story or the talk itself as skip.',
  '4. title: a short catchy title in English, at most 60 characters. headline: the same idea for the top of the short, in the LANGUAGE THE VIDEO IS SPOKEN IN (not translated), at most 50 characters.',
  '5. keys: the part\'s KEY MOMENTS, where the camera punches in: 1 to 4 a minute of the part, fewer when nothing stands out, never two within 3 seconds - a punchline, a reveal, a strong or surprising claim, a key number, a confession, a threat, a joke landing, a line the next one reacts to. Each: "s" the sentence number (inside its part) and "w" the key word in it, exactly as spoken.',
  'Answer with JSON only, the parts in the video\'s order, in exactly this shape:',
  '{"parts":[{"from":1,"to":14,"skip":"","title":"...","headline":"...","keys":[{"s":5,"w":"word"}]}]}',
].join('\n');

/** How many parts a video of `seconds` comes to at the length `len` - for the budget of the answer and the price. */
const fragParts = (seconds, len) => Math.max(1, Math.round((+seconds || 0) / (((len.min + len.max) / 2) || 60)));
/** The answer's budget: ~320 tokens a part (its title, its headline, its keys), within the ladder's long work (V37). */
const fragMaxTokens = (seconds, len) => Math.max(8000, Math.min(64000, 2000 + 320 * fragParts(seconds, len)));

/** The messages for the ladder: the rules with the length put in, and the video's sentences. */
function fragMessages({ title, seconds, sents, len }) {
  const lines = sents.map((s) => `[${s.i}] ${_clock(s.start)}-${_clock(s.end)} (${r1(s.end - s.start)}s) ${s.text}`);
  const user = [
    `Video: "${String(title || 'untitled').slice(0, 200)}", ${_clock(seconds)} long, ${sents.length} sentences.`,
    `Wanted: the whole video in parts of ${len.min}-${len.max} seconds (MIN ${len.min}, MAX ${len.max}) - about ${fragParts(seconds, len)} parts.`,
    '',
    'Sentences:',
    ...lines,
  ].join('\n');
  return [{ role: 'system', content: FRAG_SYSTEM.replace('MIN and MAX', `${len.min} and ${len.max}`) }, { role: 'user', content: user }];
}

const _norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * The agent's parts, checked and mended. `sents` from sentences(); `len` { min, max }; `seconds` the video's length; `words`
 * (optional, [{ text, start, end }]) - a key word's own moment.
 * Returns { fragments: [{ rank, title, headline, text, pieces: [{ start, end, from, to }], seconds, keys: [{ s, w, start, end }] }],
 *           skipped: [{ from, to, start, end, skip }], asked, mended: { gaps, overlaps, merged, split, keptSkips } }.
 * Times: a part runs from its first sentence's start (the video's start for the first) to the next part's first sentence's start
 * (the video's end for the last) - the stretch with no speech after a sentence goes with it; but a speechless tail of more than
 * TAIL_MAX_S past the last sentence is cut out as the outro (`skipped`, from = to = the last sentence).
 */
function fragParse(raw, sents, len, seconds, words) {
  const doc = _json(raw);
  const list = Array.isArray(doc) ? doc : (Array.isArray(doc && doc.parts) ? doc.parts : []);
  if (!list.length) throw Object.assign(new Error('The agent split the video into no parts.'), { refused: true });
  const N = sents.length;
  const total = +seconds > 0 ? +seconds : sents[N - 1].end;
  const mended = { gaps: 0, overlaps: 0, merged: 0, split: 0, keptSkips: 0 };
  // Every sentence's part, the first claim winning; then the gaps.
  const asked = list.map((p, k) => ({
    k, from: Math.round(+(p && p.from)), to: Math.round(+(p && p.to)),
    skip: SKIPS.includes(String((p && p.skip) || '').toLowerCase()) ? String(p.skip).toLowerCase() : '',
    title: _str(p && p.title, 80), headline: _str(p && p.headline, 80),
    keys: (Array.isArray(p && p.keys) ? p.keys : []).map((x) => ({ s: Math.round(+(x && x.s)), w: _str(x && x.w, 60) })).filter((x) => x.s >= 1 && x.s <= N),
  })).filter((p) => Number.isFinite(p.from) && Number.isFinite(p.to) && p.from >= 1 && p.to <= N && p.from <= p.to)
    .sort((a, b) => a.from - b.from || a.k - b.k);
  if (!asked.length) throw Object.assign(new Error('None of the agent\'s parts names sentences of this video.'), { refused: true });
  const owner = new Array(N + 1).fill(-1);
  for (const p of asked) for (let i = p.from; i <= p.to; i++) { if (owner[i] < 0) owner[i] = p.k; else mended.overlaps++; }
  // A sentence nobody took goes with the part before it (the very first ones - with the part after them).
  for (let i = 1; i <= N; i++) if (owner[i] < 0) { mended.gaps++; owner[i] = i > 1 ? owner[i - 1] : -2; }
  for (let i = N; i >= 1; i--) if (owner[i] === -2) owner[i] = i < N ? owner[i + 1] : asked[0].k;
  // Runs of one owner are the parts (a part split in two by another's overlap becomes two).
  const byK = new Map(asked.map((p) => [p.k, p]));
  let runs = [];
  for (let i = 1; i <= N; i++) {
    const last = runs[runs.length - 1];
    if (last && last.k === owner[i]) last.to = i;
    else runs.push({ k: owner[i], from: i, to: i });
  }
  runs = runs.map((r) => { const p = byK.get(r.k); return { ...r, skip: p.skip, title: p.title, headline: p.headline, keys: p.keys }; });
  const startOf = (r, idx) => (idx === 0 ? 0 : sents[r.from - 1].start);
  const span = () => runs.forEach((r, idx) => { r.start = startOf(r, idx); r.end = idx + 1 < runs.length ? sents[runs[idx + 1].from - 1].start : total; });
  span();
  // The speechless tail - the credits - out as the outro, unless the last part is cut out already.
  const lastRun = runs[runs.length - 1];
  const speechEnd = sents[N - 1].end;
  let tail = null;
  if (!lastRun.skip && total - speechEnd > TAIL_MAX_S) {
    const at = Math.min(total, speechEnd + TAIL_KEEP_S);
    tail = { from: N, to: N, start: r2(at), end: r2(total), skip: 'outro' };
    lastRun.end = at;
  }
  // A part marked to be cut out that is too long to be an intro, an ad or an outro is kept: the story is never dropped by a slip.
  runs.forEach((r, idx) => {
    if (!r.skip) return;
    const edge = idx === 0 || idx === runs.length - 1;
    if (r.end - r.start > (edge ? SKIP_EDGE_MAX_S : SKIP_MAX_S)) { r.skip = ''; mended.keptSkips++; }
  });
  // Two neighbours both cut out are one stretch; two kept ones stay apart.
  const lo = len.min * (1 - FRAG_SLACK), hi = len.max * (1 + FRAG_SLACK);
  const dur = (r) => r.end - r.start;
  // Too short: joined to a kept neighbour with no cut between them - the one before, else the one after.
  for (let guard = 0; guard < 2000; guard++) {
    const idx = runs.findIndex((r) => !r.skip && dur(r) < lo && ((runs[runs.indexOf(r) - 1] && !runs[runs.indexOf(r) - 1].skip) || (runs[runs.indexOf(r) + 1] && !runs[runs.indexOf(r) + 1].skip)));
    if (idx < 0) break;
    const r = runs[idx];
    const prev = runs[idx - 1] && !runs[idx - 1].skip ? runs[idx - 1] : null;
    const next = runs[idx + 1] && !runs[idx + 1].skip ? runs[idx + 1] : null;
    // The shorter neighbour takes it, so the parts stay even.
    const into = prev && next ? (dur(prev) <= dur(next) ? prev : next) : (prev || next);
    const a = into === prev ? prev : r, b = into === prev ? r : next;
    const keep = dur(a) >= dur(b) ? a : b;
    const joined = { ...a, k: keep.k, to: b.to, end: b.end, keys: [...a.keys, ...b.keys], title: keep.title, headline: keep.headline };
    runs.splice(runs.indexOf(a), 2, joined);
    mended.merged++;
  }
  // Too long: split at the sentence end nearest the middle (again while too long), where there is one.
  for (let guard = 0; guard < 2000; guard++) {
    const idx = runs.findIndex((r) => !r.skip && dur(r) > hi && r.to > r.from && !r.noSplit);
    if (idx < 0) break;
    const r = runs[idx];
    const mid = r.start + dur(r) / 2;
    let best = -1, bd = Infinity;
    // A cut after sentence i: the second part starts at sentence i+1.
    for (let i = r.from; i < r.to; i++) {
      const at = sents[i].start;     // sentence i+1 (1-based) starts here
      const d = Math.abs(at - mid);
      if (at - r.start >= lo && r.end - at >= lo && d < bd) { bd = d; best = i; }
    }
    if (best < 0) { r.noSplit = true; continue; }
    const at = sents[best].start;
    const a = { ...r, to: best, end: at, keys: r.keys.filter((x) => x.s <= best) };
    const b = { ...r, from: best + 1, start: at, keys: r.keys.filter((x) => x.s > best) };
    runs.splice(idx, 1, a, b);
    mended.split++;
  }
  // The pieces of one part split in two or more are told apart: "Title · 1", "Title · 2".
  const ofK = new Map();
  for (const r of runs) if (!r.skip) ofK.set(r.k, (ofK.get(r.k) || 0) + 1);
  const nth = new Map();
  for (const r of runs) {
    if (r.skip || ofK.get(r.k) < 2) continue;
    nth.set(r.k, (nth.get(r.k) || 0) + 1);
    r.part = nth.get(r.k);
  }
  // Keys: inside their part, a word's own moment when it is found, at most KEYS_PER_MIN a minute and KEY_GAP_S apart.
  const ws = (Array.isArray(words) ? words : []).filter((w) => w && w.text);
  const keysOf = (r) => {
    const out = [];
    const seen = new Set();
    for (const x of r.keys.filter((y) => y.s >= r.from && y.s <= r.to).sort((p, q) => p.s - q.s)) {
      if (seen.has(x.s)) continue;
      seen.add(x.s);
      const s = sents[x.s - 1];
      let start = s.start;
      const want = _norm(x.w);
      if (want) {
        const hit = ws.find((w) => w.start >= s.start - 0.05 && w.end <= s.end + 0.05 && _norm(w.text) === want)
          || ws.find((w) => w.start >= s.start - 0.05 && w.end <= s.end + 0.05 && want.length >= 3 && _norm(w.text).includes(want));
        if (hit) start = hit.start;
      }
      if (out.length && start - out[out.length - 1].start < KEY_GAP_S) continue;
      if (out.filter((o) => o.start > start - 60).length >= KEYS_PER_MIN) continue;
      out.push({ s: x.s, w: x.w, start: r2(start), end: r2(Math.max(start + 0.3, s.end)) });
    }
    return out;
  };
  const kept = runs.filter((r) => !r.skip);
  if (!kept.length) throw Object.assign(new Error('The agent marked the whole video to be cut out.'), { refused: true });
  const fragments = kept.map((r, k) => ({
    rank: k + 1,
    title: (r.title || _str(sents[r.from - 1].text, 60)) + (r.part ? ' · ' + r.part : ''),
    headline: r.headline,
    text: sents.slice(r.from - 1, r.to).map((s) => s.text).join(' ').slice(0, 6000),
    pieces: [{ from: r.from, to: r.to, start: r2(r.start), end: r2(r.end) }],
    seconds: r1(r.end - r.start),
    keys: keysOf(r),
  }));
  const skipped = runs.filter((r) => r.skip).map((r) => ({ from: r.from, to: r.to, start: r2(r.start), end: r2(r.end), skip: r.skip }));
  if (tail) skipped.push(tail);
  return { fragments, skipped, asked: list.length, mended };
}

/** fragmentation's price, roughly: the words in, ~320 tokens a part out. */
function fragPrice(chars, seconds, len) {
  const tokensIn = (+chars || 0) / 3.5 + 1500;
  const tokensOut = 320 * fragParts(seconds, len) + 1000;
  return Math.round((tokensIn * 0.5 / 1e6 + tokensOut * 3 / 1e6) * 10000) / 10000;
}

module.exports = { sentences, messages, parse, priceOf, SYSTEM, GUIDES, FOUND_KINDS,
  FRAG_SYSTEM, fragMessages, fragParse, fragPrice, fragMaxTokens, fragParts };
