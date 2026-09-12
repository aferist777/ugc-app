'use strict';

/* audit-map.js — the phrase for each request, in the app's own words.

   lib/audit.js records every mutating /api request; this is where "POST /api/mv3/timeline/new"
   becomes `created project “Rome” (blank)`. One entry per route, keyed the way Express names
   it - METHOD + mount + declared path, e.g. `PATCH /api/mv3/timeline/:key/title` - and given
   what the request carried (body, params), what came back (out), and what a delete was about
   to remove (before, taken by snapshot() before the handler ran).

   A ROUTE WITHOUT AN ENTRY IS STILL RECORDED. auto() makes a phrase from the path and marks
   the row `unmapped`; the Activity tab counts those, and the fix is one line here. New
   features are therefore in the log from their first request - only their wording waits.

   Every entry must be safe on any input: a phrase that throws is replaced by auto(), and a
   missing field reads as nothing rather than "undefined". */

const fs = require('fs');
const path = require('path');
const users = require('./users');

const DATA = path.join(__dirname, '..', 'data');

// ── names, looked up rather than stored ─────────────────────────────────────
// A request names a project by key or id; the row should name it by title. Read off the
// stores, cached by mtime, so a list of fifty rows costs one file read and not fifty.
const _cache = {};
function readJson(file) {
  const p = path.join(DATA, file);
  try {
    const st = fs.statSync(p);
    const c = _cache[file];
    if (c && c.m === st.mtimeMs) return c.d;
    const d = JSON.parse(fs.readFileSync(p, 'utf8'));
    _cache[file] = { m: st.mtimeMs, d };
    return d;
  } catch (e) { return null; }
}
const names = {
  merge(key) { const d = readJson('merge-v3.json'); const t = d && d.timelines && d.timelines[key]; return t ? (t.title || 'Untitled') : null; },
  mergeRec(key) { const d = readJson('merge-v3.json'); return (d && d.timelines && d.timelines[key]) || null; },
  scenProject(id) { const d = readJson('scen3-projects.json'); return Array.isArray(d) ? (d.find(p => String(p.id) === String(id)) || null) : null; },
  scenario(id) { const d = readJson('scen3-scenarios.json'); return Array.isArray(d) ? (d.find(s => String(s.id) === String(id)) || null) : null; },
  queue(id) { const d = readJson('mv3-queue.json'); const it = d && Array.isArray(d.items) ? d.items.find(x => x.id === id) : null; return it ? it.title : null; },
  user(uid) { const u = users.findById(String(uid)); return u ? u.nickname : String(uid); },
  owner(rec) { return rec ? (rec.owner ? names.user(rec.owner) : 'Shared') : ''; },
};

// ── small words ─────────────────────────────────────────────────────────────
const q = (s) => (s == null || s === '') ? '' : `“${String(s).slice(0, 140)}”`;
const n = (a) => Array.isArray(a) ? a.length : (Number(a) || 0);
const plural = (k, one, many) => `${k} ${k === 1 ? one : many}`;
const dot = (...parts) => parts.filter(p => p != null && p !== '' && p !== false).join(' · ');
const paren = (s) => s ? ` (${s})` : '';
const pname = (id) => { const p = names.scenProject(id); return p ? p.name : null; };
const line1 = (i) => (Number.isFinite(+i) ? (+i + 1) : '?');
// First present value of a name across the response, the body, the params and the snapshot.
function pick(c, ...keys) {
  for (const k of keys) for (const src of [c.out, c.body, c.params, c.query, c.before]) {
    if (src && src[k] != null && src[k] !== '') return src[k];
  }
  return undefined;
}
const engineOf = (b) => b.engine || b.model || b.aggregator || '';

// ── what a delete or a rename is about to touch ─────────────────────────────
function snapshot(method, p) {
  let m;
  try {
    if (method === 'DELETE' && (m = /^\/mv3\/timeline\/([^/]+)$/.exec(p))) return { title: names.merge(decodeURIComponent(m[1])) };
    if (method === 'DELETE' && (m = /^\/mv3q\/([^/]+)$/.exec(p))) return { title: names.queue(decodeURIComponent(m[1])) };
    if (method === 'POST' && (m = /^\/mv3q\/retry\/([^/]+)$/.exec(p))) return { title: names.queue(decodeURIComponent(m[1])) };
    if (method === 'DELETE' && (m = /^\/scen3\/projects\/([^/]+)$/.exec(p))) { const r = names.scenProject(decodeURIComponent(m[1])); return { name: r && r.name }; }
    if (method === 'DELETE' && (m = /^\/scen3\/scenarios\/([^/]+)$/.exec(p))) { const r = names.scenario(decodeURIComponent(m[1])); return { title: r && r.title }; }
    if (method === 'POST' && (m = /^\/scen3\/scenarios\/([^/]+)\/duplicate$/.exec(p))) { const r = names.scenario(decodeURIComponent(m[1])); return { title: r && r.title }; }
    if (method === 'POST' && (m = /^\/mv3\/timeline\/([^/]+)\/copy$/.exec(p))) { const key = decodeURIComponent(m[1]); return { title: names.merge(key), owner: names.owner(names.mergeRec(key)) }; }
    if (method === 'POST' && (m = /^\/scen3\/projects\/([^/]+)\/copy$/.exec(p))) { const r = names.scenProject(decodeURIComponent(m[1])); return { name: r && r.name, owner: names.owner(r) }; }
  } catch (e) { /* a name is a nicety */ }
  return {};
}

