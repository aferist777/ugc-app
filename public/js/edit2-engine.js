/* ═══════════════════════════════════════════════════════════════════════════
   edit2-engine.js — generation orchestrator for Edit v2 (window.EDIT2Engine).

   Calls the SAME backend endpoints the legacy Edit uses, with byte-identical
   request bodies, but decoupled from the old DOM. Writes results straight into
   editFrozenSessions + saveEditState (single source of truth), and reports
   progress/state via hooks so the popup can update individual rows live.

   Ф2 = voices. Mixes (Ф3) and talking-head video (Ф4) extend this file.

   Reused globals: editFrozenSessions, saveEditState, getTimelineData, getObrazы,
   getAudioEngine, getEngineParams, pollTts (all defined earlier in load order).
   ═══════════════════════════════════════════════════════════════════════════ */

(function () {
  const E = {};
  const _abort   = {};   // sessionKey → bool (stop requested)
  const _running = {};   // sessionKey → bool (bulk voices in flight)

  function _sess(k) {
    const all = (typeof editFrozenSessions !== 'undefined') ? editFrozenSessions : (window.editFrozenSessions || {});
    return all[k];
  }
  function _obrazVoice(k) {
    try {
      const s = _sess(k);
      const list = (typeof getObrazы === 'function') ? getObrazы() : [];
      const o = list.find(x => String(x.id) === String(s && s.obrazId));
      return (o && o.voice) || null;
    } catch { return null; }
  }

  // ── Resolve the same voice/params/model the legacy Edit would send ───────────
  E.resolveVoice = function (k) {
    try { return localStorage.getItem('edit_voice__' + k) || _obrazVoice(k) || 'Rachel'; }
    catch { return 'Rachel'; }
  };
  E.resolveModel = function () {
    return (typeof getAudioEngine === 'function') ? getAudioEngine() : undefined;
  };
  E.resolveTtsParams = function (k) {
    let global = {};
    try {
      if (typeof getEngineParams === 'function') {
        global = getEngineParams(E.resolveModel() || 'elevenlabs/text-to-dialogue-v3') || {};
      }
    } catch {}
    let proj = null;
    try { proj = JSON.parse(localStorage.getItem('edit_tts_params__' + k) || 'null'); } catch {}
    return proj ? Object.assign({}, global, proj) : global;
  };

  async function _ttsOnce(k, text) {
    const r = await fetch('/api/audio/tts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text, voice: E.resolveVoice(k), ttsParams: E.resolveTtsParams(k), model: E.resolveModel() }),
    });
    const d = await r.json();
    if (!d.success) throw new Error(d.error || 'TTS error');
    // elevenlabs returns audioPath synchronously; kie.ai returns a taskId to poll.
    return d.audioPath || await pollTts(d.taskId);
  }

  // ── Generate the voice for ONE cell. hooks: { onState(state, msg?) } ─────────
  //    state ∈ running | done | error. Writes cell.audioPath / cell.audioError.
  E.genVoice = async function (k, idx, hooks) {
    hooks = hooks || {};
    const s = _sess(k);
    if (!s || !Array.isArray(s.cells) || !s.cells[idx]) return null;
    const cell = s.cells[idx];
    if (hooks.onState) hooks.onState('running');
    delete cell.audioError;

    let ap, last = null;
    for (let a = 0; a < 3; a++) {                       // 3 attempts, 2.5s backoff (matches legacy)
      try { ap = await _ttsOnce(k, cell.line || ''); last = null; break; }
      catch (e) { last = e; if (a < 2) await new Promise(r => setTimeout(r, 2500)); }
    }
    if (last) {
      cell.audioError = last.message || 'TTS failed';
      if (typeof saveEditState === 'function') saveEditState();
      if (hooks.onState) hooks.onState('error', cell.audioError);
      throw last;
    }
    cell.audioPath = ap; delete cell.audioError;
    if (typeof saveEditState === 'function') saveEditState();
    if (hooks.onState) hooks.onState('done');
    return ap;
  };

  E.stop = function (k) { _abort[k] = true; };
  E.isRunning = function (k) { return !!_running[k]; };

  // ── Generate ALL missing voices, sequentially. hooks:
  //    { onStart(total), onRow(idx, state, msg?), onProgress(done, total), onDone() }
  E.genAllVoices = async function (k, hooks) {
    hooks = hooks || {};
    const s = _sess(k);
    if (!s || !Array.isArray(s.cells)) { if (hooks.onDone) hooks.onDone(); return; }

    let excl = new Set();
    try { const d = getTimelineData(); excl = new Set((d[k] && d[k].excludedSegments) || []); } catch {}

    const todo = [];
    s.cells.forEach((c, i) => {
      if (excl.has(i)) return;
      if (c.videoPath || c.avatarTaskId || c._videoPending) return;  // don't touch cells with video
      if (c.audioPath) return;                                        // keep existing audio
      todo.push(i);
    });

    if (hooks.onStart) hooks.onStart(todo.length);
    if (!todo.length) { if (hooks.onDone) hooks.onDone(); return; }

    _running[k] = true; _abort[k] = false;
    if (hooks.onRow) todo.forEach(i => hooks.onRow(i, 'queued'));
    let done = 0;
    try {
      for (const idx of todo) {
        if (_abort[k]) break;
        try {
          await E.genVoice(k, idx, { onState: (st, msg) => hooks.onRow && hooks.onRow(idx, st, msg) });
        } catch { /* error already recorded on the cell + reported via onRow */ }
        done++;
        if (hooks.onProgress) hooks.onProgress(done, todo.length);
      }
    } finally {
      _running[k] = false; _abort[k] = false;
      if (hooks.onDone) hooks.onDone();
    }
  };

  window.EDIT2Engine = E;
})();
