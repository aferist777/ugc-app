// Scenarios v3 — thin client for the standalone scenario store (routes/scen3.js).
// Every call throws on failure; callers surface the message in the status line.

const BASE = '/api/scen3/scenarios';

async function _json(url, opt) {
  const r = await fetch(url, opt);
  let d = null;
  try { d = await r.json(); } catch (e) {}
  if (!r.ok || !d || d.success === false) {
    throw new Error((d && d.error) || `${r.status} ${r.statusText}`);
  }
  return d;
}

const _post = (url, body) => _json(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body || {}),
});

export const listScenarios     = ()    => _json(BASE).then(d => d.scenarios || []);
export const getScenario       = (id)  => _json(`${BASE}/${encodeURIComponent(id)}`).then(d => d.scenario);
export const saveScenario      = (rec) => _post(BASE, rec).then(d => d.scenario);
export const duplicateScenario = (id)  => _post(`${BASE}/${encodeURIComponent(id)}/duplicate`).then(d => d.scenario);
export const deleteScenario    = (id)  => _json(`${BASE}/${encodeURIComponent(id)}`, { method: 'DELETE' });

// Remembered vertical / product / role suggestions. Values are ADDED implicitly
// when a scenario carrying them is saved; only removal is an explicit call.
export const listOptions  = ()             => _json('/api/scen3/options').then(d => d.options || {});
export const deleteOption = (kind, value)  => _post('/api/scen3/options/delete', { kind, value }).then(d => d.options || {});

// Ask the server for an asset's ~1K derivative (built on first use, cached on
// disk). Falls back to the original path if anything goes wrong, so a preview
// always renders something.
export const preview1k = (p) => _post('/api/scen3/preview1k', { path: p })
  .then(d => d.path || p)
  .catch(() => p);

// ── Generation ──────────────────────────────────────────────────────────────
// The engine layer is shared with the rest of the app: tasks are polled through
// /api/status, then handed to /api/scen3/finalize which files the result and
// builds its 1K derivative.
export const genLookbook = (body) => _post('/api/scen3/gen/lookbook', body);
export const genDress    = (body) => _post('/api/scen3/gen/dress', body);
export const genMix      = (body) => _post('/api/scen3/gen/mix', body);
export const genEnv      = (body) => _post('/api/scen3/gen/env', body);
export const genFrame        = (body) => _post('/api/scen3/gen/frame', body);
// Cut a region out of a finished frame into a new file. rect is {x,y,w,h} as
// fractions of the source; the crop keeps its own pixels, nothing is upscaled.
export const cropFrame       = (path, rect) => _post('/api/scen3/frame/crop', { path, rect });
// Real pixel size of a stored asset. The preview shows a 1K derivative, so the page
// cannot read the true dimensions off the image it is displaying.
export const mediaSize       = (path) => _post('/api/scen3/media-size', { path });
// Returns { mode, reading?, intent? } — the lighting read and/or the cleaned-up
// direction, depending on whether a frame is being composed or edited.
export const analyzeFrame    = (body) => _post('/api/scen3/gen/frame/analyze', body);
// Global, editable presets for camera optics and framing.
export const frameOptions    = ()     => _json('/api/scen3/frame-options').then(d => d.options || {});
export const saveFrameOptions = (o)   => _post('/api/scen3/frame-options', o).then(d => d.options || {});
// Voice moods for the montage read: each carries the only tags the tagger may use.
export const listMoods       = ()     => _json('/api/scen3/moods').then(d => ({ moods: d.moods || [], role: d.role || '' }));
// The casting-director pass: reads the whole script and inserts [tags] into a second
// copy of each line. The words are never touched, and nothing is sent to TTS.
// `only` is a list of 0-based line indices to re-tag; the rest keep the tags they
// already carry, and the whole script still goes in as context so the arc holds.
export const tagLines        = (projectId, only) => _post('/api/scen3/voice/tag', { projectId, only });
// Speak the take the switch is on. `only` limits it to those line indices; without
// it every line is voiced. v3 when tags are on, v2 when they are not.
export const speakLines      = (projectId, only) => _post('/api/scen3/voice/speak', { projectId, only });
// The whole tag library, for a help panel: also says which tags are voice casting or
// body language rather than delivery.
export const voiceTagLibrary = ()     => _json('/api/scen3/voice-tags');
// v3's own mannequin store — one framing group per pose.
export const listPoses       = ()     => _json('/api/scen3/poses').then(d => d.poses || []);
export const finalize    = (path, kind, gender) => _post('/api/scen3/finalize', { path, kind, gender });
export const lookbookMeta = () => _json('/api/scen3/lookbook-meta').then(d => d.meta || {});
// Files a dressed result into the character's own obraz library (append-only).
export const obrazSave = (body) => _post('/api/scen3/obraz-save', body);
export const obrazDelete = (obrazId) => _post('/api/scen3/obraz-delete', { obrazId });

// Raw poll — /api/status answers {state:'success'|'failed'|..., imagePath, error}
export async function taskStatus(taskId) {
  const r = await fetch('/api/status/' + encodeURIComponent(taskId));
  return r.json();
}

// Poll one task to completion. onTick(state) fires on every poll.
export async function awaitTask(taskId, { interval = 2500, tries = 240, onTick } = {}) {
  for (let i = 0; i < tries; i++) {
    await new Promise(r => setTimeout(r, interval));
    let s = null;
    try { s = await taskStatus(taskId); } catch (e) { continue; }
    if (!s || s.success === false) continue;
    if (onTick) onTick(s);
    if (s.state === 'success') return s;
    if (s.state === 'failed') throw new Error(s.error || 'generation failed');
  }
  throw new Error('timed out waiting for the generator');
}

// Projects — a project snapshots the scenario it was created from.
const PROJ = '/api/scen3/projects';
export const listProjects    = ()          => _json(PROJ).then(d => d.projects || []);
export const getProject      = (id)        => _json(`${PROJ}/${encodeURIComponent(id)}`).then(d => d.project);
export const createProject   = (scenarioId) => _post(PROJ, { scenarioId }).then(d => d.project);
export const saveProject     = (rec)       => _post(PROJ, rec).then(d => d.project);
export const deleteProject   = (id)        => _json(`${PROJ}/${encodeURIComponent(id)}`, { method: 'DELETE' });