// ── the phrases ─────────────────────────────────────────────────────────────
// Each returns { kind, label, ids?, params?, text?, marker? }. `text` is what the person wrote
// or asked for, kept in full; `params` the knobs (engine, format, count); `ids` what it touched.
const T = {

  // ── Merge: projects ──
  'POST /api/mv3/timeline/new': (c) => ({ kind: 'project.create', label: `created project ${q(pick(c, 'title'))} (blank)`, ids: { key: c.out.key } }),
  'PATCH /api/mv3/timeline/:key/title': (c) => (c.out.was == null && c.status < 400
    ? { kind: 'project.rename', label: `kept the title of project ${q(pick(c, 'title'))} (unchanged)`, ids: { key: c.params.key } }
    : { kind: 'project.rename', label: `renamed project ${q(c.out.was)} → ${q(pick(c, 'title'))}${c.out.categoryMoved ? ' (library category moved)' : ''}`, ids: { key: c.params.key } }),
  'DELETE /api/mv3/timeline/:key': (c) => ({ kind: 'project.delete', label: `deleted project ${q(c.before.title)}`, ids: { key: c.params.key } }),
  'POST /api/mv3/timeline/:key/copy': (c) => ({ kind: 'project.copy', label: `copied project ${q(c.before.title)} → ${q(c.out.title)}${c.before.owner ? ` from ${c.before.owner}` : ''}`, ids: { from: c.params.key, to: c.out.key } }),
  'PUT /api/mv3/timeline': (c) => {
    const key = c.body.key || c.out.key;
    const title = names.merge(key);
    const tr = (c.body.timeline && c.body.timeline.tracks) || {};
    let clips = 0;
    if (Array.isArray(tr)) for (const t of tr) clips += n(t && t.clips);
    else for (const k of Object.keys(tr)) clips += n(tr[k] && tr[k].clips);
    if (c.status === 409) return { kind: 'timeline.conflict', label: `save of ${q(title)} refused - changed on another device (rev ${c.out.version}); merging`, ids: { key } };
    return { kind: 'timeline.save', label: `saved timeline ${q(title)} (rev ${c.out.version} · ${plural(clips, 'clip', 'clips')})`, ids: { key }, params: { clips } };
  },
  'POST /api/mv3/adv': (c) => { const a = c.body.adv || {}; return { kind: 'export.settings', label: `saved export settings of ${q(names.merge(c.body.key))}${paren(dot(a.resolution, a.fps && a.fps + ' fps', a.crf != null && 'crf ' + a.crf, a.preset))}`, ids: { key: c.body.key }, params: a }; },
  'POST /api/mv3/overlays/hide': (c) => ({ kind: 'overlays.hide', label: `hid ${q(names.merge(c.body.key))} from the overlay sources`, ids: { key: c.body.key } }),
  'POST /api/mv3/overlays/save': (c) => ({ kind: 'overlays.pin', label: `pinned the overlay arrangement of ${q(names.merge(c.body.key))}${paren(c.out.total != null && plural(c.out.total, 'clip', 'clips'))}`, ids: { key: c.body.key } }),
  'POST /api/mv3/render/finish': (c) => ({ kind: 'render.file', label: `filed render ${q(c.body.title)} into the queue as ready`, ids: { url: c.body.url, key: c.body.key, queueId: c.out.queueId } }),
  'POST /api/mv3/render/save': (c) => ({ kind: 'render.save', label: `saved render as ${q(c.out.name || c.body.name)}`
      + (c.out.sent ? ` · sent to Partner → creative #${c.out.sent.creativeId}` : (c.body.send ? ` · Partner refused: ${c.out.sendError || 'no answer'}` : '')),
    ids: { url: c.out.url || c.body.url, key: c.body.key, queueId: c.body.queueId, creativeId: c.out.sent && c.out.sent.creativeId }, params: { send: !!c.body.send } }),
  'POST /api/mv3/render/send': (c) => ({ kind: 'render.send', label: `sent render ${q(c.body.name)} to Partner${c.out.sent ? ` → creative #${c.out.sent.creativeId}` : ''}`, ids: { url: c.body.url, creativeId: c.out.sent && c.out.sent.creativeId } }),
  'POST /api/mv3/render/discard': (c) => ({ kind: 'render.discard', label: `discarded render ${c.body.url || ''}`, ids: { url: c.body.url } }),
  'POST /api/mv3/import/scen3': (c) => ({ kind: 'project.import', label: `sent reel of ${q(pname(c.body.projectId))} to Merge → ${q(names.merge(c.out.key))}${paren(dot(c.out.fragments != null && plural(c.out.fragments, 'fragment', 'fragments'), c.body.mode || 'video'))}`, ids: { projectId: c.body.projectId, key: c.out.key } }),

  // ── Merge: the render queue ──
  'POST /api/mv3q/add': (c) => ({ kind: 'queue.add', label: `queued render of ${q(c.body.title)}${paren(dot(c.body.kind === 'blank' ? 'blank' : 'scenario', c.body.dur && Math.round(c.body.dur) + ' s'))}`, ids: { queueId: c.out.id, key: c.body.key }, params: { kind: c.body.kind, dur: c.body.dur } }),
  'POST /api/mv3q/run': (c) => ({ kind: 'queue.run', label: `started own queue${paren(dot(plural(n(c.out.armed), 'entry', 'entries') + ' armed', c.out.already && 'encoder busy - in line'))}`, params: { armed: c.out.armed } }),
  'POST /api/mv3q/retry/:id': (c) => ({ kind: 'queue.retry', label: `retried queue entry ${q(c.before.title)}`, ids: { queueId: c.params.id } }),
  'DELETE /api/mv3q/:id': (c) => ({ kind: 'queue.remove', label: `removed ${q(c.before.title)} from the queue`, ids: { queueId: c.params.id } }),
  'POST /api/mv3q/clear': (c) => ({ kind: 'queue.clear', label: `cleared own queue${paren(dot(c.body.mode === 'all' ? 'everything' : 'finished only', c.out.removed != null && c.out.removed + ' removed'))}` }),

  // ── Merge: the renders ──
  'POST /api/ffmpeg/render': (c) => { const a = c.body.advSettings || c.body.adv || {}; return { kind: 'render.request', label: `started a render${paren(dot(n(c.body.segmentClips) && plural(n(c.body.segmentClips), 'fragment', 'fragments'), n(c.body.clips) && plural(n(c.body.clips), 'birol', 'birols'), a.resolution, a.fps && a.fps + ' fps'))}`, ids: { jobId: c.out.jobId }, params: a }; },
  'DELETE /api/ffmpeg/cancel/:jobId': (c) => ({ kind: 'render.cancel', label: `cancelled render ${c.params.jobId}`, ids: { jobId: c.params.jobId } }),
  'POST /api/ffmpeg/build-ass': (c) => ({ kind: 'subtitles.build', label: 'built a subtitles file' }),
  'POST /api/mv3b/render': (c) => ({ kind: 'render.request', label: `started a render of ${q(names.merge(c.body.key) || c.body.title)} (blank project)`, ids: { key: c.body.key, jobId: c.out.jobId } }),
  'POST /api/mv3b/plan': (c) => ({ kind: 'render.plan', label: 'planned a render (blank project)' }),

  // ── Merge: Pictures, Animate, voice / music / sfx ──
  'POST /api/mv3/img/gen': (c) => ({ kind: 'imagen.request', label: `started image generation${paren(dot(engineOf(c.body), c.body.aspect || c.body.format, c.body.quality, c.body.count && c.body.count + ' images'))}`, ids: { taskId: c.out.taskId || c.out.id, key: c.body.key }, params: { engine: engineOf(c.body), aspect: c.body.aspect || c.body.format, quality: c.body.quality, count: c.body.count }, text: c.body.prompt || null }),
  'POST /api/mv3/img/think': (c) => ({ kind: 'imagen.think', label: `asked for a prompt${paren(engineOf(c.body))}`, text: c.body.text || c.body.prompt || c.body.brief || null }),
  'POST /api/mv3/img/upload': (c) => ({ kind: 'imagen.upload', label: `uploaded a picture${paren(c.body.name)}` }),
  'DELETE /api/mv3/img/item/:id': (c) => ({ kind: 'imagen.delete', label: `deleted picture ${c.params.id}`, ids: { id: c.params.id } }),
  'POST /api/mv3/chat': (c) => ({ kind: 'chat.message', label: 'sent a chat message', text: c.body.text || c.body.message || null }),
  'PUT /api/mv3/chat': (c) => ({ kind: 'chat.save', label: 'saved the chat' }),
  'DELETE /api/mv3/chat/:id': (c) => ({ kind: 'chat.delete', label: `deleted chat ${c.params.id}` }),
  'POST /api/mv3/vid/gen': (c) => ({ kind: 'video.request', label: `started video generation${paren(dot(engineOf(c.body), c.body.duration && c.body.duration + ' s'))}`, ids: { taskId: c.out.taskId || c.out.id }, params: { engine: engineOf(c.body), duration: c.body.duration }, text: c.body.prompt || c.body.motion || null }),
  'DELETE /api/mv3/vid/item/:id': (c) => ({ kind: 'video.delete', label: `deleted video ${c.params.id}` }),
  'POST /api/mv3/voice/speak': (c) => ({ kind: 'speech.request', label: `asked for speech${paren(c.body.voiceName || c.body.voiceId)}`, text: c.body.text || null }),
  'POST /api/audio/tts': (c) => ({ kind: 'speech.request', label: `asked for speech${paren(c.body.voiceName || c.body.voiceId || c.body.voice)}`, text: c.body.text || null }),
  'POST /api/audio/tts-preview': (c) => ({ kind: 'speech.preview', label: `previewed a voice${paren(c.body.voiceName || c.body.voiceId)}`, text: c.body.text || null }),
  'POST /api/audio/suno/generate': (c) => ({ kind: 'music.request', label: 'started music generation', text: c.body.prompt || c.body.description || null }),
  'POST /api/audio/suno/library': (c) => ({ kind: 'music.save', label: `saved music ${q(c.body.title || c.body.name)}` }),
  'DELETE /api/audio/suno/library/:id': (c) => ({ kind: 'music.delete', label: `deleted music ${c.params.id}` }),
  'POST /api/audio/sfx/generate': (c) => ({ kind: 'sfx.request', label: 'started sound-effect generation', text: c.body.prompt || c.body.text || null }),
  'POST /api/audio/stt': (c) => ({ kind: 'stt.request', label: 'transcribed audio' }),
  'POST /api/stt/timeline': (c) => ({ kind: 'subtitles.stt', label: `built subtitles from speech${paren(c.body.model || c.body.engine)}` }),
  'POST /api/audio/upload-file': (c) => ({ kind: 'audio.upload', label: `uploaded audio${paren(c.body.name || c.body.filename)}` }),
  'POST /api/audio/voice-design/analyze-character': (c) => ({ kind: 'voice.design', label: 'voice design: analysed the character' }),
  'POST /api/audio/voice-design/derive-voice': (c) => ({ kind: 'voice.design', label: 'voice design: derived a voice brief', text: c.body.text || c.body.brief || null }),
  'POST /api/audio/voice-design/previews': (c) => ({ kind: 'voice.design', label: 'voice design: asked for previews', text: c.body.description || c.body.text || null }),
  'POST /api/audio/voice-design/save': (c) => ({ kind: 'voice.save', label: `saved a designed voice${paren(c.body.name)}` }),
  'POST /api/audio/custom-voices/add': (c) => ({ kind: 'voice.save', label: `added a custom voice${paren(c.body.name)}` }),
  'POST /api/audio/custom-voices/prune': (c) => ({ kind: 'voice.prune', label: 'pruned custom voices' }),

  // ── Scenarios ──
  'POST /api/scen3/scenarios': (c) => {
    const s = c.out.scenario || {};
    return c.body.id != null
      ? { kind: 'scenario.save', label: `saved scenario ${q(s.title || c.body.title)}${paren(dot(n(s.lines || c.body.lines) && plural(n(s.lines || c.body.lines), 'line', 'lines'), s.vertical))}`, ids: { scenarioId: s.id || c.body.id }, text: Array.isArray(c.body.lines) ? c.body.lines.map(l => (l && l.text) || l).join('\n') : null }
      : { kind: 'scenario.create', label: `created scenario ${q(s.title || c.body.title || 'untitled')}`, ids: { scenarioId: s.id } };
  },
  'POST /api/scen3/scenarios/:id/duplicate': (c) => ({ kind: 'scenario.duplicate', label: `duplicated scenario ${q(c.before.title)} → ${q((c.out.scenario || {}).title)}`, ids: { from: c.params.id, to: (c.out.scenario || {}).id } }),
  'DELETE /api/scen3/scenarios/:id': (c) => ({ kind: 'scenario.delete', label: `deleted scenario ${q(c.before.title)}`, ids: { scenarioId: c.params.id } }),
  'POST /api/scen3/projects': (c) => {
    const p = c.out.project || {};
    if (c.body.id != null) {
      const changed = Object.keys(c.body).filter(k => k !== 'id');
      return { kind: 'project.save', label: `saved project ${q(p.name || pname(c.body.id))}${paren(changed.slice(0, 6).join(', '))}`, ids: { projectId: c.body.id }, params: { changed } };
    }
    const s = names.scenario(c.body.scenarioId);
    return { kind: 'project.create', label: `created project ${q(p.name)} from scenario ${q(s && s.title)}`, ids: { projectId: p.id, scenarioId: c.body.scenarioId } };
  },
  'DELETE /api/scen3/projects/:id': (c) => ({ kind: 'project.delete', label: `deleted project ${q(c.before.name)}`, ids: { projectId: c.params.id } }),
  'POST /api/scen3/projects/:id/copy': (c) => ({ kind: 'project.copy', label: `copied project ${q(c.before.name)} → ${q((c.out.project || {}).name)}${c.before.owner ? ` from ${c.before.owner}` : ''}`, ids: { from: c.params.id, to: (c.out.project || {}).id } }),
  'POST /api/scen3/voice/tag': (c) => { const r = c.out.report || {}; return { kind: 'voice.tag', label: `tagged the lines of ${q(pname(c.body.projectId))}${paren(dot(r.tagged != null && r.tagged + ' tagged', n(r.rejected) && n(r.rejected) + ' rejected'))}`, ids: { projectId: c.body.projectId } }; },
  'POST /api/scen3/voice/speak': (c) => { const r = c.out.report || {}; return { kind: 'voice.speak', label: `voiced ${q(pname(c.body.projectId))}${paren(dot(r.spoken != null && r.spoken + ' spoken', n(r.skipped) && n(r.skipped) + ' skipped', n(r.failed) && n(r.failed) + ' failed'))}`, ids: { projectId: c.body.projectId }, params: { only: c.body.only } }; },
  'POST /api/scen3/voices/take': (c) => ({ kind: 'voice.take', label: `took voice ${q(c.body.name || c.body.voiceId)} for the cast` }),
  'POST /api/scen3/video/render': (c) => ({ kind: 'lipsync.request', label: `started lipsync render of line ${line1(c.body.line)} in ${q(pname(c.body.projectId))}${paren(c.body.model || c.body.engine)}`, ids: { projectId: c.body.projectId, taskId: c.out.taskId }, params: { line: c.body.line, model: c.body.model } }),
  'POST /api/scen3/video/cancel': (c) => ({ kind: 'lipsync.cancel', label: `cancelled lipsync render of line ${line1(c.body.line)} in ${q(pname(c.body.projectId))}`, ids: { projectId: c.body.projectId, taskId: c.body.taskId } }),
  'POST /api/scen3/reel/save': (c) => ({ kind: 'reel.save', label: `saved the reel of ${q(pname(c.body.projectId))}${paren(n((c.out.reel || {}).clips) && plural(n(c.out.reel.clips), 'clip', 'clips'))}`, ids: { projectId: c.body.projectId } }),
  'POST /api/scen3/reel/audio': (c) => ({ kind: 'reel.audio', label: `extracted the reel audio of ${q(pname(c.body.projectId))}`, ids: { projectId: c.body.projectId } }),
  'POST /api/scen3/reel/merge': (c) => ({ kind: 'reel.send', label: `prepared the reel of ${q(pname(c.body.projectId))} for Merge${paren(n(c.out.cells) && plural(n(c.out.cells), 'cell', 'cells'))}`, ids: { projectId: c.body.projectId } }),
  'POST /api/scen3/gen/frame': (c) => ({ kind: 'frame.request', label: `started a frame ${c.body.basePath ? 'edit' : 'generation'}${paren(dot(engineOf(c.body), c.body.format, c.body.quality))}`, ids: { projectId: c.body.projectId, taskId: c.out.taskId }, params: { engine: engineOf(c.body), format: c.body.format, quality: c.body.quality, mode: c.out.mode }, text: c.body.intent || c.body.note || c.out.prompt || null }),
  'POST /api/scen3/gen/frame/analyze': (c) => ({ kind: 'frame.analyze', label: 'analysed a frame' }),
  'POST /api/scen3/gen/env': (c) => ({ kind: 'env.request', label: `started an environment generation${paren(engineOf(c.body))}`, text: c.body.prompt || c.body.note || null }),
  'POST /api/scen3/gen/dress': (c) => ({ kind: 'look.request', label: `started a look generation${paren(engineOf(c.body))}`, text: c.body.prompt || c.body.note || null }),
  'POST /api/scen3/gen/mix': (c) => ({ kind: 'mix.request', label: `started a mix${paren(dot(engineOf(c.body), c.body.format, c.body.quality))}`, text: c.body.prompt || c.body.note || null }),
  'POST /api/scen3/gen/lookbook': (c) => ({ kind: 'lookbook.request', label: 'started a lookbook page', text: c.body.prompt || null }),
  'POST /api/scen3/preview1k': (c) => ({ kind: 'frame.preview', label: 'made a 1K preview' }),
  'POST /api/scen3/frame/crop': (c) => ({ kind: 'frame.crop', label: 'cropped a frame' }),
  'POST /api/scen3/frame-options': (c) => ({ kind: 'frame.options', label: 'saved frame options' }),
  'POST /api/scen3/finalize': (c) => ({ kind: 'frame.finalize', label: 'finalised a frame' }),
  'POST /api/scen3/obraz-save': (c) => ({ kind: 'look.save', label: `saved look ${q(c.body.name || c.body.title)}` }),
  'POST /api/scen3/obraz-delete': (c) => ({ kind: 'look.delete', label: `deleted look ${q(c.body.name || c.body.id)}` }),
  'DELETE /api/scen3/look-frames/:obrazId/:frameId': (c) => ({ kind: 'frame.delete', label: `deleted frame ${c.params.frameId} of look ${c.params.obrazId}` }),
  'POST /api/scen3/options/delete': (c) => ({ kind: 'option.delete', label: `removed option ${q(c.body.value)}${paren(c.body.kind || c.body.list)}` }),
  'POST /api/scen3/media-size': (c) => ({ kind: 'media.probe', label: 'probed a media size' }),

  // ── Character ──
  'POST /api/character-v2/generate': (c) => ({ kind: 'sheet.request', label: `started a character sheet${paren(dot(engineOf(c.body), c.body.quality, c.body.format))}`, ids: { taskId: c.out.taskId, attemptId: c.out.attemptId }, params: { engine: engineOf(c.body), quality: c.body.quality, format: c.body.format }, text: c.body.brief || c.body.prompt || null }),
  'POST /api/character-v2/analyze': (c) => ({ kind: 'sheet.analyze', label: 'analysed the reference' }),
  'POST /api/character-v2/ladders': (c) => ({ kind: 'sheet.ladders', label: 'saved the ladders' }),
  'POST /api/character-v2/recover': (c) => ({ kind: 'sheet.recover', label: 'recovered takes' }),
  'POST /api/character-v2/recovered/:id/done': (c) => ({ kind: 'sheet.recover', label: `marked recovered take ${c.params.id} done` }),
  'POST /api/char-store/create': (c) => ({ kind: 'character.save', label: `saved character ${q(c.body.name || (c.out.character || {}).name)}${paren(c.body.voiceName || c.body.voice)}`, ids: { id: (c.out.character || c.out).id } }),
  'POST /api/char-store/regen-ref': (c) => ({ kind: 'character.regen', label: `regenerated the reference of character ${q(c.body.name || c.body.id)}` }),
  'PUT /api/char-store/:id': (c) => ({ kind: 'character.update', label: `updated character ${q(c.body.name || c.params.id)}`, ids: { id: c.params.id } }),
  'PATCH /api/char-store/:id': (c) => ({ kind: 'character.update', label: `updated character ${q(c.body.name || c.params.id)}`, ids: { id: c.params.id } }),
  'DELETE /api/char-store/:id': (c) => ({ kind: 'character.delete', label: `deleted character ${c.params.id}`, ids: { id: c.params.id } }),
  'POST /api/char-store/:id/voice/:voiceId': (c) => ({ kind: 'character.voice', label: `set voice ${c.params.voiceId} on character ${c.params.id}` }),
  'DELETE /api/char-store/:id/voice/:voiceId': (c) => ({ kind: 'character.voice', label: `removed voice ${c.params.voiceId} from character ${c.params.id}` }),

  // ── Birols ──
  'POST /api/biroly/generate': (c) => ({ kind: 'birols.request', label: `started Birols generation${paren(dot(c.body.category || c.body.row, engineOf(c.body), c.body.count && c.body.count + ' images'))}`, ids: { jobId: c.out.jobId }, params: { engine: engineOf(c.body), count: c.body.count }, text: c.body.prompt || null }),
  'DELETE /api/biroly/generate/:jobId': (c) => ({ kind: 'birols.cancel', label: `cancelled Birols generation ${c.params.jobId}` }),
  'POST /api/biroly/upload': (c) => ({ kind: 'birols.upload', label: `uploaded to Birols${paren(c.body.category)}` }),
  'POST /api/biroly/gen-image': (c) => ({ kind: 'birols.request', label: `started a Birols image${paren(engineOf(c.body))}`, text: c.body.prompt || null }),
  'POST /api/biroly/gen-variant': (c) => ({ kind: 'birols.request', label: 'started a Birols variant', text: c.body.prompt || null }),
  'POST /api/biroly/gen-gpt2-text': (c) => ({ kind: 'birols.request', label: 'started a Birols image (gpt-image-2, text)', text: c.body.prompt || null }),
  'POST /api/biroly/gen-gpt2-i2i': (c) => ({ kind: 'birols.request', label: 'started a Birols image (gpt-image-2, from image)', text: c.body.prompt || null }),
  'POST /api/biroly/hands-generate': (c) => ({ kind: 'birols.request', label: 'started a hands shot', text: c.body.prompt || null }),
  'POST /api/biroly/enhance-realism': (c) => ({ kind: 'birols.enhance', label: 'enhanced realism of an image' }),
  'POST /api/biroly/analyze-for-video': (c) => ({ kind: 'birols.analyze', label: 'analysed an image for video' }),
  'POST /api/biroly/analyze-for-first-frame': (c) => ({ kind: 'birols.analyze', label: 'analysed an image for a first frame' }),
  'POST /api/biroly/apply-edit': (c) => ({ kind: 'birols.edit', label: 'applied an edit to an image', text: c.body.instruction || c.body.prompt || null }),
  'POST /api/biroly/edit-system-prompt': (c) => ({ kind: 'birols.edit', label: 'saved the edit system prompt', text: c.body.prompt || c.body.text || null }),
  'POST /api/biroly/extract-mandatory': (c) => ({ kind: 'birols.analyze', label: 'extracted the mandatory elements' }),
  'POST /api/biroly/gen-broll-prompt': (c) => ({ kind: 'birols.prompt', label: 'asked for a b-roll prompt', text: c.body.text || c.body.prompt || null }),
  'POST /api/biroly/delete-files': (c) => ({ kind: 'birols.delete', label: `deleted ${plural(n(c.body.files || c.body.paths), 'file', 'files')} from Birols`, params: { files: c.body.files || c.body.paths } }),
  'POST /api/biroly/delete-video': (c) => ({ kind: 'birols.delete', label: `deleted a Birols video${paren(c.body.path || c.body.url)}` }),
  'POST /api/biroly/sync': (c) => ({ kind: 'birols.maintenance', label: 'synced the Birols library' }),
  'POST /api/biroly/refresh-thumbs': (c) => ({ kind: 'birols.maintenance', label: 'refreshed Birols thumbnails' }),
  'POST /api/biroly/refresh-all-thumbs': (c) => ({ kind: 'birols.maintenance', label: 'refreshed every Birols thumbnail' }),
  'POST /api/biroly/check-item': (c) => ({ kind: 'birols.check', label: 'checked a Birols item' }),
  'POST /api/video/grok': (c) => ({ kind: 'video.request', label: 'started a video (grok)', text: c.body.prompt || null }),
  'POST /api/video/grok-text': (c) => ({ kind: 'video.request', label: 'started a video from text (grok)', text: c.body.prompt || null }),
  'POST /api/video/p-video': (c) => ({ kind: 'video.request', label: `started a video${paren(engineOf(c.body))}`, text: c.body.prompt || null }),
  // The analyst that writes the motion prompt before the video is asked for. Logged with the
  // words as typed rather than the prompt it wrote: what a person asked for is the thing
  // worth finding again.
  'POST /api/video/think': (c) => ({ kind: 'video.think', label: 'wrote a motion prompt',
    text: c.body.text || null }),
  'POST /api/video/animate': (c) => ({ kind: 'video.request', label: `started animate${paren(dot(engineOf(c.body), c.body.duration && c.body.duration + ' s'))}`, ids: { taskId: c.out.taskId }, params: { engine: engineOf(c.body), duration: c.body.duration }, text: c.body.prompt || c.body.motion || null }),
  'POST /api/video/reference': (c) => ({ kind: 'video.request', label: `started a reference video${paren(engineOf(c.body))}`, text: c.body.prompt || null }),
  'POST /api/audio/avatar': (c) => ({ kind: 'avatar.request', label: 'started an avatar video (kie)', text: c.body.prompt || null }),
  'POST /api/audio/avatar-replicate': (c) => ({ kind: 'avatar.request', label: 'started an avatar video (replicate)', text: c.body.prompt || null }),
  'POST /api/audio/avatar-prompt': (c) => ({ kind: 'avatar.prompt', label: 'asked for an avatar prompt' }),
  'POST /api/audio/translate-pose': (c) => ({ kind: 'pose.translate', label: 'translated a pose' }),
  'POST /api/hooks/upload': (c) => ({ kind: 'hooks.upload', label: `uploaded a hook${paren(c.body.name || c.body.filename)}` }),
  'DELETE /api/hooks/delete': (c) => ({ kind: 'hooks.delete', label: `deleted a hook${paren(c.body.name || c.body.file)}` }),
  'POST /api/hooks/clean-orphans': (c) => ({ kind: 'hooks.maintenance', label: 'cleaned orphaned hooks' }),
  'POST /api/generate': (c) => ({ kind: 'image.request', label: `started a generation${paren(engineOf(c.body))}`, text: c.body.prompt || null }),
  'POST /api/lookbook/generate': (c) => ({ kind: 'lookbook.request', label: 'started a lookbook generation', text: c.body.prompt || null }),
  'POST /api/asset-interact/generate': (c) => ({ kind: 'asset.request', label: 'started an asset generation', text: c.body.prompt || null }),
  'POST /api/asset-interact/generate-with-analysis': (c) => ({ kind: 'asset.request', label: 'started an asset generation (with analysis)', text: c.body.prompt || null }),
  'POST /api/asset-interact/pre-analyze': (c) => ({ kind: 'asset.analyze', label: 'pre-analysed an asset' }),
  'POST /api/images/upload': (c) => ({ kind: 'image.upload', label: `uploaded an image${paren(c.body.name || c.body.filename)}` }),
  'POST /api/images/shot': (c) => ({ kind: 'image.shot', label: `saved a frame to the library${paren(c.body.category || c.body.title)}` }),
  'POST /api/upload-public': (c) => ({ kind: 'file.upload', label: 'uploaded a file to the public host' }),
  'POST /api/upload-public-base64': (c) => ({ kind: 'file.upload', label: 'uploaded a file to the public host' }),
  'DELETE /api/obrazy/:id': (c) => ({ kind: 'look.delete', label: `deleted look ${c.params.id}` }),
  'POST /api/obrazy/delete-file': (c) => ({ kind: 'look.delete', label: `deleted a look file${paren(c.body.path || c.body.file)}` }),
  'POST /api/obrazy/prune-missing': (c) => ({ kind: 'look.maintenance', label: 'pruned missing looks' }),
  'POST /api/gallery/archive': (c) => ({ kind: 'gallery.archive', label: 'archived a gallery item' }),
  'POST /api/custom-options/:dropdown': (c) => ({ kind: 'option.add', label: `added option ${q(c.body.value || c.body.label)} to ${c.params.dropdown}` }),
  'DELETE /api/custom-options/:dropdown/:id': (c) => ({ kind: 'option.delete', label: `removed option ${c.params.id} from ${c.params.dropdown}` }),
  'POST /api/custom-options/analyze-image': (c) => ({ kind: 'option.analyze', label: 'analysed an image for options' }),
  'POST /api/scenarios/upload': (c) => ({ kind: 'scenario.upload', label: `uploaded a scenario${paren(c.body.name || c.body.filename)}` }),

  // ── Library ──
  'DELETE /api/library/item/:kind/:id': (c) => ({ kind: 'library.delete', label: `deleted ${c.params.kind} ${q(c.body.name || c.params.id)}`, ids: { kind: c.params.kind, id: c.params.id } }),
  'PATCH /api/library/item/:kind/:id': (c) => ({ kind: 'library.update', label: `updated ${c.params.kind} ${q(c.body.name || c.body.title || c.params.id)}${paren(Object.keys(c.body).slice(0, 5).join(', '))}`, ids: { kind: c.params.kind, id: c.params.id } }),
  'PUT /api/library/item/:kind/:id': (c) => ({ kind: 'library.update', label: `updated ${c.params.kind} ${q(c.body.name || c.body.title || c.params.id)}`, ids: { kind: c.params.kind, id: c.params.id } }),
  'POST /api/library/item/:kind/:id/kind': (c) => ({ kind: 'library.rekind', label: `moved ${c.params.kind} ${c.params.id} to ${c.body.kind || c.body.to || ''}` }),
  'DELETE /api/library/voices/:voiceId': (c) => ({ kind: 'voice.delete', label: `deleted voice ${c.params.voiceId}` }),
  'POST /api/library/broken/clean': (c) => ({ kind: 'library.maintenance', label: `cleaned broken entries${paren(c.out.removed != null && c.out.removed + ' removed')}` }),
  'POST /api/library/dupes/clean': (c) => ({ kind: 'library.maintenance', label: `cleaned duplicates${paren(c.out.removed != null && c.out.removed + ' removed')}` }),
  'POST /api/library/media/record': (c) => ({ kind: 'library.record', label: `filed media ${q(c.body.name || c.body.title || c.body.src)}` }),
  'POST /api/library/cats': (c) => ({ kind: 'category.create', label: `created category ${q(c.body.name || c.body.title)}` }),
  'PATCH /api/library/cats/:id': (c) => ({ kind: 'category.rename', label: `renamed category ${c.params.id} → ${q(c.body.name || c.body.title)}` }),
  'PUT /api/library/cats/:id': (c) => ({ kind: 'category.update', label: `updated category ${q(c.body.name || c.params.id)}` }),
  'DELETE /api/library/cats/:id': (c) => ({ kind: 'category.delete', label: `deleted category ${c.params.id}` }),
  'POST /api/library/cats/order': (c) => ({ kind: 'category.order', label: 'reordered the categories' }),
  'POST /api/finals/save': (c) => ({ kind: 'render.save', label: `saved a render to finals${paren(c.body.name || c.body.title)}` }),
  'DELETE /api/finals/delete': (c) => ({ kind: 'render.delete', label: `deleted render ${q(c.body.name || c.body.url || c.body.file)}` }),
  'POST /api/finals/send-telegram': (c) => ({ kind: 'render.telegram', label: `sent render ${q(c.body.name || c.body.url || c.body.file)} to Telegram` }),
  'POST /api/finals/by-project': (c) => ({ kind: 'render.lookup', label: 'looked up renders by project' }),
  'DELETE /api/finals/by-project': (c) => ({ kind: 'render.delete', label: `deleted the renders of project ${q(c.body.project || c.body.key || c.query.project)}` }),
  'PUT /api/ffmpeg/body/:jobId': (c) => ({ kind: 'render.body', label: `replaced the body of render job ${c.params.jobId}`, ids: { jobId: c.params.jobId } }),
  'DELETE /api/mv3/chat': (c) => ({ kind: 'chat.clear', label: 'cleared the chat' }),
  'DELETE /api/prompts/dynamic/:key': (c) => ({ kind: 'prompt.dynamic', label: `deleted dynamic prompt ${c.params.key}` }),
  // The old studio - kept mounted, rarely pressed.
  'POST /api/studio/gen-object': (c) => ({ kind: 'studio.request', label: 'started an object generation (studio)', text: c.body.prompt || null }),
  'POST /api/studio/generate-frame': (c) => ({ kind: 'studio.request', label: 'started a frame generation (studio)', text: c.body.prompt || null }),
  'POST /api/characters/pose-variations': (c) => ({ kind: 'studio.request', label: 'started pose variations (studio)', text: c.body.prompt || null }),
  'POST /api/characters/reference-sheet': (c) => ({ kind: 'studio.request', label: 'started a reference sheet (studio)', text: c.body.prompt || null }),
  'POST /api/edit-pose/generate': (c) => ({ kind: 'studio.request', label: 'started a pose edit (studio)', text: c.body.prompt || null }),
  'POST /api/data/export': (c) => ({ kind: 'export.request', label: `started an export${paren(Array.isArray(c.body.groups) ? c.body.groups.join(', ') : 'everything')}`, ids: { jobId: c.out.id || c.out.jobId }, params: { groups: c.body.groups } }),
  'POST /api/data/import': (c) => { const r = c.out.report || c.out; return { kind: 'import.volume', label: `imported an archive volume${paren(dot(r.part && r.parts && `part ${r.part} of ${r.parts}`, r.imported != null && r.imported + ' items', r.skipped && r.skipped + ' skipped'))}`, params: { part: r.part, parts: r.parts, imported: r.imported, skipped: r.skipped } }; },

  // ── Library2: writing workshop ──
  'POST /api/narrators': (c) => ({ kind: 'narrator.create', label: `created narrator ${q(c.body.name || (c.out.narrator || {}).name)}` }),
  'PUT /api/narrators/:id': (c) => ({ kind: 'narrator.update', label: `updated narrator ${q(c.body.name || c.params.id)}` }),
  'PATCH /api/narrators/:id': (c) => ({ kind: 'narrator.update', label: `updated narrator ${q(c.body.name || c.params.id)}` }),
  'DELETE /api/narrators/:id': (c) => ({ kind: 'narrator.delete', label: `deleted narrator ${c.params.id}` }),
  'POST /api/narrators/:id/samples': (c) => ({ kind: 'narrator.sample', label: `added a text sample to narrator ${c.params.id}`, text: c.body.text || null }),
  'DELETE /api/narrators/:id/samples/:index': (c) => ({ kind: 'narrator.sample', label: `removed sample ${c.params.index} from narrator ${c.params.id}` }),
  'POST /api/narrators/:id/samples/upload': (c) => ({ kind: 'narrator.sample', label: `transcribed a file into narrator ${c.params.id}` }),
  'POST /api/narrators/:id/samples/link': (c) => ({ kind: 'narrator.sample', label: `transcribed a link into narrator ${c.params.id}${paren(c.body.url)}` }),
  'DELETE /api/narrators/:id/readings/:rid': (c) => ({ kind: 'narrator.reading', label: `removed reading ${c.params.rid} from narrator ${c.params.id}` }),
  'POST /api/narrators/:id/analyse': (c) => ({ kind: 'narrator.analyse', label: `read the voice of narrator ${c.params.id}` }),
  'POST /api/sources/cookies': (c) => ({ kind: 'sources.cookies', label: 'uploaded a cookies file' }),
  'POST /api/sources/cookies/verify': (c) => ({ kind: 'sources.cookies', label: `checked the cookies against YouTube${paren(c.out.ok === false ? 'failed' : c.out.ok ? 'ok' : '')}` }),
  'DELETE /api/sources/cookies': (c) => ({ kind: 'sources.cookies', label: 'deleted the cookies file' }),
  'POST /api/sources/upload': (c) => ({ kind: 'source.add', label: `added a source file${paren(c.body.name || c.body.filename)}` }),
  'POST /api/sources/link': (c) => ({ kind: 'source.add', label: `added a source link${paren(c.body.url)}` }),
  'POST /api/sources/:id/transcribe': (c) => ({ kind: 'source.transcribe', label: `started transcription of source ${c.params.id}` }),
  'POST /api/sources/:id/topics': (c) => ({ kind: 'source.topics', label: `mined topics from source ${c.params.id}` }),
  'PUT /api/sources/:id': (c) => ({ kind: 'source.update', label: `updated source ${c.params.id}` }),
  'PATCH /api/sources/:id': (c) => ({ kind: 'source.update', label: `updated source ${c.params.id}` }),
  'DELETE /api/sources/:id': (c) => ({ kind: 'source.delete', label: `deleted source ${c.params.id}` }),
  'POST /api/scriptgen/hooks': (c) => ({ kind: 'script.hooks', label: `asked for hooks${paren(c.body.narrator || c.body.narratorName)}`, text: c.body.topic || c.body.text || null }),
  'POST /api/scriptgen/script': (c) => ({ kind: 'script.generate', label: `generated a script${paren(dot(c.body.narrator || c.body.narratorName, c.body.model))}`, text: c.body.topic || c.body.brief || c.body.hook || null }),
  'POST /api/scriptgen/humanize': (c) => ({ kind: 'script.humanize', label: 'cleaned the script to the narrator', text: c.body.text || c.body.script || null }),
  'POST /api/scriptgen/rewrite': (c) => ({ kind: 'script.rewrite', label: 'rewrote the script', text: c.body.text || c.body.script || null }),
  'POST /api/scriptgen/save': (c) => ({ kind: 'script.save', label: `saved the script to Scenarios as ${q(c.body.title || (c.out.scenario || {}).title)}`, ids: { scenarioId: (c.out.scenario || {}).id } }),
  'POST /api/library2/drafts': (c) => ({ kind: 'draft.save', label: `saved a draft${paren(c.body.title)}` }),
  'DELETE /api/library2/drafts/:id': (c) => ({ kind: 'draft.delete', label: `deleted draft ${c.params.id}` }),

  // ── Prompts and settings ──
  'POST /api/prompts/:key/save': (c) => ({ kind: 'prompt.save', label: `saved prompt ${c.params.key}`, text: c.body.text || c.body.prompt || c.body.template || null }),
  'POST /api/prompts/:key/reset': (c) => ({ kind: 'prompt.reset', label: `reset prompt ${c.params.key} to default` }),
  'POST /api/prompts/:key/rename': (c) => ({ kind: 'prompt.rename', label: `renamed prompt ${c.params.key} → ${q(c.body.name || c.body.title)}` }),
  'POST /api/prompts/:key/merge': (c) => ({ kind: 'prompt.merge', label: `merged prompt ${c.params.key}` }),
  'POST /api/prompts/:key/hide': (c) => ({ kind: 'prompt.hide', label: `hid prompt ${c.params.key}` }),
  'POST /api/prompts/dynamic/:key': (c) => ({ kind: 'prompt.dynamic', label: `saved dynamic prompt ${c.params.key}`, text: c.body.text || c.body.template || null }),
  'POST /api/settings': (c) => {
    const keys = Object.keys(c.body || {});
    const secret = keys.filter(k => /password|secret|token|apikey/i.test(k));
    return secret.length
      ? { kind: 'settings.keys', marker: 'admin', label: `updated API keys: ${secret.join(', ')}${keys.length > secret.length ? ` (and ${keys.length - secret.length} setting${keys.length - secret.length === 1 ? '' : 's'})` : ''}`, params: { changed: keys } }
      : { kind: 'settings.save', label: `updated settings: ${keys.slice(0, 8).join(', ')}${keys.length > 8 ? ` +${keys.length - 8}` : ''}`, params: { changed: keys } };
  },
  'POST /api/public-host': (c) => ({ kind: 'settings.host', marker: 'admin', label: `changed the public host${paren(c.body.host || c.body.url)}` }),
  'POST /api/restart': (c) => ({ kind: 'server.restart', marker: 'admin', label: 'restarted the server' }),

  // ── Admin ──
  'POST /api/admin/users': (c) => { const u = c.out.user || {}; return { kind: 'admin.user.create', marker: 'admin', label: `created user ${u.nickname || ''}${paren(dot(u.login && 'login ' + u.login, u.role))} - one-time password shown once`, ids: { uid: u.id } }; },
  'POST /api/admin/users/:id/reset': (c) => ({ kind: 'admin.user.reset', marker: 'admin', label: `reset the password of ${names.user(c.params.id)}`, ids: { uid: c.params.id } }),
  'POST /api/admin/users/:id/role': (c) => ({ kind: 'admin.user.role', marker: 'admin', label: `made ${names.user(c.params.id)} ${(c.out.user || {}).role || c.body.role}`, ids: { uid: c.params.id } }),
  'POST /api/admin/users/:id/disable': (c) => ({ kind: 'admin.user.disable', marker: 'admin', label: `disabled ${names.user(c.params.id)}`, ids: { uid: c.params.id } }),
  'POST /api/admin/users/:id/enable': (c) => ({ kind: 'admin.user.enable', marker: 'admin', label: `enabled ${names.user(c.params.id)}`, ids: { uid: c.params.id } }),
};

// ── the fallback ────────────────────────────────────────────────────────────
// "POST /api/scen3/gen/frame" -> "scen3 · gen · frame", with the verb the method implies.
function auto(method, route) {
  const words = String(route || '').replace(/^\/api\//, '').split('/').filter(w => w && !w.startsWith(':')).join(' · ');
  const verb = { POST: 'did', PUT: 'saved', PATCH: 'changed', DELETE: 'deleted' }[method] || method.toLowerCase();
  return { kind: 'auto.' + words.replace(/ · /g, '.'), label: `${verb} ${words || route || '?'}`, unmapped: true };
}

function phrase(method, route, pathname, c) {
  const fn = T[method + ' ' + (route || '')] || T[method + ' ' + pathname];
  if (!fn) return auto(method, route || pathname);
  try {
    const r = fn(c) || {};
    return { marker: 'action', ...r, label: String(r.label || '').replace(/\s+/g, ' ').trim() };
  } catch (e) {
    return { ...auto(method, route || pathname), error_phrase: e.message };
  }
}

/** Mutating routes the app declares that have no phrase here - for the boot check and the
 *  Activity tab's counter. */
function unmappedRoutes(app, isSkipped) {
  const have = new Set(Object.keys(T));
  const out = [];
  const walk = (stack, base) => {
    for (const layer of stack || []) {
      if (layer.route && layer.route.path) {
        for (const m of Object.keys(layer.route.methods || {})) {
          const M = m.toUpperCase();
          if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(M)) continue;
          const key = M + ' ' + base + layer.route.path;
          if (!base) continue;                              // /login, /logout, /account: lib/access-gate.js writes those
          if (isSkipped && isSkipped(String(layer.route.path))) continue;
          if (!have.has(key)) out.push(key);
        }
      } else if (layer.handle && layer.handle.stack) {
        // A mounted router: its mount path is a regexp on the layer; every router here is at /api.
        walk(layer.handle.stack, base + '/api');
      }
    }
  };
  try { walk(app._router && app._router.stack, ''); } catch (e) {}
  return out;
}

module.exports = { phrase, snapshot, auto, unmappedRoutes, names, T };
