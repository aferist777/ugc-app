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
  let _lastRenderPps = 60;   // px/sec the timeline was last drawn at (zoom anchoring)
  MV2Timeline.lastRenderPps = () => _lastRenderPps;

  function _zoom() {
    const z = document.getElementById('mv2-zoom');
    return z ? parseInt(z.value, 10) || 60 : 60;
  }
  MV2Timeline.pxPerSec = _zoom;

  function _fmt(t) { return (Math.round(t * 100) / 100).toFixed(2); }
  function _clipKey(c) { return c.kind === 'main' ? c.idx : c.key; }
  function _maxDur(c) {
    const sd = c.srcDur || 0; const sp = c.speed || 1; const ti = c.trimIn || 0;
    // Max timeline length from the current in-point (so the right edge can't pull
    // in source past its end). trimIn shrinks the available tail.
    return sd > 0 ? Math.max(MIN_DUR, (sd - ti) / sp) : Infinity;
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
    // Adaptive tick step: smallest "nice" interval that keeps labels ≥ ~70 px
    // apart, so long VSL timelines at low zoom stay readable (mm:ss labels).
    const NICE_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    const step = NICE_STEPS.find(s => s * pps >= 70) || 600;
    const _tickLbl = (s) => s >= 60 ? (Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')) : (s + 's');
    for (let s = 0; s <= Math.ceil(total); s += step) {
      const tick = document.createElement('div');
      tick.className = 'mv2-tick';
      tick.style.left = (s * pps) + 'px';
      tick.innerHTML = '<span>' + _tickLbl(s) + '</span>';
      ruler.appendChild(tick);
    }
    // Click OR drag along the ruler scrubs the playhead live (held mouse moves it).
    ruler.onmousedown = (e) => {
      e.preventDefault();
      const seekAt = (ev) => {
        const rect = ruler.getBoundingClientRect();
        window.MV2Compositor.seek(Math.max(0, (ev.clientX - rect.left) / pps));
      };
      seekAt(e);
      const move = (ev) => seekAt(ev);
      const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    };

    _lastRenderPps = pps;   // for zoom-to-playhead anchoring (see MV2Timeline.lastRenderPps)
    _renderRangeBar(total, pps, width);

    tracks.innerHTML = '';
    tracks.style.width = width + 'px';
    _renderTrack(tracks, 'Birols',  model ? model.birols  : [], pps, '#7a5cae', () => window.MV2Tab.selectTrack('biro'), 'biro');
    _renderTrack(tracks, 'Hooks',   model ? model.hooks   : [], pps, '#b05010', () => window.MV2Tab.selectTrack('hook'), 'hook');
    _renderTrack(tracks, 'Main',    model ? model.main    : [], pps, '#3a6ea5', () => window.MV2Tab.selectTrack('seg'), 'seg');
    _renderTrack(tracks, 'Halfers', model ? model.halfers : [], pps, '#1a6a6a', () => window.MV2Tab.selectTrack('halfer'), 'halfer');
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

  function _renderTrack(parent, label, clips, pps, color, labelClick, scope) {
    const row = document.createElement('div');
    row.className = 'mv2-track';
    if (scope) row.dataset.scope = scope;

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
    // VSL: double-click the main track to extract a hook around that point.
    if (scope === 'seg' && _model && _model.isVsl) {
      lane.ondblclick = (e) => {
        const rect = lane.getBoundingClientRect();
        const t = Math.max(0, (e.clientX - rect.left) / pps);
        if (window.MV2Tab.openHookExtract) window.MV2Tab.openHookExtract(t);
      };
    }

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
    row.dataset.scope = 'music';

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
    // Shift-click on a main fragment → multi-select (VSL merge); no drag starts.
    if (e.shiftKey && c.kind === 'main' && window.MV2Tab.shiftSelectMain) {
      e.preventDefault();
      window.MV2Tab.shiftSelectMain(c.idx);
      return;
    }
    window.MV2Tab.selectClip(c.kind, _clipKey(c));
    if (c.kind === 'main') { _onMainEdgeDown(e, block, c, lane, pps); return; }// main: edges resize via speed (ripples the spine)

    const mode = _edgeMode(e, block, true);
    const laneRect = lane.getBoundingClientRect();
    const maxDur = _maxDur(c);
    const dur = c.end - c.start;
    const total = _model ? _model.totalDur : c.end;
    const startX = e.clientX;
    let curStart = c.start, curEnd = c.end, curTrimIn = c.trimIn || 0, moved = false, begun = false;

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
        if (mode === 'trim-l') {
          if (c.kind === 'music') {
            curStart = Math.min(Math.max(0, t, curEnd - maxDur), curEnd - MIN_DUR);   // music: unchanged (no in-point)
          } else {
            // Insert left edge = source IN-POINT: trim/extend the START. Dragging the
            // left edge inward (right) advances trimIn so the beginning is cut; the
            // right edge / end stays put. Dragging left un-trims down to the source start.
            const sp = c.speed || 1, trimIn0 = c.trimIn || 0;
            const lowerL = Math.max(0, c.start - trimIn0 / sp);
            curStart = Math.min(Math.max(t, lowerL), curEnd - MIN_DUR);
            curTrimIn = Math.max(0, trimIn0 + (curStart - c.start) * sp);
          }
        } else {
          curEnd = Math.max(Math.min(t, curStart + maxDur), curStart + MIN_DUR);   // right edge = OUT-point (trim/extend the end)
        }
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
            { start: curStart.toFixed(2), end: curEnd.toFixed(2), trimIn: curTrimIn.toFixed(3) });
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
  // Inserts KEEP their absolute timeline position (not repositioned). Trim cannot exceed the source.
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
        window.MV2.setSegmentTrim(_model.sessionKey, c.idx, patch);
        window.MV2Tab.commitReload();   // inserts stay put (no rescaleInserts)
      }
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // ── Selection applied in place (no rebuild) ─────────────────────────────────
  // Clip kind -> the track scope used by its row's data-scope / selectTrack().
  const _KIND2SCOPE = { main: 'seg', birol: 'biro', hook: 'hook', halfer: 'halfer' };

  MV2Timeline.applySelection = function (sel) {
    const isTrack = !!(sel && sel.kind === 'track');
    document.querySelectorAll('#mv2-tracks .mv2-clip').forEach(block => {
      const c = block._clip;
      if (!c) return; // skip decorative subtitle / music blocks (no _clip)
      const match = sel && !isTrack && sel.kind === c.kind && String(sel.key) === String(_clipKey(c));
      block.classList.toggle('selected', !!match);
    });
    // Highlight the track being worked on: a selected CLIP highlights its track's
    // name cell; a selected whole TRACK highlights the entire row.
    const clipScope  = (sel && !isTrack) ? _KIND2SCOPE[sel.kind] : null;
    const trackScope = isTrack ? sel.scope : null;
    document.querySelectorAll('#mv2-tracks .mv2-track').forEach(row => {
      const sc = row.dataset.scope;
      const lbl = row.querySelector('.mv2-track-label');
      row.classList.toggle('track-active', !!trackScope && sc === trackScope);
      if (lbl) lbl.classList.toggle('active', !!clipScope && sc === clipScope);
    });
  };

  // ── Render-range bar (above the ruler) ──────────────────────────────────────
  // Drag the edges to export only a span; double-click resets to the full
  // timeline. State lives in the tab (MV2Tab.getRangePct / setRangePct) and is
  // saved per project; the bar here is pure presentation + drag handling.
  function _fmtTime(t) {
    const m = Math.floor(t / 60), s = Math.round(t % 60);
    return m + ':' + String(s).padStart(2, '0');
  }
  function _renderRangeBar(total, pps, width) {
    const bar = document.getElementById('mv2-range');
    if (!bar) return;
    bar.style.width = width + 'px';
    bar.innerHTML = '';
    if (!total) return;
    const rp = (window.MV2Tab && window.MV2Tab.getRangePct) ? window.MV2Tab.getRangePct() : { left: 0, right: 1 };
    const span = total * pps;

    const hl = document.createElement('div');
    hl.className = 'rng-hl';
    const lbl = document.createElement('div');
    lbl.className = 'rng-lbl';
    const hL = document.createElement('div');
    const hR = document.createElement('div');
    hL.className = 'rng-h'; hR.className = 'rng-h';
    bar.appendChild(hl); bar.appendChild(lbl); bar.appendChild(hL); bar.appendChild(hR);

    const cur = { left: rp.left, right: rp.right };
    const place = () => {
      const x0 = cur.left * span, x1 = cur.right * span;
      hl.style.left = x0 + 'px'; hl.style.width = Math.max(0, x1 - x0) + 'px';
      hL.style.left = (x0 - 4) + 'px'; hR.style.left = (x1 - 5) + 'px';
      const active = cur.left > 0.001 || cur.right < 0.999;
      lbl.style.left = (x0 + 4) + 'px';
      lbl.textContent = active
        ? ('render ' + _fmtTime(cur.left * total) + ' – ' + _fmtTime(cur.right * total) + '  (' + _fmtTime((cur.right - cur.left) * total) + ')')
        : '';
      bar.classList.toggle('active', active);
    };
    place();

    const startDrag = (side) => (e) => {
      e.preventDefault(); e.stopPropagation();
      const rect = bar.getBoundingClientRect();
      const move = (ev) => {
        const pct = Math.max(0, Math.min(1, (ev.clientX - rect.left) / span));
        if (side === 'L') cur.left = Math.min(pct, cur.right - 0.002);
        else cur.right = Math.max(pct, cur.left + 0.002);
        place();
      };
      const up = () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        window.MV2Tab.setRangePct && window.MV2Tab.setRangePct({ left: cur.left, right: cur.right });
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    };
    hL.addEventListener('mousedown', startDrag('L'));
    hR.addEventListener('mousedown', startDrag('R'));
    bar.addEventListener('dblclick', () => {
      window.MV2Tab.setRangePct && window.MV2Tab.setRangePct({ left: 0, right: 1 });
    });
    // Click on an empty part of the bar: move the NEAREST edge there.
    bar.addEventListener('mousedown', (e) => {
      if (e.target !== bar) return;
      const pct = Math.max(0, Math.min(1, (e.clientX - bar.getBoundingClientRect().left) / span));
      if (Math.abs(pct - cur.left) <= Math.abs(pct - cur.right)) cur.left = Math.min(pct, cur.right - 0.002);
      else cur.right = Math.max(pct, cur.left + 0.002);
      place();
      window.MV2Tab.setRangePct && window.MV2Tab.setRangePct({ left: cur.left, right: cur.right });
    });
  }
  MV2Timeline.renderRange = function () {
    const total = _model ? _model.totalDur : 0;
    const pps = _zoom();
    _renderRangeBar(total, pps, Math.max(200, Math.ceil(total * pps) + 40));
  };

  // Multi-selection (VSL fragment merge): adds .multi to the given main clip
  // indices, on top of the regular single selection.
  MV2Timeline.applyMultiSelection = function (idxSet) {
    const set = idxSet || new Set();
    document.querySelectorAll('#mv2-tracks .mv2-clip').forEach(block => {
      const c = block._clip;
      if (!c) return;
      block.classList.toggle('multi', c.kind === 'main' && set.has(c.idx));
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
