/* scen-timeline.js — renderAllTimelines, _renderAllTimelinesImpl, _showCloseProjectModal, refreshTimelineBirolys */

let _tlRunning = false, _tlQueued = false;
async function renderAllTimelines() {
  if (_tlRunning) { _tlQueued = true; return; }
  _tlRunning = true;
  try { await _renderAllTimelinesImpl(); }
  finally {
    _tlRunning = false;
    if (_tlQueued) { _tlQueued = false; renderAllTimelines(); }
  }
}
// ── Склейка project collapse/close persistence ────────────────────────────────
const LS_SKLEYKA_COLLAPSED = 'skleyka_collapsed_v1';
const LS_SKLEYKA_CLOSED    = 'skleyka_closed_v1';
function getSkleykaCollapsed() { try { return new Set(JSON.parse(localStorage.getItem(LS_SKLEYKA_COLLAPSED)||'[]')); } catch { return new Set(); } }
function saveSkleykaCollapsed(s) { localStorage.setItem(LS_SKLEYKA_COLLAPSED, JSON.stringify([...s])); }
function getSkleykaClosed() { try { return new Set(JSON.parse(localStorage.getItem(LS_SKLEYKA_CLOSED)||'[]')); } catch { return new Set(); } }
function saveSkleykaClosed(s) { localStorage.setItem(LS_SKLEYKA_CLOSED, JSON.stringify([...s])); }

// ── Close-project modal ───────────────────────────────────────────────────────
function _showCloseProjectModal(sessionKey, getBtnSave, onClose) {
  let modal = document.getElementById('skleyka-close-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'skleyka-close-modal';
    modal.style.cssText =
      'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.55);' +
      'z-index:9200;align-items:center;justify-content:center;';
    document.body.appendChild(modal);
  }
  modal.innerHTML = '';
  const box = document.createElement('div');
  box.style.cssText =
    'background:#c0c0c0;border:2px solid #808080;padding:18px 22px;min-width:300px;' +
    'box-shadow:4px 4px 0 #808080;font-size:12px;';
  const title = document.createElement('div');
  title.style.cssText = 'font-weight:bold;font-size:13px;margin-bottom:8px;';
  title.textContent = 'Закрыть проект?';
  const msg = document.createElement('div');
  msg.style.cssText = 'color:#444;font-size:11px;margin-bottom:16px;';
  msg.textContent = 'Проект исчезнет из Склейки. Данные в Эдит сохранятся.';
  const btns = document.createElement('div');
  btns.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;';
  const closeModal = () => { modal.style.display = 'none'; };
  const makeBtn = (text, fn, color) => {
    const b = document.createElement('button');
    b.textContent = text;
    b.style.cssText = `padding:4px 10px;cursor:pointer;font-size:11px;${color ? 'color:'+color+';' : ''}`;
    b.addEventListener('click', fn);
    return b;
  };
  btns.appendChild(makeBtn('💾 Сохранить и закрыть', () => {
    closeModal();
    const bs = getBtnSave();
    if (bs && !bs.disabled) bs.click();
    setTimeout(onClose, 600);
  }));
  btns.appendChild(makeBtn('Закрыть без сохранения', () => { closeModal(); onClose(); }, '#aa0000'));
  btns.appendChild(makeBtn('Отмена', closeModal));
  box.appendChild(title); box.appendChild(msg); box.appendChild(btns);
  modal.appendChild(box);
  modal.style.display = 'flex';
}

