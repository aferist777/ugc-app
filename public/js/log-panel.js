/* ═══════════════════════════════════════════════════════
   LOG PANEL  —  active processes + grouped history
   ═══════════════════════════════════════════════════════ */

/* ── GenLog: client-side generation pipeline logger ────── */
window.GenLog = (function () {
  const _sessions = []; // newest first
  const _LS_KEY   = 'genlog_history_v1';
  let   _restoring = false;

  function _uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }
  function _esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function _find(sid) { return _sessions.find(s => s.sid === sid) || null; }

  function _persistHistory() {
    try {
      const toSave = _sessions
        .filter(s => s.status !== 'running')
        .slice(0, 13)
        .map(s => ({ sid: s.sid, tab: s.tab, btn: s.btn, time: s.time, status: s.status, steps: s.steps }));
      localStorage.setItem(_LS_KEY, JSON.stringify(toSave));
    } catch {}
  }

  function _restoreHistory() {
    let saved;
    try { saved = JSON.parse(localStorage.getItem(_LS_KEY) || '[]'); } catch { return; }
    if (!Array.isArray(saved) || !saved.length) return;
    _restoring = true;
    // Process oldest → newest so newest ends up at top of DOM (insertBefore firstChild)
    for (let i = saved.length - 1; i >= 0; i--) {
      const s = saved[i];
      if (_find(s.sid)) continue;
      _sessions.unshift(s);
      _ensureSession(s);
      s.steps.forEach((_, idx) => _appendStep(s, idx));
      s.steps.forEach((_, idx) => { if (s.steps[idx].status !== 'pending') _patchStep(s, idx); });
      const iconEl = document.getElementById('gl-sicon-' + s.sid);
      if (iconEl) { iconEl.className = ''; iconEl.textContent = s.status === 'error' ? ' ❌' : (s.status === 'success' ? ' ✅' : ' ⛔'); }
      if (s.status === 'error') {
        const sessionEl = document.getElementById('gl-s-' + s.sid);
        const errList   = document.getElementById('log-err-list');
        if (sessionEl && errList) { _removePlaceholder(errList); errList.insertBefore(sessionEl, errList.firstChild); }
      }
    }
    _restoring = false;
    _updateCounts();
  }

  /* ── Public API ─────────────────────────────────────── */

  function start(tab, btn) {
    const sid = _uid();
    const s = {
      sid, tab, btn,
      time: new Date().toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      steps: [], status: 'running',
    };
    _sessions.unshift(s);
    _ensureSession(s);
    return sid;
  }

  function step(sid, name, endpoint, reqBody) {
    const s = _find(sid);
    if (!s) return -1;
    const idx = s.steps.length;
    s.steps.push({ name, endpoint, reqBody, resBody: null, status: 'pending', errCode: null, errMsg: null });
    _ensureSession(s);
    _appendStep(s, idx);
    return idx;
  }

  function done(sid, idx, resBody) {
    const s = _find(sid);
    if (!s || !s.steps[idx]) return;
    s.steps[idx].resBody = resBody;
    if (resBody && resBody.success === false) {
      s.steps[idx].status  = 'fail';
      s.steps[idx].errCode = resBody.code || 'API';
      s.steps[idx].errMsg  = resBody.error || 'success: false';
    } else {
      s.steps[idx].status = 'ok';
    }
    _patchStep(s, idx);
  }

  function fail(sid, idx, errCode, errMsg) {
    const s = _find(sid);
    if (!s || !s.steps[idx]) return;
    s.steps[idx].status  = 'fail';
    s.steps[idx].errCode = errCode;
    s.steps[idx].errMsg  = errMsg;
    _patchStep(s, idx);
  }

  function finalize(sid, forced) {
    const s = _find(sid);
    if (!s) return;
    s.status = forced || (s.steps.some(st => st.status === 'fail') ? 'error' : 'success');
    const iconEl = document.getElementById('gl-sicon-' + sid);
    if (iconEl) {
      iconEl.className = '';
      iconEl.textContent = s.status === 'error' ? ' ❌' : ' ✅';
    }
    if (s.status === 'error') {
      const sessionEl = document.getElementById('gl-s-' + sid);
      const errList   = document.getElementById('log-err-list');
      if (sessionEl && errList) {
        _removePlaceholder(errList);
        errList.insertBefore(sessionEl, errList.firstChild);
      }
    }
    _updateCounts();
    _persistHistory();
  }

  function cancel(sid) {
    const s = _find(sid);
    if (!s) return;
    s.status = 'error';
    const iconEl = document.getElementById('gl-sicon-' + sid);
    if (iconEl) { iconEl.className = ''; iconEl.textContent = ' ⛔'; }
    const sessionEl = document.getElementById('gl-s-' + sid);
    const errList   = document.getElementById('log-err-list');
    if (sessionEl && errList) {
      _removePlaceholder(errList);
      errList.insertBefore(sessionEl, errList.firstChild);
    }
    _updateCounts();
    _persistHistory();
  }

  function _removeSession(sid) {
    const i = _sessions.findIndex(s => s.sid === sid);
    if (i < 0) return;
    const el = document.getElementById('gl-s-' + sid);
    if (el) el.remove();
    _sessions.splice(i, 1);
    _updateCounts();
    _persistHistory();
  }

  async function fetchLog(sid, name, url, options) {
    const reqBody = (() => { try { return options.body ? JSON.parse(options.body) : undefined; } catch { return options.body; } })();
    const idx = step(sid, name, `${options.method || 'GET'} ${url}`, reqBody);
    let res;
    try {
      res = await fetch(url, options);
    } catch (e) {
      fail(sid, idx, 'NET', e.message);
      throw e;
    }
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('json')) {
      const err = new Error(`HTTP ${res.status} від ${url.split('/').pop()}`);
      fail(sid, idx, String(res.status), err.message);
      throw err;
    }
    let data;
    try { data = await res.json(); } catch (e) { fail(sid, idx, 'PARSE', e.message); throw e; }
    done(sid, idx, data);
    return data;
  }

  /* ── DOM helpers ─────────────────────────────────────── */

  function _ensureSession(s) {
    if (document.getElementById('gl-s-' + s.sid)) return;
    const genList = document.getElementById('log-gen-list');
    if (!genList) return;
    _removePlaceholder(genList);

    const wrap = document.createElement('div');
    wrap.className = 'gl-session';
    wrap.id = 'gl-s-' + s.sid;

    const closeBtn = document.createElement('button');
    closeBtn.className = 'gl-close-btn';
    closeBtn.title = 'Remove from log';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', (e) => { e.stopPropagation(); _removeSession(s.sid); });

    const hdr = document.createElement('div');
    hdr.className = 'gl-hdr';
    hdr.appendChild(closeBtn);
    const label = document.createElement('span');
    label.className = 'gl-hdr-label';
    label.innerHTML =
      `<span class="gl-arrow">▶</span> <b>${_esc(s.tab)}</b> — ${_esc(s.btn)} · ${s.time}` +
      `<span id="gl-sicon-${s.sid}" class="gl-pending"></span>`;

    const body = document.createElement('div');
    body.className = 'gl-body';
    body.id = 'gl-body-' + s.sid;

    label.addEventListener('click', () => {
      const open = body.style.display !== 'block';
      body.style.display = open ? 'block' : 'none';
      label.querySelector('.gl-arrow').textContent = open ? '▼' : '▶';
    });
    hdr.appendChild(label);

    wrap.appendChild(hdr);
    wrap.appendChild(body);
    genList.insertBefore(wrap, genList.firstChild);

    // Log dropdown is dev/debug only — do not auto-open. The activity strip
    // (#activity-log) keeps the visible progress rows.
    _updateCounts();
  }

  function _appendStep(s, idx) {
    const body = document.getElementById('gl-body-' + s.sid);
    if (!body) return;
    body.appendChild(_buildStepEl(s.sid, s.steps[idx], idx));
  }

  function _patchStep(s, idx) {
    const st = s.steps[idx];
    const isErr = st.status === 'fail';

    const iconEl = document.getElementById('gl-ticon-' + s.sid + '-' + idx);
    if (iconEl) {
      iconEl.className = '';
      iconEl.textContent = isErr ? ` ❌ ${st.errCode || ''}` : ' ✅';
    }

    if (isErr) {
      const stepEl = document.getElementById('gl-t-' + s.sid + '-' + idx);
      if (stepEl) stepEl.classList.add('gl-step-err');
    }

    const stepBody = document.getElementById('gl-tbody-' + s.sid + '-' + idx);
    if (stepBody) {
      if (st.resBody != null && !stepBody.querySelector('.gl-data-res')) {
        const resEl = _dataEl('RESPONSE', st.resBody);
        resEl.classList.add('gl-data-res');
        stepBody.appendChild(resEl);
      }
      if (isErr && st.errMsg && !stepBody.querySelector('.gl-errmsg')) {
        const em = document.createElement('div');
        em.className = 'gl-errmsg';
        em.textContent = st.errMsg;
        stepBody.appendChild(em);
      }
    }
  }

  function _buildStepEl(sid, st, idx) {
    const isErr    = st.status === 'fail';
    const isPending = st.status === 'pending';

    const wrap = document.createElement('div');
    wrap.className = 'gl-step' + (isErr ? ' gl-step-err' : '');
    wrap.id = 'gl-t-' + sid + '-' + idx;

    const hdr = document.createElement('div');
    hdr.className = 'gl-step-hdr';
    hdr.innerHTML =
      `<span class="gl-arrow">▶</span> Шаг ${idx + 1}: <b>${_esc(st.name)}</b> ` +
      `<span class="gl-ep">${_esc(st.endpoint)}</span>` +
      `<span id="gl-ticon-${sid}-${idx}" class="${isPending ? 'gl-pending' : ''}">${isErr ? ` ❌ ${st.errCode || ''}` : (isPending ? '' : ' ✅')}</span>`;

    const body = document.createElement('div');
    body.className = 'gl-step-body';
    body.id = 'gl-tbody-' + sid + '-' + idx;

    hdr.addEventListener('click', () => {
      const open = body.style.display !== 'block';
      body.style.display = open ? 'block' : 'none';
      hdr.querySelector('.gl-arrow').textContent = open ? '▼' : '▶';
    });

    if (st.reqBody !== undefined) body.appendChild(_dataEl('REQUEST', st.reqBody));
    if (st.resBody != null) {
      const resEl = _dataEl('RESPONSE', st.resBody);
      resEl.classList.add('gl-data-res');
      body.appendChild(resEl);
    }
    if (isErr && st.errMsg) {
      const em = document.createElement('div');
      em.className = 'gl-errmsg';
      em.textContent = st.errMsg;
      body.appendChild(em);
    }

    wrap.appendChild(hdr);
    wrap.appendChild(body);
    return wrap;
  }

  function _dataEl(label, data) {
    const wrap = document.createElement('div');
    wrap.className = 'gl-data';
    const hdr = document.createElement('div');
    hdr.className = 'gl-data-hdr';
    hdr.innerHTML = `<span class="gl-arrow">▶</span> ${label}`;
    const body = document.createElement('div');
    body.className = 'gl-data-body';
    hdr.addEventListener('click', () => {
      const open = body.style.display !== 'block';
      body.style.display = open ? 'block' : 'none';
      hdr.querySelector('.gl-arrow').textContent = open ? '▼' : '▶';
    });
    const pre = document.createElement('pre');
    pre.className = 'gl-pre';
    pre.textContent = JSON.stringify(data, null, 2);
    body.appendChild(pre);
    wrap.appendChild(hdr);
    wrap.appendChild(body);
    return wrap;
  }

  function _removePlaceholder(list) {
    list.querySelectorAll(':scope > :not(.gl-session)').forEach(el => el.remove());
  }

  function _updateCounts() {
    const nonErr = _sessions.filter(s => s.status !== 'error').length;
    const errCnt = _sessions.filter(s => s.status === 'error').length;
    const gt = document.getElementById('log-gen-title');
    const et = document.getElementById('log-err-title');
    if (gt) gt.textContent = `Success (${nonErr})`;
    if (et) et.textContent = `Errors (${errCnt})`;
    const genList = document.getElementById('log-gen-list');
    const errList = document.getElementById('log-err-list');
    if (genList && !genList.querySelector('.gl-session')) {
      genList.innerHTML = '<span style="color:#888;font-size:10px;">No entries</span>';
    }
    if (errList && !errList.querySelector('.gl-session')) {
      errList.innerHTML = '<span style="color:#888;font-size:10px;">No errors</span>';
    }
  }

  function renderGenLog() { /* live DOM — no full re-render needed */ }

  // Restore saved history once DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _restoreHistory);
  } else {
    setTimeout(_restoreHistory, 0);
  }

  return { start, step, done, fail, finalize, cancel, fetchLog, renderGenLog };
})();

