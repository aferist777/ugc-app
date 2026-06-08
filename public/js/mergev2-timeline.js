/* ═══════════════════════════════════════════════════════════════════════════
   mergev2-timeline.js — timeline UI for Merge v2.

   Ruler + track rows + playhead. Clips are SELECTABLE (mousedown). Inserts
   (birol/hook/halfer) can be MOVED by dragging the body and TRIMMED by dragging
   the left/right edges (cursor: ew-resize); during any drag the preview seeks to
   the moved point so the cut/position frame shows in real time. An insert's max
   timeline length is srcDur / speed. Main (talking-head) clips are selectable and
   EDGE-TRIMMABLE: a fragment's length = (source - trimIn - trimOut) / speed (speed is
   set in the inspector). The RIGHT edge sets the out-point (trim/extend the end), the
   LEFT edge sets the in-point (trim/extend the start). The spine is gapless and
   0-anchored, so trimming recompacts it (later fragments shift); inserts are rescaled
   to keep their alignment. Trim cannot exceed the source length.

   Selection is applied IN PLACE (no rebuild) so a drag started on mousedown is
   not interrupted by a re-render.

   API: window.MV2Timeline
     render(model, selected) · applySelection(selected) · setPlayhead(t) · pxPerSec()
   ═══════════════════════════════════════════════════════════════════════════ */