async function _renderAllTimelinesImpl() {
  const wrap = document.getElementById('skleyka-timelines');
  if (!wrap) return;
  wrap.innerHTML = '';

  // Only sessions where ALL audio cells have finished videos
  const allSessions = getCompletedSessions();
  const closedSet   = getSkleykaClosed();
  const sessions    = allSessions.filter(([key]) => !closedSet.has(key));

  // Persist which sessions are currently shown so next reload closes the rest
  _saveSkleykaLastShown(sessions.map(([key]) => key));

  if (!sessions.length) {
    const row = document.createElement('div');
    row.className = 'skleyka-row';
    // Check if there are completed-but-unstarred sessions (user needs to star them)
    const hasUnstarred = Object.values(editFrozenSessions).some(s => {
      if (!Array.isArray(s.cells) || s.starred !== false) return false;
      const audioCells = s.cells.filter(c => c.audioPath);
      return audioCells.length > 0 && audioCells.every(c => c.videoPath && !c._videoPending && !c.avatarTaskId && !c.videoError);
    });
    const emptyMsg = hasUnstarred
      ? 'Отметьте проект звёздочкой ★ во вкладке Эдит, чтобы он появился здесь'
      : allSessions.length && closedSet.size
        ? 'Все проекты закрыты. Откройте проект из вкладки «Финалы» или завершите генерацию.'
        : 'Здесь появится таймлайн после завершения генерации всех видеофрагментов';
    row.innerHTML = `<div class="col-header">Таймлайн</div><span style="color:#888;font-size:11px;">${emptyMsg}</span>`;
    wrap.appendChild(row);
    return;
  }

  const collapsedSet = getSkleykaCollapsed();

  for (let si = 0; si < sessions.length; si++) {
    const [sessionKey, session] = sessions[si];
    const scenName = sessionKey.split('__').slice(1).join('__').replace(/\.txt$/i, '');

    // Resolve scenario file object and activeObraz for this session
    const _sesScenFile = session.scenFile || sessionKey.split('__').slice(1,-1).join('__');
    const _sesObrazId  = session.obrazId  || sessionKey.split('__')[0];
    const f          = scenarioFiles.find(sf => sf.file === _sesScenFile) || { file: _sesScenFile, name: scenName };
    const activeObraz = (getObrazы?.() || []).find(o => String(o.id) === String(_sesObrazId))
                        || { id: _sesObrazId, name: session.obrazName || '', char: session.obrazChar || '' };

    // Load audio durations (all sessions here are completed — every audio cell has a video)
    const durations = await Promise.all(
      session.cells.map(c => c.audioPath ? getAudioDuration(c.audioPath) : Promise.resolve(0))
    );

    // Read per-session exclusions and controls settings
    const tlData = getTimelineData();
    const sessData = tlData[sessionKey] || {};
    const excludedSet = new Set(sessData.excludedSegments || []);

    // Build all segments with original (full) timing
    let allCursor = 0;
    const allSegments = session.cells.map((cell, i) => {
      const dur = durations[i] || 0; const start = allCursor; allCursor += dur;
      return { cell, idx: i, start, end: allCursor, dur };
    }).filter(s => s.dur > 0);

    // Active segments (non-excluded) with recalculated consecutive timing
    let activeCursor = 0;
    const activeSegments = allSegments
      .filter(s => !excludedSet.has(s.idx))
      .map(s => { const st = activeCursor; activeCursor += s.dur; return { ...s, activeStart: st, activeEnd: activeCursor }; });
    const totalDur = activeCursor;

    // ── Collapsible project wrapper ───────────────────────────────────────────
    let _btnSaveRef = null; // filled when btnSave is created below
    const isCollapsed = collapsedSet.has(sessionKey);

    const projectWrap = document.createElement('div');
    projectWrap.style.cssText = 'border-bottom:2px solid #808080;';

    const projectHdr = document.createElement('div');
    projectHdr.style.cssText =
      'display:flex;align-items:center;gap:6px;padding:4px 8px;' +
      'background:#a8a49c;cursor:pointer;user-select:none;';

    const pArrow = document.createElement('span');
    pArrow.style.cssText = 'font-size:9px;color:#333;flex-shrink:0;';
    pArrow.textContent = isCollapsed ? '▶' : '▼';

    const pTitle = document.createElement('span');
    pTitle.style.cssText = 'flex:1;font-weight:bold;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    pTitle.textContent = `Таймлан-${si + 1}: ${scenName}` + (totalDur > 0 ? `  (${totalDur.toFixed(2)}с)` : '');

    const pRefresh = document.createElement('button');
    pRefresh.textContent = '↺'; pRefresh.title = 'Обновить таймлайн';
    pRefresh.style.cssText = 'font-size:10px;padding:1px 5px;cursor:pointer;flex-shrink:0;';
    pRefresh.addEventListener('click', e => { e.stopPropagation(); renderAllTimelines(); });

    const pClose = document.createElement('button');
    pClose.textContent = '✕'; pClose.title = 'Закрыть проект';
    pClose.style.cssText = 'font-size:10px;padding:1px 5px;cursor:pointer;flex-shrink:0;color:#aa0000;font-weight:bold;';
    pClose.addEventListener('click', e => {
      e.stopPropagation();
      _showCloseProjectModal(sessionKey, () => _btnSaveRef, () => {
        const closed = getSkleykaClosed();
        closed.add(sessionKey);
        saveSkleykaClosed(closed);
        renderAllTimelines();
      });
    });

    projectHdr.appendChild(pArrow);
    projectHdr.appendChild(pTitle);
    projectHdr.appendChild(pRefresh);
    projectHdr.appendChild(pClose);

    const projectBody = document.createElement('div');
    projectBody.style.display = isCollapsed ? 'none' : '';

    projectHdr.addEventListener('click', () => {
      const col = getSkleykaCollapsed();
      if (projectBody.style.display === 'none') {
        projectBody.style.display = ''; pArrow.textContent = '▼'; col.delete(sessionKey);
      } else {
        projectBody.style.display = 'none'; pArrow.textContent = '▶'; col.add(sessionKey);
      }
      saveSkleykaCollapsed(col);
    });

    projectWrap.appendChild(projectHdr);
    projectWrap.appendChild(projectBody);

    // ── Row (content inside collapsible body) ─────────────────────────────────
    const row = document.createElement('div');
    row.className = 'skleyka-row';
    row.style.cssText = 'border-bottom:none;';

    const cols = document.createElement('div');
    cols.className = 'timeline-cols';

    // ── Left: fragment strip + audio bar + timing list ───────────────────────
    const leftCol = document.createElement('div');
    leftCol.className = 'timeline-col-left';

    // Fragment strip: excluded cells greyed and moved to end
    leftCol.appendChild(_buildFragStrip(session, sessionKey, { excludedSet }));

    // ── Video preview (filled after _ssState is init'd below) ────────────────
    const videoPreviewWrap = document.createElement('div');
    videoPreviewWrap.className = 'video-preview-wrap';
    videoPreviewWrap.innerHTML = '<div class="video-preview-placeholder">Предпросмотр появится после рендера</div>';
    leftCol.appendChild(videoPreviewWrap);

    // ── Timeline bars (hooks above, birolys below) ────────────────────────────
    if (totalDur > 0) {
      // Hooks bar (top)
      const hLbl = document.createElement('div');
      hLbl.style.cssText = 'font-size:8px;color:#888;margin-bottom:1px;';
      hLbl.textContent = 'Хуки:';

      const hBar = document.createElement('div');
      hBar.className = 'timeline-hooks-bar';
      hBar.dataset.sessionKey = sessionKey;
      hBar.dataset.totalDur   = String(totalDur);
      hBar.style.cssText = 'position:relative;height:26px;background:#111;border-radius:3px;overflow:hidden;margin-bottom:3px;';

      if (typeof _fillHooksBar === 'function') _fillHooksBar(hBar, sessionKey, totalDur);
      leftCol.appendChild(hLbl);
      leftCol.appendChild(hBar);

      // Birolys bar (below hooks)
      const bLbl = document.createElement('div');
      bLbl.style.cssText = 'font-size:8px;color:#888;margin-bottom:1px;';
      bLbl.textContent = 'Биролы:';

      const bBar = document.createElement('div');
      bBar.className = 'timeline-biroly-bar';
      bBar.dataset.sessionKey = sessionKey;
      bBar.dataset.totalDur   = String(totalDur);
      bBar.style.cssText = 'position:relative;height:26px;background:#111;border-radius:3px;overflow:hidden;margin-bottom:3px;';

      _fillBirolyBar(bBar, sessionKey, totalDur);
      leftCol.appendChild(bLbl);
      leftCol.appendChild(bBar);
    }

    if (activeSegments.length && totalDur > 0) {
      // Visual bar (active segments only, with recalculated positions)
      const bar = document.createElement('div');
      bar.style.cssText = 'position:relative;height:28px;background:#1a1a1a;border-radius:3px;overflow:hidden;margin-bottom:3px;';
      activeSegments.forEach(seg => {
        const el = document.createElement('div');
        el.style.cssText = `position:absolute;left:${(seg.activeStart/totalDur*100).toFixed(3)}%;width:${(seg.dur/totalDur*100).toFixed(3)}%;height:100%;background:${TL_COLORS[seg.idx%TL_COLORS.length]};border-right:1px solid rgba(0,0,0,0.4);box-sizing:border-box;display:flex;align-items:center;justify-content:center;overflow:hidden;`;
        el.title = `Фр.${seg.idx+1}: ${seg.activeStart.toFixed(2)}s–${seg.activeEnd.toFixed(2)}s (${seg.dur.toFixed(2)}s)\n${seg.cell.line||''}`;
        el.innerHTML = `<span style="font-size:8px;color:#fff;font-weight:bold;pointer-events:none;">${seg.idx+1}</span>`;
        bar.appendChild(el);
      });
      leftCol.appendChild(bar);

      // Ruler (active segments)
      const ruler = document.createElement('div');
      ruler.style.cssText = 'position:relative;height:12px;margin-bottom:4px;';
      activeSegments.forEach(seg => {
        const tick = document.createElement('span');
        tick.style.cssText = `position:absolute;left:${(seg.activeStart/totalDur*100).toFixed(3)}%;font-size:8px;color:#555;white-space:nowrap;transform:translateX(-50%);`;
        tick.textContent = seg.activeStart.toFixed(1)+'s';
        ruler.appendChild(tick);
      });
      const endTick = document.createElement('span');
      endTick.style.cssText = 'position:absolute;right:0;font-size:8px;color:#555;';
      endTick.textContent = totalDur.toFixed(1)+'s';
      ruler.appendChild(endTick);
      leftCol.appendChild(ruler);
    }

    // Fragment list — collapsed under a <details> dropdown
    if (allSegments.length) {
      const details = document.createElement('details');
      details.style.cssText = 'margin-top:4px;';
      const summary = document.createElement('summary');
      const exclCount = allSegments.filter(s => excludedSet.has(s.idx)).length;
      summary.style.cssText = 'font-size:12px;font-weight:700;color:#111;cursor:pointer;user-select:none;list-style:none;display:flex;align-items:center;gap:5px;padding:3px 0;';
      summary.innerHTML = `<span style="font-size:10px;color:#444;">▶</span><span>Фрагменты (${allSegments.length - exclCount}/${allSegments.length})</span>`;
      details.addEventListener('toggle', () => {
        const arrow = summary.querySelector('span:first-child');
        if (arrow) arrow.textContent = details.open ? '▼' : '▶';
      });

      const list = document.createElement('div');
      list.style.cssText = 'display:flex;flex-direction:column;gap:2px;margin-top:3px;';
      allSegments.forEach(seg => {
        const excluded = excludedSet.has(seg.idx);
        const r = document.createElement('div');
        r.style.cssText = 'display:flex;align-items:center;gap:5px;' + (excluded ? 'opacity:0.5;' : '');
        const dot = document.createElement('span');
        dot.style.cssText = `flex-shrink:0;width:8px;height:8px;border-radius:2px;background:${excluded ? '#777' : TL_COLORS[seg.idx%TL_COLORS.length]};`;
        const timing = document.createElement('span');
        timing.style.cssText = 'flex-shrink:0;font-size:9px;color:#555;white-space:nowrap;min-width:82px;' + (excluded ? 'text-decoration:line-through;' : '');
        timing.textContent = `${seg.start.toFixed(2)}s–${seg.end.toFixed(2)}s (${seg.dur.toFixed(2)}s)`;
        const text = document.createElement('span');
        text.style.cssText = 'font-size:9px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;' + (excluded ? 'text-decoration:line-through;color:#888;' : 'color:#333;');
        text.textContent = seg.cell.line || `Фр. ${seg.idx+1}`;
        const toggleBtn = document.createElement('button');
        toggleBtn.textContent = excluded ? '↺' : '×';
        toggleBtn.title = excluded ? 'Включить фрагмент' : 'Исключить фрагмент';
        toggleBtn.style.cssText = `flex-shrink:0;font-size:9px;padding:0 4px;cursor:pointer;line-height:1.4;border:1px solid ${excluded ? '#4a7a4a' : '#c05050'};background:${excluded ? '#2a3a2a' : '#3a2020'};color:${excluded ? '#8fc' : '#faa'};border-radius:2px;`;
        toggleBtn.addEventListener('click', () => {
          const d = getTimelineData();
          if (!d[sessionKey]) d[sessionKey] = {};
          const excl = new Set(d[sessionKey].excludedSegments || []);
          if (excluded) excl.delete(seg.idx); else excl.add(seg.idx);
          d[sessionKey].excludedSegments = [...excl];
          setTimelineData(d);
          renderAllTimelines();
        });
        r.appendChild(dot); r.appendChild(timing); r.appendChild(text); r.appendChild(toggleBtn);
        list.appendChild(r);
      });
      details.appendChild(summary);
      details.appendChild(list);
      leftCol.appendChild(details);

      // ── Subtitle generation row ──────────────────────────────────────────
      const sttRow = document.createElement('div');
      sttRow.style.cssText = 'display:flex;align-items:center;gap:5px;margin-top:5px;flex-wrap:wrap;';

      const sttBtn = document.createElement('button');
      sttBtn.textContent = '🎙 Субтитры';
      sttBtn.style.cssText = 'font-size:10px;font-weight:700;padding:3px 9px;cursor:pointer;border:1.5px solid #5a7a5a;background:#e8f0e8;color:#2a5a2a;border-radius:3px;white-space:nowrap;';

      const sttHelp = document.createElement('span');
      sttHelp.textContent = '?';
      sttHelp.title = 'Автоматическая расшифровка аудио каждого фрагмента.\n\n⚡ Groq Whisper (приоритет) — быстро, бесплатно. Добавь GROQ_API_KEY в .env или в Мозги → CreationEngines → API Ключи.\n\n☁ kie.ai ElevenLabs (резерв) — если Groq ключ не настроен.\n\nСоздаёт .srt файл субтитров с точными временными метками, синхронизированными с таймлайном видео.';
      sttHelp.style.cssText = 'font-size:9px;font-weight:700;color:#666;border:1px solid #aaa;border-radius:50%;width:14px;height:14px;display:inline-flex;align-items:center;justify-content:center;cursor:help;flex-shrink:0;';

      const sttStatus = document.createElement('span');
      sttStatus.style.cssText = 'font-size:9px;color:#666;';

      const assBtn = document.createElement('button');
      assBtn.textContent = '{ }';
      assBtn.title = 'Настройка стиля субтитров (libass):\nшрифты, цвета, контур, анимации, позиция';
      assBtn.style.cssText = 'font-size:10px;font-weight:700;padding:2px 7px;cursor:pointer;border:1.5px solid #5a6a9a;background:#e8eaf8;color:#2a3a7a;border-radius:3px;white-space:nowrap;';
      assBtn.addEventListener('click', () => _openAssModal(sessionKey));

      sttRow.appendChild(sttBtn);
      sttRow.appendChild(sttHelp);
      sttRow.appendChild(assBtn);
      sttRow.appendChild(sttStatus);

      // Result row (hidden until done)
      const sttResultRow = document.createElement('div');
      sttResultRow.style.cssText = 'display:none;flex-direction:column;gap:4px;margin-top:4px;';

      const sttResultBtns = document.createElement('div');
      sttResultBtns.style.cssText = 'display:flex;gap:5px;align-items:center;';

      const sttDownBtn = document.createElement('a');
      sttDownBtn.textContent = '⬇ Скачать .srt';
      sttDownBtn.style.cssText = 'font-size:10px;font-weight:700;padding:3px 8px;border:1.5px solid #5a7a9a;background:#e8edf8;color:#2a4a7a;border-radius:3px;text-decoration:none;cursor:pointer;';

      const sttPreviewBtn = document.createElement('button');
      sttPreviewBtn.textContent = '👁 Просмотр';
      sttPreviewBtn.style.cssText = 'font-size:10px;font-weight:700;padding:3px 8px;border:1.5px solid #888;background:#f0f0f0;color:#333;border-radius:3px;cursor:pointer;';

      const sttPreviewBox = document.createElement('pre');
      sttPreviewBox.style.cssText = 'display:none;font-size:9px;font-family:monospace;color:#222;background:#f8f8f8;border:1px solid #ccc;border-radius:3px;padding:5px 7px;max-height:140px;overflow-y:auto;white-space:pre-wrap;word-break:break-word;margin:0;';

      sttPreviewBtn.addEventListener('click', () => {
        const open = sttPreviewBox.style.display === 'none';
        sttPreviewBox.style.display = open ? 'block' : 'none';
        sttPreviewBtn.textContent = open ? '▲ Скрыть' : '👁 Просмотр';
      });

      sttResultBtns.appendChild(sttDownBtn);
      sttResultBtns.appendChild(sttPreviewBtn);
      sttResultRow.appendChild(sttResultBtns);
      sttResultRow.appendChild(sttPreviewBox);
      leftCol.appendChild(sttRow);
      leftCol.appendChild(sttResultRow);

      // STT generation handler
      sttBtn.addEventListener('click', async () => {
        const segsForStt = activeSegments.filter(s => s.cell.audioPath);
        if (!segsForStt.length) { sttStatus.textContent = '⚠ Нет аудио'; return; }
        sttBtn.disabled = true;
        sttStatus.textContent = 'Запрос…';
        sttResultRow.style.display = 'none';
        sttPreviewBox.style.display = 'none';
        sttPreviewBtn.textContent = '👁 Просмотр';

        try {
          const r = await fetch('/api/audio/stt', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              segments: segsForStt.map(s => ({
                audioPath:  s.cell.audioPath,
                timeOffset: s.activeStart,
              })),
            }),
          });
          const rj = await r.json();
          if (!rj.success) throw new Error(rj.error || 'Ошибка запуска');
          const { jobId } = rj;
          sttStatus.textContent = rj.provider === 'groq' ? '⚡ Groq…' : '☁ kie.ai…';

          // Poll
          const poll = setInterval(async () => {
            try {
              const sr = await fetch(`/api/audio/stt/status/${jobId}`);
              const sj = await sr.json();
              if (!sj.success) return;

              if (sj.state === 'done') {
                clearInterval(poll);
                sttBtn.disabled = false;
                sttStatus.textContent = '✓ Готово';

                // Download link
                sttDownBtn.href = sj.srtPath;
                sttDownBtn.download = `subtitles_${scenName}.srt`;

                // Preview
                sttPreviewBox.textContent = sj.srtContent || '';
                sttResultRow.style.display = 'flex';

                // Store parsed subtitles + raw words in session for render
                const parsedSubs = _parseSrt(sj.srtContent || '');
                const _d = getTimelineData();
                if (!_d[sessionKey]) _d[sessionKey] = {};
                _d[sessionKey].srtSubtitles  = parsedSubs;
                _d[sessionKey].srtWords      = sj.words || [];
                delete _d[sessionKey].prebuiltAssPath; // invalidate stale ASS file after re-analysis
                setTimelineData(_d);

              } else if (sj.state === 'failed') {
                clearInterval(poll);
                sttBtn.disabled = false;
                sttStatus.textContent = '⚠ ' + (sj.error || 'Ошибка').slice(0, 60);
              } else {
                const prog = sj.progress ? ` (${sj.progress})` : '…';
                sttStatus.textContent = `Обработка${prog}`;
              }
            } catch {}
          }, 3000);

        } catch (e) {
          sttBtn.disabled = false;
          sttStatus.textContent = '⚠ ' + e.message.slice(0, 60);
        }
      });
    }

    // ── Right: biroly timings + action buttons ─────────────────────────────
    const rightArea = document.createElement('div');
    rightArea.className = 'timeline-col-right-area';

    const rightCol = document.createElement('div');
    rightCol.className = 'timeline-col-right';
    rightCol.dataset.sessionKey = sessionKey;
    if (typeof renderSessionHooks === 'function') renderSessionHooks(rightCol, sessionKey);
    renderSessionBirolys(rightCol, sessionKey);
    rightArea.appendChild(rightCol);
    // ssCol (action buttons) will be appended to rightArea after construction below

    cols.appendChild(leftCol);
    cols.appendChild(rightArea);
    row.appendChild(cols);

    // ── Separator + per-project controls ────────────────────────────────────
    const hr = document.createElement('hr');
    hr.style.cssText = 'border:none;border-top:1px solid #a0a0a0;margin:6px 0 5px;';
    row.appendChild(hr);

    const controls = document.createElement('div');
    controls.style.cssText = 'display:flex;flex-direction:column;gap:5px;padding:0 4px 6px;font-size:10px;color:#444;';

    const makeSelect = (label, options, key) => {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'display:flex;align-items:center;gap:6px;';
      const lbl = document.createElement('span');
      lbl.style.cssText = 'white-space:nowrap;font-size:10px;color:#555;min-width:68px;';
      lbl.textContent = label + ':';
      const sel = document.createElement('select');
      sel.style.cssText = 'font-size:10px;padding:1px 3px;flex:1;max-width:120px;';
      options.forEach(opt => {
        const o = document.createElement('option');
        o.value = opt; o.textContent = opt;
        sel.appendChild(o);
      });
      const savedVal = (tlData[sessionKey] || {})[key];
      if (savedVal && options.includes(savedVal)) sel.value = savedVal;
      sel.addEventListener('change', () => {
        const d = getTimelineData();
        if (!d[sessionKey]) d[sessionKey] = {};
        d[sessionKey][key] = sel.value;
        setTimelineData(d);
      });
      wrap.appendChild(lbl); wrap.appendChild(sel);
      return wrap;
    };

    // ── FFmpeg transition options ──────────────────────────────────────────────
    // Paired transitions: applied at start AND end of each clip
    const SEG_TRANS_OPTS = [
      { v:'none',       l:'Нет' },
      { v:'fade',       l:'Fade (чёрный)' },
      { v:'fadewhite',  l:'Fade (белый)' },
      { v:'fadegrays',  l:'Fade (серый)' },
      { v:'blur',       l:'Blur In/Out' },
    ];
    const BIRO_TRANS_OPTS = [
      { v:'none',       l:'Нет' },
      { v:'fade',       l:'Fade (чёрный)' },
      { v:'fadewhite',  l:'Fade (белый)' },
      { v:'fadegrays',  l:'Fade (серый)' },
      { v:'blur',       l:'Blur In/Out' },
    ];
    const ANIM_OPTS = [
      { v:'none',     l:'Нет' },
      { v:'zoom_in',  l:'Zoom In (slow)' },
      { v:'zoom_out', l:'Zoom Out (slow)' },
      { v:'vignette', l:'Vignette' },
      { v:'sharpen',  l:'Sharpen' },
      { v:'warm',     l:'Warm тон' },
      { v:'cool',     l:'Cool тон' },
    ];

    const _makeVolumeRow = (label, tlKey, defaultVal) => {
      const row = document.createElement('div');
      row.className = 'ss-param-row';
      const lbl = document.createElement('span');
      lbl.className = 'ss-param-lbl'; lbl.textContent = label;
      const slider = document.createElement('input');
      slider.type = 'range'; slider.min = '0'; slider.max = '2'; slider.step = '0.05';
      slider.className = 'ss-vol-slider';
      const saved = sessData[tlKey];
      slider.value = (saved != null && !isNaN(saved)) ? saved : defaultVal;
      slider.addEventListener('input', () => {
        const d = getTimelineData(); if (!d[sessionKey]) d[sessionKey] = {};
        d[sessionKey][tlKey] = parseFloat(slider.value); setTimelineData(d);
      });
      row.appendChild(lbl); row.appendChild(slider);
      return row;
    };

    const _makeSettingRow = (label, opts, tlKey, defaultVal) => {
      const row = document.createElement('div');
      row.className = 'ss-param-row';
      const lbl = document.createElement('span');
      lbl.className = 'ss-param-lbl'; lbl.textContent = label;
      const sel = document.createElement('select');
      sel.className = 'ss-param-sel';
      opts.forEach(o => {
        const opt = document.createElement('option'); opt.value = o.v; opt.textContent = o.l; sel.appendChild(opt);
      });
      const saved = (sessData)[tlKey];
      sel.value = (saved && opts.find(o => o.v === saved)) ? saved : (defaultVal || opts[0].v);
      sel.addEventListener('change', () => {
        const d = getTimelineData(); if (!d[sessionKey]) d[sessionKey] = {};
        d[sessionKey][tlKey] = sel.value; setTimelineData(d);
      });
      row.appendChild(lbl); row.appendChild(sel);
      return row;
    };

    // ── Two-column settings panel ──────────────────────────────────────────────
    const settingsPanel = document.createElement('div');
    settingsPanel.className = 'ss-settings-panel';

    const segCol = document.createElement('div');
    segCol.className = 'ss-settings-col';
    const segHdr = document.createElement('div');
    segHdr.className = 'ss-settings-col-hdr'; segHdr.textContent = '🎬 Говорящая голова';
    segCol.appendChild(segHdr);
    segCol.appendChild(_makeVolumeRow('Громкость', 'segVolume', 1.0));
    segCol.appendChild(_makeSettingRow('Переход',  SEG_TRANS_OPTS, 'segTransition', 'fade'));
    segCol.appendChild(_makeSettingRow('Анимация', ANIM_OPTS,      'segAnimation',  'none'));
    const segSfxCtrl = makeSfxControl(sessionKey, tlData, 'segSfx');
    segCol.appendChild(segSfxCtrl.el);
    segCol.appendChild(_makeVolumeRow('Громк. вжухи', 'segSfxVolume', 0.8));

    const biroCol = document.createElement('div');
    biroCol.className = 'ss-settings-col';
    const biroHdr = document.createElement('div');
    biroHdr.className = 'ss-settings-col-hdr'; biroHdr.textContent = '🎭 Биролы';
    biroCol.appendChild(biroHdr);
    biroCol.appendChild(_makeSettingRow('Переход',  BIRO_TRANS_OPTS, 'biroTransition', 'fade'));
    biroCol.appendChild(_makeSettingRow('Анимация', ANIM_OPTS,       'biroAnimation',  'none'));
    const biroSfxCtrl = makeSfxControl(sessionKey, tlData, 'biroSfx');
    biroCol.appendChild(biroSfxCtrl.el);
    biroCol.appendChild(_makeVolumeRow('Громк. вжухи', 'biroSfxVolume', 0.8));

    settingsPanel.appendChild(segCol);
    settingsPanel.appendChild(biroCol);
    controls.appendChild(settingsPanel);

    // ── Music section (full width) ─────────────────────────────────────────────
    const getVideoDur = () => activeSegments.reduce((m, s) => Math.max(m, s.activeEnd || 0), 30);
    const musicCtrl = makeMusicControl(sessionKey, tlData, getVideoDur);

    const audioSection = document.createElement('details');
    audioSection.className = 'audio-section-details';
    const audioSummary = document.createElement('summary');
    audioSummary.className = 'audio-section-summary';
    audioSummary.textContent = '🎵 Музычка';
    const musicVolSlider = document.createElement('input');
    musicVolSlider.type = 'range'; musicVolSlider.min = '0'; musicVolSlider.max = '2'; musicVolSlider.step = '0.05';
    musicVolSlider.className = 'ss-vol-slider ss-vol-slider-music';
    const savedMV = sessData.musicVolume;
    musicVolSlider.value = (savedMV != null && !isNaN(savedMV)) ? savedMV : 0.5;
    musicVolSlider.addEventListener('click', e => e.stopPropagation()); // prevent toggle
    musicVolSlider.addEventListener('input', () => {
      const d = getTimelineData(); if (!d[sessionKey]) d[sessionKey] = {};
      d[sessionKey].musicVolume = parseFloat(musicVolSlider.value); setTimelineData(d);
    });
    audioSummary.appendChild(musicVolSlider);
    audioSection.appendChild(audioSummary);
    audioSection.appendChild(musicCtrl.el);
    controls.appendChild(audioSection);
    // ── Action column ──────────────────────────────────────────────────────────
    const ssCol = document.createElement('div');
    ssCol.className = 'ss-action-col';

    const statusEl = document.createElement('div');
    statusEl.className = 'ss-status';

    const btnMerge = document.createElement('button');
    btnMerge.className = 'ss-btn ss-btn-merge';
    btnMerge.textContent = '▶ Мердж';
    btnMerge.title = 'Рендер через FFmpeg локально';

    const btnMergeJson = document.createElement('button');
    btnMergeJson.className = 'ss-btn-json';
    btnMergeJson.textContent = '{ }';
    btnMergeJson.title = 'Настройки FFmpeg (разрешение, качество, цвет, субтитры)';

    const btnSave = document.createElement('button');
    btnSave.className = 'ss-btn ss-btn-save';
    btnSave.textContent = '💾 Сохранить';
    btnSave.title = 'Сохранить видео в архив';
    btnSave.disabled = true;
    _btnSaveRef = btnSave; // allow close-modal to reference it

    // Per-session state (renderUrl persisted to localStorage)
    const _SS_KEY = `ss_state_${sessionKey}`;
    const _ssStateStored = (() => { try { return JSON.parse(localStorage.getItem(_SS_KEY) || '{}'); } catch { return {}; } })();
    let _ssState = { renderUrl: _ssStateStored.renderUrl || null };

    function _updateVideoPreview(url) {
      videoPreviewWrap.innerHTML = '';
      if (url) {
        const vid = document.createElement('video');
        vid.src = url; vid.controls = true; vid.preload = 'metadata';
        vid.style.cssText = 'width:100%;max-height:220px;border-radius:3px;background:#000;display:block;';
        videoPreviewWrap.appendChild(vid);
      } else {
        videoPreviewWrap.innerHTML = '<div class="video-preview-placeholder">Предпросмотр появится после рендера</div>';
      }
    }
    if (_ssState.renderUrl) { _updateVideoPreview(_ssState.renderUrl); btnSave.disabled = false; }

    function _setStatus(msg, cls = '') {
      statusEl.textContent = msg;
      statusEl.className = 'ss-status' + (cls ? ' ' + cls : '');
    }

    // ── СОХРАНИТЬ ─────────────────────────────────────────────────────────────
    btnSave.addEventListener('click', async () => {
      if (!_ssState.renderUrl) { _setStatus('Нет URL видео', 'err'); return; }
      btnSave.disabled = true;
      _setStatus('Сохраняем…', 'spin');

      try {
        const archive = typeof getBirolyArchive === 'function' ? getBirolyArchive() : [];
        const tlData  = getTimelineData();
        const sd      = tlData[sessionKey] || {};
        const projectData = {
          sessionKey,
          timelineData: sd,
          archive,
          frozenSession: editFrozenSessions[sessionKey] || null,
          scenFile: f.file,
          scenName: f.name,
          obrazId:  String(activeObraz.id),
          obrazName: activeObraz.name,
          obrazChar: activeObraz.char || '',
        };

        const r = await fetch('/api/finals/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            renderUrl:    _ssState.renderUrl,
            sessionLabel: `${f.name} — ${activeObraz.name}`,
            projectData,
          }),
        });
        const d = await r.json();
        if (!d.success) throw new Error(d.error || 'Ошибка');
        _setStatus('Сохранено!', 'ok');
        window.loadFinals?.();
        window.loadComboFinals?.();
      } catch (e) {
        _setStatus(e.message, 'err');
        btnSave.disabled = false;
      }
    });

    // ── JSON VIEWER (modal elements) ─────────────────────────────────────────
    const _rbOverlay  = document.getElementById('rb-modal-overlay');
    const _rbTa       = document.getElementById('rb-modal-ta');
    const _rbErr      = document.getElementById('rb-modal-err');
    const _rbSaveBtn  = document.getElementById('rb-modal-save');
    const _rbCloseBtn = document.getElementById('rb-modal-close');

    function _closeRbModal() { _rbOverlay.classList.remove('open'); }
    _rbCloseBtn.addEventListener('click', _closeRbModal);
    _rbOverlay.addEventListener('click', e => { if (e.target === _rbOverlay) _closeRbModal(); });

    // Ctrl+S inside textarea — save; Escape — close
    _rbTa.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); _rbSaveBtn.click(); }
      if (e.key === 'Escape') _closeRbModal();
    });

    _rbSaveBtn.addEventListener('click', async () => {
      try {
        const parsed = JSON.parse(_rbTa.value);
        const jid = _rbSaveBtn._ffmpegJobId;
        if (jid) {
          const r = await fetch(`/api/ffmpeg/body/${jid}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(parsed),
          });
          const d = await r.json();
          if (!d.success) throw new Error(d.error || 'Ошибка сохранения');
        }
        _rbErr.style.color = '#9fe09f';
        _rbErr.textContent = '✓ Сохранено';
        setTimeout(() => { _rbErr.textContent = ''; _rbErr.style.color = ''; }, 2000);
      } catch (e) {
        _rbErr.style.color = '#e07070';
        _rbErr.textContent = '⚠ Ошибка: ' + e.message;
      }
    });

    // ── МЕРДЖ (FFmpeg локально) ───────────────────────────────────────────────
    btnMerge.addEventListener('click', async () => {
      const archive   = typeof getBirolyArchive === 'function' ? getBirolyArchive() : [];
      const tlDataNow = getTimelineData();
      const sd        = tlDataNow[sessionKey] || {};
      const activated = sd.activated || [];
      const timings   = sd.timings   || {};

      // Biroly clips
      const birolyClips = activated.map(idx => {
        const b = archive[idx]; const t = timings[idx];
        if (!b || !b.videoPath || !t || t.start === undefined) return null;
        return { videoPath: b.videoPath, name: b.name || 'Бирол',
                 start: parseFloat(t.start)||0, end: parseFloat(t.end)||6,
                 crop: parseFloat(t.crop)||0, speed: parseFloat(t.speed)||1 };
      }).filter(Boolean);

      // Hook clips
      const hooksData  = sd.hooks || {};
      const hooksList  = typeof getHooksArchive === 'function' ? getHooksArchive() : [];
      const hookClips  = (hooksData.activated || []).map(idx => {
        const h = hooksList[idx]; const ht = (hooksData.timings || {})[idx];
        if (!h || !h.videoPath || !ht || ht.start === undefined) return null;
        return { videoPath: h.videoPath, name: h.name || 'Хук',
                 start: parseFloat(ht.start)||0, end: parseFloat(ht.end)||6,
                 crop: parseFloat(ht.crop)||0, speed: parseFloat(ht.speed)||1 };
      }).filter(Boolean);

      const localClips = [...birolyClips, ...hookClips].sort((a, b) => a.start - b.start);

      const localSegClips = activeSegments.filter(s => s.cell.videoPath).map(s => ({
        name: s.cell.line || `Фр.${s.idx+1}`, videoPath: s.cell.videoPath,
        start: s.activeStart, end: s.activeEnd, crop: 0,
      }));

      if (!localSegClips.length) { _setStatus('Нет видео сегментов', 'err'); return; }

      btnMerge.disabled = true;
      btnSave.disabled = true;
      _setStatus('Рендерим…', 'spin');

      try {
        const advSettings   = { ...ADV_DEFAULTS, ...(sd.advSettings || {}) };
        const assSettings   = { ...ASS_DEFAULTS, ...(sd.assSettings || {}) };
        const subtitles     = advSettings.subsEnabled
          ? localSegClips.map(s => ({ text: s.name, start: s.start, end: s.end }))
          : [];
        const srtSubtitles    = sd.srtSubtitles    || [];
        const srtWords        = sd.srtWords        || [];
        const prebuiltAssPath = sd.prebuiltAssPath || null;

        const r = await fetch('/api/ffmpeg/render', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            segmentClips:   localSegClips,
            clips:          localClips,
            music:          musicCtrl.getUrl(),
            musicOffset:    musicCtrl.getOffset(),
            musicVolume:    sd.musicVolume   != null ? sd.musicVolume   : 0.5,
            segVolume:      sd.segVolume     != null ? sd.segVolume     : 1.0,
            segTransition:  sd.segTransition  || 'fade',
            segAnimation:   sd.segAnimation   || 'none',
            segSfx:         segSfxCtrl.getUrl(),
            segSfxVolume:   sd.segSfxVolume  != null ? sd.segSfxVolume  : 0.8,
            biroTransition: sd.biroTransition || 'fade',
            biroAnimation:  sd.biroAnimation  || 'none',
            biroSfx:        biroSfxCtrl.getUrl(),
            biroSfxVolume:  sd.biroSfxVolume != null ? sd.biroSfxVolume : 0.8,
            outputLabel:    scenName,
            advSettings,
            subtitles,
            srtSubtitles,
            srtWords,
            assSettings,
            prebuiltAssPath,
          }),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status} — перезапусти сервер`);
        const rj = await r.json();
        if (!rj.success) throw new Error(rj.error || 'Ошибка запуска');

        const { jobId } = rj;
        btnMergeJson._jobId = jobId;
        btnMergeJson.disabled = false;

        const poll = setInterval(async () => {
          try {
            const sr = await fetch(`/api/ffmpeg/status/${jobId}`);
            const sj = await sr.json();
            if (!sj.success) return;
            if (sj.status === 'done') {
              clearInterval(poll);
              _ssState.renderUrl = sj.url;
              try { const st2 = JSON.parse(localStorage.getItem(_SS_KEY)||'{}'); localStorage.setItem(_SS_KEY, JSON.stringify({...st2, renderUrl: sj.url})); } catch {}
              _updateVideoPreview(sj.url);
              btnSave.disabled = false;
              btnMerge.disabled = false;
              _setStatus('Готово!', 'ok');
            } else if (sj.status === 'failed') {
              clearInterval(poll);
              btnMerge.disabled = false;
              _setStatus((sj.error || 'Ошибка рендера').slice(0, 120), 'err');
            } else {
              const prog = sj.progressSecs > 0 ? ` (${sj.progressSecs.toFixed(0)}с)` : '';
              _setStatus(`Рендерим…${prog}`, 'spin');
            }
          } catch {}
        }, 2000);
      } catch (e) {
        btnMerge.disabled = false;
        _setStatus(e.message.slice(0, 120), 'err');
      }
    });

    // ── НАСТРОЙКИ FFmpeg ──────────────────────────────────────────────────────
    btnMergeJson.addEventListener('click', () => _openAdvModal(sessionKey));

    const mergeRow = document.createElement('div');
    mergeRow.className = 'ss-merge-row';
    mergeRow.appendChild(btnMerge);
    mergeRow.appendChild(btnMergeJson);

    ssCol.appendChild(mergeRow);
    ssCol.appendChild(btnSave);
    ssCol.appendChild(statusEl);

    // Action buttons go to the bottom of the right (biroly) area
    rightArea.appendChild(ssCol);

    row.appendChild(controls);
    projectBody.appendChild(row);
    wrap.appendChild(projectWrap);
  }
}
window.renderAllTimelines = renderAllTimelines;

