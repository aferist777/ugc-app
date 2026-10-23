'use strict';

// ════════════════════════════════════════════════════════════════════════════
// SCRIPT GENERATION — the four calls, in the order they run.
//
//   GET  /api/scriptgen/models              -> tones, scenes and the agents' ladder that writes (V37)
//   POST /api/scriptgen/hooks               -> { jobId }  five openings, differing in kind
//   POST /api/scriptgen/script              -> { jobId }  title + paragraphs
//   POST /api/scriptgen/humanize            -> { jobId }  the same paragraphs, cleaned
//   POST /api/scriptgen/rewrite             -> { jobId }  one paragraph, another angle
//   POST /api/scriptgen/save                -> { scenario }  into the scenarios store
//   GET  /api/scriptgen/jobs/:jobId         -> { state, step, error, result }
//   GET  /api/scriptgen/drafts              -> { drafts: [summary + running] }
//   GET  /api/scriptgen/drafts/:id          -> { draft, running }
//   POST /api/scriptgen/drafts              -> { draft }   create or update
//   DELETE /api/scriptgen/drafts/:id        -> { success }  refused while a stage writes into it
//
// ONE STAGE AT A TIME PER DRAFT (phase E5). A stage that is running is marked on its draft, a second
// start of anything on that draft is refused with 409 and the job that IS running, and the drafts
// list carries the mark - so a page opened later follows the job instead of paying for it twice.
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
//
// BY THE AGENTS' LADDER (phase V37, the owner 2026-10-23: "из формы сценариев выбор модели убираем. идем по лестнице"):
// every stage is asked of Admin -> AI settings' ladder at effort medium (lib/llm-json.js callLadder) - no model is
// chosen in the form any more. What WROTE it is the step that answered (`written`, `cleaned`, the scenario's `origin`);
// a draft or scenario from before keeps the model its form chose. Paid once: a step that did not finish stops the ladder.
// ════════════════════════════════════════════════════════════════════════════

const express = require('express');

const P = require('../lib/writing-prompts');
const WM = require('../lib/writing-models');
const { callLadder } = require('../lib/llm-json');
const AGENTS = require('../lib/agents');

// (V37) The effort every stage is asked at (the owner's (л1)), and the ladder's first step - what a stage is expected to
// take, for the page's countdown (the owner's (л7)).
const EFFORT = 'medium';
const _first = () => { const l = AGENTS.ladder(); return (l && l[0]) || { provider: '', model: '' }; };
const narrators = require('../lib/narrators-store');
const sources = require('../lib/sources-store');
const scen3 = require('./scen3');
const drafts = require('../lib/script-drafts');
const AGENT = require('../lib/mv3-agent');

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
//
// `run` marks the draft the stage writes into: { key, what, ... } - see _runKey.
//
// A STAGE CAN BE CANCELLED (phase G1, /scriptgen/jobs/:id/cancel): `work` gets an AbortSignal as its
// second argument and hands it to callLadder. A cancelled job keeps state 'cancelled' whatever its call
// does afterwards - an answer that arrives anyway is not kept - and its draft is free at once.
function _start(res, step, work, keep, run) {
  const key = (run && run.key) || '';
  const busy = key ? _running.get(key) : null;
  if (busy && _jobs[busy.jobId] && _jobs[busy.jobId].state === 'running') {
    return res.status(409).json({ success: false, error: `This draft is already being written (${busy.what}).`, ...busy });
  }
  const jobId = _newJobId();
  const job = _jobs[jobId] = { state: 'running', step, at: Date.now(), error: null, result: null };
  const ac = new AbortController();
  _aborts.set(jobId, { ac, key });
  if (key) {
    const rest = { ...run };
    delete rest.key;
    _running.set(key, { ...rest, jobId, startedAt: job.at });
  }
  res.json({ success: true, jobId });
  // (V38) A stage of two steps says when the second one starts - the script written, the narrator's words going in - so
  // the page shows a second countdown, at its real age after a reload too (the draft's mark carries it).
  const phase = (name) => {
    if (job.state !== 'running') return;
    job.phase = { name, at: Date.now() };
    const r = key ? _running.get(key) : null;
    if (r && r.jobId === jobId) r.phase = job.phase;
  };
  (async () => {
    try {
      const result = await work((s) => { if (job.state === 'running') job.step = s; }, ac.signal, phase);
      if (job.state !== 'running') return;          // cancelled meanwhile: the answer is not kept
      job.result = result;
      job.state = 'done';
      job.step = 'done';
      job.at = Date.now();
      if (keep) { try { keep(job.result); } catch (e) { /* the result stands even unsaved */ } }
    } catch (e) {
      if (job.state !== 'running') return;
      job.state = 'error';
      job.error = e.message;
      job.at = Date.now();
    } finally {
      _aborts.delete(jobId);
      // The mark goes after the keeper has written, in the same tick: whoever sees the draft free
      // also sees the answer in it.
      if (key && _running.get(key) && _running.get(key).jobId === jobId) _running.delete(key);
    }
  })();
}

// The running jobs' cancel handles: jobId -> { ac, key }. In memory, like the jobs.
const _aborts = new Map();

// What is writing into which draft: 'd:<draftId>' -> { jobId, startedAt, what, model, effort,
// scenes, index }. In memory, like the jobs themselves: a restart ends both.
const _running = new Map();

