'use strict';

// ════════════════════════════════════════════════════════════════════════════
// SCRIPT GENERATION — the four calls, in the order they run.
//
//   GET  /api/scriptgen/models              -> the Provider / Model / Effort registry
//   POST /api/scriptgen/hooks               -> { jobId }  five openings, differing in kind
//   POST /api/scriptgen/script              -> { jobId }  title + paragraphs
//   POST /api/scriptgen/humanize            -> { jobId }  the same paragraphs, cleaned
//   POST /api/scriptgen/rewrite             -> { jobId }  one paragraph, another angle
//   POST /api/scriptgen/save                -> { scenario }  into the scenarios store
//   GET  /api/scriptgen/jobs/:jobId         -> { state, step, error, result }
//
// WHY JOBS: a reasoning model writing fifteen paragraphs from a ten-minute transcript takes
// longer than any sane request timeout, and the humanizer takes as long again. The client polls;
// nothing is held open.
//
// THE NARRATOR IS RESOLVED HERE, not sent from the page. The page passes an id, this reads the
// profile and renders it into the block the prompts expect. A page that could post its own
// narrator block would be a page that could quietly write in a voice nobody saved.
//
// THE SOURCE TEXT IS ALSO RESOLVED HERE, for the same reason and one more: a topic's text is
// the slice of transcript it was mined from, and letting the client send it would mean the model
// could be given text no source contains, then have facts "taken only from the transcript".
// ════════════════════════════════════════════════════════════════════════════

const express = require('express');

const P = require('../lib/writing-prompts');
const WM = require('../lib/writing-models');
const { callJSON } = require('../lib/llm-json');
const narrators = require('../lib/narrators-store');
const sources = require('../lib/sources-store');
const scen3 = require('./scen3');
const drafts = require('../lib/script-drafts');

const router = express.Router();

// The scenarios store refuses a new scenario with fewer than this many lines, so a script
// shorter than it cannot be saved. Named here because the wizard has to say so BEFORE spending
// a generation, not after.
const MIN_LINES = 5;

const _jobs = {};
const _newJobId = () => 'gj_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function _sweep() {
  const cutoff = Date.now() - 3600000;
  for (const [id, job] of Object.entries(_jobs)) {
    if (job.state !== 'running' && (job.at || 0) < cutoff) delete _jobs[id];
  }
}

// Runs one stage as a job. The whole body is here rather than repeated four times: every stage
// is "start, report, either a result or a sentence".
//
// `keep` is how a finished generation reaches the draft even if nobody is watching. The page saves
// the result too, and both are upserts on the same row, so this is belt and braces rather than a
// race - but without it, closing the tab while a script is being written throws the script away
// after it has been paid for.
function _start(res, step, work, keep) {
  const jobId = _newJobId();
  const job = _jobs[jobId] = { state: 'running', step, at: Date.now(), error: null, result: null };
  res.json({ success: true, jobId });
  (async () => {
    try {
      job.result = await work((s) => { job.step = s; });
      job.state = 'done';
      job.step = 'done';
      job.at = Date.now();
      if (keep) { try { keep(job.result); } catch (e) { /* the result stands even unsaved */ } }
    } catch (e) {
      job.state = 'error';
      job.error = e.message;
      job.at = Date.now();
    }
  })();
}

// What the prompts call the narrator block: a real profile, or the neutral rules. Asking for a
// narrator that has no profile yet is not an error - it means "write plainly", which is what
// neutral is - but it IS worth saying which one was used, so the answer carries the name.
//
// WHICH READING is picked here, not sent from the page, for the same reason the block is built
// here: a page that could choose its own profile could write in a voice nobody saved. Random by
// default; `readingId` pins one. The answer says which, because "why does this one sound different"
// is a question you can only answer if the reading is recorded.
function _narrator(id, readingId) {
  if (!id || id === 'neutral') {
    return { block: P.NEUTRAL_BLOCK, name: 'Neutral', id: 'neutral', reading: null };
  }
  const rec = narrators.get(id);
  if (!rec) throw new Error('No such narrator.');
  const pick = narrators.pickReading(rec, readingId);
  return {
    block: P.narratorBlock(pick ? { ...rec, profile: pick.profile } : rec),
    name: rec.name, id: rec.id, ready: !!pick,
    reading: pick ? { id: pick.id, index: pick.index, total: pick.total, random: pick.random } : null,
  };
}

// "Azazin, reading 2 of 3 (random)" - short enough for a step line, specific enough to reproduce.
function _readingLabel(nar) {
  if (!nar.reading || nar.reading.total < 2) return nar.name;
  return `${nar.name}, reading ${nar.reading.index} of ${nar.reading.total}`
    + (nar.reading.random ? ' (random)' : '');
}