// ── Реран popup: full regen for a specific fragment (from Склейка thumbnail strip) ─
function _openSkleykaReranPopup(sessionKey, session, activeObraz, cellIdx) {
  // Always read fresh from editFrozenSessions so we have the live object
  const frozen = editFrozenSessions?.[sessionKey];
  if (!frozen || !frozen.cells) return;
  const cell = frozen.cells[cellIdx];
  if (!cell) return;

  const frozenObraz = activeObraz || (getObrazы?.() || []).find(o => String(o.id) === String(session.obrazId));
  // Clean char images only (without item overlays) — obraz variations + charImagePath
  const charImages  = frozenObraz
    ? [...new Set([
        frozenObraz.char,
        ...(frozenObraz.variations || []).filter(v => v && v !== 'error'),
        cell.charImagePath,
      ].filter(Boolean))]
    : (cell.charImagePath ? [cell.charImagePath] : []);

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:11000;display:flex;align-items:center;justify-content:center;';
  document.body.appendChild(overlay);
  overlay.addEventListener('mousedown', e => { if (e.target === overlay) overlay.remove(); });

  const popup = document.createElement('div');
  popup.style.cssText = 'background:#c0c0c0;border:2px solid;border-color:#fff #808080 #808080 #fff;width:480px;max-width:97vw;max-height:94vh;display:flex;flex-direction:column;box-sizing:border-box;';
  overlay.appendChild(popup);

  const titleBar = document.createElement('div');
  titleBar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;background:#000080;color:#fff;padding:3px 8px;flex-shrink:0;';
  titleBar.innerHTML = `<span style="font-size:11px;font-weight:bold;">↺ Реран — Фр. ${cellIdx + 1}: ${(cell.line || '').slice(0, 40)}</span>`;
  const closeX = document.createElement('button');
  closeX.textContent = '✕';
  closeX.style.cssText = 'background:none;border:none;color:#fff;cursor:pointer;font-size:13px;padding:0 2px;';
  closeX.addEventListener('click', () => overlay.remove());
  titleBar.appendChild(closeX);
  popup.appendChild(titleBar);

  const body = document.createElement('div');
  body.style.cssText = 'display:flex;flex-direction:column;gap:8px;padding:10px;overflow-y:auto;flex:1;';
  popup.appendChild(body);

  const sec = (label) => {
    const d = document.createElement('div');
    d.style.cssText = 'display:flex;flex-direction:column;gap:4px;';
    const lbl = document.createElement('div');
    lbl.style.cssText = 'font-size:10px;font-weight:bold;color:#222;border-bottom:1px solid #bbb;padding-bottom:2px;';
    lbl.textContent = label;
    d.appendChild(lbl);
    return d;
  };

  // ── 1. Текст голоса ────────────────────────────────────────────────────────
  const textSec = sec('Текст закадрового голоса');
  const textArea = document.createElement('textarea');
  textArea.value = cell.line || '';
  textArea.rows = 3;
  textArea.style.cssText = 'font-size:10px;resize:vertical;padding:4px;font-family:inherit;width:100%;box-sizing:border-box;';
  textSec.appendChild(textArea);
  body.appendChild(textSec);

  // ── 2. Голос ───────────────────────────────────────────────────────────────
  const voiceSec = sec('Голос');
  const voiceSel = document.createElement('select');
  voiceSel.style.cssText = 'font-size:10px;padding:2px 3px;width:100%;';
  const _savedVoice = localStorage.getItem(`edit_voice__${sessionKey}`) || frozenObraz?.voice || 'Rachel';
  const sortedV = [...(window.ELEVENLABS_VOICES || [])].sort((a, b) => (b.desc ? 1 : 0) - (a.desc ? 1 : 0));
  sortedV.forEach(v => {
    const o = document.createElement('option');
    o.value = v.name;
    o.textContent = v.name + (v.desc ? ` — ${v.desc}` : '');
    if (v.name === _savedVoice) o.selected = true;
    voiceSel.appendChild(o);
  });
  voiceSec.appendChild(voiceSel);
  body.appendChild(voiceSec);

  // ── 3. Вариация образа (только чистые фото, без предмета) ─────────────────
  // selectedBaseChar = clean char photo (for item regen input)
  // selectedAvatarImg = actual image sent to avatar API (interaction photo when item present)
  let selectedBaseChar  = cell.charImagePath || charImages[0] || null;
  let selectedAvatarImg = cell.detInfo
    ? (cell.imagePath || cell.charImagePath || null)
    : (cell.charImagePath || cell.imagePath || null);
  const imgSec = sec('Вариация образа');
  const imgScroll = document.createElement('div');
  imgScroll.style.cssText = 'display:flex;flex-wrap:wrap;gap:5px;max-height:130px;overflow-y:auto;padding:2px;';
  charImages.forEach(src => {
    const wrap = document.createElement('div');
    wrap.style.cssText = `width:56px;flex-shrink:0;cursor:pointer;border:2px solid ${src === selectedBaseChar ? '#4a6a9a' : 'transparent'};box-sizing:border-box;`;
    const img = document.createElement('img');
    img.src = src; img.style.cssText = 'width:56px;height:74px;object-fit:cover;display:block;';
    img.addEventListener('error', () => { wrap.style.display = 'none'; });
    wrap.appendChild(img);
    wrap.addEventListener('click', () => {
      imgScroll.querySelectorAll('div[data-ci]').forEach(el => el.style.border = '2px solid transparent');
      wrap.style.border = '2px solid #4a6a9a';
      selectedBaseChar = src;
      selectedAvatarImg = src; // clean photo selected, no item overlay
    });
    wrap.dataset.ci = src;
    imgScroll.appendChild(wrap);
  });
  if (!charImages.length) imgScroll.innerHTML = '<span style="font-size:9px;color:#888;">Нет вариаций</span>';
  imgSec.appendChild(imgScroll);
  body.appendChild(imgSec);

  // ── 4. Выбор предмета ─────────────────────────────────────────────────────
  let selectedDetInfo = cell.detInfo || null;
  const allDetails = (typeof cachedDetailFiles !== 'undefined' ? cachedDetailFiles : []);
  const detSec = sec('Предмет');
  const detScroll = document.createElement('div');
  detScroll.style.cssText = 'display:flex;flex-wrap:wrap;gap:5px;max-height:110px;overflow-y:auto;padding:2px;';

  // "Без предмета" option
  const noItemWrap = document.createElement('div');
  noItemWrap.style.cssText = `width:56px;flex-shrink:0;cursor:pointer;border:2px solid ${!cell.detInfo ? '#4a6a9a' : 'transparent'};box-sizing:border-box;display:flex;align-items:center;justify-content:center;background:#e8e8e8;`;
  noItemWrap.style.height = '74px';
  noItemWrap.innerHTML = '<span style="font-size:8px;text-align:center;color:#555;padding:2px;">Без<br>предмета</span>';
  noItemWrap.dataset.di = '__none__';
  noItemWrap.addEventListener('click', () => {
    detScroll.querySelectorAll('div[data-di]').forEach(el => el.style.border = '2px solid transparent');
    noItemWrap.style.border = '2px solid #4a6a9a';
    selectedDetInfo = null;
  });
  detScroll.appendChild(noItemWrap);

  allDetails.forEach(det => {
    const thumbSrc = det.thumbPath || det.path;
    const wrap = document.createElement('div');
    const isCurrent = cell.detInfo && det.file === cell.detInfo.file;
    wrap.style.cssText = `width:56px;flex-shrink:0;cursor:pointer;border:2px solid ${isCurrent ? '#4a6a9a' : 'transparent'};box-sizing:border-box;`;
    const img = document.createElement('img');
    img.src = thumbSrc; img.style.cssText = 'width:56px;height:74px;object-fit:cover;display:block;';
    img.title = det.name || det.file;
    img.addEventListener('error', () => { wrap.style.display = 'none'; });
    wrap.appendChild(img);
    wrap.dataset.di = det.file;
    wrap.addEventListener('click', () => {
      detScroll.querySelectorAll('div[data-di]').forEach(el => el.style.border = '2px solid transparent');
      wrap.style.border = '2px solid #4a6a9a';
      selectedDetInfo = det;
    });
    detScroll.appendChild(wrap);
  });
  if (!allDetails.length) detScroll.innerHTML += '<span style="font-size:9px;color:#888;">Нет предметов</span>';
  detSec.appendChild(detScroll);
  body.appendChild(detSec);

  // ── 5. Вариант взаимодействия с предметом (dropdown из generatedImages) + текст ────
  let varSel = null;
  let interactionCustomText = '';
  const varSec = sec('Вариант взаимодействия');
  if (cell.detInfo && cell.generatedImages?.length) {
    varSel = document.createElement('select');
    varSel.style.cssText = 'font-size:10px;padding:2px 3px;width:100%;';
    const noOpt = document.createElement('option');
    noOpt.value = ''; noOpt.textContent = 'нет';
    varSel.appendChild(noOpt);
    cell.generatedImages.forEach((src, i) => {
      const o = document.createElement('option');
      o.value = src;
      o.textContent = `Вариант ${i + 1}${src === cell.imagePath ? ' ★' : ''}`;
      if (src === cell.imagePath) o.selected = true;
      varSel.appendChild(o);
    });
    varSel.addEventListener('change', () => {
      if (varSel.value) {
        selectedAvatarImg = varSel.value;
        selectedDetInfo = cell.detInfo;
      } else {
        selectedAvatarImg = cell.detInfo
          ? (cell.imagePath || cell.charImagePath || null)
          : (cell.charImagePath || null);
      }
    });
    varSec.appendChild(varSel);
  }
  const interactionInput = document.createElement('textarea');
  interactionInput.rows = 2;
  interactionInput.placeholder = 'Уточнение взаимодействия (рус. или англ.)…';
  interactionInput.style.cssText = 'font-size:9px;resize:vertical;padding:3px 4px;font-family:inherit;width:100%;box-sizing:border-box;margin-top:4px;';
  interactionInput.addEventListener('input', () => {
    interactionCustomText = interactionInput.value;
    if (interactionCustomText.trim() && varSel) {
      varSel.value = '';
      selectedAvatarImg = cell.detInfo
        ? (cell.imagePath || cell.charImagePath || null)
        : (cell.charImagePath || null);
    }
  });
  varSec.appendChild(interactionInput);
  body.appendChild(varSec);

  // ── 6. Поза / движение аватара (dropdown) ─────────────────────────────────
  const POSE_PRESETS = [
    { key: 'natural',   label: 'Плавное',     prompt: 'Natural speaking motion with subtle head movement and relaxed posture' },
    { key: 'energetic', label: 'Энергичное',  prompt: 'Energetic speaking with animated gestures and expressive face' },
    { key: 'calm',      label: 'Спокойное',   prompt: 'Calm thoughtful delivery with minimal movement and gentle nods' },
    { key: 'dramatic',  label: 'Театральное', prompt: 'Dramatic expressive delivery with strong emotional gestures' },
    { key: 'nodding',   label: 'Кивки',       prompt: 'Confident speaking with steady nodding and direct eye contact' },
    { key: 'custom',    label: 'Свой…',       prompt: '' },
  ];
  let selectedPosePrompt = POSE_PRESETS[0].prompt;
  let translatedPoseText = '';

  const poseSec = sec('Поза / движение аватара');
  const poseSel = document.createElement('select');
  poseSel.style.cssText = 'font-size:10px;padding:2px 3px;width:100%;';
  POSE_PRESETS.forEach(p => {
    const o = document.createElement('option');
    o.value = p.key; o.textContent = p.label;
    poseSel.appendChild(o);
  });

  const customPoseWrap = document.createElement('div');
  customPoseWrap.style.cssText = 'display:none;flex-direction:column;gap:4px;margin-top:4px;';

  const customPoseArea = document.createElement('textarea');
  customPoseArea.rows = 2;
  customPoseArea.placeholder = 'Опиши движение на русском или английском…';
  customPoseArea.style.cssText = 'font-size:9px;resize:vertical;padding:3px 4px;font-family:inherit;width:100%;box-sizing:border-box;';

  const translateRow = document.createElement('div');
  translateRow.style.cssText = 'display:flex;align-items:center;gap:5px;';

  const translateBtn = document.createElement('button');
  translateBtn.textContent = 'Перевести и улучшить';
  translateBtn.style.cssText = 'font-size:9px;padding:2px 8px;cursor:pointer;border:1px solid #5a6a9a;background:#e8eaf8;';

  const translateStatus = document.createElement('span');
  translateStatus.style.cssText = 'font-size:8px;color:#555;';

  translateRow.appendChild(translateBtn);
  translateRow.appendChild(translateStatus);

  const translatedDisplay = document.createElement('div');
  translatedDisplay.style.cssText = 'display:none;font-size:8px;color:#2a4a7a;background:#e0e8f8;border:1px solid #b0c0e0;padding:3px 5px;border-radius:2px;white-space:pre-wrap;word-break:break-word;';

  translateBtn.addEventListener('click', async () => {
    const raw = customPoseArea.value.trim();
    if (!raw) { translateStatus.textContent = '⚠ Введи текст'; return; }
    translateBtn.disabled = true;
    translateStatus.textContent = '⏳ Переводим…';
    try {
      const r = await fetch('/api/audio/translate-pose', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: raw }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error);
      translatedPoseText = d.result;
      translatedDisplay.textContent = d.result;
      translatedDisplay.style.display = '';
      translateStatus.textContent = '✓';
      selectedPosePrompt = d.result;
    } catch (err) {
      translateStatus.textContent = '⚠ ' + err.message.slice(0, 40);
    } finally {
      translateBtn.disabled = false;
    }
  });

  customPoseArea.addEventListener('input', () => {
    // If user edits after translating, clear the translation
    if (translatedPoseText) { translatedPoseText = ''; translatedDisplay.style.display = 'none'; translateStatus.textContent = ''; }
    selectedPosePrompt = customPoseArea.value;
  });

  customPoseWrap.appendChild(customPoseArea);
  customPoseWrap.appendChild(translateRow);
  customPoseWrap.appendChild(translatedDisplay);

  poseSel.addEventListener('change', () => {
    const preset = POSE_PRESETS.find(p => p.key === poseSel.value);
    if (poseSel.value === 'custom') {
      customPoseWrap.style.display = 'flex';
      selectedPosePrompt = translatedPoseText || customPoseArea.value;
    } else {
      customPoseWrap.style.display = 'none';
      selectedPosePrompt = preset?.prompt || POSE_PRESETS[0].prompt;
    }
  });

  poseSec.appendChild(poseSel);
  poseSec.appendChild(customPoseWrap);
  body.appendChild(poseSec);

  // ── Status + buttons ───────────────────────────────────────────────────────
  const statusEl = document.createElement('div');
  statusEl.style.cssText = 'font-size:9px;color:#555;padding:0 10px;min-height:14px;';

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:6px;justify-content:flex-end;flex-shrink:0;padding:6px 10px 8px;border-top:1px solid #b0b0b0;flex-wrap:wrap;';

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Отмена';
  cancelBtn.style.cssText = 'font-size:10px;padding:3px 10px;cursor:pointer;';
  cancelBtn.addEventListener('click', () => overlay.remove());

  const regenVideoBtn = document.createElement('button');
  regenVideoBtn.textContent = '▶ Только видео';
  regenVideoBtn.title = 'Использовать существующее аудио, перегенерировать только видео';
  regenVideoBtn.style.cssText = 'font-size:10px;padding:3px 10px;cursor:pointer;border:1px solid #4a6a9a;background:#dde8f8;font-weight:bold;';

  const regenAllBtn = document.createElement('button');
  regenAllBtn.textContent = '▶▶ Голос + Видео';
  regenAllBtn.title = 'Перегенерировать аудио с новым текстом/голосом, затем видео';
  regenAllBtn.style.cssText = 'font-size:10px;padding:3px 10px;cursor:pointer;border:1px solid #4a8a4a;background:#d0f0d0;font-weight:bold;';

  body.appendChild(statusEl);
  btnRow.appendChild(cancelBtn);
  btnRow.appendChild(regenVideoBtn);
  btnRow.appendChild(regenAllBtn);
  popup.appendChild(btnRow);

  const _setStatus = (msg, color = '#555') => { statusEl.style.color = color; statusEl.textContent = msg; };
  const _setBusy   = (busy) => { regenVideoBtn.disabled = busy; regenAllBtn.disabled = busy; cancelBtn.disabled = busy; };

  // ── Resolve final image: always generate fresh char+item before avatar ──────
  const _resolveImage = async () => {
    if (varSel?.value) {
      // User explicitly picked a pre-existing variant from dropdown → use directly
      const imgPath = varSel.value;
      if (imgPath !== cell.imagePath) { cell.imagePath = imgPath; saveEditState(); }
      return imgPath;
    } else if (selectedDetInfo) {
      // Item selected → always generate fresh interaction image (char + item + interaction hint)
      const charPath = selectedBaseChar || cell.charImagePath;
      if (!charPath) throw new Error('Нет изображения персонажа для генерации');
      _setStatus('Анализируем предмет…');
      const preR = await fetch('/api/asset-interact/pre-analyze', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activePath: charPath, assetPath: selectedDetInfo.path }),
      });
      const preD = await preR.json();
      if (!preD.success) throw new Error(preD.error);
      // Append custom interaction text as a style hint to the generation prompt
      const genPrompt = interactionCustomText.trim()
        ? `${preD.combinedPrompt}. Interaction style: ${interactionCustomText.trim()}`
        : preD.combinedPrompt;
      _setStatus('Генерируем взаимодействие с предметом…');
      const imageEngine = getImageEngine?.() || 'nano-banana-pro';
      const genR = await fetch('/api/asset-interact/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activePath: charPath, assetPath: selectedDetInfo.path, prompt: genPrompt, assetType: 'detail', imageEngine, engineParams: getEngineParams?.(imageEngine) || {} }),
      });
      const genD = await genR.json();
      if (!genD.success) throw new Error(genD.error);
      _setStatus('Ожидаем изображение…');
      const newImagePath = await window.pollTask(genD.taskId);
      cell.detInfo = selectedDetInfo;
      cell.imagePath = newImagePath;
      cell.charImagePath = charPath;
      if (!cell.generatedImages) cell.generatedImages = [];
      cell.generatedImages.push(newImagePath);
      saveEditState();
      return newImagePath;
    } else {
      // No item selected — use clean char photo
      const charPath = selectedBaseChar || cell.charImagePath;
      cell.imagePath = charPath; cell.charImagePath = charPath;
      saveEditState();
      return charPath;
    }
  };

  const _runAvatar = async (audioPath) => {
    let imgPath;
    try {
      imgPath = await _resolveImage();
    } catch (err) {
      _setStatus('⚠ ' + err.message.slice(0, 80), '#aa0000');
      _setBusy(false); return;
    }
    if (!imgPath || !audioPath) { _setStatus('⚠ Нет изображения или аудио', '#aa0000'); _setBusy(false); return; }

    delete cell.videoPath; cell.videoError = null; cell._videoPending = true;
    saveEditState();

    // Build avatar prompt via AI, combining all user inputs
    _setStatus('Составляем промпт…');
    const videoParams = getEngineParams?.('kling/ai-avatar-pro') || {};
    const posePrompt = (poseSel.value === 'custom')
      ? (translatedPoseText || customPoseArea.value || POSE_PRESETS[0].prompt)
      : selectedPosePrompt;
    let finalPrompt = posePrompt || videoParams.prompt || POSE_PRESETS[0].prompt;
    try {
      const promptR = await fetch('/api/audio/avatar-prompt', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imagePath: imgPath,
          text: textArea.value.trim() || cell.line,
          interactionText: interactionCustomText.trim() || null,
          motionHint: posePrompt || null,
        }),
      });
      const promptD = await promptR.json();
      if (promptD.success && promptD.prompt) finalPrompt = promptD.prompt;
    } catch (_) { /* fallback to posePrompt */ }

    _setStatus('Запускаем аватар…');
    try {
      const r = await fetch('/api/audio/avatar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imagePath: imgPath, audioPath, prompt: finalPrompt, videoParams }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error);
      cell.avatarTaskId = d.taskId; cell._videoPending = true; saveEditState();
      // Close popup immediately — generation continues in background
      overlay.remove();
      (async () => {
        try {
          const videoPath = await window.pollAvatar(d.taskId);
          cell.videoPath = videoPath; cell.videoError = null;
          delete cell.avatarTaskId; delete cell._videoPending; saveEditState();
          window.renderAllTimelines?.(); window.renderMontagePanel?.();
        } catch (err) {
          cell.videoError = err.message;
          delete cell.avatarTaskId; delete cell._videoPending; saveEditState();
          window.renderAllTimelines?.();
        }
      })();
    } catch (err) {
      cell.videoError = err.message;
      delete cell.avatarTaskId; delete cell._videoPending; saveEditState();
      _setStatus('⚠ ' + err.message.slice(0, 80), '#aa0000');
      _setBusy(false);
    }
  };

  regenVideoBtn.addEventListener('click', async () => {
    if (!cell.audioPath) { _setStatus('⚠ Нет аудио — сначала сгенерируйте голос', '#aa0000'); return; }
    _setBusy(true); _setStatus('Запускаем…');
    await _runAvatar(cell.audioPath);
  });

  regenAllBtn.addEventListener('click', async () => {
    _setBusy(true);
    const newText = textArea.value.trim() || cell.line;
    const voice   = voiceSel.value;
    _setStatus('Генерируем голос…');
    try {
      const ttsR = await fetch('/api/audio/tts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: newText, voice, ttsParams: getEngineParams?.('elevenlabs/text-to-speech-turbo-2-5') || {} }),
      });
      const ttsD = await ttsR.json();
      if (!ttsD.success) throw new Error(ttsD.error);
      const audioPath = await window.pollTts(ttsD.taskId);
      cell.audioPath = audioPath; cell.line = newText; delete cell.audioError; saveEditState();
      _setStatus('Голос готов, запускаем видео…');
    } catch (err) {
      cell.audioError = err.message; saveEditState();
      _setStatus('⚠ Ошибка голоса: ' + err.message.slice(0, 60), '#aa0000');
      _setBusy(false); return;
    }
    await _runAvatar(cell.audioPath);
  });
}

// Fast sync update — re-renders only the Биролы right columns already in the DOM.
// Called by toggleActiveBiroly so birolys appear instantly without waiting for async render.
function refreshTimelineBirolys() {
  document.querySelectorAll('.timeline-col-right[data-session-key]').forEach(col => {
    const sk = col.dataset.sessionKey;
    if (typeof renderSessionHooks === 'function') renderSessionHooks(col, sk);
    renderSessionBirolys(col, sk);
  });
}
window.refreshTimelineBirolys = refreshTimelineBirolys;
