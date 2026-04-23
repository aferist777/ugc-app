/* scen-birolys.js — renderSessionBirolys, TL_COLORS palette */

const MAX_ACTIVE_BIROLYS = 10;

// ── Right column: biroly list for one session ────────────────────────────────
// Active birolys sorted by start time. Inactive birolys below (hideable).
// Per-session state in timeline_data_v2: { activated[], timings{} }
// Manages its own .birolys-sub child inside container (doesn't clear siblings).
function renderSessionBirolys(container, sessionKey) {
  // Replace own sub-div only (leaves .hooks-sub intact)
  const prevSub = container.querySelector('.birolys-sub');
  if (prevSub) prevSub.remove();

  const sub = document.createElement('div');
  sub.className = 'birolys-sub';

  const data        = getTimelineData();
  const archive     = typeof getBirolyArchive === 'function' ? getBirolyArchive() : [];
  const sessionData = data[sessionKey] || {};

  // Migrate: convert old numeric indices → stable item IDs
  const _rawActivated = sessionData.activated || [];
  const _migratedActivated = _rawActivated.map(v => {
    if (typeof v === 'number') return archive[v]?.id ?? String(v);
    if (typeof v === 'string' && /^\d+$/.test(v)) return archive[parseInt(v, 10)]?.id ?? v;
    return v;
  });
  if (_migratedActivated.some((v, i) => v !== _rawActivated[i])) {
    const d = getTimelineData();
    if (!d[sessionKey]) d[sessionKey] = {};
    d[sessionKey].activated = _migratedActivated;
    setTimelineData(d);
  }

  const activated   = new Set(_migratedActivated);
  const timings     = sessionData.timings || {};

  // ── Collapsible <details> wrapper ────────────────────────────────────────
  const details = document.createElement('details');
  const summary = document.createElement('summary');
  const activeCnt = archive.filter((item, i) => item?.videoPath && activated.has(item.id || String(i))).length;
  details.open = activeCnt === 0; // open when nothing on timeline, closed when has activated
  summary.style.cssText = 'cursor:pointer;user-select:none;list-style:none;display:flex;align-items:center;gap:5px;padding:3px 6px;background:#d4d0c8;border:2px solid;border-color:#fff #808080 #808080 #fff;font-size:10px;font-weight:bold;color:#000;margin-bottom:2px;';
  const arrow = document.createElement('span');
  arrow.style.cssText = 'font-size:8px;color:#333;flex-shrink:0;';
  arrow.textContent = details.open ? '▼' : '▶';
  const titleEl = document.createElement('span');
  titleEl.textContent = 'Биролы' + (activeCnt ? ' (' + activeCnt + ')' : '');
  summary.appendChild(arrow);
  summary.appendChild(titleEl);
  details.addEventListener('toggle', () => { arrow.textContent = details.open ? '▼' : '▶'; });
  details.appendChild(summary);

  // inner = where all content goes (inside <details>)
  const inner = document.createElement('div');
  inner.style.cssText = 'margin-top:3px;';

  const allItems = archive
    .map((item, idx) => ({ item, idx }))
    .filter(({ item, idx }) => item && (item.videoPath || item.imagePath || item.thumbPath || activated.has(item.id || String(idx))));

  // "Еще вары" button when archive has > 8 video birolys
  if (allItems.length > 8) {
    const varsBtn = document.createElement('button');
    const atLimit = activeCnt >= MAX_ACTIVE_BIROLYS;
    varsBtn.style.cssText = 'font-size:8px;padding:1px 5px;cursor:pointer;background:#e8e4f4;border:1px solid #7060a0;color:#30206a;font-weight:bold;white-space:nowrap;margin-bottom:4px;';
    varsBtn.textContent = '＋ Еще вары';
    varsBtn.title = atLimit
      ? `Достигнут максимум ${MAX_ACTIVE_BIROLYS} активных биролов`
      : 'Показать все биролы и добавить на таймлайн';
    if (atLimit) {
      varsBtn.disabled = true;
      varsBtn.style.opacity = '0.45';
      varsBtn.style.cursor  = 'default';
    } else {
      varsBtn.addEventListener('click', () => _openBirolyVarsPopup(container, sessionKey));
    }
    inner.appendChild(varsBtn);
  }

  if (!allItems.length) {
    const empty = document.createElement('span');
    empty.style.cssText = 'font-size:9px;color:#888;';
    empty.textContent = 'Нет биролов с видео';
    inner.appendChild(empty);
    details.appendChild(inner);
    sub.appendChild(details);
    container.appendChild(sub);
    return;
  }

  // Read category order from biroly_cats localStorage key (same source as Биролы tab)
  const BIROLY_DEFAULT_CATS = [
    { id: 'hooks',   label: 'Hooks' },
    { id: 'science', label: 'Science' },
    { id: 'hands',   label: 'Hands' },
    { id: 'faces',   label: 'Faces' },
  ];
  const catOrder = (() => {
    try {
      const parsed = JSON.parse(localStorage.getItem('biroly_cats') || '[]');
      return parsed.length ? parsed : BIROLY_DEFAULT_CATS;
    } catch { return BIROLY_DEFAULT_CATS; }
  })();

  function saveTiming(birolyIdx, updates) {
    const d = getTimelineData();
    if (!d[sessionKey])                    d[sessionKey] = {};
    if (!d[sessionKey].timings)            d[sessionKey].timings = {};
    if (!d[sessionKey].timings[birolyIdx]) d[sessionKey].timings[birolyIdx] = {};
    Object.assign(d[sessionKey].timings[birolyIdx], updates);
    setTimelineData(d);
  }

  // Render a single biroly card into inner
  function renderBirolyCard(item, birolyIdx) {
    const stableKey = item.id || String(birolyIdx);
    const isActive  = activated.has(stableKey);
    const saved     = timings[stableKey] || timings[birolyIdx] || {};
    const dur      = parseFloat(item.duration || 6);

    // Match timeline bar color for this biroly
    const tlColor  = TL_COLORS[birolyIdx % TL_COLORS.length];
    const bgActive = tlColor + '28'; // ~16% opacity hex suffix

    const card = document.createElement('div');
    card.dataset.birolyIdx = stableKey;
    card.style.cssText = `display:flex;flex-direction:column;gap:3px;margin-bottom:4px;padding:3px 4px;
      border:1px solid ${isActive ? tlColor : '#c0c0c0'};
      background:${isActive ? bgActive : '#ebebeb'};
      ${!isActive ? 'opacity:0.75;' : ''}`;

    const topRow = document.createElement('div');
    topRow.style.cssText = 'display:flex;align-items:center;gap:4px;';

    const thumbSrc = item.thumbPath || item.imagePath;
    const thumbCss = 'width:22px;height:30px;object-fit:cover;flex-shrink:0;cursor:pointer;border:1px solid #808080;';
    const openFn   = item.videoPath ? () => window.openBirolyVideoLightbox?.(item.videoPath, item.imagePath || item.thumbPath) : null;
    if (thumbSrc) {
      const thumb = document.createElement('img');
      thumb.src = thumbSrc; thumb.style.cssText = thumbCss;
      thumb.title = '▶ ' + (item.name || 'Бирол');
      if (openFn) {
        thumb.addEventListener('click', openFn);
        thumb.addEventListener('error', () => {
          if (item.videoPath && thumb.parentNode)
            thumb.parentNode.replaceChild(_videoThumb(item.videoPath, thumbCss, openFn), thumb);
          else thumb.style.display = 'none';
        }, { once: true });
      }
      topRow.appendChild(thumb);
    } else if (item.videoPath) {
      topRow.appendChild(_videoThumb(item.videoPath, thumbCss, openFn));
    }

    const nameEl = document.createElement('span');
    nameEl.style.cssText = 'flex:1;font-size:9px;color:#333;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;';
    nameEl.textContent = item.name || 'Бирол';
    topRow.appendChild(nameEl);

    // Category badge
    const catFound = catOrder.find(c => c.id === item.categoryId);
    const catLabel = (catFound ? catFound.label : '') || item.categoryLabel || '';
    if (catLabel) {
      const catBadge = document.createElement('span');
      catBadge.style.cssText = 'font-size:7px;color:#555;background:#d8d4cc;border:1px solid #b0aca0;border-radius:2px;padding:0 3px;flex-shrink:0;white-space:nowrap;max-width:52px;overflow:hidden;text-overflow:ellipsis;';
      catBadge.textContent = catLabel;
      catBadge.title = catLabel;
      topRow.appendChild(catBadge);
    }

    const canAdd = isActive || activeCnt < MAX_ACTIVE_BIROLYS;
    const toggleBtn = document.createElement('button');
    toggleBtn.style.cssText = `flex-shrink:0;font-size:9px;padding:1px 5px;cursor:pointer;
      ${isActive ? `background:${tlColor};color:#fff;font-weight:bold;border:1px solid ${tlColor};` : 'background:#d4d4d4;border:1px solid #a0a0a0;'}
      ${!canAdd ? 'opacity:0.45;cursor:default;' : ''}`;
    toggleBtn.textContent = isActive ? '★' : '☆';
    toggleBtn.title = isActive ? 'Деактивировать' : (canAdd ? 'Активировать' : `Макс. ${MAX_ACTIVE_BIROLYS} биролов`);
    toggleBtn.addEventListener('click', () => {
      const d = getTimelineData();
      if (!d[sessionKey])           d[sessionKey] = {};
      if (!d[sessionKey].activated) d[sessionKey].activated = [];
      const arr = d[sessionKey].activated;
      const pos = arr.indexOf(stableKey);
      if (pos === -1) {
        if (arr.length >= MAX_ACTIVE_BIROLYS) return;
        arr.push(stableKey);
        if (!d[sessionKey].timings)              d[sessionKey].timings = {};
        if (!d[sessionKey].timings[stableKey]) {
          d[sessionKey].timings[stableKey] = { crop: '0', cropEnd: '0', start: '0.00', end: dur.toFixed(2) };
        }
      } else { arr.splice(pos, 1); }
      setTimelineData(d);
      renderSessionBirolys(container, sessionKey);
    });
    topRow.appendChild(toggleBtn);
    card.appendChild(topRow);

    if (isActive) {
      const timingRow = document.createElement('div');
      timingRow.style.cssText = 'display:flex;align-items:center;gap:2px;flex-wrap:nowrap;';
      const lbl = t => { const s = document.createElement('span'); s.style.cssText = 'font-size:8px;color:#555;flex-shrink:0;'; s.textContent = t; return s; };
      const inp = (val, ph, w) => { const i = document.createElement('input'); i.type = 'text'; i.value = val || ''; i.placeholder = ph; i.style.cssText = `width:${w||34}px;font-size:8px;padding:1px 2px;box-sizing:border-box;`; return i; };

      const cropInp    = inp(saved.crop    ?? '0',            'crop', 28);
      const startInp   = inp(saved.start   ?? '0.00',         '0.00', 34);
      const endInp     = inp(saved.end     ?? dur.toFixed(2), '0.00', 34);
      const cropEndInp = inp(saved.cropEnd ?? '0',            'cEnd', 28);

      // Speed slider (0.25x … 2x)
      const _spdSaved = Math.min(2, Math.max(0.25, parseFloat(saved.speed) || 1));
      const speedSlider = document.createElement('input');
      speedSlider.type = 'range'; speedSlider.min = '0.25'; speedSlider.max = '2'; speedSlider.step = '0.05';
      speedSlider.style.cssText = 'width:48px;cursor:pointer;vertical-align:middle;flex-shrink:0;';
      speedSlider.title = 'Скорость воспроизведения (0.25x–2x)';
      speedSlider.value = _spdSaved;
      const speedLbl = document.createElement('span');
      speedLbl.style.cssText = 'font-size:8px;color:#333;flex-shrink:0;min-width:30px;';
      speedLbl.textContent = _spdSaved.toFixed(2) + 'x';

      // Data attributes so drag handler can find + update these inputs directly
      startInp.dataset.timingKey = `${sessionKey}__${stableKey}__start`;
      endInp.dataset.timingKey   = `${sessionKey}__${stableKey}__end`;

      const recalcEnd = () => {
        const c   = parseFloat(cropInp.value)     || 0;
        const ce  = parseFloat(cropEndInp.value)  || 0;
        const s   = parseFloat(startInp.value)    || 0;
        const spd = parseFloat(speedSlider.value) || 1;
        endInp.value = (s + Math.max(0, dur - c - ce) / spd).toFixed(2);
      };
      // Crop align dropdown
      const cropAlignSel = document.createElement('select');
      cropAlignSel.style.cssText = 'font-size:8px;padding:1px 2px;width:54px;flex-shrink:0;';
      cropAlignSel.title = 'Позиция кадрирования по ширине';
      ['left','center','right'].forEach(v => {
        const o = document.createElement('option'); o.value = v; o.textContent = v; cropAlignSel.appendChild(o);
      });
      cropAlignSel.value = saved.cropAlign || 'center';

      const saveAll = () => saveTiming(stableKey, {
        crop:      cropInp.value,
        cropEnd:   cropEndInp.value,
        start:     startInp.value,
        end:       endInp.value,
        speed:     speedSlider.value,
        cropAlign: cropAlignSel.value,
      });

      cropAlignSel.addEventListener('change', () => saveAll());

      cropInp.addEventListener('input',   () => { recalcEnd(); saveAll(); });
      cropInp.addEventListener('change',  () => { saveAll(); refreshBirolyBars(); });
      startInp.addEventListener('input',  () => { recalcEnd(); saveAll(); });
      startInp.addEventListener('change', () => { saveAll(); renderSessionBirolys(container, sessionKey); refreshBirolyBars(); });
      endInp.addEventListener('change',   () => { saveAll(); refreshBirolyBars(); });
      cropEndInp.addEventListener('input',  () => { recalcEnd(); saveAll(); });
      cropEndInp.addEventListener('change', () => { saveAll(); refreshBirolyBars(); });
      speedSlider.addEventListener('input', () => {
        speedLbl.textContent = parseFloat(speedSlider.value).toFixed(2) + 'x';
        recalcEnd(); saveAll(); refreshBirolyBars();
      });

      timingRow.appendChild(lbl('crop'));   timingRow.appendChild(cropInp);
      timingRow.appendChild(lbl('с:'));     timingRow.appendChild(startInp);
      timingRow.appendChild(lbl('до:'));    timingRow.appendChild(endInp);
      timingRow.appendChild(lbl('cropE:')); timingRow.appendChild(cropEndInp);
      timingRow.appendChild(lbl('spd:'));   timingRow.appendChild(speedSlider); timingRow.appendChild(speedLbl);
      card.appendChild(timingRow);

      const alignRow = document.createElement('div');
      alignRow.style.cssText = 'display:flex;align-items:center;gap:4px;margin-top:2px;';
      const alignLbl = document.createElement('span');
      alignLbl.style.cssText = 'font-size:8px;color:#555;flex-shrink:0;';
      alignLbl.textContent = 'align:';
      alignRow.appendChild(alignLbl);
      alignRow.appendChild(cropAlignSel);
      card.appendChild(alignRow);
    }
    inner.appendChild(card);
  }

  // Active items sorted by start time; inactive shown only when total ≤ 8
  const activeItems   = allItems
    .filter(({ item, idx }) => activated.has(item.id || String(idx)))
    .sort((a, b) => {
      const ka = a.item.id || String(a.idx);
      const kb = b.item.id || String(b.idx);
      return (parseFloat(timings[ka]?.start) || 0) - (parseFloat(timings[kb]?.start) || 0);
    });
  const inactiveItems = allItems.length > 8
    ? []
    : allItems.filter(({ item, idx }) => !activated.has(item.id || String(idx)));

  activeItems.forEach(({ item, idx }) => renderBirolyCard(item, idx));

  if (inactiveItems.length) {
    const sep = document.createElement('div');
    sep.style.cssText = 'border-top:1px dashed #bbb;margin:3px 0 2px;font-size:8px;color:#aaa;padding-top:2px;';
    sep.textContent = 'неактивные';
    inner.appendChild(sep);
    inactiveItems.forEach(({ item, idx }) => renderBirolyCard(item, idx));
  }

  details.appendChild(inner);
  sub.appendChild(details);
  container.appendChild(sub);

  // After any re-render, sync biroly bars
  refreshBirolyBars();
}

// ── "Еще вары" popup: browse all birolys with video, toggle active ────────────
function _openBirolyVarsPopup(container, sessionKey) {
  const archive  = typeof getBirolyArchive === 'function' ? getBirolyArchive() : [];
  const allItems = archive.map((item, idx) => ({ item, idx })).filter(({ item }) => item && item.videoPath);

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:10000;display:flex;align-items:center;justify-content:center;';

  const popup = document.createElement('div');
  popup.style.cssText = 'background:#c0c0c0;border:2px solid;border-color:#fff #808080 #808080 #fff;padding:10px;min-width:340px;max-width:92vw;max-height:90vh;display:flex;flex-direction:column;gap:8px;box-sizing:border-box;';

  const titleBar = document.createElement('div');
  titleBar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;background:#000080;color:#fff;padding:3px 8px;margin:-10px -10px 0;flex-shrink:0;';
  const titleTxt = document.createElement('span');
  titleTxt.style.cssText = 'font-size:11px;font-weight:bold;';
  titleTxt.textContent = `Все биролы (${allItems.length})`;
  const closeX = document.createElement('button');
  closeX.textContent = '✕';
  closeX.style.cssText = 'background:none;border:none;color:#fff;cursor:pointer;font-size:13px;padding:0 2px;';
  closeX.addEventListener('click', () => overlay.remove());
  titleBar.appendChild(titleTxt);
  titleBar.appendChild(closeX);
  popup.appendChild(titleBar);

  // ── Category order (same source as Биролы tab slots) ──────────────────────
  const BIROLY_DEFAULT_CATS_P = [
    { id: 'hooks',   label: 'Hooks' },
    { id: 'science', label: 'Science' },
    { id: 'hands',   label: 'Hands' },
    { id: 'faces',   label: 'Faces' },
  ];
  const popupCatOrder = (() => {
    try { const p = JSON.parse(localStorage.getItem('biroly_cats') || '[]'); return p.length ? p : BIROLY_DEFAULT_CATS_P; }
    catch { return BIROLY_DEFAULT_CATS_P; }
  })();

  const scroll = document.createElement('div');
  scroll.style.cssText = 'overflow-y:auto;max-height:70vh;flex:1;padding:4px;';

  const refreshCards = () => {
    scroll.innerHTML = '';
    const d   = getTimelineData();
    const sd  = d[sessionKey] || {};
    const act = sd.activated  || [];
    const activeWithVideo = act.filter(key => {
      const item = archive.find(e => e.id === key) || archive[parseInt(key, 10)] || null;
      return item?.videoPath;
    });
    const popupAtLimit = activeWithVideo.length >= MAX_ACTIVE_BIROLYS;

    // Build category → items map
    const grouped = {};
    popupCatOrder.forEach(c => { grouped[c.id] = { label: c.label, items: [] }; });
    const noCatId = '__nocat__';
    grouped[noCatId] = { label: 'Без категории', items: [] };

    allItems.forEach(entry => {
      const catId = entry.item.categoryId;
      if (catId && grouped[catId]) grouped[catId].items.push(entry);
      else grouped[noCatId].items.push(entry);
    });

    const makeCard = ({ item, idx }) => {
      const stableKey = item.id || String(idx);
      const isActive = act.includes(stableKey);
      const dur      = parseFloat(item.duration || 6);
      const color    = TL_COLORS[idx % TL_COLORS.length];

      const card = document.createElement('div');
      card.style.cssText = `width:100px;display:flex;flex-direction:column;gap:3px;padding:4px;
        background:${isActive ? color + '22' : '#e8e8e8'};
        border:1px solid ${isActive ? color : '#aaa'};box-sizing:border-box;flex-shrink:0;`;

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
      thumbWrap.title = '▶ Предпросмотр';
      thumbWrap.addEventListener('click', () => {
        if (typeof openBirolyVideoLightbox === 'function') openBirolyVideoLightbox(item.videoPath, item.imagePath || item.thumbPath);
      });
      card.appendChild(thumbWrap);

      const nameEl = document.createElement('div');
      nameEl.style.cssText = 'font-size:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      nameEl.textContent = item.name || 'Бирол';
      card.appendChild(nameEl);

      const canPopupAdd = isActive || !popupAtLimit;
      const addBtn = document.createElement('button');
      addBtn.textContent = isActive ? '★ Активен' : (canPopupAdd ? '＋ Добавить' : '🚫 Лимит');
      addBtn.style.cssText = `font-size:8px;padding:2px 4px;cursor:pointer;width:100%;
        ${isActive ? `background:${color};color:#fff;border:1px solid ${color};` : (canPopupAdd ? 'background:#e0e0e0;border:1px solid #a0a0a0;' : 'background:#e0e0e0;border:1px solid #ccc;opacity:0.5;cursor:default;')}`;
      if (!canPopupAdd) {
        addBtn.disabled = true;
        addBtn.title = `Достигнут максимум ${MAX_ACTIVE_BIROLYS} биролов`;
      }
      addBtn.addEventListener('click', () => {
        if (!canPopupAdd) return;
        const d2 = getTimelineData();
        if (!d2[sessionKey])           d2[sessionKey] = {};
        if (!d2[sessionKey].activated) d2[sessionKey].activated = [];
        const arr = d2[sessionKey].activated;
        const pos = arr.indexOf(stableKey);
        if (pos === -1) {
          if (arr.length >= MAX_ACTIVE_BIROLYS) return;
          arr.push(stableKey);
          if (!d2[sessionKey].timings)            d2[sessionKey].timings = {};
          if (!d2[sessionKey].timings[stableKey]) d2[sessionKey].timings[stableKey] = { crop: '0', cropEnd: '0', start: '0.00', end: dur.toFixed(2) };
        } else {
          arr.splice(pos, 1);
        }
        setTimelineData(d2);
        refreshCards();
        renderSessionBirolys(container, sessionKey);
        refreshBirolyBars();
      });
      card.appendChild(addBtn);
      return card;
    };

    // Render groups (skip empty ones)
    [...popupCatOrder.map(c => c.id), noCatId].forEach(catId => {
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
  closeBtn.textContent = 'Закрыть';
  closeBtn.style.cssText = 'font-size:9px;padding:3px 14px;cursor:pointer;align-self:flex-end;flex-shrink:0;';
  closeBtn.addEventListener('click', () => overlay.remove());
  popup.appendChild(closeBtn);

  overlay.appendChild(popup);
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

// ── Per-project Таймлайн rows (one per completed session) ─────────────────────
const TL_COLORS = ['#3a7a5a','#4a6a9a','#7a4a8a','#9a7a3a','#3a6a7a','#7a3a4a','#5a8a3a','#8a5a3a','#2a6a8a','#7a5a2a'];

// ── FFmpeg Advanced Settings — defaults ───────────────────────────────────────
const ADV_DEFAULTS = {
  resolution:   '1080x1920',
  fps:          30,
  crf:          23,
  preset:       'fast',
  audioBitrate: '192k',
  eqBrightness: 0,
  eqContrast:   1,
  eqSaturation: 1,
  eqGamma:      1,
  subsEnabled:  false,
  subsFontSize: 48,
  subsPosition: 'bottom',
  subsColor:    '#ffffff',
  subsStyle:    'outline',
};