/* ── Timing storage ──────────────────────────────────── */
const _TIMING_KEY = 'gen_timing_v2';

function _loadTimings() {
  try { return JSON.parse(localStorage.getItem(_TIMING_KEY)) || {}; } catch { return {}; }
}
function _saveTimings(t) { localStorage.setItem(_TIMING_KEY, JSON.stringify(t)); }

function _timingKey(label) { return label.replace(/[^a-zа-яёA-ZА-ЯЁ0-9]/gi, '_').toLowerCase(); }

function _recordTiming(label, ms) {
  const t   = _loadTimings();
  const key = _timingKey(label);
  if (!t[key]) t[key] = [];
  t[key].push(ms);
  if (t[key].length > 30) t[key] = t[key].slice(-30);
  _saveTimings(t);
}

function _avgTiming(label) {
  const arr = _loadTimings()[_timingKey(label)];
  if (!arr || !arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/* ── Time formatting ─────────────────────────────────── */
function _fmtMs(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

/* ── Activity log rows (above the log bar) ──────────── */
window.createActivityRow = function(label) {
  const logEl = document.getElementById('activity-log');
  if (!logEl) return { setStatus:()=>{}, setImage:()=>{}, setVideo:()=>{}, finalize:()=>{} };

  const row = document.createElement('div');
  row.className = 'activity-row';

  const labelEl = document.createElement('div');
  labelEl.className = 'activity-row-label';
  labelEl.textContent = label;

  const statusEl = document.createElement('div');
  statusEl.className = 'activity-row-status';
  statusEl.textContent = '⏳ …';

  const imgEl = document.createElement('img');
  imgEl.className = 'activity-row-img';
  imgEl.alt = '';
  imgEl.addEventListener('click', () => { if (imgEl.src) openLightbox?.(imgEl.getAttribute('src')); });

  const vidEl = document.createElement('video');
  vidEl.className = 'activity-row-vid';
  vidEl.muted = true; vidEl.loop = true; vidEl.playsInline = true;
  vidEl.addEventListener('click', () => { if (vidEl.src) openLightbox?.(vidEl.getAttribute('src')); });

  // Status-check button — appears to the LEFT of the close button when armed.
  // Used by long-poll callers after a timeout: a click re-queries the task
  // status endpoint once and resolves the row if the task has finished.
  const checkBtn = document.createElement('button');
  checkBtn.className = 'activity-row-check';
  checkBtn.textContent = '↻ Check';
  checkBtn.title = 'Re-check task status';
  checkBtn.style.display = 'none';

  // ETA badge — shown next to the ✕ button when a caller arms a countdown.
  // Format: "~M:SS" while counting, "~" when overshooting, hidden otherwise.
  const etaEl = document.createElement('span');
  etaEl.className = 'activity-row-eta';
  etaEl.style.cssText = 'font-size:9px;color:#666;margin:0 4px;display:none;';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'activity-row-close';
  closeBtn.textContent = '✕';
  closeBtn.title = 'Remove';
  let _cancelCb    = null;
  let _etaInterval = null;
  closeBtn.addEventListener('click', () => {
    if (_etaInterval) { clearInterval(_etaInterval); _etaInterval = null; }
    _cancelCb?.(); row.remove();
  });

  row.appendChild(labelEl);
  row.appendChild(statusEl);
  row.appendChild(imgEl);
  row.appendChild(vidEl);
  row.appendChild(checkBtn);
  row.appendChild(etaEl);
  row.appendChild(closeBtn);
  logEl.insertBefore(row, logEl.firstChild);

  function _stopEta() {
    if (_etaInterval) { clearInterval(_etaInterval); _etaInterval = null; }
    etaEl.style.display = 'none';
  }

  const api = {
    setStatus(t)         { statusEl.textContent = t; },
    setImage(p)          { if (!p) return; imgEl.src = p; imgEl.style.display = 'block'; },
    setVideo(p)          { if (!p) return; vidEl.src = p; vidEl.style.display = 'block'; vidEl.play?.().catch(()=>{}); },
    // Arm a ~M:SS countdown next to the ✕ button. Starts immediately, ticks
    // every second, shows "~" once the estimate is exceeded. Cleared when
    // finalize/remove fires. Re-arming replaces the existing timer.
    setEtaCountdown(estimatedSec) {
      _stopEta();
      if (!(estimatedSec > 0)) return;
      const startTs = Date.now();
      const total   = estimatedSec;
      const _fmt = (s) => {
        if (s <= 0) return '~';
        const m  = Math.floor(s / 60);
        const ss = Math.floor(s % 60).toString().padStart(2, '0');
        return m > 0 ? `~${m}:${ss}` : `~${Math.floor(s)}s`;
      };
      const tick = () => {
        const elapsed = (Date.now() - startTs) / 1000;
        etaEl.textContent = _fmt(total - elapsed);
      };
      etaEl.style.display = '';
      tick();
      _etaInterval = setInterval(tick, 1000);
    },
    finalize(t)          {
      _stopEta();
      statusEl.textContent = t;
      row.classList.add('act-done');
      if (!t.startsWith('❌')) {
        try { window.AppChime?.(); } catch (e) {}   // glass-chime on successful completion
        setTimeout(() => { try { row.remove(); } catch {} }, 3000);
      }
    },
    // Pin this row at the top of the activity log and tag it as a sticky error.
    // The row stays in the DOM (no auto-removal) until the user removes it via
    // the ✕ button or until reset via api.unpinError().
    pinAsError(label) {
      if (label !== undefined) statusEl.textContent = label;
      row.classList.add('act-done', 'act-row-pinned-error');
      try { logEl.insertBefore(row, logEl.firstChild); } catch {}
    },
    unpinError() {
      row.classList.remove('act-row-pinned-error');
    },
    getRow() { return row; },
    setRetry(stepName, fn) {
      statusEl.textContent = '';
      labelEl.innerHTML = '';
      const b = document.createElement('button');
      b.className = 'activity-row-retry-btn';
      b.textContent = '↺ ' + (stepName || 'Retry');
      b.title = 'Retry from this step';
      b.addEventListener('click', () => { row.remove(); fn(); });
      labelEl.appendChild(b);
      _cancelCb = null;
    },
    remove()             { _stopEta(); try { row.remove(); } catch {} },
    setCancelCallback(fn){ _cancelCb = fn; },
    // ── Arm a one-shot status re-check ──────────────────────────────────────
    // checkFn() must return a Promise resolving to one of:
    //   { state: 'success', imagePath?, videoPath? }
    //   { state: 'failed',  error?: string }
    //   { state: 'pending' | other }   → button stays clickable
    armStatusCheck(checkFn) {
      if (typeof checkFn !== 'function') return;
      checkBtn.style.display = '';
      checkBtn.disabled = false;
      checkBtn.onclick = async () => {
        if (checkBtn.disabled) return;
        checkBtn.disabled = true;
        const prevText = checkBtn.textContent;
        checkBtn.textContent = '⏳';
        try {
          const r = await checkFn();
          if (r && r.state === 'success') {
            if (r.imagePath) api.setImage(r.imagePath);
            if (r.videoPath) api.setVideo(r.videoPath);
            checkBtn.style.display = 'none';
            api.finalize('✅ Done (recovered)');
            return;
          }
          if (r && r.state === 'failed') {
            checkBtn.style.display = 'none';
            api.finalize('❌ ' + (r.error || 'Failed'));
            return;
          }
          // Still pending — keep button armed, give brief feedback
          statusEl.textContent = '⏳ Still pending — click Check again later';
        } catch (e) {
          statusEl.textContent = '❌ Check failed: ' + (e.message || 'unknown');
        } finally {
          checkBtn.textContent = prevText;
          checkBtn.disabled = false;
        }
      };
    },
  };
  return api;
};

/* ── Active tasks (client-side only) ────────────────── */
const _activeTasks = new Map(); // id → { label, startMs, ivId, el, actRow }

window.startActiveGen = function(id, label) {
  if (_activeTasks.has(id)) return null;
  const startMs = Date.now();
  const avg     = _avgTiming(label);
  const avgStr  = avg != null ? ` (~${_fmtMs(avg)})` : '';

  const el = document.createElement('div');
  el.className = 'log-active-item';
  el.innerHTML =
    `<span class="log-active-dot">●</span>` +
    `<span class="log-active-label">${_esc(label)}</span>` +
    `<span class="log-active-timer">0s</span>` +
    `<span class="log-active-avg">${_esc(avgStr)}</span>`;

  const timerEl = el.querySelector('.log-active-timer');
  const ivId    = setInterval(() => {
    timerEl.textContent = _fmtMs(Date.now() - startMs);
  }, 1000);

  const actRow = window.createActivityRow(label);

  _activeTasks.set(id, { label, startMs, ivId, el, actRow });
  _renderActiveSection();

  // Activity strip remains visible above the log; log dropdown stays closed
  // until the user opens it manually (dev/debug surface).

  return actRow;
};

window.finishActiveGen = function(id) {
  const t = _activeTasks.get(id);
  if (!t) return;
  clearInterval(t.ivId);
  const elapsed = Date.now() - t.startMs;
  _recordTiming(t.label, elapsed);
  t.actRow?.finalize?.(`✅ ${t.label} — ${_fmtMs(elapsed)}`);
  _activeTasks.delete(id);
  _renderActiveSection();
};

function _renderActiveSection() {
  const section = document.getElementById('log-active-section');
  const list    = document.getElementById('log-active-list');
  if (!section || !list) return;

  list.innerHTML = '';
  _activeTasks.forEach(({ el }) => list.appendChild(el));
  section.style.display = _activeTasks.size > 0 ? '' : 'none';

  // Update badge count in header
  const badge = document.getElementById('log-active-badge');
  if (badge) badge.textContent = _activeTasks.size > 0 ? ` ●${_activeTasks.size}` : '';
}

/* ── Render GenLog into the panel lists ──────────────── */
function _loadHistory() {
  window.GenLog?.renderGenLog();
}

function _linkify(str) {
  return str.replace(/(https?:\/\/\S+|\/(?:uploads|lookbooks|environments|characters|refs|finals)\/\S+)/g,
    url => `<a href="${url}" target="_blank">${url}</a>`);
}

function _esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/* ── Group toggle ────────────────────────────────────── */
window.toggleLogGroup = function(groupId) {
  const body  = document.getElementById(groupId + '-body');
  const arrow = document.getElementById(groupId + '-arrow');
  if (!body) return;
  const open = body.classList.toggle('log-group-open');
  if (arrow) arrow.textContent = open ? '▼' : '▶';
};

/* ── Main toggle (overrides utils.js toggleLog) ──────── */
window.toggleLog = function() {
  const panel = document.getElementById('log-panel');
  if (!panel) return;
  const open = panel.classList.toggle('open');
  if (open) _loadHistory();
};

// Collapse the log when clicking anywhere outside it (and outside its toggle strip).
document.addEventListener('mousedown', (e) => {
  const panel = document.getElementById('log-panel');
  if (!panel || !panel.classList.contains('open')) return;
  if (panel.contains(e.target)) return;
  const strip = document.getElementById('log-strip');
  if (strip && strip.contains(e.target)) return;
  panel.classList.remove('open');
});

// Also expose loadLog for back-compat
window.loadLog = _loadHistory;

/* ── Init: render empty active section on load ────────── */
document.addEventListener('DOMContentLoaded', () => {
  _renderActiveSection();
});
