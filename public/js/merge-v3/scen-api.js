/* ════════════════════════════════════════════════════════════════════════════
   MERGE — the scenario store, as much of it as Merge needs.

   A talking-head project starts from a SCENARIO: a title, a list of lines, and the
   three labels the casting reads (vertical, product, role with the narrator's
   gender). The store is routes/scen3.js and it is shared - the Library's generator writes into
   it too - so this is a client, not a copy.

   The two calls worth understanding before using them:

     save()     creates when the record has no id and UPDATES when it has one. A new
                scenario is gated (a title and at least MIN_LINES filled lines); an
                edit is not, so a half-typed title cannot fail a save.
     project()  makes a PROJECT from a scenario, and the project takes a SNAPSHOT of
                the lines. Editing the scenario afterwards never reaches it, and one
                scenario can be used as many times as you like - which is exactly why
                "save" and "use" are two buttons and not one.
   ════════════════════════════════════════════════════════════════════════════ */

async function _json(url, opt) {
  const r = await fetch(url, opt);
  let d = null;
  try { d = await r.json(); } catch (e) { /* a 500 with an HTML body */ }
  if (!r.ok || !d || d.success === false) {
    // A 404 with no JSON is a route the running server does not have: the page is newer than the
    // app that serves it (right after an update, before a restart). Said as that.
    if (!d && r.status === 404) {
      throw Object.assign(new Error('This is newer than the running app - close UGC Studio and open it again to finish the update.'), { status: 404 });
    }
    // What kind of "no" it was travels with it: an agent that REFUSED has answered, and a photo
    // that is GONE from the server's scratch can simply be sent again.
    throw Object.assign(new Error((d && d.error) || `${r.status} ${r.statusText}`),
      { status: r.status, refused: !!(d && d.refused), gone: !!(d && d.gone) });
  }
  return d;
}
const _post = (url, body) => _json(url, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}),
});

/**
 * The list, newest edit first, with the counts: saved by hand, generated, each source the generator
 * wrote from, without a source, archived. The counts come back whichever filter is asked for: a
 * tab that cannot say how many are on the other side is a tab you have to click to understand.
 *
 * @param filter  '' | 'library1' | 'archive' | 'src:<source id>' | 'nosrc'
 */
export const list = (filter) => {
  const f = String(filter || '');
  const q = !f ? '' : f === 'nosrc' ? '?source=none'
    : f.startsWith('src:') ? '?source=' + encodeURIComponent(f.slice(4))
    : '?lib=' + encodeURIComponent(f);
  return _json('/api/scen3/scenarios' + q)
    .then(d => ({ rows: d.scenarios || [], counts: d.counts || { library1: 0, library2: 0, all: 0, sources: [], noSource: 0 } }));
};

/** One scenario with its lines - the list carries only summaries. */
export const get = (id) => _json('/api/scen3/scenarios/' + encodeURIComponent(id)).then(d => d.scenario);

/** Create (no id) or update (id). Returns the stored record. */
export const save = (rec) => _post('/api/scen3/scenarios', rec).then(d => d.scenario);

/**
 * Archived or back. Sent through the same upsert as any other edit - the server merges what
 * it is given into the stored record - so this needs no route of its own. As an EDIT: a scenario
 * deleted meanwhile answers 404 instead of being made again out of nothing but the flag. Going
 * into the archive keeps the scenario's date; coming back gives it a new one, so it heads the list.
 */
export const archive = (id, yes) => save({ id, archived: !!yes, edit: true });

/** Gone for good: the store has no bin, which is why the panel asks first. */
export const remove = (id) =>
  _json('/api/scen3/scenarios/' + encodeURIComponent(id), { method: 'DELETE' });

/** A project from a scenario: its own copy of the lines, its own name. */
export const project = (scenarioId) => _post('/api/scen3/projects', { scenarioId }).then(d => d.project);

/**
 * A TALKING HEAD from a scenario - what `use` does, in Merge and in the Library (phase V28.2): the project
 * (its own copy of the lines) and the EMPTY timeline it will be assembled into, keyed to it. Without that
 * second one a project made today would be invisible in Merge's picker until its first assembly, and
 * tomorrow there would be no way back into it. Returns the timeline's key - what Merge opens.
 */
export async function talkingHead(scenarioId) {
  const p = await project(scenarioId);
  const d = await _post('/api/mv3/timeline/new', { projectId: p.id });
  if (!d.key) throw new Error('the timeline was refused');
  return d.key;
}

/** (phase V62, (во27), (во28)) A voiceover's line, at most - ElevenLabs reads 5 000 characters at a time, the mood's tags
 *  included; the server keeps the same number (routes/scen3.js VO_MAX). */
export const VO_MAX = 4500;

/**
 * (phase V62) A VOICEOVER - from a scenario ({ scenarioId }) or from one's own text ({ text, name }, the whole text one line):
 * the project, read in the language it is written in, and its empty timeline. Returns the timeline's key.
 */
export async function voiceover(from) {
  const p = await _post('/api/scen3/projects', { ...from, type: 'voiceover' }).then(d => d.project);
  const d = await _post('/api/mv3/timeline/new', { projectId: p.id });
  if (!d.key) throw new Error('the timeline was refused');
  return d.key;
}

/**
 * The take a line is read BY now, and the words it should have said. A line with its words
 * marked up ([tags]) is read by its tagged take - ElevenLabs v3 performs the tags; one without, by
 * the plain take. Which is how a project read before the tags keeps its reads until a line is read
 * again (decided with the owner 2026-09-21, docs/local-app/PLAN.md, phase W).
 */