// The transcript slice a topic was mined from, or nothing. `sourceId` alone means the whole
// transcript; with `topicId` it is that topic's own span, which is what makes "select, do not
// summarise" a smaller job than reading two hours.
function _sourceText(sourceId, topicId) {
  if (!sourceId) return { text: '', sourceTitle: '', topicTitle: '' };
  const rec = sources.get(sourceId);
  if (!rec) throw new Error('No such source.');
  if (topicId) {
    const topic = (rec.topics || []).find(t => String(t.id) === String(topicId));
    if (!topic) throw new Error('No such topic on that source.');
    return { text: topic.text || '', sourceTitle: rec.title, topicTitle: topic.title };
  }
  const t = sources.readTranscript(sourceId);
  const text = t && Array.isArray(t.cues) ? t.cues.map(c => c.text).join(' ') : '';
  return { text, sourceTitle: rec.title, topicTitle: '' };
}

// Builds the `keep` for a stage: what to write into the draft when the generation lands. Returns
// null when there is nowhere to write it - a free-form draft the page has not saved yet cannot be
// found again from here, and inventing a second row is worse than losing one retry.
//
// The settings and the topic go in alongside the result, because a row that holds five hooks and
// nothing else is not resumable: it has no name and no dropdowns to reopen.
function _keeper(b, build) {
  const id = String(b.draftId || '');
  const sourceId = String(b.sourceId || '');
  const topicId = String(b.topicId || '');
  if (!id && !(sourceId && topicId)) return null;
  let titles = { sourceTitle: '', topicTitle: '' };
  try { titles = _sourceText(sourceId, topicId); } catch (e) { /* titles are decoration here */ }
  return (result) => {
    const patch = build(result);
    if (!patch) return;
    drafts.save({
      id: id || undefined,
      sourceId, topicId,
      sourceTitle: titles.sourceTitle, topicTitle: titles.topicTitle,
      topic: String(b.topic || ''),
      settings: {
        language: b.language, tone: b.tone, scenes: b.scenes,
        narratorId: b.narratorId, narratorName: b.narratorName, readingIndex: b.readingIndex,
        provider: b.provider, model: b.model, effort: b.effort,
      },
      ...patch,
    });
  };
}

// ── reading ─────────────────────────────────────────────────────────────────

router.get('/scriptgen/models', (_req, res) => {
  res.json({
    success: true,
    providers: WM.providers(),
    efforts: WM.EFFORTS,
    languages: WM.LANGUAGES,
    tones: WM.TONES,
    scenes: { min: Math.max(WM.SCENES_MIN, MIN_LINES), max: WM.SCENES_MAX, default: WM.DEFAULTS.scenes },
    defaults: WM.DEFAULTS,
    minLines: MIN_LINES,
  });
});

router.get('/scriptgen/jobs/:jobId', (req, res) => {
  _sweep();
  const job = _jobs[String(req.params.jobId)];
  if (!job) return res.status(404).json({ success: false, error: 'no such job' });
  res.json({ success: true, ...job });
});

// ── the stages ──────────────────────────────────────────────────────────────

router.post('/scriptgen/hooks', (req, res) => {
  const b = req.body || {};
  const topic = String(b.topic || '').trim();
  if (!topic) return res.status(400).json({ success: false, error: 'a topic is required' });
  let nar, src, m;
  try {
    nar = _narrator(b.narratorId, b.readingId);
    src = _sourceText(b.sourceId, b.topicId);
    m = WM.normalise(b);
  } catch (e) { return res.status(400).json({ success: false, error: e.message }); }

  _start(res, 'Writing hooks', async () => {
    const data = await callJSON({
      system: P.HOOKS_SYSTEM,
      user: P.hooksUserPrompt({ topic, language: m.language, tone: m.tone,
        narratorBlock: nar.block, sourceText: src.text }),
      schema: P.HOOKS_SCHEMA, name: 'hooks',
      provider: m.provider, model: m.model, effort: m.effort,
    });
    const hooks = (data.hooks || []).filter(h => h && h.text);
    if (!hooks.length) throw new Error('No hooks came back.');
    return { hooks, narrator: _readingLabel(nar), reading: nar.reading, model: m.model };
  }, _keeper(b, (r) => ({ hooks: r.hooks })));
});

