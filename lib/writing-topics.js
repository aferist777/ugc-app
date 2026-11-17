'use strict';

// ════════════════════════════════════════════════════════════════════════════
// TOPIC MINING — a transcript in, the topics that could each carry their own short out.
//
// THE MODEL NEVER HANDLES TIMECODES. Cues are grouped into numbered blocks, the model answers
// in block indices, and real seconds are substituted back from our own data afterwards. Long
// numbers are exactly the thing language models copy wrong, and a topic that starts at 14:52
// instead of 41:52 is a topic about the wrong part of the video.
//
// Fifteen-second blocks, not thirty: at thirty, up to half a minute of sponsor chatter bleeds
// into a topic's head, and the extra indices cost almost nothing.
//
// The prompt itself lives in lib/writing-prompts.js with the rest of the pack.
// ════════════════════════════════════════════════════════════════════════════

const P = require('./writing-prompts');
// By the agents' ladder (Admin -> AI settings) at effort medium.
const { callLadder } = require('./llm-json');

const BLOCK_SECONDS = 15;
const MAX_TRANSCRIPT_CHARS = 120000;      // ~2.5h of speech; beyond that we refuse with a number
// The answer's ceiling is the ladder's long-work one (lib/llm-json.js callLadder): ten topics of Russian prose fit.

// [{index, start, end, text}] — one block per BLOCK_SECONDS of speech.
function buildBlocks(cues, blockSeconds = BLOCK_SECONDS) {
  const blocks = [];
  let cur = null;
  for (const cue of cues || []) {
    const start = +cue.start || 0;
    if (!cur || start - cur.start >= blockSeconds) {
      cur = { index: blocks.length, start, end: +cue.end || start, parts: [] };
      blocks.push(cur);
    }
    cur.parts.push(String(cue.text || ''));
    cur.end = +cue.end || cur.end;
  }
  return blocks.map(b => ({ index: b.index, start: b.start, end: b.end, text: b.parts.join(' ').trim() }));
}

// Drop a dangling half-sentence at either end of a slice. Blocks are cut on seconds, so a topic
// often opens mid-phrase. A lowercase first character is the reliable tell that we landed inside
// a sentence - trimming on the first full stop alone would eat legitimate short openers.
function trimEdges(text) {
  let body = String(text || '').trim();
  if (!body) return text;
  if (body[0] === body[0].toLowerCase() && body[0] !== body[0].toUpperCase()) {
    const head = body.slice(0, 400);
    for (let i = 0; i < head.length; i++) {
      if ('.!?'.includes(head[i])) { body = body.slice(i + 1).trimStart(); break; }
    }
  }
  if (body && !'.!?'.includes(body[body.length - 1])) {
    const last = Math.max(body.lastIndexOf('.'), body.lastIndexOf('!'), body.lastIndexOf('?'));
    if (last > 0) body = body.slice(0, last + 1);
  }
  return body || text;
}

const _stamp = (s) => {
  const n = Math.floor(+s || 0);
  return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
};

function renderTranscript(blocks) {
  return blocks.map(b => `[${b.index}] ${_stamp(b.start)} ${b.text}`).join('\n');
}

/**
 * @param {object} info  { title, channel, seconds, description }
 * @param {array}  cues  [{start, end, text}]
 * @param {object} opts  onProgress and signal
 * @returns {Promise<{video_summary: string, topics: array, blocks: number}>}
 */
async function extract(info, cues, opts = {}) {
  const blocks = buildBlocks(cues);
  if (!blocks.length) throw new Error('The transcript came back empty.');

  const transcript = renderTranscript(blocks);
  if (transcript.length > MAX_TRANSCRIPT_CHARS) {
    throw new Error(`This transcript is ${Math.round(transcript.length / 1000)}k characters — too long `
      + 'for one pass. A shorter source works.');
  }
  if (opts.onProgress) opts.onProgress(`Finding topics in ${blocks.length} blocks`);

  const user = `Video title: ${info.title || ''}\n`
    + `Channel: ${info.channel || ''}\n`
    + `Length: ${Math.floor((+info.seconds || 0) / 60)} minutes\n\n`
    + `Description:\n${String(info.description || '').slice(0, 1500)}\n\n`
    + `Transcript, one numbered block per ${BLOCK_SECONDS} seconds:\n${transcript}`;

  const { data, by } = await callLadder({
    system: P.TOPICS_SYSTEM, user, schema: P.TOPICS_SCHEMA, name: 'topics', effort: 'medium',
    // A source being added can be stopped while its topics are found.
    signal: opts.signal || undefined,
  });

  // Indices are CLAMPED, not trusted. A model that answers 999 for a 60-block transcript would
  // otherwise slice an empty span and produce a topic with no text and NaN timings.
  const last = blocks.length - 1;
  const topics = [];
  for (const raw of data.topics || []) {
    const startIndex = Math.max(0, Math.min(last, parseInt(raw.start_block, 10) || 0));
    const endIndex = Math.max(startIndex, Math.min(last, parseInt(raw.end_block, 10) || startIndex));
    const span = blocks.slice(startIndex, endIndex + 1);
    if (!span.length) continue;
    topics.push({
      id: 't' + startIndex + '_' + endIndex,
      title: String(raw.title || '').trim(),
      summary: String(raw.summary || '').trim(),
      projectName: String(raw.project_name || raw.title || '').trim().slice(0, 60),
      start: span[0].start,
      end: span[span.length - 1].end,
      blocks: [startIndex, endIndex],
      text: trimEdges(span.map(b => b.text).join(' ')),
      usedBy: [],
    });
  }
  // `noTopics`: a source being added that yields none is not kept as a source (lib/source-intake.js).
  if (!topics.length) throw Object.assign(new Error('No topics came back for this video.'), { noTopics: true });

  return {
    videoSummary: String(data.video_summary || '').trim(),
    topics,
    blocks: blocks.length,
    // The step of the ladder that read them.
    by,
  };
}

module.exports = {
  BLOCK_SECONDS, MAX_TRANSCRIPT_CHARS,
  buildBlocks, trimEdges, renderTranscript, extract,
};