// The draft a stage writes into. By id; a stage sent with a source and topic but no id (the retired Library 2
// did that) is keyed by the draft that source and topic already have, so both ways in meet.
function _runKey(b) {
  const id = String((b && b.draftId) || '');
  if (id) return 'd:' + id;
  const s = String((b && b.sourceId) || ''), t = String((b && b.topicId) || '');
  if (!s || !t) return '';
  const d = drafts.list().find(x => String(x.sourceId) === s && String(x.topicId) === t);
  return d ? 'd:' + d.id : 's:' + s + '|' + t;
}

function _runningFor(d) {
  if (!d) return null;
  return _running.get('d:' + d.id)
    || (d.sourceId && d.topicId ? _running.get('s:' + d.sourceId + '|' + d.topicId) : null)
    || null;
}

// What the prompts call the narrator block: a real profile, or the neutral rules. Asking for a
// narrator that has no profile yet is not an error - it means "write plainly", which is what
// neutral is - but it IS worth saying which one was used, so the answer carries the name.
//
// ONE NARRATOR, ONE VOICE (phase V38, the owner 2026-10-23): no reading is drawn or pinned any more - the narrator's
// voice is the block. A `readingId` an older page or draft still sends is not read.
function _narrator(id) {
  if (!id || id === 'neutral') {
    return { block: P.NEUTRAL_BLOCK, name: 'Neutral', id: 'neutral', rec: null };
  }
  const rec = narrators.get(id);
  if (!rec) throw new Error('No such narrator.');
  return { block: P.narratorBlock(rec), name: rec.name, id: rec.id, ready: narrators.hasVoice(rec), rec };
}

// ── the narrator's words and phrases (phase V38) ────────────────────────────
// After the script is written the same job puts the narrator's own words and phrases into it (the owner's (д5): "сразу
// после написания, само"), in the measure the form asks (`density`: off | light | normal | rich - the owner's (д6), (д18)).
// The writer is given the whole set switched on (the owner's (д12): no separate search - Jev is not made) and answers the
// paragraphs and what it put in; the SERVER checks what comes back: as many paragraphs as were sent (else the script
// stays as it was), the hook never sent and put back, a paragraph that grew by more than a fifth - or changed with
// nothing put in - kept as it was, and an entry counted as put in only when it is of the set and is in its paragraph.

const DENSITIES = ['off', 'light', 'normal', 'rich'];
const _density = (d) => (DENSITIES.includes(d) ? d : 'normal');
const _words = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;

/**
 * The enrichment of a script by its narrator's set. Null when there is nothing to do (no narrator, no set, density off).
 * @param {object} nar  _narrator()
 * @param {string[]} paragraphs  the whole script, the hook first
 * @param {object} o  { density, already: [{ list, id }], signal }
 * @returns {Promise<null|{ paragraphs, used, notes, by, density }>}
 */
async function _enrich(nar, paragraphs, o = {}) {
  const density = _density(o.density);
  if (!nar || !nar.rec || density === 'off') return null;
  const set = narrators.writerSet(nar.rec);
  if (!set.size) return null;
  const hook = paragraphs[0];
  const rest = paragraphs.slice(1);
  if (!rest.length) return null;
  const already = (o.already || []).map(u => Object.keys(set.refs).find(r => set.refs[r].id === u.id && set.refs[r].list === u.list)).filter(Boolean);
  const { data, by } = await callLadder({
    system: P.ENRICH_SYSTEM,
    user: P.enrichUserPrompt({ hook, paragraphs: rest, set, measure: P.measureFor(density, rest.length), already }),
    schema: P.ENRICH_SCHEMA, name: 'enriched', effort: EFFORT, signal: o.signal,
  });
  const back = (data.paragraphs || []).map(p => String(p || '').trim());
  if (back.length !== rest.length || back.some(p => !p)) {
    return { paragraphs, used: [], by, density,
      notes: [`The editor returned ${back.filter(Boolean).length} paragraphs for ${rest.length} - the script was kept as it was.`] };
  }
  const notes = [];
  // What it says it put in, checked: of the set, into a paragraph it was given, and there in the text.
  const claimed = new Map();
  const unfound = [];
  const misplaced = [];
  // Where it went in: the paragraph the answer names, numbered from 2 (the hook is 1) - and when the entry is not new
  // there, the paragraph it IS new in (the paid check: Claude counted from 1 in its own answer).
  const isNew = (e, j) => j >= 0 && j < back.length && narrators.appearsIn(e.text, back[j]) && !narrators.appearsIn(e.text, rest[j]);
  for (const u of data.used || []) {
    const ref = String(u.ref || '').trim().replace(/^\[|\]$/g, '').toLowerCase();
    const e = set.refs[ref];
    if (!e) { unfound.push(ref || '?'); continue; }
    const n = parseInt(u.paragraph, 10) || 0;
    let i = [n - 2, n - 1].find(j => isNew(e, j));
    if (i == null) i = back.findIndex((p, j) => isNew(e, j));
    if (i == null || i < 0) {
      // Already in the script before this pass (the writer took it from the voice - the paid check's "Wild, right?"):
      // not put in now, and not a fault either.
      if (!back.some((p, j) => narrators.appearsIn(e.text, p) && narrators.appearsIn(e.text, rest[j]))) unfound.push(`"${e.text}"`);
      continue;
    }
    // (the owner's (д8)) An opening line only at the start of the paragraph after the hook, a closing one only in the last.
    if (e.list === 'phrases' && ((e.place === 'opening' && i !== 0) || (e.place === 'ending' && i !== back.length - 1))) {
      misplaced.push(i + 2);
      continue;
    }
    if (!claimed.has(i)) claimed.set(i, []);
    if (!claimed.get(i).some(x => x.id === e.id)) claimed.get(i).push({ list: e.list, id: e.id, text: e.text, paragraph: i + 2 });
  }
  const out = rest.slice();
  const used = [];
  const grew = [];
  const bare = [];
  back.forEach((p, i) => {
    if (p === rest[i]) return;
    if (misplaced.includes(i + 2)) return;
    // Changed with nothing of the set in it: not this editor's job - the script's own words stay.
    if (!claimed.has(i)) { bare.push(i + 2); return; }
    if (_words(p) > Math.ceil(_words(rest[i]) * 1.2) + 1) { grew.push(i + 2); return; }
    out[i] = p;
    used.push(...claimed.get(i));
  });
  // Said, so a pass that put nothing in is not a silence (the paid check: one answer changed paragraphs and named
  // nothing the server could find).
  const list = (ns) => (ns.length === 1 ? `Paragraph ${ns[0]}` : `Paragraphs ${ns.join(', ')}`);
  if (grew.length) notes.push(`${list(grew)} grew by more than a fifth - kept as ${grew.length === 1 ? 'it was' : 'they were'}.`);
  const mis = [...new Set(misplaced)];
  if (mis.length) notes.push(`${list(mis)} got an opening or closing line of his in the wrong place - kept as ${mis.length === 1 ? 'it was' : 'they were'}.`);
  if (bare.length) notes.push(`${list(bare)} came back changed with none of his words or phrases in ${bare.length === 1 ? 'it' : 'them'} - kept as ${bare.length === 1 ? 'it was' : 'they were'}.`);
  if (unfound.length) notes.push(`Named as put in but not found in the text: ${unfound.slice(0, 4).join(', ')}${unfound.length > 4 ? '…' : ''}.`);
  return { paragraphs: [hook, ...out], used, by, density, notes };
}

