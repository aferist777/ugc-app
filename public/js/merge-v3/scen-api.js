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

/**
 * The vertical / product / role values used before. They are collected from saved
 * scenarios rather than kept as a list somebody has to maintain, so this is a set of
 * suggestions and never a set of allowed answers.
 */
export const options = () => _json('/api/scen3/options').then(d => d.options || {});
