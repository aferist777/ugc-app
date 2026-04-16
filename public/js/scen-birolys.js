/* scen-birolys.js — renderSessionBirolys, TL_COLORS palette */

// ── Right column: biroly list for one session ────────────────────────────────
// Active birolys sorted by start time. Inactive birolys below (hideable).
// Per-session state in timeline_data_v2: { activated[], timings{}, hideInactive }
function renderSessionBirolys(container, sessionKey) {
  container.innerHTML = '';
  const data        = getTimelineData();
  const archive     = typeof getBirolyArchive === 'function' ? getBirolyArchive() : [];
  const sessionData = data[sessionKey] || {};
  const activated   = new Set(sessionData.activated || []);
  const timings     = sessionData.timings || {};
  const hideInactive = !!sessionData.hideInactive;

  // ── Header row: "Биролы" + hide-toggle + save-default + reset ───────────
  const hdrRow = document.createElement('div');
  hdrRow.style.cssText = 'display:flex;align-items:center;gap:3px;margin-bottom:5px;flex-wrap:wrap;';
  const hdrLbl = document.createElement('span');
  hdrLbl.style.cssText = 'font-size:9px;color:#555;font-weight:bold;flex:1;min-width:0;';
  hdrLbl.textContent = 'Биролы';

  const _btnStyle = 'font-size:8px;padding:1px 5px;cursor:pointer;background:#d4d0c8;border:1px solid #808080;flex-shrink:0;white-space:nowrap;';

  const hideBtn = document.createElement('button');
  hideBtn.style.cssText = _btnStyle;
  hideBtn.textContent = hideInactive ? 'Показать все' : 'Скрыть неакт.';
  hideBtn.title = hideInactive ? 'Показать неактивные биролы' : 'Скрыть неактивные биролы';
  hideBtn.addEventListener('click', () => {
    const d = getTimelineData();
    if (!d[sessionKey]) d[sessionKey] = {};
    d[sessionKey].hideInactive = !d[sessionKey].hideInactive;
    setTimelineData(d);
    renderSessionBirolys(container, sessionKey);
  });

  // ── Save as default ──────────────────────────────────────────────────────
  const defaults     = getBirolyDefaults();
  const hasDefault   = !!defaults[sessionKey];

  const saveDefBtn = document.createElement('button');
  saveDefBtn.style.cssText = _btnStyle + 'background:#e4f0e4;border-color:#5a9a5a;color:#1a5c1a;';
  saveDefBtn.textContent = '⭐ Дефолт';
  saveDefBtn.title = hasDefault
    ? 'Сохранить текущий порядок и тайминги как дефолт (заменит сохранённый)'
    : 'Сохранить текущий порядок и тайминги биролов как дефолт';
  saveDefBtn.addEventListener('click', () => {
    const d  = getTimelineData();
    const sd = d[sessionKey] || {};
    const snap = {
      activated: JSON.parse(JSON.stringify(sd.activated || [])),
      timings:   JSON.parse(JSON.stringify(sd.timings   || {})),
    };
    const defs = getBirolyDefaults();
    defs[sessionKey] = snap;
    setBirolyDefaults(defs);
    saveDefBtn.textContent = '⭐ Сохранено';
    saveDefBtn.style.background = '#b8e0b8';
    setTimeout(() => {
      saveDefBtn.textContent = '⭐ Дефолт';
      saveDefBtn.style.background = '#e4f0e4';
    }, 1500);
  });

  // ── Reset to default ─────────────────────────────────────────────────────
  const resetDefBtn = document.createElement('button');
  resetDefBtn.style.cssText = _btnStyle + (hasDefault
    ? 'background:#f0e4d4;border-color:#9a6a1a;color:#5c3a00;'
    : 'opacity:0.45;cursor:default;');
  resetDefBtn.textContent = '↺ Сброс';
  resetDefBtn.title = hasDefault ? 'Вернуть дефолтный порядок биролов' : 'Дефолт ещё не сохранён';
  resetDefBtn.disabled = !hasDefault;
  resetDefBtn.addEventListener('click', () => {
    if (!hasDefault) return;
    const defs = getBirolyDefaults();
    const snap = defs[sessionKey];
    if (!snap) return;
    const d = getTimelineData();
    if (!d[sessionKey]) d[sessionKey] = {};
    d[sessionKey].activated = JSON.parse(JSON.stringify(snap.activated || []));
    d[sessionKey].timings   = JSON.parse(JSON.stringify(snap.timings   || {}));
    setTimelineData(d);
    renderSessionBirolys(container, sessionKey);
    refreshBirolyBars();
  });

  hdrRow.appendChild(hdrLbl);
  hdrRow.appendChild(saveDefBtn);
  hdrRow.appendChild(resetDefBtn);
  hdrRow.appendChild(hideBtn);
  container.appendChild(hdrRow);

  const allItems = archive
    .map((item, idx) => ({ item, idx }))
    .filter(({ item }) => item && item.videoPath);

  if (!allItems.length) {
    const empty = document.createElement('span');
    empty.style.cssText = 'font-size:9px;color:#888;';
    empty.textContent = 'Нет биролов с видео';
    container.appendChild(empty);
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

  // Render a single biroly card into container
  function renderBirolyCard(item, birolyIdx) {
    const isActive = activated.has(birolyIdx);
    const saved    = timings[birolyIdx] || {};
    const dur      = parseFloat(item.duration || 6);

    // Match timeline bar color for this biroly
    const tlColor  = TL_COLORS[birolyIdx % TL_COLORS.length];
    // Derive a subtle background tint from the timeline color (low opacity)
    const bgActive = tlColor + '28'; // ~16% opacity hex suffix

    const card = document.createElement('div');
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

    // Category badge (resolved from catOrder by closure)
    const catFound = catOrder.find(c => c.id === item.categoryId);
    const catLabel = (catFound ? catFound.label : '') || item.categoryLabel || '';
    if (catLabel) {
      const catBadge = document.createElement('span');
      catBadge.style.cssText = 'font-size:7px;color:#555;background:#d8d4cc;border:1px solid #b0aca0;border-radius:2px;padding:0 3px;flex-shrink:0;white-space:nowrap;max-width:52px;overflow:hidden;text-overflow:ellipsis;';
      catBadge.textContent = catLabel;
      catBadge.title = catLabel;
      topRow.appendChild(catBadge);
    }

    const toggleBtn = document.createElement('button');
    toggleBtn.style.cssText = `flex-shrink:0;font-size:9px;padding:1px 5px;cursor:pointer;
      ${isActive ? `background:${tlColor};color:#fff;font-weight:bold;border:1px solid ${tlColor};` : 'background:#d4d4d4;border:1px solid #a0a0a0;'}`;
    toggleBtn.textContent = isActive ? '★' : '☆';
    toggleBtn.title = isActive ? 'Деактивировать' : 'Активировать';
    toggleBtn.addEventListener('click', () => {
      const d = getTimelineData();
      if (!d[sessionKey])           d[sessionKey] = {};
      if (!d[sessionKey].activated) d[sessionKey].activated = [];
      const arr = d[sessionKey].activated;
      const pos = arr.indexOf(birolyIdx);
      if (pos === -1) {
        arr.push(birolyIdx);
        if (!d[sessionKey].timings)            d[sessionKey].timings = {};
        if (!d[sessionKey].timings[birolyIdx]) {
          d[sessionKey].timings[birolyIdx] = { crop: '0', start: '0.00', end: dur.toFixed(2) };
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

      const cropInp  = inp(saved.crop  ?? '0',            'crop', 30);
      const startInp = inp(saved.start ?? '0.00',         '0.00', 36);
      const endInp   = inp(saved.end   ?? dur.toFixed(2), '0.00', 36);

      // Data attributes so drag handler can find + update these inputs directly
      startInp.dataset.timingKey = `${sessionKey}__${birolyIdx}__start`;
      endInp.dataset.timingKey   = `${sessionKey}__${birolyIdx}__end`;

      const recalcEnd = () => { const c = parseFloat(cropInp.value)||0; const s = parseFloat(startInp.value)||0; endInp.value = (s + Math.max(0, dur - c)).toFixed(2); };
      const saveAll   = () => saveTiming(birolyIdx, { crop: cropInp.value, start: startInp.value, end: endInp.value });

      cropInp.addEventListener('input',  () => { recalcEnd(); saveAll(); });
      cropInp.addEventListener('change', () => { saveAll(); refreshBirolyBars(); });
      startInp.addEventListener('input',  () => { recalcEnd(); saveAll(); });
      startInp.addEventListener('change', () => { saveAll(); renderSessionBirolys(container, sessionKey); refreshBirolyBars(); });
      endInp.addEventListener('change',   () => { saveAll(); refreshBirolyBars(); });

      timingRow.appendChild(lbl('crop')); timingRow.appendChild(cropInp);
      timingRow.appendChild(lbl('с:'));   timingRow.appendChild(startInp);
      timingRow.appendChild(lbl('до:'));  timingRow.appendChild(endInp);
      card.appendChild(timingRow);
    }
    container.appendChild(card);
  }

  // Flat list: active items sorted by timeline start time, then inactive below
  const activeItems   = allItems
    .filter(({ idx }) => activated.has(idx))
    .sort((a, b) => (parseFloat(timings[a.idx]?.start) || 0) - (parseFloat(timings[b.idx]?.start) || 0));
  const inactiveItems = hideInactive ? [] : allItems.filter(({ idx }) => !activated.has(idx));

  activeItems.forEach(({ item, idx }) => renderBirolyCard(item, idx));

  if (inactiveItems.length) {
    const sep = document.createElement('div');
    sep.style.cssText = 'border-top:1px dashed #bbb;margin:3px 0 2px;font-size:8px;color:#aaa;padding-top:2px;';
    sep.textContent = 'неактивные';
    container.appendChild(sep);
    inactiveItems.forEach(({ item, idx }) => renderBirolyCard(item, idx));
  }
  // After any re-render, sync biroly bars
  refreshBirolyBars();
}

// ── Per-project Таймлайн rows (one per completed session) ─────────────────────
const TL_COLORS = ['#3a7a5a','#4a6a9a','#7a4a8a','#9a7a3a','#3a6a7a','#7a3a4a','#5a8a3a','#8a5a3a'];

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