export const takeOf = (l) => {
  const a = (l && l.audio) || {};
  const tagged = String((l && l.tagged) || '').trim();
  return tagged
    ? { take: a.tagged || null, said: tagged }
    : { take: a.plain || null, said: String((l && l.text) || '') };
};

/**
 * Is this line READ - its take there, and spoken from the words the line has now? `said` is
 * written with the take (routes/scen3.js, /scen3/voice/speak), so editing a line makes its read
 * stale by itself. One rule for the counters (js/merge-v3/wk-fragments.js), the voice stage
 * (js/merge-v3/wk-voice.js) and the Library spine, which waits for the first read (js/merge-v3/workshop.js).
 */
export const isRead = (l) => {
  const { take, said } = takeOf(l);
  return !!(take && take.path && take.said === said);
};

/**
 * IS THIS LINE IN THE VIDEO (phase Z, the owner 2026-09-22)? A line is never deleted - it is
 * TAKEN OFF: it keeps its place in the script (which is what stops the frames and the clips of
 * the lines below it moving), the panel dims it and puts it at the foot of the list with a
 * `restore`, and nothing else reads it - not the counters, not the reads, not the clips, not the
 * prompts, not the timeline mirror. The server keeps the same rule (routes/scen3.js, _normLine).
 */
export const isLive = (l) => !(l && l.removed);
/** The lines of the video, with their places in the script kept - [{ l, i }], i the real index. */
export const liveLines = (lines) => (Array.isArray(lines) ? lines : [])
  .map((l, i) => ({ l, i })).filter(x => isLive(x.l));

/** The words without their [tags] - what the line says, whatever the read performs. */
export const plainWords = (s) => String(s || '').replace(/\[[^\]]*\]/g, ' ')
  .replace(/[ \t]{2,}/g, ' ').replace(/\s+([,.!?;:])/g, '$1').trim();

// ── Dressing a character ────────────────────────────────────────────────────
// A LOOK is made by showing the engine two pictures - this person, that outfit - and filing
// the answer under the character. The call is the one the old page makes; what is new here is
// where it is made from.

/** The outfits to dress FROM: every picture on the lookbooks shelf. */
export const lookbooks = () => _json('/api/gallery/lookbooks').then(d => d.files || []);

/**
 * What is known ABOUT those pictures, keyed by path: the gender the outfit suits, and - for
 * one made since the agent started writing them - the long description of what it is. A
 * lookbook from before has no entry at all, which is why every reader treats a missing one
 * as "nothing known" rather than as an error.
 */
export const lookbookMeta = () => _json('/api/scen3/lookbook-meta').then(d => d.meta || {});

/**
 * Start the dressing. Answers `{ alertId }`: the server dresses, files the look under the
 * character and - when a project asked for it - puts it on that project. Follow the row.
 */
export const dress = (body) => _post('/api/scen3/gen/dress', body);

// ── Following a generation ──────────────────────────────────────────────────
// Nothing here waits on a provider any more. A generation started from Merge is a row in the
// Alerts journal, the SERVER waits for it and files the result, and the page follows the row
// (docs/local-app/PLAN.md, "Alerts"). So leaving the panel - or the page - loses nothing, and
// coming back finds either the finished thing or the same row still running.

/** One row of the journal. */
export const alert = (id) => _json('/api/alerts/' + encodeURIComponent(id)).then(d => d.item);

/** Every row, with the counts the button shows. */
export const alerts = () => _json('/api/alerts');

/**
 * Follow a row to its end. Answers the finished record; throws with the journal's own wording
 * when it failed. A reading that fails is not a failure of the generation - the next one asks
 * again - so it is skipped rather than thrown.
 *
 * @param onTick  called with the record on every reading, for a panel that shows progress
 */
export async function follow(id, onTick) {
  for (let i = 0; i < 900; i++) {
    let rec = null;
    try { rec = await alert(id); } catch (e) { rec = null; }
    if (rec) {
      if (onTick) { try { onTick(rec); } catch (e) { /* a progress reader */ } }
      if (rec.state === 'done') return rec;
      if (rec.state === 'failed') throw new Error(rec.error || 'the generation failed');
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error('gave up following this generation');
}

// ── Making a lookbook ───────────────────────────────────────────────────────
// One route, three ways of asking, and which one it is depends only on what is filled in:
// a photo alone EXTRACTS the outfit from it, a sentence alone draws one from nothing, and
// both together read the photo and apply the sentence to it. The answer is a task to wait on.

/** @returns { alertId, mode, kind, refToken } - the server files it; follow the row. */
export const makeLookbook = (body) => _post('/api/scen3/gen/lookbook', body);

// ── Making an environment ───────────────────────────────────────────────────
// The saved places, what the agent wrote about each, and the maker. The maker can answer in
// two ways: a task to wait on, or - for a picture with no place in it - a few places to pick
// from, with nothing generated yet (routes/scen3.js, POST /scen3/gen/env).

/** Every picture on the environments shelf. */
export const environments = () => _json('/api/gallery/environments').then(d => d.files || []);

/** { "<path>": { description, prompt, from, at } } - an environment made before has no entry. */
export const envMeta = () => _json('/api/scen3/env-meta').then(d => d.meta || {});

/**
 * @param body { prompt, imageBase64 | refToken | imagePath, choices }
 * @returns { choose, why, options, refToken } when it wants a place picked first, and
 *          { alertId, mode, refToken } when it submitted one - the server files it.
 */
export const makeEnvironment = (body) => _post('/api/scen3/gen/env', body);

/**
 * The vertical / product / role values used before. They are collected from saved
 * scenarios rather than kept as a list somebody has to maintain, so this is a set of
 * suggestions and never a set of allowed answers.
 */
export const options = () => _json('/api/scen3/options').then(d => d.options || {});