// What a draft's enrichment becomes once stored: what was put in, by whom, or why it did not happen.
function _enrichedRecord(r, prev) {
  if (!r) return prev || null;
  const keep = (prev && Array.isArray(prev.used)) ? prev.used : [];
  const seen = new Set(keep.map(u => u.list + ':' + u.id));
  return {
    density: r.density || (prev && prev.density) || '',
    used: [...keep, ...(r.used || []).filter(u => !seen.has(u.list + ':' + u.id))],
    by: r.by || null, at: new Date().toISOString(), error: '',
  };
}

// ── a scenario of the shelf, in the narrator's voice (phase V38, block D4) ─────
// "Rewrite in a narrator's voice" on a scenario makes a DRAFT of its lines (`from`, `foreign`); the generator's cleaning
// press on such a draft is this stronger pass - every line, the first too, as many lines, each about as long (the
// owner's (д10)) - and then, in the same job, the narrator's words and phrases. Saving it makes a NEW scenario that says
// which one it came from; the one on the shelf is not touched.

router.post('/scriptgen/from-scenario', (req, res) => {
  const s = scen3.getScenario(String((req.body || {}).scenarioId || ''));
  if (!s) return res.status(404).json({ success: false, error: 'no such scenario' });
  const lines = (s.lines || []).map(l => String((l && l.text) || '').trim()).filter(Boolean);
  if (lines.length < scen3.MIN_LINES) {
    return res.status(400).json({ success: false, error: `the scenario has ${lines.length} lines - at least ${scen3.MIN_LINES} are needed` });
  }
  // Its narrator, when it has one that still exists - its own label first, then the one that wrote it.
  const want = (s.narrator && s.narrator.id) || (s.origin && s.origin.narratorId) || '';
  const nar = want ? narrators.get(want) : null;
  const role = (s.roles || [])[0] || {};
  const tone = WM.TONES.includes((s.origin || {}).tone) ? s.origin.tone : WM.DEFAULTS.tone;
  try {
    const draft = drafts.save({
      topic: s.title || '', title: s.title || '', hook: lines[0], paragraphs: lines, humanized: false,
      from: { scenarioId: String(s.id), title: s.title || '' }, foreign: true,
      settings: {
        tone, scenes: Math.min(WM.SCENES_MAX, Math.max(MIN_LINES, lines.length)),
        narratorId: nar ? nar.id : 'neutral', narratorName: nar ? nar.name : 'Neutral', density: 'normal',
      },
      save: { gender: role.gender || '', vertical: s.vertical || '', product: s.product || '' },
    });
    res.json({ success: true, draft });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

function _voice(res, b, nar, lines) {
  if (!nar.rec) return res.status(400).json({ success: false, error: 'Choose the narrator whose voice it is to be rewritten in.' });
  if (!narrators.hasVoice(nar.rec)) return res.status(400).json({ success: false, error: `${nar.name} has no voice yet - read his samples first (Narrators).` });
  const density = _density(b.density);
  const enrich = density !== 'off' && narrators.writerSet(nar.rec).size > 0;
  const keep = _keeper(b, (r) => ({
    paragraphs: r.paragraphs, hook: r.paragraphs[0] || '', foreign: !r.applied, humanized: !!r.applied,
    ...(r.applied ? {
      written: { provider: r.by.provider, model: r.by.model, effort: EFFORT, at: new Date().toISOString() },
      cleaned: null,
    } : {}),
    enriched: r.enriched ? _enrichedRecord(r.enriched, null)
      : r.enrichError ? { density, used: [], error: r.enrichError } : null,
  }));
  _start(res, `Rewriting ${lines.length} lines in ${nar.name}'s voice`, async (step, signal, phase) => {
    const { data, by } = await callLadder({
      system: P.VOICE_SYSTEM,
      user: P.voiceUserPrompt({ lines, narratorBlock: nar.block }),
      schema: P.VOICE_SCHEMA, name: 'voiced', effort: EFFORT, signal,
    });
    const back = (data.paragraphs || []).map(p => String(p || '').trim()).filter(Boolean);
    // As many lines as were given, or the scenario stays as it was: a line lost is a beat of the story lost.
    if (back.length !== lines.length) {
      return { paragraphs: lines, applied: false, voice: true, by, narrator: nar.name,
        note: `The editor returned ${back.length} lines for ${lines.length} - the scenario was kept as it was; press again.` };
    }
    // About as long as the line it replaces (the owner's (д10)) - told, and said where it is not.
    const off = back.map((p, i) => [i + 1, _words(p), _words(lines[i])]).filter(([, w, was]) => w > Math.ceil(was * 1.2) + 1 || w < Math.floor(was * 0.8) - 1);
    const out = { paragraphs: back, applied: true, voice: true, by, narrator: nar.name, density,
      notes: off.length ? [`${off.length === 1 ? 'Line' : 'Lines'} ${off.map(x => x[0]).join(', ')} came back more than a fifth ${off.length === 1 ? 'longer or shorter than it was' : 'longer or shorter than they were'}.`] : [] };
    if (enrich) {
      if (keep) { try { keep(out); } catch (e) { /* the job's own landing writes it again */ } }
      phase('enrich');
      step('Adding the narrator\'s words and phrases');
      try {
        const e = await _enrich(nar, back, { density, signal });
        if (e) { out.paragraphs = e.paragraphs; out.enriched = e; out.notes = out.notes.concat(e.notes || []); }
      } catch (err) {
        if (err && err.cancelled) throw err;
        out.enrichError = err.message;
      }
    }
    return out;
  }, keep, { key: _runKey(b), what: 'humanize', voice: true, model: _first().model, effort: EFFORT, density });
}

// The narrator's set at the light measure, for a rewrite: told, never required (the owner's (д13)).
function _setText(nar) {
  if (!nar || !nar.rec) return '';
  const set = narrators.writerSet(nar.rec);
  return set.size ? P.renderSet(set) : '';
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
//
// WHERE IT IS WRITTEN FROM is decided when the answer lands, not when the stage started: a draft
// detached meanwhile - its source deleted, its topic gone with a new reading of the topics - stays
// detached (phase E), or the ids this stage started with would point it at nothing again.
function _whereNow(sourceId, topicId) {
  const rec = sourceId ? sources.get(sourceId) : null;
  if (!rec) return null;
  if (!topicId) return { sourceTitle: rec.title || '', topicTitle: '' };
  const t = (rec.topics || []).find(x => String(x.id) === String(topicId));
  return t ? { sourceTitle: rec.title || '', topicTitle: t.title || '' } : null;
}

function _keeper(b, build) {
  const id = String(b.draftId || '');
  const sourceId = String(b.sourceId || '');
  const topicId = String(b.topicId || '');
  if (!id && !(sourceId && topicId)) return null;
  return (result) => {
    const patch = build(result);
    if (!patch) return;
    const cur = id ? drafts.get(id) : null;
    const detached = cur && String(cur.sourceId || '') !== sourceId;
    const now = detached ? null : _whereNow(sourceId, topicId);
    drafts.save({
      id: id || undefined,
      ...(now ? { sourceId, topicId, sourceTitle: now.sourceTitle, topicTitle: now.topicTitle } : {}),
      // Only when the stage was sent one: the cleaning pass is not, and must not blank the topic.
      ...(b.topic != null ? { topic: String(b.topic) } : {}),
      settings: {
        tone: b.tone, scenes: b.scenes,
        narratorId: b.narratorId, narratorName: b.narratorName, density: b.density,
      },
      ...patch,
    });
  };
}

// ── reading ─────────────────────────────────────────────────────────────────

router.get('/scriptgen/models', (_req, res) => {
  res.json({
    success: true,
    // (V37) No models to choose: the agents' ladder writes, its first step first - for the countdown and the form's line.
    ladder: AGENTS.ladder(), effort: EFFORT,
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

// The cross beside the countdown (phase G1). The job is marked at once and its draft let go - it can be
// started again straight away, from this page or another - and the call is told to stop. What was
// already asked for is paid for: kie may finish the request anyway, Replicate bills the seconds it ran.
// A job that has already ended is left as it is, and the answer says which way it went.
router.post('/scriptgen/jobs/:jobId/cancel', (req, res) => {
  const id = String(req.params.jobId);
  const job = _jobs[id];
  if (!job) return res.status(404).json({ success: false, error: 'no such job' });
  if (job.state !== 'running') return res.json({ success: true, state: job.state, already: true });
  job.state = 'cancelled';
  job.step = 'cancelled';
  job.at = Date.now();
  const h = _aborts.get(id);
  if (h) {
    if (h.key && _running.get(h.key) && _running.get(h.key).jobId === id) _running.delete(h.key);
    try { h.ac.abort(); } catch (e) { /* ended by itself */ }
  }
  res.json({ success: true, state: 'cancelled' });
});

// ── the stages ──────────────────────────────────────────────────────────────

router.post('/scriptgen/hooks', (req, res) => {
  const b = req.body || {};
  const topic = String(b.topic || '').trim();
  if (!topic) return res.status(400).json({ success: false, error: 'a topic is required' });
  let nar, src, m;
  try {
    nar = _narrator(b.narratorId);
    src = _sourceText(b.sourceId, b.topicId);
    m = WM.normalise(b);
  } catch (e) { return res.status(400).json({ success: false, error: e.message }); }

  _start(res, 'Writing hooks', async (_step, signal) => {
    const { data, by } = await callLadder({
      system: P.HOOKS_SYSTEM,
      user: P.hooksUserPrompt({ topic, tone: m.tone,
        narratorBlock: nar.block, sourceText: src.text }),
      schema: P.HOOKS_SCHEMA, name: 'hooks', effort: EFFORT, signal,
    });
    const hooks = (data.hooks || []).filter(h => h && h.text);
    if (!hooks.length) throw new Error('No hooks came back.');
    return { hooks, narrator: nar.name, model: by.model, by };
  // Five new hooks mean a hook is to be picked again: the one the draft held is cleared with them,
  // or a draft reopened later would show the old hook and hide the five that were paid for.
  }, _keeper(b, (r) => ({ hooks: r.hooks, hook: '' })),
  { key: _runKey(b), what: 'hooks', model: _first().model, effort: EFFORT });
});

router.post('/scriptgen/script', (req, res) => {
  const b = req.body || {};
  const topic = String(b.topic || '').trim();
  const hook = String(b.hook || '').trim();
  if (!topic) return res.status(400).json({ success: false, error: 'a topic is required' });
  if (!hook) return res.status(400).json({ success: false, error: 'pick or write a hook first' });
  let nar, src, m;
  try {
    nar = _narrator(b.narratorId);
    src = _sourceText(b.sourceId, b.topicId);
    m = WM.normalise(b);
  } catch (e) { return res.status(400).json({ success: false, error: e.message }); }

  const density = _density(b.density);
  // What is written into the draft: the script, and (V38) what the enrichment put in or why it could not.
  const keep = _keeper(b, (r) => ({
    paragraphs: r.paragraphs, title: r.title, hook, humanized: false,
    // (phase V23) What wrote it - (V37) the step of the ladder that answered - for the save to record.
    cleaned: null,
    written: { provider: r.by.provider, model: r.by.model, effort: EFFORT, at: new Date().toISOString() },
    enriched: r.enriched ? _enrichedRecord(r.enriched, null)
      : r.enrichError ? { density, used: [], error: r.enrichError } : null,
  }));

  _start(res, `Writing ${m.scenes} paragraphs`, async (step, signal, phase) => {
    // WITH a transcript the rules change, not just the input: "select, do not summarise" and
    // "facts only from the transcript" only make sense when there is one.
    const withSource = !!src.text;
    if (withSource) step(`Writing ${m.scenes} paragraphs from ${Math.round(src.text.length / 1000)}k of transcript`);
    const { data, by } = await callLadder({
      system: withSource ? P.SOURCE_SCRIPT_SYSTEM : P.SCRIPT_SYSTEM,
      user: withSource
        ? P.sourceScriptUserPrompt({ hook, topic, paragraphs: m.scenes,
          tone: m.tone, narratorBlock: nar.block, sourceText: src.text })
        : P.scriptUserPrompt({ topic, paragraphs: m.scenes,
          tone: m.tone, narratorBlock: nar.block, hook }),
      schema: P.SCRIPT_SCHEMA, name: 'script', effort: EFFORT, signal,
    });
    const paragraphs = (data.paragraphs || []).map(p => String(p || '').trim()).filter(Boolean);
    if (!paragraphs.length) throw new Error('The script came back empty.');
    const out = {
      title: String(data.title || topic).slice(0, 80),
      paragraphs,
      asked: m.scenes,
      fromSource: withSource,
      narrator: nar.name,
      model: by.model,
      by,
      density,
    };
    // (V38) Then, in the same job, the narrator's words and phrases. The script is in the draft FIRST: it is paid for,
    // and a cancel or a failure of this second step must not take it away.
    if (density !== 'off' && nar.rec && narrators.writerSet(nar.rec).size) {
      if (keep) { try { keep(out); } catch (e) { /* the job's own landing writes it again */ } }
      phase('enrich');
      step('Adding the narrator\'s words and phrases');
      try {
        const e = await _enrich(nar, paragraphs, { density, signal });
        if (e) { out.paragraphs = e.paragraphs; out.enriched = e; out.notes = e.notes; }
      } catch (err) {
        if (err && err.cancelled) throw err;
        out.enrichError = err.message;
      }
    }
    return out;
  }, keep,
  { key: _runKey(b), what: 'script', model: _first().model, effort: EFFORT, scenes: m.scenes, density });
});

// (V38) The narrator's words and phrases put in again - when the step after the script did not answer (paid once: it
// is never asked again by itself), or into a script written before, or with another measure. What was put in before
// and is still there counts in the measure.
router.post('/scriptgen/enrich', (req, res) => {
  const b = req.body || {};
  const paragraphs = (Array.isArray(b.paragraphs) ? b.paragraphs : []).map(p => String(p || '').trim()).filter(Boolean);
  if (paragraphs.length < 2) return res.status(400).json({ success: false, error: 'nothing to add to' });
  let nar;
  try { nar = _narrator(b.narratorId); } catch (e) { return res.status(400).json({ success: false, error: e.message }); }
  if (!nar.rec) return res.status(400).json({ success: false, error: 'Neutral has no words or phrases - choose a narrator.' });
  const density = _density(b.density);
  if (density === 'off') return res.status(400).json({ success: false, error: 'Words & phrases are off in the form - choose light, normal or rich.' });
  if (!narrators.writerSet(nar.rec).size) {
    return res.status(400).json({ success: false, error: `${nar.name} has no words or phrases switched on yet - read his samples first (Narrators).` });
  }
  const prev = (b.draftId && drafts.get(String(b.draftId)) || {}).enriched || null;
  const already = ((prev && prev.used) || []).filter(u => paragraphs.some(p => narrators.appearsIn(u.text, p)));

  _start(res, 'Adding the narrator\'s words and phrases', async (_step, signal) => {
    const e = await _enrich(nar, paragraphs, { density, signal, already });
    return { paragraphs: e.paragraphs, enriched: e, notes: e.notes, narrator: nar.name };
  }, _keeper(b, (r) => ({
    paragraphs: r.paragraphs,
    enriched: _enrichedRecord(r.enriched, prev ? { ...prev, used: already } : null),
  })),
  { key: _runKey(b), what: 'enrich', model: _first().model, effort: EFFORT, density });
});

router.post('/scriptgen/humanize', (req, res) => {
  const b = req.body || {};
  const paragraphs = (Array.isArray(b.paragraphs) ? b.paragraphs : []).map(p => String(p || '').trim()).filter(Boolean);
  if (paragraphs.length < 2) return res.status(400).json({ success: false, error: 'nothing to clean' });
  let nar, m;
  try { nar = _narrator(b.narratorId); m = WM.normalise(b); }
  catch (e) { return res.status(400).json({ success: false, error: e.message }); }
  // (V38, block D4) A scenario of the shelf not yet in the narrator's voice: the stronger pass, the first line too.
  const draft = b.draftId ? drafts.get(String(b.draftId)) : null;
  if (draft && draft.foreign) return _voice(res, b, nar, paragraphs);

  // The hook is the FIRST paragraph and is fixed. It is sent as context and not returned, so it
  // is held here and put back afterwards - the editor never gets to rewrite the opening line.
  const hook = paragraphs[0];
  const rest = paragraphs.slice(1);
  if (!rest.length) return res.status(400).json({ success: false, error: 'only the hook — nothing to clean' });

  // (V38) The narrator's words and phrases the enrichment put in - and that are still there - are kept through it.
  const put = ((b.draftId && drafts.get(String(b.draftId)) || {}).enriched || {}).used || [];
  const keepWords = put.filter(u => rest.some(p => narrators.appearsIn(u.text, p))).map(u => u.text);

  _start(res, `Cleaning ${rest.length} paragraphs`, async (_step, signal) => {
    const { data, by } = await callLadder({
      system: P.HUMANIZER_SYSTEM,
      user: P.humanizerUserPrompt({ paragraphs: rest, narratorBlock: nar.block, hook, keep: keepWords }),
      schema: P.HUMANIZER_SCHEMA, name: 'humanized', effort: EFFORT, signal,
    });
    const cleaned = (data.paragraphs || []).map(p => String(p || '').trim()).filter(Boolean);
    // A count that does not match means the editor dropped or merged beats. The original wins
    // rather than a script quietly losing a paragraph.
    const kept = cleaned.length === rest.length;
    return {
      paragraphs: [hook, ...(kept ? cleaned : rest)],
      applied: kept,
      note: kept ? '' : `The editor returned ${cleaned.length} paragraphs for ${rest.length} — kept the original.`,
      narrator: nar.name,
      by,
    };
  }, _keeper(b, (r) => ({
    paragraphs: r.paragraphs, humanized: !!r.applied,
    ...(r.applied ? { cleaned: { provider: r.by.provider, model: r.by.model, effort: EFFORT, at: new Date().toISOString() } } : {}),
  })),
  { key: _runKey(b), what: 'humanize', model: _first().model, effort: EFFORT });
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
  // (V38, the owner's (д13)) The narrator goes with it - the same voice as the script - and his set, told at the light
  // measure. A narrator deleted since writes plainly rather than refusing a rewrite.
  let nar;
  try { nar = _narrator(b.narratorId); } catch (e) { nar = _narrator('neutral'); }
  const setText = _setText(nar);
  // (V38) A FRAGMENT of the paragraph, selected on the page: only it is written again, the rest stays word for word.
  // Found by its words - at the place the page names when they are there, else their first occurrence.
  const para = script[index];
  let frag = null;
  if (b.fragment && typeof b.fragment === 'object') {
    const text = String(b.fragment.text || '');
    if (!text.trim()) return res.status(400).json({ success: false, error: 'select some words of the paragraph first' });
    const s0 = parseInt(b.fragment.start, 10);
    const at = Number.isInteger(s0) && para.slice(s0, s0 + text.length) === text ? s0 : para.indexOf(text);
    if (at < 0) return res.status(400).json({ success: false, error: 'the selected words are not in that paragraph any more' });
    frag = { text, before: para.slice(0, at), after: para.slice(at + text.length) };
  }

  _start(res, frag ? `Rewriting a fragment of paragraph ${index + 1}` : `Rewriting paragraph ${index + 1}`, async (_step, signal) => {
    if (frag) {
      const { data } = await callLadder({
        system: P.FRAGMENT_SYSTEM,
        user: P.fragmentUserPrompt({ topic, tone: m.tone, script, index, before: frag.before, fragment: frag.text, after: frag.after,
          narratorBlock: nar.block, setText }),
        schema: P.FRAGMENT_SCHEMA, name: 'fragment', effort: EFFORT, signal,
      });
      // The fragment's own edges are kept: a selection that ended on a space keeps it, whatever the model trimmed.
      const lead = (frag.text.match(/^\s*/) || [''])[0];
      const tail = (frag.text.match(/\s*$/) || [''])[0];
      const fresh = String(data.fragment || '').trim();
      if (!fresh) throw new Error('The rewrite came back empty.');
      const fragment = lead + fresh + tail;
      return { index, paragraph: frag.before + fragment + frag.after, fragment, was: frag.text };
    }
    const { data } = await callLadder({
      system: P.REWRITE_SYSTEM,
      user: P.rewriteUserPrompt({ topic, tone: m.tone, script, index, narratorBlock: nar.block, setText }),
      schema: P.REWRITE_SCHEMA, name: 'rewrite', effort: EFFORT, signal,
    });
    const paragraph = String(data.paragraph || '').trim();
    if (!paragraph) throw new Error('The rewrite came back empty.');
    return { index, paragraph };
  }, _keeper(b, (r) => {
    // Into the draft's own paragraphs as they are NOW - the page may have edited others meanwhile -
    // falling back to the script it sent when the draft has none.
    const cur = (b.draftId && drafts.get(b.draftId)) || drafts.list().find(x => b.sourceId && b.topicId
      && String(x.sourceId) === String(b.sourceId) && String(x.topicId) === String(b.topicId));
    const next = ((cur && cur.paragraphs && cur.paragraphs.length) ? cur.paragraphs : script).slice();
    if (r.index >= next.length) return null;
    if (r.was != null) {
      // A fragment goes into the paragraph as it is now, in place of the words it was written for; gone, it waits for
      // the page.
      const at = next[r.index].indexOf(r.was);
      if (at < 0) return null;
      next[r.index] = next[r.index].slice(0, at) + r.fragment + next[r.index].slice(at + r.was.length);
    } else next[r.index] = r.paragraph;
    return { paragraphs: next };
  }),
  { key: _runKey(b), what: 'rewrite', model: _first().model, effort: EFFORT, index, fragment: !!frag });
});

// ── drafts ──────────────────────────────────────────────────────────────────
// Here since the generator moved into the Library (phase E); /api/library2/drafts went with Library 2.

// A draft names its source by the source's CURRENT title (phase F2), as the scenarios do.
function _liveSource(d, titles) {
  if (!d || !d.sourceId) return d;
  const t = titles.get(String(d.sourceId));
  return t == null ? d : { ...d, sourceTitle: t };
}
const _titles = () => { try { return new Map(sources.list().map(x => [String(x.id), x.title || x.originalName || ''])); } catch (e) { return new Map(); } };

router.get('/scriptgen/drafts', (_req, res) => {
  try {
    const titles = _titles();
    res.json({ success: true, drafts: drafts.summaries().map(s => ({ ..._liveSource(s, titles), running: _runningFor(s) })) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/scriptgen/drafts/:id', (req, res) => {
  const d = drafts.get(req.params.id);
  if (!d) return res.status(404).json({ success: false, error: 'no such draft' });
  res.json({ success: true, draft: _liveSource(d, _titles()), running: _runningFor(d) });
});

// Called at every stage of writing, so it has to be an upsert: a second row for work that
// already has one would show the same unfinished script twice.
// An id the store does not have is refused rather than made: the page only ever sends ids the
// server gave it, so an unknown one is a draft saved or discarded meanwhile - and a late save must
// not bring it back beside the scenario it became.
router.post('/scriptgen/drafts', (req, res) => {
  const b = req.body || {};
  if (b.id && !drafts.get(b.id)) return res.status(404).json({ success: false, error: 'no such draft' });
  // The source's name comes from the source, not from the page: a form opened before a rename
  // would otherwise save the old name back.
  if (b.sourceId) { const rec = sources.get(b.sourceId); if (rec) b.sourceTitle = rec.title || rec.originalName || ''; }
  try { res.json({ success: true, draft: drafts.save(b) }); }
  catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

// Not while a stage writes into it: its keeper would bring the draft back the moment it lands.
router.delete('/scriptgen/drafts/:id', (req, res) => {
  const d = drafts.get(req.params.id);
  if (!d) return res.status(404).json({ success: false, error: 'no such draft' });
  const run = _runningFor(d);
  if (run) return res.status(409).json({ success: false, error: `A stage is still writing into this draft (${run.what}) - discard it when it has landed.`, ...run });
  drafts.remove(d.id);
  res.json({ success: true });
});

// ── into the scenarios store ────────────────────────────────────────────────
// Through the store's own createScenario, which owns the id, the three gates and the
// normalising. Not over HTTP to ourselves, and not by writing the file from here.
router.post('/scriptgen/save', async (req, res) => {
  const b = req.body || {};
  const title = String(b.title || '').trim();
  let paragraphs = (Array.isArray(b.paragraphs) ? b.paragraphs : []).map(p => String(p || '').trim()).filter(Boolean);
  if (!title) return res.status(400).json({ success: false, error: 'a title is required' });
  // Not while a stage still writes into the draft: saving removes it, and the keeper would bring it
  // back beside the scenario the moment its answer landed.
  const run = _runningFor(b.draftId ? drafts.get(b.draftId) : null);
  if (run) return res.status(409).json({ success: false, error: `A stage is still writing into this draft (${run.what}) - save when it has landed.`, ...run });
  // (V38, block D4) A scenario of the shelf rewritten in a voice keeps its own number of lines - the store's floor, not
  // the generator's.
  const fromShelf = !!((b.draftId && drafts.get(String(b.draftId))) || {}).from;
  const minLines = fromShelf ? scen3.MIN_LINES : MIN_LINES;
  if (paragraphs.length < minLines) {
    return res.status(400).json({ success: false,
      error: `the scenarios store needs at least ${minLines} lines — this script has ${paragraphs.length}` });
  }
  // The third gate, said here rather than let through to a 500: the store reads the narrator's
  // gender off the first role, and refuses a scenario without one.
  const gender = String(b.gender || '').toLowerCase();
  if (!['male', 'female'].includes(gender)) {
    return res.status(400).json({ success: false, error: 'a narrator gender is required (male or female)' });
  }
  // (phase V29, the owner 2026-10-14: "набранное переводится") A paragraph typed or edited in another language goes into
  // the scenario in English - the writer writes English, so it is a hand's. A stage started meanwhile still stops it.
  if (paragraphs.some(p => !AGENT.english(p))) {
    let t;
    try { t = await AGENT.toEnglishLines(paragraphs); } catch (e) { t = { fail: 'the paragraphs could not be translated: ' + e.message }; }
    if (t.fail) return res.status(502).json({ success: false, error: t.fail });
    paragraphs = t.texts.map(p => String(p || '').trim());
    const run2 = _runningFor(b.draftId ? drafts.get(b.draftId) : null);
    if (run2) return res.status(409).json({ success: false, error: `A stage is still writing into this draft (${run2.what}) - save when it has landed.`, ...run2 });
  }

  // (phase V23) WHAT WROTE IT comes from the draft the stages kept, not from the dropdowns as they are now: the model
  // that wrote it and the one that cleaned it. (V38) No reading any more - a narrator has one voice.
  let kept = null;
  try { kept = b.draftId ? drafts.get(String(b.draftId)) : null; } catch (e) { kept = null; }
  const wrote = (kept && kept.written) || null;
  const cleaned = (kept && kept.humanized && kept.cleaned) || null;
  let nar = { name: '', id: '' };
  try { if (b.narratorId) nar = _narrator(b.narratorId); } catch (e) { /* a deleted narrator is not a reason to lose the script */ }
  let srcTitles = { sourceTitle: '', topicTitle: '' };
  try { srcTitles = _sourceText(b.sourceId, b.topicId); } catch (e) { /* same */ }
  // (V38, the owner's (д7)) What of the narrator's set is in the script as it is saved - what the enrichment put in and
  // the hand did not take out. Their counts go up once the scenario exists, and the scenario says what they were.
  const enr = (kept && kept.enriched) || null;
  const inScript = (enr && nar.id && nar.id !== 'neutral' ? enr.used || [] : [])
    .filter(u => paragraphs.some(p => narrators.appearsIn(u.text, p)));
  // ...and his PHRASES the script says word for word, whoever put them there - the writer reaches for a signature line
  // the voice quotes (the paid check), and "used lately" has to know it.
  if (nar.id && nar.id !== 'neutral') {
    try {
      const rec = narrators.get(nar.id);
      for (const e of ((rec && rec.phrases) || []).filter(x => x.on)) {
        if (inScript.some(u => u.list === 'phrases' && u.id === e.id)) continue;
        if (paragraphs.some(p => narrators.saidIn(e.text, p))) inScript.push({ list: 'phrases', id: e.id, text: e.text });
      }
    } catch (e) { /* a count missed is not a reason to lose the script */ }
  }

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
      hook: paragraphs[0] || '', tone: String(b.tone || ''),
      // Which aggregator too (phase F3): the same model id can run on two of them.
      provider: String((wrote && wrote.provider) || b.provider || ''),
      model: String((wrote && wrote.model) || b.model || ''), humanized: !!b.humanized, at: new Date().toISOString(),
      // Cleaned by another model than wrote it (the owner: by the recommendation) - said apart.
      ...(cleaned ? { cleanedBy: [cleaned.provider, cleaned.model].filter(Boolean).join(' · ') } : {}),
      // (V38) The narrator's own words and phrases in it, and the measure they were put in at.
      ...(inScript.length ? { enriched: inScript.map(u => u.text).join(' · '), density: (enr && enr.density) || '' } : {}),
      // (V38, block D4) A scenario of the shelf rewritten in the narrator's voice: which one.
      ...(kept && kept.from ? { fromId: kept.from.scenarioId, fromTitle: kept.from.title } : {}),
    },
  };

  try {
    const scenario = scen3.createScenario(payload);
    if (inScript.length) {
      try { narrators.noteUses(nar.id, { scenarioId: scenario.id, used: inScript }); }
      catch (e) { /* the scenario is saved; a count not raised is not worth losing it over */ }
    }
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
