/* ════════════════════════════════════════════════════════════════════════════
   MERGE — the scenario store, as much of it as Merge needs.

   A talking-head project starts from a SCENARIO: a title, a list of lines, and the
   three labels the casting reads (vertical, product, role with the narrator's
   gender). The store is routes/scen3.js and it is shared - Library 2 writes into it
   too - so this is a client, not a copy.

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
  if (!r.ok || !d || d.success === false) throw new Error((d && d.error) || `${r.status} ${r.statusText}`);
  return d;
}
const _post = (url, body) => _json(url, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}),
});

/**
 * The list, newest edit first, with the counts of both libraries - "written here" and
 * "written in Library 2", which the server tells apart by whether a scenario carries
 * provenance. The counts come back whichever side is asked for: a tab that cannot say
 * how many are on the other side is a tab you have to click to understand.
 *
 * @param lib  '' | 'library1' | 'library2' | 'archive'
 */
export const list = (lib) =>
  _json('/api/scen3/scenarios' + (lib ? '?lib=' + encodeURIComponent(lib) : ''))
    .then(d => ({ rows: d.scenarios || [], counts: d.counts || { library1: 0, library2: 0, all: 0 } }));

/** One scenario with its lines - the list carries only summaries. */
export const get = (id) => _json('/api/scen3/scenarios/' + encodeURIComponent(id)).then(d => d.scenario);

/** Create (no id) or update (id). Returns the stored record. */
export const save = (rec) => _post('/api/scen3/scenarios', rec).then(d => d.scenario);

/**
 * Archived or back. Sent through the same upsert as any other edit - the server merges what
 * it is given into the stored record - so this needs no route of its own.
 */
export const archive = (id, yes) => save({ id, archived: !!yes });

/** Gone for good: the store has no bin, which is why the panel asks first. */
export const remove = (id) =>
  _json('/api/scen3/scenarios/' + encodeURIComponent(id), { method: 'DELETE' });

/** A project from a scenario: its own copy of the lines, its own name. */
export const project = (scenarioId) => _post('/api/scen3/projects', { scenarioId }).then(d => d.project);

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
 * Start the dressing. Answers { taskId, engine }: the task to wait on - engines take a minute -
 * and the model the server actually used, which is what the look should be recorded as.
 */
export const dress = (body) => _post('/api/scen3/gen/dress', body).then(d => ({ taskId: d.taskId, engine: d.engine || '' }));

/**
 * File a finished dressing as one of the character's looks. Returns { path, obrazId }: the
 * look belongs to the CHARACTER from here on, not to the project that asked for it.
 */
export const saveLook = (body) => _post('/api/scen3/obraz-save', body);

/**
 * Poll one task to its end. The generator answers 'success' with a path or 'failed' with a
 * reason; anything else is still running. A poll that itself fails is not a failure of the
 * job - the network is allowed one bad answer - so it is skipped, not thrown.
 */
export async function awaitTask(taskId, onTick) {
  for (let i = 0; i < 240; i++) {
    await new Promise(r => setTimeout(r, 2500));
    let s = null;
    try { s = await _json('/api/status/' + encodeURIComponent(taskId)); } catch (e) { continue; }
    if (onTick) { try { onTick(s); } catch (e) { /* a progress reader */ } }
    if (s.state === 'success') return s;
    if (s.state === 'failed') throw new Error(s.error || 'the generation failed');
  }
  throw new Error('timed out waiting for the generator');
}

// ── Making a lookbook ───────────────────────────────────────────────────────
// One route, three ways of asking, and which one it is depends only on what is filled in:
// a photo alone EXTRACTS the outfit from it, a sentence alone draws one from nothing, and
// both together read the photo and apply the sentence to it. The answer is a task to wait on.

/** @returns { mode, taskIds, gender } */
export const makeLookbook = (body) => _post('/api/scen3/gen/lookbook', body);

/**
 * File a finished generation into a shared library - a lookbook here - and get back the path
 * it was filed under. Until this runs the picture is a scratch file with no shelf.
 */
export const fileAs = (path, kind, gender, extra) =>
  _post('/api/scen3/finalize', { path, kind, gender, ...(extra || {}) });

/**
 * The vertical / product / role values used before. They are collected from saved
 * scenarios rather than kept as a list somebody has to maintain, so this is a set of
 * suggestions and never a set of allowed answers.
 */
export const options = () => _json('/api/scen3/options').then(d => d.options || {});