router.post('/scriptgen/script', (req, res) => {
  const b = req.body || {};
  const topic = String(b.topic || '').trim();
  const hook = String(b.hook || '').trim();
  if (!topic) return res.status(400).json({ success: false, error: 'a topic is required' });
  if (!hook) return res.status(400).json({ success: false, error: 'pick or write a hook first' });
  let nar, src, m;
  try {
    nar = _narrator(b.narratorId, b.readingId);
    src = _sourceText(b.sourceId, b.topicId);
    m = WM.normalise(b);
  } catch (e) { return res.status(400).json({ success: false, error: e.message }); }

  _start(res, `Writing ${m.scenes} paragraphs`, async (step) => {
    // WITH a transcript the rules change, not just the input: "select, do not summarise" and
    // "facts only from the transcript" only make sense when there is one.
    const withSource = !!src.text;
    if (withSource) step(`Writing ${m.scenes} paragraphs from ${Math.round(src.text.length / 1000)}k of transcript`);
    const data = await callJSON({
      system: withSource ? P.SOURCE_SCRIPT_SYSTEM : P.SCRIPT_SYSTEM,
      user: withSource
        ? P.sourceScriptUserPrompt({ hook, topic, language: m.language, paragraphs: m.scenes,
          tone: m.tone, narratorBlock: nar.block, sourceText: src.text })
        : P.scriptUserPrompt({ topic, language: m.language, paragraphs: m.scenes,
          tone: m.tone, narratorBlock: nar.block, hook }),
      schema: P.SCRIPT_SCHEMA, name: 'script',
      provider: m.provider, model: m.model, effort: m.effort,
    });
    const paragraphs = (data.paragraphs || []).map(p => String(p || '').trim()).filter(Boolean);
    if (!paragraphs.length) throw new Error('The script came back empty.');
    return {
      title: String(data.title || topic).slice(0, 80),
      paragraphs,
      asked: m.scenes,
      fromSource: withSource,
      narrator: _readingLabel(nar),
      reading: nar.reading,
      model: m.model,
    };
  }, _keeper(b, (r) => ({ paragraphs: r.paragraphs, title: r.title, hook, humanized: false })));
});

router.post('/scriptgen/humanize', (req, res) => {
  const b = req.body || {};
  const paragraphs = (Array.isArray(b.paragraphs) ? b.paragraphs : []).map(p => String(p || '').trim()).filter(Boolean);
  if (paragraphs.length < 2) return res.status(400).json({ success: false, error: 'nothing to clean' });
  let nar, m;
  try { nar = _narrator(b.narratorId, b.readingId); m = WM.normalise(b); }
  catch (e) { return res.status(400).json({ success: false, error: e.message }); }

  // The hook is the FIRST paragraph and is fixed. It is sent as context and not returned, so it
  // is held here and put back afterwards - the editor never gets to rewrite the opening line.
  const hook = paragraphs[0];
  const rest = paragraphs.slice(1);
  if (!rest.length) return res.status(400).json({ success: false, error: 'only the hook — nothing to clean' });

  _start(res, `Cleaning ${rest.length} paragraphs`, async () => {
    const data = await callJSON({
      system: P.HUMANIZER_SYSTEM,
      user: P.humanizerUserPrompt({ paragraphs: rest, narratorBlock: nar.block, hook }),
      schema: P.HUMANIZER_SCHEMA, name: 'humanized',
      provider: m.provider, model: m.model, effort: m.effort,
    });
    const cleaned = (data.paragraphs || []).map(p => String(p || '').trim()).filter(Boolean);
    // A count that does not match means the editor dropped or merged beats. The original wins
    // rather than a script quietly losing a paragraph.
    const kept = cleaned.length === rest.length;
    return {
      paragraphs: [hook, ...(kept ? cleaned : rest)],
      applied: kept,
      note: kept ? '' : `The editor returned ${cleaned.length} paragraphs for ${rest.length} — kept the original.`,
      narrator: _readingLabel(nar),
      reading: nar.reading,
    };
  }, _keeper(b, (r) => ({ paragraphs: r.paragraphs, humanized: !!r.applied })));
});

router.post('/scriptgen/rewrite', (req, res) => {
  const b = req.body || {};
  const script = (Array.isArray(b.script) ? b.script : []).map(p => String(p || ''));
  const index = parseInt(b.index, 10);
  if (!script.length) return res.status(400).json({ success: false, error: 'no script' });
  if (!Number.isInteger(index) || index < 0 || index >= script.length) {
    return res.status(400).json({ success: false, error: 'no such paragraph' });
  }
  if (index === 0) {
    return res.status(400).json({ success: false, error: 'the first paragraph is the hook — change the hook instead' });
  }
  let m;
  try { m = WM.normalise(b); } catch (e) { return res.status(400).json({ success: false, error: e.message }); }
  const topic = String(b.topic || '').trim();

  _start(res, `Rewriting paragraph ${index + 1}`, async () => {
    const data = await callJSON({
      system: P.REWRITE_SYSTEM,
      user: P.rewriteUserPrompt({ topic, language: m.language, tone: m.tone, script, index }),
      schema: P.REWRITE_SCHEMA, name: 'rewrite',
      provider: m.provider, model: m.model, effort: m.effort,
    });
    const paragraph = String(data.paragraph || '').trim();
    if (!paragraph) throw new Error('The rewrite came back empty.');
    return { index, paragraph };
  });
});

