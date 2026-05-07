/* scen-halfers.js — Halfers: per-session activation in Склейка.
   Model: same as scen-hooks.js, but the source pool is the Birolys archive
   (same videos as Birolys dropdown). Halfers render as overlays cropped to
   the top OR bottom 2/5 of the frame with a 20px feather edge.

   Per-session state in timeline_data_v2:
     d[sessionKey].halfers = {
       activated: [stableKey, ...],   // biroly id (or numeric idx fallback)
       timings:   {
         [stableKey]: { crop, cropEnd, start, end, speed, cropAlign,
                        halferAlign, reversed }
       }
     }

   halferAlign ∈ { 'top', 'bottom' } — vertical placement of the 2/5-height
   overlay on the main video.
*/

const HALFER_COLOR = '#2a8060';
const _halferDetailsOpen = new Map();

function _halferStableKey(item, idx) { return item?.id || String(idx); }

// ── Right column: halfer list for one session ──────────────────────────────
function renderSessionHalfers(container, sessionKey) {
  // Save current open state before replacing
  const prevSub = container.querySelector('.halfers-sub');
  if (prevSub) {
    const prevDetails = prevSub.querySelector('details');
    if (prevDetails) _halferDetailsOpen.set(sessionKey, prevDetails.open);
    prevSub.remove();
  }

  const sub = document.createElement('div');
  sub.className = 'halfers-sub';

  const archive    = typeof getBirolyArchive === 'function' ? getBirolyArchive() : [];
  const data       = getTimelineData();
  const sessData   = data[sessionKey] || {};
  const hd         = sessData.halfers  || {};
  const activated  = new Set(hd.activated || []);
  const timings    = hd.timings || {};

  const allItems = archive
    .map((item, idx) => ({ item, idx }))
    .filter(({ item, idx }) =>
      item && (item.videoPath || item.imagePath || item.thumbPath
        || activated.has(_halferStableKey(item, idx))));

  const activeCnt = allItems
    .filter(({ item, idx }) => item.videoPath && activated.has(_halferStableKey(item, idx)))
    .length;

  const details = document.createElement('details');
  const summary = document.createElement('summary');
  details.open = _halferDetailsOpen.has(sessionKey) ? _halferDetailsOpen.get(sessionKey) : activeCnt === 0;
  details.style.cssText = 'margin-top:4px;';
  summary.style.cssText = 'cursor:pointer;user-select:none;list-style:none;display:flex;align-items:center;gap:5px;padding:3px 6px;background:#d4d0c8;border:2px solid;border-color:#fff #808080 #808080 #fff;font-size:10px;font-weight:bold;color:#000;margin-bottom:2px;';
  const arrow = document.createElement('span');
  arrow.style.cssText = 'font-size:8px;color:#333;flex-shrink:0;';
  arrow.textContent = details.open ? '▼' : '▶';
  const titleEl = document.createElement('span');
  titleEl.textContent = 'Halfers' + (allItems.length ? ` (${activeCnt}/${allItems.length})` : '');
  summary.appendChild(arrow);
  summary.appendChild(titleEl);
  details.addEventListener('toggle', () => { arrow.textContent = details.open ? '▼' : '▶'; });
  details.appendChild(summary);

  const inner = document.createElement('div');
  inner.style.cssText = 'margin-top:3px;';

  // "+ More vars" — open popup to browse all birolys and toggle as halfer
  if (allItems.length > 8 || archive.some(it => it && it.videoPath && !activated.has(_halferStableKey(it, archive.indexOf(it))))) {
    const varsBtn = document.createElement('button');
    varsBtn.style.cssText = `font-size:8px;padding:1px 5px;cursor:pointer;background:#dceee6;border:1px solid ${HALFER_COLOR};color:#155a3a;font-weight:bold;white-space:nowrap;margin-bottom:4px;`;
    varsBtn.textContent = '＋ More vars';
    varsBtn.title = 'Browse all birolys and add to halfers';
    varsBtn.addEventListener('click', () => _openHalferVarsPopup(container, sessionKey));
    inner.appendChild(varsBtn);
  }

  if (!allItems.length) {
    const empty = document.createElement('span');
    empty.style.cssText = 'font-size:9px;color:#888;display:block;margin:3px 0;';
    empty.textContent = 'No birolys with video';
    inner.appendChild(empty);
    details.appendChild(inner);
    sub.appendChild(details);
    container.appendChild(sub);
    return;
  }

  function saveHalferTiming(stableKey, updates) {
    const d = getTimelineData();
    if (!d[sessionKey])                          d[sessionKey] = {};
    if (!d[sessionKey].halfers)                  d[sessionKey].halfers = {};
    if (!d[sessionKey].halfers.timings)          d[sessionKey].halfers.timings = {};
    if (!d[sessionKey].halfers.timings[stableKey]) d[sessionKey].halfers.timings[stableKey] = {};
    Object.assign(d[sessionKey].halfers.timings[stableKey], updates);
    setTimelineData(d);
  }

  function renderHalferCard(item, idx) {
    const stableKey = _halferStableKey(item, idx);
    const isActive  = activated.has(stableKey);
    const saved     = timings[stableKey] || {};
    const dur       = parseFloat(saved.duration || item.duration || 5);

    const card = document.createElement('div');
    card.dataset.halferKey = stableKey;
    card.style.cssText = `display:flex;flex-direction:column;gap:3px;margin-bottom:4px;padding:3px 4px;
      border:1px solid ${isActive ? HALFER_COLOR : '#c0c0c0'};
      background:${isActive ? '#dceee6' : '#ebebeb'};
      ${!isActive ? 'opacity:0.75;' : ''}`;

    const topRow = document.createElement('div');
    topRow.style.cssText = 'display:flex;align-items:center;gap:4px;';

    const thumbWrap = document.createElement('div');
    thumbWrap.style.cssText = 'width:22px;height:30px;flex-shrink:0;overflow:hidden;border:1px solid #808080;cursor:pointer;background:#111;display:flex;align-items:center;justify-content:center;';
    thumbWrap.title = '▶ ' + (item.name || 'Biroly');
    if (item.thumbPath) {
      const img = document.createElement('img');
      img.src = item.thumbPath;
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
      thumbWrap.appendChild(img);
    } else if (item.videoPath) {
      const vid = document.createElement('video');
      vid.src = item.videoPath + '#t=0.5';
      vid.muted = true; vid.preload = 'metadata';
      vid.style.cssText = 'width:100%;height:100%;object-fit:cover;';
      thumbWrap.appendChild(vid);
    }
    thumbWrap.addEventListener('click', () => {
      if (typeof openBirolyVideoLightbox === 'function') openBirolyVideoLightbox(item.videoPath, item.thumbPath);
    });
    topRow.appendChild(thumbWrap);

    const nameEl = document.createElement('span');
    nameEl.style.cssText = 'flex:1;font-size:9px;color:#333;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;';
    nameEl.textContent = item.name || 'Biroly';
    topRow.appendChild(nameEl);

    const toggleBtn = document.createElement('button');
    toggleBtn.style.cssText = `flex-shrink:0;font-size:9px;padding:1px 5px;cursor:pointer;
      ${isActive
        ? `background:${HALFER_COLOR};color:#fff;font-weight:bold;border:1px solid ${HALFER_COLOR};`
        : 'background:#d4d4d4;border:1px solid #a0a0a0;'}`;
    toggleBtn.textContent = isActive ? '★' : '☆';
    toggleBtn.title = isActive ? 'Deactivate halfer' : 'Activate as halfer';
    toggleBtn.addEventListener('click', () => {
      const d = getTimelineData();
      if (!d[sessionKey])                   d[sessionKey] = {};
      if (!d[sessionKey].halfers)           d[sessionKey].halfers = {};
      if (!d[sessionKey].halfers.activated) d[sessionKey].halfers.activated = [];
      const arr = d[sessionKey].halfers.activated;
      const pos = arr.indexOf(stableKey);
      if (pos === -1) {
        arr.push(stableKey);
        if (!d[sessionKey].halfers.timings)            d[sessionKey].halfers.timings = {};
        if (!d[sessionKey].halfers.timings[stableKey]) {
          d[sessionKey].halfers.timings[stableKey] = {
            crop: '0', cropEnd: '0', start: '0.00', end: dur.toFixed(2),
            cropAlign: 'center', halferAlign: 'top', reversed: false,
          };
        }
      } else { arr.splice(pos, 1); }
      setTimelineData(d);
      renderSessionHalfers(container, sessionKey);
      refreshHalfersBars();
    });
    topRow.appendChild(toggleBtn);
    card.appendChild(topRow);

    if (isActive && item.videoPath) {
      const timingRow = document.createElement('div');
      timingRow.style.cssText = 'display:flex;align-items:center;gap:2px;flex-wrap:nowrap;';
      const mkLbl = t => { const s = document.createElement('span'); s.style.cssText = 'font-size:8px;color:#555;flex-shrink:0;'; s.textContent = t; return s; };
      const mkInp = (val, ph, w) => { const i = document.createElement('input'); i.type = 'text'; i.value = val || ''; i.placeholder = ph; i.style.cssText = `width:${w || 34}px;font-size:8px;padding:1px 2px;box-sizing:border-box;`; return i; };

      const cropInp    = mkInp(saved.crop    ?? '0',            'crop', 28);
      const startInp   = mkInp(saved.start   ?? '0.00',         '0.00', 34);
      const endInp     = mkInp(saved.end     ?? dur.toFixed(2), '0.00', 34);
      const cropEndInp = mkInp(saved.cropEnd ?? '0',            'cEnd', 28);

      const _spdSaved = Math.min(2, Math.max(0.25, parseFloat(saved.speed) || 1));
      const speedSlider = document.createElement('input');
      speedSlider.type = 'range'; speedSlider.min = '0.25'; speedSlider.max = '2'; speedSlider.step = '0.05';
      speedSlider.style.cssText = 'width:48px;cursor:pointer;vertical-align:middle;flex-shrink:0;';
      speedSlider.title = 'Playback speed (0.25x–2x)';
      speedSlider.value = _spdSaved;
      const speedLbl = document.createElement('span');
      speedLbl.style.cssText = 'font-size:8px;color:#333;flex-shrink:0;min-width:30px;';
      speedLbl.textContent = _spdSaved.toFixed(2) + 'x';

      const recalcEnd = () => {
        const c   = parseFloat(cropInp.value)     || 0;
        const ce  = parseFloat(cropEndInp.value)  || 0;
        const s   = parseFloat(startInp.value)    || 0;
        const spd = parseFloat(speedSlider.value) || 1;
        endInp.value = (s + Math.max(0, dur - c - ce) / spd).toFixed(2);
      };

      // Crop align (horizontal) — left/center/right
      const cropAlignSel = document.createElement('select');
      cropAlignSel.style.cssText = 'font-size:8px;padding:1px 2px;width:54px;flex-shrink:0;';
      cropAlignSel.title = 'Crop alignment by width';
      ['left','center','right'].forEach(v => {
        const o = document.createElement('option'); o.value = v; o.textContent = v; cropAlignSel.appendChild(o);
      });
      cropAlignSel.value = saved.cropAlign || 'center';

      // Halfer align (vertical placement on the main video) — top/bottom
      const halferAlignSel = document.createElement('select');
      halferAlignSel.style.cssText = 'font-size:8px;padding:1px 2px;width:54px;flex-shrink:0;';
      halferAlignSel.title = 'Where on the main video the halfer overlay is placed';
      ['top','bottom'].forEach(v => {
        const o = document.createElement('option'); o.value = v; o.textContent = v; halferAlignSel.appendChild(o);
      });
      halferAlignSel.value = saved.halferAlign || 'top';

      // Reverse toggle
      let _revOn = !!saved.reversed;
      const revBtn = document.createElement('button');
      const _applyRevStyle = () => {
        revBtn.textContent = '⇄ rev';
        revBtn.style.cssText = `font-size:8px;padding:1px 5px;cursor:pointer;flex-shrink:0;font-weight:bold;
          ${_revOn
            ? 'background:#1a6a1a;color:#fff;border:1px solid #0a4a0a;'
            : 'background:#d4d4d4;color:#555;border:1px solid #a0a0a0;font-weight:normal;'}`;
        revBtn.title = _revOn ? 'Reverse on — click to disable' : 'Insert reversed (backwards)';
      };
      _applyRevStyle();

      const saveAll = () => saveHalferTiming(stableKey, {
        crop:        cropInp.value,
        cropEnd:     cropEndInp.value,
        start:       startInp.value,
        end:         endInp.value,
        speed:       speedSlider.value,
        cropAlign:   cropAlignSel.value,
        halferAlign: halferAlignSel.value,
        reversed:    _revOn,
      });

      cropAlignSel.addEventListener('change',   () => saveAll());
      halferAlignSel.addEventListener('change', () => { saveAll(); refreshHalfersBars(); });
      revBtn.addEventListener('click', () => { _revOn = !_revOn; _applyRevStyle(); saveAll(); });

      cropInp.addEventListener('input',   () => { recalcEnd(); saveAll(); });
      cropInp.addEventListener('change',  () => { saveAll(); refreshHalfersBars(); });
      startInp.addEventListener('input',  () => { recalcEnd(); saveAll(); });
      startInp.addEventListener('change', () => { saveAll(); renderSessionHalfers(container, sessionKey); refreshHalfersBars(); });
      endInp.addEventListener('change',   () => { saveAll(); refreshHalfersBars(); });
      cropEndInp.addEventListener('input',  () => { recalcEnd(); saveAll(); });
      cropEndInp.addEventListener('change', () => { saveAll(); refreshHalfersBars(); });
      speedSlider.addEventListener('input', () => {
        speedLbl.textContent = parseFloat(speedSlider.value).toFixed(2) + 'x';
        recalcEnd(); saveAll(); refreshHalfersBars();
      });

      timingRow.appendChild(mkLbl('crop'));   timingRow.appendChild(cropInp);
      timingRow.appendChild(mkLbl('from:'));  timingRow.appendChild(startInp);
      timingRow.appendChild(mkLbl('to:'));    timingRow.appendChild(endInp);
      timingRow.appendChild(mkLbl('cropE:')); timingRow.appendChild(cropEndInp);
      timingRow.appendChild(mkLbl('spd:'));   timingRow.appendChild(speedSlider); timingRow.appendChild(speedLbl);
      card.appendChild(timingRow);

      // Align row: [align: cropAlign] [halfer: top/bottom] [reverse]
      // halferAlign sits between cropAlign and the reverse button, per spec.
      const alignRow = document.createElement('div');
      alignRow.style.cssText = 'display:flex;align-items:center;gap:4px;margin-top:2px;';
      const alignLbl = document.createElement('span');
      alignLbl.style.cssText = 'font-size:8px;color:#555;flex-shrink:0;';
      alignLbl.textContent = 'align:';
      const halferLbl = document.createElement('span');
      halferLbl.style.cssText = 'font-size:8px;color:#555;flex-shrink:0;';
      halferLbl.textContent = 'half:';
      alignRow.appendChild(alignLbl);
      alignRow.appendChild(cropAlignSel);
      alignRow.appendChild(halferLbl);
      alignRow.appendChild(halferAlignSel);
      alignRow.appendChild(revBtn);
      card.appendChild(alignRow);
    }

    inner.appendChild(card);
  }

  // Active first (sorted by start), then inactive when ≤ 8 total.
  const activeItems = allItems
    .filter(({ item, idx }) => activated.has(_halferStableKey(item, idx)))
    .sort((a, b) => {
      const ta = parseFloat(timings[_halferStableKey(a.item, a.idx)]?.start) || 0;
      const tb = parseFloat(timings[_halferStableKey(b.item, b.idx)]?.start) || 0;
      return ta - tb;
    });
  const inactiveItems = allItems.length > 8
    ? []
    : allItems.filter(({ item, idx }) => !activated.has(_halferStableKey(item, idx)));

  activeItems.forEach(({ item, idx }) => renderHalferCard(item, idx));

  if (inactiveItems.length) {
    const sep = document.createElement('div');
    sep.style.cssText = 'border-top:1px dashed #bbb;margin:3px 0 2px;font-size:8px;color:#aaa;padding-top:2px;';
    sep.textContent = 'inactive';
    inner.appendChild(sep);
    inactiveItems.forEach(({ item, idx }) => renderHalferCard(item, idx));
  }

  details.appendChild(inner);
  sub.appendChild(details);
  container.appendChild(sub);
}

// ── Halfers timeline bar fill ───────────────────────────────────────────────
function _fillHalfersBar(bBar, sessionKey, totalDur) {
  bBar.innerHTML = '';
  const archive   = typeof getBirolyArchive === 'function' ? getBirolyArchive() : [];
  const tlData    = getTimelineData();
  const sessData  = tlData[sessionKey] || {};
  const hd        = sessData.halfers   || {};
  const activated = hd.activated       || [];
  const timings   = hd.timings         || {};

  const byKey = new Map();
  archive.forEach((it, i) => byKey.set(_halferStableKey(it, i), it));

  activated.forEach(stableKey => {
    const item = byKey.get(stableKey);
    const t    = timings[stableKey];
    if (!item || !item.videoPath || !t || t.start === undefined) return;

    const startVal   = parseFloat(t.start);
    const endVal     = parseFloat(t.end);
    const cropVal    = parseFloat(t.crop)    || 0;
    const cropEndVal = parseFloat(t.cropEnd) || 0;
    if (isNaN(startVal) || isNaN(endVal) || endVal <= startVal) return;

    const duration      = endVal - startVal;
    const cropStart     = Math.max(0, startVal - cropVal);
    const totalBlockDur = endVal + cropEndVal - cropStart;
    const blockLeft     = cropStart / totalDur * 100;
    const blockWidth    = totalBlockDur / totalDur * 100;
    const csFrac        = totalBlockDur > 0 ? (startVal - cropStart) / totalBlockDur * 100 : 0;
    const actFrac       = totalBlockDur > 0 ? duration               / totalBlockDur * 100 : 100;
    const ceFrac        = totalBlockDur > 0 ? cropEndVal             / totalBlockDur * 100 : 0;

    const block = document.createElement('div');
    block.style.cssText = `position:absolute;left:${blockLeft.toFixed(3)}%;width:${Math.max(blockWidth, 0.3).toFixed(3)}%;height:100%;box-sizing:border-box;overflow:hidden;border-radius:2px;cursor:grab;`;
    const halfTag = (t.halferAlign || 'top') === 'bottom' ? '↓' : '↑';
    block.title = `${item.name || 'Halfer'} ${halfTag}\nfrom: ${startVal.toFixed(2)}s  to: ${endVal.toFixed(2)}s  crop↑: ${cropVal.toFixed(2)}s  crop↓: ${cropEndVal.toFixed(2)}s\nClick — select [Del] — remove from timeline`;

    if (csFrac > 0) {
      const csPart = document.createElement('div');
      csPart.style.cssText = `position:absolute;left:0;width:${csFrac.toFixed(3)}%;height:100%;background:#555;filter:grayscale(1);border-right:2px dashed #999;box-sizing:border-box;`;
      block.appendChild(csPart);
    }

    const actPart = document.createElement('div');
    actPart.style.cssText = `position:absolute;left:${csFrac.toFixed(3)}%;width:${actFrac.toFixed(3)}%;height:100%;box-sizing:border-box;overflow:hidden;display:flex;align-items:center;`;
    if (item.thumbPath) {
      actPart.style.backgroundImage    = `url(${item.thumbPath})`;
      actPart.style.backgroundSize     = 'cover';
      actPart.style.backgroundPosition = 'center';
      actPart.style.outline = `1px solid ${HALFER_COLOR}`;
    } else {
      actPart.style.background = HALFER_COLOR;
    }
    actPart.innerHTML = `<span style="font-size:7px;color:#fff;font-weight:bold;padding:0 2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;pointer-events:none;text-shadow:0 0 3px #000,0 0 3px #000;">${halfTag} ${item.name || 'H'}</span>`;
    block.appendChild(actPart);

    if (ceFrac > 0) {
      const cePart = document.createElement('div');
      cePart.style.cssText = `position:absolute;left:${(csFrac + actFrac).toFixed(3)}%;width:${ceFrac.toFixed(3)}%;height:100%;background:#555;filter:grayscale(1);border-left:2px dashed #999;box-sizing:border-box;`;
      block.appendChild(cePart);
    }

    // Click to select; drag to reposition
    block.addEventListener('mousedown', e => {
      e.preventDefault();
      const barRect  = bBar.getBoundingClientRect();
      const origLeft = cropStart;
      const startX   = e.clientX;
      let moved      = false;
      block.style.cursor = 'grabbing';
      document.body.style.userSelect = 'none';

      const onMove = ev => {
        if (Math.abs(ev.clientX - startX) > 3) moved = true;
        if (!moved) return;
        const deltaSec     = (ev.clientX - startX) / barRect.width * totalDur;
        const newCropStart = Math.max(0, Math.min(origLeft + deltaSec, totalDur - totalBlockDur));
        block.style.left = (newCropStart / totalDur * 100).toFixed(3) + '%';
      };
      const onUp = ev => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        block.style.cursor = 'grab';
        document.body.style.userSelect = '';

        if (!moved) {
          if (typeof _setTlSelected === 'function') {
            _setTlSelected('halfer', sessionKey, stableKey, block, bBar, totalDur);
          }
          return;
        }
        const deltaSec     = (ev.clientX - startX) / barRect.width * totalDur;
        const newCropStart = Math.max(0, Math.min(origLeft + deltaSec, totalDur - totalBlockDur));
        const newStart     = parseFloat((newCropStart + cropVal).toFixed(2));
        const newEnd       = parseFloat((newStart + duration).toFixed(2));
        const d = getTimelineData();
        if (!d[sessionKey])                 d[sessionKey] = {};
        if (!d[sessionKey].halfers)         d[sessionKey].halfers = {};
        if (!d[sessionKey].halfers.timings) d[sessionKey].halfers.timings = {};
        d[sessionKey].halfers.timings[stableKey] = {
          ...(d[sessionKey].halfers.timings[stableKey] || {}),
          crop:    cropVal.toFixed(2),
          cropEnd: cropEndVal.toFixed(2),
          start:   newStart.toFixed(2),
          end:     newEnd.toFixed(2),
        };
        setTimelineData(d);
        if (typeof _clearTlSelection === 'function') _clearTlSelection();
        refreshHalfersBars();
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    bBar.appendChild(block);
  });
}