(function () {
  const MV2Timeline = {};
  const MIN_DUR = 0.2;
  let _model = null;

  function _zoom() {
    const z = document.getElementById('mv2-zoom');
    return z ? parseInt(z.value, 10) || 60 : 60;
  }
  MV2Timeline.pxPerSec = _zoom;

  function _fmt(t) { return (Math.round(t * 100) / 100).toFixed(2); }
  function _clipKey(c) { return c.kind === 'main' ? c.idx : c.key; }
  function _maxDur(c) {
    const sd = c.srcDur || 0; const sp = c.speed || 1;
    return sd > 0 ? sd / sp : Infinity;
  }

  // ── Build ──────────────────────────────────────────────────────────────────
  MV2Timeline.render = function (model, selected) {
    _model = model;
    const ruler  = document.getElementById('mv2-ruler');
    const tracks = document.getElementById('mv2-tracks');
    if (!ruler || !tracks) return;

    const pps   = _zoom();
    const total = model ? model.totalDur : 0;
    const width = Math.max(200, Math.ceil(total * pps) + 40);

    ruler.innerHTML = '';
    ruler.style.width = width + 'px';
    const step = pps < 40 ? 5 : pps < 90 ? 2 : 1;
    for (let s = 0; s <= Math.ceil(total); s += step) {
      const tick = document.createElement('div');
      tick.className = 'mv2-tick';
      tick.style.left = (s * pps) + 'px';
      tick.innerHTML = '<span>' + s + 's</span>';
      ruler.appendChild(tick);
    }
    ruler.onclick = (e) => {
      const rect = ruler.getBoundingClientRect();
      window.MV2Compositor.seek((e.clientX - rect.left) / pps);
    };

    tracks.innerHTML = '';
    tracks.style.width = width + 'px';
    _renderTrack(tracks, 'Hooks',   model ? model.hooks   : [], pps, '#b05010', () => window.MV2Tab.selectTrack('hook'));
    _renderTrack(tracks, 'Birols',  model ? model.birols  : [], pps, '#7a5cae', () => window.MV2Tab.selectTrack('biro'));
    _renderTrack(tracks, 'Main',    model ? model.main    : [], pps, '#3a6ea5', () => window.MV2Tab.selectTrack('seg'));
    _renderTrack(tracks, 'Halfers', model ? model.halfers : [], pps, '#1a6a6a', () => window.MV2Tab.selectTrack('halfer'));
    _renderMusicTrack(tracks, model ? model.musicClips : null, model ? model.totalDur : 0, pps);
    _renderSubtitleTrack(tracks, model ? model.subtitles : [], pps);

    let ph = document.getElementById('mv2-playhead');
    if (!ph) {
      ph = document.createElement('div');
      ph.id = 'mv2-playhead';
      document.getElementById('mv2-tracks-wrap').appendChild(ph);
    }
    MV2Timeline.applySelection(selected || null);
    MV2Timeline.setPlayhead(window.MV2Compositor.clockT || 0);
  };

  // Make a clickable track label keyboard-operable (Enter/Space) + screen-reader friendly.
  function _wireLabelBtn(el, handler) {
    el.setAttribute('role', 'button');
    el.tabIndex = 0;
    el.onclick = handler;
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); handler(e); }
    });
  }

  function _renderTrack(parent, label, clips, pps, color, labelClick) {
    const row = document.createElement('div');
    row.className = 'mv2-track';

    const lbl = document.createElement('div');
    lbl.className = 'mv2-track-label' + (labelClick ? ' mv2-track-label-btn' : '');
    lbl.textContent = label;
    if (labelClick) { lbl.title = 'Track effects (transition / animation / filter)'; _wireLabelBtn(lbl, labelClick); }
    row.appendChild(lbl);

    const lane = document.createElement('div');
    lane.className = 'mv2-lane';
    lane.onclick = (e) => {
      if (e.target !== lane) return;
      const rect = lane.getBoundingClientRect();
      window.MV2Compositor.seek((e.clientX - rect.left) / pps);
      window.MV2Tab.selectClip(null, null); // deselect on empty-lane click
    };

    // Drop target for media dragged from the left gallery
    lane.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      lane.classList.add('drag-over');
    });
    lane.addEventListener('dragleave', () => lane.classList.remove('drag-over'));
    lane.addEventListener('drop', (e) => {
      e.preventDefault();
      lane.classList.remove('drag-over');
      let data;
      try { data = JSON.parse(e.dataTransfer.getData('text/plain')); } catch { return; }
      if (!data || !data.kind) return;
      const rect = lane.getBoundingClientRect();
      const at = Math.max(0, (e.clientX - rect.left) / pps);
      window.MV2Tab.insertMediaAt(data.kind, data.key, at);
    });

    (clips || []).forEach(c => {
      const block = document.createElement('div');
      block.className = 'mv2-clip';
      block.dataset.kind = c.kind;
      block.dataset.key = String(_clipKey(c));
      block._clip = c;
      block._lane = lane;
      block._pps = pps;
      block.style.left  = (c.start * pps) + 'px';
      block.style.width = Math.max(2, (c.end - c.start) * pps) + 'px';
      const _voiceOnly = (c.kind === 'main' && c.voiceOnly);
      block.style.background = _voiceOnly ? '#7fb0e0' : color;   // light-blue = voice-only (no video yet)
      if (_voiceOnly) block.classList.add('mv2-clip-voiceonly');
      block.title = (c.name || '') + '\n' + _fmt(c.start) + 's → ' + _fmt(c.end) + 's' +
                    (c.reversed ? '\n⟲ reversed' : '') + (_voiceOnly ? '\n🔊 voice only (no video yet)' : '');

      const cap = document.createElement('span');
      cap.textContent = (_voiceOnly ? '🔊 ' : '') + (c.reversed ? '⟲ ' : '') + (c.name || '');
      block.appendChild(cap);

      block.addEventListener('mousedown', (e) => _onClipMouseDown(e, block, c, lane, pps));
      block.addEventListener('mousemove', (e) => _onClipHover(e, block, c));
      lane.appendChild(block);
    });

    if (!clips || !clips.length) {
      const empty = document.createElement('span');
      empty.className = 'mv2-lane-empty';
      empty.textContent = (label === 'Main') ? 'No segments' : '—';
      lane.appendChild(empty);
    }

    row.appendChild(lane);
    parent.appendChild(row);
  }

  // Subtitles track: read-only blocks from srtSubtitles; label opens the popup.
  function _renderSubtitleTrack(parent, subs, pps) {
    const row = document.createElement('div');
    row.className = 'mv2-track';

    const lbl = document.createElement('div');
    lbl.className = 'mv2-track-label mv2-track-label-btn';
    lbl.textContent = 'Subtitles';
    lbl.title = 'Open subtitle settings';
    _wireLabelBtn(lbl, () => window.MV2Tab.openSubtitles());
    row.appendChild(lbl);

    const lane = document.createElement('div');
    lane.className = 'mv2-lane';
    lane.onclick = (e) => {
      if (e.target !== lane) return;
      const rect = lane.getBoundingClientRect();
      window.MV2Compositor.seek((e.clientX - rect.left) / pps);
    };

    (subs || []).forEach(s => {
      const b = document.createElement('div');
      b.className = 'mv2-clip mv2-sub-clip';
      b.style.left  = (s.start * pps) + 'px';
      b.style.width = Math.max(2, (s.end - s.start) * pps) + 'px';
      b.style.background = '#555';
      b.title = s.text;
      const cap = document.createElement('span');
      cap.textContent = s.text;
      b.appendChild(cap);
      b.onclick = (e) => { e.stopPropagation(); window.MV2Compositor.seek(s.start + 0.001); };
      lane.appendChild(b);
    });
    if (!subs || !subs.length) {
      const e = document.createElement('span');
      e.className = 'mv2-lane-empty';
      e.textContent = 'No subtitles — click “Subtitles” to generate';
      lane.appendChild(e);
    }

    row.appendChild(lane);
    parent.appendChild(row);
  }

  // Music track: multi-instance clips — move / trim / speed (1:1 with inserts).
  function _renderMusicTrack(parent, musicClips, totalDur, pps) {
    const row = document.createElement('div');
    row.className = 'mv2-track';

    const lbl = document.createElement('div');
    lbl.className = 'mv2-track-label mv2-track-label-btn';
    lbl.title = 'Click the word “Music” to generate · click the row for music settings';
    const word = document.createElement('span');
    word.textContent = 'Music';
    word.style.cssText = 'cursor:pointer;text-decoration:underline dotted;';
    word.title = 'Open the music generator';
    word.addEventListener('click', (e) => { e.stopPropagation(); window.MV2Tab.openMusicGen(); });
    lbl.appendChild(word);
    lbl.addEventListener('click', () => { if (window.MV2Tab && MV2Tab.selectTrack) MV2Tab.selectTrack('music'); });
    row.appendChild(lbl);

    const lane = document.createElement('div');
    lane.className = 'mv2-lane';
    lane.onclick = (e) => { if (e.target !== lane) return; const r = lane.getBoundingClientRect(); window.MV2Compositor.seek((e.clientX - r.left) / pps); };
    // Drop a track from the music library here → ADD a music instance at the drop X.
    lane.addEventListener('dragover', (e) => { e.preventDefault(); try { e.dataTransfer.dropEffect = 'copy'; } catch {} });
    lane.addEventListener('drop', (e) => {
      e.preventDefault();
      let data; try { data = JSON.parse(e.dataTransfer.getData('text/plain')); } catch {}
      if (data && data.kind === 'music' && data.url) {
        const r = lane.getBoundingClientRect();
        const at = Math.max(0, (e.clientX - r.left) / pps);
        if (window.MV2Tab && MV2Tab.setMusicFromDrop) MV2Tab.setMusicFromDrop(data.url, at);
      }
    });

    const clips = musicClips || [];
    clips.forEach(c => {
      const block = document.createElement('div');
      block.className = 'mv2-clip mv2-music-clip';
      block.dataset.kind = 'music';
      block.dataset.key = String(c.key);
      block._clip = c;
      block._lane = lane;
      block._pps = pps;
      block.style.left  = (c.start * pps) + 'px';
      block.style.width = Math.max(2, (c.end - c.start) * pps) + 'px';
      block.style.background = '#2a7a5a';
      block.title = '🎵 ' + (c.name || 'music') + '\n' + _fmt(c.start) + 's → ' + _fmt(c.end) + 's' +
                    (c.speed && Math.abs(c.speed - 1) > 1e-6 ? '\n' + c.speed.toFixed(2) + 'x' : '');
      const cap = document.createElement('span'); cap.textContent = '🎵 ' + (c.name || 'music');
      block.appendChild(cap);
      block.addEventListener('mousedown', (e) => _onClipMouseDown(e, block, c, lane, pps));
      block.addEventListener('mousemove', (e) => _onClipHover(e, block, c));
      lane.appendChild(block);
    });

    if (!clips.length) {
      const e = document.createElement('span');
      e.className = 'mv2-lane-empty';
      e.textContent = 'No music — click “Music” to generate, or drag a track here';
      lane.appendChild(e);
    }

    row.appendChild(lane);
    parent.appendChild(row);
  }

  // Hit-test the clip: near an edge → trim, middle → move. Narrow clips cap the
  // edge zone at 30% so the middle is always grabbable.
  function _edgeMode(e, block, trimmable) {
    if (!trimmable) return 'move';
    const rect = block.getBoundingClientRect();
    const w = rect.width;
    const offset = e.clientX - rect.left;
    const edge = Math.min(8, w * 0.3);
    if (offset <= edge) return 'trim-l';
    if (offset >= w - edge) return 'trim-r';
    return 'move';
  }

  function _onClipHover(e, block, c) {
    if (block._dragging) return;
    if (c.kind === 'main') {                            // both edges trim this fragment; body = select
      block.style.cursor = (_edgeMode(e, block, true) === 'move') ? 'pointer' : 'ew-resize';
      return;
    }
    block.style.cursor = (_edgeMode(e, block, true) === 'move') ? 'grab' : 'ew-resize';
  }

  function _onClipMouseDown(e, block, c, lane, pps) {
    e.stopPropagation();
    window.MV2Tab.selectClip(c.kind, _clipKey(c));
    if (c.kind === 'main') { _onMainEdgeDown(e, block, c, lane, pps); return; } // main: edges resize via speed (ripples the spine)

    const mode = _edgeMode(e, block, true);
    const laneRect = lane.getBoundingClientRect();
    const maxDur = _maxDur(c);
    const dur = c.end - c.start;
    const total = _model ? _model.totalDur : c.end;
    const startX = e.clientX;
    let curStart = c.start, curEnd = c.end, moved = false, begun = false;

    const onMove = (ev) => {
      if (!moved && Math.abs(ev.clientX - startX) > 3) {
        moved = true; begun = true; block._dragging = true;
        window.MV2Tab.beginEdit();
        document.body.style.userSelect = 'none';
        block.style.cursor = (mode === 'move') ? 'grabbing' : 'ew-resize';
      }
      if (!moved) return;
      if (mode === 'move') {
        curStart = Math.max(0, Math.min(c.start + (ev.clientX - startX) / pps, Math.max(0, total - MIN_DUR)));
        curEnd = curStart + dur;
        window.MV2Compositor.seek(curStart);
      } else {
        const t = Math.max(0, (ev.clientX - laneRect.left) / pps);
        if (mode === 'trim-l') curStart = Math.min(Math.max(0, t, curEnd - maxDur), curEnd - MIN_DUR);
        else curEnd = Math.max(Math.min(t, curStart + maxDur), curStart + MIN_DUR);
        window.MV2Compositor.seek(mode === 'trim-l' ? curStart : Math.max(0, curEnd - 0.001));
      }
      block.style.left  = (curStart * pps) + 'px';
      block.style.width = Math.max(2, (curEnd - curStart) * pps) + 'px';
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
      block._dragging = false; block.style.cursor = '';
      if (moved && begun) {
        if (c.kind === 'music') {
          window.MV2.setMusicTiming(_model.sessionKey, _clipKey(c),
            { start: curStart.toFixed(2), end: curEnd.toFixed(2) });
        } else {
          window.MV2.setInsertTiming(_model.sessionKey, c.kind, _clipKey(c),
            { start: curStart.toFixed(2), end: curEnd.toFixed(2) });
        }
        window.MV2Tab.commitReload();
      }
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // Main (talking-head) edge TRIM. The fragment's length = (source - trimIn - trimOut)
  // / speed (speed lives in the inspector). Dragging the RIGHT edge sets the out-point
  // (trim/extend the end); the LEFT edge sets the in-point (trim/extend the start). The
  // spine is gapless and 0-anchored, so the change recompacts and later fragments shift.
  // Inserts are rescaled to keep their alignment. Trim cannot exceed the source.
  function _onMainEdgeDown(e, block, c, lane, pps) {
    const mode = _edgeMode(e, block, true);
    if (mode === 'move') return;                       // body = select only (already done)
    const SP = c.speed || 1;
    const oldDur = c.end - c.start;
    const srcLen = c.srcDur || (oldDur * SP);          // full source length
    const trimIn0 = c.trimIn || 0;
    const trimOut0 = Math.max(0, srcLen - trimIn0 - oldDur * SP);
    const MIN_SRC = 0.2;                               // never trim a fragment below this much source
    const laneRect = lane.getBoundingClientRect();
    const startX = e.clientX;
    let curDur = oldDur, moved = false, begun = false;

    const onMove = (ev) => {
      if (!moved && Math.abs(ev.clientX - startX) > 3) {
        moved = true; begun = true; block._dragging = true;
        window.MV2Tab.beginEdit();
        document.body.style.userSelect = 'none';
        block.style.cursor = 'ew-resize';
      }
      if (!moved) return;
      const t = Math.max(0, (ev.clientX - laneRect.left) / pps);
      if (mode === 'trim-r') {                          // out-point: anchor start, right edge follows cursor
        let effLen = (t - c.start) * SP;
        effLen = Math.min(Math.max(effLen, MIN_SRC), srcLen - trimIn0);
        curDur = effLen / SP;
        block.style.width = Math.max(2, curDur * pps) + 'px';
        window.MV2Compositor.seek(Math.max(0, c.start + curDur - 0.001));
      } else {                                          // in-point: anchor end, left edge follows cursor
        let effLen = (c.end - t) * SP;
        effLen = Math.min(Math.max(effLen, MIN_SRC), srcLen - trimOut0);
        curDur = effLen / SP;
        const newLeft = c.end - curDur;
        block.style.left  = (newLeft * pps) + 'px';
        block.style.width = Math.max(2, curDur * pps) + 'px';
        window.MV2Compositor.seek(Math.max(0, newLeft));
      }
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
      block._dragging = false; block.style.cursor = '';
      if (moved && begun) {
        const effLen = curDur * SP;
        const patch = (mode === 'trim-r')
          ? { out: Math.max(0, srcLen - trimIn0 - effLen) }
          : { in:  Math.max(0, srcLen - trimOut0 - effLen) };
        const oldTotal = (_model && _model.totalDur) || 0;
        const newTotal = oldTotal - oldDur + curDur;
        window.MV2.setSegmentTrim(_model.sessionKey, c.idx, patch);
        if (oldTotal > 0 && newTotal > 0) window.MV2.rescaleInserts(_model.sessionKey, newTotal / oldTotal);
        window.MV2Tab.commitReload();
      }
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // ── Selection applied in place (no rebuild) ─────────────────────────────────
  MV2Timeline.applySelection = function (sel) {
    document.querySelectorAll('#mv2-tracks .mv2-clip').forEach(block => {
      const c = block._clip;
      if (!c) return; // skip decorative subtitle / music blocks (no _clip)
      const match = sel && sel.kind === c.kind && String(sel.key) === String(_clipKey(c));
      block.classList.toggle('selected', !!match);
    });
  };

  // ── Playhead ────────────────────────────────────────────────────────────────
  MV2Timeline.setPlayhead = function (t) {
    const ph = document.getElementById('mv2-playhead');
    if (!ph) return;
    const pps = _zoom();
    const labelW = 64;
    ph.style.left = (labelW + t * pps) + 'px';
  };

  window.MV2Timeline = MV2Timeline;
})();