// ── into the scenarios store ────────────────────────────────────────────────
// Through the store's own createScenario, which owns the id, the three gates and the
// normalising. Not over HTTP to ourselves, and not by writing the file from here.
router.post('/scriptgen/save', (req, res) => {
  const b = req.body || {};
  const title = String(b.title || '').trim();
  const paragraphs = (Array.isArray(b.paragraphs) ? b.paragraphs : []).map(p => String(p || '').trim()).filter(Boolean);
  if (!title) return res.status(400).json({ success: false, error: 'a title is required' });
  if (paragraphs.length < MIN_LINES) {
    return res.status(400).json({ success: false,
      error: `the scenarios store needs at least ${MIN_LINES} lines — this script has ${paragraphs.length}` });
  }
  // The third gate, said here rather than let through to a 500: the store reads the narrator's
  // gender off the first role, and refuses a scenario without one.
  const gender = String(b.gender || '').toLowerCase();
  if (!['male', 'female'].includes(gender)) {
    return res.status(400).json({ success: false, error: 'a narrator gender is required (male or female)' });
  }

  let nar = { name: '', id: '' };
  try { if (b.narratorId) nar = _narrator(b.narratorId, b.readingId); } catch (e) { /* a deleted narrator is not a reason to lose the script */ }
  let srcTitles = { sourceTitle: '', topicTitle: '' };
  try { srcTitles = _sourceText(b.sourceId, b.topicId); } catch (e) { /* same */ }

  const payload = {
    title,
    lines: paragraphs.map(text => ({ text })),
    vertical: String(b.vertical || ''),
    product: String(b.product || ''),
    roles: Array.isArray(b.roles) && b.roles.length ? b.roles
      : [{ id: 'r0', name: String(b.role || 'narrator'), gender }],
    origin: {
      sourceId: String(b.sourceId || ''), sourceTitle: srcTitles.sourceTitle,
      topicId: String(b.topicId || ''), topicTitle: srcTitles.topicTitle,
      narratorId: nar.id, narratorName: nar.name,
      // WHICH reading wrote it. Two scripts by the same narrator that do not sound alike are
      // explained by this line and by nothing else in the record.
      narratorReadingId: (nar.reading && nar.reading.id) || '',
      narratorReading: nar.reading && nar.reading.total > 1
        ? `reading ${nar.reading.index} of ${nar.reading.total}` : '',
      hook: paragraphs[0] || '', language: String(b.language || ''), tone: String(b.tone || ''),
      model: String(b.model || ''), humanized: !!b.humanized, at: new Date().toISOString(),
    },
  };

  try {
    const scenario = scen3.createScenario(payload);
    // The topic remembers what came out of it. Written AFTER the scenario exists, so a mark can
    // never point at a scenario that was refused - and mining a source again replaces its topics,
    // which is why this lives on the topic rather than in a table of its own.
    let marked = false;
    if (b.sourceId && b.topicId) {
      try {
        const rec = sources.get(b.sourceId);
        const topics = (rec && rec.topics) || [];
        const i = topics.findIndex(t => String(t.id) === String(b.topicId));
        if (i >= 0) {
          const used = Array.isArray(topics[i].usedBy) ? topics[i].usedBy.slice() : [];
          used.push({ id: String(scenario.id), title: scenario.title, at: new Date().toISOString() });
          const next = topics.slice();
          next[i] = { ...topics[i], usedBy: used };
          sources.update(b.sourceId, { topics: next });
          marked = true;
        }
      } catch (e) { /* the scenario is saved; a missing mark is not worth losing it over */ }
    }
    // The draft has become a scenario, so it goes. Two records claiming to be the same script
    // would leave the next reader asking which one is real. By id AND by source+topic, because
    // the page may be saving from a draft it reopened rather than one it created.
    const draftsGone = drafts.removeFor({ id: b.draftId, sourceId: b.sourceId, topicId: b.topicId });

    res.json({ success: true, scenario, topicMarked: marked, draftsRemoved: draftsGone });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

module.exports = router;