function refreshHalfersBars() {
  document.querySelectorAll('.timeline-halfers-bar[data-session-key]').forEach(el => {
    const totalDur = parseFloat(el.dataset.totalDur) || 0;
    if (totalDur > 0) _fillHalfersBar(el, el.dataset.sessionKey, totalDur);
  });
}

// ── "+ More vars" popup: browse all birolys and toggle as halfers ──────────
function _openHalferVarsPopup(container, sessionKey) {
  const archive = typeof getBirolyArchive === 'function' ? getBirolyArchive() : [];
  const allItems = archive
    .map((item, idx) => ({ item, idx }))
    .filter(({ item }) => item && item.videoPath);

  if (!allItems.length) return;

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:10000;display:flex;align-items:center;justify-content:center;';

  const popup = document.createElement('div');
  popup.style.cssText = 'background:#c0c0c0;border:2px solid;border-color:#fff #808080 #808080 #fff;padding:10px;min-width:340px;max-width:92vw;max-height:90vh;display:flex;flex-direction:column;gap:8px;box-sizing:border-box;';

  const titleBar = document.createElement('div');
  titleBar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;background:#000080;color:#fff;padding:3px 8px;margin:-10px -10px 0;flex-shrink:0;';
  const titleTxt = document.createElement('span');
  titleTxt.style.cssText = 'font-size:11px;font-weight:bold;';
  titleTxt.textContent = `All birolys (${allItems.length}) — pick halfers`;
  const closeX = document.createElement('button');
  closeX.textContent = '✕';
  closeX.style.cssText = 'background:none;border:none;color:#fff;cursor:pointer;font-size:13px;padding:0 2px;';
  closeX.addEventListener('click', () => overlay.remove());
  titleBar.appendChild(titleTxt);
  titleBar.appendChild(closeX);
  popup.appendChild(titleBar);

  // Same category order as Birolys popup so groups appear identically
  const DEFAULT_CATS = [
    { id: 'hooks',   label: 'Hooks' },
    { id: 'science', label: 'Science' },
    { id: 'hands',   label: 'Hands' },
    { id: 'faces',   label: 'Faces' },
  ];
  const catOrder = (() => {
    try { const p = JSON.parse(localStorage.getItem('biroly_cats') || '[]'); return p.length ? p : DEFAULT_CATS; }
    catch { return DEFAULT_CATS; }
  })();

  const scroll = document.createElement('div');
  scroll.style.cssText = 'overflow-y:auto;max-height:70vh;flex:1;padding:4px;';

  const refreshCards = () => {
    scroll.innerHTML = '';
    const d   = getTimelineData();
    const sd  = d[sessionKey] || {};
    const hd  = sd.halfers    || {};
    const act = hd.activated  || [];

    const grouped = {};
    catOrder.forEach(c => { grouped[c.id] = { label: c.label, items: [] }; });
    const noCatId = '__nocat__';
    grouped[noCatId] = { label: 'No category', items: [] };

    allItems.forEach(entry => {
      const catId = entry.item.categoryId;
      if (catId && grouped[catId]) grouped[catId].items.push(entry);
      else grouped[noCatId].items.push(entry);
    });

    const makeCard = ({ item, idx }) => {
      const stableKey = _halferStableKey(item, idx);
      const isActive  = act.includes(stableKey);
      const dur       = parseFloat(item.duration || 5);

      const card = document.createElement('div');
      card.style.cssText = `width:100px;display:flex;flex-direction:column;gap:3px;padding:4px;
        background:${isActive ? '#dceee6' : '#e8e8e8'};
        border:1px solid ${isActive ? HALFER_COLOR : '#aaa'};box-sizing:border-box;flex-shrink:0;`;

      const thumbWrap = document.createElement('div');
      thumbWrap.style.cssText = 'width:100%;height:66px;background:#111;overflow:hidden;cursor:pointer;border:1px solid #808080;display:flex;align-items:center;justify-content:center;';
      const thumbSrc = item.thumbPath || item.imagePath;
      if (thumbSrc) {
        const img = document.createElement('img');
        img.src = thumbSrc;
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
        thumbWrap.appendChild(img);
      } else {
        thumbWrap.innerHTML = '<span style="color:#fff;font-size:18px;pointer-events:none;">▶</span>';
      }
      thumbWrap.title = '▶ Preview';
      thumbWrap.addEventListener('click', () => {
        if (typeof openBirolyVideoLightbox === 'function') openBirolyVideoLightbox(item.videoPath, item.imagePath || item.thumbPath);
      });
      card.appendChild(thumbWrap);

      const nameEl = document.createElement('div');
      nameEl.style.cssText = 'font-size:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      nameEl.textContent = item.name || 'Birol';
      card.appendChild(nameEl);

      const addBtn = document.createElement('button');
      addBtn.textContent = isActive ? '★ Active' : '＋ Add';
      addBtn.style.cssText = `font-size:8px;padding:2px 4px;cursor:pointer;width:100%;
        ${isActive
          ? `background:${HALFER_COLOR};color:#fff;border:1px solid ${HALFER_COLOR};`
          : 'background:#e0e0e0;border:1px solid #a0a0a0;'}`;
      addBtn.addEventListener('click', () => {
        const d2 = getTimelineData();
        if (!d2[sessionKey])                   d2[sessionKey] = {};
        if (!d2[sessionKey].halfers)           d2[sessionKey].halfers = {};
        if (!d2[sessionKey].halfers.activated) d2[sessionKey].halfers.activated = [];
        const arr = d2[sessionKey].halfers.activated;
        const pos = arr.indexOf(stableKey);
        if (pos === -1) {
          arr.push(stableKey);
          if (!d2[sessionKey].halfers.timings)            d2[sessionKey].halfers.timings = {};
          if (!d2[sessionKey].halfers.timings[stableKey]) {
            d2[sessionKey].halfers.timings[stableKey] = {
              crop: '0', cropEnd: '0', start: '0.00', end: dur.toFixed(2),
              cropAlign: 'center', halferAlign: 'top', reversed: false,
            };
          }
        } else {
          arr.splice(pos, 1);
        }
        setTimelineData(d2);
        refreshCards();
        renderSessionHalfers(container, sessionKey);
        refreshHalfersBars();
      });
      card.appendChild(addBtn);
      return card;
    };

    [...catOrder.map(c => c.id), noCatId].forEach(catId => {
      const group = grouped[catId];
      if (!group || !group.items.length) return;

      const groupHdr = document.createElement('div');
      groupHdr.style.cssText = 'width:100%;font-size:9px;font-weight:bold;color:#333;background:#d4d0c8;padding:3px 6px;margin-bottom:6px;border-bottom:2px solid #808080;box-sizing:border-box;';
      groupHdr.textContent = group.label;
      scroll.appendChild(groupHdr);

      const row = document.createElement('div');
      row.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px;padding:0 2px;';
      group.items.forEach(entry => row.appendChild(makeCard(entry)));
      scroll.appendChild(row);
    });
  };
  refreshCards();
  popup.appendChild(scroll);

  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'Close';
  closeBtn.style.cssText = 'font-size:9px;padding:3px 14px;cursor:pointer;align-self:flex-end;flex-shrink:0;';
  closeBtn.addEventListener('click', () => overlay.remove());
  popup.appendChild(closeBtn);

  overlay.appendChild(popup);
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

window.renderSessionHalfers = renderSessionHalfers;
window._fillHalfersBar      = _fillHalfersBar;
window.refreshHalfersBars   = refreshHalfersBars;
window._openHalferVarsPopup = _openHalferVarsPopup;
